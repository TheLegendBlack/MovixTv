/**
 * Wraps a dynamic-import loader to recover from chunk-load failures
 * after a deploy (the production domain serves only the latest deployment's
 * hashed assets, so a client still running the previous `index.html` requests
 * chunks that now 404 — or hits a brand-new chunk that hasn't propagated to the
 * edge node yet).
 *
 * Recovery strategy (in order):
 *   1. Retry the import a few times with exponential backoff. Most post-deploy
 *      404s are CDN-propagation lag measured in seconds — a couple of retries
 *      on the *current* page resolve them without a disruptive reload.
 *   2. If retries are exhausted, request a full page reload to pull a fresh
 *      `index.html` (and therefore fresh chunk hashes). Guarded by a budget
 *      (max reloads per window) + minimum spacing so a genuinely broken /
 *      offline client can never reload-loop.
 *   3. If the reload budget is spent, the error bubbles to <ErrorBoundary>,
 *      which shows a soft "new version available" screen instead of crashing.
 *
 * Recognised import/network failures are recoverable. import() also
 * rejects when a module or one of its dependencies throws while evaluating:
 * TypeError and SyntaxError alone do not prove a download failure. Unknown
 * errors are rethrown unchanged so ErrorBoundary can report the original
 * message and stack, including browser incompatibilities.
 * A precise missing-export error between our hashed ESM assets gets one
 * separate cache purge/reload attempt per asset/export pair in the tab. Safari
 * omits the asset URL from this error; route loaders provide their stable route
 * pattern so that exact signature gets one attempt per build/route/export. If
 * either error persists, the original SyntaxError is reported rather than
 * filtered out.
 *
 * An invalid MIME type identifies a bad asset response, and so do the parser
 * messages of a truncated or damaged chunk (CORRUPTED_CHUNK_MESSAGES) and a
 * parse error raised by a function of an already running chunk
 * (isLazyCompileError). Skip
 * the in-place retries and purge the service worker's asset cache before
 * reloading so it cannot keep serving that response. Other parse errors are
 * not enough evidence to discard the cache or reload.
 *
 * Background prefetch loads (`{ silent: true }`) NEVER reload or surface a
 * crash — a hover-prefetch on a stale chunk must not yank the page out from
 * under the user. They retry quietly and, on failure, reject so the caller's
 * `.catch` can swallow them.
 *
 * On the FIRST successful chunk load the reload budget is cleared, so a future
 * deploy gets a fresh set of recovery attempts.
 *
 * Also tracks in-flight interactive chunk loads. When the count transitions
 * 0 → 1 a `chunk:load:start` event is dispatched on `window`; when it returns
 * to 0 a `chunk:load:end` event fires. Silent loads (prefetch) are not counted.
 * Used by `<TopProgressBar />` for the global loading indicator.
 *
 * Used by every entry in the route registry:
 *   loader: () => lazyWithRetry(() => import('../pages/MyPage'))
 */

const RELOAD_KEY = '__movix_chunk_reload';
const RELOAD_WINDOW_MS = 120_000; // counter resets after 2 min of no failures
const MAX_RELOADS = 3; // hard cap within the window — loop guard
const MIN_RELOAD_SPACING_MS = 3_000; // never reload twice in quick succession

const MAX_IMPORT_RETRIES = 2; // in-place retries before falling back to reload
const RETRY_BASE_DELAY_MS = 350; // 350ms, then 700ms

const IMPORT_NETWORK_ERROR_PATTERNS = [
  /^(?:Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?)$/i,
  /^FetchEvent\.respondWith received an error(?::[\s\S]*)?$/i,
  /^L['’]opération n['’]a pas pu s['’]achever\. Type de protocole incompatible avec socket\.?$/i,
  // Safari : la requête du module a été redirigée hors de l'origine (page de
  // blocage d'un FAI, portail captif) ou n'a pas abouti (GlitchTip D8, 9R).
  /^Cross-origin script load denied by Cross-Origin Resource Sharing policy\.?$/i,
];

/**
 * SystemJS (bundle legacy) rejette avec l'erreur #3 uniquement depuis
 * l'événement `error` de la balise <script> du chunk : téléchargement raté,
 * statut HTTP d'erreur ou requête bloquée. Une exception pendant l'évaluation
 * passe par `load` et rejette avec l'erreur d'origine (voir instantiate dans
 * systemjs/dist/s.js). C'est donc l'équivalent legacy de « Failed to fetch
 * dynamically imported module ». Les sondes enregistrées dans GlitchTip
 * (8415432, 8410977…) échouaient elles-mêmes sans réponse : coupure réseau.
 */
const SYSTEMJS_LOAD_ERROR_PATTERN =
  /\(SystemJS https:\/\/github\.com\/systemjs\/systemjs\/blob\/main\/docs\/errors\.md#3\)$/;

/**
 * Notre build est du JavaScript valide pour les moteurs qui le reçoivent : ces
 * erreurs d'analyse désignent un chunk tronqué ou abîmé en route (coupure
 * pendant le téléchargement, cache corrompu), pas une incompatibilité.
 * Messages de JavaScriptCore (Safari) puis de V8 (Chromium).
 */
const CORRUPTED_CHUNK_MESSAGES = new Set([
  'Unexpected end of script',
  'Unexpected EOF',
  // Safari affiche l'octet nul échappé ou brut selon la version.
  "Invalid character: '\\0'",
  "Invalid character: '\0'",
  'Invalid or unexpected token',
  'Unexpected end of input',
]);

/**
 * V8 ne compile le corps d'une fonction qu'à son premier appel, mais vérifie
 * toute la syntaxe du chunk dès le chargement : une incompatibilité du
 * navigateur fait donc échouer le chargement, avec une pile vide. Une erreur
 * d'analyse levée plus tard, depuis un de nos chunks déjà exécuté, signale une
 * copie en cache abîmée (source ou code compilé). GlitchTip FRONTEND-F3 :
 * « Unexpected identifier 'u' » à l'appel de TooltipProvider, Opera 136.
 * Movix n'appelle ni eval ni new Function, seule source possible de cette
 * erreur avec un de nos cadres en tête de pile.
 */
const LAZY_COMPILE_ERROR_PATTERN = /^Unexpected identifier(?: '[^']*')?$/;

const isLazyCompileError = (err: unknown): boolean => {
  if (String((err as { name?: unknown })?.name || '') !== 'SyntaxError') return false;
  if (!LAZY_COMPILE_ERROR_PATTERN.test(String((err as Error)?.message || ''))) return false;
  // Pile V8 : le message, puis un cadre « at … » par ligne, le plus récent en tête.
  const firstFrame = String((err as Error)?.stack || '').split('\n').find((line) => /^\s+at /.test(line));
  const location = firstFrame?.match(/\(?(https?:\/\/[^\s()]+):\d+:\d+\)?\s*$/)?.[1];
  if (!location) return false;
  try {
    const url = new URL(location);
    return url.origin === window.location.origin && !url.search && HASHED_JS_ASSET_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
};

const isCorruptedChunkError = (err: unknown): boolean =>
  (String((err as { name?: unknown })?.name || '') === 'SyntaxError'
    && CORRUPTED_CHUNK_MESSAGES.has(String((err as Error)?.message || '')))
  || isLazyCompileError(err);

/**
 * Réponse d'asset invalide ou chunk abîmé : recharger sans vider le cache
 * d'assets du service worker resservirait la même copie.
 */
export const isChunkResponseError = (err: unknown): boolean =>
  /is not a valid JavaScript MIME type|'text\/html' is not a valid/i.test(
    String((err as Error)?.message || err || '')
  ) || isCorruptedChunkError(err);

type MissingExportFailure = {
  assetPath: string;
  exportName: string;
};

const MISSING_EXPORT_ERROR_PATTERN =
  /^The requested module ['"]([^'"]+)['"] (?:does not|doesn't) provide an export named:? ['"]([A-Za-z_$][\w$]*)['"]$/;
const SAFARI_MISSING_EXPORT_ERROR_PATTERN =
  /^Importing binding name '([A-Za-z_$][\w$]*)' is not found\.$/;
const HASHED_JS_ASSET_PATTERN = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.js$/;
const MISSING_EXPORT_RECOVERY_KEY_PREFIX = '__movix_missing_export_recovery:';
const BUILD_RELEASE = String(import.meta.env.VITE_APP_BUILD_ID || '').trim();

/**
 * Firefox and Chromium use this precise SyntaxError when two linked ESM chunks
 * disagree about an export. Restrict recovery to our own generated assets so a
 * real SyntaxError from application code or a third-party module stays visible.
 */
const getMissingExportFailure = (error: unknown): MissingExportFailure | null => {
  if (String((error as { name?: unknown })?.name || '') !== 'SyntaxError') return null;

  const message = String((error as Error)?.message || '');
  const match = message.match(MISSING_EXPORT_ERROR_PATTERN);
  if (!match) return null;

  try {
    const url = new URL(match[1], window.location.href);
    if (url.origin !== window.location.origin || url.username || url.password) return null;
    if (url.search || url.hash || !HASHED_JS_ASSET_PATTERN.test(url.pathname)) return null;
    return { assetPath: url.pathname, exportName: match[2] };
  } catch {
    return null;
  }
};

const getSafariMissingExportName = (error: unknown): string | null => {
  if (String((error as { name?: unknown })?.name || '') !== 'SyntaxError') return null;

  const message = String((error as Error)?.message || '');
  return message.match(SAFARI_MISSING_EXPORT_ERROR_PATTERN)?.[1] ?? null;
};

export const isChunkLoadError = (err: unknown): boolean => {
  const msg = String((err as Error)?.message || err || '');
  const name = String((err as { name?: string })?.name || '');
  return (
    name === 'ChunkLoadError' ||
    isChunkResponseError(err) ||
    SYSTEMJS_LOAD_ERROR_PATTERN.test(msg) ||
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload (?:CSS|module)/i.test(
      msg
    ) ||
    // Some Safari versions expose the network-layer message instead of the
    // usual import error. Keep known signatures, never match TypeError alone.
    (name === 'TypeError' && IMPORT_NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(msg)))
  );
};

type ReloadState = { n: number; at: number };

const readReloadState = (): ReloadState => {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    if (!raw) return { n: 0, at: 0 };
    const parsed = JSON.parse(raw) as ReloadState;
    if (typeof parsed?.n !== 'number' || typeof parsed?.at !== 'number') {
      return { n: 0, at: 0 };
    }
    // Window elapsed since the last failure → start fresh.
    if (Date.now() - parsed.at > RELOAD_WINDOW_MS) return { n: 0, at: 0 };
    return parsed;
  } catch {
    return { n: 0, at: 0 };
  }
};

/** Clears the reload budget. Called after any successful chunk load. */
export const clearChunkReloadHistory = (): void => {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // sessionStorage may throw in private/locked-down contexts — ignore
  }
};

/**
 * Schedules a guarded full-page reload to recover from a chunk-load failure.
 * Returns `true` if a reload was scheduled, `false` if the budget is spent
 * (caller should then surface the error to the ErrorBoundary).
 *
 * Shared by `lazyWithRetry` (interactive route loads) and ErrorBoundary.
 */
export const reloadForChunkFailure = (opts?: { purgeAssetCache?: boolean }): boolean => {
  const state = readReloadState();
  if (state.n >= MAX_RELOADS) return false;

  const now = Date.now();
  const wait = Math.max(0, MIN_RELOAD_SPACING_MS - (now - state.at));
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ n: state.n + 1, at: now + wait }));
  } catch {
    // If we can't persist the counter we still reload once, but the loop
    // guard is weakened — acceptable vs. leaving the user on a broken page.
  }
  const reload = () => window.location.reload();
  window.setTimeout(() => {
    if (!opts?.purgeAssetCache) {
      reload();
      return;
    }
    // Reload whatever happens to the purge — a locked-down Cache API must not
    // leave the user on the broken page.
    Promise.race([purgeServiceWorkerAssetCache(), sleep(PURGE_TIMEOUT_MS)]).then(reload, reload);
  }, wait);
  return true;
};

const PURGE_TIMEOUT_MS = 1_500;

/**
 * Drops the service worker's asset cache (`movix-assets-*` in public/sw.js).
 * Only used for a recognised invalid asset response: if it made it into that
 * cache, every reload would serve the same response and fail the same way.
 * User preferences and the other caches are left intact.
 */
const purgeServiceWorkerAssetCache = async (): Promise<void> => {
  try {
    if (!('caches' in window)) return;
    const names = await window.caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('movix-assets-')).map((name) => window.caches.delete(name)));
  } catch {
    // Cache API unavailable (private mode, locked-down context) — reload anyway.
  }
};

/**
 * A failed ESM link is retained in the document's module map, so retrying the
 * same import cannot repair it. Purge and reload at most once for the exact
 * asset/export pair in this tab. If sessionStorage is unavailable, preserve the
 * original error instead of weakening that loop guard.
 */
const reloadForMissingExportFailure = (error: unknown, routeKey?: string): boolean => {
  const failure = getMissingExportFailure(error);
  let recoveryKey: string;
  if (failure) {
    recoveryKey = `${MISSING_EXPORT_RECOVERY_KEY_PREFIX}${failure.assetPath}:${failure.exportName}`;
  } else {
    const exportName = getSafariMissingExportName(error);
    // Sans URL de module, la release et le pattern de route sont indispensables
    // pour borner la reprise. Ils sont fournis uniquement par le registre lazy.
    if (!exportName || !BUILD_RELEASE || !routeKey) return false;
    recoveryKey = `${MISSING_EXPORT_RECOVERY_KEY_PREFIX}safari:${BUILD_RELEASE}:${routeKey}:${exportName}`;
  }

  try {
    if (sessionStorage.getItem(recoveryKey) === 'done') return false;
    sessionStorage.setItem(recoveryKey, 'done');
  } catch {
    return false;
  }

  if (reloadForChunkFailure({ purgeAssetCache: true })) return true;

  // Le budget général peut être épuisé sans qu'aucune reprise ait eu lieu.
  // Ne pas consommer dans ce cas la tentative réservée à cet export.
  try { sessionStorage.removeItem(recoveryKey); } catch { /* Stockage devenu indisponible. */ }
  return false;
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Synthesises a chunk-load error for a *silently* failed import — one that
 * resolved to a nullish module instead of rejecting. Vite's preload helper does
 * this when a `vite:preloadError` event is preventDefault()-ed (see main.tsx).
 * `name = 'ChunkLoadError'` makes `isChunkLoadError` match it, so it flows
 * through the same retry + guarded-reload recovery as a normal rejection
 * instead of reaching React.lazy as `undefined` (→ "Cannot read properties of
 * undefined (reading 'default')").
 */
const nullishModuleError = (): Error => {
  const e = new Error('Dynamic import resolved to a nullish module (stale or failed chunk)');
  e.name = 'ChunkLoadError';
  return e;
};

const importWithRetry = async <T>(loader: () => Promise<T>, attempt = 0): Promise<T> => {
  let mod: T;
  try {
    mod = await loader();
  } catch (err) {
    // Preserve evaluation/compatibility errors. A recognised bad response
    // goes directly to cache cleanup + reload; retry other load failures.
    // SystemJS garde l'échec dans son registre : ses retries passent par le
    // hook instantiate de src/compat/legacy-dom-polyfills.js, puis le
    // rechargement encadré ci-dessous prend le relais.
    if (!isChunkLoadError(err) || isChunkResponseError(err) || attempt >= MAX_IMPORT_RETRIES) throw err;
    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    return importWithRetry(loader, attempt + 1);
  }
  // A valid `import()` always resolves to a module namespace object; a nullish
  // result means the load silently failed (see nullishModuleError). Retry, then
  // surface it as a chunk failure so the reload path below recovers it.
  if (mod == null) {
    if (attempt >= MAX_IMPORT_RETRIES) throw nullishModuleError();
    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    return importWithRetry(loader, attempt + 1);
  }
  return mod;
};

let activeLoads = 0;

export const getActiveChunkLoads = (): number => activeLoads;

export const lazyWithRetry = <T>(
  loader: () => Promise<T>,
  opts?: { silent?: boolean; routeKey?: string }
): Promise<T> => {
  const silent = opts?.silent === true;
  if (!silent) {
    if (activeLoads === 0) {
      window.dispatchEvent(new Event('chunk:load:start'));
    }
    activeLoads++;
  }

  let settled = false;
  const settle = () => {
    if (silent || settled) return;
    settled = true;
    activeLoads = Math.max(0, activeLoads - 1);
    if (activeLoads === 0) {
      window.dispatchEvent(new Event('chunk:load:end'));
    }
  };

  return importWithRetry(loader)
    .then((mod) => {
      // A chunk resolved → the client is on a consistent build again. Reset the
      // budget so a future deploy gets a fresh set of recovery attempts.
      clearChunkReloadHistory();
      settle();
      return mod;
    })
    .catch((err) => {
      settle();
      if (!silent && reloadForMissingExportFailure(err, opts?.routeKey)) {
        return new Promise<T>(() => {}); // never resolves; page is reloading
      }
      if (!isChunkLoadError(err)) throw err;

      // Background prefetch: never reload or crash. Reject quietly so the
      // caller's `.catch` swallows it (PrefetchLink drops it from its set).
      if (silent) throw err;

      // Interactive load still failing after retries → try a guarded reload.
      if (reloadForChunkFailure({ purgeAssetCache: isChunkResponseError(err) })) {
        return new Promise<T>(() => {}); // never resolves; page is reloading
      }
      // Reload budget spent → bubble to <ErrorBoundary> (soft recovery screen).
      throw err;
    });
};

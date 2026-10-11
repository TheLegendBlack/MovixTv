import axios from 'axios';

/**
 * Domaine Frembed résolu depuis une config distante (backup préféré, main sinon).
 * La config est éditable sans redéploiement ; en cas d'échec réseau on retombe
 * sur FALLBACK (backup préféré aussi). getFrembedBase() est synchrone ; attendre
 * initFrembedBase() avant une requête API pour éviter une ancienne redirection CORS.
 */

const CONFIG_URL =
  'https://raw.githubusercontent.com/kingofthrone73-dotcom/frembed-config/main/config.json';

// Fallback hardcodé si le fetch échoue.
const FALLBACK = { main: 'https://frembed.surf', backup: 'https://frembed.surf' };

const pickBase = (cfg: { main?: string; backup?: string }): string =>
  String(cfg.backup || cfg.main || FALLBACK.backup).replace(/\/+$/, '');

let frembedBase = pickBase(FALLBACK);
let initPromise: Promise<string> | null = null;

/** Base URL courante du domaine Frembed, ou domaine de secours avant résolution. */
export function getFrembedBase(): string {
  return frembedBase;
}

/** Récupère la config distante une seule fois et met à jour la base. Idempotent. */
export function initFrembedBase(): Promise<string> {
  if (!initPromise) {
    initPromise = axios
      .get(CONFIG_URL, { timeout: 3000 })
      .then(({ data }) => {
        const cfg = typeof data === 'string' ? JSON.parse(data) : data;
        if (cfg && (cfg.backup || cfg.main)) frembedBase = pickBase(cfg);
        return frembedBase;
      })
      .catch(() => frembedBase); // garde le fallback
  }
  return initPromise;
}

// Amorce le fetch dès l'import du module (fire-and-forget).
initFrembedBase();

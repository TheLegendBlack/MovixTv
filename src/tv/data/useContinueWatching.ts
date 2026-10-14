import { useEffect, useState } from 'react';
import { stillUrl } from './tmdb';

/**
 * Reprise de lecture.
 *
 * **La progression n'est pas redéfinie ici.** Le lecteur écrit déjà sous
 * `progress_<movieId>` et `progress_tv_<id>_s<n>_e<n>`, au format
 * `{ position, duration, timestamp }`, et `watchProgress.ts` lit ces clés pour
 * la fiche. Inventer une clé `movix:tv:progress` à côté aurait créé deux
 * sources de vérité pour la même information — la pire configuration possible,
 * puisqu'elles divergent silencieusement.
 *
 * Ce qui manque n'est pas la progression, c'est de quoi *dessiner une carte* :
 * un titre, une image, un libellé d'épisode. Ces trois champs sont écrits par le
 * lecteur au démarrage de la lecture, dans une clé annexe, via
 * `rememberWatchMeta`. Le lecteur les a déjà sous la main à ce moment-là ; les
 * redemander à TMDB au montage de l'accueil coûterait une douzaine de requêtes
 * concurrentes de celles des rangées, exactement quand la latence de démarrage
 * compte le plus.
 *
 * On stocke `backdropPath` et non une URL complète : le chemin TMDB est stable,
 * la taille demandée ne l'est pas. Une URL `w500` figée dans le stockage local
 * deviendrait fausse au premier changement de gabarit de carte.
 */

export const WATCH_META_KEY = 'movix:tv:watch-meta';
/** Émis quand la progression change hors du lecteur : la rangée se relit. */
export const PROGRESS_CHANGE_EVENT = 'movix-tv-progress';
const MOVIE_KEY = /^progress_(\d+)$/;
const EPISODE_KEY = /^progress_tv_(\d+)_s(\d+)_e(\d+)$/;

const MAX_ENTRIES = 12;
/** Au-delà, le titre est considéré comme terminé. Personne ne reprend un générique. */
const DONE_THRESHOLD = 0.95;
/** En deçà, c'est un titre qu'on a ouvert puis quitté, pas un titre commencé. */
const STARTED_THRESHOLD = 0.02;

export interface ContinueWatchingEntry {
  /** Clé de stockage d'origine. Sert d'identité stable pour React. */
  storageKey: string;
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  stillUrl: string | null;
  /** Entre 0 et 1. */
  progress: number;
  remainingSeconds: number;
  /** « S2:E2 · Brad Fer » pour une série, absent pour un film. */
  episodeLabel?: string;
  updatedAt: number;
}

export interface WatchMeta {
  title: string;
  /** Chemin TMDB brut, par exemple `/abc123.jpg`. Pas une URL. */
  backdropPath?: string | null;
  episodeName?: string;
}

interface StoredProgress {
  position?: number;
  duration?: number;
  /**
   * Le lecteur écrit une chaîne ISO (`new Date().toISOString()`, l. 7087), pas
   * un nombre. `Number()` y renverrait `NaN`, donc `0` pour toutes les entrées,
   * et le tri par récence ne trierait plus rien. On accepte les deux formes :
   * `watchProgress.ts` fait déjà de même pour la fiche.
   */
  timestamp?: string | number;
}

/** Millisecondes depuis l'époque, quelle que soit la forme stockée. */
function parseTimestamp(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** « Il reste 1 h 44 min », « Il reste 49 min ». */
export function remainingLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `Il reste ${minutes} min`;
  return `Il reste ${hours} h ${String(minutes).padStart(2, '0')} min`;
}

export function readWatchMeta(): Record<string, WatchMeta> {
  try {
    const raw = window.localStorage.getItem(WATCH_META_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, WatchMeta>) : {};
  } catch {
    return {};
  }
}

/**
 * À appeler par le lecteur au démarrage de la lecture, avec la clé de
 * progression qu'il utilise déjà. Un seul appel par lecture suffit.
 *
 *   rememberWatchMeta(`progress_tv_${id}_s${season}_e${episode}`, {
 *     title: series.title,
 *     backdropPath: episode.still_path ?? series.backdrop_path,
 *     episodeName: episode.name,
 *   });
 */
export function rememberWatchMeta(storageKey: string, meta: WatchMeta): void {
  try {
    const all = readWatchMeta();
    all[storageKey] = meta;
    window.localStorage.setItem(WATCH_META_KEY, JSON.stringify(all));
  } catch {
    // Stockage plein ou indisponible : la carte perdra son image et son titre,
    // ce qui la fera simplement disparaître de la rangée. Rien ici ne justifie
    // de faire échouer une lecture.
  }
}

function parseKey(
  key: string,
): (Pick<ContinueWatchingEntry, 'id' | 'mediaType'> & {
  season?: number;
  episode?: number;
}) | null {
  const movie = MOVIE_KEY.exec(key);
  if (movie) return { id: Number(movie[1]), mediaType: 'movie' };

  const episode = EPISODE_KEY.exec(key);
  if (episode) {
    return {
      id: Number(episode[1]),
      mediaType: 'tv',
      season: Number(episode[2]),
      episode: Number(episode[3]),
    };
  }
  return null;
}

function read(): ContinueWatchingEntry[] {
  try {
    const meta = readWatchMeta();
    const entries: ContinueWatchingEntry[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith('progress_')) continue;

      const parsed = parseKey(key);
      if (!parsed) continue;

      let stored: StoredProgress;
      try {
        stored = JSON.parse(window.localStorage.getItem(key) ?? '');
      } catch {
        continue;
      }

      const position = Number(stored?.position);
      const duration = Number(stored?.duration);
      if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) continue;

      const progress = position / duration;
      if (progress < STARTED_THRESHOLD || progress > DONE_THRESHOLD) continue;

      // Sans métadonnées, la carte n'a ni titre ni image : on la retire plutôt
      // que d'afficher un rectangle anonyme. Cela concerne les lectures
      // antérieures à `rememberWatchMeta` ; elles disparaissent d'elles-mêmes à
      // la première relecture.
      const entryMeta = meta[key];
      if (!entryMeta?.title) continue;

      const episodeLabel =
        parsed.mediaType === 'tv' && parsed.season !== undefined
          ? `S${parsed.season}:E${parsed.episode}` +
            (entryMeta.episodeName ? ` · ${entryMeta.episodeName}` : '')
          : undefined;

      entries.push({
        storageKey: key,
        id: parsed.id,
        mediaType: parsed.mediaType,
        title: entryMeta.title,
        stillUrl: stillUrl(entryMeta.backdropPath ?? null),
        progress,
        remainingSeconds: duration - position,
        episodeLabel,
        updatedAt: parseTimestamp(stored?.timestamp),
      });
    }

    return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ENTRIES);
  } catch {
    // Stockage indisponible : la rangée disparaît, ce qui est le bon
    // comportement. Rien ici ne justifie de casser l'accueil.
    return [];
  }
}

export function useContinueWatching(): ContinueWatchingEntry[] {
  const [entries, setEntries] = useState<ContinueWatchingEntry[]>([]);

  useEffect(() => {
    setEntries(read());

    // Le lecteur tourne dans la même WebView : en revenant sur l'accueil, la
    // progression a changé sans qu'aucun événement `storage` ne soit émis —
    // `storage` ne se déclenche qu'entre onglets. On relit au retour de
    // visibilité, ce qui couvre aussi la sortie de veille du téléviseur.
    const refresh = () => setEntries(read());
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener(PROGRESS_CHANGE_EVENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PROGRESS_CHANGE_EVENT, refresh);
    };
  }, []);

  return entries;
}

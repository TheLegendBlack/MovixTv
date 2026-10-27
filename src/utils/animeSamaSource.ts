import { getTmdbApiKey } from '@/config/tmdbKey';
import { collectTmdbNames, pickBestAnimeMatch, type AnimeSamaCandidate } from './animeMatcher';
import { generateSearchVariations, getAnimeMatcherForId, getSearchNameForId } from './searchUtils';
import { isMainEntry, locateAnimeSamaEpisode } from './animeSamaMapping';
import { PROGRESS_CHANGE_EVENT, WATCH_META_KEY, readWatchMeta } from '@/tv/data/useContinueWatching';

/**
 * Anime-Sama, source de plus du lecteur de séries pour les animés (15/10/2026).
 *
 * L'API Movix aspire le catalogue d'Anime-Sama (`/anime/search/<titre>`) : par
 * œuvre, ses saisons, ses épisodes et, par épisode, les lecteurs de chaque
 * langue. On retrouve l'œuvre comme le faisait la fiche du site Movix
 * (variantes de recherche et score de `animeMatcher.ts`, repris de l'amont),
 * puis l'épisode par son rang (`animeSamaMapping.ts`).
 *
 * Mesuré le 15/10/2026 sur la page Animés : 34 animés sur 40 trouvés, dont 13
 * sans aucune source par ailleurs (FStream, Wiflix, liens). Les lecteurs
 * jouables sur la TV sont ceux d'ansembed (Vidmoly) : l'extraction locale du
 * userscript les résout, et la résolution serveur VIP n'en résout pas d'autres.
 */

const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_API_KEY = getTmdbApiKey();

const ANIMATION_GENRE = 16;
const ANIME_LANGUAGES = new Set(['ja', 'zh', 'ko']);
const ANIME_COUNTRIES = new Set(['JP', 'CN', 'KR']);
/** Variantes de titre essayées au plus : chaque recherche coûte une requête. */
const MAX_SEARCH_TERMS = 8;

/** Lecteur annoncé sans identifiant : le gabarit vide qu'Anime-Sama publie parfois. */
const EMPTY_PLAYER = [
  /sibnet\.[a-z0-9-]+\/shell\.php\?videoid=$/i,
  /vidmoly\.[a-z0-9-]+\/embed-\.html$/i,
  /sendvid\.[a-z0-9-]+\/embed\/$/i,
  /vk\.[a-z0-9-]+\/video_ext\.php\?oid=&hd=3$/i,
];

interface AnimeSamaLink {
  language?: string;
  players?: unknown[];
}

export interface AnimeSamaSeason {
  name?: string;
  episodes?: Array<{ streaming_links?: AnimeSamaLink[] }>;
}

export interface AnimeSamaAnime extends AnimeSamaCandidate {
  name?: string;
  image?: string;
  seasons?: AnimeSamaSeason[];
}

export interface TmdbShowForAnime {
  id: number;
  name?: string;
  original_name?: string;
  original_language?: string;
  origin_country?: string[];
  genres?: Array<{ id: number }>;
  seasons?: Array<{ season_number: number; episode_count: number }>;
}

export interface AnimeSamaPlayer {
  url: string;
  /** Code Anime-Sama : `vf`, `vostfr`, `vf2`, `va`… */
  language: string;
}

export function isAnimeShow(show: TmdbShowForAnime): boolean {
  if (!show.genres?.some(genre => genre.id === ANIMATION_GENRE)) return false;
  return (
    ANIME_LANGUAGES.has(show.original_language ?? '') ||
    (show.origin_country ?? []).some(country => ANIME_COUNTRIES.has(country))
  );
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { signal });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Titres de l'œuvre : anglais et alternatifs, que la fiche n'a pas chargés. */
async function tmdbTitles(
  showId: number,
  signal?: AbortSignal,
): Promise<{ en: string | null; alternatives: Array<{ iso_3166_1?: string; title?: string }> }> {
  const data = await getJson<{
    alternative_titles?: { results?: Array<{ iso_3166_1?: string; title?: string }> };
    translations?: { translations?: Array<{ iso_639_1?: string; data?: { name?: string } }> };
  }>(
    `https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,translations`,
    signal,
  );
  return {
    en: data?.translations?.translations?.find(entry => entry.iso_639_1 === 'en')?.data?.name || null,
    alternatives: (data?.alternative_titles?.results ?? []).filter(entry =>
      ['FR', 'US', 'GB', 'JP'].includes(entry.iso_3166_1 ?? ''),
    ),
  };
}

async function findAnime(show: TmdbShowForAnime, signal?: AbortSignal): Promise<AnimeSamaAnime | null> {
  const { en, alternatives } = await tmdbTitles(show.id, signal);
  const names = collectTmdbNames(show, en ? { name: en } : null, alternatives);
  const base = getSearchNameForId(show.id, show.name ?? '');
  const terms = [
    ...new Set(
      [base, en, show.original_name, ...alternatives.map(entry => entry.title)]
        .filter((term): term is string => Boolean(term))
        .flatMap(term => generateSearchVariations(term)),
    ),
  ].slice(0, MAX_SEARCH_TERMS);
  const special = getAnimeMatcherForId(show.id);

  for (const term of terms) {
    if (signal?.aborted) return null;
    const results = await getJson<AnimeSamaAnime[]>(
      `${MAIN_API}/anime/search/${encodeURIComponent(term)}?includeSeasons=true&includeEpisodes=true`,
      signal,
    );
    if (!Array.isArray(results) || results.length === 0) continue;
    const match = special
      ? results.find(anime => special({ name: anime.name ?? '', seasons: anime.seasons })) ?? null
      : pickBestAnimeMatch(results, names).match;
    // Contrairement au site, une recherche sans bon candidat n'arrête pas tout :
    // « Pokémon » rend la franchise, une variante plus précise peut rendre la série.
    if (match) return match;
  }
  return null;
}

/**
 * Une œuvre cherchée une fois par session : le catalogue d'une série longue
 * (One Piece, plus de mille épisodes) pèse, et tous ses épisodes s'en servent.
 */
const matches = new Map<number, Promise<AnimeSamaAnime | null>>();

/**
 * L'œuvre Anime-Sama d'une série TMDB, ou `null` (pas un animé, introuvable).
 * Partagée par le lecteur de séries, la fiche (onglet Anime-Sama) et le
 * lecteur Anime-Sama : une seule recherche par œuvre et par session.
 */
export function loadAnimeSamaAnime(show: TmdbShowForAnime, signal?: AbortSignal): Promise<AnimeSamaAnime | null> {
  if (!MAIN_API || !isAnimeShow(show)) return Promise.resolve(null);
  let pending = matches.get(show.id);
  if (!pending) {
    pending = findAnime(show, signal);
    matches.set(show.id, pending);
    // Une recherche interrompue (changement d'épisode) ne doit pas condamner les suivantes.
    pending.then(result => {
      if (!result && signal?.aborted) matches.delete(show.id);
    });
  }
  return pending;
}

/** Lecteurs d'un épisode Anime-Sama (entrée et épisode en base 0), sans les gabarits vides. */
export function animeSamaEpisodePlayers(anime: AnimeSamaAnime, entry: number, index: number): AnimeSamaPlayer[] {
  const links = anime.seasons?.[entry]?.episodes?.[index]?.streaming_links ?? [];
  const seen = new Set<string>();
  const players: AnimeSamaPlayer[] = [];
  for (const link of links) {
    for (const url of link.players ?? []) {
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
      if (EMPTY_PLAYER.some(pattern => pattern.test(url)) || seen.has(url)) continue;
      seen.add(url);
      players.push({ url, language: (link.language ?? '').toLowerCase() });
    }
  }
  return players;
}

/** Langues d'un épisode Anime-Sama, dans l'ordre de la page (`VF`, `VOSTFR`…). */
export function animeSamaEpisodeLanguages(anime: AnimeSamaAnime, entry: number, index: number): string[] {
  return [...new Set(animeSamaEpisodePlayers(anime, entry, index).map(player => animeSamaLanguageLabel(player.language)))];
}

/**
 * Progression d'un épisode lu dans le découpage Anime-Sama (entrée et épisode
 * en base 1). Distincte de `progress_tv_<id>_s<n>_e<n>` : « saison 2,
 * épisode 3 » n'y désigne pas le même épisode que chez TMDB.
 */
export function animeSamaProgressKey(tmdbId: number | string, entry: number, episode: number): string {
  return `progress_as_${tmdbId}_${entry}_${episode}`;
}

/**
 * Position Anime-Sama (indice d'entrée dans `anime.seasons` et d'épisode, base
 * 0) de l'épisode TMDB `season`×`episode`, si la correspondance est sûre.
 */
export function animeSamaPositionOf(
  anime: AnimeSamaAnime,
  show: TmdbShowForAnime,
  season: number,
  episode: number,
): { entry: number; index: number } | null {
  const seasons = anime.seasons ?? [];
  const main = seasons.filter(entry => isMainEntry({ name: entry.name, episodes: entry.episodes?.length ?? 0 }));
  const tmdbSeasons = (show.seasons ?? [])
    .filter(entry => entry.season_number > 0)
    .map(entry => [entry.season_number, entry.episode_count] as [number, number]);
  const position = locateAnimeSamaEpisode(tmdbSeasons, main.map(entry => entry.episodes?.length ?? 0), season, episode);
  return position ? { entry: seasons.indexOf(main[position.entry]), index: position.index } : null;
}

/**
 * Épisode Anime-Sama suivant (base 0) : dans la même entrée, sinon la
 * première entrée de la suite principale qui suit. Un film ou un OAV ne mène
 * nulle part.
 */
export function nextAnimeSamaPosition(anime: AnimeSamaAnime, entry: number, index: number): { entry: number; index: number } | null {
  const seasons = anime.seasons ?? [];
  if (index + 1 < (seasons[entry]?.episodes?.length ?? 0)) return { entry, index: index + 1 };
  if (!isMainEntry({ name: seasons[entry]?.name, episodes: 0 })) return null;
  for (let next = entry + 1; next < seasons.length; next += 1) {
    if (isMainEntry({ name: seasons[next].name, episodes: 0 }) && (seasons[next].episodes?.length ?? 0) > 0) {
      return { entry: next, index: 0 };
    }
  }
  return null;
}

/**
 * Un épisode, une seule progression (15/10/2026). Le même épisode a une clé
 * TMDB et une clé Anime-Sama : le regarder par l'autre chemin créait une
 * seconde carte dans « Reprendre la lecture ». Le lecteur qui s'ouvre fond la
 * clé de l'autre chemin dans la sienne, en gardant la plus récente : on
 * reprend où l'on en était, et l'autre clé disparaît (la synchronisation du
 * compte la retire aussi des autres télés).
 */
export function mergeEpisodeProgress(fromKey: string, toKey: string): void {
  try {
    const from = localStorage.getItem(fromKey);
    if (!from) return;
    const time = (raw: string | null): number => {
      try {
        return Date.parse((JSON.parse(raw ?? '{}') as { timestamp?: string }).timestamp ?? '') || 0;
      } catch {
        return 0;
      }
    };
    const to = localStorage.getItem(toKey);
    if (!to || time(from) > time(to)) localStorage.setItem(toKey, from);
    localStorage.removeItem(fromKey);
    const meta = readWatchMeta();
    if (fromKey in meta) {
      if (!(toKey in meta)) meta[toKey] = meta[fromKey];
      delete meta[fromKey];
      localStorage.setItem(WATCH_META_KEY, JSON.stringify(meta));
    }
    window.dispatchEvent(new Event(PROGRESS_CHANGE_EVENT));
  } catch {
    /* stockage indisponible : les deux clés restent, rien n'est perdu */
  }
}

/**
 * Lecteurs Anime-Sama de l'épisode TMDB `season`×`episode`, toutes langues,
 * ou une liste vide : œuvre qui n'est pas un animé, introuvable, ou dont les
 * saisons ne se correspondent pas sûrement.
 */
export async function findAnimeSamaPlayers(
  show: TmdbShowForAnime,
  season: number,
  episode: number,
  signal?: AbortSignal,
): Promise<AnimeSamaPlayer[]> {
  return (await findAnimeSamaEpisode(show, season, episode, signal))?.players ?? [];
}

/** Comme `findAnimeSamaPlayers`, avec la position Anime-Sama de l'épisode (base 0). */
export async function findAnimeSamaEpisode(
  show: TmdbShowForAnime,
  season: number,
  episode: number,
  signal?: AbortSignal,
): Promise<{ entry: number; index: number; players: AnimeSamaPlayer[] } | null> {
  const anime = await loadAnimeSamaAnime(show, signal);
  if (!anime?.seasons) return null;
  const position = animeSamaPositionOf(anime, show, season, episode);
  return position ? { ...position, players: animeSamaEpisodePlayers(anime, position.entry, position.index) } : null;
}

/** Libellé de langue lu par la passe d'extraction (`VF`, `VOSTFR`). */
export function animeSamaLanguageLabel(language: string): string {
  if (language.startsWith('vostfr')) return 'VOSTFR';
  if (language.startsWith('vf')) return 'VF';
  return language.toUpperCase();
}

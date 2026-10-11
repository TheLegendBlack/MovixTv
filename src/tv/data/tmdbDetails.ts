import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import { posterUrl } from './tmdb';
import { getTmdbApiKey } from '@/config/tmdbKey';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = getTmdbApiKey();

export type TvMediaType = 'movie' | 'tv';

export interface TvSeason {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

export interface TvEpisode {
  episodeNumber: number;
  name: string;
  overview: string;
  stillUrl: string | null;
  /** Minutes. TMDB le renseigne inégalement selon les séries. */
  runtime: number | null;
  /** ISO court, ex. `2023-05-05`. Sert d'indice « pas encore diffusé ». */
  airDate: string | null;
}

/** Une suggestion : juste de quoi peupler une carte et naviguer. */
export interface TvSuggestion {
  id: number;
  mediaType: TvMediaType;
  title: string;
  posterUrl: string | null;
}

export interface TvMediaDetails {
  id: number;
  mediaType: TvMediaType;
  title: string;
  year: string;
  /**
   * Plage d'années d'une série terminée, ex. « 2021 – 2023 ». Vaut `year` pour
   * une série en cours ou un film — Disney+ n'affiche une plage que lorsque la
   * fin est connue, sans quoi on annoncerait une fin qui n'existe pas.
   */
  years: string;
  overview: string;
  backdropUrl: string | null;
  posterUrl: string | null;
  /** Chemin TMDB brut : « Ma liste » le stocke tel quel pour le site. */
  posterPath: string | null;
  /** Titre en image, quand il existe. Voir `pickLogo` pour la sélection. */
  logoUrl: string | null;
  genres: string[];
  /** Déjà formatée pour l'affichage, ex. « 1 h 52 ». Films uniquement. */
  runtime: string | null;
  seasons: TvSeason[];
  seasonCount: number;
  /** Classification française, déjà suffixée : « 12+ », « TP ». */
  certification: string | null;
  /** Clé YouTube. La lecture reste conditionnée à un lecteur capable. */
  trailerKey: string | null;
  /** Cinq têtes d'affiche au maximum, dans l'ordre TMDB. */
  cast: string[];
  creators: string[];
  suggestions: TvSuggestion[];
}

interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average?: number;
}

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official?: boolean;
  iso_639_1?: string;
}

interface TmdbDetailsResponse {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  runtime?: number;
  number_of_seasons?: number;
  genres?: Array<{ id: number; name: string }>;
  created_by?: Array<{ name?: string }>;
  seasons?: Array<{
    season_number: number;
    name?: string;
    episode_count?: number;
  }>;
  images?: { logos?: TmdbImage[] };
  videos?: { results?: TmdbVideo[] };
  credits?: { cast?: Array<{ name?: string }>; crew?: Array<{ name?: string; job?: string }> };
  content_ratings?: { results?: Array<{ iso_3166_1: string; rating?: string }> };
  release_dates?: {
    results?: Array<{
      iso_3166_1: string;
      release_dates?: Array<{ certification?: string }>;
    }>;
  };
  recommendations?: {
    results?: Array<{
      id: number;
      title?: string;
      name?: string;
      poster_path?: string | null;
      media_type?: string;
    }>;
  };
}

function formatRuntime(minutes: number | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

// Le fond d'écran couvre toute la dalle : en 1080p physique, w1280 suffit
// largement une fois l'image assombrie, et évite de décoder un `original`.
const backdropUrl = (path: string | null | undefined): string | null =>
  path ? `https://image.tmdb.org/t/p/w1280${path}` : null;

/** Code à deux lettres, `getTmdbLanguage` renvoyant une forme longue (`fr-FR`). */
const shortLanguage = (): string => getTmdbLanguage().slice(0, 2).toLowerCase();

/**
 * Choix du logo.
 *
 * Deux règles, dans cet ordre. La langue d'abord : un logo français vaut mieux
 * qu'un anglais, et un logo sans langue — un lettrage purement graphique —
 * vaut mieux que rien. Le format ensuite : TMDB sert certains logos en SVG, et
 * les paramètres de taille sont alors ignorés ; les webviews de téléviseur
 * dimensionnent mal un SVG sans dimensions intrinsèques, d'où la préférence
 * pour le PNG à langue égale.
 */
function pickLogo(logos: TmdbImage[] | undefined): string | null {
  if (!logos || logos.length === 0) return null;
  const language = shortLanguage();
  const rank = (logo: TmdbImage): number => {
    const languageRank =
      logo.iso_639_1 === language ? 0 : logo.iso_639_1 === 'en' ? 1 : logo.iso_639_1 ? 3 : 2;
    const formatRank = logo.file_path.endsWith('.svg') ? 1 : 0;
    return languageRank * 2 + formatRank;
  };
  const best = [...logos].sort(
    (a, b) => rank(a) - rank(b) || (b.vote_average ?? 0) - (a.vote_average ?? 0),
  )[0];
  return best ? `https://image.tmdb.org/t/p/w500${best.file_path}` : null;
}

/**
 * Classification, France d'abord.
 *
 * Le suffixe `+` n'est ajouté qu'aux valeurs numériques : « 12 » devient
 * « 12+ » comme chez Disney+, mais « TP » reste « TP ».
 */
function pickCertification(data: TmdbDetailsResponse): string | null {
  const raw =
    data.content_ratings?.results?.find(entry => entry.iso_3166_1 === 'FR')?.rating ||
    data.release_dates?.results
      ?.find(entry => entry.iso_3166_1 === 'FR')
      ?.release_dates?.map(entry => entry.certification)
      .find(value => !!value) ||
    '';
  const value = raw.trim();
  if (!value) return null;
  return /^\d+$/.test(value) ? `${value}+` : value;
}

/** Bande-annonce : officielle et dans la langue de l'interface en priorité. */
function pickTrailer(videos: TmdbVideo[] | undefined): string | null {
  if (!videos || videos.length === 0) return null;
  const language = shortLanguage();
  const candidates = videos.filter(video => video.site === 'YouTube');
  const rank = (video: TmdbVideo): number =>
    (video.type === 'Trailer' ? 0 : video.type === 'Teaser' ? 2 : 4) +
    (video.iso_639_1 === language ? 0 : 1) +
    (video.official ? 0 : 1);
  const best = [...candidates].sort((a, b) => rank(a) - rank(b))[0];
  return best ? best.key : null;
}

export async function fetchMediaDetails(
  mediaType: TvMediaType,
  id: string,
  signal?: AbortSignal,
): Promise<TvMediaDetails> {
  const language = shortLanguage();
  const response = await axios.get<TmdbDetailsResponse>(`${TMDB_BASE}/${mediaType}/${id}`, {
    params: {
      api_key: TMDB_API_KEY,
      language: getTmdbLanguage(),
      // Tout tient dans une requête. `content_ratings` n'existe que pour les
      // séries, `release_dates` que pour les films : demander le mauvais des
      // deux renvoie simplement une clé absente, sans erreur.
      append_to_response: [
        'images',
        'videos',
        'credits',
        'recommendations',
        mediaType === 'tv' ? 'content_ratings' : 'release_dates',
      ].join(','),
      // `null` couvre les logos sans langue déclarée, souvent les meilleurs.
      include_image_language: `${language},en,null`,
      include_video_language: `${language},en`,
    },
    signal,
  });
  const data = response.data;
  const date = data.release_date || data.first_air_date || '';
  const year = date.slice(0, 4);
  const endYear = (data.last_air_date || '').slice(0, 4);
  const ended = data.status === 'Ended' || data.status === 'Canceled';

  const seasons = (data.seasons ?? [])
    // La saison 0 regroupe les hors-séries ; la masquer évite d'ouvrir la page
    // sur des bonus plutôt que sur le premier épisode.
    .filter(season => season.season_number > 0 && (season.episode_count ?? 0) > 0)
    .map(season => ({
      seasonNumber: season.season_number,
      name: season.name || `Saison ${season.season_number}`,
      episodeCount: season.episode_count ?? 0,
    }));

  return {
    id: data.id,
    mediaType,
    title: data.title || data.name || 'Sans titre',
    year,
    years: ended && endYear && endYear !== year ? `${year} – ${endYear}` : year,
    overview: data.overview ?? '',
    backdropUrl: backdropUrl(data.backdrop_path),
    posterUrl: posterUrl(data.poster_path ?? null),
    posterPath: data.poster_path ?? null,
    logoUrl: pickLogo(data.images?.logos),
    genres: (data.genres ?? []).map(genre => genre.name),
    runtime: formatRuntime(data.runtime),
    seasons,
    seasonCount: data.number_of_seasons ?? seasons.length,
    certification: pickCertification(data),
    trailerKey: pickTrailer(data.videos?.results),
    cast: (data.credits?.cast ?? [])
      .map(person => person.name)
      .filter((name): name is string => !!name)
      .slice(0, 5),
    creators: (
      data.created_by?.length
        ? data.created_by.map(person => person.name)
        : (data.credits?.crew ?? [])
            .filter(person => person.job === 'Director')
            .map(person => person.name)
    )
      .filter((name): name is string => !!name)
      .slice(0, 2),
    suggestions: (data.recommendations?.results ?? []).slice(0, 20).map(item => ({
      id: item.id,
      // `media_type` manque quand la recommandation vient d'un endpoint typé.
      mediaType: (item.media_type === 'movie' || item.media_type === 'tv'
        ? item.media_type
        : mediaType) as TvMediaType,
      title: item.title || item.name || 'Sans titre',
      posterUrl: posterUrl(item.poster_path ?? null),
    })),
  };
}

interface TmdbSeasonResponse {
  episodes?: Array<{
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number | null;
    air_date?: string | null;
  }>;
}

export async function fetchSeasonEpisodes(
  tvId: string,
  seasonNumber: number,
  signal?: AbortSignal,
): Promise<TvEpisode[]> {
  const response = await axios.get<TmdbSeasonResponse>(
    `${TMDB_BASE}/tv/${tvId}/season/${seasonNumber}`,
    { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }, signal },
  );

  return (response.data.episodes ?? []).map(episode => ({
    episodeNumber: episode.episode_number,
    name: episode.name || `Épisode ${episode.episode_number}`,
    overview: episode.overview ?? '',
    runtime: episode.runtime && episode.runtime > 0 ? episode.runtime : null,
    airDate: episode.air_date || null,
    // TMDB ne propose que w92, w185, w300 et `original` pour les images
    // d'épisode. La vignette de la liste fait 200 px CSS, soit 400 px physiques
    // à une densité de 2 : w300 en couvre 75 %, ce qui se voit à peine à trois
    // mètres et pèse six fois moins qu'un `original`, dont la largeur dépasse
    // souvent 1900 px. C'était le décodage le plus lourd de l'interface TV.
    stillUrl: episode.still_path
      ? `https://image.tmdb.org/t/p/w300${episode.still_path}`
      : null,
  }));
}

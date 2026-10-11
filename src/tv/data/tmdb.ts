import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import { getTmdbApiKey } from '@/config/tmdbKey';

/**
 * Accès TMDB pour l'interface téléviseur.
 *
 * Trois choix de fond.
 *
 * 1. Le chargement est **étagé**. `Promise.allSettled` sur l'ensemble des
 *    rangées faisait dépendre le premier pixel de la requête la plus lente :
 *    l'écran restait sur « Chargement du catalogue… » tant que la huitième
 *    n'était pas revenue. Les rangées remontent maintenant une par une, et la
 *    seconde vague ne part qu'une fois la première affichée.
 *
 * 2. Les rangées sont dédoublonnées dans l'ordre d'affichage. Sans ça,
 *    « Tendances du jour », « Films populaires » et « Action » servent les mêmes
 *    six titres, et le catalogue paraît trois fois plus petit qu'il n'est.
 *
 * 3. `ROWS` est un **registre**, pas un ordre. Chaque page — accueil, films,
 *    bientôt séries — porte sa propre liste ordonnée d'identifiants. Une spec
 *    partagée entre deux pages (l'action indienne, les films récents) reste
 *    une seule collection derrière « Voir plus », et son identifiant dans
 *    l'URL de collection ne dépend pas de la page qui y mène.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = getTmdbApiKey();

/**
 * Tailles d'image, calées sur le viewport CSS 960 à densité 2.
 *
 * `poster` : carte de 148 px CSS → 296 px physiques, `w342` suffit.
 * `still`  : carte de 208 px CSS → 416 px physiques, `w500` suffit.
 * `hero`   : bannière plein cadre, 960 px CSS → 1920 px physiques. `w1280`
 *            imposait un agrandissement de 1,5× — c'est ce qui avait conduit à
 *            caler l'image à droite à son format natif, et donc à la coupure
 *            verticale au milieu de l'écran. `original` règle le problème à la
 *            source ; on n'en décode qu'une à la fois.
 */
const POSTER_SIZE = 'w342';
const STILL_SIZE = 'w500';
const HERO_SIZE = 'original';

export const hasTmdbKey = (): boolean => TMDB_API_KEY.length > 0;

export interface TvMediaItem {
  id: number;
  title: string;
  year: string;
  posterUrl: string | null;
  /** Format paysage, taille catalogue. Reprise de lecture, fiches. */
  stillUrl: string | null;
  /** Format paysage pleine résolution. Réservé à la bannière. */
  heroUrl: string | null;
  /** Conservé pour les écrans qui l'utilisaient déjà. */
  backdropUrl: string | null;
  overview: string;
  genreIds: number[];
  mediaType: 'movie' | 'tv';
}

/**
 * Gabarit de carte demandé par une rangée.
 *
 * Une chaîne, et non le type exporté par `TvRow` : les données ne dépendent
 * pas des composants. `rank` est l'affiche précédée de son numéro de
 * classement — réservé aux rangées qui *sont* un classement.
 */
export type TvRowLayoutName = 'poster' | 'still' | 'rank';

export interface TvRowData {
  id: string;
  title: string;
  items: TvMediaItem[];
  layout?: TvRowLayoutName;
  /** Vrai si la rangée est adossée à une collection paginable — carte « Voir plus ». */
  collection?: boolean;
}

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  genre_ids?: number[];
}

const image = (path: string | null | undefined, size: string): string | null =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

export function posterUrl(path: string | null): string | null {
  return image(path, POSTER_SIZE);
}

export function stillUrl(path: string | null): string | null {
  return image(path, STILL_SIZE);
}

function toMediaItem(result: TmdbResult, fallbackType: 'movie' | 'tv'): TvMediaItem | null {
  if (!result.poster_path) return null;
  const date = result.release_date || result.first_air_date || '';
  const mediaType =
    result.media_type === 'movie' || result.media_type === 'tv'
      ? result.media_type
      : fallbackType;

  return {
    id: result.id,
    title: result.title || result.name || 'Sans titre',
    year: date.slice(0, 4),
    posterUrl: image(result.poster_path, POSTER_SIZE),
    stillUrl: image(result.backdrop_path, STILL_SIZE),
    heroUrl: image(result.backdrop_path, HERO_SIZE),
    backdropUrl: image(result.backdrop_path, 'w1280'),
    genreIds: result.genre_ids ?? [],
    overview: result.overview ?? '',
    mediaType,
  };
}

/** Genres TMDB utiles à l'affichage. Sous-ensemble : on n'en montre qu'un. */
const GENRE_LABELS: Record<number, string> = {
  28: 'Action',
  12: 'Aventure',
  16: 'Animation',
  35: 'Comédie',
  80: 'Policier',
  99: 'Documentaire',
  18: 'Drame',
  14: 'Fantastique',
  27: 'Horreur',
  9648: 'Mystère',
  10749: 'Romance',
  878: 'Science-fiction',
  53: 'Thriller',
  10759: 'Action et aventure',
  10765: 'Science-fiction et fantastique',
  10751: 'Famille',
  10762: 'Jeunesse',
  10764: 'Téléréalité',
  10768: 'Guerre et politique',
  10752: 'Guerre',
  36: 'Histoire',
  37: 'Western',
  10402: 'Musique',
};

/** Ligne révélée sous la carte focalisée. Un genre suffit : la place est comptée. */
export function metaLine(item: TvMediaItem): string {
  const genre = item.genreIds.map(id => GENRE_LABELS[id]).find(Boolean);
  return [item.year, genre].filter(Boolean).join(' · ');
}

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Pays de production retenus pour « africain ». Une seule liste pour les
 * films et les séries : deux listes finiraient par diverger, et « Films
 * d'action africains » ne couvrirait plus les mêmes pays que « Séries
 * africaines ».
 */
const AFRICAN_COUNTRIES = 'NG|ZA|GH|KE|EG|MA|DZ|TN|SN|CI|CM|ET|UG|TZ|RW|CD';

interface RowSpec {
  id: string;
  title: string;
  path: string;
  fallbackType: 'movie' | 'tv';
  /** 1 = affiché au premier écran, 2 = chargé après le premier rendu. */
  tier: 1 | 2;
  /**
   * Ouvre une page de collection paginée, et fait apparaître la carte
   * « Voir plus » en fin de rangée.
   *
   * Volontairement absent des instantanés — tendances, sélection, Top 10 —
   * qui n'ont aucune profondeur derrière, et des rangées génériques de fin de
   * page, qui *sont* déjà le fourre-tout. Une carte présente partout ne
   * signale plus rien ; réservée aux rangées qui portent une vraie collection,
   * elle devient une information.
   */
  collection?: boolean;
  params?: Record<string, string | number>;
  /** Gabarit de carte. Par défaut, l'affiche. */
  layout?: TvRowLayoutName;
  /** Tronque la rangée à ce nombre de titres. Un Top 10 qui en montre vingt n'est plus un Top 10. */
  limit?: number;
  /**
   * `false` exempte la rangée du dédoublonnage.
   *
   * Nécessaire à un classement : retirer le n° 3 parce qu'il figure dans la
   * sélection juste au-dessus décalerait tous les rangs suivants, et le
   * numéro affiché ne voudrait plus rien dire. Les titres de la rangée sont
   * néanmoins enregistrés comme vus, pour les rangées qui suivent.
   */
  dedupe?: boolean;
}

/**
 * Registre des rangées. L'ordre ici n'a pas d'importance ; ce sont les listes
 * `TV_HOME_ROWS` et `TV_MOVIE_ROWS` plus bas qui font l'affichage.
 *
 * Le classement des pages n'est pas décoratif. Nollywood, les séries
 * coréennes et les animés sont ce qui distingue la plateforme ; les mettre en
 * douzième position revient à ne pas les avoir, puisque personne ne descend
 * aussi loin à la télécommande. Les rangées génériques — populaires, mieux
 * notés — ferment la marche : elles servent à ce que la page ne s'arrête
 * jamais, pas à convaincre.
 *
 * Trois paramètres méritent un mot :
 *
 * - `with_origin_country` filtre sur le pays de production, là où
 *   `with_original_language` filtre sur la langue. Pour le Nigéria c'est
 *   décisif : une large part de Nollywood est tournée en anglais, et un filtre
 *   par langue la manquerait entièrement. Si ce paramètre venait à ne rien
 *   renvoyer sur votre clé, le repli est `with_original_language=yo|ig|ha`,
 *   moins complet mais sûr. La barre verticale vaut « ou » pour TMDB.
 *
 * - `vote_count.gte` écarte les fiches sans aucun vote. Sur les catalogues de
 *   niche, `discover` remonte sinon des entrées vides ou en double, avec des
 *   affiches de mauvaise qualité — exactement ce qu'on ne veut pas dans les
 *   rangées qui portent l'identité de la plateforme. Le seuil descend à 3 sur
 *   les catalogues africains, où un seuil à 15 ne laisserait presque rien.
 *
 * - `with_genres=28|12|53` (action, aventure, thriller) sur le Nigéria et
 *   l'Afrique, là où la Corée et l'Inde se contentent de l'action seule : le
 *   genre est renseigné de façon inégale sur Nollywood, et une rangée
 *   « action » stricte y tombait sous la dizaine de titres.
 */
const ROWS: RowSpec[] = [
  /* ---------------------------------------------------------------- *
   * Accueil
   * ---------------------------------------------------------------- */
  {
    id: 'tendances',
    title: 'Tendances du jour',
    path: '/trending/all/day',
    fallbackType: 'movie',
    tier: 1,
  },
  {
    id: 'nollywood',
    collection: true,
    title: 'Nollywood, le meilleur du Nigéria',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 1,
    params: {
      with_origin_country: 'NG',
      sort_by: 'popularity.desc',
      'vote_count.gte': 3,
    },
  },
  {
    id: 'k-series',
    collection: true,
    title: 'Séoul à l’écran',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 1,
    params: {
      with_original_language: 'ko',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    id: 'animes',
    collection: true,
    title: 'Animés',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 1,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    // Partagée entre l'accueil et la page Films : même identifiant, même
    // collection derrière « Voir plus ».
    id: 'action-inde',
    collection: true,
    title: 'Films d’action indiens',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: {
      with_origin_country: 'IN',
      with_genres: '28',
      sort_by: 'popularity.desc',
      'vote_count.gte': 15,
    },
  },
  {
    // L'Inde est volontairement absente de cette liste : elle a sa rangée juste
    // au-dessus, et deux rangées partageant 60 % de leurs titres donnent
    // l'impression d'un catalogue vide plutôt que d'un catalogue large.
    id: 'action-asie',
    collection: true,
    title: 'Action asiatique',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: {
      with_origin_country: 'KR|JP|CN|HK|TW|TH|ID|VN',
      with_genres: '28',
      sort_by: 'popularity.desc',
      'vote_count.gte': 15,
    },
  },
  {
    id: 'films-recents',
    collection: true,
    title: 'Films récents',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: {
      'primary_release_date.gte': daysAgo(120),
      'primary_release_date.lte': today(),
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    id: 'series-recentes',
    collection: true,
    title: 'Séries récentes',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      'first_air_date.gte': daysAgo(180),
      'first_air_date.lte': today(),
      sort_by: 'popularity.desc',
      'vote_count.gte': 10,
    },
  },
  {
    id: 'films',
    title: 'Films populaires',
    path: '/movie/popular',
    fallbackType: 'movie',
    tier: 2,
  },
  {
    id: 'series',
    title: 'Séries populaires',
    path: '/tv/popular',
    fallbackType: 'tv',
    tier: 2,
  },
  {
    id: 'top-films',
    title: 'Films les mieux notés',
    path: '/movie/top_rated',
    fallbackType: 'movie',
    tier: 2,
  },

  /* ---------------------------------------------------------------- *
   * Films
   * ---------------------------------------------------------------- */
  {
    // Alimente aussi la bannière de la page Films : cinq diapositives en
    // tête, la rangée reprend à la sixième. Voir `TvBrowse`.
    id: 'films-selection',
    title: 'Notre sélection du jour',
    path: '/trending/movie/week',
    fallbackType: 'movie',
    tier: 1,
  },
  {
    // Le classement de TMDB est mondial, pas français : le titre ne promet
    // donc pas « en France ». Il recoupe la sélection au-dessus, comme le
    // Top 10 de Netflix recoupe sa propre sélection — c'est le prix de
    // rangs qui restent vrais.
    id: 'films-top10',
    title: 'Top 10 des films aujourd’hui',
    path: '/trending/movie/day',
    fallbackType: 'movie',
    tier: 1,
    layout: 'rank',
    limit: 10,
    dedupe: false,
  },
  {
    id: 'action-coree',
    collection: true,
    title: 'Films d’action coréens',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 1,
    params: {
      with_origin_country: 'KR',
      with_genres: '28',
      sort_by: 'popularity.desc',
      'vote_count.gte': 15,
    },
  },
  {
    id: 'action-nigeria',
    collection: true,
    title: 'Films d’action nigérians',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 1,
    params: {
      with_origin_country: 'NG',
      with_genres: '28|12|53',
      sort_by: 'popularity.desc',
      'vote_count.gte': 3,
    },
  },
  {
    // Le Nigéria est dans la liste, mais sa rangée passe avant : le
    // dédoublonnage retire d'ici ce qu'elle a déjà montré, tant qu'il en
    // reste assez. Pas besoin d'exclure le pays côté requête.
    id: 'action-afrique',
    collection: true,
    title: 'Films d’action africains',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: {
      with_origin_country: AFRICAN_COUNTRIES,
      with_genres: '28|12|53',
      sort_by: 'popularity.desc',
      'vote_count.gte': 3,
    },
  },
  {
    id: 'comedies',
    collection: true,
    title: 'Comédies',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '35', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'thrillers',
    collection: true,
    title: 'Thrillers',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '53', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'science-fiction',
    collection: true,
    title: 'Science-fiction',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '878', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'animation',
    collection: true,
    title: 'Animation',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '16', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'horreur',
    collection: true,
    title: 'Horreur',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '27', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'drames',
    collection: true,
    title: 'Drames',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '18', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'documentaires',
    collection: true,
    title: 'Documentaires',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '99', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
  },
  {
    id: 'films-francais',
    collection: true,
    title: 'Films français',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_origin_country: 'FR', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
  },
  {
    // C'est l'ancienne grille « Films », un « Voir plus » plus loin : la
    // même requête, dans la page de collection.
    id: 'catalogue-films',
    collection: true,
    title: 'Tout le catalogue',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { sort_by: 'popularity.desc' },
  },

  /* ---------------------------------------------------------------- *
   * Séries
   *
   * Les genres télé de TMDB ne sont pas ceux des films : pas d'« Action »
   * (28) mais « Action et aventure » (10759), et Policier 80, Science-fiction
   * et fantastique 10765. Les rangées par pays n'ont pas de genre : filtrer
   * les séries nigérianes ou africaines sur un genre les viderait, TMDB
   * renseignant peu ces fiches.
   * ---------------------------------------------------------------- */
  {
    // Alimente la bannière de la page Séries, comme `films-selection` celle
    // des films.
    id: 'series-selection',
    title: 'Notre sélection du jour',
    path: '/trending/tv/week',
    fallbackType: 'tv',
    tier: 1,
  },
  {
    id: 'series-top10',
    title: 'Top 10 des séries aujourd’hui',
    path: '/trending/tv/day',
    fallbackType: 'tv',
    tier: 1,
    layout: 'rank',
    limit: 10,
    dedupe: false,
  },
  {
    id: 'series-nigeria',
    collection: true,
    title: 'Séries nigérianes',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 1,
    params: {
      with_origin_country: 'NG',
      sort_by: 'popularity.desc',
      'vote_count.gte': 3,
    },
  },
  {
    id: 'series-inde',
    collection: true,
    title: 'Séries indiennes',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_origin_country: 'IN',
      sort_by: 'popularity.desc',
      'vote_count.gte': 10,
    },
  },
  {
    // Même logique que les films : le Nigéria passe avant, le dédoublonnage
    // retire d'ici ce qu'il a déjà montré.
    id: 'series-afrique',
    collection: true,
    title: 'Séries africaines',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_origin_country: AFRICAN_COUNTRIES,
      sort_by: 'popularity.desc',
      'vote_count.gte': 3,
    },
  },
  {
    id: 'top-series',
    title: 'Séries les mieux notées',
    path: '/tv/top_rated',
    fallbackType: 'tv',
    tier: 2,
  },
  {
    id: 'series-action',
    collection: true,
    title: 'Action et aventure',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '10759', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-policier',
    collection: true,
    title: 'Policier',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '80', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-sf-fantastique',
    collection: true,
    title: 'Science-fiction et fantastique',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '10765', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-comedies',
    collection: true,
    title: 'Comédies',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '35', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-drames',
    collection: true,
    title: 'Drames',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '18', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-documentaires',
    collection: true,
    title: 'Documentaires',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '99', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
  },
  {
    id: 'series-francaises',
    collection: true,
    title: 'Séries françaises',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_origin_country: 'FR', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
  },
  {
    // L'ancienne grille « Séries », un « Voir plus » plus loin.
    id: 'catalogue-series',
    collection: true,
    title: 'Tout le catalogue',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { sort_by: 'popularity.desc' },
  },

  /* ---------------------------------------------------------------- *
   * Animés
   *
   * Japonais par défaut : genre 16 et langue originale `ja`, comme la rangée
   * `animes` de l'accueil. Le donghua et l'animation coréenne ont chacun
   * leur rangée, par langue.
   *
   * Il n'existe pas de `trending` filtré sur l'animation : la sélection et le
   * Top 10 ne peuvent pas venir des tendances comme sur Films et Séries. La
   * bannière prend donc ce qui se diffuse en ce moment, et le Top 10 se base
   * sur la note — avec un plancher de 500 votes, c'est le classement que les
   * amateurs connaissent, et il ne recoupe pas la popularité du moment.
   *
   * `with_genres=16,10759` : la virgule vaut « et » pour TMDB, là où la barre
   * verticale vaut « ou ». Les rangées par genre restent donc dans
   * l'animation.
   * ---------------------------------------------------------------- */
  {
    // Alimente la bannière : ce qui se diffuse cette saison. `air_date`
    // filtre sur la date des épisodes, donc une série de 1999 encore en cours
    // y figure — c'est voulu.
    id: 'animes-en-cours',
    collection: true,
    title: 'Diffusion en cours',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 1,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      'air_date.gte': daysAgo(30),
      'air_date.lte': today(),
      sort_by: 'popularity.desc',
      'vote_count.gte': 5,
    },
  },
  {
    id: 'animes-top10',
    title: 'Top 10 des animés les mieux notés',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 1,
    layout: 'rank',
    limit: 10,
    dedupe: false,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'vote_average.desc',
      'vote_count.gte': 500,
    },
  },
  {
    // `first_air_date`, cette fois : les séries nées dans l'année, pas les
    // nouvelles saisons d'anciennes séries — c'est la rangée du dessus.
    id: 'animes-nouveaux',
    collection: true,
    title: 'Nouveaux animés',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 1,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      'first_air_date.gte': daysAgo(365),
      'first_air_date.lte': today(),
      sort_by: 'popularity.desc',
      'vote_count.gte': 5,
    },
  },
  {
    id: 'animes-films',
    collection: true,
    title: 'Films d’animation japonais',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 1,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 50,
    },
  },
  {
    // Seuil bas : le donghua est peu voté sur TMDB, et un seuil à 20 ne
    // laisserait que trois titres.
    id: 'donghua',
    collection: true,
    title: 'Donghua, l’animation chinoise',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16',
      with_original_language: 'zh',
      sort_by: 'popularity.desc',
      'vote_count.gte': 5,
    },
  },
  {
    id: 'animation-coreenne',
    collection: true,
    title: 'L’animation coréenne',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16',
      with_original_language: 'ko',
      sort_by: 'popularity.desc',
      'vote_count.gte': 5,
    },
  },
  {
    id: 'animes-classiques',
    collection: true,
    title: 'Les classiques',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      'first_air_date.lte': '2009-12-31',
      sort_by: 'popularity.desc',
      'vote_count.gte': 100,
    },
  },
  {
    id: 'animes-action',
    collection: true,
    title: 'Action et aventure',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16,10759',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    id: 'animes-sf-fantastique',
    collection: true,
    title: 'Science-fiction et fantastique',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16,10765',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    // 10342 est l'identifiant TMDB du Studio Ghibli. Filmographie courte,
    // une vingtaine de titres : la collection existe pour les cinq qui ne
    // tiennent pas dans la première page.
    id: 'ghibli',
    collection: true,
    title: 'Studio Ghibli',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: {
      with_companies: 10342,
      sort_by: 'popularity.desc',
    },
  },
  {
    // TMDB n'a pas de genre « hentai » : c'est le mot-clé 198385 qui le porte,
    // et ces fiches sont marquées adultes. `include_adult` est forcé à faux
    // dans `fetchSpecPage`, mais les `params` d'une spec passent après et le
    // surchargent — sans quoi la requête ne renvoie que dix titres, contre
    // près de mille avec (mesuré le 14/09/2026). Seuil de votes à 1 : les
    // fiches ici sont peu votées, et une affiche manquante est déjà écartée.
    id: 'hentai',
    collection: true,
    title: 'Hentai',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_keywords: 198385,
      with_genres: '16',
      with_original_language: 'ja',
      include_adult: 'true',
      sort_by: 'popularity.desc',
      'vote_count.gte': 1,
    },
  },
  {
    id: 'animes-comedies',
    collection: true,
    title: 'Comédies',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16,35',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    id: 'animes-drames',
    collection: true,
    title: 'Drames',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16,18',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    id: 'animes-mystere',
    collection: true,
    title: 'Mystère',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16,9648',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    id: 'animes-jeunesse',
    collection: true,
    title: 'Jeunesse',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16,10762',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
  {
    // Même requête que la rangée `animes` de l'accueil, sous le titre que
    // cette page attend en fin de parcours.
    id: 'catalogue-animes',
    collection: true,
    title: 'Tout le catalogue',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: {
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      'vote_count.gte': 20,
    },
  },
];

/** Accueil, dans l'ordre d'affichage. */
export const TV_HOME_ROWS: readonly string[] = [
  'tendances',
  'nollywood',
  'k-series',
  'animes',
  'action-inde',
  'action-asie',
  'films-recents',
  'series-recentes',
  'films',
  'series',
  'top-films',
];

/**
 * Page Films, dans l'ordre d'affichage.
 *
 * Les quatre rangées d'action par région tiennent dans les dix premières :
 * c'est là que la page se distingue. La première alimente aussi la bannière.
 */
export const TV_MOVIE_ROWS: readonly string[] = [
  'films-selection',
  'films-top10',
  'action-coree',
  'action-nigeria',
  'action-inde',
  'action-afrique',
  'films-recents',
  'top-films',
  'comedies',
  'thrillers',
  'science-fiction',
  'animation',
  'horreur',
  'drames',
  'documentaires',
  'films-francais',
  'films',
  'catalogue-films',
];

/**
 * Page Séries, dans l'ordre d'affichage.
 *
 * Même construction que les films : sélection, Top 10, puis les rangées
 * régionales dans les dix premières. Pas d'animés ici : ils ont leur propre
 * entrée de menu à venir, et une rangée en douzième position ne ferait que
 * doublonner cette page.
 */
export const TV_SERIES_ROWS: readonly string[] = [
  'series-selection',
  'series-top10',
  'k-series',
  'series-nigeria',
  'series-inde',
  'series-afrique',
  'top-series',
  'series-recentes',
  'series-action',
  'series-policier',
  'series-sf-fantastique',
  'series-comedies',
  'series-drames',
  'series-documentaires',
  'series-francaises',
  'series',
  'catalogue-series',
];

/**
 * Page Animés, dans l'ordre d'affichage.
 *
 * La saison en cours ouvre la page et nourrit la bannière ; le classement,
 * les nouveautés et les films suivent dans la première vague. Les rangées
 * par pays et par genre viennent ensuite, le catalogue complet ferme.
 */
export const TV_ANIME_ROWS: readonly string[] = [
  'animes-en-cours',
  'animes-top10',
  'animes-nouveaux',
  'animes-films',
  'donghua',
  'animation-coreenne',
  'animes-classiques',
  'animes-action',
  'animes-sf-fantastique',
  'ghibli',
  'hentai',
  'animes-comedies',
  'animes-drames',
  'animes-mystere',
  'animes-jeunesse',
  'catalogue-animes',
];

/** @deprecated Ordre de l'accueil. Préférez `TV_HOME_ROWS`. */
export const TV_ROW_ORDER: string[] = [...TV_HOME_ROWS];

interface RawPage {
  items: TvMediaItem[];
  totalPages: number;
}

async function fetchSpecPage(
  spec: RowSpec,
  page: number,
  signal?: AbortSignal,
): Promise<RawPage> {
  const response = await axios.get<{ results?: TmdbResult[]; total_pages?: number }>(
    `${TMDB_BASE}${spec.path}`,
    {
      params: {
        api_key: TMDB_API_KEY,
        language: getTmdbLanguage(),
        include_adult: false,
        page,
        ...spec.params,
      },
      signal,
    },
  );

  const items = (response.data.results ?? [])
    .map(result => toMediaItem(result, spec.fallbackType))
    .filter((item): item is TvMediaItem => item !== null);

  return { items, totalPages: response.data.total_pages ?? 1 };
}

async function fetchRow(spec: RowSpec, signal?: AbortSignal): Promise<TvRowData> {
  const { items } = await fetchSpecPage(spec, 1, signal);
  return {
    id: spec.id,
    title: spec.title,
    items: spec.limit !== undefined ? items.slice(0, spec.limit) : items,
    layout: spec.layout,
    collection: spec.collection,
  };
}

/**
 * Registre complet, pour l'éditeur de rangées de la personnalisation.
 *
 * `kind` sert à distinguer à l'écran deux rangées de même titre — « Comédies »
 * existe pour les films, les séries et les animés.
 */
export function listRowSpecs(): { id: string; title: string; kind: string }[] {
  return ROWS.map(row => {
    const genres = String(row.params?.with_genres ?? '');
    const kind = /(^|[,|])16([,|]|$)/.test(genres) && row.params?.with_original_language === 'ja'
      ? 'Animés'
      : row.path.includes('/movie')
        ? 'Films'
        : row.path.includes('/tv')
          ? 'Séries'
          : 'Films et séries';
    return { id: row.id, title: row.title, kind };
  });
}

/** Métadonnées d'une rangée, pour la page de collection. */
export function getRowSpec(
  id: string,
): { id: string; title: string; collection: boolean } | null {
  const spec = ROWS.find(row => row.id === id);
  return spec
    ? { id: spec.id, title: spec.title, collection: spec.collection === true }
    : null;
}

/**
 * Une page de la collection derrière une rangée.
 *
 * C'est **la même requête** que celle de la rangée, paginée. Redéfinir des
 * critères pour la page de collection garantirait qu'elle finisse par diverger
 * de la rangée qui y mène — l'utilisateur cliquerait « Voir plus » et verrait
 * autre chose.
 */
export async function fetchRowPage(
  rowId: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ title: string; items: TvMediaItem[]; totalPages: number }> {
  const spec = ROWS.find(row => row.id === rowId);
  if (!spec) throw new Error(`Rangée inconnue : ${rowId}`);
  const { items, totalPages } = await fetchSpecPage(spec, page, signal);
  return { title: spec.title, items, totalPages };
}

const keyOf = (item: TvMediaItem): string => `${item.mediaType}:${item.id}`;

/**
 * Retire les titres déjà vus plus haut dans la page — mais seulement si la
 * rangée y survit. Une rangée de niche vidée par le dédoublonnage vaut moins
 * qu'une rangée qui répète deux titres.
 *
 * `enabled` à faux garde la rangée intacte mais enregistre tout de même ses
 * titres : c'est le cas du Top 10, voir `RowSpec.dedupe`.
 */
function dedupe(items: TvMediaItem[], seen: Set<string>, enabled = true): TvMediaItem[] {
  const kept = enabled ? items.filter(item => !seen.has(keyOf(item))) : items;
  const result = kept.length >= 8 ? kept : items;
  result.forEach(item => seen.add(keyOf(item)));
  return result;
}

/**
 * En dessous, la rangée n'est pas publiée.
 *
 * Un en-tête au-dessus de trois affiches se lit comme un catalogue en panne,
 * pas comme une niche. Le seuil s'applique après dédoublonnage — qui, lui,
 * n'ampute jamais une rangée sous huit titres — donc il ne touche que les
 * rangées maigres à la source : typiquement un filtre par pays et par genre
 * que TMDB couvre mal.
 */
const MIN_ROW_ITEMS = 6;

export interface LoadOptions {
  signal?: AbortSignal;
  /** Appelé dès qu'une rangée est prête, dans l'ordre où elle revient. */
  onRow: (row: TvRowData) => void;
}

/**
 * Charge les rangées d'une page en deux vagues.
 *
 * Le dédoublonnage impose un ordre : on ne peut pas savoir si un titre est un
 * doublon avant d'avoir vu les rangées qui le précèdent. Chaque vague est donc
 * lancée en parallèle mais consommée dans l'ordre d'affichage — les requêtes ne
 * s'attendent pas, seule la publication est séquencée.
 */
export async function loadTvRows(
  ids: readonly string[],
  { signal, onRow }: LoadOptions,
): Promise<void> {
  const specs = ids
    .map(id => {
      const spec = ROWS.find(row => row.id === id);
      // Une faute de frappe dans une liste de page ferait disparaître la
      // rangée sans un mot : autant le dire.
      if (!spec) console.warn(`[tmdb] Rangée inconnue dans une liste de page : ${id}`);
      return spec;
    })
    .filter((spec): spec is RowSpec => spec !== undefined);

  const seen = new Set<string>();

  const runTier = async (tier: 1 | 2) => {
    const inFlight = specs
      .filter(spec => spec.tier === tier)
      .map(spec =>
        fetchRow(spec, signal)
          .then(row => ({ spec, row }))
          .catch(() => null),
      );

    for (const pending of inFlight) {
      const result = await pending;
      if (signal?.aborted) return;
      if (!result || result.row.items.length === 0) continue;
      const items = dedupe(result.row.items, seen, result.spec.dedupe !== false);
      if (items.length < MIN_ROW_ITEMS) continue;
      onRow({ ...result.row, items });
    }
  };

  await runTier(1);
  if (signal?.aborted) return;
  await runTier(2);
}

/** Rangées de l'accueil. Équivaut à `loadTvRows(TV_HOME_ROWS, options)`. */
export function loadTvHomeRows(options: LoadOptions): Promise<void> {
  return loadTvRows(TV_HOME_ROWS, options);
}

/**
 * Ancienne interface, conservée pour les appelants qui l'importent encore.
 * Attend l'intégralité des rangées ; préférez `loadTvRows` sur les pages.
 */
export async function fetchTvHomeRows(signal?: AbortSignal): Promise<TvRowData[]> {
  const rows: TvRowData[] = [];
  await loadTvHomeRows({ signal, onRow: row => rows.push(row) });
  return rows;
}

/**
 * Recherche multi (films + séries).
 *
 * `search/multi` renvoie aussi des personnes : on les écarte, une fiche
 * d'acteur n'ayant rien à lire. Les entrées sans affiche sont retirées comme
 * ailleurs — une carte vide n'aide personne à choisir.
 */
export async function searchTvMedia(
  query: string,
  signal?: AbortSignal,
): Promise<TvMediaItem[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const response = await axios.get<{ results?: TmdbResult[] }>(
    `${TMDB_BASE}/search/multi`,
    {
      params: {
        api_key: TMDB_API_KEY,
        language: getTmdbLanguage(),
        query: trimmed,
        include_adult: false,
      },
      signal,
    },
  );

  return (response.data.results ?? [])
    .filter(result => result.media_type === 'movie' || result.media_type === 'tv')
    .map(result => toMediaItem(result, 'movie'))
    .filter((item): item is TvMediaItem => item !== null);
}

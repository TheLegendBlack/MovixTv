/**
 * Registre des rangées TMDB et ordre des rangées de chaque page.
 *
 * Module pur, sans import : l'interface TV le lit par `tmdb.ts` (qui charge
 * les rangées), le site de personnalisation l'importe directement pour ses
 * éditeurs et son aperçu, sans emporter axios ni les traductions.
 *
 * Deux sortes de rangées : celles du registre (`ROWS`), écrites ici, et
 * celles qu'une édition déclare par `registerCustomRows`
 * (`CustomRowDefinition`) ; `findRowSpec` les résout toutes.
 */

export type TvRowLayoutName = 'poster' | 'still' | 'rank';

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

/**
 * Rangée déclarée par une édition : une requête `discover` de TMDB, déjà
 * validée, et un titre. La télé ne fait que rejouer la requête, avec sa clé TMDB.
 */
export interface CustomRowDefinition {
  /** `rangee-…` (voir `CUSTOM_ROW_PREFIX`). */
  id: string;
  title: string;
  media: 'movie' | 'tv';
  /** Filtres de `/discover/movie` ou `/discover/tv`, déjà validés. */
  params: Record<string, string | number>;
  /**
   * « Récents » : la date de sortie minimale est recalculée à chaque
   * chargement, ce nombre de jours avant aujourd'hui. Une date fixe vieillirait.
   */
  recentDays?: number;
  /** Phrase d'origine de la rangée, si elle en a une. */
  prompt?: string;
  /**
   * Pages où la rangée est proposée, choisies à la création (`home`,
   * `movies`, `series`, `animes`). Absent : toutes les pages compatibles avec
   * son type (voir `customRowPages`).
   */
  pages?: readonly string[];
}

export const CUSTOM_ROW_PREFIX = 'rangee-';
export const isCustomRowId = (id: string): boolean => id.startsWith(CUSTOM_ROW_PREFIX);

export interface RowSpec {
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
 * `TV_HOME_ROWS`, `TV_MOVIE_ROWS`… plus bas qui font l'affichage.
 *
 * Les pages proposent les rangées classiques de toute plateforme de streaming
 * (tendances, nouveautés, populaires, mieux notés, grands genres). Les
 * rangées régionales et thématiques — Nollywood, l'Inde, l'Afrique, la Corée,
 * Ghibli… — restent au registre, prêtes, mais n'entrent dans aucune page.
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
export const ROWS: RowSpec[] = [
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
    // Les grands genres sans filtre de pays : ceux de toutes les plateformes.
    id: 'action',
    collection: true,
    title: 'Films d’action',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 1,
    params: { with_genres: '28', sort_by: 'popularity.desc', 'vote_count.gte': 100 },
  },
  {
    id: 'romance',
    collection: true,
    title: 'Romance',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '10749', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  /* Rangées 11 à 20 de la page Films : grands genres et populaires. */
  {
    id: 'aventure',
    collection: true,
    title: 'Aventure',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '12', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'films-policier',
    collection: true,
    title: 'Policier',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '80', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'films-fantastique',
    collection: true,
    title: 'Fantastique',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '14', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'films-famille',
    collection: true,
    title: 'En famille',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '10751', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'films-guerre',
    collection: true,
    title: 'Guerre',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '10752', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
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
  /* Rangées 11 à 20 de la page Séries. */
  {
    id: 'series-en-cours',
    title: 'En cours de diffusion',
    path: '/tv/on_the_air',
    fallbackType: 'tv',
    tier: 2,
  },
  {
    id: 'series-animees',
    collection: true,
    title: 'Séries animées',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-mystere',
    collection: true,
    title: 'Mystère',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '9648', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-familiales',
    collection: true,
    title: 'En famille',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '10751', sort_by: 'popularity.desc', 'vote_count.gte': 30 },
  },
  {
    id: 'series-jeunesse',
    collection: true,
    title: 'Jeunesse',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '10762', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
  },
  {
    // `with_type` 2 : mini-séries, au sens de TMDB (une seule saison prévue).
    id: 'series-mini',
    collection: true,
    title: 'Mini-séries',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_type: '2', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'series-telerealite',
    collection: true,
    title: 'Téléréalité',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '10764', sort_by: 'popularity.desc', 'vote_count.gte': 10 },
  },
  {
    id: 'series-guerre-politique',
    collection: true,
    title: 'Guerre et politique',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '10768', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
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
  /* Rangées 11 à 20 de la page Animés. */
  {
    id: 'animes-populaires',
    collection: true,
    title: 'Les plus populaires',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16', with_original_language: 'ja', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'animes-policier',
    collection: true,
    title: 'Policier',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16,80', with_original_language: 'ja', sort_by: 'popularity.desc', 'vote_count.gte': 20 },
  },
  {
    id: 'animes-familial',
    collection: true,
    title: 'En famille',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16,10751', with_original_language: 'ja', sort_by: 'popularity.desc', 'vote_count.gte': 10 },
  },
  {
    id: 'animes-mieux-notes',
    collection: true,
    title: 'Les mieux notés',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16', with_original_language: 'ja', sort_by: 'vote_average.desc', 'vote_count.gte': 200 },
  },
  {
    id: 'animes-annees-2010',
    collection: true,
    title: 'Les années 2010',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16', with_original_language: 'ja', 'first_air_date.gte': '2010-01-01', 'first_air_date.lte': '2019-12-31', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    // `with_status` 3 : séries terminées, à regarder d'une traite.
    id: 'animes-termines',
    collection: true,
    title: 'Séries terminées',
    path: '/discover/tv',
    fallbackType: 'tv',
    tier: 2,
    params: { with_genres: '16', with_original_language: 'ja', with_status: '3', sort_by: 'popularity.desc', 'vote_count.gte': 50 },
  },
  {
    id: 'animes-films-recents',
    collection: true,
    title: 'Films d’animation récents',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '16', with_original_language: 'ja', 'primary_release_date.gte': daysAgo(730), sort_by: 'popularity.desc', 'vote_count.gte': 10 },
  },
  {
    id: 'animes-films-cultes',
    collection: true,
    title: 'Films d’animation cultes',
    path: '/discover/movie',
    fallbackType: 'movie',
    tier: 2,
    params: { with_genres: '16', with_original_language: 'ja', sort_by: 'vote_average.desc', 'vote_count.gte': 300 },
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

/**
 * Rangées affichées d'office sur une page : les premières de sa liste.
 */
export const TV_SHOWN_BY_DEFAULT = 6;

/**
 * Rangées classiques affichées au plus sur une page personnalisée, et ce
 * qu'ajoute chaque palier (deux au plus) : 10, 15, 20.
 */
export const TV_BASE_ROW_CAPACITY = 10;
export const TV_ROWS_PER_PACK = 5;
export const TV_MAX_ROW_PACKS = 2;

/**
 * Accueil, dans l'ordre d'affichage : dix rangées disponibles, les six
 * premières affichées d'office. La première alimente la bannière.
 */
export const TV_HOME_ROWS: readonly string[] = [
  'tendances',
  'films-recents',
  'series-recentes',
  'films',
  'series',
  'top-films',
  'top-series',
  'action',
  'comedies',
  'animes',
];

/**
 * Page Films : la sélection (bannière), le Top 10, les nouveautés, puis les
 * grands genres. Vingt rangées ; l'accueil, lui, en garde dix.
 */
export const TV_MOVIE_ROWS: readonly string[] = [
  'films-selection',
  'films-top10',
  'films-recents',
  'action',
  'comedies',
  'thrillers',
  'horreur',
  'science-fiction',
  'romance',
  'top-films',
  'films',
  'aventure',
  'animation',
  'drames',
  'films-policier',
  'films-fantastique',
  'films-famille',
  'films-guerre',
  'documentaires',
  'films-francais',
];

/** Page Séries : même construction que les films, avec les genres télé de TMDB. */
export const TV_SERIES_ROWS: readonly string[] = [
  'series-selection',
  'series-top10',
  'series-recentes',
  'series-action',
  'series-policier',
  'series-comedies',
  'series-drames',
  'series-sf-fantastique',
  'top-series',
  'series-documentaires',
  'series',
  'series-en-cours',
  'series-animees',
  'series-mystere',
  'series-familiales',
  'series-jeunesse',
  'series-mini',
  'series-telerealite',
  'series-guerre-politique',
  'series-francaises',
];

/**
 * Page Animés : la saison en cours (bannière), le classement, les nouveautés,
 * puis les genres. Le donghua, l'animation coréenne, Ghibli et le hentai
 * restent au registre, hors des pages.
 */
export const TV_ANIME_ROWS: readonly string[] = [
  'animes-en-cours',
  'animes-top10',
  'animes-nouveaux',
  'animes-action',
  'animes-films',
  'animes-comedies',
  'animes-sf-fantastique',
  'animes-drames',
  'animes-classiques',
  'animes-mystere',
  'animes-populaires',
  'animes-mieux-notes',
  'animes-jeunesse',
  'animes-policier',
  'animes-familial',
  'animes-annees-2010',
  'animes-termines',
  'animes-films-recents',
  'animes-films-cultes',
  'catalogue-animes',
];

/** @deprecated Ordre de l'accueil. Préférez `TV_HOME_ROWS`. */
export const TV_ROW_ORDER: string[] = [...TV_HOME_ROWS];


/**
 * Registre complet, pour l'éditeur de rangées de la personnalisation.
 *
 * `kind` sert à distinguer à l'écran deux rangées de même titre — « Comédies »
 * existe pour les films, les séries et les animés.
 */
export function listRowSpecs(): { id: string; title: string; kind: string }[] {
  const custom = customRows.map(row => ({ id: row.id, title: row.title, kind: 'Sur mesure' }));
  return [...ROWS.map(row => {
    const genres = String(row.params?.with_genres ?? '');
    const kind = /(^|[,|])16([,|]|$)/.test(genres) && row.params?.with_original_language === 'ja'
      ? 'Animés'
      : row.path.includes('/movie')
        ? 'Films'
        : row.path.includes('/tv')
          ? 'Séries'
          : 'Films et séries';
    return { id: row.id, title: row.title, kind };
  }), ...custom];
}

/* --- Rangées déclarées par l'édition ------------------------------------- */

let customRows: readonly CustomRowDefinition[] = [];

/**
 * Rangées déclarées par l'édition, à chaque changement. Une édition qui n'en a
 * pas n'en déclare aucune.
 */
export function registerCustomRows(rows: readonly CustomRowDefinition[]): void {
  customRows = rows;
}

export const registeredCustomRows = (): readonly CustomRowDefinition[] => customRows;

/** La requête d'une rangée déclarée, au format des rangées du registre. */
export function customRowSpec(row: CustomRowDefinition): RowSpec {
  const params: Record<string, string | number> = { sort_by: 'popularity.desc', ...row.params };
  // Jamais de contenu adulte par une rangée déclarée, quoi qu'en dise la requête.
  delete params.include_adult;
  if (row.recentDays) {
    const field = row.media === 'movie' ? 'primary_release_date' : 'first_air_date';
    params[`${field}.gte`] = daysAgo(row.recentDays);
    params[`${field}.lte`] = today();
  }
  return {
    id: row.id,
    title: row.title,
    path: `/discover/${row.media}`,
    fallbackType: row.media,
    tier: 1,
    collection: true,
    params,
  };
}

/**
 * Pages qui ont du sens pour une rangée déclarée : l'accueil toujours, puis
 * Films pour des films, Séries pour des séries, et Animés si elle porte sur
 * l'animation (genre 16). Une rangée de films n'a rien à faire sur Séries.
 */
export function compatibleCustomRowPages(row: Pick<CustomRowDefinition, 'media' | 'params'>): string[] {
  const animation = String(row.params.with_genres ?? '')
    .split(/[,|]/)
    .includes('16');
  return ['home', row.media === 'movie' ? 'movies' : 'series', ...(animation ? ['animes'] : [])];
}

/** Pages où la rangée est proposée : celles choisies, si elles restent compatibles, sinon toutes les compatibles. */
export function customRowPages(row: CustomRowDefinition): string[] {
  const compatible = compatibleCustomRowPages(row);
  const chosen = (row.pages ?? []).filter(page => compatible.includes(page));
  return chosen.length > 0 ? chosen : compatible;
}

/** Une rangée du registre, ou une rangée déclarée par l'édition. */
export function findRowSpec(id: string): RowSpec | undefined {
  const spec = ROWS.find(row => row.id === id);
  if (spec) return spec;
  const custom = customRows.find(row => row.id === id);
  return custom ? customRowSpec(custom) : undefined;
}

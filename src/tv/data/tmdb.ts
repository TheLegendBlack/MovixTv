import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import { getTmdbApiKey } from '@/config/tmdbKey';
// Registre des rangées et listes par page : `rowRegistry.ts`, module pur que
// le site de personnalisation importe aussi, sans axios ni traductions.
import { TV_HOME_ROWS, findRowSpec, type RowSpec, type TvRowLayoutName } from './rowRegistry';
export {
  TV_ANIME_ROWS,
  TV_HOME_ROWS,
  TV_MOVIE_ROWS,
  TV_ROW_ORDER,
  TV_SERIES_ROWS,
  listRowSpecs,
} from './rowRegistry';
export type { TvRowLayoutName } from './rowRegistry';

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


/** Métadonnées d'une rangée, pour la page de collection. */
export function getRowSpec(
  id: string,
): { id: string; title: string; collection: boolean } | null {
  const spec = findRowSpec(id);
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
  const spec = findRowSpec(rowId);
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
      // Rangée du registre, ou rangée déclarée par l'édition.
      const spec = findRowSpec(id);
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

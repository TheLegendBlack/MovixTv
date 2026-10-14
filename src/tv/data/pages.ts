import { TV_ANIME_ROWS, TV_HOME_ROWS, TV_MOVIE_ROWS, TV_SERIES_ROWS, TV_SHOWN_BY_DEFAULT } from './rowRegistry';

/**
 * Les quatre pages de parcours, leurs rangées disponibles et celles affichées
 * d'office.
 *
 * Les pages lisent leurs rangées par `usePageRows` (`tv/edition.tsx`), qui
 * part de ces valeurs par défaut.
 */

export type TvPageId = 'home' | 'movies' | 'series' | 'animes';

export interface TvPageDefinition {
  label: string;
  /** Rangées affichées d'office, dans l'ordre. */
  defaults: readonly string[];
  /**
   * Rangées que la page propose : celles affichées d'office, puis les suivantes.
   */
  available: readonly string[];
  /** Rangée qui alimente la bannière, si elle est affichée. */
  hero: string;
}

function page(label: string, rows: readonly string[], hero: string): TvPageDefinition {
  return { label, defaults: rows.slice(0, TV_SHOWN_BY_DEFAULT), available: rows, hero };
}

export const TV_PAGES: Record<TvPageId, TvPageDefinition> = {
  home: page('Accueil', TV_HOME_ROWS, 'tendances'),
  movies: page('Films', TV_MOVIE_ROWS, 'films-selection'),
  series: page('Séries', TV_SERIES_ROWS, 'series-selection'),
  animes: page('Animés', TV_ANIME_ROWS, 'animes-en-cours'),
};

export const TV_PAGE_IDS = Object.keys(TV_PAGES) as TvPageId[];

export interface ResolvedPageRows {
  rowIds: readonly string[];
  heroRowId: string;
}

/** Rangées d'une page sans personnalisation. */
export function defaultPageRows(page: TvPageId): ResolvedPageRows {
  const definition = TV_PAGES[page];
  return { rowIds: definition.defaults, heroRowId: definition.hero };
}

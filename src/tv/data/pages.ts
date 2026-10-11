import { TV_ANIME_ROWS, TV_HOME_ROWS, TV_MOVIE_ROWS, TV_SERIES_ROWS } from './tmdb';

/**
 * Les quatre pages de parcours et leurs rangées par défaut.
 *
 * Les pages lisent leurs rangées par `usePageRows` (`tv/edition.tsx`), qui
 * part de ces valeurs par défaut.
 */

export type TvPageId = 'home' | 'movies' | 'series' | 'animes';

export interface TvPageDefinition {
  label: string;
  defaults: readonly string[];
  /** Rangée qui alimente la bannière, si elle est affichée. */
  hero: string;
}

export const TV_PAGES: Record<TvPageId, TvPageDefinition> = {
  home: { label: 'Accueil', defaults: TV_HOME_ROWS, hero: 'tendances' },
  movies: { label: 'Films', defaults: TV_MOVIE_ROWS, hero: 'films-selection' },
  series: { label: 'Séries', defaults: TV_SERIES_ROWS, hero: 'series-selection' },
  animes: { label: 'Animés', defaults: TV_ANIME_ROWS, hero: 'animes-en-cours' },
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

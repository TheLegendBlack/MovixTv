import React from 'react';
import TvBrowse from './TvBrowse';
import { usePageRows } from './edition';

/**
 * Page Films : l'accueil, restreint aux films.
 *
 * La bannière prend les cinq premiers titres de « Notre sélection du jour »,
 * la rangée reprend au sixième. Pas de reprise de lecture ici : elle est
 * transverse, et l'accueil la porte déjà. L'ordre des rangées est dans
 * `TV_MOVIE_ROWS` (voir `data/pages.ts`).
 */
const TvMovies: React.FC = () => {
  const { rowIds, heroRowId } = usePageRows('movies');
  return <TvBrowse rowIds={rowIds} heroRowId={heroRowId} />;
};

export default TvMovies;

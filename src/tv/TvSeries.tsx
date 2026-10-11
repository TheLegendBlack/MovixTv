import React from 'react';
import TvBrowse from './TvBrowse';
import { usePageRows } from './edition';

/**
 * Page Séries : l'accueil, restreint aux séries.
 *
 * La bannière prend les cinq premiers titres de « Notre sélection du jour »,
 * la rangée reprend au sixième. L'ordre des rangées est dans `TV_SERIES_ROWS` (voir `data/pages.ts`).
 */
const TvSeries: React.FC = () => {
  const { rowIds, heroRowId } = usePageRows('series');
  return <TvBrowse rowIds={rowIds} heroRowId={heroRowId} />;
};

export default TvSeries;

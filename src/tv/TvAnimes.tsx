import React from 'react';
import TvBrowse from './TvBrowse';
import { usePageRows } from './edition';

/**
 * Page Animés : films et séries mêlés, japonais d'abord.
 *
 * La bannière prend les cinq premiers titres de « Diffusion en cours » — ce
 * qui passe cette saison — et la rangée reprend au sixième. L'ordre des
 * rangées est dans `TV_ANIME_ROWS` (voir `data/pages.ts`).
 */
const TvAnimes: React.FC = () => {
  const { rowIds, heroRowId } = usePageRows('animes');
  return <TvBrowse rowIds={rowIds} heroRowId={heroRowId} />;
};

export default TvAnimes;

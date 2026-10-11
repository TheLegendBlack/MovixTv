import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TvBrowse, { type TvBrowseLeadingRow } from './TvBrowse';
import { TvRow, type TvRowItemState } from './components/TvRow';
import { TvCard } from './components/TvCard';
import { usePageRows } from './edition';
import {
  remainingLabel,
  useContinueWatching,
  type ContinueWatchingEntry,
} from './data/useContinueWatching';

/**
 * Accueil de l'interface téléviseur.
 *
 * Tout le mécanisme — bannière, colonne, rangées — vit dans `TvBrowse`. Ici ne
 * reste que ce qui est propre à l'accueil : la liste de ses rangées, la rangée
 * qui nourrit la bannière, et la reprise de lecture en tête de page.
 */

const CONTINUE_ROW_ID = 'reprise';

/** Constante de module, pour la même raison que dans `TvBrowse` : `TvRow` est mémoïsé. */
const renderContinueCard = (
  entry: ContinueWatchingEntry,
  state: TvRowItemState,
): React.ReactNode => (
  <TvCard
    layout="still"
    title={entry.title}
    overline={remainingLabel(entry.remainingSeconds)}
    subtitle={entry.episodeLabel}
    imageUrl={entry.stillUrl}
    progress={entry.progress}
    focused={state.focused}
    rowFocused={state.rowFocused}
  />
);

const TvHome: React.FC = () => {
  const { rowIds, heroRowId } = usePageRows('home');
  const navigate = useNavigate();
  const continueEntries = useContinueWatching();

  const openMedia = useCallback(
    (item: { id: number; mediaType: 'movie' | 'tv' }) =>
      navigate(`/tvapp/${item.mediaType}/${item.id}`),
    [navigate],
  );

  // Mémorisée : `TvBrowse` lit son identifiant pour l'ordre vertical, et une
  // description neuve à chaque rendu relancerait le calcul de position.
  const leading = useMemo<TvBrowseLeadingRow | null>(
    () =>
      continueEntries.length === 0
        ? null
        : {
            id: CONTINUE_ROW_ID,
            render: ({ active, neighbors, onRowEnter }) => (
              <TvRow<ContinueWatchingEntry>
                id={CONTINUE_ROW_ID}
                title="Reprendre la lecture"
                items={continueEntries}
                layout="still"
                active={active}
                neighbors={neighbors}
                onRowEnter={onRowEnter}
                onSelect={openMedia}
                renderItem={renderContinueCard}
              />
            ),
          },
    [continueEntries, openMedia],
  );

  return <TvBrowse rowIds={rowIds} heroRowId={heroRowId} leading={leading} />;
};

export default TvHome;

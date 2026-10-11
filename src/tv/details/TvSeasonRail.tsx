import React from 'react';
import { useFocusItem, useFocusScope } from '../nav/hooks';
import type { TvSeason } from '../data/tmdbDetails';

/**
 * Rail vertical des saisons.
 *
 * Remplace les pastilles horizontales : dix saisons débordaient de l'écran,
 * une pile en encaisse autant qu'on veut. Et surtout, ça libère l'axe
 * horizontal, qui devient le passage entre le rail et la liste d'épisodes —
 * gauche/droite pour changer de colonne, haut/bas pour parcourir, ce qui est le
 * schéma que l'utilisateur connaît de Disney+.
 *
 * Les deux blocs étant côte à côte, l'ordre du DOM ment au moteur de
 * navigation : sans les `neighbors` déclarés ici, Haut depuis le premier
 * épisode retomberait dans le rail au lieu de remonter aux onglets.
 */

interface TvSeasonRailProps {
  scopeId: string;
  /** Portée de la liste d'épisodes, à droite. */
  episodesScopeId: string;
  /** Portée des onglets, au-dessus. */
  tabsScopeId: string;
  seasons: TvSeason[];
  selected: number | null;
  onSelect: (seasonNumber: number) => void;
}

export const TvSeasonRail: React.FC<TvSeasonRailProps> = ({
  scopeId,
  episodesScopeId,
  tabsScopeId,
  seasons,
  selected,
  onSelect,
}) => {
  const scopeRef = useFocusScope({
    id: scopeId,
    orientation: 'column',
    count: seasons.length,
    neighbors: {
      right: episodesScopeId,
      up: tabsScopeId,
      // Fermé : sous le rail il n'y a rien. Sans ça, Bas depuis la dernière
      // saison déverserait le focus dans la liste d'épisodes, qui est à droite.
      down: null,
    },
  });

  return (
    <div ref={scopeRef} className="w-[124px] shrink-0">
      {seasons.map((season, index) => (
        <TvSeasonItem
          key={season.seasonNumber}
          scopeId={scopeId}
          index={index}
          season={season}
          active={season.seasonNumber === selected}
          onSelect={() => onSelect(season.seasonNumber)}
        />
      ))}
    </div>
  );
};

const TvSeasonItem: React.FC<{
  scopeId: string;
  index: number;
  season: TvSeason;
  active: boolean;
  onSelect: () => void;
}> = ({ scopeId, index, season, active, onSelect }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(scopeId, index);

  // Le focus se déplace sur la saison sans la sélectionner : sur TV, changer de
  // saison au simple survol du focus déclencherait une requête à chaque appui.
  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={
        'mb-[4px] block w-full rounded-lg px-[10px] py-[7px] text-left outline-none transition-colors duration-150 ' +
        (focused ? 'bg-tv-focus text-tv-on-focus ' : active ? 'text-white ' : 'text-white/50 ')
      }>
      <span className="block text-[14px] font-semibold leading-tight">{season.name}</span>
      {active && (
        <span
          className={
            'block text-[11px] leading-tight ' + (focused ? 'text-tv-on-focus/60' : 'text-white/40')
          }>
          {season.episodeCount} épisode{season.episodeCount > 1 ? 's' : ''}
        </span>
      )}
    </button>
  );
};

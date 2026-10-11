import React, { useEffect } from 'react';
import { useFocusItem, useFocusScope } from '../nav/hooks';

/**
 * Barre d'onglets de la fiche.
 *
 * Le focus sélectionne, contrairement au rail des saisons où il faut valider.
 * La différence n'est pas une inconséquence : changer de saison déclenche une
 * requête réseau, changer d'onglet ne fait que révéler des données déjà
 * chargées. Faire valider un onglet ajouterait un appui pour rien.
 *
 * Deux états à distinguer visuellement, et donc deux traitements : l'onglet
 * *actif* porte un trait, l'onglet *focalisé* porte un fond. Ils coïncident la
 * plupart du temps, mais pas quand le focus est descendu dans le contenu — et
 * c'est justement là que l'utilisateur a besoin de savoir où il est.
 */

export interface TvTab {
  id: string;
  label: string;
}

interface TvDetailsTabsProps {
  scopeId: string;
  tabs: TvTab[];
  activeId: string;
  onSelect: (id: string) => void;
}

export const TvDetailsTabs: React.FC<TvDetailsTabsProps> = ({
  scopeId,
  tabs,
  activeId,
  onSelect,
}) => {
  const scopeRef = useFocusScope({ id: scopeId, orientation: 'row', count: tabs.length });

  return (
    <div
      ref={scopeRef}
      role="tablist"
      className="flex gap-[24px] border-b border-white/15 pb-[8px]">
      {tabs.map((tab, index) => (
        <TvTabButton
          key={tab.id}
          scopeId={scopeId}
          index={index}
          tab={tab}
          active={tab.id === activeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

const TvTabButton: React.FC<{
  scopeId: string;
  index: number;
  tab: TvTab;
  active: boolean;
  onSelect: (id: string) => void;
}> = ({ scopeId, index, tab, active, onSelect }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(scopeId, index);

  // Notifié par effet et non pendant le rendu : prévenir le parent en plein
  // rendu déclencherait une mise à jour d'état imbriquée.
  useEffect(() => {
    if (focused && !active) onSelect(tab.id);
  }, [focused, active, onSelect, tab.id]);

  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab.id)}
      className={
        'relative rounded px-[10px] pb-[8px] pt-[2px] text-[15px] font-semibold outline-none transition-colors duration-150 ' +
        (focused ? 'bg-white/10 text-white ' : active ? 'text-white ' : 'text-white/45 ')
      }>
      {tab.label}
      {active && (
        // Débordant de 8 px pour venir se poser sur la ligne du conteneur, que
        // le trait doit recouvrir et non doubler.
        <span className="absolute inset-x-[10px] -bottom-[1px] h-[2px] rounded-full bg-tv-focus" />
      )}
    </button>
  );
};

import React from 'react';
import { useFocusItem, useFocusScope } from '../nav/hooks';

/**
 * Clavier à l'écran, pilotable à la télécommande.
 *
 * Disposition **alphabétique** et non AZERTY : à trois mètres, on cherche une
 * lettre du regard, on ne tape pas de mémoire. Un AZERTY obligerait à balayer
 * une disposition apprise au toucher, ce qui n'a aucun sens ici.
 *
 * **220 px de large** sur un gabarit de 960, contre 360 avant. Le clavier ne
 * sert qu'à produire quatre ou cinq lettres ; la surface utile est à droite,
 * dans les résultats. Netflix tient le sien sous 22 % de la largeur, et à
 * cette taille tout — actions comprises — tient en 248 px de haut, ce qui
 * laisse la place à une liste de suggestions dessous. La version précédente
 * dépassait du bas de l'écran : la rangée Espace / Effacer était focalisable
 * mais invisible.
 *
 * **La rangée d'actions est au-dessus des lettres**, comme chez Netflix. La
 * page déclare `down` depuis la barre de navigation vers la grille : on arrive
 * sur « A », pas sur « Espace ». La grille et la rangée sont deux portées du
 * moteur, enchaînées par l'ordre du DOM. La sortie **basse** de la grille est
 * laissée à l'appelant (`downNeighbor`) : lui seul sait ce qu'il affiche en
 * dessous, et une sortie non déclarée retomberait sur la portée suivante du
 * DOM — la grille de résultats, de l'autre côté de l'écran.
 *
 * Le focus est **blanc sur noir**, comme les pastilles de la barre de
 * navigation : un seul langage de focus sur toute l'interface, le rouge ne
 * porte que du sens. Les touches sont rendues à leur taille maximale et c'est
 * l'état au repos qui est réduit — même parti pris que `TvCard`, pour les
 * mêmes raisons.
 */

export const TV_KEYBOARD_WIDTH = 220;

const KEYBOARD_COLUMNS = 6;
const KEY_GAP = 4;
const KEY_REST_SCALE = 0.92;

const KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
];

/**
 * Identifiants de portée pour un préfixe donné. Exporté pour que l'appelant
 * cible la grille sans recopier la chaîne : la recherche en dépend deux fois
 * (`left` depuis les résultats, `down` depuis la barre de navigation).
 */
export const tvKeyboardScopes = (idPrefix = 'clavier') => ({
  actions: `${idPrefix}-actions`,
  grid: `${idPrefix}-grille`,
});

export interface TvKeyboardProps {
  /** Préfixe des identifiants de portée, pour cohabiter avec d'autres claviers. */
  idPrefix?: string;
  /** Portée à atteindre en poussant à droite depuis le bord du clavier. */
  rightNeighbor?: string;
  /**
   * Portée à atteindre en poussant en bas depuis la dernière rangée de lettres.
   * `null` ferme la sortie ; `undefined` s'en remet à l'ordre du DOM.
   */
  downNeighbor?: string | null;
  onAppend: (character: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  /**
   * Touches ajoutées après les chiffres, pour une saisie qui en a besoin — le
   * tiret et les quelques signes des clés VIP (`TvKeyEntry`). Absent de la
   * recherche et de la clé TMDB.
   */
  extraKeys?: readonly string[];
  /** Masque la touche Espace : inutile pour une clé, et source d'erreurs. */
  hideSpace?: boolean;
}

export const TvKeyboard: React.FC<TvKeyboardProps> = ({
  idPrefix = 'clavier',
  rightNeighbor,
  downNeighbor,
  onAppend,
  onBackspace,
  onClear,
  extraKeys,
  hideSpace = false,
}) => {
  const scopes = tvKeyboardScopes(idPrefix);
  const keys = extraKeys && extraKeys.length > 0 ? [...KEYS, ...extraKeys] : KEYS;

  const actions = [
    ...(hideSpace ? [] : [{ id: 'espace', label: 'Espace', grow: 3, onSelect: () => onAppend(' ') }]),
    { id: 'effacer', label: 'Effacer', grow: 2, icon: true, onSelect: onBackspace },
    { id: 'vider', label: 'Tout effacer', grow: 4, onSelect: onClear },
  ];

  const actionsRef = useFocusScope({
    id: scopes.actions,
    orientation: 'row',
    count: actions.length,
    neighbors: { right: rightNeighbor },
  });

  const gridRef = useFocusScope({
    id: scopes.grid,
    orientation: 'grid',
    count: keys.length,
    columns: KEYBOARD_COLUMNS,
    neighbors: { right: rightNeighbor, down: downNeighbor },
  });

  return (
    <div style={{ width: TV_KEYBOARD_WIDTH }}>
      <div ref={actionsRef} className="flex" style={{ gap: KEY_GAP }}>
        {actions.map((action, index) => (
          <TvKey
            key={action.id}
            scopeId={scopes.actions}
            index={index}
            label={action.label}
            onSelect={action.onSelect}
            className="text-xs"
            style={{ flexGrow: action.grow, flexBasis: 0 }}>
            {action.icon ? <BackspaceIcon /> : action.label}
          </TvKey>
        ))}
      </div>

      <div
        ref={gridRef}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${KEYBOARD_COLUMNS}, minmax(0, 1fr))`,
          gap: KEY_GAP,
          marginTop: KEY_GAP,
        }}>
        {keys.map((key, index) => (
          <TvKey
            key={key}
            scopeId={scopes.grid}
            index={index}
            label={key}
            onSelect={() => onAppend(key)}
            className="text-base">
            {key}
          </TvKey>
        ))}
      </div>
    </div>
  );
};

const TvKey: React.FC<{
  scopeId: string;
  index: number;
  /** Nom lisible de la touche. Sert d'`aria-label` quand le contenu est une icône. */
  label: string;
  onSelect: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ scopeId, index, label, onSelect, className = '', style, children }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(scopeId, index);

  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      aria-label={label}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={
        'flex h-8 items-center justify-center rounded-md font-semibold outline-none transition-transform duration-100 ' +
        className +
        (focused ? ' bg-tv-focus text-tv-on-focus' : ' bg-white/[0.07] text-white/75')
      }
      style={{ ...style, transform: `scale(${focused ? 1 : KEY_REST_SCALE})` }}>
      {children}
    </button>
  );
};

/** Glyphe « retour arrière », dessiné plutôt que tapé : le caractère ⌫ manque à certaines polices de téléviseur. */
const BackspaceIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden>
    <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7z" />
    <path d="M17 9l-6 6M11 9l6 6" />
  </svg>
);

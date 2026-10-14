import React, { useEffect, useRef } from 'react';
import { useTvFocusContext } from './focusContext';
import type { ScopeOrientation } from './resolveMove';

export interface UseFocusScopeOptions {
  /** Doit rester stable entre deux rendus. */
  id: string;
  orientation: ScopeOrientation;
  /** Nombre total d'éléments logiques, rendus ou non. */
  count: number;
  /** Requis pour `grid`. */
  columns?: number;
  /** Boucle en fin de portée. Réservé aux courtes listes — voir `Scope.wrap`. */
  wrap?: boolean;
  /**
   * Portées voisines. `left`/`right` pour les blocs côte à côte, `up`/`down`
   * pour corriger l'ordre du DOM quand il ne reflète pas la disposition à
   * l'écran. `null` ferme la sortie dans cette direction.
   */
  neighbors?: {
    left?: string | null;
    right?: string | null;
    up?: string | null;
    down?: string | null;
  };
  /** Index d'entrée fixe, qui l'emporte sur la mémoire. Voir `Scope.entry`. */
  entry?: number;
  /** Amène un index dans la fenêtre de rendu (rangées virtualisées). */
  reveal?: (index: number) => void;
}

export function useFocusScope({
  id,
  orientation,
  count,
  columns,
  wrap,
  neighbors,
  entry,
  reveal,
}: UseFocusScopeOptions): React.RefObject<HTMLDivElement> {
  const { registerScope } = useTvFocusContext();
  const ref = useRef<HTMLDivElement>(null);
  // `reveal` est presque toujours une closure recréée à chaque rendu : la lire
  // via une ref évite de ré-enregistrer la portée à chaque fois.
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const neighborsRef = useRef(neighbors);
  neighborsRef.current = neighbors;

  /**
   * Signature du contenu de `neighbors`, pas de son identité.
   *
   * Dépendre de l'objet ré-enregistrerait la portée à chaque rendu, puisque
   * c'est un littéral recréé à chaque fois. Mais s'en remettre à une ref sans
   * dépendance du tout gelait les voisins tels qu'ils étaient au montage : une
   * portée qui pointe vers un identifiant dynamique — le rail des saisons vers
   * `fiche-episodes-s{n}` — continuait de désigner la saison affichée le jour
   * de son enregistrement, et le passage vers la liste mourait dès qu'on
   * changeait de saison.
   *
   * La clé est construite dans un ordre fixe, indépendant de l'ordre des clés
   * de l'objet. `\u0000` code `null`, qui ferme une sortie, et se distingue de
   * la chaîne vide qui code `undefined`, lequel s'en remet à l'ordre du DOM.
   */
  const neighborsKey = [
    neighbors?.left,
    neighbors?.right,
    neighbors?.up,
    neighbors?.down,
  ]
    .map(value => (value === undefined ? '' : value === null ? '\u0000' : value))
    .join('|');

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return registerScope(
      { id, orientation, count, columns, wrap, neighbors: neighborsRef.current, entry },
      element,
      index => revealRef.current?.(index),
    );
    // `neighborsKey` est dans les dépendances à la place de `neighbors` : voir
    // le commentaire ci-dessus.
  }, [registerScope, id, orientation, count, columns, wrap, neighborsKey, entry]);

  return ref;
}

export interface FocusItemState<E extends HTMLElement = HTMLElement> {
  ref: React.RefObject<E>;
  focused: boolean;
  /**
   * À étaler sur l'élément : le rend focusable et resynchronise le moteur quand
   * le focus arrive par un autre chemin (clic souris, focus programmatique).
   */
  focusProps: {
    tabIndex: number;
    onFocus: () => void;
  };
}

export function useFocusItem<E extends HTMLElement = HTMLElement>(
  scopeId: string,
  index: number,
): FocusItemState<E> {
  const { registerItem, focus, isCurrent, focused } = useTvFocusContext();
  const ref = useRef<E>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return registerItem(scopeId, index, element);
  }, [registerItem, scopeId, index]);

  const isFocused = focused?.scopeId === scopeId && focused.index === index;

  return {
    ref,
    focused: isFocused,
    focusProps: {
      // -1 et non 0 : le parcours appartient au moteur. Laisser Tab créer un
      // second ordre de navigation concurrent ne ferait que semer la confusion.
      tabIndex: -1,
      // Focus reçu d'ailleurs que du moteur (clic, focus natif) : on l'informe.
      // Quand c'est le moteur qui vient de le donner, sa position est déjà la
      // bonne : le relancer refaisait tout le déplacement une seconde fois.
      onFocus: () => {
        if (!isFocused && !isCurrent({ scopeId, index })) focus({ scopeId, index });
      },
    },
  };
}

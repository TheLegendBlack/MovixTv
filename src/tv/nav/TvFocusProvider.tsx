import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  rememberPosition,
  resolveMove,
  type Direction,
  type NavState,
  type Position,
  type Scope,
} from './resolveMove';
import { TvFocusContext, type TvFocusContextValue } from './focusContext';

/**
 * Liaison React du moteur de navigation.
 *
 * Tout l'état vit dans des refs, pas dans le state : un appui sur une flèche ne
 * doit pas faire re-rendre l'arbre entier. Seule la position focalisée est
 * publiée en state, et les éléments s'y abonnent individuellement.
 */

interface RegisteredScope {
  config: Scope;
  element: HTMLElement;
  /** Demande à la rangée d'amener un index dans sa fenêtre de rendu. */
  reveal?: (index: number) => void;
}

const DIRECTION_BY_KEY: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const itemKey = (scopeId: string, index: number) => `${scopeId}:${index}`;

export const TvFocusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scopesRef = useRef(new Map<string, RegisteredScope>());
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const stateRef = useRef<NavState>({ scopes: [], current: null, memory: {} });
  const orderDirtyRef = useRef(true);
  /** Cible demandée mais pas encore montée (rangée virtualisée). */
  const pendingRef = useRef<Position | null>(null);
  const [focused, setFocused] = useState<Position | null>(null);

  /**
   * Les portées sont ordonnées par position dans le DOM, pas par ordre de
   * montage : React ne garantit pas que l'un suive l'autre. Le tri n'est refait
   * que lorsque l'ensemble change, jamais à chaque appui.
   */
  const orderedScopes = useCallback((): Scope[] => {
    if (!orderDirtyRef.current) return stateRef.current.scopes;
    const entries = [...scopesRef.current.values()];
    entries.sort((a, b) => {
      const relation = a.element.compareDocumentPosition(b.element);
      if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    orderDirtyRef.current = false;
    stateRef.current = { ...stateRef.current, scopes: entries.map(entry => entry.config) };
    return stateRef.current.scopes;
  }, []);

  /** Affichage demandé et pas encore fait (voir `applyFocus`). */
  const frameRef = useRef<number | null>(null);

  /**
   * Rend visible la position courante du moteur : état React, rangée, focus du
   * DOM, défilement. Lit la position au moment où il s'exécute : plusieurs
   * appuis entre deux images n'en font qu'un affichage, celui de la dernière.
   */
  const flush = useCallback(() => {
    frameRef.current = null;
    const position = stateRef.current.current;
    if (!position) return;
    setFocused(position);

    // La rangée virtualisée doit d'abord rendre l'élément visé ; s'il n'est pas
    // encore dans le DOM, on note la cible et registerItem prendra le relais.
    scopesRef.current.get(position.scopeId)?.reveal?.(position.index);

    const element = itemsRef.current.get(itemKey(position.scopeId, position.index));
    if (element) {
      pendingRef.current = null;
      element.focus({ preventScroll: true });
      // Vertical seulement : le centrage horizontal appartient au virtualiseur
      // de la rangée, qui sait où se trouve l'élément dans sa liste complète.
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } else {
      pendingRef.current = position;
    }
  }, []);

  /**
   * Déplace le focus. La position change tout de suite (l'appui suivant part
   * de là) ; l'affichage, lui, peut attendre l'image suivante (`deferred`,
   * appuis de la télécommande) : mesuré le 14/10/2026 sur l'Edenwood, une
   * rafale de flèches à ~20 appuis/s coûtait 60 à 220 ms par appui, et la file
   * d'attente figeait la télé près d'une seconde. Un seul affichage par image
   * ne laisse plus les appuis s'empiler.
   */
  const applyFocus = useCallback(
    (position: Position, deferred = false) => {
      stateRef.current = rememberPosition({ ...stateRef.current, scopes: orderedScopes() }, position);
      if (deferred) {
        frameRef.current ??= requestAnimationFrame(flush);
        return;
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      flush();
    },
    [orderedScopes, flush],
  );

  useEffect(() => {
    // Toute autre touche (OK, Retour…) agit sur l'élément focalisé du DOM : un
    // affichage encore en attente est fait d'abord, sinon OK frappé dans la même
    // image qu'une flèche viserait la carte précédente. Phase de capture : avant
    // les écouteurs des éléments.
    const catchUp = (event: KeyboardEvent) => {
      if (DIRECTION_BY_KEY[event.key] || frameRef.current === null) return;
      cancelAnimationFrame(frameRef.current);
      flush();
      // La touche visait déjà l'ancien élément (sa cible est fixée à l'envoi) :
      // on l'arrête et on la renvoie à l'élément qui vient de prendre le focus.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== event.target) {
        event.preventDefault();
        event.stopImmediatePropagation();
        active.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, code: event.code, bubbles: true, cancelable: true }));
      }
    };
    window.addEventListener('keydown', catchUp, true);
    return () => {
      window.removeEventListener('keydown', catchUp, true);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [flush]);

  /** Vrai si le moteur est déjà sur cette position (affichée ou en attente d'affichage). */
  const isCurrent = useCallback((position: Position) => {
    const current = stateRef.current.current;
    return current !== null && current.scopeId === position.scopeId && current.index === position.index;
  }, []);

  const registerScope = useCallback(
    (config: Scope, element: HTMLElement, reveal?: (index: number) => void) => {
      scopesRef.current.set(config.id, { config, element, reveal });
      orderDirtyRef.current = true;
      return () => {
        scopesRef.current.delete(config.id);
        orderDirtyRef.current = true;
      };
    },
    [],
  );

  const registerItem = useCallback(
    (scopeId: string, index: number, element: HTMLElement) => {
      const key = itemKey(scopeId, index);
      itemsRef.current.set(key, element);

      // L'élément attendu vient d'arriver dans le DOM : on lui donne le focus.
      const pending = pendingRef.current;
      if (pending && pending.scopeId === scopeId && pending.index === index) {
        pendingRef.current = null;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }

      return () => {
        if (itemsRef.current.get(key) === element) itemsRef.current.delete(key);
      };
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = DIRECTION_BY_KEY[event.key];
      if (!direction) return;

      // Les champs de saisie gardent la main : les flèches y déplacent le caret.
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return;
      }

      // Toutes les flèches reviennent au moteur, même sans cible. Laissée au
      // navigateur, une flèche sans cible (bout de rangée) déclenchait la
      // navigation spatiale de Chromium, qui mesure chaque élément focalisable
      // de la page : des milliers de recalculs de mise en page par rafale,
      // mesurés le 14/10/2026 sur l'Edenwood.
      event.preventDefault();

      const next = resolveMove({ ...stateRef.current, scopes: orderedScopes() }, direction);
      if (next) {
        applyFocus(next, true);
        return;
      }

      // Aucune cible : on fait quand même défiler, sinon un bloc de texte sans
      // élément focusable serait impossible à lire à la télécommande.
      if (direction === 'up' || direction === 'down') {
        const root = document.documentElement;
        const atEdge =
          direction === 'down'
            ? window.scrollY + window.innerHeight >= root.scrollHeight - 2
            : window.scrollY <= 2;
        if (!atEdge) {
          window.scrollBy({
            top: (direction === 'down' ? 1 : -1) * window.innerHeight * 0.8,
            behavior: 'smooth',
          });
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyFocus, orderedScopes]);

  const value = useMemo<TvFocusContextValue>(
    () => ({ registerScope, registerItem, focus: applyFocus, isCurrent, focused }),
    [registerScope, registerItem, applyFocus, isCurrent, focused],
  );

  return <TvFocusContext.Provider value={value}>{children}</TvFocusContext.Provider>;
};

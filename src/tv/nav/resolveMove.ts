/**
 * Cœur de la navigation à la télécommande, en logique pure.
 *
 * Le choix structurant : la navigation se fait **par index logique dans une
 * portée**, pas par géométrie. C'est imposé par la virtualisation — une rangée
 * de 200 titres n'a qu'une dizaine d'éléments dans le DOM, donc les autres
 * n'ont aucun rectangle à comparer. Un moteur géométrique s'arrêterait au bord
 * de la fenêtre rendue.
 *
 * Effet de bord heureux : c'est aussi plus prévisible pour l'utilisateur. Une
 * rangée se parcourt de proche en proche, sans saut en diagonale surprenant.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * - `row` : rangée horizontale (gauche/droite parcourt, haut/bas sort)
 * - `column` : pile verticale (haut/bas parcourt, gauche/droite sort)
 * - `grid` : grille de `columns` colonnes
 */
export type ScopeOrientation = 'row' | 'column' | 'grid';

export interface Scope {
  id: string;
  orientation: ScopeOrientation;
  /** Nombre total d'éléments logiques, rendus ou non. */
  count: number;
  /** Requis pour `grid`. */
  columns?: number;
  /**
   * Boucle en fin de portée, sur l'axe de parcours.
   *
   * Faux par défaut, et ça doit le rester pour le catalogue : sur une rangée de
   * 200 titres, revenir au début en poussant à droite désoriente plus qu'il ne
   * sert. Le cas d'usage est la bannière d'accueil — cinq diapositives, où buter
   * sur la dernière est juste agaçant.
   */
  wrap?: boolean;
  /**
   * Portées voisines, déclarées explicitement.
   *
   * Le moteur déduit le vertical de l'ordre du DOM : sans déclaration, deux
   * blocs côte à côte — un clavier et sa grille de résultats — sont mutuellement
   * inatteignables sur l'axe horizontal. On l'exige explicite plutôt que de le
   * déduire de la géométrie, qui serait fausse dès qu'un bloc est virtualisé.
   *
   * `up` et `down` répondent au symétrique du même problème : deux portées
   * juxtaposées se suivent dans le DOM, donc le moteur les croit superposées.
   * Sans ça, Haut depuis le premier épisode d'une fiche atterrit dans le rail
   * des saisons — qui est à sa gauche — au lieu des onglets qui sont au-dessus.
   *
   * - absent : ordre du DOM, comportement historique
   * - `'id'`  : saut vers la portée nommée
   * - `null`  : sortie fermée, la flèche ne mène nulle part
   */
  neighbors?: {
    left?: string | null;
    right?: string | null;
    up?: string | null;
    down?: string | null;
  };
  /**
   * Index d'entrée fixe, qui l'emporte sur la mémoire.
   *
   * Pour la barre de navigation : on y entre toujours sur l'entrée de la page
   * courante, jamais sur la dernière visitée ni sur la première. Sans ça, la
   * première flèche d'une page atterrissait sur la loupe — première pastille
   * depuis le bandeau façon Netflix — alors qu'on est sur Films.
   */
  entry?: number;
}

export interface Position {
  scopeId: string;
  index: number;
}

export interface NavState {
  /** Portées dans l'ordre vertical d'affichage. */
  scopes: Scope[];
  current: Position | null;
  /**
   * Dernier index visité par portée. Permet de retrouver sa place en revenant
   * dans une rangée qu'on avait quittée par le haut ou par le bas.
   */
  memory: Record<string, number>;
}

function clamp(value: number, max: number): number {
  if (max < 0) return 0;
  return Math.min(Math.max(value, 0), max);
}

function scopeIndexOf(state: NavState, scopeId: string): number {
  return state.scopes.findIndex(scope => scope.id === scopeId);
}

/**
 * Ce qu'on mémorise en quittant une portée, pour y revenir au même endroit.
 * Sur une grille c'est la colonne ; sur une rangée, l'index exact.
 */
function memoryValue(scope: Scope, index: number): number {
  if (scope.orientation === 'grid' && scope.columns && scope.columns > 0) {
    return index % scope.columns;
  }
  return index;
}

/**
 * Colonne transmise à une portée voisine jamais visitée.
 *
 * Seules les grilles ont des colonnes visuellement alignables. Dans un
 * carrousel défilant, l'élément 42 peut se trouver n'importe où à l'écran :
 * propager son index comme « colonne » ferait atterrir n'importe où. On entre
 * donc au début, ce qui est prévisible.
 */
function columnHintFrom(scope: Scope, index: number): number {
  if (scope.orientation === 'grid' && scope.columns && scope.columns > 0) {
    return index % scope.columns;
  }
  return 0;
}

/** Premier index d'une portée voisine, en tenant compte de la mémoire. */
function entryIndex(state: NavState, scope: Scope, columnHint: number): number {
  if (scope.entry !== undefined) return clamp(scope.entry, scope.count - 1);
  const remembered = state.memory[scope.id];
  const target = remembered === undefined ? columnHint : remembered;
  return clamp(target, scope.count - 1);
}

/** Saut latéral vers une portée voisine déclarée. */
function moveToNeighborScope(
  state: NavState,
  scope: Scope,
  direction: 'left' | 'right',
): Position | null {
  const neighborId = scope.neighbors?.[direction];
  if (!neighborId) return null;
  const neighbor = state.scopes.find(candidate => candidate.id === neighborId);
  if (!neighbor || neighbor.count === 0) return null;
  return { scopeId: neighbor.id, index: entryIndex(state, neighbor, 0) };
}

function moveToAdjacentScope(
  state: NavState,
  direction: 'up' | 'down',
  columnHint: number,
): Position | null {
  if (!state.current) return null;
  const position = scopeIndexOf(state, state.current.scopeId);
  if (position === -1) return null;

  // Une déclaration explicite l'emporte sur l'ordre du DOM. `null` ferme la
  // sortie : c'est ce qui empêche le rail des saisons de déverser le focus
  // dans la liste d'épisodes, qui est à sa droite et non en dessous.
  const declared = state.scopes[position].neighbors?.[direction];
  if (declared === null) return null;
  if (declared !== undefined) {
    const target = state.scopes.find(scope => scope.id === declared);
    // Voisin absent ou vide : on retombe sur l'ordre du DOM plutôt que de
    // bloquer. Une portée déclarée peut n'être pas encore montée.
    if (target && target.count > 0) {
      return { scopeId: target.id, index: entryIndex(state, target, columnHint) };
    }
  }

  const step = direction === 'down' ? 1 : -1;
  // On saute les portées vides : une rangée dont le chargement n'a rien renvoyé
  // ne doit pas piéger le focus.
  for (let i = position + step; i >= 0 && i < state.scopes.length; i += step) {
    const scope = state.scopes[i];
    if (scope.count > 0) {
      return { scopeId: scope.id, index: entryIndex(state, scope, columnHint) };
    }
  }
  return null;
}

/**
 * @returns la position visée, ou `null` si le mouvement ne mène nulle part —
 *   auquel cas l'appelant laisse l'événement filer (défilement de page, ou rien).
 */
function enterFirstScope(state: NavState): Position | null {
  const first = state.scopes.find(scope => scope.count > 0);
  return first ? { scopeId: first.id, index: entryIndex(state, first, 0) } : null;
}

export function resolveMove(state: NavState, direction: Direction): Position | null {
  if (state.scopes.length === 0) return null;

  // Aucun focus : la première flèche entre dans la première portée non vide.
  if (!state.current) return enterFirstScope(state);

  const scope = state.scopes.find(s => s.id === state.current!.scopeId);

  // La portée a disparu — rangée démontée, changement de saison… Le focus DOM
  // est perdu de toute façon ; sans ce repli, la télécommande resterait sans
  // effet jusqu'à ce que l'utilisateur clique quelque part.
  if (!scope) return enterFirstScope(state);

  // Portée vide mais toujours montée : cas transitoire d'un chargement en
  // cours. On ne déplace rien, le défilement de page prend le relais.
  if (scope.count === 0) return null;

  const index = clamp(state.current.index, scope.count - 1);
  const horizontal = direction === 'left' || direction === 'right';
  const step = direction === 'right' || direction === 'down' ? 1 : -1;

  if (scope.orientation === 'row') {
    if (horizontal) {
      const next = index + step;
      if (next >= 0 && next < scope.count) return { scopeId: scope.id, index: next };
      // Bouclage seulement là où il est explicitement demandé : voir `wrap`.
      if (scope.wrap && scope.count > 1) {
        return { scopeId: scope.id, index: (next + scope.count) % scope.count };
      }
      return moveToNeighborScope(state, scope, direction as 'left' | 'right');
    }
    return moveToAdjacentScope(state, direction as 'up' | 'down', columnHintFrom(scope, index));
  }

  if (scope.orientation === 'column') {
    if (!horizontal) {
      const next = index + step;
      if (next >= 0 && next < scope.count) {
        return { scopeId: scope.id, index: next };
      }
      return moveToAdjacentScope(state, direction as 'up' | 'down', columnHintFrom(scope, index));
    }
    return moveToNeighborScope(state, scope, direction as 'left' | 'right');
  }

  // grid
  const columns = scope.columns && scope.columns > 0 ? scope.columns : 1;
  const column = index % columns;
  const row = Math.floor(index / columns);

  if (horizontal) {
    const nextColumn = column + step;
    if (nextColumn < 0 || nextColumn >= columns) {
      return moveToNeighborScope(state, scope, direction as 'left' | 'right');
    }
    const next = row * columns + nextColumn;
    if (next < scope.count) return { scopeId: scope.id, index: next };
    // Ligne incomplète : le bord réel est atteint, on tente le voisin.
    return moveToNeighborScope(state, scope, direction as 'left' | 'right');
  }

  const nextRow = row + step;
  if (nextRow < 0) {
    return moveToAdjacentScope(state, 'up', column);
  }
  const next = nextRow * columns + column;
  if (next >= scope.count) {
    // Dernière ligne incomplète : on tolère de retomber sur le dernier élément
    // plutôt que de bloquer, sauf s'il n'y a carrément plus de ligne.
    if (nextRow * columns < scope.count) {
      return { scopeId: scope.id, index: scope.count - 1 };
    }
    return moveToAdjacentScope(state, 'down', column);
  }
  return { scopeId: scope.id, index: next };
}

/** Mémorise la colonne quittée, pour le retour dans cette portée. */
export function rememberPosition(state: NavState, position: Position): NavState {
  const scope = state.scopes.find(s => s.id === position.scopeId);
  if (!scope) return state;
  return {
    ...state,
    current: position,
    memory: { ...state.memory, [position.scopeId]: memoryValue(scope, position.index) },
  };
}

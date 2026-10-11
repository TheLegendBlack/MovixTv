import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFocusItem, useFocusScope } from './nav/hooks';
import { useTvFocusContext } from './nav/focusContext';
import { peekFocusRestore, saveFocusRestore, takeFocusRestore, type FocusRestore } from './nav/focusRestore';
import { TvTopNav, TV_TOP_NAV_SCOPE } from './components/TvTopNav';
import { TvRow, TV_SAFE_X, type TvRowItemState } from './components/TvRow';
import { TvCard } from './components/TvCard';
import { useTvRows } from './data/useTvRows';
import { metaLine, type TvMediaItem, type TvRowLayoutName } from './data/tmdb';

/**
 * Page de parcours : une bannière, puis des rangées.
 *
 * C'est le squelette commun de l'accueil, de la page Films et, bientôt, de la
 * page Séries. Ce qui les distingue tient dans trois props : la liste ordonnée
 * des rangées, la rangée qui alimente la bannière, et une éventuelle rangée
 * de tête qui n'est pas du catalogue TMDB — la reprise de lecture sur
 * l'accueil. Aucune condition sur la page dans le corps : tout ce qui est
 * propre à une page vient de sa configuration.
 *
 * Trois partis pris, dans l'ordre d'importance.
 *
 * **La page ne défile pas.** Elle est haute de 540 px CSS, en `overflow: hidden`,
 * et c'est une colonne interne qui se déplace par `transform`. Le focus reste
 * ainsi sur une ligne fixe : quand on descend d'une rangée, c'est la page qui
 * glisse pour ramener la rangée active à 150 px du haut, jamais le focus qui
 * part vers le bas. C'est l'essentiel de la sensation de fluidité de Disney+, et
 * ça évite surtout que `element.focus()` déclenche un défilement natif — qui
 * repasse par la mise en page et entre en conflit avec la virtualisation.
 *
 * **La bannière est plein cadre.** L'image occupe les 960 px, et ce sont trois
 * dégradés statiques qui la rendent lisible. La version précédente calait
 * l'image à droite à son format natif pour éviter un agrandissement de `w1280`,
 * ce qui laissait une coupure verticale au milieu de l'écran ; le problème se
 * règle à la source, en demandant `original` pour la seule image affichée en
 * grand. Jamais de `backdrop-filter` : il coûtait un quart du budget d'image.
 *
 * **La bannière porte cinq titres, pas un.** Gauche/Droite change de
 * diapositive, l'index de focus *est* l'index de diapositive — ce qui évite
 * d'inventer un second mécanisme de sélection à côté du moteur de navigation.
 */

/* ------------------------------------------------------------------ *
 * Géométrie verticale de la bannière.
 *
 * Ces valeurs se contraignent mutuellement, et les laisser indépendantes
 * était une erreur : la première version plaçait les points de pagination à
 * 24 px du bas de la bannière alors que les rangées remontent de 52 px sur
 * cette même bannière. Les points tombaient donc 22 px *dans* la zone occupée
 * par le titre de la première rangée. On dérive maintenant tout de deux
 * nombres, et l'invariant est vérifiable à la lecture.
 *
 *   0                          haut de la bannière
 *   64                         bas de la barre de navigation
 *   ...                        bloc de texte de la diapositive
 *   HERO_CONTENT_BOTTOM        bas du bouton
 *   HERO_DOTS_BOTTOM + 6       les points
 *   HERO_HEIGHT - ROW_OVERLAP  ← rien ne doit descendre sous cette ligne
 *   HERO_HEIGHT                bas de la bannière
 * ------------------------------------------------------------------ */

const HERO_HEIGHT = 396;
/** Remontée des rangées sur la bannière : supprime la zone morte, façon Prime. */
const ROW_OVERLAP = 52;
/** Air entre les points et le titre de la première rangée. */
const DOTS_CLEARANCE = 22;
/** Air entre le bouton et les points. */
const BUTTON_CLEARANCE = 14;
const DOTS_HEIGHT = 6;

/** Décalage des points depuis le bas de la bannière. */
const HERO_DOTS_BOTTOM = ROW_OVERLAP + DOTS_CLEARANCE;
/** Marge basse du bloc de texte des diapositives. */
const HERO_CONTENT_BOTTOM = HERO_DOTS_BOTTOM + DOTS_HEIGHT + BUTTON_CLEARANCE;

/** Hauteur à laquelle se cale la rangée focalisée. */
const FOCUS_LINE = 150;
const HERO_SLIDES = 5;
const HERO_INTERVAL = 9000;

type FocusZone = 'idle' | 'nav' | 'hero' | 'row';

export interface TvBrowseNeighbors {
  up?: string | null;
  down?: string | null;
}

/**
 * Rangée hors catalogue TMDB, placée avant les autres.
 *
 * La page l'inscrit dans l'ordre vertical — voisins, ligne de focus, état
 * actif — et lui délègue le rendu. Elle en connaît l'identifiant, rien d'autre.
 */
export interface TvBrowseLeadingRow {
  id: string;
  render: (row: {
    active: boolean;
    neighbors: TvBrowseNeighbors;
    onRowEnter: () => void;
  }) => React.ReactNode;
}

interface TvBrowseProps {
  /** Identifiants de rangées, dans l'ordre d'affichage. Constante de module : voir `useTvRows`. */
  rowIds: readonly string[];
  /** Rangée dont les cinq premiers titres alimentent la bannière ; elle reprend au sixième. */
  heroRowId: string;
  leading?: TvBrowseLeadingRow | null;
}

/**
 * Rendus de carte, en constantes de module.
 *
 * `TvRow` est mémoïsé et `renderItem` fait partie de ses props : une lambda
 * écrite dans le JSX de la page serait neuve à chaque rendu, et chaque
 * changement de diapositive re-rendrait toutes les rangées — exactement ce
 * que la mémoïsation est censée empêcher.
 */
const renderPosterCard = (item: TvMediaItem, state: TvRowItemState): React.ReactNode => (
  <TvCard
    title={item.title}
    subtitle={item.year}
    meta={metaLine(item)}
    imageUrl={item.posterUrl}
    focused={state.focused}
    rowFocused={state.rowFocused}
  />
);

const renderRankCard = (item: TvMediaItem, state: TvRowItemState): React.ReactNode => (
  <TvCard
    layout="rank"
    rank={state.index + 1}
    title={item.title}
    subtitle={item.year}
    meta={metaLine(item)}
    imageUrl={item.posterUrl}
    focused={state.focused}
    rowFocused={state.rowFocused}
  />
);

const rendererFor = (layout: TvRowLayoutName | undefined) =>
  layout === 'rank' ? renderRankCard : renderPosterCard;

const TvBrowse: React.FC<TvBrowseProps> = ({ rowIds, heroRowId, leading = null }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { focus } = useTvFocusContext();
  const { status, rows } = useTvRows(rowIds);

  const columnRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());

  const [zone, setZone] = useState<FocusZone>('idle');
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const activeRowIdRef = useRef<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  /**
   * La bannière consomme les cinq premiers titres de sa rangée source, qui
   * reprend au sixième. Répéter en rangée ce qu'on vient de montrer en grand
   * donne l'impression d'un catalogue qui se répète.
   */
  const heroItems = useMemo(() => {
    const source = rows.find(row => row.id === heroRowId) ?? rows[0];
    return source?.items.slice(0, HERO_SLIDES) ?? [];
  }, [rows, heroRowId]);

  const catalogRows = useMemo(
    () =>
      rows.map(row =>
        row.id === heroRowId ? { ...row, items: row.items.slice(HERO_SLIDES) } : row,
      ),
    [rows, heroRowId],
  );

  const leadingId = leading?.id ?? null;

  /** Ordre vertical réel, rangée de tête comprise. Sert à déclarer les voisins. */
  const verticalOrder = useMemo(() => {
    const ids = catalogRows.filter(row => row.items.length > 0).map(row => row.id);
    return leadingId ? [leadingId, ...ids] : ids;
  }, [catalogRows, leadingId]);

  /**
   * Voisins mémorisés par identifiant, recalculés seulement quand l'ordre
   * change. Un littéral `{ up, down }` neuf à chaque rendu suffirait à casser
   * la mémoïsation de `TvRow` — voir `renderPosterCard`.
   */
  const neighborsById = useMemo(() => {
    const map = new Map<string, TvBrowseNeighbors>();
    verticalOrder.forEach((id, index) => {
      map.set(id, {
        up: index === 0 ? 'hero' : verticalOrder[index - 1],
        // `undefined` et non `null` : le moteur retombe alors sur l'ordre du DOM,
        // ce qui laisse la dernière rangée atteindre celles qui n'ont pas encore
        // fini de charger.
        down: index < verticalOrder.length - 1 ? verticalOrder[index + 1] : undefined,
      });
    });
    return map;
  }, [verticalOrder]);

  const fallbackNeighbors = useMemo<TvBrowseNeighbors>(() => ({ up: 'hero' }), []);
  const neighborsFor = useCallback(
    (id: string) => neighborsById.get(id) ?? fallbackNeighbors,
    [neighborsById, fallbackNeighbors],
  );

  /**
   * Escamotage de la barre de navigation.
   *
   * Elle se retire dès que le focus passe sous le bouton de la bannière. Deux
   * raisons : elle n'est plus atteignable d'un seul appui à ce moment-là, donc
   * elle n'informe plus ; et comme elle ne suit pas la colonne, le titre de la
   * bannière lui passait au travers en glissant vers le haut.
   *
   * Opacité et `translate` uniquement, écrits hors du cycle de rendu : la barre
   * part dans la même frame que la colonne, sans re-rendre les rangées.
   */
  const applyChrome = useCallback((hidden: boolean) => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    chrome.style.opacity = hidden ? '0' : '1';
    chrome.style.transform = hidden ? 'translate3d(0, -14px, 0)' : 'translate3d(0, 0, 0)';
  }, []);

  /**
   * Déplacement vertical de la colonne.
   *
   * Écrit directement dans le DOM, hors du cycle de rendu React : la position
   * est à l'écran avant même que React ne soit informé du changement. C'est le
   * levier principal sur la latence touche→image — un rendu de rangée coûte plus
   * cher que le déplacement lui-même.
   */
  const applyReveal = useCallback(() => {
    const column = columnRef.current;
    if (!column) return;
    const id = activeRowIdRef.current;
    let offset = 0;
    if (id) {
      const element = rowRefs.current.get(id);
      if (element) offset = Math.max(0, element.offsetTop - FOCUS_LINE);
    }
    column.style.transform = `translate3d(0, ${-offset}px, 0)`;
    if (dimRef.current) dimRef.current.style.opacity = id ? '0.88' : '0';
  }, []);

  const enterRow = useCallback(
    (id: string) => {
      if (activeRowIdRef.current === id) return;
      activeRowIdRef.current = id;
      applyReveal();
      applyChrome(true);
      setActiveRowId(id);
      setZone('row');
    },
    [applyChrome, applyReveal],
  );

  const leaveRows = useCallback(
    (nextZone: FocusZone) => {
      if (activeRowIdRef.current !== null) {
        activeRowIdRef.current = null;
        applyReveal();
        setActiveRowId(null);
      }
      applyChrome(false);
      setZone(nextZone);
    },
    [applyChrome, applyReveal],
  );

  /**
   * Les rangées arrivent en deux vagues : une insertion au-dessus de la rangée
   * focalisée décalerait tout le contenu sous le focus. On recalcule la position
   * après chaque changement, avant peinture. L'apparition de la rangée de tête
   * compte aussi : elle pousse tout ce qui suit.
   */
  useLayoutEffect(() => {
    applyReveal();
  }, [applyReveal, catalogRows, leadingId]);

  /** Rotation automatique tant que personne ne tient la bannière. */
  React.useEffect(() => {
    if (heroItems.length < 2) return;
    if (zone !== 'idle' && zone !== 'nav') return;
    const timer = window.setInterval(
      () => setHeroIndex(index => (index + 1) % heroItems.length),
      HERO_INTERVAL,
    );
    return () => window.clearInterval(timer);
  }, [heroItems.length, zone]);

  const openMedia = useCallback(
    (item: { id: number; mediaType: 'movie' | 'tv' }) =>
      navigate(`/tvapp/${item.mediaType}/${item.id}`),
    [navigate],
  );

  /**
   * Rappels stables, mémorisés par identifiant de rangée.
   *
   * `TvRow` est mémoïsé : une lambda recréée à chaque rendu annulerait la
   * mémoïsation. Et pour les `ref`, une fonction neuve à chaque rendu force
   * React à détacher puis rattacher la référence à chaque commit — inutile, et
   * un chemin de plus par lequel `rowRefs` peut se retrouver à `null` au
   * mauvais moment.
   */
  const handlers = useRef(new Map<string, () => void>());
  const refs = useRef(new Map<string, (element: HTMLDivElement | null) => void>());

  const rowFocusHandler = useCallback(
    (id: string) => {
      let handler = handlers.current.get(id);
      if (!handler) {
        handler = () => enterRow(id);
        handlers.current.set(id, handler);
      }
      return handler;
    },
    [enterRow],
  );

  /**
   * Descripteurs « Voir plus », mémorisés comme les autres rappels : `TvRow`
   * est mémoïsé, et un objet recréé à chaque rendu annulerait la mémoïsation
   * pour toutes les rangées concernées.
   */
  const collections = useRef(new Map<string, { onSelect: () => void }>());
  // Lus au moment du clic, via des refs : les descripteurs restent stables.
  const rowsRef = useRef(catalogRows);
  rowsRef.current = catalogRows;
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const openCollection = useCallback(
    (id: string) => {
      let descriptor = collections.current.get(id);
      if (!descriptor) {
        descriptor = {
          onSelect: () => {
            // La carte « Voir plus » est la dernière de la rangée, après ses
            // titres : c'est là que le retour doit reposer le focus.
            const row = rowsRef.current.find(candidate => candidate.id === id);
            saveFocusRestore({ path: pathRef.current, scopeId: id, index: row?.items.length ?? 0 });
            navigate(`/tvapp/collection/${id}`);
          },
        };
        collections.current.set(id, descriptor);
      }
      return descriptor;
    },
    [navigate],
  );

  /**
   * Retour d'une collection : dès que la rangée quittée est remontée — elle
   * arrive avec sa vague, une ou deux secondes après la page — le focus
   * retourne sur sa carte « Voir plus ». `TvRow` a enregistré sa portée dans
   * son propre effet, qui court avant celui-ci.
   *
   * Lu sans être consommé à l'initialisation : en développement, React appelle
   * l'initialiseur deux fois (mode strict). L'enregistrement n'est retiré qu'au
   * moment où le focus est demandé.
   *
   * La demande est répétée à intervalles courts tant que rien n'a le focus :
   * au premier rendu de la rangée, le virtualiseur n'a pas encore mesuré sa
   * fenêtre, et amener la carte à l'écran ne fait rien — la première demande
   * restait lettre morte (mesuré le 15/09/2026). Les suivantes trouvent la
   * rangée mesurée, font apparaître la carte, et le moteur la focalise.
   */
  const restoreRef = useRef<FocusRestore | null>(peekFocusRestore(location.pathname));
  const restoreTimers = useRef<number[]>([]);
  React.useEffect(() => {
    const restore = restoreRef.current;
    if (!restore) return;
    const row = catalogRows.find(candidate => candidate.id === restore.scopeId);
    if (!row || row.items.length === 0) return;
    restoreRef.current = null;
    takeFocusRestore(restore.path);
    const target = { scopeId: restore.scopeId, index: Math.min(restore.index, row.items.length) };
    restoreTimers.current = [0, 120, 400, 1000].map(delay =>
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        focus(target);
      }, delay),
    );
  }, [catalogRows, focus]);
  React.useEffect(() => () => restoreTimers.current.forEach(timer => window.clearTimeout(timer)), []);

  const registerRow = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (element: HTMLDivElement | null) => rowRefs.current.set(id, element);
      refs.current.set(id, ref);
    }
    return ref;
  }, []);

  const activeHero = heroItems[heroIndex] ?? null;

  return (
    // `overflow-clip` et non `overflow-hidden` : les deux rognent pareil, mais
    // `clip` ne crée pas de conteneur défilable. C'est ce qui empêche
    // `element.focus()` d'aller y défiler dans notre dos. Exactement l'inverse
    // du besoin des rangées, où `hidden` est obligatoire puisque le
    // virtualiseur pilote `scrollLeft`.
    <div className="relative h-[var(--tv-screen-height,100vh)] w-full overflow-clip bg-movix-ink text-white">
      <TvHeroBackdrop url={activeHero?.heroUrl ?? null} />

      {/* Assombrissement de la bannière quand le focus descend dans les rangées.
          Une opacité sur un aplat déjà rastérisé : coût compositeur nul. */}
      <div
        ref={dimRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-movix-ink transition-opacity duration-300"
        style={{ opacity: 0 }}
      />

      <div className="relative h-full">
        {/* Hors flux, au-dessus de la bannière. En flux, elle poussait la
            colonne de ses 64 px et toute la géométrie verticale de la bannière
            se retrouvait décalée d'autant. */}
        <div
          ref={chromeRef}
          className="absolute inset-x-0 top-0 z-20 transition-[opacity,transform] duration-200 ease-out"
          style={{ opacity: 1, transform: 'translate3d(0, 0, 0)' }}>
          <TvTopNav
            transparent
            neighbors={{ up: null, down: 'hero' }}
            onFocusEnter={() => leaveRows('nav')}
          />
        </div>

        <div
          ref={columnRef}
          className="will-change-transform"
          style={{ transition: 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)' }}>
          <TvHero
            items={heroItems}
            index={heroIndex}
            downTo={verticalOrder[0]}
            onIndexChange={setHeroIndex}
            onFocusEnter={() => leaveRows('hero')}
            onOpen={openMedia}
          />

          <div style={{ marginTop: -ROW_OVERLAP }}>
            {status === 'loading' && <TvNotice>Chargement du catalogue…</TvNotice>}

            {status === 'no-key' && (
              <TvNotice>
                Aucune <strong className="font-semibold text-amber-300">clé TMDB</strong> :
                le catalogue ne peut pas être chargé. Renseignez-la dans Paramètres, Clé TMDB.
              </TvNotice>
            )}

            {status === 'error' && (
              <TvNotice>
                Le catalogue n'a pas pu être chargé. Vérifiez la connexion réseau de la
                télévision.
              </TvNotice>
            )}

            {leading && (
              <div ref={registerRow(leading.id)}>
                {leading.render({
                  active: activeRowId === leading.id,
                  neighbors: neighborsFor(leading.id),
                  onRowEnter: rowFocusHandler(leading.id),
                })}
              </div>
            )}

            {catalogRows.map(row => (
              <div key={row.id} ref={registerRow(row.id)}>
                <TvRow<TvMediaItem>
                  id={row.id}
                  title={row.title}
                  items={row.items}
                  layout={row.layout ?? 'poster'}
                  active={activeRowId === row.id}
                  neighbors={neighborsFor(row.id)}
                  onRowEnter={rowFocusHandler(row.id)}
                  more={row.collection ? openCollection(row.id) : undefined}
                  onSelect={openMedia}
                  renderItem={rendererFor(row.layout)}
                />
              </div>
            ))}

            {/* Sans cette réserve, la dernière rangée ne peut pas remonter
                jusqu'à la ligne de focus : il n'y a plus rien à faire glisser. */}
            <div style={{ height: 240 }} />
          </div>
        </div>
      </div>
    </div>
  );
};

const TvNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    className="mb-8 max-w-[520px] rounded-xl border border-white/10 bg-white/[0.03] p-5 text-base leading-relaxed text-white/60"
    style={{ marginLeft: TV_SAFE_X }}>
    {children}
  </p>
);

/**
 * Fond de la bannière.
 *
 * Le fondu enchaîné se fait par superposition et non par transition : la
 * nouvelle image arrive au-dessus de l'ancienne et monte en opacité par une
 * animation CSS, l'ancienne restant visible dessous jusqu'à ce qu'elle soit
 * retirée. Faire monter une opacité depuis 0 sur un élément qui vient d'être
 * monté demande une frame d'attente, et cette frame se voit sur ce SoC.
 *
 * On ne garde jamais plus de deux couches : une image `original` décodée pèse
 * environ 8 Mo de bitmap, et cinq diapositives montées d'avance suffiraient à
 * mettre le téléviseur en difficulté.
 */
const TvHeroBackdrop: React.FC<{ url: string | null }> = ({ url }) => {
  const [layers, setLayers] = useState<string[]>([]);

  React.useEffect(() => {
    if (!url) return;
    setLayers(previous => {
      if (previous[previous.length - 1] === url) return previous;
      return [...previous.slice(-1), url];
    });
  }, [url]);

  React.useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers(current => current.slice(-1)), 600);
    return () => window.clearTimeout(timer);
  }, [layers]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: HERO_HEIGHT }}>
      {layers.map((layer, index) => (
        <img
          key={layer}
          src={layer}
          alt=""
          decoding="async"
          className={
            'absolute inset-0 h-full w-full object-cover ' +
            (index === layers.length - 1 && layers.length > 1 ? 'animate-heroFade' : '')
          }
        />
      ))}

      {/* Trois dégradés statiques, écrits en dur : les arrêts sont calés sur la
          zone de texte, et les utilitaires Tailwind ne les expriment pas
          lisiblement. Statiques et non animés — un dégradé recalculé à chaque
          frame, c'est un repaint plein écran, le cas mesuré à 44 fps. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(var(--tv-ink)) 0%, rgb(var(--tv-ink) / 0.92) 20%, rgb(var(--tv-ink) / 0.55) 42%, rgb(var(--tv-ink) / 0) 68%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        style={{
          backgroundImage: 'linear-gradient(to top, rgb(var(--tv-ink)) 8%, rgb(var(--tv-ink) / 0) 100%)',
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-24"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, rgb(var(--tv-ink) / 0.75) 0%, rgb(var(--tv-ink) / 0) 100%)',
        }}
      />
    </div>
  );
};

interface TvHeroProps {
  items: TvMediaItem[];
  index: number;
  downTo?: string;
  onIndexChange: (index: number) => void;
  onFocusEnter: () => void;
  onOpen: (item: TvMediaItem) => void;
}

/**
 * Bannière.
 *
 * Les cinq diapositives sont montées en permanence et empilées ; seule l'active
 * est visible. Les boutons des diapositives masquées restent focalisables, ce
 * qui est exactement ce qu'on veut : le focus arrive sur l'index 2, la
 * diapositive 2 devient visible. Aucun second mécanisme de sélection à
 * maintenir, et `resolveMove` fait tout le travail.
 */
const TvHero: React.FC<TvHeroProps> = ({
  items,
  index,
  downTo,
  onIndexChange,
  onFocusEnter,
  onOpen,
}) => {
  const scopeRef = useFocusScope({
    id: 'hero',
    orientation: 'row',
    count: items.length,
    // Le bouclage n'a pas de sens sur une rangée de 200 titres ; sur cinq
    // diapositives, en revanche, buter sur la dernière est simplement agaçant.
    wrap: true,
    neighbors: { up: TV_TOP_NAV_SCOPE, down: downTo },
    // On entre toujours sur la diapositive affichée. La bannière tourne toute
    // seule tant que personne ne la tient : entrer sur la diapositive 0 par
    // défaut visait un bouton masqué dès que la rotation l'avait dépassée — le
    // focus DOM échouait en silence, la pastille du bandeau restait allumée, et
    // la flèche suivante sautait la bannière pour tomber dans la première
    // rangée (mesuré le 15/09/2026).
    entry: index,
  });

  return (
    <section ref={scopeRef} className="relative" style={{ height: HERO_HEIGHT }}>
      {items.map((item, slideIndex) => (
        <TvHeroSlide
          key={`${item.mediaType}-${item.id}`}
          item={item}
          index={slideIndex}
          visible={slideIndex === index}
          onIndexChange={onIndexChange}
          onFocusEnter={onFocusEnter}
          onOpen={onOpen}
        />
      ))}

      {items.length > 1 && (
        <div
          className="absolute flex items-center gap-2"
          style={{ left: TV_SAFE_X, bottom: HERO_DOTS_BOTTOM, height: DOTS_HEIGHT }}>
          {items.map((item, dotIndex) => (
            <span
              key={`${item.mediaType}-${item.id}`}
              className="rounded-full transition-all duration-200"
              style={{
                height: DOTS_HEIGHT,
                width: dotIndex === index ? 20 : DOTS_HEIGHT,
                backgroundColor: dotIndex === index ? '#ffffff' : 'rgba(255,255,255,0.32)',
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
};

const TvHeroSlide: React.FC<{
  item: TvMediaItem;
  index: number;
  visible: boolean;
  onIndexChange: (index: number) => void;
  onFocusEnter: () => void;
  onOpen: (item: TvMediaItem) => void;
}> = ({ item, index, visible, onIndexChange, onFocusEnter, onOpen }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>('hero', index);

  React.useEffect(() => {
    if (!focused) return;
    onIndexChange(index);
    onFocusEnter();
  }, [focused, index, onIndexChange, onFocusEnter]);

  return (
    <div
      className="absolute inset-0 flex flex-col justify-end transition-opacity duration-300"
      style={{
        paddingLeft: TV_SAFE_X,
        paddingBottom: HERO_CONTENT_BOTTOM,
        opacity: visible ? 1 : 0,
        // Masquée : plus rien à peindre, mais le bouton reste focalisable.
        visibility: visible ? 'visible' : 'hidden',
      }}>
      <div className="[text-shadow:0_2px_12px_rgba(0,0,0,0.9)]">
        {/* Deux lignes au maximum : « Spider-Man : Brand New Day » en occupe
            déjà deux, et une troisième ferait remonter tout le bloc derrière la
            barre de navigation. */}
        <h2 className="line-clamp-2 max-w-[440px] text-[36px] font-black leading-[1.05] tracking-tight">
          {item.title}
        </h2>
        <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-white/55">
          {item.mediaType === 'tv' ? 'Série' : 'Film'}
          {item.year ? ` · ${item.year}` : ''}
        </p>
        {item.overview && (
          <p className="mt-3 max-w-[420px] text-[15px] leading-[1.5] text-white/80 line-clamp-2">
            {item.overview}
          </p>
        )}
      </div>

      <div className="mt-4">
        <button
          ref={ref}
          {...focusProps}
          type="button"
          onClick={() => onOpen(item)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onOpen(item);
            }
          }}
          className={
            'relative rounded-full px-8 py-3 text-[17px] font-bold outline-none transition-transform duration-150 [text-shadow:none] ' +
            (focused ? 'scale-[1.04] bg-tv-focus text-tv-on-focus' : 'bg-white/25 text-white')
          }
          style={{ boxShadow: focused ? '0 0 0 3px rgb(var(--tv-focus) / 0.35)' : 'none' }}>
          Voir la fiche
        </button>
      </div>
    </div>
  );
};

export default TvBrowse;

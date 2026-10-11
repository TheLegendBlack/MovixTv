import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFocusItem, useFocusScope } from './nav/hooks';
import { useTvFocusContext } from './nav/focusContext';
import { TvCard } from './components/TvCard';
import { TV_KEYBOARD_WIDTH } from './components/TvKeyboard';
import { PREVIEW_GAP, PREVIEW_HEIGHT, TvPreviewBanner } from './components/TvPreviewBanner';
import { TV_CARD_GAP, TV_CARD_LABEL_HEIGHT, TV_LAYOUTS, TV_SAFE_X } from './components/TvRow';
import { fetchRowPage, getRowSpec, metaLine, type TvMediaItem } from './data/tmdb';

/**
 * Page de collection : ce qui s'ouvre derrière la carte « Voir plus ».
 *
 * Elle interroge **la même requête que la rangée**, paginée. Redéfinir des
 * critères ici garantirait qu'elle finisse par diverger de la rangée qui y
 * mène : on appuierait sur « Voir plus » pour voir autre chose.
 *
 * ## Disposition
 *
 * Calquée sur la recherche, pour que l'œil retrouve la même chose au même
 * endroit : une colonne de gauche de la largeur du clavier — ici la flèche de
 * retour, le titre de la collection et son compte — et, à droite, le bandeau
 * de prévisualisation au-dessus d'une grille de quatre affiches. Le bandeau
 * suit la carte focalisée et reste affiché quand le focus passe sur la flèche.
 *
 * La flèche ramène **exactement** sur la carte « Voir plus » quittée : la page
 * de parcours a noté d'où l'on venait (voir `focusRestore`), et `navigate(-1)`
 * — le même chemin que la touche Retour de la télécommande — la remonte, puis
 * elle rend le focus à cette carte dès que sa rangée est là.
 *
 * ## Grille
 *
 * **Pas de virtualisation.** Une grille de cent affiches, c'est cent nœuds — ce
 * que Chromium encaisse sans broncher. Ce sont les *images* qui coûtent, et
 * `loading="lazy"` s'en charge : les affiches hors champ ne sont jamais
 * décodées. Le plafond de cinq pages borne ce que la mémoire accumule au fil
 * du parcours, pas le catalogue.
 *
 * **Le défilement est calculé, pas mesuré.** Sur une grille régulière, la
 * position d'une ligne se déduit de son index — inutile de lire un `offsetTop`,
 * donc inutile de forcer un recalcul de mise en page à chaque déplacement.
 *
 * Le chargement dépend de `rowId`, pas de la spec : `getRowSpec` renvoie un
 * objet neuf à chaque appel, et l'avoir mis dans les dépendances de l'effet
 * relançait la requête à chaque rendu — chaque réponse en provoquant un. La
 * page tournait en boucle, moteur de rendu à 100 %, et plus aucune touche ne
 * répondait (mesuré le 15/09/2026).
 */

const COLUMNS = 4;
const LAYOUT = 'compact' as const;
const PITCH_Y = TV_LAYOUTS[LAYOUT].height + TV_CARD_LABEL_HEIGHT + TV_CARD_GAP;
/** Débord de la grille, pour que l'anneau de focus de la première colonne ne soit pas rogné. */
const BLEED = 8;
/** Marge haute de la page, celle du bandeau de la barre de navigation ailleurs. */
const TOP = 24;
/** La grille commence sous le bandeau, toujours présent ici. */
const GRID_SHIFT = PREVIEW_HEIGHT + PREVIEW_GAP;
const SLIDE = 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)';
const MAX_PAGES = 5;
/** Deux lignes d'avance : le temps que TMDB réponde, on n'a pas atteint le bord. */
const PREFETCH_ROWS = 2;

const SCOPE = 'collection';
const BACK_SCOPE = 'collection-retour';

const keyOf = (item: TvMediaItem): string => `${item.mediaType}:${item.id}`;

const TvCollection: React.FC = () => {
  const navigate = useNavigate();
  const { rowId = '' } = useParams<{ rowId: string }>();
  const spec = useMemo(() => getRowSpec(rowId), [rowId]);
  const { focus, focused } = useTvFocusContext();

  const [items, setItems] = useState<TvMediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    let cancelled = false;

    fetchRowPage(rowId, page, controller.signal)
      .then(result => {
        if (cancelled) return;
        setTotalPages(result.totalPages);
        setItems(previous => {
          const seen = new Set(previous.map(keyOf));
          const fresh = result.items.filter(item => !seen.has(keyOf(item)));
          return fresh.length > 0 ? [...previous, ...fresh] : previous;
        });
        setStatus('ready');
      })
      .catch(() => {
        // Une page suivante qui échoue ne doit pas vider ce qui est déjà à
        // l'écran : seule la toute première fait basculer en erreur.
        if (!cancelled) setStatus(current => (page === 1 ? 'error' : current));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [rowId, page, spec]);

  // La première page arrive : le focus se pose sur la première affiche, pas
  // sur la flèche — on est venu pour parcourir, le retour est à une touche.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || items.length === 0) return;
    placed.current = true;
    focus({ scopeId: SCOPE, index: 0 });
  }, [items.length, focus]);

  const focusedIndex =
    focused && focused.scopeId === SCOPE && items.length > 0
      ? Math.min(focused.index, items.length - 1)
      : -1;

  // Le bandeau garde le dernier titre parcouru quand le focus est sur la flèche.
  const lastPreviewed = useRef<TvMediaItem | null>(null);
  if (focusedIndex >= 0) lastPreviewed.current = items[focusedIndex];

  useEffect(() => {
    if (focusedIndex < 0) return;
    setPage(current =>
      focusedIndex >= items.length - COLUMNS * PREFETCH_ROWS
        && current < totalPages
        && current < MAX_PAGES
        ? current + 1
        : current,
    );
  }, [focusedIndex, items.length, totalPages]);

  const goBack = useCallback(() => navigate(-1), [navigate]);
  const openMedia = useCallback(
    (item: TvMediaItem) => navigate(`/tvapp/${item.mediaType}/${item.id}`),
    [navigate],
  );

  return (
    <div className="flex h-[var(--tv-screen-height,100vh)] flex-col overflow-hidden bg-movix-ink text-white">
      <div
        className="flex min-h-0 flex-1 gap-10"
        style={{ paddingLeft: TV_SAFE_X, paddingRight: TV_SAFE_X, paddingTop: TOP }}>
        <div className="shrink-0" style={{ width: TV_KEYBOARD_WIDTH }}>
          <TvBackButton onSelect={goBack} />
          <h1 className="mt-7 text-[24px] font-black leading-tight tracking-tight">
            {spec ? spec.title : 'Collection introuvable'}
          </h1>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            {spec
              ? items.length > 0
                ? `${items.length} titres`
                : status === 'loading'
                  ? 'Chargement…'
                  : ''
              : ''}
          </p>
          {!spec && (
            <p className="mt-4 text-[15px] text-white/55">
              Cette collection n'existe plus. Revenez en arrière pour reprendre votre
              navigation.
            </p>
          )}
          {spec && status === 'error' && (
            <p className="mt-4 text-[15px] text-white/55">
              La collection n'a pas pu être chargée. Vérifiez la connexion réseau de la
              télévision.
            </p>
          )}
        </div>

        <TvCollectionGrid
          items={items}
          focusedIndex={focusedIndex}
          previewed={lastPreviewed.current}
          onSelect={openMedia}
        />
      </div>
    </div>
  );
};

/**
 * La flèche de retour, en tête de la colonne de gauche. Une pastille de la
 * barre de navigation, avec la même mise en évidence au focus. Elle fait ce
 * que fait la touche Retour ; elle est là pour ceux qui cherchent des yeux.
 */
const TvBackButton: React.FC<{ onSelect: () => void }> = ({ onSelect }) => {
  const scopeRef = useFocusScope({
    id: BACK_SCOPE,
    orientation: 'row',
    count: 1,
    neighbors: { right: SCOPE, down: SCOPE, up: null },
  });
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(BACK_SCOPE, 0);

  return (
    <div ref={scopeRef} className="flex items-center gap-3">
      <button
        ref={ref}
        {...focusProps}
        type="button"
        aria-label="Retour"
        onClick={onSelect}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSelect();
          }
        }}
        className={
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full outline-none transition-transform duration-150 ' +
          (focused ? 'scale-105 bg-tv-focus text-tv-on-focus' : 'bg-white/15 text-white')
        }
        style={{ boxShadow: focused ? '0 0 0 3px rgb(var(--tv-focus) / 0.3)' : 'none' }}>
        <svg
          viewBox="0 0 24 24"
          width={22}
          height={22}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden>
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-[15px] text-white/60">Retour</span>
    </div>
  );
};

/**
 * Colonne de droite : le bandeau, puis la grille. La position de la grille est
 * écrite directement dans le DOM depuis un effet de mise en page : elle ne
 * dépend que de la ligne focalisée.
 */
const TvCollectionGrid: React.FC<{
  items: TvMediaItem[];
  focusedIndex: number;
  previewed: TvMediaItem | null;
  onSelect: (item: TvMediaItem) => void;
}> = ({ items, focusedIndex, previewed, onSelect }) => {
  const gridRef = useRef<HTMLDivElement>(null);

  const scopeRef = useFocusScope({
    id: SCOPE,
    orientation: 'grid',
    count: items.length,
    columns: COLUMNS,
    neighbors: {
      // Depuis le bord gauche de la grille comme depuis sa première ligne, on
      // retombe sur la flèche ; en bas, la grille est la fin de la page.
      left: BACK_SCOPE,
      up: BACK_SCOPE,
      down: null,
    },
  });

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const row = focusedIndex >= 0 ? Math.floor(focusedIndex / COLUMNS) : 0;
    grid.style.transform = `translate3d(0, ${GRID_SHIFT - row * PITCH_Y}px, 0)`;
  }, [focusedIndex, items]);

  return (
    <div className="relative min-w-0 flex-1">
      <TvPreviewBanner item={previewed} visible={previewed !== null} inset={BLEED} />

      <div ref={scopeRef} className="h-full" style={{ overflow: 'clip' }}>
        <div
          ref={gridRef}
          className="will-change-transform"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${COLUMNS}, ${TV_LAYOUTS[LAYOUT].width}px)`,
            columnGap: TV_CARD_GAP,
            rowGap: TV_CARD_GAP,
            padding: BLEED,
            transition: SLIDE,
          }}>
          {items.map((item, index) => (
            <TvCollectionCell key={keyOf(item)} item={item} index={index} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Mémoïsée, et c'est ce qui rend la grille non virtualisée viable : sur cent
 * cellules montées, un déplacement n'en re-rend que celles dont l'état de focus
 * a changé.
 */
const TvCollectionCell = React.memo<{
  item: TvMediaItem;
  index: number;
  onSelect: (item: TvMediaItem) => void;
}>(({ item, index, onSelect }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLDivElement>(SCOPE, index);

  return (
    <div
      ref={ref}
      {...focusProps}
      role="button"
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      onClick={() => onSelect(item)}
      className="outline-none">
      <TvCard
        layout={LAYOUT}
        title={item.title}
        subtitle={item.year}
        meta={metaLine(item)}
        imageUrl={item.posterUrl}
        focused={focused}
      />
    </div>
  );
});

TvCollectionCell.displayName = 'TvCollectionCell';

export default TvCollection;

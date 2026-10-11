import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { TvKeyboard, TV_KEYBOARD_WIDTH, tvKeyboardScopes } from './components/TvKeyboard';
import { TvCard } from './components/TvCard';
import {
  TV_CARD_GAP,
  TV_CARD_LABEL_HEIGHT,
  TV_LAYOUTS,
  TV_SAFE_X,
} from './components/TvRow';
import { TvTopNav, TV_TOP_NAV_SCOPE } from './components/TvTopNav';
import { PREVIEW_GAP, PREVIEW_HEIGHT, TvPreviewBanner } from './components/TvPreviewBanner';
import { useFocusItem, useFocusScope } from './nav/hooks';
import { useTvFocusContext } from './nav/focusContext';
import { fetchRowPage, metaLine, searchTvMedia, type TvMediaItem } from './data/tmdb';

/**
 * Recherche à la télécommande.
 *
 * Le clavier reste à gauche et les résultats à droite : sur un écran 960 de
 * large, les empiler obligerait à faire défiler entre chaque frappe et le
 * résultat pour vérifier.
 *
 * **La page ne défile pas.** Comme l'accueil et les collections, elle fait
 * 540 px de haut en `overflow: hidden`, et seule la grille de résultats se
 * déplace, par `transform`, dans un conteneur `overflow: clip`. `clip` et non
 * `hidden` : `hidden` ferait du conteneur une zone défilable, que le
 * `scrollIntoView` du moteur viendrait déplacer par-dessus le nôtre.
 *
 * **Le bandeau de prévisualisation** — image, titre, synopsis du titre sous le
 * focus, dans l'esprit de Prime Video — n'existe que lorsque le focus est sur
 * une carte. Il se déduit de la portée focalisée, rien n'est câblé dans le
 * clavier. Il occupe la partie droite de la bande de navigation, que la barre
 * en mode compact lui laisse ; la grille glisse de 72 px pour lui faire place
 * et remonte dès qu'on retourne au clavier : pendant la frappe, deux rangées
 * entières restent visibles. Le bandeau est opaque, parce qu'à partir de la
 * deuxième rangée, celles du dessus glissent dessous.
 *
 * **La requête est au-dessus du clavier**, comme chez Prime Video : c'est là
 * qu'on regarde en tapant, et la colonne de droite n'a plus de ligne d'en-tête
 * à lui consacrer.
 *
 * **Deux blocs côte à côte** : le seul écran dans ce cas, donc le seul qui
 * dépende de `neighbors` sur l'axe horizontal. Le clavier et les suggestions
 * déclarent `right` vers les résultats, les résultats déclarent `left` vers la
 * grille du clavier ; les deux côtés doivent rester en miroir. Le vertical suit
 * l'ordre du DOM, corrigé là où la disposition le contredit : Haut depuis les
 * résultats remonte à la barre de navigation, pas dans le clavier qui les
 * précède dans le DOM, et Bas depuis les suggestions ne saute pas dans la
 * grille d'en face.
 *
 * TMDB (`search/multi`) apparie par début de mot : « NARU » ne trouve rien,
 * « NARUT » trouve Naruto. C'est mesuré et sans contournement côté client ; on
 * le dit à l'écran, sans plus.
 */

const RESULTS_SCOPE = 'resultats';
const SUGGESTIONS_SCOPE = 'suggestions';
const KEYBOARD = tvKeyboardScopes();

const RESULT_COLUMNS = 4;
const RESULT_LAYOUT = 'compact' as const;
/** Pas vertical d'une rangée de la grille : carte, titre, puis l'espacement. */
const RESULT_PITCH_Y = TV_LAYOUTS[RESULT_LAYOUT].height + TV_CARD_LABEL_HEIGHT + TV_CARD_GAP;
/** Débord réservé au contour de focus des cartes, comme `FOCUS_BLEED` dans `TvRow`. */
const RESULT_BLEED = 8;
const MAX_SUGGESTIONS = 5;
const DEBOUNCE_MS = 450;
/** Rangée TMDB servie quand rien n'est encore tapé. Même requête que l'accueil. */
const IDLE_ROW_ID = 'tendances';

/**
 * Le bandeau monte dans la bande de la barre de navigation : la colonne de
 * droite commence sous les 64 px de la barre, le bandeau s'aligne sur ses 24 px
 * de marge haute.
 */
const PREVIEW_LIFT = 40;
/** De combien la grille descend quand le bandeau est là. */
const GRID_SHIFT = PREVIEW_HEIGHT + PREVIEW_GAP - PREVIEW_LIFT;

const SLIDE = 'transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)';
const NO_ITEMS: TvMediaItem[] = [];

const TvSearch: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TvMediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [idleRow, setIdleRow] = useState<{ title: string; items: TvMediaItem[] } | null>(null);

  const append = useCallback((character: string) => {
    // Borne de sûreté : une télécommande ne produira jamais un titre de 100
    // caractères, mais une touche restée enfoncée, si.
    setQuery(current => (current.length >= 100 ? current : current + character));
  }, []);
  const backspace = useCallback(() => setQuery(current => current.slice(0, -1)), []);
  const clear = useCallback(() => setQuery(''), []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }

    // Chaque frappe déclencherait sinon une requête : à la télécommande, on
    // enchaîne les lettres lentement mais sûrement.
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchTvMedia(trimmed, controller.signal)
        .then(items => {
          setResults(items);
          setSearching(false);
        })
        .catch(() => {
          // Une requête annulée par la frappe suivante n'est pas une erreur :
          // le prochain cycle rendra son résultat.
          if (!controller.signal.aborted) {
            setResults([]);
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Avant la première lettre, la grille n'est pas vide : Netflix y met
  // « D'après vos recherches », nous les tendances du jour. Ça donne aussi
  // quelque chose à atteindre en poussant à droite depuis le clavier.
  useEffect(() => {
    const controller = new AbortController();
    fetchRowPage(IDLE_ROW_ID, 1, controller.signal)
      .then(page => setIdleRow({ title: page.title, items: page.items }))
      .catch(() => {
        // Sans réseau, la grille reste vide et l'invite prend le relais.
      });
    return () => controller.abort();
  }, []);

  const idle = query.trim().length === 0;
  const items = idle ? (idleRow?.items ?? NO_ITEMS) : results;

  /**
   * Titres proposés sous le clavier. Dérivés des résultats déjà reçus — aucune
   * requête de plus — et dédoublonnés par titre : un film et sa série homonyme
   * n'ont pas à occuper deux lignes.
   */
  const suggestions = useMemo(() => {
    if (idle) return NO_ITEMS;
    const seen = new Set<string>();
    const kept: TvMediaItem[] = [];
    for (const item of results) {
      const key = item.title.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(item);
      if (kept.length === MAX_SUGGESTIONS) break;
    }
    return kept;
  }, [idle, results]);

  const open = useCallback(
    (item: TvMediaItem) => navigate(`/tvapp/${item.mediaType}/${item.id}`),
    [navigate],
  );

  const caption = idle
    ? (idleRow?.title ?? '')
    : searching && items.length > 0
      ? 'Recherche…'
      : '';

  let message: React.ReactNode = null;
  if (items.length === 0) {
    message = idle ? (
      <TvSearchMessage>Compose un titre avec le clavier.</TvSearchMessage>
    ) : searching ? (
      <TvSearchMessage>Recherche…</TvSearchMessage>
    ) : (
      <TvSearchMessage hint="Vérifie l'orthographe, ou continue à taper le titre.">
        Aucun résultat pour « {query.trim()} ».
      </TvSearchMessage>
    );
  }

  return (
    <div className="flex h-[var(--tv-screen-height,100vh)] flex-col overflow-hidden">
      <TvTopNav compact neighbors={{ down: KEYBOARD.grid }} />

      <div
        className="flex min-h-0 flex-1 gap-10"
        style={{ paddingLeft: TV_SAFE_X, paddingRight: TV_SAFE_X }}>
        <div className="shrink-0" style={{ width: TV_KEYBOARD_WIDTH }}>
          <TvSearchQuery query={query} />
          <TvKeyboard
            rightNeighbor={RESULTS_SCOPE}
            downNeighbor={suggestions.length > 0 ? SUGGESTIONS_SCOPE : null}
            onAppend={append}
            onBackspace={backspace}
            onClear={clear}
          />
          <TvSearchSuggestions items={suggestions} onSelect={open} />
        </div>

        <TvSearchResults items={items} caption={caption} message={message} onSelect={open} />
      </div>
    </div>
  );
};

/**
 * La requête telle qu'elle est tapée, ou l'invite tant qu'elle est vide.
 *
 * Quand le titre déborde des 220 px, c'est la **fin** qui reste visible : les
 * dernières lettres sont celles qu'on vient de taper, donc celles à vérifier.
 * La boîte est en `direction: rtl` — le débordement se fait alors par la
 * gauche — et `unicode-bidi: plaintext` garde le texte lui-même dans l'ordre
 * de lecture.
 */
const TvSearchQuery: React.FC<{ query: string }> = ({ query }) => (
  <div className="mb-2 mt-1 flex h-8 items-center gap-2">
    <SearchIcon />
    {query ? (
      <span
        className="min-w-0 flex-1 overflow-hidden whitespace-pre text-[17px] font-semibold tracking-wide"
        style={{ direction: 'rtl', unicodeBidi: 'plaintext', textAlign: 'left' }}>
        {query}
      </span>
    ) : (
      <span className="truncate text-[15px] text-white/30">Titre du film ou de la série</span>
    )}
  </div>
);

const TvSearchMessage: React.FC<{ hint?: string; children: React.ReactNode }> = ({
  hint,
  children,
}) => (
  <div className="pt-2" style={{ paddingLeft: RESULT_BLEED }}>
    <p className="text-[15px] text-white/70">{children}</p>
    {hint && <p className="mt-1 text-[13px] text-white/40">{hint}</p>}
  </div>
);

/**
 * Colonne de droite : le bandeau, un mot d'état, et la grille de résultats.
 *
 * La position de la grille est écrite directement dans le DOM depuis un effet
 * de mise en page : elle dépend de la rangée focalisée et de la présence du
 * bandeau, deux choses connues au moment même où le focus change. Le
 * composant lit la portée focalisée dans le contexte ; il se rend donc à
 * chaque déplacement, mais ses cartes le faisaient déjà.
 */
const TvSearchResults: React.FC<{
  items: TvMediaItem[];
  caption: string;
  message: React.ReactNode;
  onSelect: (item: TvMediaItem) => void;
}> = ({ items, caption, message, onSelect }) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const { focused } = useTvFocusContext();

  const focusedIndex =
    focused && focused.scopeId === RESULTS_SCOPE && items.length > 0
      ? Math.min(focused.index, items.length - 1)
      : -1;
  const inGrid = focusedIndex >= 0;

  // Le dernier titre prévisualisé reste dans le bandeau pendant qu'il
  // s'efface : un bandeau qui se vide avant de disparaître clignote.
  const lastPreviewed = useRef<TvMediaItem | null>(null);
  if (inGrid) lastPreviewed.current = items[focusedIndex];

  const scopeRef = useFocusScope({
    id: RESULTS_SCOPE,
    orientation: 'grid',
    count: items.length,
    columns: RESULT_COLUMNS,
    neighbors: {
      // Depuis le bord gauche de la grille, on revient au clavier.
      left: KEYBOARD.grid,
      // Le DOM place le clavier juste avant : sans ceci, Haut depuis la
      // première rangée atterrirait dans les lettres, de l'autre côté de l'écran.
      up: TV_TOP_NAV_SCOPE,
      down: null,
    },
  });

  // Hors de la grille, on repart du haut : le retour se fait par le clavier,
  // et la prochaine frappe changera la liste de toute façon.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const row = inGrid ? Math.floor(focusedIndex / RESULT_COLUMNS) : 0;
    const shift = inGrid ? GRID_SHIFT : 0;
    grid.style.transform = `translate3d(0, ${shift - row * RESULT_PITCH_Y}px, 0)`;
  }, [inGrid, focusedIndex, items]);

  return (
    <div className="relative min-w-0 flex-1">
      <p
        aria-hidden
        className="pointer-events-none absolute flex items-center text-[13px] text-white/40 transition-opacity duration-200"
        style={{
          top: -PREVIEW_LIFT,
          left: RESULT_BLEED,
          height: 32,
          opacity: inGrid || !caption ? 0 : 1,
        }}>
        {caption}
      </p>

      <TvPreviewBanner
        item={lastPreviewed.current}
        visible={inGrid}
        lift={PREVIEW_LIFT}
        inset={RESULT_BLEED}
      />

      <div ref={scopeRef} className="h-full" style={{ overflow: 'clip' }}>
        {message}
        <div
          ref={gridRef}
          className="will-change-transform"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${RESULT_COLUMNS}, ${TV_LAYOUTS[RESULT_LAYOUT].width}px)`,
            columnGap: TV_CARD_GAP,
            rowGap: TV_CARD_GAP,
            padding: RESULT_BLEED,
            transition: SLIDE,
          }}>
          {items.map((item, index) => (
            <TvSearchResult
              key={`${item.mediaType}-${item.id}`}
              index={index}
              item={item}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const TvSearchResult: React.FC<{
  index: number;
  item: TvMediaItem;
  onSelect: (item: TvMediaItem) => void;
}> = ({ index, item, onSelect }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLDivElement>(RESULTS_SCOPE, index);

  return (
    <div
      ref={ref}
      {...focusProps}
      role="button"
      onClick={() => onSelect(item)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className="outline-none">
      <TvCard
        title={item.title}
        subtitle={item.year}
        meta={metaLine(item)}
        imageUrl={item.posterUrl}
        focused={focused}
        layout={RESULT_LAYOUT}
      />
    </div>
  );
};

/**
 * Titres proposés sous le clavier, comme la liste de Netflix.
 *
 * Chez Netflix, choisir une ligne complète la requête. Ici les lignes *sont*
 * des résultats : les ouvrir directement épargne un aller-retour vers la
 * grille, et évite de laisser le focus sur une liste qui se réduit sous lui
 * pendant que la nouvelle requête part.
 *
 * Non montée quand elle est vide : le moteur saute les portées à zéro élément,
 * mais autant ne rien enregistrer du tout.
 */
const TvSearchSuggestions: React.FC<{
  items: TvMediaItem[];
  onSelect: (item: TvMediaItem) => void;
}> = ({ items, onSelect }) => {
  const scopeRef = useFocusScope({
    id: SUGGESTIONS_SCOPE,
    orientation: 'column',
    count: items.length,
    // Bas fermé : la portée suivante dans le DOM est la grille d'en face.
    neighbors: { right: RESULTS_SCOPE, down: null },
  });

  if (items.length === 0) return null;

  return (
    <div ref={scopeRef} className="mt-3 flex flex-col gap-0.5">
      {items.map((item, index) => (
        <TvSearchSuggestion
          key={`${item.mediaType}-${item.id}`}
          index={index}
          item={item}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

const TvSearchSuggestion: React.FC<{
  index: number;
  item: TvMediaItem;
  onSelect: (item: TvMediaItem) => void;
}> = ({ index, item, onSelect }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(SUGGESTIONS_SCOPE, index);

  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      onClick={() => onSelect(item)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className={
        'block h-7 w-full truncate rounded-md px-2 text-left text-[13px] outline-none ' +
        (focused ? 'bg-tv-focus font-semibold text-tv-on-focus' : 'text-white/60')
      }>
      {item.title}
    </button>
  );
};

/** Loupe de la ligne de requête. Dessinée : pas de dépendance à une police d'icônes. */
const SearchIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    className="shrink-0 text-white/50"
    aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5 21 21" />
  </svg>
);

export default TvSearch;

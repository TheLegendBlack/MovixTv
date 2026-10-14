import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTvFocusContext } from '../nav/focusContext';
import { useFocusItem, useFocusScope } from '../nav/hooks';
import { peekFocusRestore } from '../nav/focusRestore';
import { TV_SAFE_X } from './TvRow';
import { EditionLogo } from '../edition';

/**
 * Barre de navigation horizontale, dans l'esprit de Netflix.
 *
 * La loupe puis les quatre entrées de catalogue forment un groupe **centré sur
 * l'écran**, comme chez Netflix ; la roue crantée des réglages est seule à
 * droite, contre la marge. Le centrage compense la place que prend la roue :
 * l'axe du groupe est celui de la dalle, pas celui de l'espace qui reste. Pas
 * de logo dans la bande : celle de Netflix n'en porte pas non plus.
 *
 * Le marqueur de focus est **blanc**, comme sur les cartes. La version
 * précédente utilisait le rouge de marque ici et le blanc là-bas : deux
 * signaux pour une seule information, et l'œil doit apprendre les deux. Le rouge
 * ne sert plus qu'à porter du sens — la progression de lecture.
 *
 * L'entrée courante garde une pastille discrète, l'entrée focalisée une pastille
 * pleine avec anneau et agrandissement. La couleur seule ne suffit pas à trois
 * mètres, c'est l'échelle qui fait le travail.
 *
 * ## Typographie
 *
 * Calée sur la barre de Netflix : corps de 17 px en graisse moyenne, là où on
 * avait 15 px en semi-gras. C'est surtout la graisse qui fait l'impression
 * « épurée » — à taille égale, le semi-gras bouche les contreformes à trois
 * mètres. Netflix Sans n'est pas distribuable ; on garde la police de
 * l'application et on ne lui emprunte que la graisse, le corps et l'approche.
 * Les entrées au repos sont à 80 % de blanc et non 60 : chez Netflix elles
 * sont franchement blanches, la pastille pleine suffit à faire ressortir le
 * focus.
 *
 * ## Texte ou icônes
 *
 * La recherche a besoin de la partie droite de cette bande — le mot d'état de
 * la grille, puis le bandeau de prévisualisation. Sa barre est donc `compact` :
 * le groupe passe en icônes et se range **à gauche**, sous la colonne du
 * clavier, seul endroit de la bande que la page n'utilise pas. C'est la seule
 * page où le groupe n'est pas centré. Le passage de l'une à l'autre est animé,
 * et **toujours sur la page qu'on quitte**, jamais sur celle qui arrive.
 * Choisir la loupe depuis l'accueil replie la barre puis navigue ; la recherche
 * se monte avec la barre déjà repliée. Dans l'autre sens, la recherche
 * redéploie puis navigue. Le montage d'une page est l'instant le plus chargé
 * pour le SoC — clavier, requêtes, affiches à décoder — et une transition
 * lancée à ce moment-là finit dans la même image peinte que son départ. Seule
 * la touche Retour ne passe pas par ici et arrive donc sans transition.
 *
 * La barre porte en permanence le groupe sous ses deux formes, texte centré et
 * icônes à gauche, l'une dans le flux et enregistrée auprès du moteur, l'autre
 * en doublure absolue par-dessus, décorative, qui recopie le focus. La roue,
 * déjà un glyphe et toujours à la même place, reste en dehors. La
 * transformation est **une sortie puis une entrée** : la forme courante
 * s'efface en glissant, et la suivante n'apparaît qu'une fois la première
 * partie. Un fondu croisé montrait les deux à la fois. Rien d'autre que
 * l'opacité et `transform` ne bouge.
 *
 * Sur la recherche, la roue passe **sous** le bandeau de prévisualisation tant
 * que le focus est dans la grille des résultats : le bandeau est opaque et
 * au-dessus, la barre n'est de toute façon pas atteignable à ce moment-là, et
 * la roue réapparaît avec lui quand on remonte.
 */

/**
 * Le groupe qui se transforme, de gauche à droite : la loupe, puis les quatre
 * entrées de catalogue. `glyph` : icône sous les deux formes — la loupe reste
 * une loupe, seuls les libellés deviennent des icônes.
 */
const GROUP = [
  { label: 'Rechercher', path: '/tvapp/search', icon: 'search', glyph: true },
  { label: 'Accueil', path: '/tvapp', icon: 'home', glyph: false },
  { label: 'Films', path: '/tvapp/movies', icon: 'film', glyph: false },
  { label: 'Séries', path: '/tvapp/series', icon: 'tv', glyph: false },
  { label: 'Animés', path: '/tvapp/animes', icon: 'anime', glyph: false },
] as const;

/** La roue crantée, seule à droite, hors de la transformation. */
const SETTINGS = { label: 'Paramètres', path: '/tvapp/settings', icon: 'gear' } as const;

type NavIcon = (typeof GROUP)[number]['icon'] | typeof SETTINGS.icon;

/**
 * Index dans la portée : le groupe dans son ordre, la roue en dernier. Le
 * moteur navigue par index, donc Droite depuis « Animés » atteint la roue même
 * si un demi-écran les sépare.
 */
const SETTINGS_INDEX = GROUP.length;
const NAV_COUNT = GROUP.length + 1;
const HOME_INDEX = GROUP.findIndex(entry => entry.path === '/tvapp');

/** La seule page dont la barre est repliée. */
const FOLDED_PATH = '/tvapp/search';

export const TV_TOP_NAV_SCOPE = 'nav';

/** Chaque moitié de la transformation : la sortie, puis l'entrée. */
const STEP_MS = 160;
const MORPH_MS = STEP_MS * 2;
/** Course horizontale du groupe qui s'efface ou qui arrive. */
const SLIDE = 12;

/** Hauteur commune à toutes les pastilles, texte comme icône. */
const PILL_HEIGHT = 36;
/** Corps du libellé. Voir « Typographie » en tête de fichier. */
const FONT_SIZE = 17;
/** Glyphe de 22 px dans une pastille carrée de 36. */
const ICON_SIZE = 22;
/** Entre deux pastilles, et entre le groupe et la roue. */
const PILL_GAP = 4;
/**
 * Ce que la roue occupe à droite, espacement compris. Le groupe centré le
 * reçoit en marge gauche : sans ça il serait au milieu de ce que la roue
 * laisse, soit 20 px à gauche du milieu de la dalle.
 */
const SETTINGS_FOOTPRINT = PILL_HEIGHT + PILL_GAP;

interface TvTopNavProps {
  transparent?: boolean;
  /** Groupe en icônes, rangé à gauche. Montée repliée ; se redéploie avant de quitter la page. */
  compact?: boolean;
  neighbors?: { up?: string | null; down?: string | null };
  /** Appelé quand le focus entre dans la barre. Sert à l'accueil pour dé-assombrir. */
  onFocusEnter?: () => void;
}

/** Couleurs d'une pastille, partagées entre le groupe réel et sa doublure. */
const pillClass = (focused: boolean, active: boolean): string =>
  'rounded-full outline-none transition-transform duration-150 ' +
  (focused ? 'scale-105 bg-tv-focus text-tv-on-focus' : active ? 'bg-white/15 text-white' : 'text-white/80');

/** Boîte d'une pastille : carrée pour un glyphe, allongée pour un libellé. */
const pillShape = (icon: boolean): string =>
  icon
    ? 'flex shrink-0 items-center justify-center '
    : 'flex shrink-0 items-center whitespace-nowrap px-[18px] font-medium leading-none tracking-[0.01em] ';

const pillStyle = (focused: boolean, icon: boolean): React.CSSProperties => ({
  height: PILL_HEIGHT,
  width: icon ? PILL_HEIGHT : undefined,
  fontSize: icon ? undefined : FONT_SIZE,
  boxShadow: focused ? '0 0 0 3px rgb(var(--tv-focus) / 0.3)' : 'none',
});

/**
 * Style du groupe selon qu'il est visible. L'entrant attend que le sortant ait
 * fini : les deux ne sont jamais à l'écran en même temps.
 */
const groupStyle = (visible: boolean, hiddenSlide: number): React.CSSProperties => {
  const delay = visible ? STEP_MS : 0;
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'none' : `translate3d(${hiddenSlide}px, 0, 0)`,
    transition: `opacity ${STEP_MS}ms ease ${delay}ms, transform ${STEP_MS}ms ease ${delay}ms`,
    // Jamais `visibility: hidden` : le moteur doit pouvoir donner le focus DOM
    // à une pastille même pendant qu'elle est effacée.
    pointerEvents: visible ? undefined : 'none',
  };
};

export const TvTopNav: React.FC<TvTopNavProps> = ({
  transparent,
  compact = false,
  neighbors,
  onFocusEnter,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const { focus } = useTvFocusContext();

  // L'entrée de la page courante : là où le focus entre dans la barre, et là
  // où il est posé au montage. Une page sans entrée — il n'y en a pas
  // aujourd'hui — retomberait sur l'accueil plutôt que sur la loupe.
  const groupIndex = GROUP.findIndex(entry => entry.path === currentPath);
  const currentIndex =
    currentPath === SETTINGS.path ? SETTINGS_INDEX : groupIndex === -1 ? HOME_INDEX : groupIndex;

  // Repliée d'entrée sur la recherche : la transformation a déjà eu lieu sur
  // la page précédente.
  const [folded, setFolded] = useState(compact);
  const leaveTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const select = useCallback(
    (path: string) => {
      // Sur la page courante il n'y a nulle part où aller ; et un second appui
      // pendant la transformation ne doit pas naviguer deux fois.
      if (path === currentPath || leaveTimer.current !== null) return;
      const foldedThere = path === FOLDED_PATH;
      if (foldedThere === folded) {
        navigate(path);
        return;
      }
      setFolded(foldedThere);
      leaveTimer.current = window.setTimeout(() => navigate(path), MORPH_MS);
    },
    [folded, currentPath, navigate],
  );

  // La portée englobe le groupe et la roue : le moteur enregistre chaque
  // pastille par son index, la géométrie entre les deux ne le regarde pas.
  const scopeRef = useFocusScope({
    id: TV_TOP_NAV_SCOPE,
    orientation: 'row',
    count: NAV_COUNT,
    neighbors,
    entry: currentIndex,
  });

  // Au montage d'une page, rien n'a le focus : le moteur attend la première
  // flèche, et l'utilisateur voit un curseur « hors de l'écran ». On pose donc
  // le focus sur l'entrée de la page courante, visible tout de suite — sauf si
  // la page a déjà placé le sien, ce qu'un `activeElement` autre que le corps
  // du document révèle. Après tous les effets des enfants : les pastilles sont
  // déjà enregistrées auprès du moteur.
  useEffect(() => {
    // Seul un contrôle compte comme focus posé par la page. Chromium donne
    // aussi le focus à un conteneur qui défile (la boîte de la page) quand la
    // WebView reçoit le focus au lancement : pris pour un focus de la page, il
    // laissait le moteur sans position, et la première flèche ne faisait
    // qu'allumer cette pastille (Edenwood, WebView 154, 14/10/2026).
    const active = document.activeElement;
    if (active && active !== document.body && active.matches('button, a[href], input, textarea, select, [tabindex]')) return;
    // Retour d'une collection : la page va rendre le focus à la carte quittée
    // dès que sa rangée est là ; allumer la pastille entre-temps ferait un
    // saut de plus à l'écran.
    if (peekFocusRestore(currentPath)) return;
    focus({ scopeId: TV_TOP_NAV_SCOPE, index: currentIndex });
    // Au montage seulement : un changement d'entrée en cours de vie est déjà
    // un déplacement du focus, pas un recadrage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      className="relative flex items-center"
      style={{
        paddingLeft: TV_SAFE_X,
        paddingRight: TV_SAFE_X,
        paddingTop: 24,
        paddingBottom: transparent ? 0 : 16,
        height: 64,
      }}>
      {/* Logo, à gauche contre la marge, hors du flux : le groupe reste centré
          sur la dalle. Il suit le groupe texte dans sa transformation et
          disparaît donc sur la recherche, où les icônes prennent sa place.
          Le logo de l'édition (`edition.tsx`), centré sur la hauteur des
          pastilles. */}
      <span
        aria-hidden
        className="pointer-events-none absolute flex items-center"
        style={{ ...groupStyle(!folded, -SLIDE), left: TV_SAFE_X, top: 24, height: PILL_HEIGHT }}>
        <EditionLogo />
      </span>
      <div
        ref={scopeRef}
        className="flex min-w-0 flex-1 items-center"
        style={{ gap: PILL_GAP }}>
        {/* Toute la largeur qui reste à gauche de la roue. Le groupe s'y centre
            ou s'y range à gauche selon sa forme ; la doublure s'y pose en absolu
            avec le même alignement, donc à la géométrie exacte du réel. */}
        <div className="relative min-w-0 flex-1">
          <TvNavGroup
            kind="text"
            real={!compact}
            style={groupStyle(!folded, -SLIDE)}
            currentPath={currentPath}
            onFocusEnter={onFocusEnter}
            onSelect={select}
          />
          <TvNavGroup
            kind="icons"
            real={compact}
            style={groupStyle(folded, SLIDE)}
            currentPath={currentPath}
            onFocusEnter={onFocusEnter}
            onSelect={select}
          />
        </div>

        <TvNavItem
          index={SETTINGS_INDEX}
          label={SETTINGS.label}
          icon={SETTINGS.icon}
          active={currentPath === SETTINGS.path}
          onFocusEnter={onFocusEnter}
          onSelect={() => select(SETTINGS.path)}
        />
      </div>
    </nav>
  );
};

/** Un glyphe ou un libellé, selon la forme du groupe et l'entrée. */
const glyphOf = (entry: (typeof GROUP)[number], kind: 'text' | 'icons'): NavIcon | null =>
  kind === 'icons' || entry.glyph ? entry.icon : null;

/**
 * Le groupe sous une de ses deux formes : texte centré sur la dalle, ou icônes
 * rangées à gauche. Réel, il est dans le flux et ses pastilles sont
 * enregistrées auprès du moteur ; doublure, il est posé par-dessus en absolu
 * et recopie le focus, pour que la pastille blanche soit la même des deux côtés
 * de la transformation.
 */
const TvNavGroup: React.FC<{
  kind: 'text' | 'icons';
  real: boolean;
  style: React.CSSProperties;
  currentPath: string;
  onFocusEnter?: () => void;
  onSelect: (path: string) => void;
}> = ({ kind, real, style, currentPath, onFocusEnter, onSelect }) => (
  <div
    aria-hidden={!real}
    className={
      'flex items-center ' +
      (kind === 'text' ? 'justify-center ' : 'justify-start ') +
      (real ? '' : 'pointer-events-none absolute inset-0')
    }
    style={{
      ...style,
      gap: PILL_GAP,
      paddingLeft: kind === 'text' ? SETTINGS_FOOTPRINT : 0,
    }}>
    {real ? (
      GROUP.map((entry, index) => (
        <TvNavItem
          key={entry.path}
          index={index}
          label={entry.label}
          icon={glyphOf(entry, kind)}
          active={currentPath === entry.path}
          onFocusEnter={onFocusEnter}
          onSelect={() => onSelect(entry.path)}
        />
      ))
    ) : (
      <TvNavGhostPills kind={kind} currentPath={currentPath} />
    )}
  </div>
);

const TvNavGhostPills: React.FC<{ kind: 'text' | 'icons'; currentPath: string }> = ({
  kind,
  currentPath,
}) => {
  const { focused } = useTvFocusContext();
  const focusedIndex = focused?.scopeId === TV_TOP_NAV_SCOPE ? focused.index : -1;

  return (
    <>
      {GROUP.map((entry, index) => {
        const isFocused = index === focusedIndex;
        const icon = glyphOf(entry, kind);
        return (
          <span
            key={entry.path}
            className={pillShape(icon !== null) + pillClass(isFocused, entry.path === currentPath)}
            style={pillStyle(isFocused, icon !== null)}>
            {icon ? <TvNavIcon name={icon} /> : entry.label}
          </span>
        );
      })}
    </>
  );
};

const TvNavItem: React.FC<{
  index: number;
  label: string;
  /** Icône à afficher à la place du libellé. `null` : pastille texte. */
  icon: NavIcon | null;
  active: boolean;
  onSelect: () => void;
  onFocusEnter?: () => void;
}> = ({ index, label, icon, active, onSelect, onFocusEnter }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(
    TV_TOP_NAV_SCOPE,
    index,
  );

  React.useEffect(() => {
    if (focused) onFocusEnter?.();
  }, [focused, onFocusEnter]);

  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      aria-label={icon ? label : undefined}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={pillShape(icon !== null) + pillClass(focused, active)}
      style={pillStyle(focused, icon !== null)}>
      {icon ? <TvNavIcon name={icon} /> : label}
    </button>
  );
};

/**
 * Glyphes dessinés en trait, dans la couleur du texte de la pastille.
 * Aucune police d'icônes : rien à charger, rien qui puisse manquer.
 */
const TvNavIcon: React.FC<{ name: NavIcon }> = ({ name }) => (
  <svg
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
    aria-hidden>
    {name === 'home' && (
      <>
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </>
    )}
    {name === 'film' && (
      <>
        <path d="M3 9h18v11H3z" />
        <path d="M3 9l1-4 16 3-1 1" />
        <path d="M8.5 5.5l-1.5 3M13.5 6.5l-1.5 3M18.5 7.5l-1.5 2.5" />
      </>
    )}
    {name === 'tv' && (
      <>
        <rect x="3" y="8" width="18" height="12" rx="2" />
        <path d="M8 3l4 5 4-5" />
      </>
    )}
    {name === 'anime' && (
      <>
        {/* Shuriken à quatre branches. Les branches sont larges à la base
            pour rester lisibles à 22 px, et le point central le distingue
            d'une étoile de favori. */}
        <path d="M12 3l2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z" />
        <circle cx="12" cy="12" r="1.6" />
      </>
    )}
    {name === 'search' && (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 21 21" />
      </>
    )}
    {name === 'gear' && (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </>
    )}
  </svg>
);

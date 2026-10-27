import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocusItem, useFocusScope } from '../nav/hooks';
import { useTvFocusContext } from '../nav/focusContext';
import { TV_SAFE_X } from '../components/TvRow';

/**
 * Briques communes à l'écran Paramètres et à ses sous-écrans.
 *
 * Un seul style de focus partout : la pastille pleine `tv-focus`, la même que
 * sur l'accueil et le lecteur. Les éléments posés dessus utilisent
 * `currentColor` et des opacités, jamais un blanc en dur, pour rester lisibles
 * quel que soit le thème (focus blanc, rouge, doré…).
 *
 * Les sous-écrans n'ont pas la barre de navigation : comme la page Collection,
 * on en sort par le bouton Retour ou par la touche Retour, que `TvLayout`
 * traduit déjà en `navigate(-1)`.
 */

export const BACK_SCOPE = 'reglages-retour';

/**
 * Pose le focus sur un élément au montage, si aucun contrôle ne l'a pris.
 *
 * Seul un contrôle compte : Chromium focalise aussi la boîte qui défile, et la
 * prendre pour un focus posé laissait l'écran sans focus, la première flèche
 * partant sur Retour (écran « Se connecter avec Movix », Edenwood, 26/10/2026 ;
 * même piège que `TvTopNav` le 14/10).
 */
export function useInitialFocus(scopeId: string, index = 0): void {
  const { focus } = useTvFocusContext();
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.matches('button, a[href], input, textarea, select, [tabindex]')) return;
    focus({ scopeId, index });
    // Au montage seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Index de l'élément focalisé dans une portée, ou `null` si le focus est ailleurs. */
export function useFocusedIndex(scopeId: string): number | null {
  const { focused } = useTvFocusContext();
  return focused && focused.scopeId === scopeId ? focused.index : null;
}

/** Comme `useFocusedIndex`, mais garde le dernier index quand le focus quitte la portée. */
export function useStickyFocusedIndex(scopeId: string, initial = 0): number {
  const current = useFocusedIndex(scopeId);
  const [sticky, setSticky] = useState(initial);
  useEffect(() => {
    if (current !== null) setSticky(current);
  }, [current]);
  return current ?? sticky;
}

/** Masque une clé : ses six premiers et quatre derniers caractères. */
export const maskKey = (value: string | null | undefined): string =>
  !value ? 'aucune' : value.length <= 10 ? '••••' : `${value.slice(0, 6)}…${value.slice(-4)}`;

/* --- Icônes ---------------------------------------------------------------- */

export type TvIconName =
  | 'back'
  | 'chevron'
  | 'caret-left'
  | 'caret-right'
  | 'up'
  | 'down'
  | 'check'
  | 'palette'
  | 'drop'
  | 'target'
  | 'rows'
  | 'sliders'
  | 'key'
  | 'film'
  | 'shield'
  | 'pulse'
  | 'monitor'
  | 'lock'
  | 'trash'
  | 'reset'
  | 'info'
  | 'alert'
  | 'sparkles'
  | 'remote'
  | 'play'
  | 'stop'
  | 'link';

const ICONS: Record<TvIconName, React.ReactNode> = {
  back: (
    <>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  'caret-left': <path d="M15 6l-6 6 6 6" />,
  'caret-right': <path d="M9 6l6 6-6 6" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12l5 5L20 7" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7.2" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  rows: <path d="M4 6h16M4 12h16M4 18h10" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10 13l9-9M16 7l2 2M14 9l2 2" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  reset: (
    <>
      <path d="M4 4v6h6" />
      <path d="M5.5 15a7 7 0 1 0 1.6-7.3L4 10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </>
  ),
  remote: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="3" />
      <circle cx="12" cy="8" r="2" />
      <path d="M10 14h.01M14 14h.01M10 17.5h.01M14 17.5h.01" />
    </>
  ),
  play: <path d="M7 4l12 8-12 8V4z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
};

export const TvIcon: React.FC<{ name: TvIconName; size?: number; strokeWidth?: number; className?: string }> = ({
  name,
  size = 20,
  strokeWidth = 2,
  className,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}>
    {ICONS[name]}
  </svg>
);

/* --- États ----------------------------------------------------------------- */

export type TvTone = 'ok' | 'warn' | 'error' | 'off';

const TONE_DOT: Record<TvTone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
  off: 'bg-current opacity-40',
};

export const TvStatusDot: React.FC<{ tone: TvTone }> = ({ tone }) => (
  <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + TONE_DOT[tone]} aria-hidden />
);

/** Interrupteur, pour les réglages qui se basculent sur place. */
export const TvToggle: React.FC<{ on: boolean }> = ({ on }) => (
  <span className="relative inline-flex h-5 w-9 shrink-0 items-center" aria-hidden>
    <span className={'absolute inset-0 rounded-full ' + (on ? 'bg-movix-red' : 'bg-current opacity-25')} />
    <span
      className={
        'relative h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ' +
        (on ? 'translate-x-[18px]' : 'translate-x-0.5')
      }
    />
  </span>
);

/* --- Surfaces -------------------------------------------------------------- */

/** Fond, bordure et couleur de texte d'une tuile, selon le focus et la sélection. */
export const choiceSurface = (focused: boolean, selected = false): string =>
  focused
    ? 'scale-[1.02] border-transparent bg-tv-focus text-tv-on-focus shadow-[0_6px_20px_rgb(0_0_0/0.45)] '
    : selected
      ? 'border-white/40 bg-white/[0.12] text-white '
      : 'border-white/[0.08] bg-white/[0.05] text-white ';

export const TvSectionLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <h2 className={'mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-white/40 ' + className}>{children}</h2>
);

/** Panneau non focalisable : détail, aperçu, explication. */
export const TvPanel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={'rounded-2xl border border-white/10 bg-white/[0.04] p-5 ' + className}>{children}</div>
);

/**
 * Bouton focalisable de base. Les tuiles, onglets et cases des écrans de
 * réglages en dérivent ; `className` et `children` reçoivent l'état de focus.
 */
export const TvPressable: React.FC<{
  scopeId: string;
  index: number;
  onSelect: () => void;
  ariaLabel?: string;
  ariaPressed?: boolean;
  className: (focused: boolean) => string;
  children: (focused: boolean) => React.ReactNode;
}> = ({ scopeId, index, onSelect, ariaLabel, ariaPressed, className, children }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(scopeId, index);
  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={'outline-none transition-transform duration-150 ' + className(focused)}>
      {children(focused)}
    </button>
  );
};

/* --- En-tête des sous-écrans ---------------------------------------------- */

export const TvSubpage: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  /** Chemin affiché à côté du bouton Retour. */
  trail?: string[];
  /** Portée sous le bouton Retour. */
  downScope: string;
  /** Contenu à droite du titre (compteur, état). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, trail = ['Paramètres'], downScope, aside, children }) => {
  const navigate = useNavigate();
  const scopeRef = useFocusScope({
    id: BACK_SCOPE,
    orientation: 'row',
    count: 1,
    neighbors: { down: downScope, up: null },
  });

  // Marges et haut de page de `TvTopNav` : le bouton Retour tombe à la place
  // des pastilles de la barre, le titre sous l'aplomb de leur bord gauche.
  return (
    <div
      className="flex h-[var(--tv-screen-height,100vh)] flex-col overflow-hidden pb-5"
      style={{ paddingLeft: TV_SAFE_X, paddingRight: TV_SAFE_X, paddingTop: 24 }}>
      <div ref={scopeRef} className="flex items-center gap-3">
        <TvPressable
          scopeId={BACK_SCOPE}
          index={0}
          ariaLabel="Retour"
          onSelect={() => navigate(-1)}
          className={focused =>
            'flex h-9 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-4 ' +
            (focused ? 'scale-105 bg-tv-focus text-tv-on-focus' : 'bg-white/10 text-white')
          }>
          {() => (
            <>
              <TvIcon name="back" size={18} />
              <span className="text-[14px] font-semibold">Retour</span>
            </>
          )}
        </TvPressable>
        {trail.length > 0 && <span className="truncate text-[13px] text-white/40">{trail.join('  ›  ')}</span>}
      </div>
      <div className="mt-4 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[26px] font-black leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-[640px] text-[14px] leading-snug text-white/55">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className="mt-5 min-h-0 flex-1">{children}</div>
    </div>
  );
};

/* --- Tuile de choix -------------------------------------------------------- */

/**
 * Tuile de réglage : icône, libellé, explication, et à droite une valeur, un
 * interrupteur, une coche ou une flèche. Même mise en évidence partout.
 */
export const TvChoice: React.FC<{
  scopeId: string;
  index: number;
  label: React.ReactNode;
  hint?: React.ReactNode;
  icon?: TvIconName;
  leading?: React.ReactNode;
  /** Valeur courante, alignée à droite. */
  value?: React.ReactNode;
  /** Affiche un interrupteur dans cet état. */
  toggle?: boolean;
  chevron?: boolean;
  selected?: boolean;
  /** Pas de coche pour l'état sélectionné (la tuile l'indique autrement). */
  hideCheck?: boolean;
  compact?: boolean;
  onSelect: () => void;
  className?: string;
}> = ({
  scopeId,
  index,
  label,
  hint,
  icon,
  leading,
  value,
  toggle,
  chevron = false,
  selected = false,
  hideCheck = false,
  compact = false,
  onSelect,
  className = '',
}) => (
  <TvPressable
    scopeId={scopeId}
    index={index}
    onSelect={onSelect}
    ariaPressed={toggle ?? (selected || undefined)}
    className={focused =>
      'flex items-center rounded-xl border-2 text-left ' +
      (compact ? 'gap-2.5 px-3 py-2 ' : 'gap-3 px-3.5 py-2.5 ') +
      choiceSurface(focused, selected) +
      className
    }>
    {focused => (
      <>
        {icon && (
          <span
            className={
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' +
              (focused ? 'bg-black/10' : 'bg-white/[0.08]')
            }>
            <TvIcon name={icon} size={18} />
          </span>
        )}
        {leading}
        <span className="min-w-0 flex-1">
          <span className={'block truncate font-bold leading-tight ' + (compact ? 'text-[15px]' : 'text-[16px]')}>{label}</span>
          {hint && <span className="mt-0.5 block truncate text-[13px] opacity-60">{hint}</span>}
        </span>
        {value !== undefined && value !== null && (
          <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold opacity-75">{value}</span>
        )}
        {toggle !== undefined && <TvToggle on={toggle} />}
        {selected && !hideCheck && <TvIcon name="check" size={20} strokeWidth={2.5} className="shrink-0" />}
        {chevron && <TvIcon name="chevron" size={18} className="shrink-0 opacity-50" />}
      </>
    )}
  </TvPressable>
);

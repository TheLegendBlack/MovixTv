import React from 'react';
import { Check, Film, Play, Plus, RotateCcw, Server, type LucideIcon } from 'lucide-react';
import { useFocusItem, useFocusScope } from '../nav/hooks';

/**
 * Accueil de la fiche : ce qu'on voit avant d'entrer dans un onglet.
 *
 * ## Ancré en bas, pas en haut
 *
 * Le bloc se construit du bas vers le haut : la rangée d'actions et la barre
 * d'onglets restent à hauteur fixe, et tout ce qui les précède empile vers le
 * haut. C'est ce que fait Disney+ — comparer une série en cours et une série
 * jamais lancée le montre : le logo se déplace, les boutons non. L'intérêt est
 * qu'en passant d'une fiche à l'autre, la cible du focus ne bouge pas d'un
 * pixel, alors qu'un bloc ancré en haut la ferait sauter selon la longueur du
 * synopsis.
 *
 * ## Le contexte change de nature, pas de place
 *
 * Au même endroit s'affiche soit le synopsis de l'œuvre (jamais lancée), soit
 * l'épisode en cours avec sa progression. Deux lignes dans les deux cas : le
 * synopsis complet vit dans l'onglet Détails.
 *
 * ## Le focus est un remplissage blanc
 *
 * Pas de contour rouge. Sur une affiche sombre, une bordure de couleur se
 * confond avec l'image ; un aplat blanc ne se confond avec rien. Le rouge de
 * marque reste sur la barre de progression, où il signifie quelque chose.
 */

export type HeroActionIcon = 'play' | 'restart' | 'plus' | 'added' | 'sources' | 'trailer';

export interface HeroAction {
  /**
   * Stable pour la vie du bouton : il sert de clé React. Un identifiant qui
   * suivrait l'état — « ajouter » puis « retirer » — démonterait le bouton à
   * chaque bascule, et le focus partirait avec lui.
   */
  id: string;
  /** Absent = pastille ronde, présent = pilule libellée. */
  label?: string;
  /** Requis pour une pastille ronde, qui n'a pas de texte à lire. */
  ariaLabel?: string;
  icon?: HeroActionIcon;
  onSelect: () => void;
}

interface TvDetailsHeroProps {
  /** Identifiant de portée, fourni par la page pour rester unique. */
  scopeId: string;
  logoUrl: string | null;
  title: string;
  badges: string[];
  meta: string;
  /** Ligne de contexte : `S1:E4 · Le pendule`, ou rien pour une œuvre neuve. */
  contextLabel?: string | null;
  /** Deux lignes : synopsis de l'œuvre, ou de l'épisode en cours. */
  description: string;
  /** Entre 0 et 1. Masque la barre quand c'est `null`. */
  progressRatio?: number | null;
  remainingLabel?: string | null;
  actions: HeroAction[];
  /** Replié : la fiche est entrée dans un onglet, le hero s'efface. */
  collapsed: boolean;
  /** Distance au bas de l'écran, en pixels. C'est la ligne d'ancrage. */
  bottom: number;
}

const ICONS: Record<HeroActionIcon, LucideIcon> = {
  play: Play,
  restart: RotateCcw,
  plus: Plus,
  added: Check,
  sources: Server,
  trailer: Film,
};

export const TvDetailsHero: React.FC<TvDetailsHeroProps> = ({
  scopeId,
  logoUrl,
  title,
  badges,
  meta,
  contextLabel,
  description,
  progressRatio,
  remainingLabel,
  actions,
  collapsed,
  bottom,
}) => {
  const scopeRef = useFocusScope({
    id: scopeId,
    orientation: 'row',
    count: actions.length,
    // Rien au-dessus : sans cette fermeture, Haut depuis les boutons partirait
    // chercher une portée d'une autre page restée enregistrée.
    neighbors: { up: null },
  });

  return (
    <div
      // Le hero reste monté une fois replié : sa portée doit rester déclarée
      // pour que Haut depuis les onglets y ramène le focus — c'est ce qui
      // rouvre la fiche. `visibility` resterait focusable, `opacity` aussi,
      // mais seule l'opacité s'anime sans recalcul de mise en page.
      className={
        'absolute inset-x-[6%] transition-opacity duration-200 ' +
        (collapsed ? 'opacity-0' : 'opacity-100')
      }
      style={{ bottom }}
      aria-hidden={collapsed}>
      <div className="max-w-[440px]">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={title}
            className="max-h-[88px] max-w-[380px] object-contain object-left"
          />
        ) : (
          <h1 className="text-[44px] font-black leading-none tracking-tight">{title}</h1>
        )}

        {badges.length > 0 && (
          <div className="mt-[14px] flex gap-[6px]">
            {badges.map(badge => (
              <span
                key={badge}
                className="rounded bg-white/[0.13] px-[7px] py-[2px] text-[12px] text-white/85">
                {badge}
              </span>
            ))}
          </div>
        )}

        {meta && <p className="mt-[10px] text-[14px] text-white/60">{meta}</p>}

        {contextLabel && (
          <p className="mt-[18px] text-[15px] font-semibold text-white">{contextLabel}</p>
        )}
        {description && (
          <p
            className={
              'text-[15px] leading-[1.5] text-white/80 line-clamp-2 ' +
              (contextLabel ? 'mt-[4px]' : 'mt-[18px]')
            }>
            {description}
          </p>
        )}

        {progressRatio !== null && progressRatio !== undefined && (
          <div className="mt-[14px] flex items-center gap-[10px]">
            <div className="h-[3px] w-[190px] overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-movix-red"
                style={{ width: `${Math.round(Math.min(Math.max(progressRatio, 0), 1) * 100)}%` }}
              />
            </div>
            {remainingLabel && (
              <span className="text-[12px] text-white/55">{remainingLabel}</span>
            )}
          </div>
        )}
      </div>

      <div ref={scopeRef} className="mt-[18px] flex items-center gap-[9px]">
        {actions.map((action, index) => (
          <TvHeroButton key={action.id} scopeId={scopeId} index={index} action={action} />
        ))}
      </div>
    </div>
  );
};

const TvHeroButton: React.FC<{ scopeId: string; index: number; action: HeroAction }> = ({
  scopeId,
  index,
  action,
}) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLButtonElement>(scopeId, index);
  const Icon = action.icon ? ICONS[action.icon] : null;
  const round = !action.label;

  return (
    <button
      ref={ref}
      {...focusProps}
      type="button"
      onClick={action.onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          action.onSelect();
        }
      }}
      aria-label={round ? action.ariaLabel : undefined}
      className={
        'flex h-[30px] items-center justify-center gap-[6px] rounded-full text-[14px] font-semibold outline-none transition-colors duration-150 ' +
        (round ? 'w-[30px] ' : 'px-[16px] ') +
        (focused
          ? 'bg-tv-focus text-tv-on-focus'
          : round
            ? 'border border-white/30 text-white/75'
            : 'bg-white/[0.14] text-white/90')
      }>
      {Icon && <Icon size={15} strokeWidth={2.4} />}
      {action.label}
    </button>
  );
};

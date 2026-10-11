import React from 'react';
import './tvPlayerTheme.css';

/**
 * Surcouche de lecture à la télécommande.
 *
 * Elle ne remplace pas le moteur de `HLSPlayer` : elle en pilote les mêmes
 * fonctions (`togglePlay`, `skipTime`) et n'affiche que ce qui se lit à trois
 * mètres. La chrome souris du lecteur est neutralisée en amont plutôt que
 * masquée ici, pour qu'elle ne capte plus aucune touche.
 *
 * Parti pris visuel : le titre en haut, la progression en bas, et rien entre les
 * deux. La lecture ou la pause n'ont pas de bouton — elles passent par la touche
 * dédiée de la télécommande, ou par OK quand aucun bouton n'est sélectionné.
 * Un bouton de plus, c'est un déplacement de plus à faire pour atteindre les
 * autres.
 *
 * Elle porte son propre focus, sans passer par le moteur de navigation du
 * catalogue : il n'y a qu'une seule rangée de boutons, et le lecteur vit hors
 * de `TvLayout`.
 *
 * ## Échelle
 *
 * Les commandes des lecteurs de salon occupent autour de 3,5 % de la largeur de
 * l'écran ; au-delà, la barre cesse d'être une surcouche et devient un bandeau
 * qui mange l'image. Les trois constantes ci-dessous concentrent ce réglage :
 * c'est là qu'on ajuste, pas dans le JSX.
 */

/** Pastilles d'action. ~3,5 % de la largeur sur le gabarit TV de référence. */
const ACTION_SIZE = 'h-10 w-10';
/** Dessin à l'intérieur : la moitié de la pastille, comme sur les lecteurs de salon. */
const ACTION_ICON = 'h-5 w-5';
/** Hauteur commune à la rangée : le badge s'aligne sur les pastilles. */
const ROW_HEIGHT = 'h-10';

/** Icône du bouton. Une clé plutôt qu'un nœud : le dessin reste dans la couche TV. */
export type TvPlayerActionIcon = 'rewind' | 'forward' | 'settings';

export interface TvPlayerAction {
  id: string;
  /** Lu par les lecteurs d'écran, et repli si l'icône est inconnue. */
  label: string;
  icon?: TvPlayerActionIcon;
  onSelect: () => void;
}

interface TvPlayerControlsProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  actions: TvPlayerAction[];
  /**
   * Bouton focalisé, piloté par le parent. `null` = aucun, état dans lequel OK
   * lance ou met en pause au lieu d'activer un bouton.
   */
  focusedAction: number | null;
  isBuffering?: boolean;
  /** Fin du tampon, en secondes. Dessine l'avance chargée sous la progression. */
  bufferedTo?: number;
  /** Qualité réellement jouée, pas celle demandée : sur TV l'auto varie souvent. */
  qualityLabel?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, '0')}`
    : `${mm}:${String(s).padStart(2, '0')}`;
}

const ICONS: Record<TvPlayerActionIcon, React.ReactNode> = {
  rewind: (
    <svg viewBox="0 0 24 24" className={ACTION_ICON} fill="currentColor" aria-hidden="true">
      <path d="M19 5.5v13a1 1 0 0 1-1.55.83L8 13.03V18.5a1 1 0 0 1-2 0v-13a1 1 0 0 1 2 0v5.47l9.45-6.3A1 1 0 0 1 19 5.5Z" />
    </svg>
  ),
  forward: (
    <svg viewBox="0 0 24 24" className={ACTION_ICON} fill="currentColor" aria-hidden="true">
      <path d="M5 5.5v13a1 1 0 0 0 1.55.83L16 13.03V18.5a1 1 0 0 0 2 0v-13a1 1 0 0 0-2 0v5.47L6.55 4.67A1 1 0 0 0 5 5.5Z" />
    </svg>
  ),
  /**
   * Roue crantée, tracée en une seule silhouette.
   *
   * L'ancienne était un contour dessiné en aplat, doublé d'un second contour
   * intérieur : à 56 px sur un écran de bureau ça passait encore, à 20 px sur la
   * TV les deux tracés se rejoignaient en une tache. Ici, une seule forme
   * fermée — huit dents légèrement coniques entre un cercle de tête et un cercle
   * de pied — et le trou percé par `fill-rule="evenodd"` plutôt que par un
   * anneau posé par-dessus.
   *
   * Le `stroke` de la même couleur, avec jointures rondes, n'épaissit pas : il
   * arrondit les angles de la silhouette. C'est ce qui distingue une roue de
   * lecteur de salon d'un pignon d'atelier, et c'est ce qui la sauve au moment où
   * la TV met son propre filtre de netteté par-dessus.
   */
  settings: (
    <svg viewBox="0 0 24 24" className={ACTION_ICON} fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        stroke="currentColor"
        strokeWidth="0.85"
        strokeLinejoin="round"
        d="M10.59 1.49 A10.6 10.6 0 0 1 13.41 1.49 L13.87 4.22 A8.0 8.0 0 0 1 16.18 5.18 L18.43 3.57 A10.6 10.6 0 0 1 20.43 5.57 L18.82 7.82 A8.0 8.0 0 0 1 19.78 10.13 L22.51 10.59 A10.6 10.6 0 0 1 22.51 13.41 L19.78 13.87 A8.0 8.0 0 0 1 18.82 16.18 L20.43 18.43 A10.6 10.6 0 0 1 18.43 20.43 L16.18 18.82 A8.0 8.0 0 0 1 13.87 19.78 L13.41 22.51 A10.6 10.6 0 0 1 10.59 22.51 L10.13 19.78 A8.0 8.0 0 0 1 7.82 18.82 L5.57 20.43 A10.6 10.6 0 0 1 3.57 18.43 L5.18 16.18 A8.0 8.0 0 0 1 4.22 13.87 L1.49 13.41 A10.6 10.6 0 0 1 1.49 10.59 L4.22 10.13 A8.0 8.0 0 0 1 5.18 7.82 L3.57 5.57 A10.6 10.6 0 0 1 5.57 3.57 L7.82 5.18 A8.0 8.0 0 0 1 10.13 4.22 L10.59 1.49 Z M12 8.2 A3.8 3.8 0 1 0 12 15.8 A3.8 3.8 0 1 0 12 8.2 Z"
      />
    </svg>
  ),
};

export const TvPlayerControls: React.FC<TvPlayerControlsProps> = ({
  visible,
  title,
  subtitle,
  isPlaying,
  currentTime,
  duration,
  actions,
  focusedAction,
  isBuffering,
  bufferedTo,
  qualityLabel,
}) => {
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const buffered = duration > 0 && bufferedTo ? Math.min(bufferedTo / duration, 1) : 0;

  const status = isBuffering ? 'Mise en mémoire tampon…' : !isPlaying ? 'En pause' : null;

  return (
    <div
      // `pointer-events-none` en permanence : rien ici n'est cliquable, tout
      // passe par la télécommande. Ça évite aussi de voler les clics au lecteur.
      className={
        'pointer-events-none absolute inset-0 z-40 flex flex-col justify-between ' +
        'transition-opacity duration-200 ' +
        (visible ? 'opacity-100' : 'opacity-0')
      }
      aria-hidden={!visible}>
      {/* Dégradés et non flou : un backdrop-filter plein écran coûtait un quart
          du budget d'image sur la TV de référence.
          Les deux blocs glissent de quelques pixels à l'ouverture — un
          `transform` ne coûte rien au compositeur, et le mouvement dit d'où la
          barre vient. */}
      <div
        className={
          'bg-gradient-to-b from-black/70 via-black/25 to-transparent px-[5%] pb-16 pt-[3.5%] ' +
          'transition-transform duration-200 ' +
          (visible ? 'translate-y-0' : '-translate-y-3')
        }>
        {title && (
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-md">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="mt-1.5 text-sm font-medium tracking-wide text-white/70 drop-shadow">
            {subtitle}
          </p>
        )}
      </div>

      <div
        className={
          'bg-gradient-to-t from-black/85 via-black/40 to-transparent px-[5%] pb-[3.5%] pt-20 ' +
          'transition-transform duration-200 ' +
          (visible ? 'translate-y-0' : 'translate-y-3')
        }>
        <div className={'mb-5 flex items-center gap-4 ' + ROW_HEIGHT}>
          {/* L'état n'occupe une ligne que lorsqu'il dit quelque chose : en
              lecture normale, la barre reste vide de tout bavardage. */}
          {status && (
            <span className="text-sm font-medium tracking-wide text-white/60">{status}</span>
          )}

          <div className="ml-auto flex items-center gap-3">
            {actions.map((action, index) => (
              <TvPlayerButton
                key={action.id}
                action={action}
                focused={index === focusedAction}
              />
            ))}
            {qualityLabel && <TvQualityBadge label={qualityLabel} />}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="relative flex-1">
            {/* La pastille suit la tête de lecture, comme sur les lecteurs de
                salon. Bornée aux extrémités, sinon elle déborde de la piste au
                début et à la fin. */}
            <span
              className="absolute bottom-full mb-3 -translate-x-1/2 rounded bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-black shadow-md"
              style={{
                left: `clamp(1.5rem, ${progress * 100}%, calc(100% - 1.5rem))`,
              }}>
              {formatTime(currentTime)}
            </span>

            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
              {/* Tampon sous la progression : sur une connexion lente, savoir si
                  l'avance est chargée évite de croire à un blocage. */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/40"
                style={{ width: `${buffered * 100}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-movix-red-bright"
                // Largeur en style inline : une classe Tailwind ne peut pas
                // exprimer une valeur continue, et `transform` déformerait le
                // rayon des angles.
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            {/* Tête de lecture. Hors de la piste, qui rogne ce qui la dépasse :
                c'est elle qui donne à une barre d'1 px l'épaisseur qu'on lit de
                loin, sans épaissir le trait sur toute sa longueur. */}
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(0,0,0,0.35)]"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          <span className="w-20 text-right text-sm font-semibold tabular-nums text-white/70">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Bouton rond de la barre.
 *
 * Focus en blanc plein, comme les lecteurs de salon : c'est le seul aplat
 * opaque de toute la barre, donc le seul point que l'œil accroche depuis le
 * canapé, quelle que soit l'image derrière. L'échelle appuie le propos sans
 * bousculer la rangée, et l'ombre portée détache la pastille d'un plan clair.
 *
 * Pour repasser à la couleur de marque : remplacer `bg-white text-black` par
 * `bg-movix-red text-white` — le reste du traitement tient tel quel.
 */
const TvPlayerButton: React.FC<{ action: TvPlayerAction; focused: boolean }> = ({
  action,
  focused,
}) => (
  <span
    role="button"
    aria-label={action.label}
    className={
      'flex items-center justify-center rounded-full ' +
      ACTION_SIZE +
      ' transition-transform duration-150 ' +
      (focused
        ? 'scale-110 bg-tv-focus text-tv-on-focus shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
        : 'bg-white/20 text-white/90')
    }>
    {action.icon ? ICONS[action.icon] : action.label}
  </span>
);

/**
 * Qualité réellement jouée, à droite des réglages.
 *
 * Non focalisable : c'est une information, pas une commande. On la règle dans le
 * panneau, que la roue crantée ouvre justement sur cet onglet. Elle se tient
 * donc en retrait des pastilles — même hauteur pour tenir la ligne, mais ni
 * fond plein ni corps de texte qui la ferait passer pour un bouton.
 */
const TvQualityBadge: React.FC<{ label: string }> = ({ label }) => (
  <span
    aria-label={`Qualité ${label}`}
    className={
      'flex items-center rounded-full border border-white/20 px-3 ' +
      ROW_HEIGHT +
      ' text-xs font-semibold tracking-wide tabular-nums text-white/65'
    }>
    {label}
  </span>
);

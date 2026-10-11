import React from 'react';
import {
  TV_CARD_LABEL_HEIGHT,
  TV_CARD_REST_SCALE,
  TV_LAYOUTS,
  TV_RANK_WIDTH,
  type TvRowLayout,
} from './TvRow';

/**
 * Vignette de catalogue.
 *
 * Le titre reste visible sous **toutes** les cartes : la comparaison sur écran
 * réel avait tranché, on garde. En revanche la ligne secondaire riche — âge,
 * genres — n'apparaît que sous la carte focalisée. Afficher « 12+ 2021 ·
 * Super-héros, Action et a… » sous chacune des six cartes visibles remplit le
 * bas de la rangée de texte tronqué que personne ne lit, et c'est précisément ce
 * qui alourdit l'accueil de Disney+. La hauteur du bloc est fixe dans les deux
 * cas, donc la révélation ne décale rien.
 *
 * Le contour de focus est blanc et non rouge : le rouge de marque se lit mal sur
 * une affiche sombre, et il porte déjà une information ailleurs — la barre de
 * progression. Un aplat blanc ne signifie qu'une chose : c'est ici.
 *
 * Le contour existe en permanence dans le DOM, en `opacity: 0`. Basculer une
 * opacité reste sur le compositeur ; faire apparaître une bordure déclenche un
 * repaint et, sur ce SoC, ça se voit à la répétition de touche.
 *
 * ## Le gabarit `rank`
 *
 * L'affiche est celle de `poster`, précédée de son numéro de classement en
 * contour : trait blanc, intérieur vide, pour que le chiffre reste lisible sur
 * le fond sombre sans concurrencer l'affiche. Le numéro est peint *sous*
 * l'affiche, qui vient après lui dans le DOM : « 10 » peut ainsi déborder de
 * son bloc et passer derrière l'image sans élargir la cellule. Il ne dépasse
 * jamais à gauche — un débord de ce côté irait recouvrir l'affiche précédente.
 * Au focus, c'est son opacité qui monte, jamais son trait : même raison que le
 * contour.
 */

/** Débord autorisé du numéro sous l'affiche. Voir `TV_RANK_WIDTH` dans `TvRow`. */
const RANK_UNDERLAP = 40;
/** Chiffres tabulaires, tous de même chasse : un « 1 » ne flotte pas plus loin qu'un « 7 ». */
const RANK_FONT_SIZE = 112;

interface TvCardProps {
  title: string;
  /** Année, ou « S2:E2 · Brad Fer » sur une reprise de lecture. */
  subtitle?: string;
  /** Ligne au-dessus du titre : « Il reste 49 min », « Épisode suivant ». */
  overline?: string;
  /** Ligne révélée au focus seulement : « 12+ · 2026 · Action ». */
  meta?: string;
  imageUrl?: string | null;
  /** Progression de lecture, entre 0 et 1. Affichée uniquement si > 0. */
  progress?: number;
  focused: boolean;
  /** Vrai si le focus est dans la même rangée. Voir `will-change` plus bas. */
  rowFocused?: boolean;
  tint?: string;
  layout?: TvRowLayout;
  /** Numéro de classement, à partir de 1. Lu seulement par le gabarit `rank`. */
  rank?: number;
}

export const TvCard: React.FC<TvCardProps> = ({
  title,
  subtitle,
  overline,
  meta,
  imageUrl,
  progress = 0,
  focused,
  rowFocused = false,
  tint,
  layout = 'poster',
  rank,
}) => {
  const ranked = layout === 'rank';
  const { width, height } = TV_LAYOUTS[layout];
  // Pour `rank`, la cellule est plus large que l'image : le numéro occupe la
  // différence, à gauche.
  const image = ranked ? TV_LAYOUTS.poster : { width, height };
  const rankWidth = ranked ? TV_RANK_WIDTH : 0;

  return (
    <div
      className="transition-transform duration-150 ease-out"
      style={{
        width,
        transform: `scale(${focused ? 1 : TV_CARD_REST_SCALE})`,
        // Réservé aux cartes de la rangée active. Promouvoir les ~14 cartes de
        // chacune des quatorze rangées coûterait une centaine de couches GPU
        // pour rien — à 296×444 px physiques, c'est de l'ordre de 80 Mo de
        // mémoire graphique sur une machine qui n'en a pas à revendre.
        willChange: rowFocused ? 'transform' : 'auto',
      }}>
      <div className="relative" style={{ width, height: image.height }}>
        {ranked && rank !== undefined && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 flex select-none items-end transition-opacity duration-150"
            style={{
              width: rankWidth + RANK_UNDERLAP,
              height: image.height,
              paddingLeft: 4,
              opacity: focused ? 1 : 0.55,
            }}>
            <span
              style={{
                fontSize: RANK_FONT_SIZE,
                lineHeight: 0.8,
                fontWeight: 900,
                letterSpacing: '-0.06em',
                fontVariantNumeric: 'tabular-nums',
                color: 'transparent',
                WebkitTextStroke: '2px rgba(255,255,255,0.9)',
              }}>
              {rank}
            </span>
          </div>
        )}

        <div
          className="relative overflow-hidden rounded-xl bg-white/5"
          style={{
            width: image.width,
            height: image.height,
            marginLeft: rankWidth,
            backgroundColor: tint,
          }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-2 text-center text-sm text-white/40">
              {title}
            </div>
          )}

          {progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/55">
              <div
                className="h-full bg-movix-red"
                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              />
            </div>
          )}

          {/* Contour toujours monté, révélé par l'opacité. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-150"
            style={{
              boxShadow: '0 0 0 3px rgb(var(--tv-focus))',
              opacity: focused ? 1 : 0,
            }}
          />
        </div>
      </div>

      {/* Sous l'affiche, jamais sous le numéro : le titre appartient à l'image. */}
      <div
        style={{
          height: TV_CARD_LABEL_HEIGHT,
          paddingTop: 6,
          width: image.width,
          marginLeft: rankWidth,
        }}>
        {overline && (
          <p className="truncate text-[11px] leading-tight text-white/45">{overline}</p>
        )}
        <p
          className={
            'truncate text-xs font-semibold leading-tight ' +
            (focused ? 'text-white' : 'text-white/65')
          }>
          {title}
        </p>
        {focused && meta ? (
          <p className="truncate text-[11px] leading-tight text-white/50">{meta}</p>
        ) : (
          subtitle && (
            <p className="truncate text-[11px] leading-tight text-white/40">{subtitle}</p>
          )
        )}
      </div>
    </div>
  );
};

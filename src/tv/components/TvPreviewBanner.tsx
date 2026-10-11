import React, { useEffect, useState } from 'react';
import { metaLine, type TvMediaItem } from '../data/tmdb';

/**
 * Bandeau de prévisualisation : titre, année · genre et trois lignes de
 * synopsis à gauche, photogramme à droite. Les données sont déjà dans
 * `TvMediaItem`, aucune requête. Le synopsis complet est sur la fiche.
 *
 * Né dans la recherche, partagé avec les pages de collection : même bandeau,
 * même hauteur, pour que l'œil retrouve la même chose au même endroit.
 *
 * Opaque et au-dessus de la grille : quand la rangée focalisée est calée sous
 * lui, celles du dessus passent en dessous. Toujours monté, révélé par
 * l'opacité — compositeur seul, comme le contour des cartes.
 */

export const PREVIEW_HEIGHT = 100;
export const PREVIEW_GAP = 12;
const PREVIEW_STILL_WIDTH = 178;
/** Le texte change à chaque appui ; l'image attend que la télécommande se pose. */
const PREVIEW_IMAGE_DELAY_MS = 150;

export const TvPreviewBanner: React.FC<{
  item: TvMediaItem | null;
  visible: boolean;
  /** De combien le bandeau remonte au-dessus de son conteneur. */
  lift?: number;
  /** Marge gauche du texte, alignée sur la grille qu'il surplombe. */
  inset?: number;
}> = ({ item, visible, lift = 0, inset = 0 }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setImageUrl(item?.stillUrl ?? null),
      PREVIEW_IMAGE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [item]);

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none absolute inset-x-0 z-10 flex items-start gap-6 bg-movix-ink transition-opacity duration-200"
      // Hauteur du bandeau plus son espacement : le fond opaque couvre aussi
      // l'interstice, où le bas du titre de la rangée du dessus passerait sinon.
      style={{ top: -lift, height: PREVIEW_HEIGHT + PREVIEW_GAP, opacity: visible ? 1 : 0 }}>
      <div className="min-w-0 flex-1" style={{ paddingLeft: inset }}>
        {item && (
          <>
            <p className="truncate text-[18px] font-bold leading-[22px]">{item.title}</p>
            <p className="mt-px text-[12px] leading-4 text-white/50">{metaLine(item)}</p>
            <p
              className="mt-1 text-[13px] leading-[18px] text-white/70"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
              {item.overview || 'Pas de résumé disponible.'}
            </p>
          </>
        )}
      </div>
      <div
        className="relative shrink-0 overflow-hidden rounded-[10px] bg-white/5"
        style={{ width: PREVIEW_STILL_WIDTH, height: PREVIEW_HEIGHT }}>
        {imageUrl && <TvPreviewStill key={imageUrl} src={imageUrl} />}
      </div>
    </div>
  );
};

/** Remontée à chaque changement d'URL, pour que la nouvelle image apparaisse en fondu. */
const TvPreviewStill: React.FC<{ src: string }> = ({ src }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onLoad={() => setLoaded(true)}
      className="h-full w-full object-cover transition-opacity duration-200"
      style={{ opacity: loaded ? 1 : 0 }}
    />
  );
};

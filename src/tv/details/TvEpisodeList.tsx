import React, { useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Play } from 'lucide-react';
import { useFocusItem, useFocusScope } from '../nav/hooks';
import type { TvEpisode } from '../data/tmdbDetails';

/**
 * Liste verticale d'épisodes.
 *
 * `TvRow` ne pouvait pas faire l'affaire : il est horizontal en dur, et son
 * calcul de `FOCUS_BLEED` est taillé pour un agrandissement latéral. Plutôt que
 * de lui ajouter un drapeau d'orientation qui compliquerait un composant qui
 * sert bien tout le catalogue, ce fichier reprend le même contrat de portée
 * pour un axe différent.
 *
 * ## Pourquoi la verticale
 *
 * Une rangée horizontale ne montre que trois épisodes sur dix et n'a pas la
 * place d'afficher une durée ni un résumé. La liste verticale les porte, et
 * Bas = épisode suivant colle au modèle mental. C'est aussi ce qui permet de
 * supprimer le bloc de synopsis à hauteur fixe qui surplombait la rangée : le
 * résumé vit maintenant dans sa ligne, et le focus ne fait plus re-rendre la
 * page entière à chaque déplacement.
 *
 * ## Le centrage
 *
 * `reveal` centre l'index visé, comme dans `TvRow`. Ce n'est pas un choix
 * esthétique : `TvFocusProvider` appelle `scrollIntoView({ block: 'center' })`
 * après avoir laissé la rangée se positionner. Sur un axe horizontal, son
 * `inline: 'nearest'` rend l'appel inoffensif ; sur un axe vertical, il agit.
 * En centrant nous aussi, l'élément est déjà en place et l'appel ne fait rien.
 * Un autre alignement ici produirait un double déplacement à chaque appui.
 */

/** Vignette 16:9. 200 px CSS sur un gabarit de 960 : un cinquième de l'écran. */
const STILL_WIDTH = 200;
const STILL_HEIGHT = 112;
const ROW_PADDING = 8;
const ROW_GAP = 6;
const ROW_HEIGHT = STILL_HEIGHT + ROW_PADDING * 2;

export interface EpisodeStatus {
  /** Entre 0 et 1, ou `null` si l'épisode n'a jamais été lancé. */
  ratio: number | null;
  watched: boolean;
}

interface TvEpisodeListProps {
  scopeId: string;
  /** Portée du rail des saisons, à gauche. */
  seasonScopeId: string;
  /** Portée des onglets, au-dessus. */
  tabsScopeId: string;
  episodes: TvEpisode[];
  /** Hauteur visible, imposée par la page : la liste ne défile qu'en interne. */
  height: number;
  statusOf: (episode: TvEpisode) => EpisodeStatus;
  onSelect: (episode: TvEpisode) => void;
}

export const TvEpisodeList: React.FC<TvEpisodeListProps> = ({
  scopeId,
  seasonScopeId,
  tabsScopeId,
  episodes,
  height,
  statusOf,
  onSelect,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: episodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    // Deux lignes d'avance suffisent : elles font moins de 300 px, là où une
    // rangée horizontale en demandait quatre pour couvrir un balayage rapide.
    overscan: 2,
  });

  const reveal = useCallback(
    (index: number) => virtualizer.scrollToIndex(index, { align: 'center' }),
    [virtualizer],
  );

  const scopeRef = useFocusScope({
    id: scopeId,
    orientation: 'column',
    count: episodes.length,
    neighbors: { left: seasonScopeId, up: tabsScopeId, down: null },
    reveal,
  });

  if (episodes.length === 0) return null;

  return (
    <div ref={scopeRef} className="min-w-0 flex-1">
      <div
        ref={scrollRef}
        // `overflow-hidden` et non `auto` : le défilement est piloté par le
        // virtualiseur, et une barre de défilement n'a aucun sens sur TV.
        className="relative overflow-hidden"
        style={{ height }}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(virtualItem => (
            <TvEpisodeRow
              key={virtualItem.key}
              scopeId={scopeId}
              index={virtualItem.index}
              offset={virtualItem.start}
              episode={episodes[virtualItem.index]}
              status={statusOf(episodes[virtualItem.index])}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const TvEpisodeRow: React.FC<{
  scopeId: string;
  index: number;
  offset: number;
  episode: TvEpisode;
  status: EpisodeStatus;
  onSelect: (episode: TvEpisode) => void;
}> = ({ scopeId, index, offset, episode, status, onSelect }) => {
  const { ref, focused, focusProps } = useFocusItem<HTMLDivElement>(scopeId, index);

  return (
    <div
      ref={ref}
      {...focusProps}
      role="button"
      onClick={() => onSelect(episode)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSelect(episode);
        }
      }}
      // `ring-inset` plutôt qu'un `outline` débordant : le conteneur rogne, et
      // un contour extérieur serait coupé sur la première et la dernière ligne.
      className={
        'absolute left-0 right-0 flex gap-[14px] rounded-xl outline-none transition-colors duration-150 ' +
        (focused ? 'bg-white/[0.08] ring-2 ring-inset ring-tv-focus' : '')
      }
      style={{ top: offset, height: ROW_HEIGHT, padding: ROW_PADDING }}>
      <div
        className="relative shrink-0 overflow-hidden rounded-lg bg-white/5"
        style={{ width: STILL_WIDTH, height: STILL_HEIGHT }}>
        {episode.stillUrl ? (
          <img
            src={episode.stillUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={
              'h-full w-full object-cover transition-opacity duration-150 ' +
              // Un épisode vu s'assombrit, plutôt que de porter une pastille
              // « vu » de plus : la liste reste lisible d'un coup d'œil.
              (status.watched && !focused ? 'opacity-45' : 'opacity-100')
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[13px] text-white/35">
            {episode.episodeNumber}
          </div>
        )}

        {focused && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-tv-focus/90 text-tv-on-focus">
              <Play size={13} strokeWidth={2.6} />
            </span>
          </div>
        )}

        {status.watched && !focused && (
          <span className="absolute right-[6px] top-[6px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/60 text-white">
            <Check size={11} strokeWidth={3} />
          </span>
        )}

        {status.ratio !== null && !status.watched && (
          <div className="absolute inset-x-[6px] bottom-[6px] h-[3px] overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full rounded-full bg-movix-red"
              style={{ width: `${Math.round(status.ratio * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 pt-[2px]">
        <div className="flex items-baseline gap-[10px]">
          <p
            className={
              'flex-1 truncate text-[15px] font-semibold leading-tight ' +
              (focused ? 'text-white' : 'text-white/85')
            }>
            {episode.episodeNumber}. {episode.name}
          </p>
          {episode.runtime && (
            <span className="shrink-0 text-[13px] text-white/45">{episode.runtime} min</span>
          )}
        </div>
        <p className="mt-[5px] text-[13px] leading-[1.5] text-white/55 line-clamp-2">
          {episode.overview || 'Aucun résumé disponible pour cet épisode.'}
        </p>
      </div>
    </div>
  );
};

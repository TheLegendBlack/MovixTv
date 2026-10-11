import React from 'react';

/**
 * Carte « Voir plus », posée en fin de rangée.
 *
 * Elle ne s'écarte pas de la charte : même empreinte que les affiches voisines,
 * même géométrie, même marqueur de focus — l'anneau blanc et le passage à
 * `scale(1)`. Une carte qui inventerait sa propre grammaire au bout d'une rangée
 * se lirait comme un élément d'une autre application.
 *
 * Ce qui la distingue tient à une seule chose : elle n'a pas d'image, et c'est
 * assumé. Un aplat très sourd, un filet, un chevron. Au focus, seule la pastille
 * du chevron s'inverse — pas la carte entière. Un rectangle blanc de 148 px au
 * milieu d'une rangée d'affiches sombres attirerait l'œil en permanence, y
 * compris quand le focus est ailleurs, et volerait la vedette au contenu.
 *
 * Le libellé de catégorie est repris sous l'action. Au bout d'un défilement
 * horizontal de vingt titres, le titre de la rangée est sorti du champ depuis
 * longtemps ; sans ce rappel, on ne sait plus « plus » de quoi.
 *
 * Aucune importation depuis `TvRow` : les dimensions arrivent en props, ce qui
 * évite un cycle d'importation entre la rangée et sa carte.
 */

interface TvMoreCardProps {
  /** Catégorie rappelée sous l'action, par exemple « Nollywood ». */
  category?: string;
  width: number;
  height: number;
  /** Bloc réservé sous la carte, pour aligner les bases avec les affiches. */
  labelHeight: number;
  focused: boolean;
  rowFocused?: boolean;
  restScale?: number;
}

export const TvMoreCard: React.FC<TvMoreCardProps> = ({
  category,
  width,
  height,
  labelHeight,
  focused,
  rowFocused = false,
  restScale = 0.92,
}) => (
  <div
    className="transition-transform duration-150 ease-out"
    style={{
      transform: `scale(${focused ? 1 : restScale})`,
      willChange: rowFocused ? 'transform' : 'auto',
    }}>
    <div
      className={
        'relative flex flex-col items-center justify-center rounded-xl transition-colors duration-150 ' +
        (focused ? 'bg-white/[0.10]' : 'bg-white/[0.04]')
      }
      style={{
        width,
        height,
        border: `1px solid ${focused ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)'}`,
      }}>
      <span
        className="flex items-center justify-center rounded-full transition-colors duration-150"
        style={{
          width: 44,
          height: 44,
          backgroundColor: focused ? 'rgb(var(--tv-focus))' : 'transparent',
          border: `1.5px solid ${focused ? 'rgb(var(--tv-focus))' : 'rgba(255,255,255,0.3)'}`,
          color: focused ? 'rgb(var(--tv-on-focus))' : 'rgba(255,255,255,0.85)',
        }}>
        {/* Chevron tracé à la main : la police d'icônes n'est pas chargée dans
            la WebView, et un glyphe manquant en fin de rangée est plus coûteux
            visuellement qu'un tracé de quinze octets. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.5 2.5 L11 8 L5.5 13.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <p
        className={
          'mt-3 text-[14px] font-semibold leading-tight transition-colors duration-150 ' +
          (focused ? 'text-white' : 'text-white/75')
        }>
        Voir plus
      </p>

      {category && (
        <p
          className="mt-1 max-w-[85%] truncate text-[10px] font-semibold uppercase leading-tight tracking-[0.14em] text-white/40"
          title={category}>
          {category}
        </p>
      )}

      {/* Même anneau que les affiches, monté en permanence et révélé par
          l'opacité : basculer une opacité reste sur le compositeur. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-150"
        style={{ boxShadow: '0 0 0 3px rgb(var(--tv-focus))', opacity: focused ? 1 : 0 }}
      />
    </div>

    {/* Vide, mais réservé : sans lui la carte flotterait 40 px plus bas que les
        affiches dont le titre occupe cette bande. */}
    <div style={{ height: labelHeight, width }} />
  </div>
);

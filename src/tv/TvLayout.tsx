import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { setNativeBackInterception } from '@/utils/tv/isTvDevice';
import { TvFocusProvider } from './nav/TvFocusProvider';
import { runTopBackHandler } from './nav/tvBackStack';
import { useTvViewportLock } from './nav/useTvViewportLock';
import { TV_DESIGN_HEIGHT, TV_DESIGN_WIDTH, TV_SCALE, isTvScaled } from './tvScale';
import { ensurePerfMeasurement } from './devicePerformance';

/**
 * Coquille commune à l'interface téléviseur.
 *
 * Volontairement dépouillée : pas de Header, pas de Footer, pas de défilement
 * lissé. Ces éléments sont conçus pour la souris et coûtent des images sur un
 * SoC de téléviseur. Le rembourrage reste à la charge de chaque page, pour que
 * le lecteur puisse occuper l'écran entier.
 *
 * Elle porte aussi l'échelle : sur un viewport autre que 960 × 540, les pages
 * sont dessinées dans une boîte au gabarit puis mises à l'échelle (voir
 * `tvScale.ts`). Les pages lisent leur hauteur dans `--tv-screen-height`,
 * qui vaut la hauteur du gabarit quand la boîte existe et `100vh` sinon. Sur
 * le téléviseur de référence, rien de tout cela n'est appliqué.
 */

const SCALED_ROOT_STYLE: React.CSSProperties = {
  width: TV_DESIGN_WIDTH,
  height: TV_DESIGN_HEIGHT,
  overflow: 'hidden',
  transform: `scale(${TV_SCALE})`,
  transformOrigin: 'top left',
  ['--tv-screen-height' as string]: `${TV_DESIGN_HEIGHT}px`,
};
export const TvLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isRoot = location.pathname === '/tvapp' || location.pathname === '/tvapp/';

  // Posé ici et non dans un écran : la fiche, les catalogues et la recherche
  // sont exposés au même défilement parasite que l'accueil.
  useTvViewportLock();

  // On ne réclame le Retour que lorsqu'il y a effectivement où revenir. À la
  // racine, on le laisse au shell : il quittera l'application, ce qu'attend
  // l'utilisateur d'une app TV.
  useEffect(() => {
    setNativeBackInterception(!isRoot);
    return () => setNativeBackInterception(false);
  }, [isRoot]);

  // Une page à plusieurs niveaux — la fiche de détail et ses onglets — empile
  // son propre gestionnaire. Sans cet arbitrage, Retour quitterait la page au
  // lieu de remonter d'un niveau.
  useEffect(() => {
    const onBack = () => {
      if (runTopBackHandler()) return;
      navigate(-1);
    };
    window.addEventListener('movix-tv-back', onBack);
    return () => window.removeEventListener('movix-tv-back', onBack);
  }, [navigate]);

  // Palier de performance : mesuré une fois par période, lu au lancement
  // suivant par le mode léger. Voir `devicePerformance.ts`.
  useEffect(() => ensurePerfMeasurement(), []);

  return (
    <TvFocusProvider>
      <div
        className={isTvScaled() ? 'bg-movix-ink text-white' : 'min-h-screen bg-movix-ink text-white'}
        style={isTvScaled() ? SCALED_ROOT_STYLE : undefined}>
        {children}
      </div>
    </TvFocusProvider>
  );
};

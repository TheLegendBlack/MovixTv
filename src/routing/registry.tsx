import type { ComponentType, ReactNode } from 'react';
import { lazyWithRetry } from './lazyWithRetry';

export type RouteEntry = {
  path: string;
  loader: (opts?: { silent?: boolean; routeKey?: string }) => Promise<{ default: ComponentType<unknown> }>;
  fallback?: ReactNode;
  /** Clé de remontage du composant (amont) ; par défaut le chemin complet. */
  getComponentKey?: (pathname: string) => string;
};

const lz = <P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) =>
  (opts?: { silent?: boolean; routeKey?: string }) => lazyWithRetry(loader, opts) as Promise<{ default: ComponentType<unknown> }>;

export const getProviderCatalogScope = (pathname: string): string | null => {
  const match = pathname.match(/^\/provider\/([^/]+)\/(?:movies|tv)(?:\/[^/]+)?\/?$/);
  return match ? `/provider/${match[1]}` : null;
};

/**
 * Les routes du site téléviseur. Le registre du site souris (63 routes) a été
 * réduit le 15/09/2026 à ce que la TV atteint réellement : son interface, sa
 * page de diagnostic, et les deux pages de lecture vers lesquelles elle
 * navigue (`/watch/movie/…`, `/watch/tv/…` et, pour un animé lu dans le
 * découpage Anime-Sama, `/watch/anime/…`).
 *
 * `/tvapp/diag` doit rester déclaré à part : la page de diagnostic porte sa
 * propre sonde de navigation et ne doit pas être montée sous le moteur de
 * TvLayout. React Router classe un segment statique au-dessus d'un splat,
 * donc cette route l'emporte sur `/tvapp/*`.
 */
export const ROUTES: RouteEntry[] = [
  { path: '/watch/movie/:tmdbid',                   loader: lz(() => import('../pages/Watch/WatchMovie')) },
  { path: '/watch/tv/:tmdbid/s/:season/e/:episode', loader: lz(() => import('../pages/Watch/WatchTv')) },
  // Découpage Anime-Sama (onglet de la fiche d'un animé) : entrée et épisode en base 1.
  { path: '/watch/anime/:tmdbid/:entry/:episode',  loader: lz(() => import('../pages/Watch/WatchAnimeSama')) },
  { path: '/tvapp/diag',                            loader: lz(() => import('../tv/TvDiagnosticsPage')) },
  { path: '/tvapp/*',                               loader: lz(() => import('../tv/TvApp')) },
];

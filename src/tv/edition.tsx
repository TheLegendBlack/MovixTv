import React, { useMemo } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { defaultPageRows, type ResolvedPageRows, type TvPageId } from './data/pages';
import type { SettingsEntry } from './settings/settingsEntry';

/**
 * Édition MovixTv : l'application gratuite, sans personnalisation ni compte.
 *
 * Les pages affichent leurs rangées par défaut, Paramètres garde les clés VIP
 * et TMDB, le bloqueur et le diagnostic. Mêmes noms exportés que l'édition
 * complète, pour que le reste du site reste identique dans les deux.
 */

export const EDITION = 'movixtv' as const;

export function installEdition(): void {}

export function usePageRows(page: TvPageId): ResolvedPageRows {
  return useMemo(() => defaultPageRows(page), [page]);
}

export const EDITION_ROUTES: ReadonlyArray<{ path: string; element: React.ReactElement }> = [];

export function useEditionSettingsEntries(_navigate: NavigateFunction): SettingsEntry[] {
  return [];
}

/** Logo de la barre de navigation, à gauche : le nom de l'application. */
export const EditionLogo: React.FC = () => <span className="text-[22px] font-black tracking-tight">Movix TV</span>;

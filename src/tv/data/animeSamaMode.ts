/**
 * Animés regardés dans le découpage Anime-Sama (15/10/2026) : leur fiche
 * rouvre sur l'onglet Anime-Sama, là où l'on en était. Liste d'identifiants
 * TMDB, la plus récente d'abord, bornée.
 */

const STORAGE_KEY = 'movix:tv:anime-sama-mode';
const MAX_SHOWS = 200;

function read(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

export function isAnimeSamaMode(tmdbId: number): boolean {
  return read().includes(tmdbId);
}

export function setAnimeSamaMode(tmdbId: number, enabled: boolean): void {
  const ids = read().filter(id => id !== tmdbId);
  if (enabled) ids.unshift(tmdbId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_SHOWS)));
  } catch {
    /* stockage plein ou fermé : la fiche rouvrira sur l'onglet Épisodes */
  }
}

/**
 * Clé de l'API TMDB.
 *
 * Priorité à la clé saisie dans les réglages de l'interface TV
 * (`localStorage['movix:tv:tmdb-key']`), sinon celle du `.env`
 * (`VITE_TMDB_API_KEY`). La clé de chaque utilisateur plutôt qu'une clé
 * partagée : embarquée dans le site, une clé commune est lisible par tous, et
 * son quota — ou sa révocation — touche tout le monde à la fois.
 *
 * Les modules qui l'utilisent la lisent **à leur chargement**. Changer de clé
 * impose donc de recharger la page, ce que fait l'écran de saisie.
 */

const STORAGE_KEY = 'movix:tv:tmdb-key';

export function getStoredTmdbKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function getTmdbApiKey(): string {
  return getStoredTmdbKey() ?? (import.meta.env.VITE_TMDB_API_KEY || '');
}

export function setStoredTmdbKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Interroge TMDB avec la clé : vrai si elle est acceptée. */
export async function validateTmdbKey(key: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`,
    );
    return response.ok;
  } catch {
    return false;
  }
}

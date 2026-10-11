// Streaming basse latence (LL-HLS) — opt-in par lecteur.
//
// `lowLatencyMode` de hls.js colle au live edge et réduit le buffer : latence
// plus faible mais aucune marge si la connexion ou l'origine hoquette (le
// lecteur cale en même temps que le serveur). D'où l'opt-in + le warning côté
// Settings. Lu au montage du lecteur quand on construit la config Hls() ; un
// changement s'applique donc à la prochaine lecture, pas à une session en cours.
//
// Deux scopes indépendants : `movies` (films/séries + mini-lecteur) et
// `livetv` (chaînes). Défaut : désactivé partout.
//
// Clé non-allowlistée pour la sync : la qualité de connexion est propre à
// chaque appareil, on ne synchronise donc pas ce réglage entre devices.

export type LowLatencyScope = 'movies' | 'livetv';

const STORAGE_KEY = 'low_latency_streaming';

type LowLatencyPrefs = Record<LowLatencyScope, boolean>;

const DEFAULTS: LowLatencyPrefs = { movies: false, livetv: false };

export const LOW_LATENCY_CHANGED_EVENT = 'low_latency_changed';

function read(): LowLatencyPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULTS };
    const values = parsed as Record<string, unknown>;
    return { movies: values.movies === true, livetv: values.livetv === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export function isLowLatencyEnabled(scope: LowLatencyScope): boolean {
  return read()[scope];
}

export function setLowLatencyEnabled(scope: LowLatencyScope, enabled: boolean): boolean {
  const next = { ...read(), [scope]: enabled };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ne pas annoncer un choix que le prochain lecteur ne pourra pas lire.
    return false;
  }
  window.dispatchEvent(new CustomEvent(LOW_LATENCY_CHANGED_EVENT));
  return true;
}

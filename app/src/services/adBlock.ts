import { NativeModules } from 'react-native';

/**
 * Façade JS du bloqueur de publicités natif (module `MovixAdBlock`).
 *
 * Le blocage lui-même se fait dans le WebView natif (`shouldInterceptRequest`),
 * y compris pour les iframes des hébergeurs. Ici : le réglage marche/arrêt, le
 * compteur pour l'écran de réglages, et une copie synchrone de la liste
 * d'hôtes pour refuser côté JS une navigation ou une pop-up vers une régie.
 */
export interface AdBlockStats {
  enabled: boolean;
  blocked: number;
  recent: string[];
}

interface AdBlockNativeModule {
  blockedHosts?: string[];
  setEnabled(enabled: boolean): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  getStats(): Promise<AdBlockStats>;
  resetStats(): Promise<boolean>;
  /** Absent des APK antérieurs au 11/10/2026. */
  trustSiteHost?(host: string): boolean;
}

const native = (NativeModules.MovixAdBlock ?? null) as AdBlockNativeModule | null;

export const AD_BLOCK_AVAILABLE = !!native;

const BLOCKED_HOSTS = new Set<string>(native?.blockedHosts ?? []);

// Miroir du réglage natif, pour les décisions synchrones du WebView. Le natif
// part activé ; on le rejoint dès `loadAdBlockPreference`.
let enabledCache = true;

export function isAdBlockEnabledSync(): boolean {
  return AD_BLOCK_AVAILABLE && enabledCache;
}

export async function loadAdBlockPreference(): Promise<boolean> {
  if (!native) return false;
  enabledCache = await native.isEnabled();
  return enabledCache;
}

export async function setAdBlockEnabled(enabled: boolean): Promise<void> {
  enabledCache = enabled;
  if (native) await native.setEnabled(enabled);
}

export async function getAdBlockStats(): Promise<AdBlockStats> {
  if (!native) return { enabled: false, blocked: 0, recent: [] };
  return native.getStats();
}

/**
 * Déclare au bloqueur les hôtes du site chargé (adresse principale et miroirs).
 * Leurs requêtes sont celles du site, jamais d'une iframe tierce, quel que soit
 * le domaine : Movix, `localhost`, ou un hébergement propre comme Railway.
 */
export function trustSiteUrls(urls: readonly string[]): void {
  if (!native?.trustSiteHost) return;
  for (const url of urls) {
    const host = hostOf(url);
    if (host) native.trustSiteHost(host);
  }
}

export async function resetAdBlockStats(): Promise<void> {
  if (native) await native.resetStats();
}

function hostOf(url: string): string | null {
  // Pas de `new URL()` : le polyfill de React Native ne fournit pas `hostname`.
  const match = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

/** Vrai si l'hôte de `url`, ou un domaine parent, figure dans la liste native. */
export function isBlockedUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  let start = 0;
  for (;;) {
    if (BLOCKED_HOSTS.has(host.slice(start))) return true;
    const dot = host.indexOf('.', start);
    if (dot < 0) return false;
    start = dot + 1;
  }
}

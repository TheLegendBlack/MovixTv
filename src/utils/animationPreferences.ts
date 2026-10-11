export type LightModeSetting = 'auto' | 'on' | 'off';
export type AutoLightModeReason = 'tv' | 'cpu' | 'memory' | 'reducedMotion' | 'measured' | null;

export const ANIMATION_PREF_META = {
  bgAnimations: { storageKey: 'settings_anim_bg', attr: 'data-no-bg-anim' },
  loadingAnimations: { storageKey: 'settings_anim_loading', attr: 'data-no-loading-anim' },
  carouselAutoplay: { storageKey: 'settings_anim_carousel', attr: 'data-no-carousel-anim' },
  blurEffects: { storageKey: 'settings_anim_blur', attr: 'data-no-blur' },
  transitions: { storageKey: 'settings_anim_transitions', attr: 'data-no-transitions' },
} as const;

export type AnimationPrefKey = keyof typeof ANIMATION_PREF_META;
export type AnimationPrefs = Record<AnimationPrefKey, boolean>;
export const ANIMATION_PREF_KEYS = Object.keys(ANIMATION_PREF_META) as AnimationPrefKey[];
export const LIGHT_MODE_STORAGE_KEY = 'settings_light_mode';
export const DEFAULT_ANIMATION_PREFS: AnimationPrefs = {
  bgAnimations: true,
  loadingAnimations: true,
  carouselAutoplay: true,
  blurEffects: true,
  transitions: true,
};

export function parseLightModeSetting(raw: string | null): LightModeSetting {
  return raw === 'on' || raw === 'off' ? raw : 'auto';
}

export function getAutoLightModeReason(device: {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}, reducedMotion: boolean, measuredSlow = false): AutoLightModeReason {
  if (reducedMotion) return 'reducedMotion';
  // Palier mesuré par l'interface téléviseur (`tv/devicePerformance.ts`) : un
  // appareil qui annonce des cœurs et de la mémoire mais ne tient pas trente
  // images par seconde sur l'accueil est faible, quoi qu'il déclare. Ajout
  // local conservé lors de la reprise amont du 11/10/2026.
  if (measuredSlow) return 'measured';
  if (/tizen|web[o0]s|smart[ -]?tv|nettv|appletv|roku|firetv|philipstv|hbbtv|googletv|netcast|vidaa|android[ -]?tv|bravia|hisense|aquos|aft\w+/i.test(device.userAgent ?? '')) return 'tv';
  if (device.hardwareConcurrency && device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2) return 'cpu';
  if (device.deviceMemory && device.deviceMemory > 0 && device.deviceMemory <= 2) return 'memory';
  return null;
}

export function resolveAnimationPrefs(prefs: AnimationPrefs, isLightMode: boolean, reducedMotion: boolean): AnimationPrefs {
  return Object.fromEntries(ANIMATION_PREF_KEYS.map((key) => [
    key, prefs[key] && !isLightMode && !(reducedMotion && key !== 'blurEffects'),
  ])) as AnimationPrefs;
}

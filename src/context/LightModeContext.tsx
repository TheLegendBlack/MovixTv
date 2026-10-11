import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { MotionGlobalConfig } from 'framer-motion';
import {
  ANIMATION_PREF_KEYS, ANIMATION_PREF_META, DEFAULT_ANIMATION_PREFS, LIGHT_MODE_STORAGE_KEY,
  getAutoLightModeReason, parseLightModeSetting, resolveAnimationPrefs,
  type AnimationPrefKey, type AnimationPrefs, type AutoLightModeReason, type LightModeSetting,
} from '@/utils/animationPreferences';
import { PERF_TIER_KEY } from '@/tv/devicePerformance';

export type { AnimationPrefKey, AnimationPrefs } from '@/utils/animationPreferences';

interface LightModeContextType {
  isLightMode: boolean;
  lightModeSetting: LightModeSetting;
  autoReason: AutoLightModeReason;
  systemReducedMotion: boolean;
  storageUnavailable: boolean;
  setLightModeSetting: (setting: LightModeSetting) => void;
  prefs: AnimationPrefs;
  effectivePrefs: AnimationPrefs;
  setPref: (key: AnimationPrefKey, value: boolean) => void;
  resetPrefs: () => void;
}

const LightModeContext = createContext<LightModeContextType | undefined>(undefined);

function readPreferences() {
  const prefs = { ...DEFAULT_ANIMATION_PREFS };
  let setting: LightModeSetting = 'auto';
  let storageUnavailable = false;
  try {
    setting = parseLightModeSetting(localStorage.getItem(LIGHT_MODE_STORAGE_KEY));
    for (const key of ANIMATION_PREF_KEYS) {
      prefs[key] = localStorage.getItem(ANIMATION_PREF_META[key].storageKey) !== 'false';
    }
  } catch {
    // Le stockage peut être bloqué : le mode automatique reste utilisable.
    storageUnavailable = true;
  }
  return { setting, prefs, storageUnavailable };
}

function persist(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    // Le choix reste actif dans cette session si le stockage est indisponible.
    return false;
  }
}

export const LightModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stored, setStored] = useState(readPreferences);
  const [motionQuery] = useState(() => typeof window === 'undefined'
    ? undefined : window.matchMedia?.('(prefers-reduced-motion: reduce)'));
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => motionQuery?.matches ?? false);
  const { setting: lightModeSetting, prefs, storageUnavailable } = stored;
  // Lu une fois par montage : le palier ne change qu'au lancement suivant
  // (voir `tv/devicePerformance.ts`).
  const [measuredSlow] = useState(() => {
    try { return localStorage.getItem(PERF_TIER_KEY) === 'slow'; } catch { return false; }
  });
  const autoReason = getAutoLightModeReason(typeof navigator === 'undefined' ? {} : navigator, systemReducedMotion, measuredSlow);
  const isLightMode = lightModeSetting === 'on' || (lightModeSetting === 'auto' && autoReason !== null);
  const effectivePrefs = useMemo(
    () => resolveAnimationPrefs(prefs, isLightMode, systemReducedMotion),
    [prefs, isLightMode, systemReducedMotion],
  );

  useEffect(() => {
    if (!motionQuery) return;
    const update = () => setSystemReducedMotion(motionQuery.matches);
    update();
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', update);
      return () => motionQuery.removeEventListener('change', update);
    }
    motionQuery.addListener(update);
    return () => motionQuery.removeListener(update);
  }, [motionQuery]);

  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== LIGHT_MODE_STORAGE_KEY
        && !ANIMATION_PREF_KEYS.some((key) => ANIMATION_PREF_META[key].storageKey === event.key)) return;
      const next = readPreferences();
      if (next.storageUnavailable) {
        setStored((prev) => ({ ...prev, storageUnavailable: true }));
        return;
      }
      setStored((prev) => prev.setting === next.setting && ANIMATION_PREF_KEYS.every((key) => prev.prefs[key] === next.prefs[key])
        ? prev : next);
    };
    window.addEventListener('storage', sync);
    window.addEventListener('sync_storage_updated', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sync_storage_updated', sync);
    };
  }, []);

  const setLightModeSetting = useCallback((setting: LightModeSetting) => {
    const saved = persist(LIGHT_MODE_STORAGE_KEY, setting);
    setStored((prev) => ({ ...prev, setting, storageUnavailable: prev.storageUnavailable || !saved }));
  }, []);

  const setPref = useCallback((key: AnimationPrefKey, value: boolean) => {
    const saved = persist(ANIMATION_PREF_META[key].storageKey, String(value));
    setStored((prev) => ({ ...prev, prefs: { ...prev.prefs, [key]: value }, storageUnavailable: prev.storageUnavailable || !saved }));
  }, []);

  const resetPrefs = useCallback(() => {
    const results = ANIMATION_PREF_KEYS.map((key) => persist(ANIMATION_PREF_META[key].storageKey, null));
    setStored((prev) => ({ ...prev, prefs: { ...DEFAULT_ANIMATION_PREFS }, storageUnavailable: prev.storageUnavailable || results.includes(false) }));
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (isLightMode) root.setAttribute('data-light-mode', 'true');
    else root.removeAttribute('data-light-mode');
    for (const key of ANIMATION_PREF_KEYS) {
      const { attr } = ANIMATION_PREF_META[key];
      if (!effectivePrefs[key]) root.setAttribute(attr, 'true');
      else root.removeAttribute(attr);
    }
    // reducedMotion seul ne coupe ni les fondus, ni les délais explicites.
    // Ce réglage public de Framer Motion saute aussi ces animations, sans
    // remonter l'application ni interrompre une lecture en cours.
    MotionGlobalConfig.skipAnimations = !effectivePrefs.transitions;
  }, [isLightMode, effectivePrefs]);

  useLayoutEffect(() => () => {
    document.documentElement.removeAttribute('data-light-mode');
    for (const key of ANIMATION_PREF_KEYS) document.documentElement.removeAttribute(ANIMATION_PREF_META[key].attr);
    MotionGlobalConfig.skipAnimations = false;
  }, []);

  const value = useMemo(() => ({
    isLightMode, lightModeSetting, autoReason, systemReducedMotion, storageUnavailable, setLightModeSetting,
    prefs, effectivePrefs, setPref, resetPrefs,
  }), [isLightMode, lightModeSetting, autoReason, systemReducedMotion, storageUnavailable, setLightModeSetting, prefs, effectivePrefs, setPref, resetPrefs]);

  return <LightModeContext.Provider value={value}>{children}</LightModeContext.Provider>;
};

export const useLightMode = () => {
  const context = useContext(LightModeContext);
  if (context === undefined) throw new Error('useLightMode must be used within a LightModeProvider');
  return context;
};

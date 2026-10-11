import React, { useEffect, useLayoutEffect, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import axios from 'axios';
import { MotionConfig } from 'framer-motion';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { AdFreePopupProvider } from './context/AdFreePopupContext';
import { ProfileProvider } from './context/ProfileContext';
import { LightModeProvider, useLightMode } from './context/LightModeContext';
import { ROUTES, type RouteEntry } from './routing/registry';
import { DelayedSuspense } from './components/DelayedSuspense';
import { RouteProgressBar } from './components/RouteProgressBar';
import { startVipVerification } from './utils/vipUtils';
import { broadcastAuthChange, clearStoredAuthSession } from './utils/accountAuth';
import { detectInitialLanguage } from './i18n';
import { readLocalStorage } from './utils/browserStorage';
import { PLAYER_FULLSCREEN_HOST_ID, releaseHostFullscreen } from './utils/playerFullscreenPersistence';
import {
  pushPriorityToExtension,
  subscribeToPriorityChanges,
} from './utils/sourcePriorityPrefs';

/**
 * Racine du site téléviseur.
 *
 * Réduite le 15/09/2026 à ce que la TV utilise. Le site souris — en-tête,
 * pied de page, connexion, profils, synchronisation du stockage vers le compte,
 * écran de veille, alertes d'épisodes, popups — vivait ici ; il est archivé
 * dans `.tv-backup/suppression-2026-09-15-passe2/src/App.tsx`. Reste : la
 * vérification VIP, la langue, le gestionnaire de 401, les fournisseurs que
 * l'interface TV et le lecteur consomment (mode léger, profil, popup sans
 * pub), le conteneur de plein écran du lecteur, et quatre routes.
 */

// Démarrer la vérification périodique du VIP au lancement de l'app
startVipVerification();

// Detect and set language on first visit (browser language + IP geolocation)
detectInitialLanguage();

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_MAIN_API
const API_HOSTNAME = (() => {
  try {
    return API_URL ? new URL(API_URL).hostname : '';
  } catch {
    return '';
  }
})();

// Global 401 handler: on any 401 from axios, clear storage and redirect to /
// 403 is NOT intercepted here — it can come from Turnstile, admin checks, etc.
// Uses __forceClearInProgress flag to prevent sync operations during forced clear
type Axios401Window = Window & { __axios401Set?: boolean; __forceClearInProgress?: boolean };

(function setupAxios401Handler() {
  const w = window as Axios401Window;
  if (w.__axios401Set) return;
  w.__axios401Set = true;
  axios.interceptors.response.use(
    (resp) => resp,
    (error) => {
      const status = error?.response?.status;
      if (status === 401) {
        // Déterminer le domaine de la requête ayant échoué
        const cfg = error?.config || error?.response?.config || {};
        const baseURL = cfg.baseURL || '';
        const urlPart = cfg.url || '';
        let fullUrl = '';
        try {
          fullUrl = urlPart && /^https?:\/\//i.test(urlPart)
            ? urlPart
            : (baseURL ? new URL(urlPart || '', baseURL).toString() : (urlPart || ''));
        } catch {
          fullUrl = urlPart || '';
        }
        let hostname = '';
        try { hostname = fullUrl ? new URL(fullUrl).hostname : ''; } catch { hostname = ''; }

        // Vérifier si c'est la route /api/admin/check - ne pas déconnecter pour cette route
        const isAdminCheckRoute = fullUrl.includes('/api/admin/check') || urlPart.includes('/api/admin/check');

        // N'appliquer le clear/redirect que pour le domaine API configuré et pas pour /api/admin/check
        if (API_HOSTNAME && hostname === API_HOSTNAME && !isAdminCheckRoute) {
          // Marquer qu'on est en train de faire un clear forcé pour éviter le sync
          w.__forceClearInProgress = true;

          try {
            clearStoredAuthSession();
            broadcastAuthChange();
          } catch { /* stockage indisponible : on redirige quand même */ }
          try { sessionStorage.clear(); } catch { /* idem */ }

          // Réinitialiser le flag après un court délai
          setTimeout(() => {
            w.__forceClearInProgress = false;
          }, 1000);

          window.location.href = '/';
        }
      }
      return Promise.reject(error);
    }
  );
})();

const shouldPreserveScrollOnBack = () => readLocalStorage('settings_disable_auto_scroll') === 'true';

const shouldDisableRouteScrollToTop = () => readLocalStorage('settings_disable_route_scroll_to_top') === 'true';

const isSmoothScrollEnabled = () => readLocalStorage('settings_smooth_scroll') !== 'false';

const shouldAnimateScrollToTop = () => {
  if (!isSmoothScrollEnabled()) {
    return false;
  }

  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const syncHistoryScrollRestoration = () => {
  const preserveScrollOnBack = shouldPreserveScrollOnBack();
  const disableRouteScrollToTop = shouldDisableRouteScrollToTop();

  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = preserveScrollOnBack || disableRouteScrollToTop ? 'auto' : 'manual';
  }

  return {
    preserveScrollOnBack,
    disableRouteScrollToTop
  };
};

// Retourne le nombre d'éléments effectivement remis à zéro : permet aux appelants
// de sauter les passes suivantes quand rien n'était scrollé (perf — évite jusqu'à
// 3 scans complets du DOM par navigation)
const resetNestedScrollableContainers = (): number => {
  const scrollableElements = document.querySelectorAll<HTMLElement>(
    '[data-scroll="true"], [data-radix-scroll-area-viewport], .overflow-y-auto, .overflow-y-scroll, .overflow-auto, .overflow-scroll'
  );

  let resetCount = 0;
  scrollableElements.forEach((element) => {
    if (element.scrollTop !== 0) {
      element.scrollTop = 0;
      resetCount++;
    }
  });
  return resetCount;
};

const forceViewportTop = () => {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
};

const scrollViewportToTop = (mode: 'smooth' | 'instant') => {
  window.scrollTo({ top: 0, left: 0, behavior: mode === 'smooth' ? 'smooth' : 'auto' });

  if (mode === 'instant') {
    forceViewportTop();
  }
};

// Composant pour faire défiler automatiquement vers le haut lors des changements de route
const ScrollToTop = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const prevPathRef = React.useRef(location.pathname);
  const prevScrollUrlRef = React.useRef<string | null>(null);
  const prevScrollNavigationTypeRef = React.useRef(navigationType);

  useEffect(() => {
    const handleRestorationSync = (event?: StorageEvent) => {
      if (
        event?.type === 'storage' &&
        event.key &&
        event.key !== 'settings_disable_auto_scroll' &&
        event.key !== 'settings_disable_route_scroll_to_top'
      ) {
        return;
      }

      syncHistoryScrollRestoration();
    };

    handleRestorationSync();

    window.addEventListener('storage', handleRestorationSync);
    window.addEventListener('settings_auto_scroll_changed', handleRestorationSync as EventListener);
    window.addEventListener('settings_route_scroll_changed', handleRestorationSync as EventListener);

    return () => {
      window.removeEventListener('storage', handleRestorationSync);
      window.removeEventListener('settings_auto_scroll_changed', handleRestorationSync as EventListener);
      window.removeEventListener('settings_route_scroll_changed', handleRestorationSync as EventListener);
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'auto';
      }
    };
  }, []);

  useLayoutEffect(() => {
    const { preserveScrollOnBack, disableRouteScrollToTop } = syncHistoryScrollRestoration();
    const isBackOrForward = navigationType === 'POP';
    const scrollUrl = location.pathname + location.search;
    const navigationTypeChanged = prevScrollNavigationTypeRef.current !== navigationType;
    prevScrollNavigationTypeRef.current = navigationType;
    // Fermer un lecteur via l'historique change PUSH en POP sans changer de
    // page : conserver le défilement et éviter un nouveau scan du DOM.
    if (prevScrollUrlRef.current === scrollUrl && navigationTypeChanged) return undefined;
    prevScrollUrlRef.current = scrollUrl;

    const pathChanged = prevPathRef.current !== location.pathname;
    prevPathRef.current = location.pathname;
    if (!pathChanged) {
      return undefined;
    }

    if (disableRouteScrollToTop) {
      return undefined;
    }

    if (preserveScrollOnBack && isBackOrForward) {
      return undefined;
    }

    let cancelled = false;
    let frameId = 0;
    let nestedFrameId = 0;
    let settleTimeout = 0;
    let userInteracted = false;

    const cancelPendingAdjustments = () => {
      userInteracted = true;
      window.clearTimeout(settleTimeout);
    };

    const handleUserInteraction = () => {
      if (!cancelled) {
        cancelPendingAdjustments();
      }
    };

    const shouldAnimate = shouldAnimateScrollToTop();

    window.addEventListener('wheel', handleUserInteraction, { passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });
    window.addEventListener('touchmove', handleUserInteraction, { passive: true });
    window.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    window.addEventListener('keydown', handleUserInteraction);

    frameId = requestAnimationFrame(() => {
      if (cancelled) return;

      // Perf : on ne répète les scans DOM que si la 1ère passe a trouvé des
      // conteneurs réellement scrollés (un conteneur fraîchement monté est à 0)
      let needsFollowUpReset = false;

      const scrollToTopTracked = (mode: 'smooth' | 'instant') => {
        try {
          scrollViewportToTop(mode);
          needsFollowUpReset = resetNestedScrollableContainers() > 0;
        } catch (error) {
          console.warn('ScrollToTop: Error during scroll operation', error);
        }
      };

      scrollToTopTracked(shouldAnimate ? 'smooth' : 'instant');

      nestedFrameId = requestAnimationFrame(() => {
        if (cancelled || userInteracted || !needsFollowUpReset) return;
        resetNestedScrollableContainers();
      });

      if (!shouldAnimate) {
        settleTimeout = window.setTimeout(() => {
          if (cancelled || userInteracted) return;
          if (needsFollowUpReset) {
            scrollToTopTracked('instant');
          } else {
            scrollViewportToTop('instant');
          }
        }, 120);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(nestedFrameId);
      window.clearTimeout(settleTimeout);
      window.removeEventListener('wheel', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
      window.removeEventListener('touchmove', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
    };
  }, [location.pathname, location.search, navigationType]);

  return null;
};

// Cache module-level des composants Lazy par path. Sans ça, chaque appel à
// renderRouteEntry (ROUTES.map à chaque render d'App) créerait une nouvelle
// instance lazy() avec son propre cache de chunk → instabilité d'identité.
const lazyComponentCache = new Map<string, React.LazyExoticComponent<React.ComponentType<unknown>>>();
const getCachedLazy = (entry: RouteEntry) => {
  let cached = lazyComponentCache.get(entry.path);
  if (!cached) {
    // Le pattern du registre est stable entre les contenus d'une même route et
    // permet de borner la reprise Safari sans stocker l'identifiant de l'URL.
    cached = lazy(() => entry.loader({ routeKey: entry.path }));
    lazyComponentCache.set(entry.path, cached);
  }
  return cached;
};

// Wrapper qui injecte par défaut `key={location.pathname}` sur le composant lazy. Sans ça,
// quand l'utilisateur navigue entre deux URLs matchant le même Route pattern
// (ex. /watch/tv/abc/… → /watch/tv/xyz/…), React Router réutilise l'instance
// composant avec juste les params updated. Les useState de la page gardent les
// valeurs de l'ancien id pendant que le nouveau fetch tourne. Avec
// key={pathname}, la clé change → React remount le composant → state reset.
const RouteLazyContent: React.FC<{
  Lazy: React.LazyExoticComponent<React.ComponentType<unknown>>;
  fallback: React.ReactNode;
  getComponentKey?: (pathname: string) => string;
}> = ({ Lazy, fallback, getComponentKey }) => {
  const location = useLocation();
  const componentKey = getComponentKey?.(location.pathname) ?? location.pathname;
  return (
    <DelayedSuspense fallback={fallback}>
      <Lazy key={componentKey} />
    </DelayedSuspense>
  );
};

const renderRouteEntry = (entry: RouteEntry) => {
  const Lazy = getCachedLazy(entry);
  const element: React.ReactNode = (
    <RouteLazyContent
      Lazy={Lazy}
      fallback={entry.fallback ?? <RouteProgressBar />}
      getComponentKey={entry.getComponentKey}
    />
  );
  return <Route key={entry.path} path={entry.path} element={element} />;
};

const AppShell: React.FC = () => {
  const location = useLocation();
  const isWatchRoute = location.pathname.startsWith('/watch/');

  // Le plein écran du lecteur est porté par le conteneur racine de l'app (voir
  // `PLAYER_FULLSCREEN_HOST_ID`), pour qu'il survive au remontage du lecteur
  // d'un épisode à l'autre. Corollaire : il ne se referme plus tout seul quand
  // le lecteur disparaît — on le relâche donc en quittant les routes lecteur,
  // sinon le reste du site s'afficherait en plein écran.
  React.useEffect(() => {
    if (isWatchRoute) return;
    releaseHostFullscreen();
  }, [isWatchRoute]);

  // Scroll to top when ad popup is accepted (lecture click)
  React.useEffect(() => {
    const onAccepted = () => {
      try {
        scrollViewportToTop(shouldAnimateScrollToTop() ? 'smooth' : 'instant');
      } catch { /* défilement impossible : sans conséquence */ }
    };
    window.addEventListener('ad_popup_accepted', onAccepted);
    return () => window.removeEventListener('ad_popup_accepted', onAccepted);
  }, []);

  // Source priority prefs ↔ extension sync (Milestone 9.1).
  // Push current prefs on mount (extension may already be ready by then), and
  // subscribe to later local changes so the extension mirror stays in sync.
  // Both calls are no-op if the extension isn't installed — see
  // `pushPriorityToExtension` for the swallowed-failure contract.
  React.useEffect(() => {
    void pushPriorityToExtension();
    return subscribeToPriorityChanges((prefs) => {
      void pushPriorityToExtension(prefs);
    });
  }, []);

  return (
    <div id={PLAYER_FULLSCREEN_HOST_ID} className="min-h-screen bg-black text-white relative overflow-clip">
      {/* Composant pour faire défiler vers le haut lors des changements de route */}
      <ScrollToTop />
      <Routes>
        {/* La racine et toute adresse inconnue mènent à l'interface téléviseur. */}
        <Route path="/" element={<Navigate to="/tvapp" replace />} />
        {ROUTES.map(renderRouteEntry)}
        <Route path="*" element={<Navigate to="/tvapp" replace />} />
      </Routes>
    </div>
  );
};

// Wraps the tree in a <MotionConfig> tied to the Mode léger / animation prefs.
// When `transitions` is disabled (manually or because Mode léger is on),
// MotionConfig limite les transformations. LightModeProvider coupe aussi
// les fondus et les délais via MotionGlobalConfig.skipAnimations.
const AnimationMotionConfig: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { effectivePrefs } = useLightMode();
  return (
    <MotionConfig reducedMotion={effectivePrefs.transitions ? 'user' : 'always'}>
      {children}
    </MotionConfig>
  );
};

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TooltipProvider delayDuration={300}>
      <LightModeProvider>
      <AnimationMotionConfig>
        <AdFreePopupProvider>
          <ProfileProvider>
            <AppShell />
            <Toaster position="bottom-right" richColors />
          </ProfileProvider>
        </AdFreePopupProvider>
      </AnimationMotionConfig>
      </LightModeProvider>
      </TooltipProvider>
    </BrowserRouter>
  );
};

export default App;

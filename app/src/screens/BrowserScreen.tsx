import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { View, StyleSheet, BackHandler, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WebViewNavigation } from 'react-native-webview';

import WebViewBrowser, { type WebViewBrowserRef } from '../components/WebViewBrowser';
import MirrorErrorScreen from '../components/MirrorErrorScreen';
import { setLocalPlaybackAwake } from '../services/playbackAwake';
import { setPictureInPicturePlaybackActive } from '../services/pictureInPicture';
import { useAddress } from '../context/AddressContext';
import { IS_TV } from '../services/deviceInfo';
import { trustSiteUrls } from '../services/adBlock';

/**
 * L'écran unique du shell : la WebView plein cadre, et l'écran d'erreur quand
 * tous les miroirs échouent.
 *
 * La barre d'adresse, la barre de navigation, la pastille flottante et l'écran
 * de réglages tactiles ont été retirés le 15/09/2026 : ce shell ne sert plus
 * que la télévision, où rien de tout cela n'était atteignable à la
 * télécommande (`IS_TV` les masquait déjà). Les réglages utiles à la TV vivent
 * dans le site, sous `/tvapp/settings`.
 */

const MAX_NETWORK_RETRIES = 2;
const NETWORK_RETRY_WINDOW_MS = 30_000;
const NETWORK_RETRY_DELAY_MS = 1000;

export default function BrowserScreen() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebViewBrowserRef>(null);
  const { config, isLoading, refresh } = useAddress();

  const urlChain = useMemo(() => {
    if (!config) return [];
    const bases = [config.primaryUrl, ...config.mirrors];
    // Sur TV on entre directement dans l'interface téléviseur : la racine sert
    // le site souris/tactile, inutilisable à la télécommande.
    // Le bloqueur doit connaître ces hôtes avant la première requête de la page.
    trustSiteUrls(bases);
    if (!IS_TV) return bases;
    return bases.map(base => `${base.replace(/\/+$/, '')}/tvapp`);
  }, [config]);

  const [mirrorIndex, setMirrorIndex] = useState(0);
  const [allMirrorsFailed, setAllMirrorsFailed] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isPictureInPictureActive, setIsPictureInPictureActive] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const networkRetriesRef = useRef({ count: 0, since: 0 });

  const activeUrl = urlChain[mirrorIndex] ?? '';

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // La page passe avant l'historique : sur TV, Retour doit d'abord fermer un
      // panneau ou sortir du lecteur. Elle ne le réclame que si elle a
      // effectivement quelque chose à fermer.
      if (webViewRef.current?.wantsBackInterception()) {
        webViewRef.current.dispatchBackToPage();
        return true;
      }
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => handler.remove();
  }, [canGoBack]);

  useEffect(() => () => {
    setPictureInPicturePlaybackActive(false);
    setLocalPlaybackAwake(false);
  }, []);

  const onPictureInPictureModeChange = useCallback((active: boolean) => {
    setIsPictureInPictureActive(active);
  }, []);

  const onNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
  }, []);

  const onWebViewError = useCallback(
    (description: string) => {
      console.warn('[BrowserScreen] WebView error', description, 'on', activeUrl);
      // Le réseau a changé pendant le chargement (VPN DNS qui démarre, passage
      // Wi-Fi/4G) : le miroir n'y est pour rien, on recharge le même.
      const now = Date.now();
      const retries = networkRetriesRef.current;
      if (now - retries.since > NETWORK_RETRY_WINDOW_MS) {
        retries.count = 0;
        retries.since = now;
      }
      if (
        description.includes('ERR_NETWORK_CHANGED') &&
        retries.count < MAX_NETWORK_RETRIES
      ) {
        retries.count += 1;
        setTimeout(() => setLoadAttempt(n => n + 1), NETWORK_RETRY_DELAY_MS);
        return;
      }
      if (mirrorIndex + 1 < urlChain.length) {
        setMirrorIndex(i => i + 1);
      } else {
        setAllMirrorsFailed(true);
      }
    },
    [activeUrl, mirrorIndex, urlChain.length],
  );

  const onRetry = useCallback(async () => {
    setAllMirrorsFailed(false);
    setMirrorIndex(0);
    await refresh();
  }, [refresh]);

  if (isLoading || !config) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    );
  }

  if (allMirrorsFailed) {
    return (
      <MirrorErrorScreen telegramUrl={config.telegramUrl} onRetry={onRetry} />
    );
  }

  return (
    <View style={[styles.container, {
      paddingTop: isPictureInPictureActive ? 0 : insets.top,
    }]}>
      <View style={styles.webViewContainer}>
        <WebViewBrowser
          key={`${activeUrl}#${loadAttempt}`}
          ref={webViewRef}
          url={activeUrl}
          onNavigationStateChange={onNavigationStateChange}
          onError={onWebViewError}
          onPictureInPictureModeChange={onPictureInPictureModeChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  webViewContainer: {
    flex: 1,
  },
});

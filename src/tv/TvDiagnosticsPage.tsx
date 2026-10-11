import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type Hls from 'hls.js';
import { getTvDetection, setTvOverride } from '@/utils/tv/isTvDevice';
import { TV_SAFE_X } from '@/tv/components/TvRow';
import { TvIcon, TvSectionLabel, TvStatusDot, TvToggle, type TvIconName, type TvTone } from '@/tv/settings/kit';
import { useSpatialNavProbe } from './useSpatialNavProbe';
import { useFpsMeter } from './useFpsMeter';
import {
  probeCodecs,
  probeDrm,
  probeHls,
  type CodecProbe,
  type DrmProbe,
} from './mediaCapabilities';

/**
 * Page de validation matérielle — Phase 0 de l'adaptation TV.
 *
 * Elle ne fait partie d'aucun parcours utilisateur : elle sert à répondre sur le
 * vrai téléviseur aux questions qui conditionnent tout le reste du chantier.
 *   1. La détection TV fonctionne-t-elle ?
 *   2. Quel viewport CSS la WebView expose-t-elle réellement ?
 *   3. Quels codecs et quel niveau Widevine sont disponibles ?
 *   4. Les touches de la télécommande arrivent-elles, et avec quelle latence ?
 *   5. Le HLS joue-t-il, et à quel framerate l'interface tient-elle ?
 *
 * Accessible sur /tvapp/diag, depuis Paramètres. Dans un navigateur de bureau :
 * /tvapp/diag?tv=1. Le préfixe est /tvapp et non /tv : `/tv/:id` est déjà la
 * route des séries.
 *
 * ## Présentation
 *
 * Même gabarit que les sous-écrans de Paramètres : en-tête avec Retour, un
 * onglet par question, un écran fixe de 960×540 sans défilement. Chaque onglet
 * porte une pastille d'état, pour lire le verdict d'ensemble sans tout ouvrir.
 * Les onglets s'ouvrent avec OK, comme sur l'écran Couleurs : un panneau qui
 * changerait au simple passage du focus disparaîtrait dès qu'une flèche
 * gauche, depuis la grille de test, remonte sur un autre onglet.
 *
 * ## Navigation
 *
 * La page reste hors de `TvLayout` : elle porte sa propre sonde
 * (`useSpatialNavProbe`), qui déplace le **focus DOM** entre les éléments
 * `data-tv-focusable`. Les styles de focus sont donc des `focus:` CSS, pas
 * l'état du moteur, et les briques de `settings/kit` n'en sont reprises que pour
 * leur apparence. Un panneau masqué retire `data-tv-focusable` à ses éléments :
 * la sonde ne doit pas viser ce que le navigateur refuse de focaliser.
 *
 * La touche Retour de la télécommande n'est pas interceptée : elle fait partie
 * des touches à tester. On quitte la page par le bouton Retour à l'écran.
 */

// Flux de test public d'Apple : multi-débit, TS, sous-titres. Sert de référence
// « si ça ne passe pas ici, le problème n'est pas nos sources ».
const DEFAULT_TEST_STREAM =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8';

const MAX_KEY_LOG = 14;

interface KeyLogEntry {
  id: number;
  label: string;
  detail: string;
  /** Délai entre l'appui et l'image suivante, en ms. */
  latencyMs: number | null;
}

interface PlaybackStats {
  droppedFrames: number;
  totalFrames: number;
  resolution: string;
  buffered: string;
  level: string;
}

type TabId = 'detection' | 'ecran' | 'codecs' | 'telecommande' | 'lecture';

const TABS: { id: TabId; label: string; icon: TvIconName }[] = [
  { id: 'detection', label: 'Détection', icon: 'target' },
  { id: 'ecran', label: 'Écran', icon: 'monitor' },
  { id: 'codecs', label: 'Codecs & DRM', icon: 'shield' },
  { id: 'telecommande', label: 'Télécommande', icon: 'remote' },
  { id: 'lecture', label: 'Lecture HLS', icon: 'play' },
];

/* --- Briques ---------------------------------------------------------------- */

/** Attribut lu par la sonde : présent seulement sur ce qui est visible. */
const focusable = (on = true) => (on ? { 'data-tv-focusable': '' } : { tabIndex: -1 });

/** Surface d'un bouton, et son focus : la pastille `tv-focus` des autres écrans. */
const PRESSABLE =
  'border-2 border-white/[0.08] bg-white/[0.05] text-white outline-none transition-transform duration-150 ' +
  'focus:scale-[1.02] focus:border-transparent focus:bg-tv-focus focus:text-tv-on-focus ' +
  'focus:shadow-[0_6px_20px_rgb(0_0_0/0.45)]';

const toneText: Record<TvTone, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-red-300',
  off: 'text-white/50',
};

const Verdict: React.FC<{ ok: boolean; children?: React.ReactNode }> = ({ ok, children }) => (
  <span className={'inline-flex items-center gap-1.5 font-semibold ' + (ok ? 'text-emerald-300' : 'text-red-300')}>
    <TvStatusDot tone={ok ? 'ok' : 'error'} />
    {children ?? (ok ? 'oui' : 'non')}
  </span>
);

const Row: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-1.5 text-[14px] last:border-b-0">
    <span className="min-w-0 truncate text-white/60">{label}</span>
    <span className="shrink-0 text-right font-semibold tabular-nums">{children}</span>
  </div>
);

const StatTile: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: TvTone; large?: boolean }> = ({
  label,
  value,
  sub,
  tone,
  large = false,
}) => (
  <div className="min-w-0 rounded-xl bg-white/[0.04] px-3 py-2">
    <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">{label}</p>
    <p
      className={
        'truncate font-black tabular-nums leading-tight ' +
        (large ? 'mt-1 text-[24px] ' : 'mt-0.5 text-[17px] ') +
        (tone ? toneText[tone] : 'text-white')
      }>
      {value}
    </p>
    {sub && <p className="mt-0.5 truncate text-[12px] text-white/40">{sub}</p>}
  </div>
);

const DiagButton: React.FC<{
  label: React.ReactNode;
  icon?: TvIconName;
  onClick: () => void;
  visible?: boolean;
  className?: string;
  ariaLabel?: string;
}> = ({ label, icon, onClick, visible = true, className = '', ariaLabel }) => (
  <button
    type="button"
    {...focusable(visible)}
    aria-label={ariaLabel}
    onClick={onClick}
    className={'flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[14px] font-semibold ' + PRESSABLE + ' ' + className}>
    {icon && <TvIcon name={icon} size={16} />}
    {label}
  </button>
);

/* --- Page ------------------------------------------------------------------- */

const TvDiagnosticsPage: React.FC = () => {
  const navigate = useNavigate();
  const detection = useMemo(() => getTvDetection(), []);
  const codecs = useMemo<CodecProbe[]>(() => probeCodecs(), []);
  const hlsSupport = useMemo(() => probeHls(), []);
  const [drm, setDrm] = useState<DrmProbe[] | null>(null);

  const [tab, setTab] = useState<TabId>('detection');
  const [showSafeZone, setShowSafeZone] = useState(false);

  const [keyLog, setKeyLog] = useState<KeyLogEntry[]>([]);
  const keyIdRef = useRef(0);

  const [viewport, setViewport] = useState(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
  }));

  const [streamUrl, setStreamUrl] = useState(DEFAULT_TEST_STREAM);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [stats, setStats] = useState<PlaybackStats | null>(null);
  const [stressEnabled, setStressEnabled] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const firstTabRef = useRef<HTMLButtonElement>(null);

  const fps = useFpsMeter(true);

  useEffect(() => {
    void probeDrm().then(setDrm);
  }, []);

  // Focus de départ sur le premier onglet, si la sonde n'en a pas déjà posé un.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    firstTabRef.current?.focus();
  }, []);

  useEffect(() => {
    const onResize = () =>
      setViewport({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        screenWidth: window.screen?.width ?? 0,
        screenHeight: window.screen?.height ?? 0,
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pushKeyLog = useCallback((label: string, detail: string) => {
    const pressedAt = performance.now();
    keyIdRef.current += 1;
    const id = keyIdRef.current;
    setKeyLog(previous => [{ id, label, detail, latencyMs: null }, ...previous].slice(0, MAX_KEY_LOG));

    // La latence mesurée est « appui → image peinte » : c'est elle que
    // l'utilisateur ressent, pas le temps de traitement de l'événement.
    requestAnimationFrame(() => {
      const latencyMs = Math.round(performance.now() - pressedAt);
      setKeyLog(previous => previous.map(entry => (entry.id === id ? { ...entry, latencyMs } : entry)));
    });
  }, []);

  const onKeyEvent = useCallback(
    (event: KeyboardEvent) => {
      pushKeyLog(event.key === ' ' ? 'Space' : event.key, `code=${event.code || '—'} keyCode=${event.keyCode}`);
    },
    [pushKeyLog],
  );

  useSpatialNavProbe(onKeyEvent);

  // Touches média relayées par le shell natif (tv-shim.ts). Chromium ne les
  // convertit pas en keydown, donc elles n'apparaissent que par ce canal.
  useEffect(() => {
    const onRemote = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      pushKeyLog(`⏯ ${detail?.action ?? '?'}`, 'via bridge natif movix-tv-remote');
    };
    window.addEventListener('movix-tv-remote', onRemote);
    return () => window.removeEventListener('movix-tv-remote', onRemote);
  }, [pushKeyLog]);

  const teardownPlayback = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    setIsPlaying(false);
    setStats(null);
  }, []);

  useEffect(() => teardownPlayback, [teardownPlayback]);

  const startPlayback = useCallback(async () => {
    setPlaybackError(null);
    teardownPlayback();

    const video = videoRef.current;
    if (!video) return;

    try {
      // Le HLS natif est préféré quand il existe (Tizen/webOS/Safari) : moins de
      // JS dans la boucle, décodage entièrement délégué à la plateforme.
      if (hlsSupport.nativeHls) {
        video.src = streamUrl;
        await video.play();
        setIsPlaying(true);
        return;
      }

      const HlsModule = (await import('hls.js')).default;
      if (!HlsModule.isSupported()) {
        setPlaybackError('hls.js non supporté et pas de HLS natif : cette WebView ne peut pas lire de HLS.');
        return;
      }

      const hls = new HlsModule({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.on(HlsModule.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        setPlaybackError(`hls.js ${data.type} / ${data.details}`);
        setIsPlaying(false);
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      await video.play();
      setIsPlaying(true);
    } catch (error) {
      setPlaybackError(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      setIsPlaying(false);
    }
  }, [hlsSupport.nativeHls, streamUrl, teardownPlayback]);

  // Les frames droppées sont le seul indicateur fiable d'un décodage qui
  // n'arrive pas à suivre : le fps rAF mesure l'UI, pas la vidéo.
  useEffect(() => {
    if (!isPlaying) return;
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const quality = video.getVideoPlaybackQuality?.();
      const buffered =
        video.buffered.length > 0
          ? `${(video.buffered.end(video.buffered.length - 1) - video.currentTime).toFixed(1)} s`
          : '—';
      const hls = hlsRef.current;
      const currentLevel = hls?.levels?.[hls.currentLevel];
      setStats({
        droppedFrames: quality?.droppedVideoFrames ?? 0,
        totalFrames: quality?.totalVideoFrames ?? 0,
        resolution: `${video.videoWidth}×${video.videoHeight}`,
        buffered,
        level: currentLevel ? `${currentLevel.height}p @ ${Math.round((currentLevel.bitrate ?? 0) / 1000)} kbps` : 'natif',
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [isPlaying]);

  /* --- Verdicts ----------------------------------------------------------- */

  const dropRate = stats && stats.totalFrames > 0 ? (stats.droppedFrames / stats.totalFrames) * 100 : 0;
  const fpsTone: TvTone = fps.current >= 50 ? 'ok' : fps.current >= 30 ? 'warn' : 'error';
  const supportedCodecs = codecs.filter(codec => codec.supported).length;
  const hlsPlayable = hlsSupport.nativeHls || hlsSupport.mediaSource;
  const drmSupported = drm ? drm.some(level => level.supported) : null;
  const latencies = keyLog.map(entry => entry.latencyMs).filter((v): v is number => v !== null);
  const averageLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const latencyTone = (ms: number | null): TvTone => (ms === null ? 'off' : ms <= 50 ? 'ok' : ms <= 100 ? 'warn' : 'error');

  const tabTone: Record<TabId, TvTone> = {
    detection: detection.isTv ? 'ok' : 'warn',
    ecran: 'off',
    codecs: !hlsPlayable ? 'error' : drmSupported === false ? 'warn' : drmSupported === null ? 'off' : 'ok',
    telecommande: keyLog.length > 0 ? latencyTone(averageLatency) : 'off',
    lecture: playbackError ? 'error' : stats && dropRate > 2 ? 'error' : fpsTone,
  };

  const isTab = (id: TabId) => tab === id;
  const physicalWidth = Math.round(viewport.innerWidth * viewport.devicePixelRatio);
  const physicalHeight = Math.round(viewport.innerHeight * viewport.devicePixelRatio);
  const lastKey = keyLog[0];

  return (
    <div className="movix-tv-diag relative h-screen overflow-hidden bg-movix-ink text-white">
      {/* Cadre de sûreté à 5 % : s'il est coupé, la TV applique de l'overscan et
          toute l'interface devra respecter cette marge. Étiqueté, parce que sans
          légende il se lit comme un curseur de focus. Affiché à la demande
          (onglet Écran) : en permanence, il passait sur l'en-tête. */}
      {showSafeZone && (
        <div className="pointer-events-none fixed inset-[5%] z-50 rounded-lg border-2 border-dashed border-amber-400/60">
          <span className="absolute -bottom-3 right-4 rounded bg-movix-ink px-2 text-[12px] font-bold uppercase tracking-wider text-amber-400/80">
            zone de sûreté 5 % — pas un curseur
          </span>
        </div>
      )}

      {stressEnabled && (
        <>
          <div className="movix-tv-diag-stress pointer-events-none fixed inset-0 z-10" />
          <div className="pointer-events-none fixed inset-0 z-20 backdrop-blur-2xl" />
        </>
      )}
      <style>{`
        @keyframes movixTvDiagStress {
          0% { transform: translate3d(-10%, -10%, 0) rotate(0deg); }
          100% { transform: translate3d(10%, 10%, 0) rotate(360deg); }
        }
        .movix-tv-diag-stress {
          background: conic-gradient(from 0deg, #8b5cf6, #ec4899, #22d3ee, #8b5cf6);
          filter: blur(40px);
          opacity: 0.5;
          animation: movixTvDiagStress 6s linear infinite;
        }
      `}</style>

      {/* Budget vertical (540 px) : en-tête 132, onglets 56, marge basse 20 ;
          reste 316 px par panneau. Le plus haut, Lecture HLS, en prend ≈ 294
          (vidéo 225 + adresse 44 à gauche ; boutons, six mesures et la note
          à droite). */}
      <div
        className="relative z-30 flex h-full flex-col pb-5"
        style={{ paddingLeft: TV_SAFE_X, paddingRight: TV_SAFE_X, paddingTop: 24 }}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            {...focusable()}
            aria-label="Retour"
            onClick={() => navigate('/tvapp/settings')}
            className={
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 pl-2.5 pr-4 text-white outline-none transition-transform duration-150 ' +
              'focus:scale-105 focus:bg-tv-focus focus:text-tv-on-focus'
            }>
            <TvIcon name="back" size={18} />
            <span className="text-[14px] font-semibold">Retour</span>
          </button>
          <span className="truncate text-[13px] text-white/40">Paramètres</span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[26px] font-black leading-tight tracking-tight">Diagnostic matériel</h1>
            <p className="mt-1 max-w-[640px] text-[14px] leading-snug text-white/55">
              Ce que ce téléviseur sait faire, mesuré sur place. OK sur un onglet pour l’afficher.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2 text-[13px] text-white/55">
            <TvStatusDot tone={fpsTone} />
            Interface : <span className="font-semibold tabular-nums text-white">{fps.current} i/s</span>
          </span>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {TABS.map((entry, index) => (
            <button
              key={entry.id}
              ref={index === 0 ? firstTabRef : undefined}
              type="button"
              {...focusable()}
              aria-pressed={isTab(entry.id)}
              onClick={() => setTab(entry.id)}
              className={
                'group relative flex h-9 items-center gap-2 rounded-full px-4 text-[15px] font-semibold outline-none transition-transform duration-150 ' +
                'focus:scale-105 focus:bg-tv-focus focus:text-tv-on-focus ' +
                (isTab(entry.id) ? 'bg-white/[0.14] text-white' : 'bg-transparent text-white/60')
              }>
              <TvIcon name={entry.icon} size={17} />
              {entry.label}
              <TvStatusDot tone={tabTone[entry.id]} />
              {isTab(entry.id) && (
                <span className="absolute inset-x-4 -bottom-1 h-[3px] rounded-full bg-movix-red group-focus:hidden" aria-hidden />
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1">
          {/* 1 · Détection */}
          {isTab('detection') && (
            <div className="flex h-full gap-6">
              <div className="w-[400px] shrink-0">
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <span
                    className={
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ' +
                      (detection.isTv ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300')
                    }>
                    <TvIcon name={detection.isTv ? 'check' : 'alert'} size={24} strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[18px] font-bold leading-tight">
                      {detection.isTv ? 'Téléviseur détecté' : 'Navigateur non-TV'}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-white/55">Source : {detection.source}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Row label="Mode TV actif">
                    <Verdict ok={detection.isTv} />
                  </Row>
                  <Row label="Bridge natif présent">
                    <Verdict ok={detection.hasNativeBridge} />
                  </Row>
                  <Row label={<>Classe <code className="font-mono text-[13px]">.movix-tv</code> sur &lt;html&gt;</>}>
                    <Verdict ok={document.documentElement.classList.contains('movix-tv')} />
                  </Row>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <TvSectionLabel>User-agent</TvSectionLabel>
                <p className="max-h-[104px] overflow-hidden break-all rounded-xl bg-black/30 p-3 font-mono text-[12px] leading-relaxed text-white/65">
                  {detection.userAgent || '—'}
                </p>
                <TvSectionLabel className="mt-4">Forçage du mode TV</TvSectionLabel>
                <div className="flex gap-2">
                  <DiagButton
                    icon="target"
                    label={`Forcer ${detection.isTv ? 'OFF' : 'ON'}`}
                    onClick={() => {
                      setTvOverride(!detection.isTv);
                      window.location.reload();
                    }}
                  />
                  <DiagButton
                    icon="reset"
                    label="Effacer le forçage"
                    onClick={() => {
                      setTvOverride(null);
                      window.location.reload();
                    }}
                  />
                </div>
                <p className="mt-2 text-[12px] text-white/40">Les deux boutons rechargent la page.</p>
              </div>
            </div>
          )}

          {/* 2 · Écran & viewport */}
          {isTab('ecran') && (
            <div className="flex h-full flex-col">
              <div className="grid grid-cols-4 gap-2">
                <StatTile large label="Viewport CSS" value={`${viewport.innerWidth} × ${viewport.innerHeight}`} sub="px CSS" />
                <StatTile large label="Densité" value={viewport.devicePixelRatio} sub="devicePixelRatio" />
                <StatTile large label="Écran" value={`${viewport.screenWidth} × ${viewport.screenHeight}`} sub="window.screen" />
                <StatTile large label="Pixels physiques" value={`${physicalWidth} × ${physicalHeight}`} sub="estimés" />
              </div>
              <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-white/55">
                C’est le viewport CSS qui fixe l’échelle de l’interface. Un 1920×1080 physique exposé en 960×540 CSS
                impose de diviser par deux toutes les tailles prévues.
              </p>
              <button
                type="button"
                {...focusable()}
                aria-pressed={showSafeZone}
                onClick={() => setShowSafeZone(value => !value)}
                className={'mt-4 flex w-[460px] items-center gap-3 rounded-xl px-3.5 py-2.5 text-left ' + PRESSABLE}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-bold leading-tight">Zone de sûreté 5 %</span>
                  <span className="mt-0.5 block truncate text-[13px] opacity-60">
                    Cadre pointillé : s’il est coupé, le téléviseur rogne les bords.
                  </span>
                </span>
                <TvToggle on={showSafeZone} />
              </button>
            </div>
          )}

          {/* 3 · Codecs & DRM */}
          {isTab('codecs') && (
            <div className="flex h-full gap-6">
              <div className="min-w-0 flex-1">
                <TvSectionLabel>
                  Codecs · {supportedCodecs} / {codecs.length} pris en charge
                </TvSectionLabel>
                <div className="grid grid-cols-3 gap-2">
                  {codecs.map(codec => (
                    <div
                      key={codec.mimeType}
                      title={codec.mimeType}
                      className="flex min-w-0 items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
                      <TvStatusDot tone={codec.supported ? 'ok' : 'error'} />
                      <span className={'min-w-0 truncate text-[13px] font-semibold ' + (codec.supported ? '' : 'text-white/50 line-through')}>
                        {codec.label}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Sous les codecs et non dans la colonne DRM : à droite, les
                    neuf mesures empilées dépassaient les 540 px (Widevine L3
                    sortait de 34 px sous le bas de l'écran, Edenwood, 11/10/2026). */}
                <TvSectionLabel className="mt-4">Lecture HLS</TvSectionLabel>
                <div className="max-w-[420px]">
                  <Row label="HLS natif">
                    <Verdict ok={hlsSupport.nativeHls} />
                  </Row>
                  <Row label="MediaSource (hls.js)">
                    <Verdict ok={hlsSupport.mediaSource} />
                  </Row>
                  <Row label="MPEG-TS dans MSE">
                    <Verdict ok={hlsSupport.mpegTsInMse}>{hlsSupport.mpegTsInMse ? 'oui' : 'transmux'}</Verdict>
                  </Row>
                </div>
              </div>
              <div className="w-[300px] shrink-0">
                <TvSectionLabel>DRM</TvSectionLabel>
                {/* EME exige un contexte sécurisé. http://localhost en est un : si
                    cette ligne dit oui, un échec Widevine vient bien de la WebView
                    et non de l'origine. */}
                <Row label="Contexte sécurisé (EME)">
                  <Verdict ok={window.isSecureContext} />
                </Row>
                <Row label="requestMediaKeySystemAccess">
                  <Verdict ok={typeof navigator.requestMediaKeySystemAccess === 'function'} />
                </Row>
                {drm === null ? (
                  <p className="py-1.5 text-[14px] text-white/50">Sonde Widevine en cours…</p>
                ) : (
                  drm.map(level => (
                    <div key={level.label}>
                      <Row label={level.label}>
                        <Verdict ok={level.supported} />
                      </Row>
                      {level.error && <p className="-mt-1 mb-1 truncate text-[12px] text-amber-300/90">{level.error}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 4 · Télécommande */}
          {isTab('telecommande') && (
            <div className="flex h-full gap-6">
              <div className="w-[340px] shrink-0">
                <p className="text-[13px] leading-snug text-white/55">
                  Flèches, OK, Retour, puis lecture/pause et avance rapide. Les flèches déplacent le focus dans la
                  grille ; les touches média arrivent par le bridge natif.
                </p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {Array.from({ length: 12 }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      {...focusable()}
                      onClick={() => pushKeyLog('OK', `case ${index + 1}`)}
                      className={'h-11 rounded-lg text-[16px] font-bold tabular-nums ' + PRESSABLE}>
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                  {lastKey ? (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">Dernière touche</p>
                        <p className="truncate text-[26px] font-black leading-tight text-movix-red-bright">{lastKey.label}</p>
                        <p className="truncate font-mono text-[12px] text-white/50">{lastKey.detail}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={'text-[22px] font-black tabular-nums ' + toneText[latencyTone(lastKey.latencyMs)]}>
                          {lastKey.latencyMs === null ? '…' : `${lastKey.latencyMs} ms`}
                        </p>
                        <p className="text-[12px] text-white/45">
                          {averageLatency === null ? 'appui → image' : `moyenne ${averageLatency} ms`}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 py-2 text-white/45">
                      <TvIcon name="remote" size={22} />
                      <p className="text-[15px]">Aucune touche captée pour l’instant.</p>
                    </div>
                  )}
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                  {keyLog.slice(1).map(entry => (
                    <div key={entry.id} className="flex items-baseline gap-3 border-b border-white/[0.06] py-1 text-[13px] last:border-b-0">
                      <span className="w-24 shrink-0 truncate font-bold">{entry.label}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/45">{entry.detail}</span>
                      <span className={'shrink-0 tabular-nums ' + toneText[latencyTone(entry.latencyMs)]}>
                        {entry.latencyMs === null ? '…' : `${entry.latencyMs} ms`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 5 · Lecture HLS & performance. Toujours monté, masqué hors de son
              onglet : la vidéo doit continuer de jouer, et ses statistiques
              d'être relevées, quand on regarde un autre onglet. */}
          <div className={isTab('lecture') ? 'flex h-full gap-6' : 'hidden'}>
            <div className="w-[400px] shrink-0">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} playsInline controls={false} className="h-full w-full" />
                {!isPlaying && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/45">
                    <TvIcon name="play" size={28} />
                    <p className="text-[13px]">Flux de test Apple · OK sur Lire</p>
                  </div>
                )}
              </div>
              <input
                type="url"
                value={streamUrl}
                onChange={event => setStreamUrl(event.target.value)}
                {...focusable(isTab('lecture'))}
                spellCheck={false}
                aria-label="Adresse du flux HLS"
                className="mt-2 h-9 w-full rounded-lg border-2 border-white/15 bg-black/30 px-3 font-mono text-[12px] text-white/80 outline-none focus:border-tv-focus"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex gap-2">
                <DiagButton visible={isTab('lecture')} icon="play" label="Lire" onClick={() => void startPlayback()} />
                <DiagButton visible={isTab('lecture')} icon="stop" label="Arrêter" onClick={teardownPlayback} />
                <DiagButton
                  visible={isTab('lecture')}
                  icon="sparkles"
                  label={<>Stress CSS <TvToggle on={stressEnabled} /></>}
                  ariaLabel={`Stress CSS : ${stressEnabled ? 'activé' : 'désactivé'}`}
                  onClick={() => setStressEnabled(value => !value)}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatTile label="FPS interface" value={fps.current} tone={fpsTone} />
                <StatTile label="Pire seconde" value={fps.worst} />
                <StatTile label="Résolution vidéo" value={stats?.resolution ?? '—'} />
                <StatTile label="Palier HLS" value={stats?.level ?? '—'} />
                <StatTile label="Buffer d’avance" value={stats?.buffered ?? '—'} />
                <StatTile
                  label="Frames droppées"
                  value={stats ? `${stats.droppedFrames} / ${stats.totalFrames} (${dropRate.toFixed(1)} %)` : '—'}
                  tone={stats ? (dropRate > 2 ? 'error' : 'ok') : undefined}
                />
              </div>
              {playbackError ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200" role="status">
                  <TvIcon name="alert" size={16} className="mt-px shrink-0" />
                  <span className="min-w-0 break-words">{playbackError}</span>
                </p>
              ) : (
                <p className="mt-3 text-[12px] leading-snug text-white/45">
                  Active le stress CSS pendant la lecture : sous 30 i/s, ou au-delà de 2 % de frames droppées,
                  l’interface ne peut pas se permettre d’animations ni de flous.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TvDiagnosticsPage;

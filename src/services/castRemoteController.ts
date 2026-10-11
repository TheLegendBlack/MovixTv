import type {
  CastRemoteController,
  CastRemoteStatus,
  CastSource,
  MovixAndroidCastBridge,
} from '../types/castRemote';

interface CastControllerBackend {
  getStatus(): Promise<CastRemoteStatus>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  load(source: CastSource): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (status: CastRemoteStatus) => void): () => void;
}

const REQUIRED_ANDROID_CAST_BRIDGE_METHODS = {
  isSupported: true,
  getStatus: true,
  play: true,
  pause: true,
  seekTo: true,
  loadMedia: true,
  stop: true,
  subscribe: true,
  getRelayDisclosurePreference: true,
  setRelayDisclosureSuppressed: true,
  openBatterySettings: true,
  requestRelayNotificationPermission: true,
} as const satisfies Record<Exclude<keyof MovixAndroidCastBridge, 'copyDiagnostics'>, true>;

export function isMovixAndroidCastBridgeCompatible(
  bridge: unknown,
): bridge is MovixAndroidCastBridge {
  if (
    bridge === null
    || (typeof bridge !== 'object' && typeof bridge !== 'function')
  ) {
    return false;
  }

  const candidate = bridge as Record<string, unknown>;
  return (Object.keys(REQUIRED_ANDROID_CAST_BRIDGE_METHODS) as Array<
    keyof MovixAndroidCastBridge
  >).every(
    method => typeof candidate[method] === 'function',
  );
}

function createController(
  kind: CastRemoteController['kind'],
  backend: CastControllerBackend,
): CastRemoteController {
  const listeners = new Set<(status: CastRemoteStatus) => void>();
  let unsubscribeBackend: (() => void) | null = null;

  const publish = (status: CastRemoteStatus) => {
    for (const listener of listeners) listener(status);
  };

  const runCommand = async (command: () => Promise<void>) => {
    try {
      await command();
    } catch (error) {
      try {
        publish(await backend.getStatus());
      } catch {
        // Keep the original command rejection; status refresh is best effort.
      }
      throw error;
    }
  };

  return {
    kind,
    getStatus: () => backend.getStatus(),
    play: () => runCommand(() => backend.play()),
    pause: () => runCommand(() => backend.pause()),
    seekTo: seconds => runCommand(() => backend.seekTo(seconds)),
    load: source => runCommand(() => backend.load(source)),
    stop: () => runCommand(() => backend.stop()),
    subscribe(listener) {
      listeners.add(listener);
      if (!unsubscribeBackend) {
        unsubscribeBackend = backend.subscribe(publish);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribeBackend) {
          unsubscribeBackend();
          unsubscribeBackend = null;
        }
      };
    },
  };
}

export function createAndroidCastRemoteController(
  bridge: MovixAndroidCastBridge,
): CastRemoteController {
  return createController('android-native', {
    getStatus: () => bridge.getStatus(),
    play: () => bridge.play(),
    pause: () => bridge.pause(),
    seekTo: seconds => bridge.seekTo(seconds),
    load: source => bridge.loadMedia(
      source.url,
      source.title,
      source.poster ?? '',
      source.currentTimeSec ?? 0,
      source.contentType,
      source.tracks,
    ),
    stop: () => bridge.stop(),
    subscribe: listener => bridge.subscribe(listener),
  });
}

type WebCastSession = {
  receiver?: {
    friendlyName?: string;
    name?: string;
  };
  deviceName?: string;
  getMediaSession?: () => WebCastMediaSession | null;
  media?: WebCastMediaSession[];
  stop?: (
    onSuccess?: () => void,
    onError?: (error: unknown) => void,
  ) => unknown;
  addUpdateListener?: (listener: (alive?: boolean) => void) => void;
  removeUpdateListener?: (listener: (alive?: boolean) => void) => void;
  addMediaListener?: (listener: (media: WebCastMediaSession) => void) => void;
  removeMediaListener?: (listener: (media: WebCastMediaSession) => void) => void;
};

type WebCastMediaSession = {
  mediaSessionId?: number;
  playerState?: string;
  currentTime?: number;
  duration?: number;
  getEstimatedTime?: () => number;
  getDuration?: () => number;
  play?: (
    request: object,
    onSuccess?: () => void,
    onError?: (error: unknown) => void,
  ) => unknown;
  pause?: (
    request: object,
    onSuccess?: () => void,
    onError?: (error: unknown) => void,
  ) => unknown;
  seek?: (
    request: { currentTime: number },
    onSuccess?: () => void,
    onError?: (error: unknown) => void,
  ) => unknown;
  addUpdateListener?: (listener: (alive?: boolean) => void) => void;
  removeUpdateListener?: (listener: (alive?: boolean) => void) => void;
};

function getWebMedia(session: WebCastSession): WebCastMediaSession | null {
  return session.getMediaSession?.()
    ?? (Array.isArray(session.media) ? session.media.at(-1) ?? null : null)
    ?? null;
}

function mapWebState(state: string | undefined): CastRemoteStatus['state'] {
  switch (state) {
    case 'PLAYING':
      return 'playing';
    case 'PAUSED':
      return 'paused';
    case 'BUFFERING':
      return 'buffering';
    case 'LOADING':
      return 'loading';
    case 'IDLE':
      return 'idle';
    default:
      return 'idle';
  }
}

function readWebStatus(
  session: WebCastSession,
  media: WebCastMediaSession | null = getWebMedia(session),
): CastRemoteStatus {
  const position = media?.getEstimatedTime?.() ?? media?.currentTime ?? 0;
  const duration = media?.getDuration?.() ?? media?.duration;
  return {
    connected: true,
    deviceName:
      session.receiver?.friendlyName
      ?? session.receiver?.name
      ?? session.deviceName
      ?? null,
    mediaSessionId:
      typeof media?.mediaSessionId === 'number' ? media.mediaSessionId : null,
    state: mapWebState(media?.playerState),
    positionSec: Number.isFinite(position) && position >= 0 ? position : 0,
    durationSec:
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
        ? duration
        : null,
    canSeek: !!media && typeof media.seek === 'function',
  };
}

function invokeWebCommand(
  operation: (
    onSuccess: () => void,
    onError: (error: unknown) => void,
  ) => unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const result = operation(resolve, reject);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        Promise.resolve(result).then(() => resolve(), reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

export function createWebCastRemoteController(
  session: WebCastSession,
  loadSource: (source: CastSource) => Promise<void>,
): CastRemoteController {
  const refreshSubscriptionsAfterLoad = new Set<() => void>();
  let announcedMedia = getWebMedia(session);
  const currentMedia = () => announcedMedia ?? getWebMedia(session);
  const requireMedia = () => {
    const media = currentMedia();
    if (!media) throw new Error('CAST_MEDIA_SESSION_UNAVAILABLE');
    return media;
  };

  return createController('web', {
    getStatus: async () => readWebStatus(session, currentMedia()),
    play: () => {
      const media = requireMedia();
      if (!media.play) return Promise.reject(new Error('CAST_PLAY_UNAVAILABLE'));
      return invokeWebCommand((resolve, reject) => {
        media.play?.({}, resolve, reject);
      });
    },
    pause: () => {
      const media = requireMedia();
      if (!media.pause) return Promise.reject(new Error('CAST_PAUSE_UNAVAILABLE'));
      return invokeWebCommand((resolve, reject) => {
        media.pause?.({}, resolve, reject);
      });
    },
    seekTo: seconds => {
      const media = requireMedia();
      if (
        !Number.isFinite(seconds)
        || seconds < 0
        || !media.seek
      ) {
        return Promise.reject(new Error('CAST_SEEK_UNAVAILABLE'));
      }
      return invokeWebCommand((resolve, reject) => {
        media.seek?.({ currentTime: seconds }, resolve, reject);
      });
    },
    load: async source => {
      await loadSource(source);
      announcedMedia = getWebMedia(session) ?? announcedMedia;
      for (const refresh of [...refreshSubscriptionsAfterLoad]) refresh();
    },
    stop: () => {
      if (!session.stop) return Promise.reject(new Error('CAST_STOP_UNAVAILABLE'));
      return invokeWebCommand((resolve, reject) => {
        session.stop?.(resolve, reject);
      });
    },
    subscribe: listener => {
      let subscribedMedia: WebCastMediaSession | null = null;
      let active = true;

      function bindCurrentMedia(media = currentMedia()): boolean {
        if (media === subscribedMedia) return false;
        subscribedMedia?.removeUpdateListener?.(onUpdate);
        subscribedMedia = media;
        subscribedMedia?.addUpdateListener?.(onUpdate);
        return true;
      }

      function onUpdate(): void {
        if (!active) return;
        bindCurrentMedia(subscribedMedia ?? currentMedia());
        listener(readWebStatus(session, subscribedMedia));
      }

      function onMedia(media: WebCastMediaSession): void {
        if (!active) return;
        announcedMedia = media;
        bindCurrentMedia(media);
        listener(readWebStatus(session, media));
      }

      session.addUpdateListener?.(onUpdate);
      session.addMediaListener?.(onMedia);
      const refreshAfterLoad = () => {
        if (!active) return;
        bindCurrentMedia(currentMedia());
        listener(readWebStatus(session, subscribedMedia));
      };
      refreshSubscriptionsAfterLoad.add(refreshAfterLoad);
      bindCurrentMedia();
      return () => {
        active = false;
        refreshSubscriptionsAfterLoad.delete(refreshAfterLoad);
        session.removeUpdateListener?.(onUpdate);
        session.removeMediaListener?.(onMedia);
        subscribedMedia?.removeUpdateListener?.(onUpdate);
        subscribedMedia = null;
      };
    },
  });
}

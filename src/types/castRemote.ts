export type CastRemotePlaybackState =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface CastRemoteStatus {
  connected: boolean;
  deviceName: string | null;
  mediaSessionId: number | null;
  state: CastRemotePlaybackState;
  positionSec: number;
  durationSec: number | null;
  canSeek: boolean;
  idleReason?: string;
  errorCode?: string;
  nativeErrorCode?: string;
}

export interface CastTextTrack {
  url?: string;
  inlineVtt?: string;
  contentType: 'text/vtt' | string;
  language?: string;
  name?: string;
  active?: boolean;
}

export interface CastSource {
  url: string;
  contentType: string;
  title: string;
  poster?: string;
  currentTimeSec?: number;
  tracks?: CastTextTrack[];
}

export interface CastRemoteController {
  readonly kind: 'web' | 'android-native';
  getStatus(): Promise<CastRemoteStatus>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  load(source: CastSource): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (status: CastRemoteStatus) => void): () => void;
}

export interface MovixAndroidCastBridge {
  copyDiagnostics?(): Promise<void>;
  isSupported(): Promise<boolean>;
  getStatus(): Promise<CastRemoteStatus>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  loadMedia(
    url: string,
    title: string,
    poster: string,
    currentTimeSec: number,
    contentType: string,
    tracks?: CastTextTrack[],
  ): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (status: CastRemoteStatus) => void): () => void;
  getRelayDisclosurePreference(): Promise<boolean>;
  setRelayDisclosureSuppressed(suppressed: boolean): Promise<void>;
  openBatterySettings(): Promise<void>;
  requestRelayNotificationPermission(): void;
}

declare global {
  interface Window {
    MovixAndroidCast?: MovixAndroidCastBridge;
  }
}

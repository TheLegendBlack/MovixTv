import { DeviceEventEmitter, NativeModules } from 'react-native';
import { diagnosticErrorDetails, normalizeNativeDiagnosticCode, recordCastDiagnostic } from './diagnosticReport';

export type NativeCastPlaybackState =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type NativeCastStatus = {
  connected: boolean;
  deviceName: string | null;
  mediaSessionId: number | null;
  state: NativeCastPlaybackState;
  positionSec: number;
  durationSec: number | null;
  canSeek: boolean;
  idleReason?: string;
  errorCode?: string;
  nativeErrorCode?: string;
};

export type NativeCastCapabilities = {
  configured: boolean;
  receiverProtocolVersion: number;
  castLanProxyVersion: number;
};

type PreparedCastTrackMetadata = {
  contentType?: string;
  protocolVersion: 1;
  language?: string;
  name?: string;
  active?: boolean;
};

export type PreparedCastTrack = PreparedCastTrackMetadata & (
  | {
      url: string;
      headers: Record<string, string>;
      inlineVtt?: never;
    }
  | {
      inlineVtt: string;
      url?: never;
      headers?: never;
    }
);

export type PreparedCastSource = {
  url: string;
  headers: Record<string, string>;
  contentType?: string;
  protocolVersion: 1;
  tracks?: PreparedCastTrack[];
};

export type CastLoadMetadata = {
  title: string;
  poster?: string;
};

type CastModuleType = {
  isSupported(): Promise<boolean>;
  getCapabilities(): Promise<unknown>;
  loadProxiedMedia(
    source: PreparedCastSource,
    metadata: CastLoadMetadata,
    startTimeSec: number,
  ): Promise<unknown>;
  getStatus(refresh: boolean): Promise<unknown>;
  play(): Promise<unknown>;
  pause(): Promise<unknown>;
  seekTo(seconds: number): Promise<unknown>;
  stop(): Promise<unknown>;
  getRelayDisclosurePreference(): Promise<boolean>;
  setRelayDisclosureSuppressed(suppressed: boolean): Promise<unknown>;
  openBatterySettings(): Promise<unknown>;
  requestRelayNotificationPermission(): Promise<unknown>;
};

const PLAYBACK_STATES = new Set<NativeCastPlaybackState>([
  'idle',
  'loading',
  'buffering',
  'playing',
  'paused',
  'ended',
  'error',
]);
const MAX_STATUS_SECONDS = 366 * 24 * 60 * 60;
const MAX_DEVICE_NAME_LENGTH = 128;
const MAX_STATUS_CODE_LENGTH = 128;

function getModule(): CastModuleType | undefined {
  return (NativeModules as { CastModule?: CastModuleType }).CastModule;
}

function ensureModule(): CastModuleType {
  const module = getModule();
  if (!module) {
    throw new Error('CAST_MODULE_UNAVAILABLE');
  }
  return module;
}

function boundedStatusString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return undefined;
  }
  return value;
}

function boundedSeconds(value: unknown): number | null {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > MAX_STATUS_SECONDS
  ) {
    return null;
  }
  return value;
}

export function normalizeNativeCastStatus(
  raw: unknown,
): NativeCastStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.connected !== 'boolean'
    || typeof value.state !== 'string'
    || !PLAYBACK_STATES.has(value.state as NativeCastPlaybackState)
    || typeof value.canSeek !== 'boolean'
  ) {
    return null;
  }

  const positionSec = boundedSeconds(value.positionSec);
  if (positionSec === null) return null;
  const durationSec =
    value.durationSec === null ? null : boundedSeconds(value.durationSec);
  if (value.durationSec !== null && durationSec === null) return null;

  let mediaSessionId: number | null = null;
  if (value.mediaSessionId !== null) {
    if (
      typeof value.mediaSessionId !== 'number'
      || !Number.isSafeInteger(value.mediaSessionId)
      || value.mediaSessionId < 0
    ) {
      return null;
    }
    mediaSessionId = value.mediaSessionId;
  }

  let deviceName: string | null = null;
  if (value.deviceName !== null) {
    deviceName = boundedStatusString(value.deviceName, MAX_DEVICE_NAME_LENGTH) ?? null;
    if (deviceName === null) return null;
  }

  const status: NativeCastStatus = {
    connected: value.connected,
    deviceName,
    mediaSessionId,
    state: value.state as NativeCastPlaybackState,
    positionSec,
    durationSec,
    canSeek: value.canSeek,
  };
  const idleReason = boundedStatusString(value.idleReason, MAX_STATUS_CODE_LENGTH);
  const errorCode = boundedStatusString(value.errorCode, MAX_STATUS_CODE_LENGTH);
  if (idleReason) status.idleReason = idleReason;
  if (errorCode) status.errorCode = errorCode;
  const nativeErrorCode = normalizeNativeDiagnosticCode(value.nativeErrorCode);
  if (nativeErrorCode) status.nativeErrorCode = nativeErrorCode;
  return status;
}

export function normalizeCastCapabilities(
  raw: unknown,
): NativeCastCapabilities {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      configured: false,
      receiverProtocolVersion: 0,
      castLanProxyVersion: 0,
    };
  }
  const value = raw as Record<string, unknown>;
  return {
    configured: value.configured === true,
    receiverProtocolVersion:
      typeof value.receiverProtocolVersion === 'number'
        ? value.receiverProtocolVersion
        : 0,
    castLanProxyVersion:
      typeof value.castLanProxyVersion === 'number'
        ? value.castLanProxyVersion
        : 0,
  };
}

export async function getCastCapabilities(): Promise<NativeCastCapabilities> {
  try {
    return normalizeCastCapabilities(await ensureModule().getCapabilities());
  } catch {
    return normalizeCastCapabilities(null);
  }
}

export async function isCastSupported(): Promise<boolean> {
  try {
    const module = ensureModule();
    const [nativeSupported, capabilities] = await Promise.all([
      module.isSupported(),
      module.getCapabilities().then(normalizeCastCapabilities),
    ]);
    return (
      nativeSupported === true
      && capabilities.configured
      && capabilities.receiverProtocolVersion === 1
      && capabilities.castLanProxyVersion === 1
    );
  } catch {
    return false;
  }
}

export async function loadCastMedia(
  source: PreparedCastSource,
  metadata: CastLoadMetadata,
  startTimeSec: number,
): Promise<void> {
  recordCastDiagnostic('load/start', `type=${source.contentType ?? 'auto'} tracks=${source.tracks?.length ?? 0}`);
  try {
    await ensureModule().loadProxiedMedia(source, metadata, startTimeSec);
    recordCastDiagnostic('load/accepted');
  } catch (error) {
    recordCastDiagnostic('load/failed', diagnosticErrorDetails(error, 'CAST_LOAD_REJECTED'));
    throw error;
  }
}

export async function getCastStatus(
  refresh = false,
): Promise<NativeCastStatus> {
  const normalized = normalizeNativeCastStatus(
    await ensureModule().getStatus(refresh),
  );
  if (!normalized) throw new Error('CAST_STATUS_INVALID');
  recordCastStatus(normalized);
  return normalized;
}

export async function playCast(): Promise<void> {
  await ensureModule().play();
}

export async function pauseCast(): Promise<void> {
  await ensureModule().pause();
}

export async function seekCastTo(seconds: number): Promise<void> {
  await ensureModule().seekTo(seconds);
}

export async function stopCast(): Promise<void> {
  await ensureModule().stop();
}

export function subscribeCastStatus(
  cb: (status: NativeCastStatus) => void,
): () => void {
  const subscription = DeviceEventEmitter.addListener(
    'CAST_MEDIA_STATUS',
    (raw: unknown) => {
      const status = normalizeNativeCastStatus(raw);
      if (status) {
        recordCastStatus(status);
        cb(status);
      }
    },
  );
  return () => subscription.remove();
}

let previousStatusKey = '';
function recordCastStatus(status: NativeCastStatus): void {
  // Une entrée par transition ; les ticks de position ne chassent pas l'erreur.
  const key = JSON.stringify([status.connected, status.deviceName, status.state, status.mediaSessionId, status.errorCode, status.nativeErrorCode, status.idleReason]);
  if (key === previousStatusKey) return;
  previousStatusKey = key;
  recordCastDiagnostic('status', JSON.stringify(status));
}

export async function getRelayDisclosurePreference(): Promise<boolean> {
  return (await ensureModule().getRelayDisclosurePreference()) === true;
}

export async function setRelayDisclosureSuppressed(
  suppressed: boolean,
): Promise<void> {
  await ensureModule().setRelayDisclosureSuppressed(suppressed);
}

export async function openCastBatterySettings(): Promise<void> {
  await ensureModule().openBatterySettings();
}

export function requestCastRelayNotificationPermission(): void {
  try {
    void ensureModule().requestRelayNotificationPermission().catch(() => {
      // Permission is contextual and optional; denial never gates Cast.
    });
  } catch {
    // Module unavailability is also optional and must not gate Cast.
  }
}

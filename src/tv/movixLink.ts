/**
 * Connexion au compte Movix par code (26/10/2026).
 *
 * Route de la Main API faite pour l'appli TV native de Movix
 * (`/api/tv/link`, `routes/tvLink.js` de l'amont) : la télé demande un code,
 * l'utilisateur le confirme sur le site Movix où il est connecté (QR ou
 * adresse), la télé interroge jusqu'à la réponse. Elle reçoit alors la clé VIP
 * du profil choisi : plus rien à taper à la télécommande.
 *
 * Seule la clé VIP est gardée. Le jeton de session Movix remis avec elle ne
 * sert à rien ici : on ne le stocke pas.
 *
 * Origine vérifiée le 26/10/2026 : la Main API accepte la page servie par le
 * shell (préflight 204, `/start` 200).
 */

const MAIN_API = import.meta.env.VITE_MAIN_API;
const CLIENT_ID_KEY = 'movix:tv:client-id';
const TIMEOUT_MS = 8000;

export interface MovixLinkStart {
  /** Secret de la télé, jamais affiché. */
  deviceCode: string;
  /** Cinq caractères, à confirmer sur le site Movix. */
  userCode: string;
  verificationUrl: string;
  /** Secondes. */
  expiresIn: number;
  /** Secondes entre deux interrogations. */
  interval: number;
}

export interface MovixLinkVip {
  active: boolean;
  accessKey: string | null;
  expiresAt: string | null;
}

export type MovixLinkPoll =
  | { status: 'pending' | 'slow_down' | 'expired' }
  | { status: 'approved'; vip: MovixLinkVip | null };

export class MovixLinkError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Identifiant stable du téléviseur (UUID v4) : Movix l'exige pour lister ses télés. */
export function movixClientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored;
  } catch {
    // Stockage indisponible : un identifiant de session suffit.
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  try {
    localStorage.setItem(CLIENT_ID_KEY, id);
  } catch {
    // idem
  }
  return id;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${MAIN_API}/api/tv/link${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new MovixLinkError('injoignable');
  } finally {
    window.clearTimeout(timer);
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  // 404 : la Main API répond ainsi à une origine qu'elle n'accepte pas
  // (mesuré le 26/10/2026 : le site hébergé et localhost:3000 passent, une autre non).
  if (response.status === 404) throw new MovixLinkError('origine_refusee');
  if (response.status === 429) throw new MovixLinkError('trop_de_demandes');
  if (!response.ok || !data) throw new MovixLinkError(data?.error ?? 'erreur');
  return data;
}

export const startMovixLink = (deviceName: string) =>
  post<MovixLinkStart>('/start', { deviceName, clientId: movixClientId() });

export async function pollMovixLink(deviceCode: string): Promise<MovixLinkPoll> {
  const data = await post<{ status?: string; vip?: MovixLinkVip | null }>('/poll', { deviceCode });
  if (data.status === 'approved') return { status: 'approved', vip: data.vip ?? null };
  if (data.status === 'pending' || data.status === 'slow_down') return { status: data.status };
  return { status: 'expired' };
}

/** La clé VIP utilisable de la réponse, ou `null` si le profil n'a pas de VIP actif. */
export function usableVipKey(vip: MovixLinkVip | null): string | null {
  const key = vip?.active ? vip.accessKey?.trim() : null;
  return key ? key : null;
}

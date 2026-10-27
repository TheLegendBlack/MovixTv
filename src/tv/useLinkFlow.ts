import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Déroulé d'une liaison par code affiché sur la télé (26/10/2026) : demander
 * un code, l'afficher, interroger le serveur jusqu'à la confirmation faite
 * sur le téléphone. Même schéma que l'autorisation d'appareil d'OAuth
 * (RFC 8628) : `slow_down` allonge l'intervalle de 5 s, un code expiré est
 * remplacé seul, trois fois au plus, pour ne pas en demander indéfiniment à
 * une télé restée sur l'écran.
 */

export interface LinkTicket {
  /** Secret de la télé, transmis aux interrogations. */
  secret: string;
  code: string;
  /** Adresse du QR, code compris. */
  url: string;
  /** Adresse à taper à la main. */
  manualUrl: string;
  /** Secondes de validité. */
  expiresIn: number;
  /** Secondes entre deux interrogations. */
  interval: number;
}

export type LinkPollResult<T> = 'pending' | 'slow_down' | 'expired' | { approved: T };

export type LinkFlowState =
  | { phase: 'starting' }
  | { phase: 'waiting'; ticket: LinkTicket; expiresAt: number }
  | { phase: 'finishing' }
  | { phase: 'done' }
  | { phase: 'stopped'; message: string };

const MAX_RENEWALS = 3;

export function useLinkFlow<T>({
  start,
  poll,
  onApproved,
  errorText,
}: {
  start: () => Promise<LinkTicket>;
  poll: (secret: string) => Promise<LinkPollResult<T>>;
  /** Rend `true` si la liaison est faite, un message sinon. */
  onApproved: (result: T) => Promise<true | string>;
  errorText: (error: unknown) => string;
}): { state: LinkFlowState; restart: () => void } {
  const [state, setState] = useState<LinkFlowState>({ phase: 'starting' });
  const [generation, setGeneration] = useState(0);
  // Les fonctions changent à chaque rendu : on garde les dernières sans relancer le cycle.
  const callbacks = useRef({ start, poll, onApproved, errorText });
  callbacks.current = { start, poll, onApproved, errorText };

  const restart = useCallback(() => setGeneration(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let renewals = 0;

    const begin = async () => {
      setState({ phase: 'starting' });
      let ticket: LinkTicket;
      try {
        ticket = await callbacks.current.start();
      } catch (error) {
        if (!cancelled) setState({ phase: 'stopped', message: callbacks.current.errorText(error) });
        return;
      }
      if (cancelled) return;
      const expiresAt = Date.now() + ticket.expiresIn * 1000;
      setState({ phase: 'waiting', ticket, expiresAt });
      schedule(ticket, expiresAt, Math.max(2, ticket.interval));
    };

    const schedule = (ticket: LinkTicket, expiresAt: number, interval: number) => {
      timer = window.setTimeout(() => void check(ticket, expiresAt, interval), interval * 1000);
    };

    const renew = () => {
      renewals += 1;
      if (renewals > MAX_RENEWALS) {
        setState({ phase: 'stopped', message: 'Code expiré. Demandez-en un nouveau.' });
        return;
      }
      void begin();
    };

    const check = async (ticket: LinkTicket, expiresAt: number, interval: number) => {
      if (cancelled) return;
      if (Date.now() >= expiresAt) {
        renew();
        return;
      }
      let result: LinkPollResult<T>;
      try {
        result = await callbacks.current.poll(ticket.secret);
      } catch {
        // Réseau capricieux : on réessaie au prochain tour, sans perdre le code.
        if (!cancelled) schedule(ticket, expiresAt, interval);
        return;
      }
      if (cancelled) return;
      if (result === 'pending') return schedule(ticket, expiresAt, interval);
      if (result === 'slow_down') return schedule(ticket, expiresAt, interval + 5);
      if (result === 'expired') return renew();
      setState({ phase: 'finishing' });
      let outcome: true | string;
      try {
        outcome = await callbacks.current.onApproved(result.approved);
      } catch (error) {
        outcome = callbacks.current.errorText(error);
      }
      if (!cancelled) setState(outcome === true ? { phase: 'done' } : { phase: 'stopped', message: outcome });
    };

    void begin();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [generation]);

  return { state, restart };
}

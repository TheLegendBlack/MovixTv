/**
 * Requête JSON avec délai maximum, sans minuterie qui traîne derrière elle.
 *
 * Les providers composaient auparavant leur signal ainsi :
 *
 *     AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
 *
 * Le signal rendu par `AbortSignal.timeout()` n'a pas de bouton « annuler ».
 * Quand la requête se terminait avant l'échéance — réponse reçue, ou
 * annulation par le signal de l'appelant au changement d'épisode — la
 * minuterie continuait de courir, puis avortait à retardement un signal
 * composite dont plus personne n'attendait le résultat. Chrome remontait alors
 * un rejet non rattrapé « TimeoutError: signal timed out », sans pile, jusqu'à
 * GlitchTip (issue du 2026-09-02 sur /watch/movie/599521 : deux fetch de
 * sous-titres lancés à 15:57:41, l'événement exactement 12 s plus tard).
 *
 * Ici la minuterie est posée à la main et coupée dans `finally`, sur tous les
 * chemins de sortie. L'annulation demandée par l'appelant est propagée telle
 * quelle (`signal.reason`), pour que le hook continue de la distinguer d'un
 * vrai échec réseau.
 */
export interface TimedJsonRequest {
  /** Nom du provider, repris dans les messages d'erreur remontés à searchAll. */
  label: string;
  timeoutMs: number;
  /** Signal de l'appelant : changement d'épisode, démontage du lecteur. */
  signal: AbortSignal;
  headers?: HeadersInit;
}

export async function fetchJsonWithTimeout(
  url: string,
  { label, timeoutMs, signal, headers }: TimedJsonRequest,
): Promise<unknown> {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(signal.reason);

  if (signal.aborted) {
    forwardAbort();
  } else {
    signal.addEventListener('abort', forwardAbort, { once: true });
  }

  const timer = window.setTimeout(() => {
    controller.abort(new DOMException(`${label} timed out after ${timeoutMs}ms`, 'TimeoutError'));
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...(headers ? { headers } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${label} responded ${response.status}`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', forwardAbort);
  }
}

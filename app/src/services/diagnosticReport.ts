const MAX_CAST_ENTRIES = 150;
const MAX_COPY_CHARS = 60_000;
const castEntries: string[] = [];

/** Ne conserve que des codes publics, jamais le message natif qui peut contenir une URL. */
export function diagnosticErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown };
    for (const code of [value.code, value.message]) {
      if (typeof code === 'string' && /^(?:MOVIX_|CAST_|MEDIA_PROXY_)[A-Z0-9_]{3,100}$/.test(code)) {
        return code;
      }
    }
  }
  return fallback;
}

export function normalizeNativeDiagnosticCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_-]{0,127}$/.test(value)
    ? value
    : undefined;
}

export function diagnosticErrorDetails(error: unknown, fallback: string): string {
  const code = diagnosticErrorCode(error, fallback);
  if (!error || typeof error !== 'object') return code;
  const value = error as { nativeErrorCode?: unknown; userInfo?: { nativeErrorCode?: unknown } };
  const nativeCode = normalizeNativeDiagnosticCode(value.nativeErrorCode)
    ?? normalizeNativeDiagnosticCode(value.userInfo?.nativeErrorCode);
  return nativeCode ? `${code} native=${nativeCode}` : code;
}

export function redactDiagnosticText(text: string): string {
  const sensitiveHeaderLine = /^(\s*[><~]?\s*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*:).*$/gim;
  const redacted = text
    .replace(/\\\//g, '/')
    .replace(/(^\s*corps:)[\s\S]*?(?=^\s*erreur:|(?![\s\S]))/gm, '$1 [contenu masqué]\n')
    .replace(sensitiveHeaderLine, '$1 [masqué]')
    .replace(/https?:\/\/[^\s<>"'\\]+/gi, raw => {
      // Évite de dépendre du parseur URL incomplet de certaines versions de RN.
      return raw.replace(/\/\/[^/@]+@/, '//[masqué]@')
        .replace(/[?#].*$/, '?[masqué]')
        .replace(/(\/cast\/)[^?]*/, '$1[masqué]')
        .replace(/\/[a-z0-9_=-]{24,}(?=\/|\?|$)/gi, '/[masqué]');
    });
  // Une console peut contenir tableaux, JSON sérialisé plusieurs fois ou
  // cookies séparés par « ; ». Masquer l'entrée entière évite de deviner où
  // finit une valeur sensible et d'en laisser une partie dans le rapport.
  const unstructured = redacted.replace(sensitiveHeaderLine, '');
  if (/\b(?:access_token|refresh_token|token|secret|password|signature|sig|api_key|apikey|authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)["'\\\s]*[:=]/i.test(unstructured)) {
    const timestamp = /^\[[0-9:.TZ-]+\]/.exec(text)?.[0];
    return `${timestamp ? `${timestamp} ` : ''}[entrée de diagnostic sensible masquée]`;
  }
  return redacted;
}

export function recordCastDiagnostic(event: string, details = ''): void {
  castEntries.push(`[${new Date().toISOString()}] ${event} ${redactDiagnosticText(details).slice(0, 1000)}`.trim());
  if (castEntries.length > MAX_CAST_ENTRIES) castEntries.shift();
}

export function getCastDiagnostics(): string[] {
  return [...castEntries];
}

export function clearCastDiagnostics(): void {
  castEntries.length = 0;
}

export function clipboardDiagnosticText(report: string): string {
  if (report.length <= MAX_COPY_CHARS) return report;
  return 'Movix — fin du journal (copie limitée). Utilise « Partager le fichier .txt » pour le journal complet.\n\n'
    + report.slice(-MAX_COPY_CHARS);
}

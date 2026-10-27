/**
 * Scoring unifié pour choisir le meilleur match anime-sama à partir des noms TMDB.
 *
 * Remplace la cascade de `results.find(...)` sur `alternative_names.includes(...)` qui
 * acceptait `"stranger".includes("Stranger Case")` comme un match valide.
 */

export interface AnimeSamaCandidate {
  name?: string;
  alternative_names?: string[];
  seasons?: Array<unknown>;
}

export interface MatchResult<T> {
  match: T | null;
  score: number;
  reason: string;
}

const HTML_ENTITY_RE = /&([a-z]+|#\d+);/gi;
const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à',
  ccedil: 'ç', ocirc: 'ô', icirc: 'î', ucirc: 'û',
  ecirc: 'ê', acirc: 'â',
};

export function decodeHtmlEntities(s: string): string {
  if (!s) return '';
  return s.replace(HTML_ENTITY_RE, (match, name) => {
    if (typeof name === 'string' && name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : match;
    }
    return HTML_ENTITIES[(name as string).toLowerCase()] || match;
  });
}

function normalize(s: string): string {
  if (!s) return '';
  const decoded = decodeHtmlEntities(s).toLowerCase();
  // NFD + strip combining marks
  const stripped = decoded.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // remove everything except a-z0-9 and spaces
  return stripped.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function significantTokens(s: string, minLen: number = 4): Set<string> {
  const out = new Set<string>();
  for (const w of normalize(s).split(' ')) {
    if (w.length >= minLen) out.add(w);
  }
  return out;
}

function jaccard(a: string, b: string): { ratio: number; inter: number } {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size === 0 || tb.size === 0) return { ratio: 0, inter: 0 };
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  const union = ta.size + tb.size - inter;
  return { ratio: union === 0 ? 0 : inter / union, inter };
}

function inclusionScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // longueur minimale pour éviter "stranger" ∈ "stranger case"
  if (a.length >= 6 && b.length >= 6) {
    if (b.includes(a)) return 0.90 * (a.length / b.length);
    if (a.includes(b)) return 0.85 * (b.length / a.length);
  }
  return 0;
}

/**
 * Score (0..1) entre un nom TMDB et un candidat anime-sama (nom + alternative_names).
 */
export function scorePair(
  tmdbName: string,
  candidateName: string,
  candidateAlts: string[],
): { score: number; reason: string } {
  const nTmdb = normalize(tmdbName);
  const nMain = normalize(candidateName);
  const nAlts = (candidateAlts || []).map((a) => normalize(a)).filter(Boolean);

  if (!nTmdb || !nMain) return { score: 0, reason: 'empty' };

  if (nTmdb === nMain) return { score: 1, reason: `exact(main)=${candidateName}` };
  if (nAlts.includes(nTmdb)) return { score: 0.95, reason: `exact(alt)=${tmdbName}` };

  let bestIncl = 0;
  let bestInclSrc = '';
  for (const n of [nMain, ...nAlts]) {
    const s = inclusionScore(nTmdb, n);
    if (s > bestIncl) { bestIncl = s; bestInclSrc = n; }
  }

  let bestJac = 0;
  let bestInter = 0;
  for (const n of [nMain, ...nAlts]) {
    const { ratio, inter } = jaccard(nTmdb, n);
    if (ratio > bestJac) { bestJac = ratio; bestInter = inter; }
  }
  const jacScore = Math.min(bestJac, 0.85);

  if (bestIncl >= jacScore) {
    return { score: bestIncl, reason: `incl(${bestInclSrc})` };
  }
  return { score: jacScore, reason: `jaccard=${bestJac.toFixed(2)}/inter=${bestInter}` };
}

/**
 * Choisit le meilleur candidat parmi une liste. Retourne null si aucun n'atteint le seuil.
 *
 * - score >= 0.85 -> accepté direct
 * - 0.75 <= score < 0.85 -> accepté si intersection de tokens significatifs >= 2
 * - score < 0.75 -> rejeté
 */
export function pickBestAnimeMatch<T extends AnimeSamaCandidate>(
  candidates: T[],
  tmdbNames: string[],
  opts: { highThreshold?: number; mediumThreshold?: number } = {},
): MatchResult<T> {
  const high = opts.highThreshold ?? 0.85;
  const medium = opts.mediumThreshold ?? 0.75;

  if (!candidates?.length) return { match: null, score: 0, reason: 'no candidates' };
  const valid = candidates.filter((c) => Array.isArray(c.seasons) && c.seasons.length > 0);
  if (!valid.length) return { match: null, score: 0, reason: 'no candidates with seasons' };

  type Scored = { c: T; score: number; reason: string; inter: number };
  const scored: Scored[] = valid.map((c) => {
    const decodedName = decodeHtmlEntities(c.name || '');
    const decodedAlts = (c.alternative_names || []).map(decodeHtmlEntities);
    let bestScore = 0;
    let bestReason = 'none';
    for (const name of tmdbNames) {
      if (!name) continue;
      const { score, reason } = scorePair(name, decodedName, decodedAlts);
      if (score > bestScore) { bestScore = score; bestReason = reason; }
    }
    // intersection max de tokens significatifs, tous tmdbNames vs name+alts
    let bestInter = 0;
    for (const name of tmdbNames) {
      if (!name) continue;
      for (const target of [decodedName, ...decodedAlts]) {
        const { inter } = jaccard(name, target);
        if (inter > bestInter) bestInter = inter;
      }
    }
    return { c, score: bestScore, reason: bestReason, inter: bestInter };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];

  if (top.score >= high) {
    return { match: top.c, score: top.score, reason: `high: ${top.reason}` };
  }
  if (top.score >= medium && top.inter >= 2) {
    return { match: top.c, score: top.score, reason: `medium+inter(${top.inter}): ${top.reason}` };
  }
  return {
    match: null,
    score: top.score,
    reason: `reject(best=${top.score.toFixed(2)}, inter=${top.inter}): ${top.reason}`,
  };
}

/**
 * Construit la liste des noms TMDB à utiliser pour le scoring.
 * `show.name`, `show.original_name`, et les titres alternatifs FR/US/GB/JP.
 */
export function collectTmdbNames(
  show: { name?: string | null; original_name?: string | null } | null | undefined,
  enShow: { name?: string | null } | null | undefined,
  alternativeTitles: Array<{ iso_3166_1?: string; title?: string }> | null | undefined,
): string[] {
  const names: string[] = [];
  const push = (v: string | null | undefined) => {
    if (!v) return;
    const trimmed = v.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  };
  push(show?.name);
  push(enShow?.name);
  push(show?.original_name);
  for (const t of alternativeTitles || []) {
    if (['JP', 'US', 'GB', 'FR'].includes(t?.iso_3166_1 || '')) push(t.title);
  }
  return names;
}

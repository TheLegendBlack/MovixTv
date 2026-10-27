/**
 * Titres connus en tête de la recherche (26/10/2026).
 *
 * Repris de l'appli TV native de Movix (`ImdbSuggestions.kt` et
 * `CatalogRepository.merge`, 22/10/2026). TMDB n'apparie que des mots
 * entiers et ne range pas par popularité : « INTER » sortait d'abord des
 * inconnus à 0 vote et laissait Interstellar en page 2, « BRE » ne trouvait
 * jamais Breaking Bad. Les suggestions de la barre de recherche d'imdb.com
 * complètent le début d'un mot et rangent par popularité ; on les fusionne
 * avec TMDB, les titres connus d'abord.
 *
 * Module pur : la requête (sans CORS, par le userscript) et la conversion
 * IMDb → TMDB vivent dans `tmdb.ts`.
 */

/** Films et séries ; pas les personnes, épisodes, jeux vidéo… */
const TITLE_KINDS = new Set(['movie', 'tvMovie', 'tvSeries', 'tvMiniSeries', 'tvSpecial']);

/**
 * Votes TMDB à partir desquels un titre est « connu ». IMDb a déjà trié les
 * siens : quelques votes écartent ses inconnus sans perdre les séries
 * françaises, peu notées sur TMDB (Plus belle la vie : 38). TMDB ramène tout
 * titre qui contient le mot : il en faut plus. Valeurs de l'amont.
 */
export const IMDB_KNOWN_VOTES = 10;
export const TMDB_KNOWN_VOTES = 50;

/** Forme attendue par IMDb : minuscules, espaces simples ; moins de 2 caractères, rien. */
export function imdbSlug(query: string): string | null {
  const slug = query.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 60);
  return slug.length >= 2 ? slug : null;
}

export function imdbSuggestionUrl(slug: string): string {
  return `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(slug)}.json?includeVideos=0`;
}

/** Identifiants `tt…` des films et séries suggérés, les plus connus d'abord. */
export function imdbTitleIds(payload: unknown): string[] {
  const entries = (payload as { d?: unknown } | null)?.d;
  if (!Array.isArray(entries)) return [];
  const ids: string[] = [];
  for (const entry of entries) {
    const { id, qid } = (entry ?? {}) as { id?: unknown; qid?: unknown };
    if (typeof id !== 'string' || !/^tt\d+$/.test(id)) continue;
    if (typeof qid !== 'string' || !TITLE_KINDS.has(qid)) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** « Spider-Man » et « spider man », « L'Été » et « l'ete » : même forme. */
export function foldTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface RankedCandidate {
  /** `movie:123`, `tv:456` : un même titre trouvé des deux côtés ne compte qu'une fois. */
  key: string;
  title: string;
  votes: number;
}

/**
 * Ordre de la grille : le titre exact d'abord s'il est connu, puis les titres
 * connus (ceux d'IMDb dans son ordre, puis ceux de TMDB), puis le reste.
 */
export function rankSearchResults<T extends RankedCandidate>(query: string, popular: T[], found: T[]): T[] {
  const seen = new Set<string>();
  const all: Array<{ item: T; known: boolean }> = [];
  for (const [list, minVotes] of [[popular, IMDB_KNOWN_VOTES], [found, TMDB_KNOWN_VOTES]] as const) {
    for (const item of list) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      all.push({ item, known: item.votes >= minVotes });
    }
  }
  const known = all.filter(entry => entry.known).map(entry => entry.item);
  const exact = foldTitle(query);
  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const item of [...known.filter(candidate => foldTitle(candidate.title) === exact), ...known, ...all.map(entry => entry.item)]) {
    if (placed.has(item.key)) continue;
    placed.add(item.key);
    ordered.push(item);
  }
  return ordered;
}

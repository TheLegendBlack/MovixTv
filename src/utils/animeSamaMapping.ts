/**
 * Correspondance entre un épisode TMDB et un épisode Anime-Sama (15/10/2026).
 *
 * La fiche garde la numérotation TMDB ; Anime-Sama n'est qu'une source de
 * plus au lecteur. Les deux découpent les saisons à leur façon : Frieren tient
 * en une saison TMDB et deux Anime-Sama, One Piece en 23 saisons TMDB et des
 * « sagas ». On retrouve donc l'épisode par son **rang** dans la suite
 * principale, mais seulement là où les deux découpages s'emboîtent : sinon,
 * pas de source plutôt qu'un mauvais épisode.
 *
 * Mesuré le 15/10/2026 sur les 34 animés de la page Animés trouvés sur
 * Anime-Sama : 24 ont au moins une saison sûre, 56 saisons TMDB sur 100. Les
 * cas écartés le sont à raison : un épisode de plus côté Anime-Sama (Slime,
 * 25 contre 24 : un récapitulatif), une première saison qui en couvre deux
 * (L'Attaque des Titans). Module pur, testé seul.
 */

export interface AnimeSamaSeasonShape {
  name?: string;
  /** Nombre d'épisodes publiés de cette entrée. */
  episodes: number;
}

/**
 * Entrées hors de la suite principale : films, OAV, récapitulatifs « Kai »,
 * versions sans fillers, adaptations et spin-offs. Une entrée oubliée ici ne
 * produit pas de faux épisode : elle décale les frontières, et la saison
 * concernée est simplement écartée.
 */
const ANNEX_ENTRY =
  /\b(films?|movies?|oav|ova|oavs|kai|live action|sp[ée]cials?|director'?s cut|sans fillers|after school|diaries|log\s*:|heroines|fan letter|tea time|scarlet bond|larmes)\b/i;

export function isMainEntry(season: AnimeSamaSeasonShape): boolean {
  return !ANNEX_ENTRY.test(season.name ?? '');
}

const boundaries = (counts: number[]): number[] => {
  const result: number[] = [];
  let total = 0;
  for (const count of counts) {
    total += count;
    result.push(total);
  }
  return result;
};

/**
 * Saisons TMDB dont la correspondance par rang est sûre.
 *
 * `tmdbSeasons` : `[numéro, nombre d'épisodes]`, saisons 0 (spéciaux) exclues.
 * TMDB compte aussi les épisodes annoncés : une saison en cours dépasse ce
 * qu'Anime-Sama a publié, et seule sa partie publiée est concernée.
 */
export function safeTmdbSeasons(tmdbSeasons: Array<[number, number]>, mainCounts: number[]): number[] {
  const asBounds = boundaries(mainCounts);
  const asTotal = asBounds.length > 0 ? asBounds[asBounds.length - 1] : 0;
  const asSet = new Set(asBounds);
  const tmdbAll = boundaries(tmdbSeasons.map(([, count]) => count));
  const tmdbBounds = new Set([0, ...tmdbAll]);
  const tmdbTotal = tmdbAll.length > 0 ? tmdbAll[tmdbAll.length - 1] : 0;
  const safe: number[] = [];
  let start = 0;
  for (const [season, count] of tmdbSeasons) {
    const end = start + count;
    if (start < asTotal) {
      // La saison TMDB commence et finit sur des frontières Anime-Sama (ou
      // finit au-delà de ce qui est publié, la dernière frontière étant alors
      // la fin de la suite) : Anime-Sama la découpe en parties, ou à l'identique.
      const startOk = start === 0 || asSet.has(start);
      const endOk = asSet.has(end) || end > asTotal;
      if (startOk && endOk) {
        safe.push(season);
      } else {
        // Découpage plus fin côté TMDB (One Piece) : la saison tient entière
        // dans une entrée Anime-Sama dont les deux bords sont aussi des
        // frontières TMDB. La dernière entrée, en cours de publication, peut
        // finir avant TMDB, jamais après : un épisode de plus chez Anime-Sama
        // (Slime, 25 contre 24) décalerait tout.
        const index = asBounds.findIndex(bound => bound >= end);
        const asStart = index > 0 ? asBounds[index - 1] : 0;
        const asEnd = asBounds[index];
        if (
          index >= 0 &&
          start >= asStart &&
          end <= asEnd &&
          tmdbBounds.has(asStart) &&
          (tmdbBounds.has(asEnd) || (asEnd === asTotal && asTotal <= tmdbTotal))
        ) {
          safe.push(season);
        }
      }
    }
    start = end;
  }
  return safe;
}

/**
 * Position Anime-Sama (indice d'entrée principale, indice d'épisode, base 0)
 * de l'épisode TMDB `season`×`episode`, ou `null` si la correspondance n'est
 * pas sûre ou si l'épisode n'est pas encore publié.
 */
export function locateAnimeSamaEpisode(
  tmdbSeasons: Array<[number, number]>,
  mainCounts: number[],
  season: number,
  episode: number,
): { entry: number; index: number } | null {
  if (!safeTmdbSeasons(tmdbSeasons, mainCounts).includes(season)) return null;
  let rank = 0;
  for (const [number, count] of tmdbSeasons) {
    if (number === season) break;
    rank += count;
  }
  rank += episode - 1;
  if (episode < 1 || rank < 0) return null;
  for (let entry = 0, before = 0; entry < mainCounts.length; entry += 1) {
    if (rank < before + mainCounts[entry]) return { entry, index: rank - before };
    before += mainCounts[entry];
  }
  return null;
}

/**
 * Sens inverse : l'épisode TMDB (saison, épisode en base 1) d'un épisode de la
 * suite principale Anime-Sama (`mainEntry`, `index` en base 0), ou `null` si
 * la saison TMDB concernée n'a pas de correspondance sûre. Mêmes épisodes,
 * autre découpage : l'épisode 1 de la saison 2 de Frieren chez Anime-Sama est
 * le 29e de l'unique saison TMDB.
 */
export function locateTmdbEpisode(
  tmdbSeasons: Array<[number, number]>,
  mainCounts: number[],
  mainEntry: number,
  index: number,
): { season: number; episode: number } | null {
  if (mainEntry < 0 || mainEntry >= mainCounts.length || index < 0 || index >= mainCounts[mainEntry]) return null;
  let rank = index;
  for (let entry = 0; entry < mainEntry; entry += 1) rank += mainCounts[entry];
  const safe = safeTmdbSeasons(tmdbSeasons, mainCounts);
  let start = 0;
  for (const [season, count] of tmdbSeasons) {
    if (rank < start + count) return safe.includes(season) ? { season, episode: rank - start + 1 } : null;
    start += count;
  }
  return null;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

/**
 * Correspondance des épisodes TMDB et Anime-Sama (15/10/2026). Les découpages
 * viennent des animés de la page Animés, relevés sur l'API Movix le 15/10/2026.
 */

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { safeTmdbSeasons, locateAnimeSamaEpisode, locateTmdbEpisode, isMainEntry } = await importTypeScript('../../utils/animeSamaMapping.ts');

const main = seasons => seasons.filter(isMainEntry).map(entry => entry.episodes);

test('les films, OAV, Kai et versions sans fillers sortent de la suite principale', () => {
  const reZero = [
    { name: 'Saison 1', episodes: 26 }, { name: "Saison 1 Director's Cut", episodes: 13 }, { name: 'Films', episodes: 2 },
    { name: 'Saison 2', episodes: 25 }, { name: 'Kai', episodes: 10 },
  ];
  assert.deepEqual(main(reZero), [26, 25]);
  const blackClover = [{ name: 'Saison 1 - Avec Fillers', episodes: 171 }, { name: 'Saison 1 - Sans Fillers', episodes: 131 }, { name: 'Saison 2', episodes: 2 }];
  assert.deepEqual(main(blackClover), [171, 2]);
});

test('une saison TMDB découpée en parties chez Anime-Sama : Frieren', () => {
  assert.deepEqual(safeTmdbSeasons([[1, 38]], [28, 10]), [1]);
  assert.deepEqual(locateAnimeSamaEpisode([[1, 38]], [28, 10], 1, 28), { entry: 0, index: 27 });
  assert.deepEqual(locateAnimeSamaEpisode([[1, 38]], [28, 10], 1, 29), { entry: 1, index: 0 });
});

test('saison TMDB en cours : seule la partie publiée a une source', () => {
  // Les Carnets de l'apothicaire : TMDB annonce 60 épisodes, 50 publiés.
  assert.deepEqual(safeTmdbSeasons([[1, 60]], [24, 24, 2]), [1]);
  assert.deepEqual(locateAnimeSamaEpisode([[1, 60]], [24, 24, 2], 1, 50), { entry: 2, index: 1 });
  assert.equal(locateAnimeSamaEpisode([[1, 60]], [24, 24, 2], 1, 51), null);
});

test('découpage plus fin côté TMDB : One Piece, l’arc Alabasta tient dans la saga 2', () => {
  const tmdb = [[1, 61], [2, 16], [3, 14], [4, 39], [5, 13], [6, 52], [7, 33]];
  const sagas = [61, 82, 63, 130];
  assert.deepEqual(safeTmdbSeasons(tmdb, sagas), [1, 2, 3, 4, 5]);
  // Saison TMDB 3, épisode 1 = 78e épisode (61 + 16 + 1) = saga 2, 17e épisode.
  assert.deepEqual(locateAnimeSamaEpisode(tmdb, sagas, 3, 1), { entry: 1, index: 16 });
  // Saison 6 : 52 épisodes à cheval sur les sagas 3 et 4, dont les bords ne coïncident pas.
  assert.equal(locateAnimeSamaEpisode(tmdb, sagas, 6, 1), null);
});

test('un épisode de plus chez Anime-Sama écarte la saison : Slime (récapitulatif)', () => {
  assert.deepEqual(safeTmdbSeasons([[1, 24], [2, 24], [3, 24], [4, 24]], [25, 26, 25, 24]), []);
  assert.equal(locateAnimeSamaEpisode([[1, 24]], [25], 1, 1), null);
});

test('My Hero Academia : les six premières saisons, pas la septième', () => {
  const tmdb = [[1, 13], [2, 25], [3, 25], [4, 25], [5, 25], [6, 25], [7, 21], [8, 11]];
  assert.deepEqual(safeTmdbSeasons(tmdb, [13, 25, 25, 25, 25, 25, 25, 12]), [1, 2, 3, 4, 5, 6]);
});

test('Demon Slayer : l’arc du train compté comme une saison des deux côtés', () => {
  const entries = [
    { name: 'Saison 1', episodes: 26 }, { name: "Film - Train de l'infini", episodes: 1 },
    { name: "Épisode - Train de l'infini", episodes: 7 }, { name: 'Saison 2', episodes: 11 },
    { name: 'Saison 3', episodes: 11 }, { name: 'Saison 4', episodes: 8 }, { name: 'Film - La Forteresse Infinie', episodes: 1 },
  ];
  const tmdb = [[1, 26], [2, 7], [3, 11], [4, 11], [5, 8]];
  assert.deepEqual(safeTmdbSeasons(tmdb, main(entries)), [1, 2, 3, 4, 5]);
  assert.deepEqual(locateAnimeSamaEpisode(tmdb, main(entries), 3, 2), { entry: 2, index: 1 });
});

test('sens inverse : l’épisode TMDB d’un épisode Anime-Sama (images et résumés de l’onglet)', () => {
  // Frieren : épisode 1 de la saison 2 Anime-Sama = épisode 29 de l'unique saison TMDB.
  assert.deepEqual(locateTmdbEpisode([[1, 38]], [28, 10], 1, 0), { season: 1, episode: 29 });
  // JoJo : Battle Tendency (2e entrée) complète la saison 1 TMDB, Stardust Crusaders ouvre la 2e.
  const jojo = [[1, 26], [2, 48], [3, 39]];
  assert.deepEqual(locateTmdbEpisode(jojo, [9, 17, 48, 39], 1, 0), { season: 1, episode: 10 });
  assert.deepEqual(locateTmdbEpisode(jojo, [9, 17, 48, 39], 2, 0), { season: 2, episode: 1 });
  // Aller-retour : les deux sens désignent le même épisode.
  const position = locateAnimeSamaEpisode(jojo, [9, 17, 48, 39], 2, 1);
  assert.deepEqual(locateTmdbEpisode(jojo, [9, 17, 48, 39], position.entry, position.index), { season: 2, episode: 1 });
  // Saison écartée (Slime, un récapitulatif de plus) : pas d'image empruntée à un autre épisode.
  assert.equal(locateTmdbEpisode([[1, 24], [2, 24]], [25, 26], 0, 3), null);
  // Hors limites.
  assert.equal(locateTmdbEpisode([[1, 38]], [28, 10], 2, 0), null);
  assert.equal(locateTmdbEpisode([[1, 38]], [28, 10], 1, 10), null);
});

test('numéros d’épisode impossibles : aucune source', () => {
  assert.equal(locateAnimeSamaEpisode([[1, 38]], [28, 10], 1, 0), null);
  assert.equal(locateAnimeSamaEpisode([[1, 38]], [28, 10], 2, 1), null);
});

test('mode Anime-Sama : sa route, et une progression qui ne se mélange pas à TMDB', async () => {
  const read = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  const [registry, page, player, row, details] = await Promise.all([
    read('src/routing/registry.tsx'),
    read('src/pages/Watch/WatchAnimeSama.tsx'),
    read('src/components/HLSPlayer.tsx'),
    read('src/tv/data/useContinueWatching.ts'),
    read('src/tv/TvDetails.tsx'),
  ]);
  assert.match(registry, /path: '\/watch\/anime\/:tmdbid\/:entry\/:episode'/);
  // La page n'envoie pas les numéros Anime-Sama comme saison et épisode TMDB.
  assert.match(page, /progressKey=\{animeSamaProgressKey\(id, entry \+ 1, index \+ 1\)\}/);
  assert.doesNotMatch(page, /tvShowId=|seasonNumber=\{|episodeNumber=\{/);
  assert.match(player, /const getProgressKey = useCallback\(\(\) => \{\s*if \(progressKey\) return progressKey;/);
  assert.match(row, /const ANIME_SAMA_KEY = \/\^progress_as_\(\\d\+\)_\(\\d\+\)_\(\\d\+\)\$\//);
  assert.match(details, /\{ id: 'animesama', label: 'Anime-Sama' \}/);
  // Le menu des sources du lecteur n'agit qu'à travers la page : sans relais, choisir une source ne faisait rien.
  assert.match(page, /window\.addEventListener\('sourceChange', onSourceChange\)/);
  assert.match(page, /key=\{`\$\{id\}-\$\{entry\}-\$\{index\}-\$\{src\}`\}/);
});

test('un épisode, une seule progression : chaque lecteur fond la clé de l’autre chemin avant de lire', async () => {
  const read = path => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  const [series, animeSama, details, source] = await Promise.all([
    read('src/pages/Watch/WatchTv.tsx'),
    read('src/pages/Watch/WatchAnimeSama.tsx'),
    read('src/tv/TvDetails.tsx'),
    read('src/utils/animeSamaSource.ts'),
  ]);
  // Lecteur de séries : la clé Anime-Sama du même épisode rejoint la clé TMDB.
  assert.match(series, /mergeEpisodeProgress\(\s*animeSamaProgressKey\(id, animeSamaEpisode\.entry \+ 1, animeSamaEpisode\.index \+ 1\),\s*`progress_tv_\$\{id\}_s\$\{seasonNumber\}_e\$\{episodeNumber\}`,/);
  // Lecteur Anime-Sama : l'inverse, avant que la page ne passe en lecture.
  const merge = animeSama.indexOf('mergeEpisodeProgress(');
  assert.ok(merge > 0 && merge < animeSama.indexOf("setStatus(result.hls.length"), 'fusion avant la lecture');
  // La plus récente des deux gagne, l'autre disparaît.
  assert.match(source, /if \(!to \|\| time\(from\) > time\(to\)\) localStorage\.setItem\(toKey, from\);\s*localStorage\.removeItem\(fromKey\);/);
  // « Reprendre » de la fiche suit le découpage regardé en dernier.
  assert.match(details, /last && \(!tmdb \|\| last\.progress\.timestamp > tmdb\.progress\.timestamp\)/);
  assert.match(details, /playAnimeSamaAt\(animeSamaTarget\.entry, animeSamaTarget\.episode\)/);
});

test('« Depuis le début » oublie la position de l’épisode affiché avant de l’ouvrir', async () => {
  const details = await readFile(new URL('../../../src/tv/TvDetails.tsx', import.meta.url), 'utf8');
  const restart = details.slice(details.indexOf('onRestart: () => {'), details.indexOf('onToggleList:'));
  // Film, épisode Anime-Sama, épisode TMDB : chacun oublie sa clé (et sa copie dans l'autre numérotation).
  assert.match(restart, /forgetProgress\(`progress_\$\{id\}`\);\s*playMovie\(true\);/);
  assert.match(restart, /animeSamaProgressKey\(id, animeSamaTarget\.entry, animeSamaTarget\.episode\)/);
  assert.match(restart, /playAnimeSamaAt\(animeSamaTarget\.entry, animeSamaTarget\.episode\)/);
  assert.match(restart, /`progress_tv_\$\{id\}_s\$\{target\.season\}_e\$\{target\.episode\}`/);
  assert.match(restart, /playEpisodeAt\(target\.season, target\.episode\)/);
});

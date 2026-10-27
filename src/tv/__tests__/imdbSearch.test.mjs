import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

/**
 * Titres connus en tête de la recherche (26/10/2026), repris de l'appli TV
 * native de Movix. Réponses relevées sur v3.sg.media-imdb.com le 26/10/2026.
 */

async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { imdbSlug, imdbSuggestionUrl, imdbTitleIds, foldTitle, rankSearchResults } = await importTypeScript('../data/imdbSearch.ts');

test('la saisie devient la forme attendue par IMDb, rien sous deux caractères', () => {
  assert.equal(imdbSlug('  Breaking   BAD '), 'breaking bad');
  assert.equal(imdbSlug('b'), null);
  assert.equal(imdbSuggestionUrl('l été'), 'https://v3.sg.media-imdb.com/suggestion/x/l%20%C3%A9t%C3%A9.json?includeVideos=0');
});

test('seuls les films et séries sont gardés, dans l’ordre d’IMDb', () => {
  const payload = { d: [
    { id: 'tt0903747', l: 'Breaking Bad', qid: 'tvSeries' },
    { id: 'nm0086205', l: 'Bre Blair' },
    { id: 'tt1234567', l: 'Un jeu', qid: 'videoGame' },
    { id: 'tt0816692', l: 'Interstellar', qid: 'movie' },
    { id: 'tt0903747', l: 'Breaking Bad', qid: 'tvSeries' },
  ] };
  assert.deepEqual(imdbTitleIds(payload), ['tt0903747', 'tt0816692']);
  assert.deepEqual(imdbTitleIds(null), []);
  assert.deepEqual(imdbTitleIds({ d: 'x' }), []);
});

test('accents, casse et ponctuation ne comptent pas dans le titre exact', () => {
  assert.equal(foldTitle("L'Été meurtrier"), 'l ete meurtrier');
  assert.equal(foldTitle('Spider-Man'), foldTitle('spider man'));
});

test('titre exact connu, puis connus IMDb, connus TMDB, et enfin le reste', () => {
  const item = (key, title, votes) => ({ key, title, votes });
  const popular = [item('movie:1', 'Interstellar', 38000), item('tv:2', 'Inter obscur', 3)];
  const found = [
    item('movie:3', 'Inter-medium', 0),
    item('movie:4', 'Inter', 120),
    item('movie:1', 'Interstellar', 38000),
    item('tv:5', 'Internat', 60),
  ];
  assert.deepEqual(
    rankSearchResults('inter', popular, found).map(entry => entry.key),
    ['movie:4', 'movie:1', 'tv:5', 'tv:2', 'movie:3'],
  );
  // Sans IMDb (hors du shell), l'ordre de TMDB reste, les connus d'abord.
  assert.deepEqual(rankSearchResults('inter', [], found).map(entry => entry.key), ['movie:4', 'movie:1', 'tv:5', 'movie:3']);
});

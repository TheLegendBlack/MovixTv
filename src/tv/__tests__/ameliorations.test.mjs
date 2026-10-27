import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

/**
 * Améliorations du 26/10/2026, reprises de l'appli TV native de Movix :
 * version préférée, Movix pour la clé VIP (code et QR),
 * reprise après un trou du flux, intro en mode Anime-Sama.
 */

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');

/** Transpile un module ; ses imports `@/…` (absents sous Node) sont retirés. */
async function importTypeScript(relativePath) {
  const source = (await read(relativePath)).replace(/^import [^;]+ from '@\/[^']+';$/gm, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('la version préférée passe en tête, l’autre juste après, et reste active', async () => {
  const { reorderLanguages } = await importTypeScript('../preferredVersion.ts');
  const order = [
    { id: 'vf', enabled: true }, { id: 'vostfr', enabled: false }, { id: 'vj', enabled: false }, { id: 'va', enabled: true },
  ];
  assert.deepEqual(reorderLanguages(order, 'vostfr').map(entry => [entry.id, entry.enabled]), [
    ['vostfr', true], ['vf', true], ['vj', false], ['va', true],
  ]);
  assert.deepEqual(reorderLanguages(order, 'vf').map(entry => entry.id), ['vf', 'vostfr', 'vj', 'va']);
});

test('Movix : seule la clé VIP active est gardée, telle que Movix la rend', async () => {
  const [link, screen, keyEntry, app] = await Promise.all([
    read('../movixLink.ts'), read('../settings/TvMovixLink.tsx'), read('../settings/TvKeyEntry.tsx'), read('../TvApp.tsx'),
  ]);
  assert.match(link, /\$\{MAIN_API\}\/api\/tv\/link\$\{path\}/);
  assert.match(link, /const key = vip\?\.active \? vip\.accessKey\?\.trim\(\) : null;/);
  assert.doesNotMatch(link, /localStorage\.setItem\([^)]*token/i, 'le jeton de session Movix n’est jamais gardé');
  assert.match(screen, /localStorage\.setItem\('access_code', key\);/);
  assert.match(keyEntry, /label: 'Se connecter avec Movix'/);
  assert.match(app, /<Route path="\/settings\/movix" element=\{<TvMovixLink \/>\} \/>/);
});

test('premier lancement : seulement sur une télé neuve, une fois, avec l’étape de l’édition', async () => {
  const [welcome, app, edition] = await Promise.all([read('../TvWelcome.tsx'), read('../TvApp.tsx'), read('../edition.tsx')]);
  assert.match(welcome, /localStorage\.getItem\('access_code'\) !== null/);
  assert.match(welcome, /key\.startsWith\('progress_'\)/);
  assert.match(welcome, /return markDone;/);
  assert.match(app, /<Route path="\/welcome" element=\{<TvWelcome \/>\} \/>/);
  assert.match(edition, /export const EDITION_WELCOME_STEP: TvWelcomeLinkStep \| null =/);
});

test('un manifeste HLS n’est jamais pris pour un MP4, et un trou du flux est sauté', async () => {
  const [player, diagnostic, animeSama] = await Promise.all([
    read('../../components/HLSPlayer.tsx'), read('../player/useTvPlaybackDiagnostic.ts'), read('../../pages/Watch/WatchAnimeSama.tsx'),
  ]);
  assert.match(player, /if \(\/\\\.m3u8\(\?:\$\|\[\?#&\/\]\)\/\.test\(decodedUrl\)\) \{\n\s+return false;/);
  assert.match(player, /failedAt > 5 && recovery\.count < 3 && isMp4SourceResolved\(src\)/);
  assert.match(player, /const resumeAt = failedAt \+ 3 \* recovery\.count;/);
  assert.match(diagnostic, /if \(video\.currentTime > 5\) \{\n\s+setIssue\(\{\n\s+code: 'interrupted'/);
  // Intro et générique en mode Anime-Sama : l'épisode TMDB, pour les seuls segments.
  assert.match(player, /seasonNumber: segmentEpisode\?\.seasonNumber \?\? seasonNumber,/);
  assert.match(animeSama, /segmentEpisode=\{segmentEpisode\}/);
});

test('le focus initial ignore la boîte qui défile que Chromium focalise', async () => {
  const kit = await read('../settings/kit.tsx');
  const body = kit.match(/export function useInitialFocus[\s\S]*?\n\}/)[0];
  assert.match(body, /active\.matches\('button, a\[href\], input, textarea, select, \[tabindex\]'\)/);
});

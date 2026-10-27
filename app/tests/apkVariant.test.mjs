import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { pickApkFields } from '../src/services/apkVariant.ts';

const universal = {
  version: '1.0.5',
  apkUrl: 'https://example.org/telecharger/app-5.apk',
  apkSizeBytes: 40,
  apkSha256: 'a'.repeat(64),
};
const apks = {
  'arm64-v8a': { url: 'https://example.org/telecharger/app-5-arm64-v8a.apk', sha256: 'b'.repeat(64), sizeBytes: 29 },
  'armeabi-v7a': { url: 'https://example.org/telecharger/app-5-armeabi-v7a.apk', sha256: 'c'.repeat(64), sizeBytes: 24 },
};

test('prend la variante du premier processeur pris en charge', () => {
  const picked = pickApkFields({ ...universal, apks }, ['arm64-v8a', 'armeabi-v7a', 'armeabi']);
  assert.equal(picked.apkUrl, apks['arm64-v8a'].url);
  assert.equal(picked.apkSha256, 'b'.repeat(64));
  assert.equal(picked.apkSizeBytes, 29);
  assert.equal(picked.version, '1.0.5');
  assert.equal(pickApkFields({ ...universal, apks }, ['armeabi-v7a', 'armeabi']).apkSha256, 'c'.repeat(64));
});

test('retombe sur l’universel : pas d’apks, processeur inconnu, variante invalide', () => {
  assert.equal(pickApkFields(universal, ['arm64-v8a']), universal);
  const manifest = { ...universal, apks };
  assert.equal(pickApkFields(manifest, ['x86_64', 'x86']), manifest);
  assert.equal(pickApkFields(manifest, []), manifest);
  const broken = { ...universal, apks: { 'arm64-v8a': { url: 'http://x/y.apk', sha256: 'zz', sizeBytes: 1 } } };
  assert.equal(pickApkFields(broken, ['arm64-v8a']), broken);
  // Une variante invalide ne bloque pas la suivante.
  const mixed = { ...universal, apks: { ...apks, 'arm64-v8a': null } };
  assert.equal(pickApkFields(mixed, ['arm64-v8a', 'armeabi-v7a']).apkSha256, 'c'.repeat(64));
});

test('le pont natif expose les processeurs et versionCheck les utilise', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../android/app/src/main/java/com/movix/app/update/UpdateModule.kt'), /fun getSupportedAbis[\s\S]*Build\.SUPPORTED_ABIS/);
  assert.match(read('../src/services/apkInstaller.ts'), /getSupportedAbis/);
  assert.match(read('../src/services/versionCheck.ts'), /pickApkFields\(manifest, abis\)/);
});

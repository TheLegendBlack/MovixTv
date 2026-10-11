import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/services/diagnosticReport.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const diagnostics = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const serviceSource = await readFile(new URL('../src/services/diagnostics.ts', import.meta.url), 'utf8');
const serviceOutput = ts.transpileModule(serviceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function loadService(native, entries) {
  const module = { exports: {} };
  let networkReads = 0;
  const require = id => {
    if (id === 'react-native') return { NativeModules: { MediaProxy: native }, Platform: { OS: 'ios', Version: '18' } };
    if (id === './apkInstaller') return { getLocalVersionName: async () => '2.5.27' };
    if (id === './diagnosticReport') return diagnostics;
    if (id === './networkJournal') return { isNetworkJournalEnabled: () => true, getNetworkJournal: async () => { networkReads++; return entries; } };
    throw new Error(id);
  };
  vm.runInNewContext(`(function(require,module,exports){${serviceOutput}\n})`)(require, module, module.exports);
  return { ...module.exports, networkReads: () => networkReads };
}

test('prefers the native error code over a generic or sensitive message', () => {
  assert.equal(diagnostics.diagnosticErrorCode({ code: 'MOVIX_RELAY_NETWORK_LOST', message: 'Cast indisponible.' }, 'fallback'), 'MOVIX_RELAY_NETWORK_LOST');
  assert.equal(diagnostics.diagnosticErrorCode(new Error('CAST_SOURCE_INVALID'), 'fallback'), 'CAST_SOURCE_INVALID');
  assert.equal(diagnostics.diagnosticErrorCode({ message: 'https://cdn.example/?token=secret' }, 'fallback'), 'fallback');
});

test('removes signed URLs, credentials, cookies and response bodies from exports', () => {
  const report = diagnostics.redactDiagnosticText('[12:00] GET https://user:password@cdn.example/file.m3u8?token=secret\n  > Authorization: Bearer topsecret\n  > Cookie: session=cookie-secret\n  < Set-Cookie: session=new-secret\n  > Accept: video/*\n  corps: <html>private body</html>\n  erreur: upstream 403');
  for (const value of ['user:password', 'token=secret', 'topsecret', 'cookie-secret', 'new-secret', 'private body']) assert.ok(!report.includes(value), value);
  assert.match(report, /cdn\.example\/file\.m3u8/);
  assert.match(report, /Accept: video/);
  assert.match(report, /upstream 403/);
  assert.ok(!diagnostics.redactDiagnosticText('  corps: <html>\nprivate next line</html>\n  erreur: 403').includes('private next line'));
  assert.ok(!diagnostics.redactDiagnosticText('http://192.168.1.2:1234/cast/sessionsecret/resourcesecret').includes('sessionsecret'));
});

test('removes sensitive headers embedded in console JSON and escaped URLs', () => {
  const raw = 'console: {"Authorization":"Bearer console-secret","Cookie":"session=console-cookie","x-api-key":"console-key","url":"https:\\/\\/cdn.example\\/stream?signature=escaped-secret"}';
  const report = diagnostics.redactDiagnosticText(raw);
  for (const secret of ['console-secret', 'console-cookie', 'console-key', 'escaped-secret']) {
    assert.ok(!report.includes(secret), `must remove ${secret}`);
  }
});

test('sensitive console payloads never leak arrays, nested JSON strings or later cookie pairs', () => {
  const payloads = [
    '{"headers":{"set-cookie":["session=FIRST_PRIVATE","auth=SECOND_PRIVATE"]}}',
    'console: Cookie: session=FIRST_PRIVATE; auth=SECOND_PRIVATE',
    JSON.stringify({ requestHeaders: JSON.stringify({ Authorization: 'Bearer FIRST_PRIVATE', Cookie: 'auth=SECOND_PRIVATE' }) }),
    '[12:30:00] console/error … - ' + JSON.stringify({ headers: { 'set-cookie': ['session=FIRST_PRIVATE', 'auth=SECOND_PRIVATE'] } }, null, 2),
  ];
  for (const payload of payloads) {
    const report = diagnostics.redactDiagnosticText(payload);
    assert.ok(!report.includes('FIRST_PRIVATE'), payload);
    assert.ok(!report.includes('SECOND_PRIVATE'), payload);
  }
});

test('keeps only the latest Cast transitions in memory', () => {
  diagnostics.clearCastDiagnostics();
  for (let i = 0; i < 200; i++) diagnostics.recordCastDiagnostic('status', `event=${i}`);
  const entries = diagnostics.getCastDiagnostics();
  assert.equal(entries.length, 150);
  assert.match(entries[0], /event=50$/);
  assert.match(entries.at(-1), /event=199$/);
  entries.length = 0;
  assert.equal(diagnostics.getCastDiagnostics().length, 150);
});

test('bounds clipboard size and preserves recent failure with an explicit truncation notice', () => {
  const text = 'x'.repeat(500_000) + '\nMOVIX_RELAY_NETWORK_LOST';
  const copy = diagnostics.clipboardDiagnosticText(text);
  assert.ok(copy.length < 61_000);
  assert.match(copy, /copie limitée/);
  assert.match(copy, /MOVIX_RELAY_NETWORK_LOST$/);
  assert.equal(diagnostics.clipboardDiagnosticText('small'), 'small');
});

test('Cast copy never reads the network journal and includes application details', async () => {
  let copied = '';
  const service = loadService({ copyDiagnosticText: async text => { copied = text; }, shareDiagnosticText: async () => false }, ['private network']);
  await service.copyDiagnostics(false);
  assert.equal(service.networkReads(), 0);
  assert.match(copied, /2\.5\.27 · ios 18/);
  assert.match(copied, /=== Cast ===/);
  assert.ok(!copied.includes('private network'));
});

test('full file export keeps large journals while copy is bounded, and native failures propagate', async () => {
  let shared = '';
  let copied = '';
  const service = loadService({
    copyDiagnosticText: async text => { copied = text; },
    shareDiagnosticText: async text => { shared = text; return false; },
  }, ['first-network-entry\n' + 'network-entry\n'.repeat(20_000)]);
  assert.equal(await service.shareDiagnostics(), false, 'share cancellation is not an error');
  await service.copyDiagnostics();
  assert.ok(shared.length > 200_000);
  assert.match(shared, /first-network-entry/);
  assert.ok(copied.length < 61_000);
  const broken = loadService({ copyDiagnosticText: async () => { throw new Error('clipboard'); }, shareDiagnosticText: async () => { throw new Error('file'); } }, []);
  await assert.rejects(broken.copyDiagnostics(), /clipboard/);
  await assert.rejects(broken.shareDiagnostics(), /file/);
});

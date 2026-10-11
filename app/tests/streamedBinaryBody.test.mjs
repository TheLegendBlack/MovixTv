import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('le transport natif reconstitue les octets du POST Streamed, y compris au-delà de 127', async () => {
  const source = await readFile(new URL('../src/services/bridge.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('bridge.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['fetchWithRedirectHeaders', 'handleGMFetch', 'arrayBufferToBase64', 'parseResponseHeaders']);
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(tree)).join('\n');
  const { outputText } = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const requests = [];
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, Uint8Array, atob, btoa,
    applyMediaProxyHeaderRules: (_url, headers) => headers,
    recordJournalEntry() {},
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return new Response(new Uint8Array([10, 1, 2]), { status: 200, headers: { goat: 'fixture' } });
    },
  });
  vm.runInContext(outputText, context);
  const handle = vm.runInContext('handleGMFetch', context);
  const bytes = Buffer.from([10, 128, 255, 0]);
  const result = await handle({ id: 'fixture', method: 'POST', url: 'https://embed.st/fetch', body: bytes.toString('base64'), bodyEncoding: 'base64', responseType: 'arraybuffer' });
  assert.equal(result.success, true);
  assert.deepEqual(Buffer.from(requests[0].body), bytes);
  assert.equal(result.headers.goat, 'fixture');
});

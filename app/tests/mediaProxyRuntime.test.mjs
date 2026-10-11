import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function loadBridgeRuntimeBuilder() {
  const sourceUrl = new URL('../src/injection/bridge-runtime.ts', import.meta.url);
  let source = await readFile(sourceUrl, 'utf8');
  source = source.replace(
    /import\s+\{\s*MEDIA_ENTRY_PATH_SOURCE\s*\}\s+from\s+['"]\.\/mediaProxyRouting['"];\s*/,
    `const MEDIA_ENTRY_PATH_SOURCE = ${JSON.stringify(String.raw`\.(?:m3u8|mp4|m4v|m4s|mpd|ts|aac|m4a|vtt|srt)(?:$|[?#])`)};\n`,
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourceUrl.pathname,
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`;
  return import(dataUrl);
}

function createRuntimeHarness(buildBridgeRuntime, { rejectOpen = false, now = Date.now, runtimeOptions } = {}) {
  const posted = [];
  const nativeFetches = [];
  const listeners = new Map();

  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    __MOVIX_BRIDGE_READY: false,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    },
    fetch: async (url, init = {}) => {
      nativeFetches.push({
        url: String(url),
        method: init.method,
        headers: { ...init.headers },
      });
      return {
        status: 206,
        statusText: 'Partial Content',
        url: String(url),
        headers: new Map([
          ['content-type', 'application/vnd.apple.mpegurl'],
          ['content-range', 'bytes 0-2/3'],
        ]),
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        text: async () => 'LOCAL',
      };
    },
  };

  window.ReactNativeWebView = {
    postMessage(raw) {
      const message = JSON.parse(raw);
      posted.push(message);
      queueMicrotask(() => {
        if (message.type === 'GM_OPEN_MEDIA_PROXY') {
          window.dispatchEvent(new CustomEvent('__MOVIX_BRIDGE_RESPONSE', {
            detail: rejectOpen
              ? { id: message.id, success: false, error: 'unavailable' }
              : {
                  id: message.id,
                  success: true,
                  value: 'http://127.0.0.1:28123/p/opaque-session',
                },
          }));
          return;
        }

        window.dispatchEvent(new CustomEvent('__MOVIX_BRIDGE_RESPONSE', {
          detail: {
            id: message.id,
            success: true,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/octet-stream' },
            body: 'BAUG',
            finalUrl: message.url,
          },
        }));
      });
    },
  };

  const context = vm.createContext({
    window,
    CustomEvent,
    Uint8Array,
    ArrayBuffer,
    URLSearchParams,
    Promise,
    Date: class extends Date { static now() { return now(); } },
    console,
    atob,
    btoa,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  vm.runInContext(buildBridgeRuntime(runtimeOptions), context);
  return { window, posted, nativeFetches };
}

function gmRequest(window, details) {
  return new Promise((resolve, reject) => {
    window.GM_xmlhttpRequest({
      responseType: 'arraybuffer',
      ...details,
      onload: resolve,
      onerror: reject,
    });
  });
}

test('le POST binaire Streamed traverse le bridge sans conversion en texte', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime);
  const bytes = Uint8Array.from([42, 10, 128, 255, 0, 42]).subarray(1, 5);
  await gmRequest(harness.window, {
    method: 'POST', url: 'https://embed.st/fetch',
    headers: { 'Content-Type': 'application/octet-stream' }, data: bytes,
  });
  const message = harness.posted.find(item => item.type === 'GM_FETCH');
  assert.equal(message.bodyEncoding, 'base64');
  assert.deepEqual([...Buffer.from(message.body, 'base64')], [...bytes]);
});

test('Seek media opens a header-bound proxy and sends Range only to loopback', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime);

  const response = await gmRequest(harness.window, {
    method: 'GET',
    url: 'https://185.237.106.181/v4/synthetic/master.m3u8?v=1',
    headers: {
      Origin: 'https://movix1.embedseek.com',
      Referer: 'https://movix1.embedseek.com/',
      Range: 'bytes=0-99',
    },
  });

  assert.deepEqual(harness.posted.map(entry => entry.type), [
    'GM_OPEN_MEDIA_PROXY',
  ]);
  const { id, ...openPayload } = harness.posted[0];
  assert.equal(typeof id, 'string');
  assert.deepEqual(openPayload, {
    type: 'GM_OPEN_MEDIA_PROXY',
    url: 'https://185.237.106.181/v4/synthetic/master.m3u8?v=1',
    method: 'GET',
    headers: {
      Origin: 'https://movix1.embedseek.com',
      Referer: 'https://movix1.embedseek.com/',
    },
  });
  assert.deepEqual(harness.nativeFetches, [
    {
      url: 'http://127.0.0.1:28123/p/opaque-session',
      method: 'GET',
      headers: {
        Range: 'bytes=0-99',
      },
    },
  ]);
  assert.deepEqual([...new Uint8Array(response.response)], [1, 2, 3]);
});

test('falls back to GM_FETCH when the native proxy is unavailable', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime, { rejectOpen: true });

  const response = await gmRequest(harness.window, {
    method: 'GET',
    url: 'https://r1.fsvid.lol/movie/master.m3u8',
    headers: {
      Origin: 'https://fsvid.lol',
      Referer: 'https://fsvid.lol/',
    },
  });

  assert.deepEqual(harness.posted.map(entry => entry.type), [
    'GM_OPEN_MEDIA_PROXY',
    'GM_FETCH',
  ]);
  assert.deepEqual([...new Uint8Array(response.response)], [4, 5, 6]);
});

test('exposes a media proxy opener for userscript playback fallbacks', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime);

  assert.equal(typeof harness.window.GM_openMediaProxy, 'function');
  const localUrl = await harness.window.GM_openMediaProxy({
    url: 'https://hls08.cdnvideo11.shop/hls08/12905/Ep1_index.m3u8',
    method: 'GET',
    headers: {
      Origin: 'https://kisskh.do',
      Referer: 'https://kisskh.do/',
    },
  });

  assert.equal(localUrl, 'http://127.0.0.1:28123/p/opaque-session');
  assert.deepEqual(harness.posted.map(entry => entry.type), [
    'GM_OPEN_MEDIA_PROXY',
  ]);
  const { id, ...openPayload } = harness.posted[0];
  assert.equal(typeof id, 'string');
  assert.deepEqual(openPayload, {
    type: 'GM_OPEN_MEDIA_PROXY',
    url: 'https://hls08.cdnvideo11.shop/hls08/12905/Ep1_index.m3u8',
    method: 'GET',
    headers: {
      Origin: 'https://kisskh.do',
      Referer: 'https://kisskh.do/',
    },
  });
  assert.deepEqual(harness.nativeFetches, []);
});

test('live playlist reloads share the proxy session but fetch every fresh playlist', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime);
  const details = {
    url: 'https://cdn.example/live.m3u8?token=one',
    headers: { Referer: 'https://player.example/' },
  };

  await Promise.all([
    gmRequest(harness.window, details),
    gmRequest(harness.window, details),
  ]);
  await gmRequest(harness.window, details);

  assert.equal(harness.posted.filter(entry => entry.type === 'GM_OPEN_MEDIA_PROXY').length, 1);
  assert.equal(harness.nativeFetches.length, 3, 'live playlist contents must never be cached');
  assert.equal(new Set(harness.nativeFetches.map(entry => entry.url)).size, 1);
});

test('playlist session identity includes URL, method and headers but not their case or order', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime);
  const url = 'https://cdn.example/live.m3u8?token=one';
  const headers = { Referer: 'https://player.example/', Origin: 'https://player.example' };

  await gmRequest(harness.window, { url, headers });
  await gmRequest(harness.window, {
    url,
    headers: { origin: headers.Origin, referer: headers.Referer, Range: 'bytes=0-99' },
  });
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.nativeFetches[1].headers.Range, 'bytes=0-99');

  await gmRequest(harness.window, { url, headers: { ...headers, Referer: 'https://other.example/' } });
  await gmRequest(harness.window, { url: url.replace('one', 'two'), headers });
  await gmRequest(harness.window, { url, headers, method: 'HEAD' });
  assert.equal(harness.posted.length, 4);
});

test('a failed playlist proxy open is retried on the next request', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime, { rejectOpen: true });
  const details = {
    url: 'https://cdn.example/live.m3u8',
    headers: { Referer: 'https://player.example/' },
  };

  await gmRequest(harness.window, details);
  await gmRequest(harness.window, details);

  assert.deepEqual(harness.posted.map(entry => entry.type), [
    'GM_OPEN_MEDIA_PROXY', 'GM_FETCH', 'GM_OPEN_MEDIA_PROXY', 'GM_FETCH',
  ]);
});

test('active playlist sessions survive long playback and expire before native idle expiry', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  let now = 1_000;
  const harness = createRuntimeHarness(buildBridgeRuntime, { now: () => now });
  const details = {
    url: 'https://cdn.example/live.m3u8',
    headers: { Referer: 'https://player.example/' },
  };

  await gmRequest(harness.window, details);
  for (let reload = 0; reload < 3; reload++) {
    now += 20 * 60 * 1_000;
    await gmRequest(harness.window, details);
  }
  assert.equal(harness.posted.length, 1);

  now += 26 * 60 * 1_000;
  await gmRequest(harness.window, details);
  assert.equal(harness.posted.length, 2);
});

test('playlist session storage remains bounded and keeps recently used streams', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime);
  const load = index => gmRequest(harness.window, {
    url: `https://cdn.example/live-${index}.m3u8`,
    headers: { Referer: 'https://player.example/' },
  });

  for (let index = 0; index < 32; index++) await load(index);
  await load(0);
  await load(32);
  await load(0);
  assert.equal(harness.posted.length, 33);
  await load(1);
  assert.equal(harness.posted.length, 34);
});

test('iOS refreshes HLS through GM_FETCH without creating changing loopback playlist sessions', async () => {
  const { buildBridgeRuntime } = await loadBridgeRuntimeBuilder();
  const harness = createRuntimeHarness(buildBridgeRuntime, {
    runtimeOptions: {
      mediaProxyRoutingEnabled: true,
      mediaProxyCapabilityEnabled: true,
      mediaProxyXhrRoutingEnabled: false,
      mediaProxyScheme: 'movix-media',
    },
  });
  const details = {
    url: 'https://cdn.example/live.m3u8',
    headers: { Referer: 'https://player.example/' },
  };

  for (let reload = 0; reload < 3; reload++) {
    const response = await gmRequest(harness.window, details);
    assert.equal(response.finalUrl, details.url);
    assert.deepEqual([...new Uint8Array(response.response)], [4, 5, 6]);
  }
  assert.deepEqual(harness.posted.map(entry => entry.type), ['GM_FETCH', 'GM_FETCH', 'GM_FETCH']);
  assert.deepEqual(harness.nativeFetches, []);
});

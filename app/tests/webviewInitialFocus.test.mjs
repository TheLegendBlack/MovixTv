import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Mesuré le 14/10/2026 sur l'Edenwood : sans ce focus, la page n'avait pas le
// focus clavier au lancement et la première flèche de la télécommande ne
// servait qu'à le lui donner.
test('la WebView donne le focus clavier à la page à la fin du chargement', async () => {
  const source = await readFile(new URL('../src/components/WebViewBrowser.tsx', import.meta.url), 'utf8');
  assert.match(source, /onLoadEnd=\{onLoadEnd\}/);
  assert.match(source, /const onLoadEnd = useCallback\(\(\) => \{\s*if \(IS_TV\) webViewRef\.current\?\.requestFocus\(\);/);
});

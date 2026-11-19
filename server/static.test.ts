import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createApp } from './app.ts';
import { RoomStore } from './store.ts';

test('static assets negotiate prebuilt gzip without changing content or API streaming', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio91-static-'));
  const content = 'console.log("Studio 91 classroom");\n'.repeat(2000);
  const compressed = gzipSync(content);
  const fixtures = ['index.html', 'index.html.gz', 'site.js', 'site.js.gz', 'plain.svg'];
  writeFileSync(join(dir, 'index.html'), '<html>Classroom</html>');
  writeFileSync(join(dir, 'index.html.gz'), gzipSync('<html>Classroom</html>'));
  writeFileSync(join(dir, 'site.js'), content);
  writeFileSync(join(dir, 'site.js.gz'), compressed);
  writeFileSync(join(dir, 'plain.svg'), '<svg/>');
  const server = createApp(new RoomStore(join(dir, 'unused.json')), dir);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const gzip = await fetch(base + '/site.js', { headers: { 'Accept-Encoding': 'br, gzip;q=0.8' } });
    assert.equal(gzip.headers.get('content-encoding'), 'gzip');
    assert.equal(gzip.headers.get('vary'), 'Accept-Encoding');
    assert.equal(Number(gzip.headers.get('content-length')), compressed.length);
    assert.equal(await gzip.text(), content);
    for (const encoding of ['identity', 'gzip;q=0', 'gzip;q=0, *;q=1']) {
      const identity = await fetch(base + '/site.js', { headers: { 'Accept-Encoding': encoding } });
      assert.equal(identity.headers.get('content-encoding'), null);
      assert.equal(await identity.text(), content);
    }
    const wildcard = await fetch(base + '/site.js', { headers: { 'Accept-Encoding': '*' } });
    assert.equal(wildcard.headers.get('content-encoding'), 'gzip');
    await wildcard.arrayBuffer();
    const head = await fetch(base + '/site.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(Number(head.headers.get('content-length')), compressed.length);
    assert.equal(await head.text(), '');
    const plain = await fetch(base + '/plain.svg', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(await plain.text(), '<svg/>');
    const api = await fetch(base + '/api/health');
    assert.equal(api.headers.get('content-encoding'), null);
    assert.deepEqual(await api.json(), { ok: true });
    utimesSync(join(dir, 'site.js.gz'), 1, 1);
    const stale = await fetch(base + '/site.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(stale.headers.get('content-encoding'), null);
    assert.equal(await stale.text(), content);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    for (const name of fixtures) rmSync(join(dir, name));
    rmdirSync(dir);
  }
});

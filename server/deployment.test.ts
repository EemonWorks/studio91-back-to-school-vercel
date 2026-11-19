import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import handler from '../api/index.ts';
import { createRuntime } from './app.ts';
import type { RoomRepository } from './store.ts';
import type { Room } from '../src/shared.ts';

async function serve(callback: (req: IncomingMessage, res: ServerResponse) => unknown) {
  const server = createServer(callback);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

test('Vercel API reports missing storage explicitly instead of pretending multiplayer works', async (t) => {
  const original = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const log = t.mock.method(console, 'error', () => {});
  const server = await serve(handler);
  try {
    const response = await fetch(server.url + '/api?route=health');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match((await response.json() as { error: string }).error, /Connect Redis Cloud/);
    assert(log.mock.callCount() > 0, 'configuration errors must be logged');
    const denied = await fetch(server.url + '/package.json');
    assert.equal(denied.status, 404);
  } finally {
    await server.close();
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  }
});

test('cloud runtime accepts platform-parsed JSON and cannot serve project source', async () => {
  const room: Room = { code: 'ABC234', revision: 0, createdAt: new Date().toISOString(), votes: [] };
  const store: RoomRepository = {
    create: () => room,
    publicRoom: (code) => code === room.code ? room : undefined,
    voteMany: (_code, updates) => ({ ...room, revision: 1, votes: updates.map((update) => update.vote) }),
  };
  const runtime = createRuntime(store, null);
  const server = await serve(async (req, res) => {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      Object.defineProperty(req, 'body', { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    }
    await runtime.handle(req, res);
  });
  try {
    const response = await fetch(server.url + '/api/rooms/ABC234/votes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '01234567-0123-4123-8123-012345678901', name: 'Guest', seat: 39 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as Room).votes[0]?.seat, 39);
    for (const path of ['/package.json', '/server/store.ts', '/.env', '/api/../package.json']) {
      const denied = await fetch(server.url + path);
      assert.equal(denied.status, 404);
      assert.equal(denied.headers.get('content-type'), 'application/json');
    }
  } finally {
    await runtime.close();
    await server.close();
  }
});

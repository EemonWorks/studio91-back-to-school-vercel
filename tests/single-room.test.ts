import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createServer } from 'vite';

type Room = { code: string; createdAt: string; revision: number; votes: Array<{ name: string; seat: number }> };
type Command = Array<string | number>;

async function isolatedApi(t: TestContext) {
  const names = new Set([
    'VERCEL', 'VERCEL_ENV', 'ADMIN_RESET_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    ...Object.keys(process.env).filter((name) => name.endsWith('_REST_API_URL') || name.endsWith('_REST_API_TOKEN')),
  ]);
  const saved = new Map([...names].map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  t.after(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const holder = globalThis as typeof globalThis & { studio91Seats?: unknown };
  const previous = holder.studio91Seats;
  delete holder.studio91Seats;
  t.after(() => {
    if (previous === undefined) delete holder.studio91Seats;
    else holder.studio91Seats = previous;
  });
  const api: typeof import('../api/index.ts') = await import(`../api/index.ts?test=${randomUUID()}`);
  return (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
    api.default.fetch(new Request(`http://localhost/api/${route}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    }));
}

function mockUpstash(t: TestContext) {
  const hashes = new Map<string, Map<string, string>>();
  const execute = (command: Command): unknown => {
    const [name, key, field, value] = command;
    if (name === 'EVAL') {
      const [, , , votesKey, metaKey, action, timestamp, ticket, stored, maximum] = command;
      const votes = hashes.get(String(votesKey)) ?? new Map<string, string>();
      if (action === 'vote' && !votes.has(String(ticket)) && votes.size >= Number(maximum)) return ':full';
      execute(['HSETNX', String(metaKey), 'createdAt', String(timestamp)]);
      if (action === 'vote') {
        execute(['HSET', String(votesKey), String(ticket), String(stored)]);
        execute(['HINCRBY', String(metaKey), 'rev', 1]);
      } else if (action === 'reset') {
        execute(['DEL', String(votesKey)]);
        execute(['HINCRBY', String(metaKey), 'rev', 1]);
        execute(['HSET', String(metaKey), 'createdAt', String(timestamp)]);
      }
      return [execute(['HGETALL', String(votesKey)]), execute(['HGETALL', String(metaKey)])];
    }
    const hashKey = String(key);
    const hash = hashes.get(hashKey) ?? new Map<string, string>();
    hashes.set(hashKey, hash);
    switch (name) {
      case 'HGETALL': return [...hash].flat();
      case 'HEXISTS': return Number(hash.has(String(field)));
      case 'HLEN': return hash.size;
      case 'HSETNX':
        if (hash.has(String(field))) return 0;
        hash.set(String(field), String(value));
        return 1;
      case 'HSET':
        hash.set(String(field), String(value));
        return 1;
      case 'HINCRBY': {
        const next = Number(hash.get(String(field)) ?? 0) + Number(value);
        hash.set(String(field), String(next));
        return next;
      }
      case 'DEL': return Number(hashes.delete(hashKey));
      default: throw new Error(`Unexpected REST command: ${name}`);
    }
  };
  const requests: Command[][] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://test-upstash.example/pipeline');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-only-token');
    assert.equal(typeof init.body, 'string');
    const commands: Command[] = JSON.parse(String(init.body));
    requests.push(commands);
    return Response.json(commands.map((command) => ({ result: execute(command) })));
  });
  return { hashes, requests };
}

test('one local classroom saves and moves one vote per ticket without exposing tickets', async (t) => {
  const request = await isolatedApi(t);
  const initial = await request('room');
  assert.match(initial.headers.get('cache-control') ?? '', /s-maxage=2/);
  const empty: Room = await initial.json();
  assert.equal(empty.code, 'STUDIO91');
  assert.equal(empty.votes.length, 0);
  const token = randomUUID();
  const picked: Room = await (await request('vote', { token, name: ' Guest\u0000 ', seat: 39 })).json();
  assert.deepEqual(picked.votes, [{ name: 'Guest', seat: 39 }]);
  assert(!JSON.stringify(picked).includes(token));
  const moved: Room = await (await request('vote', { token, name: 'Guest', seat: 0 })).json();
  assert.equal(moved.revision, picked.revision + 1);
  assert.deepEqual(moved.votes, [{ name: 'Guest', seat: 0 }]);
  assert.deepEqual(await (await request('room')).json(), moved);
  assert.equal((await request('vote', { token, name: 'Guest', seat: 40 })).status, 400);
  assert.equal((await request('vote', { token: 'invalid', name: 'Guest', seat: 0 })).status, 400);
  assert.equal((await request('room', {}, 'POST')).status, 405);
  assert.equal((await request('rooms/ABC234')).status, 404);
});

test('reset rejects a wrong passcode, clears seats, changes the epoch, and advances revision', async (t) => {
  const request = await isolatedApi(t);
  assert.equal((await request('reset', { key: 'missing' })).status, 503);
  process.env.ADMIN_RESET_KEY = 'too-short';
  assert.equal((await request('reset', { key: 'too-short' })).status, 503);
  process.env.ADMIN_RESET_KEY = 'test-only-reset-passcode';
  const picked: Room = await (await request('vote', { token: randomUUID(), name: 'Guest', seat: 3 })).json();
  assert.equal((await request('reset', { key: 'wrong-passcode' })).status, 403);
  assert.equal((await (await request('room')).json() as Room).votes.length, 1);
  const cleared: Room = await (await request('reset', { key: process.env.ADMIN_RESET_KEY })).json();
  assert.equal(cleared.votes.length, 0);
  assert.equal(cleared.revision, picked.revision + 1);
  assert.notEqual(cleared.createdAt, picked.createdAt);
  assert.deepEqual(await (await request('room')).json(), cleared);
});

test('Vercel refuses missing storage and accepts rewritten API routes', async (t) => {
  const request = await isolatedApi(t);
  process.env.VERCEL = '1';
  const missing = await request('health');
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /Upstash/);
  process.env.KV_REST_API_URL = 'https://test-upstash.example/';
  process.env.KV_REST_API_TOKEN = 'test-only-token';
  mockUpstash(t);
  const health = await request('?route=health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, storage: 'upstash', seatsTaken: 0, resetEnabled: false });
});

test('REST-backed seats survive a new API instance and preview stays separate from production', async (t) => {
  const first = await isolatedApi(t);
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  process.env.KV_REST_API_URL = 'https://test-upstash.example';
  process.env.KV_REST_API_TOKEN = 'test-only-token';
  const upstream = mockUpstash(t);
  const token = randomUUID();
  const saved: Room = await (await first('vote', { token, name: 'Guest', seat: 7 })).json();
  const api: typeof import('../api/index.ts') = await import(`../api/index.ts?test=${randomUUID()}`);
  const recovered = await api.default.fetch(new Request('http://localhost/api/room'));
  assert.deepEqual(await recovered.json(), saved);
  process.env.VERCEL_ENV = 'preview';
  const preview: typeof import('../api/index.ts') = await import(`../api/index.ts?test=${randomUUID()}`);
  const previewRoom: Room = await (await preview.default.fetch(new Request('http://localhost/api/room'))).json();
  assert.equal(previewRoom.votes.length, 0);
  assert(upstream.hashes.has('studio91:production:votes'));
  assert(upstream.hashes.has('studio91:preview:meta'));
});

test('storage errors return an explicit error, never an empty successful classroom', async (t) => {
  const request = await isolatedApi(t);
  process.env.VERCEL = '1';
  process.env.KV_REST_API_URL = 'https://test-upstash.example';
  process.env.KV_REST_API_TOKEN = 'test-only-token';
  const log = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    { result: [
      ['private-ticket', '{broken-json'],
      ['createdAt', '2026-11-22T00:00:00.000Z', 'rev', '1'],
    ] },
  ]));
  const response = await request('room');
  assert.equal(response.status, 503);
  assert.equal(typeof (await response.json()).error, 'string');
  assert(log.mock.callCount() > 0);
});

test('concurrent new tickets cannot exceed the REST classroom limit, while existing tickets can move', async (t) => {
  const request = await isolatedApi(t);
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  process.env.KV_REST_API_URL = 'https://test-upstash.example';
  process.env.KV_REST_API_TOKEN = 'test-only-token';
  const upstream = mockUpstash(t);
  const existing = randomUUID();
  upstream.hashes.set('studio91:production:votes', new Map(Array.from({ length: 399 }, (_, index) => [
    index === 0 ? existing : randomUUID(),
    JSON.stringify({ name: `Guest ${index}`, seat: 0, at: index }),
  ])));
  upstream.hashes.set('studio91:production:meta', new Map([
    ['createdAt', '2026-11-22T00:00:00.000Z'], ['rev', '399'],
  ]));
  const responses = await Promise.all([0, 1].map((seat) => request('vote', {
    token: randomUUID(), name: 'New guest', seat,
  })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(upstream.hashes.get('studio91:production:votes')?.size, 400);
  const moved: Room = await (await request('vote', { token: existing, name: 'Guest 0', seat: 39 })).json();
  assert.equal(moved.votes.length, 400);
  assert(moved.votes.some((vote) => vote.name === 'Guest 0' && vote.seat === 39));
});

test('famous visitors follow a deterministic clock, try valid seats, stroll, and never affect counts', async () => {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const mates = await server.ssrLoadModule('/src/classmates.ts');
    const shared = await server.ssrLoadModule('/src/shared.ts');
    const reference = await server.ssrLoadModule('/src/classmates.ts');
    let strolls = 0;
    let visits = 0;
    for (let bot = 0; bot < mates.CLASSMATES.length; bot++) {
      for (let elapsed = 0; elapsed < 120_000; elapsed += 250) {
        const now = 1_795_392_000_000 + elapsed;
        const clock = mates.beatAt(bot, now);
        assert.deepEqual(clock, reference.beatAt(bot, now));
        const spot = mates.spotFor(bot, clock.beat);
        assert.deepEqual(spot, reference.spotFor(bot, clock.beat));
        if ('seat' in spot) {
          assert(Number.isInteger(spot.seat) && spot.seat >= 0 && spot.seat < 40);
          visits++;
        } else {
          assert(spot.x >= 0 && spot.x <= 1 && spot.y >= 0 && spot.y <= 1);
          strolls++;
        }
      }
    }
    assert(visits > 0 && strolls > 0);
    assert.equal(shared.summarize([]).total, 0);
    assert.equal(shared.summarize([{ name: 'Real guest', seat: 39 }]).total, 1);
  } finally {
    await server.close();
  }
});

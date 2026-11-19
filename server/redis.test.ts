import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createRuntime } from './app.ts';
import { connectRedis, RedisRoomEvents, RedisRoomStore } from './redis.ts';
import { ObservedStream, waitFor } from './test-helpers.ts';
import type { Room } from '../src/shared.ts';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl) throw new Error('Set TEST_REDIS_URL to an isolated local Redis instance before running npm run test:redis.');

async function instance(prefix: string, options: { rotationMs?: number; refreshMs?: number } = {}) {
  const client = await connectRedis(redisUrl!);
  const subscriber = await connectRedis(redisUrl!);
  const store = new RedisRoomStore(client, prefix);
  const events = new RedisRoomEvents(store, subscriber, options);
  const runtime = createRuntime(store, null, { events });
  const server = createServer(runtime.handle);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base, store, events, client,
    async close() {
      await runtime.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      if (client.isOpen) client.destroy();
    },
  };
}

test('200 participants share votes and sustained cursors across independent Redis-backed instances', { timeout: 60_000 }, async (t) => {
  const prefix = `test-${randomUUID()}`;
  const first = await instance(prefix, { refreshMs: 2000 });
  const second = await instance(prefix, { refreshMs: 2000 });
  const streams = Array.from({ length: 200 }, () => new ObservedStream());
  const tokens = streams.map(() => randomUUID());
  const post = (base: string, path: string, body: unknown) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const created = await post(first.base, '/api/rooms', {});
    assert.equal(created.status, 201);
    const room = await created.json() as Room;
    const path = `/api/rooms/${room.code}`;
    assert.deepEqual(await second.store.publicRoom(room.code), room);
    await Promise.all(streams.map((stream, index) => stream.open((index % 2 ? first.base : second.base) + path + '/events')));
    await waitFor(() => streams.every((stream) => !!stream.session && stream.online === 200), 'all 200 distributed sessions should be visible');
    const started = performance.now();
    const votes = await Promise.all(tokens.map((token, index) => post(index % 2 ? second.base : first.base, path + '/votes', {
      token, name: `Guest ${index}`, seat: 38,
    })));
    assert(votes.every((response) => response.status === 200));
    await Promise.all(votes.map((response) => response.arrayBuffer()));
    await waitFor(() => streams.every((stream) => stream.room?.revision === 200 && stream.room.votes.length === 200), 'all instances must receive all 200 votes');
    const elapsed = Math.round(performance.now() - started);
    assert(elapsed < 8000);
    assert.equal((await second.store.publicRoom(room.code))!.votes.filter((vote) => vote.seat === 38).length, 200);
    const cursorStarted = performance.now();
    let updates = 0;
    // Repeated motion tests cross-instance forwarding and lease refresh, not just one burst.
    for (let frame = 0; frame < 20; frame++) {
      const responses = await Promise.all(streams.map((stream, index) => post(index % 2 ? second.base : first.base, path + '/presence', {
        session: stream.session!.id, key: stream.session!.key, name: `Guest ${index}`,
        x: ((index + frame) % 200) / 200, y: frame / 20, surface: '3d', active: true,
      })));
      assert(responses.every((response) => response.status === 204), 'cursor requests may land on the other server');
      updates += responses.length;
      await delay(180);
    }
    await waitFor(() => streams.every((stream) => stream.cursors.size === 200 &&
      [...stream.cursors.values()].every((cursor) => cursor.y === 0.95)), 'every viewer must receive the final cursor position');
    assert(streams.every((stream) => stream.error === null && !stream.ended));
    const creds = streams[0]!.session!;
    const body = { session: creds.id, key: creds.key, name: 'Guest', x: 0.2, y: 0.2, surface: 'map', active: true };
    const other = await second.store.create();
    assert.equal((await post(first.base, `/api/rooms/${other.code}/presence`, body)).status, 403);
    assert.equal((await post(second.base, path + '/presence', { ...body, key: randomUUID() })).status, 403);
    const moved = await post(second.base, path + '/votes', { token: tokens[0], name: 'Guest 0', seat: 0 });
    assert.equal(moved.status, 200);
    await moved.arrayBuffer();
    await waitFor(() => streams.every((stream) => stream.room?.revision === 201), 'moving a vote should reach both instances');
    assert.equal((await first.store.publicRoom(room.code))!.votes.length, 200);
    assert.equal((await first.store.publicRoom(room.code))!.votes.filter((vote) => vote.seat === 38).length, 199);
    const restartedConnection = await connectRedis(redisUrl!);
    try {
      const restarted = new RedisRoomStore(restartedConnection, prefix);
      assert.deepEqual(await restarted.publicRoom(room.code), await first.store.publicRoom(room.code), 'new workers recover all state without local disk');
    } finally { restartedConnection.destroy(); }
    await streams[0]!.close();
    await waitFor(() => streams.slice(1).every((stream) => !stream.cursors.has(creds.id) && stream.online === 199), 'disconnects must be shared');
    t.diagnostic(`200 concurrent same-desk votes across two instances: ${elapsed}ms. ${updates} cursor moves over ${Math.round(performance.now() - cursorStarted)}ms delivered to 200 SSE clients.`);
  } finally {
    await Promise.all(streams.map((stream) => stream.close()));
    await first.events.close();
    await second.events.close();
    const keys = await first.client.keys(`${first.store.prefix}:*`);
    if (keys.length) await first.client.del(keys);
    await Promise.all([first.close(), second.close()]);
  }
});

test('stream rotation reconnects on another instance and preview namespaces stay isolated', { timeout: 15_000 }, async () => {
  const prefix = `test-${randomUUID()}`;
  const first = await instance(prefix, { rotationMs: 700 });
  const second = await instance(prefix, { rotationMs: 700 });
  const preview = new RedisRoomStore(second.client, `${prefix}-preview`);
  const stream = new ObservedStream();
  const reconnected = new ObservedStream();
  try {
    const room = await first.store.create();
    const token = randomUUID();
    await first.store.voteMany(room.code, [{ token, vote: { name: 'Guest', seat: 1 } }]);
    assert.equal(await preview.publicRoom(room.code), undefined);
    await stream.open(`${first.base}/api/rooms/${room.code}/events`);
    await waitFor(() => !!stream.session, 'initial cursor session must open');
    const old = stream.session!;
    await waitFor(() => stream.ended, 'stream should rotate before the function deadline', 3000);
    await reconnected.open(`${second.base}/api/rooms/${room.code}/events`);
    await waitFor(() => !!reconnected.session, 'reconnect must get new credentials');
    assert.notEqual(reconnected.session!.id, old.id);
    assert.equal(reconnected.room?.votes.length, 1);
    assert.equal(reconnected.room?.votes[0]?.seat, 1);
    const response = await fetch(`${second.base}/api/rooms/${room.code}/presence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: old.id, key: old.key, name: 'Guest', x: 0, y: 0, surface: 'page', active: true }),
    });
    assert.equal(response.status, 403, 'rotated credentials must not be reusable');
    await response.arrayBuffer();
    assert.equal(await first.store.allowCreate('same-test-ip'), true);
    await Promise.all(Array.from({ length: 19 }, () => first.store.allowCreate('same-test-ip')));
    assert.equal(await second.store.allowCreate('same-test-ip'), false, 'creation throttling must cross server instances');
  } finally {
    await Promise.all([stream.close(), reconnected.close()]);
    await first.events.close();
    await second.events.close();
    const keys = await first.client.keys(`${first.store.prefix}:*`);
    if (keys.length) await first.client.del(keys);
    await Promise.all([first.close(), second.close()]);
  }
});

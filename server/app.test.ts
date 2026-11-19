import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './app.ts';
import { RoomStore } from './store.ts';
import {
  BENCH_COUNT, BENCH_DEPTH, BENCH_PITCH, BENCH_REAR_EXTENT, BENCH_WIDTH,
  BENCHES_PER_ROW, COLUMNS, ROWS, SEAT_COUNT, SEATS_PER_BENCH,
  benchPosition, groupFor, newestSnapshot, pencilPose, rowDepth, seatLabel, summarize,
} from '../src/shared.ts';
import type { Room } from '../src/shared.ts';
import { ObservedStream, waitFor } from './test-helpers.ts';

test('all 40 seats retain their front, middle, and back identities', () => {
  const votes = Array.from({ length: SEAT_COUNT }, (_, seat) => ({ name: 'Guest', seat }));
  assert.deepEqual(summarize(votes).counts, [16, 8, 16]);
  assert.deepEqual([15, 16, 23, 24].map(groupFor), [0, 1, 1, 2]);
  assert.equal(new Set(votes.map((vote) => seatLabel(vote.seat))).size, 40);
  assert.equal(seatLabel(0), 'A1');
  assert.equal(seatLabel(39), 'E8');
});

test('20 two-person benches have uniformly spaced rows and clear aisles', () => {
  assert.equal(BENCH_COUNT, 20);
  assert.equal(SEATS_PER_BENCH, 2);
  assert.equal(BENCH_COUNT * SEATS_PER_BENCH, SEAT_COUNT);
  assert.equal(BENCHES_PER_ROW * SEATS_PER_BENCH, COLUMNS);
  assert(BENCH_PITCH - BENCH_WIDTH >= 1, 'at least one scene unit between bench pairs');
  for (let row = 0; row < ROWS - 1; row++) {
    const gap = rowDepth(row + 1) - BENCH_DEPTH / 2 - (rowDepth(row) + BENCH_REAR_EXTENT);
    assert(gap >= 0.7, `row ${row + 1} has clear walking space`);
    const firstGap = rowDepth(1) - rowDepth(0);
    assert(Math.abs(rowDepth(row + 1) - rowDepth(row) - firstGap) < 1e-10, 'every row gap is equal');
  }
  const seatIds: number[] = [];
  for (let bench = 0; bench < BENCH_COUNT; bench++) {
    const [x, , z] = benchPosition(bench);
    assert(Math.abs(x) + BENCH_WIDTH / 2 < 8, 'benches stay inside the room width');
    assert(z + BENCH_REAR_EXTENT < 7.65, 'bench backs stay inside the floor');
    for (let side = 0; side < SEATS_PER_BENCH; side++) seatIds.push(bench * SEATS_PER_BENCH + side);
  }
  assert.deepEqual(seatIds, Array.from({ length: 40 }, (_, seat) => seat));
});

test('pencil mounds contain one distinct, finite position per vote up to 200', () => {
  for (const total of [1, 2, 20, 100, 200]) {
    const positions = Array.from({ length: total }, (_, index) => pencilPose(index, total));
    assert.equal(new Set(positions.map((pose) => JSON.stringify(pose))).size, total);
    assert(positions.every((pose) => Object.values(pose).every(Number.isFinite)));
    assert(positions.every((pose) => Math.abs(pose.x) < 0.04 && Math.abs(pose.z) <= 0.45 && pose.y < 2.4));
  }
  assert.throws(() => pencilPose(200, 200), RangeError);
  assert.throws(() => pencilPose(0, 0), RangeError);
});

test('late HTTP responses never replace newer live results', () => {
  const current: Room = { code: 'ABC234', revision: 3, createdAt: new Date().toISOString(), votes: [] };
  const older = { ...current, revision: 1 };
  const newer = { ...current, revision: 4 };
  assert.equal(newestSnapshot(current, older), current);
  assert.equal(newestSnapshot(current, newer), newer);
  assert.equal(newestSnapshot(null, older), older);
});

test('live rooms validate, broadcast, update one vote per token, and persist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio91-test-'));
  const file = join(dir, 'rooms.json');
  const store = new RoomStore(file);
  const server = createApp(store, dir);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const created = await post('/api/rooms', {});
    assert.equal(created.status, 201);
    const room = await created.json() as Room;
    assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
    const path = `/api/rooms/${room.code}`;
    const events = await fetch(base + path + '/events');
    assert.equal(events.headers.get('content-type'), 'text/event-stream');
    assert.equal(events.headers.get('content-encoding'), null, 'live events must remain uncompressed and unbuffered');
    assert(events.body);
    reader = events.body.getReader();
    const initial = await reader.read();
    assert(new TextDecoder().decode(initial.value).includes(room.code));
    const token = randomUUID();
    const vote = await post(path + '/votes', { token, name: 'Alex', seat: 0 });
    assert.equal(vote.status, 200);
    let update = '';
    while (!update.includes('Alex')) update += new TextDecoder().decode((await reader.read()).value);
    await post(path + '/votes', { token, name: 'Alex', seat: 39 });
    await post(path + '/votes', { token: randomUUID(), name: 'Sam', seat: 39 });
    const state = await (await fetch(base + path)).json() as Room;
    assert.equal(state.votes.length, 2, 'moving does not add a duplicate vote');
    assert.equal(state.revision, 3, 'every change has an ordered revision for concurrent clients');
    assert.equal(state.votes.filter((v) => v.seat === 39).length, 2, 'shared desk is allowed');
    assert(!JSON.stringify(state).includes(token), 'private participant token is not exposed');
    assert.deepEqual(summarize(state.votes).counts, [0, 0, 2]);
    assert.deepEqual(new RoomStore(file).publicRoom(room.code), state, 'saved across server restarts');
    for (const seat of [-1, 40, 1.5, '2', null]) {
      assert.equal((await post(path + '/votes', { token, name: 'Bad', seat })).status, 400);
    }
    assert.equal((await post(path + '/votes', { token, name: ' '.repeat(3), seat: 2 })).status, 400);
    assert.equal((await post(path + '/votes', { token: 'bad', name: 'Name', seat: 2 })).status, 400);
    assert.equal((await fetch(base + '/api/rooms/ZZZZZZ')).status, 404);
    assert.equal((await fetch(base + '/api/rooms/bad')).status, 400);
    const crossSite = await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'http://example.org' } });
    assert.equal(crossSite.status, 403);
    const malformed = await fetch(base + path + '/votes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await post(path + '/votes', { token, name: 'x'.repeat(5000), seat: 2 })).status, 413);
    assert.deepEqual(summarize([]).counts, [0, 0, 0]);
    assert.deepEqual(summarize([{ name: 'A', seat: 0 }, { name: 'B', seat: 16 }, { name: 'C', seat: 32 }]).counts, [1, 1, 1]);
  } finally {
    await reader?.cancel();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(file, { force: true });
    rmdirSync(dir);
  }
});

    test('200 live clients can share one desk, move votes, and exchange isolated cursors', { timeout: 30_000 }, async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'studio91-load-'));
      const file = join(dir, 'rooms.json');
      class CountingStore extends RoomStore {
        writes = 0;
        override save() { super.save(); this.writes++; }
      }
      const store = new CountingStore(file);
      const room = store.create();
      const otherRoom = store.create();
      const server = createApp(store, dir);
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      const address = server.address();
      assert(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const path = `/api/rooms/${room.code}`;
      const post = (url: string, body: unknown) => fetch(base + url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const streams = Array.from({ length: 200 }, () => new ObservedStream());
      const outsider = new ObservedStream();
      try {
        await Promise.all(streams.map((stream) => stream.open(base + path + '/events')));
        await outsider.open(`${base}/api/rooms/${otherRoom.code}/events`);
        await waitFor(() => streams.every((stream) => !!stream.session), '200 cursor sessions should connect');
        const tokens = streams.map(() => randomUUID());
        const writesBefore = store.writes;
        const start = performance.now();
        const responses = await Promise.all(tokens.map((token, index) => post(path + '/votes', { token, name: `Guest ${index}`, seat: 38 })));
        assert(responses.every((response) => response.status === 200));
        await waitFor(() => streams.every((stream) => stream.room?.votes.length === 200), 'every client should receive all 200 votes');
        const elapsed = performance.now() - start;
        assert(elapsed < 8000, 'all 200 selections should settle in under eight seconds locally');
        assert(store.writes - writesBefore < 50, 'vote bursts should coalesce durable writes');
        const final = store.publicRoom(room.code)!;
        assert.equal(final.revision, 200);
        assert.equal(final.votes.filter((vote) => vote.seat === 38).length, 200);
        assert.deepEqual(summarize(final.votes).counts, [0, 0, 200]);
        assert.deepEqual(new RoomStore(file).publicRoom(room.code), final, 'all acknowledged votes are durable');
        assert(streams.every((stream) => stream.error === null));
        const cursorResponses = await Promise.all(streams.map((stream, index) => post(path + '/presence', {
          session: stream.session!.id, key: stream.session!.key, name: `Guest ${index}`,
          x: index / 200, y: 0.5, surface: '3d', active: true,
        })));
        assert(cursorResponses.every((response) => response.status === 204));
        await waitFor(() => streams.every((stream) => stream.cursors.size === 200 && stream.online === 200), 'all 200 live cursors should arrive');
        assert.equal(outsider.cursors.size, 0, 'cursors never leak into another room');
        const serialized = JSON.stringify([...streams[0]!.cursors.values()]);
        assert(streams.every((stream) => !serialized.includes(stream.session!.key)), 'cursor session secrets remain private');
        const credentials = streams[0]!.session!;
        const presence = { session: credentials.id, key: credentials.key, name: 'Guest', x: 0.5, y: 0.5, surface: '3d', active: true };
        assert.equal((await post(`/api/rooms/${otherRoom.code}/presence`, presence)).status, 403);
        assert.equal((await post(path + '/presence', { ...presence, x: 2 })).status, 400);
        assert.equal((await post(path + '/presence', { ...presence, key: randomUUID() })).status, 403);
        await delay(110);
        assert.equal((await post(path + '/presence', presence)).status, 204);
        assert.equal((await post(path + '/presence', presence)).status, 429);
        await post(path + '/votes', { token: tokens[0], name: 'Guest 0', seat: 0 });
        const moved = store.publicRoom(room.code)!;
        assert.equal(moved.votes.length, 200);
        assert.equal(moved.votes.filter((vote) => vote.seat === 38).length, 199);
        assert.equal(moved.votes.filter((vote) => vote.seat === 0).length, 1);
        await streams[0]!.close();
        await waitFor(() => streams.slice(1).every((stream) => !stream.cursors.has(credentials.id) && stream.online === 199), 'disconnected cursors should disappear');
        assert(!readFileSync(file, 'utf8').includes(credentials.key), 'cursor presence is never persisted');
        t.diagnostic(`200 simultaneous votes reached 200 SSE clients in ${Math.round(elapsed)}ms; ${store.writes - writesBefore} durable write batches including a later move.`);
      } finally {
        await Promise.all([...streams, outsider].map((stream) => stream.close()));
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        rmSync(file, { force: true });
        rmdirSync(dir);
      }
    });

    test('a failed vote batch rolls back memory and persisted results', () => {
      const dir = mkdtempSync(join(tmpdir(), 'studio91-rollback-'));
      const file = join(dir, 'rooms.json');
      class FailingStore extends RoomStore {
        fail = false;
        override save() { if (this.fail) throw new Error('Simulated disk failure'); super.save(); }
      }
      const store = new FailingStore(file);
      try {
        const room = store.create();
        store.fail = true;
        assert.throws(() => store.voteMany(room.code, [{ token: randomUUID(), vote: { name: 'Guest', seat: 0 } }]), /disk failure/);
        assert.deepEqual(store.publicRoom(room.code), room);
        assert.deepEqual(new RoomStore(file).publicRoom(room.code), room);
      } finally {
        rmSync(file, { force: true });
        rmdirSync(dir);
      }
    });

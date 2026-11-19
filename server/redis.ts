import { createHash, randomInt } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { createClient } from 'redis';
import type { CursorBatch, LiveCursor, Room } from '../src/shared.ts';
import { ClassroomStream } from './stream.ts';
import { newRoomCode, validVote } from './store.ts';
import type { RoomRepository, VoteUpdate } from './store.ts';
import { PresenceError, publicCursor, validPresence } from './presence.ts';
import type { ClassroomEvents } from './presence.ts';
import { createLimitScript, createRoomScript, joinScript, leaveScript, snapshotScript, updateCursorScript, voteScript } from './redis-scripts.ts';

export type RedisClient = ReturnType<typeof createClient>;

export async function connectRedis(url: string) {
  const client = createClient({
    url,
    socket: { connectTimeout: 5000, reconnectStrategy: (retries) => retries > 3 ? false : Math.min(250 * 2 ** retries, 2000) },
    disableOfflineQueue: true,
  });
  client.on('error', (error: Error) => console.error('Shared Redis connection error:', error.message));
  await client.connect();
  return client;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === 'string')) {
    throw new Error('Shared storage returned an invalid response.');
  }
  return value;
}

function parseRoom(code: string, fields: string[]): Room | undefined {
  if (!fields.length) return undefined;
  const values = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) =>
    [fields[index * 2]!, fields[index * 2 + 1]!]));
  const revision = Number(values._revision);
  if (!values._createdAt || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Shared classroom metadata is invalid.');
  const votes = Object.entries(values).filter(([field]) => field.startsWith('v:')).map(([, raw]) => {
    const vote: unknown = JSON.parse(raw);
    if (!validVote(vote)) throw new Error('A saved classroom vote is invalid.');
    return vote;
  });
  return { code, createdAt: values._createdAt, revision, votes };
}

export class RedisRoomStore implements RoomRepository {
  client: RedisClient;
  prefix: string;

  constructor(client: RedisClient, namespace: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error('REDIS_PREFIX must contain 1-80 letters, digits, underscores, or hyphens.');
    this.client = client;
    this.prefix = `studio91:{${namespace}}`;
  }

  roomKey(code: string) { return `${this.prefix}:room:${code}`; }
  channel(code: string) { return `${this.prefix}:events:${code}`; }
  presenceKeys(code: string) {
    return [`${this.prefix}:online:${code}`, `${this.prefix}:sessions:${code}`, `${this.prefix}:cursors:${code}`, this.channel(code)];
  }

  async health() { await this.client.ping(); }

  async allowCreate(identity: string) {
    const hash = createHash('sha256').update(identity).digest('hex');
    return await this.client.eval(createLimitScript, { keys: [`${this.prefix}:create-limit:${hash}`], arguments: [] }) === 1;
  }

  async publicRoom(code: string) {
    return parseRoom(code, strings(await this.client.sendCommand(['HGETALL', this.roomKey(code)])));
  }

  async create(): Promise<Room> {
    const createdAt = new Date().toISOString();
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = newRoomCode();
      const result = await this.client.eval(createRoomScript, {
        keys: [`${this.prefix}:rooms`, this.roomKey(code)], arguments: [code, createdAt],
      });
      if (result === -1) throw new PresenceError(409, 'This deployment has reached its 500-room limit.');
      if (result === 1) return { code, createdAt, revision: 0, votes: [] };
    }
    throw new Error('Could not allocate a unique classroom code.');
  }

  async voteMany(code: string, updates: VoteUpdate[]) {
    const fields = strings(await this.client.eval(voteScript, {
      keys: [this.roomKey(code)],
      arguments: [JSON.stringify(updates.map(({ token, vote }) => ({ token, vote: { name: vote.name.trim(), seat: vote.seat } })))],
    }));
    if (fields[0] === ':missing') return undefined;
    if (fields[0] === ':full') throw new PresenceError(409, 'This room is full (1,000 people).');
    return parseRoom(code, fields);
  }
}

interface LocalRoom {
  streams: Map<string, ClassroomStream>;
  cursors: Map<string, LiveCursor>;
  dirty: Set<string>;
  online: number;
  room: Room | null;
  needsResync: Set<string>;
  ready: Promise<void>;
  refreshing: boolean;
}

export class RedisRoomEvents implements ClassroomEvents {
  store: RedisRoomStore;
  subscriber: RedisClient;
  rooms = new Map<string, LocalRoom>();
  timers = new Map<string, ReturnType<typeof setTimeout>>();
  timer: ReturnType<typeof setInterval>;
  closed = false;
  closing: Promise<void> | null = null;
  lastRefresh = Date.now();
  rotationMs: number;
  refreshMs: number;

  constructor(store: RedisRoomStore, subscriber: RedisClient, options: { rotationMs?: number; refreshMs?: number } = {}) {
    this.store = store;
    this.subscriber = subscriber;
    this.rotationMs = options.rotationMs ?? 230_000;
    this.refreshMs = options.refreshMs ?? 10_000;
    this.timer = setInterval(() => this.tick(), 100);
    this.timer.unref();
    subscriber.on('reconnecting', () => this.failStreams('Live subscription is reconnecting.'));
    subscriber.on('error', () => this.failStreams('Live subscription is unavailable.'));
  }

  failStreams(reason: string) {
    console.error(reason);
    for (const local of this.rooms.values()) for (const stream of local.streams.values()) stream.close();
  }

  async localRoom(code: string) {
    let local = this.rooms.get(code);
    if (!local) {
      local = {
        streams: new Map(), cursors: new Map(), dirty: new Set(), online: 0,
        room: null, needsResync: new Set(), ready: Promise.resolve(), refreshing: false,
      };
      this.rooms.set(code, local);
      const target = local;
      local.ready = this.subscriber.subscribe(this.store.channel(code), (message) => {
        try {
          const value = JSON.parse(message) as {
            type: 'room'; room: Room;
          } | { type: 'cursor'; id: string; cursor: string; online: number };
          if (value.type === 'room') {
            if (!target.room || value.room.revision >= target.room.revision) {
              target.room = value.room;
              for (const stream of target.streams.values()) stream.room(value.room);
            }
          } else if (value.type === 'cursor') {
            target.online = value.online;
            if (value.cursor) target.cursors.set(value.id, JSON.parse(value.cursor) as LiveCursor);
            else target.cursors.delete(value.id);
            target.dirty.add(value.id);
          } else throw new Error('Unknown classroom event.');
        } catch (error) {
          console.error('Invalid shared classroom event:', error instanceof Error ? error.message : 'Invalid event');
          for (const stream of target.streams.values()) stream.close();
        }
      }).catch((error: unknown) => {
        this.rooms.delete(code);
        throw error;
      });
    }
    await local.ready;
    return local;
  }

  snapshot(local: LocalRoom): CursorBatch {
    return { replace: true, cursors: [...local.cursors.values()], removed: [], online: local.online };
  }

  async refresh(code: string, local: LocalRoom) {
    if (local.refreshing) return;
    local.refreshing = true;
    try {
      const credentials = [...local.streams.values()].map(({ id, key }) => ({ id, key }));
      const result = await this.store.client.eval(snapshotScript, {
        keys: this.store.presenceKeys(code), arguments: [JSON.stringify(credentials)],
      });
      if (!Array.isArray(result) || result.length !== 3) throw new Error('Invalid shared presence snapshot.');
      const fields = strings(result[1]);
      const alive = new Set(strings(result[2]));
      local.online = Number(result[0]);
      local.cursors.clear();
      for (let index = 0; index < fields.length; index += 2) {
        local.cursors.set(fields[index]!, JSON.parse(fields[index + 1]!) as LiveCursor);
      }
      const room = await this.store.publicRoom(code);
      const expected = new Set(credentials.map(({ id }) => id));
      for (const stream of local.streams.values()) {
        if (expected.has(stream.id) && !alive.has(stream.id)) { stream.close(); continue; }
        if (room && (!local.room || room.revision >= local.room.revision)) stream.room(room);
        if (!stream.presence(this.snapshot(local))) local.needsResync.add(stream.id);
      }
      if (room && (!local.room || room.revision >= local.room.revision)) local.room = room;
    } finally { local.refreshing = false; }
  }

  async open(code: string, room: Room, res: ServerResponse) {
    const local = await this.localRoom(code);
    const stream = new ClassroomStream(res);
    const joined = await this.store.client.eval(joinScript, {
      keys: this.store.presenceKeys(code), arguments: [stream.id, stream.key],
    });
    if (joined === 429) throw new PresenceError(429, 'This classroom has too many live tabs. Close an extra tab and reconnect.');
    if (joined !== 1) throw new Error('The live cursor session could not be created.');
    if (res.destroyed) {
      await this.leave(code, stream);
      return;
    }
    local.streams.set(stream.id, stream);
    stream.onResync = () => {
      if (local.needsResync.delete(stream.id)) stream.presence(this.snapshot(local));
    };
    let complete: () => void = () => {};
    const lifetime = new Promise<void>((resolve) => { complete = resolve; });
    res.once('close', () => {
      local.streams.delete(stream.id);
      local.needsResync.delete(stream.id);
      clearTimeout(this.timers.get(stream.id));
      this.timers.delete(stream.id);
      if (!this.closed) {
        void this.leave(code, stream)
          .catch((error: unknown) => console.error('Cursor departure could not be saved:', error instanceof Error ? error.message : 'Redis unavailable'))
          .finally(complete);
      } else complete();
    });
    const newest = local.room && local.room.revision > room.revision ? local.room : room;
    stream.start(newest);
    try { await this.refresh(code, local); }
    catch (error) { stream.close(); throw error; }
    if (!stream.presence(this.snapshot(local))) local.needsResync.add(stream.id);
    const duration = this.rotationMs + randomInt(0, Math.max(1, Math.min(15_000, Math.floor(this.rotationMs / 10))));
    const timer = setTimeout(() => stream.close(), duration);
    timer.unref();
    this.timers.set(stream.id, timer);
    await lifetime;
  }

  async leave(code: string, stream: ClassroomStream) {
    await this.store.client.eval(leaveScript, {
      keys: this.store.presenceKeys(code), arguments: [stream.id, stream.key],
    });
  }

  async update(code: string, body: unknown) {
    if (!validPresence(body)) throw new PresenceError(400, 'The cursor update is invalid.');
    const result = await this.store.client.eval(updateCursorScript, {
      keys: this.store.presenceKeys(code),
      arguments: [body.session, body.key, body.active ? JSON.stringify(publicCursor(body)) : ''],
    });
    if (result === 403) throw new PresenceError(403, 'The live cursor session has expired. Reconnect to the classroom.');
    if (result === 429) throw new PresenceError(429, 'Cursor updates are arriving too quickly.');
    if (result !== 1) throw new Error('The live cursor update could not be saved.');
  }

  async broadcast(room: Room) {
    await this.store.client.publish(this.store.channel(room.code), JSON.stringify({ type: 'room', room }));
  }

  tick() {
    const now = Date.now();
    const refresh = now - this.lastRefresh >= this.refreshMs;
    if (refresh) this.lastRefresh = now;
    for (const [code, local] of this.rooms) {
      if (!local.streams.size) continue;
      if (local.dirty.size) {
        const batch: CursorBatch = { replace: false, cursors: [], removed: [], online: local.online };
        for (const id of local.dirty) {
          const cursor = local.cursors.get(id);
          if (cursor) batch.cursors.push(cursor);
          else batch.removed.push(id);
        }
        local.dirty.clear();
        for (const stream of local.streams.values()) {
          if (!stream.presence(batch)) local.needsResync.add(stream.id);
        }
      }
      if (refresh) {
        void this.refresh(code, local).catch((error: unknown) => {
          console.error('Shared presence refresh failed:', error instanceof Error ? error.message : 'Redis unavailable');
          for (const stream of local.streams.values()) stream.close();
        });
      }
    }
  }

  close() {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown() {
    this.closed = true;
    clearInterval(this.timer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    const pending: Promise<unknown>[] = [];
    for (const [code, local] of this.rooms) for (const stream of local.streams.values()) {
      pending.push(this.leave(code, stream));
      stream.close();
    }
    await Promise.all(pending);
    this.rooms.clear();
    if (this.subscriber.isOpen) this.subscriber.destroy();
  }
}

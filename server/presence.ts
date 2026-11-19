import type { ServerResponse } from 'node:http';
import { CURSOR_TTL_MS } from '../src/shared.ts';
import type { CursorBatch, LiveCursor, PresenceInput, Room } from '../src/shared.ts';
import { validName, validToken } from './store.ts';
import { ClassroomStream } from './stream.ts';

export const MAX_CONNECTIONS = 250;
export const CURSOR_COLORS = ['#b52e77', '#3457ce', '#287c56', '#9455bd', '#b25d17', '#077f99'];
type Awaitable<T> = T | Promise<T>;
export interface ClassroomEvents {
  open(code: string, room: Room, res: ServerResponse): Awaitable<void>;
  broadcast(room: Room): Awaitable<void>;
  update(code: string, body: unknown): Awaitable<void>;
  close(): Awaitable<void>;
}

export class PresenceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Session {
  stream: ClassroomStream;
  cursor: LiveCursor | null;
  lastSeen: number;
  lastUpdate: number;
  needsResync: boolean;
}

export function validPresence(body: unknown): body is PresenceInput {
  if (!body || typeof body !== 'object') return false;
  return 'session' in body && validToken(body.session) && 'key' in body && validToken(body.key) &&
    'name' in body && validName(body.name) && 'active' in body && typeof body.active === 'boolean' &&
    'x' in body && typeof body.x === 'number' && Number.isFinite(body.x) && body.x >= 0 && body.x <= 1 &&
    'y' in body && typeof body.y === 'number' && Number.isFinite(body.y) && body.y >= 0 && body.y <= 1 &&
    'surface' in body && (body.surface === 'page' || body.surface === '3d' || body.surface === 'map');
}

export function publicCursor(body: PresenceInput): LiveCursor {
  const index = Number.parseInt(body.session.slice(0, 4), 16) % CURSOR_COLORS.length;
  return {
    id: body.session,
    name: body.name === 'Classmate' ? `Classmate ${body.session.slice(0, 4)}` : body.name.trim(),
    color: CURSOR_COLORS[index]!,
    x: Math.round(body.x * 10_000) / 10_000,
    y: Math.round(body.y * 10_000) / 10_000,
    surface: body.surface,
  };
}

export class RoomEvents implements ClassroomEvents {
  rooms = new Map<string, Map<string, Session>>();
  dirty = new Map<string, Set<string>>();
  timer: ReturnType<typeof setInterval>;
  heartbeat = Date.now();

  constructor() {
    this.timer = setInterval(() => this.tick(), 100);
    this.timer.unref();
  }

  mark(code: string, id: string) {
    const ids = this.dirty.get(code) ?? new Set<string>();
    ids.add(id);
    this.dirty.set(code, ids);
  }

  snapshot(code: string): CursorBatch {
    const sessions = this.rooms.get(code);
    return {
      replace: true,
      cursors: [...(sessions?.values() ?? [])].flatMap((session) => session.cursor ? [session.cursor] : []),
      removed: [],
      online: sessions?.size ?? 0,
    };
  }

  open(code: string, room: Room, res: ServerResponse) {
    const sessions = this.rooms.get(code) ?? new Map<string, Session>();
    if (sessions.size >= MAX_CONNECTIONS) throw new PresenceError(429, 'This classroom has too many live tabs. Close an extra tab and reconnect.');
    const stream = new ClassroomStream(res);
    const session: Session = { stream, cursor: null, lastSeen: Date.now(), lastUpdate: 0, needsResync: false };
    sessions.set(stream.id, session);
    this.rooms.set(code, sessions);
    stream.onResync = () => {
      if (session.needsResync) {
        session.needsResync = false;
        stream.presence(this.snapshot(code));
      }
    };
    stream.start(room);
    stream.presence(this.snapshot(code));
    this.mark(code, stream.id);
    res.on('close', () => {
      sessions.delete(stream.id);
      this.mark(code, stream.id);
      if (!sessions.size) {
        this.rooms.delete(code);
        this.dirty.delete(code);
      }
    });
  }

  broadcast(room: Room) {
    for (const session of this.rooms.get(room.code)?.values() ?? []) session.stream.room(room);
  }

  update(code: string, body: unknown) {
    if (!validPresence(body)) throw new PresenceError(400, 'The cursor update is invalid.');
    const session = this.rooms.get(code)?.get(body.session);
    if (!session || session.stream.key !== body.key) throw new PresenceError(403, 'The live cursor session has expired. Reconnect to the classroom.');
    const now = Date.now();
    if (now - session.lastUpdate < 100) throw new PresenceError(429, 'Cursor updates are arriving too quickly.');
    session.lastUpdate = now;
    session.lastSeen = now;
    const next = body.active ? publicCursor(body) : null;
    if (JSON.stringify(session.cursor) !== JSON.stringify(next)) {
      session.cursor = next;
      this.mark(code, body.session);
    }
  }

  tick() {
    const now = Date.now();
    const heartbeat = now - this.heartbeat >= 15_000;
    if (heartbeat) this.heartbeat = now;
    for (const [code, sessions] of this.rooms) {
      for (const [id, session] of sessions) {
        if (session.cursor && now - session.lastSeen > CURSOR_TTL_MS) {
          session.cursor = null;
          this.mark(code, id);
        }
        if (heartbeat && !session.stream.blocked) session.stream.write(': heartbeat\n\n');
      }
      const dirty = this.dirty.get(code);
      if (!dirty?.size) continue;
      const batch: CursorBatch = { replace: false, cursors: [], removed: [], online: sessions.size };
      for (const id of dirty) {
        const cursor = sessions.get(id)?.cursor;
        if (cursor) batch.cursors.push(cursor);
        else batch.removed.push(id);
      }
      dirty.clear();
      for (const session of sessions.values()) {
        if (!session.stream.presence(batch)) session.needsResync = true;
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const sessions of this.rooms.values()) for (const session of sessions.values()) session.stream.close();
    this.rooms.clear();
    this.dirty.clear();
  }
}

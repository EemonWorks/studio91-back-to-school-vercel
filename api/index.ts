// Studio +91 seat picker: the whole server side, as one Vercel Function.
//
// There is exactly one classroom. Seats are stored in Upstash Redis, which you
// connect from the Storage tab in Vercel, so every visitor sees the same counter.
// Run locally without Upstash settings and seats are kept in memory instead.
//
// Keep this file self-contained (no imports from ../src or ../server):
// Vercel bundles each file in /api on its own.
//
//   GET  /api/health  -> is storage connected?
//   GET  /api/room    -> the classroom: { code, createdAt, revision, votes: [{ name, seat }] }
//   POST /api/vote    -> { token, name, seat }  saves or moves your seat
//   POST /api/reset   -> { key }                host only: erases every seat

import { createHash, timingSafeEqual } from 'node:crypto';

const ROOM_CODE = 'STUDIO91';
const SEAT_COUNT = 40;
const MAX_NAME_LENGTH = 32;
const MAX_VOTES = 400;
const MAX_BODY_BYTES = 4096;
const MIN_RESET_KEY_LENGTH = 12;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Every open page asks for the seats every 2 seconds. Vercel's CDN answers repeat
// requests for 2 seconds (and 2 more while it refreshes in the background), so the
// database sees about one read per second however many people are watching.
const ROOM_CACHE = 'public, max-age=0, s-maxage=2, stale-while-revalidate=2';

interface Vote { name: string; seat: number }
interface Room { code: string; createdAt: string; revision: number; votes: Vote[] }
interface StoredVote extends Vote { at: number }
type Entries = Array<[string, string]>;

interface SeatStore {
  read(): Promise<Room>;
  vote(token: string, vote: StoredVote): Promise<Room | 'full'>;
  reset(): Promise<Room>;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(status: number, body: unknown, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });
}

function parseVote(raw: string): StoredVote {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A saved seat is invalid.');
  const { name, seat, at } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || [...name].length > MAX_NAME_LENGTH ||
    typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT ||
    typeof at !== 'number' || !Number.isFinite(at)) throw new Error('A saved seat is invalid.');
  return { name, seat, at };
}

function roomFrom(voteEntries: Entries, metaEntries: Entries): Room {
  const meta = new Map(metaEntries);
  const votes = voteEntries
    .map(([, raw]) => parseVote(raw))
    .sort((a, b) => a.at - b.at)
    .map(({ name, seat }) => ({ name, seat }));
  const revision = Number(meta.get('rev') ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Saved classroom metadata is invalid.');
  return {
    code: ROOM_CODE,
    createdAt: meta.get('createdAt') ?? new Date(0).toISOString(),
    revision,
    votes,
  };
}

// Upstash answers HGETALL as a flat list: [field, value, field, value, ...].
function entries(result: unknown): Entries {
  const list: Entries = [];
  if (Array.isArray(result)) {
    if (result.length % 2 !== 0) throw new Error('Seat storage returned an invalid hash.');
    for (let index = 0; index + 1 < result.length; index += 2) {
      const field: unknown = result[index];
      const value: unknown = result[index + 1];
      if (typeof field !== 'string' || typeof value !== 'string') throw new Error('Seat storage returned an invalid field.');
      list.push([field, value]);
    }
  } else if (result && typeof result === 'object') {
    for (const [field, value] of Object.entries(result)) {
      if (typeof value !== 'string') throw new Error('Seat storage returned an invalid field.');
      list.push([field, value]);
    }
  } else throw new Error('Seat storage returned an invalid hash.');
  return list;
}

// Vercel's Upstash integration adds KV_REST_API_URL / KV_REST_API_TOKEN (or the same
// names behind a custom prefix). A database made on upstash.com uses UPSTASH_REDIS_REST_*.
function upstashSettings(): { url: string; token: string } | null {
  const env = process.env;
  const candidates: Array<[string | undefined, string | undefined]> = [
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
  ];
  for (const name of Object.keys(env)) {
    if (name.endsWith('_REST_API_URL')) candidates.push([env[name], env[`${name.slice(0, -4)}_TOKEN`]]);
  }
  for (const [url, token] of candidates) {
    if (url && token) return { url: url.replace(/\/+$/, ''), token };
  }
  return null;
}

function upstashStore(url: string, token: string): SeatStore {
  // Preview and Production keep separate seats, so testing never touches the real event.
  const prefix = `studio91:${process.env.VERCEL_ENV ?? 'local'}`;
  const votesKey = `${prefix}:votes`;
  const metaKey = `${prefix}:meta`;
  // The limit check, mutation, and snapshot must be atomic across function instances.
  const script = `
local action = ARGV[1]
if action == 'vote' and redis.call('HEXISTS', KEYS[1], ARGV[3]) == 0
  and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[5]) then return ':full' end
redis.call('HSETNX', KEYS[2], 'createdAt', ARGV[2])
if action == 'vote' then
  redis.call('HSET', KEYS[1], ARGV[3], ARGV[4])
  redis.call('HINCRBY', KEYS[2], 'rev', 1)
elseif action == 'reset' then
  redis.call('DEL', KEYS[1])
  redis.call('HINCRBY', KEYS[2], 'rev', 1)
  redis.call('HSET', KEYS[2], 'createdAt', ARGV[2])
end
return {redis.call('HGETALL', KEYS[1]), redis.call('HGETALL', KEYS[2])}
`;

  const pipeline = async (commands: Array<Array<string | number>>): Promise<unknown[]> => {
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Upstash answered HTTP ${response.status}`);
    const results: unknown = await response.json();
    if (!Array.isArray(results) || results.length !== commands.length) throw new Error('Upstash sent an unexpected reply');
    return results.map((item: unknown) => {
      if (item && typeof item === 'object' && 'error' in item && item.error) throw new Error(`Upstash: ${String(item.error)}`);
      if (!item || typeof item !== 'object' || !('result' in item)) throw new Error('Upstash sent an unexpected reply');
      return item.result;
    });
  };

  return {
    async read() {
      const [result] = await pipeline([['EVAL', script, 2, votesKey, metaKey, 'read', new Date().toISOString()]]);
      if (!Array.isArray(result) || result.length !== 2) throw new Error('Seat storage returned an invalid snapshot.');
      return roomFrom(entries(result[0]), entries(result[1]));
    },
    async vote(voter, vote) {
      const [result] = await pipeline([[
        'EVAL', script, 2, votesKey, metaKey, 'vote', new Date().toISOString(), voter, JSON.stringify(vote), MAX_VOTES,
      ]]);
      if (result === ':full') return 'full';
      if (!Array.isArray(result) || result.length !== 2) throw new Error('Seat storage returned an invalid snapshot.');
      return roomFrom(entries(result[0]), entries(result[1]));
    },
    async reset() {
      // The revision keeps counting up, so no browser mistakes the empty class for an old copy.
      const [result] = await pipeline([['EVAL', script, 2, votesKey, metaKey, 'reset', new Date().toISOString()]]);
      if (!Array.isArray(result) || result.length !== 2) throw new Error('Seat storage returned an invalid snapshot.');
      return roomFrom(entries(result[0]), entries(result[1]));
    },
  };
}

// Local development only: seats live in this process (and survive hot reloads).
interface MemoryState { votes: Map<string, StoredVote>; rev: number; createdAt: string }
const memoryHolder = globalThis as typeof globalThis & { studio91Seats?: MemoryState };

function memoryStore(): SeatStore {
  const state = memoryHolder.studio91Seats ??= { votes: new Map(), rev: 0, createdAt: new Date().toISOString() };
  const room = (): Room => ({
    code: ROOM_CODE,
    createdAt: state.createdAt,
    revision: state.rev,
    votes: [...state.votes.values()].sort((a, b) => a.at - b.at).map(({ name, seat }) => ({ name, seat })),
  });
  return {
    read: async () => room(),
    vote: async (voter, vote) => {
      if (!state.votes.has(voter) && state.votes.size >= MAX_VOTES) return 'full';
      state.votes.set(voter, vote);
      state.rev += 1;
      return room();
    },
    reset: async () => {
      state.votes.clear();
      state.rev += 1;
      state.createdAt = new Date().toISOString();
      return room();
    },
  };
}

// Second safety net next to the CDN cache: a warm server answers repeat reads from
// memory for 1.5 seconds. Saves and erases refresh it straight away.
let recent: { room: Room; at: number } | null = null;
const remember = (room: Room): Room => {
  if (recent && recent.room.revision > room.revision) return recent.room;
  recent = { room, at: Date.now() };
  return room;
};
async function readRecent(store: SeatStore): Promise<Room> {
  if (recent && Date.now() - recent.at < 1500) return recent.room;
  return remember(await store.read());
}

function storage(): { kind: 'upstash' | 'memory'; store: SeatStore } | null {
  const settings = upstashSettings();
  if (settings) return { kind: 'upstash', store: upstashStore(settings.url, settings.token) };
  // On Vercel, memory would silently split the seats between servers. Refuse instead.
  if (process.env.VERCEL) return null;
  return { kind: 'memory', store: memoryStore() };
}

// Vercel rewrites /api/room to /api?route=room; the local dev server keeps /api/room.
function routeOf(request: Request): string {
  const url = new URL(request.url);
  const path = url.searchParams.get('route') ?? url.pathname.replace(/^\/api\/?/, '');
  return path.replace(/^\/+|\/+$/g, '').toLowerCase();
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, 'That request is too large.');
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new HttpError(413, 'That request is too large.');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Fall through to the error below.
  }
  throw new HttpError(400, 'Send the request as JSON.');
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const printable = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return [...printable].slice(0, MAX_NAME_LENGTH).join('').trim();
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function onlyAllow(method: string): Response {
  const response = json(405, { error: 'That method is not allowed here.' });
  response.headers.set('Allow', method);
  return response;
}

async function handle(request: Request): Promise<Response> {
  const route = routeOf(request);
  const method = request.method.toUpperCase();
  if (!['health', 'room', 'vote', 'reset'].includes(route)) return json(404, { error: 'API endpoint not found.' });

  const connected = storage();
  if (!connected) {
    return json(503, { ok: false, error: "Seat storage isn't connected yet. In Vercel, open Storage, connect Upstash for Redis to this project, then redeploy." });
  }
  const { kind, store } = connected;

  try {
    if (route === 'health') {
      const room = await store.read();
      return json(200, {
        ok: true,
        storage: kind,
        seatsTaken: room.votes.length,
        resetEnabled: (process.env.ADMIN_RESET_KEY ?? '').trim().length >= MIN_RESET_KEY_LENGTH,
      });
    }

    if (route === 'room') {
      if (method !== 'GET') return onlyAllow('GET');
      return json(200, await readRecent(store), ROOM_CACHE);
    }

    if (route === 'vote') {
      if (method !== 'POST') return onlyAllow('POST');
      const body = await readJson(request);
      const token = typeof body.token === 'string' ? body.token.toLowerCase() : '';
      const name = cleanName(body.name);
      const seat = body.seat;
      if (!TOKEN_PATTERN.test(token)) throw new HttpError(400, 'Your browser sent an invalid seat ticket. Reload the page and try again.');
      if (!name) throw new HttpError(400, 'Add a first name or nickname first.');
      if (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) throw new HttpError(400, 'That seat does not exist.');
      const room = await store.vote(token, { name, seat, at: Date.now() });
      if (room === 'full') throw new HttpError(409, 'The classroom is full.');
      return json(200, remember(room));
    }

    // route === 'reset'
    if (method !== 'POST') return onlyAllow('POST');
    const expected = (process.env.ADMIN_RESET_KEY ?? '').trim();
    if (expected.length < MIN_RESET_KEY_LENGTH) {
      throw new HttpError(503, 'Erasing is switched off. Add ADMIN_RESET_KEY (12 or more characters) in Vercel, then redeploy.');
    }
    const body = await readJson(request);
    const given = typeof body.key === 'string' ? body.key.trim() : '';
    if (!sameSecret(given, expected)) {
      await new Promise((resolve) => setTimeout(resolve, 400)); // slows down guessing
      throw new HttpError(403, 'That passcode is not right.');
    }
    return json(200, remember(await store.reset()));
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error('Seat storage error:', error instanceof Error ? error.message : error);
    return json(503, { error: 'The classroom is busy for a moment. Please try again.' });
  }
}

export default { fetch: handle };

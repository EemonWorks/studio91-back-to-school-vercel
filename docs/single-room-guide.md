# Studio +91 Seat Picker: one-classroom version

### Step-by-step instructions for VS Code (GitHub Copilot, Agent mode)

**What you get**

- **One classroom, always open.** No "Open a classroom", no room codes. The site link is the classroom.
- **No "Masti ki paathshala" banner.** The page starts at "Where did you sit when the bell rang?". The same artwork stays on the chalkboard inside the 3D classroom.
- **11 famous visitors:** Sunny Deol, Mika Singh, Mahesh Babu, Gabbar, Manjulika, Sachin T., Stree, Anarkali, Gangubai, Piku and Donald T. Their named cursors wander the room, try desks (a cat pops up), change their minds and move on. They run in each visitor's browser and follow the same clock-based script on every screen, so two people side by side see Gabbar on the same desk. They are never saved and never counted.
- **Real people count.** A visitor picks a desk, types a nickname once, and the counter, heatmap and results update for everyone within a few seconds.
- **Hidden host tools.** A faint "···" at the bottom right opens a small menu. With your passcode, it erases every registered seat so you can start fresh for the event.
- **Vercel only.** One small Vercel Function plus a free Upstash database you add from the Vercel Storage tab. No Render, no server to keep running. `npm run dev` still works offline in VS Code.

**What goes away:** real people's live cursors (only the famous visitors float around), Render/standalone mode, and Redis Cloud.

**How this was checked:** the new server function, the local dev server, and the seat and visitor logic were type-checked with the project's strict TypeScript settings. They were also tested: saving, moving and erasing seats, wrong passcode, missing storage, Vercel-style routing, and the visitor script. The 3D-scene edits were type-checked against simplified stand-ins for the 3D library, so do the visual check in Step 10.

---

## How to use this file

1. Save this file in your project as `docs/single-room-guide.md` (create the `docs` folder).
2. In VS Code open **Copilot Chat** and switch to **Agent** mode.
3. Do **Part A** in the browser first (about 10 minutes).
4. Paste the prompts from **Part B** one at a time. Each prompt points Copilot at the exact code in this file. Run the check after each step.

Prefer one go? Paste this instead:

> Follow docs/single-room-guide.md, Part B, Steps 1 to 10, in order. Use every code block verbatim and change nothing that the guide doesn't mention. If `npm run build` fails, show me the error and fix only that.

## Before you start (2 minutes)

In the VS Code terminal:

```bash
git checkout main
git pull
git status          # should say "nothing to commit"
git checkout -b single-room
```

Working on a branch gives you a Vercel **Preview** link to test before your main site changes. If `git status` shows local edits to `src/App.tsx`, `src/Classroom.tsx` or `src/styles.css`, commit them first. Then tell Copilot to merge the guide's changes into those files rather than replacing them.

---

## Part A: Vercel setup (in the browser)

**A1. Add the free seat database**

1. Open vercel.com, then your project **studio91-back-to-school-vercel**, then the **Storage** tab.
2. Choose **Create Database** (or **Browse Marketplace**), then **Upstash**, then **Upstash for Redis**.
3. Plan: **Free**. Primary region: **Mumbai (ap-south-1)** if it's listed, otherwise **Singapore (ap-southeast-1)**. Name it `studio91-seats`.
4. When asked to connect it to the project, tick **Development, Preview and Production**. Keep the default environment-variable prefix.
5. Check **Settings → Environment Variables**. You should see `KV_REST_API_URL` and `KV_REST_API_TOKEN`. A different prefix in front of those names is fine; the code finds them.

**A2. Add your host passcode**

**Settings → Environment Variables → Add**:

- Name: `ADMIN_RESET_KEY`
- Value: a passcode only you know, at least 12 characters (three random words work well)
- Environments: **Production** and **Preview**

**A3. Leave the rest alone.** An old `REDIS_URL` variable can stay; the new code ignores it. Environment changes apply from the next deployment, and Part C triggers one.

---

## Part B: Code changes (prompts for Copilot)

### Step 1: Replace the server function

> Replace the entire contents of `api/index.ts` with "Code 1" from docs/single-room-guide.md, verbatim. This file must not import anything from ../server or ../src.

**Code 1: `api/index.ts`**

```ts
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
const MIN_RESET_KEY_LENGTH = 8;
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

function parseVote(raw: string): StoredVote | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { name, seat, at } = value as Record<string, unknown>;
    if (typeof name !== 'string' || typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return null;
    return { name: name.slice(0, MAX_NAME_LENGTH), seat, at: typeof at === 'number' ? at : 0 };
  } catch {
    return null;
  }
}

function roomFrom(voteEntries: Entries, metaEntries: Entries): Room {
  const meta = new Map(metaEntries);
  const votes = voteEntries
    .map(([, raw]) => parseVote(raw))
    .filter((vote): vote is StoredVote => vote !== null)
    .sort((a, b) => a.at - b.at)
    .map(({ name, seat }) => ({ name, seat }));
  return {
    code: ROOM_CODE,
    createdAt: meta.get('createdAt') ?? new Date(0).toISOString(),
    revision: Number(meta.get('rev') ?? 0) || 0,
    votes,
  };
}

// Upstash answers HGETALL as a flat list: [field, value, field, value, ...].
function entries(result: unknown): Entries {
  const list: Entries = [];
  if (Array.isArray(result)) {
    for (let index = 0; index + 1 < result.length; index += 2) {
      const field: unknown = result[index];
      const value: unknown = result[index + 1];
      if (typeof field === 'string' && typeof value === 'string') list.push([field, value]);
    }
  } else if (result && typeof result === 'object') {
    for (const [field, value] of Object.entries(result)) {
      if (typeof value === 'string') list.push([field, value]);
    }
  }
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

  const pipeline = async (commands: Array<Array<string | number>>): Promise<unknown[]> => {
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Upstash answered HTTP ${response.status}`);
    const results: unknown = await response.json();
    if (!Array.isArray(results)) throw new Error('Upstash sent an unexpected reply');
    return results.map((item: unknown) => {
      if (item && typeof item === 'object' && 'error' in item && item.error) throw new Error(`Upstash: ${String(item.error)}`);
      return item && typeof item === 'object' && 'result' in item ? item.result : null;
    });
  };

  return {
    async read() {
      const [votes, meta] = await pipeline([['HGETALL', votesKey], ['HGETALL', metaKey]]);
      const metaEntries = entries(meta);
      if (metaEntries.some(([field]) => field === 'createdAt')) return roomFrom(entries(votes), metaEntries);
      // Very first visit: stamp the class, so browsers can tell it apart from a later, erased one.
      const [, stamped] = await pipeline([['HSETNX', metaKey, 'createdAt', new Date().toISOString()], ['HGETALL', metaKey]]);
      return roomFrom(entries(votes), entries(stamped));
    },
    async vote(voter, vote) {
      const [exists, size] = await pipeline([['HEXISTS', votesKey, voter], ['HLEN', votesKey]]);
      if (Number(exists) !== 1 && Number(size) >= MAX_VOTES) return 'full';
      const results = await pipeline([
        ['HSETNX', metaKey, 'createdAt', new Date().toISOString()],
        ['HSET', votesKey, voter, JSON.stringify(vote)],
        ['HINCRBY', metaKey, 'rev', 1],
        ['HGETALL', votesKey],
        ['HGETALL', metaKey],
      ]);
      return roomFrom(entries(results[3]), entries(results[4]));
    },
    async reset() {
      // The revision keeps counting up, so no browser mistakes the empty class for an old copy.
      const results = await pipeline([
        ['DEL', votesKey],
        ['HINCRBY', metaKey, 'rev', 1],
        ['HSET', metaKey, 'createdAt', new Date().toISOString()],
        ['HGETALL', metaKey],
      ]);
      return roomFrom([], entries(results[3]));
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
      throw new HttpError(503, 'Erasing is switched off. Add ADMIN_RESET_KEY (8 or more characters) in Vercel, then redeploy.');
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
```

### Step 2: Project settings, one dev command, remove the old server

> Using Step 2 of docs/single-room-guide.md:
> 1. Replace `vite.config.ts` with Code 2a.
> 2. Replace `vercel.json` with Code 2b.
> 3. Replace `package.json` with Code 2c.
> 4. In `tsconfig.json`, change `"include"` to `["src", "api", "vite.config.ts"]`. Leave the compiler options as they are.
> 5. Replace `.env.example` with Code 2d. Make sure `.gitignore` has a line `.env*.local` (add it if missing).
> 6. Delete the `server/` folder, `render.yaml`, the `scripts/` folder, and the `data/` folder if it exists.
> 7. Run `npm install` so `package-lock.json` matches the new `package.json`.

Commit `package-lock.json` along with everything else. Vercel installs with `npm ci`, which fails if the two files don't match.

**Code 2a: `vite.config.ts`**

```ts
import { defineConfig, loadEnv } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Runs api/index.ts inside the Vite dev server, so `npm run dev` needs no separate backend.
// (On Vercel the same file runs as a Vercel Function.)
async function runApi(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Uint8Array);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const method = req.method ?? 'GET';
  const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? null : new Uint8Array(Buffer.concat(chunks)),
  });
  const api = await server.ssrLoadModule('/api/index.ts') as { default: { fetch: (request: Request) => Promise<Response> } };
  const response = await api.default.fetch(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function localApi(): Plugin {
  return {
    name: 'studio91-local-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) { next(); return; }
        runApi(server, req, res).catch((error: unknown) => next(error));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Lets the local API read .env.local (for example ADMIN_RESET_KEY) just like Vercel would.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[key] ??= value;
  return {
    plugins: [react(), localApi()],
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
          },
        },
      },
    },
  };
});
```

**Code 2b: `vercel.json`**

`bom1` is Vercel's Mumbai region, close to your database and your guests. If a deployment ever complains about regions, delete the `"regions"` line.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "npm ci --include=dev",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "regions": ["bom1"],
  "functions": {
    "api/index.ts": {
      "maxDuration": 10
    }
  },
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api?route=:path*" }
  ],
  "headers": [
    {
      "source": "/assets/:path*",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

**Code 2c: `package.json`**

This drops `redis` and `concurrently`, and `dev` becomes plain Vite.

```json
{
  "name": "studio91-back-to-school",
  "private": true,
  "version": "1.1.0",
  "type": "module",
  "engines": { "node": "24.x" },
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc --noEmit && vite build",
    "test": "tsc --noEmit"
  },
  "dependencies": {
    "@fontsource-variable/outfit": "^5.2.0",
    "@fontsource/patrick-hand": "^5.2.0",
    "@fontsource/schoolbell": "^5.2.0",
    "@react-three/fiber": "^9.4.0",
    "lucide-react": "^0.468.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "three": "^0.181.0"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@types/three": "^0.181.0",
    "@vitejs/plugin-react": "^5.1.0",
    "typescript": "^5.9.3",
    "vite": "^7.2.2"
  }
}
```

**Code 2d: `.env.example`**

```bash
# Local development needs none of these: seats are kept in memory.
# On Vercel, connecting "Upstash for Redis" in the Storage tab adds these two automatically.
KV_REST_API_URL=
KV_REST_API_TOKEN=
# Passcode for the hidden "Erase all seats" host tool (12+ characters recommended).
ADMIN_RESET_KEY=
```

### Step 3: Shared types

> In `src/shared.ts`, delete everything from `export type CursorSurface` down to and including `export const CURSOR_TTL_MS = 20_000;` and put Code 3 in its place. Leave the rest of the file unchanged.

**Code 3**

```ts
/** Where a seat appears inside the classroom panel, in CSS pixels from its top-left corner. */
export interface SeatPoint {
  x: number;
  y: number;
}

export type ConnectionState = 'preview' | 'connecting' | 'live' | 'offline';
/** How often each browser asks for the latest seats. */
export const POLL_INTERVAL_MS = 2000;
```

### Step 4: The famous visitors

> Create `src/classmates.ts` with Code 4a and `src/SimulatedClassmates.tsx` with Code 4b, verbatim.

To change names or colours later, edit the `CLASSMATES` list in Code 4a. Phones show the first 6 visitors; larger screens show all 11.

**Code 4a: `src/classmates.ts`**

```ts
import { COLUMNS, SEAT_COUNT } from './shared';

// Famous "visitors" who wander the classroom, try desks and change their minds.
// They only exist in each visitor's browser: never saved, never counted.
// Their moves come from the clock, so every screen shows the same visitor on
// the same desk at the same moment (give or take a second of clock drift).
export const CLASSMATES = [
  { name: 'Sunny Deol', color: '#c2410c' },
  { name: 'Mika Singh', color: '#7c3aed' },
  { name: 'Mahesh Babu', color: '#0f766e' },
  { name: 'Gabbar', color: '#9f1239' },
  { name: 'Manjulika', color: '#be185d' },
  { name: 'Sachin T.', color: '#1d4ed8' },
  { name: 'Stree', color: '#6d28d9' },
  { name: 'Anarkali', color: '#b45309' },
  { name: 'Gangubai', color: '#047857' },
  { name: 'Piku', color: '#0369a1' },
  { name: 'Donald T.', color: '#b91c1c' },
] as const;

/** Share of each beat spent walking to the next spot; the rest is spent there. */
export const TRAVEL_SHARE = 0.42;
/** The visitor's cat disappears just before they get up again. */
export const LEAVE_AT = 0.93;
const WANDER_CHANCE = 0.28; // some beats are just a stroll, not a desk
const SWITCH_CHANCE = 0.35; // "changes their mind": hops to a neighbouring desk

/** A desk to try, or a point to stroll to (fractions of the classroom panel). */
export type Spot = { seat: number } | { x: number; y: number };

/** Deterministic 0..1 noise: same inputs, same answer, on every device. */
export function noise(bot: number, beat: number, salt: number): number {
  let h = Math.imul(bot + 1, 0x9e3779b1) ^ Math.imul(beat, 0x85ebca77) ^ Math.imul(salt + 7, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Bench-mate, the next bench over, or the desk in front/behind. */
export function neighbour(seat: number, pick: number): number {
  const column = seat % COLUMNS;
  const options = [seat ^ 1];
  if (column >= 2) options.push(seat - 2);
  if (column < COLUMNS - 2) options.push(seat + 2);
  if (seat >= COLUMNS) options.push(seat - COLUMNS);
  if (seat + COLUMNS < SEAT_COUNT) options.push(seat + COLUMNS);
  return options[Math.floor(pick * options.length)] ?? seat;
}

function isStroll(bot: number, beat: number): boolean {
  return noise(bot, beat, 1) < WANDER_CHANCE;
}

function seatFor(bot: number, beat: number, depth = 0): number {
  const fresh = Math.floor(noise(bot, beat, 4) * SEAT_COUNT);
  if (depth >= 6 || isStroll(bot, beat - 1) || noise(bot, beat, 5) >= SWITCH_CHANCE) return fresh;
  return neighbour(seatFor(bot, beat - 1, depth + 1), noise(bot, beat, 6));
}

export function spotFor(bot: number, beat: number): Spot {
  if (isStroll(bot, beat)) return { x: 0.1 + noise(bot, beat, 2) * 0.8, y: 0.14 + noise(bot, beat, 3) * 0.72 };
  return { seat: seatFor(bot, beat) };
}

/** Each visitor has their own rhythm: a beat lasts 5.2 to 7.8 seconds. */
export function beatAt(bot: number, now: number): { beat: number; progress: number } {
  const period = 5200 + noise(bot, 0, 8) * 2600;
  const clock = now + noise(bot, 0, 9) * period;
  return { beat: Math.floor(clock / period), progress: (clock % period) / period };
}

/** Smooth start and stop for the walk between spots. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}
```

**Code 4b: `src/SimulatedClassmates.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { COLUMNS } from './shared';
import type { SeatPoint } from './shared';
import { CLASSMATES, LEAVE_AT, TRAVEL_SHARE, beatAt, ease, noise, spotFor } from './classmates';
import type { Spot } from './classmates';

interface Props {
  view: '3d' | 'map';
  pageRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<HTMLDivElement | null>;
  seatPoints: RefObject<SeatPoint[]>;
  /** Desks the visitors are trying right now. Shown as cats only, never counted. */
  onTrySeats: (seats: number[]) => void;
}

type Point = { x: number; y: number };

function visibleCount(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 4;
  return window.innerWidth < 700 ? 6 : CLASSMATES.length;
}

export default function SimulatedClassmates({ view, pageRef, sceneRef, seatPoints, onTrySeats }: Props) {
  const [count, setCount] = useState(visibleCount);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  const latest = useRef({ view, onTrySeats });
  latest.current = { view, onTrySeats };

  useEffect(() => {
    const update = () => setCount(visibleCount());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const started = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let reported = '';

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const page = pageRef.current;
      const scene = sceneRef.current;
      if (!page || !scene) return;
      const pageBox = page.getBoundingClientRect();
      const sceneBox = scene.getBoundingClientRect();
      const left = sceneBox.left - pageBox.left;
      const top = sceneBox.top - pageBox.top;

      // Page-relative position of a spot in whichever view is showing.
      const place = (spot: Spot): Point => {
        if (!('seat' in spot)) return { x: left + spot.x * sceneBox.width, y: top + spot.y * sceneBox.height };
        if (latest.current.view === '3d') {
          const point = seatPoints.current[spot.seat];
          if (point) return { x: left + point.x, y: top + point.y };
        } else {
          const desk = scene.querySelector<HTMLElement>(`[data-seat="${spot.seat}"]`);
          if (desk) {
            const box = desk.getBoundingClientRect();
            return { x: box.left - pageBox.left + box.width * 0.55, y: box.top - pageBox.top + box.height * 0.6 };
          }
        }
        // Classroom not drawn yet: aim roughly where the desk will be.
        const column = spot.seat % COLUMNS;
        const row = Math.floor(spot.seat / COLUMNS);
        return { x: left + (0.15 + column / (COLUMNS - 1) * 0.7) * sceneBox.width, y: top + (0.3 + row * 0.12) * sceneBox.height };
      };

      const now = Date.now();
      const elapsed = performance.now() - started;
      const trying = new Set<number>();
      const moves: Array<{ node: HTMLDivElement; x: number; y: number; shown: boolean }> = [];
      for (let bot = 0; bot < count; bot++) {
        const node = nodes.current[bot];
        if (!node) continue;
        const { beat, progress } = beatAt(bot, now);
        const target = spotFor(bot, beat);
        const from = place(spotFor(bot, beat - 1));
        const to = place(target);
        const walk = Math.min(1, progress / TRAVEL_SHARE);
        const step = ease(walk);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const bend = (noise(bot, beat, 7) - 0.5) * 90 * Math.sin(Math.PI * walk);
        let x = from.x + dx * step - (dy / length) * bend;
        let y = from.y + dy * step + (dx / length) * bend;
        if (walk >= 1 && !reduced) {
          x += Math.sin(now / 650 + bot) * 3;
          y += Math.cos(now / 830 + bot * 2) * 2;
        }
        if ('seat' in target && progress >= TRAVEL_SHARE && progress < LEAVE_AT) trying.add(target.seat);
        moves.push({ node, x, y, shown: elapsed > 300 + bot * 420 });
      }
      // Write after reading, so the browser doesn't re-measure for every visitor.
      for (const move of moves) {
        move.node.style.transform = `translate3d(${(move.x - 2).toFixed(1)}px, ${(move.y - 2).toFixed(1)}px, 0)`;
        move.node.style.opacity = move.shown ? '1' : '0';
      }
      const key = [...trying].sort((a, b) => a - b).join(',');
      if (key !== reported) {
        reported = key;
        latest.current.onTrySeats(key ? key.split(',').map(Number) : []);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      latest.current.onTrySeats([]);
    };
  }, [count, pageRef, sceneRef, seatPoints]);

  return <div className="live-cursors simulated-classmates" aria-hidden="true">
    {CLASSMATES.slice(0, count).map((mate, index) => <div key={mate.name} className="live-cursor bot-cursor"
      ref={(node) => { nodes.current[index] = node; }}>
      <svg width="20" height="25" viewBox="0 0 20 25"><path d="M2 2 17 14 10 15 7 22Z" fill={mate.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      <span style={{ background: mate.color }}>{mate.name}</span>
    </div>)}
  </div>;
}
```

### Step 5: Let the visitors' cats appear in the 3D classroom

> Apply edits 5.1 to 5.6 from docs/single-room-guide.md to `src/Classroom.tsx` exactly. Change nothing else in that file.

**5.1 Imports.** Replace

```tsx
import type { ReactNode } from 'react';
```

with

```tsx
import type { ReactNode, RefObject } from 'react';
```

and replace

```tsx
import { BENCH_COUNT, BENCH_DEPTH, BENCH_REAR_EXTENT, BENCH_WIDTH, ROWS, SEATS_PER_BENCH, benchPosition, groupFor, rowDepth } from './shared';
```

with

```tsx
import { BENCH_COUNT, BENCH_DEPTH, BENCH_REAR_EXTENT, BENCH_WIDTH, ROWS, SEAT_COUNT, SEATS_PER_BENCH, benchPosition, groupFor, rowDepth } from './shared';
import type { SeatPoint } from './shared';
```

**5.2 Props.** In `interface Props`, add these two lines right after `heatmap: boolean;`

```tsx
  botSeats: number[];
  seatPoints: RefObject<SeatPoint[]>;
```

**5.3 SeatZone.** Replace the first two lines of `function SeatZone`

```tsx
function SeatZone({ seat, count, selected, heatmap, maximum, onSelect, onHover }: {
  seat: number; count: number; selected: boolean; heatmap: boolean; maximum: number;
```

with

```tsx
function SeatZone({ seat, count, selected, heatmap, botTrying, maximum, onSelect, onHover }: {
  seat: number; count: number; selected: boolean; heatmap: boolean; botTrying: boolean; maximum: number;
```

Inside `SeatZone`, change `{(selected || hovered || (heatmap && count > 0)) && <mesh` to `{(selected || hovered || botTrying || (heatmap && count > 0)) && <mesh`.

Then change `{(count > 0 || selected) && <CatMarker` to `{(count > 0 || selected || botTrying) && <CatMarker`.

**5.4 BenchDesk.** Replace the first two lines of `function BenchDesk`

```tsx
function BenchDesk({ bench, counts, selected, heatmap, maximum, topGeometry, onSelect, onHover }: {
  bench: number; counts: number[]; selected: number | null; heatmap: boolean; maximum: number;
```

with

```tsx
function BenchDesk({ bench, counts, selected, heatmap, botSeats, maximum, topGeometry, onSelect, onHover }: {
  bench: number; counts: number[]; selected: number | null; heatmap: boolean; botSeats: number[]; maximum: number;
```

and, where `BenchDesk` renders `<SeatZone ...>`, replace

```tsx
      selected={selected === firstSeat + side} heatmap={heatmap} maximum={maximum}
```

with

```tsx
      selected={selected === firstSeat + side} heatmap={heatmap}
      botTrying={botSeats.includes(firstSeat + side)} maximum={maximum}
```

**5.5 New component.** Add this right above `function CameraControls(`

```tsx
// Works out where each desk appears on screen, so the famous visitors can
// point at the right desk however the classroom is rotated or zoomed.
function SeatProjector({ seatPoints }: { seatPoints: Props['seatPoints'] }) {
  const { camera, size } = useThree();
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const [x, y, z] = benchPosition(Math.floor(seat / SEATS_PER_BENCH));
      const side = seat % SEATS_PER_BENCH === 0 ? -1 : 1;
      // Desk-top centre of this seat (the scene is lowered by 0.5).
      point.set(x + side * BENCH_WIDTH / 4, y + 0.7, z + 0.15).project(camera);
      seatPoints.current[seat] = { x: (point.x + 1) / 2 * size.width, y: (1 - point.y) / 2 * size.height };
    }
  });
  return null;
}
```

**5.6 Scene.** In `function Scene`, add `<SeatProjector seatPoints={props.seatPoints} />` on the line right after `<CameraControls reset={props.reset} zoom={props.zoom} onUnavailable={props.onUnavailable} />`. Then, in the `<BenchDesk ...>` it renders, replace

```tsx
        heatmap={props.heatmap} maximum={maximum} topGeometry={top}
```

with

```tsx
        heatmap={props.heatmap} botSeats={props.botSeats} maximum={maximum} topGeometry={top}
```

### Step 6: Hidden host tools

> Create `src/HostTools.tsx` with Code 6, verbatim.

**Code 6: `src/HostTools.tsx`**

```tsx
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';

// A quiet "···" menu in the footer for the host. Erasing needs the passcode
// saved as ADMIN_RESET_KEY in Vercel, so guests can't wipe the classroom.
export default function HostTools({ onErase }: { onErase: (passcode: string) => Promise<void> }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const erase = async (event: FormEvent) => {
    event.preventDefault();
    const key = passcode.trim();
    if (!key || busy) return;
    if (!window.confirm('Erase every seat for everyone? Use this before your event starts. It cannot be undone.')) return;
    setBusy(true);
    setMessage('');
    try {
      await onErase(key);
      setPasscode('');
      if (menu.current) menu.current.open = false;
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : 'The seats could not be erased. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <details className="host-tools" ref={menu}>
    <summary aria-label="Host tools" title="Host tools">···</summary>
    <form onSubmit={(event) => void erase(event)}>
      <b>Host tools</b>
      <label htmlFor="host-passcode">Passcode</label>
      <input id="host-passcode" type="password" autoComplete="off" value={passcode}
        onChange={(event) => setPasscode(event.target.value)} />
      <button className="button small danger" disabled={busy || !passcode.trim()}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Erase all seats
      </button>
      {message && <p role="alert">{message}</p>}
      <small>Clears every registered seat for everyone. The famous visitors stay.</small>
    </form>
  </details>;
}
```

### Step 7: The page

> Replace the entire contents of `src/App.tsx` with Code 7, verbatim. Then delete `src/LivePresence.tsx`.

What changes in `App.tsx`:

- **Loading:** there is no create/join flow. The page loads the one classroom from `/api/room` and checks for new seats every 2 seconds. It pauses in background tabs and backs off if the network drops. Old `?room=ABC123` links still work and simply land in the classroom.
- **Header and sidebar:** "Invite classmates" always copies the plain site link. The "Open a classroom" and "Have a room code?" buttons are gone.
- **Banner:** the Masti ki paathshala banner section is removed. Its heading stays for screen readers.
- **Your seat:** it's remembered per class. When you erase the class, everyone's old pick is forgotten.
- **Famous visitors:** their trial desks show cats in 3D and on the seat map. They never touch counts, the heatmap, results or the CSV.
- **How it works:** the text is updated, including a line saying "Gabbar, Piku and friends are only visiting". Delete that `<p>` if you'd rather keep the illusion.
- **Results:** the CSV is saved as `studio91-seating-YYYY-MM-DD.csv`.

**Code 7: `src/App.tsx`**

```tsx
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowRight, Armchair, BookOpen, Cat, Check, CircleHelp,
  Download, Grid2X2, Link, LoaderCircle, Minus, MousePointer2,
  Plus, RotateCcw, School, Share2, Sparkles, Users, X,
} from 'lucide-react';
import {
  BENCHES_PER_ROW, COLUMNS, GROUPS, POLL_INTERVAL_MS, ROWS, SEAT_COUNT, SEATS_PER_BENCH,
  groupFor, newestSnapshot, pencilPose, rowFor, seatLabel, summarize,
} from './shared';
import type { ConnectionState, Room, SeatPoint } from './shared';
import Doodle from './Doodle';
import HostTools from './HostTools';
import SimulatedClassmates from './SimulatedClassmates';

const Classroom = lazy(() => import('./Classroom'));
const emptyVotes: Room['votes'] = [];
type Modal = 'results' | 'help' | 'name' | null;
type Profile = { token: string; name: string };
type SavedSeat = { epoch: string; seat: number };
const PROFILE_KEY = 'studio91.profile';
const SEAT_KEY = 'studio91.seat';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, body === undefined ? { signal: signal ?? null } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ?? null,
    });
  } catch {
    throw new Error('Cannot reach the classroom. Check your connection and try again.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('The classroom is not reachable right now. Please reload in a moment.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The classroom is unavailable. Try again.');
  return result as T;
}

// The seat you picked is remembered per "class" (the room's createdAt). When the
// host erases all seats, createdAt changes and everyone's old pick is forgotten.
function readSavedSeat(): SavedSeat | null {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'epoch' in value && typeof value.epoch === 'string' &&
      'seat' in value && typeof value.seat === 'number' && Number.isInteger(value.seat) &&
      value.seat >= 0 && value.seat < SEAT_COUNT) return { epoch: value.epoch, seat: value.seat };
  } catch {
    // Storage blocked or the saved value is broken: behave as if nothing was saved.
  }
  return null;
}

function forgetSavedSeat() {
  try { localStorage.removeItem(SEAT_KEY); } catch { /* storage blocked */ }
}

function ModalShell({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="modal-heading">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
    <h2 id="modal-heading">{title}</h2>
    {children}
  </dialog>;
}

function MicrosoftMark() {
  return <span className="ms-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function SeatMap({ counts, selected, heatmap, botSeats, onSelect }: {
  counts: number[]; selected: number | null; heatmap: boolean; botSeats: number[]; onSelect: (seat: number) => void;
}) {
  const max = Math.max(1, ...counts);
  return <div className="seat-map">
    <div className="map-board">
      <Doodle kind="hearts" medium="chalk" className="map-board-hearts" />
      <span>Welcome back, class of you.</span><small>CHALKBOARD / FRONT OF CLASS</small>
      <img className="map-board-star" src={`${import.meta.env.BASE_URL}visuals/chalk-star.webp`} alt="" aria-hidden="true" />
    </div>
    {Array.from({ length: ROWS }, (_, row) => <div className="map-row" key={row}>
      <span className="row-label">{String.fromCharCode(65 + row)}</span>
      {Array.from({ length: BENCHES_PER_ROW }, (_, bench) => {
        const firstSeat = row * COLUMNS + bench * SEATS_PER_BENCH;
        const pencilCount = (counts[firstSeat] ?? 0) + (counts[firstSeat + 1] ?? 0);
        return <div className={`map-bench bench-group-${groupFor(firstSeat)}`} key={bench} data-pencil-count={pencilCount}
          role="group" aria-label={`Two-person bench ${seatLabel(firstSeat)} and ${seatLabel(firstSeat + 1)}`}>
          {pencilCount > 0 && <div className="map-mound" aria-hidden="true">
            {Array.from({ length: pencilCount }, (_, index) => {
              const pose = pencilPose(index, pencilCount);
              return <i className="map-pencil" key={index} style={{ transform: `translate(${pose.z * 50 - 14}px, ${-(pose.y - 1.21) * 22}px) rotate(${pose.angle * 180 / Math.PI}deg)` }} />;
            })}
          </div>}
          {Array.from({ length: SEATS_PER_BENCH }, (_, side) => {
            const seat = firstSeat + side;
            const count = counts[seat] ?? 0;
            const visitorHere = botSeats.includes(seat);
            return <button key={seat} data-seat={seat}
              className={`map-desk ${selected === seat ? 'selected' : ''} ${visitorHere ? 'bot-hover' : ''}`}
              style={heatmap && count ? { background: `color-mix(in srgb, #e7337f ${30 + count / max * 70}%, #fff3a0)` } : undefined}
              aria-label={`Seat ${seatLabel(seat)}, row ${row + 1}, ${count} ${count === 1 ? 'person' : 'people'}`}
              aria-pressed={selected === seat} onClick={() => onSelect(seat)}>
              <span>{seatLabel(seat)}</span>{(count > 0 || selected === seat || visitorHere) && <Cat className={`map-cat ${selected === seat ? 'your-cat' : ''}`} size={18} />}
              {count > 0 && <b>{count}</b>}
            </button>;
          })}
        </div>;
      })}
    </div>)}
    <div className="map-back">20 BENCHES / 40 SEATS / ONE CLASS <Sparkles size={12} /></div>
  </div>;
}

function ResultsChart({ votes, large = false }: { votes: Room['votes']; large?: boolean }) {
  const { counts, total } = summarize(votes);
  return <div className={`results-chart ${large ? 'large' : ''}`}>
    {GROUPS.map((group, i) => {
      const count = counts[i] ?? 0;
      const percent = total ? Math.round(count / total * 100) : 0;
      return <div className="chart-row" key={group.name}>
        <div className="chart-label"><span><i style={{ background: group.color }} />{large ? group.name : group.short}</span><b>{count}<small>{large ? ` / ${percent}%` : ''}</small></b></div>
        <div className="chart-track"><div style={{ width: `${percent}%`, background: group.color }} /></div>
        {large && <p>{group.note} <span>Rows {i === 0 ? '1-2' : i === 1 ? '3' : '4-5'}</span></p>}
      </div>;
    })}
  </div>;
}

export default function App() {
  const [room, setRoom] = useState<Room | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [pendingSeat, setPendingSeat] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [botSeats, setBotSeats] = useState<number[]>([]);
  const [view, setView] = useState<'3d' | 'map'>('3d');
  const [heatmap, setHeatmap] = useState(false);
  const [reset, setReset] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const { counts, seats, total } = summarize(room?.votes ?? emptyVotes);
  const voteLock = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const seatPoints = useRef<SeatPoint[]>([]);
  const inviteLink = `${location.origin}${location.pathname}`;
  const receiveRoom = useCallback((next: Room) => {
    setRoom((current) => newestSnapshot(current, next));
  }, []);

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Old invite links (?room=ABC123) still work: they just land in the one classroom.
  useEffect(() => {
    if (!location.search) return;
    history.replaceState(null, '', location.pathname);
  }, []);

  // Remember who this browser is (first name + private seat ticket).
  useEffect(() => {
    let raw: string | null;
    try {
      raw = localStorage.getItem(PROFILE_KEY);
    } catch (issue) {
      console.warn('Browser storage is unavailable:', issue);
      notify('Browser storage is unavailable. Keep this tab open to retain your identity.');
      return;
    }
    if (!raw) return;
    try {
      const saved: unknown = JSON.parse(raw);
      if (saved && typeof saved === 'object' && 'token' in saved && typeof saved.token === 'string' &&
        'name' in saved && typeof saved.name === 'string') {
        setProfile({ token: saved.token, name: saved.name });
        setName(saved.name);
        return;
      }
    } catch {
      // Broken value: forget it below.
    }
    try { localStorage.removeItem(PROFILE_KEY); } catch { /* storage blocked */ }
  }, [notify]);

  // Show your saved seat, unless the host has erased the class since you picked it.
  const epoch = room?.createdAt;
  useEffect(() => {
    if (!epoch) return;
    const saved = readSavedSeat();
    if (saved && saved.epoch === epoch) {
      setSelected(saved.seat);
    } else {
      setSelected(null);
      if (saved) forgetSavedSeat();
    }
  }, [epoch]);

  // Load the classroom, then check for new seats every couple of seconds.
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || inFlight) return;
      if (document.hidden) {
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        return;
      }
      inFlight = true;
      try {
        receiveRoom(await request<Room>('/api/room', undefined, controller.signal));
        failures = 0;
        setConnection('live');
        setLoadError('');
      } catch (issue) {
        if (stopped) return;
        failures += 1;
        setConnection(failures > 1 ? 'offline' : 'connecting');
        setLoadError(errorMessage(issue));
      } finally {
        inFlight = false;
        if (!stopped) {
          const wait = failures ? Math.min(15_000, POLL_INTERVAL_MS * 2 ** failures) : POLL_INTERVAL_MS;
          timer = setTimeout(() => void poll(), wait);
        }
      }
    };
    const wake = () => { if (!document.hidden) void poll(); };
    void poll();
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [receiveRoom]);

  const openModal = (next: Modal) => { setError(''); setModal(next); };

  const saveVote = async (seat: number, voter: Profile) => {
    if (!room || voteLock.current) return;
    voteLock.current = true;
    setBusy(true); setError('');
    try {
      const next = await request<Room>('/api/vote', { ...voter, seat });
      let stored = true;
      try {
        const saved: SavedSeat = { epoch: next.createdAt, seat };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(voter));
        localStorage.setItem(SEAT_KEY, JSON.stringify(saved));
      } catch (issue) {
        stored = false;
        console.warn('Could not retain participant identity:', issue);
        notify('Seat saved! Browser storage is unavailable; keep this tab open to avoid voting twice.');
      }
      receiveRoom(next);
      setSelected(seat); setProfile(voter); setModal(null); setPendingSeat(null);
      if (stored) notify(`Seat ${seatLabel(seat)} is yours. ${GROUPS[groupFor(seat)]!.name}, assemble!`);
    } catch (issue) { setError(errorMessage(issue)); }
    finally { setBusy(false); voteLock.current = false; }
  };

  const chooseSeat = (seat: number) => {
    if (busy) return;
    setHovered(null);
    document.body.style.cursor = '';
    if (!room) {
      notify('Hang on, the classroom is still opening.');
    } else if (!profile) {
      setPendingSeat(seat);
      openModal('name');
    } else void saveVote(seat, profile);
  };
  const submitName = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pendingSeat === null) return;
    // crypto.randomUUID is unavailable on non-HTTPS LAN addresses.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    const token = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    void saveVote(pendingSeat, { token, name: name.trim() });
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      notify('Invite link copied. Pass it around!');
    } catch (issue) {
      console.warn('Clipboard permission unavailable:', issue);
      openModal('help');
      setError('Clipboard is unavailable. Copy the invite link below instead.');
    }
  };
  const downloadResults = () => {
    if (!room) return;
    // Aggregate-only export avoids spreadsheet formulas and disclosing guest names.
    const csv = ['Group,Rows,People,Percentage', ...GROUPS.map((g, i) =>
      `${g.name},${i === 0 ? '1-2' : i === 1 ? '3' : '4-5'},${counts[i]},${total ? ((counts[i] ?? 0) / total * 100).toFixed(1) : 0}`)].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `studio91-seating-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Host-only: wipes every registered seat (needs the ADMIN_RESET_KEY passcode).
  const eraseAllSeats = useCallback(async (passcode: string) => {
    const next = await request<Room>('/api/reset', { key: passcode });
    forgetSavedSeat();
    setSelected(null);
    setPendingSeat(null);
    receiveRoom(next);
    notify('All seats erased. The classroom is fresh for your event.');
  }, [notify, receiveRoom]);
  const unavailable = useCallback(() => {
    setView('map');
    notify('3D is unavailable on this device. The interactive seat map is ready instead.');
  }, [notify]);

  const leaders = total ? GROUPS.filter((_, i) => counts[i] === Math.max(...counts)) : [];
  const hoveredPeople = hovered === null ? [] : (room?.votes ?? []).filter((v) => v.seat === hovered);

  return <div className="app-shell" ref={pageRef}>
    <header className="site-header">
      <a className="brand" href={location.pathname} aria-label="Seat picker by Studio +91 home">
        <img className="brand-studio" src={`${import.meta.env.BASE_URL}branding/studio-plus91.webp`}
          alt="studio +91" width={216} height={101} />
        <span className="brand-wordmark">seat picker<span className="brand-period">.</span></span>
      </a>
      <div className="header-middle"><span className="tiny-star">✳</span> A LITTLE NOSTALGIA. A LOT OF US.</div>
      <nav aria-label="Classroom actions">
        <button className="text-button how-button" onClick={() => openModal('help')}><CircleHelp size={15} /> How it works</button>
        <button className="button small invite-button" onClick={() => void copyInvite()}><Share2 size={15} /> Invite classmates</button>
      </nav>
    </header>

    <main>
      <section className="welcome-notes" aria-labelledby="home-title">
        <div className="welcome-copy">
          <h1 className="sr-only" id="home-title">Back to school. Back to your seat.</h1>
          <div className="eyebrow"><span className="eyebrow-line" /> STUDIO +91 HOMECOMING <span className="edition">VOL. 01</span></div>
          <h2>Where did you sit when the bell rang?</h2>
          <p>New faces. Old habits. Find your old spot, and meet your classmates.</p>
        </div>
        <div className="intro-note"><Doodle kind="flower" /><span>No right answers.<br />Just your old spot.</span><Doodle kind="plane" /></div>
      </section>

      <div className="workspace">
        <section className="classroom-card" aria-label="Choose a classroom seat">
          <div className="scene-top">
            <div className="classroom-caption"><span className="caption-dot" /><span>THE MEMORY ROOM<small>20 benches. 40 old spots.</small></span></div>
            <div className="view-tabs" role="tablist" aria-label="Classroom view">
              <button role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}><School size={14} /> 3D classroom</button>
              <button role="tab" aria-selected={view === 'map'} className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><Grid2X2 size={14} /> Seat map</button>
            </div>
          </div>
          <div className={`scene-area ${busy ? 'saving' : ''}`} ref={sceneRef}>
            {view === '3d' ? <Suspense fallback={<div className="scene-loader"><LoaderCircle className="spin" />Opening the classroom...</div>}>
              <Classroom counts={seats} selected={selected} heatmap={heatmap} botSeats={botSeats} seatPoints={seatPoints}
                onSelect={chooseSeat} onHover={setHovered} reset={reset} zoom={zoom} onUnavailable={unavailable} />
            </Suspense> : <SeatMap counts={seats} selected={selected} heatmap={heatmap} botSeats={botSeats} onSelect={chooseSeat} />}
            {hovered !== null && view === '3d' && <div className="seat-tooltip">
              <Armchair size={16} /><b>Seat {seatLabel(hovered)}</b><span>Row {rowFor(hovered) + 1}</span>
              <small>{hoveredPeople.length ? `${hoveredPeople.length} ${hoveredPeople.length === 1 ? 'classmate' : 'classmates'} chose this spot` : 'One shared bench. Your own old spot.'}</small>
            </div>}
            {view === '3d' && <div className="scene-sticker"><span>CLASS OF</span><b>good<br />old days!</b><Sparkles size={15} /></div>}
            <span className="sr-only classroom-markers" aria-live="polite">{total} pencils across the desks. A cat marks each chosen spot; your cat is golden.</span>
            {view === '3d' && <div className="camera-controls">
              <button onClick={() => setZoom((z) => z + 1)} aria-label="Zoom in"><Plus size={16} /></button>
              <button onClick={() => setZoom((z) => z - 1)} aria-label="Zoom out"><Minus size={16} /></button>
              <span />
              <button onClick={() => setReset((r) => r + 1)} aria-label="Reset classroom view"><RotateCcw size={15} /></button>
            </div>}
          </div>
          <div className="scene-bottom">
            <span><MousePointer2 size={14} /> {view === '3d' ? 'Drag to explore' : 'Pick your bench'}<i />Click your side to sit</span>
            <button className={`heatmap-toggle ${heatmap ? 'on' : ''}`} aria-pressed={heatmap} onClick={() => setHeatmap(!heatmap)}>
              <span className="toggle-switch"><i /></span> Seat heatmap
            </button>
          </div>
        </section>

        <aside className="sidebar">
          <section className="seat-card">
            <div className="card-kicker"><span><Armchair size={15} /> TAKE A SEAT</span><span className="step-badge">01</span></div>
            <div className="ticket-icon"><Armchair size={28} strokeWidth={1.5} /><span>✦</span></div>
            <h2>{selected === null ? 'Somewhere in here,\nyou were you.' : `Hey ${profile?.name ?? 'classmate'},\nwelcome back.`}</h2>
            <p>{selected === null ? 'First to raise your hand? Or the unofficial mayor of the back row?' : `Seat ${seatLabel(selected)}. Row ${rowFor(selected) + 1}. A little older, still the same you.`}</p>
            {!room ? (loadError
              ? <p className="inline-error" role="alert">{loadError}</p>
              : <div className="pick-prompt">Opening the classroom... <LoaderCircle className="spin" size={15} /></div>)
              : selected === null ? <div className="pick-prompt"><span className="pulse-ring" />Pick your side of a bench to join <ArrowRight size={15} /></div>
              : <div className="chosen-seat"><span><Check size={16} /> {GROUPS[groupFor(selected)]!.name}</span><small>Change your mind? Click another desk.</small></div>}
            <div className="ticket-tear"><span /><i /><span /></div>
            <div className="seat-footnote"><Users size={13} />Two per bench. Shared seat choices welcome.</div>
            <Doodle kind="hearts" className="ticket-hearts" />
          </section>

          <section className="pulse-card">
            <div className="pulse-heading"><h3>The class so far</h3><span className={`live-badge ${connection}`}><i />{connection === 'live' ? 'LIVE' : connection === 'offline' ? 'RECONNECTING' : connection === 'connecting' ? 'CONNECTING' : 'PREVIEW'}</span></div>
            <div className="attendance"><b>{String(total).padStart(2, '0')}</b><span>familiar souls<br />{total === 1 ? 'has' : 'have'} found a seat</span><Users size={26} strokeWidth={1.3} /></div>
            <ResultsChart votes={room?.votes ?? emptyVotes} />
            <button className="results-link" disabled={!total} onClick={() => openModal('results')}>Discover our seating story <ArrowRight size={16} /></button>
          </section>
          {connection === 'offline' && room && <p role="status" className="connection-warning">Connection lost. Reconnecting automatically; results may be out of date.</p>}
          {error && !modal && <p className="inline-error" role="alert">{error}</p>}
        </aside>
      </div>

      <section className="row-stories" aria-label="Every row has a personality">
        <div className="row-stories-intro"><span className="eyebrow">EVERY ROW HAS A STORY</span><h2>Which one was yours?</h2></div>
        {GROUPS.map((group, i) => <div className={`row-story story-${i}`} key={group.name}>
          <span className="story-number">0{i + 1}</span><div><h3>{group.name}</h3><p>{group.note}</p></div>
          {i === 0 ? <BookOpen size={25} strokeWidth={1.3} /> : i === 1 ? <Armchair size={25} strokeWidth={1.3} /> : <Sparkles size={25} strokeWidth={1.3} />}
        </div>)}
      </section>
      <div className="bottom-note"><Doodle kind="sun" /><div><span>PSST... THE DESK IS JUST THE BEGINNING.</span><p>Turns out, we might have more in common than we think.</p></div><Doodle kind="plane" /></div>
    </main>
    <footer>
      <span><MicrosoftMark /> A little play, by <b>Studio +91</b></span>
      <span>Made for connection. Not for report cards. <span className="footer-spark">✳</span></span>
      <HostTools onErase={eraseAllSeats} />
    </footer>

    {modal && <ModalShell title={modal === 'name' ? 'First, a little introduction.' : modal === 'results' ? 'So, where did we all sit?' : 'A trip down memory lane.'}
      wide={modal === 'results'} onClose={() => { if (!busy) { setModal(null); setError(''); } }}>
      {modal === 'name' && <form onSubmit={submitName}>
        <div className="name-seat-preview"><Armchair size={28} /><span>Seat {pendingSeat === null ? '' : seatLabel(pendingSeat)}<small>Your new-old spot.</small></span></div>
        <label htmlFor="guest-name">What should we call you?</label>
        <input id="guest-name" autoFocus autoComplete="given-name" maxLength={32} required placeholder="First name or nickname" value={name} onChange={(event) => setName(event.target.value)} />
        <p className="privacy-note">Your name and seat choice are visible to everyone with the link. No email, no account, no report card.</p>
        <button className="button full" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Armchair size={17} />} That's my seat</button>
      </form>}
      {modal === 'results' && <>
        <div className="results-headline"><span className="results-total">{total}</span><div><b>different people.<br />A few familiar patterns.</b><p>Updating live</p></div><Sparkles size={36} strokeWidth={1.2} /></div>
        <div className="winning-note">{leaders.length === 1 ? <><b>{leaders[0]?.name}</b> are running this classroom.</> : <>It's a tie between <b>{leaders.map((g) => g.name).join(' & ')}</b>.</>}</div>
        <ResultsChart votes={room?.votes ?? emptyVotes} large />
        <div className="result-heatmap"><h3>A little map of us</h3><div className="mini-grid">
          {Array.from({ length: ROWS }, (_, row) => <div className="mini-row" key={row}>
            {Array.from({ length: BENCHES_PER_ROW }, (_, bench) => <div className="mini-bench" key={bench}>
              {Array.from({ length: SEATS_PER_BENCH }, (_, side) => {
                const seat = row * COLUMNS + bench * SEATS_PER_BENCH + side;
                const count = seats[seat] ?? 0;
                return <span key={seat} style={{ opacity: count ? 0.3 + count / Math.max(...seats) * 0.7 : 1, background: count ? GROUPS[groupFor(seat)]!.color : '#e3e5ee' }}
                  title={`Seat ${seatLabel(seat)}: ${count} ${count === 1 ? 'person' : 'people'}`}>{count || ''}</span>;
              })}
            </div>)}
          </div>)}
        </div><small>Front of class ↑ · Two spots per bench · Darker means more classmates</small></div>
        <div className="modal-actions"><span>{new Set((room?.votes ?? []).map((v) => v.seat)).size} of 40 seats chosen</span><button className="button small" onClick={downloadResults}><Download size={15} /> Save results</button></div>
      </>}
      {modal === 'help' && <>
        <p>A tiny classroom for a big reunion. Here's how to play.</p>
        <ol className="how-steps"><li><span>1</span><div><b>Open the link.</b><p>Everyone lands in the same classroom. No codes, no sign-ups.</p></div></li><li><span>2</span><div><b>Find your old spot.</b><p>Choose your side of a bench and enter a first name. A golden cat marks your spot. Everyone adds one big pencil to their desk; shared choices build a pencil mountain. Moving seats moves your pencil, too.</p></div></li><li><span>3</span><div><b>See what connects you.</b><p>Reveal the seating story: front rows 1-2, middle row 3, back rows 4-5. Backbench scribbles included. Everyone is welcome, even if all 200 choose the same desk!</p></div></li></ol>
        <p className="privacy-note">Psst... Gabbar, Piku and friends are only visiting. Only real classmates are counted.</p>
        <div className="share-box"><label htmlFor="invite-link"><Link size={14} /> Your classroom invite</label><input id="invite-link" readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></div>
        <p className="privacy-note">Names and choices are visible to everyone with the link and saved on the server. One seat per browser, not verified per person. Keep the link within your group.</p>
      </>}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </ModalShell>}
    <SimulatedClassmates view={view} pageRef={pageRef} sceneRef={sceneRef} seatPoints={seatPoints} onTrySeats={setBotSeats} />
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    <span className="sr-only" aria-live="polite">{busy ? 'Saving, please wait.' : ''}</span>
  </div>;
}
```

### Step 8: Styles

> Apply edits 8.1 to 8.5 from docs/single-room-guide.md to `src/styles.css` exactly.

- **8.1** Delete these two lines (the banner):

  ```css
  .intro { position: relative; max-width: 1100px; margin: 30px auto 34px; color: #fff8e6; font-family: var(--chalk); border-radius: 3px; box-shadow: 0 5px 13px #66563720; }
  .board-artwork { display: block; width: 100%; height: auto; border-radius: inherit; }
  ```

- **8.2** In the `.welcome-notes { ... }` rule, change `margin: 0 0 34px;` to `margin: 34px 0;` so the page breathes below the header.
- **8.3** Inside `@media (max-width: 600px)`, delete `.intro { margin: 22px 0; }`. Then change `.welcome-notes { margin-bottom: 26px; padding: 0; }` to `.welcome-notes { margin: 24px 0 26px; padding: 0; }`.
- **8.4** Delete the three rules that start with `.presence-status {`, `.presence-status svg {` and `.presence-warning {`. They styled the old "N classmates here" pill.
- **8.5** Add Code 8 at the very end of the file.

**Code 8: append to `src/styles.css`**

```css
/* ---------- One-classroom additions ---------- */
/* Famous visitors: same look as the live cursors, moved every frame by script. */
.bot-cursor { opacity: 0; transition: opacity .6s ease; }
.map-desk.bot-hover { background: #ffffff66; }

/* Hidden host tools: the faint "···" at the bottom right */
footer > span:nth-child(2) { margin-left: auto; }
.host-tools { position: relative; }
.host-tools > summary { list-style: none; cursor: pointer; user-select: none; color: #b3b5c2; font-size: 18px; line-height: 1; letter-spacing: 2px; padding: 4px 8px 8px; border-radius: 4px; }
.host-tools > summary::-webkit-details-marker { display: none; }
.host-tools > summary:hover, .host-tools[open] > summary { color: var(--ink); background: #ececf4; }
.host-tools > summary:focus-visible { outline: 3px solid #3659d9; outline-offset: 2px; }
.host-tools > form { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 60; width: 260px; display: flex; flex-direction: column; gap: 8px; padding: 14px; background: #fffef9; border: 1.5px solid var(--ink); border-radius: 7px; box-shadow: 3px 3px 0 #20202b33; color: var(--ink); font-size: 13px; text-align: left; }
.host-tools b { font-size: 15px; font-weight: 600; }
.host-tools label { font-size: 13px; }
.host-tools input { height: 38px; border: 1.5px solid #8a8b9b; border-radius: 6px; background: white; color: var(--ink); padding: 0 10px; font-size: 15px; }
.host-tools .button.danger { background: #a8324a; border-color: #a8324a; }
.host-tools .button.danger:hover:not(:disabled) { background: #8c2238; }
.host-tools p { margin: 0; font-size: 12px; color: #9c2c32; }
.host-tools small { font-size: 11px; color: #6b6f86; line-height: 1.4; }

@media (max-width: 600px) {
  footer > .host-tools { align-self: flex-end; }
  .host-tools > form { width: min(260px, calc(100vw - 32px)); }
}
```

### Step 9: README

> In `README.md`, replace every section about Redis, Render, standalone mode, room codes and deployment with Code 9. Keep the project introduction at the top.

**Code 9: README sections**

````markdown
## How it works

- One classroom, always open. Share the site link; there are no room codes.
- Visitors pick a desk and a nickname. The counter, heatmap and results update for everyone within a few seconds.
- Eleven famous "visitors" (Sunny Deol, Gabbar, Piku and friends) wander the room and try desks for fun. They run in each browser and are never saved or counted.
- Hidden host tools: the faint "···" at the bottom right erases every seat. It needs the `ADMIN_RESET_KEY` passcode.

## Run locally

```bash
npm install
npm run dev     # http://localhost:5173, seats kept in memory
```

Optional: put `ADMIN_RESET_KEY=some-local-passcode` in `.env.local` to try the host tools.

## Deploy on Vercel

1. In the Vercel project, open Storage and add **Upstash for Redis** (Free). Connect it to Development, Preview and Production.
2. Settings → Environment Variables → add `ADMIN_RESET_KEY` (12+ characters) for Production and Preview.
3. Push to GitHub. Check that `/api/health` returns `"ok": true` and `"storage": "upstash"`.

Preview and Production keep separate seats. Use the "···" host tools to erase seats before an event.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Storage status |
| `/api/room` | GET | The classroom (cached about 2 s at the edge) |
| `/api/vote` | POST `{ token, name, seat }` | Save or move your seat |
| `/api/reset` | POST `{ key }` | Erase all seats (host passcode) |
````

### Step 10: Build and try it locally

> Run `npm run build`. If it fails, fix only the reported errors without changing behaviour described in docs/single-room-guide.md, and run it again. Then run `npm run dev`.

To try the host tools locally, create a file `.env.local` containing `ADMIN_RESET_KEY=local-passcode-123` and restart `npm run dev`.

Open http://localhost:5173 and check:

| Check | Expected |
|---|---|
| Top of the page | No chalkboard banner. It starts at "Where did you sit when the bell rang?" |
| Header and sidebar | No "Join a classroom", "Open a classroom" or room-code options |
| Famous visitors | Named cursors appear one by one, glide between desks, and a cat appears on the desk they try, in both 3D and Seat map |
| Counter | Stays at **00** while only visitors move |
| Pick a desk | Name prompt, then a golden cat on your desk, and the counter goes to **01** |
| Second browser (private window) | It sees your seat within a few seconds. Its own pick makes both counters **02** |
| Drag or zoom the 3D room | Visitors still point at the right desks |
| "···" at the bottom right | Opens Host tools. A wrong passcode shows an error. The right one asks for confirmation, then both browsers drop to **00** within seconds |
| `/api/health` | `{"ok":true,"storage":"memory",...}` locally |

---

## Part C: Deploy and test

1. Commit and push the branch:

   ```bash
   git add -A
   git commit -m "One classroom with famous visitors and host reset"
   git push -u origin single-room
   ```

2. Vercel builds a **Preview**. Open it from the Vercel dashboard (Deployments) or from the pull request on GitHub.
3. Open `<preview link>/api/health`. Expect `"ok": true`, `"storage": "upstash"` and `"resetEnabled": true`.
   - **503, "Seat storage isn't connected yet":** Upstash isn't connected to Preview. Redo A1 step 4, then **Deployments → ⋯ → Redeploy**.
   - **`"resetEnabled": false`:** `ADMIN_RESET_KEY` is missing for Preview. Add it, then redeploy.
4. **Two-device test:** use a phone on mobile data and a laptop. Pick seats on both. Each should see the other's seat within about 6 seconds, with matching counters.
5. **Host tools:** "···", passcode, **Erase all seats**. Both screens drop to **00**.
6. **Optional cache check:** in browser DevTools → Network, the `/api/room` requests should mostly show `x-vercel-cache: HIT` or `STALE`.
7. Merge the pull request into `main`. Vercel deploys **Production** to https://studio91-back-to-school-vercel.vercel.app/. Repeat step 3 there.

Preview and Production keep **separate seats**, so tests on Preview never appear at your event.

---

## Part D: Event day

- **10 minutes before:** open `/api/health` and check for `"ok": true` and `"storage": "upstash"`. Open the site, then "···", passcode, **Erase all seats**. The counter shows **00**.
- **Share** the plain link, with no `?room=`.
- **During:** "Discover our seating story" shows the results live.
- **After:** **Save results** downloads the CSV.
- **Inactive databases:** free Upstash databases are archived after about 30 days without use. If the event is more than three weeks away, open the site once in between, or set up A1 in the week of the event.

---

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| `/api/health` shows an error page or `500 FUNCTION_INVOCATION_FAILED` | The function crashed on start (the error the old version showed) | Check that `api/index.ts` matches Code 1 exactly and imports nothing from `../server` or `../src`. If it still fails: Vercel → Deployments → that deployment → Logs, then paste the error into Copilot |
| "Seat storage isn't connected yet…" | Upstash not connected to this environment, or no redeploy since | A1 step 4, then **Redeploy** |
| "The classroom is busy for a moment" | Upstash refused the request (bad credentials or a usage limit) | Vercel → Storage → your database: check usage, reconnect, redeploy |
| Vercel build fails at `npm ci` ("not in sync") | `package-lock.json` not updated | Run `npm install`, commit `package-lock.json`, push |
| Build fails with "declared but its value is never read" | A leftover import | Ask Copilot to remove that import only |
| "Erasing is switched off" | `ADMIN_RESET_KEY` missing or shorter than 8 characters in this environment | Add it, then redeploy |
| "That passcode is not right." | Typo, or the variable was changed without a redeploy | Re-type it, or redeploy |
| Visitors' cats in 3D only appear after you drag the room | The scene didn't redraw | In `function Scene` in `Classroom.tsx`, add `const { invalidate } = useThree();` and `useEffect(() => { invalidate(); }, [props.botSeats, invalidate]);` |
| Deployment fails mentioning regions | Region setting not accepted | Delete the `"regions"` line in `vercel.json` |

**Rollback:** in Vercel, open **Deployments**, choose the previous production deployment, then **Instant Rollback** (or **Promote to Production**). Until you merge the branch, your current site is untouched.

---

## Expected usage: 60 people for 20 minutes

| Item | Estimate | Free allowance |
|---|---|---|
| Seat checks from browsers (every 2 s) | 36,000 | Vercel Hobby: 1,000,000 CDN requests a month |
| Function runs | 600 to 1,200 (at most 36,180 if edge caching didn't apply) | Vercel Hobby: 1,000,000 a month |
| Database commands | about 2,500 to 3,700 (about 6,100 at worst) | Upstash Free: 500,000 a month. One Upstash page lists 10,000 a day, and this still fits |
| Delay before others see a new seat | 2 to 6 seconds | — |

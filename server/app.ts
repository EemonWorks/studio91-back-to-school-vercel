import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { validCode, validToken, validVote } from './store.ts';
import type { RoomRepository } from './store.ts';
import { PresenceError, RoomEvents } from './presence.ts';
import type { ClassroomEvents } from './presence.ts';
import type { Room, Vote } from '../src/shared.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'Please send JSON.');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  if ('body' in req && req.body !== undefined) {
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
    if (typeof body !== 'string' && !Buffer.isBuffer(body)) throw new HttpError(400, 'The request contains invalid JSON.');
    chunks.push(Buffer.from(body));
    length = chunks[0]!.length;
  } else {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > 4096) throw new HttpError(413, 'Your request is too large.');
      chunks.push(buffer);
    }
  }
  if (length > 4096) throw new HttpError(413, 'Your request is too large.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request contains invalid JSON.');
  }
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function acceptsGzip(header: string | undefined) {
  const qualities = new Map<string, number>();
  for (const entry of (header ?? '').split(',')) {
    const [encoding, ...parameters] = entry.trim().toLowerCase().split(';');
    const quality = parameters.map((part) => part.trim()).find((part) => part.startsWith('q='));
    qualities.set(encoding ?? '', quality ? Number(quality.slice(2)) : 1);
  }
  return (qualities.get('gzip') ?? qualities.get('*') ?? 0) > 0;
}

export function createRuntime(store: RoomRepository, staticDir: string | null, options: { events?: ClassroomEvents; trustedProxy?: boolean } = {}) {
  const events = options.events ?? new RoomEvents();
  const voteQueues = new Map<string, {
    updates: { token: string; vote: Vote; resolve: (room: Room) => void; reject: (error: unknown) => void }[];
    timer: ReturnType<typeof setTimeout>;
  }>();
  const creates = new Map<string, { count: number; until: number }>();
  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const enqueueVote = (code: string, token: string, vote: Vote) => new Promise<Room>((resolveVote, reject) => {
    let queue = voteQueues.get(code);
    if (!queue) {
      queue = {
        updates: [],
        timer: setTimeout(() => {
          void (async () => {
            const batch = voteQueues.get(code);
            voteQueues.delete(code);
            if (!batch) return;
            try {
              const room = await store.voteMany(code, batch.updates);
              if (!room) throw new HttpError(404, 'This classroom no longer exists.');
              await events.broadcast(room);
              for (const update of batch.updates) update.resolve(room);
            } catch (error) {
              for (const update of batch.updates) update.reject(error);
            }
          })();
        }, 35),
      };
      voteQueues.set(code, queue);
    }
    if (queue.updates.length >= 1000) {
      reject(new HttpError(429, 'The classroom is busy. Please try selecting your seat again.'));
      return;
    }
    queue.updates.push({ token, vote, resolve: resolveVote, reject });
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'POST' && req.headers.origin) {
        if (new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site requests are not allowed.');
      }
      if (path === '/api/health') {
        await store.health?.();
        json(res, 200, { ok: true });
        return;
      }
      if (path === '/api/rooms' && req.method === 'POST') {
        const forwarded = req.headers['x-forwarded-for'];
        const ip = options.trustedProxy && typeof forwarded === 'string'
          ? forwarded.split(',')[0]!.trim() : req.socket.remoteAddress ?? 'unknown';
        if (store.allowCreate) {
          if (!await store.allowCreate(ip)) throw new HttpError(429, 'Too many new rooms. Join an existing room or try again in an hour.');
        } else {
          const now = Date.now();
          for (const [key, value] of creates) if (value.until < now) creates.delete(key);
          const limit = creates.get(ip) ?? { count: 0, until: now + 3_600_000 };
          if (limit.count >= 20) throw new HttpError(429, 'Too many new rooms. Join an existing room or try again in an hour.');
          limit.count++;
          creates.set(ip, limit);
        }
        json(res, 201, await store.create());
        return;
      }
      const match = /^\/api\/rooms\/([^/]+)(\/events|\/votes|\/presence)?$/.exec(path);
      if (match) {
        const code = match[1] ?? '';
        const action = match[2];
        if (!validCode(code)) throw new HttpError(400, 'Room codes have six letters or numbers.');
        const room = await store.publicRoom(code);
        if (!room) throw new HttpError(404, 'That classroom was not found. Check your room code.');
        if (req.method === 'GET' && !action) {
          json(res, 200, room);
          return;
        }
        if (req.method === 'GET' && action === '/events') {
          await events.open(code, room, res);
          return;
        }
        if (req.method === 'POST' && action === '/presence') {
          await events.update(code, await readJson(req));
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        if (req.method === 'POST' && action === '/votes') {
          const body = await readJson(req);
          if (!body || typeof body !== 'object' || !('token' in body) || !validToken(body.token) || !validVote(body)) {
            throw new HttpError(400, 'Enter a name (1-32 characters) and choose a valid desk.');
          }
          const updated = await enqueueVote(code, body.token, body);
          json(res, 200, updated);
          return;
        }
        throw new HttpError(405, 'That action is not supported.');
      }
      if (path.startsWith('/api/')) throw new HttpError(404, 'API endpoint not found.');
      if (staticDir === null) throw new HttpError(404, 'API endpoint not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      const root = resolve(staticDir);
      const requested = resolve(root, `.${decodeURIComponent(path)}`);
      if (requested !== root && !requested.startsWith(root + sep)) throw new HttpError(403, 'Access denied.');
      const file = existsSync(requested) && statSync(requested).isFile()
        ? requested : resolve(root, 'index.html');
      if (!existsSync(file)) throw new HttpError(503, 'Build the classroom first with npm run build, or use npm run dev.');
      const compressed = acceptsGzip(req.headers['accept-encoding']) && existsSync(`${file}.gz`) &&
        statSync(`${file}.gz`).mtimeMs >= statSync(file).mtimeMs;
      const servedFile = compressed ? `${file}.gz` : file;
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
        'Content-Length': statSync(servedFile).size,
        Vary: 'Accept-Encoding',
        ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(servedFile).on('error', (error) => {
        console.error('Unable to serve file:', error);
        res.destroy(error);
      }).pipe(res);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        console.error('Live classroom stream failed:', error instanceof Error ? error.message : 'Unknown error');
        res.end();
      } else if (error instanceof HttpError || error instanceof PresenceError) json(res, error.status, { error: error.message });
      else {
        console.error('Classroom request failed:', error);
        if (!res.headersSent) json(res, 500, { error: 'The classroom could not save your request. Please try again.' });
        else res.end();
      }
    }
  };
  const close = async () => {
    await events.close();
    for (const queue of voteQueues.values()) clearTimeout(queue.timer);
    for (const queue of voteQueues.values()) for (const update of queue.updates) update.reject(new Error('The classroom server is shutting down.'));
    voteQueues.clear();
  };
  return { handle, close };
}

export function createApp(store: RoomRepository, staticDir: string, options: { events?: ClassroomEvents; trustedProxy?: boolean } = {}) {
  const runtime = createRuntime(store, staticDir, options);
  const server = createServer(runtime.handle);
  server.on('close', () => { void runtime.close().catch((error: unknown) => console.error('Classroom shutdown failed:', error instanceof Error ? error.message : 'Unknown error')); });
  return server;
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRuntime } from '../server/app.ts';
import { cloudConfig } from '../server/config.ts';
import { connectRedis, RedisRoomEvents, RedisRoomStore } from '../server/redis.ts';
import type { RedisClient } from '../server/redis.ts';

let pending: Promise<ReturnType<typeof createRuntime>> | null = null;
let active: { client: RedisClient; subscriber: RedisClient; runtime: ReturnType<typeof createRuntime> } | null = null;

async function getRuntime() {
  if (active && (!active.client.isOpen || !active.subscriber.isOpen)) {
    const previous = active;
    active = null;
    pending = null;
    void previous.runtime.close().catch((error: unknown) =>
      console.error('Previous classroom connections could not be released:', error instanceof Error ? error.message : 'Redis unavailable'))
      .finally(() => {
        if (previous.client.isOpen) previous.client.destroy();
        if (previous.subscriber.isOpen) previous.subscriber.destroy();
      });
  }
  if (!pending) {
    pending = (async () => {
      const { url, prefix } = cloudConfig(process.env);
      const client = await connectRedis(url);
      try {
        const subscriber = await connectRedis(url);
        const store = new RedisRoomStore(client, prefix);
        const events = new RedisRoomEvents(store, subscriber);
        const runtime = createRuntime(store, null, { events, trustedProxy: process.env.VERCEL === '1' });
        active = { client, subscriber, runtime };
        return runtime;
      } catch (error) {
        client.destroy();
        throw error;
      }
    })().catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.searchParams.get('route');
    if ((url.pathname === '/api' || url.pathname === '/api/') && route !== null) {
      req.url = `/api/${route.replace(/^\/+/, '')}`;
    }
    // The CDN serves the frontend. Never expose source files through this handler.
    if (!req.url?.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API endpoint not found.' }));
      return;
    }
    const runtime = await getRuntime();
    // A streaming invocation stays alive until its stream closes and its lease is released.
    await runtime.handle(req, res);
  } catch (error) {
    console.error('Cloud classroom could not start:', error instanceof Error ? error.message : 'Unknown error');
    if (res.headersSent) { res.end(); return; }
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '5' });
    res.end(JSON.stringify({ error: process.env.REDIS_URL
      ? 'Shared classroom storage is unavailable. Please try again shortly.'
      : 'The classroom is not configured yet. Connect Redis Cloud in the Vercel Storage tab, then redeploy.' }));
  }
}

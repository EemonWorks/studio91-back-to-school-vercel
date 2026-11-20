import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { RoomStore } from './store.ts';
import { cloudConfig } from './config.ts';

const dataFile = process.env.DATA_FILE ?? fileURLToPath(new URL('../data/rooms.json', import.meta.url));
const standalone = process.argv.includes('--standalone');
if (standalone && process.env.VERCEL === '1') {
  throw new Error('Standalone mode needs one continuously running Node server, not a Vercel Function. Use the shared-storage Vercel API or a single-service host.');
}
const config = !standalone && process.env.REDIS_URL ? cloudConfig(process.env) : null;
const cloud = config ? await import('./redis.ts') : null;
const client = cloud && config ? await cloud.connectRedis(config.url) : null;
const subscriber = cloud && config ? await cloud.connectRedis(config.url) : null;
const sharedStore = cloud && client && config ? new cloud.RedisRoomStore(client, config.prefix) : null;
const store = sharedStore ?? new RoomStore(dataFile);
const events = cloud && sharedStore && subscriber ? new cloud.RedisRoomEvents(sharedStore, subscriber) : undefined;
const server = createApp(store, fileURLToPath(new URL('../dist', import.meta.url)), events ? { events } : {});
const port = Number(process.env.PORT ?? 3001);
server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const actualPort = address && typeof address !== 'string' ? address.port : port;
  console.log(`Seat picker ready at http://localhost:${actualPort} (${sharedStore ? 'shared Redis' : 'standalone file storage'})`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
    void (async () => {
      await events?.close();
      if (client?.isOpen) client.destroy();
    })().then(() => process.exit(0), (error: unknown) => {
      console.error('Could not shut down classroom connections:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    });
  });
}

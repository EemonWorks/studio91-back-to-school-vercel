import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { RoomStore } from './store.ts';
import { cloudConfig } from './config.ts';
import { connectRedis, RedisRoomEvents, RedisRoomStore } from './redis.ts';

const dataFile = process.env.DATA_FILE ?? fileURLToPath(new URL('../data/rooms.json', import.meta.url));
const config = process.env.REDIS_URL ? cloudConfig(process.env) : null;
const client = config ? await connectRedis(config.url) : null;
const subscriber = config ? await connectRedis(config.url) : null;
const store = client && config ? new RedisRoomStore(client, config.prefix) : new RoomStore(dataFile);
const events = store instanceof RedisRoomStore && subscriber ? new RedisRoomEvents(store, subscriber) : undefined;
const server = createApp(store, fileURLToPath(new URL('../dist', import.meta.url)), events ? { events } : {});
const port = Number(process.env.PORT ?? 3001);
server.listen(port, '0.0.0.0', () => console.log(`Studio 91 classroom ready at http://localhost:${port}`));
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

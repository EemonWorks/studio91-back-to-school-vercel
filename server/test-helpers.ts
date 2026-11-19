import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { CursorBatch, LiveCursor, Room } from '../src/shared.ts';

export async function waitFor(check: () => boolean, message: string, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert(Date.now() < deadline, message);
    await delay(10);
  }
}

export class ObservedStream {
  controller = new AbortController();
  room: Room | null = null;
  session: { id: string; key: string } | null = null;
  cursors = new Map<string, LiveCursor>();
  online = 0;
  roomFrames = 0;
  error: unknown = null;
  stopped = false;
  ended = false;
  pump: Promise<void> = Promise.resolve();

  async open(url: string) {
    const response = await fetch(url, { signal: this.controller.signal });
    assert.equal(response.status, 200);
    assert(response.body);
    const reader = response.body.getReader();
    this.pump = (async () => {
      let buffer = '';
      const decoder = new TextDecoder();
      try {
        while (!this.stopped) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const lines = frame.split('\n');
            const name = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message';
            const data = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
            if (!data) continue;
            if (name === 'session') this.session = JSON.parse(data) as { id: string; key: string };
            if (name === 'message') { this.room = JSON.parse(data) as Room; this.roomFrames++; }
            if (name === 'presence') {
              const batch = JSON.parse(data) as CursorBatch;
              if (batch.replace) this.cursors.clear();
              for (const id of batch.removed) this.cursors.delete(id);
              for (const cursor of batch.cursors) this.cursors.set(cursor.id, cursor);
              this.online = batch.online;
            }
          }
        }
      } catch (error) {
        if (!this.stopped) this.error = error;
      } finally { this.ended = true; reader.releaseLock(); }
    })();
  }

  async close() {
    this.stopped = true;
    this.controller.abort();
    await this.pump;
  }
}

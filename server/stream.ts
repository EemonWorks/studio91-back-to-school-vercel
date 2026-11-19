import { randomInt, randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { CursorBatch, Room } from '../src/shared.ts';

const MAX_BUFFER_BYTES = 256 * 1024;

export class ClassroomStream {
  id = randomUUID();
  key = randomUUID();
  res: ServerResponse;
  blocked = false;
  roomPending: Room | null = null;
  presencePending: CursorBatch | null = null;
  onResync: (() => void) | null = null;

  constructor(res: ServerResponse) {
    this.res = res;
    res.on('drain', () => {
      this.blocked = false;
      if (this.roomPending) {
        const latest = this.roomPending;
        this.roomPending = null;
        this.room(latest);
      }
      if (this.presencePending && !this.blocked) {
        const latest = this.presencePending;
        this.presencePending = null;
        this.presence(latest);
      }
      if (!this.blocked) this.onResync?.();
    });
  }

  start(room: Room) {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    this.write(`retry: ${randomInt(1800, 3500)}\ndata: ${JSON.stringify(room)}\n\nevent: session\ndata: ${JSON.stringify({ id: this.id, key: this.key })}\n\n`);
  }

  write(frame: string) {
    if (this.res.destroyed || this.res.writableEnded) return;
    if (this.res.writableLength + Buffer.byteLength(frame) > MAX_BUFFER_BYTES) {
      console.warn('Closing a slow classroom stream to bound memory usage.');
      this.res.destroy();
      return;
    }
    this.blocked = !this.res.write(frame);
  }

  room(room: Room) {
    if (this.blocked) this.roomPending = room;
    else this.write(`data: ${JSON.stringify(room)}\n\n`);
  }

  presence(batch: CursorBatch) {
    if (this.blocked) {
      // Deltas cannot replace other deltas. Ask for a full resync after drain.
      this.presencePending = batch.replace ? batch : null;
      return false;
    }
    this.write(`event: presence\ndata: ${JSON.stringify(batch)}\n\n`);
    return true;
  }

  close() {
    this.res.end();
  }
}

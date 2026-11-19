import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Users } from 'lucide-react';
import { CURSOR_INTERVAL_MS, SEAT_COUNT } from './shared';
import type { ConnectionState, CursorBatch, CursorSurface, LiveCursor, Room } from './shared';

interface Props {
  roomCode: string;
  name: string;
  view: '3d' | 'map';
  pageRef: RefObject<HTMLDivElement | null>;
  sceneRef: RefObject<HTMLDivElement | null>;
  onRoom: (room: Room) => void;
  onConnection: (state: ConnectionState) => void;
  onError: (message: string) => void;
}

function isRoom(value: unknown): value is Room {
  if (!value || typeof value !== 'object') return false;
  return 'code' in value && typeof value.code === 'string' &&
    'createdAt' in value && typeof value.createdAt === 'string' &&
    'revision' in value && Number.isSafeInteger(value.revision) &&
    'votes' in value && Array.isArray(value.votes) && value.votes.every((vote: unknown) =>
      !!vote && typeof vote === 'object' && 'name' in vote && typeof vote.name === 'string' &&
      'seat' in vote && typeof vote.seat === 'number' && Number.isInteger(vote.seat) && vote.seat >= 0 && vote.seat < SEAT_COUNT);
}

function isCursor(value: unknown): value is LiveCursor {
  if (!value || typeof value !== 'object') return false;
  return 'id' in value && typeof value.id === 'string' && 'name' in value && typeof value.name === 'string' &&
    'color' in value && typeof value.color === 'string' && /^#[a-f0-9]{6}$/i.test(value.color) &&
    'x' in value && typeof value.x === 'number' && value.x >= 0 && value.x <= 1 &&
    'y' in value && typeof value.y === 'number' && value.y >= 0 && value.y <= 1 &&
    'surface' in value && (value.surface === 'page' || value.surface === '3d' || value.surface === 'map');
}

function isBatch(value: unknown): value is CursorBatch {
  if (!value || typeof value !== 'object') return false;
  return 'replace' in value && typeof value.replace === 'boolean' &&
    'cursors' in value && Array.isArray(value.cursors) && value.cursors.every(isCursor) &&
    'removed' in value && Array.isArray(value.removed) && value.removed.every((id: unknown) => typeof id === 'string') &&
    'online' in value && typeof value.online === 'number' && Number.isInteger(value.online);
}

export default function LivePresence({ roomCode, name, view, pageRef, sceneRef, onRoom, onConnection, onError }: Props) {
  const [peers, setPeers] = useState(new Map<string, LiveCursor>());
  const [online, setOnline] = useState(1);
  const [presenceError, setPresenceError] = useState('');
  const [retry, setRetry] = useState(0);
  const [bounds, setBounds] = useState({ width: 0, height: 0, left: 0, top: 0, sceneWidth: 0, sceneHeight: 0 });
  const latest = useRef({ name, view });
  latest.current = { name, view };
  const point = useRef<{ x: number; y: number; surface: CursorSurface; active: boolean }>({
    x: 0, y: 0, surface: 'page', active: false,
  });
  useEffect(() => { point.current.active = false; }, [view]);

  useLayoutEffect(() => {
    const root = pageRef.current;
    const scene = sceneRef.current;
    if (!root || !scene) return;
    const measure = () => {
      const page = root.getBoundingClientRect();
      const room = scene.getBoundingClientRect();
      setBounds({ width: page.width, height: page.height, left: room.left - page.left, top: room.top - page.top, sceneWidth: room.width, sceneHeight: room.height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(scene);
    measure();
    return () => observer.disconnect();
  }, [pageRef, sceneRef]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const move = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('dialog')) {
        point.current.active = false;
        return;
      }
      const page = root.getBoundingClientRect();
      const scene = sceneRef.current?.getBoundingClientRect();
      const insideScene = scene && event.clientX >= scene.left && event.clientX <= scene.right &&
        event.clientY >= scene.top && event.clientY <= scene.bottom;
      const rect = insideScene ? scene : page;
      point.current = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
        surface: insideScene ? latest.current.view : 'page',
        active: true,
      };
    };
    const hide = () => { point.current.active = false; };
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [pageRef, sceneRef]);

  useEffect(() => {
    const events = new EventSource(`/api/rooms/${roomCode}/events`);
    const controller = new AbortController();
    let session: { id: string; key: string } | null = null;
    let sending = false;
    let previous = '';
    let lastSent = 0;
    setPeers(new Map());
    onConnection('connecting');
    const protocolError = (error: unknown) => {
      console.error('Unable to read the live classroom:', error);
      onError('A live classroom update could not be read. Reload to reconnect.');
      onConnection('offline');
    };
    events.onopen = () => {
      onConnection('live');
      setPresenceError('');
    };
    events.onmessage = (event) => {
      try {
        const room: unknown = JSON.parse(event.data);
        if (!isRoom(room)) throw new Error('Invalid room snapshot.');
        onRoom(room);
      } catch (error) { protocolError(error); }
    };
    events.addEventListener('session', (event) => {
      try {
        const value: unknown = JSON.parse(event.data);
        if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
          !('key' in value) || typeof value.key !== 'string') throw new Error('Invalid cursor session.');
        session = { id: value.id, key: value.key };
        previous = '';
      } catch (error) { protocolError(error); }
    });
    events.addEventListener('presence', (event) => {
      try {
        const batch: unknown = JSON.parse(event.data);
        if (!isBatch(batch)) throw new Error('Invalid cursor batch.');
        setOnline(batch.online);
        setPeers((current) => {
          const next = batch.replace ? new Map<string, LiveCursor>() : new Map(current);
          for (const id of batch.removed) next.delete(id);
          for (const cursor of batch.cursors) if (cursor.id !== session?.id) next.set(cursor.id, cursor);
          return next;
        });
      } catch (error) { protocolError(error); }
    });
    events.onerror = () => {
      session = null;
      setPeers(new Map());
      onConnection('offline');
      setPresenceError('Reconnecting live cursors...');
    };
    let timer: ReturnType<typeof setTimeout>;
    const send = () => {
      if (controller.signal.aborted) return;
      if (!session || sending || events.readyState !== EventSource.OPEN) return;
      const payload = JSON.stringify({ ...point.current, name: latest.current.name || 'Classmate', session: session.id, key: session.key });
      if (payload === previous && Date.now() - lastSent < 3000) return;
      sending = true;
      void fetch(`/api/rooms/${roomCode}/presence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: payload, signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          if (response.status === 403) setRetry((value) => value + 1);
          const result: unknown = await response.json();
          throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
            ? result.error : 'Live cursors could not be sent.');
        }
        previous = payload;
        lastSent = Date.now();
        setPresenceError('');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn('Live cursor update failed:', error);
        setPresenceError(error instanceof Error ? error.message : 'Live cursors are unavailable. Reconnecting...');
      }).finally(() => {
        sending = false;
        if (!controller.signal.aborted) schedule();
      });
    };
    const schedule = () => {
      timer = setTimeout(() => {
        send();
        if (!sending && !controller.signal.aborted) schedule();
      }, CURSOR_INTERVAL_MS);
    };
    schedule();
    return () => { clearTimeout(timer); controller.abort(); events.close(); };
  }, [roomCode, retry, onRoom, onConnection, onError]);

  return <>
    <div className="live-cursors" aria-hidden="true">
      {[...peers.values()].map((cursor) => {
        if (cursor.surface !== 'page' && cursor.surface !== view) return null;
        const x = cursor.surface === 'page' ? cursor.x * bounds.width : bounds.left + cursor.x * bounds.sceneWidth;
        const y = cursor.surface === 'page' ? cursor.y * bounds.height : bounds.top + cursor.y * bounds.sceneHeight;
        return <div key={cursor.id} className="live-cursor" data-cursor-id={cursor.id}
          style={{ transform: `translate3d(${x}px, ${y}px, 0)`, color: cursor.color }}>
          <svg width="20" height="25" viewBox="0 0 20 25"><path d="M2 2 17 14 10 15 7 22Z" fill={cursor.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          <span style={{ background: cursor.color }}>{cursor.name}</span>
        </div>;
      })}
    </div>
    <div className={`presence-status ${presenceError ? 'presence-warning' : ''}`} role="status">
      <Users size={14} /><span>{presenceError || `${online} ${online === 1 ? 'classmate' : 'classmates'} here · Live cursors`}</span>
    </div>
  </>;
}

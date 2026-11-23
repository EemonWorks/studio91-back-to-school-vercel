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

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

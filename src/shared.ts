export const ROWS = 5;
export const COLUMNS = 8;
export const SEAT_COUNT = ROWS * COLUMNS;
export const SEATS_PER_BENCH = 2;
export const BENCHES_PER_ROW = COLUMNS / SEATS_PER_BENCH;
export const BENCH_COUNT = ROWS * BENCHES_PER_ROW;
export const BENCH_WIDTH = 2.4;
export const BENCH_DEPTH = 0.95;
export const BENCH_REAR_EXTENT = 1.1;
export const BENCH_PITCH = 3.45;
export const ROW_PITCH = 2.3;
export const rowDepth = (row: number) => -3.25 + row * ROW_PITCH;
export const benchPosition = (bench: number): [number, number, number] => [
  ((bench % BENCHES_PER_ROW) - (BENCHES_PER_ROW - 1) / 2) * BENCH_PITCH,
  0,
  rowDepth(Math.floor(bench / BENCHES_PER_ROW)),
];

export interface Vote {
  name: string;
  seat: number;
}

export interface Room {
  code: string;
  createdAt: string;
  revision: number;
  votes: Vote[];
}

/** Where a seat appears inside the classroom panel, in CSS pixels from its top-left corner. */
export interface SeatPoint {
  x: number;
  y: number;
}

export type ConnectionState = 'preview' | 'connecting' | 'live' | 'offline';
/** How often each browser asks for the latest seats. */
export const POLL_INTERVAL_MS = 2000;

export function pencilPose(index: number, total: number) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(index) || index < 0 || index >= total) {
    throw new RangeError('A pencil needs a valid index and positive pile size.');
  }
  const base = Math.ceil((Math.sqrt(8 * total + 1) - 1) / 2);
  let slot = index;
  let layer = 0;
  let width = base;
  while (slot >= width) {
    slot -= width;
    layer++;
    width--;
  }
  return {
    x: Math.sin(index * 2.4) * 0.035,
    y: 1.21 + layer * 0.055,
    z: (slot - (width - 1) / 2) * 0.046,
    angle: (layer % 2 ? -0.07 : 0.07) + Math.sin(index * 1.7) * 0.025,
  };
}

export function newestSnapshot(current: Room | null, incoming: Room): Room {
  return current && current.code === incoming.code && current.revision > incoming.revision ? current : incoming;
}

export const rowFor = (seat: number) => Math.floor(seat / COLUMNS);
export const seatLabel = (seat: number) =>
  `${String.fromCharCode(65 + rowFor(seat))}${(seat % COLUMNS) + 1}`;
export const groupFor = (seat: number) => {
  const row = rowFor(seat);
  return row < 2 ? 0 : row === 2 ? 1 : 2;
};

export const GROUPS = [
  { name: 'Front-row crew', short: 'Front', note: 'Always ready with an answer.', color: '#d49b45' },
  { name: 'Middle-grounders', short: 'Middle', note: 'The best of both worlds.', color: '#159fc1' },
  { name: 'Backbench legends', short: 'Back', note: 'Where the best stories began.', color: '#ce6794' },
] as const;

export function summarize(votes: Vote[]) {
  const counts = [0, 0, 0];
  const seats = Array.from({ length: SEAT_COUNT }, () => 0);
  for (const vote of votes) {
    const group = groupFor(vote.seat);
    counts[group] = (counts[group] ?? 0) + 1;
    seats[vote.seat] = (seats[vote.seat] ?? 0) + 1;
  }
  return { counts, seats, total: votes.length };
}

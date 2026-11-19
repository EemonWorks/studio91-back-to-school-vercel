import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEAT_COUNT } from '../src/shared.ts';
import type { Room, Vote } from '../src/shared.ts';

interface StoredRoom {
  code: string;
  createdAt: string;
  revision: number;
  votes: Record<string, Vote>;
}

type Awaitable<T> = T | Promise<T>;
export interface VoteUpdate { token: string; vote: Vote }
export interface RoomRepository {
  publicRoom(code: string): Awaitable<Room | undefined>;
  create(): Awaitable<Room>;
  voteMany(code: string, updates: VoteUpdate[]): Awaitable<Room | undefined>;
  health?(): Promise<void>;
  allowCreate?(identity: string): Promise<boolean>;
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
export const validCode = (code: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(code);
export const validToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[a-f0-9-]{36}$/i.test(token);
export const validName = (name: unknown): name is string =>
  typeof name === 'string' && name.trim().length > 0 && name.length <= 32 && !/[\u0000-\u001f\u007f]/.test(name);
export const validVote = (vote: unknown): vote is Vote => {
  if (!vote || typeof vote !== 'object' || !('name' in vote) || !('seat' in vote)) return false;
  return validName(vote.name) &&
    typeof vote.seat === 'number' && Number.isInteger(vote.seat) &&
    vote.seat >= 0 && vote.seat < SEAT_COUNT;
};

function isStoredRoom(value: unknown): value is StoredRoom {
  if (!value || typeof value !== 'object') return false;
  if (!('code' in value) || typeof value.code !== 'string' || !validCode(value.code)) return false;
  if (!('createdAt' in value) || typeof value.createdAt !== 'string') return false;
  if (!('revision' in value) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) return false;
  if (!('votes' in value) || !value.votes || typeof value.votes !== 'object' || Array.isArray(value.votes)) return false;
  return Object.entries(value.votes).every(([token, vote]) => validToken(token) && validVote(vote));
}

export class RoomStore {
  file: string;
  rooms = new Map<string, StoredRoom>();

  constructor(file: string) {
    this.file = file;
    if (existsSync(file)) {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(data) || !data.every(isStoredRoom)) {
        throw new Error('Room data is invalid. Restore a valid data file before starting.');
      }
      for (const room of data) this.rooms.set(room.code, room);
    }
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.rooms.values()]), 'utf8');
    renameSync(`${this.file}.tmp`, this.file);
  }

  publicRoom(code: string): Room | undefined {
    const room = this.rooms.get(code);
    return room && { code: room.code, createdAt: room.createdAt, revision: room.revision, votes: Object.values(room.votes) };
  }

  create(): Room {
    if (this.rooms.size >= 500) throw new Error('The server has reached its 500-room limit.');
    let code: string;
    do {
      code = newRoomCode();
    } while (this.rooms.has(code));
    const room: StoredRoom = { code, createdAt: new Date().toISOString(), revision: 0, votes: {} };
    this.rooms.set(code, room);
    try {
      this.save();
    } catch (error) {
      this.rooms.delete(code);
      throw error;
    }
    return { ...room, votes: [] };
  }

  vote(code: string, token: string, vote: Vote): Room | undefined {
    return this.voteMany(code, [{ token, vote }]);
  }

  voteMany(code: string, updates: { token: string; vote: Vote }[]): Room | undefined {
    const room = this.rooms.get(code);
    if (!room) return undefined;
    const previous = room.votes;
    const revision = room.revision;
    const votes = { ...previous };
    for (const { token, vote } of updates) {
      if (!votes[token] && Object.keys(votes).length >= 1000) throw new Error('This room is full (1,000 people).');
      votes[token] = { name: vote.name.trim(), seat: vote.seat };
    }
    room.votes = votes;
    room.revision += updates.length;
    try {
      this.save();
    } catch (error) {
      room.revision = revision;
      room.votes = previous;
      throw error;
    }
    return this.publicRoom(code);
  }
}

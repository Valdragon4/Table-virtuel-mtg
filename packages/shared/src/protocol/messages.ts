/** Enveloppes de messages. Voir docs/protocol.md §4 et §11. */
import type { CursorState, Event, Snapshot } from './events.js';
import type { Intent } from './intents.js';
import type { SeatId, Seq } from './core.js';

export interface ClientHello {
  t: 'hello';
  protocol: number;
  sessionToken?: string;
  seatToken?: string;
  sinceSeq?: Seq;
  roomPassword?: string;
}
export interface ClientIntent {
  t: 'intent';
  cid: string;
  ackSeq: Seq;
  intent: Intent;
}
export interface ClientPing { t: 'ping'; ts: number }
export interface ClientResync { t: 'resync'; sinceSeq: Seq }

export type ClientMessage = ClientHello | ClientIntent | ClientPing | ClientResync;

export interface ServerEvent {
  t: 'event';
  seq: Seq;
  at: number;
  actor: SeatId | null;
  event: Event;
  /**
   * Ligne de journal attachée à cet event, quand il en produit une. Le texte est
   * public par construction : le serveur n'y met jamais le nom d'une carte que
   * tous les sièges ne peuvent pas voir.
   */
  log?: { text: string; cardIds: string[] };
}
export interface ServerAck { t: 'ack'; cid: string; seq: Seq | null }
export interface ServerReject { t: 'reject'; cid: string; code: ErrorCode; message: string }
export interface ServerHello {
  t: 'hello';
  protocol: number;
  seat: SeatId | null;
  roomCode: string;
  seatToken?: string;
  snapshot?: Snapshot;
  delta?: ServerEvent[];
}
export interface ServerPong { t: 'pong'; ts: number; serverTs: number }
export interface ServerErrorMsg { t: 'error'; code: ErrorCode; message: string; fatal: boolean }
export interface ServerCursors { t: 'cursors'; seats: CursorState[] }

export type ServerMessage =
  | ServerEvent | ServerAck | ServerReject | ServerHello
  | ServerPong | ServerErrorMsg | ServerCursors;

export const ERROR_CODES = [
  'ERR_PROTOCOL',
  'ERR_AUTH',
  'ERR_ROOM_NOT_FOUND',
  'ERR_ROOM_FULL',
  'ERR_ROOM_PASSWORD',
  'ERR_NOT_SEATED',
  'ERR_NOT_HOST',
  'ERR_ROOM_CLOSED',
  'ERR_SEAT_TAKEN',
  'ERR_UNKNOWN_OBJECT',
  'ERR_NOT_YOURS',
  'ERR_NOT_VISIBLE',
  'ERR_BAD_ZONE',
  'ERR_LOOK_PENDING',
  'ERR_UNDO_UNAVAILABLE',
  'ERR_GAME_NOT_STARTED',
  'ERR_GAME_ALREADY_STARTED',
  'ERR_RATE_LIMIT',
  'ERR_PAYLOAD',
  'ERR_INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes de fermeture WebSocket propres au protocole. */
export const CLOSE_PROTOCOL_MISMATCH = 4400;
export const CLOSE_RATE_LIMITED = 4429;

/** Limites appliquées par socket (docs/protocol.md §11). */
export const LIMITS = {
  intentsBurst: 60,
  intentsPerSecond: 20,
  maxFrameBytes: 64 * 1024,
  cursorHz: 20,
  cursorMinIntervalMs: 50,
  eventBuffer: 2000,
  undoWindowMs: 10_000,
  lookAbandonMs: 120_000,
  pingIntervalMs: 15_000,
  missedPongsBeforeClose: 3,
  chatMaxChars: 240,
  labelMaxChars: 200,
  /**
   * Quatre sièges au plus. Le produit vise la partie de Commander à quatre,
   * pas la table géante : au-delà, la disposition des panneaux devient illisible
   * et les parties interminables. Le mode Treachery, s'il arrive un jour,
   * demandera de revoir ce plafond en même temps que la disposition.
   */
  maxSeats: 4,
} as const;

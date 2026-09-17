/** Fabrique une partie à deux sièges, decks chargés, sans base de données. */
import type { ServerMessage } from '@mtg/shared';
import { Room, type Connection, type DeckPayload } from '../src/game/room.js';
import { seededRandom } from '../src/game/random.js';
import { TokenBucket } from '../src/lib/throttle.js';

export interface FakeConnection extends Connection {
  received: ServerMessage[];
  /** Toutes les frames telles qu'elles partiraient sur le socket. */
  frames: string[];
}

export function fakeConnection(id: string): FakeConnection {
  const conn: FakeConnection = {
    id,
    seatId: null,
    userId: null,
    lastSeq: 0,
    received: [],
    frames: [],
    send(message) {
      conn.received.push(message);
      conn.frames.push(JSON.stringify(message));
    },
    close() {},
    bucket: new TokenBucket({ capacity: 1000, refillPerSecond: 1000 }),
    lastCursorAt: 0,
    missedPongs: 0,
  };
  return conn;
}

export function deck(name: string, cardNames: string[], commander?: string): DeckPayload {
  const card = (n: string, zone: 'MAIN' | 'COMMANDER') => ({
    // Identifiant dérivé du nom : lisible dans un test en échec.
    scryfallId: `id-${n.toLowerCase().replace(/\s+/g, '-')}`,
    quantity: 1,
    zone,
    isFoil: false,
    name: n,
    setCode: 'tst',
    collectorNumber: '1',
    typeLine: 'Test',
    manaCost: '{1}',
    colorIdentity: [],
    layout: 'normal',
    imageUris: { normal: `https://cards.scryfall.io/normal/${n}.jpg` },
    faces: null,
  });

  return {
    name,
    cards: [
      ...cardNames.map((n) => card(n, 'MAIN')),
      ...(commander ? [card(commander, 'COMMANDER')] : []),
    ],
  };
}

export interface Table {
  room: Room;
  a: FakeConnection;
  b: FakeConnection;
  /** Toutes les connexions assises, dans l'ordre des sièges. */
  seats: FakeConnection[];
}

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Frank', 'Grace', 'Heidi'];
const COMMANDERS = ['Selenia', 'Kenrith', 'Atraxa', 'Prossh', 'Edgar', 'Yuriko', 'Najeela', 'Korvold'];

/** Fabrique une table de `count` sièges, tous assis avec un deck de 20 cartes. */
export function seatTable(count: number, seed = 42): Table {
  const room = new Room('room-1', 'TEST01', 'COMMANDER', seededRandom(seed));
  const conns: FakeConnection[] = [];

  for (let i = 0; i < count; i++) {
    const conn = fakeConnection(`conn-${i}`);
    room.addConnection(conn);
    room.sitDown(conn, i, NAMES[i] ?? `Joueur ${i}`, null);
    conns.push(conn);
  }

  const names = Array.from({ length: 20 }, (_, i) => `Carte ${i + 1}`);
  for (let i = 0; i < count; i++) {
    room.loadDeck(
      `seat_${i}`,
      // Des noms distincts par siège : un test en échec dit tout de suite à qui
      // appartient la carte qui a fuité.
      deck(`Deck ${NAMES[i]}`, names.map((n) => (i === 0 ? n : `${n} ${NAMES[i]}`)), COMMANDERS[i]),
      null,
    );
  }

  for (const conn of conns) {
    conn.received.length = 0;
    conn.frames.length = 0;
  }
  return { room, a: conns[0]!, b: conns[1]!, seats: conns };
}

export function twoSeatTable(seed = 42): Table {
  return seatTable(2, seed);
}

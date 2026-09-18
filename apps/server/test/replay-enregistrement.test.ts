/**
 * Ce que l'enregistrement doit contenir — et le test qui compte vraiment ici :
 * **la vue d'un siège re-dérivée à un pas donné rend exactement ce que ce siège
 * avait reçu à ce moment-là dans la partie réelle.**
 *
 * C'est la seule façon de prouver que la bascule de point de vue ne ment ni par
 * excès ni par défaut. Par excès : le lecteur montrerait à seat_0 la main de
 * seat_1 en prétendant que c'est ce qu'il voyait. Par défaut : il cacherait une
 * carte que seat_0 avait bien sous les yeux, et l'on croirait à un bug du jeu.
 *
 * Le test ne compare pas à une référence écrite à la main : il compare au flux
 * **réellement sorti du socket** pendant la partie, capturé par les fausses
 * connexions du fixture.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { REPLAY_LIMITS, type ReplaySink } from '../src/replay/recorder.js';
import { projectFrame, projectOrigin } from '../src/replay/projection.js';
import type { ReplayFrame, ReplayOrigin } from '../src/replay/types.js';
import { Room } from '../src/game/room.js';
import { seededRandom } from '../src/game/random.js';
import { deck, fakeConnection, type FakeConnection } from './fixture.js';

/** Puits en mémoire : ce que la base recevrait, sans base. */
function memorySink(): {
  sink: ReplaySink;
  origin: ReplayOrigin | null;
  frames: ReplayFrame[];
  closed: string | null;
  stats: { eventCount: number; bytes: number; truncated: boolean; lastSeq: number } | null;
} {
  const box = {
    origin: null as ReplayOrigin | null,
    frames: [] as ReplayFrame[],
    closed: null as string | null,
    stats: null as { eventCount: number; bytes: number; truncated: boolean; lastSeq: number } | null,
    sink: {} as ReplaySink,
  };
  box.sink = {
    open: (_room, _seq, origin) => {
      box.origin = origin;
      box.frames = [];
      box.closed = null;
    },
    append: (_room, _seq, frames) => {
      box.frames.push(...frames);
    },
    close: (_room, _seq, stats) => {
      box.closed = stats.reason;
      box.stats = stats;
    },
  };
  return box;
}

interface Recorded {
  room: Room;
  seats: FakeConnection[];
  box: ReturnType<typeof memorySink>;
}

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan'];
const COMMANDERS = ['Selenia', 'Kenrith', 'Atraxa', 'Prossh'];

/** Une table enregistrée, decks chargés, personne encore lancé. */
function recordedTable(count = 2, seed = 7): Recorded {
  const box = memorySink();
  const room = new Room('room-replay', 'REPL01', 'COMMANDER', seededRandom(seed), {
    replaySink: box.sink,
  });
  const seats: FakeConnection[] = [];
  for (let i = 0; i < count; i++) {
    const conn = fakeConnection(`conn-${i}`);
    room.addConnection(conn);
    room.sitDown(conn, i, NAMES[i]!, null);
    seats.push(conn);
  }
  const names = Array.from({ length: 20 }, (_, i) => `Carte ${i + 1}`);
  for (let i = 0; i < count; i++) {
    room.loadDeck(
      `seat_${i}`,
      deck(`Deck ${NAMES[i]}`, names.map((n) => (i === 0 ? n : `${n} ${NAMES[i]}`)), COMMANDERS[i]),
      null,
    );
  }
  return { room, seats, box };
}

/** Une partie courte mais variée : pioche, pose, scry, révélation, mélange. */
function playALittle(t: Recorded): void {
  const [a, b] = t.seats;
  void t.room.handleIntent(a!, 'i1', { type: 'DRAW', count: 3 });
  void t.room.handleIntent(b!, 'i2', { type: 'DRAW', count: 2 });
  void t.room.handleIntent(a!, 'i3', { type: 'LOOK', zone: { seat: 'seat_0', kind: 'LIBRARY' }, mode: 'SCRY', count: 2 });
  void t.room.handleIntent(b!, 'i5', { type: 'REVEAL_HAND', toSeats: 'ALL' });
  void t.room.handleIntent(a!, 'i6', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
  void t.room.handleIntent(a!, 'i7', { type: 'ADJUST_LIFE', seat: 'seat_1', delta: -3 });
}

describe('enregistrement du flux', () => {
  it("n'enregistre rien avant le lancement de la partie", () => {
    const t = recordedTable();
    expect(t.box.origin).toBeNull();
    expect(t.box.frames).toHaveLength(0);
  });

  it('ouvre au lancement, sur un point zéro decks mélangés et mains distribuées', () => {
    const t = recordedTable();
    t.room.startGame('seat_0');
    expect(t.box.origin).not.toBeNull();
    const origin = t.box.origin!;
    // Sept cartes en main, et une bibliothèque qui a perdu autant.
    expect(origin.zones['seat_0|HAND']).toHaveLength(7);
    expect(origin.objects.length).toBeGreaterThan(30);
    // Le jeton de reprise de siège n'est jamais recopié : ce serait distribuer
    // les clés de la table avec ses photos.
    expect(JSON.stringify(origin)).not.toContain('seatToken');
  });

  it('conserve la variante omnisciente, pas une vue de siège', () => {
    const t = recordedTable();
    t.room.startGame('seat_0');
    playALittle(t);
    t.room.abandonReplay('TEST');

    // Toutes les identités de la main d'Alice sont dans le flux enregistré —
    // c'est précisément ce que le socket de Bob ne portait pas.
    const recorded = JSON.stringify(t.box.frames);
    const move = t.box.frames.find((f) => f.event.type === 'CARD_MOVED');
    expect(move).toBeDefined();
    expect(recorded).toContain('"scryfallId"');
    // Et `knownTo` voyage avec, sans quoi aucune vue de siège ne serait
    // re-dérivable ailleurs qu'à la fin de la partie.
    expect(t.box.frames.some((f) => f.known !== undefined)).toBe(true);
  });

  it('referme sur la fin de partie, et rien après', () => {
    const t = recordedTable();
    t.room.startGame('seat_0');
    playALittle(t);
    const before = t.box.frames.length;
    t.room.close('Alice');
    expect(t.box.closed).toBe('HOST');
    // La dernière ligne de la partie est dans le replay, pas hors de lui.
    expect(t.box.frames.length).toBeGreaterThan(before);
    expect(t.box.frames.some((f) => f.event.type === 'GAME_ENDED')).toBe(true);

    // Plus rien n'entre après la clôture.
    const after = t.box.frames.length;
    void t.room.handleIntent(t.seats[0]!, 'z1', { type: 'CHAT_BUBBLE', text: 'après' });
    expect(t.box.frames).toHaveLength(after);
  });

  it('mesure le coût réel d’une partie', () => {
    const t = recordedTable(4, 11);
    t.room.startGame('seat_0');
    // Une table à quatre qui vide ses bibliothèques : le cas courant, en plus dense.
    for (let turn = 0; turn < 50; turn++) {
      for (let s = 0; s < 4; s++) {
        void t.room.handleIntent(t.seats[s]!, `d${turn}-${s}`, { type: 'DRAW', count: 1 });
      }
    }
    t.room.close('Alice');
    const stats = t.box.stats!;
    expect(stats.truncated).toBe(false);
    // Le chiffre exact dépend du moteur ; ce qui est verrouillé ici, c'est
    // l'ordre de grandeur : un pas coûte quelques centaines d'octets, pas
    // quelques kilo-octets. Si cette borne saute, le volume a changé de nature
    // et il faut revoir docs/replay.md.
    expect(stats.bytes / stats.eventCount).toBeLessThan(1200);
    // eslint-disable-next-line no-console
    console.log(
      `[replay] table à 4 sièges vidée : ${stats.eventCount} pas, ${stats.bytes} octets ` +
        `(${Math.round(stats.bytes / stats.eventCount)} o/pas)`,
    );
  });

  it('borne le stockage et le dit, plutôt que de tronquer en silence', () => {
    const t = recordedTable();
    t.room.startGame('seat_0');
    // On force la borne plutôt que de jouer vingt mille coups.
    const recorder = (t.room as unknown as { recorder: { record: (f: ReplayFrame) => void } }).recorder;
    const fat: ReplayFrame = {
      seq: 99_999,
      at: 0,
      actor: null,
      event: { type: 'CHAT', seat: 'seat_0', text: 'x'.repeat(REPLAY_LIMITS.maxBytes) },
      audience: { kind: 'ALL' },
    };
    recorder.record(fat);
    t.room.abandonReplay('TEST');
    expect(t.box.stats!.truncated).toBe(true);
  });
});

describe('bascule de point de vue', () => {
  it('rend à chaque siège exactement ce qu’il avait reçu, pas à pas', () => {
    const t = recordedTable(2, 3);
    for (const conn of t.seats) {
      conn.received.length = 0;
      conn.frames.length = 0;
    }
    t.room.startGame('seat_0');
    playALittle(t);
    t.room.abandonReplay('TEST');

    for (const [index, conn] of t.seats.entries()) {
      const seat = `seat_${index}`;
      // Ce que le socket a réellement porté, indexé par `seq`.
      const live = new Map<number, ServerEvent>();
      for (const message of conn.received) {
        if (message.t === 'event') live.set(message.seq, message);
      }

      let compared = 0;
      for (const frame of t.box.frames) {
        const expected = live.get(frame.seq);
        if (!expected) continue; // pas encore assis, ou frame antérieure à la capture
        const rebuilt = projectFrame(frame, seat);
        expect(rebuilt.event).toEqual(expected.event);
        expect(rebuilt.log ?? null).toEqual(expected.log ?? null);
        compared += 1;
      }
      // Le seuil n'est pas décoratif : sans lui, un bug qui viderait le flux
      // ferait passer la boucle ci-dessus sans rien comparer du tout.
      expect(compared).toBeGreaterThan(10);
    }
  });

  it('ne laisse pas fuir la main adverse dans la vue d’un siège', () => {
    const t = recordedTable(2, 5);
    t.room.startGame('seat_0');
    playALittle(t);
    t.room.abandonReplay('TEST');

    // Les identités que seul seat_0 connaît : sa bibliothèque.
    const secrets = new Set<string>();
    for (const id of t.room.state.zones.get('seat_0|LIBRARY') ?? []) {
      const obj = t.room.state.objects.get(id);
      if (obj) secrets.add(obj.card.scryfallId);
    }
    expect(secrets.size).toBeGreaterThan(5);

    const asBob = JSON.stringify([
      projectOrigin(t.box.origin!, 'seat_1'),
      ...t.box.frames.map((f) => projectFrame(f, 'seat_1')),
    ]);
    for (const secret of secrets) expect(asBob).not.toContain(`"${secret}"`);

    // Et la vue omnisciente, elle, les montre : c'est tout l'objet du replay.
    const asAll = JSON.stringify([
      projectOrigin(t.box.origin!, 'ALL'),
      ...t.box.frames.map((f) => projectFrame(f, 'ALL')),
    ]);
    for (const secret of secrets) expect(asAll).toContain(`"${secret}"`);
  });
});

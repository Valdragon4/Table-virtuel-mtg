/**
 * Fuzzing : on joue une longue séquence d'intents structurellement plausibles
 * et on audite les invariants après chacun.
 *
 * Le générateur vise le valide sans le garantir : un rejet (`ERR_*`) est un
 * résultat acceptable, une exception ou un invariant rompu ne l'est pas.
 */
import { describe, expect, it } from 'vitest';
import type { Intent, ObjectId, ZoneKind } from '@mtg/shared';
import { getZone, type GameState } from '../src/game/state.js';
import { seededRandom } from '../src/game/random.js';
import { IntentError } from '../src/game/errors.js';
import { auditInvariants } from './invariants.js';
import { deck, fakeConnection, seatTable, twoSeatTable, type FakeConnection } from './fixture.js';

const SEATS = ['seat_0', 'seat_1'] as const;
const PUBLIC_ZONES: ZoneKind[] = ['BATTLEFIELD', 'GRAVEYARD', 'EXILE', 'STACK_NOTE', 'FACEDOWN_TEMP'];

function pick<T>(rng: { below: (n: number) => number }, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[rng.below(items.length)];
}

function idsIn(state: GameState, seat: string, kind: ZoneKind): ObjectId[] {
  return [...getZone(state, { seat, kind })];
}

/** Un intent plausible tiré de l'état courant. */
function nextIntent(state: GameState, seat: string, rng: { below: (n: number) => number }): Intent {
  const other = seat === 'seat_0' ? 'seat_1' : 'seat_0';
  const battlefield = [...SEATS].flatMap((s) => idsIn(state, s, 'BATTLEFIELD'));
  const ownBattlefield = idsIn(state, seat, 'BATTLEFIELD');
  const hand = idsIn(state, seat, 'HAND');
  const graveyard = idsIn(state, seat, 'GRAVEYARD');
  const labels = [...state.labels.keys()];
  const pending = [...state.pendingLooks.values()].find((l) => l.seat === seat);

  // Une consultation ouverte doit être refermée : sinon la zone reste gelée et
  // la moitié des intents suivants seraient rejetés pour la même raison.
  if (pending && rng.below(3) > 0) {
    const half = rng.below(pending.cardIds.length + 1);
    return {
      type: 'RESOLVE_LOOK',
      lookId: pending.id,
      top: pending.cardIds.slice(0, half),
      bottom: pending.cardIds.slice(half),
      ...(rng.below(4) === 0 ? { shuffleAfter: true } : {}),
    };
  }

  const candidates: Intent[] = [
    { type: 'DRAW', count: 1 + rng.below(2) },
    { type: 'MILL', count: 1 + rng.below(3) },
    { type: 'EXILE_TOP', count: 1 + rng.below(2), faceDown: rng.below(2) === 0 },
    { type: 'SHUFFLE', zone: { seat, kind: 'LIBRARY' } },
    { type: 'LOOK', zone: { seat, kind: 'LIBRARY' }, count: 1 + rng.below(3), mode: 'SCRY' },
    { type: 'LOOK', zone: { seat, kind: 'LIBRARY' }, count: 'ALL', mode: 'SEARCH' },
    { type: 'UNTAP_ALL', seat },
    { type: 'END_TURN' },
    { type: 'SET_PHASE', phase: 'COMBAT' },
    { type: 'ROLL_DIE', sides: 20 },
    { type: 'FLIP_COIN' },
    { type: 'ADJUST_LIFE', seat: other, delta: rng.below(9) - 4 },
    { type: 'SET_PLAYER_COUNTER', seat, kind: 'poison', value: rng.below(11) },
    { type: 'ADD_LABEL', text: 'note', x: rng.below(100), y: rng.below(100) },
    { type: 'UNDO_LAST' },
    { type: 'REVEAL_HAND', toSeats: rng.below(2) === 0 ? 'ALL' : [other] },
    { type: 'UNREVEAL_HAND' },
    { type: 'MULLIGAN' },
    { type: 'RANDOM_DISCARD', count: 1 },
    { type: 'SET_SEAT_COSMETICS', playmatUrl: 'https://example.org/t.jpg' },
    { type: 'SET_PLAYER_COUNTER', seat, kind: 'commander_tax:inconnu', value: rng.below(9) },
  ];

  const commander = idsIn(state, seat, 'COMMAND')[0];
  if (commander) {
    candidates.push(
      {
        type: 'MOVE_CARD',
        cardId: commander,
        to: { seat, kind: 'BATTLEFIELD' },
        x: rng.below(50),
        y: rng.below(50),
      },
      { type: 'MOVE_CARD', cardId: commander, to: { seat, kind: 'COMMAND' } },
      { type: 'SET_PLAYER_COUNTER', seat, kind: `commander_tax:${commander}`, value: rng.below(9) },
    );
  }

  const sideboard = idsIn(state, seat, 'SIDEBOARD');
  candidates.push({
    type: 'SWAP_SIDEBOARD',
    in: sideboard.slice(0, 1),
    out: idsIn(state, seat, 'LIBRARY').slice(0, 1),
  });

  if (hand.length > 0) {
    const card = pick(rng, hand)!;
    candidates.push(
      {
        type: 'MOVE_CARD',
        cardId: card,
        to: { seat, kind: pick(rng, PUBLIC_ZONES)! },
        x: rng.below(200),
        y: rng.below(200),
        faceDown: rng.below(3) === 0,
      },
      { type: 'MOVE_CARD', cardId: card, to: { seat, kind: 'LIBRARY' }, index: 'BOTTOM' },
      { type: 'REVEAL', cardIds: [card], toSeats: rng.below(2) === 0 ? 'ALL' : [other] },
    );
    if (hand.length > 1) {
      candidates.push({
        type: 'MOVE_CARDS',
        cardIds: hand.slice(0, 2),
        to: { seat, kind: 'GRAVEYARD' },
      });
      // Destination illégale volontaire : la main d'un autre siège.
      candidates.push({ type: 'MOVE_CARDS', cardIds: [card], to: { seat: other, kind: 'HAND' } });
    }
  }

  if (battlefield.length > 0) {
    const target = pick(rng, battlefield)!;
    candidates.push(
      { type: 'TAP', cardIds: [target] },
      { type: 'UNTAP', cardIds: [target] },
      { type: 'ADD_COUNTER', targetId: target, kind: '+1/+1', delta: rng.below(5) - 2 },
      { type: 'REMOVE_COUNTER', targetId: target, kind: '+1/+1' },
      { type: 'SET_ROTATION', cardId: target, rotation: 90 },
      { type: 'DETACH', sourceId: target },
      { type: 'DESTROY_TOKEN', cardIds: [target] },
      { type: 'CREATE_TOKEN', copyOf: target, count: 1 + rng.below(3) },
      { type: 'MOVE_CARD', cardId: target, to: { seat, kind: 'GRAVEYARD' } },
    );
    const second = pick(rng, battlefield)!;
    if (second !== target) candidates.push({ type: 'ATTACH', sourceId: target, targetId: second });
  }

  if (ownBattlefield.length > 0) {
    const mine = pick(rng, ownBattlefield)!;
    candidates.push(
      { type: 'TURN_FACE_DOWN', cardId: mine },
      { type: 'TURN_FACE_UP', cardId: mine },
      { type: 'PEEK_FACE_DOWN', cardId: mine },
      { type: 'FLIP_FACE', cardId: mine },
    );
  }

  if (graveyard.length > 0) {
    candidates.push({
      type: 'MOVE_CARD',
      cardId: pick(rng, graveyard)!,
      to: { seat, kind: 'HAND' },
    });
  }

  if (labels.length > 0) {
    const label = pick(rng, labels)!;
    candidates.push(
      { type: 'MOVE_LABEL', labelId: label, x: 5, y: 5 },
      { type: 'REMOVE_LABEL', labelId: label },
    );
  }

  // Cartes d'un autre siège : la plupart de ces intents doivent être refusés.
  const foreign = pick(rng, idsIn(state, other, 'HAND'));
  if (foreign) {
    candidates.push({ type: 'MOVE_CARD', cardId: foreign, to: { seat, kind: 'HAND' } });
  }

  return pick(rng, candidates)!;
}

describe('fuzzing du moteur', () => {
  for (const seed of [1, 1337, 20260915]) {
    it(`garde les invariants sur 400 intents (graine ${seed})`, async () => {
      const { room, a, b } = twoSeatTable(seed);
      room.startGame('seat_0');
      auditInvariants(room.state, 'après START_GAME');

      const rng = seededRandom(seed * 7 + 3);
      const conns: Record<string, FakeConnection> = { seat_0: a, seat_1: b };
      const codes = new Set<string>();
      let applied = 0;

      for (let step = 0; step < 400; step++) {
        const seat = SEATS[rng.below(SEATS.length)]!;
        const conn = conns[seat]!;
        const intent = nextIntent(room.state, seat, rng);
        conn.received.length = 0;

        await room.handleIntent(conn, `f-${step}`, intent);

        const reject = conn.received.find((m) => m.t === 'reject');
        if (reject && reject.t === 'reject') codes.add(reject.code);
        else applied += 1;

        auditInvariants(room.state, `étape ${step} — ${intent.type}`);
      }

      // Aucune erreur interne : un rejet doit toujours être un refus décidé.
      expect([...codes]).not.toContain('ERR_INTERNAL');
      // Et la séquence doit avoir réellement joué, pas s'être fait rejeter en bloc.
      expect(applied).toBeGreaterThan(200);
    });
  }
});

describe('fuzzing des sièges', () => {
  for (const seed of [3, 4242]) {
    it(`garde les invariants quand les joueurs vont et viennent (graine ${seed})`, async () => {
      const table = seatTable(4, seed);
      const { room } = table;
      const rng = seededRandom(seed * 13 + 7);
      // Les connexions vivantes, indexées par siège. Un siège qui se lève sort
      // de la table ; un nouvel arrivant en reprend l'index, sans son matériel.
      const conns = new Map<string, FakeConnection>(
        table.seats.map((c, i) => [`seat_${i}`, c] as const),
      );
      let nextConn = 100;

      room.startGame('seat_0');
      auditInvariants(room.state, 'après START_GAME');
      const codes = new Set<string>();

      for (let step = 0; step < 300; step++) {
        const seated = [...conns.keys()].filter((id) => room.state.seats.has(id));
        if (seated.length === 0) break;
        const seat = seated[rng.below(seated.length)]!;
        const conn = conns.get(seat)!;

        const roll = rng.below(20);
        try {
          if (roll === 0) {
            // Se lever sans avoir concédé doit être refusé en pleine partie.
            room.standUp(conn);
            conns.delete(seat);
          } else if (roll === 1) {
            await room.handleIntent(conn, `c-${step}`, { type: 'CONCEDE' });
          } else if (roll === 2) {
            // Un siège libre se reprend, avec ou sans deck.
            const index = rng.below(4);
            if (!room.state.seats.has(`seat_${index}`)) {
              const arrivant = fakeConnection(`conn-${nextConn++}`);
              room.addConnection(arrivant);
              room.sitDown(arrivant, index, `Invité ${index}`, null);
              conns.set(`seat_${index}`, arrivant);
              if (rng.below(2) === 0) {
                room.loadDeck(
                  `seat_${index}`,
                  deck(`Deck ${index}`, Array.from({ length: 12 }, (_, i) => `Neuve ${index}-${i}`), `Cmd ${index}`),
                  null,
                );
              }
            }
          } else if (roll === 3) {
            room.removeConnection(conn.id);
            room.sweepLooks();
            room.resumeSeat(conn, room.state.seats.get(seat)!.seatToken);
            room.addConnection(conn);
          } else if (roll === 4 && room.state.hostSeat === seat) {
            room.restartGame(seat, rng.below(2) === 0);
          } else {
            conn.received.length = 0;
            await room.handleIntent(conn, `f-${step}`, nextIntent(room.state, seat, rng));
            const reject = conn.received.find((m) => m.t === 'reject');
            if (reject && reject.t === 'reject') codes.add(reject.code);
          }
        } catch (err) {
          // Un refus explicite est un résultat ; une exception brute, non.
          if (!(err instanceof IntentError)) throw err;
          codes.add(err.code);
        }

        auditInvariants(room.state, `étape ${step} (siège ${seat})`);
      }

      expect([...codes]).not.toContain('ERR_INTERNAL');
      // Les sièges restants doivent rester projetables sans exception.
      for (const id of room.state.seats.keys()) expect(room.snapshotFor(id).seq).toBe(room.state.seq);
    });
  }
});

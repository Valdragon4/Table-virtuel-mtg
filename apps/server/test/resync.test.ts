/**
 * Critère d'acceptation §12.3 et §12.5 : resynchronisation sans perte, et
 * cohérence des `seq` dans le flux d'un siège.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { fakeConnection, twoSeatTable } from './fixture.js';

function events(frames: string[]): ServerEvent[] {
  return frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event');
}

describe('resynchronisation', () => {
  it('rattrape un client absent par un delta, sans trou de séquence', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');

    const lastSeenByBob = room.state.seq;
    // Bob se déconnecte pendant qu'Alice continue de jouer.
    room.removeConnection(b.id);
    void room.handleIntent(a, 'c1', { type: 'DRAW', count: 2 });
    void room.handleIntent(a, 'c2', { type: 'ROLL_DIE', sides: 20 });
    void room.handleIntent(a, 'c3', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -3 });

    const delta = room.deltaFor('seat_1', lastSeenByBob);
    expect(delta).not.toBeNull();
    expect(delta!.length).toBeGreaterThan(0);

    // Séquence strictement croissante et sans trou sur ce que Bob a manqué.
    const seqs = delta!.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs.at(-1)).toBe(room.state.seq);
  });

  it('bascule sur un snapshot complet quand le client est trop en retard', () => {
    const { room } = twoSeatTable();
    // Un seq antérieur au tampon ne peut pas être rattrapé par delta.
    expect(room.deltaFor('seat_1', -1 as unknown as number)).toBeNull();
  });

  it('rend le même état au client reconnecté qu’à celui resté connecté', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    room.removeConnection(b.id);

    void room.handleIntent(a, 'c1', { type: 'DRAW', count: 3 });
    void room.handleIntent(a, 'c2', { type: 'ADJUST_LIFE', seat: 'seat_1', delta: -7 });

    const reconnected = fakeConnection('conn-b2');
    room.addConnection(reconnected);
    const resumed = room.resumeSeat(reconnected, room.state.seats.get('seat_1')!.seatToken);
    expect(resumed?.id).toBe('seat_1');

    const snapshot = room.snapshotFor('seat_1');
    expect(snapshot.seq).toBe(room.state.seq);
    expect(snapshot.seats.find((s) => s.id === 'seat_1')?.life).toBe(33);
    expect(snapshot.seats.find((s) => s.id === 'seat_0')?.handCount).toBe(10);
  });

  it('conserve le siège d’un joueur déconnecté', () => {
    const { room, b } = twoSeatTable();
    room.removeConnection(b.id);

    expect(room.state.seats.get('seat_1')).toBeDefined();
    expect(room.state.seats.get('seat_1')?.connected).toBe(false);
  });
});

describe('ordre des messages', () => {
  it('émet l’ack après l’event correspondant', async () => {
    const { room, a } = twoSeatTable();
    a.received.length = 0;

    await room.handleIntent(a, 'cid-1', { type: 'ROLL_DIE', sides: 6 });

    const kinds = a.received.map((m) => m.t);
    expect(kinds.indexOf('event')).toBeLessThan(kinds.indexOf('ack'));
  });

  it('garde des seq strictement croissants sur une rafale d’intents', async () => {
    const { room, a } = twoSeatTable();
    a.frames.length = 0;

    for (let i = 0; i < 50; i++) {
      await room.handleIntent(a, `cid-${i}`, { type: 'ROLL_DIE', sides: 6 });
    }

    const seqs = events(a.frames).map((e) => e.seq);
    expect(seqs).toHaveLength(50);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });
});

describe('verrou de consultation', () => {
  it('refuse de manipuler une carte en cours de consultation', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 2,
      mode: 'SCRY',
    });

    const locked = [...room.state.pendingLooks.values()][0]!.cardIds[0]!;
    a.received.length = 0;
    await room.handleIntent(a, 'move', {
      type: 'MOVE_CARD',
      cardId: locked,
      to: { seat: 'seat_0', kind: 'HAND' },
    });

    const reject = a.received.find((m) => m.t === 'reject');
    expect(reject).toMatchObject({ code: 'ERR_LOOK_PENDING' });
  });

  it('rend la bibliothèque à sa taille après une consultation résolue', async () => {
    const { room, a } = twoSeatTable();
    const before = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).length;

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    await room.handleIntent(a, 'resolve', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [look.cardIds[0]!],
      bottom: [look.cardIds[1]!, look.cardIds[2]!],
    });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(before);
    expect(room.state.pendingLooks.size).toBe(0);
  });
});

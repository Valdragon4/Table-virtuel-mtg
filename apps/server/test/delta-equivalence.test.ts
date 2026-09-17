/**
 * §8.1 : « Le snapshot est toujours construit par la même fonction de projection
 * que les events. » Le corollaire testable est celui-ci : un client rattrapé par
 * delta doit arriver exactement où arrive un client rattrapé par snapshot.
 *
 * C'est le test le plus sévère du serveur : tout intent qui modifie l'état sans
 * émettre l'event correspondant fait diverger les deux chemins.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { LIMITS } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { applyEvent, fromSnapshot, normalize } from './client-model.js';
import { fakeConnection, twoSeatTable } from './fixture.js';

function eventsOf(conn: { frames: string[] }): ServerEvent[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event');
}

describe('équivalence delta / snapshot', () => {
  it('amène le client rattrapé par delta au même état que par snapshot', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    // Point de départ commun : Bob a le snapshot de cet instant.
    const start = room.state.seq;
    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;

    const aliceHand = () => getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    const bobHand = () => getZone(room.state, { seat: 'seat_1', kind: 'HAND' });

    await room.handleIntent(a, 'i1', { type: 'DRAW', count: 2 });
    await room.handleIntent(a, 'i2', {
      type: 'MOVE_CARD',
      cardId: aliceHand()[0]!,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 30,
      y: 40,
    });
    const permanent = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;
    await room.handleIntent(a, 'i3', { type: 'TAP', cardIds: [permanent] });
    await room.handleIntent(a, 'i4', { type: 'ADD_COUNTER', targetId: permanent, kind: '+1/+1', delta: 3 });
    await room.handleIntent(a, 'i5', { type: 'CREATE_TOKEN', copyOf: permanent, count: 2 });
    await room.handleIntent(b, 'i6', { type: 'MILL', count: 3 });
    await room.handleIntent(b, 'i7', {
      type: 'MOVE_CARD',
      cardId: bobHand()[0]!,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
      x: 10,
      y: 10,
    });
    const bobPermanent = getZone(room.state, { seat: 'seat_1', kind: 'BATTLEFIELD' })[0]!;
    await room.handleIntent(b, 'i8', { type: 'ATTACH', sourceId: bobPermanent, targetId: bobPermanent });
    await room.handleIntent(a, 'i9', { type: 'ADJUST_LIFE', seat: 'seat_1', delta: -9 });
    await room.handleIntent(a, 'i10', { type: 'ADD_LABEL', text: 'ici', x: 1, y: 2 });
    await room.handleIntent(b, 'i11', { type: 'REVEAL_HAND', toSeats: 'ALL' });
    await room.handleIntent(b, 'i12', { type: 'UNREVEAL_HAND' });
    await room.handleIntent(a, 'i13', { type: 'RANDOM_DISCARD', count: 1 });
    await room.handleIntent(a, 'i14', { type: 'EXILE_TOP', count: 2, faceDown: true });
    await room.handleIntent(a, 'i15', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
    await room.handleIntent(b, 'i16', { type: 'MULLIGAN' });
    await room.handleIntent(a, 'i17', {
      type: 'MOVE_CARD',
      cardId: aliceHand()[0]!,
      to: { seat: 'seat_0', kind: 'LIBRARY' },
      index: 'BOTTOM',
    });
    await room.handleIntent(a, 'i18', { type: 'SCOOP' });

    const delta = room.deltaFor('seat_1', start);
    expect(delta).not.toBeNull();
    for (const frame of delta!) applyEvent(model, frame);

    const rebuilt = fromSnapshot(room.snapshotFor('seat_1'));
    expect(normalize(model)).toEqual(normalize(rebuilt));
    expect(model.seq).toBe(room.state.seq);
  });

  it('donne le même résultat que le flux temps réel reçu par le siège', async () => {
    const { room, a, b } = twoSeatTable(11);
    room.startGame('seat_0');
    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;

    await room.handleIntent(a, 'j1', { type: 'DRAW', count: 1 });
    await room.handleIntent(a, 'j2', { type: 'MILL', count: 2 });
    await room.handleIntent(a, 'j3', { type: 'UNTAP_ALL' });

    // Ce que Bob a reçu en direct, et ce qu'il aurait reçu en rattrapage,
    // doivent être le même flux.
    for (const frame of eventsOf(b)) applyEvent(model, frame);
    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
  });
});

describe('tampon de resynchronisation', () => {
  it('rend un delta vide quand le client est déjà à jour', () => {
    const { room } = twoSeatTable();
    expect(room.deltaFor('seat_1', room.state.seq)).toEqual([]);
  });

  it('bascule sur snapshot quand le client est en avance sur le serveur', () => {
    const { room } = twoSeatTable();
    // Room recréée, serveur redémarré : le client annonce un seq qui n'existe pas.
    expect(room.deltaFor('seat_1', room.state.seq + 50)).toBeNull();
  });

  it('bascule sur snapshot pour une connexion sans siège', () => {
    const { room } = twoSeatTable();
    expect(room.deltaFor(null, 0)).toBeNull();
  });

  it('bascule sur snapshot quand le tampon a débordé', async () => {
    const { room, a } = twoSeatTable();
    const start = room.state.seq;

    // Un event par intent : on dépasse franchement la capacité du tampon.
    for (let i = 0; i < LIMITS.eventBuffer + 50; i++) {
      await room.handleIntent(a, `r-${i}`, { type: 'SET_PHASE', phase: 'MAIN1' });
    }

    expect(room.deltaFor('seat_0', start)).toBeNull();
    // Mais la fenêtre encore couverte reste rattrapable, sans trou.
    const recent = room.state.seq - 10;
    const delta = room.deltaFor('seat_0', recent);
    expect(delta).not.toBeNull();
    expect(delta!.map((e) => e.seq)).toEqual(
      Array.from({ length: 10 }, (_, i) => recent + 1 + i),
    );
  }, 30_000);

  it('ne donne à un siège que les variantes qui lui étaient destinées', async () => {
    const { room, a, b } = twoSeatTable();
    const start = room.state.seq;
    await room.handleIntent(a, 'p1', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SCRY',
    });

    const forBob = room.deltaFor('seat_1', start)!;
    const forAlice = room.deltaFor('seat_0', start)!;
    expect(forAlice.some((e) => e.event.type === 'LOOK_RESULT')).toBe(true);
    expect(forBob.some((e) => e.event.type === 'LOOK_RESULT')).toBe(false);
    // Le delta de Bob ne contient aucune identité de carte.
    expect(JSON.stringify(forBob)).not.toContain('"scryfallId"');
    void b;
  });
});

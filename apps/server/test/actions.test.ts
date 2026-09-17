/** Actions de bibliothèque et de main ajoutées d'après la table de référence. */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { twoSeatTable } from './fixture.js';

describe('meule et exil du dessus', () => {
  it('déplace les bonnes cartes et met les comptes à jour', async () => {
    const { room, a } = twoSeatTable();
    const before = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).length;

    await room.handleIntent(a, 'mill', { type: 'MILL', count: 3 });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(before - 3);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })).toHaveLength(3);
  });

  it('exile face cachée quand on le demande', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'exile', { type: 'EXILE_TOP', count: 2, faceDown: true });

    const exiled = getZone(room.state, { seat: 'seat_0', kind: 'EXILE' });
    expect(exiled).toHaveLength(2);

    // L'adversaire voit deux cartes en exil, sans leur identité.
    const forBob = room.snapshotFor('seat_1').cards.filter((c) => c.zone.kind === 'EXILE');
    expect(forBob).toHaveLength(2);
    expect(forBob.every((c) => c.faceDown === true)).toBe(true);
    expect(b.frames.join('\n')).not.toContain('"scryfallId"');
  });
});

describe('défausse au hasard', () => {
  it('est tirée par le serveur et finit au cimetière', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'discard', { type: 'RANDOM_DISCARD', count: 2 });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(5);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })).toHaveLength(2);
  });

  it('refuse une main vide plutôt que de ne rien faire', async () => {
    const { room, a } = twoSeatTable();
    a.received.length = 0;

    await room.handleIntent(a, 'discard', { type: 'RANDOM_DISCARD', count: 1 });

    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_BAD_ZONE' });
  });
});

describe('rangement du jeu', () => {
  it('remet tout en bibliothèque, garde le commandant et détruit les jetons', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand[0]!,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 10,
      y: 10,
    });
    await room.handleIntent(a, 'token', { type: 'CREATE_TOKEN', copyOf: getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]! });
    expect(getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })).toHaveLength(2);

    await room.handleIntent(a, 'scoop', { type: 'SCOOP' });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })).toHaveLength(0);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(0);
    // 20 cartes de deck, toutes de retour ; le commandant reste en zone de commandement.
    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(20);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })).toHaveLength(1);
  });
});

describe('droits sur les cartes', () => {
  it("refuse de manipuler la main d'un autre siège", async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const bobHand = getZone(room.state, { seat: 'seat_1', kind: 'HAND' })[0]!;
    a.received.length = 0;

    await room.handleIntent(a, 'steal', {
      type: 'MOVE_CARD',
      cardId: bobHand,
      to: { seat: 'seat_0', kind: 'HAND' },
    });

    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_YOURS' });
    expect(getZone(room.state, { seat: 'seat_1', kind: 'HAND' })).toContain(bobHand);
    void b;
  });

  it('laisse engager le permanent d’autrui — modèle « vraie table »', async () => {
    const { room, a, b } = twoSeatTable();
    // seat_0 est l'hôte : c'est lui qui lance, même si c'est Bob qui jouera la carte.
    room.startGame('seat_0');

    const bobHand = getZone(room.state, { seat: 'seat_1', kind: 'HAND' })[0]!;
    await room.handleIntent(b, 'play', {
      type: 'MOVE_CARD',
      cardId: bobHand,
      to: { seat: 'seat_1', kind: 'BATTLEFIELD' },
      x: 5,
      y: 5,
    });
    const permanent = getZone(room.state, { seat: 'seat_1', kind: 'BATTLEFIELD' })[0]!;

    await room.handleIntent(a, 'tap', { type: 'TAP', cardIds: [permanent] });

    expect(room.state.objects.get(permanent)?.tapped).toBe(true);
  });
});

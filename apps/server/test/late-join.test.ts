/**
 * Un joueur peut s'installer après le début de la partie.
 *
 * Cas très courant : la table lance pendant qu'un quatrième finit de coller sa
 * liste. Le refuser condamnait ce joueur à rester assis sans deck jusqu'à la fin.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { deck, fakeConnection, twoSeatTable } from './fixture.js';

describe('arrivée en cours de partie', () => {
  it('laisse un retardataire charger son deck', async () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const late = fakeConnection('conn-c');
    room.addConnection(late);
    room.sitDown(late, 2, 'Carol', null);

    const names = Array.from({ length: 12 }, (_, i) => `Carte C${i + 1}`);
    expect(() => room.loadDeck('seat_2', deck('Deck Carol', names, 'Kenrith C'), null)).not.toThrow();

    expect(getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' })).toHaveLength(12);
    expect(getZone(room.state, { seat: 'seat_2', kind: 'COMMAND' })).toHaveLength(1);
  });

  it('refuse en revanche de remplacer un deck déjà en jeu', () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const names = Array.from({ length: 12 }, (_, i) => `Autre ${i + 1}`);
    expect(() => room.loadDeck('seat_0', deck('Deck bis', names), null)).toThrow(
      /déjà un deck en jeu/,
    );
    // L'état d'Alice est intact : main d'ouverture toujours là.
    expect(getZone(room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(7);
  });

  it('laisse le retardataire piocher aussitôt', async () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const late = fakeConnection('conn-c');
    room.addConnection(late);
    room.sitDown(late, 2, 'Carol', null);
    const names = Array.from({ length: 12 }, (_, i) => `Carte C${i + 1}`);
    room.loadDeck('seat_2', deck('Deck Carol', names), null);

    await room.handleIntent(late, 'draw', { type: 'DRAW', count: 7 });

    expect(getZone(room.state, { seat: 'seat_2', kind: 'HAND' })).toHaveLength(7);
    expect(getZone(room.state, { seat: 'seat_2', kind: 'LIBRARY' })).toHaveLength(5);
  });

  it("n'expose pas la main du retardataire aux autres sièges", () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const late = fakeConnection('conn-c');
    room.addConnection(late);
    room.sitDown(late, 2, 'Carol', null);
    const names = Array.from({ length: 12 }, (_, i) => `Carte C${i + 1}`);
    room.loadDeck('seat_2', deck('Deck Carol', names), null);

    const forAlice = room.snapshotFor('seat_0');
    expect(forAlice.cards.some((c) => c.zone.seat === 'seat_2' && c.faceDown === false && c.zone.kind === 'HAND')).toBe(false);
  });
});

describe('avant le lancement', () => {
  it('laisse changer de pseudo', async () => {
    const { room, a } = twoSeatTable();

    await room.handleIntent(a, 'name', { type: 'SET_SEAT_COSMETICS', displayName: 'Alix' });

    expect(room.state.seats.get('seat_0')?.displayName).toBe('Alix');
  });

  it('laisse changer de deck', () => {
    const { room } = twoSeatTable();
    const names = Array.from({ length: 12 }, (_, i) => `Autre ${i + 1}`);

    expect(() => room.loadDeck('seat_0', deck('Second deck', names, 'Autre commandant'), null)).not.toThrow();

    expect(room.state.seats.get('seat_0')?.deckName).toBe('Second deck');
    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(12);
  });

  it('refuse le changement de pseudo une fois la partie lancée', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    a.received.length = 0;

    await room.handleIntent(a, 'name', { type: 'SET_SEAT_COSMETICS', displayName: 'Alix' });

    // Le journal déjà écrit nomme les joueurs : le renommage le rendrait faux.
    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_GAME_ALREADY_STARTED' });
    expect(room.state.seats.get('seat_0')?.displayName).toBe('Alice');
  });

  it('laisse changer de tapis même en cours de partie', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'mat', {
      type: 'SET_SEAT_COSMETICS',
      playmatUrl: 'https://example.org/tapis.jpg',
    });

    expect(room.state.seats.get('seat_0')?.playmatUrl).toBe('https://example.org/tapis.jpg');
  });
});

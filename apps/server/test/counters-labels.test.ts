/**
 * Compteurs de joueur supprimables, compteurs libres posables sur la table, et
 * commandant préservé au rangement.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { twoSeatTable } from './fixture.js';

describe('compteurs de joueur', () => {
  it('se créent et se modifient', async () => {
    const { room, a } = twoSeatTable();

    await room.handleIntent(a, 'c1', { type: 'SET_PLAYER_COUNTER', seat: 'seat_0', kind: 'poison', value: 3 });

    expect(room.state.seats.get('seat_0')?.playerCounters.get('poison')).toBe(3);
  });

  it('disparaissent quand on les remet à zéro', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'c1', { type: 'SET_PLAYER_COUNTER', seat: 'seat_0', kind: 'énergie', value: 5 });

    await room.handleIntent(a, 'c2', { type: 'SET_PLAYER_COUNTER', seat: 'seat_0', kind: 'énergie', value: 0 });

    // Zéro vaut suppression : c'est ce qui permet de retirer un compteur posé
    // par erreur, plutôt que de laisser une ligne morte à la table.
    expect(room.state.seats.get('seat_0')?.playerCounters.has('énergie')).toBe(false);
    const summary = room.snapshotFor('seat_1').seats.find((s) => s.id === 'seat_0');
    expect(summary?.playerCounters.some((c) => c.kind === 'énergie')).toBe(false);
  });

  it('sont visibles de toute la table', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'c1', { type: 'SET_PLAYER_COUNTER', seat: 'seat_0', kind: 'expérience', value: 2 });

    const seen = room.snapshotFor('seat_1').seats.find((s) => s.id === 'seat_0');
    expect(seen?.playerCounters).toContainEqual({ kind: 'expérience', value: 2 });
  });
});

describe('compteurs libres sur la table', () => {
  it('se posent avec une valeur, n’importe où', async () => {
    const { room, a } = twoSeatTable();

    await room.handleIntent(a, 'l1', { type: 'ADD_LABEL', text: 'Orage', x: 420, y: 130, value: 3 });

    const label = [...room.state.labels.values()][0];
    expect(label).toMatchObject({ text: 'Orage', x: 420, y: 130, value: 3 });
  });

  it('se modifient en place', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'l1', { type: 'ADD_LABEL', text: '2/2', x: 10, y: 10, value: 2 });
    const id = [...room.state.labels.keys()][0]!;

    await room.handleIntent(a, 'l2', { type: 'SET_LABEL', labelId: id, value: 7 });

    expect(room.state.labels.get(id)?.value).toBe(7);
  });

  it('redeviennent une simple note quand on retire la valeur', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'l1', { type: 'ADD_LABEL', text: 'Note', x: 0, y: 0, value: 4 });
    const id = [...room.state.labels.keys()][0]!;

    await room.handleIntent(a, 'l2', { type: 'SET_LABEL', labelId: id, value: null });

    expect(room.state.labels.get(id)?.value).toBeUndefined();
    expect(room.state.labels.get(id)?.text).toBe('Note');
  });

  it('sont modifiables par n’importe quel siège — modèle « vraie table »', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(a, 'l1', { type: 'ADD_LABEL', text: 'Compteur', x: 0, y: 0, value: 1 });
    const id = [...room.state.labels.keys()][0]!;
    b.received.length = 0;

    await room.handleIntent(b, 'l2', { type: 'SET_LABEL', labelId: id, value: 2 });

    expect(b.received.find((m) => m.t === 'reject')).toBeUndefined();
    expect(room.state.labels.get(id)?.value).toBe(2);
  });

  it('parviennent à toute la table', async () => {
    const { room, a, b } = twoSeatTable();
    b.frames.length = 0;

    await room.handleIntent(a, 'l1', { type: 'ADD_LABEL', text: 'X/X', x: 5, y: 5, value: 1 });

    expect(b.frames.join('\n')).toContain('LABEL_ADDED');
  });
});

describe('rangement du jeu', () => {
  it('renvoie le commandant en zone de commandement, pas dans la bibliothèque', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    // Le commandant part sur le champ de bataille, comme s'il avait été lancé.
    const commander = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(a, 'cast', {
      type: 'MOVE_CARD',
      cardId: commander,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 20,
      y: 20,
    });
    expect(getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })).toHaveLength(0);

    await room.handleIntent(a, 'scoop', { type: 'SCOOP' });

    // Il revient chez lui, et la bibliothèque ne contient que le deck.
    expect(getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })).toHaveLength(1);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })).toHaveLength(20);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })).toHaveLength(0);
  });

  it('laisse le commandant en place s’il n’a pas bougé', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'scoop', { type: 'SCOOP' });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })).toHaveLength(1);
  });
});

describe('placement des jetons', () => {
  it('étale plusieurs exemplaires au lieu de les empiler', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    // On copie une carte du champ pour ne pas dépendre de la base de cartes.
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 400,
      y: 400,
    });
    const source = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;

    await room.handleIntent(a, 'tokens', { type: 'CREATE_TOKEN', copyOf: source, count: 3, x: 10, y: 10 });

    const tokens = [...room.state.objects.values()].filter((o) => o.kind === 'TOKEN');
    expect(tokens).toHaveLength(3);
    const positions = tokens.map((t) => `${t.x},${t.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  it('ne pose pas un jeton exactement sur un autre', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'play', {
      type: 'MOVE_CARD',
      cardId: hand,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 400,
      y: 400,
    });
    const source = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' })[0]!;

    // Deux créations successives au même point : un joueur qui clique deux fois.
    await room.handleIntent(a, 't1', { type: 'CREATE_TOKEN', copyOf: source, x: 60, y: 60 });
    await room.handleIntent(a, 't2', { type: 'CREATE_TOKEN', copyOf: source, x: 60, y: 60 });

    const tokens = [...room.state.objects.values()].filter((o) => o.kind === 'TOKEN');
    expect(tokens).toHaveLength(2);
    expect(`${tokens[0]!.x},${tokens[0]!.y}`).not.toBe(`${tokens[1]!.x},${tokens[1]!.y}`);
  });
});

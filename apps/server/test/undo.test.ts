/**
 * Annulation : ce qui s'annule, ce qui ne s'annule pas, et ce que le joueur en
 * apprend. Le refus doit dire la vraie raison — invoquer le délai après un
 * mélange fait croire qu'on a été trop lent, alors que rien n'aurait marché.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { twoSeatTable } from './fixture.js';

function lastReject(conn: { received: Array<{ t: string }> }): { message?: string } | undefined {
  return [...conn.received].reverse().find((m) => m.t === 'reject') as { message?: string } | undefined;
}

describe('annulation d’un lot', () => {
  it('ramène toutes les cartes du lot, pas seulement une', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    const hand = [...getZone(room.state, { seat: 'seat_0', kind: 'HAND' })].slice(0, 3);
    await room.handleIntent(a, 'move', {
      type: 'MOVE_CARDS',
      cardIds: hand,
      to: { seat: 'seat_0', kind: 'GRAVEYARD' },
    });
    expect(getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })).toHaveLength(3);

    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })).toHaveLength(0);
    expect(getZone(room.state, { seat: 'seat_0', kind: 'HAND' })).toHaveLength(7);
  });
});

describe('refus d’annulation', () => {
  it('dit qu’un mélange ne s’annule pas, au lieu d’invoquer le délai', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'shuffle', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
    a.received.length = 0;

    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)?.message).toMatch(/mélange.*annule pas/i);
  });

  it('dit qu’une pioche ne s’annule pas', async () => {
    const { room, a } = twoSeatTable();
    await room.handleIntent(a, 'draw', { type: 'DRAW', count: 1 });
    a.received.length = 0;

    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)?.message).toMatch(/pioche.*annule pas/i);
  });

  it('invoque bien le délai quand il n’y a eu aucune action', async () => {
    const { room, a } = twoSeatTable();
    a.received.length = 0;

    await room.handleIntent(a, 'undo', { type: 'UNDO_LAST' });

    expect(lastReject(a)?.message).toMatch(/dix dernières secondes/i);
  });
});

describe('journal', () => {
  it('annonce un détachement', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');

    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    for (const id of hand.slice(0, 2)) {
      await room.handleIntent(a, `play-${id}`, {
        type: 'MOVE_CARD',
        cardId: id,
        to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
        x: 10,
        y: 10,
      });
    }
    const [source, target] = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' });
    await room.handleIntent(a, 'attach', { type: 'ATTACH', sourceId: source!, targetId: target! });
    b.frames.length = 0;

    await room.handleIntent(a, 'detach', { type: 'DETACH', sourceId: source! });

    // Attacher écrivait une ligne, détacher aucune : le geste passait inaperçu.
    expect(b.frames.join('\n')).toContain('a détaché');
  });

  it('n’annonce rien si la carte n’était pas attachée', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    b.frames.length = 0;

    await room.handleIntent(a, 'detach', { type: 'DETACH', sourceId: hand });

    expect(b.frames.join('\n')).not.toContain('a détaché');
  });
});

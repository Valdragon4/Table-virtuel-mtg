/**
 * Dégâts de commandant : lecture ouverte, écriture réservée au receveur.
 *
 * Seule entorse assumée au modèle « vraie table » (docs/protocol.md §6.6) :
 * déclarer soi-même avoir tué un adversaire aux dégâts de commandant reviendrait
 * à prononcer son élimination à sa place.
 */
import { describe, expect, it } from 'vitest';
import { twoSeatTable } from './fixture.js';

describe('écriture', () => {
  it('laisse un joueur enregistrer les dégâts qu’il reçoit', async () => {
    const { room, b } = twoSeatTable();

    await room.handleIntent(b, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: 'cmd-1',
      value: 7,
    });

    expect(room.state.seats.get('seat_1')?.commanderDamage.get('seat_0')?.get('cmd-1')).toBe(7);
  });

  it('refuse d’écrire les dégâts reçus par quelqu’un d’autre', async () => {
    const { room, a } = twoSeatTable();
    a.received.length = 0;

    await room.handleIntent(a, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: 'cmd-1',
      value: 21,
    });

    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_YOURS' });
    expect(room.state.seats.get('seat_1')?.commanderDamage.size).toBe(0);
  });

  it('refuse même de se déclarer vainqueur en annulant les dégâts d’un autre', async () => {
    const { room, a, b } = twoSeatTable();
    await room.handleIntent(b, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: 'cmd-1',
      value: 12,
    });
    a.received.length = 0;

    await room.handleIntent(a, 'reset', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: 'cmd-1',
      value: 0,
    });

    expect(a.received.find((m) => m.t === 'reject')).toMatchObject({ code: 'ERR_NOT_YOURS' });
    expect(room.state.seats.get('seat_1')?.commanderDamage.get('seat_0')?.get('cmd-1')).toBe(12);
  });
});

describe('lecture', () => {
  it('projette la matrice de tous les sièges vers tous les sièges', async () => {
    const { room, a, b } = twoSeatTable();

    await room.handleIntent(b, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: 'cmd-1',
      value: 9,
    });
    await room.handleIntent(a, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_1',
      to: 'seat_0',
      commanderId: 'cmd-2',
      value: 4,
    });

    // Chacun voit les deux lignes, la sienne comme celle de l'adversaire.
    for (const seat of ['seat_0', 'seat_1'] as const) {
      const snapshot = room.snapshotFor(seat);
      const alice = snapshot.seats.find((s) => s.id === 'seat_0');
      const bob = snapshot.seats.find((s) => s.id === 'seat_1');
      expect(bob?.commanderDamage['seat_0']?.['cmd-1']).toBe(9);
      expect(alice?.commanderDamage['seat_1']?.['cmd-2']).toBe(4);
    }
  });

  it('diffuse le changement à toute la table', async () => {
    const { room, a, b } = twoSeatTable();
    a.frames.length = 0;

    await room.handleIntent(b, 'dmg', {
      type: 'SET_COMMANDER_DAMAGE',
      from: 'seat_0',
      to: 'seat_1',
      commanderId: 'cmd-1',
      value: 5,
    });

    expect(a.frames.join('\n')).toContain('COMMANDER_DAMAGE_CHANGED');
  });
});

/**
 * Densité de la séquence : chaque `seq` atteint chaque siège.
 *
 * Le bug que ces tests verrouillent : un event adressé à un sous-ensemble de
 * sièges et **sans ligne de journal** — `LOOK_RESULT`, typiquement — ne laissait
 * rien aux autres sièges pour son `seq`, parce que le remplissage `NOTED` était
 * conditionné à la présence d'un journal. L'event suivant arrivait donc en trou
 * de séquence chez eux, déclenchait un `resync` par event manquant, et chaque
 * `hello/delta` rejouait les mêmes lignes de journal : le même message s'affichait
 * trois fois.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { twoSeatTable } from './fixture.js';

function eventsOf(conn: { frames: string[] }): ServerEvent[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event');
}

/** Les `seq` reçus forment-ils `from+1, from+2, …, to` sans trou ni doublon ? */
function expectDense(seqs: number[], from: number, to: number): void {
  expect(seqs).toEqual(Array.from({ length: to - from }, (_, i) => from + 1 + i));
}

describe('densité de la séquence pour les sièges observateurs', () => {
  it('ne laisse aucun trou à travers un cycle LOOK → RESOLVE_LOOK', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const before = room.state.seq;
    b.frames.length = 0;

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 1,
      mode: 'REVEAL',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [],
      bottom: [],
      toBattlefield: [look.cardIds[0]!],
    });

    // Bob n'est dans l'audience ni du `LOOK_RESULT`, ni des mouvements de
    // cartes de bibliothèque : il doit malgré tout avoir un message par `seq`.
    expectDense(eventsOf(b).map((e) => e.seq), before, room.state.seq);
  });

  it('remplit aussi les seq d’un event réservé à un siège, sans journal', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const before = room.state.seq;
    b.frames.length = 0;

    // `DRAW` déplace des cartes que Bob ne voit pas, puis republie des comptes.
    await room.handleIntent(a, 'draw', { type: 'DRAW', count: 3 });

    expectDense(eventsOf(b).map((e) => e.seq), before, room.state.seq);
  });

  it('rend un delta dense, pour que le rattrapage ne recrée pas de trou', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const since = room.state.seq;

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 2,
      mode: 'SCRY',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [look.cardIds[0]!],
      bottom: [look.cardIds[1]!],
    });

    const delta = room.deltaFor('seat_1', since);
    expect(delta).not.toBeNull();
    expectDense(delta!.map((e) => e.seq), since, room.state.seq);
  });
});

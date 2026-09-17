/**
 * Une carte face cachée le reste quand on la déplace.
 *
 * Le défaut observé en jouant : une carte posée face cachée sur le champ de
 * bataille, envoyée à l'exil ou au cimetière, se retournait face visible pour
 * toute la table. `relocate()` écrivait `faceDown = opts.faceDown ?? false` :
 * l'absence de demande valait « retourne-la », alors qu'elle ne veut rien dire
 * du tout. C'est une fuite d'information cachée, donc le défaut le plus grave
 * qu'on puisse avoir ici.
 *
 * La règle retenue, vérifiée ci-dessous dans les deux sens :
 *
 * - une carte qui vient d'une **zone publique** (champ de bataille, cimetière,
 *   exil, commandement, pile) garde son état : face cachée elle le reste, face
 *   visible elle le reste ;
 * - une carte qui vient d'une **zone cachée** (main, bibliothèque, réserve,
 *   pile face cachée) arrive face visible, sauf `faceDown: true` explicite —
 *   sans quoi jouer une carte de sa main la poserait face cachée ;
 * - `faceDown` explicite gagne toujours, dans les deux sens.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { twoSeatTable } from './fixture.js';

/** Pose la première carte de la main d'Alice sur le champ, face cachée. */
async function faceDownOnBattlefield(table: ReturnType<typeof twoSeatTable>) {
  const { room, a } = table;
  room.startGame('seat_0');
  const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
  await room.handleIntent(a, 'pose', {
    type: 'MOVE_CARD',
    cardId,
    to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
    faceDown: true,
    x: 100,
    y: 100,
  });
  expect(room.state.objects.get(cardId)?.faceDown).toBe(true);
  return cardId;
}

/** Ce que le siège `seat` voit de cet objet dans son snapshot. */
function viewOf(room: ReturnType<typeof twoSeatTable>['room'], seat: string, cardId: string) {
  return room.snapshotFor(seat).cards.find((c) => c.id === cardId);
}

describe('une carte face cachée le reste quand elle change de zone', () => {
  it('du champ de bataille vers l’exil, sans faceDown explicite', async () => {
    const table = twoSeatTable();
    const { room, a, b } = table;
    const cardId = await faceDownOnBattlefield(table);

    b.frames.length = 0;
    await room.handleIntent(a, 'exil', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'EXILE' },
    });

    const obj = room.state.objects.get(cardId)!;
    expect(obj.zone.kind).toBe('EXILE');
    expect(obj.faceDown).toBe(true);
    // Bob la voit, sans son identité — et rien de son identité n'a traversé.
    expect(viewOf(room, 'seat_1', cardId)).toMatchObject({ faceDown: true });
    expect(b.frames.join('\n')).not.toContain(`"${obj.card.scryfallId}"`);
    // Alice, elle, voit toujours sa carte, et sait qu'elle est cachée aux autres.
    expect(viewOf(room, 'seat_0', cardId)).toMatchObject({
      faceDown: false,
      facedownOnTable: true,
    });
  });

  it('du champ de bataille vers le cimetière et vers la pile', async () => {
    for (const kind of ['GRAVEYARD', 'STACK_NOTE'] as const) {
      const table = twoSeatTable();
      const { room, a } = table;
      const cardId = await faceDownOnBattlefield(table);

      await room.handleIntent(a, 'mv', {
        type: 'MOVE_CARD',
        cardId,
        to: { seat: 'seat_0', kind },
      });

      const obj = room.state.objects.get(cardId)!;
      expect(obj.zone.kind).toBe(kind);
      expect(obj.faceDown).toBe(true);
      expect(viewOf(room, 'seat_1', cardId)).toMatchObject({ faceDown: true });
    }
  });

  it('en lot (MOVE_CARDS), comme à l’unité', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await faceDownOnBattlefield(table);

    await room.handleIntent(a, 'lot', {
      type: 'MOVE_CARDS',
      cardIds: [cardId],
      to: { seat: 'seat_0', kind: 'EXILE' },
    });

    expect(room.state.objects.get(cardId)?.faceDown).toBe(true);
  });

  it('mais une carte face visible ne devient pas cachée en changeant de zone', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'pose', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 10,
      y: 10,
    });
    expect(room.state.objects.get(cardId)?.faceDown).toBe(false);

    await room.handleIntent(a, 'cim', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'GRAVEYARD' },
    });
    expect(room.state.objects.get(cardId)?.faceDown).toBe(false);
    expect(viewOf(room, 'seat_1', cardId)).toMatchObject({ faceDown: false });
  });

  it('et `faceDown: false` explicite la retourne', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const cardId = await faceDownOnBattlefield(table);

    await room.handleIntent(a, 'exil', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'EXILE' },
      faceDown: false,
    });

    expect(room.state.objects.get(cardId)?.faceDown).toBe(false);
    expect(viewOf(room, 'seat_1', cardId)).toMatchObject({ faceDown: false });
  });

  it('jouer une carte de sa main la pose face visible, comme avant', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;

    await room.handleIntent(a, 'jouer', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 0,
      y: 0,
    });

    expect(room.state.objects.get(cardId)?.faceDown).toBe(false);
  });
});

describe('exiler face cachée depuis n’importe quelle zone', () => {
  it('depuis la main — MOVE_CARD { faceDown: true }', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;

    b.frames.length = 0;
    await room.handleIntent(a, 'exil', {
      type: 'MOVE_CARD',
      cardId,
      to: { seat: 'seat_0', kind: 'EXILE' },
      faceDown: true,
    });

    const obj = room.state.objects.get(cardId)!;
    expect(obj.zone.kind).toBe('EXILE');
    expect(obj.faceDown).toBe(true);
    expect(viewOf(room, 'seat_1', cardId)).toMatchObject({ faceDown: true });
    expect(b.frames.join('\n')).not.toContain(`"${obj.card.scryfallId}"`);
  });

  it('depuis la main, en lot — MOVE_CARDS { faceDown: true }', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const cardIds = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 2);

    await room.handleIntent(a, 'lot', {
      type: 'MOVE_CARDS',
      cardIds,
      to: { seat: 'seat_0', kind: 'EXILE' },
      faceDown: true,
    });

    for (const id of cardIds) expect(room.state.objects.get(id)?.faceDown).toBe(true);
  });

  it('depuis une fouille de bibliothèque — RESOLVE_LOOK { exileFaceDown: true }', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SEARCH',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const picked = look.cardIds[0]!;

    b.frames.length = 0;
    await room.handleIntent(a, 'resolve', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [],
      bottom: [],
      toExile: [picked],
      exileFaceDown: true,
      shuffleAfter: true,
    });

    const obj = room.state.objects.get(picked)!;
    expect(obj.zone.kind).toBe('EXILE');
    expect(obj.faceDown).toBe(true);
    expect(viewOf(room, 'seat_1', picked)).toMatchObject({ faceDown: true });
    expect(b.frames.join('\n')).not.toContain(`"${obj.card.scryfallId}"`);
  });

  it('sans `exileFaceDown`, une fouille exile face visible', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SEARCH',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const picked = look.cardIds[0]!;

    await room.handleIntent(a, 'resolve', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [],
      bottom: [],
      toExile: [picked],
      shuffleAfter: true,
    });

    expect(room.state.objects.get(picked)?.faceDown).toBe(false);
  });
});

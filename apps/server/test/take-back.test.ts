/**
 * `TAKE_BACK` : rattraper une carte posée par erreur.
 *
 * C'est la seule exception à la monotonie de la connaissance (§5.2), et une
 * exception qui se vérifie mal. Regarder l'état interne ne prouve rien : ce qui
 * compte, c'est ce que le siège adverse **détient déjà** sur son socket. Tous
 * les tests ci-dessous lisent donc les frames brutes de Bob, comme la §12.2.
 *
 * Deux propriétés portent tout le geste :
 *  - l'identité ne doit plus jamais lui être servie ;
 *  - l'**ancien identifiant** doit être mort, faute de quoi la vue publique déjà
 *    reçue resterait en place chez lui et le masquage serait un mensonge.
 */
import { describe, expect, it } from 'vitest';
import type { CardView, ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { applyEvent, fromSnapshot, normalize } from './client-model.js';
import { auditInvariants } from './invariants.js';
import { twoSeatTable, type Table } from './fixture.js';

function eventsOf(conn: { frames: string[] }): ServerEvent[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event');
}

/**
 * Alice joue la première carte de sa main sur le champ de bataille, face
 * visible. Bob la voit : c'est précisément la maladresse qu'on veut rattraper.
 */
async function misplayed(table: Table): Promise<{ id: string; scryfallId: string }> {
  const { room, a, b } = table;
  room.startGame('seat_0');
  const cardId = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
  await room.handleIntent(a, 'oops', {
    type: 'MOVE_CARD',
    cardId,
    to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
    x: 40,
    y: 40,
  });
  const scryfallId = room.state.objects.get(cardId)!.card.scryfallId;
  // Bob a bien reçu l'identité : sans cela, le test ne prouverait rien.
  expect(b.frames.join('\n')).toContain(`"${scryfallId}"`);
  return { id: cardId, scryfallId };
}

/** Vue de cet objet dans le snapshot de Bob, s'il en a une. */
function bobView(room: Table['room'], cardId: string): CardView | undefined {
  return room.snapshotFor('seat_1').cards.find((c) => c.id === cardId);
}

describe('TAKE_BACK — la table convient d’oublier', () => {
  it('reprend la carte en main : Bob ne détient plus ni l’identité ni l’ancien identifiant', async () => {
    const table = twoSeatTable();
    const { room, a, b } = table;
    const { id, scryfallId } = await misplayed(table);

    // On repart des frames d'après le geste : ce que Bob a vu avant est
    // légitimement à lui, la question est ce qu'il reçoit *maintenant*.
    b.frames.length = 0;
    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'HAND' });

    const after = b.frames.join('\n');
    // L'identité ne traverse plus le socket.
    expect(after).not.toContain(`"${scryfallId}"`);
    // Et on lui a bien dit d'oublier l'ancien objet.
    expect(eventsOf(b).some((e) => e.event.type === 'CARD_HIDDEN' && e.event.cardId === id)).toBe(true);

    // L'ancien identifiant n'existe plus nulle part : ni côté serveur, ni dans
    // ce que Bob pourrait resynchroniser.
    expect(room.state.objects.has(id)).toBe(false);
    expect(bobView(room, id)).toBeUndefined();
    expect(JSON.stringify(room.snapshotFor('seat_1'))).not.toContain(`"${id}"`);
    // Y compris dans le journal : une ancre morte, et surtout le nom de la
    // carte, rendaient l'oubli décoratif — il suffisait de remonter de trois
    // lignes. Le fait reste, le nom devient la périphrase du §4.2.
    const tail = room.snapshotFor('seat_1').logTail;
    expect(tail.some((e) => e.text.includes('Carte 2 '))).toBe(false);
    expect(tail.some((e) => e.text.includes('a déplacé une carte de main vers champ de bataille'))).toBe(true);

    // La carte est bien en main d'Alice, sous un nom neuf, et Bob ne la connaît
    // plus — alors qu'il l'avait vue sur le champ de bataille.
    const hand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    const moved = hand.map((x) => room.state.objects.get(x)!).find((o) => o.card.scryfallId === scryfallId)!;
    expect(moved.id).not.toBe(id);
    expect(moved.knownTo.has('seat_1')).toBe(false);
    expect(moved.knownTo.has('seat_0')).toBe(true);
    expect(bobView(room, moved.id)!.faceDown).toBe(true);
    auditInvariants(room.state);
  });

  it('la laisse face cachée sur place, oubliée de tous, sous un identifiant neuf', async () => {
    const table = twoSeatTable();
    const { room, a, b } = table;
    const { id, scryfallId } = await misplayed(table);

    b.frames.length = 0;
    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'FACE_DOWN' });

    expect(b.frames.join('\n')).not.toContain(`"${scryfallId}"`);
    expect(room.state.objects.has(id)).toBe(false);

    const battlefield = getZone(room.state, { seat: 'seat_0', kind: 'BATTLEFIELD' });
    expect(battlefield).toHaveLength(1);
    const kept = room.state.objects.get(battlefield[0]!)!;
    expect(kept.id).not.toBe(id);
    expect(kept.card.scryfallId).toBe(scryfallId);
    expect(kept.faceDown).toBe(true);
    // Bob voit un permanent face cachée là où il voyait une carte nommée.
    const view = bobView(room, kept.id)!;
    expect(view.faceDown).toBe(true);
    // Alice, elle, voit toujours sa propre carte, et sait qu'elle est cachée.
    const mine = room.snapshotFor('seat_0').cards.find((c) => c.id === kept.id)!;
    expect(mine.faceDown).toBe(false);
    expect(mine.faceDown === false && mine.facedownOnTable).toBe(true);
    // Et personne ne lui a été « révélé » : l'oubli est complet.
    expect(mine.faceDown === false && mine.revealedTo).toBeUndefined();
    auditInvariants(room.state);
  });

  it('annonce le geste à toute la table, nommément', async () => {
    const table = twoSeatTable();
    const { room, a, b } = table;
    const { id } = await misplayed(table);
    b.frames.length = 0;

    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'FACE_DOWN' });

    // La contrepartie sociale : un effacement silencieux serait une tricherie.
    const lines = eventsOf(b).flatMap((e) => (e.log ? [e.log] : []));
    const said = lines.find((l) => l.text.includes('posée par erreur'));
    expect(said, 'le geste doit passer au journal de l’adversaire').toBeDefined();
    expect(said!.text).toContain('Alice');
    // Aucune ancre : elle désignerait l'objet que le geste vient d'effacer.
    expect(said!.cardIds).toEqual([]);
  });

  it('emporte l’étiquette accrochée, qui pointait vers la carte', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const { id } = await misplayed(table);
    await room.handleIntent(a, 'lab', { type: 'ADD_LABEL', text: 'contre', x: 0, y: 0, attachedTo: id });
    expect(room.state.labels.size).toBe(1);

    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'HAND' });
    expect(room.state.labels.size).toBe(0);
    auditInvariants(room.state);
  });
});

describe('TAKE_BACK — qui n’y a pas droit', () => {
  it('refuse le geste à un autre siège que le propriétaire', async () => {
    const table = twoSeatTable();
    const { room, b } = table;
    const { id, scryfallId } = await misplayed(table);

    b.frames.length = 0;
    await room.handleIntent(b, 'steal', { type: 'TAKE_BACK', cardId: id, to: 'HAND' });

    const reject = b.received.find((m) => m.t === 'reject');
    expect(reject && reject.t === 'reject' && reject.code).toBe('ERR_NOT_YOURS');
    // Rien n'a bougé : la carte est toujours là, toujours connue.
    expect(room.state.objects.get(id)!.card.scryfallId).toBe(scryfallId);
    expect(room.state.objects.get(id)!.knownTo.has('seat_1')).toBe(true);
  });

  it('refuse un jeton, une carte en main, et un commandant', async () => {
    const table = twoSeatTable();
    const { room, a } = table;
    const { id } = await misplayed(table);

    // Un jeton n'est tombé d'aucune main : le geste attendu est `DESTROY_TOKEN`.
    await room.handleIntent(a, 'tok', { type: 'CREATE_TOKEN', copyOf: id, count: 1 });
    const token = [...room.state.objects.values()].find((o) => o.kind === 'TOKEN')!;
    await room.handleIntent(a, 'tk', { type: 'TAKE_BACK', cardId: token.id, to: 'HAND' });
    const rejectToken = a.received.filter((m) => m.t === 'reject').at(-1);
    expect(rejectToken && rejectToken.t === 'reject' && rejectToken.code).toBe('ERR_BAD_ZONE');

    // Une carte en main n'a été dévoilée à personne : il n'y a rien à rattraper.
    const inHand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    await room.handleIntent(a, 'hand', { type: 'TAKE_BACK', cardId: inHand, to: 'HAND' });
    const rejectHand = a.received.filter((m) => m.t === 'reject').at(-1);
    expect(rejectHand && rejectHand.t === 'reject' && rejectHand.code).toBe('ERR_BAD_ZONE');

    // Un commandant est de notoriété publique dès `DECK_LOADED`.
    const commander = getZone(room.state, { seat: 'seat_0', kind: 'COMMAND' })[0]!;
    await room.handleIntent(a, 'cmd', { type: 'TAKE_BACK', cardId: commander, to: 'HAND' });
    const rejectCmd = a.received.filter((m) => m.t === 'reject').at(-1);
    expect(rejectCmd && rejectCmd.t === 'reject' && rejectCmd.code).toBe('ERR_BAD_ZONE');
    expect(room.state.objects.has(commander)).toBe(true);
    auditInvariants(room.state);
  });
});

describe('TAKE_BACK — équivalence snapshot / delta', () => {
  it('amène Bob au même état par delta et par snapshot, reprise en main', async () => {
    const table = twoSeatTable(13);
    const { room, a, b } = table;
    const { id } = await misplayed(table);

    const start = room.state.seq;
    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;

    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'HAND' });

    const delta = room.deltaFor('seat_1', start);
    expect(delta).not.toBeNull();
    for (const frame of delta!) applyEvent(model, frame);

    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
    expect(model.seq).toBe(room.state.seq);
  });

  it('amène Bob au même état par delta et par snapshot, masquée sur place', async () => {
    const table = twoSeatTable(17);
    const { room, a, b } = table;
    const { id } = await misplayed(table);

    const start = room.state.seq;
    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;

    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'FACE_DOWN' });

    for (const frame of room.deltaFor('seat_1', start)!) applyEvent(model, frame);
    // La zone ne change pas : aucune réindexation, on compare tout, rang compris.
    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
  });

  it('donne le même état à Alice, qui garde sa carte', async () => {
    const table = twoSeatTable(19);
    const { room, a } = table;
    const { id } = await misplayed(table);

    const start = room.state.seq;
    const model = fromSnapshot(room.snapshotFor('seat_0'));

    await room.handleIntent(a, 'back', { type: 'TAKE_BACK', cardId: id, to: 'FACE_DOWN' });
    for (const frame of room.deltaFor('seat_0', start)!) applyEvent(model, frame);

    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_0'))));
  });
});

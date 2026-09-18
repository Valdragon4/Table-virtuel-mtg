/**
 * Proliférer : ce qu'il ajoute, et surtout ce qu'il ne décide pas.
 *
 * Trois questions séparées, dans cet ordre d'importance :
 *
 * 1. Le geste est-il bien « un de plus de chaque sorte **déjà posée** », sur
 *    les seuls objets que le joueur a désignés — et jamais sur un permanent que
 *    le serveur serait allé chercher tout seul ?
 * 2. Les mot-clés (marqueurs sans valeur, § 3 du protocole) restent-ils
 *    intacts ? « Un de plus » n'a pas de sens sur « vol », et lui inventer la
 *    valeur 1 écrirait un nombre que la v2 a justement cessé d'écrire.
 * 3. La ligne de journal est-elle sûre pour toute la table (§5.4) ? Elle est
 *    publique quelle que soit l'audience des events qui la portent.
 */
import { describe, expect, it } from 'vitest';
import { getZone } from '../src/game/state.js';
import { twoSeatTable, type FakeConnection } from './fixture.js';
import { Room } from '../src/game/room.js';
import { auditInvariants } from './invariants.js';

/** Pose la première carte en main d'un siège sur son champ de bataille. */
async function play(room: Room, conn: FakeConnection, seat: string, x = 100): Promise<string> {
  const hand = getZone(room.state, { seat, kind: 'HAND' })[0]!;
  await room.handleIntent(conn, `play-${hand}`, {
    type: 'MOVE_CARD',
    cardId: hand,
    to: { seat, kind: 'BATTLEFIELD' },
    x,
    y: 100,
  });
  return hand;
}

function countersOf(room: Room, id: string): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const c of room.state.objects.get(id)!.counters) out[c.kind] = c.value;
  return out;
}

/** La dernière ligne de journal écrite, telle que toute la table la lira. */
function lastLog(room: Room): string {
  return room.state.log[room.state.log.length - 1]?.text ?? '';
}

describe('proliférer', () => {
  it('ajoute un marqueur de chaque sorte déjà posée, sur les seules cibles désignées', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const first = await play(room, a, 'seat_0', 100);
    const second = await play(room, a, 'seat_0', 300);
    const third = await play(room, a, 'seat_0', 500);

    await room.handleIntent(a, 'c1', { type: 'SET_COUNTER', targetId: first, kind: '+1/+1', value: 2 });
    await room.handleIntent(a, 'c2', { type: 'SET_COUNTER', targetId: first, kind: 'loyauté', value: 4 });
    await room.handleIntent(a, 'c3', { type: 'SET_COUNTER', targetId: second, kind: 'poison', value: 1 });
    await room.handleIntent(a, 'c4', { type: 'SET_COUNTER', targetId: third, kind: '+1/+1', value: 9 });

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [first, second] });

    expect(countersOf(room, first)).toEqual({ '+1/+1': 3, 'loyauté': 5 });
    expect(countersOf(room, second)).toEqual({ poison: 2 });
    // Le troisième porte pourtant un marqueur : le serveur ne va **pas** le
    // chercher. C'est le joueur qui désigne, et il ne l'a pas désigné.
    expect(countersOf(room, third)).toEqual({ '+1/+1': 9 });
    auditInvariants(room.state, 'proliférer');
  });

  it('laisse les mot-clés intacts : on incrémente des nombres, pas des mots', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const card = await play(room, a, 'seat_0');

    // `value` absent : c'est un mot-clé, affiché seul (§3).
    await room.handleIntent(a, 'k1', { type: 'SET_COUNTER', targetId: card, kind: 'vol' });
    await room.handleIntent(a, 'k2', { type: 'SET_COUNTER', targetId: card, kind: '+1/+1', value: 1 });

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [card] });

    const counters = room.state.objects.get(card)!.counters;
    expect(counters.find((c) => c.kind === 'vol')).toEqual({ kind: 'vol' });
    expect(counters.find((c) => c.kind === '+1/+1')).toEqual({ kind: '+1/+1', value: 2 });
  });

  it('ne fait rien, et ne journalise rien, sur un permanent sans marqueur', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const card = await play(room, a, 'seat_0');
    const before = room.state.log.length;
    const seqBefore = room.state.seq;

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [card] });

    expect(room.state.objects.get(card)!.counters).toEqual([]);
    expect(room.state.log.length).toBe(before);
    // Aucune émission, donc aucun `seq` : « intent sans effet » (§4.2).
    expect(room.state.seq).toBe(seqBefore);
    expect(a.received.find((m) => m.t === 'ack' && m.seq === null)).toBeDefined();
  });

  it('ne double pas la mise quand la sélection cite deux fois le même objet', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const card = await play(room, a, 'seat_0');
    await room.handleIntent(a, 'c1', { type: 'SET_COUNTER', targetId: card, kind: '+1/+1', value: 1 });

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [card, card] });

    expect(countersOf(room, card)).toEqual({ '+1/+1': 2 });
  });

  it('est ouvert à toute la table, comme le « + » qu’il abrège', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const mine = await play(room, a, 'seat_0');
    await room.handleIntent(a, 'c1', { type: 'SET_COUNTER', targetId: mine, kind: 'poison', value: 1 });
    b.received.length = 0;

    // Bob prolifère sur le permanent d'Alice : `ADD_COUNTER` le lui permet
    // déjà, et une assistance plus étroite serait un refus déguisé.
    await room.handleIntent(b, 'p1', { type: 'PROLIFERATE', targetIds: [mine] });

    expect(b.received.find((m) => m.t === 'reject')).toBeUndefined();
    expect(countersOf(room, mine)).toEqual({ poison: 2 });
  });

  it('refuse la main d’autrui, exactement comme ADD_COUNTER', async () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    const aliceHand = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    b.received.length = 0;

    await room.handleIntent(b, 'p1', { type: 'PROLIFERATE', targetIds: [aliceHand] });

    const reject = b.received.find((m) => m.t === 'reject');
    expect(reject).toMatchObject({ code: 'ERR_NOT_YOURS' });
  });

  it('nomme au journal ce que toute la table voit, et compte le reste', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const visible = await play(room, a, 'seat_0', 100);
    await room.handleIntent(a, 'c1', { type: 'SET_COUNTER', targetId: visible, kind: '+1/+1', value: 1 });

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [visible] });

    const name = room.state.objects.get(visible)!.card.name;
    expect(lastLog(room)).toContain(name);
    expect(lastLog(room)).toContain('prolifère');
  });

  it('ne nomme jamais une carte que la table ne peut pas lire', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const hidden = getZone(room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    // Un marqueur sur une carte en main : c'est permis, et le journal ne doit
    // pourtant pas dire laquelle — il est lu par toute la table (§5.4).
    await room.handleIntent(a, 'c1', { type: 'SET_COUNTER', targetId: hidden, kind: 'âge', value: 1 });
    const name = room.state.objects.get(hidden)!.card.name;

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [hidden] });

    expect(countersOf(room, hidden)).toEqual({ 'âge': 2 });
    expect(lastLog(room)).not.toContain(name);
    expect(lastLog(room)).toContain('prolifère');
  });

  it('s’annule d’un coup, marqueur par marqueur', async () => {
    const { room, a } = twoSeatTable();
    room.startGame('seat_0');
    const first = await play(room, a, 'seat_0', 100);
    const second = await play(room, a, 'seat_0', 300);
    await room.handleIntent(a, 'c1', { type: 'SET_COUNTER', targetId: first, kind: '+1/+1', value: 2 });
    await room.handleIntent(a, 'c2', { type: 'SET_COUNTER', targetId: second, kind: 'poison', value: 3 });

    await room.handleIntent(a, 'p1', { type: 'PROLIFERATE', targetIds: [first, second] });
    await room.handleIntent(a, 'u1', { type: 'UNDO_LAST' });

    expect(countersOf(room, first)).toEqual({ '+1/+1': 2 });
    expect(countersOf(room, second)).toEqual({ poison: 3 });
    auditInvariants(room.state, 'proliférer annulé');
  });
});

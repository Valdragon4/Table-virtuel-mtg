/**
 * **Le rejeu ne ment pas.**
 *
 * Une partie est jouée pour de bon contre le moteur du serveur, son flux est
 * enregistré, puis rejoué du début par le client. L'état final obtenu doit être
 * celui que le serveur publierait à ce siège s'il lui envoyait un snapshot à
 * cet instant. C'est la seule façon de prouver qu'un replay montre bien ce qui
 * s'est passé : tout le reste se contenterait de vérifier que le lecteur ne
 * plante pas.
 *
 * Le rejeu passe par `handleMessage` — **le** réducteur du client, celui du
 * direct. Il n'y en a pas de second, et c'est le point : deux implémentations
 * finiraient par diverger, et le jour où elles divergent le replay montre autre
 * chose que la partie.
 */
import { describe, expect, it } from 'vitest';
import type { CardView, ServerMessage } from '@mtg/shared';
import { handleMessage, useGame } from '../src/store/game.js';
import { Room } from '../../server/src/game/room.js';
import { seededRandom } from '../../server/src/game/random.js';
import { projectSnapshot } from '../../server/src/game/projection.js';
import { projectFrame, projectOrigin } from '../../server/src/replay/projection.js';
import type { ReplayFrame, ReplayOrigin } from '../../server/src/replay/types.js';
import type { ReplaySink } from '../../server/src/replay/recorder.js';
import { deck, fakeConnection } from '../../server/test/fixture.js';

function apply(message: ServerMessage): void {
  handleMessage(message, useGame.setState, useGame.getState);
}

/** Une partie jouée contre le vrai moteur, avec son flux capturé. */
function partieJouee(): { room: Room; origin: ReplayOrigin; frames: ReplayFrame[] } {
  let origin: ReplayOrigin | null = null;
  const frames: ReplayFrame[] = [];
  const sink: ReplaySink = {
    open: (_r, _s, dump) => {
      origin = dump;
    },
    append: (_r, _s, batch) => {
      frames.push(...batch);
    },
    close: () => undefined,
  };

  const room = new Room('room-rejeu', 'REJEU1', 'COMMANDER', seededRandom(99), { replaySink: sink });
  const conns = [0, 1].map((i) => {
    const conn = fakeConnection(`c${i}`);
    room.addConnection(conn);
    room.sitDown(conn, i, i === 0 ? 'Alice' : 'Bob', null);
    return conn;
  });
  const names = Array.from({ length: 20 }, (_, i) => `Carte ${i + 1}`);
  for (const i of [0, 1]) {
    room.loadDeck(`seat_${i}`, deck(`Deck ${i}`, names.map((n) => `${n}-${i}`), `Cmd${i}`), null);
  }

  room.startGame('seat_0');
  const [a, b] = conns;
  void room.handleIntent(a!, 'n1', { type: 'DRAW', count: 2 });
  void room.handleIntent(b!, 'n2', { type: 'DRAW', count: 2 });
  // Une carte sur le champ de bataille, engagée, avec un marqueur : de quoi
  // faire mentir un rejeu approximatif sur autre chose que la zone.
  const main = room.state.zones.get('seat_0|HAND') ?? [];
  const cible = main[0]!;
  void room.handleIntent(a!, 'n3', {
    type: 'MOVE_CARD',
    cardId: cible,
    to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
    x: 120,
    y: 80,
  });
  void room.handleIntent(a!, 'n4', { type: 'SET_TAPPED', cardId: cible, tapped: true });
  void room.handleIntent(a!, 'n5', { type: 'ADD_COUNTER', cardId: cible, kind: '+1/+1', delta: 2 });
  void room.handleIntent(b!, 'n6', { type: 'ADJUST_LIFE', seat: 'seat_0', delta: -7 });
  void room.handleIntent(a!, 'n7', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });
  void room.handleIntent(a!, 'n8', { type: 'DRAW', count: 1 });
  void room.handleIntent(b!, 'n9', { type: 'REVEAL_HAND', toSeats: 'ALL' });

  room.abandonReplay('TEST');
  return { room, origin: origin!, frames };
}

/** Rejoue le flux du début, dans le store du client, au point de vue donné. */
function rejouer(origin: ReplayOrigin, frames: ReplayFrame[], view: string): void {
  const seat = view === 'ALL' ? 'seat_0' : view;
  apply({
    t: 'hello',
    protocol: 0,
    seat,
    roomCode: 'REJEU1',
    snapshot: projectOrigin(origin, view),
  });
  for (const frame of frames) {
    const step = projectFrame(frame, view);
    apply({
      t: 'event',
      seq: step.seq,
      at: step.at,
      actor: step.actor,
      event: step.event,
      ...(step.log ? { log: step.log } : {}),
    });
  }
}

/** Les cartes du store, dans une forme comparable à celles d'un snapshot. */
function cartesDuStore(): Map<string, CardView> {
  return new Map(useGame.getState().cards);
}

describe('un replay rejoué depuis le début', () => {
  it('rend le même état final que la partie réelle, pour le siège concerné', () => {
    const { room, origin, frames } = partieJouee();
    rejouer(origin, frames, 'seat_0');

    // La référence : ce que le serveur publierait à ce siège s'il lui envoyait
    // un snapshot maintenant. C'est l'autorité, par construction.
    const reference = projectSnapshot(room.state, 'seat_0');
    const rejoue = cartesDuStore();

    for (const card of reference.cards) {
      expect(rejoue.get(card.id), `carte ${card.id} absente du rejeu`).toEqual(card);
    }

    // Et rien en trop : un rejeu qui garderait une carte partie mentirait tout
    // autant qu'un rejeu qui en perdrait une.
    const attendus = new Set(reference.cards.map((c) => c.id));
    for (const id of rejoue.keys()) expect(attendus.has(id)).toBe(true);

    // La vie, le tour, les sièges : le reste de l'état, pas seulement les cartes.
    expect(useGame.getState().seats.map((s) => ({ id: s.id, life: s.life }))).toEqual(
      reference.seats.map((s) => ({ id: s.id, life: s.life })),
    );
    expect(useGame.getState().seq).toBe(reference.seq);
  });

  it('rend, en vue omnisciente, tout ce que la vue d’un siège cachait', () => {
    const { room, origin, frames } = partieJouee();

    rejouer(origin, frames, 'seat_0');
    const vuAlice = cartesDuStore();

    rejouer(origin, frames, 'ALL');
    const vuTout = cartesDuStore();

    // La main de Bob : cachée pour Alice, lisible en omniscient.
    const mainDeBob = room.state.zones.get('seat_1|HAND') ?? [];
    expect(mainDeBob.length).toBeGreaterThan(0);
    for (const id of mainDeBob) {
      const attendu = room.state.objects.get(id)!.card.scryfallId;
      expect((vuTout.get(id) as { scryfallId?: string } | undefined)?.scryfallId).toBe(attendu);
    }

    // Symétrique : la bibliothèque d'Alice n'existe dans aucune des deux vues
    // à la fin de cette partie — et ce n'est pas un oubli du replay.
    //
    // Le point zéro, lui, l'énumère en omniscient. Mais un `SHUFFLE` réattribue
    // tous les identifiants (§2.1) et le seul event qu'il produit est
    // `ZONE_SHUFFLED{zone, count}` : les nouveaux identifiants n'existent nulle
    // part dans le flux, pas même dans sa variante omnisciente, puisque le
    // serveur ne les publie à personne. Après un mélange, le replay connaît
    // donc le compte de la bibliothèque, pas son contenu. Voir docs/replay.md.
    const biblio = room.state.zones.get('seat_0|LIBRARY') ?? [];
    expect(biblio.length).toBeGreaterThan(0);
    for (const id of biblio) expect(vuAlice.has(id)).toBe(false);
    for (const id of biblio) expect(vuTout.has(id)).toBe(false);

    // Avant le premier mélange, en revanche, le point zéro la donne entière.
    const zero = projectOrigin(origin, 'ALL');
    const biblioZero = Object.entries(origin.zones).find(([k]) => k === 'seat_0|LIBRARY')?.[1] ?? [];
    expect(biblioZero.length).toBeGreaterThan(0);
    const idsZero = new Set(zero.cards.map((c) => c.id));
    expect(biblioZero.every((id) => idsZero.has(id))).toBe(true);
  });

  it('revient au même état en reculant qu’en avançant', () => {
    const { origin, frames } = partieJouee();

    // On avance jusqu'au bout, on note, puis on repart du début jusqu'au même
    // pas : c'est exactement ce que fait le lecteur quand on recule.
    rejouer(origin, frames, 'seat_0');
    const auBout = JSON.stringify([...cartesDuStore().entries()].sort());

    rejouer(origin, frames.slice(0, 3), 'seat_0');
    const auPasTrois = JSON.stringify([...cartesDuStore().entries()].sort());
    expect(auPasTrois).not.toBe(auBout);

    rejouer(origin, frames, 'seat_0');
    expect(JSON.stringify([...cartesDuStore().entries()].sort())).toBe(auBout);
  });
});

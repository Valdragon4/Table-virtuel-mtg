/**
 * Critère d'acceptation §12.2 du protocole : un siège ne reçoit jamais, sur son
 * socket, l'identité d'une carte de la bibliothèque ou de la main d'un autre.
 *
 * Le test inspecte les frames brutes telles qu'elles partiraient sur le réseau,
 * pas l'état interne : c'est la seule façon de prendre une fuite sur le fait.
 */
import { describe, expect, it } from 'vitest';
import { HIDDEN_VIEW_ALLOWED_KEYS } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { twoSeatTable } from './fixture.js';

/** Tous les objets JSON `faceDown: true` trouvés dans une frame. */
function hiddenViewsIn(frame: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj['faceDown'] === true) found.push(obj);
      Object.values(obj).forEach(walk);
    }
  };
  walk(JSON.parse(frame));
  return found;
}

describe('étanchéité des frames', () => {
  it('ne laisse jamais sortir le nom d’une carte cachée d’un autre siège', () => {
    const { room, a, b } = twoSeatTable();

    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'DRAW', count: 3 });
    void room.handleIntent(a, 'c2', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });

    // Identifiants Scryfall appartenant aux zones cachées d'Alice.
    const secrets = new Set<string>();
    for (const kind of ['LIBRARY', 'HAND'] as const) {
      for (const id of getZone(room.state, { seat: 'seat_0', kind })) {
        const obj = room.state.objects.get(id);
        if (obj) secrets.add(obj.card.scryfallId);
      }
    }
    expect(secrets.size).toBeGreaterThan(5);

    // Recherche sur la valeur JSON entière : sans les guillemets, « id-carte-1 »
    // matcherait « id-carte-10 » et le test passerait pour de mauvaises raisons.
    const bobFrames = b.frames.join('\n');
    for (const secret of secrets) {
      expect(bobFrames).not.toContain(`"${secret}"`);
    }
  });

  it('n’envoie jamais d’identifiant d’objet de bibliothèque à un autre siège', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'DRAW', count: 2 });

    const libraryIds = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' });
    const bobFrames = b.frames.join('\n');
    for (const id of libraryIds) {
      expect(bobFrames).not.toContain(`"${id}"`);
    }
  });

  it('limite les vues cachées à la liste blanche de champs', () => {
    const { room, a, b } = twoSeatTable();
    room.startGame('seat_0');
    void room.handleIntent(a, 'c1', { type: 'DRAW', count: 1 });

    const views = b.frames.flatMap(hiddenViewsIn);
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      for (const key of Object.keys(view)) {
        expect(HIDDEN_VIEW_ALLOWED_KEYS).toContain(key);
      }
    }
  });

  it('cache la main d’un adversaire dans le snapshot', () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');

    const forBob = room.snapshotFor('seat_1');
    const aliceHand = forBob.cards.filter((c) => c.zone.seat === 'seat_0' && c.zone.kind === 'HAND');
    expect(aliceHand.length).toBe(7);
    expect(aliceHand.every((c) => c.faceDown === true)).toBe(true);

    // Et la bibliothèque n'est pas énumérée du tout, seulement comptée :
    // 20 cartes de deck, moins les 7 de la main d'ouverture.
    expect(forBob.cards.some((c) => c.zone.kind === 'LIBRARY')).toBe(false);
    const libraryCount = forBob.zoneCounts.find(
      (z) => z.zone.seat === 'seat_0' && z.zone.kind === 'LIBRARY',
    );
    expect(libraryCount?.count).toBe(13);
  });

  /*
   * La bibliothèque est visible de son propriétaire **avant** le lancement, et
   * d'elle seule. C'est ce qui permet de composer son deck depuis la table :
   * rien n'est encore mélangé, la liste est celle qu'on vient de charger, et
   * `START_GAME` mélange — ce qui réattribue tous les identifiants. Aucun de
   * ceux appris avant la partie ne survit donc à son début.
   */
  it('montre sa propre bibliothèque à son propriétaire avant le lancement', () => {
    const { room } = twoSeatTable();
    const forAlice = room.snapshotFor('seat_0');
    const mine = forAlice.cards.filter((c) => c.zone.kind === 'LIBRARY');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.zone.seat === 'seat_0')).toBe(true);
    // Et jamais celle du voisin.
    const forBob = room.snapshotFor('seat_1');
    expect(forBob.cards.some((c) => c.zone.kind === 'LIBRARY' && c.zone.seat === 'seat_0')).toBe(false);
  });

  it('la referme dès que la partie commence', () => {
    const { room } = twoSeatTable();
    room.startGame('seat_0');
    const forAlice = room.snapshotFor('seat_0');
    expect(forAlice.cards.some((c) => c.zone.kind === 'LIBRARY')).toBe(false);
  });

  /*
   * Le corollaire indispensable de la visibilité d'avant-partie : sans ce
   * mélange, un joueur entrerait en partie en connaissant l'ordre de son deck,
   * puisqu'il vient de le lire en entier dans le panneau de composition.
   */
  it('mélange les bibliothèques au lancement, identifiants compris', () => {
    const { room } = twoSeatTable();
    const before = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];
    room.startGame('seat_0');
    const after = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' });
    // Aucun identifiant d'avant ne survit : ceux appris avant la partie ne
    // désignent plus rien.
    expect(after.some((id) => before.includes(id))).toBe(false);
    // Et plus personne ne connaît ces cartes, pas même leur propriétaire.
    expect(
      after.every((id) => (room.state.objects.get(id)?.knownTo.size ?? 0) === 0),
    ).toBe(true);
  });
});

describe('mélange non corrélable', () => {
  it('réattribue les identifiants de la zone mélangée', () => {
    const { room, a } = twoSeatTable();
    const before = [...getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })];

    void room.handleIntent(a, 'c1', { type: 'SHUFFLE', zone: { seat: 'seat_0', kind: 'LIBRARY' } });

    const after = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' });
    expect(after).toHaveLength(before.length);
    // Aucun identifiant observé avant le mélange ne réapparaît après.
    expect(after.filter((id) => before.includes(id))).toHaveLength(0);
  });

  it('efface la connaissance acquise par un scry précédent', () => {
    const { room, a } = twoSeatTable();
    void room.handleIntent(a, 'c1', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SCRY',
    });

    const look = [...room.state.pendingLooks.values()][0]!;
    expect(look.cardIds.every((id) => room.state.objects.get(id)?.knownTo.has('seat_0'))).toBe(true);

    void room.handleIntent(a, 'c2', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: look.cardIds,
      bottom: [],
      shuffleAfter: true,
    });

    const library = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' });
    const stillKnown = library.filter((id) => room.state.objects.get(id)?.knownTo.size);
    expect(stillKnown).toHaveLength(0);
  });
});

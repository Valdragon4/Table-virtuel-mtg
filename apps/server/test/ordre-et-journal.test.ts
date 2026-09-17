/**
 * Deux défauts qui se rencontrent au même endroit : ce que la table voit
 * arriver dans une zone publique, et ce qu'elle en lit dans le journal.
 *
 * **L'ordre.** Le cimetière est une pile ; son rang 0 est le dessus
 * (`ORDERED_ZONES`). Le serveur le tenait déjà correctement, mais il ne
 * prévenait que la carte déplacée : les rangs de celles qui étaient déjà là
 * glissaient en silence, et le client gardait les anciens. Les tests d'ordre
 * ci-dessous mesurent donc le **client rattrapé par delta**, jamais l'état
 * interne — c'est là que le défaut vivait.
 *
 * **Le journal.** Son `text` est construit une fois et diffusé à toute la
 * table : nommer une carte n'y est légitime que si *tous* les sièges la voient.
 * Les tests lisent donc les **frames brutes** de Bob, comme la §12.2, et non
 * l'état d'Alice.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { applyEvent, fromSnapshot, normalize } from './client-model.js';
import { twoSeatTable, type Table } from './fixture.js';

function eventsOf(conn: { frames: string[] }): ServerEvent[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event');
}

/** Toutes les lignes de journal telles que ce siège les a reçues sur son socket. */
function journalRecu(conn: { frames: string[] }): string[] {
  return eventsOf(conn)
    .map((e) => e.log?.text)
    .filter((t): t is string => t !== undefined);
}

/** Ce texte nomme-t-il cette carte, en mot entier ? (même borne que le nettoyage) */
const nomme = (texte: string, carte: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${carte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(
    texte,
  );

const nom = (room: Table['room'], id: string): string =>
  room.state.objects.get(id)?.card.name ?? '(disparue)';

/**
 * Le cimetière d'Alice **tel que Bob l'affiche**, du dessus vers le dessous.
 *
 * C'est exactement ce que fait `ZonePanel` : trier par `sortIndex` croissant.
 * Passer par le modèle de client est le cœur de ces tests — l'ordre du serveur
 * ne prouve rien si l'event qui le publie n'est jamais parti.
 */
function cimetiereAffiche(room: Table['room'], conn: Table['b'], depuis: ReturnType<typeof fromSnapshot>): string[] {
  const model = depuis;
  for (const ev of eventsOf(conn)) applyEvent(model, ev);
  return [...model.cards.values()]
    .filter((c) => c.zone.seat === 'seat_0' && c.zone.kind === 'GRAVEYARD')
    .sort((x, y) => x.sortIndex - y.sortIndex)
    .map((c) => nom(room, c.id));
}

describe('ordre d’arrivée dans une zone ordonnée', () => {
  it('meule de cinq : la dernière meulée est sur le dessus, chez le serveur comme chez l’adversaire', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const dessus = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })
      .slice(0, 5)
      .map((id) => nom(room, id));

    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 5 });

    // La première partie (rang 0 de la bibliothèque) est déposée en premier,
    // donc enfouie sous les quatre suivantes : l'ordre attendu est l'inverse.
    const attendu = [...dessus].reverse();
    expect(getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' }).map((id) => nom(room, id))).toEqual(attendu);
    expect(cimetiereAffiche(room, b, model)).toEqual(attendu);
  });

  it('deux meules successives : les rangs déjà posés glissent chez l’adversaire aussi', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const dessus = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })
      .slice(0, 5)
      .map((id) => nom(room, id));

    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;
    await room.handleIntent(a, 'm1', { type: 'MILL', count: 2 });
    await room.handleIntent(a, 'm2', { type: 'MILL', count: 3 });

    // C'est le cas qui échouait : les deux premières gardaient les rangs 0 et 1
    // chez Bob, en collision avec les trois nouvelles.
    const attendu = [...dessus].reverse();
    expect(cimetiereAffiche(room, b, model)).toEqual(attendu);
  });

  it('MOVE_CARDS groupé : le lot s’empile dans l’ordre donné, le dernier sur le dessus', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const lot = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 3);
    const noms = lot.map((id) => nom(room, id));

    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;
    await room.handleIntent(a, 'lot', {
      type: 'MOVE_CARDS',
      cardIds: lot,
      to: { seat: 'seat_0', kind: 'GRAVEYARD' },
    });

    expect(cimetiereAffiche(room, b, model)).toEqual([...noms].reverse());
  });

  it('déplacements successifs à l’unité : même pile que le lot équivalent', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const lot = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 3);
    const noms = lot.map((id) => nom(room, id));

    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;
    for (const [i, cardId] of lot.entries()) {
      await room.handleIntent(a, `un-${i}`, {
        type: 'MOVE_CARD',
        cardId,
        to: { seat: 'seat_0', kind: 'GRAVEYARD' },
      });
    }

    // Trois gestes à l'unité ou un lot : la table physique ne fait pas la
    // différence, le serveur non plus.
    expect(cimetiereAffiche(room, b, model)).toEqual([...noms].reverse());
  });

  it('retirer une carte du milieu remonte les suivantes chez l’adversaire', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 4 });

    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;
    const cimetiere = getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' });
    const auMilieu = cimetiere[1]!;
    const attendu = cimetiere.filter((id) => id !== auMilieu).map((id) => nom(room, id));

    await room.handleIntent(a, 'rejoue', {
      type: 'MOVE_CARD',
      cardId: auMilieu,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 10,
      y: 10,
    });

    expect(cimetiereAffiche(room, b, model)).toEqual(attendu);
  });

  it('l’exil suit la même convention que le cimetière', async () => {
    const { room, a } = twoSeatTable(7);
    room.startGame('seat_0');
    const dessus = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })
      .slice(0, 3)
      .map((id) => nom(room, id));

    await room.handleIntent(a, 'exil', { type: 'EXILE_TOP', count: 3 });

    expect(getZone(room.state, { seat: 'seat_0', kind: 'EXILE' }).map((id) => nom(room, id))).toEqual(
      [...dessus].reverse(),
    );
  });

  it('un client rattrapé par delta a les mêmes rangs qu’un client rattrapé par snapshot', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const model = fromSnapshot(room.snapshotFor('seat_1'));
    b.frames.length = 0;

    await room.handleIntent(a, 'm1', { type: 'MILL', count: 2 });
    await room.handleIntent(a, 'm2', { type: 'MILL', count: 3 });
    const main = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    await room.handleIntent(a, 'jouer', {
      type: 'MOVE_CARD',
      cardId: main[2]!,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 5,
      y: 5,
    });
    const cimetiere = getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' });
    await room.handleIntent(a, 'ressort', {
      type: 'MOVE_CARD',
      cardId: cimetiere[2]!,
      to: { seat: 'seat_0', kind: 'EXILE' },
    });

    for (const ev of eventsOf(b)) applyEvent(model, ev);
    // `normalize` compare les vues entières, `sortIndex` compris : c'est la §8.1
    // appliquée au rang, et c'est elle qui manquait.
    expect(normalize(model)).toEqual(normalize(fromSnapshot(room.snapshotFor('seat_1'))));
  });
});

describe('le journal nomme ce que la table entière voit', () => {
  it('meule : l’adversaire reçoit les noms, dans l’ordre de dépôt', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');
    const noms = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' })
      .slice(0, 3)
      .map((id) => nom(room, id));

    b.frames.length = 0;
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 3 });

    const ligne = journalRecu(b).find((t) => t.includes('meulé'));
    expect(ligne).toBe(`Alice a meulé ${noms[0]}, ${noms[1]} et ${noms[2]}`);
  });

  it('meule : les ancres désignent exactement les cartes nommées', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');
    const partantes = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, 3);

    b.frames.length = 0;
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 3 });

    const entree = eventsOf(b).find((e) => e.log?.text.includes('meulé'))!.log!;
    expect([...entree.cardIds].sort()).toEqual([...partantes].sort());
  });

  it('au-delà du seuil, le journal replie la queue du lot sans perdre une seule ancre', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');
    const partantes = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, 9);

    b.frames.length = 0;
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 9 });

    const entree = eventsOf(b).find((e) => e.log?.text.includes('meulé'))!.log!;
    // Six noms énumérés, les trois derniers comptés — mais neuf ancres : le
    // survol surligne le lot entier, et `TAKE_BACK` peut les atteindre toutes.
    expect(entree.text).toContain('et 3 autres cartes');
    expect(entree.cardIds).toHaveLength(9);
    for (const id of partantes.slice(0, 6)) expect(entree.text).toContain(nom(room, id));
  });

  it('MOVE_CARDS vers le cimetière : nommé ; vers une main : jamais', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const main = getZone(room.state, { seat: 'seat_0', kind: 'HAND' });
    const versCimetiere = main.slice(0, 2);
    const noms = versCimetiere.map((id) => nom(room, id));

    b.frames.length = 0;
    await room.handleIntent(a, 'jeter', {
      type: 'MOVE_CARDS',
      cardIds: versCimetiere,
      to: { seat: 'seat_0', kind: 'GRAVEYARD' },
    });
    expect(journalRecu(b).at(-1)).toBe(`Alice a déplacé ${noms[0]} et ${noms[1]} vers cimetière`);

    /*
     * Retour en main : la zone est cachée, la carte redevient muette — et c'est
     * le cas qui prouve que la règle porte bien sur la **zone d'arrivée**. Bob
     * connaît ces deux cartes pour de bon (la connaissance est monotone, il les
     * a vues au cimetière) : une règle fondée sur « tout le monde la connaît »
     * les nommerait encore, et annoncerait à la table ce qu'Alice tient en main.
     */
    const auCimetiere = getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' }).slice(0, 2);
    b.frames.length = 0;
    await room.handleIntent(a, 'reprendre', {
      type: 'MOVE_CARDS',
      cardIds: auCimetiere,
      to: { seat: 'seat_0', kind: 'HAND' },
    });
    const ligne = journalRecu(b).at(-1)!;
    expect(ligne).toBe('Alice a déplacé 2 carte(s) vers main');
    for (const carte of noms) expect(ligne).not.toContain(carte);
  });

  it('face cachée vers une zone publique : la zone est publique, la carte ne l’est pas', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const main = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 2);
    const noms = main.map((id) => nom(room, id));

    b.frames.length = 0;
    await room.handleIntent(a, 'morphs', {
      type: 'MOVE_CARDS',
      cardIds: main,
      to: { seat: 'seat_0', kind: 'EXILE' },
      faceDown: true,
    });

    const frames = b.frames.join('\n');
    expect(journalRecu(b).at(-1)).toBe('Alice a déplacé 2 carte(s) vers exil');
    // Et la vérification qui compte : rien de l'identité n'a traversé le socket.
    for (const id of main) {
      expect(frames).not.toContain(`"${room.state.objects.get(id)!.card.scryfallId}"`);
    }
    for (const carte of noms) expect(frames).not.toContain(carte);
  });

  it('EXILE_TOP face cachée : compté ; face visible : nommé', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const caches = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, 2);
    const nomsCaches = caches.map((id) => nom(room, id));
    b.frames.length = 0;
    await room.handleIntent(a, 'exil-cache', { type: 'EXILE_TOP', count: 2, faceDown: true });
    const cachee = b.frames.join('\n');
    expect(journalRecu(b).at(-1)).toBe('Alice a exilé 2 carte(s) du dessus face cachée');
    for (const carte of nomsCaches) expect(cachee).not.toContain(carte);

    const visibles = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, 2);
    const nomsVisibles = visibles.map((id) => nom(room, id));
    b.frames.length = 0;
    await room.handleIntent(a, 'exil-clair', { type: 'EXILE_TOP', count: 2 });
    expect(journalRecu(b).at(-1)).toBe(`Alice a exilé du dessus ${nomsVisibles[0]} et ${nomsVisibles[1]}`);
  });

  it('surveil : les cartes mises au cimetière sont nommées, celles rendues à la bibliothèque non', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 3,
      mode: 'SURVEIL',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const enterree = look.cardIds[2]!;
    const gardees = [look.cardIds[0]!, look.cardIds[1]!];
    const nomEnterree = nom(room, enterree);
    const nomsGardes = gardees.map((id) => nom(room, id));

    b.frames.length = 0;
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: gardees,
      bottom: [],
      toGraveyard: [enterree],
    });

    const ligne = journalRecu(b).at(-1)!;
    expect(ligne).toContain(`${nomEnterree} vers cimetière`);
    const frames = b.frames.join('\n');
    for (const carte of nomsGardes) expect(frames).not.toContain(carte);
  });
});

describe('croisement avec TAKE_BACK', () => {
  it('efface les noms que la meule venait d’écrire, et leurs ancres avec', async () => {
    const { room, a, b } = twoSeatTable(7);
    room.startGame('seat_0');

    const partantes = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, 3);
    const noms = partantes.map((id) => nom(room, id));
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 3 });

    // La maladresse : une carte qu'on ne voulait pas meuler. Elle est au
    // cimetière, donc dans une zone publique — `TAKE_BACK` l'accepte.
    const regrettee = getZone(room.state, { seat: 'seat_0', kind: 'GRAVEYARD' })[0]!;
    const nomRegrette = nom(room, regrettee);
    const ligneAvant = room.state.log.find((e) => e.text.includes('meulé'))!;
    expect(ligneAvant.text).toContain(nomRegrette);
    expect(ligneAvant.cardIds).toContain(regrettee);

    b.frames.length = 0;
    await room.handleIntent(a, 'oubli', { type: 'TAKE_BACK', cardId: regrettee, to: 'HAND' });

    /*
     * Le journal réécrit est celui que sert `logTail` : un joueur qui se
     * resynchronise, ou qui arrive, ne doit plus pouvoir défaire l'oubli en
     * remontant de trois lignes. C'est ce croisement précis que l'ajout des
     * noms rendait fragile : nommer sans ancrer aurait laissé cette ligne
     * intacte, puisque le nettoyage parcourt `cardIds`.
     */
    const ligne = room.snapshotFor('seat_1').logTail.find((e) => e.text.includes('meulé'))!;
    expect(ligne.text).not.toContain(nomRegrette);
    expect(ligne.text).toContain('une carte');
    expect(ligne.cardIds).not.toContain(regrettee);
    // Les deux autres n'ont rien à voir avec la maladresse : elles restent dites.
    for (const carte of noms.filter((n) => n !== nomRegrette)) expect(ligne.text).toContain(carte);
  });

  it('efface aussi les noms d’un MOVE_CARDS groupé', async () => {
    const { room, a } = twoSeatTable(7);
    room.startGame('seat_0');

    const lot = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 2);
    await room.handleIntent(a, 'lot', {
      type: 'MOVE_CARDS',
      cardIds: lot,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
    });

    const regrettee = lot[0]!;
    const nomRegrette = nom(room, regrettee);
    expect(room.state.log.at(-1)!.text).toContain(nomRegrette);

    await room.handleIntent(a, 'oubli', { type: 'TAKE_BACK', cardId: regrettee, to: 'HAND' });

    for (const entree of room.snapshotFor('seat_1').logTail) {
      expect(entree.text).not.toContain(nomRegrette);
      expect(entree.cardIds).not.toContain(regrettee);
    }
  });

  it('efface les noms écrits par une consultation', async () => {
    const { room, a } = twoSeatTable(7);
    room.startGame('seat_0');

    await room.handleIntent(a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 2,
      mode: 'SURVEIL',
    });
    const look = [...room.state.pendingLooks.values()][0]!;
    const enterree = look.cardIds[0]!;
    const nomEnterree = nom(room, enterree);
    await room.handleIntent(a, 'res', {
      type: 'RESOLVE_LOOK',
      lookId: look.id,
      top: [look.cardIds[1]!],
      bottom: [],
      toGraveyard: [enterree],
    });
    expect(room.state.log.at(-1)!.text).toContain(nomEnterree);

    await room.handleIntent(a, 'oubli', { type: 'TAKE_BACK', cardId: enterree, to: 'FACE_DOWN' });

    for (const entree of room.snapshotFor('seat_1').logTail) {
      expect(entree.text).not.toContain(nomEnterree);
    }
  });

  it('toute entrée qui nomme une carte l’ancre : la garde qui rend TAKE_BACK honnête', async () => {
    const { room, a } = twoSeatTable(7);
    room.startGame('seat_0');

    // Un peu de tout ce qui écrit au journal, sur des cartes publiques.
    await room.handleIntent(a, 'meule', { type: 'MILL', count: 3 });
    await room.handleIntent(a, 'exil', { type: 'EXILE_TOP', count: 2 });
    await room.handleIntent(a, 'defausse', { type: 'RANDOM_DISCARD', count: 1 });
    const main = getZone(room.state, { seat: 'seat_0', kind: 'HAND' }).slice(0, 2);
    await room.handleIntent(a, 'lot', {
      type: 'MOVE_CARDS',
      cardIds: main,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
    });

    /*
     * `TAKE_BACK` ne nettoie que les entrées qui **ancrent** l'objet, et c'est
     * délibéré : sans l'ancre, il effacerait le nom d'un autre exemplaire
     * portant le même titre. La contrepartie est l'invariant vérifié ici — un
     * nom écrit sans ancre serait hors de portée de l'oubli, et ce test échoue
     * dès qu'une formulation future en introduit un.
     */
    for (const entree of room.state.log) {
      for (const obj of room.state.objects.values()) {
        // Mot entier, comme le nettoyage lui-même : « Carte 1 » n'est pas
        // nommée par une ligne qui parle de « Carte 12 ».
        if (!nomme(entree.text, obj.card.name)) continue;
        expect(entree.cardIds, `« ${entree.text} » nomme ${obj.card.name} sans l’ancrer`).toContain(obj.id);
      }
    }
  });

  it('n’écorche pas le nom d’une carte dont celui de la reprise est un préfixe', async () => {
    const { room, a } = twoSeatTable(7);
    room.startGame('seat_0');

    // Le fixture donne « Carte 1 » et « Carte 12 » : le piège du préfixe est
    // là, gratuitement, et il vaut pour « Île » et « Île Sanctuaire ».
    const cible = [...room.state.objects.values()].find(
      (o) => o.card.name === 'Carte 1' && o.owner === 'seat_0',
    )!;
    const voisine = [...room.state.objects.values()].find(
      (o) => o.card.name === 'Carte 12' && o.owner === 'seat_0',
    )!;

    for (const [i, obj] of [cible, voisine].entries()) {
      await room.handleIntent(a, `pose-${i}`, {
        type: 'MOVE_CARD',
        cardId: obj.id,
        to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
        x: 10 * i,
        y: 10,
      });
    }
    await room.handleIntent(a, 'oubli', { type: 'TAKE_BACK', cardId: cible.id, to: 'HAND' });

    const lignes = room.snapshotFor('seat_1').logTail.map((e) => e.text);
    expect(lignes.some((t) => nomme(t, 'Carte 12'))).toBe(true);
    expect(lignes.some((t) => nomme(t, 'Carte 1'))).toBe(false);
    expect(lignes.some((t) => t.includes('une carte2'))).toBe(false);
  });
});

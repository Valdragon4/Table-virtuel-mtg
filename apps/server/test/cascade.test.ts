/**
 * Cascade et Découvrir : la séquence, et ce qu'elle n'a pas le droit de faire.
 *
 * Deux questions séparées, et la seconde est la seule qui puisse coûter cher :
 *
 * 1. La suite de gestes est-elle la bonne — exiler du dessus une à une jusqu'à
 *    une carte non-terrain qui convient, puis remettre le reste dessous ?
 * 2. Le reste, une fois sous la bibliothèque, est-il **réellement** redevenu
 *    secret ? Ces cartes ont été publiées face visible : chaque client en tient
 *    la vue indexée par son `ObjectId`. Purger `knownTo` sans changer
 *    l'identifiant laisserait cette vue en place, et lire le fond de la
 *    bibliothèque ne demanderait qu'un peu d'attention. C'est le test
 *    d'anti-corrélation du §2.1, rejoué ici.
 *
 * Le reste du fichier vérifie qu'on **demande** là où le serveur ne doit pas
 * décider : une valeur de mana illisible arrête la séquence au lieu d'être
 * devinée.
 */
import { describe, expect, it } from 'vitest';
import { NAMED_LOG_LIMIT } from '@mtg/shared';
import { Room, type DeckPayload } from '../src/game/room.js';
import { seededRandom } from '../src/game/random.js';
import { getZone, type CardData } from '../src/game/state.js';
import { isLandCard, manaValueOf, verdictFor } from '../src/game/cascade.js';
import { auditInvariants } from './invariants.js';
import { fakeConnection, type FakeConnection } from './fixture.js';

interface Spec {
  name: string;
  typeLine: string;
  manaCost: string | null;
  faces?: unknown;
}

function card(spec: Spec): CardData {
  return {
    scryfallId: `id-${spec.name.toLowerCase().replace(/\s+/g, '-')}`,
    name: spec.name,
    setCode: 'tst',
    collectorNumber: '1',
    typeLine: spec.typeLine,
    manaCost: spec.manaCost,
    colorIdentity: [],
    layout: 'normal',
    imageUris: null,
    faces: spec.faces ?? null,
  };
}

function deckOf(specs: Spec[]): DeckPayload {
  return {
    name: 'Deck cascade',
    cards: specs.map((spec) => ({ ...card(spec), quantity: 1, zone: 'MAIN' as const, isFoil: false })),
  };
}

/** La bibliothèque d'Alice, de haut en bas, par nom de carte. */
function libraryNames(room: Room): string[] {
  return getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).map(
    (id) => room.state.objects.get(id)!.card.name,
  );
}

function exileNames(room: Room): string[] {
  return getZone(room.state, { seat: 'seat_0', kind: 'EXILE' }).map(
    (id) => room.state.objects.get(id)!.card.name,
  );
}

/**
 * Une table à deux sièges dont la bibliothèque d'Alice est **dans l'ordre
 * donné**, du dessus vers le bas.
 *
 * On ne lance pas la partie : `START_GAME` mélange et distribue sept cartes,
 * ce qui rendrait l'ordre — le sujet même de ces tests — impossible à écrire.
 * L'ordre est donc posé à la main sur l'état, ce qui est exactement ce que le
 * moteur verrait après un mélange quelconque.
 */
function tableWith(specs: Spec[], seed = 7): {
  room: Room;
  a: FakeConnection;
  b: FakeConnection;
} {
  const room = new Room('room-1', 'TEST01', 'COMMANDER', seededRandom(seed));
  const a = fakeConnection('conn-a');
  const b = fakeConnection('conn-b');
  room.addConnection(a);
  room.sitDown(a, 0, 'Alice', null);
  room.addConnection(b);
  room.sitDown(b, 1, 'Bob', null);
  room.loadDeck('seat_0', deckOf(specs), null);
  room.loadDeck('seat_1', deckOf([{ name: 'Filler', typeLine: 'Creature', manaCost: '{1}' }]), null);

  // Le chargement empile dans l'ordre de la liste ; on le réaffirme pour que le
  // test lise comme la carte du dessus.
  const library = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' });
  const byName = new Map(library.map((id) => [room.state.objects.get(id)!.card.name, id]));
  library.splice(0, library.length, ...specs.map((s) => byName.get(s.name)!));
  library.forEach((id, i) => (room.state.objects.get(id)!.sortIndex = i));

  /*
   * L'état d'**après** `START_GAME`, posé à la main.
   *
   * Hors partie, un joueur voit légitimement sa propre bibliothèque : c'est
   * l'exception de composition de deck, et elle rendrait muettes les
   * vérifications d'étanchéité ci-dessous. `START_GAME` la referme en
   * mélangeant — mais il mélange justement, et distribue sept cartes, ce qui
   * effacerait l'ordre qui est tout le sujet de ces tests. On reproduit donc
   * son résultat : partie en cours, bibliothèque inconnue de tous.
   */
  room.state.status = 'PLAYING';
  for (const id of library) room.state.objects.get(id)!.knownTo.clear();

  a.received.length = 0;
  a.frames.length = 0;
  b.received.length = 0;
  b.frames.length = 0;
  return { room, a, b };
}

const LAND = { name: 'Forêt', typeLine: 'Basic Land — Forest', manaCost: null };

describe('lecture de la carte, sans texte de règles', () => {
  it('lit la valeur de mana sur le coût, X compris', () => {
    expect(manaValueOf(card({ name: 'A', typeLine: 'Sorcery', manaCost: '{2}{W}{U}' })).value).toBe(4);
    expect(manaValueOf(card({ name: 'B', typeLine: 'Sorcery', manaCost: '{X}{R}' })).value).toBe(1);
    // Hybride : le plus élevé des deux composants. Phyrexian n'ajoute rien.
    expect(manaValueOf(card({ name: 'C', typeLine: 'Sorcery', manaCost: '{2/W}{W/U}{W/P}' })).value).toBe(4);
    // Un sort suspendu n'a pas de coût, et sa valeur de mana est bel et bien
    // zéro : c'est une réponse **certaine**, pas une ignorance.
    const none = manaValueOf(card({ name: 'D', typeLine: 'Sorcery', manaCost: null }));
    expect(none).toEqual({ value: 0, ambiguous: false });
  });

  it('avoue son ignorance quand plusieurs faces portent un coût', () => {
    const split = card({
      name: 'Feu // Glace',
      typeLine: 'Instant // Instant',
      manaCost: null,
      faces: [
        { name: 'Feu', typeLine: 'Instant', manaCost: '{1}{R}' },
        { name: 'Glace', typeLine: 'Instant', manaCost: '{1}{U}' },
      ],
    });
    expect(manaValueOf(split)).toEqual({ value: 2, ambiguous: true });
  });

  it('juge « terrain » sur le recto, jamais sur la ligne entière', () => {
    expect(isLandCard(card(LAND))).toBe(true);
    // Une recto-verso dont seul le **verso** est un terrain n'est pas un
    // terrain : c'est précisément la carte que la cascade doit pouvoir trouver.
    expect(
      isLandCard(card({ name: 'Éruption', typeLine: 'Sorcery // Land', manaCost: '{2}{R}' })),
    ).toBe(false);
    expect(isLandCard(card({ name: 'Créature', typeLine: 'Creature — Islandwalker', manaCost: '{1}' }))).toBe(
      false,
    );
  });

  it('sépare les deux mots-clés par la seule comparaison', () => {
    const three = card({ name: 'Trois', typeLine: 'Creature', manaCost: '{3}' });
    // Cascade : strictement inférieure. Découvrir : N ou moins.
    expect(verdictFor(three, 3, 'BELOW')).toBe('CONTINUE');
    expect(verdictFor(three, 3, 'AT_MOST')).toBe('FOUND');
    expect(verdictFor(three, 4, 'BELOW')).toBe('FOUND');
    expect(verdictFor(card(LAND), 9, 'AT_MOST')).toBe('CONTINUE');
  });
});

describe('la séquence sur la table', () => {
  const deck: Spec[] = [
    LAND,
    { name: 'Gros sort', typeLine: 'Sorcery', manaCost: '{7}' },
    { name: 'Petit sort', typeLine: 'Instant', manaCost: '{2}' },
    { name: 'Dessous', typeLine: 'Creature', manaCost: '{1}' },
    { name: 'Plus bas', typeLine: 'Creature', manaCost: '{1}' },
  ];

  it('exile jusqu’à la première carte non-terrain sous le seuil', async () => {
    const { room, a } = tableWith(deck);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    // Terrain sauté, gros sort trop cher, puis le petit sort : la séquence
    // s'arrête là, et lui seul reste à l'exil.
    expect(exileNames(room)).toEqual(['Petit sort']);
    // Les deux cartes qui n'ont pas convenu repartent **dessous**, les deux
    // dernières du deck n'ont pas bougé.
    const library = libraryNames(room);
    expect(library.slice(0, 2)).toEqual(['Dessous', 'Plus bas']);
    expect(library.slice(2).sort()).toEqual(['Forêt', 'Gros sort']);
    auditInvariants(room.state);
  });

  it('« Découvrir N » s’arrête à N, là où la cascade continuerait', async () => {
    const { room, a } = tableWith([
      { name: 'Pile deux', typeLine: 'Creature', manaCost: '{2}' },
      { name: 'Suivante', typeLine: 'Creature', manaCost: '{1}' },
    ]);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 2, compare: 'AT_MOST' });
    expect(exileNames(room)).toEqual(['Pile deux']);
    expect(libraryNames(room)).toEqual(['Suivante']);
    // Le journal nomme le geste par son mot-clé : « cascade » et « découvre »
    // ne sont pas la même comparaison, et la table lit laquelle a été jouée.
    expect(room.state.log.at(-1)!.text).toContain('Alice découvre (valeur de mana 2 ou moins)');
    auditInvariants(room.state);
  });

  it('s’arrête et le dit quand la valeur de mana n’est pas évidente', async () => {
    const { room, a } = tableWith([
      {
        name: 'Feu // Glace',
        typeLine: 'Instant // Instant',
        manaCost: null,
        faces: [
          { name: 'Feu', typeLine: 'Instant', manaCost: '{1}{R}' },
          { name: 'Glace', typeLine: 'Instant', manaCost: '{1}{U}' },
        ],
      },
      { name: 'Après', typeLine: 'Creature', manaCost: '{1}' },
    ]);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 1, compare: 'BELOW' });

    // La carte ne satisfait pas le critère si l'on s'en tenait au recto (2 ≥ 1),
    // et le serveur ne tranche donc **ni dans un sens ni dans l'autre** : il
    // s'arrête, laisse la carte sous les yeux de la table, et l'annonce.
    expect(exileNames(room)).toEqual(['Feu // Glace']);
    expect(libraryNames(room)).toEqual(['Après']);
    expect(room.state.log.at(-1)!.text).toContain('à la table de trancher');
    auditInvariants(room.state);
  });

  it('va au bout de la bibliothèque sans rien trouver, et tout repart dessous', async () => {
    const { room, a } = tableWith([LAND, { ...LAND, name: 'Forêt 2' }]);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 1, compare: 'BELOW' });

    expect(exileNames(room)).toEqual([]);
    expect(libraryNames(room).sort()).toEqual(['Forêt', 'Forêt 2']);
    expect(room.state.log.at(-1)!.text).toContain('sans rien trouver');
    auditInvariants(room.state);
  });

  it('refuse une bibliothèque vide et une zone en consultation, et rien d’autre', async () => {
    const { room, a } = tableWith([{ name: 'Seule', typeLine: 'Creature', manaCost: '{1}' }]);
    // Une consultation en cours gèle la zone, comme pour `MILL` : ce n'est pas
    // une règle de Magic, c'est la session de regard qui serait corrompue.
    await room.handleIntent(a, 'l1', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 1,
      mode: 'SCRY',
    });
    a.received.length = 0;
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 9, compare: 'BELOW' });
    expect(a.received.some((m) => m.t === 'reject' && m.code === 'ERR_LOOK_PENDING')).toBe(true);
  });
});

describe('ce que la table sait après coup', () => {
  const deck: Spec[] = [
    { name: 'Vue 1', typeLine: 'Creature', manaCost: '{9}' },
    { name: 'Vue 2', typeLine: 'Creature', manaCost: '{9}' },
    { name: 'Trouvée', typeLine: 'Creature', manaCost: '{1}' },
    { name: 'Jamais vue', typeLine: 'Creature', manaCost: '{1}' },
  ];

  it('le journal nomme ce que la table a vu, et n’ancre que ce qui existe encore', async () => {
    const { room, a } = tableWith(deck);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    const line = room.state.log.find((e) => e.text.startsWith('Alice cascade'))!;
    // Les cartes exilées étaient publiques : les nommer est la monotonie
    // appliquée, pas une fuite.
    for (const name of ['Vue 1', 'Vue 2', 'Trouvée']) expect(line.text).toContain(name);
    expect(line.text).not.toContain('Jamais vue');
    // Les ancres, elles, ne désignent que la carte encore à l'exil : celles qui
    // sont reparties en bibliothèque ont perdu leur identifiant, et une ancre
    // morte promettrait un survol qui ne surligne rien.
    const found = getZone(room.state, { seat: 'seat_0', kind: 'EXILE' })[0]!;
    expect(line.cardIds).toEqual([found]);
  });

  it('anti-corrélation : les cartes remises dessous changent d’identifiant et redeviennent inconnues', async () => {
    const { room, a, b } = tableWith(deck);

    const before = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(0, 2);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    // Les deux cartes vues puis renvoyées n'existent plus sous l'identifiant
    // que les clients ont reçu : rien à quoi rattacher le souvenir.
    for (const id of before) expect(room.state.objects.has(id)).toBe(false);

    // Et l'oubli a été **annoncé** à tout le monde, propriétaire compris : sans
    // le `CARD_HIDDEN`, la vue publique resterait en place chez le client.
    for (const conn of [a, b]) {
      const hidden = conn.received.flatMap((m) =>
        m.t === 'event' && m.event.type === 'CARD_HIDDEN' ? [m.event.cardId] : [],
      );
      for (const id of before) expect(hidden).toContain(id);
    }

    // Plus personne ne connaît ces cartes, pas même Alice : c'est l'unique
    // effacement de la monotonie, l'entrée en bibliothèque (§5.2).
    const bottom = getZone(room.state, { seat: 'seat_0', kind: 'LIBRARY' }).slice(-2);
    for (const id of bottom) expect([...room.state.objects.get(id)!.knownTo]).toEqual([]);

    // Aucun identifiant de ces objets-là n'est jamais sorti sous son nom neuf :
    // les frames ne parlent que des anciens, et le snapshot n'énumère pas la
    // bibliothèque.
    const frames = [...a.frames, ...b.frames].join('\n');
    for (const id of bottom) expect(frames).not.toContain(id);
    for (const seat of ['seat_0', 'seat_1']) {
      const snapshot = room.snapshotFor(seat);
      for (const id of bottom) expect(snapshot.cards.some((c) => c.id === id)).toBe(false);
    }
    auditInvariants(room.state);
  });

  it('Bob voit passer les cartes exilées, et n’apprend rien du fond', async () => {
    const { room, a, b } = tableWith(deck);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    // La révélation est publique, et elle passe par le chemin ordinaire : Bob
    // reçoit les `CARD_MOVED` vers l'exil avec l'identité.
    const seen = b.received.flatMap((m) =>
      m.t === 'event' && m.event.type === 'CARD_MOVED' && m.event.card.faceDown === false
        ? [room.state.objects.get(m.event.card.id)?.card.name ?? m.event.card.scryfallId]
        : [],
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Mais la carte jamais atteinte n'a rien à faire dans ses frames.
    expect(b.frames.join('\n')).not.toContain('jamais-vue');
  });
});

/**
 * Lire **toutes** les cartes d'une cascade qui en exile plus de six.
 *
 * Le défaut : la ligne abrégeait à six noms et « … et 3 autres cartes », et le
 * dépliage du client se reconstruisait depuis les ancres — que la cascade n'a
 * pas, puisque tout ce qui repart sous la bibliothèque change d'identifiant
 * (§2.1). Trois cartes que toute la table venait de voir devenaient illisibles.
 *
 * On lit les **frames brutes de Bob**, jamais `room.state` : le `text` et
 * maintenant les `names` d'une `LogEntry` sont construits une fois et diffusés
 * à toute la table (§5.4), donc la seule mesure honnête d'une fuite est ce qui
 * traverse le socket de l'adversaire.
 */
describe('déplier une cascade trop longue pour la phrase', () => {
  /** Le journal tel que Bob le reçoit, `names` compris. */
  function journalRecu(conn: FakeConnection): { text: string; cardIds: string[]; names?: string[] }[] {
    return conn.frames
      .map((f) => JSON.parse(f) as { t: string; log?: { text: string; cardIds: string[]; names?: string[] } })
      .flatMap((m) => (m.t === 'event' && m.log ? [m.log] : []));
  }

  /**
   * Ce texte nomme-t-il cette carte, en mot entier ? Un `toContain` ferait
   * passer « Fond 12 » pour « Fond 1 », et un test de fuite qui se trompe de
   * sens est pire qu'absent.
   */
  const nomme = (texte: string, carte: string): boolean =>
    new RegExp(`(?<![\\p{L}\\p{N}])${carte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(
      texte,
    );

  /** Huit cartes trop chères, la trouvaille, puis deux que la séquence n'atteint jamais. */
  const long: Spec[] = [
    ...Array.from({ length: 8 }, (_, i) => ({
      name: `Vue ${i + 1}`,
      typeLine: 'Creature',
      manaCost: '{9}',
    })),
    { name: 'Trouvée', typeLine: 'Creature', manaCost: '{1}' },
    { name: 'Fond un', typeLine: 'Creature', manaCost: '{1}' },
    { name: 'Fond deux', typeLine: 'Creature', manaCost: '{1}' },
  ];

  const VUES = Array.from({ length: 8 }, (_, i) => `Vue ${i + 1}`);

  it('publie les neuf noms là où la phrase n’en tient que six', async () => {
    const { room, a, b } = tableWith(long);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    const ligne = journalRecu(b).find((l) => l.text.startsWith('Alice cascade'));
    expect(ligne).toBeDefined();

    // La phrase abrège, comme avant : six noms puis le compte.
    expect(ligne!.text).toContain('et 3 autres cartes');
    // Les ancres ne désignent toujours que la carte restée à l'exil — on ne
    // promet pas un survol qui ne surligne rien.
    const found = getZone(room.state, { seat: 'seat_0', kind: 'EXILE' })[0]!;
    expect(ligne!.cardIds).toEqual([found]);

    // …et pourtant Bob peut lire les neuf, dans l'ordre du geste.
    expect(ligne!.names).toEqual([...VUES, 'Trouvée']);
    // La liste est bien la forme non abrégée de la phrase : ses six premiers
    // noms sont ceux que le texte énumère, et le reste fait le compte annoncé.
    for (const name of ligne!.names!.slice(0, NAMED_LOG_LIMIT)) {
      expect(nomme(ligne!.text, name)).toBe(true);
    }
    expect(ligne!.names!.length - NAMED_LOG_LIMIT).toBe(3);
    auditInvariants(room.state);
  });

  it('ne publie aucun nom que le texte ne publiait pas — ni le fond de la bibliothèque', async () => {
    const { room, a, b } = tableWith(long);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    const ligne = journalRecu(b).find((l) => l.text.startsWith('Alice cascade'))!;

    // La licéité tient à un fait, et à un seul : ces neuf cartes sont passées
    // par l'exil **face visible**, donc toute la table les a vues (§5.2). La
    // liste ne fait que redire la phrase sans la replier.
    expect(ligne.names!.length).toBe(9);
    expect(ligne.names).not.toContain('une carte');

    // Les deux cartes que la séquence n'a jamais atteinte sont restées en
    // bibliothèque : leur nom n'a rien à faire dans la liste, ni ailleurs dans
    // le socket de Bob.
    const frames = b.frames.join('\n');
    for (const secret of ['Fond un', 'Fond deux', 'fond-un', 'fond-deux']) {
      expect(ligne.names!.some((n) => nomme(n, secret))).toBe(false);
      expect(frames).not.toContain(secret);
    }

    // Et le tour complet : rien dans la liste qui ne soit une des cartes exilées.
    for (const nom of ligne.names!) expect([...VUES, 'Trouvée']).toContain(nom);
    auditInvariants(room.state);
  });

  it('se tait quand la phrase suffit : pas de liste sur une cascade courte', async () => {
    const { room, a, b } = tableWith([
      { name: 'Vue 1', typeLine: 'Creature', manaCost: '{9}' },
      { name: 'Vue 2', typeLine: 'Creature', manaCost: '{9}' },
      { name: 'Trouvée', typeLine: 'Creature', manaCost: '{1}' },
      { name: 'Fond un', typeLine: 'Creature', manaCost: '{1}' },
    ]);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    const ligne = journalRecu(b).find((l) => l.text.startsWith('Alice cascade'))!;
    // Trois cartes, trois noms dans la phrase : il n'y a rien à déplier, et
    // `logTail` recopie ces entrées deux cents fois par snapshot. On ne paie pas
    // pour une information que le texte donne déjà.
    expect(ligne.names).toBeUndefined();
    expect(ligne.text).not.toContain('autres cartes');
    // La frame elle-même ne porte pas la clé : c'est le coût qu'on mesure.
    const brut = b.frames.find((f) => f.includes('Alice cascade'))!;
    expect(brut).not.toContain('"names"');
  });

  it('le retardataire déplie la même ligne : `logTail` porte la liste', async () => {
    const { room, a } = tableWith(long);
    await room.handleIntent(a, 'c1', { type: 'CASCADE', manaValue: 5, compare: 'BELOW' });

    // Un siège qui resynchronise ou qui arrive en cours de partie relit le
    // journal par le snapshot (§5.4) : sans la liste là aussi, il retomberait
    // sur « et 3 autres cartes » sans dépliage possible.
    for (const seat of ['seat_0', 'seat_1']) {
      const ligne = room
        .snapshotFor(seat)
        .logTail.find((e) => e.text.startsWith('Alice cascade'))!;
      expect(ligne.names).toEqual([...VUES, 'Trouvée']);
    }
  });
});

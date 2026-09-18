/**
 * Le journal abrège au-delà de six noms, mais il ancre **toutes** les cartes du
 * lot dans `cardIds`. Déplier une ligne, c'est relire ces ancres — jamais
 * découper la phrase française, qui sera bientôt traduite.
 *
 * Le test garde surtout la frontière de visibilité : une carte que le serveur
 * ne nous a pas nommée reste « une carte ». La regagner localement (cache,
 * homonyme, prédiction) ne serait pas un bug d'affichage, ce serait une triche.
 */
import { describe, expect, it } from 'vitest';
import { NAMED_LOG_LIMIT, type CardView, type ObjectId } from '@mtg/shared';
import { estAbregee, nomsDeplies, nomsDesCartes } from '../src/components/ActionLog.js';

const zone = { seat: 'seat_0', kind: 'BATTLEFIELD' as const };

/** Vue publique : le serveur a laissé passer l'identité jusqu'à nous. */
function visible(id: ObjectId, scryfallId: string): CardView {
  return {
    id,
    kind: 'CARD',
    owner: 'seat_0',
    controller: 'seat_0',
    zone,
    tapped: false,
    x: 0,
    y: 0,
    rotation: 0,
    counters: [],
    sortIndex: 0,
    faceDown: false,
    scryfallId,
    flipped: false,
    isFoil: false,
  };
}

/** Vue cachée : la carte est là, son identité n'a pas traversé le socket. */
function cachee(id: ObjectId): CardView {
  return {
    id,
    kind: 'CARD',
    owner: 'seat_1',
    controller: 'seat_1',
    zone,
    tapped: false,
    x: 0,
    y: 0,
    rotation: 0,
    counters: [],
    sortIndex: 0,
    faceDown: true,
  };
}

/** Le cache de métadonnées, réduit à ce que le test contrôle. */
const CATALOGUE: Record<string, string> = {
  'sf-1': 'Serra Paragon',
  'sf-2': 'Plains',
  'sf-3': 'Unclaimed Territory',
  'sf-4': 'Discerning Financier',
  'sf-5': 'Plains',
  'sf-6': 'Nykthos, Shrine to Nyx',
  'sf-7': 'Swamp',
  'sf-8': 'Island',
};
const nomDeMeta = (id: string): string | undefined => CATALOGUE[id];

describe('dépliage d’une ligne de journal abrégée', () => {
  it('ne propose le dépliage qu’au-delà de ce que le serveur énumère', () => {
    const ids = (n: number): ObjectId[] => Array.from({ length: n }, (_, i) => `obj_${i}`);
    // Le seuil se lit dans `@mtg/shared`, là où le serveur le lit aussi : la
    // frontière est vérifiée *autour de la valeur partagée*, et non autour
    // d'un 6 recopié qui ne voudrait plus rien dire le jour où elle change.
    expect(NAMED_LOG_LIMIT).toBe(6);
    expect(estAbregee(ids(0))).toBe(false);
    expect(estAbregee(ids(1))).toBe(false);
    expect(estAbregee(ids(NAMED_LOG_LIMIT))).toBe(false);
    expect(estAbregee(ids(NAMED_LOG_LIMIT + 1))).toBe(true);
    expect(estAbregee(ids(NAMED_LOG_LIMIT + 3))).toBe(true);
  });

  it('rend toutes les cartes du lot, y compris celles que le texte a repliées', () => {
    // La ligne du serveur : « Valdragon a dégagé Serra Paragon, Plains,
    // Unclaimed Territory, Discerning Financier, Plains, Nykthos, Shrine to Nyx
    // et 3 autres cartes ». Neuf ancres pour six noms.
    const cardIds = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9'];
    const cards = new Map<ObjectId, CardView>([
      ['o1', visible('o1', 'sf-1')],
      ['o2', visible('o2', 'sf-2')],
      ['o3', visible('o3', 'sf-3')],
      ['o4', visible('o4', 'sf-4')],
      ['o5', visible('o5', 'sf-5')],
      ['o6', visible('o6', 'sf-6')],
      ['o7', visible('o7', 'sf-7')],
      ['o8', visible('o8', 'sf-8')],
      ['o9', cachee('o9')],
    ]);

    expect(estAbregee(cardIds)).toBe(true);
    expect(nomsDesCartes(cardIds, cards, nomDeMeta)).toEqual([
      'Serra Paragon',
      'Plains',
      'Unclaimed Territory',
      'Discerning Financier',
      'Plains',
      'Nykthos, Shrine to Nyx',
      'Swamp',
      'Island',
      'une carte',
    ]);
  });

  it('dit « une carte » dès que le store ne porte pas l’identité', () => {
    const cards = new Map<ObjectId, CardView>([
      ['connu', visible('connu', 'sf-1')],
      ['masque', cachee('masque')],
      // Vue publique dont le nom n'est pas (encore) dans le cache : on ne
      // devine pas, on retombe sur la périphrase du serveur.
      ['sans-meta', visible('sans-meta', 'sf-inconnu')],
    ]);
    // « absent » n'est nulle part dans le store : le serveur ne nous en a rien dit.
    const noms = nomsDesCartes(['connu', 'masque', 'sans-meta', 'absent'], cards, nomDeMeta);
    expect(noms).toEqual(['Serra Paragon', 'une carte', 'une carte', 'une carte']);
  });

  it('ne fait jamais apparaître un nom que le store ne contenait pas', () => {
    const cards = new Map<ObjectId, CardView>([['o1', visible('o1', 'sf-1')]]);
    const cardIds = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];

    // Un résolveur hostile : il connaît toute la base, y compris des cartes dont
    // le store n'a reçu aucune vue. Aucun de ces noms ne doit sortir.
    const omniscient = (id: string): string => `SECRET:${id}`;
    const noms = nomsDesCartes(cardIds, cards, omniscient);

    expect(noms.filter((n) => n.startsWith('SECRET:'))).toEqual(['SECRET:sf-1']);
    expect(noms.slice(1)).toEqual(Array.from({ length: 6 }, () => 'une carte'));
  });
});

/**
 * Déplier une ligne qui n'a plus d'ancres.
 *
 * Une cascade exile face visible puis renvoie tout sous la bibliothèque sous un
 * identifiant neuf : le store ne contient plus ces cartes, et il ne reste
 * qu'une ancre pour neuf. Le dépliage ne peut donc pas se reconstruire depuis
 * `cardIds` — le serveur publie la liste, parce que le dépliage sert à **lire
 * des noms**, pas à survoler des cartes.
 */
describe('dépliage d’une ligne sans ancres (cascade)', () => {
  /** La ligne telle que le serveur l'écrit : une ancre, neuf noms. */
  const cascade = {
    cardIds: ['exil-1'],
    names: [
      'Vue 1',
      'Vue 2',
      'Vue 3',
      'Vue 4',
      'Vue 5',
      'Vue 6',
      'Vue 7',
      'Vue 8',
      'Trouvée',
    ],
  };

  it('juge la ligne dépliable sur le lot, pas sur le nombre d’ancres', () => {
    // Compter les ancres donnerait 1 : le bouton disparaîtrait exactement là
    // où il sert.
    expect(estAbregee(cascade.cardIds)).toBe(false);
    expect(estAbregee(cascade.cardIds, cascade.names)).toBe(true);
    // Et une liste qui tient dans la phrase ne se déplie pas : le texte l'a
    // déjà dite en entier.
    expect(estAbregee(['a'], ['Vue 1', 'Vue 2'])).toBe(false);
    expect(estAbregee([], Array.from({ length: NAMED_LOG_LIMIT }, () => 'X'))).toBe(false);
  });

  it('rend les neuf noms alors que le store n’en connaît qu’un', () => {
    // Les huit autres ont changé d'identifiant en repartant sous la
    // bibliothèque : le store ne peut rien en dire, et c'est bien le problème.
    const cards = new Map<ObjectId, CardView>([['exil-1', visible('exil-1', 'sf-1')]]);
    expect(nomsDeplies(cascade, cards, nomDeMeta)).toEqual(cascade.names);
  });

  it('retombe sur les ancres dès que le serveur ne publie pas de liste', () => {
    // Le chemin normal reste le chemin normal : rien n'a changé pour les lignes
    // dont les ancres couvrent le lot, et on ne paie pas de liste pour elles.
    const cards = new Map<ObjectId, CardView>([
      ['o1', visible('o1', 'sf-1')],
      ['o2', cachee('o2')],
    ]);
    expect(nomsDeplies({ cardIds: ['o1', 'o2'] }, cards, nomDeMeta)).toEqual([
      'Serra Paragon',
      'une carte',
    ]);
  });

  it('n’invente rien : la liste affichée est exactement celle reçue', () => {
    // Le serveur a déjà passé chaque nom par `publicName`, et une carte que la
    // table ne pouvait pas identifier y arrive en périphrase. Le client la
    // recopie telle quelle — pas de complément par le cache, pas de filtrage.
    const muette = { cardIds: [], names: ['Vue 1', 'une carte', 'une carte'] };
    const omniscient = (id: string): string => `SECRET:${id}`;
    const noms = nomsDeplies(muette, new Map(), omniscient);
    expect(noms).toEqual(['Vue 1', 'une carte', 'une carte']);
    expect(noms.some((n) => n.startsWith('SECRET:'))).toBe(false);
  });
});

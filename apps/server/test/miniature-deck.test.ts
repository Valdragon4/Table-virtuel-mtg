/**
 * La carte qui représente un deck dans « Mes decks ».
 *
 * Ce que ce fichier fige n'est pas un détail d'affichage : c'est un
 * **arbitrage**, pris une fois, et que rien dans l'interface ne rappellerait à
 * celui qui le renverserait par inadvertance. Une miniature qui change toute
 * seule d'un rechargement à l'autre, ou qui montre la Forêt d'un deck de
 * cinquante cartes, ne casse aucun test tant qu'on ne les a pas écrits.
 *
 * Quatre propriétés, dans l'ordre où la fonction les tranche :
 *  1. le commandant l'emporte sur tout le reste ;
 *  2. avec deux commandants, c'est **le premier affiché** sur la ligne ;
 *  3. sans commandant, la carte la plus chère de la zone principale, terrains
 *     de base écartés ;
 *  4. le choix est **total et déterministe** : l'ordre dans lequel la base rend
 *     les lignes ne doit rien y changer.
 */
import { describe, expect, it } from 'vitest';
/*
 * Le type est importé en `import type` : il disparaît à la compilation et ne
 * charge donc pas le module. La **fonction**, elle, tire `isBasicLandTypeLine`
 * de `cards/scryfall.ts`, qui valide la configuration du serveur dès son
 * chargement ; on peuple l'environnement avant de l'importer, comme le font
 * déjà les autres tests de ce dossier. Rien ici ne touche la base ni le réseau.
 */
import type { ThumbnailCandidate } from '../src/decks/thumbnail.js';

process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const { chooseDeckThumbnail } = await import('../src/decks/thumbnail.js');

let compteur = 0;

/** Une carte de deck, avec des valeurs plausibles pour ce qu'on ne teste pas. */
function carte(partial: Partial<ThumbnailCandidate> & { name: string }): ThumbnailCandidate {
  compteur += 1;
  return {
    // Un identifiant stable et lisible : la comparaison de dernier recours le
    // regarde, et un UUID aléatoire rendrait ce test-là intestable.
    scryfallId: `id-${String(compteur).padStart(3, '0')}`,
    zone: 'MAIN',
    sortIndex: compteur,
    typeLine: 'Creature — Human Wizard',
    cmc: 2,
    rarity: 'common',
    ...partial,
  };
}

const PLAINE: Partial<ThumbnailCandidate> = {
  typeLine: 'Basic Land — Plains',
  cmc: 0,
  rarity: 'common',
};

describe('le commandant par défaut', () => {
  it("prend le commandant même si la zone principale contient bien plus cher", () => {
    const thumb = chooseDeckThumbnail([
      carte({ name: 'Sol Ring', cmc: 1 }),
      carte({ name: 'Emrakul', cmc: 15, rarity: 'mythic' }),
      carte({ name: 'Selenia', zone: 'COMMANDER', sortIndex: 0, cmc: 4, rarity: 'rare' }),
    ]);
    expect(thumb?.name).toBe('Selenia');
  });

  it("ignore la réserve, qui n'est pas ce qu'on joue", () => {
    const thumb = chooseDeckThumbnail([
      carte({ name: 'Bête de réserve', zone: 'SIDEBOARD', cmc: 9, rarity: 'mythic' }),
      carte({ name: 'Ours', cmc: 2 }),
    ]);
    expect(thumb?.name).toBe('Ours');
  });
});

describe('deux commandants', () => {
  /*
   * Partenaires, Compagnon/Background : la zone COMMANDER en porte deux. La
   * ligne du deck les affiche dans l'ordre de `sortIndex` — « A & B » — et la
   * miniature doit montrer A. Montrer B ferait lire un nom et voir l'autre.
   */
  it('montre le premier nom affiché, et non le plus cher', () => {
    const cartes = [
      carte({ name: 'Thrasios', zone: 'COMMANDER', sortIndex: 0, cmc: 2, rarity: 'rare' }),
      carte({ name: 'Tymna', zone: 'COMMANDER', sortIndex: 1, cmc: 3, rarity: 'mythic' }),
    ];
    expect(chooseDeckThumbnail(cartes)?.name).toBe('Thrasios');
    // Et l'ordre dans lequel la base les rend n'y change rien.
    expect(chooseDeckThumbnail([...cartes].reverse())?.name).toBe('Thrasios');
  });
});

describe('sans commandant', () => {
  it('prend la carte la plus chère de la zone principale', () => {
    const thumb = chooseDeckThumbnail([
      carte({ name: 'Éclair', cmc: 1, rarity: 'uncommon' }),
      carte({ name: 'Dragon ancestral', cmc: 8, rarity: 'rare' }),
      carte({ name: 'Contresort', cmc: 2, rarity: 'uncommon' }),
    ]);
    expect(thumb?.name).toBe('Dragon ancestral');
  });

  it('départage deux cartes de même coût par la rareté', () => {
    const thumb = chooseDeckThumbnail([
      carte({ name: 'Rare à six', cmc: 6, rarity: 'rare', sortIndex: 1 }),
      carte({ name: 'Mythique à six', cmc: 6, rarity: 'mythic', sortIndex: 2 }),
    ]);
    expect(thumb?.name).toBe('Mythique à six');
  });

  it("n'élit jamais un terrain de base tant qu'autre chose existe", () => {
    // Le cas se poserait si l'on inversait un jour l'ordre de tri : la garde est
    // explicite plutôt que déduite du fait qu'un terrain vaut 0.
    const thumb = chooseDeckThumbnail([
      carte({ name: 'Plaine', ...PLAINE }),
      carte({ name: 'Plaine enneigée', ...PLAINE, typeLine: 'Basic Snow Land — Plains' }),
      carte({ name: 'Ours', cmc: 2 }),
    ]);
    expect(thumb?.name).toBe('Ours');
  });

  it('accepte un terrain de base en dernier recours plutôt que rien', () => {
    // Un cadre vide est une plus mauvaise miniature qu'une Forêt.
    const thumb = chooseDeckThumbnail([carte({ name: 'Forêt', ...PLAINE, typeLine: 'Basic Land — Forest' })]);
    expect(thumb?.name).toBe('Forêt');
  });

  it("ne confond pas un terrain à texte avec un terrain de base", () => {
    // « Land — Plains Island » est un dual originel : il a du texte, il compte.
    const thumb = chooseDeckThumbnail([
      carte({ name: 'Plaine', ...PLAINE }),
      carte({ name: 'Tundra', typeLine: 'Land — Plains Island', cmc: 0, rarity: 'rare' }),
    ]);
    expect(thumb?.name).toBe('Tundra');
  });
});

describe('déterminisme', () => {
  it("ne dépend pas de l'ordre dans lequel les cartes arrivent", () => {
    const cartes = [
      carte({ name: 'A', cmc: 5, rarity: 'rare', sortIndex: 3 }),
      carte({ name: 'B', cmc: 5, rarity: 'rare', sortIndex: 1 }),
      carte({ name: 'C', cmc: 5, rarity: 'rare', sortIndex: 2 }),
    ];
    const attendu = chooseDeckThumbnail(cartes)?.name;
    expect(attendu).toBe('B');
    expect(chooseDeckThumbnail([...cartes].reverse())?.name).toBe('B');
  });

  it('tranche même deux cartes parfaitement égales', () => {
    // Même coût, même rareté, même `sortIndex` : sans le départage par
    // identifiant, la miniature changerait au gré du plan de requête.
    const a = carte({ name: 'Jumelle', scryfallId: 'aaa', sortIndex: 7, cmc: 4 });
    const b = carte({ name: 'Jumeau', scryfallId: 'bbb', sortIndex: 7, cmc: 4 });
    expect(chooseDeckThumbnail([a, b])?.scryfallId).toBe('aaa');
    expect(chooseDeckThumbnail([b, a])?.scryfallId).toBe('aaa');
  });
});

describe('le cas vide', () => {
  it("rend `null` plutôt qu'une carte inventée", () => {
    expect(chooseDeckThumbnail([])).toBeNull();
  });
});

describe("l'invariant de droits", () => {
  it('ne rend jamais autre chose que ce que le protocole porte déjà', () => {
    // Pas d'URL, pas de binaire, pas de vignette : un identifiant et un nom,
    // que le client transformera en URL Scryfall chargée par le navigateur.
    const thumb = chooseDeckThumbnail([carte({ name: 'Ours' })]);
    expect(thumb && Object.keys(thumb).sort()).toEqual(['name', 'scryfallId']);
  });
});

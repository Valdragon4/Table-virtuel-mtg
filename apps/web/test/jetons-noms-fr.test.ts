/**
 * Le glossaire des noms de jetons.
 *
 * Ce qu'il faut verrouiller ici n'est pas « la traduction est jolie » — c'est
 * que le nom **anglais reste la clé** et que rien ne se traduit à moitié.
 * Scryfall ne publie aucun jeton hors anglais : la traduction est la nôtre, elle
 * n'a donc aucun filet côté serveur, et c'est ce fichier qui en tient lieu.
 */
import { describe, expect, it } from 'vitest';
import { cardLanguageMark, resolveCardImage } from '../src/lib/i18n/cardImage.js';
import {
  TOKEN_NAMES_FR,
  isTokenTypeLine,
  tokenName,
  tokenQueryAliases,
} from '../src/lib/i18n/tokenNames.js';
import { foldForSearch } from '../src/components/Dialog.js';

const ID = '11111111-2222-3333-4444-555555555555';

describe('le glossaire des jetons', () => {
  it('rend le terme français officiel, pas une traduction de dictionnaire', () => {
    expect(tokenName('Soldier', 'fr')).toBe('Soldat');
    expect(tokenName('Spirit', 'fr')).toBe('Esprit');
    expect(tokenName('Treasure', 'fr')).toBe('Trésor');
    expect(tokenName('Clue', 'fr')).toBe('Indice');
    expect(tokenName('Food', 'fr')).toBe('Nourriture');
    expect(tokenName('Blood', 'fr')).toBe('Sang');
    expect(tokenName('Saproling', 'fr')).toBe('Saprobionte');
    expect(tokenName('Wurm', 'fr')).toBe('Guivre');
  });

  it("ne touche à rien en anglais : le catalogue *est* anglais", () => {
    expect(tokenName('Soldier', 'en')).toBe('Soldier');
    expect(tokenName('Elf Warrior', 'en')).toBe('Elf Warrior');
  });

  it('compose les types empilés comme la ligne de type française les joint', () => {
    expect(tokenName('Elf Warrior', 'fr')).toBe('Elfe et Guerrier');
    expect(tokenName('Human Soldier', 'fr')).toBe('Humain et Soldat');
    expect(tokenName('Zombie Army', 'fr')).toBe('Zombie et Armée');
  });

  it("ne traduit jamais à moitié : un terme inconnu laisse le nom entier en anglais", () => {
    // « Spawn » n'est pas au glossaire, et « Eldrazi Spawn » ne doit donc pas
    // devenir « Eldrazi et Spawn » : à moitié traduit, il n'est ni lisible ni
    // reconnaissable.
    expect(tokenName('Eldrazi Spawn', 'fr')).toBe('Eldrazi Spawn');
    expect(tokenName('Eldrazi Scion', 'fr')).toBe('Eldrazi Scion');
  });

  it('laisse les noms propres et les faces doubles tranquilles', () => {
    expect(tokenName('Marit Lage', 'fr')).toBe('Marit Lage');
    expect(tokenName('Ragavan', 'fr')).toBe('Ragavan');
    // Les deux moitiés d'un « // » sont des faces, pas des types empilés.
    expect(tokenName('Punchcard // Punchcard', 'fr')).toBe('Punchcard // Punchcard');
  });

  it('ne confond pas deux types anglais distincts', () => {
    // « Serpent » et « Snake » sont deux types différents, et le français aussi.
    expect(tokenName('Snake', 'fr')).toBe('Serpent');
    expect(tokenName('Serpent', 'fr')).toBe('Serpent de mer');
  });

  it("n'écrit que des noms : aucune entrée ne ressemble à un texte de règles", () => {
    // L'invariant de droits (`docs/i18n.md` §5) tient ici à une propriété
    // vérifiable : un nom est court et sans ponctuation de phrase.
    for (const fr of Object.values(TOKEN_NAMES_FR)) {
      expect(fr.length).toBeLessThan(40);
      expect(fr).not.toMatch(/[.;:]/);
    }
  });

  it('rend une chaîne vide ou absente telle quelle plutôt que de lever', () => {
    expect(tokenName(null, 'fr')).toBeNull();
    expect(tokenName(undefined, 'fr')).toBeNull();
    expect(tokenName('', 'fr')).toBe('');
  });
});

describe('la recherche répond aux deux noms', () => {
  it("propose l'équivalent anglais quand on tape le français", () => {
    expect(tokenQueryAliases('Soldat', foldForSearch)).toContain('Soldier');
    // Sans accent non plus : c'est le repli de comparaison du projet.
    expect(tokenQueryAliases('tresor', foldForSearch)).toContain('Treasure');
    expect(tokenQueryAliases('Bête', foldForSearch)).toContain('Beast');
  });

  it("n'ajoute rien quand la saisie est déjà anglaise : la requête brute suffit", () => {
    expect(tokenQueryAliases('Soldier', foldForSearch)).toEqual([]);
    expect(tokenQueryAliases('Treasure', foldForSearch)).toEqual([]);
  });

  it('borne le nombre de requêtes supplémentaires', () => {
    // « e » + une lettre touche une dizaine de termes ; on n'ouvre pas dix
    // requêtes HTTP pour deux caractères tapés.
    expect(tokenQueryAliases('el', foldForSearch).length).toBeLessThanOrEqual(3);
  });

  it('ignore une saisie trop courte, comme le champ lui-même', () => {
    expect(tokenQueryAliases('s', foldForSearch)).toEqual([]);
  });
});

describe('le repère de langue sur un jeton', () => {
  const jeton = {
    scryfallId: ID,
    typeLine: 'Token Creature — Soldier',
    imageUris: { large: 'https://cards.scryfall.io/large/a.jpg' },
  };

  it('reconnaît un jeton à sa ligne de type anglaise', () => {
    expect(isTokenTypeLine('Token Creature — Soldier')).toBe(true);
    expect(isTokenTypeLine('Token Artifact — Treasure')).toBe(true);
    expect(isTokenTypeLine('Creature — Soldier')).toBe(false);
    expect(isTokenTypeLine(null)).toBe(false);
  });

  /*
   * Une résolution **finale** : le serveur a cherché, Scryfall a rendu 404. Sans
   * elle on testerait `pending`, qui bloque déjà le repère pour une autre raison
   * (« pas encore cherché » n'est pas « pas de traduction »), et l'on ne saurait
   * rien de la règle des jetons.
   */
  const resolutionFinale = {
    scryfallId: ID,
    language: 'en',
    fallback: true,
    pending: false,
    localizedScryfallId: null,
  };

  it("ne s'affiche jamais : aucune édition traduite n'existe à aller chercher", () => {
    const resolu = resolveCardImage({
      card: jeton,
      localized: resolutionFinale,
      language: 'fr',
    });
    // Le repli est bien réel, et la résolution continue de le dire…
    expect(resolu.fallback).toBe(true);
    expect(resolu.token).toBe(true);
    // …mais on ne le signale pas : le repère « non traduite » inviterait à
    // changer d'édition, et il n'en existe aucune.
    expect(
      cardLanguageMark({ identityKnown: true, resolved: resolu, language: 'fr' }),
    ).toBeNull();
  });

  it("laisse le repère aux cartes ordinaires", () => {
    const carte = { ...jeton, typeLine: 'Creature — Soldier' };
    const resolu = resolveCardImage({
      card: carte,
      localized: resolutionFinale,
      language: 'fr',
    });
    expect(resolu.token).toBe(false);
    expect(
      cardLanguageMark({ identityKnown: true, resolved: resolu, language: 'fr' }),
    ).not.toBeNull();
  });
});

/**
 * Le glossaire des mots-clés : ce qu'il traduit, ce qu'il refuse, et ce qu'il
 * ne doit jamais devenir.
 *
 * Trois garde-fous, dans cet ordre d'importance :
 *
 *  1. le **nom anglais reste la clé** — « Flying » doit répondre autant que
 *     « Vol », partout, sans quoi une liste de deck ou une carte physique
 *     deviendrait introuvable ;
 *  2. rien n'est **inventé** — un terme dont on n'est pas sûr est consigné en
 *     anglais plutôt que deviné, et les deux tables ne se recouvrent pas ;
 *  3. rien ne **décide** — ce fichier ne porte que des noms, jamais un texte de
 *     règles, et il ne descend pas au moteur.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canonKeyword,
  foldKeyword,
  isKnownKeyword,
  keywordLabel,
  keywordName,
  keywordSearchTerms,
  COMMON_KEYWORDS,
  KEYWORD_NAMES_FR,
  MOTS_CLES_EN_ANGLAIS,
} from '../src/lib/i18n/keywordNames.js';
import { foldForSearch } from '../src/components/Dialog.js';

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
}

describe('la traduction des mots-clés', () => {
  it('rend les termes français officiels sur les mécaniques les plus lues', () => {
    expect(keywordName('Flying', 'fr')).toBe('Vol');
    expect(keywordName('Trample', 'fr')).toBe('Piétinement');
    expect(keywordName('Deathtouch', 'fr')).toBe('Contact mortel');
    expect(keywordName('First strike', 'fr')).toBe('Initiative');
    expect(keywordName('Double strike', 'fr')).toBe('Double initiative');
    expect(keywordName('Haste', 'fr')).toBe('Célérité');
  });

  it('laisse l’anglais intact quand la langue est l’anglais', () => {
    expect(keywordName('Flying', 'en')).toBe('Flying');
    expect(keywordName('Cumulative upkeep', 'en')).toBe('Cumulative upkeep');
  });

  it('rend l’anglais tel quel pour un mot-clé absent du glossaire', () => {
    // Un mot-clé d'une extension plus récente que ce fichier : il s'affiche, il
    // ne disparaît pas.
    expect(keywordName('Ward', 'fr')).toBe('Ward');
    expect(keywordName('Squelchproof', 'fr')).toBe('Squelchproof');
  });

  it('ne traduit ni null ni la chaîne vide en quelque chose', () => {
    expect(keywordName(null, 'fr')).toBeNull();
    expect(keywordName(undefined, 'fr')).toBeNull();
    expect(keywordName('', 'fr')).toBe('');
  });
});

describe('ce qu’on a refusé de traduire', () => {
  it('ne consigne jamais en anglais un terme que le glossaire traduit', () => {
    for (const mot of Object.keys(MOTS_CLES_EN_ANGLAIS)) {
      expect(KEYWORD_NAMES_FR[mot]).toBeUndefined();
    }
  });

  it('donne une raison à chaque refus, jamais une case vide', () => {
    for (const [mot, raison] of Object.entries(MOTS_CLES_EN_ANGLAIS)) {
      expect(raison.length, mot).toBeGreaterThan(10);
    }
  });

  it('ne traduit pas deux mots-clés différents par le même français', () => {
    // Deux mécaniques distinctes qui tomberaient sur le même mot rendraient la
    // recherche ambiguë et la pastille mensongère.
    const vus = new Map<string, string>();
    for (const [en, fr] of Object.entries(KEYWORD_NAMES_FR)) {
      expect(vus.get(fr), `${en} et ${vus.get(fr)} partagent « ${fr} »`).toBeUndefined();
      vus.set(fr, en);
    }
  });
});

describe('le nom anglais reste la clé', () => {
  it('canonise le français et l’anglais sur la même forme', () => {
    expect(canonKeyword('Vol')).toBe('flying');
    expect(canonKeyword('vol')).toBe('flying');
    expect(canonKeyword('Flying')).toBe('flying');
    expect(canonKeyword('Piétinement')).toBe('trample');
    expect(canonKeyword('pietinement')).toBe('trample');
    expect(canonKeyword('First strike')).toBe('first-strike');
    expect(canonKeyword('Initiative')).toBe('first-strike');
  });

  it('replie un mot inconnu sur lui-même plutôt que de le perdre', () => {
    expect(canonKeyword('Ward')).toBe('ward');
    expect(canonKeyword('Split second')).toBe('split-second');
  });

  it('rend toujours le terme anglais aux filtres, français compris', () => {
    const termes = keywordSearchTerms(['Flying', 'Trample'], 'fr');
    expect(termes).toContain('Flying');
    expect(termes).toContain('Vol');
    expect(termes).toContain('Trample');
    expect(termes).toContain('Piétinement');
  });

  it('ne double pas le terme quand il n’y a rien à traduire', () => {
    expect(keywordSearchTerms(['Ward'], 'fr')).toEqual(['Ward']);
    expect(keywordSearchTerms(['Flying'], 'en')).toEqual(['Flying']);
  });

  it('ne rend rien pour une carte sans mécanique, ou dont on ne sait rien', () => {
    // Le tableau vide (« aucune mécanique ») et `null` (« jamais ré-ingérée »)
    // se traitent pareil ici : il n'y a rien à chercher.
    expect(keywordSearchTerms([], 'fr')).toEqual([]);
    expect(keywordSearchTerms(null, 'fr')).toEqual([]);
    expect(keywordSearchTerms(undefined, 'fr')).toEqual([]);
  });

  it('se laisse trouver par la normalisation d’accents unique du projet', () => {
    // Taper « pietinement » sans accent doit trouver « Piétinement » : c'est
    // `foldForSearch` qui s'en charge, et il n'en existe qu'une.
    const terme = keywordSearchTerms(['Trample'], 'fr').find((x) => x !== 'Trample');
    expect(foldForSearch(terme ?? '')).toBe('pietinement');
    expect(foldForSearch('Célérité')).toBe('celerite');
  });
});

describe('les libellés et la liste courante', () => {
  it('écrit un canon connu dans la langue demandée', () => {
    expect(keywordLabel('flying', 'fr')).toBe('Vol');
    expect(keywordLabel('flying', 'en')).toBe('Flying');
    expect(keywordLabel('first-strike', 'fr')).toBe('Initiative');
  });

  it('rend un canon inconnu lisible plutôt que brut', () => {
    expect(keywordLabel('split-second', 'fr')).toBe('Split second');
  });

  it('ne propose d’emblée que des mots-clés que le glossaire connaît', () => {
    for (const canon of COMMON_KEYWORDS) {
      expect(isKnownKeyword(canon), canon).toBe(true);
      expect(keywordLabel(canon, 'fr'), canon).not.toBe('');
    }
    expect(new Set(COMMON_KEYWORDS).size).toBe(COMMON_KEYWORDS.length);
  });

  it('tient dans le budget de 32 caractères d’un `kind` de marqueur', () => {
    /*
     * `∑` + le gabarit le plus long + l'espace + `@tous` laissent 20 caractères
     * à la source, préfixe `kw:` compris — soit 17 au mot-clé replié. Le plus
     * long du glossaire doit y tenir, sans quoi il serait inatteignable au
     * décompte.
     */
    for (const en of Object.keys(KEYWORD_NAMES_FR)) {
      expect(`kw:${foldKeyword(en)}`.length, en).toBeLessThanOrEqual(20);
    }
  });
});

describe('ce que ce glossaire ne doit jamais devenir', () => {
  it('ne porte que des noms : aucun texte de règles', () => {
    const code = source('lib/i18n/keywordNames.ts');
    for (const fr of Object.values(KEYWORD_NAMES_FR)) {
      // Un texte de règles fait une phrase ; un nom de mécanique fait au plus
      // trois mots (« Traversée des montagnes »).
      expect(fr.split(/\s+/).length, fr).toBeLessThanOrEqual(3);
      expect(fr, fr).not.toContain('.');
    }
    // Et rien de tout cela ne part au serveur : le fichier n'importe que le
    // type de langue partagé.
    expect(code).not.toContain("from '../api.js'");
    expect(code).not.toContain('fetch(');
  });
});

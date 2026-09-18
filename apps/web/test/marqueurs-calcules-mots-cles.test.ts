/**
 * Compter les mots-clés dans les marqueurs calculés.
 *
 * C'est la mécanique des sous-types avec une autre source : au lieu de lire la
 * ligne de type, on lit `CardMeta.keywords`. Ce qui se vérifie ici est donc
 * surtout ce qui **encadre** ce décompte — le `kind` qui le porte tient dans le
 * protocole, la source se relit sans ambiguïté, le dialogue y mène, et un
 * décompte qu'on ne sait pas établir s'annonce approché au lieu de compter zéro.
 *
 * Le décompte lui-même exige le cache de catalogue, que ces tests n'ont pas :
 * ce qui en est vérifiable sans fiche est justement l'aveu d'ignorance.
 */
import { describe, expect, it } from 'vitest';
import type { CardView } from '@mtg/shared';
import {
  computedCounter,
  describeComputed,
  isKnownSubtype,
  measureCount,
  resolveSource,
  subtypeOptions,
  canonSubtype,
  KEYWORD_SOURCES,
} from '../src/components/CardSprite.js';
import { TOKEN_NAMES_FR } from '../src/lib/i18n/index.js';

const SEAT = 'S1' as never;

function permanent(id: string): CardView {
  return {
    id: id as never,
    x: 0,
    y: 0,
    zone: { seat: SEAT, kind: 'BATTLEFIELD' },
    faceDown: false,
    controller: SEAT,
    counters: [],
    tapped: false,
  } as CardView;
}

describe('la source « mot-clé » se relit sans ambiguïté', () => {
  it('se distingue d’un sous-type, qui porte le même séparateur', () => {
    const mot = resolveSource('kw:flying');
    expect(mot?.keyword).toBe('flying');
    expect(mot?.subtype).toBeNull();
    expect(mot?.source.zone).toBe('BATTLEFIELD');

    const sous = resolveSource('bat:angel');
    expect(sous?.subtype).toBe('angel');
    expect(sous?.keyword).toBeNull();
  });

  it('laisse intactes les sources sans préfixe', () => {
    const simple = resolveSource('cim.creature');
    expect(simple?.keyword).toBeNull();
    expect(simple?.subtype).toBeNull();
    expect(simple?.source.family).toBe('creature');
  });

  it('refuse un préfixe sans terme, plutôt que de compter tout', () => {
    expect(resolveSource('kw:')).toBeNull();
    expect(resolveSource('bat:')).toBeNull();
  });

  it('n’ouvre le décompte qu’au champ de bataille', () => {
    // Les zones cachées restent refusées pour la raison habituelle, et le
    // cimetière n'est pas ouvert parce qu'aucun effet du jeu ne le demande.
    expect(KEYWORD_SOURCES.every((s) => s.zone === 'BATTLEFIELD')).toBe(true);
  });
});

describe('le `kind` qui porte le décompte reste dans le protocole', () => {
  it('s’analyse comme n’importe quel marqueur calculé', () => {
    const spec = computedCounter('∑+*/+* kw:flying@vous');
    expect(spec).not.toBeNull();
    expect(spec?.source).toBe('kw:flying');
    expect(spec?.scope).toBe('vous');
    expect(spec?.left).toEqual({ coef: 1, offset: 0, signed: true });
  });

  it('tient dans les 32 caractères, mot-clé composé compris', () => {
    const kind = '∑*/*+1 kw:cumulative-upkeep@tous';
    expect(kind.length).toBeLessThanOrEqual(32);
    expect(computedCounter(kind)?.source).toBe('kw:cumulative-upkeep');
  });

  it('se décrit en français dans l’infobulle', () => {
    const spec = computedCounter('∑*/* kw:flying@vous');
    const desc = describeComputed(spec!);
    expect(desc).toContain('Vol');
    expect(desc).toContain('champ de bataille');
  });
});

describe('le dialogue des effets classiques y mène', () => {
  it('propose des mots-clés courants sans rien taper', () => {
    const vides = subtypeOptions('');
    const vol = vides.find((o) => o.value === 'kw:flying');
    expect(vol).toBeDefined();
    expect(vol?.group).toBe('Mots-clés courants');
    expect(vol?.label).toContain('Vol');
  });

  it('répond au français comme à l’anglais', () => {
    expect(subtypeOptions('vol').some((o) => o.value === 'kw:flying')).toBe(true);
    expect(subtypeOptions('Flying').some((o) => o.value === 'kw:flying')).toBe(true);
    expect(subtypeOptions('pietinement').some((o) => o.value === 'kw:trample')).toBe(true);
  });

  it('ouvre la porte du dialogue à un mot-clé, qui n’est aucun sous-type', () => {
    // `CardMenu` n'appelle `subtypeOptions(query)` que si ce test-ci répond oui.
    expect(isKnownSubtype('vol')).toBe(true);
    expect(isKnownSubtype('flying')).toBe(true);
    // Et il continue de répondre oui aux sous-types, évidemment.
    expect(isKnownSubtype('ange')).toBe(true);
  });

  it('propose les deux familles quand le mot est les deux, sous-type d’abord', () => {
    /*
     * « Équipement » est à la fois le sous-type d'artefact *Equipment* et la
     * capacité *Equip* : on ne tranche pas à la place du joueur, mais le
     * sous-type est aussi sûr et bien plus fréquent, donc il garde sa place.
     *
     * L'exemple d'origine était « ombre », *Shade* contre *Shadow*. Il ne vaut
     * plus : le français imprime *Shadow* « Distorsion », et la collision
     * n'existait que dans une traduction inventée. Le comportement, lui, est
     * intact — ce sont les lexiques qui ont bougé, pas la règle.
     */
    const options = subtypeOptions('equipement');
    expect(options.some((o) => o.value.startsWith('bat:'))).toBe(true);
    expect(options.some((o) => o.value === 'kw:equip')).toBe(true);
    expect(options[0]?.value.startsWith('bat:')).toBe(true);
  });

  it('met un mot-clé certain devant un sous-type supposé', () => {
    /*
     * « vol » n'est le sous-type de rien : toute saisie produit pourtant une
     * entrée de sous-type, et l'on se retrouvait avec trois « Vols au
     * cimetière » avant le seul choix qui voulait dire quelque chose.
     */
    expect(subtypeOptions('vol')[0]?.value).toBe('kw:flying');
    expect(subtypeOptions('flying')[0]?.value).toBe('kw:flying');
  });

  it('ne propose rien de mot-clé pour un sous-type qui n’en est pas un', () => {
    expect(subtypeOptions('gobelin').some((o) => o.value.startsWith('kw:'))).toBe(false);
  });
});

describe('ce qu’on ne sait pas, on l’annonce', () => {
  it('rend le décompte approché plutôt que zéro quand la fiche manque', () => {
    /*
     * Sans cache de catalogue, `keywords` est inconnu pour chaque permanent :
     * le décompte est un **plancher**, et la pastille le signale par un `~`.
     * Compter zéro ferait passer une ignorance pour une réponse.
     */
    const a = permanent('01JABCDEF01234567890ABCDE1');
    const b = permanent('01JABCDEF01234567890ABCDE2');
    const state = {
      cards: new Map([
        [a.id, a],
        [b.id, b],
      ]),
      seats: [{ id: SEAT, life: 40 }],
      zoneCounts: new Map(),
    } as never;

    const spec = computedCounter('∑*/* kw:flying@vous');
    expect(measureCount(state, spec!, a)).toEqual({ n: 0, approx: true });
  });
});

describe('le français des sous-types vient du glossaire, et de lui seul', () => {
  /*
   * Le dialogue et les noms de jetons parlaient deux français différents : le
   * jeton s'appelait « Gredin » et le compteur proposait « Roublards ». Le
   * glossaire de `tokenNames.ts` porte les termes **imprimés** sur les cartes
   * françaises ; c'est lui qui a le dernier mot à l'écran. Ce qui reste dans
   * `CardSprite` n'est plus qu'un lexique de **saisie**, et il n'a le droit que
   * de s'élargir.
   */

  it('trouve un type par son terme officiel comme par le synonyme d’usage', () => {
    // *Rogue* s'imprime « gredin » ; « roublard » est ce que dix ans de table
    // ont mis dans les doigts. Les deux mènent au même canon **anglais**.
    expect(canonSubtype('gredin')).toBe('rogue');
    expect(canonSubtype('roublard')).toBe('rogue');
    expect(canonSubtype('shamane')).toBe('shaman');
    expect(canonSubtype('chaman')).toBe('shaman');
    expect(canonSubtype('gorgonoide')).toBe('gorgon');
    expect(canonSubtype('gorgone')).toBe('gorgon');
    // Et un type qu'aucun synonyme écrit à la main ne portait : la dérivée du
    // glossaire l'a rendu atteignable en français.
    expect(canonSubtype('mecanoptère')).toBe('thopter');
    expect(isKnownSubtype('mécanoptère')).toBe(true);
  });

  it('affiche le terme officiel, quel que soit le mot tapé', () => {
    for (const saisie of ['gredin', 'roublard', 'Rogue']) {
      const options = subtypeOptions(saisie);
      expect(options[0]?.value).toBe('bat:rogue');
      expect(options[0]?.label).toBe('Gredins sur le champ de bataille');
    }
    expect(subtypeOptions('chaman')[0]?.label).toBe('Shamanes sur le champ de bataille');
  });

  it('écrit correctement les termes en plusieurs mots', () => {
    /*
     * « Peuple fées » et « Grand serpents » sont fautifs : le pluriel d'un terme
     * composé accorde ses deux mots, et l'on ne va pas écrire une grammaire pour
     * une douzaine d'entrées. Le terme reste donc au singulier, ce qui se lit
     * comme un intitulé et ne ment sur rien.
     */
    expect(subtypeOptions('fee')[0]?.label).toBe('Peuple fée sur le champ de bataille');
    expect(subtypeOptions('peuple fée')[0]?.value).toBe('bat:faerie');
    expect(subtypeOptions('tortue')[0]?.label).toBe('Tortue terrestre sur le champ de bataille');

    // *Serpent* et *Snake* sont deux types distincts, et le français aussi : le
    // relevé ne doit pas les confondre.
    expect(subtypeOptions('grand serpent')[0]?.value).toBe('bat:serpent');
    expect(subtypeOptions('grand serpent')[0]?.label).toBe('Grand serpent sur le champ de bataille');
    expect(subtypeOptions('serpent')[0]?.value).toBe('bat:snake');
    expect(subtypeOptions('serpent')[0]?.label).toBe('Serpents sur le champ de bataille');
  });

  it('laisse invariables les termes qui le sont déjà', () => {
    // « Fonguss » et « Phénixs » n'existent pas.
    expect(subtypeOptions('fongus')[0]?.label).toBe('Fongus sur le champ de bataille');
    expect(subtypeOptions('phenix')[0]?.label).toBe('Phénix sur le champ de bataille');
  });

  it('nomme en français jusque dans l’infobulle du marqueur', () => {
    // L'infobulle coule le libellé dans une phrase, qui en abaisse l'initiale :
    // « ... au nombre de gredins sur le champ de bataille ».
    const spec = computedCounter('∑*/* bat:rogue@vous');
    expect(describeComputed(spec!).toLowerCase()).toContain('gredins sur le champ de bataille');
  });

  it('propose les deux familles pour « fortification » aussi, sous-type d’abord', () => {
    // Le sous-type de terrain *Fortification* et le mot-clé *Fortify* portent le
    // même mot français ; c'est au joueur de trancher, pas à nous.
    const options = subtypeOptions('fortification');
    expect(options[0]?.value).toBe('bat:fortification');
    expect(options.some((o) => o.value.startsWith('kw:'))).toBe(true);
  });

  it('ne coûte pas un caractère de `kind` : le canon stocké reste anglais', () => {
    /*
     * Le piège serait de croire que franciser l'affichage francise le `kind`.
     * Il n'en est rien — `canonSubtype` rend l'anglais —, et on le vérifie sur
     * **tout** le glossaire plutôt que de le supposer : si un seul terme faisait
     * sauter `MAX_SOURCE_LENGTH`, le filtre de `subtypeOptions` supprimerait
     * silencieusement ses trois entrées.
     */
    for (const [en, fr] of Object.entries(TOKEN_NAMES_FR)) {
      if (en.includes(' ')) continue;
      const options = subtypeOptions(fr);
      expect(options.filter((o) => o.value.startsWith('bat:') || o.value.startsWith('cim:') || o.value.startsWith('exil:')).length, fr).toBe(3);
      for (const option of options) expect(`∑*/*+1 ${option.value}@tous`.length, option.value).toBeLessThanOrEqual(32);
    }
  });
});

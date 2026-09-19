/**
 * « Découvrir sans N », côté saisie : ce que le dialogue envoie au serveur.
 *
 * Le dialogue lui-même ne se teste pas ici — c'est de l'interface, et la
 * recette (`scripts/verify-ui.mjs`) le joue de bout en bout. Ce qui se teste
 * ici est la **frontière** : le mot que le joueur désigne devient un critère de
 * protocole, en anglais, et rien d'autre ne passe.
 */
import { describe, expect, it } from 'vitest';
import { CARD_TYPES } from '@mtg/shared';
import { criterionOfValue } from '../src/components/CardMenu.js';
import { canonSubtype, subtypeLabel } from '../src/components/CardSprite.js';
import { en, fr } from '../src/lib/i18n/index.js';

describe('la valeur du champ devient un critère de protocole', () => {
  it('relit les trois familles', () => {
    expect(criterionOfValue('permanent')).toEqual({ kind: 'PERMANENT' });
    expect(criterionOfValue('type:creature')).toEqual({ kind: 'TYPE', value: 'creature' });
    expect(criterionOfValue('sub:dragon')).toEqual({ kind: 'SUBTYPE', value: 'dragon' });
  });

  it('refuse ce qui ne désigne rien, plutôt que d’inventer un critère', () => {
    // Un dialogue annulé, un champ vide, un préfixe sans mot : le geste ne part
    // pas. Rien n'est présélectionné, donc rien ne peut partir par défaut.
    for (const raw of ['', 'type:', 'sub:', 'creature', 'machin:truc']) {
      expect(criterionOfValue(raw)).toBeNull();
    }
  });
});

describe('le canon envoyé est anglais, l’affichage est français', () => {
  it('traduit la saisie du joueur avant de l’envoyer', () => {
    // C'est la règle du projet : le catalogue et la ligne de type sont en
    // anglais, le français est un vernis. Le serveur compare donc `angel`.
    expect(criterionOfValue(`sub:${canonSubtype('ange')}`)).toEqual({
      kind: 'SUBTYPE',
      value: 'angel',
    });
    expect(criterionOfValue(`sub:${canonSubtype('chaman')}`)).toEqual({
      kind: 'SUBTYPE',
      value: 'shaman',
    });
    // ...et l'étiquette qu'on lui montre, elle, reste le terme officiel.
    expect(subtypeLabel('shaman')).toBe('Shamane');
  });
});

describe('chaque type offert a son libellé dans les deux catalogues', () => {
  it('ne laisse aucun type de `CARD_TYPES` sans mot', () => {
    /*
     * Le dialogue dérive sa liste de `CARD_TYPES` : un type ajouté là-bas
     * apparaît ici tout seul, et sans ce test il apparaîtrait sous son mot
     * anglais sans que personne le remarque avant un joueur.
     */
    for (const spec of CARD_TYPES) {
      const key = `discover.type.${spec.key}` as keyof typeof fr;
      expect(fr[key], `français manquant pour ${spec.key}`).toBeTruthy();
      expect(en[key], `anglais manquant pour ${spec.key}`).toBeTruthy();
    }
  });
});

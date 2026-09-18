/**
 * La valeur de mana **proposée** dans le dialogue de cascade.
 *
 * Ce n'est qu'une proposition : c'est le joueur qui valide, et c'est sa saisie
 * qui part au serveur. Mais elle doit dire la même chose que `manaValueOf`
 * côté serveur, sinon le dialogue suggère un nombre et la séquence en applique
 * un autre — le pire des deux mondes. Les cas durs sont les mêmes des deux
 * côtés : `X` hors de la pile, hybride, phyrexian, et l'aveu d'ignorance quand
 * plusieurs faces portent un coût.
 */
import { describe, expect, it } from 'vitest';
import { suggestedManaValue } from '../src/components/CardMenu.js';

const meta = (manaCost: string | null, faces: unknown = null) =>
  ({ manaCost, faces }) as Parameters<typeof suggestedManaValue>[0];

describe('valeur de mana proposée', () => {
  it('additionne les symboles du coût', () => {
    expect(suggestedManaValue(meta('{2}{W}{U}'))).toEqual({ value: 4, ambiguous: false });
    expect(suggestedManaValue(meta('{W}{U}{B}{R}{G}'))).toEqual({ value: 5, ambiguous: false });
  });

  it('compte X pour zéro et l’hybride pour son composant le plus élevé', () => {
    expect(suggestedManaValue(meta('{X}{X}{R}'))).toEqual({ value: 1, ambiguous: false });
    expect(suggestedManaValue(meta('{2/W}{W/U}{W/P}'))).toEqual({ value: 4, ambiguous: false });
  });

  it('donne zéro, et sûrement, à un sort sans coût', () => {
    // Un suspendu comme *Ancestral Vision* : valeur de mana nulle, et c'est une
    // réponse, pas une ignorance. La cascade le trouve.
    expect(suggestedManaValue(meta(null))).toEqual({ value: 0, ambiguous: false });
  });

  it('avoue son doute dès que deux faces portent un coût', () => {
    const split = suggestedManaValue(
      meta(null, [
        { name: 'Feu', manaCost: '{1}{R}' },
        { name: 'Glace', manaCost: '{1}{U}' },
      ]),
    );
    // On propose le recto — le plus probable — en le signalant comme incertain,
    // exactement comme le serveur, qui s'arrête sur une telle carte plutôt que
    // de la juger.
    expect(split).toEqual({ value: 2, ambiguous: true });
  });

  it('se contente du coût d’une face unique quand le premier niveau est muet', () => {
    const dfc = suggestedManaValue(
      meta(null, [
        { name: 'Recto', manaCost: '{2}{R}' },
        { name: 'Verso', manaCost: '' },
      ]),
    );
    expect(dfc).toEqual({ value: 3, ambiguous: false });
  });

  it('ne propose rien quand la carte elle-même est inconnue', () => {
    expect(suggestedManaValue(undefined)).toBeNull();
  });
});

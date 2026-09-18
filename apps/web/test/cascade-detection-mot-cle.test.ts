/**
 * Détection du mot-clé : trois états, et le troisième est celui qui compte.
 *
 * `Card.keywords` peut contenir le mot, être un tableau **vide** — un fait, la
 * carte n'a aucun mot-clé — ou être **absent** — une ignorance : ligne de
 * catalogue jamais ré-ingérée, carte face cachée, fiche pas encore arrivée du
 * serveur. Les deux derniers se ressemblent et ne veulent pas dire la même
 * chose, et c'est pour ça que la colonne est `Json?` et non `String[]`.
 *
 * Ce que ces tests fixent : la détection ne sert qu'à **remonter** l'action
 * dans le menu principal. Elle ne ferme rien — le tiroir « actions assistées »
 * est construit sans la consulter, et c'est structurel dans `CardMenu`.
 */
import { describe, expect, it } from 'vitest';
import { assistedKeywords } from '../src/components/CardMenu.js';

describe('mots-clés assistés reconnus sur une carte', () => {
  it('reconnaît Cascade au milieu des autres mots-clés', () => {
    // Relevé tel quel en base après ré-ingestion, sur Bloodbraid Elf.
    expect(assistedKeywords({ keywords: ['Haste', 'Cascade'] })).toEqual({
      cascade: true,
      discover: false,
      known: true,
    });
  });

  it('reconnaît Discover seul', () => {
    // Geological Appraiser.
    expect(assistedKeywords({ keywords: ['Discover'] })).toEqual({
      cascade: false,
      discover: true,
      known: true,
    });
  });

  it('ne dépend pas de la typographie de Scryfall', () => {
    expect(assistedKeywords({ keywords: ['CASCADE', 'discover'] })).toEqual({
      cascade: true,
      discover: true,
      known: true,
    });
  });

  it('distingue « aucun mot-clé » de « on ne sait pas »', () => {
    // Sol Ring, Island, Fire // Ice : un tableau vide est une **réponse**.
    expect(assistedKeywords({ keywords: [] })).toEqual({
      cascade: false,
      discover: false,
      known: true,
    });
    // Ligne jamais ré-ingérée, ou carte dont la fiche n'est pas encore arrivée :
    // `known` est faux, et rien dans l'interface n'en conclut « non ».
    expect(assistedKeywords({ keywords: null })).toEqual({
      cascade: false,
      discover: false,
      known: false,
    });
    expect(assistedKeywords({})).toEqual({ cascade: false, discover: false, known: false });
    expect(assistedKeywords(undefined)).toEqual({ cascade: false, discover: false, known: false });
  });

  it('ne confond pas un mot-clé voisin avec celui qu’on cherche', () => {
    // Ancestral Vision porte « Suspend » : la cascade la trouve, mais elle ne
    // cascade pas elle-même, et rien ne doit remonter dans son menu.
    expect(assistedKeywords({ keywords: ['Suspend'] }).cascade).toBe(false);
    // « Discovery » n'est pas « Discover ».
    expect(assistedKeywords({ keywords: ['Discovery'] }).discover).toBe(false);
  });
});

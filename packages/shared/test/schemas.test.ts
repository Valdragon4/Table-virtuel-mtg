/**
 * Gardes structurelles du protocole, vues depuis le schéma seul.
 *
 * Ce que l'on vérifie ici, c'est ce que le serveur accepte de *lire* : une
 * forme refusée n'atteint jamais le moteur, et une forme acceptée à tort lui
 * arrive telle quelle. Les deux cas ci-dessous ont été des défauts réels.
 */
import { describe, expect, it } from 'vitest';
import { intentSchema } from '../src/protocol/schemas.js';

const ID_A = '01HZZZZZZZZZZZZZZZZZZZZZZ1';
const ID_B = '01HZZZZZZZZZZZZZZZZZZZZZZ2';

describe('RESOLVE_LOOK : une carte ne part que dans une destination', () => {
  it('refuse la même carte vers la réserve et vers la bibliothèque', () => {
    const result = intentSchema.safeParse({
      type: 'RESOLVE_LOOK',
      lookId: 'look-1',
      top: [ID_A],
      bottom: [],
      toSideboard: [ID_A],
    });
    expect(result.success).toBe(false);
  });

  it('refuse la même carte vers la réserve et vers la main', () => {
    const result = intentSchema.safeParse({
      type: 'RESOLVE_LOOK',
      lookId: 'look-1',
      top: [],
      bottom: [],
      toHand: [ID_A],
      toSideboard: [ID_A],
    });
    expect(result.success).toBe(false);
  });

  it('accepte deux cartes distinctes vers deux destinations', () => {
    const result = intentSchema.safeParse({
      type: 'RESOLVE_LOOK',
      lookId: 'look-1',
      top: [ID_A],
      bottom: [],
      toSideboard: [ID_B],
    });
    expect(result.success).toBe(true);
  });
});

describe('CREATE_TOKEN : un marqueur peut être un mot-clé', () => {
  it('accepte un marqueur sans valeur', () => {
    const result = intentSchema.safeParse({
      type: 'CREATE_TOKEN',
      scryfallId: '00000000-0000-4000-8000-000000000000',
      counters: [{ kind: 'vol' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepte toujours un marqueur compté', () => {
    const result = intentSchema.safeParse({
      type: 'CREATE_TOKEN',
      scryfallId: '00000000-0000-4000-8000-000000000000',
      counters: [{ kind: '+1/+1', value: 3 }],
    });
    expect(result.success).toBe(true);
  });

  it("refuse `null` : à la création, « retirer un marqueur » ne veut rien dire", () => {
    const result = intentSchema.safeParse({
      type: 'CREATE_TOKEN',
      scryfallId: '00000000-0000-4000-8000-000000000000',
      counters: [{ kind: 'vol', value: null }],
    });
    expect(result.success).toBe(false);
  });
});

describe('PROLIFERATE : le joueur designe, le serveur n a rien a deviner', () => {
  it('accepte une liste de cibles', () => {
    const result = intentSchema.safeParse({ type: 'PROLIFERATE', targetIds: [ID_A, ID_B] });
    expect(result.success).toBe(true);
  });

  it('refuse une liste vide : proliferer sur rien n est pas un geste', () => {
    const result = intentSchema.safeParse({ type: 'PROLIFERATE', targetIds: [] });
    expect(result.success).toBe(false);
  });

  it('refuse une sorte de marqueur nommee : le serveur lit ce qui est pose', () => {
    const result = intentSchema.safeParse({
      type: 'PROLIFERATE',
      targetIds: [ID_A],
      kind: '+1/+1',
    });
    expect(result.success).toBe(false);
  });
});

describe('CASCADE : un critère, et une destination qui ne se devine pas', () => {
  it('accepte la cascade par valeur de mana, inchangée', () => {
    const result = intentSchema.safeParse({ type: 'CASCADE', manaValue: 3, compare: 'BELOW' });
    expect(result.success).toBe(true);
  });

  it('accepte un critère de type avec la destination du reste', () => {
    const result = intentSchema.safeParse({
      type: 'CASCADE',
      criterion: { kind: 'TYPE', value: 'creature' },
      rest: 'GRAVEYARD',
    });
    expect(result.success).toBe(true);
  });

  it('accepte « permanent », qui n’a pas de valeur à saisir', () => {
    const result = intentSchema.safeParse({
      type: 'CASCADE',
      criterion: { kind: 'PERMANENT' },
      rest: 'LIBRARY_BOTTOM',
    });
    expect(result.success).toBe(true);
  });

  it('refuse les deux critères à la fois : on ne s’arrête pas sur deux choses', () => {
    const result = intentSchema.safeParse({
      type: 'CASCADE',
      manaValue: 3,
      compare: 'BELOW',
      criterion: { kind: 'PERMANENT' },
      rest: 'GRAVEYARD',
    });
    expect(result.success).toBe(false);
  });

  it('refuse l’absence de critère : le serveur n’en choisirait pas un', () => {
    const result = intentSchema.safeParse({ type: 'CASCADE' });
    expect(result.success).toBe(false);
  });

  /*
   * Le point du geste : un critère de type sans destination du reste est un
   * intent **incomplet**, pas un intent à compléter par un défaut. Les cartes
   * ne sont pas unanimes — cimetière, dessous, main — et poser un défaut ici
   * reviendrait à conclure à la place du joueur.
   */
  it('refuse un critère de type sans destination du reste', () => {
    const result = intentSchema.safeParse({
      type: 'CASCADE',
      criterion: { kind: 'SUBTYPE', value: 'dragon' },
    });
    expect(result.success).toBe(false);
  });

  it('refuse une destination sans critère de type : la cascade n’en a pas à choisir', () => {
    const result = intentSchema.safeParse({
      type: 'CASCADE',
      manaValue: 3,
      compare: 'BELOW',
      rest: 'HAND',
    });
    expect(result.success).toBe(false);
  });
});

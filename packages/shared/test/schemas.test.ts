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

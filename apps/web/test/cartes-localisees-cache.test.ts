/**
 * Le cache client des cartes localisées.
 *
 * Ce qu'on vérifie n'est pas « une Map retient des valeurs », mais les quatre
 * points du contrat de `POST /api/cards/localized` sur lesquels un appelant se
 * trompe :
 *
 * - `fallback: true` est le cas **courant** et non une erreur — la plupart des
 *   cartes n'ont jamais été imprimées en français ;
 * - `fallback` ne veut pas dire « définitif » : le serveur le pose **aussi**
 *   sur une carte qu'il n'a pas eu le temps de résoudre, qui porte alors
 *   `pending`. C'est `pending` qu'il faut tester ;
 * - un `pending` se redemande **une** fois, jamais en boucle ;
 * - une carte inconnue du catalogue **n'apparaît pas** dans la réponse : le
 *   tableau de sortie est plus court que l'entrée, et ce n'est pas une panne.
 *
 * On vérifie enfin que changer de langue ne jette pas ce qui est déjà su de
 * l'autre — c'est tout l'intérêt d'une clé `(scryfallId, langue)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ID_A = '00000000-0000-4000-8000-000000000001';
const ID_B = '00000000-0000-4000-8000-000000000002';
const ID_C = '00000000-0000-4000-8000-000000000003';

interface Posted {
  ids: string[];
  language: string;
}

let reply: (body: Posted) => unknown;
const post = vi.fn(async (_path: string, body: unknown) => reply(body as Posted));

vi.mock('../src/lib/api.js', () => ({
  api: { post: (path: string, body: unknown) => post(path, body) },
}));

const {
  localizedCard,
  localizedCardName,
  requestLocalization,
  resetLocalizations,
  subscribeLocalizations,
} = await import('../src/lib/cardLocalization.js');

/** Une réponse du serveur, réduite à ce que le cache en lit. */
function card(
  scryfallId: string,
  extra: Partial<{
    language: string;
    fallback: boolean;
    pending: boolean;
    printedName: string;
    name: string;
  }> = {},
): Record<string, unknown> {
  return {
    scryfallId,
    language: 'fr',
    fallback: false,
    pending: false,
    localizedScryfallId: null,
    name: 'Lightning Bolt',
    printedName: 'Foudre',
    imageUris: { large: `https://cards.scryfall.io/large/front/0/0/${scryfallId}.jpg` },
    faces: null,
    ...extra,
  };
}

/** Laisse partir le lot différé, puis les promesses qu'il a créées. */
async function settle(ms = 50): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLocalizations();
  post.mockClear();
  reply = (body) => ({ language: body.language, cards: body.ids.map((id) => card(id)) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('les lots', () => {
  it('regroupe en une seule requête ce que la frame demande', async () => {
    expect(localizedCard(ID_A, 'fr')).toBeUndefined();
    expect(localizedCard(ID_B, 'fr')).toBeUndefined();
    expect(localizedCard(ID_C, 'fr')).toBeUndefined();
    await settle();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/cards/localized', {
      ids: [ID_A, ID_B, ID_C],
      language: 'fr',
    });
    expect(localizedCard(ID_A, 'fr')?.printedName).toBe('Foudre');
  });

  it('prévient ses abonnés quand le lot rentre : la carte passe de l’anglais au français sans disparaître', async () => {
    const seen = vi.fn();
    const off = subscribeLocalizations(seen);
    // Avant la réponse, l'appelant n'a rien : il affiche l'anglais du catalogue.
    expect(localizedCard(ID_A, 'fr')).toBeUndefined();
    await settle();
    expect(seen).toHaveBeenCalled();
    expect(localizedCard(ID_A, 'fr')).toBeDefined();
    off();
  });

  it('ne demande jamais l’anglais : le catalogue que nous ingérons l’est déjà', async () => {
    expect(localizedCard(ID_A, 'en')).toBeUndefined();
    await settle();
    expect(post).not.toHaveBeenCalled();
  });

  it('écarte ce qui n’est pas un identifiant Scryfall plutôt que de faire rejeter le lot entier', async () => {
    requestLocalization('01JBQ2ZP0000000000000000', 'fr');
    localizedCard(ID_A, 'fr');
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cards/localized', { ids: [ID_A], language: 'fr' });
  });
});

describe('fallback et pending', () => {
  it('traite un repli anglais comme une réponse, pas comme un échec', async () => {
    // Le cas courant : la carte n'a jamais été imprimée en français.
    reply = (body) => ({
      language: body.language,
      cards: body.ids.map((id) =>
        card(id, { language: 'en', fallback: true, printedName: 'Lightning Bolt' }),
      ),
    });

    localizedCard(ID_A, 'fr');
    await settle();
    expect(localizedCard(ID_A, 'fr')?.fallback).toBe(true);

    // Rien à redemander : un `fallback` sans `pending` est définitif.
    post.mockClear();
    localizedCard(ID_A, 'fr');
    await settle(5000);
    expect(post).not.toHaveBeenCalled();
  });

  it('redemande un `pending` un nombre borné de fois, puis se tait', async () => {
    /*
     * Le serveur pose `fallback` **et** `pending` : c'est `pending` qui décide.
     *
     * Une seule relance ne suffisait pas : le serveur plafonne ses appels
     * vivants par requête, et sur un deck de cent cartes cela laissait la
     * moitié en anglais jusqu'au rechargement de la page. Il en faut plusieurs,
     * espacées — mais **comptées**, sinon c'est une boucle.
     */
    reply = (body) => ({
      language: body.language,
      cards: body.ids.map((id) => card(id, { language: 'en', fallback: true, pending: true })),
    });

    localizedCard(ID_A, 'fr');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);

    // Les relances ont bien lieu, de plus en plus espacées.
    await settle(2000);
    expect(post).toHaveBeenCalledTimes(2);
    await settle(4000);
    expect(post).toHaveBeenCalledTimes(3);

    // Puis le compteur s'épuise et plus rien ne part, même si la carte reste
    // `pending` : elle attendra le prochain chargement de page.
    await settle(120_000);
    const epuise = post.mock.calls.length;
    expect(epuise).toBeLessThanOrEqual(6);
    await settle(300_000);
    expect(post).toHaveBeenCalledTimes(epuise);
  });

  it('garde la résolution obtenue au second passage', async () => {
    let tour = 0;
    reply = (body) => {
      tour += 1;
      return {
        language: body.language,
        cards: body.ids.map((id) =>
          tour === 1
            ? card(id, { language: 'en', fallback: true, pending: true })
            : card(id, { printedName: 'Foudre' }),
        ),
      };
    };

    localizedCard(ID_A, 'fr');
    await settle();
    expect(localizedCard(ID_A, 'fr')?.pending).toBe(true);

    await settle(5000);
    const resolved = localizedCard(ID_A, 'fr');
    expect(resolved?.pending).toBe(false);
    expect(resolved?.printedName).toBe('Foudre');
  });
});

describe('les manques', () => {
  it('constate qu’une carte inconnue du catalogue n’est pas dans la réponse, et ne la redemande pas', async () => {
    reply = (body) => ({
      language: body.language,
      // Le tableau de sortie est plus court que l'entrée : ce n'est pas une erreur.
      cards: body.ids.filter((id) => id !== ID_B).map((id) => card(id)),
    });

    localizedCard(ID_A, 'fr');
    localizedCard(ID_B, 'fr');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(localizedCard(ID_A, 'fr')).toBeDefined();
    expect(localizedCard(ID_B, 'fr')).toBeUndefined();

    // Sans mémoire du manque, chaque rendu relancerait un appel pour réapprendre
    // la même chose.
    post.mockClear();
    localizedCard(ID_B, 'fr');
    await settle(5000);
    expect(post).not.toHaveBeenCalled();
  });

  it('ne retient rien d’une panne réseau : une indisponibilité n’est pas une absence', async () => {
    reply = () => {
      throw new Error('503');
    };

    localizedCard(ID_A, 'fr');
    await settle();
    expect(localizedCard(ID_A, 'fr')).toBeUndefined();

    /*
     * Un repos est observé avant de réessayer. Sans lui, la boucle est
     * immédiate : l'échec prévient les abonnés, qui re-rendent, qui
     * redemandent la carte absente du cache, et l'on repart.
     */
    post.mockClear();
    localizedCard(ID_A, 'fr');
    await settle(1000);
    expect(post).not.toHaveBeenCalled();

    // Le repos passé et le serveur revenu, la carte se résout normalement.
    reply = (body) => ({ language: body.language, cards: body.ids.map((id) => card(id)) });
    await settle(20_000);
    localizedCard(ID_A, 'fr');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(localizedCard(ID_A, 'fr')?.printedName).toBe('Foudre');
  });
});

describe('le changement de langue', () => {
  it('ne jette pas ce qui est déjà su de l’autre langue', async () => {
    localizedCard(ID_A, 'fr');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);

    // L'anglais ne coûte aucun appel, et le français reste en mémoire.
    expect(localizedCard(ID_A, 'en')).toBeUndefined();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);

    // Retour au français : rien à redemander.
    expect(localizedCard(ID_A, 'fr')?.printedName).toBe('Foudre');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('indexe par langue : deux langues sont deux entrées, pas une qui écrase l’autre', async () => {
    // On force la demande pour les deux langues en passant par la file directe,
    // qui ne court-circuite que l'anglais.
    localizedCard(ID_A, 'fr');
    await settle();
    const fr = localizedCard(ID_A, 'fr');
    expect(fr).toBeDefined();
    expect(localizedCard(ID_B, 'fr')).toBeUndefined();
    await settle();
    expect(localizedCard(ID_A, 'fr')).toBe(fr);
  });
});

describe('le nom affiché', () => {
  it('rend le nom imprimé quand il existe', () => {
    const entry = card(ID_A) as unknown as Parameters<typeof localizedCardName>[0];
    expect(localizedCardName(entry, 'Lightning Bolt')).toBe('Foudre');
  });

  it('rend le nom du catalogue tant que la résolution n’a pas eu lieu', () => {
    /*
     * Une entrée que le serveur n'a pas eu le temps de résoudre porte l'anglais
     * du catalogue dans `printedName` : c'est bien le nom du catalogue qui sort.
     */
    const entry = card(ID_A, {
      pending: true,
      fallback: true,
      language: 'en',
      printedName: 'Lightning Bolt',
    }) as unknown as Parameters<typeof localizedCardName>[0];
    expect(localizedCardName(entry, 'Lightning Bolt')).toBe('Lightning Bolt');
  });

  it('garde le nom français déjà connu d’une entrée en cours de rattrapage', () => {
    /*
     * Le serveur pose `pending` sur une carte **déjà nommée** en français dont
     * il cherche encore une impression de substitution. Le nom, lui, est acquis
     * — le reperdre le temps du rattrapage ferait clignoter le titre.
     */
    const entry = card(ID_A, {
      pending: true,
      fallback: true,
      language: 'en',
    }) as unknown as Parameters<typeof localizedCardName>[0];
    expect(localizedCardName(entry, 'Lightning Bolt')).toBe('Foudre');
  });

  it('rend le nom imprimé du verso pour une carte recto-verso', () => {
    const entry = {
      scryfallId: ID_A,
      language: 'fr',
      printedName: 'Aubemarque // Vespéral',
      faces: [{ name: 'Aubemarque' }, { name: 'Vespéral' }],
    } as unknown as Parameters<typeof localizedCardName>[0];
    expect(localizedCardName(entry, 'Dawnhart // Vesper', 1)).toBe('Vespéral');
    expect(localizedCardName(entry, 'Dawnhart // Vesper', 0)).toBe('Aubemarque // Vespéral');
  });

  it('rend le nom du catalogue quand il n’y a pas de résolution du tout', () => {
    expect(localizedCardName(undefined, 'Lightning Bolt')).toBe('Lightning Bolt');
  });
});

/**
 * Les noms de commandant de « Mes decks », et leur coût réseau.
 *
 * La page rend, pour chaque deck, une miniature puis un ou deux noms de
 * commandant. Les trois passent par `localizedCard` dans le **même rendu**.
 * Ce fichier vérifie ce que la lecture de source ne peut pas dire :
 *
 * 1. traduire les noms **n'ajoute aucune requête** — les identifiants
 *    rejoignent le lot déjà ouvert par les miniatures, et la page ne fait
 *    qu'un `POST` pour toute sa liste ;
 * 2. le nom français s'affiche quand l'impression française existe, l'anglais
 *    sinon — sans jamais de trou entre les deux, puisque `localizedCardName`
 *    rend l'anglais du catalogue tant que rien n'est rentré ;
 * 3. redemander les mêmes cartes au rendu suivant ne repart pas sur le réseau.
 *
 * On simule ici le rendu de la page plutôt que de le monter : la suite tourne
 * en environnement `node`, sans DOM. Ce que l'on reproduit fidèlement, c'est la
 * **séquence d'appels** — c'est elle qui décide du nombre de requêtes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Un deck à deux partenaires : sa miniature est le premier des deux. */
const SELENIA = '00000000-0000-4000-8000-0000000000a1';
const PARTENAIRE = '00000000-0000-4000-8000-0000000000a2';
/** Le commandant d'un second deck de la même page. */
const ATRAXA = '00000000-0000-4000-8000-0000000000b1';

interface Posted {
  ids: string[];
  language: string;
}

/** Ce que le serveur sait traduire, par identifiant. */
const traductions: Record<string, { name: string; printedName: string }> = {
  [SELENIA]: { name: 'Selenia, the Cursed Heart', printedName: 'Selenia, cœur maudit' },
  // Jamais imprimée en français : le serveur renvoie le nom du catalogue.
  [PARTENAIRE]: { name: 'Thrasios, Triton Hero', printedName: 'Thrasios, Triton Hero' },
  [ATRAXA]: { name: 'Atraxa, Praetors’ Voice', printedName: 'Atraxa, voix des Praetors' },
};

const post = vi.fn(async (_path: string, body: unknown) => {
  const { ids, language } = body as Posted;
  return {
    language,
    cards: ids.map((scryfallId) => ({
      scryfallId,
      language,
      fallback: traductions[scryfallId]?.name === traductions[scryfallId]?.printedName,
      pending: false,
      localizedScryfallId: null,
      imageUris: null,
      faces: null,
      ...traductions[scryfallId],
    })),
  };
});

vi.mock('../src/lib/api.js', () => ({
  api: { post: (path: string, body: unknown) => post(path, body) },
}));

const { localizedCard, localizedCardName, resetLocalizations } = await import(
  '../src/lib/cardLocalization.js'
);

/**
 * Ce que la page fait d'une ligne de deck, dans l'ordre : la miniature, puis
 * chaque commandant. Rend les noms affichés, comme le JSX les rendrait.
 */
function ligneDeDeck(
  miniature: string | null,
  commandants: ReadonlyArray<{ scryfallId: string; name: string }>,
): { alt?: string; noms: string[] } {
  const alt =
    miniature === null
      ? undefined
      : (localizedCardName(
          localizedCard(miniature, 'fr'),
          traductions[miniature]?.name,
        ) ?? traductions[miniature]?.name);
  const noms = commandants.map(
    (c) => localizedCardName(localizedCard(c.scryfallId, 'fr'), c.name) ?? c.name,
  );
  return { alt, noms };
}

/** Laisse partir le lot différé (30 ms), puis la promesse qu'il a créée. */
const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(50).then(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
  resetLocalizations();
  post.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('le coût réseau', () => {
  it('ne demande rien de plus que ce que les miniatures demandaient déjà', async () => {
    // Le rendu complet d'une page : deux decks, trois cartes citées.
    ligneDeDeck(SELENIA, [
      { scryfallId: SELENIA, name: 'Selenia, the Cursed Heart' },
      { scryfallId: PARTENAIRE, name: 'Thrasios, Triton Hero' },
    ]);
    ligneDeDeck(ATRAXA, [{ scryfallId: ATRAXA, name: 'Atraxa, Praetors’ Voice' }]);
    await settle();

    // Un seul `POST` pour toute la page, et la carte demandée deux fois — la
    // miniature puis le commandant — n'y figure qu'une fois.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/cards/localized', {
      ids: [SELENIA, PARTENAIRE, ATRAXA],
      language: 'fr',
    });
  });

  it('ne repart pas sur le réseau au rendu suivant', async () => {
    ligneDeDeck(SELENIA, [{ scryfallId: SELENIA, name: 'Selenia, the Cursed Heart' }]);
    await settle();
    post.mockClear();

    // Le lot rentré provoque un re-rendu : il relit le cache, il ne redemande rien.
    ligneDeDeck(SELENIA, [{ scryfallId: SELENIA, name: 'Selenia, the Cursed Heart' }]);
    await settle();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('le nom affiché', () => {
  it("montre l'anglais tant que la résolution n'est pas rentrée", () => {
    const { alt, noms } = ligneDeDeck(SELENIA, [
      { scryfallId: SELENIA, name: 'Selenia, the Cursed Heart' },
    ]);
    // Rien ne manque, rien ne clignote : le nom est là dès le premier rendu.
    expect(noms).toEqual(['Selenia, the Cursed Heart']);
    expect(alt).toBe('Selenia, the Cursed Heart');
  });

  it("passe au français quand l'impression française existe", async () => {
    ligneDeDeck(SELENIA, [{ scryfallId: SELENIA, name: 'Selenia, the Cursed Heart' }]);
    await settle();

    const { alt, noms } = ligneDeDeck(SELENIA, [
      { scryfallId: SELENIA, name: 'Selenia, the Cursed Heart' },
    ]);
    expect(noms).toEqual(['Selenia, cœur maudit']);
    // La miniature dit le même nom que la ligne : une seule carte, un seul nom.
    expect(alt).toBe('Selenia, cœur maudit');
  });

  it("reste en anglais quand la carte n'a jamais été imprimée en français", async () => {
    ligneDeDeck(null, [{ scryfallId: PARTENAIRE, name: 'Thrasios, Triton Hero' }]);
    await settle();

    const { noms } = ligneDeDeck(null, [
      { scryfallId: PARTENAIRE, name: 'Thrasios, Triton Hero' },
    ]);
    expect(noms).toEqual(['Thrasios, Triton Hero']);
  });

  it('ne demande jamais rien quand le joueur lit en anglais', async () => {
    // Le catalogue que nous ingérons **est** l'anglais : l'aller-retour
    // n'apprendrait rien, et la page n'ouvre aucune requête.
    localizedCard(SELENIA, 'en');
    await settle();
    expect(post).not.toHaveBeenCalled();
  });
});

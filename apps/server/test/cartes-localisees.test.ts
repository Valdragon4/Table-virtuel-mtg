/**
 * Résolution des cartes en français, et repli sur l'anglais.
 *
 * Le piège que ces tests gardent : chez Scryfall, la version française d'une
 * carte n'est pas une autre URL d'image, c'est **une autre carte** — même
 * édition, même numéro de collection, identifiant différent. Et la plupart des
 * cartes n'ont jamais été traduites : l'API répond alors 404. Ce 404 est la
 * réponse normale, pas une panne, et il doit être mémorisé — sinon chaque
 * affichage d'un Un-set rejouerait l'appel pour réapprendre la même chose.
 *
 * Aucune base ni réseau ici : le stockage et l'appel sont injectés, c'est la
 * décision qu'on met à l'épreuve.
 */
import { describe, expect, it } from 'vitest';

process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const {
  resolveLocalizedCards,
  localizedPrintingUrl,
  toLocalizationRecord,
  scheduleBackgroundLocalization,
  resetBackgroundLocalization,
  chooseSubstitute,
  needsSubstituteSearch,
  backfillSubstitutes,
  scheduleSubstituteBackfill,
  SUBSTITUTE_SEARCH_VERSION,
  MAX_LIVE_LOOKUPS_PER_REQUEST,
} = await import('../src/cards/localization.js');

/**
 * Sol Ring de Commander 2021 : une carte de base, traduite depuis toujours.
 * L'impression française porte son propre identifiant et son propre visuel.
 */
const SOL_RING = {
  scryfallId: '11111111-1111-4111-8111-111111111111',
  name: 'Sol Ring',
  setCode: 'c21',
  collectorNumber: '263',
  imageUris: { normal: 'https://cards.scryfall.io/normal/front/en-sol-ring.jpg' },
  faces: null,
};

/**
 * Fable of the Mirror-Breaker : recto-verso, et traduite. Elle vérifie qu'on
 * rapporte bien **une image par face**, comme le fait `Card.faces`.
 */
const FABLE = {
  scryfallId: '22222222-2222-4222-8222-222222222222',
  name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
  setCode: 'neo',
  collectorNumber: '141',
  imageUris: null,
  faces: [
    { name: 'Fable of the Mirror-Breaker', imageUris: { normal: 'https://cards.scryfall.io/en-a.jpg' } },
    { name: 'Reflection of Kiki-Jiki', imageUris: { normal: 'https://cards.scryfall.io/en-b.jpg' } },
  ],
};

/**
 * Space Beleren, d'Unfinity : les Un-sets n'ont jamais été publiés en français.
 * Scryfall répond 404 sur `/cards/unf/106/fr`. C'est le cas courant, pas l'exception.
 */
const SPACE_BELEREN = {
  scryfallId: '33333333-3333-4333-8333-333333333333',
  name: 'Space Beleren',
  setCode: 'unf',
  collectorNumber: '106',
  imageUris: { normal: 'https://cards.scryfall.io/normal/front/en-space-beleren.jpg' },
  faces: null,
};

/** Ce que Scryfall rend sur /cards/c21/263/fr : une autre carte, pas une variante. */
const SOL_RING_FR = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Sol Ring',
  printed_name: 'Anneau solaire',
  lang: 'fr',
  layout: 'normal',
  set: 'c21',
  set_name: 'Commander 2021',
  collector_number: '263',
  image_uris: { normal: 'https://cards.scryfall.io/normal/front/fr-anneau-solaire.jpg' },
};

const FABLE_FR = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
  lang: 'fr',
  layout: 'modal_dfc',
  set: 'neo',
  set_name: 'Kamigawa : la dynastie Néon',
  collector_number: '141',
  card_faces: [
    {
      name: 'Fable of the Mirror-Breaker',
      printed_name: 'Fable du briseur de miroir',
      image_uris: { normal: 'https://cards.scryfall.io/fr-a.jpg' },
    },
    {
      name: 'Reflection of Kiki-Jiki',
      printed_name: 'Reflet de Kiki-Jiki',
      image_uris: { normal: 'https://cards.scryfall.io/fr-b.jpg' },
    },
  ],
};

/** Stockage en mémoire, qui compte ses écritures comme la base compterait ses lignes. */
function memoire() {
  const rows = new Map<string, any>();
  return {
    rows,
    store: {
      async load(ids: string[], language: string) {
        return ids.map((id) => rows.get(`${id}|${language}`)).filter(Boolean);
      },
      async save(records: any[]) {
        for (const r of records) rows.set(`${r.scryfallId}|${r.language}`, r);
      },
    } as any,
  };
}

/** Scryfall de façade : rend les impressions connues, 404 (donc `null`) pour le reste. */
function scryfallFeint(connues: Record<string, unknown>) {
  const appels: string[] = [];
  const fetch = async (card: any, language: string) => {
    appels.push(localizedPrintingUrl(card, language));
    return (connues[`${card.setCode}/${card.collectorNumber}/${language}`] ?? null) as any;
  };
  return { appels, fetch };
}

const CONNUES = {
  'c21/263/fr': SOL_RING_FR,
  'neo/141/fr': FABLE_FR,
};

describe("adresse de l'impression localisée", () => {
  it('suit le chemin édition / numéro / langue de Scryfall', () => {
    expect(localizedPrintingUrl(SOL_RING, 'fr')).toBe('https://api.scryfall.com/cards/c21/263/fr');
  });

  it('échappe un numéro de collection exotique', () => {
    const carte = { ...SOL_RING, collectorNumber: '18★' };
    expect(localizedPrintingUrl(carte, 'fr')).toContain('/cards/c21/18%E2%98%85/fr');
  });
});

describe('carte traduite en français', () => {
  it("rend l'impression française, avec son identifiant et son visuel", async () => {
    const { store } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);

    const res = await resolveLocalizedCards({ cards: [SOL_RING], language: 'fr', store, fetch });
    const [carte] = res.cards;

    expect(appels).toEqual(['https://api.scryfall.com/cards/c21/263/fr']);
    // L'identifiant du protocole ne bouge pas : la langue n'est qu'un affichage.
    expect(carte?.scryfallId).toBe(SOL_RING.scryfallId);
    expect(carte?.language).toBe('fr');
    expect(carte?.fallback).toBe(false);
    expect(carte?.localizedScryfallId).toBe(SOL_RING_FR.id);
    expect(carte?.printedName).toBe('Anneau solaire');
    // Le nom anglais reste : c'est lui qui sert aux decks et à la recherche.
    expect(carte?.name).toBe('Sol Ring');
    expect((carte?.imageUris as any).normal).toContain('fr-anneau-solaire');
  });

  it('rapporte une image par face pour une carte recto-verso', async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint(CONNUES);

    const res = await resolveLocalizedCards({ cards: [FABLE], language: 'fr', store, fetch });
    const faces = res.cards[0]?.faces as Array<{ name: string; imageUris: { normal: string } }>;

    expect(faces).toHaveLength(2);
    expect(faces[0]?.imageUris.normal).toBe('https://cards.scryfall.io/fr-a.jpg');
    expect(faces[1]?.imageUris.normal).toBe('https://cards.scryfall.io/fr-b.jpg');
    expect(res.cards[0]?.printedName).toBe('Fable du briseur de miroir // Reflet de Kiki-Jiki');
  });

  it("ne garde aucun texte de règles de l'impression traduite", () => {
    const avecTexte = { ...SOL_RING_FR, printed_text: 'Ajoutez {C}{C}.', oracle_text: 'Add {C}{C}.' };
    const record = toLocalizationRecord(SOL_RING.scryfallId, 'fr', avecTexte as any);
    expect(JSON.stringify(record)).not.toContain('Ajoutez');
    expect(JSON.stringify(record)).not.toContain('Add {C}');
  });
});

describe('carte jamais imprimée en français', () => {
  it("retombe sur l'anglais sans erreur", async () => {
    const { store } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);

    const res = await resolveLocalizedCards({ cards: [SPACE_BELEREN], language: 'fr', store, fetch });
    const [carte] = res.cards;

    expect(appels).toEqual(['https://api.scryfall.com/cards/unf/106/fr']);
    expect(carte?.language).toBe('en');
    expect(carte?.fallback).toBe(true);
    expect(carte?.pending).toBe(false);
    expect(carte?.printedName).toBe('Space Beleren');
    expect((carte?.imageUris as any).normal).toContain('en-space-beleren');
  });

  it('mémorise le refus et ne retape plus Scryfall', async () => {
    const { store, rows } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);

    await resolveLocalizedCards({ cards: [SPACE_BELEREN], language: 'fr', store, fetch });
    expect(rows.size).toBe(1);
    expect([...rows.values()][0].missing).toBe(true);

    // Le second passage doit être muet côté réseau : c'est tout l'intérêt de
    // mémoriser un 404. Sans cela, une table pleine d'Un-sets rejouerait
    // l'appel à chaque rafraîchissement.
    const second = await resolveLocalizedCards({ cards: [SPACE_BELEREN], language: 'fr', store, fetch });
    expect(appels).toHaveLength(1);
    expect(second.lookups).toBe(0);
    expect(second.cards[0]?.fallback).toBe(true);
    expect(second.cards[0]?.language).toBe('en');
  });

  it('ne grave pas un repli sur une panne passagère de Scryfall', async () => {
    const { store, rows } = memoire();
    const enPanne = async () => {
      throw new Error('503');
    };

    const res = await resolveLocalizedCards({
      cards: [SOL_RING],
      language: 'fr',
      store,
      fetch: enPanne as any,
    });
    // Rien de mémorisé : une indisponibilité ne doit pas condamner une carte à
    // l'anglais pour toujours. Elle revient `pending`, et on retentera.
    expect(rows.size).toBe(0);
    expect(res.cards[0]?.fallback).toBe(true);
    expect(res.cards[0]?.pending).toBe(true);
  });
});

describe('économie des appels', () => {
  it("ne touche ni la base ni Scryfall quand l'anglais est demandé", async () => {
    const { store } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);
    let lectures = 0;
    const espion = {
      load: async (...args: any[]) => {
        lectures += 1;
        return (store.load as any)(...args);
      },
      save: store.save,
    } as any;

    const res = await resolveLocalizedCards({
      cards: [SOL_RING, SPACE_BELEREN],
      language: 'en',
      store: espion,
      fetch,
    });
    expect(appels).toHaveLength(0);
    expect(lectures).toBe(0);
    expect(res.lookups).toBe(0);
    expect(res.cards.every((c) => c.fallback === false && c.pending === false)).toBe(true);
    expect(res.cards[0]?.printedName).toBe('Sol Ring');
  });

  it('plafonne les appels d’une requête et rend le reste en attente', async () => {
    const { store } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);
    const beaucoup = Array.from({ length: 5 }, (_, i) => ({
      ...SPACE_BELEREN,
      scryfallId: `44444444-4444-4444-8444-00000000000${i}`,
      collectorNumber: String(100 + i),
    }));

    const res = await resolveLocalizedCards({
      cards: beaucoup,
      language: 'fr',
      store,
      fetch,
      maxLookups: 2,
    });
    expect(appels).toHaveLength(2);
    expect(res.cards.filter((c) => c.pending)).toHaveLength(3);
    // Ce qui est en attente s'affiche quand même, en anglais : la table n'attend
    // jamais après une traduction.
    expect(res.cards.every((c) => c.imageUris !== null)).toBe(true);
  });

  it('a un plafond par défaut compatible avec une main et un champ de bataille', () => {
    expect(MAX_LIVE_LOOKUPS_PER_REQUEST).toBeGreaterThanOrEqual(10);
  });
});

/**
 * La définition de l'illustration servie.
 *
 * Mesuré sur un deck réel : 34 des 55 impressions françaises trouvées sont
 * `lowres` chez Scryfall, contre 1 sur 55 côté anglais. L'URL `large` existe et
 * rend bien 672 × 936, mais agrandie depuis un scan de basse définition — c'est
 * le flou que voit le joueur. Sans ce champ, le client ne peut pas le savoir.
 */
describe("la qualité de l'illustration traduite", () => {
  it('retient `image_status` et `highres_image` de Scryfall', async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint({
      'c21/263/fr': { ...SOL_RING_FR, image_status: 'lowres', highres_image: false },
    });

    const res = await resolveLocalizedCards({ cards: [SOL_RING], language: 'fr', store, fetch });
    expect(res.cards[0]?.imageStatus).toBe('lowres');
    expect(res.cards[0]?.highresImage).toBe(false);
  });

  it("annonce le catalogue anglais comme net : c'est ce que nous ingérons", async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint(CONNUES);

    const res = await resolveLocalizedCards({ cards: [SPACE_BELEREN], language: 'fr', store, fetch });
    expect(res.cards[0]?.language).toBe('en');
    expect(res.cards[0]?.highresImage).toBe(true);
  });
});

/**
 * Le rattrapage par le nom.
 *
 * Une carte peut n'avoir jamais été imprimée en français **dans cette
 * édition-ci** et porter pourtant un nom français depuis vingt ans. Mesuré sur
 * un deck réel : 29 impressions rendent 404, et 27 d'entre elles ont une
 * impression française ailleurs. On prend le nom, **jamais l'illustration** :
 * celle-là reste celle que le joueur a choisie, sinon deux joueurs regardant la
 * même carte verraient deux images différentes.
 */
describe("le nom trouvé sur une autre impression", () => {
  const AVEC_ORACLE = { ...SPACE_BELEREN, oracleId: '99999999-9999-4999-8999-999999999999' };

  it("affiche le nom français sous l'illustration anglaise, sans la changer", async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    // Le rattrapage rend le nom **et** l'impression de substitution. Ici il n'y
    // en a pas : on vérifie que le nom seul ne change toujours pas l'image.
    const fetchElsewhere = async () => ({ printedName: 'Chemin vers l’exil', substitute: null });

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });
    const [carte] = res.cards;

    expect(carte?.printedName).toBe('Chemin vers l’exil');
    // L'image, elle, reste celle du catalogue : la langue de l'illustration ne
    // ment pas, et le sélecteur d'impression reste juste.
    expect(carte?.language).toBe('en');
    expect(carte?.fallback).toBe(true);
    expect(carte?.localizedScryfallId).toBeNull();
    expect((carte?.imageUris as any).normal).toContain('en-space-beleren');
    // Le nom anglais reste la clé de deck et de recherche.
    expect(carte?.name).toBe('Space Beleren');
  });

  it('mémorise le nom avec le 404 et ne recherche pas deux fois', async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    let recherches = 0;
    const fetchElsewhere = async () => {
      recherches += 1;
      return { printedName: 'Chemin vers l’exil', substitute: null };
    };

    await resolveLocalizedCards({ cards: [AVEC_ORACLE], language: 'fr', store, fetch, fetchElsewhere });
    expect([...rows.values()][0].missing).toBe(true);
    expect([...rows.values()][0].printedName).toBe('Chemin vers l’exil');

    const second = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });
    expect(recherches).toBe(1);
    expect(second.cards[0]?.printedName).toBe('Chemin vers l’exil');
  });

  it("ne grave rien quand la recherche de nom tombe en panne", async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    const enPanne = async () => {
      throw new Error('503');
    };

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere: enPanne,
    });
    // Une ligne `missing` sans nom serait relue pour toujours : mieux vaut
    // ne rien écrire et retenter.
    expect(rows.size).toBe(0);
    expect(res.cards[0]?.pending).toBe(true);
  });

  it('complète une ligne écrite avant ce rattrapage, puis ne la rouvre plus', async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    // Une ligne d'avant : elle sait qu'il n'y a pas d'impression traduite, elle
    // ne sait rien du nom.
    rows.set(`${AVEC_ORACLE.scryfallId}|fr`, {
      scryfallId: AVEC_ORACLE.scryfallId,
      language: 'fr',
      localizedScryfallId: null,
      printedName: null,
      imageUris: null,
      faces: null,
      imageStatus: null,
      highresImage: false,
      nameChecked: false,
      missing: true,
      // Une ligne d'avant les colonnes de substitution : `null`, c'est-à-dire
      // le comportement d'hier.
      substitute: null,
    });

    let recherches = 0;
    // Cette carte-là n'a pas de nom français : c'est le cas qui bouclerait sans
    // `nameChecked`.
    const fetchElsewhere = async () => {
      recherches += 1;
      return null;
    };


    for (let i = 0; i < 3; i += 1) {
      const res = await resolveLocalizedCards({
        cards: [AVEC_ORACLE],
        language: 'fr',
        store,
        fetch,
        fetchElsewhere,
      });
      expect(res.cards[0]?.printedName).toBe('Space Beleren');
    }
    expect(recherches).toBe(1);
  });

  it("n'appelle pas la recherche quand l'impression traduite existe et qu'elle est nette", async () => {
    const { store } = memoire();
    // Le même Sol Ring, mais dont Scryfall publie un scan haute définition : il
    // n'y a alors rien à gagner ailleurs, ni la langue ni la netteté.
    const { fetch } = scryfallFeint({
      'c21/263/fr': { ...SOL_RING_FR, image_status: 'highres_scan', highres_image: true },
    });
    let recherches = 0;
    const fetchElsewhere = async () => {
      recherches += 1;
      return { printedName: 'jamais', substitute: null };
    };

    await resolveLocalizedCards({ cards: [SOL_RING], language: 'fr', store, fetch, fetchElsewhere });
    expect(recherches).toBe(0);
  });

  it("cherche en revanche quand l'impression traduite existe mais qu'elle est floue", async () => {
    // Le trou signalé par l'utilisateur : « pourquoi certaines cartes sont
    // encore en basse résolution ». Une impression française existe, elle est
    // servie, et elle est `lowres` — alors qu'une autre édition française nette
    // existe. Jusqu'ici la substitution ne se déclenchait que sur un 404.
    const { store } = memoire();
    const { fetch } = scryfallFeint({
      'c21/263/fr': { ...SOL_RING_FR, image_status: 'lowres', highres_image: false },
    });
    let recherches = 0;
    const fetchElsewhere = async () => {
      recherches += 1;
      return {
        printedName: 'Anneau solaire',
        substitute: {
          scryfallId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          setCode: 'soc',
          collectorNumber: '128',
          imageUris: { normal: 'https://cards.scryfall.io/fr-soc-128.jpg' },
          faces: null,
          imageStatus: 'highres_scan',
          highresImage: true,
        },
        servedImageStatus: 'lowres',
        servedHighresImage: false,
      };
    };

    const res = await resolveLocalizedCards({
      cards: [SOL_RING],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });
    expect(recherches).toBe(1);
    // La carte reste française et garde son illustration : la substitution est
    // publiée, mais c'est le client qui décide de l'afficher.
    expect(res.cards[0]?.language).toBe('fr');
    expect((res.cards[0]?.imageUris as any).normal).toContain('fr-anneau-solaire');
    expect(res.cards[0]?.substitute?.setCode).toBe('soc');
  });

  it("ne marque jamais `pending` une carte dont l'impression française existe", async () => {
    /*
     * Le piège, et il aurait coûté cher : côté client, une impression localisée
     * `pending` n'est **pas** utilisée — `resolveCardImage` redescend sur le
     * catalogue anglais. Poser `pending` sur une carte française parfaitement
     * affichable, au seul motif que la recherche de netteté reste à faire,
     * remplacerait du français par de l'anglais pendant tout le rattrapage :
     * 727 lignes au premier balayage, c'est-à-dire l'inverse de ce qu'on veut.
     *
     * La carte reste dans `unresolved` : la file de fond termine le travail,
     * simplement sans rien casser à l'écran entre-temps.
     */
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint({
      'c21/263/fr': { ...SOL_RING_FR, image_status: 'lowres', highres_image: false },
    });
    // Le plafond renvoie la recherche à la file de fond.
    rows.set(`${SOL_RING.scryfallId}|fr`, {
      scryfallId: SOL_RING.scryfallId,
      language: 'fr',
      localizedScryfallId: SOL_RING_FR.id,
      printedName: 'Anneau solaire',
      imageUris: SOL_RING_FR.image_uris,
      faces: null,
      imageStatus: 'lowres',
      highresImage: false,
      nameChecked: true,
      missing: false,
      substitute: null,
      substituteSearchVersion: 0,
    });

    const res = await resolveLocalizedCards({
      cards: [SOL_RING],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere: async () => ({ printedName: 'Anneau solaire', substitute: null }),
      maxLookups: 0,
    });

    expect(res.cards[0]?.pending).toBe(false);
    expect(res.cards[0]?.language).toBe('fr');
    expect((res.cards[0]?.imageUris as any).normal).toContain('fr-anneau-solaire');
    // Mais la file de fond a bien de quoi finir.
    expect(res.unresolved).toHaveLength(1);
  });
});

/**
 * La résolution de fond.
 *
 * Le plafond par requête protège la connexion du joueur ; il ne doit pas
 * décider de ce qui est traduit. Mesuré avant cette reprise : sur 84 cartes
 * froides, 44 restaient anglaises après le rattrapage du client, sans qu'aucune
 * ne soit un vrai 404.
 */
describe('la reprise en tâche de fond', () => {
  it('rend la liste de ce que le plafond a laissé de côté', async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    const beaucoup = Array.from({ length: 5 }, (_, i) => ({
      ...SPACE_BELEREN,
      scryfallId: `44444444-4444-4444-8444-00000000000${i}`,
      collectorNumber: String(100 + i),
    }));

    const res = await resolveLocalizedCards({
      cards: beaucoup,
      language: 'fr',
      store,
      fetch,
      maxLookups: 2,
    });
    expect(res.unresolved).toHaveLength(3);
    expect(res.unresolved.map((c) => c.scryfallId)).toEqual(
      res.cards.filter((c) => c.pending).map((c) => c.scryfallId),
    );
  });

  it('finit le travail après la réponse, sans plafond', async () => {
    resetBackgroundLocalization();
    const { store, rows } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);
    const reste = Array.from({ length: 25 }, (_, i) => ({
      ...SPACE_BELEREN,
      scryfallId: `55555555-5555-4555-8555-0000000000${String(i).padStart(2, '0')}`,
      collectorNumber: String(200 + i),
    }));

    scheduleBackgroundLocalization(reste, 'fr', { store, fetch });
    // La file rend la main tout de suite : la réponse HTTP ne l'attend pas.
    expect(appels.length).toBeLessThan(25);
    // Puis elle se vide toute seule, sans plafond.
    for (let i = 0; i < 200 && rows.size < 25; i += 1) {
      await new Promise((r) => setTimeout(r, 1));
    }

    expect(appels.length).toBe(25);
    expect(rows.size).toBe(25);
  });

  it("ne met rien en file quand c'est l'anglais qui est demandé", () => {
    resetBackgroundLocalization();
    const { store } = memoire();
    const { appels, fetch } = scryfallFeint(CONNUES);
    scheduleBackgroundLocalization([SPACE_BELEREN], 'en', { store, fetch });
    expect(appels).toHaveLength(0);
  });
});

/**
 * Le choix de l'impression de substitution.
 *
 * Une carte peut avoir trente impressions françaises. En prendre une au hasard,
 * ou la plus récente, donnerait un jour un Secret Lair sans scan correct et le
 * lendemain autre chose — et **pas la même d'une session à l'autre**. La règle
 * doit donc être un ordre total, et c'est ce qu'on vérifie ici.
 */
describe("l'impression de substitution", () => {
  const impression = (over: Record<string, unknown>): any => ({
    id: '00000000-0000-4000-8000-000000000000',
    name: 'Path to Exile',
    lang: 'fr',
    layout: 'normal',
    set: 'xxx',
    set_name: 'Test',
    set_type: 'expansion',
    collector_number: '1',
    image_uris: { normal: 'https://cards.scryfall.io/normal/fr.jpg' },
    image_status: 'highres_scan',
    ...over,
  });

  it('préfère un scan haute définition à un scan de basse définition', () => {
    const mou = impression({ id: 'a', image_status: 'lowres' });
    const net = impression({ id: 'b', image_status: 'highres_scan' });
    expect(chooseSubstitute([mou, net])?.id).toBe('b');
  });

  it("écarte ce qui n'est qu'une image de remplacement", () => {
    // `placeholder` ne porte ni l'illustration ni le texte : la substituer à une
    // image anglaise nette serait une perte sèche.
    const bouchon = impression({ id: 'a', image_status: 'placeholder' });
    expect(chooseSubstitute([bouchon])).toBeNull();
  });

  it("écarte une impression sans image du tout", () => {
    const nue = impression({ id: 'a', image_uris: undefined, image_status: undefined });
    expect(chooseSubstitute([nue])).toBeNull();
  });

  it('à qualité égale, suit le printingScore du catalogue', () => {
    // Le même barème que celui qui départage déjà les impressions par défaut :
    // on ne réinvente pas un second classement qui divergerait du premier.
    const secretLair = impression({ id: 'a', set_type: 'box' });
    const ordinaire = impression({ id: 'b', set_type: 'expansion' });
    expect(chooseSubstitute([secretLair, ordinaire])?.id).toBe('b');
  });

  it('rend toujours la même impression pour le même ensemble de candidats', () => {
    // L'ordre se termine sur l'identifiant : il est **total**, donc stable — et
    // le résultat est en plus figé en base dès la première résolution.
    const lot = [
      impression({ id: 'c', released_at: '2020-01-01' }),
      impression({ id: 'a', released_at: '2020-01-01' }),
      impression({ id: 'b', released_at: '2020-01-01' }),
    ];
    expect(chooseSubstitute(lot)?.id).toBe('a');
    expect(chooseSubstitute([...lot].reverse())?.id).toBe('a');
  });

  it('à qualité et score égaux, prend la plus récente', () => {
    const vieille = impression({ id: 'a', released_at: '2010-01-01' });
    const recente = impression({ id: 'b', released_at: '2024-01-01' });
    expect(chooseSubstitute([vieille, recente])?.id).toBe('b');
  });

  it("la mémorise avec le 404, et ne change rien à l'illustration servie", async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    const AVEC_ORACLE = { ...SPACE_BELEREN, oracleId: '99999999-9999-4999-8999-999999999999' };
    const fetchElsewhere = async () => ({
      printedName: 'Space Beleren',
      substitute: {
        scryfallId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        setCode: 'clb',
        collectorNumber: '42',
        imageUris: { normal: 'https://cards.scryfall.io/normal/fr-clb.jpg' },
        faces: null,
        imageStatus: 'highres_scan',
        highresImage: true,
      },
    });

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });

    // La ligne la retient…
    expect([...rows.values()][0].substitute?.setCode).toBe('clb');
    // …et la réponse la publie…
    expect(res.cards[0]?.substitute?.setCode).toBe('clb');
    // …mais l'illustration servie reste celle de l'impression choisie, et
    // l'identifiant du protocole ne bouge pas d'un iota.
    expect(res.cards[0]?.scryfallId).toBe(AVEC_ORACLE.scryfallId);
    expect((res.cards[0]?.imageUris as any).normal).toContain('en-space-beleren');
    expect(res.cards[0]?.language).toBe('en');
  });

  it("ne propose aucune substitution quand l'impression traduite existe", async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    const res = await resolveLocalizedCards({ cards: [SOL_RING], language: 'fr', store, fetch });
    expect(res.cards[0]?.substitute).toBeNull();
  });
});

/**
 * La ressemblance, et pourquoi elle passe avant la qualité.
 *
 * Retour de l'utilisateur, mot pour mot : « comment est choisi l'extension de
 * remplacement ? il y en a qui ressemble plus à l'originale en français ». Il
 * avait raison : l'ancienne règle classait par **qualité** et rendait donc la
 * meilleure impression, jamais la plus ressemblante. Un joueur qui a
 * délibérément choisi une illustration se voyait proposer une autre œuvre —
 * ou, mesuré sur *Lyra Dawnbringer* `FDN·707`, la même œuvre dans le **cadre
 * rétro de 1997** alors qu'une française au cadre moderne existait.
 *
 * Tout ce qui départage ici est publié par Scryfall : `illustration_id` (l'œuvre
 * elle-même), `frame`, `frame_effects`, `border_color`, `full_art`, `textless`,
 * `set_type`. Rien n'est deviné.
 */
describe('la ressemblance prime sur la qualité', () => {
  const OEUVRE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const OEUVRE_B = 'bbbbbbbb-0000-4000-8000-000000000002';

  const impression = (over: Record<string, unknown>): any => ({
    id: '00000000-0000-4000-8000-000000000000',
    name: 'Archangel of Thune',
    lang: 'fr',
    layout: 'normal',
    set: 'xxx',
    set_name: 'Test',
    set_type: 'expansion',
    collector_number: '1',
    image_uris: { normal: 'https://cards.scryfall.io/normal/fr.jpg' },
    image_status: 'lowres',
    frame: '2015',
    border_color: 'black',
    ...over,
  });

  /** Les traits de l'impression que le joueur a choisie. */
  const reference = (over: Record<string, unknown> = {}) => ({
    illustrationId: OEUVRE_A,
    frame: '2015',
    frameEffects: [],
    borderColor: 'black',
    fullArt: false,
    textless: false,
    setType: 'masters',
    ...over,
  });

  it("préfère la même œuvre, même quand l'autre est mieux scannée", () => {
    // Le cœur de la demande : une impression française de **son** illustration
    // passe devant une impression de meilleure qualité d'une autre œuvre.
    const memeOeuvreFloue = impression({
      id: 'a',
      illustration_id: OEUVRE_A,
      image_status: 'lowres',
    });
    const autreOeuvreNette = impression({
      id: 'b',
      illustration_id: OEUVRE_B,
      image_status: 'highres_scan',
    });
    expect(
      chooseSubstitute([autreOeuvreNette, memeOeuvreFloue], { reference: reference() })?.id,
    ).toBe('a');
  });

  it("retrouve l'œuvre sur une face de carte recto-verso", () => {
    // Scryfall ne pose pas `illustration_id` au premier niveau d'une carte
    // recto-verso : il y en a **un par face**. Le catalogue retient celui du
    // recto, et la comparaison accepte n'importe quelle face du candidat.
    const rectoVerso = impression({
      id: 'a',
      illustration_id: undefined,
      card_faces: [
        { name: 'recto', illustration_id: OEUVRE_A, image_uris: { normal: 'https://x/a.jpg' } },
        { name: 'verso', illustration_id: OEUVRE_B, image_uris: { normal: 'https://x/b.jpg' } },
      ],
    });
    const autre = impression({ id: 'b', illustration_id: OEUVRE_B, image_status: 'highres_scan' });
    expect(chooseSubstitute([autre, rectoVerso], { reference: reference() })?.id).toBe('a');
  });

  it('à œuvre égale, préfère le même cadre et la même bordure', () => {
    // Le cas *Lyra Dawnbringer* `FDN·707` : trois impressions françaises portent
    // la même œuvre, l'ancienne règle rendait celle au cadre rétro de 1997.
    const retro = impression({ id: 'a', illustration_id: OEUVRE_A, frame: '1997' });
    const moderne = impression({ id: 'b', illustration_id: OEUVRE_A, frame: '2015' });
    const sansBordure = impression({
      id: 'c',
      illustration_id: OEUVRE_A,
      frame: '2015',
      border_color: 'borderless',
      full_art: true,
    });
    expect(chooseSubstitute([retro, sansBordure, moderne], { reference: reference() })?.id).toBe(
      'b',
    );
  });

  it("retombe exactement sur la règle d'hier quand l'œuvre est inconnue", () => {
    // Une carte ingérée avant la colonne `illustrationId` : on ne peut rien
    // comparer. Le classement doit alors se comporter comme avant — qualité,
    // puis score d'impression, puis date — et non choisir au hasard.
    const mou = impression({ id: 'a', illustration_id: OEUVRE_A, image_status: 'lowres' });
    const net = impression({ id: 'b', illustration_id: OEUVRE_B, image_status: 'highres_scan' });
    const sansReference = { reference: reference({ illustrationId: null, frame: null }) };
    expect(chooseSubstitute([mou, net], sansReference)?.id).toBe('b');
    expect(chooseSubstitute([mou, net])?.id).toBe('b');
  });

  it("garde un ordre total : même lot, même choix, quel que soit l'ordre d'entrée", () => {
    const lot = [
      impression({ id: 'c', illustration_id: OEUVRE_A, released_at: '2020-01-01' }),
      impression({ id: 'a', illustration_id: OEUVRE_A, released_at: '2020-01-01' }),
      impression({ id: 'b', illustration_id: OEUVRE_A, released_at: '2020-01-01' }),
    ];
    expect(chooseSubstitute(lot, { reference: reference() })?.id).toBe('a');
    expect(chooseSubstitute([...lot].reverse(), { reference: reference() })?.id).toBe('a');
  });
});

/**
 * La substitution pour cause de **netteté**.
 *
 * Retour de l'utilisateur : « pourquoi certaines cartes sont encore en basse
 * résolution ». Une impression française existe, elle est servie, et son scan
 * est mou — alors qu'une autre édition française nette existe. Le déclencheur
 * n'était jusqu'ici que le 404.
 *
 * Le garde-fou compte autant que la règle : substituer un `lowres` à un autre
 * `lowres` ferait perdre au joueur l'œuvre qu'il a choisie **contre rien**.
 */
describe('la substitution pour cause de netteté', () => {
  const OEUVRE = 'cccccccc-0000-4000-8000-000000000003';
  const AUTRE_OEUVRE = 'dddddddd-0000-4000-8000-000000000004';

  const impression = (over: Record<string, unknown>): any => ({
    id: '00000000-0000-4000-8000-000000000000',
    name: 'Seraph Sanctuary',
    lang: 'fr',
    layout: 'normal',
    set: 'avr',
    set_name: 'Test',
    set_type: 'expansion',
    collector_number: '228',
    image_uris: { normal: 'https://cards.scryfall.io/normal/fr.jpg' },
    image_status: 'lowres',
    ...over,
  });

  it('ne bouge pas quand ce qui est servi est déjà net', () => {
    const autre = impression({ id: 'b', image_status: 'highres_scan' });
    expect(
      chooseSubstitute([autre], { servedImageStatus: 'highres_scan', servedScryfallId: 'a' }),
    ).toBeNull();
  });

  it("ne remplace pas un flou par un autre flou : il n'y a rien à y gagner", () => {
    const servie = impression({ id: 'a', image_status: 'lowres' });
    const autreFloue = impression({ id: 'b', image_status: 'lowres' });
    expect(
      chooseSubstitute([servie, autreFloue], {
        servedImageStatus: 'lowres',
        servedScryfallId: 'a',
      }),
    ).toBeNull();
  });

  it('remplace un flou par un scan net, et jamais par lui-même', () => {
    const servie = impression({ id: 'a', illustration_id: OEUVRE, image_status: 'lowres' });
    const nette = impression({ id: 'b', illustration_id: OEUVRE, image_status: 'highres_scan' });
    expect(
      chooseSubstitute([servie, nette], { servedImageStatus: 'lowres', servedScryfallId: 'a' })?.id,
    ).toBe('b');
  });

  it("préfère la même œuvre nette quand elle existe, et ne se rabat qu'ensuite", () => {
    /*
     * Le cas mesuré : 128 lignes françaises sont servies floues alors qu'une
     * française nette existe ailleurs, mais **16 seulement** portent la même
     * œuvre — et ces 16 ne couvrent que trois cartes. Exiger l'œuvre identique
     * rendrait la règle inerte ; on accepte donc l'échange, mais **jamais** au
     * détriment d'une œuvre identique disponible, et le client pose le repère
     * `substituted` qui nomme l'édition d'où vient l'illustration.
     */
    const servie = impression({ id: 'a', illustration_id: OEUVRE, image_status: 'lowres' });
    const memeOeuvreNette = impression({
      id: 'b',
      illustration_id: OEUVRE,
      image_status: 'highres_scan',
    });
    const autreNette = impression({
      id: 'c',
      illustration_id: AUTRE_OEUVRE,
      image_status: 'highres_scan',
    });
    const ref = {
      illustrationId: OEUVRE,
      frame: null,
      frameEffects: null,
      borderColor: null,
      fullArt: null,
      textless: null,
      setType: null,
    };
    expect(
      chooseSubstitute([servie, autreNette, memeOeuvreNette], {
        reference: ref,
        servedImageStatus: 'lowres',
        servedScryfallId: 'a',
      })?.id,
    ).toBe('b');
    // Sans œuvre identique nette, on prend la nette disponible : le joueur a
    // coché « forcer une édition dans ma langue », c'est le même troc.
    expect(
      chooseSubstitute([servie, autreNette], {
        reference: ref,
        servedImageStatus: 'lowres',
        servedScryfallId: 'a',
      })?.id,
    ).toBe('c');
  });

  it('écarte une image de remplacement même quand la servie est pire', () => {
    // `placeholder` ne porte ni l'illustration ni le texte : ce n'est pas un
    // gain de netteté, c'est une page blanche.
    const bouchon = impression({ id: 'b', image_status: 'placeholder' });
    expect(
      chooseSubstitute([bouchon], { servedImageStatus: 'placeholder', servedScryfallId: 'a' }),
    ).toBeNull();
  });
});

/**
 * Le verrou, et la façon d'en sortir.
 *
 * **Le défaut que ces tests gardent.** `nameChecked` a été écrit `true` par une
 * version du code qui ne cherchait que le **nom**. Quand la substitution est
 * arrivée, elle s'est branchée sur ce même drapeau — déjà levé sur des
 * centaines de lignes qui n'avaient évidemment aucune substitution, puisque les
 * colonnes n'existaient pas. Le garde-fou anti-boucle est alors devenu un
 * verrou définitif : mesuré en base, 669 lignes « déjà cherchées » pour 10
 * substitutions, et 555 cartes qui ne pouvaient plus rien en espérer.
 *
 * Le remède n'est pas de retirer le garde-fou — il servait à quelque chose de
 * vrai — mais de **séparer les deux questions**. « A-t-on cherché un nom ? » et
 * « a-t-on cherché une impression de substitution ? » n'ont pas la même réponse
 * sur ces lignes-là, et un booléen ne peut pas en porter deux.
 */
describe('le verrou de recherche, et son rattrapage', () => {
  const AVEC_ORACLE = { ...SPACE_BELEREN, oracleId: '99999999-9999-4999-8999-999999999999' };

  /** Une impression française d'une autre édition, affichable. */
  const AILLEURS = {
    printedName: 'Archange de Thiune',
    substitute: {
      scryfallId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      setCode: '2xm',
      collectorNumber: '5',
      imageUris: { normal: 'https://cards.scryfall.io/fr-2xm-5.jpg' },
      faces: null,
      imageStatus: 'lowres',
      highresImage: false,
    },
  };

  /**
   * Une ligne telle que l'ancienne version l'écrivait : elle sait qu'il n'y a
   * pas d'impression traduite **ici**, elle connaît même le nom français — donc
   * une impression française existe ailleurs — et elle n'a aucune substitution,
   * parce que les colonnes n'existaient pas encore. C'est exactement
   * *Archangel of Thune* `PIO · 4` telle qu'elle dort en base.
   */
  function ligneAncienne(overrides: Record<string, unknown> = {}) {
    return {
      scryfallId: AVEC_ORACLE.scryfallId,
      language: 'fr',
      localizedScryfallId: null,
      printedName: 'Archange de Thiune',
      imageUris: null,
      faces: null,
      imageStatus: null,
      highresImage: false,
      // Le drapeau d'hier, levé — et c'est lui qui verrouillait tout.
      nameChecked: true,
      missing: true,
      substitute: null,
      substituteSearchVersion: 0,
      ...overrides,
    };
  }

  it('distingue « jamais cherché » de « cherché sans succès »', () => {
    // La ligne d'hier : nom cherché, substitution jamais cherchée.
    expect(needsSubstituteSearch(ligneAncienne() as any)).toBe(true);
    // La même, une fois la recherche menée et revenue bredouille : close.
    expect(
      needsSubstituteSearch(
        ligneAncienne({ substituteSearchVersion: SUBSTITUTE_SEARCH_VERSION }) as any,
      ),
    ).toBe(false);
    // Une impression traduite existe **et elle est nette** : il n'y a rien à
    // gagner ailleurs, ni la langue ni la netteté.
    expect(
      needsSubstituteSearch(
        ligneAncienne({
          missing: false,
          imageStatus: 'highres_scan',
          substituteSearchVersion: 0,
        }) as any,
      ),
    ).toBe(false);
    // Elle existe mais elle est floue : une autre édition française nette peut
    // valoir la peine. C'est le second motif de recherche.
    expect(
      needsSubstituteSearch(
        ligneAncienne({ missing: false, imageStatus: 'lowres', substituteSearchVersion: 0 }) as any,
      ),
    ).toBe(true);
    // Statut inconnu — les lignes écrites avant la colonne : on n'en sait rien,
    // donc on va voir. Une fois.
    expect(
      needsSubstituteSearch(
        ligneAncienne({ missing: false, imageStatus: null, substituteSearchVersion: 0 }) as any,
      ),
    ).toBe(true);
  });

  it("ne cherche jamais rien pour un terrain de base", () => {
    // L'illustration *est* la carte : on ne la troque pas contre une traduction
    // qui ne traduit rien, et c'est autant d'appels Scryfall économisés — 409
    // lignes françaises sur 1162 en base de mesure.
    const plaine = { typeLine: 'Basic Land — Plains' };
    expect(needsSubstituteSearch(ligneAncienne() as any, plaine)).toBe(false);
    expect(needsSubstituteSearch(ligneAncienne() as any, { typeLine: 'Basic Land' })).toBe(false);
    expect(
      needsSubstituteSearch(ligneAncienne() as any, { typeLine: 'Basic Snow Land — Island' }),
    ).toBe(false);
    // Mais un terrain **non** basique, lui, se traduit et se substitue : les
    // duals originels, les fetchlands, tout ce qui porte du texte.
    expect(
      needsSubstituteSearch(ligneAncienne() as any, { typeLine: 'Land — Plains Island' }),
    ).toBe(true);
    expect(needsSubstituteSearch(ligneAncienne() as any, { typeLine: 'Land' })).toBe(true);
    // `Basic` seul ne suffit pas : le critère est le supertype **et** le type.
    expect(
      needsSubstituteSearch(ligneAncienne() as any, { typeLine: 'Basic Creature — Shapeshifter' }),
    ).toBe(true);
  });

  it("rouvre une ligne que `nameChecked` avait fermée, et lui donne son substitut", async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    rows.set(`${AVEC_ORACLE.scryfallId}|fr`, ligneAncienne());

    let recherches = 0;
    const fetchElsewhere = async () => {
      recherches += 1;
      return AILLEURS;
    };

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });

    expect(recherches).toBe(1);
    expect(res.cards[0]?.substitute?.setCode).toBe('2xm');
    expect(rows.get(`${AVEC_ORACLE.scryfallId}|fr`).substitute?.setCode).toBe('2xm');
    // L'illustration servie ne bouge pas : la substitution est un choix du
    // client, et l'identifiant du protocole encore moins.
    expect(res.cards[0]?.scryfallId).toBe(AVEC_ORACLE.scryfallId);
    expect((res.cards[0]?.imageUris as any).normal).toContain('en-space-beleren');
  });

  it('ne rouvre plus une ligne dont la recherche est revenue bredouille', async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    rows.set(`${AVEC_ORACLE.scryfallId}|fr`, ligneAncienne());

    let recherches = 0;
    // Aucune impression française nulle part : c'est le cas qui bouclerait si
    // l'on se contentait de retirer le garde-fou.
    const fetchElsewhere = async () => {
      recherches += 1;
      return null;
    };

    for (let i = 0; i < 4; i += 1) {
      await resolveLocalizedCards({
        cards: [AVEC_ORACLE],
        language: 'fr',
        store,
        fetch,
        fetchElsewhere,
      });
    }
    expect(recherches).toBe(1);
    expect(rows.get(`${AVEC_ORACLE.scryfallId}|fr`).substituteSearchVersion).toBe(
      SUBSTITUTE_SEARCH_VERSION,
    );
  });

  it('garde le nom déjà connu quand la nouvelle recherche ne rend rien', async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    rows.set(`${AVEC_ORACLE.scryfallId}|fr`, ligneAncienne());

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere: async () => null,
    });
    // Le nom a été vrai une fois : le perdre serait une régression visible.
    expect(res.cards[0]?.printedName).toBe('Archange de Thiune');
    expect(rows.get(`${AVEC_ORACLE.scryfallId}|fr`).printedName).toBe('Archange de Thiune');
  });

  it("ne grave pas une absence de substitut sur une panne de Scryfall", async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    rows.set(`${AVEC_ORACLE.scryfallId}|fr`, ligneAncienne());

    let appels = 0;
    const enPanne = async () => {
      appels += 1;
      throw new Error('503');
    };

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere: enPanne,
    });

    // Le compteur n'a pas bougé : un 503 gravé en « pas de substitut » serait un
    // dégât durable.
    expect(rows.get(`${AVEC_ORACLE.scryfallId}|fr`).substituteSearchVersion).toBe(0);
    // La carte revient à redemander, et à reprendre en tâche de fond.
    expect(res.cards[0]?.pending).toBe(true);
    expect(res.unresolved).toHaveLength(1);

    // Et elle repasse bien au tour suivant.
    await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere: enPanne,
    });
    expect(appels).toBe(2);
  });

  it("annonce `pending` quand le plafond renvoie le rattrapage à la file de fond", async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint(CONNUES);
    rows.set(`${AVEC_ORACLE.scryfallId}|fr`, ligneAncienne());

    const res = await resolveLocalizedCards({
      cards: [AVEC_ORACLE],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere: async () => AILLEURS,
      maxLookups: 0,
    });

    /*
     * Sans ce `pending`, le cache client — indexé par (carte, langue) — garderait
     * une réponse sans substitution comme si elle était définitive, et la
     * substitution écrite trente secondes plus tard par la file de fond
     * n'atteindrait le joueur qu'au rechargement de la page.
     */
    expect(res.cards[0]?.pending).toBe(true);
    expect(res.unresolved).toHaveLength(1);
    // Le nom déjà connu, lui, est servi tout de suite : rien ne clignote.
    expect(res.cards[0]?.printedName).toBe('Archange de Thiune');
  });
});

/**
 * Le rattrapage de masse.
 *
 * Lever le verrou suffit à ce qu'une carte **réaffichée** obtienne sa
 * substitution. Il ne suffit pas aux centaines de lignes que plus personne
 * n'affiche : un deck rangé, une carte croisée une fois, et la ligne dort. Sans
 * balayage, le rattrapage resterait théorique — et l'exigence était qu'il
 * aboutisse.
 */
describe('le balayage des lignes en retard', () => {
  const carte = (n: number) => ({
    scryfallId: `${n}`.padStart(8, '0') + '-0000-4000-8000-000000000000',
    name: `Carte ${n}`,
    setCode: 'unf',
    collectorNumber: `${n}`,
    oracleId: `${n}`.padStart(8, '9') + '-9999-4999-8999-999999999999',
    imageUris: { normal: `https://cards.scryfall.io/en-${n}.jpg` },
    faces: null,
  });

  /** Une base de N lignes anciennes, et le lecteur qui va les y chercher. */
  function base(n: number) {
    const { store, rows } = memoire();
    const cartes = Array.from({ length: n }, (_, i) => carte(i + 1));
    for (const c of cartes) {
      rows.set(`${c.scryfallId}|fr`, {
        scryfallId: c.scryfallId,
        language: 'fr',
        localizedScryfallId: null,
        printedName: `Carte ${c.collectorNumber}`,
        imageUris: null,
        faces: null,
        imageStatus: null,
        highresImage: false,
        nameChecked: true,
        missing: true,
        substitute: null,
        substituteSearchVersion: 0,
      });
    }
    const parId = new Map(cartes.map((c) => [c.scryfallId, c]));
    const loadPending = async (_language: string, limit: number) =>
      [...rows.values()]
        .filter((r: any) => r.missing && (r.substituteSearchVersion ?? 0) < SUBSTITUTE_SEARCH_VERSION)
        .slice(0, limit)
        .map((r: any) => parId.get(r.scryfallId)) as any[];
    return { store, rows, cartes, loadPending };
  }

  it('finit par rattraper toute la table, tranche par tranche', async () => {
    resetBackgroundLocalization();
    const { store, rows, loadPending } = base(25);
    const { fetch } = scryfallFeint({});

    const traitees = await backfillSubstitutes(
      'fr' as any,
      {
        store,
        fetch,
        fetchElsewhere: async () => ({
          printedName: 'un nom',
          substitute: {
            scryfallId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            setCode: 'clb',
            collectorNumber: '1',
            imageUris: { normal: 'https://cards.scryfall.io/fr-clb-1.jpg' },
            faces: null,
            imageStatus: 'highres_scan',
            highresImage: true,
          },
        }),
        loadPending: loadPending as any,
      } as any,
      10,
    );

    expect(traitees).toBe(25);
    // Plus une seule ligne en retard, et toutes portent leur substitution.
    const restantes = [...rows.values()].filter(
      (r: any) => (r.substituteSearchVersion ?? 0) < SUBSTITUTE_SEARCH_VERSION,
    );
    expect(restantes).toHaveLength(0);
    expect([...rows.values()].every((r: any) => r.substitute?.setCode === 'clb')).toBe(true);
  });

  it("s'arrête quand Scryfall ne répond plus, sans rien graver ni boucler", async () => {
    resetBackgroundLocalization();
    const { store, rows, loadPending } = base(25);
    const { fetch } = scryfallFeint({});

    let appels = 0;
    const traitees = await backfillSubstitutes(
      'fr' as any,
      {
        store,
        fetch,
        fetchElsewhere: async () => {
          appels += 1;
          throw new Error('503');
        },
        loadPending: loadPending as any,
      } as any,
      10,
    );

    // Une tranche tentée, rien d'écrit, et le balayage constate que la suivante
    // ne rend que les mêmes cartes : il s'arrête au lieu de marteler Scryfall.
    expect(traitees).toBe(10);
    expect(appels).toBeLessThanOrEqual(10);
    // Aucune absence gravée : tout reste à faire, et sera refait plus tard.
    expect(
      [...rows.values()].every((r: any) => (r.substituteSearchVersion ?? 0) === 0),
    ).toBe(true);
  });

  it("ne balaie rien quand c'est l'anglais qui est demandé", async () => {
    resetBackgroundLocalization();
    const { store, loadPending } = base(3);
    const { fetch } = scryfallFeint({});
    let lectures = 0;
    const compte = async (...args: any[]) => {
      lectures += 1;
      return (loadPending as any)(...args);
    };
    expect(
      await backfillSubstitutes('en' as any, { store, fetch, loadPending: compte } as any),
    ).toBe(0);
    expect(lectures).toBe(0);
  });
});

/**
 * L'exception des terrains de base.
 *
 * Demande de l'utilisateur, mot pour mot : « pour les terrains de base on se
 * fiche de la traduction ils restent dans l'edition initial sans warning mais
 * uniquement les terrains de bases ».
 *
 * La raison vaut mieux que la règle : un terrain de base n'a pas de texte à
 * lire. L'illustration *est* la carte, et c'est souvent pour elle qu'une
 * édition est choisie — les Plaines d'Amonkhet ne se remplacent pas par celles
 * d'une autre extension au nom d'une traduction dont personne n'a que faire. Le
 * gain est aussi mécanique : 409 des 1162 lignes françaises de la base sont des
 * terrains de base, soit autant d'appels Scryfall qui ne partent jamais.
 *
 * « Uniquement les terrains de bases » : le second test est celui qui compte, il
 * garde l'exception d'un élargissement silencieux.
 */
describe("les terrains de base ne se substituent jamais", () => {
  const PLAINE = {
    scryfallId: '44444444-4444-4444-8444-444444444444',
    name: 'Plains',
    setCode: 'akh',
    collectorNumber: '250',
    typeLine: 'Basic Land — Plains',
    imageUris: { normal: 'https://cards.scryfall.io/en-akh-plains.jpg' },
    faces: null,
    oracleId: '99999999-9999-4999-8999-999999999991',
  };

  /** Le même cas exactement, mais sur une carte à texte. */
  const NON_BASE = {
    ...PLAINE,
    scryfallId: '55555555-5555-4555-8555-555555555555',
    name: 'Irrigated Farmland',
    typeLine: 'Land — Plains Island',
    oracleId: '99999999-9999-4999-8999-999999999992',
  };

  const AILLEURS = {
    printedName: 'Plaine',
    substitute: {
      scryfallId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      setCode: 'znr',
      collectorNumber: '260',
      imageUris: { normal: 'https://cards.scryfall.io/fr-znr-260.jpg' },
      faces: null,
      imageStatus: 'highres_scan',
      highresImage: true,
    },
  };

  it("ni substitut ni appel Scryfall pour une Plaine sans version française", async () => {
    const { store, rows } = memoire();
    const { fetch } = scryfallFeint({});
    let recherches = 0;
    const fetchElsewhere = async () => {
      recherches += 1;
      return AILLEURS;
    };

    const res = await resolveLocalizedCards({
      cards: [PLAINE as any],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });

    // Aucun appel de recherche : c'est l'économie demandée.
    expect(recherches).toBe(0);
    expect(res.cards[0]?.substitute).toBeNull();
    // L'illustration reste celle de l'édition choisie, et le repli anglais est
    // muet côté client (`basicLand` dans `resolveCardImage`).
    expect((res.cards[0]?.imageUris as any).normal).toContain('en-akh-plains');
    // La ligne est **close** : sans cela elle reviendrait à chaque balayage.
    const ligne = rows.get(`${PLAINE.scryfallId}|fr`);
    expect(ligne.substituteSearchVersion).toBe(SUBSTITUTE_SEARCH_VERSION);
    expect(ligne.substitute).toBeNull();
    // Et elle ne se rouvre pas au passage suivant.
    await resolveLocalizedCards({
      cards: [PLAINE as any],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });
    expect(recherches).toBe(0);
  });

  it("mais une carte non basique dans la même situation reçoit les deux", async () => {
    const { store } = memoire();
    const { fetch } = scryfallFeint({});
    let recherches = 0;
    const fetchElsewhere = async () => {
      recherches += 1;
      return AILLEURS;
    };

    const res = await resolveLocalizedCards({
      cards: [NON_BASE as any],
      language: 'fr',
      store,
      fetch,
      fetchElsewhere,
    });

    expect(recherches).toBe(1);
    expect(res.cards[0]?.substitute?.setCode).toBe('znr');
    // Le nom français aussi : il ne dépend pas de l'édition.
    expect(res.cards[0]?.printedName).toBe('Plaine');
  });
});

/**
 * Le balayage doit pouvoir **repartir**.
 *
 * Mesuré en conditions réelles : `/cards/search` de Scryfall est nettement plus
 * avare que `/cards/{id}`, et une vingtaine de recherches consécutives suffisent
 * à déclencher un 429. Le garde-fou anti-boucle arrête alors proprement le
 * balayage — c'est ce qu'il doit faire, et rien n'est gravé — mais tant qu'il
 * n'était armé qu'une fois par processus, un rattrapage de neuf cents lignes
 * s'arrêtait au bout de vingt et ne reprenait qu'au redémarrage du serveur.
 */
describe('le réarmement du balayage', () => {
  function deps(compteur: { n: number }) {
    const { store } = memoire();
    const { fetch } = scryfallFeint({});
    return {
      store,
      fetch,
      fetchElsewhere: async () => null,
      loadPending: async () => {
        compteur.n += 1;
        return [];
      },
    } as any;
  }

  it("ne repart pas dans la foulée, mais repart après la fenêtre", async () => {
    resetBackgroundLocalization();
    const compteur = { n: 0 };
    const d = deps(compteur);

    scheduleSubstituteBackfill('fr' as any, d);
    scheduleSubstituteBackfill('fr' as any, d);
    scheduleSubstituteBackfill('fr' as any, d);
    // Trois demandes rapprochées, un seul balayage : on ne tire pas sur
    // Scryfall à chaque requête HTTP.
    await new Promise((r) => setTimeout(r, 0));
    expect(compteur.n).toBe(1);

    // La fenêtre passée, il repart — c'est ce qui fait qu'un rattrapage
    // interrompu par un 429 finit par aboutir sans redémarrage.
    resetBackgroundLocalization();
    scheduleSubstituteBackfill('fr' as any, d);
    await new Promise((r) => setTimeout(r, 0));
    expect(compteur.n).toBe(2);
  });

  it("ne balaie jamais la langue du catalogue", async () => {
    resetBackgroundLocalization();
    const compteur = { n: 0 };
    scheduleSubstituteBackfill('en' as any, deps(compteur));
    await new Promise((r) => setTimeout(r, 0));
    expect(compteur.n).toBe(0);
  });
});

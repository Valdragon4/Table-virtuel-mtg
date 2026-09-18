/**
 * Le catalogue des impressions traduites, ingéré en masse.
 *
 * Ce que ces tests gardent tient en trois phrases.
 *
 * **Un.** Le bulk `all_cards` contient le texte des règles dans toutes les
 * langues. Rien de tout cela n'a le droit d'entrer en base, et c'est le piège
 * principal de ce chantier — le filtrage a lieu à l'ingestion, pas à la lecture.
 *
 * **Deux.** Le chemin paresseux (réseau) et le chemin en masse (base) doivent
 * écrire **la même chose**. Deux chemins qui se contredisent produiraient deux
 * lignes différentes pour la même carte selon l'ordre où elle a été vue, et
 * personne ne s'en apercevrait avant longtemps.
 *
 * **Trois.** Une carte que le bulk ne connaît pas ne doit pas être déclarée sans
 * traduction. « Absente du bulk » et « jamais imprimée en français » sont deux
 * choses ; les confondre graverait un repli anglais définitif sur toutes les
 * nouveautés, exactement comme mémoriser un 503 (`docs/i18n.md` §3.5).
 *
 * Aucune base ni réseau ici : la source en masse est injectée, comme le sont
 * déjà le stockage et l'appel réseau.
 */
import { describe, expect, it } from 'vitest';

process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const {
  resolveLocalizedCards,
  elsewhereFromCandidates,
  toLocalizationRecord,
  printedNameOf,
  localizedFaces,
  SUBSTITUTE_SEARCH_VERSION,
  MAX_LIVE_LOOKUPS_PER_REQUEST,
} = await import('../src/cards/localization.js');

/** Hier : une impression française parfaitement ordinaire, telle que Scryfall la publie. */
const impressionFr = (over: Record<string, unknown> = {}): any => ({
  id: 'ffffffff-0000-4000-8000-000000000001',
  oracle_id: 'aaaaaaaa-0000-4000-8000-00000000000a',
  name: 'Sol Ring',
  printed_name: 'Anneau solaire',
  lang: 'fr',
  layout: 'normal',
  set: 'c21',
  set_name: 'Commander 2021',
  set_type: 'commander',
  collector_number: '263',
  released_at: '2021-04-23',
  image_uris: { normal: 'https://cards.scryfall.io/normal/fr-sol-ring.jpg' },
  image_status: 'highres_scan',
  highres_image: true,
  illustration_id: 'dddddddd-0000-4000-8000-00000000000d',
  frame: '2015',
  frame_effects: [],
  border_color: 'black',
  full_art: false,
  textless: false,
  digital: false,
  promo: false,
  variation: false,
  games: ['paper'],
  ...over,
});

const SOL_RING = {
  scryfallId: '11111111-1111-4111-8111-111111111111',
  name: 'Sol Ring',
  setCode: 'c21',
  collectorNumber: '263',
  oracleId: 'aaaaaaaa-0000-4000-8000-00000000000a',
  typeLine: 'Artifact',
  imageUris: { normal: 'https://cards.scryfall.io/normal/en-sol-ring.jpg' },
  faces: null,
  releasedAt: '2021-04-23',
  illustrationId: 'dddddddd-0000-4000-8000-00000000000d',
  frame: '2015',
  frameEffects: [],
  borderColor: 'black',
  isFullArt: false,
  isTextless: false,
  setType: 'commander',
};

/** Un magasin en mémoire : on veut voir ce qui a été **écrit**, pas ce qui a été rendu. */
function memoire() {
  const rows = new Map<string, any>();
  const ecrits: any[] = [];
  return {
    ecrits,
    rows,
    store: {
      async load(ids: string[], language: string): Promise<any[]> {
        return ids.map((id) => rows.get(`${id}/${language}`)).filter(Boolean);
      },
      async save(records: any[]): Promise<void> {
        for (const r of records) {
          rows.set(`${r.scryfallId}/${r.language}`, r);
          ecrits.push(r);
        }
      },
    },
  };
}

/** Une source en masse qui répond pour les cartes qu'on lui donne, et pour elles seules. */
function enMasse(reponses: Record<string, { printing: any; candidates: any[] }>) {
  let appels = 0;
  return {
    get appels() {
      return appels;
    },
    source: {
      async lookup(cards: any[]): Promise<Map<string, any>> {
        appels += 1;
        const out = new Map<string, any>();
        for (const c of cards) {
          const r = reponses[c.scryfallId];
          if (r) out.set(c.scryfallId, r);
        }
        return out;
      },
    },
  };
}

/** Un appel réseau qui échoue si on l'utilise : c'est tout l'objet du bulk. */
const jamaisAppele = async (): Promise<never> => {
  throw new Error('le réseau ne doit pas être touché quand le bulk connaît la carte');
};

describe("l'invariant de droits", () => {
  /*
   * Le bulk complet publie `oracle_text`, `printed_text`, `flavor_text` et
   * `printed_type_line`, dans toutes les langues. C'est précisément ce qui rend
   * ce chantier risqué : la matière interdite arrive cette fois **en masse**, et
   * non carte par carte.
   */
  const TEXTES_INTERDITS = [
    'oracle_text',
    'printed_text',
    'flavor_text',
    'flavor_name',
    'printed_type_line',
    "Ajoutez deux mana incolores",
    "Add two colorless mana",
    "Le fer ne ment jamais",
  ];

  const bavarde = impressionFr({
    oracle_text: 'Add two colorless mana.',
    printed_text: 'Ajoutez deux mana incolores.',
    flavor_text: 'Le fer ne ment jamais.',
    printed_type_line: 'Artefact',
    card_faces: undefined,
  });

  it("ne retient aucun texte de règles d'une impression traduite", () => {
    const record = toLocalizationRecord('11111111-1111-4111-8111-111111111111', 'fr', bavarde);
    const serialise = JSON.stringify(record);
    for (const interdit of TEXTES_INTERDITS) {
      expect(serialise).not.toContain(interdit);
    }
    // Ce qu'on garde, en revanche, doit bien y être : une URL et un nom.
    expect(serialise).toContain('cards.scryfall.io');
    expect(record.printedName).toBe('Anneau solaire');
  });

  it("n'en retient aucun non plus sur les faces d'une carte recto-verso", () => {
    const rectoVerso = impressionFr({
      printed_name: undefined,
      image_uris: undefined,
      card_faces: [
        {
          name: 'Fable of the Mirror-Breaker',
          printed_name: 'Fable du Brise-Miroir',
          type_line: 'Enchantment — Saga',
          printed_type_line: 'Enchantement — Saga',
          oracle_text: 'Create a 2/2 red Goblin creature token.',
          printed_text: 'Créez un jeton de créature 2/2 rouge Gobelin.',
          flavor_text: 'Le fer ne ment jamais.',
          image_uris: { normal: 'https://cards.scryfall.io/normal/fr-a.jpg' },
        },
        {
          name: 'Reflection of Kiki-Jiki',
          printed_name: 'Reflet de Kiki-Jiki',
          type_line: 'Creature — Goblin Shaman',
          oracle_text: 'Tap: Create a token.',
          image_uris: { normal: 'https://cards.scryfall.io/normal/fr-b.jpg' },
        },
      ],
    });
    const serialise = JSON.stringify(localizedFaces(rectoVerso));
    for (const interdit of TEXTES_INTERDITS) {
      expect(serialise).not.toContain(interdit);
    }
    expect(serialise).toContain('Fable du Brise-Miroir');
    expect(serialise).toContain('Reflet de Kiki-Jiki');
    // Le nom recomposé « recto // verso » : Scryfall ne le pose pas au premier
    // niveau d'une carte à deux faces.
    expect(printedNameOf(rectoVerso)).toBe('Fable du Brise-Miroir // Reflet de Kiki-Jiki');
  });
});

describe('le bulk remplace le réseau sans rien changer de ce qui est écrit', () => {
  it('résout sans aucun appel réseau, et sans consommer le plafond', async () => {
    // Le point de tout l'exercice : cent cartes froides, zéro appel vivant,
    // zéro `pending`. Le chemin paresseux plafonnait à vingt.
    const cartes = Array.from({ length: 100 }, (_, i) => ({
      ...SOL_RING,
      scryfallId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    }));
    const reponses: Record<string, any> = {};
    for (const c of cartes) {
      const fr = impressionFr({ id: `fr-${c.scryfallId}` });
      reponses[c.scryfallId] = { printing: fr, candidates: [fr] };
    }

    const m = memoire();
    const bulk = enMasse(reponses);
    const res = await resolveLocalizedCards({
      cards: cartes as any,
      language: 'fr',
      store: m.store,
      fetch: jamaisAppele as any,
      fetchElsewhere: jamaisAppele as any,
      bulk: bulk.source as any,
    });

    expect(cartes.length).toBeGreaterThan(MAX_LIVE_LOOKUPS_PER_REQUEST);
    expect(res.lookups).toBe(0);
    expect(res.unresolved).toEqual([]);
    expect(res.cards).toHaveLength(100);
    expect(res.cards.every((c) => c.pending === false)).toBe(true);
    expect(res.cards.every((c) => c.language === 'fr')).toBe(true);
    expect(res.cards.every((c) => c.fallback === false)).toBe(true);
    // Une seule interrogation pour tout le lot, et non une par carte : c'est ce
    // qui fait disparaître le plafond plutôt que de le déplacer.
    expect(bulk.appels).toBe(1);
  });

  it('écrit exactement la même ligne que le chemin réseau, sur le même lot', async () => {
    /*
     * La garantie qui compte. Les candidates sont identiques ; seule leur
     * provenance change. Si les deux lignes diffèrent d'un seul champ, une carte
     * résolue par le bulk et la même résolue par le réseau se contrediraient en
     * base selon l'ordre où elles ont été vues.
     */
    const aSubstituer = {
      ...SOL_RING,
      setCode: 'pio',
      collectorNumber: '4',
      illustrationId: 'eeeeeeee-0000-4000-8000-00000000000e',
    };
    const candidates = [
      impressionFr({
        id: 'fr-1',
        set: '2xm',
        collector_number: '5',
        illustration_id: 'eeeeeeee-0000-4000-8000-00000000000e',
        image_status: 'highres_scan',
        released_at: '2020-08-07',
      }),
      impressionFr({
        id: 'fr-2',
        set: 'sld',
        collector_number: '99',
        set_type: 'box',
        illustration_id: 'ffffffff-0000-4000-8000-00000000000f',
        image_status: 'highres_scan',
        released_at: '2023-01-01',
      }),
    ];

    // Chemin réseau : 404 sur l'impression exacte, puis la recherche `oracleid`.
    const parReseau = memoire();
    const viaReseau = await resolveLocalizedCards({
      cards: [aSubstituer] as any,
      language: 'fr',
      store: parReseau.store,
      fetch: async () => null,
      fetchElsewhere: async (card: any) => elsewhereFromCandidates(card, candidates),
    });

    // Chemin en masse : les mêmes candidates, venues de la base.
    const parBulk = memoire();
    const viaBulk = await resolveLocalizedCards({
      cards: [aSubstituer] as any,
      language: 'fr',
      store: parBulk.store,
      fetch: jamaisAppele as any,
      fetchElsewhere: jamaisAppele as any,
      bulk: enMasse({ [aSubstituer.scryfallId]: { printing: null, candidates } }).source as any,
    });

    expect(parBulk.ecrits).toEqual(parReseau.ecrits);
    expect(viaBulk.cards).toEqual(viaReseau.cards);
    // Et la substitution retenue est bien celle de la **même œuvre**, pas la
    // plus récente : la règle de classement n'a pas changé de source.
    expect(parBulk.ecrits[0].substitute?.scryfallId).toBe('fr-1');
    expect(parBulk.ecrits[0].substituteSearchVersion).toBe(SUBSTITUTE_SEARCH_VERSION);
  });

  it("n'écrit pas de substitution sur une impression déjà nette, comme le réseau", async () => {
    /*
     * Le chemin réseau ne cherche même pas ailleurs quand l'impression traduite
     * est `highres_scan` : il n'y a ni langue ni netteté à gagner. Le bulk, lui,
     * a les candidates sous la main et serait tenté de choisir quand même. Les
     * deux lignes différeraient alors — et c'est exactement le genre d'écart
     * qu'on ne verrait jamais à l'écran.
     */
    const nette = impressionFr({ id: 'fr-servie', image_status: 'highres_scan' });
    const autre = impressionFr({ id: 'fr-autre', set: '2xm', collector_number: '5' });

    const m = memoire();
    await resolveLocalizedCards({
      cards: [SOL_RING] as any,
      language: 'fr',
      store: m.store,
      fetch: jamaisAppele as any,
      fetchElsewhere: jamaisAppele as any,
      bulk: enMasse({
        [SOL_RING.scryfallId]: { printing: nette, candidates: [nette, autre] },
      }).source as any,
    });

    expect(m.ecrits).toHaveLength(1);
    expect(m.ecrits[0].substitute).toBeNull();
    expect(m.ecrits[0].localizedScryfallId).toBe('fr-servie');
  });

  it('ne substitue jamais un terrain de base, même quand le bulk a de quoi', async () => {
    // L'exception du §3.9, et c'est une décision du propriétaire : l'illustration
    // *est* la carte. Elle doit tenir sur le chemin en masse aussi.
    const plaine = {
      ...SOL_RING,
      typeLine: 'Basic Land — Plains',
      setCode: 'akh',
      collectorNumber: '250',
    };
    const ailleurs = impressionFr({ id: 'fr-plaine-autre', set: 'war', collector_number: '260' });

    const m = memoire();
    await resolveLocalizedCards({
      cards: [plaine] as any,
      language: 'fr',
      store: m.store,
      fetch: jamaisAppele as any,
      fetchElsewhere: jamaisAppele as any,
      bulk: enMasse({
        [plaine.scryfallId]: { printing: null, candidates: [ailleurs] },
      }).source as any,
    });

    expect(m.ecrits[0].missing).toBe(true);
    expect(m.ecrits[0].substitute).toBeNull();
    // La question est close : la ligne ne repassera pas au balayage.
    expect(m.ecrits[0].substituteSearchVersion).toBe(SUBSTITUTE_SEARCH_VERSION);
  });

  it("mémorise « pas de version française » quand le bulk fait autorité et n'a rien", async () => {
    // Le bulk répond pour cette carte et ne connaît aucune impression
    // française : c'est une **réponse**, pas une ignorance, et elle se mémorise
    // exactement comme le 404 du chemin réseau.
    const m = memoire();
    const res = await resolveLocalizedCards({
      cards: [SOL_RING] as any,
      language: 'fr',
      store: m.store,
      fetch: jamaisAppele as any,
      fetchElsewhere: jamaisAppele as any,
      bulk: enMasse({
        [SOL_RING.scryfallId]: { printing: null, candidates: [] },
      }).source as any,
    });

    expect(m.ecrits[0].missing).toBe(true);
    expect(m.ecrits[0].printedName).toBeNull();
    expect(res.cards[0]!.fallback).toBe(true);
    expect(res.cards[0]!.pending).toBe(false);
    expect(res.unresolved).toEqual([]);
  });
});

describe('le chemin paresseux survit, et reste le repli', () => {
  it("retombe sur le réseau pour une carte que le bulk ne tranche pas", async () => {
    /*
     * L'avis du propriétaire, et il est juste : une carte parue après notre
     * dernière ingestion n'est dans aucun bulk, et le joueur ne doit pas la voir
     * en anglais pour autant. La source en masse s'abstient — elle ne met pas la
     * carte dans sa réponse — et le chemin réseau reprend la main.
     */
    const nouveaute = { ...SOL_RING, scryfallId: '99999999-9999-4999-8999-999999999999' };
    const fr = impressionFr({ id: 'fr-nouveaute' });

    let appelsReseau = 0;
    const m = memoire();
    const res = await resolveLocalizedCards({
      cards: [nouveaute] as any,
      language: 'fr',
      store: m.store,
      fetch: async () => {
        appelsReseau += 1;
        return fr;
      },
      fetchElsewhere: async () => null,
      // La source ne connaît que `SOL_RING`, pas la nouveauté.
      bulk: enMasse({ [SOL_RING.scryfallId]: { printing: fr, candidates: [fr] } }).source as any,
    });

    expect(appelsReseau).toBe(1);
    expect(res.cards[0]!.language).toBe('fr');
    expect(res.cards[0]!.localizedScryfallId).toBe('fr-nouveaute');
  });

  it("ne grave rien quand la base tombe, et laisse le réseau finir le travail", async () => {
    // La règle du §3.5 vaut aussi pour la base : une panne n'est pas une
    // réponse. Une source en masse qui lève doit être sans effet, pas fatale.
    const boiteuse = {
      async lookup(): Promise<Map<string, any>> {
        throw new Error('base indisponible');
      },
    };
    const fr = impressionFr({ id: 'fr-secours' });
    const m = memoire();
    const res = await resolveLocalizedCards({
      cards: [SOL_RING] as any,
      language: 'fr',
      store: m.store,
      fetch: async () => fr,
      fetchElsewhere: async () => null,
      bulk: boiteuse as any,
    });

    expect(res.cards[0]!.localizedScryfallId).toBe('fr-secours');
    expect(res.lookups).toBe(1);
  });

  it('se comporte exactement comme avant quand aucune source en masse n\'est fournie', async () => {
    // Une base vierge, dont l'ingestion n'a pas encore tourné, doit rester
    // utilisable : c'est le premier démarrage, et il ne doit pas attendre.
    const froides = Array.from({ length: 30 }, (_, i) => ({
      ...SOL_RING,
      scryfallId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
    }));
    const m = memoire();
    const res = await resolveLocalizedCards({
      cards: froides as any,
      language: 'fr',
      store: m.store,
      fetch: async () => impressionFr({ id: 'fr-x' }),
      fetchElsewhere: async () => null,
    });

    expect(res.lookups).toBe(MAX_LIVE_LOOKUPS_PER_REQUEST);
    expect(res.unresolved).toHaveLength(10);
    expect(res.cards.filter((c) => c.pending).length).toBe(10);
  });

  it("rattrape une ligne ancienne par le bulk, sans toucher au réseau", async () => {
    /*
     * Les lignes écrites avant la substitution portent `substituteSearchVersion:
     * 0`. Le balayage les reprenait par `/cards/search`, une vingtaine avant le
     * 429. Le bulk les reprend toutes, d'un coup.
     */
    const ancienne = {
      scryfallId: SOL_RING.scryfallId,
      language: 'fr',
      localizedScryfallId: null,
      printedName: null,
      imageUris: null,
      faces: null,
      imageStatus: null,
      highresImage: false,
      nameChecked: true,
      substituteSearchVersion: 0,
      missing: true,
      substitute: null,
    };
    const m = memoire();
    m.rows.set(`${SOL_RING.scryfallId}/fr`, ancienne);

    const candidate = impressionFr({ id: 'fr-ailleurs', set: '2xm', collector_number: '5' });
    const res = await resolveLocalizedCards({
      cards: [SOL_RING] as any,
      language: 'fr',
      store: m.store,
      fetch: jamaisAppele as any,
      fetchElsewhere: jamaisAppele as any,
      bulk: enMasse({
        [SOL_RING.scryfallId]: { printing: null, candidates: [candidate] },
      }).source as any,
    });

    expect(res.lookups).toBe(0);
    expect(m.ecrits[0].substituteSearchVersion).toBe(SUBSTITUTE_SEARCH_VERSION);
    expect(m.ecrits[0].substitute?.scryfallId).toBe('fr-ailleurs');
    expect(m.ecrits[0].printedName).toBe('Anneau solaire');
    // La ligne reste `missing` : cette impression-ci n'existe toujours pas en
    // français, et c'est la substitution qui apporte la langue — sur demande.
    expect(m.ecrits[0].missing).toBe(true);
  });
});

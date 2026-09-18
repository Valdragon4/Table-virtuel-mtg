/**
 * La résolution d'illustration selon la langue.
 *
 * Le cas intéressant n'est pas « la carte française existe » — c'est le
 * contraire : la plupart des cartes n'ont jamais été imprimées en français, et
 * c'est le repli anglais qui sera emprunté mille fois par partie. On vérifie
 * aussi qu'aucune URL produite ne sort du CDN de Scryfall : rien de Wizards of
 * the Coast n'est hébergé, proxifié ni mis en cache par nous.
 */
import { describe, expect, it } from 'vitest';
import {
  cardImageUrl,
  cardLanguageMark,
  pendingLocalizations,
  resolveCardImage,
  type ImageSource,
  type LocalizedPrinting,
} from '../src/lib/i18n/cardImage.js';

const EN_ID = '11111111-2222-3333-4444-555555555555';
const FR_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** Une carte simple du catalogue anglais, telle que `/api/cards/batch` la rend. */
const anglaise: ImageSource = {
  scryfallId: EN_ID,
  imageUris: { normal: 'https://cards.scryfall.io/normal/front/1/1/en.jpg', large: undefined },
  faces: null,
};

/** Son impression française, identifiant distinct et images propres. */
const française: LocalizedPrinting = {
  scryfallId: EN_ID,
  language: 'fr',
  localizedScryfallId: FR_ID,
  imageUris: { large: 'https://cards.scryfall.io/large/front/a/a/fr.jpg' },
  faces: null,
};

describe('langue demandée', () => {
  it('prend l’impression française quand elle existe', () => {
    const resolved = resolveCardImage({ card: anglaise, localized: française, language: 'fr' });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/front/a/a/fr.jpg');
    expect(resolved.language).toBe('fr');
    expect(resolved.fallback).toBe(false);
  });

  it('ignore la résolution localisée quand on demande l’anglais', () => {
    const resolved = resolveCardImage({ card: anglaise, localized: française, language: 'en' });
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
    expect(resolved.fallback).toBe(false);
  });
});

describe('repli anglais', () => {
  it('sert l’anglais quand la carte n’existe pas en français', () => {
    // Le serveur renvoie l'anglais dans `localized` avec `language: 'en'` et
    // `fallback: true` : c'est sa façon de dire « pas de version française ».
    // C'est le cas **courant**, et c'est une réponse **définitive**.
    const repli: LocalizedPrinting = {
      ...française,
      language: 'en',
      fallback: true,
      pending: false,
      localizedScryfallId: null,
    };
    const resolved = resolveCardImage({ card: anglaise, localized: repli, language: 'fr' });
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
    expect(resolved.language).toBe('en');
    expect(resolved.fallback).toBe(true);
    // Rien à redemander : ce repli-là ne changera jamais.
    expect(resolved.pending).toBe(false);
  });

  it('sert l’anglais tant que la résolution n’est pas arrivée', () => {
    // Premier rendu : l'appel localisé n'a pas encore été fait. On montre
    // quelque chose plutôt qu'un cadre vide, et on se note qu'il faut redemander.
    const resolved = resolveCardImage({ card: anglaise, language: 'fr' });
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
    expect(resolved.fallback).toBe(true);
    expect(resolved.pending).toBe(true);
  });

  it('ne prend pas une résolution encore en attente pour une traduction', () => {
    // Le serveur plafonne ses appels vivants à Scryfall : `pending` veut dire
    // « on n'a pas encore regardé », pas « il n'y en a pas ».
    const attente: LocalizedPrinting = { ...française, pending: true };
    const resolved = resolveCardImage({ card: anglaise, localized: attente, language: 'fr' });
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
    expect(resolved.pending).toBe(true);
  });

  it('ne marque jamais l’anglais demandé comme à redemander', () => {
    const resolved = resolveCardImage({ card: anglaise, language: 'en' });
    expect(resolved.fallback).toBe(false);
    expect(resolved.pending).toBe(false);
  });

  it('liste les cartes à redemander, et elles seules', () => {
    const lot: LocalizedPrinting[] = [
      { scryfallId: 'a', language: 'fr', pending: false },
      { scryfallId: 'b', language: 'en', fallback: true, pending: false },
      { scryfallId: 'c', language: 'en', pending: true },
    ];
    // Un `fallback` définitif ne doit pas repartir : ce serait redemander à
    // chaque rendu une réponse que le serveur a déjà donnée.
    expect(pendingLocalizations(lot)).toEqual(['c']);
    expect(pendingLocalizations(undefined)).toEqual([]);
  });

  it('redescend sur l’anglais si l’impression française n’a pas cette image', () => {
    const sansImage: LocalizedPrinting = { ...française, imageUris: null, faces: null };
    const resolved = resolveCardImage({ card: anglaise, localized: sansImage, language: 'fr' });
    // Faute d'`image_uris`, le motif du CDN est dérivé de l'identifiant français…
    expect(resolved.url).toBe(`https://cards.scryfall.io/large/front/a/a/${FR_ID}.jpg`);
    expect(resolved.fallback).toBe(false);
  });
});

describe('cartes recto-verso', () => {
  const dfc: ImageSource = {
    scryfallId: EN_ID,
    imageUris: null,
    faces: [
      { name: 'Delver of Secrets', imageUris: { large: 'https://cards.scryfall.io/large/front/1/1/en.jpg' } },
      { name: 'Insectile Aberration', imageUris: { large: 'https://cards.scryfall.io/large/back/1/1/en.jpg' } },
    ],
  };

  it('rend une image par face', () => {
    expect(cardImageUrl({ card: dfc, language: 'en', face: 0 })).toBe(
      'https://cards.scryfall.io/large/front/1/1/en.jpg',
    );
    expect(cardImageUrl({ card: dfc, language: 'en', face: 1 })).toBe(
      'https://cards.scryfall.io/large/back/1/1/en.jpg',
    );
  });

  it('rend le verso français quand il existe', () => {
    const dfcFr: LocalizedPrinting = {
      scryfallId: EN_ID,
      language: 'fr',
      localizedScryfallId: FR_ID,
      imageUris: null,
      faces: [
        { imageUris: { large: 'https://cards.scryfall.io/large/front/a/a/fr.jpg' } },
        { imageUris: { large: 'https://cards.scryfall.io/large/back/a/a/fr.jpg' } },
      ],
    };
    expect(cardImageUrl({ card: dfc, localized: dfcFr, language: 'fr', face: 1 })).toBe(
      'https://cards.scryfall.io/large/back/a/a/fr.jpg',
    );
  });

  it('rend null pour un verso qui n’existe pas', () => {
    // Une carte simple n'a pas de dos propre : le dos générique est l'affaire
    // de `CardBack`, pas de cette fonction.
    expect(cardImageUrl({ card: anglaise, language: 'fr', face: 1 })).toBeNull();
  });

  it('ne traite pas une face sans image comme une vraie face', () => {
    // Un `split` ou un `adventure` a deux faces logiques, une seule illustration.
    const split: ImageSource = {
      scryfallId: EN_ID,
      imageUris: { large: 'https://cards.scryfall.io/large/front/1/1/en.jpg' },
      faces: [{ name: 'Fire' }, { name: 'Ice' }],
    };
    expect(cardImageUrl({ card: split, language: 'en', face: 0 })).toBe(
      'https://cards.scryfall.io/large/front/1/1/en.jpg',
    );
    expect(cardImageUrl({ card: split, language: 'en', face: 1 })).toBeNull();
  });
});

/**
 * La définition de l'illustration traduite.
 *
 * Mesuré sur un deck réel : 34 des 55 impressions françaises trouvées sont
 * `lowres` chez Scryfall — l'URL `large` existe et rend bien 672 × 936, mais
 * agrandie depuis un scan de basse définition. C'est le flou constaté, et ce
 * n'est pas une dégradation de taille : aucune de ces impressions ne manquait
 * de `large`.
 */
describe("la définition de l'impression traduite", () => {
  it("garde une impression `lowres` : elle est molle, mais elle se lit en français", () => {
    const molle: LocalizedPrinting = { ...française, imageStatus: 'lowres', highresImage: false };
    for (const version of ['small', 'normal', 'large'] as const) {
      const resolved = resolveCardImage({
        card: anglaise,
        localized: molle,
        language: 'fr',
        version,
      });
      expect(resolved.language).toBe('fr');
      expect(resolved.fallback).toBe(false);
    }
  });

  it("écarte une image de remplacement : elle n'a ni le texte français ni l'illustration", () => {
    const bouchon: LocalizedPrinting = {
      ...française,
      pending: false,
      imageStatus: 'placeholder',
      highresImage: false,
    };
    const resolved = resolveCardImage({ card: anglaise, localized: bouchon, language: 'fr' });
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
    expect(resolved.language).toBe('en');
    expect(resolved.fallback).toBe(true);
    // Le repli est définitif : la ligne est en base, il n'y a rien à redemander.
    expect(resolved.pending).toBe(false);
  });

  it("accepte une résolution sans statut : les anciennes lignes n'en portent pas", () => {
    const resolved = resolveCardImage({ card: anglaise, localized: française, language: 'fr' });
    expect(resolved.language).toBe('fr');
  });
});

describe('tailles et invariant de droits', () => {
  it('descend vers la taille disponible plutôt que de ne rien rendre', () => {
    const resolved = resolveCardImage({ card: anglaise, language: 'en', version: 'large' });
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
  });

  it('dérive l’URL du CDN quand aucune image n’est publiée', () => {
    const nue: ImageSource = { scryfallId: EN_ID };
    expect(cardImageUrl({ card: nue, language: 'en', version: 'small' })).toBe(
      `https://cards.scryfall.io/small/front/1/1/${EN_ID}.jpg`,
    );
  });

  it('ne rend jamais autre chose qu’une URL Scryfall', () => {
    const urls = [
      cardImageUrl({ card: anglaise, localized: française, language: 'fr' }),
      cardImageUrl({ card: anglaise, language: 'fr' }),
      cardImageUrl({ card: { scryfallId: EN_ID }, language: 'en' }),
    ];
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/(cards|backs)\.scryfall\.io\//);
    }
  });
});

/**
 * Le repère « non traduite », et la garde qui l'empêche de fuir.
 *
 * Deux exigences, et la seconde est le piège de cette fonctionnalité :
 *  - il est **personnel** : il se dérive côté client, de la langue de celui qui
 *    regarde, et rien n'en part au serveur ;
 *  - il ne doit **jamais** apparaître sur une carte dont le client ignore
 *    l'identité. Un repère posé sur un dos apprendrait à son porteur que notre
 *    client en connaît l'identité — exactement ce que la visibilité décidée à
 *    l'émission interdit.
 */
describe('le repère de langue', () => {
  it("ne marque rien sur une carte dont l'identité nous est cachée", () => {
    // Le cas le plus dangereux : la résolution serait là — quelqu'un l'aurait
    // calculée à tort — et le repère devrait quand même se taire.
    const resolved = resolveCardImage({ card: anglaise, language: 'fr' });
    expect(cardLanguageMark({ identityKnown: false, resolved, language: 'fr' })).toBeNull();
    // Et sans résolution du tout, évidemment.
    expect(cardLanguageMark({ identityKnown: false, resolved: null, language: 'fr' })).toBeNull();
  });

  it('ne marque pas un « pending » : il deviendra peut-être français', () => {
    const resolved = resolveCardImage({ card: anglaise, language: 'fr' });
    expect(resolved.pending).toBe(true);
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toBeNull();
  });

  it('marque un repli définitif, et dit que c’est l’impression qui manque', () => {
    const sansTraduction: LocalizedPrinting = {
      scryfallId: EN_ID,
      language: 'en',
      fallback: true,
      pending: false,
    };
    const resolved = resolveCardImage({ card: anglaise, localized: sansTraduction, language: 'fr' });
    expect(resolved.fallbackReason).toBe('untranslated');
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toEqual({
      kind: 'untranslated',
      language: 'fr',
      setCode: null,
    });
  });

  it('distingue l’image de remplacement du simple manque de traduction', () => {
    const remplacement: LocalizedPrinting = {
      ...française,
      // La résolution a bien eu lieu — sans quoi on serait dans le cas
      // `pending`, qui ne se marque pas.
      pending: false,
      imageStatus: 'placeholder',
    };
    const resolved = resolveCardImage({ card: anglaise, localized: remplacement, language: 'fr' });
    expect(resolved.fallbackReason).toBe('unusableImage');
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })?.kind).toBe(
      'unusableImage',
    );
  });

  it('ne marque jamais rien pour un joueur anglophone', () => {
    // Pour lui, rien n'est « non traduit » : le catalogue est anglais.
    const resolved = resolveCardImage({ card: anglaise, language: 'en' });
    expect(resolved.fallback).toBe(false);
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'en' })).toBeNull();
  });

  it('ne marque rien quand la traduction est bien là', () => {
    const resolved = resolveCardImage({ card: anglaise, localized: française, language: 'fr' });
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toBeNull();
  });
});

/**
 * L'édition de substitution : un réglage d'**affichage**, jamais un défaut.
 */
describe('l’impression de substitution', () => {
  const AUTRE_ID = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';

  /** Une carte sans impression française **ici**, mais française ailleurs. */
  const avecSubstitution: LocalizedPrinting = {
    scryfallId: EN_ID,
    language: 'en',
    fallback: true,
    pending: false,
    substitute: {
      scryfallId: AUTRE_ID,
      setCode: 'clb',
      imageUris: { large: 'https://cards.scryfall.io/large/front/7/7/fr-clb.jpg' },
      imageStatus: 'highres_scan',
    },
  };

  it('ne la sert pas tant qu’on ne l’a pas demandée', () => {
    const resolved = resolveCardImage({ card: anglaise, localized: avecSubstitution, language: 'fr' });
    expect(resolved.substituted).toBe(false);
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
  });

  it('la sert quand le joueur l’a demandée, et le signale', () => {
    const resolved = resolveCardImage({
      card: anglaise,
      localized: avecSubstitution,
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/front/7/7/fr-clb.jpg');
    // L'illustration **est** française : ce n'est pas un repli.
    expect(resolved.language).toBe('fr');
    expect(resolved.fallback).toBe(false);
    expect(resolved.substituted).toBe(true);
    // Le repère sert alors une seconde fois : il dit que l'image affichée et
    // l'impression choisie ont divergé, et de quelle édition elle vient.
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toEqual({
      kind: 'substituted',
      language: 'fr',
      setCode: 'clb',
    });
  });

  it('ne substitue jamais sur une carte dont l’identité nous est cachée', () => {
    const resolved = resolveCardImage({
      card: anglaise,
      localized: avecSubstitution,
      language: 'fr',
      allowSubstitute: true,
    });
    expect(cardLanguageMark({ identityKnown: false, resolved, language: 'fr' })).toBeNull();
  });

  it('refuse une substitution qui n’est qu’une image de remplacement', () => {
    const resolved = resolveCardImage({
      card: anglaise,
      localized: {
        ...avecSubstitution,
        substitute: { ...avecSubstitution.substitute!, imageStatus: 'placeholder' },
      },
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.substituted).toBe(false);
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
  });

  it('ne sort toujours que des URL Scryfall', () => {
    const resolved = resolveCardImage({
      card: anglaise,
      localized: avecSubstitution,
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.url).toMatch(/^https:\/\/cards\.scryfall\.io\//);
  });
});

/**
 * La substitution pour cause de **netteté**, et son garde-fou.
 *
 * Retour de l'utilisateur, mot pour mot : « pourquoi certaines cartes sont
 * encore en "basse résolution" ». Son option de substitution était cochée, et
 * la carte — *Sanctuaire des séraphins* — s'affichait bien en français, mais
 * floue. Le trou était double : le serveur ne cherchait de substitution que sur
 * un 404, et **le client n'aurait de toute façon jamais regardé celle-ci**.
 * `lowres` fait partie des statuts affichables, donc `resolveCardImage` rendait
 * le scan mou et sortait avant même d'ouvrir `substitute`.
 *
 * Mesuré sur la base : 128 lignes françaises sur 836 sont servies floues alors
 * qu'une impression française nette existe ailleurs — une carte sur sept.
 *
 * Le garde-fou compte autant que la règle : on ne bouge que **vers** un
 * `highres_scan` et seulement **depuis** une image qui n'en est pas une.
 * Remplacer un flou par un autre flou ferait perdre au joueur l'illustration
 * qu'il a choisie contre rien.
 */
describe('la substitution pour cause de netteté', () => {
  const NETTE_ID = '99999999-8888-7777-6666-555555555555';

  /** L'impression française de l'édition choisie : présente, mais molle. */
  const floue = (over: Partial<LocalizedPrinting> = {}): LocalizedPrinting => ({
    scryfallId: EN_ID,
    language: 'fr',
    fallback: false,
    pending: false,
    localizedScryfallId: FR_ID,
    imageUris: { large: 'https://cards.scryfall.io/large/front/a/a/fr.jpg' },
    imageStatus: 'lowres',
    substitute: {
      scryfallId: NETTE_ID,
      setCode: 'soc',
      imageUris: { large: 'https://cards.scryfall.io/large/front/9/9/fr-soc.jpg' },
      imageStatus: 'highres_scan',
    },
    ...over,
  });

  it("sert l'édition nette quand le joueur a coché l'option, et le signale", () => {
    const resolved = resolveCardImage({
      card: anglaise,
      localized: floue(),
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/front/9/9/fr-soc.jpg');
    // L'illustration reste française : ce n'est pas un repli, c'est une
    // divergence d'édition — et le repère la nomme.
    expect(resolved.language).toBe('fr');
    expect(resolved.fallback).toBe(false);
    expect(resolved.substituted).toBe(true);
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toEqual({
      kind: 'substituted',
      language: 'fr',
      setCode: 'soc',
    });
  });

  it("garde le scan mou quand l'option n'est pas cochée", () => {
    // L'édition affichée est celle que le joueur a choisie, point. Sans l'option,
    // rien ne diverge et rien ne se marque.
    const resolved = resolveCardImage({ card: anglaise, localized: floue(), language: 'fr' });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/front/a/a/fr.jpg');
    expect(resolved.substituted).toBe(false);
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toBeNull();
  });

  it("ne bouge pas quand l'image servie est déjà nette", () => {
    // Le test le plus important des trois : il n'y a rien à gagner, et
    // l'illustration choisie à perdre. Sans lui, la substitution deviendrait le
    // cas **normal** au lieu du rattrapage qu'elle est.
    const resolved = resolveCardImage({
      card: anglaise,
      localized: floue({ imageStatus: 'highres_scan', highresImage: true }),
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/front/a/a/fr.jpg');
    expect(resolved.substituted).toBe(false);
  });

  it("ne remplace pas un flou par un autre flou", () => {
    const resolved = resolveCardImage({
      card: anglaise,
      localized: floue({
        substitute: {
          scryfallId: NETTE_ID,
          setCode: 'soc',
          imageUris: { large: 'https://cards.scryfall.io/large/front/9/9/fr-soc.jpg' },
          imageStatus: 'lowres',
        },
      }),
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/front/a/a/fr.jpg');
    expect(resolved.substituted).toBe(false);
  });

  it("redescend sur le français mou si la substitution n'a pas cette face", () => {
    // Le piège du repli : ne pas retomber sur l'**anglais** pour une carte dont
    // la version française s'affiche parfaitement, sous prétexte qu'une édition
    // plus nette n'avait pas de verso.
    const dfc: ImageSource = {
      scryfallId: EN_ID,
      imageUris: null,
      faces: [
        { name: 'recto', imageUris: { large: 'https://cards.scryfall.io/large/front/1/1/en.jpg' } },
        { name: 'verso', imageUris: { large: 'https://cards.scryfall.io/large/back/1/1/en.jpg' } },
      ],
    };
    const resolved = resolveCardImage({
      card: dfc,
      localized: floue({
        imageUris: null,
        faces: [
          { imageUris: { large: 'https://cards.scryfall.io/large/front/a/a/fr.jpg' } },
          { imageUris: { large: 'https://cards.scryfall.io/large/back/a/a/fr.jpg' } },
        ],
        substitute: {
          scryfallId: NETTE_ID,
          setCode: 'soc',
          imageUris: null,
          faces: [{ imageUris: { large: 'https://cards.scryfall.io/large/front/9/9/fr-soc.jpg' } }],
          imageStatus: 'highres_scan',
        },
      }),
      language: 'fr',
      allowSubstitute: true,
      face: 1,
    });
    expect(resolved.url).toBe('https://cards.scryfall.io/large/back/a/a/fr.jpg');
    expect(resolved.language).toBe('fr');
    expect(resolved.substituted).toBe(false);
  });
});

/**
 * Les terrains de base : ni substitution, ni repère.
 *
 * Demande de l'utilisateur, mot pour mot : « pour les terrains de base on se
 * fiche de la traduction ils restent dans l'edition initial sans warning mais
 * uniquement les terrains de bases ».
 *
 * La raison vaut mieux que la règle : un terrain de base n'a **pas de texte à
 * lire**. L'illustration *est* la carte, et c'est souvent pour elle qu'une
 * édition est choisie — les Plaines d'Amonkhet ne se remplacent pas par celles
 * d'une autre extension au nom d'une traduction dont personne n'a que faire. Et
 * un repère « non traduite » sur une Plaine n'apprend rien tout en salissant le
 * terrain, à raison de vingt ou trente exemplaires par table.
 *
 * Quelqu'un finira par vouloir « uniformiser » cette exception. C'est ce que ces
 * tests gardent — le second surtout : **uniquement** les terrains de base.
 */
describe('les terrains de base', () => {
  const AUTRE_ID = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';

  const plaine: ImageSource = { ...anglaise, typeLine: 'Basic Land — Plains' };
  /** Le piège à éviter : un dual originel **n'est pas** un terrain de base. */
  const dualOriginel: ImageSource = { ...anglaise, typeLine: 'Land — Plains Island' };

  const sansTraduction: LocalizedPrinting = {
    scryfallId: EN_ID,
    language: 'en',
    fallback: true,
    pending: false,
    substitute: {
      scryfallId: AUTRE_ID,
      setCode: 'znr',
      imageUris: { large: 'https://cards.scryfall.io/large/front/7/7/fr-znr.jpg' },
      imageStatus: 'highres_scan',
    },
  };

  it("une Plaine garde son édition et ne porte aucun repère", () => {
    const resolved = resolveCardImage({
      card: plaine,
      localized: sansTraduction,
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.basicLand).toBe(true);
    expect(resolved.substituted).toBe(false);
    expect(resolved.url).toBe('https://cards.scryfall.io/normal/front/1/1/en.jpg');
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })).toBeNull();
    // Sans l'option non plus, et c'est là que le repère aurait sinon surgi.
    const sansOption = resolveCardImage({ card: plaine, localized: sansTraduction, language: 'fr' });
    expect(cardLanguageMark({ identityKnown: true, resolved: sansOption, language: 'fr' })).toBeNull();
  });

  it("mais une carte non basique dans la même situation reçoit les deux", () => {
    const resolved = resolveCardImage({
      card: dualOriginel,
      localized: sansTraduction,
      language: 'fr',
      allowSubstitute: true,
    });
    expect(resolved.basicLand).toBe(false);
    expect(resolved.substituted).toBe(true);
    expect(resolved.substituteSetCode).toBe('znr');
    expect(cardLanguageMark({ identityKnown: true, resolved, language: 'fr' })?.kind).toBe(
      'substituted',
    );
    // Et sans l'option, c'est le repère « pas de version française ».
    const sansOption = resolveCardImage({
      card: dualOriginel,
      localized: sansTraduction,
      language: 'fr',
    });
    expect(cardLanguageMark({ identityKnown: true, resolved: sansOption, language: 'fr' })?.kind).toBe(
      'untranslated',
    );
  });

  it("reconnaît les terrains enneigés et Wastes, pas `Basic Creature`", () => {
    /*
     * Le critère est le supertype `Basic` **accompagné** du type `Land`, lu sur
     * la ligne de type **anglaise** du catalogue — jamais sur un
     * `printed_type_line`, qui dirait « Terrain de base » et casserait pour un
     * joueur anglophone.
     */
    const marque = (typeLine: string | undefined) =>
      resolveCardImage({
        card: { ...anglaise, ...(typeLine === undefined ? {} : { typeLine }) },
        localized: sansTraduction,
        language: 'fr',
        allowSubstitute: true,
      }).basicLand;

    expect(marque('Basic Land — Plains')).toBe(true);
    expect(marque('Basic Land')).toBe(true); // Wastes
    expect(marque('Basic Snow Land — Island')).toBe(true);
    // `Basic` seul ne suffit pas, et `Land` seul non plus.
    expect(marque('Basic Creature — Shapeshifter')).toBe(false);
    expect(marque('Land — Plains Island')).toBe(false);
    expect(marque('Land')).toBe(false);
    // Métadonnées pas encore arrivées : la carte se comporte comme une carte
    // ordinaire, ce qui est le comportement d'avant cette règle.
    expect(marque(undefined)).toBe(false);
  });
});

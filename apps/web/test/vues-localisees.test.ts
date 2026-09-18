/**
 * Les vues restées en anglais, une fois branchées sur la résolution localisée.
 *
 * **Pourquoi ce fichier ne rend aucun composant.** Vitest tourne ici en
 * environnement `node` et n'accepte que des tests `.ts` : il n'y a ni DOM ni
 * JSX à notre disposition. Ce qu'on vérifie n'est donc pas un pixel, mais les
 * deux choses qui cassent réellement sur ce chantier, et qui se vérifient
 * l'une par le calcul et l'autre par la lecture des sources :
 *
 * 1. **La chaîne de repli ne laisse jamais de trou.** C'est du calcul pur :
 *    `resolveCardImage(...).url ?? scryfallImage(...)` est le motif recopié
 *    dans chaque vue, et il doit rendre une URL dans les trois situations —
 *    pas de résolution, résolution française, résolution `pending`.
 * 2. **Le nom anglais reste la clé.** C'est de la lecture : chercher, trier,
 *    enregistrer un deck, envoyer un `SET_PRINTING` continuent de passer par le
 *    nom et l'identifiant du **catalogue**. Une substitution malheureuse dans
 *    ces fichiers ne lèverait aucune exception et ne casserait pas `tsc` — elle
 *    rendrait simplement « Sol Ring » introuvable pour un joueur français, ce
 *    que personne ne verrait avant la production.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveCardImage } from '../src/lib/i18n/cardImage.js';
import { scryfallImage } from '../src/lib/cards.js';
import { localizedCardName } from '../src/lib/cardLocalization.js';

const CATALOG_ID = '00000000-0000-4000-8000-0000000000aa';
const FRENCH_ID = '00000000-0000-4000-8000-0000000000bb';

const catalogue = {
  scryfallId: CATALOG_ID,
  imageUris: { small: 'https://cards.scryfall.io/small/front/0/0/en.jpg' },
};

function source(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../src/components/${file}`, import.meta.url)),
    'utf8',
  );
}

function page(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/pages/${file}`, import.meta.url)), 'utf8');
}

/** Les vues branchées dans cette passe, plus celles qui l'étaient déjà. */
const VUES = [
  'ZonePanel.tsx',
  'PrintingPicker.tsx',
  'DeckEditor.tsx',
  'TokenSearch.tsx',
  'TokenShelf.tsx',
  'OpponentHand.tsx',
  'PublicRevealModal.tsx',
  'TablePreview.tsx',
  'PreGameDeck.tsx',
  'CardMenu.tsx',
];

/**
 * Celles qui fabriquent une URL d'illustration, et doivent donc garder le motif
 * du CDN en dernier recours.
 *
 * `ZonePanel` et `PreGameDeck` n'en sont pas : ils n'affichent que des noms —
 * les vignettes du premier sont des `CardSprite`, le second est une liste de
 * deck. `CardMenu` non plus : c'est un menu, il n'a pas une seule image.
 */
const VUES_AVEC_IMAGE = VUES.filter(
  (f) => !['ZonePanel.tsx', 'PreGameDeck.tsx', 'CardMenu.tsx'].includes(f),
);

describe('le repli ne laisse jamais de trou', () => {
  it('rend le catalogue quand aucune résolution n’est encore arrivée', () => {
    const url =
      resolveCardImage({ card: catalogue, language: 'fr', version: 'small' }).url ??
      scryfallImage(CATALOG_ID, 'small');
    expect(url).toBe(catalogue.imageUris.small);
  });

  it('rend l’impression française quand elle est là', () => {
    const url =
      resolveCardImage({
        card: catalogue,
        localized: {
          scryfallId: CATALOG_ID,
          localizedScryfallId: FRENCH_ID,
          language: 'fr',
          imageUris: { small: 'https://cards.scryfall.io/small/front/0/0/fr.jpg' },
        },
        language: 'fr',
        version: 'small',
      }).url ?? scryfallImage(CATALOG_ID, 'small');
    expect(url).toBe('https://cards.scryfall.io/small/front/0/0/fr.jpg');
  });

  it('montre l’anglais sans trou tant que la résolution est `pending`', () => {
    const url =
      resolveCardImage({
        card: catalogue,
        localized: { scryfallId: CATALOG_ID, language: 'en', fallback: true, pending: true },
        language: 'fr',
        version: 'small',
      }).url ?? scryfallImage(CATALOG_ID, 'small');
    expect(url).toBe(catalogue.imageUris.small);
  });

  it('retombe sur le motif du CDN quand la carte n’a aucune image publiée', () => {
    const url =
      resolveCardImage({ card: { scryfallId: CATALOG_ID }, language: 'fr', version: 'small' })
        .url ?? scryfallImage(CATALOG_ID, 'small');
    expect(url).toBe(scryfallImage(CATALOG_ID, 'small'));
  });

  it('ne rend jamais autre chose qu’une URL Scryfall', () => {
    for (const language of ['fr', 'en'] as const) {
      const url =
        resolveCardImage({ card: { scryfallId: CATALOG_ID }, language, version: 'small' }).url ??
        scryfallImage(CATALOG_ID, 'small');
      expect(url.startsWith('https://cards.scryfall.io/')).toBe(true);
    }
  });
});

describe('le nom affiché', () => {
  it('prend le nom imprimé quand il existe', () => {
    expect(
      localizedCardName(
        { scryfallId: CATALOG_ID, language: 'fr', name: 'Sol Ring', printedName: 'Anneau solaire' },
        'Sol Ring',
      ),
    ).toBe('Anneau solaire');
  });

  it('retombe en silence sur l’anglais — le cas courant, pas un incident', () => {
    expect(
      localizedCardName(
        { scryfallId: CATALOG_ID, language: 'en', fallback: true, name: 'Sol Ring' },
        'Sol Ring',
      ),
    ).toBe('Sol Ring');
  });
});

describe('les vues consomment bien la résolution', () => {
  it.each(VUES)('%s lit le cache localisé', (file) => {
    const code = source(file);
    expect(code).toContain('cardLocalization.js');
    expect(code).toContain('useLocalizationTick()');
  });

  it.each(VUES_AVEC_IMAGE)('%s garde le motif du CDN en dernier recours', (file) => {
    expect(source(file)).toContain('scryfallImage(');
  });

  it.each(VUES_AVEC_IMAGE)('%s passe par `resolveCardImage` avant le repli', (file) => {
    const code = source(file);
    expect(code).toContain('resolveCardImage(');
    // Le repli est un `??`, pas une branche : sans résolution l'anglais est déjà
    // là, et rien ne clignote entre les deux.
    expect(code).toMatch(/\.url \?\?\s*scryfallImage\(/);
  });

  it('ZonePanel laisse l’illustration à CardSprite et ne traduit que l’étiquette', () => {
    const code = source('ZonePanel.tsx');
    expect(code).toContain('<CardSprite');
    expect(code).not.toContain('scryfallImage(');
    expect(code).toContain('localizedCardName(');
  });

  it('Hand passe par CardSprite, qui est déjà branché', () => {
    const code = source('Hand.tsx');
    expect(code).toContain('<CardSprite');
    // Rien à brancher ici : la main locale ne fabrique aucune URL elle-même.
    expect(code).not.toContain('scryfallImage(');
  });
});

describe('le nom anglais reste la clé de recherche et d’envoi', () => {
  it('ZonePanel interroge le nom du catalogue **et** le nom imprimé', () => {
    // L'attente d'origine — le filtre sur le seul nom du catalogue — est
    // devenue le défaut : elle rendait « Anneau solaire » introuvable en tapant
    // « Anneau », c'est-à-dire ce que le panneau affiche. Ce qui reste gardé,
    // c'est que le nom du catalogue soit toujours **l'un des deux**.
    const code = source('ZonePanel.tsx');
    expect(code).toContain('const catalogue = cardName(card.scryfallId);');
    expect(code).toContain('matchesCardQuery(');
    expect(code).not.toContain('cardName(card.scryfallId).toLowerCase().includes(');
  });

  it('TokenSearch interroge la base avec la saisie, sans la traduire', () => {
    expect(source('TokenSearch.tsx')).toContain(
      '`/api/cards/search?q=${encodeURIComponent(query)}&type=${tokensOnly ? \'token\' : \'card\'}`',
    );
  });

  it('DeckEditor cherche avec la saisie et enregistre le nom du catalogue', () => {
    const code = source('DeckEditor.tsx');
    expect(code).toContain('`/api/cards/search?q=${encodeURIComponent(query)}&type=card`');
    // La ligne du payload de `save()` : c'est `r.name`, anglais, que le parseur
    // du serveur résout. Un nom imprimé ici ferait échouer tout le deck.
    expect(code).toContain('name: r.name,');
  });

  it('PrintingPicker envoie l’identifiant du catalogue, jamais celui de l’impression traduite', () => {
    const code = source('PrintingPicker.tsx');
    expect(code).toContain('scryfallId: printing.scryfallId,');
    expect(code).not.toContain('localizedScryfallId');
  });
});

describe('l’éventail adverse n’est pas défait', () => {
  const code = source('OpponentHand.tsx');

  it('garde ses repères de recette', () => {
    expect(code).toContain('data-test="opponent-hand"');
    expect(code).toContain("data-test={known ? 'revealed-hand-card' : undefined}");
  });

  it('compte toujours par `zoneCounts`, jamais par `seat.handCount`', () => {
    expect(code).toContain('const handCount = useGame((s) => s.zoneCounts.get(`${seat.id}|HAND`)');
    // Le commentaire du fichier nomme `seat.handCount` pour dire de ne pas s'en
    // servir : c'est une **lecture** du champ qu'on refuse, pas sa mention.
    expect(code).not.toMatch(/=\s*seat\.handCount/);
  });

  it('ne résout l’image que des cartes montrées', () => {
    // La résolution est dans la branche `known`, après le `CardBack` des dos :
    // un dos n'a pas d'identité connue de ce client, il n'y a rien à demander.
    expect(code).toContain('localizedCard(known.scryfallId, language)');
    expect(code).toContain('<CardBack url={seat.cardBackUrl} version="small" />');
  });
});

describe('l’hydratation rejouée après connexion', () => {
  const code = page('Auth.tsx');

  it('relit la préférence du compte sans recharger la page', () => {
    // La page passe par `rehydrate()`, le chemin explicite du store, et ne
    // lève plus son drapeau `hydrated` de l'extérieur : remettre à zéro l'état
    // interne d'un store depuis un écran est le genre de raccourci qui survit
    // à la refonte dudit store, et casse en silence.
    expect(code).toContain('void usePrefs.getState().rehydrate();');
    expect(code).not.toContain('usePrefs.setState(');
  });

  it('passe par la fonction publique du store, sans second mécanisme', () => {
    // Pas d'appel direct à `/api/me` ni de `setLanguage` déguisé : le chemin de
    // lecture reste celui du store, et il n'y a qu'un appel réseau. Le
    // commentaire du fichier a le droit de nommer la route ; le code, non.
    expect(code).not.toMatch(/api\.(get|post|patch|put)[^\n]*api\/me/);
    expect(code).not.toContain('setLanguage(');
  });
});

describe('la révélation publique n’a pas de repli visible', () => {
  const code = source('PublicRevealModal.tsx');

  it('résout l’image et le nom de chaque carte montrée', () => {
    expect(code).toContain('localizedCard(card.scryfallId, language)');
    expect(code).toContain('localizedCardName(localized, meta?.name)');
  });

  it('garde ses repères de recette', () => {
    expect(code).toContain('data-test="public-reveal-modal"');
    expect(code).toContain('data-test="public-reveal-reopen"');
    expect(code).toContain('data-test="public-reveal-close"');
    expect(code).toContain('data-test={`public-revealed-card-${card.id}`}');
  });

  it('ne pose ni pastille ni avertissement de repli', () => {
    // Le drapeau `fallback` de la résolution existe ; ne pas le lire est le
    // choix, et c'est ce choix que ce test garde.
    expect(code).not.toContain('fallback');
  });
});

describe('la liste d’avant-partie affiche le français et trie sur l’anglais', () => {
  const code = source('PreGameDeck.tsx');

  it('regroupe et ordonne sur le nom du catalogue', () => {
    // `name` est la clé : c'est lui qui regroupe les exemplaires et ordonne la
    // liste. Le trier sur le nom imprimé ferait sauter les lignes sous les
    // doigts du joueur, à mesure que les lots de résolution rentrent.
    expect(code).toContain("cardName(card.scryfallId) : '…'");
    expect(code).toContain("a.name.localeCompare(b.name, 'fr')");
  });

  it('filtre sur les deux noms, comme le panneau de zone', () => {
    // Même correction qu'au panneau de zone : la liste affiche `label`, le
    // filtre doit donc y répondre — sans perdre `name`, qu'on recopie des
    // listes de deck anglaises.
    expect(code).toContain('matchesCardQuery(filter, stack.name, stack.label)');
  });

  it('n’affiche que le libellé traduit', () => {
    expect(code).toContain('{stack.label}');
    expect(code).toContain('localizedCardName(localizedCard(scryfallId, language), name) ?? name');
  });

  it('n’a aucune illustration à résoudre : c’est une liste de deck', () => {
    expect(code).not.toContain('<img');
  });

  it('envoie toujours un identifiant d’objet au serveur, jamais un nom', () => {
    // `MOVE_CARD` porte `cardId` : le nom, traduit ou non, ne traverse pas le
    // socket. C'est la même famille de règle que `DeckEditor.save()`.
    expect(code).toContain('cardId: id,');
  });
});

describe('la vitrine publique montre les cartes du visiteur', () => {
  const code = source('TablePreview.tsx');

  it('résout l’illustration de chaque vignette', () => {
    expect(code).toContain('localized: localizedCard(card.scryfallId, language)');
  });

  it('interroge toujours l’index avec le nom anglais de la scène', () => {
    // La scène est écrite en anglais dans le fichier, et c'est ce texte-là que
    // `/api/cards/search` sait résoudre : le traduire viderait la vitrine.
    expect(code).toContain("{ query: 'Fabled Passage', tapped: true }");
    expect(code).toContain(
      '`/api/cards/search?q=${encodeURIComponent(query)}&type=card&limit=1`',
    );
  });

  it('laisse le journal de la scène tel qu’il est écrit à la main', () => {
    // Ce n'est pas un vrai journal : ses phrases sont du décor. Y glisser un
    // nom français au milieu d'une phrase anglaise ferait un faux pire.
    expect(code).toContain('from library to battlefield');
  });
});

describe('le menu de carte ne traduit que son titre', () => {
  const code = source('CardMenu.tsx');

  it('affiche le nom imprimé en tête du menu', () => {
    expect(code).toContain('localizedCardName(');
    // Le repli reste « Carte face cachée » — mais la chaîne vit désormais dans
    // le catalogue (`card.faceDown`), pas dans le composant. Ce qui est gardé
    // ici est donc le **repli lui-même** : sans lui, une carte face cachée
    // ouvrirait un menu sans titre. Le texte, lui, est verrouillé côté
    // catalogue par `i18n-traduction.test.ts`.
    expect(code).toContain("t('card.faceDown')");
  });

  it('n’a pas une seule illustration à résoudre', () => {
    expect(code).not.toContain('<img');
  });

  it('range le jeton sur l’étagère sous son nom de catalogue', () => {
    // L'étagère garde une identité, pas un libellé : un nom imprimé s'y
    // figerait, et changer de langue rendrait le jeton méconnaissable.
    expect(code).toContain('shelveToken({ scryfallId: card.scryfallId, name: cardName(card.scryfallId) })');
  });

  it('laisse intacte la boîte « Poser un marqueur »', () => {
    // `frozenCount`, `frozenCounterIntents` et `parseOffset` viennent d'être
    // extraits pour clore le bug des deux marqueurs : ils restent importés, et
    // rien n'a été recopié ici.
    for (const nom of ['frozenCount', 'frozenCounterIntents', 'parseOffset']) {
      expect(code).toContain(`  ${nom},`);
    }
  });
});

describe('le journal reste dans la langue du serveur, et c’est délibéré', () => {
  const code = source('ActionLog.tsx');

  it('ne localise pas les noms du dépliage', () => {
    /*
     * Le `text` d'une ligne est une phrase **française fabriquée par le
     * serveur**, avec les noms de cartes cuits dedans en anglais. Or une ligne
     * n'est dépliable qu'au-delà de `NAMED_LOG_LIMIT`, donc précisément quand
     * le serveur en a déjà nommé six : traduire le dépliage montrerait la même
     * carte sous deux noms à deux lignes d'écart. Le jour où le serveur
     * publiera des ancres au lieu d'une phrase cuite, ce test tombera — et ce
     * sera la bonne raison de le changer.
     */
    expect(code).not.toContain('cardLocalization.js');
    expect(code).not.toContain('useLanguage');
  });

  it('n’a pas de chemin d’accès omniscient : le store, et rien d’autre', () => {
    // Le détail est vérifié par `journal-depliage.test.ts` ; on garde ici la
    // forme, qui est ce qu'une refonte casserait en premier.
    expect(code).toContain('const vue = cards.get(id);');
    expect(code).toContain('if (!vue || vue.faceDown) return CARTE_ANONYME;');
    expect(code).toContain('return nomDeMeta(vue.scryfallId) ?? CARTE_ANONYME;');
  });

  it('lit le seuil dans `@mtg/shared`, sans le recopier', () => {
    expect(code).toContain("NAMED_LOG_LIMIT, type CardView, type ObjectId } from '@mtg/shared'");
    // Le seuil s'applique au **lot**, pas aux seules ancres : une cascade n'en
    // laisse qu'une pour neuf cartes, et compter les ancres ferait disparaître
    // le bouton exactement là où il sert (§5.4, `LogEntry.names`).
    expect(code).toContain('(names ?? cardIds).length > NAMED_LOG_LIMIT');
  });

  it('dérive les noms dans un `useMemo`, jamais dans un sélecteur', () => {
    // Un sélecteur zustand qui construit un tableau n'est jamais égal à
    // lui-même : React boucle et lève le #185.
    expect(code).toContain('const cards = useGame((s) => s.cards);');
    expect(code).toContain('const noms = useMemo(');
  });
});

describe('l’invariant de droits tient dans les vues branchées', () => {
  it.each([...VUES, 'Hand.tsx'])('%s ne copie aucune illustration', (file) => {
    const code = source(file);
    // Un cache est une copie : pas de `new Image()`, pas de préchargement, rien
    // qui mette une jaquette de Wizards ailleurs que dans le navigateur.
    expect(code).not.toContain('new Image(');
    expect(code).not.toContain('rel="preload"');
    expect(code).not.toContain('fetch(');
  });
});

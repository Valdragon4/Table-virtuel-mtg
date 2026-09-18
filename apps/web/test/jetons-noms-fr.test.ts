/**
 * Le glossaire des noms de jetons.
 *
 * Ce qu'il faut verrouiller ici n'est pas « la traduction est jolie » — c'est
 * que le nom **anglais reste la clé** et que rien ne se traduit à moitié.
 * Scryfall ne publie aucun jeton hors anglais : la traduction est la nôtre, elle
 * n'a donc aucun filet côté serveur, et c'est ce fichier qui en tient lieu.
 */
import { describe, expect, it } from 'vitest';
import { cardLanguageMark, resolveCardImage } from '../src/lib/i18n/cardImage.js';
import {
  NON_VERIFIES,
  TERMES_LAISSES_EN_ANGLAIS,
  TOKEN_NAMES_FR,
  isTokenForNaming,
  isTokenTypeLine,
  tokenName,
  tokenQueryAliases,
} from '../src/lib/i18n/tokenNames.js';
import { readFileSync } from 'node:fs';
import { foldForSearch } from '../src/components/Dialog.js';
import { tokenBandName } from '../src/components/TokenNameBand.js';

const ID = '11111111-2222-3333-4444-555555555555';

describe('le glossaire des jetons', () => {
  it('rend le terme français officiel, pas une traduction de dictionnaire', () => {
    expect(tokenName('Soldier', 'fr')).toBe('Soldat');
    expect(tokenName('Spirit', 'fr')).toBe('Esprit');
    expect(tokenName('Treasure', 'fr')).toBe('Trésor');
    expect(tokenName('Clue', 'fr')).toBe('Indice');
    expect(tokenName('Food', 'fr')).toBe('Nourriture');
    expect(tokenName('Blood', 'fr')).toBe('Sang');
    expect(tokenName('Saproling', 'fr')).toBe('Saprobionte');
    expect(tokenName('Wurm', 'fr')).toBe('Guivre');
  });

  /*
   * Les deux mots que la **seconde** source a corrigés, et eux seuls.
   *
   * Ils ne sont pas des sous-types : aucune ligne de type française ne les
   * porte, et le relevé qui a bâti le gros du glossaire ne pouvait donc pas les
   * voir. Ce qui était écrit là — la traduction littérale, celle qu'on devine —
   * avait l'air juste, ce qui est précisément pourquoi elle avait tenu si
   * longtemps. Ces deux lignes figent le mot **imprimé** et, surtout, refusent
   * nommément celui qu'on retrouverait de mémoire.
   */
  it('garde le mot imprimé là où la traduction devinée avait l’air juste', () => {
    expect(tokenName('Powerstone', 'fr')).toBe('Lithoforce');
    expect(tokenName('Powerstone', 'fr')).not.toBe('Pierre de puissance');
    expect(tokenName("City's Blessing", 'fr')).toBe("L'agrément de la cité");
    expect(tokenName("City's Blessing", 'fr')).not.toBe('La bénédiction de la cité');
  });

  /*
   * Ce que la seconde source a **prouvé** — la carte française qui crée le
   * jeton le nomme dans son texte. Ces entrées étaient auparavant dans
   * `NON_VERIFIES` ; les figer ici est ce qui empêche qu'on les y remette faute
   * de savoir qu'elles ont été relevées.
   */
  it('nomme les jetons que seule la carte qui les crée désigne', () => {
    // Des types de créature qui n'existent qu'en jeton : aucune carte ordinaire
    // ne les imprime sur sa ligne de type.
    expect(tokenName('Germ', 'fr')).toBe('Germe');
    expect(tokenName('Servo', 'fr')).toBe('Servo');
    expect(tokenName('Tentacle', 'fr')).toBe('Tentacule');
    expect(tokenName('Army', 'fr')).toBe('Armée');
    expect(tokenName('Serf', 'fr')).toBe('Serf');
    expect(tokenName('Hero', 'fr')).toBe('Héros');
    expect(tokenName('Naga', 'fr')).toBe('Naga');
    // Et ce qui n'est sous-type de rien.
    expect(tokenName('Gold', 'fr')).toBe('Or');
    expect(tokenName('Incubator', 'fr')).toBe('Incubateur');
    expect(tokenName('Copy', 'fr')).toBe('Copie');
    expect(tokenName('Emblem', 'fr')).toBe('Emblème');
  });

  /*
   * L'article, et pourquoi il n'est pas une inconstance.
   *
   * Partout ailleurs le glossaire rend le mot nu — « Soldat », « Trésor ». Ces
   * deux-là le gardent parce qu'ils ne nomment pas une espèce mais un statut
   * unique de la partie : il n'y a qu'un monarque à la fois, et l'anglais porte
   * déjà l'article dans la clé.
   */
  it('garde l’article des deux statuts uniques, et de ceux-là seulement', () => {
    expect(tokenName('The Monarch', 'fr')).toBe('Le monarque');
    expect(tokenName("City's Blessing", 'fr')).toMatch(/^L['’]/);
    expect(tokenName('Treasure', 'fr')).toBe('Trésor');
    expect(tokenName('Soldier', 'fr')).toBe('Soldat');
  });

  it("ne touche à rien en anglais : le catalogue *est* anglais", () => {
    expect(tokenName('Soldier', 'en')).toBe('Soldier');
    expect(tokenName('Elf Warrior', 'en')).toBe('Elf Warrior');
  });

  it('compose les types empilés comme la ligne de type française les joint', () => {
    expect(tokenName('Elf Warrior', 'fr')).toBe('Elfe et Guerrier');
    expect(tokenName('Human Soldier', 'fr')).toBe('Humain et Soldat');
    expect(tokenName('Zombie Army', 'fr')).toBe('Zombie et Armée');
  });

  it("ne traduit jamais à moitié : un terme inconnu laisse le nom entier en anglais", () => {
    /*
     * L'exemple était « Eldrazi Spawn » tant que « Spawn » manquait au
     * glossaire. La seconde source l'a prouvé (« engeance »), comme Scion,
     * Inkling, Junk et Wraith : **plus aucun nom composé réel n'a de moitié
     * inconnue**, ce qui est une bonne nouvelle et prive ce test d'exemple
     * authentique.
     *
     * Le type inventé ci-dessous l'assume : la règle ne garde pas un cas
     * d'aujourd'hui, elle garde le jour où Wizards publiera un type que le
     * glossaire ne connaît pas encore. « Eldrazi et Skyrunner » serait alors
     * illisible autant que méconnaissable.
     */
    expect(tokenName('Eldrazi Skyrunner', 'fr')).toBe('Eldrazi Skyrunner');
    // Et un nom entier inconnu reste entier, lui aussi : « Map » est un refus
    // délibéré, la source existe mais « Carte » se confondrait à l'écran.
    expect(tokenName('Map', 'fr')).toBe('Map');
  });

  it('laisse les noms propres tranquilles', () => {
    expect(tokenName('Marit Lage', 'fr')).toBe('Marit Lage');
    expect(tokenName('Ragavan', 'fr')).toBe('Ragavan');
  });

  it('traduit un nom recto-verso face par face, sans jamais les joindre', () => {
    /*
     * Les deux moitiés d'un « // » sont des **faces**, pas des types empilés :
     * elles ne se joignent donc jamais par « et ». C'est ce que fige la ligne
     * ci-dessous, et ce n'est pas la même chose que « on n'y touche pas » :
     * chaque face est un nom de jeton à part entière, et un jeton Ange
     * recto-verso doit se lire « Ange // Ange » comme celui d'à côté se lit
     * « Ange ».
     *
     * « Punchcard » n'est pas au glossaire — ni l'une ni l'autre face —, donc
     * le nom entier reste anglais, tel quel, séparateur compris.
     */
    expect(tokenName('Punchcard // Punchcard', 'fr')).toBe('Punchcard // Punchcard');
    expect(tokenName('Angel // Angel', 'fr')).toBe('Ange // Ange');
    expect(tokenName('Human Soldier // Zombie', 'fr')).toBe('Humain et Soldat // Zombie');
    // Tout ou rien, comme ailleurs : une face inconnue laisse le nom entier en
    // anglais plutôt que de rendre « Ange // Eldrazi Skyrunner ». Type inventé,
    // pour la raison dite plus haut : aucun réel n'est plus inconnu.
    expect(tokenName('Angel // Eldrazi Skyrunner', 'fr')).toBe('Angel // Eldrazi Skyrunner');
  });

  it('ne confond pas deux types anglais distincts', () => {
    // « Serpent » et « Snake » sont deux types différents, et le français aussi.
    expect(tokenName('Snake', 'fr')).toBe('Serpent');
    expect(tokenName('Serpent', 'fr')).toBe('Grand serpent');
  });

  it("n'écrit que des noms : aucune entrée ne ressemble à un texte de règles", () => {
    // L'invariant de droits (`docs/i18n.md` §5) tient ici à une propriété
    // vérifiable : un nom est court et sans ponctuation de phrase.
    for (const fr of Object.values(TOKEN_NAMES_FR)) {
      expect(fr.length).toBeLessThan(40);
      expect(fr).not.toMatch(/[.;:]/);
    }
  });

  it('rend une chaîne vide ou absente telle quelle plutôt que de lever', () => {
    expect(tokenName(null, 'fr')).toBeNull();
    expect(tokenName(undefined, 'fr')).toBeNull();
    expect(tokenName('', 'fr')).toBe('');
  });
});

/**
 * Les deux tables documentaires — celles que **personne ne lit à l'exécution**.
 *
 * Leur seule raison d'être est d'empêcher qu'on comble le glossaire de mémoire,
 * et une table documentaire pourrit en silence : rien ne casse quand une entrée
 * y reste alors qu'elle a été relevée, ou qu'elle en sort sans avoir été
 * traduite. Ces trois lignes sont le seul garde-fou qu'elles auront jamais.
 */
describe('les tables qui disent ce qu’on ne sait pas', () => {
  it('ne consigne comme non vérifiée qu’une entrée réellement traduite', () => {
    // L'inverse serait absurde : une entrée qui n'est pas au glossaire n'a rien
    // à faire dans la liste de ce qu'on y laisse sans garantie.
    for (const en of Object.keys(NON_VERIFIES)) {
      expect(TOKEN_NAMES_FR[en]).toBeTruthy();
    }
  });

  it('ne laisse pas en anglais ce qu’il traduit par ailleurs', () => {
    // Les deux tables disent des choses contraires ; se recouvrir les rendrait
    // toutes deux ininterprétables.
    for (const en of Object.keys(TERMES_LAISSES_EN_ANGLAIS)) {
      expect(TOKEN_NAMES_FR[en]).toBeUndefined();
      expect(NON_VERIFIES[en]).toBeUndefined();
    }
  });

  it('dit pour chacune ce qui a été cherché, et non « non vérifié »', () => {
    /*
     * Une raison courte est une raison qui n'en est pas une : « terme non
     * vérifié » ne dit pas si quelqu'un a cherché, et le prochain recommencera
     * la recherche ou, pire, comblera l'entrée de mémoire.
     *
     * Le second `expect` est l'invariant de droits (`docs/i18n.md` §5) appliqué
     * ici : ces raisons **citent des cartes par leur nom**, ce qui est permis,
     * et jamais leur texte, ce qui ne l'est pas. Les verbes ci-dessous sont
     * ceux du gabarit de règles français — en voir un signalerait une phrase
     * recopiée.
     */
    const gabaritDeRegles = /\b(Sacrifiez|Défaussez|Piochez|Exilez|Mettez)\b/;
    for (const raison of [
      ...Object.values(NON_VERIFIES),
      ...Object.values(TERMES_LAISSES_EN_ANGLAIS),
    ]) {
      expect(raison.length).toBeGreaterThan(40);
      expect(raison).not.toMatch(gabaritDeRegles);
    }
  });
});

describe('la recherche répond aux deux noms', () => {
  it("propose l'équivalent anglais quand on tape le français", () => {
    expect(tokenQueryAliases('Soldat', foldForSearch)).toContain('Soldier');
    // Sans accent non plus : c'est le repli de comparaison du projet.
    expect(tokenQueryAliases('tresor', foldForSearch)).toContain('Treasure');
    expect(tokenQueryAliases('Bête', foldForSearch)).toContain('Beast');
  });

  it("n'ajoute rien quand la saisie est déjà anglaise : la requête brute suffit", () => {
    expect(tokenQueryAliases('Soldier', foldForSearch)).toEqual([]);
    expect(tokenQueryAliases('Treasure', foldForSearch)).toEqual([]);
  });

  it('borne le nombre de requêtes supplémentaires', () => {
    // « e » + une lettre touche une dizaine de termes ; on n'ouvre pas dix
    // requêtes HTTP pour deux caractères tapés.
    expect(tokenQueryAliases('el', foldForSearch).length).toBeLessThanOrEqual(3);
  });

  it('ignore une saisie trop courte, comme le champ lui-même', () => {
    expect(tokenQueryAliases('s', foldForSearch)).toEqual([]);
  });
});

describe('le repère de langue sur un jeton', () => {
  const jeton = {
    scryfallId: ID,
    typeLine: 'Token Creature — Soldier',
    imageUris: { large: 'https://cards.scryfall.io/large/a.jpg' },
  };

  it('reconnaît un jeton à sa ligne de type anglaise', () => {
    expect(isTokenTypeLine('Token Creature — Soldier')).toBe(true);
    expect(isTokenTypeLine('Token Artifact — Treasure')).toBe(true);
    expect(isTokenTypeLine('Creature — Soldier')).toBe(false);
    expect(isTokenTypeLine(null)).toBe(false);
  });

  /*
   * Une résolution **finale** : le serveur a cherché, Scryfall a rendu 404. Sans
   * elle on testerait `pending`, qui bloque déjà le repère pour une autre raison
   * (« pas encore cherché » n'est pas « pas de traduction »), et l'on ne saurait
   * rien de la règle des jetons.
   */
  const resolutionFinale = {
    scryfallId: ID,
    language: 'en',
    fallback: true,
    pending: false,
    localizedScryfallId: null,
  };

  it("ne s'affiche jamais : aucune édition traduite n'existe à aller chercher", () => {
    const resolu = resolveCardImage({
      card: jeton,
      localized: resolutionFinale,
      language: 'fr',
    });
    // Le repli est bien réel, et la résolution continue de le dire…
    expect(resolu.fallback).toBe(true);
    expect(resolu.token).toBe(true);
    // …mais on ne le signale pas : le repère « non traduite » inviterait à
    // changer d'édition, et il n'en existe aucune.
    expect(
      cardLanguageMark({ identityKnown: true, resolved: resolu, language: 'fr' }),
    ).toBeNull();
  });

  it("laisse le repère aux cartes ordinaires", () => {
    const carte = { ...jeton, typeLine: 'Creature — Soldier' };
    const resolu = resolveCardImage({
      card: carte,
      localized: resolutionFinale,
      language: 'fr',
    });
    expect(resolu.token).toBe(false);
    expect(
      cardLanguageMark({ identityKnown: true, resolved: resolu, language: 'fr' }),
    ).not.toBeNull();
  });
});

/**
 * Le bandeau de nom écrit **par-dessus** l'illustration d'un jeton.
 *
 * Ce qui se fige ici n'est pas la mise en forme — c'est la seule condition qui
 * ait des conséquences : **quand** un nom s'écrit. Elle est recopiée nulle part
 * ailleurs, parce qu'un bandeau qui apparaîtrait sur un dos de carte
 * apprendrait à la table que notre client, lui, connaît l'identité de la carte.
 * C'est la fuite d'information cachée la plus bête qu'on puisse écrire, et elle
 * se teste en trois lignes.
 */
describe('le bandeau de nom d’un jeton', () => {
  it('écrit le nom français quand on connaît l’identité du jeton', () => {
    const band = (name: string): string | null =>
      tokenBandName({ kind: 'TOKEN', identityKnown: true, name, language: 'fr' });
    expect(band('Treasure')).toBe('Trésor');
    expect(band('Faerie')).toBe('Peuple fée');
    expect(band('Elf Warrior')).toBe('Elfe et Guerrier');
    // Les cinq derniers venus de la seconde source, qui n'ont aucune ligne de
    // type française et n'existent qu'en jeton :
    expect(band('Eldrazi Spawn')).toBe('Eldrazi et Engeance');
    expect(band('Wraith')).toBe('Apparition');
    // Pas de traduction à moitié : l'anglais s'écrit tel quel plutôt que faux.
    expect(band('Eldrazi Skyrunner')).toBe('Eldrazi Skyrunner');
  });

  it('écrit l’anglais pour qui joue en anglais : le catalogue *est* anglais', () => {
    expect(tokenBandName({ kind: 'TOKEN', identityKnown: true, name: 'Treasure', language: 'en' })).toBe(
      'Treasure',
    );
  });

  it('ne dit rien d’une carte dont l’identité nous est cachée', () => {
    // Le cas qui compte : un jeton posé face cachée, vu d'en face. Le client
    // n'a ni nom ni `scryfallId` — mais même si on lui en tendait un, le
    // bandeau doit se taire.
    expect(
      tokenBandName({ kind: 'TOKEN', identityKnown: false, name: 'Goblin', language: 'fr' }),
    ).toBeNull();
    expect(
      tokenBandName({ kind: 'TOKEN', identityKnown: false, name: null, language: 'fr' }),
    ).toBeNull();
  });

  it('ne dit rien d’une carte qui n’est pas un jeton, quoi que dise sa ligne de type', () => {
    // C'est `kind` qui fait foi : le protocole, et non une heuristique. Une
    // carte ordinaire porte déjà son nom imprimé, et le recouvrir serait mentir
    // sur ce qui est écrit dessus.
    expect(
      tokenBandName({ kind: 'CARD', identityKnown: true, name: 'Soldier', language: 'fr' }),
    ).toBeNull();
    expect(
      tokenBandName({ kind: undefined, identityKnown: true, name: 'Soldier', language: 'fr' }),
    ).toBeNull();
  });

  it('ne dit rien plutôt que d’écrire une bande vide', () => {
    // Les métadonnées d'un jeton fraîchement créé peuvent n'être pas encore
    // arrivées : mieux vaut aucune bande qu'un rectangle noir sans texte.
    expect(tokenBandName({ kind: 'TOKEN', identityKnown: true, name: null, language: 'fr' })).toBeNull();
    expect(tokenBandName({ kind: 'TOKEN', identityKnown: true, name: '', language: 'fr' })).toBeNull();
  });
});

/**
 * **Qui** passe par le glossaire, dans l'aperçu agrandi.
 *
 * L'aperçu s'ouvre depuis deux sources qui ne se ressemblent pas : un objet de
 * partie, qui porte le `kind` du protocole, et une simple impression Scryfall —
 * vignette d'étagère, résultat de recherche de jetons, carte de « Mes decks » —
 * qui n'en a pas. La règle est testée ici une fois, plutôt que devinée deux fois
 * dans les composants.
 */
describe('nommer comme un jeton', () => {
  it('suit le protocole quand il est là : c’est `kind` qui fait foi', () => {
    expect(isTokenForNaming({ kind: 'TOKEN', typeLine: 'Creature — Angel' })).toBe(true);
    // Un jeton copie d'une carte existante n'a pas « Token » sur sa ligne.
    expect(isTokenForNaming({ kind: 'TOKEN', typeLine: null })).toBe(true);
    // Et une carte ordinaire n'en devient pas un parce que son type le dit.
    expect(isTokenForNaming({ kind: 'CARD', typeLine: 'Token Creature — Angel' })).toBe(false);
  });

  it('lit la ligne de type à défaut de protocole : une impression n’a pas de `kind`', () => {
    expect(isTokenForNaming({ typeLine: 'Token Creature — Angel' })).toBe(true);
    expect(isTokenForNaming({ kind: null, typeLine: 'Token Artifact — Treasure' })).toBe(true);
    // « Angel of Destiny » est une carte : son nom propre ne se traduit pas.
    expect(isTokenForNaming({ typeLine: 'Creature — Angel Cleric' })).toBe(false);
  });

  it('répond non dans le doute : rien n’est encore arrivé', () => {
    // Un nom de jeton qui reste une seconde en anglais se corrige au lot de
    // métadonnées suivant ; un nom de carte réécrit par le glossaire, non.
    expect(isTokenForNaming({})).toBe(false);
    expect(isTokenForNaming({ typeLine: undefined })).toBe(false);
  });
});

/**
 * L'aperçu agrandi lui-même.
 *
 * La suite tourne sans DOM (voir `apercu-mes-decks.test.ts`) : ce qui se vérifie
 * ici est que l'aperçu emprunte **le** chemin, et n'en réinvente pas un — un
 * aperçu qui dirait « Angel » sous un jeton dont le bandeau de la table dit
 * « Ange » ferait douter le joueur de l'un des deux.
 */
describe('l’aperçu agrandi nomme un jeton comme la table', () => {
  const apercu = readFileSync(
    new URL('../src/components/CardPreview.tsx', import.meta.url),
    'utf8',
  );

  it('passe le nom au glossaire, et l’`alt` avec lui', () => {
    expect(apercu).toContain('isTokenForNaming({ kind: card?.kind, typeLine: meta?.typeLine })');
    expect(apercu).toContain("estJeton ? tokenName(nomCatalogue, language) : nomCatalogue");
    // Le nom affiché *est* l'`alt` : une seule variable, pas deux chemins.
    expect(apercu).toContain('alt={shownName}');
  });

  it('n’applique pas le glossaire à une carte ordinaire', () => {
    // La condition porte sur `estJeton` et rien d'autre : pas de `tokenName`
    // appelé inconditionnellement quelque part dans le fichier.
    const appels = apercu.match(/tokenName\(/g) ?? [];
    expect(appels).toHaveLength(1);
  });

  it('ne s’abonne à rien de neuf : le plan de table ne doit pas se re-rendre', () => {
    // La recette compte les rendus du plan de table et en exige zéro ; un
    // sélecteur zustand de plus ici les ferait remonter.
    expect(apercu).not.toContain('useGame((s) => s.cards.get');
  });
});

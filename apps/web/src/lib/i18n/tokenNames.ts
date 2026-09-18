/**
 * Le glossaire des noms de jetons, et lui seul.
 *
 * **Pourquoi ce fichier existe, et pourquoi il est à part des catalogues.**
 * Scryfall ne publie **aucun** jeton dans une autre langue que l'anglais :
 * `t:token lang:fr include:extras` rend zéro résultat, et nos 3 119 impressions
 * de jetons au catalogue n'ont pas une seule ligne localisée. Il n'y a donc
 * aucun `printed_name` de jeton à aller chercher — la mécanique d'impression
 * localisée (`docs/i18n.md` §3) ne peut rien pour eux.
 *
 * **Mais il y a une source de vérité, et ce n'est pas nous.** L'immense
 * majorité des noms de jetons sont des **types de créature**, et ceux-là
 * s'impriment sur la ligne de type de n'importe quelle carte française. C'est
 * `printed_type_line` qu'on lit, sur une carte ordinaire, pas sur le jeton :
 *
 *     https://api.scryfall.com/cards/search
 *       ?q=t%3Agorgon+lang%3Afr&include_multilingual=true
 *
 * On aligne alors les sous-types anglais de `type_line` (« Creature — Gorgon
 * Warrior ») sur les sous-types français de `printed_type_line` (« Créature :
 * gorgonoïde et guerrier »), position par position, et le terme officiel tombe
 * tout seul. C'est ainsi qu'on a su que Rogue s'imprime « gredin » et non
 * « roublard », Shapeshifter « changeforme » et non « métamorphe ».
 *
 * Le glossaire porte donc une majuscule là où la ligne de type imprime une
 * minuscule : la ligne de type écrit « gorgonoïde » en cours de phrase, un nom
 * de jeton s'affiche seul. Le **mot** est celui de la carte ; seule la casse
 * est à nous.
 *
 * Et dans le doute, **on laisse l'anglais** : un nom inventé est pire qu'un nom
 * anglais, parce qu'il a l'air juste.
 *
 * **Ce n'est pas un catalogue d'interface.** `catalog.fr.ts` porte des libellés
 * d'écran, avec pluriels, interpolation et vérification à la compilation ; ici
 * ce sont des noms propres du jeu, sans paramètre, dont la clé est le nom
 * anglais du catalogue de cartes et non une clé `domaine.nom`. Les mêler aurait
 * fait entrer deux cents entrées de vocabulaire dans un fichier qui dit ce que
 * l'écran raconte.
 *
 * **Invariant de droits** (`docs/i18n.md` §5) : on n'écrit ici que des **noms**.
 * Aucun texte de règles, aucune image, aucune copie de quoi que ce soit.
 *
 * **Le nom anglais reste la clé.** Rien de ce fichier ne part au serveur, ne
 * s'enregistre dans l'étagère, ne trie une liste ni ne sert d'identité : c'est
 * un vernis d'affichage, et il doit le rester. Un nom français figé dans
 * `lib/shelf.ts` rendrait le jeton méconnaissable au premier changement de
 * langue.
 */
import type { Language } from '@mtg/shared';

/**
 * Le glossaire, clé = nom **anglais exact** du catalogue.
 *
 * Contient deux sortes d'entrées :
 *
 *  - des **termes atomiques** — les types de créature et les jetons d'artefact,
 *    qui se recomposent (voir `tokenName`) ;
 *  - quelques **noms entiers** qui n'en sont pas la somme (« The Monarch »,
 *    « City's Blessing »).
 *
 * Ce qui n'y est **pas** y manque exprès : les cas écartés sont consignés dans
 * `TERMES_LAISSES_EN_ANGLAIS`, qui dit pour chacun ce qui a manqué. Ce qui y
 * est sans avoir pu être relevé est listé dans `NON_VERIFIES`.
 */
export const TOKEN_NAMES_FR: Readonly<Record<string, string>> = {
  // --- Les jetons non-créature, ceux qu'on nomme à voix haute à chaque partie.
  Treasure: 'Trésor',
  Food: 'Nourriture',
  Clue: 'Indice',
  Blood: 'Sang',
  Gold: 'Or',
  Powerstone: 'Pierre de puissance',
  Incubator: 'Incubateur',
  Copy: 'Copie',
  Emblem: 'Emblème',
  'Energy Reserve': "Réserve d'énergie",
  // Le monarque et la bénédiction de la cité ne sont pas des créatures : leur
  // nom est une expression, pas une somme de types.
  'The Monarch': 'Le monarque',
  "City's Blessing": 'La bénédiction de la cité',

  // --- Les types de créature. Terme français officiel du jeu, pas du dictionnaire.
  Ally: 'Allié',
  Angel: 'Ange',
  Ape: 'Grand singe',
  Archer: 'Archer',
  Army: 'Armée',
  Assassin: 'Assassin',
  Avatar: 'Avatar',
  Barbarian: 'Barbare',
  Bat: 'Chauve-souris',
  Bear: 'Ours',
  Beast: 'Bête',
  Berserker: 'Berserker',
  Bird: 'Oiseau',
  Boar: 'Sanglier',
  Camel: 'Chameau',
  Cat: 'Chat',
  Centaur: 'Centaure',
  Citizen: 'Citoyen',
  Cleric: 'Clerc',
  Construct: 'Construction',
  Crab: 'Crabe',
  Crocodile: 'Crocodile',
  Cyclops: 'Cyclope',
  Demon: 'Démon',
  Devil: 'Diable',
  Dinosaur: 'Dinosaure',
  Djinn: 'Djinn',
  Dog: 'Chien',
  Dragon: 'Dragon',
  Drake: 'Drakôn',
  Druid: 'Druide',
  Dryad: 'Dryade',
  Dwarf: 'Nain',
  Efreet: 'Éfrit',
  Egg: 'Œuf',
  Eldrazi: 'Eldrazi',
  Elemental: 'Élémental',
  Elephant: 'Éléphant',
  Elf: 'Elfe',
  Elk: 'Élan',
  Faerie: 'Peuple fée',
  Ferret: 'Furet',
  Fish: 'Poisson',
  Fox: 'Renard',
  Fractal: 'Fractale',
  Frog: 'Grenouille',
  Fungus: 'Fongus',
  Gargoyle: 'Gargouille',
  Germ: 'Germe',
  Giant: 'Géant',
  Gnome: 'Gnome',
  Goat: 'Chèvre',
  Goblin: 'Gobelin',
  God: 'Dieu',
  Golem: 'Golem',
  Gorgon: 'Gorgonoïde',
  Gremlin: 'Gremlin',
  Griffin: 'Griffon',
  Harpy: 'Harpie',
  Hellion: 'Monstruosité',
  Hero: 'Héros',
  Hippo: 'Hippopotame',
  Homunculus: 'Homoncule',
  Horror: 'Horreur',
  Horse: 'Cheval',
  Human: 'Humain',
  Hydra: 'Hydre',
  Hyena: 'Hyène',
  Illusion: 'Illusion',
  Imp: 'Diablotin',
  Incarnation: 'Incarnation',
  Insect: 'Insecte',
  Jellyfish: 'Méduse',
  Juggernaut: 'Djaggernaut',
  Kavu: 'Kavru',
  Kirin: 'Kirin',
  Kithkin: 'Sangami',
  Knight: 'Chevalier',
  Kobold: 'Kobold',
  Kor: 'Kor',
  Kraken: 'Kraken',
  Leech: 'Sangsue',
  Leviathan: 'Léviathan',
  Lhurgoyf: 'Lhurgoyf',
  Lizard: 'Lézard',
  Manticore: 'Manticore',
  Mercenary: 'Mercenaire',
  Merfolk: 'Ondin',
  Minion: 'Mignon',
  Minotaur: 'Minotaure',
  Mole: 'Taupe',
  Monkey: 'Singe',
  Monk: 'Moine',
  Mutant: 'Mutant',
  Myr: 'Myr',
  Naga: 'Naga',
  Nightmare: 'Cauchemar',
  Ninja: 'Ninja',
  Nymph: 'Nymphe',
  Octopus: 'Pieuvre',
  Ogre: 'Ogre',
  Ooze: 'Limon',
  Orc: 'Orque',
  Ouphe: 'Orphe',
  Ox: 'Bovidé',
  Peasant: 'Paysan',
  Pegasus: 'Pégase',
  Pest: 'Parasite',
  Phoenix: 'Phénix',
  // Le type reste « Phyrexian » en français : Wizards ne l'a pas francisé.
  Phyrexian: 'Phyrexian',
  Pilot: 'Pilote',
  Pirate: 'Pirate',
  Plant: 'Plante',
  Rabbit: 'Lapin',
  Raccoon: 'Raton-laveur',
  Rat: 'Rat',
  Rebel: 'Rebelle',
  Reflection: 'Reflet',
  Rhino: 'Rhinocéros',
  Robot: 'Robot',
  Rogue: 'Gredin',
  Salamander: 'Salamandre',
  Samurai: 'Samouraï',
  Saproling: 'Saprobionte',
  Satyr: 'Satyre',
  Scarecrow: 'Épouvantail',
  Scorpion: 'Scorpion',
  Scout: 'Éclaireur',
  Serf: 'Serf',
  // « Serpent » et « Snake » sont deux types distincts en anglais, et le
  // français les sépare aussi : ne pas les confondre en les relisant.
  Serpent: 'Grand serpent',
  Snake: 'Serpent',
  Servo: 'Servo',
  Shade: 'Ombre',
  Shaman: 'Shamane',
  Shapeshifter: 'Changeforme',
  Shark: 'Requin',
  Sheep: 'Mouton',
  Skeleton: 'Squelette',
  Slith: 'Slith',
  Sliver: 'Slivoïde',
  Slug: 'Limace',
  Soldier: 'Soldat',
  Specter: 'Spectre',
  Sphinx: 'Sphinx',
  Spider: 'Araignée',
  Spirit: 'Esprit',
  Squid: 'Calamar',
  Squirrel: 'Écureuil',
  Starfish: 'Étoile de mer',
  Survivor: 'Survivant',
  Tentacle: 'Tentacule',
  Thopter: 'Mécanoptère',
  Thrull: 'Srâne',
  Tiger: 'Tigre',
  Treefolk: 'Sylvin',
  Troll: 'Troll',
  Turtle: 'Tortue terrestre',
  Unicorn: 'Licorne',
  Vampire: 'Vampire',
  Vedalken: 'Vedalken',
  Viashino: 'Viashino',
  Wall: 'Mur',
  Walrus: 'Morse',
  Warrior: 'Guerrier',
  Werewolf: 'Loup-garou',
  Whale: 'Baleine',
  Wizard: 'Sorcier',
  Wolf: 'Loup',
  Wombat: 'Wombat',
  Worm: 'Ver',
  Wurm: 'Guivre',
  Yeti: 'Yéti',
  Zombie: 'Zombie',
  Zubera: 'Zubera',
};

/**
 * Ce qu'on a **refusé** de traduire, et pourquoi — à consigner, faute de quoi
 * quelqu'un les « complétera » de mémoire.
 *
 * Cette table n'est lue par personne : elle est documentaire, et c'est
 * volontaire. Y ajouter une entrée coûte une ligne ; inventer « Engeance » pour
 * `Spawn` coûterait la confiance dans les deux cents autres.
 */
export const TERMES_LAISSES_EN_ANGLAIS: Readonly<Record<string, string>> = {
  Spawn:
    'type des « Eldrazi Spawn » : `t:spawn lang:fr` ne rend aucune impression, il n’y a donc aucune ligne de type française à lire — et « engeance » n’est qu’une supposition',
  Scion: 'même cas que Spawn, pour les « Eldrazi Scion » : aucune impression française',
  Inkling: 'jeton de Strixhaven : aucune impression française, donc aucune ligne de type à relever',
  Manifest:
    'n’existe qu’en jeton, et Scryfall ne publie aucun jeton français : rien à lire ici. La **mécanique** est traduite (« Manifester », `keywordNames.ts`), mais un nom de jeton n’est pas un nom de mécanique et on ne déduit pas l’un de l’autre',
  Morph: 'même cas que Manifest ; la mécanique s’imprime « Mue », le jeton n’a pas de nom français publié',
  Lander: 'jeton récent : aucune impression française',
  Map: 'jeton : aucune impression française, et « Carte » se confondrait avec le mot qui désigne toute carte de Magic',
  Junk: 'jeton : aucune impression française',
  Wraith: 'aucune ligne de type française relevée ; et « Wraith » et « Specter » risqueraient de tomber tous deux sur « Spectre »',
  Walker: 'jeton de Un-set ; aucune impression française',
  'Marit Lage': 'nom propre : il ne se traduit pas',
};

/**
 * Les entrées que la méthode ci-dessus **n'a pas pu atteindre**, et qu'on a
 * pourtant laissées traduites.
 *
 * Elles étaient déjà là ; le relevé des lignes de type françaises ne les
 * couvre pas — soit le type n'a aucune impression française (`Army`, `Germ`,
 * `Naga`, `Serf`, `Servo`, `Tentacle`, `Tiger`), soit ce ne sont pas des
 * sous-types du tout et ils ne vivent que dans un rappel de règles
 * (`Blood`, `Gold`, `Powerstone`, `Incubator`, `Copy`, `Emblem`,
 * `Energy Reserve`, `The Monarch`, `City's Blessing`).
 *
 * On ne les supprime pas — rien ne les contredit — mais elles ne portent pas
 * la même garantie que le reste du glossaire. Qui en vérifiera une pourra la
 * retirer d'ici.
 */
export const NON_VERIFIES: readonly string[] = [
  'Army',
  'Germ',
  'Naga',
  'Serf',
  'Servo',
  'Tentacle',
  'Tiger',
  'Hero',
  'Ferret',
  'Blood',
  'Gold',
  'Powerstone',
  'Incubator',
  'Copy',
  'Emblem',
  'Energy Reserve',
  'The Monarch',
  "City's Blessing",
];

/**
 * Le séparateur des types composés.
 *
 * « Elf Warrior » n'est pas un nom : c'est un empilement de deux types de
 * créature, et le français les joint par **« et »** — la ligne de type d'une
 * carte française dit « Créature : elfe et guerrier ». On rend donc « Elfe et
 * Guerrier », qui est ce que le joueur lit sur la carte qui crée le jeton.
 *
 * C'est le seul endroit de ce fichier qui relève d'une **règle** et non d'un
 * terme ; s'il fallait revenir dessus, c'est ici, et nulle part ailleurs.
 */
const ET = ' et ';

/**
 * Le nom d'un jeton dans la langue de celui qui regarde.
 *
 * Trois passes, dans cet ordre :
 *
 *  1. le nom entier est au glossaire — le cas des jetons non-créature et des
 *     expressions (« The Monarch ») ;
 *  2. le nom est une **composition de types** dont on connaît **chaque** terme :
 *     on les traduit et on les joint. « Chaque » n'est pas négociable — rendre
 *     « Eldrazi Spawn » en « Eldrazi Spawn » à moitié traduit serait le pire des
 *     deux mondes, ni lisible ni reconnaissable ;
 *  3. sinon, **l'anglais**, tel quel.
 *
 * L'anglais demandé ressort toujours inchangé : notre catalogue *est* anglais,
 * il n'y a rien à traduire dans ce sens.
 */
export function tokenName(name: string | null | undefined, language: Language): string | null {
  if (!name) return name ?? null;
  if (language === 'en') return name;

  const exact = TOKEN_NAMES_FR[name];
  if (exact) return exact;

  /*
   * Les noms à double face (« Punchcard // Punchcard », « Day // Night ») ne se
   * composent pas : les deux moitiés sont des faces, pas des types, et les
   * joindre par « et » dirait autre chose que ce qui est imprimé.
   */
  if (name.includes('//')) return name;

  const parts = name.split(' ');
  if (parts.length < 2) return name;

  const traduits: string[] = [];
  for (const part of parts) {
    const fr = TOKEN_NAMES_FR[part];
    if (!fr) return name;
    traduits.push(fr);
  }
  return traduits.join(ET);
}

/**
 * Le terme français d'un type, interrogé par son **nom anglais**.
 *
 * `tokenName` répond à la question « comment s'appelle ce jeton » ; celle-ci
 * répond à « comment s'écrit ce type », et c'est ce dont a besoin tout ce qui
 * manipule un sous-type sans jeton en vue — le dialogue des marqueurs calculés
 * de `CardSprite`, qui doit écrire « Gredins sur le champ de bataille » à partir
 * du canon anglais `rogue`. Sans cette porte, ce code-là s'écrivait son propre
 * lexique français, et la table finissait avec deux mots pour le même type.
 *
 * Elle rend **le mot seul**, jamais une composition : un appelant qui a déjà
 * découpé ses types n'a que faire du « et », et `tokenName` reste la fonction de
 * ceux qui partent d'un nom entier.
 *
 * `fold` est passée en argument pour la raison déjà donnée à
 * `tokenQueryAliases` : la normalisation vit chez l'appelant, et ce fichier
 * n'en écrit pas une seconde. La conséquence est qu'un appelant qui changerait
 * de `fold` en cours de route lirait l'index du premier — il n'en existe qu'un,
 * construit à la première question, et deux `fold` différentes sur ce module
 * seraient de toute façon une erreur.
 */
let parType: Map<string, string> | null = null;

export function typeTermFr(type: string, fold: (text: string) => string): string | null {
  parType ??= new Map(Object.entries(TOKEN_NAMES_FR).map(([en, fr]) => [fold(en), fr]));
  return parType.get(fold(type)) ?? null;
}

/**
 * Est-ce un jeton ? Lu sur la ligne de type **anglaise** du catalogue.
 *
 * Même principe que `isBasicLand` (`cardImage.ts`) et pour la même raison : un
 * `printed_type_line` dirait « Jeton » et le critère casserait pour un joueur
 * anglophone. Une ligne de type absente — métadonnées pas encore arrivées — rend
 * faux : on préfère laisser un nom anglais une seconde de trop que franciser le
 * nom d'une carte ordinaire qui s'appellerait comme un type de créature.
 */
const TOKEN_TYPE_LINE = /\bToken\b/;

export function isTokenTypeLine(typeLine: string | null | undefined): boolean {
  return TOKEN_TYPE_LINE.test(typeLine ?? '');
}

/**
 * Index inverse : du terme français vers le nom anglais du catalogue.
 *
 * Construit une fois, à l'import. Plusieurs entrées anglaises peuvent tomber sur
 * le même français ; on garde la **première**, l'ordre du glossaire allant du
 * plus courant au plus rare.
 */
function buildReverse(fold: (text: string) => string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [en, fr] of Object.entries(TOKEN_NAMES_FR)) {
    const key = fold(fr);
    if (key === '') continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(en);
    else index.set(key, [en]);
  }
  return index;
}

let reverse: Map<string, string[]> | null = null;

/**
 * Les recherches anglaises à **ajouter** quand la saisie est française.
 *
 * **Ce que cette fonction ne fait pas**, et c'est le point : elle ne remplace
 * pas la saisie. `/api/cards/search` ne connaît que les noms du catalogue
 * anglais ; la requête de l'utilisateur part donc telle quelle, comme avant, et
 * « Soldier » continue de répondre. Ce qui suit vient **en plus**, pour que
 * « Soldat » réponde aussi — un joueur a des listes de deck et des cartes
 * physiques en anglais, et une table où l'on parle français.
 *
 * `fold` est passée en argument plutôt qu'importée : la normalisation d'accents
 * du projet (`foldForSearch`, `components/Dialog.tsx`) vit du côté des
 * composants, et ce fichier-ci doit rester sans dépendance à React. Il n'en
 * existe **qu'une**, et on ne va pas en écrire une seconde ici.
 *
 * Le résultat est borné : une saisie de deux lettres rencontre une dizaine de
 * termes, et l'on ne va pas ouvrir dix requêtes HTTP pour cela. On garde les
 * plus pertinentes — égalité stricte d'abord, puis préfixe, puis contenu.
 */
export function tokenQueryAliases(
  query: string,
  fold: (text: string) => string,
  limit = 3,
): string[] {
  reverse ??= buildReverse(fold);
  const needle = fold(query);
  if (needle.length < 2) return [];

  const exacts: string[] = [];
  const prefixes: string[] = [];
  const contains: string[] = [];
  for (const [key, names] of reverse) {
    if (key === needle) exacts.push(...names);
    else if (key.startsWith(needle)) prefixes.push(...names);
    else if (key.includes(needle)) contains.push(...names);
  }

  const out: string[] = [];
  for (const name of [...exacts, ...prefixes, ...contains]) {
    // Inutile de redemander ce que la saisie brute trouve déjà.
    if (fold(name) === needle) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

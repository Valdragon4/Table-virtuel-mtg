/**
 * Le glossaire des noms de jetons, et lui seul.
 *
 * **Pourquoi ce fichier existe, et pourquoi il est à part des catalogues.**
 * Scryfall ne publie **aucun** jeton dans une autre langue que l'anglais :
 * `t:token lang:fr include:extras` rend zéro résultat, et nos 3 119 impressions
 * de jetons au catalogue n'ont pas une seule ligne localisée. Il n'y a donc
 * aucun `printed_name` à aller chercher — la mécanique d'impression localisée
 * (`docs/i18n.md` §3) ne peut rien pour eux. Ce qui suit est **notre**
 * traduction, la seule qui existera.
 *
 * Elle n'est pas libre pour autant. Un joueur français lit « créature-jeton
 * Soldat blanche 1/1 » sur ses vraies cartes : l'immense majorité des noms de
 * jetons sont des **types de créature**, que Wizards traduit officiellement
 * depuis toujours. On emploie donc le terme français **du jeu**, jamais une
 * traduction de dictionnaire. Et dans le doute, **on laisse l'anglais** : un nom
 * inventé est pire qu'un nom anglais, parce qu'il a l'air juste.
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
 * Ce qui n'y est **pas** y manque exprès. Les cas écartés faute de certitude sur
 * le terme officiel sont consignés dans `TERMES_LAISSES_EN_ANGLAIS`.
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
  Cleric: 'Prêtre',
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
  Faerie: 'Fée',
  Ferret: 'Furet',
  Fish: 'Poisson',
  Fox: 'Renard',
  Fractal: 'Fractale',
  Frog: 'Grenouille',
  Fungus: 'Champignon',
  Gargoyle: 'Gargouille',
  Germ: 'Germe',
  Giant: 'Géant',
  Gnome: 'Gnome',
  Goat: 'Chèvre',
  Goblin: 'Gobelin',
  God: 'Dieu',
  Golem: 'Golem',
  Gorgon: 'Gorgone',
  Gremlin: 'Gremlin',
  Griffin: 'Griffon',
  Harpy: 'Harpie',
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
  Juggernaut: 'Juggernaut',
  Kavu: 'Kavu',
  Kirin: 'Kirin',
  Kithkin: 'Kithkin',
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
  Minion: 'Sbire',
  Minotaur: 'Minotaure',
  Mole: 'Taupe',
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
  Ouphe: 'Ouphe',
  Ox: 'Bœuf',
  Peasant: 'Paysan',
  Pegasus: 'Pégase',
  Phoenix: 'Phénix',
  // Le type reste « Phyrexian » en français : Wizards ne l'a pas francisé.
  Phyrexian: 'Phyrexian',
  Pilot: 'Pilote',
  Pirate: 'Pirate',
  Plant: 'Plante',
  Rabbit: 'Lapin',
  Raccoon: 'Raton laveur',
  Rat: 'Rat',
  Rebel: 'Rebelle',
  Reflection: 'Reflet',
  Rhino: 'Rhinocéros',
  Robot: 'Robot',
  Rogue: 'Roublard',
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
  Serpent: 'Serpent de mer',
  Snake: 'Serpent',
  Servo: 'Servo',
  Shade: 'Ombre',
  Shaman: 'Chaman',
  Shapeshifter: 'Métamorphe',
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
  Squid: 'Calmar',
  Squirrel: 'Écureuil',
  Starfish: 'Étoile de mer',
  Survivor: 'Survivant',
  Tentacle: 'Tentacule',
  Thopter: 'Thopter',
  Thrull: 'Thrull',
  Tiger: 'Tigre',
  Treefolk: 'Sylvin',
  Troll: 'Troll',
  Turtle: 'Tortue',
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
  Spawn: "type des « Eldrazi Spawn » : terme officiel non vérifié, et « engeance » n'est qu'une supposition",
  Scion: 'même cas que Spawn, pour les « Eldrazi Scion »',
  Inkling: 'jeton de Strixhaven : aucun terme français vérifié',
  Pest: 'jeton de Strixhaven : « vermine » est plausible, pas certain',
  Hellion: 'terme officiel non vérifié',
  Manifest: 'mot de mécanique autant que de jeton ; le traduire ici risquerait de contredire le texte de règles',
  Morph: 'même cas que Manifest',
  Lander: "jeton récent ; aucun terme français vérifié",
  Map: '« Carte » se confondrait avec le mot qui désigne toute carte de Magic',
  Junk: 'terme officiel non vérifié',
  Ape: '« Ape » et « Monkey » sont deux types distincts que le français ne sépare pas de façon vérifiée',
  Monkey: 'voir Ape',
  Wraith: '« Wraith » et « Specter » risqueraient de tomber tous deux sur « Spectre »',
  Walker: 'jeton de Un-set ; rien à traduire avec certitude',
  'Marit Lage': 'nom propre : il ne se traduit pas',
};

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

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
 * **Mais il y a des sources de vérité, et ce n'est pas nous.** Il y en a
 * **deux**, et il en fallait deux : la première ne couvre qu'une famille de
 * jetons, et c'est la seconde qui atteint l'autre.
 *
 * **Source 1 — `printed_type_line`, pour les types de créature.** L'immense
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
 * **Pourquoi il en fallait une seconde.** Cette méthode a un angle mort qui
 * n'est pas un détail : elle ne voit que ce qui est un **sous-type**. Or
 * « Trésor », « Sang », « Lithoforce », « emblème », « l'agrément de la cité »
 * ne sont sous-types de rien — ils ne vivent que dans le texte d'une carte, et
 * aucune ligne de type au monde ne les porte. Et même parmi les types de
 * créature, certains n'ont aucune carte ordinaire française à leur nom :
 * `Germ`, `Servo` et `Tentacle` n'existent qu'en jeton.
 *
 * **Source 2 — `printed_text`, pour tout le reste.** La carte française qui
 * **crée** le jeton le **nomme**, dans son texte imprimé. On part de l'anglais
 * pour trouver les cartes candidates (`q=oracle%3A%22Powerstone+token%22`),
 * puis on lit le `printed_text` de leur impression française :
 *
 *     https://api.scryfall.com/cards/search
 *       ?q=%21%22Argothian+Opportunist%22+lang%3Afr
 *        &include_multilingual=true&unique=prints
 *
 * C'est elle qui a donné « armée » (Invasion de la Horde de l'effroi),
 * « Germe » (Battecrâne), « Tentacule » (Kraken du nadir) — et qui a **corrigé
 * deux traductions fausses** que la première n'atteignait pas : Powerstone
 * s'imprime **« Lithoforce »** et non « pierre de puissance », City's Blessing
 * **« l'agrément de la cité »** et non « la bénédiction de la cité ». Toutes
 * deux avaient l'air justes ; c'est précisément le danger.
 *
 * **Chaque terme est confirmé sur deux cartes différentes** quand la
 * formulation pourrait dépendre du contexte. Une entrée dont une seule carte
 * témoigne est signalée comme telle.
 *
 * Le glossaire porte donc une majuscule là où la carte imprime une minuscule :
 * la ligne de type écrit « gorgonoïde » en cours de phrase, le texte de rappel
 * écrit « une armée » au fil de la sienne, et un nom de jeton s'affiche seul.
 * Le **mot** est celui de la carte ; seule la casse est à nous.
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
  // « Lithoforce » et non « pierre de puissance » : c'est le mot qu'impriment
  // les cartes françaises de La Guerre fratricide, et la traduction littérale
  // qui était ici avait l'air juste sans l'être.
  Powerstone: 'Lithoforce',
  Incubator: 'Incubateur',
  Copy: 'Copie',
  Emblem: 'Emblème',
  'Energy Reserve': "Réserve d'énergie",
  /*
   * Le monarque et l'agrément de la cité ne sont pas des créatures : leur nom
   * est une expression, pas une somme de types.
   *
   * **On garde l'article**, contre l'usage du reste du glossaire, et c'est
   * délibéré : ces deux-là ne nomment pas une espèce mais un **statut unique
   * de la partie** — il n'y a qu'un monarque à la fois. Le français ne dit
   * jamais « monarque » seul là où il dirait « soldat » seul, et l'anglais
   * porte déjà l'article dans la clé (« The Monarch »). Sans lui,
   * « Agrément de la cité » se lirait comme un nom tronqué.
   */
  'The Monarch': 'Le monarque',
  "City's Blessing": "L'agrément de la cité",

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
  /*
   * Ces cinq-là n'ont **aucune ligne de type française** — ils n'existent qu'en
   * jeton, et Scryfall n'en catalogue aucun hors anglais. C'est la seconde
   * source qui les donne : le texte imprimé des cartes qui les créent les
   * nomme, et deux cartes indépendantes confirment chacun.
   */
  Spawn: 'Engeance',
  Scion: 'Scion',
  Inkling: 'Encrelin',
  Junk: 'Bric-à-brac',
  Wraith: 'Apparition',
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
  /*
   * Plusieurs lignes disaient « aucune impression française », ce qui était vrai
   * de la **ligne de type** et faux du **texte imprimé**. Les cinq que la
   * seconde source a prouvées — Spawn, Scion, Inkling, Junk, Wraith — sont
   * parties au glossaire ; ce qui reste ici l'est pour une raison, pas par
   * oubli. `Map` est le seul refus **délibéré** : la source existe, c'est
   * l'affichage qui n'en veut pas.
   */
  Manifest:
    'n’existe qu’en jeton, et Scryfall ne publie aucun jeton français : rien à lire ici. La **mécanique** est traduite (« Manifester », `keywordNames.ts`), mais un nom de jeton n’est pas un nom de mécanique et on ne déduit pas l’un de l’autre',
  Morph: 'même cas que Manifest ; la mécanique s’imprime « Mue », le jeton n’a pas de nom français publié',
  Lander:
    'jeton récent : les impressions françaises d’Edge of Eternities existent, mais Scryfall n’en publie pas encore le texte — leur `printed_text` est toujours l’anglais. Rien à lire, donc',
  Map: 'le texte français l’imprime bien « carte » (Compagnon du cartographe, Offrande fanatique) — mais on le laisse en anglais **par choix**, pas faute de source : « Carte » se confondrait à l’écran avec le mot qui désigne toute carte de Magic',
  Walker:
    'jeton de Secret Lair, anglais seulement : aucune carte française ne le nomme (`oracle:"Walker creature token" lang:fr` ne rend rien), et les cartes qui le créent ne sont pas traduites',
  'Marit Lage':
    'nom propre — celui d’un avatar nommé, pas d’un type : rien à relever nulle part, et le traduire le rendrait méconnaissable à la table',
};

/**
 * Les entrées que **ni l'une ni l'autre source** n'atteint, et qu'on a pourtant
 * laissées traduites.
 *
 * Il en restait dix-huit quand le glossaire ne connaissait qu'une source ; la
 * lecture des `printed_text` français en a prouvé quinze — dont deux qui
 * étaient **fausses** (`Powerstone`, `City's Blessing`, corrigées en place).
 * Les trois qui suivent résistent, et chacune pour une raison différente : il
 * ne s'agit pas d'un reste à finir mais de trois impasses.
 *
 * On ne les supprime pas — rien ne les contredit — mais elles ne portent pas la
 * même garantie que le reste du glossaire. La valeur dit **ce qui a été
 * cherché**, pour que personne ne recommence la même recherche ni ne comble de
 * mémoire.
 */
export const NON_VERIFIES: Readonly<Record<string, string>> = {
  Tiger:
    'il n’existe aucun type de créature « Tiger » dans Magic — `t:tiger` ne rend rien, jetons compris ; les tigres du jeu sont des chats. L’entrée ne désigne donc rien, ni en anglais ni en français, et « Tigre » n’a aucune carte pour le dire',
  Ferret:
    'une seule carte porte le type (Joven’s Ferrets), et son unique impression française est d’un âge où Scryfall n’a ni `printed_type_line` ni `printed_text` à servir ; aucun jeton Ferret n’existe, donc aucune carte ne le nomme non plus',
  'Energy Reserve':
    'les cartes françaises n’écrivent jamais « réserve » : elles disent « marqueur énergie » (Centre d’Éther, Chasseur d’Éther). La réserve est une notion des règles, pas un mot imprimé — le libellé reste donc une traduction de notre fait',
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
 * Le séparateur des faces d'un nom recto-verso.
 *
 * Scryfall écrit « Day // Night » avec des espaces autour ; on les rétablit à la
 * recomposition plutôt que de recopier ce qu'on a découpé, pour qu'un nom mal
 * espacé au catalogue ressorte quand même propre.
 */
const FACES = ' // ';

/**
 * Le nom d'**une face**, ou `null` si on ne sait pas le dire en entier.
 *
 * Deux passes : le nom entier au glossaire, puis la composition de types. Elle
 * rend `null` — et non l'anglais — là où `tokenName` rendrait l'anglais, parce
 * que son appelant a besoin de **distinguer** « traduit » de « pas traduit » :
 * une face non traduite doit faire retomber le nom entier en anglais, et non
 * produire « Ange // Zombie Spawn ».
 */
function faceName(name: string): string | null {
  const exact = TOKEN_NAMES_FR[name];
  if (exact) return exact;

  const parts = name.split(' ');
  if (parts.length < 2) return null;

  const traduits: string[] = [];
  for (const part of parts) {
    const fr = TOKEN_NAMES_FR[part];
    if (!fr) return null;
    traduits.push(fr);
  }
  return traduits.join(ET);
}

/**
 * Le nom d'un jeton dans la langue de celui qui regarde.
 *
 * Trois passes, dans cet ordre :
 *
 *  1. le nom entier est au glossaire — le cas des jetons non-créature et des
 *     expressions (« The Monarch ») ;
 *  2. le nom se **découpe**, et chaque morceau se traduit :
 *     - par `//`, ce sont des **faces** — chacune se traduit pour son compte et
 *       le séparateur reste `//` ;
 *     - par l'espace, ce sont des **types empilés** — ils se joignent par « et »,
 *       comme la ligne de type française les joint.
 *     « Chaque » n'est négociable dans aucun des deux cas — rendre « Eldrazi
 *     Spawn » en « Eldrazi Spawn » à moitié traduit serait le pire des deux
 *     mondes, ni lisible ni reconnaissable ;
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
   * Les deux moitiés d'un « // » sont des **faces**, pas des types empilés : on
   * ne les joint donc jamais par « et », ce qui dirait autre chose que ce qui
   * est imprimé. Mais chaque face est, elle, un nom de jeton à part entière —
   * un jeton Ange recto-verso s'appelle « Angel // Angel » et se lit « Ange //
   * Ange ». On traduit donc face par face, en gardant le séparateur.
   *
   * Tout ou rien, comme partout ailleurs ici : si une seule face manque au
   * glossaire, le nom entier reste anglais plutôt que de devenir un hybride
   * qu'aucun joueur ne reconnaîtrait.
   */
  if (name.includes('//')) {
    const faces = name.split('//').map((face) => faceName(face.trim()));
    if (faces.some((face) => face === null)) return name;
    return faces.join(FACES);
  }

  return faceName(name) ?? name;
}

/**
 * Faut-il nommer cette carte **comme un jeton**, c'est-à-dire par le glossaire ?
 *
 * Deux sources, et leur ordre est tout le sujet :
 *
 *  - `kind`, quand il existe, **fait foi** — c'est le protocole qui dit qu'un
 *    objet est un jeton. Une carte ordinaire dont la ligne de type contiendrait
 *    « Token » n'en est pas un, et un jeton copie d'une carte existante en est
 *    un sans que sa ligne de type le dise ;
 *  - la ligne de type **à défaut**. Tout ce qu'on survole n'est pas un objet de
 *    partie : une vignette d'étagère, un résultat de recherche de jetons ou une
 *    carte de « Mes decks » est une simple impression Scryfall, qui n'a pas de
 *    `kind`. `isTokenTypeLine` est alors le seul signal disponible, et c'est
 *    déjà celui que `TokenSearch` emploie.
 *
 * Dans le doute — ni `kind` ni ligne de type encore arrivée — la réponse est
 * **non**. Le coût des deux erreurs n'est pas le même : un nom de jeton qui
 * reste une seconde en anglais se corrige tout seul au lot de métadonnées
 * suivant, tandis qu'une carte ordinaire passée au glossaire verrait son nom
 * propre réécrit — « Angel of Destiny » n'est pas « Ange of Destiny ».
 */
export function isTokenForNaming({
  kind,
  typeLine,
}: {
  /** `card.kind` tel que le protocole le publie, absent pour une impression. */
  kind?: string | null;
  /** La ligne de type **anglaise** du catalogue. */
  typeLine?: string | null;
}): boolean {
  if (kind != null) return kind === 'TOKEN';
  return isTokenTypeLine(typeLine);
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

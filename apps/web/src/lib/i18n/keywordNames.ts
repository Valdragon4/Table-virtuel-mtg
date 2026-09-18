/**
 * Le glossaire des **mots-clés de mécanique**, et lui seul.
 *
 * **Pourquoi il existe.** Scryfall publie pour chaque carte un tableau de noms
 * de mécaniques — `['Flying', 'Trample']`, `['Discover']`, `[]` pour un Anneau
 * solaire — et ce tableau est **toujours anglais**, quelle que soit la langue de
 * l'impression. Il n'existe aucun `printed_keyword` à demander : la mécanique
 * d'impression localisée (`docs/i18n.md` §3) ne rend pas les mots-clés. Ce
 * tableau-ci est donc le seul endroit où le français existe.
 *
 * **La source de vérité, et comment la ré-interroger.** Ce n'est plus notre
 * mémoire : c'est le `printed_text` des impressions **françaises**, qui porte le
 * libellé réellement imprimé sur la carte. Une mécanique se vérifie ainsi —
 *
 *     https://api.scryfall.com/cards/search
 *       ?q=keyword%3Ahexproof+lang%3Afr&include_multilingual=true
 *
 * — puis on lit le libellé en tête de ligne, sans son coût ni son nombre :
 * « Défense talismanique », « Parade », « Piétinement ». Les mots-clés **à coût**
 * (Ward, Kicker, Cycling, Splice…) se confirment sur deux cartes différentes,
 * pour distinguer le mot nu de son complément — « Imprégnation d'arcane » et
 * « Imprégnation d'éphémère ou de rituel » donnent `Imprégnation`.
 *
 * Les **actions**-mots-clés s'impriment au mode conjugué (« meulez », « voilez »,
 * « amassez ») ; on en retient l'infinitif, qui est la forme de citation et que
 * le rappel de règles imprime souvent lui-même (« Pour meuler une carte… »). Les
 * **capacités**, elles, s'impriment déjà sous forme nominale (« Suspension 3 »,
 * « Modularité 1 ») et se recopient telles quelles. C'est la seule règle de ce
 * fichier ; tout le reste est un relevé.
 *
 * **Ce qu'on ne fait toujours pas.** On ne traduit **jamais** de mémoire. Ce qui
 * n'a pas de libellé imprimé consultable reste **en anglais** — un nom inventé
 * est pire qu'un nom anglais, parce qu'il a l'air juste. `MOTS_CLES_EN_ANGLAIS`
 * consigne ces refus, et dit pour chacun ce qui a manqué.
 *
 * **Ce que ce fichier ne fait pas, et ne fera jamais.** Il ne dit nulle part ce
 * qu'une mécanique *fait*. Aucun texte de règles, aucune image, aucune copie de
 * quoi que ce soit — seulement des **noms** (`docs/i18n.md` §5). Et rien ici ne
 * descend au moteur : `keywords` n'est pas dans le protocole de jeu, il ne le
 * sera pas, et le serveur n'applique aucune règle. Ces noms servent à **montrer
 * et à chercher**, jamais à décider.
 *
 * **Le nom anglais reste la clé.** Comme pour les jetons : le français est un
 * vernis d'affichage. Rien de ce fichier ne s'enregistre, ne trie, ni ne sert
 * d'identité.
 */
import type { Language } from '@mtg/shared';

/**
 * Le glossaire, clé = nom **anglais exact** tel que Scryfall le publie dans
 * `keywords` (majuscule initiale, le reste en minuscules : `First strike`,
 * `Cumulative upkeep`).
 */
export const KEYWORD_NAMES_FR: Readonly<Record<string, string>> = {
  // --- Les permanentes, celles qu'on lit vingt fois par partie.
  Flying: 'Vol',
  Trample: 'Piétinement',
  Deathtouch: 'Contact mortel',
  Lifelink: 'Lien de vie',
  'First strike': 'Initiative',
  'Double strike': 'Double initiative',
  Vigilance: 'Vigilance',
  Haste: 'Célérité',
  Reach: 'Portée',
  Menace: 'Menace',
  Defender: 'Défenseur',
  Indestructible: 'Indestructible',
  Protection: 'Protection',
  Flash: 'Flash',
  Fear: 'Peur',
  Intimidate: 'Intimidation',
  Infect: 'Infection',
  Wither: 'Flétrissure',
  Toxic: 'Toxique',
  // Trois permanentes très courantes, longtemps laissées en anglais faute de
  // source : le `printed_text` français les donne sans ambiguïté.
  Hexproof: 'Défense talismanique',
  Shroud: 'Linceul',
  Ward: 'Parade',
  // « Shadow » ne donne pas « Ombre » : le français imprime « Distorsion », et
  // « Ombre » est déjà le type de créature Shade (`tokenNames.ts`).
  Shadow: 'Distorsion',
  Undying: 'Survivance',
  Poisonous: 'Empoisonnement',
  Changeling: 'Changelin',
  Horsemanship: 'Équitation',
  Daybound: 'Diurne',
  Nightbound: 'Nocturne',

  // --- La traversée de terrain. Le français en fait une locution, toujours au
  //     pluriel du type de terrain : « traversée des îles ».
  Plainswalk: 'Traversée des plaines',
  Islandwalk: 'Traversée des îles',
  Swampwalk: 'Traversée des marais',
  Mountainwalk: 'Traversée des montagnes',
  Forestwalk: 'Traversée des forêts',

  // --- Les coûts alternatifs et les mécaniques de coût. Le libellé retenu est
  //     le **mot nu**, sans le coût ni le complément qui le suit sur la carte.
  Kicker: 'Kick',
  Multikicker: 'Multikick',
  Buyback: 'Rappel',
  Flashback: 'Flashback',
  Cycling: 'Recyclage',
  Affinity: 'Affinité',
  Convoke: 'Convocation',
  Evoke: 'Évocation',
  Overload: 'Surcharge',
  Replicate: 'Duplication',
  Transmute: 'Transmutation',
  Suspend: 'Suspension',
  Escape: 'Échappée',
  Unearth: 'Exhumation',
  Offering: 'Offrande',
  Prototype: 'Prototype',
  Blitz: 'Blitz',
  Entwine: 'Union',
  Splice: 'Imprégnation',
  Delve: 'Fouille',
  Prowl: 'Incursion',
  Retrace: 'Pistage',
  Forecast: 'Prévision',
  Foretell: 'Prédiction',
  Bargain: 'Négociation',
  Casualty: 'Victime',
  Spree: 'Impétuosité',
  Freerunning: 'Course libre',
  Impending: 'Imminence',
  'Split second': 'Fraction de seconde',
  'Level up': 'Montée de niveau',
  'Read ahead': 'Lecture rapide',

  // --- Les déclenchées et les statiques nommées.
  Cascade: 'Cascade',
  Prowess: 'Prouesse',
  Exalted: 'Exaltation',
  Extort: 'Extorsion',
  Storm: 'Déluge',
  Madness: 'Folie',
  Miracle: 'Miracle',
  Echo: 'Écho',
  Epic: 'Épique',
  Persist: 'Persistance',
  Annihilator: 'Annihilateur',
  Modular: 'Modularité',
  Graft: 'Greffe',
  Evolve: 'Évolution',
  Amplify: 'Amplification',
  Bloodthirst: 'Soif de sang',
  'Battle cry': 'Cri de guerre',
  Conspire: 'Conspiration',
  'Cumulative upkeep': 'Entretien cumulatif',
  Frenzy: 'Frénésie',
  Haunt: 'Hantise',
  Provoke: 'Provocation',
  Rebound: 'Rebond',
  // « Recouvrement », et non « Récupération » : c'est Scavenge qui s'imprime
  // « Récupération », et les confondre effacerait la différence.
  Recover: 'Recouvrement',
  Scavenge: 'Récupération',
  Reinforce: 'Renfort',
  Flanking: 'Débordement',
  Vanishing: 'Disparition',
  'Living weapon': 'Arme vivante',
  'Totem armor': 'Armure totémique',
  Bushido: 'Bushido',
  Ninjutsu: 'Ninjutsu',
  Mentor: 'Mentor',
  Spectacle: 'Spectacle',
  Mutate: 'Mutation',
  Companion: 'Compagnon',
  Dredge: 'Dragage',
  Rampage: 'Sauvagerie',
  Soulshift: 'Transmigration',
  Soulbond: "Association d'âmes",
  Ripple: 'Remous',
  Sunburst: 'Solarisation',
  Hideaway: 'Cachette',
  Outlast: 'Résilience',
  Unleash: 'Emportement',
  Cipher: 'Cryptage',
  Exploit: 'Exploitation',
  Riot: 'Émeute',
  Afterlife: 'Au-delà',
  Boast: 'Vantardise',
  Disturb: 'Perturbation',
  Cleave: 'Tranchage',
  Enlist: 'Enrôlement',
  Backup: 'Main-forte',
  Disguise: 'Déguisement',
  Plot: 'Complot',
  Offspring: 'Progéniture',
  'For Mirrodin!': 'Pour Mirrodin',

  // --- L'équipement et l'attachement.
  Equip: 'Équipement',
  Enchant: 'Enchanter',
  Fortify: 'Fortification',

  // --- Les actions-mots-clés, et les capacités qui s'impriment au mode
  //     conjugué. Scryfall les range dans le même tableau que les capacités, et
  //     il a raison : le joueur les cherche du même geste. On retient
  //     l'infinitif ; seul `Scry` s'imprime en nom (« Regard 1 »), et se garde
  //     donc tel quel — le libellé de menu de `catalog.fr.ts` fait le même
  //     partage, pour la même raison.
  Scry: 'Regard',
  Surveil: 'Surveiller',
  Explore: 'Explorer',
  Investigate: 'Enquêter',
  Fabricate: 'Fabrication',
  Devour: 'Dévorement',
  Discover: 'Découvrir',
  Mill: 'Meuler',
  Amass: 'Amasser',
  Adapt: 'Adapter',
  Connive: 'Conniver',
  Incubate: 'Incuber',
  Cloak: 'Voiler',
  Manifest: 'Manifester',
  Morph: 'Mue',
  Detain: 'Détenir',
  Craft: 'Façonner',
  Saddle: 'Seller',
};

/**
 * Ce qu'on a **refusé** de traduire, et pourquoi — à consigner, faute de quoi
 * quelqu'un les « complétera » de mémoire.
 *
 * Cette table n'est lue par personne : elle est documentaire, et c'est
 * volontaire. Y ajouter une entrée coûte une ligne ; inventer « Anti-sort »
 * pour `Ward` aurait coûté la confiance dans les cent quarante autres.
 *
 * Elle a fondu : le `printed_text` français a levé l'essentiel des refus. Ce
 * qu'il en reste tient à une cause unique et vérifiable — **il n'y a rien à
 * lire**. Trois de ces mécaniques ne vivent que sur des cartes de 1994-1999,
 * dont Scryfall ne publie aucun texte imprimé français ; la quatrième ne
 * s'imprime que sous forme de locution conjuguée, dont aucun libellé ne se
 * détache. Aucune de ces quatre lignes ne se lève par un effort de traduction :
 * elle se lèvera le jour où Scryfall publiera le texte, ou pas du tout.
 */
export const MOTS_CLES_EN_ANGLAIS: Readonly<Record<string, string>> = {
  Banding:
    'les 34 impressions françaises connues de Scryfall n’ont aucun `printed_text` : rien à lire, donc rien à relever',
  Fading:
    'même cas que Banding — 17 impressions françaises, aucune avec `printed_text` ; à ne pas confondre avec Vanishing, qui s’imprime « Disparition »',
  Phasing:
    'même cas que Banding — 12 impressions françaises, aucune avec `printed_text`. « Décalage » a figuré ici comme traduction ; rien ne l’étaye, donc il redescend',
  Gift:
    'ne s’imprime jamais en libellé : c’est une locution conjuguée, complétée par ce qui est donné, et qui change d’une carte à l’autre. Aucun nom ne s’en détache, et « Cadeau » seul n’est imprimé nulle part',
};

/**
 * Le nom d'un mot-clé dans la langue de celui qui regarde.
 *
 * Pas de recomposition ici, contrairement à `tokenName` : un mot-clé est un nom
 * entier, il ne s'empile pas. Ce qui n'est pas au glossaire ressort en anglais,
 * tel quel — c'est exactement ce que le joueur lit sur une carte anglaise.
 *
 * **Le nombre reste hors du nom.** Scryfall publie « Discover », jamais
 * « Discover 4 » ; il n'y a donc rien à reconstituer, et rien à inventer.
 */
export function keywordName(name: string | null | undefined, language: Language): string | null {
  if (!name) return name ?? null;
  if (language === 'en') return name;
  return KEYWORD_NAMES_FR[name] ?? name;
}

/**
 * Repli de **clé** : minuscules, sans accents, mots liés par un tiret.
 *
 * `First strike` → `first-strike`, `Piétinement` → `pietinement`,
 * `Traversée des îles` → `traversee-des-iles`.
 *
 * Ce n'est **pas** la normalisation de recherche du projet — `foldForSearch`
 * (`components/Dialog.tsx`) l'est, elle est unique, et rien ici ne la double :
 * elle sépare par des espaces et sert à comparer des saisies libres. Celle-ci
 * fabrique un identifiant compact, celui qui tient dans les 32 caractères d'un
 * `kind` de marqueur, exactement comme `foldSubtype` le fait pour les
 * sous-types dans `CardSprite.tsx`. Deux usages, deux fonctions.
 */
export function foldKeyword(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Index inverse, du français replié vers le nom anglais. Construit une fois. */
const PAR_FRANCAIS: ReadonlyMap<string, string> = new Map(
  Object.entries(KEYWORD_NAMES_FR).map(([en, fr]) => [foldKeyword(fr), en]),
);

/**
 * La forme canonique d'un mot-clé, d'où qu'il vienne — saisie du joueur ou
 * tableau Scryfall.
 *
 * Symétrique par construction : « Vol », « vol », « Flying » et « flying »
 * tombent tous sur `flying`. Un mot inconnu se replie sur lui-même plutôt que
 * de disparaître, et se compare alors tel quel : un mot-clé anglais que le
 * glossaire ignore continue donc de fonctionner partout.
 */
export function canonKeyword(raw: string): string {
  const folded = foldKeyword(raw);
  return PAR_FRANCAIS.get(folded) !== undefined ? foldKeyword(PAR_FRANCAIS.get(folded)!) : folded;
}

/** Le glossaire connaît-il ce mot, dans un sens ou dans l'autre ? */
export function isKnownKeyword(raw: string): boolean {
  const folded = foldKeyword(raw);
  if (PAR_FRANCAIS.has(folded)) return true;
  return Object.keys(KEYWORD_NAMES_FR).some((en) => foldKeyword(en) === folded);
}

/** L'anglais canonique correspondant à une forme repliée, pour l'affichage. */
const PAR_CANON: ReadonlyMap<string, string> = new Map(
  Object.keys(KEYWORD_NAMES_FR).map((en) => [foldKeyword(en), en]),
);

/**
 * Comment écrire un mot-clé canonique à l'écran.
 *
 * `flying` → « Vol » en français, « Flying » en anglais. Un canon inconnu du
 * glossaire — un mot-clé récent, ou un mot tapé de travers — ressort avec ses
 * tirets remplacés par des espaces et une majuscule : `split-second` devient
 * « Split second », ce qui est lisible et honnête.
 */
export function keywordLabel(canon: string, language: Language): string {
  const en = PAR_CANON.get(canon);
  if (en !== undefined) return keywordName(en, language) ?? en;
  const mots = canon.replace(/-/g, ' ');
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}

/**
 * Ce qu'un filtre textuel doit pouvoir trouver sur une carte, à partir de ses
 * mots-clés.
 *
 * Rend les termes **séparés**, anglais et français mêlés : c'est `matchesCardQuery`
 * qui les compare, chacun pour lui-même, avec la normalisation unique du projet.
 * Les recoller en une seule chaîne laisserait une saisie courir de la fin d'un
 * mot-clé au début du suivant et retenir une carte que personne ne saurait
 * expliquer — c'est la leçon déjà tirée dans `LookModal`.
 *
 * Le nom **anglais est toujours rendu**, même quand le français existe : taper
 * « Flying » doit marcher autant que « Vol », comme pour les cartes et les
 * jetons. Une liste de deck, une carte physique et une discussion de table ne
 * parlent pas toutes la même langue.
 */
export function keywordSearchTerms(
  keywords: readonly string[] | null | undefined,
  language: Language,
): string[] {
  if (!keywords || keywords.length === 0) return [];
  const out: string[] = [];
  for (const kw of keywords) {
    out.push(kw);
    const fr = keywordName(kw, language);
    if (fr !== null && fr !== kw) out.push(fr);
  }
  return out;
}

/**
 * Les mots-clés proposés d'emblée dans les marqueurs calculés.
 *
 * Critère : ceux pour lesquels « pour chaque créature avec X » est un effet qui
 * existe vraiment, et qu'on compte des yeux en jouant. Les autres s'atteignent
 * en tapant leur nom, en français comme en anglais.
 */
export const COMMON_KEYWORDS: readonly string[] = [
  'flying',
  'trample',
  'deathtouch',
  'lifelink',
  'first-strike',
  'vigilance',
  'haste',
  'menace',
  'indestructible',
];

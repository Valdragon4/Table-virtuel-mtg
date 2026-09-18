/**
 * Le glossaire des **mots-clés de mécanique**, et lui seul.
 *
 * **Pourquoi il existe.** Scryfall publie pour chaque carte un tableau de noms
 * de mécaniques — `['Flying', 'Trample']`, `['Discover']`, `[]` pour un Anneau
 * solaire — et ce tableau est **toujours anglais**, quelle que soit la langue de
 * l'impression. Il n'existe donc aucun `printed_keyword` à aller chercher, pas
 * plus qu'il n'existe de `printed_name` pour un jeton : la mécanique d'impression
 * localisée (`docs/i18n.md` §3) ne peut rien pour eux. Ce qui suit est **notre**
 * traduction, la seule qui existera.
 *
 * **Même discipline que `tokenNames.ts`, et pour la même raison.** Un joueur
 * français lit « Vol », « Piétinement », « Contact mortel » sur ses vraies
 * cartes : on emploie le terme français **du jeu**, jamais une traduction de
 * dictionnaire. Et dans le doute, **on laisse l'anglais** — un nom inventé est
 * pire qu'un nom anglais, parce qu'il a l'air juste. `MOTS_CLES_EN_ANGLAIS`
 * consigne les refus.
 *
 * Les mots-clés sont moins nombreux et bien mieux connus que les types de
 * créature, donc la couverture est large ; elle n'est pas totale pour autant, et
 * elle ne doit pas le devenir au prix d'une invention.
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
  Shadow: 'Ombre',
  Infect: 'Infection',
  Wither: 'Flétrissure',
  Toxic: 'Toxique',

  // --- La traversée de terrain. Le français en fait une locution, toujours au
  //     pluriel du type de terrain : « traversée des îles ».
  Plainswalk: 'Traversée des plaines',
  Islandwalk: 'Traversée des îles',
  Swampwalk: 'Traversée des marais',
  Mountainwalk: 'Traversée des montagnes',
  Forestwalk: 'Traversée des forêts',

  // --- Les coûts alternatifs et les mécaniques de coût.
  Kicker: 'Kicker',
  Multikicker: 'Multikicker',
  Buyback: 'Rachat',
  Flashback: 'Flashback',
  Cycling: 'Recyclage',
  Affinity: 'Affinité',
  Convoke: 'Convocation',
  Evoke: 'Évocation',
  Overload: 'Surcharge',
  Replicate: 'Réplication',
  Transmute: 'Transmutation',
  Suspend: 'Suspension',
  Escape: 'Évasion',
  Unearth: 'Exhumation',
  Offering: 'Offrande',
  Prototype: 'Prototype',
  Blitz: 'Blitz',

  // --- Les déclenchées et les statiques nommées.
  Cascade: 'Cascade',
  Prowess: 'Prouesse',
  Exalted: 'Exalté',
  Extort: 'Extorsion',
  Storm: 'Tempête',
  Madness: 'Démence',
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
  Recover: 'Récupération',
  Reinforce: 'Renfort',
  Flanking: 'Flanquement',
  Phasing: 'Décalage',
  Vanishing: 'Évanescence',
  'Living weapon': 'Arme vivante',
  'Totem armor': 'Armure totem',
  Bushido: 'Bushido',
  Ninjutsu: 'Ninjutsu',
  Mentor: 'Mentor',
  Spectacle: 'Spectacle',
  Mutate: 'Mutation',
  Companion: 'Compagnon',

  // --- L'équipement et l'attachement.
  Equip: 'Équipement',
  Enchant: 'Enchanter',
  Fortify: 'Fortification',

  // --- Les actions-mots-clés. Scryfall les range dans le même tableau que les
  //     capacités, et il a raison : le joueur les cherche du même geste.
  Scry: 'Regard',
  Surveil: 'Surveillance',
  Explore: 'Exploration',
  Investigate: 'Enquêter',
  Fabricate: 'Fabrication',
  Devour: 'Dévorer',
  Discover: 'Découverte',
};

/**
 * Ce qu'on a **refusé** de traduire, et pourquoi — à consigner, faute de quoi
 * quelqu'un les « complétera » de mémoire.
 *
 * Cette table n'est lue par personne : elle est documentaire, et c'est
 * volontaire. Y ajouter une entrée coûte une ligne ; inventer « Anti-sort »
 * pour `Ward` coûterait la confiance dans les quatre-vingts autres.
 *
 * Le cas le plus gênant est en tête : trois capacités **permanentes** et très
 * courantes restent en anglais. C'est assumé — les rendre de mémoire sur des
 * mots que le joueur voit à chaque partie serait l'erreur la plus visible de
 * tout le glossaire.
 */
export const MOTS_CLES_EN_ANGLAIS: Readonly<Record<string, string>> = {
  Hexproof: 'capacité permanente très courante, mais le terme français officiel n’est pas vérifié — et se tromper ici se verrait à chaque partie',
  Shroud: '« écran total » est plausible, pas certain ; même famille que Hexproof, donc même refus',
  Ward: 'mécanique récente : aucun terme français vérifié',
  Morph: 'mot de mécanique autant que de jeton — déjà refusé dans `tokenNames.ts`, pour ne pas contredire le texte de règles',
  Manifest: 'même cas que Morph',
  Changeling: '« changelin » est une supposition',
  Delve: 'terme officiel non vérifié',
  Dredge: 'terme officiel non vérifié',
  Mill: '« meuler » est du jargon de joueur ; le terme imprimé n’est pas vérifié',
  Amass: 'terme officiel non vérifié',
  Adapt: '« adaptation » se confondrait avec le mot courant sans certitude sur le terme imprimé',
  Undying: 'terme officiel non vérifié ; ne pas le confondre avec Persist, qui est traduit',
  Poisonous: 'terme officiel non vérifié',
  Rampage: '« déchaînement » est plausible, pas certain',
  Entwine: 'terme officiel non vérifié',
  Banding: 'mécanique ancienne : terme officiel non vérifié',
  Fading: 'terme officiel non vérifié ; ne pas le confondre avec Vanishing, qui est traduit',
  'Split second': 'terme officiel non vérifié',
  'Level up': 'terme officiel non vérifié',
  Horsemanship: 'terme officiel non vérifié',
  Soulshift: 'terme officiel non vérifié',
  Soulbond: 'terme officiel non vérifié',
  Splice: 'terme officiel non vérifié',
  Scavenge: 'terme officiel non vérifié',
  Retrace: 'terme officiel non vérifié',
  Prowl: 'terme officiel non vérifié',
  Ripple: 'terme officiel non vérifié',
  Sunburst: 'terme officiel non vérifié',
  Hideaway: 'terme officiel non vérifié',
  Forecast: 'terme officiel non vérifié',
  Outlast: 'terme officiel non vérifié',
  Unleash: 'terme officiel non vérifié',
  Detain: 'terme officiel non vérifié',
  Cipher: 'terme officiel non vérifié',
  Exploit: 'terme officiel non vérifié',
  Riot: 'terme officiel non vérifié',
  Afterlife: 'terme officiel non vérifié',
  Foretell: 'terme officiel non vérifié',
  Boast: 'terme officiel non vérifié',
  Disturb: 'terme officiel non vérifié',
  Daybound: 'terme officiel non vérifié',
  Nightbound: 'terme officiel non vérifié',
  Cleave: 'terme officiel non vérifié',
  Casualty: 'terme officiel non vérifié',
  Connive: 'terme officiel non vérifié',
  Enlist: 'terme officiel non vérifié',
  'Read ahead': 'terme officiel non vérifié',
  Backup: 'terme officiel non vérifié',
  Incubate: 'terme officiel non vérifié',
  Bargain: 'terme officiel non vérifié',
  Craft: 'terme officiel non vérifié',
  Disguise: 'terme officiel non vérifié',
  Cloak: 'terme officiel non vérifié',
  Plot: 'terme officiel non vérifié',
  Saddle: 'terme officiel non vérifié',
  Spree: 'terme officiel non vérifié',
  Freerunning: 'terme officiel non vérifié',
  Offspring: 'terme officiel non vérifié',
  Impending: 'terme officiel non vérifié',
  Gift: 'terme officiel non vérifié',
  'For Mirrodin!': 'cri de guerre imprimé tel quel ; c’est une citation, pas un terme à traduire',
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

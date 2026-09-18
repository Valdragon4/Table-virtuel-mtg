import { useEffect, useState } from 'react';
import { HIDDEN_ZONES, type CardView, type Counter, type ObjectId, type SeatId } from '@mtg/shared';
import { useGame, zoneKey } from '../store/game.js';
import { CardBack } from './CardBack.js';
import { openDialog } from './Dialog.js';
import {
  BATTLEFIELD_SCALE,
  CARD_HEIGHT,
  CARD_WIDTH,
  PILE_SCALE,
  cardMeta,
  isDoubleFaced,
  scryfallImage,
  subscribeCards,
} from '../lib/cards.js';
import { localizedCard, localizedCardName, useLocalizationTick } from '../lib/cardLocalization.js';
import { cardLanguageMark, resolveCardImage, type CardLanguageMark } from '../lib/i18n/index.js';
import { useForceLocalizedPrinting, useLanguage } from '../store/prefs.js';

/**
 * Les dimensions de référence vivent dans `lib/cards.ts`, parce que le calcul
 * de dépôt en a besoin sans dépendre d'un composant. On les réexporte ici, où
 * les appelants s'attendent à les trouver.
 */
export { BATTLEFIELD_SCALE, CARD_HEIGHT, CARD_WIDTH, PILE_SCALE };

/** Force un rendu quand les métadonnées d'une carte arrivent du serveur. */
export function useCardMetaTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeCards(() => setTick((t) => t + 1)), []);
  return tick;
}

/**
 * Une carte est-elle révélée, au sens « son identité est connue d'un siège qui,
 * sans la révélation, ne la verrait pas » ?
 *
 * **Ce que le client sait, et ce qu'il ne sait pas.** `knownTo` n'est pas publié
 * — c'est de l'information cachée (§2 du protocole), et `PublicCardView` ne
 * porte rien qui s'en approche. Le client ne peut donc **pas** répondre à la
 * question dans le sens qui intéresse le plus : « ma carte est-elle vue par
 * quelqu'un d'autre ? ». Il n'existe qu'un seul état de révélation dans le
 * store, `handsRevealed`, et il est alimenté par `HAND_REVEALED`, que le
 * serveur n'adresse **qu'aux destinataires**. Révéler une carte à un seul
 * adversaire ne vous en apprend donc rien à vous, et rien n'est inventé ici
 * pour combler ce trou.
 *
 * Restent deux déductions, exactes toutes les deux :
 *
 * 1. `'to-me'` — la carte est dans une zone cachée (`HIDDEN_ZONES` : main,
 *    bibliothèque, réserve, face cachée temporaire) **d'un autre siège** et
 *    j'en vois pourtant l'identité. Le serveur ne me l'aurait jamais envoyée
 *    sans une révélation : c'est donc à moi qu'on l'a montrée.
 * 2. `'from-me'` — c'est ma propre main et je sais qu'elle est révélée, ce qui
 *    n'arrive que si je l'ai révélée à toute la table (`REVEAL_HAND` vers
 *    `ALL` m'inclut dans les destinataires, donc l'événement me revient).
 *
 * Ce qu'il faudrait publier pour couvrir le reste — une carte de ma main
 * montrée à un seul joueur, mon commandant révélé, une carte de bibliothèque
 * exilée face visible pour un seul siège : un champ **dérivé et minimal** sur
 * `PublicCardView`, du genre `revealedTo?: SeatId[]` — la liste des sièges qui
 * connaissent l'identité **en plus** de ceux qui la verraient de toute façon
 * (propriétaire, zone publique). Ce champ n'apprend rien d'une carte qu'on ne
 * voit pas : il ne va que sur une vue déjà publique pour son destinataire, et
 * la liste blanche de `HiddenCardView` reste intacte. Il faudrait aussi
 * qu'`UNREVEAL_HAND`, qui est déjà diffusé à tous, ait son pendant pour une
 * carte isolée.
 */
function revealFlag(
  card: CardView,
  mySeat: SeatId | null,
  myHandRevealed: boolean,
): 'to-me' | 'from-me' | null {
  if (card.faceDown !== false) return null;

  /*
   * `revealedTo` est la reponse directe du serveur : les sieges a qui cette
   * carte a ete montree et qui ne la verraient pas autrement. Les deux
   * deductions qui suivent l'ont precede, faute de cette donnee ; elles restent
   * comme filet, mais c'est ce champ qui fait foi — et lui seul repond a la
   * question du proprietaire, « qui connait ma carte ? ».
   */
  if (card.zone.seat === mySeat && (card.revealedTo?.length ?? 0) > 0) return 'from-me';
  if (HIDDEN_ZONES.has(card.zone.kind) && card.zone.seat !== mySeat) return 'to-me';
  if (card.zone.kind === 'HAND' && card.zone.seat === mySeat && myHandRevealed) return 'from-me';
  return null;
}

/**
 * Un marqueur de force/endurance, lu dans son `kind`.
 *
 * **Rien n'est ajouté au protocole** : un marqueur reste `{ kind, value? }` et
 * `kind` est du texte libre, donc « +1/+1 », « -1/-1 », « +2/+0 » et « X/X »
 * s'y écrivent déjà — c'est l'interface, et elle seule, qui ne savait pas les
 * poser. La forme se **lit** dans le nom, comme `valueShape` la lit dans la
 * valeur d'une étiquette de table ; la stocker à part serait une donnée de plus
 * à garder cohérente, et une version de protocole à monter pour rien.
 *
 * `value` compte alors les marqueurs : trois marqueurs +1/+1, et non « +3/+3 ».
 * C'est la règle du jeu, et c'est ce que le journal du serveur raconte déjà.
 */
export interface PtCounter {
  left: string;
  right: string;
  /** Ce que le marqueur fait à la créature : grandir, rétrécir, ou les deux. */
  tone: 'gain' | 'loss' | 'mixed';
}

/** « +1/+1 », « -1/-1 », « +2/+0 », « X/X » — X compris, il s'en pose. */
const PT_KIND = /^([+-]?(?:\d{1,3}|[xX]))\s*\/\s*([+-]?(?:\d{1,3}|[xX]))$/;

export function ptCounter(kind: string): PtCounter | null {
  const parts = PT_KIND.exec(kind.trim());
  if (!parts) return null;
  const left = parts[1] ?? '';
  const right = parts[2] ?? '';
  // Un X ne se compare pas : sa valeur n'est connue qu'à la résolution.
  const n = (side: string): number => (/[xX]/.test(side) ? Number.NaN : Number(side));
  const l = n(left);
  const r = n(right);
  const tone =
    Number.isNaN(l) || Number.isNaN(r)
      ? 'mixed'
      : l >= 0 && r >= 0
        ? 'gain'
        : l <= 0 && r <= 0
          ? 'loss'
          : 'mixed';
  return { left, right, tone };
}

/** Une modification additive et entièrement signée : « +1/+1 », « -1/-1 », « +2/+0 ». */
const SIGNED_INT = /^[+-]\d+$/;

/**
 * L'**effet cumulé** de plusieurs exemplaires d'un même marqueur.
 *
 * Huit marqueurs -1/-1 s'affichaient « -1/-1 ×8 », et l'on devait faire la
 * multiplication de tête pour savoir de combien la créature avait rétréci. À une
 * vraie table on ne compte pas les cubes un par un : on lit le total, « -8/-8 ».
 * C'est ce total que la pastille montre désormais.
 *
 * **Le compte de marqueurs n'est pas perdu pour autant, et il ne doit pas
 * l'être** : au sens des règles, la créature porte huit marqueurs -1/-1 et non
 * un marqueur -8/-8 — c'est ce nombre-là que le journal du serveur raconte, que
 * `ADD_COUNTER` incrémente, et sur lequel les boutons − et + du menu agissent.
 * Il reste donc lisible dans l'infobulle, dans le menu de carte, et dans
 * l'attribut `data-counter-count` de la pastille.
 *
 * **Ce qui n'est pas sommable ne l'est pas.**
 *   - `X/X` : la valeur d'un X n'est connue qu'à la résolution, la multiplier
 *     serait inventer un nombre. On garde « X/X ×3 ».
 *   - `2/2` sans signe : deux nombres nus se lisent comme une force/endurance
 *     **fixée** (la ligne d'un jeton), pas comme une modification. Les tripler
 *     donnerait « 6/6 », ce qui est faux. On garde « 2/2 ×3 ».
 * D'où la règle : on n'agrège que si les **deux** côtés portent un signe
 * explicite, seul cas où « ajouter n fois » a un sens.
 *
 * Deux marqueurs de `kind` différents ne fusionnent jamais : une créature qui
 * porte des +1/+1 **et** des -1/-1 porte bien deux marqueurs distincts au sens
 * des règles, même si leur effet s'annule — ce sont deux entrées de `counters`,
 * donc deux pastilles, et rien ici ne les additionne.
 */
export function ptAggregate(pt: PtCounter, value: number | undefined): PtCounter | null {
  if (value === undefined || value <= 1) return null;
  if (!SIGNED_INT.test(pt.left) || !SIGNED_INT.test(pt.right)) return null;
  const total = (side: string): string => {
    const n = Number(side) * value;
    // Le signe reste explicite, y compris pour zéro : « +0 » dit « ne change
    // pas l'endurance », là où « 0 » se lirait comme une endurance de zéro.
    return n >= 0 ? `+${n}` : String(n);
  };
  return { left: total(pt.left), right: total(pt.right), tone: pt.tone };
}

/* ------------------------------------------------------------------------- *
 * Marqueurs calculés — les « effets classiques » à caractéristique variable.
 * ------------------------------------------------------------------------- */

/**
 * Un marqueur dont la valeur **se recalcule toute seule**.
 *
 * Le besoin : les créatures dont la force et l'endurance dépendent d'un
 * décompte qui bouge en cours de partie. *Lumra, mugissement des bois* vaut le
 * nombre de terrains que vous contrôlez ; *Old Stickfingers* le nombre de cartes
 * de créature dans votre cimetière ; le *Lhurgoyf d'Urborg* a une force égale à
 * ce même nombre et une endurance égale à ce nombre **plus un** ; un Maro vaut
 * le nombre de cartes dans votre main. Poser « 4/4 » à la main condamne à le
 * corriger à chaque pioche, et l'on oublie.
 *
 * ## Pourquoi le calcul est **côté client**, et pourquoi c'est le choix sûr
 *
 * L'autre chemin — recalculer côté serveur, à la façon de `reconcileTopReveals`
 * en fin de `Room.commit` — coûterait un champ de protocole, une réconciliation,
 * une version à monter, et **ouvrirait la seule brèche de confidentialité
 * possible** : un permanent est public, donc la valeur qu'on peindrait dessus
 * partirait vers toute la table ; calculer côté serveur « créatures dans ma
 * main » reviendrait à publier une statistique d'une zone cachée. Il faudrait
 * alors filtrer par siège une pastille que tout le monde voit — c'est-à-dire
 * afficher des nombres différents sur la même carte selon qui regarde, ce qui
 * n'est plus une table partagée.
 *
 * Le calcul client renverse le problème : **le client ne peut calculer que ce
 * qu'il détient déjà**, et il ne détient que du public. La contrainte de
 * confidentialité devient structurelle plutôt que gardée — rien de neuf ne
 * traverse le socket, puisque rien ne le traverse du tout.
 *
 * Reste l'exigence de convergence : deux clients doivent peindre le **même**
 * nombre sur la même carte. C'est pourquoi le catalogue ci-dessous est
 * strictement limité aux décomptes **publics pour tout le monde** — comptes de
 * zones, contenus des zones énumérables (cimetière, exil, champ de bataille),
 * totaux de points de vie. Tout décompte qui exigerait le **contenu** d'une main,
 * d'une bibliothèque ou d'une réserve est refusé à la source, et le dialogue le
 * dit (voir `HIDDEN_REFUSAL`).
 *
 * ## Pourquoi le protocole ne bouge pas
 *
 * Un marqueur reste `{ kind, value? }`. La formule tient dans `kind`, qui est du
 * texte libre borné à 32 caractères — exactement comme la forme force/endurance
 * se relit déjà dans le nom plutôt que d'être stockée à part. `value` est
 * **omis** : il compte des marqueurs *posés*, et un marqueur calculé n'en pose
 * aucun ; l'y détourner en multiplicateur ferait changer de sens aux boutons −
 * et + du menu. `PROTOCOL_VERSION` reste donc à 3.
 *
 * ## La grammaire du `kind`
 *
 * Voir le bloc d'exemples juste en dessous, qui ne peut pas tenir dans ce
 * commentaire-ci : un gabarit comme « étoile barre étoile » y fermerait le
 * commentaire au milieu d'une phrase.
 *
 * Le gabarit est une expression linéaire du décompte, côté par côté : l'étoile
 * vaut le décompte, précédée d'un signe elle l'affiche comme un gain, suivie de
 * `+1` elle vaut le décompte plus un, et deux chiffres nus sont une constante.
 * Un signe explicite sur un côté veut dire « ceci **s'ajoute** à la force
 * imprimée » ; son absence, « ceci **est** la force ». C'est la distinction que
 * les cartes font elles-mêmes entre « force et endurance égales au nombre de… »
 * et « gagne +1/+1 pour chaque… », et elle change ce qu'on lit.
 *
 * Le code est compact plutôt que rédigé en français, et c'est un compromis
 * assumé : la limite de 32 caractères de `kind` ne laisse pas la place à
 * « terrains que vous contrôlez ». L'utilisateur ne le saisit jamais à la main —
 * le dialogue propose des entrées toutes prêtes — mais il le verra passer dans
 * le journal du serveur, où il reste déchiffrable.
 */
// Grammaire, et le banc d'essai qui l'a dimensionnée :
//
//   ∑<gabarit> <source>@<portée>
//
//   ∑*/*   bat.land@vous      → Lumra, mugissement des bois
//                               (force et endurance = terrains que vous contrôlez)
//   ∑*/*   cim.creature@vous  → Old Stickfingers
//                               (= cartes de créature dans votre cimetière)
//   ∑*/*+1 cim.creature@vous  → Lhurgoyf d'Urborg, qui est */1+* :
//                               endurance = ce même nombre, plus un
//   ∑*/*+1 cim.types@tous     → Tarmogoyf (types de cartes, tous cimetières)
//   ∑+*/+* cim.creature@tous  → un « +1/+1 pour chaque… », en additif
//   ∑*/*   main@vous          → un Maro
//   ∑*/*   cim.creature@adv   → le cimetière d'en face, public donc licite
export interface ComputedSide {
  /** 0 : constante. 1 : le décompte. -1 : son opposé. */
  coef: -1 | 0 | 1;
  offset: number;
  /** Le côté portait un signe explicite : c'est une modification, pas une valeur. */
  signed: boolean;
}

export interface ComputedSpec {
  left: ComputedSide;
  right: ComputedSide;
  /** Code de la ligne de catalogue, par exemple `cim.creature`. */
  source: string;
  scope: 'vous' | 'adv' | 'tous';
}

/** Le sigle qui ouvre tout `kind` calculé. Aucun nom de marqueur usuel ne le porte. */
export const COMPUTED_SIGIL = '∑';

// La source accepte le `:` et le `-` : `bat:humain`, `cim:assembly-worker`.
const COMPUTED_KIND = /^∑\s*(\S+)\s+([a-z0-9.:-]+)@(vous|adv|tous)$/;
const COMPUTED_SIDE = /^([+-]?)\*([+-]\d+)?$/;
const COMPUTED_CONST = /^([+-]?)(\d+)$/;

function parseSide(raw: string): ComputedSide | null {
  const star = COMPUTED_SIDE.exec(raw);
  if (star) {
    const sign = star[1] ?? '';
    return { coef: sign === '-' ? -1 : 1, offset: Number(star[2] ?? 0), signed: sign !== '' };
  }
  const flat = COMPUTED_CONST.exec(raw);
  if (flat) {
    const sign = flat[1] ?? '';
    return { coef: 0, offset: Number(`${sign === '-' ? '-' : ''}${flat[2]}`), signed: sign !== '' };
  }
  return null;
}

/** Lit un `kind` calculé, ou rend `null` si ce n'en est pas un. */
export function computedCounter(kind: string): ComputedSpec | null {
  const parts = COMPUTED_KIND.exec(kind.trim());
  if (!parts) return null;
  const sides = (parts[1] ?? '').split('/');
  if (sides.length !== 2) return null;
  const left = parseSide(sides[0] ?? '');
  const right = parseSide(sides[1] ?? '');
  if (!left || !right) return null;
  return { left, right, source: parts[2] ?? '', scope: (parts[3] ?? 'vous') as ComputedSpec['scope'] };
}

/**
 * Familles de types, relues dans la ligne de type Scryfall.
 *
 * Le mot-clé est en anglais parce que `CardMeta.typeLine` l'est
 * (`Legendary Creature — Human Wizard`) ; seuls les **types** comptent, jamais
 * les sous-types, qui vivent après le tiret cadratin — sans quoi un
 * « Basic Land — Island » serait un terrain deux fois et une « Enchantment —
 * Aura » n'importe quoi.
 *
 * C'est le même calcul que `typeFamilyKey` dans `ZonePanel.tsx`, et la
 * duplication est délibérée : `ZonePanel` importe déjà `CardSprite`, l'importer
 * en retour fermerait un cycle de modules. Le jour où une troisième
 * utilisation apparaît, la fonction mérite son propre fichier de `lib/`.
 */
const TYPE_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['creature', 'creature'],
  ['land', 'land'],
  ['artifact', 'artifact'],
  ['enchantment', 'enchantment'],
  ['instant', 'instant'],
  ['sorcery', 'sorcery'],
  ['planeswalker', 'planeswalker'],
  // Pas proposés au filtrage, mais comptés dans « nombre de types » : un
  // Tarmogoyf regarde bien *tous* les types présents, pas seulement les sept
  // grands.
  ['battle', 'battle'],
  ['kindred', 'kindred'],
  ['tribal', 'kindred'],
];

export function typeFamilies(typeLine: string): Set<string> {
  const types = typeLine
    .split('//')
    .map((face) => face.split('—')[0] ?? '')
    .join(' ')
    .toLowerCase();
  const found = new Set<string>();
  for (const [keyword, family] of TYPE_KEYWORDS) if (types.includes(keyword)) found.add(family);
  return found;
}

/* ------------------------------------------------------------------------- *
 * Sous-types : « +1/+1 pour chaque Humain ».
 * ------------------------------------------------------------------------- */

/**
 * Repli d'un sous-type : minuscules, sans accents, mots liés par un tiret.
 *
 * `Assembly-Worker` → `assembly-worker`, `Humain` → `humain`, `TIME LORD` →
 * `time-lord`. C'est la forme sous laquelle un sous-type entre dans un `kind`,
 * et sous laquelle on le compare à ce qu'une ligne de type porte.
 */
function foldSubtype(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Le pont entre ce que le joueur tape et ce que la fiche porte.
 *
 * **Les fiches sont en anglais.** `CardMeta` n'expose que `typeLine`, telle que
 * Scryfall la publie — `Legendary Creature — Human Wizard` —, et il n'existe
 * aucun champ de sous-types à interroger : c'est la ligne, et elle seule. Or le
 * joueur tape « humain », parce que toute l'interface est en français. Sans ce
 * lexique, « +1/+1 pour chaque humain » compterait zéro et l'on chercherait la
 * faute pendant dix minutes.
 *
 * Il est **symétrique par construction** : on canonise les deux côtés avant de
 * comparer. Le jour où les fiches passeront en français (c'est au backlog, et la
 * colonne `lang` existe déjà), une ligne « Créature légendaire — Humain
 * Sorcier » se canonisera elle aussi en `human`, et rien de ce code ne bougera.
 * Tant qu'un sous-type manque au lexique, il se compare tel quel : un mot
 * anglais tapé directement marche toujours, un mot français inconnu compte zéro
 * — et la pastille le dit, plutôt que de faire semblant.
 *
 * Le critère de la liste : les tribus qu'on joue réellement, celles qui ont des
 * seigneurs. Elle s'allonge sans rien casser.
 */
const SUBTYPE_ALIASES: Readonly<Record<string, string>> = {
  // Les tribus les plus jouées
  humain: 'human', gobelin: 'goblin', elfe: 'elf', ondin: 'merfolk', zombi: 'zombie',
  vampire: 'vampire', dragon: 'dragon', ange: 'angel', demon: 'demon', diable: 'devil',
  esprit: 'spirit', bete: 'beast', dinosaure: 'dinosaur', hydre: 'hydra', sphinx: 'sphinx',
  // Les classes
  soldat: 'soldier', sorcier: 'wizard', guerrier: 'warrior', clerc: 'cleric', druide: 'druid',
  roublard: 'rogue', chevalier: 'knight', barde: 'bard', berserker: 'berserker', moine: 'monk',
  assassin: 'assassin', eclaireur: 'scout', archer: 'archer', chaman: 'shaman', noble: 'noble',
  paysan: 'peasant', citoyen: 'citizen', mercenaire: 'mercenary', rebelle: 'rebel',
  artificier: 'artificer', pilote: 'pilot', samourai: 'samurai', ninja: 'ninja', pirate: 'pirate',
  // Les peuples et les monstres
  geant: 'giant', nain: 'dwarf', orque: 'orc', ogre: 'ogre', troll: 'troll', kobold: 'kobold',
  minotaure: 'minotaur', gorgone: 'gorgon', meduse: 'gorgon', fee: 'faerie',
  sylvin: 'treefolk', squelette: 'skeleton', spectre: 'specter', ombre: 'shade',
  horreur: 'horror', cauchemar: 'nightmare', mutant: 'mutant', avatar: 'avatar', dieu: 'god',
  illusion: 'illusion', incarnation: 'incarnation', sbire: 'minion', serviteur: 'minion',
  // La faune et la flore
  loup: 'wolf', 'loup-garou': 'werewolf', chat: 'cat', chien: 'dog', ours: 'bear',
  sanglier: 'boar', elan: 'elk', cerf: 'elk', cheval: 'horse', licorne: 'unicorn',
  pegase: 'pegasus', griffon: 'griffin', oiseau: 'bird', serpent: 'snake', araignee: 'spider',
  insecte: 'insect', scorpion: 'scorpion', rat: 'rat', 'chauve-souris': 'bat', poisson: 'fish',
  crabe: 'crab', pieuvre: 'octopus', kraken: 'kraken', leviathan: 'leviathan', tortue: 'turtle',
  plante: 'plant', champignon: 'fungus', fongus: 'fungus', saprolin: 'saproling',
  // Les artefacts et enchantements qu'on compte aussi
  elementaire: 'elemental', golem: 'golem', construction: 'construct', mur: 'wall',
  epouvantail: 'scarecrow', gargouille: 'gargoyle', phyrexian: 'phyrexian',
  equipement: 'equipment', vehicule: 'vehicle', tresor: 'treasure', indice: 'clue',
  nourriture: 'food', aura: 'aura', saga: 'saga', fortification: 'fortification',
};

/** Le chemin retour, pour réécrire un `kind` en français dans l'infobulle. */
const SUBTYPE_FRENCH: ReadonlyMap<string, string> = new Map(
  Object.entries(SUBTYPE_ALIASES).map(([fr, en]) => [en, fr]),
);

/** La forme canonique d'un sous-type, d'où qu'il vienne — saisie ou ligne de type. */
export function canonSubtype(raw: string): string {
  const folded = foldSubtype(raw);
  return SUBTYPE_ALIASES[folded] ?? folded;
}

/**
 * Le lexique connaît-il ce mot comme un sous-type ?
 *
 * Sert au dialogue à trancher un cas de collision : « chat » est un sous-type,
 * et pourrait un jour être un morceau du libellé d'une entrée du catalogue. On
 * propose alors quand même le sous-type, au lieu de le rendre inatteignable.
 */
export function isKnownSubtype(raw: string): boolean {
  const folded = foldSubtype(raw);
  return folded in SUBTYPE_ALIASES || SUBTYPE_FRENCH.has(folded);
}

/** Comment l'écrire à l'écran : en français quand on le connaît, tel quel sinon. */
export function subtypeLabel(canon: string): string {
  const word = SUBTYPE_FRENCH.get(canon) ?? canon;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Les sous-types que porte une ligne de type, sous forme canonique.
 *
 * Seule la partie **après le tiret cadratin** compte : c'est là que vivent les
 * sous-types, et la partie d'avant est faite de types, qui ont leur propre
 * catalogue. Les paires de mots adjacents sont testées en plus des mots seuls,
 * pour les rares sous-types en deux mots (« Time Lord »).
 */
export function subtypesOf(typeLine: string): Set<string> {
  const found = new Set<string>();
  for (const face of typeLine.split('//')) {
    const cut = face.indexOf('—');
    if (cut < 0) continue;
    const mots = face
      .slice(cut + 1)
      .split(/\s+/)
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    for (let i = 0; i < mots.length; i += 1) {
      found.add(canonSubtype(mots[i] ?? ''));
      const suivant = mots[i + 1];
      if (suivant !== undefined) found.add(canonSubtype(`${mots[i]} ${suivant}`));
    }
  }
  found.delete('');
  return found;
}

/**
 * Le catalogue des décomptes proposés — les « effets classiques » du jeu.
 *
 * Tous sont **publics pour toute la table**, et c'est le critère d'entrée :
 *   - un compte de zone (main, bibliothèque) est publié par `ZONE_COUNT` et
 *     s'affiche déjà sur le plateau ;
 *   - le contenu d'un cimetière, d'un exil ou d'un champ de bataille est
 *     énumérable par construction (§2) : chaque client en a les cartes ;
 *   - un total de points de vie est dans `SeatSummary`.
 *
 * Ce qui n'y est **pas**, et pourquoi : « créatures dans une main »,
 * « terrains dans une bibliothèque », quoi que ce soit dans une réserve. Le
 * *nombre* de cartes d'une main est public, son *contenu* ne l'est pas ; un
 * décompte par type y exigerait de l'information cachée, et il est refusé plutôt
 * qu'approché.
 */
export interface CountSource {
  code: string;
  /** Libellé du dialogue et de l'infobulle. */
  label: string;
  /** Intitulé du groupe dans la liste du dialogue. */
  group: string;
  zone: 'HAND' | 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'BATTLEFIELD' | 'LIFE';
  /** Famille de types exigée, sinon toutes les cartes de la zone comptent. */
  family?: string;
  /** Compte les **types distincts** présents, et non les cartes (Tarmogoyf). */
  distinctTypes?: boolean;
  /** Le code est un **préfixe** : un sous-type le complète (`bat:` + `humain`). */
  subtype?: boolean;
}

const G_JOUEUR = 'Joueur';
const G_CIM = 'Cimetière';
const G_EXIL = 'Exil';
const G_BAT = 'Champ de bataille';

export const COUNT_SOURCES: readonly CountSource[] = [
  { code: 'main', label: 'cartes en main', group: G_JOUEUR, zone: 'HAND' },
  { code: 'biblio', label: 'cartes en bibliothèque', group: G_JOUEUR, zone: 'LIBRARY' },
  { code: 'vie', label: 'points de vie', group: G_JOUEUR, zone: 'LIFE' },

  { code: 'cim', label: 'cartes au cimetière', group: G_CIM, zone: 'GRAVEYARD' },
  { code: 'cim.creature', label: 'cartes de créature au cimetière', group: G_CIM, zone: 'GRAVEYARD', family: 'creature' },
  { code: 'cim.land', label: 'cartes de terrain au cimetière', group: G_CIM, zone: 'GRAVEYARD', family: 'land' },
  { code: 'cim.artifact', label: "cartes d'artefact au cimetière", group: G_CIM, zone: 'GRAVEYARD', family: 'artifact' },
  { code: 'cim.ench', label: "cartes d'enchantement au cimetière", group: G_CIM, zone: 'GRAVEYARD', family: 'enchantment' },
  { code: 'cim.instant', label: 'éphémères au cimetière', group: G_CIM, zone: 'GRAVEYARD', family: 'instant' },
  { code: 'cim.sorcery', label: 'rituels au cimetière', group: G_CIM, zone: 'GRAVEYARD', family: 'sorcery' },
  { code: 'cim.types', label: 'types de cartes au cimetière', group: G_CIM, zone: 'GRAVEYARD', distinctTypes: true },

  { code: 'exil', label: 'cartes en exil', group: G_EXIL, zone: 'EXILE' },
  { code: 'exil.creature', label: 'cartes de créature en exil', group: G_EXIL, zone: 'EXILE', family: 'creature' },

  { code: 'bat.creature', label: 'créatures sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD', family: 'creature' },
  { code: 'bat.land', label: 'terrains sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD', family: 'land' },
  { code: 'bat.artifact', label: 'artefacts sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD', family: 'artifact' },
  { code: 'bat.ench', label: 'enchantements sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD', family: 'enchantment' },
  { code: 'bat.pw', label: 'planeswalkers sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD', family: 'planeswalker' },
  { code: 'bat.perm', label: 'permanents sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD' },
];

/**
 * Les trois zones **publiques** où l'on peut compter un sous-type.
 *
 * Pas de main, pas de bibliothèque, pas de réserve : le *nombre* de cartes
 * d'une main est public, mais savoir combien d'Humains s'y trouvent exige son
 * contenu. C'est le même refus que pour les types, tenu au même endroit, et il
 * mord plus fort ici puisque « pour chaque Humain dans votre main » est un
 * effet qui existe vraiment.
 */
export const SUBTYPE_SOURCES: readonly CountSource[] = [
  { code: 'bat:', label: 'sur le champ de bataille', group: G_BAT, zone: 'BATTLEFIELD', subtype: true },
  { code: 'cim:', label: 'au cimetière', group: G_CIM, zone: 'GRAVEYARD', subtype: true },
  { code: 'exil:', label: 'en exil', group: G_EXIL, zone: 'EXILE', subtype: true },
];

/**
 * Les sous-types offerts d'emblée, sans rien taper.
 *
 * Critère : les tribus qui ont réellement des seigneurs qu'on joue — celles
 * pour lesquelles « +1/+1 pour chaque X » est une carte existante, pas une
 * hypothèse. Sur le **champ de bataille** seulement, qui est le cas de très
 * loin le plus fréquent ; les deux autres zones s'atteignent en tapant le
 * sous-type, qui les propose toutes les trois.
 */
export const COMMON_SUBTYPES: readonly string[] = [
  'angel', 'human', 'goblin', 'elf', 'zombie', 'soldier', 'wizard', 'vampire', 'merfolk', 'dragon', 'spirit',
];

/**
 * Les entrées de sous-type à proposer pour une saisie donnée.
 *
 * Saisie vide : les tribus courantes, sur le champ de bataille. Saisie non
 * vide : ce que l'on vient d'écrire, dans les trois zones publiques — un seul
 * geste pour chercher **et** pour déclarer un sous-type qui n'est dans aucune
 * liste. Les 350 sous-types de créature du jeu, plus ceux des artefacts, des
 * enchantements et des terrains, ne tiendraient de toute façon pas dans une
 * liste.
 */
export function subtypeOptions(
  query: string,
): Array<{ value: string; label: string; group: string; keywords: string }> {
  const brut = query.trim();
  if (brut === '') {
    return COMMON_SUBTYPES.map((canon) => ({
      value: `bat:${canon}`,
      label: `${subtypeLabel(canon)}s sur le champ de bataille`,
      group: 'Sous-types courants',
      keywords: `${canon} sous-type tribu`,
    }));
  }
  const canon = canonSubtype(brut);
  if (canon === '') return [];
  return SUBTYPE_SOURCES.map((source) => ({
    value: `${source.code}${canon}`,
    label: `${subtypeLabel(canon)}s ${source.label}`,
    group: `Sous-type « ${subtypeLabel(canon)} »`,
    keywords: `${canon} ${brut}`,
  })).filter((option) => option.value.length <= MAX_SOURCE_LENGTH);
}

/**
 * Ce qu'une source a le droit de mesurer en caractères, pour que le `kind`
 * complet tienne dans les 32 du protocole.
 *
 * Le budget se compte à l'envers : `∑` (1) + le gabarit le plus long (`*​/*+1`,
 * `+*​/+*`, 5) + l'espace (1) + `@` et la portée la plus longue (`@vous`,
 * `@tous`, 5) laissent **20 caractères** à la source. Le pire sous-type réel du
 * jeu est `Assembly-Worker`, 15 caractères une fois replié — mesuré sur les
 * quatre catalogues de Scryfall (créature, artefact, enchantement, terrain :
 * 401 sous-types, maximum 15). Avec le préfixe de zone le plus long (`exil:`,
 * 5), on arrive à **exactement 32**. La borne tient, et `PROTOCOL_VERSION` ne
 * bouge donc pas d'un cran.
 */
const MAX_SOURCE_LENGTH = 32 - 1 - 5 - 1 - 5;

/**
 * Ce qu'on ne proposera pas, et qu'il faut dire plutôt que taire.
 *
 * Affiché tel quel au bas du dialogue : un joueur qui cherche « créatures dans
 * ma main » doit comprendre que c'est un refus délibéré, et non un oubli.
 */
export const HIDDEN_REFUSAL =
  'Le nombre de cartes d’une main ou d’une bibliothèque est public et se compte ; leur contenu ne l’est pas. ' +
  'Un décompte par type dans une main, une bibliothèque ou une réserve est donc refusé : il traverserait le socket ' +
  'vers des sièges qui n’y ont pas droit.';

const SCOPE_LABEL: Record<ComputedSpec['scope'], string> = {
  vous: 'du contrôleur de cette carte',
  adv: 'de ses adversaires',
  tous: 'de toute la table',
};

type GameState = ReturnType<typeof useGame.getState>;

function scopeSeats(state: GameState, card: CardView, scope: ComputedSpec['scope']): Set<SeatId> {
  const mine = card.controller;
  const all = state.seats.map((s) => s.id);
  if (scope === 'vous') return new Set([mine]);
  if (scope === 'adv') return new Set(all.filter((s) => s !== mine));
  return new Set(all);
}

/**
 * Caractéristique numérique d'une carte (force, endurance, ou marqueurs),
 * prenant en compte la valeur imprimée et les marqueurs posés.
 */
export function getCardStat(c: CardView, stat: 'power' | 'toughness' | 'counters'): number {
  if (stat === 'counters') {
    return (c.counters ?? []).reduce((sum, k) => sum + (k.value ?? 1), 0);
  }
  const scryfallId = c.faceDown === false ? c.scryfallId : undefined;
  const meta = cardMeta(scryfallId);
  const raw = stat === 'power' ? meta?.power : meta?.toughness;
  let val = raw ? Number.parseInt(raw, 10) : 0;
  if (Number.isNaN(val)) val = 0;
  for (const counter of c.counters ?? []) {
    const pt = ptCounter(counter.kind);
    if (!pt) continue;
    const side = stat === 'power' ? pt.left : pt.right;
    if (/^[+-]\d+$/.test(side)) {
      val += Number.parseInt(side, 10) * (counter.value ?? 1);
    } else if (/^\d+$/.test(side)) {
      val = Number.parseInt(side, 10);
    }
  }
  return val;
}

/**
 * Le décompte, tel que **ce client** peut l'établir.
 *
 * `approx` dit qu'une carte de la zone n'a pas pu être classée — face cachée en
 * exil, ou fiche Scryfall pas encore arrivée. Le nombre est alors un plancher,
 * et la pastille le signale au lieu de le faire passer pour exact.
 */
export function resolveSource(code: string): { source: CountSource; subtype: string | null } | null {
  if (code.startsWith('self:') || code.startsWith('card:')) return null;
  const cut = code.indexOf(':');
  if (cut < 0) {
    const source = COUNT_SOURCES.find((s) => s.code === code);
    return source ? { source, subtype: null } : null;
  }
  const source = SUBTYPE_SOURCES.find((s) => s.code === code.slice(0, cut + 1));
  const subtype = code.slice(cut + 1);
  return source && subtype !== '' ? { source, subtype } : null;
}

export function measureCount(
  state: GameState,
  spec: ComputedSpec,
  card: CardView,
): { n: number; approx: boolean } | null {
  if (spec.source.startsWith('self:')) {
    const stat = spec.source.slice(5) as 'power' | 'toughness' | 'counters';
    return { n: getCardStat(card, stat), approx: false };
  }
  if (spec.source.startsWith('card:')) {
    const match = /^card:([^:]+):(power|toughness|counters)$/.exec(spec.source);
    if (match) {
      const targetId = match[1];
      const target = targetId ? state.cards.get(targetId) : undefined;
      if (!target) return null;
      return { n: getCardStat(target, match[2] as 'power' | 'toughness' | 'counters'), approx: false };
    }
  }

  const resolved = resolveSource(spec.source);
  if (!resolved) return null;
  const { source, subtype } = resolved;
  const seats = scopeSeats(state, card, spec.scope);

  if (source.zone === 'LIFE') {
    let n = 0;
    // `life` est tenu à jour par `LIFE_CHANGED`, et c'est du public : le total
    // de points de vie s'affiche déjà sur chaque panneau de siège.
    for (const seat of state.seats) if (seats.has(seat.id)) n += seat.life;
    return { n, approx: false };
  }
  if (source.zone === 'HAND' || source.zone === 'LIBRARY') {
    let n = 0;
    /*
     * **`zoneCounts`, et surtout pas `SeatSummary.handCount`.**
     *
     * Une main et une bibliothèque ne sont pas énumérables : seul leur compte
     * existe côté client. Or `handCount` n'est renseigné que par la projection
     * du snapshot — aucun event ne le rafraîchit —, et il vaut donc encore sept
     * après cinq cartes jouées. `ZONE_COUNT`, lui, est émis à chaque mouvement
     * et fait autorité : c'est la source qu'utilise déjà la main d'en face. La
     * sonde l'a attrapé sur le fait, le marqueur « par carte en main » restant
     * figé à la pioche.
     */
    for (const seat of seats) n += state.zoneCounts.get(zoneKey({ seat, kind: source.zone })) ?? 0;
    return { n, approx: false };
  }

  let n = 0;
  let approx = false;
  const types = new Set<string>();
  for (const other of state.cards.values()) {
    if (other.zone.kind !== source.zone) continue;
    /* « Que vous contrôlez » se lit sur `controller` au champ de bataille — une
       créature volée compte pour son voleur. Dans un cimetière ou un exil, c'est
       la zone qui désigne son propriétaire. */
    const holder = source.zone === 'BATTLEFIELD' ? other.controller : other.zone.seat;
    if (!seats.has(holder)) continue;
    if (source.family === undefined && !source.distinctTypes && subtype === null) {
      n += 1;
      continue;
    }
    if (other.faceDown !== false) {
      approx = true;
      continue;
    }
    const line = cardMeta(other.scryfallId)?.typeLine;
    if (line === undefined) {
      approx = true;
      continue;
    }
    if (subtype !== null) {
      // Le sous-type ne se lit qu'après le tiret cadratin, et les deux côtés
      // sont canonisés avant comparaison : « humain » trouve « Human ».
      if (subtypesOf(line).has(subtype)) n += 1;
      continue;
    }
    const families = typeFamilies(line);
    if (source.distinctTypes) {
      for (const family of families) types.add(family);
    } else if (source.family !== undefined && families.has(source.family)) {
      n += 1;
    }
  }
  if (source.distinctTypes) n = types.size;
  return { n, approx };
}

/* ------------------------------------------------------------------------- *
 * Le décompte **figé** : compter une fois, puis poser des marqueurs ordinaires.
 * ------------------------------------------------------------------------- */

/**
 * Les trois réglages du dialogue qui transforment un décompte brut en nombre
 * de marqueurs à poser.
 *
 * Ils vivent ici, et non dans `CardMenu`, parce que l'aperçu en direct et la
 * pose faisaient chacun leur propre version du même calcul — deux copies du
 * même code, donc deux occasions de diverger. C'est exactement ce qui s'est
 * produit : la pose émettait un marqueur **avant** d'appliquer l'exclusion, et
 * la carte se retrouvait avec deux pastilles, le décompte non filtré et le
 * décompte filtré. Un seul calcul, partagé, ne peut plus se contredire.
 */
export interface FrozenOptions {
  /** Code de source du dialogue : `bat:angel`, `cim.creature`, `self:power`… */
  src: string;
  qui: ComputedSpec['scope'];
  /** Décalage de départ ; un champ vide vaut 0, comme l'aide du dialogue l'annonce. */
  offset: number;
  /** « Autres cartes uniquement » : la porteuse ne se compte pas elle-même. */
  excludeOther: boolean;
}

/**
 * Le décalage saisi, tel qu'un champ de texte le rend.
 *
 * Vide, « + », « abc » : rien de tout cela n'est un nombre, et l'aide promet
 * « 0 par défaut ». On tient la promesse ici plutôt que dans chaque appelant,
 * où un `Number.parseInt` nu aurait rendu `NaN` et empoisonné tout le calcul.
 */
export function parseOffset(raw: string | undefined): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Le décompte figé d'une carte : mesure, exclusion de la porteuse, décalage.
 *
 * `base` est ce que la zone contient réellement (exclusion comprise), `final`
 * ce qui sera posé une fois le décalage appliqué et le plancher à zéro tenu.
 * Rend `null` quand la source est illisible — aucun marqueur ne doit alors
 * partir, plutôt qu'un zéro qui aurait l'air d'un décompte.
 */
export function frozenCount(
  state: GameState,
  card: CardView,
  o: FrozenOptions,
): { base: number; final: number } | null {
  let base = 0;
  if (o.src.startsWith('self:')) {
    base = getCardStat(card, o.src.slice(5) as 'power' | 'toughness' | 'counters');
  } else if (o.src.startsWith('card:')) {
    const match = /^card:([^:]+):(power|toughness|counters)$/.exec(o.src);
    if (!match) return null;
    const from = match[1] ? state.cards.get(match[1]) : undefined;
    if (!from) return null;
    base = getCardStat(from, match[2] as 'power' | 'toughness' | 'counters');
  } else {
    const spec = computedCounter(`${COMPUTED_SIGIL}+*/+* ${o.src}@${o.qui}`);
    if (!spec) return null;
    const measure = measureCount(state, spec, card);
    if (!measure) return null;
    base = measure.n;
    if (o.excludeOther) {
      /* « Pour chaque *autre* ange » : la porteuse n'est retirée que si elle
         est dans la zone comptée et qu'elle répond au critère — sinon elle
         n'avait jamais été comptée, et la soustraire ferait perdre un ange. */
      const res = resolveSource(spec.source);
      if (res && card.zone.kind === res.source.zone) {
        const line = (card.faceDown === false ? cardMeta(card.scryfallId)?.typeLine : undefined) ?? '';
        const compte =
          res.subtype !== null
            ? subtypesOf(line).has(res.subtype)
            : res.source.distinctTypes
              ? false
              : res.source.family !== undefined
                ? typeFamilies(line).has(res.source.family)
                : true;
        if (compte) base = Math.max(0, base - 1);
      }
    }
  }
  return { base, final: Math.max(0, base + o.offset) };
}

/** Un `SET_COUNTER` à émettre, sans le `targetId` que l'appelant connaît seul. */
export interface CounterIntent {
  kind: string;
  value?: number;
}

/**
 * Ce qu'une pose figée doit émettre — **un seul marqueur**, jamais deux.
 *
 * Renvoyer la liste plutôt que d'appeler `send` dans la boucle, c'est ce qui
 * rend la règle vérifiable par un test : un doublon se voit dans un tableau,
 * il ne se voyait pas dans une suite d'effets.
 */
export function frozenCounterIntents(
  state: GameState,
  card: CardView,
  o: FrozenOptions,
  form: 'pt_set' | 'pt_add' | 'pt_counters' | 'named',
  name: string,
): CounterIntent[] {
  const count = frozenCount(state, card, o);
  // Décompte illisible ou nul : rien ne se pose. Un « 0/0 » posé ferait mourir
  // la créature, et un marqueur à zéro n'est pas ce que le joueur demandait.
  if (!count || count.final <= 0) return [];
  const n = count.final;
  if (form === 'pt_set') return [{ kind: `${n}/${n}` }];
  if (form === 'pt_add') return [{ kind: `+${n}/+${n}` }];
  if (form === 'pt_counters') return [{ kind: '+1/+1', value: n }];
  return [{ kind: name.trim() || 'charge', value: n }];
}

/** Le côté gauche ou droit de la pastille, une fois le décompte connu. */
export function renderSide(side: ComputedSide, n: number): string {
  const v = side.coef * n + side.offset;
  return side.signed ? (v >= 0 ? `+${v}` : String(v)) : String(v);
}

/** Phrase complète du marqueur calculé, pour l'infobulle et le menu. */
export function describeComputed(spec: ComputedSpec): string {
  const resolved = resolveSource(spec.source);
  let what = spec.source;
  if (resolved !== null) {
    what =
      resolved.subtype === null
        ? resolved.source.label
        : `${subtypeLabel(resolved.subtype)}s ${resolved.source.label}`;
  } else if (spec.source.startsWith('self:')) {
    const stat = spec.source.slice(5);
    what =
      stat === 'power'
        ? 'force de cette carte'
        : stat === 'toughness'
          ? 'endurance de cette carte'
          : 'marqueurs sur cette carte';
  } else if (spec.source.startsWith('card:')) {
    const match = /^card:([^:]+):(power|toughness|counters)$/.exec(spec.source);
    if (match) {
      const stat = match[2];
      const targetId = match[1];
      const target = targetId ? useGame.getState().cards.get(targetId) : undefined;
      const scryfallId = target && target.faceDown === false ? target.scryfallId : undefined;
      const name = scryfallId ? (cardMeta(scryfallId)?.name ?? 'carte ciblée') : 'carte ciblée';
      what =
        stat === 'power'
          ? `force de « ${name} »`
          : stat === 'toughness'
            ? `endurance de « ${name} »`
            : `marqueurs sur « ${name} »`;
    }
  }

  const defines = !spec.left.signed && !spec.right.signed;
  // « nombre d'humains », et non « nombre de Humains » : la majuscule n'a rien à
  // faire au milieu d'une phrase, et l'élision devant un h muet non plus.
  const phrase = what.charAt(0).toLowerCase() + what.slice(1);
  const de = /^[aeiouyâàéèêëîïôöûüh]/.test(phrase) ? "d’" : 'de ';

  const offL = spec.left.offset;
  const offR = spec.right.offset;
  const mod =
    offL === offR && offL !== 0
      ? offL > 0
        ? ` + ${offL}`
        : ` - ${Math.abs(offL)}`
      : offL !== 0 || offR !== 0
        ? ` (${offL >= 0 ? `+${offL}` : offL}/${offR >= 0 ? `+${offR}` : offR})`
        : '';

  const scopePart =
    spec.source.startsWith('self:') || spec.source.startsWith('card:')
      ? ''
      : ` ${SCOPE_LABEL[spec.scope]}`;

  return `${defines ? 'Force et endurance égales au' : 'Modification égale au'} nombre ${de}${phrase}${scopePart}${mod}`;
}

/** Les trois habillages d'une pastille de force/endurance, du plus au moins bon. */
const PT_TONE: Record<PtCounter['tone'], string> = {
  gain: 'bg-emerald-500 text-emerald-950 ring-emerald-200/80',
  loss: 'bg-rose-600 text-rose-50 ring-rose-200/80',
  mixed: 'bg-amber-400 text-amber-950 ring-amber-100/80',
};

/**
 * Réglage d'un marqueur **déjà posé** : changer sa valeur, le renommer, le
 * retirer.
 *
 * C'est ce qui manquait entièrement. Le menu ne savait que *poser* : une fois
 * une « loyauté 1 » sur un permanent, plus aucun geste ne la touchait, et un
 * mot-clé n'avait même pas de − à décrémenter. Le serveur, lui, sait tout faire
 * depuis toujours — `SET_COUNTER` avec `value: null` **retire** l'entrée au lieu
 * de la laisser à zéro.
 *
 * Renommer, c'est retirer l'ancien nom puis poser le nouveau : `kind` est la
 * clé du marqueur, il n'y a pas d'autre façon de le changer. Les deux intents
 * partent dans l'ordre, le serveur les applique dans l'ordre.
 */
export async function editCounter(cardId: ObjectId, counter: Counter): Promise<void> {
  /*
   * Un marqueur **calculé** n'a ni valeur à régler ni nom à saisir : sa valeur
   * est comptée, et son nom est une formule que retaper à la main n'aurait
   * aucun sens. Le seul geste qui le concerne est de l'enlever — pour le
   * remplacer, on repasse par « Effets classiques… », qui compose la formule.
   */
  const spec = computedCounter(counter.kind);
  if (spec !== null) {
    const choice = await openDialog({
      title: 'Marqueur calculé',
      description: `${describeComputed(spec)}. La valeur se recalcule toute seule ; elle ne se règle pas à la main.`,
      submitLabel: 'Appliquer',
      fields: [
        {
          name: 'action',
          label: 'Que faire ?',
          initial: 'keep',
          options: [
            { value: 'keep', label: 'Le laisser' },
            { value: 'remove', label: 'Retirer le marqueur' },
          ],
        },
      ],
    });
    if (choice?.values['action'] === 'remove') {
      useGame
        .getState()
        .send({ type: 'SET_COUNTER', targetId: cardId, kind: counter.kind, value: null });
    }
    return;
  }

  const pt = ptCounter(counter.kind);
  const result = await openDialog({
    title: `Marqueur « ${counter.kind} »`,
    description: 'Ajuster sa valeur, le renommer, ou le retirer de la carte.',
    submitLabel: 'Appliquer',
    fields: [
      {
        name: 'kind',
        label: pt ? 'Modification de force / endurance' : 'Nom du marqueur',
        initial: counter.kind,
        // Le protocole plafonne `kind` à 32 caractères : au-delà, le serveur
        // rejette l'intent et le geste se perd sans un mot.
        maxLength: 32,
        hidden: (values) => values['action'] === 'remove',
        quick: pt
          ? ['+1/+1', '-1/-1', '+2/+0', '+0/+2', 'X/X'].map((v) => ({ label: v, value: v }))
          : ['loyauté', 'vol', 'bouclier', 'ne se dégage pas'].map((v) => ({ label: v, value: v })),
      },
      {
        name: 'value',
        label: pt ? 'Nombre de marqueurs' : 'Valeur (facultative)',
        numeric: true,
        optional: true,
        initial: counter.value === undefined ? '' : String(counter.value),
        placeholder: 'un nombre, ou rien',
        hidden: (values) => values['action'] === 'remove',
        quick: [
          { label: 'aucune', value: '' },
          ...['1', '2', '3', '4', '5', '10'].map((v) => ({ label: v, value: v })),
        ],
        hint: 'Vide, le marqueur s’affiche seul comme un mot-clé. Un nombre le compte.',
      },
      {
        // Le retrait est une **option**, pas une valeur zéro déguisée : c'est le
        // seul geste qui atteigne un mot-clé, lequel n'a aucun nombre à baisser.
        name: 'action',
        label: 'Que faire ?',
        initial: 'set',
        options: [
          { value: 'set', label: 'Régler' },
          { value: 'remove', label: 'Retirer le marqueur' },
        ],
      },
    ],
  });
  if (!result) return;
  const { send } = useGame.getState();
  if (result.values['action'] === 'remove') {
    send({ type: 'SET_COUNTER', targetId: cardId, kind: counter.kind, value: null });
    return;
  }
  const kind = (result.values['kind'] ?? '').trim() || counter.kind;
  if (kind !== counter.kind) {
    send({ type: 'SET_COUNTER', targetId: cardId, kind: counter.kind, value: null });
  }
  const raw = result.values['value'] ?? '';
  // `value` absent pose un mot-clé : l'omission est le message, comme à la pose.
  const payload = raw === '' ? {} : { value: Number.parseInt(raw, 10) };
  send({ type: 'SET_COUNTER', targetId: cardId, kind, ...payload });
}

/**
 * Une pastille de marqueur, au bas de la carte.
 *
 * **Trois familles, trois formes.** Un « +1/+1 » et une « loyauté 1 » se
 * rendaient en pastilles identiques, et le +1/+1 perdait même son nom au
 * passage : on lisait « loyauté 1 » à côté d'un « 1 » nu, sans rien qui dise ce
 * qu'était ce 1. La distinction ne peut pas reposer sur l'étiquette, illisible
 * dès que la caméra recule : elle repose sur la **forme et la couleur**, qui
 * survivent à la réduction.
 *   - force/endurance → pastille **ronde et pleine**, verte quand ça grandit,
 *     rouge quand ça rétrécit, ambre pour un X ou une paire mixte, comme les
 *     cubes qu'on pose à une vraie table ;
 *   - marqueur nommé avec un nombre → **rectangle bleu**, nom compris ;
 *   - mot-clé → **rectangle ambre en italique**, sans nombre ;
 *   - marqueur **calculé** → pastille ronde **violette, à liseré pointillé, et
 *     précédée d'un ∑**. Sans ce repère, une valeur qui change toute seule
 *     passerait pour un bug ou pour un adversaire qui triche : la forme doit
 *     dire « ce nombre n'a pas été posé, il est compté ».
 *
 * La pastille est un bouton sur le champ de bataille : voir « loyauté 3 » et
 * cliquer dessus est le geste naturel, et c'est le seul qui atteigne un
 * mot-clé. Le `stopPropagation` sur `pointerdown` est ce qui l'autorise — sans
 * lui le clic amorcerait le glisser-déposer de la carte ; le `click` arrêté
 * empêche de même le double-clic d'engager le permanent. Le clic **droit**, au
 * contraire, n'est pas intercepté : il ouvre le menu de la carte, où les mêmes
 * marqueurs sont listés.
 */
function CounterBadge({ card, counter }: { card: CardView; counter: Counter }): React.ReactElement {
  const pt = ptCounter(counter.kind);
  const computed = computedCounter(counter.kind);
  /*
   * Le décompte est établi **ici**, dans le rendu, à partir de l'état du store —
   * c'est ce qui le fait suivre tout seul : une carte piochée change
   * `handCount`, zustand réveille la pastille, le nombre bouge. Rien n'est
   * mémorisé, donc rien ne peut se désynchroniser.
   *
   * Le sélecteur rend une **chaîne** et non un objet : zustand v5 s'appuie sur
   * `useSyncExternalStore`, qui boucle si l'instantané change d'identité à
   * chaque lecture. `« 4 »`, `« 4~ »` (décompte approché) ou `« ? »` (source
   * inconnue) se comparent par valeur et tiennent l'invariant.
   */
  const measured = useGame((state) => {
    if (computed === null) return '';
    const m = measureCount(state, computed, card);
    return m === null ? '?' : `${m.n}${m.approx ? '~' : ''}`;
  });

  /* Les marqueurs ne survivent pas à un changement de zone (le serveur les vide) :
     ailleurs qu'au champ de bataille, la pastille est un vestige, pas une prise. */
  const editable = card.zone.kind === 'BATTLEFIELD';

  if (computed !== null) {
    const approx = measured.endsWith('~');
    const unknown = measured === '?' || measured === '';
    const n = unknown ? 0 : Number.parseInt(measured, 10);
    const text = unknown
      ? '?/?'
      : `${renderSide(computed.left, n)}/${renderSide(computed.right, n)}`;
    const title = unknown
      ? `Marqueur calculé « ${counter.kind} » : source inconnue de ce client. Il vient sans doute d’une version plus récente.`
      : `${describeComputed(computed)} — actuellement ${n}, donc ${text}. ` +
        `Recalculé tout seul dès que la zone comptée change.` +
        (approx
          ? ' Approché : une carte de la zone est face cachée ou sa fiche n’est pas encore chargée.'
          : '') +
        /* Un sous-type à zéro est ambigu : soit il n'y a réellement aucune de
           ces cartes, soit le mot est mal orthographié et ne correspond à rien.
           Le dire vaut mieux que de laisser chercher la faute. */
        (n === 0 && !approx && (resolveSource(computed.source)?.subtype ?? null) !== null
          ? ' Aucune carte ne porte ce sous-type en ce moment — vérifiez l’orthographe si vous en attendiez.'
          : '') +
        (editable ? ' Cliquer pour le retirer ou le remplacer.' : '');
    const body = (
      <>
        {/* Le ∑ dit « compté », et il tient à la taille où la pastille est
            encore lisible — un mot ne tiendrait pas. */}
        <span aria-hidden className="mr-0.5 opacity-80">
          {COMPUTED_SIGIL}
        </span>
        <span className="tabular-nums">{text}</span>
        {approx && <span className="ml-0.5 opacity-70">~</span>}
      </>
    );
    const className =
      // Le liseré **pointillé** est la moitié du message : plein, il aurait été
      // une pastille de plus ; pointillé, il se lit « pas posé là à la main ».
      // Tailwind ne sait pas tirailler un `ring`, d'où la bordure.
      'inline-flex items-center whitespace-nowrap text-[10px] leading-tight rounded-full px-1.5 py-[1px] font-bold ' +
      'bg-violet-600 text-violet-50 border border-dashed border-violet-200/90';
    const marks = {
      'data-test': 'card-counter',
      'data-counter': counter.kind,
      'data-computed': measured,
      title,
    } as const;
    if (!editable) {
      return (
        <span className={className} {...marks}>
          {body}
        </span>
      );
    }
    return (
      <button
        className={`${className} cursor-pointer hover:ring-2 hover:ring-white/80`}
        {...marks}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          void editCounter(card.id, counter);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        {body}
      </button>
    );
  }

  // L'effet cumulé prend la place du « ×n » quand il se calcule ; sinon le
  // compte reste affiché tel quel, faute de mieux honnête.
  const total = pt ? ptAggregate(pt, counter.value) : null;

  const body = pt ? (
    <>
      <span className="tabular-nums">{`${(total ?? pt).left}/${(total ?? pt).right}`}</span>
      {/* Le « ×n » ne subsiste que sur ce qui ne s'additionne pas — un X, une
          paire non signée. Ailleurs, le total l'a remplacé. */}
      {total === null && counter.value !== undefined && counter.value !== 1 && (
        <span className="ml-0.5 font-black">{`×${counter.value}`}</span>
      )}
    </>
  ) : (
    <>
      {counter.kind}
      {counter.value !== undefined && <span className="ml-1 tabular-nums font-bold">{counter.value}</span>}
    </>
  );

  const look = pt
    ? `rounded-full px-1.5 py-[1px] font-bold ${PT_TONE[pt.tone]}`
    : counter.value === undefined
      ? 'rounded bg-slate-950/90 px-1.5 py-0.5 font-semibold italic text-amber-200 ring-amber-400/50'
      : 'rounded bg-slate-950/90 px-1.5 py-0.5 font-semibold text-sky-200 ring-sky-400/50';

  const className = `inline-flex items-center whitespace-nowrap text-[10px] leading-tight ring-1 ${look}`;
  /*
   * L'infobulle est l'endroit où le **compte de marqueurs** reste dit, une fois
   * la pastille passée au total : « 8 marqueurs -1/-1 (effet cumulé -8/-8) ».
   * C'est ce compte-là qui fait foi au sens des règles, et c'est lui que les
   * boutons − et + du menu manipulent.
   */
  const title =
    counter.value === undefined
      ? `${counter.kind}${editable ? ' — cliquer pour le retirer ou le régler' : ''}`
      : total !== null
        ? `${counter.value} marqueurs ${counter.kind} — effet cumulé ${total.left}/${total.right}${
            editable ? ' — cliquer pour régler' : ''
          }`
        : `${counter.value} × ${counter.kind}${editable ? ' — cliquer pour régler' : ''}`;

  /* Repères de recette : le total lu sur la pastille et le compte de marqueurs
     doivent rester atteignables séparément, c'est tout l'enjeu de l'agrégation. */
  const marks = {
    'data-test': 'card-counter',
    'data-counter': counter.kind,
    ...(counter.value !== undefined ? { 'data-counter-count': String(counter.value) } : {}),
    ...(total !== null ? { 'data-counter-total': `${total.left}/${total.right}` } : {}),
    title,
  };

  if (!editable) {
    return (
      <span className={className} {...marks}>
        {body}
      </span>
    );
  }
  return (
    <button
      className={`${className} cursor-pointer hover:ring-2 hover:ring-white/80`}
      {...marks}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void editCounter(card.id, counter);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      type="button"
    >
      {body}
    </button>
  );
}

export interface CardSpriteProps {
  card: CardView;
  /** Dos personnalisé du propriétaire, sinon un dos neutre est dessiné. */
  cardBackUrl?: string | null;
  scale?: number;
  selected?: boolean;
  /** Mise en évidence depuis le journal : halo doré, sans changer la sélection. */
  highlighted?: boolean;
  onPointerDown?: (event: React.PointerEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  onDoubleClick?: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

/**
 * Le repère de langue, dans la grammaire des autres repères de ce fichier :
 * petit, en coin, inerte au pointeur, un anneau de couleur et trois lettres.
 *
 * **Il est strictement personnel.** Il se dérive de la résolution localisée,
 * côté client, pour la langue de **celui qui regarde** : rien ne part au
 * serveur, aucun event ne le transporte, et un joueur ne voit jamais le repère
 * d'un autre. Un joueur en anglais n'en voit aucun.
 *
 * **En haut à gauche, et minuscule.** C'est le coin demandé, et la taille aussi :
 * ce repère double une information que la carte porte déjà — son texte est en
 * anglais, cela se voit. Il ne sert qu'à dire que c'est un **repli** et non un
 * choix, donc il doit se lire quand on le cherche et disparaître quand on ne le
 * cherche pas. D'où la moitié de la taille des autres repères, et pas de
 * remplissage.
 *
 * Deux voisins occupent le même coin — « face cachée » et l'œil de révélation —
 * et peuvent coexister avec lui : `CardSprite` le décale alors sous eux plutôt
 * que de les recouvrir. Le haut-droit porte la marque de jeton, et le bas est
 * réservé aux marqueurs, qui débordent vers le bas et partent de la gauche.
 *
 * L'infobulle dit **pourquoi**, parce que les trois cas n'appellent pas la même
 * réaction : changer d'édition peut régler le premier, rien ne réglera le
 * second, et le troisième n'est pas un défaut mais une divergence assumée.
 */
export function CardLanguageBadge({
  mark,
  className = 'absolute left-1 top-1',
}: {
  mark: CardLanguageMark;
  className?: string;
}): React.ReactElement {
  const substitue = mark.kind === 'substituted';
  // Pour une substitution, l'édition réelle est ce qu'il y a de plus utile à
  // afficher : elle dit d'un coup d'œil que l'image ne vient pas de l'impression
  // choisie, et laquelle elle est. À défaut, on se rabat sur « fr ».
  const etiquette = substitue ? (mark.setCode ?? mark.language) : 'en';
  const titre = substitue
    ? `Illustration d’une autre édition (${(mark.setCode ?? '').toUpperCase() || 'édition inconnue'}) : l’impression choisie n’existe pas dans votre langue. Le sélecteur d’impression, lui, annonce toujours l’impression réellement choisie.`
    : mark.kind === 'unusableImage'
      ? 'L’impression traduite existe, mais Scryfall n’en publie pas de scan utilisable : illustration anglaise.'
      : 'Pas de version traduite de cette impression : illustration anglaise. La carte existe peut-être dans votre langue sous une autre édition.';

  return (
    <span
      className={`pointer-events-none inline-flex items-center gap-px rounded-[2px] bg-slate-950/80 px-px text-[6px] font-bold uppercase leading-[1.4] tracking-wide ring-1 ${className} ${
        substitue ? 'text-emerald-300 ring-emerald-400/40' : 'text-slate-300 ring-slate-400/30'
      }`}
      data-test="card-language-mark"
      data-language-mark={mark.kind}
      title={titre}
    >
      {substitue && (
        <svg aria-hidden fill="none" height="4" viewBox="0 0 10 8" width="5">
          <path d="M1 2.5h7L6.2 1M9 5.5H2l1.8 1.5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )}
      {etiquette}
    </span>
  );
}

export function CardSprite({
  card,
  cardBackUrl,
  scale = 1,
  selected = false,
  highlighted = false,
  onPointerDown,
  onClick,
  onDoubleClick,
  onContextMenu,
}: CardSpriteProps): React.ReactElement {
  useCardMetaTick();
  // Les résolutions localisées arrivent par lots, comme les métadonnées : sans
  // cet abonnement, la carte resterait en anglais jusqu'au prochain rendu venu
  // d'ailleurs.
  useLocalizationTick();
  const language = useLanguage();
  // Sélecteur scalaire : un booléen, comparable par `Object.is`.
  const forceLocalizedPrinting = useForceLocalizedPrinting();

  const mySeat = useGame((s) => s.mySeat);
  const seatHandRevealed = useGame((s) => s.handsRevealed.has(card.zone.seat));
  const revealed = revealFlag(card, mySeat, seatHandRevealed);

  // Une carte dont l'identité nous est cachée ne demande rien : on ne connaît
  // pas son identifiant, et le demander serait une fuite autant qu'une erreur.
  const known = card.faceDown === false ? card : null;
  const meta = known ? cardMeta(known.scryfallId) : undefined;
  // `resolveCardImage` compte les faces à partir de 0 ; le retournement ne
  // change pas d'un iota, seule la façon de nommer la face demandée change.
  const faceIndex = known && known.flipped && isDoubleFaced(meta) ? 1 : 0;
  const localized = known ? localizedCard(known.scryfallId, language) : undefined;
  /*
   * La résolution n'est faite que pour une carte dont on connaît l'identité —
   * `known` est nul dès que `faceDown !== false`. C'est aussi ce qui garantit
   * qu'aucun repère de langue ne peut apparaître sur un dos de carte : sans
   * résolution, il n'y a rien à marquer, et `cardLanguageMark` exige en plus
   * qu'on lui affirme explicitement que l'identité est connue.
   *
   * Si la résolution ne rend pas d'URL pour cette face, on redescend sur le
   * motif du CDN, qui est ce que cette carte affichait avant ce chantier.
   */
  const resolved = known
    ? resolveCardImage({
        card: meta ?? { scryfallId: known.scryfallId },
        localized,
        language,
        face: faceIndex,
        allowSubstitute: forceLocalizedPrinting,
      })
    : null;
  const imageSrc = known
    ? (resolved?.url ?? scryfallImage(known.scryfallId, 'large', faceIndex === 0 ? 'front' : 'back'))
    : null;
  /*
   * Le repli n'est plus muet, mais il reste discret : trois lettres en coin, et
   * seulement pour celui qui regarde. Une carte `pending` n'est jamais marquée —
   * elle va sans doute devenir française d'ici une seconde.
   */
  const languageMark = cardLanguageMark({
    identityKnown: known !== null,
    resolved,
    language,
  });
  // Le nom imprimé français quand il existe ; le nom du catalogue sinon.
  const shownName = localizedCardName(localized, meta?.name, faceIndex) ?? 'Carte';
  const width = CARD_WIDTH * scale;
  const height = CARD_HEIGHT * scale;

  return (
    <div
      className={`card-shadow relative select-none rounded-[6px] ${
        selected ? 'selected-card' : ''
      } ${highlighted ? 'ring-2 ring-amber-300' : ''} ${
        card.faceDown === false && card.isFoil ? 'foil' : ''
      }`}
      style={{
        width,
        height,
        transform: `rotate(${card.tapped ? 90 : card.rotation}deg)`,
        transition: 'transform 120ms ease-out',
      }}
      data-card={card.id}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerEnter={() => useGame.getState().setHovered(card.id)}
      onPointerLeave={() =>
        useGame.getState().hoveredCardId === card.id && useGame.getState().setHovered(null)
      }
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={known ? shownName : 'Carte face cachée'}
    >
      {card.faceDown === false && imageSrc ? (
        <img
          alt={shownName}
          className="h-full w-full rounded-[6px] object-cover"
          draggable={false}
          loading="lazy"
          /* L'image vient directement du CDN Scryfall : elle ne transite jamais
             par notre serveur, qui n'en garde aucune copie. Toujours en haute
             résolution ('large'). L'URL française est une **autre** URL, publiée
             par Scryfall pour une autre carte — elle ne se fabrique pas. */
          src={imageSrc}
        />
      ) : (
        <CardBack url={cardBackUrl} />
      )}

      {/*
        Carte posée face cachée dont on voit l'identité : c'est notre propre
        morph. Sans ce repère, on croit avoir révélé ce qu'on vient de cacher.
      */}
      {card.faceDown === false && card.facedownOnTable && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[6px] ring-2 ring-amber-400/70"
          data-test="facedown-indicator"
        >
          <span className="absolute left-1 top-1 rounded bg-slate-950/90 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/50">
            face cachée
          </span>
        </div>
      )}

      {/*
        Un jeton porte sa marque.
        Une copie d'une carte existante lui est visuellement identique — même
        illustration, même nom — et l'on ne distinguait plus l'original de sa
        copie une fois les deux sur le terrain. Le repère est petit et en haut à
        droite : il désigne sans masquer l'illustration.
      */}
      {card.kind === 'TOKEN' && (
        <span
          className="pointer-events-none absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-slate-950/85 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-sky-300 ring-1 ring-sky-400/50"
          data-test="token-badge"
          title="Jeton"
        >
          <svg aria-hidden fill="none" height="7" viewBox="0 0 8 8" width="7">
            <circle cx="4" cy="4" r="3.2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="4" cy="4" fill="currentColor" r="1.1" />
          </svg>
          jeton
        </span>
      )}

      {/*
        Carte révélée : un œil.
        Même facture que les deux repères ci-dessus — petit, en coin, inerte au
        pointeur.
        **En haut à gauche**, et le choix n'est pas libre : une carte révélée est
        par construction dans une zone cachée, donc rendue soit dans le rail de
        main, soit dans la main révélée d'un panneau de siège. Les deux
        empilent les cartes de gauche à droite, la suivante couvrant la
        précédente : seule la **partie gauche** de chaque carte reste visible.
        Et le bas du rail est coupé par la fenêtre — un repère posé en bas à
        droite ne se voyait que sur la dernière carte, vérifié en capture.
        Aucun conflit avec le repère « face cachée », qui ne concerne qu'un
        permanent posé sur le champ de bataille.
        Le titre dit **dans quel sens** la révélation a eu lieu : « on me l'a
        montrée » et « la table voit ma main » ne se remplacent pas l'un
        l'autre.
      */}
      {revealed !== null && (
        <span
          className={`pointer-events-none absolute left-1 top-1 inline-flex items-center rounded bg-slate-950/90 ring-1 ring-violet-400/60 ${
            // Chez le propriétaire, l'œil doit sauter aux yeux : c'est **lui**
            // qui doit changer de jeu en sachant sa carte connue. Chez celui à
            // qui on l'a montrée, l'information est secondaire — il la voit
            // déjà.
            revealed === 'from-me' ? 'px-1.5 py-1 text-violet-200' : 'px-1 py-0.5 text-violet-300'
          }`}
          data-test="revealed-indicator"
          data-reveal={revealed}
          title={
            revealed === 'to-me'
              ? 'Carte révélée : son propriétaire vous en a montré l’identité'
              : 'Carte révélée : votre main est visible par toute la table'
          }
        >
          <svg
            aria-hidden
            fill="none"
            height={revealed === 'from-me' ? 15 : 9}
            viewBox="0 0 16 10"
            width={revealed === 'from-me' ? 22 : 13}
          >
            <path
              d="M1 5c2-2.8 4.4-4.2 7-4.2S13 2.2 15 5c-2 2.8-4.4 4.2-7 4.2S3 7.8 1 5Z"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <circle cx="8" cy="5" fill="currentColor" r="1.9" />
          </svg>
        </span>
      )}

      {/*
        Le repère de langue. `languageMark` vaut `null` dès que l'identité de la
        carte nous est cachée : rien ne peut donc s'afficher sur un dos, ce qui
        apprendrait à son porteur que notre client en connaît l'identité.

        Il occupe le coin haut-gauche, que deux voisins peuvent déjà tenir : le
        bandeau « face cachée » d'une carte posée face cachée dont on connaît
        l'identité, et l'œil de révélation. Les deux disent quelque chose sur la
        **partie** ; ce repère-ci ne dit qu'une chose sur l'**affichage**. Il
        descend donc sous eux au lieu de les recouvrir — et sous les deux à la
        fois quand ils coexistent, ce qui arrive sur une carte montrée puis
        retournée.
      */}
      {languageMark && (
        <CardLanguageBadge
          className={`absolute left-1 ${
            card.faceDown === false && card.facedownOnTable && revealed !== null
              ? 'top-11'
              : (card.faceDown === false && card.facedownOnTable) || revealed !== null
                ? 'top-6'
                : 'top-1'
          }`}
          mark={languageMark}
        />
      )}

      {card.counters.length > 0 && (
        <div className="absolute -bottom-1 left-1 right-1 flex flex-wrap gap-1">
          {card.counters.map((counter) => (
            <CounterBadge key={counter.kind} card={card} counter={counter} />
          ))}
        </div>
      )}
    </div>
  );
}

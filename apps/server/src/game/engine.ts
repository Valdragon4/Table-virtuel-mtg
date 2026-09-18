/**
 * Application des intents sur l'état canonique.
 *
 * Le moteur valide la légalité *structurelle* (l'objet existe, l'auteur a le droit
 * d'y toucher, la zone cible est cohérente) et jamais la légalité au sens des
 * règles de Magic : les joueurs arbitrent, comme sur une vraie table.
 *
 * Chaque intent produit des `Emission`s : un event plus son audience, et une
 * fonction de construction appelée une fois par siège. C'est cette fonction qui
 * garantit qu'un siège ne reçoit jamais l'identité d'une carte qu'il ne doit pas
 * connaître — le filtrage a lieu à l'émission, pas à la réception.
 */
import { ulid } from 'ulid';
import {
  FREE_INTENTS,
  NAMED_LOG_LIMIT,
  type Audience,
  type Counter,
  type Event,
  type Intent,
  type Label,
  type ObjectId,
  type SeatId,
  type ZoneKind,
  type ZoneRef,
} from '@mtg/shared';
import { resolveCascade } from './cascade.js';
import { resolveProliferate } from './proliferate.js';
import { applyIntentPart2 } from './engine-2.js';
import { IntentError } from './errors.js';
import { projectCard } from './projection.js';
import {
  canSeeIdentity,
  getZone,
  insertIntoZone,
  isEnumerableZone,
  isPublicZone,
  removeFromZone,
  startingLife,
  zoneKey,
  type CardData,
  type GameObjectState,
  type GameState,
  type SeatState,
} from './state.js';
import type { RandomSource } from './random.js';

/**
 * Ce que le moteur ne peut pas aller chercher lui-même : il est synchrone et sans
 * accès à la base. La room résout ces dépendances avant d'appeler `applyIntent`.
 */
export interface EngineDeps {
  /** Carte à instancier pour un CREATE_TOKEN par `scryfallId`. */
  cardData?: CardData;
}

export interface Emission {
  audience: Audience;
  /** Construit l'event tel que ce siège a le droit de le voir. */
  build: (seat: SeatId) => Event;
  /** Ligne de journal, publique par construction : jamais de nom caché ici. */
  log?: { text: string; cardIds: ObjectId[]; names?: string[] };
}

export interface UndoEntry {
  at: number;
  /** Rejoue l'état antérieur et renvoie les events correspondants. */
  run: () => Emission[];
}

export interface IntentResult {
  emissions: Emission[];
  undo?: UndoEntry;
}

const ALL: Audience = { kind: 'ALL' };

function seatOf(state: GameState, id: SeatId): SeatState {
  const seat = state.seats.get(id);
  if (!seat) throw new IntentError('ERR_NOT_SEATED', 'Siège inconnu.');
  return seat;
}

function objectOf(state: GameState, id: ObjectId): GameObjectState {
  const obj = state.objects.get(id);
  if (!obj) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Objet inconnu ou déjà retiré.');
  return obj;
}

/** Une carte engagée dans une session de regard est verrouillée. */
function assertNotLocked(state: GameState, id: ObjectId): void {
  for (const look of state.pendingLooks.values()) {
    if (look.cardIds.includes(id)) {
      throw new IntentError('ERR_LOOK_PENDING', 'Cette carte est en cours de consultation.');
    }
  }
}

/**
 * Une zone dont une carte est en consultation est gelée en bloc : piocher,
 * meuler ou mélanger pendant un scry corromprait la session (docs/protocol.md §6.4).
 */
function assertZoneNotLocked(state: GameState, zone: ZoneRef): void {
  for (const look of state.pendingLooks.values()) {
    if (look.zone.seat === zone.seat && look.zone.kind === zone.kind) {
      throw new IntentError('ERR_LOOK_PENDING', 'Cette zone est en cours de consultation.');
    }
  }
}

/**
 * Détache tout ce qui pointait vers un objet qui quitte le champ de bataille.
 *
 * Sans cela, `attachedTo` garde l'identifiant d'un objet parti — voire détruit —
 * et la table se retrouve avec une référence fantôme.
 */
function detachDependents(state: GameState, id: ObjectId): Emission[] {
  const out: Emission[] = [];
  for (const other of state.objects.values()) {
    if (other.attachedTo !== id) continue;
    other.attachedTo = undefined;
    out.push({ audience: ALL, build: () => ({ type: 'DETACHED', sourceId: other.id }) });
    out.push(cardUpdate(other));
  }
  return out;
}

/**
 * Droit d'agir sur un objet. Modèle « vraie table » : les intents de `FREE_INTENTS`
 * sont ouverts à tout siège, le reste est réservé au contrôleur — sauf depuis une
 * zone cachée, toujours réservée à son propriétaire.
 */
function assertMayTouch(obj: GameObjectState, seat: SeatId, intent: Intent): void {
  const hiddenZone = obj.zone.kind === 'HAND' || obj.zone.kind === 'LIBRARY' || obj.zone.kind === 'SIDEBOARD';
  if (hiddenZone && obj.zone.seat !== seat) {
    throw new IntentError('ERR_NOT_YOURS', "Cette zone n'est pas la tienne.");
  }
  if (FREE_INTENTS.has(intent.type)) return;
  if (obj.controller !== seat && obj.owner !== seat) {
    throw new IntentError('ERR_NOT_YOURS', "Tu ne contrôles pas cet objet.");
  }
}

/**
 * Une carte ne rejoint une zone cachée que chez son propriétaire : sinon on
 * pourrait ranger la carte d'un adversaire dans sa propre main, ou cacher la
 * sienne dans celle d'un autre.
 */
function assertLegalDestination(obj: GameObjectState, to: ZoneRef): void {
  const hidden = to.kind === 'HAND' || to.kind === 'LIBRARY' || to.kind === 'SIDEBOARD';
  if (hidden && to.seat !== obj.owner) {
    throw new IntentError('ERR_BAD_ZONE', "Une carte ne rejoint que les zones cachées de son propriétaire.");
  }
}

/**
 * Taxe de commandant, **dérivée** et non pilotée (§6.6) : elle s'incrémente
 * quand un objet quitte la zone de commandement pour le champ de bataille ou la
 * pile. La correction manuelle passe par `SET_PLAYER_COUNTER` de kind
 * `commander_tax:<objectId>`.
 */
function commanderTax(state: GameState, obj: GameObjectState, from: ZoneRef): Emission[] {
  if (from.kind !== 'COMMAND') return [];
  if (obj.zone.kind !== 'BATTLEFIELD' && obj.zone.kind !== 'STACK_NOTE') return [];
  const owner = state.seats.get(obj.owner);
  if (!owner) return [];

  const casts = (owner.commanderTax.get(obj.id) ?? 0) + 1;
  owner.commanderTax.set(obj.id, casts);
  const commanderId = obj.id;
  return [
    {
      audience: ALL,
      build: () => ({ type: 'COMMANDER_TAX_CHANGED', seat: obj.owner, commanderId, casts }),
    },
  ];
}

function cardName(obj: GameObjectState): string {
  return obj.card.name;
}

/**
 * Périphrase du journal pour une carte que la table n'a pas le droit
 * d'identifier. Nommée parce qu'elle sort désormais aussi dans `LogEntry.names`,
 * et que les deux endroits doivent dire le même mot.
 */
const CARTE_ANONYME = 'une carte';

/** Nom utilisable en journal public : sinon, une périphrase neutre. */
function publicName(obj: GameObjectState, state: GameState): string {
  const everyoneSees = [...state.seats.keys()].every((s) => canSeeIdentity(obj, s));
  return everyoneSees ? cardName(obj) : CARTE_ANONYME;
}

/*
 * `NAMED_LOG_LIMIT` vient de `@mtg/shared` : le client en dépend pour décider
 * si une ligne est dépliable, et il ne peut pas le déduire du texte abrégé
 * sans le découper — voir le commentaire à sa définition.
 */

/**
 * Nomme un lot de cartes pour le journal, et rend les ancres correspondantes.
 *
 * **Deux conditions, et les deux sont nécessaires : la zone d'arrivée est
 * publique, et la carte n'y est pas posée face cachée.** Le `text` d'une
 * `LogEntry` est construit une fois et diffusé à toute la table (§4.2) : il n'y
 * a pas de version par destinataire, donc « public pour l'auteur » ne suffit
 * jamais.
 *
 * La seconde condition est déléguée à `publicName`, qui est la seule règle de
 * visibilité du serveur : une carte posée face cachée n'est pas connue de tous
 * les sièges, et retombe donc sur la périphrase sans qu'aucun cas particulier
 * ait à être écrit.
 *
 * La première, en revanche, ne peut pas en être déduite, et c'est le piège :
 * **la connaissance est monotone** (cf. `relocate`). Une carte qui a traversé le
 * cimetière reste connue de tous les sièges *à jamais*, y compris une fois
 * reprise en main — `publicName` continuerait donc de la nommer, et « Alice a
 * déplacé Colère de Dieu vers main » dirait à toute la table ce qu'elle tient.
 * Ce n'est pas ce que la monotonie autorise : elle dit qu'on se souvient de ce
 * qu'on a vu, pas que le journal peut suivre une carte dans une zone cachée.
 * D'où le test explicite sur la zone d'arrivée.
 *
 * À appeler **après** le déplacement : c'est l'arrivée qui décide, et la
 * question posée est « la table peut-elle la lire maintenant, là où elle est ? ».
 *
 * Rend `null` quand aucune carte n'est nommable — l'appelant retombe alors sur
 * sa phrase en compte, qui reste la bonne réponse.
 *
 * Les **ancres** (`cardIds`) couvrent toutes les cartes nommables, y compris
 * celles que le seuil a repliées dans « et N autres cartes » : survoler
 * l'entrée doit surligner le lot entier, et surtout `TAKE_BACK` efface le passé
 * en parcourant `cardIds` — une carte publique laissée hors des ancres serait
 * hors de sa portée, et l'oubli serait défait d'un coup d'œil au journal.
 * L'inclusion est donc volontairement plus large que l'énumération ; c'est le
 * sens sûr de l'écart.
 *
 * Le champ `all` est la **forme non abrégée de `names`** : exactement la même
 * liste, dans le même ordre, avant que le seuil ne la coupe — les noms lisibles
 * d'abord, puis une périphrase par carte que la table ne peut pas identifier.
 * `all.slice(0, NAMED_LOG_LIMIT)` redonne donc mot pour mot ce que le texte
 * énumère, et `all.length - NAMED_LOG_LIMIT` le « et N autres cartes ». Il ne
 * dit rien de plus que la phrase : il dit la même chose sans replier. C'est à
 * l'appelant de décider s'il le publie — voir `namesForLog`.
 */
function namedBatch(
  objs: readonly GameObjectState[],
  state: GameState,
  to: ZoneKind,
): { names: string; cardIds: ObjectId[]; all: string[] } | null {
  if (!isPublicZone(to)) return null;
  const visible = objs.filter((o) => publicName(o, state) !== CARTE_ANONYME);
  if (visible.length === 0) return null;

  const shown = visible.slice(0, NAMED_LOG_LIMIT).map((o) => cardName(o));
  // Les cartes tues : celles que le seuil a coupées, plus celles que la table
  // n'a pas le droit de lire et qui sont pourtant du voyage.
  const rest = visible.length - shown.length + (objs.length - visible.length);

  let names: string;
  if (rest > 0) {
    names = `${shown.join(', ')} et ${rest === 1 ? '1 autre carte' : `${rest} autres cartes`}`;
  } else if (shown.length === 1) {
    names = shown[0]!;
  } else {
    names = `${shown.slice(0, -1).join(', ')} et ${shown[shown.length - 1]!}`;
  }
  const all = [
    ...visible.map((o) => cardName(o)),
    ...Array.from({ length: objs.length - visible.length }, () => CARTE_ANONYME),
  ];
  return { names, cardIds: visible.map((o) => o.id), all };
}

/**
 * Faut-il publier la liste de noms dépliée sur cette ligne, et laquelle ?
 *
 * Le dépliage du client se reconstruit normalement depuis les **ancres** : il
 * résout chaque `cardIds` dans son store. Deux conditions doivent tenir pour
 * que ce chemin marche, et `CASCADE` est le seul endroit où la seconde tombe :
 *
 * 1. la ligne est abrégée — sinon le texte dit déjà tout, et il n'y a rien à
 *    déplier ;
 * 2. les ancres couvrent le lot entier — sinon le joueur lit « et N autres
 *    cartes » et n'a **aucun** moyen d'apprendre lesquelles. C'est le défaut
 *    que ce champ répare : après une cascade, les cartes reparties sous la
 *    bibliothèque ont changé d'`ObjectId` (§2.1) et n'existent plus chez
 *    personne ; leurs ancres sont volontairement omises, parce qu'une ancre
 *    morte promettrait un survol qui ne surligne rien.
 *
 * Hors de ce cas on rend `undefined`, et c'est délibéré : `logTail` recopie
 * deux cents entrées dans **chaque** snapshot, et une liste de noms sur chaque
 * ligne multi-cartes serait un coût permanent payé pour une information que le
 * client sait déjà reconstituer.
 *
 * Aucune décision de confidentialité ne se prend ici : `all` sort de
 * `namedBatch`, donc de `publicName`, donc il ne contient que ce que le texte
 * de la même ligne contient déjà.
 */
function namesForLog(all: readonly string[], anchors: readonly ObjectId[]): string[] | undefined {
  if (all.length <= NAMED_LOG_LIMIT) return undefined;
  if (anchors.length >= all.length) return undefined;
  return [...all];
}

/**
 * Rangs d'une zone, tels qu'ils étaient avant l'intent. Voir `rankShiftEmissions`.
 */
export type ZoneOrders = ReadonlyMap<string, ObjectId[]>;

export function captureZoneOrders(state: GameState): ZoneOrders {
  const orders = new Map<string, ObjectId[]>();
  for (const [key, ids] of state.zones) orders.set(key, [...ids]);
  return orders;
}

/**
 * Republie l'ordre des zones dont les rangs ont **glissé sous les cartes qui
 * n'ont pas bougé**.
 *
 * C'est la cause exacte du cimetière en désordre. `sortIndex` est un rang, pas
 * une étiquette : poser une carte sur le dessus (rang 0, cf. `ORDERED_ZONES`)
 * décale d'un cran toutes celles qui étaient déjà là, et en retirer une du
 * milieu les remonte. `reindexZone` le fait correctement côté serveur — mais
 * les seuls events émis parlaient de la carte déplacée. Les autres gardaient
 * chez le client le rang d'avant : après deux meules, le cimetière contenait
 * deux cartes au rang 0, deux au rang 1, et `ZonePanel`, qui trie par
 * `sortIndex`, les rendait dans l'ordre d'arrivée des events — pas celui de la
 * pile. Le serveur avait raison, le client n'avait jamais été prévenu.
 *
 * On republie donc la zone entière, une seule émission, exactement comme le
 * fait déjà le rangement au sein d'une zone (`REORDERABLE_ZONES`) pour la même
 * raison. Rien n'en sort qui ne soit déjà dans le snapshot : `projectSnapshot`
 * publie toutes les zones énumérables à tous les sièges, vue par vue, et
 * `projectCard` refait ici le même filtrage par destinataire. C'est d'ailleurs
 * l'autre moitié de l'enjeu — sans cette republication, `snapshot(T)` et
 * `snapshot(T₀) + delta` divergeaient sur les `sortIndex`, ce qui viole la §8.1.
 *
 * Deux garde-fous :
 * - la **bibliothèque** n'est jamais republiée : son contenu n'existe pas hors
 *   de son propriétaire (§2.1) ;
 * - seule compte la carte **présente avant et après** dont le rang a changé. Un
 *   mélange réattribue tous les identifiants : aucun rang « ne glisse », il n'y
 *   a aucun recouvrement, et `ZONE_SHUFFLED` fait déjà le travail. Une zone où
 *   seules les cartes déplacées bougent (une meule dans un cimetière vide) ne
 *   déclenche rien non plus : leurs propres events portent le bon rang.
 */
export function rankShiftEmissions(state: GameState, before: ZoneOrders): Emission[] {
  const emissions: Emission[] = [];
  for (const [key, ids] of state.zones) {
    const previous = before.get(key);
    if (!previous || previous.length === 0) continue;
    const [zoneSeat = '', kind = ''] = key.split('|');
    if (!isEnumerableZone(kind as ZoneKind)) continue;

    const wasAt = new Map(previous.map((id, rank) => [id, rank]));
    const slid = ids.some((id, rank) => {
      const old = wasAt.get(id);
      return old !== undefined && old !== rank;
    });
    if (!slid) continue;

    const zone: ZoneRef = { seat: zoneSeat, kind: kind as ZoneKind };
    const ordered = ids
      .map((id) => state.objects.get(id))
      .filter((o): o is GameObjectState => o !== undefined);
    emissions.push({
      audience: ALL,
      build: (seat) => ({
        type: 'CARDS_MOVED',
        cards: ordered.map((o) => projectCard(o, seat)),
        from: zone,
        to: zone,
      }),
    });
  }
  return emissions;
}

const ZONE_LABELS: Record<string, string> = {
  LIBRARY: 'bibliothèque',
  HAND: 'main',
  BATTLEFIELD: 'champ de bataille',
  GRAVEYARD: 'cimetière',
  EXILE: 'exil',
  COMMAND: 'zone de commandement',
  SIDEBOARD: 'réserve',
  FACEDOWN_TEMP: 'pile face cachée',
  STACK_NOTE: 'pile',
};

function zoneLabel(zone: ZoneRef): string {
  return ZONE_LABELS[zone.kind] ?? zone.kind.toLowerCase();
}

/**
 * Un objet d'une zone non énumérable (bibliothèque) n'existe pas, vu de
 * l'extérieur : même son identifiant ne doit pas sortir vers un autre siège,
 * sinon corréler les ids avant/après un mélange redevient possible (§2.1).
 */
function cardUpdate(obj: GameObjectState): Emission {
  const audience: Audience = isEnumerableZone(obj.zone.kind)
    ? ALL
    : { kind: 'SEAT', seat: obj.zone.seat };
  return { audience, build: (seat) => ({ type: 'CARD_UPDATED', card: projectCard(obj, seat) }) };
}

/**
 * Déplace un objet et met à jour ce que chacun a le droit d'en savoir.
 *
 * La connaissance ne fait que croître ; seule l'entrée en bibliothèque l'efface.
 * Le raisonnement est dans `relocate`, à l'endroit qui décide.
 */
/**
 * Zones où l'on range, et dont l'ordre peut être republié tel quel.
 *
 * Volontairement restreint : ce sont les zones dont le contenu — ou au moins
 * l'existence et le rang de chaque objet — est déjà connu de toute la table.
 * La bibliothèque en est exclue par nature, le sideboard et la pile face
 * cachée aussi, car republier leur contenu apprendrait aux autres sièges des
 * identifiants qu'ils n'ont pas à connaître (§2.1).
 */
const REORDERABLE_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'HAND',
  'GRAVEYARD',
  'EXILE',
  'COMMAND',
  'STACK_NOTE',
]);

function relocate(
  state: GameState,
  obj: GameObjectState,
  to: ZoneRef,
  position: number | 'TOP' | 'BOTTOM' | 'RANDOM' | undefined,
  rng: RandomSource,
  opts: { faceDown?: boolean; tapped?: boolean; x?: number; y?: number } = {},
): ZoneRef {
  const from = obj.zone;
  removeFromZone(state, from, obj.id);
  obj.zone = to;
  /*
   * **Le contrôleur est le siège dont la zone porte l'objet.**
   *
   * Il ne l'était pas : `controller` restait figé à sa valeur d'origine. Une
   * carte donnée à un adversaire — le dépôt avec Alt sur son champ de bataille,
   * qui est précisément le geste « je te la donne » — atterrissait bien chez
   * lui, mais `assertMayTouch` la lui refusait : il ne la contrôlait pas. Il la
   * voyait sur son terrain sans pouvoir la bouger, l'engager ni s'en défausser.
   *
   * L'`owner` ne bouge pas, lui : c'est ce qui ramène la carte à son
   * propriétaire quand elle quitte le champ, et ce que le protocole promet
   * (§2.2). Les zones cachées n'acceptent de toute façon que leur propriétaire
   * (`assertLegalDestination`), le contrôle y revient donc naturellement.
   */
  obj.controller = to.seat;

  if (opts.tapped !== undefined) obj.tapped = opts.tapped;
  if (opts.x !== undefined) obj.x = opts.x;
  if (opts.y !== undefined) obj.y = opts.y;

  /*
   * **La connaissance est monotone : un changement de zone n'en efface jamais,
   * sauf l'entrée en bibliothèque.**
   *
   * Chacun de ces `case` écrivait un `knownTo` **neuf**, recalculé depuis la
   * zone d'arrivée. Une carte qu'Alice montrait à Bob, jouait sur le champ puis
   * envoyait au cimetière, redevenait inconnue de Bob dès qu'elle repassait par
   * une zone cachée — ou même simplement en arrivant quelque part : le siège
   * d'arrivée écrasait tout. Ce n'est pas ce qui se passe à une vraie table :
   * on se souvient de ce qu'on a vu, et reprendre en main une créature que
   * l'adversaire a regardée ne lui fait pas oublier laquelle c'était.
   *
   * D'où la règle : on n'**ajoute** plus qu'à `knownTo`. Ce qu'un siège a
   * légitimement vu — parce qu'on le lui a montré, parce que la carte est passée
   * par le terrain, le cimetière ou l'exil, parce qu'un scry ou une fouille la
   * lui a fait voir, parce qu'il en est le propriétaire — lui reste acquis à
   * travers **tous** les changements de zone ultérieurs.
   *
   * **L'unique effacement est l'entrée en `LIBRARY`**, et il est cohérent avec
   * l'invariant qui fonde déjà toute la §2.1 : un objet de bibliothèque n'a pas
   * d'identifiant publié, et `SHUFFLE` les réattribue tous. Le lien entre
   * l'avant et l'après est physiquement coupé ; se souvenir n'aurait aucun sens,
   * puisqu'il n'y a plus rien à quoi rattacher le souvenir. C'est aussi ce qui
   * ferme le canal de corrélation, et cette moitié-là ne bouge pas.
   *
   * Zone par zone, et c'est délibéré dans chaque cas :
   *
   * - **`HAND`** — reprendre une carte en main ne la rend pas secrète à qui l'a
   *   déjà vue. Le propriétaire de la main s'ajoute, ainsi que les destinataires
   *   d'une révélation de main en cours (§6.5), mais personne ne sort.
   * - **`SIDEBOARD`**, **`FACEDOWN_TEMP`** — même chose : ce sont des zones
   *   cachées *par nature*, pas des lessiveuses. Seule la bibliothèque l'est.
   * - **zones publiques** (champ, cimetière, exil, commandement, pile) — une
   *   carte face visible devient connue de toute la table ; une carte posée
   *   **face cachée** garde ses connaisseurs. C'est exactement la situation
   *   d'une vraie table où l'on a vu la carte *avant* qu'elle ne soit retournée,
   *   et c'est tout l'intérêt de la règle : cacher une carte que l'adversaire
   *   vient de regarder ne la lui fait pas oublier. Un morph joué depuis la main
   *   reste secret, lui, parce que personne ne l'avait vu — la monotonie ne
   *   révèle rien, elle empêche seulement d'oublier.
   * - **quitter le champ pour le cimetière puis revenir en jeu** — ni l'aller ni
   *   le retour ne touchent `knownTo` autrement qu'en l'élargissant.
   *
   * Contrepartie assumée : `TURN_FACE_DOWN` sur un permanent que la table a déjà
   * vu face visible ne cache plus rien à personne. C'est voulu, et c'est la
   * réalité physique du geste.
   */
  switch (to.kind) {
    case 'LIBRARY':
      obj.faceDown = true;
      obj.knownTo.clear();
      break;
    case 'HAND':
      obj.faceDown = true;
      // Une main révélée le reste : une carte qui y entre est vue des mêmes
      // sièges que le reste de la main (docs/protocol.md §6.5).
      obj.knownTo.add(to.seat);
      for (const s of state.seats.get(to.seat)?.handRevealedTo ?? []) {
        // Ce que la révélation de main accorde ici, `UNREVEAL_HAND` pourra le
        // reprendre ; ce qui était déjà su ne lui appartient pas.
        if (!obj.knownTo.has(s)) state.seats.get(to.seat)?.handRevealedGranted.add(obj.id);
        obj.knownTo.add(s);
      }
      break;
    case 'SIDEBOARD':
      obj.faceDown = true;
      obj.knownTo.add(to.seat);
      break;
    case 'FACEDOWN_TEMP':
      obj.faceDown = true;
      obj.knownTo.add(to.seat);
      break;
    default: {
      /*
       * **Une carte face cachée le reste.**
       *
       * Ici s'écrivait `obj.faceDown = opts.faceDown ?? false` : ne rien
       * demander valait « retourne-la face visible », et `knownTo` repassait à
       * tous les sièges dans la foulée. Une carte posée face cachée sur le
       * champ puis envoyée à l'exil, au cimetière ou sur la pile se révélait
       * donc à toute la table, sans que personne ne l'ait demandé. C'était une
       * fuite d'information cachée, la pire catégorie de défaut de ce serveur.
       *
       * L'absence de `faceDown` dans l'intent ne veut pas dire « face
       * visible » : elle ne veut rien dire du tout. La règle est donc la
       * conservation, et elle se décline selon la provenance :
       *
       * - depuis une **zone publique** (champ, cimetière, exil, commandement,
       *   pile), l'état est conservé tel quel : y être face cachée est un
       *   choix de jeu (`isPublicZone`), et un choix ne s'annule pas tout seul ;
       * - depuis une **zone cachée** (main, bibliothèque, réserve, pile face
       *   cachée), l'état ne veut rien dire — `faceDown` y découle de la zone
       *   (§3 du protocole) — et la carte arrive face visible. Sans cette
       *   moitié de la règle, jouer une carte de sa main la poserait face
       *   cachée, ce qui serait le défaut symétrique.
       *
       * Un `faceDown` explicite gagne toujours, dans les deux sens : c'est ce
       * qui permet d'exiler face cachée **depuis n'importe quelle zone**, main
       * et bibliothèque comprises (`MOVE_CARD { faceDown: true }`).
       *
       * Ce n'est pas une règle de Magic appliquée en douce (§1.5) : le serveur
       * ne retourne rien de son propre chef, il se contente de ne plus
       * retourner ce qu'on ne lui a pas demandé de retourner. Une carte face
       * cachée au cimetière se révèle par `TURN_FACE_UP`, comme on la
       * retournerait de la main sur une vraie table.
       */
      const wasFaceDown = obj.faceDown && isPublicZone(from.kind);
      obj.faceDown = opts.faceDown ?? wasFaceDown;
      if (obj.faceDown) {
        // Face cachée, demandée ou conservée : personne n'apprend rien, et —
        // monotonie — personne n'oublie. Le propriétaire s'ajoute : c'est sa
        // carte, il la voit sous le dos.
        obj.knownTo.add(obj.owner);
      } else {
        for (const s of state.seats.keys()) obj.knownTo.add(s);
      }
      break;
    }
  }

  if (to.kind !== 'BATTLEFIELD') {
    obj.tapped = opts.tapped ?? false;
    obj.rotation = 0;
    obj.attachedTo = undefined;
    // Les compteurs ne suivent pas une carte qui change de zone.
    obj.counters = [];
    // Un jeton qui quitte le champ de bataille cesse d'exister ; l'appelant
    // se charge de le retirer, on ne le fait pas ici pour rester prévisible.
  }

  insertIntoZone(state, to, obj.id, position, (max) => rng.below(max));
  return from;
}

/**
 * `CARD_MOVED`, mais l'identifiant d'un objet qui entre dans une zone non
 * énumérable (bibliothèque) est retiré de la vue des autres sièges : ils
 * reçoivent `CARD_HIDDEN`, qui leur dit d'oublier l'objet sans leur apprendre
 * qu'un identifiant de bibliothèque vaut désormais cette carte (§2.1).
 */
function moveEmission(state: GameState, obj: GameObjectState, from: ZoneRef, log?: string): Emission {
  const to = obj.zone;
  const hiddenDestination = !isEnumerableZone(to.kind);
  const owner = to.seat;
  const id = obj.id;
  // L'objet est figé ici, pas à l'émission : un mélange survenant plus loin dans
  // le même intent (SCOOP, MULLIGAN) réattribue les identifiants, et l'event
  // doit décrire le déplacement tel qu'il a eu lieu — avec l'ancien identifiant,
  // le seul que les clients connaissent.
  const frozen: GameObjectState = {
    ...obj,
    zone: { ...to },
    counters: obj.counters.map((c) => ({ ...c })),
    knownTo: new Set(obj.knownTo),
  };
  const emission: Emission = {
    audience: ALL,
    build: (seat) => {
      if (hiddenDestination && seat !== owner) return { type: 'CARD_HIDDEN', cardId: id };
      // L'objet vivant est préféré à la copie figée : insérer une carte au-dessus
      // d'une pile décale le `sortIndex` des suivantes, et l'event doit publier
      // le rang final, pas celui d'avant le décalage.
      const live = state.objects.get(id);
      return { type: 'CARD_MOVED', card: projectCard(live ?? frozen, seat), from, to: live?.zone ?? to };
    },
  };
  if (log) emission.log = { text: log, cardIds: hiddenDestination ? [] : [id] };
  return emission;
}

function zoneCount(state: GameState, zone: ZoneRef): Emission {
  const count = getZone(state, zone).length;
  return { audience: ALL, build: () => ({ type: 'ZONE_COUNT', zone, count }) };
}

/**
 * Mélange une zone et réattribue de nouveaux identifiants à son contenu.
 *
 * Sans cette réattribution, un client qui note les identifiants avant et après
 * un mélange reconstruirait l'ordre de la bibliothèque : la fuite serait
 * invisible à un test qui ne chercherait que des identités de cartes.
 */
/**
 * Mélange une zone **et réattribue les identifiants de tous ses objets**.
 *
 * Les deux vont ensemble : sans la réattribution, corréler les identifiants
 * avant et après révélerait l'ordre (§2.1). `room.startGame` s'en sert aussi,
 * d'où l'export.
 */
export function shuffleZone(state: GameState, zone: ZoneRef, rng: RandomSource): void {
  const list = getZone(state, zone);
  rng.shuffle(list);

  const renamed: ObjectId[] = [];
  for (const oldId of list) {
    const obj = state.objects.get(oldId);
    if (!obj) continue;
    state.objects.delete(oldId);
    obj.id = ulid();
    obj.knownTo.clear();
    state.objects.set(obj.id, obj);
    renamed.push(obj.id);
  }
  state.zones.set(zoneKey(zone), renamed);
  renamed.forEach((id, i) => {
    const obj = state.objects.get(id);
    if (obj) obj.sortIndex = i;
  });
}

/**
 * Donne un identifiant neuf à un objet, en place, et rend l'ancien.
 *
 * C'est la moitié utile de `shuffleZone` isolée : celle qui **coupe le lien**
 * entre ce que les clients détiennent déjà et ce qu'ils vont recevoir. Un
 * client qui a reçu la vue publique d'un objet l'a indexée par son `ObjectId` ;
 * purger `knownTo` sans changer l'identifiant laisserait cette vue en place
 * chez lui, et le masquage serait un mensonge poli. Avec un identifiant neuf,
 * un `CARD_HIDDEN` sur l'ancien fait vraiment tomber l'ancienne vue.
 *
 * L'objet garde tout le reste — sa carte, sa zone, son rang, ses marqueurs :
 * ce n'est pas une nouvelle carte, c'est la même sous un nom que personne ne
 * connaît encore.
 */
export function reassignId(state: GameState, obj: GameObjectState): ObjectId {
  const oldId = obj.id;
  state.objects.delete(oldId);
  obj.id = ulid();
  state.objects.set(obj.id, obj);
  // La zone indexe par identifiant : sans ce remplacement en place, elle garde
  // un identifiant fantôme et l'objet n'est plus nulle part.
  const list = getZone(state, obj.zone);
  const at = list.indexOf(oldId);
  if (at >= 0) list[at] = obj.id;
  return oldId;
}

function counterValue(obj: GameObjectState, kind: string): number {
  return obj.counters.find((c) => c.kind === kind)?.value ?? 0;
}

/**
 * Pose, change ou retire un marqueur.
 *
 * `null` retire. `undefined` pose un **mot-cle** : un marqueur sans quantite,
 * affiche seul — « vol », « ne se degage pas ». Un nombre le compte, et zero
 * le retire comme avant : c'est ainsi qu'on enleve le dernier +1/+1.
 *
 * La position dans la liste est preservee lors d'une mise a jour : un marqueur
 * qui saute a la fin a chaque « +1 » fait viser un bouton qui vient de bouger.
 */
function setCounter(obj: GameObjectState, kind: string, value: number | null | undefined): void {
  const existing = obj.counters.find((c) => c.kind === kind);
  if (value === null || value === 0) {
    obj.counters = obj.counters.filter((c) => c.kind !== kind);
    return;
  }
  if (existing) {
    if (value === undefined) delete existing.value;
    else existing.value = value;
    return;
  }
  obj.counters.push(value === undefined ? { kind } : { kind, value });
}

/**
 * Point d'entrée du moteur.
 *
 * Il ne fait rien de plus qu'appeler l'intent et **recoller les rangs**
 * derrière lui. Le rattrapage est ici, et pas dans chacun des vingt endroits
 * qui appellent `relocate`, parce que le défaut qu'il corrige n'appartient à
 * aucun d'eux en particulier : il naît de `reindexZone`, que toute mutation de
 * zone déclenche, et il réapparaîtrait au premier intent écrit ensuite. Le
 * raisonnement complet est dans `rankShiftEmissions`.
 */
export function applyIntent(
  state: GameState,
  seatId: SeatId,
  intent: Intent,
  rng: RandomSource,
  deps: EngineDeps = {},
): IntentResult {
  const before = captureZoneOrders(state);
  const result = applyIntentCore(state, seatId, intent, rng, deps);
  // Après les events de l'intent : le client applique dans l'ordre reçu, et
  // c'est la remise à plat qui doit avoir le dernier mot.
  result.emissions.push(...rankShiftEmissions(state, before));
  return result;
}

function applyIntentCore(
  state: GameState,
  seatId: SeatId,
  intent: Intent,
  rng: RandomSource,
  deps: EngineDeps = {},
): IntentResult {
  const seat = seatOf(state, seatId);
  const who = seat.displayName;
  state.lastActivityAt = Date.now();

  switch (intent.type) {
    case 'MOVE_CARD': {
      const obj = objectOf(state, intent.cardId);
      assertNotLocked(state, obj.id);
      assertMayTouch(obj, seatId, intent);
      assertLegalDestination(obj, intent.to);

      const before = snapshotObject(obj);
      const fromLabel = zoneLabel(obj.zone);
      const nameBefore = publicName(obj, state);

      const opts: Parameters<typeof relocate>[5] = {};
      if (intent.faceDown !== undefined) opts.faceDown = intent.faceDown;
      if (intent.tapped !== undefined) opts.tapped = intent.tapped;
      if (intent.x !== undefined) opts.x = intent.x;
      if (intent.y !== undefined) opts.y = intent.y;

      const from = relocate(state, obj, intent.to, intent.index, rng, opts);

      // Un jeton qui quitte le champ de bataille cesse d'exister.
      if (obj.kind === 'TOKEN' && intent.to.kind !== 'BATTLEFIELD') {
        removeFromZone(state, obj.zone, obj.id);
        state.objects.delete(obj.id);
        return {
          emissions: [
            {
              audience: ALL,
              build: () => ({ type: 'TOKENS_DESTROYED', cardIds: [obj.id] }),
              log: { text: `le jeton ${nameBefore} de ${who} a cessé d'exister`, cardIds: [] },
            },
            ...detachDependents(state, obj.id),
            zoneCount(state, from),
          ],
        };
      }

      const nameAfter = publicName(obj, state);
      const shownName = nameAfter !== 'une carte' ? nameAfter : nameBefore;
      // Repositionner une carte dans la zone où elle est déjà n'est pas un
      // déplacement : c'est du rangement. Le journaliser noierait les vraies
      // actions sous « a déplacé X de champ de bataille vers champ de bataille ».
      const sameZone = from.seat === obj.zone.seat && from.kind === obj.zone.kind;
      /*
       * Ranger une carte dans sa propre zone renumérote **toutes** les autres
       * (`reindexZone`), mais un seul `CARD_MOVED` ne parle que d'elle : les
       * clients gardaient alors le rang d'avant pour le reste de la zone, deux
       * cartes se retrouvaient au même rang, et la main s'affichait dans un
       * ordre que le serveur n'avait jamais décidé.
       *
       * On publie donc la zone entière. C'est réservé au repositionnement au
       * sein d'une zone listée : ailleurs, l'ordre relatif des autres cartes ne
       * change pas.
       */
      if (sameZone && REORDERABLE_ZONES.has(obj.zone.kind)) {
        const zone = obj.zone;
        const ordered = getZone(state, zone)
          .map((id) => state.objects.get(id))
          .filter((o): o is GameObjectState => o !== undefined);
        return {
          emissions: [
            {
              audience: ALL,
              build: (s) => ({
                type: 'CARDS_MOVED',
                cards: ordered.map((o) => projectCard(o, s)),
                from: zone,
                to: zone,
              }),
            },
          ],
          undo: undoRestore(state, obj.id, before, rng),
        };
      }
      const emissions = [
        sameZone
          ? moveEmission(state, obj, from)
          : moveEmission(
              state,
              obj,
              from,
              `${who} a déplacé ${shownName} de ${fromLabel} vers ${zoneLabel(obj.zone)}`,
            ),
        // Une carte qui quitte le champ de bataille emmène ses attachements
        // dans le vide : on les détache explicitement.
        ...(from.kind === 'BATTLEFIELD' && obj.zone.kind !== 'BATTLEFIELD'
          ? detachDependents(state, obj.id)
          : []),
        ...commanderTax(state, obj, from),
        zoneCount(state, from),
        zoneCount(state, obj.zone),
      ];
      return { emissions, undo: undoRestore(state, obj.id, before, rng) };
    }

    case 'MOVE_CARDS': {
      // Les mêmes gardes que MOVE_CARD, et pas un contrôle de moins : un lot
      // n'est pas une porte dérobée vers la main d'un autre siège.
      const emissions: Emission[] = [];
      const targets: GameObjectState[] = [];
      for (const id of intent.cardIds) {
        const obj = objectOf(state, id);
        assertNotLocked(state, id);
        assertMayTouch(obj, seatId, intent);
        assertLegalDestination(obj, intent.to);
        targets.push(obj);
      }

      // Un lot déplacé doit s'annuler comme un tout : sans cet instantané,
      // `UNDO_LAST` ne ramenait rien du tout après un dépôt groupé.
      const before = targets.map((obj) => ({ id: obj.id, snapshot: snapshotObject(obj) }));

      let origin: ZoneRef | null = null;
      const moved: GameObjectState[] = [];
      const destroyed: ObjectId[] = [];
      for (const obj of targets) {
        const opts = intent.faceDown !== undefined ? { faceDown: intent.faceDown } : {};
        const from = relocate(state, obj, intent.to, intent.index, rng, opts);
        origin ??= from;
        emissions.push(zoneCount(state, from));
        if (obj.kind === 'TOKEN' && intent.to.kind !== 'BATTLEFIELD') {
          // Cohérent avec MOVE_CARD : un jeton hors du champ cesse d'exister.
          removeFromZone(state, obj.zone, obj.id);
          state.objects.delete(obj.id);
          destroyed.push(obj.id);
          emissions.push(...detachDependents(state, obj.id));
          continue;
        }
        if (from.kind === 'BATTLEFIELD' && obj.zone.kind !== 'BATTLEFIELD') {
          emissions.push(...detachDependents(state, obj.id));
        }
        emissions.push(...commanderTax(state, obj, from));
        moved.push(obj);
      }

      // Le lot est nommé après coup, une fois les cartes arrivées : c'est la
      // zone d'arrivée qui décide de ce que la table a le droit de lire, et un
      // lot posé face cachée ou rentré en main retombe tout seul sur le compte.
      const named = namedBatch(moved, state, intent.to.kind);

      // Vers une zone non énumérable, les autres sièges n'apprennent pas les
      // identifiants : ils reçoivent un lot vide puis un CARD_HIDDEN par carte.
      const hiddenDestination = !isEnumerableZone(intent.to.kind);
      const owner = intent.to.seat;
      const outsiders = [...state.seats.keys()].filter((x) => x !== owner);
      emissions.unshift({
        audience: ALL,
        build: (s) => ({
          type: 'CARDS_MOVED',
          cards: hiddenDestination && s !== owner ? [] : moved.map((o) => projectCard(o, s)),
          from: origin ?? intent.to,
          to: intent.to,
        }),
        log: named
          ? {
              text: `${who} a déplacé ${named.names} vers ${zoneLabel(intent.to)}`,
              cardIds: named.cardIds,
            }
          : {
              text: `${who} a déplacé ${intent.cardIds.length} carte(s) vers ${zoneLabel(intent.to)}`,
              cardIds: [],
            },
      });
      if (destroyed.length > 0) {
        emissions.push({ audience: ALL, build: () => ({ type: 'TOKENS_DESTROYED', cardIds: destroyed }) });
      }
      if (hiddenDestination && outsiders.length > 0) {
        for (const obj of moved) {
          const id = obj.id;
          emissions.push({
            audience: { kind: 'SEATS', seats: outsiders },
            build: () => ({ type: 'CARD_HIDDEN', cardId: id }),
          });
        }
      }
      emissions.push(zoneCount(state, intent.to));

      // Un jeton détruit par le déplacement ne se recrée pas : dans ce cas le
      // lot n'est pas annulable, plutôt que de faire réapparaître un objet mort.
      const undoable = destroyed.length === 0;
      return {
        emissions,
        ...(undoable
          ? {
              undo: {
                at: Date.now(),
                run: (): Emission[] => {
                  const out: Emission[] = [];
                  for (const { id, snapshot } of before) {
                    const obj = state.objects.get(id);
                    if (!obj) continue;
                    const from = obj.zone;
                    removeFromZone(state, from, obj.id);
                    obj.zone = snapshot.zone;
                    obj.x = snapshot.x;
                    obj.y = snapshot.y;
                    obj.tapped = snapshot.tapped;
                    obj.faceDown = snapshot.faceDown;
                    obj.counters = snapshot.counters.map((c) => ({ ...c }));
                    obj.knownTo = new Set(snapshot.knownTo);
                    insertIntoZone(state, snapshot.zone, obj.id, snapshot.index, (max) => rng.below(max));
                    out.push(moveEmission(state, obj, from), zoneCount(state, from));
                  }
                  out.push(zoneCount(state, intent.to));
                  return out;
                },
              },
            }
          : {}),
      };
    }

    case 'TAP':
    case 'UNTAP': {
      const tapped = intent.type === 'TAP';
      const changed: GameObjectState[] = [];
      for (const id of intent.cardIds) {
        const obj = objectOf(state, id);
        assertMayTouch(obj, seatId, intent);
        if (obj.tapped === tapped) continue;
        obj.tapped = tapped;
        changed.push(obj);
      }
      if (changed.length === 0) return { emissions: [] };

      const emissions = changed.map(cardUpdate);
      // Un lasso engage volontiers dix permanents d'un coup : énumérer les dix
      // pousse le reste de la partie hors du journal. `namedBatch` est la règle
      // commune — il tait ce que la table n'a pas le droit de lire, replie
      // au-delà du seuil, et garde malgré tout toutes les ancres.
      const named = namedBatch(changed, state, 'BATTLEFIELD');
      emissions[0]!.log = named
        ? { text: `${who} a ${tapped ? 'engagé' : 'dégagé'} ${named.names}`, cardIds: named.cardIds }
        : // Que des faces cachées : le compte est tout ce qui se dit sans mentir.
          { text: `${who} a ${tapped ? 'engagé' : 'dégagé'} ${changed.length} carte(s)`, cardIds: [] };
      const ids = changed.map((o) => o.id);
      return {
        emissions,
        undo: {
          at: Date.now(),
          run: () =>
            ids.map((id) => {
              const obj = state.objects.get(id);
              if (obj) obj.tapped = !tapped;
              return obj ? cardUpdate(obj) : { audience: ALL, build: () => ({ type: 'CARD_HIDDEN', cardId: id }) };
            }),
        },
      };
    }

    case 'UNTAP_ALL': {
      const target = intent.seat ?? seatId;
      const changed = [...state.objects.values()].filter(
        (o) => o.zone.kind === 'BATTLEFIELD' && o.controller === target && o.tapped,
      );
      // Rien n'était engagé : le geste n'a rien fait. Comme `TAP`/`UNTAP`, on se
      // tait plutôt que d'annoncer un dégagement qui n'a rien dégagé — un
      // joueur qui relit le journal doit pouvoir croire chaque ligne. Le bouton
      // « Tout dégager » est cliqué à chaque début de tour, souvent pour rien :
      // l'annoncer quand même noierait le journal sous des lignes vides.
      if (changed.length === 0) return { emissions: [] };

      for (const obj of changed) obj.tapped = false;
      const emissions = changed.map(cardUpdate);
      // Dire *quoi*, pas seulement *que* : « a tout dégagé » laissait l'adversaire
      // deviner ce qui venait de se redresser. Même règle que `TAP`/`UNTAP` —
      // `namedBatch` tait les faces cachées, replie les longues listes, et rend
      // toutes les ancres pour que le survol surligne le lot entier.
      const named = namedBatch(changed, state, 'BATTLEFIELD');
      // `NOTED` porte la ligne de journal et rien d'autre. Détourner
      // `PHASE_CHANGED` pour cela ferait croire à un changement de phase.
      emissions.push({
        audience: ALL,
        build: () => ({ type: 'NOTED' }),
        log: named
          ? { text: `${who} a tout dégagé : ${named.names}`, cardIds: named.cardIds }
          : { text: `${who} a tout dégagé : ${changed.length} carte(s)`, cardIds: [] },
      });
      return { emissions };
    }

    case 'SET_ROTATION': {
      const obj = objectOf(state, intent.cardId);
      assertMayTouch(obj, seatId, intent);
      obj.rotation = intent.rotation;
      return { emissions: [cardUpdate(obj)] };
    }

    case 'FLIP_FACE': {
      const obj = objectOf(state, intent.cardId);
      assertMayTouch(obj, seatId, intent);
      obj.flipped = !obj.flipped;
      return {
        emissions: [
          {
            ...cardUpdate(obj),
            log: { text: `${who} a retourné ${publicName(obj, state)}`, cardIds: [obj.id] },
          },
        ],
      };
    }

    case 'TURN_FACE_DOWN': {
      const obj = objectOf(state, intent.cardId);
      assertMayTouch(obj, seatId, intent);
      obj.faceDown = true;
      // Monotonie (voir `relocate`) : retourner une carte ne fait rien oublier à
      // qui l'a déjà vue. On n'ajoute donc que le propriétaire et l'auteur du
      // geste, qui la manipulent tous les deux.
      obj.knownTo.add(obj.owner);
      obj.knownTo.add(seatId);
      return {
        emissions: [
          {
            ...cardUpdate(obj),
            // L'ancre ne dit rien que la table ne voie déjà : le `CARD_UPDATED`
            // part à tout le monde, chacun voit *cette* carte se retourner. Le
            // nom, lui, reste tu — c'est la seule chose qui fuirait.
            log: { text: `${who} a retourné une carte face cachée`, cardIds: [obj.id] },
          },
        ],
      };
    }

    case 'TURN_FACE_UP': {
      const obj = objectOf(state, intent.cardId);
      assertMayTouch(obj, seatId, intent);
      obj.faceDown = false;
      for (const s of state.seats.keys()) obj.knownTo.add(s);
      return {
        emissions: [
          {
            ...cardUpdate(obj),
            log: { text: `${who} a révélé ${cardName(obj)}`, cardIds: [obj.id] },
          },
        ],
      };
    }

    case 'PEEK_FACE_DOWN': {
      const obj = objectOf(state, intent.cardId);
      if (obj.owner !== seatId) {
        throw new IntentError('ERR_NOT_YOURS', "Ce n'est pas ta carte.");
      }
      obj.knownTo.add(seatId);
      // Le regard est annoncé publiquement, sans révéler la carte : c'est la
      // contrepartie sociale de l'information cachée (§6.1). L'identité ne part
      // qu'au regardeur ; la ligne de journal, elle, est diffusée à toute la
      // table par `commit`, qui sert un `NOTED` aux autres sièges.
      return {
        emissions: [
          {
            audience: { kind: 'SEAT', seat: seatId },
            build: (s) => ({ type: 'CARD_UPDATED', card: projectCard(obj, s) }),
            log: { text: `${who} a regardé une carte face cachée`, cardIds: [] },
          },
        ],
      };
    }

    /*
     * **Rattraper une carte posée par erreur** — l'exception assumée à la
     * monotonie de la connaissance (docs/protocol.md §5.2).
     *
     * Partout ailleurs, `knownTo` ne fait que croître : on n'organise pas une
     * amnésie que la vraie table ne connaît pas. Ici on l'organise, et il faut
     * dire pourquoi, parce que c'est le seul endroit du serveur qui reprenne
     * une connaissance sans passer par la bibliothèque.
     *
     * La raison n'est pas technique, elle est **sociale**. À une vraie table,
     * quand quelqu'un dévoile une carte par maladresse — la main qui s'ouvre
     * trop tôt, la carte relâchée sur le tapis —, les joueurs ne font pas
     * semblant d'avoir un serveur : ils *conviennent* de l'oublier. Le geste
     * existe dans la vraie vie, il est donc légitime ici. Trois conséquences,
     * et ce sont elles qui le rendent honnête plutôt que tricheur :
     *
     * 1. **Il est public.** L'emission porte une ligne de journal nominative,
     *    diffusée à toute la table par `commit` (§4.2). Effacer en silence la
     *    mémoire des autres joueurs serait de la triche ; annoncé, c'est une
     *    convention de table, et chacun peut protester à voix haute.
     * 2. **L'identifiant est réattribué.** C'est le point qui décide de tout :
     *    les clients adverses ont déjà reçu la vue publique de cet objet,
     *    indexée par son `ObjectId`. Purger `knownTo` seul laisserait cette vue
     *    en place chez eux et le masquage serait un mensonge — le serveur
     *    dirait « oubliez » sans que rien n'oublie. On coupe donc le lien comme
     *    le fait `shuffleZone` depuis toujours (§2.1) : identifiant neuf,
     *    `CARD_HIDDEN` sur l'ancien, puis l'arrivée du nouveau.
     * 3. **Le propriétaire, et lui seul.** C'est sa maladresse, et surtout il
     *    est le seul à *perdre* quelque chose au geste. Ouvert au contrôleur de
     *    passage — une carte prêtée — ou à toute la table, « oublier » cesse
     *    d'être un rattrapage pour devenir une arme : n'importe qui effacerait
     *    de la mémoire commune une carte que vous venez de révéler exprès. Le
     *    droit suit donc la perte, comme pour `SET_COMMANDER_DAMAGE` (§6.6).
     *    Et il n'est pas trop étroit : une carte n'arrive sur le champ que
     *    depuis une zone de son propriétaire (`assertLegalDestination`), la
     *    maladresse est forcément la sienne.
     *
     * Trois refus structurels, qui ne sont pas des règles de Magic (§1.5) mais
     * des cas où l'oubli serait faux : un **jeton** n'a pas de main d'où il
     * serait tombé (`DESTROY_TOKEN` est le geste attendu) ; une carte d'une
     * **zone cachée** n'a été dévoilée à personne, il n'y a rien à rattraper ;
     * un **commandant** est de notoriété publique dès le chargement du deck
     * (`DECK_LOADED` le nomme), et prétendre que la table l'oublie serait un
     * mensonge que le serveur est en mesure de détecter.
     */
    /*
     * Cascade et Découvrir. Toute la séquence vit dans `cascade.ts` ; ce
     * `case` n'est qu'une porte, comme `applyIntentPart2` en est une.
     *
     * Ce n'est pas une règle de Magic appliquée en douce (§1.5) : le serveur
     * n'y refuse rien, ne décide de rien, et exécute à la demande une suite de
     * déplacements que le joueur ferait sinon un par un. Le seuil vient de lui,
     * la carte trouvée reste à l'exil sous ses yeux, et il en dispose comme il
     * l'entend. Le raisonnement complet est en tête de `cascade.ts`.
     */
    case 'CASCADE':
      return resolveCascade(state, seatId, who, intent, rng);

    /*
     * Proliférer. Même porte, même raison : la séquence vit dans
     * `proliferate.ts`, et le moteur ne fait que l'appeler.
     *
     * Rien n'est jugé ici non plus. Le joueur désigne les objets, le module lit
     * les marqueurs qui y sont déjà posés et en ajoute un de chaque — soit
     * exactement la suite d'`ADD_COUNTER` qu'il aurait tapée, en un seul `seq`
     * et une seule ligne de journal.
     */
    case 'PROLIFERATE':
      return resolveProliferate(state, seatId, who, intent);

    case 'TAKE_BACK': {
      const obj = objectOf(state, intent.cardId);
      assertNotLocked(state, obj.id);
      if (obj.owner !== seatId) {
        throw new IntentError('ERR_NOT_YOURS', 'Seul le propriétaire de la carte peut la faire oublier.');
      }
      if (obj.kind === 'TOKEN') {
        throw new IntentError('ERR_BAD_ZONE', "Un jeton ne se reprend pas : il se détruit.");
      }
      if (!isPublicZone(obj.zone.kind)) {
        throw new IntentError('ERR_BAD_ZONE', "Cette carte n'est posée nulle part : personne ne l'a vue.");
      }
      if (obj.origin === 'COMMAND') {
        throw new IntentError('ERR_BAD_ZONE', 'Un commandant est connu de la table depuis le chargement du deck.');
      }

      const from = obj.zone;
      const oldId = obj.id;
      const emissions: Emission[] = [];

      // Ce qui pointait vers l'ancien identifiant pointerait vers un objet mort.
      emissions.push(...detachDependents(state, oldId));
      obj.attachedTo = undefined;
      /*
       * Une étiquette accrochée à la carte **est** un pointeur vers elle : la
       * laisser flotter à l'endroit exact du permanent, ou pire la raccrocher
       * au nouvel identifiant, désignerait du doigt l'objet qu'on vient de
       * faire oublier. On la retire, comme on reprend le papier collé dessus.
       */
      for (const label of [...state.labels.values()]) {
        if (label.attachedTo !== oldId) continue;
        state.labels.delete(label.id);
        const labelId = label.id;
        emissions.push({ audience: ALL, build: () => ({ type: 'LABEL_REMOVED', labelId }) });
      }

      // L'ordre compte pour la lecture, pas pour la correction : « oubliez cet
      // objet » d'abord, l'arrivée du nouveau ensuite.
      emissions.push({
        audience: ALL,
        build: () => ({ type: 'CARD_HIDDEN', cardId: oldId }),
        log: {
          text:
            intent.to === 'HAND'
              ? `${who} a repris en main une carte posée par erreur`
              : `${who} a masqué une carte posée par erreur`,
          // Pas d'ancre : elle désignerait l'objet que le geste efface.
          cardIds: [],
        },
      });

      /*
       * **Le journal garde le fait, plus le nom.**
       *
       * Sans ce passage, le geste était décoratif : le journal conservait
       * « Alice a déplacé Carte 2 de main vers champ de bataille », nom compris,
       * et l'ancre pointait sur un objet qui n'existe plus. Il suffisait de
       * remonter de trois lignes pour défaire l'oubli, et le `logTail` du
       * prochain snapshot le republiait à qui se resynchronisait.
       *
       * Ce n'est pas réécrire l'histoire : c'est **réappliquer au passé la règle
       * du §4.2**, qui interdit d'écrire dans le journal le nom d'une carte que
       * tous les sièges ne peuvent pas voir. La prémisse de ces lignes-là vient
       * de changer ; leur texte doit suivre, et devenir la périphrase que
       * `publicName` aurait produite à la seconde près. Le fait reste — Alice a
       * bien posé quelque chose —, l'ancre disparaît avec l'objet qu'elle
       * désignait.
       *
       * Résidu assumé : un client déjà connecté garde dans son journal la ligne
       * qu'il a reçue en direct, exactement comme un joueur garde en tête ce
       * qu'il a entendu. On ne dédit pas une parole ; on corrige ce qui est
       * écrit, et c'est ce qu'obtient quiconque se resynchronise ou arrive.
       */
      /*
       * Le remplacement est borné aux **mots entiers**. `split(nom).join(…)`
       * frappait aussi les noms dont celui-ci est un préfixe : rattraper
       * « Île » réécrivait « Île Sanctuaire » en « une carte Sanctuaire »,
       * c'est-à-dire qu'il mutilait la ligne d'une carte que personne n'avait
       * demandé d'oublier. Le défaut dormait tant que le journal ne nommait
       * presque rien ; il devient certain dès que chaque lot nomme ses cartes.
       *
       * Les bornes sont lettres et chiffres Unicode, pas `\b` : un nom français
       * se termine volontiers par une lettre accentuée, que `\b` considère
       * comme une frontière et qui laisserait passer un faux positif.
       */
      const spoken = obj.card.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const speaks = new RegExp(`(?<![\\p{L}\\p{N}])${spoken}(?![\\p{L}\\p{N}])`, 'gu');
      for (const entry of state.log) {
        if (!entry.cardIds.includes(oldId)) continue;
        entry.cardIds = entry.cardIds.filter((x) => x !== oldId);
        entry.text = entry.text.replace(speaks, 'une carte');
      }

      reassignId(state, obj);
      // Le cœur du geste. Tout le monde oublie, y compris le propriétaire —
      // que la suite réinscrit aussitôt : c'est sa carte, il la voit.
      obj.knownTo.clear();

      if (intent.to === 'HAND') {
        // Retour en zone cachée : `relocate` remet le propriétaire dans
        // `knownTo`, et rend la carte aux sièges à qui sa main est révélée —
        // il n'y a pas à tricher avec une révélation en cours.
        relocate(state, obj, { seat: obj.owner, kind: 'HAND' }, undefined, rng);
        emissions.push(moveEmission(state, obj, from), zoneCount(state, from), zoneCount(state, obj.zone));
      } else {
        obj.faceDown = true;
        obj.knownTo.add(obj.owner);
        // Même zone, même place : seule l'identité change de main. Le
        // `CARD_MOVED` porte la nouvelle vue, cachée pour les autres sièges.
        emissions.push(moveEmission(state, obj, from));
      }

      // Volontairement non annulable : `UNDO_LAST` republierait l'identité que
      // la table vient de convenir d'oublier, et le journal garderait les deux
      // lignes. Se raviser se fait à la main, en remontrant la carte.
      return { emissions };
    }

    case 'SET_COUNTER':
    case 'ADD_COUNTER':
    case 'REMOVE_COUNTER': {
      const obj = objectOf(state, intent.targetId);
      assertMayTouch(obj, seatId, intent);
      const kind = intent.kind;
      const previous = counterValue(obj, kind);
      const next =
        intent.type === 'SET_COUNTER'
          ? intent.value
          : intent.type === 'ADD_COUNTER'
            ? previous + intent.delta
            : 0;
      setCounter(obj, kind, next);

      const emission = cardUpdate(obj);
      // Un mot-clé ne se compte pas : l'annoncer « 1 marqueur vol » serait faux.
      emission.log = {
        text:
          next === undefined
            ? `${who} a posé ${kind} sur ${publicName(obj, state)}`
            : next === null || next === 0
              ? `${who} a retiré ${kind} de ${publicName(obj, state)}`
              : `${who} a mis ${next} marqueur(s) ${kind} sur ${publicName(obj, state)}`,
        cardIds: [obj.id],
      };
      const id = obj.id;
      return {
        emissions: [emission],
        undo: {
          at: Date.now(),
          run: () => {
            const target = state.objects.get(id);
            if (!target) return [];
            setCounter(target, kind, previous);
            return [cardUpdate(target)];
          },
        },
      };
    }

    case 'ATTACH': {
      const source = objectOf(state, intent.sourceId);
      const target = objectOf(state, intent.targetId);
      assertMayTouch(source, seatId, intent);
      if (source.id === target.id) throw new IntentError('ERR_BAD_ZONE', 'Un objet ne peut pas être attaché à lui-même.');
      if (target.zone.kind !== 'BATTLEFIELD') {
        throw new IntentError('ERR_BAD_ZONE', 'On ne peut attacher qu’à un permanent.');
      }
      // Une carte en main ou au cimetière n'a rien à attacher : sans cette
      // garde, `attachedTo` survit hors du champ et devient une référence morte.
      if (source.zone.kind !== 'BATTLEFIELD') {
        throw new IntentError('ERR_BAD_ZONE', 'Seul un permanent du champ de bataille peut être attaché.');
      }
      const previous = source.attachedTo;
      source.attachedTo = target.id;
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'ATTACHED', sourceId: source.id, targetId: target.id }),
            log: {
              text: `${who} a attaché ${publicName(source, state)} à ${publicName(target, state)}`,
              cardIds: [source.id, target.id],
            },
          },
          cardUpdate(source),
        ],
        undo: {
          at: Date.now(),
          run: () => {
            source.attachedTo = previous;
            return [
              previous
                ? { audience: ALL, build: () => ({ type: 'ATTACHED', sourceId: source.id, targetId: previous }) }
                : { audience: ALL, build: () => ({ type: 'DETACHED', sourceId: source.id }) },
              cardUpdate(source),
            ];
          },
        },
      };
    }

    case 'DETACH': {
      const source = objectOf(state, intent.sourceId);
      assertMayTouch(source, seatId, intent);
      const previous = source.attachedTo;
      source.attachedTo = undefined;
      return {
        emissions: [
          {
            audience: ALL,
            build: () => ({ type: 'DETACHED', sourceId: source.id }),
            // `ATTACH` écrit une ligne ; `DETACH` n'en écrivait aucune, si bien
            // qu'un détachement passait inaperçu à la table.
            ...(previous
              ? {
                  log: {
                    text: `${who} a détaché ${publicName(source, state)}`,
                    cardIds: [source.id],
                  },
                }
              : {}),
          },
          cardUpdate(source),
        ],
        undo: {
          at: Date.now(),
          run: () => {
            source.attachedTo = previous;
            return [cardUpdate(source)];
          },
        },
      };
    }

    case 'ADD_LABEL': {
      /*
       * Un marqueur porte un texte, une valeur, ou les deux — jamais rien.
       * Le texte est facultatif depuis qu'une valeur libre existe : « 1/1 » se
       * suffit, et lui imposer un nom obligeait a ecrire deux fois la meme
       * chose. Une etiquette vide des deux cotes, elle, ne s'afficherait pas.
       */
      if (intent.text.trim() === '' && (intent.value ?? '').trim() === '') {
        throw new IntentError('ERR_PAYLOAD', 'Un marqueur a besoin d’un texte ou d’une valeur.');
      }
      const label: Label = {
        id: ulid(),
        text: intent.text,
        x: intent.x,
        y: intent.y,
        owner: seatId,
        ...(intent.color ? { color: intent.color } : {}),
        ...(intent.value !== undefined ? { value: intent.value } : {}),
        ...(intent.attachedTo ? { attachedTo: intent.attachedTo } : {}),
      };
      state.labels.set(label.id, label);
      return {
        emissions: [{ audience: ALL, build: () => ({ type: 'LABEL_ADDED', label }) }],
        undo: {
          at: Date.now(),
          run: () => {
            state.labels.delete(label.id);
            return [{ audience: ALL, build: () => ({ type: 'LABEL_REMOVED', labelId: label.id }) }];
          },
        },
      };
    }

    case 'MOVE_LABEL': {
      const label = state.labels.get(intent.labelId);
      if (!label) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Étiquette inconnue.');
      const previous = { x: label.x, y: label.y };
      label.x = intent.x;
      label.y = intent.y;
      return {
        emissions: [{ audience: ALL, build: () => ({ type: 'LABEL_MOVED', labelId: label.id, x: label.x, y: label.y }) }],
        undo: {
          at: Date.now(),
          run: () => {
            label.x = previous.x;
            label.y = previous.y;
            return [{ audience: ALL, build: () => ({ type: 'LABEL_MOVED', labelId: label.id, x: label.x, y: label.y }) }];
          },
        },
      };
    }

    case 'SET_LABEL': {
      const label = state.labels.get(intent.labelId);
      if (!label) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Étiquette inconnue.');
      const previous: Label = { ...label };

      if (intent.text !== undefined) label.text = intent.text;
      if (intent.color !== undefined) label.color = intent.color;
      // `null` retire la valeur : le compteur redevient une simple note.
      if (intent.value === null) delete label.value;
      else if (intent.value !== undefined) label.value = intent.value;
      // `null` décroche l'étiquette ; un identifiant l'accroche à la carte.
      if (intent.attachedTo === null) delete label.attachedTo;
      else if (intent.attachedTo !== undefined) {
        objectOf(state, intent.attachedTo);
        label.attachedTo = intent.attachedTo;
      }

      return {
        emissions: [{ audience: ALL, build: () => ({ type: 'LABEL_UPDATED', label: { ...label } }) }],
        undo: {
          at: Date.now(),
          run: () => {
            state.labels.set(previous.id, previous);
            return [{ audience: ALL, build: () => ({ type: 'LABEL_UPDATED', label: { ...previous } }) }];
          },
        },
      };
    }

    case 'REMOVE_LABEL': {
      const label = state.labels.get(intent.labelId);
      if (!label) throw new IntentError('ERR_UNKNOWN_OBJECT', 'Étiquette inconnue.');
      state.labels.delete(label.id);
      return {
        emissions: [{ audience: ALL, build: () => ({ type: 'LABEL_REMOVED', labelId: label.id }) }],
        undo: {
          at: Date.now(),
          run: () => {
            state.labels.set(label.id, label);
            return [{ audience: ALL, build: () => ({ type: 'LABEL_ADDED', label }) }];
          },
        },
      };
    }

    default:
      return applyIntentPart2(state, seat, intent, rng, deps);
  }
}

/** Instantané minimal d'un objet, pour l'annulation. */
interface ObjectSnapshot {
  zone: ZoneRef;
  index: number;
  x: number;
  y: number;
  tapped: boolean;
  faceDown: boolean;
  counters: Counter[];
  knownTo: SeatId[];
}

function snapshotObject(obj: GameObjectState): ObjectSnapshot {
  return {
    zone: { ...obj.zone },
    index: obj.sortIndex,
    x: obj.x,
    y: obj.y,
    tapped: obj.tapped,
    faceDown: obj.faceDown,
    counters: obj.counters.map((c) => ({ ...c })),
    knownTo: [...obj.knownTo],
  };
}

function undoRestore(state: GameState, id: ObjectId, before: ObjectSnapshot, rng: RandomSource): UndoEntry {
  return {
    at: Date.now(),
    run: () => {
      const obj = state.objects.get(id);
      if (!obj) return [];
      const from = obj.zone;
      removeFromZone(state, from, obj.id);
      obj.zone = before.zone;
      obj.x = before.x;
      obj.y = before.y;
      obj.tapped = before.tapped;
      obj.faceDown = before.faceDown;
      obj.counters = before.counters.map((c) => ({ ...c }));
      obj.knownTo = new Set(before.knownTo);
      insertIntoZone(state, before.zone, obj.id, before.index, (max) => rng.below(max));
      return [
        { audience: ALL, build: (seat) => ({ type: 'CARD_MOVED', card: projectCard(obj, seat), from, to: obj.zone }) },
        zoneCount(state, from),
        zoneCount(state, obj.zone),
      ];
    },
  };
}

export {
  ALL,
  assertLegalDestination,
  // `assertMayTouch` et `setCounter` sortent pour `proliferate.ts`, et pour lui
  // seul : c'est ainsi qu'un module d'assistance applique **la même** garde et
  // **la même** sémantique de marqueur que le chemin manuel, au lieu d'en
  // réécrire une variante qui divergerait au premier correctif.
  assertMayTouch,
  assertNotLocked,
  assertZoneNotLocked,
  cardUpdate,
  detachDependents,
  moveEmission,
  namedBatch,
  namesForLog,
  objectOf,
  publicName,
  relocate,
  seatOf,
  setCounter,
  snapshotObject,
  zoneCount,
  zoneLabel,
  type ObjectSnapshot,
};
export { startingLife };

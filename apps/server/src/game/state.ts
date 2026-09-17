/**
 * État canonique d'une partie, en mémoire dans le processus propriétaire de la room.
 * Rien ici ne sort tel quel : tout passe par `projection.ts`.
 */
import type {
  Counter,
  GameMode,
  Label,
  LogEntry,
  LookMode,
  ObjectId,
  PhaseName,
  RoomStatus,
  Rotation,
  SeatId,
  Seq,
  ZoneKind,
  ZoneRef,
} from '@mtg/shared';

/** Données de carte figées au lancement, issues du DeckSnapshot. */
export interface CardData {
  scryfallId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  typeLine: string;
  manaCost: string | null;
  colorIdentity: string[];
  layout: string;
  imageUris: unknown;
  faces: unknown;
}

export interface GameObjectState {
  id: ObjectId;
  kind: 'CARD' | 'TOKEN';
  owner: SeatId;
  controller: SeatId;
  zone: ZoneRef;
  card: CardData;
  faceDown: boolean;
  flipped: boolean;
  tapped: boolean;
  x: number;
  y: number;
  rotation: Rotation;
  counters: Counter[];
  attachedTo?: ObjectId;
  isFoil: boolean;
  sortIndex: number;
  /**
   * Zone d'origine dans le deck figé. C'est elle qui dit où la carte retourne
   * lors d'un `RESTART_GAME{keepDecks:true}` ; `undefined` pour un jeton, qui
   * n'a pas d'existence entre deux parties.
   */
  origin?: ZoneKind;
  /**
   * Sièges qui connaissent l'identité de cet objet malgré sa zone ou sa face cachée.
   * C'est la seule source de vérité de la visibilité ; voir `canSeeIdentity`.
   *
   * **Cet ensemble ne rétrécit qu'en entrant en bibliothèque.** C'est la règle
   * de monotonie : on se souvient de ce qu'on a vu. Le raisonnement complet est
   * à l'endroit qui décide, `relocate()` dans `engine.ts`.
   */
  knownTo: Set<SeatId>;
  /** Copie d'un permanent : conservé pour l'affichage. */
  copyOf?: ObjectId;
}

export interface SeatState {
  id: SeatId;
  seatIndex: number;
  userId: string | null;
  displayName: string;
  connected: boolean;
  conceded: boolean;
  life: number;
  playerCounters: Map<string, number>;
  commanderDamage: Map<SeatId, Map<ObjectId, number>>;
  commanderTax: Map<ObjectId, number>;
  playmatUrl: string | null;
  cardBackUrl: string | null;
  color: string;
  deckName: string | null;
  deckSnapshotId: string | null;
  /** Sièges à qui ce siège révèle actuellement sa main. */
  handRevealedTo: Set<SeatId>;
  /**
   * Objets dont la révélation de main en cours a **effectivement accordé** la
   * connaissance — ceux que les destinataires ne connaissaient pas déjà.
   *
   * Même rôle que `topRevealedGranted`, et pour la même raison : `UNREVEAL_HAND`
   * ne doit reprendre que ce que `REVEAL_HAND` a donné. Purger toute la main
   * effacerait une carte montrée séparément par `REVEAL`, ou vue au cimetière
   * avant d'y remonter — une connaissance que la monotonie protège.
   */
  handRevealedGranted: Set<ObjectId>;
  /**
   * Sièges à qui ce siège révèle **en permanence** le dessus de sa
   * bibliothèque (*Experimental Frenzy*, *Realmbreaker*…). Vide par défaut.
   *
   * Le droit vit sur le siège, pas sur la carte : le dessus change à chaque
   * pioche, chaque meule, chaque mélange, et un droit accroché à un objet
   * serait faux l'instant d'après.
   */
  topRevealedTo: Set<SeatId>;
  /**
   * Objet actuellement publié comme « dessus révélé », ou `null`.
   *
   * C'est la mémoire de ce que les destinataires ont reçu : la réconciliation
   * la compare au dessus réel pour savoir ce qu'il faut leur faire oublier.
   */
  topRevealedId: ObjectId | null;
  /**
   * Sièges à qui la révélation a **effectivement accordé** la connaissance de
   * `topRevealedId` — ceux qui ne l'avaient pas déjà par ailleurs (un scry, par
   * exemple). Ce sont les seuls qu'on retire de `knownTo` en la révoquant :
   * purger tout `toSeats` effacerait une connaissance acquise autrement.
   */
  topRevealedGranted: Set<SeatId>;
  /** Destinataires du dernier `TOP_REVEALED` publié : ce à quoi on compare. */
  topRevealedPublishedTo: Set<SeatId>;
  /** Jeton de reprise de siège, remis au client et conservé côté serveur. */
  seatToken: string;
  /**
   * `seq` du `SEAT_JOINED` de ce siège. Un delta antérieur ne le concernerait
   * pas : aucune variante n'a été construite pour lui avant qu'il existe.
   */
  joinedAtSeq: Seq;
  /**
   * Horodatage de la perte du socket, `null` tant que le siège est connecté.
   * C'est de là que court le délai d'abandon d'une consultation (§6.4), pas du
   * début de la consultation.
   */
  disconnectedAt: number | null;
}

export interface PendingLook {
  id: string;
  seat: SeatId;
  zone: ZoneRef;
  mode: LookMode;
  /** Objets verrouillés le temps du regard : nul autre intent ne peut y toucher. */
  cardIds: ObjectId[];
  /**
   * Ordre dans lequel les cartes ont été montrées au demandeur. Pour un `SEARCH`
   * c'est un ordre brassé côté serveur : renvoyer `cardIds` exposerait au
   * propriétaire l'ordre réel de sa propre bibliothèque (docs/protocol.md §6.4).
   */
  shownIds: ObjectId[];
  startedAt: number;
}

export interface GameState {
  code: string;
  roomId: string;
  mode: GameMode;
  status: RoomStatus;
  /**
   * La table a été close par son hôte.
   *
   * Distinct de `status: 'ENDED'`, qui dit seulement « la partie est finie » —
   * on peut en relancer une. Close veut dire close : plus aucun intent n'est
   * accepté, et l'on ne s'y rassoit pas.
   */
  closed: boolean;
  hostSeat: SeatId | null;
  seq: Seq;
  turnNumber: number;
  activeSeat: SeatId | null;
  phase: PhaseName;
  seats: Map<SeatId, SeatState>;
  objects: Map<ObjectId, GameObjectState>;
  /** Ordre des objets par zone. Clé : `seat|kind`. */
  zones: Map<string, ObjectId[]>;
  labels: Map<ObjectId, Label>;
  pendingLooks: Map<string, PendingLook>;
  log: LogEntry[];
  createdAt: number;
  lastActivityAt: number;
}

export function zoneKey(zone: ZoneRef): string {
  return `${zone.seat}|${zone.kind}`;
}

export function getZone(state: GameState, zone: ZoneRef): ObjectId[] {
  const key = zoneKey(zone);
  let list = state.zones.get(key);
  if (!list) {
    list = [];
    state.zones.set(key, list);
  }
  return list;
}

export function removeFromZone(state: GameState, zone: ZoneRef, id: ObjectId): void {
  const list = getZone(state, zone);
  const idx = list.indexOf(id);
  if (idx >= 0) {
    list.splice(idx, 1);
    // Retirer sans réindexer laisserait des `sortIndex` à trous : la zone
    // d'origine garderait le rang de la carte partie.
    reindexZone(state, list);
  }
}

/** `sortIndex` = rang dans la zone. Contigu, sans trou, après toute mutation. */
export function reindexZone(state: GameState, list: ObjectId[]): void {
  list.forEach((objectId, i) => {
    const obj = state.objects.get(objectId);
    if (obj) obj.sortIndex = i;
  });
}

export function insertIntoZone(
  state: GameState,
  zone: ZoneRef,
  id: ObjectId,
  position: number | 'TOP' | 'BOTTOM' | 'RANDOM' | undefined,
  random: (max: number) => number,
): void {
  const list = getZone(state, zone);
  if (position === undefined || position === 'TOP') {
    list.unshift(id);
  } else if (position === 'BOTTOM') {
    list.push(id);
  } else if (position === 'RANDOM') {
    list.splice(random(list.length + 1), 0, id);
  } else {
    list.splice(Math.max(0, Math.min(position, list.length)), 0, id);
  }
  // Le rang dans la zone sert au rendu des zones listées (main, cimetière…).
  reindexZone(state, list);
}

const PUBLIC_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'BATTLEFIELD',
  'GRAVEYARD',
  'EXILE',
  'COMMAND',
  'STACK_NOTE',
]);

/**
 * Le siège `seat` a-t-il le droit de connaître l'identité de cet objet ?
 *
 * Unique règle de visibilité du serveur. Une carte en bibliothèque n'est
 * identifiable par personne, pas même son propriétaire : seule une session de
 * regard (LOOK) lui donne accès, en l'inscrivant dans `knownTo`.
 */
/**
 * Zone où une carte est posée au vu de tous : y être face cachée est un choix de
 * jeu, pas une conséquence de la zone.
 */
export function isPublicZone(kind: ZoneKind): boolean {
  return PUBLIC_ZONES.has(kind);
}

export function canSeeIdentity(obj: GameObjectState, seat: SeatId | null): boolean {
  if (seat === null) return false;
  if (obj.zone.kind === 'LIBRARY') return obj.knownTo.has(seat);
  if (PUBLIC_ZONES.has(obj.zone.kind) && !obj.faceDown) return true;
  return obj.knownTo.has(seat);
}

/** Les objets d'une bibliothèque ne sont jamais énumérés vers un client. */
export function isEnumerableZone(kind: ZoneKind): boolean {
  return kind !== 'LIBRARY';
}

export const SEAT_COLORS = [
  '#4f9cf9',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#ef4444',
  '#eab308',
  '#14b8a6',
  '#ec4899',
] as const;

export function startingLife(mode: GameMode): number {
  return mode === 'COMMANDER' || mode === 'DRAFT' ? 40 : 20;
}

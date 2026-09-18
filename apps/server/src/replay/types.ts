/**
 * Format d'enregistrement d'un replay.
 *
 * Ce format n'est **pas** un message de protocole : il ne traverse jamais le
 * socket de partie et ne figure pas dans `@mtg/shared`. C'est délibéré —
 * ajouter un champ ici n'oblige donc pas à monter `PROTOCOL_VERSION`, et ne
 * déconnecte aucune table en cours (docs/protocol.md §11).
 *
 * Il est servi tel quel par `GET /api/replays/:handle`, après projection pour
 * le point de vue demandé.
 */
import type { Audience, Counter, Event, LogEntry, ObjectId, SeatId, Snapshot } from '@mtg/shared';

/**
 * Un pas de replay : l'event **omniscient**, plus ce qu'il faut pour
 * re-dériver la vue de n'importe quel siège.
 *
 * Pourquoi l'omniscient et pas une variante par siège ? Parce que la
 * connaissance est portée par objet (`knownTo`) et que les règles de visibilité
 * sont une fonction pure de cet ensemble, de la zone et de la face (§5.2). Avec
 * `known` et `down` sous la main, la vue d'un siège se **calcule** ; la stocker
 * quatre fois coûterait quatre fois le volume pour la même information.
 */
export interface ReplayFrame {
  seq: number;
  at: number;
  actor: SeatId | null;
  /** Variante omnisciente : celle dont les variantes par siège sont dérivées. */
  event: Event;
  /**
   * Audience réelle de l'émission. Sans elle, le replay montrerait à seat_2 un
   * `LOOK_RESULT` qui n'a jamais été adressé qu'à seat_1 : la vue d'un siège
   * doit rendre ce que ce siège a reçu, y compris ses silences.
   */
  audience: Audience;
  log?: { text: string; cardIds: ObjectId[] };
  /**
   * `knownTo` complet des objets cités par l'event, **au moment de l'émission**.
   * C'est la seule chose qui permette de rejouer la monotonie de la
   * connaissance au pas par pas plutôt qu'à la fin.
   */
  known?: Record<ObjectId, SeatId[]>;
  /**
   * Objets cités qui étaient réellement face cachée. `PublicCardView.faceDown`
   * vaut toujours `false` — il dit « ce destinataire voit l'identité », pas
   * « la carte est posée face visible » —, donc l'information se perdrait.
   */
  down?: ObjectId[];
}

/** Un objet de jeu tel qu'un replay le conserve : l'état, pas une projection. */
export interface ReplayObject {
  id: ObjectId;
  kind: 'CARD' | 'TOKEN';
  owner: SeatId;
  controller: SeatId;
  zone: { seat: SeatId; kind: string };
  scryfallId: string;
  faceDown: boolean;
  flipped: boolean;
  tapped: boolean;
  x: number;
  y: number;
  rotation: number;
  counters: Counter[];
  attachedTo?: ObjectId;
  copyOf?: ObjectId;
  isFoil: boolean;
  sortIndex: number;
  knownTo: SeatId[];
}

/**
 * État omniscient au lancement de la partie : le point zéro du rejeu.
 *
 * On conserve l'**état**, pas une projection, précisément pour pouvoir rappeler
 * `projectSnapshot` — la vraie, celle du serveur — sur chaque point de vue
 * demandé. Deux implémentations de la visibilité finiraient par diverger, et le
 * jour où elles divergent le replay montre à un siège une carte qu'il n'a
 * jamais vue.
 */
export interface ReplayOrigin {
  seq: number;
  code: string;
  mode: string;
  turnNumber: number;
  activeSeat: SeatId | null;
  phase: string;
  hostSeat: SeatId | null;
  seats: unknown[];
  objects: ReplayObject[];
  /** Ordre par zone, clé `seat|kind` : il porte le rang réel des cartes. */
  zones: Record<string, ObjectId[]>;
  labels: unknown[];
  logTail: LogEntry[];
}

/** Point de vue demandé par le lecteur. */
export type ReplayView = 'ALL' | SeatId;

/** En-tête servi au lecteur : de quoi armer le rejeu sans charger le flux. */
export interface ReplayHead {
  replayId: string;
  roomCode: string;
  view: ReplayView;
  views: Array<{ id: SeatId; displayName: string }>;
  snapshot: Snapshot;
  startSeq: number;
  lastSeq: number;
  eventCount: number;
  truncated: boolean;
  startedAt: string;
  closedAt: string;
}

/** Une page de pas, projetée pour le point de vue demandé. */
export interface ReplayPage {
  from: number;
  frames: Array<{
    seq: number;
    at: number;
    actor: SeatId | null;
    event: Event;
    log?: { text: string; cardIds: ObjectId[] };
  }>;
  /** Vrai s'il reste des pas au-delà de cette page. */
  more: boolean;
}

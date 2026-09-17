/** Events serveur → client. Voir docs/protocol.md §7. */
import type {
  CardView,
  Counter,
  GameMode,
  Label,
  LogEntry,
  LookMode,
  LookSummary,
  ObjectId,
  OpaqueZoneView,
  PhaseName,
  PublicCardView,
  RoomStatus,
  SeatId,
  SeatSummary,
  Seq,
  ZoneRef,
} from './core.js';

export type Event =
  // cartes
  | { type: 'CARD_MOVED'; card: CardView; from: ZoneRef; to: ZoneRef; index?: number }
  | { type: 'CARDS_MOVED'; cards: CardView[]; from: ZoneRef; to: ZoneRef }
  | { type: 'CARD_UPDATED'; card: CardView }
  | { type: 'CARD_REVEALED'; card: PublicCardView; toSeats: SeatId[] }
  | { type: 'CARD_HIDDEN'; cardId: ObjectId }
  | { type: 'TOKENS_CREATED'; cards: PublicCardView[] }
  | { type: 'TOKENS_DESTROYED'; cardIds: ObjectId[] }
  | { type: 'ATTACHED'; sourceId: ObjectId; targetId: ObjectId }
  | { type: 'DETACHED'; sourceId: ObjectId }
  // zones
  | { type: 'ZONE_SHUFFLED'; zone: ZoneRef; count: number }
  | { type: 'ZONE_COUNT'; zone: ZoneRef; count: number }
  | { type: 'LOOK_STARTED'; lookId: string; seat: SeatId; zone: ZoneRef; count: number; mode: LookMode; cards?: PublicCardView[] }
  | { type: 'LOOK_RESULT'; lookId: string; mode: LookMode; cards: PublicCardView[] }
  | { type: 'LOOK_RESOLVED'; lookId: string; seat: SeatId; summary: LookSummary }
  | { type: 'HAND_REVEALED'; seat: SeatId; toSeats: SeatId[]; cards: PublicCardView[] }
  | { type: 'HAND_UNREVEALED'; seat: SeatId }
  /**
   * Le dessus de la bibliothèque de `seat` est révélé en permanence à `toSeats`.
   *
   * Émis à **tous** les sièges, mais `card` n'est renseignée que pour un
   * destinataire : les autres reçoivent `card: null`. Ils apprennent donc le
   * fait — public à une vraie table, où l'on voit bien qu'une carte est
   * retournée — et rien de l'identité ni de l'identifiant (§2.1).
   *
   * Pourquoi tout le monde plutôt qu'une audience restreinte : un siège hors
   * audience n'avancerait pas son `seq` et détecterait un trou au prochain
   * event, donc une resynchronisation. À raison d'un `TOP_REVEALED` par pioche,
   * la table entière se resynchroniserait à chaque carte piochée.
   *
   * `card: null` avec `toSeats` non vide veut dire « bibliothèque vide » ;
   * `toSeats: []` veut dire « la révélation s'arrête ». Les sièges qui perdent
   * le droit reçoivent en plus un `CARD_HIDDEN` sur l'objet concerné.
   */
  | { type: 'TOP_REVEALED'; seat: SeatId; toSeats: SeatId[]; card: PublicCardView | null }
  // joueurs
  | { type: 'LIFE_CHANGED'; seat: SeatId; value: number; delta: number }
  | { type: 'COMMANDER_DAMAGE_CHANGED'; from: SeatId; to: SeatId; commanderId: ObjectId; value: number }
  | { type: 'COMMANDER_TAX_CHANGED'; seat: SeatId; commanderId: ObjectId; casts: number }
  | { type: 'PLAYER_COUNTER_CHANGED'; seat: SeatId; kind: string; value: number }
  | { type: 'SEAT_JOINED'; seat: SeatSummary }
  | { type: 'SEAT_LEFT'; seatId: SeatId }
  | { type: 'SEAT_CONNECTION'; seatId: SeatId; connected: boolean }
  | { type: 'SEAT_CONCEDED'; seatId: SeatId }
  | { type: 'SEAT_COSMETICS'; seatId: SeatId; playmatUrl: string | null; cardBackUrl: string | null; displayName: string }
  | { type: 'DECK_LOADED'; seatId: SeatId; deckName: string; cardCount: number; commanders: PublicCardView[] }
  // table
  | { type: 'LABEL_ADDED'; label: Label }
  | { type: 'LABEL_MOVED'; labelId: ObjectId; x: number; y: number }
  | { type: 'LABEL_UPDATED'; label: Label }
  | { type: 'LABEL_REMOVED'; labelId: ObjectId }
  | { type: 'DICE_ROLLED'; seat: SeatId; sides: number; results: number[] }
  | { type: 'COIN_FLIPPED'; seat: SeatId; results: ('HEADS' | 'TAILS')[] }
  | { type: 'TURN_ENDED'; seat: SeatId; nextSeat: SeatId; turnNumber: number }
  | { type: 'PHASE_CHANGED'; phase: PhaseName }
  | { type: 'GAME_STARTED'; startingSeat: SeatId; snapshotIds: Record<SeatId, string> }
  | { type: 'GAME_ENDED'; reason: 'CONCEDE' | 'HOST' | 'TIMEOUT'; winners: SeatId[] }
  | { type: 'CHAT'; seat: SeatId; text: string }
  | { type: 'UNDONE'; undoneSeq: Seq }
  /**
   * Event sans charge utile. Il porte une ligne de journal, et rien d'autre.
   *
   * Deux usages : un fait qui n'existe que dans le journal (« seat_2 regarde une
   * carte face cachée »), et la variante servie aux sièges qui n'ont pas le
   * droit de voir l'event réel mais ont le droit d'en lire la trace publique.
   */
  | { type: 'NOTED' };

export type EventType = Event['type'];

export interface Snapshot {
  seq: Seq;
  room: { code: string; mode: GameMode; status: RoomStatus; closed: boolean; hostSeat: SeatId | null };
  seats: SeatSummary[];
  turn: { activeSeat: SeatId | null; turnNumber: number; phase: PhaseName };
  cards: CardView[];
  zoneCounts: OpaqueZoneView[];
  labels: Label[];
  pendingLook?: { lookId: string; mode: LookMode; cards: PublicCardView[] };
  /**
   * Révélations permanentes du dessus de bibliothèque en cours, un élément par
   * siège qui en a une. `cardId` n'est renseigné que si le destinataire du
   * snapshot figure dans `toSeats` ; la vue de la carte, elle, est déjà dans
   * `cards`, projetée comme tout le reste.
   */
  topReveals?: Array<{ seat: SeatId; toSeats: SeatId[]; cardId: ObjectId | null }>;
  logTail: LogEntry[];
}

/** Audience calculée par le serveur. Il n'existe pas de spectateurs (§13.4). */
export type Audience =
  | { kind: 'ALL' }
  | { kind: 'SEATS'; seats: SeatId[] }
  | { kind: 'SEAT'; seat: SeatId };

export interface CursorState {
  seat: SeatId;
  x: number;
  y: number;
  holding?: ObjectId;
}

export type { Counter };

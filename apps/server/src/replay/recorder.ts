/**
 * Enregistrement du flux d'une partie, côté room.
 *
 * Deux exigences commandent tout ce fichier.
 *
 * **1. L'enregistrement ne doit jamais ralentir ni faire échouer une partie.**
 * Rien ici ne touche la base : les pas s'accumulent en mémoire et partent vers
 * un puits (`ReplaySink`) qui, lui, écrit en différé et avale ses échecs. Une
 * base indisponible fait perdre un replay, jamais une partie — c'est exactement
 * le parti déjà pris par `persistLog`.
 *
 * **2. Une partie longue produit des milliers d'events.** L'enregistrement est
 * donc borné, en nombre de pas comme en octets. Atteindre la borne **arrête**
 * l'enregistrement et le marque `truncated` : le lecteur annonce alors que la
 * partie continue au-delà de ce qu'il montre. Tronquer en silence produirait un
 * replay menteur, ce qui est pire que pas de replay du tout.
 */
import type { Event, LogEntry, ObjectId, PublicCardView, SeatId } from '@mtg/shared';
import type { Emission } from '../game/engine.js';
import { OMNISCIENT_SEAT, type GameState } from '../game/state.js';
import { dumpState } from './dump.js';
import type { ReplayFrame, ReplayOrigin } from './types.js';

export const REPLAY_LIMITS = {
  /**
   * Plafond de pas. Une partie de Commander à quatre observée sur cette table
   * tourne autour de 2 000 à 4 000 `seq` ; 20 000 laisse donc largement la
   * place d'une très longue partie, et borne le pire cas (une boucle d'intents
   * ou une table laissée ouverte des heures).
   */
  maxEvents: 20_000,
  /** Second plafond, qui mord le premier quand les events sont gros. */
  maxBytes: 8 * 1024 * 1024,
  /** Pas par ligne de `ReplayChunk` : ni une ligne par event, ni un seul bloc. */
  chunkFrames: 500,
} as const;

/** Écriture différée. Toutes les méthodes sont « tire et oublie ». */
export interface ReplaySink {
  open: (roomId: string, startSeq: number, origin: ReplayOrigin) => void;
  append: (roomId: string, startSeq: number, frames: ReplayFrame[]) => void;
  close: (
    roomId: string,
    startSeq: number,
    stats: { lastSeq: number; eventCount: number; bytes: number; truncated: boolean; reason: string },
  ) => void;
}

/** Les vues de cartes citées par un event, quel qu'il soit. */
function citedCards(event: Event): PublicCardView[] {
  const out: PublicCardView[] = [];
  const push = (v: unknown): void => {
    if (v && typeof v === 'object' && 'id' in v && 'scryfallId' in v) out.push(v as PublicCardView);
  };
  switch (event.type) {
    case 'CARD_MOVED':
    case 'CARD_UPDATED':
    case 'CARD_REVEALED':
      push(event.card);
      return out;
    case 'CARDS_MOVED':
    case 'TOKENS_CREATED':
    case 'LOOK_RESULT':
    case 'HAND_REVEALED':
      event.cards.forEach(push);
      return out;
    case 'LOOK_STARTED':
      (event.cards ?? []).forEach(push);
      return out;
    case 'DECK_LOADED':
      event.commanders.forEach(push);
      return out;
    case 'TOP_REVEALED':
      push(event.card);
      return out;
    default:
      return out;
  }
}

/**
 * Construit le pas omniscient d'une émission.
 *
 * `emission.build` est appelé avec le siège fictif qui voit tout : on obtient
 * l'event **complet**, celui dont les variantes par siège sont dérivées, plutôt
 * qu'un recollage de vues partielles qui aurait déjà perdu ce qu'il fallait
 * garder.
 *
 * Le side-car `known`/`down` est pris sur l'état vivant, après mutation : c'est
 * l'instant que l'event décrit. C'est lui qui permettra de re-dériver la vue de
 * n'importe quel siège **à ce pas-là**, et pas seulement à la fin de la partie.
 */
export function frameOf(
  state: GameState,
  emission: Emission,
  seq: number,
  at: number,
  actor: SeatId | null,
  log: ReplayFrame['log'],
): ReplayFrame {
  const event = emission.build(OMNISCIENT_SEAT);
  const frame: ReplayFrame = { seq, at, actor, event, audience: emission.audience };
  if (log) frame.log = log;

  const known: Record<ObjectId, SeatId[]> = {};
  const down: ObjectId[] = [];
  let any = false;
  for (const view of citedCards(event)) {
    const obj = state.objects.get(view.id);
    if (obj) {
      known[view.id] = [...obj.knownTo];
      if (obj.faceDown) down.push(view.id);
      any = true;
    } else if (view.revealedTo) {
      // L'objet n'existe plus (un mélange l'a réattribué dans le même intent) :
      // la vue figée porte tout ce qui en reste.
      known[view.id] = [view.owner, ...view.revealedTo];
      any = true;
    }
  }
  if (any) frame.known = known;
  if (down.length > 0) frame.down = down;
  return frame;
}

/**
 * Enregistrement d'**une** partie. Ouvert au lancement, refermé à sa fin.
 *
 * L'identité de l'enregistrement est `(roomId, startSeq)` : une table qui
 * relance produit un second enregistrement, sans écraser le premier. Un partage
 * pointe donc toujours sur une partie précise.
 */
export class ReplayRecorder {
  private pending: ReplayFrame[] = [];
  private count = 0;
  private bytes = 0;
  private truncated = false;
  private lastSeq: number;
  private closed = false;

  constructor(
    private readonly roomId: string,
    readonly startSeq: number,
    private readonly sink: ReplaySink,
    state: GameState,
  ) {
    this.lastSeq = startSeq;
    this.sink.open(roomId, startSeq, dumpState(state));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Statistiques mesurées, pour les tests et pour le rapport de coût. */
  get stats(): { eventCount: number; bytes: number; truncated: boolean; lastSeq: number } {
    return {
      eventCount: this.count,
      bytes: this.bytes,
      truncated: this.truncated,
      lastSeq: this.lastSeq,
    };
  }

  record(frame: ReplayFrame): void {
    if (this.closed || this.truncated) return;
    // La taille se mesure sur la sérialisation réelle : c'est elle qui ira en
    // base, et un `Event` peut porter une zone entière de cartes.
    const size = JSON.stringify(frame).length;
    if (this.count + 1 > REPLAY_LIMITS.maxEvents || this.bytes + size > REPLAY_LIMITS.maxBytes) {
      this.truncated = true;
      this.flush();
      return;
    }
    this.count += 1;
    this.bytes += size;
    this.lastSeq = frame.seq;
    this.pending.push(frame);
    if (this.pending.length >= REPLAY_LIMITS.chunkFrames) this.flush();
  }

  flush(): void {
    if (this.pending.length === 0) return;
    const frames = this.pending;
    this.pending = [];
    this.sink.append(this.roomId, this.startSeq, frames);
  }

  /**
   * Referme l'enregistrement. **C'est cet appel qui rend le replay lisible** :
   * tant qu'il n'a pas eu lieu, aucune route ne sert quoi que ce soit.
   */
  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.flush();
    this.sink.close(this.roomId, this.startSeq, {
      lastSeq: this.lastSeq,
      eventCount: this.count,
      bytes: this.bytes,
      truncated: this.truncated,
      reason,
    });
  }
}

/** Une ligne de journal se recopie telle quelle : elle est publique (§5.4). */
export function logOf(entry: LogEntry | undefined): ReplayFrame['log'] {
  return entry ? { text: entry.text, cardIds: entry.cardIds } : undefined;
}

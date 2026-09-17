/**
 * Modèle de client minimal : il part d'un snapshot et applique des events,
 * exactement comme le ferait le navigateur.
 *
 * Il sert à une seule chose, mais la plus importante de la §8.1 : vérifier que
 * `snapshot(T) + delta(T→T')` donne le même état que `snapshot(T')`. Si un
 * intent oublie d'émettre un event, les deux chemins divergent et le test le dit.
 */
import type { CardView, Label, ObjectId, SeatId, ServerEvent, Snapshot } from '@mtg/shared';

export interface ClientModel {
  seq: number;
  cards: Map<ObjectId, CardView>;
  zoneCounts: Map<string, number>;
  life: Map<SeatId, number>;
  labels: Map<ObjectId, Label>;
  /** Dessus de bibliotheque reveles en permanence, par siege proprietaire. */
  topReveals: Map<SeatId, { toSeats: SeatId[]; cardId: ObjectId | null }>;
}

function zoneKeyOf(zone: { seat: string; kind: string }): string {
  return `${zone.seat}|${zone.kind}`;
}

/** La bibliothèque n'est pas énumérable : un client n'en garde jamais le contenu. */
function place(model: ClientModel, card: CardView): void {
  if (card.zone.kind === 'LIBRARY') model.cards.delete(card.id);
  else model.cards.set(card.id, card);
}

export function fromSnapshot(snapshot: Snapshot): ClientModel {
  const model: ClientModel = {
    seq: snapshot.seq,
    cards: new Map(),
    zoneCounts: new Map(),
    life: new Map(),
    labels: new Map(),
    topReveals: new Map(),
  };
  for (const card of snapshot.cards) place(model, card);
  for (const z of snapshot.zoneCounts) model.zoneCounts.set(zoneKeyOf(z.zone), z.count);
  for (const seat of snapshot.seats) model.life.set(seat.id, seat.life);
  for (const label of snapshot.labels) model.labels.set(label.id, label);
  for (const top of snapshot.topReveals ?? []) {
    model.topReveals.set(top.seat, { toSeats: top.toSeats, cardId: top.cardId });
  }
  return model;
}

export function applyEvent(model: ClientModel, frame: ServerEvent): void {
  model.seq = frame.seq;
  const event = frame.event;

  switch (event.type) {
    case 'CARD_MOVED':
      place(model, event.card);
      break;
    case 'CARDS_MOVED':
      for (const card of event.cards) place(model, card);
      break;
    case 'CARD_UPDATED':
    case 'CARD_REVEALED':
      place(model, event.card);
      break;
    case 'CARD_HIDDEN':
      model.cards.delete(event.cardId);
      break;
    case 'TOP_REVEALED':
      // `place` jette les cartes de bibliotheque : c'est bien ce que fait ce
      // modele minimal, et le snapshot subit exactement le meme sort. Ce qui
      // doit converger, c'est l'etat de la revelation elle-meme.
      if (event.card) place(model, event.card);
      if (event.toSeats.length === 0) model.topReveals.delete(event.seat);
      else model.topReveals.set(event.seat, { toSeats: event.toSeats, cardId: event.card?.id ?? null });
      break;
    case 'TOKENS_CREATED':
      for (const card of event.cards) place(model, card);
      break;
    case 'TOKENS_DESTROYED':
      for (const id of event.cardIds) model.cards.delete(id);
      break;
    case 'HAND_REVEALED':
      for (const card of event.cards) place(model, card);
      break;
    case 'ATTACHED': {
      const card = model.cards.get(event.sourceId);
      if (card) model.cards.set(card.id, { ...card, attachedTo: event.targetId });
      break;
    }
    case 'DETACHED': {
      const card = model.cards.get(event.sourceId);
      if (card) {
        const next = { ...card };
        delete next.attachedTo;
        model.cards.set(card.id, next);
      }
      break;
    }
    case 'HAND_UNREVEALED': {
      // Le droit de regard cesse : le client retombe sur la vue cachée.
      for (const [id, card] of model.cards) {
        if (card.zone.seat !== event.seat || card.zone.kind !== 'HAND') continue;
        const hidden: CardView = {
          id: card.id,
          kind: card.kind,
          owner: card.owner,
          controller: card.controller,
          zone: card.zone,
          faceDown: true,
          tapped: card.tapped,
          x: card.x,
          y: card.y,
          rotation: card.rotation,
          counters: card.counters,
          sortIndex: card.sortIndex,
          ...(card.attachedTo ? { attachedTo: card.attachedTo } : {}),
        };
        model.cards.set(id, hidden);
      }
      break;
    }
    case 'SEAT_LEFT':
      // Le siège disparaît de l'écran : ses cartes et son panneau avec lui.
      for (const [id, card] of model.cards) {
        if (card.zone.seat === event.seatId) model.cards.delete(id);
      }
      model.life.delete(event.seatId);
      break;
    case 'ZONE_SHUFFLED': {
      const key = zoneKeyOf(event.zone);
      // Les identifiants de la zone viennent d'être réattribués : tout ce que
      // le client en gardait est périmé.
      for (const [id, card] of model.cards) if (zoneKeyOf(card.zone) === key) model.cards.delete(id);
      model.zoneCounts.set(key, event.count);
      break;
    }
    case 'ZONE_COUNT':
      model.zoneCounts.set(zoneKeyOf(event.zone), event.count);
      break;
    case 'LIFE_CHANGED':
      model.life.set(event.seat, event.value);
      break;
    case 'LABEL_ADDED':
      model.labels.set(event.label.id, event.label);
      break;
    case 'LABEL_MOVED': {
      const label = model.labels.get(event.labelId);
      if (label) model.labels.set(label.id, { ...label, x: event.x, y: event.y });
      break;
    }
    case 'LABEL_REMOVED':
      model.labels.delete(event.labelId);
      break;
    default:
      // Les autres events ne portent pas d'état de carte : le client les
      // affiche (journal, dés, tour) sans rien recalculer.
      break;
  }
}

/** Forme comparable, indépendante de l'ordre d'insertion des Map. */
export function normalize(model: ClientModel): unknown {
  return {
    cards: [...model.cards.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => JSON.parse(JSON.stringify(c)) as unknown),
    zoneCounts: [...model.zoneCounts.entries()]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    life: [...model.life.entries()].sort(([a], [b]) => a.localeCompare(b)),
    labels: [...model.labels.values()].sort((a, b) => a.id.localeCompare(b.id)),
    topReveals: [...model.topReveals.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

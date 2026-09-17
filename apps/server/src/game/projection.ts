/**
 * Projection de l'état vers un siège donné.
 *
 * C'est le seul endroit du serveur où l'on décide ce qu'un joueur a le droit de
 * voir — snapshots et events passent tous les deux par ici, exactement comme
 * l'exige docs/protocol.md §8.1. Toute exception ajoutée ailleurs serait une fuite.
 */
import type {
  CardView,
  HiddenCardView,
  OpaqueZoneView,
  PublicCardView,
  SeatId,
  ObjectId,
  SeatSummary,
  Snapshot,
  ZoneRef,
} from '@mtg/shared';
import { canSeeIdentity, isEnumerableZone, isPublicZone, type GameObjectState, type GameState, type SeatState } from './state.js';

/** Vue publique : identité comprise. N'appeler qu'après `canSeeIdentity`. */
export function toPublicView(obj: GameObjectState): PublicCardView {
  const view: PublicCardView = {
    id: obj.id,
    kind: obj.kind,
    owner: obj.owner,
    controller: obj.controller,
    zone: obj.zone,
    faceDown: false,
    scryfallId: obj.card.scryfallId,
    flipped: obj.flipped,
    tapped: obj.tapped,
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    counters: obj.counters.map((c) => ({ ...c })),
    isFoil: obj.isFoil,
    sortIndex: obj.sortIndex,
  };
  if (obj.attachedTo) view.attachedTo = obj.attachedTo;
  if (obj.copyOf) view.copyOf = obj.copyOf;

  /*
   * Qui d'autre connaît cette carte ?
   *
   * `knownTo` moins ceux qui la verraient de toute façon. En zone cachée, seul
   * le propriétaire la verrait ; en zone publique, une carte face visible est
   * connue de tous et il n'y a rien à signaler. Ce qui reste est exactement ce
   * qu'on appelle « révélé ».
   */
  const shownTo = [...obj.knownTo].filter((s) => s !== obj.owner);
  const hiddenByNature = !isPublicZone(obj.zone.kind) || obj.faceDown;
  if (hiddenByNature && shownTo.length > 0) view.revealedTo = shownTo;
  // Le destinataire voit l'identité, mais la carte peut être posée face cachée :
  // c'est le cas du propriétaire d'un morph. Sans ce drapeau, il ne saurait pas
  // que les autres ne la voient pas.
  //
  // Uniquement dans une zone publique : en main ou en bibliothèque, être face
  // cachée découle de la zone et n'apprend rien à son propriétaire.
  if (obj.faceDown && isPublicZone(obj.zone.kind)) view.facedownOnTable = true;
  return view;
}

/**
 * Vue cachée : aucun champ dérivé de l'identité de la carte, `isFoil` compris,
 * qui permettrait de corréler une carte d'une zone à l'autre.
 */
export function toHiddenView(obj: GameObjectState): HiddenCardView {
  const view: HiddenCardView = {
    id: obj.id,
    kind: obj.kind,
    owner: obj.owner,
    controller: obj.controller,
    zone: obj.zone,
    faceDown: true,
    tapped: obj.tapped,
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    counters: obj.counters.map((c) => ({ ...c })),
    sortIndex: obj.sortIndex,
  };
  if (obj.attachedTo) view.attachedTo = obj.attachedTo;
  return view;
}

/**
 * Vue destinée à un `LOOK_RESULT`. Le `sortIndex` y est le rang *montré*, pas le
 * rang réel dans la zone : sur un `SEARCH`, publier le rang réel reviendrait à
 * donner l'ordre de la bibliothèque au propriétaire malgré le brassage.
 */
export function toLookView(obj: GameObjectState, rank: number): PublicCardView {
  return { ...toPublicView(obj), sortIndex: rank };
}

export function projectCard(obj: GameObjectState, seat: SeatId | null): CardView {
  return canSeeIdentity(obj, seat) ? toPublicView(obj) : toHiddenView(obj);
}

export function projectSeat(seat: SeatState, state: GameState): SeatSummary {
  const handCount = state.zones.get(`${seat.id}|HAND`)?.length ?? 0;

  const commanderDamage: SeatSummary['commanderDamage'] = {};
  for (const [from, byCommander] of seat.commanderDamage) {
    commanderDamage[from] = Object.fromEntries(byCommander);
  }

  return {
    id: seat.id,
    seatIndex: seat.seatIndex,
    displayName: seat.displayName,
    userId: seat.userId,
    connected: seat.connected,
    conceded: seat.conceded,
    life: seat.life,
    handCount,
    playerCounters: [...seat.playerCounters].map(([kind, value]) => ({ kind, value })),
    commanderDamage,
    commanderTax: Object.fromEntries(seat.commanderTax),
    playmatUrl: seat.playmatUrl,
    cardBackUrl: seat.cardBackUrl,
    color: seat.color,
    deckName: seat.deckName,
  };
}

/**
 * Snapshot complet pour un siège. Les bibliothèques n'apparaissent que sous
 * forme de comptes ; tout le reste est projeté objet par objet.
 */
export function projectSnapshot(state: GameState, seat: SeatId | null): Snapshot {
  const cards: CardView[] = [];
  const zoneCounts: OpaqueZoneView[] = [];
  // Une carte publiee deux fois ferait double dans le store du client : le
  // dessus revele appartient deja aux `cards` quand le LOBBY publie la
  // bibliotheque de son proprietaire.
  const included = new Set<ObjectId>();

  // Pas de spectateurs (docs/protocol.md §13.4) : une connexion sans siège ne
  // reçoit que la liste des sièges et le statut de la room. Aucune carte,
  // aucune étiquette, aucun journal — rien de l'état de partie.
  if (seat === null) {
    return {
      seq: state.seq,
      room: { code: state.code, mode: state.mode, status: state.status, closed: state.closed, hostSeat: state.hostSeat },
      seats: [...state.seats.values()]
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((s) => projectSeat(s, state)),
      turn: { activeSeat: state.activeSeat, turnNumber: state.turnNumber, phase: state.phase },
      cards: [],
      zoneCounts: [],
      labels: [],
      logTail: [],
    };
  }

  for (const [key, ids] of state.zones) {
    const [zoneSeat = '', kind = ''] = key.split('|');
    const zone = { seat: zoneSeat, kind } as ZoneRef;
    zoneCounts.push({ zone, count: ids.length });

    /*
     * **Avant le lancement, un joueur voit sa propre bibliothèque.**
     *
     * C'est une exception assumée à la §2.1, et elle ne coûte rien : rien n'a
     * encore été mélangé ni pioché, la liste est celle qu'il vient lui-même de
     * charger, et `START_GAME` mélange — ce qui **réattribue tous les
     * identifiants**. Aucun de ceux appris ici ne survit donc au début de la
     * partie, et le canal de corrélation que la §2.1 ferme reste fermé.
     *
     * Sans cette exception, composer son deck depuis la table était impossible :
     * le client ne pouvait pas nommer une carte à sortir, faute de connaître le
     * moindre identifiant de sa bibliothèque.
     *
     * Elle ne vaut **que** pour le propriétaire, et **que** hors partie.
     */
    const ownDeckBeforeStart =
      zone.kind === 'LIBRARY' && zone.seat === seat && state.status === 'LOBBY';
    if (!isEnumerableZone(zone.kind) && !ownDeckBeforeStart) continue;
    for (const id of ids) {
      const obj = state.objects.get(id);
      if (obj) {
        cards.push(projectCard(obj, seat));
        included.add(id);
      }
    }
  }

  /*
   * Le dessus révélé en permanence, pour qui y a droit.
   *
   * Sans lui, un rechargement de page — ou toute resynchronisation qui bascule
   * sur le snapshot — ferait disparaître la carte que la table voit pourtant
   * retournée : `snapshot(T)` doit être indistinguable de `snapshot(T₀) +
   * delta` (§8.1). C'est la seule carte de bibliothèque publiée hors du LOBBY,
   * et elle l'est parce qu'elle est **révélée** ; le raisonnement complet est
   * dans `topReveal.ts`.
   */
  const topReveals: NonNullable<Snapshot['topReveals']> = [];
  for (const s of state.seats.values()) {
    if (s.topRevealedTo.size === 0) continue;
    const toSeats = [...s.topRevealedTo];
    const mine = s.topRevealedTo.has(seat);
    const obj = s.topRevealedId === null ? undefined : state.objects.get(s.topRevealedId);
    if (mine && obj && !included.has(obj.id)) cards.push(toPublicView(obj));
    topReveals.push({ seat: s.id, toSeats, cardId: mine && obj ? obj.id : null });
  }

  const pending = [...state.pendingLooks.values()].find((l) => l.seat === seat);

  const snapshot: Snapshot = {
    seq: state.seq,
    room: { code: state.code, mode: state.mode, status: state.status, closed: state.closed, hostSeat: state.hostSeat },
    seats: [...state.seats.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((s) => projectSeat(s, state)),
    turn: { activeSeat: state.activeSeat, turnNumber: state.turnNumber, phase: state.phase },
    cards,
    zoneCounts,
    labels: [...state.labels.values()],
    logTail: state.log.slice(-200),
  };

  if (topReveals.length > 0) snapshot.topReveals = topReveals;

  if (pending) {
    snapshot.pendingLook = {
      lookId: pending.id,
      mode: pending.mode,
      // `shownIds`, pas `cardIds` : pour un SEARCH, l'ordre réel reste secret.
      cards: pending.shownIds
        .map((id) => state.objects.get(id))
        .filter((o): o is GameObjectState => o !== undefined)
        .map((o, rank) => toLookView(o, rank)),
    };
  }

  return snapshot;
}

/**
 * Re-dérivation d'un point de vue à partir du flux omniscient.
 *
 * **Ce fichier ne contient aucune règle de visibilité.** C'est son intérêt
 * principal : il reconstruit un `GameObjectState` à partir de ce que le flux a
 * conservé — zone, face, `knownTo` — puis appelle `projectCard`, la fonction du
 * serveur, celle qui décide déjà ce qu'un siège reçoit en direct. Une seconde
 * implémentation divergerait un jour, et ce jour-là le replay montrerait à un
 * siège une carte qu'il n'a jamais vue, ou lui cacherait une carte qu'il avait
 * bien sous les yeux. On ne le saurait pas : il n'y a pas de partie de
 * référence à comparer, sinon dans un test.
 *
 * Les deux seules décisions prises ici ne sont pas des règles de visibilité,
 * ce sont des **reproductions du découpage de `Room.commit`** :
 *   1. un siège hors de l'audience enregistrée reçoit un `NOTED` — exactement
 *      le remplissage qui rend la séquence dense (docs/protocol.md §5) ;
 *   2. une carte qui entre en zone non énumérable n'existe plus pour les autres
 *      sièges, qui reçoivent `CARD_HIDDEN` — c'est la branche de
 *      `moveEmission`, et elle s'exprime ici avec le même prédicat
 *      (`isEnumerableZone`), pas avec une copie du raisonnement (§2.1).
 */
import type {
  CardView,
  Event,
  PublicCardView,
  SeatId,
  Snapshot,
  ZoneKind,
  ZoneRef,
} from '@mtg/shared';
import { projectCard, projectSnapshot, toPublicView } from '../game/projection.js';
import {
  OMNISCIENT_SEAT,
  isEnumerableZone,
  type GameObjectState,
  type GameState,
} from '../game/state.js';
import { reviveState } from './dump.js';
import type { ReplayFrame, ReplayOrigin, ReplayView } from './types.js';

/** Le siège est-il destinataire de cette émission ? */
function inAudience(frame: ReplayFrame, seat: SeatId): boolean {
  const a = frame.audience;
  if (a.kind === 'ALL') return true;
  if (a.kind === 'SEAT') return a.seat === seat;
  return a.seats.includes(seat);
}

/**
 * Reconstitue l'objet dont la vue enregistrée est la projection omnisciente.
 *
 * On ne rebâtit que ce dont `canSeeIdentity` et les deux fabriques de vues ont
 * besoin. Le reste est recopié tel quel : la vue omnisciente porte déjà l'état
 * visible (engagé, retourné, marqueurs, position), qui n'est confidentiel pour
 * personne.
 */
function reviveFromView(view: PublicCardView, frame: ReplayFrame): GameObjectState {
  const known = frame.known?.[view.id] ?? [view.owner, ...(view.revealedTo ?? [])];
  const faceDown = frame.down?.includes(view.id) ?? view.facedownOnTable === true;
  const obj: GameObjectState = {
    id: view.id,
    kind: view.kind,
    owner: view.owner,
    controller: view.controller,
    zone: view.zone,
    card: {
      scryfallId: view.scryfallId,
      name: '',
      setCode: '',
      collectorNumber: '',
      typeLine: '',
      manaCost: null,
      colorIdentity: [],
      layout: '',
      imageUris: null,
      faces: null,
    },
    faceDown,
    flipped: view.flipped,
    tapped: view.tapped,
    x: view.x,
    y: view.y,
    rotation: view.rotation,
    counters: view.counters.map((c) => ({ ...c })),
    isFoil: view.isFoil,
    sortIndex: view.sortIndex,
    knownTo: new Set(known),
  };
  if (view.attachedTo) obj.attachedTo = view.attachedTo;
  if (view.copyOf) obj.copyOf = view.copyOf;
  return obj;
}

function project(view: CardView, frame: ReplayFrame, seat: SeatId): CardView {
  // Une vue cachée dans le flux omniscient ne devrait pas exister ; si elle
  // existe, elle est déjà pauvre et la reprojeter ne peut rien y ajouter.
  if (view.faceDown === true) return view;
  return projectCard(reviveFromView(view, frame), seat);
}

/** La zone d'arrivée est-elle opaque pour ce siège-là ? (branche `moveEmission`) */
function hiddenFor(to: ZoneRef, seat: SeatId): boolean {
  return !isEnumerableZone(to.kind as ZoneKind) && to.seat !== seat;
}

/**
 * L'event tel que ce siège l'a reçu, ou `null` si l'émission ne le concernait
 * pas — l'appelant lui sert alors un `NOTED`, comme le serveur en direct.
 */
function projectEvent(frame: ReplayFrame, seat: SeatId): Event {
  const event = frame.event;
  switch (event.type) {
    case 'CARD_MOVED':
      if (hiddenFor(event.to, seat)) return { type: 'CARD_HIDDEN', cardId: event.card.id };
      return { ...event, card: project(event.card, frame, seat) };

    case 'CARDS_MOVED':
      return {
        ...event,
        cards: hiddenFor(event.to, seat) ? [] : event.cards.map((c) => project(c, frame, seat)),
      };

    case 'CARD_UPDATED':
      return { ...event, card: project(event.card, frame, seat) };

    case 'CARD_REVEALED':
      return { ...event, card: project(event.card, frame, seat) as PublicCardView };

    case 'TOKENS_CREATED':
      return { ...event, cards: event.cards.map((c) => project(c, frame, seat) as PublicCardView) };

    case 'LOOK_STARTED':
      return event.cards
        ? { ...event, cards: event.cards.map((c) => project(c, frame, seat) as PublicCardView) }
        : event;

    case 'LOOK_RESULT':
      return { ...event, cards: event.cards.map((c) => project(c, frame, seat) as PublicCardView) };

    case 'HAND_REVEALED':
      return { ...event, cards: event.cards.map((c) => project(c, frame, seat) as PublicCardView) };

    case 'TOP_REVEALED':
      // `TOP_REVEALED` est d'audience ALL en deux variantes (§7) : le fait pour
      // tous, la carte pour les seuls destinataires. Le partage se lit dans
      // l'event lui-même, il n'est pas redécidé ici.
      return { ...event, card: event.toSeats.includes(seat) ? event.card : null };

    case 'DECK_LOADED':
      return {
        ...event,
        commanders: event.commanders.map((c) => project(c, frame, seat) as PublicCardView),
      };

    default:
      return event;
  }
}

/** Un pas de replay, servi au point de vue demandé. */
export function projectFrame(
  frame: ReplayFrame,
  view: ReplayView,
): { seq: number; at: number; actor: SeatId | null; event: Event; log?: ReplayFrame['log'] } {
  const base = { seq: frame.seq, at: frame.at, actor: frame.actor };
  // Vue omnisciente : le flux est déjà celui-là, il n'y a rien à retirer.
  // Les ancres et le texte du journal sont publics par construction (§5.4), on
  // les laisse passer dans tous les cas.
  const event: Event =
    view === 'ALL'
      ? frame.event
      : inAudience(frame, view)
        ? projectEvent(frame, view)
        : { type: 'NOTED' };
  return frame.log ? { ...base, event, log: frame.log } : { ...base, event };
}

/**
 * Le point zéro, projeté.
 *
 * Pour un siège, c'est littéralement `projectSnapshot` — la fonction du
 * serveur, sur un état ressuscité. Pour la vue omnisciente, c'est le même
 * appel avec le siège fictif, complété des bibliothèques : `projectSnapshot`
 * n'énumère jamais une bibliothèque, et un replay où tout est révélé doit
 * pourtant les montrer.
 */
export function projectOrigin(origin: ReplayOrigin, view: ReplayView): Snapshot {
  const state = reviveState(origin);
  if (view !== 'ALL') return projectSnapshot(state, view);

  const snapshot = projectSnapshot(state, OMNISCIENT_SEAT);
  const already = new Set(snapshot.cards.map((c) => c.id));
  for (const obj of librariesOf(state)) {
    if (already.has(obj.id)) continue;
    snapshot.cards.push(toPublicView(obj));
  }
  return snapshot;
}

/** Les objets que `projectSnapshot` laisse volontairement de côté. */
function librariesOf(state: GameState): GameObjectState[] {
  const out: GameObjectState[] = [];
  for (const [key, ids] of state.zones) {
    const kind = key.split('|')[1] ?? '';
    if (isEnumerableZone(kind as ZoneKind)) continue;
    for (const id of ids) {
      const obj = state.objects.get(id);
      if (obj) out.push(obj);
    }
  }
  return out;
}

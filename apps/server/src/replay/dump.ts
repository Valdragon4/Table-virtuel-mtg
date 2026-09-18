/**
 * Sérialisation de l'état de partie pour un replay, et son inverse.
 *
 * **Pourquoi conserver l'état et non des vues.** Un replay doit pouvoir rendre
 * la table telle que n'importe quel siège la voyait. Les règles qui décident
 * cela vivent déjà dans `projection.ts`, et elles ne s'appliquent qu'à un
 * `GameState`. Conserver l'état permet donc de rappeler la vraie fonction
 * plutôt que d'en écrire une seconde : c'est le même argument que pour
 * `applyEvent` côté client — une seule implémentation, appelée à deux moments.
 *
 * Rien de ce qui est écrit ici n'appartient à Wizards of the Coast : on stocke
 * un `scryfallId`, jamais un nom de carte, jamais un texte de règles, jamais
 * une image. Le lecteur ira chercher l'impression lui-même, comme la table.
 */
import type { Label, ObjectId, Rotation, SeatId, ZoneKind, ZoneRef } from '@mtg/shared';
import type { CardData, GameObjectState, GameState, SeatState } from '../game/state.js';
import type { ReplayObject, ReplayOrigin } from './types.js';

/**
 * Données de carte minimales pour une projection.
 *
 * `toPublicView` ne lit que `scryfallId` : tout le reste — nom, type, coût —
 * ne sert qu'au moteur, qui ne tourne pas pendant un rejeu. Les stocker
 * gonflerait l'enregistrement d'un facteur dix pour rien, et y mettre un texte
 * de règles serait de surcroît interdit.
 */
function stubCard(scryfallId: string): CardData {
  return {
    scryfallId,
    name: '',
    setCode: '',
    collectorNumber: '',
    typeLine: '',
    manaCost: null,
    colorIdentity: [],
    layout: '',
    imageUris: null,
    faces: null,
  };
}

export function dumpObject(obj: GameObjectState): ReplayObject {
  const out: ReplayObject = {
    id: obj.id,
    kind: obj.kind,
    owner: obj.owner,
    controller: obj.controller,
    zone: { seat: obj.zone.seat, kind: obj.zone.kind },
    scryfallId: obj.card.scryfallId,
    faceDown: obj.faceDown,
    flipped: obj.flipped,
    tapped: obj.tapped,
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    counters: obj.counters.map((c) => ({ ...c })),
    isFoil: obj.isFoil,
    sortIndex: obj.sortIndex,
    knownTo: [...obj.knownTo],
  };
  if (obj.attachedTo) out.attachedTo = obj.attachedTo;
  if (obj.copyOf) out.copyOf = obj.copyOf;
  return out;
}

export function reviveObject(raw: ReplayObject): GameObjectState {
  const obj: GameObjectState = {
    id: raw.id,
    kind: raw.kind,
    owner: raw.owner,
    controller: raw.controller,
    zone: { seat: raw.zone.seat, kind: raw.zone.kind as ZoneKind },
    card: stubCard(raw.scryfallId),
    faceDown: raw.faceDown,
    flipped: raw.flipped,
    tapped: raw.tapped,
    x: raw.x,
    y: raw.y,
    rotation: raw.rotation as Rotation,
    counters: raw.counters.map((c) => ({ ...c })),
    isFoil: raw.isFoil,
    sortIndex: raw.sortIndex,
    knownTo: new Set(raw.knownTo),
  };
  if (raw.attachedTo) obj.attachedTo = raw.attachedTo;
  if (raw.copyOf) obj.copyOf = raw.copyOf;
  return obj;
}

/**
 * Un siège, sans son jeton de reprise.
 *
 * `seatToken` est une **preuve d'identité** : il rend un siège à qui le
 * présente. L'écrire dans un enregistrement que l'on servira ensuite derrière
 * un lien de partage reviendrait à distribuer les clés de la table avec ses
 * photos.
 */
function dumpSeat(seat: SeatState): Record<string, unknown> {
  return {
    id: seat.id,
    seatIndex: seat.seatIndex,
    userId: seat.userId,
    displayName: seat.displayName,
    conceded: seat.conceded,
    life: seat.life,
    playerCounters: [...seat.playerCounters],
    commanderDamage: [...seat.commanderDamage].map(([from, byCmd]) => [from, [...byCmd]]),
    commanderTax: [...seat.commanderTax],
    playmatUrl: seat.playmatUrl,
    cardBackUrl: seat.cardBackUrl,
    color: seat.color,
    deckName: seat.deckName,
    handRevealedTo: [...seat.handRevealedTo],
    topRevealedTo: [...seat.topRevealedTo],
    topRevealedId: seat.topRevealedId,
    joinedAtSeq: seat.joinedAtSeq,
  };
}

function reviveSeat(raw: Record<string, unknown>): SeatState {
  const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    id: str(raw['id']),
    seatIndex: num(raw['seatIndex']),
    userId: typeof raw['userId'] === 'string' ? raw['userId'] : null,
    displayName: str(raw['displayName']),
    // Un replay n'a pas de sockets : personne n'y est « connecté », et
    // afficher des pastilles de présence dans un enregistrement serait un
    // contresens. On fige donc à `true`, ce qui donne une table complète.
    connected: true,
    conceded: raw['conceded'] === true,
    life: num(raw['life']),
    playerCounters: new Map(list<[string, number]>(raw['playerCounters'])),
    commanderDamage: new Map(
      list<[SeatId, Array<[ObjectId, number]>]>(raw['commanderDamage']).map(([from, byCmd]) => [
        from,
        new Map(byCmd),
      ]),
    ),
    commanderTax: new Map(list<[ObjectId, number]>(raw['commanderTax'])),
    playmatUrl: typeof raw['playmatUrl'] === 'string' ? raw['playmatUrl'] : null,
    cardBackUrl: typeof raw['cardBackUrl'] === 'string' ? raw['cardBackUrl'] : null,
    color: str(raw['color']),
    deckName: typeof raw['deckName'] === 'string' ? raw['deckName'] : null,
    deckSnapshotId: null,
    handRevealedTo: new Set(list<SeatId>(raw['handRevealedTo'])),
    handRevealedGranted: new Set(),
    topRevealedTo: new Set(list<SeatId>(raw['topRevealedTo'])),
    topRevealedId: typeof raw['topRevealedId'] === 'string' ? raw['topRevealedId'] : null,
    topRevealedGranted: new Set(),
    topRevealedPublishedTo: new Set(list<SeatId>(raw['topRevealedTo'])),
    // Jamais persisté, jamais rendu : voir `dumpSeat`.
    seatToken: '',
    joinedAtSeq: num(raw['joinedAtSeq']),
    disconnectedAt: null,
  };
}

/** Photographie omnisciente de la table, prise au lancement de la partie. */
export function dumpState(state: GameState): ReplayOrigin {
  const zones: Record<string, ObjectId[]> = {};
  for (const [key, ids] of state.zones) zones[key] = [...ids];

  return {
    seq: state.seq,
    code: state.code,
    mode: state.mode,
    turnNumber: state.turnNumber,
    activeSeat: state.activeSeat,
    phase: state.phase,
    hostSeat: state.hostSeat,
    seats: [...state.seats.values()].map(dumpSeat),
    objects: [...state.objects.values()].map(dumpObject),
    zones,
    labels: [...state.labels.values()].map((l) => ({ ...l })),
    logTail: state.log.slice(-200),
  };
}

/**
 * L'inverse : un `GameState` suffisant pour appeler `projectSnapshot`.
 *
 * Suffisant, pas complet — il n'a ni moteur, ni sockets, ni données de cartes.
 * Il n'est jamais appelé pour autre chose que de la projection, et il ne sort
 * jamais de `apps/server/src/replay`.
 */
export function reviveState(origin: ReplayOrigin): GameState {
  const seats = new Map<SeatId, SeatState>();
  for (const raw of origin.seats) {
    const seat = reviveSeat(raw as Record<string, unknown>);
    seats.set(seat.id, seat);
  }

  const objects = new Map<ObjectId, GameObjectState>();
  for (const raw of origin.objects) {
    const obj = reviveObject(raw);
    objects.set(obj.id, obj);
  }

  const zones = new Map<string, ObjectId[]>();
  for (const [key, ids] of Object.entries(origin.zones)) zones.set(key, [...ids]);

  const labels = new Map<ObjectId, Label>();
  for (const label of origin.labels as Label[]) labels.set(label.id, label);

  return {
    code: origin.code,
    roomId: '',
    mode: origin.mode as GameState['mode'],
    // La partie enregistrée **est** en cours à l'instant du point zéro : c'est
    // ce que `projectSnapshot` doit croire, faute de quoi il publierait la
    // bibliothèque du propriétaire au titre de l'exception de salon (§2.1).
    status: 'PLAYING',
    closed: false,
    hostSeat: origin.hostSeat,
    seq: origin.seq,
    turnNumber: origin.turnNumber,
    activeSeat: origin.activeSeat,
    phase: origin.phase as GameState['phase'],
    seats,
    objects,
    zones,
    labels,
    pendingLooks: new Map(),
    log: origin.logTail,
    createdAt: 0,
    lastActivityAt: 0,
  };
}

/** Utilitaire : la référence de zone d'un objet enregistré. */
export function zoneRefOf(raw: ReplayObject): ZoneRef {
  return { seat: raw.zone.seat, kind: raw.zone.kind as ZoneKind };
}

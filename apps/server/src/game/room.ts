/**
 * Une room = un état de partie en mémoire, ses sièges, ses sockets.
 *
 * Tout ce qui sort d'ici est déjà projeté pour son destinataire : le tampon de
 * resynchronisation lui-même stocke les variantes par siège, pour qu'un client
 * qui rejoue un delta ne voie jamais plus que ce qu'il aurait vu en direct.
 */
import { ulid } from 'ulid';
import type {
  CursorState,
  ErrorCode,
  Intent,
  LogEntry,
  ObjectId,
  SeatId,
  ServerEvent,
  ServerMessage,
  Seq,
  Snapshot,
  GameMode,
  ZoneKind,
  ZoneRef,
} from '@mtg/shared';
import { LIMITS, ZONE_KINDS } from '@mtg/shared';
import {
  applyIntent,
  captureZoneOrders,
  moveEmission,
  rankShiftEmissions,
  shuffleZone,
  type Emission,
  type EngineDeps,
  type UndoEntry,
} from './engine.js';
import { IntentError } from './errors.js';
import { projectCard, projectSnapshot } from './projection.js';
import { cryptoRandom, type RandomSource } from './random.js';
import {
  SEAT_COLORS,
  getZone,
  isEnumerableZone,
  startingLife,
  type CardData,
  type GameObjectState,
  type GameState,
  type SeatState,
} from './state.js';
import { reconcileTopReveals } from './topReveal.js';
import { ReplayRecorder, frameOf, type ReplaySink } from '../replay/recorder.js';
import { TokenBucket } from '../lib/throttle.js';

export interface Connection {
  id: string;
  seatId: SeatId | null;
  userId: string | null;
  lastSeq: Seq;
  send: (message: ServerMessage) => void;
  close: (code: number, reason: string) => void;
  bucket: TokenBucket;
  lastCursorAt: number;
  missedPongs: number;
}

export interface DeckPayload {
  name: string;
  cards: Array<{
    scryfallId: string;
    quantity: number;
    zone: 'MAIN' | 'COMMANDER' | 'SIDEBOARD';
    isFoil: boolean;
    name: string;
    setCode: string;
    collectorNumber: string;
    typeLine: string;
    manaCost: string | null;
    colorIdentity: string[];
    layout: string;
    imageUris: unknown;
    faces: unknown;
  }>;
}

export interface RoomHooks {
  /** Persistance du journal, asynchrone et sans bloquer la partie. */
  persistLog?: (roomId: string, entries: LogEntry[]) => void;
  /** Résolution d'une carte pour CREATE_TOKEN. */
  lookupCard?: (scryfallId: string) => Promise<CardData | null>;
  /**
   * Puits d'enregistrement du replay. Absent = on n'enregistre rien, et la
   * partie se déroule exactement comme avant : c'est le cas de tous les tests
   * qui ne parlent pas de replay.
   */
  replaySink?: ReplaySink;
}

/**
 * Actions qui ne s'annulent pas, et comment les nommer dans un refus.
 * Voir §9 du protocole : mélange, pioche et tirage sont définitifs par nature.
 */
const IRREVERSIBLE_LABELS: Record<string, string> = {
  SHUFFLE: 'Un mélange',
  DRAW: 'Une pioche',
  MULLIGAN: 'Un mulligan',
  MILL: 'Un mill',
  EXILE_TOP: 'Un exil du dessus',
  RANDOM_DISCARD: 'Une défausse au hasard',
  SCOOP: 'Un rangement de jeu',
  ROLL_DIE: 'Un lancer de dé',
  FLIP_COIN: 'Un tirage à pile ou face',
  LOOK: 'Une consultation',
  RESOLVE_LOOK: 'Une consultation résolue',
  START_GAME: 'Le lancement de la partie',
  RESTART_GAME: 'Une relance de partie',
  CONCEDE: 'Une concession',
};

export class Room {
  readonly state: GameState;
  private readonly connections = new Map<string, Connection>();
  /** Tampon de resynchronisation : seq → variante par siège (clé `null` = sans siège). */
  private readonly buffer = new Map<Seq, Map<SeatId | null, ServerEvent>>();
  private readonly undoStack = new Map<SeatId, { seq: Seq; entry: UndoEntry }>();
  /**
   * Dernière action de chaque siège, annulable ou non. Sans elle, un refus
   * d'annulation invoquait toujours le délai de dix secondes — y compris une
   * seconde après un mélange, qui ne s'annule dans aucun délai (§9).
   */
  private readonly lastAction = new Map<SeatId, { type: string; at: number }>();
  private readonly cursors = new Map<SeatId, CursorState>();
  private cursorTimer: NodeJS.Timeout | null = null;
  private pendingLog: LogEntry[] = [];
  /**
   * Enregistrement de la partie en cours, `null` hors partie.
   *
   * Ouvert par `startGame`, refermé par le premier `GAME_ENDED` qui passe par
   * `commit`. Tant qu'il n'est pas refermé, le replay correspondant n'est
   * lisible par personne : c'est le verrou, et il est porté par la donnée
   * elle-même plutôt que par une garde de route qu'on pourrait oublier
   * d'écrire sur la route suivante.
   */
  private recorder: ReplayRecorder | null = null;

  constructor(
    roomId: string,
    code: string,
    mode: GameMode,
    private readonly rng: RandomSource = cryptoRandom,
    private readonly hooks: RoomHooks = {},
  ) {
    this.state = {
      code,
      roomId,
      mode,
      status: 'LOBBY',
      closed: false,
      hostSeat: null,
      seq: 0,
      turnNumber: 0,
      activeSeat: null,
      phase: 'MAIN1',
      seats: new Map(),
      objects: new Map(),
      zones: new Map(),
      labels: new Map(),
      pendingLooks: new Map(),
      log: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  get isEmpty(): boolean {
    return this.connections.size === 0;
  }

  get idleMs(): number {
    return Date.now() - this.state.lastActivityAt;
  }

  // ---------------------------------------------------------------- connexions

  addConnection(conn: Connection): void {
    this.connections.set(conn.id, conn);
  }

  removeConnection(connId: string): void {
    const conn = this.connections.get(connId);
    this.connections.delete(connId);
    if (!conn?.seatId) return;

    // Un siège déconnecté est marqué, jamais supprimé : le joueur reprend sa place.
    const stillHere = [...this.connections.values()].some((c) => c.seatId === conn.seatId);
    if (stillHere) return;

    const seat = this.state.seats.get(conn.seatId);
    if (!seat) return;
    seat.connected = false;
    // Le délai d'abandon d'une consultation court à partir d'ici (§6.4).
    seat.disconnectedAt = Date.now();
    this.cursors.delete(seat.id);
    this.commit(null, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'SEAT_CONNECTION', seatId: seat.id, connected: false }),
        log: { text: `${seat.displayName} s'est déconnecté`, cardIds: [] },
      },
    ]);
  }

  snapshotFor(seat: SeatId | null): Snapshot {
    return projectSnapshot(this.state, seat);
  }

  /**
   * Delta depuis `sinceSeq`, ou `null` si le client est trop en retard pour être
   * rattrapé — auquel cas l'appelant envoie un snapshot complet.
   */
  deltaFor(seat: SeatId | null, sinceSeq: Seq): ServerEvent[] | null {
    // Un client sans siège n'a aucun état de partie à rattraper (§13.4).
    if (seat === null) return null;
    // Client en avance sur le serveur : son état ne vient pas de cette room
    // (redémarrage, room recréée). On ne peut que tout remplacer.
    if (sinceSeq > this.state.seq) return null;
    if (sinceSeq === this.state.seq) return [];
    // Le siège n'existait pas encore : le tampon ne contient aucune variante
    // pour lui avant son arrivée, et le rejouer donnerait un état amputé.
    const seatState = this.state.seats.get(seat);
    if (!seatState || sinceSeq < seatState.joinedAtSeq) return null;
    const oldest = this.state.seq - this.buffer.size;
    if (sinceSeq < oldest) return null;

    const out: ServerEvent[] = [];
    for (let s = sinceSeq + 1; s <= this.state.seq; s++) {
      const variants = this.buffer.get(s);
      if (!variants) return null;
      const event = variants.get(seat) ?? variants.get(null);
      // Le tampon est dense pour tout siège présent (voir `commit`) : une
      // variante manquante signifie que ce `seq` est antérieur à ce siège, ou
      // que le tampon a été rogné. Rendre le delta amputé recréerait chez le
      // client le trou de séquence même qu'on cherche à supprimer — un snapshot
      // complet est la seule réponse honnête.
      if (!event) return null;
      out.push(event);
    }
    return out;
  }

  // -------------------------------------------------------------------- sièges

  private nextColor(index: number): string {
    return SEAT_COLORS[index % SEAT_COLORS.length]!;
  }

  sitDown(conn: Connection, seatIndex: number, displayName: string, userId: string | null): SeatState {
    if (this.state.closed) {
      throw new IntentError('ERR_ROOM_CLOSED', 'Cette table est close.');
    }
    if (this.state.seats.size >= LIMITS.maxSeats) {
      throw new IntentError('ERR_ROOM_FULL', 'La table est complète.');
    }
    const taken = [...this.state.seats.values()].find((s) => s.seatIndex === seatIndex);
    if (taken) {
      // Un siège déconnecté reste celui de son joueur : sa main et sa
      // bibliothèque sont encore là. On ne le rend qu'à son titulaire —
      // par `seatToken` (voir `resumeSeat`) ou, pour un compte, par son userId.
      // Sans cette garde, n'importe qui pourrait s'asseoir à la place d'un
      // joueur déconnecté et recevoir sa main dans le snapshot.
      if (taken.connected || taken.userId === null || taken.userId !== userId) {
        throw new IntentError('ERR_SEAT_TAKEN', 'Ce siège est déjà occupé.');
      }
    }

    const seat: SeatState = taken ?? {
      id: `seat_${seatIndex}`,
      seatIndex,
      userId,
      displayName,
      connected: true,
      conceded: false,
      life: startingLife(this.state.mode),
      playerCounters: new Map(),
      commanderDamage: new Map(),
      commanderTax: new Map(),
      playmatUrl: null,
      cardBackUrl: null,
      color: this.nextColor(seatIndex),
      deckName: null,
      deckSnapshotId: null,
      handRevealedTo: new Set(),
      handRevealedGranted: new Set(),
      topRevealedTo: new Set(),
      topRevealedId: null,
      topRevealedGranted: new Set(),
      topRevealedPublishedTo: new Set(),
      seatToken: ulid(),
      joinedAtSeq: 0,
      disconnectedAt: null,
    };
    seat.connected = true;
    seat.disconnectedAt = null;
    seat.displayName = displayName;
    seat.userId = userId;

    this.state.seats.set(seat.id, seat);
    this.state.hostSeat ??= seat.id;
    conn.seatId = seat.id;

    const seq = this.commit(seat.id, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'SEAT_JOINED', seat: this.summarize(seat) }),
        log: { text: `${seat.displayName} a rejoint la table`, cardIds: [] },
      },
    ]);
    seat.joinedAtSeq = seq ?? this.state.seq;
    return seat;
  }

  /** Reprise d'un siège après rechargement, sur présentation du jeton de siège. */
  resumeSeat(conn: Connection, seatToken: string): SeatState | null {
    if (this.state.closed) return null;
    const seat = [...this.state.seats.values()].find((s) => s.seatToken === seatToken);
    if (!seat) return null;
    seat.connected = true;
    seat.disconnectedAt = null;
    conn.seatId = seat.id;
    this.commit(null, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'SEAT_CONNECTION', seatId: seat.id, connected: true }),
        log: { text: `${seat.displayName} est de retour`, cardIds: [] },
      },
    ]);
    return seat;
  }

  /**
   * Quitter la table.
   *
   * Un joueur peut partir à tout moment — c'est ce qu'il fait sur une vraie
   * table. En cours de partie, ce départ vaut concession : il ne s'évapore pas
   * avec ses permanents en jeu, tout son matériel quitte réellement l'état, et
   * la partie continue sans lui. Comme c'est irréversible, il faut le vouloir :
   * hors `force`, le serveur refuse tant que la partie tourne, et l'interface
   * ne pose ce drapeau qu'après confirmation explicite.
   *
   * « Quitter » veut dire quitter : objets, zones, étiquettes, et jusqu'aux
   * `knownTo` que les autres cartes gardaient de lui.
   */
  standUp(conn: Connection, options: { force?: boolean } = {}): void {
    const seatId = conn.seatId;
    if (!seatId) return;
    this.releaseSeat(seatId, options);
    conn.seatId = null;
  }

  /**
   * Libère le siège d'un compte depuis l'extérieur de la table.
   *
   * La page « mes tables » n'a pas de socket ouverte sur la room : quitter y
   * passe donc par HTTP, et l'on retrouve le siège par le compte. Un siège
   * d'invité n'a pas de compte et ne peut être quitté que depuis la table.
   */
  leaveByUser(userId: string, options: { force?: boolean } = {}): boolean {
    const seat = [...this.state.seats.values()].find((s) => s.userId === userId);
    if (!seat) return false;
    for (const conn of this.connections.values()) {
      if (conn.seatId === seat.id) conn.seatId = null;
    }
    this.releaseSeat(seat.id, options);
    return true;
  }

  private releaseSeat(seatId: SeatId, options: { force?: boolean } = {}): void {
    const seat = this.state.seats.get(seatId);
    if (!seat) return;
    const inGame = this.state.status === 'PLAYING' && seat !== undefined && !seat.conceded;
    if (inGame && !options.force) {
      throw new IntentError(
        'ERR_GAME_ALREADY_STARTED',
        'Confirme le départ : quitter en cours de partie vaut concession.',
      );
    }

    this.state.seats.delete(seatId);
    this.cursors.delete(seatId);
    this.undoStack.delete(seatId);

    // Une consultation laissée ouverte garderait ses cartes verrouillées pour
    // toujours : plus personne ne peut la résoudre.
    for (const look of [...this.state.pendingLooks.values()]) {
      if (look.seat !== seatId) continue;
      this.state.pendingLooks.delete(look.id);
    }

    const emissions: Emission[] = [];
    const removed: ObjectId[] = [];
    const destroyedTokens: ObjectId[] = [];
    const touchedZones = new Set<string>();

    for (const [id, obj] of [...this.state.objects]) {
      if (obj.owner !== seatId) continue;
      this.state.objects.delete(id);
      const list = this.state.zones.get(`${obj.zone.seat}|${obj.zone.kind}`);
      const idx = list?.indexOf(id) ?? -1;
      if (list && idx >= 0) list.splice(idx, 1);
      if (list) {
        list.forEach((other, i) => {
          const o = this.state.objects.get(other);
          if (o) o.sortIndex = i;
        });
      }
      touchedZones.add(`${obj.zone.seat}|${obj.zone.kind}`);
      if (obj.kind === 'TOKEN') destroyedTokens.push(id);
      else removed.push(id);
    }

    // Les cartes restantes ne doivent plus référencer ni connaître le partant.
    for (const obj of this.state.objects.values()) {
      obj.knownTo.delete(seatId);
      if (obj.attachedTo && !this.state.objects.has(obj.attachedTo)) {
        obj.attachedTo = undefined;
        emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'DETACHED', sourceId: obj.id }) });
      }
    }
    for (const other of this.state.seats.values()) {
      other.handRevealedTo.delete(seatId);
      // Un droit accordé à un siège absent survivrait dans l'état, et le
      // prochain joueur à s'asseoir à cet index en hériterait (§12.7).
      other.topRevealedTo.delete(seatId);
      other.topRevealedGranted.delete(seatId);
      other.commanderDamage.delete(seatId);
    }
    for (const [id, label] of [...this.state.labels]) {
      if (label.owner !== seatId) continue;
      this.state.labels.delete(id);
      emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'LABEL_REMOVED', labelId: id }) });
    }

    // `CARD_HIDDEN` dit « oublie cet objet » sans rien apprendre : c'est
    // exactement ce dont les autres tables ont besoin.
    for (const id of removed) {
      emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'CARD_HIDDEN', cardId: id }) });
    }
    if (destroyedTokens.length > 0) {
      emissions.push({
        audience: { kind: 'ALL' },
        build: () => ({ type: 'TOKENS_DESTROYED', cardIds: destroyedTokens }),
      });
    }
    for (const key of [...this.state.zones.keys()]) {
      if (key.startsWith(`${seatId}|`)) {
        const [zoneSeat = '', kind = ''] = key.split('|');
        const zone = { seat: zoneSeat, kind } as ZoneRef;
        this.state.zones.delete(key);
        emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'ZONE_COUNT', zone, count: 0 }) });
      } else if (touchedZones.has(key)) {
        const [zoneSeat = '', kind = ''] = key.split('|');
        const zone = { seat: zoneSeat, kind } as ZoneRef;
        const count = this.state.zones.get(key)?.length ?? 0;
        emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'ZONE_COUNT', zone, count }) });
      }
    }

    if (this.state.hostSeat === seatId) {
      this.state.hostSeat = [...this.state.seats.keys()][0] ?? null;
    }
    if (this.state.activeSeat === seatId) {
      this.state.activeSeat = [...this.state.seats.keys()][0] ?? null;
    }

    // Partir en cours de partie vaut concession : s'il ne reste qu'un joueur
    // encore en lice, la partie est finie, exactement comme après `CONCEDE`.
    if (inGame) {
      const remaining = [...this.state.seats.values()].filter((s) => !s.conceded);
      if (remaining.length === 1 && remaining[0]) {
        const winner = remaining[0].id;
        this.state.status = 'ENDED';
        emissions.push({
          audience: { kind: 'ALL' },
          build: () => ({ type: 'GAME_ENDED', reason: 'CONCEDE', winners: [winner] }),
        });
      }
    }

    this.commit(null, [
      {
        // Le partant est explicitement dans l'audience : `ALL` se résout sur
        // les sièges **encore** assis, et il n'apprenait donc pas son propre
        // départ — son client restait sur une table dont il ne faisait plus
        // partie.
        audience: { kind: 'SEATS', seats: [...this.state.seats.keys(), seatId] },
        build: () => ({ type: 'SEAT_LEFT', seatId }),
        log: {
          text: inGame
            ? `${seat?.displayName ?? 'un joueur'} a quitté la partie`
            : `${seat?.displayName ?? 'un joueur'} a quitté la table`,
          cardIds: [],
        },
      },
      ...emissions,
    ]);
  }

  /**
   * Clore la table, de la volonté de l'hôte.
   *
   * La partie s'arrête pour tout le monde en même temps ; les sièges restent en
   * place, personne n'est expulsé de force de sa page. C'est l'équivalent de
   * « on remballe » : plus rien ne se joue, et la room sera libérée au prochain
   * balayage puisqu'elle finira par se vider.
   */
  closeRoom(seatId: SeatId): void {
    if (this.state.hostSeat !== seatId) {
      throw new IntentError('ERR_NOT_HOST', "Seul l'hôte peut clore la table.");
    }
    this.close(this.state.seats.get(seatId)?.displayName);
  }

  /**
   * Clôture demandée hors de la table, par le créateur de la room.
   *
   * L'autorité n'est pas la même : ici c'est le `hostUserId` de la base, vérifié
   * par la route, et non le siège hôte — le créateur peut clore une table où il
   * ne s'est jamais assis.
   */
  close(byName?: string): void {
    if (this.state.closed) return;
    const closer = { displayName: byName };
    this.state.status = 'ENDED';
    this.state.closed = true;
    this.commit(null, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'GAME_ENDED', reason: 'HOST', winners: [] }),
        log: { text: `${closer?.displayName ?? "l'hôte"} a clos la table`, cardIds: [] },
      },
    ]);
  }

  private summarize(seat: SeatState) {
    // Réutilise la projection commune, pour que `SeatSummary` n'ait qu'une source.
    const snapshot = projectSnapshot(this.state, seat.id);
    return snapshot.seats.find((s) => s.id === seat.id)!;
  }

  // --------------------------------------------------------------------- decks

  /**
   * Installe un deck figé sur un siège : bibliothèque mélangée, commandants en
   * zone de commandement, réserve à part.
   */
  loadDeck(seatId: SeatId, payload: DeckPayload, snapshotId: string | null): void {
    const seat = this.state.seats.get(seatId);
    if (!seat) throw new IntentError('ERR_NOT_SEATED', 'Siège inconnu.');

    // Un joueur qui arrive après le début doit pouvoir s'installer : à une vraie
    // table, un retardataire mélange et s'assoit. Ce qu'on refuse, c'est de
    // remplacer un deck déjà en jeu — cela effacerait main, cimetière et
    // permanents, y compris ceux que les autres ont sous les yeux.
    if (this.state.status === 'PLAYING') {
      const alreadyPlaying = [...this.state.objects.values()].some((o) => o.owner === seatId);
      if (alreadyPlaying) {
        throw new IntentError(
          'ERR_GAME_ALREADY_STARTED',
          'Tu as déjà un deck en jeu : impossible d’en charger un autre en cours de partie.',
        );
      }
    }

    /*
     * On repart de zéro pour ce siège : recharger un deck ne cumule pas.
     *
     * Et il faut le **dire** aux clients. L'état serveur était bien remis à
     * neuf, mais aucun event ne l'annonçait : les autres gardaient donc à
     * l'écran le deck précédent, jetons compris, et l'on voyait deux decks se
     * superposer. `CARD_HIDDEN` dit « oublie cet objet » sans rien apprendre —
     * c'est exactement ce qu'il faut ici.
     */
    const forgotten: ObjectId[] = [];
    const discardedTokens: ObjectId[] = [];
    for (const [id, obj] of [...this.state.objects]) {
      if (obj.owner !== seatId) continue;
      this.state.objects.delete(id);
      if (obj.kind === 'TOKEN') discardedTokens.push(id);
      else forgotten.push(id);
    }
    for (const key of [...this.state.zones.keys()]) {
      if (key.startsWith(`${seatId}|`)) this.state.zones.set(key, []);
    }
    // Les cartes des autres ne doivent plus garder trace de celles qui partent.
    for (const obj of this.state.objects.values()) {
      if (obj.attachedTo && !this.state.objects.has(obj.attachedTo)) obj.attachedTo = undefined;
    }

    /*
     * La taxe de commandant est indexee par **identifiant d'objet** : celui du
     * commandant de l'ancien deck. Les objets viennent d'etre supprimes, mais
     * la taxe restait — le panneau affichait alors une ligne de taxe rattachee
     * a une carte qui n'existe plus, donc une case vide avec ses boutons.
     * Changer de deck remet le compteur a zero, ce qui est de toute facon la
     * verite : ce commandant-la n'a jamais ete lance.
     */
    seat.commanderTax.clear();

    const commanders: GameObjectState[] = [];
    for (const entry of payload.cards) {
      const card: CardData = {
        scryfallId: entry.scryfallId,
        name: entry.name,
        setCode: entry.setCode,
        collectorNumber: entry.collectorNumber,
        typeLine: entry.typeLine,
        manaCost: entry.manaCost,
        colorIdentity: entry.colorIdentity,
        layout: entry.layout,
        imageUris: entry.imageUris,
        faces: entry.faces,
      };
      const kind =
        entry.zone === 'COMMANDER' ? 'COMMAND' : entry.zone === 'SIDEBOARD' ? 'SIDEBOARD' : 'LIBRARY';

      for (let i = 0; i < entry.quantity; i++) {
        const obj: GameObjectState = {
          id: ulid(),
          kind: 'CARD',
          owner: seatId,
          controller: seatId,
          zone: { seat: seatId, kind },
          card,
          faceDown: kind !== 'COMMAND',
          flipped: false,
          tapped: false,
          x: 0,
          y: 0,
          rotation: 0,
          counters: [],
          isFoil: entry.isFoil,
          sortIndex: 0,
          origin: kind,
          /*
           * Une carte en bibliothèque est connue de son **seul propriétaire, et
           * seulement avant le lancement** : c'est la liste qu'il vient de
           * charger, il la connaît déjà par cœur. `START_GAME` remélange en
           * réattribuant les identifiants et en vidant `knownTo` — l'ordre
           * redevient alors secret pour tout le monde, lui compris.
           */
          knownTo:
            kind === 'COMMAND' ? new Set(this.state.seats.keys()) : new Set([seatId]),
        };
        this.state.objects.set(obj.id, obj);
        getZone(this.state, obj.zone).push(obj.id);
        if (kind === 'COMMAND') commanders.push(obj);
      }
    }

    const library = getZone(this.state, { seat: seatId, kind: 'LIBRARY' });
    this.rng.shuffle(library);
    library.forEach((id, i) => {
      const obj = this.state.objects.get(id);
      if (obj) obj.sortIndex = i;
    });
    seat.deckName = payload.name;
    seat.deckSnapshotId = snapshotId;

    // Zone de commandement et réserve sont énumérables : sans event, un client
    // rattrapé par delta ne les verrait jamais apparaître.
    const placed = new Map<ZoneKind, GameObjectState[]>();
    for (const obj of this.state.objects.values()) {
      if (obj.owner !== seatId || obj.zone.kind === 'LIBRARY') continue;
      const bucket = placed.get(obj.zone.kind) ?? [];
      bucket.push(obj);
      placed.set(obj.zone.kind, bucket);
    }

    /*
     * La bibliothèque part elle aussi, mais **au seul propriétaire** : c'est ce
     * qui lui permet de composer son deck depuis la table. Adressée à `ALL`,
     * elle publierait les identifiants de bibliothèque à toute la table, ce que
     * la §2.1 interdit formellement.
     */
    const ownLibrary = getZone(this.state, { seat: seatId, kind: 'LIBRARY' })
      .map((id) => this.state.objects.get(id))
      .filter((o): o is GameObjectState => o !== undefined);

    const cardCount = payload.cards.reduce((sum, c) => sum + c.quantity, 0);
    this.commit(seatId, [
      {
        audience: { kind: 'ALL' },
        build: () => ({
          type: 'DECK_LOADED',
          seatId,
          deckName: payload.name,
          cardCount,
          commanders: commanders.map((c) => ({
            id: c.id,
            kind: c.kind,
            owner: c.owner,
            controller: c.controller,
            zone: c.zone,
            faceDown: false as const,
            scryfallId: c.card.scryfallId,
            flipped: false,
            tapped: false,
            x: c.x,
            y: c.y,
            rotation: c.rotation,
            counters: [],
            isFoil: c.isFoil,
            sortIndex: c.sortIndex,
          })),
        }),
        log: { text: `${seat.displayName} a chargé « ${payload.name} » (${cardCount} cartes)`, cardIds: [] },
      },
      ...[...placed].map(([kind, objects]) => ({
        audience: { kind: 'ALL' as const },
        build: (viewer: SeatId) => ({
          type: 'CARDS_MOVED' as const,
          cards: objects.map((o) => projectCard(o, viewer)),
          from: { seat: seatId, kind: 'LIBRARY' as const },
          to: { seat: seatId, kind },
        }),
      })),
      ...forgotten.map((id) => ({
        audience: { kind: 'ALL' as const },
        build: () => ({ type: 'CARD_HIDDEN' as const, cardId: id }),
      })),
      ...(discardedTokens.length > 0
        ? [
            {
              audience: { kind: 'ALL' as const },
              build: () => ({ type: 'TOKENS_DESTROYED' as const, cardIds: discardedTokens }),
            },
          ]
        : []),
      ...(ownLibrary.length > 0
        ? [
            {
              audience: { kind: 'SEAT' as const, seat: seatId },
              build: () => ({
                type: 'CARDS_MOVED' as const,
                cards: ownLibrary.map((o) => projectCard(o, seatId)),
                from: { seat: seatId, kind: 'LIBRARY' as const },
                to: { seat: seatId, kind: 'LIBRARY' as const },
              }),
            },
          ]
        : []),
      ...this.zoneCounts(seatId),
    ]);
  }

  /**
   * Un `ZONE_COUNT` par zone du siège — **toutes** les zones, y compris celles
   * qui viennent de se vider. Un compte qu'on omet de remettre à zéro reste
   * affiché : c'est ainsi qu'un champ de bataille rangé garde ses cartes.
   */
  private zoneCounts(seatId: SeatId): Emission[] {
    return ZONE_KINDS.map((kind) => {
      const zone = { seat: seatId, kind };
      const count = getZone(this.state, zone).length;
      return { audience: { kind: 'ALL' as const }, build: () => ({ type: 'ZONE_COUNT' as const, zone, count }) };
    });
  }

  startGame(seatId: SeatId): void {
    if (this.state.hostSeat !== seatId) {
      throw new IntentError('ERR_NOT_YOURS', "Seul l'hôte lance la partie.");
    }
    if (this.state.status === 'PLAYING') {
      throw new IntentError('ERR_GAME_ALREADY_STARTED', 'La partie a déjà commencé.');
    }
    // Sans deck, `START_GAME` distribuerait des mains vides et figerait une
    // partie injouable : on refuse plutôt que de démarrer à moitié.
    const deckless = [...this.state.seats.values()].filter(
      (s) => getZone(this.state, { seat: s.id, kind: 'LIBRARY' }).length === 0,
    );
    if (deckless.length > 0) {
      throw new IntentError(
        'ERR_GAME_NOT_STARTED',
        `Deck manquant : ${deckless.map((s) => s.displayName).join(', ')}.`,
      );
    }

    /*
     * **Lancer, c'est repartir d'une table nette.**
     *
     * Avant le lancement, chacun compose son deck : on pose des cartes pour
     * regarder, on en met au cimetière par curiosité, on crée un jeton pour
     * essayer. Rien de tout cela ne doit se retrouver en jeu. Tout rentre donc
     * dans la bibliothèque — sauf les commandants, qui regagnent leur zone, et
     * les jetons, qui cessent d'exister.
     *
     * Les clients l'apprennent par `CARD_HIDDEN` et `TOKENS_DESTROYED` : les
     * identifiants vont de toute façon changer au mélange qui suit.
     */
    const cleared: ObjectId[] = [];
    const scrapped: ObjectId[] = [];
    for (const [id, obj] of [...this.state.objects]) {
      if (obj.kind === 'TOKEN') {
        this.state.objects.delete(id);
        scrapped.push(id);
        continue;
      }
      const home: ZoneKind = obj.origin === 'COMMAND' ? 'COMMAND' : 'LIBRARY';
      if (obj.zone.kind === home) continue;
      cleared.push(id);
      obj.zone = { seat: obj.owner, kind: home };
      obj.controller = obj.owner;
      obj.faceDown = home !== 'COMMAND';
      obj.flipped = false;
      obj.tapped = false;
      obj.rotation = 0;
      obj.x = 0;
      obj.y = 0;
      obj.counters = [];
      obj.attachedTo = undefined;
      obj.knownTo = home === 'COMMAND' ? new Set(this.state.seats.keys()) : new Set();
    }
    if (cleared.length > 0 || scrapped.length > 0) {
      this.state.zones.clear();
      for (const obj of this.state.objects.values()) getZone(this.state, obj.zone).push(obj.id);
    }

    this.state.status = 'PLAYING';
    this.state.turnNumber = 1;
    const seats = [...this.state.seats.values()].sort((a, b) => a.seatIndex - b.seatIndex);
    const starting = seats[this.rng.below(seats.length)] ?? seats[0]!;
    this.state.activeSeat = starting.id;

    const emissions: Emission[] = [];
    for (const id of cleared) {
      emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'CARD_HIDDEN', cardId: id }) });
    }
    if (scrapped.length > 0) {
      emissions.push({
        audience: { kind: 'ALL' },
        build: () => ({ type: 'TOKENS_DESTROYED', cardIds: scrapped }),
      });
    }
    for (const seat of seats) {
      const from = { seat: seat.id, kind: 'LIBRARY' as const };

      /*
       * **On mélange pour de bon avant de distribuer.**
       *
       * Deux raisons, et la seconde est une question d'équité. D'abord c'est ce
       * qu'on fait à une vraie table. Ensuite, chaque joueur vient de voir sa
       * bibliothèque entière dans le panneau de composition : sans ce mélange
       * — qui réattribue les identifiants et vide `knownTo` — il entrerait en
       * partie en connaissant l'ordre de son deck, donc ses dix prochaines
       * pioches. Le `CARD_HIDDEN` qui suit dit à son client d'oublier ce qu'il
       * savait ; personne d'autre ne l'a jamais su.
       */
      const forgotten = [...getZone(this.state, from)];
      shuffleZone(this.state, from, this.rng);
      for (const id of forgotten) {
        emissions.push({
          audience: { kind: 'SEAT', seat: seat.id },
          build: () => ({ type: 'CARD_HIDDEN', cardId: id }),
        });
      }

      const library = getZone(this.state, from);
      const hand = getZone(this.state, { seat: seat.id, kind: 'HAND' });
      const dealt: GameObjectState[] = [];
      for (const id of library.slice(0, 7)) {
        const obj = this.state.objects.get(id);
        if (!obj) continue;
        obj.zone = { seat: seat.id, kind: 'HAND' };
        obj.knownTo = new Set([seat.id]);
        obj.sortIndex = hand.length;
        hand.push(id);
        dealt.push(obj);
      }
      library.splice(0, Math.min(7, library.length));
      library.forEach((objectId, i) => {
        const obj = this.state.objects.get(objectId);
        if (obj) obj.sortIndex = i;
      });
      // La main d'ouverture doit exister dans le flux d'events : un client
      // rattrapé par delta n'a pas d'autre source que ceux-ci.
      for (const obj of dealt) emissions.push(moveEmission(this.state, obj, from));
      emissions.push(...this.zoneCounts(seat.id));
    }

    const snapshotIds = Object.fromEntries(
      seats.map((s) => [s.id, s.deckSnapshotId ?? '']),
    ) as Record<SeatId, string>;

    this.commit(seatId, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'GAME_STARTED', startingSeat: starting.id, snapshotIds }),
        log: { text: `La partie commence — ${starting.displayName} joue en premier`, cardIds: [] },
      },
      ...emissions,
    ]);

    // Le point zéro du replay est ici : decks mélangés, mains distribuées.
    this.openReplay();

    // Les mains viennent d'être distribuées : chacun reçoit la sienne, projetée.
    this.resendSnapshots();
  }

  /**
   * Remet la table au lobby.
   *
   * `keepDecks: true` rejoue le même matériel : chaque carte retourne à la zone
   * où le `DeckSnapshot` l'avait placée — c'est `origin`, figé au chargement —,
   * les jetons cessent d'exister, et les bibliothèques sont remélangées. On
   * repart donc des decks figés, en conservant les échanges de réserve déjà
   * faits, ce qui est exactement le comportement attendu entre deux manches.
   *
   * `keepDecks: false` vide la table : chaque siège rechargera son deck.
   */
  restartGame(seatId: SeatId, keepDecks: boolean): void {
    if (this.state.hostSeat !== seatId) {
      throw new IntentError('ERR_NOT_YOURS', "Seul l'hôte relance la partie.");
    }

    const emissions: Emission[] = [];
    const forgotten: ObjectId[] = [];
    const destroyed: ObjectId[] = [];

    // Les clients oublient tout avant la reconstruction : les identifiants des
    // bibliothèques vont changer, ceux des jetons disparaître.
    for (const [id, obj] of [...this.state.objects]) {
      if (obj.kind === 'TOKEN' || !keepDecks) {
        this.state.objects.delete(id);
        (obj.kind === 'TOKEN' ? destroyed : forgotten).push(id);
        continue;
      }
      forgotten.push(id);
      obj.zone = { seat: obj.owner, kind: obj.origin ?? 'LIBRARY' };
      obj.controller = obj.owner;
      obj.faceDown = obj.zone.kind !== 'COMMAND';
      obj.flipped = false;
      obj.tapped = false;
      obj.rotation = 0;
      obj.x = 0;
      obj.y = 0;
      obj.counters = [];
      obj.attachedTo = undefined;
      obj.knownTo = new Set();
    }

    this.state.zones.clear();
    this.state.pendingLooks.clear();
    this.undoStack.clear();
    for (const obj of this.state.objects.values()) getZone(this.state, obj.zone).push(obj.id);

    for (const seat of this.state.seats.values()) {
      const library = getZone(this.state, { seat: seat.id, kind: 'LIBRARY' });
      this.rng.shuffle(library);
      // Réattribution des identifiants : une bibliothèque remélangée ne doit pas
      // rester corrélable aux identifiants de la partie précédente (§2.1).
      const renamed: ObjectId[] = [];
      for (const oldId of library) {
        const obj = this.state.objects.get(oldId);
        if (!obj) continue;
        this.state.objects.delete(oldId);
        obj.id = ulid();
        this.state.objects.set(obj.id, obj);
        renamed.push(obj.id);
      }
      this.state.zones.set(`${seat.id}|LIBRARY`, renamed);

      for (const [key, list] of this.state.zones) {
        if (!key.startsWith(`${seat.id}|`)) continue;
        list.forEach((id, i) => {
          const obj = this.state.objects.get(id);
          if (obj) {
            obj.sortIndex = i;
            // Le commandant est public, la réserve n'est connue que d'elle-même,
            // la bibliothèque de personne — comme au chargement du deck.
            if (obj.zone.kind === 'COMMAND') obj.knownTo = new Set(this.state.seats.keys());
            else if (obj.zone.kind !== 'LIBRARY') obj.knownTo = new Set([seat.id]);
          }
        });
      }

      seat.life = startingLife(this.state.mode);
      seat.conceded = false;
      seat.playerCounters.clear();
      seat.commanderDamage.clear();
      seat.commanderTax.clear();
      seat.handRevealedTo.clear();
      seat.handRevealedGranted.clear();
      // Une révélation permanente porte sur la partie qu'on vient de finir : la
      // reconduire d'office à la manche suivante n'a été demandé par personne.
      seat.topRevealedTo.clear();
      seat.topRevealedGranted.clear();
      seat.topRevealedPublishedTo.clear();
      seat.topRevealedId = null;
      if (!keepDecks) {
        seat.deckName = null;
        seat.deckSnapshotId = null;
      }
    }

    this.state.status = 'LOBBY';
    this.state.turnNumber = 0;
    this.state.activeSeat = null;
    this.state.phase = 'MAIN1';

    for (const id of forgotten) {
      emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'CARD_HIDDEN', cardId: id }) });
    }
    if (destroyed.length > 0) {
      emissions.push({ audience: { kind: 'ALL' }, build: () => ({ type: 'TOKENS_DESTROYED', cardIds: destroyed }) });
    }
    for (const seat of this.state.seats.values()) {
      const byKind = new Map<ZoneKind, GameObjectState[]>();
      for (const [key, list] of this.state.zones) {
        if (!key.startsWith(`${seat.id}|`)) continue;
        const [, kind = ''] = key.split('|');
        if (kind === 'LIBRARY') continue;
        const objects = list
          .map((id) => this.state.objects.get(id))
          .filter((o): o is GameObjectState => o !== undefined);
        if (objects.length > 0) byKind.set(kind as ZoneKind, objects);
      }
      for (const [kind, objects] of byKind) {
        emissions.push({
          audience: { kind: 'ALL' },
          build: (viewer) => ({
            type: 'CARDS_MOVED',
            cards: objects.map((o) => projectCard(o, viewer)),
            from: { seat: seat.id, kind: 'LIBRARY' },
            to: { seat: seat.id, kind },
          }),
        });
      }
      // `SEAT_JOINED` republie le `SeatSummary` entier : vie, marqueurs, taxes,
      // tout est remis à zéro d'un coup, sans un event par compteur effacé.
      emissions.push({
        audience: { kind: 'ALL' },
        build: () => ({ type: 'SEAT_JOINED', seat: this.summarize(seat) }),
      });
      emissions.push(...this.zoneCounts(seat.id));
    }

    this.commit(seatId, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'GAME_ENDED', reason: 'HOST', winners: [] }),
        log: {
          text: keepDecks
            ? 'La partie est relancée avec les mêmes decks'
            : 'La partie est relancée, les decks sont à recharger',
          cardIds: [],
        },
      },
      ...emissions,
    ]);
  }

  private resendSnapshots(): void {
    for (const conn of this.connections.values()) {
      conn.send({
        t: 'hello',
        protocol: 1,
        seat: conn.seatId,
        roomCode: this.state.code,
        snapshot: this.snapshotFor(conn.seatId),
      });
    }
  }

  // ------------------------------------------------------------------- intents

  async handleIntent(conn: Connection, cid: string, intent: Intent): Promise<void> {
    if (!conn.seatId) {
      conn.send({ t: 'reject', cid, code: 'ERR_NOT_SEATED', message: 'Assieds-toi pour jouer.' });
      return;
    }

    /*
     * Une table close est close. Annoncer la fin puis laisser les joueurs
     * continuer à jouer n'était pas une clôture, c'était un message : on
     * refuse donc tout, jusqu'au curseur. Seul `STAND_UP` passe encore — il
     * faut bien pouvoir rendre sa place et sortir proprement.
     */
    if (this.state.closed && intent.type !== 'STAND_UP') {
      conn.send({
        t: 'reject',
        cid,
        code: 'ERR_ROOM_CLOSED',
        message: 'Cette table est close.',
      });
      return;
    }

    try {
      if (intent.type === 'CURSOR') {
        this.handleCursor(conn.seatId, intent.x, intent.y, intent.holding);
        return;
      }
      if (intent.type === 'UNDO_LAST') {
        this.handleUndo(conn.seatId, cid);
        return;
      }
      if (intent.type === 'RESTART_GAME') {
        // Touche la room entière (statut, tour, sièges) : c'est ici, pas dans le
        // moteur, qui ne connaît qu'un état de partie.
        this.restartGame(conn.seatId, intent.keepDecks);
        this.undoStack.delete(conn.seatId);
        conn.send({ t: 'ack', cid, seq: this.state.seq });
        return;
      }

      // Les intents qui désignent une carte par son identifiant Scryfall ont
      // besoin d'un aller-retour en base : le moteur, lui, reste synchrone.
      const deps: EngineDeps = {};
      const needsCard =
        (intent.type === 'CREATE_TOKEN' && intent.scryfallId) ||
        (intent.type === 'SET_PRINTING' ? intent.scryfallId : null);
      if (needsCard && this.hooks.lookupCard) {
        const card = await this.hooks.lookupCard(needsCard);
        if (!card) {
          conn.send({ t: 'reject', cid, code: 'ERR_UNKNOWN_OBJECT', message: 'Carte introuvable.' });
          return;
        }
        deps.cardData = card;
      }

      const result = applyIntent(this.state, conn.seatId, intent, this.rng, deps);
      const seq = this.commit(conn.seatId, result.emissions);

      if (seq !== null) {
        // Une action non réversible (mélange, pioche, dé…) ne laisse pas
        // l'annulation précédente accessible : `UNDO_LAST` annule *la dernière*
        // action du siège, jamais une plus ancienne (docs/protocol.md §9).
        if (result.undo) this.undoStack.set(conn.seatId, { seq, entry: result.undo });
        else this.undoStack.delete(conn.seatId);
        // Retenue même quand elle n'est pas annulable, pour que le refus
        // puisse en dire la raison plutôt que d'invoquer le délai.
        this.lastAction.set(conn.seatId, { type: intent.type, at: Date.now() });
      }
      conn.send({ t: 'ack', cid, seq });
    } catch (err) {
      if (err instanceof IntentError) {
        conn.send({ t: 'reject', cid, code: err.code, message: err.message });
        return;
      }
      conn.send({ t: 'reject', cid, code: 'ERR_INTERNAL' as ErrorCode, message: 'Erreur interne.' });
      throw err;
    }
  }

  private handleUndo(seatId: SeatId, cid: string): void {
    const conn = [...this.connections.values()].find((c) => c.seatId === seatId);
    const last = this.undoStack.get(seatId);

    if (!last || Date.now() - last.entry.at > LIMITS.undoWindowMs) {
      // Distinguer « trop tard » de « ça ne s'annule pas » : répondre le délai
      // juste après un mélange laissait croire qu'on avait été trop lent.
      const recent = this.lastAction.get(seatId);
      const irreversible =
        recent !== undefined &&
        Date.now() - recent.at <= LIMITS.undoWindowMs &&
        IRREVERSIBLE_LABELS[recent.type] !== undefined;

      conn?.send({
        t: 'reject',
        cid,
        code: 'ERR_UNDO_UNAVAILABLE',
        message: irreversible
          ? `${IRREVERSIBLE_LABELS[recent.type]} ne s’annule pas.`
          : 'Plus rien à annuler dans les dix dernières secondes.',
      });
      return;
    }
    // Un event postérieur venu d'un autre siège invalide l'annulation : on ne
    // réécrit pas par-dessus l'action de quelqu'un d'autre.
    const conflicting =
      this.lastActorSeq !== null &&
      this.lastActorSeq.seq > last.seq &&
      this.lastActorSeq.seat !== null &&
      this.lastActorSeq.seat !== seatId;
    if (conflicting) {
      conn?.send({
        t: 'reject',
        cid,
        code: 'ERR_UNDO_UNAVAILABLE',
        message: 'Quelqu’un a joué depuis : annulation impossible.',
      });
      return;
    }

    this.undoStack.delete(seatId);
    // Remettre une carte à sa place décale les rangs comme l'en sortir les
    // avait décalés : l'annulation passe donc par le même recollage que les
    // intents (cf. `rankShiftEmissions`), sans quoi elle laisserait derrière
    // elle le désordre qu'elle prétend défaire.
    const ranksBefore = captureZoneOrders(this.state);
    const emissions = [...last.entry.run()];
    emissions.push(...rankShiftEmissions(this.state, ranksBefore));
    const seat = this.state.seats.get(seatId);
    this.commit(seatId, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'UNDONE', undoneSeq: last.seq }),
        log: { text: `${seat?.displayName ?? 'un joueur'} a annulé sa dernière action`, cardIds: [] },
      },
      ...emissions,
    ]);
    conn?.send({ t: 'ack', cid, seq: this.state.seq });
  }

  private lastActorSeq: { seat: SeatId | null; seq: Seq } | null = null;

  private handleCursor(seatId: SeatId, x: number, y: number, holding?: ObjectId): void {
    const cursor: CursorState = { seat: seatId, x, y };
    if (holding) cursor.holding = holding;
    this.cursors.set(seatId, cursor);

    // Agrégation : une seule frame pour toute la table, au plus 20 fois par seconde.
    this.cursorTimer ??= setTimeout(() => {
      this.cursorTimer = null;
      if (this.cursors.size === 0) return;
      const frame: ServerMessage = { t: 'cursors', seats: [...this.cursors.values()] };
      for (const conn of this.connections.values()) conn.send(frame);
    }, 1000 / LIMITS.cursorHz);
  }

  // -------------------------------------------------------------------- envois

  /**
   * Attribue un `seq` à chaque emission, construit une variante par siège et
   * diffuse. Retourne le dernier `seq` attribué, ou null si rien n'a été émis.
   */
  commit(actor: SeatId | null, emissions: Emission[]): Seq | null {
    if (emissions.length === 0) return null;
    let last: Seq | null = null;

    for (const emission of emissions) {
      const seq = ++this.state.seq;
      last = seq;
      const at = Date.now();
      const variants = new Map<SeatId | null, ServerEvent>();

      const audience = emission.audience;
      const recipients =
        audience.kind === 'ALL'
          ? [...this.state.seats.keys()]
          : audience.kind === 'SEAT'
            ? [audience.seat]
            : audience.seats;

      // Le journal est diffusé à toute la table : ses ancres de carte doivent
      // donc supporter le même examen que son texte. Un objet de bibliothèque
      // n'existe pas pour les autres sièges, son identifiant non plus (§2.1).
      const logPayload = emission.log
        ? {
            text: emission.log.text,
            cardIds: emission.log.cardIds.filter((id) => {
              const obj = this.state.objects.get(id);
              return !obj || isEnumerableZone(obj.zone.kind);
            }),
          }
        : null;
      const log = logPayload ? { log: logPayload } : {};

      // L'enregistrement du replay, et rien qu'ici : `commit` est le passage
      // obligé de toute émission, donc le seul endroit où le flux est complet
      // par construction. Le tout sous garde — une partie ne s'arrête pas
      // parce qu'un replay ne s'écrit pas.
      this.recordFrame(emission, seq, at, actor, logPayload);

      for (const seatId of recipients) {
        variants.set(seatId, { t: 'event', seq, at, actor, event: emission.build(seatId), ...log });
      }

      /*
       * **La séquence est dense pour tout le monde, sans exception.**
       *
       * Chaque `seq` donne lieu à un message pour chaque siège : l'event réel
       * s'il est dans l'audience, un `NOTED` sans charge utile sinon. Ce
       * remplissage était autrefois conditionné à la présence d'une ligne de
       * journal, et c'est ce conditionnement qui coûtait cher : un
       * `LOOK_RESULT`, adressé au seul consultant et sans journal, ne laissait
       * rien aux autres sièges pour son `seq`. L'event suivant arrivait donc en
       * trou de séquence chez eux, chacun déclenchait un `resync`, et chaque
       * `hello/delta` rejouait les mêmes lignes de journal — d'où un message vu
       * trois fois.
       *
       * `NOTED` ne dit rien de plus que « un seq s'est produit », ce que le
       * trou révélait déjà, en pire : il ne peut donc rien faire fuiter. La
       * ligne de journal, elle, reste publique par construction (§4.2) et
       * voyage avec le remplissage.
       */
      for (const seatId of this.state.seats.keys()) {
        if (variants.has(seatId)) continue;
        variants.set(seatId, { t: 'event', seq, at, actor, event: { type: 'NOTED' }, ...log });
      }

      this.buffer.set(seq, variants);
      if (this.buffer.size > LIMITS.eventBuffer) {
        this.buffer.delete(this.state.seq - LIMITS.eventBuffer);
      }

      if (emission.log) {
        const entry: LogEntry = { seq, at, actor, text: emission.log.text, cardIds: emission.log.cardIds };
        this.state.log.push(entry);
        if (this.state.log.length > 1000) this.state.log.shift();
        this.pendingLog.push(entry);
      }

      for (const conn of this.connections.values()) {
        if (!conn.seatId) continue;
        const event = variants.get(conn.seatId);
        if (!event) continue;
        conn.send(event);
        conn.lastSeq = seq;
      }
    }

    // Un commit système (déconnexion, balayage) n'est l'action de personne :
    // il ne doit ni voler la place du dernier auteur, ni bloquer son annulation.
    if (actor !== null || this.lastActorSeq === null) this.lastActorSeq = { seat: actor, seq: last! };
    this.state.lastActivityAt = Date.now();
    this.flushLog();

    /*
     * **Le dessus révélé se recalcule ici, et nulle part ailleurs.**
     *
     * Une bibliothèque révélée en permanence change de dessus à chaque pioche,
     * chaque meule, chaque mélange, chaque scry résolu, chaque annulation.
     * Accrocher un rappel à chaque intent concerné reviendrait à tenir une
     * liste : le jour où l'on en oublie un, la table affiche en permanence une
     * carte qui n'est plus là. `commit` est le passage obligé de **toute**
     * mutation diffusée — c'est donc le seul endroit où ce calcul est complet
     * par construction.
     *
     * Les events qui en sortent sont commités à leur tour, sans auteur : ce
     * n'est l'action de personne, seulement la conséquence de la précédente. Le
     * garde-fou empêche la récursion — la réconciliation est idempotente, mais
     * s'appeler elle-même n'a aucun sens.
     */
    if (!this.reconciling) {
      this.reconciling = true;
      try {
        const follow = reconcileTopReveals(this.state);
        if (follow.length > 0) this.commit(null, follow);
      } finally {
        this.reconciling = false;
      }
    }
    return last;
  }

  /** Vrai pendant la réconciliation des dessus révélés : voir `commit`. */
  private reconciling = false;

  /**
   * Enregistre un pas, et referme l'enregistrement sur `GAME_ENDED`.
   *
   * Tout est enveloppé : construire la variante omnisciente appelle du code de
   * moteur, et une exception venue de là ferait échouer un intent parfaitement
   * valide. Le replay est un témoin de la partie, jamais une condition de son
   * déroulement — s'il tombe, il tombe seul.
   */
  private recordFrame(
    emission: Emission,
    seq: Seq,
    at: number,
    actor: SeatId | null,
    log: { text: string; cardIds: ObjectId[] } | null,
  ): void {
    const recorder = this.recorder;
    if (!recorder || recorder.isClosed) return;
    try {
      const frame = frameOf(this.state, emission, seq, at, actor, log ?? undefined);
      recorder.record(frame);
      // La fin de partie referme l'enregistrement **après** l'avoir inscrite :
      // un replay qui s'arrête juste avant sa dernière ligne serait frustrant.
      if (frame.event.type === 'GAME_ENDED') recorder.close(frame.event.reason);
    } catch {
      // Silence volontaire : cf. commentaire ci-dessus.
    }
  }

  /**
   * Ouvre l'enregistrement de la partie qui vient de commencer.
   *
   * Appelé **après** le commit de `GAME_STARTED` et des mains d'ouverture :
   * le point zéro est donc la table telle qu'elle est au premier tour, decks
   * mélangés et mains distribuées. Partir de l'event zéro aurait voulu dire
   * rejouer aussi le salon — les chargements de deck, les allées et venues de
   * sièges — pour arriver au même endroit, avec en prime la difficulté que
   * `START_GAME` réattribue tous les identifiants au mélange.
   */
  private openReplay(): void {
    const sink = this.hooks.replaySink;
    if (!sink) return;
    try {
      this.recorder?.close('RESTART');
      this.recorder = new ReplayRecorder(this.state.roomId, this.state.seq, sink, this.state);
    } catch {
      this.recorder = null;
    }
  }

  /**
   * Referme l'enregistrement d'une partie qu'aucun `GAME_ENDED` n'a close.
   *
   * C'est le cas de la table abandonnée : plus personne n'est connecté, le
   * balayage la libère, et sans cet appel son enregistrement resterait ouvert
   * — donc illisible — pour toujours. Voir `sweepRooms`.
   */
  abandonReplay(reason = 'TIMEOUT'): void {
    try {
      this.recorder?.close(reason);
    } catch {
      /* ignoré : voir `recordFrame` */
    }
    this.recorder = null;
  }

  /** Mesure de l'enregistrement en cours. Sert aux tests et au rapport de coût. */
  get replayStats(): ReplayRecorder['stats'] | null {
    return this.recorder ? this.recorder.stats : null;
  }

  private flushLog(): void {
    if (this.pendingLog.length === 0 || !this.hooks.persistLog) return;
    const entries = this.pendingLog;
    this.pendingLog = [];
    this.hooks.persistLog(this.state.roomId, entries);
  }

  /** Abandonne les consultations laissées en plan par un joueur déconnecté. */
  sweepLooks(): void {
    for (const look of [...this.state.pendingLooks.values()]) {
      const seat = this.state.seats.get(look.seat);
      // §6.4 : « auto-annulée après 120 s de déconnexion ». Le délai court donc
      // depuis la coupure du socket, pas depuis l'ouverture de la consultation —
      // sinon un joueur qui réfléchit longtemps puis tombe la perd aussitôt.
      if (!seat || seat.connected || seat.disconnectedAt === null) continue;
      if (Date.now() - seat.disconnectedAt <= LIMITS.lookAbandonMs) continue;

      this.state.pendingLooks.delete(look.id);
      for (const id of look.cardIds) this.state.objects.get(id)?.knownTo.delete(look.seat);
      this.commit(null, [
        {
          audience: { kind: 'ALL' },
          build: () => ({
            type: 'LOOK_RESOLVED',
            lookId: look.id,
            seat: look.seat,
            summary: {
              mode: look.mode,
              count: look.cardIds.length,
              toTop: look.cardIds.length,
              toBottom: 0,
              toHand: 0,
              toGraveyard: 0,
              toExile: 0,
              toBattlefield: 0,
              toSideboard: 0,
              shuffled: false,
            },
          }),
          log: { text: `Consultation abandonnée par ${seat.displayName}`, cardIds: [] },
        },
      ]);
    }
  }
}

/**
 * État client de la partie.
 *
 * Le client ne décide rien : il applique les events reçus, dans l'ordre des
 * `seq`. Un trou de séquence déclenche une resynchronisation plutôt qu'une
 * réparation à l'aveugle.
 */
import { create } from 'zustand';
import type {
  CardView,
  CursorState,
  Event,
  Label,
  LookMode,
  LogEntry,
  ObjectId,
  PublicCardView,
  SeatId,
  SeatSummary,
  ServerMessage,
  Snapshot,
  ZoneRef,
} from '@mtg/shared';
import type { Intent } from '@mtg/shared';
import { GameSocket, type SocketStatus } from '../net/socket.js';
import { requestCard } from '../lib/cards.js';
import { DRAG_THRESHOLD, dragPointer } from '../lib/drag.js';

export interface ChatBubble {
  id: number;
  seat: SeatId;
  text: string;
  at: number;
}

interface GameStore {
  socket: GameSocket | null;
  status: SocketStatus;
  statusDetail: string | null;
  seq: number;
  mySeat: SeatId | null;
  roomCode: string | null;
  room: Snapshot['room'] | null;
  /** Dernière fin de partie reçue, tant qu'elle n'a pas été acquittée. */
  gameOver: { reason: 'CONCEDE' | 'HOST' | 'TIMEOUT'; winners: SeatId[] } | null;
  turn: Snapshot['turn'];
  seats: SeatSummary[];
  cards: Map<ObjectId, CardView>;
  zoneCounts: Map<string, number>;
  labels: Label[];
  log: LogEntry[];
  cursors: CursorState[];
  chat: ChatBubble[];
  pendingLook: { lookId: string; mode: LookMode; cards: PublicCardView[] } | null;
  /** Révélation publique en cours (pour spectateurs / adversaires). */
  publicReveal: { seat: SeatId; lookId: string; cards: PublicCardView[] } | null;
  /**
   * Consultations en cours, par siège. `LOOK_STARTED` est public par
   * construction (§6.4) : une table doit savoir qu'un joueur regarde sa
   * bibliothèque, ne serait-ce que pour comprendre pourquoi il ne joue pas.
   */
  looksInProgress: Map<SeatId, LookMode>;
  /** Sièges dont la main est révélée, et donc annoncée comme telle à tous. */
  handsRevealed: Set<SeatId>;
  /**
   * Dessus de bibliotheque reveles en permanence, par siege proprietaire.
   *
   * `cardId` n'est renseigne que si l'on fait partie des destinataires ; la
   * carte elle-meme vit dans `cards`, comme toutes les autres. Un siege non
   * destinataire connait donc le fait, jamais la carte.
   */
  topReveals: Map<SeatId, { toSeats: SeatId[]; cardId: ObjectId | null }>;
  lastReject: string | null;
  /** Sélection courante sur la table, pour les actions groupées. */
  selection: Set<ObjectId>;
  /**
   * Carte actuellement sous le curseur. C'est la cible par défaut des
   * raccourcis contextuels ; elle est posée par `CardSprite` au survol et
   * nettoyée dès que la carte disparaît ou change de zone.
   */
  hoveredCardId: ObjectId | null;
  setHovered: (cardId: ObjectId | null) => void;
  /**
   * Impression survolée **hors de la table** : recherche de jeton, étagère,
   * main révélée d'un adversaire.
   *
   * Pourquoi un second chemin plutôt que `hoveredCardId` ? Parce que ces
   * endroits-là ne montrent pas tous des objets de partie. Un résultat de
   * recherche de jeton n'existe nulle part dans `cards` : c'est une impression
   * Scryfall, elle n'a qu'un `scryfallId`, et lui fabriquer un faux `ObjectId`
   * pour le faire entrer dans le moule serait mentir au reste du client —
   * `Shortcuts` ferait porter « jouer la carte survolée » sur une carte qui
   * n'est pas en jeu.
   *
   * L'aperçu préfère toujours l'objet de partie quand il y en a un : lui seul
   * porte l'état (engagé, retourné, marqueurs). Cette valeur-ci ne dit qu'une
   * chose : « montre cette face-là ».
   */
  hoveredPreview: { scryfallId: string } | null;
  /**
   * Arme (ou désarme) l'aperçu d'une impression. L'apparition est différée ;
   * `null` efface immédiatement.
   */
  hoverPreview: (scryfallId: string | null) => void;
  /**
   * Glisser-déposer en cours. Il vit dans le store et non dans la table, parce
   * qu'on traîne une carte depuis la main, le cimetière ou le champ de bataille,
   * et qu'on la dépose n'importe où : un seul état pour tous les points de départ.
   *
   * Il ne porte que ce qui change rarement — quelle carte, et si le seuil de
   * glissement est franchi. La position du pointeur est dans `dragPointer`
   * (`lib/drag.ts`), hors de React : sinon chaque `pointermove` re-rendrait la
   * table entière.
   */
  drag: { cardId: ObjectId; moved: boolean } | null;
  /**
   * Positions prédites localement, en attente de confirmation du serveur.
   *
   * Seul le déplacement d'une carte sur un champ de bataille est prédit — le
   * protocole (§10) l'autorise explicitement, parce que c'est purement
   * cosmétique et réversible. Rien d'autre ne l'est : ni pioche, ni mélange, ni
   * changement de zone.
   */
  predicted: Map<ObjectId, { x: number; y: number }>;
  /** Échelle courante du plan de table, nécessaire au calcul des dépôts. */
  viewScale: number;
  /**
   * Geste d'accrochage en attente. C'est un état **purement local** : il ne
   * décrit rien de la partie, seulement « j'ai désigné une source, j'attends
   * que l'on me désigne une cible ». Le serveur n'en sait rien tant que le
   * clic de cible n'a pas produit son `ATTACH` (ou son `SET_LABEL`).
   *
   * Il existe parce qu'attacher demande deux objets, et qu'un menu contextuel
   * n'en connaît qu'un. L'ancienne version devinait le second dans la
   * sélection courante : sans sélection — le cas normal — elle n'envoyait
   * rien du tout, en silence.
   */
  attachPending: { kind: 'CARD'; sourceId: ObjectId } | { kind: 'LABEL'; labelId: ObjectId } | null;
  beginAttach: (pending: NonNullable<GameStore['attachPending']>) => void;
  cancelAttach: () => void;
  beginDrag: (cardId: ObjectId, clientX: number, clientY: number) => void;
  /** Met à jour la position du pointeur ; ne re-rend que si le seuil est franchi. */
  updateDrag: (clientX: number, clientY: number) => void;
  endDrag: () => void;
  /** Applique une position prédite et retient le `cid` qui la confirmera. */
  predictMove: (cardId: ObjectId, x: number, y: number, cid: string | null) => void;
  setViewScale: (scale: number) => void;
  /** Menu contextuel ouvert, partagé entre la table et la main. */
  menu:
    | { kind: 'CARD'; card: CardView; x: number; y: number }
    | { kind: 'ZONE'; zone: ZoneRef; x: number; y: number }
    /**
     * Menu du fond de table. Il porte le point cliqué dans trois repères :
     * l'écran pour se placer, le monde pour une étiquette, et le champ de
     * bataille local pour un jeton — qui naît toujours chez son créateur.
     */
    | {
        kind: 'TABLE';
        x: number;
        y: number;
        worldX: number;
        worldY: number;
        local: { x: number; y: number } | null;
      }
    | null;
  openMenu: (menu: GameStore['menu']) => void;

  connect: (code: string) => void;
  disconnect: () => void;
  /** Renvoie le `cid` de l'intent, pour qui veut réconcilier une prédiction. */
  send: (intent: Intent) => string | null;
  setSelection: (ids: Set<ObjectId>) => void;
  toggleSelected: (id: ObjectId, additive: boolean) => void;
  dismissReject: () => void;
  dismissGameOver: () => void;
}

export function zoneKey(zone: ZoneRef): string {
  return `${zone.seat}|${zone.kind}`;
}

let chatSeq = 0;

/**
 * Bulle éphémère au centre de la table : chat, dé, pièce.
 *
 * Un jet de dé n'a de sens que si toute la table le voit au moment où il
 * tombe ; une ligne de journal arrive trop tard et trop loin.
 */
function pushBubble(set: Setter, get: Getter, seat: SeatId, text: string, ms = 4000): void {
  const bubble: ChatBubble = { id: ++chatSeq, seat, text, at: Date.now() };
  set({ chat: [...get().chat.slice(-20), bubble] });
  window.setTimeout(() => {
    set({ chat: useGame.getState().chat.filter((c) => c.id !== bubble.id) });
  }, ms);
}

/** `cid` d'intent → carte dont il confirmera ou infirmera la prédiction. */
const pendingPredictions = new Map<string, ObjectId>();
const PREDICTION_TTL_MS = 4000;

/**
 * Garde contre les resyncs multiples.
 *
 * Quand un event est émis vers un sous-ensemble de sièges (ex. `LOOK_RESULT`
 * vers le joueur actif seul, sans log ni `NOTED`), les autres sièges ne
 * reçoivent rien pour ce `seq` : le suivant crée un trou de séquence qui
 * déclenche un `resync`. Si le commit qui suit produit plusieurs events,
 * chacun arrive en trou et chacun appelle `resync` — et chaque réponse
 * `hello/delta` rejoue les mêmes logs, d'où la duplication.
 *
 * Ce drapeau bloque les appels supplémentaires tant que le premier resync
 * n'a pas été résolu par un `hello`.
 */
let resyncPending = false;

/** Oublie une prédiction : l'état affiché redevient celui du dernier event. */
function dropPrediction(cardId: ObjectId): void {
  const predicted = useGame.getState().predicted;
  if (!predicted.has(cardId)) return;
  const next = new Map(predicted);
  next.delete(cardId);
  useGame.setState({ predicted: next });
}

/**
 * L'état propre à une table, remis à neuf.
 *
 * Le store est global et traverse les changements de page : tout ce qui décrit
 * *une* table doit donc être effacé à l'entrée dans une autre, faute de quoi
 * la suivante commence avec le siège, les cartes et le journal de la
 * précédente.
 */
function blankRoomState(): Pick<
  GameStore,
  | 'status' | 'statusDetail' | 'seq' | 'mySeat' | 'roomCode' | 'room' | 'gameOver'
  | 'turn' | 'seats' | 'cards' | 'zoneCounts' | 'labels' | 'log' | 'cursors' | 'chat'
  | 'pendingLook' | 'publicReveal' | 'looksInProgress' | 'handsRevealed' | 'topReveals' | 'lastReject' | 'selection'
  | 'hoveredCardId' | 'hoveredPreview' | 'drag' | 'predicted' | 'attachPending' | 'menu'
> {
  // Un aperçu armé mais pas encore affiché ne doit pas surgir dans la table
  // suivante : le survol qui l'a demandé n'existe plus.
  if (previewTimer !== null) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  // Une table neuve n'attend le `hello` de personne : garder le drapeau armé
  // interdirait le premier resync de la suivante.
  resyncPending = false;
  return {
    status: 'closed',
    statusDetail: null,
    seq: 0,
    mySeat: null,
    roomCode: null,
    room: null,
    gameOver: null,
    turn: { activeSeat: null, turnNumber: 0, phase: 'MAIN1' },
    seats: [],
    cards: new Map(),
    zoneCounts: new Map(),
    labels: [],
    log: [],
    cursors: [],
    chat: [],
    pendingLook: null,
    publicReveal: null,
    looksInProgress: new Map(),
    handsRevealed: new Set(),
    topReveals: new Map(),
    lastReject: null,
    selection: new Set(),
    hoveredCardId: null,
    hoveredPreview: null,
    drag: null,
    predicted: new Map(),
    attachPending: null,
    menu: null,
  };
}

/**
 * Délai avant qu'un aperçu d'impression apparaisse.
 *
 * Il ne sert pas à ménager la machine, il sert à l'œil : en balayant une grille
 * de résultats de recherche, on survole huit vignettes en une seconde, et un
 * aperçu qui s'affiche à chacune d'elles n'est plus qu'un clignotement. Passé
 * ce délai, c'est qu'on s'est arrêté sur une carte — donc qu'on veut la lire.
 * Court quand même : au-delà, on a l'impression que rien ne répond.
 */
const PREVIEW_DELAY_MS = 160;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

export const useGame = create<GameStore>((set, get) => ({
  socket: null,
  status: 'closed',
  statusDetail: null,
  seq: 0,
  mySeat: null,
  roomCode: null,
  room: null,
  gameOver: null,
  turn: { activeSeat: null, turnNumber: 0, phase: 'MAIN1' },
  seats: [],
  cards: new Map(),
  zoneCounts: new Map(),
  labels: [],
  log: [],
  cursors: [],
  chat: [],
  pendingLook: null,
  publicReveal: null,
  looksInProgress: new Map(),
  handsRevealed: new Set(),
  topReveals: new Map(),
  lastReject: null,
  selection: new Set(),
  hoveredCardId: null,
  hoveredPreview: null,
  drag: null,
  predicted: new Map(),
  viewScale: 0.8,
  attachPending: null,
  menu: null,

  connect(code) {
    get().socket?.close();
    const socket = new GameSocket(code, {
      currentSeq: () => get().seq,
      onStatus: (status, detail) => {
        // Le resync demandé sur l'ancienne socket ne reviendra jamais : sans
        // cette remise à zéro, le drapeau resterait armé et le client ne
        // redemanderait plus jamais de rattrapage après la reconnexion.
        if (status !== 'open') resyncPending = false;
        set({ status, statusDetail: detail ?? null });
      },
      onMessage: (message) => handleMessage(message, set, get),
    });
    // Une table n'hérite jamais de la précédente. Le store est global et
    // survit à la navigation d'une page à l'autre : sans cette remise à zéro,
    // `mySeat` restait celui de la table qu'on venait de quitter, et
    // `RoomPage` — qui n'affiche le salon que si `mySeat` est nul — servait la
    // table au lieu de demander le nom et le deck. On repartait « assis » à
    // une table où l'on n'avait jamais pris place, avec le panneau, le journal
    // et les cartes de l'ancienne.
    set({ ...blankRoomState(), socket, roomCode: code });
    socket.connect();
  },

  disconnect() {
    get().socket?.close();
    set({ ...blankRoomState(), socket: null });
  },

  send(intent) {
    // Hors ligne, un intent est **perdu** : le socket ne l'empile pas, et le
    // serveur ne le verra jamais. Rendre un `cid` comme si de rien n'était
    // faisait croire à l'appelant — et au joueur — que l'action était partie ;
    // pire, une prédiction locale s'installait sur un intent inexistant.
    const status = get().status;
    if (status !== 'open') {
      set({ lastReject: 'Hors ligne — action non envoyée. Elle n’est pas mise en attente.' });
      return null;
    }
    const cid = get().socket?.send(intent) ?? null;
    if (cid === null) {
      set({ lastReject: 'Action non envoyée : la connexion vient de tomber.' });
    }
    return cid;
  },

  setSelection(ids) {
    set({ selection: ids });
  },

  toggleSelected(id, additive) {
    const selection = new Set(additive ? get().selection : []);
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    set({ selection });
  },

  setHovered(cardId) {
    if (get().menu !== null && cardId !== null) return;
    if (get().hoveredCardId === cardId) return;
    set({ hoveredCardId: cardId });
  },

  hoverPreview(scryfallId) {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (scryfallId === null) {
      // La sortie du survol est immédiate : laisser traîner un aperçu de ce
      // qu'on ne montre plus du doigt, c'est le rendre faux.
      if (get().hoveredPreview !== null) set({ hoveredPreview: null });
      return;
    }
    // Si un menu est ouvert, ne pas déclencher d'aperçu qui masquerait le menu
    if (get().menu !== null) return;
    if (get().hoveredPreview?.scryfallId === scryfallId) return;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (get().menu !== null) return;
      set({ hoveredPreview: { scryfallId } });
    }, PREVIEW_DELAY_MS);
  },

  beginDrag(cardId, clientX, clientY) {
    dragPointer.x = clientX;
    dragPointer.y = clientY;
    dragPointer.startX = clientX;
    dragPointer.startY = clientY;
    set({ drag: { cardId, moved: false }, menu: null });
  },

  updateDrag(clientX, clientY) {
    dragPointer.x = clientX;
    dragPointer.y = clientY;
    const drag = get().drag;
    if (!drag || drag.moved) return;
    // Un appui ne devient un glissement qu'au-delà de quelques pixels, sinon un
    // simple clic partirait en glisser-déposer. C'est le seul écrit dans le
    // store de toute la durée du geste : un, pas un par frame.
    const far = Math.hypot(clientX - dragPointer.startX, clientY - dragPointer.startY) > DRAG_THRESHOLD;
    if (far) set({ drag: { ...drag, moved: true } });
  },

  endDrag() {
    set({ drag: null });
  },

  predictMove(cardId, x, y, cid) {
    const predicted = new Map(get().predicted);
    predicted.set(cardId, { x, y });
    set({ predicted });
    if (cid) pendingPredictions.set(cid, cardId);

    // Filet : si ni `ack` ni `reject` n'arrive — socket coupé en plein geste —
    // la prédiction ne doit pas survivre indéfiniment à l'état réel.
    window.setTimeout(() => dropPrediction(cardId), PREDICTION_TTL_MS);
  },

  setViewScale(scale) {
    set({ viewScale: scale });
  },

  beginAttach(pending) {
    // Le menu qui a lancé le geste doit disparaître : la cible se clique sur
    // la table, et un menu ouvert par-dessus intercepterait ce clic.
    set({ attachPending: pending, menu: null });
  },

  cancelAttach() {
    if (!get().attachPending) return;
    set({ attachPending: null });
  },

  openMenu(menu) {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    if (menu) {
      set({ menu, hoveredCardId: null, hoveredPreview: null });
    } else {
      set({ menu });
    }
  },

  dismissReject() {
    set({ lastReject: null });
  },

  dismissGameOver() {
    set({ gameOver: null });
  },
}));

type Setter = (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;
type Getter = () => GameStore;

/**
 * Exporté pour les tests : c'est le seul point d'entrée de tout ce que le
 * serveur dit à ce client, et les règles de rattrapage (trou de séquence,
 * déduplication du journal) ne s'observent nulle part ailleurs.
 */
export function handleMessage(message: ServerMessage, set: Setter, get: Getter): void {
  switch (message.t) {
    case 'hello': {
      resyncPending = false;
      if (message.snapshot) {
        applySnapshot(message.snapshot, message.seat, set);
      } else if (message.delta) {
        // Les `seq` déjà connus : un resync en vol peut se chevaucher avec des
        // events reçus entre-temps, et le delta les rejouerait en double.
        const knownSeqs = new Set(get().log.map((e) => e.seq));
        for (const event of message.delta) {
          applyEvent(event.event, set, get);
          set({ seq: event.seq });
          if (event.log && !knownSeqs.has(event.seq)) {
            knownSeqs.add(event.seq);
            set({
              log: [
                ...get().log.slice(-400),
                { seq: event.seq, at: event.at, actor: event.actor, ...event.log },
              ],
            });
          }
        }
        if (message.seat) set({ mySeat: message.seat });
      }
      return;
    }

    case 'event': {
      const expected = get().seq + 1;
      if (message.seq < expected) return; // déjà appliqué
      if (message.seq > expected && get().seq > 0) {
        // Trou de séquence : on demande le rattrapage plutôt que de bricoler.
        // Un seul resync suffit : les suivants n'apporteraient que des doublons.
        if (!resyncPending) {
          resyncPending = true;
          get().socket?.resync(get().seq);
        }
        return;
      }
      applyEvent(message.event, set, get);
      set({ seq: message.seq });
      if (message.log) {
        const entry: LogEntry = {
          seq: message.seq,
          at: message.at,
          actor: message.actor,
          text: message.log.text,
          cardIds: message.log.cardIds,
        };
        set({ log: [...get().log.slice(-400), entry] });
      }
      return;
    }

    case 'cursors': {
      // 20 Hz, en permanence. Remplacer le tableau à chaque frame ferait
      // re-rendre tout ce qui y est abonné même quand rien n'a bougé — et dans
      // une partie à un siège, la liste est vide à chaque fois.
      const next = message.seats.filter((c) => c.seat !== get().mySeat);
      if (sameCursors(get().cursors, next)) return;
      set({ cursors: next });
      return;
    }

    case 'ack': {
      // L'intent est passé : la prédiction sera levée par l'event qui suit,
      // lequel porte la position faisant autorité.
      pendingPredictions.delete(message.cid);
      return;
    }

    case 'reject': {
      // Le serveur refuse : on rend sa place à la carte, telle que le dernier
      // event la connaît.
      const predictedCard = pendingPredictions.get(message.cid);
      if (predictedCard) {
        pendingPredictions.delete(message.cid);
        dropPrediction(predictedCard);
      }
      set({ lastReject: message.message });
      return;
    }

    case 'error':
      set({ statusDetail: message.message });
      // Une erreur non fatale n'est affichée nulle part : `statusDetail` n'est
      // rendu que sur un statut fatal. On la route donc vers le bandeau de
      // refus, qui est fait pour être lu.
      if (!message.fatal) set({ lastReject: message.message });
      return;

    default:
      return;
  }
}

/** Deux frames de curseurs sont-elles indiscernables à l'écran ? */
function sameCursors(a: CursorState[], b: CursorState[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.seat !== y.seat || x.x !== y.x || x.y !== y.y || x.holding !== y.holding) return false;
  }
  return true;
}

function applySnapshot(snapshot: Snapshot, seat: SeatId | null, set: Setter): void {
  const cards = new Map<ObjectId, CardView>();
  for (const card of snapshot.cards) {
    cards.set(card.id, card);
    if (card.faceDown === false) requestCard(card.scryfallId);
  }

  const zoneCounts = new Map<string, number>();
  for (const z of snapshot.zoneCounts) zoneCounts.set(zoneKey(z.zone), z.count);

  set({
    seq: snapshot.seq,
    room: snapshot.room,
    turn: snapshot.turn,
    seats: snapshot.seats,
    cards,
    zoneCounts,
    labels: snapshot.labels,
    log: snapshot.logTail,
    pendingLook: snapshot.pendingLook ?? null,
    // Un snapshot remplace l'état : ce qui n'y figure pas n'a plus cours.
    looksInProgress: new Map(),
    handsRevealed: new Set(),
    topReveals: new Map(
      (snapshot.topReveals ?? []).map((t) => [t.seat, { toSeats: t.toSeats, cardId: t.cardId }]),
    ),
    // Le snapshot fait autorité, y compris quand il ne donne aucun siège :
    // une connexion sans siège (§13.4) doit ramener le client au salon, pas
    // conserver le siège d'avant.
    mySeat: seat,
  });
}

function upsertCard(set: Setter, get: Getter, card: CardView): void {
  const cards = new Map(get().cards);
  const before = cards.get(card.id);
  cards.set(card.id, card);
  if (card.faceDown === false) requestCard(card.scryfallId);
  set({ cards });
  // Le serveur a parlé sur cette carte : sa position prédite n'a plus lieu d'être.
  if (get().predicted.has(card.id)) dropPrediction(card.id);
  // Une carte qui change de zone n'est plus le sprite que l'on survolait : son
  // `pointerleave` n'aura jamais lieu, donc on le fait à sa place.
  if (before && zoneKey(before.zone) !== zoneKey(card.zone)) forgetHover(set, get, card.id);
  pruneHover(set, get);
}

/** Oublie le survol s'il porte sur cette carte. */
function forgetHover(set: Setter, get: Getter, cardId: ObjectId): void {
  if (get().hoveredCardId === cardId) set({ hoveredCardId: null });
}

/** Oublie le survol si la carte n'existe plus du tout. */
function pruneHover(set: Setter, get: Getter): void {
  const id = get().hoveredCardId;
  if (id && !get().cards.has(id)) set({ hoveredCardId: null });
}

function bumpSeat(set: Setter, get: Getter, seatId: SeatId, patch: Partial<SeatSummary>): void {
  set({ seats: get().seats.map((s) => (s.id === seatId ? { ...s, ...patch } : s)) });
}

function recountZones(set: Setter, get: Getter): void {
  // Les comptes de zones publiques se déduisent des cartes connues ; les zones
  // cachées, elles, ne bougent que sur ZONE_COUNT, qui fait autorité.
  const counts = new Map(get().zoneCounts);
  const seen = new Map<string, number>();
  for (const card of get().cards.values()) {
    const key = zoneKey(card.zone);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (key.endsWith('|LIBRARY')) continue;
    counts.set(key, count);
  }
  set({ zoneCounts: counts });
}

function applyEvent(event: Event, set: Setter, get: Getter): void {
  switch (event.type) {
    case 'CARD_MOVED':
    case 'CARD_UPDATED':
      upsertCard(set, get, event.card);
      recountZones(set, get);
      return;

    case 'CARDS_MOVED': {
      const cards = new Map(get().cards);
      for (const card of event.cards) {
        cards.set(card.id, card);
        if (card.faceDown === false) requestCard(card.scryfallId);
      }
      set({ cards });
      recountZones(set, get);
      pruneHover(set, get);
      return;
    }

    case 'CARD_REVEALED':
      upsertCard(set, get, event.card);
      return;

    case 'TOKENS_CREATED': {
      const cards = new Map(get().cards);
      for (const card of event.cards) {
        cards.set(card.id, card);
        requestCard(card.scryfallId);
      }
      set({ cards });
      return;
    }

    case 'TOKENS_DESTROYED':
    case 'CARD_HIDDEN': {
      const cards = new Map(get().cards);
      const ids = event.type === 'CARD_HIDDEN' ? [event.cardId] : event.cardIds;
      for (const id of ids) cards.delete(id);
      set({ cards });
      pruneHover(set, get);
      return;
    }

    case 'ATTACHED':
    case 'DETACHED': {
      const cards = new Map(get().cards);
      const source = cards.get(event.sourceId);
      if (source) {
        cards.set(event.sourceId, {
          ...source,
          attachedTo: event.type === 'ATTACHED' ? event.targetId : undefined,
        } as CardView);
      }
      set({ cards });
      return;
    }

    case 'ZONE_COUNT': {
      const counts = new Map(get().zoneCounts);
      counts.set(zoneKey(event.zone), event.count);
      set({ zoneCounts: counts });
      return;
    }

    case 'ZONE_SHUFFLED': {
      // Les identifiants de la zone sont réattribués : on oublie ce qu'on en savait.
      const cards = new Map(get().cards);
      for (const [id, card] of cards) {
        if (zoneKey(card.zone) === zoneKey(event.zone)) cards.delete(id);
      }
      const counts = new Map(get().zoneCounts);
      counts.set(zoneKey(event.zone), event.count);
      set({ cards, zoneCounts: counts, pendingLook: null });
      pruneHover(set, get);
      return;
    }

    case 'LOOK_STARTED': {
      const looks = new Map(get().looksInProgress);
      looks.set(event.seat, event.mode);
      if (event.mode === 'REVEAL' && event.cards) {
        for (const card of event.cards) requestCard(card.scryfallId);
        set({
          looksInProgress: looks,
          publicReveal: { seat: event.seat, lookId: event.lookId, cards: event.cards },
        });
      } else {
        set({ looksInProgress: looks });
      }
      return;
    }

    case 'LOOK_RESULT':
      for (const card of event.cards) requestCard(card.scryfallId);
      set({ pendingLook: { lookId: event.lookId, mode: event.mode, cards: event.cards } });
      return;

    case 'LOOK_RESOLVED': {
      if (get().pendingLook?.lookId === event.lookId) {
        get().hoverPreview(null);
        set({ pendingLook: null });
      }
      if (get().publicReveal?.lookId === event.lookId) {
        get().hoverPreview(null);
        set({ publicReveal: null });
      }
      const looks = new Map(get().looksInProgress);
      looks.delete(event.seat);
      set({ looksInProgress: looks });
      return;
    }

    case 'HAND_REVEALED': {
      const cards = new Map(get().cards);
      for (const card of event.cards) {
        cards.set(card.id, card);
        requestCard(card.scryfallId);
      }
      const revealed = new Set(get().handsRevealed);
      revealed.add(event.seat);
      set({ cards, handsRevealed: revealed });
      return;
    }

    case 'HAND_UNREVEALED': {
      const revealed = new Set(get().handsRevealed);
      revealed.delete(event.seat);
      set({ handsRevealed: revealed });
      return;
    }

    /*
     * Le dessus d'une bibliothèque, révélé en permanence.
     *
     * L'event arrive à toute la table, mais `card` n'est renseignée que pour un
     * destinataire : les autres n'en retiennent que le fait. La carte rejoint
     * `cards` comme n'importe quelle autre — c'est la seule carte de
     * bibliothèque qu'un client garde en cours de partie, et elle y est parce
     * qu'elle est révélée. Le serveur envoie un `CARD_HIDDEN` dès qu'elle
     * cesse de l'être, et c'est lui qui la retire d'ici.
     */
    case 'TOP_REVEALED': {
      const reveals = new Map(get().topReveals);
      if (event.toSeats.length === 0) reveals.delete(event.seat);
      else reveals.set(event.seat, { toSeats: event.toSeats, cardId: event.card?.id ?? null });
      set({ topReveals: reveals });
      if (event.card) upsertCard(set, get, event.card);
      return;
    }

    /*
     * Dé et pièce n'existaient que dans le journal, à mille pixels de l'endroit
     * où toute la table regarde. On les rend comme une bulle de chat : au
     * centre, à la couleur du siège, et éphémère.
     */
    case 'DICE_ROLLED':
      pushBubble(set, get, event.seat, `🎲 d${event.sides} : ${event.results.join(', ')}`);
      return;

    case 'COIN_FLIPPED':
      pushBubble(
        set,
        get,
        event.seat,
        `🪙 ${event.results.map((r) => (r === 'HEADS' ? 'pile' : 'face')).join(', ')}`,
      );
      return;

    /*
     * `NOTED` est un no-op, et c'est tout son intérêt : il ne porte que son
     * `seq` — et la ligne de journal, traitée par l'appelant. Il tient la
     * séquence dense pour un siège hors audience, qui sans lui verrait un trou
     * et demanderait un rattrapage dont il n'a aucun besoin.
     */
    case 'NOTED':
      return;

    case 'UNDONE':
      // L'annulation se rend d'elle-même : le serveur émet derrière elle les
      // events de restauration, qui portent l'état faisant foi. Il n'y a donc
      // rien à appliquer ici — mais le cas est écrit, pour qu'il ne compte pas
      // comme un oubli au prochain passage.
      return;

    case 'LIFE_CHANGED':
      bumpSeat(set, get, event.seat, { life: event.value });
      return;

    case 'COMMANDER_TAX_CHANGED': {
      // Sans ce cas, la taxe montait côté serveur pendant que le joueur lisait
      // toujours « +0 » : le journal annonçait une correction que rien ne
      // rendait à l'écran.
      const seats = get().seats.map((s) =>
        s.id === event.seat
          ? { ...s, commanderTax: { ...s.commanderTax, [event.commanderId]: event.casts } }
          : s,
      );
      set({ seats });
      return;
    }

    case 'COMMANDER_DAMAGE_CHANGED': {
      const seats = get().seats.map((s) => {
        if (s.id !== event.to) return s;
        const damage = { ...s.commanderDamage };
        damage[event.from] = { ...(damage[event.from] ?? {}), [event.commanderId]: event.value };
        return { ...s, commanderDamage: damage };
      });
      set({ seats });
      return;
    }

    case 'PLAYER_COUNTER_CHANGED': {
      const seats = get().seats.map((s) => {
        if (s.id !== event.seat) return s;
        /*
         * Deux défauts tenaient dans les deux lignes précédentes.
         *
         * Le compteur était **retiré puis rajouté en fin de liste** : il
         * changeait donc de place à chaque « +1 », et l'on visait un bouton qui
         * venait de se déplacer. On met désormais à jour sur place.
         *
         * Et la valeur zéro était conservée, alors que le serveur, lui,
         * supprime le compteur : « retirer » le laissait affiché à 0 au lieu de
         * le faire disparaître.
         */
        if (event.value === 0) {
          return { ...s, playerCounters: s.playerCounters.filter((c) => c.kind !== event.kind) };
        }
        const known = s.playerCounters.some((c) => c.kind === event.kind);
        return {
          ...s,
          playerCounters: known
            ? s.playerCounters.map((c) => (c.kind === event.kind ? { ...c, value: event.value } : c))
            : [...s.playerCounters, { kind: event.kind, value: event.value }],
        };
      });
      set({ seats });
      return;
    }

    case 'SEAT_JOINED': {
      const others = get().seats.filter((s) => s.id !== event.seat.id);
      set({ seats: [...others, event.seat].sort((a, b) => a.seatIndex - b.seatIndex) });
      return;
    }

    case 'SEAT_LEFT': {
      set({ seats: get().seats.filter((s) => s.id !== event.seatId) });
      // Si c'est *notre* siège qui s'en va, la page doit le savoir : sans ça
      // l'on restait sur une table dont on ne fait plus partie, et le jeton de
      // siège gardé en mémoire aurait tenté de reprendre une place effacée au
      // premier rechargement.
      if (event.seatId === get().mySeat) {
        const socket = get().socket;
        if (socket) socket.seatToken = null;
        set({ mySeat: null, cards: new Map(), pendingLook: null });
      }
      return;
    }

    case 'SEAT_CONNECTION':
      bumpSeat(set, get, event.seatId, { connected: event.connected });
      return;

    case 'SEAT_COSMETICS':
      // Cosmétique pure, hors séquence de jeu : playmat et dos de carte.
      bumpSeat(set, get, event.seatId, {
        playmatUrl: event.playmatUrl,
        cardBackUrl: event.cardBackUrl,
      });
      return;

    case 'SEAT_CONCEDED':
      bumpSeat(set, get, event.seatId, { conceded: true });
      return;

    case 'DECK_LOADED':
      bumpSeat(set, get, event.seatId, { deckName: event.deckName });
      for (const c of event.commanders) requestCard(c.scryfallId);
      return;

    case 'LABEL_ADDED':
      set({ labels: [...get().labels, event.label] });
      return;

    case 'LABEL_MOVED':
      set({
        labels: get().labels.map((l) => (l.id === event.labelId ? { ...l, x: event.x, y: event.y } : l)),
      });
      return;

    case 'LABEL_UPDATED':
      set({ labels: get().labels.map((l) => (l.id === event.label.id ? event.label : l)) });
      return;

    case 'LABEL_REMOVED':
      set({ labels: get().labels.filter((l) => l.id !== event.labelId) });
      return;

    case 'TURN_ENDED':
      set({ turn: { activeSeat: event.nextSeat, turnNumber: event.turnNumber, phase: 'UNTAP' } });
      return;

    case 'PHASE_CHANGED':
      set({ turn: { ...get().turn, phase: event.phase } });
      return;

    case 'GAME_STARTED':
      set({
        room: get().room ? { ...get().room!, status: 'PLAYING' } : null,
        turn: { activeSeat: event.startingSeat, turnNumber: 1, phase: 'UNTAP' },
      });
      return;

    case 'GAME_ENDED':
      set({
        room: get().room
          ? {
              ...get().room!,
              status: 'ENDED',
              // `reason: 'HOST'` n'est pas une fin de partie, c'est une
              // fermeture : le serveur n'acceptera plus rien, et l'interface
              // doit le savoir sans attendre un nouveau snapshot.
              closed: get().room!.closed || event.reason === 'HOST',
            }
          : null,
        // Le motif sert l'affichage : « l'hôte a clos la table » et « il ne
        // reste qu'un joueur » ne se disent pas de la même façon.
        gameOver: { reason: event.reason, winners: event.winners },
      });
      return;

    case 'CHAT':
      pushBubble(set, get, event.seat, event.text, 8000);
      return;

    default:
      /*
       * Un type d'event inconnu est ignoré, mais son `seq` a déjà été
       * enregistré : le client reste synchrone face à un serveur plus récent.
       *
       * Ce silence a pourtant coûté cher : six events du protocole courant
       * tombaient ici sans que rien ne le signale, dont celui de la taxe de
       * commandant, qui ne bougeait donc jamais à l'écran. En développement,
       * on le dit désormais tout haut.
       */
      if (import.meta.env.DEV) {
        console.warn('[store] event non traité :', (event as { type: string }).type);
      }
      return;
  }
}

/**
 * Le store est exposé pour les tests de bout en bout. Ce n'est pas une faille :
 * il ne contient que ce que le serveur a déjà envoyé à ce client, et rien de
 * plus que ce qui est affiché à l'écran.
 */
declare global {
  interface Window {
    __mtg?: typeof useGame;
  }
}
if (typeof window !== 'undefined') window.__mtg = useGame;

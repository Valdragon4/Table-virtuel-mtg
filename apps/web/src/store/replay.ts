/**
 * Pilote de lecture d'un replay.
 *
 * **Il n'y a pas de second réducteur ici, et c'est le point de conception le
 * plus important du fichier.** Le client sait déjà reconstruire un état à
 * partir d'un snapshot puis d'events : c'est `handleMessage`, dans
 * `store/game.ts`, et c'est exactement ce que fait une table en direct. Le
 * lecteur se contente de lui servir les messages enregistrés, dans l'ordre. En
 * écrire un second aurait garanti la divergence : le jour où les deux ne
 * disent plus la même chose, le replay montre autre chose que ce qui s'est
 * passé, et rien ne le signale.
 *
 * Conséquence directe : la page de replay affiche la **vraie** table, avec ses
 * vrais composants, puisque l'état qu'ils lisent est le même `useGame`.
 */
import { create } from 'zustand';
import type { Event, LogEntry, ObjectId, SeatId, Snapshot } from '@mtg/shared';
import { ApiError, api } from '../lib/api.js';
import { handleMessage, useGame } from './game.js';

/** Un pas, tel que le serveur le sert après projection. */
export interface ReplayStep {
  seq: number;
  at: number;
  actor: SeatId | null;
  event: Event;
  log?: { text: string; cardIds: ObjectId[] };
}

export interface ReplayHead {
  replayId: string;
  roomCode: string;
  view: string;
  views: Array<{ id: SeatId; displayName: string }>;
  snapshot: Snapshot;
  startSeq: number;
  lastSeq: number;
  eventCount: number;
  truncated: boolean;
  chunks: number;
  startedAt: string;
  closedAt: string;
}

/**
 * Points de reprise, un tous les `CHECKPOINT` pas.
 *
 * Reculer d'un pas suppose de rejouer depuis un état connu : le rejeu est
 * unidirectionnel, un event ne s'inverse pas. Repartir chaque fois du point
 * zéro coûterait O(n) par recul, soit plusieurs milliers d'applications sur une
 * longue partie — visible à l'œil sur la flèche maintenue enfoncée. Les points
 * de reprise bornent ce coût à `CHECKPOINT` applications.
 *
 * Ils ne coûtent presque rien en mémoire : `applyEvent` **remplace** ses
 * structures au lieu de les muter (chaque écriture fait un `new Map(...)`), si
 * bien qu'un point de reprise n'est qu'un jeu de références vers des objets qui
 * existent déjà.
 */
const CHECKPOINT = 200;

type Frozen = Pick<
  ReturnType<typeof useGame.getState>,
  | 'seq' | 'room' | 'turn' | 'seats' | 'cards' | 'zoneCounts' | 'labels' | 'log'
  | 'pendingLook' | 'publicReveal' | 'looksInProgress' | 'handsRevealed' | 'topReveals'
  | 'gameOver' | 'chat'
>;

function freeze(): Frozen {
  const s = useGame.getState();
  return {
    seq: s.seq,
    room: s.room,
    turn: s.turn,
    seats: s.seats,
    cards: s.cards,
    zoneCounts: s.zoneCounts,
    labels: s.labels,
    log: s.log,
    pendingLook: s.pendingLook,
    publicReveal: s.publicReveal,
    looksInProgress: s.looksInProgress,
    handsRevealed: s.handsRevealed,
    topReveals: s.topReveals,
    gameOver: s.gameOver,
    chat: s.chat,
  };
}

function thaw(frozen: Frozen): void {
  useGame.setState({ ...frozen, selection: new Set(), menu: null, hoveredCardId: null });
}

interface ReplayStore {
  head: ReplayHead | null;
  steps: ReplayStep[];
  /** Nombre de pas appliqués. 0 = le point zéro, rien n'a encore été joué. */
  cursor: number;
  loading: boolean;
  /** Message d'échec, déjà traduit par l'appelant s'il le souhaite. */
  error: 'NOT_FOUND' | 'NETWORK' | null;
  playing: boolean;

  /**
   * Charge un replay au point de vue demandé, et se place au pas dont le `seq`
   * ne dépasse pas `atSeq`. Omis, on repart du point zéro.
   */
  load: (handle: string, view: string, atSeq?: number | null) => Promise<void>;
  seek: (step: number) => void;
  stepForward: () => void;
  stepBack: () => void;
  setPlaying: (playing: boolean) => void;
  reset: () => void;
}

/** Les points de reprise vivent hors du store : ce ne sont pas des données de rendu. */
let checkpoints: Frozen[] = [];

/**
 * Le `seq` de l'instant affiché — **le seul repère qui traverse un changement
 * de point de vue.**
 *
 * Pas le rang dans la liste : un rang ne désigne un instant que si les deux
 * vues ont exactement les mêmes pas. C'est le cas aujourd'hui — le serveur sert
 * un pas par `seq` quelle que soit la vue, un `NOTED` quand le siège était hors
 * audience, parce que la séquence doit rester dense (docs/protocol.md §5) —
 * mais c'est une propriété du serveur, pas du lecteur. Le jour où elle
 * changerait, un rang désignerait silencieusement un autre moment de la partie.
 * Le `seq`, lui, désigne le même fait de jeu dans toutes les vues, par
 * définition.
 *
 * Au pas zéro, il n'y a pas encore de pas appliqué : c'est le `seq` du point de
 * départ, celui du snapshot d'origine.
 */
export function currentSeq(state: Pick<ReplayStore, 'steps' | 'cursor' | 'head'>): number | null {
  if (!state.head) return null;
  return state.cursor > 0 ? (state.steps[state.cursor - 1]?.seq ?? null) : state.head.startSeq;
}

/**
 * Le rang auquel se placer pour montrer la partie à l'instant `seq`.
 *
 * C'est le nombre de pas dont le `seq` **ne dépasse pas** la cible : le pas le
 * plus proche en deçà, jamais au-delà. Si la vue demandée ne contient pas ce
 * `seq` précis — elle n'a pas reçu ce qui ne la concernait pas —, on montre
 * donc l'état de la partie tel que ce siège le connaissait à cet instant, ce
 * qui est exactement la question posée. Repartir au début serait perdre ce
 * qu'on était venu voir.
 *
 * Recherche dichotomique : les pas sont triés par `seq` croissant, sans trou.
 */
export function cursorForSeq(steps: ReplayStep[], seq: number | null | undefined): number {
  if (seq === null || seq === undefined) return 0;
  let low = 0;
  let high = steps.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((steps[mid]?.seq ?? Number.POSITIVE_INFINITY) <= seq) low = mid + 1;
    else high = mid;
  }
  return low;
}

export const useReplay = create<ReplayStore>((set, get) => ({
  head: null,
  steps: [],
  cursor: 0,
  loading: false,
  error: null,
  playing: false,

  async load(handle, view, atSeq) {
    /*
     * **On ne vide rien avant d'avoir de quoi remplacer.**
     *
     * Un changement de point de vue passe par ici. Effacer `head` et `steps`
     * dès le départ faisait retomber la page sur son écran de chargement : la
     * table disparaissait, puis revenait — et l'instant qu'on était en train
     * de regarder avec elle. On garde donc l'ancien flux à l'écran jusqu'à ce
     * que le nouveau soit prêt, et l'on bascule d'un coup.
     */
    set({ loading: true, error: null, playing: false });
    try {
      const query = view === 'ALL' ? '' : `?view=${encodeURIComponent(view)}`;
      const head = await api.get<ReplayHead>(`/api/replays/${encodeURIComponent(handle)}${query}`);
      const steps: ReplayStep[] = [];
      for (let chunk = 0; chunk < head.chunks; chunk++) {
        const sep = query === '' ? '?' : `${query}&`;
        const page = await api.get<{ frames: ReplayStep[] }>(
          `/api/replays/${encodeURIComponent(handle)}/frames${sep}chunk=${chunk}`,
        );
        steps.push(...page.frames);
      }
      // Les points de reprise décrivent l'ancien flux : ils n'ont plus cours.
      checkpoints = [];
      set({ head, steps, cursor: 0, loading: false });
      bootstrap(head);
      const target = cursorForSeq(steps, atSeq);
      if (target > 0) get().seek(target);
    } catch (error) {
      // Un 404 est la réponse normale à « ce replay n'existe pas *pour vous* » :
      // partie en cours, jeton révoqué, adresse inventée. La page dit la même
      // chose dans les trois cas, parce que le serveur ne les distingue pas.
      const notFound = error instanceof ApiError && error.status === 404;
      set({ loading: false, error: notFound ? 'NOT_FOUND' : 'NETWORK' });
    }
  },

  seek(step) {
    const { steps, head } = get();
    if (!head) return;
    const target = Math.max(0, Math.min(step, steps.length));
    const current = get().cursor;
    if (target === current) return;

    /*
     * Un event ne s'inverse pas : reculer, c'est repartir d'un état connu et
     * réavancer. Le plus proche en deçà est le point de reprise `k`, qui décrit
     * l'état après `(k + 1) * CHECKPOINT` pas ; à défaut, le point zéro.
     */
    let base = current;
    if (target < current) {
      const k = Math.floor(target / CHECKPOINT) - 1;
      const frozen = k >= 0 ? checkpoints[k] : undefined;
      if (frozen) {
        thaw(frozen);
        base = (k + 1) * CHECKPOINT;
      } else {
        bootstrap(head);
        base = 0;
      }
    }

    for (let i = base; i < target; i++) {
      applyStep(steps[i]);
      // Les points de reprise se posent en avançant, et une seule fois : ils
      // décrivent l'état après un nombre de pas donné, quel que soit le chemin.
      const done = i + 1;
      if (done % CHECKPOINT === 0) checkpoints[done / CHECKPOINT - 1] ??= freeze();
    }
    set({ cursor: target });
  },

  stepForward() {
    get().seek(get().cursor + 1);
  },

  stepBack() {
    get().seek(get().cursor - 1);
  },

  setPlaying(playing) {
    set({ playing });
  },

  reset() {
    checkpoints = [];
    set({ head: null, steps: [], cursor: 0, loading: false, error: null, playing: false });
  },
}));

/**
 * Pose l'état de départ dans le store de la table.
 *
 * `mySeat` vaut le siège du point de vue choisi — c'est lui qui décide de la
 * disposition (« ma » main en bas). En vue omnisciente il n'y a pas de « moi » :
 * on prend le premier siège, faute de quoi la table se rendrait comme pour une
 * connexion sans siège, c'est-à-dire vide.
 */
function bootstrap(head: ReplayHead): void {
  const seat = head.view === 'ALL' ? (head.views[0]?.id ?? null) : head.view;
  handleMessage(
    { t: 'hello', protocol: 0, seat, roomCode: head.roomCode, snapshot: head.snapshot },
    useGame.setState,
    useGame.getState,
  );
  // Un replay n'est pas une table : rien ne doit y être annoncé comme
  // « hors ligne », et la fin de partie du flux ne doit pas ouvrir sa modale
  // avant qu'on l'ait rejouée.
  useGame.setState({ status: 'open', statusDetail: null, gameOver: null, lastReject: null });
}

function applyStep(step: ReplayStep | undefined): void {
  if (!step) return;
  handleMessage(
    {
      t: 'event',
      seq: step.seq,
      at: step.at,
      actor: step.actor,
      event: step.event,
      ...(step.log ? { log: step.log } : {}),
    },
    useGame.setState,
    useGame.getState,
  );
}

/** La ligne de journal du pas courant, pour l'afficher au-dessus du transport. */
export function stepLabel(step: ReplayStep | undefined, log: LogEntry[]): string | null {
  if (!step) return null;
  if (step.log) return step.log.text;
  return log.length > 0 ? (log[log.length - 1]?.text ?? null) : null;
}

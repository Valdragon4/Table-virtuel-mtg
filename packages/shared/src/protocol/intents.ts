/** Intents client → serveur. Voir docs/protocol.md §6. */
import type { Counter, LookMode, ObjectId, PhaseName, Rotation, SeatId, ZoneRef } from './core.js';

export interface MoveCard {
  type: 'MOVE_CARD';
  cardId: ObjectId;
  to: ZoneRef;
  index?: number | 'TOP' | 'BOTTOM' | 'RANDOM';
  x?: number;
  y?: number;
  faceDown?: boolean;
  tapped?: boolean;
}

export interface MoveCards {
  type: 'MOVE_CARDS';
  cardIds: ObjectId[];
  to: ZoneRef;
  index?: number | 'TOP' | 'BOTTOM';
  faceDown?: boolean;
}

export interface Tap { type: 'TAP'; cardIds: ObjectId[] }
export interface Untap { type: 'UNTAP'; cardIds: ObjectId[] }
export interface UntapAll { type: 'UNTAP_ALL'; seat?: SeatId }
export interface SetRotation { type: 'SET_ROTATION'; cardId: ObjectId; rotation: Rotation }
export interface FlipFace { type: 'FLIP_FACE'; cardId: ObjectId }
export interface TurnFaceDown { type: 'TURN_FACE_DOWN'; cardId: ObjectId }
export interface TurnFaceUp { type: 'TURN_FACE_UP'; cardId: ObjectId }
export interface PeekFaceDown { type: 'PEEK_FACE_DOWN'; cardId: ObjectId }

/**
 * Pose, change ou retire un marqueur sur une carte.
 *
 * `value` : un nombre le compte, `null` le retire, et **absent** en fait un
 * mot-clé — « vol », « ne se dégage pas » — affiché seul, sans quantité.
 */
export interface SetCounter { type: 'SET_COUNTER'; targetId: ObjectId; kind: string; value?: number | null }
export interface AddCounter { type: 'ADD_COUNTER'; targetId: ObjectId; kind: string; delta: number }
export interface RemoveCounter { type: 'REMOVE_COUNTER'; targetId: ObjectId; kind: string }

export interface Attach { type: 'ATTACH'; sourceId: ObjectId; targetId: ObjectId }
export interface Detach { type: 'DETACH'; sourceId: ObjectId }

export interface AddLabel { type: 'ADD_LABEL'; text: string; x: number; y: number; color?: string; value?: string; attachedTo?: ObjectId }
export interface MoveLabel { type: 'MOVE_LABEL'; labelId: ObjectId; x: number; y: number }
export interface RemoveLabel { type: 'REMOVE_LABEL'; labelId: ObjectId }
/** Modifie une étiquette en place : son texte, sa valeur de compteur, sa couleur. */
export interface SetLabel { type: 'SET_LABEL'; labelId: ObjectId; text?: string; value?: string | null; color?: string; attachedTo?: ObjectId | null }

export interface CreateToken {
  type: 'CREATE_TOKEN';
  scryfallId?: string;
  copyOf?: ObjectId;
  count?: number;
  x?: number;
  y?: number;
  tapped?: boolean;
  counters?: Counter[];
}
export interface DestroyToken { type: 'DESTROY_TOKEN'; cardIds: ObjectId[] }

export interface Shuffle { type: 'SHUFFLE'; zone: ZoneRef }
export interface Look { type: 'LOOK'; zone: ZoneRef; count: number | 'ALL'; mode: LookMode }
export interface ResolveLook {
  type: 'RESOLVE_LOOK';
  lookId: string;
  top: ObjectId[];
  bottom: ObjectId[];
  toHand?: ObjectId[];
  toGraveyard?: ObjectId[];
  toExile?: ObjectId[];
  toBattlefield?: ObjectId[];
  /**
   * Vers la réserve. C'est le geste de sideboard : on fouille son deck avant la
   * partie et l'on met des cartes de côté. Sans lui, sortir une carte du deck
   * demandait de la prendre en main puis de la ranger — deux gestes pour un.
   */
  toSideboard?: ObjectId[];
  /**
   * Exiler **face cachée** les cartes de `toExile`.
   *
   * On exile face cachée depuis n'importe où — c'est le geste de « Bannir »,
   * de « Recherche et exile face cachée » — et une fouille de bibliothèque
   * était la seule zone d'où on ne pouvait pas le faire : `RESOLVE_LOOK`
   * déplaçait toujours face visible. Le pendant de `MOVE_CARD { faceDown }`
   * et de `EXILE_TOP { faceDown }`, ici pour la consultation.
   *
   * Ne porte que sur `toExile` : le reste d'une résolution va en main, au
   * cimetière ou en bibliothèque, où l'état face cachée découle de la zone.
   */
  exileFaceDown?: boolean;
  shuffleAfter?: boolean;
}
export interface ReorderTop { type: 'REORDER_TOP'; zone: ZoneRef; order: ObjectId[] }
export interface Draw { type: 'DRAW'; count: number }
export interface Mulligan { type: 'MULLIGAN'; keep?: number }

/** Meule : n cartes du dessus de sa bibliothèque vers son cimetière. */
export interface Mill { type: 'MILL'; count: number }
/** Exil depuis le dessus de la bibliothèque, face visible ou cachée. */
export interface ExileTop { type: 'EXILE_TOP'; count: number; faceDown?: boolean }
/**
 * Défausse au hasard. Le tirage est fait par le serveur : le client ne choisit
 * pas, et ne connaît donc pas la carte avant tout le monde.
 */
export interface RandomDiscard { type: 'RANDOM_DISCARD'; count: number }
/** Range tout son jeu dans sa bibliothèque et mélange. */
export interface Scoop { type: 'SCOOP' }
/** Change l'impression d'une carte sans changer son identité de jeu. */
export interface SetPrinting { type: 'SET_PRINTING'; cardId: ObjectId; scryfallId: string; isFoil?: boolean }

/**
 * Rattraper une carte posée par erreur : la table **convient de l'oublier**.
 *
 * C'est l'exception assumée à la monotonie de la connaissance (§5.2) : on
 * relâche une carte de sa main sur le champ de bataille sans le vouloir, tout
 * le monde l'a vue, et l'on veut la remettre hors de vue. Rien d'autre dans le
 * protocole ne retire une connaissance acquise hors d'un passage par la
 * bibliothèque.
 *
 * L'exception n'est pas technique, elle est **sociale** : à une vraie table, un
 * dévoilement maladroit s'efface parce que les joueurs se mettent d'accord pour
 * l'effacer. D'où deux propriétés non négociables, tenues par le serveur :
 * le geste est **journalisé nommément** — un effacement silencieux de la
 * mémoire des autres serait une tricherie —, et il est réservé au
 * **propriétaire** de la carte, seul à y perdre.
 *
 * `to` dit ce qu'on rattrape, et les deux cas sont de vraies maladresses :
 *  - `HAND` — la carte n'aurait jamais dû quitter la main. C'est le cas décrit
 *    par l'utilisateur, et le défaut raisonnable.
 *  - `FACE_DOWN` — la carte devait être posée face cachée (un morph relâché
 *    sans la bonne touche) : elle reste où elle est, retournée, et oubliée.
 */
export interface TakeBack { type: 'TAKE_BACK'; cardId: ObjectId; to: 'HAND' | 'FACE_DOWN' }

/**
 * Cascade et Découvrir : exiler du dessus jusqu'à une carte qui convient.
 *
 * **Un assistant, pas un arbitre.** L'intent n'existe que parce que la
 * séquence est fastidieuse — exiler une à une, comparer, remettre le reste
 * dessous au hasard — et non parce que le serveur aurait des règles à
 * appliquer. Rien ne se déclenche tout seul : il part d'un clic, et le joueur
 * peut tout aussi bien continuer à le faire à la main.
 *
 * Le seuil est **saisi par le joueur**, jamais lu sur la carte. Le catalogue ne
 * stocke aucun texte de règles — ni oracle ni texte imprimé, c'est un invariant
 * de droits — et il ne connaît donc pas **le nombre** : Scryfall publie
 * « Discover », jamais « Discover 4 ».
 *
 * Il connaît en revanche le **mot-clé** lui-même, depuis que `Card.keywords`
 * existe : Scryfall le publie à côté du texte de règles, sous forme de noms de
 * mécaniques, ce qui n'est pas du texte et ne touche donc pas l'invariant. Cela
 * sert à **raccourcir** le chemin — l'action remonte dans le menu principal
 * quand le mot-clé est là — et jamais à le fermer : l'entrée reste accessible
 * sur n'importe quelle carte. Le mot-clé ne descend d'ailleurs pas jusqu'ici,
 * il voyage par le catalogue de cartes, délibérément hors de portée du moteur.
 *
 * Le client propose ce qu'il sait calculer, l'humain confirme ou corrige :
 * c'est lui qui lit sa carte.
 *
 * `compare` sépare les deux mots-clés, dont c'est toute la différence :
 *  - `BELOW` — cascade, « strictement inférieure » à la valeur de mana du sort ;
 *  - `AT_MOST` — découvrir N, « N ou moins ».
 *
 * La carte trouvée **reste à l'exil, face visible**, et le joueur en dispose
 * avec le menu ordinaire. « Jouer sans payer son coût » n'a pas de sens sur une
 * table sans pile ni coûts : il n'y a pas de lancement, seulement des
 * déplacements, et choisir à sa place où la carte atterrit serait arbitrer.
 */
export interface Cascade {
  type: 'CASCADE';
  /** Carte déclenchante, pour le journal seulement : elle n'est pas touchée. */
  sourceId?: ObjectId;
  /** Le seuil, tel que le joueur l'a saisi. */
  manaValue: number;
  compare: 'BELOW' | 'AT_MOST';
}

/**
 * Proliférer : un marqueur de plus de chaque sorte **déjà posée**, sur les
 * objets que le joueur désigne.
 *
 * **Un assistant, pas un arbitre**, comme `CASCADE`. Le geste existe déjà en
 * entier avec `ADD_COUNTER` : proliférer à la main, c'est ouvrir le menu de
 * chaque permanent et cliquer « + » sur chaque marqueur. Sur huit permanents et
 * trois sortes, cela fait vingt-quatre clics et vingt-quatre lignes de journal
 * pour un seul geste de jeu. L'intent n'ajoute aucun pouvoir au serveur ; il
 * regroupe ce que le joueur aurait tapé.
 *
 * Ce que le serveur ne décide pas, et c'est tout ce qui compte :
 *  - **les cibles** viennent de `targetIds`, jamais d'une recherche du serveur.
 *    Il ne va pas chercher « tout ce qui porte un marqueur » ;
 *  - **les sortes** sont celles qui sont déjà sur l'objet désigné. Il n'existe
 *    aucune liste de marqueurs reconnus, et donc aucun jugement possible.
 *
 * `[libre]`, comme `ADD_COUNTER` : proliférer touche volontiers le poison d'un
 * adversaire ou sa créature marquée, et une assistance plus étroite que le
 * chemin manuel serait un refus déguisé.
 */
export interface Proliferate { type: 'PROLIFERATE'; targetIds: ObjectId[] }

export interface Reveal { type: 'REVEAL'; cardIds: ObjectId[]; toSeats: SeatId[] | 'ALL'; durationMs?: number }
/**
 * Révèle **en permanence** le dessus de sa propre bibliothèque.
 *
 * C'est ce que font *Experimental Frenzy*, *Realmbreaker* ou *Vizier of the
 * Menagerie* : la carte du dessus est visible en continu, et change à chaque
 * pioche, chaque meule, chaque mélange. Ce n'est donc pas un `REVEAL` répété —
 * un droit posé sur un objet serait faux à la seconde suivante — mais un droit
 * posé sur le **siège** : « ces joueurs voient le dessus de ma bibliothèque,
 * quelle que soit la carte qui s'y trouve ».
 *
 * `toSeats: []` arrête la révélation. Il n'y a pas d'intent symétrique :
 * choisir les destinataires et n'en choisir aucun sont le même geste, et deux
 * intents auraient permis d'en oublier un.
 */
export interface RevealTop { type: 'REVEAL_TOP'; toSeats: SeatId[] | 'ALL' }
export interface RevealHand { type: 'REVEAL_HAND'; toSeats: SeatId[] | 'ALL' }
export interface UnrevealHand { type: 'UNREVEAL_HAND' }

export interface SetLife { type: 'SET_LIFE'; seat: SeatId; value: number }
export interface AdjustLife { type: 'ADJUST_LIFE'; seat: SeatId; delta: number }
export interface SetCommanderDamage {
  type: 'SET_COMMANDER_DAMAGE';
  from: SeatId;
  to: SeatId;
  commanderId: ObjectId;
  value: number;
}
export interface SetPlayerCounter { type: 'SET_PLAYER_COUNTER'; seat: SeatId; kind: string; value: number }

export interface RollDie { type: 'ROLL_DIE'; sides: number; count?: number }
export interface FlipCoin { type: 'FLIP_COIN'; count?: number }
export interface EndTurn { type: 'END_TURN' }
export interface SetPhase { type: 'SET_PHASE'; phase: PhaseName }
export interface Concede { type: 'CONCEDE' }
export interface ChatBubble { type: 'CHAT_BUBBLE'; text: string }
export interface Cursor { type: 'CURSOR'; x: number; y: number; holding?: ObjectId }
export interface UndoLast { type: 'UNDO_LAST' }

export interface SitDown {
  type: 'SIT_DOWN';
  seatIndex: number;
  displayName?: string;
  deckId?: string;
  deckText?: string;
}
/**
 * Quitter la table.
 *
 * `force` est le consentement explicite du joueur à partir **en cours de
 * partie** : son matériel quitte l'état et la partie se poursuit sans lui. Sans
 * ce drapeau, le serveur refuse — on ne s'évapore pas d'une table par un clic
 * malheureux.
 */
export interface StandUp { type: 'STAND_UP'; force?: boolean }
/** Clore la table pour tout le monde. Réservé au siège hôte. */
export interface CloseRoom { type: 'CLOSE_ROOM' }
export interface LoadDeck { type: 'LOAD_DECK'; deckId?: string; deckText?: string }
export interface StartGame { type: 'START_GAME' }
export interface RestartGame { type: 'RESTART_GAME'; keepDecks: boolean }
export interface SwapSideboard { type: 'SWAP_SIDEBOARD'; in: ObjectId[]; out: ObjectId[] }
/**
 * Présentation de son siège : tapis, dos de carte, et pseudo affiché. Le pseudo
 * n'est modifiable que tant que la partie n'a pas commencé — en cours de partie,
 * changer de nom brouillerait un journal d'actions déjà écrit.
 */
export interface SetSeatCosmetics {
  type: 'SET_SEAT_COSMETICS';
  playmatUrl?: string | null;
  cardBackUrl?: string | null;
  displayName?: string;
}

export type Intent =
  | MoveCard | MoveCards | Tap | Untap | UntapAll | SetRotation | FlipFace
  | TurnFaceDown | TurnFaceUp | PeekFaceDown
  | SetCounter | AddCounter | RemoveCounter | Attach | Detach
  | AddLabel | MoveLabel | RemoveLabel | SetLabel
  | CreateToken | DestroyToken
  | Shuffle | Look | ResolveLook | ReorderTop | Draw | Mulligan
  | Mill | ExileTop | RandomDiscard | Scoop | SetPrinting | TakeBack | Cascade | Proliferate
  | Reveal | RevealTop | RevealHand | UnrevealHand
  | SetLife | AdjustLife | SetCommanderDamage | SetPlayerCounter
  | RollDie | FlipCoin | EndTurn | SetPhase | Concede | ChatBubble | Cursor | UndoLast
  | SitDown | StandUp | CloseRoom | LoadDeck | StartGame | RestartGame | SwapSideboard | SetSeatCosmetics;

export type IntentType = Intent['type'];

/**
 * Intents que tout siège joueur peut adresser à un objet qu'il ne contrôle pas.
 * Modèle « vraie table » : la table s'auto-arbitre, le journal nomme l'auteur.
 * Voir docs/protocol.md §13.1.
 */
export const FREE_INTENTS: ReadonlySet<IntentType> = new Set<IntentType>([
  'TAP',
  'UNTAP',
  'SET_COUNTER',
  'ADD_COUNTER',
  'REMOVE_COUNTER',
  /*
   * Proliférer suit `ADD_COUNTER`, dont il n'est qu'un regroupement : le rendre
   * plus étroit que le geste qu'il abrège reviendrait à refuser par l'assistance
   * ce que le menu accepte à la main — et le poison d'un adversaire est une
   * cible de prolifération aussi ordinaire que ses créatures.
   */
  'PROLIFERATE',
  'ATTACH',
  'DETACH',
  'SET_LIFE',
  'ADJUST_LIFE',
  'SET_PLAYER_COUNTER',
  'SET_ROTATION',
  'MOVE_LABEL',
  'SET_LABEL',
  'REMOVE_LABEL',
]);

/**
 * `SET_COMMANDER_DAMAGE` ne figure volontairement pas ci-dessus : les dégâts de
 * commandant se consultent librement, mais chacun ne corrige que ceux qu'il
 * reçoit. Voir docs/protocol.md §6.6.
 */

/** Intents jamais journalisés ni persistés. */
export const EPHEMERAL_INTENTS: ReadonlySet<IntentType> = new Set<IntentType>(['CURSOR']);

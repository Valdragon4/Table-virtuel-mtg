/**
 * Ce que la console a le droit de publier — et la forme choisie exprès pour que
 * l'oubli soit impossible plutôt qu'improbable.
 *
 * ——— Règle 1 : jamais d'information cachée de partie
 *
 * Le serveur est autoritatif et la visibilité est décidée **à l'émission** : ce
 * qu'un siège n'a pas le droit de voir ne traverse pas le socket. Une route
 * d'administration qui lirait l'état d'une partie contournerait tout cet édifice
 * d'un seul geste — un administrateur verrait les mains et les bibliothèques.
 * Aucune fonction de ce fichier ne touche à `game/`, au registre des rooms
 * vivantes autrement que pour en compter, ni à `GameLog`, ni à `DeckSnapshot`.
 * On publie des **métadonnées** : combien de sièges, quel statut, quelles dates.
 * Jamais le contenu d'une zone, jamais une carte, jamais un identifiant d'objet
 * de partie.
 *
 * ——— Règle 2 : liste blanche, jamais liste noire
 *
 * Chaque fonction construit son objet **champ par champ**, à partir d'une entrée
 * dont le type ne déclare que ce dont elle a besoin. Un `select` élargi en base,
 * ou une colonne ajoutée au schéma, ne peut donc pas se retrouver dans une
 * réponse par simple inertie : il faudrait venir écrire la ligne ici.
 * `apps/server/test/admin-fuite.test.ts` nourrit ces fonctions avec des lignes
 * Prisma **complètes**, secrets compris, et vérifie l'ensemble exact des clés
 * produites : un `select` trop large le fait échouer.
 *
 * Les trois secrets qui sont en base et qu'il serait facile de laisser sortir
 * sans y penser : `User.passwordHash`, l'identifiant de `Session` (qui est
 * l'empreinte du jeton de connexion) et `AuthToken.tokenHash` (vérification
 * d'email et réinitialisation de mot de passe). Aucun n'est lu nulle part ici.
 * `GameRoom.passwordHash` non plus : on n'en publie que l'existence.
 */

/** Une date au format ISO, ou `null`. Les dates traversent JSON, pas des `Date`. */
function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/* ——— Comptes ——————————————————————————————————————————————— */

/**
 * L'entrée d'une ligne de compte : exactement les colonnes que la requête a le
 * droit de demander. Le type est écrit à la main plutôt que dérivé de Prisma,
 * et c'est le but : dériver de Prisma ferait entrer les nouvelles colonnes
 * toutes seules.
 */
export interface UserRowInput {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
  _count?: { decks?: number; seats?: number; sessions?: number; rooms?: number };
}

export interface PublishedUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string;
  decks: number;
  seats: number;
  sessions: number;
  hostedRooms: number;
}

/**
 * `isAdmin` est **calculé**, pas lu : c'est la même fonction que la garde qui
 * répond, donc l'écran ne peut pas afficher une vérité différente de celle qui
 * protège les routes.
 */
export function publishUser(row: UserRowInput, isAdmin: (email: string) => boolean): PublishedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: row.emailVerifiedAt !== null,
    isAdmin: isAdmin(row.email),
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    decks: row._count?.decks ?? 0,
    seats: row._count?.seats ?? 0,
    sessions: row._count?.sessions ?? 0,
    hostedRooms: row._count?.rooms ?? 0,
  };
}

/** L'ensemble exact des clés publiées pour un compte. Le test le compare. */
export const PUBLISHED_USER_KEYS: readonly string[] = [
  'id',
  'email',
  'displayName',
  'emailVerified',
  'isAdmin',
  'createdAt',
  'lastSeenAt',
  'decks',
  'seats',
  'sessions',
  'hostedRooms',
];

/* ——— Tables ———————————————————————————————————————————————— */

/**
 * Une table, vue de l'extérieur.
 *
 * `hostUserId` n'est volontairement pas publié tel quel : la fiche affiche le
 * **pseudo** de l'hôte, qui suffit à comprendre, et le compte se retrouve par la
 * recherche. `id` non plus — une table se désigne par son code.
 */
export interface RoomRowInput {
  code: string;
  gameMode: string;
  status: string;
  isPrivate: boolean;
  passwordHash: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  host?: { displayName: string } | null;
  _count?: { seats?: number };
}

export interface PublishedRoom {
  code: string;
  mode: string;
  status: string;
  isPrivate: boolean;
  /** L'existence d'un mot de passe, jamais son empreinte. */
  hasPassword: boolean;
  createdAt: string;
  lastActivityAt: string;
  hostName: string | null;
  seats: number;
}

export function publishRoom(row: RoomRowInput): PublishedRoom {
  return {
    code: row.code,
    mode: row.gameMode,
    status: row.status,
    isPrivate: row.isPrivate,
    hasPassword: row.passwordHash !== null,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    hostName: row.host?.displayName ?? null,
    seats: row._count?.seats ?? 0,
  };
}

export const PUBLISHED_ROOM_KEYS: readonly string[] = [
  'code',
  'mode',
  'status',
  'isPrivate',
  'hasPassword',
  'createdAt',
  'lastActivityAt',
  'hostName',
  'seats',
];

/* ——— Les tables où un compte est assis ————————————————————— */

/**
 * De quoi répondre à « ce compte est-il en train de jouer ? » avant toute action
 * le concernant. Le siège lui-même n'apparaît que par son **index** ; ni son
 * identifiant, ni `deckSnapshotId`, qui est la porte d'entrée vers un deck figé.
 */
export interface SeatRowInput {
  seatIndex: number;
  joinedAt: Date;
  room: { code: string; status: string; gameMode: string; lastActivityAt: Date };
}

export interface PublishedSeat {
  code: string;
  status: string;
  mode: string;
  seatIndex: number;
  joinedAt: string;
  lastActivityAt: string;
}

export function publishSeat(row: SeatRowInput): PublishedSeat {
  return {
    code: row.room.code,
    status: row.room.status,
    mode: row.room.gameMode,
    seatIndex: row.seatIndex,
    joinedAt: row.joinedAt.toISOString(),
    lastActivityAt: row.room.lastActivityAt.toISOString(),
  };
}

export const PUBLISHED_SEAT_KEYS: readonly string[] = [
  'code',
  'status',
  'mode',
  'seatIndex',
  'joinedAt',
  'lastActivityAt',
];

/* ——— Ingestion ————————————————————————————————————————————— */

export interface IngestRowInput {
  bulkType: string;
  bulkUpdatedAt: Date;
  startedAt: Date;
  finishedAt: Date | null;
  cardsUpserted: number;
  error: string | null;
}

export interface PublishedIngest {
  bulkType: string;
  /** La fraîcheur de la matière, telle que Scryfall la date. */
  bulkUpdatedAt: string;
  startedAt: string;
  finishedAt: string | null;
  cardsUpserted: number;
  /** Trois états distincts : réussie, échouée, toujours en cours. */
  outcome: 'ok' | 'failed' | 'running';
  error: string | null;
}

export function publishIngest(row: IngestRowInput): PublishedIngest {
  const outcome = row.error !== null ? 'failed' : row.finishedAt === null ? 'running' : 'ok';
  return {
    bulkType: row.bulkType,
    bulkUpdatedAt: row.bulkUpdatedAt.toISOString(),
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    cardsUpserted: row.cardsUpserted,
    outcome,
    error: row.error,
  };
}

export const PUBLISHED_INGEST_KEYS: readonly string[] = [
  'bulkType',
  'bulkUpdatedAt',
  'startedAt',
  'finishedAt',
  'cardsUpserted',
  'outcome',
  'error',
];

/* ——— Journal des actions d'administration ————————————————— */

export interface AuditRowInput {
  id: string;
  createdAt: Date;
  actorEmail: string;
  action: string;
  targetKind: string;
  targetRef: string;
  detail: unknown;
}

export interface PublishedAudit {
  id: string;
  at: string;
  actorEmail: string;
  action: string;
  targetKind: string;
  targetRef: string;
  detail: unknown;
}

export function publishAudit(row: AuditRowInput): PublishedAudit {
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    actorEmail: row.actorEmail,
    action: row.action,
    targetKind: row.targetKind,
    targetRef: row.targetRef,
    detail: row.detail ?? null,
  };
}

export const PUBLISHED_AUDIT_KEYS: readonly string[] = [
  'id',
  'at',
  'actorEmail',
  'action',
  'targetKind',
  'targetRef',
  'detail',
];

/* ——— Le fil des dernières actions ————————————————————————— */

/**
 * Ce qu'une ligne du fil a le droit de dire.
 *
 * Le fil agrège plusieurs tables, et c'est précisément pour ça qu'il lui faut
 * **une seule** forme de sortie, étroite et écrite ici : chaque source doit se
 * plier à ces six champs, ce qui rend impossible de laisser passer une colonne
 * « parce qu'elle était déjà là dans la ligne Prisma ».
 *
 * `id` est **synthétique** — un `kind`, une date et un rang. Ce n'est
 * volontairement la clé de rien : le fil a besoin d'une clé de rendu stable,
 * pas de publier l'identifiant d'une session (qui est l'empreinte d'un jeton),
 * d'un siège ou d'une table.
 */
export type ActivityKind =
  | 'ACCOUNT_CREATED'
  | 'SESSION_OPENED'
  | 'TABLE_OPENED'
  | 'SEAT_JOINED'
  | 'INGEST_RUN'
  | 'ADMIN_ACTION';

export interface PublishedActivity {
  /** Clé de rendu synthétique. Ne désigne aucune ligne en base. */
  id: string;
  at: string;
  kind: ActivityKind;
  /** Qui : un pseudo, un nom d'invité, ou l'adresse d'un administrateur. */
  who: string | null;
  /** Sur quoi : un code de table, une cible de journal. Jamais un identifiant interne. */
  ref: string | null;
  /** Une précision courte et neutre : un mode de jeu, une issue, un nom d'action. */
  note: string | null;
}

/**
 * Le seul constructeur d'une ligne de fil. Chaque source passe par lui, donc
 * aucune ne peut ajouter un champ sans venir modifier ce fichier.
 */
export function activityEntry(
  kind: ActivityKind,
  at: Date,
  parts: { who?: string | null; ref?: string | null; note?: string | null },
  rank: number,
): PublishedActivity {
  return {
    id: `${kind}-${at.toISOString()}-${rank}`,
    at: at.toISOString(),
    kind,
    who: parts.who ?? null,
    ref: parts.ref ?? null,
    note: parts.note ?? null,
  };
}

export const PUBLISHED_ACTIVITY_KEYS: readonly string[] = [
  'id',
  'at',
  'kind',
  'who',
  'ref',
  'note',
];

/**
 * Les noms de champs qui ne doivent jamais apparaître dans une réponse
 * d'administration, quelle qu'elle soit.
 *
 * Exportés pour que le test puisse balayer **les corps de réponse réels** et pas
 * seulement les fonctions ci-dessus : c'est le filet qui attrape la route écrite
 * plus tard qui aurait oublié de passer par ici.
 *
 * Trois familles, et elles ne se valent pas :
 *
 *  - les **secrets** (`passwordHash`, `tokenHash`, `token`) : une fuite est
 *    immédiatement exploitable ;
 *  - les **données personnelles** qu'un administrateur n'a pas besoin de lire
 *    pour exploiter la plateforme (`ip`, `userAgent`) : on publie le *nombre* de
 *    sessions, pas d'où elles viennent ;
 *  - les **clés vers l'état de partie** (`deckSnapshotId`, `payload`,
 *    `cardIds`…) : elles ne sont pas secrètes en elles-mêmes, mais les publier
 *    donnerait à l'écran suivant de quoi aller chercher une bibliothèque.
 *
 * Attention en ajoutant un nom : `cards` n'y est **pas**, et c'est délibéré. La
 * vue d'ensemble publie `catalog.cards`, qui est un entier — le nombre de cartes
 * du catalogue public. Interdire le mot ferait échouer le test sur un compteur
 * parfaitement légitime, et la vraie règle serait noyée. Ce qu'on interdit, ce
 * sont les porteurs d'identité de carte, pas le mot « carte ».
 */
export const FORBIDDEN_FIELDS: readonly string[] = [
  'passwordHash',
  'tokenHash',
  'sessionId',
  'token',
  'ip',
  'userAgent',
  'payload',
  'deckSnapshotId',
  'hostUserId',
  'cardId',
  'cardIds',
  'scryfallId',
  'zones',
  'hand',
  'library',
];

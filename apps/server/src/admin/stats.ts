/**
 * Les chiffres de la console : tout ce que la base sait déjà dire de l'état de
 * la plateforme, et rien de ce qu'elle sait dire d'une partie.
 *
 * ——— La frontière, une fois pour toutes
 *
 * Tout ici est du `count` et de l'agrégat. Aucune fonction ne lit `GameLog`, ni
 * `DeckSnapshot.payload`, ni ne réveille une room endormie. Le seul contact avec
 * le moteur est `liveRoomCount()`, qui rend un **entier** et que `/api/health`
 * publie déjà à tout le monde : on ne s'accorde pas un accès nouveau, on lit le
 * même compteur.
 *
 * ——— « Table close » : ce que ce mot recouvre vraiment
 *
 * La demande parle de « tables closes ». En base, il n'existe pas de colonne
 * `closed` : `GameRoom.status` vaut `ENDED`, et deux chemins très différents y
 * mènent — l'hôte qui clôt sa table (`POST /api/rooms/:code/close`) et le
 * ménage automatique qui libère une room vide inactive depuis six heures
 * (`sweepRooms`). Le drapeau `closed` que le client voit est, lui, un état
 * **mémoire** de la room vivante, et il est mis en même temps que `ENDED`.
 *
 * Conséquence, et elle est dite plutôt que maquillée : `ended` compte les tables
 * rangées **toutes causes confondues**, et le tableau de bord l'écrit ainsi.
 * Distinguer les deux demanderait une colonne `closedAt` posée par la route de
 * clôture, donc une écriture dans `rooms/routes.ts` — hors du périmètre de ce
 * travail, et sans valeur rétroactive de toute façon.
 */
import { prisma } from '../db.js';
import { PROTOCOL_VERSION } from '@mtg/shared';
import { liveRoomCount } from '../game/registry.js';
import { adminEmailCount } from './identity.js';
import { publishIngest, type PublishedIngest } from './publish.js';

function since(ms: number): Date {
  return new Date(Date.now() - ms);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface Overview {
  generatedAt: string;
  health: {
    ok: boolean;
    protocol: number;
    /** Rooms tenues en mémoire par **ce** processus. Ce n'est pas un total base. */
    liveRooms: number;
    cards: number;
  };
  accounts: {
    total: number;
    verified: number;
    unverified: number;
    activeDay: number;
    activeWeek: number;
    activeMonth: number;
    newWeek: number;
    newMonth: number;
    /** Combien d'adresses sont déclarées dans `ADMIN_EMAILS` — jamais lesquelles. */
    adminsDeclared: number;
  };
  tables: {
    total: number;
    lobby: number;
    playing: number;
    ended: number;
    activeDay: number;
    newWeek: number;
    /** Sièges occupés sur les tables qui ne sont pas rangées. */
    seatsOnOpenTables: number;
  };
  decks: {
    total: number;
    /** Comptes possédant au moins un deck : la différence dit si l'outil sert. */
    owners: number;
  };
  catalog: {
    cards: number;
    tokens: number;
    localizations: number;
    localizedPrintings: number;
  };
  ingest: {
    last: PublishedIngest | null;
    /** Âge de la matière ingérée, en heures. `null` si rien n'a jamais tourné. */
    bulkAgeHours: number | null;
    failedWeek: number;
    runsWeek: number;
  };
  sessions: {
    /** Sessions non expirées : une approximation honnête des comptes utilisables. */
    active: number;
    /** Sessions expirées pas encore purgées : si ça enfle, le ménage ne passe plus. */
    stale: number;
  };
}

export async function overview(): Promise<Overview> {
  const now = new Date();
  const dayAgo = since(DAY);
  const weekAgo = since(7 * DAY);
  const monthAgo = since(30 * DAY);

  const [
    users,
    verified,
    activeDay,
    activeWeek,
    activeMonth,
    newWeek,
    newMonth,
    rooms,
    lobby,
    playing,
    ended,
    roomsActiveDay,
    roomsNewWeek,
    seatsOnOpenTables,
    decks,
    deckOwners,
    cards,
    tokens,
    localizations,
    localizedPrintings,
    lastIngest,
    failedWeek,
    runsWeek,
    activeSessions,
    staleSessions,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: dayAgo } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: monthAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.gameRoom.count(),
    prisma.gameRoom.count({ where: { status: 'LOBBY' } }),
    prisma.gameRoom.count({ where: { status: 'PLAYING' } }),
    prisma.gameRoom.count({ where: { status: 'ENDED' } }),
    prisma.gameRoom.count({ where: { lastActivityAt: { gte: dayAgo } } }),
    prisma.gameRoom.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.gameSeat.count({ where: { room: { status: { not: 'ENDED' } } } }),
    prisma.deck.count(),
    // `distinct` sur le propriétaire : un compte à douze decks compte pour un.
    prisma.deck.findMany({ distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
    prisma.card.count(),
    prisma.card.count({ where: { isToken: true } }),
    prisma.cardLocalization.count(),
    prisma.localizedPrinting.count(),
    prisma.ingestRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.ingestRun.count({ where: { startedAt: { gte: weekAgo }, error: { not: null } } }),
    prisma.ingestRun.count({ where: { startedAt: { gte: weekAgo } } }),
    prisma.session.count({ where: { expiresAt: { gte: now } } }),
    prisma.session.count({ where: { expiresAt: { lt: now } } }),
  ]);

  return {
    generatedAt: now.toISOString(),
    health: {
      // On a interrogé la base une vingtaine de fois pour arriver ici : si la
      // réponse existe, la base répond. `ok` n'est donc pas décoratif.
      ok: true,
      protocol: PROTOCOL_VERSION,
      liveRooms: liveRoomCount(),
      cards,
    },
    accounts: {
      total: users,
      verified,
      unverified: users - verified,
      activeDay,
      activeWeek,
      activeMonth,
      newWeek,
      newMonth,
      adminsDeclared: adminEmailCount(),
    },
    tables: {
      total: rooms,
      lobby,
      playing,
      ended,
      activeDay: roomsActiveDay,
      newWeek: roomsNewWeek,
      seatsOnOpenTables,
    },
    decks: { total: decks, owners: deckOwners },
    catalog: { cards, tokens, localizations, localizedPrintings },
    ingest: {
      last: lastIngest ? publishIngest(lastIngest) : null,
      bulkAgeHours: lastIngest
        ? Math.round((Date.now() - lastIngest.bulkUpdatedAt.getTime()) / HOUR)
        : null,
      failedWeek,
      runsWeek,
    },
    sessions: { active: activeSessions, stale: staleSessions },
  };
}

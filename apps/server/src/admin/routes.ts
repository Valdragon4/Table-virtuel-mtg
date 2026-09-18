/**
 * La console d'administration, côté serveur.
 *
 * Sept routes, une seule garde, et elle est sur les sept. Lire `guard.ts` pour
 * savoir pourquoi le refus est une 404 identique dans les trois cas de figure
 * (visiteur, connecté ordinaire, adresse retirée de la liste), et `publish.ts`
 * pour la liste blanche des champs.
 *
 * ——— Ce que cette console **ne fait pas**, et pourquoi
 *
 * **Elle ne supprime aucun compte.** « Les gérer individuellement » appelait
 * l'action ; je la refuse pour cette première version, et ce n'est pas de la
 * timidité. Supprimer un `User` fait tomber en cascade ses `Session`, ses
 * `Deck` — donc ses `DeckCard` —, ses `Playmat` et ses `UserPrefs`, et met à
 * `null` le `userId` de ses `GameSeat`. Si le compte est **assis à une table en
 * cours**, la room vivante garde son siège en mémoire avec son nom et son deck :
 * la partie continue autour d'un joueur qui n'existe plus, et le siège orphelin
 * en base ne se rattache plus à personne. Rien de tout cela n'est réversible, et
 * rien ne prévient l'intéressé. Un compte peut déjà se supprimer lui-même
 * (`DELETE /api/me`), avec son mot de passe ; pour un retrait décidé par
 * l'exploitant, il faut d'abord savoir vider un siège proprement, et ce n'est
 * pas ce travail-ci. La console **montre** donc ce qu'il faudrait pour décider,
 * y compris les tables où le compte est assis.
 *
 * **Elle ne promeut ni ne dégrade personne.** Il n'y a pas de route à écrire
 * pour cela : l'administration se décide dans `ADMIN_EMAILS`, sur le serveur.
 * C'est exactement la propriété recherchée — un administrateur ne peut pas se
 * dégrader lui-même, ni en dégrader un autre, donc on ne peut pas se retrouver
 * sans aucun administrateur par un clic malheureux.
 *
 * **La seule action est la révocation des sessions d'un compte.** Elle est
 * journalisée, refusée sur soi-même, et — c'est ce qui la rend acceptable —
 * réversible : la personne se reconnecte. Elle ne coupe pas non plus une partie
 * en cours, parce que le WebSocket résout la session **une fois**, à la poignée
 * de main (`ws/server.ts`) ; un joueur déjà connecté à sa table y reste jusqu'à
 * ce qu'il la quitte. Une révocation ne fait donc jamais tomber une table.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from './guard.js';
import { isAdminEmail } from './identity.js';
import { overview } from './stats.js';
import { activity, ACTIVITY_MAX } from './activity.js';
import {
  publishAudit,
  publishRoom,
  publishSeat,
  publishUser,
  type PublishedSeat,
} from './publish.js';

/**
 * Les colonnes que la console a le droit de demander à Prisma, écrites une fois.
 *
 * `select` explicite et jamais `include` : un `include` ramène la ligne entière,
 * `passwordHash` compris, et il suffirait alors d'un `…user` quelque part pour
 * la faire sortir. Ici, le secret n'est même pas chargé en mémoire.
 */
const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  emailVerifiedAt: true,
  createdAt: true,
  lastSeenAt: true,
  _count: { select: { decks: true, seats: true, sessions: true, rooms: true } },
} as const;

const ROOM_SELECT = {
  code: true,
  gameMode: true,
  status: true,
  isPrivate: true,
  passwordHash: true,
  createdAt: true,
  lastActivityAt: true,
  host: { select: { displayName: true } },
  _count: { select: { seats: true } },
} as const;

const listQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    /** Plafonné à 100 : une console ne rapatrie pas la base entière par accident. */
    take: z.coerce.number().int().min(1).max(100).default(50),
    skip: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const roomQuery = z
  .object({
    status: z.enum(['LOBBY', 'PLAYING', 'ENDED']).optional(),
    take: z.coerce.number().int().min(1).max(100).default(50),
    skip: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

/** Écrit au journal. Ne lève jamais : un journal en panne ne doit pas mentir sur le succès… */
async function audit(
  actor: { userId: string; email: string },
  action: string,
  target: { kind: string; ref: string },
  detail?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await prisma.adminAudit.create({
      data: {
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action,
        targetKind: target.kind,
        targetRef: target.ref,
        detail: (detail ?? null) as never,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Posé ici et non dans `app.ts` : la décoration appartient à ce module, comme
  // la garde qui la remplit. `null` partout ailleurs.
  app.decorateRequest('admin', null);

  /* — Vue d'ensemble ——————————————————————————————————————— */

  app.get('/api/admin/overview', { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(await overview());
  });

  /* — Comptes —————————————————————————————————————————————— */

  app.get('/api/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const query = listQuery.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const { q, take, skip } = query.data;

    // `insensitive` sur les deux champs par lesquels on cherche réellement
    // quelqu'un : son adresse ou son pseudo. Rien d'autre n'est cherchable, donc
    // rien d'autre ne peut être deviné par sondage de la recherche.
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { displayName: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.user.count({ where }),
    ]);

    return reply.send({
      total,
      take,
      skip,
      users: rows.map((row) => publishUser(row, isAdminEmail)),
    });
  });

  app.get('/api/admin/users/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    // Un identifiant mal formé et un compte absent rendent la même chose : il
    // n'y a rien à apprendre en sondant la forme des identifiants.
    if (!params.success) return reply.code(404).send({ error: 'NOT_FOUND' });

    const row = await prisma.user.findUnique({ where: { id: params.data.id }, select: USER_SELECT });
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });

    /*
     * Les tables où ce compte est assis : c'est **la** question à se poser avant
     * de toucher à un compte, et c'est aussi la frontière à ne pas franchir. On
     * lit le siège et la table — index, statut, dates — et on s'arrête là. Ni
     * `deckSnapshotId`, ni le moindre journal de partie.
     */
    const seats = await prisma.gameSeat.findMany({
      where: { userId: row.id },
      orderBy: { joinedAt: 'desc' },
      take: 20,
      select: {
        seatIndex: true,
        joinedAt: true,
        room: { select: { code: true, status: true, gameMode: true, lastActivityAt: true } },
      },
    });

    const published: PublishedSeat[] = seats.map(publishSeat);
    return reply.send({
      user: publishUser(row, isAdminEmail),
      seats: published,
      /** Un raccourci de lecture : la console s'en sert pour avertir. */
      seatedAtOpenTable: published.some((s) => s.status !== 'ENDED'),
    });
  });

  /* — Tables ——————————————————————————————————————————————— */

  app.get('/api/admin/rooms', { preHandler: requireAdmin }, async (request, reply) => {
    const query = roomQuery.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const { status, take, skip } = query.data;
    const where = status ? { status } : {};

    const [rows, total] = await Promise.all([
      prisma.gameRoom.findMany({
        where,
        select: ROOM_SELECT,
        orderBy: { lastActivityAt: 'desc' },
        take,
        skip,
      }),
      prisma.gameRoom.count({ where }),
    ]);

    return reply.send({ total, take, skip, rooms: rows.map(publishRoom) });
  });

  /* — Journal —————————————————————————————————————————————— */

  app.get('/api/admin/audit', { preHandler: requireAdmin }, async (request, reply) => {
    const query = listQuery.safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const { take, skip } = query.data;

    const rows = await prisma.adminAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return reply.send({ entries: rows.map(publishAudit) });
  });

  /* — Le fil des dernières actions ——————————————————————————— */

  /**
   * Toutes sources confondues, trié par date. Lire l'en-tête de `activity.ts`
   * pour ce qui y entre, ce qui en est écarté et pourquoi.
   *
   * Pas de `skip` : ce fil répond à « que vient-il de se passer », pas à « donne
   * l'histoire de la plateforme ». Une pagination ferait glisser une fusion de
   * six sources sur des pages qui ne s'alignent pas — et coûterait de plus en
   * plus cher à mesure qu'on s'enfonce. Le plafond, lui, est dur.
   */
  app.get('/api/admin/activity', { preHandler: requireAdmin }, async (request, reply) => {
    const query = z
      .object({ take: z.coerce.number().int().min(1).max(ACTIVITY_MAX).default(25) })
      .strict()
      .safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    return reply.send({ entries: await activity(query.data.take) });
  });

  /* — La seule action ——————————————————————————————————————— */

  app.post(
    '/api/admin/users/:id/revoke-sessions',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const admin = request.admin!;
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: 'NOT_FOUND' });

      /*
       * Jamais sur soi-même. Ce n'est pas qu'une commodité : c'est la même règle
       * qui, appliquée aux droits, empêche de se retrouver sans administrateur.
       * Ici elle empêche surtout de se déconnecter de la console en croyant
       * agir sur quelqu'un d'autre, ce qui arrive avec deux lignes voisines.
       */
      if (params.data.id === admin.userId) {
        return reply
          .code(400)
          .send({ error: 'SELF_TARGET', message: 'On ne révoque pas ses propres sessions ici.' });
      }

      const target = await prisma.user.findUnique({
        where: { id: params.data.id },
        select: { id: true, email: true },
      });
      if (!target) return reply.code(404).send({ error: 'NOT_FOUND' });

      const { count } = await prisma.session.deleteMany({ where: { userId: target.id } });
      const logged = await audit(
        admin,
        'REVOKE_SESSIONS',
        { kind: 'USER', ref: target.id },
        { email: target.email, sessions: count },
      );

      // Le journal fait partie de l'action, pas de son décor : si l'écriture a
      // échoué, l'écran doit le dire plutôt que d'afficher un succès net.
      return reply.send({ ok: true, revoked: count, logged });
    },
  );
}

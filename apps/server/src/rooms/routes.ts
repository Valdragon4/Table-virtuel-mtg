import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { hashPassword } from '../auth/password.js';
import { getRoom, peekRoom } from '../game/registry.js';

/** Alphabet sans caractères ambigus : un code se lit à l'oral sans hésitation. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

const createSchema = z
  .object({
    mode: z.enum(['COMMANDER', 'DUEL', 'DRAFT']).default('COMMANDER'),
    isPrivate: z.boolean().default(false),
    password: z.string().min(1).max(100).optional(),
  })
  .strict();

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  /** Créer une table ne demande pas de compte : le lien suffit, comme prévu. */
  app.post('/api/rooms', async (request, reply) => {
    const body = createSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });

    // Collision de code improbable, mais on réessaie plutôt que d'échouer.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const existing = await prisma.gameRoom.findUnique({ where: { code } });
      if (existing) continue;

      const room = await prisma.gameRoom.create({
        data: {
          code,
          gameMode: body.data.mode,
          isPrivate: body.data.isPrivate,
          hostUserId: request.userId,
          passwordHash: body.data.password ? await hashPassword(body.data.password) : null,
        },
      });
      return reply.code(201).send({ code: room.code, mode: room.gameMode });
    }
    return reply.code(503).send({ error: 'CODE_COLLISION', message: 'Réessaie.' });
  });

  app.get('/api/rooms/:code', async (request, reply) => {
    const params = z.object({ code: z.string().min(4).max(16) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const record = await prisma.gameRoom.findUnique({ where: { code: params.data.code } });
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND' });

    // Rien de l'état de partie ne sort par HTTP : seulement de quoi afficher le salon.
    const live = await getRoom(record.code);
    return reply.send({
      code: record.code,
      mode: record.gameMode,
      status: live ? live.state.status : record.status,
      // Le salon doit pouvoir dire « c'est fini » avant de proposer un siège :
      // sans ce champ, on offrait une chaise à une table rangée.
      closed: live ? live.state.closed : record.status === 'ENDED',
      isPrivate: record.isPrivate,
      requiresPassword: record.passwordHash !== null,
      seats: live
        ? [...live.state.seats.values()]
            .sort((a, b) => a.seatIndex - b.seatIndex)
            .map((s) => ({
              seatIndex: s.seatIndex,
              displayName: s.displayName,
              connected: s.connected,
              deckName: s.deckName,
              color: s.color,
            }))
        : [],
    });
  });

  /**
   * Les tables où ce compte a une place.
   *
   * On y ajoute les tables qu'il a créées sans s'y asseoir : sinon un hôte qui
   * partage un lien puis ferme son onglet n'a plus aucun moyen de retrouver — ni
   * de clore — la table qu'il vient d'ouvrir.
   */
  app.get('/api/games', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId!;
    const [seats, hosted] = await Promise.all([
      prisma.gameSeat.findMany({
        where: { userId },
        orderBy: { joinedAt: 'desc' },
        take: 50,
        include: {
          room: {
            select: {
              code: true,
              gameMode: true,
              status: true,
              createdAt: true,
              lastActivityAt: true,
              hostUserId: true,
            },
          },
        },
      }),
      prisma.gameRoom.findMany({
        where: { hostUserId: userId, status: { not: 'ENDED' } },
        orderBy: { lastActivityAt: 'desc' },
        take: 50,
      }),
    ]);

    const rows = new Map<string, {
      code: string;
      mode: string;
      status: string;
      seatIndex: number | null;
      isHost: boolean;
      joinedAt: Date | null;
      createdAt: Date;
      lastActivityAt: Date;
      players: number;
    }>();

    for (const seat of seats) {
      rows.set(seat.room.code, {
        code: seat.room.code,
        mode: seat.room.gameMode,
        status: seat.room.status,
        seatIndex: seat.seatIndex,
        isHost: seat.room.hostUserId === userId,
        joinedAt: seat.joinedAt,
        createdAt: seat.room.createdAt,
        lastActivityAt: seat.room.lastActivityAt,
        players: 0,
      });
    }
    for (const room of hosted) {
      if (rows.has(room.code)) continue;
      rows.set(room.code, {
        code: room.code,
        mode: room.gameMode,
        status: room.status,
        seatIndex: null,
        isHost: true,
        joinedAt: null,
        createdAt: room.createdAt,
        lastActivityAt: room.lastActivityAt,
        players: 0,
      });
    }

    // Le nombre de joueurs se lit sur la room vivante quand il y en a une : la
    // base ne connaît que les sièges qui ont chargé un deck.
    for (const row of rows.values()) {
      const live = peekRoom(row.code);
      row.players = live ? live.state.seats.size : 0;
      // Une room vivante fait autorité sur son statut : la base n'est mise à
      // jour qu'aux moments-clés.
      if (live) row.status = live.state.status;
    }

    /*
     * Y a-t-il un replay à proposer ?
     *
     * La liste est le seul endroit où l'on retrouve une partie finie : sans
     * cette information, « Revoir la partie » n'existerait que sur l'écran de
     * fin, qui disparaît dès qu'on le quitte. On le dit donc ici.
     *
     * Le filtre est le **même verrou** que partout ailleurs — `closedAt` non nul
     * — et non un simple « la table est terminée » : un enregistrement rouvert,
     * tronqué avant sa fin ou jamais clos ne doit pas être annoncé comme
     * lisible. Une requête, sur les seuls codes déjà en main.
     */
    const withReplay = new Set(
      (
        await prisma.gameReplay
          .findMany({
            // `GameReplay` désigne sa table par `roomId`, pas par son code : on
            // passe donc par la relation plutôt que de faire une requête de plus
            // pour traduire les codes en identifiants.
            where: { room: { code: { in: [...rows.keys()] } }, closedAt: { not: null } },
            select: { room: { select: { code: true } } },
          })
          .catch(() => [])
      ).map((r) => r.room.code),
    );

    const games = [...rows.values()]
      .map((row) => ({ ...row, hasReplay: withReplay.has(row.code) }))
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return reply.send({ games });
  });

  /**
   * Quitter une table depuis l'extérieur.
   *
   * Quitter veut dire quitter : la ligne de siège disparaît, et si la table est
   * encore vivante le matériel du partant sort de l'état. En cours de partie,
   * `force` est exigé — c'est une concession.
   */
  app.post('/api/rooms/:code/leave', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ code: z.string().min(4).max(16) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const body = z.object({ force: z.boolean().default(false) }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const record = await prisma.gameRoom.findUnique({ where: { code: params.data.code } });
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND' });

    const live = peekRoom(record.code);
    if (live) {
      try {
        live.leaveByUser(request.userId!, { force: body.data.force });
      } catch (error) {
        // Le seul refus possible est « partie en cours sans confirmation ».
        return reply.code(409).send({
          error: 'CONFIRM_REQUIRED',
          message: error instanceof Error ? error.message : 'Confirmation requise.',
        });
      }
    }
    await prisma.gameSeat
      .deleteMany({ where: { roomId: record.id, userId: request.userId! } })
      .catch(() => undefined);
    return reply.send({ ok: true });
  });

  /** Clore une table. Réservé à son créateur. */
  app.post('/api/rooms/:code/close', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ code: z.string().min(4).max(16) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const record = await prisma.gameRoom.findUnique({ where: { code: params.data.code } });
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (record.hostUserId !== request.userId) {
      return reply.code(403).send({ error: 'NOT_HOST', message: "Seul l'hôte peut clore la table." });
    }

    peekRoom(record.code)?.close();
    await prisma.gameRoom.update({
      where: { id: record.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    return reply.send({ ok: true });
  });
}

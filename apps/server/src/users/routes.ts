/**
 * Compte : lecture, préférences, export et suppression.
 *
 * L'export et la suppression sont en un appel chacun, et la suppression purge
 * réellement : les cascades Prisma emportent sessions, decks, playmats, sièges
 * et snapshots. Aucune conservation « au cas où ».
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { clearSessionCookie, destroyAllSessions } from '../auth/session.js';
import { verifyPassword } from '../auth/password.js';

const prefsSchema = z
  .object({
    displayName: z.string().min(2).max(32).regex(/^[\p{L}\p{N}_ -]+$/u).optional(),
    cardBackUrl: z.string().url().max(2048).nullable().optional(),
    defaultPlaymatId: z.string().uuid().nullable().optional(),
    autoUntapStep: z.boolean().optional(),
    uiScale: z.number().min(0.5).max(2).optional(),
    extra: z.record(z.unknown()).optional(),
  })
  .strict();

const playmatSchema = z.object({
  name: z.string().min(1).max(60),
  imageUrl: z.string().url().max(2048),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', { preHandler: requireUser }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId! },
      include: { prefs: true, playmats: { orderBy: { name: 'asc' } } },
    });
    if (!user) return reply.code(401).send({ error: 'AUTH_REQUIRED' });

    return reply.send({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
      prefs: user.prefs ?? null,
      playmats: user.playmats,
    });
  });

  app.patch('/api/me', { preHandler: requireUser }, async (request, reply) => {
    const body = prefsSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });
    const { displayName, ...prefs } = body.data;

    if (displayName) {
      const taken = await prisma.user.findFirst({
        where: { displayName, NOT: { id: request.userId! } },
      });
      if (taken) return reply.code(409).send({ error: 'NAME_TAKEN', message: 'Ce pseudo est déjà pris.' });
      await prisma.user.update({ where: { id: request.userId! }, data: { displayName } });
    }

    if (Object.keys(prefs).length > 0) {
      const data = prefs as Parameters<typeof prisma.userPrefs.update>[0]['data'];
      await prisma.userPrefs.upsert({
        where: { userId: request.userId! },
        create: { userId: request.userId!, ...(data as object) },
        update: data,
      });
    }

    return reply.send({ ok: true });
  });

  app.get('/api/me/export', { preHandler: requireUser }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId! },
      include: {
        prefs: true,
        playmats: true,
        decks: { include: { cards: true } },
        seats: { include: { room: { select: { code: true, gameMode: true, createdAt: true } } } },
      },
    });
    if (!user) return reply.code(401).send({ error: 'AUTH_REQUIRED' });

    const { passwordHash: _omit, ...safe } = user;
    return reply
      .header('content-disposition', 'attachment; filename="mtg-vtt-export.json"')
      .send({ exportedAt: new Date().toISOString(), user: safe });
  });

  app.delete('/api/me', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ password: z.string().max(200) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'PASSWORD_REQUIRED' });

    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(401).send({ error: 'AUTH_REQUIRED' });
    if (!(await verifyPassword(user.passwordHash, body.data.password))) {
      return reply.code(403).send({ error: 'BAD_CREDENTIALS', message: 'Mot de passe incorrect.' });
    }

    await destroyAllSessions(user.id);
    await prisma.user.delete({ where: { id: user.id } });
    clearSessionCookie(reply);
    return reply.send({ ok: true, deleted: true });
  });

  app.post('/api/me/playmats', { preHandler: requireUser }, async (request, reply) => {
    const body = playmatSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });

    const playmat = await prisma.playmat.create({
      data: { userId: request.userId!, ...body.data },
    });
    return reply.code(201).send(playmat);
  });

  app.delete('/api/me/playmats/:id', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const { count } = await prisma.playmat.deleteMany({
      where: { id: params.data.id, userId: request.userId! },
    });
    if (count === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send({ ok: true });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { MAX_SEARCH_LIMIT, searchCards } from './search.js';

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  type: z.enum(['token', 'card']).optional(),
  // Le plafond suit celui de la recherche : une famille de jetons comme
  // « Spirit » compte une centaine d'impressions, et les couper en renvoyait
  // l'essentiel à l'inexistence pour le joueur.
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
});

export async function cardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cards/search', async (request, reply) => {
    const query = searchSchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: query.error.issues });

    const results = await searchCards({
      query: query.data.q,
      tokensOnly: query.data.type === 'token',
      excludeTokens: query.data.type === 'card',
      ...(query.data.limit ? { limit: query.data.limit } : {}),
    });
    // Le client ira chercher les images chez Scryfall lui-même : on ne renvoie
    // que des URLs, jamais de binaire.
    return reply.send({ results });
  });

  /**
   * Métadonnées de plusieurs cartes d'un coup. Le client s'en sert pour nommer
   * ce qu'il voit ; les images, elles, viennent directement de Scryfall.
   */
  app.post('/api/cards/batch', async (request, reply) => {
    const body = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(500) })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const cards = await prisma.card.findMany({
      where: { scryfallId: { in: body.data.ids } },
      select: {
        scryfallId: true,
        name: true,
        setCode: true,
        collectorNumber: true,
        typeLine: true,
        manaCost: true,
        colorIdentity: true,
        layout: true,
        imageUris: true,
        faces: true,
        power: true,
        toughness: true,
      },
    });
    return reply.send({ cards });
  });

  app.get('/api/cards/:scryfallId', async (request, reply) => {
    const params = z.object({ scryfallId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const card = await prisma.card.findUnique({ where: { scryfallId: params.data.scryfallId } });
    if (!card) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send(card);
  });

  /** Toutes les impressions d'une carte, pour choisir une édition précise. */
  app.get('/api/cards/:scryfallId/printings', async (request, reply) => {
    const params = z.object({ scryfallId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const card = await prisma.card.findUnique({ where: { scryfallId: params.data.scryfallId } });
    if (!card) return reply.code(404).send({ error: 'NOT_FOUND' });

    const printings = await prisma.card.findMany({
      where: card.oracleId ? { oracleId: card.oracleId } : { normalizedName: card.normalizedName },
      orderBy: [{ releasedAt: 'desc' }, { collectorNumber: 'asc' }],
      take: 200,
    });
    return reply.send({ printings });
  });
}

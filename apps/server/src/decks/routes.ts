import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DECK_ZONES } from '@mtg/shared';
import { prisma } from '../db.js';
import { requireUser } from '../auth/guard.js';
import { DeckImportError } from '../import/archidekt.js';
import { getDeck, listDecks, persistImport, resyncDeck, runImport } from './service.js';
import { DeckEditError, loadDeckForEdit, saveDeckFromText } from './edit.js';
import { renderDeckText } from './text-format.js';

const importSchema = z
  .object({
    source: z.enum(['MANUAL', 'ARCHIDEKT', 'MOXFIELD', 'TEXT']).optional(),
    url: z.string().url().max(2048).optional(),
    text: z.string().max(200_000).optional(),
    name: z.string().min(1).max(120).optional(),
    /** Faux pour un invité : l'import est résolu et renvoyé, mais rien n'est écrit. */
    persist: z.boolean().default(true),
    /** Mise à jour d'un deck existant plutôt que création. */
    deckId: z.string().uuid().optional(),
  })
  .strict();

/** Traduit une erreur d'import en réponse HTTP ; le reste remonte au handler global. */
function sendImportError(reply: FastifyReply, err: unknown) {
  if (err instanceof DeckEditError) {
    // `SOURCE_SYNCED` est un conflit d'état, pas une saisie invalide : le client
    // le rejoue tel quel avec `detachFromSource` une fois la question posée.
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'SOURCE_SYNCED' ? 409 : 400;
    return reply.code(status).send({ error: err.code, message: err.message, hint: err.hint ?? null });
  }
  if (err instanceof DeckImportError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'RATE_LIMITED' ? 429 : err.code === 'UPSTREAM' ? 502 : 400;
    return reply.code(status).send({ error: err.code, message: err.message, hint: err.hint ?? null });
  }
  throw err;
}

export async function deckRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Import. Accessible sans compte : un invité colle sa liste, reçoit le rapport
   * et les cartes résolues, et joue avec — rien n'est persisté pour lui.
   */
  app.post('/api/decks/import', async (request, reply) => {
    const body = importSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });

    try {
      const outcome = await runImport(body.data);
      const persist = body.data.persist && request.userId !== null;

      if (!persist) {
        return reply.send({ persisted: false, report: outcome.report });
      }

      const deckId = await persistImport(outcome, {
        userId: request.userId!,
        ...(body.data.deckId ? { deckId: body.data.deckId } : {}),
        ...(body.data.name ? { name: body.data.name } : {}),
      });
      return reply.send({ persisted: true, deckId, report: outcome.report });
    } catch (err) {
      return sendImportError(reply, err);
    }
  });

  app.get('/api/decks', { preHandler: requireUser }, async (request, reply) => {
    return reply.send({ decks: await listDecks(request.userId!) });
  });

  app.post('/api/decks', { preHandler: requireUser }, async (request, reply) => {
    const body = z
      .object({ name: z.string().min(1).max(120), format: z.string().max(40).nullable().optional() })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });

    const deck = await prisma.deck.create({
      data: { userId: request.userId!, name: body.data.name, format: body.data.format ?? null, source: 'MANUAL' },
    });
    return reply.code(201).send({ id: deck.id });
  });

  app.get('/api/decks/:id', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const deck = await getDeck(params.data.id, request.userId!);
    if (!deck) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send(deck);
  });

  app.patch('/api/decks/:id', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        format: z.string().max(40).nullable().optional(),
        // Cosmétiques du deck : éditables même sur un deck synchronisé, puisque
        // la source externe n'en sait rien et ne les écrasera pas.
        playmatUrl: z.string().url().max(2048).nullable().optional(),
        cardBackUrl: z.string().url().max(2048).nullable().optional(),
      })
      .safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const { count } = await prisma.deck.updateMany({
      where: { id: params.data.id, userId: request.userId! },
      data: body.data,
    });
    if (count === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send({ ok: true });
  });

  app.delete('/api/decks/:id', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const { count } = await prisma.deck.deleteMany({ where: { id: params.data.id, userId: request.userId! } });
    if (count === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send({ ok: true });
  });

  /**
   * Deck sous forme éditable : la liste de ses cartes et la liste texte
   * équivalente, qui amorce l'éditeur. La propriété est vérifiée à partir de la
   * session, jamais d'un identifiant fourni par le client.
   */
  app.get('/api/decks/:id/editor', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    try {
      return reply.send(await loadDeckForEdit(params.data.id, request.userId!));
    } catch (err) {
      return sendImportError(reply, err);
    }
  });

  /**
   * Enregistrement d'une édition.
   *
   * Le contenu arrive soit en liste texte (mode brut de l'éditeur), soit en
   * entrées structurées (mode liste carte par carte) — dans ce cas le serveur
   * les rend lui-même en texte, pour qu'il n'existe qu'un seul générateur de
   * liste et qu'aucune divergence client/serveur ne puisse s'installer.
   * Dans les deux cas le contenu repasse par le parseur et la résolution
   * Scryfall, et rend le même rapport d'import qu'un collage — suggestions
   * comprises.
   */
  app.put('/api/decks/:id/cards', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        text: z.string().max(200_000).optional(),
        entries: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              setCode: z.string().max(12).nullable().optional(),
              collectorNumber: z.string().max(16).nullable().optional(),
              quantity: z.number().int().min(1).max(1000),
              zone: z.enum(DECK_ZONES),
              isFoil: z.boolean(),
            }),
          )
          .max(2000)
          .optional(),
        name: z.string().min(1).max(120).optional(),
        /** Assume la perte du lien avec la source externe. Voir `decks/edit.ts`. */
        detachFromSource: z.boolean().optional(),
      })
      .strict()
      .refine((b) => b.text !== undefined || b.entries !== undefined, {
        message: 'Fournis `text` ou `entries`.',
      })
      .safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    const text = body.data.entries ? renderDeckText(body.data.entries) : body.data.text!;

    try {
      const report = await saveDeckFromText(params.data.id, request.userId!, text, {
        ...(body.data.detachFromSource !== undefined ? { detachFromSource: body.data.detachFromSource } : {}),
        ...(body.data.name ? { name: body.data.name } : {}),
      });
      return reply.send({ ok: true, report });
    } catch (err) {
      return sendImportError(reply, err);
    }
  });

  app.post('/api/decks/:id/resync', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });

    try {
      const report = await resyncDeck(params.data.id, request.userId!);
      return reply.send({ ok: true, report });
    } catch (err) {
      return sendImportError(reply, err);
    }
  });
}

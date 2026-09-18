import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { languageSchema } from '@mtg/shared';
import { prisma } from '../db.js';
import { MAX_SEARCH_LIMIT, searchCards } from './search.js';
import { loadPendingSubstitutes, prismaLocalizationStore } from './localization-store.js';
import { prismaBulkLocalizationSource } from './localized-printings.js';
import {
  fetchLocalizedElsewhere,
  fetchLocalizedPrinting,
  resolveLocalizedCards,
  scheduleBackgroundLocalization,
  scheduleSubstituteBackfill,
  type CatalogCard,
} from './localization.js';

/**
 * La langue passe par l'API des cartes, jamais par le protocole de jeu.
 *
 * C'est délibéré : le protocole continue de ne transporter qu'un `scryfallId`,
 * et chaque client résout lui-même l'image dans sa langue. Sans cela, il aurait
 * fallu monter PROTOCOL_VERSION et faire dépendre ce que voit un joueur d'une
 * simple préférence d'affichage — deux joueurs d'une même table peuvent lire la
 * table dans deux langues différentes sans que rien de l'état ne change.
 *
 * Le schéma vient de `@mtg/shared` : c'est le même que celui de la préférence
 * de compte, et c'est voulu — une langue acceptée par le sélecteur doit être
 * acceptée par cette route, sans qu'aucune liste n'ait à être tenue deux fois.
 */

/**
 * Ce dont la résolution a besoin : le numéro de collection est la clé chez
 * Scryfall, `oracleId` sert au rattrapage par le nom quand cette impression-là
 * n'existe pas dans la langue demandée, `typeLine` porte l'exception des
 * terrains de base, et les derniers champs sont les **traits de ressemblance** —
 * l'œuvre, le cadre, la bordure — sur lesquels `chooseSubstitute` choisit
 * l'impression traduite la plus proche de celle que le joueur a choisie.
 *
 * Les traits sont nullables : une carte ingérée avant l'ajout des colonnes les
 * rend `null`, et le classement retombe alors sur la règle d'avant.
 */
const CATALOG_SELECT = {
  scryfallId: true,
  name: true,
  setCode: true,
  collectorNumber: true,
  oracleId: true,
  typeLine: true,
  imageUris: true,
  faces: true,
  // Elle seule dit si le catalogue localisé, ingéré à une date donnée, a le
  // droit de répondre pour cette carte. Voir `bulkAuthorityDate`.
  releasedAt: true,
  illustrationId: true,
  frame: true,
  frameEffects: true,
  isTextless: true,
  borderColor: true,
  isFullArt: true,
  setType: true,
} as const;

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

  /**
   * Les mêmes cartes, dans la langue demandée.
   *
   * Une carte jamais imprimée dans cette langue revient en anglais avec
   * `fallback: true` : ce n'est pas une erreur, c'est le cas courant. Une carte
   * que la requête n'a pas eu le temps de résoudre revient `pending: true` —
   * redemander plus tard rendra la traduction.
   *
   * Comme partout, on ne renvoie que des URL : le navigateur va chercher les
   * illustrations chez Scryfall, elles ne transitent jamais par nous.
   */
  app.post('/api/cards/localized', async (request, reply) => {
    const body = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(500),
        language: languageSchema,
      })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });

    /*
     * Le rattrapage des lignes anciennes, lancé une seule fois par langue et par
     * processus, et **jamais attendu** : la réponse du joueur ne dépend pas de
     * lui.
     *
     * Il est ici, et pas au démarrage, pour deux raisons. Un serveur que
     * personne n'utilise en français n'a rien à rattraper. Et au démarrage,
     * l'ingestion Scryfall tient déjà le robinet partagé : y ajouter cinq cents
     * recherches ne ferait que rallonger les deux.
     */
    scheduleSubstituteBackfill(body.data.language, {
      store: prismaLocalizationStore,
      fetch: fetchLocalizedPrinting,
      fetchElsewhere: fetchLocalizedElsewhere,
      bulk: prismaBulkLocalizationSource,
      loadPending: loadPendingSubstitutes,
    });

    const cards = (await prisma.card.findMany({
      where: { scryfallId: { in: body.data.ids } },
      select: CATALOG_SELECT,
    })) as CatalogCard[];

    const resolved = await resolveLocalizedCards({
      cards,
      language: body.data.language,
      store: prismaLocalizationStore,
      fetch: fetchLocalizedPrinting,
      fetchElsewhere: fetchLocalizedElsewhere,
      /*
       * Le catalogue localisé passe **avant** le réseau, et ne consomme pas le
       * plafond : une carte qu'il connaît est résolue dans la réponse même, en
       * français, sans `pending` ni relance. Le réseau reste branché juste
       * derrière pour ce qu'il ne connaît pas — une impression parue depuis la
       * dernière ingestion, ou une base dont l'ingestion n'a pas encore tourné.
       */
      bulk: prismaBulkLocalizationSource,
    });

    /*
     * Ce que le plafond a laissé de côté continue en tâche de fond, après la
     * réponse. Le plafond est là pour que la connexion ne reste pas ouverte
     * pendant que Scryfall répond, pas pour renoncer aux cartes qui dépassent :
     * sans cette reprise, un deck de cent cartes plafonnait mécaniquement à
     * quarante traductions par chargement de page.
     */
    scheduleBackgroundLocalization(resolved.unresolved, body.data.language, {
      store: prismaLocalizationStore,
      fetch: fetchLocalizedPrinting,
      fetchElsewhere: fetchLocalizedElsewhere,
      bulk: prismaBulkLocalizationSource,
    });

    return reply.send({ language: resolved.language, cards: resolved.cards });
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

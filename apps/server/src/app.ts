import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { PROTOCOL_VERSION } from '@mtg/shared';
import { env, isProd } from './env.js';
import { attachUser } from './auth/guard.js';
import { authRoutes } from './auth/routes.js';
import { userRoutes } from './users/routes.js';
import { deckRoutes } from './decks/routes.js';
import { cardRoutes } from './cards/routes.js';
import { roomRoutes } from './rooms/routes.js';
import { adminRoutes } from './admin/routes.js';
import { cardCount } from './cards/ingest.js';
import { registerWebSocket } from './ws/server.js';
import { liveRoomCount } from './game/registry.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: isProd ? 'info' : 'debug',
      ...(isProd ? {} : { transport: undefined }),
    },
    // Le serveur tourne derrière un reverse proxy : on fait confiance aux
    // en-têtes de transfert pour l'IP cliente, dont dépend la limitation.
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  // Plafond général. Les routes d'auth ont en plus leur propre seau par compte.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: () => false,
  });

  app.decorateRequest('userId', null);
  app.addHook('preHandler', attachUser);

  app.get('/api/health', async () => ({
    ok: true,
    cards: await cardCount().catch(() => -1),
    rooms: liveRoomCount(),
    protocol: PROTOCOL_VERSION,
  }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(deckRoutes);
  await app.register(cardRoutes);
  await app.register(roomRoutes);
  // Toutes ses routes sont gardées par `requireAdmin`, qui refuse en 404 — la
  // même que celle rendue plus bas pour tout `/api` inconnu. Voir docs/admin.md.
  await app.register(adminRoutes);

  // Le serveur WebSocket se greffe sur le serveur HTTP de Fastify, une fois prêt.
  app.addHook('onReady', async () => {
    registerWebSocket(app);
  });

  // En production, le même service sert le client construit. En développement,
  // Vite s'en charge et proxifie /api et /ws vers ici.
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
    });

    /*
     * Le service worker ne doit jamais être servi depuis un cache : une version
     * figée continuerait de servir l'ancienne coquille après un déploiement, et
     * l'on n'aurait aucun moyen de la déloger. Le manifeste suit la même règle.
     *
     * L'en-tête est posé ici plutôt que dans `setHeaders` : @fastify/static
     * écrit son propre `cache-control` après ce rappel, et l'écrasait.
     *
     * `no-store` plutôt que `no-cache` : en production, Cloudflare met en cache
     * tout ce qui finit en `.js` et réécrit alors la durée de vie navigateur
     * (on mesurait `max-age=14400`). Une réponse `no-store` n'est pas mise en
     * cache au bord, et notre en-tête arrive intact jusqu'au navigateur.
     */
    app.addHook('onSend', async (request, reply) => {
      if (request.url === '/sw.js' || request.url === '/site.webmanifest') {
        void reply.header('cache-control', 'no-store, no-cache, must-revalidate');
        void reply.header('cdn-cache-control', 'no-store');
      }
    });
    // Application à une seule page : toute route inconnue rend index.html, sauf
    // sous /api et /ws, qui doivent répondre 404 franchement.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Erreur non gérée');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    // On ne renvoie jamais la trace au client en production.
    return reply.code(status).send({
      error: status === 500 ? 'INTERNAL' : error.code ?? 'ERROR',
      message: status === 500 && isProd ? 'Erreur interne.' : error.message,
    });
  });

  return app;
}

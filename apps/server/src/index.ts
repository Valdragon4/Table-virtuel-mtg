import { buildApp } from './app.js';
import { env } from './env.js';
import { prisma, disconnect } from './db.js';
import { prepareDatabase } from './lib/bootstrap.js';
import { backfillTokenFlags, cardCount, ingestCards } from './cards/ingest.js';
import { pruneSessions } from './auth/session.js';
import { authAttempts } from './lib/throttle.js';
import { sweepRooms } from './game/registry.js';

const HOUR_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const app = await buildApp();
  await prepareDatabase(app.log);

  // L'ingestion initiale prend plusieurs minutes : elle tourne en tâche de fond
  // pour que le serveur réponde immédiatement, y compris au premier démarrage.
  if (env.INGEST_ON_BOOT) {
    void (async () => {
      try {
        const count = await cardCount();
        if (count === 0) app.log.info('Base de cartes vide : ingestion Scryfall en cours…');
        const result = await ingestCards();
        app.log.info(
          result.skipped
            ? 'Bulk Scryfall déjà à jour, ingestion ignorée.'
            : `Ingestion terminée : ${result.cardsUpserted} cartes en ${Math.round(result.durationMs / 1000)} s.`,
        );
        /*
         * Reprise des lignes déjà en base. Elle est indispensable ici : quand le
         * bulk n'a pas bougé, l'ingestion est ignorée, et une base peuplée avant
         * un changement de la règle « qu'est-ce qu'un jeton ? » resterait fausse
         * indéfiniment. C'est une relecture locale, sans réseau.
         */
        const fixed = await backfillTokenFlags();
        if (fixed > 0) app.log.info(`${fixed} carte(s) reclassée(s) en jeton.`);
      } catch (err) {
        app.log.error({ err }, "L'ingestion Scryfall a échoué ; le serveur continue avec la base existante.");
      }
    })();
  }

  // Entretien horaire : ingestion quotidienne à l'heure configurée, purge des
  // sessions expirées, évacuation des seaux de limitation.
  const maintenance = setInterval(() => {
    void (async () => {
      authAttempts.sweep();
      sweepRooms(app.log);
      const pruned = await pruneSessions().catch(() => 0);
      if (pruned > 0) app.log.info(`${pruned} session(s) expirée(s) purgée(s).`);

      if (new Date().getUTCHours() === env.INGEST_CRON_HOUR) {
        try {
          const result = await ingestCards();
          if (!result.skipped) app.log.info(`Ingestion quotidienne : ${result.cardsUpserted} cartes.`);
        } catch (err) {
          app.log.error({ err }, 'Ingestion quotidienne en échec.');
        }
      }
    })();
  }, HOUR_MS);
  maintenance.unref();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const shutdown = (signal: string): void => {
    void (async () => {
      app.log.info(`${signal} reçu, arrêt en cours.`);
      clearInterval(maintenance);
      await app.close();
      await disconnect();
      process.exit(0);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

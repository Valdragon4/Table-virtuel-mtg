/**
 * Préparation de la base au démarrage : extensions et index que Prisma ne sait
 * pas déclarer. Tout est idempotent, donc rejouable à chaque démarrage.
 */
import { prisma } from '../db.js';

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  // Recherche floue sur le nom de carte (barre de recherche, suggestions d'import).
  `CREATE INDEX IF NOT EXISTS card_normalized_name_trgm
     ON "Card" USING GIN ("normalizedName" gin_trgm_ops)`,
  // Résolution des cartes recto-verso par leur seule face avant.
  `CREATE INDEX IF NOT EXISTS card_front_name_idx
     ON "Card" (split_part("normalizedName", ' // ', 1))`,
  // Choix de l'impression par défaut : meilleur score, puis la plus récente.
  `CREATE INDEX IF NOT EXISTS card_printing_pref_idx
     ON "Card" ("normalizedName", "printingScore" DESC, "releasedAt" DESC)`,
];

export async function prepareDatabase(log: { info: (msg: string) => void }): Promise<void> {
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  log.info('Base prête : extensions et index vérifiés.');
}

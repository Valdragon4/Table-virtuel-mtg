/**
 * Ingestion du bulk `default_cards` de Scryfall.
 *
 * Le fichier pèse plusieurs centaines de Mo : il est lu en flux et jamais chargé
 * en mémoire. Les lignes sont poussées par lots dans Postgres avec un upsert.
 */
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { normalizeName } from '../import/normalize.js';
import {
  compactFaces,
  getBulkEntry,
  isTokenCard,
  printingScore,
  scryfall,
  type ScryfallCard,
} from './scryfall.js';

const BATCH_SIZE = 500;

export interface IngestResult {
  skipped: boolean;
  bulkUpdatedAt: Date;
  cardsUpserted: number;
  durationMs: number;
}

/** Vrai si ce bulk a déjà été ingéré avec succès. */
async function alreadyIngested(bulkType: string, bulkUpdatedAt: Date): Promise<boolean> {
  const run = await prisma.ingestRun.findFirst({
    where: { bulkType, bulkUpdatedAt, finishedAt: { not: null }, error: null },
  });
  return run !== null;
}

export async function ingestCards(options: { force?: boolean; bulkType?: string } = {}): Promise<IngestResult> {
  const bulkType = options.bulkType ?? 'default_cards';
  const startedAt = Date.now();
  const entry = await getBulkEntry(bulkType);
  const bulkUpdatedAt = new Date(entry.updated_at);

  if (!options.force && (await alreadyIngested(bulkType, bulkUpdatedAt))) {
    return { skipped: true, bulkUpdatedAt, cardsUpserted: 0, durationMs: Date.now() - startedAt };
  }

  const run = await prisma.ingestRun.create({ data: { bulkType, bulkUpdatedAt } });

  try {
    const res = await scryfall.raw(entry.jsonl_download_uri, { headers: { Accept: 'application/gzip' } });
    if (!res.body) throw new Error('Réponse Scryfall sans corps');

    let batch: ScryfallCard[] = [];
    let upserted = 0;

    // Le fichier fait plusieurs centaines de Mo décompressé : il est lu ligne à
    // ligne, jamais chargé en mémoire. `for await` applique la contre-pression,
    // donc le téléchargement ralentit tout seul pendant qu'un lot part en base.
    const lines = createInterface({
      input: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(createGunzip()),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    for await (const line of lines) {
      const trimmed = line.trim();
      // Le JSONL de Scryfall est parfois encadré par des lignes vides.
      if (!trimmed || trimmed === '[' || trimmed === ']') continue;

      batch.push(JSON.parse(trimmed.replace(/,$/, '')) as ScryfallCard);
      if (batch.length >= BATCH_SIZE) {
        const toFlush = batch;
        batch = [];
        upserted += await upsertBatch(toFlush);
      }
    }

    if (batch.length > 0) upserted += await upsertBatch(batch);

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), cardsUpserted: upserted },
    });

    return { skipped: false, bulkUpdatedAt, cardsUpserted: upserted, durationMs: Date.now() - startedAt };
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), error: String(err).slice(0, 1000) },
    });
    throw err;
  }
}

/**
 * Les valeurs JSON partent en texte, avec un cast explicite côté SQL : un tableau
 * JavaScript passé tel quel serait pris pour un tableau Postgres, pas pour du jsonb.
 */
function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function toRow(card: ScryfallCard): Prisma.Sql {
  const isToken = isTokenCard(card);
  const finishes = card.finishes ?? [];

  return Prisma.sql`(
    ${card.id},
    ${card.oracle_id ?? null},
    ${card.name},
    ${normalizeName(card.name)},
    ${card.set},
    ${card.set_name},
    ${card.set_type ?? 'expansion'},
    ${card.collector_number},
    ${card.type_line ?? ''},
    ${card.mana_cost ?? null},
    ${card.cmc ?? 0},
    ${card.color_identity ?? []},
    ${card.colors ?? []},
    ${card.layout},
    ${card.rarity ?? 'common'},
    ${card.image_uris ? JSON.stringify(card.image_uris) : null}::jsonb,
    ${jsonOrNull(compactFaces(card))}::jsonb,
    ${isToken},
    ${card.promo ?? false},
    ${card.digital ?? false},
    ${card.variation ?? false},
    ${card.full_art ?? false},
    ${finishes.includes('foil') || finishes.includes('etched')},
    ${finishes.includes('nonfoil')},
    ${card.lang},
    ${card.border_color ?? 'black'},
    ${card.released_at ? new Date(card.released_at) : null},
    ${card.power ?? null},
    ${card.toughness ?? null},
    ${card.loyalty ?? null},
    ${printingScore(card)},
    ${new Date()}
  )`;
}

async function upsertBatch(cards: ScryfallCard[]): Promise<number> {
  if (cards.length === 0) return 0;
  const values = Prisma.join(cards.map(toRow));

  await prisma.$executeRaw`
    INSERT INTO "Card" (
      "scryfallId", "oracleId", "name", "normalizedName", "setCode", "setName",
      "setType", "collectorNumber", "typeLine", "manaCost", "cmc", "colorIdentity", "colors",
      "layout", "rarity", "imageUris", "faces", "isToken", "isPromo", "isDigital",
      "isVariation", "isFullArt", "hasFoil", "hasNonFoil", "lang", "borderColor",
      "releasedAt", "power", "toughness", "loyalty", "printingScore", "updatedAt"
    )
    VALUES ${values}
    ON CONFLICT ("scryfallId") DO UPDATE SET
      "oracleId" = EXCLUDED."oracleId",
      "name" = EXCLUDED."name",
      "normalizedName" = EXCLUDED."normalizedName",
      "setCode" = EXCLUDED."setCode",
      "setName" = EXCLUDED."setName",
      "setType" = EXCLUDED."setType",
      "collectorNumber" = EXCLUDED."collectorNumber",
      "typeLine" = EXCLUDED."typeLine",
      "manaCost" = EXCLUDED."manaCost",
      "cmc" = EXCLUDED."cmc",
      "colorIdentity" = EXCLUDED."colorIdentity",
      "colors" = EXCLUDED."colors",
      "layout" = EXCLUDED."layout",
      "rarity" = EXCLUDED."rarity",
      "imageUris" = EXCLUDED."imageUris",
      "faces" = EXCLUDED."faces",
      "isToken" = EXCLUDED."isToken",
      "isPromo" = EXCLUDED."isPromo",
      "isDigital" = EXCLUDED."isDigital",
      "isVariation" = EXCLUDED."isVariation",
      "isFullArt" = EXCLUDED."isFullArt",
      "hasFoil" = EXCLUDED."hasFoil",
      "hasNonFoil" = EXCLUDED."hasNonFoil",
      "lang" = EXCLUDED."lang",
      "borderColor" = EXCLUDED."borderColor",
      "releasedAt" = EXCLUDED."releasedAt",
      "power" = EXCLUDED."power",
      "toughness" = EXCLUDED."toughness",
      "loyalty" = EXCLUDED."loyalty",
      "printingScore" = EXCLUDED."printingScore",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
  return cards.length;
}

export async function cardCount(): Promise<number> {
  return prisma.card.count();
}

/**
 * Reprise d'une base déjà peuplée, sans rien retélécharger.
 *
 * La règle qui reconnaît un jeton a changé : les cartes réversibles n'ont pas
 * de ligne de type au premier niveau, et leurs faces n'étaient pas lues. Les
 * lignes déjà en base portent pourtant tout ce qu'il faut pour trancher — leur
 * disposition, leur ligne de type, leurs faces —, donc la reprise est une simple
 * relecture locale. Un réimport complet la ferait aussi, mais il coûte plusieurs
 * centaines de mégaoctets et une bonne dizaine de minutes pour le même résultat.
 *
 * Elle n'ajoute jamais de jeton absent de la base : pour cela, c'est l'ingestion
 * du bulk qui fait foi. Elle corrige le drapeau des lignes déjà présentes.
 */
export async function backfillTokenFlags(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Card"
    SET "isToken" = true, "updatedAt" = now()
    WHERE "isToken" = false
      AND (
        "layout" IN ('token', 'double_faced_token')
        OR "typeLine" ~ '(^|[[:space:]])Token([[:space:]]|$)'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce("faces", '[]'::jsonb)) AS face
          WHERE coalesce(face->>'typeLine', '') ~ '(^|[[:space:]])Token([[:space:]]|$)'
        )
      )
  `;
}

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
import { LANGUAGES, SCRYFALL_LANG, type Language } from '@mtg/shared';
import { prisma } from '../db.js';
import { normalizeName } from '../import/normalize.js';
import { CATALOG_LANGUAGE } from './languages.js';
import { localizedFaces, printedNameOf } from './localization.js';
import { LOCALIZED_BULK_TYPE, resetBulkAuthority } from './localized-printings.js';
import {
  compactFaces,
  getBulkEntry,
  illustrationIdsOf,
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
  /**
   * L'ingestion du catalogue **localisé**, menée dans la foulée. `null` quand
   * elle a échoué : c'est délibérément non bloquant — le catalogue anglais est
   * la base de tout le reste, et son ingestion ne doit pas être perdue parce
   * que le bulk multilingue n'était pas joignable.
   */
  localized: LocalizedIngestResult | null;
}

export interface LocalizedIngestResult {
  skipped: boolean;
  bulkUpdatedAt: Date;
  /** Objets carte lus dans le flux, toutes langues confondues. */
  scanned: number;
  /** Ceux qui ont été retenus et écrits : nos langues seulement. */
  printingsUpserted: number;
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

  /*
   * Le catalogue localisé suit le catalogue anglais, **y compris quand celui-ci
   * n'a pas bougé**. Les deux bulks ne sont pas publiés à la même minute, et
   * renoncer au second parce que le premier était déjà à jour aurait laissé les
   * traductions vieillir d'un jour à chaque fois.
   *
   * Il ne fait jamais échouer l'ingestion anglaise : le catalogue est ce qui
   * fait marcher la recherche, les decks et les parties ; les traductions, elles,
   * ont un repli — le chemin paresseux, qui reste branché.
   */
  const suivre = async (): Promise<LocalizedIngestResult | null> =>
    ingestLocalizedPrintings({ force: options.force ?? false }).catch(() => null);

  if (!options.force && (await alreadyIngested(bulkType, bulkUpdatedAt))) {
    return {
      skipped: true,
      bulkUpdatedAt,
      cardsUpserted: 0,
      durationMs: Date.now() - startedAt,
      localized: await suivre(),
    };
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

    return {
      skipped: false,
      bulkUpdatedAt,
      cardsUpserted: upserted,
      durationMs: Date.now() - startedAt,
      localized: await suivre(),
    };
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

/**
 * L'œuvre du **recto**.
 *
 * Scryfall pose `illustration_id` au premier niveau d'une carte ordinaire, et
 * **par face** sur une carte recto-verso. On retient celui du recto : c'est
 * l'illustration que le joueur voit dans le sélecteur d'impression et celle
 * qu'il choisit. La comparaison, elle, accepte n'importe quelle face du
 * candidat (`illustrationIdsOf`), donc on ne perd rien à ne stocker qu'un
 * identifiant.
 */
function illustrationIdOf(card: ScryfallCard): string | null {
  return card.illustration_id ?? card.card_faces?.[0]?.illustration_id ?? null;
}

/**
 * Les effets de cadre, tableau vide compris.
 *
 * Scryfall **omet** la clé quand il n'y en a aucun : c'est un fait, pas une
 * ignorance, et on l'écrit donc `[]`. Écrire `null` — le cas de la grande
 * majorité des cartes — ferait taire le critère de ressemblance pile là où il
 * sert le plus, puisque `null` y veut dire « on ne sait pas » et ne départage
 * personne. La valeur `null` reste réservée aux lignes jamais ré-ingérées.
 */
function frameEffectsOf(card: ScryfallCard): string {
  return JSON.stringify(card.frame_effects ?? []);
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
    ${illustrationIdOf(card)},
    ${card.frame ?? null},
    ${frameEffectsOf(card)}::jsonb,
    ${card.textless ?? null},
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
      "illustrationId", "frame", "frameEffects", "isTextless",
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
      "illustrationId" = EXCLUDED."illustrationId",
      "frame" = EXCLUDED."frame",
      "frameEffects" = EXCLUDED."frameEffects",
      "isTextless" = EXCLUDED."isTextless",
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

/* ————————————————————————————————————————————————————————————————————————————
 * Le catalogue des impressions traduites
 * ——————————————————————————————————————————————————————————————————————————— */

/**
 * Les langues qu'on retient du bulk multilingue, indexées par le code que
 * Scryfall publie.
 *
 * **C'est le levier qui rend l'opération raisonnable, et il est mesuré.** Le
 * bulk `all_cards` porte 542 539 objets carte pour 2,9 Go décompressés, dans
 * dix-neuf langues. Nous n'en voulons que deux, et l'anglais *est déjà* le
 * catalogue : il ne reste donc que le français, soit **58 847 impressions** —
 * onze pour cent du flux. Tout le reste est écarté au fil de la lecture, avant
 * même d'être transformé en ligne.
 *
 * La liste se dérive de `LANGUAGES` : ajouter l'espagnol au sélecteur suffit à
 * l'ingérer au prochain passage, sans toucher à ce fichier. C'est la même
 * discipline qu'ailleurs — une seule source pour « quelles langues ».
 */
const LANGUES_RETENUES = new Map<string, Language>(
  LANGUAGES.filter((l) => l !== CATALOG_LANGUAGE).map((l) => [SCRYFALL_LANG[l], l]),
);

/**
 * Les motifs qui permettent d'écarter une ligne **sans la parser**.
 *
 * `JSON.parse` sur 542 539 objets domine le coût de l'ingestion, et neuf sur dix
 * seront jetés. Chercher `"lang":"fr"` dans la chaîne brute coûte une fraction
 * de cela.
 *
 * **Le sens du test est ce qui le rend sûr.** Un faux positif ne coûte qu'un
 * parse inutile, immédiatement rattrapé par la vérification sur `card.lang`
 * juste après. Un faux négatif serait une carte perdue — il est impossible,
 * puisque le motif est exactement la paire clé/valeur que Scryfall écrit. Ce
 * filtre ne décide donc jamais seul de ce qui entre en base.
 */
const MOTIFS_DE_LANGUE = [...LANGUES_RETENUES.keys()].map((code) => `"lang":"${code}"`);

function peutConcerner(ligne: string): boolean {
  for (const motif of MOTIFS_DE_LANGUE) {
    if (ligne.includes(motif)) return true;
  }
  return false;
}

/**
 * Une impression traduite, réduite à ce que nous avons le droit de garder.
 *
 * **C'est ici que se joue l'invariant de droits, et c'est le piège principal de
 * tout ce chantier.** Le bulk `all_cards` contient le texte des règles dans
 * toutes les langues : `oracle_text`, `printed_text`, `flavor_text`,
 * `printed_type_line`, et les mêmes sur chaque face. Rien de tout cela n'est lu
 * ici. On ne retient que :
 *
 *  - des **URL** d'illustration, que le navigateur du joueur ira chercher
 *    lui-même chez Scryfall ;
 *  - le **nom imprimé**, qui est un nom et non un texte de règles ;
 *  - des **métadonnées d'identification** : édition, numéro de collection,
 *    cadre, bordure, œuvre, date.
 *
 * `printedName` et `faces` ne sont pas recopiés depuis le bulk mais **calculés
 * par les fonctions du chemin réseau** (`printedNameOf`, `localizedFaces`).
 * C'est ce qui garantit que les deux chemins écrivent la même chose : il n'y a
 * qu'une implémentation, appelée à deux moments. `localizedFaces` s'appuie sur
 * `compactFaces`, qui ne recopie déjà aucun texte de règles — la règle est donc
 * tenue au même endroit pour le catalogue anglais et pour les traductions.
 */
function toLocalizedRow(card: ScryfallCard, language: Language): Prisma.Sql {
  const quality = card as { image_status?: string; highres_image?: boolean };
  const games = card.games ?? [];
  return Prisma.sql`(
    ${card.id},
    ${card.oracle_id ?? null},
    ${language},
    ${card.set},
    ${card.collector_number},
    ${printedNameOf(card)},
    ${card.image_uris ? JSON.stringify(card.image_uris) : null}::jsonb,
    ${jsonOrNull(localizedFaces(card))}::jsonb,
    ${quality.image_status ?? null},
    ${quality.highres_image ?? false},
    ${JSON.stringify(illustrationIdsOf(card))}::jsonb,
    ${card.frame ?? null},
    ${JSON.stringify(card.frame_effects ?? [])}::jsonb,
    ${card.border_color ?? null},
    ${card.full_art ?? false},
    ${card.textless ?? null},
    ${card.set_type ?? null},
    ${card.released_at ? new Date(card.released_at) : null},
    ${card.digital ?? false},
    ${card.promo ?? false},
    ${card.variation ?? false},
    ${games.includes('paper')},
    ${new Date()}
  )`;
}

async function upsertLocalizedBatch(
  rows: Array<{ card: ScryfallCard; language: Language }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = Prisma.join(rows.map((r) => toLocalizedRow(r.card, r.language)));

  await prisma.$executeRaw`
    INSERT INTO "LocalizedPrinting" (
      "scryfallId", "oracleId", "language", "setCode", "collectorNumber",
      "printedName", "imageUris", "faces", "imageStatus", "highresImage",
      "illustrationIds", "frame", "frameEffects", "borderColor", "isFullArt",
      "isTextless", "setType", "releasedAt", "isDigital", "isPromo",
      "isVariation", "isPaper", "updatedAt"
    )
    VALUES ${values}
    ON CONFLICT ("scryfallId") DO UPDATE SET
      "oracleId" = EXCLUDED."oracleId",
      "language" = EXCLUDED."language",
      "setCode" = EXCLUDED."setCode",
      "collectorNumber" = EXCLUDED."collectorNumber",
      "printedName" = EXCLUDED."printedName",
      "imageUris" = EXCLUDED."imageUris",
      "faces" = EXCLUDED."faces",
      "imageStatus" = EXCLUDED."imageStatus",
      "highresImage" = EXCLUDED."highresImage",
      "illustrationIds" = EXCLUDED."illustrationIds",
      "frame" = EXCLUDED."frame",
      "frameEffects" = EXCLUDED."frameEffects",
      "borderColor" = EXCLUDED."borderColor",
      "isFullArt" = EXCLUDED."isFullArt",
      "isTextless" = EXCLUDED."isTextless",
      "setType" = EXCLUDED."setType",
      "releasedAt" = EXCLUDED."releasedAt",
      "isDigital" = EXCLUDED."isDigital",
      "isPromo" = EXCLUDED."isPromo",
      "isVariation" = EXCLUDED."isVariation",
      "isPaper" = EXCLUDED."isPaper",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
  return rows.length;
}

/**
 * Ingestion du bulk `all_cards` : toutes les impressions, dans toutes les
 * langues — dont on ne garde que les nôtres.
 *
 * ——— Ce que ça coûte, mesuré et non estimé
 *
 * 393 Mo compressés, 2,9 Go une fois décompressés, 542 539 objets carte. Le
 * fichier est lu **en flux**, exactement comme `default_cards` : jamais un
 * `JSON.parse` du tout, jamais le fichier posé sur disque. La contre-pression de
 * `for await` fait ralentir le téléchargement pendant qu'un lot part en base, et
 * l'empreinte mémoire mesurée sur ce flux plafonne à **108 Mo** — le coût d'un
 * lot, pas celui du fichier. C'est ce qui rend l'opération possible sans toucher
 * aux limites du conteneur.
 *
 * ——— Ce qu'on n'en garde pas
 *
 * Neuf objets sur dix sont écartés à la lecture, sur la seule langue. Et de ceux
 * qu'on garde, on ne retient que des URL, des noms et des métadonnées : voir
 * `toLocalizedRow`, où l'invariant de droits est tenu ligne par ligne.
 *
 * ——— Ce qui n'est jamais supprimé
 *
 * L'écriture est un `INSERT … ON CONFLICT DO UPDATE`, jamais un `DELETE`. Une
 * impression que Scryfall retirerait de son bulk resterait donc en base :
 * périmée, mais inoffensive — elle ne peut au pire que proposer une substitution
 * qui n'existe plus, ce que le client traite déjà comme une URL qui ne répond
 * pas. Le prix d'un balayage destructif — perdre des lignes à cause d'un bulk
 * tronqué par une coupure réseau — serait bien plus élevé.
 */
export async function ingestLocalizedPrintings(
  options: { force?: boolean } = {},
): Promise<LocalizedIngestResult> {
  const startedAt = Date.now();

  if (LANGUES_RETENUES.size === 0) {
    // Le catalogue est déjà dans la seule langue que nous servons : il n'y a
    // rien à ingérer, et surtout rien à télécharger.
    return {
      skipped: true,
      bulkUpdatedAt: new Date(0),
      scanned: 0,
      printingsUpserted: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const entry = await getBulkEntry(LOCALIZED_BULK_TYPE);
  const bulkUpdatedAt = new Date(entry.updated_at);

  if (!options.force && (await alreadyIngested(LOCALIZED_BULK_TYPE, bulkUpdatedAt))) {
    return {
      skipped: true,
      bulkUpdatedAt,
      scanned: 0,
      printingsUpserted: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const run = await prisma.ingestRun.create({
    data: { bulkType: LOCALIZED_BULK_TYPE, bulkUpdatedAt },
  });

  try {
    const res = await scryfall.raw(entry.jsonl_download_uri, {
      headers: { Accept: 'application/gzip' },
    });
    if (!res.body) throw new Error('Réponse Scryfall sans corps');

    let batch: Array<{ card: ScryfallCard; language: Language }> = [];
    let upserted = 0;
    let scanned = 0;

    const lines = createInterface({
      input: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]).pipe(
        createGunzip(),
      ),
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '[' || trimmed === ']') continue;
      scanned += 1;
      if (!peutConcerner(trimmed)) continue;

      const card = JSON.parse(trimmed.replace(/,$/, '')) as ScryfallCard;
      const language = LANGUES_RETENUES.get(card.lang);
      if (!language) continue;

      batch.push({ card, language });
      if (batch.length >= BATCH_SIZE) {
        const toFlush = batch;
        batch = [];
        upserted += await upsertLocalizedBatch(toFlush);
      }
    }

    if (batch.length > 0) upserted += await upsertLocalizedBatch(batch);

    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), cardsUpserted: upserted },
    });
    // La date d'autorité vient de changer : sans cela, le bulk fraîchement
    // ingéré resterait muet jusqu'à l'expiration du cache.
    resetBulkAuthority();

    return {
      skipped: false,
      bulkUpdatedAt,
      scanned,
      printingsUpserted: upserted,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), error: String(err).slice(0, 1000) },
    });
    throw err;
  }
}

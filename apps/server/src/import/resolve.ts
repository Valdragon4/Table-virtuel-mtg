/**
 * Résolution d'une liste analysée vers des impressions Scryfall précises.
 *
 * Deux règles, dans cet ordre :
 *  1. si l'édition et le numéro de collection sont fournis, on respecte l'édition exacte ;
 *  2. sinon on prend la meilleure impression au sens de `printingScore`, c'est-à-dire
 *     la plus récente, non promo, à bordure normale, avec une image disponible.
 *
 * Une ligne non résolue ne fait jamais échouer l'import : elle part dans le rapport
 * avec sa ligne d'origine et des suggestions par distance de Levenshtein.
 */
import type { Card } from '@prisma/client';
import type { ImportIssue, ImportReport, ParsedDeck, ParsedLine, ResolvedCard, DeckSource } from '@mtg/shared';
import { prisma } from '../db.js';
import { levenshtein } from './levenshtein.js';
import { looseKey, nameCandidates, normalizeName } from './normalize.js';

/** Au-delà, on arrête de suggérer : les propositions ne veulent plus rien dire. */
const MAX_SUGGESTION_DISTANCE = 8;
const MAX_SUGGESTED_LINES = 50;

type PrintingKey = `${string}|${string}`;

function printingKey(setCode: string, collectorNumber: string): PrintingKey {
  return `${setCode.toLowerCase()}|${collectorNumber.toLowerCase()}`;
}

/** Les impressions candidates pour un nom, meilleures d'abord. */
async function loadByNames(keys: string[]): Promise<Map<string, Card[]>> {
  const byName = new Map<string, Card[]>();
  if (keys.length === 0) return byName;

  // Une seule requête : correspondance sur le nom complet ou sur la face avant
  // d'une carte recto-verso (« Fable of the Mirror-Breaker » pour « Fable … // Reflection … »).
  const rows = await prisma.$queryRaw<Card[]>`
    SELECT *
    FROM "Card"
    WHERE "lang" = 'en'
      AND (
        "normalizedName" = ANY(${keys}::text[])
        OR split_part("normalizedName", ' // ', 1) = ANY(${keys}::text[])
      )
    ORDER BY "printingScore" DESC, "releasedAt" DESC NULLS LAST, "collectorNumber" ASC
  `;

  for (const row of rows) {
    const full = row.normalizedName;
    const front = full.split(' // ')[0] ?? full;
    for (const key of new Set([full, front])) {
      const list = byName.get(key);
      if (list) list.push(row);
      else byName.set(key, [row]);
    }
  }
  return byName;
}

async function loadByPrintings(lines: ParsedLine[]): Promise<Map<PrintingKey, Card>> {
  const wanted = lines.filter((l) => l.setCode && l.collectorNumber);
  const map = new Map<PrintingKey, Card>();
  if (wanted.length === 0) return map;

  const rows = await prisma.card.findMany({
    where: {
      OR: [...new Set(wanted.map((l) => printingKey(l.setCode!, l.collectorNumber!)))].map((key) => {
        const [set = '', num = ''] = key.split('|');
        return { setCode: set, collectorNumber: { equals: num, mode: 'insensitive' as const } };
      }),
    },
  });

  for (const row of rows) map.set(printingKey(row.setCode, row.collectorNumber), row);
  return map;
}

async function suggestionsFor(name: string): Promise<ImportIssue['suggestions']> {
  const q = normalizeName(name);
  const rows = await prisma.$queryRaw<Array<Pick<Card, 'scryfallId' | 'name' | 'setCode' | 'normalizedName'>>>`
    SELECT "scryfallId", "name", "setCode", "normalizedName"
    FROM "Card"
    WHERE "lang" = 'en' AND "isToken" = false
    ORDER BY "normalizedName" <-> ${q}
    LIMIT 12
  `;

  return rows
    .map((r) => ({
      scryfallId: r.scryfallId,
      name: r.name,
      setCode: r.setCode,
      distance: levenshtein(q, r.normalizedName, MAX_SUGGESTION_DISTANCE),
    }))
    .filter((s) => s.distance <= MAX_SUGGESTION_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

/** Meilleure impression parmi `candidates`, en tenant compte d'une édition souhaitée. */
function pickPrinting(candidates: Card[], preferredSet?: string): Card | undefined {
  if (candidates.length === 0) return undefined;
  if (preferredSet) {
    const inSet = candidates.find((c) => c.setCode === preferredSet.toLowerCase());
    if (inSet) return inSet;
  }
  return candidates[0];
}

export interface ResolveOptions {
  deckName: string;
  source: DeckSource;
  sourceUrl?: string;
}

export async function resolveDeck(parsed: ParsedDeck, options: ResolveOptions): Promise<ImportReport> {
  const issues: ImportIssue[] = [];
  for (const u of parsed.unparsed) {
    issues.push({
      raw: u.raw,
      lineNumber: u.lineNumber,
      reason: 'UNPARSED',
      message: u.reason,
      suggestions: [],
    });
  }

  const keys = [...new Set(parsed.lines.flatMap((l) => nameCandidates(l.name)))];
  const [byName, byPrinting] = await Promise.all([loadByNames(keys), loadByPrintings(parsed.lines)]);

  // Second recours : correspondance sans ponctuation ni espaces.
  const byLoose = new Map<string, Card[]>();
  for (const [key, list] of byName) {
    const lk = looseKey(key);
    const existing = byLoose.get(lk);
    if (existing) existing.push(...list);
    else byLoose.set(lk, [...list]);
  }

  const resolved = new Map<string, ResolvedCard>();
  const unresolvedLines: ParsedLine[] = [];
  let sortIndex = 0;
  let editionFallbacks = 0;

  for (const line of parsed.lines) {
    const candidateKeys = nameCandidates(line.name);
    let candidates: Card[] = [];
    for (const key of candidateKeys) {
      const found = byName.get(key);
      if (found?.length) {
        candidates = found;
        break;
      }
    }
    if (candidates.length === 0) {
      for (const key of candidateKeys) {
        const found = byLoose.get(looseKey(key));
        if (found?.length) {
          candidates = found;
          break;
        }
      }
    }

    let card: Card | undefined;
    let fallback = false;

    if (line.setCode && line.collectorNumber) {
      const exact = byPrinting.get(printingKey(line.setCode, line.collectorNumber));
      // L'édition exacte ne vaut que si elle désigne bien la carte nommée : un
      // numéro de collection erroné ne doit pas importer une autre carte.
      const sameCard =
        exact !== undefined &&
        candidateKeys.some((k) => k === exact.normalizedName || k === exact.normalizedName.split(' // ')[0]);
      if (exact && (sameCard || candidates.length === 0)) {
        card = exact;
      } else if (candidates.length > 0) {
        card = pickPrinting(candidates, line.setCode);
        fallback = true;
      }
    } else {
      card = pickPrinting(candidates, line.setCode);
      if (card && line.setCode && card.setCode !== line.setCode.toLowerCase()) fallback = true;
    }

    if (!card) {
      unresolvedLines.push(line);
      continue;
    }

    if (fallback) editionFallbacks++;

    const dedupeKey = `${card.scryfallId}|${line.zone}|${line.isFoil}`;
    const existing = resolved.get(dedupeKey);
    if (existing) {
      existing.quantity += line.quantity;
      continue;
    }

    const entry: ResolvedCard = {
      scryfallId: card.scryfallId,
      name: card.name,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      quantity: line.quantity,
      zone: line.zone,
      isFoil: line.isFoil,
      sortIndex: sortIndex++,
    };
    if (fallback) entry.editionFallback = true;
    if (line.setCode) entry.requestedSetCode = line.setCode;
    if (line.collectorNumber) entry.requestedCollectorNumber = line.collectorNumber;
    resolved.set(dedupeKey, entry);
  }

  // Les suggestions coûtent une requête par ligne : on les borne.
  for (const [i, line] of unresolvedLines.entries()) {
    const suggestions = i < MAX_SUGGESTED_LINES ? await suggestionsFor(line.name) : [];
    issues.push({
      raw: line.raw,
      lineNumber: line.lineNumber,
      reason: 'CARD_NOT_FOUND',
      message: `Carte introuvable : « ${line.name} »`,
      suggestions,
    });
  }

  issues.sort((a, b) => a.lineNumber - b.lineNumber);
  const cards = [...resolved.values()];

  const report: ImportReport = {
    deckName: parsed.name ?? options.deckName,
    source: options.source,
    cards,
    issues,
    stats: {
      linesRead: parsed.lines.length + parsed.unparsed.length,
      cardsResolved: cards.length,
      cardsTotal: cards.reduce((sum, c) => sum + c.quantity, 0),
      issueCount: issues.length,
      editionFallbacks,
    },
  };
  if (options.sourceUrl) report.sourceUrl = options.sourceUrl;
  return report;
}

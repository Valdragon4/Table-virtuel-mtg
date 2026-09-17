/**
 * Import Archidekt.
 *
 * L'endpoint deck est public et stable, et son usage est toléré ; on le traite en
 * conséquence : User-Agent explicite, file globale plafonnée, cache agressif,
 * backoff sur 429. Pas de scraping de page, pas de `/small/` (déprécié).
 */
import type { DeckZone, ParsedDeck, ParsedLine } from '@mtg/shared';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { RateLimitedFetcher, HttpError } from '../lib/http.js';

const fetcher = new RateLimitedFetcher(Math.ceil(60_000 / env.ARCHIDEKT_RATE_PER_MIN), {
  'User-Agent': env.ARCHIDEKT_USER_AGENT,
  Accept: 'application/json',
});

export class DeckImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'BAD_URL'
      | 'NOT_FOUND'
      | 'RATE_LIMITED'
      | 'UPSTREAM'
      | 'MOXFIELD_DISABLED',
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'DeckImportError';
  }
}

/** `https://archidekt.com/decks/123456/mon-deck` → `123456`. */
export function parseArchidektUrl(input: string): string {
  const direct = /^\d+$/.exec(input.trim());
  if (direct) return input.trim();

  const m = /archidekt\.com\/(?:api\/)?decks\/(\d+)/i.exec(input);
  if (!m?.[1]) {
    throw new DeckImportError(
      "Cette URL n'est pas une URL de deck Archidekt.",
      'BAD_URL',
      'Attendu : https://archidekt.com/decks/123456/nom-du-deck',
    );
  }
  return m[1];
}

interface ArchidektCategory {
  name: string;
  includedInDeck: boolean;
  isPremier: boolean;
}

interface ArchidektEntry {
  quantity: number;
  modifier?: string | null;
  categories?: string[] | null;
  card: {
    collectorNumber?: string;
    edition?: { editioncode?: string };
    oracleCard?: { name?: string };
  };
}

interface ArchidektDeck {
  id: number;
  name: string;
  format?: number | string;
  categories?: ArchidektCategory[] | null;
  cards: ArchidektEntry[];
}

/**
 * `fresh` : ignorer le cache et aller vraiment relire la liste.
 *
 * Le cache existe pour ne pas marteler Archidekt, et il est bien pour un import
 * — on n'a aucune raison de redemander une liste qu'on vient de prendre. Mais
 * une **resynchronisation est une demande explicite** : l'utilisateur a changé
 * quelque chose chez Archidekt, souvent l'edition d'une carte, et il vient nous
 * dire d'aller voir. La servir depuis un cache de quinze minutes, c'est lui
 * répondre « c'est fait » sans avoir rien relu. La politesse envers Archidekt
 * reste assurée par la file plafonnée, qui limite le **débit** ; elle n'exige
 * pas qu'on refuse de relire.
 */
/**
 * Sert-on le cache, ou va-t-on relire ?
 *
 * Extraite pour être testable : c'est la règle qui décide si le bouton
 * « resynchroniser » dit la vérité, et elle ne se vérifie pas en regardant du
 * code qui appelle le réseau.
 */
export function shouldServeCache(
  fetchedAt: Date | null,
  ttlMs: number,
  now: number,
  fresh: boolean,
): boolean {
  if (fresh) return false;
  if (!fetchedAt) return false;
  return now - fetchedAt.getTime() < ttlMs;
}

async function fetchDeck(deckId: string, options: { fresh?: boolean } = {}): Promise<ArchidektDeck> {
  const cached = await prisma.externalDeckCache.findUnique({
    where: { source_externalId: { source: 'ARCHIDEKT', externalId: deckId } },
  });
  const ttlMs = env.ARCHIDEKT_CACHE_TTL_SECONDS * 1000;
  if (cached && shouldServeCache(cached.fetchedAt, ttlMs, Date.now(), options.fresh === true)) {
    return cached.payload as unknown as ArchidektDeck;
  }

  try {
    const deck = await fetcher.json<ArchidektDeck>(`https://archidekt.com/api/decks/${deckId}/`);
    await prisma.externalDeckCache.upsert({
      where: { source_externalId: { source: 'ARCHIDEKT', externalId: deckId } },
      create: { source: 'ARCHIDEKT', externalId: deckId, payload: deck as never },
      update: { payload: deck as never, fetchedAt: new Date() },
    });
    return deck;
  } catch (err) {
    if (err instanceof HttpError) {
      // Mieux vaut servir un cache périmé qu'échouer : la liste bouge peu.
      if (cached) return cached.payload as unknown as ArchidektDeck;
      if (err.status === 404) throw new DeckImportError('Deck Archidekt introuvable ou privé.', 'NOT_FOUND');
      if (err.status === 429) {
        throw new DeckImportError(
          'Archidekt limite nos appels en ce moment. Réessaie dans une minute.',
          'RATE_LIMITED',
        );
      }
    }
    throw new DeckImportError('Archidekt est injoignable pour le moment.', 'UPSTREAM');
  }
}

const COMMANDER_CATEGORIES = new Set(['commander', 'commanders', 'commandant']);
const SIDEBOARD_CATEGORIES = new Set(['sideboard', 'side board']);
const EXCLUDED_CATEGORIES = new Set(['maybeboard', 'maybe board', 'considering']);

function zoneFor(entry: ArchidektEntry, excluded: Set<string>): DeckZone | null {
  const categories = (entry.categories ?? []).map((c) => c.toLowerCase());
  if (categories.some((c) => EXCLUDED_CATEGORIES.has(c) || excluded.has(c))) return null;
  if (categories.some((c) => COMMANDER_CATEGORIES.has(c))) return 'COMMANDER';
  if (categories.some((c) => SIDEBOARD_CATEGORIES.has(c))) return 'SIDEBOARD';
  return 'MAIN';
}

/** Transforme la réponse Archidekt en liste analysée, comme si elle venait du texte. */
export function toParsedDeck(deck: ArchidektDeck): ParsedDeck {
  // Une catégorie marquée `includedInDeck: false` est un panier de côté : on l'exclut.
  const excluded = new Set(
    (deck.categories ?? []).filter((c) => !c.includedInDeck).map((c) => c.name.toLowerCase()),
  );

  const lines: ParsedLine[] = [];
  const unparsed: ParsedDeck['unparsed'] = [];

  deck.cards.forEach((entry, i) => {
    const name = entry.card.oracleCard?.name;
    if (!name) {
      unparsed.push({
        raw: JSON.stringify(entry).slice(0, 200),
        lineNumber: i + 1,
        reason: 'Entrée Archidekt sans nom de carte',
      });
      return;
    }
    const zone = zoneFor(entry, excluded);
    if (zone === null) return;

    const modifier = (entry.modifier ?? '').toLowerCase();
    const line: ParsedLine = {
      raw: `${entry.quantity} ${name}`,
      lineNumber: i + 1,
      quantity: Math.max(1, entry.quantity),
      name,
      isFoil: modifier === 'foil' || modifier === 'etched',
      zone,
    };
    const set = entry.card.edition?.editioncode;
    if (set) line.setCode = set.toLowerCase();
    if (entry.card.collectorNumber) line.collectorNumber = entry.card.collectorNumber;
    lines.push(line);
  });

  return { name: deck.name, lines, unparsed };
}

export async function importFromArchidekt(
  url: string,
  options: { fresh?: boolean } = {},
): Promise<{ deckId: string; parsed: ParsedDeck }> {
  const deckId = parseArchidektUrl(url);
  const deck = await fetchDeck(deckId, options);
  return { deckId, parsed: toParsedDeck(deck) };
}

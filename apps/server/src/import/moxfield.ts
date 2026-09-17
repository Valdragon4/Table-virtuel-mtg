/**
 * Import Moxfield.
 *
 * Moxfield ne publie aucune API pour les tiers et protège ses endpoints internes
 * derrière Cloudflare avec un filtrage par User-Agent. Ce module n'implémente
 * AUCUN contournement : pas de cloudscraper, pas de navigateur headless, pas
 * d'usurpation de User-Agent.
 *
 * Le chemin par défaut est donc le collage de l'export natif de Moxfield, traité
 * par le parseur de texte. Le chemin API n'existe que derrière
 * MOXFIELD_API_ENABLED, à activer par un opérateur ayant obtenu un User-Agent
 * autorisé auprès du support Moxfield.
 */
import type { DeckZone, ParsedDeck, ParsedLine } from '@mtg/shared';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { HttpError, RateLimitedFetcher } from '../lib/http.js';
import { DeckImportError } from './archidekt.js';
import { MoxfieldGate, classifyMoxfieldStatus } from './moxfield-policy.js';

export function isMoxfieldUrl(input: string): boolean {
  return /(^|\/\/)(www\.)?moxfield\.com\//i.test(input.trim());
}

export function parseMoxfieldUrl(input: string): string {
  const m = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i.exec(input);
  if (!m?.[1]) {
    throw new DeckImportError(
      "Cette URL n'est pas une URL de deck Moxfield.",
      'BAD_URL',
      'Attendu : https://www.moxfield.com/decks/abc123',
    );
  }
  return m[1];
}

export const MOXFIELD_PASTE_HINT =
  "Sur Moxfield, ouvre ton deck puis « Export » et colle la liste ici : c'est le chemin " +
  'normal, et il est instantané.';

/**
 * Portillon d'accès : il retient une révocation constatée (403) et une demande
 * de ralentir (429). Exporté pour les tests, qui ont besoin de le remettre à
 * zéro entre deux scénarios.
 */
export const moxfieldGate = new MoxfieldGate();

/**
 * Vrai si l'opérateur a configuré le chemin API — c'est ce qui décide si
 * l'import par URL est proposé du tout.
 *
 * La révocation, elle, n'est pas testée ici : un accès refusé par Moxfield garde
 * le droit de servir son cache, qui est du contenu déjà obtenu et non une
 * nouvelle requête. C'est `moxfieldGate` qui tranche, au moment de l'appel.
 */
export function moxfieldApiConfigured(): boolean {
  return env.MOXFIELD_API_ENABLED && Boolean(env.MOXFIELD_USER_AGENT);
}

const fetcher =
  env.MOXFIELD_API_ENABLED && env.MOXFIELD_USER_AGENT
    ? new RateLimitedFetcher(
        Math.ceil(60_000 / env.MOXFIELD_RATE_PER_MIN),
        {
          // User-Agent fourni par l'opérateur, tel qu'autorisé par Moxfield.
          'User-Agent': env.MOXFIELD_USER_AGENT,
          Accept: 'application/json',
          ...(env.MOXFIELD_API_TOKEN ? { Authorization: `Bearer ${env.MOXFIELD_API_TOKEN}` } : {}),
        },
        // Une seule tentative : le backoff automatique n'a pas sa place ici.
        1,
      )
    : null;

interface MoxfieldCardEntry {
  quantity: number;
  isFoil?: boolean;
  card: {
    name: string;
    set?: string;
    cn?: string;
    scryfall_id?: string;
  };
}

export interface MoxfieldDeck {
  name: string;
  format?: string;
  boards?: {
    mainboard?: { cards: Record<string, MoxfieldCardEntry> };
    commanders?: { cards: Record<string, MoxfieldCardEntry> };
    sideboard?: { cards: Record<string, MoxfieldCardEntry> };
  };
}

function boardToLines(
  board: Record<string, MoxfieldCardEntry> | undefined,
  zone: DeckZone,
  start: number,
): ParsedLine[] {
  if (!board) return [];
  return Object.values(board).map((entry, i) => {
    const line: ParsedLine = {
      raw: `${entry.quantity} ${entry.card.name}`,
      lineNumber: start + i,
      quantity: Math.max(1, entry.quantity),
      name: entry.card.name,
      isFoil: entry.isFoil ?? false,
      zone,
    };
    if (entry.card.set) line.setCode = entry.card.set.toLowerCase();
    if (entry.card.cn) line.collectorNumber = entry.card.cn;
    return line;
  });
}

export function toParsedMoxfieldDeck(deck: MoxfieldDeck): ParsedDeck {
  const commanders = boardToLines(deck.boards?.commanders?.cards, 'COMMANDER', 1);
  const main = boardToLines(deck.boards?.mainboard?.cards, 'MAIN', commanders.length + 1);
  const side = boardToLines(deck.boards?.sideboard?.cards, 'SIDEBOARD', commanders.length + main.length + 1);
  return { name: deck.name, lines: [...commanders, ...main, ...side], unparsed: [] };
}

async function cachedDeck(deckId: string): Promise<{ payload: MoxfieldDeck; fetchedAt: Date } | null> {
  const row = await prisma.externalDeckCache
    .findUnique({ where: { source_externalId: { source: 'MOXFIELD', externalId: deckId } } })
    .catch(() => null);
  return row ? { payload: row.payload as unknown as MoxfieldDeck, fetchedAt: row.fetchedAt } : null;
}

/**
 * Récupère un deck Moxfield, cache d'abord.
 *
 * Le cache n'est pas une optimisation : sur un accès accordé à titre de faveur,
 * ne pas redemander deux fois la même chose est la première règle de savoir-vivre
 * (docs/moxfield.md §4). En cas de panne, un cache périmé vaut mieux qu'un échec —
 * et surtout mieux qu'une nouvelle requête.
 */
async function fetchDeck(deckId: string): Promise<MoxfieldDeck> {
  const cached = await cachedDeck(deckId);
  const ttlMs = env.MOXFIELD_CACHE_TTL_SECONDS * 1000;
  if (cached && Date.now() - cached.fetchedAt.getTime() < ttlMs) return cached.payload;

  const gate = moxfieldGate.state();
  if (!gate.open) {
    if (cached) return cached.payload;
    if (gate.reason === 'REVOKED') {
      throw new DeckImportError(
        "Moxfield a refusé notre accès : l'import par URL est désactivé sur ce serveur.",
        'MOXFIELD_DISABLED',
        MOXFIELD_PASTE_HINT,
      );
    }
    const seconds = Math.ceil((gate.until - Date.now()) / 1000);
    throw new DeckImportError(
      `Moxfield nous demande de ralentir. Réessaie dans ${seconds} s.`,
      'RATE_LIMITED',
      MOXFIELD_PASTE_HINT,
    );
  }

  if (!fetcher) {
    throw new DeckImportError(
      "L'import Moxfield par URL n'est pas activé sur ce serveur.",
      'MOXFIELD_DISABLED',
      MOXFIELD_PASTE_HINT,
    );
  }

  try {
    const deck = await fetcher.json<MoxfieldDeck>(`https://api2.moxfield.com/v3/decks/all/${deckId}`);
    await prisma.externalDeckCache
      .upsert({
        where: { source_externalId: { source: 'MOXFIELD', externalId: deckId } },
        create: { source: 'MOXFIELD', externalId: deckId, payload: deck as never },
        update: { payload: deck as never, fetchedAt: new Date() },
      })
      .catch(() => undefined);
    return deck;
  } catch (err) {
    // Un refus côté Moxfield ne se contourne pas : on le retient, et on renvoie
    // l'utilisateur vers le collage.
    const verdict =
      err instanceof HttpError && err.status > 0
        ? classifyMoxfieldStatus(err.status, err.retryAfter)
        : ({ kind: 'UPSTREAM' } as const);
    moxfieldGate.note(verdict);

    if (cached && verdict.kind !== 'NOT_FOUND') return cached.payload;
    switch (verdict.kind) {
      case 'NOT_FOUND':
        throw new DeckImportError('Deck Moxfield introuvable ou privé.', 'NOT_FOUND', MOXFIELD_PASTE_HINT);
      case 'REVOKED':
        throw new DeckImportError(
          "Moxfield a refusé notre accès : l'import par URL est désactivé sur ce serveur. " +
            "L'opérateur doit régler la question avec leur support.",
          'MOXFIELD_DISABLED',
          MOXFIELD_PASTE_HINT,
        );
      case 'RATE_LIMITED':
        throw new DeckImportError(
          `Moxfield nous demande de ralentir. Réessaie dans ${Math.ceil(verdict.retryAfterMs / 1000)} s.`,
          'RATE_LIMITED',
          MOXFIELD_PASTE_HINT,
        );
      default:
        throw new DeckImportError(
          "Moxfield n'a pas répondu à cette requête.",
          'UPSTREAM',
          MOXFIELD_PASTE_HINT,
        );
    }
  }
}

export async function importFromMoxfield(url: string): Promise<{ deckId: string; parsed: ParsedDeck }> {
  const deckId = parseMoxfieldUrl(url);
  return { deckId, parsed: toParsedMoxfieldDeck(await fetchDeck(deckId)) };
}

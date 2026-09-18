/**
 * Types du pipeline d'import de decks, partagés client/serveur.
 * Les trois chemins d'entrée (Archidekt, collage Moxfield, texte brut) convergent
 * vers `ParsedDeck`, puis vers `ResolvedDeck` après résolution Scryfall.
 */

export const DECK_SOURCES = ['MANUAL', 'ARCHIDEKT', 'MOXFIELD', 'TEXT'] as const;
export type DeckSource = (typeof DECK_SOURCES)[number];

export const DECK_ZONES = ['MAIN', 'COMMANDER', 'SIDEBOARD'] as const;
export type DeckZone = (typeof DECK_ZONES)[number];

/** Une ligne telle que comprise avant toute résolution de carte. */
export interface ParsedLine {
  /** Ligne d'origine, conservée telle quelle pour le rapport d'import. */
  raw: string;
  lineNumber: number;
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  isFoil: boolean;
  zone: DeckZone;
}

export interface ParsedDeck {
  name?: string;
  lines: ParsedLine[];
  /** Lignes que le parseur n'a pas su lire du tout. */
  unparsed: Array<{ raw: string; lineNumber: number; reason: string }>;
}

export interface ResolvedCard {
  scryfallId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  quantity: number;
  zone: DeckZone;
  isFoil: boolean;
  sortIndex: number;
  /** Édition exacte demandée mais introuvable : on a retenu une autre impression. */
  editionFallback?: boolean;
  requestedSetCode?: string;
  requestedCollectorNumber?: string;
}

export interface ImportIssue {
  raw: string;
  lineNumber: number;
  reason: 'UNPARSED' | 'CARD_NOT_FOUND' | 'EDITION_NOT_FOUND' | 'AMBIGUOUS';
  message: string;
  /** Suggestions par distance de Levenshtein, les plus proches d'abord. */
  suggestions: Array<{ scryfallId: string; name: string; setCode: string; distance: number }>;
}

/**
 * Résultat d'un import. Un import n'échoue jamais en bloc à cause d'une ligne :
 * il importe ce qu'il peut et remonte le reste dans `issues`.
 */
export interface ImportReport {
  deckName: string;
  source: DeckSource;
  sourceUrl?: string;
  cards: ResolvedCard[];
  issues: ImportIssue[];
  /**
   * Impressions choisies à la main que l'écriture en base a conservées face à la
   * liste de la source (voir `decks/pinned-printings.ts`, côté serveur).
   *
   * Absent quand rien n'a été persisté — l'import d'un invité, par exemple : ce
   * n'est pas un zéro, c'est une question qui ne s'est pas posée.
   */
  pinnedPrintingsKept?: number;
  stats: {
    linesRead: number;
    cardsResolved: number;
    cardsTotal: number;
    issueCount: number;
    editionFallbacks: number;
  };
}

export interface DeckSummary {
  id: string;
  name: string;
  format: string | null;
  source: DeckSource;
  sourceUrl: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  cardCount: number;
  playmatUrl: string | null;
  cardBackUrl: string | null;
  commanders: Array<{ scryfallId: string; name: string }>;
  /**
   * La carte qui **représente** le deck : celle dont l'illustration sert de
   * miniature dans « Mes decks ».
   *
   * Elle est choisie par le serveur (`chooseDeckThumbnail`) et non par
   * l'interface, pour une raison qui n'est pas de commodité : le choix a besoin
   * de la liste complète des cartes — ligne de type, valeur de mana, rareté —
   * que ce résumé ne porte pas et n'a aucune raison de porter. Faire remonter
   * cinquante cartes par deck pour n'en afficher qu'une seule ferait payer la
   * page entière pour une vignette.
   *
   * `null` est un cas réel et non une panne : un deck vide n'a pas de carte
   * représentative. L'interface montre alors un cadre vide plutôt qu'un trou,
   * pour que les noms de deck restent alignés d'une ligne à l'autre.
   *
   * On ne transporte **que** l'identifiant et le nom. L'illustration, elle, se
   * charge dans le navigateur du joueur depuis le CDN Scryfall, comme partout
   * ailleurs : rien de Wizards of the Coast ne transite par nous.
   */
  thumbnail: { scryfallId: string; name: string } | null;
  /**
   * Les impressions que le propriétaire a choisies à la main et que la
   * resynchronisation conserve. Vide sur la plupart des decks : c'est ce qui
   * permet à l'interface de ne rien afficher tant que la question ne se pose pas.
   */
  pinnedPrintings: Array<{ scryfallId: string; name: string; setCode: string }>;
  colorIdentity: string[];
}

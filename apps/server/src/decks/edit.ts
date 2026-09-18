/**
 * Édition d'un deck carte par carte.
 *
 * Le squelette est le chemin d'import existant, pas une pile parallèle :
 * l'éditeur lit le deck sous forme de liste texte (`renderDeckText`), l'utilisateur
 * la modifie ligne à ligne dans l'interface, et la liste repart par `runImport` +
 * `persistImport`. On récupère ainsi gratuitement le parseur tolérant, la
 * résolution Scryfall sur la base locale, le choix d'édition, la déduplication
 * et le rapport d'import avec ses suggestions par distance de Levenshtein.
 *
 * ## Decks asservis à une source externe
 *
 * Un deck importé depuis Archidekt garde son `sourceUrl` et se resynchronise ;
 * une resynchronisation **écrase** son contenu. Une édition manuelle sur un tel
 * deck est donc un travail condamné.
 *
 * Choix retenu : l'édition **détache le deck de sa source**, et seulement sur
 * demande explicite du client (`detachFromSource: true`). Sans ce drapeau, la
 * sauvegarde est refusée avec le code `SOURCE_SYNCED`, pour que l'interface
 * puisse poser la question au lieu de décider à la place du propriétaire.
 *
 * Pourquoi ce compromis plutôt que les deux autres :
 *  - refuser sèchement obligerait à supprimer puis recréer le deck pour corriger
 *    une seule carte, en perdant son nom, son format et son identité ;
 *  - détacher en silence ferait disparaître sans prévenir le bouton
 *    « Resynchroniser », ce qui est exactement le genre de perte muette qu'on
 *    refuse ailleurs dans ce projet ;
 *  - autoriser l'édition **en gardant** la source serait le pire des trois : le
 *    travail de l'utilisateur serait effacé à la prochaine synchronisation, sans
 *    qu'aucune trace n'explique pourquoi.
 *
 * Détacher est réversible à la main (réimporter l'URL recrée un deck synchronisé)
 * et ne détruit aucune carte. C'est donc le seul des trois qui ne perd rien en
 * silence.
 */
import type { DeckZone, ImportReport } from '@mtg/shared';
import { prisma } from '../db.js';
import { getDeck, persistImport, runImport } from './service.js';
import { renderDeckText, type DeckTextEntry } from './text-format.js';

export class DeckEditError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'SOURCE_SYNCED' | 'EMPTY',
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'DeckEditError';
  }
}

/** Une carte du deck, telle que l'éditeur la manipule. */
export interface DeckEditorEntry extends DeckTextEntry {
  scryfallId: string;
  typeLine: string;
  manaCost: string | null;
  /** Édition demandée à l'import, quand elle diffère de l'impression retenue. */
  requestedSetCode: string | null;
}

export interface DeckEditorView {
  id: string;
  name: string;
  format: string | null;
  source: string;
  sourceUrl: string | null;
  lastSyncedAt: string | null;
  /** Vrai tant que le deck est asservi à une source externe resynchronisable. */
  synced: boolean;
  entries: DeckEditorEntry[];
  text: string;
}

/**
 * Deck existant rendu sous forme éditable. La propriété est vérifiée ici, à
 * partir de l'identifiant de session : le client ne fournit jamais son `userId`.
 */
export async function loadDeckForEdit(deckId: string, userId: string): Promise<DeckEditorView> {
  const deck = await getDeck(deckId, userId);
  if (!deck) throw new DeckEditError('Deck introuvable.', 'NOT_FOUND');

  // `getDeck` trie déjà par zone puis `sortIndex` : l'ordre d'origine est celui-là.
  const entries: DeckEditorEntry[] = deck.cards.map((dc) => ({
    scryfallId: dc.scryfallId,
    name: dc.card.name,
    setCode: dc.card.setCode,
    collectorNumber: dc.card.collectorNumber,
    quantity: dc.quantity,
    zone: dc.zone as DeckZone,
    isFoil: dc.isFoil,
    typeLine: dc.card.typeLine,
    manaCost: dc.card.manaCost,
    requestedSetCode: dc.requestedSetCode,
  }));

  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    source: deck.source,
    sourceUrl: deck.sourceUrl,
    lastSyncedAt: deck.lastSyncedAt?.toISOString() ?? null,
    synced: deck.sourceUrl !== null,
    entries,
    text: renderDeckText(entries),
  };
}

export interface SaveDeckOptions {
  /** Assume la perte du lien avec la source externe. Voir l'en-tête du module. */
  detachFromSource?: boolean;
  /** Nom du deck, si l'éditeur l'a changé au passage. */
  name?: string;
}

/**
 * Remplace le contenu d'un deck par une liste texte, après vérification de la
 * propriété et arbitrage du cas synchronisé.
 */
export async function saveDeckFromText(
  deckId: string,
  userId: string,
  text: string,
  options: SaveDeckOptions = {},
): Promise<ImportReport> {
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } });
  if (!deck) throw new DeckEditError('Deck introuvable.', 'NOT_FOUND');

  if (deck.sourceUrl && options.detachFromSource !== true) {
    throw new DeckEditError(
      `Ce deck est synchronisé depuis une source externe : la prochaine resynchronisation écraserait vos corrections.`,
      'SOURCE_SYNCED',
      'Enregistrer le détachera de sa source ; la resynchronisation ne sera plus proposée.',
    );
  }

  if (!text.trim()) {
    throw new DeckEditError(
      'La liste est vide : un deck doit garder au moins une carte.',
      'EMPTY',
      'Supprimez le deck si vous vouliez vous en débarrasser.',
    );
  }

  const outcome = await runImport({ text, name: options.name ?? deck.name });
  // `persistImport` remet `source`, `sourceUrl` et `sourceDeckId` d'après l'outcome
  // texte : le détachement est donc le comportement naturel de ce chemin.
  await persistImport(outcome, {
    userId,
    deckId,
    name: options.name ?? deck.name,
    /*
     * Les épingles d'impression ne se rappliquent pas ici, et c'est le seul
     * chemin où elles ne le font pas.
     *
     * La liste qui arrive **est** le choix de l'utilisateur, éditions écrites en
     * clair ligne à ligne : y reposer une épingle défairait la modification
     * qu'il vient de faire, et retirer une illustration choisie en partie
     * deviendrait impossible depuis l'éditeur. Rien ne se perd pour autant —
     * l'éditeur détache le deck de sa source (voir plus bas), donc plus aucune
     * resynchronisation ne viendra écraser ce qu'il écrit.
     */
    preservePinnedPrintings: false,
  });

  // Un deck édité à la main s'appelle MANUAL, pas TEXT : il ne vient plus d'un
  // collage. Et `lastSyncedAt`, que `persistImport` conserve, doit partir avec
  // la source — aucune date de synchronisation ne survit à un deck détaché.
  await prisma.deck.update({
    where: { id: deckId },
    data: { source: 'MANUAL', sourceUrl: null, sourceDeckId: null, lastSyncedAt: null },
  });

  return outcome.report;
}

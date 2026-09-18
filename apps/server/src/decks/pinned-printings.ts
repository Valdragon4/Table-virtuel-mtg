/**
 * Réconciliation des impressions épinglées avec la liste d'une source externe.
 *
 * ## Le problème que ce module résout
 *
 * Changer l'illustration d'une carte en partie écrit dans le deck du compte
 * (`printing-sync.ts`). Mais une resynchronisation depuis Archidekt ou Moxfield
 * remplace le contenu du deck en bloc : sans ce module, tous ces choix
 * disparaissaient au premier clic sur « Resynchroniser », sans un mot.
 *
 * Le précédent existait déjà sur le deck lui-même : `playmatUrl` et
 * `cardBackUrl` survivent à une resynchronisation parce que « la source externe
 * ne la connaît pas ; elle n'a pas à la décider ». Une impression choisie à la
 * main est de la même nature.
 *
 * ## La ligne de partage, et elle est nette
 *
 * **La source décide du contenu du deck, nous ne décidons que de
 * l'illustration.** Une épingle n'ajoute jamais une copie et n'en retient jamais
 * une que la source a retirée : elle réclame seulement que, parmi les copies que
 * la source annonce, telle d'entre elles porte telle impression. Si la source
 * descend de 4 à 1, l'épingle prend cette unique copie et la ligne de la source
 * disparaît ; si la source retire la carte, l'épingle part avec elle.
 *
 * ## Pourquoi l'appariement se fait sur l'oracle et pas sur le `scryfallId`
 *
 * C'est précisément l'impression qui diffère entre l'épingle et la source :
 * apparier par `scryfallId` ne trouverait jamais rien. L'identité d'une carte,
 * au sens où deux impressions sont « la même carte », c'est son `oracleId`. La
 * zone entre dans la clé parce qu'une même carte peut être au commandement et
 * dans la bibliothèque, et que ce sont deux choix distincts.
 *
 * Repli sur le nom normalisé quand l'oracle manque — cartes ingérées avant la
 * colonne, jetons —, exactement comme le garde-fou de `printing-sync.ts`.
 *
 * ## Fonction pure, et c'est délibéré
 *
 * Rien ici ne touche à Prisma : `service.ts` lit, appelle, écrit. Les règles
 * d'arbitrage sont la partie difficile, et celle qu'on veut pouvoir éprouver
 * sans base ni transaction.
 */
import type { DeckZone } from '@mtg/shared';

/** Une ligne du deck épinglée à la main, telle qu'elle était avant l'import. */
export interface PinnedPrinting {
  /**
   * Identité **oracle** de la carte (repli : `name:<nom normalisé>`), et non son
   * `scryfallId` : voir l'en-tête du module.
   */
  identity: string;
  scryfallId: string;
  quantity: number;
  zone: DeckZone;
  isFoil: boolean;
  requestedSetCode: string | null;
  requestedCollectorNumber: string | null;
  sortIndex: number;
}

/** Une ligne telle que la source l'annonce, enrichie de son identité oracle. */
export type IncomingPrinting = PinnedPrinting;

/** Une ligne prête à être écrite en base. */
export interface ReconciledRow {
  scryfallId: string;
  quantity: number;
  zone: DeckZone;
  isFoil: boolean;
  requestedSetCode: string | null;
  requestedCollectorNumber: string | null;
  sortIndex: number;
  printingPinned: boolean;
}

export interface ReconcileResult {
  rows: ReconciledRow[];
  /**
   * Nombre d'épingles honorées. Sert à le **dire** : une préservation
   * silencieuse est exactement le genre de comportement qu'on découvre trois
   * mois plus tard, en se demandant pourquoi le deck ne ressemble pas à sa
   * source.
   */
  kept: number;
}

/** Clé de regroupement : la carte (oracle) **dans une zone donnée**. */
function groupKey(entry: { identity: string; zone: DeckZone }): string {
  return `${entry.identity}::${entry.zone}`;
}

/**
 * Deux lignes que le modèle tient pour la même : c'est le triplet
 * `scryfallId|zone|isFoil` sur lequel l'import dédoublonne déjà.
 */
function sameLine(
  a: { scryfallId: string; isFoil: boolean },
  b: { scryfallId: string; isFoil: boolean },
): boolean {
  return a.scryfallId === b.scryfallId && a.isFoil === b.isFoil;
}

function toRow(entry: PinnedPrinting, quantity: number, pinned: boolean): ReconciledRow {
  return {
    scryfallId: entry.scryfallId,
    quantity,
    zone: entry.zone,
    isFoil: entry.isFoil,
    requestedSetCode: entry.requestedSetCode,
    requestedCollectorNumber: entry.requestedCollectorNumber,
    sortIndex: entry.sortIndex,
    printingPinned: pinned,
  };
}

/**
 * Applique les épingles sur la liste entrante.
 *
 * L'ordre des lignes rendues suit celui de la source ; une ligne épinglée que la
 * source ne contenait pas se glisse avec le `sortIndex` de sa sœur, pour que les
 * deux impressions d'une même carte restent voisines — comme le fait déjà
 * `printing-sync.ts` quand il en crée une.
 */
export function reconcilePinnedPrintings(
  incoming: readonly IncomingPrinting[],
  pins: readonly PinnedPrinting[],
): ReconcileResult {
  if (pins.length === 0) {
    return { rows: incoming.map((c) => toRow(c, c.quantity, false)), kept: 0 };
  }

  const pinsByGroup = new Map<string, PinnedPrinting[]>();
  for (const pin of pins) {
    const key = groupKey(pin);
    const list = pinsByGroup.get(key);
    if (list) list.push(pin);
    else pinsByGroup.set(key, [pin]);
  }
  /*
   * Ordre d'arbitrage entre plusieurs épingles d'une même carte — deux
   * illustrations différentes de la même Forêt. Il ne compte que lorsque la
   * source n'annonce plus assez de copies pour toutes les servir : il faut alors
   * que ce soit la même qui survive d'une resynchronisation à l'autre, et non
   * une au hasard de l'ordre de lecture en base.
   */
  for (const list of pinsByGroup.values()) {
    list.sort((a, b) => a.sortIndex - b.sortIndex || a.scryfallId.localeCompare(b.scryfallId));
  }

  const rows: ReconciledRow[] = [];
  let kept = 0;
  const done = new Set<string>();

  for (const line of incoming) {
    const key = groupKey(line);
    // Le groupe est traité en entier à la première de ses lignes rencontrée :
    // l'ordre de la source est ainsi conservé sans le reconstruire.
    if (done.has(key)) continue;
    done.add(key);

    const group = incoming.filter((c) => groupKey(c) === key);
    const groupPins = pinsByGroup.get(key);
    if (!groupPins || groupPins.length === 0) {
      for (const c of group) rows.push(toRow(c, c.quantity, false));
      continue;
    }

    /** Ce que la source annonce pour cette carte, et qu'on va répartir. */
    const pool = group.map((c) => ({ line: c, quantity: c.quantity }));
    const unserved: PinnedPrinting[] = [];
    const pinnedRows: ReconciledRow[] = [];

    /*
     * Épingle **déjà servie par la source** : la source annonce exactement cette
     * impression. C'est le cas d'un aller-retour par l'éditeur, qui réécrit la
     * liste avec les éditions en clair. On se contente alors de remettre la
     * marque, sans rien prendre à personne — sinon l'opération ne serait pas
     * idempotente et déplacerait une copie de plus à chaque passage.
     *
     * La ligne se scinde quand la source en annonce plus que l'épingle n'en
     * réclame : la part épinglée garde sa taille, le reste retombe sous
     * l'autorité de la source et peut fondre à la prochaine lecture.
     */
    for (const pin of groupPins) {
      const slot = pool.find((p) => sameLine(p.line, pin) && p.quantity > 0);
      if (!slot) {
        unserved.push(pin);
        continue;
      }
      const take = Math.min(pin.quantity, slot.quantity);
      slot.quantity -= take;
      pinnedRows.push(toRow({ ...pin, sortIndex: slot.line.sortIndex }, take, true));
      kept += 1;
    }

    /*
     * Épingles que la source ignore : elles se servent dans les copies annoncées,
     * jamais au-delà. Elles passent avant les lignes de la source, donc quand la
     * quantité descend sous le nombre d'épingles, ce sont les épingles qui
     * gagnent et la ligne de la source qui disparaît.
     */
    let available = pool.reduce((sum, p) => sum + p.quantity, 0);
    const neighbourSortIndex = group[0]!.sortIndex;

    for (const pin of unserved) {
      // Plus assez de copies chez la source : l'épingle tombe, sans bruit — le
      // compte rendu dira combien ont survécu.
      if (available <= 0) break;
      const take = Math.min(pin.quantity, available);
      available -= take;
      pinnedRows.push(toRow({ ...pin, sortIndex: neighbourSortIndex }, take, true));
      kept += 1;
    }

    // Le reste revient aux lignes de la source, dans leur ordre : la première
    // sert d'abord, donc c'est la dernière qui s'efface.
    let left = available;
    for (const slot of pool) {
      if (left <= 0) break;
      const take = Math.min(slot.quantity, left);
      left -= take;
      rows.push(toRow(slot.line, take, false));
    }

    rows.push(...pinnedRows);
  }

  return { rows, kept };
}

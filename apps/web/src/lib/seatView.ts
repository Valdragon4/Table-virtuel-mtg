/**
 * « Je suis toujours en bas » — sans casser le repère commun.
 *
 * La disposition des sièges est une **fonction pure du `seatIndex`** : tous les
 * clients placent le siège 0 au même endroit. C'est cet invariant qui rend les
 * coordonnées de `CURSOR` interprétables (protocole §6.7) — un monde qui
 * tournerait avec le siège local afficherait le curseur d'autrui sur le panneau
 * d'un tiers. Nous l'avons déjà payé une fois.
 *
 * On garde donc **deux** dispositions, et une traduction entre elles :
 *
 *  - la disposition **partagée**, inchangée, celle dont parlent tous les
 *    messages échangés ;
 *  - la disposition **affichée**, qui n'est qu'une réattribution des mêmes
 *    cases, choisie pour que notre siège occupe celle du bas.
 *
 * Les cases sont identiques — même taille, mêmes positions — seule
 * l'attribution change. La traduction est donc une **translation par case**,
 * exacte et réversible, et non une rotation de pixels : les cartes restent
 * droites, les textes lisibles, et un panneau d'adversaire n'est jamais à
 * l'envers.
 *
 * Ce qui doit être traduit est exactement ce qui traverse le réseau en
 * coordonnées de monde : les curseurs, et la position des étiquettes
 * flottantes. Tout le reste — cartes, dépôts — est déjà **relatif au panneau**
 * et traverse la réattribution sans y penser.
 */
import { GAP, PANEL_HEIGHT, PANEL_WIDTH } from '../components/SeatPanel.js';

export interface Cell {
  col: number;
  row: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Réattribue les cases pour que le siège `mine` prenne celle du bas.
 *
 * C'est une **rotation de l'attribution** : l'ordre des sièges autour de la
 * table est conservé, seul le point de départ change. Deux voisins le restent,
 * ce qui compte autant que d'être en bas — on désigne « le joueur à ma
 * gauche », et il doit vraiment y être.
 *
 * `mine < 0` (aucun siège) : rien ne bouge.
 */
export function rotateToBottom(positions: Cell[], mine: number): Cell[] {
  const n = positions.length;
  if (n === 0 || mine < 0 || mine >= n) return positions;

  // La case du bas : celle de la dernière rangée, la plus à gauche. À deux
  // sièges c'est la seule d'en bas ; à quatre, on prend la gauche par
  // convention, pour que le choix soit stable d'une partie à l'autre.
  const lastRow = Math.max(...positions.map((p) => p.row));
  let bottom = 0;
  for (let i = 0; i < n; i++) {
    const cell = positions[i]!;
    if (cell.row !== lastRow) continue;
    if (cell.col < positions[bottom]!.col || positions[bottom]!.row !== lastRow) bottom = i;
  }

  const shift = ((bottom - mine) % n + n) % n;
  return positions.map((_, i) => positions[(i + shift) % n]!);
}

/** Origine d'une case, en pixels de monde. */
function originOf(cell: Cell): Point {
  return { x: cell.col * (PANEL_WIDTH + GAP), y: cell.row * (PANEL_HEIGHT + GAP) };
}

/**
 * La case à laquelle appartient un point.
 *
 * On prend la plus proche par le centre plutôt que celle qui le contient : un
 * point tombé dans l'écart entre deux panneaux n'appartient à aucune case, et
 * il faut quand même le traduire. La fonction est ainsi **totale** — elle rend
 * toujours une réponse — ce qui évite d'avoir à traiter un cas « nulle part »
 * dans chaque appelant.
 */
function nearestCell(point: Point, cells: Cell[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const origin = originOf(cells[i]!);
    const dx = point.x - (origin.x + PANEL_WIDTH / 2);
    const dy = point.y - (origin.y + PANEL_HEIGHT / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Traduit un point d'une disposition vers l'autre.
 *
 * Les deux tableaux sont indexés de la même façon — par rang du siège — donc
 * `from[i]` et `to[i]` sont les deux cases d'un même siège. Le décalage d'un
 * point est celui de la case à laquelle il appartient.
 */
function translate(point: Point, from: Cell[], to: Cell[]): Point {
  if (from.length === 0 || from.length !== to.length) return point;
  const index = nearestCell(point, from);
  const a = originOf(from[index]!);
  const b = originOf(to[index]!);
  return { x: point.x + (b.x - a.x), y: point.y + (b.y - a.y) };
}

/** Repère partagé → repère affiché. Pour poser ce qu'on reçoit des autres. */
export function toView(point: Point, shared: Cell[], view: Cell[]): Point {
  return translate(point, shared, view);
}

/** Repère affiché → repère partagé. Pour dire aux autres où l'on pointe. */
export function toShared(point: Point, shared: Cell[], view: Cell[]): Point {
  return translate(point, view, shared);
}

/**
 * Glisser-déposer de cartes.
 *
 * Les cibles se déclarent par un attribut `data-zone="<seat>|<KIND>"` dans le DOM ;
 * au relâchement, on interroge le point sous le curseur. Pas de registre à tenir
 * synchronisé, donc pas de cible fantôme après un re-rendu.
 */
import { ZONE_KINDS, type ZoneRef, type ZoneKind } from '@mtg/shared';
import { BATTLEFIELD_SCALE, CARD_HEIGHT, CARD_WIDTH } from './cards.js';

/** Demi-carte en unités de panneau : le dépôt se fait par le centre de la carte. */
const HALF_W = (CARD_WIDTH * BATTLEFIELD_SCALE) / 2;
const HALF_H = (CARD_HEIGHT * BATTLEFIELD_SCALE) / 2;

const KINDS = new Set<string>(ZONE_KINDS);

export interface DropTarget {
  zone: ZoneRef;
  /** Coordonnées dans le repère du panneau, pour le champ de bataille. */
  x: number;
  y: number;
}

export function zoneAttr(zone: ZoneRef): string {
  return `${zone.seat}|${zone.kind}`;
}

/**
 * Cible sous un point de l'écran.
 *
 * `elementsFromPoint` rend la pile complète du point : on prend la première
 * zone rencontrée en partant du dessus, ce qui donne naturellement la priorité
 * à une pile posée par-dessus le champ de bataille. Les éléments en
 * `pointer-events: none` — dont la carte fantôme du glissement — sont exclus
 * par le navigateur, il n'y a donc rien à filtrer ici.
 */
export function findDropTarget(clientX: number, clientY: number, scale: number): DropTarget | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const holder = (element as HTMLElement).closest<HTMLElement>('[data-zone]');
    if (!holder) continue;

    const raw = holder.dataset['zone'];
    if (!raw) continue;
    const separator = raw.lastIndexOf('|');
    if (separator <= 0) continue;
    const seat = raw.slice(0, separator);
    const kind = raw.slice(separator + 1);
    if (!seat || !KINDS.has(kind)) continue;

    const rect = holder.getBoundingClientRect();
    // Le champ de bataille est rendu dans un plan mis à l'échelle : on ramène le
    // point dans le repère du panneau avant d'en retirer la demi-carte, puis on
    // borne pour qu'un dépôt sur le bord ne sorte jamais du panneau.
    const localX = (clientX - rect.left) / scale - HALF_W;
    const localY = (clientY - rect.top) / scale - HALF_H;
    const maxX = Math.max(0, rect.width / scale - HALF_W * 2);
    const maxY = Math.max(0, rect.height / scale - HALF_H * 2);

    return {
      zone: { seat, kind: kind as ZoneKind },
      x: Math.round(Math.min(Math.max(localX, 0), maxX)),
      y: Math.round(Math.min(Math.max(localY, 0), maxY)),
    };
  }
  return null;
}

/**
 * Position courante du pointeur pendant un glissement.
 *
 * Elle vit hors de React, et c'est délibéré : la passer par le store ferait
 * re-rendre tout ce qui y est abonné — la table entière, ses centaines de
 * sprites — à la fréquence du pointeur. Seule la carte fantôme a besoin de
 * cette valeur, et elle l'écrit directement dans son `transform`.
 */
export const dragPointer = { x: 0, y: 0, startX: 0, startY: 0 };

/**
 * Où insérer dans la main, d'après l'abscisse du pointeur.
 *
 * On lit le rail tel qu'il est rendu plutôt que de recalculer un éventail :
 * le recouvrement se resserre avec le nombre de cartes, et deux formules qui
 * divergent d'un pixel donnent un indicateur d'insertion qui ment.
 *
 * Seule la **bande visible** de chaque carte compte. Avec le recouvrement, une
 * carte ne montre que son bord gauche ; viser son milieu réel reviendrait à
 * viser la carte d'à côté. On compare donc à la moitié de ce que l'on voit
 * d'elle.
 *
 * `excluded` retire du calcul les cartes qu'on est en train de déplacer :
 * l'index renvoyé est celui de la liste **une fois ces cartes ôtées**, qui est
 * exactement ce que le serveur voit après les avoir retirées de la zone.
 */
export function handInsertIndex(
  clientX: number,
  excluded: ReadonlySet<string>,
): { index: number; x: number } | null {
  const rail = document.querySelector<HTMLElement>('[data-test="hand-rail"]');
  if (!rail) return null;

  const slots = [...rail.querySelectorAll<HTMLElement>('[data-hand-card]')].map((element) => ({
    id: element.dataset['handCard'] ?? '',
    rect: element.getBoundingClientRect(),
  }));
  const kept = slots.filter((slot) => !excluded.has(slot.id));
  if (kept.length === 0) {
    const rect = rail.getBoundingClientRect();
    return { index: 0, x: rect.left + rect.width / 2 };
  }

  for (let i = 0; i < kept.length; i++) {
    const rect = kept[i]!.rect;
    const next = kept[i + 1]?.rect;
    const visible = next ? Math.max(8, next.left - rect.left) : rect.width;
    if (clientX < rect.left + visible / 2) return { index: i, x: rect.left };
  }
  const last = kept[kept.length - 1]!.rect;
  return { index: kept.length, x: last.right };
}

/** Seuil au-delà duquel un appui devient un glissement, en pixels écran. */
export const DRAG_THRESHOLD = 4;

/**
 * Place libre sur un champ de bataille.
 *
 * « Jouer » posait toujours la carte en (60, 60), c'est-à-dire sur la
 * précédente : chaque carte jouée au clavier ou au double-clic demandait un
 * replacement à la main. On cherche donc la première case d'une grille qui ne
 * chevauche aucun permanent, en balayant de gauche à droite puis de haut en
 * bas — l'ordre dans lequel on pose vraiment ses cartes.
 *
 * `occupied` est la liste des positions déjà prises, dans le repère du panneau.
 */
export function freeSpot(
  occupied: Array<{ x: number; y: number }>,
  bounds = { width: 1076, height: 660 },
): { x: number; y: number } {
  const stepX = Math.round(CARD_WIDTH * BATTLEFIELD_SCALE) + 8;
  const stepY = Math.round(CARD_HEIGHT * BATTLEFIELD_SCALE) + 10;
  const taken = (x: number, y: number): boolean =>
    occupied.some((p) => Math.abs(p.x - x) < stepX * 0.75 && Math.abs(p.y - y) < stepY * 0.75);

  for (let y = 60; y + stepY <= bounds.height; y += stepY) {
    for (let x = 60; x + stepX <= bounds.width; x += stepX) {
      if (!taken(x, y)) return { x, y };
    }
  }
  // Terrain plein : on retombe sur le coin, comme avant. Mieux vaut une carte
  // superposée qu'une carte hors du panneau.
  return { x: 60, y: 60 };
}

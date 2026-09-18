/**
 * Où poser l'aperçu agrandi.
 *
 * La règle tient en une phrase, et elle est volontairement étroite :
 *
 * > **En bas à gauche, toujours — sauf si la carte survolée se trouverait
 * > dessous.**
 *
 * Un seul cas justifie de déménager, et c'est celui-là : montrer une carte en
 * grand tout en cachant l'originale du doigt. Tout le reste — un menu, une
 * modale, les autres cartes de la table — ne compte pas. Ce n'est pas un
 * raccourci de mise en œuvre mais le cœur du réglage : un panneau qui se
 * déplace pour des raisons que le joueur ne voit pas est un panneau qu'il doit
 * chercher des yeux à chaque fois. Ici il sait toujours où regarder, et la
 * seule exception est celle qu'il provoque lui-même, en survolant une carte
 * posée à cet endroit.
 *
 * Corollaire volontaire : **aucune mémoire**. Le coin se recalcule de zéro à
 * chaque carte survolée, à partir du bas-gauche. Une version précédente gardait
 * le coin courant avec une hystérésis pour éviter l'oscillation ; elle ne se
 * réarmait jamais, et l'aperçu restait bloqué en haut à droite pour toutes les
 * cartes suivantes. Le critère étant maintenant fonction de la seule carte
 * survolée, il est déjà stable : deux survols de la même carte donnent le même
 * coin, et rien ne peut osciller sous un curseur immobile.
 *
 * Les rectangles viennent du DOM, comme le survol lui-même (`hover.ts` et son
 * `elementsFromPoint`) : on lit ce qui est rendu, on ne déduit rien de l'état
 * de la partie. Une géométrie devinée est une géométrie fausse.
 */
export type PreviewCorner = 'bottom-left' | 'bottom-right' | 'top-right' | 'top-left';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Le domicile de l'aperçu. On n'en part qu'à regret, et on y revient seul. */
export const DEFAULT_PREVIEW_CORNER: PreviewCorner = 'bottom-left';

/**
 * Ordre de repli. Le bord droit d'abord : la colonne de gauche est celle qui ne
 * porte pas de zone de jeu, donc si l'on doit en sortir, autant traverser.
 */
export const PREVIEW_CORNERS: readonly PreviewCorner[] = [
  'bottom-left',
  'bottom-right',
  'top-right',
  'top-left',
];

/**
 * En deçà, le chevauchement est un liseré : la carte reste parfaitement
 * lisible, et déménager pour ça coûterait plus que ça ne rapporte.
 */
const NEGLIGIBLE_RATIO = 0.05;

/** Rectangle qu'occuperait l'aperçu dans ce coin. */
export function previewRect(
  corner: PreviewCorner,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin: number,
): Rect {
  const left = corner.endsWith('left')
    ? margin
    : Math.max(margin, viewport.width - size.width - margin);
  // Sur une fenêtre basse, l'aperçu remonte jusqu'à la marge plutôt que de
  // sortir par le haut : le comportement d'origine, conservé tel quel.
  const top = corner.startsWith('top')
    ? margin
    : Math.max(margin, viewport.height - size.height - margin);
  return { left, top, width: size.width, height: size.height };
}

/** Aire commune à deux rectangles, 0 s'ils ne se touchent pas. */
export function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * L'aperçu cacherait-il la carte qu'il montre ? Mesuré en fraction de la
 * *carte* et non de l'aperçu : ce qu'on protège, c'est elle.
 */
function hides(rect: Rect, card: Rect): boolean {
  const area = card.width * card.height;
  if (area <= 0) return false;
  return overlapArea(rect, card) / area > NEGLIGIBLE_RATIO;
}

export interface PreviewPlacementInput {
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  margin: number;
  /**
   * Rectangles de la carte survolée — au pluriel, parce que la même carte peut
   * être rendue à deux endroits (la table et un panneau de zone, par exemple).
   */
  hovered: readonly Rect[];
}

/**
 * Coin retenu. Rend toujours le bas-gauche s'il ne cache pas la carte survolée,
 * et sinon le premier coin de l'ordre de repli qui ne la cache pas.
 */
export function choosePreviewCorner(input: PreviewPlacementInput): PreviewCorner {
  const { size, viewport, margin, hovered } = input;
  if (hovered.length === 0) return DEFAULT_PREVIEW_CORNER;

  for (const corner of PREVIEW_CORNERS) {
    const rect = previewRect(corner, size, viewport, margin);
    if (!hovered.some((card) => hides(rect, card))) return corner;
  }
  // Aucun coin ne dégage la carte — une fenêtre minuscule, typiquement. On ne
  // va pas la promener pour rien : elle reste chez elle.
  return DEFAULT_PREVIEW_CORNER;
}

/*
 * ---------------------------------------------------------------- le DOM
 */

/**
 * Ce qui compte comme « la carte survolée » à l'écran. La liste couvre les
 * endroits d'où l'aperçu peut naître : la table et la main (`data-card`), la
 * grille d'une fouille, un panneau de zone, un résultat de recherche de jeton
 * et l'étagère.
 */
const HOVERED_SELECTOR = [
  '[data-card]',
  '[data-test="look-card"]',
  '[data-test="zone-card"]',
  '[data-test="token-result"]',
  '[data-test="shelf-token"]',
].join(',');

function toRect(element: Element): Rect | null {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

/**
 * Rectangles de la carte actuellement survolée.
 *
 * Deux chemins, et il en faut deux. Quand l'aperçu vient d'un objet de partie,
 * son identifiant suffit et l'on retrouve toutes ses représentations. Quand il
 * vient d'une simple impression — un résultat de recherche, l'étagère —, aucun
 * identifiant ne la désigne : on relit alors ce qui se trouve sous le pointeur,
 * exactement comme `hover.ts` le fait pour décider de la carte survolée.
 */
export function hoveredCardRects(
  cardId: string | null,
  pointer: { x: number; y: number } | null,
): Rect[] {
  if (typeof document === 'undefined') return [];

  const rects: Rect[] = [];
  if (cardId !== null) {
    for (const element of document.querySelectorAll(`[data-card="${CSS.escape(cardId)}"]`)) {
      const rect = toRect(element);
      if (rect) rects.push(rect);
    }
    if (rects.length > 0) return rects;
  }

  if (!pointer) return rects;
  for (const element of document.elementsFromPoint(pointer.x, pointer.y)) {
    const holder = element.closest(HOVERED_SELECTOR);
    if (!holder) continue;
    const rect = toRect(holder);
    if (rect) return [rect];
  }
  return rects;
}

/*
 * ------------------------------------------------------- la taille du panneau
 */

/**
 * Plancher de l'illustration. En dessous, on ne lit plus rien : la réduire
 * encore pour gagner vingt pixels de marge reviendrait à rendre l'aperçu
 * inutile pour le sauver. Sous une fenêtre si basse — moins de 200 px — on
 * assume que le panneau se colle au bord haut et dépasse en bas.
 */
export const MIN_PREVIEW_IMAGE_HEIGHT = 120;

/**
 * La place **réservée** sous l'illustration, qu'elle serve ou non.
 *
 * Elle n'est pas une estimation de la hauteur des bandeaux : c'est un créneau.
 * Le panneau est ancré par le bas, si bien que tout ce qui s'ajoute dessous le
 * fait grandir vers le haut — or ce qui s'ajoute arrive en retard, par lots :
 * la fiche de la carte apporte d'abord le nom, puis les mécaniques. Sans
 * réserve, le panneau remonterait de trente à soixante pixels une demi-seconde
 * après être apparu, sous les yeux du joueur, et à chaque carte. On lui donne
 * donc sa place tout de suite, une fois pour toutes.
 *
 * Soixante-huit pixels : le bandeau de nom et son écart (39), une rangée de
 * mécaniques et le sien (29). Une carte qui en déborde — une rangée de
 * mécaniques sur deux lignes — repousse le sommet d'autant : la mesure reste
 * là pour ça, et c'est elle qui garantit qu'on ne sort jamais du cadre.
 */
export const PREVIEW_BANDS_RESERVE = 68;

export interface PreviewBoxInput {
  /** Hauteur souhaitée de l'illustration, déduite de la fenêtre. */
  imageHeight: number;
  /** Rapport largeur / hauteur d'une carte. */
  ratio: number;
  /** Hauteur **mesurée** de ce qui est peint sous l'illustration. */
  bandsHeight: number;
  viewport: { height: number };
  margin: number;
}

/**
 * Le créneau qu'occupera le panneau.
 *
 * Trois choses s'y jouent, et aucune n'est cosmétique.
 *
 * **La hauteur de l'illustration est imposée, pas constatée.** Elle reçoit une
 * hauteur explicite, donc le panneau a sa taille définitive dès le premier
 * rendu, avant même que l'image ne soit chargée. C'est exactement ce qui
 * manquait : une mesure prise sur une `<img>` vide vaut zéro, le sommet se
 * posait alors juste au-dessus du bord bas, et la carte tombait hors de l'écran
 * dès que l'image arrivait.
 *
 * **Ce qui est sous l'image a sa place réservée**, pour que le panneau ne
 * remonte pas quand la fiche de la carte rentre.
 *
 * **Et ce qui déborde de la réserve est mesuré**, pour que le cadre de la
 * fenêtre reste tenu quoi qu'il arrive. Sur une fenêtre basse, c'est
 * l'illustration qui rétrécit ; jamais le bandeau qui sort par le bas.
 */
export function previewBox(input: PreviewBoxInput): {
  width: number;
  height: number;
  imageHeight: number;
} {
  const { imageHeight, ratio, bandsHeight, viewport, margin } = input;
  const dessous = Math.max(PREVIEW_BANDS_RESERVE, bandsHeight);
  const disponible = viewport.height - margin * 2 - dessous;
  const image = Math.round(
    Math.max(MIN_PREVIEW_IMAGE_HEIGHT, Math.min(imageHeight, disponible)),
  );
  return { width: Math.round(image * ratio), height: image + dessous, imageHeight: image };
}

/**
 * Placement de l'aperçu agrandi.
 *
 * La règle vérifiée ici est étroite, et c'est le sujet : bas à gauche, sauf si
 * la carte survolée se trouverait dessous. Le piège qu'on protège n'est pas
 * « éviter les obstacles » mais l'inverse — qu'un déplacement finisse par
 * coller et que l'aperçu ne revienne jamais chez lui.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_CORNER,
  choosePreviewCorner,
  MIN_PREVIEW_IMAGE_HEIGHT,
  PREVIEW_BANDS_RESERVE,
  overlapArea,
  previewBox,
  previewRect,
  type Rect,
} from '../src/lib/previewPlacement.js';

const VIEWPORT = { width: 1440, height: 900 };
const SIZE = { width: 300, height: 420 };
const MARGIN = 16;

function choose(hovered: Rect[]) {
  return choosePreviewCorner({ size: SIZE, viewport: VIEWPORT, margin: MARGIN, hovered });
}

/** Une carte posée en plein sur le rectangle qu'occuperait l'aperçu à ce coin. */
function cardOn(corner: Parameters<typeof previewRect>[0]): Rect {
  const rect = previewRect(corner, SIZE, VIEWPORT, MARGIN);
  return { left: rect.left + 20, top: rect.top + 20, width: 140, height: 200 };
}

describe('previewRect', () => {
  it('pose chaque coin à la marge, du bon bord', () => {
    expect(previewRect('bottom-left', SIZE, VIEWPORT, MARGIN)).toEqual({
      left: 16,
      top: 900 - 420 - 16,
      width: 300,
      height: 420,
    });
    expect(previewRect('top-right', SIZE, VIEWPORT, MARGIN)).toEqual({
      left: 1440 - 300 - 16,
      top: 16,
      width: 300,
      height: 420,
    });
  });

  it('remonte à la marge plutôt que de sortir par le haut d’une fenêtre basse', () => {
    expect(previewRect('bottom-left', SIZE, { width: 1024, height: 300 }, MARGIN).top).toBe(MARGIN);
  });
});

describe('overlapArea', () => {
  it('rend zéro pour deux rectangles disjoints, l’aire commune sinon', () => {
    const a = { left: 0, top: 0, width: 100, height: 100 };
    expect(overlapArea(a, { left: 200, top: 0, width: 50, height: 50 })).toBe(0);
    expect(overlapArea(a, { left: 50, top: 50, width: 100, height: 100 })).toBe(50 * 50);
  });
});

describe('choosePreviewCorner', () => {
  it('reste en bas à gauche quand rien n’est survolé', () => {
    expect(choose([])).toBe(DEFAULT_PREVIEW_CORNER);
  });

  it('reste en bas à gauche pour une carte survolée ailleurs', () => {
    // Une carte au centre de la table : elle ne gêne aucun coin.
    expect(choose([{ left: 700, top: 400, width: 140, height: 200 }])).toBe('bottom-left');
  });

  it('ne bouge pas pour un liseré de chevauchement', () => {
    // La carte dépasse de quelques pixels sur le rectangle de l'aperçu.
    const rect = previewRect('bottom-left', SIZE, VIEWPORT, MARGIN);
    const card: Rect = { left: rect.left + rect.width - 6, top: rect.top + 10, width: 140, height: 200 };
    expect(choose([card])).toBe('bottom-left');
  });

  it('bascule quand la carte survolée passerait sous l’aperçu', () => {
    expect(choose([cardOn('bottom-left')])).toBe('bottom-right');
  });

  it('continue de fuir jusqu’à trouver un coin qui dégage la carte', () => {
    // Une carte très large qui couvre les deux coins bas.
    const bottom = previewRect('bottom-left', SIZE, VIEWPORT, MARGIN);
    const bande: Rect = { left: 0, top: bottom.top + 40, width: VIEWPORT.width, height: 200 };
    expect(choose([bande])).toBe('top-right');
  });

  it('tient compte de toutes les représentations d’une même carte', () => {
    // La même carte à deux endroits : table et panneau de zone.
    expect(choose([cardOn('bottom-left'), cardOn('bottom-right')])).toBe('top-right');
  });

  it('renonce plutôt que de promener l’aperçu quand aucun coin ne dégage', () => {
    const tout: Rect = { left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height };
    expect(choose([tout])).toBe(DEFAULT_PREVIEW_CORNER);
  });

  it('ne garde aucune mémoire : le coin d’avant n’influence pas le suivant', () => {
    // Le défaut exact qui a été signalé : après une carte qui force le
    // haut-droit, la carte suivante doit ramener l'aperçu en bas à gauche.
    expect(choose([cardOn('bottom-left'), cardOn('bottom-right')])).toBe('top-right');
    expect(choose([{ left: 700, top: 400, width: 140, height: 200 }])).toBe('bottom-left');
  });
});

/**
 * La taille du panneau entier.
 *
 * C'est ici que se joue le défaut signalé : l'aperçu sortait par le bas de la
 * fenêtre parce que sa hauteur était **constatée** sur un panneau encore
 * incomplet — image non chargée, fiche pas encore arrivée — puis jamais
 * reprise. La hauteur de l'illustration est maintenant imposée, et seule la
 * hauteur des bandeaux entre en donnée. Ce que ces cas vérifient, c'est qu'à
 * partir de cette donnée le panneau tient toujours dans la fenêtre.
 */
describe('previewBox', () => {
  const RATIO = 166 / 230;
  const box = (imageHeight: number, bandsHeight: number, height: number) =>
    previewBox({ imageHeight, ratio: RATIO, bandsHeight, viewport: { height }, margin: MARGIN });

  it('réserve la place des bandeaux, occupée ou non', () => {
    const r = box(420, 0, 900);
    expect(r.imageHeight).toBe(420);
    expect(r.height).toBe(420 + PREVIEW_BANDS_RESERVE);
    expect(r.width).toBe(Math.round(420 * RATIO));
  });

  it('ne bouge pas quand la fiche de la carte rentre', () => {
    // Le défaut de placement qu'on protège ici : le panneau est ancré par le
    // bas, donc tout ce qui s'ajoute dessous le ferait remonter. Le bandeau de
    // nom, puis les mécaniques, arrivent une demi-seconde après l'aperçu.
    const vide = box(420, 0, 900);
    const nom = box(420, 33, 900);
    const mecaniques = box(420, PREVIEW_BANDS_RESERVE, 900);
    expect(nom.height).toBe(vide.height);
    expect(mecaniques.height).toBe(vide.height);
  });

  it('cède du terrain quand les bandeaux débordent de la réserve', () => {
    // Deux lignes de mécaniques : rare, mais le cadre de la fenêtre passe avant
    // la stabilité du placement.
    const r = box(420, PREVIEW_BANDS_RESERVE + 30, 900);
    expect(r.height).toBe(420 + PREVIEW_BANDS_RESERVE + 30);
  });

  it('garde le rapport de la carte : la largeur suit l’illustration, pas le panneau', () => {
    const r = box(420, 64, 900);
    expect(r.width / r.imageHeight).toBeCloseTo(RATIO, 2);
  });

  it('rétrécit l’illustration plutôt que de laisser le panneau déborder', () => {
    const r = box(420, 70, 300);
    expect(r.height).toBeLessThanOrEqual(300 - 2 * MARGIN);
    expect(r.imageHeight).toBeLessThan(420);
  });

  it('tient dans la fenêtre pour toute combinaison raisonnable', () => {
    for (const hauteurFenetre of [280, 400, 620, 768, 900, 1440]) {
      for (const bandeaux of [0, 28, 64, 96, 140]) {
        const r = box(500, bandeaux, hauteurFenetre);
        const rect = previewRect(
          'bottom-left',
          r,
          { width: 1280, height: hauteurFenetre },
          MARGIN,
        );
        expect(rect.top).toBeGreaterThanOrEqual(MARGIN);
        // Le plancher de lisibilité a son propre cas, juste en dessous : ici on
        // n'exerce que les fenêtres où réduire suffit encore.
        if (r.imageHeight > MIN_PREVIEW_IMAGE_HEIGHT) {
          expect(rect.top + rect.height).toBeLessThanOrEqual(hauteurFenetre - MARGIN);
        }
      }
    }
  });

  it('s’arrête au plancher de lisibilité, et se colle alors au bord haut', () => {
    // Une fenêtre de 180 px : rien ne tient. On réduit jusqu'au plancher, puis
    // on assume le dépassement plutôt que de servir une vignette illisible.
    const r = box(420, 70, 180);
    expect(r.imageHeight).toBe(MIN_PREVIEW_IMAGE_HEIGHT);
    const rect = previewRect('bottom-left', r, { width: 1280, height: 180 }, MARGIN);
    expect(rect.top).toBe(MARGIN);
  });
});

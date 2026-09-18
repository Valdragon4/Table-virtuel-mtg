/**
 * Sonde : ce que cadrent réellement « Voir toute la table » et « Recentrer sur
 * moi ».
 *
 * On ne juge pas un cadrage à l'œil, et surtout pas en lisant une constante :
 * ce qui compte est le nombre de pixels d'écran que la table occupe une fois le
 * bouton pressé. On relève donc, pour chaque bouton :
 *
 *  - l'échelle appliquée (`viewScale`, celle que le plan porte vraiment) ;
 *  - le rectangle écran de la grille des sièges, mesuré sur les panneaux eux-
 *    mêmes et non recalculé — c'est la seule façon de voir un écrêtage ;
 *  - la part de l'espace libre que ce rectangle remplit ;
 *  - pour « Recentrer sur moi », si le panneau local est entier à l'écran.
 *
 * Deux tailles de fenêtre, parce qu'un cadrage plus serré doit tenir aussi sur
 * une fenêtre étroite, et deux tables (un siège, puis deux) parce que la
 * disposition change la grille.
 *
 *   node probe-cadrage.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const NL = String.fromCharCode(10);
const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '', '// Deck', '4 Sol Ring', '20 Plains'].join(NL);

/** Les mêmes bandeaux fixes que ceux dont `Table` tient compte pour cadrer. */
const SIDE_LOG = 304;
const SIDE_PANEL = 240;
const TOP_BAR = 60;

const browser = await chromium.launch({ headless: true });

async function seat(context, name, url) {
  const page = await context.newPage();
  await page.goto(url ?? BASE + '/');
  if (!url) {
    await page.getByRole('button', { name: /obtenir le lien/i }).click();
    await page.waitForURL(/\/rooms\//);
  }
  await page.getByPlaceholder('Invité').fill(name);
  await page.locator('textarea').first().fill(DECK);
  await page.getByRole('button', { name: /S'asseoir/ }).click();
  await page.waitForFunction(
    () => {
      const s = window.__mtg?.getState();
      return Boolean(s?.mySeat) && (s.zoneCounts.get(s.mySeat + '|LIBRARY') ?? 0) > 0;
    },
    null,
    { timeout: 60000 },
  );
  return page;
}

/**
 * Le rectangle écran de la grille : l'union des panneaux de siège. On le lit
 * dans le DOM plutôt que de le recalculer à partir de l'échelle, faute de quoi
 * on ne mesurerait que sa propre arithmétique.
 */
const grille = (page) =>
  page.evaluate(() => {
    // Le playmat couvre exactement son panneau (`inset-0`) : c'est le nœud le
    // plus sûr pour lire un panneau de siège à l'écran.
    const rects = [...document.querySelectorAll('[data-test="playmat-default"]')].map((n) =>
      n.getBoundingClientRect(),
    );
    if (!rects.length) return null;
    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  });

/**
 * Le rectangle écran de mon seul panneau. La disposition affichée met toujours
 * le siège local en bas : le panneau le plus bas est le mien.
 */
const monPanneau = (page) =>
  page.evaluate(() => {
    const rects = [...document.querySelectorAll('[data-test="playmat-default"]')].map((n) =>
      n.getBoundingClientRect(),
    );
    if (!rects.length) return null;
    const r = rects.sort((a, b) => b.top - a.top)[0];
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

const echelle = (page) => page.evaluate(() => window.__mtg.getState().viewScale);

function libre(page) {
  return page.evaluate(
    ([logw, panw, top]) => {
      // `handRailHeight` n'est pas exposée : on lit le rail rendu, qui est ce
      // que la caméra évite réellement.
      const rail = document.querySelector('[data-test="hand-rail"]');
      const h = rail ? rail.getBoundingClientRect().height + 12 : 0;
      // Mêmes réserves que la caméra : sur fenêtre étroite les colonnes sont
      // escamotées, elles ne prennent donc plus de place.
      const etroit = window.innerWidth < 900;
      const gauche = etroit ? 12 : logw;
      const droite = etroit ? 12 : panw;
      return {
        left: gauche,
        top,
        width: Math.max(200, window.innerWidth - gauche - droite),
        height: Math.max(200, window.innerHeight - top - h),
      };
    },
    [SIDE_LOG, SIDE_PANEL, TOP_BAR],
  );
}

const dit = (r) =>
  r ? `${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}` +
      ` (${Math.round(r.right - r.left)} × ${Math.round(r.bottom - r.top)} px)` : 'introuvable';

async function mesure(page, nom, bouton) {
  await page.locator(`[data-test="${bouton}"]`).click();
  await page.waitForTimeout(350);
  const s = await echelle(page);
  const g = await grille(page);
  const m = await monPanneau(page);
  const f = await libre(page);
  const remplissage = g
    ? Math.max((g.right - g.left) / f.width, (g.bottom - g.top) / f.height)
    : 0;
  const entier =
    m &&
    m.left >= -1 &&
    m.top >= -1 &&
    m.right <= (await page.evaluate(() => window.innerWidth)) + 1 &&
    m.bottom <= (await page.evaluate(() => window.innerHeight)) + 1;
  console.log(
    `  ${nom} : échelle ${s.toFixed(3)} — grille ${dit(g)} — remplissage ` +
      `${(remplissage * 100).toFixed(0)} % de l'espace libre (${Math.round(f.width)} × ${Math.round(f.height)})`,
  );
  console.log(`      mon panneau ${dit(m)} — entier à l'écran : ${entier ? 'oui' : 'non'}`);
  return { scale: s, grille: g, panneau: m, remplissage, entier };
}

async function serie(titre, viewport, joueurs) {
  console.log(`--- ${titre} (${viewport.width} × ${viewport.height}, ${joueurs} siège(s))`);
  const contexte = await browser.newContext({ viewport });
  const alice = await seat(contexte, 'Alice');
  const salon = alice.url();
  let bob = null;
  if (joueurs > 1) {
    bob = await seat(await browser.newContext({ viewport }), 'Bob', salon);
    await alice.waitForTimeout(300);
  }
  await alice.getByRole('button', { name: 'Lancer la partie' }).click();
  await alice.waitForFunction(() => window.__mtg.getState().room?.status === 'PLAYING', null, {
    timeout: 20000,
  });
  await alice.waitForTimeout(400);

  const toute = await mesure(alice, 'Voir toute la table', 'recenter');
  const moi = await mesure(alice, 'Recentrer sur moi', 'recenter-me');
  await alice.screenshot({ path: `probe-cadrage-${titre.replace(/[^a-z0-9]+/gi, '-')}.png` });

  if (bob) await bob.close();
  await alice.close();
  return { toute, moi };
}

await serie('bureau-1-siege', { width: 1600, height: 1000 }, 1);
await serie('bureau-2-sieges', { width: 1600, height: 1000 }, 2);
await serie('etroit-2-sieges', { width: 430, height: 900 }, 2);

await browser.close();

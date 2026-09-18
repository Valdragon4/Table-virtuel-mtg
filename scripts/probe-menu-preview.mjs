/**
 * Sonde : l'aperçu reste en bas à gauche, sauf s'il cacherait la carte survolée.
 *
 * La demande, telle que l'utilisateur la formule : « je veux que ce soit en bas
 * à gauche sauf quand la carte en question passerait en dessous de la preview ».
 * Cette sonde exerce donc les deux versants de la règle, et surtout le second —
 * qu'aucun déplacement ne « colle » : après une carte qui force un autre coin,
 * la suivante doit ramener l'aperçu chez lui.
 *
 * Terrain d'essai : la grille d'une fouille de bibliothèque. C'est le seul
 * endroit où l'on dispose d'un lot de cartes dont certaines tombent sous le
 * coin bas-gauche et d'autres non, dans la même vue.
 *
 *   node scripts/probe-menu-preview.mjs [url-de-base]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3000';

const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '4 Fable of the Mirror-Breaker',
  '4 Sol Ring',
  '4 Arcane Signet',
  '10 Plains',
  '10 Swamp',
].join('\n');

/** Intersection de deux boîtes, en pixels carrés. */
function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Table et siège...');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /obtenir le lien/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z0-9]+/i, { timeout: 15000 });
  await page.getByPlaceholder('Invité').fill('Alice');
  await page.locator('textarea').first().fill(DECK);
  await page.getByRole('button', { name: "S'asseoir à la table" }).click();
  await page.waitForFunction(
    () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') ?? 0) > 0,
    null,
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForFunction(() => window.__mtg?.getState().room?.status === 'PLAYING', null, {
    timeout: 15000,
  });

  console.log('2. Ouverture de la fouille...');
  const seat = await page.evaluate(() => window.__mtg.getState().mySeat);
  await page.locator(`[data-zone="${seat}|LIBRARY"]`).first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Fouiller la bibliothèque' }).click();
  await page.locator('[data-test="look-modal"]').waitFor({ timeout: 10000 });

  const preview = page.locator('[data-test="card-preview"]');

  /**
   * Survole une carte de la grille et rend ce que l'aperçu en fait.
   * Le survol passe par la souris : c'est `hover.ts` qui décide, et il lit la
   * position du pointeur, pas un événement synthétique.
   */
  async function hoverCard(index) {
    const visual = page.locator('[data-test="look-card"]').nth(index).locator('.relative.cursor-pointer').first();
    const box = await visual.boundingBox();
    /*
     * Deux pas, et une attente franche. L'aperçu naît après un délai (le store
     * l'impose pour ne pas clignoter quand on balaie une liste) : lire le coin
     * trop tôt, c'est lire celui de la carte précédente — la sonde mentait.
     */
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 40);
    await page.waitForTimeout(60);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await preview.waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    return {
      corner: await preview.getAttribute('data-preview-corner'),
      previewBox: await preview.boundingBox(),
      spriteBox: await page.locator('[data-test="look-card"]').nth(index).locator('[data-card]').first().boundingBox(),
    };
  }

  /*
   * Le coin bas-gauche par défaut, mesuré une fois : il sert à trier les cartes
   * de la grille en « celles qui tomberaient dessous » et les autres.
   */
  const first = await hoverCard(0);
  const home = await page.evaluate(() => {
    const el = document.querySelector('[data-test="card-preview"]');
    const r = el.getBoundingClientRect();
    return { x: 16, y: window.innerHeight - r.height - 16, width: r.width, height: r.height };
  });
  console.log(`   première carte : coin « ${first.corner} »`);

  const classed = await page.evaluate((zone) => {
    const cards = [...document.querySelectorAll('[data-test="look-card"]')];
    const under = [];
    const clear = [];
    cards.forEach((el, index) => {
      /*
       * Le visuel de la carte, pas la cellule de la grille : la cellule porte
       * aussi le nom et la barre d'actions, et c'est le visuel qui est
       * l'« originale » qu'on ne veut pas cacher.
       */
      const r = (el.querySelector('[data-card]') ?? el).getBoundingClientRect();
      // La grille défile : une carte hors de la fenêtre ne se survole pas.
      if (r.top < 0 || r.bottom > window.innerHeight) return;
      const w = Math.min(r.right, zone.x + zone.width) - Math.max(r.left, zone.x);
      const h = Math.min(r.bottom, zone.y + zone.height) - Math.max(r.top, zone.y);
      const area = w > 0 && h > 0 ? w * h : 0;
      if (area / (r.width * r.height) > 0.05) under.push(index);
      else clear.push(index);
    });
    return { under, clear };
  }, home);
  console.log(`   ${classed.under.length} carte(s) sous le coin bas-gauche, ${classed.clear.length} ailleurs`);

  console.log('3. Une carte hors du coin : l’aperçu doit rester en bas à gauche...');
  if (classed.clear.length === 0) throw new Error('aucune carte hors du coin bas-gauche dans la grille');
  const away = await hoverCard(classed.clear[0]);
  if (away.corner !== 'bottom-left') {
    throw new Error(`aperçu déplacé sans raison : « ${away.corner} »`);
  }
  console.log('   bas-gauche, comme attendu.');

  if (classed.under.length === 0) {
    console.log('4. (aucune carte ne tombe sous le coin bas-gauche : bascule non exercée)');
  } else {
    console.log('4. Une carte sous le coin : l’aperçu doit se déplacer...');
    const beneath = await hoverCard(classed.under[0]);
    if (beneath.corner === 'bottom-left') {
      throw new Error('l’aperçu recouvre la carte qu’il montre et n’a pas bougé');
    }
    const collision = overlap(beneath.previewBox, beneath.spriteBox);
    console.log(`   déplacé vers « ${beneath.corner} », recouvrement restant : ${Math.round(collision)} px²`);
    if (collision / (beneath.spriteBox.width * beneath.spriteBox.height) > 0.05) {
      throw new Error('l’aperçu recouvre encore la carte après déplacement');
    }

    console.log('5. Retour sur une carte dégagée : le coin ne doit pas coller...');
    const back = await hoverCard(classed.clear[0]);
    if (back.corner !== 'bottom-left') {
      throw new Error(`le coin est resté collé en « ${back.corner} » au lieu de revenir en bas à gauche`);
    }
    console.log('   revenu en bas à gauche.');
  }

  console.log('6. Fermeture de la fouille, puis survol d’une carte de la table...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const submit = page.locator('[data-test="look-submit"]');
  if (await submit.count()) {
    await submit.first().click();
    await page.waitForTimeout(600);
  }
  await page.locator('[data-test="look-modal"]').waitFor({ state: 'detached', timeout: 10000 });

  // La carte la plus à droite de la main : elle ne peut pas tomber sous le coin
  // bas-gauche, donc l'aperçu doit y revenir. C'est le défaut signalé par
  // l'utilisateur — « en haut à droite pour toutes les cartes ensuite ».
  const handCount = await page.locator('[data-zone$="|HAND"] [data-card]').count();
  const handCard = page.locator('[data-zone$="|HAND"] [data-card]').nth(Math.max(0, handCount - 1));
  if (handCount > 0) {
    const box = await handCard.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await preview.waitFor({ timeout: 5000 });
    await page.waitForTimeout(150);
    const corner = await preview.getAttribute('data-preview-corner');
    const sprite = await handCard.boundingBox();
    console.log(
      `   après la fouille, coin « ${corner} » (carte en x ${Math.round(sprite.x)}, ` +
        `coin d’origine jusqu’à x ${Math.round(home.x + home.width)})`,
    );
    if (corner !== 'bottom-left') {
      throw new Error(`l’aperçu est resté en « ${corner} » après la fermeture de la fouille`);
    }
  } else {
    console.log('   (main vide : cas non exercé)');
  }

  console.log('\nTOUT PASSE : bas à gauche par défaut, et il ne bouge que pour la carte survolée.');
  await browser.close();
}

run().catch(async (error) => {
  console.error('\nÉCHEC DE LA SONDE :', error.message ?? error);
  process.exit(1);
});

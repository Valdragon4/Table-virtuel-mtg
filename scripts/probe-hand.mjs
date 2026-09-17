/**
 * Ranger sa main.
 *
 * On glisse une carte de la main dans la main elle-même : elle doit s'insérer
 * là où on la lâche, et l'ordre doit tenir — côté serveur comme à l'écran.
 *
 *   node scripts/probe-hand.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? process.env.MTG_BASE_URL ?? 'http://localhost:3000';
const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '10 Plains',
  '10 Swamp',
  '10 Mountain',
].join('\n');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} - ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

/** L'ordre de la main tel que le client l'affiche. */
const handOrder = () =>
  page.evaluate(() => {
    const s = window.__mtg.getState();
    return [...s.cards.values()]
      .filter((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat)
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map((c) => c.id);
  });

/** L'ordre rendu dans le rail, qui doit être le même. */
const railOrder = () =>
  page.$$eval('[data-hand-card]', (nodes) => nodes.map((n) => n.dataset.handCard));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /obtenir le lien/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 20000 });
  await page.getByPlaceholder('Invité').fill('Alice');
  await page.getByPlaceholder(/Sol Ring/).fill(DECK);
  await page.getByRole('button', { name: "S'asseoir à la table" }).click();
  await page.getByText('Journal').waitFor({ state: 'visible', timeout: 40000 });
  await page.getByRole('button', { name: /Lancer la partie/ }).click();
  await page.waitForFunction(() => window.__mtg.getState().room?.status === 'PLAYING', null, {
    timeout: 20000,
  });
  await page.waitForTimeout(800);

  const before = await handOrder();
  check('la main est servie', before.length >= 7, `${before.length} carte(s)`);
  check('le rail rend la main dans l’ordre du modèle', (await railOrder()).join() === before.join());

  // --------------------------- la première carte s'en va à l'autre bout
  const first = page.locator(`[data-hand-card="${before[0]}"]`);
  const last = page.locator(`[data-hand-card="${before[before.length - 1]}"]`);
  const from = await first.boundingBox();
  const to = await last.boundingBox();

  await page.mouse.move(from.x + from.width * 0.2, from.y + from.height * 0.5);
  await page.mouse.down();
  // Un geste, pas un saut : le glissement ne s'arme qu'après quelques pixels.
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      from.x + from.width * 0.2 + ((to.x + to.width - (from.x + from.width * 0.2)) * i) / 12,
      from.y + from.height * 0.5,
    );
    await page.waitForTimeout(16);
  }
  const slotShown = await page
    .locator('[data-test="hand-slot"]')
    .isVisible()
    .catch(() => false);
  check('la fente d’insertion se montre pendant le geste', slotShown);
  await page.mouse.up();
  await page.waitForTimeout(900);

  const after = await handOrder();
  check('la main garde toutes ses cartes', after.length === before.length, `${after.length}`);
  check(
    'la carte déplacée est allée en fin de main',
    after[after.length - 1] === before[0],
    `attendu ${before[0]}, obtenu ${after[after.length - 1]}`,
  );
  check(
    'les autres cartes gardent leur ordre relatif',
    after.slice(0, -1).join() === before.slice(1).join(),
    after.slice(0, -1).join(),
  );
  check('aucun rang en double', new Set(after).size === after.length);
  check('le rail suit le modèle', (await railOrder()).join() === after.join());

  // ------------------------------------ et le retour, vers le tout début
  const mover = after[after.length - 1];
  const head = await page.locator(`[data-hand-card="${after[0]}"]`).boundingBox();
  const tail = await page.locator(`[data-hand-card="${mover}"]`).boundingBox();
  await page.mouse.move(tail.x + tail.width * 0.5, tail.y + tail.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      tail.x + tail.width * 0.5 + ((head.x + 4 - (tail.x + tail.width * 0.5)) * i) / 12,
      tail.y + tail.height * 0.5,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const back = await handOrder();
  check('la carte revient en tête', back[0] === mover, `${back[0]}`);
  check('la main est intacte', back.length === before.length && new Set(back).size === back.length);

  // Ranger sa main ne doit pas bavarder dans le journal : ce n'est pas une
  // action de jeu, et personne d'autre n'a à la lire.
  const noise = await page.evaluate(() =>
    window.__mtg
      .getState()
      .log.filter((entry) => /main vers main/.test(entry.text)).length,
  );
  check('aucune ligne de journal pour un rangement', noise === 0, `${noise} ligne(s)`);

  // ------------------------------------------------- le tri d'un seul geste
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('button', { name: 'Trier la main' }).click();
  await page.waitForTimeout(1500);
  const sorted = await handOrder();
  check('la main est intacte après tri', sorted.length === before.length, `${sorted.length}`);
  check('le rail suit le tri', (await railOrder()).join() === sorted.join());

  // Le deck n'a que des terrains de base et un commandant : « terrain » se lit
  // donc au nom, sans avoir à exposer l'index de cartes à la sonde.
  const names = await page.$$eval('[data-hand-card] img', (nodes) => nodes.map((n) => n.alt));
  const lands = names.map((name) => /^(Plains|Swamp|Mountain|Forest|Island)$/.test(name));
  const firstOther = lands.indexOf(false);
  check(
    'les terrains sont groupés en tête',
    firstOther === -1 || !lands.slice(firstOther).includes(true),
    names.join(' | '),
  );
} catch (error) {
  check('déroulé complet', false, String(error).split('\n')[0]);
} finally {
  await browser.close();
  console.log(failures === 0 ? '\nTout est passé' : `\n${failures} ÉCHEC(S)`);
  process.exit(0);
}

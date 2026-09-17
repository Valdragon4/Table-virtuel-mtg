/**
 * Sonde temporaire : capture du dialogue « Marqueur personnalisé… » en mode
 * « Effets classiques », et mesure de son encombrement réel.
 *
 *   node probe-dialogue-capture.mjs <avant|apres> [url-de-base]
 */
import { chromium } from '@playwright/test';

const TAG = process.argv[2] ?? 'avant';
const BASE = process.argv[3] ?? 'http://localhost:3000';
const NL = String.fromCharCode(10);
const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '8 Serra Angel',
  '4 Sol Ring',
  '20 Plains',
].join(NL);

const browser = await chromium.launch({ headless: true });
// Une fenêtre de hauteur ordinaire : c'est le cas que l'utilisateur décrit.
const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
const page = await context.newPage();
await page.goto(BASE + '/');
await page.getByRole('button', { name: /obtenir le lien/i }).click();
await page.waitForURL(/\/rooms\//);
await page.getByPlaceholder('Invité').fill('Alice');
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
await page.getByRole('button', { name: 'Lancer la partie' }).click();
await page.waitForFunction(() => window.__mtg.getState().room?.status === 'PLAYING', null, {
  timeout: 20000,
});

const seat = await page.evaluate(() => window.__mtg.getState().mySeat);
const id = await page.evaluate(() => {
  const s = window.__mtg.getState();
  return [...s.cards.values()].find((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat).id;
});
await page.evaluate(
  ([cardId, s]) =>
    window.__mtg
      .getState()
      .send({ type: 'MOVE_CARD', cardId, to: { seat: s, kind: 'BATTLEFIELD' }, x: 500, y: 260 }),
  [id, seat],
);
await page.waitForTimeout(1500);

const box = await page.locator(`[data-card="${id}"]`).boundingBox();
await page.locator(`[data-card="${id}"]`).dispatchEvent('contextmenu', {
  bubbles: true,
  button: 2,
  clientX: Math.round(box.x + box.width / 2),
  clientY: Math.round(box.y + box.height / 2),
});
await page.locator('[data-test="card-menu"]').waitFor({ timeout: 8000 });
await page
  .locator('[data-test="card-menu"] button')
  .filter({ hasText: 'Marqueur personnalisé' })
  .first()
  .click();
await page.locator('[data-test="dialog"]').waitFor({ timeout: 8000 });
await page.locator('[data-test="dialog-option"][data-field="forme"][data-value="calc"]').click();
await page.waitForTimeout(400);

const mesure = await page.evaluate(() => {
  const form = document.querySelector('[data-test="dialog"]');
  const rect = form.getBoundingClientRect();
  const submit = document.querySelector('[data-test="dialog-submit"]').getBoundingClientRect();
  return {
    hauteurDialogue: Math.round(rect.height),
    hauteurFenetre: window.innerHeight,
    hautCoupe: Math.round(rect.top) < 0,
    basCoupe: Math.round(rect.bottom) > window.innerHeight,
    validerVisible: submit.bottom <= window.innerHeight && submit.top >= 0,
    pastilles: document.querySelectorAll('[data-test="dialog-option"][data-field="calcsrc"]').length,
  };
});
console.log(TAG, JSON.stringify(mesure, null, 2));
await page.screenshot({ path: `dialogue-${TAG}.png` });
await browser.close();

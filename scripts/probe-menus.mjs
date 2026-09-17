import { chromium } from '@playwright/test';
const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const NL = String.fromCharCode(10);
const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '// Deck', '4 Sol Ring', '20 Plains'].join(NL);
await page.goto('http://localhost:3000/');
await page.getByRole('button', { name: /obtenir le lien/i }).click();
await page.waitForURL(/\/rooms\//);
await page.getByPlaceholder('Invité').fill('Alice');
await page.locator('textarea').first().fill(DECK);
await page.getByRole('button', { name: /S'asseoir/ }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'Lancer la partie' }).click();
await page.waitForTimeout(2500);

// D'abord poser une carte, puis son menu contextuel.
await page.evaluate(() => {
  const s = window.__mtg.getState();
  const c = [...s.cards.values()].find((x) => x.zone.kind === 'HAND');
  s.send({ type: 'MOVE_CARD', cardId: c.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 150, y: 150 });
});
await page.waitForTimeout(1200);
const card = page.locator('[data-card-id] img[src*="scryfall"]').first();
console.log('carte sur le champ :', await card.count());
await card.click({ button: 'right' });
await page.waitForTimeout(900);
const cardEntries = await page.evaluate(() =>
  [...document.querySelectorAll('div.fixed.z-50 button')].map((b) => b.textContent.trim()).filter(Boolean));
console.log('menu carte :', cardEntries.join(' | ').slice(0, 300));
const marker = page.getByRole('button', { name: /Ajouter un marqueur/ });
console.log('bouton marqueur :', await marker.count());
if (await marker.count()) {
  await marker.first().click();
  await page.waitForTimeout(1500);
  const withCounters = await page.evaluate(() =>
    [...window.__mtg.getState().cards.values()].filter((c) => c.counters.length > 0).length);
  console.log('cartes avec marqueur :', withCounters);
  console.log('dernier refus :', await page.evaluate(() => window.__mtg.getState().lastReject));
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

for (const kind of ['GRAVEYARD', 'COMMAND', 'LIBRARY']) {
  const pile = page.locator(`button[data-zone$="|${kind}"]`).first();
  const n = await pile.count();
  if (!n) { console.log(kind, ': pile introuvable'); continue; }
  await pile.click({ button: 'right' });
  await page.waitForTimeout(900);
  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('div.fixed.z-50 button')].map((b) => b.textContent.trim()).filter(Boolean));
  console.log(kind, ':', entries.length ? entries.join(' | ') : 'AUCUN MENU');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
await b.close();

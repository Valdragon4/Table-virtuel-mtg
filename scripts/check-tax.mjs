// Vérifie que la zone de commandement montre la taxe et non un compte.
import { chromium } from '@playwright/test';
const OUT = process.argv[2] ?? '.';
const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const NL = String.fromCharCode(10);
const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '// Deck', '4 Sol Ring', '20 Plains'].join(NL);

await page.goto('http://localhost:3000/');
await page.getByRole('button', { name: /Créer/ }).first().click();
await page.waitForURL(/\/rooms\//);
await page.getByPlaceholder('Invité').fill('Alice');
await page.locator('textarea').first().fill(DECK);
await page.getByRole('button', { name: /S'asseoir/ }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'Lancer la partie' }).click();
await page.waitForTimeout(2500);

const pileBadge = async () => page.evaluate(() => {
  const pile = document.querySelector('button[data-zone$="|COMMAND"]');
  return pile ? pile.querySelector('span:last-of-type')?.textContent?.trim() ?? null : 'pile absente';
});
console.log('badge au départ :', await pileBadge());

// On lance le commandant : il quitte la zone de commandement.
const cmd = await page.evaluate(() => {
  const s = window.__mtg.getState();
  const c = [...s.cards.values()].find((x) => x.zone.kind === 'COMMAND');
  if (!c) return null;
  s.send({ type: 'MOVE_CARD', cardId: c.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 200, y: 200 });
  return c.id;
});
await page.waitForTimeout(1200);
// Puis il revient en zone de commandement.
await page.evaluate((id) => {
  const s = window.__mtg.getState();
  s.send({ type: 'MOVE_CARD', cardId: id, to: { seat: s.mySeat, kind: 'COMMAND' } });
}, cmd);
await page.waitForTimeout(1500);
console.log('badge après un lancement :', await pileBadge());
console.log('taxe dans le store :', await page.evaluate(() => {
  const s = window.__mtg.getState();
  return JSON.stringify(s.seats.find((x) => x.id === s.mySeat)?.commanderTax);
}));
await page.screenshot({ path: `${OUT}/taxe-commandement.png` });
await b.close();

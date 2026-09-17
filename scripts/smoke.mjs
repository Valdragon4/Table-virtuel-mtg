// Fumée bout-en-bout sur notre propre pile : s'asseoir, jouer, ouvrir les menus.
import { chromium } from '@playwright/test';
const OUT = process.argv[2] ?? '.';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '', '// Deck',
  '4 Sol Ring', '4 Arcane Signet', '10 Plains', '10 Swamp'].join('\n');

const step = async (label, fn) => {
  try { await fn(); console.log('OK  -', label); }
  catch (e) { console.log('ÉCHEC -', label, '::', String(e).split('\n')[0].slice(0, 160)); }
};

try {
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await step('créer une table', async () => {
    await page.getByRole('button', { name: /obtenir le lien/i }).click();
    await page.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 15000 });
  });
  console.log('    table:', page.url());

  await step('s’asseoir avec une liste collée', async () => {
    await page.getByPlaceholder('Invité').fill('Alice');
    await page.locator('textarea').first().fill(DECK);
    await page.getByRole('button', { name: "S'asseoir à la table" }).click();
    await page.getByText('Journal').waitFor({ timeout: 20000 });
    // Le chargement du deck est asynchrone : lancer la partie avant qu'il soit
    // fini donnait une bibliothèque vide et faisait échouer tout le reste.
    await page.waitForFunction(
      () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') ?? 0) > 0,
      null,
      { timeout: 30000 },
    );
  });

  await step('lancer la partie', async () => {
    await page.getByRole('button', { name: 'Lancer la partie' }).click();
    await page.waitForFunction(() => window.__mtg?.getState().room?.status === 'PLAYING', null, { timeout: 15000 });
  });

  const state = async () => page.evaluate(() => {
    const s = window.__mtg.getState();
    return { seq: s.seq, main: [...s.cards.values()].filter((c) => c.zone.kind === 'HAND').length,
             lib: s.zoneCounts.get(s.mySeat + '|LIBRARY'), log: s.log.length };
  });
  console.log('    après démarrage:', JSON.stringify(await state()));

  await step('piocher au clavier', async () => {
    await page.keyboard.press('d');
    await page.waitForTimeout(800);
  });
  console.log('    après pioche:', JSON.stringify(await state()));

  await step('clic droit sur une carte en main', async () => {
    const card = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
    await card.click({ button: 'right' });
    await page.getByText('Jouer face cachée').waitFor({ timeout: 5000 });
  });
  await page.screenshot({ path: `${OUT}/mtg-hand-menu.png` });

  await step('jouer la carte depuis le menu', async () => {
    // Première entrée du menu de carte : « Jouer ». On ne la vise pas par son
    // nom accessible, qui inclut le raccourci affiché à droite.
    await page.locator('div.fixed.z-50.w-60 button').first().click();
    await page.waitForTimeout(900);
  });

  await step('clic droit sur le permanent', async () => {
    await page.locator('[data-zone$="|BATTLEFIELD"] img').first().click({ button: 'right' });
    await page.getByText('Ajouter un marqueur +1/+1').waitFor({ timeout: 5000 });
  });
  await page.screenshot({ path: `${OUT}/mtg-battlefield-menu.png` });

  await step('poser un marqueur', async () => {
    await page.getByRole('button', { name: /Ajouter un marqueur/ }).click();
    await page.waitForTimeout(800);
  });

  await step('clic droit sur la bibliothèque', async () => {
    await page.locator('button[data-zone$="|LIBRARY"]').first().click({ button: 'right' });
    await page.getByText('Fouiller la bibliothèque').waitFor({ timeout: 5000 });
  });
  await page.screenshot({ path: `${OUT}/mtg-library-menu.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await step('scry via le menu Actions', async () => {
    await page.getByRole('button', { name: /Actions/ }).click();
    await page.getByRole('button', { name: 'Scry 1' }).click();
    await page.getByText('Consultation —').waitFor({ timeout: 8000 });
  });
  await page.screenshot({ path: `${OUT}/mtg-scry.png` });

  await step('valider la consultation', async () => {
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await page.waitForTimeout(800);
  });

  await step('lancer un d20', async () => {
    await page.getByRole('button', { name: 'd20' }).click();
    await page.waitForTimeout(600);
  });

  console.log('    état final:', JSON.stringify(await state()));
  console.log('\n--- journal ---');
  console.log(await page.evaluate(() => window.__mtg.getState().log.slice(-8).map((l) => l.text).join('\n')));
  await page.screenshot({ path: `${OUT}/mtg-table.png` });
} catch (e) {
  console.log('ERREUR GLOBALE', String(e).slice(0, 300));
} finally {
  console.log('\n--- erreurs console ---');
  console.log(errors.length ? [...new Set(errors)].slice(0, 8).join('\n') : 'aucune');
  await browser.close();
}

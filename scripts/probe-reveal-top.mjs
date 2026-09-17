import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? '.';
const browser = await chromium.launch({ headless: true });

const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const pageA = await ctxA.newPage();

const ctxB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const pageB = await ctxB.newPage();

const errorsA = [];
const errorsB = [];
pageA.on('pageerror', (e) => errorsA.push('pageA error: ' + String(e)));
pageB.on('pageerror', (e) => errorsB.push('pageB error: ' + String(e)));

const DECK_ALICE = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '4 Sol Ring',
  '4 Arcane Signet',
  '4 Lightning Bolt',
  '4 Swords to Plowshares',
  '10 Plains',
  '10 Swamp',
].join('\n');

const DECK_BOB = [
  '// Commander',
  '1 Isamaru, Hound of Konda',
  '',
  '// Deck',
  '20 Plains',
].join('\n');

const step = async (label, fn) => {
  try {
    await fn();
    console.log('OK  -', label);
  } catch (e) {
    console.log('ÉCHEC -', label, '::', String(e).split('\n')[0].slice(0, 200));
    throw e;
  }
};

try {
  let roomUrl = '';

  await step('Alice crée une table', async () => {
    await pageA.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await pageA.getByRole('button', { name: /obtenir le lien/i }).click();
    await pageA.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 15000 });
    roomUrl = pageA.url();
    console.log('    Table créée :', roomUrl);
  });

  await step('Alice s’assoit avec son deck', async () => {
    await pageA.getByPlaceholder('Invité').fill('Alice');
    await pageA.locator('textarea').first().fill(DECK_ALICE);
    await pageA.getByRole('button', { name: "S'asseoir à la table" }).click();
    await pageA.getByText('Journal').waitFor({ timeout: 20000 });
    await pageA.waitForFunction(
      () => (window.__mtg?.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') ?? 0) > 0,
      null,
      { timeout: 30000 },
    );
  });

  await step('Bob rejoint la table et s’assoit', async () => {
    await pageB.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await pageB.getByPlaceholder('Invité').fill('Bob');
    await pageB.locator('textarea').first().fill(DECK_BOB);
    await pageB.getByRole('button', { name: "S'asseoir à la table" }).click();
    await pageB.getByText('Journal').waitFor({ timeout: 20000 });
    await pageB.waitForFunction(
      () => (window.__mtg?.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') ?? 0) > 0,
      null,
      { timeout: 30000 },
    );
  });

  await step('Alice lance la partie', async () => {
    await pageA.getByRole('button', { name: 'Lancer la partie' }).click();
    await pageA.waitForFunction(() => window.__mtg?.getState().room?.status === 'PLAYING', null, { timeout: 15000 });
    await pageB.waitForFunction(() => window.__mtg?.getState().room?.status === 'PLAYING', null, { timeout: 15000 });
  });

  await step('Alice ouvre le menu de sa bibliothèque et déclenche la révélation du dessus (4 cartes)', async () => {
    const libBtn = pageA.locator('button[data-zone$="|LIBRARY"]').first();
    await libBtn.click({ button: 'right' });
    await pageA.getByRole('button', { name: 'Révéler le dessus (X cartes)' }).waitFor({ timeout: 5000 });

    // Clic sur le bouton de saisie du nombre (...) pour révéler 4 cartes
    const moreBtn = pageA.locator('[data-test="zone-menu-more"][data-for="Révéler le dessus (X cartes)"]');
    await moreBtn.click();

    // La boîte de dialogue demande le nombre (initial: 4)
    await pageA.locator('[data-test="dialog-submit"]').waitFor({ timeout: 5000 });
    await pageA.locator('[data-test="dialog-submit"]').click();

    // Alice voit LookModal en mode Révélation
    await pageA.locator('[data-test="look-modal"]').waitFor({ timeout: 10000 });
    const title = await pageA.locator('[data-test="look-modal"] h2').textContent();
    console.log('    Titre LookModal Alice :', title);
  });

  await step('Bob observe les cartes révélées via PublicRevealModal', async () => {
    await pageB.locator('[data-test="public-reveal-modal"]').waitFor({ timeout: 10000 });
    const modalText = await pageB.locator('[data-test="public-reveal-modal"]').textContent();
    console.log('    Bandeau Bob :', modalText?.slice(0, 120));
    await pageB.screenshot({ path: `${OUT}/bob-public-reveal.png` });
  });

  await step('Alice assigne les cartes à différentes destinations', async () => {
    const cardItems = pageA.locator('[data-test="look-card"]');
    const count = await cardItems.count();
    console.log(`    Cartes dans LookModal Alice : ${count}`);

    // Carte 0 vers main
    await cardItems.nth(0).getByRole('button', { name: /Main/ }).click();
    // Carte 1 vers champ de bataille
    await cardItems.nth(1).getByRole('button', { name: /Champ/ }).click();
    // Carte 2 vers cimetière (via menu d'actions •••)
    await cardItems.nth(2).getByRole('button', { name: '•••' }).click();
    await pageA.locator('[data-test="look-action-graveyard"]').click();

    await pageA.screenshot({ path: `${OUT}/alice-look-modal-reveal.png` });
  });

  await step('Alice valide et mélange', async () => {
    const submitBtn = pageA.locator('[data-test="look-submit"]');
    await submitBtn.click();
    await pageA.waitForTimeout(1000);
  });

  await step('Vérification : fermetures et journal enrichi', async () => {
    // LookModal fermée pour Alice
    const aliceLookOpen = await pageA.locator('[data-test="look-modal"]').count();
    console.log('    LookModal Alice fermée ?', aliceLookOpen === 0);

    // PublicRevealModal fermée pour Bob
    const bobRevealOpen = await pageB.locator('[data-test="public-reveal-modal"]').count();
    console.log('    PublicRevealModal Bob fermée ?', bobRevealOpen === 0);

    // Journal d'Alice
    const logs = await pageA.evaluate(() => window.__mtg.getState().log.slice(-6).map((l) => l.text));
    console.log('\n--- Derniers logs Alice ---');
    console.log(logs.join('\n'));

    // Journal de Bob
    const logsBob = await pageB.evaluate(() => window.__mtg.getState().log.slice(-6).map((l) => l.text));
    console.log('\n--- Derniers logs Bob ---');
    console.log(logsBob.join('\n'));

    // Vérifier les fragments dans les logs
    const hasRevealLog = logs.some((l) => l.includes('a révélé les 4 carte') && l.includes('du dessus de sa bibliothèque'));
    const hasResolveLog = logs.some((l) => l.includes('a terminé sa révélation') && l.includes('bibliothèque mélangée'));

    console.log('    Log de révélation présent ?', hasRevealLog);
    console.log('    Log de résolution détaillé avec mélange présent ?', hasResolveLog);

    if (!hasRevealLog || !hasResolveLog) {
      throw new Error('Les logs attendus ne correspondent pas aux critères!');
    }
  });

  await step('Vérification bug aperçu persistant : Échap pendant le survol efface l’aperçu', async () => {
    // Alice ouvre la fouille
    const libBtn = pageA.locator('button[data-zone$="|LIBRARY"]').first();
    await libBtn.click({ button: 'right' });
    await pageA.getByRole('button', { name: 'Fouiller la bibliothèque' }).click();
    await pageA.locator('[data-test="look-modal"]').waitFor({ timeout: 10000 });

    // Survoler la première carte
    const firstCard = pageA.locator('[data-test="look-card"]').first();
    await firstCard.hover();
    await pageA.waitForTimeout(400);

    const previewBefore = await pageA.evaluate(() => window.__mtg.getState().hoveredPreview);
    console.log('    Aperçu actif pendant le survol :', previewBefore !== null);

    // Appuyer sur Échap pour quitter
    await pageA.keyboard.press('Escape');
    await pageA.waitForTimeout(500);

    // Vérifier que LookModal est bien fermée
    const lookModalCount = await pageA.locator('[data-test="look-modal"]').count();
    console.log('    LookModal fermée après Échap ?', lookModalCount === 0);

    // Vérifier que l'aperçu est bel et bien effacé
    const previewAfter = await pageA.evaluate(() => window.__mtg.getState().hoveredPreview);
    const previewVisible = await pageA.locator('[data-test="card-preview"]').isVisible();
    console.log('    hoveredPreview après Échap :', previewAfter);
    console.log('    card-preview visible après Échap ?', previewVisible);

    if (previewAfter !== null || previewVisible) {
      throw new Error('L’aperçu est resté affiché après avoir quitté avec Échap !');
    }
  });

  console.log('\n TOUS LES TESTS DE RÉVÉLATION DU DESSUS ONT RÉUSSI !');
} catch (err) {
  console.error('ERREUR DURANT LE PROBE :', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}

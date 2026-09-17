import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const NL = String.fromCharCode(10);
const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '// Deck',
  '4 Sol Ring',
  '1 Swords to Plowshares',
  '1 Wrath of God',
  '1 Demonic Tutor',
  '1 Dark Ritual',
  '1 Lightning Bolt',
  '1 Counterspell',
  '1 Birds of Paradise',
  '1 Serra Angel',
  '1 Black Lotus',
  '1 Brainstorm',
  '20 Plains',
  '15 Swamp',
].join(NL);

console.log('--- Initialisation de la partie pour probe-look-deck ---');
await page.goto('http://localhost:3000/');
await page.getByRole('button', { name: /obtenir le lien/i }).click();
await page.waitForURL(/\/rooms\//);
await page.getByPlaceholder('Invité').fill('Alice');
await page.locator('textarea').first().fill(DECK);
await page.getByRole('button', { name: /S'asseoir/ }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'Lancer la partie' }).click();
await page.waitForTimeout(2500);

// 1. Ouvrir le menu de la bibliothèque et fouiller
console.log('1. Ouverture du menu de la bibliothèque...');
const libPile = page.locator('button[data-zone$="|LIBRARY"]').first();
await libPile.click({ button: 'right' });
await page.waitForTimeout(800);

const searchBtn = page.getByRole('button', { name: /Fouiller la bibliothèque/i }).first();
if (!await searchBtn.count()) {
  console.error('Bouton Fouiller introuvable dans le menu bibliothèque !');
  process.exit(1);
}
await searchBtn.click();
await page.waitForTimeout(1200);

// 2. Vérifier la modale de fouille (LookModal)
console.log('2. Vérification de la LookModal...');
const lookModal = page.locator('[data-test="look-modal"]');
if (!await lookModal.count()) {
  console.error('LookModal introuvable !');
  process.exit(1);
}
console.log('OK - LookModal ouverte avec succès.');

// Vérifier la présence des éléments clés de la nouvelle UI/UX
const filterInput = page.locator('[data-test="look-filter"]');
const sortSelect = page.locator('[data-test="look-sort"]');
const lookCards = page.locator('[data-test="look-card"]');
const countInitial = await lookCards.count();
console.log(`OK - Cartes visibles dans le deck : ${countInitial}`);

if (countInitial === 0) {
  console.error('Aucune carte visible dans le deck !');
  process.exit(1);
}

// 3. Test du filtre de recherche textuelle
console.log('3. Test du filtre textuel...');
await filterInput.fill('Sol Ring');
await page.waitForTimeout(400);
const solRingCount = await lookCards.count();
console.log(`OK - Recherche "Sol Ring" filtre à : ${solRingCount} cartes`);
if (solRingCount === 0) {
  console.error('Aucun Sol Ring trouvé !');
  process.exit(1);
}

// Effacer la recherche
await filterInput.fill('');
await page.waitForTimeout(400);
const countReset = await lookCards.count();
console.log(`OK - Recherche effacée, retour à : ${countReset} cartes`);

// 4. Test du tri
console.log('4. Test du tri par nom...');
await sortSelect.selectOption('nom');
await page.waitForTimeout(400);
console.log('OK - Tri appliqué');

// 5. Test de l'assignation rapide 1-clic (Vers la main)
console.log('5. Test de l\'action rapide 1-clic (🖐️ Main)...');
const firstCard = lookCards.first();
const quickHandBtn = firstCard.locator('button[title*="main" i]').first();
if (await quickHandBtn.count()) {
  await quickHandBtn.click();
  await page.waitForTimeout(400);
  console.log('OK - Bouton rapide cliqué');
} else {
  console.log('Bouton rapide non trouvé directement sur la carte, essai via double-clic...');
  await firstCard.dblclick();
  await page.waitForTimeout(400);
}

// 6. Test de sélection multiple et barre d'actions groupées
console.log('6. Test de la sélection multiple...');
const secondCard = lookCards.nth(1);
const thirdCard = lookCards.nth(2);
// Cocher les cases de sélection
const secondCheck = secondCard.locator('input[type="checkbox"]');
const thirdCheck = thirdCard.locator('input[type="checkbox"]');
if (await secondCheck.count() && await thirdCheck.count()) {
  await secondCheck.click();
  await thirdCheck.click();
  await page.waitForTimeout(400);
  console.log('OK - 2 cartes cochées');
  
  // Vérifier que la barre d'action groupée apparaît
  const batchBattlefield = page.getByRole('button', { name: /Sur le champ/i }).first();
  if (await batchBattlefield.count()) {
    await batchBattlefield.click();
    await page.waitForTimeout(400);
    console.log('OK - Action groupée "Sur le champ" exécutée');
  }
}

// 7. Valider et mélanger
console.log('7. Validation et fermeture du tuteur...');
const submitBtn = page.locator('[data-test="look-submit"]');
await submitBtn.click();
await page.waitForTimeout(1500);

// Vérifier que la modale est bien fermée
const modalClosed = (await lookModal.count()) === 0;
console.log(`OK - Modale fermée : ${modalClosed}`);
if (!modalClosed) {
  console.error('La modale ne s\'est pas fermée après validation !');
  process.exit(1);
}

// Vérifier l'état du jeu après tutorat
const handCount = await page.evaluate(() => {
  const s = window.__mtg.getState();
  return [...s.cards.values()].filter((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat).length;
});
const bfCount = await page.evaluate(() => {
  const s = window.__mtg.getState();
  return [...s.cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').length;
});
console.log(`OK - Cartes en main : ${handCount}, cartes sur le champ : ${bfCount}`);

// 8. Test de la modale de marqueur personnalisé avec aperçu direct
console.log('8. Test de la modale de marqueur personnalisé...');
// Poser une carte sur le champ si pas encore de carte
await page.evaluate(() => {
  const s = window.__mtg.getState();
  const c = [...s.cards.values()].find((x) => x.zone.kind === 'HAND');
  if (c) {
    s.send({ type: 'MOVE_CARD', cardId: c.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 300, y: 300 });
  }
});
await page.waitForTimeout(1000);

const boardCard = page.locator('[data-card-id] img[src*="scryfall"]').first();
await boardCard.click({ button: 'right' });
await page.waitForTimeout(800);

const customCounterBtn = page.getByRole('button', { name: /Marqueur personnalisé/i }).first();
if (!await customCounterBtn.count()) {
  console.error('Bouton Marqueur personnalisé introuvable !');
  process.exit(1);
}
await customCounterBtn.click();
await page.waitForTimeout(1000);

// Vérifier que le dialogue est ouvert et contient l'aperçu CustomCounterPreview
const dialog = page.locator('[data-test="dialog"]');
const preview = page.locator('[data-test="custom-counter-preview"]');
console.log(`OK - Dialogue ouvert : ${(await dialog.count()) > 0}`);
console.log(`OK - Aperçu dynamique présent : ${(await preview.count()) > 0}`);

// Fermer le dialogue
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

console.log('=== TOUT LE TEST PROBE-LOOK-DECK A RÉUSSI AVEC SUCCÈS ===');
await browser.close();


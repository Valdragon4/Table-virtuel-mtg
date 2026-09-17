import { chromium } from '@playwright/test';

const b = await chromium.launch({ headless: true });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const NL = String.fromCharCode(10);
const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '// Deck', '4 Sol Ring', '20 Plains'].join(NL);

console.log('--- TEST FERMETURE ET DISMISSAL DES MENUS DE CARTES ---');

await page.goto('http://localhost:3000/');
await page.getByRole('button', { name: /obtenir le lien/i }).click();
await page.waitForURL(/\/rooms\//);
await page.getByPlaceholder('Invité').fill('Alice');
await page.locator('textarea').first().fill(DECK);
await page.getByRole('button', { name: /S'asseoir/ }).click();
await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'Lancer la partie' }).click();
await page.waitForTimeout(2500);

// Poser une carte sur le champ
await page.evaluate(() => {
  const s = window.__mtg.getState();
  const c = [...s.cards.values()].find((x) => x.zone.kind === 'HAND');
  s.send({ type: 'MOVE_CARD', cardId: c.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 200, y: 200 });
});
await page.waitForTimeout(1200);

const boardCard = page.locator('[data-card-id] img[src*="scryfall"]').first();

// 1. Test CardMenu sur le plateau : ouverture et fermeture par clic extérieur
console.log('1. Test CardMenu : ouverture et clic extérieur...');
await boardCard.click({ button: 'right' });
await page.waitForTimeout(600);
const cardMenu = page.locator('[data-test="card-menu"]');
if ((await cardMenu.count()) === 0) {
  console.error('ÉCHEC : CardMenu ne s\'est pas ouvert !');
  process.exit(1);
}
console.log('OK - CardMenu ouvert');

// Clic extérieur sur le fond
await page.mouse.click(50, 50);
await page.waitForTimeout(400);
if ((await cardMenu.count()) > 0) {
  console.error('ÉCHEC : CardMenu ne s\'est pas fermé après un clic extérieur !');
  process.exit(1);
}
console.log('OK - CardMenu fermé par clic extérieur');

// 2. Test CardMenu : ouverture et fermeture par Échap
console.log('2. Test CardMenu : ouverture et touche Échap...');
await boardCard.click({ button: 'right' });
await page.waitForTimeout(600);
if ((await cardMenu.count()) === 0) {
  console.error('ÉCHEC : CardMenu ne s\'est pas réouvert !');
  process.exit(1);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
if ((await cardMenu.count()) > 0) {
  console.error('ÉCHEC : CardMenu ne s\'est pas fermé avec la touche Échap !');
  process.exit(1);
}
console.log('OK - CardMenu fermé avec succès avec la touche Échap');

// 3. Ouvrir la modale de fouille de deck (LookModal)
console.log('3. Ouverture de LookModal (Fouiller)...');
const library = page.locator('button[data-zone$="|LIBRARY"]').first();
await library.click({ button: 'right' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: /Fouiller la bibliothèque/i }).click();
await page.waitForTimeout(1000);

const lookModal = page.locator('[data-test="look-modal"]');
if ((await lookModal.count()) === 0) {
  console.error('ÉCHEC : LookModal ne s\'est pas ouverte !');
  process.exit(1);
}
console.log('OK - LookModal ouverte');

// Cartes dans la modale
const lookCards = page.locator('[data-test="look-card"]');
const cardCount = await lookCards.count();
console.log(`OK - ${cardCount} cartes dans LookModal`);

// 4. Test du nouveau menu d'actions de carte dans LookModal
console.log('4. Test ouverture menu d\'action de carte dans LookModal...');
const firstLookCard = lookCards.nth(0);
const dotsBtnFirst = firstLookCard.locator('button:has-text("•••")');
await dotsBtnFirst.click();
await page.waitForTimeout(400);

// Vérifier que le menu est ouvert
const actionMenu = page.locator('div:has-text("Déplacer vers")').first();
if ((await actionMenu.count()) === 0) {
  console.error('ÉCHEC : Le menu d\'actions Déplacer vers ne s\'est pas ouvert !');
  process.exit(1);
}
console.log('OK - Menu Déplacer vers ouvert sur carte 1');

// Test toggle : re-cliquer sur ••• doit fermer le menu
console.log('5. Test toggle (re-clic sur ••• pour fermer)...');
await dotsBtnFirst.click();
await page.waitForTimeout(400);
const countAfterToggle = await page.locator('div:has-text("Déplacer vers")').count();
if (countAfterToggle > 0) {
  console.error('ÉCHEC : Le menu d\'actions ne s\'est pas fermé au re-clic sur ••• !');
  process.exit(1);
}
console.log('OK - Menu refermé avec succès via toggle sur •••');

// Ouvrir à nouveau carte 1
await dotsBtnFirst.click();
await page.waitForTimeout(400);
console.log('OK - Menu réouvert sur carte 1');

// 6. Test clic extérieur dans la modale : cliquer sur l'en-tête ou le fond de la modale
console.log('6. Test clic extérieur dans la modale...');
await page.mouse.click(300, 150); // Clic sur l'en-tête de la modale
await page.waitForTimeout(400);
const countAfterClickOutside = await page.locator('div:has-text("Déplacer vers")').count();
if (countAfterClickOutside > 0) {
  console.error('ÉCHEC : Le menu d\'actions ne s\'est pas fermé au clic extérieur dans la modale !');
  process.exit(1);
}
console.log('OK - Menu refermé avec succès au clic extérieur');

// 7. Test touche Échap sur le menu de carte
console.log('7. Test touche Échap sur menu d\'actions de carte...');
await dotsBtnFirst.click();
await page.waitForTimeout(400);
if ((await page.locator('div:has-text("Déplacer vers")').count()) === 0) {
  console.error('ÉCHEC : Impossible de réouvrir le menu d\'action !');
  process.exit(1);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const countAfterEsc = await page.locator('div:has-text("Déplacer vers")').count();
if (countAfterEsc > 0) {
  console.error('ÉCHEC : Le menu d\'actions ne s\'est pas fermé avec Échap !');
  process.exit(1);
}
// Vérifier que la modale est TOUJOURS ouverte après avoir fermé le sous-menu avec Échap
if ((await lookModal.count()) === 0) {
  console.error('ÉCHEC : Échap a fermé toute la modale au lieu de fermer seulement le sous-menu !');
  process.exit(1);
}
console.log('OK - Échap a fermé le sous-menu tout en maintenant la modale ouverte');

// 8. Test un seul menu ouvert à la fois (ouverture sur carte 1 puis clic ••• sur carte 2)
console.log('8. Test exclusivité d\'un seul menu ouvert...');
await dotsBtnFirst.click();
await page.waitForTimeout(400);
const secondLookCard = lookCards.nth(1);
const dotsBtnSecond = secondLookCard.locator('button:has-text("•••")');
await dotsBtnSecond.click();
await page.waitForTimeout(400);

const activeMenus = await page.locator('span:has-text("Déplacer vers")').count();
console.log(`Nombre de menus Déplacer vers affichés simultanément : ${activeMenus}`);
if (activeMenus !== 1) {
  console.error(`ÉCHEC : Attendu exactement 1 menu, mais ${activeMenus} sont affichés !`);
  process.exit(1);
}
console.log('OK - Exactement 1 seul menu ouvert à la fois');

// 9. Échap ferme la modale quand aucun menu n'est ouvert
console.log('9. Fermeture du sous-menu puis de la modale avec Échap...');
await page.keyboard.press('Escape'); // Ferme le sous-menu
await page.waitForTimeout(300);
await page.keyboard.press('Escape'); // Ferme la modale
await page.waitForTimeout(500);

const modalStillOpen = (await lookModal.count()) > 0;
if (modalStillOpen) {
  console.error('ÉCHEC : LookModal ne s\'est pas fermée au 2e Échap !');
  process.exit(1);
}
console.log('OK - LookModal fermée avec succès via Échap');

console.log('\n========================================');
console.log('🎉 TOUS LES TESTS DE FERMETURE ONT RÉUSSI !');
console.log('========================================');

await b.close();


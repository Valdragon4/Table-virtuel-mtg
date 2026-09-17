import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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

console.log('--- TEST OVERLAP CARTES DANS LOOKMODAL (GRAND + PANNEAU DÉTAILS) ---');
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
const libPile = page.locator('button[data-zone$="|LIBRARY"]').first();
await libPile.click({ button: 'right' });
await page.waitForTimeout(800);

const searchBtn = page.getByRole('button', { name: /Fouiller la bibliothèque/i }).first();
await searchBtn.click();
await page.waitForTimeout(1200);

// 2. Basculer en mode "Grand"
console.log('Bascule en mode "Grand"...');
const grandBtn = page.getByRole('button', { name: 'Grand', exact: true });
await grandBtn.click();
await page.waitForTimeout(500);

// 3. Ouvrir le panneau d'inspection en cliquant sur la loupe de la première carte
console.log('Ouverture du panneau Détails de la carte...');
const firstCard = page.locator('[data-test="look-card"]').first();
await firstCard.hover();
await page.waitForTimeout(300);

const inspectBtn = firstCard.getByRole('button', { name: '🔍' });
await inspectBtn.click();
await page.waitForTimeout(800);

// Vérifier que le panneau latéral est visible
const sidePanel = page.getByText('Détails de la carte');
if (await sidePanel.count() === 0) {
  console.error('Panneau latéral "Détails de la carte" non trouvé !');
  process.exit(1);
}
console.log('OK - Panneau "Détails de la carte" ouvert.');

// 4. Vérification du non-chevauchement des cartes
console.log('Vérification du positionnement de chaque carte...');
const cardLocators = page.locator('[data-test="look-card"]');
const count = await cardLocators.count();
console.log(`Nombre de cartes : ${count}`);

const boxes = [];
for (let i = 0; i < Math.min(count, 20); i++) {
  const box = await cardLocators.nth(i).boundingBox();
  if (box) {
    boxes.push({ index: i, ...box });
  }
}

let overlapFound = false;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i];
    const b = boxes[j];
    
    // Check rectangle overlap: horizontal overlap and vertical overlap
    const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    
    // Tolérer 1px d'arrondi de sous-pixel CSS
    if (xOverlap > 1 && yOverlap > 1) {
      console.error(`CHEVACUHEMENT DÉTECTÉ entre carte ${a.index} et carte ${b.index} !`);
      console.error(`Carte ${a.index}: [x:${a.x.toFixed(1)}, y:${a.y.toFixed(1)}, w:${a.width.toFixed(1)}, h:${a.height.toFixed(1)}]`);
      console.error(`Carte ${b.index}: [x:${b.x.toFixed(1)}, y:${b.y.toFixed(1)}, w:${b.width.toFixed(1)}, h:${b.height.toFixed(1)}]`);
      console.error(`Intersection: ${xOverlap.toFixed(1)}px x ${yOverlap.toFixed(1)}px`);
      overlapFound = true;
    }
  }
}

// Prendre une capture d'écran
await page.screenshot({ path: 'scripts/look-modal-grand-details.png' });
console.log('Capture enregistrée : scripts/look-modal-grand-details.png');

if (overlapFound) {
  console.error('❌ ÉCHEC : Des cartes se chevauchent !');
  process.exit(1);
} else {
  console.log('✅ SUCCÈS : Aucune carte ne se chevauche dans la grille !');
}

await browser.close();


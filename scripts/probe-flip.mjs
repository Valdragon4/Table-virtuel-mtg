/**
 * Sonde ciblée : engagement, dégagement et retournements.
 *
 * Elle n'affirme rien, elle constate. Chaque geste est exercé dans un vrai
 * navigateur et l'on relit l'état du store et l'image réellement affichée.
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '4 Fable of the Mirror-Breaker',
  '4 Sol Ring',
  '10 Plains',
  '10 Swamp',
].join('\n');

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

const show = (label, value) => console.log(`${label.padEnd(52)} ${JSON.stringify(value)}`);

const cardState = (id) =>
  page.evaluate((cid) => {
    const c = window.__mtg.getState().cards.get(cid);
    const el = document.querySelector(`[data-card="${cid}"]`);
    const img = el?.querySelector('img');
    return c
      ? {
          tapped: c.tapped,
          flipped: c.flipped ?? null,
          faceDown: c.faceDown,
          rotation: c.rotation,
          transform: el ? getComputedStyle(el).transform.slice(0, 40) : null,
          src: img?.getAttribute('src')?.replace('https://cards.scryfall.io/', '') ?? null,
          backImg: el && !img ? 'dos' : null,
        }
      : null;
  }, id);

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /obtenir le lien/i }).click();
  await page.waitForURL(/\/rooms\//);
  await page.getByPlaceholder('Invité').fill('Alice');
  await page.locator('textarea').first().fill(DECK);
  await page.getByRole('button', { name: "S'asseoir à la table" }).click();
  await page.getByText('Journal').waitFor({ timeout: 20000 });
  await page.waitForFunction(
    () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') ?? 0) > 0,
    null,
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
  await page.waitForFunction(
    () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|HAND') ?? 0) >= 7,
    null,
    { timeout: 15000 },
  );

  // On cherche la carte recto-verso et on la met en jeu.
  const dfc = await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      // Relire le store à chaque tour : la Map est remplacée à chaque event,
      // celle capturée au départ resterait éternellement la main initiale.
      const s = window.__mtg.getState();
      const hand = [...s.cards.values()].filter((c) => c.zone.kind === 'HAND' && c.faceDown === false);
      for (const card of hand) {
        const res = await fetch('/api/cards/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: [card.scryfallId] }),
        });
        const body = await res.json();
        const meta = body.cards?.[0];
        if (meta && /Fable of the Mirror-Breaker/i.test(meta.name)) {
          return { id: card.id, name: meta.name, layout: meta.layout };
        }
      }
      window.__mtg.getState().send({ type: 'DRAW', count: 1 });
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  });
  show('carte recto-verso trouvée en main', dfc);

  if (dfc) {
    await page.evaluate((id) => {
      const s = window.__mtg.getState();
      s.send({ type: 'MOVE_CARD', cardId: id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 120, y: 120 });
    }, dfc.id);
    await page.waitForFunction(
      (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD',
      dfc.id,
      { timeout: 8000 },
    );
  }

  const target = dfc?.id ?? (await page.evaluate(() => {
    const s = window.__mtg.getState();
    const card = [...s.cards.values()].find((c) => c.zone.kind === 'HAND');
    s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 120, y: 120 });
    return card.id;
  }));
  await page.waitForTimeout(900);

  const sprite = page.locator(`[data-card="${target}"]`);
  show('état initial', await cardState(target));

  // --- 1. Double-clic.
  await sprite.dblclick();
  await page.waitForTimeout(800);
  show('après double-clic', await cardState(target));
  await sprite.dblclick();
  await page.waitForTimeout(800);
  show('après second double-clic', await cardState(target));

  // --- 2. Touche T au survol.
  const box = await sprite.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
  show('survolé ?', await page.evaluate(() => window.__mtg.getState().hoveredCardId));
  await page.keyboard.press('t');
  await page.waitForTimeout(800);
  show('après T (engager)', await cardState(target));
  await page.keyboard.press('t');
  await page.waitForTimeout(800);
  show('après T (dégager)', await cardState(target));

  // --- 3. Menu contextuel.
  await sprite.click({ button: 'right' });
  await page.waitForTimeout(300);
  const menuEntries = await page.locator('div.fixed.z-50.w-60 button').allTextContents();
  show('entrées du menu', menuEntries.slice(0, 14));
  const tapEntry = page.locator('div.fixed.z-50.w-60 button').filter({ hasText: /^(Engager|Dégager)/ });
  await tapEntry.first().click();
  await page.waitForTimeout(800);
  show('après menu Engager/Dégager', await cardState(target));

  // --- 4. Sélection multiple.
  const second = await page.evaluate(() => {
    const s = window.__mtg.getState();
    const card = [...s.cards.values()].find((c) => c.zone.kind === 'HAND');
    s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 340, y: 120 });
    return card.id;
  });
  await page.waitForTimeout(900);
  await page.evaluate(([a, b]) => window.__mtg.getState().setSelection(new Set([a, b])), [target, second]);
  await page.mouse.move(6, 520);
  await page.waitForTimeout(200);
  await page.keyboard.press('t');
  await page.waitForTimeout(900);
  show('après T sur une sélection de 2 (carte A)', await cardState(target));
  show('après T sur une sélection de 2 (carte B)', await cardState(second));
  await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));

  // --- 5. FLIP_FACE sur la recto-verso.
  await page.evaluate((id) => window.__mtg.getState().send({ type: 'FLIP_FACE', cardId: id }), target);
  await page.waitForTimeout(900);
  show('après FLIP_FACE', await cardState(target));
  await page.evaluate((id) => window.__mtg.getState().send({ type: 'FLIP_FACE', cardId: id }), target);
  await page.waitForTimeout(900);
  show('après second FLIP_FACE', await cardState(target));

  // --- 6. Face cachée.
  await page.evaluate((id) => window.__mtg.getState().send({ type: 'TURN_FACE_DOWN', cardId: id }), target);
  await page.waitForTimeout(900);
  show('après TURN_FACE_DOWN', await cardState(target));
  await page.evaluate((id) => window.__mtg.getState().send({ type: 'TURN_FACE_UP', cardId: id }), target);
  await page.waitForTimeout(900);
  show('après TURN_FACE_UP', await cardState(target));

  console.log('\njournal :');
  console.log(
    (await page.evaluate(() => window.__mtg.getState().log.slice(-12).map((l) => l.text))).join('\n'),
  );
  console.log('rejets :', await page.evaluate(() => window.__mtg.getState().lastReject));
} catch (error) {
  console.log('ERREUR', String(error).slice(0, 400));
} finally {
  await browser.close();
}

/**
 * Sonde : glissement d'un marqueur créé par le menu contextuel de la table.
 *
 * Deux sièges obligatoires : à un seul siège la réattribution des cases est
 * l'identité, et le repère partagé se confond avec le repère affiché — la sonde
 * n'exercerait alors rien du tout.
 *
 *   node probe-marqueur.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const NL = String.fromCharCode(10);
const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '// Deck', '4 Sol Ring', '20 Plains'].join(NL);

let failures = 0;
const check = (ok, text) => {
  console.log((ok ? 'OK    - ' : 'ÉCHEC - ') + text);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true });

async function seat(context, name, url) {
  const page = await context.newPage();
  await page.goto(url ?? BASE + '/');
  if (!url) {
    await page.getByRole('button', { name: /obtenir le lien/i }).click();
    await page.waitForURL(/\/rooms\//);
  }
  await page.getByPlaceholder('Invité').fill(name);
  await page.locator('textarea').first().fill(DECK);
  await page.getByRole('button', { name: /S'asseoir/ }).click();
  // Le deck se charge de façon asynchrone : on attend l'event, pas un délai.
  await page.waitForFunction(
    () => {
      const s = window.__mtg?.getState();
      return Boolean(s?.mySeat) && (s.zoneCounts.get(s.mySeat + '|LIBRARY') ?? 0) > 0;
    },
    null,
    { timeout: 40000 },
  );
  return page;
}

const alice = await seat(await browser.newContext({ viewport: { width: 1600, height: 1000 } }), 'Alice');
const room = alice.url();
/**
 * Le second siège porte un nom à espaces, de la longueur maximale autorisée
 * (32 caractères) : c'est le cas limite de la pastille du curseur.
 */
const LONG_NAME = 'Marie Jeanne Dupont de la Roches'; // 32 caractères, cinq espaces
const bob = await seat(await browser.newContext({ viewport: { width: 1600, height: 1000 } }), LONG_NAME, room);
await alice.getByRole('button', { name: 'Lancer la partie' }).click();
await alice.waitForTimeout(2500);

const seats = await alice.evaluate(() => window.__mtg.getState().seats.length);
const mine = await alice.evaluate(() => window.__mtg.getState().mySeat);
check(seats >= 2, `deux sièges à la table (${seats}), le mien est ${mine}`);

/**
 * La pastille du curseur d'autrui tient-elle sur une seule ligne ?
 *
 * On la mesure chez Alice pendant que l'autre siège promène sa souris : une
 * seule ligne se reconnaît à une hauteur de boîte qui reste celle d'une ligne
 * de texte, contre-échelle du zoom comprise. Deux échelles de caméra, parce
 * que la pastille est rendue **dans le plan** : le zoom change sa taille de
 * police et donc l'endroit où un retour à la ligne se produirait.
 */
async function pastilleDuCurseur(where) {
  await bob.mouse.move(where.x, where.y);
  await bob.mouse.move(where.x + 3, where.y + 3);
  const badge = alice.locator('[data-test="cursor"] span').first();
  await badge.waitFor({ timeout: 8000 });
  return alice.evaluate(() => {
    const node = document.querySelector('[data-test="cursor"] span');
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    /*
     * Un élément en flux rend **une boîte de ligne par ligne occupée** : leur
     * nombre est la mesure exacte du retour à la ligne, là où comparer des
     * hauteurs obligerait à deviner un interligne. On vérifie au passage que
     * l'instrument sait voir une pastille cassée : on la force à revenir à la
     * ligne, on compte, puis on rend les styles d'origine.
     */
    const lines = node.getClientRects().length;
    const savedWrap = node.style.whiteSpace;
    const savedWidth = node.style.width;
    node.style.whiteSpace = 'normal';
    node.style.width = '40px';
    const cassee = node.getClientRects().length;
    node.style.whiteSpace = savedWrap;
    node.style.width = savedWidth;
    return {
      lines,
      cassee,
      height: rect.height,
      width: rect.width,
      fontSize: Number.parseFloat(style.fontSize),
      text: node.textContent,
      wrap: style.whiteSpace,
    };
  });
}

/** Table rase entre deux mesures. */
async function clearLabels() {
  await alice.evaluate(() => {
    const s = window.__mtg.getState();
    for (const l of s.labels) s.send({ type: 'REMOVE_LABEL', labelId: l.id });
  });
  await alice.waitForFunction(() => window.__mtg.getState().labels.length === 0, null, { timeout: 8000 });
}

/** Un point du fond de table, loin des panneaux flottants et du rail de main. */
async function surfacePoint() {
  for (const p of [{ x: 760, y: 470 }, { x: 900, y: 430 }, { x: 640, y: 520 }]) {
    const ok = await alice.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el?.closest('.table-surface')) && !el?.closest('[data-card-id], [data-label]');
      },
      [p.x, p.y],
    );
    if (ok) return p;
  }
  throw new Error('aucun point de fond utilisable');
}

/** Pose un marqueur (ou une étiquette) par le menu contextuel de la table. */
async function poserParLeMenu({ counter, text, value }) {
  const point = await surfacePoint();
  await alice.mouse.click(point.x, point.y, { button: 'right' });
  await alice.locator('[data-test="table-menu"]').waitFor({ timeout: 5000 });
  await alice
    .locator('[data-test="table-menu"] button')
    .filter({ hasText: counter ? 'Poser un marqueur' : 'Poser une étiquette' })
    .first()
    .click();
  await alice.locator('[data-test="table-menu-input"]').fill(text);
  if (counter) await alice.locator('[data-test="table-menu-value"]').fill(value ?? '');
  await alice.locator('[data-test="table-menu-input"]').press('Enter');
  await alice.waitForFunction(() => window.__mtg.getState().labels.length === 1, null, { timeout: 8000 });
  const id = await alice.evaluate(() => window.__mtg.getState().labels[0].id);
  return { id, point };
}

const boxOf = async (id) => {
  const b = await alice.locator(`[data-label="${id}"]`).boundingBox();
  if (!b) throw new Error('étiquette sans boîte');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/**
 * Glisse le marqueur de `dx`/`dy` à l'écran, **lentement**, et mesure aussi la
 * position à mi-geste : c'est là que se voyait la démultiplication, un écho du
 * serveur arrivant en cours de geste venant s'ajouter au décalage local.
 */
async function glisser(id, dx, dy) {
  const from = await boxOf(id);
  await alice.mouse.move(from.x, from.y);
  await alice.mouse.down();
  await alice.mouse.move(from.x + dx / 4, from.y + dy / 4);
  // Assez long pour que le `MOVE_LABEL` parte, aille au serveur et revienne.
  await alice.waitForTimeout(600);
  const mid = await boxOf(id);
  await alice.mouse.move(from.x + dx / 2, from.y + dy / 2);
  await alice.waitForTimeout(600);
  const half = await boxOf(id);
  await alice.mouse.move(from.x + dx, from.y + dy);
  await alice.waitForTimeout(400);
  await alice.mouse.up();
  await alice.waitForTimeout(700);
  const after = await boxOf(id);
  return {
    mid: { dx: mid.x - from.x, dy: mid.y - from.y },
    half: { dx: half.x - from.x, dy: half.y - from.y },
    after: { dx: after.x - from.x, dy: after.y - from.y },
  };
}

const near = (got, want, tol = 3) => Math.abs(got - want) <= tol;

// ---------------------------------------------------------------- marqueur
await clearLabels();
{
  const { id, point } = await poserParLeMenu({ counter: true, text: 'orages', value: '3' });
  const born = await boxOf(id);
  check(
    Math.hypot(born.x - point.x, born.y - point.y) < 90,
    `marqueur né à ${Math.round(born.x)},${Math.round(born.y)} pour un clic à ${point.x},${point.y}` +
      ` (écart ${Math.round(Math.hypot(born.x - point.x, born.y - point.y))} px)`,
  );

  // Trois gestes de suite, en aller-retour pour rester dans le cadre visible.
  let i = 0;
  for (const [dx, dy] of [[200, 120], [-200, -120], [200, 120]]) {
    i += 1;
    const r = await glisser(id, dx, dy);
    console.log(
      `      glissement ${i} (${dx},${dy}) : quart ${Math.round(r.mid.dx)},${Math.round(r.mid.dy)}` +
        ` (attendu ${dx / 4},${dy / 4}) · moitié ${Math.round(r.half.dx)},${Math.round(r.half.dy)}` +
        ` (attendu ${dx / 2},${dy / 2}) · arrivée ${Math.round(r.after.dx)},${Math.round(r.after.dy)}` +
        ` (attendu ${dx},${dy})`,
    );
    check(
      near(r.mid.dx, dx / 4, 6) && near(r.mid.dy, dy / 4, 6),
      `glissement ${i} : au quart du geste, le marqueur est sous la souris`,
    );
    check(
      near(r.half.dx, dx / 2, 6) && near(r.half.dy, dy / 2, 6),
      `glissement ${i} : à la moitié du geste, le marqueur est sous la souris`,
    );
    check(near(r.after.dx, dx, 4) && near(r.after.dy, dy, 4), `glissement ${i} : arrivée exacte`);
  }
  const net = await boxOf(id);
  console.log(
    `      trois gestes enchaînés, arrivée ${Math.round(net.x)},${Math.round(net.y)} :` +
      ' aucun report d’erreur d’un geste sur le suivant',
  );

  // ------------------------------------------------------- Échap ferme le menu
  await alice.locator(`[data-label="${id}"]`).click({ button: 'right' });
  await alice.locator('[data-test="label-menu"]').waitFor({ timeout: 5000 });
  await alice.keyboard.press('Escape');
  await alice.waitForTimeout(400);
  check(
    (await alice.locator('[data-test="label-menu"]').count()) === 0,
    'Échap ferme le menu de l’étiquette',
  );

  // ------------------------------------------------- la modale « Modifier… »
  await alice.locator(`[data-label="${id}"]`).click({ button: 'right' });
  await alice.locator('[data-test="label-menu"]').waitFor({ timeout: 5000 });
  const entries = await alice.locator('[data-test="label-menu"] button').allTextContents();
  check(entries.some((e) => e.startsWith('Modifier')), `menu : ${entries.join(' | ')}`);
  await alice.locator('[data-test="label-menu"] button').filter({ hasText: 'Modifier' }).first().click();
  await alice.locator('[data-test="dialog"]').waitFor({ timeout: 5000 });
  await alice.locator('[data-test="dialog-field-text"]').fill('tempête');
  await alice.locator('[data-test="dialog-option"][data-value="pair"]').click();
  // Le changement de forme réécrit la valeur : « 3 » doit devenir « 3/3 ».
  const derived = await alice.locator('[data-test="dialog-field-value"]').inputValue();
  check(derived === '3/3', `la forme « paire » dérive la valeur : « ${derived} »`);
  await alice.locator('[data-test="dialog-field-value"]').fill('2/3');
  await alice.locator('[data-test="dialog-color"][data-value="#38bdf8"]').click();
  await alice.locator('[data-test="dialog-submit"]').click();
  await alice.waitForFunction(
    (lid) => {
      const l = window.__mtg.getState().labels.find((x) => x.id === lid);
      return l && l.text === 'tempête' && l.value === '2/3' && l.color === '#38bdf8';
    },
    id,
    { timeout: 8000 },
  );
  check(true, 'la modale change texte, couleur et forme de la valeur en un geste');

  // La forme « aucune » retire la valeur.
  await alice.locator(`[data-label="${id}"]`).click({ button: 'right' });
  await alice.locator('[data-test="label-menu"] button').filter({ hasText: 'Modifier' }).first().click();
  await alice.locator('[data-test="dialog"]').waitFor({ timeout: 5000 });
  await alice.locator('[data-test="dialog-option"][data-value="none"]').click();
  check(
    (await alice.locator('[data-test="dialog-field-value"]').count()) === 0,
    'la forme « aucune » efface le champ de valeur',
  );
  await alice.locator('[data-test="dialog-submit"]').click();
  await alice.waitForFunction(
    (lid) => window.__mtg.getState().labels.find((x) => x.id === lid)?.value === undefined,
    id,
    { timeout: 8000 },
  );
  check(true, 'la forme « aucune » retire la valeur');
}

// --------------------------------------------- étiquette simple (sans valeur)
await clearLabels();
{
  const { id } = await poserParLeMenu({ counter: false, text: 'repère' });
  const r = await glisser(id, 180, -90);
  console.log(
    `      étiquette : quart ${Math.round(r.mid.dx)},${Math.round(r.mid.dy)} (attendu 45,-22)` +
      ` · arrivée ${Math.round(r.after.dx)},${Math.round(r.after.dy)} (attendu 180,-90)`,
  );
  check(near(r.mid.dx, 45, 6) && near(r.mid.dy, -22, 6), 'étiquette : sous la souris en cours de geste');
  check(near(r.after.dx, 180, 4) && near(r.after.dy, -90, 4), 'étiquette : arrivée exacte');
}

// ------------------------------------------------- marqueur accroché à une carte
await clearLabels();
{
  const target = await alice.evaluate(() => {
    const s = window.__mtg.getState();
    const c = [...s.cards.values()].find((x) => x.zone.kind === 'HAND');
    s.send({ type: 'MOVE_CARD', cardId: c.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 160, y: 120 });
    return c.id;
  });
  await alice.waitForTimeout(1200);
  const { id } = await poserParLeMenu({ counter: true, text: 'vol', value: '' });
  await alice.locator(`[data-label="${id}"]`).click({ button: 'right' });
  await alice.locator('[data-test="label-menu"] button').filter({ hasText: 'Accrocher' }).first().click();
  await alice.locator(`[data-card="${target}"]`).click();
  await alice.waitForFunction(
    (lid) => Boolean(window.__mtg.getState().labels.find((x) => x.id === lid)?.attachedTo),
    id,
    { timeout: 8000 },
  );
  const r = await glisser(id, 140, 70);
  console.log(
    `      accroché : quart ${Math.round(r.mid.dx)},${Math.round(r.mid.dy)} (attendu 35,17)` +
      ` · arrivée ${Math.round(r.after.dx)},${Math.round(r.after.dy)} (attendu 140,70)`,
  );
  check(near(r.mid.dx, 35, 6) && near(r.mid.dy, 17, 6), 'accroché : sous la souris en cours de geste');
  check(near(r.after.dx, 140, 4) && near(r.after.dy, 70, 4), 'accroché : arrivée exacte');
}

// ------------------------------------- nom à espaces sur la pastille du curseur
{
  for (const [tour, molette] of [['échelle de départ', 0], ['après zoom', -5], ['après dézoom', 9]]) {
    if (molette !== 0) {
      await alice.mouse.move(800, 500);
      for (let n = 0; n < Math.abs(molette); n++) await alice.mouse.wheel(0, molette < 0 ? -120 : 120);
      await alice.waitForTimeout(250);
    }
    const chip = await pastilleDuCurseur({ x: 800 + (molette % 7) * 10, y: 500 });
    console.log(
      `      ${tour} : « ${chip.text} » — ${Math.round(chip.width)}×${Math.round(chip.height)} px à` +
        ` l’écran, police ${chip.fontSize.toFixed(1)} px, white-space « ${chip.wrap} »,` +
        ` ${chip.lines} ligne(s) — ${chip.cassee} une fois forcée à revenir à la ligne`,
    );
    check(chip.text === LONG_NAME, `${tour} : la pastille porte le nom entier`);
    check(chip.cassee > 1, `${tour} : la mesure sait voir une pastille cassée (témoin)`);
    check(chip.lines === 1, `${tour} : la pastille du curseur tient sur une seule ligne`);
  }
}

await bob.close();
await browser.close();
console.log(failures === 0 ? 'TOUT PASSE' : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

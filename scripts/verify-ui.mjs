/**
 * Vérification d'interface, sur notre propre pile.
 *
 * Crée une table, s'assoit avec une liste collée, lance la partie, puis exerce
 * réellement chaque glisser-déposer et chaque menu contextuel. Rien n'est
 * simulé côté état : on lit ce que le serveur a renvoyé, via le store exposé.
 *
 *   node verify-ui.mjs [dossier-de-captures] [url-de-base]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? '.';
const BASE = process.argv[3] ?? process.env.MTG_BASE_URL ?? 'http://localhost:3000';

const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '4 Fable of the Mirror-Breaker',
  '4 Sol Ring',
  '4 Arcane Signet',
  '10 Plains',
  '10 Swamp',
].join('\n');

let failures = 0;

/**
 * Les menus contextuels, et rien d'autre.
 *
 * Chacun peint un voile plein écran (`fixed inset-0 z-40`) qui avale tous les
 * clics de la table : un menu laissé ouvert par une étape faisait tomber les
 * dix suivantes sur des délais de trente secondes, toutes parfaitement saines.
 * C'est ce qui rendait la recette non déterministe — trois exécutions du même
 * code ont donné 7, 8 puis 9 échecs selon l'ordre des dominos.
 *
 * On refuse donc à chaque étape de rendre la main avec un menu ouvert. Un
 * échec qui nomme le coupable vaut dix échecs qui désignent des innocents.
 */
const MENUS =
  '[data-test="zone-menu"], [data-test="card-menu"], [data-test="table-menu"], [data-test="label-menu"]';

/** Ferme un menu contextuel et **assure** qu'il a bien disparu. */
const fermerMenu = async (cible = page) => {
  await cible.keyboard.press('Escape');
  await cible.locator(MENUS).first().waitFor({ state: 'detached', timeout: 4000 });
};

/**
 * Une étape.
 *
 * `menuOuvert` est la seule dérogation au garde-fou : quelques étapes se
 * passent délibérément un menu ouvert de l'une à l'autre (ouvrir le menu d'un
 * permanent, puis y cliquer « Ajouter un marqueur »). Elle est explicite,
 * précisément pour qu'un menu oublié ne puisse jamais se faire passer pour un
 * relais voulu.
 */
const step = async (label, fn, { menuOuvert = false } = {}) => {
  try {
    await fn();
    const restant = menuOuvert ? 0 : await page.locator(MENUS).count().catch(() => 0);
    if (restant > 0) {
      const qui = await page
        .evaluate(
          (sel) =>
            [...document.querySelectorAll(sel)]
              .map((el) => el.getAttribute('data-test'))
              .join(', '),
          MENUS,
        )
        .catch(() => '?');
      throw new Error(
        `un menu est resté ouvert à la fin de l’étape (${qui}) : son voile plein écran ` +
          'aurait avalé les clics des étapes suivantes',
      );
    }
    console.log('OK    -', label);
  } catch (error) {
    failures += 1;
    console.log('ÉCHEC -', label, '::', String(error).split('\n')[0].slice(0, 200));
    /*
     * Une étape qui échoue laisse souvent une modale ou un voile de menu
     * ouvert, et tout ce qui suit échoue alors pour cette seule raison : une
     * assertion périmée faisait tomber vingt étapes saines, et le rapport
     * devenait illisible. On rend donc la main à la table avant de continuer.
     */
    try {
      // Une capture au moment exact de l'échec : sans elle, on en est réduit à
      // deviner ce que l'écran montrait, et l'on corrige alors le produit pour
      // un défaut qui n'était que dans la recette.
      await page.screenshot({
        path: `${OUT}/echec-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`,
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.mouse.up().catch(() => undefined);
      /*
       * Et l'on relâche la carte survolée.
       *
       * Une étape qui tombe le curseur posé sur une carte d'un panneau laisse
       * `hoveredCardId` accroché à un nœud que la reprise ci-dessus vient de
       * détruire : aucun `pointerleave` n'est alors émis, et l'étape suivante
       * meurt dans `unhover()` sur un délai de quatre secondes. On lisait donc
       * deux échecs là où il n'y en avait qu'un, le second désignant un code
       * parfaitement sain. Le rapport doit nommer l'étape qui casse, pas sa
       * voisine.
       */
      await page
        .evaluate(() => window.__mtg?.getState().setHovered(null))
        .catch(() => undefined);
    } catch {
      /* la page n'est plus là : le rapport final le dira. */
    }
  }
};

/** Plafond de la table, aligné sur `LIMITS.maxSeats` côté serveur. */
const MAX_SEATS = 4;

/** Encombrement des bandeaux fixes, pour viser un point réellement cliquable. */
const TOP_BAR = 60;
const HAND_RAIL = 250;
const VIEWPORT = { width: 1600, height: 1000 };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
/**
 * Compteur d'intents réellement émis sur le socket.
 *
 * Il sert à mesurer un débit, pas à inspecter un contenu : certaines demandes
 * (le déplacement d'une étiquette) sont des gestes continus, et la seule
 * manière honnête de vérifier qu'ils n'inondent pas le serveur est de compter
 * les frames qui partent vraiment.
 */
await context.addInitScript(() => {
  window.__sentIntents = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === 'string' && data.includes('"intent"')) window.__sentIntents.push(data);
    } catch {
      /* un socket qui n'est pas le nôtre : on ne compte rien. */
    }
    return send.apply(this, arguments);
  };
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('requestfailed', (r) => errors.push(`requête échouée : ${r.url().slice(0, 120)}`));
page.on('response', (r) => {
  if (r.status() >= 400 && r.status() !== 401) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // Les 401 de /api/me et /api/decks sont attendus : on joue en invité.
  if (text.includes('401')) return;
  errors.push('console: ' + text.slice(0, 200));
});

await context.addInitScript(() => {
  // Raccourci de recette : vider le bandeau de refus entre deux mesures.
  window.useGameDismiss = () => window.__mtg?.getState().dismissReject();
});

/** État du jeu tel que le client l'a reçu. Aucune écriture, uniquement lecture. */
const state = () =>
  page.evaluate(() => {
    const s = window.__mtg.getState();
    const zones = {};
    for (const card of s.cards.values()) zones[card.zone.kind] = (zones[card.zone.kind] ?? 0) + 1;
    return {
      seq: s.seq,
      seat: s.mySeat,
      zones,
      counts: Object.fromEntries(s.zoneCounts),
      selection: [...s.selection].length,
      log: s.log.map((l) => l.text),
    };
  });

/** Centre d'un élément, en coordonnées écran. */
async function centerOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('élément sans boîte englobante');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Glisse une carte d'un point vers un autre, en vrais events de pointeur. */
async function dragTo(fromLocator, toLocator, offset = { x: 0, y: 0 }) {
  const from = await centerOf(fromLocator);
  const center = await centerOf(toLocator);
  const to = { x: center.x + offset.x, y: center.y + offset.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Plusieurs pas : le seuil de 4 px du store doit être franchi, et la couche
  // de glissement doit avoir le temps de se monter.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** Attend qu'une zone atteigne un effectif donné, d'après les events reçus. */
async function waitZone(kind, count, timeout = 8000) {
  await page.waitForFunction(
    ([k, n]) => {
      const s = window.__mtg.getState();
      let seen = 0;
      for (const card of s.cards.values()) if (card.zone.kind === k) seen += 1;
      return seen === n;
    },
    [kind, count],
    { timeout },
  );
}

/**
 * Trace un lasso (Maj + glisser) autour des éléments donnés. Le tracé est un
 * vrai contour, pas un rectangle : c'est ce que fait la main d'un joueur.
 */
async function lassoAround(locators, { alt = false } = {}) {
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.boundingBox();
    if (box) boxes.push(box);
  }
  if (boxes.length === 0) throw new Error('rien à entourer');
  const pad = 26;
  const left = Math.min(...boxes.map((b) => b.x)) - pad;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const top = Math.min(...boxes.map((b) => b.y)) - pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;

  const loop = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];

  // Le tracé doit **commencer** sur la table : un appui sur un panneau flottant
  // ne déclencherait aucun geste. On fait donc démarrer la boucle par un coin
  // qui touche vraiment la surface.
  const onSurface = async (p) =>
    page.evaluate(
      ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.table-surface')),
      [p.x, p.y],
    );
  let start = 0;
  while (start < loop.length && !(await onSurface(loop[start]))) start += 1;
  if (start === loop.length) throw new Error('aucun coin du lasso ne tombe sur la table');
  const corners = [...loop.slice(start), ...loop.slice(0, start), loop[start]];

  await page.keyboard.down('Shift');
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(corners[0].x, corners[0].y);
  await page.mouse.down();
  for (let c = 1; c < corners.length; c++) {
    const from = corners[c - 1];
    const to = corners[c];
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
    }
  }
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
}

/**
 * Première carte de la main, effectivement saisissable.
 *
 * Le rail défile : sa première carte peut être hors de la partie visible du
 * rail, et un appui à ses coordonnées tombe alors sur le rail lui-même. On
 * ramène donc le défilement au début avant de la rendre.
 */
async function firstHandCard() {
  await page.evaluate(() => {
    const rail = document.querySelector('[data-test="hand-rail"]');
    if (rail) rail.scrollLeft = 0;
  });
  await page.waitForTimeout(120);
  return page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
}

/** Un point du champ de bataille local où il n'y a aucune carte. */
async function emptySpot() {
  const zone = await (await seatZone('BATTLEFIELD')).boundingBox();
  // Un balayage large plutôt que quelques points choisis : au fil de la recette
  // le champ se remplit et la caméra se déplace, et une grille de vingt points
  // finissait par ne plus tomber que sur des cartes.
  for (const fy of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.4, 0.3, 0.2, 0.12]) {
    for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92, 0.28, 0.72, 0.44]) {
      // Après un déplacement de caméra, le champ déborde de l'écran : un point
      // hors de la fenêtre ne renvoie aucun élément, et la recherche échouait
      // alors qu'il restait du vide bien visible.
      const x = Math.min(Math.max(zone.x + zone.width * fx, 4), VIEWPORT.width - 4);
      const y = Math.min(Math.max(zone.y + zone.height * fy, TOP_BAR + 4), VIEWPORT.height - HAND_RAIL);
      // Le point doit tomber sur le fond du champ de bataille lui-même : ni
      // carte, ni pile, ni contrôle — sinon le geste de table ne démarre pas.
      const free = await page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          if (!el) return false;
          if (el.closest('[data-card-id], [data-card], button, a, input, select, textarea')) return false;
          return el.closest('[data-zone$="|BATTLEFIELD"]') !== null;
        },
        [x, y],
      );
      if (free) return { x, y };
    }
  }
  // Un message qui dit ce qu'on a trouvé à la place : sans cela, on ne sait pas
  // si le champ est plein, hors écran, ou couvert par un voile resté ouvert.
  const sample = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : 'rien';
    },
    [zone.x + zone.width * 0.5, zone.y + zone.height * 0.5],
  );
  throw new Error(
    `aucun point vide sur le champ de bataille (cadre ${Math.round(zone.x)},${Math.round(zone.y)} ` +
      `${Math.round(zone.width)}×${Math.round(zone.height)} — au centre : ${sample})`,
  );
}

/** Matrice de transformation courante du plan de table (la « caméra »). */
const planeTransform = () =>
  page.evaluate(() => {
    const plane = document.querySelector('.table-surface').firstElementChild;
    const m = new DOMMatrix(getComputedStyle(plane).transform);
    return { a: m.a, e: m.e, f: m.f };
  });

/** Un permanent de notre propre champ de bataille. */
const myPermanent = () =>
  page.locator('[data-zone$="|BATTLEFIELD"][data-mine="1"] [data-card-id] img[src*="scryfall"]').last();

const seatZone = async (kind) => {
  const seat = await page.evaluate(() => window.__mtg.getState().mySeat);
  return page.locator(`[data-zone="${seat}|${kind}"]`).first();
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  await step('créer une table', async () => {
    // Le libellé du bouton d'accueil a déjà changé une fois (« Créer et
    // obtenir le lien » → « Créer la table et obtenir le lien ») et la recette
    // entière tombait sur cette seule chaîne. On vise donc la partie stable.
    await page.getByRole('button', { name: /obtenir le lien/i }).click();
    await page.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 15000 });
  });
  console.log('      table:', page.url());

  await step('le salon propose de se connecter sans perdre la saisie', async () => {
    await page.getByPlaceholder('Invité').fill('Alice');
    await page.locator('textarea').first().fill(DECK);
    const login = page.getByRole('link', { name: 'Se connecter' });
    await login.waitFor({ timeout: 8000 });
    const href = await login.getAttribute('href');
    if (!href?.includes('next=')) throw new Error(`lien sans retour : ${href}`);
    await login.click();
    await page.waitForURL(/\/login\?next=/, { timeout: 8000 });
    await page.goBack();
    await page.waitForURL(/\/rooms\//, { timeout: 8000 });
    const restored = await page.locator('textarea').first().inputValue();
    if (!restored.includes('Sol Ring')) throw new Error('liste collée perdue au retour');
    if ((await page.getByPlaceholder('Invité').inputValue()) !== 'Alice') {
      throw new Error('nom perdu au retour');
    }
  });

  await step('s’asseoir avec une liste collée', async () => {
    await page.getByRole('button', { name: "S'asseoir à la table" }).click();
    await page.getByText('Journal').waitFor({ timeout: 20000 });
    // Le chargement du deck est asynchrone : on attend l'event, pas un délai.
    await page.waitForFunction(
      () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') ?? 0) > 0,
      null,
      { timeout: 30000 },
    );
  });

  await step('lancer la partie', async () => {
    await page.getByRole('button', { name: 'Lancer la partie' }).click();
    await page.waitForFunction(() => window.__mtg?.getState().room?.status === 'PLAYING', null, {
      timeout: 15000,
    });
    await page.waitForFunction(
      () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|HAND') ?? 0) >= 7,
      null,
      { timeout: 15000 },
    );
  });
  console.log('      après démarrage:', JSON.stringify((await state()).counts));
  await page.screenshot({ path: `${OUT}/ui-01-table.png` });

  await step('la zone de commandement est affichée, avec son commandant', async () => {
    const pile = await seatZone('COMMAND');
    await pile.waitFor({ timeout: 8000 });
    if ((await pile.locator('img[src*="scryfall"]').count()) === 0) {
      throw new Error('aucun commandant visible dans la zone');
    }
    // La zone de commandement n'affiche plus un compte — on y voit déjà la carte —
    // mais la taxe de commandant, ce qu'on cherche du regard avant de relancer.
    const badge = (await pile.textContent())?.trim() ?? '';
    if (!/\+\d+/.test(badge)) throw new Error(`taxe de commandant absente du badge : ${badge}`);
  });

  await step('les panneaux flottants ne recouvrent aucune pile', async () => {
    for (const kind of ['LIBRARY', 'GRAVEYARD', 'EXILE', 'COMMAND']) {
      const pile = await seatZone(kind);
      const box = await pile.boundingBox();
      const covered = await page.evaluate(
        ([x, y, k]) => {
          const top = document.elementFromPoint(x, y);
          return top?.closest('[data-zone]')?.dataset.zone?.endsWith(k) !== true;
        },
        [box.x + box.width / 2, box.y + box.height / 2, kind],
      );
      if (covered) throw new Error(`la pile ${kind} est recouverte par un panneau`);
    }
  });

  // ---------------------------------------------------------------- glissements

  await step('glisser : main → champ de bataille', async () => {
    const card = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
    await dragTo(card, await seatZone('BATTLEFIELD'));
    await waitZone('BATTLEFIELD', 1);
  });

  await step('glisser : champ de bataille → cimetière', async () => {
    const card = page.locator('[data-card-id] img[src*="scryfall"]').first();
    await dragTo(card, await seatZone('GRAVEYARD'));
    await waitZone('GRAVEYARD', 1);
  });

  await step('glisser : cimetière → main', async () => {
    const before = (await state()).zones.HAND ?? 0;
    const pile = await seatZone('GRAVEYARD');
    await dragTo(pile.locator('img').first(), page.locator('[data-zone$="|HAND"]').first());
    await waitZone('HAND', before + 1);
  });

  await step('glisser : main → champ, puis champ → exil', async () => {
    await dragTo(
      page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first(),
      await seatZone('BATTLEFIELD'),
    );
    await waitZone('BATTLEFIELD', 1);
    await dragTo(page.locator('[data-card-id] img[src*="scryfall"]').first(), await seatZone('EXILE'));
    await waitZone('EXILE', 1);
  });

  await step('glisser : main → champ, puis champ → bibliothèque', async () => {
    const libBefore = await page.evaluate(
      () => window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY'),
    );
    await dragTo(
      page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first(),
      await seatZone('BATTLEFIELD'),
    );
    await waitZone('BATTLEFIELD', 1);
    await dragTo(page.locator('[data-card-id] img[src*="scryfall"]').first(), await seatZone('LIBRARY'));
    await page.waitForFunction(
      (n) => window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|LIBRARY') === n + 1,
      libBefore,
      { timeout: 8000 },
    );
  });

  await step('glisser : zone de commandement → champ de bataille', async () => {
    const pile = await seatZone('COMMAND');
    await dragTo(pile.locator('img').first(), await seatZone('BATTLEFIELD'));
    await waitZone('BATTLEFIELD', 1);
    const kind = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD')?.zone.kind,
    );
    if (kind !== 'BATTLEFIELD') throw new Error('le commandant n’est pas arrivé sur le champ');
  });

  await step('glisser : champ de bataille → zone de commandement', async () => {
    await dragTo(page.locator('[data-card-id] img[src*="scryfall"]').first(), await seatZone('COMMAND'));
    await waitZone('COMMAND', 1);
  });
  await page.screenshot({ path: `${OUT}/ui-02-apres-glissements.png` });

  // --------------------------------------------------------------- sélection

  await step('lasso (Maj + glisser) : sélectionne ce qu’il entoure', async () => {
    // Deux permanents posés à deux endroits distincts, puis un lasso qui en
    // fait le tour.
    for (const dx of [-120, 120]) {
      await dragTo(
        page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first(),
        await seatZone('BATTLEFIELD'),
        { x: dx, y: 0 },
      );
    }
    await waitZone('BATTLEFIELD', 2);
    await lassoAround(await page.locator('[data-card-id]').all());
    const selected = (await state()).selection;
    if (selected < 2) throw new Error(`lasso : ${selected} carte(s) sélectionnée(s)`);
    await page.screenshot({ path: `${OUT}/ui-17-lasso.png` });
  });

  await step('le clic droit glissé sur le fond déplace la caméra', async () => {
    const before = await planeTransform();
    // Un point du fond de la table : le vide d'un panneau de siège convient, il
    // n'y a là ni carte ni contrôle, et l'événement remonte bien à la surface.
    const zone = await (await seatZone('BATTLEFIELD')).boundingBox();
    const x = zone.x + zone.width * 0.5;
    const y = zone.y + zone.height * 0.85;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x - i * 15, y + i * 8);
      await page.waitForTimeout(20);
    }
    await page.mouse.up({ button: 'right' });
    // Un clic droit qui a déplacé la caméra n'ouvre pas de menu.
    await page.waitForTimeout(150);
    if (await page.getByText('Créer un jeton').isVisible().catch(() => false)) {
      throw new Error('le menu du fond s’est ouvert à la fin d’un déplacement de caméra');
    }
    await page.waitForTimeout(200);
    const after = await planeTransform();
    const moved = Math.hypot(after.e - before.e, after.f - before.f);
    if (moved < 40) throw new Error(`la caméra n'a bougé que de ${Math.round(moved)} px`);
    if (Math.abs(after.a - before.a) > 0.001) throw new Error('le zoom a changé pendant un pan');
  });

  await step('le bouton droit déplace la table sans toucher à la sélection', async () => {
    await lassoAround(await page.locator('[data-card-id]').all());
    const selected = (await state()).selection;
    if (selected === 0) throw new Error('le lasso ne sélectionne rien');

    // Le même tracé au bouton droit déplace la table. Il ne touche pas à la
    // sélection : recadrer n'est pas désélectionner.
    const before = await planeTransform();
    // Le point de départ doit être le fond de la table, et non une carte, un
    // contrôle ou le rail de main : selon le cadrage, le point « 85 % de la
    // hauteur du panneau » tombe parfois sous la main, et l'on mesurait alors
    // l'absence de geste plutôt qu'un pan manquant.
    const start = await emptySpot();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(start.x + i * 18, start.y + i * 9);
      await page.waitForTimeout(20);
    }
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(200);
    const after = await planeTransform();
    if (Math.hypot(after.e - before.e, after.f - before.f) < 40) {
      throw new Error('le glisser du bouton droit n’a pas déplacé la table');
    }
    if ((await state()).selection !== selected) throw new Error('un pan a modifié la sélection');

    // Un clic net sur un point vide du fond, lui, vide la sélection.
    const empty = await emptySpot();
    await page.mouse.click(empty.x, empty.y);
    await page.waitForTimeout(250);
    if ((await state()).selection !== 0) throw new Error('un clic sur le fond n’a pas vidé la sélection');

    await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
    await page.waitForTimeout(300);
  });

  await step('la molette zoome vers le curseur, et non vers l’origine du plan', async () => {
    /*
     * Le plan est peint avec `translate(view.x, view.y) scale(view.scale)` et une
     * origine de transformation fixe : ne toucher qu'à l'échelle éloigne tout de
     * **l'origine du plan**, ce qui se ressent comme « ça zoome vers le centre du
     * terrain ». La correction attendue est celle de tout plan zoomable — le
     * point du monde sous le curseur y reste.
     *
     * On le mesure **près d'un coin**, et pas au milieu : au centre du cadre,
     * « vers le curseur » et « vers l'origine » se ressemblent assez pour qu'un
     * zoom faux s'en tire. C'est le coin qui décide. Les cas plus fins — le
     * bridage de caméra qui mord, et le plafond d'échelle où un cran de plus ne
     * doit rien déplacer ni rien re-rendre — restent à `probe-zoom-curseur.mjs`,
     * qui monte deux clients pour les éprouver.
     */
    const centreDe = async (loc) => {
      const b = await loc.boundingBox();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    };
    const repere = page.locator('[data-card-id]').first();
    const depart = await centreDe(repere);
    if (!depart) throw new Error('aucun permanent visible pour servir de repère au zoom');

    // On amène le repère dans le coin bas gauche de l'espace libre, au bouton
    // droit ; la position réellement obtenue est relue, jamais supposée — le
    // bridage de caméra peut refuser une partie du déplacement.
    await page.mouse.move(depart.x, depart.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(430, 620, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(250);

    const pose = await centreDe(repere);
    if (!pose) throw new Error('le repère a disparu du cadre après le déplacement');
    const echelleAvant = await page.evaluate(() => window.__mtg.getState().viewScale);
    await page.mouse.move(pose.x, pose.y);
    await page.waitForTimeout(80);
    // Quatre crans : depuis une échelle de cadrage (≤ 1), ×1,46 reste loin du
    // plafond de 2,5, donc le bridage ne peut pas brouiller la mesure.
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(70);
    }
    const arrivee = await centreDe(repere);
    const echelleApres = await page.evaluate(() => window.__mtg.getState().viewScale);
    if (!(echelleApres > echelleAvant * 1.2)) {
      throw new Error(`la molette n'a pas zoomé (${echelleAvant} → ${echelleApres})`);
    }
    const derive = Math.hypot(arrivee.x - pose.x, arrivee.y - pose.y);
    // Quelques pixels d'arrondi de rendu sont normaux ; un zoom qui vise
    // l'origine dérive ici de plusieurs centaines.
    if (derive > 8) {
      throw new Error(
        `le repère a glissé de ${derive.toFixed(1)} px sous le curseur : le zoom ne vise pas le curseur`,
      );
    }
    console.log(`      zoom ancré : ${derive.toFixed(1)} px de dérive au coin, échelle ${echelleApres.toFixed(2)}`);

    await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
    await page.waitForTimeout(300);
  });
  await page.screenshot({ path: `${OUT}/ui-03-selection.png` });
  await page.keyboard.press('Escape');

  // ------------------------------------------------------------ menus contextuels

  await step(
    'menu contextuel : carte en main',
    async () => {
      await page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first().click({ button: 'right' });
      await page.getByText('Jouer face cachée').waitFor({ timeout: 5000 });
    },
    // Le menu reste ouvert le temps de la capture, juste en dessous.
    { menuOuvert: true },
  );
  await page.screenshot({ path: `${OUT}/ui-04-menu-main.png` });
  await fermerMenu();

  await step('menu contextuel : permanent', async () => {
    // Viser une carte **de notre siège** : `[data-card-id]` couvre les champs de
    // bataille de tous les joueurs, et `.last()` tombait sur un permanent
    // adverse — le menu s'ouvrait, mais le serveur refusait d'y poser un
    // marqueur, et l'étape suivante attendait un compteur qui n'arrivait jamais.
    await myPermanent().click({ button: 'right' });
    await page.getByText('Ajouter un marqueur +1/+1').waitFor({ timeout: 5000 });
    // Relais voulu : l'étape suivante clique dans ce menu-ci.
  }, { menuOuvert: true });
  await page.screenshot({ path: `${OUT}/ui-05-menu-permanent.png` });

  await step('poser un marqueur depuis le menu', async () => {
    await page.getByRole('button', { name: /Ajouter un marqueur/ }).click();
    await page.waitForFunction(
      () => [...window.__mtg.getState().cards.values()].some((c) => c.counters.length > 0),
      null,
      { timeout: 8000 },
    );
    // Poser un marqueur ne referme pas le menu — on en pose souvent plusieurs.
    // C'est donc ici qu'on le referme, et qu'on le vérifie.
    await fermerMenu();
  });

  await step(
    'menu contextuel : bibliothèque',
    async () => {
      (await seatZone('LIBRARY')).click({ button: 'right' });
      await page.getByText('Chercher dans la bibliothèque').waitFor({ timeout: 5000 });
    },
    // Relais voulu : « Échap referme le menu de pile » éprouve sa fermeture.
    { menuOuvert: true },
  );
  await page.screenshot({ path: `${OUT}/ui-06-menu-bibliotheque.png` });

  await step('Échap referme le menu de pile', async () => {
    await page.keyboard.press('Escape');
    await page.getByText('Chercher dans la bibliothèque').waitFor({ state: 'detached', timeout: 4000 });
  });

  await step('menu contextuel : cimetière', async () => {
    (await seatZone('GRAVEYARD')).click({ button: 'right' });
    await page.getByText('Ouvrir dans le panneau des zones').first().waitFor({ timeout: 5000 });
    await fermerMenu();
  });

  await step('menu contextuel : zone de commandement', async () => {
    (await seatZone('COMMAND')).click({ button: 'right' });
    await page.getByText('Ouvrir dans le panneau des zones').first().waitFor({ timeout: 5000 });
    await fermerMenu();
  });

  // ------------------------------------------------------------------ actions

  await step('scry via le menu Actions', async () => {
    await page.getByRole('button', { name: /Actions/ }).click();
    await page.getByRole('button', { name: 'Scry 1' }).click();
    await page.getByText('Consultation —').waitFor({ timeout: 8000 });
  });
  await page.screenshot({ path: `${OUT}/ui-07-scry.png` });

  await step('valider la consultation', async () => {
    await page.locator('[data-test="look-submit"]').click();
    await page.waitForTimeout(600);
  });

  // « Ranger les terrains » a été retiré de l'application ; l'étape qui le
  // cliquait laissait le voile du menu *Actions* ouvert sur toute la suite de
  // la recette, et une vingtaine d'étapes échouaient pour cette seule raison.

  await step('réglages de playmat et de dos de carte', async () => {
    await page.getByRole('button', { name: '⚙' }).click();
    await page.getByText('Playmat et dos de carte').first().waitFor({ timeout: 5000 });
    await page.getByPlaceholder('https://…').first().fill('https://example.invalid/playmat.jpg');
    const before = await page.evaluate(() => window.__mtg.getState().seq);
    await page.getByRole('button', { name: 'Appliquer' }).first().click();
    await page.waitForTimeout(1500);
    const applied = await page.evaluate(() => {
      const s = window.__mtg.getState();
      return s.seats.find((x) => x.id === s.mySeat)?.playmatUrl ?? null;
    });
    const rejected = await page.evaluate(() => window.__mtg.getState().lastReject);
    if (!applied) {
      // Le client envoie bien SET_SEAT_COSMETICS ; tant que le serveur ne
      // l'implémente pas, aucun event ne revient. On le signale, sans échouer
      // sur un manque qui n'est pas dans ce périmètre.
      console.log(
        `      ATTENTION : SET_SEAT_COSMETICS sans effet (seq ${before} → ` +
          `${await page.evaluate(() => window.__mtg.getState().seq)}, rejet : ${rejected ?? 'aucun'}) — intent absent du serveur.`,
      );
    }
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: 'Fermer' }).waitFor({ state: 'detached', timeout: 4000 });
  });
  await page.screenshot({ path: `${OUT}/ui-08-playmat.png` });

  await step('tout dégager et lancer un d20', async () => {
    await page.getByRole('button', { name: 'Tout dégager' }).click();
    await page.getByRole('button', { name: 'd20' }).click();
    await page.waitForTimeout(600);
  });

  // ----------------------------------------------------- contrôles flottants

  await step('les boutons de cadrage sont cliquables', async () => {
    for (const name of ['Voir toute la table', 'Recentrer sur moi']) {
      await page.getByRole('button', { name }).click({ timeout: 5000 });
      await page.waitForTimeout(200);
    }
  });

  await step('les boutons de cadrage restent cliquables en fenêtre étroite', async () => {
    // À cette largeur, le rail de main passe par-dessus le coin bas-gauche.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(400);
    for (const name of ['Voir toute la table', 'Recentrer sur moi']) {
      await page.getByRole('button', { name }).click({ timeout: 5000 });
      await page.waitForTimeout(200);
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(400);
  });

  await step('le cadrage initial place le siège local dans le cadre', async () => {
    await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
    await page.waitForTimeout(300);
    const box = await (await seatZone('BATTLEFIELD')).boundingBox();
    const view = page.viewportSize();
    const centerX = box.x + box.width / 2;
    if (centerX < view.width * 0.2 || centerX > view.width * 0.8) {
      throw new Error(`panneau local hors du cadre (centre à ${Math.round(centerX)} px)`);
    }
    if (box.y < -50 || box.y > view.height * 0.85) {
      throw new Error(`panneau local mal cadré verticalement (haut à ${Math.round(box.y)} px)`);
    }
  });

  // --------------------------------------------------- menus et débordement

  await step('le menu d’une carte en main tient dans la fenêtre', async () => {
    const card = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').last();
    const box = await card.boundingBox();
    // Clic tout en bas de la carte : le pire cas pour un menu déroulant.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 6, { button: 'right' });
    const menu = page.locator('div.fixed.z-50.w-60').first();
    await menu.waitFor({ timeout: 5000 });
    const menuBox = await menu.boundingBox();
    const view = page.viewportSize();
    if (menuBox.y < 0 || menuBox.y + menuBox.height > view.height) {
      throw new Error(
        `menu hors du cadre : ${Math.round(menuBox.y)}..${Math.round(menuBox.y + menuBox.height)} pour ${view.height}`,
      );
    }
    // Et surtout : la dernière entrée doit être réellement cliquable.
    const last = menu.locator('button').last();
    await last.scrollIntoViewIfNeeded();
    await last.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    // La dernière entrée peut ouvrir une modale (« Changer d'impression… ») :
    // Échap doit la refermer, sinon son voile avalerait toute la suite.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const veiled = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return Boolean(el?.closest('.fixed.inset-0.z-50'));
    });
    if (veiled) throw new Error('un voile modal est resté ouvert après Échap');
  });
  await page.screenshot({ path: `${OUT}/ui-12-menu-bas.png` });

  // ------------------------------------------------------- raccourcis clavier

  const handSize = () =>
    page.evaluate(() => {
      const s = window.__mtg.getState();
      return [...s.cards.values()].filter((c) => c.zone.kind === 'HAND').length;
    });

  /**
   * Amène le curseur au centre d'une carte et renvoie ce que le store a retenu.
   * Si rien n'est survolé, on dit ce qui se trouvait sous le curseur : c'est
   * presque toujours un panneau flottant qui recouvre la carte.
   */
  async function hover(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('carte à survoler introuvable');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x - 8, y - 8);
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    const id = await page.evaluate(() => window.__mtg.getState().hoveredCardId);
    if (!id) {
      const top = await page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return `${el?.tagName} ${String(el?.className).slice(0, 60)}`;
        },
        [x, y],
      );
      throw new Error(`survol non enregistré en (${Math.round(x)}, ${Math.round(y)}) — dessus : ${top}`);
    }
    return id;
  }

  /** Identifiant d'une carte recto-verso connue du client, ou `null`. */
async function findDoubleFaced() {
  for (let attempt = 0; attempt < 25; attempt++) {
    const found = await page.evaluate(async () => {
      const s = window.__mtg.getState();
      const known = [...s.cards.values()].filter(
        (c) => c.faceDown === false && ['HAND', 'BATTLEFIELD', 'GRAVEYARD', 'EXILE'].includes(c.zone.kind),
      );
      if (known.length === 0) return null;
      const res = await fetch('/api/cards/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...new Set(known.map((c) => c.scryfallId))] }),
      });
      const body = await res.json();
      const dfc = new Set(
        (body.cards ?? [])
          .filter((m) => ['transform', 'modal_dfc', 'double_faced_token'].includes(m.layout))
          .map((m) => m.scryfallId),
      );
      return known.find((c) => dfc.has(c.scryfallId))?.id ?? null;
    });
    if (found) return found;
    await page.keyboard.press('d');
    await page.waitForTimeout(350);
  }
  return null;
}

/** Repioche jusqu'à avoir au moins `n` cartes en main. */
  async function refillHand(n) {
    await unhover();
    for (let i = 0; i < 12 && (await handSize()) < n; i++) {
      await page.keyboard.press('d');
      await page.waitForTimeout(350);
    }
    if ((await handSize()) < n) throw new Error('impossible de regarnir la main');
  }

  /** Éloigne le curseur de toute carte. */
  async function unhover() {
    await page.mouse.move(6, 520);
    await page.waitForFunction(() => window.__mtg.getState().hoveredCardId === null, null, {
      timeout: 4000,
    });
  }

  await step('raccourci global : D pioche, sans survol', async () => {
    await unhover();
    const before = await handSize();
    await page.keyboard.press('d');
    await page.waitForFunction(
      (n) => [...window.__mtg.getState().cards.values()].filter((c) => c.zone.kind === 'HAND').length === n + 1,
      before,
      { timeout: 8000 },
    );
  });

  await step('raccourci global : U dégage tout', async () => {
    await unhover();
    /*
     * Il faut quelque chose à dégager.
     *
     * `UNTAP_ALL` se tait quand rien n'est engagé — comme `TAP`/`UNTAP`, pour
     * ne pas noyer le journal sous des lignes vides. L'étape mesurait donc une
     * avancée de `seq`, qui ne bouge plus pour un geste sans effet : elle
     * tombait sur un serveur parfaitement sain. On engage d'abord un
     * permanent, puis on assure sur l'état de **la carte**, seule chose que le
     * raccourci promet. Jamais sur `seq`.
     */
    const engage = await page.evaluate(async () => {
      const s = window.__mtg.getState();
      const surTable = [...s.cards.values()].filter(
        (c) => c.zone.kind === 'BATTLEFIELD' && c.zone.seat === s.mySeat,
      );
      if (surTable.length === 0) {
        const enMain = [...s.cards.values()].find(
          (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
        );
        if (!enMain) return null;
        s.send({ type: 'MOVE_CARD', cardId: enMain.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 320, y: 220 });
        return enMain.id;
      }
      return surTable[0].id;
    });
    if (!engage) throw new Error('aucune carte à engager pour éprouver le dégagement');
    await page.waitForFunction(
      (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD',
      engage,
      { timeout: 8000 },
    );
    await page.evaluate(
      (id) => window.__mtg.getState().send({ type: 'TAP', cardIds: [id] }),
      engage,
    );
    await page.waitForFunction(
      (id) => window.__mtg.getState().cards.get(id)?.tapped === true,
      engage,
      { timeout: 8000 },
    );

    await unhover();
    await page.keyboard.press('u');
    await page.waitForFunction(
      (id) => window.__mtg.getState().cards.get(id)?.tapped === false,
      engage,
      { timeout: 8000 },
    );
  });

  // Les trois raccourcis de permanent portent sur la carte que l'on vient de
  // jouer : on la connaît par son identifiant, donc aucun doute sur la cible.
  let played = null;

  await step('raccourci contextuel : P joue la carte survolée', async () => {
    played = await hover(page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first());
    await page.keyboard.press('p');
    await page.waitForFunction(
      (cardId) => window.__mtg.getState().cards.get(cardId)?.zone.kind === 'BATTLEFIELD',
      played,
      { timeout: 8000 },
    );
  });

  const playedSprite = () => page.locator(`[data-card-id="${played}"] img[src*="scryfall"]`);

  await step('raccourci contextuel : T engage le permanent survolé', async () => {
    const id = await hover(playedSprite());
    if (id !== played) throw new Error(`survol sur ${id} au lieu de ${played}`);
    const was = await page.evaluate((c) => window.__mtg.getState().cards.get(c)?.tapped, id);
    await page.keyboard.press('t');
    await page.waitForFunction(
      ([c, before]) => window.__mtg.getState().cards.get(c)?.tapped !== before,
      [id, was],
      { timeout: 8000 },
    );
  });

  await step('raccourci contextuel : + pose un marqueur +1/+1', async () => {
    const id = await hover(playedSprite());
    const before = await page.evaluate(
      (c) => window.__mtg.getState().cards.get(c)?.counters.find((x) => x.kind === '+1/+1')?.value ?? 0,
      id,
    );
    await page.keyboard.press('+');
    await page.waitForFunction(
      ([c, n]) =>
        (window.__mtg.getState().cards.get(c)?.counters.find((x) => x.kind === '+1/+1')?.value ?? 0) === n + 1,
      [id, before],
      { timeout: 8000 },
    );
  });

  await step('raccourci contextuel : G envoie le permanent survolé au cimetière', async () => {
    const id = await hover(playedSprite());
    await page.keyboard.press('g');
    await page.waitForFunction((c) => window.__mtg.getState().cards.get(c)?.zone.kind === 'GRAVEYARD', id, {
      timeout: 8000,
    });
  });

  await step('le survol se réévalue sous un curseur immobile', async () => {
    // On joue trois cartes d'affilée sans jamais bouger la souris : après
    // chaque `P`, la carte suivante arrive sous le curseur et doit devenir la
    // nouvelle cible, sans le moindre événement de pointeur.
    await refillHand(5);
    // On vise le milieu du rail : la main est centrée, donc une carte reste
    // sous ce point-là quand le rail se resserre.
    const rail = await page.locator('[data-zone$="|HAND"]').first().boundingBox();
    await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height - 60);
    await page.waitForTimeout(250);

    const played = [];
    for (let i = 0; i < 3; i++) {
      const id = await page.evaluate(() => window.__mtg.getState().hoveredCardId);
      if (!id) throw new Error(`plus aucune carte survolée après ${i} jeu(x)`);
      if (played.includes(id)) throw new Error('le survol est resté collé à la même carte');
      played.push(id);
      await page.keyboard.press('p');
      await page.waitForFunction(
        (c) => window.__mtg.getState().cards.get(c)?.zone.kind === 'BATTLEFIELD',
        id,
        { timeout: 8000 },
      );
      await page.waitForTimeout(250);
    }
  });

  await step('collision S : carte survolée en main → mettre sur la pile', async () => {
    const id = await hover(page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first());
    await page.keyboard.press('s');
    await page.waitForFunction((c) => window.__mtg.getState().cards.get(c)?.zone.kind === 'STACK_NOTE', id, {
      timeout: 8000,
    });
  });

  await step('collision S : sans survol → mélanger la bibliothèque', async () => {
    await unhover();
    const before = await page.evaluate(() => window.__mtg.getState().log.length);
    await page.keyboard.press('s');
    await page.waitForFunction(
      (n) => {
        const log = window.__mtg.getState().log;
        return log.length > n && /m\u00e9lang/i.test(log[log.length - 1].text);
      },
      before,
      { timeout: 8000 },
    );
  });

  await step('aucune action au clavier pendant un glisser-déposer', async () => {
    await refillHand(2);
    const card = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y - 60);
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.__mtg.getState().seq);
    await page.keyboard.press('g');
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => window.__mtg.getState().seq);
    await page.mouse.up();
    await page.waitForTimeout(500);
    if (after !== before) throw new Error('une touche a agi pendant le glissement');
  });

  await step('l’aide clavier montre les deux familles', async () => {
    await unhover();
    await page.keyboard.press('?');
    // L'aide a été refaite : deux colonnes, « au survol » et « table et
    // souris », et la règle d'arbitrage en tête. C'est cette structure qu'on
    // vérifie, pas les anciens intitulés.
    await page.getByRole('dialog', { name: 'Raccourcis clavier' }).waitFor({ timeout: 5000 });
    for (const wanted of ["Au survol d'une carte", 'Table et souris']) {
      if ((await page.getByText(wanted, { exact: false }).count()) === 0) {
        throw new Error(`famille absente de l’aide : ${wanted}`);
      }
    }
    await page.screenshot({ path: `${OUT}/ui-13-aide.png` });
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('dialog', { name: 'Raccourcis clavier' }).waitFor({ state: 'detached', timeout: 5000 });
  });

  // ------------------------------------------------------- aperçu au survol

  await step('un aperçu agrandi s’affiche au survol, du côté opposé', async () => {
    await unhover();
    if (await page.locator('[data-test="card-preview"]').count()) {
      throw new Error('un aperçu est affiché sans rien survoler');
    }

    // Carte en main, à gauche de l'écran : l'aperçu doit partir à droite.
    await page.getByRole('button', { name: 'Voir toute la table' }).click();
    await page.waitForTimeout(300);
    await refillHand(3);
    const card = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
    await hover(card);

    const preview = page.locator('[data-test="card-preview"]');
    await preview.waitFor({ timeout: 5000 });

    const src = await preview.locator('[data-test="card-preview-image"]').getAttribute('src');
    if (!src?.includes('/large/')) throw new Error(`l'aperçu n'utilise pas la grande image : ${src}`);

    // Il ne doit jamais intercepter le pointeur, sinon il tue le survol.
    const pe = await preview.evaluate((el) => getComputedStyle(el).pointerEvents);
    if (pe !== 'none') throw new Error(`aperçu avec pointer-events: ${pe}`);

    // Et il ne recouvre pas la carte survolée.
    const cardBox = await card.boundingBox();
    const previewBox = await preview.boundingBox();
    const overlaps =
      cardBox.x < previewBox.x + previewBox.width &&
      cardBox.x + cardBox.width > previewBox.x &&
      cardBox.y < previewBox.y + previewBox.height &&
      cardBox.y + cardBox.height > previewBox.y;
    if (overlaps) throw new Error('l’aperçu recouvre la carte qu’il montre');

    const sideA = await preview.getAttribute('data-preview-side');
    await page.screenshot({ path: `${OUT}/ui-15-apercu.png` });

    /*
     * L'aperçu ne **bascule plus** d'un bord à l'autre : il est ancré en bas à
     * gauche, à un emplacement fixe, et c'est un choix assumé — un panneau qui
     * saute d'un côté à l'autre selon la carte survolée oblige l'œil à le
     * rechercher à chaque fois. Ce qu'on vérifie est donc l'inverse de ce que
     * cette étape vérifiait : qu'il ne bouge pas.
     */
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-zone$="|HAND"] [data-card]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.card, cx: r.left + r.width / 2, x: r.left, y: r.top, w: r.width, h: r.height };
      }),
    );
    const other = boxes.at(-1);
    if (other && boxes.length > 1) {
      await page.mouse.move(other.x + 14, other.y + other.h / 2);
      await page.waitForTimeout(300);
      const sideB = await preview.getAttribute('data-preview-side');
      const movedBox = await preview.boundingBox();
      if (sideB !== sideA) throw new Error(`l'aperçu a changé de côté (${sideA} → ${sideB})`);
      if (Math.abs(movedBox.x - previewBox.x) > 2 || Math.abs(movedBox.y - previewBox.y) > 2) {
        throw new Error('l’aperçu s’est déplacé d’une carte à l’autre');
      }
      console.log(`      aperçu ancré à gauche (${sideA}), immobile d’une carte à l’autre`);
    } else {
      console.log('      (une seule carte en main : stabilité de l’aperçu non exercée)');
    }
    await unhover();
  });

  await step('l’aperçu suit le survol hors de la table : recherche de jeton, puis cimetière', async () => {
    await unhover();
    const preview = page.locator('[data-test="card-preview"]');

    /*
     * 1. La recherche de jeton. C'est le cas qui n'a pas d'objet de partie :
     *    un résultat n'est qu'une impression Scryfall, et l'aperçu doit savoir
     *    la montrer sans qu'aucune carte n'existe côté serveur.
     */
    // On vise un `data-test`, pas un `title` : le titre du bouton porte
    // aujourd'hui son raccourci (« Chercher un jeton (+) »), un sélecteur
    // d'attribut est une égalité exacte, et l'étape attendait donc trente
    // secondes un bouton qui existait sous ses yeux.
    await page.locator('[data-test="token-search"]').click();
    await page.getByPlaceholder(/Nom du jeton/).fill('spirit');
    const results = page.locator('[data-test="token-result"]');
    await results.first().waitFor({ timeout: 10000 });

    // Balayer la grille n'allume rien : le délai d'apparition existe pour que
    // l'aperçu ne clignote pas quand on parcourt une liste du regard.
    await page.evaluate(() => {
      window.__mtgTableRenders = 0;
    });
    const sweep = Math.min(await results.count(), 6);
    for (let i = 0; i < sweep; i++) {
      const cell = await results.nth(i).boundingBox();
      await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
      await page.waitForTimeout(40);
    }
    if (await preview.count()) throw new Error('l’aperçu clignote pendant le balayage de la recherche');

    // S'arrêter sur une vignette l'affiche, et il s'affiche **par-dessus** le
    // voile de la modale : un aperçu peint dessous serait un aperçu gris.
    const cell = await results.nth(1).boundingBox();
    await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
    await preview.waitFor({ timeout: 5000 });
    if ((await preview.getAttribute('data-preview-source')) !== 'printing') {
      throw new Error('un résultat de recherche devrait être prévisualisé comme une impression');
    }
    const src = await preview.locator('[data-test="card-preview-image"]').getAttribute('src');
    if (!src?.startsWith('https://cards.scryfall.io/')) {
      throw new Error(`l’aperçu ne charge pas l’image chez Scryfall : ${src}`);
    }
    const veiled = await page.evaluate(() => {
      const el = document.querySelector('[data-test="card-preview"]');
      const modal = document.querySelector('.fixed.inset-0.z-40');
      if (!modal) return false;
      // Comparaison de plans : l'aperçu doit peindre au-dessus du voile.
      return Number(getComputedStyle(el).zIndex) <= Number(getComputedStyle(modal).zIndex);
    });
    if (veiled) throw new Error('l’aperçu passe sous le voile de la recherche de jeton');
    await page.screenshot({ path: `${OUT}/ui-15b-apercu-jeton.png` });

    // Sortir du survol l'efface.
    await page.mouse.move(8, 8);
    await page.waitForTimeout(350);
    if (await preview.count()) throw new Error('l’aperçu survit à la sortie du survol');

    const rendersSearch = await page.evaluate(() => window.__mtgTableRenders ?? -1);
    console.log(`      ${sweep} vignettes survolées → ${rendersSearch} rendu(s) du plan de table`);
    if (rendersSearch < 0) throw new Error('compteur de rendus absent');
    if (rendersSearch > 0) throw new Error(`le survol d’une liste re-rend la table (${rendersSearch})`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    /*
     * 2. Le cimetière, dans le panneau des zones. Là, il y a un objet de
     *    partie : l'aperçu doit le préférer, puisque lui seul porte l'état.
     */
    (await seatZone('GRAVEYARD')).click();
    await page.locator('[data-test="zone-panel"]').waitFor({ timeout: 5000 });
    const zoneCard = page.locator('[data-test="zone-card"]').first();
    await zoneCard.waitFor({ timeout: 5000 });
    await page.evaluate(() => {
      window.__mtgTableRenders = 0;
    });
    const zbox = await zoneCard.boundingBox();
    await page.mouse.move(zbox.x + zbox.width / 2, zbox.y + zbox.height / 2);
    await preview.waitFor({ timeout: 5000 });
    if ((await preview.getAttribute('data-preview-source')) !== 'card') {
      throw new Error('une carte du cimetière devrait être prévisualisée comme objet de partie');
    }
    const rendersZone = await page.evaluate(() => window.__mtgTableRenders ?? -1);
    console.log(`      survol d’une carte du cimetière → ${rendersZone} rendu(s) du plan de table`);
    if (rendersZone > 0) throw new Error(`le survol du cimetière re-rend la table (${rendersZone})`);
    await page.screenshot({ path: `${OUT}/ui-15c-apercu-cimetiere.png` });

    await page.locator('[data-test="zone-panel-close"]').click();
    await unhover();
  });

  // ------------------------------------------------------------- fluidité

  await step('un glissement ne re-rend pas la table', async () => {
    await refillHand(2);
    const card = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Franchir le seuil coûte un rendu, c'est voulu : on remet le compteur à
    // zéro après, pour ne mesurer que le régime établi.
    await page.mouse.move(box.x + box.width / 2 + 30, box.y - 30);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      window.__mtgTableRenders = 0;
    });

    const target = await (await seatZone('BATTLEFIELD')).boundingBox();
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        box.x + ((target.x + target.width / 2 - box.x) * i) / steps,
        box.y + ((target.y + target.height / 2 - box.y) * i) / steps,
      );
    }
    const renders = await page.evaluate(() => window.__mtgTableRenders ?? -1);
    await page.mouse.up();
    await page.waitForTimeout(600);

    console.log(`      ${steps} déplacements de pointeur → ${renders} rendu(s) du plan de table`);
    if (renders < 0) throw new Error('compteur de rendus absent');
    if (renders > 2) throw new Error(`${renders} rendus du plan pour ${steps} déplacements`);
  });

  await step('le déplacement d’un permanent est appliqué sans attendre le serveur', async () => {
    await waitZone('BATTLEFIELD', 1, 10000).catch(() => undefined);
    const sprite = page.locator('[data-card-id] img[src*="scryfall"]').first();
    const id = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD')?.id,
    );
    if (!id) throw new Error('aucun permanent sur le champ de bataille');

    // On instrumente la page : quand la prédiction s'applique, et quand l'event
    // du serveur arrive. Les deux horodatages sont pris dans la même base.
    await page.evaluate(() => {
      window.__pred = { t0: 0, predicted: 0, event: 0 };
      const seq0 = window.__mtg.getState().seq;
      window.__predStop?.();
      window.__predStop = window.__mtg.subscribe((s) => {
        if (!window.__pred.t0) return;
        if (!window.__pred.predicted && s.predicted.size > 0) {
          window.__pred.predicted = performance.now();
        }
        if (!window.__pred.event && s.seq > seq0) window.__pred.event = performance.now();
      });
    });

    const from = await sprite.boundingBox();
    const zone = await (await seatZone('BATTLEFIELD')).boundingBox();
    const to = { x: zone.x + zone.width * 0.72, y: zone.y + zone.height * 0.62 };

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        from.x + from.width / 2 + ((to.x - from.x - from.width / 2) * i) / 8,
        from.y + from.height / 2 + ((to.y - from.y - from.height / 2) * i) / 8,
      );
      await page.waitForTimeout(15);
    }
    await page.evaluate(() => {
      window.__pred.t0 = performance.now();
    });
    await page.mouse.up();
    await page.waitForTimeout(1500);

    const marks = await page.evaluate(() => {
      window.__predStop?.();
      return window.__pred;
    });
    if (!marks.predicted) throw new Error('aucune prédiction locale appliquée au relâchement');
    const localMs = Math.round(marks.predicted - marks.t0);
    const serverMs = marks.event ? Math.round(marks.event - marks.t0) : null;
    console.log(
      `      repositionnement local à +${localMs} ms ; event serveur à ` +
        `${serverMs === null ? 'non observé' : `+${serverMs} ms`}`,
    );
    if (localMs > 80) throw new Error(`prédiction appliquée après ${localMs} ms`);
    if (serverMs !== null && marks.predicted > marks.event) {
      throw new Error('la prédiction est arrivée après l’event : elle ne sert à rien');
    }

    // Et la position finale est bien celle du serveur, pas celle devinée.
    const settled = await page.evaluate(() => window.__mtg.getState().predicted.size);
    if (settled !== 0) throw new Error('une prédiction n’a pas été levée par l’event');
  });

  await step('une prédiction refusée est annulée', async () => {
    // On prédit à la main une position absurde sur une carte, puis on laisse le
    // filet de sécurité et le `reject` faire leur travail : rien ne doit rester.
    const ok = await page.evaluate(async () => {
      const s = window.__mtg.getState();
      const card = [...s.cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD');
      if (!card) return 'aucun permanent';
      // Intent volontairement invalide : objet inconnu.
      const cid = s.send({
        type: 'MOVE_CARD',
        cardId: 'objet-qui-nexiste-pas',
        to: { seat: s.mySeat, kind: 'BATTLEFIELD' },
        x: 10,
        y: 10,
      });
      s.predictMove(card.id, 999, 999, cid);
      await new Promise((r) => setTimeout(r, 1500));
      return window.__mtg.getState().predicted.size === 0 ? 'ok' : 'prédiction restée';
    });
    if (ok !== 'ok') throw new Error(ok);
  });

  await step('recherche de jetons : les variantes d’un même nom sont distinctes', async () => {
    /*
     * Un nom de jeton ne désigne rien : il existe seize « Spirit » différents.
     * La recherche n'en rendait qu'un — le 1/1 blanc — et l'on croyait que les
     * autres n'étaient pas dans la base. Ils y étaient.
     */
    const variants = await page.evaluate(async () => {
      const res = await fetch('/api/cards/search?q=spirit&type=token&limit=20');
      const body = await res.json();
      return body.results.map((r) => `${r.power}/${r.toughness} ${(r.colors ?? []).join('')}`);
    });
    if (new Set(variants).size < 6) {
      throw new Error(`variantes de « Spirit » rendues : ${[...new Set(variants)].join(', ')}`);
    }

    // Et l'on doit pouvoir le demander par sa taille, comme on le dit à voix
    // haute : « le Spirit 3/2 ».
    const first = await page.evaluate(async () => {
      const res = await fetch('/api/cards/search?q=' + encodeURIComponent('spirit 3/2') + '&type=token&limit=3');
      const body = await res.json();
      const hit = body.results[0];
      return hit ? `${hit.power}/${hit.toughness}` : 'aucun';
    });
    if (first !== '3/2') throw new Error(`« spirit 3/2 » rend d'abord ${first}`);
  });

  await step('recherche de jetons : aucune impression ne tombe hors de la réponse', async () => {
    /*
     * Les trois signalements qui ont conduit à ce garde-fou, chacun désignant
     * un jeton **bien présent en base** que la recherche ne montrait pas :
     * l'Esprit 3/2 rouge-blanc, les deux Insectes de `tdsc` (12 et 22), et le
     * jeton de Tarkir : Dragonstorm que Magic-Ville référence `tdm806`,
     * c'est-à-dire l'Esprit 1/1 blanc de `ttdm`.
     *
     * La cause n'était pas l'ingestion : c'était le plafond de vingt résultats,
     * hérité de la recherche de cartes. Une centaine d'impressions de « Spirit »
     * se disputaient ces vingt places, toutes à égalité au classement, et
     * Postgres tranchait comme il voulait.
     *
     * On interroge donc sans plafond explicite, exactement comme l'interface.
     */
    const attendus = [
      ['insect', 'tdsc', '12'],
      ['insect', 'tdsc', '22'],
      ['spirit', 'ttdm', '6'],
      ['spirit 3/2', 'tstx', '6'],
      ['spirit 3/2', 'tmom', '13'],
      // Impression japonaise, seule parution de cette illustration : exiger
      // l'anglais l'écartait sans écarter le moindre doublon.
      ['spirit 3/2', 'wmom', '11'],
    ];

    const manquants = [];
    for (const [q, set, numero] of attendus) {
      const trouve = await page.evaluate(async ([q, set, numero]) => {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}&type=token`);
        const body = await res.json();
        return body.results.some((r) => r.setCode === set && r.collectorNumber === numero);
      }, [q, set, numero]);
      if (!trouve) manquants.push(`« ${q} » → ${set} ${numero}`);
    }
    if (manquants.length > 0) throw new Error(`introuvable(s) : ${manquants.join(' ; ')}`);

    /*
     * Et chaque illustration doit rester joignable : trois Insectes verts 1/1
     * de la même extension sont trois dessins, et c'est souvent sur le dessin
     * qu'on choisit son jeton.
     */
    const illustrations = await page.evaluate(async () => {
      const res = await fetch('/api/cards/search?q=insect&type=token');
      const body = await res.json();
      return body.results.filter((r) => r.setCode === 'tdsc').length;
    });
    if (illustrations < 3) {
      throw new Error(`seulement ${illustrations} Insecte(s) de tdsc rendus, il y en a trois`);
    }
  });

  // -------------------------------------------------------- étagère à jetons

  await step('étagère à jetons : ranger, poser, retirer', async () => {
    // Un jeton en jeu, créé par le menu Créer.
    await page.getByRole('button', { name: /Créer/ }).click();
    await page.getByRole('button', { name: 'Treasure', exact: true }).click();
    await page.waitForFunction(
      () => [...window.__mtg.getState().cards.values()].some((c) => c.kind === 'TOKEN'),
      null,
      { timeout: 15000 },
    );
    const tokenId = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.kind === 'TOKEN')?.id,
    );

    // Clic droit dessus → « Ranger ce jeton sur l'étagère ».
    await page.locator(`[data-card-id="${tokenId}"] img`).click({ button: 'right' });
    await page.getByText('Ranger ce jeton sur l’étagère').click({ timeout: 5000 });

    const shelfItem = page.locator('[data-test="shelf-token"]');
    await shelfItem.first().waitFor({ timeout: 8000 });
    if ((await shelfItem.count()) !== 1) throw new Error('l’étagère ne contient pas le jeton rangé');

    // L'étagère n'est pas une zone de jeu : elle ne crée aucun objet à elle seule.
    const tokensBefore = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length,
    );
    await page.screenshot({ path: `${OUT}/ui-16-etagere.png` });

    // Cliquer une vignette pose un jeton de plus.
    await shelfItem.first().click();
    await page.waitForFunction(
      (n) => [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length === n + 1,
      tokensBefore,
      { timeout: 10000 },
    );

    // Glisser une vignette le place à l'endroit visé, sur son propre champ.
    const target = await (await seatZone('BATTLEFIELD')).boundingBox();
    const item = await shelfItem.first().boundingBox();
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(
        item.x + ((target.x + target.width * 0.3 - item.x) * i) / 6,
        item.y + ((target.y + target.height * 0.4 - item.y) * i) / 6,
      );
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForFunction(
      (n) => [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length === n + 2,
      tokensBefore,
      { timeout: 10000 },
    );

    // Retrait de l'étagère.
    await shelfItem.first().hover();
    await page.locator('[data-test="shelf-remove"]').first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-test="shelf-token"]').length === 0,
      null,
      { timeout: 8000 },
    );
  });

  await step('l’étagère survit à un rechargement (invité, localStorage)', async () => {
    const stored = await page.evaluate(() => {
      // Une impression réelle, prise dans la partie : un identifiant inventé
      // ferait échouer la résolution de métadonnées et polluerait le diagnostic.
      const token = [...window.__mtg.getState().cards.values()].find(
        (c) => c.kind === 'TOKEN' && c.faceDown === false,
      );
      const items = [{ scryfallId: token.scryfallId, name: 'Jeton' }];
      window.localStorage.setItem('mtg.tokenShelf', JSON.stringify(items));
      return items.length;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Journal').waitFor({ timeout: 20000 });
    await page.locator('[data-test="shelf-token"]').first().waitFor({ timeout: 8000 });
    const count = await page.locator('[data-test="shelf-token"]').count();
    if (count !== stored) throw new Error(`${count} jeton(s) après rechargement au lieu de ${stored}`);
    await page.evaluate(() => window.localStorage.removeItem('mtg.tokenShelf'));
  });

  // ------------------------------------------------- actions assistées du menu

  /**
   * Le tiroir « Actions assistées › » d'un permanent de notre champ.
   *
   * Réouvert à chaque création : l'entrée du tiroir referme le menu, et rien ne
   * doit rester ouvert d'une itération à l'autre.
   */
  const ouvrirTiroirAssiste = async () => {
    await myPermanent().click({ button: 'right' });
    await page.locator('[data-test="card-menu"]').first().waitFor({ timeout: 5000 });
    await page.locator('[data-test="card-menu"]').getByText('Actions assistées').click();
    await page.locator('[data-test="card-submenu"]').first().waitFor({ timeout: 5000 });
  };

  /** Les jetons du champ, par identifiant : ce qui est neuf se lit par différence. */
  const jetonsPoses = () =>
    page.evaluate(() =>
      [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').map((c) => c.id),
    );

  /**
   * Ramasser ce qu'une étape a posé.
   *
   * Ces deux étapes créent des jetons **par-dessus** les permanents du champ, et
   * les y laisser fait tomber une étape bien plus loin, dont le double-clic
   * atteint alors le jeton au lieu de la carte visée — mesuré, pas supposé. Une
   * étape rend donc la table telle qu'elle l'a trouvée, même quand elle échoue.
   */
  const ramasserJetons = async (deja) => {
    await page
      .evaluate((connus) => {
        const s = window.__mtg.getState();
        const neufs = [...s.cards.values()]
          .filter((c) => c.kind === 'TOKEN' && !connus.includes(c.id))
          .map((c) => c.id);
        if (neufs.length > 0) s.send({ type: 'DESTROY_TOKEN', cardIds: neufs });
        return neufs.length;
      }, deja)
      .catch(() => 0);
    await page
      .waitForFunction(
        (connus) =>
          [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length <=
          connus.length,
        deja,
        { timeout: 8000 },
      )
      .catch(() => undefined);
  };

  /*
   * **Le garde-fou de la liste fermée**, et la raison d'être de cette étape.
   *
   * `CardMenu` porte une liste de jetons cherchés au catalogue par nom exact.
   * Deux de ses six entrées ont vécu mortes sans que rien ne le dise : le
   * catalogue n'a aucun jeton nommé « Incubator » — il s'appelle
   * « Incubator // Phyrexian », recto-verso —, ni aucun nommé « Army » — c'est
   * un type de créature, et les jetons s'appellent « Zombie Army », « Orc
   * Army »… Le joueur ne recevait qu'un « Jeton introuvable ».
   *
   * Aucun test unitaire ne pouvait le voir : il n'a pas de catalogue, et un nom
   * écrit de mémoire s'y compare à lui-même. Seule la recette, qui tourne
   * contre la vraie base, confronte la liste à ce qui existe. On déclenche donc
   * **chaque** entrée depuis le menu, et l'on tombe si l'une d'elles ne pose
   * rien — en nommant laquelle.
   *
   * La liste n'est pas recopiée ici : elle est **lue dans le dialogue**, sur
   * les options que le menu offre vraiment. Une entrée ajoutée demain à
   * `NAMED_TOKENS` sera donc éprouvée sans que cette étape bouge.
   */
  await step('actions assistées : chaque jeton nommé du menu existe au catalogue', async () => {
    const ouvrirJetonsNommes = async () => {
      await ouvrirTiroirAssiste();
      await page.locator('[data-test="card-submenu"]').getByText('Créer un jeton nommé…').click();
      await page.locator('[data-test="dialog"]').first().waitFor({ timeout: 5000 });
    };

    const depart = await jetonsPoses();
    try {
      await ouvrirJetonsNommes();
      const noms = await page
        .locator('[data-test="dialog-option"][data-field="token"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-value')));
      if (noms.length === 0) throw new Error('le menu ne propose aucun jeton nommé');
      console.log(`      liste fermée du menu : ${noms.join(', ')}`);

      for (const [rang, nom] of noms.entries()) {
        if (rang > 0) await ouvrirJetonsNommes();
        const avant = await jetonsPoses();
        await page
          .locator(`[data-test="dialog-option"][data-field="token"][data-value="${nom}"]`)
          .click();
        await page.locator('[data-test="dialog-submit"]').click();

        const cree = await page
          .waitForFunction(
            (n) =>
              [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length >
              n,
            avant.length,
            { timeout: 10000 },
          )
          .then(() => true)
          .catch(() => false);

        if (!cree) {
          // Le message du produit est l'aveu qu'on cherche : on le nomme dans
          // l'échec, pour que le rapport dise *pourquoi* et pas seulement *quoi*.
          const introuvable = await page
            .getByText('Jeton introuvable')
            .isVisible()
            .catch(() => false);
          await page.keyboard.press('Escape');
          throw new Error(
            introuvable
              ? `« ${nom} » : le menu propose un jeton que le catalogue n’a pas (« Jeton introuvable »)`
              : `« ${nom} » n’a posé aucun jeton`,
          );
        }

        // Et c'est bien **ce** jeton-là qui est né, pas un voisin approchant.
        const pose = await page.evaluate(async (deja) => {
          const neuf = [...window.__mtg.getState().cards.values()].find(
            (c) => c.kind === 'TOKEN' && !deja.includes(c.id),
          );
          if (!neuf) return null;
          const reponse = await fetch('/api/cards/batch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: [neuf.scryfallId] }),
          });
          const corps = await reponse.json();
          return corps.cards?.[0]?.name ?? null;
        }, avant);
        if (pose !== nom) throw new Error(`« ${nom} » a posé « ${pose} »`);
        console.log(`      ${nom} : posé`);
      }
    } finally {
      await ramasserJetons(depart);
    }
  });

  /*
   * L'armée d'« Amasser » : le catalogue propose, le joueur désigne.
   *
   * Il n'existe pas *une* armée mais une par race — et la prochaine extension
   * en ajoutera. Choisir la plus fréquente en silence conclurait à la place du
   * joueur, dont la carte dit peut-être « amassez des orques » : nous ne lisons
   * pas le texte de règles. On vérifie donc les deux moitiés : la liste vient
   * bien du catalogue (elle n'est pas vide, et ce qui naît est un jeton de type
   * Armée), et rien n'est décidé pour le joueur — aucune option n'est retenue
   * d'avance, et le dialogue refuse de se valider tant qu'il n'a pas désigné.
   */
  await step(
    'actions assistées : l’armée d’« Amasser » vient du catalogue et reste au choix',
    async () => {
      const depart = await jetonsPoses();
      try {
        await ouvrirTiroirAssiste();
        await page
          .locator('[data-test="card-submenu"]')
          .getByText('Amasser N — nouveau jeton Armée…')
          .click();
        await page.locator('[data-test="dialog"]').first().waitFor({ timeout: 8000 });

        const armees = page.locator('[data-test="dialog-option"][data-field="army"]');
        if ((await armees.count()) === 0) {
          await page.keyboard.press('Escape');
          throw new Error(
            'le dialogue d’Amasser ne propose aucune armée : le catalogue n’est pas lu',
          );
        }
        const libelles = await armees.evaluateAll((els) => els.map((el) => el.textContent.trim()));
        console.log(`      armées du catalogue : ${libelles.join(', ')}`);

        // Rien n'est retenu d'avance…
        const dejaRetenue = await armees.evaluateAll(
          (els) => els.filter((el) => el.getAttribute('aria-pressed') === 'true').length,
        );
        if (dejaRetenue > 0) {
          await page.keyboard.press('Escape');
          throw new Error('une armée est choisie d’avance : le menu conclut à la place du joueur');
        }
        // …et valider sans désigner ne crée rien.
        const avant = await jetonsPoses();
        await page.locator('[data-test="dialog-submit"]').click();
        await page.waitForTimeout(400);
        if (!(await page.locator('[data-test="dialog"]').first().isVisible())) {
          throw new Error('le dialogue s’est validé sans qu’aucune armée soit désignée');
        }

        // Le joueur désigne, et l'armée naît avec ses marqueurs.
        await armees.first().click();
        await page.locator('[data-test="dialog-submit"]').click();
        const ne = await page
          .waitForFunction(
            (deja) =>
              [...window.__mtg.getState().cards.values()].find(
                (c) => c.kind === 'TOKEN' && !deja.includes(c.id),
              )?.id ?? false,
            avant,
            { timeout: 10000 },
          )
          .then((poignee) => poignee.jsonValue())
          .catch(() => null);
        if (!ne) {
          const introuvable = await page
            .getByText('Jeton introuvable')
            .isVisible()
            .catch(() => false);
          await page.keyboard.press('Escape');
          throw new Error(
            introuvable
              ? 'Amasser propose une armée que le catalogue n’a pas (« Jeton introuvable »)'
              : 'Amasser n’a posé aucune armée',
          );
        }

        const vu = await page.evaluate(async (id) => {
          const carte = window.__mtg.getState().cards.get(id);
          const reponse = await fetch('/api/cards/batch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: [carte.scryfallId] }),
          });
          const corps = await reponse.json();
          return {
            nom: corps.cards?.[0]?.name ?? null,
            typeLine: corps.cards?.[0]?.typeLine ?? '',
            marqueurs: carte.counters?.find((c) => c.kind === '+1/+1')?.value ?? 0,
          };
        }, ne);
        if (!/(^|\s)Army(\s|$)/i.test(vu.typeLine)) {
          throw new Error(`Amasser a posé « ${vu.nom} » (${vu.typeLine}), qui n’est pas une armée`);
        }
        if (vu.marqueurs < 1) throw new Error(`« ${vu.nom} » est née sans marqueur +1/+1`);
        console.log(`      armée posée : ${vu.nom} avec ${vu.marqueurs} marqueur(s) +1/+1`);
      } finally {
        await ramasserJetons(depart);
      }
    },
  );

  /*
   * « Découvrir sans N » : le critère est un type, et **rien n'est choisi
   * d'avance**.
   *
   * Les cartes qui révèlent jusqu'à une créature, un artefact ou un Dragon ne
   * disent pas toutes ce que devient le reste — cimetière, dessous, main —, et
   * le dialogue ne peut donc pas le présélectionner sans conclure à la place du
   * joueur. On éprouve ici les trois moitiés du geste : le lexique français
   * mène bien au canon anglais (« chaman » propose `sub:shaman`), le dialogue
   * refuse de se valider tant que les deux champs ne sont pas désignés, et la
   * séquence s'arrête bel et bien sur un permanent.
   *
   * L'étape rend la table telle qu'elle l'a trouvée : tout ce qu'elle a bougé
   * repart sous la bibliothèque, faute de quoi les étapes suivantes liraient un
   * cimetière et un exil qu'elles n'ont pas remplis.
   */
  await step(
    'actions assistées : « Découvrir par type » s’arrête sur le type désigné',
    async () => {
      const zones = () =>
        page.evaluate(() => {
          const s = window.__mtg.getState();
          const mien = (kind) =>
            [...s.cards.values()]
              .filter((c) => c.zone.kind === kind && c.zone.seat === s.mySeat)
              .map((c) => c.id);
          return { exil: mien('EXILE'), cimetiere: mien('GRAVEYARD') };
        });
      const depart = await zones();
      try {
        await ouvrirTiroirAssiste();
        await page.locator('[data-test="card-submenu"]').getByText('Découvrir par type…').click();
        await page.locator('[data-test="dialog"]').first().waitFor({ timeout: 8000 });

        const critere = '[data-test="dialog-option"][data-field="criterion"]';
        const reste = '[data-test="dialog-option"][data-field="rest"]';
        const retenues = async (selecteur) =>
          page
            .locator(selecteur)
            .evaluateAll((els) => els.filter((el) => el.getAttribute('aria-pressed') === 'true').length);
        if ((await retenues(critere)) > 0 || (await retenues(reste)) > 0) {
          await page.keyboard.press('Escape');
          throw new Error('le dialogue retient un critère ou une destination d’avance');
        }

        // Le lexique français mène au canon anglais : « chaman » → `shaman`,
        // qui n'est dans aucune liste courte et arrive donc par la saisie libre.
        const recherche = page.locator('[data-test="dialog-search"][data-field="criterion"]');
        await recherche.fill('chaman');
        await page
          .locator(`${critere}[data-value="sub:shaman"]`)
          .waitFor({ timeout: 5000 })
          .catch(() => {
            throw new Error('« chaman » ne propose pas le sous-type shaman : le lexique n’est pas lu');
          });
        // Un mot que le lexique ignore est **dit**, et proposé quand même.
        await recherche.fill('zzzztruc');
        await page.locator('[data-test="dialog-search-note"]').waitFor({ timeout: 5000 });
        await recherche.fill('');

        // Valider sans rien désigner ne lance rien.
        await page.locator('[data-test="dialog-submit"]').click();
        await page.waitForTimeout(300);
        if (!(await page.locator('[data-test="dialog"]').first().isVisible())) {
          throw new Error('le dialogue s’est validé sans critère ni destination');
        }

        await page.locator(`${critere}[data-value="permanent"]`).click();
        // Toujours pas : la destination du reste n'est pas une formalité.
        await page.locator('[data-test="dialog-submit"]').click();
        await page.waitForTimeout(300);
        if (!(await page.locator('[data-test="dialog"]').first().isVisible())) {
          throw new Error('le dialogue s’est validé sans destination pour le reste');
        }

        await page.locator(`${reste}[data-value="GRAVEYARD"]`).click();
        await page.locator('[data-test="dialog-submit"]').click();

        const ligne = await page
          .waitForFunction(
            // La ligne nomme la carte déclenchante quand la table la voit
            // (« révèle depuis X »), et pas autrement : on cherche donc le
            // critère, qui est là dans les deux cas.
            () => window.__mtg.getState().log.map((l) => l.text).find((t) => t.includes("jusqu'à un permanent")) ?? false,
            undefined,
            { timeout: 10000 },
          )
          .then((poignee) => poignee.jsonValue())
          .catch(() => null);
        if (!ligne) throw new Error('aucune ligne de journal pour « Découvrir par type »');
        console.log(`      journal : ${ligne}`);
        if (!ligne.includes('révèle')) {
          throw new Error('la ligne de journal ne dit pas le geste');
        }

        const apres = await zones();
        const neuf = apres.exil.filter((id) => !depart.exil.includes(id));
        if (neuf.length !== 1) {
          throw new Error(`la séquence a laissé ${neuf.length} carte(s) à l’exil, au lieu d’une`);
        }
        const trouvee = await page.evaluate(async (id) => {
          const carte = window.__mtg.getState().cards.get(id);
          const reponse = await fetch('/api/cards/batch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: [carte.scryfallId] }),
          });
          const corps = await reponse.json();
          return { nom: corps.cards?.[0]?.name ?? null, typeLine: corps.cards?.[0]?.typeLine ?? '' };
        }, neuf[0]);
        const permanent = /\b(creature|land|artifact|enchantment|planeswalker|battle)\b/i;
        if (!permanent.test(trouvee.typeLine)) {
          throw new Error(
            `la séquence s’est arrêtée sur « ${trouvee.nom} » (${trouvee.typeLine}), qui n’est pas un permanent`,
          );
        }
        console.log(`      trouvée : ${trouvee.nom} — ${trouvee.typeLine}`);
      } finally {
        // Tout ce que l'étape a déplacé repart sous la bibliothèque.
        const apres = await zones();
        await page.evaluate(
          ({ avant, maintenant }) => {
            const s = window.__mtg.getState();
            const neufs = [
              ...maintenant.exil.filter((id) => !avant.exil.includes(id)),
              ...maintenant.cimetiere.filter((id) => !avant.cimetiere.includes(id)),
            ];
            if (neufs.length > 0) {
              s.send({
                type: 'MOVE_CARDS',
                cardIds: neufs,
                to: { seat: s.mySeat, kind: 'LIBRARY' },
                index: 'BOTTOM',
              });
            }
          },
          { avant: depart, maintenant: apres },
        );
        await page.waitForTimeout(300);
      }
    },
  );

  // ---------------------------------------------------------- fond de table

  await step('le fond de table est dessiné, dans le repère du monde', async () => {
    const info = await page.evaluate(() => {
      const plane = document.querySelector('.table-surface').firstElementChild;
      const bg = plane.firstElementChild;
      const svg = bg?.querySelector('svg');
      const img = bg?.querySelector('img');
      // Le décor peut être peint en couches CSS plutôt qu'en SVG inline : ce
      // qui compte est qu'il soit **dessiné** et non téléchargé d'un tiers.
      const painted = [...(bg?.querySelectorAll('*') ?? []), bg].some((el) => {
        if (!el) return false;
        const value = getComputedStyle(el).backgroundImage;
        return value.includes('gradient') || value.includes('url(data:');
      });
      const panel = document.querySelector('[data-zone$="|BATTLEFIELD"]');
      const b = bg?.getBoundingClientRect();
      const p = panel?.getBoundingClientRect();
      return {
        hasSvg: Boolean(svg),
        painted,
        imgSrc: img?.getAttribute('src') ?? null,
        // Le fond doit couvrir les panneaux, et être dessous.
        covers: Boolean(b && p && b.left <= p.left && b.right >= p.right && b.top <= p.top && b.bottom >= p.bottom),
        markup: svg ? svg.outerHTML.length : 0,
      };
    });
    if (!info.hasSvg && !info.painted && !info.imgSrc) throw new Error('aucun fond de table rendu');
    if (!info.covers) throw new Error('le fond ne couvre pas les panneaux de siège');
    // Aucun asset tiers dans le décor lui-même : il est dessiné, pas téléchargé.
    // (Les playmats de siège, eux, sont des images fournies par les joueurs.)
    if (info.imgSrc && !info.imgSrc.startsWith('/') && !info.imgSrc.startsWith('data:')) {
      throw new Error(`le fond charge une image d'un tiers : ${info.imgSrc}`);
    }
    if (info.hasSvg && info.markup < 400) throw new Error('le décor dessiné est suspicieusement vide');
  });

  // ------------------------------------------- panneau latéral des zones

  await step('le panneau des zones s’ouvre sur la pile cliquée', async () => {
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
    (await seatZone('GRAVEYARD')).click();
    const panel = page.locator('[data-test="zone-panel"]');
    await panel.waitFor({ timeout: 5000 });
    // Il reste ouvert, et la table reste jouable : au milieu de l'écran, c'est
    // bien la table qu'on touche, pas un voile.
    const reachable = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth * 0.4, window.innerHeight / 2);
      return Boolean(el?.closest('.table-surface'));
    });
    if (!reachable) throw new Error('le panneau se comporte comme une modale : la table est inatteignable');
    // La barre d'actions et le panneau joueur doivent rester atteignables.
    for (const name of ['Tout dégager', 'Piocher']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      const panelBox = await panel.boundingBox();
      if (box.x + box.width > panelBox.x) {
        throw new Error(`le bouton « ${name} » passe sous le panneau des zones`);
      }
      await page.getByRole('button', { name, exact: true }).click({ timeout: 4000 });
      await page.waitForTimeout(150);
    }
    const shelf = await page.locator('[data-test="token-shelf"]').boundingBox();
    if (shelf) {
      const panelBox = await panel.boundingBox();
      if (shelf.x + shelf.width > panelBox.x + 1) {
        throw new Error('l’étagère à jetons passe sous le panneau des zones');
      }
    }

    const tabs = await page.locator('[data-test="zone-tab"]').allTextContents();
    for (const label of ['Cimetière', 'Exil', 'Commandement', 'Bibliothèque', 'Réserve']) {
      if (!tabs.some((t) => t.startsWith(label))) throw new Error(`onglet manquant : ${label}`);
    }
    await page.screenshot({ path: `${OUT}/ui-18-panneau-zones.png` });
  });

  await step('aucun bouton d’action sous les cartes du panneau', async () => {
    await page.locator('[data-zone-tab="GRAVEYARD"]').click();
    await page.waitForTimeout(200);
    /*
     * « Bouton d'**action** », et la nuance compte : ce pas garde le panneau
     * libre des raccourcis qui doublonneraient le menu contextuel. La pastille
     * de mécaniques en est un `<button>` aussi, mais elle n'agit pas sur la
     * carte — elle ouvre un panneau de lecture, exactement comme sur la table,
     * et elle mérite d'être là. Elle est donc exclue nommément, ce qui laisse
     * le pas échouer sur n'importe quel bouton qu'on ajouterait sans y penser.
     *
     * Sans cette exclusion le pas échouait par intermittence : la pastille
     * n'apparaît que si la carte tombée au cimetière porte un mot-clé.
     */
    const buttons = await page
      .locator('[data-test="zone-card"] button:not([data-test="card-keywords"])')
      .count();
    if (buttons > 0) throw new Error(`${buttons} bouton(s) sous les cartes du panneau`);
  });

  await step('la recherche filtre le contenu affiché', async () => {
    // On garnit le cimetière de deux cartes de noms différents.
    await page.evaluate(() => {
      const s = window.__mtg.getState();
      for (const card of [...s.cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').slice(0, 3)) {
        s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: s.mySeat, kind: 'GRAVEYARD' } });
      }
    });
    await page.waitForTimeout(1200);
    await page.locator('[data-zone-tab="GRAVEYARD"]').click();
    const all = await page.locator('[data-test="zone-card"]').count();
    if (all < 2) throw new Error(`cimetière trop petit pour filtrer (${all})`);

    const firstName = await page.locator('[data-test="zone-card"] p').first().textContent();
    await page.locator('[data-test="zone-search"]').fill(firstName.slice(0, 5));
    await page.waitForTimeout(300);
    const filtered = await page.locator('[data-test="zone-card"]').count();
    if (filtered === 0) throw new Error('le filtre ne montre plus rien');
    if (filtered > all) throw new Error('le filtre a augmenté le nombre de cartes');
    await page.locator('[data-test="zone-search"]').fill('zzzzzzzz');
    await page.waitForTimeout(300);
    if ((await page.locator('[data-test="zone-card"]').count()) !== 0) {
      throw new Error('un filtre sans correspondance montre encore des cartes');
    }
    await page.locator('[data-test="zone-search"]').fill('');
    await page.waitForTimeout(300);

    /*
     * Et le vrai piège : chercher un nom **français qui diverge de l'anglais**.
     *
     * Ce qui précède tape les cinq premiers caractères du nom affiché, et
     * passait donc par accident sur « Plaine » / « Plains », qui partagent leur
     * préfixe. La régression qu'on vient de réparer — la recherche filtrait sur
     * le nom du catalogue tout en affichant le nom localisé, si bien que taper
     * « Anneau » ne trouvait rien — serait passée sous ce filet.
     *
     * On cherche donc une carte dont le nom affiché **diffère** de son nom de
     * catalogue, et l'on tape son nom affiché en entier.
     */
    const catalogueDe = async (ids) =>
      page.evaluate(async (objets) => {
        const scryfall = objets.map((id) => window.__mtg.getState().cards.get(id)?.scryfallId);
        const reponse = await fetch('/api/cards/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ids: scryfall.filter(Boolean) }),
        });
        if (!reponse.ok) return null;
        const { cards } = await reponse.json();
        const par = new Map(cards.map((c) => [c.scryfallId, c.name]));
        return scryfall.map((id) => par.get(id) ?? null);
      }, ids);

    /** Les cartes du panneau : identifiant, nom affiché, nom de catalogue. */
    const inventaire = async () => {
      const vues = await page.evaluate(() =>
        [...document.querySelectorAll('[data-test="zone-card"]')].map((el) => ({
          id: el.getAttribute('data-card-in-zone'),
          affiche: el.querySelector('p')?.textContent?.trim() ?? '',
        })),
      );
      const noms = await catalogueDe(vues.map((v) => v.id));
      if (!noms) throw new Error('le catalogue n’a pas répondu : divergence invérifiable');
      return vues.map((v, i) => ({ ...v, catalogue: noms[i] }));
    };

    /*
     * On préfère la divergence la plus franche — « Anneau solaire » contre
     * « Sol Ring » — à celle qui partage son préfixe — « Plaine » contre
     * « Plains ». Les deux sont valables ici, puisqu'on tape le nom **entier**
     * et que « Plaine » ne se trouve pas dans « Plains » ; mais la première dit
     * plus clairement ce que l'étape éprouve quand on lit le rapport.
     */
    const choisir = (liste) => {
      const candidates = liste.filter((c) => c.catalogue && c.affiche && c.affiche !== c.catalogue);
      return (
        candidates.find(
          (c) => c.affiche.slice(0, 5).toLowerCase() !== c.catalogue.slice(0, 5).toLowerCase(),
        ) ?? candidates[0]
      );
    };

    let divergente = choisir(await inventaire());
    if (!divergente) {
      // Le cimetière n'a tiré que des noms identiques dans les deux langues :
      // on y verse quelques cartes de plus plutôt que de laisser passer.
      await page.evaluate(() => {
        const s = window.__mtg.getState();
        const cardIds = [...s.cards.values()]
          .filter((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat)
          .slice(0, 4)
          .map((c) => c.id);
        if (cardIds.length > 0) {
          s.send({ type: 'MOVE_CARDS', cardIds, to: { seat: s.mySeat, kind: 'GRAVEYARD' } });
        }
      });
      await page.waitForTimeout(1200);
      divergente = choisir(await inventaire());
    }
    if (!divergente) {
      throw new Error(
        'aucune carte au nom localisé divergent dans le cimetière : ' +
          'la recherche sur le nom affiché n’est pas éprouvée',
      );
    }

    await page.locator('[data-test="zone-search"]').fill(divergente.affiche);
    await page.waitForTimeout(400);
    const trouvees = await page.evaluate(() =>
      [...document.querySelectorAll('[data-test="zone-card"]')].map((el) =>
        el.getAttribute('data-card-in-zone'),
      ),
    );
    if (!trouvees.includes(divergente.id)) {
      throw new Error(
        `« ${divergente.affiche} » (catalogue : « ${divergente.catalogue} ») est affiché ` +
          'mais introuvable : la recherche ne filtre pas sur le nom montré au joueur',
      );
    }
    console.log(
      `      « ${divergente.affiche} » trouvée par son nom affiché, ` +
        `qui diverge du catalogue (« ${divergente.catalogue} »)`,
    );
    await page.locator('[data-test="zone-search"]').fill('');
    await page.waitForTimeout(300);
  });

  await step('sélection multiple dans le cimetière : clic, Ctrl, Maj', async () => {
    const cards = page.locator('[data-test="zone-card"]');
    const total = await cards.count();
    if (total < 3) throw new Error(`il faut au moins 3 cartes (il y en a ${total})`);

    await cards.nth(0).click();
    await page.waitForTimeout(150);
    if ((await state()).selection !== 1) throw new Error('un clic ne sélectionne pas une carte');

    await cards.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);
    if ((await state()).selection !== 2) throw new Error('Ctrl+clic n’ajoute pas à la sélection');

    await cards.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);
    if ((await state()).selection !== 1) throw new Error('Ctrl+clic ne retire pas de la sélection');

    // Repart d'une sélection nette, puis une plage du premier au troisième.
    await cards.nth(0).click();
    await page.waitForTimeout(150);
    await cards.nth(2).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);
    const ranged = (await state()).selection;
    if (ranged !== 3) throw new Error(`Maj+clic : ${ranged} carte(s) au lieu de 3`);
  });

  await step('le menu contextuel agit sur toute la sélection, en un MOVE_CARDS', async () => {
    const before = await page.evaluate(() => {
      const s = window.__mtg.getState();
      return {
        selection: [...s.selection],
        seq: s.seq,
        exile: [...s.cards.values()].filter((c) => c.zone.kind === 'EXILE').length,
      };
    });
    // On observe ce que le client **envoie** : c'est là qu'est l'exigence.
    // Le nombre d'events produits, lui, appartient au serveur.
    await page.evaluate(() => {
      const original = window.__mtg.getState().send;
      window.__sent = [];
      window.__restoreSend = () => window.__mtg.setState({ send: original });
      window.__mtg.setState({
        send: (intent) => {
          window.__sent.push(intent.type);
          return original(intent);
        },
      });
    });
    await page.locator('[data-test="zone-card"]').nth(0).click({ button: 'right' });
    await page
      .locator('div.fixed.z-50.w-60 button')
      .filter({ hasText: /^Exiler/ })
      .first()
      .click({ timeout: 5000 });

    await page
      .waitForFunction(
        (ids) => ids.every((id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'EXILE'),
        before.selection,
        { timeout: 10000 },
      )
      .catch(async () => {
        const diag = await page.evaluate((ids) => {
          const s = window.__mtg.getState();
          return {
            reject: s.lastReject,
            zones: ids.map((id) => s.cards.get(id)?.zone.kind ?? 'disparue'),
          };
        }, before.selection);
        throw new Error(`déplacement groupé sans effet : ${JSON.stringify(diag)}`);
      });
    const sent = await page.evaluate(() => {
      window.__restoreSend?.();
      return window.__sent ?? [];
    });
    const after = await page.evaluate(() => window.__mtg.getState().seq);
    console.log(
      `      ${before.selection.length} cartes exilées · intents envoyés : ${sent.join(', ') || 'aucun'} ` +
        `· ${after - before.seq} event(s) reçus`,
    );
    if (!sent.includes('MOVE_CARDS')) {
      throw new Error(`déplacement groupé sans MOVE_CARDS (envoyé : ${sent.join(', ')})`);
    }
    if (sent.filter((t) => t === 'MOVE_CARD').length > 0) {
      throw new Error('des MOVE_CARD unitaires ont été envoyés en plus du MOVE_CARDS');
    }
  });

  await step('on tire une carte du panneau vers la table', async () => {
    await page.locator('[data-zone-tab="EXILE"]').click();
    await page.waitForTimeout(300);
    const card = page.locator('[data-test="zone-card"]').first();
    const id = await card.getAttribute('data-card-in-zone');
    await dragTo(card, await seatZone('BATTLEFIELD'), { x: -60, y: 60 });
    await page.waitForFunction(
      (cid) => window.__mtg.getState().cards.get(cid)?.zone.kind === 'BATTLEFIELD',
      id,
      { timeout: 10000 },
    );
  });

  await step('l’onglet Bibliothèque n’affiche rien et annonce la consultation', async () => {
    await page.locator('[data-zone-tab="LIBRARY"]').click();
    await page.waitForTimeout(300);
    if ((await page.locator('[data-test="zone-card"]').count()) !== 0) {
      throw new Error('l’onglet Bibliothèque montre des cartes : le client ne les a pas');
    }
    await page.getByText(/les autres joueurs en sont informés/i).waitFor({ timeout: 5000 });

    const logBefore = await page.evaluate(() => window.__mtg.getState().log.length);
    await page.locator('[data-test="library-search"]').click();
    // `library-search` ouvre la **fouille**, que la modale titre « Fouille de la
    // bibliothèque » : le texte « Consultation — » appartient au scry, et
    // n'apparaîtra jamais ici. On assure sur le nœud de la modale, pas sur son
    // libellé — un chantier de traduction est en cours.
    await page.locator('[data-test="look-modal"]').waitFor({ timeout: 10000 });
    // La fouille est annoncée : une ligne de journal, publique.
    const announced = await page.evaluate(
      (n) => window.__mtg.getState().log.slice(n).map((l) => l.text).join(' | '),
      logBefore,
    );
    if (!/biblioth/i.test(announced)) {
      throw new Error(`la fouille n'a rien annoncé au journal : « ${announced} »`);
    }
    console.log(`      annoncé au journal : « ${announced.slice(0, 80)} »`);
    await page.screenshot({ path: `${OUT}/ui-19-bibliotheque.png` });
    await page.locator('[data-test="look-submit"]').click();
    await page.waitForTimeout(600);
    await page.locator('[data-test="zone-panel-close"]').click();
  });

  // ------------------------------- engagement, dégagement et retournements

  await step('double-clic sur un permanent : engage puis dégage', async () => {
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
    await refillHand(2);
    await dragTo(
      page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first(),
      await seatZone('BATTLEFIELD'),
      { x: 0, y: -60 },
    );
    const id = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD')?.id,
    );
    const sprite = page.locator(`[data-card="${id}"]`);
    // On part d'une carte dégagée, pour que le premier double-clic engage.
    await page.evaluate((c) => window.__mtg.getState().send({ type: 'UNTAP', cardIds: [c] }), id);
    await page.waitForFunction((c) => window.__mtg.getState().cards.get(c)?.tapped === false, id, {
      timeout: 8000,
    });

    await sprite.dblclick();
    await page.waitForFunction((c) => window.__mtg.getState().cards.get(c)?.tapped === true, id, {
      timeout: 8000,
    });
    // Et la rotation suit vraiment dans le DOM. La transition dure 120 ms :
    // mesurer avant la fin ne donnerait qu'une matrice intermédiaire.
    await page.waitForTimeout(300);
    const rotated = await sprite.evaluate((el) => getComputedStyle(el).transform);
    if (rotated === 'none' || rotated.startsWith('matrix(1, 0, 0, 1')) {
      const diag = await page.evaluate((c) => {
        const card = window.__mtg.getState().cards.get(c);
        const nodes = [...document.querySelectorAll(`[data-card="${c}"]`)].map(
          (el) => getComputedStyle(el).transform,
        );
        return { tapped: card?.tapped, rotation: card?.rotation, zone: card?.zone.kind, nodes };
      }, id);
      throw new Error(`la carte engagée n'est pas pivotée : ${rotated} — ${JSON.stringify(diag)}`);
    }
    await sprite.dblclick();
    await page.waitForFunction((c) => window.__mtg.getState().cards.get(c)?.tapped === false, id, {
      timeout: 8000,
    });
  });

  await step('engagement groupé : une sélection mi-engagée s’engage entièrement', async () => {
    const ids = await page.evaluate(() => {
      const s = window.__mtg.getState();
      const bf = [...s.cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').slice(0, 2);
      if (bf.length < 2) return null;
      // On en engage une seule, puis on sélectionne les deux.
      s.send({ type: 'TAP', cardIds: [bf[0].id] });
      return bf.map((c) => c.id);
    });
    if (!ids) throw new Error('pas assez de permanents');
    await page.waitForTimeout(800);
    await page.evaluate((list) => window.__mtg.getState().setSelection(new Set(list)), ids);
    await unhover();
    await page.keyboard.press('t');
    await page.waitForFunction(
      (list) => list.every((id) => window.__mtg.getState().cards.get(id)?.tapped === true),
      ids,
      { timeout: 8000 },
    );
    // Second appui : tout est engagé, donc tout se dégage.
    await page.keyboard.press('t');
    await page.waitForFunction(
      (list) => list.every((id) => window.__mtg.getState().cards.get(id)?.tapped === false),
      ids,
      { timeout: 8000 },
    );
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
  });

  await step('une recto-verso se transforme, et l’image suit', async () => {
    const dfc = await findDoubleFaced();
    if (!dfc) throw new Error('aucune carte recto-verso trouvée dans la partie');
    await page.evaluate((id) => {
      const s = window.__mtg.getState();
      s.send({ type: 'MOVE_CARD', cardId: id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 400, y: 40 });
    }, dfc);
    await page.waitForFunction(
      (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD',
      dfc,
      { timeout: 10000 },
    );
    const srcOf = () =>
      page.locator(`[data-card="${dfc}"] img`).getAttribute('src');
    const front = await srcOf();
    if (!front?.includes('/front/')) throw new Error(`face avant inattendue : ${front}`);

    await page.locator(`[data-card="${dfc}"]`).click({ button: 'right' });
    await page
      .locator('div.fixed.z-50.w-60 button')
      .filter({ hasText: /^Transformer/ })
      .first()
      .click({ timeout: 5000 });
    await page.waitForFunction((id) => window.__mtg.getState().cards.get(id)?.flipped === true, dfc, {
      timeout: 8000,
    });
    const back = await srcOf();
    if (!back?.includes('/back/')) throw new Error(`l'image ne suit pas la transformation : ${back}`);
    console.log(`      face arrière servie : ${back.replace('https://cards.scryfall.io/', '')}`);
    await page.screenshot({ path: `${OUT}/ui-20-transformee.png` });
  });

  await step('retourner face cachée est proposé, et le serveur l’applique', async () => {
    const id = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD')?.id,
    );
    await page.locator(`[data-card="${id}"]`).click({ button: 'right' });
    // Une seule entrée, qui bascule : le libellé dit ce que fera le clic, et
    // c'est `facedownOnTable` qui le décide — pas `faceDown`, qui vaut toujours
    // `false` pour le propriétaire d'une carte qu'il a lui-même retournée.
    const labels = await page.locator('div.fixed.z-50.w-60 button').allTextContents();
    if (!labels.some((l) => l.startsWith('Retourner face cachée'))) {
      throw new Error(`entrée manquante : Retourner face cachée — ${JSON.stringify(labels)}`);
    }
    if (labels.some((l) => l.startsWith('Retourner face visible'))) {
      throw new Error('les deux sens sont proposés à la fois sur une carte visible');
    }
    const logBefore = await page.evaluate(() => window.__mtg.getState().log.length);
    await page
      .locator('div.fixed.z-50.w-60 button')
      .filter({ hasText: /^Retourner face cachée/ })
      .first()
      .click();
    await page.waitForFunction((n) => window.__mtg.getState().log.length > n, logBefore, { timeout: 8000 });
    const line = await page.evaluate(
      (n) => window.__mtg.getState().log.slice(n).map((l) => l.text).join(' | '),
      logBefore,
    );
    console.log(`      journal : « ${line.slice(0, 90)} »`);
    if (!/face cach/i.test(line)) throw new Error(`le serveur n'a pas retourné la carte : ${line}`);
    // Retournée, la même entrée doit proposer l'inverse.
    await page.locator(`[data-card="${id}"]`).click({ button: 'right' });
    const after = await page.locator('div.fixed.z-50.w-60 button').allTextContents();
    if (!after.some((l) => l.startsWith('Retourner face visible'))) {
      throw new Error(`la bascule ne s'inverse pas : ${JSON.stringify(after)}`);
    }
    await fermerMenu();
    await page.evaluate((card) => window.__mtg.getState().send({ type: 'TURN_FACE_UP', cardId: card }), id);
    await page.waitForTimeout(500);
  });

  // ------------------------------------- retour visuel du lasso, en direct

  await step('les cartes tenues par le lasso se marquent pendant le tracé', async () => {
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
    await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
    await page.waitForTimeout(300);

    const cards = await page.locator('[data-card-id]').all();
    if (cards.length < 2) throw new Error('pas assez de permanents pour éprouver le lasso');
    const boxes = [];
    for (const card of cards) {
      const box = await card.boundingBox();
      if (box) boxes.push(box);
    }
    const pad = 26;
    const left = Math.min(...boxes.map((b) => b.x)) - pad;
    const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    const top = Math.min(...boxes.map((b) => b.y)) - pad;
    const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;

    const corner = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
    let startIdx = 0;
    while (
      startIdx < corner.length &&
      !(await page.evaluate(
        ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.table-surface')),
        [corner[startIdx].x, corner[startIdx].y],
      ))
    ) {
      startIdx += 1;
    }
    if (startIdx === corner.length) throw new Error('aucun coin du lasso ne tombe sur la table');
    const loop = [...corner.slice(startIdx), ...corner.slice(0, startIdx), corner[startIdx]];

    await page.evaluate(() => {
      window.__mtgTableRenders = 0;
    });

    await page.keyboard.down('Shift');
    await page.mouse.move(loop[0].x, loop[0].y);
    await page.mouse.down();

    let maxMarked = 0;
    let sawPolygon = false;
    for (let c = 1; c < loop.length; c++) {
      const from = loop[c - 1];
      const to = loop[c];
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
        const live = await page.evaluate(() => {
          const svg = document.querySelector('[data-test="lasso"]');
          const pts = svg?.querySelector('polygon')?.getAttribute('points') ?? '';
          return {
            marked: document.querySelectorAll('.lasso-hit').length,
            visible: svg ? getComputedStyle(svg).display !== 'none' : false,
            points: pts.split(' ').filter(Boolean).length,
            selection: window.__mtg.getState().selection.size,
          };
        });
        if (live.visible && live.points > 2) sawPolygon = true;
        maxMarked = Math.max(maxMarked, live.marked);
        // Le marquage est provisoire : la sélection du store ne bouge pas encore.
        if (live.selection !== 0) throw new Error('la sélection est écrite avant la fin du tracé');
      }
    }
    if (maxMarked === 0) throw new Error('aucune carte marquée pendant le tracé');
    if (!sawPolygon) throw new Error('le tracé du lasso n’est pas dessiné');
    await page.screenshot({ path: `${OUT}/ui-22-lasso-en-cours.png` });

    const rendersDuring = await page.evaluate(() => window.__mtgTableRenders ?? -1);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    console.log(
      `      lasso : jusqu'à ${maxMarked} carte(s) marquée(s) en direct, ${rendersDuring} rendu(s) du plan`,
    );
    if (rendersDuring > 2) {
      throw new Error(`${rendersDuring} rendus du plan pendant le tracé du lasso`);
    }
    const finalSelection = (await state()).selection;
    if (finalSelection < maxMarked) {
      throw new Error(`la sélection finale (${finalSelection}) est plus pauvre que l'aperçu (${maxMarked})`);
    }
    // Et le marquage provisoire disparaît une fois le geste terminé.
    const leftovers = await page.evaluate(() => document.querySelectorAll('.lasso-hit').length);
    if (leftovers !== 0) throw new Error(`${leftovers} marquage(s) provisoire(s) oublié(s)`);
  });

  await step('double-clic sur une carte de la sélection bascule tout le groupe', async () => {
    const ids = await page.evaluate(() => [...window.__mtg.getState().selection]);
    if (ids.length < 2) throw new Error('il faut au moins deux cartes sélectionnées');

    // On en engage une seule : le groupe n'est pas homogène.
    await page.evaluate((list) => window.__mtg.getState().send({ type: 'UNTAP', cardIds: list }), ids);
    await page.waitForTimeout(600);
    await page.evaluate((list) => window.__mtg.getState().send({ type: 'TAP', cardIds: [list[0]] }), ids);
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      const original = window.__mtg.getState().send;
      window.__sent = [];
      window.__restoreSend = () => window.__mtg.setState({ send: original });
      window.__mtg.setState({
        send: (intent) => {
          window.__sent.push(intent.type);
          return original(intent);
        },
      });
    });

    // Double-clic sur une carte du groupe : tout doit s'engager.
    await page.locator(`[data-card="${ids[1]}"]`).dblclick();
    await page.waitForFunction(
      (list) => list.every((id) => window.__mtg.getState().cards.get(id)?.tapped === true),
      ids,
      { timeout: 8000 },
    );
    const sent = await page.evaluate(() => {
      window.__restoreSend?.();
      return window.__sent ?? [];
    });
    // Les curseurs ne sont pas des actions : ils ont leur propre throttle et
    // ne consomment aucun quota (§7). Un `CURSOR` glissé pendant le geste ne
    // dit rien de l'économie d'intents que l'on mesure ici.
    const actions = sent.filter((type) => type !== 'CURSOR');
    console.log(`      double-clic groupé : intents ${sent.join(', ')}`);
    if (actions.length !== 1 || actions[0] !== 'TAP') {
      throw new Error(`un seul TAP attendu, reçu : ${actions.join(', ')}`);
    }

    // Second double-clic : tout est engagé, donc tout se dégage.
    await page.locator(`[data-card="${ids[1]}"]`).dblclick();
    await page.waitForFunction(
      (list) => list.every((id) => window.__mtg.getState().cards.get(id)?.tapped === false),
      ids,
      { timeout: 8000 },
    );

    // Hors sélection, le double-clic ne touche qu'à la carte cliquée.
    const outsider = await page.evaluate((list) => {
      const s = window.__mtg.getState();
      const card = [...s.cards.values()].find(
        (c) => c.zone.kind === 'BATTLEFIELD' && !list.includes(c.id),
      );
      return card?.id ?? null;
    }, ids);
    if (outsider) {
      await page.locator(`[data-card="${outsider}"]`).dblclick();
      await page.waitForFunction((id) => window.__mtg.getState().cards.get(id)?.tapped === true, outsider, {
        timeout: 8000,
      });
      const groupStillUntapped = await page.evaluate(
        (list) => list.every((id) => window.__mtg.getState().cards.get(id)?.tapped === false),
        ids,
      );
      if (!groupStillUntapped) throw new Error('un double-clic hors sélection a engagé le groupe');
    }
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
  });

  // ------------------------------------------------- menu du fond de table

  await step('clic droit sur le fond : un menu, et il utilise le point cliqué', async () => {
    const spot = await emptySpot();
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    const menu = page.locator('[data-test="table-menu"]');
    await menu.waitFor({ timeout: 5000 });
    const labels = await menu.locator('button').allTextContents();
    for (const wanted of ['Créer un jeton…', 'Poser une étiquette ici…', 'Piocher une carte', 'Tout dégager']) {
      if (!labels.includes(wanted)) throw new Error(`entrée manquante : ${wanted} (vu : ${labels.join(', ')})`);
    }
    await page.screenshot({ path: `${OUT}/ui-23-menu-fond.png` });

    // L'étiquette se pose au point cliqué, en coordonnées de monde.
    const expected = await page.evaluate(
      ([x, y]) => {
        const surface = document.querySelector('.table-surface');
        const plane = surface.firstElementChild;
        const m = new DOMMatrix(getComputedStyle(plane).transform).inverse();
        const r = surface.getBoundingClientRect();
        const p = m.transformPoint(new DOMPoint(x - r.left, y - r.top));
        return { x: Math.round(p.x), y: Math.round(p.y) };
      },
      [spot.x, spot.y],
    );
    // La saisie se fait désormais dans le menu lui-même, et non dans une
    // modale native : deux clics et une frappe, sans quitter la table.
    await menu.getByText('Poser une étiquette ici…').click();
    await page.locator('[data-test="table-menu-input"]').fill('repère');
    await page.locator('[data-test="table-menu-input"]').press('Enter');
    await page.waitForFunction(() => window.__mtg.getState().labels.length > 0, null, { timeout: 8000 });
    const label = await page.evaluate(() => {
      const l = window.__mtg.getState().labels;
      return l[l.length - 1];
    });
    const off = Math.hypot(label.x - expected.x, label.y - expected.y);
    console.log(`      étiquette posée à ${label.x},${label.y} pour un clic à ${expected.x},${expected.y}`);
    if (off > 6) throw new Error(`l'étiquette est à ${Math.round(off)} px du point cliqué`);
  });

  await step('le clic droit sur une carte ouvre toujours le menu de la carte', async () => {
    await page.locator('[data-card-id] img[src*="scryfall"]').first().click({ button: 'right' });
    await page.getByText('Ajouter un marqueur +1/+1').waitFor({ timeout: 5000 });
    if ((await page.locator('[data-test="table-menu"]').count()) !== 0) {
      throw new Error('le menu du fond s’est ouvert par-dessus celui de la carte');
    }
    await fermerMenu();

    // Et sur une pile, celui de la pile.
    (await seatZone('LIBRARY')).click({ button: 'right' });
    await page.getByText('Chercher dans la bibliothèque').waitFor({ timeout: 5000 });
    if ((await page.locator('[data-test="table-menu"]').count()) !== 0) {
      throw new Error('le menu du fond s’est ouvert par-dessus celui de la pile');
    }
    /*
     * C'est **ici** que naissait le désordre de toute la recette.
     *
     * L'étape pressait Échap et passait à la suite sans jamais s'assurer que le
     * menu s'était refermé. Quand il restait — et il restait parfois — son
     * voile plein écran avalait les clics des dix étapes suivantes, qui
     * tombaient sur des délais de trente secondes en désignant du code sain.
     * D'où trois exécutions du même code à 7, 8 puis 9 échecs.
     */
    await fermerMenu();
  });

  await step('un jeton créé depuis le menu du fond naît au point cliqué', async () => {
    const spot = await emptySpot();
    const local = await page.evaluate(
      ([x, y]) => {
        const el = document
          .elementsFromPoint(x, y)
          .map((n) => n.closest('[data-zone$="|BATTLEFIELD"]'))
          .find(Boolean);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const plane = document.querySelector('.table-surface').firstElementChild;
        const scale = new DOMMatrix(getComputedStyle(plane).transform).a;
        return { x: Math.round((x - r.left) / scale - 41), y: Math.round((y - r.top) / scale - 57) };
      },
      [spot.x, spot.y],
    );
    if (!local) throw new Error('le point vide n’est pas sur un champ de bataille');

    const before = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length,
    );
    await page.mouse.click(spot.x, spot.y, { button: 'right' });
    await page.locator('[data-test="table-menu"]').getByText('Créer un jeton…').click();
    await page.getByPlaceholder(/jeton/i).first().fill('Treasure');
    await page.waitForTimeout(1200);
    // Dans la fenêtre de recherche, et nulle part ailleurs : la table porte
    // elle aussi des boutons contenant une image Scryfall (les piles), et le
    // premier de la page était l'un d'eux — sous la modale, donc incliquable.
    await page
      .locator('div.fixed.z-40 button:has(img[src*="scryfall"])')
      .first()
      .click({ timeout: 15000 });
    await page.waitForFunction(
      (n) => [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').length > n,
      before,
      { timeout: 15000 },
    );
    const token = await page.evaluate(() => {
      const list = [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN');
      return list[list.length - 1];
    });
    const off = Math.hypot(token.x - local.x, token.y - local.y);
    console.log(`      jeton créé en ${token.x},${token.y} pour un clic en ${local.x},${local.y}`);
    if (off > 8) throw new Error(`le jeton est à ${Math.round(off)} px du point cliqué`);
  });

  // ------------------------------- taxe et dégâts de commandant, réglables

  await step('la taxe de commandant est affichée à zéro et réglable', async () => {
    const line = page.locator('[data-test="tax-value"]').first();
    await line.waitFor({ timeout: 5000 });
    const shown = await line.textContent();
    console.log(`      taxe affichée : ${shown}`);
    const before = await page.evaluate(() => Object.values(window.__mtg.getState().seats
      .find((s) => s.id === window.__mtg.getState().mySeat).commanderTax)[0] ?? 0);
    await page.locator('[data-test="tax-plus"]').first().click();
    await page.waitForFunction(
      (n) => {
        const s = window.__mtg.getState();
        const tax = s.seats.find((x) => x.id === s.mySeat).commanderTax;
        return (Object.values(tax)[0] ?? 0) === n + 1;
      },
      before,
      { timeout: 8000 },
    );
    const after = await line.textContent();
    if (after === shown) throw new Error('le surcoût affiché n’a pas suivi');
    console.log(`      après +1 : ${after}`);
    await page.locator('[data-test="tax-minus"]').first().click();
    await page.waitForFunction(
      (n) => {
        const s = window.__mtg.getState();
        const tax = s.seats.find((x) => x.id === s.mySeat).commanderTax;
        return (Object.values(tax)[0] ?? 0) === n;
      },
      before,
      { timeout: 8000 },
    );
  });

  // --------------------------------------------- repère commun et curseurs

  // ------------------------------------------- attachements, étiquettes, main

  /** Pose `count` cartes de la main sur le champ, espacées horizontalement. */
  async function playFromHand(count, spacing = 150) {
    const placed = [];
    for (let i = 0; i < count; i++) {
      /*
       * La main peut être vide : une centaine d'étapes l'ont précédée, dont des
       * mulligans, des défausses au hasard et des mises au cimetière. Ce
       * helper doit garantir sa propre condition d'entrée, faute de quoi les
       * étapes qui en dépendent échouent sur « il faut deux permanents » — un
       * message qui accuse l'attachement alors que rien ne s'y joue.
       */
      const inHand = await page.evaluate(() => {
        const s = window.__mtg.getState();
        return [...s.cards.values()].filter(
          (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
        ).length;
      });
      if (inHand === 0) {
        await page.evaluate(() => window.__mtg.getState().send({ type: 'DRAW', count: 2 }));
        await page.waitForFunction(
          () => {
            const s = window.__mtg.getState();
            return [...s.cards.values()].some(
              (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
            );
          },
          null,
          { timeout: 8000 },
        );
        await page.waitForTimeout(300);
      }

      const before = new Set(
        await page.evaluate(() =>
          [...window.__mtg.getState().cards.values()]
            .filter((c) => c.zone.kind === 'BATTLEFIELD')
            .map((c) => c.id),
        ),
      );
      // Par `firstHandCard()` : le rail défile, et sa première carte peut être
      // hors de sa partie visible — Playwright attend alors une boîte qui ne
      // vient jamais.
      await dragTo(await firstHandCard(), await seatZone('BATTLEFIELD'), {
        x: -spacing + i * spacing * 2,
        y: 0,
      });
      const after = await page.evaluate(() =>
        [...window.__mtg.getState().cards.values()]
          .filter((c) => c.zone.kind === 'BATTLEFIELD')
          .map((c) => c.id),
      );
      const fresh = after.find((id) => !before.has(id));
      if (fresh) placed.push(fresh);
    }
    return placed;
  }

  /** Vide le champ de bataille, pour repartir d'une table propre. */
  async function clearBattlefield() {
    await page.evaluate(() => {
      const s = window.__mtg.getState();
      for (const card of [...s.cards.values()]) {
        if (card.zone.kind !== 'BATTLEFIELD') continue;
        s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: card.owner, kind: 'GRAVEYARD' } });
      }
      s.setSelection(new Set());
    });
    await page.waitForTimeout(800);
  }

  await step('attachement : le menu arme le geste, le clic sur la cible l’exécute', async () => {
    await clearBattlefield();
    await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
    await page.waitForTimeout(300);
    const [source, target] = await playFromHand(2);
    if (!source || !target) throw new Error('il faut deux permanents pour éprouver l’attachement');

    await page.locator(`[data-card="${source}"]`).click({ button: 'right' });
    const entry = page.locator('div.fixed.z-50.w-60 button').filter({ hasText: /^Attacher/ });
    if ((await entry.count()) === 0) throw new Error('aucune entrée d’attachement dans le menu');
    await entry.first().click();

    // 1. Une carte en attente d'attache doit le dire, et se signaler elle-même.
    await page.locator('[data-test="attach-pending"]').waitFor({ timeout: 4000 });
    const marked = await page.evaluate(
      (id) => document.querySelector(`[data-card-id="${id}"]`)?.style.outline ?? '',
      source,
    );
    if (!marked.includes('dashed')) throw new Error(`la source n’est pas signalée : « ${marked} »`);

    // 2. Un clic gauche sur une autre carte réalise l'attache.
    await page.locator(`[data-card="${target}"]`).click();
    await page.waitForFunction(
      ([s, t]) => window.__mtg.getState().cards.get(s)?.attachedTo === t,
      [source, target],
      { timeout: 8000 },
    );
    if ((await page.locator('[data-test="attach-pending"]').count()) !== 0) {
      throw new Error('l’indicateur d’attente survit à l’attache');
    }

    // 3. La carte attachée se rend sous sa cible, décalée.
    const rendered = await page.evaluate(
      ([s, t]) => {
        const box = (id) => {
          const el = document.querySelector(`[data-card-id="${id}"]`);
          return { left: parseFloat(el.style.left), top: parseFloat(el.style.top), z: Number(el.style.zIndex) };
        };
        return { source: box(s), target: box(t) };
      },
      [source, target],
    );
    const dx = rendered.source.left - rendered.target.left;
    const dy = rendered.source.top - rendered.target.top;
    if (dx <= 0 || dy <= 0 || dx > 80 || dy > 120) {
      throw new Error(`décalage inattendu : ${dx}×${dy}`);
    }
    if (!(rendered.source.z < rendered.target.z)) {
      throw new Error(`la carte attachée ne passe pas sous sa cible (${rendered.source.z} ≥ ${rendered.target.z})`);
    }
    console.log(`      attachée sous sa cible, décalée de ${dx}×${dy} px`);

    // 4. Elle suit sa cible quand celle-ci se déplace.
    const before = rendered.source.left;
    await dragTo(page.locator(`[data-card="${target}"]`), await seatZone('BATTLEFIELD'), { x: 260, y: -60 });
    const after = await page.evaluate(
      (id) => parseFloat(document.querySelector(`[data-card-id="${id}"]`).style.left),
      source,
    );
    if (Math.abs(after - before) < 20) throw new Error('la carte attachée ne suit pas sa cible');
    await page.screenshot({ path: `${OUT}/ui-22-attachement.png` });

    // 5. Tirer la carte attachée la détache : sans cela, son déplacement serait
    //    sans effet visible, puisque sa position dérive de celle de sa cible.
    //    On la saisit par son **bord inférieur gauche** : son centre est sous
    //    sa cible, et un appui au centre attraperait la cible.
    const attachedBox = await page.locator(`[data-card="${source}"]`).boundingBox();
    const grab = { x: attachedBox.x + 8, y: attachedBox.y + attachedBox.height - 8 };
    const zoneBox = await (await seatZone('BATTLEFIELD')).boundingBox();
    const drop = { x: zoneBox.x + zoneBox.width * 0.2, y: zoneBox.y + zoneBox.height * 0.8 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(grab.x + ((drop.x - grab.x) * i) / 8, grab.y + ((drop.y - grab.y) * i) / 8);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.waitForFunction((id) => !window.__mtg.getState().cards.get(id)?.attachedTo, source, {
      timeout: 8000,
    });
  });

  await step('attachement : Échap annule une attente, sans rien envoyer', async () => {
    const ids = await page.evaluate(() =>
      [...window.__mtg.getState().cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').map((c) => c.id),
    );
    if (ids.length < 2) throw new Error('il faut deux permanents');
    await page.evaluate(() => (window.__sentIntents.length = 0));
    await page.locator(`[data-card="${ids[0]}"]`).click({ button: 'right' });
    await page.locator('div.fixed.z-50.w-60 button').filter({ hasText: /^Attacher/ }).first().click();
    await page.locator('[data-test="attach-pending"]').waitFor({ timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if ((await page.locator('[data-test="attach-pending"]').count()) !== 0) {
      throw new Error('Échap n’annule pas l’attente');
    }
    // Un clic ordinaire sur une carte ne doit plus rien attacher.
    await page.locator(`[data-card="${ids[1]}"]`).click();
    await page.waitForTimeout(400);
    const sent = await page.evaluate(() => window.__sentIntents.filter((f) => f.includes('"ATTACH"')).length);
    if (sent !== 0) throw new Error(`${sent} ATTACH envoyé(s) malgré l’annulation`);
  });

  await step('déplacer une étiquette n’envoie que quelques intents par seconde', async () => {
    // On repart d'une table sans étiquette : deux étiquettes posées au même
    // endroit — et `emptySpot()` rend toujours le même point — rendaient la
    // mesure ambigue, on ne savait plus laquelle on avait saisie.
    await page.evaluate(() => {
      const s = window.__mtg.getState();
      for (const label of s.labels) s.send({ type: 'REMOVE_LABEL', labelId: label.id });
    });
    await page.waitForFunction(() => window.__mtg.getState().labels.length === 0, null, { timeout: 8000 });

    // Une étiquette posée a un endroit libre du champ de bataille.
    const zone = await (await seatZone('BATTLEFIELD')).boundingBox();
    await page.mouse.click(zone.x + zone.width * 0.5, zone.y + zone.height * 0.9, { button: 'right' });
    await page
      .locator('[data-test="table-menu"] button')
      .filter({ hasText: 'Poser une étiquette' })
      .click();
    await page.locator('[data-test="table-menu-input"]').fill('témoin');
    await page.locator('[data-test="table-menu-input"]').press('Enter');
    await page.waitForFunction(() => window.__mtg.getState().labels.length === 1, null, { timeout: 8000 });
    const labelId = await page.evaluate(() => window.__mtg.getState().labels[0].id);
    const box = await page.locator(`[data-label="${labelId}"]`).boundingBox();

    await page.evaluate(() => (window.__sentIntents.length = 0));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const started = Date.now();
    for (let i = 1; i <= 50; i++) {
      await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 - i * 2);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    const seconds = (Date.now() - started) / 1000;
    await page.waitForTimeout(500);

    const moves = await page.evaluate(() => window.__sentIntents.filter((f) => f.includes('MOVE_LABEL')).length);
    const trace = await page.evaluate((id) => {
      const s = window.__mtg.getState();
      const label = s.labels.find((l) => l.id === id);
      return { label: label ? { x: label.x, y: label.y } : null, reject: s.lastReject, count: s.labels.length };
    }, labelId);
    const rate = moves / seconds;
    console.log(`      ${moves} MOVE_LABEL en ${seconds.toFixed(2)} s, soit ${rate.toFixed(1)}/s`);
    // Le serveur tolère 20 intents/s en soutenu : un geste continu doit rester
    // très en deçà, et il doit en partir au moins un — celui du relâchement.
    if (rate > 12) throw new Error(`${rate.toFixed(1)} MOVE_LABEL/s : le quota reste menacé`);
    if (moves === 0) throw new Error('aucun MOVE_LABEL : le déplacement n’a pas été transmis');

    // Et la position finale est bien celle du serveur, pas un décalage local.
    const label = await page.evaluate((id) => window.__mtg.getState().labels.find((l) => l.id === id), labelId);
    const rendered = await page.locator(`[data-label="${labelId}"]`).boundingBox();
    if (Math.abs(rendered.x - box.x) < 20) {
      throw new Error(
        `l’étiquette n’a pas bougé à l’écran : état ${JSON.stringify(trace.label)}, ` +
          `refus « ${trace.reject ?? 'aucun'} », ${trace.count} étiquette(s), ` +
          `rendu ${Math.round(rendered.x)} contre ${Math.round(box.x)}`,
      );
    }
    if (!label) throw new Error('l’étiquette a disparu');
  });

  await step('une étiquette s’accroche à une carte, la suit, puis se décroche', async () => {
    const labelId = await page.evaluate(() => window.__mtg.getState().labels.at(-1).id);
    const target = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD')?.id,
    );
    if (!target) throw new Error('aucun permanent à annoter');

    await page.locator(`[data-label="${labelId}"]`).click({ button: 'right' });
    const menu = page.locator('[data-test="label-menu"] button');
    await menu.first().waitFor({ timeout: 4000 });
    const labels = await menu.allTextContents();
    if (!labels.some((l) => l.startsWith('Accrocher'))) {
      throw new Error(`pas d’accrochage dans le menu : ${JSON.stringify(labels)}`);
    }
    await menu.filter({ hasText: 'Accrocher' }).first().click();
    await page.locator('[data-test="attach-pending"]').waitFor({ timeout: 4000 });
    await page.locator(`[data-card="${target}"]`).click();
    await page.waitForFunction(
      ([id, card]) => window.__mtg.getState().labels.find((l) => l.id === id)?.attachedTo === card,
      [labelId, target],
      { timeout: 8000 },
    );

    // L'accrochage ne doit pas téléporter l'étiquette : ses x/y deviennent un
    // décalage relatif, et le client doit convertir.
    const anchored = await page.locator(`[data-label="${labelId}"]`).boundingBox();
    const cardBox = await page.locator(`[data-card="${target}"]`).boundingBox();
    await dragTo(page.locator(`[data-card="${target}"]`), await seatZone('BATTLEFIELD'), { x: -260, y: 90 });
    const moved = await page.locator(`[data-label="${labelId}"]`).boundingBox();
    const cardApres = await page.locator(`[data-card="${target}"]`).boundingBox();
    if (!moved || !cardApres) throw new Error('l’étiquette ou sa carte a disparu du cadre');

    /*
     * « Elle suit sa carte » veut dire : **le même déplacement**, pas « un
     * déplacement ».
     *
     * L'étape exigeait 20 px de mouvement sur le seul x, ce qui était une
     * approximation du vrai propos : avec le cadrage d'aujourd'hui, ce
     * `dragTo` dépose la carte à un x inchangé et ne bouge qu'en y —
     * l'étiquette la suivait au pixel près, et l'étape criait au défaut. On
     * compare donc les deux déplacements entre eux, et l'on refuse l'étape si
     * la carte, elle, n'a pas réellement bougé : un couple immobile n'a rien
     * prouvé.
     */
    const dCarte = { x: cardApres.x - cardBox.x, y: cardApres.y - cardBox.y };
    const dEtiquette = { x: moved.x - anchored.x, y: moved.y - anchored.y };
    const parcours = Math.hypot(dCarte.x, dCarte.y);
    if (parcours < 20) {
      throw new Error(
        `la carte n’a pas bougé (${Math.round(dCarte.x)},${Math.round(dCarte.y)}) : ` +
          'le suivi de l’étiquette n’est pas éprouvé',
      );
    }
    const decalage = Math.hypot(dEtiquette.x - dCarte.x, dEtiquette.y - dCarte.y);
    if (decalage > 2) {
      throw new Error(
        `l’étiquette accrochée ne suit pas sa carte : carte ${Math.round(dCarte.x)},${Math.round(dCarte.y)} ` +
          `contre étiquette ${Math.round(dEtiquette.x)},${Math.round(dEtiquette.y)}`,
      );
    }
    console.log(
      `      étiquette accrochée à ${Math.round(anchored.x - cardBox.x)} px de sa carte, ` +
        `et elle la suit : ${Math.round(dCarte.x)},${Math.round(dCarte.y)} à ${decalage.toFixed(1)} px près`,
    );
    await page.screenshot({ path: `${OUT}/ui-23-etiquette-accrochee.png` });

    /*
     * Décrochage : elle reste où elle est, mais redevient libre.
     *
     * On compare des positions **dans le plan de table** (`left`/`top` du
     * nœud) et non des rectangles d'écran. Un rectangle d'écran mêle la
     * position de l'étiquette et le cadrage de la caméra : n'importe quel
     * recalage de vue entre les deux mesures se lisait « l'étiquette a
     * sauté », et l'échec désignait alors un code parfaitement sain.
     */
    const planOf = () =>
      page.evaluate((id) => {
        const el = document.querySelector(`[data-label="${id}"]`);
        return { left: Number.parseFloat(el.style.left), top: Number.parseFloat(el.style.top) };
      }, labelId);
    const planAvant = await planOf();
    await page.locator(`[data-label="${labelId}"]`).click({ button: 'right' });
    await page.locator('[data-test="label-menu"] button').filter({ hasText: 'Décrocher' }).click();
    await page.waitForFunction(
      (id) => !window.__mtg.getState().labels.find((l) => l.id === id)?.attachedTo,
      labelId,
      { timeout: 8000 },
    );
    // La prise locale tient au plus 1,5 s après le dernier geste : on la laisse
    // se relâcher, sinon l'on mesure une main encore posée plutôt que l'état.
    await page.waitForTimeout(1800);
    const freed = await planOf();
    if (Math.hypot(freed.left - planAvant.left, freed.top - planAvant.top) > 4) {
      throw new Error(
        `l’étiquette a sauté en se décrochant : plan ${Math.round(planAvant.left)},${Math.round(planAvant.top)} ` +
          `puis ${Math.round(freed.left)},${Math.round(freed.top)}`,
      );
    }
    await page.evaluate(
      (id) => window.__mtg.getState().send({ type: 'REMOVE_LABEL', labelId: id }),
      labelId,
    );
  });

  await step('la main déborde : elle se resserre, puis défile à la molette', async () => {
    const rail = page.locator('[data-test="hand-rail"]');
    await rail.waitFor({ timeout: 4000 });
    // On remplit la main autant que la bibliothèque le permet : une pioche de
    // plus que ce qu'elle contient est refusée, et l'on mesurerait alors le
    // refus au lieu du débordement.
    const wanted = await page.evaluate(() => {
      const s = window.__mtg.getState();
      const hand = s.zoneCounts.get(s.mySeat + '|HAND') ?? 0;
      const library = s.zoneCounts.get(s.mySeat + '|LIBRARY') ?? 0;
      const draw = Math.min(library, Math.max(0, 20 - hand));
      if (draw > 0) s.send({ type: 'DRAW', count: draw });
      return hand + draw;
    });
    await page.waitForFunction(
      (n) => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|HAND') ?? 0) >= n,
      wanted,
      { timeout: 10000 },
    );
    await page.waitForTimeout(500);

    const rail1 = await page.evaluate(() => {
      const el = document.querySelector('[data-test="hand-rail"]');
      const r = el.getBoundingClientRect();
      return { cards: el.querySelectorAll('[data-card]').length, right: r.right, left: r.left, scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    const viewport = page.viewportSize();
    if (rail1.left < 0 || rail1.right > viewport.width + 1) {
      throw new Error(`le rail déborde de l’écran : ${Math.round(rail1.left)}…${Math.round(rail1.right)}`);
    }
    console.log(`      ${rail1.cards} cartes en main, rail de ${Math.round(rail1.clientW)} px`);

    // La molette sur le rail le fait défiler — et ne touche pas au zoom.
    const box = await rail.boundingBox();
    const zoomBefore = await page.evaluate(() => window.__mtg.getState().viewScale);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-test="hand-rail"]');
      return { scrollLeft: el.scrollLeft, scrollable: el.scrollWidth > el.clientWidth };
    });
    const zoomAfter = await page.evaluate(() => window.__mtg.getState().viewScale);
    if (zoomAfter !== zoomBefore) throw new Error('la molette sur la main a zoomé la table');
    if (after.scrollable && after.scrollLeft === 0) throw new Error('le rail ne défile pas à la molette');
    console.log(
      after.scrollable
        ? `      rail défilant : scrollLeft ${Math.round(after.scrollLeft)} px, zoom inchangé`
        : '      la main tient encore à l’écran après resserrement, zoom inchangé',
    );

    // La molette sur la table, elle, doit toujours zoomer. On s'éloigne de la
    // butée : à l'échelle maximale, un zoom avant ne changerait rien et l'on
    // mesurerait le plafond au lieu du geste.
    const zone = await (await seatZone('BATTLEFIELD')).boundingBox();
    await page.mouse.move(zone.x + zone.width / 2, zone.y + 20);
    await page.mouse.wheel(0, zoomAfter > 1 ? 240 : -240);
    await page.waitForTimeout(300);
    if ((await page.evaluate(() => window.__mtg.getState().viewScale)) === zoomAfter) {
      throw new Error('la molette ne zoome plus la table');
    }
    await page.screenshot({ path: `${OUT}/ui-24-main-pleine.png` });
  });

  await step('la marque de sélection subsiste après le lasso', async () => {
    await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
    await page.waitForTimeout(400);
    // La recette a pu vider le terrain juste avant : on le regarnit plutôt que
    // de déclarer un manque de permanents.
    if ((await page.locator('[data-card-id]').count()) < 2) {
      await playFromHand(2 - (await page.locator('[data-card-id]').count()) + 1);
    }
    const cards = await page.locator('[data-card-id]').all();
    if (cards.length < 2) throw new Error('il faut deux permanents pour éprouver le lasso');
    // Deux permanents suffisent, et un tracé serré a bien plus de chances de
    // n'avoir aucun coin sur un panneau flottant qu'un tracé qui ferait le
    // tour de tout le terrain.
    await lassoAround(cards.slice(0, 2));

    const selected = await page.evaluate(() => window.__mtg.getState().selection.size);
    if (selected < 2) throw new Error(`le lasso n’a retenu que ${selected} carte(s)`);

    // Le surlignage provisoire s'efface, la marque acquise reste.
    const marks = await page.evaluate(() => ({
      transitoires: document.querySelectorAll('.lasso-hit').length,
      acquises: document.querySelectorAll('.selected-card').length,
      visible: (() => {
        const el = document.querySelector('.selected-card');
        if (!el) return null;
        const style = getComputedStyle(el);
        return { outline: style.outlineWidth, color: style.outlineColor };
      })(),
    }));
    if (marks.transitoires !== 0) throw new Error('le surlignage provisoire du lasso survit au relâchement');
    if (marks.acquises < 2) throw new Error(`${marks.acquises} carte(s) marquée(s) pour ${selected} sélectionnée(s)`);
    if (!marks.visible || parseFloat(marks.visible.outline) < 1) {
      throw new Error(`la marque de sélection n’est pas visible : ${JSON.stringify(marks.visible)}`);
    }
    console.log(`      ${marks.acquises} cartes marquées, contour ${marks.visible.outline} ${marks.visible.color}`);
    await page.screenshot({ path: `${OUT}/ui-25-selection-persistante.png` });
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
  });

  await step('une carte posée face cachée porte son repère chez son propriétaire', async () => {
    const id = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'BATTLEFIELD')?.id,
    );
    if (!id) throw new Error('aucun permanent');
    await page.evaluate((card) => window.__mtg.getState().send({ type: 'TURN_FACE_DOWN', cardId: card }), id);
    await page.waitForFunction((card) => window.__mtg.getState().cards.get(card)?.facedownOnTable === true, id, {
      timeout: 8000,
    });
    const badge = page.locator(`[data-card="${id}"] [data-test="facedown-indicator"]`);
    await badge.waitFor({ timeout: 4000 });
    const shown = await page.evaluate((card) => {
      const el = document.querySelector(`[data-card="${card}"] [data-test="facedown-indicator"]`);
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), w: r.width, h: r.height, image: Boolean(document.querySelector(`[data-card="${card}"] img[src*="scryfall"]`)) };
    }, id);
    if (shown.w < 10 || shown.h < 10) throw new Error('le repère de face cachée est invisible');
    if (!shown.image) throw new Error('le propriétaire ne voit plus l’identité de sa carte');
    console.log(`      repère « ${shown.text} » sur la carte, dont on voit toujours la face`);
    await page.screenshot({ path: `${OUT}/ui-26-face-cachee.png` });
    await page.evaluate((card) => window.__mtg.getState().send({ type: 'TURN_FACE_UP', cardId: card }), id);
    await page.waitForFunction((card) => !window.__mtg.getState().cards.get(card)?.facedownOnTable, id, {
      timeout: 8000,
    });
  });

  await step('la bibliothèque montre un dos de carte, puis le dos personnalisé', async () => {
    // Une étape précédente a pu poser un dos personnalisé : on repart du dos
    // dessiné, qui est ce que voit une table neuve.
    await page.evaluate(() => window.__mtg.getState().send({ type: 'SET_SEAT_COSMETICS', cardBackUrl: null }));
    await page.waitForFunction(
      () => {
        const s = window.__mtg.getState();
        return s.seats.find((x) => x.id === s.mySeat)?.cardBackUrl === null;
      },
      null,
      { timeout: 8000 },
    );
    await page.waitForTimeout(300);
    // Une bibliothèque vide ne montre pas de dos — et après une vingtaine de
    // pioches, elle peut l'être. On lui rend une carte plutôt que de mesurer
    // une pile qui n'existe plus.
    const refilled = await page.evaluate(() => {
      const s = window.__mtg.getState();
      if ((s.zoneCounts.get(s.mySeat + '|LIBRARY') ?? 0) > 0) return false;
      const card = [...s.cards.values()].find((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat);
      if (!card) return false;
      s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: s.mySeat, kind: 'LIBRARY' }, index: 'TOP' });
      return true;
    });
    if (refilled) {
      await page.waitForFunction(
        () => {
          const s = window.__mtg.getState();
          return (s.zoneCounts.get(s.mySeat + '|LIBRARY') ?? 0) > 0;
        },
        null,
        { timeout: 8000 },
      );
    }
    const pile = await seatZone('LIBRARY');
    // Sans dos configuré, la pile montre le dos officiel de Magic servi par
    // Scryfall ; le dessin n'est plus que le filet de sécurité quand cette
    // image ne charge pas. L'ancienne version exigeait le dessin et tombait
    // depuis que le vrai dos est en place.
    const drawn = await pile.evaluate((el) => ({
      svg: el.querySelectorAll('svg').length,
      src: el.querySelector('img')?.getAttribute('src') ?? null,
    }));
    if (drawn.svg === 0 && !drawn.src) {
      throw new Error('la pile de bibliothèque ne montre aucun dos');
    }
    if (drawn.src && !/scryfall\.io/.test(drawn.src)) {
      throw new Error(`dos inattendu alors qu’aucun n’est configuré : ${drawn.src}`);
    }

    // Un dos personnalisé doit prendre la place du dessin.
    const url = `${BASE}/favicon.svg`;
    await page.evaluate(
      (src) => window.__mtg.getState().send({ type: 'SET_SEAT_COSMETICS', cardBackUrl: src }),
      url,
    );
    await page.waitForFunction(
      (src) => window.__mtg.getState().seats.some((s) => s.cardBackUrl === src),
      url,
      { timeout: 8000 },
    );
    await page.waitForTimeout(300);
    const custom = await (await seatZone('LIBRARY')).evaluate((el) => {
      const img = el.querySelector('img');
      return img ? img.getAttribute('src') : null;
    });
    if (custom !== url) throw new Error(`le dos personnalisé ne s’affiche pas : ${custom}`);
    console.log('      dos dessiné par défaut, remplacé par le dos configuré');
    await page.screenshot({ path: `${OUT}/ui-27-dos-bibliotheque.png` });
    await page.evaluate(() => window.__mtg.getState().send({ type: 'SET_SEAT_COSMETICS', cardBackUrl: null }));
    await page.waitForTimeout(400);
  });

  // ------------------------------- retours d'interface relevés par l'audit

  await step('la taxe de commandant bouge à l’écran, pas seulement au journal', async () => {
    const commander = await page.evaluate(
      () => [...window.__mtg.getState().cards.values()].find((c) => c.zone.kind === 'COMMAND')?.id,
    );
    if (!commander) throw new Error('aucun commandant');
    const before = await page.evaluate(
      ([id]) => {
        const s = window.__mtg.getState();
        return s.seats.find((x) => x.id === s.mySeat)?.commanderTax?.[id] ?? 0;
      },
      [commander],
    );
    await page.evaluate(
      ([id, value]) => {
        const s = window.__mtg.getState();
        s.send({ type: 'SET_PLAYER_COUNTER', seat: s.mySeat, kind: `commander_tax:${id}`, value });
      },
      [commander, before + 1],
    );
    await page.waitForFunction(
      ([id, value]) => {
        const s = window.__mtg.getState();
        return (s.seats.find((x) => x.id === s.mySeat)?.commanderTax?.[id] ?? 0) === value;
      },
      [commander, before + 1],
      { timeout: 8000 },
    );
    console.log(`      taxe portée de ${before} à ${before + 1} dans l’état affiché`);
  });

  await step('un dé lancé s’affiche au centre de la table, pas seulement au journal', async () => {
    const bubbles = () => page.evaluate(() => window.__mtg.getState().chat.length);
    const before = await bubbles();
    await page.evaluate(() => window.__mtg.getState().send({ type: 'ROLL_DIE', sides: 20 }));
    await page.waitForFunction((n) => window.__mtg.getState().chat.length > n, before, { timeout: 8000 });
    const text = await page.evaluate(() => window.__mtg.getState().chat.at(-1)?.text ?? '');
    if (!/d20/.test(text)) throw new Error(`bulle inattendue : « ${text} »`);
    const shown = await page.getByText(text, { exact: false }).count();
    if (shown === 0) throw new Error('la bulle du dé n’est pas rendue à l’écran');
    console.log(`      bulle « ${text} » affichée`);
  });

  await step('la cible d’un dépôt est mise en évidence pendant le geste', async () => {
    const card = await firstHandCard();
    const from = await centerOf(card);
    const zone = await seatZone('BATTLEFIELD');
    const to = await centerOf(zone);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(120);
    const live = await page.evaluate(() => {
      const seat = window.__mtg.getState().mySeat;
      const zoneEl = document.querySelector(`[data-zone="${seat}|BATTLEFIELD"]`);
      const chip = document.querySelector('[data-test="drop-hint"]');
      return {
        outline: zoneEl ? zoneEl.style.outline : '',
        chip: chip ? { text: chip.textContent, shown: chip.style.display !== 'none' } : null,
      };
    });
    await page.mouse.up();
    await page.waitForTimeout(500);
    if (!live.outline.includes('solid')) throw new Error(`la zone visée n’est pas surlignée : « ${live.outline}" »`);
    if (!live.chip?.shown) throw new Error('aucune pastille ne nomme la cible');
    console.log(`      cible annoncée : « ${live.chip.text} », zone surlignée`);

    // Et le surlignage ne survit pas au geste.
    const after = await page.evaluate(() => {
      const seat = window.__mtg.getState().mySeat;
      return document.querySelector(`[data-zone="${seat}|BATTLEFIELD"]`).style.outline;
    });
    if (after) throw new Error(`le surlignage survit au relâchement : « ${after} »`);
  });

  await step('un dépôt hors de toute zone le dit, au lieu de ne rien faire', async () => {
    await page.evaluate(() => useGameDismiss());
    const card = await firstHandCard();
    const from = await centerOf(card);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Un coin de l'écran, hors de toute zone déclarée.
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(from.x - (from.x - 6) * (i / 6), from.y - (from.y - 6) * (i / 6));
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const said = await page.evaluate(() => window.__mtg.getState().lastReject);
    if (!said) throw new Error('un dépôt perdu reste silencieux');
    console.log(`      message : « ${said} »`);
    await page.evaluate(() => useGameDismiss());
  });

  await step('le playmat par défaut laisse voir le fond de table', async () => {
    const seat = await page.evaluate(() => window.__mtg.getState().mySeat);
    const mat = page.locator(`[data-test="playmat-default"]`).first();
    await mat.waitFor({ timeout: 4000 });
    const style = await mat.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.backgroundColor, image: s.backgroundImage };
    });
    const opaque = /rgb\(\s*\d+,\s*\d+,\s*\d+\s*\)/.test(style.color);
    if (opaque) throw new Error(`le playmat par défaut est opaque : ${style.color}`);
    if (!/rgba?\([^)]*0\.\d/.test(style.image)) {
      throw new Error(`le playmat par défaut n’est pas translucide : ${style.image.slice(0, 120)}`);
    }
    // Le fond de table doit être derrière, et donc réellement visible.
    const behind = await page.evaluate(() => document.querySelectorAll('[data-test="table-background"], .table-background, svg').length);
    void behind;
    void seat;
    console.log(`      playmat par défaut translucide : ${style.image.slice(0, 80)}…`);
    await page.screenshot({ path: `${OUT}/ui-28-playmat.png` });
  });

  await step('un permanent attaché reste visible et porte son badge de lien', async () => {
    const ids = await page.evaluate(() =>
      [...window.__mtg.getState().cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').map((c) => c.id),
    );
    if (ids.length < 2) throw new Error('il faut deux permanents');
    const [source, target] = ids;
    await page.evaluate(
      ([s, t]) => window.__mtg.getState().send({ type: 'ATTACH', sourceId: s, targetId: t }),
      [source, target],
    );
    await page.waitForFunction(
      ([s, t]) => window.__mtg.getState().cards.get(s)?.attachedTo === t,
      [source, target],
      { timeout: 8000 },
    );
    const badge = page.locator(`[data-card-id="${target}"] [data-test="attach-badge"]`);
    await badge.waitFor({ timeout: 4000 });
    const geometry = await page.evaluate(
      ([s, t]) => {
        const box = (id) => document.querySelector(`[data-card-id="${id}"]`).getBoundingClientRect();
        const a = box(s);
        const b = box(t);
        const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return { hidden: (overlapX * overlapY) / (a.width * a.height), text: document.querySelector(`[data-card-id="${t}"] [data-test="attach-badge"]`).textContent.trim() };
      },
      [source, target],
    );
    if (geometry.hidden > 0.7) {
      throw new Error(`la carte attachée est masquée à ${Math.round(geometry.hidden * 100)} %`);
    }
    console.log(
      `      attachée visible à ${Math.round((1 - geometry.hidden) * 100)} %, badge « ${geometry.text} » sur la cible`,
    );
    await page.evaluate((s) => window.__mtg.getState().send({ type: 'DETACH', sourceId: s }), source);
    await page.waitForTimeout(400);
  });

  // ------------------------------------------ coût du geste (docs/ux-polish)

  await step('la main se sélectionne : clic, Ctrl + clic, et un seul lot part', async () => {
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
    await page.evaluate(() => {
      const rail = document.querySelector('[data-test="hand-rail"]');
      if (rail) rail.scrollLeft = 0;
    });
    const cards = await page.locator('[data-test="hand-rail"] [data-card]').all();
    if (cards.length < 3) throw new Error('il faut trois cartes en main');

    // Les cartes de main se chevauchent : on clique la partie visible, à
    // gauche, et non leur centre — qui est sous la carte suivante.
    const edge = { position: { x: 14, y: 60 } };
    await cards[0].click(edge);
    await page.waitForTimeout(150);
    if ((await page.evaluate(() => window.__mtg.getState().selection.size)) !== 1) {
      throw new Error('un clic sur une carte de main ne la sélectionne pas');
    }
    await cards[1].click({ ...edge, modifiers: ['Control'] });
    await cards[2].click({ ...edge, modifiers: ['Control'] });
    await page.waitForTimeout(150);
    const picked = await page.evaluate(() => window.__mtg.getState().selection.size);
    if (picked !== 3) throw new Error(`Ctrl + clic n’étend pas la sélection : ${picked}`);

    // L'anneau bleu doit se voir sur les trois.
    const marked = await page.evaluate(
      () => document.querySelectorAll('[data-test="hand-rail"] .selected-card').length,
    );
    if (marked !== 3) throw new Error(`${marked} carte(s) marquée(s) pour 3 sélectionnées`);

    // Et l'action groupée part en un seul lot.
    await page.evaluate(() => (window.__sentIntents.length = 0));
    const graveyardBefore = await page.evaluate(
      () => window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|GRAVEYARD') ?? 0,
    );
    await cards[1].click({ ...edge, button: 'right' });
    /*
     * Le compte du lot est une pastille à part, pas l'en-tête.
     *
     * Le premier `<p>` du menu porte le **nom de la carte** ; le « 3 sél. » vit
     * dans un `<span>` frère. L'étape lisait donc le nom et s'étonnait de n'y
     * pas trouver « 3 sélectionnées » — un libellé qui n'existe plus. On vise
     * la pastille par son `data-test`, et l'on lit son compte, pas son texte.
     */
    const pastille = page.locator('[data-test="card-menu-count"]');
    await pastille.waitFor({ timeout: 5000 });
    const lot = Number(await pastille.getAttribute('data-count'));
    if (lot !== 3) throw new Error(`le menu annonce ${lot} carte(s) au lieu de 3`);
    await page.locator('[data-test="card-menu"] button').filter({ hasText: /^Défausser/ }).first().click();
    await page.waitForFunction(
      (n) => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|GRAVEYARD') ?? 0) >= n + 3,
      graveyardBefore,
      { timeout: 8000 },
    );
    const sent = await page.evaluate(() =>
      window.__sentIntents.filter((f) => f.includes('MOVE_CARD')).length,
    );
    if (sent !== 1) throw new Error(`${sent} intents pour une défausse groupée, un seul attendu`);
    console.log('      trois cartes de main défaussées en un seul MOVE_CARDS');
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
  });

  await step('un dépôt groupé part en un seul lot', async () => {
    await refillHand(3).catch(() => undefined);
    await page.evaluate(() => {
      const s = window.__mtg.getState();
      const hand = [...s.cards.values()]
        .filter((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat)
        .slice(0, 2);
      s.setSelection(new Set(hand.map((c) => c.id)));
      window.__sentIntents.length = 0;
    });
    const picked = await page.evaluate(() => [...window.__mtg.getState().selection]);
    if (picked.length < 2) throw new Error('il faut deux cartes en main');
    const card = page.locator(`[data-card="${picked[0]}"]`).first();
    await dragTo(card, await seatZone('GRAVEYARD'));
    const sent = await page.evaluate(() =>
      window.__sentIntents.filter((f) => f.includes('MOVE_CARD')).map((f) => JSON.parse(f).intent.type),
    );
    if (sent.length !== 1 || sent[0] !== 'MOVE_CARDS') {
      throw new Error(`dépôt groupé : ${sent.join(', ') || 'rien'} au lieu d’un MOVE_CARDS`);
    }
    console.log('      deux cartes glissées ensemble : un seul MOVE_CARDS');
    await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
  });

  await step('« Jouer » pose la carte sur une place libre, pas sur la précédente', async () => {
    // La bibliothèque peut être vide à ce stade de la recette : on reprend
    // alors deux cartes au cimetière plutôt que de piocher.
    await page.evaluate(() => {
      const s = window.__mtg.getState();
      const hand = [...s.cards.values()].filter((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat);
      if (hand.length >= 2) return;
      const spare = [...s.cards.values()]
        .filter((c) => c.zone.kind === 'GRAVEYARD' && c.zone.seat === s.mySeat)
        .slice(0, 2 - hand.length)
        .map((c) => c.id);
      if (spare.length > 0) s.send({ type: 'MOVE_CARDS', cardIds: spare, to: { seat: s.mySeat, kind: 'HAND' } });
    });
    await page.waitForFunction(
      () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|HAND') ?? 0) >= 2,
      null,
      { timeout: 8000 },
    );
    const spots = [];
    for (let i = 0; i < 2; i++) {
      const before = await page.evaluate(() =>
        [...window.__mtg.getState().cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').map((c) => c.id),
      );
      await (await firstHandCard()).click({ button: 'right', position: { x: 14, y: 60 } });
      // Le libellé du bouton porte aussi son raccourci (« JouerP ») : un
      // ancrage `$` ne correspond à rien. La première entrée est « Jouer ».
      await page.locator('div.fixed.z-50.w-60 button', { hasText: 'Jouer' }).first().click();
      await page.waitForFunction(
        (n) =>
          [...window.__mtg.getState().cards.values()].filter((c) => c.zone.kind === 'BATTLEFIELD').length > n,
        before.length,
        { timeout: 8000 },
      );
      const placed = await page.evaluate(
        (known) =>
          [...window.__mtg.getState().cards.values()]
            .filter((c) => c.zone.kind === 'BATTLEFIELD' && !known.includes(c.id))
            .map((c) => ({ x: c.x, y: c.y }))[0],
        before,
      );
      spots.push(placed);
    }
    const [a, b] = spots;
    if (!a || !b) throw new Error('les deux cartes ne sont pas arrivées sur le terrain');
    if (a.x === b.x && a.y === b.y) {
      throw new Error(`les deux cartes se posent au même endroit : ${a.x},${a.y}`);
    }
    console.log(`      posées en ${a.x},${a.y} puis ${b.x},${b.y}`);
  });

  await step('deux clients, un seul monde : le curseur tombe au bon endroit', async () => {
    const roomUrl = page.url();
    const contextB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pageB = await contextB.newPage();
    try {
      await pageB.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await pageB.getByPlaceholder('Invité').fill('Bob');
      await pageB.locator('textarea').first().fill(DECK);
      await pageB.getByRole('button', { name: "S'asseoir à la table" }).click();
      await pageB.getByText('Journal').waitFor({ timeout: 20000 });
      await page.waitForFunction(() => window.__mtg.getState().seats.length === 2, null, { timeout: 15000 });

      // Cadrages volontairement différents : c'est le cas qui doit marcher.
      await pageB.getByRole('button', { name: 'Voir toute la table' }).click();
      await pageB.mouse.move(700, 450);
      await pageB.mouse.wheel(0, -240);
      await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
      await page.waitForTimeout(400);

      /** Le point sous le curseur écran, converti dans le repère du monde. */
      const worldOf = (target, x, y) =>
        target.evaluate(
          ([px, py]) => {
            const surface = document.querySelector('.table-surface');
            const plane = surface.firstElementChild;
            const rect = plane.getBoundingClientRect();
            const scale = plane.getBoundingClientRect().width / plane.offsetWidth || 1;
            void rect;
            void scale;
            // On passe par la matrice réelle du plan : pas de duplication du calcul.
            const m = new DOMMatrix(getComputedStyle(plane).transform);
            const s = surface.getBoundingClientRect();
            const inv = m.inverse();
            const p = inv.transformPoint(new DOMPoint(px - s.left, py - s.top));
            return { x: Math.round(p.x), y: Math.round(p.y) };
          },
          [x, y],
        );

      // A pointe un point précis et identifiable de SON panneau : le centre de
      // son champ de bataille. On le prend tel qu'il est réellement à l'écran
      // chez A — un point calculé hors du cadre serait clampé par le pilote, et
      // l'on mesurerait alors autre chose que ce qu'on croit.
      const seatA = await page.evaluate(() => window.__mtg.getState().mySeat);
      await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
      await page.waitForTimeout(400);
      const zoneA = await page.locator(`[data-zone="${seatA}|BATTLEFIELD"]`).boundingBox();
      if (!zoneA) throw new Error('panneau introuvable chez A');
      const view = page.viewportSize();
      // Le point visé doit être **dans** le panneau de A *et* dans le cadre :
      // borner les coordonnées de son centre, comme on le faisait, donne un
      // point hors du panneau dès que celui-ci déborde de l'écran, et l'on
      // mesure alors une dérive qui n'en est pas une. On prend donc le centre
      // de l'intersection entre le panneau et la fenêtre.
      const visible = {
        left: Math.max(zoneA.x, 12),
        right: Math.min(zoneA.x + zoneA.width, view.width - 12),
        top: Math.max(zoneA.y, TOP_BAR + 12),
        bottom: Math.min(zoneA.y + zoneA.height, view.height - HAND_RAIL - 12),
      };
      if (visible.right - visible.left < 40 || visible.bottom - visible.top < 40) {
        throw new Error('le panneau de A n’est pas assez visible pour viser un point dedans');
      }
      const targetScreen = {
        x: (visible.left + visible.right) / 2,
        y: (visible.top + visible.bottom) / 2,
      };
      /*
       * Ce qu'on verifie, et ce qu'on ne verifie plus.
       *
       * Les coordonnees echangees sont celles du **repere partage**, mais
       * chaque client affiche desormais une **reattribution** des cases pour
       * que son propre siege soit en bas. Comparer la coordonnee de A a celle
       * que recoit B ne veut donc plus rien dire : elles different d'une case,
       * par construction.
       *
       * La propriete qui compte, elle, n'a pas bouge : le curseur de A doit
       * tomber **au meme endroit du meme panneau** chez B. On la mesure donc
       * en coordonnees relatives au panneau de A, des deux cotes, et sur ce qui
       * est reellement peint chez B.
       */
      const offsetChezA = {
        x: (targetScreen.x - zoneA.x) / zoneA.width,
        y: (targetScreen.y - zoneA.y) / zoneA.height,
      };

      await page.mouse.move(targetScreen.x, targetScreen.y);
      await page.waitForTimeout(400);
      await page.mouse.move(targetScreen.x + 1, targetScreen.y + 1);
      await page.waitForTimeout(700);

      const seen = await pageB.evaluate(
        (id) => window.__mtg.getState().cursors.find((c) => c.seat === id) ?? null,
        seatA,
      );
      if (!seen) throw new Error('aucun curseur de A recu par B');

      const chezB = await pageB.evaluate(
        (id) => {
          const marker = document.querySelector(`[data-test="cursor"][data-seat="${id}"]`);
          const panel = document.querySelector(`[data-zone="${id}|BATTLEFIELD"]`);
          if (!marker || !panel) return null;
          const m = marker.getBoundingClientRect();
          const p = panel.getBoundingClientRect();
          return { x: (m.left - p.left) / p.width, y: (m.top - p.top) / p.height };
        },
        seatA,
      );
      if (!chezB) throw new Error('curseur de A non peint chez B');

      // Trois pour cent du panneau : plus fin que l'epaisseur du pointeur.
      const derive = Math.hypot(chezB.x - offsetChezA.x, chezB.y - offsetChezA.y);
      if (derive > 0.03) {
        throw new Error(
          `curseur decale dans le panneau de A : chez A ${offsetChezA.x.toFixed(3)},${offsetChezA.y.toFixed(3)} ` +
            `— chez B ${chezB.x.toFixed(3)},${chezB.y.toFixed(3)}`,
        );
      }

      await pageB.screenshot({ path: `${OUT}/ui-10-curseur-vu-par-B.png` });

      // --- Donner une carte au voisin ne doit pas pouvoir se faire par mégarde.
      await page.getByRole('button', { name: 'Voir toute la table' }).click();
      await page.waitForTimeout(500);
      const seatBId = await pageB.evaluate(() => window.__mtg.getState().mySeat);
      const foreign = await page.locator(`[data-zone="${seatBId}|BATTLEFIELD"]`).boundingBox();
      const mine = page.locator('[data-zone$="|HAND"] img[src*="scryfall"]').first();
      if (foreign && (await mine.count()) > 0) {
        const seqBefore = await page.evaluate(() => window.__mtg.getState().seq);
        await page.evaluate(() => window.__mtg.getState().dismissReject());
        const from = await centerOf(mine);
        const to = { x: foreign.x + foreign.width / 2, y: foreign.y + foreign.height / 2 };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) {
          await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
          await page.waitForTimeout(20);
        }
        await page.mouse.up();
        await page.waitForTimeout(700);
        const said = await page.evaluate(() => window.__mtg.getState().lastReject);
        const seqAfter = await page.evaluate(() => window.__mtg.getState().seq);
        if (seqAfter !== seqBefore) throw new Error('la carte est partie chez le voisin sans confirmation');
        if (!said || !/Alt/.test(said)) throw new Error(`aucun avertissement lisible : « ${said} »`);
        console.log(`      dépôt chez le voisin retenu : « ${said.slice(0, 70)} »`);
        await page.evaluate(() => window.__mtg.getState().dismissReject());
      }

      // --- Une main révélée doit se voir quelque part. B pioche d'abord : une
      //     main vide ne révèle rien, et l'on mesurerait l'absence de cartes.
      await pageB.evaluate(() => window.__mtg.getState().send({ type: 'DRAW', count: 3 }));
      await pageB.waitForFunction(
        () => {
          const s = window.__mtg.getState();
          return (s.zoneCounts.get(s.mySeat + '|HAND') ?? 0) > 0;
        },
        null,
        { timeout: 8000 },
      );
      /*
       * B a joue et defausse depuis le debut de cette etape : sa main peut etre
       * vide, et une main vide ne se revele pas. On lui en redonne, sinon l'on
       * mesure l'absence d'eventail plutot que l'absence de revelation.
       */
      await pageB.evaluate(() => window.__mtg.getState().send({ type: 'DRAW', count: 2 }));
      await pageB.waitForFunction(
        () => {
          const s = window.__mtg.getState();
          return [...s.cards.values()].some((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat);
        },
        null,
        { timeout: 8000 },
      );
      await pageB.evaluate(() => window.__mtg.getState().send({ type: 'REVEAL_HAND', toSeats: 'ALL' }));
      await page.waitForFunction(
        (id) => window.__mtg.getState().handsRevealed.has(id),
        seatBId,
        { timeout: 8000 },
      );
      await page.waitForTimeout(400);
      /*
       * La main révélée ne se pose plus **au milieu du terrain** de son
       * propriétaire — elle y couvrait ses permanents, à l'endroit précis où
       * l'on joue. Elle se lit dans l'éventail tenu au-dessus de son panneau,
       * où chaque carte montrée remplace son dos.
       */
      const revealed = await page.evaluate(() => ({
        badge: document.querySelectorAll('[data-test="hand-revealed"]').length,
        montrees: document.querySelectorAll('[data-test="opponent-hand"] [title="Carte montrée"]').length,
      }));
      if (revealed.badge === 0) throw new Error('aucun badge « main révélée »');
      if (revealed.montrees === 0) {
        const detail = await page.evaluate(() => {
          const s = window.__mtg.getState();
          const autre = s.seats.find((x) => x.id !== s.mySeat);
          const main = [...s.cards.values()].filter(
            (c) => c.zone.seat === autre?.id && c.zone.kind === 'HAND',
          );
          return {
            handCount: autre?.handCount,
            connues: main.filter((c) => c.faceDown === false).length,
            total: main.length,
            eventails: document.querySelectorAll('[data-test="opponent-hand"]').length,
            titres: [...document.querySelectorAll('[data-test="opponent-hand"] span[title]')].map(
              (e) => e.getAttribute('title'),
            ),
          };
        });
        throw new Error(
          `la main révélée n’apparaît pas dans l’éventail de son propriétaire : ${JSON.stringify(detail)}`,
        );
      }
      console.log(`      main révélée : ${revealed.cards} cartes visibles chez l’adversaire`);
      await page.screenshot({ path: `${OUT}/ui-29-main-revelee.png` });
      await pageB.evaluate(() => window.__mtg.getState().send({ type: 'UNREVEAL_HAND' }));
      await page.waitForFunction((id) => !window.__mtg.getState().handsRevealed.has(id), seatBId, {
        timeout: 8000,
      });

      // --- Le curseur d'autrui doit passer AU-DESSUS des cartes.
      //
      // Le piège est connu : les permanents portent un z-index, et un élément
      // positionné sans z-index se peint sous eux quel que soit l'ordre du
      // document. On l'éprouve donc avec de vraies cartes sur le terrain, et
      // non sur un plateau vide où rien ne pourrait recouvrir quoi que ce soit.
      const overCard = await pageB.evaluate((seat) => {
        const cursor = [...document.querySelectorAll('.table-surface [style*="left"]')].find(
          (el) => el.querySelector('svg path[d^="M0 0 L0 14"]'),
        );
        const card = document.querySelector('[data-card-id]');
        if (!cursor || !card) return { skipped: true };
        // On place le curseur d'autrui exactement sur une carte, puis on lui
        // rend le droit d'être touché le temps de lire l'ordre de peinture.
        const rect = card.getBoundingClientRect();
        const plane = document.querySelector('.table-surface').firstElementChild;
        const m = new DOMMatrix(getComputedStyle(plane).transform).inverse();
        const surface = document.querySelector('.table-surface').getBoundingClientRect();
        const centre = m.transformPoint(
          new DOMPoint(rect.left + rect.width / 2 - surface.left, rect.top + rect.height / 2 - surface.top),
        );
        cursor.style.left = `${centre.x}px`;
        cursor.style.top = `${centre.y}px`;
        cursor.style.pointerEvents = 'auto';
        const top = document.elementFromPoint(rect.left + rect.width / 2 + 3, rect.top + rect.height / 2 + 4);
        cursor.style.pointerEvents = '';
        return {
          skipped: false,
          aboveCard: Boolean(top && cursor.contains(top)),
          topElement: top ? (top.closest('[data-card-id]') ? 'carte' : top.tagName) : 'rien',
          cursorZ: getComputedStyle(cursor).zIndex,
          cardZ: getComputedStyle(card).zIndex,
        };
      }, seatA);
      if (overCard.skipped) {
        console.log('      (aucune carte sur le terrain de B : empilement des curseurs non exercé)');
      } else if (!overCard.aboveCard) {
        throw new Error(
          `le curseur d'autrui passe sous les cartes (dessus : ${overCard.topElement}, z curseur ${overCard.cursorZ} contre ${overCard.cardZ} pour la carte)`,
        );
      } else {
        console.log(
          `      curseur d'autrui au-dessus des cartes (z ${overCard.cursorZ} contre ${overCard.cardZ})`,
        );
      }

      // --- Portée du lasso quand deux panneaux sont à l'écran.
      await pageB.evaluate(() => {
        const s = window.__mtg.getState();
        s.send({ type: 'DRAW', count: 2 });
      });
      await pageB.waitForTimeout(900);
      const theirs = await pageB.evaluate(() => {
        const s = window.__mtg.getState();
        // Bien la main de B : une carte révélée par A traînerait aussi ici.
        const card = [...s.cards.values()].find(
          (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
        );
        if (!card) return null;
        s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 200, y: 160 });
        return card.id;
      });
      if (theirs) {
        // D'abord chez B, qui l'a demandé, puis chez A, qui doit le voir.
        await pageB
          .waitForFunction(
            (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD',
            theirs,
            { timeout: 10000 },
          )
          .catch(async () => {
            const diag = await pageB.evaluate(() => {
              const s = window.__mtg.getState();
              return { reject: s.lastReject, counts: Object.fromEntries(s.zoneCounts), cards: s.cards.size };
            });
            throw new Error(`le second siège n'a pas pu jouer : ${JSON.stringify(diag)}`);
          });
        await page.waitForFunction(
          (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD',
          theirs,
          { timeout: 10000 },
        );
        await page.getByRole('button', { name: 'Voir toute la table' }).click();
        await page.waitForTimeout(500);

        // Un lasso large, couvrant les deux panneaux.
        await lassoAround(await page.locator('[data-card-id]').all());
        const mineOnly = await page.evaluate(
          (id) => {
            const s = window.__mtg.getState();
            return {
              total: s.selection.size,
              ofOthers: [...s.selection].filter((x) => s.cards.get(x)?.controller !== s.mySeat).length,
              caughtTheirs: s.selection.has(id),
            };
          },
          theirs,
        );
        console.log(
          `      lasso large : ${mineOnly.total} sélectionnée(s), dont ${mineOnly.ofOthers} d'autrui`,
        );
        if (mineOnly.ofOthers !== 0 || mineOnly.caughtTheirs) {
          throw new Error('le lasso a ramassé des cartes adverses sans qu’on le demande');
        }
        if (mineOnly.total === 0) throw new Error('le lasso n’a rien pris du tout');

        // Avec Alt, c'est délibéré : les cartes adverses entrent.
        await lassoAround(await page.locator('[data-card-id]').all(), { alt: true });
        const withAlt = await page.evaluate(
          (id) => window.__mtg.getState().selection.has(id),
          theirs,
        );
        if (!withAlt) throw new Error('Maj + Alt ne prend pas les cartes adverses');
        console.log('      lasso Alt : les permanents adverses sont inclus');
        await page.screenshot({ path: `${OUT}/ui-21-lasso-deux-sieges.png` });
        await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
      } else {
        console.log('      (le second siège n’a pas pu poser de permanent : portée du lasso non exercée)');
      }
      console.log(`      dérive du curseur A vu par B : ${(derive * 100).toFixed(1)} % du panneau`);

      // Sens inverse : B pointe son propre panneau, A doit le voir au bon endroit.
      const seatB = await pageB.evaluate(() => window.__mtg.getState().mySeat);
      await pageB.getByRole('button', { name: 'Recentrer sur moi' }).click();
      await pageB.waitForTimeout(400);
      const zoneB = await pageB.locator(`[data-zone="${seatB}|BATTLEFIELD"]`).boundingBox();
      if (!zoneB) throw new Error('panneau introuvable chez B');
      const viewB = pageB.viewportSize();
      const targetB = {
        x: Math.min(Math.max(zoneB.x + zoneB.width * 0.35, 10), viewB.width - 10),
        y: Math.min(Math.max(zoneB.y + zoneB.height * 0.4, 10), viewB.height - 10),
      };
      const offsetChezB = {
        x: (targetB.x - zoneB.x) / zoneB.width,
        y: (targetB.y - zoneB.y) / zoneB.height,
      };
      await pageB.mouse.move(targetB.x, targetB.y);
      await pageB.waitForTimeout(400);
      await pageB.mouse.move(targetB.x + 1, targetB.y + 1);
      await pageB.waitForTimeout(700);
      const chezA = await page.evaluate(
        (id) => {
          const marker = document.querySelector(`[data-test="cursor"][data-seat="${id}"]`);
          const panel = document.querySelector(`[data-zone="${id}|BATTLEFIELD"]`);
          if (!marker || !panel) return null;
          const m = marker.getBoundingClientRect();
          const p = panel.getBoundingClientRect();
          return { x: (m.left - p.left) / p.width, y: (m.top - p.top) / p.height };
        },
        seatB,
      );
      if (!chezA) throw new Error('curseur de B non peint chez A');
      const deriveB = Math.hypot(chezA.x - offsetChezB.x, chezA.y - offsetChezB.y);
      if (deriveB > 0.03) {
        throw new Error(
          `curseur de B décalé dans son panneau : chez B ${offsetChezB.x.toFixed(3)},${offsetChezB.y.toFixed(3)} ` +
            `— chez A ${chezA.x.toFixed(3)},${chezA.y.toFixed(3)}`,
        );
      }
      console.log(`      dérive du curseur B vu par A : ${(deriveB * 100).toFixed(1)} % du panneau`);
      await page.screenshot({ path: `${OUT}/ui-11-curseur-vu-par-A.png` });
    } finally {
      await contextB.close();
    }
  });

  /**
   * Un second siège, monté **une seule fois** et partagé par les étapes qui en
   * ont besoin.
   *
   * La table est plafonnée à quatre joueurs (`LIMITS.maxSeats`) et un siège
   * déconnecté reste occupé (§6.8) : chaque étape qui montait le sien consommait
   * une place pour de bon, et la table se retrouvait pleine avant la fin de la
   * recette — l'étape suivante échouait alors pour une raison qui n'était pas
   * la sienne. Le client est fermé par la **dernière** étape qui s'en sert.
   */
  let secondSiege = null;
  const ouvrirSecondSiege = async (nom) => {
    if (secondSiege) return secondSiege;
    const contexte = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const voisin = await contexte.newPage();
    await voisin.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await voisin.getByPlaceholder('Invité').fill(nom);
    const deck = voisin.locator('textarea').first();
    if ((await deck.count()) > 0) await deck.fill(DECK);
    await voisin.getByRole('button', { name: "S'asseoir à la table" }).click();
    await voisin.getByText('Journal').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => window.__mtg.getState().seats.length >= 2, null, { timeout: 15000 });
    secondSiege = { contexte, voisin };
    return secondSiege;
  };
  const fermerSecondSiege = async () => {
    if (!secondSiege) return;
    await secondSiege.contexte.close();
    secondSiege = null;
  };

  await step('à deux sièges, une meule empile le cimetière dans l’ordre et le journal la nomme', async () => {
    /*
     * Les deux défauts se voient au même geste, et aucun des deux ne se voit à
     * un seul siège.
     *
     * **L'ordre.** Le rang d'une carte du cimetière n'est pas une étiquette
     * mais une place : meuler par-dessus une pile déjà là décale toutes les
     * autres. Le serveur le faisait, sans le dire à personne — seules les
     * cartes déplacées recevaient un event, et les anciennes gardaient chez le
     * client le rang d'avant. D'où deux meules successives ici, et pas une
     * seule : une meule dans un cimetière vide ne déclenche pas le défaut,
     * puisque toutes les cartes ont leur propre event. On vérifie donc que le
     * premier lot **reste en bas, dans son ordre**, sous le second.
     *
     * **Le journal.** Son texte est construit une fois pour toute la table :
     * le seul endroit où il se vérifie honnêtement est l'écran d'en face. On
     * lit donc la ligne chez l'adversaire, pas chez l'auteur du geste.
     */
    const { voisin } = await ouvrirSecondSiege('Denis');

    /** Le cimetière d'un siège, tel que cette page l'affiche, du dessus vers le bas. */
    const cimetiereAffiche = async (cible, seat) => {
      await cible.evaluate(
        (s) =>
          window.dispatchEvent(
            new CustomEvent('mtg:browse-zone', { detail: { seat: s, kind: 'GRAVEYARD' } }),
          ),
        seat,
      );
      await cible.locator('[data-test="zone-panel"]').waitFor({ timeout: 5000 });
      await cible.waitForTimeout(250);
      return cible.evaluate(() =>
        [...document.querySelectorAll('[data-test="zone-card"]')].map((el) => ({
          id: el.getAttribute('data-card-in-zone'),
          nom: el.querySelector('p')?.textContent?.trim() ?? '',
        })),
      );
    };

    const moi = await page.evaluate(() => window.__mtg.getState().mySeat);

    /*
     * De quoi meuler cinq fois, quoi qu'aient laissé les étapes précédentes.
     * La recette pioche, exile et meule abondamment avant d'arriver ici : la
     * bibliothèque s'était vidée, `MILL` échouait, et l'étape accusait l'ordre
     * du cimetière d'un défaut qui n'était que de réserve.
     */
    const enBibliotheque = () =>
      page.evaluate(() => {
        const s = window.__mtg.getState();
        return s.zoneCounts.get(`${s.mySeat}|LIBRARY`) ?? 0;
      });
    if ((await enBibliotheque()) < 5) {
      await page.evaluate(() => {
        const s = window.__mtg.getState();
        const cardIds = [...s.cards.values()]
          .filter((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat)
          .slice(0, 6)
          .map((c) => c.id);
        if (cardIds.length > 0) {
          s.send({ type: 'MOVE_CARDS', cardIds, to: { seat: s.mySeat, kind: 'LIBRARY' }, index: 'TOP' });
        }
      });
      await page.waitForTimeout(900);
    }
    if ((await enBibliotheque()) < 5) {
      throw new Error(`bibliothèque trop courte pour meuler : ${await enBibliotheque()} carte(s)`);
    }

    // Table nette : le cimetière est peut-être garni par les étapes d'avant, et
    // ce qu'on mesure est un ordre relatif, pas un contenu.
    await page.evaluate(() => window.__mtg.getState().send({ type: 'MILL', count: 2 }));
    await page.waitForTimeout(900);
    const socle = await cimetiereAffiche(page, moi);
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__mtg.getState().send({ type: 'MILL', count: 3 }));
    await page.waitForTimeout(1000);

    const chezMoi = await cimetiereAffiche(page, moi);
    await page.keyboard.press('Escape');
    const chezLui = await cimetiereAffiche(voisin, moi);

    const ids = (liste) => liste.map((c) => c.id).join(' ');
    if (ids(chezMoi) !== ids(chezLui)) {
      throw new Error(`les deux sièges n’affichent pas le même cimetière :\n  A ${ids(chezMoi)}\n  B ${ids(chezLui)}`);
    }
    if (chezLui.length !== socle.length + 3) {
      throw new Error(
        `${chezLui.length} carte(s) au cimetière au lieu de ${socle.length + 3} : la meule n’a pas eu lieu`,
      );
    }
    // Le socle doit se retrouver **intact et dans son ordre**, poussé en bas de
    // la pile par les trois nouvelles : c'est exactement ce que le défaut
    // cassait, en dispersant ses rangs au milieu des arrivantes.
    const queue = ids(chezLui.slice(3));
    if (queue !== ids(socle)) {
      throw new Error(`le premier lot n’est plus au fond dans son ordre :\n  avant ${ids(socle)}\n  après ${queue}`);
    }
    // Aucun rang en double : le symptôme brut du défaut.
    const rangs = await voisin.evaluate(
      (s) =>
        [...window.__mtg.getState().cards.values()]
          .filter((c) => c.zone.kind === 'GRAVEYARD' && c.zone.seat === s)
          .map((c) => c.sortIndex),
      moi,
    );
    if (new Set(rangs).size !== rangs.length) {
      throw new Error(`rangs en double chez l’adversaire : ${rangs.join(',')}`);
    }
    await voisin.screenshot({ path: `${OUT}/ui-24b-cimetiere-ordonne-chez-l-adversaire.png` });
    await voisin.keyboard.press('Escape');

    // Et le journal, chez l'adversaire : il doit nommer les trois cartes que la
    // table voit tomber, pas les compter.
    const ligne = await voisin.evaluate(() => {
      const journal = window.__mtg.getState().log;
      return [...journal].reverse().find((e) => e.text.includes('meulé'))?.text ?? null;
    });
    if (!ligne) throw new Error('aucune ligne de meule dans le journal de l’adversaire');
    if (/meulé\s+\d+\s+carte/.test(ligne)) {
      throw new Error(`le journal de l’adversaire compte au lieu de nommer : « ${ligne} »`);
    }
    /*
     * Le journal nomme les cartes avec le nom du **catalogue**, en anglais.
     *
     * Ce n'est pas un oubli : le texte des lignes est construit une fois pour
     * toute la table, côté serveur, et `docs/i18n.md` §7 (option A) assume que
     * le journal reste en français avec des noms anglais — le traduire
     * imposerait de publier des clés, donc de monter `PROTOCOL_VERSION` et de
     * couper toutes les tables ouvertes.
     *
     * L'étape comparait le nom **affiché**, désormais localisé, au texte du
     * journal : elle échouait sur une divergence voulue, et rendait donc un
     * faux rouge. On vérifie ici ce qui est vrai aujourd'hui — chaque carte
     * tombée est nommée, avec son nom de catalogue — ce qui garde entière la
     * seule promesse de l'étape : le journal **nomme** au lieu de compter.
     *
     * Le jour où le journal publiera des clés plutôt qu'un texte, ce bloc doit
     * changer : il attendra alors le nom affiché, localisé, des deux côtés.
     */
    const nomsCatalogue = await voisin.evaluate(async (ids) => {
      const scryfall = ids
        .map((id) => window.__mtg.getState().cards.get(id)?.scryfallId)
        .filter(Boolean);
      const reponse = await fetch('/api/cards/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids: scryfall }),
      });
      if (!reponse.ok) return null;
      const { cards } = await reponse.json();
      const par = new Map(cards.map((c) => [c.scryfallId, c.name]));
      return scryfall.map((id) => par.get(id) ?? null);
    }, chezLui.slice(0, 3).map((c) => c.id));
    if (!nomsCatalogue || nomsCatalogue.length !== 3 || nomsCatalogue.some((n) => !n)) {
      throw new Error(`le catalogue n’a pas nommé les trois cartes meulées : ${JSON.stringify(nomsCatalogue)}`);
    }
    for (const nom of nomsCatalogue) {
      if (!ligne.includes(nom)) {
        throw new Error(`« ${nom} » manque au journal de l’adversaire : « ${ligne} »`);
      }
    }
    console.log(
      `      cimetière identique aux deux sièges (${chezLui.length} cartes) — journal : « ${ligne} » ` +
        `(affiché à l’écran : ${chezLui.slice(0, 3).map((c) => c.nom).join(', ')})`,
    );
  });

  await step('le nom français d’un jeton est écrit sur son illustration — jamais sur un dos', async () => {
    /*
     * Pourquoi ce pas existe, et pourquoi à deux sièges.
     *
     * Le glossaire (`lib/i18n/tokenNames.ts`) sait dire « Trésor » depuis
     * longtemps ; personne ne le voyait. Les trois endroits où un jeton
     * apparaît — l’étagère, la recherche, la table — n’affichaient que son
     * illustration, et Scryfall n’en publie aucune en français : sur 2 838
     * jetons au catalogue, les 110 pour lesquels une impression française a été
     * cherchée sont toutes « introuvables ». Le nom est donc peint par-dessus.
     *
     * Et c’est exactement le genre d’affordance qui fuit. Un bandeau qui
     * s’afficherait sur un jeton retourné dirait à la table ce que seul son
     * propriétaire a le droit de savoir. À un seul siège on ne peut rien en
     * prouver : `faceDown` y vaut toujours `false`, même sur un permanent posé
     * face cachée (c’est `facedownOnTable` qui le dit). On regarde donc le DOM
     * réellement peint **chez le voisin**, à qui le serveur n’envoie ni nom ni
     * `scryfallId`.
     */
    const { voisin } = await ouvrirSecondSiege('Denis');

    // Un Trésor, par le chemin le plus court : le menu « Créer », comme le fait
     // déjà l’étape de l’étagère. « Treasure » est au glossaire, et son nom
    // français en diffère — sans quoi le pas passerait sans rien montrer.
    const avant = await page.evaluate(() =>
      [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').map((c) => c.id),
    );
    await page.getByRole('button', { name: /Créer/ }).click();
    await page.getByRole('button', { name: 'Treasure', exact: true }).click();
    const id = await page
      .waitForFunction(
        (deja) => {
          const neuf = [...window.__mtg.getState().cards.values()].filter(
            (c) => c.kind === 'TOKEN' && !deja.includes(c.id),
          );
          return neuf.length > 0 ? neuf[neuf.length - 1].id : null;
        },
        avant,
        { timeout: 15000 },
      )
      .then((h) => h.jsonValue());

    // 1. Chez son créateur : le bandeau porte bien le nom **français**.
    const bandeau = page.locator(`[data-card="${id}"] [data-test="token-name-band"]`);
    await bandeau.waitFor({ timeout: 10000 });
    const ecrit = (await bandeau.textContent())?.trim();
    if (ecrit !== 'Trésor') {
      throw new Error(`le bandeau du jeton dit « ${ecrit} » au lieu de « Trésor »`);
    }

    /*
     * 2. Il doit être **inerte au pointeur** et **discret**. La table repose
     *    entièrement sur le survol et le glisser-déposer, et un bandeau posé en
     *    bas d’une carte se trouve précisément là où l’on attrape un permanent :
     *    s’il interceptait le pointeur, on ne pourrait plus déplacer un jeton en
     *    le prenant par le bas. Et il doit rester une bande basse — on ajoute
     *    une affordance, on ne redessine pas la carte.
     */
    const forme = await page.evaluate((cardId) => {
      const carte = document.querySelector(`[data-card="${cardId}"]`);
      const bande = carte?.querySelector('[data-test="token-name-band"]');
      if (!carte || !bande) return null;
      const c = carte.getBoundingClientRect();
      const b = bande.getBoundingClientRect();
      return {
        pointerEvents: getComputedStyle(bande).pointerEvents,
        largeurRelative: b.width / c.width,
        hauteurRelative: b.height / c.height,
        dessus: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(
          '[data-test="token-name-band"]',
        )
          ? 'le bandeau'
          : 'la carte',
      };
    }, id);
    if (!forme) throw new Error('bandeau introuvable dans le DOM du jeton');
    if (forme.pointerEvents !== 'none') {
      throw new Error(`le bandeau intercepte le pointeur (pointer-events: ${forme.pointerEvents})`);
    }
    if (forme.dessus !== 'la carte') {
      throw new Error('le point sous le bandeau désigne le bandeau et non la carte');
    }
    if (forme.hauteurRelative > 0.3) {
      throw new Error(
        `le bandeau couvre ${Math.round(forme.hauteurRelative * 100)} % de la hauteur de la carte`,
      );
    }
    console.log(
      `      bandeau « ${ecrit} » : ${Math.round(forme.hauteurRelative * 100)} % de la hauteur, inerte au pointeur`,
    );

    // 3. Le voisin, qui voit le jeton face visible, lit le même nom.
    await voisin.locator(`[data-card="${id}"] [data-test="token-name-band"]`).waitFor({ timeout: 10000 });

    /*
     * 4. L’invariant : **rien de ce que le client ne sait pas identifier ne
     *    porte de bandeau**.
     *
     * Pourquoi ce n’est pas un jeton qu’on retourne ici. `CREATE_TOKEN` inscrit
     * le jeton dans le `knownTo` de **tous les sièges assis** (engine-2), et
     * `knownTo` est monotone : `TURN_FACE_DOWN` sur un jeton que la table a vu
     * naître ne le cache donc à personne, et c’est voulu — c’est la réalité
     * physique du geste. Un jeton à la fois **face cachée** et **inconnu** n’est
     * pas atteignable depuis l’interface à une table où chacun était là à sa
     * création ; cette branche-là se vérifie au test unitaire
     * (`apps/web/test/jetons-noms-fr.test.ts`), où l’on peut fabriquer la vue.
     *
     * Ce qui est atteignable, et qui est le vrai risque, c’est qu’un bandeau
     * s’échappe sur un **dos de carte**. On en fabrique donc un vrai — le
     * voisin pose un morph, que nous n’avons jamais vu — puis on balaie la
     * page entière : aucune carte dont la vue dit `faceDown` ne doit porter de
     * bandeau, et il doit y en avoir au moins une, sinon on ne prouve rien.
     */
    // Le voisin a joué et défaussé depuis le début de la recette : sa main peut
    // être vide, et l'on mesurerait alors l'absence de carte plutôt que celle de
    // bandeau.
    await voisin.evaluate(() => window.__mtg.getState().send({ type: 'DRAW', count: 2 }));
    await voisin.waitForFunction(
      () => {
        const s = window.__mtg.getState();
        return [...s.cards.values()].some((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat);
      },
      null,
      { timeout: 10000 },
    );
    const morph = await voisin.evaluate(() => {
      const s = window.__mtg.getState();
      const carte = [...s.cards.values()].find(
        (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
      );
      if (!carte) return null;
      s.send({
        type: 'MOVE_CARD',
        cardId: carte.id,
        to: { seat: s.mySeat, kind: 'BATTLEFIELD' },
        x: 120,
        y: 120,
        faceDown: true,
      });
      return carte.id;
    });
    if (!morph) throw new Error('le voisin n’a plus de carte en main pour poser un morph');
    await page.waitForFunction(
      (cardId) => window.__mtg.getState().cards.get(cardId)?.faceDown === true,
      morph,
      { timeout: 10000 },
    );
    await page.waitForTimeout(300);

    const balayage = await page.evaluate(() => {
      const s = window.__mtg.getState();
      const dos = [];
      const fuites = [];
      for (const el of document.querySelectorAll('[data-card]')) {
        const vue = s.cards.get(el.getAttribute('data-card'));
        // Sans vue, ce n'est pas une carte de la partie (fantôme de glissement,
        // aperçu) : on ne compte que ce dont le store dit qu'il est un dos.
        if (!vue || vue.faceDown === false) continue;
        dos.push(el.getAttribute('data-card'));
        if (el.querySelector('[data-test="token-name-band"]')) {
          fuites.push({ id: el.getAttribute('data-card'), texte: el.textContent.trim() });
        }
      }
      return { dos, fuites };
    });
    if (balayage.dos.length === 0) {
      throw new Error('aucun dos de carte à l’écran : le balayage ne prouverait rien');
    }
    if (balayage.fuites.length > 0) {
      throw new Error(
        `fuite : ${balayage.fuites.length} carte(s) face cachée(s) portent un bandeau de nom — ` +
          JSON.stringify(balayage.fuites),
      );
    }
    console.log(
      `      ${balayage.dos.length} dos de carte à l’écran, aucun ne porte de bandeau de nom`,
    );

    // On rend la table comme on l’a trouvée : le morph du voisin repart en main.
    await voisin.evaluate(
      (cardId) => {
        const s = window.__mtg.getState();
        s.send({ type: 'MOVE_CARD', cardId, to: { seat: s.mySeat, kind: 'HAND' } });
      },
      morph,
    );
  });

  await step('l’aperçu agrandi d’un jeton porte le nom français, comme la carte', async () => {
    /*
     * Pourquoi ce pas s’ajoute à celui du bandeau, juste au-dessus.
     *
     * Le bandeau est peint par `CardSprite`, l’aperçu agrandi par
     * `CardPreview` : deux composants, deux calculs du nom. Le second ne passait
     * pas par le glossaire, et la table affichait donc « Ange » sur le jeton et
     * « Angel » dans le panneau ouvert juste à côté — la contradiction la plus
     * visible qu’on puisse mettre à l’écran, puisque les deux se lisent d’un
     * seul coup d’œil. Le pas du bandeau ne l’attrapait pas : il ne regarde que
     * la carte.
     *
     * On vérifie le **texte peint** et l’`alt` de l’illustration, parce que ce
     * sont les deux sorties du même nom et qu’un lecteur d’écran n’a que la
     * seconde.
     */
    await unhover();

    // « Treasure » pour la même raison qu’au pas du bandeau : il est au
    // glossaire et son nom français en diffère, sans quoi on ne prouverait rien.
    const avant = await page.evaluate(() =>
      [...window.__mtg.getState().cards.values()].filter((c) => c.kind === 'TOKEN').map((c) => c.id),
    );
    await page.getByRole('button', { name: /Créer/ }).click();
    await page.getByRole('button', { name: 'Treasure', exact: true }).click();
    const id = await page
      .waitForFunction(
        (deja) => {
          const neuf = [...window.__mtg.getState().cards.values()].filter(
            (c) => c.kind === 'TOKEN' && !deja.includes(c.id),
          );
          return neuf.length > 0 ? neuf[neuf.length - 1].id : null;
        },
        avant,
        { timeout: 15000 },
      )
      .then((h) => h.jsonValue());

    const jeton = page.locator(`[data-card="${id}"]`).first();
    await jeton.waitFor({ timeout: 10000 });
    await hover(jeton);

    const preview = page.locator('[data-test="card-preview"]');
    await preview.waitFor({ timeout: 5000 });

    /*
     * Les métadonnées arrivent par lots : le panneau peut être peint avant le
     * nom. On attend le texte plutôt que de le lire une fois — sans quoi le pas
     * serait intermittent pour une raison qui n’a rien à voir avec ce qu’il
     * vérifie.
     */
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-test="card-preview"]');
          return (el?.textContent ?? '').includes('Trésor');
        },
        null,
        { timeout: 10000 },
      )
      .catch(async () => {
        const vu = (await preview.textContent())?.trim() ?? '(aperçu vide)';
        throw new Error(`l’aperçu du jeton dit « ${vu} » et non « Trésor »`);
      });

    const alt = await preview.locator('[data-test="card-preview-image"]').getAttribute('alt');
    if (alt !== 'Trésor') {
      throw new Error(`l’illustration de l’aperçu a pour alt « ${alt} » au lieu de « Trésor »`);
    }
    // Et le nom anglais ne doit pas rester **à côté** du français : un panneau
    // qui dirait les deux serait aussi déroutant qu’un panneau anglais.
    const texte = (await preview.textContent())?.trim() ?? '';
    if (texte.includes('Treasure')) {
      throw new Error(`l’aperçu montre encore le nom anglais : « ${texte} »`);
    }
    console.log(`      aperçu du jeton : « ${alt} »`);
    await page.screenshot({ path: `${OUT}/ui-jeton-apercu-fr.png` });
    await unhover();
  });

  await step('à deux sièges, décrocher une étiquette ne la déplace pas', async () => {
    /*
     * Pourquoi cette étape existe **en plus** de celle qui décroche déjà une
     * étiquette plus haut.
     *
     * Le décrochage fait passer des coordonnées **relatives à une carte** à des
     * coordonnées du monde **partagé**. Or ce qui s'affiche parle le repère de
     * **vue** — les cases sont réattribuées pour que notre siège soit en bas —
     * et la traduction entre les deux est, à un seul siège, l'identité. Une
     * étape jouée seul ne peut donc rien prouver sur ce point : elle passait
     * pendant que le décrochage renvoyait au serveur une position de vue prise
     * pour une position partagée, et l'étiquette sautait d'une case entière dès
     * qu'un second joueur était assis. On monte donc un vrai second siège.
     */
    {
      // Le second client est partagé avec l'étape d'attachement qui suit : la
      // place qu'il occupe ne se rend pas.
      await ouvrirSecondSiege('Denis');
      await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
      await page.waitForTimeout(500);

      // Un permanent à nous, et une étiquette accrochée dessus. On la crée
      // déjà accrochée : ses x/y sont alors un décalage relatif, une grandeur
      // qui ne traverse aucune traduction, donc une mise en place sans
      // ambiguïté — c'est le décrochage qu'on veut mesurer, pas l'accrochage.
      const seatMoi = await page.evaluate(() => window.__mtg.getState().mySeat);
      const mine = () =>
        page.evaluate(() => {
          const s = window.__mtg.getState();
          return [...s.cards.values()].find(
            (c) => c.zone.kind === 'BATTLEFIELD' && c.zone.seat === s.mySeat,
          )?.id;
        });
      if (!(await mine())) {
        // Les étapes précédentes ont pu vider notre terrain : on y repose une
        // carte plutôt que de tomber pour une raison qui n'est pas la nôtre.
        await page.evaluate(() => {
          const s = window.__mtg.getState();
          const card = [...s.cards.values()].find(
            (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
          );
          if (card) {
            s.send({ type: 'MOVE_CARD', cardId: card.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 140, y: 120 });
          } else {
            s.send({ type: 'DRAW', count: 1 });
          }
        });
        await page.waitForTimeout(900);
      }
      const target = await mine();
      if (!target) throw new Error('aucun permanent à nous pour porter l’étiquette');
      await page.evaluate(() => {
        const s = window.__mtg.getState();
        for (const l of s.labels) s.send({ type: 'REMOVE_LABEL', labelId: l.id });
      });
      await page.waitForFunction(() => window.__mtg.getState().labels.length === 0, null, { timeout: 8000 });
      /*
       * Une étiquette **flottante**, posée par le geste réel — clic droit sur
       * un point de notre champ de bataille, puis « Poser une étiquette ». On
       * vise un point réellement visible : le panneau déborde souvent du cadre
       * à deux sièges, et un clic calculé hors de l'écran serait ramené au bord
       * par le pilote, donc posé ailleurs qu'on ne croit.
       */
      const zoneBox = await page.locator(`[data-zone="${seatMoi}|BATTLEFIELD"]`).boundingBox();
      const vue = page.viewportSize();
      const point = {
        x: Math.min(Math.max(zoneBox.x + zoneBox.width * 0.55, 20), vue.width - 20),
        y: Math.min(
          Math.max(zoneBox.y + zoneBox.height * 0.5, TOP_BAR + 20),
          vue.height - HAND_RAIL - 20,
        ),
      };
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page
        .locator('[data-test="table-menu"] button')
        .filter({ hasText: 'Poser une étiquette' })
        .click();
      await page.locator('[data-test="table-menu-input"]').fill('repère');
      await page.locator('[data-test="table-menu-input"]').press('Enter');
      await page.waitForFunction(() => window.__mtg.getState().labels.length === 1, null, { timeout: 8000 });
      const labelId = await page.evaluate(() => window.__mtg.getState().labels[0].id);
      await page.locator(`[data-label="${labelId}"]`).waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);

      /*
       * Position **dans le plan de table**, et non à l'écran.
       *
       * Le cadrage se recale tout seul (bornes de caméra, arrivée d'un siège) :
       * une mesure en pixels d'écran confondrait un recentrage avec un
       * déplacement de l'étiquette. Le `left`/`top` du nœud, lui, est la
       * position dans le plan, exactement ce que l'on veut voir immobile.
       */
      const place = async () =>
        page.evaluate((id) => {
          const el = document.querySelector(`[data-label="${id}"]`);
          const l = window.__mtg.getState().labels.find((x) => x.id === id);
          return {
            left: Number.parseFloat(el.style.left),
            top: Number.parseFloat(el.style.top),
            etat: { x: l.x, y: l.y, attachedTo: l.attachedTo ?? null },
          };
        }, labelId);

      const libre = await place();

      // 1. L'accrochage ne déplace pas l'étiquette : ses x/y deviennent un
      //    décalage relatif à la carte, ce qui est un changement de repère et
      //    non un déménagement.
      await page.locator(`[data-label="${labelId}"]`).click({ button: 'right' });
      await page
        .locator('[data-test="label-menu"] button')
        .filter({ hasText: 'Accrocher' })
        .first()
        .click();
      await page.locator('[data-test="attach-pending"]').waitFor({ timeout: 6000 });
      await page.locator(`[data-card="${target}"]`).click();
      await page.waitForFunction(
        ([id, card]) => window.__mtg.getState().labels.find((l) => l.id === id)?.attachedTo === card,
        [labelId, target],
        { timeout: 8000 },
      );
      await page.waitForTimeout(1800);
      const accrochee = await place();
      const sautAccrochage = Math.hypot(accrochee.left - libre.left, accrochee.top - libre.top);
      console.log(
        `      libre ${JSON.stringify(libre.etat)} en ${Math.round(libre.left)},${Math.round(libre.top)} ` +
          `→ accrochée ${JSON.stringify(accrochee.etat)} en ${Math.round(accrochee.left)},${Math.round(accrochee.top)} ` +
          `(saut ${sautAccrochage.toFixed(1)} px de plan)`,
      );
      if (sautAccrochage > 4) {
        throw new Error(`l’étiquette a sauté de ${Math.round(sautAccrochage)} px en s’accrochant`);
      }

      const avant = accrochee;
      const etatAvant = accrochee.etat;

      // 2. Et le décrochage la laisse où elle est, en lui rendant des
      //    coordonnées de monde partagé.
      await page.locator(`[data-label="${labelId}"]`).click({ button: 'right' });
      await page.locator('[data-test="label-menu"] button').filter({ hasText: 'Décrocher' }).click();
      await page.waitForFunction(
        (id) => !window.__mtg.getState().labels.find((l) => l.id === id)?.attachedTo,
        labelId,
        { timeout: 8000 },
      );
      // La prise locale se relâche au plus tard après 1,5 s : on lui laisse le
      // temps, sinon l'on mesurerait un geste encore tenu plutôt que l'état.
      await page.waitForTimeout(1800);

      const apres = await place();
      const saut = Math.hypot(apres.left - avant.left, apres.top - avant.top);
      console.log(
        `      accrochée ${JSON.stringify(etatAvant)} → libre ${JSON.stringify(apres.etat)} ; ` +
          `saut ${saut.toFixed(1)} px de plan`,
      );
      if (saut > 4) {
        throw new Error(
          `l’étiquette a sauté de ${Math.round(saut)} px en se décrochant : ` +
            `plan ${Math.round(avant.left)},${Math.round(avant.top)} puis ${Math.round(apres.left)},${Math.round(apres.top)}`,
        );
      }
      /*
       * Et l'aller-retour est exact : une étiquette accrochée puis décrochée
       * doit retrouver **les mêmes** coordonnées partagées. C'est la
       * vérification qui ne dépend d'aucun pixel — celle qui dirait encore la
       * vérité si le cadrage changeait sous nos pieds.
       */
      if (apres.etat.x !== libre.etat.x || apres.etat.y !== libre.etat.y) {
        throw new Error(
          `l’aller-retour a déplacé l’étiquette dans le repère partagé : ` +
            `${libre.etat.x},${libre.etat.y} puis ${apres.etat.x},${apres.etat.y}`,
        );
      }
      await page.screenshot({ path: `${OUT}/ui-23b-decrochage-deux-sieges.png` });
      await page.evaluate(
        (id) => window.__mtg.getState().send({ type: 'REMOVE_LABEL', labelId: id }),
        labelId,
      );
    }
  });

  await step('à deux sièges, un permanent emmène ce qui lui est attaché, pendant le geste comme après', async () => {
    /*
     * Deux défauts distincts vivaient ici, et un seul des deux se voyait à
     * l'arrivée.
     *
     * 1. Le lasso qui prenait **à la fois** un permanent et ce qui lui est
     *    attaché : au dépôt, le client envoyait un `DETACH` pour toute carte
     *    attachée du lot, y compris quand son porteur voyageait avec elle. Une
     *    aura se décrochait donc à chaque déplacement de groupe.
     * 2. Pendant le glissement du porteur, la carte attachée — qui se rend à une
     *    position **dérivée** de son porteur — perdait son ancre : le porteur
     *    était retiré de la liste du panneau le temps du geste, et l'attachée
     *    retombait sur ses propres coordonnées, périmées depuis l'accrochage.
     *    Elle sautait à travers le terrain, puis revenait en place au
     *    relâchement — invisible pour qui ne mesure qu'à l'arrivée.
     *
     * D'où la forme de cette étape : on mesure **pointeur encore enfoncé**, à
     * chaque pas, et pas seulement une fois lâché. Et à deux sièges, parce qu'à
     * un seul la réattribution des cases est l'identité et qu'un défaut de
     * repère n'y apparaît pas.
     */
    // Le second client est celui de l'étape précédente : c'est ici qu'on le
    // ferme, une fois la dernière mesure prise.
    const { voisin: pageE } = await ouvrirSecondSiege('Denis');
    try {
      await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
      await page.getByRole('button', { name: 'Recentrer sur moi' }).click();
      await page.waitForTimeout(500);

      /*
       * Deux permanents à nous, à des coordonnées franchement distinctes. C'est
       * l'écart entre les coordonnées **propres** de l'attachée et sa position
       * de rendu — sous son porteur — qui rend le défaut mesurable : les poser
       * côte à côte le masquerait.
       */
      const ids = await page.evaluate(() => {
        const s = window.__mtg.getState();
        const sur = [...s.cards.values()].filter(
          (c) => c.zone.kind === 'BATTLEFIELD' && c.zone.seat === s.mySeat,
        );
        const main = [...s.cards.values()].filter(
          (c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat,
        );
        const deux = [...sur, ...main].slice(0, 2);
        if (deux.length < 2) return null;
        const [porteur, aura] = deux;
        s.send({ type: 'MOVE_CARD', cardId: porteur.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 220, y: 150 });
        s.send({ type: 'MOVE_CARD', cardId: aura.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 620, y: 380 });
        return { porteur: porteur.id, aura: aura.id, seat: s.mySeat };
      });
      if (!ids) throw new Error('pas assez de cartes pour un porteur et un attachement');
      await page.waitForFunction(
        ([p, a]) => {
          const s = window.__mtg.getState();
          return s.cards.get(p)?.x === 220 && s.cards.get(a)?.x === 620;
        },
        [ids.porteur, ids.aura],
        { timeout: 10000 },
      );
      await page.evaluate(
        ([s, t]) => window.__mtg.getState().send({ type: 'ATTACH', sourceId: s, targetId: t }),
        [ids.aura, ids.porteur],
      );
      await page.waitForFunction(
        ([s, t]) => window.__mtg.getState().cards.get(s)?.attachedTo === t,
        [ids.aura, ids.porteur],
        { timeout: 10000 },
      );
      await page.waitForTimeout(500);

      /*
       * Position **de plan**, et non à l'écran : le `left`/`top` du nœud. Le
       * cadrage se recale tout seul, et une mesure en pixels d'écran
       * confondrait un recentrage avec un déplacement de la carte.
       */
      const plan = (cible, id) =>
        cible.evaluate((cardId) => {
          const el = document.querySelector(`[data-card-id="${cardId}"]`);
          if (!el) return null;
          return { x: Number.parseFloat(el.style.left), y: Number.parseFloat(el.style.top) };
        }, id);
      const modele = (cible, id) =>
        cible.evaluate((cardId) => {
          const c = window.__mtg.getState().cards.get(cardId);
          return c ? { x: c.x, y: c.y, attachedTo: c.attachedTo ?? null } : null;
        }, id);
      const ecart = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY);
      const dit = (p) => (p ? `${Math.round(p.x)},${Math.round(p.y)}` : '—');

      /**
       * Un glissement instrumenté : à chaque pas, **pointeur encore enfoncé**,
       * on relève la position de plan de la carte suivie, des deux côtés de la
       * table.
       */
      const glisser = async (tenue, delta, titre, suivie, prise = { fx: 0.5, fy: 0.5 }) => {
        const zone = await page.locator(`[data-zone="${ids.seat}|BATTLEFIELD"]`).boundingBox();
        const box = await page.locator(`[data-card-id="${tenue}"]`).boundingBox();
        if (!zone || !box) throw new Error('carte ou panneau hors du cadre');
        const from = { x: box.x + box.width * prise.fx, y: box.y + box.height * prise.fy };
        const to = {
          x: Math.min(Math.max(from.x + delta.x, zone.x + 60), zone.x + zone.width - 60),
          y: Math.min(Math.max(from.y + delta.y, zone.y + 60), zone.y + zone.height - 60),
        };
        const depart = { A: await plan(page, suivie), B: await plan(pageE, suivie) };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        const pas = [];
        for (let i = 1; i <= 8; i++) {
          await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
          await page.waitForTimeout(60);
          pas.push({ A: await plan(page, suivie), B: await plan(pageE, suivie) });
        }
        const deriveA = Math.max(...pas.map((p) => ecart(p.A, depart.A)));
        const deriveB = Math.max(...pas.map((p) => ecart(p.B, depart.B)));
        console.log(
          `      ${titre} : suivie ${dit(depart.A)} → ` +
            pas.map((p) => dit(p.A)).join(' ') +
            ` (dérive max pointeur enfoncé ${deriveA.toFixed(1)} px chez nous, ${deriveB.toFixed(1)} px en face)`,
        );
        await page.mouse.up();
        await page.waitForTimeout(1200);
        return { deriveA, deriveB };
      };

      /**
       * Décalage de rendu d'une carte attachée, **lu sur la page**.
       *
       * C'était une copie en dur, et elle a survécu à deux resserrages de
       * `ATTACH_OFFSET_X/Y` : l'étape tombait sur trois pixels d'écart alors
       * que le rendu était sain, et l'on a cherché le défaut du mauvais côté
       * avant de trouver le nombre périmé. Le panneau publie donc maintenant
       * ses constantes sur la zone de champ de bataille, comme il y publie
       * déjà `data-zone` et `data-mine` pour cette même recette.
       *
       * Si l'attribut manque, on tombe bruyamment plutôt que de se rabattre
       * sur une valeur devinée : une recette qui s'accommode d'une source
       * absente est exactement ce qui a produit le faux diagnostic.
       */
      const lireAttache = async (cible) => {
        const brut = await cible.evaluate(() => {
          const zone = document.querySelector('[data-attach-offset]');
          return zone ? zone.dataset.attachOffset : null;
        });
        if (!brut) {
          throw new Error(
            "le panneau ne publie plus data-attach-offset : impossible de savoir où l'attachée devrait se ranger",
          );
        }
        const [x, y] = brut.split(',').map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error(`data-attach-offset illisible : « ${brut} »`);
        }
        return { x, y };
      };
      const ATTACHE = await lireAttache(page);
      console.log(`      décalage d'attachement publié par le panneau : ${ATTACHE.x} × ${ATTACHE.y}`);
      const sousSonPorteur = async (cible, ou) => {
        const porteur = await plan(cible, ids.porteur);
        const aura = await plan(cible, ids.aura);
        const attendu = porteur ? { x: porteur.x + ATTACHE.x, y: porteur.y + ATTACHE.y } : null;
        const derive = ecart(aura, attendu);
        if (derive > 1) {
          throw new Error(
            `${ou} : l’attachée est en ${dit(aura)} au lieu de ${dit(attendu)} (porteur en ${dit(porteur)})`,
          );
        }
      };

      // 1. Le porteur seul. Ce qui lui est attaché ne doit pas bouger d'un
      //    pixel tant que le geste dure, puis se ranger sous lui au dépôt.
      const g1 = await glisser(ids.porteur, { x: 170, y: 90 }, 'porteur seul', ids.aura);
      if (g1.deriveA > 3 || g1.deriveB > 3) {
        throw new Error(
          `la carte attachée saute pendant le glissement du porteur : ` +
            `${g1.deriveA.toFixed(1)} px chez nous, ${g1.deriveB.toFixed(1)} px en face`,
        );
      }
      await sousSonPorteur(page, 'après le dépôt du porteur seul');
      const etat1 = await modele(page, ids.aura);
      if (etat1.attachedTo !== ids.porteur) throw new Error('le porteur glissé seul a perdu son attachement');

      // 2. Le lasso prend les deux, et le lot voyage sans se défaire.
      await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));
      await lassoAround([
        page.locator(`[data-card-id="${ids.porteur}"]`),
        page.locator(`[data-card-id="${ids.aura}"]`),
      ]);
      const pris = await page.evaluate(() => [...window.__mtg.getState().selection]);
      if (!pris.includes(ids.porteur) || !pris.includes(ids.aura)) {
        throw new Error(`le lasso n’a pas pris les deux cartes (${pris.length} prise(s))`);
      }
      const avant = { porteur: await modele(page, ids.porteur), aura: await modele(page, ids.aura) };
      const g2 = await glisser(ids.porteur, { x: -150, y: -70 }, 'lasso : porteur + attachée', ids.aura);
      if (g2.deriveA > 3 || g2.deriveB > 3) {
        throw new Error(
          `la carte attachée saute pendant le glissement du lot : ` +
            `${g2.deriveA.toFixed(1)} px chez nous, ${g2.deriveB.toFixed(1)} px en face`,
        );
      }
      const apres = { porteur: await modele(page, ids.porteur), aura: await modele(page, ids.aura) };
      if (apres.aura.attachedTo !== ids.porteur) {
        throw new Error(`le lasso a détaché la carte : attachedTo=${apres.aura.attachedTo}`);
      }
      const dPorteur = { x: apres.porteur.x - avant.porteur.x, y: apres.porteur.y - avant.porteur.y };
      const dAura = { x: apres.aura.x - avant.aura.x, y: apres.aura.y - avant.aura.y };
      if (ecart(dPorteur, dAura) > 2) {
        throw new Error(`le lot ne s’est pas translaté d’un bloc : ${dit(dPorteur)} contre ${dit(dAura)}`);
      }
      await sousSonPorteur(page, 'après le dépôt du lot');
      await sousSonPorteur(pageE, 'chez le second siège');
      console.log(
        `      lot translaté de ${dit(dPorteur)}, attachement intact des deux côtés ` +
          `(${pris.length} carte(s) au lasso)`,
      );

      // 3. Et le geste explicite détache toujours : tirer la **seule** carte
      //    attachée hors de son porteur. Elle passe sous lui : on la saisit par
      //    la bande qui dépasse, en bas à droite, comme le ferait un joueur.
      await page.evaluate(() => window.__mtg.getState().setSelection(new Set()));

      /*
       * La prise est **cherchée**, pas devinée.
       *
       * Elle valait 0,9 × 0,93 — le coin bas-droit, choisi quand l'attachée
       * dépassait par là. Mais le champ de bataille est encombré à ce
       * moment-là, et ce coin tombait sur **une autre carte** posée par-dessus :
       * le geste saisissait la mauvaise, rien ne partait, et l'étape concluait
       * « le détachement ne marche pas ». Elle accusait le moteur d'un défaut
       * qui était dans la recette, et n'a jamais éprouvé ce qu'elle annonce.
       *
       * On interroge donc le rendu : quel point de l'attachée est réellement
       * **elle**, sous le pointeur ? On balaie du bas-droit — la bande qui
       * dépasse, là où un joueur la saisirait — vers le centre. Si aucun point
       * ne répond, c'est que l'attachée est entièrement recouverte : ce
       * serait un vrai défaut d'affichage, et l'étape doit le dire, pas
       * l'enjamber.
       */
      const prise = await page.evaluate(
        (id) => {
          const el = document.querySelector(`[data-card-id="${id}"]`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const fractions = [0.95, 0.9, 0.82, 0.74, 0.66, 0.58, 0.5];
          for (const fy of fractions) {
            for (const fx of fractions) {
              const cible = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
              if (cible?.closest('[data-card-id]')?.getAttribute('data-card-id') === id) {
                return { fx, fy, balise: cible.tagName.toLowerCase() };
              }
            }
          }
          // Rien n'a répondu : on dit **qui** recouvre, pour que le rapport
          // désigne quelque chose plutôt que de constater un vide.
          const dessus = document.elementFromPoint(r.x + r.width * 0.9, r.y + r.height * 0.93);
          return {
            fx: null,
            fy: null,
            recouvertePar: dessus?.closest('[data-card-id]')?.getAttribute('data-card-id') ?? null,
          };
        },
        ids.aura,
      );
      if (!prise || prise.fx === null) {
        throw new Error(
          'aucun point de la carte attachée ne lui appartient à l’écran : elle est ' +
            `entièrement recouverte (par ${prise?.recouvertePar ?? 'un élément inconnu'}), ` +
            'donc insaisissable à la main',
        );
      }
      console.log(
        `      prise de l’attachée trouvée à ${prise.fx} × ${prise.fy} de sa carte ` +
          `(élément <${prise.balise}>)`,
      );

      await page.evaluate(() => (window.__sentIntents.length = 0));
      await glisser(
        ids.aura,
        { x: 190, y: 110 },
        'l’attachée seule, tirée hors de son porteur',
        ids.porteur,
        prise,
      );
      const partis = await page.evaluate(() =>
        window.__sentIntents
          .map((f) => {
            try {
              return JSON.parse(f).intent?.type ?? '?';
            } catch {
              return '?';
            }
          })
          .join(', '),
      );
      console.log(`      intents émis par le geste : ${partis || '(aucun)'}`);
      const detachee = await modele(page, ids.aura);
      if (detachee.attachedTo !== null) {
        throw new Error(
          `tirer la seule carte attachée aurait dû la détacher (intents émis : ${partis || 'aucun'})`,
        );
      }
      await page.screenshot({ path: `${OUT}/ui-23c-attachement-deux-sieges.png` });
    } finally {
      await fermerSecondSiege();
    }
  });

  await step('le dessus révélé se voit chez l’adversaire, suit la pioche, puis disparaît', async () => {
    /*
     * La révélation permanente du dessus (« jouez avec le dessus de votre
     * bibliothèque révélé ») n'a de sens que vue d'en face : c'est l'adversaire
     * qui doit voir la carte, et la voir changer à chaque pioche. On l'éprouve
     * donc à deux sièges et sur le DOM réellement peint, pas sur le store seul.
     *
     * Trois choses, dans cet ordre, parce que c'est l'ordre dans lequel elles
     * cassent : la carte **apparaît** sur la pile du révélateur, elle **suit**
     * la pioche, et elle **disparaît** quand la révélation s'arrête. La
     * troisième est la plus importante : une carte qui reste affichée après
     * l'arrêt est une fuite d'information cachée.
     */
    const roomUrl = page.url();
    const contextC = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pageC = await contextC.newPage();
    try {
      const avant = await page.evaluate(() => window.__mtg.getState().seats.length);
      await pageC.goto(roomUrl, { waitUntil: 'domcontentloaded' });
      await pageC.getByPlaceholder('Invité').fill('Carole');
      // Carole n'a pas besoin de bibliothèque pour cette étape — c'est celle
      // d'Alice qu'on regarde — mais on lui en donne une si le salon la
      // demande : une fois la partie lancée, le champ n'est pas toujours là.
      const deckC = pageC.locator('textarea').first();
      if ((await deckC.count()) > 0) await deckC.fill(DECK);
      await pageC.getByRole('button', { name: "S'asseoir à la table" }).click();
      await pageC.getByText('Journal').waitFor({ timeout: 20000 });
      await page.waitForFunction((n) => window.__mtg.getState().seats.length > n, avant, {
        timeout: 15000,
      });

      const seatA = await page.evaluate(() => window.__mtg.getState().mySeat);
      const seatC = await pageC.evaluate(() => window.__mtg.getState().mySeat);

      // Carole doit avoir la pile d'Alice à l'écran : c'est celle-là qu'on lit.
      await pageC.getByRole('button', { name: 'Voir toute la table' }).click();
      await pageC.waitForTimeout(500);

      /**
       * « L'image peinte est-elle bien celle de cette carte-là ? »
       *
       * L'étape comparait l'URL peinte à l'identifiant de catalogue, en
       * espérant l'y trouver. C'était vrai tant que la table peignait
       * l'anglais ; ça ne l'est plus : dès que l'impression **localisée**
       * arrive, la pile peint l'image de cette impression-là, dont l'URL ne
       * contient pas l'identifiant de catalogue. L'assertion devenait donc
       * vraie ou fausse selon que le lot de traduction était rentré ou non
       * avant la mesure — un rouge qui va et vient, et qui n'accuse rien de
       * réel.
       *
       * On résout donc l'attente **comme l'application la résout** : l'image
       * du catalogue, ou l'une de celles que `POST /api/cards/localized` rend
       * pour la langue en cours. L'exigence est la même — c'est bien cette
       * carte-là qui est peinte — seule la façon de l'établir a changé.
       */
      const imagesAttendues = (cible, scryfallId) =>
        cible.evaluate(async (id) => {
          const langue =
            (() => {
              try {
                return window.localStorage.getItem('mtg.language');
              } catch {
                return null;
              }
            })() ??
            document.documentElement.lang ??
            'en';
          const urls = [];
          try {
            const res = await fetch('/api/cards/localized', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ ids: [id], language: langue }),
            });
            if (res.ok) {
              const { cards } = await res.json();
              for (const carte of cards ?? []) {
                // L'impression localisée porte son propre identifiant Scryfall :
                // c'est lui qui se lit dans l'URL de l'image peinte.
                if (carte?.localizedScryfallId) urls.push(carte.localizedScryfallId);
                for (const url of Object.values(carte?.imageUris ?? {})) {
                  if (typeof url === 'string') urls.push(url);
                }
                for (const face of carte?.faces ?? []) {
                  for (const url of Object.values(face?.imageUris ?? {})) {
                    if (typeof url === 'string') urls.push(url);
                  }
                }
              }
            }
          } catch {
            /* pas de traduction servie : l'image du catalogue reste attendue. */
          }
          return urls;
        }, scryfallId);

      /** L'image peinte montre-t-elle bien la carte connue ? */
      const peintBien = async (cible, vue) => {
        if (!vue.face || !vue.connue) return false;
        if (vue.face.includes(vue.connue)) return true;
        // La chaîne de requête (`?1782862134`) est un jeton de cache Scryfall :
        // elle n'identifie pas l'image, et la comparer ferait échouer l'étape
        // au prochain rafraîchissement du catalogue.
        const sansJeton = (url) => url.split('?')[0];
        const attendues = await imagesAttendues(cible, vue.connue);
        return attendues.some(
          (attendue) =>
            sansJeton(attendue) === sansJeton(vue.face) || vue.face.includes(attendue),
        );
      };

      /** Ce que Carole voit de la bibliothèque d'Alice, store et DOM ensemble. */
      const chezCarole = () =>
        pageC.evaluate((owner) => {
          const s = window.__mtg.getState();
          const id = s.topReveals.get(owner)?.cardId ?? null;
          const pile = document.querySelector(`[data-zone="${owner}|LIBRARY"]`);
          const face = pile?.querySelector('img[src*="cards.scryfall.io"]') ?? null;
          const dos = pile?.querySelector('img[src*="backs.scryfall.io"]') ?? null;
          const oeil = pile?.querySelector('[data-test="top-revealed"]') ?? null;
          // Ancre, et non « le premier `span` qui contient un nombre » : la
          // pastille de mécaniques de la carte révélée en porte un aussi, et
          // passait devant selon la carte tirée.
          const compte = (pile?.querySelector('[data-test="pile-count"]')?.textContent ?? '').trim() || undefined;
          return {
            cardId: id,
            connue: id === null ? null : (s.cards.get(id)?.scryfallId ?? null),
            face: face?.getAttribute('src') ?? null,
            dos: Boolean(dos),
            oeil: oeil?.getAttribute('title') ?? null,
            compte: compte ?? null,
            attendu: String(s.zoneCounts.get(`${owner}|LIBRARY`) ?? 0),
          };
        }, seatA);

      /*
       * Regarnir la bibliothèque d'Alice avant de mesurer quoi que ce soit.
       *
       * Elle a joué toute la recette avant d'arriver ici, et sa bibliothèque
       * peut n'avoir plus qu'une carte : la pioche de l'étape 2 la viderait, il
       * n'y aurait plus de dessus du tout, et l'on mesurerait alors l'absence
       * de cartes au lieu de l'absence de révélation. Le cimetière fait
       * l'appoint, puis la main si besoin.
       */
      const regarnir = (kind) =>
        page.evaluate((zone) => {
          const s = window.__mtg.getState();
          const ids = [...s.cards.values()]
            .filter((c) => c.zone.seat === s.mySeat && c.zone.kind === zone)
            .map((c) => c.id);
          if (ids.length > 0) {
            s.send({
              type: 'MOVE_CARDS',
              cardIds: ids,
              to: { seat: s.mySeat, kind: 'LIBRARY' },
              index: 'TOP',
            });
          }
          return ids.length;
        }, kind);
      const assez = () =>
        page.evaluate(() => {
          const s = window.__mtg.getState();
          return (s.zoneCounts.get(`${s.mySeat}|LIBRARY`) ?? 0) >= 3;
        });
      for (const zone of ['GRAVEYARD', 'HAND']) {
        if (await assez()) break;
        await regarnir(zone);
        await page.waitForTimeout(600);
      }
      if (!(await assez())) throw new Error('impossible de regarnir la bibliothèque d’Alice');

      // --- 1. Alice révèle le dessus de sa bibliothèque à Carole, et à elle seule.
      await page.evaluate(
        (to) => window.__mtg.getState().send({ type: 'REVEAL_TOP', toSeats: [to] }),
        seatC,
      );
      await pageC.waitForFunction(
        (owner) => (window.__mtg.getState().topReveals.get(owner)?.cardId ?? null) !== null,
        seatA,
        { timeout: 10000 },
      );
      await pageC
        .locator(`[data-zone="${seatA}|LIBRARY"] img[src*="cards.scryfall.io"]`)
        .first()
        .waitFor({ timeout: 8000 });

      const premiere = await chezCarole();
      if (!premiere.connue) throw new Error('Carole n’a pas reçu la carte du dessus');
      if (!(await peintBien(pageC, premiere))) {
        throw new Error(
          `la pile ne montre pas la carte révélée (peint : ${premiere.face}, attendu : ${premiere.connue})`,
        );
      }
      if (premiere.compte !== premiere.attendu) {
        throw new Error(
          `le compte de la bibliothèque n’est plus lisible par-dessus la carte : « ${premiere.compte} » au lieu de « ${premiere.attendu} »`,
        );
      }
      if (!premiere.oeil) throw new Error('aucun repère « dessus révélé » sur la pile d’Alice');
      console.log(`      chez Carole : « ${premiere.oeil} », ${premiere.attendu} cartes`);

      // Et chez Alice, qui doit savoir que son dessus est vu, et par qui.
      const chezAlice = await page.evaluate((owner) => {
        const marque = document.querySelector(
          `[data-zone="${owner}|LIBRARY"] [data-test="top-revealed"]`,
        );
        return marque
          ? { sens: marque.getAttribute('data-reveal'), titre: marque.getAttribute('title') }
          : null;
      }, seatA);
      if (!chezAlice) throw new Error('Alice ne voit pas que son propre dessus est révélé');
      if (chezAlice.sens !== 'from-me' || !/Carole/.test(chezAlice.titre ?? '')) {
        throw new Error(`le repère d’Alice ne nomme pas le destinataire : ${JSON.stringify(chezAlice)}`);
      }
      console.log(`      chez Alice : « ${chezAlice.titre} »`);

      // Le dessus révélé est une carte comme les autres : on doit pouvoir la
      // survoler pour la lire en grand. Sans cet aperçu, elle reste illisible
      // à la taille d'une pile, et la révélation ne sert à rien.
      const surLaPile = await pageC
        .locator(`[data-zone="${seatA}|LIBRARY"] img[src*="cards.scryfall.io"]`)
        .first()
        .boundingBox();
      if (!surLaPile) throw new Error('la carte révélée n’a pas de boîte à l’écran');
      await pageC.mouse.move(
        surLaPile.x + surLaPile.width / 2,
        surLaPile.y + surLaPile.height / 2,
      );
      await pageC
        .locator('[data-test="card-preview"]')
        .waitFor({ timeout: 6000 })
        .catch(() => {
          throw new Error('aucun aperçu agrandi au survol du dessus révélé');
        });
      /*
       * La capture est prise **pendant le survol**. À l'échelle « toute la
       * table », une pile ne fait que quelques pixels : c'est l'aperçu agrandi,
       * à gauche, qui rend la capture lisible — et c'est aussi ce qu'un joueur
       * regarde vraiment pour lire le dessus révélé.
       */
      await pageC.screenshot({ path: `${OUT}/ui-30-dessus-revele.png` });
      await pageC.mouse.move(8, 8);
      await pageC.waitForTimeout(300);

      // --- 2. Alice pioche : le dessus change, donc la carte peinte aussi.
      await page.evaluate(() => window.__mtg.getState().send({ type: 'DRAW', count: 1 }));
      await pageC.waitForFunction(
        ([owner, ancienne]) =>
          (window.__mtg.getState().topReveals.get(owner)?.cardId ?? null) !== ancienne,
        [seatA, premiere.cardId],
        { timeout: 10000 },
      );
      await pageC.waitForTimeout(400);
      const seconde = await chezCarole();
      if (!seconde.connue) throw new Error('après la pioche, Carole ne voit plus aucun dessus');
      if (!(await peintBien(pageC, seconde))) {
        throw new Error(
          `la pile n’a pas suivi la pioche (peint : ${seconde.face}, attendu : ${seconde.connue})`,
        );
      }
      /*
       * L'ancienne carte a quitté la bibliothèque, et c'est tout ce qu'on
       * exige ici. Qu'elle reste connue de Carole une fois en main d'Alice est
       * délibéré — elle l'a vue de ses yeux, et `knownTo` est monotone (voir
       * `topReveal.ts`) ; ce qui compte, c'est qu'aucun identifiant **de
       * bibliothèque** ne lui reste accroché.
       */
      const restee = await pageC.evaluate(
        (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'LIBRARY',
        premiere.cardId,
      );
      if (restee) throw new Error('la carte piochée est toujours donnée pour être en bibliothèque');
      if (seconde.cardId === premiere.cardId) throw new Error('le dessus n’a pas changé après la pioche');
      console.log(`      après pioche : ${premiere.cardId} → ${seconde.cardId}`);

      // --- 3. Alice arrête la révélation : la carte disparaît, le dos revient.
      await page.evaluate(() => window.__mtg.getState().send({ type: 'REVEAL_TOP', toSeats: [] }));
      await pageC.waitForFunction(
        (owner) => !window.__mtg.getState().topReveals.has(owner),
        seatA,
        { timeout: 10000 },
      );
      await pageC.waitForTimeout(400);
      const apres = await chezCarole();
      if (apres.face) throw new Error('la carte reste affichée après l’arrêt de la révélation');
      if (apres.oeil) throw new Error('le repère « dessus révélé » survit à l’arrêt');
      if (!apres.dos) throw new Error('la bibliothèque ne montre plus son dos après l’arrêt');
      const efface = await pageC.evaluate(
        (id) => !window.__mtg.getState().cards.has(id),
        seconde.cardId,
      );
      if (!efface) throw new Error('la carte révélée n’a pas été retirée du store de Carole');
      console.log('      arrêt : dos de carte retrouvé, aucune carte de bibliothèque connue');
    } finally {
      await contextC.close();
    }
  });

  await step('disposition à plusieurs sièges : aucun chevauchement', async () => {
    const roomUrl = page.url();
    const extras = [];
    try {
      // La table est plafonnée à quatre joueurs (`LIMITS.maxSeats`) : on la
      // remplit exactement, et c'est au carré de quatre qu'un chevauchement se
      // verrait. Un cinquième siège serait refusé par le serveur, pas par nous.
      // On remplit les places qui restent : selon ce que la recette a joué
      // avant, la table porte déjà deux ou trois sièges, dont des déconnectés
      // qui restent occupés (§6.8).
      const seated = await page.evaluate(() => window.__mtg.getState().seats.length);
      for (let i = 0; i < MAX_SEATS - seated; i++) {
        const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
        extras.push(ctx);
        const p2 = await ctx.newPage();
        await p2.goto(roomUrl, { waitUntil: 'domcontentloaded' });
        await p2.getByPlaceholder('Invité').fill(`Invité ${i + 2}`);
        await p2.getByRole('button', { name: "S'asseoir à la table" }).click();
        await p2.getByText('Journal').waitFor({ timeout: 20000 });
      }
      await page.waitForFunction((n) => window.__mtg.getState().seats.length >= n, MAX_SEATS, {
        timeout: 30000,
      });
      await page.getByRole('button', { name: 'Voir toute la table' }).click();
      await page.waitForTimeout(500);

      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('[data-zone$="|BATTLEFIELD"]')].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height, zone: el.dataset.zone };
        }),
      );
      const seatCount = await page.evaluate(() => window.__mtg.getState().seats.length);
      console.log(`      ${seatCount} sièges, ${boxes.length} panneaux rendus`);
      if (boxes.length !== seatCount) {
        throw new Error(`${boxes.length} panneaux rendus pour ${seatCount} sièges`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap =
            a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          if (overlap) throw new Error(`${a.zone} chevauche ${b.zone}`);
        }
      }
      await page.screenshot({ path: `${OUT}/ui-14-six-sieges.png` });
    } finally {
      for (const ctx of extras) await ctx.close();
    }
  });

  await step(
    'une carte au bas du champ de bataille reste cliquable au cadrage d’ouverture, main pleine',
    async () => {
      /*
       * La garantie qui manquait, et le défaut qu'elle ferme.
       *
       * Le cadrage d'ouverture pose le bas du panneau local exactement au bord
       * du bandeau réservé au rail de main. Il est juste — mais il est posé
       * **une fois**, alors que la disposition est une fonction du nombre de
       * sièges : quand un second joueur s'assied, la case du siège local
       * descend d'une rangée entière et le monde glisse sous une caméra qui ne
       * bouge pas. Mesuré à 1600 × 1000 avant correction : le champ de
       * bataille local tombait de 460 px, 448 px passaient sous le rail et
       * 206 px hors de l'écran. Une carte posée là n'était plus cliquable —
       * ni engageable, ni ouvrable au menu — pour un vrai joueur comme pour la
       * sonde, tant qu'il n'avait pas deviné qu'il devait recadrer lui-même.
       *
       * L'étape se fait donc sur sa **propre** table, et surtout sans jamais
       * toucher à la caméra : recentrer d'abord masquerait exactement ce qu'on
       * veut vérifier. Deux sièges sont indispensables — à un seul, la
       * disposition ne change pas et le défaut ne peut pas se montrer.
       */
      const ctxA = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const ctxB = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      try {
        const assieds = async (p, nom, url) => {
          await p.goto(url ?? `${BASE}/`, { waitUntil: 'domcontentloaded' });
          if (!url) {
            await p.getByRole('button', { name: /obtenir le lien/i }).click();
            await p.waitForURL(/\/rooms\//, { timeout: 15000 });
          }
          await p.getByPlaceholder('Invité').fill(nom);
          await p.locator('textarea').first().fill(DECK);
          await p.getByRole('button', { name: /S'asseoir/ }).click();
          await p.waitForFunction(
            () => {
              const s = window.__mtg?.getState();
              return Boolean(s?.mySeat) && (s.zoneCounts.get(`${s.mySeat}|LIBRARY`) ?? 0) > 0;
            },
            null,
            { timeout: 40000 },
          );
        };
        const pA = await ctxA.newPage();
        await assieds(pA, 'Cadrage');
        const salle = pA.url();
        const pB = await ctxB.newPage();
        await assieds(pB, 'Voisine', salle);
        await pA.getByRole('button', { name: 'Lancer la partie' }).click();
        await pA.waitForFunction(
          () => (window.__mtg.getState().zoneCounts.get(`${window.__mtg.getState().mySeat}|HAND`) ?? 0) >= 7,
          null,
          { timeout: 20000 },
        );
        await pA.waitForTimeout(800);

        const enMain = await pA.evaluate(() => {
          const s = window.__mtg.getState();
          return s.zoneCounts.get(`${s.mySeat}|HAND`) ?? 0;
        });
        if (enMain < 7) throw new Error(`main incomplète : ${enMain} cartes`);

        /*
         * On pose la carte **au ras du bas** du champ de bataille, en repère de
         * monde : c'est la bande que le rail convoite. Les mesures se font sur
         * le rendu — hauteur du champ et hauteur d'un permanent divisées par
         * l'échelle courante —, jamais sur des constantes qui divergeraient du
         * jour où la carte change de taille.
         */
        const carte = await pA.evaluate(() => {
          const s = window.__mtg.getState();
          const c = [...s.cards.values()].find((x) => x.zone.kind === 'HAND' && x.zone.seat === s.mySeat);
          s.send({ type: 'MOVE_CARD', cardId: c.id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 40, y: 0 });
          return c.id;
        });
        await pA.locator(`[data-card="${carte}"]`).waitFor({ timeout: 10000 });
        const bas = await pA.evaluate((id) => {
          const s = window.__mtg.getState();
          const plan = document.querySelector('.table-surface').firstElementChild;
          const echelle = new DOMMatrix(getComputedStyle(plan).transform).a;
          const zone = document.querySelector(`[data-zone="${s.mySeat}|BATTLEFIELD"]`).getBoundingClientRect();
          const sprite = document.querySelector(`[data-card="${id}"]`).getBoundingClientRect();
          return Math.max(0, Math.round((zone.height - sprite.height) / echelle) - 2);
        }, carte);
        await pA.evaluate(
          ([id, y]) => {
            const s = window.__mtg.getState();
            s.send({ type: 'MOVE_CARD', cardId: id, to: { seat: s.mySeat, kind: 'BATTLEFIELD' }, x: 40, y });
          },
          [carte, bas],
        );
        await pA.waitForTimeout(900);

        // Ce que l'on constate avant de cliquer : où est la carte, où commence
        // le rail, et qui répond réellement au point visé.
        const vu = await pA.evaluate((id) => {
          const sprite = document.querySelector(`[data-card="${id}"]`).getBoundingClientRect();
          const rail = document.querySelector('[data-test="hand-rail"]');
          const railBox = rail ? rail.getBoundingClientRect() : null;
          const cx = sprite.left + sprite.width / 2;
          const cy = sprite.top + sprite.height / 2;
          const el = document.elementFromPoint(cx, cy);
          return {
            haut: Math.round(sprite.top),
            bas: Math.round(sprite.bottom),
            hautDuRail: railBox ? Math.round(railBox.top) : null,
            largeurDuRail: railBox ? Math.round(railBox.width) : null,
            fenetre: window.innerHeight,
            repond: el ? (el.closest(`[data-card="${id}"]`) ? 'la carte' : (el.closest('[data-test="hand-rail"]') ? 'le rail de main' : el.tagName)) : 'rien',
          };
        }, carte);
        console.log(
          `      carte posée en ${vu.haut}..${vu.bas} px, haut du rail à ${vu.hautDuRail} px` +
            ` (rail large de ${vu.largeurDuRail} px), fenêtre ${vu.fenetre} px — au point visé répond ${vu.repond}`,
        );
        if (vu.bas > vu.fenetre) {
          throw new Error(`la carte déborde de l’écran de ${Math.round(vu.bas - vu.fenetre)} px`);
        }
        if (vu.repond !== 'la carte') {
          throw new Error(`le point visé est intercepté par ${vu.repond}`);
        }

        /*
         * Et la preuve par les gestes que le joueur perdait : le double-clic
         * engage, le clic droit ouvre le menu. Playwright refuse de cliquer une
         * cible recouverte — c'est exactement le défaut que l'on ferme ici —,
         * et l'on exige en plus l'effet, pas seulement que le clic soit parti.
         */
        await pA.locator(`[data-card="${carte}"]`).dblclick({ timeout: 5000 });
        await pA.waitForFunction(
          (id) => window.__mtg.getState().cards.get(id)?.tapped === true,
          carte,
          { timeout: 8000 },
        );
        await pA.locator(`[data-card="${carte}"]`).click({ button: 'right', timeout: 5000 });
        await pA.locator('div.fixed.z-50.w-60').first().waitFor({ timeout: 5000 });
        await pA.keyboard.press('Escape');
        await pA.waitForTimeout(300);
        console.log('      double-clic : engagée ; clic droit : menu ouvert');

        /*
         * Le glisser-déposer depuis la main vers le champ de bataille doit
         * continuer de fonctionner : c'est le coût qu'aurait payé le remède
         * consistant à rendre le rail transparent aux clics, et on l'exige ici
         * pour que personne ne le tente sans s'en apercevoir.
         */
        const avant = await pA.evaluate(() => {
          const s = window.__mtg.getState();
          return s.zoneCounts.get(`${s.mySeat}|BATTLEFIELD`) ?? 0;
        });
        const source = await pA.locator('[data-hand-card] [data-card]').first().boundingBox();
        const cible = await pA.evaluate(() => {
          const s = window.__mtg.getState();
          const r = document.querySelector(`[data-zone="${s.mySeat}|BATTLEFIELD"]`).getBoundingClientRect();
          return { x: Math.round(r.left + r.width * 0.75), y: Math.round(r.top + r.height * 0.3) };
        });
        await pA.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await pA.mouse.down();
        await pA.mouse.move(cible.x, cible.y, { steps: 12 });
        await pA.mouse.up();
        await pA.waitForFunction(
          (n) => (window.__mtg.getState().zoneCounts.get(`${window.__mtg.getState().mySeat}|BATTLEFIELD`) ?? 0) > n,
          avant,
          { timeout: 10000 },
        );
        console.log('      glisser-déposer main → champ de bataille : toujours fonctionnel');
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    },
  );

  const final = await state();
  console.log('      état final:', JSON.stringify({ seq: final.seq, zones: final.zones }));
  console.log('\n--- journal (8 dernières lignes) ---');
  console.log(final.log.slice(-8).join('\n'));
  await page.screenshot({ path: `${OUT}/ui-09-final.png`, fullPage: false });

  /*
   * Dernière étape, parce qu'elle quitte la table : le retour à l'accueil puis
   * la création d'une seconde table.
   *
   * Rien ne couvrait ce chemin, et c'est ce qui a laissé passer le défaut : le
   * store est global et survivait à la navigation, si bien que la table
   * suivante s'ouvrait avec le siège de la précédente — `RoomPage` servait la
   * table au lieu du salon, et l'on n'était jamais invité à donner son nom ni
   * son deck. Toutes les étapes ci-dessus créaient leur table sur une page
   * fraîchement chargée, où le store était vierge : le défaut ne pouvait pas
   * s'y montrer.
   *
   * Le premier clic est aussi celui du geste courant de départ : « Quitter »
   * s'absente sans menu.
   */
  await step('quitter en un clic, puis créer une table : le salon demande nom et deck', async () => {
    await page.locator('[data-test="leave-now"]').click();
    await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 8000 });

    await page.getByRole('button', { name: /obtenir le lien/i }).click();
    await page.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 15000 });
    const code = page.url().split('/').pop();

    await page.getByText('Prendre une place').waitFor({ timeout: 10000 });
    await page.getByPlaceholder('Invité').waitFor({ timeout: 5000 });
    await page.getByPlaceholder(/Sol Ring/).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: "S'asseoir à la table" }).waitFor({ timeout: 5000 });

    const seat = await page.evaluate(() => window.__mtg.getState().mySeat);
    if (seat !== null) throw new Error(`siège hérité de la table précédente : ${seat}`);
    const roomCode = await page.evaluate(() => window.__mtg.getState().roomCode);
    if (roomCode !== code) throw new Error(`le store pointe ${roomCode} et non ${code}`);
    const cards = await page.evaluate(() => window.__mtg.getState().cards.size);
    if (cards !== 0) throw new Error(`${cards} cartes héritées de la table précédente`);

    await page.screenshot({ path: `${OUT}/ui-15-nouveau-salon.png` });
  });

  /*
   * L'aperçu dans l'éditeur de deck, et la seule chose qu'on lui demande ici :
   * **tenir dans la fenêtre**.
   *
   * Le défaut signalé était un débordement par le bas. Sa cause n'était pas le
   * placement mais la *mesure* : la hauteur du panneau était constatée une fois,
   * sur un panneau encore incomplet — l'image n'était pas chargée, donc haute de
   * zéro, et la fiche de la carte n'était pas arrivée, donc ni bandeau de nom ni
   * rangée de mécaniques. Le sommet était posé pour ce panneau-là, puis le
   * panneau grandissait vers le bas, hors de l'écran.
   *
   * D'où la forme de l'étape. Elle ouvre l'éditeur dans une fenêtre **basse**,
   * où il reste peu de place sous le sommet mal posé ; elle survole une carte
   * **jamais survolée auparavant**, pour que l'image soit encore à charger — un
   * second survol de la même carte ne prouve rien, l'élément a déjà ses
   * dimensions ; et elle **attend que l'image soit chargée** avant de mesurer,
   * puisque c'est le chargement qui faisait déborder. Enfin elle passe sur
   * plusieurs cartes, dont une à mots-clés, parce que la rangée de mécaniques
   * est le second morceau qui arrive en retard.
   */
  await step('éditeur de deck : l’aperçu au survol tient dans la fenêtre (fenêtre basse)', async () => {
    // La bibliothèque de decks n'existe que pour un compte. On en crée un par
    // l'API plutôt que par les formulaires : ce qui est vérifié ici est
    // l'aperçu, pas l'inscription, qui a ses propres étapes.
    const marque = Date.now().toString(36);
    const compte = {
      email: `recette-${marque}@exemple.test`,
      password: `recette-${marque}-motdepasse`,
      displayName: `Recette ${marque}`,
    };
    const inscription = await page.request.post(`${BASE}/api/auth/register`, { data: compte });
    if (!inscription.ok()) throw new Error(`inscription refusée : ${inscription.status()}`);
    const connexion = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: compte.email, password: compte.password },
    });
    if (!connexion.ok()) throw new Error(`connexion refusée : ${connexion.status()}`);

    /*
     * Serra Angel porte deux mots-clés : c'est elle qui fait apparaître la
     * rangée de mécaniques sous le bandeau de nom, donc le panneau le plus haut
     * de la liste. Les autres servent de témoins sans mécanique.
     */
    const liste = [
      '// Commander',
      '1 Selenia, the Cursed Heart',
      '',
      '// Deck',
      '1 Serra Angel',
      '1 Sol Ring',
      '1 Llanowar Elves',
    ].join('\n');
    const importation = await page.request.post(`${BASE}/api/decks/import`, {
      data: { source: 'TEXT', text: liste, name: `Recette ${marque}` },
    });
    if (!importation.ok()) throw new Error(`import refusé : ${importation.status()}`);
    const { deckId } = await importation.json();
    if (!deckId) throw new Error('le deck n’a pas été enregistré');

    // Une fenêtre basse : c'est la hauteur qui révèle le défaut, un grand écran
    // laisse assez de place sous le sommet mal posé pour que rien ne se voie.
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto(`${BASE}/decks`);
    await page.locator(`[data-testid="deck-edit-${deckId}"]`).click({ timeout: 15000 });
    await page.locator('[data-testid="deck-editor"]').waitFor({ timeout: 15000 });

    const lignes = page.locator('[data-test="deck-row-card"]');
    await lignes.first().waitFor({ timeout: 15000 });
    const preview = page.locator('[data-test="card-preview"]');
    const total = Math.min(await lignes.count(), 4);
    if (total === 0) throw new Error('aucune carte dans l’éditeur');

    for (let i = 0; i < total; i++) {
      const ligne = await lignes.nth(i).boundingBox();
      if (!ligne) continue;
      // Sortir du survol entre deux cartes : sans ça, la seconde n'allume rien.
      await page.mouse.move(1260, 10);
      await page.waitForTimeout(120);
      await page.mouse.move(ligne.x + 30, ligne.y + ligne.height / 2);
      await preview.waitFor({ timeout: 8000 });

      /*
       * On attend explicitement l'image : c'est l'instant exact où le panneau
       * grandissait sous un sommet déjà posé. Mesurer avant, c'est mesurer un
       * panneau qui n'a pas encore débordé.
       */
      await preview
        .locator('[data-test="card-preview-image"]')
        .evaluate(
          (el) =>
            el.complete ||
            new Promise((resolve) => {
              el.addEventListener('load', resolve, { once: true });
              el.addEventListener('error', resolve, { once: true });
            }),
          undefined,
          { timeout: 15000 },
        );
      await page.waitForTimeout(250);

      const boite = await preview.boundingBox();
      const fenetre = page.viewportSize();
      const debords = [];
      if (boite.x < -0.5) debords.push(`gauche de ${Math.round(-boite.x)} px`);
      if (boite.y < -0.5) debords.push(`haut de ${Math.round(-boite.y)} px`);
      if (boite.x + boite.width > fenetre.width + 0.5) {
        debords.push(`droite de ${Math.round(boite.x + boite.width - fenetre.width)} px`);
      }
      if (boite.y + boite.height > fenetre.height + 0.5) {
        debords.push(`bas de ${Math.round(boite.y + boite.height - fenetre.height)} px`);
      }
      if (debords.length > 0) {
        await page.screenshot({ path: `${OUT}/echec-apercu-editeur-hors-cadre.png` });
        throw new Error(
          `l’aperçu sort du cadre par le ${debords.join(', le ')} ` +
            `(fenêtre ${fenetre.width}×${fenetre.height}, aperçu ` +
            `${Math.round(boite.width)}×${Math.round(boite.height)} en ${Math.round(boite.x)},${Math.round(boite.y)})`,
        );
      }
    }
    console.log(`      ${total} carte(s) survolée(s) dans une fenêtre de 1280×620 : aperçu entier à l’écran`);
    await page.screenshot({ path: `${OUT}/ui-31-apercu-editeur.png` });

    // On referme, et l'on rend la fenêtre à sa taille : l'étape ne laisse rien
    // derrière elle, même si elle est la dernière.
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1600, height: 1000 });
  });
} catch (error) {
  failures += 1;
  console.log('ERREUR GLOBALE', String(error).slice(0, 400));
} finally {
  console.log('\n--- erreurs console ---');
  console.log(errors.length ? [...new Set(errors)].slice(0, 10).join('\n') : 'aucune');
  await browser.close();
  console.log(failures === 0 ? '\nTOUT PASSE' : `\n${failures} ÉCHEC(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

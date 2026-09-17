/**
 * Sonde : agrégation des marqueurs de force/endurance, et marqueurs calculés.
 *
 * Deux choses à prouver, et elles ne se prouvent pas de la même façon.
 *
 * 1. **L'agrégation** est un pur calcul d'affichage : on pose huit marqueurs
 *    -1/-1 et l'on veut lire « -8/-8 » sur la pastille, sans perdre le compte
 *    de marqueurs, qui est ce qui fait foi au sens des règles. On vérifie donc
 *    les deux : le total peint sur la carte, et le compte resté atteignable.
 *
 * 2. **Les marqueurs calculés** ne se prouvent qu'en **changeant la zone
 *    comptée**. Lire « 3/3 » une fois ne dit rien : ce pourrait être un nombre
 *    posé à la main. La sonde pioche une carte, envoie une créature au
 *    cimetière, exile une carte — et exige que la pastille bouge toute seule,
 *    sans qu'aucun intent de marqueur ne reparte.
 *
 * Le banc d'essai est nommément celui de trois cartes réelles, dont le texte a
 * été relu sur Scryfall avant d'écrire le code :
 *   - **Lumra, Bellow of the Woods** — force et endurance égales au nombre de
 *     terrains que vous contrôlez ;
 *   - **Old Stickfingers** — force et endurance égales au nombre de cartes de
 *     créature dans votre cimetière ;
 *   - **Urborg Lhurgoyf** (« Lhurgoyf d'Urbog ») — force égale à ce même
 *     nombre, endurance égale à ce nombre **plus un** : le gabarit `*​/1+*`.
 *
 * Rien n'est simulé : tous les nombres attendus sont recalculés à part, depuis
 * l'état du store et les fiches de l'API, jamais copiés de l'interface.
 *
 *   node probe-marqueurs-calcules.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const NL = String.fromCharCode(10);
const SIGIL = String.fromCharCode(0x2211); // ∑

/*
 * Un deck qui porte les trois matières comptées : des terrains, des cartes de
 * créature et un artefact — de quoi exercer « types de cartes au cimetière »
 * avec plus d'un type, et rester dans l'identité couleur du commandant.
 */
const DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '4 Serra Angel',
  // Des Humains, pour le décompte par sous-type : « Human Soldier » en anglais
  // sur la fiche, « humain » sous les doigts du joueur.
  '8 Thraben Inspector',
  '4 Sol Ring',
  '16 Plains',
].join(NL);

let failures = 0;
const check = (ok, text) => {
  console.log((ok ? 'OK    - ' : 'ÉCHEC - ') + text);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true });

async function nouveauContexte() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  // Compteur d'intents réellement émis : c'est la seule preuve honnête qu'un
  // marqueur calculé ne repasse pas par le serveur pour changer de valeur.
  await context.addInitScript(() => {
    window.__sentIntents = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        if (typeof data === 'string' && data.includes('"intent"')) window.__sentIntents.push(data);
      } catch {
        /* un socket qui n'est pas le nôtre */
      }
      return send.apply(this, arguments);
    };
  });
  return context;
}

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
  await page.waitForFunction(
    () => {
      const s = window.__mtg?.getState();
      return Boolean(s?.mySeat) && (s.zoneCounts.get(s.mySeat + '|LIBRARY') ?? 0) > 0;
    },
    null,
    { timeout: 60000 },
  );
  return page;
}

const alice = await seat(await nouveauContexte(), 'Alice');
const room = alice.url();
const bob = await seat(await nouveauContexte(), 'Bob', room);
await alice.getByRole('button', { name: 'Lancer la partie' }).click();
await alice.waitForFunction(() => window.__mtg.getState().room?.status === 'PLAYING', null, {
  timeout: 20000,
});

const send = (page, intent) => page.evaluate((i) => window.__mtg.getState().send(i), intent);
const mySeat = await alice.evaluate(() => window.__mtg.getState().mySeat);

/** Les fiches de l'API, pour recalculer les décomptes attendus hors interface. */
async function fiches(page, ids) {
  if (ids.length === 0) return {};
  return page.evaluate(async (list) => {
    const r = await fetch('/api/cards/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: list }),
    });
    const body = await r.json();
    const out = {};
    for (const c of body.cards ?? []) out[c.scryfallId] = c.typeLine ?? '';
    return out;
  }, ids);
}

/** Les cartes d'une zone d'un siège, telles que ce client les connaît. */
const cartesDe = (page, kind) =>
  page.evaluate((k) => {
    const s = window.__mtg.getState();
    return [...s.cards.values()]
      .filter((c) => c.zone.kind === k && (k === 'BATTLEFIELD' ? c.controller : c.zone.seat) === s.mySeat)
      .map((c) => ({ id: c.id, scryfallId: c.scryfallId ?? null }));
  }, kind);

/**
 * La part **type de carte** d'une ligne de type : ce qui précède le tiret cadratin
 * de chaque face. « Basic Land — Plains » donne « basic land », et non le
 * sous-type. C'est la seule lecture qui distingue un terrain d'une créature.
 */
const typesPrincipaux = (ligne) =>
  (ligne ?? '')
    .split('//')
    .map((face) => face.split('—')[0] ?? '')
    .join(' ')
    .toLowerCase();

/**
 * Les cartes d'une zone dont la **ligne de type réelle** porte ce type de carte.
 * Les fiches viennent de `/api/cards/batch` : on ne devine pas d'après le nom,
 * et l'on ne recopie rien de l'interface, qui est justement ce qu'on éprouve.
 */
async function cartesDeType(page, zone, motType) {
  const cartes = await cartesDe(page, zone);
  const ids = [...new Set(cartes.map((c) => c.scryfallId).filter(Boolean))];
  const meta = await fiches(page, ids);
  return cartes.filter((c) => typesPrincipaux(meta[c.scryfallId]).includes(motType));
}

/** Décompte attendu, calculé à part : combien de cartes de ce type dans la zone. */
async function attendu(page, kind, motType) {
  if (motType === null) return (await cartesDe(page, kind)).length;
  return (await cartesDeType(page, kind, motType)).length;
}

const battlefield = { seat: mySeat, kind: 'BATTLEFIELD' };

/** Pose **cette** carte-là sur le champ de bataille, et attend qu'elle y soit. */
async function poserCarte(id, x, y) {
  if (!id) throw new Error('aucune carte à poser');
  await send(alice, { type: 'MOVE_CARD', cardId: id, to: battlefield, x, y });
  await alice
    .waitForFunction((c) => window.__mtg.getState().cards.get(c)?.zone.kind === 'BATTLEFIELD', id, {
      timeout: 12000,
    })
    .catch(() => undefined);
  return id;
}

/** Pose la première carte de la main — quand seule compte « un permanent de plus ». */
async function poser(x, y) {
  const id = await alice.evaluate(() => {
    const s = window.__mtg.getState();
    return (
      [...s.cards.values()].find((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat)?.id ?? null
    );
  });
  if (!id) throw new Error('aucune carte en main');
  return poserCarte(id, x, y);
}

/** Ce que la pastille d'un marqueur affiche réellement, chez un siège. */
function pastille(page, cardId, kind) {
  return page.evaluate(
    ([id, k]) => {
      const node = document
        .querySelector(`[data-card="${id}"]`)
        ?.querySelector(`[data-counter="${CSS.escape(k)}"]`);
      if (!node) return null;
      return {
        texte: (node.textContent ?? '').replace(/\s+/g, ''),
        compte: node.getAttribute('data-counter-count'),
        total: node.getAttribute('data-counter-total'),
        calcule: node.getAttribute('data-computed'),
        titre: node.getAttribute('title') ?? '',
      };
    },
    [cardId, kind],
  );
}

/** Attend que la pastille affiche exactement ce texte, puis la rend. */
async function attendPastille(page, cardId, kind, texte) {
  await page
    .waitForFunction(
      ([id, k, want]) => {
        const node = document
          .querySelector(`[data-card="${id}"]`)
          ?.querySelector(`[data-counter="${CSS.escape(k)}"]`);
        return (node?.textContent ?? '').replace(/\s+/g, '') === want;
      },
      [cardId, kind, texte],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  return pastille(page, cardId, kind);
}

/* ================================================================== */
/* 1. Agrégation des marqueurs de force/endurance                      */
/* ================================================================== */

const porteur = await poser(420, 320);

await send(alice, { type: 'SET_COUNTER', targetId: porteur, kind: '-1/-1', value: 8 });
{
  const p = await attendPastille(alice, porteur, '-1/-1', '-8/-8');
  check(p?.texte === '-8/-8', `huit marqueurs -1/-1 se lisent « -8/-8 » (lu « ${p?.texte} »)`);
  check(p?.compte === '8', `le compte de marqueurs reste atteignable (data-counter-count = ${p?.compte})`);
  check(p?.total === '-8/-8', `le total est exposé à part (data-counter-total = ${p?.total})`);
  check(
    (p?.titre ?? '').includes('8 marqueurs -1/-1'),
    'l’infobulle dit le compte de marqueurs, qui fait foi au sens des règles',
  );
}

{
  const p = await attendPastille(bob, porteur, '-1/-1', '-8/-8');
  check(p?.texte === '-8/-8', `l’adversaire lit le même total (« ${p?.texte} ») : rien de privé ici`);
}

await send(alice, { type: 'SET_COUNTER', targetId: porteur, kind: '+2/+0', value: 3 });
{
  const p = await attendPastille(alice, porteur, '+2/+0', '+6/+0');
  check(p?.texte === '+6/+0', `cas mixte : « +2/+0 » ×3 vaut « +6/+0 » (lu « ${p?.texte} »)`);
}

await send(alice, { type: 'SET_COUNTER', targetId: porteur, kind: 'X/X', value: 3 });
{
  const p = await attendPastille(alice, porteur, 'X/X', 'X/X×3');
  check(p?.texte === 'X/X×3', `un « X/X » reste « X/X ×3 », non sommé (lu « ${p?.texte} »)`);
  check(p?.total === null, 'aucun total n’est inventé pour un X, dont la valeur est inconnue');
}

await send(alice, { type: 'SET_COUNTER', targetId: porteur, kind: '+1/+1', value: 2 });
{
  const gain = await attendPastille(alice, porteur, '+1/+1', '+2/+2');
  const perte = await pastille(alice, porteur, '-1/-1');
  check(
    gain?.texte === '+2/+2' && perte?.texte === '-8/-8',
    `+1/+1 et -1/-1 restent deux marqueurs distincts (« ${gain?.texte} » et « ${perte?.texte} »)`,
  );
}

await send(alice, { type: 'SET_COUNTER', targetId: porteur, kind: '+3/+3', value: 1 });
{
  const p = await attendPastille(alice, porteur, '+3/+3', '+3/+3');
  check(p?.texte === '+3/+3', `un marqueur seul s’affiche tel quel, sans « ×1 » (lu « ${p?.texte} »)`);
}

/* ================================================================== */
/* 2. Marqueurs calculés — le banc d'essai des trois cartes             */
/* ================================================================== */

const KIND_LUMRA = SIGIL + '*/* bat.land@vous';
const KIND_STICK = SIGIL + '*/* cim.creature@vous';
const KIND_URBOG = SIGIL + '*/*+1 cim.creature@vous';
const KIND_MARO = SIGIL + '*/* main@vous';
const KIND_ADDITIF = SIGIL + '+*/+* cim.creature@tous';
const KIND_TYPES = SIGIL + '*/*+1 cim.types@tous';

for (const kind of [KIND_LUMRA, KIND_STICK, KIND_URBOG, KIND_MARO, KIND_ADDITIF, KIND_TYPES]) {
  check(kind.length <= 32, `« ${kind} » tient dans les 32 caractères d’un kind (${kind.length})`);
}

const calc = await poser(700, 320);
for (const kind of [KIND_LUMRA, KIND_STICK, KIND_URBOG, KIND_MARO, KIND_TYPES]) {
  await send(alice, { type: 'SET_COUNTER', targetId: calc, kind });
}
await alice
  .waitForFunction(
    (id) => (window.__mtg.getState().cards.get(id)?.counters ?? []).length >= 5,
    calc,
    { timeout: 12000 },
  )
  .catch(() => undefined);

const valeur = async (page, cardId, kind) => (await pastille(page, cardId, kind))?.calcule ?? null;

/* --- Lumra : force et endurance = terrains que vous contrôlez --- */
{
  const avant = await valeur(alice, calc, KIND_LUMRA);
  /*
   * On pose des **terrains**, choisis pour ce qu'en dit leur ligne de type, et
   * non les premières cartes venues. La version précédente prenait trois cartes
   * au hasard dans une main mélangée en espérant qu'il s'y trouve un terrain :
   * quand le mélange servait trois non-terrains, le décompte ne bougeait pas et
   * la sonde échouait — puis repassait au tour suivant. Une sonde qui échoue une
   * fois sur cinq ne protège plus rien, on finit par la relancer sans la lire.
   *
   * Le seul cas où l'expérience serait vide est celui d'une main sans aucun
   * terrain (~0,3 % ici) : on pioche alors jusqu'à en voir un, ce qui borne le
   * hasard au lieu de le subir.
   */
  for (let essai = 0; essai < 12; essai++) {
    if ((await cartesDeType(alice, 'HAND', 'land')).length > 0) break;
    if ((await cartesDeType(alice, 'HAND', 'land')).length >= 2) break;
    await send(alice, { type: 'DRAW', count: 1 });
    await alice.waitForTimeout(300);
  }
  const terrainsMain = await cartesDeType(alice, 'HAND', 'land');
  check(terrainsMain.length >= 1, `des terrains identifiés en main pour l’expérience (${terrainsMain.length})`);
  check(terrainsMain.length >= 2, `au moins deux terrains identifiés en main pour l’expérience (${terrainsMain.length})`);
  const poses = terrainsMain.slice(0, 3);
  let x = 860;
  for (const terrain of poses) {
    await poserCarte(terrain.id, x, 320);
    x += 140;
  }
  const cible = await attendu(alice, 'BATTLEFIELD', 'land');
  // On attend que **la pastille** rejoigne le décompte calculé à part : c'est
  // la condition qu'on prétend démontrer, pas un délai forfaitaire.
  await alice
    .waitForFunction(
      ([id, kind, want]) => {
        const node = document
          .querySelector(`[data-card="${id}"]`)
          ?.querySelector(`[data-counter="${CSS.escape(kind)}"]`);
        return node?.getAttribute('data-computed') === want;
      },
      [calc, KIND_LUMRA, String(cible)],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  const apres = await valeur(alice, calc, KIND_LUMRA);
  check(
    Number(apres) === cible,
    `Lumra : la pastille annonce ${apres}, et il y a bien ${cible} terrain(s) sur le champ de bataille`,
  );
  check(
    Number(apres) === Number(avant) + poses.length,
    `Lumra : poser ${poses.length} terrain(s) fait monter le décompte d’autant, tout seul (${avant} → ${apres})`,
  );
  const p = await pastille(alice, calc, KIND_LUMRA);
  check(
    p?.texte === SIGIL + `${cible}/${cible}`,
    `Lumra : la pastille se lit « ∑${cible}/${cible} », pas « +${cible}/+${cible} » (lu « ${p?.texte} »)`,
  );
  check(
    (p?.titre ?? '').includes('Recalculé'),
    'Lumra : l’infobulle annonce que la valeur se recalcule toute seule',
  );
}

/* --- Old Stickfingers et Lhurgoyf d'Urborg, sur le même décompte --- */
{
  const avant = await valeur(alice, calc, KIND_STICK);
  // On vide presque toute la bibliothèque : il y a huit cartes de créature dans
  // le deck et au plus sept en main, donc au moins une **doit** tomber au
  // cimetière. Le test ne dépend d'aucun tirage heureux.
  const reste = await alice.evaluate(
    (s) => window.__mtg.getState().zoneCounts.get(s + '|LIBRARY') ?? 0,
    mySeat,
  );
  await send(alice, { type: 'MILL', count: Math.max(1, reste - 1) });
  await alice.waitForTimeout(2000);

  const cible = await attendu(alice, 'GRAVEYARD', 'creature');
  await alice
    .waitForFunction(
      ([id, kind, want]) => {
        const node = document
          .querySelector(`[data-card="${id}"]`)
          ?.querySelector(`[data-counter="${CSS.escape(kind)}"]`);
        return node?.getAttribute('data-computed') === want;
      },
      [calc, KIND_STICK, String(cible)],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  const apres = await valeur(alice, calc, KIND_STICK);
  check(cible >= 1, `au moins une carte de créature est au cimetière (${cible})`);
  check(
    Number(apres) === cible,
    `Old Stickfingers : la pastille annonce ${apres} pour ${cible} carte(s) de créature au cimetière`,
  );
  check(
    apres !== avant,
    `Old Stickfingers : remplir le cimetière fait bouger le décompte tout seul (${avant} → ${apres})`,
  );

  const stick = await pastille(alice, calc, KIND_STICK);
  const urbog = await pastille(alice, calc, KIND_URBOG);
  check(
    stick?.texte === SIGIL + `${cible}/${cible}`,
    `Old Stickfingers : « ∑${cible}/${cible} » (lu « ${stick?.texte} »)`,
  );
  check(
    urbog?.texte === SIGIL + `${cible}/${cible + 1}`,
    `Lhurgoyf d’Urborg : même décompte, endurance +1 — « ∑${cible}/${cible + 1} » (lu « ${urbog?.texte} »)`,
  );

  // Et l'on retire **une** créature du cimetière : le décompte doit perdre
  // exactement un, des deux côtés, sans qu'on touche au marqueur.
  const cartes = await cartesDe(alice, 'GRAVEYARD');
  const meta = await fiches(alice, [...new Set(cartes.map((c) => c.scryfallId).filter(Boolean))]);
  const creature = cartes.find((c) => (meta[c.scryfallId] ?? '').toLowerCase().includes('creature'));
  check(Boolean(creature), 'une carte de créature identifiée au cimetière, pour l’exiler');
  if (creature) {
    await send(alice, {
      type: 'MOVE_CARD',
      cardId: creature.id,
      to: { seat: mySeat, kind: 'EXILE' },
    });
    await alice.waitForTimeout(1200);
    await alice
      .waitForFunction(
        ([id, kind, want]) => {
          const node = document
            .querySelector(`[data-card="${id}"]`)
            ?.querySelector(`[data-counter="${CSS.escape(kind)}"]`);
          return node?.getAttribute('data-computed') === want;
        },
        [calc, KIND_STICK, String(cible - 1)],
        { timeout: 12000 },
      )
      .catch(() => undefined);
    const final = await valeur(alice, calc, KIND_STICK);
    const finalUrbog = await pastille(alice, calc, KIND_URBOG);
    check(
      Number(final) === cible - 1,
      `exiler une créature du cimetière ramène le décompte de ${cible} à ${final}, tout seul`,
    );
    check(
      finalUrbog?.texte === SIGIL + `${cible - 1}/${cible}`,
      `et le gabarit */1+* suit : « ∑${cible - 1}/${cible} » (lu « ${finalUrbog?.texte} »)`,
    );
  }
}

/* --- Tarmogoyf : nombre de **types** présents, et non de cartes --- */
{
  const p = await pastille(alice, calc, KIND_TYPES);
  const n = Number(p?.calcule ?? 0);
  const cartes = await attendu(alice, 'GRAVEYARD', null);
  check(
    n >= 2 && n < cartes,
    `« types de cartes au cimetière » compte des types (${n}) et non des cartes (${cartes})`,
  );
}

/* --- Le cas exigé nommément : piocher fait suivre « par carte en main » --- */
{
  const avant = await valeur(alice, calc, KIND_MARO);
  const intentsAvant = await alice.evaluate(() => window.__sentIntents.length);
  await send(alice, { type: 'DRAW', count: 1 });
  // On attend que la **pastille** change, pas un délai : c'est précisément ce
  // qu'on prétend démontrer.
  await alice
    .waitForFunction(
      ([id, kind, was]) => {
        const node = document
          .querySelector(`[data-card="${id}"]`)
          ?.querySelector(`[data-counter="${CSS.escape(kind)}"]`);
        return node !== null && node.getAttribute('data-computed') !== was;
      },
      [calc, KIND_MARO, avant],
      { timeout: 10000 },
    )
    .catch(() => undefined);
  const apres = await valeur(alice, calc, KIND_MARO);
  check(
    Number(apres) === Number(avant) + 1,
    `« par carte en main » : piocher fait passer le marqueur de ${avant} à ${apres}, sans y toucher`,
  );
  const intentsApres = await alice.evaluate(() => window.__sentIntents.length);
  check(
    intentsApres - intentsAvant <= 1,
    `un seul intent est parti pour cela — la pioche (${intentsApres - intentsAvant})`,
  );
}

/* --- Convergence : le même nombre aux deux sièges --- */
{
  const chezAlice = await valeur(alice, calc, KIND_MARO);
  const chezBob = await valeur(bob, calc, KIND_MARO);
  check(
    chezAlice === chezBob && chezAlice !== null,
    `« cartes en main » se lit pareil aux deux sièges (${chezAlice} / ${chezBob}) : le nombre est public, donc il converge`,
  );
}

/* ================================================================== */
/* 3. Le dialogue : catégorie à part, refus explicite, composition     */
/* ================================================================== */

{
  /*
   * Le menu s'ouvre par un `contextmenu` **dispatché**, et non par un vrai clic
   * droit : le rail de main est un calque plein écran, et son image de carte
   * intercepte le test de collision de Playwright même quand le permanent visé
   * est parfaitement visible. Ce que l'on veut éprouver ici est le dialogue,
   * pas la géométrie de la table, qui a sa propre recette.
   */
  const boite = await alice.locator(`[data-card="${calc}"]`).boundingBox();
  await alice.locator(`[data-card="${calc}"]`).dispatchEvent('contextmenu', {
    bubbles: true,
    button: 2,
    clientX: Math.round(boite.x + boite.width / 2),
    clientY: Math.round(boite.y + boite.height / 2),
  });
  await alice.locator('[data-test="card-menu"]').waitFor({ timeout: 8000 });
  await alice
    .locator('[data-test="card-menu"] button')
    .filter({ hasText: 'Marqueur personnalisé' })
    .first()
    .click();
  await alice.locator('[data-test="dialog"]').waitFor({ timeout: 8000 });

  const formes = await alice.evaluate(() =>
    [...document.querySelectorAll('[data-test="dialog-option"][data-field="forme"]')].map(
      (b) => b.getAttribute('data-value'),
    ),
  );
  check(
    formes.includes('calc') && formes.length === 4,
    `la catégorie « Effets classiques » est une quatrième forme, à part des trois autres (${formes.join(', ')})`,
  );

  await alice.locator('[data-test="dialog-option"][data-field="forme"][data-value="calc"]').click();

  const libelles = await alice.evaluate(() =>
    [...document.querySelectorAll('[data-test="dialog-option"][data-field="calcsrc"]')].map(
      (b) => b.textContent ?? '',
    ),
  );
  const interdits = libelles.filter((l) =>
    /(créature|terrain|artefact|type|éphémère|rituel)/i.test(l) &&
    /(en main|bibliothèque|réserve)/i.test(l),
  );
  check(
    interdits.length === 0,
    `aucun décompte par type dans une main, une bibliothèque ou une réserve n’est proposé (${interdits.join(' | ') || 'rien'})`,
  );
  check(
    libelles.some((l) => /cartes en main/i.test(l)),
    'le simple nombre de cartes en main, lui, est proposé : il est public',
  );
  check(
    libelles.some((l) => /cartes de créature au cimetière/i.test(l)),
    'et les cartes de créature au cimetière aussi : la zone est énumérable',
  );
  const texte = await alice.evaluate(() => document.querySelector('[data-test="dialog"]')?.textContent ?? '');
  check(
    /comportement/i.test(texte),
    'les trois comportements (égal au décompte, bonus par unité, figé) sont offerts au choix du joueur',
  );

  // On compose pour de bon un marqueur additif, par l'interface.
  await alice.locator('[data-test="dialog-option"][data-field="calcmode"][data-value="ajout"]').click();
  await alice.locator('[data-test="dialog-option"][data-field="calcpt2"][data-value="+*/+*"]').click();
  await alice
    .locator('[data-test="dialog-option"][data-field="calcsrc"][data-value="cim.creature"]')
    .click();
  await alice.locator('[data-test="dialog-option"][data-field="calcqui"][data-value="tous"]').click();
  await alice.locator('[data-test="dialog-submit"]').click();

  await alice
    .waitForFunction(
      ([id, kind]) =>
        (window.__mtg.getState().cards.get(id)?.counters ?? []).some((c) => c.kind === kind),
      [calc, KIND_ADDITIF],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  const poses = await alice.evaluate(
    (id) => (window.__mtg.getState().cards.get(id)?.counters ?? []).map((c) => c.kind),
    calc,
  );
  check(
    poses.includes(KIND_ADDITIF),
    `le dialogue compose « ${KIND_ADDITIF} » (posés : ${poses.join(' , ')})`,
  );
  const additif = await pastille(alice, calc, KIND_ADDITIF);
  check(
    /^∑\+\d+\/\+\d+$/.test(additif?.texte ?? ''),
    `le mode « bonus par unité » s’affiche signé, « +n/+n » (lu « ${additif?.texte} »)`,
  );
  const valeurCalculee = await alice.evaluate(
    (id) => (window.__mtg.getState().cards.get(id)?.counters ?? []).find((c) => c.kind.startsWith('∑'))?.value ?? null,
    calc,
  );
  check(
    valeurCalculee === null || valeurCalculee === undefined,
    'un marqueur calculé ne porte aucune valeur : rien n’est stocké, tout est compté',
  );
}

/* ================================================================== */
/* 4. Le mode figé : des +1/+1 ordinaires, qui ne suivent plus         */
/* ================================================================== */

{
  const fige = await poser(420, 520);
  const n = Number(await valeur(alice, calc, KIND_STICK));
  await send(alice, { type: 'SET_COUNTER', targetId: fige, kind: '+1/+1', value: n });
  const p = await attendPastille(alice, fige, '+1/+1', `+${n}/+${n}`);
  check(
    p?.compte === String(n) && p?.calcule === null,
    `un décompte figé laisse ${n} marqueurs +1/+1 ordinaires, rien de calculé (compte ${p?.compte})`,
  );

  // On remue encore le cimetière : le calculé suit, le figé ne bouge pas.
  const cartes = await cartesDe(alice, 'GRAVEYARD');
  const meta = await fiches(alice, [...new Set(cartes.map((c) => c.scryfallId).filter(Boolean))]);
  const creature = cartes.find((c) => (meta[c.scryfallId] ?? '').toLowerCase().includes('creature'));
  if (creature) {
    await send(alice, {
      type: 'MOVE_CARD',
      cardId: creature.id,
      to: { seat: mySeat, kind: 'EXILE' },
    });
    await alice.waitForTimeout(1200);
  }
  const apresFige = await pastille(alice, fige, '+1/+1');
  const apresCalc = await valeur(alice, calc, KIND_STICK);
  check(
    apresFige?.compte === String(n) && Number(apresCalc) === n - 1,
    `le figé reste à ${apresFige?.compte} là où le calculé descend à ${apresCalc} : deux comportements distincts`,
  );
}

/* ================================================================== */
/* 5. Décompte par sous-type : « +1/+1 pour chaque Humain »            */
/* ================================================================== */

/** Les cartes d'une zone dont la ligne de type porte ce mot (fiche API). */
async function cartesPortant(page, zone, mot) {
  const cartes = await cartesDe(page, zone);
  const meta = await fiches(page, [...new Set(cartes.map((c) => c.scryfallId).filter(Boolean))]);
  return cartes.filter((c) => {
    const ligne = meta[c.scryfallId] ?? '';
    const tiret = ligne.indexOf('—');
    return tiret >= 0 && ligne.slice(tiret + 1).toLowerCase().includes(mot);
  });
}

const KIND_HUM_PP = SIGIL + '+*/+* bat:human@vous';
const KIND_HUM_P0 = SIGIL + '+*/+0 bat:human@vous';
const KIND_HUM_CIM = SIGIL + '+*/+* cim:human@vous';
const KIND_ABSENT = SIGIL + '+*/+* bat:dragon@vous';
const KIND_INEXISTANT = SIGIL + '+*/+* bat:zzzquux@vous';
// Le pire cas réel des quatre catalogues Scryfall (401 sous-types) : 15
// caractères une fois replié, avec le préfixe de zone le plus long.
const KIND_PIRE_CAS = SIGIL + '*/*+1 exil:assembly-worker@tous';

for (const kind of [KIND_HUM_PP, KIND_HUM_P0, KIND_HUM_CIM, KIND_ABSENT, KIND_PIRE_CAS]) {
  check(kind.length <= 32, `« ${kind} » tient dans les 32 caractères (${kind.length})`);
}

{
  const tribal = await poser(700, 520);
  for (const kind of [KIND_HUM_PP, KIND_HUM_P0, KIND_HUM_CIM, KIND_ABSENT, KIND_INEXISTANT]) {
    await send(alice, { type: 'SET_COUNTER', targetId: tribal, kind });
  }
  await alice.waitForTimeout(1500);

  const depart = Number(await valeur(alice, tribal, KIND_HUM_PP));
  const humainsCim = await cartesPortant(alice, 'GRAVEYARD', 'human');
  check(
    humainsCim.length >= 1,
    `des Humains identifiés au cimetière pour l’expérience (${humainsCim.length})`,
  );
  const cimAvant = Number(await valeur(alice, tribal, KIND_HUM_CIM));
  check(
    cimAvant === humainsCim.length,
    `« pour chaque Humain au cimetière » annonce ${cimAvant} pour ${humainsCim.length} carte(s)`,
  );

  /* Les Humains disponibles entrent sur le champ de bataille. Combien il y en a
     dépend du tirage ; ce qu'on éprouve, c'est que le décompte suit **de ce
     nombre-là**, pas d'un nombre décidé d'avance. */
  const entrants = humainsCim.slice(0, 3);
  for (const humain of entrants) {
    await send(alice, { type: 'MOVE_CARD', cardId: humain.id, to: battlefield, x: 200, y: 420 });
  }
  await alice.waitForTimeout(1800);

  await alice.waitForTimeout(500);
  const cible = (await cartesPortant(alice, 'BATTLEFIELD', 'human')).length;
  await alice
    .waitForFunction(
      ([id, kind, want]) => {
        const node = document
          .querySelector(`[data-card="${id}"]`)
          ?.querySelector(`[data-counter="${CSS.escape(kind)}"]`);
        return (node?.textContent ?? '').replace(/\s+/g, '') === want;
      },
      [tribal, KIND_HUM_PP, SIGIL + `+${cible}/+${cible}`],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  check(
    cible === depart + entrants.length,
    `${entrants.length} Humain(s) sont entrés sur le champ de bataille (${depart} → ${cible})`,
  );
  const pp = await pastille(alice, tribal, KIND_HUM_PP);
  const p0 = await pastille(alice, tribal, KIND_HUM_P0);
  check(
    pp?.texte === SIGIL + `+${cible}/+${cible}`,
    `« +1/+1 pour chaque Humain » se lit « ∑+${cible}/+${cible} » (lu « ${pp?.texte} »)`,
  );
  check(
    p0?.texte === SIGIL + `+${cible}/+0`,
    `« +1/+0 pour chaque Humain » ne touche que la force : « ∑+${cible}/+0 » (lu « ${p0?.texte} »)`,
  );
  check(
    pp?.texte !== p0?.texte,
    'les deux gabarits divergent bien : l’un sur les deux côtés, l’autre sur la force seule',
  );
  const cimApres = Number(await valeur(alice, tribal, KIND_HUM_CIM));
  check(
    cimApres === cimAvant - entrants.length,
    `et le cimetière en a perdu autant du même coup (${cimAvant} → ${cimApres})`,
  );

  // Un Humain ressort : les deux pastilles redescendent d'un cran.
  const tousHumains = await cartesPortant(alice, 'BATTLEFIELD', 'human');
  const sortant = tousHumains.find((c) => c.id !== tribal) ?? tousHumains[0];
  await send(alice, {
    type: 'MOVE_CARD',
    cardId: sortant.id,
    to: { seat: mySeat, kind: 'EXILE' },
  });
  await alice.waitForTimeout(1500);
  await alice
    .waitForFunction(
      ([id, kind, want]) => {
        const node = document
          .querySelector(`[data-card="${id}"]`)
          ?.querySelector(`[data-counter="${CSS.escape(kind)}"]`);
        return (node?.textContent ?? '').replace(/\s+/g, '') === want;
      },
      [tribal, KIND_HUM_PP, SIGIL + `+${cible - 1}/+${cible - 1}`],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  const ppApres = await pastille(alice, tribal, KIND_HUM_PP);
  const p0Apres = await pastille(alice, tribal, KIND_HUM_P0);
  check(
    ppApres?.texte === SIGIL + `+${cible - 1}/+${cible - 1}` &&
      p0Apres?.texte === SIGIL + `+${cible - 1}/+0`,
    `un Humain qui sort fait redescendre les deux (« ${ppApres?.texte} » et « ${p0Apres?.texte} »)`,
  );

  // Sous-type absent de la table, et sous-type qui n'existe pas du tout.
  const absent = await pastille(alice, tribal, KIND_ABSENT);
  const inexistant = await pastille(alice, tribal, KIND_INEXISTANT);
  check(
    absent?.texte === SIGIL + '+0/+0',
    `un sous-type absent de la table compte zéro, sans se plaindre (« ${absent?.texte} »)`,
  );
  check(
    inexistant?.texte === SIGIL + '+0/+0' && /orthographe/i.test(inexistant?.titre ?? ''),
    'un sous-type qui n’existe pas compte zéro **et** l’infobulle suggère de vérifier l’orthographe',
  );

  // Convergence : l'adversaire lit exactement le même nombre.
  const chezBob = await pastille(bob, tribal, KIND_HUM_PP);
  check(
    chezBob?.texte === ppApres?.texte,
    `l’adversaire lit le même décompte par sous-type (« ${chezBob?.texte} »)`,
  );
}

/* ================================================================== */
/* 6. Le dialogue : il tient dans la fenêtre, et il se cherche         */
/* ================================================================== */

{
  const cible = await poser(1000, 520);
  const boite = await alice.locator(`[data-card="${cible}"]`).boundingBox();
  await alice.locator(`[data-card="${cible}"]`).dispatchEvent('contextmenu', {
    bubbles: true,
    button: 2,
    clientX: Math.round(boite.x + boite.width / 2),
    clientY: Math.round(boite.y + boite.height / 2),
  });
  await alice.locator('[data-test="card-menu"]').waitFor({ timeout: 8000 });
  await alice
    .locator('[data-test="card-menu"] button')
    .filter({ hasText: 'Marqueur personnalisé' })
    .first()
    .click();
  await alice.locator('[data-test="dialog"]').waitFor({ timeout: 8000 });
  await alice.locator('[data-test="dialog-option"][data-field="forme"][data-value="calc"]').click();
  await alice.waitForTimeout(300);

  const mesure = await alice.evaluate(() => {
    const form = document.querySelector('[data-test="dialog"]').getBoundingClientRect();
    const valider = document.querySelector('[data-test="dialog-submit"]').getBoundingClientRect();
    return {
      hauteur: Math.round(form.height),
      fenetre: window.innerHeight,
      deborde: form.top < 0 || form.bottom > window.innerHeight,
      validerVisible: valider.top >= 0 && valider.bottom <= window.innerHeight,
      pageDefile: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  check(
    !mesure.deborde && mesure.validerVisible && !mesure.pageDefile,
    `le dialogue tient dans la fenêtre (${mesure.hauteur} px pour ${mesure.fenetre}), « Poser » atteignable, page sans défilement`,
  );

  const chercher = alice.locator('[data-test="dialog-search"][data-field="calcsrc"]');
  await chercher.waitFor({ timeout: 5000 });
  const total = await alice.locator('[data-test="dialog-option"][data-field="calcsrc"]').count();

  // La recherche filtre.
  await chercher.fill('cimet');
  await alice.waitForTimeout(250);
  const filtres = await alice.evaluate(() =>
    [...document.querySelectorAll('[data-test="dialog-option"][data-field="calcsrc"]')].map(
      (b) => b.textContent ?? '',
    ),
  );
  check(
    filtres.length > 0 && filtres.length < total && filtres.every((l) => /cimeti/i.test(l)),
    `« cimet » ramène ${filtres.length} entrées sur ${total}, toutes du cimetière et sans bruit de sous-type`,
  );

  // La recherche ne trouve rien dans le catalogue, et le dit — tout en
  // proposant quand même la saisie comme sous-type, qui peut être légitime.
  await chercher.fill('zzzquux');
  await alice.waitForTimeout(250);
  const noteVide = await alice.evaluate(
    () => document.querySelector('[data-test="dialog-search-note"]')?.textContent ?? '',
  );
  check(
    /rien ne correspond/i.test(noteVide),
    `une recherche sans résultat le dit (« ${noteVide.slice(0, 70)}… »)`,
  );

  // Le refus de confidentialité s'affiche là où l'on bute dessus.
  await chercher.fill('créatures en main');
  await alice.waitForTimeout(250);
  const noteRefus = await alice.evaluate(
    () => document.querySelector('[data-test="dialog-search-note"]')?.textContent ?? '',
  );
  check(
    /refusé/i.test(noteRefus),
    'chercher un décompte par type dans une main affiche le refus explicite, à l’endroit où l’on bute dessus',
  );

  // On saisit un sous-type en français : les trois zones publiques sont
  // proposées, et le `kind` composé est en forme canonique anglaise.
  await chercher.fill('humain');
  await alice.waitForTimeout(250);
  const propositions = await alice.evaluate(() =>
    [...document.querySelectorAll('[data-test="dialog-option"][data-field="calcsrc"]')].map((b) => ({
      value: b.getAttribute('data-value'),
      label: b.textContent ?? '',
    })),
  );
  const valeurs = propositions.map((p) => p.value);
  check(
    valeurs.includes('bat:human') && valeurs.includes('cim:human') && valeurs.includes('exil:human'),
    `« humain » propose les trois zones publiques (${valeurs.join(', ')})`,
  );
  check(
    !valeurs.some((v) => /^(main|biblio|reserve):/.test(v ?? '')),
    'et aucune zone cachée : ni main, ni bibliothèque, ni réserve',
  );

  // On atteint l'entrée par la recherche, puis on valide.
  await alice.locator('[data-test="dialog-option"][data-field="calcsrc"][data-value="bat:human"]').click();
  await alice.locator('[data-test="dialog-option"][data-field="calcmode"][data-value="ajout"]').click();
  await alice.locator('[data-test="dialog-option"][data-field="calcpt2"][data-value="+*/+0"]').click();
  /* La portée doit être remise explicitement : le dialogue se souvient de la
     dernière saisie validée (mémoire « card-counter »), et la précédente avait
     retenu « toute la table ». */
  await alice.locator('[data-test="dialog-option"][data-field="calcqui"][data-value="vous"]').click();
  await alice.locator('[data-test="dialog-submit"]').click();
  await alice
    .waitForFunction(
      ([id, kind]) =>
        (window.__mtg.getState().cards.get(id)?.counters ?? []).some((c) => c.kind === kind),
      [cible, KIND_HUM_P0],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  const posesUI = await alice.evaluate(
    (id) => (window.__mtg.getState().cards.get(id)?.counters ?? []).map((c) => c.kind),
    cible,
  );
  check(
    posesUI.includes(KIND_HUM_P0),
    `atteindre une entrée par la recherche puis valider pose « ${KIND_HUM_P0} » (posés : ${posesUI.join(' , ') || 'rien'})`,
  );
}

await alice.screenshot({ path: 'probe-marqueurs-calcules.png' });
console.log(failures === 0 ? 'TOUT PASSE' : `${failures} échec(s)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

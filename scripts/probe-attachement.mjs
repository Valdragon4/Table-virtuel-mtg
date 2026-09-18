/**
 * Sonde : serrage des cartes attachées.
 *
 * Elle existe parce que le décalage d'un attachement (`ATTACH_OFFSET_*`,
 * `SIBLING_STEP_*` dans SeatPanel.tsx) a déjà été resserré deux fois à la
 * demande, et que chaque tour de vis se joue entre deux choses qu'on ne peut
 * pas deviner de tête : un bloc qui se lit comme un seul objet, et une carte du
 * dessous qu'on doit encore pouvoir viser au pointeur.
 *
 * Elle pose donc un permanent avec trois cartes attachées, plus une chaîne
 * (aura sur équipement, qui traverse `depth`), puis relève ce que le navigateur
 * a réellement peint : chevauchement en pixels, bande découverte de chaque
 * carte enfouie, et surtout le point que `elementFromPoint` attribue vraiment à
 * cette carte — la seule preuve honnête qu'elle reste cliquable.
 *
 *   node scripts/probe-attachement.mjs [dossier-de-captures] [url-de-base]
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log('ÉCHEC -', message);
};

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /obtenir le lien/i }).click();
await page.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 15000 });
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
await page.waitForFunction(() => window.__mtg?.getState().room?.status === 'PLAYING', null, {
  timeout: 15000,
});
await page.waitForFunction(
  () => (window.__mtg.getState().zoneCounts.get(window.__mtg.getState().mySeat + '|HAND') ?? 0) >= 7,
  null,
  { timeout: 15000 },
);

/**
 * Cinq permanents posés loin les uns des autres.
 *
 * Écartés à la main plutôt que laissés où le serveur les met : la mesure porte
 * sur le décalage d'attachement, et deux permanents déjà voisins fausseraient
 * autant la lecture que le calcul.
 */
const ids = await page.evaluate(() => {
  const s = window.__mtg.getState();
  const hand = [...s.cards.values()].filter((c) => c.zone.kind === 'HAND').slice(0, 5);
  hand.forEach((card, i) => {
    s.send({
      type: 'MOVE_CARD',
      cardId: card.id,
      to: { seat: s.mySeat, kind: 'BATTLEFIELD' },
      x: 120 + i * 220,
      y: 120,
    });
  });
  return hand.map((c) => c.id);
});
await page.waitForFunction(
  (list) => list.every((id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD'),
  ids,
  { timeout: 10000 },
);
await page.waitForTimeout(600);

const [cible, a1, a2, a3, aura] = ids;

/** Rectangles peints, plus le point que le navigateur attribue à chaque carte. */
const mesurer = async (liste) =>
  page.evaluate((cartes) => {
    const box = (id) => document.querySelector(`[data-card-id="${id}"]`)?.getBoundingClientRect();
    const out = {};
    for (const id of cartes) {
      const r = box(id);
      if (!r) continue;
      const el = document.querySelector(`[data-card-id="${id}"]`);
      const z = Number(el.style.zIndex);
      // Position en unités de panneau, lue là où le layout l'écrit : le
      // rectangle peint passe par l'échelle de la caméra et arrondit, ce qui
      // suffit à faire lire 14 là où la constante vaut 13.
      const ux = parseFloat(el.style.left);
      const uy = parseFloat(el.style.top);
      /*
       * Surface réellement atteignable : on balaie la carte au pas de deux
       * pixels et l'on compte les points que `elementFromPoint` rend à cette
       * carte-là. Comparer deux rectangles ne dirait rien des cartes qui
       * passent par-dessus sans être sa cible.
       */
      let atteignables = 0;
      let total = 0;
      let premier = null;
      for (let y = r.top + 1; y < r.bottom; y += 2) {
        for (let x = r.left + 1; x < r.right; x += 2) {
          total += 1;
          const hit = document.elementFromPoint(x, y)?.closest('[data-card-id]');
          if (hit && hit.getAttribute('data-card-id') === id) {
            atteignables += 1;
            if (!premier) premier = { x: Math.round(x), y: Math.round(y) };
          }
        }
      }
      out[id] = {
        ux,
        uy,
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        z,
        // Chaque point du balayage vaut 2 × 2 px d'écran.
        cliquable: atteignables * 4,
        part: total === 0 ? 0 : atteignables / total,
        point: premier,
      };
    }
    return out;
  }, liste);

const attacher = async (source, target) => {
  await page.evaluate(
    ([s, t]) => window.__mtg.getState().send({ type: 'ATTACH', sourceId: s, targetId: t }),
    [source, target],
  );
  await page.waitForFunction(
    ([s, t]) => window.__mtg.getState().cards.get(s)?.attachedTo === t,
    [source, target],
    { timeout: 8000 },
  );
  await page.waitForTimeout(350);
};

const decalage = (m, source, target) => ({
  dx: m[source].ux - m[target].ux,
  dy: m[source].uy - m[target].uy,
});

console.log('--- SERRAGE DES CARTES ATTACHÉES ---');

const echelle = (await mesurer([cible]))[cible].width / 83;
console.log(`échelle de rendu : ${echelle.toFixed(3)} (une carte de terrain fait 83 × 115 unités)`);
/*
 * Tout est aussi rendu en unités de panneau.
 *
 * La caméra ne cadre pas deux exécutions à la même échelle — elle s'ajuste à la
 * table —, et deux relevés en pixels d'écran ne sont donc pas comparables entre
 * eux. Les unités, elles, sont celles des constantes qu'on règle.
 */
const u = (px) => Math.round(px / echelle);
const u2 = (px2) => Math.round(px2 / (echelle * echelle));

// 1 attachement
await attacher(a1, cible);
let m = await mesurer([cible, a1]);
let d = decalage(m, a1, cible);
console.log(
  `1 attachée  : décalage ${d.dx} × ${d.dy} unités · ` +
    `bande découverte ${d.dx} unités à droite (${Math.round(d.dx * echelle)} px) / ` +
    `${d.dy} unités en bas (${Math.round(d.dy * echelle)} px) · ` +
    `surface cliquable ${m[a1].cliquable} px² = ${u2(m[a1].cliquable)} unités² (${Math.round(m[a1].part * 100)} % de la carte)`,
);
if (!m[a1].point) fail('la carte attachée n’a plus aucun point cliquable');
if (!(m[a1].z < m[cible].z)) fail('la carte attachée ne passe plus sous sa cible');

/*
 * 2 puis 3 attachements sur la même cible.
 *
 * Le rang d'une carte parmi ses frères ne suit pas l'ordre des attachements :
 * `attachmentLayout` les trie par identifiant, pour que l'empilement soit le
 * même sur tous les clients. On lit donc le rang sur l'écran — la carte la plus
 * basse est la plus enfouie — plutôt que de le supposer.
 */
const parRang = (ids, m) => [...ids].sort((x, y) => m[x].top - m[y].top);

await attacher(a2, cible);
m = await mesurer([cible, a1, a2]);
let rangs = parRang([a1, a2], m);
const f2 = decalage(m, rangs[1], rangs[0]);
console.log(
  `2 attachées : écart entre frères ${f2.dx} × ${f2.dy} unités (${Math.round(f2.dx * echelle)} × ${Math.round(f2.dy * echelle)} px) · ` +
    `la plus enfouie garde ${m[rangs[1]].cliquable} px² = ${u2(m[rangs[1]].cliquable)} unités² ` +
    `(${Math.round(m[rangs[1]].part * 100)} %)`,
);
if (!m[rangs[1]].point) fail('la seconde carte attachée n’est plus cliquable');

await attacher(a3, cible);
m = await mesurer([cible, a1, a2, a3]);
rangs = parRang([a1, a2, a3], m);
console.log(
  `3 attachées : surfaces cliquables par rang ` +
    rangs
      .map(
        (id, i) =>
          `rang ${i} = ${u2(m[id].cliquable)} unités² / ${m[id].cliquable} px² (${Math.round(m[id].part * 100)} %)`,
      )
      .join(' · '),
);
console.log(
  `             empilement z : cible ${m[cible].z} > ` + rangs.map((id) => m[id].z).join(' > '),
);
rangs.forEach((id, i) => {
  if (!m[id].point) fail(`la carte attachée de rang ${i} n’a plus aucun point cliquable`);
  /*
   * Plancher de 1000 unités² : la carte la plus enfouie en gardait environ
   * 1350 avant ce tour de vis, soit une bande de 7 unités de large. En dessous
   * de 1000 il ne reste plus de quoi viser à la souris, et le pas entre frères
   * est alors allé trop loin.
   */
  else if (u2(m[id].cliquable) < 1000) {
    fail(
      `la carte attachée de rang ${i} ne garde que ${u2(m[id].cliquable)} unités² : trop peu pour la viser`,
    );
  }
});

/** Encombrement du bloc : c'est lui que l'utilisateur trouve trop étalé. */
const gauche = Math.min(...[cible, a1, a2, a3].map((id) => m[id].left));
const droite = Math.max(...[cible, a1, a2, a3].map((id) => m[id].left + m[id].width));
const haut = Math.min(...[cible, a1, a2, a3].map((id) => m[id].top));
const bas = Math.max(...[cible, a1, a2, a3].map((id) => m[id].top + m[id].height));
console.log(
  `bloc de 4 cartes : ${u(droite - gauche)} × ${u(bas - haut)} unités ` +
    `(${Math.round(droite - gauche)} × ${Math.round(bas - haut)} px), pour une carte seule de 83 × 115 unités`,
);

/*
 * Chaîne : une aura posée sur un équipement, qui traverse `depth`.
 *
 * On la pose sur l'équipement de **rang 0**, et c'est tout le sujet : c'est le
 * moins enfoui des trois, donc celui dont l'enfant retombe dans la pile de ses
 * frères. Posée sur le dernier rang, l'aura tombe sous tout le monde, bien
 * dégagée — et la sonde ne verrait jamais le cas qui coince. Il faut que le
 * décalage d'attachement reste franchement plus grand que deux pas de frère,
 * sans quoi l'aura se range exactement sous le frère de rang 2 et disparaît.
 */
await attacher(aura, rangs[0]);
m = await mesurer([cible, a1, a2, a3, aura]);
const dChaine = decalage(m, aura, cible);
console.log(
  `chaîne (aura sur l’équipement de rang 0) : l’aura est à ${dChaine.dx} × ${dChaine.dy} unités de la cible racine, ` +
    `z ${m[aura].z} (racine ${m[cible].z}), ${u2(m[aura].cliquable)} unités² cliquables`,
);
if (!(m[aura].z < m[rangs[0]].z)) fail('l’aura ne passe pas sous l’équipement qu’elle habille');
if (!m[aura].point) fail('l’aura de la chaîne n’est plus cliquable');
/*
 * Plancher de 600 unités² pour l'aura de la chaîne : c'est le pire cas du
 * panneau, et il était déjà serré — de quoi la survoler, pas davantage.
 */
else if (u2(m[aura].cliquable) < 600) {
  fail(`l’aura de la chaîne ne garde que ${u2(m[aura].cliquable)} unités² : trop peu pour la viser`);
}

/** Le badge de lien doit rester lisible : c'est lui qui dit « il y a autre chose ». */
const badge = await page.evaluate(
  ([racine, milieu]) => {
    const lire = (id) => {
      const el = document.querySelector(`[data-card-id="${id}"] [data-test="attach-badge"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      let vus = 0;
      let total = 0;
      for (let y = r.top + 1; y < r.bottom; y += 2) {
        for (let x = r.left + 1; x < r.right; x += 2) {
          total += 1;
          /*
           * Le badge ne prend pas le pointeur, et il déborde volontairement de
           * sa carte : on ne peut donc pas exiger que la carte porteuse
           * réponde — au-dessus et à droite d'elle, c'est le fond qui répond,
           * alors que le badge s'y voit parfaitement. Seule une **autre** carte
           * sous le pointeur signifie badge masqué.
           */
          const hit = document.elementFromPoint(x, y)?.closest('[data-card-id]');
          if (!hit || hit.getAttribute('data-card-id') === id) vus += 1;
        }
      }
      return { texte: el.textContent.trim(), visible: total === 0 ? 0 : vus / total };
    };
    return { racine: lire(racine), milieu: lire(milieu) };
  },
  [cible, rangs[0]],
);
console.log(
  `badge de lien : sur la cible « ${badge.racine?.texte} » visible à ${Math.round((badge.racine?.visible ?? 0) * 100)} %, ` +
    `sur l’équipement porteur d’aura « ${badge.milieu?.texte} » visible à ${Math.round((badge.milieu?.visible ?? 0) * 100)} %`,
);
/*
 * Le badge de la carte du **milieu** d'une chaîne est le cas dur : deux frères
 * lui passent dessus, et il n'en restait déjà qu'un tiers avant ce tour de vis,
 * dans cet arrangement volontairement chargé. On garde donc un plancher bas —
 * de quoi lire le chiffre —, et l'on surveille surtout celui de la cible, qui
 * lui doit rester entier.
 */
if ((badge.milieu?.visible ?? 0) < 0.25) {
  fail('le badge de lien de la carte du milieu n’est plus lisible');
}
if ((badge.racine?.visible ?? 0) < 0.95) {
  fail('le badge de lien de la cible est masqué par ce qui lui est attaché');
}

// Et l'on vérifie que le survol atteint bien la carte enfouie, pas sa voisine.
const enfouie = rangs[rangs.length - 1];
if (m[enfouie].point) {
  const survol = await page.evaluate(
    ([id, x, y]) => {
      const el = document.elementFromPoint(x, y);
      el?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      return { vise: el?.closest('[data-card-id]')?.getAttribute('data-card-id') === id };
    },
    [enfouie, m[enfouie].point.x, m[enfouie].point.y],
  );
  if (!survol.vise) fail('le point relevé sur la carte la plus enfouie ne la vise pas');
} else {
  fail('la carte la plus enfouie n’offre aucun point à survoler');
}

await page.screenshot({ path: `${OUT}/sonde-attachement.png` });

console.log(failures === 0 ? 'TOUT PASSE' : `${failures} échec(s)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

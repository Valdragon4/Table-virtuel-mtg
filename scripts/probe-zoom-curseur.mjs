/**
 * Sonde : la molette zoome **vers le curseur**, et non vers l'origine du plan.
 *
 * Ce qu'on mesure, et pourquoi on le mesure ainsi.
 *
 * Le plan est peint avec `translate(view.x, view.y) scale(view.scale)`, origine
 * de transformation fixe. Ne toucher qu'à l'échelle éloigne donc tout de
 * l'origine du plan : selon l'endroit où la caméra se trouve, l'utilisateur voit
 * « ça zoome vers le centre du terrain ». La correction attendue est celle de
 * tout plan zoomable — **le point du monde sous le curseur reste sous le
 * curseur**. Ça ne se juge pas à l'œil : on pose un repère identifiable (une
 * carte réelle sur le champ de bataille), on lit son rectangle à l'écran, on
 * amène le curseur exactement sur son centre, on tourne la molette, et l'on
 * relit le rectangle. L'écart du centre au curseur est le nombre qui compte.
 *
 * Quatre cas, et le deuxième est celui qui distingue une correction juste d'une
 * correction approximative :
 *
 *  1. **curseur près du centre** du cadre — le cas facile : là, « vers le
 *     curseur » et « vers le centre » se ressemblent, et même un zoom faux s'en
 *     tire à peu près ;
 *  2. **curseur près d'un coin** — on déplace la caméra pour amener la même
 *     carte dans un coin, et l'écart entre les deux comportements devient
 *     maximal. C'est le cas qui prouve quelque chose ;
 *  3. **le coin où le bridage de caméra mord** — `clampView` borne aussi la
 *     position : quand il refuse le déplacement demandé, le point visé glisse,
 *     et l'on exige alors que ce glissement soit bien celui du bridage — borné,
 *     et ramenant la table vers le cadre ;
 *  4. **plafond d'échelle** — au maximum, un cran de molette de plus ne doit
 *     **rien** déplacer. Compenser la position pour une échelle que le bridage
 *     refuse ferait dériver la table sous un zoom qui ne bouge plus, et c'est le
 *     défaut classique de cette correction.
 *
 *   node probe-zoom-curseur.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const NL = String.fromCharCode(10);
const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '', '// Deck', '4 Sol Ring', '20 Plains'].join(NL);

/** Tolérance, en pixels écran. Un pixel ou deux d'arrondi de rendu sont normaux. */
const TOLERANCE = 6;
/** Crans de molette par mesure : assez pour que l'erreur, si elle existe, crève les yeux. */
const CRANS = 5;

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

const contexte = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const alice = await seat(contexte, 'Alice');
const room = alice.url();
const bob = await seat(await browser.newContext({ viewport: { width: 1280, height: 800 } }), 'Bob', room);
await alice.getByRole('button', { name: 'Lancer la partie' }).click();
await alice.waitForFunction(() => window.__mtg.getState().room?.status === 'PLAYING', null, {
  timeout: 20000,
});

const send = (page, intent) => page.evaluate((i) => window.__mtg.getState().send(i), intent);
const mySeat = await alice.evaluate(() => window.__mtg.getState().mySeat);

/** Le repère : une vraie carte, posée à un endroit connu du champ de bataille. */
const repere = await alice.evaluate(() => {
  const s = window.__mtg.getState();
  return [...s.cards.values()].find((c) => c.zone.kind === 'HAND' && c.zone.seat === s.mySeat)?.id ?? null;
});
if (!repere) throw new Error('aucune carte en main pour servir de repère');
await send(alice, { type: 'MOVE_CARD', cardId: repere, to: { seat: mySeat, kind: 'BATTLEFIELD' }, x: 240, y: 240 });
await alice.waitForFunction(
  (id) => window.__mtg.getState().cards.get(id)?.zone.kind === 'BATTLEFIELD',
  repere,
  { timeout: 12000 },
);
await alice.waitForSelector(`[data-card="${repere}"]`, { timeout: 12000 });

/** Centre du repère, en pixels écran. C'est la seule grandeur observée. */
const centre = () =>
  alice.evaluate((id) => {
    const r = document.querySelector(`[data-card="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, repere);

const echelle = () => alice.evaluate(() => window.__mtg.getState().viewScale);
const rendus = () => alice.evaluate(() => window.__mtgTableRenders ?? 0);

async function molette(delta, crans = CRANS) {
  for (let i = 0; i < crans; i++) {
    await alice.mouse.wheel(0, delta);
    await alice.waitForTimeout(70);
  }
}

const ecart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const axes = (a, b) => `dx ${(a.x - b.x).toFixed(1)} / dy ${(a.y - b.y).toFixed(1)}`;
const dit = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

/**
 * Amène le repère sous un point donné de l'écran, par un déplacement de caméra
 * au bouton droit. C'est ainsi qu'on choisit *où* la mesure aura lieu : au
 * milieu du cadre, puis dans un coin.
 *
 * Le bridage de caméra peut refuser une partie du déplacement ; on relit donc
 * toujours la position réellement obtenue au lieu de la supposer.
 */
async function panVers(cible) {
  const depart = await centre();
  if (!depart) throw new Error('repère introuvable à l écran');
  await alice.mouse.move(depart.x, depart.y);
  await alice.mouse.down({ button: 'right' });
  await alice.mouse.move(cible.x, cible.y, { steps: 12 });
  await alice.mouse.up({ button: 'right' });
  await alice.waitForTimeout(150);
  return centre();
}

/**
 * Une mesure complète : curseur posé sur le centre du repère, molette dans un
 * sens puis dans l'autre, écart relevé à chaque fois.
 */
async function mesure(nom) {
  const depart = await centre();
  if (!depart) throw new Error('repère introuvable à l écran');
  await alice.mouse.move(depart.x, depart.y);
  await alice.waitForTimeout(80);
  const echelleDepart = await echelle();

  // Sens avant. On revient ensuite à l'échelle de départ, pour que les deux
  // sens soient mesurés depuis le même état : un aller-retour de molette est
  // réversible même quand le zoom est faux, il ne prouverait donc rien.
  await molette(-120);
  const arrivee1 = await centre();
  const derive1 = ecart(arrivee1, depart);
  console.log(`      (${nom}, avant : ${axes(arrivee1, depart)})`);
  await molette(120);
  await alice.waitForTimeout(80);

  // Sens arrière, depuis ce même état de départ.
  const repris = await centre();
  await molette(120);
  const arrivee2 = await centre();
  const derive2 = ecart(arrivee2, repris);
  console.log(`      (${nom}, arrière : ${axes(arrivee2, repris)}, échelle ${(await echelle()).toFixed(3)})`);
  await molette(-120);
  await alice.waitForTimeout(80);

  console.log(
    `      ${nom} : curseur ${dit(depart)}, échelle ${echelleDepart.toFixed(2)} — après ${CRANS} crans ` +
      `avant, le centre du repère est à ${derive1.toFixed(1)} px du curseur ; après ${CRANS} crans ` +
      `arrière, à ${derive2.toFixed(1)} px.`,
  );
  check(derive1 <= TOLERANCE, `${nom} : zoom avant, le repère reste sous le curseur (${derive1.toFixed(1)} px)`);
  check(derive2 <= TOLERANCE, `${nom} : zoom arrière, le repère reste sous le curseur (${derive2.toFixed(1)} px)`);
  return { derive1, derive2 };
}

/*
 * On prend d'abord la vue d'ensemble : le repère vient d'être posé sur un
 * champ de bataille qui, au cadrage initial, tombe sous le rail de main — un
 * point qui n'appartient pas à la surface de table, où la molette n'est même
 * pas captée. La sonde ne mesurerait alors rien du tout.
 */
await alice.locator('[data-test="recenter"]').click();
await alice.waitForTimeout(250);
/*
 * La vue d'ensemble s'arrête au plancher de zoom : on y mesurerait un « zoom
 * arrière » que le bridage refuse en entier, c'est-à-dire rien. On remonte donc
 * de quelques crans pour travailler à une échelle courante, celle où le joueur
 * se trouve vraiment.
 */
await alice.mouse.move(830, 420);
await molette(-120, 6);

// 1. Curseur au milieu du cadre : le cas facile.
const milieu = await panVers({ x: 830, y: 420 });
console.log(`      repère amené en ${dit(milieu)} pour la mesure centrale`);
await mesure('centre du cadre');

/*
 * 2. Curseur près d'un coin. Même mesure, mais le repère amené en bas à
 * gauche : c'est là que l'écart entre « vers le curseur » et « vers le centre »
 * est maximal, et donc là que le cas se décide.
 */
const pose = await panVers({ x: 410, y: 620 });
console.log(`      repère amené en ${dit(pose)} (visé 410,620) pour la mesure de coin`);
await mesure('coin bas gauche');

/*
 * 3. Le coin où **le bridage de caméra mord**, et ce qu'on a décidé d'en faire.
 *
 * `clampView` borne aussi `x`/`y` : la table ne doit jamais s'échapper du cadre
 * au point qu'on ne sache plus dans quelle direction revenir. Or dézoomer avec
 * le curseur en haut à droite, alors que le repère appartient au panneau du bas,
 * demande à la caméra une position que ces bornes refusent. L'arbitrage retenu
 * est que **le bridage garde le dernier mot** : le point visé glisse alors le
 * long des axes bridés, plutôt que de laisser la table partir dans le vide. Ce
 * qu'on exige ici, c'est que ce glissement reste celui du bridage — borné, et
 * ramenant le repère **vers** le cadre, jamais hors de lui.
 */
const brid = await panVers({ x: 1262, y: 170 });
console.log(`      repère amené en ${dit(brid)} (visé 1262,170) pour le cas du bridage`);
await alice.mouse.move(brid.x, brid.y);
await alice.waitForTimeout(80);
await molette(120);
const apresBride = await centre();
const deriveBride = ecart(apresBride, brid);
console.log(`      bridage : ${axes(apresBride, brid)} — soit ${deriveBride.toFixed(1)} px`);
check(
  deriveBride < 150,
  `bridage : le zoom arrière au coin haut droit rogne sans téléporter (${deriveBride.toFixed(1)} px)`,
);
check(
  apresBride.x < brid.x && apresBride.y > brid.y,
  'bridage : le repère est ramené vers le cadre, pas poussé dehors',
);
check(
  apresBride.x > 304 && apresBride.x < 1360 && apresBride.y > 60 && apresBride.y < 730,
  `bridage : le repère reste visible dans l espace libre (${dit(apresBride)})`,
);

/*
 * 4. Le plafond d'échelle. On monte jusqu'à ce que l'échelle ne bouge plus, puis
 * on donne un cran de plus : rien ne doit bouger, ni l'échelle, ni le repère.
 */
await molette(-120, 30);
const plafond = await echelle();
const avantCran = await centre();
const rendusAvant = await rendus();
await molette(-120, 1);
const apresCran = await centre();
const derivePlafond = ecart(apresCran, avantCran);
const rendusApres = await rendus();
console.log(
  `      plafond : échelle ${plafond.toFixed(3)} — un cran de plus déplace le repère de ` +
    `${derivePlafond.toFixed(1)} px (${rendusApres - rendusAvant} rendu(s) du plan).`,
);
check(plafond >= 2.4, `l'échelle atteint bien son plafond (${plafond.toFixed(3)})`);
check(
  Math.abs((await echelle()) - plafond) < 1e-6,
  'au plafond, un cran de plus ne change pas l échelle',
);
check(derivePlafond < 0.5, `au plafond, un cran de plus ne déplace pas la table (${derivePlafond.toFixed(1)} px)`);
check(
  rendusApres === rendusAvant,
  `au plafond, un cran de plus ne re-rend pas le plan (${rendusApres - rendusAvant})`,
);

await alice.screenshot({ path: 'probe-zoom-curseur.png' });
await bob.close();
console.log(failures === 0 ? 'TOUT PASSE' : `${failures} échec(s)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

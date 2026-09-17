/**
 * Quitter une table, et la clore.
 *
 * Trois gestes que l'on ne peut pas vérifier autrement qu'en les faisant à deux
 * navigateurs : un joueur s'en va pour de bon en pleine partie, l'autre le voit
 * partir, puis l'hôte remballe et les deux l'apprennent.
 *
 *   node scripts/probe-leave.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? process.env.MTG_BASE_URL ?? 'http://localhost:3000';

const DECK = ['// Commander', '1 Selenia, the Cursed Heart', '', '// Deck', '10 Plains', '10 Swamp'].join('\n');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} - ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const sit = async (page, code, name) => {
  await page.goto(`${BASE}/rooms/${code}`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Invité').fill(name);
  await page.getByPlaceholder(/Sol Ring/).fill(DECK);
  await page.getByRole('button', { name: "S'asseoir à la table" }).click();
  await page.getByText('Journal').waitFor({ state: 'visible', timeout: 60000 });
  /*
   * « Journal » n'annonce qu'un siège obtenu, jamais un deck chargé : la
   * résolution de la liste est asynchrone. En production elle prend une bonne
   * seconde de plus qu'en local, et la sonde lançait la partie avant que le
   * deck du second joueur soit là — le serveur refusait (« Deck manquant »),
   * la table restait en `LOBBY`, et l'attente suivante expirait sans jamais
   * dire pourquoi. On attend donc l'event, pas un délai.
   */
  await page.waitForFunction(
    () => {
      const s = window.__mtg.getState();
      return (s.zoneCounts.get(`${s.mySeat}|LIBRARY`) ?? 0) > 0;
    },
    null,
    { timeout: 60000 },
  );
};

const state = (page) =>
  page.evaluate(() => {
    const s = window.__mtg.getState();
    return {
      mySeat: s.mySeat,
      seats: s.seats.map((seat) => seat.displayName),
      status: s.room?.status ?? null,
      closed: s.room?.closed ?? null,
      gameOver: s.gameOver?.reason ?? null,
    };
  });

const browser = await chromium.launch({ headless: true });
const host = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const guest = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

try {
  await host.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await host.getByRole('button', { name: /obtenir le lien/i }).click();
  await host.waitForURL(/\/rooms\/[A-Z0-9]+/, { timeout: 20000 });
  const code = host.url().split('/').pop();
  console.log('      table:', code);

  await sit(host, code, 'Hôte');
  await sit(guest, code, 'Invité·e');
  await host.waitForFunction(() => window.__mtg.getState().seats.length === 2, null, { timeout: 15000 });
  // Les deux decks doivent être visibles de l'hôte : c'est lui qui lance.
  await host.waitForFunction(
    () => window.__mtg.getState().seats.every((seat) => Boolean(seat.deckName)),
    null,
    { timeout: 30000 },
  );

  await host.getByRole('button', { name: /Lancer la partie/ }).click();
  await host.waitForFunction(() => window.__mtg.getState().room?.status === 'PLAYING', null, { timeout: 15000 });

  // ---------------------------------------------------- quitter pour de bon
  guest.once('dialog', (dialog) => void dialog.accept());
  // Le chevron, pas le bouton : « Quitter » seul s'absente en un clic et ne
  // rend pas le siège — c'est précisément la distinction qu'on vérifie ici.
  await guest.locator('[data-test="leave-more"]').click();
  await guest.getByText('Quitter la table pour de bon').click();

  await host.waitForFunction(() => window.__mtg.getState().seats.length === 1, null, { timeout: 15000 });
  const afterLeave = await state(host);
  check('le siège du partant disparaît chez les autres', afterLeave.seats.length === 1, JSON.stringify(afterLeave.seats));
  check(
    'plus aucune carte du partant sur la table',
    (await host.evaluate(() => [...window.__mtg.getState().cards.values()].every((c) => c.owner === window.__mtg.getState().mySeat))),
  );

  const guestState = await state(guest);
  check('le partant n’a plus de siège', guestState.mySeat === null, JSON.stringify(guestState));

  // --------------------------------------------------------- clore la table
  // Le départ n'a laissé qu'un joueur : la partie est terminée, et l'annonce
  // couvre la table. On l'écarte — c'est précisément ce qu'elle propose.
  await host.getByText('Partie terminée').waitFor({ timeout: 8000 });
  check('la fin de partie est annoncée', true);
  await host.getByRole('button', { name: 'Regarder le terrain' }).click();

  host.once('dialog', (dialog) => void dialog.accept());
  await host.locator('[data-test="leave-more"]').click();
  await host.getByText('Clore la table').click();
  // On attend `closed`, pas `status` : la partie était déjà terminée par la
  // concession du partant, et attendre `ENDED` revenait à ne rien attendre.
  await host.waitForFunction(() => window.__mtg.getState().room?.closed === true, null, { timeout: 15000 });
  const closed = await state(host);
  check('la table est close', closed.closed === true, JSON.stringify(closed));
  await host.getByText('Table close').waitFor({ timeout: 5000 });
  check('la clôture est annoncée à l’écran', true);
} catch (error) {
  check('déroulé complet', false, String(error).split('\n')[0]);
} finally {
  await browser.close();
  console.log(failures === 0 ? '\nTout est passé' : `\n${failures} ÉCHEC(S)`);
  process.exit(0);
}

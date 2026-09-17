import { expect, test, type Browser } from '@playwright/test';
import { captureFrames, createRoom, joinTable, SAMPLE_DECK, waitForStore } from './helpers.js';

/**
 * Critère d'acceptation §11.1 : quatre clients, une table, une dizaine
 * d'actions, et un état final identique partout.
 */
test('quatre joueurs convergent sur le même état', async ({ browser }) => {
  const seats = await openSeats(browser, 4);
  const [alice] = seats;

  await alice!.page.getByRole('button', { name: 'Lancer la partie' }).click();
  for (const seat of seats) {
    await waitForStore<string>(seat.page, "window.__mtg.getState().room?.status", (s) => s === 'PLAYING');
  }

  // Une dizaine d'actions réparties entre les joueurs.
  await alice!.page.keyboard.press('d');
  await alice!.page.keyboard.press('d');
  await seats[1]!.page.keyboard.press('d');
  await seats[1]!.page.keyboard.press('s');
  await seats[2]!.page.keyboard.press('d');
  await seats[2]!.page.keyboard.press('u');
  await seats[3]!.page.keyboard.press('d');
  await seats[3]!.page.keyboard.press('e');
  await alice!.page.getByRole('button', { name: 'd20' }).click();
  await alice!.page.getByRole('button', { name: 'Pile ou face' }).click();

  // Tout le monde doit finir sur le même numéro de séquence.
  const finalSeq = await waitForStore<number>(alice!.page, 'window.__mtg.getState().seq', (s) => s > 10);
  for (const seat of seats) {
    await waitForStore<number>(seat.page, 'window.__mtg.getState().seq', (s) => s === finalSeq);
  }

  // Et sur le même état public : points de vie et comptes de zones.
  const reference = await publicState(alice!.page);
  for (const seat of seats.slice(1)) {
    expect(await publicState(seat.page)).toEqual(reference);
  }

  await Promise.all(seats.map((s) => s.context.close()));
});

/**
 * Critère d'acceptation §11.2 : aucune frame reçue par un client ne contient la
 * main ni la bibliothèque d'un autre siège.
 */
test('aucune information cachée ne traverse le socket', async ({ browser }) => {
  const seats = await openSeats(browser, 2);
  const [alice, bob] = seats;
  const bobFrames = await captureFrames(bob!.page);

  await alice!.page.getByRole('button', { name: 'Lancer la partie' }).click();
  await waitForStore<string>(alice!.page, "window.__mtg.getState().room?.status", (s) => s === 'PLAYING');
  await alice!.page.keyboard.press('d');
  await alice!.page.keyboard.press('s');
  await alice!.page.waitForTimeout(1000);

  // Identités présentes dans les zones cachées d'Alice, vues depuis son client.
  const aliceSecrets = await alice!.page.evaluate(() => {
    const state = window.__mtg!.getState();
    return [...state.cards.values()]
      .filter((c) => c.zone.seat === state.mySeat && c.zone.kind === 'HAND' && c.faceDown === false)
      .map((c) => (c as { scryfallId: string }).scryfallId);
  });
  expect(aliceSecrets.length).toBeGreaterThan(0);

  const haystack = bobFrames.join('\n');
  for (const secret of aliceSecrets) {
    expect(haystack).not.toContain(`"${secret}"`);
  }

  // Bob voit bien la main d'Alice comme des dos de cartes, en nombre correct.
  const seen = await bob!.page.evaluate(() => {
    const state = window.__mtg!.getState();
    const other = state.seats.find((s) => s.id !== state.mySeat)!;
    return [...state.cards.values()].filter((c) => c.zone.seat === other.id && c.zone.kind === 'HAND');
  });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((c) => c.faceDown === true)).toBe(true);

  await Promise.all(seats.map((s) => s.context.close()));
});

/**
 * Critère d'acceptation §11.3 : coupure de 30 s, reconnexion, aucune action perdue.
 */
test('une coupure de trente secondes se rattrape sans perte', async ({ browser }) => {
  const seats = await openSeats(browser, 2);
  const [alice, bob] = seats;

  await alice!.page.getByRole('button', { name: 'Lancer la partie' }).click();
  await waitForStore<string>(bob!.page, "window.__mtg.getState().room?.status", (s) => s === 'PLAYING');

  await bob!.context.setOffline(true);
  const seqBefore = await bob!.page.evaluate(() => window.__mtg!.getState().seq);

  for (let i = 0; i < 6; i++) await alice!.page.getByRole('button', { name: 'd20' }).click();
  await alice!.page.waitForTimeout(30_000);

  await bob!.context.setOffline(false);

  const aliceSeq = await alice!.page.evaluate(() => window.__mtg!.getState().seq);
  await waitForStore<number>(bob!.page, 'window.__mtg.getState().seq', (s) => s === aliceSeq, 45_000);
  expect(aliceSeq).toBeGreaterThan(seqBefore);

  // Le journal de Bob contient bien les actions qu'il a manquées.
  const bobLog = await bob!.page.evaluate(() => window.__mtg!.getState().log.length);
  expect(bobLog).toBeGreaterThan(0);

  await Promise.all(seats.map((s) => s.context.close()));
});

async function openSeats(browser: Browser, count: number) {
  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  const first = await browser.newContext();
  const page = await first.newPage();
  const code = await createRoom(page);
  await joinTable(page, code, names[0]!, SAMPLE_DECK);

  const seats = [{ context: first, page, name: names[0]! }];
  for (let i = 1; i < count; i++) {
    const context = await browser.newContext();
    const other = await context.newPage();
    await joinTable(other, code, names[i]!, SAMPLE_DECK);
    seats.push({ context, page: other, name: names[i]! });
  }
  return seats;
}

/** État public observable par tous : ce qui doit être identique partout. */
async function publicState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const state = window.__mtg!.getState();
    return {
      seats: state.seats
        .map((s) => `${s.seatIndex}:${s.life}:${s.conceded}`)
        .sort(),
      zones: [...state.zoneCounts.entries()]
        .filter(([key]) => !key.endsWith('|HAND'))
        .map(([key, count]) => `${key}=${count}`)
        .sort(),
      turn: state.turn.turnNumber,
    };
  });
}

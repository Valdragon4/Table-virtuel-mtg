import type { BrowserContext, Page } from '@playwright/test';

/** Liste minimale mais réaliste, suffisante pour jouer une dizaine d'actions. */
export const SAMPLE_DECK = [
  '// Commander',
  '1 Selenia, the Cursed Heart',
  '',
  '// Deck',
  '4 Sol Ring',
  '4 Arcane Signet',
  '4 Swords to Plowshares',
  '10 Plains',
  '10 Swamp',
].join('\n');

export interface Seat {
  context: BrowserContext;
  page: Page;
  name: string;
}

/** Ouvre la table, s'assoit avec une liste collée et attend la table rendue. */
export async function joinTable(page: Page, code: string, name: string, deckText: string): Promise<void> {
  await page.goto(`/rooms/${code}`);
  await page.getByPlaceholder('Invité').fill(name);
  await page.getByPlaceholder(/Sol Ring/).fill(deckText);
  await page.getByRole('button', { name: "S'asseoir à la table" }).click();
  await page.getByText('Journal').waitFor({ state: 'visible' });
}

export async function createRoom(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /obtenir le lien/i }).click();
  await page.waitForURL(/\/rooms\/[A-Z0-9]+/);
  return page.url().split('/').pop()!;
}

/**
 * Capture toutes les frames WebSocket reçues par une page. Sert au test
 * d'étanchéité : on inspecte le trafic réel, pas l'état de l'application.
 */
export async function captureFrames(page: Page): Promise<string[]> {
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') frames.push(frame.payload);
    });
  });
  return frames;
}

/** Attend qu'une condition sur le store client soit vraie. */
export async function waitForStore<T>(
  page: Page,
  read: string,
  predicate: (value: T) => boolean,
  timeout = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = (await page.evaluate(read)) as T;
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`Condition non atteinte pour ${read} : ${JSON.stringify(value)}`);
    await page.waitForTimeout(250);
  }
}

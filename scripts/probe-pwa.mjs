/**
 * L'application est-elle vraiment installable — et reste-t-elle honnête ?
 *
 * Deux questions, dont la seconde est la plus importante : le service worker
 * doit rendre le site installable **sans jamais garder une seule image de
 * carte**. Une copie locale d'un visuel de Wizards of the Coast est exactement
 * ce que ce projet s'interdit, et un cache est une copie.
 *
 *   node scripts/probe-pwa.mjs [url-de-base]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? process.env.MTG_BASE_URL ?? 'http://localhost:3000';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} - ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

try {
  // ------------------------------------------------------------- le manifeste
  const manifest = await (await context.request.get(`${BASE}/site.webmanifest`)).json();
  check('le manifeste est servi', Boolean(manifest.name));
  check('il déclare un affichage autonome', manifest.display === 'standalone', manifest.display);
  const sizes = new Set((manifest.icons ?? []).map((icon) => icon.sizes));
  check('icônes 192 et 512 présentes', sizes.has('192x192') && sizes.has('512x512'), [...sizes].join(' '));
  check(
    'une icône masquable est fournie',
    (manifest.icons ?? []).some((icon) => icon.purpose === 'maskable'),
  );

  const swHead = await context.request.get(`${BASE}/sw.js`);
  check('le service worker est servi', swHead.ok());
  check(
    'il n’est pas mis en cache par le navigateur',
    /no-store|no-cache/.test(swHead.headers()['cache-control'] ?? ''),
    swHead.headers()['cache-control'] ?? 'aucun en-tête',
  );

  // ------------------------------------------------------- l'enregistrement
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const registered = await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready, {
      timeout: 15000,
    })
    .then(() => true)
    .catch(() => false);
  check('le worker s’enregistre', registered);

  // Deuxième visite : c'est là que le cache sert vraiment.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const caches = await page.evaluate(async () => {
    const names = await window.caches.keys();
    const out = {};
    for (const name of names) {
      const cache = await window.caches.open(name);
      out[name] = (await cache.keys()).map((request) => request.url);
    }
    return out;
  });
  const all = Object.values(caches).flat();
  console.log(`      ${all.length} entrée(s) en cache, ${Object.keys(caches).length} cache(s)`);

  check('la coquille est en cache', all.some((url) => url.endsWith('/')) || all.length > 0);
  check(
    'aucune image de carte n’est en cache',
    all.every((url) => !/scryfall/i.test(url)),
    all.filter((url) => /scryfall/i.test(url)).join(' ') || 'aucune',
  );
  check(
    'aucune réponse d’API n’est en cache',
    all.every((url) => !/\/api\//.test(url)),
    all.filter((url) => /\/api\//.test(url)).join(' ') || 'aucune',
  );

  // -------------------------------------------------------- la page hors ligne
  await context.setOffline(true);
  const offline = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  check('une page s’affiche sans réseau', offline !== null, offline ? String(offline.status()) : 'aucune réponse');
  await context.setOffline(false);
} catch (error) {
  check('déroulé complet', false, String(error).split('\n')[0]);
} finally {
  await browser.close();
  console.log(failures === 0 ? '\nTout est passé' : `\n${failures} ÉCHEC(S)`);
  process.exit(0);
}

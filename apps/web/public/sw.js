/*
 * Service worker de la table virtuelle.
 *
 * Ce qu'il fait, et surtout ce qu'il ne fait pas.
 *
 * **Il ne met en cache aucune carte.** Les images de cartes viennent du CDN de
 * Scryfall et sont chargées par le navigateur du joueur ; les mettre en cache
 * ici reviendrait à en héberger une copie, ce que ce projet s'interdit
 * formellement (voir `docs/backlog.md`, règles permanentes). Toute requête vers
 * scryfall.io, ou toute image qui n'est pas la nôtre, est donc laissée au
 * réseau sans jamais passer par le cache.
 *
 * **Il ne met pas non plus l'API en cache.** Une partie est un état vivant,
 * autoritatif côté serveur : servir une réponse périmée depuis un cache local
 * serait exactement le genre de mensonge que le protocole s'emploie à rendre
 * impossible. `/api` et `/ws` passent tout droit.
 *
 * Ce qu'il met en cache, c'est la **coquille** : le document, les scripts, les
 * styles, les polices et les icônes du site. C'est ce qui rend l'installation
 * possible, le démarrage instantané, et c'est ce qui permet d'afficher une page
 * honnête quand le réseau manque, plutôt que le dinosaure du navigateur.
 *
 * Stratégie :
 *  - navigation  → réseau d'abord, coquille en secours (l'application est un
 *    SPA : toute route retombe sur `/`) ;
 *  - nos statiques → cache d'abord, rafraîchis en arrière-plan ;
 *  - le reste    → réseau, sans interception.
 */

// Change à chaque déploiement de la coquille : les anciens caches sont purgés
// à l'activation.
const VERSION = 'v2';
const SHELL = `coquille-${VERSION}`;
const ASSETS = `statiques-${VERSION}`;

/** Ce qu'il faut pour afficher quelque chose sans réseau. */
const SHELL_URLS = [
  '/',
  '/favicon.svg',
  '/favicon-32.png',
  '/icon-192.png',
  '/site.webmanifest',
  '/fonts/archivo-latin.woff2',
  '/fonts/courier-prime-400-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // `reload` : on ne veut pas remplir le cache avec ce que le cache HTTP
      // gardait de la version précédente.
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL && key !== ASSETS).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Une requête que ce worker n'a pas à connaître. */
function passthrough(url, request) {
  if (request.method !== 'GET') return true;
  // Tout ce qui n'est pas notre origine : Scryfall en premier lieu.
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.startsWith('/ws/')) return true;
  return false;
}

/** Nos propres fichiers versionnés, sûrs à garder. */
function isOwnAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    /\.(?:css|js|woff2|svg|png|webmanifest)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (passthrough(url, event.request)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/', { ignoreSearch: true });
          return cached ?? offlinePage();
        }),
    );
    return;
  }

  if (!isOwnAsset(url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Cache d'abord, mais on rafraîchit derrière : un déploiement ne laisse
      // pas un joueur sur une version d'hier.
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(ASSETS).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});

/**
 * La page de secours. Elle dit la vérité — la table a besoin du réseau, parce
 * que l'état de la partie vit sur le serveur — plutôt que de faire semblant.
 */
function offlinePage() {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors ligne — Table virtuelle MTG</title>
<style>
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#0b0e14;color:#e8e2d5;font:16px/1.6 system-ui,sans-serif;padding:24px}
 div{max-width:32rem}
 h1{font-size:1.4rem;margin:0 0 .6rem}
 p{margin:0 0 .4rem;color:#9aa3b2}
</style></head><body><div>
<h1>Pas de réseau</h1>
<p>La table vit sur le serveur : sans connexion, il n’y a rien à jouer.</p>
<p>Reconnectez-vous, puis rechargez — votre siège vous attend.</p>
</div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 503 },
  );
}

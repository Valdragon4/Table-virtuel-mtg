/**
 * Installation de l'application.
 *
 * Le service worker n'est enregistré qu'en production : en développement il
 * servirait une coquille mise en cache pendant qu'on modifie le code, et l'on
 * passerait la journée à se demander pourquoi une correction ne prend pas.
 *
 * On ne force jamais le rechargement d'une page en cours : quelqu'un peut être
 * en pleine partie. Une nouvelle version prend au prochain chargement, ce que
 * `skipWaiting` côté worker rend immédiat dès que l'onglet est rouvert.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Un worker qui ne s'enregistre pas ne doit rien casser : le site marche
      // exactement pareil sans lui.
    });
  });
}

/**
 * L'invite d'installation du navigateur, gardée de côté.
 *
 * Chrome émet `beforeinstallprompt` une seule fois et annule l'invite native si
 * on ne la retient pas. On la conserve donc pour pouvoir la proposer au bon
 * moment — depuis l'accueil — plutôt que jamais.
 */
let deferred: (Event & { prompt: () => Promise<void> }) | null = null;
const listeners = new Set<(available: boolean) => void>();

export function watchInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as Event & { prompt: () => Promise<void> };
    for (const listener of listeners) listener(true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    for (const listener of listeners) listener(false);
  });
}

export function onInstallAvailable(listener: (available: boolean) => void): () => void {
  listeners.add(listener);
  listener(deferred !== null);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const prompt = deferred;
  deferred = null;
  for (const listener of listeners) listener(false);
  await prompt.prompt();
}

/** Vrai quand la page tourne déjà en application installée. */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

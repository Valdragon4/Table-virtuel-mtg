/**
 * L'invite d'installation, proposée et jamais imposée.
 *
 * Le navigateur n'émet `beforeinstallprompt` qu'une fois, et seulement s'il
 * juge le site installable : ce bouton n'apparaît donc que lorsqu'il y a
 * vraiment quelque chose à installer, et disparaît sitôt l'application posée.
 * Rien ne s'affiche sur Safari ou dans une application déjà installée — mieux
 * vaut pas de bouton qu'un bouton qui ne fait rien.
 */
import { useEffect, useState } from 'react';
import { isInstalled, onInstallAvailable, promptInstall } from '../lib/pwa.js';

export function InstallApp({ className }: { className?: string }): React.ReactElement | null {
  const [available, setAvailable] = useState(false);

  useEffect(() => onInstallAvailable(setAvailable), []);
  if (!available || isInstalled()) return null;

  return (
    <button
      className={
        className ??
        'text-[color:var(--site-floor-dim)] underline hover:text-[color:var(--site-floor-text)]'
      }
      onClick={() => void promptInstall()}
      title="Poser la table sur votre écran d’accueil, comme une application"
      type="button"
    >
      Installer l’application
    </button>
  );
}

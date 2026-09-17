import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
// L'identité du site (accueil, auth, pages de jetons) : faces auto-hébergées,
// encres, matière papier. Séparée d'index.css, qui appartient à la table.
import './styles/identity.css';
import { Home } from './pages/Home.js';
import { AuthPage } from './pages/Auth.js';
import { DecksPage } from './pages/Decks.js';
import { Tables } from './pages/Tables.js';
import { RoomPage } from './pages/Room.js';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/Tokens.js';
import { LegalFooter } from './components/LegalFooter.js';
import { registerServiceWorker, watchInstallPrompt } from './lib/pwa.js';

function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        {/* Ces trois chemins sont ceux des liens envoyés par email : ils doivent
            rester identiques à ceux de apps/server/src/auth/mail.ts. */}
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/decks" element={<DecksPage />} />
        <Route path="/tables" element={<Tables />} />
        <Route path="/rooms/:code" element={<RoomPage />} />
        <Route
          path="*"
          element={
            /* La 404 porte la même identité que le reste du site : le sol de la
               salle, un panneau de signalétique, et une seule sortie. */
            <div className="site site-floor flex min-h-screen flex-col">
              <main className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col justify-center px-5 py-20 sm:px-8">
                <h1 className="sign text-[clamp(2rem,6vw,3.4rem)] text-[color:var(--site-floor-text)]">
                  Il n’y a pas de table ici
                </h1>
                <p className="mt-4 max-w-[52ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                  L’adresse ne correspond à rien. Si on vous a envoyé un lien de table,
                  vérifiez qu’il est complet — un code de table fait quatre à huit caractères.
                </p>
                {/* Une seule action, et elle se voit : l'aplat d'encre. La marque
                    « Erreur 404 » l'accompagne sur la même ligne plutôt que de lui
                    faire face en boite jumelle. */}
                <div className="mt-7 flex flex-wrap items-center gap-5">
                  <a className="ink-button px-5 py-3 text-[0.82rem]" href="/">
                    Retour à l’accueil
                  </a>
                  <span className="stamped stamped-on-floor">Erreur 404</span>
                </div>
              </main>
              <LegalFooter />
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

// L'application est installable : coquille en cache, invite d'installation
// retenue. Aucune carte n'y est mise en cache — voir `public/sw.js`.
watchInstallPrompt();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

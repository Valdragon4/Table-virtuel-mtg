/**
 * L'enveloppe des pages de formulaire — connexion, inscription, jetons envoyés
 * par email. Elles héritent du monde de l'accueil : le sol sombre de la salle,
 * et une seule plaque de carton posée dessus qui porte le formulaire.
 *
 * Ce ne sont pas des pages de persuasion : on y arrive en sachant ce qu'on vient
 * y faire. La plaque est donc étroite, centrée, et rien ne la concurrence.
 */
import { Link } from 'react-router-dom';
import { AccountBar } from './AccountBar.js';
import { LegalFooter } from './LegalFooter.js';
import { Wordmark } from './Mark.js';

export function PaperShell({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  /** Ce qui se dit sous la plaque, sur le sol : les chemins de traverse. */
  aside?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="site site-floor flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-[78rem] items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link className="inline-block" to="/">
          <Wordmark />
        </Link>
        {/*
          Le sélecteur de langue aussi ici, alors que ces pages n'affichent
          aucun compte.

          C'est précisément là qu'il sert le plus : on arrive sur la connexion
          ou sur un lien de vérification d'email **sans session**, donc sans
          préférence lue, et c'est le premier écran qu'on ait à lire. Le laisser
          hors de ces pages obligerait à revenir à l'accueil pour changer de
          langue, puis à refaire le chemin. `AccountBar` gère déjà le cas : sans
          session, le pseudo disparaît et le sélecteur reste.
        */}
        <AccountBar />
      </header>

      <main className="mx-auto w-full max-w-[26rem] flex-1 px-5 pb-12 pt-4 sm:pt-10">
        <div className="cut-shadow settle">
          <div className="paper paper-cut p-6 sm:p-7">
            <h1 className="sign text-[1.7rem] leading-none text-[color:var(--site-ink)]">
              {title}
            </h1>
            <div className="rule-ink mt-4 pt-6">{children}</div>
          </div>
        </div>

        {aside && (
          <div className="mt-6 text-[0.88rem] leading-relaxed text-[color:var(--site-floor-dim)]">
            {aside}
          </div>
        )}
      </main>

      <LegalFooter />
    </div>
  );
}

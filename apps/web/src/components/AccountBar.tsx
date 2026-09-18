/**
 * Le compte, dans l'en-tête des écrans hors partie : le pseudo, et le choix de
 * la langue juste à côté.
 *
 * **Pourquoi un composant plutôt que trois copies.** L'accueil, « Mes tables »
 * et « Mes decks » ont chacun leur propre `<header>`, et ces trois en-têtes ne
 * se ressemblent pas : leurs liens de navigation diffèrent, l'accueil seul
 * porte l'installation de la PWA et la déconnexion. Les fondre en un en-tête
 * unique appauvrirait les trois. Ce composant ne prend donc que le morceau qui
 * est réellement commun — l'identité et la langue — et laisse chaque en-tête
 * arranger le reste comme il le faisait.
 *
 * **Visible connecté comme déconnecté.** Quelqu'un qui arrive sur l'accueil
 * sans compte a besoin de lire la page dans sa langue autant qu'un inscrit ;
 * seul le pseudo disparaît. Le store sait déjà tenir ce cas : la préférence est
 * gardée en local et rejoint le compte à la connexion (`rehydrate` dans
 * `pages/Auth.tsx`). Il n'y a donc **pas** de langue de session, et pas de
 * second mécanisme d'écriture : c'est le `setLanguage` du `LanguagePicker`,
 * celui-là seul, qui écrit `PATCH /api/me`.
 *
 * **La barre ne règle plus rien elle-même.** Elle n'a jamais eu la place : le
 * sélecteur de langue y tenait en 8,5 rem, et l'option d'édition n'y tenait
 * qu'en carré de 26 px sans libellé, ce qui ne dit pas ce qu'elle fait. Les
 * réglages sont partis dans `AccountModal`, où chacun porte son libellé et son
 * explication ; il ne reste ici que le déclencheur. Le chemin d'écriture, lui,
 * n'a pas changé : c'est toujours le `setLanguage` du store `prefs`, celui-là
 * seul, qui écrit `PATCH /api/me`.
 */
import { useEffect, useState } from 'react';
import { api, type Me } from '../lib/api.js';
import { AccountModal } from './AccountModal.js';
import { useT } from '../lib/i18n/index.js';

export function AccountBar({
  me,
  className,
}: {
  /**
   * Le compte, quand l'écran l'a déjà chargé — l'accueil s'en sert par
   * ailleurs. Laissé de côté, le composant va le chercher lui-même : c'est ce
   * qui évite à « Mes tables » et « Mes decks » d'ajouter un état pour un seul
   * pseudo. `null` veut dire « pas de session », et se distingue de `undefined`,
   * qui veut dire « personne ne me l'a dit ».
   */
  me?: Me | null;
  className?: string;
}): React.ReactElement {
  const t = useT();
  const [fetched, setFetched] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const given = me !== undefined;

  useEffect(() => {
    if (given) return;
    void api
      .get<Me>('/api/me')
      .then(setFetched)
      // Un visiteur prend un 401 : ce n'est pas une panne, il n'a simplement
      // pas de compte. On garde le sélecteur, on n'affiche pas de pseudo.
      .catch(() => setFetched(null));
  }, [given]);

  const account = given ? me : fetched;

  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      {/*
        Un seul déclencheur, explicite, à la place du sélecteur et du bouton
        d'option. Le pseudo **est** le bouton quand il y en a un : c'est le mot
        que l'œil cherche déjà, et il désigne sans ambiguïté ce qu'on ouvre. Sans
        session, le bouton porte le nom de la modale plutôt qu'une icône — rien
        ici ne doit demander une infobulle, qui n'existe pas au doigt.

        La cible reste confortable au doigt (`py-1.5` sur du texte : ~32 px),
        là où l'ancien bouton d'option en faisait 26 de côté.
      */}
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('account.openLabel')}
        className="typed rounded border border-transparent px-2 py-1.5 text-[color:var(--site-floor-dim)] hover:border-edge hover:bg-white/5"
        data-test="open-account-modal"
        onClick={() => setOpen(true)}
        type="button"
      >
        {account ? account.displayName : t('account.title')}
      </button>
      {open && (
        <AccountModal displayName={account?.displayName ?? null} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

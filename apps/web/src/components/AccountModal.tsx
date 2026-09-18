/**
 * La modale du compte : tout ce qui est **personnel** au joueur, au même
 * endroit, avec la place d'être expliqué.
 *
 * **Pourquoi elle existe.** Les réglages d'affichage vivaient dans l'en-tête,
 * dans 8,5 rem de large. Faute de place, l'option « forcer une édition
 * disponible dans ma langue » y était réduite à un carré de 26 px sans libellé :
 * une icône seule ne dit pas ce qu'elle fait, et une infobulle n'existe pas au
 * doigt — or ce produit est une PWA. Sortie de la barre, l'option retrouve son
 * libellé et sa phrase d'explication, celles que `LanguagePicker` sait déjà
 * rendre dans sa variante non compacte.
 *
 * **Pourquoi elle n'est pas un `Dialog`.** `components/Dialog.tsx` est un
 * dialogue de **saisie** : il décrit son contenu par une `DialogSpec` de champs,
 * accumule des valeurs dans son propre état et les rend à l'appelant au clic sur
 * « Valider ». Ici, rien n'est saisi et rien n'est validé : chaque réglage
 * s'applique et s'enregistre au moment où on le change, par `setLanguage` /
 * `setForceLocalizedPrinting` du store `prefs`, et le contenu est fait de
 * composants (le `LanguagePicker`, demain une liste d'amis) que `DialogSpec` ne
 * sait pas porter — son seul emplacement libre, `preview`, est un panneau
 * d'aperçu latéral, pas un corps. On lui emprunte en revanche ce qui compte :
 * l'écoute d'Échap **en capture**, l'habillage `border-edge` / `bg-panel`, la
 * fermeture au clic sur le voile et le corps qui défile en lui-même.
 *
 * **Échap en capture, comme ses voisins.** `Dialog`, `CardMenu`, `TableMenu`,
 * `LookModal` et `ZoneMenu` écoutent tous la touche en phase de capture et
 * arrêtent sa propagation. Un écouteur posé en bouillonnement ne la recevrait
 * jamais dès qu'un autre est monté — et un voile plein écran qui ne se ferme
 * pas avale tous les clics suivants. (`lib/overlay.useCloseOnEscape` écoute en
 * bouillonnement : on ne s'en sert pas ici.)
 */
import { useEffect, useRef, useState } from 'react';
import { api, type Me } from '../lib/api.js';
import { LanguagePicker } from './LanguagePicker.js';
import { useT } from '../lib/i18n/index.js';

/**
 * Une section de la modale : un titre, une phrase qui dit à quoi elle sert, et
 * son contenu.
 *
 * C'est **le** point d'extension. Ajouter « Amis » ou « Tables publiques »
 * revient à écrire une `<Section>` de plus dans le corps ci-dessous, avec ses
 * deux clés de catalogue. Rien n'est prévu d'avance : pas d'onglet grisé, pas de
 * « bientôt disponible ». Une promesse d'interface non tenue vieillit mal, et
 * une section vide n'aide pas plus le contributeur que ce commentaire.
 */
function Section({
  title,
  hint,
  name,
  children,
}: {
  title: string;
  hint?: string;
  /** Sert au `data-test`, pour désigner la section sans dépendre de son titre. */
  name: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="space-y-2" data-test={`account-section-${name}`}>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-xs leading-snug text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function AccountModal({
  onClose,
  displayName,
}: {
  onClose: () => void;
  /**
   * Le pseudo, quand l'écran l'a déjà chargé. Laissé de côté, la modale va le
   * chercher elle-même : c'est ce qui permet de l'ouvrir depuis la table sans y
   * faire descendre un `Me` dont la partie n'a par ailleurs pas besoin. `null`
   * veut dire « pas de session », `undefined` « personne ne me l'a dit ».
   */
  displayName?: string | null;
}): React.ReactElement {
  const t = useT();
  const [fetched, setFetched] = useState<string | null>(null);
  const given = displayName !== undefined;
  const panel = useRef<HTMLDivElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (given) return;
    void api
      .get<Me>('/api/me')
      .then((me) => setFetched(me.displayName))
      // Un visiteur prend un 401 : ce n'est pas une panne, il n'a simplement pas
      // de compte. Les réglages d'affichage lui servent quand même.
      .catch(() => setFetched(null));
  }, [given]);

  const name = given ? (displayName ?? null) : fetched;

  useEffect(() => {
    // Rendre le focus là où il était : la modale s'ouvre depuis un bouton de
    // barre, et le perdre au retour ferait repartir la tabulation du début.
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm sm:p-6"
      data-test="account-modal-backdrop"
      onClick={onClose}
      // Le clic droit ferme aussi : en partie, la modale se pose par-dessus une
      // table où ce geste ouvre partout un menu contextuel.
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={panel}
        aria-labelledby="account-modal-title"
        aria-modal
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl"
        data-test="account-modal"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge/80 bg-slate-900/40 px-5 py-3.5">
          <div className="min-w-0">
            <h2
              className="truncate text-sm font-semibold tracking-tight text-slate-100"
              id="account-modal-title"
            >
              {t('account.title')}
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-400" data-test="account-modal-name">
              {name ?? t('account.guest')}
            </p>
          </div>
          <button
            ref={closeButton}
            aria-label={t('common.close')}
            className="rounded-lg p-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            data-test="account-modal-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Section
            hint={t('account.displayHint')}
            name="display"
            title={t('account.displaySection')}
          >
            {/*
              La variante complète du sélecteur : libellé, phrase d'explication,
              et l'option d'édition rendue en case à cocher étiquetée. C'est
              exactement ce que la barre d'en-tête ne pouvait pas afficher.

              Un seul chemin d'écriture : ce composant appelle `setLanguage` /
              `setForceLocalizedPrinting` du store `prefs`, qui écrivent
              `PATCH /api/me`. La modale n'en ajoute pas un second.
            */}
            <LanguagePicker />
          </Section>

          {/*
            La section suivante — « Amis », « Tables publiques » et leurs options
            de visibilité — s'ajoute ici : une `<Section>` de plus, ses clés dans
            les deux catalogues, et rien d'autre à toucher.
          */}
        </div>
      </div>
    </div>
  );
}

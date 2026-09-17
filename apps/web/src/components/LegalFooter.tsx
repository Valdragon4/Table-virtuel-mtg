/**
 * Mention légale. Elle n'est pas décorative : le projet est un projet de fan non
 * commercial, et cette ligne doit rester visible partout hors de la table.
 *
 * Elle est traitée comme le colophon d'un imprimé — filet d'encre, petites
 * capitales, texte à la mesure lisible — et non comme une note de bas de page
 * qu'on aurait grisée jusqu'à la faire disparaître. Le contraste du corps de
 * texte tient la barre de 4,5:1 sur le sol sombre.
 */
export function LegalFooter(): React.ReactElement {
  return (
    <footer className="mx-auto w-full max-w-[78rem] px-5 py-10 sm:px-8">
      <div className="rule-floor pt-5 [&>*]:max-w-[72ch]">
        <p className="sign-sm mb-3 text-[0.68rem] tracking-[0.14em] text-[color:var(--site-stamp-pale)]">
          Projet de fan · non commercial
        </p>
        <p className="text-[0.82rem] leading-relaxed text-[color:var(--site-floor-dim)]">
          Ce site n'est <strong className="font-semibold text-[color:var(--site-floor-text)]">
            {' '}
            pas affilié à Wizards of the Coast LLC
          </strong>{' '}
          et n'est pas approuvé par elle. Magic: The Gathering, ainsi que les noms, symboles
          et illustrations associés, sont la propriété de Wizards of the Coast. Aucun asset
          officiel n'est hébergé ici : les images de cartes sont chargées par votre
          navigateur, directement depuis Scryfall.
        </p>
      </div>
    </footer>
  );
}

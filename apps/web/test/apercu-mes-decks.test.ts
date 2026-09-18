/**
 * L'aperçu agrandi dans « Mes decks ».
 *
 * La suite tourne en environnement `node`, sans DOM : on ne peut pas survoler
 * une carte et regarder où tombe le panneau — c'est la vérification à l'œil qui
 * le fait. Ce qui se vérifie ici, c'est ce qui se casse **en silence** :
 *
 * - l'aperçu est **réutilisé**, pas recopié. Un second composant qui refait un
 *   panneau d'image dans ces fichiers divergerait dès la première correction du
 *   repli d'illustration ou du repère de langue ;
 * - le survol passe par le chemin « impression » et jamais par `setHovered` :
 *   désigner une carte d'éditeur comme « carte survolée » la donnerait pour
 *   cible aux raccourcis contextuels ;
 * - l'invariant de droits tient : aucun préchargement, aucune copie d'image ;
 * - l'aperçu est monté **dans** le voile des modales, sans quoi son `z-[45]` le
 *   peindrait sous un `z-50` et il resterait invisible ;
 * - ce qui l'allume l'éteint au démontage, sinon il survit à la modale fermée.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  return readFileSync(new URL(`../src/${chemin}`, import.meta.url), 'utf8');
}

const apercu = source('components/CardPreview.tsx');
const editeur = source('components/DeckEditor.tsx');
const page = source('pages/Decks.tsx');

const lieux = [
  ['la page des decks', page],
  ["l'éditeur de deck", editeur],
] as const;

describe('réutilisation', () => {
  it('expose des poignées de survol et une extinction', () => {
    expect(apercu).toContain('export function previewHoverProps');
    expect(apercu).toContain('export function clearCardPreview');
  });

  it("écrit dans le store sans s'y abonner", () => {
    // Un sélecteur zustand sur chaque carte d'une liste re-rendrait la liste
    // entière à chaque survol ; `getState()` ne fait qu'écrire.
    expect(apercu).toContain('useGame.getState().hoverPreview');
  });

  for (const [nom, fichier] of lieux) {
    it(`${nom} monte le composant existant`, () => {
      // Le chemin relatif diffère entre une page et un composant voisin.
      expect(fichier).toMatch(/from '\.\.?\/(components\/)?CardPreview\.js'/);
      expect(fichier).toContain('<CardPreview />');
    });

    it(`${nom} déclenche l'aperçu au survol`, () => {
      expect(fichier).toContain('previewHoverProps(');
    });

    it(`${nom} éteint l'aperçu au démontage`, () => {
      expect(fichier).toContain('clearCardPreview');
    });

    it(`${nom} ne désigne aucune carte comme cible de jeu`, () => {
      expect(fichier).not.toContain('setHovered');
      expect(fichier).not.toContain('hoveredCardId');
    });

    it(`${nom} ne précharge ni ne copie aucune image`, () => {
      expect(fichier).not.toContain('new Image(');
      expect(fichier).not.toMatch(/\blink\b[^\n]*rel=["']preload/);
    });
  }
});

describe('empilement', () => {
  it("l'éditeur monte l'aperçu à l'intérieur de son voile", () => {
    // Le voile porte `z-50` et ouvre son propre contexte d'empilement : un
    // aperçu monté à l'extérieur (`z-[45]`) se peindrait sous le noir.
    const voile = editeur.indexOf('z-50');
    const monté = editeur.indexOf('<CardPreview />');
    expect(voile).toBeGreaterThan(-1);
    expect(monté).toBeGreaterThan(voile);
  });

  it("la page n'en garde qu'un seul à la fois", () => {
    // Deux `data-test="card-preview"` simultanés feraient échouer la recette
    // d'interface, qui les compte.
    expect(page).toContain('{editing === null && <CardPreview />}');
  });
});

describe('miniature de deck', () => {
  it("affiche la carte que le serveur a élue, sans refaire le choix", () => {
    // Le choix vit dans `apps/server/src/decks/thumbnail.ts` et il est testé
    // là-bas. Si la page se met à trier des commandants ou à lire des coûts de
    // mana, les deux règles divergeront en silence.
    expect(page).toContain('deck.thumbnail');
    expect(page).not.toMatch(/\bcmc\b/);
  });

  it("passe par la résolution d'illustration commune", () => {
    // Ni URL Scryfall écrite à la main, ni choix de langue réimplémenté :
    // `resolveCardImage` sait déjà servir l'impression française quand elle
    // existe et l'anglaise sinon.
    expect(page).toContain('resolveCardImage(');
    expect(page).toContain('localizedCard(');
    expect(page).not.toContain('cards.scryfall.io');
  });

  it("demande la plus petite image, jamais la grande", () => {
    // Une page peut aligner vingt decks : `small` fait 146 px de large, `large`
    // en fait 672. Le cadre affiché n'en montre que 80.
    expect(page).toContain("version: 'small'");
    expect(page).not.toContain("version: 'large'");
    expect(page).toContain('loading="lazy"');
  });

  it("ne s'abonne aux résolutions qu'une fois pour toute la page", () => {
    // Un abonnement par miniature ferait vingt fois le même re-rendu, et une
    // demande de localisation par deck au lieu d'un lot unique.
    expect(page.match(/useLocalizationTick\(\)/g) ?? []).toHaveLength(1);
  });

  it('se survole comme les commandants au-dessus', () => {
    // La miniature doit montrer la carte en grand au survol, comme le nom du
    // commandant juste à côté : même aperçu, même chemin.
    expect(page).toMatch(/data-test="deck-thumbnail"[\s\S]{0,200}previewHoverProps\(/);
  });

  it('garde sa place quand il n\'y a pas de carte représentative', () => {
    // Sans cadre vide, la colonne des noms cesse d'être une colonne.
    expect(page).toContain('data-test="deck-thumbnail-empty"');
  });

  it('ne copie ni ne précharge aucune illustration', () => {
    // L'invariant de droits : c'est le navigateur du joueur qui va chercher
    // l'image chez Scryfall. Une vignette mise en cache par nous est une copie.
    expect(page).not.toContain('new Image(');
    expect(page).not.toContain('toDataURL');
    expect(page).not.toMatch(/\bcanvas\b/i);
  });
});

describe('langue', () => {
  it("laisse la résolution localisée décider du nom et de l'illustration", () => {
    // Les trois lieux passent le `scryfallId` du catalogue ; c'est l'aperçu qui
    // résout le nom imprimé et l'image de la langue choisie. Rien ici ne doit
    // court-circuiter `resolveCardImage`.
    expect(apercu).toContain('resolveCardImage(');
    expect(apercu).toContain('localizedCardName(');
  });
});

/*
 * Le nom des commandants, et ce qu'il ne doit pas coûter.
 *
 * Le défaut corrigé : la ligne d'un deck affichait « Selenia, the Cursed
 * Heart » sous une miniature française. Le nom passe désormais par
 * `localizedCardName`, comme partout ailleurs dans le produit.
 *
 * Ce qui se casserait en silence :
 *
 * - une réimplémentation locale du repli (le `printedName` lu à la main), qui
 *   divergerait à la première correction de `localizedCardName` ;
 * - le glossaire des jetons appliqué à un nom propre de carte ;
 * - un `useLocalizationTick()` par ligne, ou une demande hors du lot de la
 *   frame : la page repasserait d'un `POST` à un par deck.
 */
describe('nom de commandant', () => {
  it('rend le nom imprimé par le chemin commun, sans le réimplémenter', () => {
    expect(page).toContain('localizedCardName(localized, commander.name)');
    // Le repli est celui de `localizedCardName` : lire `printedName` ici
    // serait une seconde règle de repli à maintenir.
    expect(page).not.toContain('printedName');
  });

  it("ne passe pas un nom propre par le glossaire des jetons", () => {
    // `tokenNames.ts` traduit des noms de **type** ; « Selenia » n'en est pas un.
    // On vise l'appel et l'import, pas le mot : le commentaire de la page
    // explique justement pourquoi le glossaire ne s'applique pas ici.
    expect(page).not.toMatch(/tokenName\(/);
    expect(page).not.toMatch(/from '[^']*tokenNames/);
  });

  it('garde le nom du catalogue comme clé', () => {
    // Le français est un vernis d'affichage : l'identité de la carte reste
    // `scryfallId`, et le survol comme la clé de liste s'y accrochent.
    expect(page).toContain('key={commander.scryfallId}');
    expect(page).toContain('previewHoverProps(commander.scryfallId)');
  });

  it("dit le même nom que la miniature qu'il accompagne", () => {
    // Un `alt` anglais sous une illustration française désigne la même carte
    // par deux mots différents — et c'est le `alt` que lit une synthèse vocale.
    expect(page).toContain('localizedCardName(localized, card.name)');
    expect(page).toContain('alt={nomAffiché}');
  });

  it("ne s'abonne toujours qu'une fois pour toute la page", () => {
    // La garde qui compte : un abonnement par nom ferait, sur vingt decks,
    // vingt re-rendus de la liste entière à chaque lot rentré.
    expect(page.match(/useLocalizationTick\(\)/g) ?? []).toHaveLength(1);
  });
});

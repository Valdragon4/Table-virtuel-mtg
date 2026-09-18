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

describe('langue', () => {
  it("laisse la résolution localisée décider du nom et de l'illustration", () => {
    // Les trois lieux passent le `scryfallId` du catalogue ; c'est l'aperçu qui
    // résout le nom imprimé et l'image de la langue choisie. Rien ici ne doit
    // court-circuiter `resolveCardImage`.
    expect(apercu).toContain('resolveCardImage(');
    expect(apercu).toContain('localizedCardName(');
  });
});

/**
 * La modale du compte.
 *
 * La suite tourne en environnement `node` et n'inclut que des `.test.ts` : il
 * n'y a ni DOM ni rendu React ici, on ne peut donc pas ouvrir la modale et
 * cliquer dedans — c'est la recette d'interface qui le fait. Ce qui se vérifie
 * ici, c'est ce qui se casse **en silence** et qu'aucun type n'attrape :
 *
 * - les clés de catalogue existent des deux côtés et sont réellement traduites ;
 * - l'écoute d'Échap est posée **en capture**, comme celle de ses voisins : en
 *   bouillonnement, elle ne recevrait jamais la touche dès qu'un menu est
 *   monté, et le voile plein écran avalerait tous les clics suivants ;
 * - le `data-test` de l'option d'édition n'a pas disparu au déménagement ;
 * - les deux points de montage exposent bien le déclencheur, et plus le
 *   sélecteur bridé qu'il remplace ;
 * - la modale n'ouvre pas un second chemin d'écriture vers `PATCH /api/me`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fr } from '../src/lib/i18n/catalog.fr.js';
import { en } from '../src/lib/i18n/catalog.en.js';

function source(chemin: string): string {
  return readFileSync(new URL(`../src/${chemin}`, import.meta.url), 'utf8');
}

const modale = source('components/AccountModal.tsx');
const barre = source('components/AccountBar.tsx');
const picker = source('components/LanguagePicker.tsx');
const room = source('pages/Room.tsx');

describe('catalogues', () => {
  const clés = [
    'account.title',
    'account.openLabel',
    'account.guest',
    'account.displaySection',
    'account.displayHint',
  ] as const;

  it('porte les clés du compte dans les deux langues', () => {
    for (const clé of clés) {
      expect(typeof fr[clé]).toBe('string');
      expect(typeof en[clé]).toBe('string');
      expect(fr[clé]).not.toBe('');
      // Une clé anglaise identique au français est presque toujours un oubli de
      // traduction ; aucune de celles-ci n'est un nom propre.
      expect(en[clé]).not.toBe(fr[clé]);
    }
  });

  it('garde les accents français intacts', () => {
    // Une chaîne écrite par le shell rend « une etape » : le contrôle est ici.
    expect(fr['account.displayHint']).toContain('interface');
    expect(fr['account.displayHint']).toMatch(/[éèêàçùî’]/u);
  });
});

describe('modale', () => {
  it('écoute Échap en phase de capture et retire son écouteur', () => {
    expect(modale).toContain("window.addEventListener('keydown', onKey, true)");
    expect(modale).toContain("window.removeEventListener('keydown', onKey, true)");
    expect(modale).toContain('event.stopPropagation()');
  });

  it('se pose au-dessus des voiles de menus contextuels', () => {
    // Les menus posent `z-40` : en dessous, la modale serait inatteignable.
    expect(modale).toContain('z-50');
  });

  it('rend le sélecteur dans sa variante complète', () => {
    // Ni `hideHint` ni `hideLabel` ni `hidePrintingOption` : c'est tout
    // l'objet du déménagement — chaque option porte son libellé.
    expect(modale).toContain('<LanguagePicker />');
    expect(modale).not.toContain('hideHint');
    expect(modale).not.toContain('hidePrintingOption');
  });

  it("n'ouvre pas un second chemin d'écriture des préférences", () => {
    // Langue et option passent par le store `prefs`, seul à écrire `PATCH /api/me`.
    expect(modale).not.toContain('api.patch');
    expect(modale).not.toContain('api.post');
  });
});

describe('déclencheurs', () => {
  it('remplacent le sélecteur dans les deux contextes', () => {
    for (const fichier of [barre, room]) {
      expect(fichier).toContain('data-test="open-account-modal"');
      expect(fichier).toContain('<AccountModal');
      expect(fichier).not.toContain('<LanguagePicker');
    }
  });

  it('portent un nom lisible, pas une icône seule', () => {
    // Le reproche d'origine : un carré de 26 px dont rien ne disait l'effet.
    expect(barre).toContain("t('account.openLabel')");
    expect(room).toContain("t('account.title')");
  });
});

describe('attributs de recette', () => {
  it("garde le data-test de l'option d'édition sur sa case à cocher", () => {
    expect(picker).toContain('data-test="localized-printing-toggle"');
    // La case à cocher étiquetée est celle que la modale affiche désormais.
    expect(picker).toContain('type="checkbox"');
  });
});

/**
 * Le glossaire des mots-clés : ce qu'il traduit, ce qu'il refuse, et ce qu'il
 * ne doit jamais devenir.
 *
 * Trois garde-fous, dans cet ordre d'importance :
 *
 *  1. le **nom anglais reste la clé** — « Flying » doit répondre autant que
 *     « Vol », partout, sans quoi une liste de deck ou une carte physique
 *     deviendrait introuvable ;
 *  2. rien n'est **inventé** — un terme dont on n'est pas sûr est consigné en
 *     anglais plutôt que deviné, et les deux tables ne se recouvrent pas ;
 *  3. rien ne **décide** — ce fichier ne porte que des noms, jamais un texte de
 *     règles, et il ne descend pas au moteur.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canonKeyword,
  foldKeyword,
  isKnownKeyword,
  keywordLabel,
  keywordName,
  keywordSearchTerms,
  COMMON_KEYWORDS,
  KEYWORD_NAMES_FR,
  MOTS_CLES_EN_ANGLAIS,
} from '../src/lib/i18n/keywordNames.js';
import { foldForSearch } from '../src/components/Dialog.js';

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
}

describe('la traduction des mots-clés', () => {
  it('rend les termes français officiels sur les mécaniques les plus lues', () => {
    expect(keywordName('Flying', 'fr')).toBe('Vol');
    expect(keywordName('Trample', 'fr')).toBe('Piétinement');
    expect(keywordName('Deathtouch', 'fr')).toBe('Contact mortel');
    expect(keywordName('First strike', 'fr')).toBe('Initiative');
    expect(keywordName('Double strike', 'fr')).toBe('Double initiative');
    expect(keywordName('Haste', 'fr')).toBe('Célérité');
  });

  it('laisse l’anglais intact quand la langue est l’anglais', () => {
    expect(keywordName('Flying', 'en')).toBe('Flying');
    expect(keywordName('Cumulative upkeep', 'en')).toBe('Cumulative upkeep');
  });

  it('rend l’anglais tel quel pour un mot-clé absent du glossaire', () => {
    // Un mot-clé d'une extension plus récente que ce fichier : il s'affiche, il
    // ne disparaît pas.
    expect(keywordName('Banding', 'fr')).toBe('Banding');
    expect(keywordName('Squelchproof', 'fr')).toBe('Squelchproof');
  });

  it('ne traduit ni null ni la chaîne vide en quelque chose', () => {
    expect(keywordName(null, 'fr')).toBeNull();
    expect(keywordName(undefined, 'fr')).toBeNull();
    expect(keywordName('', 'fr')).toBe('');
  });
});

describe('ce qu’on a refusé de traduire', () => {
  it('ne consigne jamais en anglais un terme que le glossaire traduit', () => {
    for (const mot of Object.keys(MOTS_CLES_EN_ANGLAIS)) {
      expect(KEYWORD_NAMES_FR[mot]).toBeUndefined();
    }
  });

  it('donne une raison à chaque refus, jamais une case vide', () => {
    for (const [mot, raison] of Object.entries(MOTS_CLES_EN_ANGLAIS)) {
      expect(raison.length, mot).toBeGreaterThan(10);
    }
  });

  it('ne traduit pas deux mots-clés différents par le même français', () => {
    // Deux mécaniques distinctes qui tomberaient sur le même mot rendraient la
    // recherche ambiguë et la pastille mensongère.
    const vus = new Map<string, string>();
    for (const [en, fr] of Object.entries(KEYWORD_NAMES_FR)) {
      expect(vus.get(fr), `${en} et ${vus.get(fr)} partagent « ${fr} »`).toBeUndefined();
      vus.set(fr, en);
    }
  });
});

describe('le nom anglais reste la clé', () => {
  it('canonise le français et l’anglais sur la même forme', () => {
    expect(canonKeyword('Vol')).toBe('flying');
    expect(canonKeyword('vol')).toBe('flying');
    expect(canonKeyword('Flying')).toBe('flying');
    expect(canonKeyword('Piétinement')).toBe('trample');
    expect(canonKeyword('pietinement')).toBe('trample');
    expect(canonKeyword('First strike')).toBe('first-strike');
    expect(canonKeyword('Initiative')).toBe('first-strike');
  });

  it('replie un mot inconnu sur lui-même plutôt que de le perdre', () => {
    expect(canonKeyword('Ward')).toBe('ward');
    expect(canonKeyword('Split second')).toBe('split-second');
  });

  it('rend toujours le terme anglais aux filtres, français compris', () => {
    const termes = keywordSearchTerms(['Flying', 'Trample'], 'fr');
    expect(termes).toContain('Flying');
    expect(termes).toContain('Vol');
    expect(termes).toContain('Trample');
    expect(termes).toContain('Piétinement');
  });

  it('ne double pas le terme quand il n’y a rien à traduire', () => {
    expect(keywordSearchTerms(['Banding'], 'fr')).toEqual(['Banding']);
    expect(keywordSearchTerms(['Flying'], 'en')).toEqual(['Flying']);
  });

  it('ne rend rien pour une carte sans mécanique, ou dont on ne sait rien', () => {
    // Le tableau vide (« aucune mécanique ») et `null` (« jamais ré-ingérée »)
    // se traitent pareil ici : il n'y a rien à chercher.
    expect(keywordSearchTerms([], 'fr')).toEqual([]);
    expect(keywordSearchTerms(null, 'fr')).toEqual([]);
    expect(keywordSearchTerms(undefined, 'fr')).toEqual([]);
  });

  it('se laisse trouver par la normalisation d’accents unique du projet', () => {
    // Taper « pietinement » sans accent doit trouver « Piétinement » : c'est
    // `foldForSearch` qui s'en charge, et il n'en existe qu'une.
    const terme = keywordSearchTerms(['Trample'], 'fr').find((x) => x !== 'Trample');
    expect(foldForSearch(terme ?? '')).toBe('pietinement');
    expect(foldForSearch('Célérité')).toBe('celerite');
  });
});

describe('les libellés et la liste courante', () => {
  it('écrit un canon connu dans la langue demandée', () => {
    expect(keywordLabel('flying', 'fr')).toBe('Vol');
    expect(keywordLabel('flying', 'en')).toBe('Flying');
    expect(keywordLabel('first-strike', 'fr')).toBe('Initiative');
  });

  it('rend un canon inconnu lisible plutôt que brut', () => {
    expect(keywordLabel('quantum-leap', 'fr')).toBe('Quantum leap');
  });

  it('ne propose d’emblée que des mots-clés que le glossaire connaît', () => {
    for (const canon of COMMON_KEYWORDS) {
      expect(isKnownKeyword(canon), canon).toBe(true);
      expect(keywordLabel(canon, 'fr'), canon).not.toBe('');
    }
    expect(new Set(COMMON_KEYWORDS).size).toBe(COMMON_KEYWORDS.length);
  });

  it('tient dans le budget de 32 caractères d’un `kind` de marqueur', () => {
    /*
     * `∑` + le gabarit le plus long + l'espace + `@tous` laissent 20 caractères
     * à la source, préfixe `kw:` compris — soit 17 au mot-clé replié. Le plus
     * long du glossaire doit y tenir, sans quoi il serait inatteignable au
     * décompte.
     */
    for (const en of Object.keys(KEYWORD_NAMES_FR)) {
      expect(`kw:${foldKeyword(en)}`.length, en).toBeLessThanOrEqual(20);
    }
  });
});

describe('la pastille de la vignette, et l’infobulle qu’elle ne double pas', () => {
  const sprite = (): string => source('components/CardSprite.tsx');
  /** Le corps de la pastille seule, sans le panneau ni le reste du fichier. */
  const badge = (): string => {
    const code = sprite();
    return code.slice(code.indexOf('function KeywordBadges('), code.indexOf('function KeywordPanel('));
  };
  /** Le corps du panneau seul. */
  const panneau = (): string => {
    const code = sprite();
    return code.slice(code.indexOf('function KeywordPanel('), code.indexOf('export function CardSprite('));
  };

  it('ne remet pas les mécaniques dans le `title` du navigateur', () => {
    /*
     * C'était le défaut signalé : une boîte jaune en police d'OS, une seconde
     * après que l'aperçu agrandi a montré les mêmes noms proprement. Le `title`
     * de la vignette est redevenu le seul nom de la carte.
     */
    expect(sprite()).toContain("title={known ? shownName : 'Carte face cachée'}");
    expect(sprite()).not.toContain('keywordsTitle');
  });

  it('laisse l’aperçu agrandi porter les noms en toutes lettres', () => {
    // Un seul panneau au survol, et c'est celui qui sait se placer.
    expect(source('components/CardPreview.tsx')).toContain('preview-keywords');
    expect(source('components/CardPreview.tsx')).toContain('keywordName(');
  });

  it('s’ouvre au doigt, sans amorcer le glisser-déposer', () => {
    /*
     * `startCardDrag` est branché sur le `onPointerDown` de la vignette dans
     * `Hand`, `Table` et `ZonePanel` : arrêter la propagation du `pointerdown`
     * est ce qui rend la pastille cliquable sans rendre la carte immobile.
     * C'est le contrat que `CounterBadge` tient déjà.
     */
    expect(badge()).toContain('onPointerDown={(event) => event.stopPropagation()}');
    expect(badge()).toContain('onDoubleClick={(event) => event.stopPropagation()}');
    // Le clic droit n'est **pas** intercepté : il doit continuer d'ouvrir le
    // menu de la carte, comme partout ailleurs.
    expect(badge()).not.toContain('onContextMenu');
  });

  it('ouvre un panneau de lecture, et non un dialogue de saisie', () => {
    /*
     * `Dialog` accumule des champs et ne rend ses valeurs qu'à la validation :
     * le détourner pour de la lecture donnait un formulaire sans formulaire —
     * bouton de validation, « Entrée pour valider », et une modale voilée pour
     * montrer deux mots.
     */
    expect(badge()).not.toContain('openDialog(');
    expect(badge()).toContain('<KeywordPanel');
    // L'option qui masquait le bouton d'annulation n'avait plus d'appelant :
    // elle est partie avec lui, plutôt que de rester « au cas où ».
    expect(source('components/Dialog.tsx')).not.toContain('readOnly?:');
    expect(source('components/Dialog.tsx')).not.toContain('spec.readOnly');
  });

  it('réutilise le placement des menus plutôt que d’en recalculer un', () => {
    // Un panneau ancré à une carte de la rangée basse ne doit pas déborder :
    // `useMenuPlacement` mesure le rendu réel et bascule au-dessus si besoin.
    expect(panneau()).toContain('useMenuPlacement(anchor.x, anchor.y)');
    expect(sprite()).toContain("from '../lib/menu.js'");
  });

  it('écoute `Échap` en capture, et ne pose aucun voile', () => {
    /*
     * Un écouteur en bouillonnement ne recevrait jamais la touche. Et aucun
     * calque plein écran : c'est ce qui avalait tous les clics dans le défaut
     * déjà corrigé sur un menu de ce projet.
     */
    expect(panneau()).toContain("window.addEventListener('keydown', onKey, true)");
    expect(panneau()).toContain("window.addEventListener('pointerdown', onDown, true)");
    expect(panneau()).not.toContain('fixed inset-0');
  });

  it('ne met dans le panneau que des noms, jamais une règle ni un avertissement', () => {
    expect(badge()).toContain('keywordName(kw, language)');
    // Une pastille par mécanique, et pas une phrase qui les noie.
    expect(panneau()).toContain('names.map(');
    expect(panneau()).not.toContain('Affichage seulement');
  });
});

describe('ce que ce glossaire ne doit jamais devenir', () => {
  it('ne porte que des noms : aucun texte de règles', () => {
    const code = source('lib/i18n/keywordNames.ts');
    for (const fr of Object.values(KEYWORD_NAMES_FR)) {
      // Un texte de règles fait une phrase ; un nom de mécanique fait au plus
      // trois mots (« Traversée des montagnes »).
      expect(fr.split(/\s+/).length, fr).toBeLessThanOrEqual(3);
      expect(fr, fr).not.toContain('.');
    }
    // Et rien de tout cela ne part au serveur : le fichier n'importe que le
    // type de langue partagé.
    expect(code).not.toContain("from '../api.js'");
    expect(code).not.toContain('fetch(');
  });
});

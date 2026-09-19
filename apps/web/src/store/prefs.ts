/**
 * Les préférences d'affichage du compte, côté client. Aujourd'hui : la langue.
 *
 * **Pourquoi un store à part de `game.ts`.** La langue n'est pas un état de
 * partie : elle survit à la table, vaut sur l'accueil, l'éditeur de deck et les
 * paramètres, et ne doit surtout pas être rejouée par le protocole. Deux
 * joueurs à la même table peuvent lire la même partie dans deux langues sans
 * que rien de l'état partagé ne change — c'est même la preuve que la langue est
 * au bon endroit.
 *
 * **Un seul chemin d'écriture.** La demande est explicite : changer la langue
 * *pendant une partie* modifie la préférence du compte. Il n'y a donc qu'une
 * fonction qui écrit, `setLanguage`, et un seul appel serveur derrière elle,
 * `persistLanguage`. Le sélecteur des paramètres et celui de la table appellent
 * la même chose ; il n'existe pas de « langue de session ».
 *
 * **Piège zustand, déjà payé ici.** Un sélecteur qui *construit* une valeur —
 * un tableau, un objet littéral — n'est jamais égal à lui-même d'un rendu à
 * l'autre : React boucle, lève le #185, et la page meurt avant d'ouvrir son
 * socket. Tout ce que ce fichier expose se sélectionne donc en **scalaire**
 * (`s.language`, `s.saving`). Si vous avez besoin de plusieurs champs à la
 * fois, prenez-les en plusieurs appels, ou dérivez dans un `useMemo`.
 */
import { create } from 'zustand';
import { DEFAULT_LANGUAGE, asLanguage, type Language } from '@mtg/shared';
import { api } from '../lib/api.js';

/**
 * Miroir local de la préférence du compte.
 *
 * Il n'existe que pour le tout premier rendu : sans lui, la page s'affiche en
 * français le temps que `/api/me` réponde, puis bascule sous les yeux du
 * joueur. Ce n'est pas une source de vérité — le compte l'est — et une valeur
 * illisible retombe silencieusement sur le défaut.
 */
const STORAGE_KEY = 'mtg.language';
/**
 * Miroir local de l'option « forcer une édition disponible dans ma langue ».
 *
 * Même rôle et mêmes limites que celui de la langue : il n'existe que pour le
 * premier rendu, ce n'est pas la source de vérité, et un stockage bloqué n'est
 * pas une panne. Une valeur illisible retombe sur `false`, c'est-à-dire sur le
 * comportement par défaut — l'illustration reste celle que le joueur a choisie.
 */
const SUBSTITUTE_KEY = 'mtg.forceLocalizedPrinting';
/** Même rôle, mêmes limites : un miroir pour le premier rendu, pas la vérité. */
const KEYWORD_BADGES_KEY = 'mtg.showKeywordBadges';

function readStoredSubstitute(): boolean {
  try {
    return window.localStorage.getItem(SUBSTITUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredSubstitute(value: boolean): void {
  try {
    window.localStorage.setItem(SUBSTITUTE_KEY, value ? '1' : '0');
  } catch {
    /* idem */
  }
}

/*
 * Le miroir de l'affichage des pastilles. Une valeur illisible retombe sur `false`,
 * c'est-à-dire sur la pastille **absente**, qui est le défaut du produit.
 */
function readStoredShowKeywordBadges(): boolean {
  try {
    return window.localStorage.getItem(KEYWORD_BADGES_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredShowKeywordBadges(value: boolean): void {
  try {
    window.localStorage.setItem(KEYWORD_BADGES_KEY, value ? '1' : '0');
  } catch {
    /* idem */
  }
}

function readStoredLanguage(): Language | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? asLanguage(raw) : null;
  } catch {
    // Navigation privée, stockage bloqué : ce n'est pas une panne.
    return null;
  }
}

function writeStoredLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* idem */
  }
}

/**
 * La langue du premier rendu, avant toute réponse du serveur.
 *
 * On ne regarde `navigator.language` que si l'on n'a **rien** en mémoire :
 * quelqu'un dont le compte dit « français » sur un navigateur anglais ne doit
 * pas voir sa table clignoter à chaque chargement.
 */
function initialLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  const stored = readStoredLanguage();
  if (stored) return stored;
  return asLanguage(window.navigator?.language, DEFAULT_LANGUAGE);
}

/**
 * **Le seul appel réseau de la langue.**
 *
 * `language` a rejoint `uiScale`, `autoUntapStep` et `cardBackUrl` dans le
 * schéma de `PATCH /api/me` (apps/server/src/users/routes.ts) : on emprunte la
 * route de préférences existante plutôt que d'en ouvrir une pour un champ.
 * Aucune garde ne l'interdit pendant une partie — c'est justement ce qui fait
 * qu'un changement depuis la table modifie le compte, sans second mécanisme. Si
 * l'appel échoue, l'erreur remonte telle quelle et l'appelant décide : ici, on
 * garde l'affichage dans la langue choisie et on le signale.
 */
export async function persistLanguage(language: Language): Promise<void> {
  await api.patch<{ ok: boolean }>('/api/me', { language });
}

/**
 * **Le seul appel réseau de l'option d'édition**, et c'est la même route.
 *
 * `forceLocalizedPrinting` a rejoint `language` dans `prefsSchema` : c'est un
 * réglage d'affichage du compte, de la même nature, donc le même unique point
 * d'écriture. Rien de ce qui part ici ne touche le protocole de jeu — le
 * `scryfallId` d'une carte ne dépend à aucun moment de cette case.
 */
export async function persistForceLocalizedPrinting(value: boolean): Promise<void> {
  await api.patch<{ ok: boolean }>('/api/me', { forceLocalizedPrinting: value });
}

/** Même route encore : un réglage d'affichage du compte n'a qu'un point d'écriture. */
export async function persistShowKeywordBadges(value: boolean): Promise<void> {
  await api.patch<{ ok: boolean }>('/api/me', { showKeywordBadges: value });
}

/**
 * Ce qu'on lit de `GET /api/me`.
 *
 * `language` est **à la racine** de la réponse, pas dans `prefs` : le serveur
 * l'y met toujours, défaut compris, alors que `prefs` est absent pour un compte
 * qui n'a jamais rien réglé. Lire `prefs.language` marcherait les neuf
 * premières fois et raterait la dixième — celle du compte tout neuf.
 */
interface MeLanguage {
  language?: string | null;
  /** À la racine lui aussi, et pour la même raison. */
  forceLocalizedPrinting?: boolean | null;
  /** Idem. */
  showKeywordBadges?: boolean | null;
}

interface PrefsState {
  language: Language;
  /**
   * Afficher l'illustration d'une **autre** impression quand celle que le
   * joueur a choisie n'existe pas dans sa langue.
   *
   * Purement local à celui qui regarde : rien de ce qui part au serveur, rien
   * de ce qu'un deck enregistre, rien de ce que voient les autres joueurs n'en
   * dépend. Le sélecteur d'impression continue d'annoncer l'impression
   * réellement choisie ; c'est le repère porté par la carte qui signale la
   * divergence.
   */
  forceLocalizedPrinting: boolean;
  /**
   * Afficher la pastille de mécaniques sur les vignettes.
   *
   * Refusé par défaut : la pastille est un repère de plus sur une table déjà
   * chargée. Purement local à celui qui regarde, comme l'option d'impression,
   * et sans perte d'information — le panneau de lecture reste atteignable par
   * le menu, et les autres joueurs gardent leur propre réglage.
   */
  showKeywordBadges: boolean;
  /** Vrai une fois `/api/me` lu : avant, `language` n'est qu'une estimation locale. */
  hydrated: boolean;
  /** Un enregistrement est en vol. Sert à désactiver le sélecteur, rien de plus. */
  saving: boolean;
  /** Dernier échec d'enregistrement, ou `null`. L'affichage, lui, a déjà changé. */
  error: string | null;
  /** Lit la préférence du compte. Sans effet si elle a déjà été lue. */
  hydrate: () => Promise<void>;
  /**
   * Relit la préférence du compte, même si elle l'a déjà été.
   *
   * Il en faut un chemin explicite parce que l'écran d'authentification
   * **navigue sans recharger la page** : après une connexion, `hydrated` est
   * déjà vrai et `hydrate()` ne ferait rien, si bien qu'on afficherait la
   * langue du visiteur plutôt que celle du compte jusqu'au chargement suivant.
   */
  rehydrate: () => Promise<void>;
  /** **Le** chemin d'écriture : paramètres du compte comme interface en partie. */
  setLanguage: (language: Language) => Promise<void>;
  /** Même forme, même route, même optimisme que `setLanguage`. */
  setForceLocalizedPrinting: (value: boolean) => Promise<void>;
  /** Même forme, même route, même optimisme. */
  setShowKeywordBadges: (value: boolean) => Promise<void>;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  language: initialLanguage(),
  forceLocalizedPrinting: typeof window === 'undefined' ? false : readStoredSubstitute(),
  showKeywordBadges: typeof window === 'undefined' ? false : readStoredShowKeywordBadges(),
  hydrated: false,
  saving: false,
  error: null,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const me = await api.get<MeLanguage>('/api/me');
      const language = asLanguage(me.language, get().language);
      // Le serveur pose toujours le champ à la racine ; un serveur plus ancien
      // ne le pose pas, et l'on garde alors ce que le miroir local disait.
      const forceLocalizedPrinting = me.forceLocalizedPrinting ?? get().forceLocalizedPrinting;
      const showKeywordBadges = me.showKeywordBadges ?? get().showKeywordBadges;
      writeStoredLanguage(language);
      writeStoredSubstitute(forceLocalizedPrinting);
      writeStoredShowKeywordBadges(showKeywordBadges);
      set({ language, forceLocalizedPrinting, showKeywordBadges, hydrated: true, error: null });
    } catch {
      // Visiteur non connecté, ou serveur muet : on reste sur l'estimation
      // locale. Marquer `hydrated` évite de rejouer l'appel à chaque écran.
      set({ hydrated: true });
    }
  },

  rehydrate: async () => {
    set({ hydrated: false });
    await get().hydrate();
  },

  setLanguage: async (language) => {
    if (language === get().language && !get().error) return;

    /*
     * Changement optimiste : l'interface bascule tout de suite. Un aller-retour
     * réseau avant de changer de langue se sentirait, et l'échec n'a pas de
     * conséquence grave — la préférence du compte reste sur l'ancienne valeur,
     * qui reviendra au prochain chargement, et on le dit.
     */
    set({ language, saving: true, error: null });
    writeStoredLanguage(language);

    try {
      await persistLanguage(language);
      set({ saving: false, hydrated: true });
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'SAVE_FAILED' });
    }
  },

  setForceLocalizedPrinting: async (value) => {
    if (value === get().forceLocalizedPrinting && !get().error) return;

    // Même optimisme que la langue, et pour la même raison : l'effet est
    // visible immédiatement sur les cartes affichées, et un aller-retour
    // réseau avant de basculer se sentirait. Un échec laisse l'affichage sur
    // le choix du joueur et le dit, plutôt que de revenir sous ses yeux.
    set({ forceLocalizedPrinting: value, saving: true, error: null });
    writeStoredSubstitute(value);

    try {
      await persistForceLocalizedPrinting(value);
      set({ saving: false, hydrated: true });
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'SAVE_FAILED' });
    }
  },

  setShowKeywordBadges: async (value) => {
    if (value === get().showKeywordBadges && !get().error) return;

    // Même optimisme que ses deux voisines : l'effet est immédiat à l'écran,
    // et un échec laisse l'affichage sur le choix du joueur plutôt que de
    // revenir sous ses yeux.
    set({ showKeywordBadges: value, saving: true, error: null });
    writeStoredShowKeywordBadges(value);

    try {
      await persistShowKeywordBadges(value);
      set({ saving: false, hydrated: true });
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'SAVE_FAILED' });
    }
  },
}));

/*
 * Sélecteurs scalaires. Chacun rend une valeur primitive, comparable par
 * `Object.is` — c'est ce qui les rend sûrs. N'ajoutez jamais ici un sélecteur
 * qui renvoie `{ language, saving }` ou `[a, b]`.
 */
export const useLanguage = (): Language => usePrefs((s) => s.language);
export const useLanguageSaving = (): boolean => usePrefs((s) => s.saving);
export const useLanguageError = (): string | null => usePrefs((s) => s.error);
export const useSetLanguage = (): ((language: Language) => Promise<void>) =>
  usePrefs((s) => s.setLanguage);
/** Booléen : scalaire, donc comparable par `Object.is`. Même règle que ci-dessus. */
export const useForceLocalizedPrinting = (): boolean => usePrefs((s) => s.forceLocalizedPrinting);
export const useSetForceLocalizedPrinting = (): ((value: boolean) => Promise<void>) =>
  usePrefs((s) => s.setForceLocalizedPrinting);
/** Booléen, donc scalaire : même règle que ci-dessus. */
export const useShowKeywordBadges = (): boolean => usePrefs((s) => s.showKeywordBadges);
export const useSetShowKeywordBadges = (): ((value: boolean) => Promise<void>) =>
  usePrefs((s) => s.setShowKeywordBadges);

/** La langue hors React : journal, titres de document, appels à l'API des cartes. */
export const currentLanguage = (): Language => usePrefs.getState().language;

/**
 * Le store de préférences.
 *
 * Ce qu'on vérifie n'est pas « zustand fonctionne » mais le point de la
 * demande : il n'existe **qu'un seul** chemin d'écriture, et changer la langue
 * depuis la table écrit la préférence du compte exactement comme depuis les
 * paramètres. On vérifie aussi qu'un échec réseau ne fige pas l'interface dans
 * la langue précédente — le joueur a cliqué, il doit voir sa langue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `window` n'existe pas en environnement node : le store le tolère, on le simule. */
const store = new Map<string, string>();
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
  navigator: { language: 'en-US' },
});

const patch = vi.fn<[string, unknown], Promise<unknown>>(async () => ({ ok: true }));
// `GET /api/me` rend `language` **à la racine**, toujours, défaut compris :
// `prefs` peut manquer pour un compte qui n'a jamais rien réglé.
const get = vi.fn<[string], Promise<unknown>>(async () => ({ language: 'en', prefs: null }));
vi.mock('../src/lib/api.js', () => ({
  api: {
    get: (path: string) => get(path),
    patch: (path: string, body: unknown) => patch(path, body),
  },
}));

const { usePrefs, persistLanguage } = await import('../src/store/prefs.js');

const initial = usePrefs.getState();

beforeEach(() => {
  store.clear();
  patch.mockClear();
  get.mockClear();
  usePrefs.setState({
    ...initial,
    language: 'fr',
    forceLocalizedPrinting: false,
    hydrated: false,
    saving: false,
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('un seul chemin d’écriture', () => {
  it('écrit la préférence du compte par la route PATCH existante', async () => {
    await usePrefs.getState().setLanguage('en');
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/me', { language: 'en' });
    expect(usePrefs.getState().language).toBe('en');
  });

  it('passe par la même fonction, qu’on vienne de la table ou des paramètres', async () => {
    // Il n'y a pas de « langue de session » : `persistLanguage` est le seul
    // appel réseau, et `setLanguage` le seul appelant.
    await persistLanguage('en');
    expect(patch).toHaveBeenCalledWith('/api/me', { language: 'en' });
  });

  it('ne réécrit rien si la langue ne change pas', async () => {
    await usePrefs.getState().setLanguage('fr');
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('lecture au démarrage', () => {
  it('prend la langue du compte', async () => {
    await usePrefs.getState().hydrate();
    expect(get).toHaveBeenCalledWith('/api/me');
    expect(usePrefs.getState().language).toBe('en');
    expect(usePrefs.getState().hydrated).toBe(true);
  });

  it('ne relit pas deux fois', async () => {
    await usePrefs.getState().hydrate();
    await usePrefs.getState().hydrate();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('garde l’estimation locale si le compte ne répond pas', async () => {
    get.mockRejectedValueOnce(new Error('AUTH_REQUIRED'));
    await usePrefs.getState().hydrate();
    // Un visiteur sans compte n'est pas une erreur : il garde le français.
    expect(usePrefs.getState().language).toBe('fr');
    expect(usePrefs.getState().hydrated).toBe(true);
  });

  it('ignore une préférence illisible', async () => {
    get.mockResolvedValueOnce({ language: 'klingon' });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState().language).toBe('fr');
  });

  it('lit la racine, pas `prefs`', async () => {
    // Le piège serait de lire `prefs.language` : il marche pour un compte déjà
    // réglé et rate exactement celui qui n'a jamais rien choisi, chez qui
    // `prefs` est absent. On met les deux en désaccord pour lever le doute.
    get.mockResolvedValueOnce({ language: 'en', prefs: { language: 'fr' } });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState().language).toBe('en');
  });

  it('accepte un compte sans `prefs` du tout', async () => {
    get.mockResolvedValueOnce({ language: 'en' });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState().language).toBe('en');
  });
});

describe('échec d’enregistrement', () => {
  it('garde la langue choisie à l’écran et signale l’échec', async () => {
    patch.mockRejectedValueOnce(new Error('Réseau indisponible'));
    await usePrefs.getState().setLanguage('en');
    expect(usePrefs.getState().language).toBe('en');
    expect(usePrefs.getState().saving).toBe(false);
    expect(usePrefs.getState().error).toBe('Réseau indisponible');
  });
});

describe('miroir local', () => {
  it('retient la langue pour éviter le clignotement au chargement suivant', async () => {
    await usePrefs.getState().setLanguage('en');
    expect(store.get('mtg.language')).toBe('en');
  });
});

/**
 * L'option « forcer une édition disponible dans ma langue ».
 *
 * Elle est de la même nature que la langue — un réglage d'affichage du compte —
 * donc elle doit suivre le même chemin : une seule fonction qui écrit, une
 * seule route, et rien qui passe par le protocole de jeu.
 */
describe('l’édition de substitution', () => {
  it('emprunte la même route de préférences que la langue', async () => {
    await usePrefs.getState().setForceLocalizedPrinting(true);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/me', { forceLocalizedPrinting: true });
    expect(usePrefs.getState().forceLocalizedPrinting).toBe(true);
  });

  it('ne réécrit rien si le réglage ne change pas', async () => {
    await usePrefs.getState().setForceLocalizedPrinting(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('lit la racine de /api/me, pas `prefs`', async () => {
    // Même piège que pour la langue : `prefs` est absent d'un compte neuf.
    get.mockResolvedValueOnce({
      language: 'fr',
      forceLocalizedPrinting: true,
      prefs: { forceLocalizedPrinting: false },
    });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState().forceLocalizedPrinting).toBe(true);
  });

  it('vaut faux pour un compte qui n’a jamais rien réglé', async () => {
    get.mockResolvedValueOnce({ language: 'fr', forceLocalizedPrinting: false, prefs: null });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState().forceLocalizedPrinting).toBe(false);
  });

  it('garde le choix à l’écran quand l’enregistrement échoue', async () => {
    patch.mockRejectedValueOnce(new Error('Réseau indisponible'));
    await usePrefs.getState().setForceLocalizedPrinting(true);
    expect(usePrefs.getState().forceLocalizedPrinting).toBe(true);
    expect(usePrefs.getState().error).toBe('Réseau indisponible');
  });

  it('se retient localement, pour le premier rendu du chargement suivant', async () => {
    await usePrefs.getState().setForceLocalizedPrinting(true);
    expect(store.get('mtg.forceLocalizedPrinting')).toBe('1');
  });
});

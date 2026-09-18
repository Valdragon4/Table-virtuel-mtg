import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { PaperShell } from '../components/PaperShell.js';
import { usePrefs } from '../store/prefs.js';
import { useT } from '../lib/i18n/index.js';

/**
 * Destination de retour après connexion.
 *
 * Seul un chemin interne est accepté : un `next` absolu ou protocole-relatif
 * ferait de cette page un tremplin de redirection ouverte.
 */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await api.post('/api/auth/register', { email, password, displayName });
        setNotice(t('auth.registered'));
      } else {
        await api.post('/api/auth/login', { email, password });
        /*
         * Relire la langue du compte, **maintenant**.
         *
         * `hydrate()` a déjà été joué au démarrage (`main.tsx`), alors qu'il n'y
         * avait pas de session : il a échoué sans bruit et posé `hydrated`, ce
         * qui est exactement son rôle — ne pas rejouer l'appel à chaque écran.
         * Mais cette page **navigue sans recharger la page** : sans ce rejeu,
         * quelqu'un qui se connecte depuis un navigateur neuf verrait l'interface
         * dans l'estimation locale (`localStorage`, puis `navigator.language`)
         * jusqu'au prochain chargement complet.
         *
         * L'appel n'est pas attendu : il avale ses échecs et n'a aucune raison
         * de retarder la navigation.
         */
        void usePrefs.getState().rehydrate();
        // On revient à l'accueil, pas dans la gestion des decks : on se connecte
        // pour jouer, et c'est de l'accueil qu'on crée ou rejoint une table.
        navigate(next ?? '/');
      }
    } catch (err) {
      // Message et indication d'`ApiError` viennent du serveur, déjà rédigés :
      // ils s'affichent tels quels. Seul le repli est un libellé à nous.
      setError(
        err instanceof ApiError
          ? { message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
          : { message: t('auth.failed') },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PaperShell
      aside={
        mode === 'login' ? (
          <>
            <Link className="floor-link" to="/forgot-password">
              {t('auth.forgotPassword')}
            </Link>
            {t('auth.asideNoAccount')}{' '}
            <Link className="floor-link" to={withNext('/register', next)}>
              {t('auth.createOne')}
            </Link>
            {t('auth.asideRemind')}{' '}
            <Link className="floor-link" to={next ?? '/'}>
              {t('auth.sitWithout')}
            </Link>
            .
          </>
        ) : (
          <>
            {t('auth.alreadyRegistered')}{' '}
            <Link className="floor-link" to={withNext('/login', next)}>
              {t('auth.login')}
            </Link>
            {t('auth.asideAccountKeeps')}
          </>
        )
      }
      title={mode === 'login' ? t('auth.login') : t('auth.createAccount')}
    >
      <form className="space-y-5" onSubmit={(e) => void submit(e)}>
        {mode === 'register' && (
          <label className="block">
            <span className="paper-label">{t('auth.displayName')}</span>
            <input
              className="paper-field"
              maxLength={32}
              minLength={2}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              value={displayName}
            />
          </label>
        )}

        <label className="block">
          <span className="paper-label">{t('auth.email')}</span>
          <input
            autoComplete="email"
            className="paper-field"
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label className="block">
          <span className="paper-label">{t('auth.password')}</span>
          <input
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            className="paper-field"
            minLength={mode === 'register' ? 10 : 1}
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
            value={password}
          />
          {mode === 'register' && (
            <span className="paper-dim mt-1.5 block text-[0.78rem]">{t('auth.passwordRule')}</span>
          )}
        </label>

        <button className="ink-button w-full px-5 py-3 text-[0.84rem]" disabled={busy} type="submit">
          {busy ? t('common.sending') : mode === 'login' ? t('auth.login') : t('auth.createAccountSubmit')}
        </button>
      </form>

      {error && (
        <div
          className="mt-5 border-2 border-[color:var(--site-alarm)] px-3.5 py-2.5 text-[0.85rem] leading-relaxed"
          role="alert"
        >
          <p className="text-[color:var(--site-alarm)]">{error.message}</p>
          {/* Une erreur nomme le problème et la sortie. Quand le serveur ne donne
              pas d'indication, on écrit celle qui vaut pour ce formulaire. */}
          <p className="paper-dim mt-1">
            {error.hint ?? t('auth.errorHint')}
          </p>
        </div>
      )}

      {notice && (
        <p className="mt-5 border-2 border-[color:var(--site-stamp)] px-3.5 py-2.5 text-[0.85rem] leading-relaxed text-[color:var(--site-stamp-deep)]">
          {notice}
          {/* L'inscription n'ouvre pas de session : on offre le chemin du retour. */}
          {next && (
            <>
              {' '}
              <Link className="ink-link" to={withNext('/login', next)}>
                {t('auth.login')}
              </Link>{' '}
              {t('common.or')}{' '}
              <Link className="ink-link" to={next}>
                {t('auth.backToTableAsGuest')}
              </Link>
              .
            </>
          )}
        </p>
      )}
    </PaperShell>
  );
}

/** Conserve la destination de retour en passant d'une page d'auth à l'autre. */
function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

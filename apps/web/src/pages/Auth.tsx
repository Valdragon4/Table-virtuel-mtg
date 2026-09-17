import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { PaperShell } from '../components/PaperShell.js';

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
        setNotice(
          'Compte créé. Un email de confirmation vient de partir — en développement, il est écrit dans les logs du serveur.',
        );
      } else {
        await api.post('/api/auth/login', { email, password });
        // On revient à l'accueil, pas dans la gestion des decks : on se connecte
        // pour jouer, et c'est de l'accueil qu'on crée ou rejoint une table.
        navigate(next ?? '/');
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
          : { message: 'Échec.' },
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
              Mot de passe oublié
            </Link>
            . Pas de compte ?{' '}
            <Link className="floor-link" to={withNext('/register', next)}>
              En créer un
            </Link>
            . Et rappel utile : le compte ne sert pas à jouer, vous pouvez{' '}
            <Link className="floor-link" to={next ?? '/'}>
              vous asseoir sans
            </Link>
            .
          </>
        ) : (
          <>
            Déjà inscrit ?{' '}
            <Link className="floor-link" to={withNext('/login', next)}>
              Se connecter
            </Link>
            . Le compte garde vos decks, vos playmats et vos réglages — il n’est jamais exigé
            pour rejoindre une table.
          </>
        )
      }
      title={mode === 'login' ? 'Se connecter' : 'Créer un compte'}
    >
      <form className="space-y-5" onSubmit={(e) => void submit(e)}>
        {mode === 'register' && (
          <label className="block">
            <span className="paper-label">Pseudo affiché à table</span>
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
          <span className="paper-label">Email</span>
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
          <span className="paper-label">Mot de passe</span>
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
            <span className="paper-dim mt-1.5 block text-[0.78rem]">Au moins 10 caractères.</span>
          )}
        </label>

        <button className="ink-button w-full px-5 py-3 text-[0.84rem]" disabled={busy} type="submit">
          {busy ? 'Envoi…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
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
            {error.hint ?? 'Corrigez le champ concerné, puis renvoyez le formulaire.'}
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
                Se connecter
              </Link>{' '}
              ou{' '}
              <Link className="ink-link" to={next}>
                retourner à la table en invité
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

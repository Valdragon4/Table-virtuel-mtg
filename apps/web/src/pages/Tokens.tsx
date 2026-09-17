/**
 * Pages atteintes depuis les liens des emails transactionnels.
 *
 * Les URLs sont fixées par `apps/server/src/auth/mail.ts` : toute modification
 * de l'une doit se faire des deux côtés.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { PaperShell } from '../components/PaperShell.js';

/** Un fait porté par la plaque : confirmé, refusé, en cours. */
function Outcome({
  tone,
  children,
}: {
  tone: 'ok' | 'bad' | 'wait';
  children: React.ReactNode;
}): React.ReactElement {
  const border = tone === 'bad' ? 'var(--site-alarm)' : tone === 'ok' ? 'var(--site-stamp)' : 'var(--site-paper-edge)';
  const color =
    tone === 'bad' ? 'var(--site-alarm)' : tone === 'ok' ? 'var(--site-stamp-deep)' : 'var(--site-ink-soft)';
  return (
    <p
      className="border-2 px-3.5 py-2.5 text-[0.9rem] leading-relaxed"
      style={{ borderColor: border, color }}
    >
      {children}
    </p>
  );
}

export function VerifyEmailPage(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Lien incomplet : le jeton est absent.');
      return;
    }
    void api
      .post('/api/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err: unknown) => {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Vérification impossible.');
      });
  }, [token]);

  return (
    <PaperShell
      aside={
        <Link className="floor-link" to="/">
          Retour à l’accueil
        </Link>
      }
      title="Confirmation de l’adresse email"
    >
      {state === 'pending' && <Outcome tone="wait">Vérification en cours…</Outcome>}
      {state === 'ok' && (
        <>
          <Outcome tone="ok">Adresse confirmée. Votre compte est actif.</Outcome>
          <p className="mt-5">
            <Link className="ink-link" to="/login">
              Se connecter
            </Link>
          </p>
        </>
      )}
      {state === 'error' && (
        <>
          <Outcome tone="bad">{message}</Outcome>
          <p className="paper-dim mt-4 text-[0.84rem] leading-relaxed">
            Les liens expirent au bout de 24 heures et ne servent qu’une fois. Connectez-vous
            puis demandez un nouvel envoi.
          </p>
        </>
      )}
    </PaperShell>
  );
}

export function ResetPasswordPage(): React.ReactElement {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset', { token, password });
      setDone(true);
      window.setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PaperShell
      aside={
        <Link className="floor-link" to="/">
          Retour à l’accueil
        </Link>
      }
      title="Nouveau mot de passe"
    >
      {done ? (
        <Outcome tone="ok">
          Mot de passe changé. Toutes vos sessions ont été fermées ; redirection vers la
          connexion…
        </Outcome>
      ) : (
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="paper-label">Mot de passe</span>
            <input
              autoComplete="new-password"
              autoFocus
              className="paper-field"
              minLength={10}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            <span className="paper-dim mt-1.5 block text-[0.78rem]">Au moins 10 caractères.</span>
          </label>
          <button
            className="ink-button w-full px-5 py-3 text-[0.84rem]"
            disabled={busy || !token}
            type="submit"
          >
            {busy ? 'Envoi…' : 'Changer le mot de passe'}
          </button>
          {!token && <Outcome tone="bad">Lien incomplet : le jeton est absent.</Outcome>}
          {error && <Outcome tone="bad">{error}</Outcome>}
        </form>
      )}
    </PaperShell>
  );
}

/** Demande de réinitialisation. La réponse est toujours la même, compte ou pas. */
export function ForgotPasswordPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <PaperShell
      aside={
        <Link className="floor-link" to="/">
          Retour à l’accueil
        </Link>
      }
      title="Mot de passe oublié"
    >
      {sent ? (
        <Outcome tone="ok">
          Si un compte existe pour cette adresse, un lien de réinitialisation vient d’y être
          envoyé. Il expire dans une heure.
        </Outcome>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void api.post('/api/auth/forgot', { email }).finally(() => setSent(true));
          }}
        >
          <label className="block">
            <span className="paper-label">Email</span>
            <input
              autoFocus
              className="paper-field"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <button className="ink-button w-full px-5 py-3 text-[0.84rem]" type="submit">
            Envoyer le lien
          </button>
        </form>
      )}
    </PaperShell>
  );
}

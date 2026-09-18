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
import { useT } from '../lib/i18n/index.js';

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
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage(t('token.missingToken'));
      return;
    }
    void api
      .post('/api/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err: unknown) => {
        setState('error');
        // Le message d'`ApiError` vient du serveur : il s'affiche tel quel.
        setMessage(err instanceof ApiError ? err.message : t('token.verifyFailed'));
      });
    // `t` n'est pas en dépendance : la vérification ne se rejoue pas parce que
    // la langue a changé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <PaperShell
      aside={
        <Link className="floor-link" to="/">
          {t('nav.backHome')}
        </Link>
      }
      title={t('token.verifyTitle')}
    >
      {state === 'pending' && <Outcome tone="wait">{t('token.verifying')}</Outcome>}
      {state === 'ok' && (
        <>
          <Outcome tone="ok">{t('token.verified')}</Outcome>
          <p className="mt-5">
            <Link className="ink-link" to="/login">
              {t('auth.login')}
            </Link>
          </p>
        </>
      )}
      {state === 'error' && (
        <>
          <Outcome tone="bad">{message}</Outcome>
          <p className="paper-dim mt-4 text-[0.84rem] leading-relaxed">
            {t('token.verifyExpiredHint')}
          </p>
        </>
      )}
    </PaperShell>
  );
}

export function ResetPasswordPage(): React.ReactElement {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t('token.resetFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PaperShell
      aside={
        <Link className="floor-link" to="/">
          {t('nav.backHome')}
        </Link>
      }
      title={t('token.resetTitle')}
    >
      {done ? (
        <Outcome tone="ok">{t('token.resetDone')}</Outcome>
      ) : (
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="paper-label">{t('auth.password')}</span>
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
            <span className="paper-dim mt-1.5 block text-[0.78rem]">{t('auth.passwordRule')}</span>
          </label>
          <button
            className="ink-button w-full px-5 py-3 text-[0.84rem]"
            disabled={busy || !token}
            type="submit"
          >
            {busy ? t('common.sending') : t('token.resetSubmit')}
          </button>
          {!token && <Outcome tone="bad">{t('token.missingToken')}</Outcome>}
          {error && <Outcome tone="bad">{error}</Outcome>}
        </form>
      )}
    </PaperShell>
  );
}

/** Demande de réinitialisation. La réponse est toujours la même, compte ou pas. */
export function ForgotPasswordPage(): React.ReactElement {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <PaperShell
      aside={
        <Link className="floor-link" to="/">
          {t('nav.backHome')}
        </Link>
      }
      title={t('auth.forgotPassword')}
    >
      {sent ? (
        <Outcome tone="ok">{t('token.forgotSent')}</Outcome>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void api.post('/api/auth/forgot', { email }).finally(() => setSent(true));
          }}
        >
          <label className="block">
            <span className="paper-label">{t('auth.email')}</span>
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
            {t('token.forgotSubmit')}
          </button>
        </form>
      )}
    </PaperShell>
  );
}

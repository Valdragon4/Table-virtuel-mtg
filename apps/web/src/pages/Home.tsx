/**
 * L'accueil. C'est une page de persuasion, pas un tableau de bord : un visiteur
 * arrive le plus souvent par un lien collé dans une conversation, souvent sur
 * téléphone, et doit comprendre en quelques secondes ce que c'est, pourquoi
 * c'est différent, et comment s'asseoir.
 *
 * Le monde visuel est celui de la papeterie de salle de tournoi : le sol sombre
 * d'une salle la nuit, et des plaques de carton posées dessus qui portent
 * l'impression. Une seule encre saturée — le violet de tampon, hérité du violet
 * des dés de la table. Les styles vivent dans `src/styles/identity.css`.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type Me } from '../lib/api.js';
import { LegalFooter } from '../components/LegalFooter.js';
import { Wordmark } from '../components/Mark.js';
import { TablePreview } from '../components/TablePreview.js';
import { InstallApp } from '../components/InstallApp.js';
import { AccountBar } from '../components/AccountBar.js';
import { useT } from '../lib/i18n/index.js';

type Mode = 'COMMANDER' | 'DUEL';

/**
 * Les formats offerts à la création.
 *
 * Le nom du format reste en anglais dans les deux langues : « Commander » et
 * « Duel » sont des noms de format, pas des libellés d'interface. Le détail,
 * lui, est du texte de produit — il passe par le catalogue, et c'est la clé qui
 * vit ici plutôt que la phrase, faute de pouvoir appeler `useT` hors de React.
 */
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'COMMANDER', label: 'Commander' },
  { id: 'DUEL', label: 'Duel' },
];

export function Home(): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<Mode>('COMMANDER');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .get<Me>('/api/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function createRoom(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const room = await api.post<{ code: string }>('/api/rooms', { mode, isPrivate: false });
      navigate(`/rooms/${room.code}`);
    } catch (err) {
      // Le message d'`ApiError` vient du serveur : on l'affiche tel quel.
      setError(err instanceof ApiError ? err.message : t('home.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  const detail = mode === 'DUEL' ? t('home.modeDuelDetail') : t('home.modeCommanderDetail');

  return (
    <div className="site site-floor min-h-screen">
      <header className="mx-auto flex max-w-[78rem] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8 sm:py-5">
        <Wordmark />
        <nav className="flex items-center gap-5 text-[0.85rem]">
          <InstallApp />
          {me ? (
            <>
              <Link
                className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                to="/tables"
              >
                {t('nav.myTables')}
              </Link>
              <Link
                className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                to="/decks"
              >
                {t('nav.myDecks')}
              </Link>
              {/* Le pseudo et la langue voyagent ensemble : c'est le bloc que
                  les trois en-têtes hors partie partagent. */}
              <AccountBar me={me} />
              <button
                className="text-[color:var(--site-floor-dim)] underline hover:text-[color:var(--site-floor-text)]"
                onClick={() => void api.post('/api/auth/logout').then(() => setMe(null))}
              >
                {t('auth.logout')}
              </button>
            </>
          ) : (
            <>
              {/* Un visiteur sans compte a besoin de lire la page dans sa
                  langue autant qu'un inscrit : le sélecteur reste. */}
              <AccountBar me={null} />
              <Link
                className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                to="/login"
              >
                {t('auth.login')}
              </Link>
              <Link
                className="sign-sm border-2 border-[color:var(--site-stamp-pale)] px-3 py-1.5 text-[0.72rem] text-[color:var(--site-stamp-pale)] transition-colors hover:bg-[color:var(--site-stamp-pale)] hover:text-[#160f2a]"
                to="/register"
              >
                {t('auth.createAccount')}
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        {/* ── Premier écran ────────────────────────────────────────────────
            Titre de signalétique, vérité produit, puis les deux gestes : ouvrir
            une table, ou rejoindre celle qu'on vous a envoyée. La preuve est à
            droite en grand écran, et passe sous les deux gestes en étroit. */}
        <section className="mx-auto grid max-w-[78rem] gap-12 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:items-start lg:gap-14 lg:pt-10">
          <div>
            <h1 className="sign text-[clamp(2.35rem,8.4vw,5.1rem)] text-[color:var(--site-floor-text)]">
              {t('home.heroLine1')}
              <br />
              <span className="text-[color:var(--site-stamp-pale)]">{t('home.heroLine2')}</span>
              <br />
              {t('home.heroLine3')}
            </h1>

            <p className="mt-5 max-w-[54ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)] sm:text-[1.02rem]">
              {t('home.heroLeadBefore')}{' '}
              <strong className="font-semibold text-[color:var(--site-floor-text)]">
                {t('home.heroLeadStrong')}
              </strong>
              {t('home.heroLeadAfter')}
            </p>

            {/* La plaque : créer une table. */}
            <div className="cut-shadow settle mt-7 sm:mt-9">
              <div className="paper paper-cut p-5 sm:p-7">
              <h2 className="sign-sm text-[0.8rem] text-[color:var(--site-ink)]">
                {t('home.openTable')}
              </h2>
              <div className="rule-ink mt-3 pt-5">
                <div
                  aria-label={t('home.tableFormat')}
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                >
                  {MODES.map((entry) => (
                    <button
                      aria-checked={mode === entry.id}
                      className="printed-choice px-3.5 py-2 text-[0.78rem]"
                      key={entry.id}
                      onClick={() => setMode(entry.id)}
                      role="radio"
                      type="button"
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <p className="paper-dim mt-3 min-h-[2.6em] max-w-[46ch] text-[0.83rem] leading-relaxed">
                  {detail}
                </p>

                <button
                  className="ink-button mt-4 w-full px-5 py-3.5 text-[0.86rem] disabled:cursor-not-allowed"
                  disabled={busy}
                  onClick={() => void createRoom()}
                  type="button"
                >
                  {busy ? t('home.opening') : t('home.createTable')}
                </button>
                <p className="paper-dim mt-2.5 text-[0.79rem] leading-relaxed">
                  {t('home.addressIsLink')}
                </p>
              </div>
              </div>
            </div>

            {/* Le talon : rejoindre par code. */}
            <div className="paper settle mt-4 px-5 pb-5 pt-0 sm:mt-5 sm:px-7 sm:pb-6">
              <div className="perforation -mx-5 sm:-mx-7" />
              <div className="flex flex-wrap items-end gap-4 pt-4">
                <label className="flex-1 basis-[11rem]">
                  <span className="sign-sm block text-[0.68rem] text-[color:var(--site-ink-soft)]">
                    {t('home.codeAsk')}
                  </span>
                  <input
                    className="code-field mt-2 w-full pb-1.5 text-[1.5rem]"
                    inputMode="text"
                    maxLength={8}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && code.length >= 4) navigate(`/rooms/${code}`);
                    }}
                    placeholder="ABC123"
                    value={code}
                  />
                </label>
                <button
                  className="ink-outline px-5 py-2.5 text-[0.8rem]"
                  disabled={code.length < 4}
                  onClick={() => navigate(`/rooms/${code}`)}
                  type="button"
                >
                  {t('table.join')}
                </button>
              </div>
            </div>

            {error && (
              <p
                className="mt-4 border-2 border-[color:var(--site-alarm-floor)]/70 px-3.5 py-2.5 text-[0.88rem] text-[color:var(--site-alarm-floor)]"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>

          <div className="lg:pt-10">
            <TablePreview />

            {/* Ce qu'on colle réellement. Une liste de deck est du texte tapé :
                elle est donc rendue comme telle, et pas décrite. */}
            <div className="rule-floor mt-10 pt-6">
              <h2 className="sign-sm text-[0.78rem] text-[color:var(--site-floor-text)]">
                {t('home.pasteHeading')}
              </h2>
              <pre className="typed mt-3 overflow-x-auto text-[0.78rem] leading-[1.75] text-[color:var(--site-floor-dim)]">
                {`1 Atraxa, Grand Unifier
1 Sol Ring
1 Fabled Passage
4 Forest
// Sideboard
2 Solemn Simulacrum`}
              </pre>
              <p className="mt-3 max-w-[46ch] text-[0.88rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                {t('home.pasteDetail')}
              </p>
            </div>
          </div>
        </section>

        {/* ── La séquence ──────────────────────────────────────────────────
            Trois moments, dans l'ordre : l'ordre est l'information. */}
        <section className="mx-auto max-w-[78rem] px-5 pb-20 sm:px-8">
          <div className="rule-stamp grid gap-px pt-8 sm:grid-cols-3 sm:gap-10">
            {[
              { n: '01', t: t('home.step1Title'), d: t('home.step1Detail') },
              { n: '02', t: t('home.step2Title'), d: t('home.step2Detail') },
              { n: '03', t: t('home.step3Title'), d: t('home.step3Detail') },
            ].map((step) => (
              <div className="pt-7 sm:pt-8" key={step.n}>
                <span className="typed block text-[1.6rem] leading-none text-[color:var(--site-stamp-pale)]">
                  {step.n}
                </span>
                <h3 className="sign-sm mt-3 text-[0.94rem] text-[color:var(--site-floor-text)]">
                  {step.t}
                </h3>
                <p className="mt-2 max-w-[42ch] text-[0.92rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                  {step.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Les deux vérités qu'aucune autre table ne peut recopier ─────── */}
        <section className="mx-auto max-w-[78rem] px-5 pb-20 sm:px-8">
          <div className="grid gap-12 md:grid-cols-2 md:gap-16">
            <div>
              <h2 className="sign text-[clamp(1.6rem,3.4vw,2.3rem)] text-[color:var(--site-floor-text)]">
                {t('home.noRulesTitle')}
              </h2>
              <p className="mt-4 max-w-[48ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                {t('home.noRulesBefore')}{' '}
                <span className="typed text-[color:var(--site-floor-text)]">117 964</span>{' '}
                {t('home.noRulesAfter')}
              </p>
              <p className="mt-5">
                <span className="stamped stamped-on-floor">{t('home.stampNoRules')}</span>
              </p>
            </div>

            <div>
              <h2 className="sign text-[clamp(1.6rem,3.4vw,2.3rem)] text-[color:var(--site-floor-text)]">
                {t('home.hiddenTitle')}
              </h2>
              <p className="mt-4 max-w-[48ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                {t('home.hiddenDetail')}
              </p>
              <p className="mt-5">
                <span className="stamped stamped-on-floor">{t('home.stampHidden')}</span>
              </p>
            </div>
          </div>
        </section>

        {/* ── Le compte, et ce qu'il n'est pas ────────────────────────────── */}
        <section className="mx-auto max-w-[78rem] px-5 pb-20 sm:px-8">
          <div className="rule-floor flex flex-wrap items-end justify-between gap-6 pt-8">
            <div>
              <h2 className="sign text-[clamp(1.4rem,3vw,2rem)] text-[color:var(--site-floor-text)]">
                {t('home.accountTitle')}
              </h2>
              <p className="mt-3 max-w-[52ch] text-[0.95rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                {t('home.accountDetail')}
              </p>
            </div>
            {/*
              Le sélecteur de langue vivait ici, faute d'écran de paramètres de
              compte. Il est maintenant dans l'en-tête, à côté du pseudo, et
              donc présent sur tous les écrans hors partie plutôt que sur cette
              seule section : on ne le laisse pas en double, deux champs qui
              disent la même chose se contredisent à l'œil.

              C'est toujours le même `setLanguage` que le sélecteur de la table
              — changer la langue en partie modifie cette préférence-ci, et
              inversement.
            */}
            {!me && (
              <div className="flex flex-wrap gap-3">
                <Link
                  className="sign-sm border-2 border-[color:var(--site-stamp-pale)] px-4 py-2.5 text-[0.75rem] text-[color:var(--site-stamp-pale)] transition-colors hover:bg-[color:var(--site-stamp-pale)] hover:text-[#160f2a]"
                  to="/register"
                >
                  {t('auth.createAccount')}
                </Link>
                <Link
                  className="sign-sm border-2 border-[color:var(--site-floor-rule)] px-4 py-2.5 text-[0.75rem] text-[color:var(--site-floor-dim)] transition-colors hover:border-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                  to="/login"
                >
                  {t('auth.login')}
                </Link>
              </div>
            )}
          </div>
        </section>
      </main>

      <LegalFooter />
    </div>
  );
}

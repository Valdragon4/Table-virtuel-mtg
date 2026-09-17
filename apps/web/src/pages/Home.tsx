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

type Mode = 'COMMANDER' | 'DUEL';

/**
 * Les formats offerts à la création. Le détail est celui du produit, pas une
 * promesse : la table est plafonnée à quatre sièges (`LIMITS.maxSeats`).
 */
const MODES: Array<{ id: Mode; label: string; detail: string }> = [
  { id: 'COMMANDER', label: 'Commander', detail: 'Jusqu’à 4 sièges, 40 points de vie, dégâts de commandant suivis par siège.' },
  { id: 'DUEL', label: 'Duel', detail: 'Deux joueurs, 20 points de vie.' },
];

export function Home(): React.ReactElement {
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
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  const selected = MODES.find((entry) => entry.id === mode) ?? MODES[0]!;

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
                Mes tables
              </Link>
              <Link
                className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                to="/decks"
              >
                Mes decks
              </Link>
              <span className="typed text-[color:var(--site-floor-dim)]">{me.displayName}</span>
              <button
                className="text-[color:var(--site-floor-dim)] underline hover:text-[color:var(--site-floor-text)]"
                onClick={() => void api.post('/api/auth/logout').then(() => setMe(null))}
              >
                Se déconnecter
              </button>
            </>
          ) : (
            <>
              <Link
                className="text-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                to="/login"
              >
                Se connecter
              </Link>
              <Link
                className="sign-sm border-2 border-[color:var(--site-stamp-pale)] px-3 py-1.5 text-[0.72rem] text-[color:var(--site-stamp-pale)] transition-colors hover:bg-[color:var(--site-stamp-pale)] hover:text-[#160f2a]"
                to="/register"
              >
                Créer un compte
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
              Quatre sièges.
              <br />
              <span className="text-[color:var(--site-stamp-pale)]">Aucun arbitre.</span>
              <br />
              Un lien.
            </h1>

            <p className="mt-5 max-w-[54ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)] sm:text-[1.02rem]">
              Une table de Magic dans le navigateur qui n’applique{' '}
              <strong className="font-semibold text-[color:var(--site-floor-text)]">
                aucune règle
              </strong>
              . Vous arbitrez entre vous, comme autour d’une vraie table, et personne n’a
              besoin de compte pour s’asseoir.
            </p>

            {/* La plaque : créer une table. */}
            <div className="cut-shadow settle mt-7 sm:mt-9">
              <div className="paper paper-cut p-5 sm:p-7">
              <h2 className="sign-sm text-[0.8rem] text-[color:var(--site-ink)]">
                Ouvrir une table
              </h2>
              <div className="rule-ink mt-3 pt-5">
                <div
                  aria-label="Format de la table"
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
                  {selected.detail}
                </p>

                <button
                  className="ink-button mt-4 w-full px-5 py-3.5 text-[0.86rem] disabled:cursor-not-allowed"
                  disabled={busy}
                  onClick={() => void createRoom()}
                  type="button"
                >
                  {busy ? 'Ouverture…' : 'Créer la table et obtenir le lien'}
                </button>
                <p className="paper-dim mt-2.5 text-[0.79rem] leading-relaxed">
                  Son adresse est le lien : copiez-la, envoyez-la.
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
                    On vous a envoyé un code ?
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
                  Rejoindre
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
                Et voilà ce que vous collez
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
                Telle quelle, dans une zone de texte. Ou une URL Archidekt. Ou un export
                Moxfield. Ce qui n’est pas reconnu vous est rendu ligne par ligne, plutôt
                qu’avalé en silence.
              </p>
            </div>
          </div>
        </section>

        {/* ── La séquence ──────────────────────────────────────────────────
            Trois moments, dans l'ordre : l'ordre est l'information. */}
        <section className="mx-auto max-w-[78rem] px-5 pb-20 sm:px-8">
          <div className="rule-stamp grid gap-px pt-8 sm:grid-cols-3 sm:gap-10">
            {[
              {
                n: '01',
                t: 'Vous ouvrez la table',
                d: 'Un format, un bouton. L’adresse de la page est le lien d’invitation ; il n’y a rien d’autre à configurer.',
              },
              {
                n: '02',
                t: 'Chacun colle son deck',
                d: 'Une URL Archidekt, une liste collée telle quelle, ou un export Moxfield. La liste est relue et ce qui coince vous est dit, ligne par ligne.',
              },
              {
                n: '03',
                t: 'Vous jouez, et vous arbitrez',
                d: 'Le logiciel déplace, mélange, pioche et compte. Il ne dit jamais qu’un geste est illégal : c’est votre table.',
              },
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
                Le logiciel ne dit jamais non
              </h2>
              <p className="mt-4 max-w-[48ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                Pas de pile, pas de priorité, pas de « vous ne pouvez pas faire ça ». Vous
                posez, vous tapez, vous déplacez ; la carte la plus tordue de{' '}
                <span className="typed text-[color:var(--site-floor-text)]">117 964</span>{' '}
                cartes indexées se joue comme les autres, et vos formats maison aussi. Les
                désaccords se règlent comme à la vraie table : en parlant.
              </p>
              <p className="mt-5">
                <span className="stamped stamped-on-floor">Aucun moteur de règles</span>
              </p>
            </div>

            <div>
              <h2 className="sign text-[clamp(1.6rem,3.4vw,2.3rem)] text-[color:var(--site-floor-text)]">
                Votre bibliothèque n’est pas dans votre navigateur
              </h2>
              <p className="mt-4 max-w-[48ch] text-[0.98rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                Elle est sur le serveur, et il n’en publie rien — pas même à vous. Une carte en
                bibliothèque n’a aucun identifiant diffusé, et un mélange les réattribue tous,
                pour qu’aucun relevé avant/après ne reconstitue l’ordre. Ce n’est pas une
                promesse de bonne conduite : c’est la façon dont la table est construite, et
                les tests s’en assurent.
              </p>
              <p className="mt-5">
                <span className="stamped stamped-on-floor">Information cachée</span>
              </p>
            </div>
          </div>
        </section>

        {/* ── Le compte, et ce qu'il n'est pas ────────────────────────────── */}
        <section className="mx-auto max-w-[78rem] px-5 pb-20 sm:px-8">
          <div className="rule-floor flex flex-wrap items-end justify-between gap-6 pt-8">
            <div>
              <h2 className="sign text-[clamp(1.4rem,3vw,2rem)] text-[color:var(--site-floor-text)]">
                Le compte ne sert pas à jouer
              </h2>
              <p className="mt-3 max-w-[52ch] text-[0.95rem] leading-relaxed text-[color:var(--site-floor-dim)]">
                Il garde vos decks d’une partie à l’autre, vos playmats et vos réglages. Pour
                vous asseoir à une table, il ne sert à rien — et ce n’est pas un oubli.
              </p>
            </div>
            {!me && (
              <div className="flex flex-wrap gap-3">
                <Link
                  className="sign-sm border-2 border-[color:var(--site-stamp-pale)] px-4 py-2.5 text-[0.75rem] text-[color:var(--site-stamp-pale)] transition-colors hover:bg-[color:var(--site-stamp-pale)] hover:text-[#160f2a]"
                  to="/register"
                >
                  Créer un compte
                </Link>
                <Link
                  className="sign-sm border-2 border-[color:var(--site-floor-rule)] px-4 py-2.5 text-[0.75rem] text-[color:var(--site-floor-dim)] transition-colors hover:border-[color:var(--site-floor-dim)] hover:text-[color:var(--site-floor-text)]"
                  to="/login"
                >
                  Se connecter
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

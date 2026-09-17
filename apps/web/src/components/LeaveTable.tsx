/**
 * Le bouton « Quitter » de la table, et ce qu'il recouvre vraiment.
 *
 * Trois gestes très différents se cachaient derrière un même mot :
 *
 *  - **s'absenter** — fermer l'onglet, revenir plus tard : le siège reste
 *    tenu, la main et la bibliothèque attendent. C'est le geste courant :
 *    il est le bouton lui-même, sans menu ni confirmation ;
 *  - **quitter pour de bon** — la place est rendue, le matériel sort de la
 *    table. En cours de partie cela vaut concession, et le libellé le dit ;
 *  - **clore la table** — réservé à l'hôte : la partie s'arrête pour tout le
 *    monde.
 *
 * Les deux derniers sont irréversibles : ils demandent confirmation, et le
 * serveur exige en plus un drapeau explicite pour le départ en pleine partie.
 *
 * Le geste courant coûte **un** clic : « Quitter » s'absente tout de suite. Le
 * chevron d'à côté n'ouvre que ce qui est rare et irréversible. Tout mettre
 * derrière un menu faisait payer deux clics à celui qui ne voulait que fermer
 * l'onglet — et, à trois entrées dont deux dangereuses, ouvrir le menu était
 * surtout l'occasion de se tromper de ligne.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../store/game.js';

export function LeaveTable(): React.ReactElement {
  const navigate = useNavigate();
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  const room = useGame((s) => s.room);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isHost = room?.hostSeat !== null && room?.hostSeat === mySeat;
  const playing = room?.status === 'PLAYING';

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function goHome(): void {
    navigate('/');
  }

  function leaveForGood(): void {
    const warning = playing
      ? 'Quitter la partie ? Cela vaut concession : votre jeu quitte le terrain et la partie continue sans vous.'
      : 'Quitter la table ? Votre place et votre deck y sont libérés.';
    if (!window.confirm(warning)) return;
    // `force` est le consentement : sans lui, le serveur refuse tant que la
    // partie tourne. On ne le pose qu'après cette confirmation.
    send({ type: 'STAND_UP', force: true });

    /*
     * On ne part qu'une fois le siège réellement libéré. Naviguer tout de suite
     * démontait la page — et donc le socket — avant que la demande ait été
     * traitée : le départ passait quand même, mais on quittait sans jamais
     * savoir s'il avait abouti, et un refus du serveur restait invisible.
     */
    const stop = useGame.subscribe((state) => {
      if (state.mySeat === null) {
        stop();
        window.clearTimeout(timer);
        navigate('/tables');
      }
    });
    const timer = window.setTimeout(() => {
      stop();
      navigate('/tables');
    }, 3000);
  }

  function closeRoom(): void {
    if (!window.confirm('Clore la table pour tout le monde ? La partie s’arrête pour tous les joueurs.')) {
      return;
    }
    send({ type: 'CLOSE_ROOM' });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-700 bg-slate-900/80 shadow-sm backdrop-blur">
        <button
          className="px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-200 hover:bg-slate-800 hover:text-white transition-colors"
          data-test="leave-now"
          onClick={goHome}
          title="Revenir à l’accueil. Votre siège reste tenu : main, bibliothèque et terrain vous attendent."
          type="button"
        >
          Quitter
        </button>
        <button
          aria-label="Autres façons de quitter"
          className="border-l border-slate-700 px-2 py-1.5 text-xs sm:text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          data-test="leave-more"
          onClick={() => setOpen((value) => !value)}
          title="Quitter pour de bon, ou clore la table"
          type="button"
        >
          ▾
        </button>
      </div>

      {open && (
        <>
          {/* Le voile ferme le menu au premier clic ailleurs : sans lui, il
              restait ouvert et avalait les clics de la table. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-700/90 bg-slate-900/95 py-1 text-sm shadow-2xl shadow-black/80 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
            data-test="leave-menu"
          >
            <Entry
              danger
              detail={
                playing
                  ? 'Vaut concession : votre jeu quitte le terrain.'
                  : 'Votre place et votre deck sont libérés.'
              }
              label="Quitter la table pour de bon"
              onClick={leaveForGood}
            />
            {isHost && (
              <Entry
                danger
                detail="La partie s’arrête pour tous les joueurs."
                label="Clore la table"
                onClick={closeRoom}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Entry({
  label,
  detail,
  onClick,
  danger,
}: {
  label: string;
  detail: string;
  onClick: () => void;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      className="block w-full px-3 py-2 text-left hover:bg-slate-800"
      onClick={onClick}
      type="button"
    >
      <span className={danger ? 'text-rose-300' : 'text-slate-100'}>{label}</span>
      <span className="mt-0.5 block text-[0.72rem] leading-snug text-slate-400">{detail}</span>
    </button>
  );
}

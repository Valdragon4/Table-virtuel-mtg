/**
 * Ce qui s'affiche quand la partie s'arrête.
 *
 * Une fin de partie était jusqu'ici une ligne de journal parmi d'autres : l'hôte
 * cloturait, et les autres joueurs continuaient de cliquer sans comprendre
 * pourquoi plus rien ne répondait. On le dit donc franchement, en plein écran.
 *
 * Après une partie *terminée*, le voile se referme : on veut pouvoir regarder le
 * terrain une dernière fois, commenter, compter les dégâts. Après une table
 * *close*, non — il n'y a plus rien à y faire, le serveur refuse jusqu'au
 * mouvement de curseur, et laisser croire le contraire était le défaut qu'on
 * corrige ici.
 */
import { Link } from 'react-router-dom';
import { useGame } from '../store/game.js';

export function TableClosed(): React.ReactElement | null {
  const gameOver = useGame((s) => s.gameOver);
  const seats = useGame((s) => s.seats);
  const closed = useGame((s) => s.room?.closed ?? false);
  const dismiss = useGame((s) => s.dismissGameOver);
  const roomCode = useGame((s) => s.roomCode);
  // Une table close reste annoncée même après rechargement : l'information ne
  // vient plus d'un event qu'on aurait pu manquer, mais de l'état de la room.
  if (!gameOver && !closed) return null;

  const winner = seats.find((s) => gameOver?.winners.includes(s.id));
  const title = closed ? 'Table close' : 'Partie terminée';
  const detail = closed
    ? "L'hôte a clos la table. Plus rien ne s'y joue, et l'on ne s'y rassoit pas."
    : winner
      ? `${winner.displayName} reste seul en lice.`
      : 'Il ne reste plus de joueur en lice.';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60">
      <div className="w-[min(28rem,90vw)] rounded border border-edge bg-panel p-6 text-center shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
        <p className="mt-2 text-sm text-slate-400">{detail}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {/* Une partie finie se commente encore autour du terrain ; une table
              close, non — il n'y a plus rien à y faire, et laisser croire le
              contraire est précisément ce qu'on corrige. */}
          {!closed && (
            <button
              className="rounded border border-edge px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
              onClick={dismiss}
              type="button"
            >
              Regarder le terrain
            </button>
          )}
          {/*
            Le seul chemin qui mène au lecteur depuis la table.

            Sans lui, le replay existait sans que personne ne puisse le trouver :
            il ne s'atteignait qu'en tapant son adresse à la main. C'est ici qu'il
            a sa place — au moment précis où la partie vient de finir et où l'on a
            envie de la revoir. Le lecteur porte son propre verrou et répond « pas
            de replay » tant que la partie court, donc proposer le lien n'ouvre
            rien : c'est le serveur qui décide, pas ce bouton.
          */}
          {roomCode && (
            <Link
              className="rounded border border-edge px-4 py-2 text-sm text-slate-200 hover:border-slate-500"
              to={`/rooms/${roomCode}/replay`}
            >
              Revoir la partie
            </Link>
          )}
          <Link
            className="rounded border border-edge bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:border-slate-500"
            to="/tables"
          >
            Mes tables
          </Link>
        </div>
      </div>
    </div>
  );
}

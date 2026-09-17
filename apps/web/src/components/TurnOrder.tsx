/**
 * L'ordre du tour, dans un coin.
 *
 * Il n'était lisible nulle part. Chaque panneau de siège affiche « Tour 4 » et
 * celui du joueur actif ajoute « à vous », mais pour savoir *qui* joue quand on
 * n'est pas concerné, il fallait faire le tour de la table des yeux — et pour
 * savoir qui vient après, deviner la disposition. À une vraie table, l'ordre est
 * une évidence physique : on est assis dedans. Ici, il faut l'écrire.
 *
 * **L'ordre affiché est celui que le serveur applique**, pas une reconstruction
 * d'affichage : `END_TURN` trie sur `seatIndex` en écartant ceux qui ont
 * concédé (`apps/server/src/game/engine-2.ts`). On reproduit exactement ce tri,
 * et l'on part du siège actif pour que la liste se lise de haut en bas comme la
 * partie va se dérouler — « moi, puis lui, puis elle ». Un ordre trié sur
 * `seatIndex` mais commençant ailleurs qu'au joueur actif serait exact et
 * pourtant illisible.
 *
 * Les sièges qui ont concédé restent listés, barrés : ils ne prennent plus de
 * tour, mais les faire disparaître donnerait l'impression qu'ils ont quitté la
 * table.
 */
import { useGame } from '../store/game.js';

export function TurnOrder(): React.ReactElement | null {
  const seats = useGame((s) => s.seats);
  const mySeat = useGame((s) => s.mySeat);
  const activeSeat = useGame((s) => s.turn.activeSeat);
  const turnNumber = useGame((s) => s.turn.turnNumber);
  const status = useGame((s) => s.room?.status);

  // Avant le lancement, il n'y a pas d'ordre : il n'y a que des gens assis.
  if (status !== 'PLAYING' || seats.length === 0) return null;

  const byIndex = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const jouants = byIndex.filter((s) => !s.conceded);
  const depart = jouants.findIndex((s) => s.id === activeSeat);
  // Le siège actif en tête, puis la suite dans l'ordre. Si l'on ne le retrouve
  // pas (juste après une concession, le temps d'un événement), on garde l'ordre
  // brut plutôt que de ne rien montrer.
  const suite = depart < 0 ? jouants : jouants.map((_, i) => jouants[(depart + i) % jouants.length]!);
  const sortis = byIndex.filter((s) => s.conceded);

  return (
    <div
      className="pointer-events-auto rounded-xl border border-slate-700 bg-slate-900/90 p-2.5 text-sm shadow-xl backdrop-blur-md"
      data-test="turn-order"
    >
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-bold uppercase tracking-wider text-slate-400 text-[10px]">Ordre du tour</span>
        <span className="tabular-nums font-mono font-bold text-sky-400 bg-sky-950/60 border border-sky-800/60 px-1.5 py-0.5 rounded text-[11px]">
          Tour {turnNumber}
        </span>
      </div>
      <ol className="space-y-1">
        {[...suite, ...sortis].map((seat, rang) => {
          const actif = seat.id === activeSeat && !seat.conceded;
          const moi = seat.id === mySeat;
          return (
            <li
              key={seat.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 leading-none transition-all ${
                actif
                  ? 'bg-emerald-950/70 border border-emerald-500/60 shadow-sm shadow-emerald-950/50 ring-1 ring-emerald-400/30'
                  : 'hover:bg-slate-800/50'
              } ${seat.conceded ? 'opacity-40' : ''}`}
              data-test={actif ? 'turn-order-active' : undefined}
            >
              {/*
                Le rang n'est pas un numéro de siège : c'est « dans combien de
                tours ». Celui qui joue porte donc une flèche, pas un « 1 ».
              */}
              <span className={`w-4 shrink-0 text-center text-xs tabular-nums font-bold ${
                actif ? 'text-emerald-300' : 'text-slate-500'
              }`}>
                {actif ? '▶' : seat.conceded ? '—' : rang}
              </span>
              <span
                className="h-3 w-3 shrink-0 rounded-full ring-2 ring-black/60 shadow-sm"
                style={{ background: seat.color }}
              />
              <span
                className={`flex-1 truncate ${seat.conceded ? 'line-through' : ''} ${
                  actif ? 'font-bold text-emerald-100' : 'font-medium text-slate-200'
                }`}
                title={seat.displayName}
              >
                {seat.displayName}
                {moi && <span className="ml-1 text-xs text-sky-400 font-semibold">(vous)</span>}
              </span>
              {!seat.connected && (
                <span className="shrink-0 text-xs text-amber-400 font-bold" title="Déconnecté">
                  ⚠
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

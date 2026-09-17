import { useEffect, useState } from 'react';
import { useGame, zoneKey } from '../store/game.js';
import { cardName } from '../lib/cards.js';
import {
  flushLife,
  pendingLifeDelta,
  queueLifeChange,
  subscribeLifeBatch,
} from '../lib/lifeBatch.js';

/**
 * Panneau de droite : points de vie, dégâts de commandant en matrice, et les
 * comptes de zones. Ces trois derniers n'affichent qu'un nombre — le contenu
 * d'une bibliothèque ne quitte jamais le serveur.
 */
export function PlayerPanel(): React.ReactElement | null {
  const mySeat = useGame((s) => s.mySeat);
  const seats = useGame((s) => s.seats);
  const counts = useGame((s) => s.zoneCounts);
  const cards = useGame((s) => s.cards);
  const send = useGame((s) => s.send);
  const [openDamage, setOpenDamage] = useState(false);
  // Force le rendu quand le cumul en attente change : il vit hors de React,
  // pour qu'un clic n'entraîne pas de rendu du reste de la table.
  const [, setTick] = useState(0);

  useEffect(() => subscribeLifeBatch(() => setTick((t) => t + 1)), []);

  // Quitter la table pendant le délai ne doit pas perdre le décompte.
  useEffect(() => {
    return () => {
      if (mySeat) flushLife(mySeat, useGame.getState().send);
    };
  }, [mySeat]);

  const me = seats.find((s) => s.id === mySeat);
  if (!me) return null;

  const pendingDelta = pendingLifeDelta(me.id);
  const shownLife = me.life + pendingDelta;

  const commanderScryfallId = (objectId: string): string | undefined => {
    const card = cards.get(objectId);
    return card && card.faceDown === false ? card.scryfallId : undefined;
  };

  /**
   * Commandants de ce siège, taxe comprise — y compris à zéro.
   *
   * La ligne n'apparaissait qu'une fois la taxe non nulle, c'est-à-dire jamais
   * au moment où l'on va la chercher. On part donc des commandants connus
   * (ceux qui sont en zone de commandement, plus ceux dont une taxe existe
   * déjà parce qu'ils en sont sortis) et non des seules entrées de
   * `commanderTax`.
   */
  const commanders = (() => {
    const byId = new Map<string, number>();
    for (const card of cards.values()) {
      if (card.owner === me.id && card.zone.kind === 'COMMAND') byId.set(card.id, 0);
    }
    for (const [objectId, casts] of Object.entries(me.commanderTax)) byId.set(objectId, casts);
    return [...byId].map(([objectId, casts]) => ({ objectId, casts }));
  })();

  /**
   * Écriture directe de la taxe. Le protocole (§6.6) passe par
   * `SET_PLAYER_COUNTER` avec un `kind` préfixé : le serveur y reconnaît une
   * taxe et non un compteur de joueur ordinaire.
   */
  const setTax = (objectId: string, casts: number): void => {
    send({
      type: 'SET_PLAYER_COUNTER',
      seat: me.id,
      kind: `commander_tax:${objectId}`,
      value: Math.max(0, casts),
    });
  };

  const zone = (kind: string): number => counts.get(zoneKey({ seat: me.id, kind: kind as never })) ?? 0;

  const opponents = seats.filter((s) => s.id !== me.id);

  /** 21 dégâts d'un même commandant : le seuil doit sauter aux yeux. */
  const lethal = (value: number): string =>
    value >= 21
      ? 'font-black text-rose-400 bg-rose-950/80 px-1.5 py-0.5 rounded ring-1 ring-rose-500/60 shadow-sm animate-pulse'
      : 'font-mono font-semibold text-slate-200';

  /**
   * Commandants d'un siège, quels qu'ils soient et où qu'ils se trouvent.
   *
   * Trois sources, parce qu'un commandant peut être parti de sa zone : ceux qui
   * y sont encore, ceux qui ont une taxe, et ceux déjà cités dans une matrice de
   * dégâts. Deux partenaires font deux compteurs distincts — les additionner
   * serait faux au regard des règles.
   */
  const commandersOf = (seatId: string): Array<{ objectId: string; name: string }> => {
    const ids = new Set<string>();
    for (const card of cards.values()) {
      if (card.owner === seatId && card.zone.kind === 'COMMAND') ids.add(card.id);
    }
    const summary = seats.find((s) => s.id === seatId);
    if (summary) for (const id of Object.keys(summary.commanderTax)) ids.add(id);
    for (const seat of seats) {
      for (const id of Object.keys(seat.commanderDamage[seatId] ?? {})) ids.add(id);
    }
    return [...ids].map((objectId) => ({
      objectId,
      name: cardName(commanderScryfallId(objectId)),
    }));
  };

  /** Écriture réservée au receveur : `to` vaut toujours mon propre siège. */
  const setDamage = (from: string, commanderId: string, value: number): void => {
    send({
      type: 'SET_COMMANDER_DAMAGE',
      from,
      to: me.id,
      commanderId,
      value: Math.max(0, value),
    });
  };

  return (
    <div className="pointer-events-auto w-60 rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 text-sm shadow-xl backdrop-blur-md">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Vie</span>
        <div className="flex items-center gap-2">
          <button
            className="h-7 w-7 rounded-lg bg-rose-600 hover:bg-rose-500 font-black text-white text-base shadow-sm transition-all active:scale-90 flex items-center justify-center"
            data-test="life-minus"
            onClick={() => queueLifeChange(me.id, -1, send)}
          >
            −
          </button>
          <span className="relative min-w-10 text-center font-mono text-2xl font-black text-white tracking-tight" data-test="life-total">
            {shownLife}
            {pendingDelta !== 0 && (
              /* Le cumul n'est pas encore parti : on le montre pour que le
                 joueur sache que son décompte est en cours, et combien. */
              <span
                className={`absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 text-[10px] font-black ${
                  pendingDelta > 0 ? 'bg-emerald-600' : 'bg-rose-600'
                } text-white ring-1 ring-white/20 shadow-md`}
                data-test="life-pending"
              >
                {pendingDelta > 0 ? `+${pendingDelta}` : pendingDelta}
              </span>
            )}
          </span>
          <button
            className="h-7 w-7 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-black text-white text-base shadow-sm transition-all active:scale-90 flex items-center justify-center"
            data-test="life-plus"
            onClick={() => queueLifeChange(me.id, 1, send)}
          >
            +
          </button>
        </div>
      </div>

      <button
        className="mb-2.5 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-left text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-all flex items-center justify-between"
        onClick={() => setOpenDamage((v) => !v)}
      >
        <span>Dégâts de commandant</span>
        <span className="text-[10px] text-slate-400">{openDamage ? '▲' : '▼'}</span>
      </button>

      {openDamage && (
        <div className="mb-3 space-y-3" data-test="commander-damage">
          {/*
            Ma ligne : les dégâts que **je** reçois. Le protocole (§6.6) réserve
            l'écriture au receveur — déclarer soi-même avoir tué un adversaire
            au commandant reviendrait à prononcer son élimination à sa place.
          */}
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
              Vous recevez
            </p>
            {opponents.length === 0 && (
              <p className="text-[11px] text-slate-600">Personne d'autre à table.</p>
            )}
            {opponents.map((from) => {
              const commanders = commandersOf(from.id);
              if (commanders.length === 0) {
                return (
                  <p key={from.id} className="text-[11px] text-slate-600">
                    {/* Un nom à espace ne se coupe pas au milieu de la phrase. */}
                    <span className="whitespace-nowrap" style={{ color: from.color }}>
                      {from.displayName}
                    </span>{' '}
                    — aucun
                    commandant connu
                  </p>
                );
              }
              return (
                <div key={from.id} className="mb-1.5">
                  <p className="truncate text-[11px] font-medium" style={{ color: from.color }}>
                    {from.displayName}
                  </p>
                  {commanders.map(({ objectId, name }) => {
                    const value = me.commanderDamage[from.id]?.[objectId] ?? 0;
                    return (
                      <div key={objectId} className="flex items-center justify-between gap-1">
                        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400" title={name}>
                          {name}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            className="h-5 w-5 rounded bg-slate-800 text-xs hover:bg-slate-700 disabled:opacity-40"
                            data-test="cmd-dmg-minus"
                            disabled={value === 0}
                            onClick={() => setDamage(from.id, objectId, value - 1)}
                          >
                            −
                          </button>
                          <span className={`w-6 text-center text-xs ${lethal(value)}`} data-test="cmd-dmg-value">
                            {value}
                          </span>
                          <button
                            className="h-5 w-5 rounded bg-slate-800 text-xs hover:bg-slate-700"
                            data-test="cmd-dmg-plus"
                            onClick={() => setDamage(from.id, objectId, value + 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/*
            Le reste de la matrice, en lecture seule. Pas de boutons grisés :
            l'absence de commande dit d'elle-même que ce compte appartient à son
            receveur. Les valeurs restent visibles de tous, seuil de 21 compris,
            qui est ce qu'on cherche du regard en fin de partie.
          */}
          {opponents.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                Les autres reçoivent
              </p>
              {opponents.map((to) => {
                const rows = seats
                  .filter((from) => from.id !== to.id)
                  .flatMap((from) =>
                    Object.entries(to.commanderDamage[from.id] ?? {})
                      .filter(([, value]) => value > 0)
                      .map(([objectId, value]) => ({ from, objectId, value })),
                  );
                return (
                  <div key={to.id} className="mb-1 flex items-start gap-1 text-[11px]">
                    <span
                      className="w-16 shrink-0 truncate font-medium"
                      style={{ color: to.color }}
                      title={to.displayName}
                    >
                      {to.displayName}
                    </span>
                    <span className="min-w-0 flex-1 text-slate-400">
                      {rows.length === 0
                        ? '—'
                        : rows.map(({ from, objectId, value }, index) => (
                            <span key={`${from.id}:${objectId}`}>
                              {index > 0 && ' · '}
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full align-middle"
                                style={{ background: from.color }}
                                title={`${from.displayName} — ${cardName(commanderScryfallId(objectId))}`}
                              />{' '}
                              <span className={lethal(value)} data-test="cmd-dmg-readonly">
                                {value}
                              </span>
                            </span>
                          ))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <dl className="space-y-1 text-xs">
        <Row label="Bibliothèque" value={zone('LIBRARY')} />
        <Row label="Cimetière" value={zone('GRAVEYARD')} />
        <Row label="Exil" value={zone('EXILE')} />
        <Row label="Commandement" value={zone('COMMAND')} />
        <Row label="Sideboard" value={zone('SIDEBOARD')} />
      </dl>

      {commanders.length > 0 && (
        <div className="mt-2 border-t border-edge pt-2 text-xs">
          <p className="mb-1 text-slate-500">Taxe de commandant</p>
          {commanders.map(({ objectId, casts }) => (
            <div key={objectId} className="mb-1 flex items-center justify-between gap-2">
              {/* La taxe est indexée par identifiant d'objet : c'est la carte
                  qu'il faut retrouver avant d'en demander le nom. */}
              <span className="min-w-0 flex-1 truncate text-slate-400">
                {cardName(commanderScryfallId(objectId))}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="h-5 w-5 rounded bg-life-minus font-bold text-white hover:brightness-110 disabled:opacity-40"
                  data-test="tax-minus"
                  disabled={casts === 0}
                  onClick={() => setTax(objectId, casts - 1)}
                  title="Un lancement de moins"
                >
                  −
                </button>
                {/* Ce que le joueur lit à la table, c'est le surcoût, pas le
                    nombre de lancements : on montre les deux. */}
                <span className="w-10 text-center" data-test="tax-value">
                  +{casts * 2}
                </span>
                <button
                  className="h-5 w-5 rounded bg-life-plus font-bold text-white hover:brightness-110"
                  data-test="tax-plus"
                  onClick={() => setTax(objectId, casts + 1)}
                  title="Un lancement de plus"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-0.5 px-1 rounded hover:bg-slate-800/60 transition-colors">
      <dt className="text-slate-300 font-medium text-xs">{label}</dt>
      <dd className="font-mono font-bold text-slate-100 tabular-nums text-xs bg-slate-950/60 px-1.5 py-0.5 rounded border border-slate-800">
        {value}
      </dd>
    </div>
  );
}

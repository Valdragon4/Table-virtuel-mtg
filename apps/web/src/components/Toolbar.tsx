import { useState } from 'react';
import { useGame } from '../store/game.js';
import { sortedHand } from '../lib/handSort.js';
import { askConfirm, askNumber, askText, openDialog } from './Dialog.js';

/** Barre d'actions haut-droite, calquée sur la table de référence. */
/** Jetons les plus fréquents, créables sans passer par la recherche. */
const QUICK_TOKENS = ['Treasure', 'Food', 'Clue', 'Blood', 'Soldier', 'Zombie'];

/**
 * Boutons clairs sur fond sombre, comme sur la table de référence : gray-200 sur
 * gray-900, coins à 4 px, 6/12 de remplissage.
 * Boutons sombres élégants aux standards Impeccable.
 */
const PRIMARY =
  'rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-white';
  'rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-100 shadow-sm backdrop-blur hover:bg-slate-700 hover:border-slate-600 transition-all active:scale-95';
const SECONDARY =
  'rounded border border-edge bg-panel px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500';
/** Le même bouton, mais c'est à nous de jouer : il doit se voir. */
  'rounded-lg border border-slate-750 bg-slate-900/80 px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-200 shadow-sm backdrop-blur hover:bg-slate-800 hover:border-slate-600 transition-all active:scale-95';
/** Le même bouton, mais c'est à nous de jouer : brillance émeraude lumineuse et vivante. */
const PRIMARY_ACTIVE =
  'rounded bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white ring-2 ring-sky-300/60 hover:bg-sky-400';
  'rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white ring-2 ring-emerald-400/60 shadow-lg shadow-emerald-950/70 hover:from-emerald-500 hover:to-teal-500 transition-all active:scale-95 animate-pulse';

export function Toolbar({
  onCreateToken,
  onQuickToken,
  onOpenHelp,
  onOpenSettings,
}: {
  onCreateToken: () => void;
  onQuickToken: (name: string) => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
}): React.ReactElement {
  const send = useGame((s) => s.send);
  const mySeat = useGame((s) => s.mySeat);
  /** Les sièges, pour choisir à qui l'on révèle sa main. */
  const seats = useGame((s) => s.seats);
  /** À nous de jouer ? Le bouton « Passer le tour » s'allume alors. */
  const myTurn = useGame((s) => s.turn.activeSeat !== null && s.turn.activeSeat === s.mySeat);
  const [menu, setMenu] = useState<'none' | 'create' | 'actions'>('none');

  const close = (): void => setMenu('none');

  return (
    <div className="pointer-events-auto flex items-start gap-2">
      <button className={PRIMARY} onClick={() => send({ type: 'UNTAP_ALL' })}>
        Tout dégager
      </button>
      <button className={PRIMARY} onClick={() => send({ type: 'DRAW', count: 1 })}>
        Piocher
      </button>
      {/*
        Passer le tour était enterré dans le menu « Actions » et dans le menu du
        fond. C'est pourtant le geste le plus répété d'une partie : il mérite
        d'être sous la main, à côté de « Piocher ». Il se met en avant quand
        c'est à nous — c'est à ce moment-là qu'on le cherche.
      */}
      <button
        className={myTurn ? PRIMARY_ACTIVE : PRIMARY}
        data-test="end-turn"
        onClick={() => send({ type: 'END_TURN' })}
        title={myTurn ? 'Passer la main au joueur suivant' : "Ce n'est pas votre tour"}
      >
        Passer le tour
      </button>

      <div className="relative">
        <button
          className={SECONDARY}
          onClick={() => setMenu((m) => (m === 'create' ? 'none' : 'create'))}
        >
          Créer ▾
        </button>
        {menu === 'create' && mySeat && (
          <Menu onClose={close}>
            <MenuItem onClick={() => { onCreateToken(); close(); }}>Jeton…</MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askText({
                  title: 'Poser une étiquette',
                  label: 'Texte de l’étiquette',
                  memory: 'toolbar-label',
                  submitLabel: 'Poser',
                }).then((text) => {
                  if (text) send({ type: 'ADD_LABEL', text, x: 40, y: 40 });
                });
              }}
            >
              Étiquette sur la table
            </MenuItem>
            <MenuItem
              onClick={() => {
                /*
                 * Un seul dialogue pour ce qui en demandait deux. Un compteur
                 * de joueur porte toujours un nombre — c'est le marqueur d'une
                 * carte qui peut n'être qu'un mot-clé —, la valeur est donc
                 * obligatoire ici, et zéro supprime le compteur.
                 */
                close();
                void openDialog({
                  title: 'Compteur de joueur',
                  submitLabel: 'Poser',
                  memory: 'player-counter',
                  fields: [
                    {
                      name: 'kind',
                      label: 'Type de compteur',
                      initial: 'poison',
                      maxLength: 40,
                      quick: ['poison', 'énergie', 'expérience', 'rad', 'ticket'].map((v) => ({
                        label: v,
                        value: v,
                      })),
                    },
                    {
                      name: 'value',
                      label: 'Valeur',
                      numeric: true,
                      initial: '1',
                      quick: [1, 2, 3, 5, 10].map((n) => ({ label: String(n), value: String(n) })),
                      hint: 'Zéro supprime le compteur.',
                    },
                  ],
                }).then((result) => {
                  if (!result) return;
                  const kind = result.values['kind'] ?? '';
                  const value = Number.parseInt(result.values['value'] ?? '', 10);
                  if (kind && Number.isFinite(value)) {
                    send({ type: 'SET_PLAYER_COUNTER', seat: mySeat, kind, value });
                  }
                });
              }}
            >
              Compteur de joueur…
            </MenuItem>
            {/* Jetons courants : un clic, sans passer par la recherche. */}
            <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-slate-500">Jetons rapides</p>
            {QUICK_TOKENS.map((name) => (
              <MenuItem key={name} onClick={() => { onQuickToken(name); close(); }}>
                {name}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>

      <div className="relative">
        <button
          className={SECONDARY}
          onClick={() => setMenu((m) => (m === 'actions' ? 'none' : 'actions'))}
        >
          Actions ▾
        </button>
        {menu === 'actions' && mySeat && (
          <Menu onClose={close}>
            <MenuItem
              onClick={() => {
                close();
                void askNumber({
                  title: 'Piocher combien de cartes ?',
                  label: 'Nombre de cartes',
                  initial: 1,
                  quick: [1, 2, 3, 5, 7],
                }).then((n) => {
                  if (n !== null) send({ type: 'DRAW', count: n });
                });
              }}
            >
              Piocher X…
            </MenuItem>
            <MenuItem onClick={() => { send({ type: 'MULLIGAN' }); close(); }}>Mulligan</MenuItem>
            <MenuItem
              onClick={() => {
                /*
                 * Ranger sa main d'un coup. On envoie un déplacement par carte,
                 * dans l'ordre voulu : `MOVE_CARDS` insérerait tout le lot au
                 * même index et renverserait le tri. Aucun de ces déplacements
                 * n'écrit au journal — ranger n'est pas jouer.
                 */
                const state = useGame.getState();
                const hand = [...state.cards.values()]
                  .filter((c) => c.zone.seat === mySeat && c.zone.kind === 'HAND')
                  .sort((a, b) => a.sortIndex - b.sortIndex);
                sortedHand(hand).forEach((id, index) => {
                  send({ type: 'MOVE_CARD', cardId: id, to: { seat: mySeat, kind: 'HAND' }, index });
                });
                close();
              }}
            >
              Trier la main
            </MenuItem>
            <MenuItem onClick={() => { send({ type: 'SHUFFLE', zone: { seat: mySeat, kind: 'LIBRARY' } }); close(); }}>
              Mélanger la bibliothèque
            </MenuItem>
            <MenuItem
              onClick={() => {
                send({ type: 'LOOK', zone: { seat: mySeat, kind: 'LIBRARY' }, count: 1, mode: 'SCRY' });
                close();
              }}
            >
              Scry 1
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askNumber({
                  title: 'Regarder combien de cartes du dessus ?',
                  label: 'Nombre de cartes',
                  initial: 2,
                  quick: [1, 2, 3, 5],
                }).then((n) => {
                  if (n !== null) {
                    send({ type: 'LOOK', zone: { seat: mySeat, kind: 'LIBRARY' }, count: n, mode: 'SCRY' });
                  }
                });
              }}
            >
              Regarder N cartes du dessus…
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askNumber({
                  title: 'Surveil combien ?',
                  label: 'Nombre de cartes',
                  initial: 1,
                  quick: [1, 2, 3, 5],
                }).then((n) => {
                  if (n !== null) {
                    send({ type: 'LOOK', zone: { seat: mySeat, kind: 'LIBRARY' }, count: n, mode: 'SURVEIL' });
                  }
                });
              }}
            >
              Surveil…
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askNumber({
                  title: 'Meuler combien de cartes ?',
                  label: 'Nombre de cartes',
                  initial: 1,
                  quick: [1, 2, 3, 5, 10],
                }).then((n) => {
                  if (n !== null) send({ type: 'MILL', count: n });
                });
              }}
            >
              Mill…
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askNumber({
                  title: 'Exiler combien de cartes du dessus ?',
                  label: 'Nombre de cartes',
                  initial: 1,
                  quick: [1, 2, 3, 5],
                }).then((n) => {
                  if (n !== null) send({ type: 'EXILE_TOP', count: n });
                });
              }}
            >
              Exiler le dessus…
            </MenuItem>
            <MenuItem
              onClick={() => {
                send({ type: 'LOOK', zone: { seat: mySeat, kind: 'LIBRARY' }, count: 'ALL', mode: 'SEARCH' });
                close();
              }}
            >
              Fouiller la bibliothèque
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askNumber({
                  title: 'Défausser combien de cartes au hasard ?',
                  label: 'Nombre de cartes',
                  initial: 1,
                  quick: [1, 2, 3],
                }).then((n) => {
                  if (n !== null) send({ type: 'RANDOM_DISCARD', count: n });
                });
              }}
            >
              Défausse au hasard…
            </MenuItem>
            <MenuItem onClick={() => { send({ type: 'REVEAL_HAND', toSeats: 'ALL' }); close(); }}>
              Révéler sa main
            </MenuItem>
            {/* Même geste, mais à qui l'on veut : `REVEAL_HAND` accepte une
                liste de sièges, et rien ne permettait de la composer. */}
            {seats.filter((s) => s.id !== mySeat).length > 0 && (
              <MenuItem
                onClick={() => {
                  close();
                  void openDialog({
                    title: 'Révéler sa main à…',
                    description: 'Seules les personnes cochées verront votre main.',
                    choicesLabel: 'Destinataires',
                    choices: seats
                      .filter((s) => s.id !== mySeat)
                      .map((s) => ({ id: s.id, label: s.displayName, color: s.color })),
                    requireChoice: true,
                    submitLabel: 'Révéler',
                  }).then((result) => {
                    if (result) send({ type: 'REVEAL_HAND', toSeats: result.chosen });
                  });
                }}
              >
                Révéler sa main à…
              </MenuItem>
            )}
            <MenuItem onClick={() => { send({ type: 'END_TURN' }); close(); }}>Passer le tour</MenuItem>
            <MenuItem
              onClick={() => {
                close();
                void askConfirm('Scoop', {
                  description: 'Ranger tout votre jeu dans la bibliothèque et mélanger ?',
                  submitLabel: 'Tout ranger',
                }).then((yes) => {
                  if (yes) send({ type: 'SCOOP' });
                });
              }}
            >
              Scoop (tout ranger et mélanger)
            </MenuItem>
            <MenuItem onClick={() => { onOpenSettings(); close(); }}>Playmat et dos de carte…</MenuItem>
            <MenuItem onClick={() => { onOpenHelp(); close(); }}>Raccourcis clavier</MenuItem>
            <MenuItem
              danger
              onClick={() => {
                close();
                void askConfirm('Concéder la partie ?', {
                  description: 'Vous quittez la partie en cours. Ce geste ne se reprend pas.',
                  submitLabel: 'Concéder',
                }).then((yes) => {
                  if (yes) send({ type: 'CONCEDE' });
                });
              }}
            >
              Concéder
            </MenuItem>
          </Menu>
        )}
      </div>
    </div>
  );
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }): React.ReactElement {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 z-20 mt-1.5 w-60 overflow-hidden rounded-xl border border-slate-700/90 bg-slate-900/95 py-1.5 shadow-2xl shadow-black/80 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
        {children}
      </div>
    </>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      className={`block w-full px-3 py-1.5 text-left text-xs sm:text-sm font-medium transition-colors ${
        danger ? 'text-rose-300 hover:bg-rose-950/80 hover:text-rose-100' : 'text-slate-200 hover:bg-slate-800 hover:text-white'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Pastilles d'aléa : tactiles, violet moderne, bordure subtile */
const DICE =
  'flex-1 rounded-lg border border-purple-500/40 bg-purple-900/60 hover:bg-purple-800/80 px-2 py-1.5 text-xs font-semibold text-purple-100 shadow-sm backdrop-blur transition-all active:scale-95 text-center';

export function DiceBar(): React.ReactElement {
  const send = useGame((s) => s.send);
  return (
    <div className="pointer-events-auto flex gap-2">
      <button
        className={DICE}
        onClick={() => send({ type: 'ROLL_DIE', sides: 20 })}
      >
        d20
      </button>
      <button
        className={DICE}
        onClick={() => {
          void askNumber({
            title: 'Lancer un dé',
            label: 'Nombre de faces',
            initial: 6,
            min: 2,
            quick: [4, 6, 8, 10, 12, 20, 100],
            submitLabel: 'Lancer',
          }).then((sides) => {
            if (sides !== null) send({ type: 'ROLL_DIE', sides });
          });
        }}
      >
        Dé…
      </button>
      <button
        className={DICE}
        onClick={() => send({ type: 'FLIP_COIN' })}
      >
        Pile ou face
      </button>
    </div>
  );
}

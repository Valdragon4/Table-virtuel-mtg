/**
 * Apparence d'un deck : son tapis de jeu et son dos de carte.
 *
 * Ces réglages vivent sur le **deck**, pas sur le siège : charger le deck les
 * applique à votre zone, pour vous comme pour les autres joueurs. Un deck noir
 * peut ainsi arriver avec son tapis, sans qu'on ait à le reconfigurer à chaque
 * partie.
 *
 * Ils restent modifiables sur un deck **synchronisé** depuis une source externe :
 * Archidekt ne connaît pas notre tapis, une resynchronisation ne l'efface donc
 * jamais.
 */
import { useState } from 'react';
import type { DeckSummary } from '@mtg/shared';
import { api, ApiError } from '../lib/api.js';
import { CardBack } from './CardBack.js';

export function DeckLook({
  deck,
  onClose,
  onSaved,
}: {
  deck: DeckSummary;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [playmatUrl, setPlaymatUrl] = useState(deck.playmatUrl ?? '');
  const [cardBackUrl, setCardBackUrl] = useState(deck.cardBackUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Un champ vide vaut « aucun » : on envoie `null`, pas la chaîne vide, que
      // le schéma refuserait comme URL invalide.
      await api.patch(`/api/decks/${deck.id}`, {
        playmatUrl: playmatUrl.trim() || null,
        cardBackUrl: cardBackUrl.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dark-panel mt-4 w-full rounded p-5" data-test="deck-look">
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Tapis de jeu"
          hint="URL d'une image. Elle est chargée par votre navigateur, jamais par notre serveur."
          placeholder="https://exemple.org/tapis.jpg"
          value={playmatUrl}
          onChange={setPlaymatUrl}
        >
          <div className="mt-2 h-24 overflow-hidden rounded border border-[color:var(--site-floor-rule)] bg-[color:var(--site-floor)]">
            {playmatUrl.trim() ? (
              <img
                alt="Aperçu du tapis"
                className="h-full w-full object-cover"
                src={playmatUrl}
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
                onLoad={(event) => {
                  (event.currentTarget as HTMLImageElement).style.visibility = 'visible';
                }}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-[0.75rem] text-[color:var(--site-floor-dim)]">
                Tapis par défaut
              </p>
            )}
          </div>
        </Field>

        <Field
          label="Dos de carte"
          hint="Laissez vide pour le dos par défaut."
          placeholder="https://exemple.org/dos.jpg"
          value={cardBackUrl}
          onChange={setCardBackUrl}
        >
          <div className="mt-2 flex h-24 items-center justify-center rounded border border-[color:var(--site-floor-rule)] bg-[color:var(--site-floor)]">
            <div style={{ width: 62, height: 86 }}>
              <CardBack url={cardBackUrl.trim() || null} version="small" />
            </div>
          </div>
        </Field>
      </div>

      {error && (
        <p className="mt-4 border-2 border-[color:var(--site-alarm-floor)]/70 px-3 py-2 text-[0.85rem] text-[color:var(--site-alarm-floor)]" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          className="ink-button px-5 py-2.5 text-[0.78rem]"
          disabled={busy}
          onClick={() => void save()}
          type="button"
        >
          {busy ? 'Envoi…' : 'Enregistrer'}
        </button>
        <button className="floor-button px-4 py-2.5 text-[0.72rem]" onClick={onClose} type="button">
          Annuler
        </button>
        <p className="ml-auto text-[0.78rem] text-[color:var(--site-floor-dim)]">
          Appliqué à votre zone au chargement du deck.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  placeholder,
  value,
  onChange,
  children,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="sign-sm block text-[0.68rem] text-[color:var(--site-floor-dim)]">{label}</span>
      <input
        className="dark-field mt-1.5 w-full rounded px-3 py-2 text-[0.85rem]"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="mt-1.5 block text-[0.76rem] leading-relaxed text-[color:var(--site-floor-dim)]">
        {hint}
      </span>
      {children}
    </label>
  );
}

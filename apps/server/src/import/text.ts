/**
 * Parseur de listes de decks en texte brut.
 *
 * Tolérant par construction : il avale les exports Moxfield, Archidekt, MTGO,
 * TappedOut et le texte tapé à la main. Il ne rejette jamais un document entier ;
 * une ligne qu'il ne sait pas lire est rangée dans `unparsed` et remonte dans le
 * rapport d'import avec sa ligne d'origine.
 */
import type { DeckZone, ParsedDeck, ParsedLine } from '@mtg/shared';

type SectionTarget = DeckZone | 'IGNORE';

const SECTIONS: Array<[RegExp, SectionTarget]> = [
  [/^commanders?$/i, 'COMMANDER'],
  [/^commander\s*\/\s*planeswalker$/i, 'COMMANDER'],
  [/^(deck|mainboard|main\s*deck|main|creatures?|lands?|spells?|artifacts?|enchantments?|instants?|sorceries|planeswalkers?|other)$/i, 'MAIN'],
  [/^(sideboard|side\s*board|sb)$/i, 'SIDEBOARD'],
  [/^companions?$/i, 'SIDEBOARD'],
  [/^(maybeboard|maybe\s*board|considering|acquire)$/i, 'IGNORE'],
  [/^tokens?$/i, 'IGNORE'],
];

/** Lignes de pied de liste que les exports ajoutent et qui ne sont pas des cartes. */
const NOISE = /^(total|deck\s*size|cards?\s*total|sideboard\s*total|about|layout)\b.*[:=]/i;

const NAME_PREFIX = /^(?:\/\/\s*)?(?:deck\s*)?name\s*[:=]\s*(.+)$/i;

/** `SB:`, `MB:`, `CMDR:` en tête de ligne (MTGO, exports anciens). */
const LINE_ZONE_PREFIX = /^(SB|MB|CMDR|COMMANDER)\s*:\s*/i;

/** `12 `, `12x `, `x12 ` — la quantité est optionnelle. */
const QUANTITY = /^(?:(\d{1,4})\s*[xX]?|[xX]\s*(\d{1,4}))[\s.)-]+/;

/** `(C21) 263`, `(neo) 123a`, `(PLST) ELD-142` en fin de ligne. */
const SET_AND_NUMBER = /\((?<set>[A-Za-z0-9]{2,6})\)\s*(?<num>[A-Za-z0-9★†*+-]{1,12})?\s*$/;

/** Annotations de fin de ligne, retirées une par une, de droite à gauche. */
const TRAILING_ANNOTATIONS: Array<{ re: RegExp; flag?: 'FOIL' | 'COMMANDER' }> = [
  { re: /\s*\*(?<v>[A-Za-z]{1,8})\*$/ }, // *F*, *E*, *CMDR* — géré via le groupe `v`
  { re: /\s*\[[^\]]*\]$/ }, // catégories Archidekt : [Ramp{top}]
  { re: /\s*\^[^^]*\^$/ }, // marqueurs de couleur Moxfield : ^Red^
  { re: /\s*<[^>]*>$/ },
  { re: /\s*#[^\s#]+$/ }, // hashtags de fin
  { re: /\s*\((?:foil|etched|non-?foil)\)$/i, flag: 'FOIL' },
];

const STAR_FLAGS: Record<string, 'FOIL' | 'COMMANDER' | undefined> = {
  f: 'FOIL',
  foil: 'FOIL',
  e: 'FOIL', // etched
  etched: 'FOIL',
  cmdr: 'COMMANDER',
  commander: 'COMMANDER',
};

interface LineFlags {
  isFoil: boolean;
  forceZone?: DeckZone;
}

function stripAnnotations(input: string): { text: string; flags: LineFlags } {
  let text = input;
  const flags: LineFlags = { isFoil: false };
  let changed = true;

  while (changed) {
    changed = false;
    for (const { re, flag } of TRAILING_ANNOTATIONS) {
      const m = re.exec(text);
      if (!m) continue;

      const star = m.groups?.['v']?.toLowerCase();
      if (star !== undefined) {
        const resolved = STAR_FLAGS[star];
        // Une annotation `*…*` inconnue n'est pas retirée : ce peut être un nom.
        if (resolved === undefined) continue;
        if (resolved === 'FOIL') flags.isFoil = true;
        if (resolved === 'COMMANDER') flags.forceZone = 'COMMANDER';
      } else if (flag === 'FOIL' && !/non-?foil/i.test(m[0])) {
        flags.isFoil = true;
      }

      text = text.slice(0, m.index).trimEnd();
      changed = true;
    }
  }
  return { text, flags };
}

function matchSection(candidate: string): SectionTarget | null {
  const cleaned = candidate
    .replace(/^[/#*\s-]+/, '')
    .replace(/[:：]\s*$/, '')
    .replace(/\s*\(\s*\d+\s*\)\s*$/, '') // « Commander (1) »
    .replace(/\s*\d+\s*$/, '') // « Sideboard 15 »
    .trim();
  if (!cleaned) return null;

  for (const [re, target] of SECTIONS) {
    if (re.test(cleaned)) return target;
  }
  return null;
}

export interface ParseOptions {
  /** Zone par défaut, utile quand on reparse un bloc déjà situé. */
  defaultZone?: DeckZone;
}

export function parseDeckText(input: string, options: ParseOptions = {}): ParsedDeck {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const parsed: ParsedLine[] = [];
  const unparsed: ParsedDeck['unparsed'] = [];

  let zone: DeckZone = options.defaultZone ?? 'MAIN';
  let ignoring = false;
  let deckName: string | undefined;

  // MTGO sépare la réserve par une ligne vide, sans en-tête. On ne bascule que si
  // le document n'utilise nulle part d'en-têtes de section explicites.
  const hasExplicitSections = lines.some((l) => matchSection(l) !== null);
  let blankSeen = false;
  let sideboardBySpacing = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const lineNumber = i + 1;
    const trimmed = raw.trim();

    if (!trimmed) {
      if (!hasExplicitSections && parsed.length > 0) blankSeen = true;
      continue;
    }

    const nameMatch = NAME_PREFIX.exec(trimmed);
    if (nameMatch?.[1] && !deckName) {
      deckName = nameMatch[1].trim();
      continue;
    }

    const section = matchSection(trimmed);
    if (section !== null) {
      if (section === 'IGNORE') {
        ignoring = true;
      } else {
        ignoring = false;
        zone = section;
      }
      continue;
    }

    // Commentaire : `//` ou `#` en début de ligne uniquement. Un `//` au milieu
    // d'une ligne est un séparateur de carte recto-verso, pas un commentaire.
    if (/^(\/\/|#)/.test(trimmed)) continue;
    if (NOISE.test(trimmed)) continue;
    if (ignoring) continue;

    let body = trimmed;
    let lineZone: DeckZone | undefined;

    const zonePrefix = LINE_ZONE_PREFIX.exec(body);
    if (zonePrefix) {
      const tag = (zonePrefix[1] ?? '').toUpperCase();
      lineZone = tag === 'SB' ? 'SIDEBOARD' : tag === 'MB' ? 'MAIN' : 'COMMANDER';
      body = body.slice(zonePrefix[0].length).trim();
    }

    let quantity = 1;
    const qty = QUANTITY.exec(body);
    if (qty) {
      quantity = Number.parseInt(qty[1] ?? qty[2] ?? '1', 10);
      body = body.slice(qty[0].length).trim();
    }

    const { text: withoutAnnotations, flags } = stripAnnotations(body);
    body = withoutAnnotations;

    let setCode: string | undefined;
    let collectorNumber: string | undefined;
    const printing = SET_AND_NUMBER.exec(body);
    if (printing?.groups) {
      setCode = printing.groups['set']?.toLowerCase();
      collectorNumber = printing.groups['num'];
      body = body.slice(0, printing.index).trimEnd();
    }

    // Une deuxième passe attrape `1 Sol Ring (C21) 263 *F*` où l'annotation
    // suivait l'édition.
    const second = stripAnnotations(body);
    body = second.text;
    if (second.flags.isFoil) flags.isFoil = true;
    if (second.flags.forceZone) flags.forceZone = second.flags.forceZone;

    const name = body.replace(/^["']|["']$/g, '').trim();

    if (!name || !/\p{L}/u.test(name)) {
      unparsed.push({ raw, lineNumber, reason: 'Aucun nom de carte identifiable' });
      continue;
    }
    if (quantity < 1 || quantity > 1000) {
      unparsed.push({ raw, lineNumber, reason: `Quantité invalide : ${quantity}` });
      continue;
    }

    if (!hasExplicitSections && blankSeen && !sideboardBySpacing) {
      sideboardBySpacing = true;
      zone = 'SIDEBOARD';
    }

    const entry: ParsedLine = {
      raw,
      lineNumber,
      quantity,
      name,
      isFoil: flags.isFoil,
      zone: flags.forceZone ?? lineZone ?? zone,
    };
    if (setCode) entry.setCode = setCode;
    if (collectorNumber) entry.collectorNumber = collectorNumber;

    parsed.push(entry);
  }

  const out: ParsedDeck = { lines: parsed, unparsed };
  if (deckName) out.name = deckName;
  return out;
}

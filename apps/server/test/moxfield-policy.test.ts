/**
 * Politique d'appel Moxfield. Testée à part de tout réseau et de toute base :
 * ce qui compte ici est la décision, pas le transport.
 *
 * Référence : docs/moxfield.md §3.1 et §4 — notre accès est nominatif et
 * révocable, un refus ne se retente pas, un `Retry-After` se respecte.
 */
import { describe, expect, it } from 'vitest';
import {
  MOXFIELD_DEFAULT_COOLDOWN_MS,
  MOXFIELD_MAX_COOLDOWN_MS,
  MoxfieldGate,
  classifyMoxfieldStatus,
  retryAfterMs,
} from '../src/import/moxfield-policy.js';

describe('Retry-After', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');

  it('lit une durée en secondes', () => {
    expect(retryAfterMs('30', now)).toBe(30_000);
  });

  it('lit une date HTTP', () => {
    expect(retryAfterMs('Tue, 15 Sep 2026 12:02:00 GMT', now)).toBe(120_000);
  });

  it('retombe sur la pause par défaut quand l’en-tête est absent ou illisible', () => {
    for (const header of [null, undefined, '', '   ', 'bientôt']) {
      expect(retryAfterMs(header, now)).toBe(MOXFIELD_DEFAULT_COOLDOWN_MS);
    }
  });

  it('ignore une date déjà passée ou une durée nulle', () => {
    expect(retryAfterMs('Tue, 15 Sep 2026 11:59:00 GMT', now)).toBe(MOXFIELD_DEFAULT_COOLDOWN_MS);
    expect(retryAfterMs('0', now)).toBe(MOXFIELD_DEFAULT_COOLDOWN_MS);
    expect(retryAfterMs('-5', now)).toBe(MOXFIELD_DEFAULT_COOLDOWN_MS);
  });

  it('plafonne une valeur fantaisiste', () => {
    // Une semaine de pause demandée par un intermédiaire mal configuré ne doit
    // pas geler l'import jusqu'au redémarrage.
    expect(retryAfterMs('604800', now)).toBe(MOXFIELD_MAX_COOLDOWN_MS);
  });
});

describe('classification des réponses', () => {
  it('distingue les quatre cas qui comptent', () => {
    expect(classifyMoxfieldStatus(404, null)).toEqual({ kind: 'NOT_FOUND' });
    expect(classifyMoxfieldStatus(403, null)).toEqual({ kind: 'REVOKED' });
    // 401 est le même refus d'identité que 403 : insister n'a pas de sens.
    expect(classifyMoxfieldStatus(401, null)).toEqual({ kind: 'REVOKED' });
    expect(classifyMoxfieldStatus(429, '12')).toEqual({ kind: 'RATE_LIMITED', retryAfterMs: 12_000 });
    expect(classifyMoxfieldStatus(500, null)).toEqual({ kind: 'UPSTREAM' });
    expect(classifyMoxfieldStatus(418, null)).toEqual({ kind: 'UPSTREAM' });
  });
});

describe('portillon d’accès', () => {
  it('est ouvert au départ', () => {
    expect(new MoxfieldGate().state(1000)).toEqual({ open: true });
  });

  it('se ferme définitivement sur un refus d’autorisation', () => {
    const gate = new MoxfieldGate();
    gate.note({ kind: 'REVOKED' }, 1000);

    expect(gate.isRevoked).toBe(true);
    // Et le temps ne rouvre rien : la réouverture passe par l'opérateur.
    expect(gate.state(1000 + MOXFIELD_MAX_COOLDOWN_MS * 10)).toEqual({ open: false, reason: 'REVOKED' });
  });

  it('se ferme le temps demandé sur un 429, puis se rouvre', () => {
    const gate = new MoxfieldGate();
    gate.note({ kind: 'RATE_LIMITED', retryAfterMs: 30_000 }, 1_000);

    expect(gate.state(1_000)).toEqual({ open: false, reason: 'COOLDOWN', until: 31_000 });
    expect(gate.state(30_999)).toEqual({ open: false, reason: 'COOLDOWN', until: 31_000 });
    expect(gate.state(31_000)).toEqual({ open: true });
  });

  it('garde la pause la plus longue quand deux 429 se suivent', () => {
    const gate = new MoxfieldGate();
    gate.note({ kind: 'RATE_LIMITED', retryAfterMs: 60_000 }, 1_000);
    gate.note({ kind: 'RATE_LIMITED', retryAfterMs: 5_000 }, 2_000);

    expect(gate.state(10_000)).toEqual({ open: false, reason: 'COOLDOWN', until: 61_000 });
  });

  it('ne se ferme ni sur un 404 ni sur une panne', () => {
    const gate = new MoxfieldGate();
    gate.note({ kind: 'NOT_FOUND' }, 1_000);
    gate.note({ kind: 'UPSTREAM' }, 1_000);

    expect(gate.state(1_000)).toEqual({ open: true });
  });
});

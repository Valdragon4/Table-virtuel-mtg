/**
 * Quand sert-on le cache Archidekt, et quand va-t-on relire ?
 *
 * La question n'est pas théorique : servir le cache à une **resynchronisation**
 * revenait à répondre « c'est fait » sans avoir rien relu. Un joueur qui change
 * l'édition d'une carte chez Archidekt puis resynchronise dans la foulée
 * récupérait sa liste d'avant, impressions comprises, pendant un quart d'heure.
 */
import { describe, expect, it } from 'vitest';

process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const { shouldServeCache } = await import('../src/import/archidekt.js');

const TTL = 900_000; // le défaut : quinze minutes
const MAINTENANT = 1_000_000_000_000;

describe('cache Archidekt', () => {
  it('sert un cache récent à un import ordinaire', () => {
    const recent = new Date(MAINTENANT - 60_000);
    expect(shouldServeCache(recent, TTL, MAINTENANT, false)).toBe(true);
  });

  it('va relire quand le cache a dépassé sa durée de vie', () => {
    const vieux = new Date(MAINTENANT - TTL - 1);
    expect(shouldServeCache(vieux, TTL, MAINTENANT, false)).toBe(false);
  });

  it('va relire pour une resynchronisation, même avec un cache tout frais', () => {
    /*
     * Le cœur du correctif. Une resynchronisation est une demande explicite :
     * l'utilisateur vient nous dire d'aller voir. La politesse envers Archidekt
     * est assurée par la file plafonnée, qui limite le débit — elle n'exige pas
     * qu'on refuse de relire.
     */
    const aLInstant = new Date(MAINTENANT - 1_000);
    expect(shouldServeCache(aLInstant, TTL, MAINTENANT, true)).toBe(false);
  });

  it('va chercher quand il n’y a aucun cache', () => {
    expect(shouldServeCache(null, TTL, MAINTENANT, false)).toBe(false);
  });
});

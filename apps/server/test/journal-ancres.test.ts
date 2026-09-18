/**
 * Les ancres d'une ligne de journal : ce qui sort, ce qui ne sort pas, et le
 * fait qu'on en dise **la même chose en direct et au rattrapage**.
 *
 * Une ancre est un `ObjectId`, pas une identité. La question n'est donc pas « la
 * table peut-elle lire cette carte ? » — c'est le texte qui y répond, via
 * `publicName` — mais « chaque siège détient-il déjà cet identifiant ? ». Deux
 * réponses, selon la zone (§2.1) :
 *
 * - zone énumérable : l'objet est dans le snapshot de tout le monde, identité
 *   masquée ou non. Son identifiant ne révèle rien ;
 * - bibliothèque : l'identifiant n'y est publié à personne, et le corréler
 *   avant/après révélerait l'ordre. Il ne sort que si **tous** les sièges
 *   connaissent l'identité — c'est-à-dire quand le serveur la leur a déjà
 *   remise.
 *
 * Le filtre ne posait que la première question et s'y tenait pour les deux
 * zones, ce qui le rendait faux dans les deux sens à la fois : il retirait du
 * wire des ancres que toute la table venait de recevoir, et il ne s'appliquait
 * pas du tout à `state.log`, donc pas à `logTail`, donc pas au snapshot.
 *
 * Tout se lit sur les **frames brutes de Bob** et sur **son snapshot**, jamais
 * sur `room.state` : le journal est recopié à l'identique chez tout le monde
 * (§5.4), et la seule mesure honnête est ce qui traverse son socket.
 */
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '@mtg/shared';
import { getZone } from '../src/game/state.js';
import { twoSeatTable, type FakeConnection } from './fixture.js';

/** Le journal tel que Bob le reçoit en direct. */
function journalRecu(conn: FakeConnection): { text: string; cardIds: string[] }[] {
  return conn.frames
    .map((f) => JSON.parse(f) as { t: string })
    .filter((m): m is ServerEvent => m.t === 'event')
    .flatMap((e) => (e.log ? [e.log] : []));
}

describe('une ancre est publique ou n’est pas', () => {
  it('rend au direct les ancres d’une révélation publique, et dit la même chose au rattrapage', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');
    t.b.frames.length = 0;

    // Mode `REVEAL` : les quatre cartes du dessus sont montrées à toute la
    // table, identifiant compris, par `LOOK_STARTED`. Elles sont en
    // bibliothèque, mais tout le monde les connaît.
    await t.room.handleIntent(t.a, 'look', {
      type: 'LOOK',
      zone: { seat: 'seat_0', kind: 'LIBRARY' },
      count: 4,
      mode: 'REVEAL',
    });

    const look = [...t.room.state.pendingLooks.values()][0]!;
    for (const id of look.cardIds) {
      expect(t.room.state.objects.get(id)!.knownTo.has('seat_1')).toBe(true);
    }

    const direct = journalRecu(t.b).find((l) => l.text.includes('a révélé les 4 cartes'));
    expect(direct).toBeDefined();
    // Le filtre par zone les retirait toutes : Bob lisait quatre noms dans la
    // phrase et n'avait aucune ancre pour les surligner sur la table.
    expect(direct!.cardIds).toEqual([...look.cardIds]);

    // Et le rattrapage dit **exactement** la même chose : une ligne ne doit pas
    // être plus riche au snapshot qu'en direct, ni l'inverse.
    const rattrapage = t.room
      .snapshotFor('seat_1')
      .logTail.find((e) => e.text.includes('a révélé les 4 cartes'))!;
    expect(rattrapage.cardIds).toEqual(direct!.cardIds);
  });

  it('ne laisse sortir l’ancre d’un objet de bibliothèque secret ni au wire, ni au snapshot', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');

    // Une carte du fond de la bibliothèque d'Alice : personne ne la connaît,
    // Alice comprise (§5.2 — l'entrée en bibliothèque est l'unique effacement).
    const secret = getZone(t.room.state, { seat: 'seat_0', kind: 'LIBRARY' }).at(-1)!;
    expect([...t.room.state.objects.get(secret)!.knownTo]).toEqual([]);

    t.b.frames.length = 0;
    /*
     * On émet directement, sans passer par un intent.
     *
     * C'est volontaire : la garde vit dans `commit`, qui est le passage obligé
     * de **toute** émission, et c'est là qu'elle doit tenir — y compris pour un
     * intent qui n'existe pas encore. Aucun intent d'aujourd'hui ne produit
     * cette ancre ; le jour où l'un d'eux le ferait, ce test est ce qui
     * l'arrête.
     */
    t.room.commit(null, [
      {
        audience: { kind: 'ALL' },
        build: () => ({ type: 'NOTED' }),
        log: { text: 'Ligne de contrôle', cardIds: [secret] },
      },
    ]);

    // Ni dans la frame directe…
    const direct = journalRecu(t.b).find((l) => l.text === 'Ligne de contrôle')!;
    expect(direct.cardIds).toEqual([]);
    expect(t.b.frames.join('\n')).not.toContain(secret);

    // …ni dans le rattrapage, qui est le trou que le filtre du wire ne bouchait
    // pas : `state.log` n'était pas filtré du tout, et `logTail` le recopie
    // dans le snapshot de chaque siège.
    for (const seat of ['seat_0', 'seat_1']) {
      const ligne = t.room.snapshotFor(seat).logTail.find((e) => e.text === 'Ligne de contrôle')!;
      expect(ligne.cardIds).toEqual([]);
      expect(JSON.stringify(t.room.snapshotFor(seat).logTail)).not.toContain(secret);
    }
  });

  it('garde l’ancre d’une carte posée face cachée : son identifiant est public', async () => {
    const t = twoSeatTable();
    t.room.startGame('seat_0');

    const carte = getZone(t.room.state, { seat: 'seat_0', kind: 'HAND' })[0]!;
    t.b.frames.length = 0;
    await t.room.handleIntent(t.a, 'fd', {
      type: 'MOVE_CARD',
      cardId: carte,
      to: { seat: 'seat_0', kind: 'BATTLEFIELD' },
      x: 2,
      y: 2,
      faceDown: true,
    });

    // Bob ne sait pas **ce que c'est** — le texte dit « une carte », et c'est
    // `publicName` qui en décide. Mais il a reçu l'objet, identifiant en clair,
    // par son `CARD_MOVED` : lui retirer l'ancre ferait perdre le surlignage
    // sans rien protéger. Le critère porte sur l'identifiant, pas sur l'identité.
    expect(t.room.state.objects.get(carte)!.knownTo.has('seat_1')).toBe(false);
    const direct = journalRecu(t.b).find((l) => l.text.includes('vers champ de bataille'))!;
    expect(direct.text).toContain('une carte');
    expect(direct.cardIds).toEqual([carte]);

    const rattrapage = t.room
      .snapshotFor('seat_1')
      .logTail.find((e) => e.text.includes('vers champ de bataille'))!;
    expect(rattrapage.cardIds).toEqual(direct.cardIds);
  });
});

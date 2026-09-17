/**
 * Ce qu'un email doit tenir.
 *
 * Ces tests ne jugent pas du goût : ils verrouillent les contraintes propres au
 * courrier, celles qu'on ne voit pas en regardant un rendu dans un navigateur
 * et qui cassent chez un client sur deux.
 */
import { describe, expect, it } from 'vitest';

/*
 * `env` valide la configuration au chargement du module et refuse de se charger
 * sans elle. Ces variables sont posées avant l'import pour que le test tienne
 * seul, sans fichier `.env` ni service externe.
 */
process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const { duplicateSignupMail, resetMail, verificationMail } = await import('../src/auth/mail.js');

const MAILS = [
  ['verification', verificationMail('joueur@exemple.fr', 'jeton-1')],
  ['reinitialisation', resetMail('joueur@exemple.fr', 'jeton-2')],
  ['inscription en double', duplicateSignupMail('joueur@exemple.fr')],
] as const;

describe('emails transactionnels', () => {
  for (const [nom, mail] of MAILS) {
    describe(nom, () => {
      it('porte les deux corps', () => {
        // Le texte n'est pas optionnel : certains clients ne lisent que lui, et
        // un message sans version texte part plus volontiers en indésirable.
        expect(mail.text.length).toBeGreaterThan(40);
        expect(mail.html).toContain('<!doctype html>');
      });

      it('a un lien réellement cliquable, et recopiable', () => {
        const liens = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
        expect(liens.length).toBeGreaterThan(1);
        /*
         * La propriété qui compte : **l'URL d'action est à la fois un `href` et
         * un texte visible**. Un client qui mange le bouton ne doit pas laisser
         * l'utilisateur sans recours — il doit pouvoir la recopier.
         */
        const recopiable = liens.find((l) => mail.html.includes(`>${l}</a>`));
        expect(recopiable, `aucun lien recopiable parmi ${liens.join(', ')}`).toBeDefined();
        expect(recopiable).toContain('http://localhost:3000');
        // Et la version texte la porte entière.
        expect(mail.text).toContain('http://localhost:3000');
      });

      it('ne compte sur aucune feuille de style', () => {
        /*
         * Gmail tronque, Outlook ignore, et beaucoup de clients retirent
         * purement et simplement un `<style>`. Tout doit être en ligne : une
         * seule classe ici et la mise en page tombe chez le destinataire, sans
         * qu'on le sache jamais.
         */
        expect(mail.html).not.toMatch(/<style/i);
        expect(mail.html).not.toMatch(/\sclass=/i);
      });

      it('n’affiche pas le logo en SVG', () => {
        // Gmail et Outlook suppriment les `<svg>` sans rien mettre à la place.
        expect(mail.html).not.toMatch(/<svg/i);
      });

      it('ne met aucune information dans une image', () => {
        /*
         * La plupart des clients bloquent les images distantes par défaut. Le
         * nom du produit doit donc être écrit en toutes lettres à côté du logo,
         * et le logo lui-même porter un `alt` vide — décoratif, rien de plus.
         */
        expect(mail.html).toContain('Table virtuelle');
        expect(mail.html).toMatch(/<img[^>]+alt=""/);
      });

      it('charge le logo depuis une adresse absolue', () => {
        // Un chemin relatif ne veut rien dire dans une boîte mail.
        expect(mail.html).toMatch(/src="https?:\/\/[^"]+\/icon-192\.png"/);
      });
    });
  }

  it('échappe ce qui vient du jeton', () => {
    const mail = resetMail('joueur@exemple.fr', 'a"b<c>');
    expect(mail.html).not.toContain('a"b<c>');
    // Encodé dans l'URL, donc jamais rendu tel quel dans un attribut.
    expect(mail.html).toContain('a%22b%3Cc%3E');
  });
});

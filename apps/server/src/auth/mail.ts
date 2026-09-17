/**
 * Envoi d'emails transactionnels. Sans SMTP_URL configuré, les messages sont
 * écrits dans les logs : le développement ne dépend d'aucun service externe.
 *
 * Chaque message part en **deux corps** : le HTML de `mailTemplate`, et un
 * texte simple. Le texte n'est pas un repli négligeable — voir `Mail`.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';
import { renderMail } from './mailTemplate.js';

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!env.SMTP_URL) return null;
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

export interface Mail {
  to: string;
  subject: string;
  /**
   * La version texte. Ce n'est pas un repli négligeable : les filtres
   * anti-spam se méfient d'un message qui n'en a pas, et certains clients ne
   * lisent qu'elle. Elle porte donc l'URL en clair, complète.
   */
  text: string;
  html: string;
}

export async function sendMail(mail: Mail, log: { info: (msg: string) => void }): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    log.info(`[mail non envoyé, SMTP_URL absent] à ${mail.to} — ${mail.subject}\n${mail.text}`);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
}

export function verificationMail(to: string, token: string): Mail {
  const url = `${env.PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const footnote =
    "Ce lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : aucun compte ne sera activé.";
  return {
    to,
    subject: 'Confirmez votre adresse email',
    text: `Bienvenue.\n\nConfirmez votre adresse en ouvrant ce lien :\n${url}\n\n${footnote}`,
    html: renderMail({
      preheader: 'Une dernière étape : confirmez votre adresse.',
      title: 'Confirmez votre adresse',
      body: [
        'Bienvenue. Il reste une étape avant de pouvoir enregistrer vos decks et retrouver vos tables.',
      ],
      action: { label: 'Confirmer mon adresse', url },
      footnote,
      publicUrl: env.PUBLIC_URL,
    }),
  };
}

export function resetMail(to: string, token: string): Mail {
  const url = `${env.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const footnote =
    "Ce lien expire dans 1 heure et ne fonctionne qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.";
  return {
    to,
    subject: 'Réinitialisation de votre mot de passe',
    text: `Ouvrez ce lien pour choisir un nouveau mot de passe :\n${url}\n\n${footnote}`,
    html: renderMail({
      preheader: 'Choisissez un nouveau mot de passe.',
      title: 'Nouveau mot de passe',
      body: [
        'Vous avez demandé à réinitialiser votre mot de passe. Le lien ci-dessous vous mène au formulaire.',
      ],
      action: { label: 'Choisir un mot de passe', url },
      footnote,
      publicUrl: env.PUBLIC_URL,
    }),
  };
}

/**
 * Adresse déjà inscrite.
 *
 * On répond comme pour un succès et l'on prévient le titulaire, plutôt que de
 * confirmer l'existence du compte à celui qui tente. Le message n'a donc pas
 * de lien à usage unique : il renvoie à la connexion, qui est publique.
 */
export function duplicateSignupMail(to: string): Mail {
  const url = `${env.PUBLIC_URL}/login`;
  const footnote =
    "Si ce n'était pas vous, il n'y a rien à faire : aucun compte n'a été créé, et le vôtre n'a pas bougé.";
  return {
    to,
    subject: 'Tentative de création de compte avec votre adresse',
    text: `Quelqu'un a tenté de créer un compte avec cette adresse, qui en a déjà un.\n\nSi c'était vous, connectez-vous ou utilisez « mot de passe oublié » :\n${url}\n\n${footnote}`,
    html: renderMail({
      preheader: 'Cette adresse a déjà un compte.',
      title: 'Cette adresse a déjà un compte',
      body: [
        "Quelqu'un vient d'essayer de créer un compte avec cette adresse. Elle en a déjà un, nous n'avons donc rien changé.",
        "Si c'était vous, connectez-vous. Si vous avez oublié votre mot de passe, le formulaire de connexion propose de le réinitialiser.",
      ],
      action: { label: 'Se connecter', url },
      footnote,
      publicUrl: env.PUBLIC_URL,
    }),
  };
}

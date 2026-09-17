/**
 * Routes d'authentification.
 *
 * Principe tenu partout : aucune réponse ne révèle si une adresse est connue.
 * /register, /forgot et /login renvoient la même chose qu'un compte existe ou non.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authAttempts } from '../lib/throttle.js';
import { fakeVerify, hashPassword, verifyPassword } from './password.js';
import { duplicateSignupMail, resetMail, sendMail, verificationMail } from './mail.js';
import {
  clearSessionCookie,
  createSession,
  destroyAllSessions,
  destroySession,
  readSessionToken,
  setSessionCookie,
} from './session.js';
import { requireUser } from './guard.js';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const emailSchema = z.string().email().max(254).transform((v) => v.trim().toLowerCase());
const passwordSchema = z
  .string()
  .min(10, 'Au moins 10 caractères.')
  .max(200, 'Au plus 200 caractères.');
const displayNameSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\p{N}_ -]+$/u, 'Lettres, chiffres, espaces, tirets et underscores uniquement.');

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
const loginSchema = z.object({ email: emailSchema, password: z.string().max(200) });
const tokenSchema = z.object({ token: z.string().min(10).max(200) });
const resetSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });

function issueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/** Message unique pour tout échec d'identifiants : pas d'énumération de comptes. */
const GENERIC_LOGIN_ERROR = { error: 'BAD_CREDENTIALS', message: 'Identifiants invalides.' };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });
    }
    const { email, password, displayName } = body.data;

    if (!authAttempts.take(`register:${request.ip}`)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', retryAfter: authAttempts.retryAfter(`register:${request.ip}`) });
    }

    const nameTaken = await prisma.user.findUnique({ where: { displayName } });
    if (nameTaken) {
      // Le pseudo est public : le refuser explicitement n'apprend rien de secret.
      return reply.code(409).send({ error: 'NAME_TAKEN', message: 'Ce pseudo est déjà pris.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Adresse déjà inscrite : on répond comme pour un succès et on prévient
      // le titulaire par email, plutôt que de confirmer son existence.
      await sendMail(duplicateSignupMail(email), request.log);
      return reply.code(201).send({ ok: true, emailVerificationRequired: true });
    }

    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: await hashPassword(password),
        prefs: { create: {} },
      },
    });

    const { token, hash } = issueToken();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      },
    });
    await sendMail(verificationMail(email, token), request.log);

    return reply.code(201).send({ ok: true, emailVerificationRequired: true });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(GENERIC_LOGIN_ERROR);
    const { email, password } = body.data;

    // Deux plafonds : par IP contre le balayage, par compte contre le bourrinage ciblé.
    for (const key of [`login-ip:${request.ip}`, `login-user:${email}`]) {
      if (!authAttempts.take(key)) {
        return reply.code(429).send({ error: 'RATE_LIMITED', retryAfter: authAttempts.retryAfter(key) });
      }
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await fakeVerify(password);
      return reply.code(401).send(GENERIC_LOGIN_ERROR);
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send(GENERIC_LOGIN_ERROR);
    }

    authAttempts.reset(`login-user:${email}`);
    const token = await createSession(user.id, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    setSessionCookie(reply, token);
    await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

    return reply.send({
      ok: true,
      user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerifiedAt !== null },
    });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(readSessionToken(request));
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/verify-email', async (request, reply) => {
    const body = tokenSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_TOKEN' });

    const tokenHash = createHash('sha256').update(body.data.token).digest('hex');
    const record = await prisma.authToken.findUnique({ where: { tokenHash } });
    if (!record || record.purpose !== 'EMAIL_VERIFY' || record.usedAt || record.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'INVALID_TOKEN', message: 'Lien invalide ou expiré.' });
    }

    await prisma.$transaction([
      prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/forgot', async (request, reply) => {
    const body = z.object({ email: emailSchema }).safeParse(request.body);
    // Réponse constante : on ne dit jamais si l'adresse existe.
    const answer = { ok: true };
    if (!body.success) return reply.send(answer);

    const key = `forgot:${request.ip}`;
    if (!authAttempts.take(key)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', retryAfter: authAttempts.retryAfter(key) });
    }

    const user = await prisma.user.findUnique({ where: { email: body.data.email } });
    if (user) {
      const { token, hash } = issueToken();
      await prisma.authToken.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash: hash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
      await sendMail(resetMail(user.email, token), request.log);
    }
    return reply.send(answer);
  });

  app.post('/api/auth/reset', async (request, reply) => {
    const body = resetSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'INVALID_INPUT', issues: body.error.issues });
    }

    const tokenHash = createHash('sha256').update(body.data.token).digest('hex');
    const record = await prisma.authToken.findUnique({ where: { tokenHash } });
    if (!record || record.purpose !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'INVALID_TOKEN', message: 'Lien invalide ou expiré.' });
    }

    await prisma.$transaction([
      prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hashPassword(body.data.password) },
      }),
    ]);
    // Un changement de mot de passe déconnecte partout : c'est le but de l'opération.
    await destroyAllSessions(record.userId);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/resend-verification', { preHandler: requireUser }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user || user.emailVerifiedAt) return reply.send({ ok: true });

    const key = `resend:${user.id}`;
    if (!authAttempts.take(key, 5)) {
      return reply.code(429).send({ error: 'RATE_LIMITED', retryAfter: authAttempts.retryAfter(key) });
    }

    const { token, hash } = issueToken();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      },
    });
    await sendMail(verificationMail(user.email, token), request.log);
    return reply.send({ ok: true });
  });
}

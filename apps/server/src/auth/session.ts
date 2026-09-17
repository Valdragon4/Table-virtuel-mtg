/**
 * Sessions opaques.
 *
 * Le cookie porte un jeton aléatoire ; la base ne stocke que son empreinte
 * SHA-256. Une fuite de la table `Session` ne permet donc pas de se connecter.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { env, isProd } from '../env.js';

export const SESSION_COOKIE = 'mtg_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** En-deçà de ce reste de vie, la session est prolongée à l'usage. */
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface SessionContext {
  userId: string;
  sessionId: string;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const token = newToken();
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
    },
  });
  return token;
}

export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const id = hashToken(token);
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }

  if (session.expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS) {
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return { userId: session.userId, sessionId: id };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.delete({ where: { id: hashToken(token) } }).catch(() => undefined);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE || isProd,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

/** Purge des sessions expirées, appelée périodiquement. */
export async function pruneSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

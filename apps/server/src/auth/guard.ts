import type { FastifyReply, FastifyRequest } from 'fastify';
import { readSessionToken, resolveSession } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Renseigné par `attachUser`, null pour un visiteur non connecté. */
    userId: string | null;
  }
}

/** Hook global : résout la session sans jamais refuser la requête. */
export async function attachUser(request: FastifyRequest): Promise<void> {
  const session = await resolveSession(readSessionToken(request));
  request.userId = session?.userId ?? null;
}

/** Pré-handler des routes qui exigent un compte. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.userId) {
    await reply.code(401).send({ error: 'AUTH_REQUIRED', message: 'Connexion requise.' });
  }
}

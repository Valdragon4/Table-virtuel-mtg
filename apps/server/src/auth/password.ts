import { hash, verify } from '@node-rs/argon2';

/**
 * Paramètres Argon2id. 19 Mio et 2 passes : le compromis recommandé par l'OWASP,
 * tenable sur un VPS modeste avec plusieurs connexions simultanées.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, OPTIONS);
  } catch {
    // Empreinte illisible : on refuse, sans distinguer le cas côté appelant.
    return false;
  }
}

/**
 * Hachage factice, exécuté quand l'email est inconnu, pour que le temps de
 * réponse de /login ne révèle pas l'existence d'un compte.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Pn7QFQ0z3xNQeQyJmYQ9sV3mZ0kqQ0Yv8sYQqPqZ1kI';

export async function fakeVerify(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}

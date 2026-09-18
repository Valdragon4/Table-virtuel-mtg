/**
 * La garde d'administration. Elle est **serveur**, elle est sur **chaque**
 * route, et rien d'autre ne compte.
 *
 * Masquer un lien dans l'interface n'est pas une protection : le client est
 * entre les mains de celui qu'on essaie d'arrêter. La seule chose qui protège
 * ces routes est ce pré-gestionnaire, et il est posé sur chacune d'elles sans
 * exception (`apps/server/test/admin-garde.test.ts` refuse la première route qui
 * l'oublierait).
 *
 * ——— Pourquoi 404 et pas 403
 *
 * La réponse est **la même** pour un visiteur, pour un compte connecté ordinaire
 * et pour une adresse retirée de `ADMIN_EMAILS` : `404 NOT_FOUND`, exactement
 * l'octet pour octet de la 404 générique que `app.ts` rend sur tout `/api`
 * inconnu. Un 401 dirait « connecte-toi » et un 403 dirait « tu es connecté mais
 * pas admin » — les deux confirment à celui qui sonde que la route existe, et le
 * second lui confirme même qu'il a trouvé la bonne adresse dans la mauvaise
 * boîte. Ici, sonder `/api/admin/*` ne rapporte rien de plus que sonder
 * `/api/nimportequoi`.
 *
 * Conséquence assumée : un administrateur dont la session a expiré voit une 404
 * et non « reconnecte-toi ». C'est le prix, et il est faible — la console le dit
 * en clair dans son écran vide.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveAdmin, type AdminIdentity } from './identity.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Renseigné par `requireAdmin`, et par lui seul. `null` partout ailleurs :
     * un gestionnaire qui le lit non nul a forcément traversé la garde.
     */
    admin: AdminIdentity | null;
  }
}

/**
 * La réponse unique de refus.
 *
 * Une constante plutôt qu'un littéral recopié : le jour où quelqu'un voudra
 * l'enrichir, il n'y aura pas deux variantes à distinguer pour un attaquant.
 */
export const ADMIN_DENIED = { error: 'NOT_FOUND' } as const;

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // `request.userId` vient du hook global `attachUser` : il vaut `null` pour un
  // visiteur, et `resolveAdmin` traite les deux cas de la même façon.
  const admin = await resolveAdmin(request.userId);
  if (!admin) {
    await reply.code(404).send(ADMIN_DENIED);
    return;
  }
  request.admin = admin;
}

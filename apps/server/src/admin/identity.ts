/**
 * Qui est administrateur, et pourquoi la réponse ne vient pas de la base.
 *
 * ——— La racine de confiance
 *
 * Un administrateur est une **adresse inscrite dans `ADMIN_EMAILS`**, rien
 * d'autre. Le fichier `.env` vit sur le serveur, n'est jamais transféré par le
 * déploiement, et porte déjà le secret de session et l'accès à la base : y
 * ajouter la liste des administrateurs n'élargit pas la surface de confiance,
 * elle réutilise celle qui existe.
 *
 * Ce que cela achète, et qu'une colonne `isAdmin` n'achèterait pas : **aucun
 * chemin d'écriture applicatif ne peut promouvoir quelqu'un**. Il n'y a pas de
 * route à garder, pas de `PATCH` à auditer, pas de faille d'injection à
 * craindre sur ce point précis — l'escalade de privilège est fermée par
 * construction plutôt que par vigilance. Le premier administrateur est
 * simplement le premier nom écrit dans le `.env` par la personne qui a déjà les
 * clés de la machine ; il n'y a donc jamais eu de « premier administrateur à
 * créer », et donc jamais de fenêtre pendant laquelle n'importe qui aurait pu
 * s'en emparer.
 *
 * ——— La vérification d'email n'est pas décorative
 *
 * Une adresse inscrite ici ne suffit pas : le compte doit aussi avoir **vérifié
 * son email** (`emailVerifiedAt`). Sans cette condition, quelqu'un qui devine ou
 * apprend une adresse d'administrateur pourrait s'inscrire avec elle avant son
 * propriétaire et hériter des droits sans jamais avoir eu accès à la boîte. La
 * contrainte d'unicité sur `User.email` rend la course gagnante pour le premier
 * arrivé, pas pour le légitime : c'est la vérification qui tranche.
 */
import { prisma } from '../db.js';
import { env } from '../env.js';

/** Minuscules et bords rognés : une liste se tape à la main, on ne punit pas une espace. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * La liste, lue une fois au chargement du module.
 *
 * Relire `process.env` à chaque requête donnerait l'illusion qu'on peut changer
 * la liste à chaud ; ce n'est pas vrai du reste de la configuration, et un
 * comportement à moitié dynamique est pire qu'un comportement franc. Modifier
 * `ADMIN_EMAILS` demande un redémarrage, comme changer `SESSION_SECRET`.
 */
const ADMINS: ReadonlySet<string> = new Set(
  env.ADMIN_EMAILS.split(',')
    .map(normalize)
    .filter((e) => e.length > 0),
);

/** Combien d'adresses sont déclarées. Utile au tableau de bord, jamais la liste. */
export function adminEmailCount(): number {
  return ADMINS.size;
}

/** Cette adresse est-elle déclarée administrateur ? Ne dit rien de la vérification. */
export function isAdminEmail(email: string): boolean {
  return ADMINS.has(normalize(email));
}

/** L'administrateur reconnu derrière une requête. */
export interface AdminIdentity {
  userId: string;
  email: string;
}

/**
 * Résout l'administrateur d'une session, ou `null`.
 *
 * Un seul point de décision, appelé par la garde : il n'existe pas de second
 * chemin qui répondrait « oui » selon une autre règle.
 */
export async function resolveAdmin(userId: string | null): Promise<AdminIdentity | null> {
  if (!userId) return null;
  // Liste blanche de colonnes explicite, jusqu'ici : on ne charge pas la ligne
  // entière pour décider d'un booléen, et surtout pas `passwordHash`.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user) return null;
  if (!isAdminEmail(user.email)) return null;
  // Voir l'en-tête : sans cette condition, s'inscrire avec l'adresse suffirait.
  if (user.emailVerifiedAt === null) return null;
  return { userId: user.id, email: normalize(user.email) };
}

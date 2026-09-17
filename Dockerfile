# Pas de directive `# syntax=` : elle obligerait BuildKit à télécharger son
# frontend depuis Docker Hub à chaque build, ce qui a déjà fait échouer un
# déploiement sur une simple panne de DNS. Rien ici n'a besoin d'une syntaxe
# récente — ni heredoc, ni `--mount` —, et l'image de base est déjà en cache
# sur le serveur : le build tient donc sans réseau.

# --- Étape 1 : dépendances ---------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm install --workspaces --include-workspace-root

# --- Étape 2 : build ---------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# npm remonte les dépendances des workspaces à la racine : un seul node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema apps/server/prisma/schema.prisma \
 && npm run build

# --- Étape 3 : exécution -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# openssl est requis par le moteur Prisma sur les images slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Le client Prisma vérifie qu'il peut écrire dans son dossier de moteurs au
# démarrage : sans ce chown, l'utilisateur `node` ne peut pas appliquer le schéma.
RUN chown -R node:node /app

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/server/dist/index.js"]

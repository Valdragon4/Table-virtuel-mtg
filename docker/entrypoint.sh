#!/bin/sh
# Prépare le schéma avant de démarrer. `docker compose up` sur une machine vierge
# doit suffire : aucune étape manuelle en dehors du fichier .env.
set -e

echo "→ Application du schéma Prisma"
npx --no-install prisma db push \
    --schema apps/server/prisma/schema.prisma \
    --skip-generate \
    --accept-data-loss

echo "→ Démarrage"
exec "$@"

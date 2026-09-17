# Tests de bout en bout

Ces tests tapent une pile réellement démarrée. Ils ne montent pas de faux serveur :
c'est précisément leur intérêt, puisqu'ils vérifient des propriétés réseau
(convergence entre clients, étanchéité des frames, resynchronisation).

## Préparer

```sh
cp .env.example .env            # puis renseigner SESSION_SECRET et les User-Agent
docker compose up -d postgres
npm install
npm run build
npm run db:migrate -w @mtg/server || npx prisma db push --schema apps/server/prisma/schema.prisma
npm run ingest -w @mtg/server   # télécharge le bulk Scryfall : compter 5 à 15 minutes
node apps/server/dist/index.js  # ou docker compose up
```

Une ingestion complète n'est nécessaire que pour les scénarios qui importent de
vrais decks. Les tests de protocole se contentent de quelques cartes.

## Lancer

```sh
npx playwright install chromium   # une fois
npx playwright test
```

Variables utiles :

| Variable | Rôle |
|---|---|
| `E2E_BASE_URL` | Adresse de la pile (défaut `http://localhost:3000`) |
| `E2E_ARCHIDEKT_DECKS` | URLs Archidekt séparées par des virgules, pour le scénario d'import |

Sans `E2E_ARCHIDEKT_DECKS`, le scénario à quatre joueurs utilise des listes
collées plutôt que des imports par URL : on ne tape pas un service tiers à chaque
exécution de la suite, et le chemin de collage est de toute façon le chemin
par défaut du produit.

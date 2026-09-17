# Import Moxfield : enquête sur aura0.app et sur la politique de Moxfield

Enquête menée le **15 septembre 2026**. Aucun code n'a été écrit ou modifié hors de ce
document. Aucune requête n'a été émise vers les endpoints internes de Moxfield, aucun
`User-Agent` n'a été forgé, aucun contournement n'a été testé.

**Résumé en une phrase** : aura0.app importe les decks Moxfield **depuis son propre
serveur**, via un endpoint maison `/api/deck-import` — ce n'est pas le navigateur du
joueur qui appelle Moxfield. On peut donc écarter l'hypothèse (b) ; entre l'accès
autorisé (a) et le contournement (c), **rien d'observable depuis l'extérieur ne permet
de trancher**, mais la procédure d'autorisation existe bel et bien chez Moxfield et
c'est la seule voie que nous devrions emprunter.

---

## 1. Ce que fait aura0.app

### 1.1 Ce qui a été observé

Toutes les observations datent du **15 septembre 2026, ~14h26–14h31 UTC**, avec Chromium
(Playwright) sur la page publique `https://aura0.app/`.

**a) Le bundle client.** La page est une SPA Vite ; tout le code client tient dans
`https://aura0.app/assets/index-DK_F6jfs.js` (1 898 773 octets, téléchargé le 15/09/2026).
Il contient une table des sources reconnues :

```js
{source:`archidekt`,domain:`archidekt.com`,…},
{source:`tappedout`,…},{source:`mtggoldfish`,…},{source:`edhrec`,…},
{source:`moxfield`,domain:`moxfield.com`,path:/^\/decks\/([A-Za-z0-9_-]+)\b/}
```

**b) Un seul appel réseau pour l'import, et il est de même origine.** Le bundle ne
contient **aucun appel à `moxfield.com`** ni à `api2.moxfield.com` : la seule occurrence
de `moxfield.com` côté client sert à reconstruire l'URL canonique du deck pour l'affichage.
L'import passe intégralement par :

```js
let s = `/api/deck-import?url=${encodeURIComponent(UNe(e))}`;
c = await fetch(s, {signal:t});
if (c.status === 429) { /* lecture du Retry-After, une seule nouvelle tentative */ }
```

**c) L'import Moxfield fonctionne réellement, et il est servi par aura0.** Requête émise
depuis la page aura0.app elle-même (c'est-à-dire exactement ce que fait leur interface) :

```
GET https://aura0.app/api/deck-import?url=https%3A%2F%2Fwww.moxfield.com%2Fdecks%2FOFOsgdmYqEuQKkJwsOmrpQ
→ 200, content-type: application/json; charset=utf-8, server: cloudflare, cf-ray a3b84f354c1e57ed-CDG
→ {"name":"Silverquill Influence Precon Decklist (2026)","source":"moxfield",
   "cards":[{"name":"Plains","quantity":8,"section":"main","setCode":"sos","collectorNumber":"273"},
            {"name":"Arcane Signet","quantity":1,"section":"main","setCode":"soc","collectorNumber":"127"}, …]}
```

Un import Archidekt témoin (`https://archidekt.com/decks/24569510`) emprunte exactement le
même endpoint et renvoie la même forme de données avec `"source":"archidekt"`.

**d) Zéro requête du navigateur vers Moxfield.** Pendant tout le chargement de la page et
pendant l'import, l'écouteur `page.on('request')` n'a enregistré **aucune** requête vers un
domaine `moxfield` — seulement `aura0.app`, `cards.scryfall.io`, PostHog, Google Analytics,
Cloudflare Turn et le challenge Cloudflare d'aura0 lui-même.

**e) Le vocabulaire d'erreur du client décrit un importeur serveur.** Le bundle contient
ces motifs, qui n'ont de sens que si c'est le backend d'aura0 qui parle à la source :

| motif | message |
| --- | --- |
| `deck_not_found` | « Aura couldn't find that deck on *X*. » |
| `deck_private` | « That deck is private on *X*, so Aura isn't allowed to read it. » |
| `source_rate_limited` | « *X* is asking Aura to slow down — it's seen too many requests at once. » |
| `source_unavailable` / `source_unreachable` | panne ou timeout côté source |
| `import_queue_busy` | « A lot of *X* decks are being imported right now… » |
| `source_not_configured` | « *X* imports aren't switched on **in this version of Aura**. » |
| `aura_unreachable` / `aura_error` | leur propre serveur |

Deux détails parlants : une **file d'attente** (`import_queue_busy`) et un **drapeau de
configuration par source** (`source_not_configured`) — exactement la forme de notre
`MOXFIELD_API_ENABLED`.

**f) La granularité des données suggère l'API JSON, pas du scraping HTML.** Chaque carte
porte `setCode` + `collectorNumber`, et les sections sont
`commander` / `main` / `sideboard` / `maybeboard` — ce qui correspond au modèle de
« boards » de Moxfield (`commanders`, `mainboard`, `sideboard`, `maybeboard`). La page
`moxfield.com/decks/<id>` étant elle-même une SPA rendue côté client, un simple `GET` du
HTML ne fournirait pas ces champs. **Inférence, pas observation** : je n'ai pas vu la
requête sortante d'aura0.

### 1.2 Ce qu'on peut en conclure, et ce qu'on ne peut pas

| hypothèse | verdict |
| --- | --- |
| **(b)** l'import part du navigateur du joueur | **Réfutée.** Aucune requête navigateur → Moxfield ; le seul appel est `aura0.app/api/deck-import`, de même origine. C'est bien le serveur d'aura0 qui va chercher le deck. |
| **(a)** accès autorisé avec `User-Agent` enregistré | **Compatible avec tout ce qui est observé**, mais non prouvé. |
| **(c)** contournement de Cloudflare côté serveur | **Non exclu**, et strictement indiscernable de (a) depuis l'extérieur. |

Ce qui sépare (a) de (c), c'est **l'en-tête `User-Agent` que leur serveur envoie à Moxfield
et l'existence d'un accord** — deux choses invisibles depuis le client. Aucune source
publique ne documente le backend d'aura0 : pas de dépôt public trouvé, pas de page
« à propos » ou de mentions techniques sur le site, pas de discussion indexée (Reddit,
GitHub, Discord) concernant leur import Moxfield. **Je n'ai trouvé aucune déclaration
d'aura0 sur la question, ni dans un sens ni dans l'autre.**

Élément de contexte utile : **Moxfield bloque bien les navigateurs automatisés**. En
tentant de lire simplement la page publique `https://moxfield.com/help/terms` avec
Chromium headless (sans usurpation de `User-Agent`), j'ai reçu un
**403 Cloudflare « Sorry, you have been blocked » (Ray `a3b851fdcf84bc81`)**. La protection
décrite dans notre `README.md` est donc réelle et toujours active au 15/09/2026. Que le
serveur d'aura0 la traverse n'est donc ni anodin ni accidentel : soit il est sur une liste
d'autorisation, soit il fait quelque chose pour passer.

À l'inverse, `https://moxfield.com/robots.txt` (dernière modification : 13/09/2026)
**n'interdit pas** `/decks/*` :

```
User-agent: *
Disallow: /user/admin.html
Disallow: /search/*
Disallow: /account/*
Disallow: /collection/*
Disallow: /binders/*
Sitemap: https://moxfield.com/sitemap.xml
```

C'est une donnée, pas une autorisation : `robots.txt` régit les crawlers, pas l'accès à
`api2.moxfield.com`, et il ne prime pas sur les CGU.

---

## 2. La politique officielle de Moxfield pour les tiers

### 2.1 Il n'y a pas d'API publique documentée

Vérifié le 15/09/2026 : le dépôt officiel
[`moxfield/moxfield-public`](https://github.com/moxfield/moxfield-public) ne contient
**qu'un `README.md`** (description du produit + mentions Wizards) et un dossier
`.github/workflows`. Aucune documentation d'API, aucune politique développeur, aucun
fichier de conditions d'accès. Le dépôt sert en pratique de **bug tracker public**.
L'index des articles d'aide archivés (Wayback) ne comporte aucune page consacrée à une API.

### 2.2 La procédure officieuse mais explicite : prendre contact, et obtenir un accès

La source primaire la plus nette est le compte officiel de Moxfield, au moment où ils ont
fermé l'accès à leur API (novembre 2024) :

> « If you were using our API for a legitimate reason and it's no longer working, please
> reach out to us on Discord and establish a relationship with us so we can make it right.
> It'll take some time, but we'll get things back up and running. We just need to filter
> out the baddies. »
>
> — @moxfieldmtg, **27 novembre 2024, 02:35:34 UTC**,
> <https://x.com/moxfieldmtg/status/1861599720142967082>
> (texte récupéré verbatim via l'endpoint public de syndication X, `id=1861599720142967082`)

Le serveur Discord visé est <https://discord.gg/moxfield>.

### 2.3 La forme concrète de cet accès : un `User-Agent` mis sur liste blanche

Confirmé par une source primaire publique : le ticket
[`moxfield/moxfield-public#143`](https://github.com/moxfield/moxfield-public/issues/143),
ouvert le **23 novembre 2025** par `lucasfeliciano`, toujours ouvert au 15/09/2026 :

> **Steps to Reproduce**
> 1. « Use a whitelisted user agent **provided by Moxfield support**. »
>
> **Additional Notes**
> « **Support confirmed that the user agent being used is whitelisted. Because of that,
> requests should bypass Cloudflare's bot protection.** However, both private API token
> endpoints still appear to require Cloudflare or reCAPTCHA validation. »
>
> **Impact**
> « This issue prevents any automated interaction with the private API, **even for approved
> clients**. »

Un second développeur a confirmé le 24/08/2026 (« running into this as well »). **Aucune
réponse de Moxfield n'apparaît sur ce ticket.**

Ce que cette source établit, et c'est important :

1. **La liste blanche de `User-Agent` existe** et c'est bien le support Moxfield qui la
   gère — ce n'est pas une rumeur de forum. Notre `README.md` et notre
   `apps/server/src/import/moxfield.ts` décrivent donc correctement la réalité.
2. Le vocabulaire employé par Moxfield lui-même est celui de **clients approuvés**
   (« approved clients »), ce qui suppose une décision au cas par cas, révocable.
3. Le problème signalé porte sur les endpoints **d'authentification**
   (`/v1/account/token`, `/v2/account/token`), c'est-à-dire l'accès aux données privées
   d'un compte. **Un deck public ne nécessite aucun jeton** : ce ticket ne dit rien contre
   la lecture d'un deck public avec un `User-Agent` autorisé.

### 2.4 Ce qui n'existe pas

- Pas de portail développeur, pas de formulaire d'inscription, pas de clé d'API libre-service.
- Pas de conditions d'utilisation d'API publiées, donc **pas de limites de débit écrites,
  pas d'engagement de service, pas de préavis de révocation**.
- Pas de délai annoncé (« It'll take some time »).

---

## 3. Ce que cela implique pour nous

**Oui, un chemin d'import par URL légitime nous est ouvert — et un seul.**

### 3.1 La voie praticable : demander un `User-Agent` autorisé

C'est exactement l'architecture déjà prévue dans le code
(`apps/server/src/import/moxfield.ts` + `MOXFIELD_API_ENABLED` / `MOXFIELD_USER_AGENT`
dans `apps/server/src/env.ts`). Conditions, telles que la politique de Moxfield les
définit :

- prendre contact sur le Discord Moxfield, présenter le projet, son usage et son volume ;
- obtenir du support une chaîne `User-Agent` mise sur liste blanche, qui **identifie
  nommément notre service** (c'est le but : « filter out the baddies ») ;
- ne l'utiliser que pour ce qui a été convenu, et depuis le serveur de l'opérateur qui l'a
  obtenue — un `User-Agent` autorisé est **nominatif**, il ne se redistribue pas dans une
  image Docker publique ;
- accepter qu'il puisse être révoqué sans préavis.

Notre modèle de déploiement (auto-hébergement, chaque opérateur fournit ses secrets via
`.env`) est déjà compatible avec ce caractère nominatif : c'est l'opérateur, pas le projet,
qui détient l'autorisation.

### 3.2 La voie « depuis le navigateur du joueur » : séduisante, mais non démontrée

L'argument moral est réel (c'est l'utilisateur, client de Moxfield, qui demande son propre
deck), mais techniquement je n'ai **pas pu vérifier** qu'il est praticable, et le vérifier
supposerait d'émettre des requêtes vers les endpoints Moxfield — ce que le cadre de cette
enquête interdit. Deux obstacles probables, à considérer comme des hypothèses :

- **CORS** : rien n'indique que `api2.moxfield.com` renvoie un
  `Access-Control-Allow-Origin` pour une origine tierce. Sans cela, un `fetch()` depuis
  notre page est bloqué par le navigateur, et le `no-cors` ne donne pas accès au corps.
- **Cloudflare** : un `fetch()` cross-origin ne bénéficie pas du « clearance » que
  l'utilisateur a obtenu en naviguant sur moxfield.com.

Et surtout : **aura0.app n'emprunte pas cette voie**. Si elle était facile, on s'attendrait
à la voir chez eux, qui sont partis d'une architecture entièrement client.

### 3.3 Ce qu'il ne faut pas faire

Copier l'architecture d'aura0 « parce que ça marche chez eux » serait copier une boîte
noire. Un proxy serveur qui interroge Moxfield **sans autorisation** est précisément
l'hypothèse (c) : si c'est ce qu'ils font, s'en inspirer reviendrait à reproduire un
contournement, avec à la clé un blocage IP, et une contradiction frontale avec la position
affichée dans notre `README.md`. **Nous ne savons pas ce que fait leur serveur : c'est une
raison suffisante pour ne pas le prendre comme modèle.**

---

## 4. Recommandation

**Maintenir la position actuelle, et la compléter par une démarche explicite.**

1. **Ne rien changer au comportement par défaut.** Le collage de l'export Moxfield reste le
   chemin normal, mis en avant à égalité avec l'import par URL. Aucun contournement.
2. **Faire la demande.** Un opérateur du projet ouvre le dialogue sur le Discord Moxfield
   pour obtenir un `User-Agent` autorisé. C'est gratuit, c'est la procédure que Moxfield
   indique lui-même, et c'est la seule qui transforme notre chemin API dormant en chemin
   utilisable.
3. **Ne pas s'inspirer d'aura0** tant que la nature de leur accès n'est pas établie.

### Ce qui a été changé dans le code à la suite de cette recommandation

Rien de structurel : la conception (drapeau désactivé par défaut + `User-Agent` fourni
par l'opérateur) était déjà la bonne forme. Les finitions listées ici ont été
**écrites le 15/09/2026**, et voici où elles vivent :

- **Cache.** `apps/server/src/import/moxfield.ts` persiste désormais les réponses dans
  `externalDeckCache` (source `MOXFIELD`), avec un TTL réglé par
  `MOXFIELD_CACHE_TTL_SECONDS` — une heure par défaut, quatre fois le TTL d'Archidekt.
  Le cache est lu **avant** toute décision d'appel, et un cache périmé est servi plutôt
  que de rejouer une requête quand la source refuse ou tombe. Sur un accès accordé à
  titre de faveur, ne pas redemander deux fois la même chose est la première règle.
- **403 et 429 traités à part.** La décision est isolée dans
  `apps/server/src/import/moxfield-policy.ts`, sans réseau ni base, et testée dans
  `apps/server/test/moxfield-policy.test.ts` :
  - **403 (et 401)** → `REVOKED`. Le portillon `MoxfieldGate` se ferme **pour la durée
    du processus** : `moxfieldApiAvailable()` devient faux, plus aucune requête ne part,
    l'utilisateur est renvoyé au collage. Le temps ne rouvre rien — la réouverture passe
    par l'opérateur, qui règle la question avec le support Moxfield.
  - **429** → `RATE_LIMITED`, avec `Retry-After` respecté sous ses deux formes (secondes
    ou date HTTP), plafonné à une heure, et une pause par défaut d'une minute si
    l'en-tête est absent ou illisible. Le portillon reste fermé jusqu'à l'échéance.
  - **404** → deck absent ou privé, sans conséquence sur l'accès.
  - `RateLimitedFetcher` est instanciée avec **une seule tentative** pour Moxfield : le
    backoff automatique n'a pas sa place quand on vient de se faire dire non.
- **Débit.** `MOXFIELD_RATE_PER_MIN`, **6 par défaut** (un appel toutes les 10 s) contre
  30 pour Archidekt. Chiffre à renégocier avec Moxfield lors de la demande.
- **`MOXFIELD_USER_AGENT`** : format et caractère nominatif documentés dans
  `.env.example`, avec la consigne explicite de ne pas reprendre celui d'un autre
  opérateur ni de le publier dans une image.
- **`MOXFIELD_API_TOKEN`** : toujours inutilisé, et `.env.example` dit pourquoi — il ne
  sert qu'aux données privées d'un compte, chemin cassé côté Moxfield (ticket #143).
- **`README.md`** : la phrase est nuancée et renvoie ici.

Ce qui n'a **pas** changé, et ne doit pas changer : aucun contournement, aucun
`User-Agent` forgé, aucune requête émise vers Moxfield tant qu'un opérateur n'a pas
obtenu son autorisation.

---

## 5. Ce que je n'ai pas pu vérifier

1. **Quelle requête le serveur d'aura0 émet réellement vers Moxfield** : quel endpoint,
   quel `User-Agent`, avec ou sans autorisation. C'est invisible depuis le client, et c'est
   précisément le point qui départagerait (a) et (c). **Tout ce qui est affirmé au §1.2 sur
   (a)/(c) est une non-conclusion assumée, pas une conclusion.**
2. **Si aura0 a un accord avec Moxfield** : aucune déclaration publique retrouvée, d'aucun
   des deux côtés.
3. **Le texte des CGU de Moxfield** (`https://moxfield.com/help/terms`) : la page est rendue
   côté client et le domaine renvoie un 403 Cloudflare aux navigateurs automatisés ; les
   instantanés Wayback ne contiennent que la coquille HTML de la SPA. **Je n'ai donc pas pu
   lire la clause sur l'accès automatisé, s'il en existe une.** À lire à la main dans un
   navigateur ordinaire avant toute mise en service du chemin API.
4. **La faisabilité d'un appel depuis le navigateur du joueur** (CORS, challenge Cloudflare
   sur un `fetch()` cross-origin) : non testée, délibérément — cela aurait supposé d'appeler
   les endpoints Moxfield.
5. **Le comportement d'aura0 sur un deck inexistant ou privé** (quel motif d'erreur revient,
   ce qui indiquerait si leur backend atteint vraiment Moxfield ou sert un cache) : la sonde
   a été bloquée par une règle de sécurité locale avant exécution. Cela aurait nuancé le
   §1.1.f, sans rien changer à la conclusion principale, qui ne dépend que de l'observation
   d'un import Moxfield réussi servi par `aura0.app/api/deck-import`.
6. **Les limites de débit réellement appliquées par Moxfield** aux clients autorisés :
   non publiées.

---

### Sources

- [Tweet @moxfieldmtg du 27/11/2024 sur l'accès à l'API](https://x.com/moxfieldmtg/status/1861599720142967082)
- [moxfield/moxfield-public#143 — « Whitelisted User Agent Unable to Authenticate With Private API »](https://github.com/moxfield/moxfield-public/issues/143)
- [moxfield/moxfield-public (dépôt officiel, README seul)](https://github.com/moxfield/moxfield-public)
- [Discord officiel Moxfield](https://discord.gg/moxfield)
- [moxfield.com/robots.txt](https://moxfield.com/robots.txt)
- [CGU Moxfield (non lisibles automatiquement)](https://moxfield.com/help/terms)
- [aura0.app](https://aura0.app/) — page publique et bundle `assets/index-DK_F6jfs.js`, observés le 15/09/2026

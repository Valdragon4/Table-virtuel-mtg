# Le bulk multilingue : mesure, décision, mise en œuvre

Écrit le **18 septembre 2026**, en réponse à la question : faut-il remplacer la résolution
française carte par carte — des appels à l'API Scryfall, plafonnés, lents et sujets au 429 —
par une **jointure en base**, alimentée par le bulk qui contient toutes les langues ?

**La réponse est oui**, et ce document commence par les chiffres qui la justifient, parce
que c'est eux qui décident et non l'intuition. Il dit ensuite ce qui a été fait, ce qui a été
vérifié, et ce qui reste ouvert.

Ce document complète `docs/i18n.md`, qui reste la référence de l'internationalisation. Il ne
le remplace pas : la règle de choix d'une impression de substitution (§3.7), l'exception des
terrains de base (§3.9) et l'invariant de droits (§5) y sont inchangés — et c'est précisément
ce qu'il fallait obtenir.

---

## 1. Ce que Scryfall publie, mesuré le 18 septembre 2026

`GET https://api.scryfall.com/bulk-data` ne publie qu'une seule taille, `compressed_size`.
**La taille décompressée n'est pas annoncée** : elle a été mesurée en lisant le flux.

| jeu de données | compressé | contenu |
| --- | --- | --- |
| `oracle_cards` | 24,7 Mo | une carte par `oracle_id` — la carte, pas ses impressions |
| `unique_artwork` | 37,9 Mo | une carte par illustration distincte |
| **`default_cards`** | **78,4 Mo** | **chaque impression, en anglais** (ou dans sa langue d'origine si elle est unilingue) — **c'est ce que nous ingérons** |
| **`all_cards`** | **393,1 Mo** | **chaque impression, dans chaque langue** — celui qu'on évalue |
| `rulings` | 5,4 Mo | les décisions d'arbitrage, par `oracle_id` |
| `art_tags` | 12,8 Mo | les étiquettes d'illustration de Tagger |
| `oracle_tags` | 6,0 Mo | les étiquettes de règles de Tagger |

`all_cards` pèse **cinq fois** `default_cards` au téléchargement. C'est le chiffre qui fait
peur, et c'est le seul qui soit trompeur : ce qui compte n'est pas ce qu'on télécharge, mais
ce qu'on garde.

### Ce qu'il y a dedans, compté ligne à ligne

Flux lu de bout en bout, sans rien écrire :

| | |
| --- | --- |
| objets carte, toutes langues | **542 539** |
| taille compressée | 393 062 837 octets (393,1 Mo) |
| taille **décompressée** | 2 897 168 677 octets (**2,90 Go**) |
| durée du téléchargement + décompression + `JSON.parse` de tout | **41,3 s** |
| empreinte mémoire du processus, au sommet | **108 Mo** |

Répartition par langue :

| langue | impressions | | langue | impressions |
| --- | ---: | --- | --- | ---: |
| `en` | 115 594 | | `pt` | 39 593 |
| `ja` | 62 163 | | `zht` | 23 582 |
| **`fr`** | **58 847** | | `ru` | 21 760 |
| `de` | 58 512 | | `ko` | 15 382 |
| `es` | 53 395 | | divers | 68 |
| `it` | 52 773 | | | |

*(« divers » : `ph`, `qya`, `dw`, `grc`, `sa`, `he`, `ar`, `la` — les plaisanteries de
Scryfall, phyrexian et quenya compris.)*

### Le levier, et il décide de tout

`LANGUAGES` vaut `['fr', 'en']`, et **l'anglais est déjà le catalogue** : il est ingéré par
`default_cards` et ne coûte ni base ni réseau à résoudre. Du bulk complet, nous n'avons donc
besoin que du **français**.

> **58 847 impressions sur 542 539, soit 10,8 % du flux.** Les 89,2 % restants sont écartés
> au fil de la lecture, avant d'être transformés en quoi que ce soit.

C'est ce chiffre qui rend l'opération raisonnable, et c'est lui qu'il faudrait revoir le jour
où l'on ajouterait une langue : l'espagnol ajouterait 53 395 impressions, l'allemand 58 512.
Trois langues resteraient tenables ; les onze ne le seraient pas.

### L'approche de `ingest.ts` tient-elle à cette échelle ?

Oui, **sans modification de principe**. `ingestCards` ne fait jamais de `JSON.parse` du
fichier : il le lit en flux (`readline` sur un `createGunzip`), ligne par ligne, et pousse
des lots de 500 dans Postgres. `for await` applique la contre-pression — le téléchargement
ralentit tout seul pendant qu'un lot part en base. L'empreinte est donc celle d'**un lot**,
pas celle du fichier : 108 Mo mesurés sur 2,9 Go de flux.

Le seul ajout est un filtre qui écarte une ligne **avant de la parser** : `JSON.parse` sur
542 539 objets domine le coût, et neuf sur dix seront jetés. Chercher `"lang":"fr"` dans la
chaîne brute coûte une fraction de cela. Le sens du test est ce qui le rend sûr : un faux
positif ne coûte qu'un parse inutile, immédiatement rattrapé par la vérification sur
`card.lang` ; un faux négatif est impossible, le motif étant exactement la paire clé/valeur
que Scryfall écrit.

---

## 2. Ce que ça coûte réellement, mesuré en base

Mesures faites sur la pile locale reconstruite, base portant 118 239 cartes et 1 288
localisations au départ. *(Le chantier partait de 1 272 ; les seize de plus ont été écrites
par des parties jouées entre-temps. C'est le compte relevé avant le premier `db push`, donc
celui auquel comparer.)*

| | avant | après |
| --- | ---: | ---: |
| base `mtg` | **444 Mo** | **544 Mo** |
| table `Card` | 416 Mo | 416 Mo (inchangée) |
| table `LocalizedPrinting` | — | **100 Mo** (91 Mo de données, 8,4 Mo d'index) |
| lignes `Card` | 118 239 | 118 239 |
| lignes `CardLocalization` | 1 288 | 1 288 |

**+100 Mo, soit +23 %.** La base ne triple pas, et de loin : 58 847 impressions traduites
coûtent moins qu'un quart de ce que coûtent les 118 239 anglaises, parce qu'on en garde
beaucoup moins de champs.

| | |
| --- | --- |
| durée de l'ingestion localisée, bout en bout | **35,5 s** |
| objets lus dans le flux | 542 539 |
| lignes écrites | 58 847 |
| empreinte mémoire du processus, en fin de course | 608 Mo |

Les 608 Mo appellent une note honnête : ils ne sont pas le coût du flux, qui reste de 108 Mo,
mais celui du processus entier — moteur Prisma compris — sans ramasse-miettes forcé. Aucune
limite mémoire n'est imposée aux conteneurs (`docker-compose.yml` n'en fixe pas), et
l'ingestion a tourné sans incident. **Ni `docker-compose.yml` ni `docker/entrypoint.sh` n'ont
eu à être touchés.**

### Le gain, mesuré côté joueur

Vingt cartes froides — jamais résolues —, tirées au hasard du catalogue, résolues deux fois
dans les mêmes conditions :

| | durée | appels Scryfall | `pending` | non résolues |
| --- | ---: | ---: | ---: | ---: |
| **réseau seul** (l'existant) | **9 398 ms** | 20 | 8 | 8 |
| **par le bulk** | **643 ms** | 2 | **0** | **0** |

Sur **cent** cartes froides : **243 ms**, **zéro** appel Scryfall, **zéro** `pending`, zéro
non résolue. Le plafond de vingt appels vivants par requête n'a plus rien à plafonner.

Les deux appels Scryfall subsistant dans la ligne « par le bulk » ne sont pas un défaut :
ce sont deux impressions que le bulk ingéré ne couvrait pas, et que le chemin paresseux a
reprises. C'est le repli en fonctionnement, observé plutôt que supposé.

---

## 3. La décision, et ce qu'elle écarte

**Oui, on le fait.** Les trois seuils qui auraient dû faire renoncer sont tous largement
franchis :

- *« téléchargement de plusieurs gigaoctets à chaque mise à jour »* : **393 Mo**, une fois
  par jour, au rythme du robinet déjà partagé ;
- *« ingestion d'une heure »* : **35,5 s**, soit moins que les 57 s du catalogue anglais que
  nous ingérons déjà sans que personne ne s'en plaigne ;
- *« base qui triple »* : **+23 %**.

Et ce qu'on achète avec cela est exactement ce qui manquait : plus de plafond par requête,
plus d'état `pending`, plus de relance client, plus de balayage de rattrapage, plus de 429, et
plus de fenêtre où le joueur voit ses cartes en anglais avant qu'elles ne deviennent
françaises par vagues.

**Ce qui aurait fait dire non**, et qu'il faut consigner pour le jour où quelqu'un
reconsidérera : ingérer **toutes** les langues. 542 539 impressions à conserver, environ dix
fois les 100 Mo mesurés, pour dix langues que personne ne demande. Le filtrage au fil du flux
n'est pas une optimisation, c'est la condition de la décision.

---

## 4. Ce qui a été construit, et pourquoi ainsi

### 4.1 Une table neuve, et non des colonnes de plus sur `CardLocalization`

C'était le premier vrai choix, et il se tranche sur les **clés d'accès**.

`CardLocalization` est la **réponse** : « pour la carte anglaise X, en français, que
sert-on ? ». Sa clé primaire est `(scryfallId anglais, langue)`, et elle est pensée pour une
résolution paresseuse — une ligne écrite une fois, relue souvent.

`LocalizedPrinting` est la **matière première** : toutes les impressions françaises publiées
par Scryfall. Elle se lit par ce qui permet de les retrouver — `(langue, édition, numéro)`
pour l'impression exacte, `(langue, oracleId)` pour ses sœurs. Une impression française
**n'a pas d'identifiant anglais à porter** : elle ne pourrait pas entrer dans la clé de
`CardLocalization` sans la dénaturer.

Les garder séparées a une conséquence qui compte plus que l'élégance : la résolution
paresseuse continue d'écrire dans `CardLocalization` exactement ce qu'elle y écrivait, et
l'ingestion en masse **n'efface ni ne réécrit une seule de ses lignes**. Les 1 288
localisations de la base locale l'ont vérifié.

### 4.2 Le chemin paresseux survit — l'avis du propriétaire était juste

**Oui, en repli, et il est indispensable.** Une impression parue après notre dernière
ingestion n'est dans aucun bulk, et son absence n'y veut alors **rien dire**.

C'est le piège central du dispositif, et il se pose à l'envers de l'intuition. Le bulk ne dit
pas « cette carte n'a pas de version française » ; il dit « au jour de ma publication, voici
toutes les impressions françaises ». Confondre « absente du bulk » et « jamais imprimée en
français » graverait un repli anglais **définitif** sur toutes les nouveautés — la même faute
que mémoriser un 503 (`docs/i18n.md` §3.5), et elle serait invisible : personne ne remarque
une carte qui *reste* en anglais.

D'où `bulkAuthorityDate()` : le catalogue localisé ne répond que pour les impressions
**parues au plus tard à la date du bulk ingéré**. Tout le reste retombe sur le réseau,
plafond compris. Une carte sans date de sortie n'est pas tranchée non plus.

### 4.3 Les deux chemins écrivent la même chose — et ce n'est pas une intention

C'est la contrainte que le propriétaire a posée, et la tenir demandait mieux qu'une relecture
attentive. Trois décisions la rendent vraie **par construction** :

1. **La règle de choix n'a pas été réimplémentée.** `fetchLocalizedElsewhere` a été coupée en
   deux : l'appel réseau d'un côté, la **décision** de l'autre — `elsewhereFromCandidates()`,
   qui ne connaît pas la provenance de ses candidates. Le bulk lui présente les mêmes
   candidates, venues d'une jointure. `chooseSubstitute()` n'a pas changé d'une ligne. La
   règle de classement ne change pas, sa source oui : c'est littéralement la même fonction.
2. **La complétion d'une ligne existante n'a pas été dupliquée.** Le rattrapage réseau et le
   rattrapage par le bulk appellent tous deux `completerDepuisAilleurs()`. Deux blocs jumeaux
   auraient divergé à la première correction faite d'un seul côté.
3. **Ce qu'on stocke est ce que les fonctions du chemin réseau produisent.** `printedName` et
   `faces` ne sont pas recopiés du bulk : ils sont calculés à l'ingestion par `printedNameOf()`
   et `localizedFaces()`, les fonctions mêmes du chemin réseau. Il n'y a qu'une
   implémentation, appelée à deux moments.

Un détail qui n'était pas devinable et qui a failli passer : le chemin réseau **ne cherche
même pas ailleurs** quand l'impression traduite est déjà `highres_scan` — il n'y a ni langue
ni netteté à gagner. Le bulk, lui, a les candidates sous la main et aurait volontiers choisi
quand même. Les deux lignes auraient alors différé selon l'ordre où la carte a été vue. La
condition est recopiée mot pour mot, et un test la garde.

De même, `printingScore` : on stocke ses **entrées** (`isDigital`, `isPromo`, `isVariation`,
`isPaper`) et non son résultat. Stocker le score obligerait à croire qu'il a été calculé par
la même version du barème ; stocker les entrées laisse la fonction le recalculer, et le
classement reste identique à celui du chemin réseau — y compris le jour où le barème changera.

### 4.4 L'impression de substitution : les quatre cas de référence

Vérifiés **sur la base réelle**, par le chemin en masse, sans aucun appel réseau :

| carte | impression choisie | substitution attendue | obtenue |
| --- | --- | --- | --- |
| *Archangel of Thune* | `PIO · 4` | `2XM · 5` | **`2xm/5`** |
| *Lyra Dawnbringer* | `FDN · 707` | `DMR · 13` | **`dmr/13`** |
| *Aurelia, the Warleader* | `FDN · 651` | `2X2 · 179` | **`2x2/179`** |
| *Aurelia, the Law Above* | `PMKM · 188p` | `MKM · 188` | **`mkm/188`** |

Les quatre, à l'identique. Les noms imprimés remontent avec : « Archange de Thiune », « Lyra
Aubevenant », « Aurélia, la Meneuse de guerre », « Aurélia, la loi supérieure ».

### 4.5 La fraîcheur

`apps/server/src/index.ts` — hors périmètre d'écriture, et il n'a pas eu à changer —
déclenche l'ingestion au démarrage puis une fois par jour à `INGEST_CRON_HOUR`. Le catalogue
localisé s'y insère **à l'intérieur de `ingestCards()`**, en second temps.

Deux points qui ne sont pas anodins :

- **Il suit le catalogue anglais même quand celui-ci n'a pas bougé.** Les deux bulks ne sont
  pas publiés à la même minute ; renoncer au second parce que le premier était déjà à jour
  aurait laissé les traductions vieillir d'un jour à chaque fois. L'appel est donc placé sur
  les **deux** sorties de `ingestCards`, y compris celle qui rend `skipped: true`.
- **Il ne fait jamais échouer l'ingestion anglaise.** Le catalogue est ce qui fait marcher la
  recherche, les decks et les parties ; les traductions, elles, ont un repli. Un échec rend
  `localized: null` et rien de plus.

### 4.6 Le premier démarrage

Une base vierge reste utilisable **pendant** l'ingestion, pas après. Trois choses s'y
conjuguent, et aucune n'a demandé de code nouveau :

- l'ingestion tourne déjà en tâche de fond dans `index.ts`, sans que le serveur l'attende ;
- `bulkAuthorityDate()` rend `null` tant qu'aucune ingestion localisée n'a abouti : le
  catalogue localisé s'abstient, et **tout** passe par le chemin paresseux — exactement le
  comportement d'hier, plafond et `pending` compris ;
- `bulk` est un paramètre **facultatif** de `resolveLocalizedCards` : sans lui, la fonction se
  comporte à l'identique. Un test le verrouille.

---

## 5. L'invariant de droits : où il se joue, et comment il est vérifié

**C'est le piège principal de cette tâche, et il fallait le nommer.** `default_cards` porte
déjà du texte de règles que nous ne stockons pas ; `all_cards` en porte **dans toutes les
langues** — `oracle_text`, `printed_text`, `flavor_text`, `printed_type_line`, et les mêmes
sur chaque face.

Rien de tout cela n'entre en base. Le filtrage a lieu **à l'ingestion**, champ par champ
(`toLocalizedRow`), et la table n'a tout simplement pas de colonne où en mettre. Ce qu'on
retient se limite à :

- des **URL** d'illustration, que le navigateur du joueur ira chercher lui-même chez
  Scryfall — aucun octet d'image ne nous traverse ;
- le **nom imprimé**, qui est un nom et non un texte de règles ;
- des **métadonnées d'identification** : édition, numéro de collection, cadre, bordure,
  œuvre, date.

Vérifié de trois façons :

- **par la forme de la table** — 23 colonnes, aucune ne pouvant accueillir du texte de
  règles ;
- **par les tests** (`apps/server/test/impressions-localisees.test.ts`), qui donnent à
  ingérer une impression bavarde — oracle, texte imprimé, texte d'ambiance, ligne de type
  traduite, sur la carte et sur chaque face — et vérifient qu'aucun de ces textes ne se
  retrouve dans ce qui est écrit ;
- **par une inspection de la base réelle** après ingestion des 58 847 lignes : aucune
  occurrence de texte d'ambiance ni de texte imprimé. Les clés présentes dans `faces` sont
  `name`, `typeLine`, `manaCost`, `power`, `toughness`, `loyalty`, `imageUris` — les mêmes que
  `Card.faces`. Les trois lignes qui contiennent le mot « oracle » le portent dans un **nom de
  carte** (*Oracle's Gift*, *Jadzi, oracle d'Arcavios*).

Les terrains de base restent hors du dispositif de substitution, sur le chemin en masse comme
sur le chemin réseau : ni substitution, ni repère. C'est une décision du propriétaire
(`docs/i18n.md` §3.9), pas une optimisation, et un test la garde.

---

## 6. Sûreté du schéma

Le projet n'a pas de dossier de migrations : `docker/entrypoint.sh` applique le schéma par
`prisma db push --accept-data-loss`. Tout changement doit donc être **intrinsèquement sûr**.

- **`LocalizedPrinting` est une table entièrement neuve.** Rien n'est supprimé ni renommé.
- **Aucune colonne existante n'a changé.** `Card` et `CardLocalization` sont inchangées ;
  `CatalogCard.releasedAt` est une lecture de plus sur une colonne qui existait déjà.
- **Vérifié sur la base locale** : `db push` appliqué en 202 ms, puis **118 239 cartes et
  1 288 localisations**, c'est-à-dire exactement ce qu'il y avait avant. Aucune ligne perdue.

Le `scryfallId` du protocole ne change jamais : `LocalizedPrinting.scryfallId` est
l'identifiant de l'impression **traduite**, qui ne voyage que sous le nom
`localizedScryfallId` et ne sert qu'à l'affichage. Le nom anglais reste la clé de recherche,
de tri et d'envoi au serveur.

---

## 7. Ce qui reste ouvert

Trois points, consignés parce qu'aucun n'est réglé et que les taire coûterait plus cher que
les écrire.

**1. Une réponse écrite par le bulk est figée, comme celles du réseau.** Quand
`CardLocalization` porte `missing: true` et `substituteSearchVersion` à jour, la ligne n'est
plus rouverte — que la réponse vienne du réseau ou du bulk. Si Scryfall publiait demain une
impression française d'une carte qui n'en avait pas, la ligne continuerait de dire « non ».
C'est le comportement d'hier, inchangé, et le remède est celui d'hier : monter
`SUBSTITUTE_SEARCH_VERSION`, ce qui rejoue le rattrapage sur toute la table — désormais sans
toucher au réseau, donc en quelques secondes au lieu de plusieurs heures. Une reprise
automatique après chaque ingestion serait possible et n'a pas été faite : elle mérite d'être
décidée, pas glissée.

**2. Rien n'est jamais supprimé de `LocalizedPrinting`.** L'écriture est un
`INSERT … ON CONFLICT DO UPDATE`. Une impression que Scryfall retirerait resterait en base,
périmée. Le choix est délibéré : le prix d'un balayage destructif — perdre des lignes à cause
d'un bulk tronqué par une coupure réseau — serait bien plus élevé que celui d'une substitution
qui pointe vers une URL qui ne répond plus, cas que le client traite déjà.

**3. La substitution n'est pas reproposée au fil des ingestions.** Le bulk apporte les
candidates, mais seules les cartes effectivement demandées par un joueur voient leur ligne
écrite. Une ingestion ne pré-remplit pas `CardLocalization` : c'est volontaire — pré-calculer
118 239 lignes dont la quasi-totalité ne sera jamais affichée coûterait du disque pour rien —
mais cela veut dire que le tout premier affichage d'une carte reste une écriture, même quand
il ne coûte plus un appel réseau. Mesuré : 243 ms pour cent cartes, écriture comprise.

---

## 8. Où vivent les tests

| fichier | ce qu'il verrouille |
| --- | --- |
| `apps/server/test/impressions-localisees.test.ts` | l'invariant de droits à l'ingestion (carte et faces), l'absence de plafond et de `pending`, l'**égalité** des lignes écrites par les deux chemins, le silence sur une impression déjà nette, les terrains de base, la mémorisation d'un « pas de version française » qui fait autorité, le repli réseau pour une carte hors bulk, la panne de base non mémorisée, et le comportement inchangé sans source en masse |
| `apps/server/test/cartes-localisees.test.ts` | inchangé — c'est lui qui garde `chooseSubstitute`, et il passe tel quel : la règle n'a pas bougé |

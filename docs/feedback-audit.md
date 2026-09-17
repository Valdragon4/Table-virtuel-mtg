# Audit des retours d'interface

Relevé sur la pile locale (`docker compose`, `http://localhost:3000`), en jouant
réellement : deux contextes Chromium, deux joueurs assis avec une liste collée, partie
lancée, chaque interaction exercée à la main et observée des **deux** côtés. Les
observations datent du 15 septembre ; trois autres agents travaillaient sur
`apps/web/` et `apps/server/` en parallèle, la section 5 dit ce qui a bougé sous
l'audit.

La question posée à chaque geste est toujours la même, dans cet ordre :

1. *Suis-je dans un mode particulier, et comment en sortir ?*
2. *Mon geste va-t-il aboutir là où je crois ?*
3. *Qu'est-ce qui vient de changer ?*
4. *Pourquoi rien ne s'est-il passé ?*

Le **journal d'actions** répond très bien à la question 3 : presque toute action
produit une phrase juste, lisible, identique pour tous. Il ne répond à aucune des
trois autres — il est à 1 400 px du curseur, il arrive après coup, et il ne dit rien
de ce qui *n'a pas* eu lieu. C'est la ligne de partage de tout ce qui suit.

---

## 1. Tableau de synthèse

Légende du verdict : **OK** suffisant · **FAIBLE** insuffisant · **ABSENT** aucun retour.

| Interaction | Pendant le geste | Après | Ce que voit l'autre joueur | Verdict |
|---|---|---|---|---|
| Glisser une carte (main, champ, pile, panneau de zone) | Carte fantôme sous le curseur, badge `+N` en groupe. **Aucune cible n'est mise en évidence** | Carte à sa place + ligne de journal | Ligne de journal + la carte apparaît | **FAIBLE** |
| Dépôt hors de toute zone (fond, panneau flottant, journal) | idem | **Rien du tout** : `seq` inchangé, pas de message, la carte revient à sa place | rien | **ABSENT** |
| Dépôt sur le champ **d'un adversaire** | rien ne distingue son terrain du mien | **Le serveur accepte** ; la carte part chez lui ; le journal dit « de main vers champ de bataille » sans dire *chez qui* | il voit une carte apparaître chez lui, sans savoir qu'elle n'est pas de lui | **ABSENT** |
| Dépôt dans la zone d'origine (même pile) | idem | `return` silencieux (DragLayer.tsx:104) | rien | **ABSENT** |
| Repositionner un permanent sur son champ | fantôme | prédiction locale immédiate (< 80 ms), réconciliée par l'event | la carte bouge | **OK** |
| Engager / dégager (`T`, double-clic) | — | rotation 120 ms + journal | rotation + journal | **OK** |
| Tout dégager (`U`) | — | journal `a tout dégagé` | idem | **OK** |
| Transformer (`F`) | — | l'image change + journal | idem | **OK** |
| Poser / retourner face cachée (`M`) | — | anneau ambré + étiquette « face cachée » chez le propriétaire | dos de carte + journal | **OK** sur l'état, **FAIBLE** sur la bascule (cf. §2.7) |
| Lasso (`Maj` + glisser) | tracé pointillé + **liseré ambré en direct** sur les prises | anneau bleu sur la sélection | rien (sélection locale) | **OK** sur le champ, **FAIBLE** : les cartes de main attrapées ne reçoivent jamais l'anneau bleu |
| Sélection au clic / `Ctrl` / `Maj` | — | anneau bleu | rien | **OK** |
| Action groupée (menu) | — | en-tête `Sol Ring · 6 sélectionnées`, un seul `MOVE_CARDS` | une ligne `a déplacé N carte(s)` | **OK** |
| Attache | mode explicite « Cliquez la carte à laquelle attacher » + contour pointillé sur la source + Échap (corrigé pendant l'audit) | journal `a attaché X à Y` | journal | **OK** — mais la **flèche d'attachement a disparu**, cf. §2.8 |
| Détache | — | **aucune ligne de journal** ; sur une carte non attachée, l'intent est accepté et il ne se passe strictement rien | rien | **ABSENT** |
| Créer un jeton | — | journal + le jeton naît en (60,60) du panneau, **hors du cadre si la caméra est ailleurs** | journal + jeton | **FAIBLE** |
| Détruire un jeton | — | journal `le jeton X de Y a été détruit` | idem | **OK** |
| Ranger un jeton sur l'étagère | — | vignette ajoutée ; **si l'impression y est déjà, silence total** | — | **FAIBLE** |
| Marqueurs de carte (`+` / `−`) | — | badge sur la carte + journal | badge + journal | **OK** |
| Compteurs de joueur | — | bandeau du siège + journal `Alice : poison = 3` | idem | **OK** |
| **Taxe de commandant** (`−`/`+`) | — | **le chiffre affiché ne bouge pas**, alors que le journal dit « corrigée à 1 » | rien non plus | **ABSENT** — le pire cas de l'audit |
| Dégâts de commandant (ma ligne) | — | valeur + journal, seuil 21 en rouge | valeur en lecture seule | **OK** |
| Dégâts de commandant d'autrui | pas de commande du tout (choix assumé) | — | — | **OK** |
| Vie (`−`/`+`) | — | valeur + bandeau + journal | idem | **OK** |
| Pioche | — | main + 1, journal | journal + compteur de main | **OK** |
| Mulligan | — | journal `a pris un mulligan (1) — 1 carte(s) à remettre dessous` | idem | **OK** |
| Mélange | — | **journal uniquement** ; rien ne bouge à la pile | journal | **FAIBLE** |
| Scry / Surveil / Regarder N | modale bloquante, `Visible de vous seul` | journal `a terminé sa consultation (N dessus, M dessous)` | **une ligne de journal, rien d'autre** ; pas d'indicateur pendant la consultation | **FAIBLE** |
| Résolution d'un surveil vers le cimetière | — | le résumé ne compte que dessus/dessous : **la carte partie au cimetière n'apparaît pas dans la phrase** | idem, et la ligne est **écrite deux fois** chez le non-acteur | **FAIBLE** |
| Fouille de bibliothèque | modale | journal | journal `Alice fouille sa bibliothèque` | **OK** (le protocole veut que ce soit public, ça l'est) |
| Mill / Exiler le dessus | — | journal + compteurs de zone | idem | **OK** |
| Défausse au hasard | — | journal nomme la carte tirée | idem | **OK** |
| Révéler sa main | — | journal `a révélé sa main` ; **aucun rappel que ma main est révélée** | **il reçoit les cartes mais aucune n'est rendue à l'écran** — rien à voir, nulle part | **ABSENT** |
| Révéler une carte | — | journal | journal | **OK** |
| Dés et pièce | — | **journal uniquement** | journal | **FAIBLE** |
| Chat | saisie en bas du journal | bulle éphémère 8 s + ligne de journal | bulle + journal | **OK** |
| Changement de tour | — | journal `a passé le tour à X` ; **aucun numéro de tour, aucune phrase « à vous »** ; seul un liseré à la couleur du siège actif | même chose : rien ne lui dit que c'est à lui | **FAIBLE** |
| `UNDO_LAST` (Ctrl+Z) | — | annule bien pose / engagement / marqueur / vie. **Refuse pioche, mélange, dé avec un message faux** (« plus rien à annuler dans les dix dernières secondes ») | ligne `a annulé sa dernière action` | **FAIBLE** |
| Arrivée d'un joueur | — | journal + siège dans la liste | idem | **OK** |
| Départ / déconnexion | — | journal `Bob s'est déconnecté` + mention `déconnecté` dans son bandeau | idem | **OK** |
| Ma propre coupure réseau | — | bandeau ambre `Reconnexion en cours…` immédiat | `Bob s'est déconnecté` | **OK** |
| Reconnexion | — | bandeau disparaît + journal `Bob est de retour` + rattrapage par `seq` | journal | **OK** |
| **Agir pendant une coupure** | le bouton répond normalement | **l'intent est jeté en silence** ; `send()` rend même un `cid` comme si c'était parti | rien | **ABSENT** |
| Intent refusé par le serveur | — | bandeau rose en bas au centre, texte français correct, 4 s | rien (normal) | **FAIBLE** — cf. §2.3, il est souvent **invisible** |
| Erreur serveur non fatale (`t:'error'`) | — | rangée dans `statusDetail`, qui n'est affiché **que** si `status === 'fatal'` : jamais vu | rien | **ABSENT** |

---

## 2. Les manques, par gravité

### Groupe A — le joueur croit que rien ne s'est passé, ou qu'il a fait autre chose

#### 2.1 — La taxe de commandant ne bouge jamais à l'écran

**Symptôme observé.** `+` sur la taxe : le journal écrit *« Alice : taxe de commandant
corrigée à 1 »*, la valeur affichée reste `+0`, chez l'auteur comme chez l'autre
joueur. Reproduit deux fois, sur deux builds successifs
(`shots/a15-taxe.png`, `shots/c02-taxe.png`). Le joueur reclique, la taxe monte à 2, 3,
4 côté serveur pendant qu'il lit toujours `+0`.

**Cause.** `apps/web/src/store/game.ts` — le `switch (event.type)` de `applyEvent`
(lignes 443-640) **n'a pas de cas `COMMANDER_TAX_CHANGED`**. L'event existe bien
(`packages/shared/src/protocol/events.ts:43`) et le serveur l'émet
(`apps/server/src/game/engine-2.ts:761`) ; il tombe dans le `default` qui l'ignore.
`SeatSummary.commanderTax` n'est donc rafraîchi que par un snapshot complet.

**Recommandation.** Ajouter le cas, à côté de `COMMANDER_DAMAGE_CHANGED` :

```ts
case 'COMMANDER_TAX_CHANGED': {
  const seats = get().seats.map((s) =>
    s.id === event.seat
      ? { ...s, commanderTax: { ...s.commanderTax, [event.commanderId]: event.casts } }
      : s,
  );
  set({ seats });
  return;
}
```

Et, dans la foulée, traiter les **cinq autres events aujourd'hui ignorés** par le même
`default` — `UNDONE`, `LOOK_STARTED`, `HAND_UNREVEALED`, `DICE_ROLLED`,
`COIN_FLIPPED`. Aucun ne casse l'état (le `seq` est enregistré), mais chacun est un
retour possible qu'on laisse tomber ; trois d'entre eux servent directement aux points
2.5, 2.6 et 2.9.

---

#### 2.2 — Un dépôt qui ne part nulle part ne dit rien, et un dépôt chez le voisin non plus

**Symptôme observé.** Trois cas mesurés, `seq` avant et après :

| Geste | `seq` | Message | Journal |
|---|---|---|---|
| Lâcher une carte sur le bord de l'écran | 60 → 60 | aucun | aucun |
| Lâcher une carte sur le panneau du journal | 41 → 41 | aucun | aucun |
| Lâcher une carte sur le champ **de Bob** | 100 → 103 | aucun | `Alice a déplacé Lightning Greaves de main vers champ de bataille` |

Le premier et le deuxième sont indistinguables d'un bug : la carte retourne en main,
rien n'explique pourquoi. Le troisième est pire — **le geste réussit à un endroit que
le joueur n'a pas visé**, la carte disparaît de son terrain, et la phrase du journal ne
mentionne pas chez qui elle a atterri.
(`shots/a04-depot-hors-cible.png`, `shots/d04-depot-sur-journal.png`,
`shots/c11-depot-champ-adverse.png`)

**Cause.** `apps/web/src/components/DragLayer.tsx` :
`findDropTarget` n'est appelé **qu'au relâchement** (ligne 93). Pendant tout le
glissement, rien n'interroge la cible ; le fantôme flotte au-dessus d'une table
uniforme. Les deux abandons silencieux sont ligne 94 (`if (!target) return;`) et
ligne 104 (`if (sameZone && …) return;`).

**Recommandation, en trois morceaux indépendants et livrables séparément :**

1. **Cible en direct.** Dans le `move` du `DragLayer` (ligne 74), appeler
   `findDropTarget` à chaque frame — c'est un `elementsFromPoint`, du même prix que le
   `paint()` déjà fait — et poser une classe sur le nœud `[data-zone]` visé, à la
   manière de `markLassoHits` (Table.tsx:474, même technique hors React, même coût).
   Une classe `.drop-target` dans `index.css` à côté de `.lasso-hit` : liseré plein à
   la couleur du siège **propriétaire de la zone**, ce qui rend le cas « champ du
   voisin » visible sans rien écrire.
2. **Refus lisible.** Quand `target` est `null` ou que le dépôt est sans effet, rendre
   le fantôme rouge/barré pendant le geste, et au relâchement ramener la carte à sa
   place avec une transition courte plutôt qu'un saut sec. Le fantôme sait déjà se
   dessiner ; c'est une classe conditionnelle sur `<CardSprite>` ligne 168.
3. **Phrase complète.** `apps/server/src/game/engine.ts:409` — le texte
   `a déplacé X de <zone> vers <zone>` doit nommer le siège quand l'origine et la
   destination n'ont pas le même propriétaire : `… vers le champ de bataille de Bob`.
   `zoneLabel()` a déjà le `ZoneRef`, il lui manque le `displayName`.

---

#### 2.3 — Le message de refus est peint **sous** les modales et les menus

**Symptôme observé.** Le bandeau de rejet existe et son texte est bon (« Cette zone est
en cours de consultation. », « Tu as déjà un deck en jeu… », « Objet inconnu ou déjà
retiré. »). Mais il est rendu **derrière** tout ce qui compte :

| Situation | Ce qui est réellement au-dessus | z-index |
|---|---|---|
| Consultation ouverte | le voile de `LookModal` | 40 |
| Menu contextuel ouvert | le voile du menu | 40 |
| Panneau des zones ouvert | `ZonePanel` | 30 |

Mesuré par `elementFromPoint` au centre de la boîte : ce n'est jamais la boîte
(`shots/d01-rejet-sous-modale.png`, `shots/d02-rejet-sous-menu.png`).
Or ce sont précisément les situations où l'on se fait refuser quelque chose.

**Cause.** `apps/web/src/pages/Room.tsx:197-201` — la boîte est
`absolute bottom-6 …` **sans classe de z-index**, donc `z-auto`, dans le même contexte
d'empilement que `LookModal` (`z-40`), `CardMenu` (`z-40`/`z-50`) et `ZonePanel`
(`z-30`).

**Recommandation.** Deux lignes, à faire en premier parce que c'est le socle de tout
le reste :

- Passer la boîte en `fixed … z-[60]` — au-dessus de tout, y compris de la modale
  fatale à `z-50`.
- Y ajouter un bouton de fermeture et **arrêter le compte à rebours de 4 s au survol**
  (`Room.tsx:78-82`). Quatre secondes suffisent à rater le message si l'on regarde
  ailleurs, et rien ne permet de le relire.

**Et un complément, moins mécanique :** un refus mérite d'être rendu **à l'endroit du
geste**, pas seulement en bas de l'écran. Quand `reject` porte sur une carte connue —
le `cid` est déjà mémorisé dans `pendingPredictions` (`store/game.ts:141`) — faire
clignoter la carte en rouge une demi-seconde. Le bandeau reste pour le *pourquoi*, la
carte dit *sur quoi*.

---

#### 2.4 — Un intent émis pendant une coupure est perdu sans un mot

**Symptôme observé.** Socket fermé sous le client : le bandeau ambre `Reconnexion en
cours…` apparaît bien (`shots/c09-coupure.png`), mais **toute la table reste
cliquable**. On clique « Piocher » : le menu se ferme, le bouton réagit, et rien ne
part. Aucun message, aucune trace.

**Cause.** `apps/web/src/net/socket.ts:108-110` — `raw()` ne poste que si
`readyState === OPEN`, sinon il retourne sans rien dire ; et `send()` (ligne 97)
**rend quand même un `cid`**, ce qui fait croire à tout appelant que l'intent est
parti. C'est ce `cid` que `predictMove` mémorise : une prédiction locale s'installe
alors sur un intent qui n'existe pas, et n'est levée que par le filet de 4 s
(`store/game.ts:142`).

**Recommandation.**

- `raw()` doit signaler l'échec ; `send()` renvoie `null` quand rien n'est parti, et le
  store pose un `lastReject` explicite : *« Hors ligne — action non envoyée. Elle
  n'est pas mise en attente. »* Le type de retour `string | null` est déjà celui
  déclaré dans `GameStore.send` (`store/game.ts:128`), il n'est simplement jamais
  `null` aujourd'hui.
- Tant que `status !== 'open'`, désaturer la table (`filter: grayscale(.4)` sur
  `.table-surface`) et faire du bandeau ambre un vrai bandeau : il est aujourd'hui
  perdu au milieu de la barre supérieure, entre le compte de joueurs et la barre
  d'actions.
- Le socket envoie un `ping` toutes les `pingIntervalMs` (`socket.ts:60`) mais
  **n'attend aucun `pong`** : une coupure qui ne ferme pas le socket — un Wi-Fi qui
  décroche, un tunnel — n'est jamais détectée. Compter les pings sans réponse et
  fermer soi-même au deuxième.

---

#### 2.5 — Révéler sa main ne montre la main à personne

**Symptôme observé.** Alice clique « Révéler sa main ». Le journal des deux joueurs dit
*« Alice a révélé sa main »*. Chez Bob, le store **reçoit bien les 5 cartes**
(`HAND_REVEALED` est appliqué, `store/game.ts:528`) — et **0 est rendue à l'écran**.
Il n'y a nulle part où les voir : le panneau des zones d'un adversaire n'offre que
`Cimetière / Exil / Commandement` (`shots/c05-main-revelee-B.png`). Côté Alice, rien ne
rappelle qu'elle joue main ouverte, et l'entrée `UNREVEAL_HAND` du protocole n'est
exposée par aucun bouton.

**Cause.** `apps/web/src/components/Hand.tsx:81` — le rail ne rend que
`c.zone.seat === mySeat`. Aucun autre composant ne dessine une main. Et
`apps/web/src/components/Toolbar.tsx:171` envoie `REVEAL_HAND` sans jamais proposer son
inverse.

**Recommandation.**

- Ajouter un onglet **Main** au `ZonePanel` pour un siège dont on connaît des cartes de
  main — le panneau sait déjà filtrer par `zone.kind`, c'est une entrée de plus dans sa
  liste d'onglets, conditionnée à `cards` non vide pour cette zone.
- Poser un badge **« main révélée »** dans le bandeau d'identité du siège concerné
  (`SeatPanel.tsx`, à côté de `déconnecté`), visible de tous, et en faire l'interrupteur
  qui envoie `UNREVEAL_HAND` pour son propriétaire. L'event `HAND_UNREVEALED` existe et
  n'est pas traité par le store : c'est le même correctif que 2.1.

---

#### 2.6 — Ctrl+Z ment sur la raison du refus, et n'existe nulle part à l'écran

**Symptôme observé.** Matrice mesurée action par action :

| Action | Ctrl+Z |
|---|---|
| Poser un permanent | annulé |
| Engager | annulé |
| Poser un marqueur | annulé |
| Ajuster la vie | annulé |
| **Piocher** | refusé — *« Plus rien à annuler dans les dix dernières secondes. »* |
| **Mélanger** | refusé — même message |
| **Lancer un dé** | refusé — même message |

Le message est faux : l'action date d'une seconde. La vraie raison est qu'elle n'est
pas réversible. Un joueur qui pioche par erreur et fait Ctrl+Z lit une phrase qui lui
dit que sa pioche est trop vieille. (`shots/c08-annulation.png`)

**Cause.** `apps/server/src/game/room.ts:830-837` : le même
`ERR_UNDO_UNAVAILABLE` couvre « rien dans la pile » et « l'entrée a expiré », parce que
`handleIntent` (ligne 816) fait `undoStack.delete(seatId)` dès qu'un résultat n'a pas
de `undo`. L'information « cette action n'était pas annulable » est donc perdue avant
d'arriver au message.

**Recommandation.**

- Distinguer les trois cas au lieu d'un seul message : retenir dans `undoStack` une
  entrée `{ kind: 'NON_REVERSIBLE', label }` quand `result.undo` est absent, et
  répondre *« Une pioche ne s'annule pas — elle a changé une zone cachée. »*, *« Le
  délai de dix secondes est passé. »*, ou *« Quelqu'un a joué depuis. »* (ce dernier
  existe déjà, ligne 851).
- Et surtout : **il n'y a aucun bouton « Annuler »**. Ctrl+Z n'est documenté que dans
  la modale `?` (`Shortcuts.tsx:68`). Une entrée « Annuler ma dernière action » dans le
  menu *Actions*, grisée quand rien n'est annulable, rendrait la fonction découvrable
  et répondrait d'elle-même à la question « pourquoi rien ? ».

---

#### 2.7 — `Détacher` et `M` : deux gestes qui peuvent n'avoir aucun effet, en silence

**Détacher.** Mesuré : sur une carte qui n'a rien d'attaché, `seq` passe de 77 à 79,
**zéro ligne de journal**, zéro changement à l'écran, aucun refus. L'action consomme
même la case d'annulation du siège. Sur une carte réellement attachée, c'est presque
aussi discret : la flèche disparaît, et le journal ne dit rien non plus.

*Cause :* `apps/server/src/game/engine.ts:701-719` — les deux emissions de `DETACH` n'ont
pas de champ `log`, contrairement à `ATTACH` (ligne 679). Et le menu propose
« Détacher » indépendamment de `card.attachedTo`.

*Recommandation :* donner un `log` à `DETACH` (`${who} a détaché X de Y`), symétrique
de celui d'`ATTACH` ; et ne proposer l'entrée que si `card.attachedTo` est défini —
c'est déjà le motif retenu pour « Ranger ce jeton sur l'étagère », conditionné à
`card.kind === 'TOKEN'`.

**La touche `M`.** Deux pressions de suite sur un permanent : la carte reste face
cachée sur la table, le journal écrit **deux fois** *« Alice a retourné une carte face
cachée »*, et le menu contextuel continue d'afficher « Retourner face cachée » en
première position (`shots/d03-m-deux-fois.png`). Le joueur croit avoir rétabli sa carte.

*Cause :* `Shortcuts.tsx:209-211` décide sur `focus.faceDown`, qui vaut toujours `false`
pour le propriétaire — c'est `facedownOnTable` qui porte l'état réel, et le commentaire
de `CardMenu.tsx:148-154` explique pourquoi. Mais `facedownOnTable` **existe dans la
`CardView`** : je l'ai lu dans le store pendant le test. Le champ manquant du protocole
évoqué par le commentaire est en fait déjà là.

*Recommandation :* remplacer `focus.faceDown ?` par
`focus.facedownOnTable ? TURN_FACE_UP : TURN_FACE_DOWN` dans `Shortcuts.tsx`, et dans
`CardMenu.tsx` fusionner les deux entrées en une bascule libellée d'après
`facedownOnTable`. Si le champ ne devait pas être fiable, verrouiller au moins l'aller
simple : ne pas émettre `TURN_FACE_DOWN` sur une carte déjà posée face cachée.

---

### Groupe B — le geste aboutit, mais le joueur doit deviner

#### 2.8 — L'attachement ne se voit plus une fois fait

**Observé sur le build du 15/09 en fin d'audit** : après un `ATTACH` réussi
(`attachedTo` posé, journal correct), `svg line[marker-end]` renvoie **0** — les flèches
pointillées de `AttachmentLinks` ont disparu, remplacées par un `attachmentLayout` qui
glisse la carte attachée **sous** sa cible (`SeatPanel.tsx:116-151`). Le résultat
visible du geste est donc : ma carte disparaît.

C'est un changement fait par un autre agent pendant l'audit, et l'intention — poser
l'équipement sous la créature — est bonne. Mais elle a supprimé le seul signal qui
disait *quoi est attaché à quoi*.

**Recommandation.** Garder le rangement sous la cible **et** rendre le lien visible :
un décalage d'une dizaine de pixels pour que la carte du dessous dépasse (c'est ce
qu'on fait avec un vrai équipement), plus un petit badge « 🔗 N » sur la carte cible.
Le halo au survol du journal existe déjà (`highlighted`, `CardSprite.tsx:64`) : le
réutiliser pour mettre en évidence la paire quand on survole l'une des deux.

#### 2.9 — Mélange, dés et pièce n'existent que dans le journal

Un mélange ne produit aucun mouvement visible : le compteur de bibliothèque est
identique avant et après (29 → 29), la pile ne bouge pas. Un `d20` et un `pile ou face`
n'ont **aucun retour hors du journal** (`shots/b07-des.png`) — or un jet de dé est
précisément le moment où toute la table regarde ailleurs.

**Recommandation.** Traiter `DICE_ROLLED` et `COIN_FLIPPED` dans le store (cf. 2.1) et
les rendre comme les bulles de chat, qui font déjà exactement ce qu'il faut :
`Table.tsx:421-435`, centrées, à la couleur du siège, éphémères. Un `4` en gros au
milieu de l'écran pendant deux secondes. Pour le mélange, une animation de 200 ms sur
la vignette de bibliothèque (`ZonePile`) suffit à dire que quelque chose a eu lieu.

#### 2.10 — Rien ne dit de qui est le tour

`turn.activeSeat` et `turn.turnNumber` sont bien tenus à jour chez les deux joueurs.
À l'écran : **aucun texte**, nulle part — pas de numéro de tour, pas de « à vous ».
Le seul signal est un liseré à la couleur du siège actif autour de son panneau, qui
demande de connaître les couleurs et de trouver le panneau. Quand Bob devient actif, sa
page ne change pas d'un pixel dans son champ de vision. (`shots/b09-mon-tour-vue-B.png`)

De plus, `Passer le tour` est offert à tous, sans égard à qui joue : pendant l'audit,
Alice a passé le tour alors que c'était celui de Bob, et le journal a écrit
*« Alice a passé le tour à Alice »*.

**Recommandation.** Une pastille dans la barre supérieure, à côté du compte de
joueurs : `Tour 2 · Bob` à la couleur du siège, devenant `Tour 2 · à vous` en accentué
quand `activeSeat === mySeat`. Et dans `Toolbar`, libeller le bouton
`Passer le tour` → `Passer le tour de Bob` quand ce n'est pas le sien : on n'interdit
pas — la table s'auto-arbitre — mais on dit ce qu'on s'apprête à faire.

#### 2.11 — Ce que fait l'autre joueur pendant une consultation

Quand Alice ouvre un scry ou fouille sa bibliothèque, Bob a une ligne de journal, et
c'est tout. La consultation peut durer une minute, pendant laquelle Alice est dans une
modale bloquante et Bob ne sait pas s'il doit attendre. `LOOK_STARTED` existe et n'est
pas traité par le store (cf. 2.1).

**Recommandation.** Traiter `LOOK_STARTED` / `LOOK_RESOLVED` en un état
`looksInProgress: Map<SeatId, LookMode>` et afficher un bandeau `👁 consulte sa
bibliothèque` dans le bandeau d'identité du siège concerné, chez tout le monde. C'est
le même emplacement que `déconnecté` et que le badge de main révélée du point 2.5 —
trois retours pour un seul emplacement à dessiner.

#### 2.12 — Le lasso attrape la main, sans le dire après coup

Pendant le tracé, 4 cartes sont marquées en ambre. Au relâchement, la sélection
contient **6** cartes et seulement **3** anneaux bleus apparaissent : les cartes de main
attrapées par le tracé — le rail est en bas de l'écran, sur le chemin — sont bel et
bien sélectionnées, et rien ne le montre. L'action groupée suivante les emporte.

*Cause :* `Table.tsx:633` — `cardsInLasso` balaie `[data-card]`, qui inclut le rail de
main ; `Hand.tsx:88-94` ne passe jamais `selected` à `<CardSprite>`.

*Recommandation :* le moins cher et le plus juste est de passer
`selected={selection.has(card.id)}` dans `Hand.tsx` — l'anneau bleu est déjà stylé
(`index.css`, `.selected-card`). Si l'on préfère que le lasso ne prenne que des
permanents, restreindre le sélecteur à `[data-card-id] [data-card]`. Les deux se
défendent ; ne rien faire ne se défend pas.

#### 2.13 — Un jeton créé peut naître hors du cadre

`CREATE_TOKEN` place le jeton en (60, 60) du panneau
(`Room.tsx:36`, `CardMenu` « Copier en jeton » exceptée). Si la caméra est ailleurs —
et après un `Voir toute la table`, elle l'est — le joueur voit la ligne de journal et
rien d'autre. Même remarque pour « Étiquette sur la table » depuis le menu *Créer*,
posée en (40, 40) ; le menu contextuel du fond, lui, fait correctement les choses en
retenant le point cliqué.

*Recommandation :* après un `TOKENS_CREATED` dont l'acteur est moi, faire clignoter la
carte (classe `.lasso-hit` réutilisable) et, si elle est hors du viewport, la ramener
dans le cadre. Le calcul de cadrage existe (`focusOnMe`).

#### 2.14 — Petits silences, à corriger quand on passe à côté

- **Ranger un jeton déjà rangé** : `shelveToken` renvoie `false` si l'impression est
  déjà sur l'étagère (`TokenShelf.tsx:26`) ; `CardMenu.tsx` l'appelle en `void` et
  ferme le menu. Un clic sans effet, sans un mot. → lire le retour et afficher
  *« Déjà sur l'étagère »*.
- **Résumé de consultation incomplet** : après un surveil qui envoie une carte au
  cimetière, la phrase reste *« (1 dessus, 0 dessous) »*
  (`engine-2.ts:337`). → compléter `LookSummary` avec `toHand/toGraveyard/toExile`, qui
  sont déjà calculés juste au-dessus.
- **Ligne de résolution écrite deux fois** chez le joueur qui n'est pas l'acteur —
  reproduit à chaque scry, surveil et fouille. À chercher du côté de l'audience de
  l'emission `LOOK_RESOLVED` et du `LOOK_RESULT` qui la précède.
- **`ADD_LABEL` ne produit aucune ligne de journal** alors que l'étiquette est visible
  de toute la table.
- **`t:'error'` non fatal est invisible** : `store/game.ts:352` le range dans
  `statusDetail`, que `Room.tsx:202` n'affiche que si `status === 'fatal'`. → le router
  vers `lastReject` quand il n'est pas fatal.
- **Le nom des cartes face cachée dans le journal** : *« Alice a mis 1 marqueur(s)
  +1/+1 sur une carte »*, *« Alice a attaché une carte à Arcane Signet »*. Correct sur
  le plan de l'information cachée, mais le propriétaire, lui, a le droit de lire le
  nom. Les emissions sont déjà construites par siège (`build: (s) => …`) : le nom peut
  être donné à qui connaît la carte.

---

## 3. Ce que j'ai vérifié, et comment

**Pile.** `docker compose up -d --build` déjà en route, `http://localhost:3000`,
Postgres 16. Le conteneur a été reconstruit deux fois pendant l'audit par d'autres
agents ; les points 2.1, 2.2 et 2.3 ont été revérifiés sur le build final.

**Méthode.** Quatre scripts Playwright successifs, sur le modèle de
`scripts/verify-ui.mjs`, avec **deux contextes navigateur** (Alice et Bob), une liste de
deck collée de part et d'autre, partie lancée. Chaque assertion lit `window.__mtg`
(le `seq`, le journal, les zones, les sièges) **et** le DOM réel
(`elementFromPoint`, `getComputedStyle`, comptage de nœuds) — pour ne jamais confondre
« l'état est là » et « le joueur le voit ». `window.prompt`/`confirm` sont neutralisés
par `addInitScript` afin de piloter les valeurs.

Les scripts et les 54 captures sont dans le répertoire de travail temporaire de la
session :
`…\316f8c8d-…\scratchpad\` (`audit1.mjs` … `audit4.mjs`, dossier `shots/`).

**Captures citées ci-dessus :**

| Fichier | Ce qu'il montre |
|---|---|
| `a04-depot-hors-cible.png` | après un dépôt hors zone : rien |
| `c11-depot-champ-adverse.png` | la carte d'Alice posée chez Bob, sans avertissement |
| `a15-taxe.png`, `c02-taxe.png` | taxe à `+0` après incrément, deux builds |
| `a08-lasso-en-cours.png` / `a09-lasso-apres.png` | marquage ambré en direct, puis anneaux manquants |
| `c03-attache-mode.png` | le mode d'accrochage corrigé, avec sa consigne |
| `c04-attache-faite.png` | l'attachement fait, sans flèche |
| `c05-main-revelee-B.png` | la vue de Bob quand Alice révèle sa main |
| `d01-rejet-sous-modale.png`, `d02-rejet-sous-menu.png` | le message de refus invisible |
| `d03-m-deux-fois.png` | deux `M` de suite, l'indicateur inchangé |
| `c08-annulation.png` | Ctrl+Z refusé sur une pioche d'une seconde |
| `c09-coupure.png`, `c10-reconnecte.png` | coupure et retour |
| `b09-mon-tour-vue-B.png` | l'écran de Bob au moment où c'est son tour |

**Gestes réellement exercés** (et non déduits du code) : glisser-déposer depuis la
main, le champ, la zone de commandement et une pile vers les six destinations ; dépôt
hors cible, sur un panneau flottant et sur le champ adverse ; `T`, `M`, `F`, `+`, `G`,
`P`, `D`, `U`, `S`, `Ctrl+Z` ; lasso avec et sans `Alt`, sélection au clic / `Ctrl` /
`Maj` ; menus contextuels de carte, de pile et de fond ; attache et détache, dont le
cas « rien à détacher » ; création et destruction de jetons, étagère ; marqueurs de
carte, compteurs de joueur, taxe, dégâts de commandant dans les deux sens ; pioche,
mulligan, mélange, scry, surveil, regarder N, fouille, mill, exil du dessus, défausse
au hasard, révélation de main ; d20 et pièce ; chat ; fin de tour ; arrivée, départ,
fermeture d'onglet, coupure de socket et reconnexion ; six refus serveur distincts.

---

## 4. Ce que je n'ai pas pu observer

- **La production.** Tout a été joué en local. `https://magic.valentin-marot.fr` n'a
  pas été sollicité — je n'allais pas exercer des refus serveur sur une table réelle.
- **Plus de deux joueurs.** Les curseurs d'autrui, la disposition à 3-8 sièges et les
  bulles de chat simultanées n'ont été vus qu'à deux. `ui-reference.md` décrit un
  curseur portant la carte en cours de déplacement (`CURSOR.holding`) : je ne l'ai pas
  observé en mouvement.
- **La latence réelle.** Sur `localhost`, l'aller-retour est de quelques millisecondes.
  Tout ce qui concerne « le joueur voit-il un délai entre son geste et sa confirmation »
  — donc l'utilité même des prédictions locales — demande une mesure sur un lien lent,
  que je n'ai pas simulée.
- **Le tactile et les petits écrans.** Tout a été joué en 1600 × 1000 à la souris. Le
  lasso, le glisser-déposer et les menus contextuels reposent sur des événements
  pointeur et un clic droit ; leur comportement tactile n'est pas audité.
- **La concession, la fin de partie et le redémarrage** (`CONCEDE`, `GAME_ENDED`,
  `RESTART_GAME`) : je les ai lus dans le code mais pas joués, pour ne pas détruire les
  tables en cours pendant que d'autres agents travaillaient sur la même pile.
- **Les mots exacts de certains refus** : `SET_SEAT_COSMETICS`, le mot de passe de
  table et la table pleine n'ont pas été déclenchés.
- **Un point resté sans explication** : lors d'un essai, une carte de ma propre main
  jouée pendant un scry a produit *« Cette zone n'est pas la tienne. »*. Rejoué
  proprement, le même geste passe sans refus ; je n'ai pas retrouvé la condition. À
  surveiller si cela remonte d'une vraie partie.
- Enfin : **le code bougeait sous l'audit.** Le cas « attache » cité en exemple par le
  propriétaire a été corrigé par un autre agent pendant que j'écrivais — c'est le
  point 2.8 qui en prend la suite. Les numéros de ligne cités valent pour l'état du
  dépôt au moment de la rédaction.

---

## Par où commencer

1. **2.3** — remonter le message de refus au-dessus des modales. Deux lignes, et tous
   les autres refus deviennent enfin visibles.
2. **2.1** — le cas `COMMANDER_TAX_CHANGED` manquant (et les cinq autres events
   ignorés). Une dizaine de lignes, débloque 2.5, 2.9 et 2.11.
3. **2.2** — la cible de dépôt en direct. Le plus gros morceau de la liste, et celui
   qui change le plus la sensation du produit.
4. **2.4** — ne plus perdre un intent en silence pendant une coupure.
5. **2.5** — donner un endroit où voir une main révélée.
6. **2.6** — dire la vraie raison d'un refus d'annulation, et rendre l'annulation
   découvrable.
7. **2.7** puis le reste du groupe B.

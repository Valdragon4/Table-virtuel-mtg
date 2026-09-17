# Provenance des images de cette table

Ce dossier est le **seul** endroit du dépôt où vit une image que nous n'avons pas
dessinée. Chaque fichier y est listé avec sa source et sa licence, vérifiées
avant intégration. Rien n'y entre sans cette ligne.

La règle permanente du projet reste entière : **aucun asset de Wizards of the
Coast** n'est hébergé, proxifié ni mis en cache ici. Les faces de cartes et le
dos officiel continuent d'être chargés par le navigateur du joueur depuis le CDN
de Scryfall, et n'ont aucune copie dans ce dépôt.

## `arena.jpg`

- **Œuvre** : illustration d'arène vue du dessus, réduite à 2200 × 1575, JPEG.
- **Origine** : générée par le propriétaire du projet (Gemini), et fournie par
  lui pour cet usage. Ce n'est ni une œuvre de Wizards of the Coast, ni de Riot,
  ni d'aucun tiers dont nous aurions repris le travail.
- **Rôle** : le fond de table par défaut. Elle remplace le dallage que nous
  composions, qui reste dans le code — `localStorage.setItem('mtg.fond', 'dalle')`
  y revient sans reconstruction.
- **Pourquoi la garder aussi** : le dallage est **entièrement libre de droits**
  (CC0 + géométrie de notre main). Si cette illustration devait un jour poser
  question, le repli existe déjà et ne demande aucun travail.

## `mosaic.jpg`

- **Œuvre** : « Tiles131 », carte de couleur, réduite à 512 × 512, JPEG.
- **Source** : ambientCG — <https://ambientcg.com/view?id=Tiles131>
- **Licence** : **CC0 1.0**. <https://docs.ambientcg.com/license> — « You can
  copy, modify, distribute and perform the assets, even for commercial
  purposes, all without asking permission. […] You don't need to give credit. »
- **Attribution** : non exigée. Elle figure ici par honnêteté.
- **Pourquoi celle-ci** : c'est un **carrelage ornemental réel**, et sans
  couture. Elle a remplacé une bordure que nous dessinions — balustres et
  massifs — qui lisait comme du bricolage : de la géométrie simple posée côte à
  côte ne fait pas un décor, un motif dessiné par un carreleur si.

## `foliage.jpg`

- **Œuvre** : « Forest Leaves 03 », carte de diffusion, réduite à 512 × 512, JPEG.
- **Auteur** : Rob Tuytel.
- **Source** : Poly Haven — <https://polyhaven.com/a/forest_leaves_03>
- **Licence** : **CC0 1.0**, comme tout Poly Haven.
- **Rôle** : le sol au-delà de la bordure. Réduite de 1 Mo à 85 Ko : à cette
  distance, la définition d'origine ne se voit pas.

## `stone-floor.jpg`

- **Œuvre** : « Large Floor Tiles 02 », carte de diffusion, 1024 × 1024, JPEG.
- **Auteur** : Rob Tuytel.
- **Source** : Poly Haven — <https://polyhaven.com/a/large_floor_tiles_02>
- **Licence** : **CC0 1.0** (Creative Commons Zero, domaine public).
  <https://polyhaven.com/license> — « You can use our assets for any purpose,
  including commercial work. You do not need to give credit or attribution when
  using them (although it is appreciated). »
- **Attribution** : non exigée. Elle figure ici par honnêteté, pas par
  obligation.
- **Pourquoi celle-ci** : elle est **sans couture**. Le fond de table est répété
  à l'infini sur une surface de ~30 000 unités ; une image à bords visibles y
  laisserait une grille de raccords à chaque tuile.
- **Résolution** : la version 1K a été retenue contre la 2K (2,4 Mo) : à la
  taille où elle est projetée, la différence ne se voit pas, et 558 Ko est déjà
  le plus gros fichier servi par le site.

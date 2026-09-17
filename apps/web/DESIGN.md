---
name: Table virtuelle MTG — surfaces du site
description: La papeterie d'une salle de tournoi, la nuit — le carton imprimé posé sur un sol sombre.
colors:
  floor: "#0b0e14"
  floor-lift: "#141926"
  floor-rule: "#2a2f3c"
  floor-text: "#e9e5db"
  floor-dim: "#a09b8d"
  paper: "#e9e3d4"
  paper-shade: "#dcd4c1"
  paper-edge: "#b9b09a"
  ink: "#16141b"
  ink-soft: "#5c5647"
  stamp: "#7c3aed"
  stamp-deep: "#5b21b6"
  stamp-pale: "#bda6ff"
  alarm: "#8c2438"
  alarm-on-floor: "#f0a1ae"
typography:
  display:
    fontFamily: "'Archivo Site', Archivo, system-ui, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.7rem, 8.4vw, 5.1rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 78"
  headline:
    fontFamily: "'Archivo Site', Archivo, system-ui, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.6rem, 3.4vw, 2.3rem)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 78"
  label:
    fontFamily: "'Archivo Site', Archivo, system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.68rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 84"
  body:
    fontFamily: "'Archivo Site', Archivo, system-ui, 'Segoe UI', sans-serif"
    fontSize: "1.02rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  mono:
    fontFamily: "'Courier Site', 'Courier Prime', ui-monospace, 'Courier New', monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.75
    fontFeature: "tabular-nums"
rounded:
  none: "0"
  sm: "2px"
  md: "6px"
  lg: "10px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "20px"
  lg: "36px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.stamp}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "14px 20px"
  button-primary-hover:
    backgroundColor: "#8b52f5"
  button-primary-disabled:
    backgroundColor: "{colors.paper-edge}"
    textColor: "#46402f"
  button-outline-ink:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "10px 20px"
  button-outline-ink-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-outline-floor:
    backgroundColor: "transparent"
    textColor: "{colors.floor-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  button-outline-floor-hover:
    textColor: "{colors.stamp-pale}"
  choice-printed:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  choice-printed-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  surface-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px"
  surface-dark:
    backgroundColor: "{colors.floor-lift}"
    textColor: "{colors.floor-text}"
    rounded: "{rounded.md}"
    padding: "20px"
  field-paper:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 0 7px"
  field-dark:
    backgroundColor: "{colors.floor}"
    textColor: "{colors.floor-text}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  stamp-mark:
    backgroundColor: "transparent"
    textColor: "{colors.stamp-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "5px 10px 4px"
---

# Design System: Table virtuelle MTG — surfaces du site

> **Portée.** Ce document couvre les **surfaces du site** : accueil, connexion /
> inscription, pages de jetons email, gestion des decks, éditeur de deck,
> apparence de deck, rapport d'import, salon d'une table, 404. Tout vit dans
> `src/styles/identity.css`.
>
> **La table de jeu a un monde visuel séparé et volontairement distinct** — dense,
> sombre, fonctionnel — documenté dans `docs/ui-reference.md` et implémenté dans
> `src/index.css` et les composants de table (`Table.tsx`, `SeatPanel.tsx`,
> `CardSprite.tsx`, `PlayerPanel.tsx`, `Toolbar.tsx`…). **Ce document ne la décrit
> pas, ne l'étend pas et ne la contredit pas.** Deux ponts délibérés relient les
> deux mondes, et rien d'autre : l'encre de tampon `#7c3aed` descend du violet des
> dés de la table `#9333ea`, et le sol `#0b0e14` est un cousin direct du fond de
> table `#111827`.

## Overview

**Creative North Star: « La papeterie de salle de tournoi »**

Une table de Magic ne se « lance » pas, elle se trouve et on s'y assied. Le site
est donc bâti sur la papeterie d'une salle de tournoi : le carton de table posé
debout, le talon de siège qu'on détache, le relevé qu'on lit pour savoir ce qui
n'est pas passé. La scène physique décide de la lumière : on est dans une salle,
la nuit, et la seule chose éclairée est le **papier posé sur le sol sombre**. Le
site ne s'éclaire donc jamais par un halo ou une lueur ; il s'éclaire par la
matière.

Une seule couleur saturée imprime la totalité du site — le violet de tampon. Elle
tient les filets, les gros chiffres, les mentions marquées et l'unique action
primaire de chaque écran. Le reste est du carton manille, de l'encre noire, et un
sol d'un noir bleuté.

Le monde a été choisi contre deux défauts de catégorie explicitement rejetés : le
héros sombre « fantasy » avec un bouton *Jouer* luminescent sur dégradé violet, et
son opposé exact, la landing SaaS blanche à trois cartes de fonctionnalités.

**Key Characteristics:**
- Le papier est la source de lumière ; le sol ne s'illumine pas.
- Une encre saturée, une seule, sur toute la surface.
- Grotesque condensé en capitales pour la signalétique ; Courier pour ce qui est
  réellement tapé ou relevé.
- Composition asymétrique avec un vide délibérément chargé.
- Le papier sert à ce qu'on **remplit et lit** ; le sombre à ce qu'on **manipule**.

## Colors

Un carton manille chaud et une encre noire posés sur un noir bleuté de salle, avec
un seul violet d'encre de tampon pour tout ce qui agit.

### Primary
- **Encre de tampon** (`#7c3aed`) : l'unique couleur saturée. Aplat plein de
  l'action primaire, filets de section (`.rule-stamp`), tracé des mentions
  tamponnées, bordure de focus sur papier. Jamais utilisée comme **texte** sur le
  sol sombre : son contraste y tombe à 2,9:1.
- **Encre de tampon profonde** (`#5b21b6`) : l'ombre basse de l'aplat primaire
  (`box-shadow: 0 3px 0`), et le texte violet sur papier (6,0:1).
- **Encre de tampon pâle** (`#bda6ff`) : la même encre transposée pour le sol
  sombre — liens, gros chiffres, titres d'étape, boutons au tracé. 8,4:1 sur le sol.

### Neutral — le papier
- **Carton manille** (`#e9e3d4`) : la face de toute plaque imprimée.
- **Pli du carton** (`#dcd4c1`) : la valeur d'un pli ou d'un repli.
- **Tranche du carton** (`#b9b09a`) : la tranche basse en `inset`, et la ligne
  de perforation du talon.
- **Encre noire** (`#16141b`) : le texte imprimé, les filets de 2 px, le tracé des
  boutons secondaires sur papier. 15:1 sur le carton.
- **Encre secondaire** (`#5c5647`) : le texte de second rang sur papier. 5,5:1 —
  teintée depuis le papier, jamais un gris neutre.

### Neutral — le sol
- **Sol de la salle** (`#0b0e14`) : le fond de toutes les surfaces du site.
- **Sol relevé** (`#141926`) : les panneaux de travail (éditeur, apparence).
- **Filet de sol** (`#2a2f3c`) : les séparateurs de 1 px et le tracé des boutons
  secondaires sur sol.
- **Craie** (`#e9e5db`) : le texte principal sur le sol.
- **Craie éteinte** (`#a09b8d`) : le texte de second rang sur le sol. 6,3:1.

### Tertiary — l'alarme
- **Alarme sur papier** (`#8c2438`) et **alarme sur sol** (`#f0a1ae`) : le rouge
  n'appartient pas au système, il ne sert qu'à ce qui échoue ou ce qui efface. Un
  message d'erreur est **encadré d'un tracé de 2 px**, jamais barré d'un liseré
  latéral coloré.

### Named Rules
**La règle de l'encre unique.** Une seule couleur saturée sur toute la page, et
elle n'a qu'une valeur par support : `#7c3aed` sur papier, `#bda6ff` sur le sol.
Un second accent chromatique est un défaut, pas une variation.

**La règle de la source de lumière.** L'action primaire est l'objet le plus clair
de son écran, et tout le reste descend d'un cran. Le sol ne porte jamais de halo
ni de lueur : la lumière vient du papier.

**La règle des deux ponts.** Le seul héritage autorisé depuis le monde de la table
est le violet des dés et la parenté du sol. Aucune autre valeur ne traverse, dans
aucun sens.

## Typography

**Display Font:** Archivo (variable, `wdth` 62–125, `wght` 400–900), auto-hébergée
sous `public/fonts/`, avec repli `system-ui, 'Segoe UI', sans-serif`.
**Body Font:** la même famille, à largeur normale.
**Label/Mono Font:** Courier Prime, auto-hébergée, avec repli
`ui-monospace, 'Courier New', monospace`.

**Character:** Archivo est un grotesque américain de signalétique et d'imprimé
administratif : lourde et condensée à 78 % de largeur elle crie un numéro de
table, à largeur normale elle lit comme un formulaire. Courier Prime est la
machine à écrire du relevé : elle ne décore rien, elle porte ce qui a
littéralement été tapé.

### Hierarchy
- **Display** (800, `wdth` 78, `clamp(2.7rem, 8.4vw, 5.1rem)`, 0.92, `-0.015em`,
  capitales) — la classe `.sign`. Le titre de signalétique du premier écran, le
  code d'une table, le titre d'une page.
- **Headline** (800, `wdth` 78, `clamp(1.6rem, 3.4vw, 2.3rem)`, 0.92, capitales) —
  `.sign` à l'échelle de section.
- **Title** (700, `wdth` 84, 0.78–1 rem, 1.05, `0.02em`, capitales) — `.sign-sm`.
  Titres de plaque, en-têtes de bloc, libellés de bouton.
- **Body** (400, 0.92–1.02 rem, 1.625) — mesure plafonnée entre **46ch et 58ch**
  selon la colonne ; jamais au-delà.
- **Label** (700, `wdth` 84, 0.64–0.68 rem, `0.1em`, capitales) — `.paper-label`
  et les étiquettes de champ.
- **Mono** (400, 0.7–0.9 rem, 1.75, `tabular-nums`) — `.typed`.

### Named Rules
**La règle de la Courier honnête.** Courier ne sert **jamais** à signifier
« technique ». Elle ne porte que ce qui est réellement tapé, relevé ou compté : un
code de table, une liste de deck, un compteur, un numéro de ligne, un nombre de
cartes, un code d'édition. `.typed` gagne toujours sur la face du champ qui le
porte.

**La règle du titre sans étiquette.** Aucun kicker, aucun eyebrow au-dessus d'un
titre. Le titre porte son propre poids.

## Layout

Conteneur principal `max-width: 78rem` (accueil, decks : `72rem`), gouttière
`1.25rem` en étroit et `2rem` à partir de `640px`. Les pages de formulaire se
resserrent à `26rem`, le salon à `34rem`.

Le premier écran de l'accueil est une grille asymétrique
`minmax(0,1.04fr) minmax(0,0.96fr)` à partir de `1024px`, qui s'empile en une
colonne en dessous. La colonne gauche porte le titre, la promesse et les deux
gestes ; la droite porte la preuve. Entre les deux, un vide délibéré : aucun
troisième panneau ne vient le combler.

Rythme : `gap` de 12 (3rem) entre colonnes, `mt-9` (2.25rem) avant une plaque,
`mt-12` avant une nouvelle section, et **toujours plus d'espace au-dessus d'un
titre qu'en dessous**. Les sections se séparent par un filet — `.rule-stamp`
(2 px violet) pour une rupture forte, `.rule-floor` (1 px) pour une respiration.

Le seul point de rupture réellement utilisé est `sm` (640px) et `lg` (1024px).
Cible étroite de référence : **390 × 844**. Sur cette largeur, le premier écran de
l'accueil doit contenir le titre, la promesse et l'action primaire complète — c'est
la contrainte de composition la plus dure du système, parce que la majorité des
visiteurs arrivent par un lien d'invitation ouvert sur téléphone.

## Elevation & Depth

Système **hybride, et matériel** : le papier est un objet posé sur un sol, donc il
porte une vraie ombre portée — décalée vers le bas et floue — plus une tranche
claire en haut et sombre en bas, en `inset`. Les surfaces sombres, elles, sont
**tonales** : elles s'éclaircissent d'un cran (`floor` → `floor-lift`) et se
bordent d'un filet de 1 px, sans ombre.

### Shadow Vocabulary
- **Plaque posée** (`0 1px 0 rgba(255,255,255,0.55) inset, 0 -1px 0 #b9b09a inset,
  0 18px 38px -14px rgba(0,0,0,0.72), 0 4px 10px -4px rgba(0,0,0,0.5)`) : toute
  plaque `.paper` sans coin coupé.
- **Plaque à coin coupé** (`filter: drop-shadow(0 16px 26px rgba(0,0,0,0.62))
  drop-shadow(0 4px 8px rgba(0,0,0,0.45))` sur l'enveloppe `.cut-shadow`) : le
  `clip-path` emporterait une `box-shadow`, l'ombre passe donc sur l'enveloppe et
  suit la découpe.
- **Encre appuyée** (`0 3px 0 #5b21b6`) : l'aplat primaire. Ce n'est pas une ombre
  d'élévation, c'est l'épaisseur de l'encre ; elle disparaît à `:active` pendant
  que le bouton descend de 3 px.
- **Modale de travail** (`0 30px 70px -20px rgba(0,0,0,0.9)`) : l'éditeur de deck.

### Named Rules
**La règle de l'ombre décalée.** Toute ombre a un décalage vertical et un flou.
Un halo coloré sans décalage est une décoration, pas de la profondeur, et n'existe
pas dans ce système.

## Shapes

Le système est **majoritairement à angle vif** : les plaques de papier, les
boutons, les champs et les mentions tamponnées n'ont aucun rayon. Le rayon
n'apparaît que sur les surfaces de travail sombres (`6px`) et la vignette de table
(`10px`), où il signale un objet logiciel plutôt qu'un imprimé.

La seule découpe du système est le **coin coupé** de la plaque principale :
`clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)`. Elle
vient de l'objet — le carton de table à coin abattu — et non d'un effet. Elle ne
se décline pas : un second polygone dans ce système est un défaut.

Le second geste de forme est la **perforation** : `border-top: 2px dotted
#b9b09a`, tirée sur toute la largeur de la plaque, qui sépare le talon détachable
du reste. Elle ne s'emploie que là.

Les filets sont de **2 px** quand ils sont imprimés (encre ou tampon) et de
**1 px** quand ils séparent sur le sol.

## Components

### La marque
Une table vue du dessus et ses quatre places : un carré à coins arrondis en encre
de tampon, un carré central en papier, et quatre barres — celle du bas plus large,
c'est la place du joueur local. Dessin original, cinq rectangles, aucune
iconographie empruntée. Elle sert identiquement au favicon
(`public/favicon.svg`, rastérisé en 32 / 180 / 512) et au bloc-marque
(`Mark.tsx`, `Wordmark`).

### Buttons
- **Shape:** angle vif (`0`).
- **Primary (`.ink-button`):** aplat `#7c3aed`, texte blanc, capitales `wdth` 84,
  `letter-spacing: 0.04em`, padding `14px 20px`, ombre d'encre `0 3px 0 #5b21b6`.
  **Un seul par écran.**
- **Hover / Active:** fond `#8b52f5` ; à l'appui, `translateY(3px)` et l'ombre
  d'encre tombe à zéro — le bouton s'enfonce comme un tampon.
- **Disabled:** fond `#b9b09a`, texte `#46402f`, ombre `0 3px 0 #9c937d`.
- **Secondary sur papier (`.ink-outline`):** tracé d'encre de 2 px ; au survol, le
  tracé se remplit et le texte passe en papier.
- **Secondary sur sol (`.floor-button`):** tracé `#2a2f3c` de 2 px, texte
  `#a09b8d` ; au survol, tracé et texte passent en encre pâle.
- **Destructif (`.floor-button-danger`):** même bouton, tracé et texte virant au
  rouge d'alarme au survol uniquement.

### Chips — le choix imprimé (`.printed-choice`)
- **Style:** tracé d'encre de 2 px, capitales, angle vif.
- **State:** l'option retenue **s'imprime** — `aria-checked="true"` prend le fond
  d'encre et le texte devient du papier. Elle **ne s'entoure pas** d'un liseré de
  sélection : le changement d'état est un changement de matière.

### Le tampon (`.stamped`)
Mention encadrée d'un tracé de 2 px violet, capitales `0.1em`, inclinée de
`-1.6deg`, opacité 0,92. Variante `.stamped-on-floor` en encre pâle. Elle marque
un **fait** qu'on veut voir relevé (« Aucun moteur de règles », « Information
cachée », « 2 ligne(s) à revoir »), jamais un ornement.

### Cards / Containers
- **`.paper`** — la plaque : fond `#e9e3d4`, grain de bruit fractal SVG en
  `data:` URI en `multiply`, dégradé de lumière à 176°, tranches en `inset`,
  ombre portée. Padding `24px` (`28px` à partir de `sm`). Angle vif.
- **`.paper-cut`** — la plaque à coin coupé, toujours enveloppée de `.cut-shadow`.
- **`.dark-panel`** — la surface de travail : `#141926`, filet `#2a2f3c` de 1 px,
  rayon `6px`.
- Aucune carte imbriquée. Aucune grille de cartes icône + titre + texte comme
  structure de page.

### Inputs / Fields
- **Sur papier (`.paper-field`):** pas de boîte — une **ligne à remplir**. Fond
  transparent, `border-bottom: 2px solid #5c5647`, padding `6px 0 7px`. Au survol
  le trait passe en encre pleine ; au focus il passe en encre de tampon. Le
  placeholder est à `#6b6450` (4,9:1), jamais plus clair.
- **Le champ de code (`.code-field`):** même ligne, en Courier, `letter-spacing:
  0.32em`, capitales forcées, à très grande taille.
- **Sur sol (`.dark-field`):** fond `#0b0e14`, filet `#2a2f3c` de 1 px, rayon
  `6px`, focus en encre de tampon.
- **Error:** encadré d'un tracé de 2 px à la couleur d'alarme du support, avec
  `role="alert"`.

### Navigation
Bloc-marque à gauche, liens à droite en 0.85 rem sur `#a09b8d`, et une seule
action encadrée (`Créer un compte`) au tracé d'encre pâle qui se remplit au
survol. En étroit la barre passe à la ligne plutôt que de se réduire.

### Signature — la vignette de table (`TablePreview.tsx`)
La preuve du premier écran : la vraie table en miniature, rendue en DOM au
vocabulaire et aux couleurs de `docs/ui-reference.md` (panneau `#1f2937`, filets
`#374151`, liseré de siège, `−` `#dc2626` / `+` `#16a34a`), posée sur un résumé
en quelques chemins SVG du paysage d'aube du décor de table. Les cartes affichées
sont de vraies cartes : les noms viennent de `GET /api/cards/search`, les images
sont allées les chercher **chez Scryfall depuis le navigateur du visiteur**. Si
l'index ne répond pas, des dos de carte que nous dessinons nous-mêmes prennent le
relais. Elle ne rétrécit pas en étroit : elle **se recadre** (7/8.6 en portrait,
8/6.6 en paysage).

### Surfaces navigateur
Ce que le navigateur dessine porte aussi l'identité : `::selection` en encre de
tampon, anneau de focus `2px` en encre pâle (encre profonde sur papier),
ascenseurs `#2b3040` sur le sol, `text-underline-offset: 0.22em`, et
`tabular-nums` partout où un nombre est compté.

## Do's and Don'ts

### Do:
- **Do** poser sur papier ce qu'on **remplit ou lit** (formulaires, rapport
  d'import, salon) et garder sur le sol sombre ce qu'on **manipule** (liste de
  decks, éditeur, apparence) — une image de carte sur fond clair perd.
- **Do** n'accorder **qu'une seule** action primaire `.ink-button` par écran ;
  tout le reste est au tracé.
- **Do** rendre un état sélectionné par un **changement de matière** (l'encre prend
  le fond, le papier devient le texte), jamais par un liseré de couleur.
- **Do** réserver Courier à ce qui est tapé, relevé ou compté.
- **Do** laisser un grand vide délibéré plutôt que d'y poser un troisième panneau.
- **Do** vérifier chaque écran à **390 × 844** : l'action primaire doit tenir dans
  le premier écran.
- **Do** garder la mention légale de fan lisible — corps à `0.82rem` sur
  `#a09b8d` (6,3:1), jamais réduite ni davantage grisée. Elle est obligatoire.

### Don't:
- **Don't** écrire du texte en `#7c3aed` sur le sol sombre : c'est 2,9:1. Sur le
  sol, l'encre violette s'écrit `#bda6ff`.
- **Don't** poser un kicker ou un eyebrow au-dessus d'un titre.
- **Don't** introduire un second accent chromatique. Le rouge d'alarme n'en est pas
  un : il n'existe que pour l'échec et la suppression.
- **Don't** signaler une erreur par un `border-left` coloré — on l'encadre d'un
  tracé de 2 px.
- **Don't** décliner le coin coupé en d'autres polygones, ni employer la
  perforation ailleurs que sur le talon détachable.
- **Don't** éclairer le sol par un halo, un `glass`, un flou décoratif ou un
  dégradé de texte. La lumière vient du papier.
- **Don't** utiliser une police système comme voix d'affichage : les deux familles
  sont auto-hébergées sous `public/fonts/` (SIL Open Font License, voir
  `public/fonts/README.md`) et jamais chargées depuis un CDN tiers — le site est
  français et une requête par visite vers `fonts.gstatic.com` n'apporte rien ici.
- **Don't** héberger, proxifier ou mettre en cache le moindre asset de Wizards of
  the Coast. Les images de cartes sont chargées par le navigateur du visiteur
  depuis Scryfall, via `scryfallImage()`. Toute iconographie du site est une
  création originale.
- **Don't** étendre ce système à la table de jeu, ni importer le sien ici.

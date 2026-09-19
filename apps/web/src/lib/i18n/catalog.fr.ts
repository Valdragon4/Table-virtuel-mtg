/**
 * Le catalogue français — **la source**, pas une traduction.
 *
 * L'interface a été écrite en français, en dur, dans 39 composants. Ce fichier
 * reprend ces chaînes **telles quelles**, apostrophe typographique et guillemets
 * compris ; c'est l'anglais qui est le travail de traduction. Personne n'a le
 * droit d'« améliorer » un libellé au moment de l'extraire : ce serait changer
 * l'interface sous couvert de la traduire, et personne ne le verrait passer.
 *
 * Ce qu'il y a ici est un **échantillon d'amorce**, choisi pour couvrir les cas
 * durs (pluriel, interpolation, texte long, chaîne sans paramètre) et prouver
 * que la mécanique tient. Le reste des chaînes viendra composant par composant.
 *
 * Convention de clés : `domaine.nom`, le domaine étant l'écran ou le concept,
 * pas le fichier — un libellé qui déménage ne doit pas changer de clé.
 */

/**
 * Interpolation : `{nom}`. Pluriel : `{ one, other }`, et `count` choisit la
 * forme. Les types de `types.ts` lisent ces accolades ici même, dans la source
 * française : c'est le français qui fixe la signature d'appel de `t`.
 */
export const fr = {
  // — Boutons et mots communs ————————————————————————————————
  'common.cancel': 'Annuler',
  'common.confirm': 'Confirmer',
  'common.apply': 'Appliquer',
  'common.close': 'Fermer',
  'common.loading': 'Chargement…',
  'common.none': 'Aucune',
  'common.empty': 'Vide',

  // — Zones de jeu ———————————————————————————————————————————
  'zone.hand': 'Main',
  'zone.library': 'Bibliothèque',
  'zone.graveyard': 'Cimetière',
  'zone.exile': 'Exil',
  'zone.battlefield': 'Champ de bataille',
  'zone.command': 'Commandement',
  'zone.sideboard': 'Réserve',
  'zone.libraryTop': 'Dessus de la bibliothèque',
  'zone.libraryBottom': 'Dessous de la bibliothèque',

  // — Barre d'outils et table ————————————————————————————————
  'toolbar.mulligan': 'Mulligan',
  'toolbar.passTurn': 'Passer le tour',
  'toolbar.quickTokens': 'Jetons rapides',
  'toolbar.shortcuts': 'Raccourcis clavier',
  'toolbar.undo': 'Annuler sa dernière action (10 s)',
  'toolbar.playmat': 'Playmat et dos de carte',
  'table.concedeConfirm': 'Concéder la partie ?',
  'table.concede': 'Concéder',

  // — Cartes ————————————————————————————————————————————————
  'card.untap': 'Dégager',
  'card.changePrinting': 'Changer d’impression…',
  'card.createToken': 'Créer un jeton…',
  'card.copyAsToken': 'Copier en jeton',
  'card.destroyToken': 'Détruire le jeton',
  'card.attachTo': 'Attacher à… (cliquer la cible)',
  'card.detach': 'Détacher',
  'card.faceDown': 'Carte face cachée',
  'card.addPlusCounter': 'Ajouter un marqueur +1/+1',
  /** Texte long, volontairement : c'est le genre de chaîne qui casse un moteur naïf. */
  'card.handRevealed': 'Carte révélée : votre main est visible par toute la table',
  'search.noMatch': 'Aucune carte ne correspond.',
  'search.placeholder': 'Chercher une zone, une carte, un type… ou taper « ange »',

  // — Interpolation simple ———————————————————————————————————
  /** Vignette de marqueur : « 3 × +1/+1 ». */
  'counter.badge': '{value} × {kind}',
  /** Titre d'impression : « Sol Ring (LTC) ». */
  'printing.label': '{name} ({setCode})',

  // — Pluriels ———————————————————————————————————————————————
  /** Compte d'une pastille de zone : « 1 carte » / « 3 cartes ». */
  'card.count': { one: '{count} carte', other: '{count} cartes' },
  /** Journal : « Invité a pioché une carte » / « … a pioché 3 cartes ». */
  'log.drew': { one: '{who} a pioché une carte', other: '{who} a pioché {count} cartes' },
  /** Journal, pluriel **et** trois interpolations à la fois. */
  'log.revealedTop': {
    one: '{who} a révélé la carte du dessus de sa {zone} : {names}',
    other: '{who} a révélé les {count} cartes du dessus de sa {zone} : {names}',
  },
  'log.mulligan': {
    one: '{who} a pris un mulligan ({counter}) — 1 carte à remettre dessous',
    other: '{who} a pris un mulligan ({counter}) — {count} cartes à remettre dessous',
  },

  // — Langue ————————————————————————————————————————————————
  'prefs.language': 'Langue de l’interface',
  'prefs.languageHint':
    'S’applique partout, y compris en pleine partie, et se retient sur votre compte.',
  'prefs.languageSaving': 'Enregistrement…',
  'prefs.languageError': 'La langue n’a pas pu être enregistrée sur votre compte.',
  /** L'option d'édition de substitution : un réglage d'affichage, pour vous seul. */
  'prefs.localizedPrinting': 'Forcer une édition disponible dans ma langue',
  'prefs.localizedPrintingHint':
    'Affiche l’illustration d’une autre édition quand l’impression choisie n’existe pas dans votre langue, ou quand Scryfall n’en publie qu’un scan flou — le rendu est alors le plus net disponible dans votre langue. Ne change que ce que vous voyez : les autres joueurs voient toujours l’impression choisie. Sans effet sur les terrains de base, qui gardent leur édition.',
  /**
   * L'affichage des pastilles de mécaniques, éteint par défaut.
   *
   * Le libellé dit ce qu'on **allume**, et l'explication ce qu'on ne perd pas
   * en le laissant éteint : les mécaniques restent lisibles ailleurs, et le
   * réglage ne vaut que pour celui qui le coche.
   */
  'prefs.showKeywordBadges': 'Afficher la pastille de mécaniques sur les cartes',
  'prefs.showKeywordBadgesHint':
    'Ajoute sur chaque carte un petit compteur de mots-clés, qui ouvre le détail au clic. Sans lui, les mécaniques restent lisibles dans l’aperçu agrandi et par le menu de la carte. Ce réglage ne change que votre écran.',
  /** Repli d'illustration : la carte n'existe pas dans la langue choisie. */
  'card.imageFallback': 'Illustration anglaise : cette carte n’existe pas en {language}.',

  // ═══ Écrans hors partie ═══════════════════════════════════════════════════
  // Accueil, authentification, mes tables, mes decks, éditeur de deck.
  // Rien ici ne vient du serveur : les messages d'`ApiError` restent affichés
  // tels qu'ils arrivent, ce sont les seuls textes de ces écrans qui ne soient
  // pas traduisibles depuis le client.

  // — Mots communs de plus ———————————————————————————————————
  'common.save': 'Enregistrer',
  'common.sending': 'Envoi…',
  'common.edit': 'Modifier',
  'common.delete': 'Supprimer',
  'common.or': 'ou',
  'common.loadFailed': 'Chargement impossible.',
  'common.saveFailed': 'Enregistrement impossible.',

  // — Navigation ————————————————————————————————————————————
  'nav.myTables': 'Mes tables',
  'nav.myDecks': 'Mes decks',
  'nav.backHome': 'Retour à l’accueil',

  // — Temps relatif ——————————————————————————————————————————
  // Les unités ne s'accordent pas (« 3 min », « 3 h ») : pas de pluriel ici, et
  // c'est bien `{value}`, pas `{count}`, pour que personne ne croie le contraire.
  'time.justNow': 'à l\'instant',
  'time.minutesAgo': 'il y a {value} min',
  'time.hoursAgo': 'il y a {value} h',
  'time.daysAgo': 'il y a {value} j',

  // — Accueil ————————————————————————————————————————————————
  'home.modeCommanderDetail':
    'Jusqu’à 4 sièges, 40 points de vie, dégâts de commandant suivis par siège.',
  'home.modeDuelDetail': 'Deux joueurs, 20 points de vie.',
  'home.createFailed': 'Création impossible.',
  'home.heroLine1': 'Quatre sièges.',
  'home.heroLine2': 'Aucun arbitre.',
  'home.heroLine3': 'Un lien.',
  /*
   * Le chapeau est coupé en trois parce qu'un `<strong>` tient au milieu de la
   * phrase. L'ordre des mots change d'une langue à l'autre : ce sont donc trois
   * morceaux de phrase à traduire ensemble, jamais séparément.
   */
  'home.heroLeadBefore': 'Une table de Magic dans le navigateur qui n’applique',
  'home.heroLeadStrong': 'aucune règle',
  'home.heroLeadAfter':
    '. Vous arbitrez entre vous, comme autour d’une vraie table, et personne n’a besoin de compte pour s’asseoir.',
  'home.openTable': 'Ouvrir une table',
  'home.tableFormat': 'Format de la table',
  'home.opening': 'Ouverture…',
  'home.createTable': 'Créer la table et obtenir le lien',
  'home.addressIsLink': 'Son adresse est le lien : copiez-la, envoyez-la.',
  'home.codeAsk': 'On vous a envoyé un code ?',
  'home.pasteHeading': 'Et voilà ce que vous collez',
  'home.pasteDetail':
    'Telle quelle, dans une zone de texte. Ou une URL Archidekt. Ou un export Moxfield. Ce qui n’est pas reconnu vous est rendu ligne par ligne, plutôt qu’avalé en silence.',
  'home.step1Title': 'Vous ouvrez la table',
  'home.step1Detail':
    'Un format, un bouton. L’adresse de la page est le lien d’invitation ; il n’y a rien d’autre à configurer.',
  'home.step2Title': 'Chacun colle son deck',
  'home.step2Detail':
    'Une URL Archidekt, une liste collée telle quelle, ou un export Moxfield. La liste est relue et ce qui coince vous est dit, ligne par ligne.',
  'home.step3Title': 'Vous jouez, et vous arbitrez',
  'home.step3Detail':
    'Le logiciel déplace, mélange, pioche et compte. Il ne dit jamais qu’un geste est illégal : c’est votre table.',
  'home.noRulesTitle': 'Le logiciel ne dit jamais non',
  /* Même découpe qu'au chapeau : le nombre de cartes indexées est au milieu. */
  'home.noRulesBefore':
    'Pas de pile, pas de priorité, pas de « vous ne pouvez pas faire ça ». Vous posez, vous engagez, vous déplacez ; la carte la plus tordue de',
  'home.noRulesAfter':
    'cartes indexées se joue comme les autres, et vos formats maison aussi. Les désaccords se règlent comme à la vraie table : en parlant.',
  'home.stampNoRules': 'Aucun moteur de règles',
  'home.hiddenTitle': 'Votre bibliothèque n’est pas dans votre navigateur',
  'home.hiddenDetail':
    'Elle est sur le serveur, et il n’en publie rien — pas même à vous. Une carte en bibliothèque n’a aucun identifiant diffusé, et un mélange les réattribue tous, pour qu’aucun relevé avant/après ne reconstitue l’ordre. Ce n’est pas une promesse de bonne conduite : c’est la façon dont la table est construite, et les tests s’en assurent.',
  'home.stampHidden': 'Information cachée',
  'home.accountTitle': 'Le compte ne sert pas à jouer',
  'home.accountDetail':
    'Il garde vos decks d’une partie à l’autre, vos playmats et vos réglages. Pour vous asseoir à une table, il ne sert à rien — et ce n’est pas un oubli.',

  // — Compte : connexion, inscription ————————————————————————
  'auth.login': 'Se connecter',
  'auth.logout': 'Se déconnecter',
  'auth.createAccount': 'Créer un compte',
  'auth.createAccountSubmit': 'Créer le compte',
  'auth.email': 'Email',
  'auth.password': 'Mot de passe',
  'auth.passwordRule': 'Au moins 10 caractères.',
  'auth.displayName': 'Pseudo affiché à table',
  'auth.forgotPassword': 'Mot de passe oublié',
  'auth.registered':
    'Compte créé. Un email de confirmation vient de partir — en développement, il est écrit dans les logs du serveur.',
  'auth.failed': 'Échec.',
  /* Le repli quand le serveur ne donne pas d'indication : celle-là est à nous. */
  'auth.errorHint': 'Corrigez le champ concerné, puis renvoyez le formulaire.',
  'auth.createOne': 'En créer un',
  'auth.sitWithout': 'vous asseoir sans',
  'auth.asideNoAccount': '. Pas de compte ?',
  'auth.asideRemind': '. Et rappel utile : le compte ne sert pas à jouer, vous pouvez',
  'auth.alreadyRegistered': 'Déjà inscrit ?',
  'auth.asideAccountKeeps':
    '. Le compte garde vos decks, vos playmats et vos réglages — il n’est jamais exigé pour rejoindre une table.',
  'auth.backToTableAsGuest': 'retourner à la table en invité',

  // — Liens reçus par email ——————————————————————————————————
  'token.missingToken': 'Lien incomplet : le jeton est absent.',
  'token.verifyTitle': 'Confirmation de l’adresse email',
  'token.verifying': 'Vérification en cours…',
  'token.verified': 'Adresse confirmée. Votre compte est actif.',
  'token.verifyFailed': 'Vérification impossible.',
  'token.verifyExpiredHint':
    'Les liens expirent au bout de 24 heures et ne servent qu’une fois. Connectez-vous puis demandez un nouvel envoi.',
  'token.resetTitle': 'Nouveau mot de passe',
  'token.resetSubmit': 'Changer le mot de passe',
  'token.resetFailed': 'Réinitialisation impossible.',
  'token.resetDone':
    'Mot de passe changé. Toutes vos sessions ont été fermées ; redirection vers la connexion…',
  'token.forgotSubmit': 'Envoyer le lien',
  'token.forgotSent':
    'Si un compte existe pour cette adresse, un lien de réinitialisation vient d’y être envoyé. Il expire dans une heure.',

  // — Mes tables —————————————————————————————————————————————
  'tables.intro':
    'Les parties où vous avez une place. Revenir ne coûte rien : votre siège, votre main et votre bibliothèque vous attendent.',
  'tables.emptyTitle': 'Aucune table en cours.',
  'tables.emptyDetail': 'Ouvrez-en une depuis l\'accueil, ou collez le lien que l\'on vous a envoyé.',
  'tables.closedHeading': 'Tables closes',
  'table.statusLobby': 'Salon',
  'table.statusPlaying': 'Partie en cours',
  'table.statusEnded': 'Terminée',
  'table.host': 'Hôte',
  'table.yourSeat': 'votre siège nº{index}',
  'table.notSeated': 'vous n’y êtes pas encore assis',
  'table.playersAtTable': { one: '{count} joueur à table', other: '{count} joueurs à table' },
  'table.join': 'Rejoindre',
  'table.returnTo': 'Revenir à la table',
  'table.leave': 'Quitter la table',
  'table.close': 'Clore la table',
  'table.leaveFailed': 'Départ impossible.',
  'table.closeFailed': 'Clôture impossible.',
  /* Les confirmations de « Mes tables » nomment la table : on en a plusieurs sous
     les yeux, et rien ne dit laquelle on est en train de fermer. */
  'table.leaveWhilePlayingConfirmCode':
    'Quitter la table {code} pendant la partie ? Cela vaut concession : votre jeu quitte le terrain et la partie continue sans vous.',
  'table.leaveConfirmCode': 'Quitter la table {code} ? Votre place et votre deck y sont libérés.',
  'table.closeConfirmCode':
    'Clore la table {code} pour tout le monde ? La partie s\'arrête pour tous les joueurs.',

  // — Quitter la table, depuis la table ——————————————————————
  'table.leaveNow': 'Quitter',
  'table.leaveNowHint':
    'Revenir à l’accueil. Votre siège reste tenu : main, bibliothèque et terrain vous attendent.',
  'table.leaveMore': 'Autres façons de quitter',
  'table.leaveMoreHint': 'Quitter pour de bon, ou clore la table',
  'table.leaveForGood': 'Quitter la table pour de bon',
  'table.leaveForGoodPlayingDetail': 'Vaut concession : votre jeu quitte le terrain.',
  'table.leaveForGoodDetail': 'Votre place et votre deck sont libérés.',
  'table.leaveWhilePlayingConfirm':
    'Quitter la partie ? Cela vaut concession : votre jeu quitte le terrain et la partie continue sans vous.',
  'table.leaveConfirm': 'Quitter la table ? Votre place et votre deck y sont libérés.',
  'table.closeConfirm':
    'Clore la table pour tout le monde ? La partie s’arrête pour tous les joueurs.',
  'table.closeDetail': 'La partie s’arrête pour tous les joueurs.',

  // — Mes decks ——————————————————————————————————————————————
  'decks.intro':
    'Ce que vous gardez ici vous suit d’une table à l’autre. Rien n’y est obligatoire : une liste collée directement au salon d’une table fonctionne tout aussi bien.',
  'decks.savedHeading': 'Decks enregistrés',
  'decks.empty':
    'Aucun deck pour l’instant. Importez-en un ci-dessus — ou jouez sans compte, en collant une liste directement au salon d’une table.',
  'deck.importFromUrl': 'Importer depuis une URL',
  'deck.moxfieldNote':
    'Archidekt est pris en charge directement. Pour Moxfield, passez par le collage : leur API n’est pas ouverte aux applications tierces, et nous ne la contournons pas.',
  'deck.import': 'Importer',
  'deck.importing': 'Import…',
  'deck.importFailed': 'Import impossible.',
  'deck.pasteList': 'Coller une liste',
  'deck.importPasted': 'Importer la liste collée',
  /* « Commander » et « Sideboard » restent en anglais au milieu de la phrase :
     ce sont les sections que le parseur reconnaît, pas des libellés. */
  'deck.pasteListNoteBefore':
    'Un export Moxfield, MTGO, TappedOut, ou une liste tapée à la main. Les sections',
  'deck.pasteListNoteAnd': 'et',
  'deck.pasteListNoteAfter': 'sont reconnues.',
  /** Le mot seul : le compte est affiché à part, dans son propre style. */
  'card.countWord': { one: 'carte', other: 'cartes' },
  'deck.syncedOn': 'synchronisé le {date}',
  'deck.look': 'Apparence',
  'deck.resync': 'Resynchroniser',
  /*
   * Impressions épinglées : les illustrations choisies à la main en partie, que
   * la resynchronisation conserve au lieu de les rendre à la source.
   *
   * Le mot « impression » est celui de Scryfall et du reste du code ; « choisie
   * à la main » dit au joueur de quoi il s'agit sans qu'il ait à connaître le
   * vocabulaire du catalogue.
   */
  'deck.pinnedPrintings': {
    one: 'Illustration choisie à la main',
    other: 'Illustrations choisies à la main',
  },
  'deck.pinnedRelease': 'Rendre à la source',
  'deck.pinnedReleaseHint':
    'La prochaine resynchronisation remettra les illustrations annoncées par la source. Le contenu du deck ne change pas.',
  'deck.pinnedKept': {
    one: '{count} illustration choisie à la main a été conservée.',
    other: '{count} illustrations choisies à la main ont été conservées.',
  },

  // — Éditeur de deck ————————————————————————————————————————
  'deck.unreadable': 'Deck illisible.',
  'deck.nameLabel': 'Nom du deck',
  'deck.listLabel': 'Liste du deck',
  'deck.modeList': 'Mode liste',
  'deck.modeText': 'Mode texte',
  'deck.modeSwitchConfirm':
    'Changer de mode abandonne les modifications non enregistrées. Continuer ?',
  'deck.syncedWarning':
    'Ce deck est synchronisé depuis {source}. L\'enregistrer le détachera de sa source : vos corrections seront conservées, mais la resynchronisation ne sera plus proposée.',
  'deck.emptyZone': 'Vide.',
  /*
   * Le filtre du deck. Le placeholder nomme les deux langues exprès : le nom
   * anglais reste la clé partout, et « flying » doit répondre autant que
   * « vol » — l'annoncer évite d'avoir à le découvrir.
   */
  'deck.filterLabel': 'Filtrer le deck',
  'deck.filterPlaceholder': 'Filtrer : nom, type, mot-clé (vol, flying…)',
  'deck.filterNoMatch': 'Aucune carte ne correspond.',
  /* Le compte du deck reste affiché à côté : celui-ci ne dit que ce que le
     filtre montre, pour qu'on ne lise jamais un deck plus petit qu'il n'est. */
  'deck.filterShown': { one: '{count} affichée', other: '{count} affichées' },
  'deck.unsavedChanges': 'Modifications non enregistrées',
  'deck.detachAndSave': 'Détacher de la source et enregistrer',
  'deck.addCard': 'Ajouter une carte',
  'deck.searchCard': 'Chercher une carte',
  'deck.cardNamePlaceholder': 'Nom de la carte…',
  'deck.addZone': 'Zone d\'ajout',
  /*
   * Ces libellés portent un nom de carte. Celui qu'on y met est le nom **lu à
   * l'écran** (le nom imprimé), jamais `row.name` : ce dernier est la clé du
   * catalogue anglais que l'enregistrement renvoie au serveur.
   */
  'deck.addOne': 'Ajouter un exemplaire de {name}',
  'deck.removeOne': 'Retirer un exemplaire de {name}',
  'deck.quantityOf': 'Quantité de {name}',
  'deck.zoneOf': 'Zone de {name}',
  'deck.remove': 'Retirer {name}',

  // — Impressions ————————————————————————————————————————————
  'printing.choose': 'Choisir une impression',
  'printing.edition': 'Édition',
  'printing.foil': 'Impression foil',
  'printing.normal': 'Impression normale',
  'printing.loading': 'Chargement des impressions…',
  'printing.noOther': 'Aucune autre impression.',

  // — Apparence d'un deck ————————————————————————————————————
  'look.playmat': 'Tapis de jeu',
  'look.playmatHint':
    'URL d\'une image. Elle est chargée par votre navigateur, jamais par notre serveur.',
  'look.playmatPreview': 'Aperçu du tapis',
  'look.playmatDefault': 'Tapis par défaut',
  'look.cardBack': 'Dos de carte',
  'look.cardBackHint': 'Laissez vide pour le dos par défaut.',
  'look.appliedOnLoad': 'Appliqué à votre zone au chargement du deck.',

  // — Composer son deck avant le lancement ———————————————————
  'pregame.title': 'Avant la partie',
  'pregame.intro':
    'Changez de deck, ou faites passer des cartes entre votre bibliothèque et votre réserve. Tout est encore modifiable tant que personne n’a lancé.',
  'pregame.loadedDeck': 'Deck chargé : {name}',
  'pregame.noDeck': 'aucun',
  'pregame.pasteInstead': '— coller une liste à la place —',
  'pregame.loadDeck': 'Charger ce deck',
  'pregame.loadWarning': 'Charger un deck remplace tout ce que vous avez sur la table.',
  'pregame.filterPlaceholder': 'Filtrer par nom…',
  'pregame.libraryHeading': 'Bibliothèque ({value})',
  'pregame.libraryEmpty': 'Aucune carte dans la bibliothèque.',
  'pregame.setAside': 'Mettre de côté →',
  'pregame.sideboardHeading': 'Réserve ({value})',
  'pregame.sideboardEmpty': 'Réserve vide.',
  'pregame.backToDeck': '← Remettre dans la bibliothèque',

  // ═══ Lot 1 : les composants de la table de jeu ═══════════════════════════
  //
  // Les chaînes ci-dessous sont recopiées **telles quelles** des composants
  // dont elles sortent, apostrophes comprises : certaines portent une
  // apostrophe droite (') parce que le composant l'écrivait ainsi, d'autres la
  // typographique (’) pour la même raison. Ne pas uniformiser : ce serait une
  // retouche d'interface déguisée en nettoyage.

  // — Boutons et mots communs (suite) ————————————————————————————
  'common.add': 'Ajouter',
  'common.remove': 'Retirer',
  'common.validate': 'Valider',
  'common.all': 'Tout',
  'common.place': 'Poser',
  'common.reveal': 'Révéler',
  'common.shuffle': 'Mélanger',
  'common.minimize': 'Minimiser',
  'common.expand': 'Agrandir',
  'common.clear': 'Effacer',
  'common.closeEsc': 'Fermer (Échap)',
  'common.value': 'Valeur',

  // — Zones (suite) ——————————————————————————————————————————
  'zone.commandFull': 'Zone de commandement',

  // — Cartes : gestes du menu contextuel ————————————————————————
  'card.tap': 'Engager',
  'card.play': 'Jouer',
  'card.playFaceDown': 'Jouer face cachée',
  'card.toStack': 'Mettre sur la pile',
  'card.revealAll': 'Révéler à tous',
  'card.revealTo': 'Révéler à…',
  'card.discard': 'Défausser',
  'card.exile': 'Exiler',
  'card.toHand': 'Vers la main',
  'card.toGraveyard': 'Au cimetière',
  'card.toBattlefield': 'Sur le champ de bataille',
  'card.nthFromTop': 'Nième depuis le dessus…',
  'card.toSideboard': 'Mettre dans la réserve',
  'card.shuffleIntoLibrary': 'Mélanger dans la bibliothèque',
  'card.castFromCommand': 'Lancer depuis la zone de commandement',
  'card.takeBackHand': 'Posée par erreur : reprendre en main',
  'card.takeBackHide': 'Posée par erreur : masquer à tout le monde',
  'card.peekFaceDown': 'Regarder (annoncé publiquement)',
  'card.shelveToken': 'Ranger ce jeton sur l’étagère',
  'card.confirmDestroyToken': 'Confirmer la destruction ?',
  'card.removePlusCounter': 'Retirer un marqueur +1/+1',
  'card.customCounter': 'Marqueur personnalisé…',
  'card.turnFaceUp': 'Retourner face visible',
  'card.turnFaceDown': 'Retourner face cachée',
  'card.transform': 'Transformer (recto-verso)',
  'card.faceDownShort': 'Face cachée',
  'card.generic': 'Carte',
  'card.selectedCard': 'Carte sélectionnée',
  'card.genericPermanent': 'Permanent',
  'card.selectedCount': '{count} sél.',
  'card.countersOnThis': 'Marqueurs sur cette carte',
  'card.counterOneLess': 'Un marqueur de moins',
  'card.counterOneMore': 'Un marqueur de plus',
  'card.counterRemove': 'Retirer ce marqueur',
  'card.counterEditHint': 'Régler ce marqueur, le renommer ou le retirer',
  'card.counterComputedHint': '{formula} — recalculé tout seul',
  'card.libraryPlaceTitle': 'Placer dans la bibliothèque',
  'card.libraryPlaceLabel': 'Position depuis le dessus (1 = dessus)',
  'card.revealDialogDescription': 'Seules les personnes cochées verront la carte.',
  'card.revealDialogRecipients': 'Destinataires',
  /** Toujours rendu au pluriel : l'entrée n'apparaît qu'à partir de deux cartes. */
  'card.alignSelection': { one: 'Aligner la carte', other: 'Aligner les {count} cartes' },
  'card.revealDialogTitle': {
    one: 'Révéler cette carte à…',
    other: 'Révéler {count} cartes à…',
  },
  'card.counterDialogTitle': {
    one: 'Poser un marqueur',
    other: 'Marqueur sur {count} cartes',
  },

  // — Cascade et Découvrir ————————————————————————————————————————
  /*
   * Le tiroir des actions assistées, offert sur **toutes** les cartes. Les deux
   * entrées qui suivent remontent dans le menu principal quand le catalogue sait
   * que la carte porte le mot-clé ; elles restent ici dans tous les cas, parce
   * que ne pas savoir n'est pas une raison de dire non.
   */
  'card.assistedActions': 'Actions assistées',
  'card.cascadeEntry': 'Cascade…',
  /* Le nombre est annoncé : l'entrée agit d'un clic, sans dialogue. */
  'card.cascadeWithValue': 'Cascade (valeur de mana {value})',
  'card.discoverEntry': 'Découvrir N…',
  'cascade.title': 'Cascade / Découvrir',
  'cascade.description':
    'Exile les cartes du dessus de votre bibliothèque une à une jusqu’à une carte qui n’est pas un terrain et qui convient. Elle reste à l’exil, face visible, et vous en faites ce que vous voulez ; le reste repart sous votre bibliothèque, dans un ordre aléatoire.',
  'cascade.modeLabel': 'Mot-clé',
  'cascade.modeBelow': 'Cascade (strictement inférieure)',
  'cascade.modeAtMost': 'Découvrir N (N ou moins)',
  'cascade.valueLabel': 'Valeur de mana',
  'cascade.modeHint':
    'La cascade s’arrête à la première carte non-terrain strictement en dessous de la valeur saisie ; « Découvrir N » s’arrête à N ou moins.',
  'cascade.suggested': 'Proposé d’après le coût de mana de {name} : {value}. Corrigez si votre carte dit autre chose.',
  'cascade.ambiguous':
    'Cette carte a plusieurs faces avec un coût : la valeur proposée est celle du recto, à vérifier.',
  'cascade.unknownCost': 'Le coût de cette carte n’est pas connu ici : saisissez la valeur vous-même.',
  'cascade.submit': 'Lancer la séquence',

  // — Découvrir sans N : le critère est un type ————————————————————
  /*
   * Le pendant de « Découvrir N », pour les cartes qui révèlent jusqu'à un
   * **type** plutôt que jusqu'à une valeur de mana. Le vocabulaire suit celui
   * des cartes françaises : « éphémère » et « rituel », jamais « instant » ni
   * « sorcery », et « bibliothèque » jamais « deck ».
   */
  'card.discoverTypeEntry': 'Découvrir par type…',
  'discover.title': 'Découvrir par type',
  'discover.description':
    'Exile les cartes du dessus de votre bibliothèque une à une jusqu’à une carte qui porte le type demandé. Elle reste à l’exil, face visible, et vous en faites ce que vous voulez ; le reste va où vous le dites ci-dessous.',
  'discover.criterionLabel': 'S’arrêter sur',
  'discover.criterionHint':
    'Comparé sur la ligne de type, les deux faces comprises. Rien n’est lu du texte de règles : c’est votre carte que vous recopiez ici.',
  'discover.searchPlaceholder': 'Type, ou sous-type (dragon, ange…)',
  'discover.groupTypes': 'Types de carte',
  'discover.groupSubtypes': 'Sous-types courants',
  'discover.permanent': 'Permanent (n’importe quel type de permanent)',
  'discover.subtypeOption': 'Sous-type « {name} »',
  'discover.unknownSubtype':
    '« {name} » n’est pas dans le lexique : il sera cherché tel quel sur la ligne de type, qui est en anglais.',
  /* Au singulier, contrairement aux `type.*` des pastilles de zone : ici on
   * désigne une carte, pas un tas. */
  'discover.type.creature': 'Créature',
  'discover.type.planeswalker': 'Planeswalker',
  'discover.type.land': 'Terrain',
  'discover.type.artifact': 'Artefact',
  'discover.type.enchantment': 'Enchantement',
  'discover.type.battle': 'Bataille',
  'discover.type.instant': 'Éphémère',
  'discover.type.sorcery': 'Rituel',
  'discover.restLabel': 'Le reste des cartes révélées',
  'discover.restHint':
    'Les cartes ne disent pas toutes la même chose — les unes le mettent au cimetière, d’autres sous la bibliothèque, d’autres en main. Désignez ce que dit la vôtre : rien n’est choisi à votre place.',
  'discover.restLibrary': 'Sous la bibliothèque, au hasard',
  'discover.restGraveyard': 'Au cimetière',
  'discover.restHand': 'En main',
  'discover.submit': 'Lancer la séquence',

  // — Marqueur personnalisé : aperçu et formulaire ————————————————
  'counter.preview': 'Aperçu en direct',
  'counter.modeFrozen': 'Figé à la pose',
  'counter.modeDynamic': 'Dynamique (en direct)',
  'counter.ptAdjust': 'Ajustement fixe de force / endurance : {pair}',
  'counter.namedDesc': 'Marqueur nommé « {kind} » : {value} posé(s)',
  'counter.keywordDesc': 'Capacité / Mot-clé « {kind} » conféré sans quantité',
  'counter.noneZero': '0 (aucun marqueur)',
  'counter.countFrozen': 'Décompte actuel : {base} {offset} = {final}',
  'counter.countDynamic': 'Décompte actuel : {base} {offset} → {preview}',
  'counter.offsetSuffix': '({offset} décalage)',
  'counter.zeroWarning':
    '⚠️ Le décompte donne 0 : aucun marqueur ne sera posé sur la carte, et le journal indiquera « 0 ».',
  'counter.willFreeze':
    'Ce marqueur figera la valeur {value} une fois pour toutes au moment de la pose (ne bougera plus ensuite).',
  'counter.tipTitle': '💡 Conseil de jeu',
  'counter.tipCalc':
    'Les marqueurs dynamiques sont recalculés côté client sans solliciter le serveur. Vous pouvez compter n’importe quel sous-type ou zone publique.',
  'counter.tipPlain':
    'Vous pourrez ajuster ou retirer ce marqueur à tout moment par double-clic ou via le menu contextuel.',
  'counter.fieldShape': 'Forme',
  'counter.shapePt': 'Force / endurance',
  'counter.shapeNamed': 'Nommé',
  'counter.shapeKeyword': 'Mot-clé',
  'counter.shapeCalc': 'Effets classiques',
  'counter.fieldBehaviour': 'Comportement',
  'counter.behaviourFollow': 'Force/endurance égales au décompte',
  'counter.behaviourAdd': 'Bonus par unité comptée',
  'counter.behaviourFrozen': 'Marqueurs posés une fois, figés',
  'counter.behaviourHint':
    'Les deux premiers suivent la zone comptée ; le troisième compte maintenant, puis ne bouge plus.',
  'counter.fieldFrozenShape': 'Forme du marqueur figé',
  'counter.frozenShapeSet': 'X/X — force et endurance fixées',
  'counter.frozenShapeAdd': '+X/+X — bonus global',
  'counter.frozenShapeCounters': '+1/+1 — X marqueurs individuels',
  'counter.frozenShapeNamed': 'Nommé (X marqueurs)',
  'counter.frozenShapeHint':
    '« X/X » pose un marqueur fixant la force/endurance (ex. 3/3). « +1/+1 » pose autant de marqueurs +1/+1.',
  'counter.fieldName': 'Nom du marqueur',
  'counter.fieldTemplate': 'Gabarit',
  'counter.tplBoth': '*/* — les deux',
  'counter.tplToughPlus1': '*/1+* — endurance +1',
  'counter.tplPowerPlus1': '1+*/* — force +1',
  'counter.tplBothMinus1': '*-1/*-1 — les deux -1',
  'counter.tplToughMinus1': '*/-1+* — endurance -1',
  'counter.tplPowerMinus1': '-1+*/* — force -1',
  'counter.tplAddBoth': '+1/+1 par unité',
  'counter.tplAddPower': '+1/+0 par unité',
  'counter.tplAddTough': '+0/+1 par unité',
  'counter.tplAddBothMinus': '+1/+1 (-1 au total)',
  'counter.fieldSource': 'Ce qu’on compte / Valeur à prendre',
  'counter.sourceHint':
    'Sous-types (ange, humain…), décomptes de zone, ou caractéristiques de cartes en jeu.',
  'counter.freeformNote':
    'Rien ne correspond à « {query} » dans le catalogue : il vous est proposé comme sous-type, et le décompte restera à zéro si ce n’en est pas un. {refusal}',
  'counter.fieldWho': 'Chez qui',
  'counter.whoController': 'Le contrôleur de la carte',
  'counter.whoOpponents': 'Ses adversaires',
  'counter.whoAll': 'Toute la table',
  'counter.whoHint':
    'Compter le cimetière d’en face est licite : il est public, et chacun le voit déjà.',
  'counter.fieldScope': 'Périmètre',
  'counter.scopeAll': 'Toutes les cartes',
  'counter.scopeOther': 'Autres cartes uniquement (exclure cette carte)',
  'counter.scopeHint':
    '« Autres cartes » ne compte pas cette carte si elle a le type/sous-type (ex. « pour chaque autre ange »).',
  'counter.fieldOffset': 'Ajustement (décalage de départ)',
  'counter.offsetNone': '0 (aucun)',
  'counter.offsetHint':
    'Modificateur appliqué au décompte (ex. -1 pour « nombre d’anges - 1 »). 0 par défaut.',
  'counter.fieldPair': 'Modification de force / endurance',
  'counter.pairHint': 'Deux nombres séparés d’une barre, X compris : +1/+1, -1/-1, +2/+0, X/X.',
  'counter.fieldCount': 'Nombre de marqueurs',
  'counter.countPlaceholder': 'un nombre, ou rien',
  'counter.countNone': 'aucun',
  'counter.countHint': 'Trois marqueurs +1/+1, et non « +3/+3 » : c’est la règle du jeu.',
  'counter.groupThisCard': 'Cette carte',
  'counter.groupBattlefield': 'Cartes sur le champ de bataille',
  'counter.prefixSelf': 'Cette carte : ',
  'counter.prefixNamed': '« {name} » : ',
  'counter.optPower': '{prefix}force ({value})',
  'counter.optToughness': '{prefix}endurance ({value})',
  'counter.optCounters': '{prefix}marqueurs ({value})',

  // — Menu de pile ———————————————————————————————————————————
  'zoneMenu.draw1': 'Piocher 1',
  'zoneMenu.drawHowMany': 'Piocher combien de cartes ?',
  'zoneMenu.scry1': 'Regard 1',
  'zoneMenu.scryHowMany': 'Regard combien ?',
  'zoneMenu.surveil1': 'Surveiller 1',
  'zoneMenu.surveilHowMany': 'Surveiller combien ?',
  'zoneMenu.peekTop': 'Regarder le dessus',
  'zoneMenu.peekHowMany': 'Regarder combien de cartes ?',
  'zoneMenu.mill1': 'Meuler 1',
  'zoneMenu.millHowMany': 'Meuler combien de cartes ?',
  'zoneMenu.exileTop': 'Exiler le dessus',
  'zoneMenu.exileHowMany': 'Exiler combien de cartes ?',
  'zoneMenu.exileTopFaceDown': 'Exiler le dessus, face cachée',
  'zoneMenu.exileFaceDownHowMany': 'Exiler combien de cartes, face cachée ?',
  'zoneMenu.searchLibrary': 'Chercher dans la bibliothèque',
  'zoneMenu.revealTopX': 'Révéler le dessus (X cartes)',
  'zoneMenu.revealHowMany': 'Révéler combien de cartes du dessus ?',
  'zoneMenu.revealTopOngoing': 'Révéler le dessus… (en cours)',
  'zoneMenu.revealTop': 'Révéler le dessus…',
  'zoneMenu.openZonePanel': 'Ouvrir le panneau des zones',
  'zoneMenu.openInZonePanel': 'Ouvrir dans le panneau des zones',
  'zoneMenu.graveyardToLibrary': 'Tout remettre dans la bibliothèque',
  'zoneMenu.cardCountLabel': 'Nombre de cartes',
  'zoneMenu.revealTopTitle': 'Révéler le dessus de ma bibliothèque',
  'zoneMenu.revealTopDescription':
    'La carte du dessus reste visible de ces joueurs et suit chaque pioche, chaque meule et chaque mélange. Ne cocher personne arrête la révélation.',
  'zoneMenu.revealTopVisibleBy': 'Visible par',

  // — Menu du fond de table ————————————————————————————————————
  'tableMenu.placeLabel': 'Poser une étiquette ici…',
  'tableMenu.placeMarker': 'Poser un marqueur ici…',
  'tableMenu.playerCounters': 'Compteurs de joueur…',
  'tableMenu.drawCard': 'Piocher une carte',
  'tableMenu.untapAll': 'Tout dégager',
  'tableMenu.shuffleLibrary': 'Mélanger la bibliothèque',
  'tableMenu.markerNameOptional': 'Nom du marqueur (facultatif)',
  'tableMenu.labelText': 'Texte de l’étiquette',
  'tableMenu.valuePlaceholder': '1/1, 3, ou rien',
  'tableMenu.helpPair': ': force et endurance, chacune réglable de son côté.',
  'tableMenu.helpNumber': ': un compteur à un chiffre.',
  'tableMenu.helpKeyword': ': un mot-clé, sans nombre à côté.',

  // — Compteurs de joueur ————————————————————————————————————
  'playerCounter.title': 'Compteurs de joueur',
  'playerCounter.none': 'Aucun compteur. Ajoutez-en un ci-dessous.',
  'playerCounter.customPlaceholder': 'Compteur personnalisé…',
  'playerCounter.removeTitle': 'Retirer ce compteur',
  'playerCounter.footer':
    'Les compteurs sont visibles de toute la table. Les remettre à zéro les retire.',
  'playerCounter.poison': 'Poison',
  'playerCounter.energy': 'Énergie',
  'playerCounter.experience': 'Expérience',
  'playerCounter.rad': 'Radiation',
  'playerCounter.ticket': 'Ticket',
  'playerCounter.city': "L'Initiative / Ville",

  // — Journal de partie : ce que le composant écrit lui-même ————————
  // Le **contenu** des lignes vient du serveur, en français (docs/i18n.md §7).
  'log.title': 'Journal',
  'log.chatHint': 'Écrire un message (Entrée)',
  'log.chatButton': 'Entrée pour parler',
  'log.empty': "Rien pour l'instant.",
  'log.collapse': 'Replier',
  'log.tableActor': 'Table',
  'log.messagePlaceholder': 'Votre message…',
  'log.expandCards': { one: 'Voir la carte', other: 'Voir les {count} cartes' },

  // — Raccourcis clavier : noms de touches ————————————————————————
  'keys.enter': 'Entrée',
  'keys.esc': 'Échap',
  'keys.delete': 'Suppr',
  'keys.wheel': 'Molette',
  'keys.drag': 'Glisser',
  'keys.altDrag': 'Alt + Glisser',
  'keys.rightDrag': 'Clic droit glissé',
  'keys.middleClick': 'Clic milieu',
  'keys.ctrlClick': 'Ctrl + Clic',
  'keys.dragCard': 'Glisser une carte',
  'keys.doubleClick': 'Double-clic',
  'keys.rightClick': 'Clic droit',

  // — Raccourcis clavier : gestes et aide ————————————————————————
  'shortcut.tapUntap': 'Engager / dégager',
  'shortcut.flipFace': 'Retourner face cachée / visible',
  'shortcut.plusCounter': 'Marqueur +1/+1',
  'shortcut.libraryTopBottom': 'Dessus / dessous de la bibliothèque',
  'shortcut.graveyardOrExile': 'Au cimetière / exiler',
  'shortcut.writeMessage': 'Écrire un message',
  'shortcut.clearSelection': 'Vider la sélection, fermer un menu',
  'shortcut.thisHelp': 'Cette aide',
  'shortcut.zoom': 'Zoomer',
  'shortcut.lasso': 'Lasso, depuis le fond : sélectionne vos permanents',
  'shortcut.lassoAll': 'Lasso incluant les permanents adverses',
  'shortcut.panTable': 'Déplacer la table',
  'shortcut.panTableAnywhere': "Déplacer la table, depuis n'importe où",
  'shortcut.toggleSelection': 'Ajouter ou retirer de la sélection',
  'shortcut.dropInZone': 'La déposer dans une autre zone',
  'shortcut.contextMenu': 'Menu de la carte, de la pile ou de la table',
  'shortcut.ruleLead': "Une touche agit d'abord sur la carte",
  'shortcut.ruleUnderCursor': 'sous le curseur',
  'shortcut.ruleOtherwise': ', sinon sur la',
  'shortcut.ruleSelection': 'sélection',
  'shortcut.ruleTable': 'table',
  'shortcut.groupHover': "Au survol d'une carte",
  'shortcut.groupHoverHint':
    "La carte sous le pointeur l'emporte sur la sélection. Pendant un glisser-déposer, le survol est ignoré.",
  'shortcut.sectionHand': 'En main',
  'shortcut.sectionPermanent': 'Permanent en jeu',
  'shortcut.sectionPile': 'Cimetière, exil, commandement',
  'shortcut.groupTable': 'Table et souris',
  'shortcut.groupTableHint':
    "Ces touches s'appliquent quand aucune carte n'est survolée ni sélectionnée.",
  'shortcut.sectionGlobal': 'Actions globales',
  'shortcut.sectionMouse': 'Souris',
  'shortcut.footerClose': 'Échap, ou un clic hors du panneau, referme cette aide.',
  'shortcut.footerReopen': 'la rouvre à tout moment.',

  // — Consultation et fouille de bibliothèque ————————————————————
  'consult.bucketTop': 'Dans la bibliothèque (dessus)',
  'consult.bucketTopShort': 'Biblio.',
  'consult.bucketTopHint': 'Remet sur le dessus, dans l’ordre affiché',
  'consult.bucketHand': 'En main',
  'consult.bucketHandShort': 'Main',
  'consult.bucketHandHint': 'Prend en main (tuteur classique)',
  'consult.bucketBattlefield': 'Sur le champ',
  'consult.bucketBattlefieldShort': 'Champ',
  'consult.bucketBattlefieldHint': 'Met directement sur le champ de bataille',
  'consult.bucketGraveyardHint': 'Met au cimetière (Entomb, etc.)',
  'consult.bucketExile': 'En exil',
  'consult.bucketExileHint': 'Exile la carte',
  'consult.bucketBottom': 'Au dessous (fond)',
  'consult.bucketBottomShort': 'Dessous',
  'consult.bucketBottomHint': 'Renvoie au fond de la bibliothèque',
  'consult.bucketSideboardHint': 'Met de côté, hors de la bibliothèque (avant de lancer la partie)',
  'consult.sortName': 'Nom (A-Z)',
  'consult.sortCost': 'Valeur de mana',
  'consult.sortType': 'Type',
  'consult.sortReceived': 'Ordre reçu',
  'consult.titleSearch': 'Recherche dans la bibliothèque',
  'consult.titleReveal': {
    one: 'Révélation de la bibliothèque — {count} carte',
    other: 'Révélation de la bibliothèque — {count} cartes',
  },
  'consult.titleLook': {
    one: 'Consultation — {count} carte',
    other: 'Consultation — {count} cartes',
  },
  'consult.subtitleReveal': 'Révélé à toute la table · Choisissez la destination de chaque carte',
  'consult.subtitleLook': 'Visible de vous seul · Double-clic sur une carte pour la prendre en main',
  'consult.densityLarge': 'Grand',
  'consult.densityLargeHint': 'Cartes grandes et lisibles',
  'consult.densityNormal': 'Normal',
  'consult.densityNormalHint': 'Taille standard',
  'consult.densityCompact': 'Compact',
  'consult.densityCompactHint': 'Vue compacte d’ensemble',
  'consult.filterPlaceholder': 'Filtrer par nom, type, texte…',
  'consult.sortLabel': 'Trier :',
  'consult.allCount': 'Tout ({count})',
  'consult.selectedCount': '{count} sélectionnée(s) :',
  'consult.backToDeck': 'Dans la bibliothèque',
  'consult.backToDeckTitle': 'Remettre dans la bibliothèque',
  'consult.selectAll': 'Tout sélectionner ({count})',
  'consult.deselect': 'Désélectionner',
  'consult.noMatch': 'Aucune carte ne correspond à ces critères.',
  'consult.resetFilters': 'Réinitialiser les filtres',
  'consult.details': 'Détails de la carte',
  'consult.manaCost': 'Coût de mana :',
  'consult.powerToughness': 'Force / Endurance :',
  'consult.quickAction': 'Action rapide :',
  'consult.summary': 'Synthèse :',
  'consult.sumHand': '{count} en main',
  'consult.sumBattlefield': '{count} sur le champ',
  'consult.sumGraveyard': '{count} au cimetière',
  'consult.sumExile': '{count} en exil',
  'consult.sumBottom': '{count} au fond',
  'consult.sumSideboard': '{count} en réserve',
  'consult.sumDeck': '{count} dans la bibliothèque',
  'consult.submitNoShuffle': 'Valider sans mélanger',
  'consult.submitShuffle': 'Valider et mélanger',
  'consult.cancelAssignment': 'Annuler (laisser dans la bibliothèque)',
  'consult.cardTitleHint': '{name} — Double-clic : prendre en main. Clic droit : menu d’actions.',
  'consult.inspect': 'Inspecter la carte en grand',
  'consult.pickForBulk': 'Sélectionner pour action groupée',
  'consult.quickHand': 'Prendre en main (tuteur)',
  'consult.quickBattlefield': 'Mettre sur le champ de bataille',
  'consult.moreActions': "Plus d'actions (Cimetière, Exil, Dessous…)",
  'consult.moveTo': 'Déplacer vers :',

  // — Familles de types ————————————————————————————————————————
  'type.creature': 'Créatures',
  'type.planeswalker': 'Planeswalkers',
  'type.land': 'Terrains',
  'type.artifact': 'Artefacts',
  'type.enchantment': 'Enchantements',
  'type.instant': 'Éphémères',
  'type.sorcery': 'Rituels',
  'type.other': 'Autres',
  'type.faceDown': 'Face cachée',
  'type.unknown': 'Type inconnu',

  // — Panneau des zones ————————————————————————————————————————
  'zonePanel.title': 'Zones',
  'zonePanel.searchPlaceholder': 'Filtrer par nom…',
  'zonePanel.emptyPile': 'Pile vide.',
  'zonePanel.chipHint': '{count} {family} dans cette zone',
  'zonePanel.hintOther': 'Types hors des grandes familles (bataille, donjon…)',
  'zonePanel.hintHidden': "Vous n'en voyez pas l'identité : leur type n'est pas compté",
  'zonePanel.hintUnknown':
    'Fiche pas encore chargée : ces cartes ne sont comptées nulle part ailleurs',
  'zonePanel.allShown': 'Toute la zone est affichée',
  'zonePanel.clearFilter': 'Retirer le filtre et réafficher toute la zone',
  'zonePanel.chipTitle': '{hint} · {action}',
  'zonePanel.chipShowAll': 'cliquer pour tout réafficher',
  'zonePanel.chipShowOnly': "cliquer pour n'afficher que celles-là",
  'zonePanel.total': { one: 'Tout · {count} carte', other: 'Tout · {count} cartes' },
  'zonePanel.unreachableHidden': {
    one: '{count} carte face cachée',
    other: '{count} cartes face cachée',
  },
  'zonePanel.unreachableUnknown': {
    one: '{count} carte de type inconnu',
    other: '{count} cartes de type inconnu',
  },
  'zonePanel.unreachableJoin': 'et',
  'zonePanel.unreachableNote':
    "hors de ce filtre : vous n'en connaissez pas le type. Leur pastille les affiche.",
  'zonePanel.footerCount': '{visible} / {total} carte(s)',
  'zonePanel.footerSelected': '· {count} sélectionnée(s)',
  'zonePanel.footerHelp':
    'Clic pour sélectionner, Ctrl+clic pour ajouter, Maj+clic pour une plage. Clic droit pour le menu, glisser vers la table pour déplacer.',
  'zonePanel.libraryCount': 'carte(s).',
  'zonePanel.libraryWarn1':
    "Le contenu d'une bibliothèque n'est pas connu du client, pas même du vôtre. L'ouvrir démarre une",
  'zonePanel.libraryWarnWord': 'consultation',
  'zonePanel.libraryWarn2':
    ", et les autres joueurs en sont informés dans le journal. L'ordre qui vous sera montré est brassé : ce n'est pas l'ordre réel de votre bibliothèque.",
  'zonePanel.peekTitle': 'Regarder le dessus de la bibliothèque',
  'zonePanel.peekLabel': 'Nombre de cartes à regarder',
  'zonePanel.peekButton': 'Regarder le dessus…',
  'zonePanel.libraryOthers':
    'Seul son propriétaire peut consulter cette bibliothèque, et il ne peut pas le faire discrètement.',

  // — Siège et piles ————————————————————————————————————————
  'seat.disconnected': 'déconnecté',
  'seat.turnMine': 'Tour {turn} · à vous',
  'seat.turn': 'Tour {turn}',
  'seat.revealingTop': '✨ révèle le dessus',
  'seat.lookingLibrary': '👁 consulte sa bibliothèque',
  'seat.handRevealed': 'main révélée',
  'seat.handCount': '{count} carte(s) en main',
  'seat.yourZone': 'Votre zone',
  'seat.attachedObjects': 'Objets attachés',
  'seat.commanderTaxNone': 'Taxe de commandant : aucune, il n’a pas encore été lancé',
  'seat.commanderTax': 'Taxe de commandant : +{tax} (lancé {casts} fois)',
  'seat.you': 'vous',
  'seat.meSuffix': '{name} (moi)',
  'seat.topRevealedMine': 'Le dessus de votre bibliothèque est révélé à {names}',
  'seat.topRevealedOther': 'Le dessus de cette bibliothèque est révélé à {names}',
  'seat.pileTitle': '{label} — {count}',

  // — Révélation publique ————————————————————————————————————
  'reveal.someone': 'Un adversaire',
  'reveal.altCard': 'Carte révélée',
  'reveal.hint':
    "Survolez une carte pour l'agrandir. Le joueur sélectionne actuellement les destinations.",
  'reveal.reopen': {
    one: '{who} révèle {count} carte',
    other: '{who} révèle {count} cartes',
  },
  'reveal.headline': {
    one: 'révèle {count} carte du dessus de sa bibliothèque',
    other: 'révèle {count} cartes du dessus de sa bibliothèque',
  },

  // — Modale du compte ———————————————————————————————————————
  // Ce qui est personnel au joueur : son identité et ses réglages. La modale
  // accueillera plus tard les amis et les tables publiques ; les sections
  // s'ajoutent une par une, quand elles existent.
  'account.title': 'Mon compte',
  /** Nom accessible du déclencheur : le pseudo seul ne dirait pas ce qu'il ouvre. */
  'account.openLabel': 'Ouvrir mon compte et mes réglages',
  'account.guest': 'Non connecté',
  'account.displaySection': 'Affichage',
  'account.displayHint':
    'La langue de l’interface, et ce que vous acceptez de voir changer pour l’obtenir.',

  // — Coût de mana ———————————————————————————————————————————
  // Ces libellés ne s'affichent jamais : ils sont l'énoncé du coût pour le
  // lecteur d'écran, qui ne peut rien faire d'une suite d'images. Le groupe
  // entier porte `mana.costLabel` ; les autres clés en composent le contenu.
  'mana.costLabel': 'Coût de mana : {cost}',
  'mana.white': 'blanc',
  'mana.blue': 'bleu',
  'mana.black': 'noir',
  'mana.red': 'rouge',
  'mana.green': 'vert',
  'mana.colorless': 'incolore',
  'mana.snow': 'neige',
  /** Vaut pour les chiffres comme pour les variables : « 2 générique », « X générique ». */
  'mana.generic': '{amount} générique',
  /** Le séparateur d'un hybride : « blanc ou bleu ». */
  'mana.or': 'ou',
  'mana.phyrexian': '{part} phyrexian',
  'mana.tap': 'engager',
  'mana.untap': 'dégager',
  'mana.energy': 'énergie',

  // — Console d'administration ———————————————————————————————
  // Ce n'est pas un écran de persuasion : c'est ce qu'on ouvre quand quelque
  // chose ne va pas. Les libellés nomment des faits, pas des intentions.
  'admin.title': 'État de la plateforme',
  'admin.intro':
    'Ce que la base sait dire de la plateforme, et rien de ce qu’elle sait dire d’une partie : des comptes, des compteurs et des dates. Aucun contenu de table ne passe par ici.',
  'admin.deniedTitle': 'Il n’y a rien ici',
  'admin.deniedDetail':
    'Cette adresse ne répond pas. Si vous administrez cette instance, vérifiez que vous êtes connecté avec une adresse inscrite dans ADMIN_EMAILS et que son email est vérifié.',
  'admin.refresh': 'Rafraîchir',
  'admin.updatedAt': 'Relevé {time}',

  'admin.sectionPlatform': 'Santé',
  'admin.sectionAccounts': 'Comptes',
  'admin.sectionTables': 'Tables',
  'admin.sectionCatalog': 'Catalogue',
  'admin.sectionUsers': 'Consulter les comptes',
  'admin.sectionRooms': 'Consulter les tables',
  'admin.sectionAudit': 'Journal d’administration',

  'admin.statLiveRooms': 'Tables en mémoire',
  'admin.statProtocol': 'Protocole',
  'admin.statSessionsActive': 'Sessions valides',
  'admin.statSessionsStale': 'Sessions expirées non purgées',

  'admin.statAccounts': 'Comptes',
  'admin.statVerified': 'Emails vérifiés',
  'admin.statUnverified': 'Emails non vérifiés',
  'admin.statActiveDay': 'Vus sous 24 h',
  'admin.statActiveWeek': 'Vus sous 7 j',
  'admin.statActiveMonth': 'Vus sous 30 j',
  'admin.statNewWeek': 'Créés sous 7 j',
  'admin.statNewMonth': 'Créés sous 30 j',
  'admin.statAdmins': 'Adresses administratrices',

  'admin.statTables': 'Tables au total',
  'admin.statLobby': 'En salon',
  'admin.statPlaying': 'En cours',
  'admin.statEnded': 'Rangées',
  'admin.statTablesActiveDay': 'Actives sous 24 h',
  'admin.statTablesNewWeek': 'Ouvertes sous 7 j',
  'admin.statSeats': 'Sièges occupés',
  'admin.endedNote':
    'Une table « rangée » porte le statut ENDED. Deux chemins y mènent et la base ne les distingue pas : l’hôte qui clôt sa table, et le ménage automatique qui libère une table vide inactive depuis six heures.',

  'admin.statDecks': 'Decks',
  'admin.statDeckOwners': 'Comptes avec un deck',
  'admin.statCards': 'Cartes',
  'admin.statTokens': 'Jetons',
  'admin.statLocalizations': 'Traductions résolues',
  'admin.statPrintings': 'Impressions traduites',

  'admin.ingestTitle': 'Dernière ingestion',
  'admin.ingestNever': 'Aucune ingestion n’a jamais tourné sur cette instance.',
  'admin.ingestOk': 'Réussie',
  'admin.ingestFailed': 'Échouée',
  'admin.ingestRunning': 'En cours',
  'admin.ingestAge': 'Matière datée de {hours} h',
  'admin.ingestUpserted': '{count} cartes écrites',
  'admin.ingestFailedWeek': '{failed} échec(s) sur {runs} passage(s) en 7 jours',

  'admin.searchLabel': 'Chercher un compte',
  'admin.searchPlaceholder': 'Adresse ou pseudo',
  'admin.noResults': 'Aucun compte ne correspond.',
  'admin.showingOf': '{shown} affichés sur {total}',
  'admin.colAccount': 'Compte',
  'admin.colCreated': 'Créé',
  'admin.colLastSeen': 'Vu',
  'admin.colDecks': 'Decks',
  'admin.colSeats': 'Sièges',
  'admin.colSessions': 'Sessions',
  'admin.badgeAdmin': 'Admin',
  'admin.badgeUnverified': 'Non vérifié',

  'admin.openRecord': 'Ouvrir la fiche',
  'admin.detailSeats': 'Tables où ce compte a une place',
  'admin.detailNoSeats': 'Ce compte n’a de place à aucune table.',
  'admin.seatedWarning':
    'Ce compte est assis à une table qui n’est pas rangée. Prévenez-le avant d’agir sur son accès.',
  'admin.seatLine': 'siège {index}',

  'admin.revoke': 'Révoquer ses sessions',
  'admin.revokeConfirm':
    'Déconnecter {name} de tous ses appareils ? Il pourra se reconnecter avec son mot de passe. Une partie déjà ouverte n’est pas interrompue.',
  'admin.revokeDone': '{count} session(s) révoquée(s).',
  'admin.revokeFailed': 'La révocation a échoué.',
  'admin.revokeUnlogged':
    'Sessions révoquées, mais le journal n’a pas pu être écrit. À signaler.',
  'admin.noDeleteNote':
    'La suppression d’un compte n’est pas offerte ici : elle emporte en cascade ses decks et ses sessions, et laisse un siège orphelin si le compte est assis à une table en cours. Un compte peut se supprimer lui-même depuis ses paramètres.',

  'admin.roomsAll': 'Toutes',
  'admin.colTable': 'Table',
  'admin.colHost': 'Hôte',
  'admin.colActivity': 'Activité',
  'admin.roomPrivate': 'Privée',
  'admin.roomPassword': 'Mot de passe',
  'admin.noRooms': 'Aucune table ne correspond.',

  'admin.auditEmpty': 'Aucune action d’administration n’a encore été journalisée.',
  'admin.auditLine': '{actor} — {action} sur {target}',

  // — Horodatages ————————————————————————————————————————————
  // Un tableau de bord s’ouvre quand quelque chose ne va pas, et l’on y cherche
  // « depuis quand ». Une date absolue seule oblige à calculer ; un relatif seul
  // empêche de recouper avec un journal serveur. On donne les deux.
  'admin.colOpened': 'Ouverte',
  'admin.colJoined': 'Assis',

  // — Le fil des dernières actions ——————————————————————————
  'admin.sectionActivity': 'Dernières actions',
  'admin.activityNote':
    'Ce qui s’est passé sur l’instance, toutes sources mêlées et trié par date : comptes créés, connexions, tables ouvertes, places prises, ingestions, actions d’administration. Les actions de jeu n’y sont pas : elles ne sont pas enregistrées en base. La clôture d’une table non plus : aucune colonne ne la date.',
  'admin.activityEmpty': 'Rien ne s’est encore passé sur cette instance.',
  'admin.actAccountCreated': 'Compte créé',
  'admin.actSessionOpened': 'Connexion',
  'admin.actTableOpened': 'Table ouverte',
  'admin.actSeatJoined': 'Place prise',
  'admin.actIngest': 'Ingestion',
  'admin.actAdmin': 'Administration',

  // — Le replay ——————————————————————————————————————————————
  'replay.title': 'Replay',
  'replay.loading': 'Chargement du replay…',
  'replay.notFound': 'Il n’y a pas de replay ici',
  'replay.notFoundBody':
    'L’adresse ne correspond à rien, ou la partie n’est pas terminée. Un replay n’existe qu’une fois la partie finie — c’est ce qui empêche d’aller lire la main de ses adversaires en pleine partie.',
  'replay.networkError': 'Le replay n’a pas pu être chargé. Réessayez.',
  'replay.viewLabel': 'Point de vue',
  'replay.viewAll': 'Tout voir',
  'replay.viewAllHint': 'La partie révélée : mains, bibliothèques, pioches.',
  'replay.viewSeatHint': 'Ce que ce joueur voyait à cet instant précis.',
  'replay.first': 'Début',
  'replay.previous': 'Pas précédent',
  'replay.next': 'Pas suivant',
  'replay.last': 'Fin',
  'replay.play': 'Lecture',
  'replay.pause': 'Pause',
  'replay.position': 'Pas {current} sur {total}',
  'replay.truncated':
    'L’enregistrement a atteint sa limite : la partie continue au-delà de ce que ce replay montre.',
  'replay.backToTable': 'Retour à la table',

  // — Partager un replay ————————————————————————————————————
  'replay.shareTitle': 'Partager ce replay',
  'replay.shareNote':
    'Le lien montre la partie entière, à qui le détient : les mains, les bibliothèques et les pioches de tous les joueurs, pas seulement les vôtres.',
  'replay.shareCreate': 'Créer un lien de partage',
  'replay.shareRevoke': 'Fermer le partage',
  'replay.shareCopied': 'Lien copié.',
  'replay.shareNone': 'Ce replay n’est pas partagé.',
  'replay.open': 'Voir le replay',
  'replay.home': 'Retour à l’accueil',

  // — Actions assistées : jetons nommés, amasser, peupler, proliférer ————
  /*
   * Ajouté en fin de fichier exprès : un autre chantier y ajoute des clés au
   * même moment, et réordonner ce catalogue ferait perdre le seul contrôle
   * humain qui vaille — relire le français et l'anglais côte à côte.
   */
  'assist.namedTokens': 'Créer un jeton nommé…',
  'assist.tokensTitle': 'Jeton nommé',
  'assist.tokensDescription':
    'Le mot-clé ne fait que nommer ce qu’on crée : le jeton est posé tel quel, sans rien de plus. Les autres jetons se trouvent par la recherche et se rangent sur l’étagère.',
  'assist.tokensSubmit': 'Créer',
  'assist.tokenLabel': 'Jeton',
  'assist.tokenClue': 'Indice (Enquêter)',
  'assist.tokenTreasure': 'Trésor',
  'assist.tokenFood': 'Nourriture',
  'assist.tokenBlood': 'Sang',
  'assist.tokenIncubator': 'Incubateur (Incuber)',
  'assist.tokenCountLabel': 'Combien',
  'assist.tokenIncubateLabel': 'Marqueurs +1/+1 sur l’Incubateur',
  'assist.tokenIncubateHint':
    'Le nombre est dans le texte de votre carte, que nous ne stockons pas : c’est à vous de le dire.',
  'assist.tokenMissingTitle': 'Jeton introuvable',
  'assist.tokenMissing':
    'Le catalogue local ne contient aucun jeton nommé exactement « {name} ». Rien n’a été créé : passez par la recherche de jetons pour choisir vous-même.',
  'assist.armyMissing':
    'Le catalogue local ne contient aucun jeton de type Armée. Rien n’a été créé : passez par la recherche de jetons pour choisir vous-même.',
  'assist.amassNew': 'Amasser N — nouveau jeton Armée…',
  'assist.amassThis': 'Amasser N — sur cette carte…',
  'assist.amassTitle': 'Amasser',
  'assist.amassLabel': 'Marqueurs +1/+1',
  'assist.amassSubmit': 'Amasser',
  'assist.amassArmyDescription':
    'Amasser crée l’armée que votre carte nomme — zombies, orques, gobelins… Nous ne lisons pas le texte de règles : voici celles que le catalogue connaît, à vous de désigner la vôtre. Toute autre armée se trouve par la recherche de jetons.',
  'assist.amassArmyLabel': 'Quelle armée',
  'assist.amassArmyHint':
    'Rien n’est présélectionné : cette liste est ce que contient le catalogue, pas une recommandation.',
  'assist.populate': 'Peupler (copier ce jeton)',
  'assist.proliferateOne': 'Proliférer sur cette carte',
  'assist.proliferateMany': 'Proliférer sur {count} cartes',
} as const;

/** La forme du catalogue : c'est le français qui la définit, toujours. */
export type Catalog = typeof fr;

/** Toutes les clés traduisibles. `t` n'accepte que celles-là. */
export type CatalogKey = keyof Catalog;

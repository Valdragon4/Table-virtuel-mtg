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
    'Pas de pile, pas de priorité, pas de « vous ne pouvez pas faire ça ». Vous posez, vous tapez, vous déplacez ; la carte la plus tordue de',
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
  'pregame.backToDeck': '← Remettre au deck',

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
  'zoneMenu.scry1': 'Scry 1',
  'zoneMenu.scryHowMany': 'Scry combien ?',
  'zoneMenu.surveil1': 'Surveil 1',
  'zoneMenu.surveilHowMany': 'Surveil combien ?',
  'zoneMenu.peekTop': 'Regarder le dessus',
  'zoneMenu.peekHowMany': 'Regarder combien de cartes ?',
  'zoneMenu.mill1': 'Meuler 1',
  'zoneMenu.millHowMany': 'Meuler combien de cartes ?',
  'zoneMenu.exileTop': 'Exiler le dessus',
  'zoneMenu.exileHowMany': 'Exiler combien de cartes ?',
  'zoneMenu.exileTopFaceDown': 'Exiler le dessus, face cachée',
  'zoneMenu.exileFaceDownHowMany': 'Exiler combien de cartes, face cachée ?',
  'zoneMenu.searchLibrary': 'Fouiller la bibliothèque',
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
  'consult.bucketTop': 'Dans le deck (dessus)',
  'consult.bucketTopShort': 'Deck',
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
  'consult.bucketSideboardHint': 'Met de côté, hors du deck (avant de lancer la partie)',
  'consult.sortName': 'Nom (A-Z)',
  'consult.sortCost': 'Coût de mana (CMC)',
  'consult.sortType': 'Type',
  'consult.sortReceived': 'Ordre reçu',
  'consult.titleSearch': 'Fouille de la bibliothèque',
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
  'consult.backToDeck': 'Dans le deck',
  'consult.backToDeckTitle': 'Remettre dans le deck',
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
  'consult.sumDeck': '{count} dans le deck',
  'consult.submitNoShuffle': 'Valider sans mélanger',
  'consult.submitShuffle': 'Valider et mélanger',
  'consult.cancelAssignment': 'Annuler (laisser dans le deck)',
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
} as const;

/** La forme du catalogue : c'est le français qui la définit, toujours. */
export type Catalog = typeof fr;

/** Toutes les clés traduisibles. `t` n'accepte que celles-là. */
export type CatalogKey = keyof Catalog;

/**
 * Le catalogue anglais.
 *
 * Il traduit `catalog.fr.ts`, qui reste la source. Les clés y sont dans le même
 * ordre exprès : relire les deux fichiers côte à côte est le seul contrôle
 * humain qui attrape un contresens, et le compilateur ne fait que garantir
 * qu'aucune clé ni aucune accolade ne manque.
 *
 * Note de pluriel : l'anglais et le français ne coupent pas au même endroit —
 * « 0 carte » mais « 0 cards ». C'est `pluralForm` qui s'en charge ; les deux
 * formes écrites ici n'ont pas à s'en préoccuper.
 */
import { defineTranslation } from './defineTranslation.js';

export const en = defineTranslation({
  // — Boutons et mots communs ————————————————————————————————
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.apply': 'Apply',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.none': 'None',
  'common.empty': 'Empty',

  // — Zones de jeu ———————————————————————————————————————————
  'zone.hand': 'Hand',
  'zone.library': 'Library',
  'zone.graveyard': 'Graveyard',
  'zone.exile': 'Exile',
  'zone.battlefield': 'Battlefield',
  'zone.command': 'Command zone',
  'zone.sideboard': 'Sideboard',
  'zone.libraryTop': 'Top of the library',
  'zone.libraryBottom': 'Bottom of the library',

  // — Barre d'outils et table ————————————————————————————————
  'toolbar.mulligan': 'Mulligan',
  'toolbar.passTurn': 'Pass the turn',
  'toolbar.quickTokens': 'Quick tokens',
  'toolbar.shortcuts': 'Keyboard shortcuts',
  'toolbar.undo': 'Undo your last action (10 s)',
  'toolbar.playmat': 'Playmat and card back',
  'table.concedeConfirm': 'Concede the game?',
  'table.concede': 'Concede',

  // — Cartes ————————————————————————————————————————————————
  'card.untap': 'Untap',
  'card.changePrinting': 'Change printing…',
  'card.createToken': 'Create a token…',
  'card.copyAsToken': 'Copy as a token',
  'card.destroyToken': 'Destroy the token',
  'card.attachTo': 'Attach to… (click the target)',
  'card.detach': 'Detach',
  'card.faceDown': 'Face-down card',
  'card.addPlusCounter': 'Add a +1/+1 counter',
  'card.handRevealed': 'Card revealed: your hand is visible to the whole table',
  'search.noMatch': 'No card matches.',
  'search.placeholder': 'Search a zone, a card, a type… or type “angel”',

  // — Interpolation simple ———————————————————————————————————
  'counter.badge': '{value} × {kind}',
  'printing.label': '{name} ({setCode})',

  // — Pluriels ———————————————————————————————————————————————
  'card.count': { one: '{count} card', other: '{count} cards' },
  'log.drew': { one: '{who} drew a card', other: '{who} drew {count} cards' },
  'log.revealedTop': {
    one: '{who} revealed the top card of their {zone}: {names}',
    other: '{who} revealed the top {count} cards of their {zone}: {names}',
  },
  'log.mulligan': {
    one: '{who} took a mulligan ({counter}) — 1 card to put back on the bottom',
    other: '{who} took a mulligan ({counter}) — {count} cards to put back on the bottom',
  },

  // — Langue ————————————————————————————————————————————————
  'prefs.language': 'Interface language',
  'prefs.languageHint': 'Applies everywhere, mid-game included, and is kept on your account.',
  'prefs.languageSaving': 'Saving…',
  'prefs.languageError': 'The language could not be saved to your account.',
  'prefs.localizedPrinting': 'Force a printing available in my language',
  'prefs.localizedPrintingHint':
    'Shows the art of another printing when the chosen one does not exist in your language, or when Scryfall only publishes a blurry scan of it — you then get the sharpest render available in your language. Only changes what you see: other players still see the chosen printing. Basic lands are left alone and keep their printing.',
  'card.imageFallback': 'English art: this card does not exist in {language}.',

  // ═══ Écrans hors partie ═══════════════════════════════════════════════════

  // — Mots communs de plus ———————————————————————————————————
  'common.save': 'Save',
  'common.sending': 'Sending…',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.or': 'or',
  'common.loadFailed': 'Could not load.',
  'common.saveFailed': 'Could not save.',

  // — Navigation ————————————————————————————————————————————
  'nav.myTables': 'My tables',
  'nav.myDecks': 'My decks',
  'nav.backHome': 'Back to the home page',

  // — Temps relatif ——————————————————————————————————————————
  'time.justNow': 'just now',
  'time.minutesAgo': '{value} min ago',
  'time.hoursAgo': '{value} h ago',
  'time.daysAgo': '{value} d ago',

  // — Accueil ————————————————————————————————————————————————
  'home.modeCommanderDetail': 'Up to 4 seats, 40 life, commander damage tracked per seat.',
  'home.modeDuelDetail': 'Two players, 20 life.',
  'home.createFailed': 'Could not create the table.',
  'home.heroLine1': 'Four seats.',
  'home.heroLine2': 'No referee.',
  'home.heroLine3': 'One link.',
  'home.heroLeadBefore': 'A Magic table in the browser that enforces',
  'home.heroLeadStrong': 'no rules at all',
  'home.heroLeadAfter':
    '. You sort things out between yourselves, just like around a real table, and nobody needs an account to sit down.',
  'home.openTable': 'Open a table',
  'home.tableFormat': 'Table format',
  'home.opening': 'Opening…',
  'home.createTable': 'Create the table and get the link',
  'home.addressIsLink': 'Its address is the link: copy it, send it.',
  'home.codeAsk': 'Were you sent a code?',
  'home.pasteHeading': 'And this is what you paste',
  'home.pasteDetail':
    'As is, in a text box. Or an Archidekt URL. Or a Moxfield export. Whatever is not recognised is handed back to you line by line, rather than swallowed in silence.',
  'home.step1Title': 'You open the table',
  'home.step1Detail':
    'One format, one button. The page address is the invitation link; there is nothing else to set up.',
  'home.step2Title': 'Everyone pastes their deck',
  'home.step2Detail':
    'An Archidekt URL, a list pasted as is, or a Moxfield export. The list is read back and whatever snags is told to you, line by line.',
  'home.step3Title': 'You play, and you referee',
  'home.step3Detail':
    'The software moves, shuffles, draws and counts. It never tells you a move is illegal: this is your table.',
  'home.noRulesTitle': 'The software never says no',
  'home.noRulesBefore':
    'No stack, no priority, no “you cannot do that”. You put down, you tap, you move; the most twisted card of the',
  'home.noRulesAfter':
    'indexed cards plays like any other, and so do your house formats. Disagreements are settled the way they are at a real table: by talking.',
  'home.stampNoRules': 'No rules engine',
  'home.hiddenTitle': 'Your library is not in your browser',
  'home.hiddenDetail':
    'It lives on the server, and the server publishes nothing of it — not even to you. A card in the library has no broadcast identifier, and a shuffle reassigns them all, so that no before/after comparison can reconstruct the order. This is not a promise of good behaviour: it is the way the table is built, and the tests make sure of it.',
  'home.stampHidden': 'Hidden information',
  'home.accountTitle': 'The account is not there to play',
  'home.accountDetail':
    'It keeps your decks from one game to the next, your playmats and your settings. To sit down at a table it is of no use — and that is not an oversight.',

  // — Compte : connexion, inscription ————————————————————————
  'auth.login': 'Sign in',
  'auth.logout': 'Sign out',
  'auth.createAccount': 'Create an account',
  'auth.createAccountSubmit': 'Create the account',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordRule': 'At least 10 characters.',
  'auth.displayName': 'Name shown at the table',
  'auth.forgotPassword': 'Forgotten password',
  'auth.registered':
    'Account created. A confirmation email has just gone out — in development, it is written to the server logs.',
  'auth.failed': 'Failed.',
  'auth.errorHint': 'Correct the field concerned, then send the form again.',
  'auth.createOne': 'Create one',
  'auth.sitWithout': 'sit down without one',
  'auth.asideNoAccount': '. No account?',
  'auth.asideRemind': '. And a useful reminder: the account is not there to play, you can',
  'auth.alreadyRegistered': 'Already registered?',
  'auth.asideAccountKeeps':
    '. The account keeps your decks, your playmats and your settings — it is never required to join a table.',
  'auth.backToTableAsGuest': 'go back to the table as a guest',

  // — Liens reçus par email ——————————————————————————————————
  'token.missingToken': 'Incomplete link: the token is missing.',
  'token.verifyTitle': 'Email address confirmation',
  'token.verifying': 'Checking…',
  'token.verified': 'Address confirmed. Your account is active.',
  'token.verifyFailed': 'Could not verify.',
  'token.verifyExpiredHint':
    'Links expire after 24 hours and can only be used once. Sign in, then ask for a new one.',
  'token.resetTitle': 'New password',
  'token.resetSubmit': 'Change the password',
  'token.resetFailed': 'Could not reset.',
  'token.resetDone':
    'Password changed. All your sessions have been closed; redirecting to the sign-in page…',
  'token.forgotSubmit': 'Send the link',
  'token.forgotSent':
    'If an account exists for this address, a reset link has just been sent to it. It expires in one hour.',

  // — Mes tables —————————————————————————————————————————————
  'tables.intro':
    'The games where you have a seat. Coming back costs nothing: your seat, your hand and your library are waiting for you.',
  'tables.emptyTitle': 'No table in progress.',
  'tables.emptyDetail': 'Open one from the home page, or paste the link you were sent.',
  'tables.closedHeading': 'Closed tables',
  'table.statusLobby': 'Lobby',
  'table.statusPlaying': 'Game in progress',
  'table.statusEnded': 'Ended',
  'table.host': 'Host',
  'table.yourSeat': 'your seat no.{index}',
  'table.notSeated': 'you have not sat down yet',
  'table.playersAtTable': {
    one: '{count} player at the table',
    other: '{count} players at the table',
  },
  'table.join': 'Join',
  'table.returnTo': 'Back to the table',
  'table.leave': 'Leave the table',
  'table.close': 'Close the table',
  'table.leaveFailed': 'Could not leave.',
  'table.closeFailed': 'Could not close.',
  'table.leaveWhilePlayingConfirmCode':
    'Leave table {code} during the game? This counts as conceding: your cards leave the battlefield and the game goes on without you.',
  'table.leaveConfirmCode': 'Leave table {code}? Your seat and your deck are released.',
  'table.closeConfirmCode':
    'Close table {code} for everyone? The game stops for every player.',

  // — Quitter la table, depuis la table ——————————————————————
  'table.leaveNow': 'Leave',
  'table.leaveNowHint':
    'Back to the home page. Your seat stays held: hand, library and battlefield are waiting for you.',
  'table.leaveMore': 'Other ways to leave',
  'table.leaveMoreHint': 'Leave for good, or close the table',
  'table.leaveForGood': 'Leave the table for good',
  'table.leaveForGoodPlayingDetail': 'Counts as conceding: your cards leave the battlefield.',
  'table.leaveForGoodDetail': 'Your seat and your deck are released.',
  'table.leaveWhilePlayingConfirm':
    'Leave the game? This counts as conceding: your cards leave the battlefield and the game goes on without you.',
  'table.leaveConfirm': 'Leave the table? Your seat and your deck are released.',
  'table.closeConfirm': 'Close the table for everyone? The game stops for every player.',
  'table.closeDetail': 'The game stops for every player.',

  // — Mes decks ——————————————————————————————————————————————
  'decks.intro':
    'What you keep here follows you from one table to the next. Nothing is compulsory: a list pasted straight into a table lobby works just as well.',
  'decks.savedHeading': 'Saved decks',
  'decks.empty':
    'No deck yet. Import one above — or play without an account, by pasting a list straight into a table lobby.',
  'deck.importFromUrl': 'Import from a URL',
  'deck.moxfieldNote':
    'Archidekt is supported directly. For Moxfield, go through pasting: their API is not open to third-party applications, and we do not work around it.',
  'deck.import': 'Import',
  'deck.importing': 'Importing…',
  'deck.importFailed': 'Could not import.',
  'deck.pasteList': 'Paste a list',
  'deck.importPasted': 'Import the pasted list',
  'deck.pasteListNoteBefore':
    'A Moxfield, MTGO or TappedOut export, or a list typed by hand. The',
  'deck.pasteListNoteAnd': 'and',
  'deck.pasteListNoteAfter': 'sections are recognised.',
  'card.countWord': { one: 'card', other: 'cards' },
  'deck.syncedOn': 'synced on {date}',
  'deck.look': 'Appearance',
  'deck.resync': 'Resync',

  // — Éditeur de deck ————————————————————————————————————————
  'deck.unreadable': 'Unreadable deck.',
  'deck.nameLabel': 'Deck name',
  'deck.listLabel': 'Deck list',
  'deck.modeList': 'List mode',
  'deck.modeText': 'Text mode',
  'deck.modeSwitchConfirm': 'Switching mode discards the unsaved changes. Continue?',
  'deck.syncedWarning':
    'This deck is synced from {source}. Saving it will detach it from its source: your corrections will be kept, but resyncing will no longer be offered.',
  'deck.emptyZone': 'Empty.',
  'deck.filterLabel': 'Filter the deck',
  'deck.filterPlaceholder': 'Filter: name, type, keyword (flying, trample…)',
  'deck.filterNoMatch': 'No card matches.',
  'deck.filterShown': { one: '{count} shown', other: '{count} shown' },
  'deck.unsavedChanges': 'Unsaved changes',
  'deck.detachAndSave': 'Detach from the source and save',
  'deck.addCard': 'Add a card',
  'deck.searchCard': 'Search for a card',
  'deck.cardNamePlaceholder': 'Card name…',
  'deck.addZone': 'Zone to add to',
  'deck.addOne': 'Add one copy of {name}',
  'deck.removeOne': 'Remove one copy of {name}',
  'deck.quantityOf': 'Quantity of {name}',
  'deck.zoneOf': 'Zone of {name}',
  'deck.remove': 'Remove {name}',

  // — Impressions ————————————————————————————————————————————
  'printing.choose': 'Choose a printing',
  'printing.edition': 'Edition',
  'printing.foil': 'Foil printing',
  'printing.normal': 'Normal printing',
  'printing.loading': 'Loading printings…',
  'printing.noOther': 'No other printing.',

  // — Apparence d'un deck ————————————————————————————————————
  'look.playmat': 'Playmat',
  'look.playmatHint':
    'URL of an image. It is loaded by your browser, never by our server.',
  'look.playmatPreview': 'Playmat preview',
  'look.playmatDefault': 'Default playmat',
  'look.cardBack': 'Card back',
  'look.cardBackHint': 'Leave empty for the default back.',
  'look.appliedOnLoad': 'Applied to your zone when the deck is loaded.',

  // — Composer son deck avant le lancement ———————————————————
  'pregame.title': 'Before the game',
  'pregame.intro':
    'Change deck, or move cards between your library and your sideboard. Everything is still editable as long as nobody has started.',
  'pregame.loadedDeck': 'Loaded deck: {name}',
  'pregame.noDeck': 'none',
  'pregame.pasteInstead': '— paste a list instead —',
  'pregame.loadDeck': 'Load this deck',
  'pregame.loadWarning': 'Loading a deck replaces everything you have on the table.',
  'pregame.filterPlaceholder': 'Filter by name…',
  'pregame.libraryHeading': 'Library ({value})',
  'pregame.libraryEmpty': 'No card in the library.',
  'pregame.setAside': 'Set aside →',
  'pregame.sideboardHeading': 'Sideboard ({value})',
  'pregame.sideboardEmpty': 'Sideboard empty.',
  'pregame.backToDeck': '← Back to the deck',

  // ═══ Lot 1 : les composants de la table de jeu ═══════════════════════════

  // — Boutons et mots communs (suite) ————————————————————————————
  'common.add': 'Add',
  'common.remove': 'Remove',
  'common.validate': 'Submit',
  'common.all': 'All',
  'common.place': 'Place',
  'common.reveal': 'Reveal',
  'common.shuffle': 'Shuffle',
  'common.minimize': 'Minimize',
  'common.expand': 'Expand',
  'common.clear': 'Clear',
  'common.closeEsc': 'Close (Esc)',
  'common.value': 'Value',

  // — Zones (suite) ——————————————————————————————————————————
  'zone.commandFull': 'Command zone',

  // — Cartes : gestes du menu contextuel ————————————————————————
  'card.tap': 'Tap',
  'card.play': 'Play',
  'card.playFaceDown': 'Play face down',
  'card.toStack': 'Put on the stack',
  'card.revealAll': 'Reveal to everyone',
  'card.revealTo': 'Reveal to…',
  'card.discard': 'Discard',
  'card.exile': 'Exile',
  'card.toHand': 'To hand',
  'card.toGraveyard': 'To the graveyard',
  'card.toBattlefield': 'To the battlefield',
  'card.nthFromTop': 'Nth from the top…',
  'card.toSideboard': 'Move to the sideboard',
  'card.shuffleIntoLibrary': 'Shuffle into the library',
  'card.castFromCommand': 'Cast from the command zone',
  'card.takeBackHand': 'Played by mistake: take back to hand',
  'card.takeBackHide': 'Played by mistake: hide from everyone',
  'card.peekFaceDown': 'Look (publicly announced)',
  'card.shelveToken': 'Put this token on the shelf',
  'card.confirmDestroyToken': 'Confirm destruction?',
  'card.removePlusCounter': 'Remove a +1/+1 counter',
  'card.customCounter': 'Custom counter…',
  'card.turnFaceUp': 'Turn face up',
  'card.turnFaceDown': 'Turn face down',
  'card.transform': 'Transform (double-faced)',
  'card.faceDownShort': 'Face down',
  'card.generic': 'Card',
  'card.selectedCard': 'Selected card',
  'card.genericPermanent': 'Permanent',
  'card.selectedCount': '{count} sel.',
  'card.countersOnThis': 'Counters on this card',
  'card.counterOneLess': 'One counter fewer',
  'card.counterOneMore': 'One counter more',
  'card.counterRemove': 'Remove this counter',
  'card.counterEditHint': 'Adjust, rename or remove this counter',
  'card.counterComputedHint': '{formula} — recalculated on its own',
  'card.libraryPlaceTitle': 'Put into the library',
  'card.libraryPlaceLabel': 'Position from the top (1 = top)',
  'card.revealDialogDescription': 'Only the people ticked will see the card.',
  'card.revealDialogRecipients': 'Recipients',
  'card.alignSelection': { one: 'Align the card', other: 'Align the {count} cards' },
  'card.revealDialogTitle': {
    one: 'Reveal this card to…',
    other: 'Reveal {count} cards to…',
  },
  'card.counterDialogTitle': {
    one: 'Place a counter',
    other: 'Counter on {count} cards',
  },

  // — Cascade et Découvrir ————————————————————————————————————————
  'card.assistedActions': 'Assisted actions',
  'card.cascadeEntry': 'Cascade…',
  'card.cascadeWithValue': 'Cascade (mana value {value})',
  'card.discoverEntry': 'Discover N…',
  'cascade.title': 'Cascade / Discover',
  'cascade.description':
    'Exiles cards from the top of your library one at a time until one is not a land and qualifies. That card stays in exile, face up, and is yours to do with as you please; the rest goes back under your library, in a random order.',
  'cascade.modeLabel': 'Keyword',
  'cascade.modeBelow': 'Cascade (strictly less than)',
  'cascade.modeAtMost': 'Discover N (N or less)',
  'cascade.valueLabel': 'Mana value',
  'cascade.modeHint':
    'Cascade stops at the first nonland card strictly below the value entered; “Discover N” stops at N or less.',
  'cascade.suggested': 'Suggested from the mana cost of {name}: {value}. Correct it if your card says otherwise.',
  'cascade.ambiguous':
    'This card has several faces carrying a cost: the suggested value is the front one, worth checking.',
  'cascade.unknownCost': 'This card’s cost is not known here: enter the value yourself.',
  'cascade.submit': 'Run the sequence',

  // — Marqueur personnalisé : aperçu et formulaire ————————————————
  'counter.preview': 'Live preview',
  'counter.modeFrozen': 'Frozen when placed',
  'counter.modeDynamic': 'Dynamic (live)',
  'counter.ptAdjust': 'Fixed power / toughness adjustment: {pair}',
  'counter.namedDesc': 'Counter named “{kind}”: {value} placed',
  'counter.keywordDesc': 'Ability / keyword “{kind}” granted without a quantity',
  'counter.noneZero': '0 (no counter)',
  'counter.countFrozen': 'Current count: {base} {offset} = {final}',
  'counter.countDynamic': 'Current count: {base} {offset} → {preview}',
  'counter.offsetSuffix': '({offset} offset)',
  'counter.zeroWarning':
    '⚠️ The count is 0: no counter will be placed on the card, and the log will say “0”.',
  'counter.willFreeze':
    'This counter will freeze the value {value} once and for all when it is placed (it will not move afterwards).',
  'counter.tipTitle': '💡 Play tip',
  'counter.tipCalc':
    'Dynamic counters are recalculated client-side without asking the server. You can count any subtype or public zone.',
  'counter.tipPlain':
    'You can adjust or remove this counter at any time by double-clicking or through the context menu.',
  'counter.fieldShape': 'Shape',
  'counter.shapePt': 'Power / toughness',
  'counter.shapeNamed': 'Named',
  'counter.shapeKeyword': 'Keyword',
  'counter.shapeCalc': 'Classic effects',
  'counter.fieldBehaviour': 'Behaviour',
  'counter.behaviourFollow': 'Power/toughness equal to the count',
  'counter.behaviourAdd': 'Bonus per unit counted',
  'counter.behaviourFrozen': 'Counters placed once, frozen',
  'counter.behaviourHint':
    'The first two follow the zone being counted; the third counts now, then never moves again.',
  'counter.fieldFrozenShape': 'Shape of the frozen counter',
  'counter.frozenShapeSet': 'X/X — power and toughness set',
  'counter.frozenShapeAdd': '+X/+X — overall bonus',
  'counter.frozenShapeCounters': '+1/+1 — X individual counters',
  'counter.frozenShapeNamed': 'Named (X counters)',
  'counter.frozenShapeHint':
    '“X/X” places a counter setting power/toughness (e.g. 3/3). “+1/+1” places that many +1/+1 counters.',
  'counter.fieldName': 'Counter name',
  'counter.fieldTemplate': 'Template',
  'counter.tplBoth': '*/* — both',
  'counter.tplToughPlus1': '*/1+* — toughness +1',
  'counter.tplPowerPlus1': '1+*/* — power +1',
  'counter.tplBothMinus1': '*-1/*-1 — both -1',
  'counter.tplToughMinus1': '*/-1+* — toughness -1',
  'counter.tplPowerMinus1': '-1+*/* — power -1',
  'counter.tplAddBoth': '+1/+1 per unit',
  'counter.tplAddPower': '+1/+0 per unit',
  'counter.tplAddTough': '+0/+1 per unit',
  'counter.tplAddBothMinus': '+1/+1 (-1 overall)',
  'counter.fieldSource': 'What to count / value to take',
  'counter.sourceHint':
    'Subtypes (angel, human…), zone counts, or characteristics of cards in play.',
  'counter.freeformNote':
    'Nothing matches “{query}” in the catalogue: it is offered to you as a subtype, and the count will stay at zero if it is not one. {refusal}',
  'counter.fieldWho': 'Whose',
  'counter.whoController': 'The card’s controller',
  'counter.whoOpponents': 'Their opponents',
  'counter.whoAll': 'The whole table',
  'counter.whoHint':
    'Counting the graveyard across the table is fair: it is public, and everyone already sees it.',
  'counter.fieldScope': 'Scope',
  'counter.scopeAll': 'All cards',
  'counter.scopeOther': 'Other cards only (exclude this card)',
  'counter.scopeHint':
    '“Other cards” does not count this card if it has the type/subtype (e.g. “for each other angel”).',
  'counter.fieldOffset': 'Adjustment (starting offset)',
  'counter.offsetNone': '0 (none)',
  'counter.offsetHint':
    'Modifier applied to the count (e.g. -1 for “number of angels - 1”). 0 by default.',
  'counter.fieldPair': 'Power / toughness change',
  'counter.pairHint': 'Two numbers separated by a slash, X included: +1/+1, -1/-1, +2/+0, X/X.',
  'counter.fieldCount': 'Number of counters',
  'counter.countPlaceholder': 'a number, or nothing',
  'counter.countNone': 'none',
  'counter.countHint': 'Three +1/+1 counters, not “+3/+3”: that is the rule of the game.',
  'counter.groupThisCard': 'This card',
  'counter.groupBattlefield': 'Cards on the battlefield',
  'counter.prefixSelf': 'This card: ',
  'counter.prefixNamed': '“{name}”: ',
  'counter.optPower': '{prefix}power ({value})',
  'counter.optToughness': '{prefix}toughness ({value})',
  'counter.optCounters': '{prefix}counters ({value})',

  // — Menu de pile ———————————————————————————————————————————
  'zoneMenu.draw1': 'Draw 1',
  'zoneMenu.drawHowMany': 'Draw how many cards?',
  'zoneMenu.scry1': 'Scry 1',
  'zoneMenu.scryHowMany': 'Scry how many?',
  'zoneMenu.surveil1': 'Surveil 1',
  'zoneMenu.surveilHowMany': 'Surveil how many?',
  'zoneMenu.peekTop': 'Look at the top',
  'zoneMenu.peekHowMany': 'Look at how many cards?',
  'zoneMenu.mill1': 'Mill 1',
  'zoneMenu.millHowMany': 'Mill how many cards?',
  'zoneMenu.exileTop': 'Exile the top',
  'zoneMenu.exileHowMany': 'Exile how many cards?',
  'zoneMenu.exileTopFaceDown': 'Exile the top, face down',
  'zoneMenu.exileFaceDownHowMany': 'Exile how many cards, face down?',
  'zoneMenu.searchLibrary': 'Search the library',
  'zoneMenu.revealTopX': 'Reveal the top (X cards)',
  'zoneMenu.revealHowMany': 'Reveal how many cards from the top?',
  'zoneMenu.revealTopOngoing': 'Reveal the top… (ongoing)',
  'zoneMenu.revealTop': 'Reveal the top…',
  'zoneMenu.openZonePanel': 'Open the zone panel',
  'zoneMenu.openInZonePanel': 'Open in the zone panel',
  'zoneMenu.graveyardToLibrary': 'Put everything back into the library',
  'zoneMenu.cardCountLabel': 'Number of cards',
  'zoneMenu.revealTopTitle': 'Reveal the top of my library',
  'zoneMenu.revealTopDescription':
    'The top card stays visible to these players and follows every draw, every mill and every shuffle. Ticking nobody stops the reveal.',
  'zoneMenu.revealTopVisibleBy': 'Visible to',

  // — Menu du fond de table ————————————————————————————————————
  'tableMenu.placeLabel': 'Place a label here…',
  'tableMenu.placeMarker': 'Place a marker here…',
  'tableMenu.playerCounters': 'Player counters…',
  'tableMenu.drawCard': 'Draw a card',
  'tableMenu.untapAll': 'Untap everything',
  'tableMenu.shuffleLibrary': 'Shuffle the library',
  'tableMenu.markerNameOptional': 'Marker name (optional)',
  'tableMenu.labelText': 'Label text',
  'tableMenu.valuePlaceholder': '1/1, 3, or nothing',
  'tableMenu.helpPair': ': power and toughness, each adjustable on its own.',
  'tableMenu.helpNumber': ': a single-digit counter.',
  'tableMenu.helpKeyword': ': a keyword, with no number beside it.',

  // — Compteurs de joueur ————————————————————————————————————
  'playerCounter.title': 'Player counters',
  'playerCounter.none': 'No counters. Add one below.',
  'playerCounter.customPlaceholder': 'Custom counter…',
  'playerCounter.removeTitle': 'Remove this counter',
  'playerCounter.footer':
    'Counters are visible to the whole table. Setting them back to zero removes them.',
  'playerCounter.poison': 'Poison',
  'playerCounter.energy': 'Energy',
  'playerCounter.experience': 'Experience',
  'playerCounter.rad': 'Radiation',
  'playerCounter.ticket': 'Ticket',
  'playerCounter.city': 'The Initiative / City',

  // — Journal de partie : ce que le composant écrit lui-même ————————
  'log.title': 'Log',
  'log.chatHint': 'Write a message (Enter)',
  'log.chatButton': 'Enter to talk',
  'log.empty': 'Nothing yet.',
  'log.collapse': 'Collapse',
  'log.tableActor': 'Table',
  'log.messagePlaceholder': 'Your message…',
  'log.expandCards': { one: 'See the card', other: 'See the {count} cards' },

  // — Raccourcis clavier : noms de touches ————————————————————————
  'keys.enter': 'Enter',
  'keys.esc': 'Esc',
  'keys.delete': 'Del',
  'keys.wheel': 'Wheel',
  'keys.drag': 'Drag',
  'keys.altDrag': 'Alt + Drag',
  'keys.rightDrag': 'Right-drag',
  'keys.middleClick': 'Middle click',
  'keys.ctrlClick': 'Ctrl + Click',
  'keys.dragCard': 'Drag a card',
  'keys.doubleClick': 'Double click',
  'keys.rightClick': 'Right click',

  // — Raccourcis clavier : gestes et aide ————————————————————————
  'shortcut.tapUntap': 'Tap / untap',
  'shortcut.flipFace': 'Turn face down / face up',
  'shortcut.plusCounter': '+1/+1 counter',
  'shortcut.libraryTopBottom': 'Top / bottom of the library',
  'shortcut.graveyardOrExile': 'To the graveyard / exile',
  'shortcut.writeMessage': 'Write a message',
  'shortcut.clearSelection': 'Clear the selection, close a menu',
  'shortcut.thisHelp': 'This help',
  'shortcut.zoom': 'Zoom',
  'shortcut.lasso': 'Lasso, from the background: selects your permanents',
  'shortcut.lassoAll': 'Lasso including opposing permanents',
  'shortcut.panTable': 'Pan the table',
  'shortcut.panTableAnywhere': 'Pan the table, from anywhere',
  'shortcut.toggleSelection': 'Add to or remove from the selection',
  'shortcut.dropInZone': 'Drop it into another zone',
  'shortcut.contextMenu': 'Menu for the card, the pile or the table',
  'shortcut.ruleLead': 'A key acts first on the card',
  'shortcut.ruleUnderCursor': 'under the cursor',
  'shortcut.ruleOtherwise': ', otherwise on the',
  'shortcut.ruleSelection': 'selection',
  'shortcut.ruleTable': 'table',
  'shortcut.groupHover': 'When hovering a card',
  'shortcut.groupHoverHint':
    'The card under the pointer wins over the selection. During a drag and drop, hovering is ignored.',
  'shortcut.sectionHand': 'In hand',
  'shortcut.sectionPermanent': 'Permanent in play',
  'shortcut.sectionPile': 'Graveyard, exile, command zone',
  'shortcut.groupTable': 'Table and mouse',
  'shortcut.groupTableHint':
    'These keys apply when no card is hovered or selected.',
  'shortcut.sectionGlobal': 'Global actions',
  'shortcut.sectionMouse': 'Mouse',
  'shortcut.footerClose': 'Esc, or a click outside the panel, closes this help.',
  'shortcut.footerReopen': 'reopens it at any time.',

  // — Consultation et fouille de bibliothèque ————————————————————
  'consult.bucketTop': 'In the deck (top)',
  'consult.bucketTopShort': 'Deck',
  'consult.bucketTopHint': 'Puts back on top, in the order shown',
  'consult.bucketHand': 'In hand',
  'consult.bucketHandShort': 'Hand',
  'consult.bucketHandHint': 'Takes into hand (classic tutor)',
  'consult.bucketBattlefield': 'On the battlefield',
  'consult.bucketBattlefieldShort': 'Field',
  'consult.bucketBattlefieldHint': 'Puts straight onto the battlefield',
  'consult.bucketGraveyardHint': 'Puts into the graveyard (Entomb, etc.)',
  'consult.bucketExile': 'In exile',
  'consult.bucketExileHint': 'Exiles the card',
  'consult.bucketBottom': 'At the bottom',
  'consult.bucketBottomShort': 'Bottom',
  'consult.bucketBottomHint': 'Sends back to the bottom of the library',
  'consult.bucketSideboardHint': 'Sets aside, out of the deck (before starting the game)',
  'consult.sortName': 'Name (A-Z)',
  'consult.sortCost': 'Mana cost (CMC)',
  'consult.sortType': 'Type',
  'consult.sortReceived': 'Order received',
  'consult.titleSearch': 'Library search',
  'consult.titleReveal': {
    one: 'Library reveal — {count} card',
    other: 'Library reveal — {count} cards',
  },
  'consult.titleLook': {
    one: 'Look — {count} card',
    other: 'Look — {count} cards',
  },
  'consult.subtitleReveal': 'Revealed to the whole table · Choose each card’s destination',
  'consult.subtitleLook': 'Visible to you alone · Double-click a card to take it into hand',
  'consult.densityLarge': 'Large',
  'consult.densityLargeHint': 'Large, readable cards',
  'consult.densityNormal': 'Normal',
  'consult.densityNormalHint': 'Standard size',
  'consult.densityCompact': 'Compact',
  'consult.densityCompactHint': 'Compact overview',
  'consult.filterPlaceholder': 'Filter by name, type, text…',
  'consult.sortLabel': 'Sort:',
  'consult.allCount': 'All ({count})',
  'consult.selectedCount': '{count} selected:',
  'consult.backToDeck': 'In the deck',
  'consult.backToDeckTitle': 'Put back into the deck',
  'consult.selectAll': 'Select all ({count})',
  'consult.deselect': 'Deselect',
  'consult.noMatch': 'No card matches these criteria.',
  'consult.resetFilters': 'Reset the filters',
  'consult.details': 'Card details',
  'consult.manaCost': 'Mana cost:',
  'consult.powerToughness': 'Power / Toughness:',
  'consult.quickAction': 'Quick action:',
  'consult.summary': 'Summary:',
  'consult.sumHand': '{count} in hand',
  'consult.sumBattlefield': '{count} on the battlefield',
  'consult.sumGraveyard': '{count} in the graveyard',
  'consult.sumExile': '{count} in exile',
  'consult.sumBottom': '{count} at the bottom',
  'consult.sumSideboard': '{count} in the sideboard',
  'consult.sumDeck': '{count} in the deck',
  'consult.submitNoShuffle': 'Submit without shuffling',
  'consult.submitShuffle': 'Submit and shuffle',
  'consult.cancelAssignment': 'Cancel (leave in the deck)',
  'consult.cardTitleHint': '{name} — Double click: take into hand. Right click: action menu.',
  'consult.inspect': 'Inspect the card in large',
  'consult.pickForBulk': 'Select for a bulk action',
  'consult.quickHand': 'Take into hand (tutor)',
  'consult.quickBattlefield': 'Put onto the battlefield',
  'consult.moreActions': 'More actions (Graveyard, Exile, Bottom…)',
  'consult.moveTo': 'Move to:',

  // — Familles de types ————————————————————————————————————————
  'type.creature': 'Creatures',
  'type.planeswalker': 'Planeswalkers',
  'type.land': 'Lands',
  'type.artifact': 'Artifacts',
  'type.enchantment': 'Enchantments',
  'type.instant': 'Instants',
  'type.sorcery': 'Sorceries',
  'type.other': 'Other',
  'type.faceDown': 'Face down',
  'type.unknown': 'Unknown type',

  // — Panneau des zones ————————————————————————————————————————
  'zonePanel.title': 'Zones',
  'zonePanel.searchPlaceholder': 'Filter by name…',
  'zonePanel.emptyPile': 'Empty pile.',
  'zonePanel.chipHint': '{count} {family} in this zone',
  'zonePanel.hintOther': 'Types outside the big families (battle, dungeon…)',
  'zonePanel.hintHidden': 'You cannot see their identity: their type is not counted',
  'zonePanel.hintUnknown': 'Record not loaded yet: these cards are not counted anywhere else',
  'zonePanel.allShown': 'The whole zone is shown',
  'zonePanel.clearFilter': 'Remove the filter and show the whole zone again',
  'zonePanel.chipTitle': '{hint} · {action}',
  'zonePanel.chipShowAll': 'click to show everything again',
  'zonePanel.chipShowOnly': 'click to show only those',
  'zonePanel.total': { one: 'All · {count} card', other: 'All · {count} cards' },
  'zonePanel.unreachableHidden': {
    one: '{count} face-down card',
    other: '{count} face-down cards',
  },
  'zonePanel.unreachableUnknown': {
    one: '{count} card of unknown type',
    other: '{count} cards of unknown type',
  },
  'zonePanel.unreachableJoin': 'and',
  'zonePanel.unreachableNote':
    'outside this filter: you do not know their type. Their chip shows them.',
  'zonePanel.footerCount': '{visible} / {total} card(s)',
  'zonePanel.footerSelected': '· {count} selected',
  'zonePanel.footerHelp':
    'Click to select, Ctrl+click to add, Shift+click for a range. Right-click for the menu, drag to the table to move.',
  'zonePanel.libraryCount': 'card(s).',
  'zonePanel.libraryWarn1':
    'The contents of a library are not known to the client, not even your own. Opening it starts a',
  'zonePanel.libraryWarnWord': 'look',
  'zonePanel.libraryWarn2':
    ', and the other players are told about it in the log. The order you will be shown is scrambled: it is not the real order of your library.',
  'zonePanel.peekTitle': 'Look at the top of the library',
  'zonePanel.peekLabel': 'Number of cards to look at',
  'zonePanel.peekButton': 'Look at the top…',
  'zonePanel.libraryOthers':
    'Only its owner can look at this library, and they cannot do it discreetly.',

  // — Siège et piles ————————————————————————————————————————
  'seat.disconnected': 'disconnected',
  'seat.turnMine': 'Turn {turn} · your turn',
  'seat.turn': 'Turn {turn}',
  'seat.revealingTop': '✨ reveals the top',
  'seat.lookingLibrary': '👁 is looking at their library',
  'seat.handRevealed': 'hand revealed',
  'seat.handCount': '{count} card(s) in hand',
  'seat.yourZone': 'Your zone',
  'seat.attachedObjects': 'Attached objects',
  'seat.commanderTaxNone': 'Commander tax: none, it has not been cast yet',
  'seat.commanderTax': 'Commander tax: +{tax} (cast {casts} times)',
  'seat.you': 'you',
  'seat.meSuffix': '{name} (me)',
  'seat.topRevealedMine': 'The top of your library is revealed to {names}',
  'seat.topRevealedOther': 'The top of this library is revealed to {names}',
  'seat.pileTitle': '{label} — {count}',

  // — Révélation publique ————————————————————————————————————
  'reveal.someone': 'An opponent',
  'reveal.altCard': 'Revealed card',
  'reveal.hint':
    'Hover a card to enlarge it. The player is currently choosing the destinations.',
  'reveal.reopen': {
    one: '{who} reveals {count} card',
    other: '{who} reveals {count} cards',
  },
  'reveal.headline': {
    one: 'reveals {count} card from the top of their library',
    other: 'reveals {count} cards from the top of their library',
  },

  // — Modale du compte ———————————————————————————————————————
  'account.title': 'My account',
  'account.openLabel': 'Open my account and settings',
  'account.guest': 'Not signed in',
  'account.displaySection': 'Display',
  'account.displayHint':
    'The interface language, and what you accept seeing change in order to get it.',

  // — Coût de mana ———————————————————————————————————————————
  'mana.costLabel': 'Mana cost: {cost}',
  'mana.white': 'white',
  'mana.blue': 'blue',
  'mana.black': 'black',
  'mana.red': 'red',
  'mana.green': 'green',
  'mana.colorless': 'colorless',
  'mana.snow': 'snow',
  'mana.generic': '{amount} generic',
  'mana.or': 'or',
  'mana.phyrexian': 'Phyrexian {part}',
  'mana.tap': 'tap',
  'mana.untap': 'untap',
  'mana.energy': 'energy',

  // — Console d'administration ———————————————————————————————
  'admin.title': 'Platform status',
  'admin.intro':
    'What the database can say about the platform, and nothing of what it can say about a game: accounts, counters and dates. No table content goes through here.',
  'admin.deniedTitle': 'There is nothing here',
  'admin.deniedDetail':
    'This address does not answer. If you administer this instance, check that you are signed in with an address listed in ADMIN_EMAILS and that its email is verified.',
  'admin.refresh': 'Refresh',
  'admin.updatedAt': 'Read at {time}',

  'admin.sectionPlatform': 'Health',
  'admin.sectionAccounts': 'Accounts',
  'admin.sectionTables': 'Tables',
  'admin.sectionCatalog': 'Catalogue',
  'admin.sectionUsers': 'Browse accounts',
  'admin.sectionRooms': 'Browse tables',
  'admin.sectionAudit': 'Admin log',

  'admin.statLiveRooms': 'Tables in memory',
  'admin.statProtocol': 'Protocol',
  'admin.statSessionsActive': 'Valid sessions',
  'admin.statSessionsStale': 'Expired sessions not yet purged',

  'admin.statAccounts': 'Accounts',
  'admin.statVerified': 'Verified emails',
  'admin.statUnverified': 'Unverified emails',
  'admin.statActiveDay': 'Seen within 24 h',
  'admin.statActiveWeek': 'Seen within 7 d',
  'admin.statActiveMonth': 'Seen within 30 d',
  'admin.statNewWeek': 'Created within 7 d',
  'admin.statNewMonth': 'Created within 30 d',
  'admin.statAdmins': 'Admin addresses',

  'admin.statTables': 'Tables in total',
  'admin.statLobby': 'In lobby',
  'admin.statPlaying': 'Playing',
  'admin.statEnded': 'Put away',
  'admin.statTablesActiveDay': 'Active within 24 h',
  'admin.statTablesNewWeek': 'Opened within 7 d',
  'admin.statSeats': 'Occupied seats',
  'admin.endedNote':
    'A table that is “put away” carries the ENDED status. Two paths lead there and the database does not tell them apart: the host closing the table, and the sweep that frees an empty table idle for six hours.',

  'admin.statDecks': 'Decks',
  'admin.statDeckOwners': 'Accounts with a deck',
  'admin.statCards': 'Cards',
  'admin.statTokens': 'Tokens',
  'admin.statLocalizations': 'Resolved translations',
  'admin.statPrintings': 'Translated printings',

  'admin.ingestTitle': 'Last ingest',
  'admin.ingestNever': 'No ingest has ever run on this instance.',
  'admin.ingestOk': 'Succeeded',
  'admin.ingestFailed': 'Failed',
  'admin.ingestRunning': 'Running',
  'admin.ingestAge': 'Bulk dated {hours} h ago',
  'admin.ingestUpserted': '{count} cards written',
  'admin.ingestFailedWeek': '{failed} failure(s) over {runs} run(s) in 7 days',

  'admin.searchLabel': 'Search an account',
  'admin.searchPlaceholder': 'Address or display name',
  'admin.noResults': 'No account matches.',
  'admin.showingOf': '{shown} shown of {total}',
  'admin.colAccount': 'Account',
  'admin.colCreated': 'Created',
  'admin.colLastSeen': 'Seen',
  'admin.colDecks': 'Decks',
  'admin.colSeats': 'Seats',
  'admin.colSessions': 'Sessions',
  'admin.badgeAdmin': 'Admin',
  'admin.badgeUnverified': 'Unverified',

  'admin.openRecord': 'Open record',
  'admin.detailSeats': 'Tables where this account has a seat',
  'admin.detailNoSeats': 'This account has no seat at any table.',
  'admin.seatedWarning':
    'This account is seated at a table that is not put away. Warn them before acting on their access.',
  'admin.seatLine': 'seat {index}',

  'admin.revoke': 'Revoke their sessions',
  'admin.revokeConfirm':
    'Sign {name} out of every device? They can sign back in with their password. A game already open is not interrupted.',
  'admin.revokeDone': '{count} session(s) revoked.',
  'admin.revokeFailed': 'Revocation failed.',
  'admin.revokeUnlogged': 'Sessions revoked, but the log could not be written. Worth reporting.',
  'admin.noDeleteNote':
    'Deleting an account is not offered here: it cascades to their decks and sessions, and leaves an orphan seat if the account is sitting at a live table. An account can delete itself from its own settings.',

  'admin.roomsAll': 'All',
  'admin.colTable': 'Table',
  'admin.colHost': 'Host',
  'admin.colActivity': 'Activity',
  'admin.roomPrivate': 'Private',
  'admin.roomPassword': 'Password',
  'admin.noRooms': 'No table matches.',

  'admin.auditEmpty': 'No admin action has been logged yet.',
  'admin.auditLine': '{actor} — {action} on {target}',

  'admin.colOpened': 'Opened',
  'admin.colJoined': 'Seated',

  'admin.sectionActivity': 'Latest activity',
  'admin.activityNote':
    'What happened on this instance, every source merged and sorted by date: accounts created, sign-ins, tables opened, seats taken, ingest runs, admin actions. Game actions are not here: they are not stored in the database. Neither is a table being put away: no column dates it.',
  'admin.activityEmpty': 'Nothing has happened on this instance yet.',
  'admin.actAccountCreated': 'Account created',
  'admin.actSessionOpened': 'Sign-in',
  'admin.actTableOpened': 'Table opened',
  'admin.actSeatJoined': 'Seat taken',
  'admin.actIngest': 'Ingest',
  'admin.actAdmin': 'Admin',

  // — Replay ————————————————————————————————————————————————
  'replay.title': 'Replay',
  'replay.loading': 'Loading replay…',
  'replay.notFound': 'There is no replay here',
  'replay.notFoundBody':
    'The address matches nothing, or the game is not over. A replay only exists once the game has ended — that is what stops anyone reading their opponents’ hands mid-game.',
  'replay.networkError': 'The replay could not be loaded. Try again.',
  'replay.viewLabel': 'Point of view',
  'replay.viewAll': 'See everything',
  'replay.viewAllHint': 'The game laid bare: hands, libraries, draws.',
  'replay.viewSeatHint': 'What this player could see at that exact moment.',
  'replay.first': 'Start',
  'replay.previous': 'Previous step',
  'replay.next': 'Next step',
  'replay.last': 'End',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.position': 'Step {current} of {total}',
  'replay.truncated':
    'The recording hit its limit: the game carries on beyond what this replay shows.',
  'replay.backToTable': 'Back to the table',

  // — Sharing a replay ——————————————————————————————————————
  'replay.shareTitle': 'Share this replay',
  'replay.shareNote':
    'The link shows the whole game to whoever holds it: every player’s hand, library and draws, not only yours.',
  'replay.shareCreate': 'Create a share link',
  'replay.shareRevoke': 'Close sharing',
  'replay.shareCopied': 'Link copied.',
  'replay.shareNone': 'This replay is not shared.',
  'replay.open': 'Watch the replay',
  'replay.home': 'Back to home',

  // — Actions assistées : jetons nommés, amasser, peupler, proliférer ————
  'assist.namedTokens': 'Create a named token…',
  'assist.tokensTitle': 'Named token',
  'assist.tokensDescription':
    'The keyword only names what gets created: the token is put down as is, nothing more. Other tokens are found through search and kept on the shelf.',
  'assist.tokensSubmit': 'Create',
  'assist.tokenLabel': 'Token',
  'assist.tokenClue': 'Clue (Investigate)',
  'assist.tokenTreasure': 'Treasure',
  'assist.tokenFood': 'Food',
  'assist.tokenBlood': 'Blood',
  'assist.tokenIncubator': 'Incubator (Incubate)',
  'assist.tokenCountLabel': 'How many',
  'assist.tokenIncubateLabel': '+1/+1 counters on the Incubator',
  'assist.tokenIncubateHint':
    'The number lives in your card’s rules text, which we do not store: it is yours to tell us.',
  'assist.tokenMissingTitle': 'Token not found',
  'assist.tokenMissing':
    'The local catalog holds no token named exactly “{name}”. Nothing was created: use the token search to pick one yourself.',
  'assist.amassNew': 'Amass N — new Army token…',
  'assist.amassThis': 'Amass N — on this card…',
  'assist.amassTitle': 'Amass',
  'assist.amassLabel': '+1/+1 counters',
  'assist.amassSubmit': 'Amass',
  'assist.populate': 'Populate (copy this token)',
  'assist.proliferateOne': 'Proliferate on this card',
  'assist.proliferateMany': 'Proliferate on {count} cards',
} as const);

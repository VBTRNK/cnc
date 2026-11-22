// Every line the player reads, under a stable key (docs/design.md: English only, stable
// keys, no i18n library). Templates take named values; whole sentences are never built
// from fragments, so another language can reorder them.

import { CODENAMES, GOODS, type GoodId, type HabitId, type HarmlessId, type PlaceId, type SkillId, type UpgradeId } from "../sim/index.ts";

const TEXT = {
  "app.name": "Crime & Crown",

  // Status
  "status.pockets": "Pockets {used}/{size}",
  "status.heat": "Heat {word}",
  "status.day": "Day {day}",
  "status.hoursLeft": "{hours} h left",
  "status.dayOver": "Day over",

  // Navigation
  "nav.street": "Street",
  "nav.city": "City",
  "nav.me": "Me",
  "nav.people": "People",
  "nav.label": "Screens",

  // Heat, risk and odds words
  "heat.low": "low",
  "heat.warm": "warm",
  "heat.hot": "hot",
  "heat.wanted": "wanted",
  "risk.chip": "{word} stop risk",
  "risk.slight": "slight",
  "risk.some": "some",
  "risk.real": "real",
  "risk.high": "high",
  "risk.figure": "{word} risk",
  "odds.likely": "likely",
  "odds.good": "good odds",
  "odds.even": "even odds",
  "odds.poor": "poor odds",
  "odds.long": "long odds",

  // Price hints and notes
  "hint.cheap": "cheap",
  "hint.pricey": "pricey",
  "note.short": "short",
  "note.glut": "glut",
  "note.soldOut": "sold out",
  "note.fewLeft": "few left",
  "note.noBuyers": "no buyers",

  // Street
  "street.flavour.docks": "The harbour coppers mostly watch the gulls.",
  "street.flavour.oldtown": "A bobby on every other corner.",
  "street.flavour.uptown": "Patrol cars idle outside every boutique.",
  "street.flavour.strip": "Neon, noise and the odd copper.",
  "street.held": "{n} held",
  "street.moves": "Moves",
  "street.market": "Market",
  "tip.dismiss.mags": "Dismiss Mags's tip: {line}",
  "tip.dismiss.phone": "Dismiss your phone's tip: {line}",
  "action.ask": "Ask around",
  "action.lieLow": "Lie low",
  "action.oddJob": "Odd job",
  "action.job": "Pull a job",
  "action.callDay": "Call it a day",
  "hours": "{n} h",
  "dismiss": "Dismiss",
  "close": "Close",

  // Trade sheet
  "trade.buy": "Buy",
  "trade.sell": "Sell",
  "trade.mode": "Buy or sell",
  "trade.facts": "{held} held · {stock} for sale here · room for {free}",
  "trade.fewer": "One fewer",
  "trade.more": "One more",
  "trade.max": "Max",
  "trade.units": "How many",
  "trade.commitBuy": "Buy {n} for {total}",
  "trade.commitSell": "Sell {n} for {total} · {hours} h",
  "trade.profit": "Profit {amount}",
  "trade.loss": "Loss {amount}",
  "trade.why.soldOut": "Sold out here.",
  "trade.why.noPockets": "No room in your pockets.",
  "trade.why.noCash": "You can't afford one.",
  "trade.why.noGoods": "You've none to sell.",
  "trade.why.noDemand": "Nobody here wants more today.",
  "trade.why.noTime": "Not enough hours left to sell one.",
  "trade.undealt.facts": "{held} held · they cost {paid}",
  "trade.why.noBuyers": "No buyers here.",

  // Job sheet
  "job.title": "Pull a job",
  "job.story": "Four hours. Pays {low} to {high} if it comes off. If not: heat, a limp or the cells.",
  "job.commit": "Pull the job · {hours} h",

  // Call it a day
  "callDay.title": "Call it a day?",
  "callDay.story": "{hours} h unused. Every hour you sit out cools your heat.",
  "callDay.commit": "Call it a day",

  // Results (the latest line on Street)
  "result.bought": "Bought {count} for {cost}.",
  "result.sold": "Sold {count} for {proceeds}.",
  "result.soldProfit": "Sold {count} for {proceeds}: {profit} profit.",
  "result.soldLoss": "Sold {count} for {proceeds}: a {loss} loss.",
  "result.soldOut": "Nobody here wants more {kind} today.",
  "result.travelled": "Over to {place}: {hours} h.",
  "result.tipPrice": "Word is {kind} go for {price} {at}.",
  "result.rumourNone": "Word is nothing big's coming tomorrow.",
  "result.rumourShortage": "Word is {kind} will be short {at} tomorrow.",
  "result.rumourGlut": "Word is {at} will be awash with {kind} tomorrow.",
  "result.laidLow": "Kept your head down. Heat {word}.",
  "result.oddJob": "Shifted crates for {pay}. Heat {word}.",
  "result.job.success": "The job came off: {pay}.",
  "result.job.nothing": "Nothing doing. Four hours wasted, and people noticed.",
  "result.job.hurt": "The job went wrong and you got hurt.",
  "result.job.arrested": "The job went wrong, and the law was waiting.",
  "result.legItFailed": "You legged it. Not fast enough.",
  "result.arrested": "They took {goods} and fined you {fine}.",
  "result.arrestedEmpty": "Nothing on you to take. They fined you {fine}.",
  "result.pattedDown": "Patted down. Nothing on you.",
  "result.bribed": "He pocketed {amount} and looked the other way.",
  "result.bribeRefused": "“I'm an honest copper.” He took the lot.",
  "result.bribeRefusedSale": "“I'm an honest copper.” He took the lot. The sale's off.",
  "result.rangRound": "Called around: prices from every corner. Heat {word}.",
  "result.leggedIt": "You legged it.",
  "result.handedOver": "He took the lot.",
  "result.handedOverSale": "He took the lot. The sale's off.",
  "result.upgraded.coat": "The big coat: {pockets} pockets.",
  "result.upgraded.phone": "The burner phone. Call around from the City.",
  "result.upgraded.crown": "The Crown & Anchor is yours, Guv'nor.",
  "result.mags": "Mags: “{line}”",
  "result.levelUp.patter": "Your patter improves: level {level}.",
  "result.levelUp.nerve": "Your nerve hardens: level {level}.",
  "result.levelUp.savvy": "You're getting savvy: level {level}.",
  "result.dayStarted": "Day {day}.",
  "result.dayStartedLate": "Day {day}. Out of the cells at {time}.",
  "result.refused": "That can't be done right now.",

  // Briefs (dismissable news on Street)
  "brief.day1": "Smokes going cheap at the Docks. The Strip's gasping.",
  "brief.shortage": "{Kind} have dried up {at}. Prices up until tomorrow night.",
  "brief.glut": "{At} is awash with {kind}. Prices down until tomorrow night.",
  "brief.morningShortage": "{Kind} short {at} today and tomorrow.",
  "brief.morningGlut": "{Kind} going cheap {at} today and tomorrow.",
  "brief.sweep": "Police sweep {at} until tomorrow night.",
  "brief.harmless.pigeons": "Pigeons have taken the town hall. Nobody is arresting them.",
  "brief.harmless.parade": "A brass band parade. Everyone's watching the tuba.",
  "brief.harmless.heatwave": "Heatwave. Even the ice-cream vans are sweating.",
  "brief.who.mags": "Mags:",
  "brief.who.phone": "Your phone:",

  // City
  "city.prices": "Prices",
  "city.tableLabel": "Prices, scrolls sideways",
  "city.here": "Here",
  "city.go": "Go",
  "city.goLabel": "Go to {place}, {hours} h",
  "city.tooLate": "too late",
  "city.head.sweep": "Sweep",
  "city.head.operation": "Pinch",
  "city.seen": "Seen",
  "city.unseen": "never",
  "city.seenNow": "now",
  "city.seenToday": "{time}",
  "city.seenDay": "day {day}",
  "city.ring": "Call around",
  "city.unknownPrice": "?",
  "city.unknownLabel": "not seen",
  "city.undealtPrice": "—",
  "city.undealtLabel": "not dealt here",
  "city.rumour": "Word on tomorrow: {line}",

  // Me
  "skill.patter": "Patter",
  "skill.nerve": "Nerve",
  "skill.savvy": "Savvy",
  "skill.patter.what": "You sell faster.",
  "skill.nerve.what": "Jobs, getaways and bribes go better.",
  "skill.savvy.what": "Less heat, truer rumours.",
  "skill.level": "Level {level} of 5",
  "me.form": "Form",
  "me.classifieds": "Classifieds",
  "me.smallPrint": "Small print",
  "upgrade.coat": "Big coat",
  "upgrade.phone": "Burner phone",
  "upgrade.coat.what": "{pockets} pockets instead of {from}.",
  "upgrade.coat.owned": "{pockets} pockets",
  "upgrade.coat.buyLabel": "Buy the big coat for {cost}",
  "upgrade.phone.owned": "call around",
  "upgrade.phone.buyLabel": "Buy the burner phone for {cost}",
  "upgrade.crown.owned": "{takings} a night",
  "upgrade.crown.buyLabel": "Buy the Crown & Anchor for {cost}",
  "upgrade.phone.what": "Call around from the City for every place's prices. Coppers listen in: each call adds heat.",
  "upgrade.crown": "The Crown & Anchor",
  "upgrade.crown.what": "Old Reg's pub on the Strip. Takes {takings} a night, and Pinch will know where you drink.",
  "crown.who": "Old Reg, landlord of the Crown & Anchor",
  "crown.story": "“{cost} and she's yours: the beer, the darts, the damp. I'm off to Margate.”",
  "crown.buy": "Buy the Crown & Anchor",
  "crown.notYet": "Not yet",
  "upgrade.owned": "Yours",
  "upgrade.buy": "Buy",
  "upgrade.short": "{amount} short",
  "upgrade.commit": "Buy the {name} for {cost}",
  "me.saveOptions": "Cloud, export, new run",

  // Save sheet and save status
  "save.title": "Save and run",
  "save.saved": "Saved on this device after every move.",
  "save.full": "This device is out of room, so the last moves aren't saved. Export your save to keep it.",
  "save.failed": "Saving on this device failed, so the last moves aren't saved. Export your save to keep it.",
  "save.off": "This browser won't keep your game. Export it before you close the tab.",
  "save.export": "Export save",
  "save.import": "Import save",
  "save.exportKept": "Export the damaged save",
  "save.newRun": "Start a new run",
  "save.newRun.confirm": "Start over from day 1? The current run is kept as a recovery copy.",
  "save.newRun.commit": "Start over",
  "save.import.confirm": "Replace your day {current} run with the imported day {day} run? The current one is kept as a recovery copy.",
  "save.import.commit": "Replace",
  "save.import.notSave": "That file isn't a Crime & Crown save.",
  "save.import.future": "That save is from a newer version of the game. Reload the game, then try again.",
  "save.import.damaged": "That save is damaged and can't be loaded.",
  "save.import.tooBig": "That file is too big to be a save.",
  "save.import.unreadable": "That file couldn't be read.",
  "save.cancel": "Keep playing",
  "save.exportRecovery": "Export the recovery copy",
  "save.replaceFailed": "This device couldn't keep the current run aside, so nothing changed.",

  // Cloud save (docs/design.md, "Cloud saves")
  "cloud.guest": "Keep this run in the cloud to play it on another device too.",
  "cloud.keep": "Keep in the cloud",
  "cloud.use": "Use a cloud code",
  "cloud.code": "Cloud code",
  "cloud.codeHelp": "Enter it on another device to play this run there. Anyone with the code can play it, and a lost code can't be recovered: write it down.",
  "cloud.copy": "Copy code",
  "cloud.copied": "Copied",
  "cloud.useCommit": "Use this code",
  "cloud.checking": "Checking the code…",
  "cloud.forget": "Stop syncing here",
  "cloud.forget.confirm": "Stop syncing and return to your guest game. Your device keeps its save unless you remove it.",
  "cloud.forget.remove": "Remove from this device",
  "cloud.forget.removeHint": "Removing deletes the save and recovery copies on this device. Any cloud copy is left alone. Export first if you want to keep a copy.",
  "cloud.forget.stopping": "Stopping…",
  "cloud.removeRetry": "Try removing it again",
  "cloud.removeLeave": "Leave it",
  "cloud.error.stop": "This device couldn't record that it stopped syncing, so it still does. Try again.",
  "cloud.error.restore": "This device is out of room, so the run couldn't be put back. Export your save to keep it, then try again.",
  "cloud.error.notRemoved": "This device stopped syncing, but couldn't delete the run's copy here.",
  "cloud.restore": "Put it back in the cloud",
  "cloud.error.badCode": "That isn't a cloud code. It has 16 letters and digits.",
  "cloud.error.unknown": "No cloud save has that code.",
  "cloud.error.network": "Couldn't reach the cloud. Check your connection and try again.",
  "cloud.error.future": "That run is from a newer version of the game. Reload the game, then try again.",
  "cloud.error.unreadable": "The run under that code can't be read.",
  "cloud.error.full": "This device is out of room, so the run couldn't move to the cloud.",
  "sync.synced": "Saved on this device and in the cloud, {when}.",
  "sync.pending": "Saved on this device. Sending it to the cloud.",
  "sync.failed.offline": "Saved on this device. The cloud can't be reached; it catches up when you're back online.",
  "sync.failed.busy": "Saved on this device. The cloud is busy; it tries again with your next move.",
  "sync.failed.gone": "Saved on this device, but the cloud no longer has a run under this code.",
  "sync.failed.storage": "This device is out of room, so the cloud can't be kept up to date. Export your save to keep it.",
  "sync.failed.refused": "Saved on this device. The cloud refused this save.",
  "sync.failed.future": "Your cloud save is from a newer version of the game. Reload to get it; nothing is sent until then.",
  "sync.conflict": "Your run changed on another device too. Choose which one to keep.",
  "sync.last": "Last in the cloud {when}.",
  "choice.title": "Two runs",
  "choice.conflict": "This device and the cloud both have moves the other hasn't. Keep one; the other stays on this device as a recovery copy.",
  "choice.guest": "That code already has a run. Play that one, or put this guest run in its place.",
  "choice.device": "This device",
  "choice.guestRun": "This guest run",
  "choice.cloud": "The cloud",
  "choice.day": "Day {day} · {hours} h left · {cash}",
  "choice.night": "Day {day} · night · {cash}",
  "choice.otherRun": "Another run",
  "choice.unreadable": "This version of the game can't read it.",
  "choice.saved": "Saved {when}",
  "choice.keepDevice": "Keep this device's run",
  "choice.keepGuest": "Use the guest run",
  "choice.keepCloud": "Keep the cloud run",
  "choice.playCloud": "Play the cloud run",
  "choice.failed": "This device is out of room, so the choice couldn't be stored and nothing changed. Try again, or export this device's run first.",
  "choice.later": "Not now",
  "choice.open": "Choose a run",

  // Notices and tabs
  "notice.recovered": "Your save was damaged, so the game picked up from its backup copy.",
  "notice.lost": "Your save couldn't be read, so a new run started. The damaged save is kept.",
  "notice.imported": "Save imported.",
  "notice.newRun": "A new run. Day 1 at the Docks.",
  "notice.fromCloud": "Picked up your run from the cloud.",
  "watch.banner": "The game is open in another tab. This one only watches.",
  "future.title": "A newer save",
  "future.story": "This save comes from a newer version of the game. Reload to get it; the save is untouched.",
  "future.reload": "Reload",
  "future.export": "Export the save",

  // Stop card
  "stop.stamp": "Stopped",
  "stop.who": "The copper on the beat",
  "stop.bribe": "Slip him something",
  "stop.bribe.after.sell": "He takes it: the sale goes ahead. He's honest: he takes your goods.",
  "stop.bribe.after.job": "He takes it: on to the job. He's honest: he takes your goods.",
  "stop.bribe.wanted": "You're wanted. He won't be bought.",
  "stop.bribe.short": "You can't cover what he'd want.",
  "stop.bribe.pinch": "Pinch can't be bought. He'd tell the papers.",
  "stop.legIt": "Leg it",
  "chip.cost": "−{amount}",
  "chip.heat": "Heat +{heat}",
  "chip.odds": "{odds}",
  "chip.gain": "+{amount}",
  "chip.cool": "Heat −{heat}",
  "chip.add": "+{goods}",
  "chip.lose": "Half your {kind}",
  "chip.xp": "{skill} +{n}",
  "chip.tip": "A tip",
  "chip.move": "Operation moves",

  // The cells, after an arrest
  "cells.head": "Nicked!",
  "cells.out": "Out at {time}",
  "cells.go": "Spend the night",

  // Newspaper
  "paper.masthead": "The Crown Courier",
  "paper.byline": "By Lenny Scoop",
  "paper.edition": "Day {day} · Late edition",
  "paper.start": "Start day {day}",
  "paper.arrested.head": "Nicked!",
  "paper.arrested.story": "Fined {fine} and a cold night in the cells. Out at {time} tomorrow.",
  "paper.chip.fine": "Fine {amount}",
  "paper.chip.seized": "Seized {n}",
  "paper.hurt.head": "Job goes sideways",
  "paper.hurt.story": "Home early, nursing a limp. Tomorrow's a fresh start.",
  "paper.shortage.head": "{Kind} dry up {at}",
  "paper.glut.head": "{At} drowning in {kind}",
  "paper.sweep.head": "Police sweep {at}",
  "paper.harmless.pigeons.head": "Pigeons seize town hall",
  "paper.harmless.parade.head": "Brass band brings city to a halt",
  "paper.harmless.heatwave.head": "Scorcher!",
  "paper.harmless.story": "Nothing in it for you, but the city talks of little else.",
  "paper.tomorrowShortage.head": "{Kind} run short {at}",
  "paper.tomorrowGlut.head": "{Kind} flood {at}",
  "paper.best.head": "{Kind} fly {at}",
  "paper.best.story": "{count} gone for {proceeds}, and nobody the wiser.",
  "paper.quiet.head": "Quiet night on the streets",
  "paper.quiet.story": "The city sleeps with one eye open.",
  "paper.chip.takings": "Takings {amount}",
  "paper.chip.pub": "Pub {amount}",
  "paper.chip.spent": "Spent {amount}",
  "paper.chip.job": "Job {amount}",
  "paper.chip.stops": "Stops {n}",
  "paper.chip.cash": "Cash {amount}",
  "paper.chip.heat": "Heat {word}",

  // Milestones on the front page
  "paper.first.crown.head": "Long live the Guv'nor!",
  "paper.first.crown.story": "The Crown & Anchor changes hands and Old Reg heads for the seaside. Chapter one closes; the bar stays open.",
  "paper.first.grand.head": "A grand in the hand",
  "paper.first.grand.story": "Four figures. The kiosk talks of nothing else.",
  "paper.first.phone.head": "Hello, who's this?",
  "paper.first.phone.story": "A burner phone on the street. Somewhere, a copper puts on headphones.",
  "paper.first.coat.head": "Big coat, bigger plans",
  "paper.first.coat.story": "Fifteen more pockets, and nobody asks what's in the lining.",
  "paper.first.escape.head": "The one that got away",
  "paper.first.escape.story": "A suspect legs it from the law. Witnesses describe a blur.",
  "paper.first.job.head": "Job done",
  "paper.first.job.story": "A tidy job for a tidy sum. The Yard is baffled.",
  "paper.first.sale.head": "Open for business",
  "paper.first.sale.story": "Every empire starts with a carton.",

  // Pinch in the paper
  "paper.pinch.intro.head": "New on the beat",
  "paper.pinch.intro.story": "Detective Sergeant Percy Pinch is watching who turns up where and what they do there. “The regulars are usually good for a story,” says Lenny Scoop.",
  "paper.pinch.promoted.head": "Pinch made Inspector",
  "paper.pinch.promoted.story": "After you bought the Crown & Anchor, Pinch was promoted to Detective Inspector. His new operations cover two neighbourhoods.",
  "paper.brief.credit": "Pinch claims the collar: “All part of the plan.”",
  "paper.brief.reg.0": "Old Reg of the Crown & Anchor: “{cost} and she's yours. Please.”",
  "paper.brief.reg.1": "The Crown & Anchor's ceiling fell in again. Old Reg wants out.",
  "paper.brief.reg.2": "Old Reg seen reading seaside brochures behind the bar.",

  // Cases
  "case.label.smokes": "the {Adj} Smokes Ring",
  "case.label.tapes": "the {Adj} Tape Racket",
  "case.label.watches": "the {Adj} Watch Cartel",
  "case.label.fireworks": "the {Adj} Fireworks Plot",
  "case.label.gum": "the {Adj} Bubblegum Gang",
  "case.label.soda": "the {Adj} Soda Smugglers",
  "case.label.alibi": "the {Adj} Perfume Mob",
  "case.label.trainers": "the {Adj} Trainer Ring",
  "case.label.phones": "the {Adj} Phone Snatchers",
  "case.label.brie": "the {Adj} Cheese Board",
  "case.label.bingo": "the {Adj} Bingo Ball Syndicate",
  "case.label.ebikes": "the {Adj} E-Bike Gang",
  "case.label.ask": "the {Adj} Gossip Network",
  "case.label.lieLow": "the {Adj} Loitering Syndicate",
  "case.label.oddJob": "the {Adj} Odd-Job Syndicate",
  "case.label.job": "the {Adj} Heist Mob",
  "case.label.drink": "the {Adj} Drinking Club",
  "and": "{a} and {b}",

  // People: Pinch's board and the cast
  "people.pinch.sergeant": "Detective Sergeant Percy Pinch",
  "people.pinch.inspector": "Detective Inspector Percy Pinch",
  "people.pinch.unaware": "Hasn't noticed you. Yet.",
  "people.pinch.watching": "Watching. He knows where you've been seen.",
  "people.case.older": "And {n} older cases: {closed} closed, {cold} cold.",
  "people.exhibits": "Exhibits",
  "people.exhibit.newest": "Exhibit {letter} · newest",
  "people.exhibits.newestFirst": "Exhibits, newest first",
  "people.exhibits.one": "1 exhibit",
  "people.exhibits.count": "{n} exhibits",
  "people.cases": "Earlier operations",
  "people.file.open": "Open the file",
  "people.file.close": "Close the file",
  "people.cast": "The cast",
  "exhibit.sale": "A first sale, day {day}.",
  "exhibit.sale.reading": "The Opening Move of a Vast Criminal Enterprise.",
  "exhibit.grand": "{amount} in hand, day {day}.",
  "exhibit.grand.reading": "Unexplained Wealth.",
  "exhibit.coat": "A larger coat, day {day}.",
  "exhibit.coat.reading": "Significant Expansion of Distribution Capacity.",
  "exhibit.phone": "A burner phone, day {day}.",
  "exhibit.phone.reading": "A Sophisticated Communications Network.",
  "exhibit.job": "A job that came off, day {day}.",
  "exhibit.job.reading": "Unmistakable Signs of Organisation.",
  "exhibit.arrest": "A night in the cells, day {day}.",
  "exhibit.arrest.reading": "Proof My Methods Work.",
  "exhibit.escape": "A stop legged from, day {day}.",
  "exhibit.escape.reading": "Superhuman Evasion. Possibly Trained.",
  "exhibit.case": "His first case, day {day}.",
  "exhibit.case.reading": "The Net Tightens.",
  "exhibit.crown": "The Crown & Anchor, day {day}.",
  "exhibit.crown.reading": "A Front. Obviously a Front.",
  "exhibit.promotion": "His promotion, day {day}.",
  "exhibit.promotion.reading": "Long Overdue.",
  "exhibit.best": "A {amount} day, day {day}.",
  "exhibit.best.reading": "Laundering on an Industrial Scale.",
  "cast.lenny": "Lenny Scoop, The Crown Courier",
  "cast.lenny.line": "“Anything for a story, pal.”",
  "cast.lenny.guvnor": "“Anything for the Guv'nor. Within reason. Mostly.”",
  "cast.mags": "Mags, the news kiosk",
  "cast.mags.line": "“Heard something? Course I have. Ask.”",
  "cast.mags.cells": "“Out already, love? Kettle's on.”",
  "cast.reg": "Old Reg, the Crown & Anchor",
  "cast.reg.line": "“{cost} and she's yours. I'm begging.”",
  "cast.reg.gone": "“Postcard from Margate. Wish you were here. Not really.”",

  // Cards: the dossier, the choices and their results
  "card.stamp": "On the street",
  "card.stamp.lenny": "Exclusive",
  "card.why.noCash": "You can't cover it.",
  "card.why.noPockets": "No room in your pockets.",
  "card.why.noGoods": "You've none to sell.",
  "card.terry.who": "Terry, back of a van",
  "card.terry.story": "“Twenty cartons, ninety quid. Fell off a lorry. Several lorries.”",
  "card.terry.buy": "Take them",
  "card.terry.buy.done": "{goods} for {cost}. Terry's gone before you can count them.",
  "card.terry.pass": "Pass",
  "card.terry.pass.done": "Terry shrugs and drives off.",
  "card.customs.who": "A customs officer, looking the other way",
  "card.customs.story": "“A seized crate's ten tapes short. Ninety quid and I never counted.”",
  "card.customs.buy": "Buy them",
  "card.customs.buy.done": "{goods} for {cost}. He's already counting something else.",
  "card.customs.pass": "Pass",
  "card.customs.pass.done": "He goes back to not looking.",
  "card.genuineWatch.who": "A collector in a camel coat",
  "card.genuineWatch.story": "“That's a genuine one. Don't argue. I'll pay half as much again.”",
  "card.genuineWatch.sell": "Sell him one",
  "card.genuineWatch.sell.done": "He paid {amount} for a watch you know is fake.",
  "card.genuineWatch.pass": "Pass",
  "card.genuineWatch.pass.done": "He'll find another mug.",
  "card.churchRoof.who": "The vicar of St Agatha's",
  "card.churchRoof.story": "“The roof leaks. The Lord provides, mostly through donations.”",
  "card.churchRoof.give": "Give $50",
  "card.churchRoof.give.done": "The vicar thanks you loudly. Even the coppers heard.",
  "card.churchRoof.walkOn": "Walk on",
  "card.churchRoof.walkOn.done": "You walk on. So does the rain.",
  "card.doubleOrNothing.who": "A man with three cups",
  "card.doubleOrNothing.story": "“Double or nothing, sport. A hundred says you can't find the pea.”",
  "card.doubleOrNothing.bet": "Bet $100",
  "card.doubleOrNothing.bet.after": "Find it: +$100. Don't: −$100.",
  "card.doubleOrNothing.bet.won": "Found the pea. He pays up, sulking.",
  "card.doubleOrNothing.bet.lost": "No pea. There never was a pea.",
  "card.doubleOrNothing.pass": "Pass",
  "card.doubleOrNothing.pass.done": "He finds another mark.",
  "card.mugger.who": "A mugger with a cosh",
  "card.mugger.story": "“Wallet. Now.”",
  "card.mugger.handOver": "Hand over $50",
  "card.mugger.handOver.done": "He takes $50 and says thanks, which is worse.",
  "card.mugger.stand": "Stand up to him",
  "card.mugger.stand.after": "Face him down and your nerve grows. Lose, and he takes $120.",
  "card.mugger.stand.won": "He thinks better of it. Your knees agree, later.",
  "card.mugger.stand.lost": "He takes $120 and your dignity.",
  "card.mugger.run": "Run",
  "card.mugger.run.done": "You run. He doesn't bother.",
  "card.tradingStandards.who": "A Trading Standards officer",
  "card.tradingStandards.story": "“Just a routine look in your pockets, sir.”",
  "card.tradingStandards.duck": "Duck into a doorway",
  "card.tradingStandards.duck.done": "An hour in a doorway. He's gone.",
  "card.tradingStandards.brazen": "Brazen it out",
  "card.tradingStandards.brazen.after": "Talk your way out on patter. Fail, and he takes half of what you carry most.",
  "card.tradingStandards.brazen.won": "“Carry on, sir.” You do.",
  "card.tradingStandards.brazen.lost": "He took {goods}. “Confiscated, sir.”",
  "card.oldMate.who": "Dougie, an old mate",
  "card.oldMate.story": "“Lend us a ton? Pay you back with interest. Swear on me mum.”",
  "card.oldMate.lend": "Lend him $100",
  "card.oldMate.lend.done": "Dougie swears on his mum and is gone.",
  "card.oldMate.notNow": "Not now",
  "card.oldMate.notNow.done": "Dougie understands. He looks hurt about it.",
  "card.oldMatePays.report": "Dougie turns up with {amount} and a tip. His mum's fine.",
  "card.noQuestions.who": "A man in a balaclava, in broad daylight",
  "card.noQuestions.story": "“Three boxes of fireworks. Three-sixty. No questions.”",
  "card.noQuestions.buy": "Buy them",
  "card.noQuestions.buy.done": "{goods} for {cost}. No questions. Several answers.",
  "card.noQuestions.pass": "Pass",
  "card.noQuestions.pass.done": "He goes, loudly.",
  "card.falseTrail.who": "Lenny Scoop, The Crown Courier",
  "card.falseTrail.leave": "Leave it",
} as const;

export type TextKey = keyof typeof TEXT;

/** A key built at run time (cards, exhibits); tests check that every one exists. */
export const hasText = (key: string): key is TextKey => key in TEXT;
export type Values = Record<string, string | number>;

/** The text for `key` with its {names} filled in. A missing value is a bug, so it shows. */
export function t(key: TextKey, values: Values = {}): string {
  return TEXT[key].replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = values[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

/** A server time as the player reads it: "18 Nov, 19:02". */
export const when = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---- Names ---------------------------------------------------------------------------

export interface GoodNames {
  name: string;
  /** One line under the name in its trade sheet. */
  tagline: string;
  one: string;
  other: string;
  kind: string;
  Kind: string;
}

/** The goods. Every name keeps to the good-names rule (goodNames.test.ts). */
export const GOOD_NAMES: Record<GoodId, GoodNames> = {
  smokes: { name: "Untaxed Smokes", tagline: "The duty's been paid. By nobody.", one: "carton of smokes", other: "cartons of smokes", kind: "smokes", Kind: "Smokes" },
  tapes: { name: "Bootleg Tapes", tagline: "Recorded live from the back row.", one: "tape", other: "tapes", kind: "tapes", Kind: "Tapes" },
  watches: { name: "Swiss-ish Watches", tagline: "Keeps time. Mostly someone else's.", one: "watch", other: "watches", kind: "watches", Kind: "Watches" },
  fireworks: { name: "Fireworks", tagline: "Light the blue touchpaper and leg it.", one: "box of fireworks", other: "boxes of fireworks", kind: "fireworks", Kind: "Fireworks" },
  gum: { name: "Banned Bubblegum", tagline: "Illegal in three countries. Nobody says which.", one: "packet of gum", other: "packets of gum", kind: "bubblegum", Kind: "Bubblegum" },
  soda: { name: "Speakeasy Soda", tagline: "Says soda on the label. Isn't.", one: "bottle of soda", other: "bottles of soda", kind: "soda", Kind: "Soda" },
  alibi: { name: "Eau d’Alibi", tagline: "Smell like you were somewhere else.", one: "bottle of Eau d’Alibi", other: "bottles of Eau d’Alibi", kind: "Eau d’Alibi", Kind: "Eau d’Alibi" },
  trainers: { name: "Two-Left Trainers", tagline: "Both left. Both very fashionable.", one: "pair of trainers", other: "pairs of trainers", kind: "trainers", Kind: "Trainers" },
  phones: { name: "Hot Phones", tagline: "Stolen, still warm.", one: "hot phone", other: "hot phones", kind: "phones", Kind: "Phones" },
  brie: { name: "Back-Alley Brie", tagline: "A whole wheel, matured behind the bins.", one: "wheel of brie", other: "wheels of brie", kind: "brie", Kind: "Brie" },
  bingo: {
    name: "Stolen Bingo Balls",
    tagline: "The hall's only certified set. Every pensioner wants it back.",
    one: "set of bingo balls",
    other: "sets of bingo balls",
    kind: "bingo balls",
    Kind: "Bingo balls",
  },
  ebikes: { name: "Pre-Loved E-Bikes", tagline: "Slightly owned.", one: "e-bike", other: "e-bikes", kind: "e-bikes", Kind: "E-bikes" },
};

interface PlaceNames {
  name: string;
  /** "Docks", "Old Town": before a noun, in a case's label. */
  adj: string;
  /** "at the Docks", "in Old Town": where something is. */
  at: string;
  At: string;
  /** "the Docks", "Old Town": mid-sentence. */
  the: string;
}

const PLACE_NAMES: Record<PlaceId, PlaceNames> = {
  docks: { name: "The Docks", adj: "Docks", at: "at the Docks", At: "The Docks", the: "the Docks" },
  oldtown: { name: "Old Town", adj: "Old Town", at: "in Old Town", At: "Old Town", the: "Old Town" },
  uptown: { name: "Uptown", adj: "Uptown", at: "uptown", At: "Uptown", the: "Uptown" },
  strip: { name: "The Strip", adj: "Strip", at: "on the Strip", At: "The Strip", the: "the Strip" },
};

export const goodName = (g: GoodId): string => GOOD_NAMES[g].name;
export const goodTagline = (g: GoodId): string => GOOD_NAMES[g].tagline;
/** The goods by display name, as Street and City list them. */
export const goodsByName = (): GoodId[] => [...GOODS].sort((a, b) => goodName(a).localeCompare(goodName(b), "en"));
export const goodKind = (g: GoodId): string => GOOD_NAMES[g].kind;
/** "12 tapes", "1 carton of smokes". */
export const goodCount = (g: GoodId, n: number): string => `${n} ${n === 1 ? GOOD_NAMES[g].one : GOOD_NAMES[g].other}`;
export const goodValues = (g: GoodId): Values => ({ kind: GOOD_NAMES[g].kind, Kind: GOOD_NAMES[g].Kind });
export const placeName = (p: PlaceId): string => PLACE_NAMES[p].name;
/** "Docks", "Strip": a column head. */
export const placeShort = (p: PlaceId): string => PLACE_NAMES[p].adj;
export const placeValues = (p: PlaceId): Values => ({
  place: PLACE_NAMES[p].the,
  at: PLACE_NAMES[p].at,
  At: PLACE_NAMES[p].At,
});

export const skillName = (k: SkillId): string => t(`skill.${k}`);

const capital = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

/** "Kipper": a case's codename by its number, repeating after the last. */
export const codename = (n: number): string => {
  const id = CODENAMES[(n - 1) % CODENAMES.length] as string;
  return capital(id);
};

/** "the Uptown Watch Cartel". */
export function caseLabel(place: PlaceId, habit: HabitId): string {
  return t(`case.label.${habit}`, { Adj: PLACE_NAMES[place].adj });
}

/** Places in a sentence: "the Docks", "the Docks and Uptown". */
export function placesText(places: readonly PlaceId[], form: "the" | "at" = "the"): string {
  const names = places.map((p) => PLACE_NAMES[p][form]);
  return names.length === 2 ? t("and", { a: names[0]!, b: names[1]! }) : (names[0] ?? "");
}

export const upper = capital;
export const upgradeName = (u: UpgradeId): string => t(`upgrade.${u}`);
export const harmlessKey = (h: HarmlessId) => `brief.harmless.${h}` as const;

export const money = (n: number): string => `$${n.toLocaleString("en-US")}`;
export const clock = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

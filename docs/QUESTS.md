# Quest scripts (69)

**Not all quest scripts are perfected yet.** Some can stop part way or need a manual nudge, especially on a live
server. Legends' Quest is the roughest: part C was fixed just before this export, and part B can still stop in a rare
case during its mid-quest bank trip (1 of 4 seeded sim runs). Read the notes file before a live run.

Each launcher runs from `server/webclient` and has three modes: `--sim [name]` (a local engine only, with setup
cheats), `--live <account>` (all cheats blocked) and `--supply` (prints the items to carry). The notes file next to
each launcher lists its prerequisites, supplies, measured sim ticks and known limits. Read it before a live run:
several quests need earlier quests, skill levels or a partner account. Some are parts of longer chains, for example
the Legends' Quest segments or the Lost City and Troll Stronghold drivers.

```sh
cd server/webclient
bun ../../tools/lockstep/run-sim.ts <launcher> [--instance N]          # one --sim run (start tools/lockstep/sim-engine.ts first)
bun <launcher> --supply
bun <launcher> --live <account>                     # reads bots/<account>/bot.env at the checkout root; LC_HOST=<host:port> picks another server than the public demo
```

| quest | launcher (from server/webclient) | notes |
|---|---|---|
| Death Plateau | `headless/quests-share/run-death-plateau.ts` | `headless/quests-share/run-death-plateau.share.md` |
| Lost City | `headless/quests-share/run-lost-city.ts` | `headless/quests-share/run-lost-city.share.md` |
| Rune Mysteries | `headless/quests-share/run-rune-mysteries.ts` | `headless/quests-share/run-rune-mysteries.share.md` |
| Troll Stronghold | `headless/quests-share/run-troll-stronghold.ts` | `headless/quests-share/run-troll-stronghold.share.md` |
| Legends' Quest bot | `headless/speedrun/legs/legends/run-legends.ts` | `headless/speedrun/legs/legends/run-legends.share.md` |
| Biohazard | `headless/speedrun/legs/qp/ardougne/run-biohazard.ts` | `headless/speedrun/legs/qp/ardougne/run-biohazard.share.md` |
| Clock Tower | `headless/speedrun/legs/qp/ardougne/run-clock-tower.ts` | `headless/speedrun/legs/qp/ardougne/run-clock-tower.share.md` |
| Fight Arena | `headless/speedrun/legs/qp/ardougne/run-fight-arena.ts` | `headless/speedrun/legs/qp/ardougne/run-fight-arena.share.md` |
| Hazeel Cult | `headless/speedrun/legs/qp/ardougne/run-hazeel-cult.ts` | `headless/speedrun/legs/qp/ardougne/run-hazeel-cult.share.md` |
| Observatory Quest | `headless/speedrun/legs/qp/ardougne/run-observatory.ts` | `headless/speedrun/legs/qp/ardougne/run-observatory.share.md` |
| Plague City | `headless/speedrun/legs/qp/ardougne/run-plague-city.ts` | `headless/speedrun/legs/qp/ardougne/run-plague-city.share.md` |
| Sheep Herder | `headless/speedrun/legs/qp/ardougne/run-sheep-herder.ts` | `headless/speedrun/legs/qp/ardougne/run-sheep-herder.share.md` |
| Tribal Totem | `headless/speedrun/legs/qp/ardougne/run-tribal-totem.ts` | `headless/speedrun/legs/qp/ardougne/run-tribal-totem.share.md` |
| Cook's Assistant | `headless/speedrun/legs/qp/f2p-a/run-cooks-assistant.ts` | `headless/speedrun/legs/qp/f2p-a/run-cooks-assistant.share.md` |
| Demon Slayer | `headless/speedrun/legs/qp/f2p-a/run-demon-slayer.ts` | `headless/speedrun/legs/qp/f2p-a/run-demon-slayer.share.md` |
| Ernest the Chicken (4 QP) — speedrun leg | `headless/speedrun/legs/qp/f2p-a/run-ernest-the-chicken.ts` | `headless/speedrun/legs/qp/f2p-a/run-ernest-the-chicken.share.md` |
| Gertrude's Cat | `headless/speedrun/legs/qp/f2p-a/run-gertrudes-cat.ts` | `headless/speedrun/legs/qp/f2p-a/run-gertrudes-cat.share.md` |
| The Restless Ghost | `headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts` | `headless/speedrun/legs/qp/f2p-a/run-restless-ghost.share.md` |
| Romeo & Juliet | `headless/speedrun/legs/qp/f2p-a/run-romeo-juliet.ts` | `headless/speedrun/legs/qp/f2p-a/run-romeo-juliet.share.md` |
| Sheep Shearer | `headless/speedrun/legs/qp/f2p-a/run-sheep-shearer.ts` | `headless/speedrun/legs/qp/f2p-a/run-sheep-shearer.share.md` |
| Vampire Slayer | `headless/speedrun/legs/qp/f2p-a/run-vampire-slayer.ts` | `headless/speedrun/legs/qp/f2p-a/run-vampire-slayer.share.md` |
| Black Knights' Fortress | `headless/speedrun/legs/qp/f2p-b/run-black-knights-fortress.ts` | `headless/speedrun/legs/qp/f2p-b/run-black-knights-fortress.share.md` |
| Goblin Diplomacy | `headless/speedrun/legs/qp/f2p-b/run-goblin-diplomacy.ts` | `headless/speedrun/legs/qp/f2p-b/run-goblin-diplomacy.share.md` |
| The Knight's Sword | `headless/speedrun/legs/qp/f2p-b/run-knights-sword.ts` | `headless/speedrun/legs/qp/f2p-b/run-knights-sword.share.md` |
| Pirate's Treasure | `headless/speedrun/legs/qp/f2p-b/run-pirates-treasure.ts` | `headless/speedrun/legs/qp/f2p-b/run-pirates-treasure.share.md` |
| Prince Ali Rescue | `headless/speedrun/legs/qp/f2p-b/run-prince-ali-rescue.ts` | `headless/speedrun/legs/qp/f2p-b/run-prince-ali-rescue.share.md` |
| Shield of Arrav — a pair of accounts | `headless/speedrun/legs/qp/f2p-b/run-shield-of-arrav.ts` | `headless/speedrun/legs/qp/f2p-b/run-shield-of-arrav.share.md` |
| Witch's Potion | `headless/speedrun/legs/qp/f2p-b/run-witchs-potion.ts` | `headless/speedrun/legs/qp/f2p-b/run-witchs-potion.share.md` |
| Elemental Workshop | `headless/speedrun/legs/qp/kandarin/run-elemental-workshop.ts` | `headless/speedrun/legs/qp/kandarin/run-elemental-workshop.share.md` |
| Fishing Contest | `headless/speedrun/legs/qp/kandarin/run-fishing-contest.ts` | `headless/speedrun/legs/qp/kandarin/run-fishing-contest.share.md` |
| Holy Grail | `headless/speedrun/legs/qp/kandarin/run-holy-grail.ts` | `headless/speedrun/legs/qp/kandarin/run-holy-grail.share.md` |
| Merlin's Crystal | `headless/speedrun/legs/qp/kandarin/run-merlins-crystal.ts` | `headless/speedrun/legs/qp/kandarin/run-merlins-crystal.share.md` |
| Monk's Friend | `headless/speedrun/legs/qp/kandarin/run-monks-friend.ts` | `headless/speedrun/legs/qp/kandarin/run-monks-friend.share.md` |
| Murder Mystery | `headless/speedrun/legs/qp/kandarin/run-murder-mystery.ts` | `headless/speedrun/legs/qp/kandarin/run-murder-mystery.share.md` |
| Scorpion Catcher | `headless/speedrun/legs/qp/kandarin/run-scorpion-catcher.ts` | `headless/speedrun/legs/qp/kandarin/run-scorpion-catcher.share.md` |
| Haunted Mine | `headless/speedrun/legs/qp/morytania/run-haunted-mine.ts` | `headless/speedrun/legs/qp/morytania/run-haunted-mine.share.md` |
| In Search of the Myreque | `headless/speedrun/legs/qp/morytania/run-in-search-of-the-myreque.ts` | `headless/speedrun/legs/qp/morytania/run-in-search-of-the-myreque.share.md` |
| Nature Spirit | `headless/speedrun/legs/qp/morytania/run-nature-spirit.ts` | `headless/speedrun/legs/qp/morytania/run-nature-spirit.share.md` |
| Priest in Peril | `headless/speedrun/legs/qp/morytania/run-priest-in-peril.ts` | `headless/speedrun/legs/qp/morytania/run-priest-in-peril.share.md` |
| Shades of Mort'ton | `headless/speedrun/legs/qp/morytania/run-shades-of-mortton.ts` | `headless/speedrun/legs/qp/morytania/run-shades-of-mortton.share.md` |
| Death Plateau | `headless/speedrun/legs/qp/rebuild/run-death-plateau.ts` | `headless/speedrun/legs/qp/rebuild/run-death-plateau.share.md` |
| Rune Mysteries | `headless/speedrun/legs/qp/rebuild/run-rune-mysteries.ts` | `headless/speedrun/legs/qp/rebuild/run-rune-mysteries.share.md` |
| Big Chompy Bird Hunting | `headless/speedrun/legs/qp/south/run-big-chompy-bird-hunting.ts` | `headless/speedrun/legs/qp/south/run-big-chompy-bird-hunting.share.md` |
| Tai Bwo Wannai Trio | `headless/speedrun/legs/qp/south/run-tai-bwo-wannai-trio.ts` | `headless/speedrun/legs/qp/south/run-tai-bwo-wannai-trio.share.md` |
| Temple of Ikov | `headless/speedrun/legs/qp/south/run-temple-of-ikov.ts` | `headless/speedrun/legs/qp/south/run-temple-of-ikov.share.md` |
| The Dig Site | `headless/speedrun/legs/qp/south/run-the-digsite.ts` | `headless/speedrun/legs/qp/south/run-the-digsite.share.md` |
| The Tourist Trap | `headless/speedrun/legs/qp/south/run-the-tourist-trap.ts` | `headless/speedrun/legs/qp/south/run-the-tourist-trap.share.md` |
| Dragon Slayer | `headless/speedrun/legs/qp/spine/run-dragon-slayer.ts` | `headless/speedrun/legs/qp/spine/run-dragon-slayer.share.md` |
| Family Crest | `headless/speedrun/legs/qp/spine/run-family-crest.ts` | `headless/speedrun/legs/qp/spine/run-family-crest.share.md` |
| Hero's Quest (rs-sdk bot script, protocol rev 289) — two accounts | `headless/speedrun/legs/qp/spine/run-heros-quest.ts` | `headless/speedrun/legs/qp/spine/run-heros-quest.share.md` |
| Alfred Grimhand's Barcrawl (miniquest, 0 QP) — `run-barcrawl.ts` | `headless/speedrun/legs/qp/troll/run-barcrawl.ts` | `headless/speedrun/legs/qp/troll/run-barcrawl.share.md` |
| Eadgar's Ruse (1 QP) — `run-eadgar.ts` | `headless/speedrun/legs/qp/troll/run-eadgar.ts` | `headless/speedrun/legs/qp/troll/run-eadgar.share.md` |
| The Fremennik Trials (3 QP) — `run-fremennik.ts` | `headless/speedrun/legs/qp/troll/run-fremennik.ts` | `headless/speedrun/legs/qp/troll/run-fremennik.share.md` |
| Horror from the Deep (2 QP) — `run-horror.ts` | `headless/speedrun/legs/qp/troll/run-horror.ts` | `headless/speedrun/legs/qp/troll/run-horror.share.md` |
| Troll Romance (2 QP) — `run-romance.ts` | `headless/speedrun/legs/qp/troll/run-romance.ts` | `headless/speedrun/legs/qp/troll/run-romance.share.md` |
| Throne of Miscellania (1 QP) — `run-throne.ts` | `headless/speedrun/legs/qp/troll/run-throne.ts` | `headless/speedrun/legs/qp/troll/run-throne.share.md` |
| Regicide (3 QP) — speedrun bot | `headless/speedrun/legs/qp/west/run-regicide.ts` | `headless/speedrun/legs/qp/west/run-regicide.share.md` |
| Underground Pass (5 QP) — speedrun bot | `headless/speedrun/legs/qp/west/run-underground-pass.ts` | `headless/speedrun/legs/qp/west/run-underground-pass.share.md` |
| Watch Tower (4 QP) — rev 289 quest bot | `headless/speedrun/legs/qp/west/run-watch-tower.ts` | `headless/speedrun/legs/qp/west/run-watch-tower.share.md` |
| Doric's Quest | `headless/speedrun/legs/run-doric.ts` | `headless/speedrun/legs/run-doric.share.md` |
| Druidic Ritual | `headless/speedrun/legs/run-druidic.ts` | `headless/speedrun/legs/run-druidic.share.md` |
| The Grand Tree | `headless/speedrun/legs/run-grandtree.ts` | `headless/speedrun/legs/run-grandtree.share.md` |
| Imp Catcher | `headless/speedrun/legs/run-imp.ts` | `headless/speedrun/legs/run-imp.share.md` |
| Mage Arena | `headless/speedrun/legs/run-magearena.ts` | `headless/speedrun/legs/run-magearena.share.md` |
| Dwarf Cannon | `headless/speedrun/legs/run-mcannon.ts` | `headless/speedrun/legs/run-mcannon.share.md` |
| Monkey Madness bot script | `headless/speedrun/legs/run-monkey-madness.ts` | `headless/speedrun/legs/run-monkey-madness.share.md` |
| Sea Slug (rev 289) — headless quest bot | `headless/speedrun/legs/run-seaslug.ts` | `headless/speedrun/legs/run-seaslug.share.md` |
| Jungle Potion + Shilo Village | `headless/speedrun/legs/run-shilo.ts` | `headless/speedrun/legs/run-shilo.share.md` |
| Tree Gnome Village | `headless/speedrun/legs/run-treegnome.ts` | `headless/speedrun/legs/run-treegnome.share.md` |
| Waterfall Quest (rev 289) — headless quest bot | `headless/speedrun/legs/run-waterfall.ts` | `headless/speedrun/legs/run-waterfall.share.md` |
| Witch's House (rev 289) — headless quest bot | `headless/speedrun/legs/run-witchhouse.ts` | `headless/speedrun/legs/run-witchhouse.share.md` |

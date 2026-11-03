# Druidic Ritual (rs-sdk bot script, rev 289)

A headless bot that completes **Druidic Ritual**, which unlocks Herblore. The route:
1. Falador Teleport, then talk to Kaqemeex at the Taverley stone circle.
2. Talk to Sanfew upstairs in Taverley.
3. Go down into Taverley dungeon and open the cauldron door. The door wakes two suits of armour.
4. Dip the four raw meats in the Cauldron of Thunder.
5. Climb back up, hand the meats to Sanfew, then report to Kaqemeex.

The reward is herblore xp.

Launcher: `server/webclient/headless/speedrun/legs/run-druidic.ts`. The quest code is in `q-druidic.ts`; it uses no cheats.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env` (BOT_USERNAME, PASSWORD, SERVER). Every staff command is blocked.
- `--sim [name]`: local engine only. It drops the tutorial kit, sets Magic 37 and Prayer 43, gives the meats and teleport runes, and teleports to Lumbridge. Use a new name for each run.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Quests:** none. Druidic Ritual must **not be started** yet. It is a members quest, because Taverley is members-only.
- **Magic 37:** the leg always starts with Falador Teleport.
- **Prayer 43 (recommended):** the leg switches on Protect from Melee in the dungeon when it can. The cauldron door's first two ops wake two suits of armour that attack while the door is worked. They hit up to about 2. The sim ran at Prayer 43 with 10 hitpoints; a run without the prayer is untested.

## Supplies
| item | n | why |
|---|---|---|
| raw beef | 1 | cauldron |
| raw rat meat | 1 | cauldron |
| raw bear meat | 1 | cauldron |
| raw chicken | 1 | cauldron |
| air rune | 3 | Falador Teleport |
| water rune | 1 | Falador Teleport |
| law rune | 1 | Falador Teleport |

The launcher checks the pack and Magic, then stops with a list of anything missing.

## Measured
In the lockstep sim on a clean upstream checkout (rev 289, base 2012ab67f) plus this bundle, starting from Lumbridge, the quest completed in **248 and 247 ticks** (two runs; first run shown):

| tick | step |
|---|---|
| 4 | teleport |
| 65 | Kaqemeex |
| 109 | Sanfew |
| 132 | dungeon |
| 157 | through the door |
| 163 | meats dipped |
| 186 | surface |
| 206 | Sanfew hand-in |
| 248 | reward |

## Limits
- The bot does not eat and does not fight back. The suits of armour are left behind when it walks through the door.
- Completion is detected by the herblore xp reward, because quest varps are not sent to the client.
- The first Kaqemeex talk is a blind dialog burst. If another dialog or a level-up is open when the script starts, close it first.

# Monk's Friend (rs-sdk bot script, rev 289)

A headless bot that completes **Monk's Friend** (1 QP; reward 8 law runes and 2,000 woodcutting xp, 50,000 at the
demo's x25).

Route (every step checked in the rev-289 content scripts):
1. Brother Omad (Ardougne monastery): start the quest. A hidden ladder now appears in the stone circle west of the
   monastery (2561,3222) whenever you stand within 2 tiles of it.
2. Climb down, take the child's blanket from the table in the thieves' den (behind a door), climb back up.
3. Omad: hand in the blanket, then ask about Brother Cedric.
4. Brother Cedric (north of the monastery): talk, give the jug of water, agree to help, give the logs.
5. Omad: the party (about 35 ticks of scripted dancing), then the quest completes.

Launcher: `run-monks-friend.ts`; quest code `q-monks-friend.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Clears the pack, sets Hitpoints 20, gives the supplies and teleports to the start
  inside Omad's hall (2605,3211). Use a new name for each run.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Quests:** none; Monk's Friend not started. Members world.
- **Skills:** none are checked. The thieves in the den are cowardly but one landed 3 damage on a 10-hp test account, so
  bring a little hp (the sim runs at 20).
- Start inside Omad's hall (the walled garden just north of it costs a 12-tick detour).

## Supplies
| item | n | why |
|---|---|---|
| jug of water | 1 | Brother Cedric (sobers him up) |
| logs | 1 | Brother Cedric's cart (plain logs only) |

## Measured (lockstep sim, rev 289)
**214 / 215 ticks** (fresh accounts; the second on a chaos engine with random door states, seed 1101).

| tick | step |
|---|---|
| 7 | quest started |
| 41 | in the thieves' den |
| 54 | blanket |
| 68 | back on the surface |
| 101 | blanket handed in |
| 108 | sent to find Cedric |
| 135-142 | Cedric (3 talks) |
| 214 | party over, quest complete |

## Limits
- Completion is detected by the quest-point varp (the only quest varp the client receives).
- The bot does not eat or fight back.

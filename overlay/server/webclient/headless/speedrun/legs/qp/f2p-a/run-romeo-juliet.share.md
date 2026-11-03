# Romeo & Juliet (rs-sdk bot script, rev 289)

Completes **Romeo & Juliet**: Juliet first (her L1 room; she starts the quest and hands over the message, so Romeo's start
talk is skipped) -> Varrock Teleport -> Romeo (message) -> Father Lawrence (church) -> Varrock Teleport -> the Apothecary
(two talks; the cadava berries come from the supplies) -> Juliet (potion) -> Varrock Teleport -> Romeo. Reward: 5 quest
points.

Launcher: `run-romeo-juliet.ts`; quest code `q-romeo-juliet.ts` (no cheats); helpers `fa-lib.ts` + `fa2-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]`: local engine only. Drops the tutorial kit, sets magic 25, gives the supplies (staff of air wielded),
  teleports to the street east of Juliet's house (3168,3430). `FC_TELE` picks the teleport legs (A/B switch):
  `juliet1,lawrence,juliet` (default), any subset, or `none` (walks everything).
- `--supply`: prints the supply list.

## Prerequisites
- Quests: none. Magic 25 for the Varrock Teleports (optional: with `FC_TELE=none` it walks, 265 t).

## Supplies
| item | n | why |
|---|---|---|
| cadava berries | 1 | the Apothecary's potion (tradeable; saves the trip to the bushes SE of Varrock) |
| law rune | 3 | 3 Varrock Teleports |
| fire rune | 3 | 3 Varrock Teleports |
| staff of air (wielded) | 1 | the teleports' air runes |

## Measured (lockstep sim; 400 ms demo tick)
Final code: 155 (plain), 149 (chaos 1101), 144 (chaos 3303), 156 (chaos 2202): median 152 t (~61 s).
A/B: no teleports 265 t; Lawrence + final Juliet teleports 178-183 t; all three 139-156 t.

## Limits
- Juliet's staircase can be climbed only from its east side, and her room door's open leaf walls off one tile; both are
  handled in `fa2-lib.ts`.
- Juliet and Romeo wander: a talk can need a second click (about 5 ticks).

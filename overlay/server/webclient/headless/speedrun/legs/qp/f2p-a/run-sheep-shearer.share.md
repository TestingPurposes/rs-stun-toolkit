# Sheep Shearer (rs-sdk bot script, rev 289)

Completes **Sheep Shearer** at Farmer Fred's farmhouse NW of Lumbridge: starts the quest and hands in the 20 balls of wool.
The hand-in is engine-paced (Fred takes one ball per `p_delay(1)`, `fred_the_farmer.rs2:68-78`), so ~38 of the ticks are
fixed. Reward: 1 quest point, 60 coins, crafting 150 base xp (3,750 at x25).

Launcher: `run-sheep-shearer.ts`; quest code `q-sheep-shearer.ts` (no cheats); helpers `fa-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]`: local engine only. Drops the tutorial kit, gives 20 balls of wool, teleports to Fred (3189,3273).
- `--supply`: prints the supply list.

## Prerequisites
- Quests: none. Levels: none. Start next to Farmer Fred (3189,3273).

## Supplies
| item | n |
|---|---|
| ball of wool (`ball_of_wool`) | 20 |

## Measured (lockstep sim; 400 ms demo tick = ticks x 0.4 s)
44, 44, 43, 43, 44, 43 t (chaos 101/202/303/505/606/707). Median **43.5 ticks**.

## Limits
- The driver does not re-talk while Fred's hand-in loop runs (no dialog is open during it).
- Completion is detected by quest points (+1).

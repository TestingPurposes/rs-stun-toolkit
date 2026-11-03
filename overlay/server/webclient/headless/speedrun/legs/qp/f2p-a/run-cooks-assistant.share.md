# Cook's Assistant (rs-sdk bot script, rev 289)

Completes **Cook's Assistant** in the Lumbridge castle kitchen: starts the quest and hands in the three ingredients in a
single dialog burst (the start conversation's plan ends with a re-talk, so the hand-in opens without a separate op).
Reward: 1 quest point, cooking 300 base xp (7,500 at x25).

Launcher: `run-cooks-assistant.ts`; quest code `q-cooks-assistant.ts` (no cheats); helpers `fa-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]`: local engine only. Drops the tutorial kit, gives the supplies, teleports to the kitchen (3210,3214).
- `--supply`: prints the supply list.

## Prerequisites
- Quests: none; Cook's Assistant not started (a started quest also works: the driver answers by text).
- Levels: none. Start next to the cook (3210,3214, Lumbridge castle kitchen).

## Supplies
| item | n |
|---|---|
| egg | 1 |
| bucket of milk (`bucket_milk`) | 1 |
| pot of flour (`pot_flour`) | 1 |

## Measured (lockstep sim, 400 ms demo tick = ticks x 0.4 s)
4 / 4 / 5 ticks (fa1 chaos seed 7, fa2 plain, fa3 chaos seed 4242). Median **4 ticks**.

## Limits
- Completion is detected by quest points (+1); quest varps are not sent to the client.

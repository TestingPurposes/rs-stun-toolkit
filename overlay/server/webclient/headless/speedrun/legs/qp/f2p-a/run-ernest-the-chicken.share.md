# Ernest the Chicken (4 QP) — speedrun leg

`q-ernest-the-chicken.ts` (quest code, cheat-free), `run-ernest-the-chicken.ts` (launcher), `fe-lib.ts` (lever puzzle + ride-op
helper). Rev 289 content: `quests/quest_haunted`, `areas/area_draynor/scripts/{veronica,professor_oddenstein}.rs2`.

## What it does
Starts next to Veronica south of Draynor Manor and ends at Professor Oddenstein (Draynor Manor L2) with the quest complete.
1. Veronica: start (%haunted 1).
2. Poisons the fish food (fish food + poison), pours it in the yard fountain, searches it: pressure gauge.
3. Digs the compost heap with the spade: closet key.
4. Front door (opens from the south only, teleports you in) -> closet door (key) -> rubber tube -> back out.
5. Bookcase from the east -> secret room -> ladder -> basement lever puzzle (25 acts, the fewest-tick solution from
   `probe-fe-puzzle.ts`) -> oil can -> ladder up -> lever out.
6. Stairs, spiral stairs, Oddenstein twice (talk 1 sets stage 2, talk 2 hands over the 3 parts). No item step checks the quest
   stage, so everything is collected before the first Oddenstein talk.

## Prerequisites
- Quests: none. Skills: none (no combat; a 10-hp account took up to 3 damage from the closet skeleton and basement rats).
- 3 free pack slots. A fresh `%ernestlever` (0): the levers are a perm varp, cleared by the puzzle ladder up. An account that
  left the basement by teleport mid-puzzle would carry lever bits: the leg fails loudly ("door locked") then.

## Supplies (tradeable)
| item | n | why |
|---|---|---|
| fish_food | 1 | poisoned fish food for the fountain (the ground spawn on manor L1 is skipped) |
| poison | 1 | idem (the ground spawn is skipped) |
| spade | 1 | compost heap (the ground spawn is skipped) |
| amulet_of_glory (optional) | 1 | `glory` run option: rub to Draynor Village + 39 t walk to Veronica (44 t total) |

Untradeable, made in the quest: poisoned fish food, pressure gauge, closet key, rubber tube, oil can.

## Measured (lockstep sim, fresh accounts)
- Chaos seeds 1101 / 2202 / 3303: **280 / 280 / 281 ticks, median 280** (112 s at 400 ms). Plain engine 279-285.
- With the glory approach from Lumbridge: 323 ticks (chaos 3303).
- The old kbd-swarm LeanBot runner: 1,214 ticks (chaos 909).

## Run
```
--sim fe<n>        local engine: drops the tutorial kit, gives the supplies, teleports next to Veronica
--live <account>   cheats blocked
--supply           prints the supply list
FE_GLORY=1         sim: start at Lumbridge with a glory, the leg rubs to Draynor Village first
FE_CLOSET=last     closet after the puzzle instead of before (tie, A/B only)
FE_RIDELOC=0       walk-stop-op helpers instead of ride ops (tie, A/B only)
```

## Limits
- Sim run energy never drains (engine NODE_INFINITE_RUN); live may be slower on the ~200 walked tiles.
- Ends on manor L2 with the closet key and spade in the pack (drop them) and +300 coins.

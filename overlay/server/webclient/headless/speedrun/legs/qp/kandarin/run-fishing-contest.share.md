# Fishing Contest (rs-sdk bot script, rev 289)

A headless bot that completes **Fishing Contest** (1 QP; reward 2,437 fishing xp, 60,925 at the demo's x25). Every step
is checked against the rev-289 content scripts (file:line in `q-fishing-contest.ts`).

Route:
1. The mountain dwarf at the west tunnel of White Wolf Mountain gives the competition pass.
2. Camelot Teleport, squeeze through McGrubor's Wood's loose railing (from its west side), dig a red vine worm.
3. Hemenster: Morris lets you in with the pass; stash the garlic in the pipe BEFORE paying Bonzo, so Bonzo gives you the
   Sinister Stranger's spot by the pipes at once.
4. One cast with the worm on that spot gives a giant carp; Bonzo takes the catch after the first fish and any giant carp
   wins the trophy.
5. Camelot Teleport, hand the trophy to the dwarf: quest complete.

Launcher: `run-fishing-contest.ts`; quest code `q-fishing-contest.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Clears the pack, sets Fishing 10, Magic 45, Hitpoints 20, gives the supplies and
  teleports to the Camelot teleport landing (2757,3478).
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Fishing 10** (checked when fishing; boosts count). **Magic 45** (Camelot Teleport x2).
- 3 free pack slots (pass, worm, carp/trophy).

## Supplies
| item | n | why |
|---|---|---|
| garlic | 1 | the pipe (moves the Sinister Stranger) |
| spade | 1 | red vine worm |
| fishing rod | 1 | fishing |
| coins | 5 | Bonzo's fee |
| law rune / air rune | 2 / 10 | Camelot Teleport x2 |

## Measured (lockstep sim, rev 289)
**325 / 322 ticks** (fresh accounts; the second on a chaos engine, seed 5501). Without the first teleport (walking 183
tiles from the dwarf to the railing instead of 114 from Camelot): 352.

| tick (seed 5501) | step |
|---|---|
| 48 | pass |
| 150 | red vine worm |
| 249 / 270 | inside Hemenster / entered (spot by the pipes) |
| 278 / 283 | giant carp / trophy |
| 322 | quest complete |

## Limits
- Completion is detected by the quest points varp.

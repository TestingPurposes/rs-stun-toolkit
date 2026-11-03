# Elemental Workshop (rs-sdk bot script, rev 289)

A headless bot that completes **Elemental Workshop** (1 QP; reward: 5,000 crafting and 5,000 smithing xp, i.e. 125,000
each at the demo's x25, and the elemental shield). Every step is checked against the rev-289 content scripts (file:line in
`q-elemental-workshop.ts`).

Route:
1. Seers' Village: take the battered book from the bookcase, read it, cut its spine with a knife (battered key).
2. Unlock the odd wall with the key, go down the staircase into the workshop.
3. Stone bowl from the first box; turn valve 1 then valve 2 and pull the water lever (the wheel starts).
4. Mine an elemental rock: an earth elemental (35 hp) jumps out; kill it for the elemental ore.
5. Patch the bellows (needle, leather, thread), pull the air lever.
6. Fill the bowl at the lava trough, pour it into the furnace (it lights), smelt the ore with 4 coal.
7. Make the elemental shield at the workbench: quest complete.

Launcher: `run-elemental-workshop.ts`; quest code `q-elemental-workshop.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Clears the pack, sets Crafting/Mining/Smithing 20, Attack/Strength 83, Defence 1,
  Hitpoints 72, gives the supplies and teleports to the Camelot teleport landing (2757,3478).
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Crafting 20, Mining 20, Smithing 20** (the quest's own checks; boosts count).
- Combat for one earth elemental (35 hp, ~7 damage taken at Defence 1).
- **4 free pack slots** (book, key, bowl, ore/bar/shield).

## Supplies
| item | n | why |
|---|---|---|
| knife | 1 | cut the book's spine |
| thread / needle / leather | 1 / 1 / 1 | the bellows (boxes 2 and 4 also give needle and leather once) |
| coal | 4 | smelting the elemental ore |
| hammer | 1 | workbench |
| bronze pickaxe | 1 | any pickaxe the account can use (a rune pickaxe needs Mining 41) |
| rune scimitar | 1 | the earth elemental |

## Measured (lockstep sim, rev 289)
**199 / 201 ticks** (fresh accounts; the second on a chaos engine, seed 4402). Development runs: 191, 187, 205 (chaos
4401).

| tick (seed 4402) | step |
|---|---|
| 26 / 28 | book / key |
| 53 | in the workshop |
| 82 | water wheel running |
| 132 | elemental ore |
| 156 | bellows fixed, air blowing |
| 189 | elemental bar |
| 201 | shield made, quest complete |

## Limits
- Completion is detected by the quest points varp.

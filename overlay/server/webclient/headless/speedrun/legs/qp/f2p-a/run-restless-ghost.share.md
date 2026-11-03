# The Restless Ghost (rs-sdk bot script, rev 289)

Completes **The Restless Ghost**: Father Aereck (Lumbridge church) -> Father Urhney (swamp shack, the amulet of ghostspeak)
-> Lumbridge Teleport -> opens the coffin and talks to the ghost (amulet worn) -> Wizards' Tower cellar (the skull) ->
Lumbridge Teleport -> skull into the coffin. Reward: 1 quest point, prayer 1,125 base xp (28,125 at x25 = prayer ~40).

Launcher: `run-restless-ghost.ts`; quest code `q-restless-ghost.ts` (no cheats); helpers `fa-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]`: local engine only. Drops the tutorial kit, sets magic 31, gives the supplies (staff of air wielded),
  teleports to the church (3243,3207). `FA_ONETELE=1` / `FA_NOTELE=1` are the A/B switches (one / no teleport).
- `--supply`: prints the supply list.

## Prerequisites
- Quests: none. Magic 31 for the Lumbridge Teleport (without the runes it walks: slower, see STATUS.md).
- **The amulet of ghostspeak stays WORN at the end: keep it for Nature Spirit.**

## Supplies
| item | n | why |
|---|---|---|
| law rune | 2 | 2 Lumbridge Teleports |
| earth rune | 2 | 2 Lumbridge Teleports |
| staff of air (wielded) | 1 | the teleports' air runes |

## Measured (lockstep sim; 400 ms demo tick)
Two teleports: 388 / 388 / 317 t (chaos 4242/202/303, median 388). One teleport 411-418 t; walking 521 t.

## Limits
- The skull is a global ground spawn (another player can take it first); the bot waits for its respawn.
- A level-13 skeleton spawns when the skull is taken; the bot leaves it behind.

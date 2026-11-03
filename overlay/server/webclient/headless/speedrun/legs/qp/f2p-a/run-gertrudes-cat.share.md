# Gertrude's Cat (rs-sdk bot script, rev 289, members)

Completes **Gertrude's Cat**: Gertrude (W of Varrock) starts it, her sons in the Varrock market take the 100-coin bribe,
then in the lumber yard NE of Varrock the bot gives Fluffs the milk and the seasoned sardine, searches the crates for the
kitten, gives the kitten to Fluffs and teleports back to Gertrude. Reward: 1 quest point, cooking 1,525 base xp (38,125 at
x25), a kitten follower, a chocolate cake and a stew.

Launcher: `run-gertrudes-cat.ts`; quest code `q-gertrudes-cat.ts` (no cheats); helpers `fa-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]`: local engine only. Drops the tutorial kit, sets magic 25, gives the supplies (staff of air wielded),
  teleports to Gertrude (3152,3409). `FA_NOTELE=1` walks back instead of teleporting.
- `--supply`: prints the supply list.

## Prerequisites
- Members world (the lumber-yard fence is members-only, `quest_fluffs.rs2:117`). Quests: none.
- Magic 25 for the Varrock Teleport back (optional: without the runes the bot climbs back over the fence and walks).
- Free slots: 2 for the reward food, plus the kitten.

## Supplies
| item | n | why |
|---|---|---|
| coins | 100 | the boys' bribe |
| bucket of milk | 1 | Fluffs |
| seasoned sardine | 1 | Fluffs (raw sardine + doogle leaves; tradeable, carried ready-made) |
| law rune, fire rune | 1 each | Varrock Teleport |
| staff of air (wielded) | 1 | the teleport's air runes |

## How it handles the content
- The bribe only exists in the two-boy branch: with the other boy more than 3 tiles away the dialogue ends with no choice
  (`quest_fluffs.rs2:38-47`; `fluffs_boy_single` is never reached). The bot talks only while both boys stand together.
- The kitten's crate is chosen at random among six (`:221-228`) and is not sent to the client. Each crate npc can be searched
  from one side only (the others answer "I can't reach that!"); the stands and the search order (minimum expected time,
  `probe-tour.ts`) are fixed in the code.

## Measured (lockstep sim; 400 ms demo tick)
209 / 247 / 231 t (chaos 505/606/707, median 231); the spread is the random crate (1st crate ~210 t, 6th ~300 t).

## Limits
- Leaves you with a kitten follower.
- Completion is detected by quest points (+1).

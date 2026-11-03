# Vampire Slayer (rs-sdk bot script, rev 289)

Completes **Vampire Slayer**: Morgan (Draynor) starts the quest -> Varrock Teleport -> Dr Harlow at the Jolly Boar Inn (two
talks: the second takes the beer and gives the stake) -> amulet of glory to Draynor Village -> Draynor Manor front door ->
crypt stairs -> opens the coffin and kills Count Draynor with the stake, a hammer and garlic in the pack. Reward: 3 quest
points, attack 4,825 base xp (x25).

Launcher: `run-vampire-slayer.ts`; quest code `q-vampire-slayer.ts` (no cheats); helpers `fa-lib.ts` + `fa2-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]`: local engine only. Drops the tutorial kit, sets magic 25, attack 40, strength 40, defence 20,
  hitpoints 30, gives a rune scimitar (wielded), 2 sharks and the supplies, and teleports outside Morgan's house
  (3098,3272). A/B switches: `FC_TELE` (`harlow,glory` default; `harlow,manor`; `none`), `FC_ATT`/`FC_STR`/`FC_DEF`/
  `FC_HP`, `FC_WEAPON`, `FC_FOOD`.
- `--supply`: prints the supply list.

## Prerequisites
- Quests: none. Magic 25 (one Varrock Teleport). Combat: proven at attack/strength 40 (rune scimitar), defence 20,
  hitpoints 30; it also completed at 30/30/1/20 with an adamant scimitar (slower fight, hp down to 11/20).

## Supplies
| item | n | why |
|---|---|---|
| beer | 1 | Dr Harlow wants one before he hands over the stake |
| hammer | 1 | drives the stake in (without it the Count regenerates) |
| garlic | 1 | weakens the Count on the first hit (defence -40, hp -10) |
| law rune, fire rune, air rune | 1, 1, 3 | Varrock Teleport (Morgan -> Jolly Boar) |
| amulet of glory (any charge) | 1 | Draynor Village teleport (Jolly Boar -> manor) |
| rune scimitar, 2 sharks | | sim gear (any weapon and food will do) |

## Measured (lockstep sim; 400 ms demo tick)
Final code, 4 chaos seeds: 215 (4141), 205 (5252), 220 (6363), 212 (7474): median 213.5 t (~85 s). Fight about 30 t at the proof stats; at 99s the whole quest took 191 t, at 30/30/1/20 232 t (both one plain run, before the last two fixes). A/B: no teleports 465 t; Varrock Teleport instead of the glory 290-301 t.

## Limits
- The stake is untradeable: the two Harlow talks are part of every run.
- The manor's front door opens only from outside; the bot never needs to leave the manor (it ends in the crypt).

# Merlin's Crystal (rs-sdk bot script, rev 289)

A headless bot that completes **Merlin's Crystal** (6 QP; reward: Excalibur kept, the Knight of the Round Table title,
Holy Grail unlocked). Every step is checked against the rev-289 content scripts (file:line in `q-merlins-crystal.ts`).

Route:
1. Camelot: King Arthur (start), Sir Gawain ("Do you know how Merlin got trapped?"), Sir Lancelot upstairs ("Any ideas
   on how to get into Morgan Le Faye's stronghold?").
2. Catherby: hide in Arhein's crate, ride to Keep Le Faye, climb to the top floor and beat Sir Mordred (38 hp; at 0 hp
   Morgan Le Faye appears): "Tell me how to untrap Merlin and I might."
3. Ride the keep's crate back to Catherby; the candle maker swaps a bucket of wax for a black candle (two talks); light it.
4. Falador Teleport, Lady of the Lake (Taverley): "I seek the sword Excalibur."
5. Amulet of glory to Draynor Village, Port Sarim jeweller's door: the beggar takes the bread and becomes the Lady:
   Excalibur.
6. Amulet of glory to Edgeville, run north to the chaos altar (Wilderness level 12) and read the inscription.
7. Camelot Teleport, drop the bat bones on the magic symbol holding the lit candle, bind Thrantax with "Snarthon
   Candtrick Termanto" (the option order is random; the bot answers by text).
8. Smash the crystal (east tower, top floor) with Excalibur, then King Arthur.

Launcher: `run-merlins-crystal.ts`; quest code `q-merlins-crystal.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Clears the pack, sets Attack/Strength 83, Defence 1, Hitpoints 40, Magic 45, gives
  the supplies and teleports to the Camelot teleport landing (2757,3478). Use a new name per run.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Quests:** none; Merlin's Crystal not started. Members world. Wilderness level 12 is visited once (no PvP in the sim).
- **Magic 45** (Camelot Teleport; also Falador Teleport).
- **Combat** for Sir Mordred (38 hp, max hit ~5) and the renegade knights who swing at you in the keep: proven at
  Attack/Strength 83, Defence 1, Hitpoints 40 with a rune scimitar (1 shark eaten at most).
- **3 free pack slots** (black candle, Excalibur).

## Supplies
| item | n | why |
|---|---|---|
| bread | 1 | the lake beggar |
| bucket of wax | 1 | candle maker (skips the bee-hive step) |
| bat bones | 1 | dropped on the magic symbol (not consumed) |
| tinderbox | 1 | lights the black candle |
| law rune / air rune / water rune | 2 / 8 / 1 | Falador + Camelot Teleport |
| amulet of glory (4) | 1 | Draynor + Edgeville (2 charges) |
| rune scimitar | 1 | Sir Mordred (wielded by the script) |
| shark | 3 | food |

## Measured (lockstep sim, rev 289, chaos engines with random door states)
**609 / 578 / 598 ticks** (seeds 2211 / 2212 / 2213), median **598** ticks (~4 min at 400 ms/tick).

| tick (seed 2213) | step |
|---|---|
| 22 / 34 / 61 | Arthur / Gawain / Lancelot |
| 137 | Keep Le Faye (crate) |
| 181 | Mordred down |
| 212 / 229 | Catherby / black candle lit |
| 303 | Lady of the Lake |
| 366 | Excalibur |
| 478 | chaos altar |
| 530 | Thrantax bound |
| 580 | Merlin free |
| 598 | quest complete |

## Limits
- Renegade knights in the keep swing at you; every npc swing closes an open dialog (strong queue), so the Morgan
  dialog and the crate ride are retried until their effect is seen.
- Completion is detected by the quest points varp.

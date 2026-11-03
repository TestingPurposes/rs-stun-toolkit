# Scorpion Catcher (rs-sdk bot script, rev 289)

A headless bot that completes **Scorpion Catcher** (1 QP; reward 6,625 strength xp, 165,625 at the demo's x25). Every
step is checked against the rev-289 content scripts (file:line in `q-scorpion-catcher.ts`).

Route:
1. Thormac (Sorcerer's Tower, top floor) gives the cage.
2. The Seer in Seers' Village gives the first hint (this is what unlocks the secret wall; the second hint and Peksa are
   not needed in rev 289: catching and the hand-in only check the cage).
3. Barbarian Outpost: through the gate (needs Alfred Grimhand's Barcrawl), catch scorpion B.
4. Falador Teleport, Taverley dungeon: kill the jailer for the jail key, free Velrak for the dusty key, open the
   dusty-key door, cross the inner dungeon (blue dragons, poison spiders, a lesser demon) to the secret wall, catch
   scorpion A in the room behind it. The secret wall is NOT reachable from the entrance any other way.
5. Glory to Edgeville: join the monastery (prayer 31 base), climb up, catch scorpion C.
6. Camelot Teleport, Thormac: quest complete.

Launcher: `run-scorpion-catcher.ts`; quest code `q-scorpion-catcher.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Sets Barcrawl complete, Attack/Strength 83, Defence 86, Hitpoints 72, Prayer 78,
  Magic 45, gives the supplies and teleports outside the Sorcerer's Tower.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Alfred Grimhand's Barcrawl** (the outpost gate guard).
- **Prayer 31 base** (monastery). Prayer 43+ recommended: Protect from Melee is switched on in the inner dungeon.
- **Magic 45** (Falador + Camelot Teleport).
- Combat for the jailer and the inner Taverley dungeon: proven at Attack/Strength 83, Defence 86, Hitpoints 72
  (72 -> 38 hp on the way to the secret wall). This is the route position after Holy Grail.

## Supplies
| item | n | why |
|---|---|---|
| amulet of glory (4) | 1 | Edgeville (1 charge) |
| law / air / water rune | 2 / 8 / 1 | Falador + Camelot Teleport |
| rune scimitar | 1 | the jailer |
| shark | 6 | food |

## Measured (lockstep sim, rev 289, chaos engines with random door states)
**876 / 898 / 870 ticks** (seeds 6601-6603), median **876** (~5.8 min). Development run: 859.

| tick (seed 6601) | step |
|---|---|
| 30 / 119 | cage / Seer's hint |
| 294 | scorpion B (Barbarian Outpost) |
| 592 | dusty key (jailer, Velrak) |
| 720 / 722 | secret room / scorpion A |
| 789 | scorpion C (monastery) |
| 876 | quest complete |

## Limits
- Completion is detected by the quest points varp.
- Two untradeable keys (jail key, dusty key) stay in the pack.

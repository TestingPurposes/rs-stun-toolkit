# The Dig Site (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **The Dig Site** east of Varrock (2 quest points, 2 gold bars, big mining and some
herblore xp).

What it does, in order:
1. Asks the **examiner** for an exam (letter), casts Varrock Teleport and has the **curator** in the Varrock museum stamp
   it, walks back, searches the bush for a rock sample on the way and hands the examiner the stamped letter.
2. Gives the **panning guide** a cup of tea, takes the panning tray and pans until a rock sample turns up; pickpockets
   **workmen** until it has a rock sample and a specimen brush; hands the three samples to the three students.
3. Passes **exam 1** (trowel), talks to the three students again for **exam 2**, then again (the opal for one of them) for
   **exam 3**.
4. Opens a barrel with the trowel and fills the vial (unidentified liquid); takes a specimen jar from the sacks; digs a
   level-3 site until the **talisman** appears.
5. **Archaeological expert**: talisman -> letter, liquid -> nitroglycerin; the letter to a workman = the mine-shaft permit.
6. Rope on the private winch, down: the **workman** below gives up his chest key (after a lot of "please"); up; the key
   opens the chest (powder); the expert names it (ammonium nitrate). Mixes nitroglycerin, nitrate and ground charcoal.
7. Rope on the other winch, down: picks an arcenia root (compound), pours it on the bricks, lights it from the one tile the
   script allows, runs; picks up the **stone tablet** behind the bricks, climbs out and gives it to the expert: complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Thieving 25** | Pickpocketing a workman (rock sample + specimen brush). Higher thieving = fewer 8-tick stuns. |
| **Agility 10** | The winch shafts. |
| **Herblore 10** | Two of the chemical mixes. |
| **Magic 25** (optional) | Varrock Teleport to the curator: 49 tiles instead of 193. |
| **Start** | Next to the examiner in the Exam Centre (3361,3341). |

## Supplies (`--supply`)
Cup of tea, cut opal, 2 ropes, empty vial, charcoal, pestle and mortar, tinderbox, 1 law + 3 air + 1 fire rune.

## Measured (offline lockstep sim)
Chaos engines: **1766, 1750 and 2120 ticks** (median 1766 ≈ 11.8 min at 400 ms). About 1,250 ticks are fixed; the
rest is the three random steps below. Stats: thieving 51, agility 60, herblore 46, magic 60, mining 50, fishing 74, attack/strength 83, defence
60, hitpoints 80, prayer 43.

## Known limits
- Three random steps dominate the spread: the panning sample (3 in 40 per pan), the workman's pockets (sample and brush,
  3 in 11 each per success) and the talisman (1 in 20 per dig).
- Never drop the chemicals: the script does not (they explode for 25-65 damage).

# Mage Arena (rs-sdk bot script, protocol rev 289)

A headless bot script that plays the **Mage Arena** miniquest from Ardougne to the god staff. Optionally it follows up with the **Charge** spell burst (magic 80 to 99 in about 35 ticks).

What it does, in order:
1. Walks to the Ardougne lever at (2561,3311), pulls it and answers the warning. You land at (3154,3924) in the deep Wilderness.
2. Cuts the web into the ruined keep and the two hut webs with a knife (50% per try), then climbs down the ladder into the arena cellar.
3. Talks Kolodion into the fight and teleports into the arena.
4. Fights all five of Kolodion's forms (331 hp in total) with Fire Blast. Protect from Magic stays on, a prayer potion is drunk below 15 prayer points, and a shark is eaten below 40 hp if you carry any.
5. Jumps into the sparkling pool to reach the chamber, prays at the Guthix statue and picks up the cape.
6. Talks to the chamber guardian for the **god staff** (Guthix, as scripted). The miniquest is then complete and Charge is unlocked.
7. With `--charge`: casts Charge in one burst until magic reaches 99 (180 base xp per cast, 3 blood + 3 air runes each; the staff of fire covers the fire runes).

The script finishes inside the Mage Arena chamber, around (2508,4697). That chamber is outside the Wilderness. **Getting out is up to you**, for example with a teleport.

## PvP risk: read this before going live
The lever lands you at **Wilderness level ~50**. On a server with other players you can be attacked and killed from the moment you land until you are down the cellar ladder. That takes about 60 ticks of walking and web cutting, more if the knife keeps missing.
- The script does **not** watch for player attackers. It only keeps Protect from Melee on (prayer 43+) on that walk.
- Death in the Wilderness loses your items. Carry only the supplies below, and nothing you are not willing to lose.
- The arena itself is single-player against Kolodion, and the chamber is outside the Wilderness.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Magic 60** (base) | Kolodion refuses to let you fight below 60 (`kolodion.rs2`); Fire Blast needs 59. A higher level hits more often: at 80 the fight took 67-70 casts, but one run needed more than 80. |
| **Magic 80** (only for `--charge`) | Charge needs current magic 80 or higher. |
| **Prayer 37+** (43 recommended) | 37 gives Protect from Magic, which blocks Kolodion's god spells (they hit up to 20 without it). 43 also gives Protect from Melee for the Wilderness walk. |
| **High hitpoints** | The sim ran at 80 hp. The leg eats a shark below 40 hp. |
| **Equipment** | A **staff of fire**, wielded (the script wields it from the pack). Staffs, capes, amulets, rings and knives are the only allowed gear. The arena refuses entry with any weapon or armour **worn or in the pack**, and also with arrows, bows, bow strings, logs, clue scrolls, caskets or cannon parts (`mage_arena.rs2`, `can_enter_mage_arena`). |
| **Pack** | Only the supplies below, plus **2 free slots** (the cape and the staff). |
| **Start** | Anywhere in Ardougne. The leg walks to the lever; the sim starts at the market (2655,3307). |
| **Quests** | None. |

## Supplies (`--supply` prints them)
- **Before the lever:** staff_of_fire x1, knife x1, deathrune x120, airrune x480, 4-dose prayer potion x1. Optionally a few sharks.
  - That is 120 Fire Blasts (1 death + 4 air each). The staff covers the fire runes.
  - The leg aborts, instead of standing in the arena, if it runs out of death runes.
- **`--charge` (after the staff):** bloodrune x3n and airrune x3n with the staff of fire still wielded, where n = ceil((998,458 − magic xp) / 4,500). That is 163 casts (489 + 489) from exactly magic 80. Air runes left over from the fight count. Blood runes are sold in the Magic Guild store in Yanille.

## Measured (offline lockstep sim, clean rs-sdk checkout)
This was run on a fresh account with magic 80, prayer 70 and hitpoints 80, wielding the staff of fire and carrying 5 sharks, starting at Ardougne market. Result: **quest complete in 571 ticks** (about 5.7 minutes at 600 ms per tick).

| Step | Tick |
|---|---|
| Lever landing | 62 |
| Webs cut | 129 |
| Cellar | 134 |
| Fight starts | 146 |
| Fight over (63 casts) | 522 |
| Chamber | 532 |
| Cape | 558 |
| Staff | 571 |

- No damage was taken: Protect from Magic stayed on, and 2 of the 4 potion doses were drunk.
- `--charge`: 147 casts in **30 ticks**, magic 83 to 99. The run totalled 607 ticks.
- A second clean run took **542 ticks** (58 casts); its Charge burst was 148 casts in 30 ticks.

## Known limits
- The script ignores other players. In a contested Wilderness the walk from the lever is where you die.
- Each web cut succeeds 50% of the time. A long unlucky streak (12+ misses on a web) fails the step; rerun it.
- The script does not walk out of the chamber.
- The god is always Guthix (the statue the script prays at).
- If Kolodion's dialog goes out of sync, the script retries it up to 3 times, then fails.

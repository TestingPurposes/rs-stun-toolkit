# Big Chompy Bird Hunting (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Big Chompy Bird Hunting** in the Feldip Hills (2 quest points; 7,350 ranged, 2,620
fletching and 14,700 cooking base xp).

What it does, in order:
1. Talks to **Rantz** and agrees to make "stabbers".
2. Fletches its own **15 ogre arrows** (no shop sells them): knife on each achey log (2-6 shafts), chisel on each wolf bone
   (2-6 tips), 4 feathers per shaft, tips on the headless arrows (up to 6 per action, no delays; ~15 ticks). Fletching at
   least one yourself also sets the "made the arrows yourself" flag. Helpered ogre arrows still work: with 15 or more in the
   pack it fletches just one batch for the flag.
3. Gives Rantz 6 ogre arrows and asks how to make the chompys come.
4. In Rantz's cave: lifts the rock off the ogre chest (a strength roll, retried) and takes the **bellows**.
5. At the swamp: fills the bellows at the bubbles and inflates **3 swamp toads** (the most you can hold). Protect from Melee
   keeps the swamp's wolves off.
6. Shows Rantz a toad (talking, not using it on him: only the talk advances the quest), drops the 3 toads in his clearing and
   waits for a chompy. Rantz shoots and misses; he then lends you the **ogre bow**.
7. Shoots **its own chompy** from range (walking up to it makes it flee), plucks it.
8. Shows Rantz the chompy (he names his seasoning), asks Bugs and Fycie in the cave for theirs, cooks the chompy with the
   three seasonings on the spit roast and hands it to Rantz: quest complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Ranged 30 (base)** | Wielding the ogre bow checks the unboosted level. |
| **Cooking 30** | The spit roast. A burn (about 10% at cooking 55) costs the chompy: the script baits and shoots another. |
| **Fletching 5, Crafting 5** | Fletching the ogre arrows and chiselling the wolf bone tips. |
| **Prayer 43** (recommended) | Protect from Melee against the swamp wolves (combat 64, they attack players below combat ~128). Without it the script eats. |
| **Start** | Next to Rantz (2630,2983). |

## Supplies (`--supply`)
knife, chisel, 5 achey tree logs, 5 wolf bones, 60 feathers, and 2 each of potato, onion, equa leaves, cabbage, tomato and
doogle leaves (the three ogres each want one of two seasonings at random; two of each covers a burnt chompy), 2 sharks.
That is 27 pack slots. Five logs and five bones give 10-30 shafts and tips (about 90% of the time 15 or more arrows, about
99% 11 or more; the script needs at least 11). If you have ogre arrows instead: 1 log, 1 wolf bones, 4 feathers and 15
ogre arrows.

## Measured (offline lockstep sim)
Stats: ranged 56, cooking 55, fletching 30, crafting 40, strength 60, prayer 43, hitpoints 70. Chaos engines: **292, 330 and
482 ticks** (median 330 ≈ 2.2 min at 400 ms) with helpered arrows. Self-fletched arrows:
**334 and 342 ticks** (fletching 15 arrows ≈ 15 ticks; one chompy took 5 arrows). Plain-engine runs 315-489. Most of the spread is the chompy spawn: each placed
toad rolls 1 in 5 every 25 ticks, four times.

## Known limits
- If no chompy comes from a round of toads, the script refills the bellows and baits again (up to 4 rounds).
- A burnt chompy needs a second hunt: one sim run (helpered arrows) burnt it and then found no second chompy in 4 bait
  rounds (the burn path is fragile; higher cooking makes it rarer). 15 arrows leave ~10 for a second chompy.
- The ogre bow stays in the pack afterwards (it is untradeable).

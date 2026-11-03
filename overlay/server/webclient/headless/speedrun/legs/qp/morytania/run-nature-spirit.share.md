# Nature Spirit (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Nature Spirit** (2 QP) from Drezel in the Paterdomus mausoleum, where the Priest in
Peril script ends, to the completed nature grotto in Mort Myre.

Steps: Drezel starts the quest -> through the holy barrier and the Mort Myre gate -> jump the bridge into Filliman's camp
-> washing bowl (a mirror drops), search the grotto tree (journal) -> the spirit: "How long have you been a ghost?", the
mirror, the journal, "How can I help?" (bloom spell) -> back to Drezel to be blessed -> cast the bloom spell next to a
rotting log on the way back and pick the fungus -> fungus on the nature stone, the used spell on the spirit stone, stand
on the faith stone and tell the spirit "I think I've solved the puzzle!" -> the grotto: transformation, the silver sickle
is blessed, an empty druid pouch -> bloom pear bushes with the sickle, 3 pears into the pouch -> the pouch reveals the
invisible ghasts: kill three -> back to the grotto: quest complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Priest in Peril** to stage 61 (the script for it ends there) and the Wolfbane dagger held, worn or banked | Drezel only offers the quest then (`drezel.rs2:14-18`). |
| The **amulet of ghostspeak** (The Restless Ghost), worn | Without it the spirit only moans (`filliman.rs2:4`). |
| Prayer > 0 (sim: 43) | Each blessed-sickle bloom drains 1-7 prayer and needs some left. |
| Combat (proven at attack/strength/defence/hitpoints 40, no food) | Three ghasts (45 hp). Faster with more: see below. |

## Supplies (`--supply`)
- A silver sickle (pack). Worn: a weapon and the ghostspeak amulet.

## Measured (offline lockstep sim, 400 ms ticks)
- Combat 40: 727, 747, 738 ticks on three chaos engines (random door states) -> median 738 (~4.9 min).
- Combat 83: 671 ticks; combat 99: 612 ticks (the three ghasts take ~170 t at 40, ~100 t at 83).

## Limits
- The camp island is only reachable over the "Jump" bridge, an agility roll: a slip costs 2-7 hp and a few ticks.
- The druid pouch is left with 5-6 charges, enough for In Search of the Myreque's boatman (>= 5).

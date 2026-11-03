# In Search of the Myreque (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **In Search of the Myreque** (2 QP) from Vanstrom Klause in Canifis to the end.

Steps: Vanstrom ("Perhaps I could help you out here", "Yes, I'll do it!") -> through Mort Myre to Mort'ton (the pouch is
topped up with the blessed sickle on the way if it runs low) -> Cyreg the boatman: the six steel weapons, the persuasion
chain, the druid pouch (>= 5 charges) and 3 planks -> his boat to the hollows -> repair the 3 rotten bridge rungs (plank +
10 nails + hammer each) -> Curpile's three questions -> the hideout doors and the stalagmite squeeze (agility 25) -> Veliaf
and the five others -> hand over the weapons -> cutscene -> kill the Skeleton Hellhound -> Veliaf's way out -> the false
wall and the basement ladder -> the stranger in the tavern: quest complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| Nature Spirit (the druid pouch and the blessed sickle) | Cyreg wants a pouch with >= 5 charges; the sickle refills it in the swamp. |
| Agility 25 | The stalagmite into the hideout (`routequest_myreque.rs2:125`). |
| Combat (proven at attack/strength/defence/hitpoints 70 with 6 sharks) | The Skeleton Hellhound: attack 70, defence 100, strength 110, 55 hp. 83+ is much safer. |
| Prayer > 0 | The sickle top-up drains 1-7 per bloom. |

## Supplies (`--supply`)
- Steel longsword, 2 steel swords, steel dagger, steel mace, steel warhammer (in the pack, not worn), 6 wooden planks,
  30 steel nails, a hammer, 10 coins, 6 sharks. Worn: a weapon.

## Measured (offline lockstep sim, 400 ms ticks)
- From Canifis at combat 70: 592, 596, 594, 576 ticks on chaos engines -> median ~593 (~4 min). Combat 83: 568; 99: 541.
- Started earlier (during Nature Spirit) and run from Filliman's grotto: 489 ticks.

## Limits
- The swamp crossing costs pouch charges (ghasts); the script refills from the pear bushes when it holds < 10.

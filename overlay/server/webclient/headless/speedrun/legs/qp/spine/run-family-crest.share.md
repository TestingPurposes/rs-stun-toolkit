# Family Crest (rs-sdk bot script, protocol rev 289)

Plays **Family Crest** from Dimintheis's house in Varrock and back.

Order: Dimintheis -> Camelot teleport, Caleb (5 cooked fish -> his crest piece) -> glory to Al Kharid, gem trader -> Avan
-> Falador teleport, Falador mine stairs, Boot the dwarf -> Ardougne teleport, Witchaven dungeon: lever puzzle into the
perfect-gold room, mine 2 perfect gold -> glory to Al Kharid: smelt 2 perfect gold bars, make a perfect ruby ring and
necklace -> Avan (his piece) -> Varrock teleport, Jolly Boar Inn upstairs: Johnathon, antipoison -> glory to Edgeville,
Edgeville dungeon (Wilderness): Chronozon, one hit each of wind/water/earth/fire blast, then kill -> join the 3 pieces ->
Varrock teleport, Dimintheis: quest complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| Magic 59 | fire blast (wind/water/earth blast need 41/47/53) |
| Mining 40, Smithing 40, Crafting 40 | perfect gold ore, perfect gold bar, perfect ruby necklace (ring 34) |
| Prayer 43 | Protect from Melee in the Witchaven and Edgeville dungeons |
| Plague City (+ scroll) | Ardougne teleport; otherwise walk |
| Wilderness | Chronozon's lair is in the Wilderness: bring only what you can lose |

## Supplies
`--supply` prints them: swordfish, bass, tuna, salmon, shrimp (cooked), 1 antipoison dose, 2 rubies, ring and necklace
moulds, rune pickaxe, amulet of glory (4), teleport and blast runes, 6 sharks, a prayer potion.

## Measured (offline lockstep sim, route stats)
Chaos-engine proof runs: **1144 / 1213 / 1019 ticks** (seeds 4303 / 4404 / 4505, median 1144 = 7.6 min at 400 ms).
Normal engine: 847. Variance: perfect-gold rock respawns, Chronozon's poison spiders, shut doors.

# Temple of Ikov (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Temple of Ikov** to the **Armadyl ending** (1 quest point; 10,500 ranged and 8,000
fletching base xp).

What it does, in order:
1. **Lucien** in the Ardougne inn: "I'm a mighty hero!" then "That sounds like a laugh!" gives the Pendant of Lucien.
2. **Hemenster cellar ladder** into the temple dungeon. The dark stairs need a lit candle. Below them the **Boots of
   lightness** lie behind a web: the knife slashes it (50% a try).
3. Wearing the boots and the pendant: through the **door of fear**, over the **lava bridge** (it only carries you with a
   total weight below zero) to the **lever**, and back.
4. The lever goes on its **bracket** and is pulled: the **south gate** opens to six chests. One of them (a hidden,
   per-player chest that moves after every find) holds 1-5 **ice arrows**; the script searches the nearest unsearched chest
   until it has enough.
5. The **trap lever** (thieving 42 to find the trap), pulled, opens the way to the **Fire Warrior of Lesarkus**. Only ice
   arrows fired from a bow that can take them (yew or better) hurt him. Arrows that do not break land under him and are
   picked up mid-fight. Protect from Magic makes his fire blasts harmless.
6. **Winelda** (two talks, 20 limpwurt roots) teleports you over the lava. A **Guardian of Armadyl** (talk with Lucien's
   pendant OFF) hands over the Armadyl pendant.
7. **Glory to Edgeville**, walk to Lucien's house north of Varrock, kill **Lucien** (17 hp) wearing the Armadyl pendant:
   quest complete.

Why Armadyl and not Lucien's ending: both need Winelda and the roots; Lucien's ending needs the Staff of Armadyl, which you
cannot pick up while any of the five guardians stands within 5 tiles in sight, and they attack whoever holds it.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Thieving 42** | Searching the trap lever (`ikov_dungeon.rs2:158`, boostable). |
| **Ranged 40** | Wielding the yew shortbow; ice arrows only fire from a bow with level requirement 40+ (`player_ranged.rs2:115`). |
| **Prayer 37** (recommended) | Protect from Magic against the Fire Warrior. Without it bring more food (the pack has room for 3 sharks). |
| **Weight below 10 lb** at the lava bridge | Wear no armour and carry no coins (2 g each): the boots of lightness are -10 lb. The script drops pack items that are not in the supply list. |
| **Start** | Next to Lucien in the Ardougne inn (2574,3320). |

## Supplies (`--supply`)
yew shortbow, lit candle, knife, 20 limpwurt roots (UNNOTED: Winelda counts the pack), amulet of glory (any charge), 3 sharks.

## Measured (offline lockstep sim)
Stats: thieving 42, ranged 56, prayer 43, hitpoints 70, defence 40, attack/strength 60. Chaos engines (seeded world, random
door states): **733, 785, 924 ticks** (median 785 ≈ 5.2 min at 400 ms). Plain engine: 728, 745, 763, 741, 860, 839. The spread
is the ice-arrow chest luck (138-291 ticks for 10 arrows) and the fight (107-149 ticks at ranged 56; about 70 at ranged 99).

## Known limits
- The arrow target depends on ranged: 12 below 70, 10 at 70-89, 8 at 90+ (`IKOV_ARROWS` overrides). With 8 arrows at
  ranged 56 the quiver ran dry twice; if that happens the script walks back to the chests for more.
- Dungeon monsters (skeletons, scorpions, bats, spiders) hit along the way; the script eats at half hp.
- Lucien sometimes wanders out of the inn; the script walks through the door after him.

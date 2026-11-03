# Tai Bwo Wannai Trio (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Tai Bwo Wannai Trio** on Karamja (2 quest points, 2,000 coins).

What it does, in order:
1. Climbs to **Timfraku** (L1 of his hut) and starts the quest ("Trufitus sent me", needs Jungle Potion).
2. At the village fire: cooks raw karambwan until one is **poorly cooked**, grinds it (pestle) to poisonous paste, poisons
   the iron spear (kp spear). Casts **Superheat Item** on the jogre bones (burnt jogre bones; there is no furnace).
3. Kills one **monkey** with Fire Strike (melee is dodged) for a monkey corpse.
4. **Tamayu**: watches a hunt (cutscene), hands over the agility potion and the kp spear, goes on the killing hunt, then
   skins the monkey corpse. Seaweed + monkey skin = the sandwich.
5. **Holy Lake**: small-nets 21 karambwanji (one becomes raw paste on the burnt bones, 20 are for Lubufu).
6. **Tiadeche** (over the Karamja stepping stones): intro, the loaded karambwan vessel, "No" -> he asks for a manual.
7. Glory -> Karamja: **Zambo** sells the Karamja rum; sliced banana in it.
8. **Lubufu**: becomes his apprentice (20 karambwanji, three questions) and receives a karambwan vessel.
9. Village fire: marinates the pasted burnt bones (cooking 30).
10. **Tinsay** (Cairn Isle, over the climbing rocks and the log bridge): rum, sandwich, bones, then the vessel -> manual.
11. **Tiadeche** again: the manual completes the last brother. Glory -> Karamja, Timfraku: quest complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Jungle Potion** | Timfraku only starts the quest after it (tbwt_timfraku.rs2:51). |
| **Agility 15** (60 recommended) | The Cairn Isle climbing rocks check 15. The log bridge rolls agility once per crossing and the stepping stones once per stone: at 32 the bridge drops you about half the time (~40 ticks and 9% hp per fall). |
| **Magic 43** | Superheat Item on the jogre bones; Fire Strike for the monkey. |
| **Cooking 30** | Marinating the burnt jogre bones on the fire. |
| **Fishing 5** | Karambwanji (higher catches faster: the roll is 100..250 of 256 by level). |
| **Start** | At Timfraku's ladder in Tai Bwo Wannai (2782,3086). |

## Supplies (`--supply`)
4 raw karambwan (the poorly-cooked roll burns about a third at cooking 55), pestle and mortar, iron spear, agility potion (4),
small fishing net, jogre bones, seaweed, sliced banana, karambwan vessel loaded with karambwanji, 22 fire runes, 12 air
runes, 6 mind runes, 1 nature rune, 100 coins, amulet of glory (4). No food: every source of damage on this route is a
percentage of current hitpoints (falls) or a jungle spider passing hit.

## Measured (offline lockstep sim)
Chaos engines (seeded world + random doors): **1509, 1468 and 1493 ticks** (median 1493 ≈ 10.0 min at 400 ms). Plain
engine 1483-1611 at agility 60 (a log-bridge fall costs ~40 ticks). Stats: agility 60, cooking 55, fishing 74, magic 50, hitpoints 70, attack/strength 60,
defence 40.

## Known limits
- The quest needs 27 of 28 pack slots at the lake; the script drops everything it will not use before fishing.
- Two Tiadeche trips are forced (he must ask for the manual before Tinsay writes it).

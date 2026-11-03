# Dragon Slayer (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Dragon Slayer** from the Champions' Guild door to Elvarg's death.

Order: Guildmaster (outside the guild door) -> amulet of glory to Edgeville -> Oziach (all three map-piece questions; he
gives the maze key) -> the Oracle on Ice Mountain -> Dwarven Mine trapdoor -> magic door (mind bomb, unfired bowl, lobster
pot, silk) -> chest: map piece 3 -> Falador teleport -> Melzar's maze (six fights, six coloured key doors, chest: map
piece 1) -> Port Sarim jail: buy Wormbrain's piece (10,000 gp) -> join the map -> buy the Lady Lumbridge from Klarense
(2,000 gp) -> patch the hull (3 planks, 12 nails, hammer) -> glory to Draynor: hire Ned and give him the map -> back to
the ship, Ned sails to Crandor -> Crandor dungeon -> Elvarg (antidragon shield worn, Protect from Melee) -> quest complete.

## Live prerequisites
| Requirement | Why |
|---|---|
| 32 quest points | Only the Champions' Guild door checks it (champions_guild.rs2:2); the Guildmaster stands outside it. |
| Magic 37 | One Falador teleport (mine -> maze). |
| Prayer 43 | Protect from Melee vs the lesser demon and Elvarg (3 of her 4 attacks are melee). |
| Attack 40 | Rune scimitar. Proven at attack/strength 80, defence 70, hitpoints 70. |
| Members world | The quest is F2P; the script uses an amulet of glory (members item), so it is untested on a free world. |

## Supplies (`--supply` prints them)
Rune scimitar, rune full helm, rune chainbody, rune platelegs (worn), antidragon shield, amulet of glory (4), 1 law + 3 air
+ 1 water rune, wizard's mind bomb, unfired bowl, lobster pot, silk, 12,000 coins, 3 planks, 12 steel nails, hammer,
8 sharks.

## Measured (offline lockstep sim, rev 289, route stats)
- Chaos-engine proof runs (seeded world + random door states): **1114 / 1115 / 1135 ticks** (seeds 4101 / 4202 / 4303;
  median 1115 = 7.4 min at 400 ms). Normal engine: 1118.
- Elvarg alone: rune scimitar 132-180 ticks; dragon longsword (needs Lost City) 101-141; at 99 stats 85-98.

## Known limits
- The first time an account walks into the Wilderness edge band (Oziach's hut) the game opens a warning window; the script
  closes it.
- Melzar's maze npcs respawn 60-80 ticks; another player killing yours delays the run.

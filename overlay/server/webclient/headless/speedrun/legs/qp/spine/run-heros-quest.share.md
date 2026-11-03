# Hero's Quest (rs-sdk bot script, protocol rev 289) — two accounts

Plays **Hero's Quest** for TWO accounts at once in one process: one Phoenix Gang member and one Black Arm Gang member
(each finished Shield of Arrav in a different gang). On this server Grip can only be attacked by the Phoenix member and
his keys only open the treasure door for the Black Arm member, so the quest cannot be done alone.

Phoenix: Achietties (start) -> Ice Queen (ice gloves; White Wolf Mountain ladder maze via the hero rockslide) -> Straven ->
Entrana feather -> Ardougne teleport + ship to Brimhaven -> mansion -> Varrock armband -> Gerrant/eel -> Achietties.
Black Arm: Achietties -> Katrine -> Gerrant/eel -> Brimhaven -> mansion -> armband -> Ice Queen -> Entrana -> Achietties.
In detail: gang contact in Varrock (Straven / Katrine) -> Ardougne teleport + ship to Brimhaven -> the mansion (below) -> Varrock: the
candlestick changes hands, gang leader gives the master thief armband -> glory to Draynor, Entrana: kill a firebird and
take the hot feather (ice gloves worn; no weapons/armour allowed on Entrana, so all fights use spells) -> Gerrant's
blamish slime, blamish oil, oily rod -> Taverley dungeon: Jailer -> jail key -> Velrak -> dusty key -> deep dungeon ->
lava eel -> Falador teleport, cook it -> Achietties: quest complete. The Black Arm member does the Ice Queen after the
armband (both kill the same Queen; she respawns in 100 ticks).

Brimhaven mansion (the only meeting): Phoenix: Alfonse ("gherkins") -> kitchen -> Charlie. Black Arm: Grubor's door
password "Four leaved clover" -> Trobert (ID papers) -> black armour worn -> Garv -> Grip (papers, then "Anything I can
do now?" -> misc key) -> walks out and trades the misc key to the Phoenix member outside Garv's door. Phoenix: kitchen
panel -> garden -> side door with the key -> side room. Black Arm opens Grip's drinks cabinet next to a pirate guard;
Grip walks next to the side room and the Phoenix member kills him with spells. Black Arm picks up Grip's keys, opens the
treasure room and the chest (2 candlesticks).

## Live prerequisites (each account)
| Requirement | Why |
|---|---|
| 55 QP, Lost City, Dragon Slayer, Merlin's Crystal, Shield of Arrav | quest_hero.rs2:1-7 |
| Plague City with the scroll read | Ardougne teleport (teleport.rs2:22-35) |
| Scorpion Catcher (none needed; earlier draft) | – |
| Magic 59 (fire blast; Ardougne teleport 51) | all fights are spells (Entrana bans weapons and armour) |
| Mining 50 + a pickaxe | the hero rockslide, the only way to the Ice Queen |
| Fishing 53, Cooking 53, Herblore 25 | lava eel (untradeable, each account makes its own) |
| Prayer 43 | Protect from Melee underground |
| Black Arm only: black full helm, platebody, platelegs | worn at Garv; dropped before Entrana |

## Supplies
`--supply` prints both lists (runes for 2 Varrock, 1 Ardougne, 2 Falador teleports and ~30 fire blasts, glory, fishing rod,
bait, harralander potion (unf), tinderbox, logs, 100 gp, 8 sharks, 2 prayer potions, bronze pickaxe; Black Arm + black
armour and a Camelot teleport).

## Measured (offline lockstep sim, route stats)
Chaos-engine proof runs (both accounts complete): **1803 / 1772 / 1745 ticks** (seeds 5111 / 5414 / 5515, median 1772 =
11.8 min at 400 ms). Phoenix account 1471-1726, Black Arm 1745-1803.

## Known limits
- Both accounts must run in the same process (the launcher logs in both).
- Untradeable quest items (ice gloves, eel, feather, armband, grip's keys, ID papers, dusty key) are made by each account.

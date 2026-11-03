# Watch Tower (4 QP) — rev 289 quest bot

`run-watch-tower.ts` runs `q-watch-tower.ts`: the whole quest from the foot of the Yanille watchtower to the lever, cheat-free.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff cheat throws.
- `--sim [name]`: a local engine only. Drops the tutorial kit, sets the sim stats and Lost City complete (`%zanaris 6`, only so the
  dragon longsword can be wielded), hands over the supplies, teleports to the start. Debug: `--from <segment>` starts at a
  cheat-set state; `--env WT_TO=<segment>` stops after a segment.
- `--supply`: prints the supply list and the requirements.

## Requirements (checked by the game with `stat()`, boostable)
- Agility 25 (climbing rocks 18, `quest_itwatchtower.rs2:2`; chasm jump 25, `:393`).
- Thieving 15 (rock cake counter, `area_yanille/scripts/ogre_trader.rs2:22`).
- Herblore 14 (ogre potion, `ogre_potion.rs2:57,72`). Magic 14 (the magic potion on a shaman, `ogre_shaman.rs2:23`).
- Mining 40 + a pickaxe you can use (Rock of Dalgroth, `quest_itwatchtower.rs2:483-491`).
- A melee weapon for Gorad (cl68, 80 hp). Default: dragon longsword (attack 60 + Lost City).
- Sim stats used: attack/strength 83, defence 60, hitpoints 70, magic 45, agility 75, thieving 50, herblore 28, mining 49.

## Supplies (start of the run)
rope, dragon bones, gold bar, death rune, 20 coins, lit candle, guam leaf, vial of water, ground bat bones, adamant pickaxe,
dragon longsword, 8 sharks. The second rope comes from the spawn on Toban's plateau. The one **jangerberries** the potion takes
is picked up from the ground spawns on Grew's island (2510-2517, 3080-3090) during the first island visit, next to the
swing-off tile. Carried berries are used instead.

## Route (segments)
start (wizard) -> nails (bush) -> wiz2 -> og1 (key) -> grew1 (island) -> toban (part 3, gold, Gorad's tooth, rope spawn) ->
og2 (part 1) -> grew2 (part 2 + crystal 1) -> relic (wizard) -> gate2 (relic on the guard, =4) -> cake (counter, battlement)
-> map (chasm jump, death rune on the city guard) -> back (out of the city) -> caves (5 scared skavid, 4 Cur, 3 Ar, 2 Ig +
nightshade, 1 Nod, gold-bar gate, 6 mad skavid + nightshade) -> enclave1 (nightshade, =8) -> potion (wizard, brew, =10) ->
shamans (6 x potion, Rock of Dalgroth) -> finish (wizard, lever: qp +4; reads the spell scroll).

## Measured sim ticks
See STATUS-watchtower.md (per-run list and median).

## Limits
- The Gu'Tanoth gates are walled off for the planners inside the run (q-lib addWalls); every crossing is an explicit op.
- The plateau's ogres pin you in single combat while you fight Gorad; the bot kills the pinning ogre first.

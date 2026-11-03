# Lost City (rs-sdk headless quest bot, protocol rev 289)

Runs **Lost City** from "not started" to "quest complete, Dramen staff worn, back out of Zanaris" on one account:
the Warrior (Lumbridge swamp) -> chop the leprechaun tree for Shamus -> knife (Lumbridge ground spawn) -> bank everything but the kit at Draynor -> monk boat to Entrana -> cave monk -> Entranan zombies for an axe -> the Dramen tree: the Tree spirit fight (unarmed) -> branch -> carve the staff -> magic door (deep wilderness) -> walk home -> wield the staff and enter Zanaris through the Lumbridge-swamp shed (that entry completes the quest) -> back out.


## Live prerequisites
- Quests: none.
- **Woodcutting 36**: the Dramen tree refuses lower.
- **Crafting 31**: carving the branch into a staff.
- **Melee for an UNARMED fight with the Tree spirit** (level 101; Entrana bans every weapon and armour piece, axes included). The driver computes P(win) from your Attack/Strength/Defence/Hitpoints and shark count and refuses below 97%. Examples: 60/60/60/60 with 20 sharks = 99.8%; 50s need ~26 sharks (98%); Str/Def 45 is not enough even with a full pack.
- **Any axe** you can use at your Woodcutting level, in the pack or worn (to summon Shamus). The axe is banked before Entrana; on the island the script takes a bronze axe from the zombies.
- The pack is **banked at Draynor** before the boat (everything except knife and sharks). The bank is otherwise untouched.
- Start anywhere on the mainland.

## Supplies
- Any axe (`bronze_axe` x1 is enough).
- Sharks: at least 14, and enough for P(win) >= 97% (20 at level ~60 melee).
- A knife is optional (the script picks up the Lumbridge spawn at (3224,3202)).

## Run
```
cd server/webclient
bun headless/quests-share/run-lost-city.ts --live <account>          # reads bots/<account>/bot.env
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-lost-city.ts --sim [name]
```
`--live` blocks every staff command. `--sim` refuses a non-local `LC_HOST`; on a fresh account it drops the tutorial kit, sets Woodcutting 36, Crafting 31 and Attack/Strength/Defence/Hitpoints 60, and gives a bronze axe and 20 sharks. Nothing else is cheated.

## Measured (clean checkout, lockstep sim)
- **1,376 ticks**, fresh account (WC 36, Crafting 31, melee 60, 20 sharks, bronze axe) from Lumbridge to quest complete with the staff worn and back out of Zanaris.
- Food: the Tree spirit fight used 8 sharks; the other 12 went between the tree and the magic door (greater demons) and the deep-wilderness walk home. Bring the full 20.

## Limits
- The walk home from the magic door crosses the deep wilderness with only the staff in the pack (a death there costs nothing but the staff, and the driver strips to the staves first). Greater demons spawn one tile from the tree pocket's only exit.
- A reasoned refusal (levels, food, no axe) stops at once with the reason; it does not retry.
- Timeout 120 minutes per attempt, 3 attempts.

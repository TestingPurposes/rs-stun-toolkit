# Troll Stronghold (rs-sdk headless quest bot, protocol rev 289)

Runs **Troll Stronghold** from "Death Plateau complete" to "quest complete, law talisman in the pack" on one account:
Denulth (start) -> buy climbing boots from Tenzing (12 gp; Death Plateau leaves you none) -> the Death Plateau rocks and the troll climbing rocks -> the arena: beat the Troll Champion ("Dad", level 101) -> the troll pass -> the stronghold door -> a Troll General (level 113) for the prison key -> the prison -> pickpocket Twig for Godric's cell key -> free Godric -> back out over the rocks -> Dunstan: **law talisman** (the only law talisman source; Dunstan re-issues one later whenever the account holds none, bank included).


## Live prerequisites
- **Death Plateau complete** (Denulth offers Troll Stronghold only after it). See the Death Plateau bundle.
- **Agility 15**: the troll climbing rocks.
- **Thieving 30**: pickpocket Twig for Godric's cell key (lower: the script kills him for it instead).
- **Prayer 43**: Protect from Melee. The Troll General hits up to 38; the driver keeps protection on in all three fights. Arrive with full prayer (live: the General drained ~60 points).
- **Strong melee**: live, 99 Attack/Strength/Defence/Hitpoints won both fights **unarmed** under protection; Strength/Defence 75 with fists lost to Dad. A wielded weapon shortens the fights. Do not wield a ranged weapon without ammo.
- Start anywhere on the mainland south of the plateau (the script walks to Denulth in Burthorpe).

## Supplies
- Coins: 12+ (climbing boots from Tenzing).
- Sharks: ~20 (live: 8 went on the rock throwers between the pass and the stronghold door).
- Optional: a melee weapon, worn.

## Run
```
cd server/webclient
bun headless/quests-share/run-troll-stronghold.ts --live <account>          # reads bots/<account>/bot.env
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-troll-stronghold.ts --sim [name]
```
`--live` blocks every staff command. `--sim` refuses a non-local `LC_HOST`; on a fresh account it drops the tutorial kit, sets Death Plateau complete (`death_equiproom` 80, `death_map` 8), sets Attack/Strength/Defence/Hitpoints 90, Prayer 70, Agility 30 and Thieving 40, gives (and wields) a rune scimitar, gives 100 coins and 20 sharks, and teleports to Denulth.

## Measured (clean checkout, lockstep sim)
- **1,423 ticks**, fresh account (Attack/Strength/Defence/Hitpoints 90, Prayer 70, Agility 30, Thieving 40, rune scimitar, 20 sharks) from Denulth to quest complete with the law talisman in the pack. 10 sharks eaten; Dad and the Troll General both fought under Protect from Melee (the General took prayer from 62 to ~30).
- One earlier run of the same build wedged on the climb landing at (2880,3596): the Death Plateau trolls next to the rocks (ids 1097-1112) attack anyone standing there (a probe at Defence 99 lost 43 hp in 80 ticks) and the bot never stepped off the tile; all 3 attempts failed and the next run passed. Treat a failed run as retryable: the driver resumes from wherever the account stands.
- Two quest-troll.ts fixes came out of the clean-checkout runs: Tenzing's hut counts as "inside" from (2822,3555) (the door teleports you onto that tile; the old `x <= 2821` test teleported the bot back out), and the Death Plateau climb counts as landed only on z >= 3596 (a landing read at 3595 started a loop that never awaited a tick and froze the process).

## Limits
- The fights are real: below the levels above the driver flees (out of food, out of prayer) and the run stops with the reason.
- Timeout 45 minutes per attempt, 3 attempts.

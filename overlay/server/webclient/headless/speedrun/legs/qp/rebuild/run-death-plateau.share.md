# Death Plateau (lane rebuild, rev 289, cheat-free)

lane-style speedrun leg.

## What it does
Denulth (start) -> Saba in the hermit cave -> Tenzing (knock, climbing boots) -> games necklace to Burthorpe -> Eohric
(castle L1) -> Dunstan -> Harold (pub L1, knock) -> Denulth (certificate) -> Eohric -> Dunstan (iron bar -> spiked boots)
-> Harold: Asgarnian ale, then a Blurberry Special (he is "very drunk": every dice roll is a win), one 101 gp bet empties
his 100 gp purse -> IOU -> read it (combination) -> five stone balls onto the mechanism (door unlocked) -> Tenzing (10
bread, 10 trout, spiked boots -> secret way map) -> back door, stile, the trail north into the scout zone -> games
necklace -> Denulth -> complete (+1 QP, steel claws, attack xp).
Content: `quests/quest_death/scripts/*.rs2` (file:line in `q-death-plateau.ts`).

## Prerequisites
- Quests: none. Skills: none (no stat check in quest_death; no combat).
- Start and end: next to Denulth (2897,3529) L0, Burthorpe.

## Supplies (`--supply`)
`bread 10, trout 10, iron_bar 1, asgarnian_ale 1, blurberry_special 1 (premade_blurberry_special also works),
coins 101, necklace_of_minigames_8 1` (2 charges used). Leaves `steel_claws`, 201 coins and the necklace (6 charges).
Pack: 25 slots at the start, peak 27 (climbing boots + certificate). Keep 3 slots free.

## Run
```
bun legs/qp/rebuild/run-death-plateau.ts --live <account>
LC_HOST=localhost:<port> bun legs/qp/rebuild/run-death-plateau.ts --sim [name]
bun legs/qp/rebuild/run-death-plateau.ts --supply
```
A/B switches: `RB_DP_NECK1=walk` (walk Tenzing -> Burthorpe), `RB_DP_ORDER=old` (Dunstan before Eohric after the
necklace), `RB_DP_PLANS=0` (no dialog token plans). Resume: `run(bot, { from: <phase 1-11> })`; the sim launcher's
`RB_DP_FROM=5|7|8|9` sets that phase's varps (probing only, never in a proof run).

## Completion state
`%death_equiproom` = complete (80) and the map bits of `%death_map` = 8 (scouted) via the quest's own completion
(`quest_death.rs2:213-222`): what Troll Stronghold and Eadgar's Ruse read (Tenzing's door, Denulth).

## Measured (lockstep sim, engine 4, fresh accounts)
- 586 / 590 / 589 t on chaos seeds 4441 / 4442 / 4443 (rb76-rb78). Median 589 t. Also 589 t plain (rb62).
- A/B: walking Tenzing -> Burthorpe instead of the necklace 656 t; no dialog token plans 604 t.

## Limits
- The quest gives away Tenzing's climbing boots; Troll Stronghold / Eadgar's Ruse need a pair: buy from Tenzing for
  12 gp after completion (`death_sherpa.rs2:1-25`) or supply `death_climbingboots` (tradeable).
- Without the Blurberry Special the dice are 44 % per roll and bets must exceed Harold's growing purse.
- Every walk assumes infinite run energy (sim).

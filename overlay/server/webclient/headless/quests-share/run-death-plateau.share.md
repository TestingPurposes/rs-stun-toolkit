# Death Plateau (rs-sdk headless quest bot, protocol rev 289)

Runs **Death Plateau** from "not started" to complete on one account, in two phases:
1. **Supplies** (`quest-supplies.ts`, `driveDpSupplies`), skipped when the pack already holds them: Gerrant (Port Sarim) fly-fishing rod + feathers -> fly-fish trout at the Seers' river -> 10 bread at the Ardougne baker -> cook 10 trout on the Burthorpe camp fire.
2. **The quest** (`quest-death.ts`, `driveDeathPlateau`): Denulth -> Saba (hermit cave) -> Tenzing -> Dunstan -> Denulth (certificate) -> Dunstan (iron bar -> spiked boots) -> Tenzing (10 bread + 10 trout -> secret way map) -> scout the secret path; Eohric -> Harold -> Eohric -> an Asgarnian ale -> dice with Harold until he loses his purse and writes an IOU -> read it (the combination) -> five stone balls onto the mechanism -> Denulth with the map and the combination = complete.


## Live prerequisites
- Quests: none. Skills: none for the quest itself.
- Phase 1 only: **Fishing 20** (fly fishing trout) and **Cooking 15** (trout; burnt ones are dropped and re-fished; Cooking 99 never burns).
- **An iron bar** in the pack (Dunstan makes the spiked boots from it). No script gathers it: no shop stocks iron bars on this server.
- **Coins ~3,500** for the dice: the driver plays bold bets toward Harold's IOU (bet his purse + 1, up to 1,000 gp per roll; fund at least 3,200), plus 2 gp for the ale. Phase 1 needs ~400 gp more (rod, feathers, bread).
- Free slots: the pack must fit 10 bread + 10 trout + the iron bar + coins + up to 5 quest items at once. Keep it otherwise empty.
- Start anywhere on the mainland.

## Supplies
- `iron_bar` x1, `coins` x3,500 (+400 if phase 1 runs).
- `bread` x10 and `trout` x10 (cooked), or let phase 1 gather them.

## Run
```
cd server/webclient
bun headless/quests-share/run-death-plateau.ts --live <account>          # reads bots/<account>/bot.env; knowledge -> bots/<account>/death-plateau.json
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-death-plateau.ts --sim [name] [--gather]
```
`--live` blocks every staff command; `DP_SKIP_SUPPLIES=1` skips phase 1. `--sim` refuses a non-local `LC_HOST`; on a fresh account it drops the tutorial kit, gives an iron bar and 5,000 coins and teleports to Denulth. Without `--gather` it also gives the 10 bread and 10 trout (phase 1 skipped); with `--gather` it sets Fishing 40 and Cooking 40 and phase 1 gathers them cheat-free.

## Measured (clean checkout, lockstep sim)
- **3,866 ticks** with `--gather` (phase 1: 2,038 ticks for rod + feathers, 10 trout fished and cooked, 10 bread; phase 2: 1,828 ticks), fresh account from Burthorpe.
- **2,392 ticks** for phase 2 alone with the bread and trout handed over (earlier build of the same zip). Harold's dice took 3 rolls of 1,000 gp (1 loss, 2 wins).
- An earlier `--gather` run with a level-3 account died to the wolves on White Wolf Mountain on the way to the Seers' river and lost its coins (hence the combat note above).

## Limits
- The dice are luck: P(win) per roll is 44%. With 3,500 gp the IOU comes within the bankroll almost always; the driver stops with "cannot fund" otherwise.
- The drivers pace themselves with 600 ms waits (one live tick). In a lockstep sim the launcher holds each tick ~150 ms (`SR_SETTLE_MS`), so sim tick counts run somewhat higher than live.
- Timeouts: phase 1 90 minutes, phase 2 60 minutes per attempt, 3 attempts each.

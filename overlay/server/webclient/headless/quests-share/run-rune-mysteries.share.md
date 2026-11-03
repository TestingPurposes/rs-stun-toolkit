# Rune Mysteries (rs-sdk headless quest bot, protocol rev 289)

Runs **Rune Mysteries** from "not started" to complete on one account:
Duke Horacio (Lumbridge castle, first floor) -> Sedridor (Wizards' Tower basement) -> Aubury (Varrock) -> Aubury -> Sedridor.
Gives access to the Runecrafting essence mine (Aubury / Sedridor teleport).

- `quest-runner.ts` step list `rune_mysteries` (QuestRunnerBot: multi-level travel, NPC approach, dialog choices, item-based verification);
- `rc-rm-recover.ts` (re-fetches a research package / notes that were banked or lost);
- `rm-driver.ts` (leaves instanced interiors, avoids the Al Kharid toll gate, threads the Wizards' Tower door and trapdoor, climbs straight out of the basement).


## Live prerequisites
- Quests: none. Skills: none. Items: none.
- 2 free backpack slots (talisman, package and notes pass through the pack one at a time).
- Start anywhere on the mainland. An account inside an instanced interior (essence mine) walks out by the nearest portal first.

## Supplies
None.

## Run
```
cd server/webclient
bun headless/quests-share/run-rune-mysteries.ts --live <account>          # reads bots/<account>/bot.env
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-rune-mysteries.ts --sim [name]   # local engine
```
`--live` blocks every staff command. `--sim` refuses a non-local `LC_HOST`; on a fresh account it only drops the tutorial kit (the quest has no prerequisites to cheat).
Resume mid-quest with `RM_START=<step 0-4>` if the journal is yellow and an early item is already used up.

## Measured (clean checkout, lockstep sim)
- **2,930 ticks**, fresh level-3 account from Lumbridge to quest complete, back on the surface outside the Wizards' Tower (, upstream `2012ab67f` + this zip, lockstep engine, `SR_SETTLE_MS` 150). An earlier run of the same driver took 2,304 ticks; the spread comes from wedges at Lumbridge castle doors and Sedridor's room door that the walker works through with re-plans and sidesteps.
- In one run the level-3 account died in Aubury's shop; the runner now walks back to the step's NPC after a respawn (quest-runner.ts).

## Limits
- The driver paces itself with 600 ms waits (one live tick). In a lockstep sim the launcher holds each tick ~150 ms (`SR_SETTLE_MS`), so sim tick counts run somewhat higher than live.
- Timeout 30 minutes per attempt, 3 attempts (each resumes from where the account stands).

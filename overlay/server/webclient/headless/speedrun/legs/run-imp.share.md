# Imp Catcher (rs-sdk bot script, rev 289)

A headless bot that completes **Imp Catcher**. It runs to the Wizards' Tower, climbs to the top floor and hands Wizard Mizgog the four beads in a single dialog burst. The reward is magic xp and the amulet of accuracy.

Launcher: `server/webclient/headless/speedrun/legs/run-imp.ts`. The quest code is in `q-imp.ts`; it uses no cheats.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env` (BOT_USERNAME, PASSWORD, SERVER). Every staff command is blocked. Set `LC_HOST` if your server is not the default.
- `--sim [name]`: local engine only (it refuses a non-local `LC_HOST`). It drops the tutorial kit, gives the four beads with staff cheats and teleports to Lumbridge. Accounts persist, so use a new name for each run.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Quests:** none. Imp Catcher must **not be started** yet, because the dialog plan assumes the first conversation.
- **Levels:** none.
- **Start:** anywhere on the mainland that routes to the Wizards' Tower. The script was built from Lumbridge.
- **Pack:** the four beads. While walking, the leg **drops the tutorial-kit items**: bronze axe, pickaxe, dagger and sword, wooden shield, shortbow, bronze arrows, mind/earth/body runes, net, bucket, pot, bread, shrimp and tinderbox. Bank them first if you want to keep them.

## Supplies
| item | n |
|---|---|
| red bead | 1 |
| yellow bead | 1 |
| black bead | 1 |
| white bead | 1 |

The launcher checks the pack before starting and stops with a list of anything missing.

## Measured
In the lockstep sim on a clean upstream checkout (rev 289, base 2012ab67f) plus this bundle, the quest completed in **108 ticks** from Lumbridge (two runs, both 108): the top floor at 101, Mizgog's first page at 104, the reward at 108.

## Limits
- The bot has no combat or eating logic. The route to the tower is safe.
- Completion is detected by the magic xp reward, because quest varps are not sent to the client.
- If another dialog or a level-up is open when the script starts, close it first.

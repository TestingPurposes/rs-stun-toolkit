# Doric's Quest (rs-sdk bot script, rev 289)

A headless bot that completes **Doric's Quest**. If it starts far away, it casts Falador Teleport. It then runs to Doric's house north of Falador, opening his front door if someone shut it, and finishes the quest in two talks fired as one dialog burst. An adaptive fallback takes over if Doric walks off mid-chain. The reward is mining xp.

Launcher: `server/webclient/headless/speedrun/legs/run-doric.ts`. The quest code is in `q-doric.ts`; it uses no cheats.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env` (BOT_USERNAME, PASSWORD, SERVER). Every staff command is blocked.
- `--sim [name]`: local engine only. It drops the tutorial kit, sets Magic 37, gives the materials and teleport runes, and teleports to Lumbridge, so the run includes the teleport. Use a new name for each run.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Quests:** none. Doric's Quest must **not be started** yet.
- **Magic 37:** only if you start more than 120 tiles from Doric, because the leg then casts Falador Teleport (level 37). If you start nearer, it walks and needs no magic or runes.
- **Other levels:** none.

## Supplies
| item | n | why |
|---|---|---|
| clay | 6 | quest |
| copper ore | 4 | quest |
| iron ore | 2 | quest |
| air rune | 3 | Falador Teleport (only when starting far away) |
| water rune | 1 | Falador Teleport |
| law rune | 1 | Falador Teleport |

The launcher checks the pack (and Magic, when it will teleport) and stops with a list of anything missing. The reward adds no items.

## Measured
In the lockstep sim on a clean upstream checkout (rev 289, base 2012ab67f) plus this bundle, starting from Lumbridge, the quest completed in **56 and 58 ticks** (two runs): teleport at 4, Doric's first page at 53-55, the reward 3 ticks later.

## Limits
- Completion is detected by the mining xp reward, because quest varps are not sent to the client.
- On a busy server, other players toggle Doric's door. The leg opens it when it is shut and Doric is inside.
- The bot has no combat or eating logic. The route is safe.

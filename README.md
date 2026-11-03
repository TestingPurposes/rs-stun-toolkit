# rs-sdk-stun-toolkit

Tools for writing and testing bots on [rs-sdk](https://github.com/MaxBittker/rs-sdk) (protocol revision 289): a
browserless headless client, an offline brain simulator, a lockstep simulator engine with chaos switches, a navigation
grid with a multi-level route planner, and 69 cheat-free quest scripts that run against all of it.

It is an add-on, not a fork: one command copies it into a clean rs-sdk checkout at the base commit
`2012ab67f` (2012ab67f612524d8bcca97f6b085a539ba10e78).

## Quick start

From the folder that holds this toolkit (`rs-sdk-stun-toolkit/`):

```sh
git clone -c core.autocrlf=input https://github.com/MaxBittker/rs-sdk && git -C rs-sdk checkout 2012ab67f
bun rs-sdk-stun-toolkit/install.ts rs-sdk           # or: sh rs-sdk-stun-toolkit/install.sh rs-sdk / .\rs-sdk-stun-toolkit\install.ps1 rs-sdk
cd rs-sdk && bun tools/lockstep/sim-engine.ts        # terminal 1: local lockstep engine, wait for "World ready"
cd rs-sdk/server/webclient && bun headless/sim/run-tests.ts         # terminal 2: offline brain-sim + navgrid tests
bun ../../tools/lockstep/run-sim.ts headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts   # a quest in the sim
```

Needs [bun](https://bun.sh) (tested with 1.3.9 and 1.4.3) and git. The installer runs `bun install` in the checkout,
`server/webclient` and `server/engine`. The first engine start builds the game cache, which takes a minute or two;
a few tests read that cache, so start the engine before the tests. `core.autocrlf=input` matters on Windows: with
CRLF line endings the engine's cache build fails.

## What is in it

| part | what | entry points |
|---|---|---|
| leanclient | a headless rev-289 client in plain TypeScript (no browser, a few MB per bot) and `LeanBot`, the bot base class with walking, doors, banking, dialogs and shops | `server/webclient/headless/leanclient.ts`, `leanbot.ts` |
| brain sim | runs real bot brains offline against a model of the server (movement, collision, doors, banking, skills, shops, trades); `coop.ts` puts several bots in one world | `bun headless/sim/run-tests.ts`, [docs/BRAIN-SIM.md](docs/BRAIN-SIM.md) |
| lockstep sim | the real engine as a simulator: no wall clock, seeded randomness, and chaos switches for doors, socket drops, network jitter and competing players | `tools/lockstep/sim-engine.ts`, `run-sim.ts`, `quest-batch.ts` |
| navgrid | a route grid built from the rev-289 world map, with portals, transports, teleports and door tables, plus a multi-level planner | `sdk/navgrid/`, `sdk/pathfinding.ts` |
| quests | 69 quest launchers, each with `--sim` (local engine, setup cheats), `--live <account>` (cheats blocked) and `--supply` modes | `server/webclient/headless/speedrun/legs/**/run-*.ts` |

Read [GUIDE.md](GUIDE.md) for how the parts fit together, the workflows, and the pitfalls we hit.
[docs/QUESTS.md](docs/QUESTS.md) lists every quest script.
[docs/SIM.md](docs/SIM.md) shows how to use the lockstep sim step by step (start an engine, run a quest, run a
seeded batch with chaos on, read the logs, stop the engines), and `examples/` has runnable scripts for each, including
a minimal custom bot.
[docs/BRAIN-SIM.md](docs/BRAIN-SIM.md) explains the offline brain simulator (one bot with `SimHarness`, several with
`CoopWorld`/`CoopHarness`, including trades and banking), and
[examples/brain-sim-door.ts](examples/brain-sim-door.ts) runs two real bot brains through a door with no engine at all.

## Not all quest scripts are perfected yet

Most quests complete on their own in the sim, but not every script is finished. Some can stop part way or need a
manual nudge on a live server, for example after a death, a disconnect or an unusual starting state. Legends' Quest
is the roughest: part C was fixed just before this export, and part B can still stop in a rare case during its
mid-quest bank trip (1 of 4 seeded sim runs). Each quest's `run-<quest>.share.md` lists the known limits. This
toolkit is a one-time snapshot and will not be updated, so treat the quest scripts as a starting point, not as
finished bots.

## Install details

`bun install.ts <rs-sdk checkout> [--dry-run] [--no-bun-install] [--force]`

- `overlay/` mirrors the rs-sdk tree. New files are copied in as they are.
- Some upstream files are changed: `sdk/pathfinding.ts`, the rsmod pathfinder glue (a wasm trap guard), two webclient
  I/O files, and the engine files the simulator hooks into. These are listed in `MANIFEST.json` as `"kind": "patched"`. Each one is replaced whole only while the
  checkout's copy is still the pristine base version. Otherwise the installer applies `patches/<file>.diff` with
  `git apply`, and if that fails it stops for that file with an error and leaves the file untouched.
- If the checkout is not at `2012ab67f`, the installer says so and lists what upstream changed in the files it patches.
- It is safe to re-run: files that already match are skipped. Any non-pristine file it overwrites is backed up first to
  `<checkout>/.stun-toolkit/backup-<time>/`.
- The engine changes do nothing unless you turn them on: every simulator switch is an environment variable
  (`SIM_LOCKSTEP`, `SIM_SEED`, ...), and `LOCAL_STAFF_LEVEL` only works when no login server is configured.

## Using the quest scripts on a live server

`--live <account>` reads `bots/<account>/bot.env` (`BOT_USERNAME`, `PASSWORD`, `SERVER`), the same file rs-sdk's own
bots use. Every staff command throws in this mode. Keep your credentials in `bot.env` only. Each quest's
`run-<quest>.share.md` lists its requirements and supplies. Run `--supply` to print what to carry.

## Licence

MIT (see [LICENSE](LICENSE)). rs-sdk itself is MIT-licensed as well. [NOTICE](NOTICE) lists the files derived from
upstream and their copyright.

## Refreshing

This repository is generated. Every file comes from an export script that copies the current state of the authors'
working trees, strips anything private, and checks the result with a leak gate. Hand edits here are overwritten by the
next export. `MANIFEST.json` lists every file with its sha256, its component, and the source commit it came from.

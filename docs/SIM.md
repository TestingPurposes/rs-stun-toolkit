# The lockstep sim

The lockstep sim is the real rev-289 game engine from rs-sdk with an extra mode. Nothing in it waits for the wall
clock: a game tick runs as soon as every connected bot has answered the previous one. Bots and engine advance in
lockstep, so a quest that takes 30 minutes of real game time finishes in a minute or two. It runs entirely offline on
your machine, and with a seed the world's random rolls are the same on every run, so a failure can be replayed.

It is not a model of the server (that is the brain sim, `headless/sim/`): it is the server's own content and rules,
so quest scripts, dialogs, doors and drops behave as they do on a real world.

All commands below start from the folder that holds both `rs-sdk/` and `rs-sdk-stun-toolkit/`.

## Install

```sh
git clone -c core.autocrlf=input https://github.com/MaxBittker/rs-sdk && git -C rs-sdk checkout 2012ab67f
bun rs-sdk-stun-toolkit/install.ts rs-sdk
```

The installer adds the lockstep engine files and `rs-sdk/tools/lockstep/` (`sim-engine.ts`, `run-sim.ts`,
`quest-batch.ts`). Every tool prints its options with `--help`.

## Start an engine

```sh
cd rs-sdk && bun tools/lockstep/sim-engine.ts            # instance 0, web port 8892; wait for "World ready"
```

The first start builds the game cache (a few minutes). Up to 10 engines can run side by side: `--instance N` uses
web port `8892 + 20*N` (instance 1 = 8912, ..., instance 9 = 9072). A bot connects with `LC_HOST=localhost:<web port>`.

| `sim-engine.ts` flag | environment it sets | effect |
|---|---|---|
| (always) | `SIM_LOCKSTEP=1`, `LOCAL_STAFF_LEVEL=4`, `BUILD_VERIFY=false` | lockstep ticks; staff rights so the `--sim` setup cheats work |
| `--seed S` | `SIM_SEED=S` | seeded world randomness, reseeded every tick: same seed, same rolls |
| `--det` | `SIM_DET=1`, `SIM_ACK_MS=5000`, `SIM_LOGIN_MS=5000` | reproducible mode: no tick runs on a timeout, logins land on the same tick (use with `--seed`) |
| `--fast` | `SIM_FAST=1` | engine speed-ups that compute the same world |
| `--chaos` | `SIM_DOORS`, `SIM_DOORS_FLIP`, `SIM_DROP*`, `SIM_DROP_ONE*`, `SIM_NET_LATE`, `SIM_COMPETE` | every realism switch: doors left open or shut and toggled, a server restart, single connection drops, late input, other players taking rocks and trees |
| `--crowd` | `SIM_CROWD*` | a large player crowd at the Ardougne market (costs engine CPU) |
| `--realtime` | (no `SIM_LOCKSTEP`) | a normal engine that ticks every `NODE_TICKRATE` ms (default 400) |

Any `SIM_*` variable already set in your environment wins over these presets, so a single switch can be tuned, e.g.
`SIM_NET_LATE=0.1:3 bun tools/lockstep/sim-engine.ts --chaos`. `SIM_ACK_MS` (default 200) is how long the engine
waits for a silent bot before it runs the tick anyway. The full switch list is in `GUIDE.md` ("Lockstep sim").

Tick length on the bot side: lockstep runs do not use the wall clock at all. Code that converts ticks to seconds
(`bots/tick.ts`) uses `TICK_MS` if set, else `logs/tick.json` (`{"ms": 400}`), else 400 ms. Set `TICK_MS` only when
you run against a `--realtime` engine with a different `NODE_TICKRATE`.

## Run one quest

In a second terminal, while the engine runs:

```sh
cd rs-sdk/server/webclient
bun ../../tools/lockstep/run-sim.ts headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts             # instance 0
bun ../../tools/lockstep/run-sim.ts headless/speedrun/legs/run-imp.ts --instance 1                   # another engine
```

`run-sim.ts` sets `SIM_LOCKSTEP=1` and `LC_HOST` for the instance and runs the launcher in `--sim` mode with a fresh
account (`run<5 digits>t`; pick one with `--name`). In `--sim` mode a launcher uses local setup cheats (stats, items,
a teleport to the start) and then plays the quest without cheats. The last lines tell you how it went:

```
[restless-ghost] QUEST COMPLETE in 330 ticks (The Restless Ghost, quest points 0 -> 1)
```

The exit code is 0 when the quest completed. `docs/QUESTS.md` lists every launcher.

## Run a seeded batch with chaos on

```sh
cd rs-sdk
bun tools/lockstep/quest-batch.ts server/webclient/headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts \
    --runs 4 --instances 2 --seed 100 --chaos --det
```

`quest-batch.ts` starts its own engines (instances 0..K-1, or from `--first F`), gives lane i a fresh engine with
seed `S+i`, runs one lane per engine at a time and stops the engines at the end (`--keep` leaves them running). It
prints a line per lane as it finishes and then a table:

```
lane         seed   result  ticks   wall
runabc00t      100  PASS      315  41s
runabc01t      101  PASS      325  44s

2/2 passed; ticks min 315, median 325, max 325
```

To replay a failing lane, run the batch again with `--runs 1 --seed <that lane's seed>` and the same flags.

## Read the logs

| what | where |
|---|---|
| one lane of a batch (the launcher's whole output) | `rs-sdk/logs/sim/<lane>.log` |
| a batch engine | `rs-sdk/logs/sim/engine<N>.log` |
| `run-sim.ts` | printed to the terminal |
| an engine started by hand | its terminal; the example scripts write `rs-sdk/logs/sim/example-engine<N>.log` |

In a launcher log, look at the last lines first (`QUEST COMPLETE`, or the step that failed and why), then search
for `[watchdog]`, `wedge` and `FAIL`. In an engine log the chaos switches announce what they did (a door flip, a
socket drop, a restart window), so a failure can be lined up with the tick it happened on.

## Stop the engines

An engine started by hand stops with Ctrl+C in its terminal. `quest-batch.ts` stops its own engines when it ends
(also on Ctrl+C). To find and stop strays (Linux/macOS):

```sh
pgrep -fa "src/app.ts"                         # every running engine
pkill -f "tools/lockstep/sim-engine.ts"        # engines started with sim-engine.ts
pkill -f "bun run src/app.ts"                  # all engines, including batch engines left with --keep
```

## Example scripts

`examples/` in the toolkit has three runnable scripts (POSIX sh; on Windows run them from Git Bash or WSL). Each
starts and stops what it needs. `RS_SDK` (default: `rs-sdk` next to the toolkit) and `INSTANCE` (default 0) pick the
checkout and the engine.

| script | what it does |
|---|---|
| `sh rs-sdk-stun-toolkit/examples/sim-one-quest.sh [launcher]` | starts one engine, runs one quest (default: The Restless Ghost), stops the engine. `SEED=7` makes the run seeded and deterministic |
| `sh rs-sdk-stun-toolkit/examples/sim-seeded-batch.sh [launcher]` | a seeded batch with every chaos switch on (`RUNS`, `ENGINES`, `FIRST`, `SEED`) |
| `sh rs-sdk-stun-toolkit/examples/sim-walk-and-bank.sh` | starts one engine and runs `walk-and-bank.ts`, a minimal custom bot: log in, walk from Lumbridge to Draynor Village bank, deposit, check the bank |

`walk-and-bank.ts` is the place to start for your own bot: it shows the login, the local setup cheats, a navgrid
walk and the bank calls, in about 30 lines.

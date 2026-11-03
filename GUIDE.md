# rs-sdk-stun-toolkit guide

This guide covers what each part does, how the parts fit together, the workflows we use, and the mistakes that cost us
the most time. Paths are relative to an rs-sdk checkout with the toolkit installed (see README.md). Run every command
from that checkout unless the command does a `cd` first.

## The parts and how they fit

```
                 sdk/navgrid  (route grid + multi-level planner, used by everything below)
                      |
 leanclient.ts -> LeanBot (leanbot.ts) -> SpeedBot (speedrun/core.ts) -> quest launchers (run-<quest>.ts)
      |                 |                                                        |
      |        brain sim (headless/sim): the same brains,          lockstep sim: the real engine with no wall
      |        offline, against a model of the server              clock, seeded, with chaos switches
      |                 |                                                        |
      +-----------------+-------------- live server (--live <account>) ----------+
```

1. **leanclient** speaks the rev-289 protocol: login, ISAAC, the player and npc info decoders, inventories, stats,
   interfaces, zone/loc updates. It has no renderer and no browser, so a bot costs a few MB.
2. **LeanBot** adds the actions a bot needs on top of the client: walking with the navgrid, doors, banking, dialogs,
   shops, trading, combat helpers and a progress watchdog. **SpeedBot** (`speedrun/core.ts`) is the quest-oriented
   layer: tick-accurate waits, a cheat channel for local setup, and the quest helpers in `speedrun/legs/q-lib.ts`.
3. The **brain sim** runs the same brain code against `SimWorld`/`CoopWorld`, a model of the server built from the
   engine's own rules. It covers movement, collision, the 25-waypoint cap, banking, shops, trades and skilling. No
   engine is needed, and a test takes milliseconds to seconds.
4. The **lockstep sim** is the real rev-289 engine with an extra mode. It runs a tick as soon as every bot has
   answered the previous one, so a 20-minute quest takes about a minute. Seeds make runs repeatable, and chaos
   switches add live-server conditions. Quest scripts are proven here before they go live.
5. **Live**: the same launcher with `--live <account>` reads `bots/<account>/bot.env`. Every staff command throws in
   this mode.

Rule of thumb: logic bugs go to the brain sim, sequencing and content bugs go to the lockstep sim, and only a script
that passes there runs live.

## leanclient

| file | what |
|---|---|
| `server/webclient/headless/leanclient.ts` | the headless client (`LeanClient`) |
| `server/webclient/headless/leanbot.ts` | `LeanBot`: the bot base class most scripts extend |
| `server/webclient/headless/door-table.ts`, `blocked-tiles.ts`, `loc-scene.ts` | door and collision tables used while walking |
| `server/webclient/src/io/ClientStream.ts`, `Packet.ts` | upstream files with small fixes (see `patches/`) |

- Smoke test against a server: `cd server/webclient && LC_HOST=localhost:8892 bun headless/leanclient.ts <user> <pass>`.
  It logs in and prints the player's position every tick.
- `LC_HOST` picks the server. The default is the public demo. Use `LC_HOST=localhost:<port>` for a local engine.
  Plain `ws://` is used for localhost; `LC_SECURE=1` forces TLS.
- It must live under `server/webclient/` so the `#/` import alias resolves to the webclient's own protocol modules.

## Brain sim

| file | what |
|---|---|
| `headless/sim/world.ts` | `SimWorld`: movement and collision rules ported from the engine |
| `headless/sim/protocol.ts` | encodes the server packets bit-exactly for the real decoders, and parses what the bot sends |
| `headless/sim/harness.ts` | `SimHarness`: drives one bot one tick at a time |
| `headless/sim/coop.ts` | `CoopWorld` and `CoopHarness`: several bots, banks, shops, trades, death, latency |
| `headless/sim/skills.ts`, `combat.ts` | skilling and combat maths |
| `headless/sim/run-tests.ts` | the test runner |
| `headless/sim/README.md`, `ARCHITECTURE.md` | how to write a test, and what the sim can and cannot show |

```sh
cd server/webclient
bun headless/sim/run-tests.ts                    # everything, sharded
bun headless/sim/run-tests.ts --filter=coop      # files whose path matches
bun headless/sim/run-tests.ts --solo             # one file per process (slow; best when a file crashes Bun)
```

Use `run-tests.ts`, not a plain `bun test headless/sim`: with many test files, Bun 1.3.x can crash with
`panic: Internal assertion failure` when started from `server/webclient`. The runner shards the files and runs them
from the sim folder. It reports files that never ran as `PANIC` instead of counting them as passed. If that happens,
re-run those files with `--solo`.

Writing a test: build a world (`new SimWorld(x, z, openField())`, or real collision via `rsmodCanTravel()`), add npcs
or locs, create the real bot class, wrap it in `SimHarness`, then assert on the actions it sends per tick. `README.md`
in the sim folder has a worked example. If a brain sends X and then reads the effect of X, add a test with
`latency: 2` on `CoopHarness`. An instant bank hides "decided before the answer landed" bugs.

## Lockstep sim

| file | what |
|---|---|
| `server/engine/src/engine/World.ts` (patched) | lockstep tick loop (`SIM_LOCKSTEP`), seeded reseed per tick, `SIM_DET`, `SIM_FAST` hooks |
| `server/engine/src/sim*.ts` | the switches: `simseed` (seeds), `simdoors` (doors), `simdrop` (socket drops), `simnet` (jitter), `simcrowd` (crowd, competing players), `simfast`/`simprof` (speed, profiling) |
| `server/engine/src/server/login/LoginThread.ts` (patched) | `LOCAL_STAFF_LEVEL`: staff rights on a local engine (needed by `--sim` setup cheats; ignored with a login server) |
| `server/engine/src/web/index.ts` (patched) | `/simtick` and `/simsave` endpoints, sim engines only |
| `tools/lockstep/sim-engine.ts` | starts one engine with the right environment |
| `tools/lockstep/run-sim.ts` | runs one quest launcher against it |
| `tools/lockstep/quest-batch.ts` | N runs on up to 10 engines, with seeds and chaos, and a results table |

```sh
bun tools/lockstep/sim-engine.ts                          # instance 0: LC_HOST=localhost:8892 (wait for "World ready")
bun tools/lockstep/sim-engine.ts --instance 1 --seed 7 --chaos   # instance 1: web 8912, seeded, all chaos on
cd server/webclient && bun ../../tools/lockstep/run-sim.ts headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts
bun tools/lockstep/quest-batch.ts server/webclient/headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts --runs 6 --instances 3 --seed 100 --chaos
```

How lockstep works: the engine has no wall clock. A tick runs as soon as every connected client has sent something
after the previous tick went out, or after `SIM_ACK_MS` (200 ms). The bot side has to cooperate. With
`SIM_LOCKSTEP=1` (set by run-sim and quest-batch), each bot holds the packets it writes during a tick and sends them
together with its tick ack. Without that, an action sent before the ack ends the tick early, and the bot runs one tick
behind the server. The engine then drops its actions while the player is busy. With this in place, tick counts match
a live server closely. Our reference legs came in 0 to 2 ticks per step off their live runs.

Engine switches (environment variables, all off by default; `sim-engine.ts --chaos` sets the first five):

| switch | models |
|---|---|
| `SIM_DOORS=random:<seed>`, `SIM_DOORS_FLIP=<N>:<frac>` | doors and gates in random states, toggled every N ticks like players do |
| `SIM_DROP=random:<n>[:<seed>]`, `SIM_DROP_DOWN`, `SIM_DROP_WINDOW` | a server restart: every socket closes and logins are refused for a while |
| `SIM_DROP_ONE=random:<n>[:<seed>]` | one bot's connection dies |
| `SIM_NET_LATE=<p>:<max>` | network jitter: a bot's input arrives 1 to max ticks late, in order |
| `SIM_COMPETE=<frac>:<every>` | other players deplete rocks and trees near the bot |
| `SIM_CROWD=<x>,<z>,<r>,<n>` (+ `SIM_CROWD_WANDER`, `SIM_CROWD_TRADE`) | a crowd of player entities that count against the 250-player view cap |
| `SIM_SEED=<n>` | seeded world randomness, reseeded every tick from (seed, ticks since the anchor login) |
| `SIM_DET=1` | reproducible-seed mode: no tick before the first client, and no tick on a deadline |
| `SIM_FAST=1` | engine speed-ups that compute the same world |

The switches target accounts by name. The defaults match names that start with `run` (and end with `t` for the seed
anchor), which is why run-sim and quest-batch name their accounts `run...t`.

Practice that paid off:
- Proof batches run with every chaos switch on at once. Testing one disturbance at a time hides how they interact,
  for example a socket drop plus a shut door plus a late click.
- Run one lane per engine. Lanes that share a world compete for the same npcs, rocks and doors.
- Use a fresh account per lane. A reused name logs into a half-finished character.
- Compare tick spreads rather than single runs. Seeded runs are close, but they are not tick-identical unless
  `SIM_DET=1` is set.
- Each engine needs about one CPU core and 0.8 GB of RAM. Do not run more engines than you have cores.

## Navgrid

| file | what |
|---|---|
| `sdk/navgrid/navgrid.bin` | per-tile surface class and wall clearance for every level and mapsquare, built from the rev-289 world map |
| `sdk/navgrid/index.ts` | `planRoute`, `toVias`, `clearanceAt`: single-level planning |
| `sdk/navgrid/levels.ts` | `planMultiLevel`: routes across floors, the underground, ladders, stairs, portals and teleports |
| `sdk/navgrid/portals.json`, `transports.json`, `manual-portals.json`, `area-portals.json`, `generic-ladders.json` | the portal and transport graph |
| `sdk/navgrid/door-states.json`, `scripted-door-ids.json`, `quest-gated-doors.json`, `unopenable-doors.json`, `diagonal-doors.json` | door tables |
| `sdk/navgrid/door-tracker.ts`, `live-leaves.ts` | live door state from the zone stream |
| `sdk/pathfinding.ts` (patched), `sdk/collision-store.ts`, `sdk/collision-data.bin` | tile-level pathing on the real collision |

Rebuilding (from the checkout root; the engine's cache must be built once, which happens on the first engine start):

```sh
bun sdk/navgrid/build.ts                      # navgrid.bin from server/engine/data/pack/mapview/worldmap.jag
node sdk/navgrid/extract-portals.mjs          # ladders and stairs -> portals.json (reads server/content scripts)
node sdk/navgrid/extract-door-states.mjs      # door open/closed pairs -> door-states.json
node sdk/navgrid/extract-scripted-doors.mjs   # which "Open" locs really open -> scripted-door-ids.json
node sdk/navgrid/extract-diagonal-doors.mjs   # diagonal doors -> diagonal-doors.json
bun sdk/navgrid/extract-generic-ladders.ts    # player-relative ladders -> generic-ladders.json
bun sdk/navgrid/extract-area-portals.ts       # area transitions -> area-portals.json
bun sdk/navgrid/extract-upper-floor.ts        # upper-plane floor map -> upper-floor.json
bun sdk/navgrid/extract-obj-tables.ts         # item tables for transport requirements -> obj-tables.json
bun sdk/navgrid/validate-portals.ts           # offline checks of the portal graph against the real collision
bun sdk/navgrid/render.ts <x> <z> <x2> <z2> route.html   # draw a planned route on the world map
```

Navgrid tests: `cd server/webclient && bun headless/sim/run-tests.ts --filter=nav`. Use `--filter=door`,
`--filter=portal`, `--filter=levels` or `--filter=teleport` for the rest of the geometry tests.

## Quest scripts

69 quests, listed in [docs/QUESTS.md](docs/QUESTS.md). Each has a launcher `run-<quest>.ts` and a
`run-<quest>.share.md` (or `SHARE.md`) next to it with what the quest does, its prerequisites and supplies, measured
sim ticks, and known limits.

Every launcher has the same three modes:

- `--sim [name]`: local engine only. It refuses a non-local `LC_HOST`. It drops the tutorial kit, then uses staff
  cheats to set prerequisite quests, stats and supplies and to teleport to the start, and then runs the quest code.
  This is the only place cheats are used.
- `--live <account>`: reads `bots/<account>/bot.env` and sets `CHEATS.blocked` before anything else, so any staff
  command throws. The quest code itself never cheats. It gates every step on things the client can see: items,
  position, dialog text, game messages.
- `--supply`: prints the items to carry and the requirements, then exits.

Exit code 0 means the quest completed. The last line reports the tick count.

## Workflows

**Write a quest script, sim first, then live.**
1. Read the quest's scripts in `server/content/scripts/` to see the stages, items and where each npc stands. Quest
   varps are not sent to the client, so plan which observable signal proves each step.
2. Copy the shape of a small launcher, for example `qp/f2p-a/run-restless-ghost.ts` with `q-restless-ghost.ts` and
   `fa-lib.ts`. Export `QUEST`, `REQUIREMENTS` and `SUPPLY`, and put no cheats in the quest file.
3. Start an engine (`bun tools/lockstep/sim-engine.ts`) and iterate with `run-sim.ts` until it passes.
4. Prove it: `quest-batch.ts ... --runs 6 --seed 1 --chaos`. Fix every failure class, not just the one run.
5. Run `--supply` on the live account, gather the items, then run `--live <account>` once and watch it.

**Test a brain offline.** Write a test next to the others in `headless/sim/`. Use `SimHarness` for one bot or
`CoopHarness` for several, and assert on the actions the bot sends. Run it with
`bun headless/sim/run-tests.ts --filter=<name>`. Reproduce every live bug as a failing sim test first.

**Run a deterministic lockstep batch with chaos on.**
`bun tools/lockstep/quest-batch.ts <launcher> --runs 8 --instances 4 --seed 100 --chaos --det`. Lane i runs on a
fresh engine with `SIM_SEED=100+i`. To replay a failing lane, run the same command with `--runs 1 --seed <its seed>`.
For an A/B test of a code change, run both versions with the same seeds and compare the medians and failure counts.

**Rebuild the navgrid** after a cache or map change: see the commands under Navgrid. Then re-run
`bun headless/sim/run-tests.ts --filter=nav`.

## Pitfalls and practices

Protocol and engine facts the code relies on. Each of these cost us at least one failed run:
- **The server never re-plans a path.** It walks the waypoints you send, one step at a time, and a blocked step stops
  the walk for good. Send short legal legs and re-send when the player stops.
- **A MOVE packet holds at most 25 waypoints, and the engine keeps the last 25 of a longer list.** Send a 50-tile
  route in one packet and the player heads straight for a far tile and gets stuck. The bots send at most 24.
- **The first waypoint of every move is the player's own tile**, so the first tick after a move click makes no step.
- **A move cancels a pending loc or npc op.** Do not send a walk after a door click in the same tick or the next few.
- **Loc ops fire only on a tick with no step; npc ops fire before and after movement.** For npcs, send the op and let
  the engine walk to it.
- **Read moving npc positions from `routeX[0]`/`routeZ[0]`, never from `x >> 7`.** The fine coordinates freeze where
  the npc entered view.
- **Encode client packets in the order their bytes are pushed.** The ISAAC cipher advances once per packet, and
  out-of-order encoding desyncs the stream silently.
- **Quest varps are not transmitted.** A varp the server never sends reads 0 in the client. Gate on items, position,
  dialog text and messages.
- **Never op1 a door that is already open.** On many doors it closes the door again. Track door state from the zone
  stream (`door-tracker.ts`). An opened door can swing onto the next tile, and the static collision assumes it is
  closed.
- **"I can't reach that!" almost always means a closed door or gate, or a target behind a wall.**
- **The rev-289 level-up dialog blocks movement until it is closed.**
- **Players do not block players.** Only npcs and the map block.
- **Account names are at most 12 characters.** Longer names are refused with response 3.
- **A second login with the same account kicks the first session.**
- **Stock rs-sdk never gives staff rights on a local engine.** That is what `LOCAL_STAFF_LEVEL` is for, and it is why
  `--sim` setups are refused on an unpatched engine.

Practices:
- An action is not done until you see its effect. Re-send only when the effect is missing, never blindly.
- Make every step re-entrant. After a drop the script retries from where the character is now, so each step must work
  out where it stands.
- Never wait on every bot of a pool. One stuck bot must not freeze the rest.
- Prefer atomic packets, such as fixed bank buttons, over multi-step dialogs when packets can arrive bunched.
  Withdraw-X requests sent in one tick can be merged by the server.
- Fail fast: run new logic for about 10 seconds, then 30 to 60, and only then a full run.
- Keep credentials in `bots/<account>/bot.env` and nowhere else.

## Verification

The toolkit is regenerated from the authors' trees and verified on a fresh `git clone` of rs-sdk at `2012ab67f`
using only the README quick-start commands. `MANIFEST.json` records the source commits. The results of the last
verification are in [docs/VERIFICATION.md](docs/VERIFICATION.md).

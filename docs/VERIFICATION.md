# Verification

Last run: WSL Ubuntu 24.04 (Linux x86_64), bun 1.4.3. The toolkit was cloned from its own git repository, and rs-sdk
was a fresh `git clone` from GitHub into an empty folder (no copied `node_modules`). The game cache was built once
before the tests (the same build the first engine start does); everything else ran as written in the README and in
`docs/SIM.md`. Engines ran one at a time on lockstep instance 4 (`--instance 4`, or `INSTANCE=4` / `FIRST=4` for
the example scripts).

## Quick start on the base commit (2012ab67f)

```
$ git clone -c core.autocrlf=input https://github.com/MaxBittker/rs-sdk && git -C rs-sdk checkout 2012ab67f
  -> ok
$ bun rs-sdk-stun-toolkit/install.ts rs-sdk
  upstream base OK: 2012ab67f
  files: 419 added, 16 upstream files patched (16 whole-file, 0 git apply), 0 replaced, 0 already up to date, 0 failed
$ cd rs-sdk/server/webclient && bun headless/sim/run-tests.ts
  [gate] PASS — 978 pass / 0 fail across 50/50 files
$ sh rs-sdk-stun-toolkit/examples/sim-one-quest.sh          # starts an engine, runs The Restless Ghost, stops it
  [restless-ghost] QUEST COMPLETE in 330 ticks (The Restless Ghost, quest points 0 -> 1)
```

## Further checks in the same checkout

| check | result |
|---|---|
| navgrid tests `run-tests.ts --filter=nav / door / portal / levels / teleport / travel / collision` | 50 + 24 + 3 + 5 + 24 + 35 + 3 tests, all pass (`nav-travel.test.ts`: gliders, spirit trees, carts, ships, levers, Zanaris) |
| every quest launcher loads: `bun <launcher> --supply` for all 71 `run-*.ts` launchers | 71 ok, 0 failed |
| leanclient: `import()` of `headless/leanclient.ts` and `headless/leanbot.ts` | loads; `LeanClient` and `LeanBot` exported |
| leanclient: `tsc --noEmit` on `headless/leanclient.ts` + `headless/leanbot.ts` and their imports (webclient tsconfig + bun types) | 0 errors |
| brain-sim example: `bun ../../../rs-sdk-stun-toolkit/examples/brain-sim-door.ts` (no engine) | PASS: the door opened on tick 11, the walker arrived on tick 15, the watcher saw it |
| installer run a second time | 435 already up to date, nothing written |

## Lockstep sim: examples and quests

These runs are from the previous export (same lockstep engine and tools); the final export changed quest scripts
(mostly Legends' Quest, Family Crest, Prince Ali Rescue and Regicide) and was checked with the load test above. Each line ran exactly as shown (from the folder that holds `rs-sdk/` and `rs-sdk-stun-toolkit/`, or from
`rs-sdk/server/webclient` for `run-sim.ts`), against a freshly started engine.

| command | result |
|---|---|
| `sh rs-sdk-stun-toolkit/examples/sim-one-quest.sh` | The Restless Ghost COMPLETE in 330 ticks |
| `sh rs-sdk-stun-toolkit/examples/sim-walk-and-bank.sh` | PASS in 88 ticks (Lumbridge to Draynor Village bank, 100 coins deposited) |
| `RUNS=2 ENGINES=1 sh rs-sdk-stun-toolkit/examples/sim-seeded-batch.sh` (seed 100, every chaos switch, `--det`) | 2/2 passed: seed 100 318 ticks, seed 101 328 ticks |
| `run-sim.ts headless/quests-share/run-rune-mysteries.ts` | Rune Mysteries COMPLETE in 915 ticks |
| `run-sim.ts headless/speedrun/legs/run-imp.ts` | Imp Catcher COMPLETE in 104 ticks |
| `run-sim.ts headless/speedrun/legs/qp/ardougne/run-fight-arena.ts` | Fight Arena COMPLETE in 631 ticks |
| `run-sim.ts headless/speedrun/legs/run-shilo.ts` | Jungle Potion + Shilo Village COMPLETE in 3317 ticks |
| `run-sim.ts headless/speedrun/legs/qp/south/run-tai-bwo-wannai-trio.ts` | Tai Bwo Wannai Trio COMPLETE in 1562 ticks |

Every other launcher passed the load check above; its own `run-<quest>.share.md` gives the sim timings it was proven
with.

## Upstream main (db0cc51e0, 33 commits after the base)

Measured on an earlier export with the same patched files. The installer warns and lists the 6 patched files that
upstream also changed. 14 of 15 patched files went in (9 whole-file, 5 by `git apply`).
`server/engine/src/engine/World.ts` did not apply, so the installer left it untouched and exited 1. Without that file
the engine has no lockstep mode: `sim-engine.ts` then starts a normal real-time engine (400 ms ticks), and the quest
scripts still work against it, only slower. The brain-sim tests do not use the engine and passed. Restless Ghost
completed in 332 ticks in real time. To get the lockstep engine on a newer upstream, port the hunks of
`patches/server/engine/src/engine/World.ts.diff` by hand, or use the base commit.

## Tests left out of the toolkit

These test files also fail in the authors' own tree, for reasons that have nothing to do with the toolkit, so they
are not shipped:
- `fidelity.test.ts`: one hill-giants route expectation fails with the original files as well.
- `item-values.test.ts`: the generator's output no longer matches the checked-in table (a stale table).
- `route-feasibility.test.ts`: builds a file path that only works on Windows.
- `nav-phase1..3.test.ts`: cover newer navgrid planner features (reach checks, v3 door cuts). The planner version
  that ships, the one the quest scripts were proven with, does not have these yet.

Tests of bots and tools that are not part of the toolkit are left out as well.

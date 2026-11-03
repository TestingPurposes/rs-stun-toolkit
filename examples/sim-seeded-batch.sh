#!/bin/sh
# sim-seeded-batch.sh: run one quest several times on fresh seeded engines with every realism switch on, then print
# the results table (lane, seed, PASS/FAIL, ticks). quest-batch.ts starts and stops its own engines.
#
#   sh rs-sdk-stun-toolkit/examples/sim-seeded-batch.sh [launcher, relative to rs-sdk/server/webclient]
#
# Env: RS_SDK (checkout), RUNS (default 2), ENGINES (engines side by side, default 2), FIRST (first engine instance,
# default 0: engines FIRST..FIRST+ENGINES-1), SEED (default 100: lane i runs with seed SEED+i, so a failing lane can be
# replayed with the same seed). Per-lane logs: rs-sdk/logs/sim/<lane>.log, engine logs: rs-sdk/logs/sim/engine<N>.log.
set -eu
. "$(cd "$(dirname "$0")" && pwd)/lib-engine.sh"
QUEST=${1:-headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts}

cd "$RS_SDK"
bun tools/lockstep/quest-batch.ts "server/webclient/$QUEST" --runs "${RUNS:-2}" --instances "${ENGINES:-2}" \
    --first "${FIRST:-0}" --seed "${SEED:-100}" --chaos --det

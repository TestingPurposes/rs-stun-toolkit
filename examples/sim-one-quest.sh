#!/bin/sh
# sim-one-quest.sh: start one lockstep engine, run one quest launcher through it, stop the engine.
#
#   sh rs-sdk-stun-toolkit/examples/sim-one-quest.sh [launcher, relative to rs-sdk/server/webclient]
#
# Default launcher: The Restless Ghost. Env: RS_SDK (checkout, default ../rs-sdk next to the toolkit), INSTANCE
# (engine 0..9, default 0), SEED (optional: seeded world randomness, same seed = same rolls).
# Exit code: 0 when the launcher reports the quest complete.
set -eu
. "$(cd "$(dirname "$0")" && pwd)/lib-engine.sh"
QUEST=${1:-headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts}

if [ -n "${SEED:-}" ]; then start_engine --seed "$SEED" --det; else start_engine; fi
cd "$RS_SDK/server/webclient"
bun ../../tools/lockstep/run-sim.ts "$QUEST" --instance "$INSTANCE"

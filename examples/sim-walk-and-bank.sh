#!/bin/sh
# sim-walk-and-bank.sh: start one lockstep engine and run walk-and-bank.ts, a tiny custom bot, against it.
#
#   sh rs-sdk-stun-toolkit/examples/sim-walk-and-bank.sh
#
# Env: RS_SDK (checkout, default ../rs-sdk next to the toolkit), INSTANCE (engine 0..9, default 0).
# The bot needs SIM_LOCKSTEP=1 (it acks every tick, so the engine waits for it) and LC_HOST=localhost:<web port>.
set -eu
. "$(cd "$(dirname "$0")" && pwd)/lib-engine.sh"

start_engine
cd "$RS_SDK/server/webclient"
SIM_LOCKSTEP=1 LC_HOST=localhost:$WEB_PORT TELEMETRY=false bun "$HERE/walk-and-bank.ts"

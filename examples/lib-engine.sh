# lib-engine.sh: shared helpers for the example scripts (sourced, not run).
#   RS_SDK    the rs-sdk checkout the toolkit was installed into (default: rs-sdk next to the toolkit folder)
#   INSTANCE  lockstep engine instance 0..9 (default 0): web port 8892 + 20*INSTANCE
HERE=$(cd "$(dirname "$0")" && pwd)
RS_SDK=$(cd "${RS_SDK:-$HERE/../../rs-sdk}" && pwd)
INSTANCE=${INSTANCE:-0}
WEB_PORT=$((8892 + 20 * INSTANCE))
mkdir -p "$RS_SDK/logs/sim"
ENGINE_LOG=$RS_SDK/logs/sim/example-engine$INSTANCE.log

# start_engine [sim-engine.ts flags...]: start one lockstep engine in the background, wait for "World ready".
# The engine stops again when the calling script exits (trap below).
start_engine() {
    (cd "$RS_SDK" && exec bun tools/lockstep/sim-engine.ts --instance "$INSTANCE" "$@") > "$ENGINE_LOG" 2>&1 &
    ENGINE_PID=$!
    trap 'kill $ENGINE_PID 2>/dev/null; wait $ENGINE_PID 2>/dev/null' EXIT
    echo "engine $INSTANCE starting on port $WEB_PORT (log: $ENGINE_LOG); the first start builds the cache"
    n=0
    until grep -q "World ready" "$ENGINE_LOG"; do
        if ! kill -0 "$ENGINE_PID" 2>/dev/null; then echo "engine exited:"; tail -n 20 "$ENGINE_LOG"; exit 1; fi
        n=$((n + 1)); if [ "$n" -gt 900 ]; then echo "engine not ready after 15 min"; exit 1; fi
        sleep 1
    done
    echo "engine $INSTANCE ready"
}

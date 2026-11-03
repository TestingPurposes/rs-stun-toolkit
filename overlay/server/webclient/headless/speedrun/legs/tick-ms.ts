// The live realm's tick length in ms, for wall-clock math.
// RUN_TICK_MS env wins (sims / tests pin their own engine tick), else logs/tick.json {"ms": N} (the one tick knob;
// RUN_TICK_FILE overrides the path), else 400. Read per call; tick-COUNTED logic never needs this.
import { readFileSync } from 'fs';
const FILE = process.env.RUN_TICK_FILE ?? import.meta.dir + '/../../../../../logs/tick.json';
export function tickMs(): number {
    const env = Number(process.env.RUN_TICK_MS);
    if (Number.isFinite(env) && env >= 50 && env <= 5000) return env;
    try { const ms = Number(JSON.parse(readFileSync(FILE, 'utf8')).ms); if (Number.isFinite(ms) && ms >= 50 && ms <= 5000) return ms; } catch { }
    return 400;
}

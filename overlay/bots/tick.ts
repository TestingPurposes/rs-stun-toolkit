// tick.ts — THE one source for the demo realm's tick length.
//
// The number lives in logs/tick.json of the tree this module runs from (live tree; logs/ is runtime state, deploy never
// writes it), read at CALL time (1 s cache), so a tick change is ONE edit of that file: no redeploy, no restart.
//   {"ms": 400, "since": "tick change", "why": "..."}
// Order: env TICK_MS (an explicit pin: local engines / sims that model a specific tick) > logs/tick.json "ms" > 400.
// TICK_FILE overrides the path (tests / another tree). Valid range 10..5000 ms (10, not 50, so a 40 ms local test engine
// can be pinned); anything else falls through to the next source. The speedrun reader (speedrun/legs/tick-ms.ts) reads the
// SAME file and key ("ms"); keep them agreeing.
//
// WHAT NEEDS IT: only WALL-CLOCK math — seconds/hours shown for a tick count, per-hour rates from per-tick rates, and
// wall-clock budgets that were sized as "N ticks". Tick-COUNTED logic (tickCount deltas, *_TICKS constants) never does.
//
// ⛔ Call the functions every time — never capture one in a module-scope const (that is the bug this file replaces).
// ⛔ Dependency-free on purpose (node:fs + node:path only), so any script can import it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The fallback when no valid source is found (the standard 400 ms game tick). */
export const TICK_DEFAULT_MS = 400;
export const REF_TICK_MS = 300;

export interface TickInfo { ms: number; source: 'env' | 'file' | 'default'; since?: string; why?: string }

/** logs/tick.json of the tree this module runs from (TICK_FILE overrides). */
export function tickFile(): string {
    return process.env.TICK_FILE || join(import.meta.dir, '..', 'logs', 'tick.json');
}

const validMs = (v: unknown): number | null => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 10 && n <= 5000 ? n : null;
};

/** Parse the file's text (exported for tests). Missing / garbage / out-of-range -> the default. */
export function parseTick(text: string | null): TickInfo {
    let j: any = null;
    if (text != null) { try { j = JSON.parse(text); } catch { j = null; } }
    const ms = j && typeof j === 'object' && !Array.isArray(j) ? validMs(j.ms) : null;
    if (ms == null) return { ms: TICK_DEFAULT_MS, source: 'default' };
    return { ms, source: 'file', since: typeof j.since === 'string' ? j.since : undefined, why: typeof j.why === 'string' ? j.why : undefined };
}

/** The current tick, read now (env pin first, then the file). Never throws. Uncached. */
export function readTick(file = tickFile(), env: Record<string, string | undefined> = process.env): TickInfo {
    const pinned = validMs(env.TICK_MS);
    if (pinned != null) return { ms: pinned, source: 'env' };
    let text: string | null = null;
    try { text = readFileSync(file, 'utf8'); } catch { text = null; }
    return parseTick(text);
}

// 1 s cache per path: status lines and reporters may ask often; an edit of the file still lands within a second.
const CACHE_MS = 1_000;
const cache = new Map<string, { at: number; ms: number }>();

/** Milliseconds per server tick, now. */
export function tickMs(file = tickFile()): number {
    const now = Date.now();
    const key = `${file}|${process.env.TICK_MS ?? ''}`;
    const c = cache.get(key);
    if (c && now - c.at < CACHE_MS) return c.ms;
    const ms = readTick(file).ms;
    cache.set(key, { at: now, ms });
    return ms;
}

/** n ticks as wall-clock ms. */
export function ticksToMs(n: number): number { return n * tickMs(); }
/** wall-clock ms as (fractional) ticks. */
export function msToTicks(ms: number): number { return ms / tickMs(); }
/** n ticks as seconds (for display). */
export function secondsForTicks(n: number): number { return n * tickMs() / 1000; }
/** n ticks as hours (for display). */
export function hoursForTicks(n: number): number { return n * tickMs() / 3_600_000; }
/** server ticks per wall-clock hour (9,000 at 400 ms). */
export function ticksPerHour(): number { return 3_600_000 / tickMs(); }
/** a per-tick rate as a per-hour rate. */
export function perHourFromPerTick(perTick: number): number { return perTick * ticksPerHour(); }

/**
 * A wall-clock budget that was sized at the 300 ms tick, rescaled so it means the SAME NUMBER OF TICKS at the current
 * tick — and NEVER SHORTER than it was (a faster tick keeps the old, more generous wall clock).
 *   scaledMs(45_000) -> 60_000 at 400 ms; 45_000 at 300 ms or faster.
 */
export function scaledMs(msAtRef: number, refTickMs = REF_TICK_MS): number {
    return Math.max(msAtRef, Math.round(msAtRef * tickMs() / refTickMs));
}

/** One-line summary for logs / dashboards. */
export function tickLine(t: TickInfo = readTick()): string {
    return `tick ${t.ms} ms (${t.source}${t.source === 'default' ? ': logs/tick.json missing/invalid' : ''}${t.since ? `, since ${t.since}` : ''})`;
}

if (import.meta.main) console.log(tickLine());

// =====================================================================================================
// PROGRESS WATCHDOG — the project's "absence must never look like zero" rule, enforced ONCE as a
// primitive instead of rediscovered per symptom.
// =====================================================================================================
//
// ⛔ IT HAS BEEN REDISCOVERED SEVERAL TIMES, EACH TIME AT FULL PRICE:
//   * bots stuck on one tile at the Al Kharid toll gate while their connections looked healthy;
//   * the STRANDED-UPSTAIRS bots, and a latched `arrived` flag that left bots idle forever.
// Every one of them was fixed with a bespoke counter (`wedged=`, `upstairs=`, `alive=`). Every bespoke
// counter catches exactly one shape of the same bug. This catches the SHAPE.
//
// -----------------------------------------------------------------------------------------------------
// WHAT IT WATCHES, AND WHY IT IS *CHANGE* AND NOT *INCREASE*
// -----------------------------------------------------------------------------------------------------
// Three signals, all already on every bot: total XP, coins, and position. A fourth optional slot takes
// any monotone produced-thing counter (bones buried, ore mined, trades done).
//
// ⛔ ANY CHANGE COUNTS, INCLUDING A DECREASE — and that is the difference between this and
// `account-state.progress()`, which deliberately counts only INCREASES. They answer different questions:
//     account-state:  "is this account EARNING?"       (a decrease is not earning)
//     watchdog:       "is this bot's world RESPONDING?" (a decrease is the server answering)
// A banking bot's coins fall to zero on deposit. That is a live, healthy, productive bot, and a
// watchdog that treated it as no-progress would fire on the single most common legitimate pause there
// is. Deposits, tolls paid, food eaten and items given away are all evidence of life.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ PHASE, NOT RAW DELTAS — THE FALSE-POSITIVE CONTROL
// -----------------------------------------------------------------------------------------------------
// Different activities have completely different legitimate quiet periods, and a single N would either
// libel a banking bot or sleep through a five-day stall. So patience is PER PHASE and the phase label is
// the one the brain already carries (`tickBucket` / `phase`). See `DEFAULT_PATIENCE`.
//
// ⛔ A PHASE CHANGE IS NOT PROGRESS AND MUST NEVER RESET THE CLOCK. The toll-gate bots cycled
// travel -> stalling -> travel forever; a state machine spinning is precisely the thing being detected.
// The clock is reset by the WORLD moving, never by the brain thinking.
//
// -----------------------------------------------------------------------------------------------------
// COST
// -----------------------------------------------------------------------------------------------------
// `observe()` is 4 integer comparisons, one Map-free field read and (on the no-change path) zero
// allocation, so it is cheap enough to call once per brain tick per bot. Measured in
// progress-watchdog's own bench: see `--bench`.
// =====================================================================================================

/** The four signals. `pos` is x/z fused; a bot that moved one tile has moved. */
export type StallSignal = 'xp' | 'gp' | 'pos' | 'items';

export interface WatchdogProbe {
    /** total experience across all skills. Monotone server-side, so any change is real. */
    xp?: number;
    /** coins held. Falls on a deposit — and that fall IS evidence of life (see the header). */
    gp?: number;
    x?: number;
    z?: number;
    /** any caller-supplied produced-thing counter. */
    items?: number;
    /** the brain's own phase label. Selects the patience. Changing it does NOT reset the clock. */
    phase?: string;
}

/**
 * PER-PHASE PATIENCE, in TICKS (600ms each on a live server).
 *
 * Every number here is a false-positive control and each is set from the longest LEGITIMATE quiet
 * period that phase actually has, plus headroom:
 *
 *   banking      600t (6m)  — the bank walk + open + deposit + withdraw round trip, plus a queue behind
 *                             a busy booth. gp changes on every deposit, so this rarely gets near it.
 *   travel       500t (5m)  — a genuine cross-map walk moves position EVERY tick, so this only runs down
 *                             when the bot is not moving at all. 5m of a frozen tile on a walk is the
 *                             toll-gate shape exactly.
 *   stunned      100t (1m)  — a stun lasts 8 ticks. A minute of it is ~7 stuns in a row.
 *   respawn      100t (1m)  — death -> respawn -> walk back.
 *   eating        60t
 *   searching    400t (4m)  — no reachable target; the camp may be contested.
 *   work         300t (3m)  — a fighting bot grants hp-xp constantly; 3m of silence while working is
 *                             the food-gate shape.
 *   DEFAULT      300t (3m)
 *
 * ⛔ THESE ARE NOT TUNING KNOBS FOR MAKING THE NUMBER GO DOWN. Raising one to silence a firing watchdog
 * is how a real stall gets buried; the fix is to work out which signal stopped moving and why.
 */
export const DEFAULT_PATIENCE: Readonly<Record<string, number>> = {
    banking: 600,
    bank: 600,
    travel: 500,
    traveling: 500,
    trade: 600,
    stunned: 100,
    respawn: 100,
    eating: 60,
    searching: 400,
    work: 300,
    firing: 300,
    adjWait: 300,
    chasing: 300,
    stalling: 300,
    other: 300,
};

export const DEFAULT_PATIENCE_TICKS = 300;

/**
 * An explicit, BOUNDED suspension for a wait the brain KNOWS is legitimate and unbounded-looking —
 * queueing on the global trade token, waiting out a server-side script, a scheduled break.
 *
 * ⛔ IT IS BOUNDED ON PURPOSE. An open-ended `suspend()` is just a mute button, and a mute button is how
 * "we know about that one" becomes a five-day outage. After `maxSuspendTicks` the suspension lapses and
 * the watchdog arms itself again regardless of what the brain believes.
 */
export const MAX_SUSPEND_TICKS = 1200;   // 12 minutes

export interface StallState {
    /** THE NAMED STATE. `STALL:<phase>` — greppable, and it names the phase it died in. */
    name: string;
    phase: string;
    /** ticks since ANY signal last moved. */
    ticks: number;
    /** the patience that was exceeded. */
    patience: number;
    /** which signals the watchdog could actually see. A stall reported on `pos` alone is weaker
     *  evidence than one on all four, and a consumer deserves to know which it got. */
    watching: StallSignal[];
    /** last observed values, for the log line. */
    at: { x?: number; z?: number; gp?: number; xp?: number; items?: number };
    /** one greppable sentence. Never empty. */
    note: string;
}

export interface WatchdogOptions {
    /** per-phase patience overrides, merged over DEFAULT_PATIENCE. */
    patience?: Readonly<Record<string, number>>;
    /** used when the phase is not in the table. */
    defaultPatience?: number;
    /** identifies the bot in `note`. */
    name?: string;
}

/**
 * ONE BOT'S WATCHDOG. Construct once, `observe()` once per brain tick.
 *
 * The state machine is deliberately trivial: a last-change tick, a set of last values, and a
 * latched `stalled`. Latching matters — a supervisor that polls every 15s must not miss a stall that
 * was true between polls, and a stall that resolves clears itself on the next real signal.
 */
export class ProgressWatchdog {
    readonly name: string;
    private readonly patience: Record<string, number>;
    private readonly defaultPatience: number;

    private lastXp = -1;
    private lastGp = -1;
    private lastX = -1;
    private lastZ = -1;
    private lastItems = -1;
    private phase = 'other';
    /** tick at which any signal last moved. -1 until the first observation baselines everything. */
    private lastMoveTick = -1;
    private suspendUntil = -1;
    private suspendReason = '';
    private stall: StallState | null = null;
    /** distinct stall EPISODES since construction (not ticks) — a climbing count is a flapping bot. */
    episodes = 0;
    /** ticks observed. `observations === 0` on a live bot means nothing is calling this. */
    observations = 0;

    constructor(opts: WatchdogOptions = {}) {
        this.name = opts.name ?? '';
        this.patience = { ...DEFAULT_PATIENCE, ...(opts.patience ?? {}) };
        this.defaultPatience = opts.defaultPatience ?? DEFAULT_PATIENCE_TICKS;
    }

    /** Currently-latched stall, or null. */
    get stalled(): StallState | null { return this.stall; }
    /** ticks since any signal moved, or 0 before the first observation. */
    quietFor(tick: number): number { return this.lastMoveTick < 0 ? 0 : tick - this.lastMoveTick; }
    get suspended(): boolean { return this.suspendUntil >= 0; }

    /**
     * Declare a bounded legitimate wait. Clamped to MAX_SUSPEND_TICKS — see the constant's note on why
     * an unbounded mute is not on offer.
     */
    suspend(tick: number, ticks: number, reason: string): void {
        this.suspendUntil = tick + Math.min(ticks, MAX_SUSPEND_TICKS);
        this.suspendReason = reason;
        this.stall = null;
        this.lastMoveTick = tick;      // the wait itself is not counted against the bot
    }

    resume(tick: number): void {
        this.suspendUntil = -1;
        this.suspendReason = '';
        this.lastMoveTick = tick;
    }

    /** Forget everything and re-baseline. Call on reconnect: a new session's counters are not the old
     *  session's, and diffing across the gap invents a change that never happened. */
    reset(tick: number): void {
        this.lastXp = -1; this.lastGp = -1; this.lastX = -1; this.lastZ = -1; this.lastItems = -1;
        this.lastMoveTick = tick;
        this.stall = null;
        this.suspendUntil = -1;
    }

    /**
     * ⭐ THE CALL. Returns the latched stall state (null when healthy).
     *
     * Cost: at most four integer comparisons plus a table lookup, and it allocates ONLY on the tick a
     * stall is first raised. Safe from a tick loop with many bots.
     */
    observe(tick: number, p: WatchdogProbe): StallState | null {
        this.observations++;
        if (p.phase !== undefined) this.phase = p.phase;   // records the phase; does NOT reset the clock

        let moved = false;
        // ⛔ `!==`, NOT `>`. See the header: a decrease is the server answering, which is exactly what
        // this is looking for. Earning is account-state's question, not this one.
        if (p.xp !== undefined) { if (this.lastXp >= 0 && p.xp !== this.lastXp) moved = true; this.lastXp = p.xp; }
        if (p.gp !== undefined) { if (this.lastGp >= 0 && p.gp !== this.lastGp) moved = true; this.lastGp = p.gp; }
        if (p.items !== undefined) { if (this.lastItems >= 0 && p.items !== this.lastItems) moved = true; this.lastItems = p.items; }
        if (p.x !== undefined && p.z !== undefined) {
            if (this.lastX >= 0 && (p.x !== this.lastX || p.z !== this.lastZ)) moved = true;
            this.lastX = p.x; this.lastZ = p.z;
        }

        if (this.lastMoveTick < 0) { this.lastMoveTick = tick; return null; }   // first probe: baseline only

        if (moved) {
            this.lastMoveTick = tick;
            this.stall = null;
            return null;
        }

        if (this.suspendUntil >= 0) {
            if (tick < this.suspendUntil) return null;
            // The suspension LAPSED rather than being resumed. Do not silently re-arm from now: the
            // clock keeps running from the last real signal, so a brain that suspends in a loop cannot
            // hold the watchdog off forever.
            this.suspendUntil = -1;
        }

        const quiet = tick - this.lastMoveTick;
        const patience = this.patience[this.phase] ?? this.defaultPatience;
        if (quiet < patience) return null;
        if (this.stall) { this.stall = { ...this.stall, ticks: quiet }; return this.stall; }

        const watching: StallSignal[] = [];
        if (this.lastXp >= 0) watching.push('xp');
        if (this.lastGp >= 0) watching.push('gp');
        if (this.lastX >= 0) watching.push('pos');
        if (this.lastItems >= 0) watching.push('items');

        this.episodes++;
        const at = { x: this.lastX >= 0 ? this.lastX : undefined, z: this.lastZ >= 0 ? this.lastZ : undefined,
            gp: this.lastGp >= 0 ? this.lastGp : undefined, xp: this.lastXp >= 0 ? this.lastXp : undefined,
            items: this.lastItems >= 0 ? this.lastItems : undefined };
        this.stall = {
            name: `STALL:${this.phase}`,
            phase: this.phase,
            ticks: quiet,
            patience,
            watching,
            at,
            note:
                `⛔ STALLED${this.name ? ` ${this.name}` : ''} in phase '${this.phase}' — ` +
                `NO ${watching.join('/')} change for ${quiet} ticks (patience ${patience}). ` +
                `at (${at.x ?? '?'},${at.z ?? '?'}) gp=${at.gp ?? '?'} xp=${at.xp ?? '?'}` +
                (this.suspendReason ? ` [a suspension for '${this.suspendReason}' LAPSED]` : '') +
                ` — this bot is alive and earning ZERO.`,
        };
        return this.stall;
    }
}

// -----------------------------------------------------------------------------------------------------
// the aggregate over many watchdogs
// -----------------------------------------------------------------------------------------------------

export interface WatchdogSnapshot {
    /** bots currently latched STALLED. ⛔ MUST BE 0. */
    stalled: number;
    /** `STALL:<phase>` -> count. */
    stalledBy: Record<string, number>;
    /** longest current stall, in ticks. */
    worstTicks: number;
    /** the worst offender's note, pre-rendered. '' when nothing is stalled. */
    worstNote: string;
    /** bots being watched at all. `watched === 0` with live bots is an INSTRUMENTATION failure, and it
     *  is a different bug from "nothing is stalled" — which is why it is a separate number. */
    watched: number;
}

export function summarizeWatchdogs(dogs: Iterable<ProgressWatchdog>): WatchdogSnapshot {
    let stalled = 0, worstTicks = 0, watched = 0, worstNote = '';
    const stalledBy: Record<string, number> = {};
    for (const d of dogs) {
        watched++;
        const s = d.stalled;
        if (!s) continue;
        stalled++;
        stalledBy[s.name] = (stalledBy[s.name] ?? 0) + 1;
        if (s.ticks > worstTicks) { worstTicks = s.ticks; worstNote = s.note; }
    }
    return { stalled, stalledBy, worstTicks, worstNote, watched };
}

// -----------------------------------------------------------------------------------------------------
// bench (offline). `bun headless/progress-watchdog.ts --bench`
// -----------------------------------------------------------------------------------------------------
// ⛔ `import.meta.main` ALONE IS NOT ENOUGH under `bun test` (1.3.9): it reads TRUE inside an IMPORTED
// module, so a bare CLI block runs during test collection. account-lock.ts and account-state.ts both
// paid for that; require this file to be the genuine entry point.
const isCliEntry = import.meta.main && /progress-watchdog\.ts$/.test(process.argv[1] ?? '');
if (isCliEntry && process.argv.includes('--bench')) {
    const N = 375, TICKS = 2000;
    const dogs = Array.from({ length: N }, (_, i) => new ProgressWatchdog({ name: `bot${i}` }));
    // Warm up so the measurement is of steady-state, not of the JIT.
    for (let t = 0; t < 200; t++) for (let i = 0; i < N; i++) dogs[i]!.observe(t, { xp: t, gp: t, x: t & 63, z: i & 63, phase: 'work' });
    const t0 = performance.now();
    for (let t = 200; t < TICKS; t++) {
        for (let i = 0; i < N; i++) {
            const moving = (i & 1) === 0;
            dogs[i]!.observe(t, { xp: moving ? t : 100, gp: moving ? t : 7, x: moving ? (t & 63) : 5, z: i & 63, phase: 'work' });
        }
    }
    const ms = performance.now() - t0;
    const calls = (TICKS - 200) * N;
    console.log(`[watchdog] ${calls} observe() calls in ${ms.toFixed(1)}ms = ${(ms * 1e6 / calls).toFixed(0)} ns/call ` +
        `(${(ms * 1e3 / (TICKS - 200)).toFixed(1)}us per TICK across ${N} bots)`);
    const snap = summarizeWatchdogs(dogs);
    console.log(`[watchdog] snapshot: stalled=${snap.stalled}/${snap.watched} worst=${snap.worstTicks}t ${JSON.stringify(snap.stalledBy)}`);
    const t1 = performance.now();
    for (let k = 0; k < 1000; k++) summarizeWatchdogs(dogs);
    console.log(`[watchdog] summarize(${N}): ${((performance.now() - t1) / 1000 * 1000).toFixed(0)} us/call`);
}

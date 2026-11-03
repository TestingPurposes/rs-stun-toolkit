// =====================================================================================================
// ROUTE GATE — the wiring between a brain that is about to COMMIT to a long walk and the
// route-feasibility oracle, plus the counters that make its answer impossible to miss.
// =====================================================================================================
//
// ⛔ THE STALL THIS CLOSES. Bots sat on the Al Kharid toll gate's operable tile for days while every
// connection read perfectly healthy. `navgrid` planned a 1014-tile route straight THROUGH a toll the
// bots blind-declined 2,587 times. Everything needed
// to know that was already on disk — obstacles.json has had border_gate's `NEEDS_PAYMENT 10gp` rule the
// whole time. Nothing ASKED.
//
// This module is the asking. Three pieces, deliberately separate:
//
//   profileFromBot()  turns a live bot into a `BotProfile` (coins / inventory / worn / skills / quests).
//   gateRoute()       classifies an ALREADY-PLANNED route, MEMOISED, and never throws.
//   RouteGateTally    the aggregate that renders `infeas= unk= blockers=` on a status line.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ COST — WHY THIS IS A COMMIT-TIME CALL AND A MEMO, NOT A PER-TICK CHECK
// -----------------------------------------------------------------------------------------------------
// `classifyRouteTiles` is ~1.1ms on a long (1000-tile) route. That is nothing ONCE per trip and ruinous
// per tick across many bots (a synchronous 570ms planRoute inside the packet loop once starved logins
// entirely). So:
//   * the ONLY call site is where a brain acquires a route (leanbot doTravel's lazy path compute), i.e.
//     exactly as often as `planRoute` itself, which the brain is already paying for;
//   * the answer is memoised on (sx,sz,dx,dz) + a COARSE profile fingerprint, so many bots
//     walking the same road pays for one classification between them;
//   * `gateRoute` catches everything. A feasibility oracle that throws into the packet loop would drop
//     the bot — which is a strictly worse outage than the one it is preventing.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ WHY THE FINGERPRINT IS COARSE, AND WHY IT IS COARSE IN THE SAFE DIRECTION
// -----------------------------------------------------------------------------------------------------
// Two bots on the same road differ only in what they CARRY. Keying the memo on the exact coin count
// would make it a cache with a 100% miss rate; keying it on nothing would let a rich bot's PASSABLE
// answer be served to a broke one. So the fingerprint buckets coins at the thresholds that actually
// decide something (the real fares in obstacles.json are 10gp and 10,000gp) and carries the gating
// skills verbatim — they are small integers that barely move.
//
// The bucket boundaries are LOWER bounds: a bot in the `>=10` bucket has at least 10gp, so a verdict
// computed for another bot in that bucket cannot claim it can afford a fare it cannot. The direction
// matters more than the precision — a false PASSABLE is what cost five days.
import * as feas from './route-feasibility.js';
import type { BotProfile, RouteVerdict, Tile, OverallVerdict, Need } from './route-feasibility.js';
import { COINS_OBJ } from './item-values.js';

export type { BotProfile, RouteVerdict, OverallVerdict } from './route-feasibility.js';

// -----------------------------------------------------------------------------------------------------
// building a profile from a live bot
// -----------------------------------------------------------------------------------------------------

/** RS stat index -> the lowercase engine spelling obstacles.json uses. PlayerStat.ts order. */
export const STAT_NAMES: readonly string[] = [
    'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking',
    'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining',
    'herblore', 'agility', 'thieving', 'stat18', 'stat19', 'runecraft',
];

/**
 * The subset of `BotProfile` a caller can build without knowing anything about LeanBot's internals.
 * Structural on purpose: `profileFromBot` takes this shape rather than `LeanBot`, so a runner, a test
 * fixture and the sim world can all feed it without route-gate importing the 6,900-line brain (and
 * without leanbot importing route-gate — that cycle is how two copies of a door table happen).
 */
export interface ProfileSource {
    coins(): number;
    /** every backpack obj id (duplicates fine; empty slots omitted). */
    invObjIds?(): number[];
    /** every worn obj id. */
    wornSlots?(): Array<{ slot: number; obj: number; count: number }>;
    /** RS stat index -> level, as LeanBot.statLevel. */
    statLevel?: number[];
    /** the all-or-nothing quest half of the profile — see LeanBot.questProfilePart. */
    questProfilePart?(requiredVarps?: readonly string[]): { profile: Pick<BotProfile, 'quests'> };
}

export interface ProfileOptions {
    /**
     * Only these quest varps need to be pinned for the quest map to be published. Narrow it to what a
     * route actually gates on and a definite answer becomes far more likely; leave it undefined and
     * the bar is EVERY gating varp in the world, 10 of which no channel can ever reach — so the map
     * is essentially never published and every quest gate reads UNKNOWN.
     */
    requiredVarps?: readonly string[];
    members?: boolean;
}

/**
 * Snapshot a live bot as a `BotProfile`.
 *
 * ⛔ EVERY FIELD IT CANNOT OBSERVE IS OMITTED, NEVER ZEROED. `BotProfile` documents `undefined` as
 * "unknown" and route-feasibility degrades the relevant obstacle to UNKNOWN for it — whereas a `skills:
 * {}` would assert level 0 in every skill and make every agility shortcut read as a hard blocker. The
 * quest map is the sharpest case and is handled by `questProfilePart`, which is all-or-nothing for
 * exactly this reason.
 */
export function profileFromBot(bot: ProfileSource, opts: ProfileOptions = {}): BotProfile {
    const p: BotProfile = { coins: bot.coins(), members: opts.members ?? true };
    if (bot.invObjIds) p.inventory = bot.invObjIds();
    if (bot.wornSlots) p.worn = bot.wornSlots().map(w => w.obj);
    if (bot.statLevel) {
        const skills: Record<string, number> = {};
        for (let i = 0; i < STAT_NAMES.length && i < bot.statLevel.length; i++) {
            skills[STAT_NAMES[i]!] = bot.statLevel[i] ?? 1;
        }
        p.skills = skills;
    }
    if (bot.questProfilePart) {
        const q = bot.questProfilePart(opts.requiredVarps).profile;
        // `{}` — the key ABSENT — is the honest "I could not pin every required quest". Spreading it is
        // a no-op in that case, which is exactly the intent: no `quests` key => UNKNOWN, not stage 0.
        if (q.quests) p.quests = q.quests;
    }
    return p;
}

// -----------------------------------------------------------------------------------------------------
// the memo
// -----------------------------------------------------------------------------------------------------

/** Coin thresholds that actually decide a gate in obstacles.json, plus headroom. LOWER bounds. */
const COIN_BUCKETS = [0, 1, 10, 100, 1_000, 10_000, 100_000];

function coinBucket(coins: number): number {
    let b = 0;
    for (const t of COIN_BUCKETS) if (coins >= t) b = t;
    return b;
}

/** Skills any obstacle in the generated table can test. Everything else is not worth a memo miss. */
const GATING_SKILLS = ['agility', 'cooking', 'crafting', 'fishing', 'magic', 'mining', 'ranged', 'strength'];

/**
 * A coarse, STABLE fingerprint of the parts of a profile an obstacle can read. Two bots with the same
 * fingerprint get the same verdict, and the bucketing is a lower bound so that sharing can only ever
 * under-state what a bot can afford.
 *
 * The quest map is fingerprinted by its CONTENT (sorted), not by its presence: `quests` absent and
 * `quests: {}` are completely different claims (unknown vs "every quest at 0") and must never collide.
 */
export function profileFingerprint(p: BotProfile): string {
    const s = p.skills;
    const sk = s ? GATING_SKILLS.map(k => s[k] ?? -1).join('.') : 'x';
    const q = p.quests
        ? Object.keys(p.quests).sort().map(k => `${k}=${p.quests![k]}`).join(',')
        : 'x';                                   // 'x' = the key was ABSENT = quest state unknown
    // Inventory/worn matter only for NEEDS_ITEM gates, which are keyed on specific obj ids. Hashing the
    // whole pack every commit would be the expensive part of a cheap function, so the item set is
    // summarised by a cheap order-independent checksum. A collision costs a WRONG-BOT verdict for one
    // trip, which is why `gateRoute` re-verifies nothing and the caller is told `cached`.
    let items = 0;
    if (p.inventory) for (const id of p.inventory) items = (items + id * 2654435761) >>> 0;
    if (p.worn) for (const id of p.worn) items = (items + id * 40503) >>> 0;
    return `${coinBucket(p.coins ?? -1)}|${sk}|${items.toString(36)}|${p.members === false ? 'f' : 't'}|${q}`;
}

export interface GateResult {
    /** PASSABLE / BLOCKED / UNKNOWN / NO_ROUTE, or UNAVAILABLE when the oracle could not run at all. */
    verdict: OverallVerdict | 'UNAVAILABLE';
    /** true ONLY for a clean PASSABLE. UNKNOWN is not ok — see route-feasibility's invariant. */
    ok: boolean;
    /** The single greppable line to log at departure. Never empty. */
    note: string;
    /** `<locId>@<x>,<z> <CLASS>` for the first non-PASSABLE obstacle — the tally's grouping key. */
    blocker: string | null;
    /** deduped shopping list. Empty when clean or unavailable. */
    needs: readonly Need[];
    /** ordinary doors on the route — a real number a supervisor wants ("this trip has 40 doors"). */
    doors: number;
    unknownCount: number;
    /** classification cost. 0 on a memo hit. */
    ms: number;
    cached: boolean;
    /**
     * ⭐ THE TOLL PARTITION (§46). True when the verdict is BLOCKED, EVERY non-PASSABLE obstacle on the
     * route is a `NEEDS_PAYMENT`, and this bot's purse already covers the whole fare.
     *
     * ⛔ WHY THIS FIELD EXISTS AT ALL. `route-feasibility.ts:715-722` classifies an AFFORDABLE toll as
     * NEEDS_PAYMENT ON PURPOSE — "still an obstacle, not a plain door: the bot must know to answer the
     * fare dialog". That is right for the ORACLE and wrong for the ALARM: a status line that rendered
     * every non-PASSABLE verdict as `BOT(S) COMMITTED TO A ROUTE THEY CANNOT COMPLETE — earning ZERO`
     * made a bot that pays its 10 gp and walks on read identically to one wedged at a wall. In practice
     * that line printed sixty times for ONE bot holding 3,117 gp against a 10 gp fare while the crossing
     * was WORKING, and it was misread as a regression.
     *
     * ⛔ AND IT IS SAFE UNDER THE MEMO. `profileFingerprint` buckets coins at LOWER bounds that include
     * the real fares (10 and 10,000 gp, route-gate's COIN_BUCKETS), so a `tollOnly` computed for one bot
     * can only ever be served to another bot with AT LEAST as many coins. The share can never claim a
     * fare a bot cannot pay.
     *
     * ⛔ `tollOnly` NEVER MAKES A VERDICT `ok`. It is a REASON, not a pass: the trip still needs the toll
     * handler armed, and `ok`/`verdict` are untouched so every existing consumer keeps its meaning.
     */
    tollOnly: boolean;
    /** full verdict when the oracle ran; null when UNAVAILABLE. */
    raw: RouteVerdict | null;
}

interface MemoEntry { result: GateResult; at: number }

const memo = new Map<string, MemoEntry>();
let hits = 0, misses = 0, unavailable = 0;

export const MEMO_CAP = Number(process.env.ROUTE_GATE_MEMO_CAP ?? 4096);
/** Entries older than this are re-classified. A route's obstacles are static, but a bot's PROFILE is
 *  in the key, so the only thing this bounds is drift in the underlying loc data (a live LOC_ADD). */
export const MEMO_TTL_MS = Number(process.env.ROUTE_GATE_MEMO_TTL_MS ?? 30 * 60_000);

/** Set false to disable gating entirely (env `ROUTE_GATE=0`) without touching a call site. */
export const ENABLED = process.env.ROUTE_GATE !== '0';

export interface GateOptions {
    level?: number;
    /** override the memo key's route part (default: endpoints). */
    routeKey?: string;
    nowMs?: number;
}

function blockerKey(v: RouteVerdict): string | null {
    const b = v.firstBlocking;
    if (!b) return null;
    return `${b.locId}@${b.at.x},${b.at.z} ${b.cls}`;
}

const UNAVAILABLE = (why: string): GateResult => ({
    verdict: 'UNAVAILABLE', ok: false,
    note: `route-gate UNAVAILABLE — ${why}. The trip is NOT vouched for; treat it as UNKNOWN.`,
    blocker: null, needs: [], doors: 0, unknownCount: 0, ms: 0, cached: false, tollOnly: false, raw: null,
});

/**
 * Is this verdict blocked ONLY by tolls this bot can already pay?
 *
 * ⛔ EVERY non-PASSABLE obstacle must be a toll — one `IMPASSABLE` alongside three affordable tolls is
 * still a trip that cannot be completed, and calling it `tollOnly` would re-create the exact
 * under-report ("a false PASSABLE is the dangerous outcome") the oracle's invariant forbids. An UNKNOWN
 * anywhere fails this test too, because `verdict` is then UNKNOWN rather than BLOCKED.
 */
function tollOnlyVerdict(v: RouteVerdict, profile: BotProfile): boolean {
    if (v.verdict !== 'BLOCKED') return false;
    const blocking = v.obstacles.filter(o => o.cls !== 'PASSABLE');
    if (!blocking.length) return false;
    if (!blocking.every(o => o.cls === 'NEEDS_PAYMENT')) return false;
    const fare = v.needs.reduce((n, need) => n + (need.kind === 'coins' ? need.amount : 0), 0);
    // ⛔ `coins === undefined` is UNKNOWN, never "enough" — the BotProfile contract, applied here too.
    return profile.coins !== undefined && fare > 0 && profile.coins >= fare;
}

/**
 * ⭐ THE CALL. Classify an ALREADY-PLANNED per-tile route at the moment a brain commits to walking it.
 *
 * Pass the waypoints the brain just planned — do NOT re-plan, and do NOT thin them through `toVias`
 * (see learnings/navgrid-and-pathing.md: toVias emits the tile AFTER a turn, and densify then
 * diagonal-shortcuts through the very wall the corner avoided).
 *
 * NEVER THROWS. A missing loc index, a torn table, an oracle bug — all of it comes back as
 * `UNAVAILABLE`, which the caller must treat exactly like UNKNOWN: do not depart silently.
 */
export function gateRoute(tiles: readonly Tile[], profile: BotProfile, opts: GateOptions = {}): GateResult {
    if (!ENABLED) return UNAVAILABLE('disabled by ROUTE_GATE=0');
    if (tiles.length < 2) return UNAVAILABLE(`route has ${tiles.length} tile(s) — nothing to classify`);
    if (!feas.isReady()) { unavailable++; return UNAVAILABLE('loc-scene is not built (call locScene.init() at startup)'); }

    const a = tiles[0]!, b = tiles[tiles.length - 1]!;
    const level = opts.level ?? 0;
    const key = `${opts.routeKey ?? `${level}:${a.x},${a.z}>${b.x},${b.z}:${tiles.length}`}|${profileFingerprint(profile)}`;
    const now = opts.nowMs ?? Date.now();
    const hit = memo.get(key);
    if (hit && now - hit.at < MEMO_TTL_MS) {
        hits++;
        return { ...hit.result, cached: true, ms: 0 };
    }
    misses++;

    let v: RouteVerdict;
    try {
        v = feas.classifyRouteTiles(tiles, profile, { level, includePassable: true });
    } catch (e: any) {
        unavailable++;
        return UNAVAILABLE(`classifier threw: ${e?.message ?? e}`);
    }

    const result: GateResult = {
        verdict: v.verdict,
        ok: v.ok,
        note: v.note,
        blocker: blockerKey(v),
        needs: v.needs,
        doors: v.obstacles.filter(o => o.cls === 'PASSABLE').length,
        unknownCount: v.unknownCount,
        ms: v.ms,
        cached: false,
        tollOnly: tollOnlyVerdict(v, profile),
        raw: v,
    };
    // Evict wholesale rather than LRU-track: this is a cache in front of a 1ms function, and the
    // bookkeeping for an LRU would cost more than the miss it saves.
    if (memo.size >= MEMO_CAP) memo.clear();
    memo.set(key, { result, at: now });
    return result;
}

export function gateStats(): { hits: number; misses: number; unavailable: number; size: number } {
    return { hits, misses, unavailable, size: memo.size };
}

/** Test seam. */
export function __resetGate(): void { memo.clear(); hits = 0; misses = 0; unavailable = 0; }
/** Test seam: the composition rule on its own, so "a toll NEXT TO a wall" can be asserted directly. */
export const __tollOnlyVerdict = tollOnlyVerdict;

// -----------------------------------------------------------------------------------------------------
// the tally — how a verdict becomes a number on a status line
// -----------------------------------------------------------------------------------------------------
//
// ⛔ THE WHOLE POINT IS THAT NOBODY HAS TO GO LOOKING. A verdict logged once at departure scrolls off
// in ninety seconds, while a stall can last days. So the tally carries the LAST verdict per bot and
// prints three numbers beside `conn=`:
//     infeas=<n>    bots currently holding a non-PASSABLE, non-UNKNOWN verdict (they CANNOT get there)
//     unk=<n>       bots holding an UNKNOWN/UNAVAILABLE verdict (departed unverified)
//     blockers=...  the top obstacles by count, e.g. `2882@3268,3227 NEEDS_PAYMENT x25`
// A constant non-zero `infeas=` beside zero progress IS the stall's signature.

export interface TallySnapshot {
    /**
     * Bots whose last verdict was BLOCKED or NO_ROUTE **and is not merely an affordable toll**.
     * ⛔ THE TOLL BOTS ARE NOT IN HERE — see `blockedToll`. `infeas` is the alarm, and an alarm that
     * fires on a fare the bot is about to pay is an alarm nobody reads.
     */
    infeas: number;
    /**
     * ⭐ Bots whose ONLY blocker is a toll they can already afford (`GateResult.tollOnly`). Reported
     * SEPARATELY and never merged into `infeas` (§46: "blocked because it must pay 10 gp" and "blocked
     * because there is a wall" need opposite interventions). Non-zero is normal for any lane whose
     * shelf sits across the Al Kharid gate; non-zero AND a flat `tolls=.../paid=0` is the real fault.
     */
    blockedToll: number;
    /** bots whose last verdict was UNKNOWN or UNAVAILABLE. */
    unk: number;
    /** bots whose last verdict was PASSABLE. */
    ok: number;
    /** blocker key -> count, descending. ⛔ GENUINE blockers only — toll-only bots are in `tollBlockers`. */
    blockers: Record<string, number>;
    /** `2882@3268,3227 NEEDS_PAYMENT x25` — the top few, pre-rendered for a reporter line. */
    blockersText: string;
    /** blocker key -> count for the toll-only bots, so `blocked:toll=` can name its own gate. */
    tollBlockers: Record<string, number>;
    /** pre-rendered twin of `blockersText` for the toll-only bots. */
    tollBlockersText: string;
    /** bots with any recorded verdict at all. `tracked === 0` is UNKNOWN, not "everything is fine". */
    tracked: number;
}

/**
 * Last-verdict-per-bot, aggregated. Cheap: one Map write per departure, one pass per reporter cycle.
 *
 * A bot that ARRIVES should call `clear()` — otherwise a verdict from a trip that finished hours ago
 * keeps counting, which is the same class of lie (a stale number rendered as current) this whole
 * package exists to stop.
 */
export class RouteGateTally {
    private readonly last = new Map<string, GateResult>();

    note(botKey: string, r: GateResult): void { this.last.set(botKey, r); }
    clear(botKey: string): void { this.last.delete(botKey); }
    get size(): number { return this.last.size; }
    get(botKey: string): GateResult | undefined { return this.last.get(botKey); }

    snapshot(topN = 3): TallySnapshot {
        let infeas = 0, unk = 0, ok = 0, blockedToll = 0;
        const blockers: Record<string, number> = {};
        const tollBlockers: Record<string, number> = {};
        for (const r of this.last.values()) {
            if (r.verdict === 'PASSABLE') { ok++; continue; }
            const k = r.blocker ?? `${r.verdict} (no single blocker)`;
            if (r.verdict === 'UNKNOWN' || r.verdict === 'UNAVAILABLE') { unk++; }
            // ⭐ THE PARTITION. A payable toll is its own bucket and its own blocker list; it must never
            // add to `infeas`, which is what the "earning ZERO" alarm is wired to.
            else if (r.tollOnly) { blockedToll++; tollBlockers[k] = (tollBlockers[k] ?? 0) + 1; continue; }
            else { infeas++; }
            blockers[k] = (blockers[k] ?? 0) + 1;
        }
        const sorted = Object.entries(blockers).sort((a, b) => b[1] - a[1]);
        const sortedToll = Object.entries(tollBlockers).sort((a, b) => b[1] - a[1]);
        return {
            infeas, blockedToll, unk, ok,
            blockers: Object.fromEntries(sorted),
            blockersText: sorted.slice(0, topN).map(([k, n]) => `${k} x${n}`).join(' | '),
            tollBlockers: Object.fromEntries(sortedToll),
            tollBlockersText: sortedToll.slice(0, topN).map(([k, n]) => `${k} x${n}`).join(' | '),
            tracked: this.last.size,
        };
    }
}

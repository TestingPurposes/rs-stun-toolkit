// =====================================================================================================
// speedrun/core.ts — SpeedBot: a tick-precise, INERT LeanBot for the speedrun speedrun (see README.md)
// =====================================================================================================
//
// LeanBot's brain() still runs every tick (it owns the character-design accept, the tutorial skip, the
// level-up/dialog driver and the anti-kick keepalive), but every brain branch that would ACT on its own
// is switched off here: no pickpocketing, no combat, no travel unless asked, no eating unless asked, no
// trade brain, and main modals (bank/shop/trade) are never auto-closed. Everything else is driven from
// async code through the methods below, one awaited server tick at a time.
//
// ⭐ THE ONE TIMING RULE. LeanBot flushes `out` once per tick, right after brain(). Code resumed by
// `await bot.tick()` runs AFTER that flush, so without help every packet it writes would sit in the
// buffer until the NEXT tick's flush — one wasted tick per action. `tick()` (and every sender here)
// therefore schedules a flush on the next macrotask, which lands after the caller's synchronous code
// and before the server's next cycle. Net effect: an action decided on tick N is processed on N+1.
//
// Run every script from server/webclient (the '#/' alias) with LC_HOST=localhost:8888.

import { ClientProt } from '#/io/ClientProt.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { LeanBot, levelForDisplayedXp, stepCrossesDoorEdge, UNDERGROUND_Z, SIM_SETTLE_MS, SIM_DET, SIM_FAST, SIM_FAST_CHECK, SIM_FAST_IMM } from '../leanbot.js';
import * as locScene from '../loc-scene.js';
import { leafAdded, leafRemoved, leafZoneReset, leafRelease, isOpenLeaf } from './leaf-walls.js';
import { tickMs } from './legs/tick-ms.js';
import * as rsmodSeal from '../../../vendor/rsmod-pathfinder';

// ---------------------------------------------------------------------------------------------------
// constants (component ids verified against server/content/pack/interface.pack + content scripts)
// ---------------------------------------------------------------------------------------------------
export const STAT_NAMES = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking',
    'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility',
    'thieving', 'stat18', 'stat19', 'runecraft'] as const;
export const XP_RATE = 25;                     // NODE_XPRATE on the demo and our local server

// rev 289: by name (274 numbers were 207 / 138 / 51)
const OP_MOVE_GAMECLICK = ClientProt.MOVE_GAMECLICK, OP_MOVE_OPCLICK = ClientProt.MOVE_OPCLICK, OP_CLOSE_MODAL = ClientProt.CLOSE_MODAL;
const INV = 3214;                              // inventory:inv
const BANK_MODAL = 5292, BANK_MAIN_INV = 5382, BANK_SIDE_INV = 2006;
/** ticks to wait for the server's IF_CLOSE after our CLOSE_MODAL (core bankOpen()) */
const BANK_CLOSE_WAIT = 12;
const BANK_NOTE_ON = 5386, BANK_NOTE_OFF = 5387; // bank_main:com_93 / com_94 -> %bankcert 1 / 0
const TRADESIDE_INV = 3322, TRADEMAIN = 3323, TRADEMAIN_INV = 3415, TRADEMAIN_OTHERINV = 3416;
const TRADEMAIN_ACCEPT = 3420, TRADECONFIRM = 3443, TRADECONFIRM_ACCEPT = 3546;
const RUN_ON_BUTTON = 153;                     // controls:com_5 -> p_run(^player_run_on)
const PLAYER_KIT_MODAL = 3559;
/** main modal wilderness_warning (interface.pack 1908): area_wilderness/scripts/wilderness_warning.rs2 p_stopaction's the walk
 *  and opens it the first time a session enters z 3512-3515 (or the underground strip); every MOVE is refused while it is open. */
export const WILD_WARNING_MODAL = 1908;
/** chat modal objbox1 (interface.pack 306): the level-up "You can now ..." unlock pages (levelup_unlocks_*.rs2 ~objbox, chained
 *  after the levelup_<stat> page by levelup.rs2:59). Like the level-up page it blocks every MOVE/op until continued. */
export const OBJBOX_MODAL = 306, OBJBOX_TEXT = 308;
/** objbox1-4 (chat.rs2 objbox_page: 1-4 lines of text) -> the component holding the page's FIRST line (where "You can now" is). */
export const OBJBOX_FIRST_LINE: ReadonlyMap<number, number> = new Map([[306, 308], [310, 313], [315, 318], [321, 324]]);
export const UNLOCK_TEXT = /^(?:@\w{3}@)?(?:You can now|You are now|Members can now)\b/;

export const LOG_DIR = resolve(import.meta.dir, '../../../../logs/acct21');
const PACK_DIR = resolve(import.meta.dir, '../../../content/pack');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
type Tile = { x: number; z: number };

// ---------------------------------------------------------------------------------------------------
// name tables (lazy): obj debugname <-> id, interface component name -> id
// ---------------------------------------------------------------------------------------------------
let DOOR_STATES: Record<string, { state: 'open' | 'closed'; pair: number | null; op: number; name: string }> | null = null;
/** sdk/navgrid/door-states.json: which loc ids are open/closed doors (empty if the file is missing). */
function doorStates() {
    if (DOOR_STATES) return DOOR_STATES;
    try { DOOR_STATES = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../../sdk/navgrid/door-states.json'), 'utf8')); } catch { DOOR_STATES = {}; }
    return DOOR_STATES!;
}
function loadPack(file: string): { byName: Map<string, number>; byId: Map<number, string> } {
    const byName = new Map<string, number>(), byId = new Map<number, string>();
    for (const line of readFileSync(resolve(PACK_DIR, file), 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i <= 0) continue;
        const id = Number(line.slice(0, i)), name = line.slice(i + 1).trim();
        if (!Number.isFinite(id) || !name) continue;
        byId.set(id, name);
        if (!byName.has(name)) byName.set(name, id);
    }
    return { byName, byId };
}
let OBJ: ReturnType<typeof loadPack> | null = null;
let IFACE: ReturnType<typeof loadPack> | null = null;
const objPack = () => (OBJ ??= loadPack('obj.pack'));
const ifacePack = () => (IFACE ??= loadPack('interface.pack'));

/** obj id from a number, a debugname (`rune_axe`, `cert_willow_logs`, `naturerune`) or a display name. */
export function objId(o: number | string): number {
    if (typeof o === 'number') return o;
    const k = o.trim().toLowerCase();
    const hit = objPack().byName.get(k) ?? objPack().byName.get(k.replace(/\s+/g, '_'));
    if (hit !== undefined) return hit;
    if (locScene.isReady()) {
        const ids = locScene.objIdsByName(new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        if (ids.length) return ids[0]!;
    }
    throw new Error(`objId: unknown obj '${o}'`);
}
export function objDebugName(id: number): string { return objPack().byId.get(id) ?? String(id); }
/** Noted (cert) variant of an obj id, or -1. */
export function certOf(id: number): number { return objPack().byName.get(`cert_${objDebugName(id)}`) ?? -1; }

const SPELL_ALIAS: Record<string, string> = {
    low_alch: 'lowlvl_alchemy', low_alchemy: 'lowlvl_alchemy', lowalch: 'lowlvl_alchemy',
    high_alch: 'highlvl_alchemy', high_alchemy: 'highlvl_alchemy', highalch: 'highlvl_alchemy',
};
/** `magic:<name>` component id. Accepts the content name (`varrock_teleport`, `superheat_item`) or an alias. */
export function spellCom(name: string): number {
    const k = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const id = ifacePack().byName.get(`magic:${SPELL_ALIAS[k] ?? k}`);
    if (id === undefined) throw new Error(`spellCom: no component magic:${SPELL_ALIAS[k] ?? k}`);
    return id;
}
export function componentId(name: string): number {
    const id = ifacePack().byName.get(name);
    if (id === undefined) throw new Error(`componentId: unknown ${name}`);
    return id;
}

/** fix 295a TEST (SR_CREATE_DROP_TEST): accounts whose create() already had its socket closed once */
const createDropTested = new Map<string, number>();
const logoutDropTested = new Set<string>();   // session 11 fix 376a TEST: once per account

// ---------------------------------------------------------------------------------------------------
// pathfinding: ONE init per process (~8s: rsmod collision + navgrid + loc-scene)
// ---------------------------------------------------------------------------------------------------
let NAV: {
    findLongPath: (level: number, sx: number, sz: number, dx: number, dz: number, max?: number, blocked?: Iterable<any>) => Array<{ x: number; z: number }>;
    findPathToLoc: (...a: any[]) => Array<{ x: number; z: number }>;
    reachedLoc: (...a: any[]) => boolean;
    getDoorAt: (level: number, x: number, z: number) => { level: number; x: number; z: number; shape: number; angle: number; blockrange: boolean } | undefined;
    planRoute: (sx: number, sz: number, dx: number, dz: number, o: any) => { waypoints: Tile[] } | null;
    planMultiLevel: (from: any, to: any, o?: any) => any;
    locForceApproach: (id: number) => number;
    navFindPath: (level: number, sx: number, sz: number, dx: number, dz: number) => Tile[];
} | null = null;

/** how many walk plans came from the navgrid vs rsmod (reported by the runner) */
export const NAVGRID_STATS = { navgrid: 0, rsmod: 0 };

// ---------------------------------------------------------------------------------------------------
// session 11 fix 309x STALL LOGGER (SR_STALL_LOG=0 turns it off; SR_STALL_MS=250 the threshold). Every bot (main, partner,
// helpers) shares ONE event loop: a long synchronous call in one bot (a path search, a travel plan) makes
// every bot miss lockstep ticks (engine '[sim] tick N: K/500 ticks ran on the 200 ms deadline without an ack'). Each timed
// call slower than the threshold logs one '[stall] 309x <bot> <label> <ms> ms <args> @ <call sites>' line; a 100 ms
// interval logs '[stall] 309x loop blocked <ms>' with the slowest timed label in that gap (untimed code shows 'none');
// '[stall] 309x top' sums by label + call site every 10 min and at exit. <bot> = the SpeedBot that last resumed from tick().
// ---------------------------------------------------------------------------------------------------
const STALL_ON = process.env.SR_STALL_LOG !== '0';
const STALL_MS = Number(process.env.SR_STALL_MS ?? 250);
let STALL_BOT = '';
/** name the bot whose code runs now (SpeedBot.tick() calls it on resume) */
export function stallBot(u: string): void { STALL_BOT = u; }
const STALL_AGG = new Map<string, { n: number; ms: number; max: number }>();
let stallGap = '';
const STALL_SKIP = /stallNote|stallSite|stallTimed|timedNav|Error/;
function stallSite(): string {
    const out: string[] = [];
    for (const l of (new Error().stack ?? '').split('\n').slice(1)) {
        if (STALL_SKIP.test(l)) continue;
        const m = /(?:at (\S+) .*?)?([\w.-]+\.ts):(\d+)/.exec(l); if (!m) continue;
        out.push(`${m[1] && m[1] !== 'async' ? m[1].replace(/^.*\./, '') + ' ' : ''}${m[2]}:${m[3]}`);
        if (out.length >= 4) break;
    }
    return out.join(' < ');
}
function stallAgg(k: string, ms: number): void { const a = STALL_AGG.get(k) ?? { n: 0, ms: 0, max: 0 }; a.n++; a.ms += ms; a.max = Math.max(a.max, ms); STALL_AGG.set(k, a); }
function stallTop(why: string): void {
    if (!STALL_AGG.size) return;
    const rows = [...STALL_AGG.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12);
    console.log(`[stall] 309x top (${why}): ${rows.map(([k, a]) => `${k} n=${a.n} sum=${a.ms | 0} max=${a.max | 0}`).join(' | ')}`);
}
/** one stall line when `ms` >= the threshold (no-op otherwise); `label` names the call, `detail` its arguments */
export function stallNote(label: string, ms: number, detail = ''): void {
    if (!STALL_ON || ms < STALL_MS) return;
    const site = stallSite();
    stallAgg(`${label} @${site.split(' < ').slice(0, 2).join('<')}`, ms);
    if (!stallGap || Number(/ (\d+)ms$/.exec(stallGap)?.[1] ?? 0) < ms) stallGap = `${STALL_BOT || '-'} ${label} ${ms | 0}ms`;
    console.log(`[stall] 309x ${STALL_BOT || '-'} ${label} ${ms | 0} ms ${detail} @ ${site}`);
}
/** wrap a synchronous function with the stall logger */
export function stallTimed<F extends (...a: any[]) => any>(label: string, fn: F, show: (a: any[]) => string = a => JSON.stringify(a.slice(0, 5))): F {
    if (!STALL_ON) return fn;
    return (function timedNav(...a: any[]) { const t = performance.now(); try { return fn(...a); } finally { const ms = performance.now() - t; if (ms >= STALL_MS) stallNote(label, ms, show(a)); } }) as F;
}
let stallWatchOn = false;
function stallWatch(): void {
    if (!STALL_ON || stallWatchOn) return;
    stallWatchOn = true;
    let last = performance.now(), lastTop = Date.now();
    const iv = setInterval(() => {
        const now = performance.now(), gap = now - last - 100; last = now;
        if (gap >= STALL_MS) { stallAgg(`loop (${stallGap ? stallGap.replace(/ \d+ms$/, '') : 'untimed'})`, gap); console.log(`[stall] 309x loop blocked ${gap | 0} ms (last bot ${STALL_BOT || '-'}; slowest timed: ${stallGap || 'none'})`); }
        stallGap = '';
        if (Date.now() - lastTop > 600_000) { lastTop = Date.now(); stallTop('10 min'); }
    }, 100);
    (iv as any).unref?.();
    process.on('exit', () => stallTop('exit'));
}

// session 11 fix 309a (SR_NAV_ARRIVE_SKIP=0 reverts; SR_STALL_FIX=0 reverts every 309 fix): navFindPath tried arrive 0, 2,
// 4 one after another, each up to 600k expansions, so an unreachable query (mainland -> Stronghold, an island) cost three
// full searches (~4 s, fix 80). A bigger arrive orders the far cells the same way (navgrid LAST_SEARCH), so when the failed
// arrive-0 search never reached a cell within 4 tiles of the destination, arrive 2/4 cannot succeed: skip them.
// fix 309b (SR_NAV_NEG=0 reverts): when the navgrid finds no route, the answer (rsmod's fallback path, usually ending short)
// is remembered for the same (source tile, destination tile) query; and a source inside a region a failed search EXHAUSTED
// (a closed region: every cell reachable from its source was searched; the mainland is one, ~470k cells, 0.45 s) skips the
// navgrid searches and goes straight to the rsmod fallback, as the old code ended up doing. Regions are bitsets (max 6;
// reachable-from-source, so sound for one-way edges). Answers are the same as before, only cheaper.
// Only long queries (> 48 tiles: the navgrid ones; short ones run under temporary npc blocks / walls) are remembered, for
// SR_NAV_NEG_MS (20 s) and never across a door leaf leaving or a zone reset (the map may have opened up).
const STALL_FIX = process.env.SR_STALL_FIX !== '0';
const NAV_ARRIVE_SKIP = STALL_FIX && process.env.SR_NAV_ARRIVE_SKIP !== '0';
const NAV_NEG = STALL_FIX && process.env.SR_NAV_NEG !== '0';
const NAV_ENTER = STALL_FIX && process.env.SR_NAV_ENTER !== '0';
const NAV_SHORT = STALL_FIX && process.env.SR_NAV_SHORT !== '0';
/** navFindPath effort counters (the runner may print them) */
export const NAV_EFFORT = { queries: 0, searches: 0, skipped: 0, negHits: 0, regionHits: 0, ms: 0 };
const NAV_NEG_MS = Number(process.env.SR_NAV_NEG_MS ?? 20_000);
let navNegGen = 0;
/** the planner map may have opened up (a door leaf left, a zone reset): forget remembered failures (fix 309b) */
export function navNegClear(): void { navNegGen++; }

export async function initNav(): Promise<NonNullable<typeof NAV>> {
    if (NAV) return NAV;
    const t0 = Date.now();
    const pf = await import('../../../../sdk/pathfinding');
    pf.initPathfinding();
    const { applyBlockedEdges } = await import('../blocked-edges.js');
    applyBlockedEdges(pf.blockDoor);
    const navgrid = await import('../../../../sdk/navgrid/index.js');
    navgrid.init();
    const { planMultiLevel } = await import('../../../../sdk/navgrid/levels.js');
    const { locForceApproach } = await import('../../../../sdk/navgrid/locmeta');
    locScene.init();
    const NEG = new Map<string, { at: number; pts: Tile[] }>();
    const REGIONS: Array<{ bits: Uint8Array; level: number; at: number }> = [];
    let negSeen = navNegGen;
    const inRegion = (bits: Uint8Array, c: number) => c >= 0 && ((bits[c >> 3]! >> (c & 7)) & 1) === 1;
    /** a tile within `a` of (x, z) is in the region (= a search with arrive `a` can end there) */
    const nearRegion = (bits: Uint8Array, level: number, x: number, z: number, a: number) => { for (let ddx = -a; ddx <= a; ddx++) for (let ddz = -a; ddz <= a; ddz++) if (inRegion(bits, navgrid.cellOf(level, x + ddx, z + ddz))) return true; return false; };
    const rawFindPath = (level: number, sx: number, sz: number, dx: number, dz: number): Tile[] => {
        NAV_EFFORT.queries++;
        const nk = `${level},${sx},${sz}>${dx},${dz}`;
        const neg = NAV_NEG && Math.max(Math.abs(dx - sx), Math.abs(dz - sz)) > 48;
        let skipNav = false;
        // fix 309d (SR_NAV_ENTER=0 reverts): nothing can step onto dest (a booth, a ladder, a counter): arrive 0 would search
        // the whole region (~0.4 s on the mainland) and fail, then arrive 2 finds the route. Start at arrive 2.
        let arrives = NAV_ENTER && !navgrid.enterable(level, dx, dz) ? [2, 4] : [0, 2, 4];
        let srcRegion: Uint8Array | null = null;
        if (neg) {
            const now = Date.now();
            if (negSeen !== navNegGen) { negSeen = navNegGen; NEG.clear(); REGIONS.length = 0; }
            for (let i = REGIONS.length - 1; i >= 0; i--) if (now - REGIONS[i]!.at > NAV_NEG_MS) REGIONS.splice(i, 1);
            const hit = NEG.get(nk);
            if (hit && now - hit.at <= NAV_NEG_MS) { NAV_EFFORT.negHits++; return hit.pts.map(t => ({ x: t.x, z: t.z })); }
            if (REGIONS.length) {
                const c = navgrid.cellOf(level, sx, sz);
                const r = REGIONS.find(q => q.level === level && inRegion(q.bits, c));
                // source in a known closed region: only an arrive whose goal box holds a region cell can succeed
                if (r) { srcRegion = r.bits; arrives = arrives.filter(a => nearRegion(r.bits, level, dx, dz, a)); if (!arrives.length) { NAV_EFFORT.regionHits++; skipNav = true; } }
            }
        }
        const t0 = performance.now();
        try {
            // fix 309e (SR_NAV_SHORT=0 reverts): a SHORT query (<= 16 tiles; q-lib walkOp's re-plan around npcs) whose exact
            // tile is cut off searched the whole mainland at arrive 0 (~0.4 s, 9 x in a row at Varrock, qze03m) before arrive 2
            // found the 2-tile route. Short queries first try every arrive with a 20k-expansion budget; the full searches run
            // only when none of those found a route (an arrive whose budgeted search exhausted its region is not repeated).
            if (!skipNav && NAV_SHORT && Math.max(Math.abs(dx - sx), Math.abs(dz - sz)) <= 16) {
                const done = new Set<number>();
                try {
                    for (const arrive of arrives) {
                        NAV_EFFORT.searches++;
                        const r = navgrid.planRoute(sx, sz, dx, dz, { level, roadPreference: 0, clearanceWeight: 0, arrive, maxExpansions: 20_000 });
                        if (r) return r.waypoints.map(w => ({ x: w.x, z: w.z }));
                        if (navgrid.LAST_SEARCH.exhausted) done.add(arrive);
                    }
                } catch { /* the full searches below meet the same error */ }
                arrives = arrives.filter(a => !done.has(a));
                if (!arrives.length) skipNav = true;
            }
            if (!skipNav) try {
                for (let k = 0; k < arrives.length; k++) {
                    const arrive = arrives[k]!;
                    NAV_EFFORT.searches++;
                    const r = navgrid.planRoute(sx, sz, dx, dz, { level, roadPreference: 0, clearanceWeight: 0, arrive, maxExpansions: 600_000 });
                    if (r) return r.waypoints.map(w => ({ x: w.x, z: w.z }));
                    const ls = navgrid.LAST_SEARCH;
                    // a region of < 1,000 cells may be a bot boxed in by temporary npc blocks: not remembered
                    if (neg && !srcRegion && ls.exhausted && ls.expansions >= 1000) {
                        const bits = navgrid.lastRegion();
                        if (bits) {
                            srcRegion = bits; if (REGIONS.length >= 6) REGIONS.shift(); REGIONS.push({ bits, level, at: Date.now() });
                            const rest = arrives.slice(k + 1), keep = rest.filter(a => nearRegion(bits, level, dx, dz, a));
                            NAV_EFFORT.skipped += rest.length - keep.length; arrives = [...arrives.slice(0, k + 1), ...keep];
                        }
                    }
                    if (NAV_ARRIVE_SKIP && ls.minDist > 4) { NAV_EFFORT.skipped += arrives.length - k - 1; break; }
                }
            } catch { /* fall through */ }
            // the navgrid found nothing: rsmod's path (it may end short; the caller checks the end), remembered for the next ask
            let out: Tile[] = [];
            try { out = pf.findLongPath(level, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z })); } catch { out = []; }
            if (neg) { if (NEG.size > 2000) NEG.clear(); NEG.set(nk, { at: Date.now(), pts: out.map(t => ({ x: t.x, z: t.z })) }); }
            return out;
        } finally { NAV_EFFORT.ms += performance.now() - t0; }
    };
    const showQ = (a: any[]) => JSON.stringify(a.slice(0, 5));
    const navFindPath = stallTimed('navFindPath', rawFindPath, a => `${showQ(a)} ls=${JSON.stringify(navgrid.LAST_SEARCH)}`);
    stallWatch();
    NAV = {
        findLongPath: stallTimed('findLongPath', (l: number, sx: number, sz: number, dx: number, dz: number, max = 500, blocked: Iterable<any> = []) => pf.findLongPath(l, sx, sz, dx, dz, max, blocked as any).map(w => ({ x: w.x, z: w.z })), showQ),
        findPathToLoc: stallTimed('findPathToLoc', (...a: any[]) => (pf.findPathToLoc as any)(...a).map((w: any) => ({ x: w.x, z: w.z })), showQ),
        reachedLoc: (...a: any[]) => (pf.reachedLoc as any)(...a),
        getDoorAt: pf.getDoorAt as any,
        planRoute: stallTimed('planRoute', navgrid.planRoute as any, showQ),
        planMultiLevel: stallTimed('planMultiLevel', planMultiLevel, a => JSON.stringify(a.slice(0, 2))), locForceApproach, navFindPath,
    };
    console.log(`[speedrun] pathfinding + navgrid + loc-scene ready in ${Date.now() - t0}ms`);
    return NAV;
}

/** Expand corner waypoints into 1-tile steps (the same interpolation the engine's takeStep walks). */
export function densify(corners: Tile[]): Tile[] {
    const out: Tile[] = [];
    for (let i = 0; i < corners.length; i++) {
        const c = corners[i]!;
        if (i === 0) { out.push({ x: c.x, z: c.z }); continue; }
        let { x, z } = out[out.length - 1]!;
        while (x !== c.x || z !== c.z) { x += Math.sign(c.x - x); z += Math.sign(c.z - z); out.push({ x, z }); }
    }
    return out;
}
/** Bounded flood fill (8-way, rsmod canTravel on the live map: doors are passable there) from `start` on `level`. Returns
 *  true only when the region is closed (< max tiles), does not contain `other`, and no loc on or next to it offers a way
 *  out (climb / enter / cross / jump / squeeze / board / go up|down / pass / exit / crawl / swing / walk). */
const PORTAL_OP = /climb|enter|cross|jump|squeeze|board|go[- ]?(up|down)|pass|exit|crawl|swing|walk|leave|descend|ascend|open|push|pull|search/i;
export function sealedFrom(level: number, start: Tile, other: Tile, max = 3000): boolean {
    const t0 = performance.now();
    try { return sealedFromRaw(level, start, other, max); } finally { stallNote('sealedFrom', performance.now() - t0, JSON.stringify([level, start, other])); }
}
function sealedFromRaw(level: number, start: Tile, other: Tile, max: number): boolean {
    const rs: any = rsmodSeal;
    const seen = new Set<string>(); const q: Tile[] = [start]; seen.add(`${start.x},${start.z}`);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (q.length) {
        const t = q.pop()!;
        if (t.x === other.x && t.z === other.z) return false;
        for (const [dx, dz] of dirs) {
            const k = `${t.x + dx!},${t.z + dz!}`;
            if (seen.has(k)) continue;
            let ok = false; try { ok = rs.canTravel(level, t.x, t.z, dx, dz, 1, 0, 0); } catch { ok = false; }
            if (!ok) continue;
            seen.add(k);
            if (seen.size > max) return false;
            q.push({ x: t.x + dx!, z: t.z + dz! });
        }
    }
    if (!locScene.isReady()) return false;
    const checked = new Set<string>();
    for (const k of seen) {
        const [x, z] = k.split(',').map(Number) as [number, number];
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const kk = `${x + dx},${z + dz}`; if (checked.has(kk)) continue; checked.add(kk);
            for (const l of locScene.getLocsAt(x + dx, z + dz, level, { includeUnnamed: true })) if (l.optionsWithIndex?.some(o => PORTAL_OP.test(o.text))) return false;
        }
    }
    return true;
}
/** Compress 1-tile steps (starting AFTER `from`) to turning points — what a MOVE packet carries. */
function turningPoints(from: Tile, steps: Tile[]): Tile[] {
    const out: Tile[] = [];
    let prev = from, dir = '';
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        const d = `${Math.sign(s.x - prev.x)},${Math.sign(s.z - prev.z)}`;
        if (i > 0 && d !== dir) out.push(prev);
        dir = d; prev = s;
    }
    if (steps.length) out.push(steps[steps.length - 1]!);
    return out;
}

// ---------------------------------------------------------------------------------------------------
// result types
// ---------------------------------------------------------------------------------------------------
export interface WalkResult { ok: boolean; ticks: number; tiles: number; replans: number; doors: number; energy: number; how: 'fast' | 'travel'; at: Tile; message?: string }
export interface OpResult { ok: boolean; ticks: number; message?: string; [k: string]: unknown }
export interface Stat { level: number; cur: number; xp: number; baseXp: number }
export interface Slot { slot: number; obj: number; count: number }
type ItemRef = number | string;

// ---------------------------------------------------------------------------------------------------
// SpeedBot
// ---------------------------------------------------------------------------------------------------
/** DEMO MODE (runner --demo): every staff cheat is refused HERE, before a packet is written. A run-day code path that
 *  still relied on a cheat fails loudly instead of silently doing nothing on the demo (where cheats are a no-op). */
export const CHEATS = { blocked: '' };
/** Demo accounts have real passwords: RUN_BOTS_DIR/<user>/bot.env PASSWORD= (run day on the demo); local/sim stays 'x'.
 *  (the demo checks the password, local engines do not) */
export function passwordOf(user: string): string {
    const dir = process.env.RUN_BOTS_DIR;
    if (!dir) return 'x';
    try { return readFileSync(`${dir}/${user}/bot.env`, 'utf8').match(/^PASSWORD=(.+)$/m)?.[1]?.trim() || 'x'; } catch { return 'x'; }
}
export class SpeedBot extends LeanBot {
    override sendCheat(cmd: string): void {
        if (CHEATS.blocked) throw new Error(`${CHEATS.blocked}: staff cheat refused (::${cmd}) for ${this.loginUser}`);
        super.sendCheat(cmd);
    }
    /** Glories (charged or used up) are scarce: only the Heroes' Guild fountain charges them. Never drop one; quests'
     *  "drop what we don't use" lists missed the uncharged amulet. SR_GLORY_GUARD=0 reverts. */
    gloryGuard = process.env.SR_GLORY_GUARD !== '0';
    override dropItem(obj: number, slot: number): void {
        if (this.gloryGuard && /^amulet_of_glory(_[1-4])?$/.test(objDebugName(obj))) {
            console.log(`[glory-guard] ${this.loginUser}: refused to drop ${objDebugName(obj)} (slot ${slot})`);
            return;
        }
        super.dropItem(obj, slot);
    }
    /** Eat on LeanBot's heal threshold (foodObj/healThreshold). Off by default. */
    autoEat = false;
    /** Let LeanBot's brain close stray main modals. Off: we own bank/shop/trade windows. */
    autoCloseModals = false;
    /** Leave chat dialogs alone (quest scripts answer them). Off: level-up pages are auto-continued. */
    holdDialogs = false;
    /** Ticks logged in at the start of this session (always 0) and the wall clock at login. */
    sessionStartMs = 0;
    private flushQueued = false;
    private bankcert = 0;
    private lastWalkSendTick = -100;
    /** Runtime loc overrides from the zone stream ("level,x,z" -> loc id now there). loc-scene is the
     *  STATIC map, so a felled tree / mined rock is only visible here. LOC_DEL restores the static loc. */
    readonly liveLocs = new Map<string, number>();
    /** Same keys as liveLocs, with the loc's shape/angle from the zone stream and the tick it was seen (LOC_DEL entries are
     *  dropped). A zone reset (UPDATE_ZONE_FULL_FOLLOWS) clears every entry in that zone from both maps. */
    readonly liveLocInfo = new Map<string, { id: number; shape: number; angle: number; tick: number }>();
    /** Wall open door leaves on the planner map from the zone stream (speedrun/leaf-walls.ts). SR_LEAF_WALLS=0 turns it off. */
    leafWalls = process.env.SR_LEAF_WALLS !== '0';
    /** sendRoute closes the wilderness warning (main 1908) before a MOVE (SR_WILD_WARNING_CLOSE=0 turns it off). */
    closeWildWarning = process.env.SR_WILD_WARNING_CLOSE !== '0';
    /** sendRoute continues objbox "You can now ..." unlock pages like level-up pages (SR_UNLOCK_CONTINUE=0 turns it off). */
    continueUnlockPages = process.env.SR_UNLOCK_CONTINUE !== '0';
    /** walkTo/travel give up at once ('no route') when neither the single-level planners nor planMultiLevel reach the goal,
     *  instead of handing LeanBot's traveller a goal it re-plans every tick at 100% CPU (SR_NOROUTE_BAIL=0 turns it off). */
    noRouteBail = process.env.SR_NOROUTE_BAIL !== '0';
    /** Wire the zone-stream loc tracking (door tracker, liveLocs/liveLocInfo, leaf walls, zone resets). create() calls it;
     *  tests that build a bot with `new SpeedBot()` call it themselves. Idempotent. */
    installLiveLocs(): void {
        if ((this as any).__liveLocs) return;
        (this as any).__liveLocs = true;
        if (!this.doorTracker) this.enableDoorTracker();
    }
    // The zone stream feeds liveLocs/liveLocInfo/leaf walls HERE (not through onLocZoneChange), so a quest that wraps or
    // replaces onLocZoneChange (south-lib locEvents, q-throne, q-fremennik, q-haunted-mine) can never cut the framework off.
    protected override fireLocZoneChange(level: number, x: number, z: number, locId: number, shape?: number, angle?: number): void {
        if ((this as any).__liveLocs) {
            const k = `${level},${x},${z}`;
            if (locId < 0) { const was = this.liveLocInfo.get(k); this.liveLocs.delete(k); this.liveLocInfo.delete(k); if (this.leafWalls) leafRemoved(this, level, x, z); if (was && isOpenLeaf(was.id, was.shape)) navNegClear(); }
            else {
                this.liveLocs.set(k, locId); this.liveLocInfo.set(k, { id: locId, shape: shape ?? -1, angle: angle ?? -1, tick: this.tickCount });
                if (this.leafWalls) leafAdded(this, level, x, z, locId, shape, angle);
            }
        }
        super.fireLocZoneChange(level, x, z, locId, shape, angle);
    }
    protected override fireZoneReset(level: number, zx: number, zz: number): void {
        if ((this as any).__liveLocs) {
            const x0 = zx & ~7, z0 = zz & ~7;
            for (const k of [...this.liveLocs.keys()]) {
                const [l, x, z] = k.split(',').map(Number);
                if (l === level && x! >= x0 && x! < x0 + 8 && z! >= z0 && z! < z0 + 8) { this.liveLocs.delete(k); this.liveLocInfo.delete(k); }
            }
            if (this.leafWalls) leafZoneReset(this, level, zx, zz);
            navNegClear();
        }
        super.fireZoneReset(level, zx, zz);
    }
    /** Feed one zone-stream loc event / zone reset by hand (tests, replays): the same path the decoder takes. */
    feedLocZoneChange(level: number, x: number, z: number, locId: number, shape?: number, angle?: number): void { this.fireLocZoneChange(level, x, z, locId, shape, angle); }
    feedZoneReset(level: number, zx: number, zz: number): void { this.fireZoneReset(level, zx, zz); }
    override destroy(): void { try { leafRelease(this); } catch { /* ignore */ } super.destroy(); }
    /** A chat page that blocks every MOVE/op and belongs to no conversation: a level-up page or an objbox unlock page. */
    blockingPageOpen(): boolean {
        const id = this.chatModalId;
        if (id === -1) return false;
        if (/^levelup_/.test(ifacePack().byId.get(id) ?? '')) return true;
        const textCom = OBJBOX_FIRST_LINE.get(id);
        if (textCom === undefined || !this.continueUnlockPages) return false;
        // the page's OWN text component (objbox1:com_1 = 308) only: a stale 'can now' left in another component made the route
        // runner page a quest objbox (Tourist Trap dart roll, qre1m) — route.ts tick hook, same rule
        return UNLOCK_TEXT.test(this.ifText.get(textCom) ?? '');
    }
    /** Is this static loc still the loc on its tile (not a stump / depleted rock / open door leaf)? */
    locAlive(l: { id: number; x: number; z: number; level?: number }): boolean {
        const v = this.liveLocs.get(`${l.level ?? this.minusedlevel},${l.x},${l.z}`);
        return v === undefined || v === l.id;
    }

    // ---- the inert brain ----------------------------------------------------------------------------
    protected override idleTick(): void { this.warm(); }
    protected override tryHeal(): boolean { return this.autoEat ? super.tryHeal() : false; }
    protected override handleMainModal(): boolean {
        if (this.autoCloseModals) return false;
        this.warm();
        return true;
    }
    protected override driveDialog(): void {
        if (this.holdDialogs) { this.warm(); return; }
        super.driveDialog();
    }

    // ---- login --------------------------------------------------------------------------------------
    /**
     * Log in (any local username auto-creates), start the packet loop, wait for the backpack, the
     * character-design accept and the tutorial skip, then turn run on. `nav:false` skips the ~8s
     * pathfinder init for scripts that never walk.
     */
    static async create(user: string, opts: { uid?: number; quiet?: boolean; nav?: boolean; timeoutMs?: number } = {}): Promise<SpeedBot> {
        const nav = opts.nav === false ? null : await initNav();
        const b = new SpeedBot();
        b.quiet = opts.quiet ?? true;
        b.uid = opts.uid ?? (900000 + [...user].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 90000, 7));
        if (nav) {
            b.findLongPathFn = nav.navFindPath;
            b.multiLevelPlanFn = (from, to, o) => nav.planMultiLevel(from, to, o);
        }
        b.installLiveLocs();
        if (!(await b.login(user, passwordOf(user)))) throw new Error(`login failed for ${user}`);
        b.sessionStartMs = Date.now();
        b.run(Number.MAX_SAFE_INTEGER).catch(e => { if (!b.disposed) console.error(`[speedrun] ${user}: run loop ended: ${(e as Error)?.message ?? e}`); });
        const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
        // fix 295a (qx41p, CONFIRMED: engine 'SINGLE DROP of qx41p' at tick 1091 while this loop waited; SIM_DET's tick(1)
        // only resolves on a server tick or dispose, so a socket closed here parked create() FOREVER, and the drop guard is
        // only attached after create returns): bound every tick wait by wall time and throw at once on a closed socket
        // (the drops.ts create retry matches 'socket ... closed' and logs in again). SR_CREATE_CLOSED=0 reverts.
        const F295 = process.env.SR_CREATE_CLOSED !== '0';
        const closedNow = () => F295 && !!(b as any).stream?.isClosed;
        const tick1 = () => F295 ? Promise.race([b.tick(1), sleep(250)]) : b.tick(1);
        const fail295 = (where: string) => { try { b.destroy(); } catch { /* gone */ } return new Error(`${user}: socket closed during login (${where})`); };
        // TEST (sim only): SR_CREATE_DROP_TEST=<regex> closes the socket inside this loop, once, on the Nth create() of a
        // matching account (SR_CREATE_DROP_TEST_N, default 1; the route's partner: 1 = supply staging, 2 = the runner login)
        const tre = process.env.SR_CREATE_DROP_TEST ? new RegExp(process.env.SR_CREATE_DROP_TEST, 'i') : null;
        const tk = user.toLowerCase(), tn = tre && tre.test(user) ? (createDropTested.get(tk) ?? 0) + 1 : 0;
        if (tn) createDropTested.set(tk, tn);
        if (tn && tn === Number(process.env.SR_CREATE_DROP_TEST_N ?? 1)) {
            console.log(`[speedrun] ${user}: SR_CREATE_DROP_TEST: closing the socket during the ready wait`);
            setTimeout(() => { try { (b as any).stream?.socket?.close?.(); } catch { /* gone */ } }, 1);
        }
        while (Date.now() < deadline) {
            if (b.backpack() && b.leftTutorial && b.mainModalId !== PLAYER_KIT_MODAL && b.localPlayer && b.tickCount > 2) break;
            if (closedNow()) throw fail295('ready wait');
            // SIM_DET=1 (offline sim, replayable runs): poll once per server tick, not every 50 ms of wall time (at ~100
            // ticks/s a 50 ms poll returned 0-5 ticks after the bot was ready, so the setup phase started on a random tick)
            if (SIM_DET) await tick1(); else await sleep(50);
        }
        if (closedNow()) throw fail295('ready wait');
        if (!b.backpack() || !b.leftTutorial) throw new Error(`${user}: not ready after login (backpack=${!!b.backpack()} leftTutorial=${b.leftTutorial})`);
        b.ensureRun();
        await tick1();
        if (closedNow()) throw fail295('after ready');
        if (process.env.SR_GLORY_LEDGER === '1') gloryLedger(b);
        return b;
    }

    /** Clean logout (publishes the hiscore row on the demo) and add this session's ticks to the ledger. */
    async logout(): Promise<{ state: string; ticks: number; totalTicks: number }> {
        // Logged-in ticks = PLAYER_INFOs seen since login + the ticks the logout itself took (the engine
        // keeps counting playtime until removePlayer). Accurate to about +-1 tick per session.
        const atPress = this.tickCount;
        // session 11 fix 376a (CONFIRMED qx248p: the scheduled ws 1012 at engine tick 1085 closed the partner's STAGING session
        // inside this logout (run-route supplyIntoBank `await p.logout()`; no P_LOGOUT reached the engine). Under SIM_DET,
        // requestCleanLogout waits with sendWait(1), whose tick waiter settles only on a server LOGOUT or destroy(), so the
        // logout never returned and its 15 s bound was never re-checked. The drop guard had already stepped aside
        // (intend('logout')), so there was no [drop] line and the run sat silent 55 min until killed by hand. Same class as
        // 295a/372a.) A closed socket (or 20 s without a LOGOUT ack) destroys the session: the parked waits settle and
        // requestCleanLogout returns 'dead'; the engine reaps the orphan player itself (idle logout after 500 t).
        // SR_LOGOUT_CLOSED=0 reverts. TEST (sim): SR_LOGOUT_DROP_TEST=<regex> closes the socket of the first logout of a
        // matching account just before the press (=0 + TEST reproduces the hang).
        const lu376 = this.loginUser.toLowerCase();
        const tre376 = process.env.SR_LOGOUT_DROP_TEST ? new RegExp(process.env.SR_LOGOUT_DROP_TEST, 'i') : null;
        if (tre376 && tre376.test(this.loginUser) && !logoutDropTested.has(lu376)) {
            logoutDropTested.add(lu376);
            console.log(`[speedrun] ${this.loginUser}: SR_LOGOUT_DROP_TEST: closing the socket before the logout press`);
            try { (this as any).stream?.socket?.close?.(); } catch { /* gone */ }
            for (let k = 0; k < 100 && !(this as any).stream?.isClosed; k++) await sleep(20);
        }
        let done376 = false;
        if (process.env.SR_LOGOUT_CLOSED !== '0') void (async () => {
            const w0 = Date.now();
            while (!done376 && !this.disposed && !(this as any).serverLogoutAt) {
                await sleep(250);
                if (done376 || this.disposed || (this as any).serverLogoutAt) return;
                const closed = !!(this as any).stream?.isClosed, late = Date.now() - w0 > 20_000;
                if (!closed && !late) continue;
                console.log(`[speedrun] ${this.loginUser}: logout: ${closed ? 'socket closed before the LOGOUT ack' : 'no LOGOUT ack in 20 s'}: dropping the session (fix 376a)`);
                try { this.destroy(); } catch { /* gone */ }
                return;
            }
        })();
        const r = await this.requestCleanLogout({ timeoutMs: 15_000 });
        done376 = true;
        const ticks = atPress + (r.state === 'published' ? Math.max(1, Math.round(r.ms / tickMs())) : 0);   // the live tick (400 ms), not 300
        const wallMs = Date.now() - this.sessionStartMs;
        const total = recordSession(this.loginUser, { ticks, wallMs, state: r.state, end: new Date().toISOString() });
        try { this.destroy(); } catch { /* already closed by the server */ }
        return { state: r.state, ticks, totalTicks: total };
    }
    /** Log out (accounted) and log the same account back in. Returns the NEW bot. */
    async relogin(opts: { uid?: number } = {}): Promise<SpeedBot> {
        const user = this.loginUser;
        await this.logout();
        await sleep(1500);   // the engine needs a couple of ticks to drop the old session
        return SpeedBot.create(user, { uid: opts.uid ?? this.uid, nav: NAV !== null });
    }

    // ---- ticks --------------------------------------------------------------------------------------
    /** Flush `out` on the next macrotask (after the caller's synchronous sends). */
    queueFlush(): void {
        if (this.flushQueued) return;
        this.flushQueued = true;
        setImmediate(() => {
            this.flushQueued = false;
            if (!this.disposed) { try { (this as any).flush(); } catch { /* socket gone */ } }
        });
    }
    /**
     * Resolve at the next `n` server ticks, AFTER that tick's whole update has been decoded.
     * ⛔ sendWait() wakes at PLAYER_INFO, but the engine writes inventory/stat/modal updates AFTER
     * player info (World.processClientsOut: players, npcs, zones, invs, stats, then modal changes),
     * and it sends EVERY PACKET AS ITS OWN WEBSOCKET FRAME (NetworkPlayer.writeInner), so they are
     * decoded across several macrotasks. Reading the backpack straight off sendWait sees the previous
     * tick's inventory, which makes every reaction one tick late. We wait `settleMs` (local: frames of
     * one cycle land within ~1 ms) and still answer well inside the window: measured, a packet sent up
     * to ~200 ms after the tick arrives is processed on the very next server cycle.
     */
    settleMs = SIM_SETTLE_MS;   // 25 ms live; 2 ms in the offline sim (engine SIM_LOCKSTEP=1: frames land within ~1 ms)
    async tick(n = 1): Promise<void> {
        this.queueFlush();
        await this.sendWait(n);
        if (SIM_FAST_IMM) await new Promise<void>(r => setImmediate(r)); else await sleep(this.settleMs);
        STALL_BOT = this.loginUser;   // fix 309x: name this bot in a stall line
        this.queueFlush();
    }
    /** Wait until `pred()` or `maxTicks`; true if the predicate held. Checks once per tick. */
    async until(pred: () => boolean, maxTicks: number): Promise<boolean> {
        const end = this.tickCount + maxTicks;
        while (!pred()) {
            if (this.tickCount >= end || this.disposed) return pred();
            await this.tick(1);
        }
        return true;
    }

    // ---- state --------------------------------------------------------------------------------------
    pos(): { x: number; z: number; level: number } { const t = this.tile(); return { x: t.x, z: t.z, level: this.minusedlevel }; }
    statIndex(skill: string | number): number {
        if (typeof skill === 'number') return skill;
        const i = (STAT_NAMES as readonly string[]).indexOf(skill.toLowerCase());
        if (i < 0) throw new Error(`unknown skill ${skill}`);
        return i;
    }
    /** level = base level (from xp), cur = boosted/drained level, xp = displayed xp, baseXp = xp / 25. */
    stat(skill: string | number): Stat {
        const i = this.statIndex(skill);
        const xp = this.statXp[i] ?? 0;
        return { level: Math.max(1, levelForDisplayedXp(xp)), cur: this.statLevel[i] ?? 0, xp, baseXp: xp / XP_RATE };
    }
    xpAll(): number[] { return STAT_NAMES.map((_, i) => this.statXp[i] ?? 0); }
    inv(): Slot[] { return this.backpackSlots(); }
    count(o: ItemRef): number { return this.countOf(objId(o)); }
    slot(o: ItemRef): number { return this.slotOf(objId(o)); }
    free(): number { return this.freePackSlots(); }
    private invTotal(): number { let n = 0; for (const s of this.inv()) n += s.count; return n; }
    private container(com: number): Slot[] {
        const c = this.invs.get(com); const out: Slot[] = [];
        if (!c) return out;
        for (let i = 0; i < c.ids.length; i++) if (c.ids[i]! > 0 && c.counts[i]! > 0) out.push({ slot: i, obj: c.ids[i]!, count: c.counts[i]! });
        return out;
    }

    // ---- low-level senders --------------------------------------------------------------------------
    /** Turn run on (also forced per-MOVE via the ctrl byte; this covers server-routed approaches). */
    ensureRun(): void { this.ifButton(RUN_ON_BUTTON); this.queueFlush(); }
    /**
     * One MOVE with up to 25 turning points. Returns the last tile sent.
     *
     * ⛔ THE START FIELD IS THE FIRST WAYPOINT, NOT OUR TILE. The real client (Client.ts tryMove) puts
     * the first TURNING POINT in startX/startZ and the rest as deltas from it; the engine queues the
     * start as waypoint 0 (MoveClickHandler). LeanBot's sendMove/sendMultiMove put the CURRENT tile
     * there, so the server's first step "walks" onto the tile it is already on — takeStep returns
     * [0,0], the walk step is consumed and the run step is skipped: ONE WASTED TICK PER MOVE PACKET
     * (measured: first step visible 2 ticks after the send instead of 1).
     */
    sendRoute(points: Tile[], opclick = false): Tile | null {
        // rev 289: an open level-up chat modal blocks movement (274 let you walk with it open). Level-ups are never part
        // of a held quest dialog, so continue past them before the MOVE (same flush). A1 sat 120 ticks at the Falador
        // teleport landing behind levelup_magic (the cast took magic 44->45).
        // (quest framework): the objbox "You can now ..." unlock page that follows a level-up blocks the same way
        // (troll lane: Ardougne Teleport took magic 58->59 and the walk sat at the landing), and the wilderness warning main
        // modal refuses every MOVE until closed (z 3512-3515, the walk stalled ~240 t). Continue / close them in the same flush.
        if (this.blockingPageOpen()) this.resumeDialogPage();
        if (this.closeWildWarning && this.mainModalId === WILD_WARNING_MODAL) { this.closeModal(); this.mainModalId = -1; }
        const me = this.tile();
        const chosen: Tile[] = [];
        for (const p of points) {
            if (chosen.length >= 25) break;
            if (p.x === me.x && p.z === me.z && chosen.length === 0) continue;
            if (chosen.length === 0) {
                if (cheb(p, me) > 100) break;              // engine rejects a start > 104 from us
            } else if (Math.abs(p.x - chosen[0]!.x) > 127 || Math.abs(p.z - chosen[0]!.z) > 127) break;
            chosen.push(p);
        }
        if (!chosen.length) return null;
        const s = chosen[0]!;
        this.out.p1Enc(opclick ? OP_MOVE_OPCLICK : OP_MOVE_GAMECLICK);
        this.out.p1(2 * (chosen.length - 1) + 5);
        this.out.p1(1);                                // ctrl held -> tempRun (runs while energy >= 1%)
        this.out.p2(s.x); this.out.p2(s.z);
        for (let i = 1; i < chosen.length; i++) { this.out.p1((chosen[i]!.x - s.x) & 0xff); this.out.p1((chosen[i]!.z - s.z) & 0xff); }
        this.lastWalkSendTick = this.tickCount;
        this.queueFlush();
        return chosen[chosen.length - 1]!;
    }
    /** Tick of the last CLOSE_MODAL sent. The engine only flags it (CloseModalHandler: requestModalClose) and closes the modal
     *  at the END of that cycle, so a protected click in the same tick (a teleport, a glory rub) still meets the open modal
     *  (Player.busy() = delayed || modal) and is silently dropped. q-lib tele()/afterModalClosed() wait it out. */
    lastCloseModalTick = -100;
    closeModal(): void {
        if (process.env.BANK_CLOSE_GUARD !== '0' && this.bankOpenRaw()) this.bankClosePending = true;   // see bankOpen()
        this.out.p1Enc(OP_CLOSE_MODAL); this.lastCloseModalTick = this.tickCount; this.queueFlush();
    }
    /** glory audit (session 7): glory changes within a few ticks of a cheat are sim STAGING, not trades */
    cheatTick = -1000;
    async cheat(cmd: string, ticks = 2): Promise<void> { if (process.env.SIM_PROF_CHEAT) console.log(`[cheat t${this.tickCount}] ${cmd}`); this.cheatTick = this.tickCount; this.sendCheat(cmd); this.queueFlush(); await this.tick(ticks); }

    /**
     * BURST: run every sender now and flush once. The engine executes up to 5 successful USER_EVENT
     * packets per player per tick and carries the rest to the next tick IN ORDER, so a whole inventory
     * of no-delay actions (gem cuts, arrow fletches, potion mixes) can be queued in one go.
     */
    burst(sends: Array<() => void>): void { for (const f of sends) f(); this.queueFlush(); }
    /** Drop every stack of these objs (burst), wait until gone. Returns ticks. */
    async dropAll(objs: ItemRef | ItemRef[], maxTicks = 20): Promise<number> {
        const ids = new Set((Array.isArray(objs) ? objs : [objs]).map(objId)
            .filter(id => !(this.gloryGuard && /^amulet_of_glory(_[1-4])?$/.test(objDebugName(id)))));   // refused by dropItem: don't wait on it
        const t0 = this.tickCount;
        const slots = this.inv().filter(s => ids.has(s.obj));
        if (!slots.length) return 0;
        this.burst(slots.map(s => () => this.dropItem(s.obj, s.slot)));
        await this.until(() => !this.inv().some(s => ids.has(s.obj)), maxTicks);
        return this.tickCount - t0;
    }

    // ---- walking ------------------------------------------------------------------------------------
    /**
     * Long-distance walk with run on. Plans with the server's own pathfinder (rsmod findLongPath: BFS,
     * Chebyshev-optimal, doors passable), sends <=24 turning points per MOVE and re-sends the next chunk
     * 4 tiles before the current one runs out (no stop at chunk seams). Closed doors on the route are
     * opened by MOVE_OPCLICK-to-the-door + OPLOC in the same tick. Re-plans after 3 stalled ticks; a door
     * that will not open is walled off for the re-plan. Falls back to LeanBot's multi-level traveller
     * for cross-level / cross-stratum trips or when the fast walker wedges.
     */
    /** walkToOnce + the opened-door rule: an opened door swings onto the next tile and walls it off, but the static
     *  collision the planners use has the door closed, so the walk "arrives" short (Witch's House: stuck behind
     *  door 1531 at 2902,3475). If we end short, close an adjacent OPEN door (sdk/navgrid/door-states.json) and retry. */
    // OPT-IN (closeDoors): R24/A5 both aborted at Lawgof with it always on (it shut a door that stands open by default).
    async walkTo(x: number, z: number, o: { level?: number; near?: number; maxTicks?: number; log?: boolean; closeDoors?: boolean } = {}): Promise<WalkResult> {
        let r = await this.walkToOnce(x, z, o);
        const near = o.near ?? 0, level = o.level ?? this.minusedlevel;
        for (let k = 0; o.closeDoors && k < 2 && (cheb(this.tile(), { x, z }) > near || this.minusedlevel !== level); k++) {
            if (!(await this.closeBlockingDoor())) break;
            r = await this.walkToOnce(x, z, o);
        }
        return r;
    }
    /** Close an OPEN door on/next to our tile (returns true if one was closed). */
    async closeBlockingDoor(): Promise<boolean> {
        const states = doorStates(), me = this.tile();
        for (const [key, id] of this.liveLocs) {
            const st = states[String(id)];
            if (!st || st.state !== 'open') continue;
            const [l, lx, lz] = key.split(',').map(Number);
            if (l !== this.minusedlevel || Math.max(Math.abs(lx! - me.x), Math.abs(lz! - me.z)) > 1) continue;
            this.opLoc(lx!, lz!, id, st.op ?? 1); this.queueFlush();
            await this.tick(3);
            return true;
        }
        return false;
    }
    private async walkToOnce(x: number, z: number, o: { level?: number; near?: number; maxTicks?: number; log?: boolean } = {}): Promise<WalkResult> {
        const nav = await initNav();
        const near = o.near ?? 0, maxTicks = o.maxTicks ?? 2000;
        const level = o.level ?? this.minusedlevel;
        const dest = { x, z };
        const t0 = this.tickCount;
        const me0 = this.tile();
        if (level !== this.minusedlevel || (me0.z > UNDERGROUND_Z) !== (z > UNDERGROUND_Z)) return this.travel(level, x, z, { near, maxTicks });
        let route: Tile[] | null = null, idx = 0, sentEndIdx = -1, replans = 0, doors = 0, stall = 0, lastKey = '';
        let doorOpTick = -100, doorOpKey = '', doorTries = 0;
        const blocked: any[] = [];
        while (true) {
            const me = this.tile();
            if (cheb(me, dest) <= near && (near > 0 || (me.x === x && me.z === z))) {
                return { ok: true, ticks: this.tickCount - t0, tiles: 0, replans, doors, energy: this.runEnergy, how: 'fast', at: me };
            }
            if (this.tickCount - t0 > maxTicks || this.disposed) {
                return { ok: false, ticks: this.tickCount - t0, tiles: 0, replans, doors, energy: this.runEnergy, how: 'fast', at: me, message: 'timeout' };
            }
            const key = `${me.x},${me.z}`;
            stall = key === lastKey ? stall + 1 : 0; lastKey = key;
            if (!route || (stall >= 3 && stall % 3 === 0)) {
                if (replans >= 6) {
                    if (!route && this.noRouteBail && this.unreachable(level, me, dest)) {
                        if (o.log !== false) console.log(`[speedrun] walkTo(${x},${z}) from (${me.x},${me.z}) L${level}: no route (planners + multi-level) -> giving up`);
                        return { ok: false, ticks: this.tickCount - t0, tiles: 0, replans, doors, energy: this.runEnergy, how: 'fast', at: me, message: 'no route' };
                    }
                    if (o.log !== false) console.log(`[speedrun] walkTo(${x},${z}) wedged at (${me.x},${me.z}) after ${replans} replans -> LeanBot traveller`);
                    const r = await this.travel(level, x, z, { near: Math.max(near, 1), maxTicks: maxTicks - (this.tickCount - t0) });
                    if (r.ok && near === 0) await this.stepTo(x, z);
                    return { ...r, ticks: this.tickCount - t0, replans, doors };
                }
                route = this.planWalk(nav, level, me, dest, near, blocked);
                replans++; idx = 0; sentEndIdx = -1;
                if (!route) { await this.tick(1); continue; }
            }
            // where are we on the route? (a run step covers 2 tiles; search a window, then everything)
            let j = -1;
            for (let i = Math.max(0, idx - 2); i < Math.min(route.length, idx + 10); i++) if (route[i]!.x === me.x && route[i]!.z === me.z) { j = i; break; }
            if (j < 0) j = route.findIndex(t => t.x === me.x && t.z === me.z);
            if (j < 0) { route = null; continue; }   // knocked off the route: re-plan from here
            idx = j;
            // first CLOSED door ahead (tracker = live server state; geometry from the collision index)
            let door: { i: number; x: number; z: number; locId: number; op: number } | null = null;
            for (let i = idx; i < Math.min(route.length - 1, idx + 14) && !door; i++) {
                const a = route[i]!, b = route[i + 1]!;
                for (const t of [a, b]) {
                    const cd = this.doorTracker?.closedDoorAt(level, t.x, t.z);
                    if (!cd) continue;
                    const geo = nav.getDoorAt(level, t.x, t.z);
                    if (geo && !stepCrossesDoorEdge(geo, a, b)) continue;
                    door = { i, x: t.x, z: t.z, locId: cd.locId, op: cd.op };
                    break;
                }
            }
            const segEnd = door ? door.i : route.length - 1;
            if (door && idx >= door.i) {
                const dk = `${door.x},${door.z}`;
                if (dk !== doorOpKey) { doorOpKey = dk; doorTries = 0; }
                if (this.tickCount - doorOpTick >= 4) {
                    if (doorTries >= 3) {   // will not open (locked/scripted): wall it off and re-plan
                        const geo = nav.getDoorAt(level, door.x, door.z);
                        if (geo) blocked.push(geo);
                        route = null; continue;
                    }
                    this.opLoc(door.x, door.z, door.locId, door.op); this.queueFlush();
                    doorOpTick = this.tickCount; doorTries++; doors++;
                }
                await this.tick(1);
                continue;
            }
            const remaining = sentEndIdx - idx;
            if (sentEndIdx < 0 || (sentEndIdx !== segEnd && remaining <= 4) || stall >= 2) {
                const steps = route.slice(idx + 1, segEnd + 1);
                const last = this.sendRoute(turningPoints(me, steps), !!door);
                if (last) {
                    sentEndIdx = route.findIndex((t, k) => k > idx && t.x === last.x && t.z === last.z);
                    if (door && sentEndIdx === segEnd) {   // whole approach fits: open the door on arrival
                        this.opLoc(door.x, door.z, door.locId, door.op);
                        doorOpTick = this.tickCount; doorOpKey = `${door.x},${door.z}`; doorTries = 1; doors++;
                    }
                }
            }
            await this.tick(1);
        }
    }

    private planWalk(nav: NonNullable<typeof NAV>, level: number, me: Tile, dest: Tile, near: number, blocked: any[]): Tile[] | null {
        let pts: Tile[] = [];
        // long trips: the navgrid (sdk/navgrid, door-aware chunk graph) plans the route — measured within 1-4% of
        // rsmod's optimum on the run's legs. Short hops, re-plans around walled-off doors, and anything the navgrid
        // cannot finish use rsmod's exact BFS.
        if (cheb(me, dest) > 48 && !blocked.length && process.env.SR_NAVGRID !== '0') {
            try { pts = nav.navFindPath(level, me.x, me.z, dest.x, dest.z); } catch { pts = []; }
            const ne = pts[pts.length - 1];
            if (ne && cheb(ne, dest) <= Math.max(near, 1)) { NAVGRID_STATS.navgrid++; return densify([{ x: me.x, z: me.z }, ...pts]); }
            pts = [];
        }
        NAVGRID_STATS.rsmod++;
        try { pts = nav.findLongPath(level, me.x, me.z, dest.x, dest.z, 500, blocked); } catch { pts = []; }
        let end = pts[pts.length - 1];
        if (!end || cheb(end, dest) > Math.max(near, 1)) {
            const alt = nav.navFindPath(level, me.x, me.z, dest.x, dest.z);
            const ae = alt[alt.length - 1];
            if (ae && (!end || cheb(ae, dest) < cheb(end, dest))) { pts = alt; end = ae; }
        }
        if (!pts.length) return null;
        return densify([{ x: me.x, z: me.z }, ...pts]);
    }

    /** `dest` is provably unreachable from `me` on `level`: no rsmod path, and the walkable region of `me` or of `dest`
     *  (bounded flood fill on the live planner map, doors passable) is CLOSED, does not hold the other end, and touches no
     *  loc a climb/enter/cross op could leave by. Anything it cannot prove (a big region, a portal-ish loc) = reachable, so the
     *  traveller keeps its old job. ~1-3 ms (planMultiLevel from a sealed tile took 216 s: never call it here). */
    private unreachable(level: number, me: Tile, dest: Tile): boolean {
        if (!NAV) return false;
        let pts: Tile[] = [];
        try { pts = NAV.findLongPath(level, me.x, me.z, dest.x, dest.z, 500); } catch { pts = []; }
        const e = pts[pts.length - 1];
        if (e && cheb(e, dest) <= 1) return false;
        return sealedFrom(level, me, dest) || sealedFrom(level, dest, me);
    }
    /** travel(): the start's region is closed and has no portal-ish loc (cannot leave this level/stratum by walking). */
    private multiLevelUnreachable(_level: number, me: Tile, dest: Tile): boolean { return sealedFrom(this.minusedlevel, me, dest); }

    /** LeanBot's proven multi-level traveller (ladders/stairs/portals), driven by its own brain. */
    async travel(level: number, x: number, z: number, o: { near?: number; maxTicks?: number } = {}): Promise<WalkResult> {
        const t0 = this.tickCount, near = Math.max(o.near ?? 2, 1);
        // max-QP session 7 (allchaos qt24m Legends: a walkTo from Karamja (2907,3192) to Edgeville wedged and handed over to
        // this traveller; planMultiLevel spun synchronously across the sea and the stall watchdog killed the run at qp 119):
        // islands have no walking route to the mainland: give up at once. SR_ISLAND_GUARD=0 reverts.
        const isl = (t: { x: number; z: number }) => t.z >= 6400 ? 'under' : (t.x >= 2740 && t.x <= 2970 && t.z >= 2870 && t.z <= 3235) ? 'karamja' : (t.x >= 2800 && t.x <= 2870 && t.z >= 3320 && t.z <= 3395) ? 'entrana' : (t.x >= 2810 && t.x <= 2870 && t.z >= 3220 && t.z <= 3310) ? 'crandor' : 'main';
        if (process.env.SR_ISLAND_GUARD !== '0' && isl(this.tile()) !== isl({ x, z }) && isl(this.tile()) !== 'under' && isl({ x, z }) !== 'under') {
            console.log(`[speedrun] travel(L${level} ${x},${z}) from (${this.tile().x},${this.tile().z}): ${isl(this.tile())} -> ${isl({ x, z })} has no walking route -> giving up`);
            return { ok: false, ticks: 0, tiles: 0, replans: 0, doors: 0, energy: this.runEnergy, how: 'travel', at: this.tile(), message: 'no route (island)' };
        }
        if (this.noRouteBail && NAV && this.multiLevelUnreachable(level, this.tile(), { x, z })) {
            console.log(`[speedrun] travel(L${level} ${x},${z}) from (${this.tile().x},${this.tile().z}) L${this.minusedlevel}: planMultiLevel has no route -> giving up`);
            return { ok: false, ticks: 0, tiles: 0, replans: 0, doors: 0, energy: this.runEnergy, how: 'travel', at: this.tile(), message: 'no route' };
        }
        this.travelDest = { x, z };
        this.travelLevel = level;
        this.mode = 'travel';                 // 'travel' switches on brain branch (e2) = doTravel()
        this.startMultiTravel(level, x, z);
        const done = () => this.minusedlevel === level && cheb(this.tile(), { x, z }) <= near;
        let ok = await this.until(() => done() || this.arrived, o.maxTicks ?? 3000);
        this.mode = 'idle';
        ok = done() || (ok && this.minusedlevel === level && cheb(this.tile(), { x, z }) <= 6);
        return { ok, ticks: this.tickCount - t0, tiles: 0, replans: 0, doors: 0, energy: this.runEnergy, how: 'travel', at: this.tile() };
    }

    /** Short exact move (one MOVE, server collision path). Returns ticks; false-y ok if not reached. */
    async stepTo(x: number, z: number, maxTicks = 30): Promise<OpResult> {
        const nav = await initNav();
        const t0 = this.tickCount;
        for (let attempt = 0; attempt < 3; attempt++) {
            const me = this.tile();
            if (me.x === x && me.z === z) return { ok: true, ticks: this.tickCount - t0 };
            const pts = nav.findLongPath(this.minusedlevel, me.x, me.z, x, z);
            this.sendRoute(turningPoints(me, densify([me, ...pts]).slice(1)));
            let last = '', still = 0;
            const ok = await this.until(() => {
                const t = this.tile(); const k = `${t.x},${t.z}`;
                still = k === last ? still + 1 : 0; last = k;
                return (t.x === x && t.z === z) || still >= 2;
            }, maxTicks);
            if (ok && this.tile().x === x && this.tile().z === z) return { ok: true, ticks: this.tickCount - t0 };
        }
        return { ok: false, ticks: this.tickCount - t0, message: `stuck at ${this.tile().x},${this.tile().z}` };
    }

    /**
     * Operate a loc from wherever we stand: MOVE_OPCLICK along the engine's own route to an
     * interaction-valid tile (rsmod findPathToLoc, footprint + forceapproach aware) plus the OPLOC, in
     * ONE tick. OPLOC alone never self-routes under clientRoutefinder (it is silently discarded from out
     * of reach), so this is the call to use for trees/rocks/fishing spots/altars/ranges. `op` may be an
     * index or a pattern over the loc's option text. Returns the path length in tiles (0 = in reach).
     */
    opLocReach(loc: locScene.SceneLoc, op: number | RegExp = 1): number {
        const nav = NAV;
        const opIndex = typeof op === 'number' ? op : (loc.optionsWithIndex.find(q => op.test(q.text))?.opIndex ?? 1);
        const me = this.tile(), level = this.minusedlevel;
        let tiles = 0;
        if (nav) {
            const fa = nav.locForceApproach(loc.id);
            if (!nav.reachedLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa)) {
                const path = nav.findPathToLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, 500, fa);
                const dense = densify([me, ...path]).slice(1);
                tiles = dense.length;
                if (dense.length) this.sendRoute(turningPoints(me, dense), true);
            }
        }
        this.opLoc(loc.x, loc.z, loc.id, opIndex);
        this.queueFlush();
        return tiles;
    }
    /** Nearest loc by name (loc-scene) within `radius`, optionally only those offering `op` text. */
    nearestLoc(pattern: RegExp, o: { radius?: number; op?: RegExp; exclude?: (l: locScene.SceneLoc) => boolean } = {}): locScene.SceneLoc | null {
        const me = this.tile();
        const all = locScene.findNearbyLocs(pattern, me.x, me.z, this.minusedlevel, o.radius ?? 15)
            .filter(l => this.locAlive(l) && (!o.op || l.optionsWithIndex.some(q => o.op!.test(q.text))) && !(o.exclude?.(l)));
        return all[0] ?? null;
    }

    // ---- banking ------------------------------------------------------------------------------------
    /** The bank as the client last saw it (mainModalId = bank, container known). Stale for a while after closeModal(): see bankOpen(). */
    bankOpenRaw(): boolean { return this.mainModalId === BANK_MODAL && !!this.invs.get(BANK_MAIN_INV); }
    /**
     * STALE BANK after a close. closeModal() only SENDS CLOSE_MODAL; mainModalId
     * stays on the bank until the server's IF_CLOSE comes back (CloseModalHandler -> requestModalClose -> Player.closeModal ->
     * refreshModalClose). In the lockstep sim that lands inside the caller's `tick(1)`; live it can be ticks later, so the next
     * openBank() saw "open", skipped the re-open, and every deposit/withdraw went to a closed bank (InvButtonHandler drops them
     * silently: live, a cook trip withdrew "0 raw" and loadouts warned "only 0/n" with the kit in the bank). So: after a close of
     * an open bank, bankOpen() is false until the close is seen (or BANK_CLOSE_WAIT ticks pass), and openBank() first waits for it.
     * BANK_CLOSE_GUARD=0 = the old behaviour.
     */
    bankOpen(): boolean {
        if (this.bankClosePending && (!this.bankOpenRaw() || this.tickCount - this.lastCloseModalTick > BANK_CLOSE_WAIT)) this.bankClosePending = false;
        return this.bankOpenRaw() && !this.bankClosePending;
    }
    bankClosePending = false;
    bankItems(): Slot[] { return this.container(BANK_MAIN_INV); }
    bankCount(o: ItemRef): number { const id = objId(o); let n = 0; for (const s of this.bankItems()) if (s.obj === id) n += s.count; return n; }

    /**
     * Open the nearest reachable bank booth (OPLOC2 "Use-quickly" = straight to @openbank) or banker
     * (OPNPC3 "Bank", ap range 2) within `radius`. Picks the target with the shortest server path, then
     * sends MOVE_OPCLICK + the op in ONE tick so the window opens on arrival.
     */
    async openBank(o: { radius?: number; maxTicks?: number; kind?: 'booth' | 'npc' | 'any'; skip?: Set<string> } = {}): Promise<OpResult> {
        const nav = await initNav();
        const t0 = this.tickCount;
        if (this.bankClosePending) {
            // our close is still in flight: let the server's IF_CLOSE arrive first, or the open op lands before the close and is undone
            await this.until(() => !this.bankOpenRaw(), BANK_CLOSE_WAIT);
            if (this.bankOpenRaw()) console.log(`[speedrun] ${this.loginUser}: bank close not confirmed after ${this.tickCount - t0} t, treating the bank as open`);
            this.bankClosePending = false;
        }
        if (this.bankOpen()) return { ok: true, ticks: 0 };
        const me = this.tile(), level = this.minusedlevel;
        type Cand = { kind: 'booth' | 'npc'; len: number; path: Tile[]; go: () => void; label: string };
        const cands: Cand[] = [];
        const kind = o.kind ?? 'any';
        if (kind !== 'npc') for (const b of locScene.findNearbyLocs(/^bank booth$/i, me.x, me.z, level, o.radius ?? 15)) {
            // ⛔ loc 2214 is ALSO named 'Bank booth' but has NO ops ("for private customers only", bank_booth.loc): an OPLOC on it is
            // DISCARDED by the server (ACK-NOACK-OPLOC). Catherby/Seers place 2214s next to the real 2213s, so the nearest 'Bank booth'
            // can be one (live acct23 crafting-10, sim rgcf/c3p04). Only booths with a Use-quickly/Use op count.
            const useOp = b.optionsWithIndex.find(q => /use-quickly/i.test(q.text)) ?? b.optionsWithIndex.find(q => /^use$/i.test(q.text));
            if (!useOp) continue;
            if (o.skip?.has(`booth ${b.id}@${b.x},${b.z}`)) continue;
            const op = useOp.opIndex;
            const fa = nav.locForceApproach(b.id);
            const reached = nav.reachedLoc(level, me.x, me.z, b.x, b.z, b.width, b.length, b.angle, b.shape, fa);
            const path = reached ? [] : nav.findPathToLoc(level, me.x, me.z, b.x, b.z, b.width, b.length, b.angle, b.shape, 500, fa);
            if (!reached && !path.length) continue;
            const end = path.length ? path[path.length - 1]! : me;
            if (!reached && !nav.reachedLoc(level, end.x, end.z, b.x, b.z, b.width, b.length, b.angle, b.shape, fa)) continue;
            const len = densify([me, ...path]).length - 1;
            cands.push({ kind: 'booth', len, path, label: `booth ${b.id}@${b.x},${b.z}`, go: () => this.opLoc(b.x, b.z, b.id, op) });
        }
        for (let i = 0; kind !== 'booth' && i < this.npcCount; i++) {
            const idx = this.npcIndices[i]!; const n = this.npcs[idx];
            if (!n || !/^banker$/i.test(locScene.npcName(n.typeId))) continue;
            const t = this.npcTileOf(n);
            if (cheb(t, me) > (o.radius ?? 15) || o.skip?.has(`banker npc ${idx}@${t.x},${t.z}`)) continue;
            const path = cheb(t, me) <= 2 ? [] : nav.findLongPath(level, me.x, me.z, t.x, t.z);
            const len = Math.max(0, densify([me, ...path]).length - 3);   // ap range 2: stops ~2 short
            cands.push({ kind: 'npc', len: len + 1, path, label: `banker npc ${idx}@${t.x},${t.z}`, go: () => this.opNpc(idx, 3) });
        }
        if (!cands.length) return { ok: false, ticks: 0, message: 'no bank booth/banker in range' };
        cands.sort((a, b) => a.len - b.len);
        const c = cands[0]!;
        for (let attempt = 0; attempt < 3 && !this.bankOpen(); attempt++) {
            const here = this.tile();
            if (c.path.length) this.sendRoute(turningPoints(here, densify([here, ...c.path]).slice(1)), true);
            c.go(); this.queueFlush();
            await this.until(() => this.bankOpen(), o.maxTicks ?? Math.ceil(c.len / 2) + 6);
        }
        if (!this.bankOpen() && cands.length > 1 && (o.skip?.size ?? 0) < 2) {
            // this target never answered: fall back to the next nearest booth/banker instead of failing on the same one
            console.log(`[speedrun] ${this.loginUser}: ${c.label} did not open the bank after ${this.tickCount - t0} t, trying the next booth/banker`);
            const r = await this.openBank({ ...o, skip: new Set([...(o.skip ?? []), c.label]) });
            return { ...r, ticks: this.tickCount - t0 };
        }
        this.bankcert = 0;   // @openbank resets %bankcert
        return { ok: this.bankOpen(), ticks: this.tickCount - t0, target: c.label };
    }

    /** Deposit every backpack stack except `except` (burst, one INV_BUTTON4 per distinct obj). */
    async depositAll(except: ItemRef[] = []): Promise<OpResult> {
        const t0 = this.tickCount;
        if (!this.bankOpen()) return { ok: false, ticks: 0, message: 'bank not open' };
        const keep = new Set(except.map(objId));
        const seen = new Set<number>(); const sends: Array<() => void> = [];
        for (const s of this.container(BANK_SIDE_INV)) {
            if (keep.has(s.obj) || seen.has(s.obj)) continue;
            seen.add(s.obj);
            sends.push(() => this.invButton(4, s.obj, s.slot, BANK_SIDE_INV));
        }
        if (!sends.length) return { ok: true, ticks: 0 };
        this.burst(sends);
        const ok = await this.until(() => !this.inv().some(s => seen.has(s.obj)), 10);
        return { ok, ticks: this.tickCount - t0, stacks: sends.length };
    }

    /**
     * Withdraw `n` (or 'all') of an obj; `noted` toggles the note button first (only when it differs).
     * 'all', or n >= free slots for an unnoted obj, uses withdraw-all (one packet); 1/5/10 use the
     * fixed buttons; anything else is withdraw-X + the count in the SAME tick.
     */
    async withdraw(o: ItemRef, n: number | 'all', opts: { noted?: boolean; maxTicks?: number } = {}): Promise<OpResult> {
        const t0 = this.tickCount;
        if (!this.bankOpen()) return { ok: false, ticks: 0, message: 'bank not open' };
        const id = objId(o);
        const bs = this.bankItems().find(s => s.obj === id);
        if (!bs) return { ok: false, ticks: 0, message: `${objDebugName(id)} not in bank` };
        const before = this.invTotal();
        this.queueWithdraw(id, bs.slot, n, opts.noted, this.free());
        this.queueFlush();
        const ok = await this.until(() => this.invTotal() > before, opts.maxTicks ?? 8);
        return { ok, ticks: this.tickCount - t0, got: this.invTotal() - before };
    }
    /** Write the withdraw packets (no wait). `free` = free slots the server will see when it runs. */
    private queueWithdraw(id: number, slot: number, n: number | 'all', noted: boolean | undefined, free: number): void {
        const want = noted ? 1 : 0;
        if (noted !== undefined && want !== this.bankcert) { this.ifButton(want ? BANK_NOTE_ON : BANK_NOTE_OFF); this.bankcert = want; }
        if (n === 'all' || (!noted && n >= free)) this.invButton(4, id, slot, BANK_MAIN_INV);
        else if (n === 1 || n === 5 || n === 10) this.invButton(n === 1 ? 1 : n === 5 ? 2 : 3, id, slot, BANK_MAIN_INV);
        else { this.invButton(5, id, slot, BANK_MAIN_INV); this.submitCountDialog(n); }
    }

    /**
     * Deposit-all (minus `except`) AND the withdrawals in ONE burst: the engine runs the packets in
     * order, so the withdrawals see the freed slots. Saves the separate withdraw tick. Withdrawals
     * address bank slots as seen at open; deposits of NEW obj types append after them, so those
     * slots stay valid.
     */
    async bankSwap(except: ItemRef[], withdrawals: Array<{ obj: ItemRef; n: number | 'all'; noted?: boolean }>, o: { maxTicks?: number } = {}): Promise<OpResult> {
        const t0 = this.tickCount;
        if (!this.bankOpen()) return { ok: false, ticks: 0, message: 'bank not open' };
        const keep = new Set(except.map(objId));
        const deposit = new Set<number>(); const sends: Array<() => void> = [];
        let free = 28;
        for (const s of this.container(BANK_SIDE_INV)) {
            if (keep.has(s.obj)) { free--; continue; }
            if (deposit.has(s.obj)) continue;
            deposit.add(s.obj);
            sends.push(() => this.invButton(4, s.obj, s.slot, BANK_SIDE_INV));
        }
        const wantIds: number[] = [];
        // Withdraw-X (any count but 1/5/10/all) opens a count dialog: two in one burst cross their counts (bank-mode sim
        // lane BKd: the K0 kit's 2,400 cannonballs became 2,400 antipoisons and filled the pack). One X per tick.
        const xSends: Array<() => void> = [];
        let xInMain = false;   // the first Withdraw-X rides the main burst, the rest go one per tick
        for (const w of withdrawals) {
            const id = objId(w.obj);
            const bs = this.bankItems().find(s => s.obj === id);
            if (!bs) return { ok: false, ticks: 0, message: `${objDebugName(id)} not in bank` };
            const f = free;
            const isX = w.n !== 'all' && !(!w.noted && w.n >= f) && w.n !== 1 && w.n !== 5 && w.n !== 10;
            const send = () => this.queueWithdraw(id, bs.slot, w.n, w.noted, f);
            // keep the order: the free-slot math above assumes every earlier withdrawal already ran (FB2: a deferred
            // maple X let the yew 'n >= free' turn into a Withdraw-All that filled the pack)
            if (xSends.length || (isX && xInMain)) xSends.push(send); else { sends.push(send); if (isX) xInMain = true; }
            // a stack takes ONE slot: counting 2,400 cannonballs as 22 slots made the next withdrawal a Withdraw-All
            // (the K0 kit's 2 antipoisons came out as 16: CB1 sim lane)
            const stack = (w.n as number) > 28 || /^cert_|(?<!blank)rune$|^coins$|arrow|^feather$|^thread$|^mcannonball$/.test(objDebugName(id));
            free -= w.noted || w.n === 'all' || stack ? 1 : Math.min(f, w.n as number);
            wantIds.push(w.noted ? certOf(id) : id);
        }
        // expected counts after the swap (a 'some' check passed early when the pack already held one: the bank closed
        // before the last deferred withdrawal landed, CB3 refill 5/6)
        const expect = new Map<number, number>();
        withdrawals.forEach((w, i) => { const id = wantIds[i]!; if (w.n !== 'all') expect.set(id, (expect.get(id) ?? (keep.has(id) ? this.count(id) : 0)) + (w.n as number)); });
        this.burst(sends);
        for (const x of xSends) { await this.tick(1); this.burst([x]); }
        const ok = await this.until(() => !this.inv().some(s => deposit.has(s.obj) && !wantIds.includes(s.obj)) && wantIds.every(id => this.count(id) > 0)
            && [...expect].every(([id, n]) => this.count(id) >= Math.min(n, this.count(id) + this.bankItems().filter(b => b.obj === id || certOf(b.obj) === id).reduce((a, b) => a + b.count, 0))), o.maxTicks ?? 10);
        return { ok, ticks: this.tickCount - t0, packets: sends.length };
    }
    /** Close the bank. Sends CLOSE_MODAL and returns at once (a following MOVE/op can share the tick). */
    closeBank(): void { this.closeModal(); }

    // ---- trading ------------------------------------------------------------------------------------
    private tradeSum(com: number): number { let n = 0; for (const s of this.container(com)) n += s.count; return n; }
    private async findPlayer(name: string, maxTicks: number): Promise<number> {
        let idx = this.findPlayerByName(name);
        if (idx < 0) await this.until(() => (idx = this.findPlayerByName(name)) >= 0, maxTicks);
        return idx;
    }

    /**
     * Helper side: trade `items` to `name`. Offers everything in one burst (INV_BUTTON4 for whole stacks,
     * INV_BUTTON5 + count for partial ones) followed by Accept in the same tick, then Confirm.
     */
    async giveTo(name: string, items: Array<{ obj: ItemRef; n: number | 'all' }>, o: { maxTicks?: number } = {}): Promise<OpResult> {
        const t0 = this.tickCount, maxTicks = o.maxTicks ?? 120;
        const idx = await this.findPlayer(name, 30);
        if (idx < 0) return { ok: false, ticks: this.tickCount - t0, message: `${name} not in scene` };
        const before = this.invTotal();
        let reqTick = -100, offered = false, acceptTick = -100, confirmTick = -100;
        while (this.tickCount - t0 < maxTicks && !this.disposed) {
            const m = this.mainModalId;
            if (m === TRADEMAIN) {
                if (!offered && this.invs.get(TRADESIDE_INV)) {
                    const sends: Array<() => void> = [];
                    for (const it of items) {
                        const id = objId(it.obj);
                        const slots = this.container(TRADESIDE_INV).filter(s => s.obj === id);
                        if (!slots.length) continue;
                        const total = slots.reduce((a, s) => a + s.count, 0);
                        if (it.n === 'all' || it.n >= total) sends.push(() => this.invButton(4, id, slots[0]!.slot, TRADESIDE_INV));
                        else { const n = it.n; sends.push(() => { this.invButton(5, id, slots[0]!.slot, TRADESIDE_INV); this.submitCountDialog(n); }); }
                    }
                    sends.push(() => this.ifButton(TRADEMAIN_ACCEPT));
                    this.burst(sends);
                    offered = true; acceptTick = this.tickCount;
                } else if (offered && this.tickCount - acceptTick >= 3) {
                    this.ifButton(TRADEMAIN_ACCEPT); this.queueFlush(); acceptTick = this.tickCount;
                }
            } else if (m === TRADECONFIRM) {
                if (this.tickCount - confirmTick >= 3) { this.ifButton(TRADECONFIRM_ACCEPT); this.queueFlush(); confirmTick = this.tickCount; }
            } else if (confirmTick >= 0) {
                if (this.invTotal() < before) return { ok: true, ticks: this.tickCount - t0, moved: before - this.invTotal() };
                if (this.tickCount - confirmTick > 4) return { ok: false, ticks: this.tickCount - t0, message: 'trade closed without moving items' };
            } else if (this.tickCount - reqTick >= 10) {
                const i2 = this.findPlayerByName(name);
                if (i2 >= 0) { this.opPlayer(i2, 4); this.queueFlush(); reqTick = this.tickCount; }
            }
            await this.tick(1);
        }
        return { ok: false, ticks: this.tickCount - t0, message: 'timeout' };
    }

    /**
     * Trainee side: trade with `name` and accept whatever is offered (both screens). Fires its own
     * trade request at once when `name` is visible (a mutual request opens the window a tick sooner),
     * accepts as soon as the offer is non-empty and re-accepts whenever it changes.
     */
    async acceptTradeFrom(name: string, o: { maxTicks?: number; maxDist?: number } = {}): Promise<OpResult> {
        // maxDist: only fire our OPPLAYER4 while `name` stands within this many tiles. OPPLAYER4 self-routes
        // (engine SMART path toward the target, re-planned every tick), so asking a player who is merely IN SCENE drags us
        // after it — live, the cannon buyer left Nulodion's meet tile chasing acct3 and ended 26 tiles away.
        const t0 = this.tickCount, maxTicks = o.maxTicks ?? 120, maxDist = o.maxDist ?? Infinity;
        const before = this.invTotal();
        let reqTick = -100, acceptedSig = '', confirmTick = -100;
        while (this.tickCount - t0 < maxTicks && !this.disposed) {
            const m = this.mainModalId;
            if (m === TRADEMAIN) {
                const offer = this.container(TRADEMAIN_OTHERINV);
                const sig = offer.map(s => `${s.obj}x${s.count}`).join(',');
                if (offer.length && sig !== acceptedSig) { this.ifButton(TRADEMAIN_ACCEPT); this.queueFlush(); acceptedSig = sig; }
            } else if (m === TRADECONFIRM) {
                if (this.tickCount - confirmTick >= 3) { this.ifButton(TRADECONFIRM_ACCEPT); this.queueFlush(); confirmTick = this.tickCount; }
            } else if (confirmTick >= 0) {
                if (this.invTotal() > before) return { ok: true, ticks: this.tickCount - t0, got: this.invTotal() - before };
                if (this.tickCount - confirmTick > 4) return { ok: false, ticks: this.tickCount - t0, message: 'trade closed with nothing received' };
            } else if (this.tickCount - reqTick >= 10) {
                const i2 = this.findPlayerByName(name);
                if (i2 >= 0 && this.distanceToPlayer(i2) <= maxDist) { this.opPlayer(i2, 4); this.queueFlush(); reqTick = this.tickCount; }
            }
            await this.tick(1);
        }
        return { ok: false, ticks: this.tickCount - t0, message: 'timeout' };
    }
    /** The tile of a visible player (case-insensitive name), or null when not in scene. */
    playerTileByName(name: string): Tile | null {
        const i = this.findPlayerByName(name);
        return i >= 0 ? this.playerWorldTile(i) : null;
    }

    // ---- magic --------------------------------------------------------------------------------------
    /** Click a self-cast spell (teleports, Charge, Bones to Bananas...). Waits for the teleport/xp. */
    async castOnSelf(spell: string, o: { maxTicks?: number } = {}): Promise<OpResult> {
        const t0 = this.tickCount, com = spellCom(spell);
        const p0 = this.pos(), xp0 = this.statXp[6] ?? 0;
        const isTele = /teleport/i.test(spell);
        this.ifButton(com); this.queueFlush();
        let xpTick = -1;
        const ok = await this.until(() => {
            if (xpTick < 0 && (this.statXp[6] ?? 0) > xp0) xpTick = this.tickCount - t0;
            const moved = cheb(this.tile(), p0) > 8 || this.minusedlevel !== p0.level;
            return isTele ? moved : xpTick >= 0 || moved;
        }, o.maxTicks ?? 12);
        return { ok, ticks: this.tickCount - t0, xpTick, at: this.pos(), xp: (this.statXp[6] ?? 0) - xp0 };
    }
    teleport(spell: string, o: { maxTicks?: number } = {}): Promise<OpResult> { return this.castOnSelf(spell, o); }
    /** Cast on a backpack item (alchemy, superheat, enchant). Resolves on the magic-xp drop. */
    async castOnItem(spell: string, o: ItemRef, opts: { maxTicks?: number } = {}): Promise<OpResult> {
        const t0 = this.tickCount, com = spellCom(spell), id = objId(o);
        const slot = this.slotOf(id);
        if (slot < 0) return { ok: false, ticks: 0, message: `${objDebugName(id)} not held` };
        const xp0 = this.statXp[6] ?? 0;
        this.opHeldT(id, slot, com); this.queueFlush();
        const ok = await this.until(() => (this.statXp[6] ?? 0) > xp0, opts.maxTicks ?? 8);
        return { ok, ticks: this.tickCount - t0, xp: (this.statXp[6] ?? 0) - xp0 };
    }
}

// ---------------------------------------------------------------------------------------------------
// session accounting (logged-in ticks per account) — logs/speedrun/sessions.json
// ---------------------------------------------------------------------------------------------------
const SESSIONS = resolve(LOG_DIR, 'sessions.json');
export function recordSession(user: string, s: { ticks: number; wallMs: number; state: string; end: string }): number {
    mkdirSync(LOG_DIR, { recursive: true });
    let db: Record<string, { totalTicks: number; sessions: Array<typeof s> }> = {};
    try { if (existsSync(SESSIONS)) db = JSON.parse(readFileSync(SESSIONS, 'utf8')); } catch { db = {}; }
    const k = user.toLowerCase();
    const row = db[k] ?? { totalTicks: 0, sessions: [] };
    row.sessions.push(s);
    row.totalTicks += s.ticks;
    db[k] = row;
    writeFileSync(SESSIONS, JSON.stringify(db, null, 1));
    return row.totalTicks;
}
export function sessionTicks(user: string): number {
    try { return JSON.parse(readFileSync(SESSIONS, 'utf8'))[user.toLowerCase()]?.totalTicks ?? 0; } catch { return 0; }
}

// ---------------------------------------------------------------------------------------------------
// legs: run + measure + log (logs/speedrun/legs.jsonl)
// ---------------------------------------------------------------------------------------------------
export interface LegRecord {
    leg: string; user: string; startTick: number; endTick: number; ticks: number; wallMs: number;
    xp: Record<string, number>; baseXpPerTick: Record<string, number>; levels: Record<string, string>;
    ok: boolean; error?: string; result?: unknown; at: string;
}
export async function runLeg<T>(bot: SpeedBot, name: string, fn: (bot: SpeedBot) => Promise<T>): Promise<{ result?: T; rec: LegRecord }> {
    const xp0 = bot.xpAll(), lv0 = STAT_NAMES.map((_, i) => bot.stat(i).level);
    const t0 = bot.tickCount, w0 = Date.now();
    let result: T | undefined, error: string | undefined;
    try { result = await fn(bot); } catch (e) { error = (e as Error)?.stack ?? String(e); }
    const ticks = bot.tickCount - t0;
    const xp: Record<string, number> = {}, rate: Record<string, number> = {}, levels: Record<string, string> = {};
    bot.xpAll().forEach((v, i) => {
        const d = v - xp0[i]!;
        if (d <= 0) return;
        const n = STAT_NAMES[i]!;
        xp[n] = d;
        rate[n] = +(d / XP_RATE / Math.max(1, ticks)).toFixed(3);
        levels[n] = `${lv0[i]}->${bot.stat(i).level}`;
    });
    const rec: LegRecord = { leg: name, user: bot.loginUser, startTick: t0, endTick: bot.tickCount, ticks, wallMs: Date.now() - w0,
        xp, baseXpPerTick: rate, levels, ok: !error, error, result: result as unknown, at: new Date().toISOString() };
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(resolve(LOG_DIR, 'legs.jsonl'), JSON.stringify(rec) + '\n');
    console.log(`[leg] ${name}: ${ticks} ticks${error ? ' FAILED' : ''} | ` +
        Object.entries(xp).map(([k, v]) => `${k} +${v} (${rate[k]} base/tick, ${levels[k]})`).join(' | '));
    if (error) console.error(error);
    return { result, rec };
}

/**
 * LOCAL ONLY. Apply stats / items / position by staff cheat, paced 2 ticks apart (the engine drops
 * back-to-back cheats), then verify. `clear:true` drops the current backpack first.
 */
const TEST_GIVEN: SpeedBot[] = [];
/** SR_GLORY_LEDGER=1: per ACCOUNT, count glory rubs (a held/worn glory loses a charge), glories in/out of
 *  the bank, and glories in/out otherwise (trade, staging cheat, death). One `[glory-ledger]` line per event, a summary per
 *  account at exit. Covers every SpeedBot session (relogs add to the same account row); LeanBot driver sessions are not seen. */
export type GloryRow = { start: string; rubs: number; bankIn: number; bankOut: number; otherIn: number; otherOut: number; end: string;
    stageIn: number; deathOut: number; recharged?: number; held: number[]; bank: number[] | null; bankSeen: string; lastSeen: string;
    outs: Array<{ c: number[]; at: string; death: boolean }>; ins: Array<{ c: number[]; at: string }> };
export const GLORY_LEDGER: Record<string, GloryRow> = {};
const GL_NAMES = ['amulet_of_glory', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'];
const glFmt = (c: number[]) => GL_NAMES.map((n, i) => c[i] ? `${n.replace('amulet_of_', '')}x${c[i]}` : '').filter(Boolean).join(' ') || 'none';
/** Reconcile the ledger at exit. Per account: start = staged (cheat) + trades in;
 *  end = held/worn + the bank as last seen open; every glory that left an account other than by the bank must arrive at
 *  another of ours (a trade), else it is LOST (death losses flagged apart). Rubs only move charges (glory_4 -> _3 ...). */
export function gloryAudit(): { ok: boolean; lines: string[] } {
    const lines: string[] = []; let lost = 0, deathLost = 0, heldEnd = 0;
    const items = (c: number[]) => c.reduce((a, v) => a + v, 0);
    // pool every non-bank in/out across accounts; an out matched by an in (any account, same charge) is a hand-off
    const ins = Object.entries(GLORY_LEDGER).flatMap(([u, r]) => r.ins.flatMap(e => e.c.flatMap((n, i) => Array(n).fill({ u, i, at: e.at }))));
    // A partner's trade-ins at an open bank get booked as bank traffic, so the other side's outs stay unmatched and read as
    // LOST while the partner's bank holds that many more than booked. So an unmatched out may be matched by another
    // account's bank SURPLUS (held+bank above its booked flows) = it went straight into our bank
    const surplus = new Map<string, number>();
    for (const [u, r] of Object.entries(GLORY_LEDGER)) { if (!r.bank) continue; const e2 = r.held.reduce((a, v, i) => a + v + r.bank![i]!, 0); const x = e2 - (r.stageIn + r.otherIn - r.otherOut); if (x > 0) surplus.set(u, x); }
    let toBank = 0;
    for (const [u, r] of Object.entries(GLORY_LEDGER)) {
        for (const e of r.outs) e.c.forEach((n, i) => { for (let k = 0; k < n; k++) {
            const j = ins.findIndex(x => x.i === i && x.u !== u); if (j >= 0) { ins.splice(j, 1); continue; }
            const sb = [...surplus.entries()].find(([v, x]) => v !== u && x > 0);
            if (sb && !e.death) { surplus.set(sb[0], sb[1] - 1); toBank++; continue; }
            if (e.death) { deathLost++; lines.push(`[glory-audit] DEATH-LOST ${u}: ${GL_NAMES[i]} at ${e.at}`); }
            else { lost++; lines.push(`[glory-audit] LOST ${u}: ${GL_NAMES[i]} last seen ${e.at}`); }
        } });
        const bank = r.bank ?? [0, 0, 0, 0, 0], end = r.held.map((v, i) => v + bank[i]!);
        const expect = r.stageIn + r.otherIn - r.otherOut;
        heldEnd += items(r.held);
        lines.push(`[glory-audit] ${u}: start staged ${r.stageIn} + in ${r.otherIn} - out ${r.otherOut} (death ${r.deathOut}) = ${expect} | end held ${glFmt(r.held)} + bank ${r.bank ? glFmt(bank) : 'never seen'}${r.bankSeen ? ` (${r.bankSeen})` : ''} = ${items(end)} | rubs ${r.rubs}${r.recharged ? ` | recharged ${r.recharged}` : ''}${items(end) !== expect && r.bank ? ' | MISMATCH' : ''}`);
        if (r.bank && items(end) > expect) lines.push(`[glory-audit] NOTE ${u}: ${items(end) - expect} more than booked (a bank deposit the ledger saw as bank traffic, e.g. trade-in at an open bank)`);
        if (r.bank && items(end) < expect) { lost += expect - items(end); lines.push(`[glory-audit] LOST ${u}: ${expect - items(end)} unaccounted (held+bank ${items(end)} < ${expect}), last seen ${r.lastSeen}`); }
        if (items(r.held)) lines.push(`[glory-audit] HELD-AT-END ${u}: ${glFmt(r.held)} at ${r.lastSeen} (not banked)`);
    }
    if (toBank) lines.push(`[glory-audit] NOTE ${toBank} hand-off(s) matched by a bank surplus on another of our accounts (trade-in booked as bank traffic)`);
    lines.push(lost === 0 ? `[glory-audit] OK (${Object.keys(GLORY_LEDGER).length} accounts, death-lost ${deathLost}, held at end ${heldEnd})` : `[glory-audit] LOST ${lost} (death-lost ${deathLost} apart, held at end ${heldEnd})`);
    return { ok: lost === 0, lines };
}
function gloryLedger(b: SpeedBot): void {
    const IDS = GL_NAMES.map(n => objId(n));
    const CERTS = IDS.map(id => certOf(id));
    const snap = () => IDS.map((id, i) => Math.max(0, b.count(id)) + Math.max(0, b.ackWornCount(id)) + (CERTS[i]! > 0 ? Math.max(0, b.count(CERTS[i]!)) : 0));
    const bankSnap = () => IDS.map(id => b.bankCount(id));
    const fmt = glFmt;
    const user = b.loginUser;
    let prev = snap(), lastTick = b.tickCount, lastHp0 = -1000, stableKey = prev.join(','), lastBankTick = -1000, lastTradeTick = -1000;
    const fresh = !GLORY_LEDGER[user];
    const row = GLORY_LEDGER[user] ??= { start: fmt(prev), rubs: 0, bankIn: 0, bankOut: 0, otherIn: 0, otherOut: 0, end: fmt(prev), stageIn: 0, deathOut: 0, held: prev, bank: null, bankSeen: '', lastSeen: '', outs: [], ins: [] };
    // a relog: the held/worn glories it logged out with are the ones it logs in with (prev = row.held, no event)
    if (fresh && prev.some(v => v > 0)) { row.stageIn += prev.reduce((a, v) => a + v, 0); }
    // a relog after a session the ledger does not see (LeanBot drivers: Lost City banks its pack at Draynor): the difference is
    // booked as bank traffic (the end check reads the bank as last seen, so a real loss still shows there)
    if (!fresh && prev.some((v, i) => v !== row.held[i])) {
        const d = prev.map((v, i) => v - row.held[i]!);
        row.bankOut += d.reduce((a, v) => a + Math.max(0, v), 0); row.bankIn += d.reduce((a, v) => a + Math.max(0, -v), 0);
        console.log(`[glory-ledger] ${user} t${b.tickCount} unseen session: ${glFmt(row.held)} -> ${glFmt(prev)} (booked as bank)`);
        row.held = prev; row.end = glFmt(prev);
    }
    if (Object.keys(GLORY_LEDGER).length === 1) process.on('exit', () => {
        for (const [u, r] of Object.entries(GLORY_LEDGER)) console.log(`[glory-ledger] SUMMARY ${u}: start ${r.start} | rubs ${r.rubs} | bank in ${r.bankIn} out ${r.bankOut} | other in ${r.otherIn} out ${r.otherOut} | staged ${r.stageIn} | end ${r.end}`);
        for (const l of gloryAudit().lines) console.log(l);
    });
    const iv = setInterval(() => {
        if (b.disposed) { clearInterval(iv); return; }
        if (b.tickCount === lastTick || !b.backpack()) return;
        lastTick = b.tickCount;
        if (b.stat('hitpoints').cur <= 0) lastHp0 = b.tickCount;
        const at = `${b.tile().x},${b.tile().z},${b.minusedlevel} t${b.tickCount}`;
        if (b.bankOpen()) lastBankTick = b.tickCount;
        // session 8 (qt33 staging, 3 glories per trade with a deposit between: 57 trade-ins booked as 'bank in' because the
        // bank had been open < 8 t before): a change within 4 t of a trade screen is a trade, never bank traffic
        if (b.mainModalId === TRADEMAIN || b.mainModalId === TRADECONFIRM) lastTradeTick = b.tickCount;
        const bankRecent = b.tickCount - lastBankTick <= 8, tradeRecent = b.tickCount - lastTradeTick <= 4;   // the debounce books a change a few ticks late (qt23fd: 4)
        if (b.bankOpen() && b.bankItems().length) { row.bank = bankSnap(); row.bankSeen = `bank seen at ${at}`; }
        const cur = snap();
        if (cur.some(v => v > 0)) row.lastSeen = `${fmt(cur)} at ${at}`;
        // debounce (qt23 audit: 5 phantom 'other in x1' at wear/unwear moments: the pack and the worn slot update on
        // different ticks, so a glory counted twice for one tick): book a change only once it held 2 ticks in a row
        const key = cur.join(',');
        if (key !== stableKey) { stableKey = key; return; }
        if (cur.every((v, i) => v === prev[i])) return;
        const items = (c: number[]) => c.reduce((a, v) => a + v, 0), charges = (c: number[]) => c.reduce((a, v, i) => a + v * i, 0);
        const dItems = items(cur) - items(prev), dCh = charges(cur) - charges(prev);
        let ev: string;
        const inC = cur.map((v, i) => Math.max(0, v - prev[i]!)), outC = cur.map((v, i) => Math.max(0, prev[i]! - v));
        const inN = items(inC), outN = items(outC);
        const bank = bankRecent && !(tradeRecent && inN > 0 && outN === 0);
        if (!bank && dItems === 0 && dCh < 0) { row.rubs += -dCh; ev = `rub x${-dCh}`; }
        // the Heroes' fountain recharges in place (fountain_of_heroes.rs2: inv_setslot -> glory_4): same items, more charges
        else if (!bank && dItems === 0 && dCh > 0) { row.recharged = (row.recharged ?? 0) + inN; ev = `recharged x${inN}`; }
        else if (bank) { row.bankIn += inN; row.bankOut += outN; ev = `bank in x${inN} out x${outN}`; }
        else if (inN && b.tickCount - b.cheatTick <= 6) { row.stageIn += inN; ev = `staged x${inN}`; if (outN) { row.otherOut += outN; row.outs.push({ c: outC, at, death: false }); } }
        else {
            const death = b.tickCount - lastHp0 <= 8;
            row.otherIn += inN; row.otherOut += outN; if (death) row.deathOut += outN;
            if (inN) row.ins.push({ c: inC, at }); if (outN) row.outs.push({ c: outC, at, death });
            ev = `other in x${inN} out x${outN}${death ? ' (DEATH)' : ''}`;
        }
        row.end = fmt(cur); row.held = cur;
        console.log(`[glory-ledger] ${user} t${b.tickCount} ${ev}: ${fmt(prev)} -> ${fmt(cur)} at ${b.tile().x},${b.tile().z}`);
        prev = cur;
    }, 20);
}
export async function localSetup(bot: SpeedBot, s: { stats?: Record<string, number>; items?: Array<{ name: string; n: number }>; tele?: { x: number; z: number; level?: number }; clear?: boolean }): Promise<void> {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) throw new Error('localSetup refuses to run unless LC_HOST is localhost');
    if (CHEATS.blocked && (s.stats || s.items?.length || s.tele)) throw new Error(`${CHEATS.blocked}: localSetup refused for ${bot.loginUser} (${JSON.stringify(s).slice(0, 120)})`);
    if (s.clear) { const objs = [...new Set(bot.inv().map(x => x.obj))]; if (objs.length) await bot.dropAll(objs); }
    for (const [skill, lvl] of Object.entries(s.stats ?? {})) {
        const i = bot.statIndex(skill);
        for (let k = 0; k < 3 && bot.stat(i).level !== lvl; k++) { await bot.cheat(`setstat ${skill} ${lvl}`); await bot.until(() => bot.stat(i).level === lvl, 3); }
    }
    for (const it of s.items ?? []) {
        const id = objId(it.name), want = bot.count(id) + it.n;
        for (let k = 0; k < 3 && bot.count(id) < want; k++) { await bot.cheat(`give ${objDebugName(id)} ${it.n}`); await bot.until(() => bot.count(id) >= want, 3); }
    }
    if (s.tele && process.env.SR_TEST_GIVE && !TEST_GIVEN.includes(bot)) {
        // TEST ONLY (sim launchers): SR_TEST_GIVE="amulet_of_glory:1,amulet_of_glory_4:1" gives these once, at the launcher's
        // final setup teleport, and prints what is still held/worn at exit ([test-give] lines). Off unless set.
        TEST_GIVEN.push(bot);
        for (const p of process.env.SR_TEST_GIVE.split(',')) {
            const [name, n] = p.split(':'); const id = objId(name!), want = bot.count(id) + Number(n ?? 1);
            for (let k = 0; k < 3 && bot.count(id) < want; k++) { await bot.cheat(`give ${objDebugName(id)} ${n ?? 1}`); await bot.until(() => bot.count(id) >= want, 3); }
        }
        console.log(`[test-give] ${bot.loginUser} gave ${process.env.SR_TEST_GIVE}: pack ${bot.inv().map(x => objDebugName(x.obj)).join(',')}`);
        if (TEST_GIVEN.length === 1) process.on('exit', () => {
            for (const b of TEST_GIVEN) console.log(`[test-give] ${b.loginUser} at exit: ` + process.env.SR_TEST_GIVE!.split(',').map(p => {
                const id = objId(p.split(':')[0]!); return `${objDebugName(id)} held ${b.count(id)} worn ${b.ackWornCount(id)}`;
            }).join(', '));
        });
    }
    if (s.tele) {
        const { x, z } = s.tele, l = s.tele.level ?? 0;
        for (let k = 0; k < 3 && cheb(bot.tile(), { x, z }) > 0; k++) { await bot.cheat(`tele ${l},${x >> 6},${z >> 6},${x & 63},${z & 63}`); await bot.until(() => cheb(bot.tile(), { x, z }) === 0, 4); }
    }
}

export { cheb, sleep };

/**
 * Is the single step (x,z) -> (x2,z2) (an ADJACENT tile) open in this process's rsmod collision? The legs ask this as
 * `p = nav.findLongPath(level, x, z, x2, z2, 3); p.length === 1 && p[0] is (x2,z2)`: a shortest path to an adjacent tile
 * is that one step exactly when the step is legal, and otherwise has >= 2 turning points (or none). Same answer, but the
 * BFS floods the whole reachable region when the step is walled (measured 20.8 ms per call; f2p-b syncLeaves re-asks it
 * every 4 ticks while walking: 70% of the Shield of Arrav client's CPU). SIM_FAST asks rsmod.canTravel (the BFS's own step
 * rule, CollisionType.NORMAL, size 1) instead; SIM_FAST_CHECK computes both and reports a mismatch.
 */
export const STEP_STATS = { fast: 0, bfs: 0, mismatch: 0 };
export function stepOpen(level: number, x: number, z: number, x2: number, z2: number): boolean {
    const dx = x2 - x, dz = z2 - z;
    const adj = Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && (dx !== 0 || dz !== 0);
    const bfs = (): boolean => { if (!NAV) throw new Error("initNav first"); const p = NAV.findLongPath(level, x, z, x2, z2, 3); return p.length === 1 && p[0]!.x === x2 && p[0]!.z === z2; };
    if (!adj || !(SIM_FAST || SIM_FAST_CHECK)) { STEP_STATS.bfs++; return bfs(); }
    const fast = (rsmodSeal as any).canTravel(level, x, z, dx, dz, 1, 0, 0) as boolean;   // 0 = CollisionType.NORMAL
    if (SIM_FAST_CHECK) {
        const slow = bfs();
        if (slow !== fast) { STEP_STATS.mismatch++; console.log(`[sim-fast] stepOpen MISMATCH ${level},${x},${z} -> ${x2},${z2}: bfs ${slow} canTravel ${fast}`); }
        STEP_STATS.bfs++;
        if (!SIM_FAST) return slow;
    }
    STEP_STATS.fast++;
    return fast;
}

// (remote-host login routing is not part of the shared toolkit)

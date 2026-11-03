// LUMBRIDGE-CASTLE EXIT POCKET escape — the structural fix for the Rune-Mysteries bootstrap dead-end.
//
// THE TRAP: the Duke of Lumbridge (npc 741) is on castle LEVEL 1. The RM "Duke" step climbs the south
// staircase to reach him and hands out the air_talisman there, so the account is left standing on L1
// (pocket = 186 tiles, bounds x[3205,3216] z[3208,3229]). Every offline planner is then called with
// level=0 (navgrid.bin is a level-0 surface overlay; the old rcp-rm harness fed findLongPath level 0):
// on L0 the SAME (x,z) is the castle GROUND floor, a different place, so the planner returns a long
// single-level path (203 wp) that the L1 bot cannot follow — the live server, applying L1 collision,
// rejects every move. Result: TRAVELING ... idx=1 forever, zero movement (logs/rcp-rm-*2.log).
//
// THE EXIT: a down-staircase, loc 1739 op3 ("stairs.rs2-down", shape 10, dims 2x2). The SOUTH one at
// L1 (3204,3207) angle3 lands on L0 (3205,3209) — a tile INSIDE the 380,328-tile Lumbridge mainland
// (verified by BFS flood-fill; my earlier "29-tile L0 pocket" read seeded from (3215,3211), a DIFFERENT
// small ground-floor room the bot never lands in). This is the same physical staircase the UP direction
// is LIVE-PROVEN on (mlduke15 reached the Duke's floor; sdk/navgrid/levels.ts LIVE_DENY only denies the
// NORTH up-edge). planMultiLevel({level:1,...}, {level:0,...}) returns exactly:
//   leg0: 5wp -> OPLOC loc1739 op3 @(3204,3207)  |  leg1: walk L0 to the target.
//
// WHY THE OFFLINE GRAPH "MISSED" IT: it did NOT — the graph is fine. planMultiLevel finds the descent.
// The bug was purely a LEVEL MISMATCH in the caller: single-level travel issued from an L1 tile with a
// level-0 planner. The fix is to (a) tell the bot it is on L1 (travelLevel=1) and (b) drive a MULTI-
// level plan to an L0 target, so mlDrive OPLOCs the staircase instead of walking into L1 walls.
//
// NO cheats — real staircase descent. Reusable: exported escapeCastle(bot) for any LeanBot subclass
// with planners injected; the RM bootstrap calls it before rc-rm-step1's tower corner-walk.
// Standalone: LC_HOST=localhost:8888 bun server/webclient/headless/castle-escape.ts <user> <pass>
import { LeanBot } from './leanbot.js';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// The south down-staircase (loc 1739 op3) and its L0 mainland landing. planMultiLevel picks this on its
// own; these constants only drive the manual fallback if mlDrive parks on a bad tick.
export const CASTLE_DOWN_STAIRS = { x: 3204, z: 3207, loc: 1739, op: 3, land: { x: 3205, z: 3209 } };
// L0 mainland aim point just outside the castle keep. This is a PLANNING GOAL for planMultiLevel (it must
// be reachable so the descent leg is chosen), NOT a tile the bot walks to: escapeCastle's isDone is
// `minusedlevel===0`, so the drive STOPS the instant the staircase descends — landing on the PROVEN south
// staircase's L0 tile (3205,3209), ~18.6 tiles from the Lumbridge dark-wizard danger centre (just outside
// r18). A NORTHERN goal switches planMultiLevel to a DIFFERENT, unproven north staircase (verified offline:
// lands 3205,3228) — so we KEEP the southern goal to preserve the live-proven descent, and rely on the
// descent-stop + a DANGER-aware planner + the caller's HP/precious-item guard (rc-extract) for the brief L0
// exposure. PRECIOUS-CARGO RULE: never hand this a talisman-carrier without that guard.
const L0_TARGET = { x: 3222, z: 3218 };
// The Lumbridge dark-wizard danger zone — fed to the standalone planner so any navgrid
// leg routes around it. (Live-scouted: a passive bot survives the centre at full HP for 15s, so
// this cluster reads as PHANTOM/empty here — but we route around it anyway; cost is nil, safety is not.)
const DANGER = [{ x: 3220, z: 3220, radius: 18, cost: 400 }];

// The wizard-tower basement (Sedridor's floor). planMultiLevel routes L1 pocket -> here as a 3-leg
// plan: castle south staircase DOWN (loc 1739 op3) -> walk to the tower -> trapdoor DOWN (loc 2147 op1).
export const WIZARD_BASEMENT = { x: 3103, z: 9571 };

/** Wait out the login PLANE-DECODE RACE: minusedlevel is only assigned by an op-3 (teleport) player-info,
 * so right after login it can still read its default 0 before the level is decoded — a bot physically on
 * L1 briefly looks like L0 (live-caught on RC_PIPE_ACCT_N). When standing in the castle box, wait for the real
 * plane. Returns the settled plane. */
async function settlePlane(bot: LeanBot, log: (m: string) => void): Promise<number> {
    const b = bot as any;
    const t = bot.tile();
    const inBox = t.x >= 3204 && t.x <= 3216 && t.z >= 3206 && t.z <= 3230;
    if (inBox && b.minusedlevel !== 1) {
        for (let i = 0; i < 40 && b.minusedlevel !== 1; i++) await sleep(150);
        log(`plane settled to ${b.minusedlevel} at (${t.x},${t.z}) after wait`);
    }
    return b.minusedlevel;
}

/**
 * Core multi-level drive: hand mlDrive (planMultiLevel + door-tracker + reposition/re-OPLOC) a cross-
 * stratum goal and pump it until `isDone` or timeout. Re-kicks if mlDrive parks early. This is the
 * proven driver (rc-tower-escape shape) — it opens the castle doors and descends the staircase +
 * trapdoor on its own. Assumes the bot is logged in, its run-loop is going, and BOTH planners are
 * injected (findLongPathFn per-stratum + multiLevelPlanFn = planMultiLevel).
 */
async function driveMl(bot: LeanBot, dest: { x: number; z: number }, isDone: () => boolean, label: string, opts: { maxTicks?: number; quiet?: boolean }): Promise<boolean> {
    const b = bot as any;
    const pos = () => `${bot.tile().x},${bot.tile().z}`;
    const log = (m: string) => { if (!opts.quiet) console.log(`[castle-esc] ${m}`); };
    if (isDone()) { log(`${label}: already there (${pos()})`); return true; }
    b.travelLevel = b.minusedlevel;               // plan the first leg FROM the plane we're really on
    b.startMultiTravel(0, dest.x, dest.z);
    const maxTicks = opts.maxTicks ?? 300;
    let reKicks = 0;
    for (let i = 0; i < maxTicks; i++) {
        if (isDone()) break;
        if (b.multiTravelDone && !isDone()) {
            if (reKicks < 3) { reKicks++; b.travelLevel = b.minusedlevel; b.arrived = true; b.startMultiTravel(0, dest.x, dest.z); log(`re-kick #${reKicks}: mlDrive parked at (${pos()}) plane=${b.minusedlevel} — replanning`); }
            else break;
        }
        if (i % 12 === 0) log(`${label} t${i}: (${pos()}) plane=${b.minusedlevel} mlDone=${b.multiTravelDone}`);
        await sleep(600);
    }
    b.mlGoal = null; b.mlPlan = null; b.arrived = true;   // clean travel state for the caller
    return isDone();
}

/**
 * Drive a bot standing in the Lumbridge-castle L1 pocket down to the L0 mainland (descends the south
 * staircase, loc 1739 op3). Returns true once the bot's REAL plane is 0. Reusable pocket-escape helper.
 */
export async function escapeCastle(bot: LeanBot, opts: { maxTicks?: number; quiet?: boolean; guardObj?: number } = {}): Promise<boolean> {
    const b = bot as any;
    const log = (m: string) => { if (!opts.quiet) console.log(`[castle-esc] ${m}`); };
    // PRECIOUS-CARGO GUARD: snapshot a one-time item (e.g. an air talisman 1438) so a mid-escape loss is
    // surfaced LOUDLY instead of a silent drop (rule: absence must never look like zero).
    const before = opts.guardObj !== undefined ? bot.countOf(opts.guardObj) : -1;
    const plane = await settlePlane(bot, log);
    if (plane === 0) { log(`on L0 (${bot.tile().x},${bot.tile().z}) — nothing to escape`); return true; }
    if (plane !== 1) { log(`unexpected plane ${plane} — not the castle pocket, bailing`); return false; }
    // HARDENED DESCENT: WALK to the SOUTH staircase (loc 1739 @ 3204,3207) using the pathfinder on L1 (which
    // routes AROUND Duke's-room walls — the naive OPLOC self-route can't, and planMultiLevel intermittently
    // picks the EAST staircase → the DISCONNECTED room 3215,3211 that bricked Rccraft01), then OPLOC op3 to
    // descend to the L0 MAINLAND (3205,3209). Forcing the one live-proven south staircase eliminates the
    // disconnected-room landing for both Duke crafters AND fresh-RM step-1.
    log(`in the L1 castle pocket — walking to + OPLOC-ing the SOUTH staircase (loc ${CASTLE_DOWN_STAIRS.loc} op${CASTLE_DOWN_STAIRS.op} @${CASTLE_DOWN_STAIRS.x},${CASTLE_DOWN_STAIRS.z}) → L0 mainland`);
    b.travelLevel = 1;
    let lastOp = -100;
    const maxT = opts.maxTicks ?? 120;
    for (let i = 0; i < maxT && b.minusedlevel === 1; i++) {
        const me = bot.tile();
        const d = Math.max(Math.abs(me.x - CASTLE_DOWN_STAIRS.x), Math.abs(me.z - CASTLE_DOWN_STAIRS.z));
        if (d > 2) { bot.walkToExact(CASTLE_DOWN_STAIRS.x, CASTLE_DOWN_STAIRS.z); }   // pathfind on L1 to the staircase (no OPLOC — it self-routes naively and fights the walk)
        else if (i - lastOp >= 5) { b.opLoc(CASTLE_DOWN_STAIRS.x, CASTLE_DOWN_STAIRS.z, CASTLE_DOWN_STAIRS.loc, CASTLE_DOWN_STAIRS.op); lastOp = i; }   // close → OPLOC op3 = descend
        if (i % 8 === 0) log(`  descend t${i}: (${me.x},${me.z}) d=${d} plane=${b.minusedlevel}`);
        await sleep(600);
    }
    const ok = b.minusedlevel === 0;
    if (opts.guardObj !== undefined) {
        const after = bot.countOf(opts.guardObj);
        if (after < before) { console.error(`[castle-esc] 🔴 PRECIOUS-CARGO LOST during escape: obj ${opts.guardObj} ${before}->${after} at (${bot.tile().x},${bot.tile().z}) — ABORT`); return false; }
    }
    log(`${ok ? 'ESCAPED — on L0 mainland' : 'FAILED — still on L1'} at (${bot.tile().x},${bot.tile().z}) plane=${b.minusedlevel}`);
    return ok;
}

/**
 * Drive a bot from the Lumbridge-castle L1 pocket (or anywhere on the surface) ALL THE WAY to the wizard-
 * tower basement (Sedridor's floor). One planMultiLevel journey: castle staircase down -> road to the
 * tower -> tower trapdoor down. This is what the Rune-Mysteries bootstrap needs — the raw findLongPath
 * corner-walk wedges at the (3205,3209) staircase landing (a dead re-plan tile), but mlDrive threads it.
 * Returns true once underground (z > 9000). Live-proven end-to-end (ce-basement-test on lcesc3).
 */
export async function escapePocketToBasement(bot: LeanBot, opts: { maxTicks?: number; quiet?: boolean } = {}): Promise<boolean> {
    const b = bot as any;
    const log = (m: string) => { if (!opts.quiet) console.log(`[castle-esc] ${m}`); };
    const plane = await settlePlane(bot, log);
    if (bot.tile().z > 9000) { log(`already in the basement (${bot.tile().x},${bot.tile().z})`); return true; }
    log(`driving the full descent to the wizard basement (${WIZARD_BASEMENT.x},${WIZARD_BASEMENT.z}) from plane ${plane}...`);
    const ok = await driveMl(bot, WIZARD_BASEMENT, () => bot.tile().z > 9000, 'basement', opts);
    log(`${ok ? 'IN THE WIZARD BASEMENT' : 'FAILED to reach the basement'} at (${bot.tile().x},${bot.tile().z}) z=${bot.tile().z}`);
    return ok;
}

// ---- STANDALONE RUNNER --------------------------------------------------------------------------
if (import.meta.main) {
    if (!process.env.LC_HOST) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const USER = process.argv[2], PASS = process.argv[3] || 'x';
    if (!USER) { console.error('usage: castle-escape.ts <user> <pass>'); process.exit(1); }

    console.log('[castle-esc] warming pathfinder + navgrid...');
    const { initPathfinding, blockDoor, findLongPath } = await import('../../../sdk/pathfinding');
    initPathfinding();
    const { applyBlockedEdges } = await import('./blocked-edges.js');
    applyBlockedEdges(blockDoor);
    const navgrid = await import('../../../sdk/navgrid/index');
    navgrid.init();
    const { planMultiLevel } = await import('../../../sdk/navgrid/levels');

    class Escaper extends LeanBot {
        constructor() { super(); this.mode = 'combat'; this.arrived = true; this.quiet = true; }
        protected override doCombat(): void { this.warm(); }
    }
    const bot = new Escaper();
    bot.enableDoorTracker();
    // per-stratum planner: navgrid on the SURFACE only (level 0, above ground); every other plane goes
    // straight to rsmod findLongPath (fully multi-level) — the exact split quest-runner/rc-tower-escape use.
    bot.findLongPathFn = (level, sx, sz, dx, dz) => {
        if (navgrid.hasData(sx, sz, level) && navgrid.hasData(dx, dz, level)) {
            for (const arrive of [0, 2, 4]) { try { const r = navgrid.planRoute(sx, sz, dx, dz, { level, roadPreference: 1, clearanceWeight: 1, danger: DANGER as any, arrive, maxExpansions: 600_000 }); if (r) return r.waypoints.map(w => ({ x: w.x, z: w.z })); } catch { /* next */ } }
        }
        try { return findLongPath(level, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z })); } catch { return []; }
    };
    bot.multiLevelPlanFn = (from, to) => planMultiLevel(from, to) as any;

    if (!(await bot.login(USER, PASS))) { console.error('[castle-esc] login failed'); process.exit(1); }
    bot.run(Number.MAX_SAFE_INTEGER).catch((e: any) => console.error('[castle-esc] run ended:', e?.message));
    for (let i = 0; i < 400 && !bot.backpack(); i++) await sleep(150);
    console.log(`[castle-esc] ${USER} ready at (${bot.tile().x},${bot.tile().z}) plane=${(bot as any).minusedlevel}`);

    const ok = await escapeCastle(bot);
    process.exit(ok ? 0 : 1);
}

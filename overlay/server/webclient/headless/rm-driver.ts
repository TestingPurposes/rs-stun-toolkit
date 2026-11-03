// RUNE MYSTERIES DRIVER — the orchestration that used to live inline in rc-rm-auto.ts, extracted so
// it can run for MANY accounts inside one process (one shared pathfinder) instead
// of one ~500 MB process per account — the bootstrap could run only 1-3 at a time for RAM. rc-rm-auto.ts is now a thin
// wrapper (login + this). Behaviour is unchanged: interior exit, Al Kharid pre-walk, basement descent, direct ladder
// climb, item/state recovery (RmRecoverBot).
import { escapePocketToBasement, escapeCastle } from './castle-escape.js';
import { addDirectedBlocks } from '../../../sdk/navgrid/edge-blocks.js';
import { doorEdgeOnPath } from './leanbot.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Wait n game ticks (tick-paced: correct on a lockstep sim and at any live tick length). */
const ticks = async (bot: any, n: number) => { for (let i = 0; i < n && !bot.disposed; i++) await bot.sendWait(1); };
const AIR_TALISMAN = 1438, RESEARCH_NOTES = 291;
const BASEMENT_STEPS = new Set([1, 4]);   // steps whose NPC (Sedridor) is in the wizard-tower basement

// OPEN-LEAF WALLS. The planners model a door as an open GAP at its closed position
// and know nothing of the wall its OPEN leaf adds on the neighbouring tile (doors.rs2 moves the leaf one tile and
// turns it 90°). On this route that wall cuts the planned step, the server refuses it, and no door is "closed" for
// the wedge rungs to open:
//   - Lumbridge castle front door (1516/1519 @3217,3218-3219, angle west): open, its leaves stand on (3216,3218)
//     with a SOUTH wall and on (3216,3219) with a NORTH wall. The planned step (3216,3218)->(3216,3217) is refused:
//     acct12 sat 25 min on (3216,3218) re-planning the same route (sim seed 33 reproduces it).
//   - Lumbridge castle door 1536 @3215,3211 (angle north): open, its leaf stands on (3215,3212) with an EAST wall.
//   - Duke Horacio's room door 1536 @3207,3222 L1 (angle east): open, its leaf stands on (3208,3222) with a SOUTH wall,
//     so leaving the Duke (3208,3221)->(3208,3222) is refused (sim seed 33: escapeCastle wedged there 250 ticks).
//   - Sedridor's room door 1530 @3108,9570 (angle west): open, its leaf stands on (3107,9570) with a NORTH wall, so
//     (3106,9571)/(3107,9571)->(3107,9570) is refused (acct13 ended parked on (3107,9571)).
// Walling those edges permanently costs nothing: each has a same-length detour one tile over, which also serves
// when the door is closed (the wedge rung then opens it from the detour tile). Directed blocks on the shared rsmod
// map (navgrid + rsmod honour them; edge-blocks re-applies them after any re-init). Idempotent.
function wallSteps(x: number, z: number, side: 'n' | 's' | 'e' | 'w'): Array<[number, number, number, number]> {
    const [ox, oz] = side === 'n' ? [0, 1] : side === 's' ? [0, -1] : side === 'e' ? [1, 0] : [-1, 0];
    const out: Array<[number, number, number, number]> = [];
    // every single step (cardinal or diagonal) between the 3 tiles on our side and the 3 beyond that crosses this edge
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
        if ((a !== 0 && b !== 0) || Math.abs(a - b) > 1) continue;
        const ax = x + (ox ? 0 : a), az = z + (oz ? 0 : a), bx = x + ox + (ox ? 0 : b), bz = z + oz + (oz ? 0 : b);
        out.push([ax, az, bx - ax, bz - az], [bx, bz, ax - bx, az - bz]);
    }
    return out;
}
/** [x, z, side of that tile the open leaf walls, level] */
export const RM_OPEN_LEAF_WALLS: ReadonlyArray<[number, number, 'n' | 's' | 'e' | 'w', number]> = [
    [3216, 3218, 's', 0], [3216, 3219, 'n', 0], [3215, 3212, 'e', 0], [3208, 3222, 's', 1], [3107, 9570, 'n', 0]];
export function applyRmEdgeBlocks(): number {
    let n = 0;
    for (const [x, z, side, level] of RM_OPEN_LEAF_WALLS) n += addDirectedBlocks(wallSteps(x, z, side), level);
    return n;
}
applyRmEdgeBlocks();

// LEARNED EDGES: the same open-leaf trap at any other door/gate (chaos seed 33: the potato-field gate 1551/1553 @3241,
// 3301-3302 on the Varrock road wedged a run on (3240,3300) for 500+ ticks). LeanBot's wedge ladder cannot clear it:
// its re-plan hits the planner's route cache (same tile, same destination -> the same refused step), and its sidestep
// MOVE is overwritten by the walker the next tick. So while the driver runs, a watchdog learns the refused step: the
// bot has stood on one tile for WEDGE_LEARN_TICKS with a travel route whose next step is a single move that crosses
// no known door edge (a CLOSED door is the wedge rung's job — it opens it). That step (and its reverse) is walled on
// the shared map, and any planned route that crosses a learned step is re-planned by rsmod (which honours it).
const LEARNED = new Set<string>();   // "level,x,z,dx,dz" (both directions)
const WEDGE_LEARN_TICKS = 20, LEARN_MAX = 32;
function learnStep(level: number, x: number, z: number, dx: number, dz: number): void {
    LEARNED.add(`${level},${x},${z},${dx},${dz}`); LEARNED.add(`${level},${x + dx},${z + dz},${-dx},${-dz}`);
    addDirectedBlocks([[x, z, dx, dz], [x + dx, z + dz, -dx, -dz]], level);
}
function crossesLearned(level: number, sx: number, sz: number, route: Array<{ x: number; z: number }>): boolean {
    let x = sx, z = sz;
    for (const c of route) {
        while (x !== c.x || z !== c.z) {
            const dx = Math.sign(c.x - x), dz = Math.sign(c.z - z);
            if (LEARNED.has(`${level},${x},${z},${dx},${dz}`)) return true;
            x += dx; z += dz;
        }
    }
    return false;
}
/** Start the learned-edge watchdog on `bot` (wraps its planner once). Returns the stop function. */
function startWedgeWatch(bot: any, findLongPath: RmDriveOpts['findLongPath']): () => void {
    if (!bot.__rmPlannerWrapped && typeof bot.findLongPathFn === 'function') {
        const base = bot.findLongPathFn;
        bot.findLongPathFn = (l: number, sx: number, sz: number, dx: number, dz: number) => {
            const r = base(l, sx, sz, dx, dz);
            if (!LEARNED.size || !r?.length || !crossesLearned(l, sx, sz, r)) return r;
            try { const raw = findLongPath(l, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z })); if (raw.length) return raw; } catch { /* keep r */ }
            return r;
        };
        bot.__rmPlannerWrapped = true;
    }
    let stop = false, key = '', since = bot.tickCount;
    (async () => {
        while (!stop && !bot.disposed) {
            await bot.sendWait(1);
            const me = bot.tile();
            const level = typeof bot.minusedlevel === 'number' ? bot.minusedlevel : (bot.travelLevel ?? 0);
            const k = `${level},${me.x},${me.z}`;
            if (k !== key) { key = k; since = bot.tickCount; continue; }
            if (bot.tickCount - since < WEDGE_LEARN_TICKS || LEARNED.size >= LEARN_MAX * 2) continue;
            // only while the walker is ACTIVELY travelling: a finished route stays in travelPath while the bot talks
            // (Duke/Sedridor/Aubury dialogs stand still far longer than 20 ticks — sim run rmf33d learned 4 false steps)
            const path: Array<{ x: number; z: number }> | null = bot.travelPath;
            if (!path || bot.arrived !== false) { since = bot.tickCount; continue; }
            let next: { x: number; z: number } | undefined;
            for (let i = Math.max(0, bot.travelIdx ?? 0); i < path.length && !next; i++) if (Math.max(Math.abs(path[i]!.x - me.x), Math.abs(path[i]!.z - me.z)) >= 1) next = path[i];
            since = bot.tickCount;   // one decision per WEDGE_LEARN_TICKS window
            if (!next) continue;
            const dx = Math.sign(next.x - me.x), dz = Math.sign(next.z - me.z);
            if (LEARNED.has(`${level},${me.x},${me.z},${dx},${dz}`)) continue;
            if (doorEdgeOnPath(level, me, [{ x: me.x + dx, z: me.z + dz }], 0, 1)) continue;   // a door edge: the wedge rung opens it
            learnStep(level, me.x, me.z, dx, dz);
            console.log(`[rm-auto] wedged ${WEDGE_LEARN_TICKS}t on (${me.x},${me.z}) L${level}: the step (${dx},${dz}) is refused (an open door leaf?) — walling it and re-planning`);
            bot.travelPath = null; bot.travelIdx = 0;
        }
    })();
    return () => { stop = true; };
}

// Robust tower-door threader (the rc-rm-finish descent, proven): raw server-routed corner-walk to the
// down-trapdoor along rsmod findLongPath corners (1-tile hops = collision-safe through the doorway),
// OPENING the two guarding poor-doors (loc 1536) only when genuinely stuck (never op1-closing an open one),
// then OPLOC the trapdoor to climb down. mlDrive's navgrid path OSCILLATES at the north door (3109,3167);
// this raw corner-walk threads it. Used as the finisher after escapePocketToBasement gets near the tower.
export async function cornerWalkToTrapdoor(bot: any, findLongPath: any): Promise<boolean> {
    const LADDER = { x: 3104, z: 3162, loc: 2147 };
    const TOWER_DOORS = [{ x: 3109, z: 3166 }, { x: 3107, z: 3162 }];
    let lastP = '', stuck = 0;
    for (let i = 0; i < 220; i++) {
        if (bot.tile().z > 9000) return true;
        const me = bot.tile();
        const p = `${me.x},${me.z}`; stuck = p === lastP ? stuck + 1 : 0; lastP = p;
        const dLad = Math.max(Math.abs(me.x - LADDER.x), Math.abs(me.z - LADDER.z));
        if (dLad <= 1) { bot.opLoc(LADDER.x, LADDER.z, LADDER.loc, 1); await sleep(700); continue; }
        if (stuck >= 2) { const d = TOWER_DOORS.find(D => Math.max(Math.abs(me.x - D.x), Math.abs(me.z - D.z)) <= 1); if (d) { bot.opLoc(d.x, d.z, 1536, 1); await sleep(700); stuck = 0; continue; } }
        const corners = findLongPath(0, me.x, me.z, LADDER.x, LADDER.z);
        const tgt = corners.find((c: any) => Math.max(Math.abs(c.x - me.x), Math.abs(c.z - me.z)) >= 1) ?? LADDER;
        bot.sendMove(tgt.x, tgt.z, true);
        await sleep(600);
    }
    return bot.tile().z > 9000;
}

export interface RmDriveOpts {
    findLongPath: (level: number, sx: number, sz: number, dx: number, dz: number) => Array<{ x: number; z: number }>;
    timeoutMs: number;
    dukeOnly?: boolean;
    /** true = abandon (the lane replaced this bot after a reconnect, or is shutting down) */
    shouldStop?: () => boolean;
}

/** Drive a logged-in RmRecoverBot (backpack decoded) through Rune Mysteries. Resolves true when the quest is done. */
export async function driveRuneMysteries(bot: any, o: RmDriveOpts): Promise<boolean> {
    const stopWatch = startWedgeWatch(bot, o.findLongPath);
    try { return await driveRuneMysteriesInner(bot, o); } finally { stopWatch(); }
}
async function driveRuneMysteriesInner(bot: any, o: RmDriveOpts): Promise<boolean> {
    const TIMEOUT_MS = o.timeoutMs, DUKE_ONLY = !!o.dukeOnly, findLongPath = o.findLongPath;
    const pos = () => `${bot.tile().x},${bot.tile().z}`;
    const z = () => bot.tile().z;
    // LEAVE AN INSTANCED INTERIOR FIRST (essence mine / altar: 4000 <= z < 9000; the wizard basement is >= 9000 and
    // handled by the quest steps). A bot that logs in there otherwise times out: the quest runner cannot path out of an instance.
    if (z() >= 4000 && z() < 9000) {
        const { nearestInteriorPortal } = await import('./interior-portal.js');
        console.log(`[rm-auto] starting INSIDE an interior @ (${pos()}) — leaving by the nearest portal`);
        bot.travelEnabled = false;
        for (let i = 0; i < 90 && z() >= 4000 && z() < 9000; i++) {
            const p = nearestInteriorPortal(bot.tile().x, bot.tile().z);
            if (!p) { console.log('[rm-auto]   no portal found (loc-scene needs RM_DOORS=1)'); break; }
            // walk up to the portal first (a bare OPLOC from ~15+ tiles never fired live: 4/4 "interior exit FAILED",
            //) — the rc-exit.ts pattern that works: walkToExact beside it, then OPLOC
            const me = bot.tile();
            if (Math.max(Math.abs(me.x - p.x), Math.abs(me.z - p.z)) > 2) (bot as any).walkToExact(p.x, p.z + 1);
            else (bot as any).opLoc(p.x, p.z, p.loc, p.op);
            await sleep(1800);
        }
        bot.travelEnabled = true;
        (bot as any).phase = 'travel'; (bot as any).mlStarted = false; (bot as any).attemptSince = -1;
        console.log(`[rm-auto]   interior exit ${z() < 4000 ? 'OK' : 'FAILED'} @ (${pos()})`);
    }

    // AL KHARID SIDE -> VARROCK FIRST. From the fire ruins the shortest way to the Duke (Lumbridge) is the Al Kharid toll
    // gate (10 gp), and ex-helpers parked at the ruins stand carry none: 35 step-0 runs timed out AT the gate (3268,3227)
    //. The ruins <-> Varrock East leg is toll-free (every solo trip walks it); from Varrock the Duke route
    // is the plain Varrock–Lumbridge road.
    if (z() < 4000 && bot.tile().x >= 3268 && z() < 3300) {
        console.log(`[rm-auto] starting on the Al Kharid side @ (${pos()}) — walking to Varrock East first (no toll)`);
        bot.travelEnabled = false;
        // Near the toll gate the planner routes Varrock-ward THROUGH the gate (shortest) and wedges "TOLL-BROKE"
        // ( runs starting at (3268,3227)). Go east to the fire-ruins stand first — from there the route north
        // is the toll-free solo route.
        if (bot.tile().x < 3300) {
            (bot as any).startMultiTravel(0, 3312, 3253);
            const te = Date.now();
            while (Date.now() - te < 3 * 60_000 && Math.max(Math.abs(bot.tile().x - 3312), Math.abs(z() - 3253)) > 6) {
                if ((bot as any).arrived && Math.max(Math.abs(bot.tile().x - 3312), Math.abs(z() - 3253)) > 6) (bot as any).startMultiTravel(0, 3312, 3253);
                await sleep(3000);
            }
            console.log(`[rm-auto]   east leg to the fire ruins ended @ (${pos()})`);
        }
        (bot as any).startMultiTravel(0, 3253, 3402);
        const tv = Date.now();
        while (Date.now() - tv < 5 * 60_000 && Math.max(Math.abs(bot.tile().x - 3253), Math.abs(z() - 3402)) > 6) {
            if ((bot as any).arrived && Math.max(Math.abs(bot.tile().x - 3253), Math.abs(z() - 3402)) > 6) (bot as any).startMultiTravel(0, 3253, 3402);
            await sleep(3000);
        }
        bot.travelEnabled = true;
        (bot as any).phase = 'travel'; (bot as any).mlStarted = false; (bot as any).attemptSince = -1;
        console.log(`[rm-auto]   Varrock pre-walk ended @ (${pos()})`);
    }

    const t0 = Date.now();
    const handled = new Set<number>();
    let lastLog = 0;
    while (!(bot as any).done && Date.now() - t0 < TIMEOUT_MS && !o.shouldStop?.()) {
        const s = bot.stepIdx;
        // DUKE_ONLY (station crafter): step 0 done (talisman in hand) -> descend to the L0 mainland, then STOP.
        if (DUKE_ONLY && s >= 1) {
            console.log(`[rm-auto] DUKE_ONLY: Duke done (air talisman held) — escapeCastle to L0, then stopping`);
            bot.travelEnabled = false;
            for (let c = 0; c < 3 && (bot as any).minusedlevel === 1; c++) { await escapeCastle(bot, { quiet: false }); await sleep(1000); }
            const okDuke = bot.countOf(AIR_TALISMAN) > 0 && (bot as any).minusedlevel === 0;
            console.log(`[rm-auto] ${okDuke ? 'DUKE_ONLY COMPLETE' : 'DUKE_ONLY FAILED'} @ (${pos()}) plane=${(bot as any).minusedlevel} tali=${bot.countOf(AIR_TALISMAN)}`);
            return okDuke;
        }
        // LEAVE THE BASEMENT DIRECTLY for a surface step. planMultiLevel's approach to the basement ladder (loc 2148
        // @3103,9576) is (3103,9575), which stalls LIVE: 158/158 escapes and every post-Sedridor "travel to Aubury"
        // parked at (3104,9575) (/28: 19 step-2 timeouts in 3 h). Standing due east on (3104,9576) — the
        // tile the trapdoor lands on — and climbing is live-proven (rc-tower-escape.ts).
        if (z() > 9000 && !BASEMENT_STEPS.has(s) && !(bot as any).done) {
            console.log(`[rm-auto] step ${s} is a SURFACE step but we are in the basement @ (${pos()}) — direct ladder climb`);
            bot.travelEnabled = false;
            await climbOutOfBasement(bot, 30);   // also leaves Sedridor's room by its door (acct13 parked on 3107,9571)
            bot.travelEnabled = true;
            (bot as any).phase = 'travel'; (bot as any).mlStarted = false; (bot as any).attemptSince = -1;
            console.log(`[rm-auto]   direct climb ${z() < 9000 ? 'OK' : 'FAILED'} @ (${pos()})`);
            if (z() > 9000) await sleep(3000);
            continue;
        }
        // ITEM RECOVERY first: a use step whose item is banked/lost must not descend (it would hold "missing
        // use-item" in the basement until the timeout). The bot drives the bank trip itself, tick by tick.
        if (bot.needsRecovery()) { await sleep(600); continue; }
        // Proactively THREAD the tower for a basement-targeted step while we're still on the surface: quest-
        // runner's own travel stalls here intermittently, but escapePocketToBasement's mlDrive threads it every
        // time. Park the step machine (travelEnabled=false -> it waits in 'interact') while we drive the descent.
        if (BASEMENT_STEPS.has(s) && z() < 9000 && !handled.has(s)) {
            console.log(`[rm-auto] step ${s} is a basement step @ (${pos()}) plane=${(bot as any).minusedlevel} — descending`);
            bot.travelEnabled = false;
            // HARDEN the castle L1->L0 descent: force the PROVEN south staircase (escapeCastle uses loc 1739 op3
            // -> L0 mainland 3205,3209) instead of letting escapePocketToBasement's planMultiLevel pick a
            // staircase — which intermittently landed in the DISCONNECTED small ground-floor room (3215,3211)
            // that nothing can walk out of. escapeCastle no-ops on L0 (step 4).
            if ((bot as any).minusedlevel === 1) {
                console.log(`[rm-auto]   on castle L1 — escapeCastle (south staircase) to the L0 mainland`);
                for (let cAttempt = 1; cAttempt <= 3 && (bot as any).minusedlevel === 1; cAttempt++) {
                    await escapeCastle(bot, { quiet: false });
                    if ((bot as any).minusedlevel === 0) break;
                    await sleep(1000);
                }
                console.log(`[rm-auto]   after escapeCastle: (${pos()}) plane=${(bot as any).minusedlevel}`);
            }
            // Now on the L0 mainland (or already there for step 4): approach the tower + thread the door.
            for (let attempt = 1; attempt <= 4 && z() < 9000; attempt++) {
                console.log(`[rm-auto]   descent attempt ${attempt} @ (${pos()}) z=${z()}`);
                // (a) mlDrive to get from the castle L1 pocket / Aubury to NEAR the tower (it does the approach
                //     + staircase reliably; only the final door oscillates).
                await escapePocketToBasement(bot, { quiet: false, maxTicks: 250 });
                if (z() >= 9000) break;
                // (b) robust raw corner-walk to thread the tower door + trapdoor (the part mlDrive can't).
                console.log(`[rm-auto]   near tower @ (${pos()}) — corner-walking the trapdoor`);
                await cornerWalkToTrapdoor(bot as any, findLongPath);
                if (z() >= 9000) break;
                await sleep(1500);
            }
            handled.add(s);
            const inBasement = z() >= 9000;
            console.log(`[rm-auto] descent ${inBasement ? 'OK' : 'GAVE UP'} @ (${pos()}) z=${z()} — ${inBasement ? 'quest-runner interact will finish' : 'handing to quest-runner travel for'} step ${s}`);
            // Wait (with the step machine parked in 'interact') for the basement talk to advance the step.
            const waitStart = Date.now();
            while (inBasement && bot.stepIdx === s && !(bot as any).done && Date.now() - waitStart < 4 * 60_000) {
                if ((bot as any).tickCount % 50 === 0) console.log(`[rm-auto]   finishing step ${s} @ (${pos()}) z=${z()} tali=${bot.countOf(AIR_TALISMAN)} notes=${bot.countOf(RESEARCH_NOTES)}`);
                await sleep(600);
            }
            // Re-enable travel for the next (surface) step AND force the step machine back to 'travel' —
            // otherwise it stays wedged in the 'interact' phase it flipped to while travel was disabled (it
            // set phase='interact' using the stale travelEnabled=false on the tick right after the step
            // advanced, and 'interact' never returns to 'travel' on its own → stuck looking for a surface NPC
            // from the basement, "npc 553 not in scene" forever —  on RC_MINER_N).
            bot.travelEnabled = true;
            (bot as any).phase = 'travel'; (bot as any).mlStarted = false; (bot as any).attemptSince = -1;
            console.log(`[rm-auto] step ${s} -> now step ${bot.stepIdx}${(bot as any).done ? ' (DONE)' : ''} (travel re-armed)`);
            continue;
        }
        if (Date.now() - lastLog > 12_000) { console.log(`[rm-auto] ${bot.status()} @ (${pos()}) z=${z()}`); lastLog = Date.now(); }
        await sleep(600);
    }

    return !!bot.done;
}

/** Sedridor's room (walled; its only exit is the door 1530 @3108,9570, a WEST wall on that tile). */
const inSedridorRoom = (t: { x: number; z: number }) => t.x >= 3100 && t.x <= 3107 && t.z >= 9568 && t.z <= 9574;
const SED_DOOR = { x: 3108, z: 9570, closed: 1530, inside: { x: 3107, z: 9570 } };

/** Direct climb out of the wizard basement from (3104,9576) (ladder 2148 @3103,9576 — see the loop above).
 *  From inside Sedridor's room it first walks to the door's inside tile (3107,9570) and steps out east. acct13 (live)
 *  and probe-rm-basement.ts (sim, door OPEN, from 3107,9571): the open leaf on (3107,9570) walls its north side, the
 *  planner did not know, the walk parked on (3107,9571), and the launcher's OPLOC of the CLOSED id 1530 was an id miss
 *  on the open door (ACK-NOACK-OPLOC) — underground for good. The leaf wall is now on the map (RM_OPEN_LEAF_WALLS), so
 *  the walk goes round by (3106,9570); a CLOSED door (it swings shut 500 ticks after it was opened) is opped from
 *  (3107,9570) when the step east is refused (an id miss on an open door is ignored). */
export async function climbOutOfBasement(bot: any, tries = 30): Promise<boolean> {
    let last = '', stuck = 0;
    for (let i = 0; i < tries && bot.tile().z > 9000; i++) {
        const me = bot.tile();
        const p = `${me.x},${me.z}`; stuck = p === last ? stuck + 1 : 0; last = p;
        if (inSedridorRoom(me)) {
            const D = SED_DOOR.inside;
            if (me.x !== D.x || me.z !== D.z) { if (Math.max(Math.abs(me.x - D.x), Math.abs(me.z - D.z)) > 1 || stuck >= 2) bot.walkToExact(D.x, D.z); else bot.sendMove(D.x, D.z, true); }
            else if (stuck >= 1 && stuck % 2 === 1) bot.opLoc(SED_DOOR.x, SED_DOOR.z, SED_DOOR.closed, 1);
            else bot.sendMove(SED_DOOR.x, SED_DOOR.z, true);
            await ticks(bot, 3);
            continue;
        }
        if (me.x !== 3104 || me.z !== 9576) { if (Math.max(Math.abs(me.x - 3104), Math.abs(me.z - 9576)) > 1) bot.walkToExact(3104, 9576); else bot.sendMove(3104, 9576, true); }
        else bot.opLoc(3103, 9576, 2148, 1);
        await ticks(bot, 3);
    }
    return bot.tile().z < 9000;
}

/** Leave the wizard basement for the surface and CONFIRM it (z < 9000). climbOutOfBasement first; then the
 *  rc-tower-escape fallback that recovered both live basement endings: multi-level travel to the ascent trapdoor's
 *  surface landing (3105,3162) — planMultiLevel routes basement -> climb -> there. Returns true only on the surface. */
export async function surfaceFromBasement(bot: any, log = (s: string) => console.log(s)): Promise<boolean> {
    const under = () => bot.tile().z > 9000;
    if (!under()) { await leaveTowerGroundFloor(bot, log); return true; }
    const pos = () => `${bot.tile().x},${bot.tile().z}`;
    const wasTravel = bot.travelEnabled;
    bot.travelEnabled = false;   // park the step machine: no quest-runner moves fight the climb
    for (let a = 1; a <= 3 && under(); a++) {
        await climbOutOfBasement(bot, 30);
        log(`[rm-auto] basement exit: climb attempt ${a} ${under() ? 'still underground' : 'OK'} @ (${pos()})`);
    }
    if (under()) {
        log(`[rm-auto] basement exit: multi-level travel to the trapdoor landing (3105,3162) from (${pos()})`);
        bot.travelEnabled = true;
        bot.startMultiTravel(0, 3105, 3162);
        for (let i = 0; i < 150 && under(); i++) {
            if (bot.multiTravelDone && under()) bot.startMultiTravel(0, 3105, 3162);
            await ticks(bot, 2);
        }
    }
    log(`[rm-auto] basement exit ${under() ? 'FAILED' : 'OK'} @ (${pos()}) z=${bot.tile().z}`);
    if (!under()) await leaveTowerGroundFloor(bot, log);
    bot.travelEnabled = wasTravel;
    return !under();
}

// WIZARDS' TOWER GROUND FLOOR. The ladder/trapdoor lands on (3105,3162) INSIDE
// the tower; an essence miner then walked with walkToExact (no door handling) into the SHUT inner door 1536 @3107,3162
// and sat on (3107,3161) indefinitely. So the launcher now ends OUTSIDE the front door: walk to
// TOWER_OUT, opening the route's door whenever we stand still (LeanBot.openDoorOnWalk = blind OPLOC of the CLOSED id,
// so an already-open door is never closed). Best effort: the surface (z < 9000) stays the COMPLETE condition.
const TOWER_IN = (t: { x: number; z: number }) => t.x >= 3101 && t.x <= 3117 && t.z >= 3155 && t.z <= 3166;
const TOWER_OUT = { x: 3109, z: 3168 };
export async function leaveTowerGroundFloor(bot: any, log = (s: string) => console.log(s)): Promise<boolean> {
    const lvl = () => (typeof bot.travelLevel === 'number' ? bot.travelLevel : 0);
    if (bot.tile().z > 9000 || lvl() !== 0 || !TOWER_IN(bot.tile())) return true;
    const pos = () => `${bot.tile().x},${bot.tile().z}`;
    const wasTravel = bot.travelEnabled;
    bot.travelEnabled = false;   // park the step machine
    log(`[rm-auto] tower exit: walking out of the Wizards' Tower from (${pos()}) to (${TOWER_OUT.x},${TOWER_OUT.z})`);
    let last = '', still = 0;
    for (let i = 0; i < 150 && TOWER_IN(bot.tile()); i++) {
        const p = pos(); still = p === last ? still + 1 : 0; last = p;
        if (still >= 3) {
            const what = bot.openDoorOnWalk?.(TOWER_OUT);
            if (what) { log(`[rm-auto] tower exit: ${what}`); still = 0; await ticks(bot, 4); continue; }
        }
        bot.walkToExact(TOWER_OUT.x, TOWER_OUT.z);
        await ticks(bot, 1);
    }
    bot.travelEnabled = wasTravel;
    const out = !TOWER_IN(bot.tile());
    log(`[rm-auto] tower exit ${out ? 'OK' : 'FAILED (still inside; the miner walks out itself)'} @ (${pos()})`);
    return out;
}
/** Multi-level travel to (x,z) on the surface; resolves true once within `near` tiles or false at the deadline. */
export async function travelNear(bot: any, x: number, z: number, ms: number, near = 6, shouldStop?: () => boolean): Promise<boolean> {
    const d = () => Math.max(Math.abs(bot.tile().x - x), Math.abs(bot.tile().z - z));
    bot.startMultiTravel(0, x, z);
    const t = Date.now();
    while (Date.now() - t < ms && d() > near && !shouldStop?.()) {
        if (bot.arrived && d() > near) bot.startMultiTravel(0, x, z);
        await sleep(3000);
    }
    return d() <= near;
}

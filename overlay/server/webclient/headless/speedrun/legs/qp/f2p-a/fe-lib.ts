// fe-lib.ts — Ernest the Chicken helpers (f2p-a agent "fe"). Cheat-free. Imports fa-lib/fa2-lib unchanged.
//
// The Draynor Manor basement lever puzzle (quest_haunted.rs2:139-178):
//   - six levers A-F = %ernestlever bits 0-5, each op toggles its bit and prints "You pull lever X up|down." (:139-152)
//   - nine one-way-free doors 137-145 open only for a lever pattern (:162-176) and then TELEPORT you through
//     (open_and_close_door2, doors/scripts/open_and_close_doors.rs2:43-62); a refused door prints "This door is locked."
//   - the ladder top 133 lands on (3116,9754) (:120); the ladder 132 (3117,9754) climbs to (3092,3361) and RESETS the
//     levers (:123-127). Levers are perm varp bits: a fresh account starts at 0.
// PUZZLE below = the fewest-tick solution of probe-fe-puzzle.ts (Dijkstra over tile x lever bits x carrying-the-can; walk
// 0.5 t/step, lever 1.5 t, door 2.5 t): 133.5 t estimated, the same op order as the old kbd-swarm BFS (A/B swapped first).
import type { SpeedBot } from '../../../core.js';
import { objId, cheb } from '../../../core.js';
import { locAt, opLocGo, useOnLocGo, routeToLoc, pickupGo, msgsSince, addWalls, nav, type Wall, type Tile } from '../../q-lib.js';
import { closeChat, fail, dead, walkSafe } from './fa-lib.js';
declare const process: { env: Record<string, string | undefined> };

export type PAct =
    | { k: 'lever'; id: number; x: number; z: number; bit: number; down: boolean; stand: Tile }
    | { k: 'door'; id: number; x: number; z: number; from: Tile; to: Tile }
    | { k: 'pick'; obj: string; at: Tile };
const LV = (name: string, down: boolean, stand: Tile): PAct => {
    const L: Record<string, [number, number, number, number]> = { A: [146, 3108, 9745, 0], B: [147, 3118, 9752, 1], C: [148, 3112, 9760, 2], D: [149, 3108, 9767, 3], E: [150, 3097, 9767, 4], F: [151, 3096, 9765, 5] };
    const [id, x, z, bit] = L[name]!; return { k: 'lever', id, x, z, bit, down, stand };
};
const DR = (id: number, x: number, z: number, from: Tile, to: Tile): PAct => ({ k: 'door', id, x, z, from, to });
// door locs (wall shape 0; angle: 0 W, 1 N, 2 E, 3 S edge of the tile) — probe-fg-locs dump, m48_152
export const PUZZLE_DOORS: Array<{ id: number; x: number; z: number; angle: number }> = [
    { id: 137, x: 3105, z: 9765, angle: 0 }, { id: 138, x: 3100, z: 9765, angle: 0 }, { id: 139, x: 3105, z: 9760, angle: 0 },
    { id: 140, x: 3100, z: 9760, angle: 0 }, { id: 141, x: 3100, z: 9755, angle: 0 }, { id: 142, x: 3102, z: 9763, angle: 3 },
    { id: 143, x: 3097, z: 9763, angle: 3 }, { id: 144, x: 3108, z: 9758, angle: 3 }, { id: 145, x: 3102, z: 9758, angle: 3 },
];
export const OIL_AT = { x: 3092, z: 9755 };
export const PUZZLE: PAct[] = [
    LV('B', true, { x: 3118, z: 9752 }), LV('A', true, { x: 3108, z: 9745 }),
    DR(144, 3108, 9758, { x: 3108, z: 9757 }, { x: 3108, z: 9758 }),
    LV('D', true, { x: 3108, z: 9767 }),
    DR(139, 3105, 9760, { x: 3105, z: 9760 }, { x: 3104, z: 9760 }),
    DR(145, 3102, 9758, { x: 3102, z: 9758 }, { x: 3102, z: 9757 }),
    LV('B', false, { x: 3118, z: 9752 }), LV('A', false, { x: 3108, z: 9745 }),
    DR(145, 3102, 9758, { x: 3102, z: 9757 }, { x: 3102, z: 9758 }),
    DR(140, 3100, 9760, { x: 3100, z: 9760 }, { x: 3099, z: 9760 }),
    DR(143, 3097, 9763, { x: 3097, z: 9762 }, { x: 3097, z: 9763 }),
    LV('F', true, { x: 3096, z: 9765 }), LV('E', true, { x: 3097, z: 9767 }),
    DR(138, 3100, 9765, { x: 3099, z: 9765 }, { x: 3100, z: 9765 }),
    DR(137, 3105, 9765, { x: 3104, z: 9765 }, { x: 3105, z: 9765 }),
    LV('C', true, { x: 3112, z: 9760 }),
    DR(137, 3105, 9765, { x: 3105, z: 9765 }, { x: 3104, z: 9765 }),
    DR(138, 3100, 9765, { x: 3100, z: 9765 }, { x: 3099, z: 9765 }),
    LV('E', false, { x: 3097, z: 9767 }),
    DR(138, 3100, 9765, { x: 3099, z: 9765 }, { x: 3100, z: 9765 }),
    DR(142, 3102, 9763, { x: 3102, z: 9763 }, { x: 3102, z: 9762 }),
    DR(145, 3102, 9758, { x: 3102, z: 9758 }, { x: 3102, z: 9757 }),
    DR(141, 3100, 9755, { x: 3100, z: 9755 }, { x: 3099, z: 9755 }),
    { k: 'pick', obj: 'oil_can', at: OIL_AT },
    DR(141, 3100, 9755, { x: 3099, z: 9755 }, { x: 3100, z: 9755 }),
];

/** wall off the puzzle doors for the rsmod planner (the static map has doors masked open): routes stay inside a room */
export async function puzzleWalls(): Promise<void> {
    await nav();
    await addWalls(PUZZLE_DOORS.map(d => ({ level: 0, x: d.x, z: d.z, shape: 0, angle: d.angle } as Wall)));
}

/** FE_RIDE: send route+op within this many tiles of the stand (default 2 = one running tick); 99 = from anywhere (fe4) */
const RIDE = Number(process.env.FE_RIDE || 2);
const LEVER_RE = /You pull lever ([A-F]) (up|down)\./;
/**
 * Run the puzzle from the ladder landing to back outside the oil-can room, holding the oil can. Each act rides the walk
 * (route + op in one tick) and is confirmed by its effect: the lever message (tracked bits; an op is never re-sent while
 * one is in flight, a double pull would flip the bit back), the door's far tile, the can in the pack.
 */
export async function runPuzzle(bot: SpeedBot, L: (s: string) => void, acts: PAct[] = PUZZLE, maxTicks = 600): Promise<void> {
    await puzzleWalls();
    const t0 = bot.tickCount, end = t0 + maxTicks;
    let bits = 0;   // fresh account: %ernestlever = 0 (perm varp, cleared by the ladder up, quest_haunted.rs2:126-127)
    // recomputed from EVERY lever message since the puzzle started (a per-tick cursor lost messages stamped with the tick
    // it had just moved past: fe3 pulled lever B six times and saw none)
    const readLevers = () => {
        bits = 0;
        for (const m of msgsSince(bot, t0)) {
            const r = LEVER_RE.exec(m); if (!r) continue;
            const i = 'ABCDEF'.indexOf(r[1]!); bits = r[2] === 'down' ? bits | (1 << i) : bits & ~(1 << i);
        }
    };
    const at = (t: Tile) => { const me = bot.tile(); return me.x === t.x && me.z === t.z; };
    for (let i = 0; i < acts.length; i++) {
        const a = acts[i]!, ta = bot.tickCount;
        let sent = -99, tries = 0, lockedSeen = false, routed = -99, lastTile = '';
        const ok = (): boolean => {
            readLevers();
            if (a.k === 'lever') return (((bits >> a.bit) & 1) === 1) === a.down;
            if (a.k === 'door') return at(a.to);
            return bot.count(objId(a.obj)) > 0;
        };
        while (!ok()) {
            if (dead(bot)) fail(bot, 'died in the puzzle');
            if (bot.tickCount > end) fail(bot, `puzzle step ${i + 1} (${a.k} ${'id' in a ? a.id : a.obj}) timed out; bits ${bits.toString(2)}`);
            const me = bot.tile();
            // re-send only when the last op had time to land: walk distance + 4 t, and we are standing still
            const dist = a.k === 'pick' ? cheb(me, a.at) : cheb(me, a.k === 'lever' ? a.stand : a.from);
            // a route+op sent from far away was often dropped (fe4: 7 of 9 long-walk acts needed a re-send, +2..4 t each):
            // walk first (route only), send route+op once we are within RIDE tiles of the stand
            if (sent < 0 && dist > RIDE && a.k !== 'pick') {
                const t = me.x + ',' + me.z;
                if (routed < 0 || (t === lastTile && bot.tickCount - routed >= 3)) { closeChat(bot); routeToLoc(bot, locAt(a.id, a.x, a.z, 0), a.k === 'lever' ? a.stand : a.from); routed = bot.tickCount; }
                lastTile = t;
            } else if (sent < 0 || bot.tickCount - sent >= Math.max(5, dist + 4)) {
                if (sent >= 0 && msgsSince(bot, sent).some(t => /This door is locked/.test(t))) { lockedSeen = true; }
                if (sent >= 0) L(`puzzle ${i + 1}: re-send #${tries} at ${JSON.stringify(me)}, msgs since ${JSON.stringify(msgsSince(bot, sent))}`);
                if (++tries > 6) fail(bot, `puzzle step ${i + 1} (${a.k}) failed ${tries - 1} times at ${JSON.stringify(me)} bits ${bits.toString(2)}${lockedSeen ? ' (door locked)' : ''}`);
                closeChat(bot);
                if (a.k === 'pick') pickupGo(bot, a.obj, a.at);
                else opLocGo(bot, locAt(a.id, a.x, a.z, 0), 1, a.k === 'lever' ? a.stand : a.from);
                sent = bot.tickCount;
            }
            await bot.tick(1);
        }
        L(`puzzle ${i + 1}/${acts.length} ${a.k}${a.k === 'pick' ? ' ' + a.obj : ' ' + a.id} ok in ${bot.tickCount - ta} t (bits ${bits.toString(2).padStart(6, '0')}) at ${JSON.stringify(bot.tile())} [energy ${bot.runEnergy}]`);
    }
    L(`puzzle done in ${bot.tickCount - t0} t`);
}

/** FE_RIDELOC=0: the walk-stop-op helpers (fa-lib opLocUntil/useOnLocUntil, fa2 opLocFromTile) instead of rideLoc (A/B) */
export const RIDELOC = process.env.FE_RIDELOC !== '0';
/**
 * Walk (core walkTo: opens closed doors) to within `near` tiles of the interaction tile, then route the rest + OPLOC/OPLOCU
 * in one tick, so the op lands the tick we arrive instead of the tick after a stop. Re-sent when it had no effect.
 * `stand` = the exact tile (one-sided locs: front door, bookcase, closet door); else the end of the reach-aware path.
 */
export async function rideLoc(bot: SpeedBot, loc: { id: number; x: number; z: number; level?: number }, act: { op?: number; use?: string },
    done: () => boolean, what: string, maxTicks = 200, stand?: Tile, near = 3): Promise<void> {
    const n = await nav(), lv = loc.level ?? bot.minusedlevel, l = locAt(loc.id, loc.x, loc.z, lv), end = bot.tickCount + maxTicks;
    let goal: Tile | null = stand ?? null;
    if (!goal) {
        const me = bot.tile(), fa = n.locForceApproach(l.id);
        if (!n.reachedLoc(lv, me.x, me.z, l.x, l.z, l.width, l.length, l.angle, l.shape, fa)) {
            const p = n.findPathToLoc(lv, me.x, me.z, l.x, l.z, l.width, l.length, l.angle, l.shape, 500, fa);
            const e = p[p.length - 1];
            if (e && n.reachedLoc(lv, e.x, e.z, l.x, l.z, l.width, l.length, l.angle, l.shape, fa)) goal = e;
        }
    }
    if (!done() && goal && cheb(bot.tile(), goal) > near) {
        closeChat(bot);
        await bot.walkTo(goal.x, goal.z, { near, maxTicks: Math.max(20, maxTicks - 10), log: false, closeDoors: true });
    }
    let sent = -99, tries = 0, prev = '', still = 0;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (dead(bot)) fail(bot, `died at ${what}`);
        const t = bot.tile(), k = `${t.x},${t.z},${bot.minusedlevel}`; still = k === prev ? still + 1 : 0; prev = k;
        // re-send only after standing still 4 t (a script with p_delays, e.g. the compost dig, is still running before that)
        if (sent < 0 || (still >= 4 && bot.tickCount - sent >= 5)) {
            if (++tries > 6) break;
            if (sent >= 0) console.log(`[fe] ${what}: re-send #${tries} from ${JSON.stringify(bot.pos())} msgs ${JSON.stringify(msgsSince(bot, sent))}`);
            // no effect and not on the interaction tile: an OPEN door leaf walls the static route (fe9: door 1530 (3106,3368),
            // leaf on (3106,3369), 5 silent re-sends). fa-lib walkSafe closes open leaves near us and walks onto the tile.
            if (sent >= 0 && goal && cheb(bot.tile(), goal) > 0) { await walkSafe(bot, goal, 0, 40); }
            closeChat(bot);
            if (act.use) useOnLocGo(bot, act.use, l, stand); else opLocGo(bot, l, act.op ?? 1, stand);
            sent = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, what);
}

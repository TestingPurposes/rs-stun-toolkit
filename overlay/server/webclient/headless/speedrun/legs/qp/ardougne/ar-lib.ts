// ar-lib.ts — lane-local helpers for the ardougne quest lane (max-QP build). Cheat-free: quest code imports these.
// Built on the framework (q-lib.ts, core.ts); nothing here edits shared files.
import { SpeedBot, objId, cheb, densify } from '../../../core.js';
import { stepCrossesDoorEdge } from '../../../../leanbot.js';
import * as locScene from '../../../../loc-scene.js';
import { nav, npc, opNpcGo, inDialog, walkOp, drive, dismiss, locAt, opLocGo, useOnLocGo, pickupGo, msgsSince, levelUpOpen, situation, navSync, turning, type Tile, type Wall } from '../../q-lib.js';

export type Item = { name: string; n: number };
const TRACE = (globalThis as any).process?.env?.QTRACE === '1';

/** One quest step failed: the message names the step and where we stood. */
export class StepError extends Error {}

export interface Ctx {
    bot: SpeedBot;
    t0: number;
    log: boolean;
    marks: Record<string, number>;
}
export function ctx(bot: SpeedBot, log = true): Ctx { return { bot, t0: bot.tickCount, log, marks: {} }; }
export function mark(c: Ctx, label: string): void {
    c.marks[label] = c.bot.tickCount - c.t0;
    if (c.log) console.log(`[ar +${String(c.bot.tickCount - c.t0).padStart(4)}] ${label} @${JSON.stringify(c.bot.pos())} hp=${c.bot.stat('hitpoints').cur}`);
}
export function fail(c: Ctx, label: string): never { throw new StepError(`${label} failed at ${JSON.stringify(c.bot.pos())} (+${c.bot.tickCount - c.t0} t) | ${situation(c.bot, 8)}`); }

/** Any npc/quest dialog or main modal open? */
export function anyModal(bot: SpeedBot): boolean { return bot.chatModalId !== -1 || bot.mainModalId !== -1; }

/** Walk to (near) `at`, open a dialog with the nearest npc of `type`, then drive it (5 resumes/tick, choices by text)
 *  until `done()`. The OPNPC rides the walk's last MOVE (walkOp). Retries the open up to 3 times. */
export async function talkTo(c: Ctx, type: number | number[], at: Tile | null, answers: RegExp[], done: () => boolean,
    o: { maxTicks?: number; label?: string; near?: number; closeAfter?: boolean } = {}): Promise<boolean> {
    const bot = c.bot, label = o.label ?? `talk ${type}`;
    const max = o.maxTicks ?? 400, t0 = bot.tickCount;
    const left = () => max - (bot.tickCount - t0);
    const opN = () => { const n = npc(bot, type); if (!n) return false; opNpcGo(bot, n, 1); return true; };
    let opens = 0;
    while (!done() && left() > 0 && opens < 6) {
        if (inDialog(bot)) {
            await drive(bot, () => (done() && (!o.closeAfter || !inDialog(bot))) || !inDialog(bot), answers, Math.min(60, left()));
            if (!done() && !inDialog(bot)) await bot.tick(1);   // dialog over but not done: a stale page / wrong branch
            continue;
        }
        if (levelUpOpen(bot)) bot.resumeDialogPage();
        const n = npc(bot, type);
        if (!n || n.d > 10) {
            // far / not in view: walk toward the spawn until the npc is close (no op: doors on the way are opened by walkOp)
            if (!at) fail(c, `${label}: npc ${type} not in view`);
            const ok = await walkLive(bot, at, { near: o.near ?? 2, maxTicks: Math.min(600, left()), done: () => inDialog(bot) || done() || (npc(bot, type)?.d ?? 99) <= 8 });
            if (!ok && (npc(bot, type)?.d ?? 99) > 10) { await bot.tick(1); opens++; }
            continue;
        }
        // route session 5 (allchaos qsjm Hazeel 'ceril-start': we stood on the open leaf 1534 of a mansion door (2565,3271) and
        // every OPNPC was discarded for 108 t): from the 3rd op, with a changed loc (an opened door leaf) on/next to our tile,
        // walk up to the npc with core walkTo (door-aware; the npc's tile is walkable)
        if (opens >= 2 && [...bot.liveLocs.keys()].some(k => { const [l, x, z] = k.split(',').map(Number); const me = bot.tile(); return l === bot.minusedlevel && Math.max(Math.abs(x! - me.x), Math.abs(z! - me.z)) <= 1; })) {
            try { await bot.walkTo(n.x, n.z, { near: 1, closeDoors: true, maxTicks: 60, log: false }); } catch { /* best effort */ }
        }
        // a closed door between us and the npc (the static planners treat doors as open): open it first
        await openDoorsToward(bot, n);
        const n1 = npc(bot, type) ?? n;
        opens++;
        await hopOp(bot, { x: n1.x, z: n1.z }, () => { opN(); }, () => inDialog(bot) || done(), 6, 2);
        if (!inDialog(bot) && !done()) { const n2 = npc(bot, type); if (n2 && n2.d <= 2) { opN(); await bot.until(() => inDialog(bot) || done(), 6); } }
    }
    const ok = done();
    if (ok) mark(c, label);
    return ok;
}

/** Door-aware approach + op. Far (> 20 tiles): walkOp toward `dest` (navgrid, closed doors on the route opened, the op
 *  rides the MOVE of the last chunk). Near: `op()` routes itself (MOVE_OPCLICK + op in one tick); a stall (no step for
 *  3 ticks while not yet next to `dest`) means live collision the static planners lack: a closed door crossed (opened)
 *  or an OPENED door leaf swung across the path (closed, core closeBlockingDoor), then the op is re-sent. */
export async function goOp(bot: SpeedBot, dest: Tile, op: () => void, done: () => boolean, extra = 0, loc?: LocRef): Promise<boolean> {
    // walkOp misses a closed door crossed by a DIAGONAL step: open doors on the path first when the target is close
    if (cheb(bot.tile(), dest) <= 12) await openDoorsToward(bot, dest, 3, loc);
    if (loc) {   // walk to the loc's real interaction tile (findLongPath to a blocked loc tile may end on the wrong side of a wall)
        try {
            const n = navSync(), me = bot.tile();
            const p = n.findPathToLoc(bot.minusedlevel, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, 500, n.locForceApproach(loc.id));
            if (p.length) dest = p[p.length - 1]!;
        } catch { /* keep dest */ }
    }
    if (cheb(bot.tile(), dest) > 12) {
        await walkLive(bot, dest, { near: 6, maxTicks: 600, done });
        if (done()) return true;
    }
    return hopOp(bot, dest, op, done, 8 + extra);
}
/** Short approach: send `op()` (it routes itself), re-send on a stall after fixing live doors. */
export async function hopOp(bot: SpeedBot, dest: Tile, op: () => void, done: () => boolean, settle = 8, tries = 4, exact = false): Promise<boolean> {
    for (let k = 0; k < tries && !done(); k++) {
        if (levelUpOpen(bot)) bot.resumeDialogPage();
        op(); bot.queueFlush();
        let last = '', still = 0;
        const end = bot.tickCount + Math.ceil(cheb(bot.tile(), dest) / 2) + settle;
        let stalled = false;
        while (!done() && bot.tickCount < end && !bot.disposed) {
            await bot.tick(1);
            const t = bot.tile(), key = `${t.x},${t.z},${bot.minusedlevel}`;
            still = key === last ? still + 1 : 0; last = key;
            if (still >= 3 && cheb(t, dest) > (exact ? 0 : 1) && !inDialog(bot)) { stalled = true; break; }
        }
        if (done()) break;
        if (stalled) {
            if (TRACE) console.log(`[ar] hopOp stalled at ${JSON.stringify(bot.tile())} -> ${JSON.stringify(dest)}`);
            if (!(await openDoorsToward(bot, dest))) await bot.closeBlockingDoor();
        }
    }
    return done();
}

/** Short walk to an exact tile with live-door handling (hopOp: closed doors on the path are opened, an opened leaf in the
 *  way is closed). For regular doors whose live state is unknown up front (chaos worlds, other players). */
export async function walkShort(bot: SpeedBot, dest: Tile, settle = 6, walls: Wall[] = []): Promise<boolean> {
    const at = () => { const t = bot.tile(); return t.x === dest.x && t.z === dest.z; };
    return hopOp(bot, dest, () => {
        const me = bot.tile();
        let pts: Tile[] = [];
        try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, dest.x, dest.z, 200, walls); } catch { pts = []; }
        const dense = densify([me, ...pts]).slice(1);
        if (dense.length) bot.sendRoute(turning(me, dense));
    }, at, settle, 5, true);
}

/** Door-aware walker (a lane copy of q-lib walkOp's core loop) with two fixes: (1) a DIAGONAL step whose cardinal half
 *  crosses a closed door counts as a door crossing, and the route is split into two cardinal steps through the doorway
 *  (the engine refuses diagonal moves past a wall; walkOp missed these and wedged ~20-70 t, CT3 2601,9639); (2) the door is
 *  opened from the cardinal stand tile. Opened leaves that wall off the path are closed after a stall. */
export async function walkLive(bot: SpeedBot, dest: Tile, o: { near?: number; maxTicks?: number; walls?: Wall[]; done?: () => boolean } = {}): Promise<boolean> {
    const n = navSync(), near = o.near ?? 0, level = bot.minusedlevel, t0 = bot.tickCount, maxTicks = o.maxTicks ?? 1500;
    const blocked: any[] = [...(o.walls ?? [])];
    const arrived = () => (o.done?.() ?? false) || (cheb(bot.tile(), dest) <= near && (near > 0 || (bot.tile().x === dest.x && bot.tile().z === dest.z)));
    const plan = (me: Tile): Tile[] | null => {
        let pts: Tile[] = [];
        if (cheb(me, dest) > 48 && !blocked.length) {
            try { pts = n.navFindPath(level, me.x, me.z, dest.x, dest.z); } catch { pts = []; }
            const ne = pts[pts.length - 1];
            if (ne && cheb(ne, dest) <= Math.max(near, 1)) return densify([me, ...pts]);
        }
        try { pts = n.findLongPath(level, me.x, me.z, dest.x, dest.z, 500, blocked); } catch { pts = []; }
        let end = pts[pts.length - 1];
        if (!end || cheb(end, dest) > Math.max(near, 1)) {
            let alt: Tile[] = [];
            try { alt = n.navFindPath(level, me.x, me.z, dest.x, dest.z); } catch { alt = []; }
            const ae = alt[alt.length - 1];
            if (ae && (!end || cheb(ae, dest) < cheb(end, dest))) { pts = alt; end = ae; }
        }
        return pts.length ? densify([me, ...pts]) : null;
    };
    const crossAt = (a: Tile, b: Tile) => {
        for (const q of [a, b]) {
            const cd = bot.doorTracker?.closedDoorAt(level, q.x, q.z);
            if (!cd) continue;
            const geo = n.getDoorAt(level, q.x, q.z);
            if (!geo || stepCrossesDoorEdge(geo, a, b)) return { x: q.x, z: q.z, locId: cd.locId, op: cd.op, geo };
        }
        return null;
    };
    let route: Tile[] | null = null, idx = 0, sentEnd = -1, stall = 0, lastKey = '', replans = 0, wedges = 0;
    let doorTick = -100, doorKey = '', doorTries = 0;
    while (!bot.disposed) {
        if (arrived()) return true;
        if (bot.tickCount - t0 > maxTicks || bot.minusedlevel !== level) return arrived();
        const me = bot.tile();
        const key = `${me.x},${me.z}`;
        stall = key === lastKey ? stall + 1 : 0; lastKey = key;
        if (stall === 3 && route) {
            // stuck on a tile the planner calls free: almost always an OPENED door leaf swung across the path (the static
            // collision has doors closed-and-passable). Close what stands open next to us first (cheap), then re-plan.
            if (await bot.closeBlockingDoor()) { if (TRACE) console.log(`[ar] walkLive: closed an open leaf next to ${key}`); route = null; stall = 0; lastKey = ''; continue; }
        }
        if (!route || (stall >= 3 && stall % 3 === 0)) {
            if (replans >= 10) {
                if (wedges >= 3) return arrived();
                wedges++; replans = 0;
                if (TRACE) console.log(`[ar] walkLive(${dest.x},${dest.z}) wedged at ${key}: closing an open leaf / waiting`);
                if (!(await bot.closeBlockingDoor())) await bot.tick(2);
                route = null; continue;
            }
            route = plan(me); replans++; idx = 0; sentEnd = -1;
            if (!route) { await bot.tick(1); continue; }
        }
        let j = -1;
        for (let i = Math.max(0, idx - 2); i < Math.min(route.length, idx + 10); i++) if (route[i]!.x === me.x && route[i]!.z === me.z) { j = i; break; }
        if (j < 0) j = route.findIndex(t => t.x === me.x && t.z === me.z);
        if (j < 0) { route = null; continue; }
        idx = j;
        // first closed door ahead (diagonal steps split through the doorway)
        let door: { i: number; x: number; z: number; locId: number; op: number; geo: any } | null = null;
        for (let i = idx; i < Math.min(route.length - 1, idx + 14) && !door; i++) {
            const a = route[i]!, b = route[i + 1]!;
            const hit = crossAt(a, b);
            if (hit) { door = { i, ...hit }; break; }
            if (a.x !== b.x && a.z !== b.z) {
                for (const h of [{ x: b.x, z: a.z }, { x: a.x, z: b.z }]) {
                    const hh = crossAt(a, h) ?? crossAt(h, b);
                    if (hh) { route.splice(i + 1, 0, h); door = { i: crossAt(a, h) ? i : i + 1, ...hh }; break; }
                }
            }
        }
        const segEnd = door ? door.i : route.length - 1;
        if (door && idx >= door.i) {
            const dk = `${door.x},${door.z}`;
            if (dk !== doorKey) { doorKey = dk; doorTries = 0; }
            if (bot.tickCount - doorTick >= 4) {
                if (doorTries >= 3) { if (door.geo) blocked.push(door.geo); route = null; continue; }
                bot.opLoc(door.x, door.z, door.locId, door.op); bot.queueFlush();
                doorTick = bot.tickCount; doorTries++;
            }
            await bot.tick(1); continue;
        }
        const remaining = sentEnd - idx;
        if (sentEnd < 0 || (sentEnd !== segEnd && remaining <= 4) || stall >= 2) {
            const steps = route.slice(idx + 1, segEnd + 1);
            const last = bot.sendRoute(turning(me, steps), !!door);
            if (last) {
                sentEnd = route.findIndex((t, k) => k > idx && t.x === last.x && t.z === last.z);
                if (door && sentEnd === segEnd) { bot.opLoc(door.x, door.z, door.locId, door.op); doorTick = bot.tickCount; doorKey = `${door.x},${door.z}`; doorTries = 1; }
                bot.queueFlush();
            }
        }
        await bot.tick(1);
    }
    return arrived();
}

/** The first CLOSED door (live door tracker) on the planner's path from us to `t`, or null. The static planners treat
 *  doors as open. A diagonal step counts as crossing a door when either of its two cardinal halves does (the engine
 *  refuses a diagonal step past a wall). */
export type LocRef = { id: number; x: number; z: number; width: number; length: number; angle: number; shape: number };
export function closedDoorOn(bot: SpeedBot, t: { x: number; z: number }, loc?: LocRef): { x: number; z: number; locId: number; op: number; from?: Tile } | null {
    let n: ReturnType<typeof navSync>;
    try { n = navSync(); } catch { return null; }
    const me = bot.tile(), level = bot.minusedlevel;
    let pts: Tile[] = [];
    try {
        pts = loc ? n.findPathToLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, 200, n.locForceApproach(loc.id))
                  : n.findLongPath(level, me.x, me.z, t.x, t.z, 200);
    } catch { return null; }
    const path = densify([me, ...pts]);
    const crosses = (a: Tile, b: Tile) => {
        for (const q of [a, b]) {
            const cd = bot.doorTracker?.closedDoorAt(level, q.x, q.z);
            if (!cd) continue;
            const geo = n.getDoorAt(level, q.x, q.z);
            if (!geo || stepCrossesDoorEdge(geo, a, b)) return { x: q.x, z: q.z, locId: cd.locId, op: cd.op };
        }
        return null;
    };
    for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]!, b = path[i + 1]!;
        const hit = crosses(a, b) ?? (a.x !== b.x && a.z !== b.z ? (crosses(a, { x: b.x, z: a.z }) ?? crosses(a, { x: a.x, z: b.z }) ?? crosses({ x: b.x, z: a.z }, b) ?? crosses({ x: a.x, z: b.z }, b)) : null);
        if (hit) return { ...hit, from: a };
    }
    return null;
}
/** Open every closed door between us and `t` (op it from where we stand: doors on/next to our tile). */
export async function openDoorsToward(bot: SpeedBot, t: { x: number; z: number }, maxDoors = 3, loc?: LocRef): Promise<number> {
    let opened = 0;
    const tries = new Map<string, number>();
    for (let k = 0; k < maxDoors * 3; k++) {
        const d = closedDoorOn(bot, t, loc);
        if (TRACE) console.log(`[ar] openDoorsToward(${t.x},${t.z}) from ${JSON.stringify(bot.tile())}: door ${JSON.stringify(d)}`);
        if (!d) break;
        const key = `${d.x},${d.z}`, n = (tries.get(key) ?? 0) + 1;
        tries.set(key, n);
        if (n > 3) break;   // will not open from here: let the caller's walker/stall logic take over
        if (cheb(bot.tile(), d) > 2) {
            await walkLive(bot, d, { near: 2, maxTicks: 60, done: () => !bot.doorTracker?.closedDoorAt(bot.minusedlevel, d.x, d.z) });
        }
        // stand on OUR side of the door edge, cardinally next to it (the door tile or its neighbour across the edge), and
        // send MOVE + OPLOC in one tick: an OPLOC from a diagonal neighbour is dropped, and rsmod reach for wall locs
        // accepts diagonals, so opLocGo would not move us
        const geo = navSync().getDoorAt(bot.minusedlevel, d.x, d.z);
        let stand: Tile | null = null;
        if (geo) {
            const off = [[-1, 0], [0, 1], [1, 0], [0, -1]][geo.angle & 3]!;
            const a = { x: d.x, z: d.z }, b = { x: d.x + off[0]!, z: d.z + off[1]! };
            const side = d.from ?? bot.tile();
            stand = cheb(side, a) <= cheb(side, b) ? a : b;
            const me = bot.tile();
            if (me.x !== stand.x || me.z !== stand.z) {
                let pts: Tile[] = [];
                try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, stand.x, stand.z, 50); } catch { pts = []; }
                const dense = densify([me, ...pts]).slice(1);
                if (dense.length) bot.sendRoute(turning(me, dense), true);
            }
        }
        bot.opLoc(d.x, d.z, d.locId, d.op); bot.queueFlush();
        const p0 = bot.tile();
        await bot.until(() => !bot.doorTracker?.closedDoorAt(bot.minusedlevel, d.x, d.z), 3);
        if (!bot.doorTracker?.closedDoorAt(bot.minusedlevel, d.x, d.z)) { opened++; continue; }
        // no effect and we could not reach our stand tile: an OPEN leaf of another door (or this one, the tracker being
        // stale) is in the way: close what stands open next to us (core closeBlockingDoor), then try again
        const me = bot.tile();
        if (stand && (me.x !== stand.x || me.z !== stand.z) && cheb(me, p0) === 0) {
            if (TRACE) console.log(`[ar] openDoorsToward: stuck at ${JSON.stringify(me)} short of ${JSON.stringify(stand)}: closing an open leaf`);
            await bot.closeBlockingDoor();
        }
    }
    return opened;
}

/** Drive the open dialog until it closes (or `until()`), answering by text. */
export async function finishDialog(bot: SpeedBot, answers: RegExp[] = [/.*/], maxTicks = 30, until?: () => boolean): Promise<boolean> {
    return drive(bot, () => (until ? until() : false) || !inDialog(bot), answers, maxTicks);
}

/** locAt that also accepts a DYNAMIC loc id (loc_change'd: an opened chest/cupboard is not in the static scene): falls back
 *  to the static loc on that tile with the id replaced (same footprint). */
export function locAtAny(id: number, x: number, z: number, level: number): ReturnType<typeof locAt> {
    try { return locAt(id, x, z, level); } catch { /* dynamic */ }
    const l = locScene.getLocsAt(x, z, level, { includeUnnamed: true }).find(q => q.shape === 10 || q.shape === 11) ?? locScene.getLocsAt(x, z, level, { includeUnnamed: true })[0];
    if (!l) throw new Error(`no loc at L${level}(${x},${z}) for ${id}`);
    return { ...l, id };
}

/** Op a loc (route + OPLOC in one tick), retried, until `done()`. Dialog pages that open are driven with `answers`. */
export async function opLocUntil(c: Ctx, loc: { id: number; x: number; z: number; level?: number }, op: number, done: () => boolean,
    o: { label?: string; maxTicks?: number; answers?: RegExp[]; stand?: Tile; tries?: number } = {}): Promise<boolean> {
    const bot = c.bot, label = o.label ?? `oploc ${loc.id}`;
    const l = locAtAny(loc.id, loc.x, loc.z, loc.level ?? bot.minusedlevel);
    for (let k = 0; k < (o.tries ?? 4) && !done(); k++) {
        if (inDialog(bot)) { await finishDialog(bot, o.answers ?? [/.*/], 20, done); if (done()) break; }
        dismiss(bot);
        // route runner (fix 106, chaos qrk2m Hazeel 'mansion-up' with a door in a random state on the way): from the 2nd try,
        // walk up with core walkTo first (it opens closed doors and closes an opened leaf that walls the route)
        // (chaos qrk4m: we stood ON the opened leaf 1534 of door 1533 at (2568,3271), whose wall blocks the step south to the
        // stairs: close an open leaf on/next to our tile first)
        if (k > 0) { try { if (await bot.closeBlockingDoor()) await bot.tick(2); } catch { /* none */ } }
        // route session 5 (allchaos qsbm Hazeel 'mansion-up': every OPLOC discarded for 356 t, ACK-NOACK, modals -1/-1 client
        // side): from the 3rd try close any server-side modal before the op
        // (no blind 1-tile walkTo: a wedged walkTo falls back to the LeanBot traveller, whose planner can spin: qsfp watchdog kill)
        if (k > 1) { try { (bot as any).closeModal?.(); await bot.tick(1); } catch { /* best effort */ } }
        if (k > 0 && cheb(bot.tile(), { x: l.x, z: l.z }) > 2) await bot.walkTo(l.x, l.z, { near: 2, closeDoors: true, maxTicks: 120, log: false, level: bot.minusedlevel });
        await goOp(bot, o.stand ?? { x: l.x, z: l.z }, () => { opLocGo(bot, l, op, o.stand); }, () => done() || inDialog(bot), o.maxTicks ?? 0, o.stand ? undefined : l);
        if (!done() && inDialog(bot)) await finishDialog(bot, o.answers ?? [/.*/], 20, done);
    }
    const ok = done();
    if (ok) mark(c, label);
    return ok;
}

/** Use a held item on a loc, retried, until `done()`. */
export async function useOnLocUntil(c: Ctx, item: string | number, loc: { id: number; x: number; z: number; level?: number }, done: () => boolean,
    o: { label?: string; answers?: RegExp[]; stand?: Tile; tries?: number } = {}): Promise<boolean> {
    const bot = c.bot, label = o.label ?? `use ${item} on ${loc.id}`;
    const l = locAtAny(loc.id, loc.x, loc.z, loc.level ?? bot.minusedlevel);
    for (let k = 0; k < (o.tries ?? 4) && !done(); k++) {
        if (bot.count(item) === 0) break;
        dismiss(bot);
        await goOp(bot, o.stand ?? { x: l.x, z: l.z }, () => { if (bot.count(item)) useOnLocGo(bot, item, l, o.stand); }, () => done() || inDialog(bot), 0, o.stand ? undefined : l);
        if (!done() && inDialog(bot)) await finishDialog(bot, o.answers ?? [/.*/], 20, done);
    }
    const ok = done();
    if (ok) mark(c, label);
    return ok;
}

/** Pick up a ground obj (route + OPOBJ3), retried. */
export async function pickup(c: Ctx, item: string, at: Tile, o: { label?: string; n?: number } = {}): Promise<boolean> {
    const bot = c.bot, want = bot.count(item) + (o.n ?? 1);
    for (let k = 0; k < 4 && bot.count(item) < want; k++) {
        dismiss(bot);
        await goOp(bot, at, () => { pickupGo(bot, item, at); }, () => bot.count(item) >= want, 0);
    }
    const ok = bot.count(item) >= want;
    if (ok) mark(c, o.label ?? `pickup ${item}`);
    return ok;
}

/** Wear/wield held items (OPHELD2), wait until worn. */
export async function wear(bot: SpeedBot, names: string[], maxTicks = 4): Promise<boolean> {
    const ids = names.map(objId).filter(id => !bot.isWorn(id) && bot.slotOf(id) >= 0);
    if (!ids.length) return names.every(n => bot.isWorn(objId(n)));
    bot.burst(ids.map(id => () => bot.opHeld2(id, bot.slotOf(id))));
    return bot.until(() => ids.every(id => bot.isWorn(id)), maxTicks);
}

/** Use held item `a` on held item `b` (OPHELDU), wait for `done()`; dismisses the result box. */
export async function combine(bot: SpeedBot, a: string, b: string, done: () => boolean, maxTicks = 4): Promise<boolean> {
    const sa = bot.slot(a), sb = bot.slot(b);
    if (sa < 0 || sb < 0) return done();
    bot.useItemOnItem(objId(b), sb, objId(a), sa); bot.queueFlush();
    return bot.until(done, maxTicks);
}

/** Wait for a game message matching `re` since tick `since` (or now). */
export function msgSince(bot: SpeedBot, re: RegExp, since: number): boolean { return msgsSince(bot, since).some(t => re.test(t)); }

/** Any IF_SETTEXT currently showing text matching `re` (dialog page text). */
export function pageText(bot: SpeedBot, re: RegExp): boolean { for (const v of bot.ifText.values()) if (re.test(v)) return true; return false; }

/** All IF_SETTEXT texts joined in component order (a chat page wraps its text over 4-5 line components). */
export function allText(bot: SpeedBot): string { return [...bot.ifText.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).join(' '); }
/** A text that appears in a dialog page or game message at any point from now on (sticky; checked each call). Dialog text
 *  is matched against the joined page (lines wrap), messages one by one. Text already showing at the call is ignored. */
export function textWatch(bot: SpeedBot, re: RegExp): () => boolean {
    const since = bot.tickCount; let seen = false;
    const snap = new Map(bot.ifText);
    return () => {
        if (seen) return true;
        let changed = false;
        for (const [k, v] of bot.ifText) if (snap.get(k) !== v) { changed = true; break; }
        if (changed && re.test(allText(bot))) seen = true;
        if (!seen && msgsSince(bot, since).some(t => re.test(t))) seen = true;
        return seen;
    };
}

/** Fail-fast death watch (returns a stop fn). Sets `dead` on the ctx marks. */
const FOODS = ['shark', 'swordfish', 'lobster', 'monkfish', 'bass', 'tuna', 'salmon', 'trout', 'cake', '2/3_cake', 'chocolate_slice'];
export function deathWatch(c: Ctx): { dead: () => boolean; stop: () => void } {
    let dead = false, stopped = false, lastEat = -10;
    (async () => {
        while (!stopped && !c.bot.disposed) {
            const h = c.bot.stat('hitpoints');
            if (h.level > 0 && h.cur === 0) { dead = true; c.marks.died = c.bot.tickCount - c.t0; return; }
            // eat at 50% hp (QP-BUILD.md �2), at most every 3 ticks, never inside a dialog (the click would be swallowed)
            if (h.level > 0 && h.cur * 2 <= h.level && c.bot.tickCount - lastEat >= 3 && !inDialog(c.bot)) {
                for (const f of FOODS) {
                    let id = -1; try { id = objId(f); } catch { continue; }
                    const slot = c.bot.slotOf(id);
                    if (slot >= 0) { c.bot.opHeld1(id, slot); c.bot.queueFlush(); lastEat = c.bot.tickCount; c.marks.ate = (c.marks.ate ?? 0) + 1; break; }
                }
            }
            await c.bot.tick(1);
        }
    })();
    return { dead: () => dead, stop: () => { stopped = true; } };
}

export { cheb, dismiss, inDialog };

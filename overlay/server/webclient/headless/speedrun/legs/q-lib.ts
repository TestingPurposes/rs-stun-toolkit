// q-lib.ts — shared helpers for the q-* quest drivers (speedrun). LOCAL ONLY for tests.
//
// DIALOG BURST (measured on the local engine, see the q-* reports): RESUME_PAUSEBUTTON and the choice IF_BUTTON
// both run the suspended script synchronously inside the packet handler (ResumePauseButtonHandler /
// IfButtonHandler -> player.executeScript), so the NEXT page is open before the next packet is read. A whole
// conversation can therefore be sent in ONE burst the tick its first page is visible: the engine runs up to 5
// successful USER_EVENT packets per tick and carries the rest over in order. A packet that does not apply (a
// resume while a choice is open, a choice com that is not visible) returns false: it is DROPPED, not counted
// and not retried. So a plan that is exact runs at 5 pages/tick; a plan that is wrong degrades to the adaptive
// fallback (answer by option text / resume) one tick later.
import { reconnectsOf } from './qp/route/drops.js';
import { ClientProt } from '#/io/ClientProt.js';   // rev 289: opcodes by name
import { SpeedBot, initNav, densify, objId, objDebugName, spellCom, cheb, NAVGRID_STATS, WILD_WARNING_MODAL } from '../core.js';
import { stepCrossesDoorEdge } from '../../leanbot.js';
import { readFileSync } from 'fs';
import * as rsmodPF from '../../../../vendor/rsmod-pathfinder';
import { isTileWalkable } from '../../../../../sdk/pathfinding';
import { resolve, join } from 'path';
import { readdirSync, statSync } from 'fs';
import * as locScene from '../../loc-scene.js';
import { tempBlockStep, leafWallList } from '../leaf-walls.js';

/**
 * Behaviour switches for the shared quest-lib helpers. Each one is ON by default because it
 * only changes what happens in the case that used to fail silently; set the env var to 0 (or flip the field) for the old path.
 *   doorAware   QLIB_DOOR_AWARE=0     opNpcGo/opLocGo/useOnLocGo/useOnNpcGo open a CLOSED door (live tracker) on the route first
 *                                     instead of sending an op the server discards; a cardinal npc across a wall is not adjacent
 *   noRouteBail QLIB_NOROUTE_BAIL=0   walkOp gives up after 3 plans in a row found no route (was: re-plan every tick to maxTicks)
 *   learnSteps  QLIB_LEARN_STEPS=0    walkOp walls a step the server keeps refusing (no known door explains it) for that walk
 *   finishPages QLIB_TELE_PAGES=0     tele() finishes/closes an open dialog and waits out a same-tick CLOSE_MODAL before the click
 *   walkClear   QLIB_WALK_CLEAR=1     walkOp sends a pure walk (no door op / finalOp in that flush) as MOVE_GAMECLICK (385a; opt-in since fix 391)
 */
export const QLIB = {
    doorAware: process.env.QLIB_DOOR_AWARE !== '0',
    noRouteBail: process.env.QLIB_NOROUTE_BAIL !== '0',
    learnSteps: process.env.QLIB_LEARN_STEPS !== '0',
    finishPages: process.env.QLIB_TELE_PAGES !== '0',
    // session 11 fix 391 (qx315-324 @99bdb995: 385a as a global default killed the main in Eadgar 4/10 (A/B e391a-g): a
    // 'done' check that passes on the door tile before the server ran the door op lost that op to the next GAMECLICK walk).
    // 385a is now OPT-IN: legends segC turns it on for its own walks (seg-c.ts segC wrapper); QLIB_WALK_CLEAR=1 forces it on.
    walkClear: process.env.QLIB_WALK_CLEAR === '1',   // session 11 fix 385a
};

export type Tile = { x: number; z: number };
/** An extra wall edge for the planner (live collision the static rsmod map lacks): shape 0, angle 0=W 1=N 2=E 3=S side of (x,z). */
export type Wall = { level: number; x: number; z: number; shape: number; angle: number; blockrange?: boolean };
/** 'R' = continue (RESUME_PAUSEBUTTON); a number = IF_BUTTON on that component (a choice option);
 *  'X' = CLOSE_MODAL; a function = any other sender (OPNPC, MOVE...) placed in order in the burst. */
export type Tok = 'R' | 'X' | number | (() => void);
export const R = 'R' as const, X = 'X' as const;
/** multiN option component ids (capability-tables DIALOG_ROOTS): M2[0] = option 1 of a 2-option choice. */
export const M2 = [2461, 2462], M3 = [2471, 2472, 2473], M4 = [2482, 2483, 2484, 2485], M5 = [2494, 2495, 2496, 2497, 2498];
export const QP_VARP = 101;   // %qp, transmit=yes — the only quest varp the client sees

export function qp(bot: SpeedBot): number { return bot.getVarp(QP_VARP); }

/** Level-up chat modals (interface.pack `levelup_<skill>` roots). They are chat modals like an npc dialog page but
 *  belong to no conversation: a MOVE/op closes them, a RESUME continues them. */
export const LEVELUP_IDS: Set<number> = (() => {
    const s = new Set<number>();
    try {
        const txt = readFileSync(resolve(import.meta.dir, '../../../../content/pack/interface.pack'), 'utf8');
        for (const m of txt.matchAll(/^(\d+)=levelup_[a-z]+\s*$/gm)) s.add(Number(m[1]));
    } catch { /* table missing: treat nothing as a level-up */ }
    return s;
})();
/** An npc/quest dialog page (not a level-up) is open. */
export function inDialog(bot: SpeedBot): boolean { return bot.chatModalId !== -1 && !LEVELUP_IDS.has(bot.chatModalId); }
export function levelUpOpen(bot: SpeedBot): boolean { return LEVELUP_IDS.has(bot.chatModalId); }

/** The tutorial-skip starter kit (tutorial.rs2:303-321) minus the runes a teleport uses. */
export const KIT_JUNK = ['bronze_axe', 'tinderbox', 'net', 'shrimp', 'bucket_empty', 'pot_empty', 'bread', 'bronze_pickaxe',
    'bronze_dagger', 'bronze_sword', 'wooden_shield', 'shortbow', 'bronze_arrow', 'mindrune', 'earthrune', 'bodyrune'];
/** Burst-drop every stack of these objs (no wait). Drops are no-delay and do not stop walking. */
export function dropAllOf(bot: SpeedBot, objs: Array<number | string>): number {
    const k = new Set(objs.map(objId)); let n = 0;
    for (const s of bot.inv()) if (k.has(s.obj)) { bot.dropItem(s.obj, s.slot); n++; }
    bot.queueFlush();
    return n;
}
export function log(bot: SpeedBot, t0: number, s: string): void { console.log(`[q +${String(bot.tickCount - t0).padStart(4)}] ${s}`); }

/** Compress 1-tile steps (starting AFTER `from`) to turning points (copy of core's private helper). */
export function turning(from: Tile, steps: Tile[]): Tile[] {
    const out: Tile[] = []; let prev = from, dir = '';
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!; const d = `${Math.sign(s.x - prev.x)},${Math.sign(s.z - prev.z)}`;
        if (i > 0 && d !== dir) out.push(prev);
        dir = d; prev = s;
    }
    if (steps.length) out.push(steps[steps.length - 1]!);
    return out;
}

// ---------------------------------------------------------------------------------------------------------
// npcs
// ---------------------------------------------------------------------------------------------------------
export interface NpcRef { idx: number; type: number; x: number; z: number; d: number }
export function npcsOf(bot: SpeedBot, type: number | number[]): NpcRef[] {
    const types = new Set(Array.isArray(type) ? type : [type]);
    const me = bot.tile(); const out: NpcRef[] = [];
    for (let i = 0; i < bot.npcCount; i++) {
        const idx = bot.npcIndices[i]!; const n = bot.npcs[idx];
        if (!n || !types.has(n.typeId)) continue;
        const t = bot.npcTileOf(n);
        out.push({ idx, type: n.typeId, x: t.x, z: t.z, d: cheb(t, me) });
    }
    return out.sort((a, b) => a.d - b.d);
}
export function npc(bot: SpeedBot, type: number | number[]): NpcRef | null { return npcsOf(bot, type)[0] ?? null; }

/** A level-up page or an objbox "You can now ..." unlock page is open (core SpeedBot.blockingPageOpen): it blocks every
 *  MOVE/op until continued and belongs to no conversation. */
export function blockingPageOpen(bot: SpeedBot): boolean { return bot.blockingPageOpen(); }
/** Continue a blocking page / close the wilderness warning before an op that sends no MOVE (sendRoute does both itself). */
function clearBlockers(bot: SpeedBot): void {
    if (bot.blockingPageOpen()) bot.resumeDialogPage();
    if (bot.closeWildWarning && bot.mainModalId === WILD_WARNING_MODAL) { bot.closeModal(); bot.mainModalId = -1; }
}

/** Is the single step a->b open right now: the planner map has it AND no CLOSED door (live tracker) sits on it? */
export function stepOpen(bot: SpeedBot, level: number, a: Tile, b: Tile): boolean {
    let p: Tile[] = [];
    try { p = navSync().findLongPath(level, a.x, a.z, b.x, b.z, 4); } catch { p = []; }
    if (!(p.length === 1 && p[0]!.x === b.x && p[0]!.z === b.z)) return false;
    return !closedDoorOnRoute(bot, level, [a, b], 0, 1);
}

export interface RouteDoor { i: number; x: number; z: number; locId: number; op: number; stand?: Tile }
/**
 * The first CLOSED door (live door tracker) a dense route crosses in route[from .. from+look). A diagonal step counts as its
 * two cardinal legs (the engine refuses a diagonal when either leg is walled, so a diagonal past a closed door's corner is
 * blocked too: ar-lib closedDoorOn, the Sanfew's-house wedge). `stand` = the tile to op it from when that is not route[i]
 * (the door sits on a diagonal step's corner tile).
 */
export function closedDoorOnRoute(bot: SpeedBot, level: number, route: Tile[], from: number, look = 14): RouteDoor | null {
    const tr = bot.doorTracker; if (!tr) return null;
    const n = navSync();
    for (let i = Math.max(0, from); i < Math.min(route.length - 1, from + look); i++) {
        const a = route[i]!, b = route[i + 1]!;
        const diag = a.x !== b.x && a.z !== b.z;
        const corners = diag ? [{ x: b.x, z: a.z }, { x: a.x, z: b.z }] : [];
        for (const t of [a, b, ...corners]) {
            const cd = tr.closedDoorAt(level, t.x, t.z);
            if (!cd) continue;
            // session 11 fix 394 (qx327-331/334 'dimintheis finish: npc 664 not opened', 81469d9e): a door whose STATIC placement is
            // its OPEN leaf (Dimintheis 1531@3278,3404 a3) has no navgrid geometry at the live CLOSED leaf's tile (1530@3277,3404 a2),
            // so the 'door ON the route' rule flagged the step INTO that tile and every op went out from the tile before it (diagonal /
            // wrong side = never in reach; simdoors boot-closed seeds failed 5/6; fix 393 removed the accident that hid it). Take the
            // edge from the zone stream (liveLocInfo shape/angle): the door is met on the step that CROSSES it. QLIB_LIVE_DOORGEO=0 reverts.
            const li = process.env.QLIB_LIVE_DOORGEO !== '0' ? bot.liveLocInfo.get(`${level},${t.x},${t.z}`) : undefined;
            const geo = n.getDoorAt(level, t.x, t.z) ?? (li && li.id === cd.locId && li.shape >= 0 && li.angle >= 0 ? { x: t.x, z: t.z, shape: li.shape, angle: li.angle } : undefined);
            const legs: Array<[Tile, Tile]> = diag ? [[a, corners[0]!], [corners[0]!, b], [a, corners[1]!], [corners[1]!, b]] : [[a, b]];
            if (geo) { if (!legs.some(([p, q]) => stepCrossesDoorEdge(geo, p, q))) continue; }
            else if (t !== a && t !== b) continue;   // no edge geometry: only a door ON the route counts
            const stand = diag && t !== a && t !== b && (!geo || !stepCrossesDoorEdge(geo, a, t)) ? { x: t.x, z: t.z } : undefined;
            return { i, x: t.x, z: t.z, locId: cd.locId, op: cd.op, stand };
        }
    }
    return null;
}
/** Door-aware ops give a door ONE try per 50 ticks: if the tracker still calls it closed after that (a door the engine does not
 *  open from here; sim chaos 8801, Hazeel mansion door 1533 @2569,3273: 4 silent ops, +30 t), the caller's own op goes out as
 *  before (the old path), so the switch can never cost more than one attempt. */
function doorTryAllowed(bot: SpeedBot, d: RouteDoor): boolean {
    const m: Map<string, number> = ((bot as any).__qDoorTried ??= new Map());
    const k = `${bot.minusedlevel},${d.x},${d.z}`, t = m.get(k);
    if (t !== undefined && bot.tickCount - t < 50) return false;
    m.set(k, bot.tickCount);
    return true;
}
/** Walk to the door's op tile (MOVE_OPCLICK, no op), or — standing on it — OPLOC the door. Returns the tiles sent, or null when
 *  this door already had its try (doorTryAllowed): the caller then sends its own op (the old path). route[0] must be our tile.
 *  The op goes out only from the stand: route + door OPLOC in one tick from a few tiles away was silently not taken (sim chaos
 *  8801, Hazeel mansion door 1533 @2569,3273 a dynamic loc from the chaos boot; the same OPLOC sent standing opened it). */
function goOpenDoor(bot: SpeedBot, route: Tile[], d: RouteDoor): number | null {
    const me = bot.tile();
    const steps = route.slice(1, d.i + 1);
    if (d.stand && !(d.stand.x === me.x && d.stand.z === me.z)) steps.push(d.stand);
    if (steps.length) { bot.sendRoute(turning(me, steps), true); bot.queueFlush(); return steps.length; }
    if (!doorTryAllowed(bot, d)) return null;
    clearBlockers(bot);
    bot.opLoc(d.x, d.z, d.locId, d.op); bot.queueFlush();
    (bot as any).__qDoorOpTick = bot.tickCount;
    if (process.env.QLIB_DEBUG === '1') console.log(`[qlib] door ${d.locId}@${d.x},${d.z} opened from ${me.x},${me.z} (+${steps.length} steps)`);
    return steps.length;
}

/** Path (rsmod) to a tile next to the npc, sent as MOVE_OPCLICK, then OPNPC in the same tick.
 *  QLIB.doorAware: a cardinal neighbour across a wall / closed door is not adjacent (the engine never starts the interaction:
 *  Hetty in her doorway, fb-lib opNpcReach), and a CLOSED door on the route is opened instead (route + OPLOC; the npc op
 *  follows on the caller's next try — the old path sent an OPNPC the engine parked behind the door with no message). */
export function opNpcGo(bot: SpeedBot, n: NpcRef, op = 1): number { return approachNpc(bot, n, () => bot.opNpc(n.idx, op)); }
/** opNpcGo's routing (adjacency, closed doors, standing on the npc) with any final sender (OPNPC, OPNPCU, OPNPCT...). */
export function approachNpc(bot: SpeedBot, n: NpcRef, send: () => void, o: { doors?: boolean } = {}): number {
    const me = bot.tile();
    let tiles = 0;
    const adjacentCardinal = (Math.abs(me.x - n.x) + Math.abs(me.z - n.z)) === 1 && (!QLIB.doorAware || stepOpen(bot, bot.minusedlevel, me, n));
    if (!adjacentCardinal) {
        const nav = navSync();
        let pts: Tile[] = [];
        try { pts = nav.findLongPath(bot.minusedlevel, me.x, me.z, n.x, n.z, 500); } catch { pts = []; }
        let dense = densify([me, ...pts]).slice(1);
        // stop on the last tile before the npc's own tile
        while (dense.length && cheb(dense[dense.length - 1]!, n) === 0) dense.pop();
        tiles = dense.length;
        // session 11 fix 347 (qx135p witchpot 'rat: kill/loot not done', 244 t: the rat on the doorway tile 2956,3205, us
        // outside at 2956,3206, door 1530 closed between; findLongPath steps through the door, the npc's own tile is popped,
        // dense is empty, so this check never ran and every OPNPC was parked behind the door, optrace 'apcalled false' 310 t):
        // an npc one step away across a closed door counts too (route [me, npc]); goOpenDoor ops it from here. WP_DOORNPC=0 reverts.
        if (QLIB.doorAware && o.doors !== false && (dense.length || (cheb(me, n) === 1 && process.env.WP_DOORNPC !== '0'))) {
            const d = closedDoorOnRoute(bot, bot.minusedlevel, [me, ...dense, { x: n.x, z: n.z }], 0, dense.length + 1);
            const r = d ? goOpenDoor(bot, [me, ...dense, { x: n.x, z: n.z }], d) : null;
            if (r !== null) return r;
        }
        if (dense.length) bot.sendRoute(turning(me, dense), true);
        else if (cheb(me, n) === 0) {
            // standing ON the npc's tile (npcs do not block players: Garkor walks onto his own stand, Zooknock wanders
            // onto ours). The engine then never starts the interaction (no dialog for 60-300 t, sim-proven twice):
            // step to a free cardinal neighbour in the same burst, the OPNPC follows.
            const off = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: me.x + dx!, z: me.z + dz! }))
                .find(t => { try { return isTileWalkable(bot.minusedlevel, t.x, t.z); } catch { return false; } });
            if (off) { bot.sendRoute([off], true); tiles = 1; }
        }
    }
    // FINAL3 (PX3, ported from FINAL8): a level-up page left open by the last xp drop (spell, potion, quest reward)
    // blocks the interaction; core sendRoute continues it before a MOVE, but an adjacent op sends no MOVE: continue it here
    // (also the objbox unlock page and the wilderness warning)
    clearBlockers(bot);
    send();
    bot.queueFlush();
    return tiles;
}
/** The route half of opNpcGo, no npc op (the caller adds OPNPC/OPNPCU in the same flush): fa-lib / mo-lib / we-lib routeNextTo.
 *  A cardinal neighbour across a wall is not adjacent (QLIB.doorAware); NO door op here (the caller's npc op in the same
 *  flush would override it). Returns the tiles sent. */
export function routeNextTo(bot: SpeedBot, n: NpcRef): number { return approachNpc(bot, n, () => { /* caller's op */ }, { doors: false }); }
/** opNpcGo with OPNPCU: use backpack `obj` on the npc (route next to it in the same tick, door-aware). lib-troll useOnNpcGo. */
export function useOnNpcGo(bot: SpeedBot, n: NpcRef, obj: number | string): number {
    const id = objId(obj), slot = bot.slot(id);
    if (slot < 0) throw new Error(`useOnNpcGo: ${objDebugName(id)} not held`);
    return approachNpc(bot, n, () => bot.useItemOnNpc(n.idx, id, slot));
}
/** OPHELD<op> on a backpack item (op 4 = Rub on jewellery, 1 = Read/Eat/Bury, 3/5 = Empty/Drop-like). False if not held. */
export function opHeld(bot: SpeedBot, obj: number | string, op: 1 | 2 | 3 | 4 | 5, slot?: number): boolean {
    const id = objId(obj), s = slot ?? bot.slot(id);
    if (s < 0) return false;
    if (op === 5 && bot.gloryGuard && /^amulet_of_glory(_[1-4])?$/.test(objDebugName(id))) { console.log(`[glory-guard] refused op5 (drop) on ${objDebugName(id)}`); return false; }
    const prot = [0, ClientProt.OPHELD1, ClientProt.OPHELD2, ClientProt.OPHELD3, ClientProt.OPHELD4, ClientProt.OPHELD5][op]!;
    const o = (bot as any).out; o.p1Enc(prot); o.p2(id); o.p2(s); o.p2(3214);   // inventory:inv
    bot.queueFlush();
    return true;
}

// ---------------------------------------------------------------------------------------------------------
// locs / objs
// ---------------------------------------------------------------------------------------------------------
let NAVS: Awaited<ReturnType<typeof initNav>> | null = null;
export function navSync() { if (!NAVS) throw new Error('initNav first'); return NAVS; }
export async function nav() { return (NAVS ??= await initNav()); }

export function locAt(id: number, x: number, z: number, level = 0): locScene.SceneLoc {
    const l = locScene.getLocsAt(x, z, level, { includeUnnamed: true }).find(s => s.id === id);
    if (!l) throw new Error(`loc ${id} not at L${level}(${x},${z})`);
    return l;
}
/** Route (MOVE_OPCLICK) to an interaction tile of `loc` (or to `stand` if given). No op sent.
 *  QLIB.doorAware: a CLOSED door (live tracker) on that route is opened instead (route to it + OPLOC) and `opened` is set:
 *  the caller's loc op would be discarded behind it. */
export function routeToLoc(bot: SpeedBot, loc: locScene.SceneLoc, stand?: Tile): number { return routeToLocD(bot, loc, stand).tiles; }
export function routeToLocD(bot: SpeedBot, loc: locScene.SceneLoc, stand?: Tile): { tiles: number; opened: boolean } {
    const n = navSync(); const me = bot.tile(), level = bot.minusedlevel;
    let path: Tile[];
    if (stand) {
        if (me.x === stand.x && me.z === stand.z) return { tiles: 0, opened: false };
        path = n.findLongPath(level, me.x, me.z, stand.x, stand.z, 500);
    } else {
        const fa = n.locForceApproach(loc.id);
        if (n.reachedLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa)) return { tiles: 0, opened: false };
        path = n.findPathToLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, 500, fa);
    }
    const dense = densify([me, ...path]).slice(1);
    if (process.env.QLIB_DEBUG === '1') console.log(`[qlib] routeToLoc ${loc.id}@${loc.x},${loc.z} from ${me.x},${me.z}: ${dense.map(t => t.x + ',' + t.z).join(' ')} | leaves ${JSON.stringify(leafWallList().filter(w => cheb(w, me) <= 6))}`);
    if (QLIB.doorAware && dense.length) {
        const d = closedDoorOnRoute(bot, level, [me, ...dense], 0, dense.length);
        // the target itself is never "a door in the way" (opLocGo on a door: the route ends at its op tile)
        const r = d && !(d.x === loc.x && d.z === loc.z && d.locId === loc.id) ? goOpenDoor(bot, [me, ...dense], d) : null;
        if (r !== null) return { tiles: r, opened: true };
    }
    if (dense.length) bot.sendRoute(turning(me, dense), true);
    return { tiles: dense.length, opened: false };
}
export function opLocGo(bot: SpeedBot, loc: locScene.SceneLoc, op = 1, stand?: Tile): number {
    const r = routeToLocD(bot, loc, stand);
    if (r.opened) return r.tiles;   // a closed door first: the loc op would be discarded behind it (re-try next call)
    clearBlockers(bot);   // FINAL3 (PX3): as opNpcGo
    bot.opLoc(loc.x, loc.z, loc.id, op); bot.queueFlush();
    return r.tiles;
}
export function useOnLocGo(bot: SpeedBot, obj: number | string, loc: locScene.SceneLoc, stand?: Tile): number {
    const id = objId(obj); const slot = bot.slot(id);
    if (slot < 0) throw new Error(`useOnLocGo: ${obj} not held`);
    const r = routeToLocD(bot, loc, stand);
    if (r.opened) return r.tiles;
    clearBlockers(bot);   // FINAL3 (PX3): as opNpcGo
    bot.useItemOnLoc(loc.x, loc.z, loc.id, id, slot); bot.queueFlush();
    return r.tiles;
}
/** Route onto the obj's tile + OPOBJ3 (Take) in one tick. */
export function pickupGo(bot: SpeedBot, obj: number | string, at: Tile): number {
    const id = objId(obj); const me = bot.tile();
    let tiles = 0;
    if (me.x !== at.x || me.z !== at.z) {
        const pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, at.x, at.z, 500);
        const dense = densify([me, ...pts]).slice(1);
        tiles = dense.length;
        if (dense.length) bot.sendRoute(turning(me, dense), true);
    }
    bot.opObj(at.x, at.z, id, 3); bot.queueFlush();
    return tiles;
}

// ---------------------------------------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------------------------------------
/**
 * Write a token stream. 'F' = FENCE: pad with CHAT_SETMODE packets (USER_EVENT, handler always returns true, no
 * game effect) up to the next multiple of 5 successful packets, so the tokens after it are carried over to the
 * NEXT server tick (the engine stops reading at 5 successes). Assumes every token before it succeeds and that the
 * burst starts on a tick boundary. Functions count as `cost` packets (default 1) for the fence arithmetic.
 */
export type FTok = Tok | 'F' | { fn: () => void; cost: number };
export function sendToks(bot: SpeedBot, toks: FTok[]): number {
    let n = 0;
    for (const t of toks) {
        if (t === 'R') { rawResume(bot); n++; }
        else if (t === 'X') { bot.closeModal(); n++; }
        else if (t === 'F') { while (n % 5 !== 0) { chatSetMode(bot); n++; } }
        else if (typeof t === 'number') { bot.ifButton(t); n++; }
        else if (typeof t === 'function') { t(); n++; }
        else { t.fn(); n += t.cost; }
    }
    bot.queueFlush();
    return n;
}
/** CHAT_SETMODE (154, size 3): public/private/trade all "on". A counted no-op packet for fences. */
export function chatSetMode(bot: SpeedBot): void { const o = (bot as any).out; o.p1Enc(ClientProt.CHAT_SETMODE); o.p1(0); o.p1(0); o.p1(0); }
/** A RESUME that is sent even if the client thinks no chat is open (resumeDialogPage() guards on chatModalId). */
export function rawResume(bot: SpeedBot): void { (bot as any).sendResume(bot.chatModalId > 0 ? bot.chatModalId : 0); }

export interface TalkOpts {
    /** Done when this holds (checked every tick). Default: the chat closed after the plan was sent. */
    done?: () => boolean;
    /** Fallback answers for choice pages (first matching option text wins). */
    answers?: RegExp[];
    /** Extra senders appended to the plan burst (e.g. CLOSE + the next OPNPC/MOVE). */
    after?: FTok[];
    maxTicks?: number;
    /** Plan already started (first page open from a previous action): skip the OPNPC. */
    noOp?: boolean;
    label?: string;
    /** The first page only counts once an IF_SETTEXT that changed since the call matches this (guards against a
     *  previous conversation's last page still being open). */
    firstText?: RegExp;
    /** Keep sending R/answers adaptively until done (default true). */
    adaptive?: boolean;
}
/**
 * Talk to the nearest npc of `type` (route + OPNPC1 in one tick), and the tick its first page is visible send the
 * whole `plan` in one burst. Then wait for `done()`; a plan that did not finish falls back to adaptive answering.
 */
export async function talk(bot: SpeedBot, type: number | number[], plan: FTok[], o: TalkOpts = {}): Promise<{ ok: boolean; ticks: number; firstPage: number }> {
    const t0 = bot.tickCount, maxTicks = o.maxTicks ?? 120;
    let opTick = -100, firstPage = -1, sentTick = -1, lastSig = '', lastClick = -99;
    const done = o.done ?? (() => sentTick >= 0 && bot.chatModalId === -1 && bot.tickCount > sentTick + Math.ceil(plan.length / 5));
    if (o.noOp) opTick = t0;
    const snap = new Map(bot.ifText);
    const freshText = () => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v && o.firstText!.test(v)) return true; return false; };
    // session 10 (generic drop-proofing): a reconnect closes every modal server-side and kills the npc script that waited
    // on a page; the dialog is gone and done() never comes. After a reconnect with the dialog closed and not done: OPNPC
    // again and answer adaptively (the npc may now be at a later stage, so the blind plan is not re-sent). Q_TALK_REOP=0 = old.
    const acct = String((bot as any).loginUser ?? '').toLowerCase();
    let rc = reconnectsOf(acct), reopened = 0;
    while (bot.tickCount - t0 < maxTicks && !bot.disposed) {
        if (done()) return { ok: true, ticks: bot.tickCount - t0, firstPage };
        if (sentTick >= 0 && !o.noOp && reconnectsOf(acct) !== rc && bot.chatModalId === -1 && process.env.Q_TALK_REOP !== '0' && reopened < 3) {
            rc = reconnectsOf(acct); reopened++; sentTick = -1; opTick = -100;
            console.log(`[q] ${o.label ?? 'talk'}: reconnect during the talk, dialog gone: re-opening (${reopened})`);
        }
        // session 11 fix 298b Q_TALK_REOP2 (qx53m/qyy06m: the dialog re-opened after a reconnect was closed again 1 t later by
        // the post-reconnect run button (if_close, see 298a); the reopen above fires once per reconnect, so the talk then
        // idled to its limit): after a reopen, a dialog that closed again without done() is re-opened too (same < 3 cap). =0 reverts.
        else if (reopened > 0 && sentTick >= 0 && !o.noOp && bot.chatModalId === -1 && bot.mainModalId === -1 && bot.tickCount - sentTick >= 3 && process.env.Q_TALK_REOP2 !== '0' && reopened < 3) {
            reopened++; sentTick = -1; opTick = -100;
            console.log(`[q] ${o.label ?? 'talk'}: re-opened dialog closed again without the result: re-opening (${reopened})`);
        }
        if (sentTick < 0) {
            if (inDialog(bot) && (reopened > 0 || !o.firstText || freshText())) {
                firstPage = bot.tickCount - t0;
                sendToks(bot, reopened > 0 ? [] : [...plan, ...(o.after ?? [])]);
                sentTick = bot.tickCount;
            } else if (!o.noOp && bot.tickCount - opTick >= 6) {
                const n = npc(bot, type);
                if (n) { opNpcGo(bot, n, 1); opTick = bot.tickCount; }
            }
        } else if (o.adaptive !== false && bot.chatModalId !== -1 && bot.tickCount > sentTick + Math.ceil((plan.length + (o.after?.length ?? 0)) / 5)) {
            // plan exhausted but a page is still open: answer it
            const opts = bot.dialogOptions();
            if (opts.length) {
                // one click per choice page: consecutive pages often reuse one interface (multi5), and a second click on a
                // page the client still shows lands on the NEXT page (G5: Narnode's relay took "None" twice)
                const sig = opts.map(x => x.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 4) {
                    let hit = -1;
                    for (const re of o.answers ?? []) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                    if (hit < 0) console.log(`[q] ${o.label ?? 'talk'}: unplanned choice [${opts.map(x => x.text).join(' | ')}] — no answer matched`);
                    else { lastSig = sig; lastClick = bot.tickCount; }
                }
            } else bot.resumeDialogPage();
            bot.queueFlush();
        }
        await bot.tick(1);
    }
    return { ok: done(), ticks: bot.tickCount - t0, firstPage };
}

/** Adaptive dialog driver (no plan): resume every page `burst` times a tick, answer choices by text, until done. */
export async function drive(bot: SpeedBot, done: () => boolean, answers: RegExp[] = [], maxTicks = 60, burst = 5): Promise<boolean> {
    const end = bot.tickCount + maxTicks;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (bot.chatModalId !== -1) {
            if (bot.dialogOptions().length) {
                for (const re of answers) if (bot.clickDialogByText(re) > 0) break;
            } else for (let i = 0; i < burst; i++) bot.resumeDialogPage();
            bot.queueFlush();
        }
        await bot.tick(1);
    }
    return done();
}

// ---------------------------------------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------------------------------------
/** Burst-drop every stack whose obj is not in `keep` (no wait). Drops are no-delay and do not stop walking. */
export function dropAllExcept(bot: SpeedBot, keep: Array<number | string>): number {
    const k = new Set(keep.map(objId)); let n = 0;
    for (const s of bot.inv()) if (!k.has(s.obj)) { bot.dropItem(s.obj, s.slot); n++; }
    bot.queueFlush();
    return n;
}
/** Continue every plain (non-choice) chat page, burst-resumed, until done() or maxTicks (fa-lib pagesUntil). */
export async function pagesUntil(bot: SpeedBot, done: () => boolean, maxTicks = 30): Promise<boolean> {
    const end = bot.tickCount + maxTicks;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (bot.chatModalId !== -1 && !bot.dialogOptions().length) { for (let i = 0; i < 5; i++) bot.resumeDialogPage(); bot.queueFlush(); }
        await bot.tick(1);
    }
    return done();
}
/**
 * Make the next protected click count. The engine drops a protected IF_BUTTON/OPHELD (teleport spell, glory rub) while ANY
 * modal is open (Player.busy()), and a CLOSE_MODAL only takes effect at the END of its cycle (CloseModalHandler sets
 * requestModalClose), so "CLOSE_MODAL + spell" in one burst behind an open npc page loses the spell (f2p-a fc34: Varrock
 * Teleport took 16 t; fc24-26: the glory rub's choice never came). Here: an npc dialog is finished (plain pages resumed,
 * QLIB.finishPages; a choice page or a page that will not end is closed), a blocking level-up/unlock page continued, any other
 * modal closed — and when a CLOSE_MODAL went out this tick we wait one tick. Returns the ticks spent (0 = nothing open).
 */
export async function afterModalClosed(bot: SpeedBot, maxPageTicks = 8): Promise<number> {
    const t0 = bot.tickCount;
    if (QLIB.finishPages && bot.chatModalId !== -1 && !bot.dialogOptions().length)
        await pagesUntil(bot, () => bot.chatModalId === -1 || bot.dialogOptions().length > 0, maxPageTicks);
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.chatModalId = -1; bot.mainModalId = -1; }
    if (bot.lastCloseModalTick === bot.tickCount) await bot.tick(1);
    return bot.tickCount - t0;
}
/** Teleport: the spell button; resolves when the position jumps. With QLIB.finishPages an open dialog / same-tick CLOSE_MODAL
 *  is cleared first (afterModalClosed); without it the historic CLOSE_MODAL + spell burst. */
export async function tele(bot: SpeedBot, spell: string, maxTicks = 12): Promise<{ ok: boolean; ticks: number }> {
    const t0 = bot.tickCount, p0 = bot.pos();
    // SR_SPELL_WALK=1 (run-route --existing, for accounts with low magic): a spell the account cannot cast (magic level
    // below the spell, magic_spells.dbrow via route-lib TELES) becomes a route-lib travelTo to the SAME landing tile (spell
    // teleports it can cast, walking), like noglory.ts does for glory rubs. Unset = unchanged.
    if (process.env.SR_SPELL_WALK === '1') {
        const { TELES, travelTo, DONE_OF } = await import('./qp/route/route-lib.js');
        const t = TELES.find(x => x.spell === spell);
        if (t && t.magic && bot.stat('magic').level < t.magic) {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            const r = await travelTo(bot, { ...t.to, level: 0 }, DONE_OF.get(bot) ?? new Set<string>(), { near: 3, tag: `spellwalk:${spell}` });
            const ok = r.ok || cheb(bot.tile(), t.to) <= 4;
            console.log(`[spellwalk] ${bot.loginUser} ${spell} (magic ${bot.stat('magic').level} < ${t.magic}): '${r.how}' ${r.ticks} t ok=${ok} at ${JSON.stringify(bot.pos())}`);
            return { ok, ticks: bot.tickCount - t0 };
        }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        if (QLIB.finishPages) { await afterModalClosed(bot); bot.ifButton(spellCom(spell)); bot.queueFlush(); }
        else { bot.closeModal(); bot.ifButton(spellCom(spell)); bot.queueFlush(); }
        const ok = await bot.until(() => cheb(bot.tile(), p0) > 8, maxTicks);
        if (ok) return { ok, ticks: bot.tickCount - t0 };
    }
    return { ok: false, ticks: bot.tickCount - t0 };
}
/** Wait until the player stands on a different tile/level than `from` (teleports, telejumps). */
export async function untilMoved(bot: SpeedBot, from: { x: number; z: number; level: number }, maxTicks = 12, minDist = 1): Promise<boolean> {
    return bot.until(() => bot.minusedlevel !== from.level || cheb(bot.tile(), from) >= minDist, maxTicks);
}
export function hp(bot: SpeedBot): number { return bot.stat('hitpoints').cur; }

/**
 * walkTo + op: a cancellable copy of SpeedBot.walkTo (core.ts; same planner, chunking and door handling) that
 * appends `finalOp` (an OPLOC/OPNPC/OPLOCU/OPOBJ sender) to the MOVE that carries the route's LAST chunk, in the
 * same tick. OP* packets do not clear the walk queue, so the interaction fires on arrival (op-triggers the tick
 * after arrival, ap-triggers on arrival). A stall/replan re-send re-attaches the op. Stops as soon as `done()`
 * holds (teleports, telejumps, dialogs) instead of chasing `dest` from the new position.
 */
/** Pre-planned routes (offline, before login or during a dialog): planning a 200-tile BFS costs ~2-3 ticks of CPU. */
const ROUTES = new Map<string, Tile[]>();
export async function prePlan(level: number, from: Tile, to: Tile): Promise<number> {
    const n = await nav();
    const pts = n.findLongPath(level, from.x, from.z, to.x, to.z, 500);
    if (!pts.length) return 0;
    const r = densify([{ x: from.x, z: from.z }, ...pts]);
    ROUTES.set(`${level},${from.x},${from.z}>${to.x},${to.z}`, r);
    return r.length - 1;
}
/** prePlan from every tile a teleport can land on (radius 2 around the spell coord, teleport.rs2:50). */
export async function prePlanArea(level: number, center: Tile, radius: number, to: Tile): Promise<void> {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) await prePlan(level, { x: center.x + dx, z: center.z + dz }, to);
}
export interface WalkOpOpts {
    near?: number; maxTicks?: number; level?: number; log?: boolean; quickGiveUp?: boolean; via?: Tile[]; walls?: Wall[];
    /** Re-plans before an OPEN door/gate next to us is closed (the leaf-wall fallback). Default 20 (ar-lib walkLive: 3-tick stall). */
    closeAfter?: number;
    /** Plan the first leg with rsmod (Chebyshev-optimal BFS) even when > 48 tiles (lib-troll `via: []`; navgrid routes were longer). */
    rsmodFirst?: boolean;
    /** Override QLIB.noRouteBail / QLIB.learnSteps for this walk. */
    noRouteBail?: boolean; learnSteps?: boolean;
}
export async function walkOp(bot: SpeedBot, dest: Tile, finalOp: (() => void | boolean) | null, done: () => boolean, o: WalkOpOpts = {}): Promise<boolean> {
    const n = await nav();
    const near = o.near ?? 0, maxTicks = o.maxTicks ?? 1500;
    const level = o.level ?? bot.minusedlevel;
    const t0 = bot.tickCount;
    const closeAfter = o.closeAfter ?? 20;
    const bail = o.noRouteBail ?? QLIB.noRouteBail, learn = o.learnSteps ?? QLIB.learnSteps;
    let route: Tile[] | null = null, idx = 0, sentEndIdx = -1, replans = 0, stall = 0, lastKey = '';
    let doorOpTick = -100, doorOpKey = '', doorTries = 0, opSentTick = -100, opPending = false;
    const blocked: any[] = [...(o.walls ?? [])];
    let viaUsed = false, wedges = 0, nullPlans = 0; let noRouteCloses = 0;
    const learned: Array<() => void> = []; const learnedKeys = new Set<string>();
    const plan = (me: Tile): Tile[] | null => replans > 0 ? withNpcBlocks(bot, level, () => planRaw(me)) : planRaw(me);
    const planRaw = (me: Tile): Tile[] | null => {
        // a pre-planned route only for the FIRST plan: a re-plan from the same tile must not get the same refused route back
        const cached = replans === 0 && !learned.length ? ROUTES.get(`${level},${me.x},${me.z}>${dest.x},${dest.z}`) : undefined;
        if (process.env.QTRACE === "1") console.log(`[q] plan (${me.x},${me.z})->(${dest.x},${dest.z}) cache=${!!cached}`);
        if (cached && blocked.length === (o.walls?.length ?? 0)) return cached;
        if (o.via && !viaUsed) {   // first plan only: me -> via... -> dest
            viaUsed = true; let from = me; const all: Tile[] = [me];
            for (const v of [...o.via, dest]) { const seg = n.findLongPath(level, from.x, from.z, v.x, v.z, 500, blocked); if (!seg.length) break; all.push(...seg); from = v; }
            if (cheb(all[all.length - 1]!, dest) === 0) return densify(all);
        }
        let pts: Tile[] = [];
        const rsmodFirst = o.rsmodFirst && replans === 0;
        if (!rsmodFirst && cheb(me, dest) > 48 && !blocked.length && process.env.SR_NAVGRID !== '0') {   // long trips: navgrid route (see core.ts planWalk)
            try { pts = n.navFindPath(level, me.x, me.z, dest.x, dest.z); } catch { pts = []; }
            const ne = pts[pts.length - 1];
            if (ne && cheb(ne, dest) <= Math.max(near, 1)) { NAVGRID_STATS.navgrid++; return densify([{ x: me.x, z: me.z }, ...pts]); }
            pts = [];
        }
        NAVGRID_STATS.rsmod++;
        try { pts = n.findLongPath(level, me.x, me.z, dest.x, dest.z, 500, blocked); } catch { pts = []; }
        let end = pts[pts.length - 1];
        if (!end || cheb(end, dest) > Math.max(near, 1)) {
            const alt = n.navFindPath(level, me.x, me.z, dest.x, dest.z); const ae = alt[alt.length - 1];
            if (ae && (!end || cheb(ae, dest) < cheb(end, dest))) { pts = alt; end = ae; }
        }
        return pts.length ? densify([{ x: me.x, z: me.z }, ...pts]) : null;
    };
    // stalled on a tile the static map calls free (an npc stands there): step to the best other neighbour first
    const detour = (me: Tile, avoid: Tile): Tile[] | null => {
        let best: Tile[] | null = null;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const nb = { x: me.x + dx, z: me.z + dz };
            if ((!dx && !dz) || (nb.x === avoid.x && nb.z === avoid.z)) continue;
            const step = n.findLongPath(level, me.x, me.z, nb.x, nb.z, 4, blocked);
            if (step.length !== 1 || step[0]!.x !== nb.x || step[0]!.z !== nb.z) continue;
            const rest = n.findLongPath(level, nb.x, nb.z, dest.x, dest.z, 500, blocked);
            const e = rest[rest.length - 1];
            if (!e || cheb(e, dest) > Math.max(near, 1)) continue;
            const r = densify([me, nb, ...rest]);
            // a detour that comes back through our own tile re-tries the refused step from here: useless
            if (r.slice(1).some(t => t.x === me.x && t.z === me.z)) continue;
            if (!best || r.length < best.length) best = r;
        }
        return best;
    };
    const npcOn = (t: Tile) => { for (let i = 0; i < bot.npcCount; i++) { const q = bot.npcs[bot.npcIndices[i]!]; if (q) { const p = bot.npcTileOf(q); if (p.x === t.x && p.z === t.z) return true; } } return false; };
    try {
    while (!bot.disposed) {
        if (done()) return true;
        const me = bot.tile();
        if (bot.tickCount - t0 > maxTicks) return false;
        // a level-up / unlock page or the wilderness warning blocks every MOVE and op: clear it and re-send at once
        if (bot.blockingPageOpen() || (bot.closeWildWarning && bot.mainModalId === WILD_WARNING_MODAL)) {
            clearBlockers(bot); bot.queueFlush(); sentEndIdx = -1; opSentTick = -100;
            await bot.tick(1); continue;
        }
        const atDest = cheb(me, dest) <= near && (near > 0 || (me.x === dest.x && me.z === dest.z));
        if (atDest) {
            if (!finalOp) return true;
            if (bot.tickCount - opSentTick >= 3 || opPending) { opPending = finalOp() === false; bot.queueFlush(); opSentTick = bot.tickCount; }
            await bot.tick(1); continue;
        }
        const key = `${me.x},${me.z}`;
        stall = key === lastKey ? stall + 1 : 0; lastKey = key;
        if (o.quickGiveUp && stall >= 6 && cheb(me, dest) <= 2) return false;
        // REFUSED-STEP LEARNER (QLIB.learnSteps; rm-driver's learned-edge watchdog, scoped to this walk): stood still 8 ticks
        // with a route whose next step is a single move no known door, npc or modal explains -> the server refuses it (an
        // open leaf of a loc door-states.json does not list, a runtime wall). Wall that step until the walk ends, re-plan.
        if (learn && route && stall >= 8 && stall % 4 === 0 && learned.length < 4 && bot.chatModalId === -1 && bot.mainModalId === -1) {
            // the step out of our tile at the route's FURTHEST visit of it (a loop through our tile is not the refused step)
            let k = -1; for (let i = route.length - 2; i >= 0; i--) if (route[i]!.x === me.x && route[i]!.z === me.z) { k = i; break; }
            const nx = k >= 0 ? route[k + 1] : undefined;
            if (nx && cheb(nx, me) === 1 && !npcOn(nx) && !closedDoorOnRoute(bot, level, [me, nx], 0, 1)) {
                const dx = nx.x - me.x, dz = nx.z - me.z, lk = `${me.x},${me.z},${dx},${dz}`;
                if (!learnedKeys.has(lk)) {
                    learnedKeys.add(lk); learned.push(tempBlockStep(level, me.x, me.z, dx, dz));
                    if (o.log !== false) console.log(`[q] walkOp(${dest.x},${dest.z}): the step (${me.x},${me.z})->(${nx.x},${nx.z}) is refused (${stall} t still); walling it for this walk, re-planning`);
                    route = null; replans = 0; wedges = 0; continue;   // a new map: a fresh re-plan budget
                }
            }
        }
        const replanAt = cheb(me, dest) <= 4 ? 1 : 3;   // near the goal npcs are the usual blocker: re-plan around them at once
        if (!route || (stall >= replanAt && stall % replanAt === 0)) {
            // shared world (live run j28): another player left the Camelot beehive-field gate open and its leaves walled off
            // the lane at (2767-2768,3444); the static map has it closed. Wedged next to an OPEN door/gate: close it, re-plan.
            if (replans >= closeAfter && wedges < 3 && bot.tickCount - t0 + 6 < maxTicks) {
                wedges++; replans = 0; route = null;
                if (await bot.closeBlockingDoor()) console.log(`[q] walkOp(${dest.x},${dest.z}): closed an open door/gate next to (${me.x},${me.z}), re-planning`);
                else await bot.tick(4);   // npcs in a corridor move on: wait, then re-plan
                continue;
            }
            if (replans >= Math.max(closeAfter, 20)) { if (o.log !== false) console.log(`[q] walkOp(${dest.x},${dest.z}) wedged at (${me.x},${me.z}) npcs near: ${npcsOf(bot, [...new Set(Array.from({ length: bot.npcCount }, (_, i) => bot.npcs[bot.npcIndices[i]!]?.typeId ?? -1))]).filter(q => q.d <= 3).map(q => q.type + '@' + q.x + ',' + q.z).join(' ')}`); return false; }
            const prevNext = route && stall >= replanAt ? route[Math.min(route.length - 1, idx + 1)] : null;
            route = prevNext ? withNpcBlocks(bot, level, () => detour(me, prevNext)) ?? plan(me) : plan(me); replans++; idx = 0; sentEndIdx = -1;
            if (!route) {
                // NO ROUTE (QLIB.noRouteBail): 3 plans in a row found nothing -> give up instead of re-planning every tick
                // session 6 (allchaos qt12/qt13: Sea Slug platform 2 tiles, Tourist Trap mine, Blue Moon inn): an OPEN door/gate's leaf
                // walls the only way (the planner treats live leaves as walls): before giving up, close one next to us and re-plan
                // (at most twice per walk). QLIB_NOROUTE_CLOSE=0 reverts.
                if (bail && nullPlans >= 2 && noRouteCloses < 2 && process.env.QLIB_NOROUTE_CLOSE !== '0') {
                    noRouteCloses++;
                    let closed = false; try { closed = await bot.closeBlockingDoor(); } catch { /* none */ }
                    if (closed) { if (o.log !== false) console.log(`[q] walkOp(${dest.x},${dest.z}): no route from (${me.x},${me.z}); closed an open door/gate next to us, re-planning`); nullPlans = 0; await bot.tick(2); continue; }
                }
                if (bail && ++nullPlans >= 3) { if (o.log !== false) console.log(`[q] walkOp(${dest.x},${dest.z}) from (${me.x},${me.z}) L${level}: no route`); return false; }
                await bot.tick(1); continue;
            }
            nullPlans = 0;
        }
        let j = -1;
        for (let i = Math.max(0, idx - 2); i < Math.min(route.length, idx + 10); i++) if (route[i]!.x === me.x && route[i]!.z === me.z) { j = i; break; }
        if (j < 0) j = route.findIndex(t => t.x === me.x && t.z === me.z);
        if (j < 0) { route = null; continue; }
        idx = j;
        // first CLOSED door ahead (live tracker), incl. a diagonal step past a door's corner (closedDoorOnRoute)
        const door = closedDoorOnRoute(bot, level, route, idx, 14);
        const segEnd = door ? door.i : route.length - 1;
        if (door && idx >= door.i) {
            const dk = `${door.x},${door.z}`;
            if (dk !== doorOpKey) { doorOpKey = dk; doorTries = 0; }
            if (bot.tickCount - doorOpTick >= 4) {
                if (doorTries >= 3) { const geo = n.getDoorAt(level, door.x, door.z); if (geo) blocked.push(geo); route = null; continue; }
                if (door.stand && !(door.stand.x === me.x && door.stand.z === me.z)) bot.sendRoute([door.stand], true);
                bot.opLoc(door.x, door.z, door.locId, door.op); bot.queueFlush();
                doorOpTick = bot.tickCount; doorTries++;
            }
            await bot.tick(1); continue;
        }
        if (opPending && finalOp && !door) { opPending = finalOp() === false; bot.queueFlush(); }   // target came into view
        const remaining = sentEndIdx - idx;
        if (sentEndIdx < 0 || (sentEndIdx !== segEnd && remaining <= 4) || stall >= 2) {
            const steps = route.slice(idx + 1, segEnd + 1);
            // session 11 fix 385a (qx312m retry: 'walk gujuo spot' from (2823,2926) sat 20 t while a Jungle Savage fight held the
            // bot (engine 't62674-62718 interact op 4 npc 931 target kept | steps 0 wp false'), the refused-step learner walled all
            // 4 steps -> 'no route' -> ROUTE STOPPED): a MOVE_OPCLICK never clears the engine interaction (MoveClickHandler:
            // clearPendingAction only for a plain click; upstream = live), so an attack / auto-retaliate target outlives every
            // re-send. A segment that carries no op in this flush (no door at its end, no finalOp) goes as a plain MOVE_GAMECLICK,
            // like a human click (walking sets busy2, so auto-retaliate cannot re-grab us). QLIB_WALK_CLEAR=0 reverts.
            const pairOp = !!door || (!!finalOp && segEnd === route.length - 1);
            const last = bot.sendRoute(turning(me, steps), pairOp || !QLIB.walkClear);
            if (last) {
                sentEndIdx = route.findIndex((t, k) => k > idx && t.x === last.x && t.z === last.z);
                if (door && sentEndIdx === segEnd && !door.stand) { bot.opLoc(door.x, door.z, door.locId, door.op); doorOpTick = bot.tickCount; doorOpKey = `${door.x},${door.z}`; doorTries = 1; }
                else if (!door && sentEndIdx === route.length - 1 && finalOp) { opPending = finalOp() === false; opSentTick = bot.tickCount; }
                bot.queueFlush();
            }
        }
        await bot.tick(1);
    }
    return done();
    } finally { for (const u of learned) u(); }
}

/** QTRACE=1: log pos/level/chat/main modal on every tick (wraps bot.tick). */
export function trace(bot: SpeedBot, t0: number): void {
    if (process.env.QTRACE !== '1') return;
    (bot as any).__traceT0 = t0;
    if ((bot as any).__traced) return;
    (bot as any).__traced = true;
    const orig = bot.tick.bind(bot);
    let last = '';
    (bot as any).tick = async (n = 1) => {
        await orig(n);
        const p = bot.pos();
        const opts = bot.dialogOptions().map(o => o.text).join("|");
        const s = `(${p.x},${p.z},L${p.level}) chat=${bot.chatModalId} main=${bot.mainModalId} inv=${bot.inv().length}${opts ? " [" + opts + "]" : ""}`;
        const td = textDiff(bot); if (td.length) console.log(`    text: ${td.join(" || ")}`);
        if (s !== last) console.log(`[t +${bot.tickCount - (bot as any).__traceT0}] ${s}`);
        last = s;
    };
}

/** QTRACE=1: print every IF_SETTEXT that changed since the last call (dialog page text). */
const lastText = new WeakMap<SpeedBot, Map<number, string>>();
export function textDiff(bot: SpeedBot): string[] {
    const prev = lastText.get(bot) ?? new Map<number, string>(); const out: string[] = [];
    for (const [k, v] of bot.ifText) if (prev.get(k) !== v && v) out.push(`${k}:${v.slice(0, 60)}`);
    lastText.set(bot, new Map(bot.ifText));
    return out;
}

/** Wait until some IF_SETTEXT / game message text that was not there (or differed) at call time matches `re`.
 *  Checks immediately, then once per tick. */
export async function waitText(bot: SpeedBot, re: RegExp, maxTicks: number, mark?: number): Promise<boolean> {
    const snap = new Map(bot.ifText); const since = bot.tickCount;
    // `mark` (msgMark taken before the action): exact game-message cursor; without it the historic tick-label test
    const hit = () => {
        for (const [k, v] of bot.ifText) if (snap.get(k) !== v && re.test(v)) return true;
        return (mark === undefined ? msgsSince(bot, since) : msgsSinceMark(bot, mark)).some(t => re.test(t));
    };
    return bot.until(hit, maxTicks);
}
/** MESSAGE_GAME lines received at or after a tick.
 *  ⚠ TICK LABELS ARE AMBIGUOUS: a message caused by an action sent on tick T can be decoded before that cycle's PLAYER_INFO
 *  and carry label T — and so can the PREVIOUS action's message (south lane #2, fe3). Prefer msgMark()/msgsSinceMark(). */
export function msgsSince(bot: SpeedBot, tick: number): string[] {
    return (bot as any).getChat({ types: [0], limit: 0, includeSelf: true }).filter((m: any) => m.tick >= tick).map((m: any) => m.text as string);
}
/** A cursor into the chat log (ChatLog.seen: lines ever recorded, monotonic). Take it right BEFORE sending the action. */
export function msgMark(bot: SpeedBot): number { return (bot as any).chatLog?.seen ?? 0; }
/** MESSAGE_GAME lines recorded after `mark` (exact: no tick-label ambiguity; the 500-line ring bounds how far back). */
export function msgsSinceMark(bot: SpeedBot, mark: number): string[] {
    const log = (bot as any).chatLog; if (!log) return [];
    return (log.since(mark) as Array<{ type: number; text: string }>).filter(m => m.type === 0).map(m => m.text);
}
/** Did a game message matching `re` arrive after `mark`? */
export function msgAfterMark(bot: SpeedBot, mark: number, re: RegExp): boolean { return msgsSinceMark(bot, mark).some(t => re.test(t)); }

/**
 * IF_SETTEXT history ({tick, com, text}), installed once per bot (wraps ifText.set). `bot.ifText` keeps only the LATEST text
 * per component and dialogue pages reuse the same components, so a page followed by more pages in one burst is gone from
 * it, and a page whose text equals the previous page's is invisible to a diff (Hazeel valves, Sheep Herder: ar request).
 * The log keeps every set, equal text included. (south-lib textLog / rb-lib textLog / ka-lib installTextLog / sp-lib textLog.)
 */
const TEXT_LOG = new WeakMap<SpeedBot, Array<{ tick: number; com: number; text: string }>>();
export function textLog(bot: SpeedBot): Array<{ tick: number; com: number; text: string }> {
    let log = TEXT_LOG.get(bot);
    if (log) return log;
    const l: Array<{ tick: number; com: number; text: string }> = [];
    TEXT_LOG.set(bot, l);
    const m = bot.ifText; const orig = m.set.bind(m);
    (l as any).base = 0;   // entries dropped from the front (marks are absolute: base + index)
    (m as any).set = (k: number, v: string) => { if (v) { l.push({ tick: bot.tickCount, com: k, text: v }); if (l.length > 8000) { l.splice(0, 2000); (l as any).base += 2000; } } return orig(k, v); };
    return l;
}
/** A mark into the text log (installs it). Pass to sawText. */
export function textMark(bot: SpeedBot): number { const l = textLog(bot); return (l as any).base + l.length; }
/** Did any IF_SETTEXT after `mark` match `re`? chatnpc word-wraps one line over several components (ka-lib heard()), so each
 *  tick's texts are ALSO matched joined with spaces. Colour tags (@xxx@) are stripped. */
export function sawText(bot: SpeedBot, re: RegExp, mark = 0): boolean {
    const l = textLog(bot); let tick = -1, joined = '';
    const strip = (t: string) => t.replace(/@\w{3}@/g, '');
    for (let i = Math.max(0, mark - (l as any).base); i < l.length; i++) {
        const e = l[i]!; const t = strip(e.text);
        if (re.test(t)) return true;
        if (e.tick !== tick) { if (joined && re.test(joined)) return true; tick = e.tick; joined = t; } else joined += ' ' + t;
    }
    return !!joined && re.test(joined);
}
/** The open chat page's text (every non-empty IF_SETTEXT of its components, in component order, joined; tags stripped). */
export function pageText(bot: SpeedBot): string {
    const root = bot.chatModalId; if (root === -1) return '';
    return [...bot.ifText.entries()].filter(([k, v]) => k > root && k <= root + 12 && v).sort((a, b) => a[0] - b[0]).map(([, v]) => v.replace(/@\w{3}@/g, '')).join(' ');
}
/** Close whatever chat/main modal is open (CLOSE_MODAL) and forget it client-side, so the next IF_OPENCHAT is a
 *  fresh page (e.g. the boat's "You arrive..." mesbox would otherwise read as the npc's first page). */
export function dismiss(bot: SpeedBot): void {
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.chatModalId = -1; bot.mainModalId = -1; }
}

/** walkOp to the first stand tile (nearest first) from which  is reachable, falling back to the next one if
 *  the walk wedges (an npc parked on the stand tile). Each attempt gets  ticks. */
export async function opLocFrom(bot: SpeedBot, loc: locScene.SceneLoc, op: number, done: () => boolean, stands: Tile[], o: { perTry?: number; level?: number; via?: Tile[]; walls?: Wall[] } = {}): Promise<boolean> {
    const n = await nav(); const fa = n.locForceApproach(loc.id);
    const lv = o.level ?? bot.minusedlevel;
    const ok = stands.filter(t => n.reachedLoc(lv, t.x, t.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa));
    // list order = preference order (the caller knows which stands the live map really lets you reach)
    const t0 = bot.tickCount;
    for (let round = 0; round < 4 && bot.tickCount - t0 < (o.perTry ?? 40) * 2; round++) for (const st of ok) {
        if (npcsOf(bot, [...new Set(Array.from({ length: bot.npcCount }, (_, i) => bot.npcs[bot.npcIndices[i]!]?.typeId ?? -1))]).some(q => q.x === st.x && q.z === st.z)) continue;
        if (await walkOp(bot, st, () => bot.opLoc(loc.x, loc.z, loc.id, op), done, { maxTicks: o.perTry ?? 40, level: lv, quickGiveUp: true, via: o.via, walls: o.walls })) return true;
        if (done()) return true;
    }
    return done();
}

/** Permanently (this process) add live-only wall edges to the rsmod collision map used by every planner here. */
let WALLS_DONE = new Set<string>();
export async function addWalls(walls: Wall[]): Promise<void> {
    await nav();
    const rsmod: any = await import('../../../../vendor/rsmod-pathfinder');
    for (const w of walls) {
        const k = `${w.level},${w.x},${w.z},${w.angle}`;
        if (WALLS_DONE.has(k)) continue;
        WALLS_DONE.add(k);
        rsmod.changeWall(w.x, w.z, w.level, w.angle, w.shape, w.blockrange ?? false, false, true);
    }
}

/** session 11 fix 393 (user: 'we can run through most npcs'): the engine gives every npc blockwalk=npc by default, which sets
 *  only NPC_OCC; a player's step checks BLOCK_NPC_AND_PLAYERS (Player.ts:776), set only by blockwalk=all (World.ts:1683).
 *  So only these 26 types block a player (content *.npc blockwalk=all, ids from pack/npc.pack): black_knight_titan,
 *  boulder_legends/upass, castlewars barricades x4, crane_posessed_mine, eadgar_storeroom_guard, flytrap, hauntedmine carts
 *  + boss cart, ikov firewarrior/guardians, kittens_mew, mm aberab/elder guards/trapdoor guard/trefaji, nasty trees. */
export const BLOCKWALK_ALL = new Set<number>([221, 939, 986, 1533, 1535, 1532, 1534, 1542, 1150, 151, 1544, 1545, 1546, 1547, 1548, 277, 275, 274, 767, 1432, 1461, 1462, 1460, 1431, 152, 1226]);
/** Run a planner query with the visible PLAYER-BLOCKING npcs' tiles marked blocked (fix 393: only BLOCKWALK_ALL types;
 *  QLIB_NPC_BLOCK_ALL=1 restores the old 'every visible npc' rule). Tiles already blocked statically are left alone. */
export function withNpcBlocks<T>(bot: SpeedBot, level: number, fn: () => T): T {
    const me = bot.tile(); const added: Tile[] = []; const allNpcs = process.env.QLIB_NPC_BLOCK_ALL === '1';
    for (const q of npcsOf(bot, [...new Set(Array.from({ length: bot.npcCount }, (_, i) => bot.npcs[bot.npcIndices[i]!]?.typeId ?? -1))])) {
        if (q.d > 12 || q.d === 0 || !isTileWalkable(level, q.x, q.z)) continue;
        if (!allNpcs && !BLOCKWALK_ALL.has(q.type)) continue;
        rsmodPF.changeLoc(q.x, q.z, level, 1, 1, false, false, true); added.push(q);
    }
    try { return fn(); } finally { for (const t of added) rsmodPF.changeLoc(t.x, t.z, level, 1, 1, false, false, false); }
}
/** Remove a (now gone) scenery loc's collision from the planner map, e.g. a slashed web. Process-wide. */
export function openLoc(l: { x: number; z: number; level?: number; width?: number; length?: number }): void {
    rsmodPF.changeLoc(l.x, l.z, l.level ?? 0, l.width ?? 1, l.length ?? 1, true, false, false);
}

// ---------------------------------------------------------------------------------------------------------
// situation(): one-line diagnostic snapshot for stalls/aborts. Says WHERE the
// trainee is, what is open, which npcs stand around, and the LIVE state of every door/gate near it (the static map and the
// planners treat doors as open; on the demo other players open and close them), plus the last game messages.
// ---------------------------------------------------------------------------------------------------------
let DIAG_DOORS: Record<string, { state: 'open' | 'closed'; pair: number | null }> | null = null;
function diagDoors() {
    if (DIAG_DOORS) return DIAG_DOORS;
    try { DIAG_DOORS = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../../../sdk/navgrid/door-states.json'), 'utf8')); } catch { DIAG_DOORS = {}; }
    return DIAG_DOORS!;
}
export function situation(bot: SpeedBot, radius = 6): string {
    try {
        const p = bot.pos(); const me = bot.tile(); const ds = diagDoors();
        const doors: string[] = [];
        for (const l of locScene.getNearbyLocs(me.x, me.z, p.level, radius)) {
            const st = ds[String(l.id)]; if (!st && !/door|gate/i.test(l.name)) continue;
            const live = bot.liveLocs.get(`${p.level},${l.x},${l.z}`);
            // an opened leaf shows as a LIVE loc (its pair id) on this or an adjacent tile; the closed leaf's tile only gets a delete
            let leaf = '';
            for (const [k, id] of bot.liveLocs) { const [lv, x, z] = k.split(',').map(Number); if (lv === p.level && Math.abs(x! - l.x) <= 1 && Math.abs(z! - l.z) <= 1 && (st?.pair === id || ds[String(id)])) leaf = `${id}@${x},${z}`; }
            const state = leaf ? (ds[leaf.split('@')[0]!]?.state ?? '?') : live !== undefined && live !== l.id ? `live ${live}` : (st?.state ?? 'static');
            doors.push(`${l.name}#${l.id}@${l.x},${l.z} a${l.angle} ${state}${leaf ? ` (leaf ${leaf})` : ''} d${cheb(l, me)}`);
        }
        const npcs: string[] = [];
        for (let i = 0; i < bot.npcCount && npcs.length < 8; i++) {
            const n = bot.npcs[bot.npcIndices[i]!]; if (!n) continue; const t = bot.npcTileOf(n); const d = cheb(t, me);
            if (d <= radius + 2) npcs.push(`${locScene.npcName(n.typeId) || n.typeId}#${n.typeId}@${t.x},${t.z} d${d}`);
        }
        let msgs: string[] = [];
        try { msgs = (bot as any).getChat({ limit: 4 }).map((m: any) => `${m.sender ? m.sender + ': ' : ''}${m.text}`); } catch { /* no chat log */ }
        const pack = bot.inv().map(s => `${s.obj}x${s.count}`).join(',');
        return `pos ${p.x},${p.z},${p.level} modal ${bot.mainModalId}/${bot.chatModalId} hp ${bot.stat('hitpoints').cur} | doors: ${doors.join('; ') || 'none'} | npcs: ${npcs.join('; ') || 'none'} | msgs: ${JSON.stringify(msgs)} | pack ${pack.slice(0, 200)}`;
    } catch (e) { return `situation failed: ${(e as Error).message}`; }
}

// ---------------------------------------------------------------------------------------------------------
// doors: exact live state (shared by fg-lib doorOpen, fa2-lib doorOpen, ka-lib/lib-troll door ops)
// ---------------------------------------------------------------------------------------------------------
/**
 * Is the door `id` (its STATIC closed loc at (x,z)) open right now? Live truth only:
 *   - a door variant now on the door tile itself (zone LOC_ADD_CHANGE): open iff it is the open pair;
 *   - an open leaf (door-states pair) on the ONE tile across the door's own wall edge (doors.rs2 open_door: door_open(angle));
 *   - else the door tracker's state for the tile (a LOC_DEL of the closed loc = open; reset on zone resync).
 * Any other neighbour is a different door's leaf: the BKF L1 pair 3019/3021,3515 sit 2 apart and door 1's leaf stands on
 * (3020,3515), next to door 2 (fg sim fgb4: door 2 taken for open with an any-neighbour test, 27 t lost).
 */
export function doorOpen(bot: SpeedBot, id: number, x: number, z: number, level = bot.minusedlevel): boolean {
    const ds = diagDoors(); const pair = ds[String(id)]?.pair ?? null;
    const live = bot.liveLocs.get(`${level},${x},${z}`);
    if (live !== undefined) return pair !== null && live === pair;
    if (pair !== null) {
        const l = locScene.getLocsAt(x, z, level, { includeUnnamed: true }).find(q => q.id === id);
        if (l && l.shape === 0) {
            const [dx, dz] = [[-1, 0], [0, 1], [1, 0], [0, -1]][l.angle & 3]!;
            if (bot.liveLocs.get(`${level},${x + dx!},${z + dz!}`) === pair) return true;
        }
    }
    return bot.doorTracker?.isOpen(level, x, z) === true && ds[String(id)]?.state === 'closed';
}
/** OPLOC the door `id` at (x,z) open if it is closed: route onto an op tile with the op in the same tick (a bare OPLOC from out
 *  of reach is discarded). The op uses the LIVE closed id (tracker), never a stale one. Returns true if an op went out. */
export function openDoorAt(bot: SpeedBot, id: number, x: number, z: number, level = bot.minusedlevel): boolean {
    if (doorOpen(bot, id, x, z, level)) return false;
    const cd = bot.doorTracker?.closedDoorAt(level, x, z);
    const locId = cd?.locId ?? id, op = cd?.op ?? (diagDoors()[String(id)] as any)?.op ?? 1;
    let l: locScene.SceneLoc | undefined;
    try { l = locAt(id, x, z, level); } catch { l = undefined; }
    if (l) { const r = routeToLocD(bot, { ...l, id: locId }, undefined); if (r.opened) return true; }
    else if (cheb(bot.tile(), { x, z }) > 0) bot.sendRoute([{ x, z }], true);
    clearBlockers(bot);
    bot.opLoc(x, z, locId, op); bot.queueFlush();
    return true;
}

// ---------------------------------------------------------------------------------------------------------
// pack room (fix 9): rewards are silently lost with a full pack (spine request, south #6: N unnoted items)
// ---------------------------------------------------------------------------------------------------------
let STACKABLE: Set<number> | null = null;
/** Is this obj stackable (its .obj config says stackable=yes, or it is a cert_* note)? */
export function isStackable(obj: number | string): boolean {
    const id = objId(obj);
    if (!STACKABLE) {
        STACKABLE = new Set();
        try {
            const root = resolve(import.meta.dir, '../../../../content/scripts');
            const walk = (dir: string) => {
                for (const e of readdirSync(dir)) {
                    const p = join(dir, e);
                    if (statSync(p).isDirectory()) { walk(p); continue; }
                    if (!e.endsWith('.obj')) continue;
                    let cur: string | null = null;
                    for (const line of readFileSync(p, 'utf8').split('\n')) {
                        const b = line.match(/^\[(\S+)\]/); if (b) { cur = b[1]!; continue; }
                        if (cur && /^stackable=yes/.test(line)) { try { STACKABLE!.add(objId(cur)); } catch { /* not in the pack */ } }
                    }
                }
            };
            walk(root);
        } catch { /* content missing: only certs below */ }
    }
    return STACKABLE.has(id) || /^cert_/.test(objDebugName(id));
}
/** Backpack slots `items` would need now (a stackable already held needs 0, else 1; an unnoted obj 1 per item). */
export function slotsFor(bot: SpeedBot, items: Array<{ obj: number | string; n: number }>): number {
    let need = 0;
    for (const it of items) {
        const id = objId(it.obj);
        if (isStackable(id)) { if (bot.count(id) === 0) need++; }
        else need += it.n;
    }
    return need;
}
/**
 * Make room for `slots` free backpack slots before a step that RECEIVES something (npc give, chest, trade, pickup). A full
 * pack makes those steps finish with no effect ('can't carry', grandtree 285 / legends 289 / upass 280: see
 * learnings/quest-bot-failure-patterns.md #1), so call this first. Drops, in order: stacks from `drop` (default: the
 * tutorial kit junk KIT_JUNK), then the surplus of each `floor` entry above its count (e.g. { shark: 3 }), never anything
 * in `keep`. Up to `rounds` rounds: a drop sent while the player is delayed is discarded (qyt05), so it is re-sent.
 * Resolves true once free() >= slots, false if nothing droppable is left (the caller decides: bank, or fail honestly).
 */
export async function ensureFreeSlots(bot: SpeedBot, slots: number, o: { drop?: Array<number | string>; keep?: Array<number | string>; floor?: Record<string, number>; maxTicks?: number; rounds?: number; log?: (s: string) => void } = {}): Promise<boolean> {
    if (bot.free() >= slots) return true;
    const ids = (l: Array<number | string>) => l.map(k => { try { return objId(k); } catch { return -1; } }).filter(i => i > 0);
    const keep = new Set(ids(o.keep ?? []));
    const order = ids(o.drop ?? KIT_JUNK).filter(id => !keep.has(id));
    const floors = Object.entries(o.floor ?? {}).map(([k, n]) => [ids([k])[0] ?? -1, n] as const).filter(([id]) => id > 0 && !keep.has(id));
    o.log?.(`ensureFreeSlots: pack ${28 - bot.free()}/28, need ${slots} free`);
    for (let r = 0; r < (o.rounds ?? 3) && bot.free() < slots && !bot.disposed; r++) {
        let free = bot.free(); const sends: Array<() => void> = [];
        const take = (cands: Array<{ obj: number; slot: number }>) => { for (const s of cands) if (free < slots) { sends.push(() => bot.dropItem(s.obj, s.slot)); free++; } };
        for (const id of order) take(bot.inv().filter(s => s.obj === id));
        for (const [id, n] of floors) take(bot.inv().filter(s => s.obj === id).slice(n));
        if (!sends.length) break;
        bot.burst(sends);
        await bot.until(() => bot.free() >= Math.min(slots, free), o.maxTicks ?? 6);
    }
    return bot.free() >= slots;
}

// ---------------------------------------------------------------------------------------------------------
// effect checks and resume guards (learnings/quest-bot-failure-patterns.md #2, #3)
// ---------------------------------------------------------------------------------------------------------
/**
 * Run `act` (a talk, op, use...) and then wait up to `settle` ticks for `effect()` (the item arrived, the npc's job line was
 * seen, a varp moved, we moved). A dialog that 'finishes' proves nothing: a connection drop can swallow what the server did
 * (pirate 290, watchtower 265, monkey madness 266a). Repeats `act` up to `tries` times; true once the effect holds.
 */
export async function withEffect(bot: SpeedBot, act: (attempt: number) => Promise<unknown> | unknown, effect: () => boolean, o: { tries?: number; settle?: number; label?: string; log?: (s: string) => void } = {}): Promise<boolean> {
    for (let k = 0; k < (o.tries ?? 3) && !bot.disposed; k++) {
        if (effect()) return true;
        if (k > 0) o.log?.(`${o.label ?? 'step'}: no effect after try ${k}, again`);
        await act(k);
        await bot.until(effect, o.settle ?? 20);
    }
    return effect();
}

export interface Area { level?: number; x0: number; z0: number; x1: number; z1: number }
/** Is the player inside `a` (inclusive bounds; any level when a.level is unset)? */
export function inArea(bot: SpeedBot, a: Area): boolean {
    const t = bot.tile();
    return (a.level === undefined || bot.minusedlevel === a.level) && t.x >= Math.min(a.x0, a.x1) && t.x <= Math.max(a.x0, a.x1) && t.z >= Math.min(a.z0, a.z1) && t.z <= Math.max(a.z0, a.z1);
}
/**
 * Where is the player, by name? The first entry of `areas` that holds the player, else null. A resume must check this
 * before trusting the journal stage: a retry can start far from the phase it resumes (dragon 288b resumed 'elvarg' on the
 * mainland; monkey madness 266b on Crash Island; tourist trap 283 upstairs). Typical use:
 *   switch (whereIs(bot, { crandor: CRANDOR, ship: SHIP })) { case 'crandor': break; case null: await resail(); ... }
 */
export function whereIs<K extends string>(bot: SpeedBot, areas: Record<K, Area | Area[]>): K | null {
    for (const k of Object.keys(areas) as K[]) {
        const v = areas[k];
        if ((Array.isArray(v) ? v : [v]).some(a => inArea(bot, a))) return k;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------
// stairs / ladders, op-once helpers
// ---------------------------------------------------------------------------------------------------------
/**
 * Climb a staircase/ladder `loc` (op `op`) from next to `stand`: walkOp (run, door-aware, leaf walls) with the OPLOC riding the
 * last chunk, then re-op every 4 t (continuing pages) until the level changes. Faster and more robust than core's multi-level
 * traveller, which walks and wedges on closed doors (fk-lib / fg-lib climb). Returns true on the level change.
 */
export async function climb(bot: SpeedBot, loc: { id: number; x: number; z: number; level: number }, stand: Tile, op = 1, o: { maxTicks?: number; retryTicks?: number } = {}): Promise<boolean> {
    await nav();
    const lv0 = bot.minusedlevel, isDone = () => bot.minusedlevel !== lv0;
    if (isDone()) return true;
    await walkOp(bot, stand, () => { bot.opLoc(loc.x, loc.z, loc.id, op); }, isDone, { near: 1, maxTicks: o.maxTicks ?? 300, log: false });
    const t = bot.tickCount;
    const l = locAt(loc.id, loc.x, loc.z, loc.level);
    while (!isDone() && !bot.disposed) {
        if (bot.tickCount - t > (o.retryTicks ?? 30)) return false;
        if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
        else if ((bot.tickCount - t) % 4 === 0) opLocGo(bot, l, op);
        await bot.tick(1);
    }
    return isDone();
}
/**
 * Send an action ONCE, then only page through what it opens (resume plain pages, answer choices by text) until done(). Many
 * scripts hand the item over AFTER a box/chat page (Tourist Trap chest/barrels, Digsite): re-sending the op every few ticks
 * closes the box and aborts the script (south #9, sott7). The op is re-sent only when no page is open and nothing happened
 * for `reopAfter` ticks (default 8), at most `tries` times.
 */
export async function opThen(bot: SpeedBot, send: () => void, done: () => boolean, o: { answers?: RegExp[]; maxTicks?: number; reopAfter?: number; tries?: number } = {}): Promise<boolean> {
    const end = bot.tickCount + (o.maxTicks ?? 60);
    let tries = 0, lastAct = -100;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (bot.chatModalId !== -1 && !bot.blockingPageOpen()) {
            if (bot.dialogOptions().length) { for (const re of o.answers ?? []) if (bot.clickDialogByText(re) > 0) break; }
            else bot.resumeDialogPage();
            bot.queueFlush(); lastAct = bot.tickCount;
        } else if (tries < (o.tries ?? 3) && bot.tickCount - lastAct >= (tries === 0 ? 0 : o.reopAfter ?? 8)) {
            clearBlockers(bot); send(); bot.queueFlush(); tries++; lastAct = bot.tickCount;
        }
        await bot.tick(1);
    }
    return done();
}

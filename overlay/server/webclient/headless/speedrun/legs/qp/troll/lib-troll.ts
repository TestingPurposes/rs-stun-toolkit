// lib-troll.ts — lane-local helpers for the troll lane's quest code (cheat-free; never calls cheat/setvar/localSetup).
// Framework: q-lib.ts (talk, walkOp, opNpcGo, npc), core.ts (SpeedBot). Anything here that the framework should own is
// listed under "Framework requests" in STATUS.md.
import { ClientProt } from '#/io/ClientProt.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SpeedBot, objId, objDebugName, cheb, densify } from '../../../core.js';
import { npc, npcsOf, navSync, nav, turning, walkOp, levelUpOpen, inDialog, msgsSince, trace, locAt, opLocGo, opNpcGo, sendToks, dismiss, situation, opHeld as qOpHeld, useOnNpcGo as qUseOnNpcGo, type NpcRef, type Tile, type FTok } from '../../q-lib.js';
import { isTileWalkable } from '../../../../../../../sdk/pathfinding';

export type Item = { name: string; n: number };
export const INV_COM = 3214;   // inventory:inv (leanbot.ts INV_INTERFACE)

/** OPHELD<op> on a backpack item (op 4 = Rub on jewellery, op 1 = Read/Eat, op 3 = e.g. Empty). MIGRATED to q-lib opHeld. */
export function opHeld(bot: SpeedBot, obj: number | string, op: 1 | 2 | 3 | 4 | 5): boolean { return qOpHeld(bot, obj, op); }

/** Route next to the npc + OPNPCU (use `obj` on it) in one tick. MIGRATED to q-lib useOnNpcGo (was a copy of
 *  opNpcGo with the use packet; the framework one is door-aware and treats a neighbour across a wall as not adjacent). */
export function useOnNpcGo(bot: SpeedBot, n: NpcRef, obj: number | string): number { return qUseOnNpcGo(bot, n, obj); }

/** Thrown by fail(); the launcher prints it. */
export class QuestFail extends Error {}

/** Per-run context: timing marks, logging, failure. */
export class Ctx {
    t0: number; marks: Record<string, number> = {}; verbose: boolean;
    constructor(public bot: SpeedBot, public tag: string, o: { log?: boolean } = {}) { this.t0 = bot.tickCount; this.verbose = o.log !== false; trace(bot, this.t0); }
    get t(): number { return this.bot.tickCount - this.t0; }
    log(s: string): void { if (this.verbose) console.log(`[${this.tag} +${String(this.t).padStart(4)}] ${s}`); }
    mark(k: string): void { this.marks[k] = this.t; this.log(`${k} @ ${JSON.stringify(this.bot.pos())} hp ${this.bot.stat("hitpoints").cur}/${this.bot.stat("hitpoints").level} run ${(this.bot as any).runEnergy}`); }
    fail(s: string): never { throw new QuestFail(`${s} | at ${JSON.stringify(this.bot.pos())}`); }
    private eating = false;
    /** Background: eat at 50% hp every tick while the quest runs (walks past aggressive trolls). Stop with stopEater(). */
    startEater(frac = 0.5): void {
        if (this.eating) return; this.eating = true;
        void (async () => { while (this.eating && !this.bot.disposed) { eatIfLow(this.bot, frac); await this.bot.tick(1); } })();
    }
    stopEater(): void { this.eating = false; }
}

/** Main modals a walk can trip over: wilderness_warning (interface 1908, area_wilderness/scripts/wilderness_warning.rs2:6-23+;
 *  Varrock -> Jolly Boar road at (3270,3515)) and the objbox1 (306) "You can now ..." unlock page after a level-up (sim:
 *  Ardougne Teleport took magic 58 -> 59). Now core sendRoute and q-lib
 *  walkOp close/continue both themselves now; the sets stay for callers that test them. */
export const WALK_BLOCKERS = new Set([1908]);
export const CHAT_BLOCKERS = new Set([306]);
/** walkOp with rsmod-first planning for the first leg (rsmod was <= navgrid on every leg measured: tool-route.ts Flying Horse ->
 *  Yanille 290 vs 304, Khazard -> Yanille 226 vs 247; the navgrid sent the Blue Moon -> Jolly Boar walk into the inn's north
 *  wall). MIGRATED: was walkOp(via: []) inside a blocker-retry loop; now walkOp's own rsmodFirst + blocker handling. */
export async function walk(bot: SpeedBot, dest: Tile, finalOp: (() => void | boolean) | null, done: () => boolean, o: Parameters<typeof walkOp>[4] = {}): Promise<boolean> {
    const ok = await walkOp(bot, dest, finalOp, done, { rsmodFirst: true, ...o });
    return done() || (ok && done());
}
/** Walk (walkOp: navgrid long legs, door opening, replans) to `dest` on the current level; fail if not reached. */
export async function go(c: Ctx, dest: Tile, label: string, o: { near?: number; maxTicks?: number; level?: number } = {}): Promise<void> {
    const near = o.near ?? 1;
    const there = () => cheb(c.bot.tile(), dest) <= near && c.bot.minusedlevel === (o.level ?? c.bot.minusedlevel);
    let ok = false;
    for (let k = 0; k < 3 && !ok; k++) {
        ok = await walk(c.bot, dest, null, there, { near, maxTicks: k ? 200 : o.maxTicks ?? 600, level: o.level });
        // wedged: usually a closed door the static map has open (chaos engines; the house after Swensen's maze)
        if (!ok && openDoorNear(c.bot, 3)) await c.bot.tick(2);
    }
    if (!ok) c.fail(`walk ${label} -> (${dest.x},${dest.z})`);
}

/** Answer the open dialog adaptively until `done()`: resume pages, click the first matching option. */
/** Every option click converse() makes is reported here (text of the clicked option), for "clicked X, then closed" proofs. */
export const CLICKS: { last: string; n: number } = { last: '', n: 0 };
export async function converse(bot: SpeedBot, done: () => boolean, answers: RegExp[], maxTicks = 40, burst = 3): Promise<boolean> {
    const end = bot.tickCount + maxTicks; let lastSig = '', lastClick = -99;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (bot.chatModalId !== -1) {
            const opts = bot.dialogOptions();
            if (opts.length) {
                const sig = opts.map(x => x.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 3) {
                    for (const re of answers) { const i = bot.clickDialogByText(re); if (i > 0) { lastSig = sig; lastClick = bot.tickCount; CLICKS.last = opts[i - 1]!.text; CLICKS.n++; break; } }
                }
            } else for (let i = 0; i < burst; i++) bot.resumeDialogPage();
            bot.queueFlush();
        }
        await bot.tick(1);
    }
    return done();
}

/** Rub a charged jewellery item (OPHELD4) and pick the destination by option text; resolves when the position jumps. */
export async function rubTeleport(c: Ctx, base: RegExp, dest: RegExp, maxTicks = 15): Promise<boolean> {
    const bot = c.bot, p0 = bot.pos();
    const item = bot.inv().find(s => base.test(objDebugName(s.obj)));
    if (!item) return false;
    for (let k = 0; k < 2; k++) {
        // NOT in the same flush as a CLOSE_MODAL: the engine then drops the OPHELD4 (sim-measured: no dialog in 15 t)
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.chatModalId = -1; bot.mainModalId = -1; await bot.tick(1); }
        opHeld(bot, item.obj, 4);
        const ok = await converse(bot, () => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level, [dest], maxTicks);
        if (ok) return true;
    }
    return false;
}

/** HP helpers: eat the first food in `foods` when hp <= frac of max. Returns true if a bite was sent. */
export const FOODS = ['shark', 'manta_ray', 'sea_turtle', 'monkfish', 'swordfish', 'lobster', 'bass', 'tuna', 'salmon', 'trout', 'cake', '2/3_cake', 'slice_of_cake'];
let lastEat = -10;
export function eatIfLow(bot: SpeedBot, frac = 0.5, foods = FOODS): boolean {
    const hp = bot.stat('hitpoints');
    if (hp.cur <= 0 || hp.cur > Math.floor(hp.level * frac) || bot.tickCount - lastEat < 3) return false;
    for (const f of foods) {
        let id: number; try { id = objId(f); } catch { continue; }
        const s = bot.slot(id); if (s < 0) continue;
        bot.opHeld1(id, s); bot.queueFlush(); lastEat = bot.tickCount; return true;
    }
    return false;
}
export function dead(bot: SpeedBot): boolean { return bot.stat('hitpoints').level > 0 && bot.stat('hitpoints').cur === 0; }

/** Wait for a game message / IF text matching `re` that arrived at or after `since` (tick). */
export function sawMsg(bot: SpeedBot, re: RegExp, since: number): boolean { return msgsSince(bot, since).some(t => re.test(t)); }

export function packStr(bot: SpeedBot): string { return bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', '); }

/** Nearest npc of a type, walking to `stand` first if none is visible within `vis` tiles. */
export async function seek(c: Ctx, type: number | number[], stand: Tile, label: string, vis = 14): Promise<NpcRef> {
    let n = npc(c.bot, type);
    if (!n || n.d > vis) { await go(c, stand, label, { near: 3 }); n = npc(c.bot, type); }
    if (!n) c.fail(`${label}: npc ${type} not visible`);
    return n!;
}
/** Op (open) the nearest door the live door tracker knows is closed, within r tiles. */
export function openDoorNear(bot: SpeedBot, r = 2): boolean {
    const me = bot.tile();
    // first: a runtime loc (zone stream, bot.liveLocs) whose id door-states.json lists as a CLOSED door - e.g. a chaos
    // engine closed Sanfew's house door (open loc_1531 @ 2901,3428 by default; the tracker did not know it, sim seed 6311)
    let best: { x: number; z: number; id: number; d: number } | null = null;
    for (const [k, id] of bot.liveLocs) {
        if (doorStates()[String(id)]?.state !== 'closed') continue;
        const [lv, x, z] = k.split(',').map(Number);
        const d = cheb({ x: x!, z: z! }, me);
        if (lv === bot.minusedlevel && d <= r && (!best || d < best.d)) best = { x: x!, z: z!, id, d };
    }
    // a bare OPLOC from out of reach is dropped (core.ts opLocReach note): step onto the door's tile first (MOVE_OPCLICK + op)
    if (best) { if (best.d > 0) bot.sendRoute([{ x: best.x, z: best.z }], true); bot.opLoc(best.x, best.z, best.id, 1); bot.queueFlush(); return true; }
    const cd = (bot as any).doorTracker?.nearestClosed(bot.minusedlevel, me.x, me.z, r);
    if (cd) { bot.opLoc(cd.x, cd.z, cd.locId, cd.op); bot.queueFlush(); return true; }
    return false;
}
let DOORS: Record<string, { state: string }> | null = null;
function doorStates(): Record<string, { state: string }> {
    if (DOORS) return DOORS;
    try { DOORS = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../../../../../sdk/navgrid/door-states.json'), 'utf8')); } catch { DOORS = {}; }
    return DOORS!;
}
/** locAt that tries the given level, then the others (bridge-flagged maps store some locs one level up). */
export function locAny(id: number, x: number, z: number, level = 0) {
    for (const lv of [level, 1, 0, 2, 3]) { try { return locAt(id, x, z, lv); } catch { /* next */ } }
    throw new Error(`loc ${id} not at (${x},${z}) on any level`);
}

/** Walk to (or straight at) an obstacle/loc and op it until `done`. `stand` = an exact tile to op from (else opLocGo routes). */
export async function obstacle(c: Ctx, l: { id: number; x: number; z: number; level?: number }, stand: Tile | null, done: () => boolean, label: string, op = 1, maxTicks = 120): Promise<void> {
    const bot = c.bot, loc = locAny(l.id, l.x, l.z, l.level ?? 0);
    const end = bot.tickCount + maxTicks;
    const st0 = stand;
    for (let k = 0; k < 3 && st0 && cheb(bot.tile(), st0) > 0 && !done(); k++) {
        await walk(bot, st0, null, () => cheb(bot.tile(), st0) === 0 || done(), { near: 0, maxTicks: k ? 30 : 300 });
        // short of the stand tile: usually a closed door the static map calls open (Sanfew's house) -> open it, retry
        if (cheb(bot.tile(), st0) > 0 && !done() && openDoorNear(bot, 3)) await bot.tick(2);
    }
    if (stand && cheb(bot.tile(), stand) > 0) stand = null;   // could not stand there: let opLocGo pick any valid tile
    // far away with no stand tile: let the walker get us close first (it opens closed doors; opLocGo's own route does not)
    if (!stand && !done() && cheb(bot.tile(), loc) > 12 && bot.minusedlevel === loc.level) await walk(bot, { x: loc.x, z: loc.z }, null, () => cheb(bot.tile(), loc) <= 3 || done(), { near: 3, maxTicks: 400 });
    let lastSend = -99, lastPos = '', still = 0;
    while (!done() && bot.tickCount < end) {
        if (inDialog(bot)) { dismiss(bot); await bot.tick(1); continue; }
        const p = `${bot.tile().x},${bot.tile().z},${bot.minusedlevel}`;
        still = p === lastPos ? still + 1 : 0; lastPos = p;
        // re-send when we stand still (a dropped op while delayed, or a walk that ended short), at most every 3 ticks
        if ((lastSend < 0 || still >= 1) && bot.tickCount - lastSend >= 3) {
            // standing still for 9+ ticks: a closed door (chaos door states) between us and the loc -> open it first
            if (still >= 9 && still % 9 === 0 && !(st0 && cheb(bot.tile(), st0) === 0) && openDoorNear(bot, 3)) { await bot.tick(2); continue; }
            opLocGo(bot, loc, op, stand ?? undefined); lastSend = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (!done()) c.fail(`${label} (loc ${l.id} @ ${l.x},${l.z}) | ${situation(bot, 4).slice(0, 600)}`);
    c.log(`${label} ok (hp ${bot.stat("hitpoints").cur})`);
}


/** Talk until an option matching `final` has been clicked and the dialog closed (answers in order of preference). */
export async function talkPick(c: Ctx, type: number, stand: Tile | null, answers: RegExp[], final: RegExp, label: string, extraDone: () => boolean = () => false): Promise<void> {
    const bot = c.bot, n0 = CLICKS.n; let picked = false;
    const done = () => { if (CLICKS.n > n0 && final.test(CLICKS.last)) picked = true; return (picked || extraDone()) && !inDialog(bot); };
    await talkTo(c, type, stand, [], answers, done, label);
    dismiss(bot);
}
/** Talk to an npc (walk to `stand` first if it is not in view), burst `plan` on the first page, answer adaptively. */
export async function talkTo(c: Ctx, type: number, stand: Tile | null, plan: FTok[], answers: RegExp[], done: () => boolean, label: string): Promise<void> {
    const bot = c.bot;
    let sent = false;
    for (let k = 0; k < 5 && !done(); k++) {
        let n = npc(bot, type);
        if ((!n || n.d > 12) && stand) { await go(c, stand, label, { near: 3 }); n = npc(bot, type); }
        if (!n) c.fail(`${label}: npc ${type} not visible`);
        if (inDialog(bot) && !sent) { dismiss(bot); await bot.tick(1); }
        if (!inDialog(bot)) {
            // re-send every 3 ticks while we stand still (an op sent while an agility move still runs is dropped)
            let lastPos = '', ok = false;
            for (let w = 0; w < 12 && !ok; w++) {
                const m = npc(bot, type) ?? n!; const p = `${bot.tile().x},${bot.tile().z}`;
                if (w === 6 && p === lastPos && openDoorNear(bot, 3)) { await bot.tick(2); continue; }   // a closed house door
                if (w === 0 || (p === lastPos && w % 3 === 0)) opNpcGo(bot, m, 1);
                lastPos = p;
                ok = await bot.until(() => inDialog(bot) || done(), 1);
            }
            if (!ok) continue;
        }
        if (!sent && inDialog(bot)) { sendToks(bot, plan); sent = true; }
        await converse(bot, done, answers, 25);
    }
    if (!done()) c.fail(`${label}: dialog`);
}


export { npc, npcsOf, nav, inDialog, cheb, dismiss, sendToks, opNpcGo, opLocGo, locAt };

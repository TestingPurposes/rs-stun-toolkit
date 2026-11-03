// ka-lib.ts — lane-local helpers for the kandarin quest lane (max-QP build, rev 289). Cheat-free except simSetup()
// (used ONLY by the run-*.ts launchers in --sim mode, refuses a non-local LC_HOST).
//
// Shape (QP-BUILD.md §2): each q-<quest>.ts exports QUEST, REQUIREMENTS, SUPPLY and run(bot). The launchers call
// launch(mod, simCfg) below, which implements --live / --sim / --supply identically for every quest of the lane.
import { NO_GLORY, noGloryHop } from '../noglory.js';
import { ClientProt } from '#/io/ClientProt.js';
// @ts-ignore (no node types in the webclient tsconfig; Bun provides them)
import { readFileSync } from 'fs';
// @ts-ignore
import { resolve } from 'path';
import { SpeedBot, CHEATS, localSetup, objId, objDebugName, cheb } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { nav, navSync, npc, npcsOf, locAt, opNpcGo, inDialog, walkOp, qp, pickupGo, opLocGo, useOnLocGo, msgsSince, levelUpOpen, trace, opHeld as qOpHeld, type Tile, type Wall } from '../../q-lib.js';
import { densify } from '../../../core.js';
import { wield } from '../../run-lib.js';
import { stepCrossesDoorEdge } from '../../../../leanbot.js';
import { isDoorLoc } from '../../../../../../../sdk/navgrid/door-tracker';
import * as locSceneRt from '../../../../loc-scene.js';
import type * as locScene from '../../../../loc-scene.js';
// the webclient tsconfig has no node types (framework-wide 'process' errors); Bun provides it at runtime
declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(code?: number): never };

export type Item = { name: string; n: number };
export interface QuestInfo { name: string; dir: string; qp: number }
export interface Requirements {
    quests: string[]; qp: number; skills: Record<string, [number, string]>;
    start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number };
}
export interface RunResult { ok: boolean; ticks: number; msg: string }
export interface QuestModule {
    QUEST: QuestInfo; REQUIREMENTS: Requirements; SUPPLY: Item[];
    run(bot: SpeedBot, o?: { log?: boolean }): Promise<RunResult>;
}

// ---------------------------------------------------------------------------------------------------------
// text log: every IF_SETTEXT the client decodes (a 5-page dialog burst sets the same component 5 times in one tick,
// so a once-per-tick diff of bot.ifText misses the middle pages). Instance-level wrap of the Map's set().
// ---------------------------------------------------------------------------------------------------------
const TEXT_LOG = new WeakMap<SpeedBot, Array<{ tick: number; com: number; text: string }>>();
export function installTextLog(bot: SpeedBot): void {
    if (TEXT_LOG.has(bot)) return;
    const log: Array<{ tick: number; com: number; text: string }> = [];
    TEXT_LOG.set(bot, log);
    const m = bot.ifText as Map<number, string>;
    // session 9 (max-QP route, from-zero one-shots): this wrap called Map.prototype.set directly and so DETACHED every wrap
    // installed before it (q-lib textLog, sp-lib, rb-lib): after any kandarin module, every later sawText-based check on that
    // bot session was blind (Digsite student talks 4 x 60 t each, ~1.7k t per run). Chain to the previous set instead.
    const prev = m.set;
    m.set = function (this: Map<number, string>, k: number, v: string) { if (v) { log.push({ tick: bot.tickCount, com: k, text: v }); if (log.length > 4000) log.splice(0, 2000); } return prev.call(this, k, v) as Map<number, string>; };
}
/** Every dialog text / game message since `since` (diagnostics). */
export function textsSince(bot: SpeedBot, since: number): string[] {
    return [...(TEXT_LOG.get(bot) ?? []).filter(e => e.tick >= since).map(e => `t${e.tick} ${e.com}: ${e.text}`), ...msgsSince(bot, since).map(m => `msg: ${m}`)];
}
/** Did a dialog text or game message matching `re` arrive at or after `since`? */
export function heard(bot: SpeedBot, re: RegExp, since: number): boolean {
    // chatnpc/chatplayer word-wrap a long line over several text components (one IF_SETTEXT each), so a phrase can be
    // split ("...in the room next to" | "the library."): also test each tick's texts joined in arrival order.
    const log = TEXT_LOG.get(bot) ?? [];
    let joined = '', tick = -1;
    for (let i = log.length - 1; i >= 0 && log[i]!.tick >= since; i--) {
        const e = log[i]!;
        if (re.test(e.text)) return true;
        if (e.tick !== tick) { if (joined && re.test(joined)) return true; joined = ''; tick = e.tick; }
        joined = `${e.text} ${joined}`;
    }
    if (joined && re.test(joined)) return true;
    return msgsSince(bot, since).some(t => re.test(t));
}

// ---------------------------------------------------------------------------------------------------------
// guards
// ---------------------------------------------------------------------------------------------------------
export class QuestFail extends Error {}
export function dead(bot: SpeedBot): boolean { const h = bot.stat('hitpoints'); return h.level > 0 && h.cur <= 0; }
export function fail(bot: SpeedBot, s: string): never { const p = bot.pos(); throw new QuestFail(`${s} at (${p.x},${p.z},L${p.level})`); }
export function checkAlive(bot: SpeedBot): void { if (dead(bot)) fail(bot, 'DIED'); }

/** Step logger: `at('step')` prints `[label +ticks] step` and records it. */
export function stepper(bot: SpeedBot, label: string, logOn = true) {
    const t0 = bot.tickCount; const steps: Record<string, number> = {};
    return {
        t0, steps,
        at(k: string) { steps[k] = bot.tickCount - t0; if (logOn) { const p = bot.pos(); console.log(`[${label} +${String(bot.tickCount - t0).padStart(4)}] ${k} (${p.x},${p.z},L${p.level}) hp ${bot.stat("hitpoints").cur} run ${(bot as any).runEnergy}`); } },
    };
}

// ---------------------------------------------------------------------------------------------------------
// walk: q-lib walkOp + a stuck-step learner. The planners use the STATIC map with every door passable; an OPENED door
// leaf is a wall the planner never sees (Camelot's main double door 1516/1519 at (2757-2758,3503): open, its leaves
// stand on the west/east edges of (2757,3504)/(2758,3504), and walkOp wedged for ~80 t at (2756,3504) re-planning the
// same blocked diagonal 20 times). When the position has not changed for 5 ticks (no dialog, no closed door being
// worked, no npc on the next tile), the step we are stuck on is walled off for 500 t (the door revert time) and the
// walk re-planned around it.
// ---------------------------------------------------------------------------------------------------------
// (sdk/pathfinding findLongPath applies `blocked` only on known door tiles, so a learned wall is written into this
// process's rsmod collision with changeWall, as q-lib addWalls does, and removed again when it expires.)
const LEARNED: Array<{ w: Wall; until: number }> = [];
/** Switch for the stuck-step learner (a door-dense interior with npcs in the doorways, e.g. the Sinclair Mansion, can
 *  make it wall off a doorway; such quests turn it off). */
export const WALK_LEARN = { on: true };
/** wilderness_warning (interface 1908): if_openmain + p_stopaction the first time the player crosses z 3512-3515
 *  (areas/area_wilderness/scripts/wilderness_warning.rs2:14-26; %wilderness is set before the open, so one close is enough). */
const WILDY_WARNING = 1908;
let RSMOD: any = null;
async function expireWalls(bot: SpeedBot): Promise<void> {
    RSMOD ??= await import('../../../../../../vendor/rsmod-pathfinder');
    for (let i = LEARNED.length - 1; i >= 0; i--) {
        const l = LEARNED[i]!;
        if (l.until > bot.tickCount) continue;
        RSMOD.changeWall(l.w.x, l.w.z, l.w.level, l.w.angle, l.w.shape, false, false, false);
        LEARNED.splice(i, 1);
    }
}
export async function walk(bot: SpeedBot, dest: Tile, finalOp: (() => void | boolean) | null, done: () => boolean,
    o: { near?: number; maxTicks?: number; level?: number } = {}): Promise<boolean> {
    const n = await nav();
    const near = o.near ?? 0, end = bot.tickCount + (o.maxTicks ?? 1500);
    for (let attempt = 0; attempt < 10; attempt++) {
        await expireWalls(bot);
        let last = '', still = 0, stalled = false;
        const stallCheck = () => {
            const t = bot.tile(); const k = `${t.x},${t.z},${bot.minusedlevel}`;
            still = k === last ? still + 1 : 0; last = k;
            if (still >= 5 && cheb(t, dest) > near && !inDialog(bot) && bot.mainModalId === -1) { stalled = true; return true; }
            return false;
        };
        const left = end - bot.tickCount;
        if (left <= 0) return done();
        const modal = () => bot.mainModalId === WILDY_WARNING;
        // eat on the way (aggressive npcs: Taverley dungeon dragons/spiders killed a def-1 account mid-walk)
        const ok = await walkOp(bot, dest, finalOp, () => { eatIfLow(bot); return done() || dead(bot) || modal() || stallCheck(); }, { near, maxTicks: left, level: o.level });
        checkAlive(bot);
        if (done()) return true;
        if (modal()) { bot.closeModal(); bot.mainModalId = -1; bot.queueFlush(); await bot.tick(1); continue; }
        if (!stalled) return ok;
        // learn the stuck step
        const me = bot.tile(), level = bot.minusedlevel;
        let pts: Tile[] = [];
        try { pts = n.findLongPath(level, me.x, me.z, dest.x, dest.z, 500); } catch { pts = []; }
        const step = densify([me, ...pts])[1];
        if (!step) { await bot.tick(1); continue; }
        const tr = bot.doorTracker;
        const busy = tr?.closedDoorAt(level, me.x, me.z) || tr?.closedDoorAt(level, step.x, step.z)
            || npcsOf(bot, [...new Set(Array.from({ length: bot.npcCount }, (_, i) => bot.npcs[bot.npcIndices[i]!]?.typeId ?? -1))]).some(q => q.x === step.x && q.z === step.z);
        if (busy) {
            // a door the tracker knows is CLOSED next to us but walkOp walks past: a door whose DEFAULT state is open
            // (static geometry = the open leaf), shut by a player or the chaos engine. walkOp's crossing test uses the
            // static leaf and never sees the shut leaf (Seers double door 1511/1507 at 2709-2710,3487, chaos seed
            // 4401). Operate it ourselves.
            const cd = tr?.nearestClosed(level, me.x, me.z, 1);
            // a wall door is operable from its own tile (probe-door.ts: from the tile south of the Seers leaf nothing
            // happened, from the leaf's tile it opened): step onto it, then OPLOC in the same burst
            if (cd) {
                console.log(`[ka] walk(${dest.x},${dest.z}): opening closed door ${cd.locId} at (${cd.x},${cd.z}) from (${me.x},${me.z})`);
                if (me.x !== cd.x || me.z !== cd.z) bot.sendRoute([{ x: cd.x, z: cd.z }], true);
                bot.opLoc(cd.x, cd.z, cd.locId, cd.op); bot.queueFlush(); await bot.tick(3);
            }
            continue;
        }
        // a scripted door the tracker does not know (Merlin's workshop door, loc 24): walkOp cannot open it, and walling
        // its edge would cut the only way in. Leave it to the quest code (it ops such doors itself).
        // the stuck step IS a doorway (crosses a static door's edge): never wall it; operate the door instead
        // (Sinclair Mansion door 1533 at 2735,3581: walled once, which then cut off the flour barrel and sacks)
        const doorway = [me, step].map(t => n.getDoorAt(level, t.x, t.z)).find(g => g && stepCrossesDoorEdge(g, me, step));
        if (doorway) {
            const live = bot.liveLocs.get(`${level},${doorway.x},${doorway.z}`);
            const st = locSceneRt.getLocsAt(doorway.x, doorway.z, level).find(l => isDoorLoc(l.id));
            const id = live ?? st?.id;
            console.log(`[ka] walk(${dest.x},${dest.z}): stuck in the doorway (${doorway.x},${doorway.z}); operating door ${id}`);
            if (id !== undefined && id >= 0) { if (me.x !== doorway.x || me.z !== doorway.z) bot.sendRoute([{ x: doorway.x, z: doorway.z }], true); bot.opLoc(doorway.x, doorway.z, id, 1); bot.queueFlush(); await bot.tick(3); }
            continue;
        }
        const scripted = [me, step].some(t => locSceneRt.getLocsAt(t.x, t.z, level).some(l => /door|gate/i.test(l.name) && !isDoorLoc(l.id)));
        if (scripted) { console.log(`[ka] walk(${dest.x},${dest.z}): stuck at a scripted door near (${me.x},${me.z}); not walling it`); return false; }
        if (!WALK_LEARN.on) { await bot.tick(1); continue; }
        const dx = Math.sign(step.x - me.x), dz = Math.sign(step.z - me.z);
        const sides: number[] = [];
        if (dx < 0) sides.push(0); if (dz > 0) sides.push(1); if (dx > 0) sides.push(2); if (dz < 0) sides.push(3);
        const added: number[] = [];
        for (const angle of sides) {
            if (LEARNED.some(l => l.w.level === level && l.w.x === me.x && l.w.z === me.z && l.w.angle === angle)) continue;
            LEARNED.push({ w: { level, x: me.x, z: me.z, shape: 0, angle, blockrange: false }, until: bot.tickCount + 500 });
            RSMOD.changeWall(me.x, me.z, level, angle, 0, false, false, true);
            added.push(angle);
        }
        // charger cg9p Murder Mystery 'mansion ladder to L1': stuck once at (2738,3581), a pocket by the mansion ladder whose
        // ONLY exit is the diagonal (2739,3580); walling sides 2+3 sealed it, so every later walk/walkOp found 'no route' for
        // 500 t and the quest failed. A learned wall that leaves no route at all is wrong: take it back, wait, retry.
        // KA_SEAL_GUARD=0 reverts.
        if (added.length && process.env.KA_SEAL_GUARD !== '0') {
            let after: Tile[] = [];
            try { after = n.findLongPath(level, me.x, me.z, dest.x, dest.z, 500); } catch { after = []; }
            const last = after[after.length - 1];
            if (!last || cheb(last, dest) > Math.max(1, near)) {
                for (const angle of added) {
                    const i = LEARNED.findIndex(l => l.w.level === level && l.w.x === me.x && l.w.z === me.z && l.w.angle === angle);
                    if (i >= 0) LEARNED.splice(i, 1);
                    RSMOD.changeWall(me.x, me.z, level, angle, 0, false, false, false);
                }
                console.log(`[ka] walk(${dest.x},${dest.z}): stuck at (${me.x},${me.z},L${level}) stepping to (${step.x},${step.z}): walling side(s) ${added.join(',')} would seal us in; not walled, waiting`);
                await bot.tick(3);
                continue;
            }
        }
        console.log(`[ka] walk(${dest.x},${dest.z}): stuck at (${me.x},${me.z},L${level}) stepping to (${step.x},${step.z}): walled side(s) ${sides.join(',')} for 500 t, re-planning`);
    }
    return done();
}

// ---------------------------------------------------------------------------------------------------------
// npcs + dialog
// ---------------------------------------------------------------------------------------------------------
/** Walk toward `at` and talk to the nearest npc of `type` once it is in view (route + OPNPC in one tick).
 *  Resolves when a dialog page (not a level-up) is open. */
export async function toNpc(bot: SpeedBot, type: number | number[], at: Tile, o: { op?: number; maxTicks?: number; near?: number; done?: () => boolean } = {}): Promise<boolean> {
    await nav();
    const done = o.done ?? (() => inDialog(bot));
    const end = bot.tickCount + (o.maxTicks ?? 600);
    const trace = (s: string) => { if (process.env.KA_TRACE === '1') console.log(`[ka] toNpc t${bot.tickCount} ${s}`); };
    for (let k = 0; k < 12 && bot.tickCount < end; k++) {
        if (done()) return true;
        checkAlive(bot);
        const n = npc(bot, type);
        if (!n || n.d > 14) {
            // not in view: walk toward its spawn until it is
            trace(`npc not in view, walking to (${at.x},${at.z})`);
            await walk(bot, at, null, () => done() || dead(bot) || (npc(bot, type)?.d ?? 99) <= 10, { near: o.near ?? 3, maxTicks: end - bot.tickCount });
            if (!npc(bot, type)) { await bot.tick(1); }
            continue;
        }
        trace(`npc ${n.idx}@${n.x},${n.z} d${n.d} me=${JSON.stringify(bot.tile())}`);
        if (n.d <= 1 || (Math.abs(n.x - bot.tile().x) + Math.abs(n.z - bot.tile().z)) === 1) {
            opNpcGo(bot, n, o.op ?? 1);
            if (await bot.until(() => done() || dead(bot), 6)) { checkAlive(bot); return done(); }
            // session 11 fix 358 (MM2_ADJ_DOOR; qx166m 'Carol about the poison at (2735,3577,L1)', 340 t): Carol wandered through
            // the chaos-opened door 1530 (2736,3577,L1) into the room south of the corridor and it shut again; from (2734-2735,3577)
            // she stood 1 tile away ACROSS the wall, so every round came here: OPNPC, engine 'target cleared' every 6 t
            // (eng-qx166 t66042-66312), 3 talkNpc tries x 12 rounds, and nothing opened the door (the retry got in only once the
            // door had flipped open). A missed op next to the npc: open a closed door within 2 tiles (walk()'s burst: step onto
            // the leaf, OPLOC), the next round routes through it. =0 reverts.
            // session 11 fix 398c (qx374p murder 'Carol about the poison at 2734/2735,3577,L1' x2 -> 57 QP; qx211p the same):
            // 358 picked the nearest closed door to US (1533 at 2735,3578, behind us). The door between us and Carol is 1530
            // (2736,3577, south edge, m42_55). Default now: only a closed door within 1 tile of the npc and 2 of us.
            // MM2_ADJ_DOOR=0 = off; MM2_ADJ_DOOR=1 = the old unscoped 358. TEST: MM2_TEST398=1 logs both picks every round.
            const adj398 = (): { x: number; z: number; locId: number; op: number } | null => {
                const me = bot.tile(); let best: { x: number; z: number; locId: number; op: number } | null = null;
                for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                    const x = n.x + dx, z = n.z + dz, d = bot.doorTracker?.closedDoorAt(bot.minusedlevel, x, z);
                    if (d && cheb({ x, z }, me) <= 2 && (!best || cheb({ x, z }, me) < cheb(best, me))) best = { x, z, locId: d.locId, op: d.op };
                }
                return best;
            };
            if (process.env.MM2_TEST398 === '1') console.log(`[ka] 398c TEST: npc ${n.x},${n.z} scoped ${JSON.stringify(adj398())} unscoped ${JSON.stringify(bot.doorTracker?.nearestClosed(bot.minusedlevel, bot.tile().x, bot.tile().z, 2) ?? null)}`);
            const cd = done() || process.env.MM2_ADJ_DOOR === '0' ? null : process.env.MM2_ADJ_DOOR === '1' ? bot.doorTracker?.nearestClosed(bot.minusedlevel, bot.tile().x, bot.tile().z, 2) : adj398();
            if (cd) {
                const me = bot.tile();
                console.log(`[ka] toNpc: op missed next to npc ${n.idx}@${n.x},${n.z}; opening closed door ${cd.locId} at (${cd.x},${cd.z}) from (${me.x},${me.z})`);
                if (me.x !== cd.x || me.z !== cd.z) bot.sendRoute([{ x: cd.x, z: cd.z }], true);
                bot.opLoc(cd.x, cd.z, cd.locId, cd.op); bot.queueFlush(); await bot.tick(3);
            }
            continue;
        }
        // walk() toward its tile (opens closed doors on the way; an OPNPC routed through a closed door is discarded:
        // Sir Gawain behind the Camelot door 1533 at (2766,3504)), OPNPC fired with the last MOVE. near 0, not 1: a
        // tile within 1 can be across a wall ("I can't reach that!" x4 on Gawain, ka17); the engine starts the
        // interaction as soon as the walk passes a tile that reaches him.
        let opAt = -99;
        await walk(bot, { x: n.x, z: n.z }, () => { const m = npc(bot, type); if (m && bot.tickCount - opAt >= 4) { opAt = bot.tickCount; if (levelUpOpen(bot)) bot.resumeDialogPage(); bot.opNpc(m.idx, o.op ?? 1); } },
            () => done() || dead(bot), { near: 0, maxTicks: Math.min(end - bot.tickCount, 120) });
        if (await bot.until(() => done() || dead(bot), 4)) { checkAlive(bot); return done(); }
    }
    return done();
}

/**
 * Adaptive dialog driver: resume pages (burst of 5 per tick), answer choice pages by option text (first matching
 * regex wins, one click per page), until `done()`. Returns false when the chat stays closed for `closedTicks`
 * ticks without done() (the conversation ended elsewhere) or on timeout.
 */
export async function chat(bot: SpeedBot, answers: RegExp[], done: () => boolean, o: { maxTicks?: number; closedTicks?: number; label?: string } = {}): Promise<boolean> {
    const end = bot.tickCount + (o.maxTicks ?? 80);
    let closed = 0, lastSig = '', lastClick = -99;
    while (!bot.disposed && bot.tickCount < end) {
        if (done()) return true;
        checkAlive(bot);
        if (process.env.KA_TRACE === '1') console.log(`[ka] ${o.label ?? 'chat'} t${bot.tickCount} chat=${bot.chatModalId} opts=[${bot.dialogOptions().map(x => x.text).join('|')}] closed=${closed}`);
        if (bot.chatModalId !== -1) {
            closed = 0;
            const opts = bot.dialogOptions();
            if (opts.length && opts.some(x => x.text)) {
                const sig = opts.map(x => x.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 3) {
                    let hit = -1;
                    for (const re of answers) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                    if (hit < 0) { console.log(`[ka] ${o.label ?? 'chat'}: unplanned choice [${opts.map(x => x.text).join(' | ')}]`); return false; }
                    lastSig = sig; lastClick = bot.tickCount;
                }
            } else if (!opts.length) { for (let i = 0; i < 5; i++) bot.resumeDialogPage(); }
            bot.queueFlush();
        } else if (++closed >= (o.closedTicks ?? 3)) return done();
        await bot.tick(1);
    }
    return done();
}

/** toNpc + chat, retried (a missed click or a wandering npc must not desync the sequence). */
export async function talkNpc(bot: SpeedBot, type: number | number[], at: Tile, answers: RegExp[], done: () => boolean,
    o: { tries?: number; label?: string; maxTicks?: number; closedTicks?: number } = {}): Promise<boolean> {
    for (let k = 0; k < (o.tries ?? 3); k++) {
        if (done()) return true;
        if (bot.chatModalId !== -1 && !inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }   // level-up page
        if (!inDialog(bot) && !(await toNpc(bot, type, at, { maxTicks: o.maxTicks }))) continue;
        if (await chat(bot, answers, done, { label: o.label, closedTicks: o.closedTicks })) return true;
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
    }
    return done();
}

// ---------------------------------------------------------------------------------------------------------
// items + locs
// ---------------------------------------------------------------------------------------------------------
/** Pick a ground obj up at `at` (route + OPOBJ3 in one tick), retried. */
export async function pickup(bot: SpeedBot, obj: string | number, at: Tile, o: { maxTicks?: number } = {}): Promise<boolean> {
    await nav();
    const id = objId(obj), n0 = bot.count(id);
    const got = () => bot.count(id) > n0;
    // far / behind a door: walkOp (opens doors on the way) to within 1 tile, OPOBJ fired with the last chunk
    // (objs on tables sit on a blocked tile: Monk's Friend blanket on bigtable2 2570,9604)
    if (cheb(bot.tile(), at) > 1) await walk(bot, at, () => bot.opObj(at.x, at.z, id, 3), () => got() || dead(bot), { near: 1, maxTicks: o.maxTicks ?? 300 });
    checkAlive(bot);
    for (let k = 0; k < 4 && !got(); k++) {
        const d = pickupGo(bot, id, at);
        await bot.until(() => got() || dead(bot), Math.ceil(d / 2) + 6);
        checkAlive(bot);
    }
    return got();
}
/** Operate a loc until `done()` (route + OPLOC in one tick, re-sent every `every` ticks). */
/** The tile the engine would stand on to interact with `loc` (rsmod findPathToLoc end; the static map treats doors as
 *  open, so the walk to it must go through walk(), which opens them). null when out of the planner window. */
export function standFor(bot: SpeedBot, loc: locScene.SceneLoc): Tile | null {
    const n = navSync(); const me = bot.tile(), level = bot.minusedlevel;
    const fa = n.locForceApproach(loc.id);
    if (n.reachedLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa)) return { x: me.x, z: me.z };
    const path = n.findPathToLoc(level, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, 500, fa);
    const e = path[path.length - 1];
    if (!e || !n.reachedLoc(level, e.x, e.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa)) return null;
    return { x: e.x, z: e.z };
}
/** Walk to the loc's interaction tile with walk() (navgrid long legs, door opening, stuck-step learner), firing `send`
 *  with the last MOVE, then re-send `send` via the short opLocGo-style route every `every` ticks until done().
 *  (opLocGo alone routes straight into a closed door and the OPLOC is discarded: Keep Le Faye's crate-room double
 *  door 1516/1519, the Camelot tower door 1533 at (2766,3495).) */
async function approachLoc(bot: SpeedBot, loc: locScene.SceneLoc, send: () => void, reSend: () => void, done: () => boolean, o: { maxTicks?: number; every?: number; stand?: Tile }): Promise<boolean> {
    await nav();
    // a page left open by the previous step (e.g. the murder weapon's pickup mesbox) would end the walk below at once
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
    const end = bot.tickCount + (o.maxTicks ?? 60);
    const sameLevel = bot.minusedlevel === (loc.level ?? bot.minusedlevel);
    if (sameLevel && !o.stand && cheb(bot.tile(), loc) > 30)
        await walk(bot, { x: loc.x, z: loc.z }, null, () => done() || cheb(bot.tile(), loc) <= 12, { near: 12, maxTicks: Math.max(30, end - bot.tickCount + 600) });
    if (done()) return true;
    const stand = o.stand ?? (sameLevel ? standFor(bot, loc) : null);
    // the op rides the last MOVE chunk, but walkOp re-fires finalOp every 3 ticks at the stand tile: a second OPLOC that
    // lands after the first one opened its dialog restarts the script (Keep Le Faye crate: mesbox set twice, then the
    // ride died on "Yes." 1/8 in probe-keepexit.ts). Fire at most once per 6 ticks.
    let sentAt = -99;
    const once = () => { if (bot.tickCount - sentAt < 6) return; sentAt = bot.tickCount; send(); };
    if (stand && (bot.tile().x !== stand.x || bot.tile().z !== stand.z))
        await walk(bot, stand, once, () => done() || dead(bot) || bot.chatModalId !== -1, { near: 0, maxTicks: Math.max(30, end - bot.tickCount + 300) });   // a page opened: the loop below continues it (walkOp would sit on it: Murder Mystery window, 368 t)
    let last = sentAt > 0 ? sentAt : bot.tickCount;
    if (!done() && (!stand || (bot.tile().x === stand.x && bot.tile().z === stand.z)) && bot.tickCount - sentAt >= 6) { reSend(); last = bot.tickCount; }
    const deadline = Math.max(end, bot.tickCount + Math.min(o.maxTicks ?? 60, 40));
    while (!done() && bot.tickCount < deadline && !bot.disposed) {
        checkAlive(bot);
        // a loc script that pauses on a plain page before its effect (Murder Mystery window/barrels: mesbox, then
        // inv_add): continue it; never re-op while a page is open (that restarts the script)
        if (bot.chatModalId !== -1) { if (!bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); } last = bot.tickCount; await bot.tick(1); continue; }
        if (stand && (bot.tile().x !== stand.x || bot.tile().z !== stand.z) && bot.tickCount - last >= (o.every ?? 6)) {
            // pushed off the stand (or the first walk ended on a page): walk again, door handling included
            await walk(bot, stand, once, () => done() || dead(bot) || bot.chatModalId !== -1, { near: 0, maxTicks: Math.max(20, deadline - bot.tickCount) });
            last = bot.tickCount; continue;
        }
        if (bot.tickCount - last >= (o.every ?? 6)) { reSend(); last = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}
/** Operate a loc until `done()`. */
export async function opLocUntil(bot: SpeedBot, loc: locScene.SceneLoc, op: number, done: () => boolean, o: { maxTicks?: number; every?: number; stand?: Tile } = {}): Promise<boolean> {
    return approachLoc(bot, loc, () => bot.opLoc(loc.x, loc.z, loc.id, op), () => { opLocGo(bot, loc, op, o.stand); }, done, o);
}
/** Use a held obj on a loc until `done()` (or the obj is gone). */
export async function useOnLocUntil(bot: SpeedBot, obj: string | number, loc: locScene.SceneLoc, done: () => boolean, o: { maxTicks?: number; every?: number; stand?: Tile; settle?: number } = {}): Promise<boolean> {
    const id = objId(obj);
    const send = () => { const sl = bot.slot(id); if (sl >= 0) bot.useItemOnLoc(loc.x, loc.z, loc.id, id, sl); };
    await approachLoc(bot, loc, send, () => { if (bot.slot(id) >= 0) useOnLocGo(bot, id, loc, o.stand); }, () => done() || bot.count(id) <= 0, o);
    // the obj is often consumed before the effect lands (a p_delay in the script): give it a few ticks
    if (!done() && bot.count(id) <= 0) await bot.until(done, o.settle ?? 6);
    return done();
}
/**
 * Fight the nearest npc of `type` until `done()`: attack (route + OPNPC2), eat at 50%, re-attack only when no hitsplat
 * has landed on it for `reAttack` ticks. `style` = an attack-style button component to click once first (e.g. 2432 =
 * combat_hacksword aggressive, capability-tables.ts STYLE_INTERFACE).
 */
export async function fight(bot: SpeedBot, type: number, done: () => boolean, o: { maxTicks?: number; reAttack?: number; style?: number; label?: string; eatReAttack?: number } = {}): Promise<boolean> {
    const end = bot.tickCount + (o.maxTicks ?? 300);
    if (o.style) { bot.ifButton(o.style); bot.queueFlush(); }
    let lastAtk = -99, lastHits = -1, lastHitTick = bot.tickCount, lastEat = -99;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        checkAlive(bot);
        const m = npc(bot, type);
        const ent: any = m ? bot.npcs[m.idx] : null;
        if (ent && ent.hitCount !== lastHits) { lastHits = ent.hitCount; lastHitTick = bot.tickCount; }
        if (process.env.KA_TRACE === '1' && ent) console.log(`[ka] ${o.label ?? 'fight'} t${bot.tickCount} npc ${m!.x},${m!.z} d${m!.d} hp ${ent.hpCur}/${ent.hpMax} hits ${ent.hitCount} me hp ${bot.stat('hitpoints').cur}`);
        // session 11 fix 384a (qx299m DIED to the Titan): an eat (OPHELD) runs clearPendingAction -> clearInteraction
        // (the rev-289 engine OpHeldHandler.ts / Player.ts:1020), so the attack stops and reAttack 8 idled ~8 t per shark. Opt-in
        // o.eatReAttack: re-attack that many ticks after an eat, and eat at most every 3 t (no double eat on stale hp).
        const ate = (o.eatReAttack === undefined || bot.tickCount - lastEat >= 3) && eatIfLow(bot);
        if (ate) { lastEat = bot.tickCount; if (o.eatReAttack !== undefined) lastAtk = lastHitTick = bot.tickCount - (o.reAttack ?? 6) + o.eatReAttack; }
        if (!ate && m && (lastAtk < 0 || bot.tickCount - Math.max(lastAtk, lastHitTick) >= (o.reAttack ?? 6))) { opNpcGo(bot, m, 2); lastAtk = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}
/** OPHELD4 on a backpack obj (e.g. Rub). MIGRATED q-lib opHeld. */
export function opHeld4(bot: SpeedBot, obj: number, slot: number): void { qOpHeld(bot, obj, 4, slot); }
export const GLORIES = ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1'];
/** Rub a charged amulet of glory (pack) and pick `dest` (/^Edgeville/, /^Karamja/, /^Draynor Village/, /^Al Kharid/):
 *  general/scripts/enchanted_jewellry/amulet_of_glory.rs2:1-35 (p_choice5, then ~player_teleport_normal). */
export async function rubGlory(bot: SpeedBot, dest: RegExp): Promise<boolean> {
    if (NO_GLORY()) return noGloryHop(bot, dest, `rubGlory ${dest.source}`);   // charger pair (SR_NO_GLORY=1, noglory.ts)
    const p0 = bot.pos();
    for (let k = 0; k < 3; k++) {
        const g = GLORIES.find(n => bot.count(n) > 0);
        if (!g) return false;
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        opHeld4(bot, objId(g), bot.slot(g));
        if (!(await bot.until(() => bot.dialogOptions().some(o => dest.test(o.text)), 4))) continue;
        bot.clickDialogByText(dest); bot.queueFlush();
        if (await bot.until(() => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level, 10)) return true;
    }
    return cheb(bot.tile(), p0) > 8;
}
/** Auto-retaliate (varp 172 %option_nodef, 0 = on): on every melee hit auto_retaliate.rs2:1-26 runs p_opnpc(2), which
 *  closes an open dialog and kills its script (Keep Le Faye's renegade knights broke the crate ride 4/8 times in
 *  probe-keepexit.ts). controls:com_3 = 151 (off) / 150 (on), leanbot.ts RETALIATE_*_BUTTON. Returns the old state. */
export async function setRetaliate(bot: SpeedBot, on: boolean): Promise<boolean> {
    const wasOn = bot.getVarp(172) === 0;
    if (wasOn === on) return wasOn;
    bot.ifButton(on ? 150 : 151); bot.queueFlush();
    await bot.until(() => (bot.getVarp(172) === 0) === on, 3);
    return wasOn;
}
/** Eat `food` when hp < frac of base (no wait). */
export function eatIfLow(bot: SpeedBot, food: string[] = ['shark', 'lobster', 'swordfish', 'trout', 'salmon'], frac = 0.5): boolean {
    const h = bot.stat('hitpoints');
    if (h.cur >= h.level * frac) return false;
    for (const f of food) { const s = bot.slot(f); if (s >= 0) { bot.opHeld1(objId(f), s); bot.queueFlush(); return true; } }
    return false;
}
/** locAt that tolerates the map's bridge flag: a loc the .jm2 files list on level L can be in the scene on L-1. */
export function findLoc(id: number, x: number, z: number, level = 0): locScene.SceneLoc {
    for (const l of [level, level - 1, level + 1, 0, 1, 2, 3]) {
        if (l < 0 || l > 3) continue;
        try { return locAt(id, x, z, l); } catch { /* next */ }
    }
    throw new Error(`loc ${id} not at (${x},${z}) on any level`);
}
let NPC_IDS: Map<string, number> | null = null;
/** npc type id by debugname (content/pack/npc.pack). */
export function npcId(name: string): number {
    if (!NPC_IDS) {
        NPC_IDS = new Map();
        for (const line of readFileSync(resolve((import.meta as any).dir, '../../../../../../content/pack/npc.pack'), 'utf8').split(String.fromCharCode(10))) {
            const i = line.indexOf('='); if (i > 0) NPC_IDS.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
        }
    }
    const id = NPC_IDS.get(name);
    if (id === undefined) throw new Error(`npcId: unknown npc ${name}`);
    return id;
}
export function packStr(bot: SpeedBot): string { return bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', '); }
export { levelUpOpen, cheb };

// ---------------------------------------------------------------------------------------------------------
// launcher (run-<quest>.ts): --live <account> | --sim [name] | --supply
// ---------------------------------------------------------------------------------------------------------
export interface SimCfg {
    /** sim stats (also the proven stats; REQUIREMENTS.skills documents the why) */
    stats: Record<string, number>;
    /** prerequisite quest varps: [name, value] (setvar) */
    varps?: Array<[string, number]>;
    /** extra non-SUPPLY sim kit (e.g. a weapon) and what to wield */
    extra?: Item[];
    wield?: string[];
}
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
export async function launch(mod: QuestModule, cfg: SimCfg): Promise<never> {
    const tag = mod.QUEST.dir.replace(/^quest_/, '');
    const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ') || '(none)';
    if (process.argv.includes('--supply')) {
        console.log(`${mod.QUEST.name} (${mod.QUEST.qp} QP) SUPPLY: ${show(mod.SUPPLY)}`);
        console.log(`requirements: quests [${mod.REQUIREMENTS.quests.join(', ')}] qp ${mod.REQUIREMENTS.qp}; ` +
            Object.entries(mod.REQUIREMENTS.skills).map(([s, [l, why]]) => `${s} ${l} (${why})`).join('; '));
        console.log(`start ${JSON.stringify(mod.REQUIREMENTS.start)} end ${JSON.stringify(mod.REQUIREMENTS.end)}`);
        process.exit(0);
    }
    const live = arg('--live'), sim = process.argv.includes('--sim');
    if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `run-${tag} --live`;
    const name = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `ka${Date.now() % 1000000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(name);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    if (sim) {
        await localSetup(bot, { clear: true });                    // the tutorial kit (and anything else)
        for (const [v, n] of cfg.varps ?? []) { await bot.cheat(`setvar ${v} ${n}`); }
        await localSetup(bot, { stats: cfg.stats });
        await localSetup(bot, { items: [...(cfg.extra ?? []), ...mod.SUPPLY] });
        if (cfg.wield?.length) await wield(bot, cfg.wield);
        const s = mod.REQUIREMENTS.start;
        await localSetup(bot, { tele: { x: s.x, z: s.z, level: s.level } });
        await bot.tick(2);
    }
    const miss = mod.SUPPLY.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
    for (const [s, [l]] of Object.entries(mod.REQUIREMENTS.skills)) if (bot.stat(s).level < l) miss.push(`${s} ${bot.stat(s).level}/${l}`);
    if (miss.length) await fin(1, `[${tag}] missing: ${miss.join(', ')}`);
    console.log(`[${tag}] ${name}: start (${bot.pos().x},${bot.pos().z}) qp ${qp(bot)} pack: ${packStr(bot)}`);
    let r: RunResult;
    try { r = await mod.run(bot, { log: true }); } catch (e) { r = { ok: false, ticks: -1, msg: (e as Error).stack ?? String(e) }; }
    console.log(`[${tag}] pack: ${packStr(bot)}`);
    if (r.ok) await fin(0, `[${tag}] QUEST COMPLETE in ${r.ticks} ticks (${mod.QUEST.name}; ${r.msg})`);
    return fin(1, `[${tag}] FAILED after ${r.ticks} ticks: ${r.msg}`);
}

/** Wrap a quest body: holdDialogs, text log, timing, death/exception -> ok:false, completion by qp. */
export async function runQuest(bot: SpeedBot, q: QuestInfo, body: (st: ReturnType<typeof stepper>) => Promise<void>, logOn = true): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    installTextLog(bot);
    const st = stepper(bot, q.dir.replace(/^quest_/, ''), logOn);
    trace(bot, st.t0);   // QTRACE=1: per-tick position/modal log (q-lib)
    const qp0 = qp(bot);
    try {
        await body(st);
        // completion: qp rises by the quest's points (the scroll arrives in the same tick as the varp)
        await bot.until(() => qp(bot) >= qp0 + q.qp, 20);
        const ok = qp(bot) >= qp0 + q.qp;
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        return { ok, ticks: bot.tickCount - st.t0, msg: `qp ${qp0} -> ${qp(bot)}; steps ${JSON.stringify(st.steps)}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - st.t0, msg: `${(e as Error).message}; steps ${JSON.stringify(st.steps)}` };
    }
}

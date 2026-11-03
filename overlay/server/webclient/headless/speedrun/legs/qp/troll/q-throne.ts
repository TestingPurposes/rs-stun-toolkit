// q-throne.ts — Throne of Miscellania (1 QP). CHEAT-FREE. Content: server/content/scripts/quests/quest_misc/scripts/*.rs2
// (king_vargas, queen_sigrid, prince_brand, advisor_ghrim, derrik, princess_astrid, misc_door_guard, misc_quest),
// areas/area_miscellania/scripts/weed_herbs.rs2 (approval), quests/quest_viking/scripts/viking_sailor.rs2 (the boat).
// %misc_quest (varp 359) and misc_varbit_1/3 (361/363: approval bits 18-24, affection 25-31, courting flags) ARE transmitted
// (quest_misc.varp transmit=yes), so every step gates on the real quest state.
// Stages: sail -> vargas1 (10; approval reset to 32, king_vargas.rs2:50-60) -> court (Astrid, affection 40) -> sigrid1 (20) ->
// vargas2 (30) -> sigrid2 (40) -> brand (50, awful anthem) -> ghrim (60, good anthem) -> sigrid3 (70, treaty) -> vargas3 (80) ->
// derrik (iron bar -> giant nib; nib on a log -> giant pen) -> approval (weed the herbs to 96/127) -> finish (Vargas: 90, then the
// final check affection >= 40 & approval >= 96 completes in the same talk, king_vargas.rs2:100-168).
import { SpeedBot, objId, objDebugName, cheb, densify } from '../../../core.js';
import { npc, inDialog, dismiss, qp, locAt, opLocGo, navSync, type Tile } from '../../q-lib.js';
import { Ctx, QuestFail, go, walk, converse, dead, nav, packStr, obstacle, talkTo, useOnNpcGo, locAny, type Item } from './lib-troll.js';
import { wield, unwieldAll } from '../../run-lib.js';
import { isResuming, failHook } from '../journal.js';
import * as locScene from '../../../../loc-scene.js';

import { readFileSync } from 'fs';
import { resolve } from 'path';

let DOORS: Record<string, { state: string; op: number }> | null = null;
function doorDefs(): Record<string, { state: string; op: number }> {
    if (!DOORS) { try { DOORS = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../../../../../sdk/navgrid/door-states.json'), 'utf8')); } catch { DOORS = {}; } }
    return DOORS!;
}
const DEBUG = !!(globalThis as any).process?.env?.THRONE_DEBUG;
/** Finish/close whatever chat or main modal is up (a walk under an open chat box goes nowhere). */
async function closeAll(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (inDialog(bot) && !bot.dialogOptions().length) await converse(bot, () => !inDialog(bot) || bot.dialogOptions().length > 0, [], 10, 3);
    if (inDialog(bot) || bot.mainModalId !== -1) { bot.closeModal(); bot.chatModalId = -1; bot.mainModalId = -1; bot.queueFlush(); await bot.tick(1); }
}
const ZEVT = new Map<string, number>(), ZID = new Map<string, number>();
/** Zone loc events per tile (tick + id; id < 0 = LOC_DEL). Installed at the start of run(), so the chaos engines' initial door
 *  states (sent as zone changes when a zone comes into view) are seen too. */
function hookZone(bot: SpeedBot): void {
    if ((bot as any).__zHook) return; (bot as any).__zHook = true;
    const prev = (bot as any).onLocZoneChange as ((l: number, x: number, z: number, id: number) => void) | undefined;
    (bot as any).onLocZoneChange = (l: number, x: number, z: number, id: number) => { prev?.(l, x, z, id); const k = `${l},${x},${z}`; ZEVT.set(k, bot.tickCount); ZID.set(k, id); };
    // a level change makes the server re-send every zone from the static map + diffs (UPDATE_ZONE_FULL_FOLLOWS): forget the old
    // events then, or a door that shut while we were upstairs stays "open" here (chaos 6411: wedged at 2504,3860)
    let lv = bot.minusedlevel;
    void (async () => { while (!bot.disposed) { if (bot.minusedlevel !== lv) { lv = bot.minusedlevel; ZID.clear(); } await bot.tick(1); } })();
}
/** A static closed door is open now if its tile saw a LOC_DEL or a different loc since (the open leaf / an open variant); the
 *  door tracker did not know these doors (chaos 6411: the castle entrance was toggled shut and open for 400 t). */
function doorOpen(bot: SpeedBot, l: { id: number; x: number; z: number; level: number }): boolean {
    const t = (bot as any).doorTracker?.isOpen(l.level, l.x, l.z);
    const id = ZID.get(`${l.level},${l.x},${l.z}`);
    if (id !== undefined) return id < 0 || id !== l.id;
    return t === true;
}
/** Walk to `dest`; when the walk stalls, op the nearest CLOSED static door within 3 tiles (the live door tracker says closed or
 *  does not know it) and go on. The Miscellania castle doors (loc_1512) stalled the walker (sim tt1: 300 t at 2511,3860). */
async function goD(c: Ctx, dest: Tile, label: string, near = 1, maxTicks = 600): Promise<void> {
    const bot = c.bot, there = () => cheb(bot.tile(), dest) <= near;
    // a loc tile (stairs) is not walkable: walk to the path end next to it instead (the plain walk did not move at all, sim tt2)
    try {
        const me = bot.tile(), pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, dest.x, dest.z, 500), e = pts[pts.length - 1];
        if (e && cheb(e, dest) <= 1) dest = { x: e.x, z: e.z };
    } catch { /* keep dest */ }
    const end = bot.tickCount + maxTicks;
    await closeAll(c);
    let stalls = 0;
    // proactive: the closed doors ON the planned path (the static path treats door-table doors as open), opened in order as we
    // reach them; the walker does not open these (its tracker had no state for them: 40-t stalls per door, sim tt11)
    try {
        const me = bot.tile(), lv = bot.minusedlevel;
        const dense = densify([me, ...navSync().findLongPath(lv, me.x, me.z, dest.x, dest.z, 500)]);
        const tr = (bot as any).doorTracker, seen = new Set<string>(), doors: Array<{ i: number; l: locScene.SceneLoc }> = [];
        for (let i = 0; i < dense.length; i += 8) for (const l of locScene.findNearbyLocs(/door|gate/i, dense[i]!.x, dense[i]!.z, lv, 10)) {
            const k = `${l.x},${l.z}`; if (seen.has(k) || doorDefs()[String(l.id)]?.state !== 'closed') continue; seen.add(k);
            const j = dense.findIndex(t => t.x === l.x && t.z === l.z);
            if (j >= 0) doors.push({ i: j, l });
        }
        doors.sort((a, b) => a.i - b.i);
        for (const { i, l } of doors) {
            if (doorOpen(bot, l)) continue;
            // far doors: walk to ~6 tiles short, then let OPLOC's own route take us to the door (no stop-and-op, A/B in STATUS)
            const before = dense[Math.max(0, i - 6)]!;
            if (cheb(bot.tile(), l) > 8) await walk(bot, before, null, () => cheb(bot.tile(), l) <= 7, { near: 1, maxTicks: 120 });
            // one op, then wait for the zone event at the door tile (the tracker may not know the door: wait on the event, not on it)
            hookZone(bot);
            for (let k = 0; k < 2; k++) {
                const t0 = bot.tickCount;
                opLocGo(bot, l, doorDefs()[String(l.id)]!.op ?? 1);
                if (await bot.until(() => (ZEVT.get(`${l.level},${l.x},${l.z}`) ?? -1) >= t0, 4 + cheb(bot.tile(), l))) break;
            }
            if (c.verbose && DEBUG) c.log(`goD ${label}: door ${l.id} @ ${l.x},${l.z}`);
        }
    } catch (e) { c.log(`goD ${label}: door plan failed ${(e as Error).message}`); }
    while (!there() && bot.tickCount < end) {
        if (inDialog(bot) || bot.mainModalId !== -1) { await converse(bot, () => !inDialog(bot), [], 10, 3); if (bot.mainModalId !== -1) { bot.closeModal(); bot.mainModalId = -1; } dismiss(bot); await bot.tick(1); }
        await walk(bot, dest, null, there, { near, maxTicks: Math.min(stalls ? 15 : 40, end - bot.tickCount) });
        if (there()) break;
        const me = bot.tile(), tr = (bot as any).doorTracker;
        const d = locScene.findNearbyLocs(/door|gate/i, me.x, me.z, bot.minusedlevel, 3)
            .filter(l => doorDefs()[String(l.id)]?.state === 'closed' && (!doorOpen(bot, l) || (stalls >= 2 && cheb(l, me) <= 1)))
            .sort((a, b) => cheb(a, me) - cheb(b, me))[0];
        if (!d) {
            const near = [...ZID].filter(([k]) => { const [lv, x, z] = k.split(',').map(Number); return lv === bot.minusedlevel && cheb({ x: x!, z: z! }, me) <= 3; }).map(([k, id]) => `${k}=${id}`).join(' ');
            c.log(`goD ${label}: stalled at ${me.x},${me.z}, no closed door near; modal ${bot.mainModalId}/${bot.chatModalId}; zone ${near}`);
            // an open door LEAF the static map does not have (chaos: loc_1515 at 2511,3860, set by the engine's random door states,
            // not where a normal open puts it) blocks the planned step: CLOSE it (op the leaf), the closed door is then opened the
            // normal way by the next pass; else side-step and re-plan
            const leaf = [...ZID].map(([k, id]) => { const [lv, x, z] = k.split(',').map(Number); return { lv: lv!, x: x!, z: z!, id }; })
                .find(e => e.lv === bot.minusedlevel && e.id > 0 && doorDefs()[String(e.id)]?.state === 'open' && cheb(e, me) <= 2);
            if (leaf && stalls % 2 === 0) {
                stalls++;
                const pair = (doorDefs()[String(leaf.id)] as any)?.pair as number | undefined;
                const tmpl = locScene.findNearbyLocs(/./, leaf.x, leaf.z, leaf.lv, 2, { includeUnnamed: true }).find(l => l.id === pair);
                if (tmpl) opLocGo(bot, { ...tmpl, id: leaf.id, x: leaf.x, z: leaf.z, level: leaf.lv } as any, doorDefs()[String(leaf.id)]!.op ?? 1);
                await bot.until(() => ZID.get(`${leaf.lv},${leaf.x},${leaf.z}`) !== leaf.id, 5);
                c.log(`goD ${label}: closed a stray door leaf ${leaf.id} @ ${leaf.x},${leaf.z}`);
                continue;
            }
            const k = (stalls++ % 8), dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
            const side = { x: me.x + dirs[k]![0]! * 2, z: me.z + dirs[k]![1]! * 2 };
            await walk(bot, side, null, () => cheb(bot.tile(), side) <= 0, { near: 0, maxTicks: 5 });
            continue;
        }
        opLocGo(bot, d, doorDefs()[String(d.id)]!.op ?? 1);
        await bot.until(() => doorOpen(bot, d), 6);
        c.log(`goD ${label}: opened door ${d.id} @ ${d.x},${d.z}`);
    }
    if (!there()) c.fail(`walk ${label} -> (${dest.x},${dest.z})`);
}
function reachable1(bot: SpeedBot, t: Tile): boolean {
    try { const me = bot.tile(), pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, t.x, t.z, 100), e = pts[pts.length - 1]; return !!e && e.x === t.x && e.z === t.z; } catch { return false; }
}
/** Static locs of the given ids within r of a tile (loc-scene). */
function locsNear(ids: number[], at: Tile, r: number, level = 0): locScene.SceneLoc[] {
    const set = new Set(ids);
    return locScene.findNearbyLocs(/./, at.x, at.z, level, r, { includeUnnamed: true }).filter(l => set.has(l.id));
}

export const QUEST = { name: 'Throne of Miscellania', dir: 'quest_misc', qp: 1 };
export const REQUIREMENTS = {
    quests: ['The Fremennik Trials', "Hero's Quest"] as string[],
    qp: 0,
    skills: {
        herblore: [35, 'weeding the Miscellania herbs for approval (weed_herbs.rs2:16-19)'],
    } as Record<string, [number, string]>,
    start: { x: 2629, z: 3691, level: 0 },   // Rellekka pier, next to the sailor (viking_sailor 2629,3693)
    end: { x: 2501, z: 3861, level: 1 },     // King Vargas' throne room
};
// a MALE player courts Princess Astrid (princess_astrid.rs2:19-31); a female one Prince Brand (not built)
export const SUPPLY: Item[] = [
    // the blessed silver sickle the main earns in Nature Spirit (banked; NOT_STAGED in run-route.ts, so it comes from the bank, not
    // the staging list). weed_herbs.rs2:19 takes a WORN iron, silver or blessed sickle. THRONE_IRON_SICKLE=1 reverts to the iron one.
    { name: process.env.THRONE_IRON_SICKLE === '1' ? 'iron_sickle' : 'silver_sickle_blessed', n: 1 }, { name: 'flowers_waterfall_quest_mixed', n: 1 }, { name: 'shortbow', n: 1 }, { name: 'gold_ring', n: 1 },
    { name: 'iron_bar', n: 1 }, { name: 'logs', n: 1 },
];
export const STAGES = ['sail', 'vargas1', 'court', 'sigrid1', 'vargas2', 'sigrid2', 'brand', 'ghrim', 'sigrid3', 'vargas3', 'derrik', 'approval', 'finish'] as const;
export interface ThroneOpts { log?: boolean; from?: string; to?: string; weedOp?: number }

const N = { sailor: 1304, vargas: 1373, sigrid: 1359, brand: 1371, astrid: 1372, ghrim: 1375, guard: 1374, smithy: 1376 };
const VQ = 359, V1 = 361, V3 = 363;
const quest = (bot: SpeedBot) => bot.varps[VQ] ?? 0;
const approval = (bot: SpeedBot) => ((bot.varps[V1] ?? 0) >>> 18) & 127;
const affection = (bot: SpeedBot) => ((bot.varps[V1] ?? 0) >>> 25) & 127;
const bit3 = (bot: SpeedBot, b: number) => (((bot.varps[V3] ?? 0) >>> b) & 1) === 1;
const has = (bot: SpeedBot, name: string) => bot.count(name) > 0;
let WEED_OP = 1;

export async function run(bot: SpeedBot, o: ThroneOpts = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    const c = new Ctx(bot, 'throne', o);
    hookZone(bot);
    await nav();
    bot.holdDialogs = true;
    WEED_OP = o.weedOp ?? 1;
    const qp0 = qp(bot);
    try {
        const from = STAGES.indexOf((o.from ?? 'sail') as typeof STAGES[number]);
        if (from < 0) c.fail(`unknown stage ${o.from}`);
        // session 10: a retry / resume skips the stages %misc_quest (transmitted) shows done. THRONE_RESUME=0 reverts.
        const resume = isResuming(bot) && process.env.THRONE_RESUME !== '0';
        if (resume) c.log(`resume: quest ${quest(bot)} appr ${approval(bot)} aff ${affection(bot)} at ${JSON.stringify(bot.pos())} pack ${packStr(bot)}`);
        for (const st of STAGES.slice(from)) {
            if (dead(bot)) c.fail('died');
            if (resume && throneDone(bot, st)) { c.log(`resume: ${st} done already (quest ${quest(bot)})`); continue; }
            // Ghrim's step assumes the castle's L1 (Brand's step leaves us there)
            if (resume && st === 'ghrim' && bot.minusedlevel === 0) await castleL1(c, false);
            await STEP[st](c);
            c.mark(`${st} q${quest(bot)} appr ${approval(bot)} aff ${affection(bot)}`);
            failHook(st);
            if (st === o.to) return { ok: false, ticks: c.t, msg: `stopped after ${st} (probe)` };
        }
        // %misc_quest = 100 only (the qp varp can still be catching up with the launcher's prerequisite varps)
        if (!(await bot.until(() => quest(bot) >= 100, 20))) c.fail(`no completion (qp ${qp0} -> ${qp(bot)}, quest ${quest(bot)})`);
        return { ok: true, ticks: c.t, msg: `qp ${qp0} -> ${qp(bot)}; quest ${quest(bot)}` };
    } catch (e) {
        if (!(e instanceof QuestFail)) throw e;
        return { ok: false, ticks: c.t, msg: e.message };
    }
}

/** a stage the quest state shows done (a retry skips it) */
function throneDone(bot: SpeedBot, st: typeof STAGES[number]): boolean {
    const q = quest(bot), t = bot.tile();
    switch (st) {
        case 'sail': return q >= 10 || (t.z > 3800 && t.x >= 2490 && t.x <= 2640);   // on Miscellania / Etceteria
        case 'vargas1': return q >= 10;
        case 'court': return affection(bot) >= 40;
        case 'sigrid1': return q >= 20;
        case 'vargas2': return q >= 30;
        case 'sigrid2': return q >= 40;
        // %misc_quest turns 50 before the anthem lands (prince_brand.rs2:31-34): at 50 only with an anthem held
        case 'brand': return q >= 60 || (q >= 50 && (has(bot, 'misc_awful_anthem') || has(bot, 'misc_good_anthem')));
        case 'ghrim': return q >= 60;
        case 'sigrid3': return q >= 70;
        case 'vargas3': return q >= 80;
        case 'derrik': return q >= 90 || has(bot, 'misc_giant_pen');
        default: return false;
    }
}

// ---- places ----
const CASTLE_STAIRS_S = { id: 1742, x: 2505, z: 3848 }, CASTLE_STAIRS_N = { id: 1742, x: 2505, z: 3871 };
const ETC_STAIRS = { id: 1738, x: 2613, z: 3867 }, ETC_TOP = { id: 1740, x: 2614, z: 3867, level: 1 };
const AT: Record<string, Tile> = { vargas: { x: 2501, z: 3861 }, astrid: { x: 2501, z: 3868 }, brand: { x: 2502, z: 3853 }, ghrim: { x: 2500, z: 3858 },
    sigrid: { x: 2612, z: 3875 }, smithy: { x: 2551, z: 3895 }, weeds: { x: 2527, z: 3852 } };

/** Up into the Miscellania castle (L1) by the stairs nearest the target room. */
async function castleL1(c: Ctx, north: boolean): Promise<void> {
    const bot = c.bot;
    if (bot.minusedlevel === 1 && bot.tile().x < 2520 && bot.tile().z > 3840) return;
    if (bot.minusedlevel !== 0) c.fail(`castleL1 from level ${bot.minusedlevel}`);
    const st = north ? CASTLE_STAIRS_N : CASTLE_STAIRS_S;
    await goD(c, st, 'castle stairs', 1);
    await obstacle(c, st, null, () => bot.minusedlevel === 1, 'castle stairs up', 1, 60);
}
async function castleL0(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (bot.minusedlevel === 0) return;
    const north = bot.tile().z > 3860, s = north ? CASTLE_STAIRS_N : CASTLE_STAIRS_S;
    await exitThrone(c, north);
    await goD(c, s, 'castle stairs (L1)', 1, 200);
    await obstacle(c, { ...s, id: 1743, level: 1 }, null, () => bot.minusedlevel === 0, 'castle stairs down', 3, 60);
}
/** Into the throne room: the doors (L1 2506,3857 / 2506,3863) open once you have spoken to a guard or started the quest
 *  (misc_door_guard.rs2:1-8); otherwise the op starts the guard's talk (it grants the audience, :10-17). */
async function throneRoom(c: Ctx): Promise<void> {
    const bot = c.bot, inside = () => bot.minusedlevel === 1 && bot.tile().x <= 2506 && bot.tile().z >= 3857 && bot.tile().z <= 3863;
    if (inside()) return;
    const north = bot.tile().z > 3860;
    const door = north ? { id: 4672, x: 2506, z: 3863, level: 1 } : { id: 4672, x: 2506, z: 3857, level: 1 };
    // the L1 stairwell doors (loc_1512) stall the walker too: goD to the tile in front of the throne door
    await goD(c, north ? { x: 2506, z: 3864 } : { x: 2506, z: 3856 }, 'throne door', 1, 200);
    for (let k = 0; k < 4 && !inside(); k++) {
        if (inDialog(bot)) { await converse(bot, () => !inDialog(bot), [], 20, 3); continue; }
        // chaos engines may start the door OPEN (then the op on the closed id is dropped): just walk in when it is
        const dl = locAny(door.id, door.x, door.z, 1);
        if (doorOpen(bot, dl)) await walk(bot, AT.vargas!, null, inside, { near: 2, maxTicks: 10 });
        else { opLocGo(bot, dl, 1); await bot.until(() => inside() || inDialog(bot), 8); }
        if (!inside() && !inDialog(bot)) await walk(bot, AT.vargas!, null, inside, { near: 2, maxTicks: 6 });
        if (DEBUG) c.log(`throne door try ${k}: at ${JSON.stringify(bot.pos())} dialog ${inDialog(bot)} | ${[...bot.ifText.values()].slice(-1).join('').slice(0, 80)}`);
    }
    if (!inside()) c.fail('throne room door');
}
const inThroneRoom = (bot: SpeedBot) => bot.minusedlevel === 1 && bot.tile().x <= 2506 && bot.tile().z >= 3857 && bot.tile().z <= 3863;
/** Out of the throne room by the north or south door (from inside the door just opens and walks you through). */
async function exitThrone(c: Ctx, north: boolean): Promise<void> {
    const bot = c.bot;
    for (let k = 0; k < 6 && inThroneRoom(bot); k++) {
        const dl = locAny(4672, 2506, north ? 3863 : 3857, 1), out = { x: 2506, z: north ? 3864 : 3856 };
        if (doorOpen(bot, dl) || k % 2 === 1) await walk(bot, out, null, () => !inThroneRoom(bot), { near: 0, maxTicks: 8 });
        else { opLocGo(bot, dl, 1); await bot.until(() => !inThroneRoom(bot), 6); }
    }
    if (inThroneRoom(bot)) c.fail('could not leave the throne room');
}
async function toEtceteria(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (bot.minusedlevel === 1 && bot.tile().x > 2590) return;
    await castleL0(c);
    await goD(c, ETC_STAIRS, 'Etceteria stairs', 1);
    await obstacle(c, ETC_STAIRS, null, () => bot.minusedlevel === 1, 'Etceteria stairs up', 1, 60);
}
async function toMiscCastle(c: Ctx, north: boolean): Promise<void> {
    const bot = c.bot;
    if (bot.minusedlevel === 1 && bot.tile().x > 2590) {
        await goD(c, ETC_TOP, 'Etceteria stairs (L1)', 1, 200);
        await obstacle(c, ETC_TOP, null, () => bot.minusedlevel === 0, 'Etceteria stairs down', 1, 60);
    }
    await castleL1(c, north);
}
/** Talk until %misc_quest reaches `want` (answers by option text). */
async function questTalk(c: Ctx, type: number, stand: Tile, answers: RegExp[], want: number, label: string, extra: () => boolean = () => false): Promise<void> {
    const bot = c.bot;
    const n = npc(bot, type);
    // also when close but walled off (a closed room door between: Brand's 2504,3853 and Sigrid's 2609,3875, chaos 6411/6413)
    const walled = (t: Tile) => { try { const me = bot.tile(), pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, t.x, t.z, 100); const e = pts[pts.length - 1];
        const crossesDoor = densify([me, ...pts]).some(q => locScene.findNearbyLocs(/door/i, q.x, q.z, bot.minusedlevel, 0).some(l => doorDefs()[String(l.id)]?.state === 'closed' && !doorOpen(bot, l)));
        return !e || cheb(e, t) > 1 || crossesDoor; } catch { return true; } };
    if (!n || n.d > 3 || walled(n)) await goD(c, n && n.d <= 12 ? { x: n.x, z: n.z } : stand, label, 1, 300);
    const n2 = npc(bot, type);
    // standing ON the npc's tile (npcs do not block players) makes every OPNPC a no-op: step off first (sim tt16, Ghrim)
    if (n2 && cheb(n2, bot.tile()) === 0) {
        const off = [[1, 0], [0, 1], [0, -1], [-1, 0]].map(([dx, dz]) => ({ x: n2.x + dx!, z: n2.z + dz! })).find(t => reachable1(bot, t));
        if (off) await walk(bot, off, null, () => cheb(bot.tile(), off) === 0, { near: 0, maxTicks: 8 });
    }
    if (DEBUG) c.log(`${label}: npc ${n2 ? `${n2.x},${n2.z}` : '-'} me ${JSON.stringify(bot.pos())}`);
    const met = () => quest(c.bot) >= want || extra();
    // done as soon as the state is reached; then finish the talk, or close it when it ends in a menu with no way out (Ghrim
    // returns to his advice menu after the anthem, advisor_ghrim.rs2:36-47)
    const doneT = () => met() && (!inDialog(bot) || bot.dialogOptions().length > 0);
    try {
        try { await talkTo(c, type, stand, [], answers, doneT, label); }
        catch (e) {
            // walled off by a door the event log calls open (a chaos stray leaf, or stale): walk right up to the npc with the door
            // handling (it closes stray leaves / re-opens doors when the walk stalls), then talk again (chaos 6415, Brand)
            if (!(e instanceof QuestFail)) throw e;
            const m = npc(bot, type); if (!m) throw e;
            c.log(`${label}: talk failed, walking up to the npc first`);
            await goD(c, { x: m.x, z: m.z }, label, 1, 200);
            await talkTo(c, type, stand, [], answers, doneT, label);
        }
    }
    catch (e) { c.log(`${label}: modal ${bot.chatModalId} opts ${bot.dialogOptions().map(o => o.text).join('|')} text ${[...bot.ifText.values()].slice(-3).join(' / ').slice(0, 200)} q ${quest(bot)} pack ${packStr(bot)}`); throw e; }
    if (inDialog(bot)) {
        if (bot.dialogOptions().length) { bot.closeModal(); bot.chatModalId = -1; bot.queueFlush(); await bot.tick(1); }
        else await converse(bot, () => !inDialog(bot) || bot.dialogOptions().length > 0, [], 12, 3);
        if (inDialog(bot)) { bot.closeModal(); bot.chatModalId = -1; bot.queueFlush(); await bot.tick(1); }
    }
    c.log(`${label}: quest ${quest(bot)}`);
}

const STEP: Record<typeof STAGES[number], (c: Ctx) => Promise<void>> = {
    sail: async c => {
        const bot = c.bot;
        // Rellekka sailor: "Let's go!" (viking_sailor.rs2:14-25, needs %viking complete) -> the Miscellania pier
        await talkTo(c, N.sailor, { x: 2629, z: 3691 }, [], [/^Let's go!$/], () => bot.tile().z > 3800 && !inDialog(bot), 'sailor');
        // an arrival message box (chat modal 356) opens a tick or two after the landing and blocks walking (sim tt4)
        await bot.until(() => inDialog(bot), 8);
        await closeAll(c);
    },
    vargas1: async c => {
        const bot = c.bot;
        await closeAll(c);
        await wieldSickle(bot);   // worn for the weeding later (weed_herbs.rs2:20); it frees a pack slot too
        await castleL1(c, false);
        await throneRoom(c);
        await questTalk(c, N.vargas, AT.vargas!, [/^If I may be so bold/], 10, 'vargas-start');
    },
    court: async c => { await court(c); },
    sigrid1: async c => { await toEtceteria(c); await questTalk(c, N.sigrid, AT.sigrid!, [], 20, 'sigrid-1'); },
    vargas2: async c => { await toMiscCastle(c, false); await throneRoom(c); await questTalk(c, N.vargas, AT.vargas!, [], 30, 'vargas-2'); },
    sigrid2: async c => { await toEtceteria(c); await questTalk(c, N.sigrid, AT.sigrid!, [], 40, 'sigrid-2'); },
    brand: async c => {
        await toMiscCastle(c, false);
        // done = the anthem in the pack: %misc_quest turns 50 BEFORE the inv_add at the end of his talk (prince_brand.rs2:31-34);
        // leaving at "50" left without it once (Ghrim then has nothing to correct, sim tt13)
        await questTalk(c, N.brand, AT.brand!, [], 999, 'brand', () => has(c.bot, 'misc_awful_anthem'));
    },
    ghrim: async c => { await throneRoom(c); await questTalk(c, N.ghrim, AT.ghrim!, [], 60, 'ghrim', () => has(c.bot, 'misc_good_anthem'));   /* the swap is QUEUED: runs once the talk is closed */ if (!(await c.bot.until(() => has(c.bot, 'misc_good_anthem'), 6))) c.fail('no corrected anthem'); },
    sigrid3: async c => { await toEtceteria(c); await questTalk(c, N.sigrid, AT.sigrid!, [], 70, 'sigrid-3', () => has(c.bot, 'misc_treaty')); if (!(await c.bot.until(() => has(c.bot, 'misc_treaty'), 6))) c.fail('no treaty'); },
    vargas3: async c => { await toMiscCastle(c, false); await throneRoom(c); await questTalk(c, N.vargas, AT.vargas!, [], 80, 'vargas-3'); },
    derrik: async c => {
        const bot = c.bot;
        await castleL0(c);
        // Derrik (2551,3897): "I have a slightly strange request..." + an iron bar -> giant nib (derrik.rs2:9-30)
        await goD(c, AT.smithy!, 'Derrik', 2, 300);   // his house door viking_abode_door 4247 (2551,3893)
        const nibT = () => has(bot, 'misc_giant_nib') && !inDialog(bot);
        try { await talkTo(c, N.smithy, AT.smithy!, [], [/slightly strange request/], nibT, 'derrik'); }
        catch (e) {
            // fix 324 (qx86m): stood on his open door leaf 4248 (2551,3894); the route's fix 154 toggled it at 20/40 t and the talk
            // ran out of tries ('derrik: dialog'; the retry from the same tile then worked). Same fallback as questTalk: walk
            // right up to him with the door handling, talk again. TH_DERRIK_RETRY=0 reverts.
            if (!(e instanceof QuestFail) || process.env.TH_DERRIK_RETRY === '0') throw e;
            const m = npc(bot, N.smithy); if (!m) throw e;
            c.log(`derrik: talk failed at ${bot.tile().x},${bot.tile().z}, walking up to him first`);
            await goD(c, { x: m.x, z: m.z }, 'Derrik', 1, 200);
            await talkTo(c, N.smithy, AT.smithy!, [], [/slightly strange request/], nibT, 'derrik');
        }
        // the nib on a log -> giant pen (misc_quest.rs2:8-17)
        for (let k = 0; k < 4 && !has(bot, 'misc_giant_pen'); k++) {
            const [a, b] = k % 2 ? ['logs', 'misc_giant_nib'] : ['misc_giant_nib', 'logs'];
            bot.useItemOnItem(objId(a), bot.slot(a), objId(b), bot.slot(b)); bot.queueFlush();
            await bot.until(() => has(bot, 'misc_giant_pen'), 3);
        }
        if (!has(bot, 'misc_giant_pen')) c.fail(`giant pen (pack ${packStr(bot)})`);
    },
    approval: async c => { await weed(c, 96); },
    finish: async c => {
        const bot = c.bot;
        // the blessed sickle back into the pack: Myreque (two quests on) refills the druid pouch with it from the PACK
        // (mo-lib has() = pack count), and a worn one is not deposited/withdrawn as the kit item
        if (bot.isWorn(objId('silver_sickle_blessed')) && bot.free() > 0) await unwieldAll(bot, /^silver_sickle_blessed$/);
        await castleL1(c, false);
        await throneRoom(c);
        // the pen -> 90, then "has she agreed?" + "are the people happy?" -> the coronation queues misc_quest_complete
        await questTalk(c, N.vargas, AT.vargas!, [], 100, 'vargas-finish');
    },
};

// ---- courting Princess Astrid (princess_astrid.rs2): 3 stages; each talk asks ONE question (options shuffled, multi4miscrand);
// stage 1 also wants flowers + the Dance emote, stage 2 a bow, stage 3 the Blow Kiss emote and then a ring (affection -> 40).
// per stage: "Hahahaha!" is RIGHT in stage 1 (target practice) and WRONG in stage 2 (the history question), sim tt7
const RIGHT: Record<number, RegExp[]> = {
    0: [/^Yes$/],
    1: [/^Archery is a noble art!$/, /^Hahahaha!$/, /^He's been very helpful\.$/],
    2: [/^I'm quite fond of it myself\.$/, /^That sounds like a good idea\.$/, /^What happened next\?$/],
    3: [/^And what a great bard he makes!$/, /^I suppose you don't have much opportunity to\.$/, /^It's a lovely little country\.$/],
};
const EMOTE_DANCE = 166, EMOTE_BLOWKISS = 11100;   // controls:com_18 / controls:com_45 (player_controls.rs2:58,90)
const inAstridZone = (bot: SpeedBot) => { const t = bot.tile(); return bot.minusedlevel === 1 && ((t.x >= 2498 && t.x <= 2502 && t.z >= 3866 && t.z <= 3871) || (t.x >= 2503 && t.x <= 2504 && t.z >= 3866 && t.z <= 3869)); };
async function court(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (affection(bot) >= 40) return;
    // out of the throne room by the north door to her room (misc_quest.rs2:28-32 zone)
    // out of the throne room by its north door (from inside it just opens, misc_door_guard.rs2:1-5), then through her room's
    // door (loc_1512 L1 2504,3867) into the emote zone
    await exitThrone(c, true);
    await goD(c, AT.astrid!, 'Astrid', 1, 200);
    for (let k = 0; k < 30 && affection(bot) < 40; k++) {
        const a = affection(bot), stage = Math.floor(a / 10), sig = `${bot.varps[V1]}|${bot.varps[V3]}`;
        const changed = () => `${bot.varps[V1]}|${bot.varps[V3]}` !== sig;
        const allD = (s: number) => [0, 1, 2].every(i => bit3(bot, 16 + (s - 1) * 3 + i));
        const ast = () => npc(bot, N.astrid);
        if (stage === 1 && allD(1) && !bit3(bot, 25)) await giveAstrid(c, 'flowers_waterfall_quest_mixed', changed);
        else if (stage === 1 && allD(1) && !bit3(bot, 27)) await emote(c, EMOTE_DANCE, changed);
        else if (stage === 2 && allD(2) && !bit3(bot, 26)) await giveAstrid(c, 'shortbow', changed);
        else if (stage === 3 && allD(3) && !bit3(bot, 28)) await emote(c, EMOTE_BLOWKISS, changed);
        else if (stage === 3 && allD(3)) await giveAstrid(c, 'gold_ring', changed);
        else {
            if (!ast()) c.fail('Astrid not visible');
            await talkTo(c, N.astrid, AT.astrid!, [], RIGHT[stage] ?? [], () => changed() && !inDialog(bot), `astrid a${a}`);
        }
        c.log(`courting: affection ${a} -> ${affection(bot)}`);
    }
    if (affection(bot) < 40) c.fail(`courting stuck at affection ${affection(bot)}`);
}
async function giveAstrid(c: Ctx, item: string, done: () => boolean): Promise<void> {
    const bot = c.bot;
    for (let k = 0; k < 4 && !done(); k++) {
        const n = npc(bot, N.astrid); if (!n) c.fail('Astrid not visible');
        if (inDialog(bot)) { await converse(bot, () => done() || !inDialog(bot), [/^Yes$/], 10, 3); continue; }
        useOnNpcGo(bot, n!, item);
        await bot.until(() => inDialog(bot) || done(), 8);
        await converse(bot, () => done() && !inDialog(bot), [/^Yes$/], 15, 3);
    }
    if (!done()) c.fail(`Astrid refused ${item}`);
}
async function emote(c: Ctx, com: number, done: () => boolean): Promise<void> {
    const bot = c.bot;
    if (!inAstridZone(bot)) await walk(bot, AT.astrid!, null, () => inAstridZone(bot), { near: 1, maxTicks: 30 });
    for (let k = 0; k < 4 && !done(); k++) {
        if (inDialog(bot)) dismiss(bot);
        bot.ifButton(com); bot.queueFlush();
        await bot.until(done, 4);
    }
    if (!done()) c.fail(`emote ${com} not counted (zone ${inAstridZone(bot)})`);
    if (inDialog(bot)) await converse(bot, () => !inDialog(bot), [], 6, 3);
}

// the sickle to wear for the weeding: the blessed silver one if held (Nature Spirit's reward, the kit item), else an iron one
const SICKLES = ['silver_sickle_blessed', 'iron_sickle'];
async function wieldSickle(bot: SpeedBot): Promise<void> {
    if (SICKLES.some(n => bot.isWorn(objId(n)))) return;
    const n = SICKLES.find(s => bot.count(s) > 0);
    if (n) await wield(bot, [n]);
}
// ---- approval: weed the Miscellania herbs (weed_herbs.rs2): +1 per weeded patch, the patch then rests 50 ticks (loc_change).
// op1 = first swing (roll after 5 ticks), op3 = "continue" (roll after 3 ticks, :60-100).
const HEATHER = [4677, 4678, 4679];
async function weed(c: Ctx, target: number): Promise<void> {
    const bot = c.bot;
    if (approval(bot) >= target) return;
    await castleL0(c);
    await wieldSickle(bot);
    await goD(c, AT.weeds!, 'herb patches', 2, 400);
    const rest = new Map<string, number>();
    const end = bot.tickCount + 2000;
    while (approval(bot) < target && bot.tickCount < end) {
        const me = bot.tile();
        const cands = locsNear(HEATHER, me, 6).filter(l => bot.locAlive(l) && bot.tickCount >= (rest.get(`${l.x},${l.z}`) ?? 0))
            .sort((a, b) => cheb(a, me) - cheb(b, me));
        const l = cands[0];
        if (DEBUG && bot.tickCount % 20 === 0) c.log(`weed: ${cands.length} patches near, approval ${approval(bot)}, msgs ${[...bot.ifText.values()].slice(-1).join('').slice(0, 80)}`);
        if (!l) { await bot.tick(1); continue; }
        const a0 = approval(bot), t0 = bot.tickCount;
        opLocGo(bot, l, WEED_OP);
        const ok = await bot.until(() => approval(bot) > a0 || !bot.locAlive(l), 14);
        if (!ok) rest.set(`${l.x},${l.z}`, bot.tickCount + 6);   // no roll seen: try another patch
        if (inDialog(bot)) { c.log(`weed dialog: ${[...bot.ifText.values()].slice(-2).join(' | ').slice(0, 120)}`); dismiss(bot); }
        if (approval(bot) > a0) rest.set(`${l.x},${l.z}`, bot.tickCount + 50);
        if (c.verbose && approval(bot) % 8 === 0 && approval(bot) > a0) c.log(`approval ${approval(bot)} (${bot.tickCount - t0} t this patch)`);
    }
    if (approval(bot) < target) c.fail(`approval ${approval(bot)} < ${target}`);
}
export { objDebugName, locAt };

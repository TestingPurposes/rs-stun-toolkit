// q-sheep-herder.ts — Sheep Herder (quest_sheepherder), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/quests/quest_sheepherder/): scripts/npcs/{councillor_halgrive,doctor_orbon,
// diseased_sheep}.rs2, scripts/locs/{sheepherder_gate,sheepherder_furnace}.rs2, configs/sheepherder_area.dbrow.
// Stage %sheepherderquest (0/1/2, complete 3: general/configs/quest.constant:54), sheep bits %sheepherdervar; none
// transmitted.
// Flow (file:line):
//   Halgrive (2617,3299) "What's wrong?" / "I can do that for you." -> poisoned feed (never used up)   councillor_halgrive.rs2:10-46
//   Dr Orbon (2614,3306) "Ok, I'll take it." (100 gp) -> plague jacket + trousers, WORN                doctor_orbon.rs2:36-57
//   pen gate (2594,3361-3362): from x 2594 it puts us inside (x 2595) when the suit is worn (sheepherder_gate.rs2)
//   cattle prod: ground spawn in the pen (2604,3357), WIELDED (right hand must be the prod: diseased_sheep.rs2:41-53)
//   HERDING (diseased_sheep.rs2:24-101): op1 Prod moves the sheep ONE tile away from us along the dominant axis
//     (coord_direction, general/scripts/misc/coord_procs.rs2:91-123); a sheep standing on the gate patch (2592-2594,
//     3360-3363, sheepherder_area.dbrow) when prodded jumps into the pen (a new copy on its in-pen tile, 150 t).
//     The patch can only be entered from the north. The 4 sheep types are GLOBAL map npcs (3 copies each).
//   feed (opnpcu poisoned_feed) a sheep in the pen -> its bones drop (private) -> take them    diseased_sheep.rs2:139-174
//   bones on the incinerator (2605,3360, 3x3, approached from the WEST: angle 2 rotates forceapproach=east)                                   sheepherder_furnace.rs2
//   Halgrive once all four are burned                                                          councillor_halgrive.rs2:61-66
//   Reward: 3100 coins (quest_sheepherder.rs2:5-9).
import { SpeedBot, cheb, objId, densify } from '../../../core.js';
import { qp, inDialog, dismiss, nav, trace, npcsOf, navSync, turning, type Tile } from '../../q-lib.js';
import { isFlagged } from '../../../../../../../sdk/pathfinding';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, opLocUntil, useOnLocUntil, pickup, wear, textWatch, deathWatch, walkLive, walkShort, allText, StepError } from './ar-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Sheep Herder', dir: 'quest_sheepherder', qp: 4 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // no skill checks, no combat
    start: { x: 2616, z: 3301, level: 0 },              // next to Councillor Halgrive, East Ardougne
    end: { x: 2616, z: 3301, level: 0 },
};
export const SUPPLY: Item[] = [{ name: 'coins', n: 100 }];

const HALGRIVE = 289, ORBON = 290, HALGRIVE_AT = { x: 2617, z: 3299 }, ORBON_AT = { x: 2614, z: 3306 };
const SHEEP: Array<{ type: number; bones: string; spawn: Tile }> = [
    { type: 293, bones: 'sheepbonesb', spawn: { x: 2622, z: 3366 } },   // closest first (research: S2, S1, S4, S3)
    { type: 292, bones: 'sheepbonesa', spawn: { x: 2610, z: 3344 } },
    { type: 295, bones: 'sheepbonesd', spawn: { x: 2611, z: 3390 } },
    { type: 294, bones: 'sheepbonesc', spawn: { x: 2561, z: 3389 } },
];
const GATE = { id: 167, x: 2594, z: 3361 }, GATE_OUT = { x: 2594, z: 3361 }, GATE_IN = { x: 2595, z: 3361 };
// furnace: 3x3, angle 2, forceapproach=east (quest_sheepherder.loc:1-7) -> rotated: approach from the WEST
const PROD_AT = { x: 2604, z: 3357 }, FURNACE = { id: 165, x: 2605, z: 3360 }, FURNACE_STAND = { x: 2604, z: 3361 };
const inPatch = (t: Tile) => t.x >= 2592 && t.x <= 2594 && t.z >= 3360 && t.z <= 3363;
const inPen = (t: Tile) => t.x >= 2595 && t.x <= 2609 && t.z >= 3351 && t.z <= 3364;

// collision masks (rsmod CollisionFlag): entering a tile from the west needs !BLOCK_WEST on it, etc.
const WALK_BLOCKED = 2359552, BLOCK_WEST = 2359560, BLOCK_EAST = 2359680, BLOCK_SOUTH = 2359554, BLOCK_NORTH = 2359584;
const DIRS: Array<{ dx: number; dz: number; enter: number }> = [
    { dx: 1, dz: 0, enter: BLOCK_WEST }, { dx: -1, dz: 0, enter: BLOCK_EAST }, { dx: 0, dz: 1, enter: BLOCK_SOUTH }, { dx: 0, dz: -1, enter: BLOCK_NORTH },
];
const step = (a: Tile, d: { dx: number; dz: number; enter: number }) => !isFlagged(a.x + d.dx, a.z + d.dz, 0, d.enter);

/** Herding field: cost to push a sheep from each tile onto the gate patch (Dijkstra over (tile, last push dir); a push
 *  from S to N=S+d needs the step S->N legal for the sheep and the push tile P=S-d standing for us with P->S legal;
 *  changing direction costs 2 extra (we walk round). Box x 2550-2635, z 3330-3405 (all four spawns). */
type Field = Map<string, { cost: number; dir: number }>;
function buildField(): Field {
    const X0 = 2550, X1 = 2635, Z0 = 3330, Z1 = 3405;
    const key = (x: number, z: number) => `${x},${z}`;
    const best = new Map<string, number>();   // `${x},${z},${dirOut}` -> cost (dirOut = the push applied AT this tile)
    const field: Field = new Map();
    // frontier entries: tile T reached (sheep on T) with next push direction `nd` (-1 = on the patch)
    const pq: Array<{ c: number; x: number; z: number; nd: number }> = [];
    for (let x = 2592; x <= 2594; x++) for (let z = 3360; z <= 3363; z++) { pq.push({ c: 0, x, z, nd: -1 }); field.set(key(x, z), { cost: 0, dir: -1 }); }
    while (pq.length) {
        let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i]!.c < pq[bi]!.c) bi = i;
        const cur = pq.splice(bi, 1)[0]!;
        // predecessor S = N - d for each push dir d
        for (let di = 0; di < 4; di++) {
            const d = DIRS[di]!;
            const S = { x: cur.x - d.dx, z: cur.z - d.dz }, P = { x: S.x - d.dx, z: S.z - d.dz };
            if (S.x < X0 || S.x > X1 || S.z < Z0 || S.z > Z1) continue;
            if (isFlagged(S.x, S.z, 0, WALK_BLOCKED) || isFlagged(P.x, P.z, 0, WALK_BLOCKED)) continue;
            if (!step(S, d) || !step(P, d)) continue;   // sheep S->N, us P->S (both in direction d)
            const c = cur.c + 1 + (cur.nd >= 0 && cur.nd !== di ? 2 : 0);
            const k = `${S.x},${S.z},${di}`;
            if ((best.get(k) ?? Infinity) <= c) continue;
            best.set(k, c);
            const f = field.get(key(S.x, S.z));
            if (!f || c < f.cost) field.set(key(S.x, S.z), { cost: c, dir: di });
            pq.push({ c, x: S.x, z: S.z, nd: di });
        }
    }
    return field;
}

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }> {
    await nav();
    const c = ctx(bot, o.log ?? true);
    trace(bot, c.t0);
    const qp0 = qp(bot);
    bot.holdDialogs = true;
    const dw = deathWatch(c);
    try {
        await body(c, dw.dead);
        return { ok: true, ticks: bot.tickCount - c.t0, msg: `quest points ${qp0} -> ${qp(bot)}`, marks: c.marks };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - c.t0, msg: (e as Error).message, marks: c.marks };
    } finally { dw.stop(); bot.holdDialogs = false; }
}

async function body(c: Ctx, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(`sheepherder:${label}`); };
    // session 10: on a retry, the journal (quest_sheepherder/scripts/sheepherder_journal.rs2) shows each sheep: incinerated
    // (struck), killed (bones held), herded (in the pen), or not yet (SH_RESUME=0 = always from the top)
    type SheepSt = 'none' | 'herded' | 'killed' | 'burned';
    let js: { stage: number; sheep: Record<string, SheepSt> } | null = null;
    if (isResuming(bot) && process.env.SH_RESUME !== '0') {
        dismiss(bot);
        const j = await readJournal(bot, 'sheepherder');
        if (j.ok && /QUEST COMPLETE/i.test(j.text)) { console.log('[sheepherder] [journal] QUEST COMPLETE'); return; }
        if (j.ok && /He gave me some poisoned sheep feed/i.test(j.text)) {
            const all = /return to\s+Councillor Halgrive\s+to collect/i.test(j.text);
            const sheep: Record<string, SheepSt> = {};
            ['first', 'second', 'third', 'fourth'].forEach((n, i) => {
                const bones = `sheepbones${'abcd'[i]}`;
                sheep[bones] = all || new RegExp(`killed the ${n} sheep and incinerated`, 'i').test(j.text) ? 'burned'
                    : bot.count(bones) > 0 ? 'killed' : new RegExp(`herded the ${n} sheep to the pen`, 'i').test(j.text) ? 'herded' : 'none';
            });
            js = { stage: /protective clothing from\s+Dr Orbon\s+who is in/i.test(j.text) ? 1 : 2, sheep };
        }
        console.log(`[sheepherder] [journal] sheepherder: ${j.ok ? `${JSON.stringify(js)} | open '${j.open.slice(0, 160)}'` : 'UNREADABLE'} (${j.ticks} t) @${JSON.stringify(bot.pos())}`);
    }
    const R = !!js;
    const suitOn = () => ['plague_jacket', 'plague_trousers'].every(n => bot.isWorn(objId(n)));
    const suitHeld = () => ['plague_jacket', 'plague_trousers'].every(n => bot.isWorn(objId(n)) || bot.count(n) > 0);
    if ((!R || !suitHeld()) && bot.count('coins') < 100) fail(c, 'need 100 coins for the plague suit');
    const field = buildField();
    const fieldAt = (t: Tile) => field.get(`${t.x},${t.z}`);

    // 1. Halgrive, Orbon, suit on
    if (!R) {
    need(await talkTo(c, HALGRIVE, HALGRIVE_AT, [/^What's wrong\?$/, /^I can do that for you\.$/], () => bot.count('poisoned_feed') > 0, { label: 'halgrive-start' }), 'halgrive-start');
    dismiss(bot);
    }
    if (!R || !suitHeld()) {
    need(await talkTo(c, ORBON, ORBON_AT, [/^Ok, I'll take it\.$/], () => bot.count('plague_jacket') > 0 && bot.count('plague_trousers') > 0, { label: 'orbon-suit' }), 'orbon-suit');
    dismiss(bot);
    }
    if (!R || !suitOn()) need(await wear(bot, ['plague_jacket', 'plague_trousers']), 'wear-suit');
    // 2. into the pen, cattle prod, wield
    const enterPen = async (label: string) => {
        if (inPen(bot.tile())) return;
        need(await opLocUntil(c, GATE, 1, () => inPen(bot.tile()), { label, stand: GATE_OUT, answers: [/.*/] }), label);
    };
    const leavePen = async (label: string) => {
        if (!inPen(bot.tile())) return;
        need(await opLocUntil(c, GATE, 1, () => !inPen(bot.tile()), { label, stand: GATE_IN }), label);
    };
    if (!R || !bot.isWorn(objId('cattleprod'))) {
    await enterPen('pen-in');
    if (!bot.count('cattleprod') && !bot.isWorn(objId('cattleprod'))) need(await pickup(c, 'cattleprod', PROD_AT), 'prod');
    need(await wear(bot, ['cattleprod']), 'wield-prod');
    await leavePen('pen-out');
    }
    // 3. the four sheep: herd, kill, take the bones (burn all four at the end: the furnace is in the pen's far corner)
    // (resume: a burned sheep or one whose bones we hold is skipped; a herded one is only killed)
    const todo = SHEEP.filter(sh => !js || js.sheep[sh.bones] === 'none' || js.sheep[sh.bones] === 'herded');
    for (const sh of todo) {
        // session 11 fix 396a (qx350: an engine restart right after the 294 kill lost the bones; the journal then reads the sheep as
        // 'herded' (bits 2, no bones: sheepherder_journal.rs2:69-72), so each retry looked 6 t for a 294 in the pen: kill-294 at +59 t x2,
        // ROUTE STOPPED. A pen sheep is gone after the kill (npc_del) and 150 t after the jump (npc_add ..., 150, diseased_sheep.rs2:95):
        // none in the pen = herd a fresh copy (the feed works while bits != 6 and no bones are held). SH_396A=0 = old
        let reherd = !js || js.sheep[sh.bones] !== 'herded';
        if (!reherd && process.env.SH_396A !== '0') {
            await enterPen(`pen-in-${sh.type}`);
            if (!(await bot.until(() => npcsOf(bot, sh.type).some(q => inPen(q)), 8))) { console.log(`[ar] 396a: journal says ${sh.bones} herded but no ${sh.type} is in the pen; herding a fresh copy`); reherd = true; }
        }
        if (reherd) { await leavePen(`pen-out-pre-${sh.type}`); need(await herd(c, sh.type, sh.spawn, field, fieldAt, dead), `herd-${sh.type}`); }
        await enterPen(`pen-in-${sh.type}`);
        // the kill mesbox has the same text every time (textWatch sees no change), and CLOSING it kills the script before
        // npc_del + the bones drop (diseased_sheep.rs2:155-164): watch for the box to open, then CONTINUE it
        let at: Tile | null = null, fed = false;
        for (let k = 0; k < 6 && !fed; k++) {
            if (inDialog(bot)) { await finishDialog(bot, [/.*/], 6); }
            const s = npcsOf(bot, sh.type).find(q => inPen(q));
            if (!s) { await bot.tick(1); continue; }
            at = { x: s.x, z: s.z };
            if (cheb(bot.tile(), s) > 1) await walkShort(bot, { x: s.x + 1, z: s.z });
            bot.chatModalId = -1;
            bot.useItemOnNpc(s.idx, objId('poisoned_feed'), bot.slot('poisoned_feed')); bot.queueFlush();
            fed = await bot.until(() => bot.chatModalId !== -1 && /collapses dead/i.test(allText(bot)), 6);
        }
        need(fed, `kill-${sh.type}`);
        await finishDialog(bot, [/.*/], 6);
        await bot.until(() => !npcsOf(bot, sh.type).some(q => inPen(q)), 6);   // p_delay(0)+p_delay(2), npc_del, obj_add
        need(!!at && await pickup(c, sh.bones, at), `bones-${sh.type}`);
        if (sh !== todo[todo.length - 1]) await leavePen(`pen-out-${sh.type}`);
    }
    // 4. burn the bones
    if (R && SHEEP.some(sh => bot.count(sh.bones) > 0)) await enterPen('pen-in-burn');
    for (const sh of SHEEP) {
        const n0 = bot.count(sh.bones);
        if (!n0) continue;
        need(await useOnLocUntil(c, sh.bones, FURNACE, () => bot.count(sh.bones) < n0, { label: `burn-${sh.bones}`, stand: FURNACE_STAND }), `burn-${sh.bones}`);
        await bot.tick(3);   // p_delay(3) before the bit is set (sheepherder_furnace.rs2)
    }
    // 5. Halgrive (completion observable: +3100 coins)
    await leavePen('pen-out-final');
    const coins0 = bot.count('coins');
    need(await talkTo(c, HALGRIVE, HALGRIVE_AT, [/.*/], () => bot.count('coins') >= coins0 + 3100, { label: 'halgrive-complete' }), 'halgrive-complete');
    dismiss(bot);
}

/** Push one sheep (the nearest copy of `type`) onto the gate patch and then into the pen. */
async function herd(c: Ctx, type: number, spawn: Tile, field: Field, fieldAt: (t: Tile) => { cost: number; dir: number } | undefined, dead: () => boolean): Promise<boolean> {
    const bot = c.bot, t0 = bot.tickCount;
    let idx = -1, pushes = 0, stuck = 0, bestCost = Infinity, lastImprove = bot.tickCount;
    const avoid = new Set<number>();
    const blockedPush = new Set<string>();
    let test381 = false;   // session 11 fix 381a TEST: once per herd() call (a re-fire after an avoid.clear() would spin without a tick)
    const find = () => {
        const all = npcsOf(bot, type);
        return all.find(q => q.idx === idx) ?? all.filter(q => !inPen(q) && !avoid.has(q.idx)).sort((a, b) => (fieldAt(a)?.cost ?? 999) - (fieldAt(b)?.cost ?? 999))[0] ?? null;
    };
    while (bot.tickCount - t0 < 700) {
        if (dead()) fail(c, `herd ${type} (DIED)`);
        if (inDialog(bot)) { await finishDialog(bot, [/.*/], 4); continue; }
        let s = find();
        // session 11 fix 381a TEST: SH_381A_TEST=1 treats the first copy picked per type as dead (exercises walk-to-spawn + switching)
        if (s && process.env.SH_381A_TEST === '1' && !test381 && !avoid.size && pushes === 0) { test381 = true; avoid.add(s.idx); console.log(`[ar] 381a TEST: avoiding copy ${s.idx} at ${s.x},${s.z}`); continue; }
        // session 11 fix 381a (qx282: the only visible copy was trapped at 2589,3374 (cost 999); clearing `avoid` re-picked it
        // 5x for 700 t; the other two copies were ~28 t away near the spawn): look near the spawn before re-trying avoided copies. SH_381A=0 = old
        if (!s) { if (avoid.size && npcsOf(bot, type).length && (process.env.SH_381A === '0' || cheb(bot.tile(), spawn) <= 8)) { avoid.clear(); continue; } await walkLive(bot, spawn, { near: 6, maxTicks: 200, done: () => !!find() }); continue; }
        if (idx !== s.idx) { idx = s.idx; bestCost = Infinity; lastImprove = bot.tickCount; }
        // no progress for 80 t (a push loop the field did not foresee, CH arsh7 at 2609,3365): forget the failed pushes and
        // switch to another copy of this sheep type (3 copies, global npcs)
        const fc = inPatch(s) ? 0 : (fieldAt(s)?.cost ?? 999);
        if (fc < bestCost) { bestCost = fc; lastImprove = bot.tickCount; }
        else if (bot.tickCount - lastImprove > 80) {
            console.log(`[ar] herd ${type}: no progress for 80 t with the copy at ${s.x},${s.z} (cost ${fc}); switching copy`);
            avoid.add(s.idx); blockedPush.clear(); idx = -1; bestCost = Infinity; lastImprove = bot.tickCount;
            continue;
        }
        if (npcsOf(bot, type).some(q => inPen(q))) { mark(c, `herded-${type} (${pushes} prods)`); return true; }
        const S = { x: s.x, z: s.z };
        let di: number;
        if (inPatch(S)) di = 3;   // any prod jumps it in; push south (stand north of it)
        else {
            // best push: the field's choice unless it failed here 3 times; else the legal push whose target tile is cheapest
            const f = fieldAt(S);
            if (f && f.dir >= 0 && !blockedPush.has(`${S.x},${S.z},${f.dir}`)) di = f.dir;
            else {
                let bc = Infinity; di = -1;
                for (let k = 0; k < 4; k++) {
                    const dd = DIRS[k]!, N = { x: S.x + dd.dx, z: S.z + dd.dz }, PP = { x: S.x - dd.dx, z: S.z - dd.dz };
                    if (blockedPush.has(`${S.x},${S.z},${k}`) || !step(S, dd) || isFlagged(PP.x, PP.z, 0, WALK_BLOCKED)) continue;
                    const cN = inPatch(N) ? 0 : (fieldAt(N)?.cost ?? 999);
                    if (cN < bc) { bc = cN; di = k; }
                }
                // session 11 fix 381a (a copy with no field entry and no legal push is dead: give it up now, not after 80 t;
                // the tick keeps a dead copy re-picked near the spawn (avoid.clear) from spinning without one)
                if (di < 0) { if (!f && process.env.SH_381A !== '0') { console.log(`[ar] herd ${type}: copy at ${S.x},${S.z} has no legal push (dead tile); switching copy`); avoid.add(s.idx); blockedPush.clear(); idx = -1; bestCost = Infinity; lastImprove = bot.tickCount; await bot.tick(1); continue; } await bot.tick(1); continue; }
            }
        }
        const d = DIRS[di]!;
        const P = { x: S.x - d.dx, z: S.z - d.dz };
        const me = bot.tile();
        if (me.x !== P.x || me.z !== P.z) {
            // one step away: walk + prod in the same tick (the op fires on arrival, the only tile next to the sheep on the
            // way); else walk there first so the prod does not fire from a wrong side on the way
            let pts: Tile[] = [];
            try { pts = navSync().findLongPath(0, me.x, me.z, P.x, P.z, 300); } catch { pts = []; }
            const dense = densify([me, ...pts]).slice(1);
            const end = dense[dense.length - 1];
            if (!end || end.x !== P.x || end.z !== P.z) {   // push tile not reachable for us (fenced field, barn): try another push
                blockedPush.add(`${S.x},${S.z},${di}`); await bot.tick(1); continue;
            }
            const touches = dense.slice(0, -1).some(t => Math.abs(t.x - S.x) + Math.abs(t.z - S.z) === 1);
            bot.sendRoute(turning(me, dense), !touches);
            if (!touches) { bot.opNpc(s.idx, 1); bot.queueFlush(); }
            else { await bot.until(() => { const t = bot.tile(); return t.x === P.x && t.z === P.z; }, Math.ceil(dense.length / 2) + 3); bot.opNpc(s.idx, 1); bot.queueFlush(); }
        } else { bot.opNpc(s.idx, 1); bot.queueFlush(); }
        pushes++;
        // wait for the sheep to move (or jump), at most 4 ticks
        const moved = await bot.until(() => { const q = find(); return !q || q.x !== S.x || q.z !== S.z || npcsOf(bot, type).some(w => inPen(w)); }, 4);
        if (!moved) {
            stuck++;
            if ((globalThis as any).process?.env?.QTRACE === '1') console.log(`[ar] herd ${type}: sheep stayed at ${S.x},${S.z} (push dir ${di}, stand ${P.x},${P.z}, me ${JSON.stringify(bot.tile())}, cost ${fieldAt(S)?.cost})`);
            if (stuck >= 3) { blockedPush.add(`${S.x},${S.z},${di}`); stuck = 0; }
        } else stuck = 0;
    }
    return false;
}
export { StepError };

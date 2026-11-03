// q-witchhouse.ts — Witch's House (quest_ball): 6,325 base hitpoints xp (x25 = 158,125 = ~3 of the 4 levels the
// combat block leaves hitpoints short of 99). LOCAL ONLY. Content: scripts/quests/quest_ball/*, area_taverly/boy.rs2.
//
// PRECONDITIONS: anywhere a Falador teleport works (runes: law 1, air 3, water 1), pack holds `cheese` x1 and
//   `leather_gloves` x1 (the cellar gate shocks bare hands), prayer > 0 (Protect from Melee for the fight; the trainee
//   comes from the Waterfall at hp ~10, def 1, att/str 83 — unarmed punches kill the four forms, 144 hp in total).
// EXIT STATE: next to the boy in Taverley (2928,3456), hitpoints +158,125 xp, quest points +4.
// STEPS (state machine; each step re-checked every pass, so a witch catch only repeats what it undid):
//   boy (ball quest started) -> potted plant (door key) -> front door -> cellar ladder -> gloves on -> gate -> cupboard
//   (magnet) -> gate -> ladder up -> cheese on the mouse hole -> magnet on the mouse (back door unlocked) -> back door ->
//   fountain (shed key; only while the witch patrols the east half) -> shed door with the key (only while she is west)
//   -> four shapeshifter forms (glob, spider, bear, wolf) -> ball -> back to the boy (quest complete = qp +4).
// The witch (npc 896) patrols z 3463 between x 2904 and 2930. If she sees you she teleports you to (2929,3456) and takes
// the shed key + ball (and resets the quest to "started" unless the diary was read after the back door unlocked).
import { startEatWatch } from './k-mcannon-quest.js';
import { SpeedBot, objId, objDebugName, cheb } from '../core.js';
import { nav, npc, npcsOf, opNpcGo, drive, inDialog, log, trace, walkOp, tele, locAt, opLocGo, useOnLocGo, pickupGo, qp, dismiss, msgsSince, type Tile } from './q-lib.js';
import { isResuming, journalStage, failHook } from './qp/journal.js';

// 2 cheese: a witch catch resets the mouse step. 1 prayer potion: the trainee reaches the shed fight with hitpoints LEVEL 10 and
// prayer 0 (every run so far), so Protect from Melee never went up; R25, A6 and TJ1 died there. A dose before the fight
// (~31 points at prayer 99) keeps it up; more doses as it runs low.
export const WITCHHOUSE_SUPPLY = [{ name: 'cheese', n: 2 }, { name: 'leather_gloves', n: 1 }, { name: '4doseprayerrestore', n: 1 }];
const BOY = 895, WITCH = 896, RAT = 901, FORMS = [897, 898, 899, 900];
const BOY_AT = { x: 2928, z: 3456 }, CAUGHT_AT = { x: 2929, z: 3456 };
const POT = () => locAt(2867, 2900, 3474), FRONT = () => locAt(2861, 2901, 3473), BACK = () => locAt(2862, 2901, 3465);
const LADDER_DOWN = () => locAt(1754, 2907, 3476), LADDER_UP = () => locAt(1755, 2907, 9876);

const MOUSEHOLE = () => locAt(2870, 2903, 3466), FOUNTAIN = () => locAt(2864, 2909, 3470), SHED = () => locAt(2863, 2934, 3463);
const BALL_AT = { x: 2935, z: 3460 };
const OPEN_DOOR = 1531;   // the house's inner doors (1530) once opened
const KEY = objId('witches_doorkey'), SHEDKEY = objId('witches_shedkey'), MAGNET = objId('magnet'), BALL = objId('ball');
const CHEESE = objId('cheese'), GLOVES = objId('leather_gloves');

export async function witchHouseLeg(bot: SpeedBot, o: { verbose?: boolean; maxTicks?: number; teleport?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    if (o.verbose) trace(bot, t0);
    const at = (s: string) => { m[s] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${s} pos=${JSON.stringify(bot.tile())} hp=${bot.stat('hitpoints').cur}`); failHook(`wh:${s}`); };
    const qp0 = qp(bot), maxTicks = o.maxTicks ?? 2500;
    const seen = new Set<string>();   // quest milestones from game messages (the quest varp is not transmitted)
    let since = bot.tickCount;   // messages only count after the last reset (a witch catch undoes the back door)
    const msg = (re: RegExp) => msgsSince(bot, since).some(t => re.test(t));
    const mark = () => {
        if (msg(/attach the magnet/i)) seen.add('backdoor');
        if (process.env.WH_TEST_LOSTMSG !== '1' && msg(/kill the shapeshifter once and for all/i)) seen.add('defeated');
    };
    const inCellar = () => bot.tile().z > 9000;
    // geometry from the doors: front door on the WEST wall of (2901,3473) -> outside is x <= 2900 (the potted plant);
    // back door on the NORTH edge of (2901,3465) -> the garden is z <= 3465 (and the strip east of the house, x >= 2909)
    const inHouse = () => { const t = bot.tile(); return !inCellar() && t.x >= 2901 && t.x <= 2908 && t.z >= 3466 && t.z <= 3476; };
    const inGarden = () => { const t = bot.tile(); return !inCellar() && !inHouse() && t.x >= 2901 && t.x <= 2937 && t.z >= 3459 && t.z <= 3472 && (t.z <= 3465 || t.x >= 2909); };   // the boy (2928,3456) stands outside, south of the hedge
    const witchX = () => npc(bot, WITCH)?.x ?? -1;
    // the witch patrols z 3463 between x 2904 and 2930 (patrol1-6 in witches_house.npc, timer 1) and catches anyone in
    // line of sight within 3 tiles: ok(x, dx) sees her x and walking direction (+1 east, -1 west, 0 unknown/still)
    let wPrev = -1, wDir = 0;
    const waitWitch = async (ok: (x: number, dx: number) => boolean, label: string, max = 90) => {
        const end = bot.tickCount + max; let waited = 0;
        const sample = () => { const x = witchX(); if (x >= 0 && wPrev >= 0 && x !== wPrev) wDir = Math.sign(x - wPrev); wPrev = x; return x; };
        sample();
        while (!ok(sample(), wDir) && bot.tickCount < end) { await bot.tick(1); waited++; }
        if (waited) m[`wait-${label}`] = ((m[`wait-${label}`] as number) ?? 0) + waited;
        if (o.verbose) log(bot, t0, `witch wait ${label}: ${waited}t, witch x ${witchX()} dir ${wDir}`);
    };
    // walk to the stand tile (core walkTo: navgrid + door opener), THEN the op, then wait for its effect. walkOp's
    // route-with-op re-sent the op every tick inside this house and the server discarded them all (WH1-WH4 stalls).
    const step = async (label: string, dest: Tile, op: () => void | boolean, done: () => boolean, maxT = 120, level?: number) => {
        dismiss(bot);
        if (done()) { at(label); return true; }
        for (let k = 0; k < 3 && (cheb(bot.tile(), dest) > 0 || bot.minusedlevel !== (level ?? bot.minusedlevel)); k++) {
            const w = await bot.walkTo(dest.x, dest.z, { level: level ?? bot.minusedlevel, near: 0, maxTicks: maxT, log: !!process.env.WH_LOG });
            if (cheb(bot.tile(), dest) === 0) break;
            // an OPENED house door (1531) swings onto the next tile and walls it off; the static collision the planner uses
            // has the door closed, so the walker "arrives" short (WH5: stuck at 2902,3475). Close it behind us and go on.
            const me = bot.tile(); let closed = false;
            for (const [key, id] of bot.liveLocs) {
                if (id !== OPEN_DOOR) continue;
                const [l, x, z] = key.split(',').map(Number);
                if (l === bot.minusedlevel && Math.max(Math.abs(x! - me.x), Math.abs(z! - me.z)) <= 1) { bot.opLoc(x!, z!, id, 1); bot.queueFlush(); await bot.tick(3); closed = true; m.doorsClosed = ((m.doorsClosed as number) ?? 0) + 1; break; }
            }
            if (!closed && !w.ok) { if (o.verbose) log(bot, t0, `${label}: walk failed ${JSON.stringify(w)}`); return false; }
        }
        for (let k = 0; k < 3 && !done(); k++) {
            const r = op(); if (r === false) break;
            await bot.until(done, 8);
            await drive(bot, () => !inDialog(bot) || done(), [/.*/], 6);
        }
        const ok = done();
        if (ok) at(label); else if (o.verbose) log(bot, t0, `${label}: op had no effect at ${JSON.stringify(bot.tile())}`);
        return ok;
    };
    // GARDEN LOOP (navgrid, WH20): back door (2901,3465) -> x 2901 column -> z 3460 corridor -> x 2933 column -> z 3466
    // corridor -> fountain (2909,3469). Hedge rows z 3461 / 3465 hide the two corridors from the witch's path (z 3463,
    // x 2904-2930, catch radius 3 + hedge rule in witch.rs2); only the two COLUMNS are exposed. So: wait in a corridor
    // until she walks AWAY from the column we are about to cross, then run (2 tiles/tick against her 1).
    let started = false, caught = 0, wasGarden = false, lastIter = -1;
    // the loop as straight corridor segments (live-probed with plan/tools/edgeprobe.ts): the planner wandered into the
    // dead-end z 3468 strip (WH21/22: 144-tick walks, wedged at 2932,3468 / 2914,3469), so the leg walks this tile path
    const LOOP: Tile[] = [{ x: 2901, z: 3465 }, { x: 2901, z: 3460 }, { x: 2933, z: 3460 }, { x: 2933, z: 3463 }, { x: 2933, z: 3466 },
        { x: 2912, z: 3466 }, { x: 2912, z: 3467 }, { x: 2911, z: 3467 }, { x: 2911, z: 3468 }, { x: 2910, z: 3468 }, { x: 2909, z: 3469 }];
    const L_BD = 0, L_SHED = 3, L_FN = LOOP.length - 1, FN = LOOP[L_FN]!;
    const PATH: Tile[] = [LOOP[0]!];
    for (let k = 1; k < LOOP.length; k++) { const b = LOOP[k]!; let c = PATH[PATH.length - 1]!; while (c.x !== b.x || c.z !== b.z) { c = { x: c.x + Math.sign(b.x - c.x), z: c.z + Math.sign(b.z - c.z) }; PATH.push(c); } }
    const nodeAt = LOOP.map(n => PATH.findIndex(q => q.x === n.x && q.z === n.z));
    // one step to `d`; a jump of > 3 tiles = the witch teleported us out (restored: 0ce699e dropped these two helpers but
    // loopTo and the main loop still call them, so a catch threw a ReferenceError instead of being handled)
    const hop = async (d: Tile): Promise<'ok' | 'tele' | 'timeout'> => {
        let prev = bot.tile(); bot.sendRoute([d]); bot.queueFlush();
        for (let i = 0; i < 40; i++) {
            await bot.tick(1); const t = bot.tile();
            if (cheb(t, prev) > 3) return 'tele';
            prev = t; if (cheb(t, d) === 0) return 'ok';
        }
        return 'timeout';
    };
    const onCaught = () => { caught++; m.caught = caught; if (!seen.has('defeated')) seen.delete('backdoor'); since = bot.tickCount; wasGarden = false; if (o.verbose) log(bot, t0, `caught by the witch (#${caught}) at ${JSON.stringify(bot.tile())}`); };
    // THE CATCH RULE (witch.rs2, every tick): she patrols z 3463, x 2904-2930; a player within 3 tiles (and in line of
    // sight) is caught unless dz = 0, or a hedge stands between: dz > 0 -> hedge/hedgecorner on the tile SOUTH of the
    // player, dz < 0 -> a plain hedge on the tile NORTH. Hedge tiles from maps/m45_54.jm2 (locs 1116/1117). WH25/26:
    // caught in BOTH corridors (their hedge rows have gaps), so every garden step is checked against her next position.
    const HEDGE = new Set<string>(), HCORNER = new Set<string>();
    const addRow = (set: Set<string>, z: number, xs: number[]) => xs.forEach(x => set.add(`${x},${z}`));
    addRow(HEDGE, 3461, [2900, 2903, 2907, 2908, 2909, 2915, 2916, 2917, 2923, 2924, 2925, 2929, 2930, 2931]); addRow(HCORNER, 3461, [2902, 2932]);
    for (const z of [3462, 3463, 3464]) addRow(HEDGE, z, [2900, 2902, 2932]);
    addRow(HEDGE, 3465, [2900, 2903, 2904, 2905, 2906, 2907, 2908, 2912, 2913, 2914, 2919, 2920, 2921, 2926, 2927, 2928]); addRow(HCORNER, 3465, [2902, 2909, 2911, 2932]);
    const exposedTo = (t: Tile, xw: number) => {
        const dz = t.z - 3463;
        if (Math.max(Math.abs(t.x - xw), Math.abs(dz)) > 3 || dz === 0) return false;
        return dz > 0 ? !(HEDGE.has(`${t.x},${t.z - 1}`) || HCORNER.has(`${t.x},${t.z - 1}`)) : !HEDGE.has(`${t.x},${t.z + 1}`);
    };
    const safeAt = (t: Tile, xw = witchX()) => xw < 0 || ![xw - 1, xw, xw + 1].some(x => x >= 2904 && x <= 2930 && exposedTo(t, x));
    const westOk = (_x: number, _d: number) => safeAt(LOOP[L_BD]!) && safeAt({ x: 2901, z: 3464 });
    const inShed = () => { const t = bot.tile(); return t.x >= 2934 && t.x <= 2937 && t.z <= 3467 && t.z >= 3459; };   // door 2863 = WEST wall of (2934,3463): enter from (2933,3463), dz 0 = never caught
    const pathIdx = () => { const t = bot.tile(); return PATH.findIndex(q => q.x === t.x && q.z === t.z); };
    // tick controller along PATH: each tick take the furthest of +2/+1/0/-1/-2 tiles that is safe against every place
    // she can be next tick (we run 2 tiles a tick, she walks 1), i.e. hide behind hedges while she passes
    const loopTo = async (toNode: number) => {
        const goal = nodeAt[toNode]!;
        let stood = 0;
        for (let guard = 0; guard < 600; guard++) {
            let i = pathIdx();
            if (i < 0) {   // just out of the shed / a door: step onto the nearest path tile when it is safe
                const t = bot.tile(); let best = 0; PATH.forEach((q, k) => { if (cheb(q, t) < cheb(PATH[best]!, t)) best = k; });
                if (cheb(PATH[best]!, t) > 1) { await bot.walkTo(PATH[best]!.x, PATH[best]!.z, { near: 0, maxTicks: 30 }); if (pathIdx() < 0) return false; continue; }
                if (!safeAt(PATH[best]!)) { await bot.tick(1); stood++; continue; }
                if ((await hop(PATH[best]!)) === 'tele') { onCaught(); return false; }
                continue;
            }
            if (i === goal) { if (stood) m.hid = ((m.hid as number) ?? 0) + stood; return true; }
            const dir = Math.sign(goal - i);
            const cands = [2, 1, 0, -1, -2].map(k => i + dir * k).filter(j => j >= 0 && j < PATH.length && (dir > 0 ? j <= goal : j >= goal));
            const pick = cands.find(j => safeAt(PATH[j]!)) ?? i;
            const prev = bot.tile();
            if (pick !== i) { bot.sendRoute([PATH[pick]!]); bot.queueFlush(); } else stood++;
            await bot.tick(1);
            if (cheb(bot.tile(), prev) > 3) { onCaught(); return false; }
            if (inHouse() || !inGarden()) return false;
        }
        return false;
    };
    // one hop toward `where`; the caller loops (state re-read every pass)
    const gardenHop = async (where: 'fountain' | 'shed' | 'backdoor') => {
        if (inShed()) { await step('shed-out', { x: 2934, z: 3463 }, () => opLocGo(bot, SHED(), 1, { x: 2934, z: 3463 }), () => !inShed(), 20); return; }   // the door walks you through (open_and_close_door2)
        if (where === 'fountain') { await loopTo(L_FN); return; }
        if (where === 'backdoor') {
            if (pathIdx() !== nodeAt[L_BD]) { await loopTo(L_BD); return; }
            await waitWitch(westOk, 'col-0');
            await step('back-in', LOOP[L_BD]!, () => opLocGo(bot, BACK(), 1, LOOP[L_BD]!), () => inHouse(), 20);
            return;
        }
        if (cheb(bot.tile(), LOOP[L_SHED]!) > 0) { await loopTo(L_SHED); return; }
        const SD = { x: 2933, z: 3463 };
        await step('shed', SD, () => seen.has('defeated') ? opLocGo(bot, SHED(), 1, SD) : useOnLocGo(bot, SHEDKEY, SHED(), SD), () => inShed(), 20);
    };
    // into the garden from the house / outside (back door is open once the mouse has the magnet)
    const enterGarden = async () => {
        if (!inHouse()) { await step('front-door', { x: 2900, z: 3473 }, () => useOnLocGo(bot, KEY, FRONT(), { x: 2900, z: 3473 }), () => inHouse(), 40); return; }
        await waitWitch(westOk, 'west-col');
        await step('back-door', { x: 2901, z: 3466 }, () => opLocGo(bot, BACK(), 1, { x: 2901, z: 3466 }), () => inGarden(), 40);
    };
    // session 11 (so the route may retry Witch's House): the milestones the state machine learns from game messages ('started',
    // 'backdoor', 'defeated') are lost with a failed attempt; on a retry read them from the quest JOURNAL (ball_journal.rs2:
    // the open task names the stage; a witch catch already reset 'mouse door unlocked' server-side). WH_RESUME=0 = as before.
    if (isResuming(bot) && process.env.WH_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        const S = await journalStage<number>(bot, 'ball', [
            [/QUEST COMPLETE/i, 5], [/shapeshifter\s+is dead/i, 4], [/how to unlock the back door/i, 3],
            [/found a\s+magnet\s+in a cupboard/i, 2], [/find a way into the\s+garden/i, 1],
        ], 0, s2 => log(bot, t0, `[wh] ${s2}`));
        if (S === 5) { m.ok = true; m.resumed = true; return m; }
        if (S >= 1) started = true;
        if (S >= 3) seen.add('backdoor');
        if (S >= 4) seen.add('defeated');
        m.resumeStage = S;
        log(bot, t0, `[wh] resume at stage ${S} (started ${started}, ${[...seen].join(',') || '-'}; magnet ${bot.count(MAGNET)}, key ${bot.count(KEY)}, shed key ${bot.count(SHEDKEY)}, ball ${bot.count(BALL)}, cheese ${bot.count(CHEESE)})`);
    }
    if (o.teleport ?? true) {
        const tr = await tele(bot, 'falador_teleport');
        if (!tr.ok) throw new Error(`falador teleport failed at ${JSON.stringify(bot.pos())}`);
        at('tele');
    }
    while (qp(bot) === qp0 && bot.tickCount - t0 < maxTicks) {
        mark(); if (bot.tickCount === lastIter) await bot.tick(1); lastIter = bot.tickCount;   // never spin without a tick (WH14 logged 138M lines)
        // witch catch: we were in the garden and now stand at her drop-off point -> quest back to "started" (back door
        // locked again, magnet + cheese step repeats), shed key + ball taken
        if (wasGarden && !inGarden() && cheb(bot.tile(), CAUGHT_AT) <= 3) {
            onCaught();   // the catch only resets 'mouse door unlocked' (witch.rs2)
        }
        wasGarden = inGarden();
        // 1. the boy: start, or hand the ball in
        if (!started || bot.count(BALL)) {
            if (bot.count(BALL) && (inGarden() || inHouse())) {
                // way out = the way in (no other garden exit; a catch deletes the ball)
                if (inGarden()) { await gardenHop('backdoor'); continue; }
                await step('front-out', { x: 2901, z: 3473 }, () => opLocGo(bot, FRONT(), 1, { x: 2901, z: 3473 }), () => !inHouse(), 30);
                continue;
            }
            await step(bot.count(BALL) ? 'boy-return' : 'boy', BOY_AT, () => { const n = npc(bot, BOY); if (!n) return false; opNpcGo(bot, n, 1); return true; }, () => inDialog(bot), 600);
            await drive(bot, () => !inDialog(bot) || qp(bot) !== qp0, [/What's the matter/i, /Ok, I'll see what I can do/i], 40);
            started = true;
            if (bot.count(BALL)) await bot.until(() => qp(bot) !== qp0, 6);
            continue;
        }
        // 2. door key from the potted plant
        if (!bot.count(KEY) && !inHouse() && !inCellar() && (!inGarden() || !seen.has('backdoor'))) {
            await step('key', { x: 2900, z: 3473 }, () => opLocGo(bot, POT(), 1, { x: 2900, z: 3473 }), () => bot.count(KEY) > 0);
            continue;
        }
        // 3. magnet from the cellar (gloves worn: the gate shocks bare hands)
        if (!seen.has('backdoor') && !bot.count(MAGNET)) {
            if (!inHouse() && !inCellar()) { await step('front-door', { x: 2900, z: 3473 }, () => useOnLocGo(bot, KEY, FRONT(), { x: 2900, z: 3473 }), () => inHouse(), 40); continue; }
            if (!inCellar()) { await step('ladder-down', { x: 2907, z: 3475 }, () => opLocGo(bot, LADDER_DOWN(), 1, { x: 2907, z: 3475 }), () => inCellar(), 40); continue; }
            if (bot.count(GLOVES) && !bot.isWorn(GLOVES)) { bot.opHeld2(GLOVES, bot.slot(GLOVES)); bot.queueFlush(); await bot.tick(1); }
            if (bot.tile().x > 2902) { await step('gate-in', { x: 2903, z: 9873 }, () => { bot.opLoc(2902, 9873, 2866, 1); bot.queueFlush(); }, () => bot.tile().x <= 2902, 30); continue; }   // the gate puts you ON its tile (2902)
            // the opened cupboard (2869) is a dynamic loc (loc_change), not in the static scene: op it by id
            await step('cupboard', { x: 2899, z: 9873 }, () => { const open = bot.liveLocs.get(`0,2898,9873`) === 2869; bot.opLoc(2898, 9873, open ? 2869 : 2868, 1); bot.queueFlush(); }, () => bot.count(MAGNET) > 0, 20);
            continue;
        }
        // 4. cheese on the mouse hole, magnet on the mouse: the back door unlocks
        if (!seen.has('backdoor')) {
            if (inCellar()) {
                if (bot.tile().x <= 2902) { await step('gate-out', { x: 2902, z: 9873 }, () => { bot.opLoc(2902, 9873, 2866, 1); bot.queueFlush(); }, () => bot.tile().x >= 2903, 30); continue; }   // gate = wall on the EAST edge of (2902,9873) (shape 0, angle 2): op it from ON that tile ('I can't reach that!' from 2901)
                await step('ladder-up', { x: 2907, z: 9875 }, () => opLocGo(bot, LADDER_UP(), 1), () => !inCellar(), 30); continue;
            }
            const rat = npc(bot, RAT);
            if (!rat) {
                if (!bot.count(CHEESE)) throw new Error('witchhouse: out of cheese');
                const c0 = bot.count(CHEESE);
                await step('cheese', { x: 2902, z: 3467 }, () => { bot.dropItem(CHEESE, bot.slot(CHEESE)); bot.queueFlush(); }, () => bot.count(CHEESE) < c0, 30);
                await bot.until(() => !!npc(bot, RAT), 4); await drive(bot, () => !inDialog(bot), [/.*/], 6);
                continue;
            }
            if (o.verbose) log(bot, t0, `mouse idx ${rat.idx} at ${rat.x},${rat.z} me ${JSON.stringify(bot.tile())} dlg ${inDialog(bot)} modal ${bot.chatModalId} magnet slot ${bot.slot(MAGNET)}`);   // [opheld5,cheese]: DROPPING cheese inside x 2901-2903, z 3466-3467 releases the mouse (no hole op needed)
            if (cheb(bot.tile(), { x: 2902, z: 3466 }) > 0) await bot.walkTo(2902, 3466, { near: 0, maxTicks: 10 });   // WH15: from (2902,3467) (diagonal) the use was dropped 8x
            bot.useItemOnNpc(rat.idx, MAGNET, bot.slot(MAGNET)); bot.queueFlush();
            const mag0 = bot.count(MAGNET);
            await bot.until(() => msg(/attach the magnet|already unlocked/i) || bot.count(MAGNET) < mag0, 8); mark();
            if (bot.count(MAGNET) < mag0 || msg(/already unlocked/i)) seen.add('backdoor');   // the success text is a ~mesbox (modal, not chat): WH16 used the magnet and never saw it
            await drive(bot, () => !inDialog(bot), [/.*/], 6);
            at('magnet'); continue;
        }
        // 5. shed key from the fountain (witch east)
        if (!bot.count(SHEDKEY) && !seen.has('defeated')) {
            if (!inGarden()) { await enterGarden(); continue; }
            if (cheb(bot.tile(), FN) > 1) { await gardenHop('fountain'); continue; }
            await step('fountain', FN, () => opLocGo(bot, FOUNTAIN(), 2), () => bot.count(SHEDKEY) > 0, 30);
            m.fountain = true; continue;
        }
        // 6. shed (witch west) + the four forms
        if (!seen.has('defeated')) {
            if (!inShed()) {
                if (!inGarden()) { await enterGarden(); continue; }
                await gardenHop('shed'); continue;
            }
            // R25/A6 both DIED here at hp 10 (WH28 from a checkpoint survived): eat sharks while the forms fight, and log prayer
            if (o.verbose) log(bot, t0, `shed fight: hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level} prayer ${bot.stat('prayer').cur} sharks ${bot.count('shark')}`);
            const stopEat = startEatWatch(bot, Math.max(4, Math.floor(bot.stat('hitpoints').level / 2)));
            const PP = /^[1234]doseprayerrestore$/;
            const sip = async () => {
                const pp = bot.inv().filter(x => PP.test(objDebugName(x.obj))).sort((a, b) => objDebugName(a.obj).localeCompare(objDebugName(b.obj)))[0];
                if (!pp) return false;
                bot.opHeld1(pp.obj, pp.slot); bot.queueFlush(); await bot.until(() => bot.stat('prayer').cur > 0, 3); return true;
            };
            if (bot.stat('prayer').cur < 20) await sip();
            for (let k = 0; k < 3 && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee'); k++) {
                bot.activatePrayer('protectfrommelee'); bot.queueFlush(); await bot.until(() => bot.isPrayerActive('protectfrommelee'), 3);
            }
            if (o.verbose) log(bot, t0, `shed fight: protect ${bot.isPrayerActive('protectfrommelee')} prayer ${bot.stat('prayer').cur}`);
            let target = -1, lastOp = -99, lastSip = bot.tickCount;
            // session 11 fix 334 (qx110p: witchhouse FAILED 2,642 t): the wolf died at engine t8600 inside a 4 t reconnect (drop
            // at engine 8598), so 'You finally kill the shapeshifter once and for all' (witches_experiement.rs2:47) never arrived
            // and this loop waited out 400 t again and again with no form left, up to maxTicks. The forms chain in the same tick
            // (npc_del + npc_add, witches_experiement.rs2:3-30): seen a form, then none for 6 t = the chain ended -> ask the
            // journal (stage 4 'shapeshifter is dead'). WH_FORMS_GONE=0 reverts. TEST: WH_TEST_LOSTMSG=1 ignores the kill msg.
            const formsGone = process.env.WH_FORMS_GONE !== '0';
            let sawForm = false, noForm = 0;
            const end = bot.tickCount + 400;
            while (!seen.has('defeated') && bot.tickCount < end) {
                mark();
                if (bot.stat('prayer').cur < 8 && bot.tickCount - lastSip >= 3 && (await sip())) { lastSip = bot.tickCount; bot.activatePrayer('protectfrommelee'); }
                else if (bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee') && bot.tickCount % 3 === 0) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
                const f = npcsOf(bot, FORMS)[0];
                if (f) { sawForm = true; noForm = 0; } else if (formsGone && sawForm && ++noForm >= 6) break;
                if (f && (f.idx !== target || bot.tickCount - lastOp > 8)) { bot.opNpc(f.idx, 2); bot.queueFlush(); target = f.idx; lastOp = bot.tickCount; }
                await bot.tick(1);
            }
            bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); stopEat();
            if (formsGone && !seen.has('defeated')) {
                const S = await journalStage<number>(bot, 'ball', [[/QUEST COMPLETE/i, 5], [/shapeshifter\s+is dead/i, 4]], 0, s2 => log(bot, t0, `[wh] 334: ${s2}`));
                if (S >= 4) seen.add('defeated');
            }
            at('defeated'); continue;
        }
        // 7. the ball
        if (!bot.count(BALL)) {
            if (!inShed()) { if (!inGarden()) await enterGarden(); else await gardenHop('shed'); continue; }   // after a catch: back in through the house
            await step('ball', BALL_AT, () => { pickupGo(bot, BALL, BALL_AT); }, () => bot.count(BALL) > 0, 30); continue;
        }
        await bot.tick(1);
    }
    m.ticks = bot.tickCount - t0; m.ok = qp(bot) !== qp0;
    if (o.verbose) log(bot, t0, `done ${JSON.stringify(m)}`);
    return m;
}

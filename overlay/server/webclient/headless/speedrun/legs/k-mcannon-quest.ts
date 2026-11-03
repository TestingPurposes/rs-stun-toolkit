// =====================================================================================================
// legs/k-mcannon-quest.ts — Dwarf Cannon quest, tick-tight (prefix k). LOCAL ONLY for tests.
//   LC_HOST=localhost:8888 bun headless/speedrun/legs/k-mcannon-quest.ts trainee [sfx]   route state, start Varrock west bank
//   LC_HOST=localhost:8888 bun headless/speedrun/legs/k-mcannon-quest.ts helper  [sfx]   the quest with helper stats
//
// QUEST (content/scripts/quests/quest_mcannon, ids from loc.pack / maps):
//   Lawgof 208 (2571,3463) -> 6 railings (locs 15-20, oploc1, p_choice2 "Try to replace", stat_random(crafting,60,150):
//   59% at 99, fail = -1..3 hp) -> Lawgof -> guard tower ladder 1747 (2570,3441) L0->L1, ladder 1747 (2570,3443) L1->L2,
//   take remains obj 0 at L2 (2567,3444) -> down -> Lawgof -> cave 2 (2622,3392) -> crate 1 (2571,9850): child dialog ->
//   mud pile 13 (2621,9796) -> Lawgof (multi2 "Ok, I'll see what I can do." -> toolkit) -> shed door 4 (2576,3461) ->
//   broken cannon 5 (2577,3461): op x6 (first look, then inspect+fix pipe/barrel/axle/shaft; smithing 99 = never fails)
//   -> Lawgof (multi2 "Ok then, just for you!") -> Nulodion 209 (3011,3453) behind door 3 (3015,3453) -> mould + notes
//   -> Lawgof -> complete (+1 QP, 750 crafting).
// PRECONDITIONS (trainee): crafting + smithing 99 (railing odds, cannon repair certainty), magic >= 45, runes for
//   Camelot x2 + Falador x1 (law 3, air 13, water 1), hp any (railing cuts do 1 dmg at hp 10). >= 4 free slots.
// EXIT: Lawgof's camp (2571,3463), quest complete. Pack: runes minus the teleports.
// =====================================================================================================
import { SpeedBot, runLeg, localSetup, objId, cheb } from '../core.js';
import { nav, npc, inDialog, log, trace, walkOp, tele, opLocFrom, locAt, pickupGo, qp, prePlanArea, prePlan, type Tile } from './q-lib.js';
import * as ls from '../../loc-scene.js';
import { isResuming, journalStage } from './qp/journal.js';

export const LAWGOF = 208, NULODION = 209;
const LAWGOF_AT = { x: 2571, z: 3463 }, NULODION_AT = { x: 3011, z: 3453 };
const CAMELOT = { x: 2757, z: 3478 }, FALADOR = { x: 2965, z: 3378 };
/** the corridor between the two dwarf-camp doors is entered from the north */
const NULODION_DOOR_OUT = { x: 3016, z: 3456 };
/** the tile one east of the door's outer tile (3015,3453) in the open x3015-3016 corridor: reachable from the north
 *  (3016,3455) and the south (3016,3450) without any door */
export const NULODION_MEET = { x: 3016, z: 3453 };
/** Nulodion's room behind the locked mcannondoor (loc 3 @ 3015,3453, west edge): the 21 tiles the door seals (geo test) */
export const NULODION_ROOM: ReadonlyArray<Tile> = [
    [3014, 3454], [3013, 3454], [3012, 3454], [3011, 3454], [3010, 3454], [3014, 3453], [3013, 3453], [3012, 3453], [3011, 3453],
    [3010, 3453], [3014, 3452], [3013, 3452], [3011, 3452], [3010, 3452], [3009, 3452], [3008, 3452], [3010, 3451], [3010, 3450],
    [3010, 3449], [3009, 3449], [3008, 3449],
].map(([x, z]) => ({ x: x!, z: z! }));
export const insideNulodion = (t: Tile): boolean => NULODION_ROOM.some(r => r.x === t.x && r.z === t.z);
const RAILINGS: Array<{ id: number; x: number; z: number }> = [
    { id: 20, x: 2572, z: 3460 }, { id: 19, x: 2564, z: 3460 }, { id: 18, x: 2559, z: 3462 },
    { id: 17, x: 2557, z: 3464 }, { id: 16, x: 2558, z: 3472 }, { id: 15, x: 2556, z: 3475 },
];
const RAILING_OBJ = objId('mcannonrailing1_obj'), REMAINS = objId('mcannonremains'), TOOLKIT = objId('mcannontoolkit');
const MOULD = objId('ammo_mould'), NOTES = objId('nulodions_notes');
export const MCANNON_SUPPLY = [{ name: "lawrune", n: 3 }, { name: "airrune", n: 13 }, { name: "waterrune", n: 1 }, { name: "shark", n: 4 }];   // sharks: hp ~10 + railing cuts

export async function mcannonPrep(): Promise<void> {
    await prePlanArea(0, CAMELOT, 2, LAWGOF_AT);
    await prePlanArea(0, FALADOR, 2, { x: 3017, z: 3453 });
}

/** Answer/continue whatever dialog is open until `done()`; 5 resumes per tick, choices by text. */
async function converse(bot: SpeedBot, done: () => boolean, answers: RegExp[], maxTicks = 40, closeAfter = 2): Promise<boolean> {
    const end = bot.tickCount + maxTicks; let closedFor = 0, seen = false;
    while (bot.tickCount < end && !bot.disposed) {
        if (done()) return true;
        if (bot.chatModalId !== -1) {
            seen = true; closedFor = 0;
            const opts = bot.dialogOptions();
            if (opts.length) {
                let hit = -1; for (const re of answers) { hit = bot.clickDialogByText(re); if (hit > 0) { (bot as any).__kAnswered = (bot as any).__kAnswered ?? []; (bot as any).__kAnswered.push(opts.map(o => o.text).join('|')); break; } }
                if (hit < 0) { console.log(`[k] unplanned choice [${opts.map(o => o.text).join(' | ')}]`); bot.clickDialogByText(/.*/); }
            } else for (let i = 0; i < 5; i++) bot.resumeDialogPage();
            bot.queueFlush();
        } else if (seen && ++closedFor >= closeAfter) return done();
        await bot.tick(1);
    }
    return done();
}
/** Walk to the npc and talk; returns once the conversation is over (or `done`). */
async function talkTo(bot: SpeedBot, type: number, at: Tile, answers: RegExp[], done?: () => boolean, maxTicks = 400): Promise<boolean> {
    const op = () => { const n = npc(bot, type); if (!n) return false; bot.opNpc(n.idx, 1); return true; };
    if (!inDialog(bot)) {
        const ok = await walkOp(bot, at, op, () => inDialog(bot) || (done?.() ?? false), { near: 1, maxTicks });
        if (!ok) return false;
    }
    const r = await converse(bot, done ?? (() => false), answers, 60, done ? 10 : 2);
    return done ? r : !inDialog(bot);
}
/** Already inside the npc's room: OPNPC (the engine routes us) until the first page, then converse. */
async function talkHere(bot: SpeedBot, type: number, answers: RegExp[], done?: () => boolean): Promise<boolean> {
    const end = bot.tickCount + 40;
    while (!inDialog(bot) && !(done?.() ?? false) && bot.tickCount < end) { const n = npc(bot, type); if (n) { bot.opNpc(n.idx, 1); bot.queueFlush(); } await bot.tick(1); }
    const r = await converse(bot, done ?? (() => false), answers, 60);
    return done ? r : !inDialog(bot);
}
const SHARK = objId('shark');
/** Eat one shark if hp <= at (hp ~10 in the route: railing cuts do 1 dmg). Waits out the eat (3 ticks). */
export async function eatIfLow(bot: SpeedBot, at: number): Promise<boolean> {
    if (bot.stat('hitpoints').cur > at || bot.count(SHARK) === 0) return false;
    bot.opHeld1(SHARK, bot.slot(SHARK)); bot.queueFlush(); await bot.tick(1); return true;
}
function nearNpcs(bot: SpeedBot): string {
    const me = bot.tile(); const out: string[] = [];
    for (let i = 0; i < bot.npcCount; i++) { const n = bot.npcs[bot.npcIndices[i]!]; if (!n) continue; const t = bot.npcTileOf(n); if (cheb(t, me) <= 2) out.push(`${ls.npcName(n.typeId)}@${t.x},${t.z}`); }
    return out.join(' ');
}
function fail(bot: SpeedBot, s: string): never { throw new Error(`${s} at ${JSON.stringify(bot.pos())}`); }

export interface McQuestOpts { verbose?: boolean; startTele?: boolean; walk?: boolean; eatAt?: number; resume?: boolean }
/** session 10: phase resume from the quest JOURNAL (journal.ts; mcannon_journal.rs2 texts), first match wins. */
const MC_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 11], [/spoken to Nulodion/i, 10], [/find\s+Nulodion/i, 9], [/fixed the broken multicannon/i, 8],
    [/fix the multicannon/i, 7], [/rescued the dwarf child/i, 6], [/find the Dwarf child|find the Goblin base/i, 5],
    [/found some dwarf\s+remains/i, 4], [/check up on his guards/i, 3], [/report back to the Commander/i, 2],
    [/fix the broken railings/i, 1],
];
/** Background eater: a shark whenever hp <= at and no chat page is open (eating runs if_close). Returns a stopper. */
export function startEatWatch(bot: SpeedBot, at: number): () => void {
    let stop = false, last = -10;
    (async () => { while (!stop && !bot.disposed) {
        if (bot.stat('hitpoints').cur <= at && bot.count(SHARK) > 0 && bot.tickCount - last >= 3 && bot.chatModalId === -1) { bot.opHeld1(SHARK, bot.slot(SHARK)); bot.queueFlush(); last = bot.tickCount; }
        await bot.tick(1);
    } })();
    return () => { stop = true; };
}
/** Long walk (core walkTo: navgrid + doors), used instead of the teleports in walk mode. */
async function walkLong(bot: SpeedBot, to: Tile, near: number, what: string): Promise<void> {
    const r = await bot.walkTo(to.x, to.z, { near, maxTicks: 3000, log: false });
    if (cheb(bot.tile(), to) > near + 10) fail(bot, `walk to ${what} (${JSON.stringify(r)})`);
}
export async function mcannonQuestLeg(bot: SpeedBot, o: McQuestOpts = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const stopEat = startEatWatch(bot, o.eatAt ?? 4);
    try { return await questBody(bot, o); } finally { stopEat(); }
}
let mcFailFired = false;   // MC_FAIL_AT fires once per process
async function questBody(bot: SpeedBot, o: McQuestOpts): Promise<Record<string, number | boolean>> {
    const t0 = bot.tickCount, mark: Record<string, number> = {};
    const m = (k: string) => { mark[k] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${k} energy=${(bot as any).runEnergy} hp=${bot.stat('hitpoints').cur}`);
        // TEST HOOK (resume proofs): MC_FAIL_AT=<mark> fails the first attempt right after that mark
        if (process.env.MC_FAIL_AT === k && !mcFailFired) { mcFailFired = true; fail(bot, `MC_FAIL_AT ${k} (test)`); } };
    trace(bot, t0);
    const qp0 = qp(bot);
    // session 10 (allchaos qu22m 'nulodion' and NO_RETRY: a failed cannon stopped the run): on a retry, resume at the phase
    // the journal shows (MC_RESUME=0 = always from the top)
    const st = (o.resume ?? isResuming(bot)) && process.env.MC_RESUME !== '0' ? await journalStage(bot, 'mcannon', MC_STAGES, 0, s => log(bot, t0, s)) : 0;
    if (st >= 11) return { ...mark, ok: true, resumed: st };
    const lawgofTele = async (k: string) => { if (cheb(bot.tile(), LAWGOF_AT) > 30 || (bot.minusedlevel ?? 0) !== 0) { if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, k); } };
    if (st >= 1) {
    if (st <= 8) await lawgofTele('camelot (resume)');
    m(`resume${st}`);
    } else {
    // 1. Camelot -> Lawgof: start (multi2 "Yeah, I'd love to help.")
    if (o.walk) { if (cheb(bot.tile(), LAWGOF_AT) > 12) await walkLong(bot, LAWGOF_AT, 3, 'Lawgof'); m('walk1'); }
    else if (o.startTele !== false) { if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot 1'); m('camelot1'); }
    let started = await talkTo(bot, LAWGOF, LAWGOF_AT, [/love to help/i], () => bot.count(RAILING_OBJ) >= 6);
    // R24/A5/MC1 (both revisions): the first talk failed ~10 ticks after arriving next to him; MC2 (same code) passed. Retry in place.
    for (let k = 0; !started && k < 3; k++) { if (o.verbose) log(bot, t0, `lawgof start retry ${k + 1} (chat ${bot.chatModalId}, npcs ${nearNpcs(bot)})`); started = await talkHere(bot, LAWGOF, [/love to help/i], () => bot.count(RAILING_OBJ) >= 6); }
    if (!started) fail(bot, 'lawgof start');
    m('started');
    }
    if (st <= 1) {
    // 2. railings: op -> choice "Try to replace" -> success removes one railing obj; fail -> retry
    let attempts = 0;
    const left = RAILINGS.slice();
    while (left.length) {
        const me = bot.tile(); left.sort((a, b) => cheb(a, me) - cheb(b, me));
        const r = left.shift()!;
        const loc = locAt(r.id, r.x, r.z);
        const stands = [{ x: r.x, z: r.z }, { x: r.x + 1, z: r.z }, { x: r.x - 1, z: r.z }, { x: r.x, z: r.z + 1 }, { x: r.x, z: r.z - 1 }].sort((a, b) => cheb(a, me) - cheb(b, me));
        for (let k = 0; k < 60; k++) {   // crafting 1: ~23% per try; a cut never aborts the leg
            const have = bot.count(RAILING_OBJ);
            await eatIfLow(bot, o.eatAt ?? 4);
            attempts++;
            const ta = bot.tickCount;
            const opened = await opLocFrom(bot, loc, 1, () => bot.dialogOptions().some(x => /replace the railing/i.test(x.text)) || /already fixed/i.test(msgsSinceTick(bot, ta)), stands, { perTry: 40 });
            if (!opened) fail(bot, `railing ${r.id}`);
            if (/already fixed/i.test(msgsSinceTick(bot, ta))) break;
            bot.clickDialogByText(/replace the railing/i); bot.queueFlush();
            const t1 = bot.tickCount;
            await bot.until(() => bot.count(RAILING_OBJ) < have || /cut yourself/i.test(msgsSinceTick(bot, t1)), 10);
            if (bot.count(RAILING_OBJ) < have) break;
            if (o.verbose) log(bot, t0, `railing ${r.id} failed (${bot.tickCount - t1}t), retry; hp ${bot.stat('hitpoints').cur} npcs<=2: ${nearNpcs(bot)}`);
        }
    }
    mark.railingAttempts = attempts; m('railings');
    }
    if (st <= 2) {
    // 3. Lawgof -> watch tower
    if (!(await talkTo(bot, LAWGOF, LAWGOF_AT, []))) fail(bot, 'lawgof railings');
    m('lawgof2');
    }
    if (st <= 3) {
    const lad0 = locAt(1747, 2570, 3441, 0);
    if (!(await walkOp(bot, { x: 2570, z: 3440 }, () => bot.opLoc(lad0.x, lad0.z, lad0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 60 }))) fail(bot, 'tower ladder 0');
    const lad1 = locAt(1747, 2570, 3443, 1);
    if (!(await walkOp(bot, { x: 2570, z: 3442 }, () => bot.opLoc(lad1.x, lad1.z, lad1.id, 1), () => bot.minusedlevel === 2, { level: 1, maxTicks: 20 }))) fail(bot, 'tower ladder 1');
    if (!(await walkOp(bot, { x: 2567, z: 3444 }, () => { pickupGo(bot, REMAINS, { x: 2567, z: 3444 }); }, () => bot.count(REMAINS) > 0, { level: 2, maxTicks: 20 }))) fail(bot, 'remains');
    m('remains');
    const lad2 = locAt(1746, 2570, 3443, 2);
    if (!(await walkOp(bot, { x: 2570, z: 3442 }, () => bot.opLoc(lad2.x, lad2.z, lad2.id, 1), () => bot.minusedlevel === 1, { level: 2, maxTicks: 20 }))) fail(bot, 'tower down 2');
    const lad3 = locAt(1746, 2570, 3441, 1);
    if (!(await walkOp(bot, { x: 2570, z: 3442 }, () => bot.opLoc(lad3.x, lad3.z, lad3.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 20 }))) fail(bot, 'tower down 1');
    m('tower');
    }
    if (st <= 4) {
    if (!(await talkTo(bot, LAWGOF, LAWGOF_AT, [], () => bot.count(REMAINS) === 0 && !inDialog(bot)))) fail(bot, 'lawgof remains');
    m('lawgof3');
    }
    if (st <= 5) {
    // 4. goblin cave: entrance -> crate (child) -> mud pile
    const cave = locAt(2, 2622, 3392);
    if (bot.tile().z < 6400 && !(await opLocFrom(bot, cave, 1, () => bot.tile().z > 6400, [{ x: 2622, z: 3394 }, { x: 2623, z: 3394 }, { x: 2621, z: 3394 }, { x: 2624, z: 3394 }], { perTry: 80 }))) fail(bot, 'cave');
    m('cave');
    const crate = locAt(1, 2571, 9850);
    let freed = false;
    for (let k = 0; k < 12 && !freed; k++) {
        const tc = bot.tickCount;
        await opLocFrom(bot, crate, 1, () => inDialog(bot) || /runs off|find nothing|dwarf child, tied/i.test(msgsSinceTick(bot, tc)), [{ x: 2572, z: 9850 }, { x: 2571, z: 9849 }, { x: 2571, z: 9851 }, { x: 2570, z: 9850 }], { perTry: 60 });
        // our own re-sent op after the untie also reads "find nothing" (our child is now within 14 tiles): only a
        // "find nothing" WITHOUT our own "tied up" line means another player's child is out
        if (/find nothing/i.test(msgsSinceTick(bot, tc)) && !/dwarf child, tied/i.test(msgsSinceTick(bot, tc)) && !inDialog(bot)) { if (o.verbose) log(bot, 0, 'crate: a child is already out (another player) - waiting'); await bot.tick(10); continue; }
        await converse(bot, () => /runs off/i.test(msgsSinceTick(bot, tc)), [], 20);
        freed = /runs off/i.test(msgsSinceTick(bot, tc));
    }
    if (!freed) fail(bot, 'crate');
    m('child');
    const mud = locAt(13, 2621, 9796);
    if (!(await opLocFrom(bot, mud, 1, () => bot.tile().z < 6400, [{ x: 2620, z: 9796 }, { x: 2621, z: 9798 }, { x: 2622, z: 9796 }, { x: 2620, z: 9797 }, { x: 2622, z: 9797 }], { perTry: 60 }))) fail(bot, 'mud pile');
    m('outOfCave');
    }
    if (st <= 6) {
    // 5. Lawgof -> toolkit
    if (!(await talkTo(bot, LAWGOF, LAWGOF_AT, [/^Ok, I'll see what I can do/i], () => bot.count(TOOLKIT) > 0))) fail(bot, 'lawgof toolkit');
    m('toolkit');
    }
    const door = locAt(4, 2576, 3461);
    if (st <= 7) {
    // 6. shed + broken cannon: first look, then inspect/fix x4, then the final inspect
    if (cheb(bot.tile(), { x: 2578, z: 3462 }) > 1 || bot.tile().x < 2577) {
        // the shed is ONE tile: the door (mcannondoor1, west edge of 2576) toggles 2575 (outside) <-> 2576 (inside);
        // the cannon blocks 2577 (measured on the live engine, probe)
        for (let k = 0; k < 4 && bot.tile().x < 2576; k++) {
            const cur = bot.liveLocs.get(`${bot.minusedlevel ?? 0},${door.x},${door.z}`) ?? door.id;
            await walkOp(bot, { x: 2575, z: 3461 }, () => bot.opLoc(door.x, door.z, cur, 1), () => bot.tile().x >= 2576, { maxTicks: 20 });
        }
        if (bot.tile().x < 2576) fail(bot, 'shed door (in)');
    }
    m('shed');
    const cannon = locAt(5, 2577, 3461);
    const parts = [/^Pipe$/, /^Barrel$/, /^Axle$/, /^Shaft$/];
    // tick loop: choice open -> pick the next part; chat page -> resume (or done on "working order"); else spam the op
    // (ops sent while the fix's p_delay runs are dropped by the engine, so spamming costs nothing and wastes no tick)
    let fixed = 0, done = false; const tr0 = bot.tickCount, tStart = bot.tickCount;
    while (!done && bot.tickCount - tr0 < 500) {   // low smithing/crafting: inspect and each fix can fail (stat_random)
        const opts = bot.dialogOptions();
        if (opts.some(x => /pipe/i.test(x.text))) { bot.clickDialogByText(parts[Math.min(fixed, 3)]!); }
        else if (inDialog(bot)) {
            if (/working order/i.test([...bot.ifText.values()].join(' '))) done = true;
            bot.resumeDialogPage();
        } else bot.opLoc(cannon.x, cannon.z, cannon.id, 1);
        bot.queueFlush();
        await bot.tick(1);
        // session 11 fix 409 (qx556: a fix that landed during a 38 t re-attach never reached the chatLog, so `fixed` stuck one
        // behind and re-picked a FIXED part forever ("You've already fixed this part"); retries restart at Pipe -> repair (0) x2.
        // %mcannonmulti is not transmitted, so an "already fixed" reply (1 per choice, IF_BUTTON) advances the pick as well.
        // FIX409=0 = old counting. TEST409=1 = drop the first "manage to fix" line (simulates the lost message, no chaos needed).
        { const said = msgsSinceTick(bot, tStart);
          fixed = Math.max(0, (said.match(/manage to fix/gi) ?? []).length - (process.env.TEST409 === '1' && /manage to fix/i.test(said) ? 1 : 0))
              + (process.env.FIX409 === '0' ? 0 : (said.match(/already fixed this part/gi) ?? []).length); }
    }
    if (done) fixed = 5;
    if (fixed < 5) fail(bot, `cannon repair (${fixed})`);
    m('repaired');
    // out of the shed: the door walks us through (open_and_close_door)
    // leaving: the door from the inside tile 2576 itself. The old stand tile 2577 is under the cannon (unreachable), so
    // the walk to it failed and the trainee never used the door (live 50 ms LV2/LV3 stalls; the sim got lucky)
    for (let k = 0; k < 4 && bot.tile().x >= 2576; k++) {
        const cur = bot.liveLocs.get(`${bot.minusedlevel ?? 0},${door.x},${door.z}`) ?? door.id;
        bot.opLoc(door.x, door.z, cur, 1); bot.queueFlush();
        await bot.until(() => bot.tile().x <= 2575, 8);
    }
    if (bot.tile().x >= 2576) fail(bot, 'shed door (out)');
    }
    if (bot.tile().x >= 2576 && bot.tile().x <= 2577 && bot.tile().z === 3461) {   // resumed inside the shed
        for (let k = 0; k < 4 && bot.tile().x >= 2576; k++) { const cur = bot.liveLocs.get(`${bot.minusedlevel ?? 0},${door.x},${door.z}`) ?? door.id; bot.opLoc(door.x, door.z, cur, 1); bot.queueFlush(); await bot.until(() => bot.tile().x <= 2575, 8); }
    }
    if (st <= 8) {
    // 7. Lawgof -> Nulodion
    if (!(await talkTo(bot, LAWGOF, LAWGOF_AT, [/just for you/i], () => ((bot as any).__kAnswered ?? []).some((t: string) => /just for you/i.test(t)) && !inDialog(bot)))) fail(bot, 'lawgof repaired');
    m('lawgof5');
    }
    if (st <= 9) {
    if (o.walk) await walkLong(bot, NULODION_DOOR_OUT, 2, 'Nulodion');
    else if (cheb(bot.tile(), NULODION_AT) > 30 && !(await tele(bot, 'falador_teleport')).ok) fail(bot, 'falador');
    m('falador');
    await enterNulodion(bot);
    // session 10 (allchaos qu22m: inside the room at (3013,3452), 100 t of OPNPC without a single page, silent 'nulodion'):
    // up to 4 rounds; each failed round logs what we see, then walks next to him (MC_NUL_ROUNDS=1 = old)
    const gotMould = () => bot.count(MOULD) > 0 && bot.count(NOTES) > 0 && !inDialog(bot);
    let talked = false;
    for (let r = 0; r < Number(process.env.MC_NUL_ROUNDS ?? 4) && !talked; r++) {
        if (r > 0) {
            const n = npc(bot, NULODION);
            log(bot, t0, `nulodion round ${r + 1}: npc ${n ? `${n.x},${n.z} d${n.d}` : 'NOT in view'} me ${JSON.stringify(bot.tile())} inside ${insideNulodion(bot.tile())} chat ${bot.chatModalId} main ${bot.mainModalId} msgs '${msgsSinceTick(bot, bot.tickCount - 60).slice(-200)}'`);
            if (bot.mainModalId !== -1 || bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
            if (!insideNulodion(bot.tile())) await enterNulodion(bot);
            if (n && n.d > 1) await bot.walkTo(n.x, n.z, { near: 1, maxTicks: 20, log: false });
        }
        talked = await talkHere(bot, NULODION, [], gotMould);
    }
    if (!talked) fail(bot, 'nulodion');
    m('mould');
    }
    // 8. back: Camelot -> Lawgof -> complete
    if (o.walk) await walkLong(bot, LAWGOF_AT, 3, 'Lawgof (return)');
    else if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot 2');
    m('camelot2');
    if (!(await talkTo(bot, LAWGOF, LAWGOF_AT, [], () => qp(bot) > qp0))) fail(bot, 'lawgof complete');
    m('complete');
    return { ...mark, ok: qp(bot) > qp0 };
}

/** Through Nulodion's door (3015,3453) from the east (the door opens + walks us in). */
export async function enterNulodionPub(bot: SpeedBot): Promise<void> { return enterNulodion(bot); }
async function enterNulodion(bot: SpeedBot): Promise<void> {
    if (insideNulodion(bot.tile())) return;
    const d = locAt(3, 3015, 3453);
    // session 10 (our sim notes): live loc id; up to 3 rounds of 60 t, each failure logged (an npc
    // on the inside op tile (3014,3453) blocks the walk-through; 'The door is locked.' = %mcannon < 9: Lawgof's
    // 'just for you' talk was cut, MC_RESUME's journal read sends the retry back to him)
    for (let r = 0; r < 3 && !insideNulodion(bot.tile()); r++) {
        const t1 = bot.tickCount;
        const id = () => bot.liveLocs.get(`0,${d.x},${d.z}`) ?? d.id;
        if (await walkOp(bot, { x: 3015, z: 3453 }, () => bot.opLoc(d.x, d.z, id(), 1), () => insideNulodion(bot.tile()), { maxTicks: r === 0 ? 120 : 60 })) break;
        const msgs = msgsSinceTick(bot, t1);
        console.log(`[k-mcannon] nulodion door round ${r + 1}: at ${JSON.stringify(bot.tile())} loc ${id()} npcs ${nearNpcs(bot)} msgs '${msgs.slice(-160)}'`);
        if (/door is locked/i.test(msgs)) fail(bot, 'nulodion door locked (Lawgof talk not finished)');
    }
    if (!insideNulodion(bot.tile())) fail(bot, "nulodion door");
}
/**
 * Out of Nulodion's room. The door (loc 3, open_and_close_door) only works from its two op tiles, (3014,3453) inside and
 * (3015,3453) outside, and lands you on the other one. The planners treat it as OPEN (doors are masked) and the door
 * tracker does not know scripted doors, so a plain walkTo from inside plans straight through the shut edge and wedges.
 *  the old step-out + walkTo printed "outside" without ever checking. Here: OPLOC the door (the engine
 * self-routes to (3014,3453) inside the room), confirm we stand OUTSIDE, retry a few times, else throw.
 */
export async function exitNulodion(bot: SpeedBot): Promise<void> {
    if (!insideNulodion(bot.tile())) return;
    const d = locAt(3, 3015, 3453);
    for (let attempt = 0; attempt < 6 && insideNulodion(bot.tile()) && !bot.disposed; attempt++) {
        const me = bot.tile();
        if (me.x !== 3014 || me.z !== 3453) await bot.stepTo(3014, 3453, 20);   // inside the room: no door on this leg
        bot.opLoc(d.x, d.z, d.id, 1); bot.queueFlush();
        await bot.until(() => !insideNulodion(bot.tile()), 8);
    }
    if (insideNulodion(bot.tile())) fail(bot, 'could not leave Nulodion\'s room through door (3015,3453)');
    console.log(`[k-mcannon] out of Nulodion's room at (${bot.tile().x},${bot.tile().z})`);
}
// ---- tiny message helpers ----
function msgsSinceTick(bot: SpeedBot, t: number): string { return ((bot as any).getChat({ types: [0], limit: 0, includeSelf: true }) as any[]).filter(m => m.tick >= t).map(m => m.text).join(' | '); }

// =====================================================================================================
// CLI
//   LOCAL (LC_HOST=localhost:8888, cheats allowed):
//     bun ... k-mcannon-quest.ts trainee [sfx]                       route state, teleports
//     bun ... k-mcannon-quest.ts helper  [sfx] [--walk] [--lowhelper] quest only (helper stats; --lowhelper = magic/crafting 1, hp 44)
//   LIVE (no cheats, no localhost guard):
//     bun ... k-mcannon-quest.ts helper --live <acct> [--tele] [--eat N]          quest, WALKING by default
// =====================================================================================================
if (import.meta.main) {
    const args = process.argv.slice(2);
    const flag = (f: string) => args.includes(f);
    const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
    const role = args[0] ?? 'trainee';
    const liveAcct = val('--live');
    const live = liveAcct !== undefined;
    if (!live && !/^(localhost|127.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888 (or use --live <acct>)'); process.exit(1); }
    if (live && !process.env.LC_HOST) { console.error('live: set LC_HOST=rs-sdk-demo.fly.dev'); process.exit(1); }
    ls.init();
    const sfx = (!live && args[1] && !args[1].startsWith('--')) ? args[1] : String(Date.now() % 100000);
    const walk = live ? !flag('--tele') : flag('--walk');
    const eatAt = Number(val('--eat') ?? (role === 'trainee' ? 4 : 15));
    let bot: SpeedBot;
    try {
        if (live) {
            const { readBotEnv, createLive } = await import('./k-live.js');
            const creds = readBotEnv(liveAcct!);
            console.log(`[k-mcannon] LIVE ${role} as ${creds.user} on ${process.env.LC_HOST} walk=${walk} eatAt=${eatAt}`);
            bot = await createLive(creds);
        } else bot = await SpeedBot.create(`k${role[0]}${sfx}`);
    } catch (e) {
        // a failed login must FAIL the driver (exit 2), never fall through to an exit 0
        console.error(`[k-mcannon] LOGIN FAILED: ${(e as Error)?.message ?? e}`);
        process.exit(2);
    }
    let code = 1;
    try {
        console.log(`[k-mcannon] start ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level} crafting ${bot.stat('crafting').level} smithing ${bot.stat('smithing').level} magic ${bot.stat('magic').level} sharks ${bot.count(SHARK)} coins ${bot.count(objId('coins'))} qp ${qp(bot)}`);
        if (!live) {
            await localSetup(bot, { clear: true });
            const stats = role === 'trainee' ? { crafting: 99, smithing: 99, prayer: 99, hitpoints: 10, magic: 80, agility: 49 }
                : flag('--lowhelper') ? { attack: 48, strength: 40, defence: 40, hitpoints: 44, magic: 1, crafting: 1, smithing: 1 }
                : { crafting: 40, smithing: 40, hitpoints: 30, magic: 45 };
            const items = role === 'trainee' ? MCANNON_SUPPLY
                : walk ? [{ name: 'shark', n: 10 }] : [...MCANNON_SUPPLY, { name: 'shark', n: 6 }];
            await localSetup(bot, { stats, items, tele: { x: 3185, z: 3436 } });
            if (!walk) await mcannonPrep();
            await bot.tick(2);
        }
        {
            const q = await runLeg(bot, `k-mcannon-quest-${role}${walk ? '-walk' : ''}`, b => mcannonQuestLeg(b, { verbose: true, walk, eatAt }));
            console.log(`[k-mcannon] ${role} quest ${q.rec.ticks} ticks ${JSON.stringify(q.rec.result)} sharksLeft=${bot.count(SHARK)} hp=${bot.stat('hitpoints').cur}`);
            code = q.rec.ok ? 0 : 1;
        }
    } catch (e) {
        console.error(`[k-mcannon] ERROR ${(e as Error).message}`);
    } finally {
        try { await bot.logout(); } catch { /* already gone */ }
        console.log(`[k-mcannon] exit ${code}`);
        process.exit(code);
    }
}

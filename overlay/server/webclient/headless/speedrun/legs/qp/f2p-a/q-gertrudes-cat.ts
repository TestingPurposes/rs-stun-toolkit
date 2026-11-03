// q-gertrudes-cat.ts — Gertrude's Cat (quest_fluffs, members), cheat-free. Content: quests/quest_fluffs/scripts/quest_fluffs.rs2,
// configs/quest_fluffs.constant (started 1, paid_boy 2, gave_milk 3, gave_sardine 4, rescued 5),
// areas/area_varrock/scripts/{gertrude,shilop,wilough}.rs2.
//
// Flow:
//  1. Gertrude (npc 780, house W of Varrock (3151,3410)): 6 pages | p_choice3 "Well, I suppose I could." -> %fluffs = 1 +
//     journal colour (gertrude.rs2:105-113). Rest skipped.
//  2. Shilop (781) / Wilough (783), Varrock market (3221,3434): with both boys in view the "secondary" branch runs
//     (quest_fluffs.rs2:34-42, 69-91): "What will make you tell me?" ... p_choice2 "Okay then, I'll pay." -> 100 coins
//     (:93-113) ... "find the broken fence" page -> %fluffs = 2 on its resume.
//  3. Lumber yard NE of Varrock: broken fence loc 2618 (3305,3493) op1 Climb-over from the south (:116-136, members only),
//     ladder 1747 (3310,3509) -> L1. Fluffs (npc 759, L1 (3306,3512)): use bucket_milk (-> %fluffs 3, :200-210), use
//     seasoned_sardine (-> 4 and %fluffs_crate = one of 6 crate coords at random, :211-228).
//  4. Down; search the crate npcs (767 kittens_mew, 6 spawns on L0) nearest-first: the one at %fluffs_crate gives
//     gertrudekittens (:271-279, p_delay(4) per search). The crate is a NON-transmitted varp: search until the kitten shows up.
//  5. Up; use the kitten on Fluffs (:229-249) -> %fluffs = 5 (~8 t of scripted walking).
//  6. Varrock Teleport (law, fire, air from a staff) -> Gertrude: completion pages, if_close, 2x p_delay(3), kitten follower
//     + chocolate cake + stew, queue(fluffs_complete): +1 qp, cooking 15250 tenths base (x25 = 381,250 -> cooking ~70).
// Completion observable: qp +1 (fluffs_complete adds %qp itself, quest_fluffs.rs2:315).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { R, M2, M3, npc, npcsOf, tele, msgsSince, inDialog, type FTok } from '../../q-lib.js';
import { isTileWalkable } from '../../../../../../../sdk/pathfinding';
import { isResuming, journalStage, failHook } from '../journal.js';
/** session 10 resume: the quest JOURNAL (quest_fluffs/scripts/fluffs_journal.rs2) -> %fluffs, first match wins (latest first) */
const GC_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 6], [/She ran off home/i, 5], [/gave the cat milk and sardines/i, 4], [/found the lost cat but it won't come back/i, 3],
    [/go to their play area/i, 2], [/speak to Shilop and Wilough/i, 1],
];
const isWalkable = (t: { x: number; z: number }) => { try { return isTileWalkable(0, t.x, t.z); } catch { return true; } };
import { converse, opLocUntil, mkLog, qp, qStatus, closeChat, pagesUntil, wear, walk, eatWatch, dead, fail, cheb, textSince, snapText, routeNextTo,
    type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: "Gertrude's Cat", dir: 'quest_fluffs', qp: 1 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0,
    skills: { magic: [25, 'Varrock Teleport from the lumber yard back to Gertrude (magic_spells.dbrow levelrequired 25); optional, walks without it'] },
    start: { x: 3152, z: 3409, level: 0 },   // Gertrude's house, W of Varrock (members world: the fence is members-only)
    end: { x: 3151, z: 3410, level: 0 },
};
export const SUPPLY: Item[] = [
    { name: 'coins', n: 100 },                // the boys (quest_fluffs.rs2:101-106)
    { name: 'bucket_milk', n: 1 },            // Fluffs (:200)
    { name: 'seasoned_sardine', n: 1 },       // Fluffs (:211), tradeable: helpered ready-made (raw sardine + doogle leaves)
    { name: 'lawrune', n: 1 }, { name: 'firerune', n: 1 }, { name: 'staff_of_air', n: 1 },   // Varrock Teleport back
];
const GERTRUDE = 780, SHILOP = 781, WILOUGH = 783, FLUFFS = 759, CRATE = 767;
const GERTRUDE_AT = { x: 3151, z: 3410 }, BOYS_AT = { x: 3221, z: 3434 };
const FENCE = { id: 2618, x: 3305, z: 3493 }, LADDER0 = { id: 1747, x: 3310, z: 3509 }, LADDER1 = { id: 1746, x: 3310, z: 3509, level: 1 };
const KITTEN = 'gertrudekittens';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'cat', !!o.log);
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0); }
    finally { stopEat(); }
}

async function body(bot: SpeedBot, L0: (s: string) => void, t0: number, qp0: number): Promise<RunResult> {
    const L = (s: string) => { L0(s); failHook(`gertrude:${s}`); };
    const st = () => qStatus(bot, 'fluffs');
    // session 10: on a retry, the journal stage gates the boys / milk / sardine / kitten steps (GC_RESUME=0 = as before)
    let fs = -1;
    if (isResuming(bot) && process.env.GC_RESUME !== '0') {
        closeChat(bot);
        fs = await journalStage(bot, 'fluffs', GC_STAGES, 0, s => console.log(`[cat] ${s}`));
        console.log(`[cat] resume at stage ${fs} @${JSON.stringify(bot.pos())} milk ${bot.count('bucket_milk')} sardine ${bot.count('seasoned_sardine')} kitten ${bot.count(KITTEN)}`);
        if (fs >= 6) return { ok: true, ticks: bot.tickCount - t0, msg: 'journal: quest complete' };
    }
    const at = (n: number) => fs <= 0 || fs <= n;   // fs <= 0: fresh / not started -> every step as before
    const check = () => { if (dead(bot)) fail(bot, 'died'); };
    if (bot.count('staff_of_air') > 0) await wear(bot, 'staff_of_air', 4);
    const inYard = () => { const t = bot.tile(); return t.x >= 3290 && t.x <= 3320 && t.z >= 3493 && t.z <= 3525; };
    let paid = false, milk = false, sardine = false;

    // 1. Gertrude: start
    if (st() === 'NOT_STARTED' || st() === 'NOT_OBSERVABLE') {
        const ok = await converse(bot, GERTRUDE, {
            plan: [R, R, R, R, R, R, R, R, M3[0]!, R], stand: GERTRUDE_AT, near: 8, label: 'gertrude1', log: L, maxTicks: 120,
            answers: [/^Well, I suppose I could\.$/],
            done: () => st() === 'IN_PROGRESS',
        });
        if (!ok) fail(bot, `Gertrude: not started (${st()})`);
        closeChat(bot);
        L('started');
    }
    // 2. the boys: pay 100 coins; %fluffs = 2 on the resume of the "broken fence" page
    if (at(1) && bot.count('bucket_milk') > 0 && bot.count('seasoned_sardine') > 0 && bot.count(KITTEN) === 0) {
        const c0 = bot.count('coins'), snap = snapText(bot);
        let fenceSeen = false;
        // session 11 fix 260 (GC_BOYS_ROUNDS): qx02m 'boys: not paid' — 5 ops in 30 t, no choice ever shown, no message,
        // both boys within 1 tile in the fail snapshot; the retry paid on its first op. The two-boy check runs at the script's
        // 4th page (npc_find from the TALKING boy, 3 tiles + line of sight) after our pick() saw them together, so a wander in
        // between drops into the choice-less single branch; and an op on a boy who steps the same tick starts nothing. Both
        // only cost an op, so: up to 3 rounds of the same converse, each round from the stand again (a fresh routed approach),
        // with per-round diagnostics (dialog ticks, single/secondary branch text). GC_BOYS_ROUNDS=0 = one round as before.
        let dlgTicks = 0, single = false, secondary = false;
        const rounds = process.env.GC_BOYS_ROUNDS === '0' ? 1 : 3, test = process.env.GC_BOYS_TEST === '1';
        let ok = false;
        for (let r = 0; r < rounds && !ok; r++) {
            if (r > 0) {
                const a = npc(bot, SHILOP), b = npc(bot, WILOUGH);
                L(`boys: round ${r + 1} (dialog ticks ${dlgTicks}, single ${single}, secondary ${secondary}; shilop ${a ? `${a.x},${a.z}` : '-'} wilough ${b ? `${b.x},${b.z}` : '-'} me ${bot.tile().x},${bot.tile().z})`);
                closeChat(bot);
                await walk(bot, BOYS_AT, 1, 'boys stand', 30);
            }
            ok = await converse(bot, [SHILOP, WILOUGH], {
                plan: [R, R, R, R, R, R, M3[1]!, R, R, R, R, R, R, R, R, R, M2[1]!, R, R, R, R, R, R, R],
                stand: BOYS_AT, near: 10, label: 'boys', log: L, maxTicks: test && r === 0 ? 80 : 200, tries: test && r === 0 ? 2 : 5,
                answers: [/^What will make you tell me\?$/, /^Okay then, I'll pay\.$/],
                // only the two-boy branch reaches the bribe: with the other boy NOT within 3 tiles (line of sight) the single-boy
                // branch ends without any choice (quest_fluffs.rs2:38-47; fluffs_boy_single is never reached, a content bug), so
                // talk only while both stand within 3 tiles of each other (fa42 failed on it)
                pick: () => {
                    const a = npc(bot, SHILOP), b = npc(bot, WILOUGH);
                    // TEST (GC_BOYS_TEST=1): round 1 talks only while the boys stand APART (the single branch), rounds 2-3 as normal
                    if (test && r === 0) { if (!a || !b || cheb(a, b) <= 4) return null; return a.d <= b.d ? a : b; }
                    if (!a || !b || cheb(a, b) > 2) return null; return a.d <= b.d ? a : b;
                },
                done: () => {
                    if (inDialog(bot)) dlgTicks++;
                    if (!single && textSince(bot, snap, /my secret play area/)) single = true;
                    if (!secondary && textSince(bot, snap, /our secret play area/)) secondary = true;
                    if (textSince(bot, snap, /broken fence/)) fenceSeen = true;
                    return fenceSeen && bot.count('coins') <= c0 - 100 && bot.chatModalId === -1;
                },
            });
        }
        if (!ok) fail(bot, `boys: not paid (coins ${c0} -> ${bot.count('coins')}, fence page ${fenceSeen}, dialog ticks ${dlgTicks}, single ${single}, secondary ${secondary})`);
        paid = true;
        L('paid');
    }
    check();
    // 3. into the lumber yard (broken fence from the south), up the mill ladder to Fluffs
    if (at(4) && !inYard() && bot.minusedlevel === 0) {
        await walk(bot, { x: FENCE.x, z: FENCE.z - 1 }, 0, 'broken fence', 800);
        if (!(await opLocUntil(bot, FENCE, 1, () => bot.tile().z >= FENCE.z, 40, { x: FENCE.x, z: FENCE.z - 1 }))) fail(bot, 'broken fence');
        L('in the yard');
    }
    const upToFluffs = async () => {
        if (bot.minusedlevel === 0 && !(await opLocUntil(bot, LADDER0, 1, () => bot.minusedlevel === 1, 120))) fail(bot, 'mill ladder up');
    };
    const useOnFluffs = async (item: string, done: () => boolean, label: string) => {
        for (let k = 0; k < 6 && !done(); k++) {
            const f = npc(bot, FLUFFS); if (!f) { await bot.tick(1); continue; }
            const id = objId(item), slot = bot.slot(id); if (slot < 0) fail(bot, `${label}: ${item} not held`);
            closeChat(bot); routeNextTo(bot, f); bot.useItemOnNpc(f.idx, id, slot); bot.queueFlush();
            await bot.until(done, 8);
        }
        if (!done()) fail(bot, `${label}: no effect`);
        L(label);
    };
    if (at(4) && bot.count(KITTEN) === 0) {
        if (at(3)) {
        await upToFluffs();
        if (at(2)) await useOnFluffs('bucket_milk', () => bot.count('bucket_milk') === 0, 'milk');
        milk = true;
        await useOnFluffs('seasoned_sardine', () => bot.count('seasoned_sardine') === 0, 'sardine');
        sardine = true;
        }
        // 4. the kitten: search the crate npcs on L0, nearest first
        if ((fs <= 0 || bot.minusedlevel === 1) && !(await opLocUntil(bot, LADDER1, 1, () => bot.minusedlevel === 0, 40))) fail(bot, 'mill ladder down');
        // The six crate npcs answer only from ONE side ("I can't reach that!" from the others; a diagonal stand does nothing).
        // Stands measured in the sim (fa39/fa40, probe-npcop.ts); order = the brute-forced minimum of the expected time to
        // the kitten for a uniformly random crate over planner path lengths (probe-tour.ts: 30.8 t expected vs 33.0 for the
        // clockwise tour). A crate counts as searched on its "You find nothing."; other sides are tried as a fallback.
        const TOUR = [
            { c: { x: 3307, z: 3507 }, st: { x: 3307, z: 3508 } }, { c: { x: 3303, z: 3506 }, st: { x: 3304, z: 3506 } },
            { c: { x: 3305, z: 3500 }, st: { x: 3306, z: 3500 } }, { c: { x: 3310, z: 3499 }, st: { x: 3311, z: 3499 } },
            { c: { x: 3311, z: 3511 }, st: { x: 3312, z: 3511 } }, { c: { x: 3298, z: 3514 }, st: { x: 3298, z: 3513 } },
        ];
        for (const { c: cc, st: st0 } of TOUR) {
            for (let n = 0; n < 4 && bot.count(KITTEN) === 0; n++) {
                const c = npcsOf(bot, CRATE).find(q => q.x === cc.x && q.z === cc.z);
                if (!c) { L(`crate (${cc.x},${cc.z}) not visible`); await walk(bot, st0, 2, 'crate', 60); continue; }
                const st = n === 0 ? st0 : [[0, -1], [1, 0], [-1, 0], [0, 1]].map(([dx, dz]) => ({ x: c.x + dx!, z: c.z + dz! })).filter(isWalkable)[n - 1];
                if (st && cheb(st, bot.tile()) > 0) await bot.walkTo(st.x, st.z, { near: 0, maxTicks: 60, log: false, closeDoors: true });
                const since = bot.tickCount;
                closeChat(bot); bot.opNpc(c.idx, 1); bot.queueFlush();
                // "You search the crate." then p_delay(4): "You find nothing." or the "You find a kitten!" mesbox, which must be
                // continued (the kitten is added after it, quest_fluffs.rs2:275-276)
                const started = await bot.until(() => bot.count(KITTEN) > 0 || msgsSince(bot, since).some(t => /You search the crate/.test(t)), 6);
                if (started) await bot.until(() => { if (bot.chatModalId !== -1 && bot.count(KITTEN) === 0) { bot.resumeDialogPage(); bot.queueFlush(); } return bot.count(KITTEN) > 0 || msgsSince(bot, since).some(t => /You find nothing/.test(t)); }, 12);
                const nothing = msgsSince(bot, since).some(t => /You find nothing/.test(t));
                L(`crate (${c.x},${c.z}) try ${n + 1}: ${bot.count(KITTEN) > 0 ? 'KITTEN' : nothing ? 'nothing' : 'no search'} at ${JSON.stringify(bot.tile())}`);
                if (nothing) break;
            }
            if (bot.count(KITTEN) > 0) break;
        }
        if (bot.count(KITTEN) === 0) fail(bot, 'no kitten in any crate');
        closeChat(bot);
    }
    // 5. kitten to Fluffs
    if (st() !== 'COMPLETE' && at(4)) {
        await upToFluffs();
        const fl0 = bot.tickCount;
        await useOnFluffs(KITTEN, () => bot.count(KITTEN) === 0, 'kitten given');
        // the scripted walk-off (~8 t) ends in the "Fluffs has run off home" mesbox: %fluffs = 5 just before it
        await bot.until(() => msgsSince(bot, fl0).length > 0 || bot.chatModalId !== -1, 16);
        await bot.until(() => bot.chatModalId !== -1, 12);
        L('rescued');
    }
    check();
    // 6. back to Gertrude: Varrock Teleport if possible
    closeChat(bot);
    if (!process.env.FA_NOTELE && bot.stat('magic').level >= 25 && bot.count('lawrune') >= 1 && bot.count('firerune') >= 1 && (bot.isWorn(objId('staff_of_air')) || bot.count('airrune') >= 3)) {
        const r = await tele(bot, 'varrock_teleport'); L(`varrock teleport ${r.ok}`);
    }
    if (bot.minusedlevel === 1) { if (!(await opLocUntil(bot, LADDER1, 1, () => bot.minusedlevel === 0, 40))) fail(bot, 'mill ladder down (walk back)'); }
    if (inYard()) {   // no teleport: back over the fence from the north
        await walk(bot, { x: FENCE.x, z: FENCE.z }, 0, 'fence (inside)', 200);
        if (!(await opLocUntil(bot, FENCE, 1, () => bot.tile().z < FENCE.z, 40, { x: FENCE.x, z: FENCE.z }))) fail(bot, 'broken fence out');
    }
    const done = () => qp(bot) > qp0;
    // after "Gertrude gives you a kitten." the script closes the page and runs 2x p_delay(3) before the completion queue:
    // do not re-talk during that window (a new conversation would hold the queue)
    const snapG = snapText(bot); let givenTick = -1;
    const ok = await converse(bot, GERTRUDE, {
        plan: [R, R, R, R, R, R, R, R, R, R, R], stand: GERTRUDE_AT, near: 8, label: 'gertrude2', log: L, maxTicks: 400,
        answers: [], done,
        wait: () => { if (givenTick < 0 && textSince(bot, snapG, /gives you a kitten/)) givenTick = bot.tickCount; return givenTick >= 0 && bot.tickCount - givenTick < 14; },
    });
    if (!ok) { await pagesUntil(bot, done, 20); if (!done()) fail(bot, 'Gertrude: no quest complete'); }
    closeChat(bot);
    void paid; void milk; void sardine;
    return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}, cooking ${bot.stat('cooking').level}` };
}

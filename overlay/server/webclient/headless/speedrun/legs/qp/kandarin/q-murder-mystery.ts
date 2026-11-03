// q-murder-mystery.ts — Murder Mystery (3 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// The culprit is random per account (%murdersus = random_range(1,6), quests/quest_murder/scripts/murder_guard.rs2:1-15)
// and not transmitted; it is deduced from observables:
//   - the window thread (loc 2666, 2747,3577) is green for Anna/David, red for Bob/Carol, blue for Elizabeth/Frank
//     (quest_murder.rs2:228-256);
//   - the fingerprint test picks between the two: flour (pot from the flour barrel 2735,3582) on the murder weapon
//     (obj 2746,3578) and flypaper (sacks 2731,3582) on the dusted weapon give the murderer's prints; the same on a
//     suspect's item (barrels a-f) gives theirs; using it on the murderer's prints either matches ("exact match": evidence
//     bit 2) or destroys it (quest_murder.rs2:177-215,292-337, dough.rs2:1-3).
// Then: the poison salesman (820, Seers) "Who did you sell Poison to at the house?" (poison_salesman.rs2), the culprit
// "Why'd you buy poison the other day?" (e.g. anna.rs2:33-39), searching the culprit's own spot (compost / beehive /
// drain / loc_2653 / fountain / sign, quest_murder.rs2:1-104) -> poison proof. With thread + prints + poison proof the
// guard's "I know who did it!" is the conclusive proof -> complete (murder_guard.rs2:40-41,132-150).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { nav, inDialog, locAt, qp, tele } from '../../q-lib.js';
import { failHook } from '../journal.js';
import { runQuest, talkNpc, chat, heard, fail, opLocUntil, findLoc, pickup, walk, WALK_LEARN, type Item, type RunResult } from './ka-lib.js';

export const QUEST = { name: 'Murder Mystery', dir: 'quest_murder', qp: 3 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // none checked
    start: { x: 2741, z: 3571, level: 0 },   // outside the Sinclair Mansion front door
    end: { x: 2739, z: 3577, level: 0 },     // the guard
};
export const SUPPLY: Item[] = [{ name: 'pot_empty', n: 3 }];   // flour x3 in one barrel visit (weapon + up to 2 suspects)

type Sus = { name: string; npc: number; npcAt: { x: number; z: number; level: number }; barrel: [number, number, number, number]; item: string; dust: string; print: string; thread: string; spot: [number, number, number, number]; proof: RegExp };
// loc arrays: [id, x, z, level] (maps/*.jm2); npc spawns from the same maps
const SUSPECTS: Sus[] = [
    { name: 'Anna', npc: 814, npcAt: { x: 2734, z: 3575, level: 0 }, barrel: [2656, 2733, 3575, 0], item: 'murdernecklace', dust: 'murdernecklacedust', print: 'murderfingerprinta', thread: 'murderthreadg', spot: [2650, 2730, 3572, 0], proof: /teeming with maggots/ },
    { name: 'Bob', npc: 815, npcAt: { x: 2748, z: 3559, level: 0 }, barrel: [2657, 2733, 3578, 0], item: 'murdercup', dust: 'murdercupdust', print: 'murderfingerprintb', thread: 'murderthreadr', spot: [2651, 2730, 3559, 0], proof: /buzzes with activity/ },
    { name: 'Carol', npc: 816, npcAt: { x: 2734, z: 3581, level: 1 }, barrel: [2658, 2733, 3581, 1], item: 'murderbottle', dust: 'murderbottledust', print: 'murderfingerprintc', thread: 'murderthreadr', spot: [2652, 2736, 3573, 0], proof: /totally blocked/ },
    { name: 'David', npc: 817, npcAt: { x: 2739, z: 3581, level: 0 }, barrel: [2659, 2733, 3578, 1], item: 'murderbook', dust: 'murderbookdust', print: 'murderfingerprintd', thread: 'murderthreadg', spot: [2653, 2740, 3574, 1], proof: /spiders' nest/ },
    { name: 'Elizabeth', npc: 818, npcAt: { x: 2746, z: 3581, level: 1 }, barrel: [2660, 2747, 3581, 1], item: 'murderneedle', dust: 'murderneedledust', print: 'murderfingerprinte', thread: 'murderthreadb', spot: [2654, 2747, 3563, 0], proof: /swarming with mosquitos/ },
    { name: 'Frank', npc: 819, npcAt: { x: 2742, z: 3577, level: 0 }, barrel: [2661, 2747, 3577, 1], item: 'murderpot', dust: 'murderpotdust', print: 'murderfingerprintf', thread: 'murderthreadb', spot: [2655, 2746, 3573, 0], proof: /very dirty|under all of the grime/ },
];
const GUARD = 812, SALESMAN = 820;
const LADDER0 = { id: 1747, x: 2737, z: 3582 }, LADDER1 = { id: 1746, x: 2737, z: 3582 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    // (A/B: the stuck-step learner OFF here measured 4/6 complete and +130 t slower than ON: kept ON)
    try { return await runQuest(bot, QUEST, async st => {
        await nav();
        if (bot.free() < 6) fail(bot, `need 6 free slots, have ${bot.free()}`);
        const has = (n: string) => bot.count(n) > 0;
        const toLevel = async (lv: number) => {
            if (bot.minusedlevel === lv) return;
            const l = lv === 1 ? locAt(LADDER0.id, LADDER0.x, LADDER0.z, 0) : locAt(LADDER1.id, LADDER1.x, LADDER1.z, 1);
            // TEST: MM_LADDER_TEST=1 skips the first ladder-down attempt (as if it failed) to exercise 306a
            const test = process.env.MM_LADDER_TEST === '1' && lv === 0 && !(globalThis as any).__mmLadderTest;
            if (test) { (globalThis as any).__mmLadderTest = 1; console.log('[murder] 306a TEST: the ladder down is treated as failed'); }
            if (!test && await opLocR(l, 1, () => bot.minusedlevel === lv, { maxTicks: 80 })) return;
            // session 11 fix 306a (MM_LADDER_TELE; qx61p 'mansion ladder to L0 at (2739,3580,L1)': 3 rounds x 80 t, the bot never
            // moved off (2739,3580); before that ~400 t of blocked L1 steps: (2737,3578)->(2737,3579), (2738,3577)->(2737,3577),
            // walkOp 'no route' to Elizabeth, and walkOp's own recovery 'closed an open door/gate next to us' at (2738,3577), next
            // to door 1533 (2739,3578). The way to the ladder is that door, the corridor z 3577 and the 1-tile column x 2737
            // (navgrid: 2739,3577 2737,3577 2737,3581). INFERRED: a chaos/self-closed door or a servant parked in the column;
            // not reproduced in the fork). Down from L1 any way at all: Camelot teleport (magic 45, 1 law, 5 air; the quest
            // goes on at L0: salesman, the culprit's spot, the guard), the walk back is ~50 t. =0 reverts.
            if (lv === 0 && bot.minusedlevel === 1 && process.env.MM_LADDER_TELE !== '0' && bot.stat('magic').cur >= 45
                && bot.count('lawrune') >= 1 && bot.count('airrune') >= 5) {
                const r = await tele(bot, 'camelot_teleport');
                console.log(`[murder] 306a ladder down failed at (${bot.tile().x},${bot.tile().z}): Camelot teleport ${r.ok} (${r.ticks} t)`);
                if (r.ok && (bot.minusedlevel as number) === 0) return;
            }
            fail(bot, `mansion ladder to L${lv}`);
        };
        /** opLocUntil with recovery: the mansion's doors/servants sometimes wedge a walk (about 1 run in 3 sat at
         *  (2733,3581) or (2738,3581)); step back to the hall (2738,3578), or the lawn, and try again */
        const opLocR = async (loc: Parameters<typeof opLocUntil>[1], op: number, done: () => boolean, o: Parameters<typeof opLocUntil>[4] = {}) => {
            for (let k = 0; k < 3; k++) {
                if (await opLocUntil(bot, loc, op, done, o)) return true;
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
                const back = k === 0 ? { x: 2738, z: 3578 } : { x: 2740, z: 3570 };
                if (bot.minusedlevel === 0) await walk(bot, back, null, () => false, { near: 1, maxTicks: 60 });
                // route session 5 (allchaos: doors random + flipping; qscp sat at (2738,3581) through all 3 ladder retries): close an
                // open leaf next to us
                // (NOT a core walkTo to the loc: qsfp's walkTo to the barrel tile (2731,3582) wedged, fell back to the LeanBot
                // traveller and planMultiLevel spun the event loop for 184 s: watchdog kill)
                try { if (await bot.closeBlockingDoor()) await bot.tick(2); } catch { /* best effort */ }
                console.log(`[murder] retry ${k + 1} for loc ${loc.id} from ${JSON.stringify(bot.pos())}`);
            }
            return done();
        };
        /** use a on b (OPHELDU); the engine tries both orders (OpHeldUHandler), so one order is enough */
        const combine = async (a: string, b: string, done: () => boolean) => {
            for (let k = 0; k < 3 && !done(); k++) {
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
                if (!has(a) || !has(b)) return done();
                bot.useItemOnItem(objId(b), bot.slot(b), objId(a), bot.slot(a)); bot.queueFlush();
                // a mismatch shows a mesbox BEFORE the print is destroyed (quest_murder.rs2:334-336): continue pages
                await bot.until(() => { if (bot.chatModalId !== -1 && !bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); } return done(); }, 6);
            }
            return done();
        };
        const flour = async () => {
            if (has('pot_flour')) return;
            await toLevel(0);
            const fb = locAt(2662, 2735, 3582, 0);
            // the kitchen side of the barrel, through the kitchen door (2735,3581): km31/35/36/41/43 sat at (2736,3580)
            if (!(await opLocR(fb, 2, () => has('pot_flour'), { maxTicks: 150, stand: { x: 2735, z: 3581 } }))) fail(bot, 'flour');
            for (let k = 0; k < 4 && has('pot_empty'); k++) { const n0 = bot.count('pot_flour'); bot.opLoc(fb.x, fb.z, fb.id, 2); bot.queueFlush(); await bot.until(() => bot.count('pot_flour') > n0, 4); }
        };
        const flypaper = async () => {
            if (has('murderpaper')) return;
            await toLevel(0);
            const sacks = locAt(2663, 2731, 3582, 0);
            // the sacks fill a closet entered by its door (2731,3580): stand inside it
            if (!(await opLocR(sacks, 2, () => inDialog(bot) || has('murderpaper'), { maxTicks: 150, stand: { x: 2731, z: 3581 } }))) fail(bot, 'sacks');
            await chat(bot, [/^Yes, it might be useful/], () => has('murderpaper') && !inDialog(bot), { label: 'sacks', maxTicks: 20 });
            for (let k = 0; k < 4 && bot.count('murderpaper') < 3; k++) {   // 3 papers in one visit (weapon + up to 2 suspects)
                const n0 = bot.count('murderpaper'); bot.opLoc(sacks.x, sacks.z, sacks.id, 2); bot.queueFlush();
                await bot.until(() => inDialog(bot), 4);
                await chat(bot, [/^Yes, it might be useful/], () => bot.count('murderpaper') > n0 && !inDialog(bot), { label: 'sacks+', maxTicks: 12 });
            }
            if (!has('murderpaper')) fail(bot, 'flypaper');
        };
        // 1. guard: start
        let t = bot.tickCount;
        // session 8 (allchaos qt44p: 'mansion ladder to L0' at L1, then the retry died at 'guard start': the guard offers "I
        // know who did it!" once the quest runs): a retry that already holds a clue (thread / weapon / prints) skips the start;
        // the later steps already check what is held. MM_RESUME=0 reverts.
        const begun = process.env.MM_RESUME !== '0' && ['murderthreadg', 'murderthreadr', 'murderthreadb', 'murderweapon', 'murderweapondust', 'murderfingerprint1', 'murderfingerprint'].some(n => has(n));
        if (begun) console.log(`[murder] resume: clues held, the guard start is skipped`);
        else if (!(await talkNpc(bot, GUARD, { x: 2739, z: 3577 }, [/^Sure, I'll help/], () => heard(bot, /every murder leaves clues/, t), { label: 'guard1', maxTicks: 200 }))) fail(bot, 'guard start');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        st.at('started');
        // 2. thread (window) and the murder weapon (study)
        const win = locAt(2666, 2747, 3577, 0);
        const thread = () => ['murderthreadg', 'murderthreadr', 'murderthreadb'].find(n => has(n)) ?? null;
        // the window is the study's south wall: investigate it from inside the study
        // (via the hall: from the front lawn the planner takes the study door, which does not open; km3/km4 sat 370 t)
        if (bot.tile().z < 3576) await walk(bot, { x: 2738, z: 3578 }, null, () => false, { near: 1, maxTicks: 120 });
        if (!thread() && !(await opLocUntil(bot, win, 2, () => !!thread(), { maxTicks: 80, every: 8, stand: { x: 2747, z: 3578 } }))) fail(bot, 'thread');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        const cands = SUSPECTS.filter(s => s.thread === thread());
        st.at(`thread-${thread()}`);
        if (!has('murderweapon') && !has('murderweapondust') && !has('murderfingerprint1')) {
            if (!(await pickup(bot, 'murderweapon', { x: 2746, z: 3578 }))) fail(bot, 'murder weapon');
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        }
        // 3. the murderer's prints from the weapon
        if (!has('murderfingerprint1') && !has('murderfingerprint')) {
            await flour();
            if (!(await combine('pot_flour', 'murderweapon', () => has('murderweapondust')))) fail(bot, 'dust the weapon');
            await flypaper();
            if (!(await combine('murderpaper', 'murderweapondust', () => has('murderfingerprint1')))) fail(bot, 'weapon prints');
        }
        st.at('weapon-prints');
        // 4. the two candidates' items: dust, lift, compare
        let culprit: Sus | null = null;
        // session 11 fix 306b (MM_PRINT_HELD; qx61p retry: 'no fingerprint match among Elizabeth/Frank' in 7 t, holding
        // murderfingerprint + murderfingerprinte): a retry that already made the match broke out of the loop below before
        // naming the culprit (CONFIRMED in the code: `if (has('murderfingerprint')) break;` precedes `culprit = c`). A match
        // keeps the suspect's print, a mismatch destroys it (check_murderer_print, quest_murder.rs2:330-342): with the match
        // held, the culprit is the candidate whose print is still held. =0 reverts.
        if (process.env.MM_PRINT_HELD !== '0' && has('murderfingerprint')) {
            culprit = cands.find(c => has(c.print)) ?? null;
            console.log(`[murder] 306b match already held: culprit ${culprit?.name ?? '(no suspect print held)'}`);
        }
        for (const c of cands) {
            if (has('murderfingerprint')) break;
            if (!has(c.item) && !has(c.dust) && !has(c.print)) {
                await toLevel(c.barrel[3]);
                const b = findLoc(c.barrel[0], c.barrel[1], c.barrel[2], c.barrel[3]);
                if (!(await opLocR(b, 2, () => has(c.item), { maxTicks: 200, every: 8 }))) fail(bot, `${c.name}'s item`);
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            }
            if (!has(c.print)) {
                if (!has(c.dust)) { await flour(); if (!(await combine('pot_flour', c.item, () => has(c.dust)))) fail(bot, `dust ${c.name}'s item`); }
                await flypaper();
                if (!(await combine('murderpaper', c.dust, () => has(c.print)))) fail(bot, `${c.name}'s prints`);
            }
            if (!(await combine(c.print, 'murderfingerprint1', () => has('murderfingerprint') || !has(c.print)))) fail(bot, `compare ${c.name}`);
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            if (has('murderfingerprint')) culprit = c;
        }
        if (!culprit) fail(bot, `no fingerprint match among ${cands.map(c => c.name).join('/')}`);
        st.at(`culprit-${culprit!.name}`);
        failHook('murder:culprit');   // TEST (306b): SR_FAIL_AT=murder:culprit -> the retry holds the match
        // 5. the poison salesman (Seers)
        await toLevel(0);
        t = bot.tickCount;
        if (!(await talkNpc(bot, SALESMAN, { x: 2737, z: 3491 }, [/^Who did you sell Poison to at the house/], () => heard(bot, /bought the last of my supplies/, t), { label: 'salesman', maxTicks: 300 }))) fail(bot, 'poison salesman');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        st.at('salesman');
        // 6. the culprit about the poison, then their spot
        const c = culprit!;
        await toLevel(c.npcAt.level);
        t = bot.tickCount;
        if (!(await talkNpc(bot, c.npc, c.npcAt, [/^Why'd you buy poison the other day/], () => heard(bot, /Why'd you buy poison the other day/, t) && !inDialog(bot), { label: `talk-${c.name}`, maxTicks: 300, closedTicks: 3 }))) fail(bot, `${c.name} about the poison`);
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        await toLevel(c.spot[3]);
        const spot = findLoc(c.spot[0], c.spot[1], c.spot[2], c.spot[3]);
        t = bot.tickCount;
        // the culprit's spot shows the poison was never used there (quest_murder.rs2:1-104)
        // route session 5 (allchaos 'David's spot' x2, qsbp/qsdp): with opLocR's door recovery
        if (!(await opLocR(spot, 2, () => heard(bot, c.proof, t), { maxTicks: 120, every: 8 }))) fail(bot, `${c.name}'s spot`);
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        st.at('poison-proof');
        // 7. guard: conclusive proof
        await toLevel(0);
        const qp0 = qp(bot);
        if (!(await talkNpc(bot, GUARD, { x: 2739, z: 3577 }, [/^I know who did it/], () => qp(bot) >= qp0 + QUEST.qp, { label: 'guard2', maxTicks: 200, closedTicks: 8 }))) fail(bot, 'guard: conclusive proof');
        st.at('done');
    }, o.log !== false); } finally { WALK_LEARN.on = true; }
}

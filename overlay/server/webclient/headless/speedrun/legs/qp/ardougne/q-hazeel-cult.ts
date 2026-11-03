// q-hazeel-cult.ts — Hazeel Cult (quest_hazeelcult), GOOD (Carnillean) side, cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/quests/quest_hazeelcult/scripts/): quest_hazeelcult.rs2, ceril_carnillean.rs2,
// clivet.rs2, alomone.rs2. Stage varp %hazeelcultquest (quest_hazeelcult.constant:1-7; complete = 9,
// general/configs/quest.constant:31), side %hazeelcult_side (0 good), valves %hazeelcult_valves; none transmitted.
// Side choice: the good side is 1 cave trip (Clivet, raft, Alomone, raft back) vs 3 on the evil side (kitchen poison,
//   Alomone twice, the second-floor chest); same reward (quest_hazeelcult.rs2:169-175). Good side costs one cl 13 fight.
// Flow (file:line):
//   Ceril (2565,3271) "What's wrong?" / "Yes, of course, I'd be happy to help."           -> started (2)  ceril_carnillean.rs2:1-30
//   valves v2 (2572,3263) R, v1 (2562,3247) R, v3 (2585,3245) L, v4 (2597,3263) R, v5 (2609,3243) R: op2 Turn-right sets the
//     bit on 1,2,4,5, op1 Turn-left on 3 (quest_hazeelcult.rs2:55-70); no stage check, never reset
//   cave (2585,3233) -> (2570,9682); Clivet (2566,9683) "What do you mean?" / "You're crazy, I'd never help you." -> good
//     side, clivet_decision (4); Clivet despawns                                          clivet.rs2:5-19,100-132
//   raft (2567,9679): all 5 valve bits -> (2606,9692) (quest_hazeelcult.rs2:11-40)
//   kill Alomone (2609,9670, cl 13, 25 hp) -> Carnillean armour dropped at his tile        -> finished_side_task (6) alomone.rs2:100-122
//   any other raft (2606,9693) -> back to (2567,9680); stairs (2570,9683) -> (2587,3237)
//   mansion stairs (2568,3268) -> L1; Ceril on L1 (2573,3268) takes the armour (the ground-floor Ceril only says "Come
//     with me upstairs!", ceril_carnillean.rs2:108-118)                                   -> given_armour (7) + 5 coins
//   cupboard (2573,3267,1): Open, Search with Ceril AND Jones within 6 -> reveal          -> complete    quest_hazeelcult.rs2:81-124
//   Reward: thieving 15,000 tenths, 2000 coins (quest_hazeelcult.rs2:169-175).
import { SpeedBot, cheb } from '../../../core.js';
import { qp, inDialog, dismiss, nav, trace, npc, opNpcGo, type Tile } from '../../q-lib.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, opLocUntil, pickup, textWatch, deathWatch, walkLive, walkShort, allText, StepError } from './ar-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Hazeel Cult', dir: 'quest_hazeelcult', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // no skill checks; one cl 13 fight (Alomone)
    start: { x: 2566, z: 3269, level: 0 },              // next to Sir Ceril, Carnillean mansion ground floor
    end: { x: 2573, z: 3268, level: 1 },
};
export const SUPPLY: Item[] = [];

const CERIL = 885, CLIVET = 893, ALOMONE = 891;
const CERIL_AT = { x: 2565, z: 3271 }, CERIL1_AT = { x: 2573, z: 3268 }, CLIVET_AT = { x: 2566, z: 9683 }, ALOMONE_AT = { x: 2609, z: 9670 };
/** [loc, op]: op2 = Turn-right, op1 = Turn-left (valve 3) */
const VALVES: Array<[{ id: number; x: number; z: number }, number]> = [
    [{ id: 2845, x: 2572, z: 3263 }, 2], [{ id: 2844, x: 2562, z: 3247 }, 2], [{ id: 2846, x: 2585, z: 3245 }, 1],
    [{ id: 2847, x: 2597, z: 3263 }, 2], [{ id: 2848, x: 2609, z: 3243 }, 2],
];
const CAVE = { id: 2852, x: 2585, z: 3233 }, CAVE_STAIRS = { id: 2853, x: 2570, z: 9683 };
const RAFT_START = { id: 2849, x: 2567, z: 9679 }, RAFT_END = { id: 2849, x: 2606, z: 9693 };
const MANSION_STAIRS = { id: 1722, x: 2568, z: 3268 }, CUPBOARD = { id: 2850, x: 2573, z: 3267, level: 1 }, CUPBOARD_OPEN = 2851;
/** cupboard: length 2, angle 3, forceapproach=east (quest_hazeelcult.loc:59-66) -> rotated: approach from the NORTH */
const CUPBOARD_STAND = { x: 2573, z: 3268 };

const under = (b: SpeedBot) => b.tile().z > 9000;
const atCultEnd = (b: SpeedBot) => { const t = b.tile(); return under(b) && t.x >= 2595 && t.z <= 9700 && t.z >= 9660; };

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

/** session 10 resume: the quest JOURNAL (quest_hazeelcult/scripts/hazeelcult_journal.rs2, good side) -> %hazeelcultquest,
 *  first match wins (latest first) */
const HZ_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 9], [/find some\s+evidence\s+linking\s+Butler Jones/i, 7], [/return\s+Ceril's armour\s+and tell him/i, 6],
    [/jumped onto a\s+raft/i, 4], [/Obviously, I refused\.?\s+I was still no closer/i, 3], [/live in a cave\s+South/i, 2],
];

async function body(c: Ctx, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(`hazeel:${label}`); };
    // session 10: on a retry, resume at the stage the journal shows (HZ_RESUME=0 = always from the top)
    let st = 0;
    if (isResuming(bot) && process.env.HZ_RESUME !== '0') {
        dismiss(bot);
        st = await journalStage(bot, 'hazeelcult', HZ_STAGES, 0, s => console.log(`[hazeel] ${s}`));
        console.log(`[hazeel] resume at stage ${st} @${JSON.stringify(bot.pos())} armour ${bot.count('carnillean_armour')}`);
        if (st >= 9) return;
    }
    const R = st > 0;

    if (st <= 0) {
    // 1. Ceril: start
    const started = textWatch(bot, /cooks an excellent broth|I'll see what I can do/i);
    need(await talkTo(c, CERIL, CERIL_AT, [/^What's wrong\?$/, /^Yes, of course, I'd be happy to help\.$/], () => started(), { label: 'ceril-start' }), 'ceril-start');
    dismiss(bot);
    }
    // 2. the five valves (each turn shows a mesbox; the bit is set before it; never reset, so a resume past stage 2 skips them)
    if (st <= 2 && !under(bot)) for (const [v, op] of VALVES) {
        // every valve shows the SAME mesbox text, so watch for that box to (re)open after we closed the previous one
        const re = op === 2 ? /turn the large metal valve to the right/i : /turn the large metal valve to the left/i;
        dismiss(bot);
        let closed = false;
        const turned = () => { if (bot.chatModalId === -1) closed = true; return closed && bot.chatModalId !== -1 && re.test(allText(bot)); };
        need(await opLocUntil(c, v, op, turned, { label: `valve-${v.id}`, maxTicks: 2 }), `valve-${v.id}`);
        dismiss(bot);
    }
    if (st <= 4 || (R && st === 6 && !bot.count('carnillean_armour') && under(bot))) {
    // 3. cave, Clivet (good side)
    if (!R || !under(bot)) need(await opLocUntil(c, CAVE, 1, () => under(bot), { label: 'cave' }), 'cave');
    if (st <= 3) {
    const fool = textWatch(bot, /jumps onto the raft|You'll never find us/i);
    need(await talkTo(c, CLIVET, CLIVET_AT, [/^What do you mean\?$/, /^You're crazy, I'd never help you\.$/], () => fool(), { label: 'clivet' }), 'clivet');
    dismiss(bot);
    }
    // 4. raft to the cult's end, kill Alomone, take the armour
    if (!R || !atCultEnd(bot)) need(await opLocUntil(c, RAFT_START, 1, () => atCultEnd(bot), { label: 'raft-in', answers: [/.*/], stand: { x: 2568, z: 9680 } }), 'raft-in');   // raft: length 2, over water (quest_hazeelcult.loc:51-57); rsmod reach is wrong from 2 tiles south
    dismiss(bot);
    let last: Tile = ALOMONE_AT, seen = false, lastOp = -10;
    for (let k = 0; k < 300 && !bot.count('carnillean_armour'); k++) {
        if (dead()) fail(c, 'alomone (DIED)');
        const a = npc(bot, ALOMONE);
        if (a) {
            seen = true; last = { x: a.x, z: a.z };
            if (bot.tickCount - lastOp >= 4) { dismiss(bot); opNpcGo(bot, a, 2); lastOp = bot.tickCount; }
            await bot.tick(1);
            continue;
        }
        if (!seen) {   // not in view yet (the npc list fills a tick or two after the raft's teleport): go to his spot
            if (cheb(bot.tile(), ALOMONE_AT) > 3) await walkLive(bot, ALOMONE_AT, { near: 3, maxTicks: 40, done: () => !!npc(bot, ALOMONE) });
            else await bot.tick(1);
            continue;
        }
        // seen and gone: dead; the armour lies on his last tile (obj_add(npc_coord), alomone.rs2:118)
        if (await pickup(c, 'carnillean_armour', last)) break;
        seen = false;   // not there (respawned elsewhere / another player's kill): fight again
    }
    need(bot.count('carnillean_armour') > 0, 'armour');
    }
    if (st <= 6) {
    // 5. back: raft, cave stairs, mansion stairs, Ceril on L1
    if (!R || atCultEnd(bot)) need(await opLocUntil(c, RAFT_END, 1, () => under(bot) && bot.tile().x < 2575, { label: 'raft-out', answers: [/.*/] }), 'raft-out');
    dismiss(bot);
    if (!R || under(bot)) need(await opLocUntil(c, CAVE_STAIRS, 1, () => !under(bot), { label: 'cave-up' }), 'cave-up');
    }
    if (st <= 7 && bot.minusedlevel === 0) {
    // route session 5 (allchaos qsbm/qsem 'mansion-up' 356-387 t; reproduced by route/probe-hazdoor.ts: with the entrance
    // double door 1533 open its leaves stand on (2568/2569,3271) and the stairs op from the doorway is discarded; from
    // (2568,3270), one tile inside, it climbs at once): walk in first
    // (only when a leaf is open on the doorway: the pre-walk costs ~85 t in a normal world, 132 vs 47 t cave-up -> mansion-up)
    const leafOpen = () => [2568, 2569].some(x => bot.liveLocs.get(`0,${x},3271`) === 1534);
    // (PAUSED item 5b): the bot's own exit leaves leaf 1534 on (2568,3271) open, so the pre-walk fired every run
    // (+55-70 t; measured fork gha: the walk itself ended ON the doorway, 71 t, then the op climbed anyway: 257 vs 221 t with
    // HZ_PREWALK=0). Now REACTIVE: one plain op first; the remedy (close the leaf, walk one tile inside) only when that op
    // did not climb. HZ_PREWALK=always = the old pre-walk, HZ_PREWALK=0 = never.
    const PW = process.env.HZ_PREWALK ?? 'react';
    const prewalk = async (why: string) => {
        const pw0 = bot.tickCount, leaf0 = [2568, 2569].filter(x => bot.liveLocs.get(`0,${x},3271`) === 1534);
        if (why === 'stalled') { try { if (await bot.closeBlockingDoor()) await bot.tick(2); } catch { /* none */ } }
        for (let k = 0; k < 2 && (why === 'stalled' || leafOpen()) && bot.minusedlevel === 0 && cheb(bot.tile(), { x: 2568, z: 3270 }) > 0; k++) await bot.walkTo(2568, 3270, { near: 0, closeDoors: true, maxTicks: 150, log: false });
        console.log(`[hazeel] prewalk (${why}) ${bot.tickCount - pw0} t (leaves open ${JSON.stringify(leaf0)}) at ${JSON.stringify(bot.tile())}`);
    };
    if (PW === 'always') await prewalk('always');
    else if (PW !== '0' && !(await opLocUntil(c, MANSION_STAIRS, 1, () => bot.minusedlevel === 1, { label: 'mansion-up-1', tries: 1 })) && bot.minusedlevel === 0) await prewalk('stalled');
    need(await opLocUntil(c, MANSION_STAIRS, 1, () => bot.minusedlevel === 1, { label: 'mansion-up' }), 'mansion-up');
    }
    if (st <= 6) {
    const handed = textWatch(bot, /sort this out right now/i);
    need(await talkTo(c, CERIL, CERIL1_AT, [/.*/], () => bot.count('carnillean_armour') === 0 && handed(), { label: 'ceril-armour' }), 'ceril-armour');
    await finishDialog(bot, [/.*/], 10);
    dismiss(bot);   // the fake quest-complete scroll (quest_hazeelcult.rs2:159-167)
    }
    // 6. cupboard: Open, Search (Ceril and Jones within 6 of us)
    const thv0 = bot.stat('thieving').xp;
    for (let k = 0; k < 6 && bot.stat('thieving').xp <= thv0; k++) {
        dismiss(bot);
        const open = bot.liveLocs.get(`1,${CUPBOARD.x},${CUPBOARD.z}`) === CUPBOARD_OPEN;
        if (!open) { await opLocUntil(c, CUPBOARD, 1, () => bot.liveLocs.get(`1,${CUPBOARD.x},${CUPBOARD.z}`) === CUPBOARD_OPEN, { label: 'cupboard-open', tries: 2, stand: CUPBOARD_STAND }); continue; }
        await opLocUntil(c, { ...CUPBOARD, id: CUPBOARD_OPEN }, 1, () => inDialog(bot) || bot.stat('thieving').xp > thv0, { label: 'cupboard-search', tries: 2, stand: CUPBOARD_STAND });
        await finishDialog(bot, [/.*/], 60, () => bot.stat('thieving').xp > thv0);
        await bot.until(() => bot.stat('thieving').xp > thv0, 4);
    }
    need(bot.stat('thieving').xp > thv0, 'complete'); mark(c, 'complete');
    dismiss(bot);
    void walkShort;
}
export { StepError };

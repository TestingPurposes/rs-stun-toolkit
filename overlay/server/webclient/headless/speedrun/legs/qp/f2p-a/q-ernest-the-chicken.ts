// q-ernest-the-chicken.ts — Ernest the Chicken (quest_haunted), cheat-free. f2p-a agent "fe".
// Content (rev 289): areas/area_draynor/scripts/veronica.rs2, professor_oddenstein.rs2, quests/quest_haunted/scripts/
// quest_haunted.rs2, configs/quest_haunted.{constant,obj,loc}, ladders+stairs/scripts/stairs.rs2:110,201.
//
// Stages (quest_haunted.constant): 0 not started, 1 started (Veronica), 2 spoken to Oddenstein, complete.
// NO item step checks the stage: the fountain (quest_haunted.rs2:44-61), compost heap (:14-27), closet door (:29-42),
// puzzle and ground spawns all work at stage 1. So the leg collects everything first and talks to Oddenstein TWICE in a
// row (talk 1 -> stage 2, talk 2 with all three parts -> complete, professor_oddenstein.rs2:1-6,63-85).
//
// Flow:
//  1. Veronica (285, outside the manor gate): p_choice2 "Aha, sounds like a quest. I'll help." -> %haunted 1 after 3 pages
//     (veronica.rs2:8-19). Observable: journal colour IN_PROGRESS.
//  2. fish food + poison -> poisoned fish food (OPHELDU, :63-73; both tradeable = SUPPLY; the poisoned food is not).
//  3. fountain 153 (3087,3334): use the poisoned food (p_delay 1+2, :75-86) -> search (op1): 2 chatplayer pages, then the
//     pressure gauge (:44-61).
//  4. compost heap 152 (3084,3360): use the spade (tradeable = SUPPLY) -> p_delay 2 -> closet key (:14-27).
//  5. front door 134 (3108,3353): opens only from the south and teleports us in (:1-11).
//  6. closet door 131 (3107,3367): use the key -> through (:29-42); rubber tube ground spawn (3111,3367); key again -> out.
//  7. bookcase 155 (3097,3358) from the EAST -> end_coord (3096,3358) (:96-101, quest_haunted.loc end_coord). (The :114 TODO
//     "borked" is about the bookcase door ANIMATION locs; the teleport itself works.)
//  8. ladder 133 (3092,3362) -> basement (3116,9754); lever puzzle -> oil can (3092,9755) (fe-lib runPuzzle);
//     ladder 132 (3117,9754) -> (3092,3361); lever 160 (3096,3357) -> out east (:103-112).
//  9. stairs 1730 (3108,3363) -> L1 (+4 z, stairs.rs2:110); spiral stairs 1738 (1,3104,3362) -> (2,3105,3364) (stairs.rs2:201).
// 10. Oddenstein (286, L2): talk 1 "I'm looking for a guy called Ernest." / "Change him back this instant!" -> stage 2;
//     talk 2: all three parts -> if_close, p_delay 6 t, queue(haunted_quest_complete): +4 qp, +300 coins.
import type { SpeedBot } from '../../../core.js';
import { objId, cheb } from '../../../core.js';
import { locAt, useOnLocGo, opLocGo, inDialog } from '../../q-lib.js';
import { converse, mkLog, qp, qStatus, closeChat, pagesUntil, walk, pickup, opLocUntil, useOnLocUntil, eatWatch, dead, fail, msgSince,
    type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';
import { opLocFromTile, gloryHeld, gloryTele } from './fa2-lib.js';
import { useOn } from '../f2p-b/fg-lib.js';
import { runPuzzle, rideLoc, RIDELOC } from './fe-lib.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'Ernest the Chicken', dir: 'quest_haunted', qp: 4 };
/** FE_CLOSET=first (default: closet on the way from the front door to the bookcase) | last (after the puzzle, before the stairs) */
const CLOSET = process.env.FE_CLOSET || 'first';
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0,
    skills: {},   // no combat, no skill gate (fountain piranhas deal 1 only without the poisoned food)
    start: { x: 3110, z: 3333, level: 0 },   // next to Veronica, south of the manor (from Draynor Village glory: see run option `glory`)
    end: { x: 3110, z: 3366, level: 2 },     // Professor Oddenstein, Draynor Manor L2
};
export const SUPPLY: Item[] = [
    { name: 'fish_food', n: 1 }, { name: 'poison', n: 1 }, { name: 'spade', n: 1 },
];
const VERONICA = 285, ODDENSTEIN = 286;
const VERONICA_AT = { x: 3110, z: 3331 };
const FOUNTAIN = { id: 153, x: 3087, z: 3334 }, COMPOST = { id: 152, x: 3084, z: 3360 };
const FRONT_DOOR = { id: 134, x: 3108, z: 3353 }, CLOSET_DOOR = { id: 131, x: 3107, z: 3367 };
const BOOKCASE = { id: 155, x: 3097, z: 3358 }, LADDER_DOWN = { id: 133, x: 3092, z: 3362 }, LADDER_UP = { id: 132, x: 3117, z: 9754 };
const LEVER_OUT = { id: 160, x: 3096, z: 3357 }, STAIRS = { id: 1730, x: 3108, z: 3363 }, SPIRAL = { id: 1738, x: 3104, z: 3362, level: 1 };
const TUBE_AT = { x: 3111, z: 3367 };

export async function run(bot: SpeedBot, o: { log?: boolean; glory?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L0 = mkLog(bot, 'ernest', !!o.log), L = (s: string) => L0(`${s} [energy ${bot.runEnergy}]`);
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0, o); }
    finally { stopEat(); }
}

async function body(bot: SpeedBot, L: (s: string) => void, t0: number, qp0: number, o: { glory?: boolean }): Promise<RunResult> {
    const fin = (ok: boolean, msg: string): RunResult => ({ ok, ticks: bot.tickCount - t0, msg });
    const has = (n: string) => bot.count(objId(n)) > 0;
    const check = () => { if (dead(bot)) fail(bot, 'died'); };
    const started = () => { const s = qStatus(bot, 'haunted'); return s === 'IN_PROGRESS' || s === 'COMPLETE'; };
    const done = () => qp(bot) >= qp0 + QUEST.qp;
    const inBasement = () => bot.tile().z > 6400;
    const lvl = (): number => bot.minusedlevel;
    const inHouse = () => { const t = bot.tile(); return bot.minusedlevel === 0 && t.x >= 3091 && t.x <= 3126 && t.z > FRONT_DOOR.z && t.z <= 3374; };
    type LocRef = { id: number; x: number; z: number; level?: number };
    /** one loc interaction: rideLoc (default) or the walk-stop-op helpers (FE_RIDELOC=0, A/B); raw = exact-tile raw op */
    const opAt = async (loc: LocRef, act: { op?: number; use?: string }, ok: () => boolean, what: string, max: number, stand?: { x: number; z: number }, raw = false) => {
        if (RIDELOC) return rideLoc(bot, loc, act, ok, what, max, stand);
        if (act.use) await useOnLocUntil(bot, loc, act.use, ok, max, stand);
        else if (raw && stand) await opLocFromTile(bot, stand, loc, act.op ?? 1, ok, what, max);
        else await opLocUntil(bot, loc, act.op ?? 1, ok, max, stand);
        if (!ok()) fail(bot, what);
    };
    if (!has('pressure_gauge') && !has('poisoned_fish_food') && !(has('fish_food') && has('poison'))) fail(bot, 'no fish food + poison');
    if (!has('closet_key') && !has('rubber_tube') && !has('spade')) fail(bot, 'no spade');
    const free = 28 - bot.inv().length;
    if (free < 3) fail(bot, `need 3 free slots (gauge/key/tube/oil can, minus the fish food), have ${free}`);

    // 0. optional approach: amulet of glory -> Draynor Village (3105,3251), then the road north past the Draynor gates on x=3104
    // (their OPEN leaf 1552 on (3106,3273) walls a tile the planner thinks free: STATUS.md agent 2, fc30/fc32)
    if (o.glory && cheb(bot.tile(), VERONICA_AT) > 30 && bot.minusedlevel === 0 && !inBasement()) {
        if (!gloryHeld(bot)) fail(bot, 'glory option without a glory');
        const r = await gloryTele(bot, /^Draynor Village/); L(`glory -> Draynor Village ${r.ok} ${r.ticks}t`);
        if (!r.ok) fail(bot, 'glory teleport');
        for (const w of [{ x: 3104, z: 3266 }, { x: 3104, z: 3277 }, { x: 3109, z: 3287 }]) await walk(bot, w, 2, `manor road (${w.x},${w.z})`, 80);
    }

    // 1. Veronica: start
    if (!started()) {
        const ok = await converse(bot, VERONICA, {
            plan: ['R', 'R', 'R', 'R', 'R'], stand: VERONICA_AT, near: 8, label: 'veronica', log: L, maxTicks: 120,
            answers: [/^Aha, sounds like a quest/], done: started,
        });
        if (!ok) fail(bot, `Veronica: quest did not start (journal ${qStatus(bot, 'haunted')})`);
        closeChat(bot);
        L('started');
    }
    check();
    const poison = () => { if (has('fish_food') && has('poison')) { useOn(bot, 'poison', 'fish_food'); L('poisoning the fish food'); } };

    // 2-3. fountain: poisoned fish food, then search for the gauge
    if (!has('pressure_gauge')) {
        poison();
        // the combine (OPHELDU) lands during the walk to the fountain (it does not stop the walk queue, f2p-b fg notes)
        if (!RIDELOC) await bot.until(() => has('poisoned_fish_food') || !has('fish_food'), 4);
        const fl = locAt(FOUNTAIN.id, FOUNTAIN.x, FOUNTAIN.z, 0);
        if (has('poisoned_fish_food') || (has('fish_food') && has('poison'))) {
            const tp = bot.tickCount;
            // done = the food left the pack (inv_del is the script's first effect); a re-send after that throws (not held)
            await opAt(FOUNTAIN, { use: 'poisoned_fish_food' }, () => !has('poisoned_fish_food') && !has('fish_food'), 'fountain (poison)', 200);
            // %haunted_manor_fountain_poisoned is set after p_delay 1 + 2 (:83-86): a search before that bites
            await bot.until(() => msgSince(bot, tp, /float to the surface/), 8);
            L('fountain poisoned');
        }
        const ts = bot.tickCount; let last = -99;
        while (!has('pressure_gauge') && bot.tickCount - ts < 40) {
            check();
            if (inDialog(bot)) { await pagesUntil(bot, () => has('pressure_gauge') || !inDialog(bot), 6); continue; }
            if (bot.tickCount - last >= 5) { opLocGo(bot, fl, 1); last = bot.tickCount; }
            await bot.tick(1);
        }
        if (!has('pressure_gauge')) fail(bot, 'fountain: no pressure gauge');
        closeChat(bot);
        L('pressure gauge');
    }
    check();

    // 4. compost heap: spade -> closet key
    if (!has('closet_key') && !has('rubber_tube')) {
        await opAt(COMPOST, { use: 'spade' }, () => has('closet_key'), 'compost (dig)', 120);
        if (!has('closet_key')) fail(bot, 'compost: no key');
        L('closet key');
    }
    check();

    // 5. into the house by the front door (opens from the south only, teleports us through)
    if (!inHouse() && !inBasement() && bot.minusedlevel === 0) {
        await opAt(FRONT_DOOR, { op: 1 }, () => inHouse(), 'manor front door', 300, { x: FRONT_DOOR.x, z: FRONT_DOOR.z }, true);
        L(`in the manor ${JSON.stringify(bot.pos())}`);
    }
    check();

    const closet = async () => {
        if (has('rubber_tube')) return;
        const inCloset = () => { const t = bot.tile(); return bot.minusedlevel === 0 && t.x >= 3108 && t.x <= 3111 && t.z >= 3366 && t.z <= 3368; };
        if (!inCloset()) {
            await opAt(CLOSET_DOOR, { use: "closet_key" }, inCloset, "closet door (in)", 120, { x: CLOSET_DOOR.x, z: CLOSET_DOOR.z });
            L('in the closet');
        }
        if (!(await pickup(bot, 'rubber_tube', TUBE_AT, 60))) fail(bot, 'rubber tube');
        L('rubber tube');
        await opAt(CLOSET_DOOR, { use: "closet_key" }, () => !inCloset(), "closet door (out)", 60, { x: CLOSET_DOOR.x + 1, z: CLOSET_DOOR.z });
        L('out of the closet');
    };
    // 6. closet (rubber tube), on the way from the front door to the bookcase
    if (CLOSET === 'first' && !has('oil_can')) await closet();
    check();

    // 7-8. bookcase -> secret room -> puzzle ladder -> lever puzzle -> oil can -> ladder up -> lever out
    if (!has('oil_can')) {
        if (!inBasement()) {
            if (!(bot.tile().x <= 3096 && bot.tile().z >= 3355 && bot.tile().z <= 3364)) {
                await opAt(BOOKCASE, { op: 1 }, () => bot.tile().x <= BOOKCASE.x - 1, 'bookcase (from the east)', 120, { x: BOOKCASE.x + 1, z: BOOKCASE.z }, true);
                L(`secret room ${JSON.stringify(bot.pos())}`);
            }
            await opAt(LADDER_DOWN, { op: 1 }, inBasement, 'puzzle ladder down', 40);
            if (!inBasement()) fail(bot, 'puzzle ladder down');
            L(`basement ${JSON.stringify(bot.pos())}`);
        }
        await runPuzzle(bot, L);
    }
    check();
    if (inBasement()) {
        await opAt(LADDER_UP, { op: 1 }, () => !inBasement(), 'puzzle ladder up', 60);
        if (inBasement()) fail(bot, 'puzzle ladder up');
        L(`secret room ${JSON.stringify(bot.pos())}`);
    }
    if (bot.minusedlevel === 0 && bot.tile().x <= 3096 && bot.tile().z >= 3355 && bot.tile().z <= 3364) {
        await opAt(LEVER_OUT, { op: 1 }, () => bot.tile().x >= 3097, 'secret room lever', 40);
        if (bot.tile().x < 3097) fail(bot, 'secret room lever');
        L(`out of the secret room ${JSON.stringify(bot.pos())}`);
    }
    check();
    if (CLOSET !== 'first') await closet();
    check();

    // 9. stairs to L1, spiral stairs to L2
    if (bot.minusedlevel === 0) {
        await opAt(STAIRS, { op: 1 }, () => bot.minusedlevel === 1, 'manor stairs up', 80, { x: 3108, z: 3362 });
        if (lvl() !== 1) fail(bot, "manor stairs up");
        L(`L1 ${JSON.stringify(bot.pos())}`);
    }
    if (lvl() === 1) {
        await opAt(SPIRAL, { op: 1 }, () => bot.minusedlevel === 2, 'manor spiral stairs up', 80);
        if (lvl() !== 2) fail(bot, "manor spiral stairs up");
        L(`L2 ${JSON.stringify(bot.pos())}`);
    }
    check();

    // 10. Oddenstein: talk 1 (stage 2) and talk 2 (complete) back to back; converse re-talks until qp rises
    for (const n of ['pressure_gauge', 'rubber_tube', 'oil_can']) if (!has(n)) fail(bot, `missing ${n} at Oddenstein`);
    // his room is behind the L2 door 1530 (3108,3364) (west edge; closed by default): an OPNPC from the landing (3105,3364) did
    // nothing (fe4 op #1). core walkTo opens it on the way.
    if (cheb(bot.tile(), { x: 3110, z: 3366 }) > 2) await walk(bot, { x: 3109, z: 3366, level: 2 }, 1, 'Oddenstein room', 60);
    const tg = bot.tickCount;
    // talk 2 hands the parts over, closes the chat and runs 6 t of p_delay before the reward queue: do not re-talk then
    const handed = () => msgSince(bot, tg, /You give a rubber tube/);
    const ok = await converse(bot, ODDENSTEIN, {
        plan: [], near: 10, label: 'oddenstein', log: L, maxTicks: 200, tries: 4,
        answers: [/^I'm looking for a guy called Ernest/, /^Change him back this instant/], done: () => done() || handed(),
    });
    // after the hand-over the reward is already queued (queue(haunted_quest_complete), professor_oddenstein.rs2:76); Ernest's
    // thank-you pages only hold it back (a normal queue waits for the modal): close them (FE_CUT=0 pages through them)
    const th = bot.tickCount;
    while (ok && !done() && bot.tickCount - th < 30) {
        if (inDialog(bot)) { if (process.env.FE_CUT === '0') { for (let i = 0; i < 5; i++) bot.resumeDialogPage(); bot.queueFlush(); } else closeChat(bot); }
        await bot.tick(1);
    }
    L(`oddenstein: parts handed, reward ${bot.tickCount - th} t later`);
    if (!done()) fail(bot, `Oddenstein: no quest complete (journal ${qStatus(bot, 'haunted')})`);
    closeChat(bot);
    return fin(true, `qp ${qp0} -> ${qp(bot)}, coins ${bot.count(objId('coins'))}`);
}

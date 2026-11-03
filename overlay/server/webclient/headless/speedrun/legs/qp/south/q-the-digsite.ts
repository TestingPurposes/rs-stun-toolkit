/// <reference types="bun" />
// q-the-digsite.ts — THE DIG SITE, cheat-free. Lane south (max-QP route).
//
// Content (rev 289, quests/quest_itexam/scripts/ unless noted). %itexam is NOT transmitted: steps gate on items, position
// and dialog text. Stages (quest_itexam.constant): 1 letter, 2 exam 1, 3 exam 2, 4 exam 3, 5 expert, 6 permit, 7 poured, 8 blown.
//  - examiner (3360,3343): "Can I take an exam?" = letter (examiner.rs2:43-48); curator (Varrock museum) stamps it on use
//    (areas/area_varrock/scripts/curator.rs2:42-68); the stamped letter = stage 2 + exam 1 at once (examiner.rs2:60-67).
//  - exam 1 errands (errand progress 2 = the right answer shows): rock_sample1 = pickpocket digworkman1 (op3, thieving 25,
//    stat_random(thieving,100,240), 3/11 sample at stage 2 only, 3/11 specimen brush any stage, digsite_workman.rs2:57-111);
//    rock_sample2 = panning (cup of tea to the guide first, tray spawn 3369,3378, 3/40 per search at stage 2 only,
//    area_digsite.rs2:1-50, panning_guide.rs2:15-30); rock_sample3 = bush 2358 (3357,3372) at stage <= 2 (area_digsite.rs2:82-90).
//    Used on student1 / student3 / student2 they count at once (student1.rs2:11-18, student2.rs2:11-18, student3.rs2:11-17).
//  - exams 2/3: one talk per student sets the errand (student*.rs2 *_exam_tips); exam 3's student2 wants a CUT opal (2 talks,
//    student3.rs2:77-103). Correct answers: examiner.rs2 first/second/third_exam (texts in ANSWERS below).
//  - talisman: trowel on soil in a level-3 zone (3350-3357,3404-3412 | 3370-3377,3437-3442) holding a specimen jar (sacks
//    2356 at 3359,3398, area_digsite.rs2:97-105) and brush, 1 free slot; 6 t per dig, 1/20 (area_digsite.rs2:400-454).
//    Talisman on the expert (3355,3333) = scroll (arcaeological_expert.rs2:68-87); scroll on digworkman1 = stage 6
//    (digsite_workman.rs2:115-121).
//  - rope on winch 2 (3370,3428) ties it, op1 = west cave (3353,9818) (area_digsite.rs2:637-690). digworkman2 (3352,9821):
//    "I have been invited to research here." -> "Do you know where to find a chest key?" -> "I don't suppose I could use
//    it?" -> "Please?" -> "Aww... go on." -> "Pretty please!" -> "Pretty please with sugar on top!" = key
//    (private_dig_worker.rs2). Rope 2352 (3353,9817) up = (3370,3427).
//  - chest 2361 (3374,3378): key on it, op1 the open chest = powder (area_digsite.rs2:776-800). Barrel 2359: trowel opens
//    it, an empty vial = liquid (:801-828). Expert: liquid = nitroglycerin, powder = ammonium nitrate (:103-114).
//    Nitroglycerin on nitrate, pestle on charcoal, ground charcoal on the mixture, arcenia root on it (herblore 10) =
//    compound (itexam_chemistry.rs2). NEVER drop the chemicals (25-65 damage, area_digsite.rs2:830-893).
//  - rope on winch 1 (3352,3417), op1 = east cave (3370,9828); root (3365,9829); compound on the brick (3379,9825), then the
//    tinderbox from EXACTLY (3379,9826) (area_digsite.rs2:714-767) -> (3368,9767) in the cleared cave; tablet (3374,9747);
//    rope 2353 (3370,9763) up = (3354,3417); tablet on the expert = complete (arcaeological_expert.rs2:88-102).
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { nav, talk, qp, opNpcGo, opLocGo, pickupGo, walkOp, inDialog, dismiss, log as qlog, trace, npcsOf, npc, tele, ensureFreeSlots } from '../../q-lib.js';
import {
    fail, dead, locHere, retry, opLocUntil, useOnLocUntil, eatIfLow, talkTo, chatMark, chatSince, groundOf,
    textLog, textMark, sawText, type Item, type Tile,
} from './south-lib.js';
import { isResuming, failHook } from '../journal.js';

export const QUEST = { name: 'The Dig Site', dir: 'quest_itexam', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        thieving: [25, 'pickpocket a workman for rock sample 1 + the specimen brush: stat(thieving) >= 25 (digsite_workman.rs2:60)'],
        agility: [10, 'winch descents: stat(agility) >= 10 (area_digsite.rs2:616,670)'],
        herblore: [10, 'the charcoal and arcenia root mixes: stat(herblore) >= 10 (itexam_chemistry.rs2:18,36)'],
        magic: [25, 'optional: Varrock Teleport to the curator (193 tiles walked otherwise)'],
    } as Record<string, [number, string]>,
    start: { x: 3361, z: 3341, level: 0 },     // next to the examiner, Exam Centre
    end: { x: 3356, z: 3334, level: 0 },
};
/** Tradeable inputs: tea (panning guide), cut opal (exam 3), 2 ropes (winches), vial, charcoal, pestle, tinderbox, Varrock
 *  Teleport runes. Everything else is untradeable and found in the quest (quest_itexam.obj tradeable=no). */
export const SUPPLY: Item[] = [
    { name: 'cup_of_tea', n: 1 }, { name: 'opal', n: 1 }, { name: 'rope', n: 2 }, { name: 'vial_empty', n: 1 },
    { name: 'charcoal', n: 1 }, { name: 'pestle_and_mortar', n: 1 }, { name: 'tinderbox', n: 1 },
    { name: 'lawrune', n: 1 }, { name: 'airrune', n: 3 }, { name: 'firerune', n: 1 },
];
const O = {
    letter: objId('digplainletter'), stamped: objId('recommendedletter'), s1: objId('rock_sample1'), s2: objId('rock_sample2'), s3: objId('rock_sample3'),
    tray: objId('tray_empty'), trayMud: objId('tray_mud'), tea: objId('cup_of_tea'), opal: objId('opal'), trowel: objId('trowel'),
    jar: objId('specimen_jar'), brush: objId('specimen_brush'), talisman: objId('digtalisman'), scroll: objId('digexpertscroll'),
    rope: objId('rope'), key: objId('digchestkey'), powder: objId('unidentified_powder'), liquid: objId('unidentified_liquid'),
    nitrate: objId('ammonium_nitrate'), nitro: objId('nitroglycerin'), vial: objId('vial_empty'), charcoal: objId('charcoal'),
    pestle: objId('pestle_and_mortar'), ground: objId('ground_charcoal'), pre: objId('precharcoalmixture'), post: objId('postcharcoalmixture'),
    root: objId('arcenia_root'), compound: objId('digcompound'), tinder: objId('tinderbox'), tablet: objId('zarosstonetablet'),
    cert1: objId('level1certificate'), cert2: objId('level2certificate'), cert3: objId('level3certificate'),
};
const N = { workman: 613, worker2: 614, student1: 615, student3: 616, student2: 617, examiner: 618, expert: 619, guide: 620, curator: 646 };
const L = {
    bush: { id: 2358, x: 3357, z: 3372 }, sacks: { id: 2356, x: 3359, z: 3398 }, winch1: { id: 2350, x: 3352, z: 3417 },
    winch2: { id: 2351, x: 3370, z: 3428 }, ropeW: { id: 2352, x: 3353, z: 9817 }, ropeE: { id: 2353, x: 3370, z: 9763 },
    chest: { id: 2361, x: 3374, z: 3378 }, chestOpen: { id: 2360, x: 3374, z: 3378 }, barrel: { id: 2359, x: 3364, z: 3378 },
    brick: { id: 2362, x: 3379, z: 9825 },
};
const T = {
    examiner: { x: 3361, z: 3342 }, expert: { x: 3355, z: 3334 }, curator: { x: 3256, z: 3446 }, guide: { x: 3375, z: 3376 },
    tray: { x: 3369, z: 3378 }, students: { x: 3358, z: 3408 }, dig: { x: 3353, z: 3408 }, worker2: { x: 3352, z: 9820 },
    blastStand: { x: 3379, z: 9826 }, tablet: { x: 3374, z: 9747 }, rootE: { x: 3365, z: 9829 }, workmanMid: { x: 3358, z: 3386 },
};
const ANSWERS = [
    /^The study of the earth, its contents, and history/i, /^All that have passed the appropriate Earth Sciences exam/i, /^Gloves and boots to be worn at all times/i,
    /^Samples taken in rough form/i, /^Finds must be carefully handled, and gloves worn/i, /^Always handle with care; strike cleanly/i,
    /^Samples cleaned, and carried only in specimen jars/i, /^Brush carefully and slowly using short strokes/i, /^Handle bones very carefully/i,
];
/** what the quest keeps; dig junk (buckles, helms, coins...) is dropped */
// route runner: + the travel kit (runes, glory, coins)
const KEEP = () => new Set([...SUPPLY.map(i => objId(i.name)), ...Object.values(O), objId('uncut_opal'), ...(['lawrune', 'airrune', 'waterrune', 'earthrune', 'firerune', 'coins', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4']).map(n => objId(n))]);
const inCave = (t: Tile) => t.z > 9000;
const zone3 = (t: Tile) => t.x >= 3350 && t.x <= 3357 && t.z >= 3404 && t.z <= 3412;

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    const t0 = bot.tickCount, qp0 = qp(bot);
    bot.holdDialogs = true;
    trace(bot, t0);
    const Lg = (s: string) => { if (o.log !== false) qlog(bot, t0, `${s} | hp ${bot.stat('hitpoints').cur} at ${bot.tile().x},${bot.tile().z}`); failHook(s); };
    // session 10 (resume): a retry restarted at the examiner's letter and the bush, which only answer up to stage 2. On a
    // retry / resume the steps behind what the pack shows are skipped: the trowel = exam 1 passed, the certificates = exams 2/3,
    // a chest key / chemicals / the tablet = past the permit. DG_RESUME=0 reverts.
    const RES = isResuming(bot) && process.env.DG_RESUME !== '0';
    const hasAny = (...ids: number[]) => ids.some(i => bot.count(i) > 0);
    const exam1 = () => RES && hasAny(O.trowel), exam2 = () => RES && hasAny(O.cert2, O.cert3), exam3 = () => RES && hasAny(O.cert3);
    const pastPermit = () => RES && (hasAny(O.key, O.powder, O.nitrate, O.pre, O.post, O.compound, O.tablet) || inCave(bot.tile()));
    const pastNitrate = () => RES && hasAny(O.pre, O.post, O.compound, O.tablet);
    if (RES) Lg(`resume: exam1 ${exam1()} exam2 ${exam2()} exam3 ${exam3()} permit ${pastPermit()} nitrate ${pastNitrate()} | pack ${bot.inv().map(x => objDebugName(x.obj)).join(',')}`);
    textLog(bot);
    let stepMark = 0;
    const step = () => { stepMark = textMark(bot); };
    const seen = (re: RegExp) => sawText(bot, re, stepMark);
    const loc = (l: { id: number; x: number; z: number }, level = 0) => locHere(l.id, l.x, l.z, level);
    const walk = async (t: Tile, label: string, near = 1, maxTicks = 600) => {
        if (!(await walkOp(bot, t, null, () => cheb(bot.tile(), t) <= near, { near, maxTicks }))) fail(bot, `${label}: walk to (${t.x},${t.z})`);
    };
    /** use `obj` on the nearest npc of `type` (route next to it), then page through until `done` */
    const giveNpc = async (type: number, obj: number, done: () => boolean, label: string, at?: Tile, answers: RegExp[] = []) => {
        for (let k = 0; k < 4 && !done(); k++) {
            let n = npc(bot, type);
            if ((!n || n.d > 12) && at) { await walk(at, `${label} (to npc)`, 3); n = npc(bot, type); }
            if (!n) fail(bot, `${label}: npc ${type} not in view`);
            step();
            await retry(bot, () => { const m = npc(bot, type); if (!m || inDialog(bot) || bot.slot(obj) < 0) return; opNpcGo(bot, m, 1); bot.useItemOnNpc(m.idx, obj, bot.slot(obj)); },
                () => inDialog(bot) || done(), 30, 6);
            if (!done()) await talk(bot, [], [], { noOp: true, done: () => done() && !inDialog(bot), answers, maxTicks: 60, label });
            dismiss(bot);
        }
        if (!done()) fail(bot, `${label}: not done`);
    };
    /** OPLOC once (re-sent only while nothing happened), then page through until `done` (scripts that inv_add after a box
     *  abort if a re-sent op closes the box: tourist trap sott7) */
    const opThen = async (l: ReturnType<typeof loc>, op: number, done: () => boolean, answers: RegExp[], label: string) => {
        step();
        await opLocUntil(bot, l, op, () => done() || inDialog(bot), 30, 8);
        if (!done()) await talk(bot, [], [], { noOp: true, done: () => done() && !inDialog(bot), answers, maxTicks: 40, label });
        dismiss(bot);
    };
    const useOnLocThen = async (obj: number, l: ReturnType<typeof loc>, done: () => boolean, label: string) => {
        step();
        await useOnLocUntil(bot, obj, l, () => done() || inDialog(bot), 30, 8);
        if (!done()) await talk(bot, [], [], { noOp: true, done: () => done() && !inDialog(bot), maxTicks: 30, label });
        dismiss(bot);
    };
    const useOn = (target: number, used: number) => () => { const a = bot.slot(target), b = bot.slot(used); if (a >= 0 && b >= 0) bot.useItemOnItem(target, a, used, b); };
    const talkStudent = async (type: number, label: string, done?: () => boolean) => {
        if (process.env.DG_STUDENT2 !== '0') return talkStudent2(type, label, done);
        step();
        // each student closes with its own line (student1/2/3.rs2 *_exam_tips): matching only student1's cost 190 t a talk (sodg2)
        await talkTo(bot, type, [], { done: done ?? (() => seen(/I'll remember that|Thanks for the information|thanks for your advice/i) && !inDialog(bot)), at: T.students, maxTicks: 60, label, tries: 4 });
        dismiss(bot);
    };
    // session 9 (from-zero one-shots qt41/42/45/47/51: exams 2 and 3 took ~870 t each vs ~160-235 t in a fresh-world fork: every
    // student talk ran 4 x 60 t without its done; the students wander and several copies of each type stand around the site).
    // One OPNPC per candidate copy (nearest first, rotating), a short wait for the dialog, then page it through; a tips talk
    // counts as done when its text (or the 'I need more help with the exam' line) was seen and the dialog closed. Every attempt
    // is logged. DG_STUDENT2=0 reverts to talkTo.
    const TIPS = /I'll remember that|Thanks for the information|thanks for your advice|I need more help with the exam|learned since I last spoke/i;
    const talkStudent2 = async (type: number, label: string, done?: () => boolean) => {
        step();
        let talkedOut = false;
        const isDone = done ? (() => (talkedOut && !inDialog(bot)) || done()) : (() => (talkedOut || seen(TIPS)) && !inDialog(bot));
        const s0 = bot.tickCount;
        for (let k = 0; k < 10 && !isDone(); k++) {
            if (dead(bot)) return;
            if (!inDialog(bot)) {
                let cands = npcsOf(bot, type);
                if (!cands.length || cands[0]!.d > 14) { await walkOp(bot, T.students, null, () => { const m = npc(bot, type); return !!m && m.d <= 8; }, { near: 2, maxTicks: 120 }); cands = npcsOf(bot, type); }
                if (!cands.length) { await bot.tick(2); continue; }
                const n = cands[k % Math.min(cands.length, 3)]!;
                opNpcGo(bot, n, 1);
                const opened = await bot.until(() => inDialog(bot) || isDone(), Math.ceil(n.d / 2) + 6);
                qlog(bot, t0, `${label} try ${k + 1}: npc ${type} @${n.x},${n.z} d${n.d} of ${cands.length} -> dialog ${opened} (me ${bot.tile().x},${bot.tile().z})`);
                if (!inDialog(bot)) continue;
            }
            // a whole tips talk = the errand is set (student*.rs2 *_exam_tips set it on page 3): the dialog stayed open >= 4 t and
            // closed by itself. Long runs (qu09m) saw every talk open and run but NOT its text in the q-lib text log (cause under
            // study, logged below), so this counts too unless a custom `done` is given (DG_TALK_DONE=0 = text only).
            const o0 = bot.tickCount;
            await talk(bot, [], [], { noOp: true, done: () => isDone() || !inDialog(bot), maxTicks: 30, label });
            const openT = bot.tickCount - o0;
            await bot.tick(1);
            const tl = textLog(bot) as any;
            if (!isDone()) qlog(bot, t0, `${label}: talk ran ${openT} t, tips text not seen; text log len ${tl.length} base ${tl.base} last [${tl.slice(-3).map((e: any) => String(e.text).slice(0, 40)).join(' | ')}] ifText has tips ${[...bot.ifText.values()].some(v => TIPS.test(v ?? ''))}`);
            if (label !== 'student2 opal' && process.env.DG_TALK_DONE !== '0' && openT >= 4 && !inDialog(bot)) { talkedOut = true; break; }
        }
        dismiss(bot);
        qlog(bot, t0, `${label}: ${isDone() ? 'done' : 'NOT done'} in ${bot.tickCount - s0} t`);
    };
    const examiner = async (label: string, done: () => boolean, answers: RegExp[]) => {
        step();
        await talkTo(bot, N.examiner, [], { done: () => done() && !inDialog(bot), at: T.examiner, answers, maxTicks: 90, label, tries: 4 });
        dismiss(bot);
        if (!done()) fail(bot, `${label}: not done`);
    };
    (async () => { while (!bot.disposed) { eatIfLow(bot); await bot.tick(1); } })();
    try {
        // ---- 0. pack
        const keep = KEEP();
        const junk = [...new Set(bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj))];
        if (junk.length) { Lg(`dropping ${junk.map(objDebugName).join(',')}`); await bot.dropAll(junk); }

        // ---- 1. letter, stamp (Varrock Teleport), back
        if (!exam1()) {
        // session 11 fix 300b DG_STAGE2_RESUME (qx54m retry 'examiner letter: not done' @ (3361,3341), 50 x 'unplanned choice
        // [Yes, I certainly am. | No, not at the moment.]'; CONFIRMED): attempt 1 had reached stage 2 (the examiner took the
        // stamped letter) and failed in panning; the resume only skipped exam 1 on the trowel, so it asked for a new letter and
        // the examiner, now at stage 2, only offers the exam. Stage 2 without the trowel: holding a rock sample / the panning
        // tray with no letter = skip the letter; else ask the examiner and answer 'No, not at the moment' - that menu = stage 2
        // with the samples already handed in (INFERRED path: skip panning / pickpocketing, go to exam 1). =0 reverts.
        // Test: SR_FAIL_AT='stage 2' (samples path) / 'samples delivered' (examiner-menu path).
        const S2R = RES && process.env.DG_STAGE2_RESUME !== '0';
        let stage2Menu = false;
        if (bot.count(O.letter) === 0 && bot.count(O.stamped) === 0) {
            if (S2R && hasAny(O.s1, O.s2, O.s3, O.tray, O.trayMud)) Lg('300b: stage 2 resume (sample/tray held, no letter): no new letter');
            else {
                await examiner('examiner letter', () => {
                    if (S2R && !stage2Menu && inDialog(bot) && bot.dialogOptions().some(x => /certainly am/i.test(x.text))) stage2Menu = true;
                    return bot.count(O.letter) > 0 || stage2Menu;
                }, S2R ? [/^Can I take an exam/i, /^No, not at the moment/i] : [/^Can I take an exam/i]);
                if (stage2Menu) Lg('300b: stage 2 resume (examiner offers exam 1; samples handed in)'); else Lg('letter');
            }
        }
        if (bot.count(O.letter) > 0) {
            if (bot.stat('magic').level >= 25 && bot.count(objId('lawrune')) > 0) { const r = await tele(bot, 'varrock_teleport'); if (!r.ok) Lg('varrock teleport failed: walking'); }
            await giveNpc(N.curator, O.letter, () => bot.count(O.stamped) > 0, 'curator', T.curator);
            Lg('stamped');
        }
        // the bush sample on the way back (stage <= 2), the examiner takes the letter (stage 2, exam 1 starts: walk away)
        if (bot.count(O.s3) === 0 && !stage2Menu) {
            await walk({ x: 3357, z: 3371 }, 'bush', 1, 400);
            await opThen(loc(L.bush), 1, () => bot.count(O.s3) > 0, [], 'bush');
            if (bot.count(O.s3) === 0) fail(bot, 'bush: no rock sample 3');
        }
        if (bot.count(O.stamped) > 0) {
            step();
            await talkTo(bot, N.examiner, [], { done: () => bot.count(O.stamped) === 0, at: T.examiner, maxTicks: 40, label: 'examiner stamped', tries: 4 });
            dismiss(bot); await bot.tick(1); dismiss(bot);
            if (bot.count(O.stamped) > 0) fail(bot, 'examiner did not take the stamped letter');
            Lg('stage 2');
        }
        // ---- 2. samples: panning (tea, tray) + pickpocketing (sample 1 + brush)
        if (!stage2Menu) { await panning(); await pickpocket(); }   // 300b: samples handed in already
        await giveNpc(N.student2, O.s3, () => bot.count(O.s3) === 0, 'student2 sample', T.students);
        await giveNpc(N.student1, O.s1, () => bot.count(O.s1) === 0, 'student1 sample', T.students);
        await giveNpc(N.student3, O.s2, () => bot.count(O.s2) === 0, 'student3 sample', T.students);
        Lg('samples delivered');
        // ---- 3. exam 1 (trowel), liquid on the way north again
        await examiner('exam 1', () => bot.count(O.trowel) > 0, [/^Yes, I certainly am/i, ...ANSWERS]);
        Lg('exam 1 passed');
        }
        // ---- 4. exam 2: one talk per student
        if (!exam2()) {
        await talkStudent(N.student1, 'student1 tips 2');
        await talkStudent(N.student3, 'student3 tips 2');
        await talkStudent(N.student2, 'student2 tips 2');
        await examiner('exam 2', () => bot.count(O.cert2) > 0, [/^I am ready for the next exam/i, ...ANSWERS]);
        Lg('exam 2 passed');
        }
        // ---- 5. exam 3: student2 asks for the opal first
        if (!exam3()) {
        await talkStudent(N.student1, 'student1 tips 3');
        await talkStudent(N.student3, 'student3 tips 3');
        await talkStudent(N.student2, 'student2 opal ask', () => seen(/favourites are opals|bring me the opal|precious stone/i) && !inDialog(bot));
        await talkStudent(N.student2, 'student2 opal', () => bot.count(O.opal) === 0 && !inDialog(bot));
        await examiner('exam 3', () => bot.count(O.cert3) > 0, [/^I am ready for the last exam/i, ...ANSWERS]);
        Lg('exam 3 passed');
        }
        // ---- 6. barrel liquid (needs the trowel), jar, talisman
        if (!pastPermit()) {
        await liquid();
        await talisman();
        // ---- 7. expert: talisman -> scroll, liquid -> nitroglycerin; scroll on a workman = permit
        await giveNpc(N.expert, O.talisman, () => bot.count(O.scroll) > 0, 'expert talisman', T.expert);
        await giveNpc(N.expert, O.liquid, () => bot.count(O.nitro) > 0, 'expert liquid', T.expert);
        Lg('scroll + nitroglycerin');
        await giveNpc(N.workman, O.scroll, () => bot.count(O.scroll) === 0, 'workman scroll', T.workmanMid);
        Lg('permit');
        }
        // ---- 8. west cave: key; chest: powder; expert: nitrate; mix
        if (!pastNitrate()) {
        if (!(RES && inCave(bot.tile()) && bot.tile().x > 3360)) await westCave();   // a resume in the east cave is past it
        await giveNpc(N.expert, O.powder, () => bot.count(O.nitrate) > 0, 'expert powder', T.expert);
        }
        await mix1();
        // ---- 9. east cave: root, compound, blast, tablet
        await eastCave();
        await giveNpc(N.expert, O.tablet, () => qp(bot) >= qp0 + QUEST.qp, 'expert tablet', T.expert);
        if (qp(bot) < qp0 + QUEST.qp) fail(bot, 'no quest points');
        Lg('QUEST COMPLETE');
        return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message };
    }

    // ------------------------------------------------------------------------------------------------------------------------
    async function panning(): Promise<void> {
        if (bot.count(O.s2) > 0) return;
        // tea to the guide (else he blocks every pan while within 10 tiles, area_digsite.rs2:1-6)
        if (bot.count(O.tea) > 0) {
            step(); await talkTo(bot, N.guide, [], { done: () => bot.count(O.tea) === 0 && !inDialog(bot), at: T.guide, maxTicks: 60, label: 'guide tea', tries: 4 });
            dismiss(bot);
        }
        if (bot.count(O.tray) === 0 && bot.count(O.trayMud) === 0) {
            const g = groundOf(bot, O.tray, 15) ?? { x: T.tray.x, z: T.tray.z };
            if (!(await retry(bot, () => pickupGo(bot, O.tray, g), () => bot.count(O.tray) > 0, 30, 5))) fail(bot, 'panning tray');
        }
        // tight cycle: the inventory changes BEFORE each closing box (area_digsite.rs2:12-50), so the next op is sent at once
        // instead of paging the box (sodg4: ~13 t a pan with paging, level-up boxes on a fishing/mining-1 sim account)
        const t1 = bot.tickCount; let pans = 0;
        const p = nearestPanPoint();
        // session 11 fix 300a DG_PAN_ROOM (qx54m 'no rock sample 2 after 67 pans' at (3376,3373)): the pans worked (coins
        // 1085 -> 1106, tray empty/mud alternating) but every opal/jade/oyster find is one more slot (9/40 a pan); the retry's
        // pack was 28/28 (6 uncut opal, 2 jade, 3 oyster, nuggets = the 12 free slots). With the pack full the sample's inv_add
        // overflows to the FLOOR (engine InvOps.ts INV_ADD: overflow -> World.addObj at the player) and the module never looks
        // there; inv_total(rock_sample2) stays 0, so later rolls drop more samples on the floor. CONFIRMED: pack full (retry
        // pack line); the sample on the floor INFERRED (rolls after the pack filled ~pan 53; 3/40 a pan). Fix: keep >= 2 slots
        // free while panning (drop jade/oyster/nuggets/spare uncut opals, keep 1 uncut opal), and pick up a rock sample 2 seen
        // on the ground within 3 tiles. DG_PAN_ROOM=0 reverts. TEST DG_PAN_TEST=1: the first rock sample 2 found is dropped
        // at once (= the full-pack overflow's result, a sample on the floor), to prove the floor pick-up.
        const roomFix = process.env.DG_PAN_ROOM !== '0', panTest = process.env.DG_PAN_TEST === '1';
        const PAN_JUNK = ['uncut_jade', 'oystershell', 'nuggets'];   // + uncut_opal above 1 (floor)
        const panCap = 600; let panTested = false;
        if (roomFix) await ensureFreeSlots(bot, 3, { drop: PAN_JUNK, floor: { uncut_opal: 1 }, log: s => Lg(`panning: ${s}`) });
        step();
        while (bot.count(O.s2) === 0) {
            if (bot.tickCount - t1 > panCap) fail(bot, `no rock sample 2 after ${pans} pans (pack ${28 - bot.free()}/28)`);
            if (roomFix) {
                const g = groundOf(bot, O.s2, 3);
                if (g) {
                    Lg(`300a: rock sample 2 on the floor at ${g.x},${g.z} (pack ${28 - bot.free()}/28, ${pans} pans): picking it up`);
                    if (inDialog(bot)) dismiss(bot);
                    await ensureFreeSlots(bot, 1, { drop: PAN_JUNK, floor: { uncut_opal: 1 } });
                    await retry(bot, () => pickupGo(bot, O.s2, g), () => bot.count(O.s2) > 0, 30, 4);
                    continue;
                }
                if (bot.free() < 2 && bot.count(O.trayMud) === 0) { if (inDialog(bot)) dismiss(bot); await ensureFreeSlots(bot, 3, { drop: PAN_JUNK, floor: { uncut_opal: 1 } }); }
            }
            if (bot.count(O.trayMud) > 0) {
                const s0 = bot.slot(O.trayMud);
                bot.opHeld2(O.trayMud, s0); bot.queueFlush();
                if (!(await bot.until(() => bot.count(O.trayMud) === 0, 6))) { dismiss(bot); await bot.tick(1); }
                if (panTest && !panTested && bot.count(O.s2) > 0) { panTested = true; Lg(`TEST: dropping the rock sample 2 of pan ${pans}`); if (inDialog(bot)) dismiss(bot); await bot.dropAll([O.s2]); await bot.tick(1); }
                continue;
            }
            opLocGo(bot, p, 1); bot.queueFlush(); pans++;
            if (!(await bot.until(() => bot.count(O.trayMud) > 0, 10))) {
                dismiss(bot);
                if (seen(/OK, forget it/i)) fail(bot, 'panning blocked by the guide (tea?)');
            }
        }
        await bot.dropAll([O.tray, O.trayMud, objId('uncut_opal'), objId('uncut_jade'), objId('oystershell'), objId('nuggets')].filter(id => bot.count(id) > 0));
        Lg(`rock sample 2 (${pans} pans, ${bot.tickCount - t1} t)`);
    }
    function nearestPanPoint(): ReturnType<typeof loc> {
        const me = bot.tile();
        const all = [] as ReturnType<typeof loc>[];
        for (let x = 3376; x <= 3384; x++) for (let z = 3372; z <= 3381; z++) { try { all.push(locHere(2363, x, z, 0)); } catch { /* none */ } }
        if (!all.length) fail(bot, 'no panning point');
        return all.sort((a, b) => cheb(a, me) - cheb(b, me))[0]!;
    }
    async function pickpocket(): Promise<void> {
        const t1 = bot.tickCount; let tries = 0, stunUntil = 0;
        while (bot.count(O.s1) === 0 || bot.count(O.brush) === 0) {
            if (bot.tickCount - t1 > 500) fail(bot, `pickpocket: sample1 ${bot.count(O.s1)} brush ${bot.count(O.brush)} after ${tries}`);
            if (bot.free() <= 1) { const j = [...new Set(bot.inv().filter(s => !KEEP().has(s.obj)).map(s => s.obj))]; if (j.length) await bot.dropAll(j); }
            const w = npcsOf(bot, N.workman).filter(q => q.d <= 14)[0];
            if (!w) { await walk(T.workmanMid, 'workmen', 3); continue; }
            // a failed pick stuns for 8 t (%stunned = map_clock + 8, digsite_workman.rs2:65-77); an op sent while stunned only
            // answers "You're stunned!" — sodg6 re-sent into the stun and waited ~26 t per fail. Wait out the stun once.
            const cm = chatMark(bot), inv0 = bot.inv().length;
            if (bot.tickCount < stunUntil) { await bot.tick(stunUntil - bot.tickCount); continue; }
            opNpcGo(bot, w, 3); tries++;
            await bot.until(() => chatSince(bot, cm, /You steal|You find a specimen brush|You fail to pick|stunned|can't reach/i) || inDialog(bot) || bot.inv().length !== inv0, 12);
            if (chatSince(bot, cm, /You fail to pick/i)) stunUntil = bot.tickCount + 8;
            else if (chatSince(bot, cm, /You're stunned/i)) stunUntil = bot.tickCount + 2;
            if (inDialog(bot)) dismiss(bot);
        }
        await bot.dropAll([...new Set(bot.inv().filter(s => !KEEP().has(s.obj)).map(s => s.obj))]);
        Lg(`sample 1 + brush (${tries} picks, ${bot.tickCount - t1} t)`);
    }
    async function liquid(): Promise<void> {
        if (bot.count(O.liquid) > 0 || bot.count(O.nitro) > 0) return;
        const b = loc(L.barrel);
        await walk({ x: 3364, z: 3377 }, 'barrel', 2);
        await useOnLocThen(O.trowel, b, () => seen(/it's opened it/i), 'barrel open');
        await useOnLocThen(O.vial, b, () => bot.count(O.liquid) > 0, 'barrel liquid');
        if (bot.count(O.liquid) === 0) fail(bot, 'no liquid');
        Lg('liquid');
    }
    async function talisman(): Promise<void> {
        if (bot.count(O.talisman) > 0 || bot.count(O.scroll) > 0) return;
        if (bot.count(O.jar) === 0) await walk({ x: 3359, z: 3397 }, 'sacks', 2);
        // session 11 fix 300c DG_JAR_ROOM (qyz07, the 300a test fork: 'no specimen jar' @ (3359,3397); CONFIRMED pack 28/28 in the
        // retry line: 16 pickpocket tries had added 5 spare specimen brushes + 5 ropes (digsite_workman.rs2 loot, all in KEEP), so
        // the sacks' inv_add(specimen_jar) overflowed to the floor; pattern #1, same as 300a). Free 2 slots first (workman junk,
        // brushes above 1, ropes above the 2 the winches take) and pick a jar up off the floor. =0 reverts. TEST DG_JAR_TEST=1.
        const jarFix = process.env.DG_JAR_ROOM !== '0';
        const JAR_JUNK = ['spade', 'leather_gloves', 'bucket_empty', 'uncut_jade', 'oystershell', 'nuggets'];
        if (jarFix && bot.count(O.jar) === 0) await ensureFreeSlots(bot, 2, { drop: JAR_JUNK, floor: { specimen_brush: 1, rope: 2, uncut_opal: 1 }, log: s => Lg(`jar: ${s}`) });
        if (bot.count(O.jar) === 0) await opThen(loc(L.sacks), 1, () => bot.count(O.jar) > 0, [], 'specimen jar');
        // TEST DG_JAR_TEST=1: drop the jar once after the sacks (= the overflow's result) to prove the floor pick-up
        if (process.env.DG_JAR_TEST === '1' && bot.count(O.jar) > 0) { Lg('TEST: dropping the specimen jar'); dismiss(bot); await bot.dropAll([O.jar]); await bot.tick(1); }
        const gj = jarFix && bot.count(O.jar) === 0 ? groundOf(bot, O.jar, 4) : undefined;
        if (gj) { Lg(`300c: specimen jar on the floor at ${gj.x},${gj.z} (pack ${28 - bot.free()}/28): picking it up`); await ensureFreeSlots(bot, 1, { drop: JAR_JUNK, floor: { specimen_brush: 1, rope: 2, uncut_opal: 1 } }); await retry(bot, () => pickupGo(bot, O.jar, gj), () => bot.count(O.jar) > 0, 30, 4); }
        if (bot.count(O.jar) === 0) fail(bot, `no specimen jar (pack ${28 - bot.free()}/28)`);
        if (!zone3(bot.tile())) await walk(T.dig, 'level 3 dig', 0);
        const t1 = bot.tickCount; let digs = 0;
        // session 11 fix 261 (DG_DIG_MORE): qx02m 'no talisman after 111 digs' at (3353,3408) — a level-3 zone soil, jar +
        // brush + trowel held, coins +10 a dozen times (the loot table ran), and the retry found it in 4 digs on the same tile.
        // The talisman is 1/20 per dig (area_digsite.rs2:445-454, only %itexam_bits bit 7 'shown' blocks it, set only by the
        // expert), so 111 misses is a ~0.3% tail (INFERRED: bad luck; the sim RNG is reseeded per tick). The 900 t cap turned it
        // into a failed attempt + bank + travel. Cap by digs instead (300 = 0.95^300, ~2e-7) and log a loot tally every 40
        // digs (nothing / coins / other) so a real block would show as coins at ~2x the 1/20 rate. DG_DIG_MORE=0 = 900 t as before.
        const more = process.env.DG_DIG_MORE !== '0';
        const tally = { nothing: 0, coins: 0, other: 0 }; let tallyAt = 0;
        while (bot.count(O.talisman) === 0) {
            if (more ? digs >= 300 || bot.tickCount - t1 > 3000 : bot.tickCount - t1 > 900) fail(bot, `no talisman after ${digs} digs (nothing ${tally.nothing} coins ${tally.coins} other ${tally.other})`);
            if (more && digs > 0 && digs % 40 === 0 && tallyAt !== digs) { tallyAt = digs; Lg(`talisman: ${digs} digs so far (nothing ${tally.nothing} coins ${tally.coins} other ${tally.other})`); }
            if (bot.free() <= 1) { const j = [...new Set(bot.inv().filter(s => !KEEP().has(s.obj)).map(s => s.obj))]; if (j.length) await bot.dropAll(j); }
            const me = bot.tile();
            let soil: ReturnType<typeof loc> | null = null;
            for (const id of [2376, 2377, 2378]) { try { soil = locHere(id, me.x, me.z, 0); break; } catch { /* next */ } }
            if (!soil) { await walk(T.dig, 'soil', 0); continue; }
            const cm = chatMark(bot);
            bot.useItemOnLoc(soil.x, soil.z, soil.id, O.trowel, bot.slot(O.trowel)); bot.queueFlush(); digs++;
            await bot.until(() => chatSince(bot, cm, /You find|strange talisman/i) || inDialog(bot) || bot.count(O.talisman) > 0, 10);
            if (inDialog(bot)) await talk(bot, [], [], { noOp: true, done: () => !inDialog(bot), maxTicks: 6, label: 'dig box' });
            // TEST (DG_DIG_TEST=<n>): a talisman found within the first n digs is dropped (a simulated miss), to run past the old cap
            if (digs <= Number(process.env.DG_DIG_TEST ?? 0) && bot.count(O.talisman) > 0) { Lg(`TEST: dropping the talisman of dig ${digs}`); if (inDialog(bot)) dismiss(bot); await bot.dropAll([O.talisman]); }
            if (chatSince(bot, cm, /You find nothing/i)) tally.nothing++; else if (chatSince(bot, cm, /You find some coins/i)) tally.coins++; else if (chatSince(bot, cm, /You find/i)) tally.other++;
        }
        await bot.dropAll([...new Set(bot.inv().filter(s => !KEEP().has(s.obj)).map(s => s.obj))]);
        Lg(`talisman (${digs} digs, ${bot.tickCount - t1} t)`);
    }
    async function westCave(): Promise<void> {
        if (bot.count(O.powder) > 0 || bot.count(O.nitrate) > 0) return;
        if (bot.count(O.key) === 0) {
            const w2 = loc(L.winch2), r0 = bot.count(O.rope);
            await walk({ x: 3370, z: 3427 }, 'winch 2', 2);
            await useOnLocThen(O.rope, w2, () => bot.count(O.rope) < r0 || inCave(bot.tile()), 'rope on winch 2');
            await opThen(w2, 1, () => inCave(bot.tile()), [], 'winch 2 down');
            if (!inCave(bot.tile())) fail(bot, 'winch 2: not in the cave (permit?)');
            step(); await talkTo(bot, N.worker2, [], { done: () => bot.count(O.key) > 0 && !inDialog(bot), at: T.worker2,
                answers: [/I have been invited to research here/i, /Do you know where to find a chest key/i, /I don't suppose I could use it/i, /^Please\?/i, /Aww\.\.\. go on/i, /^Pretty please!$/i, /Pretty please with sugar on top/i],
                maxTicks: 90, label: 'worker2 key', tries: 3 });
            dismiss(bot);
            if (bot.count(O.key) === 0) fail(bot, 'no chest key');
            await opThen(loc(L.ropeW), 1, () => !inCave(bot.tile()), [], 'rope up (west)');
            Lg('chest key');
        }
        await walk({ x: 3374, z: 3377 }, 'chest', 2);
        await useOnLocThen(O.key, loc(L.chest), () => bot.count(O.key) === 0, 'key on chest');
        // the open chest is the loc_change'd id 2360 on the same tile for 300 t (area_digsite.rs2:780-792)
        await opThen({ ...loc(L.chest), id: L.chestOpen.id }, 1, () => bot.count(O.powder) > 0, [], 'chest powder');
        if (bot.count(O.powder) === 0) fail(bot, 'no powder');
        Lg('powder');
    }
    async function mix1(): Promise<void> {
        if (bot.count(O.nitrate) > 0 && bot.count(O.nitro) > 0 && !(await retry(bot, useOn(O.nitrate, O.nitro), () => bot.count(O.pre) > 0, 10, 3))) fail(bot, 'mix nitroglycerin + nitrate');
        if (bot.count(O.charcoal) > 0 && !(await retry(bot, useOn(O.charcoal, O.pestle), () => bot.count(O.ground) > 0, 10, 3))) fail(bot, 'grind charcoal');
        if (bot.count(O.pre) > 0 && !(await retry(bot, useOn(O.pre, O.ground), () => bot.count(O.post) > 0, 10, 3))) fail(bot, 'mix charcoal');
        Lg('mixture (root still to add)');
    }
    async function eastCave(): Promise<void> {
        // resume: the tablet held (or in the cleared cave past the blast): no root / compound / blast
        if (RES && (bot.count(O.tablet) > 0 || (inCave(bot.tile()) && bot.tile().z < 9792))) {
            if (bot.count(O.tablet) === 0) {
                const g = groundOf(bot, O.tablet, 15) ?? { x: T.tablet.x, z: T.tablet.z };
                if (!(await retry(bot, () => pickupGo(bot, O.tablet, g), () => bot.count(O.tablet) > 0, 40, 6))) fail(bot, 'stone tablet');
            }
            if (inCave(bot.tile())) await opThen(loc(L.ropeE), 1, () => !inCave(bot.tile()), [], 'rope up (east)');
            Lg('tablet (resume)');
            return;
        }
        const w1 = loc(L.winch1), r0 = bot.count(O.rope);
        if (!inCave(bot.tile())) await walk({ x: 3352, z: 3416 }, 'winch 1', 2);
        if (!inCave(bot.tile())) await useOnLocThen(O.rope, w1, () => bot.count(O.rope) < r0 || inCave(bot.tile()), 'rope on winch 1');
        if (!inCave(bot.tile())) await opThen(w1, 1, () => inCave(bot.tile()), [], 'winch 1 down');
        if (!inCave(bot.tile())) fail(bot, 'winch 1: not in the cave');
        // root (east cave spawn), compound
        if (bot.count(O.root) === 0 && bot.count(O.compound) === 0) {
            const g = groundOf(bot, O.root, 15) ?? { x: T.rootE.x, z: T.rootE.z };
            if (!(await retry(bot, () => pickupGo(bot, O.root, g), () => bot.count(O.root) > 0, 40, 6))) fail(bot, 'arcenia root');
        }
        // the compound is added after a chatplayer page (itexam_chemistry.rs2:52-62): send once, then page through
        if (bot.count(O.compound) === 0) {
            await retry(bot, useOn(O.post, O.root), () => bot.count(O.compound) > 0 || inDialog(bot), 12, 6);
            await talk(bot, [], [], { noOp: true, done: () => bot.count(O.compound) > 0 && !inDialog(bot), maxTicks: 12, label: 'compound' });
            dismiss(bot);
            if (bot.count(O.compound) === 0) fail(bot, 'compound (herblore 10)');
        }
        Lg('compound');
        const br = loc(L.brick);
        await walk(T.blastStand, 'blast stand', 0);
        await useOnLocThen(O.compound, br, () => bot.count(O.compound) === 0, 'pour compound');
        if (cheb(bot.tile(), T.blastStand) > 0) await walk(T.blastStand, 'blast stand 2', 0);
        // tinderbox only from (3379,9826); the run sequence teleports us into the cleared cave (z < 9792)
        step();
        await retry(bot, () => { if (cheb(bot.tile(), T.blastStand) > 0) return; bot.useItemOnLoc(br.x, br.z, br.id, O.tinder, bot.slot(O.tinder)); }, () => bot.tile().z < 9792 || inDialog(bot), 30, 8);
        await talk(bot, [], [], { noOp: true, done: () => bot.tile().z < 9792 && !inDialog(bot), maxTicks: 40, label: 'blast' });
        dismiss(bot);
        if (bot.tile().z >= 9792) fail(bot, 'blast: not through');
        Lg('blast');
        const g = groundOf(bot, O.tablet, 15) ?? { x: T.tablet.x, z: T.tablet.z };
        if (!(await retry(bot, () => pickupGo(bot, O.tablet, g), () => bot.count(O.tablet) > 0, 40, 6))) fail(bot, 'stone tablet');
        await opThen(loc(L.ropeE), 1, () => !inCave(bot.tile()), [], 'rope up (east)');
        if (inCave(bot.tile())) fail(bot, 'rope up (east)');
        Lg('tablet');
    }
}

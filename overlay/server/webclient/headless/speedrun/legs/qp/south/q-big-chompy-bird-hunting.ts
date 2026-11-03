/// <reference types="bun" />
// q-big-chompy-bird-hunting.ts — BIG CHOMPY BIRD HUNTING, cheat-free. Lane south (max-QP route).
//
// Flow (verified in the rev-289 content, paths relative to server/content/scripts/quests/quest_chompybird/ unless noted):
//  1. Rantz (2630,2981): "Ok, I'll make you some 'stabbers'." -> %chompybird 5 (rantz.rs2:26-49).
//  2. Fletch at least ONE ogre arrow yourself: it sets the made_arrows bit (skill_fletching/scripts/ogre_arrows.rs2:110-142;
//     knife on achey logs -> shafts, chisel on wolf bones -> tips, feathers -> headless, tips -> arrows; no delays).
//     Bought ogre arrows then count (rantz.rs2:263-275 checks the bit, then >= 6 arrows).
//  3. Give Rantz 6 arrows (-> 10), ask "How do we make the chompys come?" (-> 15, rantz.rs2:277-296).
//  4. Rantz's cave (entrance 2629,2998 -> 2647,9379, quest_chompybird.rs2:1-10): lift the rock off the ogre chest
//     (stat_random(strength, 30, 254), -> 20) and take the ogre bellows (ogre_chest.rs2:1-44).
//  5. Bellows on the swamp bubbles (3 charges, quest_chompybird.rs2:12-39), bellows on swamp toads -> bloated toads
//     (swamp_toad.rs2:68-117, max 3 held).
//  6. TALK to Rantz with a toad (-> 25; using the toad on him does not set the stage, rantz.rs2:62-73 vs :218-225).
//  7. Drop the toads in his clearing x2631-2639 z2962-2971 (bloated_toad.rs2:158-204). Each toad rolls 1/5 for a chompy
//     every 25 t, 4 rolls, then bursts (bloated_toad.rs2:213-241). A chompy spawned for us makes Rantz shoot and miss
//     15-30 t later (-> 40, chompy_bird.rs2:1-19, 221-253).
//  8. Rantz: "Come on, let me have a go..." / "I'm actually quite strong..." -> ogre bow (-> 45, rantz.rs2:85-109).
//     Wield it (ranged 30 BASE, levelrequire.rs2 levelrequire_ranged) + ogre arrows, shoot OUR chompy (10 hp,
//     chompy_bird.rs2:87-135) -> 50, pluck it (op4) -> raw chompy.
//  9. Show Rantz the chompy (-> 55, he names his seasoning: potato/onion, rantz.rs2:129-158), ask Bugs (equa leaves/
//     cabbage) and Fycie (tomato/doogle leaves) in the cave: their wish is set only at this stage (bugs.rs2:299-312,
//     fycie.rs2:369-382). Session 11 fix 386: NOT random on the rev-289 engine (random(1) is always 0): always onion / equa leaves /
//     tomato; the kit carries 3 of each wish + 1 of each alternate.
// 10. Raw chompy on the spit roast (2630,2990): cooking 30, stat_random(cooking, 200, 255) (raw_chompy.rs2:14-219) -> 60;
//     talk to Rantz, hand it over -> quest complete (rantz.rs2:331-344, quest_chompybird.rs2:42-51: 2 QP).
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { FOODS } from './south-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';
import { nav, navSync, talk, sendToks, R, M2, M3, M4, M5, qp, opNpcGo, opLocGo, pickupGo, walkOp, inDialog, dismiss, log as qlog, trace } from '../../q-lib.js';
import {
    fail, dead, locHere, liveId, retry, opLocUntil, useOnLocUntil, wear, eatIfLow, talkTo, chatMark, chatSince, groundOf, npc, npcsOf,
    locEvents, opNpcN, opNpcGoN, type Item, type Tile,
} from './south-lib.js';

export const QUEST = { name: 'Big Chompy Bird Hunting', dir: 'quest_chompybird', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        fletching: [5, 'ogre shafts / tips / headless / arrows: stat(fletching) >= 5 (skill_fletching ogre_arrows.rs2:29,52,79,119)'],
        crafting: [5, 'chisel the wolf bone tips: stat(crafting) >= 5 (ogre_arrows.rs2:56)'],
        cooking: [30, 'the spit roast: stat(cooking) >= 30 (raw_chompy.rs2:15); higher = fewer burns (stat_random 200/255)'],
        ranged: [30, 'wield the ogre bow: stat_BASE(ranged) >= 30 (bows.obj ogre_bow levelrequire 30, levelrequire.rs2 levelrequire_ranged)'],
        prayer: [43, 'optional: Protect from Melee against the east-swamp wolves (cl64, attack anyone below ~cl128); without it carry food'],
        strength: [1, 'optional: the ogre chest rock is stat_random(strength, 30, 254) per try (ogre_chest.rs2:12); low strength = retries'],
    } as Record<string, [number, string]>,
    start: { x: 2630, z: 2983, level: 0 },      // next to Rantz, Feldip Hills
    end: { x: 2630, z: 2983, level: 0 },
};
/** Ogre arrows the quest fletches for itself (6 for Rantz + the shooting; supply-gap change). */
export const ARROW_TARGET = 15;
const MIN_SHOTS = 5;
// fix 328 (qx96m: all 5 bones chiselled the minimum 2 tips -> 10 arrows, 'only 10 ogre arrows'; the leg retry then failed
// 'no ogre arrow made (made_arrows bit unset)' because it started with those 10 and had nothing left to cut, and the route
// stopped). The bit is server-side only (%chompybird_kills, ogre_arrows.rs2:141): remember in this process that we set it,
// and with fewer than 6 + MIN_SHOTS go on with what we have while one shot is left (successful runs shoot 2-5; stopping
// here can never get more arrows). CH_SHORT=0 reverts.
const CH_SHORT = process.env.CH_SHORT !== '0';
// session 11 fix 360: wait out our own bait toads before a new bait round (see chompyHunt). CH_BAIT_WAIT=0 reverts.
const CH_BAIT_WAIT = process.env.CH_BAIT_WAIT !== '0';
let madeArrows = false;
/** Tradeable inputs: the quest fletches its own ogre arrows (no shop stocks them): 5 achey logs + 5 wolf bones make
 *  10-30 shafts/tips (2-6 each, ogre_arrows.rs2:34,60; >= 15 arrows ~90%, >= 11 ~99%), 4 feathers per arrow. Helpered
 *  ogre arrows still work (then 1 log + 1 bone + 4 feathers suffice for the made_arrows bit). Seasonings: the three wishes
 *  are fixed (onion / equa leaves / tomato, fix 386) x3 for burns, the three alternates x1. Pack at the start: 27 slots. */
// session 11 fix 386 (qx313m STOP: 3 burns in a row at cooking 54 (27/256 each) ate 2 kit + 1 bank spare of the wished
// seasonings; qx210/qx230 2 burns = a 350-t route retry): the wishes are NOT random on the rev-289 engine. random(1) is always 0
// (NumberOps RANDOM pushInt(nextDouble()*n) -> toInt32), so rantz.rs2:138 / bugs.rs2:56 / fycie.rs2:54 always give
// onion / equa leaves / tomato (265/265 'stage 55 (Onion)'). The same 12 slots: 3 of each wish (2 burns in-leg), 1 of each
// alternate (a hedge). CH_WISH=0 reverts (2 of each six).
const CH_WISH = process.env.CH_WISH !== '0';
const WISHED = ['onion', 'equa_leaves', 'tomato'];
export const SUPPLY: Item[] = [
    { name: 'knife', n: 1 }, { name: 'chisel', n: 1 }, { name: 'achey_tree_logs', n: 5 }, { name: 'wolf_bones', n: 5 },
    { name: 'feather', n: 60 },
    // a burn on the spit eats the three wished seasonings (raw_chompy.rs2:208-219) and a second chompy needs them again
    ...['potato', 'onion', 'equa_leaves', 'cabbage', 'tomato', 'doogleleaves'].map(name => ({ name, n: CH_WISH ? (WISHED.includes(name) ? 3 : 1) : 2 })),
    { name: 'shark', n: 2 },
];
// session 11 fix 350: one spare of each seasoning, BANK only (route-legs chompy bankStage; CH_SPARE=0 = none)
export const SEASON_SPARE: Item[] = ['potato', 'onion', 'equa_leaves', 'cabbage', 'tomato', 'doogleleaves'].map(name => ({ name, n: 1 }));

const O = {
    knife: objId('knife'), chisel: objId('chisel'), logs: objId('achey_tree_logs'), bones: objId('wolf_bones'), feather: objId('feather'),
    shaft: objId('ogre_arrow_shaft'), headless: objId('ogre_headless_arrow'), tips: objId('wolfbone_arrowheads'), arrow: objId('ogre_arrow'),
    bellows0: objId('empty_ogre_bellows'), bellows: [objId('filled_ogre_bellow3'), objId('filled_ogre_bellow2'), objId('filled_ogre_bellow1')],
    toad: objId('bloated_toad'), raw: objId('raw_chompy'), cooked: objId('cooked_s_chompy'), ruined: objId('ruined_chompy'), bow: objId('ogre_bow'),
};
const NPC = { rantz: 1010, fycie: 1011, bugs: 1012, toad: 1013, baitToad: 1014, chompy: 1015, chompyDead: 1016 };
const T = {
    rantz: { x: 2630, z: 2981 }, caveStand: { x: 2630, z: 2997 }, caveIn: { x: 2647, z: 9379 }, chestStand: { x: 2637, z: 9399 },
    bugs: { x: 2640, z: 9391 }, fycie: { x: 2650, z: 9393 }, swamp: { x: 2600, z: 2964 }, drop: { x: 2635, z: 2966 },
};
const DROP_ZONE = (t: Tile) => t.x >= 2631 && t.x <= 2639 && t.z >= 2962 && t.z <= 2971;   // bloated_toad.rs2:165
const inCave = (bot: SpeedBot) => bot.tile().z > 6400;
let burnTestFired = false;
let spareTestFired = false;   // session 11 fix 350 TEST (CH_SPARE_TEST=1)
let wishTestFired = false;    // session 11 fix 386 TEST (CH_WISH_TEST=1)
/** fix 311 (CHOMPY_ARROWS=0 reverts 311a-c): qx73m x2 + qze05 'no (second) raw chompy'. CONFIRMED (engine optrace
 *  eng-qx73.log): the 2nd hunt shot npc 1015@2630,2958 at t32417 and npc 1015@2628,2972 at t32418 (two birds, 14 tiles
 *  apart in 1 tick: each toad rolls its own chompy, bloated_toad.rs2 ai_queue4) with the 5 arrows left from the first kill;
 *  from t32429 every attack was 'target cleared' = "There is no ammo left in your quiver" (chompy_bird.rs2
 *  player_combat_chompybird_start); the spent arrows lay on the ground (ranged_dropammo_npc: 4/5 land, 200 t) and the
 *  retry had no arrows and no achey logs (bank lacks them) -> 4 dead bait rounds per attempt.
 *  311a one bird: keep shooting the same chompy (by index) until it dies or leaves view.
 *  311b pick our spent ogre arrows back up (out of ammo mid-fight, and after every hunt), wield them into the quiver.
 *  311c no arrows worn/held/on the ground -> fail at once (4 bait rounds cannot work). */
const ARROWS_FIX = () => process.env.CHOMPY_ARROWS !== '0';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    const t0 = bot.tickCount, qp0 = qp(bot);
    bot.holdDialogs = true;
    trace(bot, t0);
    const L = (s: string) => { if (o.log !== false) qlog(bot, t0, `${s} | hp ${bot.stat('hitpoints').cur}`); failHook(s.split(/[(]/)[0]!.trim()); };
    // chat pages are split over several text components (one per line): match the joined text
    const seen = (re: RegExp) => re.test([...bot.ifText.values()].join(' '));
    locEvents(bot);
    // session 10: on a retry / resume, the stages the quest JOURNAL shows done are skipped (chompybird_journal.rs2: the text
    // accumulates, one line per stage reached). All false on a fresh attempt. CHOMPY_RESUME=0 reverts.
    const J = { started: false, arrows: false, toadTalk: false, shown: false, killed: false, showed: false, cooked: false, done: false };
    if (isResuming(bot) && process.env.CHOMPY_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const j = await readJournal(bot, 'chompybird');
        if (j.ok) {
            const r = (re: RegExp) => re.test(j.text);
            J.done = r(/QUEST COMPLETE/i); J.cooked = J.done || r(/I've cooked the chompy/i); J.showed = J.cooked || r(/I showed Rantz the chompy/i);
            J.killed = J.showed || r(/I've killed a chompy bird/i); J.shown = J.killed || r(/took the 'fatsy toady' to Rantz/i);
            J.toadTalk = J.shown || r(/fatsy toadies' grow fat/i); J.arrows = J.toadTalk || r(/stabbers' are a kind of/i); J.started = J.arrows || r(/agreed to get Rants/i);
        }
        L(`[journal] chompybird: ${j.ok ? (Object.keys(J).filter(k => (J as Record<string, boolean>)[k]).join(',') || 'not started') : 'UNREADABLE'} (${j.ticks} t)`);
        if (J.done) return { ok: true, ticks: bot.tickCount - t0, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
    }
    try {
        // ---- 0. pack: keep the supply (+ quest items); everything else goes
        const keep = new Set([...SUPPLY.map(i => objId(i.name)), ...FOODS.flatMap(f => { try { return [objId(f)]; } catch { return []; } }), O.arrow, O.shaft, O.headless, O.tips, O.bellows0, ...O.bellows, O.toad, O.raw, O.cooked, O.bow,
            ...(['lawrune', 'airrune', 'waterrune', 'earthrune', 'firerune', 'coins', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4']).map(n => objId(n))]);   // route runner: keep the travel kit
        const junk = [...new Set(bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj))];
        if (junk.length) { L(`dropping ${junk.map(objDebugName).join(',')}`); await bot.dropAll(junk); }

        // ---- 1. Rantz: start
        if (!J.started) {
        const t1 = await talkTo(bot, NPC.rantz, [R, M4[2]!, R, R], { done: () => seen(/sticksies from achey tree/i) && !inDialog(bot),
            answers: [/Ok, I'll make you some/i], maxTicks: 30, label: 'rantz start', tries: 4, at: T.rantz });
        if (!t1) fail(bot, 'Rantz: quest not started');
        L('started');
        }
        if (!J.arrows) {
        // ---- 2. fletch one batch (sets the made_arrows bit): logs+knife and bones+chisel, feathers on a shaft, tips on it
        const useOn = (target: number, used: number) => () => { const a = bot.slot(target), b = bot.slot(used); if (a >= 0 && b >= 0) bot.useItemOnItem(target, a, used, b); };
        // Supply-gap change: no shop stocks ogre arrows, so the quest fletches ARROW_TARGET of them from the
        // supplied achey logs / wolf bones / feathers (2-6 shafts per log, 2-6 tips per bone, 4 feathers per arrow, up to 6
        // per feather/tip action: ogre_arrows.rs2:34,60,83-90,123-125; no delays). Helpered ogre arrows still count: with
        // >= ARROW_TARGET in the pack only one batch is made (the made_arrows bit). Cut every log and chisel every bone
        // first: the stacks free the log/bone slots before the headless + arrow stacks appear (28-slot pack).
        const a0 = bot.count(O.arrow);
        const arrows = () => bot.count(O.arrow);
        if (arrows() >= ARROW_TARGET) {   // helpered arrows: one log + one bone is all we cut (and a full pack has no slot for the headless stack)
            for (const id of [O.logs, O.bones]) { const s = bot.inv().filter(x => x.obj === id).slice(1).map(x => x.slot); for (const sl of s) bot.dropItem(id, sl); bot.queueFlush(); }
            await bot.until(() => bot.count(O.logs) <= 1 && bot.count(O.bones) <= 1, 6);
        }
        const step = async (send: () => void, done: () => boolean, what: string) => { if (!(await retry(bot, send, done, 8, 2))) fail(bot, `fletch: ${what}`); };
        while (bot.count(O.logs) > 0 && (bot.count(O.shaft) + bot.count(O.headless) === 0 || bot.count(O.shaft) + bot.count(O.headless) + arrows() < ARROW_TARGET)) {
            const n = bot.count(O.logs); await step(useOn(O.logs, O.knife), () => bot.count(O.logs) < n, 'shafts');
        }
        while (bot.count(O.bones) > 0 && (bot.count(O.tips) === 0 || bot.count(O.tips) + arrows() < ARROW_TARGET)) {
            const n = bot.count(O.bones); await step(useOn(O.bones, O.chisel), () => bot.count(O.bones) < n, 'tips');
        }
        for (let k = 0; k < 20 && !(arrows() > a0 && arrows() >= ARROW_TARGET); k++) {
            if (bot.count(O.headless) > 0 && bot.count(O.tips) > 0) { const n = arrows(); await step(useOn(O.headless, O.tips), () => arrows() > n, 'ogre arrows'); }
            else if (bot.count(O.shaft) > 0 && bot.count(O.feather) >= 4 && bot.count(O.tips) > 0) { const n = bot.count(O.headless); await step(useOn(O.shaft, O.feather), () => bot.count(O.headless) > n, 'headless'); }
            else break;
        }
        if (arrows() > a0) madeArrows = true;
        if (arrows() <= a0 && !(CH_SHORT && madeArrows)) fail(bot, 'fletch: no ogre arrow made (made_arrows bit unset)');
        if (arrows() < 6 + MIN_SHOTS) {
            if (!CH_SHORT || arrows() < 7) fail(bot, `fletch: only ${arrows()} ogre arrows (need 6 for Rantz + ${MIN_SHOTS} to shoot)`);
            console.log(`[chompy] 328: only ${arrows()} ogre arrows (want ${6 + MIN_SHOTS}): going on with ${arrows() - 6} shots`);
        }
        await bot.dropAll([O.shaft, O.tips, O.headless, O.knife, O.chisel, O.feather, O.logs, O.bones].filter(id => bot.count(id) > 0));
        L(`fletched (ogre arrows ${a0} -> ${arrows()})`);
        // ---- 3. Rantz: 6 arrows + "How do we make the chompys come?" (-> 15)
        const ar0 = bot.count(O.arrow);
        const t3 = await talkTo(bot, NPC.rantz, [R, R, R, R, R, M5[0]!, R, R, R, M5[4]!, R], {
            done: () => bot.count(O.arrow) <= ar0 - 6 && seen(/fussie eaters/i) && !inDialog(bot),
            answers: [/make the chompys come/i, /^Ok, thanks/i], maxTicks: 40, label: 'rantz arrows', tries: 4, at: T.rantz });
        if (!t3) fail(bot, 'Rantz: arrows / toadies talk');
        L('arrows given (stage 15)');
        } else if (!J.toadTalk) {
            // resume at stage 10 (arrows given, the toadies question not asked)
            const t3b = await talkTo(bot, NPC.rantz, [], { done: () => seen(/fussie eaters/i) && !inDialog(bot), answers: [/make the chompys come/i, /^Ok, thanks/i], maxTicks: 40, label: 'rantz toadies (resume)', tries: 4, at: T.rantz });
            if (!t3b) fail(bot, 'Rantz: toadies talk (resume)');
        }
        const hasBellows = () => bot.count(O.bellows0) > 0 || O.bellows.some((b: number) => bot.count(b) > 0);
        if (!hasBellows()) {
        // ---- 4. cave: the ogre chest -> bellows; out again
        await enterCave(bot);
        const chest = locHere(3377, 2637, 9398, 0);
        const chestOpen = () => liveId(bot, chest.x, chest.z, 3377) === 3378;
        for (let k = 0; k < 12 && bot.count(O.bellows0) === 0; k++) {
            if (!chestOpen()) {
                const mk = chatMark(bot);
                await opLocUntil(bot, chest, 1, () => chestOpen() || chatSince(bot, mk, /too heavy|ask permission/i), 30, 10);
                if (chatSince(bot, mk, /ask permission/i)) fail(bot, 'ogre chest: stage < 15 (Rantz talk incomplete)');
                if (!chestOpen()) continue;
            }
            const open = { ...chest, id: 3378 };
            await retry(bot, () => { if (bot.chatModalId !== -1) bot.resumeDialogPage(); opLocGo(bot, open, 1); }, () => bot.count(O.bellows0) > 0, 8, 3);
        }
        if (bot.count(O.bellows0) === 0) fail(bot, 'no ogre bellows');
        dismiss(bot);
        L('bellows');
        await leaveCave(bot);
        }
        // ---- 5-7. toads -> Rantz -> bait -> his miss -> bow -> our kill -> raw chompy
        let shown = J.shown, haveBow = bot.count(O.bow) > 0 || bot.isWorn(O.bow);
        for (let round = 0; round < 4 && bot.count(O.raw) === 0 && !J.showed; round++) {
            await getToads(bot, 3, L);
            if (!shown) {
                const t6 = await talkTo(bot, NPC.rantz, [R, R, R, R, R, R, R], { done: () => seen(/put da toadies over der/i) && !inDialog(bot), maxTicks: 30, label: 'rantz toad', tries: 4, at: T.rantz });
                if (!t6) fail(bot, 'Rantz: show toad');
                shown = true;
                L('toad shown (stage 25)');
            }
            await dropToads(bot, L);
            const got = await chompyHunt(bot, haveBow, L);
            haveBow = bot.count(O.bow) > 0 || bot.isWorn(O.bow);
            if (got) break;
        }
        if (bot.count(O.raw) === 0 && !J.showed) fail(bot, 'no raw chompy after 4 bait rounds');
        L('raw chompy');
        // ---- 8. show Rantz (-> 55), then Bugs + Fycie in the cave
        if (!J.cooked) {
        if (!J.showed) {
        if (!npc(bot, NPC.rantz) || npc(bot, NPC.rantz)!.d > 10) await walkOp(bot, T.rantz, null, () => (npc(bot, NPC.rantz)?.d ?? 99) <= 6, { near: 2, maxTicks: 200 });
        await retry(bot, () => { const r = npc(bot, NPC.rantz); if (r && !inDialog(bot)) { opNpcGo(bot, r, 1); bot.useItemOnNpc(r.idx, O.raw, bot.slot(O.raw)); } },
            () => inDialog(bot), 30, 6);
        await talk(bot, NPC.rantz, [R, R, R, R, R, R, R], { noOp: true, done: () => seen(/wants (Potato|Onion)/i) && !inDialog(bot), maxTicks: 30, label: 'rantz chompy' });
        if (!seen(/wants (Potato|Onion)/i)) fail(bot, 'Rantz did not name his seasoning (stage 55)');
        dismiss(bot);
        L(`stage 55 (${[...bot.ifText.values()].find(v => /wants (Potato|Onion)/i.test(v))?.match(/wants (\w+)/i)?.[1]})`);
        }
        await enterCave(bot);
        if (!(await talkTo(bot, NPC.bugs, [R], { done: () => seen(/has to have (equa leaves|cabbage)/i) && !inDialog(bot), maxTicks: 20, label: 'bugs', tries: 4, at: T.bugs }))) fail(bot, 'Bugs: no seasoning');
        if (!(await talkTo(bot, NPC.fycie, [R], { done: () => seen(/wants (tomato|doogle leaves) wiv mine/i) && !inDialog(bot), maxTicks: 20, label: 'fycie', tries: 4, at: T.fycie }))) fail(bot, 'Fycie: no seasoning');
        L('seasonings known');
        await leaveCave(bot);
        // ---- 9. spit roast -> Rantz
        // a burn (stat_random(cooking, 200, 255): ~10% at cooking 55, raw_chompy.rs2:192) costs the chompy: bait again, shoot
        // another (the stage stays 55 and the seasoning wishes stay set), cook again
        const spit = locHere(3375, 2630, 2990, 0);
        // fix 311 TEST (CHOMPY_BURN_TEST=1): once per process, drop the raw chompy before the spit = a burn, so the second
        // hunt runs with the arrows left over from the first (the qx73m / qze05 path)
        if (process.env.CHOMPY_BURN_TEST === '1' && !burnTestFired && bot.count(O.raw) > 0) {
            burnTestFired = true;
            L(`CHOMPY_BURN_TEST: dropping the raw chompy (arrows worn ${bot.ackWornCount(O.arrow)}, pack ${bot.count(O.arrow)})`);
            await bot.dropAll([O.raw]);
        }
        // session 11 fix 350 TEST (CH_SPARE_TEST=1): once per process, drop every seasoning before the spit = the qx145m state
        // after two burns (the cook is refused, the raw chompy stays); the retry must restock from the bank spare
        if (process.env.CH_SPARE_TEST === '1' && !spareTestFired && bot.count(O.raw) > 0) {
            spareTestFired = true;
            const sz = SEASON_SPARE.map(i => objId(i.name)).filter(id => bot.count(id) > 0);
            L(`CH_SPARE_TEST: dropping the seasonings`); await bot.dropAll(sz);
        }
        // session 11 fix 386 TEST (CH_WISH_TEST=1): once per process, drop 2 of each wished seasoning before the spit = the
        // state after two burns; with 386 one of each is left and the cook goes on in this attempt (CH_WISH=0: refused -> retry)
        if (process.env.CH_WISH_TEST === '1' && !wishTestFired && bot.count(O.raw) > 0) {
            wishTestFired = true;
            for (const w of WISHED) { const id = objId(w), n = Math.min(2, bot.count(id)); for (let k = 0; k < n; k++) { const s = bot.slot(id); if (s >= 0) { bot.dropItem(id, s); await bot.until(() => bot.slot(id) !== s, 3); } } }
            L(`CH_WISH_TEST: dropped 2 of each wish, left ${WISHED.map(w => `${w} ${bot.count(objId(w))}`).join(', ')}`);
        }
        for (let attempt = 0; attempt < 3 && bot.count(O.cooked) === 0; attempt++) {
            if (bot.count(O.raw) === 0) {
                L('burnt: hunting another chompy');
                await bot.dropAll([O.ruined].filter(id => bot.count(id) > 0));
                for (let round = 0; round < 4 && bot.count(O.raw) === 0; round++) {
                    await getToads(bot, 3, L); await dropToads(bot, L); await chompyHunt(bot, true, L);
                }
                if (bot.count(O.raw) === 0) fail(bot, 'no second raw chompy');
            }
            const mk9 = chatMark(bot);
            // session 11 fix 350: name the refusal (raw_chompy.rs2: the three wished seasonings are gone, burns eat them)
            if (!(await useOnLocUntil(bot, O.raw, spit, () => bot.count(O.cooked) > 0 || bot.count(O.raw) === 0, 30, 8))) fail(bot, seen(/all the ingredients yet/i) ? 'spit roast: no wished seasonings left (burns ate them; a retry restocks from the bank spare)' : 'spit roast');
            if (bot.count(O.cooked) === 0) await bot.until(() => bot.count(O.cooked) > 0 || chatSince(bot, mk9, /burn the chompy/i), 8);
            dismiss(bot);
        }
        if (bot.count(O.cooked) === 0) fail(bot, 'chompy not cooked after 3 tries');
        }
        L(`cooked (ogre arrows left: worn ${bot.ackWornCount(O.arrow)}, pack ${bot.count(O.arrow)})`);
        await talkTo(bot, NPC.rantz, [R, R, R, R, R, R], { done: () => qp(bot) >= qp0 + QUEST.qp, maxTicks: 30, label: 'rantz hand-in', tries: 4, at: T.rantz });
        if (!(await bot.until(() => qp(bot) >= qp0 + QUEST.qp, 10))) fail(bot, 'no quest points after the hand-in');
        L('QUEST COMPLETE');
        return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message };
    }
}

async function enterCave(bot: SpeedBot): Promise<void> {
    if (inCave(bot)) return;
    const ent = locHere(3379, 2629, 2998, 0);
    if (!(await walkOp(bot, T.caveStand, () => bot.opLoc(ent.x, ent.z, ent.id, 1), () => inCave(bot), { near: 1, maxTicks: 120 }))) {
        if (!(await opLocUntil(bot, ent, 1, () => inCave(bot), 30, 6))) fail(bot, 'cave entrance');
    }
    await bot.tick(1);
}
async function leaveCave(bot: SpeedBot): Promise<void> {
    if (!inCave(bot)) return;
    const ex = locHere(3381, 2647, 9377, 0);
    if (!(await opLocUntil(bot, ex, 1, () => !inCave(bot), 60, 8))) fail(bot, 'cave exit');
    await bot.tick(1);
}

/** The east swamp's wolves (cl64, huntmode cowardly = they attack anyone below ~cl128 outside the wilderness,
 *  _unpack/225/all.npc [wolf] + all.hunt [cowardly]) hunt within 2 tiles: Protect from Melee while we are near them
 *  (prayer 43), and eat at half hp. */
function guardSwamp(bot: SpeedBot): void {
    eatIfLow(bot);
    if (bot.stat('prayer').level >= 43 && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
}
function prayOff(bot: SpeedBot): void { if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); } }

/** Fill the bellows at the swamp bubbles and inflate `n` swamp toads (one charge each). */
async function getToads(bot: SpeedBot, n: number, L: (s: string) => void): Promise<void> {
    const charges = () => bot.count(O.bellows[0]!) * 3 + bot.count(O.bellows[1]!) * 2 + bot.count(O.bellows[2]!);
    const held = () => O.bellows.find(b => bot.count(b) > 0) ?? (bot.count(O.bellows0) > 0 ? O.bellows0 : -1);
    if (cheb(bot.tile(), T.swamp) > 8) await walkOp(bot, T.swamp, null, () => cheb(bot.tile(), T.swamp) <= 3, { near: 3, maxTicks: 150 });
    guardSwamp(bot);
    const t0 = bot.tickCount;
    while (bot.count(O.toad) < n && bot.tickCount - t0 < 200) {
        if (dead(bot)) fail(bot, 'died at the swamp');
        guardSwamp(bot);
        if (charges() === 0) {
            // most bubbles sit inside the pool with no walkable neighbour: use the south-edge one from (2598,2962)
            const bub = locHere(684, 2598, 2963, 0), b0 = held();
            await walkOp(bot, { x: 2598, z: 2962 }, () => { const sl = bot.slot(b0); if (sl >= 0) bot.useItemOnLoc(bub.x, bub.z, bub.id, b0, sl); }, () => charges() > 0, { maxTicks: 40 });
            continue;
        }
        const t = npcsOf(bot, NPC.toad).filter(q => q.d <= 12)[0];
        if (!t) { eatIfLow(bot); await bot.tick(2); continue; }
        const c0 = bot.count(O.toad), b = held();
        opNpcGo(bot, t, 1); bot.useItemOnNpc(t.idx, b, bot.slot(b)); bot.queueFlush();
        await bot.until(() => bot.count(O.toad) > c0, 10);
    }
    if (bot.count(O.toad) < n) fail(bot, `only ${bot.count(O.toad)} bloated toads`);
    prayOff(bot);
    L(`${bot.count(O.toad)} bloated toads`);
}

/** Walk into Rantz's clearing and drop every toad on its own tile (each drop pushes us one tile, bloated_toad.rs2:203). */
async function dropToads(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (!DROP_ZONE(bot.tile())) await walkOp(bot, T.drop, null, () => DROP_ZONE(bot.tile()) && cheb(bot.tile(), T.drop) <= 1, { near: 1, maxTicks: 150 });
    for (let k = 0; k < 12 && bot.count(O.toad) > 0; k++) {
        if (!DROP_ZONE(bot.tile())) { await walkOp(bot, T.drop, null, () => DROP_ZONE(bot.tile()), { near: 1, maxTicks: 40 }); }
        const c0 = bot.count(O.toad), mk = chatMark(bot);
        if (bot.chatModalId !== -1) bot.resumeDialogPage();
        bot.opHeld1(O.toad, bot.slot(O.toad)); bot.queueFlush();
        await bot.until(() => bot.count(O.toad) < c0 || chatSince(bot, mk, /already placed|too far away/i), 4);
        if (chatSince(bot, mk, /already placed/i)) { const me = bot.tile(); bot.sendRoute([{ x: me.x + (me.x < 2638 ? 1 : -1), z: me.z }]); await bot.tick(2); }
        await bot.tick(1);
    }
    L(`toads placed (${bot.count(O.toad)} left)`);
}

/** Wait for our chompy; first time Rantz misses it and lends the bow, then we shoot + pluck it. True = raw chompy held. */
async function chompyHunt(bot: SpeedBot, haveBow: boolean, L: (s: string) => void): Promise<boolean> {
    const t0 = bot.tickCount;
    // chat pages are split over several text components (one per line): match the joined text
    const seen = (re: RegExp) => re.test([...bot.ifText.values()].join(' '));
    const mk = chatMark(bot);
    // a placed toad lives <= 4 rolls x 25 t; Rantz shoots 15-30 t after the spawn (chompy_bird.rs2:12, 221-253)
    while (bot.tickCount - t0 < 130) {
        if (dead(bot)) fail(bot, 'died');
        if (!haveBow && chatSince(bot, mk, /keeps missing the chompy/i)) break;
        if (haveBow && npc(bot, NPC.chompy)) break;
        if (!npcsOf(bot, NPC.baitToad).length && !npc(bot, NPC.chompy) && bot.tickCount - t0 > 30) { L('all bait gone, no chompy'); return false; }
        await bot.tick(1);
    }
    if (!haveBow) {
        if (!chatSince(bot, mk, /keeps missing the chompy/i)) { L('no chompy spawned this round'); return false; }
        L(`Rantz missed (wait ${bot.tickCount - t0} t)`);
        const ok = await talkTo(bot, NPC.rantz, [R, R, M2[1]!, R, R, M2[0]!, R, R], { done: () => bot.count(O.bow) > 0 || bot.isWorn(O.bow),
            answers: [/let me have a go/i, /quite strong/i], maxTicks: 30, label: 'rantz bow', tries: 4, at: T.rantz });
        if (!ok) fail(bot, 'Rantz: no ogre bow');
        dismiss(bot);
        // session 11 fix 400b (qx401m: the wield went out as the ws dropped (close 1006, chaos; RECONNECTED 4 t later) and the
        // 6-t wear wait (south-lib.ts wear) failed the quest with the bow in the pack; the runner's retry wore it fine): one more
        // try after 5 t. CH_WEAR2=0 reverts; CH_WEAR2_TEST=1 skips the first wear to exercise the second.
        let worn = process.env.CH_WEAR2_TEST === '1' ? false : await wear(bot, ['ogre_bow', 'ogre_arrow']);
        if (!worn && process.env.CH_WEAR2 !== '0') { L('ogre bow: wield again'); await bot.tick(5); dismiss(bot); worn = await wear(bot, ['ogre_bow', 'ogre_arrow'], 8); }
        if (!worn) fail(bot, 'wield the ogre bow (ranged 30 base?) + ogre arrows');
        L('ogre bow');
    } else if (!bot.isWorn(O.bow)) await wear(bot, ['ogre_bow', 'ogre_arrow']);
    // 311b/c: an empty quiver -> our spent arrows from the ground first; none anywhere = this hunt cannot work
    const fix = ARROWS_FIX();
    if (fix) {
        await wieldArrows(bot);
        if (bot.ackWornCount(O.arrow) <= 0) await collectArrows(bot, L, 40);
        if (bot.ackWornCount(O.arrow) <= 0 && bot.count(O.arrow) <= 0) fail(bot, 'no ogre arrows left (worn 0, pack 0, none on the ground)');
    }
    // shoot our chompy (op5 Attack); it dies into chompybird_dead (op4 Pluck) -> raw chompy on the ground
    const t1 = bot.tickCount;
    let lastAtk = -100, tgt = -1;
    const done = async (got: boolean): Promise<boolean> => { if (fix) { await bot.tick(2); await collectArrows(bot, L, 40); } return got; };
    while (bot.tickCount - t1 < (CH_BAIT_WAIT ? 200 : 120)) {
        if (dead(bot)) fail(bot, 'died');
        if (bot.chatModalId !== -1 && !bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); }
        const dead1 = npc(bot, NPC.chompyDead);
        if (dead1) {
            const r0 = bot.count(O.raw);
            await retry(bot, () => { const d = npc(bot, NPC.chompyDead); if (d) opNpcGoN(bot, d, 4); else { const g = groundOf(bot, O.raw, 8); if (g) pickupGo(bot, O.raw, g); } },
                () => bot.count(O.raw) > r0, 20, 3);
            if (bot.count(O.raw) > r0) { L(`chompy killed + plucked (${bot.tickCount - t1} t, worn arrows ${bot.ackWornCount(O.arrow)})`); return done(true); }
        }
        const g = groundOf(bot, O.raw, 8);
        if (g) { await retry(bot, () => pickupGo(bot, O.raw, g), () => bot.count(O.raw) > 0, 10, 3); if (bot.count(O.raw) > 0) return done(true); }
        // 311b: quiver empty mid-fight -> pick the spent arrows up (the bird lives 100 t) and go on
        if (fix && bot.ackWornCount(O.arrow) === 0) {
            await wieldArrows(bot);
            if (bot.ackWornCount(O.arrow) <= 0) {
                const got = await collectArrows(bot, L, 30);
                if (!got && bot.ackWornCount(O.arrow) <= 0) { L('quiver empty, no arrows on the ground'); return done(false); }
                lastAtk = -100;
            }
        }
        // 311a: stay on one bird (two toads can each roll a chompy; switching splits the damage)
        const birds = npcsOf(bot, NPC.chompy);
        const c = (fix ? birds.find(b => b.idx === tgt) : undefined) ?? birds[0];
        if (c && fix && c.idx !== tgt) { if (tgt !== -1) L(`chompy target ${tgt} gone: now ${c.idx} (${birds.length} in view)`); tgt = c.idx; lastAtk = -100; }
        // session 11 fix 360 (CH_BAIT_WAIT; qx168m 'no raw chompy after 4 bait rounds', 606 t): a chompy lives 100 t
        // (chompy_bird.rs2:5); 'gone' ended the round 6 t after our bird left view: round 2 (we stood at Rantz, the bird ~23
        // tiles off), rounds 3+4 (we had locked onto the PREVIOUS round's bird, which despawned 10-15 t later: eng-qx168
        // t32565-75, t32665-80 'active false', no 1016) while this round's toads were still rolling. Out of view: walk back to the
        // drop zone first; our bait toads still in view: wait for their bird instead of a new round. =0 reverts.
        if (!c && CH_BAIT_WAIT) {
            if (cheb(bot.tile(), T.drop) > 8) { await walkOp(bot, T.drop, null, () => !!npc(bot, NPC.chompy) || dead(bot), { near: 3, maxTicks: 30 }); continue; }
            if (npcsOf(bot, NPC.baitToad).length && bot.tickCount - t1 < 180) { if (tgt !== -1) { L(`chompy ${tgt} gone; our bait is still out: waiting`); tgt = -1; } await bot.tick(1); continue; }
        }
        if (!c) { if (bot.tickCount - t1 > 6) { L('our chompy is gone'); return done(false); } await bot.tick(1); continue; }
        // shoot from range: the ogre bow reaches 10 (bows.obj ogre_bow attackrange 10) and the ap trigger needs no walk;
        // walking next to it (opNpcGo) makes it screech and flee (chompy_bird.rs2:64-75, huntall within 2)
        if (bot.tickCount - lastAtk >= 6) {
            if (c.d > 9) { const me = bot.tile(); const step = { x: me.x + Math.sign(c.x - me.x) * Math.min(Math.abs(c.x - me.x), c.d - 6), z: me.z + Math.sign(c.z - me.z) * Math.min(Math.abs(c.z - me.z), c.d - 6) }; bot.sendRoute([step]); }
            opNpcN(bot, c.idx, 5); lastAtk = bot.tickCount;
        }
        await bot.tick(1);
    }
    return done(bot.count(O.raw) > 0);
}

/** 311b: wield every held ogre arrow into the quiver (core wear() skips an item that is already worn). */
async function wieldArrows(bot: SpeedBot): Promise<void> {
    if (!bot.isWorn(O.bow) || bot.count(O.arrow) <= 0) return;
    const w0 = Math.max(0, bot.ackWornCount(O.arrow));
    await retry(bot, () => { const s = bot.slot(O.arrow); if (s >= 0) { bot.opHeld2(O.arrow, s); bot.queueFlush(); } }, () => bot.count(O.arrow) <= 0 || bot.ackWornCount(O.arrow) > w0, 8, 3);
}

/** 311b: pick up our spent ogre arrows within 10 tiles (ranged_dropammo_npc drops 4 of 5 on the bird's tile, 200 t), then
 *  wield them. True = at least one picked up. */
async function collectArrows(bot: SpeedBot, L: (s: string) => void, maxTicks: number): Promise<boolean> {
    const t0 = bot.tickCount, skip = new Set<string>();
    const total = () => Math.max(0, bot.count(O.arrow)) + Math.max(0, bot.ackWornCount(O.arrow));
    const n0 = total();
    let piles = 0;
    while (bot.tickCount - t0 < maxTicks) {
        if (dead(bot)) break;
        const g = (bot as any).findGroundItem(O.arrow, 10, skip) as { x: number; z: number } | undefined;
        if (!g) break;
        const c0 = total();
        if (bot.chatModalId !== -1 && !bot.dialogOptions().length) bot.resumeDialogPage();
        pickupGo(bot, O.arrow, g);
        if (await bot.until(() => total() > c0, Math.max(4, cheb(bot.tile(), g) + 3))) piles++;
        else skip.add(`${g.x},${g.z},${O.arrow}`);
    }
    await wieldArrows(bot);
    if (total() > n0) L(`picked up ${total() - n0} ogre arrows from ${piles} piles (${bot.tickCount - t0} t; worn ${bot.ackWornCount(O.arrow)}, pack ${bot.count(O.arrow)})`);
    return total() > n0;
}

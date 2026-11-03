// q-nature-spirit.ts — Nature Spirit (rev 289), cheat-free quest code. Content: quests/quest_druidspirit/scripts/
// {quest_druidspirit,filliman,ghast,swamp_decay}.rs2, areas/area_mausoleum/scripts/drezel.rs2 (start + blessing).
//
// Stages (quest_druidspirit.constant) and what sets each:
//   5   Drezel (mausoleum, PiP stage 61 + Wolfbane held/banked): "Is there anything else..." / "Well, what is it" /
//       "Yes, I'll go and look for him." / "Yes, I'm sure." (drezel.rs2:14-18,275-338); he hands over 3 meat + 3 apple pies
//   10  Mort Myre gate (3443/3444,3458) entered (quest_druidspirit.rs2:1-16)
//   -   Filliman's camp is an island: in and out only by the "Jump" bridge at (3440/3441, 3329/3331), an agility roll
//       (fail = 2-7 damage, you still cross; quest_druidspirit.rs2:26-61)
//   20  Grotto door (3440,3337) op1 spawns the spirit + dialogue; WITH the ghostspeak amulet worn (filliman.rs2:1-15):
//       "How long have you been a ghost?" sets 20 (filliman.rs2:255-261)
//   -   the mirror: pick up the washing bowl at (3437,3337) -> a mirror drops there (quest_druidspirit.rs2:63-79)
//   25  mirror used on the spirit (filliman.rs2:271-293)
//   -   the journal: search the grotto tree (3439,3338) (quest_druidspirit.rs2:84-90)
//   30  journal used on the spirit -> 35 "How can I help?" -> bloom spell (filliman.rs2:294-348)
//   40  Drezel blesses you (drezel.rs2:228-245)
//   45  bloom spell cast next to a rotting log in the swamp; 50 pick the fungus (quest_druidspirit.rs2:196-233,383-394)
//   55  talk to the spirit with stage 50 (filliman.rs2:63-77)
//   60  fungus on the nature stone (3439,3336), used spell on the spirit stone (3441,3336), stand on the faith stone
//       (3440,3335) and answer "I think I've solved the puzzle!" (quest_druidspirit.rs2:128-194, filliman.rs2:384-407)
//   65  grotto door -> the grotto (quest_druidspirit.rs2:92-106); 70 talk (filliman.rs2:26-58)
//   75  silver sickle -> blessed + empty druid pouch (filliman.rs2:165-196)
//   80/85 blessed sickle (op3) blooms the swamp, pick (quest_druidspirit.rs2:235-274,383-419)
//   90  3 blossomed items into the pouch (pear 3, stem 2, fungus 1 charge; quest_druidspirit.rs2:290-331)
//   95..105 three ghasts: the pouch makes an (invisible) ghast visible (ghast.rs2:39-45,204-216), kill it (:86-142)
//   110 talk to the nature spirit in the grotto (filliman.rs2:129-160) -> queue complete (quest_druidspirit.rs2:421-429)
//
// In Search of the Myreque later needs >= 5 pouch charges (routequest_morton.rs2:191-200): we fill the pouch with 3 pears
// (9 charges), so 6 are left after the three ghasts.
import { SpeedBot, objId, cheb } from '../../../core.js';
import { nav, talk, npcsOf, inDialog, levelUpOpen, walkOp, locAt, dismiss, waitText, opNpcGo, msgsSince, pickupGo, R, M2, M4, M5, qp, type FTok } from '../../q-lib.js';
import { startAtVanstrom } from './q-in-search-of-the-myreque.js';
import { isResuming, readJournal, failHook } from '../journal.js';
import { opHeld, talkAt, bloomedNear, pickBloomed, harvestPears, PEAR_AT, trapdoorDown, fail, has, stamp, withSafety, opUntil, useOnLocUntil, useOnNpcUntil, routeNextTo, type Item, type QuestMeta, type Reqs, type RunResult } from './mo-lib.js';

export const QUEST: QuestMeta = { name: 'Nature Spirit', dir: 'quest_druidspirit', qp: 2 };
export const REQUIREMENTS: Reqs = {
    quests: ['Priest in Peril (stage 61: talk to Drezel after the essence)', 'The Restless Ghost (the ghostspeak amulet, worn)'], qp: 0,
    skills: {
        prayer: [30, 'each blessed-sickle bloom drains 1-7 prayer and needs > 0 (quest_druidspirit.rs2:241-246); 3 casts'],
        attack: [40, 'three ghasts (45 hp, att 22, def 18); sim-proven level'],
    },
    start: { x: 3440, z: 9894, level: 0 },   // next to Drezel in the mausoleum (where Priest in Peril ends)
    end: { x: 3442, z: 9735, level: 0 },     // Filliman's grotto
};
export const SUPPLY: Item[] = [{ name: 'silver_sickle', n: 1 }];
export const WEAR = ['rune_scimitar', 'amulet_of_ghostspeak'];

const DREZEL2 = 1049, SPIRIT = 1050, NS = 1051, GHAST_INV = 1052, GHAST_VIS = 1053;
const GATE_N = { x: 3443, z: 3458 }, GATE_S = { x: 3443, z: 3457 };
const JUMP_S = { x: 3440, z: 3328 }, JUMP_N = { x: 3440, z: 3332 };
/** Bloom tiles. A 1x1 swamp loc is only reachable from a CARDINAL neighbour ("I can't reach that!" from a diagonal), and
 *  a cast scans the 3x3 around the player in x-major order (dx -1..1, dz -1..1), blooming the first match surely and each
 *  later one with 50% (quest_druidspirit.rs2:209-230,256-273).
 *  FUNGUS_AT (3439,3349): the rotting log (3439,3348) is its only log, cardinal south -> the scroll always blooms it.
 *  PEAR_AT (3437,3349): first match is the pear bush (3437,3348) (cardinal south) -> every sickle cast blooms a pear;
 *  the branch (3437,3350) (cardinal north) blooms half the time. */
/** re-attack cadence while fighting a ghast (A/B: --reop N) */
const REOP = (() => { const i = process.argv.indexOf('--reop'); return i >= 0 ? Number(process.argv[i + 1]) : 16; })();
const FUNGUS_AT = { x: 3439, z: 3349 };
const inCamp = (b: SpeedBot) => { const t = b.tile(); return b.minusedlevel === 0 && t.x >= 3434 && t.x <= 3446 && t.z >= 3331 && t.z <= 3342; };
const inSwamp = (b: SpeedBot) => { const t = b.tile(); return t.x >= 3392 && t.x <= 3519 && t.z >= 3328 && t.z <= 3455; };
const inGrotto = (b: SpeedBot) => { const t = b.tile(); return t.z > 9700 && t.z < 9760 && t.x > 3420 && t.x < 3470; };
const seenText = (bot: SpeedBot, re: RegExp) => { const v = [...bot.ifText.values()]; return v.some(x => re.test(x)) || re.test(v.join(' ')); };

export interface NsOpts { log?: boolean; sim?: boolean; from?: string;
    /** also start In Search of the Myreque at Vanstrom (Canifis) on the first trip out (its gate is Nature Spirit >= 5,
     *  routequest_vanstorm.rs2:46), so the route can go from the grotto straight to Mort'ton afterwards */
    startMyreque?: boolean;
    /** resume (session 10): the stones already absorbed (the journal says so): the ritual skips them */
    absorbed?: { nature: boolean; spirit: boolean } }

/** druidspirit_journal.rs2 open texts -> the phase to resume at, latest first. Case-sensitive where the struck history repeats
 *  a phrase ('With the bloom spell I can collect 'Something of nature.'' stays in the text from stage 40 on). */
const NS_STAGES: Array<[RegExp, string]> = [
    [/QUEST COMPLETE/, 'done'], [/killed the three ghasts/, 'final'], [/kill three ghasts/, 'ghasts'],
    [/druid pouch' perhaps|natures bounty|sickle to make the swamp bloom/, 'pouch'], [/silver sickle/, 'grotto'],
    [/meet him in his grotto/, 'grotto'], [/absorbed into the nature stone|I have a Mort Myre Fungi|absorbed into the spirit stone/, 'ritual'],
    [/I need to collect 'something of nature/, 'fungus'], [/blessed at\s+the temple before/, 'bless'],
    [/look for Filliman Tarlock/, 'camp1'], [/This quest has the following requirements/, 'start'],
];

export async function run(bot: SpeedBot, o: NsOpts = {}): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, qp0 = qp(bot), v = o.log !== false;
    const at = (k: string) => { stamp(bot, t0, k, v); failHook(k.split(' ')[0]!); };
    let done = false;
    // session 10: a retry / resume (no explicit from) starts at the phase the quest JOURNAL shows. NS_RESUME=0 reverts.
    if (!o.from && isResuming(bot) && process.env.NS_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        const j = await readJournal(bot, 'druidspirit');
        const hit = j.ok ? NS_STAGES.find(([re]) => re.test(j.text)) : undefined;
        console.log(`[ns] [journal] druidspirit: ${j.ok ? `phase ${hit?.[1] ?? '- (no match)'} | open '${j.open.slice(0, 140)}'` : 'UNREADABLE'} (${j.ticks} t)`);
        if (hit?.[1] === 'done') return { ok: true, ticks: bot.tickCount - t0, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
        if (hit) o = { ...o, from: hit[1], absorbed: { nature: /absorbed into the nature stone/.test(j.text), spirit: /absorbed into the spirit stone/.test(j.text) } };
    }
    try { await withSafety(bot, 'nature-spirit', async () => { done = await body(bot, o, at, t0); }); }
    catch (e) { return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    return { ok: done, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}${done ? ', quest complete scroll seen' : ''}` };
}

async function body(bot: SpeedBot, o: NsOpts, at: (k: string) => void, t0: number): Promise<boolean> {
    if (!bot.isWorn(objId('amulet_of_ghostspeak'))) {
        const s = bot.slot('amulet_of_ghostspeak');
        if (s < 0) fail(bot, 'no ghostspeak amulet (The Restless Ghost) - Filliman cannot be understood without it');
        bot.opHeld2(objId('amulet_of_ghostspeak'), s); bot.queueFlush(); await bot.until(() => bot.isWorn(objId('amulet_of_ghostspeak')), 4);
    }
    if (!has(bot, 'silver_sickle') && !has(bot, 'silver_sickle_blessed')) fail(bot, 'no silver sickle');
    const barrier = locAt(3443, 3440, 9886, 0), gate = locAt(3507, 3443, 3458, 0);
    const jumpS = locAt(3522, 3440, 3329, 0), jumpN = locAt(3522, 3440, 3331, 0);
    const door = locAt(3516, 3440, 3337, 0), tree = locAt(3517, 3439, 3338, 0);
    const stoneNature = locAt(3527, 3439, 3336, 0), stoneSpirit = locAt(3529, 3441, 3336, 0);
    const grotto = locAt(3520, 3441, 9740, 0), grottoExit = locAt(3525, 3442, 9733, 0);
    let skipping = !!o.from;
    const P = (name: string) => { if (skipping && name === o.from) skipping = false; return !skipping; };

    // ---- movement legs ------------------------------------------------------------------------------------------------
    const toDrezel = async () => {
        if (bot.tile().z > 9800) return;
        await outOfCamp();
        if (inSwamp(bot) && !(await opUntil(bot, gate, 1, GATE_S, () => bot.tile().z >= 3458, { maxTicks: 300 }))) fail(bot, 'Mort Myre gate (out)');
        await trapdoorDown(bot, { x: 3422, z: 3485 }, 3432, 3433, { x: 3423, z: 3485 });
    };
    const intoSwamp = async () => {
        if (bot.tile().z > 9800 && !(await opUntil(bot, barrier, 1, { x: 3440, z: 9887 }, () => bot.tile().z < 6400, { maxTicks: 40 }))) fail(bot, 'holy barrier');
        if (!inSwamp(bot) && !(await opUntil(bot, gate, 1, GATE_N, () => bot.tile().z <= 3457, { maxTicks: 200 }))) fail(bot, 'Mort Myre gate (in)');
    };
    const intoCamp = async () => {
        if (inCamp(bot)) return;
        if (!(await opUntil(bot, jumpS, 1, JUMP_S, () => inCamp(bot), { maxTicks: 300, tries: 6 }))) fail(bot, 'jump into the camp');
    };
    async function outOfCamp() {
        if (inGrotto(bot) && !(await opUntil(bot, grottoExit, 1, { x: 3442, z: 9734 }, () => !inGrotto(bot), { maxTicks: 30 }))) fail(bot, 'grotto exit');
        if (inCamp(bot) && !(await opUntil(bot, jumpN, 1, JUMP_N, () => !inCamp(bot), { maxTicks: 60, tries: 6 }))) fail(bot, 'jump out of the camp');
    }
    const spirit = () => npcsOf(bot, SPIRIT)[0] ?? null;

    if (P('start')) {
        // ---- 1. Drezel -> 5 ------------------------------------------------------------------------------------------
        await talkAt(bot, DREZEL2, { x: 3440, z: 9894 }, [R, M2[1]!, R, R, M2[1]!, R, R, M5[3]!, R, R, M5[0]!, R, R, R, R, R, R], {
            done: () => seenText(bot, /definitely find him/), answers: [/^Is there anything else/, /^Well, what is it/, /^Yes, I'll go and look/, /^Yes, I'm sure/], maxTicks: 40, label: 'drezel-ns',
        });
        if (!seenText(bot, /definitely find him/)) fail(bot, 'Drezel: Nature Spirit not started');
        at('stage5');
        dismiss(bot);
    }
    if (P('camp1')) {
        // ---- 2. into Mort Myre and the camp ----------------------------------------------------------------------------
        if (o.startMyreque) {
            if (bot.tile().z > 9800 && !(await opUntil(bot, barrier, 1, { x: 3440, z: 9887 }, () => bot.tile().z < 6400, { maxTicks: 40 }))) fail(bot, 'holy barrier');
            await startAtVanstrom(bot);
            at('myreque-started');
        }
        await intoSwamp();
        at('swamp');
        await intoCamp();
        at('camp');
        // the mirror (bowl -> mirror drops) and the journal (search the grotto tree) first: no npc needed for them
        if (!has(bot, 'mirror')) {
            const bowlAt = { x: 3437, z: 3337 };
            for (let k = 0; k < 4 && !has(bot, 'mirror'); k++) {
                if (!has(bot, 'bowl_empty_filliman')) { await walkOp(bot, { x: 3438, z: 3337 }, () => bot.opObj(bowlAt.x, bowlAt.z, objId('bowl_empty_filliman'), 3), () => has(bot, 'bowl_empty_filliman'), { maxTicks: 30 }); }
                await bot.until(() => !!bot.findGroundItem(objId('mirror'), 3), 3);
                if (bot.findGroundItem(objId('mirror'), 3)) await walkOp(bot, { x: 3438, z: 3337 }, () => bot.opObj(bowlAt.x, bowlAt.z, objId('mirror'), 3), () => has(bot, 'mirror'), { maxTicks: 10 });
            }
            if (!has(bot, 'mirror')) fail(bot, 'no mirror');
        }
        at('mirror');
        if (!has(bot, 'filliman_journal')) {
            if (!(await opUntil(bot, tree, 2, { x: 3438, z: 3338 }, () => has(bot, 'filliman_journal'), { maxTicks: 20 }))) fail(bot, 'no journal');
            dismiss(bot);
        }
        at('journal');
        // ---- 3. the spirit: 20 (How long have you been a ghost?), 25 (mirror), 30/35 (journal, How can I help?) ------
        if (!(await walkOp(bot, { x: 3440, z: 3338 }, () => bot.opLoc(door.x, door.z, door.id, 1), () => inDialog(bot), { maxTicks: 30 }))) fail(bot, 'grotto door (spirit)');
        await talk(bot, [], [R, R, R, M4[1]!, R, R, R, R], { noOp: true, done: () => bot.dialogOptions().some(x => /amulet of ghost speak/.test(x.text)) && bot.tickCount > 0, answers: [/^How long have you been a ghost/], maxTicks: 20, label: 'spirit20' });
        dismiss(bot); await bot.tick(1);
        const sp = spirit(); if (!sp) fail(bot, 'spirit not in view');
        // stage 25 is set AFTER the last page (filliman.rs2:290-291): resume it, never close it
    if (!(await useOnNpcUntil(bot, 'mirror', SPIRIT, () => seenText(bot, /where did I put my journal/) && !inDialog(bot), 30))) fail(bot, 'mirror: stage 25 not reached');
        at('stage25');
        dismiss(bot); await bot.tick(1);
        // journal: 5 pages, multi5 "How can I help?" (opt 4), 10 pages -> bloom spell
        const n = spirit(); if (!n) fail(bot, 'spirit gone');
        routeNextTo(bot, n); bot.useItemOnNpc(n.idx, objId('filliman_journal'), bot.slot('filliman_journal')); bot.queueFlush();
        await bot.until(() => inDialog(bot), 12);
        await talk(bot, [], [R, R, R, R, R, M5[3]!, R, R, R, R, R, R, R, R, R, R], { noOp: true, done: () => has(bot, 'bloom_spell') && !inDialog(bot), answers: [/^How can I help/], maxTicks: 30, label: 'spirit35' });
        if (!has(bot, 'bloom_spell')) fail(bot, 'no bloom spell: stage 35 not reached');
        at('stage35');
        dismiss(bot);
    }
    if (P('bless')) {
        // ---- 4. back to Drezel to be blessed (40) -----------------------------------------------------------------------
        await toDrezel();
        at('to-drezel');
        await talkAt(bot, DREZEL2, { x: 3440, z: 9893 }, [R, R, R, R, R], { done: () => seenText(bot, /Many thanks!/) && !inDialog(bot), maxTicks: 40, label: 'bless' });
        if (!seenText(bot, /Many thanks!/)) fail(bot, 'Drezel: not blessed');
        at('stage40');
        dismiss(bot);
    }
    if (P('fungus')) {
        // ---- 5. the fungus (45/50) on the way back to the camp ----------------------------------------------------------
        await intoSwamp();
        at('swamp2');
        if (!has(bot, 'mortmyremushroom')) {
            await walkOp(bot, FUNGUS_AT, null, () => false, { maxTicks: 300 });
            for (let k = 0; k < 6 && !has(bot, 'mortmyremushroom'); k++) {
                if (has(bot, 'bloom_spell')) { dismiss(bot); bot.opHeld1(objId('bloom_spell'), bot.slot('bloom_spell')); bot.queueFlush(); }
                await bot.until(() => bloomedNear(bot, FUNGUS_AT).length > 0, 6);
                if (process.argv.includes('--laps')) console.log(`[ns] live locs near: ${[...bot.liveLocs].filter(([k]) => { const [, x, z] = k.split(',').map(Number); return Math.abs(x! - FUNGUS_AT.x) <= 2 && Math.abs(z! - FUNGUS_AT.z) <= 2; }).map(([k, v]) => k + '=' + v).join(' ')} msgs ${msgsSince(bot, bot.tickCount - 8).join(' | ')}`);
                await pickBloomed(bot, FUNGUS_AT, 1);
            }
            if (!has(bot, 'mortmyremushroom')) fail(bot, 'no fungus');
        }
        at('stage50');
    }
    if (P('ritual')) {
        // ---- 6. the stones + the puzzle (55, 60) ----------------------------------------------------------------------
        await intoCamp();
        if (!o.absorbed?.nature && !(await useOnLocUntil(bot, 'mortmyremushroom', stoneNature, { x: 3439, z: 3335 }, () => !has(bot, 'mortmyremushroom'), { maxTicks: 30 }))) fail(bot, 'fungus on the nature stone');
        const used = has(bot, 'used_bloom_spell') ? 'used_bloom_spell' : 'bloom_spell';
        if (!o.absorbed?.spirit && !(await useOnLocUntil(bot, used, stoneSpirit, { x: 3441, z: 3335 }, () => !has(bot, used), { maxTicks: 20 }))) fail(bot, 'spell on the spirit stone');
        at('stones');
        if (!(await walkOp(bot, { x: 3440, z: 3338 }, () => bot.opLoc(door.x, door.z, door.id, 1), () => inDialog(bot), { maxTicks: 30 }))) fail(bot, 'grotto door (spirit 2)');
        await talk(bot, [], [R, R, R], { noOp: true, done: () => bot.dialogOptions().some(x => /solved the puzzle/.test(x.text)), maxTicks: 15, label: 'spirit55' });
        dismiss(bot);
        // stand ON the faith stone (3440,3335), the spirit is on (3440,3336): talk without moving
        for (let k = 0; k < 4 && !seenText(bot, /everything seems to be in place/); k++) {
            if (!(await walkOp(bot, { x: 3440, z: 3335 }, null, () => false, { maxTicks: 20 }))) fail(bot, 'faith stone');
            const s = spirit(); if (!s) fail(bot, 'spirit gone (puzzle)');
            bot.opNpc(s.idx, 1); bot.queueFlush();
            await bot.until(() => inDialog(bot), 6);
            await talk(bot, [], [R, M5[2]!, R, R], { noOp: true, done: () => seenText(bot, /everything seems to be in place|still doesn't seem right/), answers: [/^I think I've solved the puzzle/], maxTicks: 15, label: 'puzzle' });
            if (seenText(bot, /still doesn't seem right/) && !seenText(bot, /everything seems to be in place/)) { console.log(`[ns] puzzle refused at ${JSON.stringify(bot.pos())}`); dismiss(bot); }
        }
        if (!seenText(bot, /everything seems to be in place/)) fail(bot, 'puzzle: stage 60 not reached');
        at('stage60');
        dismiss(bot);
    }
    if (P('grotto')) {
        // ---- 7. the grotto: transformation (65/70), the sickle (75) -----------------------------------------------------
        if (!inGrotto(bot)) {
            await intoCamp();
            if (!(await opUntil(bot, door, 1, { x: 3440, z: 3338 }, () => inGrotto(bot), { maxTicks: 30 }))) fail(bot, 'into the grotto');
        }
        at('grotto');
        if (!(await walkOp(bot, { x: 3442, z: 9739 }, () => bot.opLoc(grotto.x, grotto.z, grotto.id, 1), () => inDialog(bot), { maxTicks: 20 }))) fail(bot, 'grotto (spirit 3)');
        await talk(bot, [], [R, R, R, R, R], { noOp: true, done: () => bot.dialogOptions().some(x => /Where would I get a silver sickle/.test(x.text)), maxTicks: 30, label: 'transform' });
        dismiss(bot);
        at('stage70');
        for (let k = 0; k < 3 && !has(bot, 'druid_pouch_empty'); k++) {
            if (!(await walkOp(bot, { x: 3442, z: 9739 }, () => bot.opLoc(grotto.x, grotto.z, grotto.id, 1), () => inDialog(bot), { maxTicks: 20 }))) continue;
            await talk(bot, [], [R, R, R, R, R, R, R, R], { noOp: true, done: () => has(bot, 'druid_pouch_empty') && !inDialog(bot), maxTicks: 30, label: 'sickle' });
        }
        if (!has(bot, 'druid_pouch_empty') || !has(bot, 'silver_sickle_blessed')) fail(bot, 'no blessed sickle / pouch: stage 75 not reached');
        at('stage75');
        dismiss(bot);
    }
    if (P('pouch')) {
        // ---- 8. bloom with the sickle (80/85), 3 pears into the pouch (90) ----------------------------------------------
        await outOfCamp();
        await walkOp(bot, PEAR_AT, null, () => false, { maxTicks: 300 });
        at('bloom-tile');
        // 9 charges (3 pears) or 8 (2 pears + a stem): either leaves >= 5 after the three ghasts (Myreque's boat check)
        await harvestPears(bot);
        bot.opHeld1(objId('druid_pouch_empty'), bot.slot('druid_pouch_empty')); bot.queueFlush();
        if (!(await bot.until(() => has(bot, 'druid_pouch'), 6))) fail(bot, 'pouch not filled');
        at(`stage90 pouch=${bot.count('druid_pouch')}`);
    }
    if (P('ghasts')) {
        // ---- 9. three ghasts (95..105) ----------------------------------------------------------------------------------
        let kills = 0; const since = bot.tickCount;
        const killsSeen = () => { const m = msgsSince(bot, since).join(' | '); return /That's all three Ghasts/.test(m) ? 3 : /That's two Ghasts/.test(m) ? 2 : /That's one Ghast/.test(m) ? 1 : 0; };
        const g0 = bot.tickCount; let lastPouch = -99, lastAtk = -99, target = -1;
        // session 11 fix 388 (qx288/qx305 naturespirit 'ghasts: 2/3 after 600 t', +~530 t each; slow passes qx133/139/201/235
        // the same: 120-390 t parked on ONE shore tile, 3420,3343 / 3423,3348 / 3427,3356). Ghasts move LINE_OF_SIGHT
        // (moverestrict=blocked+normal, engine PathingEntity.ts:578), so they wander over swamp water (f1, ~38% of the tiles
        // around the camp; spawn 3429,3352 is in the pool, m53_52.jm2) where we can't stand. The sticky target (vis.find(target))
        // and the nearest invisible ghast never changed: OPNPC/OPNPCU 'can't reach' forever. The retry (fresh target=-1) killed
        // #3 in 19 t. Now a ghast facing us within 1 tile wins, and a target with no progress (kills, pouch, its hp, our tile)
        // for NS_STALL t is skipped for 100 t and we step back to open ground. NS_STALL=0 reverts. TEST: NS_TEST388=1 aims the
        // pouch at the invisible ghast nearest the pool spawn (provokes the stall).
        const STALL = Number(process.env.NS_STALL ?? 40), skip = new Map<number, number>(), POOL = { x: 3429, z: 3352 };
        let prog = bot.tickCount, progKey = '', cur = -1;
        const ok = (q: { idx: number }) => !STALL || (skip.get(q.idx) ?? -1) < bot.tickCount;
        while ((kills = killsSeen()) < 3) {
            if (bot.tickCount - g0 > 600) fail(bot, `ghasts: ${kills}/3 after 600 t`);
            // a level-up page (x25 xp: nearly every kill levels something) stops the fight: continue it and re-attack in
            // the same tick (opNpcGo resumes a level-up page before the OPNPC)
            const lvl = levelUpOpen(bot);
            if (bot.chatModalId !== -1 && !lvl) dismiss(bot);
            if (STALL) {
                // fix 388b (proof390 q388j: npc health is never filled headless ('tgt hp 0/0'), so an ordinary ghast fight held
                // the key ~40 t and the breaker aborted normal fights): a landed hit shows as xp instead
                const me = bot.tile();
                const key = `${kills}|${bot.count('druid_pouch')}|${bot.xpAll().reduce((s, v) => s + v, 0)}|${me.x},${me.z}`;
                if (key !== progKey) { progKey = key; prog = bot.tickCount; }
                else if (bot.tickCount - prog > STALL) {
                    console.log(`[ns] fix388: no progress ${bot.tickCount - prog} t on ghast ${cur} at ${me.x},${me.z}: skip it, back to open ground`);
                    if (cur >= 0) skip.set(cur, bot.tickCount + 100);
                    target = -1; cur = -1;
                    await walkOp(bot, { x: 3438, z: 3352 }, null, () => false, { near: 2, maxTicks: 30 });
                    prog = bot.tickCount; progKey = '';
                    continue;
                }
            }
            const vis = npcsOf(bot, GHAST_VIS).filter(ok);
            const hitter = STALL ? vis.find(q => q.d <= 1 && Number((bot as any).npcs[q.idx]?.faceEntity ?? -1) >= 32768) : undefined;
            const tv = hitter ?? vis.find(q => q.idx === target) ?? vis[0];
            if (tv) {
                // ghasts are size 2: our own route-to-adjacent (opNpcGo) aims at the SW tile and can end inside the footprint,
                // where the OPNPC never starts a fight. A bare OPNPC lets the engine walk us to a valid side itself.
                if (lvl || tv.idx !== target || bot.tickCount - lastAtk >= REOP) {
                    if (lvl) bot.resumeDialogPage();
                    bot.opNpc(tv.idx, 2); bot.queueFlush(); target = tv.idx; lastAtk = bot.tickCount;
                }
                cur = tv.idx;   // session 11 fix 388
            } else if (bot.count('druid_pouch') > 0 && bot.tickCount - lastPouch >= 4) {
                // session 11 fix 388: skip stalled ones; TEST NS_TEST388=1 picks the one nearest the in-pool spawn
                const invs = npcsOf(bot, GHAST_INV).filter(ok);
                const inv = process.env.NS_TEST388 === '1' ? invs.sort((a, b) => cheb(a, POOL) - cheb(b, POOL))[0] : invs[0];
                if (inv) { cur = inv.idx; routeNextTo(bot, inv); bot.useItemOnNpc(inv.idx, objId('druid_pouch'), bot.slot('druid_pouch')); bot.queueFlush(); lastPouch = bot.tickCount; }
                else await walkOp(bot, { x: 3438, z: 3352 }, null, () => npcsOf(bot, [GHAST_INV, GHAST_VIS]).length > 0, { near: 3, maxTicks: 30 });
            }
            if (process.argv.includes('--laps') && (bot.tickCount - g0) % 3 === 0) {
                const e: any = tv ? (bot as any).npcs[tv.idx] : null;
                console.log(`[ghast +${bot.tickCount - g0}] kills ${kills} vis ${vis.map(q => q.idx + '@' + q.x + ',' + q.z + ' d' + q.d).join(' ')} inv ${npcsOf(bot, GHAST_INV).slice(0, 3).map(q => q.idx + ' d' + q.d).join(' ')} tgt hp ${e?.health}/${e?.totalHealth} me ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur} pouch ${bot.count('druid_pouch')} lvl ${lvl}`);
            }
            await bot.tick(1);
        }
        at(`ghasts pouch=${bot.count('druid_pouch')}`);
    }
    // ---- 10. the nature spirit -> complete (110) --------------------------------------------------------------------
    if (!inGrotto(bot)) {
        await intoCamp();
        if (!(await opUntil(bot, door, 1, { x: 3440, z: 3338 }, () => inGrotto(bot), { maxTicks: 30 }))) fail(bot, 'into the grotto (end)');
    }
    const t1 = bot.tickCount;
    for (let k = 0; k < 3 && !seenText(bot, /completed the 'Nature Spirit'|Nature Spirit' Quest/); k++) {
        if (!(await walkOp(bot, { x: 3442, z: 9739 }, () => bot.opLoc(grotto.x, grotto.z, grotto.id, 1), () => inDialog(bot), { maxTicks: 20 }))) continue;
        await talk(bot, [], [R, R, R], { noOp: true, done: () => seenText(bot, /Nature Spirit' Quest/), maxTicks: 30, label: 'complete' });
        await waitText(bot, /Nature Spirit' Quest/, 12);
    }
    at('complete');
    void t1; void t0;
    return seenText(bot, /Nature Spirit' Quest/);
}


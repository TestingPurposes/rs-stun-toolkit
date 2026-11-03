// q-romeo-juliet.ts — Romeo & Juliet (quest_romeojuliet), cheat-free. f2p-a agent 2.
// Content: areas/area_varrock/scripts/{juliet,romeo,father_lawrence,apothecary}.rs2, quests/quest_romeojuliet/
// configs/quest_romeojuliet.constant (spoken_romeo 10, spoken_juliet 20, passed_message 30, spoken_father 40,
// spoken_apothecary 50, juliet_crypt 60), scripts/quest_romeojuliet.rs2 (complete: +5 qp).
//
// Fastest order (verified in the content):
//  1. Juliet FIRST (L1 of her house): at not_started her p_choice4 "I guess I could find him." gives the message and sets
//     spoken_juliet directly (juliet.rs2:117,140-144,157-163) -> Romeo's start talk is skipped entirely.
//     House: diagonal door 1533 (3160,3440) (core walkTo opens it); staircase 1722 (3156,3435) is 3x2 and can be climbed
//     ONLY from its EAST side (forceapproach 11 rotated by angle 3; stand (3159,3436), probe2-op: the client reach model
//     wrongly says (3157,3437) works -> "I can't reach that!" and LeanBot's traveller parks). Telejump to (1,3155,3435)
//     (stairs.rs2:31). Down: 1723 from the west (3155,3435) -> (0,3159,3435) (stairs.rs2:76).
//  2. Romeo (Varrock square): romeo_messagefrom: chatplayer | mesbox | inv_del message -> passed_message (romeo.rs2:54-58).
//  3. Father Lawrence (Varrock church): father_lawrence_help: 6 pages, then spoken_father (father_lawrence.rs2:54-62).
//  4. Apothecary: lawrence_sent 6 pages -> spoken_apothecary (apothecary.rs2:134-143); talk again WITH the berries:
//     make_cadava -> cadava potion (apothecary.rs2:119-129). Cadava berries are tradeable (no tradeable=no in
//     quest_romeojuliet.obj) -> SUPPLY (skips the ground-spawn trip SE of Varrock).
//  5. Juliet: juliet_potion_made: chatplayer x2 | mesbox | inv_del cadava -> juliet_crypt (juliet.rs2:186-197).
//  6. Romeo: romeo_allset: 7 pages, queue(romeo_and_juliet_complete) -> +5 qp (romeo.rs2:90-98).
// Varrock Teleports (magic 25): Juliet -> Romeo (twice) and Lawrence -> Apothecary (A/B: FC_TELE, see STATUS.md).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { R, M4, tele } from '../../q-lib.js';
import { converse, mkLog, qp, closeChat, textSince, snapText, walk, walkSafe, eatWatch, dead, fail, cheb, wear, closeOpenDoorsNear,
    type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';
import { inDialog, walkOp } from '../../q-lib.js';
import { juliHouseUp, juliHouseDown, juliDoor } from './fa2-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';
/** session 10 resume: the quest JOURNAL (quest_romeojuliet/scripts/romeojuliet_journal.rs2) -> %rjquest, first match wins */
const RJ_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 7], [/find\s+Romeo\s+and tell him what's happened/i, 6],
    [/take this\s+cadava potion|take these\s+cadava berries|find some\s+cadava berries/i, 5], [/find the\s+Apothecary/i, 4],
    [/find\s+Father Lawrence\s+and see/i, 3], [/take the\s+message\s+from/i, 2], [/go and speak to\s+Juliet/i, 1],
];

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'Romeo & Juliet', dir: 'quest_romeojuliet', qp: 5 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0, skills: { magic: [25, 'Varrock Teleport x3 (optional, -126 t; FC_TELE=none walks): magic_spells varrock_teleport'] },
    start: { x: 3168, z: 3430, level: 0 },   // the street east of Juliet's house (west Varrock)
    end: { x: 3211, z: 3425, level: 0 },     // Romeo, Varrock square
};
/** which legs take a Varrock Teleport (A/B switch FC_TELE; 'none' walks everything) */
const TELES = new Set((process.env.FC_TELE || 'juliet1,lawrence,juliet').split(',').map(s => s.trim()).filter(s => s && s !== 'none'));
export const SUPPLY: Item[] = [
    { name: 'cadavaberries', n: 1 },
    ...(TELES.size ? [{ name: 'lawrune', n: TELES.size }, { name: 'firerune', n: TELES.size }, { name: 'staff_of_air', n: 1 }] : []),
];
const ROMEO = 639, JULIET = 637, LAWRENCE = 640, APOTHECARY = 638;
const ROMEO_AT = { x: 3211, z: 3425 }, LAWRENCE_AT = { x: 3254, z: 3480 }, APOTH_AT = { x: 3195, z: 3404 };
const JULIET_AT = { x: 3159, z: 3425 };   // inside her room (south of the L1 door 1533 (3159,3427), fa2-lib juliDoor)
const MSG = 'julietmessage', BERRIES = 'cadavaberries', POTION = 'cadava';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'rj', !!o.log);
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0); }
    finally { stopEat(); }
}

async function body(bot: SpeedBot, L0: (s: string) => void, t0: number, qp0: number): Promise<RunResult> {
    const L = (s: string) => { L0(s); failHook(`romeo:${s}`); };
    const fin = (ok: boolean, msg: string): RunResult => ({ ok, ticks: bot.tickCount - t0, msg });
    const has = (n: string) => bot.count(objId(n)) > 0;
    // session 10: on a retry, the journal stage gates each talk (RJ_RESUME=0 = the item checks only, as before)
    let rj = -1;
    if (isResuming(bot) && process.env.RJ_RESUME !== '0') {
        closeChat(bot);
        rj = await journalStage(bot, 'romeojuliet', RJ_STAGES, 0, s => console.log(`[rj] ${s}`));
        console.log(`[rj] resume at stage ${rj} @${JSON.stringify(bot.pos())}`);
        if (rj >= 7) return fin(true, 'journal: quest complete');
    }
    const at = (n: number) => rj <= 0 || rj <= n;
    const teleSet = TELES;
    if (bot.count('staff_of_air') > 0) await wear(bot, 'staff_of_air', 4);
    const canTele = () => bot.stat('magic').level >= 25 && bot.count('lawrune') >= 1 && bot.count('firerune') >= 1
        && (bot.isWorn(objId('staff_of_air')) || bot.count('airrune') >= 3);
    const varrockTele = async (why: string) => {
        if (!canTele()) return;
        closeChat(bot);
        const r = await tele(bot, 'varrock_teleport');
        L(`varrock teleport (${why}) ${r.ok} ${r.ticks}t`);
    };
    if (at(5) && !has(BERRIES) && !has(POTION)) fail(bot, 'no cadava berries');
    const done = () => qp(bot) >= qp0 + QUEST.qp;

    // 1. Juliet: the message (starts the quest)
    let stage = 'juliet1';
    if (at(1) && !has(MSG)) {
        await juliHouseUp(bot, L); await juliDoor(bot, L);
        const ok = await converse(bot, JULIET, {
            plan: [R, R, R, M4[2]!, R, R, R, R, R], stand: JULIET_AT, near: 6, label: 'juliet1', log: L, maxTicks: 120,
            answers: [/^I guess I could find him\.$/], done: () => has(MSG),
        });
        if (!ok) fail(bot, 'Juliet: no message');
        closeChat(bot);
        L('message');
        if (teleSet.has('juliet1') && canTele()) await varrockTele('juliet -> romeo (message)');
        else await juliHouseDown(bot, L);
    }
    // 2. Romeo: pass the message
    stage = 'romeo1';
    if (at(2)) {
        const ok = await converse(bot, ROMEO, { plan: [R, R], stand: ROMEO_AT, near: 8, label: stage, log: L, maxTicks: 300, done: () => !has(MSG) });
        if (!ok) fail(bot, 'Romeo: message not passed');
        closeChat(bot); L('message passed');
    }
    // 3. Father Lawrence: the full help speech (the varp is set after its last page)
    stage = 'lawrence';
    if (at(3)) {
        const snap = snapText(bot);
        const said = () => textSince(bot, snap, /You will need a Cadava potion/);
        // session 11 fix 278 (RJ_CHURCH_IN): qx30p 'Father Lawrence' (hp 17 = its hp since train-fm, NOT an attack: no hit
        // in the step). The church doorways (Large doors 1517/1520 at x3249 + x3252, z3479-3480) were OPEN on the chaos seed;
        // an open leaf walls off the next tile, so the stand walk parked at (3250,3480) 30+ t, every OPNPC from there was
        // pathed into the leaf (Lawrence d5 counted as 'near 8': no further walk), the 2 retries walked ONTO his tile (d0) and
        // the 4 tries ran out (the main lost 85 t the same way: 4 ops). Fix: walkSafe into the nave first (closes open leaves
        // between bounded attempts), near 3, 6 tries. RJ_CHURCH_IN=0 reverts.
        // session 11 fix 284 (RJ_CHURCH_WALK; corrects 278, which made it worse: qx32p 477 t, qx35p 364 + 354 t, all
        // 'Father Lawrence'). CONFIRMED from the logs: (a) core walkTo calls a walk within ~6 tiles 'ARRIVED' after 0 ticks
        // (LeanBot traveller), so 278's walkSafe never moved the bot from (3250,3479) into the nave (qx32p: 5 attempts, 0 t
        // each, between the x3249 and x3252 doorways); (b) converse with near 3 + stand: Father Lawrence wanders (seen at
        // 3252-3255,3474-3477, d4-d6 from the stand), the stand walk is the same no-op walkTo, so converse spun 300 t with NO
        // op at all (qx35p, standing ON the stand 3254,3480, Lawrence d6, twice). Fix: walk in with q-lib walkOp (own
        // route, opens closed doors, walls refused steps; open leaves near us closed between 3 rounds) and talk with the
        // pre-278 reach (near 12: no stand spin while he is in view); 3 bounded rounds of (walk in 40 t, converse 3 tries).
        // RJ_CHURCH_WALK=0 = 278 as it was; RJ_CHURCH_IN=0 = before 278.
        const in278 = process.env.RJ_CHURCH_IN !== '0', fix284 = in278 && process.env.RJ_CHURCH_WALK !== '0';
        const inNave = () => bot.tile().x >= 3253 && cheb(bot.tile(), LAWRENCE_AT) <= 8;
        let ok = false;
        if (fix284) {
            for (let r = 0; r < 3 && !said(); r++) {
                // one bounded walk per round (qys06m: walkOp also sat 3 x 60 t at (3250,3480); converse's door-aware op path
                // then got him at op #3 in 35 t), so the walk gets 40 t, the talk the rest
                for (let k = 0; k < 1 && !inNave(); k++) {
                    const w = await walkOp(bot, LAWRENCE_AT, null, () => cheb(bot.tile(), LAWRENCE_AT) <= 1, { near: 1, maxTicks: 40 });
                    if (!w && !inNave()) { const c = await closeOpenDoorsNear(bot, 4); L(`284 church walk ${k + 1}: at ${JSON.stringify(bot.tile())}, closed ${c} open leaf(s)`); }
                }
                L(`284 church: round ${r + 1} in ${inNave()} at ${JSON.stringify(bot.tile())}`);
                ok = await converse(bot, LAWRENCE, { plan: [R, R, R, R, R, R, R], stand: LAWRENCE_AT, near: 12, label: stage, log: L, maxTicks: 150,
                    tries: 3, done: () => said() && !inDialog(bot) });
                if (ok) break;
                closeChat(bot);
            }
        } else {
            if (in278 && !said() && (bot.tile().x < 3253 || cheb(bot.tile(), LAWRENCE_AT) > 6)) {
                const w = await walkSafe(bot, LAWRENCE_AT, 1, 150);
                L(`278 church: in ${w} at ${JSON.stringify(bot.tile())}`);
            }
            ok = await converse(bot, LAWRENCE, { plan: [R, R, R, R, R, R, R], stand: LAWRENCE_AT, near: in278 ? 3 : 8, label: stage, log: L, maxTicks: 300,
                tries: in278 ? 6 : undefined, done: () => said() && !inDialog(bot) });
        }
        if (!ok) fail(bot, 'Father Lawrence');
        L('lawrence done');
    }
    if (at(3) && teleSet.has('lawrence')) await varrockTele('lawrence -> apothecary');
    // 4. Apothecary: two talks (lawrence_sent, then make_cadava with the berries); converse re-talks until the potion is held
    stage = 'apothecary';
    if (at(5) && !(rj > 0 && has(POTION))) {
        let ok = await converse(bot, APOTHECARY, { plan: [R, R, R, R, R, R, R], stand: APOTH_AT, near: 8, label: stage, log: L, maxTicks: 300,
            tries: 5, done: () => has(POTION) });
        // session 11 fix 395c (qx342p/qx28m 'Apothecary: no potion': npc in the corner 3194,3406 (wall N, bookcase E, table S, only W
        // open), op #2 from the diagonal and #3-#5 from ON his tile never opened a dialog; the route retry, from the shop door,
        // talked in 4 t): one more round from the door tile. RJ_APOTH395=0 reverts.
        if (!ok && process.env.RJ_APOTH395 !== '0') {
            closeChat(bot); L('395c: second round from the door');
            await bot.walkTo(3195, 3403, { near: 0, maxTicks: 30, log: false, closeDoors: true });
            ok = await converse(bot, APOTHECARY, { plan: [R, R, R, R, R, R, R], label: stage, log: L, maxTicks: 60, tries: 2, done: () => has(POTION) });
        }
        if (!ok) fail(bot, 'Apothecary: no potion');
        closeChat(bot); L('potion');
    }
    // 5. Juliet: the potion
    stage = 'juliet2';
    if (at(5)) {
        await juliHouseUp(bot, L); await juliDoor(bot, L);
        const ok = await converse(bot, JULIET, { plan: [R, R, R], stand: JULIET_AT, near: 6, label: stage, log: L, maxTicks: 120, done: () => !has(POTION) });
        if (!ok) fail(bot, 'Juliet: potion not given');
        closeChat(bot); L('potion given');
    }
    if (at(5) && teleSet.has('juliet') && canTele()) await varrockTele('juliet -> romeo');
    else await juliHouseDown(bot, L);
    // 6. Romeo: complete
    stage = 'romeo2';
    {
        const ok = await converse(bot, ROMEO, { plan: [R, R, R, R, R, R, R, R], stand: ROMEO_AT, near: 8, label: stage, log: L, maxTicks: 300, done });
        if (!ok) fail(bot, 'Romeo: no quest complete');
        closeChat(bot);
    }
    if (dead(bot)) fail(bot, 'died');
    void cheb; void walk; void stage;
    return fin(true, `qp ${qp0} -> ${qp(bot)}`);
}

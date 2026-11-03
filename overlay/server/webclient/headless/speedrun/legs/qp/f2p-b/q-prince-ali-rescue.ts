/// <reference types="bun" />
// q-prince-ali-rescue.ts — Prince Ali Rescue (3 QP), cheat-free. Lane f2p-b.
//
// Content (rev 289; quests/quest_prince + areas/area_alkharid, area_draynor scripts). %princequest stages
// (quest_prince.constant): 0, started 10, spoken_osman 20, prep_finished 30, guard_drunk 40, tied_keli 50, saved 100.
//   AL KHARID 1: Hassan (923; 3302,3163) "Can I help you? You must need some help here in the desert." -> started
//      (hassan.rs2:3-10); Osman (924; 3286,3180) "What is the second thing you need?" / "Okay, I better go find some things."
//      -> spoken_osman (osman.rs2:25-74; the "second thing" branch is 3 pages shorter than the first).
//   DRAYNOR 1: Lady Keli (919; 3128,3244): rumours -> latest plan -> "Can you be sure..." -> "Could I see the key please?" ->
//      with soft clay at spoken_osman: "Could I touch the key for a moment?" -> keyprint (lady_keli.rs2:20-103);
//      Ned (918; 3100,3258): "Ned, could you make other things from wool?" / "How about some sort of wig?" / "I have that now.
//      Please, make me a wig." (3 wool) -> plain wig (ned.rs2:31-123; the wool option needs spoken_osman);
//      Aggie (922; 3086,3259): "Could you think of a way to make skin paste?" / "Yes please. Mix me some skin paste." (redberries,
//      pot of flour, bucket/jug of water, ashes) -> skin paste (aggie.rs2:1-35, :143-160); yellow dye on the plain wig -> blond
//      wig (quest_prince.rs2:1-12).
//   AL KHARID 2: Osman takes keyprint + bronze bar -> %prince_keystatus = keymade (osman.rs2:88-95).
//   DRAYNOR 2: Leela (915; 3113,3263) gives the key and, holding key + blond wig + pink skirt + skin paste, sets prep_finished
//      (leela.rs2:10-37); Joe (916; 3123,3245) "I have some beer here, fancy one?" with 3 beers -> guard_drunk (joe_guard.rs2:
//      19-46); rope on Lady Keli -> tied_keli, Keli removed (quest_prince.rs2:14-32); the key on the cell door 2881 (3123,3243)
//      from the north (:34-44); Prince Ali (920; 3123,3242) takes key + wig + skirt + paste -> saved (prince_ali.rs2:1-24).
//   AL KHARID 3: Hassan -> queue(prince_complete): 3 QP, 700 coins (hassan.rs2:24-26, quest_prince.rs2:54-58).
// TRAVEL: four amulet-of-glory teleports (Al Kharid / Draynor Village, amulet_of_glory.rs2:12-34) replace ~4 x 170 tiles of
// walking and the Al Kharid toll gate (10 gp each way until the prince is saved, border_gate.rs2:28-40).
import { SpeedBot, objId } from '../../../core.js';
import { M2, M3, M4, M5, R, locAt, opLocGo, useOnLocGo, inDialog, nav, talk, npc, npcsOf, opNpcGo, approachNpc, type Tile } from '../../q-lib.js';
import { openNpc, converse, chat, go, guard, fail, mkLog, completeCheck, answerUntil, glory, syncLeaves, packStr, setRetaliate, killFor, type Item } from './fb-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

/** prince_journal.rs2 -> %princequest step (0 none .. 6 saved, 7 complete), latest first (session 10) */
const PA_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 7], [/return to Hassan to claim my reward/i, 6], [/I can now free Prince Ali/i, 5],
    [/deal with Lady Keli/i, 4], [/deal with the Guard/i, 3], [/Talk to Leela near Draynor Village/i, 2],
    [/go and speak to Osman/i, 1], [/I can start this quest/i, 0],
];
/** accounts whose keyprint went to Osman in an earlier attempt (the key then waits at Leela; the journal cannot tell) */
const PA_OSMAN2 = new Set<string>();

export const QUEST = { name: 'Prince Ali Rescue', dir: 'quest_prince', qp: 3 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        attack: [40, 'kills a jail guard that stands next to you (32 hp, def 21) before each jail dialog; 40 works (+60-80 t), 80 is fast'],
        strength: [40, 'as attack'],
        hitpoints: [30, 'the Draynor jail guards (917, cl26, 32 hp, huntmode aggressive_melee with check_nottoostrong=off: they attack ANY level within 5 tiles, draynor.npc:152-182) hit you during Keli / Joe / the cell; a fresh 10-hp account died twice (fbp1)'],
        defence: [30, 'as hitpoints'],
    } as Record<string, [number, string]>,
    start: { x: 3222, z: 3219, level: 0 },              // anywhere (the first move is a glory teleport); Lumbridge for the sim
    end: { x: 3301, z: 3163, level: 0 },                // Hassan, Al Kharid palace
};
export const SUPPLY: Item[] = [
    // 5 teleports (Al Kharid, Draynor, Al Kharid, Draynor, Al Kharid) = a 4-charge + a 1-charge amulet of glory
    { name: 'amulet_of_glory_4', n: 1 }, { name: 'amulet_of_glory_1', n: 1 },
    { name: 'softclay', n: 1 }, { name: 'bronze_bar', n: 1 }, { name: 'ball_of_wool', n: 3 }, { name: 'yellowdye', n: 1 },
    { name: 'pink_skirt', n: 1 }, { name: 'redberries', n: 1 }, { name: 'pot_flour', n: 1 }, { name: 'bucket_water', n: 1 },
    { name: 'ashes', n: 1 }, { name: 'beer', n: 3 }, { name: 'rope', n: 1 },
    { name: 'lobster', n: 4 },   // food for the jail guards (eaten at 50% hp)
];
/** session 11 fix 294b: 3 spare beers in the BANK only (route-legs bankStage): Joe needs all 3 in ONE conversation
 *  (joe_guard.rs2 joe_beer: one beer, then `inv_total(beer) < 2` ends it), so a talk cut after the 1st beer can never make
 *  him drunk again from the pack; the retry's bank visit restocks these. PA_BEER_SPARE=0 = none. */
export const BEER_SPARE: Item[] = process.env.PA_BEER_SPARE === '0' ? [] : [{ name: 'beer', n: 3 }];
/** fix 420 (a live route-hard-full run: the prince leg stopped gate-stuck AFTER 'prince saved'; the relaunch's
 *  prep stopped on 'bank ardougne-n lacks softclay, ball_of_wool x3, yellowdye, pink_skirt, redberries, bucket_water, ashes'
 *  - all used up by attempt 1; the old static resumeOptional missed pink_skirt and was blind to the stage). The kit items
 *  only DONE steps consume, by the journal (%princequest) + the held/banked intermediates. An intermediate whose step is done
 *  but whose product is lost keeps its inputs REQUIRED: the module remakes it (wig/paste at st 3-5 = PA_REENTRY, Ned/Aggie
 *  need only spoken_osman; a lost key = Leela, 15 gp from the kit's 30). Journal unreadable (-1): only the held products count.
 *  existing.ts prep: a resumed prince lacking only these runs lenient; the others are sourced. */
export async function doneKit(bot: SpeedBot): Promise<string[]> {
    const st = await journalStage<number>(bot, 'prince', PA_STAGES, -1, s => console.log(`[prince] doneKit ${s}`));
    const own = (n: string) => bot.count(objId(n)) > 0 || bot.bankCount(objId(n)) > 0;
    // saved (6) or complete: only the travel to Hassan is left (glory or the no-glory toll hop; the kit coins stay)
    if (st >= 6) return [...new Set([...SUPPLY, ...BEER_SPARE].map(i => i.name).filter(n => !/^amulet_of_glory/.test(n) && n !== 'coins'))];
    const out: string[] = [];
    // key: past Leela's prep check (3+) a lost key is re-issued by her (15 gp); a held key / an earlier osman2 = keymade
    if (st >= 3 || own('princeskey') || (st >= 2 && PA_OSMAN2.has(String(bot.loginUser ?? '').toLowerCase()))) out.push('softclay', 'bronze_bar');
    else if (own('keyprint')) out.push('softclay');                                    // the imprint exists: Osman needs only the bar
    if (own('blondwig')) out.push('ball_of_wool', 'yellowdye');
    else if (own('plainwig')) out.push('ball_of_wool');
    if (own('skinpaste')) out.push('redberries', 'pot_flour', 'bucket_water', 'ashes');
    if (st >= 4) out.push('beer');                                                     // guard_drunk
    // tied_keli (5): the rope is spent, but Keli respawns (npc_del is temporary) and must be tied again: the rope stays required
    return out;
}
/** 294 TEST (PA_JOE_TEST=1): accounts that already dropped their test beer (once per process) */
const PA_JOE_CUT = new Set<string>();

const N = { hassan: 923, osman: 924, leela: 915, joe: 916, keli: 919, prince: 920, ned: 918, aggie: 922 };
const T = {
    hassan: { x: 3302, z: 3163 }, osman: { x: 3286, z: 3180 }, leela: { x: 3113, z: 3263 }, joe: { x: 3123, z: 3245 },
    keli: { x: 3128, z: 3244 }, prince: { x: 3123, z: 3242 }, ned: { x: 3100, z: 3258 }, aggie: { x: 3086, z: 3259 },
};
const CELL_DOOR = { id: 2881, x: 3123, z: 3243 };
const JAILGUARD = 917;
/** The jail building (planner map, probe-grid.ts): x 3121-3130, z 3240-3246, door 1536 on the N edge of (3128,3246); the cell
 *  x 3121-3125 z 3240-3243 behind gate 2881 (3123,3243). Outside, z 3247 is blocked except the door approach (3128,3247). */
const inCell = (t: { x: number; z: number }) => t.x >= 3121 && t.x <= 3125 && t.z >= 3240 && t.z <= 3243;
const inJail = (t: { x: number; z: number }) => t.x >= 3121 && t.x <= 3130 && t.z >= 3240 && t.z <= 3246;
/** The jail guards attack on sight every 5 t (attackrate 5) and every swing closes our dialog (npc_combat_melee.rs2:35): the
 *  23-page Keli conversation needs 5 uninterrupted ticks. Kill every guard within `r` tiles of the jail first (32 hp, respawn
 *  60 t, draynor.npc:152-190), then talk. */
/** The guards spawn OUTSIDE the jail (3121,3249 / 3127,3248 / 3120,3238 / 3109,3237); Keli, Joe and the cell are inside, behind
 *  door 1536 (3128,3246, N edge; open leaf 1537 on 3128,3247). Step inside and shut it: npcs do not open doors. */
async function shutJailDoor(bot: SpeedBot, log: ReturnType<typeof mkLog>): Promise<void> {
    const inside = () => inJail(bot.tile());
    // get in: walk to the door, open it if shut (door tracker), step through (npcs on the inner tiles block a fixed target)
    const door = locAt(1536, 3128, 3246, 0);
    for (let k = 0, t1 = bot.tickCount; !inside(); k++) {
        if (bot.tickCount - t1 > 80) fail(bot, 'could not enter the jail');
        if (Math.max(Math.abs(bot.tile().x - 3128), Math.abs(bot.tile().z - 3247)) > 2) { await go(bot, { x: 3128, z: 3248 }, 1, 'to the jail door', 300).catch(() => undefined); continue; }
        if (bot.chatModalId !== -1) bot.closeModal();
        if (bot.doorTracker?.isOpen(0, 3128, 3246) === false) { opLocGo(bot, door, 1, { x: 3128, z: 3247 }); await bot.tick(3); continue; }
        const step = [{ x: 3128, z: 3245 }, { x: 3127, z: 3245 }, { x: 3129, z: 3245 }][k % 3]!;
        bot.sendRoute([{ x: 3128, z: 3247 }, { x: 3128, z: 3246 }, step]); await bot.tick(3);
    }
    const t0 = bot.tickCount; let last = -100;
    while (bot.liveLocs.get('0,3128,3247') === 1537) {
        if (bot.tickCount - t0 > 20) { log('jail door: could not shut'); return; }
        if (bot.tickCount - last >= 3) { if (bot.chatModalId !== -1) bot.closeModal(); opLocGo(bot, { id: 1537, x: 3128, z: 3247, width: 1, length: 1, angle: 2, shape: 0 } as any, 1, { x: 3128, z: 3246 }); last = bot.tickCount; }
        await bot.tick(1);
    }
    log.split('jail door shut');
    // a guard that chased us in is shut in WITH us: kill it (32 hp), the dialogs need 5 quiet ticks
    const inGuards = () => npcsOf(bot, JAILGUARD).filter(q => inJail(q));
    if (inGuards().length) {
        const tk = bot.tickCount;
        while (inGuards().length && bot.tickCount - tk < 150) {
            const q = inGuards().sort((a, b) => a.d - b.d)[0]!;
            if (!(await killGuard(bot, q.idx))) break;
        }
        log.split('guard inside killed');
    }
}
/** Kill one specific guard (by npc index): attack it, re-attack every 8 t, done when it is gone (dead) or unreachable for
 *  12 t. killFor() picks the NEAREST guard, which is often one outside the wall (unreachable): sim fbp110/120 spent 160 t. */
async function killGuard(bot: SpeedBot, idx: number, maxTicks = 90): Promise<boolean> {
    const t0 = bot.tickCount; let last = -100, stuck = 0, lastPos = '';
    while (bot.tickCount - t0 < maxTicks) {
        const q = npcsOf(bot, JAILGUARD).find(r => r.idx === idx);
        if (!q) return true;
        const pk = `${bot.tile().x},${bot.tile().z}`; stuck = pk === lastPos && q.d > 1 ? stuck + 1 : 0; lastPos = pk;
        if (stuck >= 12) return false;
        if (bot.chatModalId !== -1) bot.closeModal();
        if (bot.tickCount - last >= 8) { opNpcGo(bot, q, 2); last = bot.tickCount; }
        await bot.tick(1);
    }
    return false;
}
/** A jail conversation: before each attempt, kill any guard within 2 tiles (it swings every 5 t and each swing closes the
 *  dialog); then one converse attempt. The door does not always keep them out (sim fbp91: a guard at 3126,3246 next to us). */
async function jailTalk(bot: SpeedBot, label: string, attempt: () => Promise<void>, done: () => boolean, target?: number): Promise<void> {
    for (let k = 0; !done(); k++) {
        if (k >= 8) fail(bot, `${label}: still cut short after ${k} attempts`);
        // session 11 fix 314b PA_JOE_SIDE (CONFIRMED qx76p, engine optrace t32035-32049: from the door tile 3128,3246 inside the
        // SHUT jail door the bot attacked guard 917@3128,3247 outside it for 14 t ('target kept', never reached: the door is a
        // wall), stood still, the route's fix 154 then toggled the door on our tile OPEN; t32052 Joe was OUTSIDE the box at
        // 3125,3248 next to guard 917@3126,3249 -> the talk opened t32054, one beer, the guard's swing if_closed it (t32060)):
        // the guards that matter are the ones on the TALK TARGET's side (Joe wanders out of the box: outside in 5 of 16 talks,
        // qx68-76 optrace), within 5 of him or 3 of us; a guard across the shut jail door can neither be reached nor swing.
        // Several are killed in turn (bounded). Used for Joe and for Keli's keyprint talk. PA_JOE_SIDE=0 reverts (our side only, one kill).
        const SIDE = target !== undefined && process.env.PA_JOE_SIDE !== '0';
        const tq = SIDE ? npcsOf(bot, [target!]).sort((a, b) => a.d - b.d)[0] : undefined;
        if (SIDE && tq) {
            const tIn = inJail(tq), shut = bot.liveLocs.get('0,3128,3247') !== 1537;
            const isShut = () => bot.liveLocs.get('0,3128,3247') !== 1537;
            const near = () => npcsOf(bot, JAILGUARD).filter(q => (inJail(q) === tIn && Math.max(Math.abs(q.x - tq.x), Math.abs(q.z - tq.z)) <= 5)
                || (q.d <= 3 && !(isShut() && inJail(q) !== inJail(bot.tile())))).sort((a, b) => a.d - b.d);
            // across a shut door from the target: open it first (the kills and the talk walk through it)
            if (shut && inJail(bot.tile()) !== tIn) { console.log(`[prince] 314 ${label}: target ${tq.x},${tq.z} is ${tIn ? 'inside' : 'outside'}, we are not: opening the jail door`); opLocGo(bot, locAt(1536, 3128, 3246, 0), 1, { x: 3128, z: inJail(bot.tile()) ? 3246 : 3247 }); await bot.tick(3); }
            const tk = bot.tickCount;
            for (let n = 0; near().length && n < 3 && bot.tickCount - tk < 150; n++) {
                const q = near()[0]!;
                const ok = await killGuard(bot, q.idx);
                console.log(`[prince] 314 ${label}: guard ${q.x},${q.z} (target ${tq.x},${tq.z} ${tIn ? 'in' : 'out'}) ${ok ? 'killed' : 'not reached'} ${bot.tickCount - tk} t`);
                if (!ok) break;
            }
        } else {
            const close = () => npcsOf(bot, JAILGUARD).filter(q => (q.d <= 3 && inJail(q) === inJail(bot.tile())) || (process.env.PA_DOOR_GUARD !== '0' && q.d <= 1));   // session 9 (qu16p: a guard ON the jail door tile 3128,3247 (outside the box) swung every ~4 t: 8 attempts cut short, hp unchanged = 0-hits)
            if (close().length) {
                await killGuard(bot, close()[0]!.idx);
            }
        }
        // session 9 (allchaos qt37p + qu03p: 8 x 'dialog did not finish' right after 'guard inside killed', the retry passed
        // first time): the kill's level-up pages (attack 88 ...) open first, take the planned burst and block the OPNPC.
        // Page every blocking page through before each attempt (PA_LEVELUP_CLEAR=0 reverts).
        if (process.env.PA_LEVELUP_CLEAR !== '0') {
            for (let i = 0; i < 12 && (bot.blockingPageOpen() || (bot.chatModalId !== -1 && !npcsOf(bot, N.keli).some(q => q.d <= 2))); i++) {
                if (i === 0) console.log(`[prince] ${label}: paging a blocking page first (chat ${bot.chatModalId})`);
                bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1);
            }
        }
        const hp0 = bot.stat('hitpoints').cur, a0 = bot.tickCount;
        await attempt().catch(e => console.log(`[prince] ${label}: ${(e as Error).message.slice(0, 120)} | chat ${bot.chatModalId} blocking ${bot.blockingPageOpen()} | ${bot.tickCount - a0} t hp ${hp0}->${bot.stat('hitpoints').cur} npcs ${npcsOf(bot, [...Array(4000).keys()]).filter(q => q.d <= 4).map(q => `${q.type}@${q.x},${q.z}`).join(' ')} msgs ${JSON.stringify((bot as any).getChat?.({ limit: 3 })?.map((c: any) => c.text) ?? [])}`));
        // session 9 (allchaos qu10p: 8 attempts in 39 t right after 'guard inside killed', chat -1, no blocking page; the retry
        // passed first time): from the 3rd miss wait out the combat state 8 t before the next attempt (PA_KELI_WAIT=0 reverts)
        if (!done() && k >= 2 && process.env.PA_KELI_WAIT !== '0') { if (bot.chatModalId !== -1) bot.closeModal(); bot.queueFlush(); await bot.tick(8); }
    }
}
async function clearGuards(bot: SpeedBot, log: ReturnType<typeof mkLog>, r = 7): Promise<void> {
    const center = { x: 3125, z: 3244 };
    const near = () => npcsOf(bot, JAILGUARD).filter(q => Math.max(Math.abs(q.x - center.x), Math.abs(q.z - center.z)) <= r);
    if (!near().length) return;
    await killFor(bot, 'jail guards', [JAILGUARD], center, [], () => near().length === 0, { maxTicks: 250, radius: r + 3 });
    log.split('guards cleared');
}
type Res = { ok: boolean; ticks: number; msg: string };
/** A/B: PRINCE_CLEAR=0 skips killing the jail guards (then the jail dialogs are retried until a gap between swings). */
const CLEAR = process.env.PRINCE_CLEAR === '1';
/** Shut the jail door behind us (default on; PRINCE_SHUT=0 for the A/B). */
const SHUT = process.env.PRINCE_SHUT !== '0';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<Res> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'prince', o.log !== false);
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    const g = guard(bot);
    const has = (k: string) => bot.count(k) > 0;
    // the jail guards attack on sight: auto-retaliate off for the run, so their hits never redirect us (restored at the end)
    setRetaliate(bot, false);
    const sp = (k: string) => { log.split(k); failHook(k); };
    // session 10: on a retry / resume, the stage from the quest JOURNAL: Hassan / Osman / Keli's keyprint / Joe / the rope are
    // skipped once done, and a keyprint already turned into a key (an earlier attempt's osman2) is collected from Leela.
    // -1 on a fresh attempt. PA_RESUME=0 reverts.
    let st = -1;
    const acct = String(bot.loginUser ?? '').toLowerCase();
    if (isResuming(bot) && process.env.PA_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); await bot.tick(1); }
        st = await journalStage<number>(bot, 'prince', PA_STAGES, -1, s => console.log(`[prince] ${s}`));
        console.log(`[prince] resume: stage ${st}, osman2 earlier ${PA_OSMAN2.has(acct)}, pack ${packStr(bot)}`);
        if (st >= 7) return { ok: true, ticks: bot.tickCount - log.t0, msg: 'journal: quest complete' };
    }
    const keyMade = () => st >= 2 && PA_OSMAN2.has(acct);
    try {
        const disguise = () => has('blondwig') && has('pink_skirt') && has('skinpaste');
        const stage = { saved: false, osmanDone: false };
        // ---- AL KHARID 1: Hassan + Osman (no observable: skipped when the Draynor items already exist) ----
        if (!has('keyprint') && !has('plainwig') && !has('blondwig') && !has('princeskey') && st < 2) {
            await glory(bot, 'alkharid'); sp('tele AK1');
            if (st < 1) await chat(bot, N.hassan, T.hassan, [R, M3[0]!, R, R], [/^Can I help you\? You must need some help here in the desert\.$/], 'hassan1');
            sp('hassan1');
            await chat(bot, N.osman, T.osman, [R, R, M2[1]!, R, R, R, R, M3[2]!, R, R], [/^What is the second thing you need\?$/, /^Okay, I better go find some things\.$/], 'osman1');
            sp('osman1');
        }
        // ---- DRAYNOR 1: keyprint (Keli), wig (Ned), paste (Aggie) ----
        // PA_REENTRY=1 (set only by route/existing-lib.ts): a resume past the guard stage (st 3-5) that lost the wig or
        // the paste remakes them here (Ned/Aggie need only spoken_osman, ned.rs2/aggie.rs2); the keyprint part stays st < 3
        const RE = process.env.PA_REENTRY === '1';
        const remake = RE && st >= 3 && st < 6 && ((!has('plainwig') && !has('blondwig')) || !has('skinpaste'));
        if (remake) console.log(`[prince] F3 resume at stage ${st}: remaking ${!has('skinpaste') ? 'paste ' : ''}${!has('plainwig') && !has('blondwig') ? 'wig' : ''}`);
        if ((st < 3 && ((!has('keyprint') && !has('princeskey') && !stage.osmanDone && !keyMade()) || (!has('plainwig') && !has('blondwig')) || !has('skinpaste'))) || remake) {
            await glory(bot, 'draynor'); sp('tele D1');
            if (!has('blondwig') && !has('plainwig')) {
                await converse(bot, N.ned, T.ned, [R, M3[0]!, R, R, M3[1]!, R, R, M2[0]!, R, R, R, R, R], () => has('plainwig') && !inDialog(bot),
                    [/^Ned, could you make other things from wool\?$/, /^How about some sort of wig\?$/, /^I have that now\. Please, make me a wig\.$/], 'ned', { maxTicks: 40 });
                sp('ned');
            }
            if (has('plainwig') && has('yellowdye')) {   // blond wig: dye on the wig (no delay)
                const t1 = bot.tickCount;
                while (!has('blondwig')) {
                    if (bot.tickCount - t1 > 10) fail(bot, 'blond wig');
                    if ((bot.tickCount - t1) % 3 === 0) { bot.useItemOnItem(objId('yellowdye'), bot.slot('yellowdye'), objId('plainwig'), bot.slot('plainwig')); bot.queueFlush(); }
                    await bot.tick(1);
                }
            }
            if (!has('skinpaste')) {
                await converse(bot, N.aggie, T.aggie, [R, M5[0]!, R, R, M2[0]!, R, R, R, R, R, R], () => has('skinpaste') && !inDialog(bot),
                    [/^Could you think of a way to make skin paste\?$/, /^Yes please\. Mix me some skin paste\.$/], 'aggie', { maxTicks: 40 });
                sp('aggie');
            }
            if (!has('keyprint') && !has('princeskey') && !keyMade() && st < 3) {
                if (CLEAR) { await go(bot, { x: 3124, z: 3248 }, 3, 'to jail', 200); await clearGuards(bot, log); }
                if (SHUT) await shutJailDoor(bot, log);
                const kp = [/^I have heard rumours that you kill people\.$/, /^What is your latest plan then\?$/, /^Can you be sure they will not try to get him out\?$/, /^Could I see the key please\?$/, /^Could I touch the key for a moment\?$/];
                await jailTalk(bot, 'keli1', () => converse(bot, N.keli, T.keli, [R, R, M4[2]!, R, R, M4[1]!, R, R, R, M4[2]!, R, R, R, M3[0]!, R, R, R, M2[0]!, R, R, R, R, R], () => has('keyprint') && !inDialog(bot), kp, 'keli1', { maxTicks: 60, tries: 1 }), () => has('keyprint'), N.keli);   // 314b: Keli's side (qzh03p: the same door stall + fix 154 let a guard in, keli1 84 t)
                sp('keli1');
            }
        }
        // ---- AL KHARID 2: Osman makes the key ----
        if (has('keyprint')) {
            await glory(bot, 'alkharid'); sp('tele AK2');
            await converse(bot, N.osman, T.osman, [R, R, R, M2[0]!, R], () => !has('keyprint') && !inDialog(bot), [/^Thank you\. I will try to find the other items\.$/], 'osman2', { maxTicks: 30 });
            stage.osmanDone = true; PA_OSMAN2.add(acct);
            sp('osman2');
        }
        // ---- DRAYNOR 2: Leela (key, prep), Joe (3 beers), Keli (rope), the cell, the prince ----
        let princeSaved = st >= 6;
        if (!princeSaved) {
            await glory(bot, 'draynor'); sp('tele D2');
            if (!has('princeskey')) {
                await converse(bot, N.leela, T.leela, [R, R, R], () => has('princeskey') && !inDialog(bot), [], 'leela', { maxTicks: 30, tries: 6 });
                sp('leela');
            }
            if (!disguise() || !has('princeskey')) fail(bot, `missing disguise/key: ${packStr(bot)}`);
            if (CLEAR && bot.count('beer') >= 3) { await go(bot, { x: 3124, z: 3248 }, 3, 'to jail', 200); await clearGuards(bot, log); }
            // session 11 fix 314a PA_JOE_OUT (see 314b in jailTalk; CONFIRMED qx76p: Joe stood OUTSIDE the jail box (3125,3248)
            // while we shut ourselves in): when Joe is in view outside the box at the jail door, talk to him there first
            // (the guards near him killed by 314b), and shut the door only after, for Keli and the cell. PA_JOE_OUT=0 reverts.
            // TEST: PA_JOE_OUT_TEST=1 takes this path wherever Joe stands.
            let joeFirst = false;
            if (SHUT && process.env.PA_JOE_OUT !== '0' && st < 4 && bot.count('beer') >= 3) {
                if (Math.max(Math.abs(bot.tile().x - 3128), Math.abs(bot.tile().z - 3248)) > 3) await go(bot, { x: 3128, z: 3248 }, 2, 'to the jail door', 300).catch(() => undefined);
                const j = npcsOf(bot, [N.joe]).sort((a, b) => a.d - b.d)[0];
                joeFirst = !!j && (!inJail(j) || process.env.PA_JOE_OUT_TEST === '1');
                console.log(`[prince] 314a: Joe ${j ? `${j.x},${j.z} ${inJail(j) ? 'inside' : 'OUTSIDE'} the jail` : 'not in view'} -> ${joeFirst ? 'talk to him first, shut the door after' : 'shut the door first'}`);
            }
            if (SHUT && !joeFirst) await shutJailDoor(bot, log);
            // session 11 fix 294a (CONFIRMED qx45p: 'joe: dialog did not finish' x2 with jail guards 917 next to us (hp 74 -> 67),
            // the beers went 3 -> 1 -> 0 and the step counted 'no beer left' as done; the retry's journal still said 'deal with
            // the Guard' (stage 3, not guard_drunk) with 0 beers, so the rope on Keli was refused (quest_prince.rs2 opnpcu
            // lady_keli: < guard_drunk -> 'You cannot tie Keli up ...') for 120 t, twice): Joe is done only when he is DRUNK
            // (the 'The guard is drunk' mesbox / his slurred line, else the journal); no more talks once fewer than 3 beers are
            // left (each would waste one); without 3 beers and not drunk -> fail at once (the retry's bank visit restocks the
            // 294b spare). PA_JOE_DRUNK=0 reverts. TEST: PA_JOE_TEST=1 drops one beer before Joe on the 1st attempt (= qx45p's state after a cut talk: < 3 beers, not
            // drunk; closing the talk after beer 1 does not work, the planned page burst is already queued); on the
            // retry a sim cheat stands in for the bank spare (a fork's bank predates bankStage).
            const JD = process.env.PA_JOE_DRUNK !== '0';
            const DRUNK_RE = /guard is drunk|no longer a problem|Franksh/i;
            if (JD) for (const [k, v] of [...bot.ifText]) if (DRUNK_RE.test(v)) bot.ifText.delete(k);
            let drunk = false;
            const drunkSeen = () => drunk ||= [...bot.ifText.values()].some(v => DRUNK_RE.test(v));
            if (JD && st < 4 && bot.count('beer') < 3 && process.env.PA_JOE_TEST === '1' && isResuming(bot) && /^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) {
                const { localSetup, CHEATS } = await import('../../../core.js');
                const blk = CHEATS.blocked; CHEATS.blocked = '';   // TEST only: --cheatless blocks localSetup for the runners
                try { await localSetup(bot, { items: [{ name: 'beer', n: 3 - bot.count('beer') }] }); } finally { CHEATS.blocked = blk; }
                await bot.tick(1);
                console.log(`[prince] 294 TEST: bank spare beers stood in by cheat; pack ${packStr(bot)}`);
            }
            if (process.env.PA_JOE_TEST === '1' && !PA_JOE_CUT.has(acct) && bot.count('beer') >= 3) {
                PA_JOE_CUT.add(acct);
                for (let k = 0; k < 5 && bot.count('beer') >= 3; k++) { bot.dropItem(objId('beer'), bot.slot('beer')); bot.queueFlush(); await bot.tick(2); }
                console.log(`[prince] 294 TEST: dropped a beer before Joe (beers ${bot.count('beer')})`);
            }
            if (JD && st < 4 && bot.count('beer') < 3) fail(bot, `joe: ${bot.count('beer')} beer(s) and the guard is not drunk (journal stage ${st}): Joe needs 3 in one talk; the retry's bank visit takes the spare`);
            if (bot.count('beer') >= 3 && st < 4) {
                const talkDone = JD ? () => (drunkSeen() || bot.count('beer') < 3) && !inDialog(bot) : () => bot.count('beer') === 0 && !inDialog(bot);
                await jailTalk(bot, 'joe', () => converse(bot, N.joe, T.joe, [M4[0]!, R, R, R, R, R, R, R, R, R, R, R, R], talkDone,
                    [/^I have some beer here, fancy one\?$/], 'joe', { maxTicks: 40, tries: 1 }), JD ? () => drunkSeen() || bot.count('beer') < 3 : () => bot.count('beer') === 0, N.joe);
                if (JD && !drunkSeen()) {
                    if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
                    const js = await journalStage<number>(bot, 'prince', PA_STAGES, -1, s2 => console.log(`[prince] ${s2}`));
                    if (js < 4) fail(bot, `joe: the guard is not drunk after the talk (beers left ${bot.count('beer')}, journal stage ${js}); the retry's bank visit takes the spare`);
                    console.log(`[prince] joe: drunk text not seen, journal stage ${js} -> drunk`);
                }
                sp('joe');
            }
            if (SHUT && joeFirst) await shutJailDoor(bot, log);   // 314a: Joe was talked to outside; now in + shut for Keli
            // F3 (PA_REENTRY): a resume at tied_keli (st 5) finds Keli respawned (npc_del is temporary): the cell gate refuses while
            // she is within 10 tiles (quest_prince.rs2 oplocu alidoor), and the rope on her works again at any stage < saved
            const retie = RE && st === 5 && !!npc(bot, N.keli);
            if (retie) console.log(`[prince] F3 resume at stage 5: Keli is back (${JSON.stringify(npc(bot, N.keli))}): tie her again (rope ${bot.count('rope')})`);
            if (has('rope') && (st < 5 || retie)) {
                // rope on Keli (opnpcu): mesbox, Keli is removed
                const t1 = bot.tickCount; let last = -100;
                while (has('rope')) {
                    // fix 186 (allchaos qt23fp 'tie Keli' twice at (3127,3243)): 120 t, a door-aware walk next to Keli every 20 t
                    // without progress, and say where Keli is when it fails. PA_KELI_WALK=0 reverts (60 t, no walk).
                    const kw = process.env.PA_KELI_WALK !== '0';
                    if (bot.tickCount - t1 > (kw ? 120 : 60)) { const kk = npc(bot, N.keli); fail(bot, `tie Keli (keli ${kk ? `${kk.x},${kk.z} d${kk.d}` : 'not visible'})`); }
                    if (kw && bot.tickCount - t1 > 0 && (bot.tickCount - t1) % 20 === 0) { const kk = npc(bot, N.keli); if (kk && kk.d > 1) await bot.walkTo(kk.x, kk.z, { near: 1, maxTicks: 30, log: false }); }
                    // qt27p: 'tie Keli (keli 3130,3241 d1)' from (3130,3242) twice: one tile away but through a shut door (chaos):
                    // open a shut door on our tile, Keli's or between, every 10 t (PA_KELI_WALK=0 reverts with 186)
                    if (kw && (bot.tickCount - t1) % 10 === 5) {
                        const kk = npc(bot, N.keli), me = bot.tile();
                        for (const t of kk ? [me, { x: kk.x, z: kk.z }, { x: me.x, z: kk.z }, { x: kk.x, z: me.z }] : [me]) {
                            const cd = bot.doorTracker?.closedDoorAt(0, t.x, t.z);
                            if (cd) { bot.opLoc(t.x, t.z, cd.locId, cd.op); bot.queueFlush(); await bot.tick(2); console.log(`[prince] Keli: opened a shut door at ${t.x},${t.z}`); break; }
                        }
                    }
                    if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                    else if (bot.tickCount - last >= 5) {
                        const k = npc(bot, N.keli);
                        if (!k) { await go(bot, T.keli, 2, 'to Keli', 100); continue; }
                        if (k.d > 1) { await openNpc(bot, N.keli, T.keli, 'keli-approach', { done: () => { const q = npc(bot, N.keli); return !!q && q.d <= 1; } }).catch(() => undefined); }
                        // session 8 (allchaos qt46m 'tie Keli (keli 3128,3244 d1)' x2 from (3128,3245)/(3131,3248): the raw OPNPCU from
                        // a 'd1' tile kept being discarded): after 30 t send it through q-lib approachNpc (cardinal adjacency, doors,
                        // standing on the npc) like an OPNPC. PA_KELI_APPROACH=0 reverts.
                        const k2 = npc(bot, N.keli);
                        if (k2 && process.env.PA_KELI_APPROACH !== '0' && bot.tickCount - t1 > 30) { const ref = npcsOf(bot, N.keli).find(q => q.idx === k2.idx); if (ref) { approachNpc(bot, ref, () => bot.useItemOnNpc(ref.idx, objId('rope'), bot.slot('rope')), { doors: true }); bot.queueFlush(); } }
                        else if (k2) { bot.useItemOnNpc(k2.idx, objId('rope'), bot.slot('rope')); bot.queueFlush(); }
                        last = bot.tickCount;
                    }
                    await bot.tick(1);
                }
                await answerUntil(bot, () => !inDialog(bot), [], 10);
                sp('keli tied');
            }
            // the cell door: key from the north side (z > 3243); it walks you in
            const door = locAt(CELL_DOOR.id, CELL_DOOR.x, CELL_DOOR.z, 0);
            {
                const t1 = bot.tickCount; let last = -100;
                // the cell is x 3121-3125, z 3240-3243 (probe-grid.ts); the jail corridor east of it (x 3126+) is NOT the cell
                if (!inCell(bot.tile())) await go(bot, { x: 3123, z: 3244 }, 0, 'cell door', 100).catch(() => undefined);
                while (!inCell(bot.tile())) {
                    if (bot.tickCount - t1 > 40) fail(bot, 'cell door');
                    if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                    else if (bot.tickCount - last >= 4) { syncLeaves(bot); useOnLocGo(bot, 'princeskey', door, { x: 3123, z: 3244 }); last = bot.tickCount; }
                    await bot.tick(1);
                }
            }
            sp('cell');
            // inside the cell: OPNPC straight (no walking: a walk could leave through the gate again, sim fbp100)
            {
                const t1 = bot.tickCount; let last = -100;
                const ok = () => !has('princeskey') && !has('blondwig') && !inDialog(bot);
                // F3 (PA_REENTRY; sim exfb3: the pair rescued him 30 t earlier): ticks with no prince in view do not count, up to 400 t
                let away = 0;
                while (!ok()) {
                    if (RE && !npc(bot, N.prince) && away < 400) { if (away++ % 50 === 0) console.log(`[prince] F3 cell: no prince in view (${away} t): waiting for his respawn`); }
                    if (bot.tickCount - t1 - away > 80) fail(bot, `prince: no rescue${RE ? ` (waited ${away} t for him)` : ''}`);
                    if (bot.chatModalId !== -1) { for (let i = 0; i < 5; i++) bot.resumeDialogPage(); bot.queueFlush(); }
                    else if (bot.tickCount - last >= 4) {
                        // stepped back out through the gate (opNpcGo steps off the prince's tile when he stands on ours): key again
                        if (!inCell(bot.tile())) { if (Math.max(Math.abs(bot.tile().x - 3123), Math.abs(bot.tile().z - 3244)) > 0) await go(bot, { x: 3123, z: 3244 }, 0, 'cell door', 40).catch(() => undefined); useOnLocGo(bot, 'princeskey', door, { x: 3123, z: 3244 }); }
                        else { const p = npc(bot, N.prince); if (p) bot.opNpc(p.idx, 1); bot.queueFlush(); }
                        last = bot.tickCount;
                    }
                    await bot.tick(1);
                }
            }
            princeSaved = true; stage.saved = true;
            sp('prince');
        }
        // ---- AL KHARID 3: Hassan pays ----
        // F3 (PA_REENTRY, sim h31a: glory-free, the plain walk to Hassan wedged 3,000 t at the toll gate 3267,3227): glory-free runs
        // take noglory.ts's Al Kharid hop (SR_TOLL_HOP: the gate + border guard dialog) through glory()
        if (GLORIES_LEFT(bot) || (RE && process.env.SR_NO_GLORY === '1')) { await glory(bot, 'alkharid'); sp('tele AK3'); }
        else { await go(bot, T.hassan, 2, 'walk to Hassan', 3000); sp('walk AK3'); }
        await openNpc(bot, N.hassan, T.hassan, 'hassan2', { done: () => inDialog(bot) || done() });
        const t2 = bot.tickCount;
        while (!done()) {
            if (bot.tickCount - t2 > 60) fail(bot, 'hassan: no completion');
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            await bot.tick(1);
        }
        sp('complete');
        if (g.dead) fail(bot, 'died');
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - log.t0, msg: `${(e as Error).message} | pack ${packStr(bot)}` };
    } finally { g.stop = true; bot.holdDialogs = false; setRetaliate(bot, true); }
}
function GLORIES_LEFT(bot: SpeedBot): boolean { return ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1'].some(n => bot.count(n) > 0); }
export { opLocGo, opNpcGo, talk };

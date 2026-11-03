// q-merlins-crystal.ts — Merlin's Crystal (6 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// Verified flow (paths relative to server/content/scripts/; %arthur stages quest_arthur.constant):
//   1. King Arthur (npc 251, 2764,3515): "I want to become a Knight..." -> %arthur 1 (area_camelot/scripts/king_arthur.rs2:79-95).
//   2. Sir Gawain (240, 2763,3506): "Do you know how Merlin got trapped?" -> 2 (sir_gawain.rs2:119,139-143).
//   3. Sir Lancelot (239, L1 2759,3515): "Any ideas on how to get into Morgan Le Faye's stronghold?" (offered only at
//      %arthur 2) -> 3 (sir_lancelot.rs2:171,186-190).
//   4. Arhein's crate (loc 63 merlincrate_empty, 2801,3442 Catherby) Hide-in (needs %arthur >= 3) -> ~20 mesbox
//      pages -> "Yes." -> Keep Le Faye L0 (2778,3401) (quests/quest_arthur/scripts/quest_arthur.rs2:2-35,68-77).
//   5. Keep stairs L0 (2769,3404) -> L1, (2769,3398) -> L2. Sir Mordred (247, L2 2769,3403, 38 hp): at 0 hp his
//      ai_queue3 opens Morgan Le Faye's dialog (sir_mordred.rs2:6-12): "Tell me how to untrap Merlin and I might." ->
//      %arthur 4 -> "OK I will go do all that." (sir_mordred.rs2:18-47,73-77). Renegade knights are cowardly.
//   6. Out: L2 stairs down, crate loc 64 merlincrate_empty2 (L1 2779,3401) -> Catherby (2802,3441)
//      (quest_arthur.rs2:38-66).
//   7. Candle maker (562, 2800,3439): "Have you got any black candles?" (offered at %arthur 4) sets bit 1; talk
//      again with bucket_wax -> unlit black candle (area_catherby/scripts/candle_maker.rs2:1-36). Tinderbox on it
//      -> lit (skill_firemaking/scripts/firemaking.rs2:13-26, light_source.rs2:1-11).
//   8. Lady of the Lake (250, 2924,3405 Taverley): "I seek the sword Excalibur." -> excalibur_started
//      (area_taverly/scripts/lady_of_the_lake.rs2:4-43).
//   9. Glory -> Draynor Village, then the Port Sarim jeweller's door (loc 59, 3016,3246) op1 spawns the beggar + dialog:
//      "Yes certainly." with bread -> Excalibur (quest_arthur.rs2:210-223, beggar.rs2:18-46).
//  10. Glory -> Edgeville, then the chaos altar (loc 61 thrantaxaltar, WILDERNESS lvl 12 at 3239,3608, the only one) op2
//      at %arthur 4 sets bit 0 (quest_arthur.rs2:142-148). The wilderness_warning modal (1908) is closed on the way.
//      Glory: general/scripts/enchanted_jewellry/amulet_of_glory.rs2:1-35 (Draynor 109 tiles to the jeweller vs 158 from
//      the Falador teleport; Edgeville 205 tiles to the altar vs 257 from Varrock: navgrid path lengths).
//  11. Camelot magic symbol 0_43_54_28_59 = (2780,3515): drop bat bones within 1 tile holding the lit candle ->
//      Thrantax; answer "Snarthon Candtrick Termanto" (choice order is random, answered by text) -> 5 (quest_arthur.rs2:150-201).
//  12. Giant crystal (loc 62, L2 2767,3493): use Excalibur -> 6 (quest_arthur.rs2:239-267); King Arthur -> complete
//      (%arthur 7, king_arthur.rs2:48-51, quest_arthur.rs2:273-276).
import type { SpeedBot } from '../../../core.js';
import { cheb, objId } from '../../../core.js';
import { nav, inDialog, locAt, tele, npc, opNpcGo, qp } from '../../q-lib.js';
import { runQuest, talkNpc, chat, heard, fail, checkAlive, dead, opLocUntil, useOnLocUntil, eatIfLow, findLoc, walk, fight, rubGlory, type Item, type RunResult } from './ka-lib.js';
import { wildStash } from '../glory-wild.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: "Merlin's Crystal", dir: 'quest_arthur', qp: 6 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        magic: [45, 'Falador + Camelot teleports (magic 45 = Camelot)'],
        attack: [40, 'Sir Mordred (38 hp, def 33): proven at att/str 83 def 1 hp 40 with a rune scimitar'],
    } as Record<string, [number, string]>,
    start: { x: 2757, z: 3478, level: 0 },   // Camelot teleport landing
    end: { x: 2764, z: 3513, level: 0 },     // King Arthur
};
export const SUPPLY: Item[] = [
    { name: 'bread', n: 1 },            // the beggar (beggar.rs2:24)
    { name: 'bucket_wax', n: 1 },       // candle maker swap (candle_maker.rs2:48) — skips the bee-hive step
    { name: 'bat_bones', n: 1 },        // dropped on the magic symbol (quest_arthur.rs2:150)
    { name: 'tinderbox', n: 1 },        // lights the black candle
    { name: 'lawrune', n: 2 }, { name: 'airrune', n: 8 }, { name: 'waterrune', n: 1 },   // Falador + Camelot teleports
    { name: 'amulet_of_glory_4', n: 1 },   // Draynor (Port Sarim) + Edgeville (chaos altar); any glory with >= 2 charges
    { name: 'rune_scimitar', n: 1 },    // Mordred (wielded by run() if carried)
    { name: 'shark', n: 3 },            // Mordred food
];

const ARTHUR = 251, GAWAIN = 240, LANCELOT = 239, MORDRED = 247, CANDLE = 562, LADY = 250;
const ARTHUR_AT = { x: 2764, z: 3513 }, GAWAIN_AT = { x: 2763, z: 3506 }, LANCELOT_AT = { x: 2759, z: 3515 };
const SYMBOL = { x: 2780, z: 3515 };
/** session 10 resume: the quest JOURNAL (quest_arthur/scripts/arthur_journal.rs2) -> %arthur, first match wins (latest first) */
const AR_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 7], [/speak to\s+King Arthur\s+to\s+claim/i, 6], [/free\s+Merlin\s+by using\s+Excalibur/i, 5],
    [/Morgan Le Faye told me/i, 4], [/delivery by sea/i, 3], [/Gawain\s+think/i, 2], [/ask the\s+other Knights/i, 1],
];
/** Keep Le Faye (L0-L2 around 2769,3400) or the crate room behind it */
const inKeepArea = (b: SpeedBot) => { const t = b.tile(); return t.z > 6400 || (t.x >= 2760 && t.x <= 2790 && t.z >= 3390 && t.z <= 3412); };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    return runQuest(bot, QUEST, async st0 => {
        await nav();
        const st = { ...st0, at: (k: string) => { st0.at(k); failHook(`merlin:${k}`); } };
        // session 10: on a retry, resume at the stage the journal shows (MER_RESUME=0 = always from the top); stage 4's
        // parts by observables: the altar words (journal line), the lit candle / Excalibur (held)
        let ms = 0, altarDone = false;
        if (isResuming(bot) && process.env.MER_RESUME !== '0') {
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            const j = await readJournal(bot, 'arthur');
            const hit = j.ok ? AR_STAGES.find(([re]) => re.test(j.text)) : undefined;
            ms = hit ? hit[1] : 0; altarDone = j.ok && /magic words from the Chaos Altar memorised/i.test(j.text);
            console.log(`[arthur] [journal] arthur: ${j.ok ? `stage ${ms} altar ${altarDone} | open '${j.open.slice(0, 160)}'` : 'UNREADABLE'} (${j.ticks} t) @${JSON.stringify(bot.pos())}`);
            if (ms >= 7) return;
        }
        const R = ms > 0;
        if (bot.free() < 3) fail(bot, `need 3 free slots (candle, Excalibur), have ${bot.free()}`);
        if (bot.count('rune_scimitar') > 0) { bot.opHeld2(objId('rune_scimitar'), bot.slot('rune_scimitar')); bot.queueFlush(); }
        let t = bot.tickCount;
        // 1-2. Arthur, Gawain (Camelot L0)
        if (ms <= 0) {
        if (!(await talkNpc(bot, ARTHUR, ARTHUR_AT, [/^I want to become a Knight/], () => heard(bot, /Talk to my knights if you need any help/, t), { label: 'arthur1' }))) fail(bot, 'Arthur start');
        st.at('arthur');
        }
        if (ms <= 1) {
        t = bot.tickCount;
        if (!(await talkNpc(bot, GAWAIN, GAWAIN_AT, [/^Do you know how Merlin got trapped/, /^Thank you for the information/], () => heard(bot, /least I can do/, t), { label: 'gawain' }))) fail(bot, 'Gawain');
        st.at('gawain');
        }
        if (ms <= 2) {
        // 3. Lancelot (L1 via the wooden stairs 2750,3510)
        const stairs0 = locAt(1725, 2750, 3510, 0), stairs1 = locAt(1726, 2750, 3511, 1);
        if (!(await opLocUntil(bot, stairs0, 1, () => bot.minusedlevel === 1, { maxTicks: 60 }))) fail(bot, 'Camelot stairs up');
        t = bot.tickCount;
        if (!(await talkNpc(bot, LANCELOT, LANCELOT_AT, [/^Any ideas on how to get into Morgan/], () => heard(bot, /deliveries by boat from Catherby/, t), { label: 'lancelot' }))) fail(bot, 'Lancelot');
        st.at('lancelot');
        if (!(await opLocUntil(bot, stairs1, 1, () => bot.minusedlevel === 0, { maxTicks: 40 }))) fail(bot, 'Camelot stairs down');
        }
        if (ms <= 3) {
        // 4. Arhein's crate -> Keep Le Faye
        const crate = locAt(63, 2801, 3442, 0);
        const inKeep = () => bot.minusedlevel === 0 && cheb(bot.tile(), { x: 2778, z: 3401 }) <= 2;
        if (process.env.MER_CRATE_ROUNDS === '0') {
        if (!(await opLocUntil(bot, crate, 2, () => inDialog(bot), { maxTicks: 200, every: 8 }))) fail(bot, 'crate');
        if (!(await chat(bot, [/^Yes\.?$/], () => inKeep() && !inDialog(bot), { label: 'crate', maxTicks: 60 }))) fail(bot, 'crate ride');
        } else {
        // fix 302 (CONFIRMED qx55m: ws 1006 drop 'connection lost ... at (2778,9839)' = the crate hold, mid-ride; the ride's
        // mesbox script (quest_arthur.rs2:2-35) died with the session, the bot was re-attached in the hold, chat() saw no
        // dialog -> 'crate ride', the route retry teleported out and walked back to Catherby): the forward ride in rounds
        // like the return ride. Stranded in the hold (z > 6400) -> the wall's Climb-out (loc 65, :1,68-77) puts us at
        // %arhein_crate_coord: Catherby if the ride broke (set at :12, keep only at :33) -> crate again; keep -> done.
        // Climb-out unanswered (sim qza10) -> Camelot teleport, walk to the crate again (6 rounds). MER_CRATE_ROUNDS=0 reverts. TEST MER_CRATE_TEST=1: close the ride's dialog once in the hold (kills its script).
        let tested = process.env.MER_CRATE_TEST !== '1';
        for (let k = 0; k < 6 && !(inKeep() && !inDialog(bot)); k++) {
            if (k > 0) console.log(`[arthur] crate ride: round ${k + 1} from ${JSON.stringify(bot.pos())} (fix 302)`);
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            if (bot.tile().z > 6400) {
                const wall = bot.nearestLoc(/^crate wall$/i, { radius: 4 });
                // the Climb-out op went unanswered in the hold after a broken ride (qza10: 5 x 'dialog false', wall 65@2777,9838
                // found); a Camelot teleport works there (the route retry in qx55m and qza08 did exactly that) -> crate again
                const okW = wall ? await opLocUntil(bot, wall, 1, () => inDialog(bot), { maxTicks: 8 }) : false;
                if (!okW) {
                    const tp = await tele(bot, 'camelot_teleport');
                    console.log(`[arthur] crate hold: climb-out ${wall ? 'unanswered' : 'wall not in view'} -> camelot teleport ${tp.ok ? 'ok' : 'FAILED'} (${tp.ticks} t)`);
                    continue;
                }
            } else if (!(await opLocUntil(bot, crate, 2, () => inDialog(bot), { maxTicks: 200, every: 8 }))) continue;
            const fromHold = bot.tile().z > 6400;
            // a climb-out lands at Catherby (broken ride) or the keep; a ride ends in the keep
            await chat(bot, [/^Yes\.?$/], () => (inKeep() && !inDialog(bot)) || (!tested && bot.tile().z > 6400) || (fromHold && bot.tile().z < 6400 && !inDialog(bot)), { label: 'crate', maxTicks: 60 });
            if (!tested && bot.tile().z > 6400) {
                tested = true; await bot.tick(2); bot.closeModal(); bot.queueFlush(); await bot.tick(2);
                console.log(`[arthur] MER_CRATE_TEST: closed the ride's dialog in the hold at ${JSON.stringify(bot.pos())}`);
            }
        }
        if (!inKeep()) fail(bot, 'crate ride');
        }
        st.at('keep');
        // 5. stairs to L2, Mordred. Every npc melee swing at us (hit or miss) queues a STRONG script
        //    (npc_combat_melee.rs2:48 queue*(playerhit_n_retaliate)), and a strong queue closes any open modal
        //    (engine Player.ts processQueues): the renegade knights (huntrange 1) can kill the Morgan and crate dialogs
        //    at any page. Both steps therefore loop until their effect is observed.
        const kst0 = locAt(1722, 2769, 3404, 0), kst1 = locAt(1722, 2769, 3398, 1);
        if (!(await opLocUntil(bot, kst0, 1, () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail(bot, 'keep stairs 1');
        if (!(await opLocUntil(bot, kst1, 1, () => bot.minusedlevel === 2, { maxTicks: 40 }))) fail(bot, 'keep stairs 2');
        st.at('keep-L2');
        t = bot.tickCount;
        // %arthur = 4 is set just before her last choice (sir_mordred.rs2:90-94): that choice page is the proof
        const morganDone = () => (heard(bot, /Morgan Le Faye vanishes/, t) && !inDialog(bot)) || bot.dialogOptions().some(x => /^OK I will go do all that/i.test(x.text));
        for (let k = 0; k < 4 && !morganDone(); k++) {
            // aggressive style (2432 = combat_hacksword 'aggressive', capability-tables.ts) for the max hit; at 0 hp
            // his ai_queue3 heals him and opens Morgan's dialog (sir_mordred.rs2:6-12,18-22)
            if (!inDialog(bot) && !(await fight(bot, MORDRED, () => inDialog(bot), { maxTicks: 300, style: k === 0 ? 2432 : undefined, label: 'mordred' }))) fail(bot, 'Mordred fight');
            if (k === 0) st.at('mordred-down');
            await chat(bot, [/^Tell me how to untrap Merlin/], morganDone, { label: 'morgan', maxTicks: 40 });
            if (!morganDone()) console.log(`[arthur] Morgan's dialog broke (knight swing?): Mordred again (${k + 1})`);
        }
        if (!morganDone()) fail(bot, 'Morgan');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        st.at('morgan');
        }
        if (ms <= 3 || inKeepArea(bot)) {
        // 6. down to L0 (L2 -> L1 -> L0), the return crate -> Catherby. m43_53.jm2 lists the crate (loc 64) on L1
        //    (2779,3401) but that tile carries the bridge flag (f2), so in game it stands on L0 next to the arrival tile;
        //    loc-scene keeps it on L1, so the scene loc is re-levelled here.
        const kst2 = locAt(1723, 2769, 3399, 2), kst3 = locAt(1723, 2769, 3405, 1);
        if (!(await opLocUntil(bot, kst2, 1, () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail(bot, 'keep stairs down 1');
        if (!(await opLocUntil(bot, kst3, 1, () => bot.minusedlevel === 0, { maxTicks: 40 }))) fail(bot, 'keep stairs down 2');
        const crate2 = { ...findLoc(64, 2779, 3401, 1), level: 0 } as ReturnType<typeof findLoc>;
        const inCatherby = () => bot.minusedlevel === 0 && cheb(bot.tile(), { x: 2802, z: 3441 }) <= 2;
        // a knight's swing closes the crate dialog before the ride (probe-keepexit.ts: 3/10, we stay at (2778,3401)), so
        // retry. Inside the crate room (z > 6400) a broken ride is
        // left by the wall's Climb-out (loc 65 merlincrate_wall op1, quest_arthur.rs2:1,68-77).
        // route runner: 4 tries all lost to knight swings (partner sim qre5p): 12
        for (let k = 0; k < 12 && !(inCatherby() && !inDialog(bot)); k++) {
            if (k > 0) console.log(`[arthur] crate ride back: retry ${k} from ${JSON.stringify(bot.pos())}`);
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            if (bot.tile().z > 6400) {
                const wall = bot.nearestLoc(/^crate wall$/i, { radius: 4 });
                if (wall && !(await opLocUntil(bot, wall, 1, () => inDialog(bot), { maxTicks: 20 }))) continue;
            } else if (!(await opLocUntil(bot, crate2, 2, () => inDialog(bot), { maxTicks: 60, every: 8 }))) continue;
            eatIfLow(bot);
            await chat(bot, [/^Yes\.?$/], () => inCatherby() && !inDialog(bot), { label: 'crate2', maxTicks: 60 });
        }
        if (!inCatherby()) fail(bot, 'crate ride back');
        st.at('catherby');
        }
        if (ms <= 4 && bot.count('lit_black_candle') === 0) {
        // 7. candle maker x2, light the candle (resume: the candle maker's bit is not in the journal; a talk that hands
        //    over the candle at once also ends talk 1)
        t = bot.tickCount;
        if (!R || bot.count('unlit_black_candle') === 0) {
        if (!(await talkNpc(bot, CANDLE, { x: 2800, z: 3439 }, [/^Have you got any black candles/], () => heard(bot, /bucket FULL of wax/, t) || (R && bot.count('unlit_black_candle') > 0), { label: 'candle1' }))) fail(bot, 'candle maker 1');
        if (!(await talkNpc(bot, CANDLE, { x: 2800, z: 3439 }, [], () => bot.count('unlit_black_candle') > 0, { label: 'candle2' }))) fail(bot, 'candle maker 2');
        }
        for (let k = 0; k < 3 && bot.count('lit_black_candle') === 0; k++) {
            if (inDialog(bot)) { bot.closeModal(); }
            bot.useItemOnItem(objId('tinderbox'), bot.slot('tinderbox'), objId('unlit_black_candle'), bot.slot('unlit_black_candle')); bot.queueFlush();
            await bot.until(() => bot.count('lit_black_candle') > 0, 3);
        }
        if (bot.count('lit_black_candle') === 0) fail(bot, 'candle not lit');
        st.at('candle');
        }
        if (ms <= 4 && bot.count('excalibur') === 0) {
        // 8. Falador teleport -> Lady of the Lake
        if (!(await tele(bot, 'falador_teleport')).ok) fail(bot, 'falador teleport');
        t = bot.tickCount;
        if (!(await talkNpc(bot, LADY, { x: 2924, z: 3405 }, [/^I seek the sword Excalibur/], () => heard(bot, /upstairs room of the jeweller's shop/, t), { label: 'lady' }))) fail(bot, 'Lady of the Lake');
        st.at('lady');
        // 9. glory -> Draynor Village (109 tiles to the jeweller vs 158 from the Falador teleport) -> Port Sarim
        //    jeweller's door -> beggar -> Excalibur
        if (!(await rubGlory(bot, /^Draynor Village/))) fail(bot, 'glory Draynor');
        const jdoor = locAt(59, 3016, 3246, 0);
        if (!(await opLocUntil(bot, jdoor, 1, () => inDialog(bot) || bot.count('excalibur') > 0, { maxTicks: 260, every: 10 }))) fail(bot, 'jeweller door');
        if (!(await chat(bot, [/^Yes,? certainly/], () => bot.count('excalibur') > 0, { label: 'beggar', maxTicks: 30 }))) fail(bot, 'beggar');
        st.at('excalibur');
        }
        if (ms <= 3 || (ms === 4 && !altarDone)) {
        // 10. glory -> Edgeville (205 tiles to the altar vs 257 from the Varrock teleport) -> chaos altar (wilderness 12)
        if (!(await rubGlory(bot, /^Edgeville/))) fail(bot, 'glory Edgeville');
        await wildStash(bot, 'merlin chaos altar');   // SR_GLORY_WILD=0: no glory into wilderness 12 (Camelot tele out)
        const altar = locAt(61, 3239, 3608, 0);
        t = bot.tickCount;
        if (!(await opLocUntil(bot, altar, 2, () => heard(bot, /Snarthon Candtrick Termanto/, t), { maxTicks: 260, every: 10 }))) fail(bot, 'chaos altar');
        st.at('altar');
        }
        if (ms <= 4) {
        // 11. Camelot teleport -> magic symbol: drop the bat bones -> Thrantax
        bot.closeModal(); bot.queueFlush();
        if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport');
        if (!(await walk(bot, SYMBOL, null, () => dead(bot), { near: 1, maxTicks: 120 }))) fail(bot, 'magic symbol');
        checkAlive(bot);
        t = bot.tickCount;
        for (let k = 0; k < 4 && !inDialog(bot); k++) {
            const s = bot.slot('bat_bones'); if (s < 0) fail(bot, 'no bat bones');
            bot.dropItem(objId('bat_bones'), s); bot.queueFlush();
            await bot.until(() => inDialog(bot), 6);
        }
        if (!(await chat(bot, [/^Snarthon Candtrick Termanto$/], () => heard(bot, /The deed is done/, t) && !inDialog(bot), { label: 'thrantax', maxTicks: 40 }))) fail(bot, 'Thrantax');
        st.at('bound');
        }
        if (ms <= 5) {
        // 12. crystal (L2 via the ladders 2769,3493 L0 and 2767,3491 L1), then King Arthur
        const lad0 = locAt(1747, 2769, 3493, 0), lad1 = locAt(1747, 2767, 3491, 1);
        if (!(await opLocUntil(bot, lad0, 1, () => bot.minusedlevel === 1, { maxTicks: 60 }))) fail(bot, 'crystal ladder 1');
        if (!(await opLocUntil(bot, lad1, 1, () => bot.minusedlevel === 2, { maxTicks: 30 }))) fail(bot, 'crystal ladder 2');
        const crystal = locAt(62, 2767, 3493, 2);
        t = bot.tickCount;
        if (!(await useOnLocUntil(bot, 'excalibur', crystal, () => heard(bot, /shatters under the force of Excalibur/, t), { maxTicks: 30 }))) fail(bot, 'crystal');
        await chat(bot, [], () => heard(bot, /Now talk to King Arthur/, t) && !inDialog(bot), { label: 'merlin', maxTicks: 20 });
        st.at('merlin-free');
        }
        if (inDialog(bot)) { bot.closeModal(); bot.queueFlush(); }
        const top2 = locAt(1746, 2767, 3491, 2), top1 = locAt(1746, 2769, 3493, 1);
        if (!R || bot.minusedlevel === 2) if (!(await opLocUntil(bot, top2, 1, () => bot.minusedlevel === 1, { maxTicks: 30 }))) fail(bot, 'ladder down 1');
        if (!R || bot.minusedlevel === 1) if (!(await opLocUntil(bot, top1, 1, () => bot.minusedlevel === 0, { maxTicks: 30 }))) fail(bot, 'ladder down 2');
        const qp0 = qp(bot);
        if (!(await talkNpc(bot, ARTHUR, ARTHUR_AT, [], () => qp(bot) >= qp0 + QUEST.qp, { label: 'arthur2', closedTicks: 6 }))) fail(bot, 'Arthur reward');
        st.at('done');
    }, o.log !== false);
}

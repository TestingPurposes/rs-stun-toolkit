/// <reference types="bun" />
// q-tai-bwo-wannai-trio.ts — TAI BWO WANNAI TRIO, cheat-free. Lane south (max-QP route).
//
// Content (rev 289, quests/quest_tbwt/ unless noted). %tbwt_main (varp 320) is TRANSMITTED (quest_tbwt.varp:1-3): 3 =
// started, 4 = all brothers done. Brother completion = Tiadeche 6 + Tamayu 4 + Tinsay 7 + Lubufu 31, checked only inside
// the Tiadeche/Tamayu/Tinsay "complete" labels (quest_tbwt.rs2:35-40; tbwt_tiadeche.rs2:204, tbwt_tamayu.rs2:412,
// tbwt_tinsay.rs2:415), so the LAST of those three must finish after Lubufu.
//  - Timfraku (L1 of his hut, ladder 2782,3087; areas/area_karamja/scripts/tbwt_timfraku.rs2): roving adventurer ->
//    "Trufitus sent me." (needs Jungle Potion) -> gratitude -> Yes = %tbwt_main 3.
//  - Tamayu (2844,3042): talk (-> 2), "When will you succeed?" -> Yes = cutscene (-> 3); only now does he take the agility
//    potion (4 doses, any mix) and a spear: an acceptable spear (not bronze) with karambwan poison (kp) (tbwt_tamayu.rs2:
//    58-132). "Take me on your next hunt" with both = the killing hunt (-> 4, tbwt_tamayu.rs2:202-329). Then he skins a
//    monkey corpse (tbwt_tamayu.rs2:32-57).
//    kp spear: raw karambwan (TRADEABLE: supplied) cooked on a fire is always "poorly" before the final reward
//    (skill_cooking/scripts/cooking.rs2:36-50, 70/255 burn roll), pestle -> poisonous paste, paste on the iron spear
//    (skill_combat/scripts/weapon_poison.rs2:10-13).
//    Monkey corpse: a monkey killed while %tbwt_main 3 drops one; it dodges melee, so magic/ranged (monkey.rs2:97-170).
//  - Tiadeche (2905,3115, in the EAST walk component: only over the stepping stones 2925,2948-2950): talk (-> 2), the
//    LOADED karambwan vessel (tradeable: supplied) -> 3 -> "No" -> request manual 4 (tbwt_tiadeche.rs2:65-164); later the
//    crafting manual from Tinsay -> 6 (complete).
//  - Lubufu (2770,3169): talk (-> 1 + a 10 t "go away" queue, tbwt_lubufu.rs2:148-172), talk again: Talk about him... /
//    How old are you? / I could help collect the bait. / You sound like you could do with the help. -> 5; 20 raw
//    karambwanji (untradeable, small net at the Holy Lake spots, tbwt.rs2 fishing 5) -> 25; three questions (each +1, the
//    third offers the apprenticeship) -> Yes -> 31 (tbwt_lubufu.rs2:174-368).
//  - Tinsay (2765,2976, Cairn Isle: over the climbing rocks 2792-2794,2979, agility 15, quest_zombiequeen.rs2:519-560):
//    intro (-> 2), sliced banana in Karamja rum (-> 3 -> 4), seaweed-in-monkey-skin sandwich (-> 5 -> 6), burnt jogre
//    bones marinated in karambwanji (-> 7) (tbwt_tinsay.rs2). Then the vessel -> crafting manual (Tiadeche at 4/5).
//    Karamja rum is untradeable (quest_hunt.obj) and sold by Zambo (areas/area_karamja/configs/karamja.inv:10).
//    Burnt jogre bones: Superheat Item on jogre bones (skill_magic superheat.rs2:14, tbwt_jogre_bones.rs2:13-23) — no
//    furnace on Karamja. + raw karambwanji paste, cooked on a fire (cooking 30, never fails: cooking_generic.dbrow).
//  - Timfraku at %tbwt_main 4: reward -> quest complete (2 QP).
import { SpeedBot, objId, objDebugName, cheb, spellCom } from '../../../core.js';
import { nav, talk, R, M2, M3, M4, M5, qp, opNpcGo, opLocGo, pickupGo, walkOp, inDialog, dismiss, log as qlog, trace } from '../../q-lib.js';
import {
    fail, dead, locHere, retry, opLocUntil, useOnLocUntil, wear, eatIfLow, talkTo, chatMark, chatSince, groundOf, npc, npcsOf, glory,
    FOODS, textLog, textMark, sawText, type Item, type Tile,
} from './south-lib.js';
import { goK, regionOf } from '../../q-shilo.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Tai Bwo Wannai Trio', dir: 'quest_tbwt', qp: 2 };
export const REQUIREMENTS = {
    quests: ['Jungle Potion'], qp: 0,
    skills: {
        agility: [15, 'Cairn Isle climbing rocks to Tinsay: stat(agility) >= 15 (quest_zombiequeen.rs2:527). Proven at 60: the log bridge rolls stat_random(agility,75,250) once per running crossing (quest_zombiequeen.rs2:561-566; a fall ~40 t), the stepping stones stat_random(agility,50,253) per stone (shortcuts.rs2:245) — see STATUS A/B'],
        cooking: [30, 'cook the karambwanji-marinated jogre bones (cooking_generic.dbrow cooking_generic_burnt_jogre_bones_in_raw_karambwanji_paste levelrequired 30)'],
        fishing: [5, 'small-net karambwanji (skill_fishing tbwt.rs2 attempt_fish_karambwanji)'],
        magic: [43, 'Superheat Item on the jogre bones (no furnace on Karamja); Fire Strike (13) for the monkey'],
    } as Record<string, [number, string]>,
    start: { x: 2782, z: 3086, level: 0 },     // at Timfraku's ladder, Tai Bwo Wannai
    end: { x: 2782, z: 3087, level: 1 },
};
/** Tradeable inputs. Four raw karambwan: the "poorly cooked" roll is stat_random(cooking, 70, 255) on a fire
 *  (cooking_generic.dbrow:562-566), ~67% at cooking 55, so two burnt both in sotb7 (all 4 burn ~1%). The vessels are quest items but tradeable
 *  (the loaded one saves a karambwanji and lets Tiadeche come first). */
// session 11 fix 407a (qx505m 'no monkey corpse' x2 -> ROUTE STOPPED qp 102): 6 mind runes = 6 Fire Strikes; all 6 landed on
// one monkey (slot 2001, magic xp +1888) with no kill, then 34 + 39 casts were REFUSED. ~550 sim hunts: 2-4 casts usual, up to
// ~7.2 casts' worth of xp. 9 casts: mind 9, fire 4 (superheat) + 27, air 18. TBWT_MINDR=6 reverts (fire 22 / air 12 / mind 6).
const TBWT_MINDR = Number(process.env.TBWT_MINDR ?? 9);
export const SUPPLY: Item[] = [
    // session 9 (allchaos qu03m: all 4 burnt at the main's cooking ~30, P ~7%/run; the retry had none left): 8 (all burn ~0.5%)
    { name: 'tbwt_raw_karambwan', n: Number(process.env.TBWT_RAWK ?? 8) }, { name: 'pestle_and_mortar', n: 1 }, { name: 'iron_spear', n: 1 }, { name: '4dose1agility', n: 1 },
    { name: 'net', n: 1 }, { name: 'tbwt_jogre_bones', n: 1 }, { name: 'seaweed', n: 1 }, { name: 'tbwt_sliced_banana', n: 1 },
    { name: 'tbwt_karambwan_vessel_loaded_with_karambwanji', n: 1 },
    { name: 'firerune', n: 4 + 3 * TBWT_MINDR }, { name: 'naturerune', n: 1 }, { name: 'airrune', n: 2 * TBWT_MINDR }, { name: 'mindrune', n: TBWT_MINDR },
    { name: 'coins', n: 100 }, { name: 'amulet_of_glory_4', n: 1 },
];

const O = {
    rawK: objId('tbwt_raw_karambwan'), poorK: objId('tbwt_poorly_cooked_karambwan'), burntK: objId('tbwt_burnt_karambwan'),
    pPaste: objId('tbwt_poisonous_karambwan_paste'), pestle: objId('pestle_and_mortar'), spear: objId('iron_spear'), kpSpear: objId('tbwt_iron_spear_kp'),
    agility: objId('4dose1agility'), net: objId('net'), jogre: objId('tbwt_jogre_bones'), burntJogre: objId('tbwt_burnt_jogre_bones'),
    jogrePaste: objId('tbwt_burnt_jogre_bones_in_raw_karambwanji_paste'), marinade: objId('tbwt_burnt_jogre_bones_marinated_in_karambwanji'),
    kji: objId('tbwt_raw_karambwanji'), kjiPaste: objId('tbwt_raw_karambwanji_paste'), shrimp: objId('raw_shrimp'),
    corpse: objId('tbwt_monkey_corpse'), skin: objId('tbwt_monkey_skin'), seaweed: objId('seaweed'), sandwich: objId('tbwt_seaweed_in_monkey_skin_sandwich'),
    monkeyBones: objId('mm_normal_monkey_bones'), banana: objId('tbwt_sliced_banana'), rum: objId('karamja_rum'), bananaRum: objId('tbwt_sliced_banana_in_karamja_rum'),
    loaded: objId('tbwt_karambwan_vessel_loaded_with_karambwanji'), vessel: objId('tbwt_karambwan_vessel'), manual: objId('tbwt_crafting_manual'),
    coins: objId('coins'),
};
const NPC = { timfraku: 1162, tiadeche: 1163, tinsay: 1165, tamayu: 1167, lubufu: 1171, zambo: 568, monkey: 132, kjiSpot: 1174 };
const MAIN_VARP = 320;   // %tbwt_main (transmit=yes)
const T = {
    ladder: { x: 2782, z: 3086 }, fire: { x: 2789, z: 3047 }, monkeys: { x: 2833, z: 3030 }, tamayu: { x: 2844, z: 3042 },
    spots: { x: 2797, z: 3012 }, tiadeche: { x: 2905, z: 3115 }, zambo: { x: 2924, z: 3143 }, lubufu: { x: 2770, z: 3170 },
    tinsay: { x: 2765, z: 2977 },
};
const CAIRN_ROCKS_W = { x: 2791, z: 2979 };   // west (Cairn) stand of the climbing rocks (q-shilo T.cairnWest)

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    const t0 = bot.tickCount, qp0 = qp(bot);
    bot.holdDialogs = true;
    trace(bot, t0);
    const L = (s: string) => { if (o.log !== false) qlog(bot, t0, `${s} | hp ${bot.stat('hitpoints').cur} main ${bot.getVarp(MAIN_VARP)} free ${bot.free()}`); failHook(s.split(/[,(]/)[0]!.trim()); };
    // every text since the run began (pages overwrite each other's components in bot.ifText: south-lib textLog)
    textLog(bot);
    let stepMark = 0;
    const step = () => { stepMark = textMark(bot); };
    const seen = (re: RegExp) => sawText(bot, re, stepMark);
    const main = () => bot.getVarp(MAIN_VARP);
    const useOn = (target: number, used: number) => () => { const a = bot.slot(target), b = bot.slot(used); if (a >= 0 && b >= 0) bot.useItemOnItem(target, a, used, b); };
    const useOnNpc = (type: number, obj: number) => () => { const n = npc(bot, type); if (!n || inDialog(bot)) return; opNpcGo(bot, n, 1); bot.useItemOnNpc(n.idx, obj, bot.slot(obj)); };
    /** use `obj` on the npc (walking there first), then drive the dialog until `done` */
    const giveTo = async (type: number, obj: number, at: Tile, done: () => boolean, answers: RegExp[], label: string, maxTicks = 80) => {
        const n0 = npc(bot, type);
        if (!n0 || n0.d > 12) await goK(bot, at, 3, label);
        for (let k = 0; k < 4 && !done(); k++) {
            if (!inDialog(bot)) {
                if (bot.count(obj) === 0) break;
                await retry(bot, useOnNpc(type, obj), () => inDialog(bot) || done(), 30, 6);
            }
            await talk(bot, type, [], { noOp: true, done, answers, maxTicks, label });
        }
        if (!done()) fail(bot, `${label}: not done`);
        dismiss(bot);
    };
    // hp watcher (diagnostic): who hurts us on the way (stones, bridge, rocks, npcs)
    if (process.env.TBWT_HPLOG) (async () => { let hp = bot.stat('hitpoints').cur; while (!bot.disposed) { const h = bot.stat('hitpoints').cur;
        if (h < hp) L(`HP -${hp - h} at ${JSON.stringify(bot.tile())} near ${npcsOf(bot, [...Array(4000).keys()]).filter(q => q.d <= 2).map(q => bot.npcName(q.type)).join(',') || '-'}`);
        hp = h; await bot.tick(1); } })();
    // session 10: on a retry / resume, each brother's progress from the quest JOURNAL (tbwt_journal.rs2; the brothers' varps are
    // not transmitted) and the steps already done are skipped. Every flag is false on a fresh attempt. TBWT_RESUME=0 reverts.
    const J = { tamIntro: false, tamWatched: false, potion: false, spear: false, tamDone: false, tinIntro: false, rum: false, sandwich: false, bones: false,
        tiaIntro: false, tiaReq: false, tiaGot: false, lubHelp: false, lubGiven: false, lubAppr: false, lubDone: false };
    if (isResuming(bot) && process.env.TBWT_RESUME !== '0' && main() >= 3) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const j = await readJournal(bot, 'tbwt');
        if (j.ok) {
            const t = j.text, r = (re: RegExp) => re.test(t), struckLine = (name: string) => j.lines.some((x, i) => x === name && j.struck[i]);
            J.tamIntro = struckLine('Tamayu'); J.tinIntro = struckLine('Tinsay'); J.tiaIntro = struckLine('Tiadeche');
            J.tamDone = r(/Tamayu has slain the Shaikahan/i); J.potion = J.tamDone || r(/increased his agility/i); J.spear = J.tamDone || r(/stronger and Karambwan poisoned spear/i);
            J.tamWatched = J.tamDone || r(/slain\s+Shaikahan/i);
            J.rum = r(/given him sliced banana/i); J.sandwich = r(/given him a seaweed in monkey skin sandwich/i); J.bones = r(/given him a burnt Jogre bones/i);
            J.tiaGot = r(/retrieved crafting instructions for Tiadeche/i); J.tiaReq = J.tiaGot || r(/take a Karambwan vessel to Tinsay/i);
            J.lubDone = r(/accepted Lubufu's offer/i); J.lubAppr = J.lubDone || r(/offered to train me as his apprentice/i);
            J.lubGiven = J.lubAppr || r(/given Lubufu 20 Karambwanji/i); J.lubHelp = J.lubGiven || r(/offered to help collect bait/i);
        }
        L(`[journal] tbwt: ${j.ok ? (Object.keys(J).filter(k => (J as Record<string, boolean>)[k]).join(',') || 'nothing done') : 'UNREADABLE'} (${j.ticks} t)`);
    }
    try {
        if (main() < 3 && main() !== 0 && main() !== 1 && main() !== 2) fail(bot, `unexpected %tbwt_main ${main()}`);
        // ---- 0. pack: keep the supply; everything else goes (the karambwanji need 20 free slots later)
        const keep = new Set([...SUPPLY.map(i => objId(i.name)), O.poorK, O.pPaste, O.kpSpear, O.burntJogre, O.jogrePaste, O.marinade, O.kji, O.kjiPaste,
            O.corpse, O.skin, O.sandwich, O.rum, O.bananaRum, O.manual, O.vessel /* Lubufu's (resume: Tinsay wants it) */, ...['amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3'].map(n => objId(n))]);
        const junk = [...new Set(bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj))];
        if (junk.length) { L(`dropping ${junk.map(objDebugName).join(',')}`); await bot.dropAll(junk); }

        // ---- 1. Timfraku: start (%tbwt_main 3)
        await timfraku(bot, () => main() >= 3, [/I am a roving adventurer/i, /Trufitus sent me/i, /Your gratitude is all/i, /^Yes$/i], 'timfraku start');
        L('started');
        // ---- 2. village fire: poorly cooked karambwan -> poisonous paste -> kp spear; superheat the jogre bones
        const fire = locHere(2732, 2789, 3048, 0);
        const needSpear = !J.spear, needJogre = !J.bones && bot.count(O.burntJogre) === 0 && bot.count(O.jogrePaste) === 0 && bot.count(O.marinade) === 0;
        if (needSpear || needJogre) await goK(bot, T.fire, 2, 'fire');
        if (needSpear) {
        for (let k = 0; k < 10 && bot.count(O.poorK) === 0 && bot.count(O.kpSpear) === 0 && bot.count(O.pPaste) === 0; k++) {
            if (bot.count(O.rawK) === 0) fail(bot, 'no raw karambwan left (all burnt)');
            const r0 = bot.count(O.rawK);
            await useOnLocUntil(bot, O.rawK, fire, () => bot.count(O.rawK) < r0, 20, 6);
            await bot.until(() => bot.count(O.poorK) > 0 || bot.count(O.burntK) > 0, 6);
            dismiss(bot);
        }
        if (bot.count(O.poorK) === 0 && bot.count(O.pPaste) === 0 && bot.count(O.kpSpear) === 0) fail(bot, 'poorly cooked karambwan');
        // the spare raw / burnt karambwan would take the karambwanji slots later (pack full at N karambwanji)
        { const spare = [O.rawK, O.burntK].filter(o => bot.count(o) > 0); if (spare.length) await bot.dropAll(spare); }
        if (bot.count(O.kpSpear) === 0) {
            if (bot.count(O.pPaste) === 0 && !(await retry(bot, useOn(O.poorK, O.pestle), () => bot.count(O.pPaste) > 0, 8, 2))) fail(bot, 'grind poisonous paste');
            if (!(await retry(bot, useOn(O.pPaste, O.spear), () => bot.count(O.kpSpear) > 0, 8, 2))) fail(bot, 'kp spear');
        }
        }
        if (needJogre) {
            const r = await bot.castOnItem('superheat_item', O.jogre, { maxTicks: 6 });
            if (!r.ok) await retry(bot, () => { const s = bot.slot(O.jogre); if (s >= 0) bot.opHeldT(O.jogre, s, spellCom('superheat_item')); }, () => bot.count(O.burntJogre) > 0, 10, 4);
            if (bot.count(O.burntJogre) === 0) fail(bot, 'superheat jogre bones (magic 43 + 4 fire + 1 nature)');
        }
        L('kp spear + burnt jogre bones');
        // ---- 3. monkey corpse (Fire Strike) + Tamayu (2 hunts) + skin -> sandwich
        if (!J.sandwich) await monkeyCorpse(bot, L);
        if (!(J.tamDone && (J.sandwich || bot.count(O.skin) > 0 || bot.count(O.sandwich) > 0))) await tamayu(bot, L);
        if (!J.sandwich && bot.count(O.sandwich) === 0 && !(await retry(bot, useOn(O.skin, O.seaweed), () => bot.count(O.sandwich) > 0, 8, 2))) fail(bot, 'seaweed sandwich');
        L('Tamayu complete, sandwich made');
        // ---- 4. Holy Lake: 1 karambwanji -> raw paste on the burnt bones, then 20 more for Lubufu
        if (!(J.lubGiven && (J.bones || bot.count(O.jogrePaste) > 0 || bot.count(O.marinade) > 0))) await fishKarambwanji(bot, L, J.lubGiven);
        // ---- 5. Tiadeche (east, over the stepping stones): intro + loaded vessel -> request manual
        if (!J.tiaReq) await tiadeche1(bot, L, J.tiaIntro);
        // ---- 6. glory -> Karamja, Zambo: Karamja rum + sliced banana
        if (!J.rum && bot.count(O.bananaRum) === 0) {
        if (!(await glory(bot, 2))) fail(bot, 'glory -> Karamja');
        await zambo(bot, L);
        }
        // ---- 7. Lubufu: apprentice (20 karambwanji)
        if (!J.lubDone) await lubufu(bot, L, J);
        // ---- 8. village fire: marinate the burnt bones
        if (!J.bones && bot.count(O.marinade) === 0) {
        await goK(bot, T.fire, 2, 'fire 2');
        if (!(await useOnLocUntil(bot, O.jogrePaste, fire, () => bot.count(O.marinade) > 0, 20, 6))) fail(bot, 'marinate the jogre bones (cooking 30)');
        dismiss(bot);
        L('marinated bones');
        }
        // ---- 9. Tinsay: intro, rum, sandwich, bones (complete), vessel -> manual
        if (!(J.tiaGot && J.bones)) await tinsay(bot, L, J);
        // ---- 10. Tiadeche: manual -> complete (last brother: %tbwt_main 4)
        if (main() < 4) await goEast(bot, T.tiadeche, 3, 'tiadeche manual');
        if (main() < 4) { step(); await giveTo(NPC.tiadeche, O.manual, T.tiadeche, () => main() >= 4 || (bot.count(O.manual) === 0 && seen(/meet you in the village once you have helped/i) && !inDialog(bot)), [], 'tiadeche manual'); }
        if (main() < 4) fail(bot, `all brothers done but %tbwt_main ${main()} (Lubufu?)`);
        L('all brothers');
        // ---- 11. glory -> Karamja, walk to Timfraku: reward
        if (!(await glory(bot, 2))) fail(bot, 'glory -> Karamja (2)');
        await timfraku(bot, () => qp(bot) >= qp0 + QUEST.qp, [/Oh it was nothing really/i], 'timfraku reward');
        L('QUEST COMPLETE');
        return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message };
    }

    // ------------------------------------------------------------------------------------------------------------------------
    async function timfraku(b: SpeedBot, done: () => boolean, answers: RegExp[], label: string): Promise<void> {
        if (done()) return;
        if (b.minusedlevel !== 1) {
            await goK(b, T.ladder, 1, label);
            const ladder = locHere(1747, 2782, 3087, 0);
            if (!(await opLocUntil(b, ladder, 1, () => b.minusedlevel === 1, 30, 6))) fail(b, `${label}: ladder up`);
        }
        step(); await talkTo(b, NPC.timfraku, [], { done, answers, maxTicks: 60, label, tries: 4 });
        if (!(await b.until(done, 10))) fail(b, `${label}: not done (%tbwt_main ${main()})`);
        dismiss(b);
        if (qp(b) < qp0 + QUEST.qp) {   // back down (laddertop 1746, L1)
            const top = locHere(1746, 2782, 3087, 1);
            if (!(await opLocUntil(b, top, 1, () => b.minusedlevel === 0, 30, 6))) fail(b, `${label}: ladder down`);
        }
    }
    /** To a tile north of the Karamja stepping stones (Tiadeche's side). Lane-local crossing: q-shilo crossStones re-walks to
     *  the south stand after a fall (a northward fall washes you up ON the north bank at (2931,2953), shortcuts.rs2:245-262)
     *  and burned ~66 t there (sotb6 t+546..612). Here any tile at z >= 2951 near the stones counts as across. */
    async function goEast(b: SpeedBot, t: Tile, near: number, label: string): Promise<void> {
        if (regionOf(b.tile()) === 'cairn') await goCairn(b, CAIRN_ROCKS_W, 0, `${label} (off cairn)`);
        const across = () => { const m = b.tile(); return m.z >= 2951 && m.z <= 2960 && m.x >= 2918 && m.x <= 2936; };
        const nearT = () => cheb(b.tile(), t) <= 40 && b.tile().z > 2960;
        // session 11 fix 262 (TBWT_STONES_ACROSS): qx03m 'tiadeche manual (stones again): cannot reach (2925,2947)'. A walk
        // to the south stand can route over the stones by itself and end ON THE NORTH BANK (a fall washes you up at (2931,2953);
        // q-shilo crossStones has the same note), i.e. across() already; goK's go() then kept walking to the south stand, which
        // has no route from the north bank (the stones need ops), and threw after 3 tries. Now a stand walk that leaves us across
        // counts as crossed, and from the main side the stand walk is one bounded walkTo (re-read the region after it).
        // TBWT_STONES_ACROSS=0 = goK as before.
        let testAcrossDone = false;
        const toStand = async (lbl: string): Promise<void> => {
            if (process.env.TBWT_STONES_ACROSS === '0') return goK(b, { x: 2925, z: 2947 }, 0, lbl);
            // TEST (TBWT_TEST_ACROSS=1): the first stand walk from the main side ends on the north bank (what qx03m's walk did)
            if (process.env.TBWT_TEST_ACROSS === '1' && !testAcrossDone && regionOf(b.tile()) === 'main') { testAcrossDone = true; await goK(b, { x: 2931, z: 2953 }, 0, `${lbl} TEST to the north bank`); L(`${lbl}: TEST stand walk ended at ${b.tile().x},${b.tile().z} across ${across()}`); return; }
            if (regionOf(b.tile()) === 'main') { dismiss(b); await b.walkTo(2925, 2947, { near: 0, maxTicks: 1500, log: false }); if (across()) L(`${lbl}: the stand walk ended across at ${b.tile().x},${b.tile().z}`); return; }
            try { await goK(b, { x: 2925, z: 2947 }, 0, lbl); }
            catch (e) { if (!across()) throw e; L(`${lbl}: goK threw but we are across at ${b.tile().x},${b.tile().z}: going on`); }
        };
        if (!across() && !nearT()) {
            await toStand(`${label} (stones)`);
            const stones = [{ id: 2335, z: 2948 }, { id: 2334, z: 2949 }, { id: 2333, z: 2950 }];
            for (let k = 0; k < 16 && !across(); k++) {
                const me = b.tile();
                if (me.x !== 2925 || me.z < 2947 || me.z > 2950) { await toStand(`${label} (stones again)`); continue; }
                const st = stones.find(q => q.z === me.z + 1);
                if (!st) { await walkOp(b, { x: 2925, z: 2951 }, null, across, { maxTicks: 8 }); continue; }
                b.opLoc(2925, st.z, st.id, 1); b.queueFlush();
                await b.until(() => across() || (b.tile().x === 2925 && b.tile().z > me.z), 15);
                await b.tick(1);
            }
            if (!across()) fail(b, `${label}: stepping stones not crossed`);
        }
        if (!(await walkOp(b, t, null, () => cheb(b.tile(), t) <= near, { near, maxTicks: 400 }))) fail(b, `${label}: walk east to (${t.x},${t.z})`);
    }
    /** Walk on Cairn Isle (climbing the rocks first if needed). The log bridge (zone 0_43_46_24_32) rolls agility every 3 t
     *  (quest_zombiequeen.rs2:561-600, stat_random(agility, 75, 250)); a fall p_stopaction's the walk and washes you onto the
     *  main shore, and q-shilo goK's 300 t walkOp sat out the rest (sotb8: 135 t lost). Here "You fall!" ends the walk at
     *  once and the loop re-plans (climb the rocks again). */
    async function goCairn(b: SpeedBot, t: Tile, near: number, label: string): Promise<void> {
        for (let k = 0; k < 6; k++) {
            if (regionOf(b.tile()) !== 'cairn') await goK(b, CAIRN_ROCKS_W, 0, `${label} (rocks)`);
            const mk = chatMark(b);
            const fell = () => chatSince(b, mk, /You fall!/i);
            await walkOp(b, t, null, () => cheb(b.tile(), t) <= near || fell(), { near, maxTicks: 150 });
            if (cheb(b.tile(), t) <= near) return;
            if (fell()) { L(`${label}: fell off the log bridge`); await b.until(() => chatSince(b, mk, /drag your pitiful frame/i), 25); await b.tick(1); }
        }
        fail(b, `${label}: Cairn walk to (${t.x},${t.z})`);
    }
    async function monkeyCorpse(b: SpeedBot, L: (s: string) => void): Promise<void> {
        if (b.count(O.corpse) > 0 || b.count(O.skin) > 0 || b.count(O.sandwich) > 0) return;
        await goK(b, T.monkeys, 4, 'monkeys');
        if (process.env.TB_TEST_TREE === '1') await goK(b, { x: 2831, z: 3035 }, 0, 'TEST tree-shadow stand');   // fix 343 TEST
        const t1 = b.tickCount;
        // lock ONE target (npcsOf re-sorts by distance every tick: switching targets spread 3 casts over 3 monkeys, sotb1)
        let last = -100, target = -1, casts = 0, xp0 = b.stat('magic').xp;
        let lastSeen: { x: number; z: number } | null = null;
        // session 11 fix 343 (TB_MONKEY_SWITCH): qx133m 'no monkey corpse': the locked monkey (2831,3038) stood north of the 2x2
        // jungletree2_karamja (2830-2831,3036-3037; m44_47.jm2 '0 14 28: 1304', blocks walk + range). The engine ACCEPTed every
        // OPNPCT but parked us at (2831,3035) with apcalled false (no LoS, no "I can't reach that"): 40 casts, magic xp +0, 200 t.
        // A Fire Strike that fires always gives xp: 3 casts at one target with no xp = drop it for this hunt and pick another.
        // TB_MONKEY_SWITCH=0 = the old lock-until-it-vanishes.
        const skip = new Set<number>(); let tCasts = 0, tXp = xp0;
        while (b.count(O.corpse) === 0 && b.tickCount - t1 < 200) {
            if (dead(b)) fail(b, 'died at the monkeys');
            eatIfLow(b);
            const g = groundOf(b, O.corpse, 12);
            if (g) { await retry(b, () => pickupGo(b, O.corpse, g), () => b.count(O.corpse) > 0, 12, 3); continue; }
            // session 11 fix 407a: no mind rune = every Fire Strike is REFUSED (qx505m: ~170 t + ~240 t burnt on refused casts).
            // 8 t after the last cast (its hit / the death drop has landed by then): fail now. TBWT_RUNE_FAILFAST=0 reverts.
            if (process.env.TBWT_RUNE_FAILFAST !== '0' && b.count(objId('mindrune')) === 0 && b.tickCount - last >= 8)
                fail(b, `no monkey corpse: out of mind runes after ${casts} casts (magic xp +${b.stat('magic').xp - xp0})`);
            const all = npcsOf(b, NPC.monkey);
            let m = all.find(q => q.idx === target);
            if (!m && target >= 0 && lastSeen) {   // the target vanished: it died, the corpse lands on its tile next tick
                target = -1; await b.tick(2); continue;
            }
            if (!m) { m = all.filter(q => q.d <= 10 && !skip.has(q.idx))[0]; if (m) { target = m.idx; tCasts = 0; tXp = b.stat('magic').xp; } }
            if (!m) { if (skip.size) { skip.clear(); await goK(b, T.monkeys, 1, 'monkeys (re-stand)'); } else await b.tick(2); continue; }
            if (process.env.TB_MONKEY_SWITCH !== '0' && tCasts >= 3 && b.stat('magic').xp === tXp) {
                L(`monkey ${target}: ${tCasts} casts, no xp (no line of sight?): next monkey`);
                skip.add(target); target = -1; lastSeen = null; continue;   // lastSeen=null: not mistaken for a kill above
            }
            lastSeen = { x: m.x, z: m.z };
            // fix 407c (proof406 k407a: casts without runes kept resetting `last`, so 407a's 8 t check never fired): cast only with a mind rune
            if (b.tickCount - last >= 5 && (process.env.TBWT_RUNE_FAILFAST === '0' || b.count(objId('mindrune')) > 0)) { b.opNpcT(m.idx, spellCom('fire_strike')); b.queueFlush(); last = b.tickCount; casts++; tCasts++; }
            await b.tick(1);
        }
        L(`monkey: ${casts} casts, magic xp +${b.stat('magic').xp - xp0}`);
        if (b.count(O.corpse) === 0) fail(b, 'no monkey corpse (Fire Strike: magic 13, 3 fire + 2 air + 1 mind)');
        L(`monkey corpse (${b.tickCount - t1} t)`);
    }
    async function tamayu(b: SpeedBot, L: (s: string) => void): Promise<void> {
        await goK(b, T.tamayu, 4, 'tamayu');
        const away = () => b.tile().z > 4000;
        if (!J.tamDone) {
        if (!J.tamWatched) {
        // talk 1: the vow (-> 2)
        if (!J.tamIntro) { step(); await talkTo(b, NPC.tamayu, [R, R, R, R, R, R, R], { done: () => seen(/pitiful whining tires me|Tell me more of the Shaikahan/i) && !inDialog(b), maxTicks: 30, label: 'tamayu 1', tries: 4 });
        dismiss(b); }
        // talk 2: watch a hunt (cutscene teleport, -> 3); he assesses agility / damage / health
        let wentAway = false;
        step(); await talkTo(b, NPC.tamayu, [], { done: () => { if (away()) wentAway = true; return wentAway && !away() && seen(/(seems to be healing too quickly|seem extremely sick|seem quite sick)/i); },
            answers: [/When will you succeed/i, /^Yes$/i], maxTicks: 90, label: 'tamayu 2', tries: 3 });
        if (!wentAway) fail(b, 'tamayu: no first hunt (cutscene)');
        dismiss(b);
        L('tamayu: watched the hunt');
        }
        // potion + kp spear (only now accepted)
        if (!J.potion) { step(); await giveTo(NPC.tamayu, O.agility, T.tamayu, () => b.count(O.agility) === 0 && seen(/(not sure whether I can match|agile enough to finally match)/i) && !inDialog(b), [], 'tamayu potion', 40); }
        if (!J.spear) { step(); await giveTo(NPC.tamayu, O.kpSpear, T.tamayu, () => b.count(O.kpSpear) === 0 && !inDialog(b), [], 'tamayu spear', 30); }
        // talk 3: the killing hunt (-> 4); the cutscene ends at (2848,3039)
        let away2 = false;
        step(); await talkTo(b, NPC.tamayu, [], { done: () => { if (away()) away2 = true; return away2 && !away(); }, answers: [/Take me on your next hunt/i], maxTicks: 90, label: 'tamayu 3', tries: 3 });
        if (!away2) fail(b, 'tamayu: no killing hunt');
        dismiss(b);
        L('tamayu: Shaikahan slain');
        }
        if (b.count(O.skin) === 0 && b.count(O.sandwich) === 0) { step(); await giveTo(NPC.tamayu, O.corpse, T.tamayu, () => b.count(O.skin) > 0, [], 'tamayu skin', 30); }
    }
    async function fishKarambwanji(b: SpeedBot, L: (s: string) => void, lubGiven = false): Promise<void> {
        await goK(b, T.spots, 3, 'holy lake');
        // 20 unnoted karambwanji need 20 free slots: keep only what the rest of the quest uses
        const keepNow = new Set([O.net, O.pestle, O.kji, O.kjiPaste, O.burntJogre, O.jogrePaste, O.marinade, O.sandwich, O.banana, O.rum, O.bananaRum,
            O.loaded, O.vessel, O.coins, ...['amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'].map(n => objId(n))]);
        const extra = [...new Set(b.inv().filter(sl => !keepNow.has(sl.obj)).map(sl => sl.obj))];
        if (extra.length) { L(`dropping before fishing: ${extra.map(objDebugName).join(',')}`); await b.dropAll(extra); }
        const t1 = b.tickCount;
        const pasted = () => b.count(O.jogrePaste) > 0 || b.count(O.marinade) > 0;
        // 21 catches (20 for Lubufu + 1 paste). Inventory ops interrupt the net action (re-cast = ~5 t): a shrimp is dropped
        // only when the pack has no slack left for the karambwanji still needed.
        const need = () => (lubGiven ? 0 : 20) + (pasted() ? 0 : 1);
        let lastSend = -100, lastCount = 0, lastGain = b.tickCount;
        while (b.count(O.kji) < need()) {
            if (b.tickCount - t1 > 400) fail(b, `karambwanji: ${b.count(O.kji)} after 400 t`);
            if (dead(b)) fail(b, 'died at the lake');
            eatIfLow(b);
            if (b.count(O.shrimp) > 0 && b.free() < need() - b.count(O.kji)) {
                await b.dropAll([O.shrimp]); lastSend = -100;
            }
            // the paste must be made as soon as one is caught: 28 slots hold the 8 kept items + 20 karambwanji only after the
            // paste (+pestle drop) frees two (sotb3 filled the pack at 20 with the paste left for later). One interrupt.
            if (b.count(O.kji) > 0 && !pasted()) {
                if (b.count(O.kjiPaste) === 0) await retry(b, useOn(O.kji, O.pestle), () => b.count(O.kjiPaste) > 0, 8, 2);
                await retry(b, useOn(O.kjiPaste, O.burntJogre), () => b.count(O.jogrePaste) > 0, 8, 2);
                if (b.count(O.jogrePaste) > 0) await b.dropAll([O.pestle]);
                lastSend = -100; continue;
            }
            if (b.free() === 0) fail(b, `pack full at ${b.count(O.kji)} karambwanji`);
            if (b.count(O.kji) > lastCount) { lastCount = b.count(O.kji); lastGain = b.tickCount; }
            // the net action re-queues itself (p_opnpc(4), tbwt.rs2:83-97: a roll every 5 t): re-send only when idle
            if (b.tickCount - lastSend >= 30 || (b.tickCount - lastGain >= 8 && b.tickCount - lastSend >= 8)) {
                const sp = npcsOf(b, NPC.kjiSpot).filter(q => q.d <= 14)[0];
                if (sp) { opNpcGo(b, sp, 1); lastSend = b.tickCount; }
            }
            await b.tick(1);
        }
        // raw paste onto the burnt bones (pestle), then the pestle can go
        if (!pasted()) {
            if (b.count(O.kjiPaste) === 0 && !(await retry(b, useOn(O.kji, O.pestle), () => b.count(O.kjiPaste) > 0, 8, 2))) fail(b, 'grind karambwanji');
            if (!(await retry(b, useOn(O.kjiPaste, O.burntJogre), () => b.count(O.jogrePaste) > 0, 8, 2))) fail(b, 'paste on the burnt bones');
        }
        await b.dropAll([O.net, O.shrimp, O.pestle].filter(id => b.count(id) > 0));
        L(`karambwanji ${b.count(O.kji)} (${b.tickCount - t1} t)`);
    }
    async function tiadeche1(b: SpeedBot, L: (s: string) => void, intro = false): Promise<void> {
        await goEast(b, T.tiadeche, 3, 'tiadeche');
        if (!intro) {
        step(); await talkTo(b, NPC.tiadeche, [R, R, R, R, R], { done: () => seen(/I will return only when I have caught a Karambwan/i), maxTicks: 30, label: 'tiadeche 1', tries: 4 });
        dismiss(b); await b.tick(1);
        }
        step(); await giveTo(NPC.tiadeche, O.loaded, T.tiadeche, () => b.count(O.loaded) === 0 && seen(/never mind/i) && !inDialog(b), [/^No$/i], 'tiadeche vessel', 80);
        L('tiadeche: manual requested');
    }
    async function zambo(b: SpeedBot, L: (s: string) => void): Promise<void> {
        await goK(b, T.zambo, 3, 'zambo');
        for (let k = 0; k < 4 && b.count(O.rum) === 0 && b.count(O.bananaRum) === 0; k++) {
            if (!b.shopIsOpen()) { const z = npc(b, NPC.zambo); if (z) opNpcGo(b, z, 3); await b.until(() => b.shopIsOpen(), 15); }
            if (b.shopIsOpen()) { b.shopBuy(O.rum, 1); b.queueFlush(); await b.until(() => b.count(O.rum) > 0, 5); }
        }
        if (b.count(O.rum) === 0 && b.count(O.bananaRum) === 0) fail(b, 'no Karamja rum from Zambo');
        b.closeModal(); await b.tick(1);
        if (b.count(O.bananaRum) === 0 && !(await retry(b, useOn(O.rum, O.banana), () => b.count(O.bananaRum) > 0, 8, 2))) fail(b, 'sliced banana in rum');
        L('banana rum');
    }
    async function lubufu(b: SpeedBot, L: (s: string) => void, J: { lubHelp: boolean; lubGiven: boolean; lubAppr: boolean }): Promise<void> {
        await goK(b, T.lubufu, 3, 'lubufu');
        if (!J.lubHelp) {
        step(); await talkTo(b, NPC.lubufu, [], { done: () => seen(/(Well then go away from here|Now leave)/i) && !inDialog(b), answers: [/I wasn't going anywhere/i], maxTicks: 30, label: 'lubufu 1', tries: 4 });
        dismiss(b);
        // no wait: his 10 t "go away" queue is only checked while %tbwt_lubufu < intro (tbwt_lubufu.rs2:9-16); talk 1 sets intro
        step(); await talkTo(b, NPC.lubufu, [], { done: () => seen(/Return here as soon as you have caught 20 Karambwanji/i) && !inDialog(b),
            answers: [/^Talk about him/i, /^How old are you/i, /I could help collect the bait/i, /You sound like you could do with the help/i], maxTicks: 60, label: 'lubufu 2', tries: 3 });
        dismiss(b);
        }
        // talking again hands them over by itself ("Yes, I have some here", tbwt_lubufu.rs2:270-305)
        if (!J.lubGiven) {
        const k0 = b.count(O.kji);
        step(); await talkTo(b, NPC.lubufu, [], { done: () => b.count(O.kji) <= k0 - 20 && !inDialog(b), maxTicks: 40, label: 'lubufu karambwanji', tries: 3 });
        if (b.count(O.kji) > k0 - 20) fail(b, 'lubufu: karambwanji not taken');
        dismiss(b);
        }
        // three questions, one talk each (each label ends the talk and adds 1; the third offers the apprenticeship). A text
        // component that CHANGED since the talk began proves the answer page came (stale pages stay in ifText).
        for (let q = J.lubAppr ? 2 : 0; q < 3; q++) {
            const mk = textMark(b);
            const fresh = (re: RegExp) => sawText(b, re, mk);
            const done = q < 2 ? () => fresh(/octopus/i) && !inDialog(b) : () => (fresh(/practise on my/i) || fresh(/Lubufu hands you a Karambwan vessel/i)) && !inDialog(b);
            step(); await talkTo(b, NPC.lubufu, [], { done, answers: [/What do you use to catch Karambwan/i, /^Yes!$/i], maxTicks: 60, label: `lubufu q${q + 1}`, tries: 3 });
            dismiss(b);
        }
        await b.dropAll([O.kji].filter(id => b.count(id) > 0));
        L('lubufu: apprentice');
    }
    async function tinsay(b: SpeedBot, L: (s: string) => void, J: { tinIntro: boolean; rum: boolean; sandwich: boolean; bones: boolean; tiaGot: boolean }): Promise<void> {
        await goCairn(b, T.tinsay, 2, 'tinsay');
        // resume: the intro only while Tinsay is still unmet
        if (!J.tinIntro && !J.rum) { step(); await talkTo(b, NPC.tinsay, [], { done: () => seen(/I need banana in Karamjan rum/i) && !inDialog(b), maxTicks: 60, label: 'tinsay intro', tries: 3 });
        dismiss(b); await b.tick(1); }
        if (!J.rum) { step(); await giveTo(NPC.tinsay, O.bananaRum, T.tinsay, () => b.count(O.bananaRum) === 0 && seen(/seaweed in monkey skin sandwich!/i) && !inDialog(b), [], 'tinsay rum', 60); }
        if (!J.sandwich) { step(); await giveTo(NPC.tinsay, O.sandwich, T.tinsay, () => b.count(O.sandwich) === 0 && seen(/Marinated in Karambwanji!/i) && !inDialog(b), [], 'tinsay sandwich', 80); }
        if (!J.bones) { step(); await giveTo(NPC.tinsay, O.marinade, T.tinsay, () => b.count(O.marinade) === 0 && seen(/meet you in the village once you have helped/i) && !inDialog(b), [], 'tinsay bones', 60); }
        if (!J.tiaGot && b.count(O.manual) === 0) { step(); await giveTo(NPC.tinsay, O.vessel, T.tinsay, () => b.count(O.manual) > 0, [], 'tinsay manual', 40); }
        L('tinsay complete, manual');
    }
}

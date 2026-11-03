/// <reference types="bun" />
// q-temple-of-ikov.ts — TEMPLE OF IKOV (Armadyl ending), cheat-free. Lane south (max-QP route).
//
// Flow (every step verified in the rev-289 content, paths relative to server/content/scripts/quests/quest_ikov/):
//  1. Lucien (Ardougne inn, npc ikov_lucien1 @2573,3321): "I'm a mighty hero!" -> "That sounds like a laugh!" gives the
//     Pendant of Lucien, %ikov = 10 (lucien.rs2:49-72).
//  2. Hemenster cellar ladder (2677,3405) -> (2677,9804). Dark stairs (2651,9808) need a lit light source, else you land
//     in the dark (ikov_dungeon.rs2:3-10). Below: the Boots of lightness (obj spawn 2654,9767) sit behind a slashable web
//     (bigweb_slashable @2654,9766; knife or slash weapon, 50% per try: general_use/scripts/web.rs2:10-31). Stairs up
//     (2638,9763) -> (2654,9809) (ikov_dungeon.rs2:84-85).
//  3. North "door of fear" (gate 94/95 @2661-2662,9815) opens from the south only with the Pendant of Lucien WORN
//     (ikov_dungeon.rs2:15-23). The lava bridge (x2648-2650, z9828-9829) carries you across only with total weight < 0
//     (boots of lightness worn = -10 lb), else 20 damage (ikov_dungeon.rs2:52-82). West of it: the Lever (obj 2637,9819).
//  4. Lever on the bracket (2671,9804) -> pull it: sets the lever bit (ikov_dungeon.rs2:87-110), which opens the south gate
//     (89/90 @2661-2662,9803) from the north (ikov_dungeon.rs2:28-34). Behind it: six chests; ONE (per-player random
//     coord) holds 1-5 ice arrows, then re-rolls (quest_ikov.rs2:9-17, ikov_dungeon.rs2:115-131).
//  5. Trap lever (2665,9855): Search for traps (thieving 42 stat(), ikov_dungeon.rs2:155-165) then Pull -> %ikov 30
//     (ikov_dungeon.rs2:133-134); its door (2648,9857) opens (ikov_dungeon.rs2:170-175).
//  6. The Fire Warrior door (2646,9870) spawns the Fire Warrior of Lesarkus (cl84, 59 hp) at (2646,9866)
//     (ikov_dungeon.rs2:177-219). Only ranged with ice arrows WORN hurts him (skill_combat npc_combat.rs2:169); ice arrows
//     need a bow with levelrequire >= 40 (player_ranged.rs2:115 + quest_ikov.obj:32) -> yew shortbow (ranged 40). His death
//     sets %ikov 40 (fire_warrior_of_leskarus.rs2:22-32). Arrows drop under him 80% of shots (player_ranged.rs2:123-134,
//     combat.constant dropammo_chance 5).
//  7. Winelda (2656,9875): talk once (-> 50), again with 20 limpwurt roots (-> 60) and she teleports you over the lava to
//     (2664,9876) (winelda.rs2).
//  8. Guardian of Armadyl (Lucien's pendant NOT worn, guardian_of_armadyl.rs2:20): "I seek the Staff" -> "Lucien will give
//     me a grand reward" -> "yearly bath" -> "Ok! I'll help!" = %ikov 70 + Armadyl pendant (guardian_of_armadyl.rs2:30-119).
//     The Lucien ending is slower: the staff pickup is refused while any guardian stands within 5 tiles in sight
//     (quest_ikov.rs2:50-57, five guardians at 2636-2649,9899-9912) and the guardians attack the staff carrier.
//  9. Glory -> Edgeville, walk to Lucien's house (door 3176,3481 opens at %ikov >= 10, quest_ikov.rs2:1-5), kill Lucien
//     (cl14, 17 hp) wearing the Armadyl pendant (quest_ikov.rs2:19-35) -> quest complete (lucien.rs2:108-122,
//     quest_ikov.rs2:60-68: ranged 10,500 + fletching 8,000 base xp, 1 QP).
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { nav, navSync, talk, sendToks, R, M2, M3, M4, qp, opNpcGo, opLocGo, pickupGo, openLoc, walkOp, inDialog, msgsSince, dismiss, log as qlog, trace } from '../../q-lib.js';
import {
    fail, dead, locHere, liveId, retry, unwear, talkTo, locEvents, msgAfter, chatMark, chatSince, opLocUntil, useOnLocUntil, wear, eatIfLow, foodCount, glory, groundOf, npcsOf, npc, opHeld, FOODS, type Item, type Tile,
} from './south-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Temple of Ikov', dir: 'quest_ikov', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        thieving: [42, 'search the trap lever: stat(thieving) >= 42 (ikov_dungeon.rs2:158)'],
        ranged: [40, 'wield the yew shortbow (bows.obj:277 levelrequire 40); ice arrows need a levelrequire-40 bow (player_ranged.rs2:115)'],
        prayer: [37, 'optional: Protect from Magic against the Fire Warrior (max 8 per cast); without it carry more food'],
    } as Record<string, [number, string]>,
    start: { x: 2574, z: 3320, level: 0 },      // next to Lucien in the Ardougne inn
    end: { x: 3176, z: 3478, level: 0 },        // Lucien's house north of Varrock
};
/** Tradeable inputs. The pack + worn gear must weigh < 10 lb at the lava bridge (boots of lightness = -10 lb):
 *  wear no armour, carry no coins (2 g each). The 20 roots are unnoted (20 slots), so 3 sharks fill the pack (the
 *  bow is wielded at once; the pendant and boots need 2 free slots). */
export const SUPPLY: Item[] = [
    { name: 'yew_shortbow', n: 1 }, { name: 'lit_candle', n: 1 }, { name: 'knife', n: 1 }, { name: 'limpwurt_root', n: 20 },
    { name: 'amulet_of_glory_4', n: 1 }, { name: 'shark', n: 3 },
];

// ids: content/pack (obj.pack / npc.pack / loc.pack)
const O = {
    pendantL: objId('ikov_pendantoflucien'), pendantA: objId('ikov_pendantofarmardyl'), boots: objId('ikov_bootsoflightness'),
    bootsWorn: objId('ikov_bootsoflightnessworn'), lever: objId('ikov_lever'), ice: objId('ice_arrow'), bow: objId('yew_shortbow'),
    candle: objId('lit_candle'), knife: objId('knife'), root: objId('limpwurt_root'),
};
const NPC = { lucien1: 273, lucien2: 272, guardians: [274, 275], winelda: 276, warrior: 277 };
const CHESTS: Tile[] = [{ x: 2710, z: 9850 }, { x: 2719, z: 9838 }, { x: 2729, z: 9850 }, { x: 2738, z: 9835 }, { x: 2747, z: 9848 }, { x: 2745, z: 9821 }];
const T = {
    ladderStand: { x: 2677, z: 3404 }, cellar: { x: 2677, z: 9804 }, stairsStand: { x: 2654, z: 9809 }, dark: { x: 2641, z: 9764 },
    webStand: { x: 2654, z: 9765 }, bootsAt: { x: 2654, z: 9767 }, fearS: { x: 2661, z: 9814 }, fearN: { x: 2661, z: 9815 },
    bridgeE: { x: 2651, z: 9829 }, bridgeW: { x: 2647, z: 9829 }, leverAt: { x: 2637, z: 9819 }, bracketStand: { x: 2671, z: 9805 },
    southN: { x: 2662, z: 9803 }, trapStand: { x: 2665, z: 9855 }, trapDoorS: { x: 2648, z: 9857 }, fwDoorS: { x: 2646, z: 9870 },
    winelda: { x: 2656, z: 9875 }, landing: { x: 2664, z: 9876 }, secretS: { x: 2643, z: 9892 },
    edgeville: { x: 3087, z: 3496 }, lucienDoorN: { x: 3176, z: 3481 },
};
/** Ice arrows to collect before the fight. A shot breaks the arrow 1 in 5 (player_ranged.rs2:128), the rest drop under
 *  him and are picked up mid-fight, so the need is ~20% of the shots: measured, 8 ran dry twice at ranged 56 (sob81/82),
 *  10 finished 8 of 8 with 0-4 left, 8 sufficed at ranged 99. IKOV_ARROWS overrides. */
export const ikovArrows = (ranged: number) => Number(process.env.IKOV_ARROWS ?? (ranged >= 90 ? 8 : ranged >= 70 ? 10 : 12));

export async function run(bot: SpeedBot, o: { log?: boolean; arrows?: number } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    const t0 = bot.tickCount, qp0 = qp(bot);
    const want = o.arrows ?? ikovArrows(bot.stat('ranged').level);
    bot.holdDialogs = true;
    trace(bot, t0);
    const L = (s: string) => { if (o.log !== false) qlog(bot, t0, `${s} | hp ${bot.stat('hitpoints').cur} ice ${bot.count(O.ice) + wornCount(bot, O.ice)}`); failHook(s); };
    const guard = () => { if (dead(bot)) fail(bot, 'died'); eatIfLow(bot); };
    // session 10: on a retry / resume, the section the quest JOURNAL (ikov_journal.rs2) shows; the supply checks (candle, knife,
    // 20 roots, free slots) only apply to the sections that still use them. 0 = from the top (a fresh attempt). IKOV_RESUME=0 reverts.
    // sections: 0 pendant .. 5 trap lever, 6 Fire Warrior, 7 Winelda, 8 Guardian, 9 Lucien
    let from = 0;
    if (isResuming(bot) && process.env.IKOV_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const j = await readJournal(bot, 'ikov');
        const r = (re: RegExp) => j.ok && re.test(j.text);
        const t = bot.tile(), pastTrap = t.z >= 9858 && t.z < 9871 && t.x >= 2630 && t.x <= 2670;
        if (r(/QUEST COMPLETE/i)) return { ok: true, ticks: bot.tickCount - t0, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
        from = r(/I will kill\s+Lucien/i) ? 9 : r(/Winelda teleported me across/i) ? 8 : r(/Winelda will teleport me across|killed it using arrows made of ice/i) ? 7
            : r(/have disabled it/i) && pastTrap ? 6 : 0;
        L(`[journal] ikov: ${j.ok ? `section ${from} | open '${j.open.slice(0, 120)}'` : 'UNREADABLE'} (${j.ticks} t)`);
    }
    const S = (n: number) => from <= n;
    try {
        // ---- 0. pack: drop what the quest will not use (weight: the lava bridge needs < 0 with the boots on)
        const ids = (names: string[]) => names.flatMap(n => { try { return [objId(n)]; } catch { return []; } });
        const keep = new Set([...SUPPLY.map(i => objId(i.name)), O.pendantL, O.pendantA, O.boots, O.lever, O.ice,
            ...ids(['amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', ...FOODS]),
            ...ids(['lawrune', 'airrune', 'waterrune', 'earthrune', 'firerune', 'coins', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'])]);   // route runner: keep the travel kit
        const junk = [...new Set(bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj))];
        if (junk.length) { L(`dropping ${junk.map(objDebugName).join(',')}`); await bot.dropAll(junk); }
        for (const need of S(1) ? ['yew_shortbow', 'lit_candle', 'knife'] : ['yew_shortbow']) if (bot.count(need) === 0 && !bot.isWorn(objId(need))) fail(bot, `missing ${need}`);
        if (S(7) && bot.count(O.root) < 20) fail(bot, `need 20 limpwurt roots (have ${bot.count(O.root)})`);
        // the pack is tight (20 unnoted roots: Winelda counts inv_total(inv, limpwurt_root), winelda.rs2:4): wield the bow now
        if (!(await wear(bot, ['yew_shortbow']))) fail(bot, 'wield the yew shortbow (ranged 40?)');
        if (S(0) && bot.free() < 2) fail(bot, `need 2 free slots (pendant, boots), have ${bot.free()}`);
        if (S(5)) {

        // ---- 1. Lucien: the pendant (%ikov 10)
        if (bot.count(O.pendantL) === 0 && !bot.isWorn(O.pendantL)) {
            await talkTo(bot, NPC.lucien1, [R, M2[0]!, R, R, R, M4[1]!, R, R, R, R], {
                done: () => bot.count(O.pendantL) > 0, answers: [/mighty hero/i, /sounds like a laugh/i], maxTicks: 30, label: 'lucien1', tries: 4 });
            if (bot.count(O.pendantL) === 0) fail(bot, 'Lucien gave no pendant');
        }
        L('pendant');
        // ---- 2. cellar ladder -> dark stairs -> web -> boots -> back up
        const ladder = locHere(1754, 2677, 3405);
        dismiss(bot);
        if (bot.tile().z < 6400 && !(await walkOp(bot, T.ladderStand, () => bot.opLoc(ladder.x, ladder.z, ladder.id, 1), () => bot.tile().z > 6400, { maxTicks: 300 }))) fail(bot, 'cellar ladder');
        L('cellar');
        const stairsDown = locHere(98, 2651, 9808);
        if (!(await walkOp(bot, T.stairsStand, () => bot.opLoc(stairsDown.x, stairsDown.z, stairsDown.id, 1), () => bot.tile().z < 9790, { maxTicks: 120 }))) fail(bot, 'dark stairs down');
        if (cheb(bot.tile(), T.dark) > 3) fail(bot, 'dark stairs: landed in the dark (no lit light source?)');
        L('dark room');
        const web = locHere(733, 2654, 9766);
        const webOpen = () => liveId(bot, web.x, web.z, 733) === 734;
        if (!(await useOnLocUntil(bot, O.knife, web, () => webOpen() || msgsSince(bot, bot.tickCount - 1).some(m => /slash the web apart/i.test(m)), 60, 1))) fail(bot, 'web');
        await bot.until(webOpen, 3);
        openLoc({ x: web.x, z: web.z, level: 0 });
        if (!(await retry(bot, () => pickupGo(bot, O.boots, T.bootsAt), () => bot.count(O.boots) > 0, 30, 3))) fail(bot, 'boots');
        L('boots');
        const stairsUp = locHere(96, 2638, 9763);
        if (!(await opLocUntil(bot, stairsUp, 1, () => bot.tile().z > 9790, 60, 5))) fail(bot, 'dark stairs up');
        // the light source and the knife are done: drop them (weight) and put the boots + pendant on
        await bot.dropAll([O.candle, O.knife]);
        // worn, the boots turn into ikov_bootsoflightnessworn (-10 lb) in a members world (player/scripts/equip.rs2:453-455)
        await wear(bot, ['ikov_bootsoflightness', 'ikov_pendantoflucien']);
        if (!(await bot.until(() => (bot.isWorn(O.bootsWorn) || bot.isWorn(O.boots)) && bot.isWorn(O.pendantL), 4))) fail(bot, 'wear boots + pendant');
        L('boots on');
        // ---- 3. door of fear (north), lava bridge, lever, bridge back
        await passGate(bot, 95, 2661, 9815, () => northSide(bot.tile()), T.fearS, 'door of fear north');
        await crossBridge(bot, 'west');
        if (!(await walkOp(bot, T.leverAt, () => bot.opObj(T.leverAt.x, T.leverAt.z, O.lever, 3), () => bot.count(O.lever) > 0, { maxTicks: 80 }))) fail(bot, 'lever pickup');
        L('lever');
        await crossBridge(bot, 'east');
        await passGate(bot, 95, 2661, 9815, () => !northSide(bot.tile()), T.fearN, 'door of fear south');
        // ---- 4. lever on the bracket + pull (the mended lever lasts 200 t: ikov_dungeon.rs2:92)
        const bracket = locHere(86, 2671, 9804);
        const pulled = () => msgsSince(bot, t0).length >= 0 && [...bot.ifText.values()].some(v => /clunking of some hidden machinery/i.test(v));
        if (!(await walkOp(bot, T.bracketStand, null, () => cheb(bot.tile(), T.bracketStand) === 0, { maxTicks: 80 }))) fail(bot, 'bracket');
        // the use opens a mesbox first; the lever is removed and the bracket becomes the mended lever only when it is
        // continued (ikov_dungeon.rs2:87-94): RESUME + the pull ride one burst (the resume runs the script synchronously)
        const fitted = () => [...bot.ifText.values()].some(v => /fit the lever into the bracket/i.test(v));
        if (!(await useOnLocUntil(bot, O.lever, bracket, () => fitted() || bot.count(O.lever) === 0, 12, 4))) fail(bot, 'lever on bracket');
        const mended = { ...bracket, id: 87 };
        sendToks(bot, ['R', () => bot.opLoc(mended.x, mended.z, mended.id, 1)]);
        if (!(await bot.until(pulled, 4)) && !(await retry(bot, () => { if (bot.chatModalId !== -1 && !pulled()) bot.resumeDialogPage(); opLocGo(bot, mended, 1); }, pulled, 16, 4))) fail(bot, 'pull the lever');
        L('lever pulled');
        // ---- 5. south gate (from the north: needs the lever bit) -> chests until `want` ice arrows
        dismiss(bot);
        await passGate(bot, 89, 2662, 9803, () => southSide(bot.tile()), T.southN, 'south gate');
        await searchChests(bot, want, L);
        // ---- 6. back north: south gate, door of fear, trap lever
        await passGate(bot, 89, 2662, 9803, () => !southSide(bot.tile()), { x: 2662, z: 9802 }, 'south gate back');
        await passGate(bot, 95, 2661, 9815, () => northSide(bot.tile()), T.fearS, 'door of fear north (2)');
        const trap = locHere(91, 2665, 9855);
        const searched = () => [...bot.ifText.values()].some(v => /disable the trap/i.test(v));
        if (!(await walkOp(bot, T.trapStand, () => bot.opLoc(trap.x, trap.z, trap.id, 2), searched, { maxTicks: 120 }))) fail(bot, 'trap lever search (thieving 42?)');
        dismiss(bot);
        // pull: %ikov 20 -> 30 (no message); then the door opens only at >= 30
        const tDoor = locHere(92, 2648, 9857);
        let pulledTrap = false;
        for (let k = 0; k < 4 && bot.tile().z < 9858; k++) {
            if (!pulledTrap) { await opLocUntil(bot, trap, 1, () => liveId(bot, trap.x, trap.z, 91) === 88, 8, 4); pulledTrap = true; }
            await walkOp(bot, T.trapDoorS, () => bot.opLoc(tDoor.x, tDoor.z, tDoor.id, 1), () => bot.tile().z >= 9858, { maxTicks: 40 });
            if (bot.tile().z < 9858 && msgsSince(bot, bot.tickCount - 8).some(m => /won't open/i.test(m))) pulledTrap = false;
        }
        if (bot.tile().z < 9858) fail(bot, 'trap lever door');
        L('past the trap door');
        }
        // ---- 7. Fire Warrior
        // ---- 8. through his door to Winelda. "He is gone" from the npc list is not proof of the kill (one run saw him vanish
        //      after 28 t at %ikov 30): only the door opening proves %ikov 40 (ikov_dungeon.rs2:177-181); a refusal re-spawns
        //      him, so fight again. Out of arrows: back to the chests for more (rare: see ikovArrows).
        const fwDoor = locHere(93, 2646, 9870);
        if (S(6)) {
        for (let k = 0; k < 4 && bot.tile().z < 9871; k++) {
            try {
                await fireWarrior(bot, L);
                // fix 355 TEST (IK_FW_DEAD_TEST=1): call it again after the kill = the qx161m/qx163m state (%ikov 40, no warrior)
                if (process.env.IK_FW_DEAD_TEST === '1' && bot.tile().z < 9871) { L('355 TEST: fireWarrior again after the kill'); await fireWarrior(bot, L); }
            }
            catch (e) {
                if (!/out of ice arrows/.test((e as Error).message) || k >= 2) throw e;
                L('out of ice arrows: back to the chests');
                await refillArrows(bot, 6, L);
                continue;
            }
            await walkOp(bot, T.fwDoorS, () => bot.opLoc(fwDoor.x, fwDoor.z, fwDoor.id, 1), () => bot.tile().z >= 9871 || !!npc(bot, NPC.warrior), { maxTicks: 60 });
        }
        if (bot.tile().z < 9871) fail(bot, 'fire warrior door');
        }
        dismiss(bot);
        if (S(7)) {
        const w1 = await talk(bot, NPC.winelda, [R, R, M3[2]!, R, R, R, R, R, R, R, R, R], {
            done: () => [...bot.ifText.values()].some(v => /shows them some magic/i.test(v)) && bot.chatModalId === -1, answers: [/Yes I do/i], maxTicks: 60, label: 'winelda1' });
        if (!w1.ok) L('winelda 1: not confirmed, trying talk 2 anyway');
        await bot.tick(1);
        const w2 = await talk(bot, NPC.winelda, [R, R, R], { done: () => cheb(bot.tile(), T.landing) <= 2, answers: [/Yes I do/i], maxTicks: 40, label: 'winelda2' });
        if (!w2.ok) fail(bot, 'Winelda did not teleport us');
        L('over the lava');
        }
        if (S(8)) {
        // ---- 9. Guardian of Armadyl (Lucien's pendant off first)
        // (Winelda's teleport ends in p_delays that drop an IF click: unwear() re-sends until it is off)
        if (!(await unwear(bot, O.pendantL))) fail(bot, 'could not take off the Pendant of Lucien');
        const secret = locHere(1586, 2643, 9892);
        if (!(await walkOp(bot, T.secretS, () => bot.opLoc(secret.x, secret.z, secret.id, 1), () => bot.tile().z >= 9893, { maxTicks: 60 }))) fail(bot, 'secret door');
        const g = await talk(bot, NPC.guardians, [R, M3[0]!, R, R, M3[0]!, R, R, M3[2]!, R, R, R, R, R, M3[0]!, R, R, R, R], {
            done: () => bot.count(O.pendantA) > 0, answers: [/seek the Staff/i, /grand reward/i, /yearly bath/i, /Ok! I'll help/i], maxTicks: 80, label: 'guardian' });
        if (!g.ok) fail(bot, 'no Armadyl pendant');
        L('armadyl pendant');
        dismiss(bot);
        if (!(await wear(bot, ['ikov_pendantofarmardyl']))) fail(bot, 'wear the Armadyl pendant');
        }
        if (!S(8) && !bot.isWorn(O.pendantA) && bot.count(O.pendantA) > 0 && !(await wear(bot, ['ikov_pendantofarmardyl']))) fail(bot, 'wear the Armadyl pendant (resume)');
        // ---- 10. out: glory to Edgeville, Lucien's house, kill Lucien (a resume already north of Varrock walks)
        if (!(from === 9 && bot.tile().z < 6400 && cheb(bot.tile(), { x: 3176, z: 3490 }) <= 60) && !(await glory(bot, 1))) fail(bot, 'glory teleport');
        L('edgeville');
        const lDoor = locHere(102, 3176, 3481);
        // the Edgeville -> Lucien route crosses z 3512-3515 (a fence line closes the way further south), where the engine
        // opens the wilderness warning (main 1908) and p_stopaction's the walk (area_wilderness/wilderness_warning.rs2:6-23):
        // close it and walk on
        const WILD_WARNING = 1908;
        for (let k = 0; k < 4 && bot.tile().z > 3480; k++) {
            await walkOp(bot, T.lucienDoorN, () => bot.opLoc(lDoor.x, lDoor.z, lDoor.id, 1), () => bot.tile().z <= 3480 || bot.mainModalId === WILD_WARNING, { maxTicks: 160 });
            if (bot.mainModalId === WILD_WARNING) { bot.closeModal(); bot.mainModalId = -1; await bot.tick(1); }
        }
        if (bot.tile().z > 3480) fail(bot, 'Lucien door');
        L('in Lucien\'s house');
        // session 11 fix 273 IKOV_LUCIEN_FISTS (qx28m, CONFIRMED from the log: the Fire Warrior left 2 ice arrows ('ice 2' at
        // the house), they did not kill Lucien (17 hp), then the yew shortbow had no ammo and every attack was refused for the
        // rest of the 150 t; the retry came back with 0 arrows and failed the same way, ROUTE STOPPED at qp 90). Any weapon
        // kills him once the Armadyl pendant is worn (quest_ikov.rs2 lucien_attack): with no ice arrow worn, held or on the
        // floor within 6, take the bow off and punch (cb 120+ vs cl14), 300 t budget; the Armadyl pendant is re-worn if a
        // retry took it off. IKOV_LUCIEN_FISTS=0 reverts. TEST: IKOV_FISTS_TEST=1 punches from the start (no arrows used).
        const fix273 = process.env.IKOV_LUCIEN_FISTS !== '0';
        if (fix273 && !bot.isWorn(O.pendantA) && bot.count(O.pendantA) > 0) await wear(bot, ['ikov_pendantofarmardyl']);
        let fists = fix273 && process.env.IKOV_FISTS_TEST === '1';
        if (!fists) await wear(bot, ['yew_shortbow', 'ice_arrow']);
        const goFists = async (why: string) => {
            fists = true;
            const bow = objId('yew_shortbow');
            if (bot.isWorn(bow) && bot.free() > 0) await unwear(bot, bow);
            L(`fix 273: Lucien with fists (${why}; bow ${bot.isWorn(bow) ? 'STILL WORN' : 'off'})`);
        };
        if (fists) await goFists('IKOV_FISTS_TEST');
        const t1 = bot.tickCount;
        let lastAtk = -100;
        while (qp(bot) < qp0 + QUEST.qp && bot.tickCount - t1 < (fix273 ? 300 : 150)) {
            guard();
            if (bot.chatModalId !== -1 && !bot.dialogOptions().length) bot.resumeDialogPage();
            if (!fists && wornCount(bot, O.ice) === 0 && !(await rearm(bot, 6)) && fix273) { await goFists('out of ice arrows'); lastAtk = -100; }
            const l = npc(bot, NPC.lucien2);
            if (l && bot.tickCount - lastAtk >= 6) { opNpcGo(bot, l, 2); lastAtk = bot.tickCount; }
            await bot.tick(1);
        }
        if (qp(bot) < qp0 + QUEST.qp) fail(bot, `Lucien not killed / no quest point (${fists ? 'fists' : `ice ${wornCount(bot, O.ice)}`}, Lucien ${npc(bot, NPC.lucien2) ? 'in view' : 'not in view'}, armadyl ${bot.isWorn(O.pendantA) ? 'worn' : 'NOT worn'})`);
        L('QUEST COMPLETE');
        return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message };
    }
}

function wornCount(bot: SpeedBot, obj: number): number {
    const w = (bot as any).invs.get(1688) as { ids: Int32Array; counts: Int32Array } | undefined;
    if (!w) return 0; let n = 0;
    for (let i = 0; i < w.ids.length; i++) if (w.ids[i] === obj) n += w.counts[i]!;
    return n;
}

/** Dungeon regions split by the two gates (rsmod: the chest area east of the rockslides x>=2683 is reached only through
 *  the south gate; the door of fear leads north). */
const southSide = (t: Tile) => t.z <= 9802 || t.x >= 2683;
const northSide = (t: Tile) => t.z >= 9815 && t.x < 2683;
/** Op a scripted double gate (it walks you through, open_and_close_double_doors.rs2:63-) from `stand`. */
async function passGate(bot: SpeedBot, id: number, x: number, z: number, through: () => boolean, stand: Tile, label: string): Promise<void> {
    if (through()) return;
    const gate = locHere(id, x, z);
    for (let k = 0; k < 4 && !through(); k++) {
        await walkOp(bot, stand, () => bot.opLoc(gate.x, gate.z, gate.id, 1), through, { maxTicks: 120 });
        if (!through()) await bot.until(through, 4);
        if (!through() && [...bot.ifText.values(), ...msgsSince(bot, bot.tickCount - 6)].some(v => /terror overcomes|won't open/i.test(v))) fail(bot, `${label}: refused`);
    }
    if (!through()) fail(bot, `${label}: not through`);
}

/** The lava bridge: step on its east (x2650) or west (x2648) tile; the zone timer carries you (ikov_dungeon.rs2:40-70). */
async function crossBridge(bot: SpeedBot, dir: 'west' | 'east'): Promise<void> {
    const onFar = () => dir === 'west' ? bot.tile().x <= 2647 && bot.tile().z >= 9828 && bot.tile().z <= 9829 : bot.tile().x >= 2651 && bot.tile().z >= 9827 && bot.tile().z <= 9831;
    const from = dir === 'west' ? { x: 2651, z: 9829 } : { x: 2647, z: 9829 };
    const step = dir === 'west' ? { x: 2650, z: 9829 } : { x: 2648, z: 9829 };
    const t = bot.tickCount;
    for (let k = 0; k < 3 && !onFar(); k++) {
        if (cheb(bot.tile(), from) > 0 && !(bot.tile().z >= 9828 && bot.tile().z <= 9829 && bot.tile().x >= 2648 && bot.tile().x <= 2650)) {
            if (!(await walkOp(bot, from, null, () => cheb(bot.tile(), from) === 0 || onFar(), { maxTicks: 120 }))) fail(bot, `bridge ${dir}: approach`);
        }
        if (!onFar()) { bot.sendRoute([step]); await bot.until(onFar, 8); }
        if (msgsSince(bot, t).some(m => /bridge gives way/i.test(m))) fail(bot, `bridge ${dir}: too heavy (weight must be < 0 with the boots on)`);
    }
    if (!onFar()) fail(bot, `bridge ${dir}: not across`);
}

/** Open + search the six chests until `want` ice arrows. The arrow chest is a per-player random coord that re-rolls
 *  uniformly over all six after each find (quest_ikov.rs2:9-17, ikov_dungeon.rs2:115-131), so: after a find search the
 *  same chest again (1/6, ~1 t), else go to the nearest chest not searched since the last roll.
 *  A chest stays open 300 t (general_use/scripts/chests.rs2:69). Its live state can be stale after we walk out of view
 *  and back, so each try sends BOTH ops in one burst: Open on the closed id and Search on the open id; the engine drops
 *  the one whose loc id is not there (and the dropped packet does not clear the other's interaction). */
export async function searchChests(bot: SpeedBot, want: number, L: (s: string) => void): Promise<void> {
    const have = () => bot.count(O.ice);
    const t0 = bot.tickCount;
    const ev = locEvents(bot);
    let searches = 0, finds = 0;
    let pending = new Set(CHESTS.map((_, i) => i));
    let cur = -1;
    while (have() < want) {
        if (bot.tickCount - t0 > 900) fail(bot, `chests: only ${have()} ice arrows after 900 t`);
        if (dead(bot)) fail(bot, 'died at the chests');
        eatIfLow(bot);
        if (!pending.size) pending = new Set(CHESTS.map((_, i) => i));
        let pick = cur >= 0 && pending.has(cur) ? cur : -1;
        if (pick < 0) {
            const me = bot.tile(); let best = 1e9;
            for (const i of pending) { const d = cheb(me, CHESTS[i]!); if (d < best) { best = d; pick = i; } }
        }
        const c = CHESTS[pick]!;
        const closed = locHere(103, c.x, c.z), open = { ...closed, id: 104 };
        const key = `0,${c.x},${c.z}`;
        let searched = false, found = false;
        const reached = () => { const n = navSync(), me = bot.tile(); return n.reachedLoc(0, me.x, me.z, closed.x, closed.z, closed.width, closed.length, closed.angle, closed.shape, n.locForceApproach(closed.id)); };
        for (let k = 0; k < 4 && !searched; k++) {
            if (bot.chatModalId !== -1) bot.resumeDialogPage();
            // 1) Open (op1 on the closed id). A fresh zone event says it opened; standing in reach for 2 t without one
            //    means it was already open (stale live state) or the op was eaten.
            const e0 = ev.get(key)?.tick ?? -1;
            const opened = () => (ev.get(key)?.tick ?? -1) > e0 && ev.get(key)?.id === 104;
            const fresh = isFreshOpen(ev.get(key), bot.tickCount);
            if (!fresh) {
                opLocGo(bot, closed, 1);
                let still = 0, last = '';
                await bot.until(() => { const t = bot.tile(), kk = `${t.x},${t.z}`; still = kk === last ? still + 1 : 0; last = kk; return opened() || (reached() && still >= 2); }, 40);
            }
            // 2) Search (op1 on the open id)
            const n0 = have(), s0 = bot.tickCount, mk = chatMark(bot);
            if (bot.chatModalId !== -1) bot.resumeDialogPage();
            opLocGo(bot, open, 1);
            await bot.until(() => have() > n0 || chatSince(bot, mk, /find nothing/i), 6);
            if (have() > n0) { searched = true; found = true; }
            else if (chatSince(bot, mk, /find nothing/i)) searched = true;
            if (process.env.IKOV_DEBUG) L(`  chest ${c.x},${c.z} try ${k}: fresh=${fresh} ev=${JSON.stringify(ev.get(key))} reached=${reached()} searched=${searched} msgs=${JSON.stringify(msgsSince(bot, s0 - 2))}`);
        }
        if (!searched) { L(`chest ${c.x},${c.z}: no result after 4 tries`); pending.delete(pick); continue; }
        searches++;
        cur = pick;
        if (found) {
            finds++; pending = new Set(CHESTS.map((_, i) => i));
            L(`chest ${c.x},${c.z}: +${have()} total (search ${searches}, find ${finds})`);
        } else pending.delete(pick);
    }
    if (bot.chatModalId !== -1) dismiss(bot);
    L(`chests: ${have()} ice arrows, ${searches} searches, ${finds} finds, ${bot.tickCount - t0} t`);
}

/** A chest we saw open less than 280 t ago (it closes after 300 t, chests.rs2:69). */
function isFreshOpen(e: { id: number; tick: number } | undefined, now: number): boolean { return !!e && e.id === 104 && now - e.tick < 280; }

/** Fallback: from the Fire Warrior's corridor back to the chests (trap door, door of fear south, south gate) for `more`
 *  arrows, then back to his door. */
async function refillArrows(bot: SpeedBot, more: number, L: (s: string) => void): Promise<void> {
    if (bot.isPrayerActive('protectfrommagic')) { (bot as any).setPrayer('protectfrommagic', false); bot.queueFlush(); }
    const tDoor = locHere(92, 2648, 9857);
    if (bot.tile().z >= 9858) await walkOp(bot, { x: 2648, z: 9858 }, () => bot.opLoc(tDoor.x, tDoor.z, tDoor.id, 1), () => bot.tile().z <= 9857, { maxTicks: 60 });
    await passGate(bot, 95, 2661, 9815, () => !northSide(bot.tile()), T.fearN, 'door of fear south (refill)');
    await passGate(bot, 89, 2662, 9803, () => southSide(bot.tile()), T.southN, 'south gate (refill)');
    if (wornCount(bot, O.ice) > 0) await unwear(bot, O.ice);
    await searchChests(bot, bot.count(O.ice) + more, L);
    await passGate(bot, 89, 2662, 9803, () => !southSide(bot.tile()), { x: 2662, z: 9802 }, 'south gate back (refill)');
    await passGate(bot, 95, 2661, 9815, () => northSide(bot.tile()), T.fearS, 'door of fear north (refill)');
    await walkOp(bot, T.trapDoorS, () => bot.opLoc(tDoor.x, tDoor.z, tDoor.id, 1), () => bot.tile().z >= 9858, { maxTicks: 200 });
}

/** Re-wield ice arrows from the pack, else pick them up from the floor within `r`. */
async function rearm(bot: SpeedBot, r: number): Promise<boolean> {
    if (bot.count(O.ice) > 0) { await wear(bot, ['ice_arrow']); return true; }
    const g = groundOf(bot, O.ice, r);
    if (!g) return false;
    const n0 = bot.count(O.ice);
    await retry(bot, () => pickupGo(bot, O.ice, g), () => bot.count(O.ice) > n0, 10, 3);
    if (bot.count(O.ice) > 0) await wear(bot, ['ice_arrow']);
    return wornCount(bot, O.ice) > 0;
}

/** Spawn the Fire Warrior at his door, then shoot him (ice arrows worn, rapid), recollecting arrows when the quiver runs dry. */
export async function fireWarrior(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (!(await wear(bot, ['yew_shortbow', 'ice_arrow']))) fail(bot, 'wield the yew shortbow + ice arrows (ranged 40?)');
    for (let k = 0; k < 6 && bot.combatStyle() !== 1; k++) { bot.setCombatStyle('combat_bow', 'rapid'); bot.queueFlush(); await bot.tick(1); }
    const fwDoor = locHere(93, 2646, 9870);
    const t0 = bot.tickCount;
    // the door op spawns him (if none within 5 tiles) and pushes us back south (ikov_dungeon.rs2:186-219)
    // session 11 fix 355 (qx161m + qx163m 'Fire Warrior did not appear @ (2646,9871)', both retried OK from journal section 7): the
    // 1st fight threw 'out of ice arrows' while the LAST arrow was still in flight (worn 0, nothing on the floor yet) and it killed
    // him -> %ikov 40 (fire_warrior_of_leskarus.rs2 queue_defeat_fire_warrior). After a ~300 t chest trip his door no longer spawns
    // him: at %ikov >= 40 it just lets us through (ikov_dungeon.rs2:177-181) and we waited at (2646,9871) for nobody. 355a: the
    // door passing us north = he is dead: return. 355b (fight loop): out of arrows -> give the in-flight arrow 10 t first.
    // IK_FW_DEAD=0 reverts both.
    const fwDead = process.env.IK_FW_DEAD !== '0';
    if (!npc(bot, NPC.warrior)) await walkOp(bot, T.fwDoorS, () => bot.opLoc(fwDoor.x, fwDoor.z, fwDoor.id, 1), () => !!npc(bot, NPC.warrior) || (fwDead && bot.tile().z >= 9871), { maxTicks: 60 });
    if (fwDead && !npc(bot, NPC.warrior) && bot.tile().z >= 9871) { L('fix 355: his door let us through (%ikov >= 40): the Fire Warrior is already dead'); return; }
    if (!npc(bot, NPC.warrior)) fail(bot, 'Fire Warrior did not appear');
    await bot.tick(3);
    const prayOk = bot.stat('prayer').cur > 0 && bot.stat('prayer').level >= 37;
    let lastAtk = -100, killed = false;
    const won = () => msgsSince(bot, t0).length >= 0 && !npc(bot, NPC.warrior) && bot.tickCount - t0 > 5;
    while (bot.tickCount - t0 < 600) {
        if (dead(bot)) fail(bot, 'killed by the Fire Warrior');
        eatIfLow(bot);
        if (prayOk && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommagic')) { bot.activatePrayer('protectfrommagic'); bot.queueFlush(); }
        if (bot.chatModalId !== -1 && !bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); }
        const w = npc(bot, NPC.warrior);
        if (!w) { killed = true; break; }
        if (wornCount(bot, O.ice) === 0) {
            // fix 355b: the last arrow may still be in flight - let it land (he dies, or arrows drop under him) before giving up
            if (fwDead && !bot.count(O.ice) && !groundOf(bot, O.ice, 8)) await bot.until(() => !npc(bot, NPC.warrior) || !!groundOf(bot, O.ice, 8), 10);
            if (fwDead && !npc(bot, NPC.warrior)) { killed = true; break; }
            if (!(await rearm(bot, 8))) fail(bot, `out of ice arrows (none worn, none on the floor) after ${bot.tickCount - t0} t`);
            lastAtk = -100;
        }
        if (bot.tickCount - lastAtk >= 8) { bot.opNpc(w.idx, 2); bot.queueFlush(); lastAtk = bot.tickCount; }
        await bot.tick(1);
    }
    if (!killed) fail(bot, 'Fire Warrior fight timed out');
    if (bot.isPrayerActive('protectfrommagic')) { (bot as any).setPrayer('protectfrommagic', false); bot.queueFlush(); }
    L(`Fire Warrior dead in ${bot.tickCount - t0} t`);
    // collect the arrows he stood on (Lucien needs a few)
    for (let k = 0; k < 4; k++) {
        const g = groundOf(bot, O.ice, 8); if (!g) break;
        const n0 = bot.count(O.ice);
        await retry(bot, () => pickupGo(bot, O.ice, g), () => bot.count(O.ice) > n0 || !groundOf(bot, O.ice, 8), 10, 3);
    }
    if (bot.count(O.ice) > 0) await wear(bot, ['ice_arrow']);
    void won;
}

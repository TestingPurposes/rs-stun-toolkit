// q-fishing-contest.ts — Fishing Contest (1 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// Verified flow (paths relative to server/content/scripts/; %fishingcompo stages quest_fishingcompo.constant):
//   1. Mountain dwarf (232, 2820,3487, west tunnel of White Wolf Mountain): "I was just wondering what was down those
//      stairs?" -> "Why not?" -> "If you were my friend I wouldn't mind." -> "Well, let's be friends!" -> "And how am I
//      meant to do that?" -> "Fortunately I'm alright at fishing!" -> %fishingcompo 1 + competition pass
//      (areas/area_white_wolf_mountain/scripts/mountain_dwarf.rs2:8-79).
//   2. McGrubor's Wood: squeeze through the loose railing (loc 51, 2662,3500), dig a red vine (2627-2631,3492-3499)
//      with a spade -> red vine worm (areas/area_seers/scripts/mcgrubors_wood.rs2:12-48).
//   3. Hemenster gate (loc 48, 2642,3441): Morris lets a pass holder in (quest_fishingcompo.rs2:22-44). Garlic in the
//      wall pipe (loc 41, 2636-2638,3446) BEFORE entering sets %hemenster_pipe_stashed (:75-94), so Bonzo's place
//      assignment moves the Sinister Stranger at once and gives us his spot by the pipes: %fishingcompo 3
//      (hemenster/bonzo.rs2:1-45, quest_fishingcompo.rs2:96-106).
//   4. Fish the Sinister spot (npc 234, 2637,3444) with the worm: a giant carp (hemenster_fishing.rs2:26-45,55-101).
//      One fish is enough: Bonzo's "how are you doing" hands the catch over after the first fish, and any giant carp
//      wins the trophy (bonzo.rs2:47-70).
//   5. Camelot teleport, the dwarf takes the trophy -> complete: 1 QP, stat_advance fishing 24370 (tenths)
//      (mountain_dwarf.rs2:91-102, quest_fishingcompo.rs2:108-112).
import type { SpeedBot } from '../../../core.js';
import { nav, inDialog, locAt, tele, npc, opNpcGo, qp } from '../../q-lib.js';
import { runQuest, talkNpc, chat, heard, fail, checkAlive, opLocUntil, useOnLocUntil, type Item, type RunResult } from './ka-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Fishing Contest', dir: 'quest_fishingcompo', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        fishing: [10, 'Hemenster spots (hemenster_fishing.rs2:70, stat(): boostable)'],
        magic: [45, 'Camelot Teleport back to the dwarf'],
    } as Record<string, [number, string]>,
    start: { x: 2757, z: 3478, level: 0 },   // Camelot teleport landing
    end: { x: 2820, z: 3487, level: 0 },     // the mountain dwarf
};
export const SUPPLY: Item[] = [
    { name: 'garlic', n: 1 },       // the pipe (quest_fishingcompo.rs2:75-94)
    { name: 'spade', n: 1 },        // red vine worm (mcgrubors_wood.rs2:35)
    { name: 'fishing_rod', n: 1 },  // hemenster_fishing.rs2:83
    { name: 'coins', n: 5 },        // Bonzo's fee (bonzo.rs2:24-31)
    { name: 'lawrune', n: 2 }, { name: 'airrune', n: 10 },   // Camelot Teleport x2
];

declare const process: { env: Record<string, string | undefined> };
const DWARF = 232, BONZO = 225, SINISTER_SPOT = 234;
const DWARF_AT = { x: 2820, z: 3487 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    return runQuest(bot, QUEST, async st => {
        await nav();
        const has = (n: string) => bot.count(n) > 0;
        // session 10: on a retry / resume, the contest stage from the quest JOURNAL (fishingcompo_journal.rs2) + the items held:
        // the steps behind them are skipped. 0 on a fresh attempt. FISHC_RESUME=0 reverts.
        const at = (k: string) => { st.at(k); failHook(k); };
        let js = 0;   // 1 pass, 2 entered (the garlic spot), 3 won
        if (isResuming(bot) && process.env.FISHC_RESUME !== '0') {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            js = await journalStage<number>(bot, 'fishingcompo', [[/QUEST COMPLETE/i, 4], [/take the Trophy back/i, 3], [/next to the pipes|next to the willow/i, 2], [/gave me a Fishing Contest Pass/i, 1]], 0, s => console.log(`[fc] ${s}`));
            if (js >= 4) return;
        }
        const pastWood = () => js >= 1 && (has('red_vine_worm') || js >= 2 || has('raw_giant_carp') || has('hemenster_fishing_trophy'));
        if (js === 0 && bot.free() < 3) fail(bot, `need 3 free slots (pass, worm, carp/trophy), have ${bot.free()}`);
        // 1. mountain dwarf: the pass
        if (js < 1 || !has('fishing_competition_pass') && js < 2) if (!(await talkNpc(bot, DWARF, DWARF_AT, [/^I was just wondering what was down those stairs/, /^Why not\?/, /^If you were my friend/,
            /^Well, let's be friends/, /^And how am I meant to do that/, /^Fortunately I'm alright at fishing/], () => has('fishing_competition_pass') && !inDialog(bot), { label: 'dwarf1' }))) fail(bot, 'dwarf (pass)');
        at('pass');
        if (!pastWood()) {
        // A/B: Camelot Teleport then 114 tiles to the railing vs walking 183 from the dwarf (navgrid lengths)
        if (process.env.FC_NOTELE !== '1') { if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); } if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport 1'); }
        // 2. McGrubor's Wood: railing in, dig a red vine, railing out
        const railing = locAt(51, 2662, 3500, 0), vine = locAt(58, 2631, 3498, 0);
        // the railing (west edge of 2662,3500) is entered from its WEST side (2661,3500; the planner reaches the east side
        // only through the locked forester gate), the vines lie in the wood east of it
        let tr = bot.tickCount;
        const squeezed = (east: boolean) => () => heard(bot, /squeeze through the loose railing/, tr) && (east ? bot.tile().x >= 2662 : bot.tile().x <= 2661) && Math.abs(bot.tile().z - 3500) <= 1;
        if (!(await opLocUntil(bot, railing, 1, squeezed(true), { maxTicks: 300, every: 6, stand: { x: 2661, z: 3500 } }))) fail(bot, 'railing in');
        if (!(await opLocUntil(bot, vine, 1, () => has('red_vine_worm'), { maxTicks: 60, every: 6 }))) fail(bot, 'red vine worm');
        at('worm');
        tr = bot.tickCount;
        if (!(await opLocUntil(bot, railing, 1, squeezed(false), { maxTicks: 80, every: 6, stand: { x: 2662, z: 3500 } }))) fail(bot, 'railing out');
        }
        // 3. gate (Morris), garlic in the pipe BEFORE paying Bonzo, then Bonzo
        const gate = locAt(48, 2642, 3441, 0);
        let t = bot.tickCount;
        if (!(await opLocUntil(bot, gate, 1, () => inDialog(bot) || bot.tile().x <= 2642, { maxTicks: 200, every: 8 }))) fail(bot, 'Hemenster gate');
        await chat(bot, [], () => bot.tile().x <= 2642 && !inDialog(bot), { label: 'morris', maxTicks: 20 });
        if (bot.tile().x > 2642) fail(bot, 'Morris did not let us in');
        at('hemenster');
        const pipe = locAt(41, 2638, 3446, 0);   // the east pipe: its tile is walkable ((2637,3446) is not)
        // wall decoration (shape 5) on the pipe tile's own edge: stand on its tile (from the next tile the OPLOCU is dropped)
        if (!(js >= 1 && !has('garlic')) && !(await useOnLocUntil(bot, 'garlic', pipe, () => !has('garlic') && heard(bot, /stash the garlic/, t), { maxTicks: 60, every: 6, stand: { x: 2638, z: 3446 } }))) fail(bot, 'garlic pipe');
        t = bot.tickCount;
        // session 11 fix 377b (qx268m 'Bonzo entry' twice -> STOPPED: try 1 paid + stashed, but move_hemenster_pipe finds the
        // Sinister Stranger only within 8 tiles of US (quest_fishingcompo.rs2:97; he wanders +-5 around 2637,3440, we talk from
        // 2642,3439) -> no spot, %fishingcompo stays 1; try 2 re-stashed the re-withdrawn garlic with the fee paid -> %fishingcompo 3
        // at once (rs2:90-93), so Bonzo only asks 'how are you doing' (bonzo.rs2:9-11,47-51)). Accept that answer; paid but no
        // spot -> click the Sinister spot from beside him: in_hemenster_comp re-runs bonzo_set_places from there
        // (hemenster_fishing.rs2:110-114). FC_377B=0 reverts. TEST: FC_377B_TEST=1 closes Bonzo's dialog after the fee, before
        // the spot (= try 1's state); =2 also fails the attempt (the route retry = try 2's path).
        const fix377b = process.env.FC_377B !== '0', test377 = !isResuming(bot) ? process.env.FC_377B_TEST : undefined;
        const placed = () => heard(bot, /beside the pipes|take the area by the pipes/, t) || (fix377b && heard(bot, /still be able to find a bigger fish/, t));
        const paid = () => heard(bot, /nearly everyone is in their place/, t);
        if (js < 2) {
            await talkNpc(bot, BONZO, { x: 2641, z: 3439 }, [/^I'll enter the competition please/], () => placed() || (!!test377 && paid()), { label: 'bonzo1' });
            if (test377 && paid() && !placed()) {
                bot.closeModal(); bot.queueFlush(); await bot.tick(1);
                console.log(`[fc] 377b TEST ${test377}: closed Bonzo after the fee, before the spot (%fishingcompo 1)`);
                if (test377 === '2') fail(bot, 'Bonzo entry (377b TEST 2)');
            }
            if (!placed()) {
                if (!fix377b || !paid()) fail(bot, 'Bonzo entry');
                for (let k = 0; k < 6 && !placed(); k++) {
                    checkAlive(bot);
                    if (inDialog(bot)) { await chat(bot, [], () => placed() || !inDialog(bot), { label: 'fc 377b spot', maxTicks: 30 }); continue; }
                    const s = npc(bot, SINISTER_SPOT);
                    if (!s) { await bot.tick(2); continue; }
                    opNpcGo(bot, s, 1);
                    await bot.until(() => inDialog(bot) || placed(), 15);
                }
                console.log(`[fc] fix 377b: paid, no spot from Bonzo -> Sinister spot: ${placed() ? 'pipes assigned' : 'still none'}`);
                if (!placed()) fail(bot, 'Bonzo entry (377b: paid, no spot)');
            }
        }
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        at('entered');
        // 4. one giant carp on the Sinister spot, hand it to Bonzo
        for (let k = 0; k < 6 && !has('raw_giant_carp') && !has('hemenster_fishing_trophy'); k++) {
            checkAlive(bot);
            const s = npc(bot, SINISTER_SPOT);
            if (!s) { await bot.tick(1); continue; }
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            opNpcGo(bot, s, 1);
            await bot.until(() => has('raw_giant_carp') || inDialog(bot), 10);
        }
        if (!has('raw_giant_carp') && !has('hemenster_fishing_trophy')) fail(bot, 'giant carp');
        at('carp');
        if (!(await talkNpc(bot, BONZO, { x: 2641, z: 3439 }, [], () => has('hemenster_fishing_trophy'), { label: 'bonzo2' }))) fail(bot, 'Bonzo trophy');
        at('trophy');
        // 5. Camelot teleport, the dwarf
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport');
        const qp0 = qp(bot);
        if (!(await talkNpc(bot, DWARF, DWARF_AT, [/^Yes I have/], () => qp(bot) >= qp0 + QUEST.qp, { label: 'dwarf2', closedTicks: 6 }))) fail(bot, 'dwarf (trophy)');
        at('done');
    }, o.log !== false);
}

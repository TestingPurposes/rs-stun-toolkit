/// <reference types="bun" />
// q-the-tourist-trap.ts — THE TOURIST TRAP, cheat-free. Lane south (max-QP route).
//
// Content (rev 289, quests/quest_desertrescue/scripts/ unless noted; Q = quest_desertrescue.rs2). %desertrescue is NOT
// transmitted: every step is gated on items, position and dialog/game text.
//  1. Irena (3303,3113): "What's the matter?" -> "Is there a reward if I get her back?" -> "Okay Irena, calm down..." (irena.rs2).
//  2. Shantay doorway (3302,3116) op1 with a pass: poster "Yeah, that poster doesn't scare me!" (shantay_pass.rs2:60-105).
//  3. Mercenary Captain (3270,3029): talking sets 'approached' (mercenary_captain.rs2:15); "Wow! A real captain!" -> "I'd love
//     to work for a tough guy like you!" -> "Can't I do something for a strong Captain like you?" -> "Sorry Sir, I don't think I
//     can do that." -> "It's a funny captain who can't fight his own battles!" -> he fights (npc_retaliate, :60-67). The kill
//     puts the metal key in the pack (:203-215). Clicking Attack instead only calls his guards (:218-241).
//  4. Camp gate (3273,3028-3029) op1 with the metal key; no weapon (pickaxe ok) or armour worn near a guard (Q:119-186).
//  5. Mining slave (surface): "I've just arrived." -> "Oh yes, that sounds interesting." -> "What's that then?" -> "I can try
//     to undo them for you." -> "It's funny you should say that..." -> "Yeah, okay, let's give it a go."; pick
//     stat_random(thieving,20,250), a 3rd+ fail with a mercenary within 10 = jail (mining_slave.rs2:108-143); "Yes, I'll
//     trade." swaps the WORN desert shirt/robe/boots for worn slave clothes (:145-200).
//  6. Mine doors (3301,3036) op1 in the full slave outfit -> underground (Q:417-445). Cave guard (zone 3274-3284,9413-9423):
//     "I'd like to mine in a different area." -> "Yes sir, you're quite right sir." (camp_guard.rs2:16,108-120).
//  7. Out (exit doors 3278,9426), slave clothes OFF before the gate (leaving in any slave item near a guard = caught, Q:96-103),
//     Al Shabim (3171,3025): "I am looking for a pineapple." -> "Yes, I'm interested." = Bedobin key (al_shabim.rs2:117-140).
//  8. Back in the camp: ladder (3290,3036) up; bookcase (3284,3032) op2 = sailing bit (Q:350-352); Captain Siad: "I wanted to
//     have a chat?" -> "You seem to have a lot of books!" -> "So, you're interested in sailing?" -> "I could tell by the cut of
//     your jib." = distracted (captain_siad.rs2); chest (3292,3033) op1 with the key = plans (Q:308-345).
//  9. Al Shabim: plans on him -> "Yes, I'm very interested." -> "Yes, I'm kind of curious." (needs a bronze bar + 10 feathers,
//     al_shabim.rs2:81-90,168-186). Tent door (3169,3046) op1 with the plans (bedabin_nomad_guard.rs2:42-75). Anvil (3171,3048):
//     bronze bar -> "Yes, I'd like to try." (smithing 20, stat_random(smithing,61,245), a fail eats the bar, Q:577-632);
//     feathers on the tip (fletching 10, stat_random(fletching,61,254), a fail eats 10 feathers, Q:643-672). Dart on Al
//     Shabim = darts + Tenti pineapple (al_shabim.rs2:42-74).
// 10. Camp, slave outfit on, mine: the cave guard takes the pineapple by itself on talk (camp_guard.rs2:12-13,147-153).
//     Empty barrel (3290,9422) op2 "Yeah, cool!" (Q:741-778). Cave (3281,9414) op1 east (Q:471-488). Mine cart (3303,9417)
//     op2 "Yes, of course." stat_random(agility,100,250) (Q:805-835) -> (3319,9431). Barrel on Ana (3302,9466) (ana.rs2:56-90).
//     Ana-barrel on the cart (3318,9430) (Q:837-850). Cart back. Search an empty barrel within 3 of (3303,9417) = Ana (Q:744-760).
//     Winch guard (3292,9423): "Yes please." -> "I said you were very gregarious!" (camp_guard.rs2:180-210).
// 11. Out (cave west, exit doors). Surface winch (3279,3017) op2, full barrel (3278,3017) op2 = Ana (Q:715-726,880-895).
//     Barrel on the cart loc_2682 (3287,3023) (Q:392-400). Cart driver (3287,3022): "Nice cart." -> "One wagon wheel..." ->
//     "'One good turn deserves another'" -> "Fired... no, shot perhaps!" -> "In for a penny in for a pound." -> "Well, you see,
//     it's like this..." -> "Prison riot in ten minutes, get your cart out of here!" -> "You can't leave me here, I'll get
//     killed!" (mine_cart_driver.rs2). Cart op2 "Yes, I'll get on." -> (3258,3029) holding Ana (Q:354-371).
// 12. Shantay doorway op1 with Ana = rescued (shantay_pass.rs2:65-68, Q:896-900); Ana -> Irena's reward: two of Fletching /
//     Agility / Smithing / Thieving, 4,650 base xp each (irena.rs2:74-92).
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { nav, talk, R, qp, opNpcGo, opLocGo, walkOp, inDialog, dismiss, log as qlog, trace, npcsOf, npc } from '../../q-lib.js';
import {
    fail, dead, locHere, liveId, retry, opLocUntil, useOnLocUntil, wear, unwear, eatIfLow, talkTo, chatMark, chatSince,
    textLog, textMark, sawText, type Item, type Tile,
} from './south-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'The Tourist Trap', dir: 'quest_desertrescue', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        smithing: [20, 'experimental anvil: stat(smithing) >= 20 (quest_desertrescue.rs2:603)'],
        fletching: [10, 'prototype dart: stat(fletching) >= 10 (quest_desertrescue.rs2:656)'],
        thieving: [1, 'optional: the slave lock is stat_random(thieving,20,250) (mining_slave.rs2:111); proven at 51'],
        agility: [1, 'optional: the mine cart is stat_random(agility,100,250) (quest_desertrescue.rs2:822)'],
        hitpoints: [1, 'optional: keep COMBAT LEVEL >= 87: the Rowdy Guard in the camp hunts (cowardly, huntrange 1, desertrescue.npc) every player not above 2x its level 43 (all.hunt [cowardly] check_nottoostrong) and killed a combat-62 proof run (sott5); proven at att/str 83, def 60, hp 80, prayer 43'],
    } as Record<string, [number, string]>,
    start: { x: 3303, z: 3119, level: 0 },     // Al Kharid side of the Shantay Pass doorway (Irena stands just south of it)
    end: { x: 3305, z: 3114, level: 0 },
};
/** Tradeable inputs (quest items are all tradeable=no, desertrescue.obj). Desert clothes go on at the start (heat +40 t,
 *  desert_heat.rs2) and are traded worn. 3 bronze bars / 30 feathers cover the anvil and fletching rolls. */
// session 11 fix 363 (qx185m + qt44m 'anvil: out of bronze bars', STOPPED qp 17: 3 of 3 rolls failed; the bar goes before
// stat_random(smithing,61,245), quest_desertrescue.rs2:612-623. Sim tally of 259 runs: 1 bar 193, 2 bars 48, 3 bars 16 (incl.
// the 2 fails) = ~25% a fail, ~1.6% all 3; the tent retry resumes in place with no bank, the Shantay Pass is behind us): 5 bars
// (all fail ~0.1%), prep pack 21 -> 23 slots. TT_BARS=3 reverts.
export const SUPPLY: Item[] = [
    { name: 'shantay_pass', n: 1 }, { name: 'desert_shirt', n: 1 }, { name: 'desert_robe', n: 1 }, { name: 'desert_boots', n: 1 },
    { name: 'rune_scimitar', n: 1 }, { name: 'bronze_bar', n: Number(process.env.TT_BARS ?? 5) }, { name: 'feather', n: 30 }, { name: 'hammer', n: 1 },
    { name: 'water_skin4', n: 2 }, { name: 'shark', n: 3 },
];
/** Irena's two skill picks (env TT_PICKS="agility,thieving"; default: see STATUS.md "Tourist Trap picks"). */
const PICKS = (process.env.TT_PICKS ?? 'agility,thieving').split(',').map(s => s.trim().toLowerCase());

const O = {
    pass: objId('shantay_pass'), dShirt: objId('desert_shirt'), dRobe: objId('desert_robe'), dBoots: objId('desert_boots'),
    sShirt: objId('slave_shirt'), sRobe: objId('slave_robe'), sBoots: objId('slave_boots'), weapon: objId('rune_scimitar'),
    key: objId('metal_key'), bkey: objId('thbedobinkey'), plans: objId('thcaptplans'), tip: objId('thprotodarttip'), dart: objId('thprotodart'),
    pine: objId('tentipineapple'), barrel: objId('thminebarrel_empty'), ana: objId('thanainabarrel'), bar: objId('bronze_bar'),
    feather: objId('feather'), hammer: objId('hammer'),
};
const N = {
    irena: 835, captain: 830, slave: 825, merc1: 828, merc2: 829, siad: 831, shabim: 832, ana: 822, driver: 841,
};
const L = {
    doorway: { id: 4031, x: 3302, z: 3116 }, gateL: { id: 2673, x: 3273, z: 3029 }, gateR: { id: 2674, x: 3273, z: 3028 },
    mineIn: { id: 2675, x: 3301, z: 3036 }, mineOut: { id: 2690, x: 3278, z: 9426 }, ladderUp: { id: 1747, x: 3290, z: 3036 },
    ladderDown: { id: 1746, x: 3290, z: 3036 }, bookcase: { id: 2678, x: 3284, z: 3032 }, chest: { id: 2677, x: 3292, z: 3033 },
    tent: { id: 2700, x: 3169, z: 3046 }, anvil: { id: 2672, x: 3171, z: 3048 }, emptyBarrel: { id: 2681, x: 3290, z: 9422 },
    caveE: { id: 2699, x: 3281, z: 9415 }, caveW: { id: 2698, x: 3283, z: 9415 }, cartLow: { id: 2684, x: 3303, z: 9417 },
    cartHigh: { id: 2684, x: 3318, z: 9430 }, lowBarrel: { id: 2681, x: 3303, z: 9418 }, winch: { id: 2667, x: 3279, z: 3017 },
    fullBarrel: { id: 2680, x: 3278, z: 3017 }, escapeCart: { id: 2682, x: 3287, z: 3023 },
};
const T = {
    irena: { x: 3303, z: 3112 }, captain: { x: 3268, z: 3029 }, campIn: { x: 3275, z: 3028 }, campOut: { x: 3271, z: 3028 },
    slaves: { x: 3297, z: 3020 }, shabim: { x: 3171, z: 3027 }, caveGuard: { x: 3279, z: 9418 }, ana: { x: 3302, z: 9464 },
};
const inCamp = (t: Tile) => t.x >= 3274 && t.x <= 3310 && t.z >= 3010 && t.z <= 3045 && t.z < 4000;
const underground = (t: Tile) => t.z > 9000;
/** route resumeHere: in the desert camp area, the Bedabin camp or the mine (a retry must not travel back to the Shantay Pass) */
// 317b: + the desert side of the Shantay Pass (z <= 3115): a retry from there must not leave (the pass is spent, qx79m)
export const inQuestArea = (t: Tile) => (t.x >= 3150 && t.x <= 3330 && t.z >= 2990 && t.z <= 3060) || (t.x >= 3280 && t.x <= 3320 && t.z > 3060 && t.z <= 3115) || (underground(t) && t.x >= 3260 && t.x <= 3330 && t.z >= 9400 && t.z <= 9480);

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    const t0 = bot.tickCount, qp0 = qp(bot);
    bot.holdDialogs = true;
    trace(bot, t0);
    const Lg = (s: string) => { if (o.log !== false) qlog(bot, t0, `${s} | hp ${bot.stat('hitpoints').cur} at ${bot.tile().x},${bot.tile().z}`); };
    textLog(bot);
    let stepMark = 0;
    const step = () => { stepMark = textMark(bot); };
    const seen = (re: RegExp) => sawText(bot, re, stepMark);
    const loc = (l: { id: number; x: number; z: number }, level = 0) => locHere(l.id, l.x, l.z, level);
    const useOnNpc = (type: number, obj: number) => () => { const n = npc(bot, type); if (!n || inDialog(bot)) return; opNpcGo(bot, n, 1); bot.useItemOnNpc(n.idx, obj, bot.slot(obj)); };
    const walk = async (t: Tile, label: string, near = 1, maxTicks = 600) => {
        if (!(await walkOp(bot, t, null, () => cheb(bot.tile(), t) <= near, { near, maxTicks }))) fail(bot, `${label}: walk to (${t.x},${t.z})`);
    };
    // background: eat at 50%; TT_HPLOG=1 logs every hp loss with the npcs next to us (diagnostic)
    (async () => { let hp = bot.stat('hitpoints').cur; while (!bot.disposed) { eatIfLow(bot); const h = bot.stat('hitpoints').cur;
        if (process.env.TT_HPLOG && h < hp) Lg(`HP -${hp - h} near ${npcsOf(bot, [...Array(4000).keys()]).filter(q => q.d <= 2).map(q => bot.npcName(q.type)).join(',') || '-'}`);
        hp = h; await bot.tick(1); } })();
    // session 10 (allchaos qu21m/qu08m: every retry restarted at Irena and died at 'siad chest: no plans'): on a retry the
    // quest JOURNAL picks the step (desertrescue_journal.rs2); TT_RESUME=0 = from the top. S: 0 captain .. 9 finish, 10 done
    let S = 0, anaCaught = false;   // anaCaught: the journal says Ana is in her barrel already (no new empty barrel)
    if (isResuming(bot) && process.env.TT_RESUME !== '0') {
        dismiss(bot);
        const st = await journalStage<string>(bot, 'desertrescue', [
            [/QUEST COMPLETE/i, 'done'], [/talk to Irena at the shantay pass for my reward/i, 'reward'], [/get Ana \(and her barrel\) out/i, 'ana'],
            [/find some way of getting Ana out|Ana is down here somewhere/i, 'lift'], [/Now I have a pineapple|misplaced it/i, 'pine'],
            [/made a prototype dart|made the prototype dart tip|prototype of the new secret throwing weapon/i, 'dart'],
            [/if I can steal the\s+plans/i, 'plans'], [/Tenti' pineapple somehow/i, 'key'], [/head deeper into the mine|head into the mine and look for Ana/i, 'guard1'],
            [/inside a desert mining camp|look around this desert mining camp|locks on the slave|trade my desert robes/i, 'camp'],
        ], 'start', s2 => Lg(s2));
        const me = bot.tile();
        S = st === 'done' ? 10 : st === 'reward' ? 9 : st === 'ana' ? (bot.count(O.ana) > 0 && !inCamp(me) && !underground(me) ? 9 : underground(me) ? 7 : 8)
            : st === 'lift' ? 7 : st === 'pine' ? (bot.count(O.pine) > 0 ? 6 : 5) : st === 'dart' ? 5 : st === 'plans' ? (bot.count(O.plans) > 0 ? 5 : 4)
            : st === 'key' ? 3 : st === 'guard1' ? 2 : st === 'camp' ? 1 : 0;
        anaCaught = st === 'ana';
        Lg(`resume at step ${S} (${st})`);
        if (S >= 10) return { ok: true, ticks: bot.tickCount - t0, msg: 'journal: quest complete' };
    }
    try {
        // ---- 0. pack: drop what the quest will not use (the barrel steps need free slots)
        const keep = new Set([...SUPPLY.map(i => objId(i.name)), ...Object.values(O), ...['water_skin3', 'water_skin2', 'water_skin1', 'water_skin0', 'thshantaydisc', 'bronze_dart'].map(n => objId(n)),
            // route runner: keep the travel kit (teleport runes, glory, coins): the route teleports out after TT
            ...['lawrune', 'airrune', 'waterrune', 'earthrune', 'firerune', 'coins', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'].map(n => objId(n))]);
        const junk = [...new Set(bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj))];
        if (junk.length) { Lg(`dropping ${junk.map(objDebugName).join(',')}`); await bot.dropAll(junk); }
        if (S <= 1 && !bot.isWorn(O.sShirt)) await wear(bot, ['desert_shirt', 'desert_robe', 'desert_boots']);

        // ---- 1. into the desert (Irena stands just SOUTH of the doorway, shantay_pass.rs2:69-74 = the desert side)
        if (S === 0 && bot.tile().z > 3116) {
            await opLocUntil(bot, loc(L.doorway), 1, () => inDialog(bot) || bot.tile().z <= 3115, 30, 6);
            step(); await talk(bot, [], [], { noOp: true, done: () => bot.tile().z <= 3115 && !inDialog(bot), answers: [/doesn't scare me/i], maxTicks: 40, label: 'shantay' });
            if (bot.tile().z > 3115) fail(bot, 'shantay doorway');
            dismiss(bot);
        }
        // ---- 2. Irena
        if (S === 0) {
        step(); await talkTo(bot, N.irena, [], { done: () => seen(/She was wearing a red silk scarf/i) && !inDialog(bot), at: T.irena,
            answers: [/^What's the matter\?/i, /Is there a reward if I get her back/i, /Okay Irena, calm down/i], maxTicks: 60, label: 'irena', tries: 4 });
        dismiss(bot); Lg('started'); failHook('started');
        }
        // ---- 3. Mercenary Captain -> metal key
        if (S <= 6) await captain();
        // ---- 4..6 camp, slave, mine, cave guard
        if (S <= 2) {
        await enterCamp('camp 1');
        await freeSlave();
        await intoMine('mine 1');
        // session 11 fix 283 (TT_GUARD_FIX; qx39m + qx40m 'siad chest: no plans', then STOPPED). CONFIRMED from the logs +
        // scripts: the cave guard talk NEVER happened. Right after the mine entry the bot stood in the corridor north of the
        // entry (3281,9438; the direct OPNPC route parks there, the guard is ~80 tiles round the west loop), walkOp to the
        // guard said 'no route', the next tries picked the NEAREST mercenary 829 = the cell guard (3293,9434) / the winch
        // guard (3290,9424), talkTo ran out WITHOUT failing and 'cave guard: pineapple wanted' was logged anyway. %desertrescue
        // stayed entered_mine (journal 'head deeper into the mine'), so Al Shabim offered 'Al Zaba Bhasim' (240 t, no key),
        // and Siad's chest without the key (no distraction bit) only opened Siad's 'What are you doing in here?' menu.
        // Fix: walk into the cave guard's zone first (camp_guard.rs2: 0_51_147_10_5..20_15 = x3274-3284 z9413-9423; via the
        // entry tile, walkOp walls the refused door step and closes leaves), so the nearest 829 IS the cave guard; 3 rounds;
        // fail honestly if he never said it (the journal retry resumes at step 2) and check the Bedobin key the same way.
        const fix283 = process.env.TT_GUARD_FIX !== '0';
        const guardDone = () => seen(/I'm sure you get my meaning/i) && !inDialog(bot);
        const inGuardRoom = () => { const t = bot.tile(); return t.x >= 3274 && t.x <= 3284 && t.z >= 9413 && t.z <= 9423; };
        // TEST: TT_GUARD_TEST=1 first walks into the corridor north of the entry (3281,9438), where qx39m/qx40m stood
        if (process.env.TT_GUARD_TEST === '1') { const c = { x: 3281, z: 9438 }; await walkOp(bot, c, null, () => cheb(bot.tile(), c) <= 1, { near: 1, maxTicks: 40 }); Lg(`TEST: in the corridor at ${bot.tile().x},${bot.tile().z}`); }
        step();
        for (let r = 0; r < (fix283 ? 3 : 1) && !guardDone(); r++) {
            if (fix283 && !inGuardRoom()) {
                dismiss(bot);
                if (!underground(bot.tile())) await intoMine('mine 1 (283)');   // a door op on the way out of the mine
                const entry = { x: 3278, z: 9427 };
                if (bot.tile().z > 9427 && cheb(bot.tile(), entry) > 1) await walkOp(bot, entry, null, () => cheb(bot.tile(), entry) <= 1, { near: 1, maxTicks: 40 });
                const w = await walkOp(bot, T.caveGuard, null, () => inGuardRoom() && cheb(bot.tile(), T.caveGuard) <= 3, { near: 2, maxTicks: 250 });
                Lg(`283 cave guard walk (round ${r + 1}): ${w}, in the room ${inGuardRoom()}`);
            }
            await talkTo(bot, N.merc2, [], { done: guardDone, at: T.caveGuard,
                answers: [/I'd like to mine in a different area/i, /Yes sir, you're quite right sir/i, /we understand each other perfectly/i], maxTicks: 60, label: 'cave guard 1', tries: fix283 ? 2 : 4 });
        }
        dismiss(bot);
        if (fix283 && !guardDone()) fail(bot, 'cave guard 1: never said "you get my meaning"');
        Lg('cave guard: pineapple wanted'); failHook('guard1');
        await outOfMine('mine 1 out');
        }
        // ---- 7. Al Shabim: Bedobin key
        if (S <= 3) {
        await outOfMine('mine out (resume)');
        await leaveCamp('camp 1 out');
        step(); await talkTo(bot, N.shabim, [], { done: () => bot.count(O.bkey) > 0 && !inDialog(bot), at: T.shabim,
            answers: [/I am looking for a pineapple/i, /Yes, I'm interested/i], maxTicks: 60, label: 'shabim key', tries: 4 });
        dismiss(bot);
        // 283: no key = the state is behind (no pineapple talk); fail here, not 400 t later at Siad's chest
        if (process.env.TT_GUARD_FIX !== '0' && bot.count(O.bkey) === 0) fail(bot, 'shabim key: no Bedobin key');
        Lg('bedobin key'); failHook('bkey');
        }
        // ---- 8. Siad's plans
        if (S <= 4) {
        await outOfMine('mine out (resume)');
        await enterCamp('camp 2');
        await siadPlans(); failHook('plans');
        if (bot.minusedlevel === 1 && !(await opLocUntil(bot, loc(L.ladderDown, 1), 1, () => bot.minusedlevel === 0, 40, 6))) fail(bot, 'siad: ladder down (resume)');
        await leaveCamp('camp 2 out');
        }
        // ---- 9. Al Shabim + anvil + dart -> pineapple
        if (S <= 5) {
        await outOfMine('mine out (resume)');
        if (bot.minusedlevel === 1 && !(await opLocUntil(bot, loc(L.ladderDown, 1), 1, () => bot.minusedlevel === 0, 40, 6))) fail(bot, 'siad: ladder down (resume)');
        await leaveCamp('camp out (resume)');
        await dartAndPineapple(); failHook('pineapple');
        }
        // ---- 10. mine: pineapple, barrel, carts, Ana, lift
        if (S <= 6) {
        await enterCamp('camp 3');
        await intoMine('mine 2');
        step(); await talkTo(bot, N.merc2, [], { done: () => bot.count(O.pine) === 0 && seen(/a deal's a deal/i) && !inDialog(bot), at: T.caveGuard,
            answers: [], maxTicks: 60, label: 'cave guard pineapple', tries: 4 });
        // session 6 (allchaos qt12m: the walk to the cave guard hit 'no route' / a refused step, talkTo gave up silently, the log
        // said 'pineapple given' with the pineapple still held, then 'cave east' failed): check it, walk up door-aware, ask again.
        for (let k = 0; k < 3 && bot.count(O.pine) > 0 && process.env.TT_PINE_RETRY !== '0'; k++) {
            dismiss(bot);
            Lg(`cave guard: pineapple still held (try ${k + 1}): door-aware walk to the guard`);
            await bot.walkTo(T.caveGuard.x, T.caveGuard.z, { near: 2, closeDoors: true, maxTicks: 300, log: false });
            step(); await talkTo(bot, N.merc2, [], { done: () => bot.count(O.pine) === 0 && seen(/a deal's a deal/i) && !inDialog(bot), at: T.caveGuard,
                answers: [], maxTicks: 60, label: 'cave guard pineapple', tries: 4 });
        }
        if (bot.count(O.pine) > 0 && process.env.TT_PINE_RETRY !== '0') fail(bot, 'cave guard: pineapple not taken');
        dismiss(bot); Lg('pineapple given'); failHook('pine-given');
        }
        if (S <= 7) {
        if (!underground(bot.tile())) { await enterCamp('camp (resume)'); await intoMine('mine (resume)'); }
        await anaToLift(); failHook('lift');
        }
        // ---- 11. surface: winch, barrel, cart, driver, ride out
        if (S <= 8) {
        await outOfMine('mine 2 out');
        await escape(S === 7 || S === 8); failHook('escaped');
        }
        // ---- 12. Shantay doorway with Ana, rewards
        await finish();
        Lg('QUEST COMPLETE');
        return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message };
    }

    // ------------------------------------------------------------------------------------------------------------------------
    async function captain(): Promise<void> {
        if (bot.count(O.key) > 0) return;
        await walk(T.captain, 'captain', 4);
        await wear(bot, ['rune_scimitar']);
        step(); await talkTo(bot, N.captain, [], { done: () => seen(/let's get on with it/i) || bot.count(O.key) > 0, at: T.captain,
            answers: [/Wow! A real captain/i, /I'd love to work for a tough guy/i, /Can't I do something for a strong Captain/i, /Sorry Sir, I don't think I can do that/i, /funny captain who can't fight his own battles/i],
            maxTicks: 60, label: 'captain talk', tries: 4 });
        const t1 = bot.tickCount; let last = -100;
        while (bot.count(O.key) === 0 && bot.tickCount - t1 < 300) {
            if (dead(bot)) fail(bot, 'died to the captain');
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); continue; }
            const c = npc(bot, N.captain);
            if (c && bot.tickCount - last >= 6) { opNpcGo(bot, c, 2); last = bot.tickCount; }
            await bot.tick(1);
        }
        if (bot.count(O.key) === 0) fail(bot, 'no metal key from the captain');
        dismiss(bot);
        await unwear(bot, O.weapon);
        Lg(`captain dead (${bot.tickCount - t1} t fight)`);
    }
    /** Through the camp gate (metal key). No weapon/armour may be worn. */
    async function enterCamp(label: string): Promise<void> {
        if (inCamp(bot.tile()) || underground(bot.tile())) return;
        if (bot.isWorn(O.weapon)) await unwear(bot, O.weapon);
        await walk(T.campOut, label, 1);
        if (!(await opLocUntil(bot, loc(L.gateL), 1, () => inCamp(bot.tile()), 30, 6))) fail(bot, `${label}: gate`);
        dismiss(bot);
    }
    async function leaveCamp(label: string): Promise<void> {
        if (!inCamp(bot.tile())) return;
        await downFromSiad(label);
        for (const s of [O.sShirt, O.sRobe, O.sBoots]) if (bot.isWorn(s)) await unwear(bot, s);
        await walk(T.campIn, label, 1);
        if (!(await opLocUntil(bot, loc(L.gateL), 1, () => !inCamp(bot.tile()), 30, 6))) fail(bot, `${label}: gate out`);
        dismiss(bot);
    }
    async function freeSlave(): Promise<void> {
        if (bot.isWorn(O.sShirt) || bot.count(O.sShirt) > 0) return;
        await walk(T.slaves, 'slaves', 4);
        // intro (-> 6) and the pick loop (the dialog loops "Yeah I'll give it another go." by itself). A 3rd+ failed pick
        // with a mercenary within 10 tiles jails you (mining_slave.rs2:115-125); every slave stands within 10 of a mercenary
        // spawn (run-npcspawns), so a jail is handled, not avoided.
        let cm = chatMark(bot);
        const traded = () => bot.isWorn(O.sShirt) && bot.isWorn(O.sRobe) && bot.isWorn(O.sBoots);
        const jailed = () => chatSince(bot, cm, /spots you|manhandled? into a cell/i);
        for (let k = 0; k < 8 && !traded(); k++) {
            if (jailed()) {   // the jail resets the fail counter (mining_slave.rs2:118): two free fails again
                await escapeJail(); await enterCamp('camp after jail'); await walk(T.slaves, 'slaves again', 4); cm = chatMark(bot);
            }
            step();
            await talkTo(bot, N.slave, [], { done: () => traded() || jailed(),
                answers: [/I've just arrived/i, /Oh yes, that sounds interesting/i, /What's that then/i, /I can try to undo them for you/i,
                    /It's funny you should say that/i, /Yes, I'll trade/i, /Yeah, okay, let's give it a go|Yeah I'll give it another go/i],
                maxTicks: 120, label: `slave ${k}`, tries: 3 });
        }
        if (!traded()) fail(bot, 'slave clothes');
        const fails = ((bot as any).getChat({ types: [0], limit: 0, includeSelf: true }) as Array<{ text: string }>).filter(m => /^You fail!/.test(m.text)).length;
        dismiss(bot); Lg(`slave clothes on (${fails} failed picks this session)`);
    }
    /** Surface jail (prison 3285,3034): bend a window bar (stat_random(strength,100,250), retry, Q:188-229), then the
     *  escarpment rocks 2694 -> 2695 -> 2696 -> 2697 (op2, stat_random(agility,150,250), a fail 7 damage, Q:231-274) land
     *  outside the camp at (3270,3039) (probe-jail). A guard search can take the metal key (1 in 5, Q:552-555): the
     *  captain re-fights for it (mercenary_captain.rs2:2-5). */
    async function escapeJail(): Promise<void> {
        const t1 = bot.tickCount;
        await bot.until(() => bot.tile().x >= 3284 && bot.tile().x <= 3287 && bot.tile().z >= 3033 && bot.tile().z <= 3036, 20);
        Lg(`jailed (metal key ${bot.count(O.key) > 0 ? 'kept' : 'TAKEN'})`);
        dismiss(bot);
        const win = loc({ id: 2683, x: 3284, z: 3032 });
        for (let k = 0; k < 10 && bot.tile().x >= 3284; k++) {
            await opLocUntil(bot, win, 2, () => inDialog(bot) || bot.tile().x < 3284, 20, 6);
            await talk(bot, [], [], { noOp: true, done: () => bot.tile().x < 3284 && !inDialog(bot), answers: [/Yes, I'll bend the bar/i], maxTicks: 30, label: 'bend bar' });
        }
        if (bot.tile().x >= 3284) fail(bot, 'jail: window bar');
        // route runner: agility 1 at the plan's TT slot (58% per rock, 4 rocks): 16 tries ran out (sim qrg5m)
        for (let k = 0; k < 40 && !(bot.tile().x <= 3272); k++) {
            const x = bot.tile().x;
            const r = x >= 3281 ? { id: 2694, x: 3280, z: 3038 } : x >= 3279 ? { id: 2695, x: 3278, z: 3039 } : x >= 3276 ? { id: 2696, x: 3276, z: 3040 } : { id: 2697, x: 3274, z: 3039 };
            const p0 = bot.tile();
            opLocGo(bot, loc(r), 2); bot.queueFlush();
            await bot.until(() => inDialog(bot) || cheb(bot.tile(), p0) > 1, 10);
            if (inDialog(bot)) await talk(bot, [], [], { noOp: true, done: () => !inDialog(bot), answers: [/Yes, I'll give it a try/i], maxTicks: 20, label: 'rocks' });
            await bot.until(() => bot.tile().x < p0.x - 1, 8);
        }
        if (bot.tile().x > 3272) fail(bot, 'jail: escarpment rocks');
        Lg(`out of the jail (${bot.tickCount - t1} t)`);
        if (bot.count(O.key) === 0) await captain();
    }
    /** 283 (qx39m/qx40m retry: resumed at step 2 on Siad's floor L1 (3293,3033), 'mine 1: mine doors' 3 discarded OPLOCs):
     *  a retry that starts upstairs in Siad's building climbs down first. TT_GUARD_FIX=0 reverts. */
    async function downFromSiad(label: string): Promise<void> {
        if (process.env.TT_GUARD_FIX === '0' || bot.minusedlevel !== 1) return;
        if (!(await opLocUntil(bot, loc(L.ladderDown, 1), 1, () => bot.minusedlevel === 0, 40, 6))) fail(bot, `${label}: ladder down`);
        dismiss(bot); await curtain();
    }
    async function intoMine(label: string): Promise<void> {
        if (underground(bot.tile())) return;
        await downFromSiad(label);
        await wear(bot, ['slave_shirt', 'slave_robe', 'slave_boots']);
        if (!(await opLocUntil(bot, loc(L.mineIn), 1, () => underground(bot.tile()), 40, 8))) fail(bot, `${label}: mine doors`);
        dismiss(bot); await bot.tick(1); dismiss(bot);
    }
    async function outOfMine(label: string): Promise<void> {
        if (!underground(bot.tile())) return;
        if (bot.tile().x >= 3283) {   // east of the cave passage: walk back through it
            if (!(await opLocUntil(bot, loc(L.caveW), 1, () => bot.tile().x < 3281, 40, 6))) fail(bot, `${label}: cave west`);
            dismiss(bot);
        }
        // the doors open from their north side (3278,9427, where the entry lands); the cave guard's room is ~80 tiles round
        // the west loop from there (sott4 trace), more than one opLoc window
        await walk({ x: 3278, z: 9428 }, `${label} (to the doors)`, 1, 300);
        const door = loc(L.mineOut);
        if (!(await retry(bot, () => opLocGo(bot, door, 1, { x: 3278, z: 9427 }), () => !underground(bot.tile()), 40, 8))) fail(bot, `${label}: exit doors`);
        dismiss(bot);
    }
    /** OPLOC once (re-sent only while nothing happened), then page through the dialog until `done`. Scripts that inv_add
     *  after a box (chests, barrels) abort when a re-sent op closes the box. */
    async function opThen(l: ReturnType<typeof loc>, op: number, done: () => boolean, answers: RegExp[], label: string, maxTicks = 40): Promise<void> {
        step();
        await opLocUntil(bot, l, op, () => done() || inDialog(bot), 30, 8);
        if (!done()) await talk(bot, [], [], { noOp: true, done: () => done() && !inDialog(bot), answers, maxTicks, label });
        dismiss(bot);
    }
    /** The curtain (1528, 3291,3031) closes Siad's building; the planner routes through it as if open (sott6 sat at
     *  (3291,3030)). Open it when it is closed (zone stream). */
    async function curtain(): Promise<void> {
        if (bot.minusedlevel !== 0) return;
        const id = liveId(bot, 3291, 3031, 1528);
        if (id !== 1528) return;
        const c = locHere(1528, 3291, 3031, 0);
        await opLocUntil(bot, c, 1, () => liveId(bot, 3291, 3031, 1528) !== 1528, 20, 5);
    }
    async function siadPlans(): Promise<void> {
        if (bot.count(O.plans) > 0) return;
        await curtain();
        if (bot.minusedlevel !== 1 && !(await opLocUntil(bot, loc(L.ladderUp), 1, () => bot.minusedlevel === 1, 40, 6))) fail(bot, 'siad: ladder up');
        const book = loc(L.bookcase, 1);
        step(); await opLocUntil(bot, book, 2, () => seen(/books on the subject of sailing/i) || inDialog(bot), 30, 6);
        await bot.until(() => seen(/books on the subject of sailing/i), 6); dismiss(bot);
        step(); await talkTo(bot, N.siad, [], { done: () => seen(/cut of your jib/i) && !inDialog(bot),
            answers: [/I wanted to have a chat/i, /You seem to have a lot of books/i, /So, you're interested in sailing/i, /cut of your jib/i], maxTicks: 60, label: 'siad', tries: 3 });
        dismiss(bot);
        const chest = loc(L.chest, 1);
        // the plans are added AFTER the objbox (Q:337-345): open once, then page through; a re-sent op closes the box and
        // aborts the script (sott7: box closed, distraction spent, "the captain spots you" from then on)
        await opThen(chest, 1, () => bot.count(O.plans) > 0, [], 'siad chest');
        if (bot.count(O.plans) === 0) fail(bot, 'siad chest: no plans');
        if (!(await opLocUntil(bot, loc(L.ladderDown, 1), 1, () => bot.minusedlevel === 0, 40, 6))) fail(bot, 'siad: ladder down');
        await curtain();
        Lg('plans');
    }
    async function dartAndPineapple(): Promise<void> {
        if (bot.count(O.pine) > 0) return;
        // 317c (qx83m: the retry started inside the tent, 3171,3046, and 'shabim 2: walk' had no route through the closed tent
        // door): inside the tent the deal is done already: fletch / smith here, the tent-out step below walks us out
        const inTent = (t: Tile) => t.z < 9000 && t.z >= 3046 && t.z <= 3052 && t.x >= 3165 && t.x <= 3176;
        const tentResume = process.env.TT_TENT_RESUME !== '0' && inTent(bot.tile());
        if (tentResume) Lg('resume inside the tent');
        if (!tentResume) await walk(T.shabim, 'shabim 2', 3);
        // plans on him -> deal (needs a bronze bar + 10 feathers held)
        if (bot.count(O.dart) === 0 && bot.count(O.tip) === 0) {
            if (!tentResume) {
            step();
            await retry(bot, useOnNpc(N.shabim, O.plans), () => inDialog(bot), 30, 6);
            await talk(bot, N.shabim, [], { noOp: true, done: () => seen(/Yes, I'm kind of curious/i) && !inDialog(bot), answers: [/Yes, I'm very interested/i, /Yes, I'm kind of curious/i], maxTicks: 60, label: 'shabim deal' });
            dismiss(bot);
            // the tent: door op1 with the plans
            const door = loc(L.tent);
            // the door script talks first, then teleports onto (3169,3046) (bedabin_nomad_guard.rs2:58-66): no re-send mid-dialog
            await opThen(door, 1, () => bot.tile().z >= 3046, [], 'tent door');
            if (bot.tile().z < 3046) fail(bot, 'tent door');
            }
            const anvil = loc(L.anvil);
            // session 11 fix 363: a roll per bar held (was 4); the 'out of bronze bars' check above ends it. TEST: TT_BARS=1
            for (let k = 0; k < 8 && bot.count(O.tip) === 0; k++) {
                if (bot.count(O.bar) === 0) fail(bot, 'anvil: out of bronze bars');
                const b0 = bot.count(O.bar);
                step();
                await useOnLocUntil(bot, O.bar, anvil, () => inDialog(bot), 20, 6);
                // session 11 fix 363c (timing: a failed roll cost ~55 t = talk maxTicks 40 + until 14, so the 'waste' text never
                // matched): done once the bar is gone (Q:612, ~2 t after the answer); the until below waits for the tip (+10 t,
                // Q:623-631). TT_ANVIL_FAST=0 reverts.
                await talk(bot, [], [], { noOp: true, done: () => bot.count(O.tip) > 0 || (bot.count(O.bar) < b0 && (process.env.TT_ANVIL_FAST !== '0' || seen(/waste the bronze bar/i))), answers: [/Yes, I'd like to try/i], maxTicks: 40, label: `anvil ${k}` });
                await bot.until(() => bot.count(O.tip) > 0 || seen(/waste the bronze bar/i), 14);
                dismiss(bot);
            }
            if (bot.count(O.tip) === 0) fail(bot, 'no dart tip');
            Lg('dart tip'); failHook('tt-tip');   // 317c test mark: a retry from inside the tent
        }
        // route runner: 3 rolls at fletching 20 all failed (sim qre7m, 37% each): use every 10 feathers held
        // session 11 fix 332 (qx108m 'no prototype dart': 150 feathers held (317a) but the loop still stopped at 9 rolls
        // (~1.3% to fail all 9 at 38% each, quest_desertrescue.rs2:654-670) with 60 feathers unused; the retry's first roll on
        // those made it): up to 15 rolls (= 317a's 150 feathers). TT_DART_ROLLS=0 reverts to 9. TEST: TT_DART_ROLLS_TEST=1
        // starts at roll 10 (the 9 old rolls counted as spent).
        const maxRolls = process.env.TT_DART_ROLLS !== '0' ? Math.floor(Number(process.env.TT_FEATHERS ?? 200) / 10) : 9;   // fix 370: 20 rolls
        for (let k = process.env.TT_DART_ROLLS_TEST === '1' ? 9 : 0; k < maxRolls && bot.count(O.dart) === 0; k++) {
            if (k === 9) Lg('332: dart roll 10 (past the old cap of 9)');
            if (bot.count(O.feather) < 10) fail(bot, 'dart: out of feathers');
            const f0 = bot.count(O.feather);
            await retry(bot, () => { const a = bot.slot(O.feather), b = bot.slot(O.tip); if (a >= 0 && b >= 0) bot.useItemOnItem(O.tip, b, O.feather, a); },
                () => bot.count(O.dart) > 0 || bot.count(O.feather) < f0 || inDialog(bot), 10, 4);
            // the roll comes after an objbox page (Q:654-660): page through, never close it
            await talk(bot, [], [], { noOp: true, done: () => (bot.count(O.dart) > 0 || bot.count(O.feather) < f0) && !inDialog(bot), maxTicks: 20, label: `fletch ${k}` });
            dismiss(bot);
        }
        if (bot.count(O.dart) === 0) fail(bot, 'no prototype dart');
        Lg('dart');
        // out of the tent, dart on Al Shabim
        if (bot.tile().z >= 3046) { await opThen(loc(L.tent), 1, () => bot.tile().z <= 3045, [], 'tent out'); if (bot.tile().z >= 3046) fail(bot, 'tent out'); }
        await walk(T.shabim, 'shabim 3', 4);   // 20 tiles from the tent: out of npc view
        step();
        // 268 (qx06m: a server drop (ws 1006) mid 'shabim dart' closed the dialog the dart-on-npc had opened; talk() noOp
        // cannot re-open it (a re-op is Talk-to, not the dart) and the attempt failed 'no pineapple' with the dart still
        // held; the journal retry re-used the dart and got it at once): re-use the dart on Al Shabim up to 3 more rounds
        // while the dart is held and no pineapple came. TT_DART_REUSE=0 reverts. TEST: TT_DART_TEST=1 closes the first
        // Al Shabim dart dialog once (the cut).
        const reuse = process.env.TT_DART_REUSE !== '0' ? 4 : 1;
        for (let r = 0; r < reuse && bot.count(O.pine) === 0 && (r === 0 || bot.count(O.dart) > 0); r++) {
            if (r > 0) { Lg(`shabim dart: no pineapple, dart still held: use it again (round ${r + 1})`); dismiss(bot); await bot.tick(1); if (cheb(bot.tile(), T.shabim) > 6) await walk(T.shabim, 'shabim 3', 4); }
            await retry(bot, useOnNpc(N.shabim, O.dart), () => inDialog(bot) || bot.count(O.pine) > 0, 40, 6);
            if (r === 0 && process.env.TT_DART_TEST === '1' && !(globalThis as any).__ttDartTest && inDialog(bot)) {
                (globalThis as any).__ttDartTest = 1; Lg('TEST: Al Shabim dart dialog closed (the drop cut)'); bot.closeModal(); bot.queueFlush(); await bot.tick(2); continue;
            }
            await talk(bot, N.shabim, [], { noOp: true, done: () => bot.count(O.pine) > 0 && !inDialog(bot), maxTicks: 60, label: 'shabim dart' });
            dismiss(bot);
            if (bot.count(O.pine) === 0) await bot.until(() => bot.count(O.pine) > 0, 3);
        }
        if (bot.count(O.pine) === 0) fail(bot, 'no pineapple');
        Lg('pineapple');
    }
    async function anaToLift(): Promise<void> {
        // empty barrel (west part, next to the lift)
        if (bot.count(O.barrel) === 0 && bot.count(O.ana) === 0 && !anaCaught) {
            if (bot.tile().x < 3283 && !(await opLocUntil(bot, loc(L.caveE), 1, () => bot.tile().x >= 3284, 40, 6))) fail(bot, 'cave east');
            dismiss(bot);
            step(); await opLocUntil(bot, loc(L.emptyBarrel), 2, () => inDialog(bot), 30, 6);
            await talk(bot, [], [], { noOp: true, done: () => bot.count(O.barrel) > 0, answers: [/Yeah, cool/i], maxTicks: 20, label: 'empty barrel' });
            dismiss(bot);
            if (bot.count(O.barrel) === 0) fail(bot, 'no empty barrel');
        }
        // the cart to Ana's room
        const rideTo = async (cart: { id: number; x: number; z: number }, arrived: () => boolean, label: string) => {
            // route session 5: the ride is an agility roll (quest_desertrescue.rs2 stat_random(agility, 100, 250): ~39% at
            // agility 1, 'You fall and hurt yourself' -2 hp): 6 tries failed 5% of rides (qsgm/qshm 'cart back: cart'): 20 tries
            // session 6 (qt1m, allchaos 9001: 20 falls in a row, p ~5e-5 at 39%; the fork of the same spot passed after 5): the
            // seeded sim rerolls on a fixed 11-tick cycle; jitter the cycle (0-2 t) and allow 40 tries (TT_RIDE_TRIES; TT_RIDE_JITTER=0 = no jitter).
            const TRIES = Number(process.env.TT_RIDE_TRIES ?? 40);
            for (let k = 0; k < TRIES && !arrived(); k++) {
                if (process.env.TT_RIDE_JITTER !== '0' && k > 0 && k % 3) await bot.tick(k % 3);
                const cm = chatMark(bot);   // the fall line is a game message (mes), not a dialog page: sott12 waited 33 t on it
                step(); await opLocUntil(bot, loc(cart), 2, () => inDialog(bot), 30, 6);
                await talk(bot, [], [], { noOp: true, done: () => arrived() || chatSince(bot, cm, /You fall and hurt yourself/i), answers: [/^Yes, of course/i], maxTicks: 30, label });
                await bot.until(arrived, 6);
                // route session 5 diagnostic (allchaos 'cart back: cart' x2, stuck with chat 356)
                if (!arrived()) Lg(`${label} ride ${k + 1} not arrived: chat ${bot.chatModalId} main ${bot.mainModalId} opts [${bot.dialogOptions().map(d => d.text).join('|')}] text ${[...bot.ifText.entries()].filter(([, v]) => v).slice(-4).map(([i, v]) => `${i}:${v}`).join(' / ').slice(0, 300)}`);
                dismiss(bot);
            }
            if (!arrived()) fail(bot, `${label}: cart`);
        };
        const inAnaRoom = () => bot.tile().x >= 3308 || bot.tile().z >= 9428;
        if (bot.count(O.barrel) > 0) await rideTo(L.cartLow, inAnaRoom, 'cart to Ana');
        // barrel on Ana
        if (bot.count(O.barrel) > 0) {
            // session 9 (allchaos qu08m: a server drop during the cart ride; after the reconnect at Ana's spot the barrel never
            // went on her: 'Ana not in the barrel', and the retry is not re-entrant (plans spent): STOPPED): up to 3 rounds, each
            // logged with what is in view (TT_ANA_ROUNDS=1 = old)
            const rounds = Number(process.env.TT_ANA_ROUNDS ?? 3);
            for (let r = 0; r < rounds && bot.count(O.ana) === 0; r++) {
                if (r > 0) { dismiss(bot); await bot.tick(2); Lg(`barrel on Ana round ${r + 1}: ana ${JSON.stringify(npc(bot, N.ana))} me ${JSON.stringify(bot.tile())} npcs ${npcsOf(bot, [...Array(4000).keys()]).filter(q => q.d <= 12).map(q => `${q.type}@${q.x},${q.z}`).join(' ').slice(0, 160)}`); }
                const a0 = npc(bot, N.ana);
                if (!a0 || a0.d > 10 || r > 0) await walk(a0 && a0.d <= 14 ? { x: a0.x, z: a0.z } : T.ana, 'to Ana', 1);
                step();
                await retry(bot, useOnNpc(N.ana, O.barrel), () => inDialog(bot) || bot.count(O.ana) > 0, 40, 6);
                await talk(bot, N.ana, [], { noOp: true, done: () => bot.count(O.ana) > 0 && !inDialog(bot), maxTicks: 40, label: 'barrel on Ana' });
                dismiss(bot);
            }
            if (bot.count(O.ana) === 0) fail(bot, 'Ana not in the barrel');
            Lg('Ana in the barrel');
        }
        // Ana into the cart (she rides to the barrel loading room), then ride back
        if (bot.count(O.ana) > 0 && inAnaRoom()) {
            const cm = chatMark(bot);
            step(); await useOnLocUntil(bot, O.ana, loc(L.cartHigh), () => bot.count(O.ana) === 0, 40, 8);
            await bot.until(() => chatSince(bot, cm, /it returns/i), 8); dismiss(bot);
            await rideTo(L.cartHigh, () => !inAnaRoom(), 'cart back');
        }
        // search an empty barrel next to the lower cart = Ana
        if (bot.count(O.ana) === 0) {
            for (const b of [L.lowBarrel, { id: 2681, x: 3304, z: 9416 }, { id: 2681, x: 3303, z: 9415 }]) {
                step(); await opLocUntil(bot, loc(b), 2, () => bot.count(O.ana) > 0 || inDialog(bot), 20, 6);
                await talk(bot, [], [], { noOp: true, done: () => bot.count(O.ana) > 0 && !inDialog(bot), maxTicks: 20, label: 'Ana barrel' });
                dismiss(bot);
                if (bot.count(O.ana) > 0) break;
            }
            // session 10: a resumed attempt with no barrel and no Ana in the cart room = Ana is already on the lift / above
            if (bot.count(O.ana) === 0 && isResuming(bot) && process.env.TT_RESUME !== '0') { Lg('resume: Ana not by the lower cart: she is on the lift already'); return; }
            if (bot.count(O.ana) === 0) fail(bot, 'Ana barrel not found by the lower cart');
        }
        // winch guard: lift
        // the winch guard only helps while YOU stand on the lift platform x 3290-3293, z 9422-9424 (camp_guard.rs2:17); from
        // (3291,9421) he said "Move along now..." (sott11). Stand (3291,9424), cardinal to his spawn (3291,9423).
        for (let k = 0; k < 4 && bot.count(O.ana) > 0; k++) {
            await walk({ x: 3291, z: 9424 }, 'lift platform', 0, 120);
            step(); await talk(bot, N.merc2, [], { done: () => bot.count(O.ana) === 0 && !inDialog(bot), answers: [/^Yes please/i, /gregarious/i], maxTicks: 60, label: `winch guard ${k}` });
            dismiss(bot);
        }
        if (bot.count(O.ana) > 0) fail(bot, 'winch guard did not take the barrel');
        Lg('Ana on the lift');
    }
    async function escape(resumed = false): Promise<void> {
        if (bot.count(O.ana) > 0 && !inCamp(bot.tile())) return;   // already out with her
        // session 11 fix 387a (qx314m/qx212m/qu21m 'escape cart' ~1100 t dead at (3286,3025), every op 'false'): the cart loc_2682
        // is 2x3 at angle 1 (m51_47 '23 15: 2682 10 1'); sdk/pathfinding pre-swaps odd angles and rsmod rotates again, so the
        // client thinks (3286,3025) is west-adjacent (x 3287-3288, z 3023-3025) and sends the OPLOC with no route; the engine
        // footprint is x 3287-3289, z 3023-3024 = diagonal: 'I can't reach that!' (Player.ts:1342). The bot parks there when
        // the driver wanders to (3287,3025). Op the cart from (3286,3023) (the tile 'Ana on the cart' fires from) instead.
        // TT_CART_STAND=0 = old. TEST: TT_CART_TEST=1 walks to (3286,3025) before every cart op.
        const CART_STAND = process.env.TT_CART_STAND !== '0' ? { x: 3286, z: 3023 } : undefined;
        const cartGo = () => opLocGo(bot, loc(L.escapeCart), 2, CART_STAND);
        const cartTest = async () => { if (process.env.TT_CART_TEST !== '1') return; await walk({ x: 3286, z: 3025 }, 'TEST: cart diagonal', 0, 40); Lg(`TEST: at ${JSON.stringify(bot.tile())} before the cart op`); };
        // resumed: find where Ana is (held / on the cart / still in the winch barrel) by the cart's own op2 text
        let cartState = '';
        if (resumed && bot.count(O.ana) === 0) {
            bot.closeModal(); await bot.tick(1);
            // session 11 fix 387b (qx314m/qx212m retry 'Ana barrel at the winch' in 150 t: Ana sat on the cart (ana_mining_cart bit,
            // quest_desertrescue.rs2:381-396) but the probe op never fired and 'empty' sent us to the winch). The empty-cart answer
            // 'You search the mine cart.' is a mes() (rs2:389) = a GAME MESSAGE, never IF_SETTEXT, so seen() can not see it: read it
            // with chatSince. No answer at all = 'unknown' = skip the winch, go to the driver rounds. TT_CART_UNKNOWN=0 = old.
            const cm = chatMark(bot);
            await cartTest(); step(); await retry(bot, cartGo, () => inDialog(bot) || chatSince(bot, cm, /You search the mine cart/i), 30, 6);
            await bot.until(() => seen(/space on the cart for you|barrel with Ana in it/i) || chatSince(bot, cm, /You search the mine cart/i), 4);
            cartState = seen(/space on the cart for you/i) ? 'ready' : seen(/barrel with Ana in it on the cart already/i) ? 'ana'
                : (chatSince(bot, cm, /You search the mine cart/i) || process.env.TT_CART_UNKNOWN === '0') ? 'empty' : 'unknown';
            Lg(`escape resume: cart state ${cartState}`);
            dismiss(bot); bot.closeModal(); await bot.tick(1);
        }
        if (cartState === '' || cartState === 'empty') {
        if (bot.count(O.ana) === 0) {
        step(); await opLocUntil(bot, loc(L.winch), 2, () => seen(/Get me OUT OF HERE|barrel coming to the surface/i), 30, 6);
        await bot.until(() => seen(/Get me OUT OF HERE/i), 10); dismiss(bot); await bot.tick(1); dismiss(bot);
        await opThen(loc(L.fullBarrel), 2, () => bot.count(O.ana) > 0, [], 'surface barrel');
        }
        if (bot.count(O.ana) === 0) fail(bot, 'Ana barrel at the winch');
        await useOnLocUntil(bot, O.ana, loc(L.escapeCart), () => bot.count(O.ana) === 0, 30, 6);
        dismiss(bot);
        Lg(`Ana on the cart: ${bot.count(O.ana) === 0}`);
        }
        // fix 175 (allchaos qt21m 'escape cart' 210 t stuck at the cart, silent): the driver talk + the cart tries are one
        // round; up to 3 rounds, each logged (a driver talk that did not set the ready bit makes every cart try a no-op).
        // TT_ESCAPE_ROUNDS=1 = old behaviour.
        const rounds = Number(process.env.TT_ESCAPE_ROUNDS ?? 3);
        for (let r = 0; r < rounds && !(bot.count(O.ana) > 0 && !inCamp(bot.tile())); r++) {
            dismiss(bot);
            // session 10 (allchaos qu21m: after round 1 every cart op and driver talk did nothing for 900 t at (3286,3025),
            // client modals -1): a server-side suspended script blocks ops while the client shows nothing; CLOSE_MODAL
            // unconditionally before each later round/try (TT_ESCAPE_CLOSE=0 = old)
            if (r > 0 && process.env.TT_ESCAPE_CLOSE !== '0') { bot.closeModal(); await bot.tick(1); Lg(`escape round ${r + 1}: closed modals (driver at ${npcsOf(bot, [N.driver]).map(q => `${q.x},${q.z} d${q.d}`).join(' ')})`); }
            if (!(cartState === 'ready' && r === 0)) {
            // session 11 fix 387c (qx314m: rounds 2-3 burned 273 t each: with ready_rescue set the driver only says 'Hurry up, get in
            // the cart' (mine_cart_driver.rs2:3-4), never matched = maxTicks 90 x 3 tries). TT_DRIVER_HURRY=0 = old.
            step(); const drv = await talkTo(bot, N.driver, [], { done: () => (seen(/You can't leave me here/i) || (process.env.TT_DRIVER_HURRY !== '0' && seen(/Hurry up, get in the cart/i))) && !inDialog(bot),
                answers: [/^Nice cart/i, /One wagon wheel/i, /One good turn deserves another/i, /Fired\.\.\. no, shot perhaps/i, /In for a penny/i, /Well, you see, it's like this/i, /Prison riot in ten minutes/i, /You can't leave me here/i],
                maxTicks: 90, label: 'cart driver', tries: 3 });
            dismiss(bot);
            Lg(`escape round ${r + 1}: driver talk ${JSON.stringify(drv)?.slice(0, 80)} seen ${seen(/You can't leave me here/i)} at ${JSON.stringify(bot.tile())}`);
            }
            // route session 5 (allchaos qsim 'escape cart' once): up to 3 tries
            for (let k = 0; k < 3 && !(bot.count(O.ana) > 0 && !inCamp(bot.tile())); k++) {
                if (k > 0 && process.env.TT_ESCAPE_CLOSE !== '0') { bot.closeModal(); await bot.tick(1); }
                await cartTest(); step(); const op = await retry(bot, cartGo, () => inDialog(bot), 30, 6);   // session 11 fix 387a
                await talk(bot, [], [], { noOp: true, done: () => bot.count(O.ana) > 0 && !inCamp(bot.tile()), answers: [/Yes, I'll get on/i], maxTicks: 30, label: 'escape cart' });
                dismiss(bot);
                Lg(`escape cart try ${k + 1}: op ${JSON.stringify(op)?.slice(0, 40)} ana ${bot.count(O.ana)} at ${JSON.stringify(bot.tile())}`);
            }
        }
        if (bot.count(O.ana) === 0) fail(bot, 'escape cart');
        Lg('out with Ana');
    }
    async function finish(): Promise<void> {
        await walk({ x: 3302, z: 3114 }, 'shantay', 2);
        step(); await opLocUntil(bot, loc(L.doorway), 1, () => inDialog(bot) || bot.count(O.ana) === 0, 30, 6);
        const pickRe = PICKS.map(p => new RegExp(`^${p}`, 'i'));
        let picked = 0;
        const t1 = bot.tickCount;
        // session 11 fix 369 TT_PICK_XP (qx202m: an engine restart (ws 1012) at Irena's first menu lost the Agility click
        // (agility xp 0 in qx202m.sav) but 'picked' had counted it; the 317d re-talk got the 2-pick menu again and both
        // picks went to Thieving (+2 x 1,162,500), so Grand Tree stopped at 'climb tree (agility 25)' x2 at agility 1,
        // qp 29). A pick counts only once its skill's xp rose (server truth); the next pick = the first one that has not.
        // TT_PICK_XP=0 reverts. TEST TT_PICK_TEST=1: the first menu is closed unanswered once (= the lost click).
        const pickXp = process.env.TT_PICK_XP !== '0', xp0 = PICKS.map(p => bot.stat(p).xp);
        let pickTestDone = false;
        while (qp(bot) < qp0 + QUEST.qp && bot.tickCount - t1 < 150) {
            if (pickXp) picked = PICKS.filter((p, i) => bot.stat(p).xp > xp0[i]!).length;
            if (inDialog(bot)) {
                const opts = bot.dialogOptions();
                if (opts.length >= 4 && opts.some(q => /^Fletching/i.test(q.text))) {
                    if (process.env.TT_PICK_TEST === '1' && !pickTestDone) { pickTestDone = true; picked++; bot.closeModal(); bot.queueFlush(); await bot.tick(1); continue; }
                    const next = pickXp ? PICKS.findIndex((p, i) => bot.stat(p).xp <= xp0[i]!) : -1;
                    const want = pickRe[next >= 0 ? next : Math.min(picked, pickRe.length - 1)]!;
                    const opt = opts.find(q => want.test(q.text)) ?? opts[0]!;
                    bot.ifButton(opt.com); bot.queueFlush(); picked++;
                    if (next >= 0) await bot.until(() => bot.stat(PICKS[next]!).xp > xp0[next]!, 4);   // 369: no re-pick on a stale menu
                    if (picked === 1) { await bot.tick(2); failHook('tt-pick1'); }   // 317d test mark: a retry after reward pick 1
                } else if (opts.length) { bot.ifButton(opts[0]!.com); bot.queueFlush(); }
                else { bot.resumeDialogPage(); bot.queueFlush(); }
            } else if (bot.count(O.ana) === 0 && picked < 2) {
                // 317d (qx79m: a server drop after pick 1 closed the menu; Ana gives no reward, the loop never re-opened it):
                // the rewards come from Irena (irena.rs2:25-33, saved_ana / picked_first_skill). TT_REWARD_IRENA=0 reverts
                const a = process.env.TT_REWARD_IRENA !== '0' ? (npc(bot, N.irena) ?? npc(bot, N.ana)) : npc(bot, N.ana); if (a) opNpcGo(bot, a, 1);
            }
            await bot.tick(1);
        }
        dismiss(bot);
        if (qp(bot) < qp0 + QUEST.qp) fail(bot, `no quest points (picked ${picked})`);
        Lg(`rewards: ${PICKS.join(' + ')}${pickXp ? ` (xp +${PICKS.map((p, i) => bot.stat(p).xp - xp0[i]!).join(' / +')})` : ''}`);
    }
}

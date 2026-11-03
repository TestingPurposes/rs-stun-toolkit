// q-restless-ghost.ts — The Restless Ghost (quest_priest), cheat-free. Content: quests/quest_priest/scripts/{quest_priest,
// restless_ghost}.rs2, areas/area_lumbridge/scripts/{father_aereck,father_urhney}.rs2, configs/quest_priest.constant
// (started 1, spoken_urhney 2, spoken_ghost 3, obtained_skull 4).
//
// Flow:
//  1. Father Aereck (npc 456, church (3244,3206)): chatnpc | p_choice3 "I'm looking for a quest!" | chatplayer | chatnpc ->
//     %prieststart = 1 + journal colour (father_aereck.rs2:40-46). The rest of his speech is skipped (CLOSE_MODAL).
//  2. Father Urhney (npc 458, swamp shack (3235,3153)): chatnpc | multi3 "Father Aereck sent me to talk to you." | chatplayer |
//     chatnpc | p_choice2 "He's got a ghost haunting his graveyard." | chatplayer | 5 chatnpc -> amulet_of_ghostspeak added
//     (father_urhney.rs2:30-51). The rest is skipped once the amulet is in the pack.
//  3. Wear the amulet (restless_ghost.rs2:15 checks the WORN inv). Open the coffin (loc 2145 shutghostcoffin at (3249,3192),
//     quest_priest.rs2:6-14): it spawns the ghost (npc 457, 100 t) and turns into loc 2146 for 300 t.
//  4. Ghost: chatplayer | chatnpc | chatplayer | chatnpc | p_choice3 "Yep, now tell me what the problem is." | 5 pages |
//     priest_ghost_certain_task: 6 pages -> %prieststart = 3 (restless_ghost.rs2:138) | chatnpc "It is so dull being a
//     ghost..." (the observable). Skipped from there.
//  5. Wizards' Tower: ladder 2147 (3104,3162) -> cellar (3104,9576) (ladders.rs2:32-36); take the skull (obj 553 at
//     (3120,9567), quest_priest.rs2:68-80; a level-13 skeleton spawns, we just leave).
//  6. Back to the coffin: Lumbridge Teleport (magic 31: 1 law, 3 air, 1 earth; lands (3221,3218) r2,
//     magic_spells.dbrow tele_coord 0_50_50_21_18) when held, else ladder up + walk. Open the coffin if it shut again, use
//     the skull on loc 2146 (quest_priest.rs2:53-64): 3 mesboxes + queue(priest_quest_complete): +1 qp, prayer 11250
//     tenths base (x25 = 28,125 -> prayer ~40).
// KEEP the amulet of ghostspeak: Nature Spirit needs it worn (filliman.rs2:4). This quest leaves it WORN.
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { R, M2, M3, npc, locAt, tele, walkOp } from '../../q-lib.js';
import { converse, pickup, opLocUntil, mkLog, qp, qStatus, closeChat, pagesUntil, textSince, snapText, wear, walk, eatWatch, dead, fail, cheb,
    type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'The Restless Ghost', dir: 'quest_priest', qp: 1 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0, skills: {},
    start: { x: 3243, z: 3207, level: 0 },   // Lumbridge church, next to Father Aereck
    end: { x: 3249, z: 3193, level: 0 },     // at the coffin in the graveyard
};
/** Lumbridge Teleport back from the Wizards' Tower (optional: without it the leg walks; needs magic 31) */
/** two Lumbridge Teleports: Urhney -> the coffin, the Wizards' Tower -> the coffin (the staff of air replaces 6 air runes) */
export const SUPPLY: Item[] = [{ name: 'lawrune', n: 2 }, { name: 'earthrune', n: 2 }, { name: 'staff_of_air', n: 1 }];
const AERECK = 456, URHNEY = 458, GHOST = 457;
const AERECK_AT = { x: 3244, z: 3206 }, URHNEY_AT = { x: 3235, z: 3153 };
const COFFIN = { x: 3249, z: 3192 }, COFFIN_SHUT = 2145, COFFIN_OPEN = 2146;
const LADDER_TOP = { id: 2147, x: 3104, z: 3162 }, LADDER_UP = { id: 2148, x: 3103, z: 9576 };
const SKULL_AT = { x: 3120, z: 9567 };
const AMULET = 'amulet_of_ghostspeak', SKULL = 'ghostskull';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'ghost', !!o.log);
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0); }
    finally { stopEat(); }
}

async function body(bot: SpeedBot, L: (s: string) => void, t0: number, qp0: number): Promise<RunResult> {
    const fin = (ok: boolean, msg: string): RunResult => ({ ok, ticks: bot.tickCount - t0, msg });
    const hasAmulet = () => bot.count(AMULET) > 0 || bot.isWorn(objId(AMULET));
    const coffinOpen = () => bot.liveLocs.get(`0,${COFFIN.x},${COFFIN.z}`) === COFFIN_OPEN;
    const check = () => { if (dead(bot)) fail(bot, 'died'); };
    /** runes (or a wielded staff of air) and magic 31 for `n` Lumbridge Teleports */
    if (bot.count('staff_of_air') > 0) await wear(bot, 'staff_of_air', 4);
    const teleOk = (n: number) => !process.env.FA_NOTELE && bot.stat('magic').level >= 31 && bot.count('lawrune') >= n && bot.count('earthrune') >= n
        && (bot.isWorn(objId('staff_of_air')) || bot.count('airrune') >= 3 * n);

    // 1. Aereck: start (journal colour turns yellow)
    if (qStatus(bot, 'priest') === 'NOT_STARTED' || qStatus(bot, 'priest') === 'NOT_OBSERVABLE') {
        const ok = await converse(bot, AERECK, {
            plan: [R, M3[2]!, R, R], stand: AERECK_AT, near: 8, label: 'aereck', log: L, maxTicks: 80,
            answers: [/^I'm looking for a quest!$/],
            done: () => qStatus(bot, 'priest') === 'IN_PROGRESS' || hasAmulet(),
        });
        if (!ok) fail(bot, `Aereck: quest did not start (journal ${qStatus(bot, 'priest')})`);
        closeChat(bot);
        L('started');
    }
    // 2. Urhney: amulet
    if (!hasAmulet()) {
        const ok = await converse(bot, URHNEY, {
            plan: [R, M3[1]!, R, R, M2[0]!, R, R, R, R, R, R], stand: URHNEY_AT, near: 6, label: 'urhney', log: L, maxTicks: 300,
            answers: [/^Father Aereck sent me to talk to you\.$/, /^He's got a ghost haunting his graveyard\.$/],
            done: hasAmulet,
        });
        if (!ok) fail(bot, 'Urhney: no amulet');
        closeChat(bot);
        L('amulet');
        // Urhney's shack -> the coffin is ~236 tiles round the swamp fence (~120 t); a Lumbridge Teleport lands ~35 tiles from
        // it. Taken when TWO teleports' runes are held (one stays for the way back from the Wizards' Tower).
        if (!process.env.FA_ONETELE && teleOk(2)) { const r = await tele(bot, 'lumbridge_teleport'); L(`teleport to the coffin ${r.ok}`); }
    }
    check();
    // 3. wear it, walk to the coffin, open it (ghost spawns)
    await wear(bot, AMULET, 3);
    const coffin = locAt(COFFIN_SHUT, COFFIN.x, COFFIN.z, 0);
    const ghostHere = () => !!npc(bot, GHOST);
    const openCoffin = async (label: string) => {
        if (coffinOpen() && ghostHere()) return;
        // open (op1 on the shut coffin) or search (op2 on the open one: also spawns the ghost, quest_priest.rs2:36-37)
        const ok = await walkOp(bot, { x: COFFIN.x, z: COFFIN.z + 1 }, () => {
            if (coffinOpen()) bot.opLoc(COFFIN.x, COFFIN.z, COFFIN_OPEN, 2); else bot.opLoc(coffin.x, coffin.z, coffin.id, 1);
        }, () => coffinOpen() && (label === 'final' || ghostHere()), { maxTicks: 400, near: 1 });
        if (!ok) fail(bot, `coffin (${label}): open=${coffinOpen()} ghost=${ghostHere()}`);
        closeChat(bot);
    };
    if (!bot.isWorn(objId(AMULET))) fail(bot, 'amulet not worn');
    // 4. talk to the ghost until %prieststart = 3 ("It is so dull being a ghost...")
    if (bot.count(SKULL) === 0) {
        await openCoffin('ghost');
        L('coffin open, ghost here');
        const snap = snapText(bot);
        const ok = await converse(bot, GHOST, {
            plan: [R, R, R, R, M3[0]!, R, R, R, R, R, R, R, R, R, R, R, R], near: 8, label: 'ghost', log: L, maxTicks: 80,
            answers: [/^Yep, now tell me what the problem is\.$/],
            // already past this talk (%prieststart 3, a killed run had spoken to him; live acct25 failed it twice):
            // at stage 3 the ghost opens with "How are you doing finding my skull?" (restless_ghost.rs2:53-58)
            // (the planned clicks page through his 4 lines in ~1 tick and only the last text per line survives: match them all)
            done: () => textSince(bot, snap, /so dull being a ghost|How are you doing finding my skull|Keep on looking|somewhere in the tower south west/),
        });
        if (!ok) fail(bot, 'ghost conversation');
        closeChat(bot);
        L('ghost spoken');
        // 5. Wizards' Tower cellar: the skull
        if (!(await opLocUntil(bot, LADDER_TOP, 1, () => bot.tile().z > 6400, 400, { x: 3105, z: 3162 }))) fail(bot, 'tower ladder down');
        L('cellar');
        check();
        const s0 = bot.count(SKULL);
        if (!(await pickup(bot, SKULL, SKULL_AT, 400)) || bot.count(SKULL) <= s0) fail(bot, 'skull pickup');
        L('skull');
    }
    // 6. back to the coffin: teleport if we can, else walk
    const canTele = teleOk(1);
    if (canTele) {
        closeChat(bot);
        if (!(await tele(bot, 'lumbridge_teleport')).ok) L('teleport failed: walking');
        else L('teleported');
    }
    if (bot.tile().z > 6400) {
        if (!(await opLocUntil(bot, LADDER_UP, 1, () => bot.tile().z < 6400, 200))) fail(bot, 'ladder up');
    }
    check();
    if (!coffinOpen()) await openCoffin('final');
    const done = () => qp(bot) > qp0;
    for (let k = 0; k < 4 && !done(); k++) {
        if (!coffinOpen()) await openCoffin('final');
        const slot = bot.slot(SKULL);
        if (slot < 0) fail(bot, 'skull lost');
        if (cheb(bot.tile(), COFFIN) > 1) await walk(bot, { x: COFFIN.x, z: COFFIN.z + 1 }, 1, 'coffin');
        bot.useItemOnLoc(COFFIN.x, COFFIN.z, COFFIN_OPEN, objId(SKULL), slot); bot.queueFlush();
        await bot.until(() => bot.count(SKULL) === 0 || done(), 6);
        await pagesUntil(bot, done, 20);
    }
    if (!done()) fail(bot, 'skull in coffin: no quest complete');
    closeChat(bot);
    return fin(true, `qp ${qp0} -> ${qp(bot)}, prayer ${bot.stat('prayer').level}, amulet worn ${bot.isWorn(objId(AMULET))}`);
}

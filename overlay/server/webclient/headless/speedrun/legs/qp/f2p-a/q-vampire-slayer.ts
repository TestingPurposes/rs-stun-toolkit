// q-vampire-slayer.ts — Vampire Slayer (quest_vampire), cheat-free. f2p-a agent 2.
// Content: areas/area_draynor/scripts/morgan.rs2, areas/area_varrock/scripts/harlow.rs2, quests/quest_vampire/scripts/
// {quest_vampire,count_draynor}.rs2, configs/quest_vampire.constant (started 1, spoke_to_harlow 2), stake.obj
// (tradeable=no), ladders+stairs/scripts/stairs.rs2:408-425 (crypt stairs), quest_haunted.rs2:1-11 (manor front door).
//
// Flow:
//  1. Morgan (npc 755, Draynor house (3098,3268), door 1530 (3098,3270) on its north wall): chatnpc | chatplayer | chatnpc |
//     p_choice3 "Ok, I'm up for an adventure." (option 3 falls through to the same start) | chatplayer | 2 chatnpc ->
//     %vampire = 1 (morgan.rs2:11-26). Observable: the journal colour (questlist:vampire) turns IN_PROGRESS.
//  2. Varrock Teleport (magic 25) -> Jolly Boar Inn (Dr Harlow npc 756 at (3277,3492), jm2 m51_54).
//     Talk 1: p_choice2 "Morgan needs your help" | 6 pages -> spoke_to_harlow (harlow.rs2:9-22).
//     Talk 2 (beer held): beer taken, stake added (harlow.rs2:24-51). The stake is untradeable; beer is SUPPLY.
//  3. Draynor Manor: the front double door 134/135 (3108..3109,3353) opens only from the south and teleports us through
//     (quest_haunted.rs2:4-11, open_and_close_double_doors.rs2); crypt stairs 2616 (3115,3357) -> (3077,9771)
//     (stairs.rs2:412-414).
//  4. Coffin loc_2614 (3077,9775): open -> p_delay(4) -> Count Draynor (757, cl34: att 30 str 25 def 30 hp 35) spawns at
//     (3078,9774), aggressive (quest_vampire.rs2:98-120). Needs %vampire > 0 only (the stake matters at the kill).
//  5. Kill him with the STAKE and a HAMMER in the pack (count_draynor.rs2:57-80: else he regenerates to full). GARLIC in the
//     pack weakens him on the first hit at full hp: hp -10, att -10, str -10, def -40 (count_draynor.rs2:6-17).
//     Completion: queue(quest_vampire_complete, 3): +3 qp, attack +48,250 tenths base (x25).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { R, M2, M3, npc, tele, msgsSince, inDialog } from '../../q-lib.js';
import { converse, mkLog, qp, qStatus, closeChat, pagesUntil, walk, eatWatch, dead, fail, cheb,
    type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';
import { opLocFromTile, doorOpen, gloryTele, gloryHeld } from './fa2-lib.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'Vampire Slayer', dir: 'quest_vampire', qp: 3 };
/** teleport legs (A/B switch FC_TELE): 'harlow' = Varrock Teleport Morgan -> Jolly Boar; 'glory' = amulet of glory Jolly Boar ->
 *  Draynor Village; 'manor' = Varrock Teleport Jolly Boar -> square (used only without 'glory'); 'none' walks */
const TELES = new Set((process.env.FC_TELE || 'harlow,glory').split(',').map(s => s.trim()).filter(s => s && s !== 'none'));
const VT = ['harlow', 'manor'].filter(k => TELES.has(k)).length;   // Varrock Teleports
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0,
    skills: {
        magic: [25, 'Varrock Teleport Morgan -> Jolly Boar (magic_spells varrock_teleport); FC_TELE=none walks'],
        // Count Draynor (cl34; garlic: def -40, hp 25): proven at att/str 40 (rune scimitar), def 20, hp 30, 2 sharks (fight ~30 t).
        // Also completed at att/str 30 (adamant scimitar), def 1, hp 20 (fight 54 t, hp low 11/20) and at 99s (fight 18 t).
        // FC_ATT/FC_STR/FC_DEF/FC_HP override these (sim A/B only).
        attack: [Number(process.env.FC_ATT || 40), 'Count Draynor; rune scimitar (attack 40)'],
        strength: [Number(process.env.FC_STR || 40), 'Count Draynor kill speed'],
        defence: [Number(process.env.FC_DEF || 20), 'Count Draynor hits back (max ~2-3 after garlic)'],
        hitpoints: [Number(process.env.FC_HP || 30), 'Count Draynor; eat at 50%'],
    },
    start: { x: 3098, z: 3272, level: 0 },   // Draynor, outside Morgan's house door
    end: { x: 3077, z: 9774, level: 0 },     // the crypt under Draynor Manor
};
export const SUPPLY: Item[] = [
    { name: 'beer', n: 1 }, { name: 'hammer', n: 1 }, { name: 'garlic', n: 1 },
    // air runes, not a staff of air: the weapon stays wielded (no swaps)
    ...(VT ? [{ name: 'lawrune', n: VT }, { name: 'firerune', n: VT }, { name: 'airrune', n: 3 * VT }] : []),
    ...(TELES.has('glory') ? [{ name: 'amulet_of_glory_4', n: 1 }] : []),
];
const MORGAN = 755, HARLOW = 756, COUNT = 757;
const MORGAN_AT = { x: 3098, z: 3268 }, HARLOW_AT = { x: 3277, z: 3492 };
const MORGAN_DOOR = { id: 1530, x: 3098, z: 3270 };
const FRONT_DOOR = { id: 134, x: 3108, z: 3353 };
const CRYPT_STAIRS = { id: 2616, x: 3115, z: 3357 }, COFFIN = { id: 2614, x: 3077, z: 9775 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L0 = mkLog(bot, 'vamp', !!o.log), L = (s: string) => L0(`${s} [energy ${bot.runEnergy}]`);
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0); }
    finally { stopEat(); }
}

async function body(bot: SpeedBot, L: (s: string) => void, t0: number, qp0: number): Promise<RunResult> {
    const fin = (ok: boolean, msg: string): RunResult => ({ ok, ticks: bot.tickCount - t0, msg });
    const has = (n: string) => bot.count(objId(n)) > 0;
    const check = () => { if (dead(bot)) fail(bot, 'died'); };
    for (const n of ['hammer', 'garlic']) if (!has(n)) fail(bot, `no ${n}`);
    const canTele = () => bot.stat('magic').level >= 25 && bot.count('lawrune') >= 1 && bot.count('firerune') >= 1
        && (bot.isWorn(objId('staff_of_air')) || bot.count('airrune') >= 3);
    const varrockTele = async (why: string) => {
        if (!canTele()) return false;
        closeChat(bot);
        const r = await tele(bot, 'varrock_teleport');
        L(`varrock teleport (${why}) ${r.ok} ${r.ticks}t`);
        return r.ok;
    };
    const started = () => { const s = qStatus(bot, 'vampire'); return s === 'IN_PROGRESS' || s === 'COMPLETE'; };
    const done = () => qp(bot) >= qp0 + QUEST.qp;

    // 1. Morgan: start
    if (!started() && !has('stake')) {
        if (!doorOpen(bot, 0, MORGAN_DOOR.x, MORGAN_DOOR.z) && cheb(bot.tile(), MORGAN_DOOR) <= 6 && bot.tile().z > MORGAN_DOOR.z) {
            await opLocFromTile(bot, { x: MORGAN_DOOR.x, z: MORGAN_DOOR.z + 1 }, MORGAN_DOOR, 1, () => doorOpen(bot, 0, MORGAN_DOOR.x, MORGAN_DOOR.z), 'Morgan door', 30);
            L('morgan door opened');
        }
        const ok = await converse(bot, MORGAN, {
            plan: [R, R, R, M3[1]!, R, R, R, R], stand: MORGAN_AT, near: 6, label: 'morgan', log: L, maxTicks: 120,
            answers: [/^Ok, I'm up for an adventure\.$/], done: started,
        });
        if (!ok) fail(bot, `Morgan: quest did not start (journal ${qStatus(bot, 'vampire')})`);
        // finish his last page: a Varrock Teleport clicked while his script is still suspended was swallowed (fc34: 16 t)
        await pagesUntil(bot, () => !inDialog(bot), 6);
        closeChat(bot);
        L('started');
    }
    check();
    // 2. Dr Harlow: two talks (spoke_to_harlow, then beer -> stake); converse re-talks until the stake is held
    if (!has('stake')) {
        if (!has('beer')) fail(bot, 'no beer');
        if (TELES.has('harlow')) await varrockTele('Morgan -> Jolly Boar');
        const ok = await converse(bot, HARLOW, {
            plan: [R, M2[1]!, R, R, R, R, R, R, R], stand: HARLOW_AT, near: 8, label: 'harlow', log: L, maxTicks: 400, tries: 5,
            answers: [/^Morgan needs your help/, /^Ok mate\.$/], done: () => has('stake'),
        });
        if (!ok) fail(bot, 'Harlow: no stake');
        // finish his last pages instead of CLOSE_MODAL: with the script left suspended, the glory rub's destination choice
        // was swallowed (fc24-fc26: rub 1 printed "You rub the amulet..." but no choice; +4 t each)
        await pagesUntil(bot, () => !inDialog(bot), 8);
        closeChat(bot);
        L('stake');
    }
    check();
    // 3. Draynor Manor -> crypt
    if (bot.tile().z < 6400) {
        // Jolly Boar -> manor door: glory to Draynor Village (101 steps to the door) beats Varrock Teleport (257 steps) and
        // walking (383 steps) (probe2-path; fc21 square -> door 131 t)
        if (TELES.has('glory') && gloryHeld(bot)) { const r = await gloryTele(bot, /^Draynor Village/); L(`glory -> Draynor Village ${r.ok} ${r.ticks}t`); }
        else if (TELES.has('manor')) await varrockTele('Jolly Boar -> manor');
        // the planner has the one-way front door blocked both ways and walks round to the east wing (fc20: Varrock square ->
        // crypt 156 t); enter by the front door explicitly
        const t = bot.tile(), inManor = t.x >= 3091 && t.x <= 3126 && t.z > FRONT_DOOR.z && t.z <= 3374;
        if (!inManor) {
            // from Draynor Village: keep to x=3104 past the Draynor gates 1551/1553 (3107,3273..3274): their OPEN leaf 1552
            // on (3106,3273) walls a tile the planner treats as free, and core walkTo then sat in the traveller for 200+ t
            // (fc30 chaos 4141: 209 t; fc32 chaos 6363: never arrived). Waypoints follow the static path (probe2-path).
            if (cheb(bot.tile(), { x: 3105, z: 3251 }) <= 12) for (const w of [{ x: 3104, z: 3266 }, { x: 3104, z: 3277 }, { x: 3109, z: 3287 }])
                await walk(bot, w, 2, `manor road (${w.x},${w.z})`, 80);
            await walk(bot, { x: FRONT_DOOR.x, z: FRONT_DOOR.z }, 0, 'manor front door (outside)', 400);
            await opLocFromTile(bot, { x: FRONT_DOOR.x, z: FRONT_DOOR.z }, FRONT_DOOR, 1, () => bot.tile().z > FRONT_DOOR.z && bot.tile().z < 6400, 'manor front door', 600);
            L(`in the manor ${JSON.stringify(bot.pos())}`);
        }
        await walk(bot, { x: 3116, z: 3356 }, 1, 'crypt stairs', 200);
        await opLocFromTile(bot, { x: 3116, z: 3356 }, CRYPT_STAIRS, 1, () => bot.tile().z > 6400, 'crypt stairs down', 60);
        L(`crypt ${JSON.stringify(bot.pos())}`);
    }
    check();
    // 4. the coffin -> Count Draynor
    const count = () => npc(bot, COUNT);
    const fightEnd = bot.tickCount + 600;
    let lastOpen = -99, lastAtk = -99, xp0 = -1, lastXp = bot.tickCount;
    while (!done() && bot.tickCount < fightEnd) {
        check();
        if (!has('stake') && !done()) { await pagesUntil(bot, done, 8); if (!done()) fail(bot, 'stake gone but no quest complete'); break; }
        const c = count();
        if (!c) {
            if (bot.tickCount - lastOpen >= 8) {
                closeChat(bot);
                if (cheb(bot.tile(), { x: 3077, z: 9774 }) > 0) await walk(bot, { x: 3077, z: 9774 }, 0, 'coffin', 40);
                bot.opLoc(COFFIN.x, COFFIN.z, COFFIN.id, 1); bot.queueFlush(); lastOpen = bot.tickCount;
                L('coffin opened');
            }
        } else {
            const xp = bot.stat('attack').xp + bot.stat('strength').xp + bot.stat('defence').xp;
            if (xp !== xp0) { xp0 = xp; lastXp = bot.tickCount; }
            // (re)attack: first sight, or no combat xp for 6 ticks (a missed click; re-sending every tick would reset nothing
            // useful and floods the queue)
            if (lastAtk < 0 || (bot.tickCount - lastXp >= 6 && bot.tickCount - lastAtk >= 6)) {
                if (bot.chatModalId !== -1) closeChat(bot);
                bot.opNpc(c.idx, 2); bot.queueFlush(); lastAtk = bot.tickCount;
            }
            if ((bot.tickCount - t0) % 10 === 0) L(`fight: hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level} count d ${c.d} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 10))}`);
        }
        await bot.tick(1);
    }
    await pagesUntil(bot, done, 10);
    if (!done()) fail(bot, `Count Draynor: no quest complete (msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 30))})`);
    closeChat(bot);
    return fin(true, `qp ${qp0} -> ${qp(bot)}, attack ${bot.stat('attack').level}, hp ${bot.stat('hitpoints').cur}`);
}

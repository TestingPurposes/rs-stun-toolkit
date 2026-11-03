// q-rune-mysteries.ts — Rune Mysteries (quest_runemysteries), cheat-free speedrun rebuild (lane rebuild).
// Content (rev 289, ~/sim/rs-qp/server/content/scripts):
//   areas/area_lumbridge/scripts/duke_horacio.rs2:1-39, areas/area_wizard_tower/scripts/sedridor.rs2:1-180,
//   areas/area_varrock/scripts/aubury.rs2:1-61, quests/quest_runemysteries/scripts/quest_runemysteries.rs2:1-4
//   (%runemysteries: started 1, given_talisman 2, received_package 3, given_package 4, received_notes 5, complete).
//
// Flow (every step gates on an observable item / qp):
//  1. Duke Horacio (npc duke_of_lumbridge, Lumbridge castle L1): chatnpc | multi2 "Have you any quests for me?" | chatplayer |
//     3 chatnpc | p_choice2 "Sure, no problem." | chatplayer | chatnpc | mesbox -> air_talisman (duke_horacio.rs2:22-35).
//  2. Sedridor (npc head_wizard, Wizards' Tower cellar): chatnpc | p_choice3 "I'm looking for the head wizard." | 4 pages |
//     p_choice2 "Ok, here you are." | chatplayer | mesbox (talisman taken) | 8 chatnpc | p_choice2 "Yes, certainly." |
//     chatplayer | 2 chatnpc | mesbox -> research_package | chatnpc (sedridor.rs2:48-130).
//  3. Varrock Teleport -> Aubury (rune shop): USE the package on him (opnpcu -> aubury_package, aubury.rs2:37-61: one page
//     less than the multi3 route) -> given_package; talk again: 3 chatnpc -> research_notes (aubury.rs2:2-8).
//  4. Back to the tower (glory -> Draynor Village, or Lumbridge Teleport) and USE the notes on Sedridor (opnpcu ->
//     head_wizard_notes, sedridor.rs2:44-47): ~28 pages -> queue(rune_mysteries_complete): +1 qp, air talisman back.
// Ends in the Wizards' Tower cellar (underground: the route teleports out).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { R, M2, M3, tele, inDialog, npc } from '../../q-lib.js';
import { converse, opLocUntil, mkLog, qp, closeChat, pagesUntil, wear, walk, eatWatch, dead, fail, cheb,
    type Item, type QuestDef, type Requirements, type RunResult } from '../f2p-a/fa-lib.js';
import { gloryTele, gloryHeld, doorOpen } from '../f2p-a/fa2-lib.js';
import { NO_GLORY } from '../noglory.js';
import { go } from '../f2p-b/fb-lib.js';
import { npcId, talkRb } from './rb-lib.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'Rune Mysteries', dir: 'quest_runemysteries', qp: 1 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0,
    skills: { magic: [25, 'Varrock Teleport (magic_spells.dbrow varrock_teleport level 25)'] },
    start: { x: 3221, z: 3218, level: 0 },   // Lumbridge Teleport landing (castle courtyard)
    end: { x: 3103, z: 9571, level: 0 },     // Sedridor, Wizards' Tower cellar
};
/** Varrock Teleport (1 law, 1 fire, 3 air: the staff of air replaces the air) + a glory for the way back to the tower */
export const SUPPLY: Item[] = [
    { name: 'lawrune', n: 1 }, { name: 'firerune', n: 1 }, { name: 'staff_of_air', n: 1 }, { name: 'amulet_of_glory_4', n: 1 },
    // RB_RM_BACK=lumb (A/B; the charger's glory-free default, see legBack): a Lumbridge Teleport back instead of the glory
    ...(rmBack() === 'lumb' ? [{ name: 'lawrune', n: 2 }, { name: 'earthrune', n: 1 }] : []),
];

/** Aubury -> tower. Glory-free (SR_NO_GLORY, charger cg12p): no glory is held, so 'glory' walked Varrock -> tower (185 t);
 *  a Lumbridge Teleport + the walk is ~110 t shorter. */
function rmBack(): string { return process.env.RB_RM_BACK ?? (NO_GLORY() ? 'lumb' : 'glory'); }

const DUKE = npcId('duke_of_lumbridge'), SEDRIDOR = npcId('head_wizard'), AUBURY = npcId('aubury');
const DUKE_ROOM = { x: 3209, z: 3220, level: 1 };
const LADDER_TOP = { id: 2147, x: 3104, z: 3162 };   // Wizards' Tower trapdoor ladder -> cellar (ladders.rs2)
const SED_AT = { x: 3103, z: 9571 };
const AUBURY_AT = { x: 3253, z: 3402 };
const TALISMAN = 'air_talisman', PACKAGE = 'research_package', NOTES = 'research_notes';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'rm', !!o.log);
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0); }
    finally { stopEat(); }
}

/** down the tower trapdoor ladder (from anywhere on the surface near the tower) */
async function toCellar(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (bot.tile().z > 6400) return;
    if (bot.minusedlevel !== 0) await walk(bot, { x: 3105, z: 3162, level: 0 }, 3, 'tower');
    if (!(await opLocUntil(bot, LADDER_TOP, 1, () => bot.tile().z > 6400, 400, { x: 3105, z: 3162 }))) fail(bot, 'tower ladder down');
    L(`cellar ${JSON.stringify(bot.pos())}`);
    // into Sedridor's room past the open leaf 1531 (N edge of 3107,9570): an OPNPC from the landing is routed naively by the
    // engine and parks at (3108,9570) (probe-cellar); core walkTo gets to (3104,9572) in ~7 t
    if (process.env.RB_RM_CELLAR !== 'op') await bot.walkTo(3104, 9572, { near: 1, maxTicks: 20, log: false });
}

/**
 * Courtyard -> Duke's room. LeanBot's multi-level traveller took 62-73 t (probe-walk: 9 t at the open front-door leaf 1517
 * (3216,3218), 8 t at the open leaf 1537 (3215,3212), 29 t outside the Duke's door). Explicit: fb-lib go() (planner walls
 * for open leaves) to the south staircase 1738 (3204,3207, 2x2) -> climb (lands 1,3205,3209) -> open the Duke's door 1536
 * (1,3207,3222, east edge) if shut -> the conversation op routes the rest. RB_RM_DUKE=walk keeps the traveller.
 */
async function dukeRoom(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (process.env.RB_RM_DUKE === 'walk') { await walk(bot, DUKE_ROOM, 0, 'Duke room'); L(`duke room ${JSON.stringify(bot.pos())}`); return; }
    if (bot.minusedlevel === 0) {
        await go(bot, { x: 3205, z: 3209 }, 1, 'castle stairs', 120);
        if (!(await opLocUntil(bot, { id: 1738, x: 3204, z: 3207 }, 1, () => bot.minusedlevel === 1, 30))) fail(bot, 'castle stairs up');
        L(`castle L1 ${JSON.stringify(bot.pos())}`);
    }
    if (!doorOpen(bot, 1, 3207, 3222)) {
        await go(bot, { x: 3207, z: 3222 }, 0, 'duke door', 60, 1);
        if (!(await opLocUntil(bot, { id: 1536, x: 3207, z: 3222, level: 1 }, 1, () => doorOpen(bot, 1, 3207, 3222), 12, { x: 3207, z: 3222 }))) L('duke door: no open leaf seen');
    }
    L(`duke door ${JSON.stringify(bot.pos())}`);
}

async function body(bot: SpeedBot, L: (s: string) => void, t0: number, qp0: number): Promise<RunResult> {
    const fin = (ok: boolean, msg: string): RunResult => ({ ok, ticks: bot.tickCount - t0, msg });
    const has = (o: string) => bot.count(o) > 0;
    if (bot.count('staff_of_air') > 0) await wear(bot, 'staff_of_air', 4);
    const legOut = process.env.RB_RM_OUT ?? 'glory';     // Duke -> tower: walk | glory
    const legBack = rmBack();  // Aubury -> tower: glory | lumb | walk
    const done = () => qp(bot) > qp0;

    // 1. Duke: talisman
    if (!has(TALISMAN) && !has(PACKAGE) && !has(NOTES)) {
        await dukeRoom(bot, L);
        const ok = await talkRb(bot, DUKE, {
            plan: [R, M2[0]!, R, R, R, R, M2[0]!, R, R, R], stand: DUKE_ROOM, near: 10, label: 'duke', log: L, maxTicks: 120,
            answers: [/^Have you any quests for me\?$/, /^Sure, no problem\.$/], done: () => has(TALISMAN),
        });
        if (!ok) fail(bot, 'Duke: no talisman');
        await pagesUntil(bot, () => !inDialog(bot), 6);
        closeChat(bot);
        L('talisman');
    }
    // 2. Sedridor: package
    if (has(TALISMAN) && !has(PACKAGE) && !has(NOTES)) {
        if (legOut === 'glory' && gloryHeld(bot)) { const r = await gloryTele(bot, /Draynor/); L(`glory draynor ${r.ok} ${r.ticks}t`); }
        await toCellar(bot, L);
        const ok = await talkRb(bot, SEDRIDOR, {
            plan: [R, M3[2]!, R, R, R, R, M2[0]!, R, R, R, R, R, R, R, R, R, R, M2[0]!, R, R, R, R, R],
            stand: SED_AT, near: 10, label: 'sedridor1', log: L, maxTicks: 150,
            answers: [/^I'm looking for the head wizard\.$/, /^Ok, here you are\.$/, /^Yes, certainly\.$/], done: () => has(PACKAGE),
        });
        if (!ok) fail(bot, 'Sedridor: no package');
        // finish his last page: a teleport sent while an npc script is suspended is swallowed (f2p-a STATUS trap)
        await pagesUntil(bot, () => !inDialog(bot), 8);
        closeChat(bot);
        L('package');
    }
    if (dead(bot)) fail(bot, 'died');
    // 3. Aubury: package -> notes
    if (has(PACKAGE) || (!has(NOTES) && !done())) {
        if (bot.tile().z > 6400 || cheb(bot.tile(), AUBURY_AT) > 60) {
            const r = await tele(bot, 'varrock_teleport');
            if (!r.ok) fail(bot, 'Varrock Teleport');
            L(`varrock tele ${r.ticks}t`);
        }
        if (has(PACKAGE)) {
            const ok = await talkRb(bot, AUBURY, {
                useItem: PACKAGE, plan: [R, R, R, R, R], stand: AUBURY_AT, near: 8, label: 'aubury-pkg', log: L, maxTicks: 200,
                answers: [/^I have been sent here with a package for you\.$/], done: () => !has(PACKAGE),
            });
            if (!ok) fail(bot, 'Aubury: package not taken');
            await pagesUntil(bot, () => !inDialog(bot), 6);
            closeChat(bot);
        }
        const ok = await talkRb(bot, AUBURY, {
            plan: [R, R, R, R, R], stand: AUBURY_AT, near: 8, label: 'aubury-notes', log: L, maxTicks: 80,
            answers: [/^Oh, it's a rune shop\. No thank you, then\.$/], done: () => has(NOTES),
        });
        if (!ok) fail(bot, 'Aubury: no notes');
        await pagesUntil(bot, () => !inDialog(bot), 6);
        closeChat(bot);
        L('notes');
    }
    // 4. back to Sedridor
    if (!has(NOTES) && !done()) fail(bot, 'notes missing');
    if (bot.tile().z < 6400) {
        if (legBack === 'glory' && gloryHeld(bot)) { const r = await gloryTele(bot, /Draynor/); L(`glory draynor ${r.ok} ${r.ticks}t`); }
        else if (legBack === 'lumb') { const r = await tele(bot, 'lumbridge_teleport'); L(`lumbridge tele ${r.ok} ${r.ticks}t`); }
        await toCellar(bot, L);
    }
    if (!done()) {
        const ok = await talkRb(bot, SEDRIDOR, {
            useItem: NOTES, plan: Array(30).fill(R), stand: SED_AT, near: 10, label: 'sedridor2', log: L, maxTicks: 200,
            answers: [], done,
        });
        if (!ok) fail(bot, 'Sedridor: no quest complete');
    }
    await pagesUntil(bot, () => !inDialog(bot), 6);
    closeChat(bot);
    return fin(true, `qp ${qp0} -> ${qp(bot)}, talisman ${has(TALISMAN)}`);
}


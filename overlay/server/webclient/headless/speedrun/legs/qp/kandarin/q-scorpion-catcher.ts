// q-scorpion-catcher.ts — Scorpion Catcher (1 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// Verified flow (paths relative to server/content/scripts/; %scorpcatcher stages quest_scorpcatcher.constant):
//   1. Thormac (389, Sorcerer's Tower L3 2702,3405; ladders 2701,3408 / 2704,3403 / 2699,3405): "What do you need
//      assistance with?" -> "What's in it for me?" -> "Ok, I will do it then." -> %scorpcatcher 1 + empty cage
//      (areas/area_seers/scripts/thormac.rs2:8-50; the "how would I catch them" branch costs an if_close + p_delay(4)).
//   2. Seer (388, 2702,3475): "I need to locate some scorpions." -> looking glass -> %scorpcatcher 2
//      (area_seers/scripts/seer.rs2:1-5,36-60). Only stage 2 matters: it opens the Taverley secret wall
//      (quests/quest_scorpcatcher/scripts/quest_scorpcatcher.rs2:45-53). The second hint and Peksa are NOT needed:
//      catching (opnpcu questscorpiona/b/c) checks only the cage held (:14-39), Thormac only the full cage
//      (thormac.rs2:52-58).
//   3. Scorpion B (386, Barbarian Outpost 2552,3570): the outpost gate needs Alfred Grimhand's Barcrawl while its
//      guard stands by (areas/area_barbarian_outpost/scripts/outpost_gate.rs2:1-11).
//   4. Scorpion A (385, Taverley dungeon 2877,9796) behind the secret wall (loc 2117, 2875,9799), which lies past the
//      dusty-key door (Velrak's key; the jailer's key opens his cell).
//   5. Scorpion C (387, Edgeville monastery L1 3058,3488): Abbot Langley lets members up the ladder; joining needs
//      prayer 31 BASE (areas/monastery/scripts/prayer_guild.rs2 ask_to_join_abbot_langley2, abbot_langley.rs2:1-10).
//   6. Thormac with the full cage -> complete: 1 QP, stat_advance strength 66250 (tenths) (quest_scorpcatcher.rs2:55-60).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { nav, inDialog, locAt, tele, npc, qp, openDoorAt } from '../../q-lib.js';
import { runQuest, talkNpc, heard, fail, checkAlive, opLocUntil, useOnLocUntil, walk, rubGlory, dead, fight, pickup, type Item, type RunResult } from './ka-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Scorpion Catcher', dir: 'quest_scorpcatcher', qp: 1 };
export const REQUIREMENTS = {
    quests: ["Alfred Grimhand's Barcrawl"], qp: 0,   // the outpost gate guard (outpost_gate.rs2:2-6)
    skills: {
        prayer: [31, 'BASE level: Abbot Langley lets you join (prayer_guild.rs2, stat_base)'],
        magic: [45, 'Falador + Camelot teleports'],
    } as Record<string, [number, string]>,
    start: { x: 2702, z: 3399, level: 0 },   // outside the Sorcerer's Tower door
    end: { x: 2702, z: 3405, level: 3 },     // Thormac
};
export const SUPPLY: Item[] = [
    { name: 'amulet_of_glory_4', n: 1 },   // Edgeville (monastery); any glory with a charge
    { name: 'lawrune', n: 2 }, { name: 'airrune', n: 8 }, { name: 'waterrune', n: 1 },   // Falador + Camelot
    { name: 'rune_scimitar', n: 1 },   // the jailer (wielded by run())
    { name: 'shark', n: 6 },
];

const THORMAC = 389, SEER = 388, SCORP_A = 385, SCORP_B = 386, SCORP_C = 387, ABBOT = 801;
const CAGES = ['scorpioncageempty', 'scorpioncagea', 'scorpioncageb', 'scorpioncagec', 'scorpioncageab', 'scorpioncageac', 'scorpioncagebc', 'scorpioncagefull'];

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    return runQuest(bot, QUEST, async st => {
        await nav();
        const cage = () => CAGES.find(c => bot.count(c) > 0) ?? null;
        if (bot.count('rune_scimitar') > 0) { bot.opHeld2(objId('rune_scimitar'), bot.slot('rune_scimitar')); bot.queueFlush(); }
        const towerUp = async () => {
            const l0 = locAt(1747, 2701, 3408, 0), l1 = locAt(1747, 2704, 3403, 1), l2 = locAt(1747, 2699, 3405, 2);
            if (bot.minusedlevel === 0 && !(await opLocUntil(bot, l0, 1, () => bot.minusedlevel === 1, { maxTicks: 200 }))) fail(bot, 'tower ladder 1');
            if (bot.minusedlevel === 1 && !(await opLocUntil(bot, l1, 1, () => bot.minusedlevel === 2, { maxTicks: 30 }))) fail(bot, 'tower ladder 2');
            if (bot.minusedlevel === 2 && !(await opLocUntil(bot, l2, 1, () => bot.minusedlevel === 3, { maxTicks: 30 }))) fail(bot, 'tower ladder 3');
        };
        // catch: use the current cage on the scorpion (it wanders: re-target every few ticks)
        const caught = async (type: number, at: { x: number; z: number }, label: string) => {
            const c0 = cage();
            for (let k = 0; k < 12 && cage() === c0; k++) {
                checkAlive(bot);
                const s = npc(bot, type);
                if (!s || s.d > 12) { await walk(bot, at, null, () => dead(bot) || (npc(bot, type)?.d ?? 99) <= 8, { near: 2, maxTicks: 400 }); continue; }
                const cid = objId(c0!);
                await walk(bot, { x: s.x, z: s.z }, () => { const m = npc(bot, type); if (m) bot.useItemOnNpc(m.idx, cid, bot.slot(cid)); }, () => cage() !== c0 || dead(bot), { near: 1, maxTicks: 60 });
                if (cage() === c0) { const m = npc(bot, type); if (m && m.d <= 1) { bot.useItemOnNpc(m.idx, cid, bot.slot(cid)); bot.queueFlush(); } await bot.until(() => cage() !== c0, 4); }
                // session 11 fix 356a (qx170m 'scorpion C (cage scorpioncageab) at (3059,3492,L1)', 1,566 t): the chaos doors let
                // scorpion C through the monastery L1 door (loc_1530 @ 3059,3493, closed by default) and then shut it. We stood 1
                // tile south of the wall and every OPNPCU was dropped as unreachable (eng optrace 'target cleared' x297). Open the
                // door between us. SC_DOORC=0 reverts.
                if (cage() === c0 && label === 'C' && process.env.SC_DOORC !== '0' && bot.minusedlevel === 1 && bot.tile().z <= 3492 && (npc(bot, type)?.z ?? 0) >= 3493
                    && openDoorAt(bot, 1530, 3059, 3493, 1)) { console.log(`[scorpion] fix 356a: scorpion C behind the L1 door: opening it`); await bot.tick(3); }
            }
            if (cage() === c0) fail(bot, `scorpion ${label} (cage ${c0})`);
        };
        // session 10: on a retry / resume, the scorpions in the cage (its id) and the Seer's hint (the quest JOURNAL) are not
        // redone. All false on a fresh attempt. SC_RESUME=0 reverts.
        const at = (k: string) => { st.at(k); failHook(k); };
        const R0 = { cage: false, hint: false, A: false, B: false, C: false };
        if (isResuming(bot) && process.env.SC_RESUME !== '0') {
            const c0 = cage() ?? '';
            R0.cage = !!c0; R0.A = /cage(a|ab|ac|full)$/.test(c0); R0.B = /cage(b|ab|bc|full)$/.test(c0); R0.C = /cage(c|ac|bc|full)$/.test(c0);
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            const j = await readJournal(bot, 'scorpcatcher');
            if (j.ok && /QUEST COMPLETE/i.test(j.text)) return;
            R0.hint = j.ok && /spoken to a Seer and been given the location/i.test(j.text);
            console.log(`[scorpion] resume: ${JSON.stringify(R0)} (cage ${c0 || '-'}, journal ${j.ok ? 'ok' : 'UNREADABLE'})`);
        }
        let t = bot.tickCount;
        // 1. Thormac (L3): start
        if (!R0.cage) {
        await towerUp();
        // session 11: a started quest with no cage in pack or bank gets the 'I've lost my cage.' choice (thormac.rs2:76-90):
        // take it, Thormac hands out another cage (fork qya02: both attempts died on that unplanned choice). SC_LOSTCAGE=0 reverts.
        const lost = process.env.SC_LOSTCAGE !== '0' ? [/^I've lost my cage/] : [];
        // the new cage needs a free slot ('free some space and come back', qya03: 28-slot pack): drop one food item
        if (lost.length && bot.free() < 1) {
            const f = ['lobster', 'shark'].map(n => objId(n)).find(id => bot.count(id) > 0);
            if (f !== undefined) { bot.dropItem(f, bot.slot(f)); bot.queueFlush(); await bot.until(() => bot.free() > 0, 4); }
        }
        if (!(await talkNpc(bot, THORMAC, { x: 2702, z: 3405 }, [/^What do you need assistance with/, /^What's in it for me/, /^Ok, I will do it then/, ...lost], () => !!cage() && !inDialog(bot), { label: 'thormac1' }))) fail(bot, 'Thormac start');
        at('cage');
        const down = [locAt(1746, 2699, 3405, 3), locAt(1746, 2704, 3403, 2), locAt(1746, 2701, 3408, 1)];
        for (const [i, l] of down.entries()) if (!(await opLocUntil(bot, l, 1, () => bot.minusedlevel === 2 - i, { maxTicks: 30 }))) fail(bot, `tower down ${i}`);
        }
        // 2. Seer: the first hint
        if (!R0.hint) {
        t = bot.tickCount;
        if (!(await talkNpc(bot, SEER, { x: 2702, z: 3475 }, [/^I need to locate some scorpions/], () => heard(bot, /going through some crack in the wall|secret room/, t), { label: 'seer', maxTicks: 300 }))) fail(bot, 'Seer');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        at('hint');
        }
        // 3. Barbarian Outpost: scorpion B
        if (!R0.B) {
        // the outpost gate (loc 2116, 2545,3569) is scripted: op it from the west, it puts you on (2546,z)
        const ogate = locAt(2116, 2545, 3569, 0);
        if (!(await opLocUntil(bot, ogate, 1, () => bot.tile().x >= 2546 && Math.abs(bot.tile().z - 3569) <= 6, { maxTicks: 500, every: 6, stand: { x: 2545, z: 3569 } }))) fail(bot, 'outpost gate (Barcrawl?)');
        await caught(SCORP_B, { x: 2552, z: 3570 }, 'B');
        at('scorpion-b');
        }
        // 4. Falador teleport, Taverley dungeon, secret wall, scorpion A
        if (!R0.A) {
        if (!(R0.cage && bot.tile().z > 6400) && !(await tele(bot, 'falador_teleport')).ok) fail(bot, 'falador teleport');
        const ladder = locAt(1759, 2884, 3397, 0);
        if (!(await opLocUntil(bot, ladder, 1, () => bot.tile().z > 6400, { maxTicks: 200 }))) fail(bot, 'Taverley dungeon ladder');
        // The secret wall's side (2875,9799) is NOT connected to the entrance ladder: only through the dusty-key door
        // (loc 2623, 2924,9803; areas/area_taverly/dungeon/scripts/jail_doors.rs2:8-35; probe-walk.ts from (2876,9805)
        // stalls at (2880,9801)). Dusty key: Velrak (798, cell 2931,9685) after the cell door (loc 2631, 2931,9690) is
        // unlocked with the jailer's key (jailer 201 at 2933,9693 drops it: drop tables/scripts/jailer.rs2:10)
        // (velrak_the_explorer.rs2:1-20). Both keys are untradeable.
        const JAILER = 201, VELRAK = 798;
        if (bot.count('dusty_key') === 0) {
            if (bot.count('jail_key') === 0) {
                if (!(await walk(bot, { x: 2933, z: 9693 }, null, () => dead(bot) || (npc(bot, JAILER)?.d ?? 99) <= 6, { near: 3, maxTicks: 200 }))) fail(bot, 'to the jailer');
                const jk = objId('jail_key');
                if (!(await fight(bot, JAILER, () => !!bot.findGroundItem(jk, 8) || bot.count(jk) > 0, { maxTicks: 200, label: 'jailer' }))) fail(bot, 'jailer');
                const g = bot.findGroundItem(jk, 8);
                if (g && !(await pickup(bot, jk, { x: g.x, z: g.z }))) fail(bot, 'jail key');
            }
            const cell = locAt(2631, 2931, 9690, 0);
            if (!(await useOnLocUntil(bot, 'jail_key', cell, () => bot.tile().z < 9690, { maxTicks: 40, every: 6 }))) fail(bot, 'cell door');
            if (!(await talkNpc(bot, VELRAK, { x: 2931, z: 9685 }, [/^So\.\.\. do you know anywhere good to explore/, /^Yes please/], () => bot.count('dusty_key') > 0, { label: 'velrak' }))) fail(bot, 'Velrak');
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            if (!(await opLocUntil(bot, cell, 1, () => bot.tile().z >= 9690, { maxTicks: 30, every: 6 }))) fail(bot, 'out of the cell');
        }
        at('dusty-key');
        // the inner part (blue dragons, a lesser demon, poison spiders on the way to the secret wall): Protect from Melee
        if (bot.stat('prayer').cur >= 43 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
        const ddoor = locAt(2623, 2924, 9803, 0);
        if (!(await useOnLocUntil(bot, 'dusty_key', ddoor, () => bot.tile().x <= 2923 && Math.abs(bot.tile().z - 9803) <= 2, { maxTicks: 300, every: 6 }))) fail(bot, 'dusty key door');
        const wall = locAt(2117, 2875, 9799, 0);
        t = bot.tickCount;
        // the secret door walks you through itself (open_and_close_door2): from (2875,9799) to (2875,9798) (probe-door.ts)
        if (!(await opLocUntil(bot, wall, 1, () => heard(bot, /found a secret door/, t) && bot.tile().z <= 9798, { maxTicks: 120, every: 6, stand: { x: 2875, z: 9799 } }))) fail(bot, 'secret wall');
        at('secret-room');
        await caught(SCORP_A, { x: 2877, z: 9796 }, 'A');
        at('scorpion-a');
        if (bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        }
        // 5. glory -> Edgeville, Abbot Langley (join), ladder, scorpion C
        if (!R0.C) {
        if (!(await rubGlory(bot, /^Edgeville/))) fail(bot, 'glory Edgeville');
        t = bot.tickCount;
        // session 11 fix 356b (qx170m retry 'Abbot Langley (prayer 31 base?)', steps {}): attempt 1 had already joined
        // (%prayer_guild = 1, a perm varp the client never sees). A member gets only 'Can you heal me? | Isn't this place built
        // a bit out the way?' (abbot_langley.rs2:9-13): no 'How do I get further', so 3 x unplanned choice. That member menu
        // counts as joined (the modal is closed below). SC_MEMBER=0 reverts.
        const member = () => process.env.SC_MEMBER !== '0' && bot.dialogOptions().some(o => /^Isn't this place built/.test(o.text)) && !bot.dialogOptions().some(o => /^How do I get further/.test(o.text));
        if (!(await talkNpc(bot, ABBOT, { x: 3058, z: 3484 }, [/^How do I get further into the monastery/, /^Well can I join your order/], () => heard(bot, /suitable for our order/, t) || member(), { label: 'abbot', maxTicks: 200 }))) fail(bot, 'Abbot Langley (prayer 31 base?)');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        // session 11 fix 356b TEST: fail a fresh attempt right after joining so the route retry meets the member menu. Off by default.
        if (process.env.SC_TEST_REJOIN === '1' && !isResuming(bot)) fail(bot, 'TEST 356b: fail after joining');
        const mladder = locAt(2641, 3057, 3483, 0);
        if (!(await opLocUntil(bot, mladder, 1, () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail(bot, 'monastery ladder');
        await caught(SCORP_C, { x: 3058, z: 3488 }, 'C');
        if (bot.count('scorpioncagefull') === 0) fail(bot, `cage not full (${cage()})`);
        at('scorpion-c');
        }
        // 6. Camelot teleport, Thormac
        if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport');
        await towerUp();
        const qp0 = qp(bot);
        if (!(await talkNpc(bot, THORMAC, { x: 2702, z: 3405 }, [], () => qp(bot) >= qp0 + QUEST.qp, { label: 'thormac2', closedTicks: 6 }))) fail(bot, 'Thormac reward');
        at('done');
    }, o.log !== false);
}

// q-priest-in-peril.ts — Priest in Peril (rev 289), cheat-free quest code, through stage 61 (holy barrier access, the
// gate for Nature Spirit / Morytania). Content: quests/quest_priestperil/*, areas/area_varrock/scripts/king_roald.rs2,
// areas/area_mausoleum/scripts/{drezel,monuments,well,gates,holy_barrier,temple_guardian}.rs2.
//
// Stages (priestperil.constant) and the step that sets each:
//   1  King Roald (3222,3476): "Sure."                                       king_roald.rs2:55 -> priestperil.rs2:2
//   2  knock at the temple door (3408,3488) from outside, "Roald sent me", "Sure."   temple_doors.rs2:20-79
//   3  kill the Temple guardian (3405,9902) under the mausoleum trapdoor (3405,3507)  temple_guardian.rs2:1-12
//   4  King Roald again                                                     king_roald.rs2:69-79
//   -  a Monk of Zamorak (priestperilevilmonk3, npc 1046) drops the golden key while stage < 6 (evil_monks.rs2:47-49)
//   5  talk through the cell door (3415,3489,L2), "Tell me anyway", "Yes."  trapped_drezel.rs2:59-141
//   -  gate 1 (3405,9895) opens at >= 5 (gates.rs2:1-9); golden key on monument 3 -> iron key: the monument layout seed
//      is generated only by STUDYING a monument (monuments.rs2:18-21); never studied, the seed is 0 and the iron key sits
//      on grave (0 + 3*17) % 7 + 1 = 3 -> priestperil_grave_base3 = loc 3495 (3428,9890) (monuments.rs2:50-76)
//   -  bucket on the well (3423,9890) -> murky water (well.rs2:8-15)
//   6  iron key on the cell door (trapped_drezel.rs2:39-51); the door then opens (teleports through, :32-37)
//   -  murky water on Drezel -> blessed water (trapped_drezel.rs2:26-29,147-153)
//   7  blessed water on the coffin (3413,3486,L2) (vampire_coffin.rs2:8-17)
//   8  talk to Drezel (trapped_drezel.rs2:16-20)
//   10 Drezel in the mausoleum (3440,9895; east trapdoor 3422,3485 -> 3440,9887, holy_barrier.rs2:11-20) (drezel.rs2:30-48)
//   60 50 UNNOTED rune essence used on him (one per stage; notes refused) (drezel.rs2:22-27,75-107) -> queue complete
//      (wolfbane dagger, prayer 14060 tenths, 1 QP; priestperil.rs2:7-11)
//   61 talk to him once more (drezel.rs2:8-13,138-147): the holy barrier then lets you through (holy_barrier.rs2:1-9)
//
// The pack holds 28: at most 23 essence ride in from the start (bucket, 3 rune stacks, key slot); the other 27 come from the bank
// (Varrock east, via Varrock Teleport) or from a helper (o.restock) after the first 23 are handed in.
import { SpeedBot, objId, cheb } from '../../../core.js';
import { nav, talk, npc, npcsOf, inDialog, walkOp, locAt, dismiss, tele, waitText, opNpcGo, R, M2, M4, qp, type FTok } from '../../q-lib.js';
import { openBooth, swap } from '../../run-lib.js';
import { talkAt, trapdoorDown, fail, has, stamp, withSafety, kill, opUntil, useOnLocUntil, useOnNpcUntil, pickup, type Item, type QuestMeta, type Reqs, type RunResult } from './mo-lib.js';
import { failHook } from '../journal.js';

export const QUEST: QuestMeta = { name: 'Priest in Peril', dir: 'quest_priestperil', qp: 1 };
export const REQUIREMENTS: Reqs = {
    quests: [], qp: 0,
    skills: {
        attack: [40, 'rune scimitar for the Temple guardian (cl30, 45 hp) and a Monk of Zamorak (golden key); sim-proven level, see STATUS.md'],
        magic: [25, 'Varrock Teleport x2 (back to King Roald; the bank restock), magic_spells.dbrow:62-69'],
    },
    start: { x: 3221, z: 3473, level: 0 },   // next to King Roald, Varrock palace
    end: { x: 3440, z: 9893, level: 0 },     // next to Drezel in the mausoleum, stage 61
};
/** Carried in at the start. 23 essence is the most that fits next to the bucket, the 3 rune stacks and the key slot. */
export const ESS_START = 23;
export const SUPPLY: Item[] = [
    { name: 'blankrune', n: ESS_START }, { name: 'bucket_empty', n: 1 },
    { name: 'lawrune', n: 2 }, { name: 'airrune', n: 6 }, { name: 'firerune', n: 2 },
];
/** In the bank (Varrock east) for the restock, or handed over by a helper at Drezel (o.restock). */
export const SUPPLY_BANK: Item[] = [{ name: 'blankrune', n: 50 - ESS_START }];
/** Helper variant (o.restock): one Varrock Teleport only; the helper hands over SUPPLY_BANK at the mausoleum trapdoor. */
export const SUPPLY_HELPER: Item[] = [{ name: 'blankrune', n: ESS_START }, { name: 'bucket_empty', n: 1 }, { name: 'lawrune', n: 1 }, { name: 'airrune', n: 3 }, { name: 'firerune', n: 1 }];
export const WEAR = ['rune_scimitar'];

const ROALD_AT = { x: 3221, z: 3474 };
const ROALD = 648, MONK3 = 1046, DOG = 1047, DREZEL = 1048, DREZEL2 = 1049;
const KEY_GOLD = 'pipkey_gold', KEY_IRON = 'pipkey_iron', MURKY = 'bucket_murkywater', BLESSED = 'bucket_blessedwater';
const DOOR_OUT = { x: 3408, z: 3488 }, DOOR_IN = { x: 3409, z: 3488 };
const inTemple = (b: SpeedBot) => { const t = b.tile(); return b.minusedlevel === 0 && t.x >= 3409 && t.x <= 3420 && t.z >= 3481 && t.z <= 3496; };
const underground = (b: SpeedBot) => b.tile().z > 6400;

export interface PipOpts { log?: boolean; sim?: boolean; from?: string; restock?: (need: number) => Promise<void>; walkToRoald?: boolean;
    /** session 9: true at restock time = the helper waits in the trapdoor cellar (north of gate 1): meet it there, no ladder climb */
    meetBelow?: () => boolean }

export async function run(bot: SpeedBot, o: PipOpts = {}): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, qp0 = qp(bot), v = o.log !== false;
    // failHook (resume proofs): SR_FAIL_AT=pip:<mark> throws once right after that mark
    const at = (k: string) => { stamp(bot, t0, k, v); failHook(`pip:${k}`); };
    try {
        await withSafety(bot, 'priest-in-peril', () => body(bot, o, at));
    } catch (e) { return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    const ok = qp(bot) >= qp0 + QUEST.qp || has(bot, 'dagger_wolfbane');
    return { ok, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}, wolfbane ${has(bot, 'dagger_wolfbane')}` };
}

/** chat pages wrap long lines over several text components: test each one AND their join */
const seenText = (bot: SpeedBot, re: RegExp) => { const v = [...bot.ifText.values()]; return v.some(x => re.test(x)) || re.test(v.join(' ')); };

async function body(bot: SpeedBot, o: PipOpts, at: (k: string) => void): Promise<void> {
    const door = locAt(3490, 3408, 3488, 0);
    const trap = { x: 3405, z: 3507 };
    const stairsUp = locAt(1738, 3417, 3484, 0), ladderUp = locAt(1747, 3410, 3485, 1), cellDoor = locAt(3463, 3415, 3489, 2);
    const ladderDown = locAt(1746, 3410, 3485, 2), stairsDown = locAt(1740, 3417, 3485, 1), cellarLadder = locAt(1755, 3405, 9907, 0);
    const gate1 = locAt(3444, 3405, 9895, 0), grave3 = locAt(3495, 3428, 9890, 0), well = locAt(3485, 3423, 9890, 0);
    const coffin = locAt(3480, 3413, 3486, 2);
    let owed = 50;   // essence still owed (a resume past stage 10 reads it from Drezel: 'I need N more')
    const essNeeded = () => owed;   // tracked by what we hand over (the stage varp is not transmitted)
    const inCell = () => bot.minusedlevel === 2 && bot.tile().x >= 3416;
    let skipping = !!o.from;
    /** debug resume (sim launcher --from <phase>): skip phases until the named one */
    const P = (name: string) => { if (skipping && name === o.from) skipping = false; return !skipping; };

    // drop what the quest never uses (carried state), keep food/weapon/runes/quest inputs
    // (nothing dropped by default: the route decides the pack; we only need free slots, checked below)

    if (P('roald1')) {
    // ---- 1. King Roald -> stage 1 -----------------------------------------------------------------------------------
    await talkAt(bot, ROALD, ROALD_AT, [R, R, R, R, R, R, R, R, M2[0]!, R, R], {
        done: () => seenText(bot, /squires/), answers: [/^Sure\.$/], maxTicks: 60, label: 'roald1',
    });
    if (!seenText(bot, /squires/)) fail(bot, 'Roald: quest not started');
    at('roald1');
    dismiss(bot);

    }
    if (P('knock')) {
    // ---- 2. knock at the temple door -> stage 2 ---------------------------------------------------------------------
    if (!(await walkOp(bot, DOOR_OUT, () => bot.opLoc(door.x, door.z, door.id, 2), () => inDialog(bot), { maxTicks: 300 }))) fail(bot, 'temple door knock');
    await talk(bot, [], [R, R, M4[0]!, R, R, R, R, R, R, M2[0]!, R, R, R, R], {
        noOp: true, done: () => seenText(bot, /dead dog coming/), answers: [/^Roald sent me/, /^Sure\.$/], maxTicks: 30, label: 'knock',
    });
    if (!seenText(bot, /dead dog coming/)) fail(bot, 'knock: stage 2 not reached');
    at('knock');
    dismiss(bot);

    }
    if (P('dog')) {
    // ---- 3. mausoleum trapdoor, kill the Temple guardian -> stage 3 -------------------------------------------------
    await trapdoorDown(bot, trap, 1568, 1570, { x: 3405, z: 3506 });
    at('mausoleum');
    if (!(await kill(bot, DOG, { home: { x: 3405, z: 9903 }, maxTicks: 200 }))) fail(bot, 'temple guardian not killed');
    at('dog');

    }
    if (P('roald2')) {
    // ---- 4. King Roald -> stage 4 -----------------------------------------------------------------------------------
    const canTele = bot.stat('magic').level >= 25 && bot.count('lawrune') >= 1 && bot.count('airrune') >= 3 && bot.count('firerune') >= 1;
    if (canTele && !o.walkToRoald) {
        if (!(await tele(bot, 'varrock_teleport')).ok) fail(bot, 'varrock teleport 1');
    } else {
        await opUntil(bot, cellarLadder, 1, { x: 3405, z: 9906 }, () => !underground(bot));
    }
    at('to-roald');
    await talkAt(bot, ROALD, ROALD_AT, [R, R, R, R, R, R, R, R, R, R, R, R], { done: () => seenText(bot, /Y-yes your/), maxTicks: 30, label: 'roald2' });
    if (!seenText(bot, /Y-yes your/)) fail(bot, 'Roald 2: stage 4 not reached');
    at('roald2');
    dismiss(bot);

    }
    if (P('cell5')) {
    // ---- 5. temple: golden key from a Monk of Zamorak, talk through the cell door -> stage 5 ------------------------
    await enterTemple(bot, door);
    at('temple');
    if (!has(bot, KEY_GOLD)) {
        const keyOnFloor = () => !!bot.findGroundItem(objId(KEY_GOLD), 15);
        if (!(await kill(bot, MONK3, { home: { x: 3413, z: 3488 }, maxTicks: 200, done: () => keyOnFloor() || has(bot, KEY_GOLD) }))) fail(bot, 'monk: no golden key');
        if (!has(bot, KEY_GOLD) && !(await pickup(bot, KEY_GOLD, 15, 30))) fail(bot, 'golden key pickup');
    }
    at('gold-key');
    await upToCell(bot, stairsUp, ladderUp);
    at('L2');
    if (!(await walkOp(bot, { x: 3415, z: 3489 }, () => bot.opLoc(cellDoor.x, cellDoor.z, cellDoor.id, 2), () => inDialog(bot), { level: 2, maxTicks: 30 }))) fail(bot, 'cell door talk-through');
    const r5 = Array(24).fill(R) as FTok[], r5b = Array(14).fill(R) as FTok[];
    await talk(bot, [], [R, R, R, R, R, R, R, M2[0]!, ...r5, M2[0]!, ...r5b], {
        noOp: true, done: () => seenText(bot, /first thing's/), answers: [/^Tell me anyway/, /^Yes\.$/], maxTicks: 40, label: 'drezel-cell',
    });
    if (!seenText(bot, /first thing's/)) fail(bot, 'cell door: stage 5 not reached');
    at('stage5');
    dismiss(bot);

    }
    if (P('mausoleum6')) {
    // ---- 6. mausoleum: gate 1, golden key -> iron key at monument 3, murky water from the well ----------------------
    await downFromCell(bot, ladderDown, stairsDown);
    await leaveTemple(bot, door);
    await trapdoorDown(bot, trap, 1568, 1570, { x: 3405, z: 3506 });
    if (bot.tile().z >= 9895) {
        if (!(await opUntil(bot, gate1, 1, { x: 3405, z: 9895 }, () => bot.tile().z <= 9894, { maxTicks: 40 }))) fail(bot, 'gate 1 (south)');
    }
    at('gate1');
    if (!(await useOnLocUntil(bot, KEY_GOLD, grave3, { x: 3427, z: 9890 }, () => has(bot, KEY_IRON), { maxTicks: 60 }))) fail(bot, 'monument 3: no iron key');
    at('iron-key');
    if (!(await useOnLocUntil(bot, 'bucket_empty', well, { x: 3423, z: 9891 }, () => has(bot, MURKY), { maxTicks: 20 }))) fail(bot, 'well: no murky water');
    at('murky');
    if (!(await opUntil(bot, gate1, 1, { x: 3405, z: 9894 }, () => bot.tile().z >= 9895, { maxTicks: 60 }))) fail(bot, 'gate 1 (north)');
    if (!(await opUntil(bot, cellarLadder, 1, { x: 3405, z: 9906 }, () => !underground(bot), { maxTicks: 30 }))) fail(bot, 'cellar ladder');
    at('surface');

    }
    if (P('cell8')) {
    // ---- 7. cell: iron key (6), bless the water, pour it on the coffin (7), talk to Drezel (8) ----------------------
    await enterTemple(bot, door);
    await upToCell(bot, stairsUp, ladderUp);
    if (!(await useOnLocUntil(bot, KEY_IRON, cellDoor, { x: 3415, z: 3489 }, () => !has(bot, KEY_IRON), { maxTicks: 30 }))) fail(bot, 'iron key on the cell door');
    at('stage6');
    dismiss(bot);
    if (!(await opUntil(bot, cellDoor, 1, { x: 3415, z: 3489 }, inCell, { maxTicks: 10, level: 2 }))) fail(bot, 'into the cell');
    if (!(await useOnNpcUntil(bot, MURKY, DREZEL, () => has(bot, BLESSED), 20))) fail(bot, 'Drezel did not bless the water');
    at('blessed');
    dismiss(bot);
    if (!(await opUntil(bot, cellDoor, 1, { x: 3416, z: 3489 }, () => !inCell(), { maxTicks: 10, level: 2 }))) fail(bot, 'out of the cell');
    if (!(await useOnLocUntil(bot, BLESSED, coffin, { x: 3414, z: 3486 }, () => !has(bot, BLESSED), { maxTicks: 20 }))) fail(bot, 'blessed water on the coffin');
    at('stage7');
    if (!(await opUntil(bot, cellDoor, 1, { x: 3415, z: 3489 }, inCell, { maxTicks: 10, level: 2 }))) fail(bot, 'into the cell 2');
    }
    if (P('talk8')) {
    await talkAt(bot, DREZEL, { x: 3417, z: 3489 }, [R, R, R], { done: () => seenText(bot, /Look for me down there/), maxTicks: 20, label: 'drezel8', level: 2, walkTicks: 30 });
    if (!seenText(bot, /Look for me down there/)) fail(bot, 'Drezel: stage 8 not reached');
    at('stage8');
    dismiss(bot);

    }
    if (P('drezel10')) {
    // ---- 8. east trapdoor -> Drezel in the mausoleum (10) -> essence (60) -> talk (61) -------------------------------
    if (!(await opUntil(bot, cellDoor, 1, { x: 3416, z: 3489 }, () => !inCell(), { maxTicks: 10, level: 2 }))) fail(bot, 'out of the cell 2');
    await downFromCell(bot, ladderDown, stairsDown);
    }
    if (P('mausoleum10')) {
    await toDrezel2(bot, door);
    at('drezel-room');
    // session 11 (audit: a retry past stage 10 waited for 'around fifty', but Drezel then says 'Bring me fifty Rune Essence'
    // (= 10, none given) or 'I need N more' (drezel.rs2:50-73), or takes the held essence at once ('Quickly, give them to me!')):
    // accept those and owe the TRUE count. PIP_RESUME_TALK=0 reverts.
    const resTalk = process.env.PIP_RESUME_TALK !== '0';
    const D10 = resTalk ? /around fifty|Bring me fifty Rune Essence|I need \d+ more|give (it|them) to me|That should do it/ : /around fifty/;
    const ess0 = bot.count('blankrune');
    // stale pages of an earlier attempt in this process would satisfy the text checks at once: forget them first
    if (resTalk) for (const [k, x] of [...bot.ifText]) if (/around fifty|Bring me fifty|I need \d+ more|give (it|them) to me|That should do it/.test(x)) bot.ifText.delete(k);
    await talkAt(bot, DREZEL2, { x: 3440, z: 9894 }, [...Array(16).fill(R), R] as FTok[], { done: () => seenText(bot, D10), maxTicks: 30, label: 'drezel10', walkTicks: 60 });
    if (!seenText(bot, D10)) fail(bot, 'Drezel: stage 10 not reached');
    if (resTalk && !seenText(bot, /around fifty/)) {
        // a resume: page out, then (if he took essence in that talk) ask once more for the count left
        for (let k = 0; k < 10 && inDialog(bot); k++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
        const tookNow = ess0 - bot.count('blankrune');
        if (!seenText(bot, /That should do it/) && !has(bot, 'dagger_wolfbane') && !seenText(bot, /Bring me fifty|I need \d+ more/)) {
            await talkAt(bot, DREZEL2, { x: 3440, z: 9894 }, [R, R, R] as FTok[], { done: () => seenText(bot, /I need \d+ more|Bring me fifty/), maxTicks: 20, label: 'drezel count', walkTicks: 30 });
        }
        const n = /I need (\d+) more/.exec([...bot.ifText.values()].join(' '));
        owed = seenText(bot, /That should do it/) || has(bot, 'dagger_wolfbane') ? 0 : n ? Number(n[1]) : seenText(bot, /Bring me fifty/) ? 50 : 50 - tookNow;
        console.log(`[pip] resume past stage 10: essence owed ${owed} (took ${tookNow} in the talk)`);
    }
    at('stage10');
    dismiss(bot);
    let given = 0;
    const give = async () => {
        const n0 = bot.count('blankrune');
        if (!n0) return;
        if (!(await useOnNpcUntil(bot, 'blankrune', DREZEL2, () => bot.count('blankrune') < n0, 20))) fail(bot, 'Drezel took no essence');
        given += n0 - bot.count('blankrune');
    };
    if (essNeeded() > 0) await give();
    at(`gave ${given}`);
    if (given < essNeeded()) {
        const need = essNeeded() - given;
        if (o.restock) {
            // helper: meets us at the top of the mausoleum trapdoor (3405,3506); a helper cannot pass gate 1/2 below
            // unless it has done Priest in Peril to stage 5/8 itself (gates.rs2:1-9)
            // session 9 (qt47/qt51: +450 t): the helper waits in the cellar (route helperAt 3405,9895); the ladder climb made it
            // 'not ready' (other side of the map) -> a bank round trip + a second one for the last 2 essence. Meet it below.
            const ladder = locAt(1755, 3405, 9907, 0);
            await toCellar(bot);
            if (!o.meetBelow?.() && underground(bot) && !(await opUntil(bot, ladder, 1, { x: 3405, z: 9906 }, () => !underground(bot), { maxTicks: 30 }))) fail(bot, 'cellar ladder');
            await o.restock(need);
        } else await bankRestock(bot, need, door);
        at('restock');
        if (bot.count('blankrune') < need) fail(bot, `restock: ${bot.count('blankrune')}/${need} essence`);
        await toDrezel2(bot, door);
        await give();
        at(`gave ${given}`);
    }
    // the last hand-in runs drezel_finish_blankrunes (3 pages) and queues the completion (wolfbane + QP)
    await waitText(bot, /That should do it/, 6);
    for (let k = 0; k < 8 && inDialog(bot); k++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
    if (!(await bot.until(() => has(bot, 'dagger_wolfbane'), 12))) fail(bot, 'no wolfbane: quest not complete');
    at('stage60');
    dismiss(bot);
    // stage 61: "So can I pass through that barrier now?" (8 pages, the varp is set after the last player line)
    await talk(bot, DREZEL2, [R, R, R, R, R, R, R, R], { done: () => seenText(bot, /I fight werewolves/) && !inDialog(bot), maxTicks: 30, label: 'drezel61' });
    if (!seenText(bot, /I fight werewolves/)) fail(bot, 'Drezel: stage 61 not reached');
    at('stage61');
    dismiss(bot);
    }
}

/** From Drezel's room (east of gate 2) back to the trapdoor cellar north of gate 1 (the helper's side; a helper cannot pass
 *  gate 1/2 without its own quest stage, gates.rs2:1-9). No-op when already there or above ground. */
export async function toCellar(bot: SpeedBot): Promise<void> {
    const g1 = locAt(3444, 3405, 9895, 0), g2 = locAt(3445, 3431, 9897, 0);
    if (underground(bot) && bot.tile().x >= 3432 && !(await opUntil(bot, g2, 1, { x: 3432, z: 9897 }, () => bot.tile().x <= 3431, { maxTicks: 40 }))) fail(bot, 'gate 2 (west)');
    const northOfGate1 = () => bot.tile().x < 3410 && bot.tile().z >= 9895;
    if (underground(bot) && !northOfGate1() && !(await opUntil(bot, g1, 1, { x: 3405, z: 9894 }, northOfGate1, { maxTicks: 60 }))) fail(bot, 'gate 1 (north)');
}
async function enterTemple(bot: SpeedBot, door: ReturnType<typeof locAt>): Promise<void> {
    if (inTemple(bot)) return;
    if (!(await opUntil(bot, door, 1, DOOR_OUT, () => inTemple(bot), { maxTicks: 300 }))) fail(bot, 'temple door (in)');
}
async function leaveTemple(bot: SpeedBot, door: ReturnType<typeof locAt>): Promise<void> {
    if (!inTemple(bot)) return;
    if (!(await opUntil(bot, door, 1, DOOR_IN, () => !inTemple(bot) && bot.minusedlevel === 0, { maxTicks: 60 }))) fail(bot, 'temple door (out)');
}
async function upToCell(bot: SpeedBot, stairs: ReturnType<typeof locAt>, ladder: ReturnType<typeof locAt>): Promise<void> {
    if (bot.minusedlevel === 0 && !(await opUntil(bot, stairs, 1, { x: 3416, z: 3485 }, () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail(bot, 'temple stairs up');
    dismiss(bot);
    if (bot.minusedlevel === 1 && !(await opUntil(bot, ladder, 1, { x: 3410, z: 3486 }, () => bot.minusedlevel === 2, { maxTicks: 30, level: 1 }))) fail(bot, 'temple ladder up');
    dismiss(bot);
}
async function downFromCell(bot: SpeedBot, ladder: ReturnType<typeof locAt>, stairs: ReturnType<typeof locAt>): Promise<void> {
    if (bot.minusedlevel === 2 && !(await opUntil(bot, ladder, 1, { x: 3410, z: 3486 }, () => bot.minusedlevel === 1, { maxTicks: 30, level: 2 }))) fail(bot, 'temple ladder down');
    dismiss(bot);
    if (bot.minusedlevel === 1 && !(await opUntil(bot, stairs, 1, { x: 3416, z: 3485 }, () => bot.minusedlevel === 0, { maxTicks: 30, level: 1 }))) fail(bot, 'temple stairs down');
    dismiss(bot);
}
/**
 * From anywhere on the temple/mausoleum route to Drezel's room in the mausoleum (x >= 3432): out of the temple, the
 * mausoleum trapdoor (3405,3507), gate 1 (3405,9895, opens at >= 5), gate 2 (3431,9897, opens at >= 8; gates.rs2:1-9).
 * (The east trapdoor 3422,3485 is on the Morytania side of the temple, reachable only past the holy barrier.)
 */
async function toDrezel2(bot: SpeedBot, door: ReturnType<typeof locAt>): Promise<void> {
    const gate1 = locAt(3444, 3405, 9895, 0), gate2 = locAt(3445, 3431, 9897, 0);
    const t0 = bot.tickCount, lap = (k: string) => { if (process.env.QTRACE || process.argv.includes('--laps')) console.log(`[toDrezel2 +${bot.tickCount - t0}] ${k} ${JSON.stringify(bot.pos())}`); };
    if (bot.minusedlevel > 0) await downFromCell(bot, locAt(1746, 3410, 3485, 2), locAt(1740, 3417, 3485, 1));
    await leaveTemple(bot, door);
    lap('surface');
    if (!underground(bot)) await trapdoorDown(bot, { x: 3405, z: 3507 }, 1568, 1570, { x: 3405, z: 3506 });
    lap('trapdoor');
    if (bot.tile().x < 3410 && bot.tile().z >= 9895 && !(await opUntil(bot, gate1, 1, { x: 3405, z: 9895 }, () => bot.tile().z <= 9894, { maxTicks: 40 }))) fail(bot, 'gate 1 (south)');
    lap('gate1');
    if (bot.tile().x <= 3431 && !(await opUntil(bot, gate2, 1, { x: 3431, z: 9897 }, () => bot.tile().x >= 3432, { maxTicks: 60 }))) fail(bot, 'gate 2 (east)');
    lap('gate2');
}
/** Varrock Teleport (or walk) to Varrock east bank, take the essence, walk back to the east trapdoor. */
async function bankRestock(bot: SpeedBot, need: number, door: ReturnType<typeof locAt>): Promise<void> {
    const canTele = bot.stat('magic').level >= 25 && bot.count('lawrune') >= 1 && bot.count('airrune') >= 3 && bot.count('firerune') >= 1;
    if (canTele) { if (!(await tele(bot, 'varrock_teleport')).ok) fail(bot, 'varrock teleport 2'); }
    if (!(await walkOp(bot, { x: 3253, z: 3421 }, null, () => cheb(bot.tile(), { x: 3253, z: 3421 }) <= 3, { maxTicks: 400 }))) fail(bot, 'walk to Varrock east bank');
    await openBooth(bot);
    // 27 essence needs 27 slots: deposit everything (runes, bucket, food: none is needed after this)
    await swap(bot, [], [{ obj: 'blankrune', n: need }]);
    bot.closeBank();
    await bot.tick(1);
    // the caller walks back to Drezel (toDrezel2)
}

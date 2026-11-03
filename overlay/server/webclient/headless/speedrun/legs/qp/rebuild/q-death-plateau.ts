// q-death-plateau.ts — Death Plateau (quest_death), cheat-free speedrun rebuild (lane rebuild).
// Content (rev 289, ~/sim/rs-qp/server/content/scripts/quests/quest_death/): configs/quest_death.constant (two tracks:
// %death_equiproom 0/10/20/30/40/50/55/60/70 -> complete 80; the map bits of %death_map 1 saba .. 8 scouted),
// scripts/quest_death.rs2 (doors, IOU, stone mechanism, stile, scout zone, completion queue), death_ig_commander.rs2
// (Denulth), death_headservant.rs2 (Eohric), death_guard_equiproom.rs2 (Harold: drinks + dice), death_saba.rs2,
// death_sherpa.rs2 (Tenzing), death_smithy.rs2 (Dunstan).
//
// Order (the map track needs Saba -> Tenzing -> Dunstan -> Denulth -> Dunstan -> Tenzing -> scout; the equipment-room track
// needs Eohric -> Harold -> Eohric -> Harold -> IOU -> balls; Denulth last with both):
//  1. Denulth (2896,3528): "Do you have any quests for me?" / "No but perhaps I could try and find one?" -> equip 10,
//     Harold's purse 100 (death_ig_commander.rs2:88-113).
//  2. Saba (hermit cave 3735 at 2857,3578 -> 2269,4752): "Do you know of another way up Death Plateau?" -> map 1.
//  3. Tenzing: knock on 3745 (2822,3555 E edge) -> "No milk today" / "I'm not the milkman" lets you in (map >= 1); his
//     talk -> map 2 + climbing boots ("OK, I'll get those for you.").
//  4. Games necklace -> Burthorpe (the games room exits at 2899,3564) -> Dunstan (2919,3574) -> map 3.
//  5. Eohric (castle L1, stairs 4626 at 2897,3566): "I'm looking for the guard that was on last night." -> equip 20.
//  6. Harold (pub L1, staircase 1722 at 2914,3539; his door 3747 at 2906,3543 needs a knock): "You're the guard that was
//     on duty last night?" -> equip 30.
//  7. Denulth -> certificate (map 4).  8. Eohric -> equip 40.  9. Dunstan: certificate + iron bar + boots -> spiked boots
//     (map 5).
// 10. Harold: Asgarnian ale (equip 50), then "Can I buy you a drink?" again -> Blurberry Special = %harold_verydrunk
//     (death_guard_equiproom.rs2:265-286): every roll is a win. Gamble 101 (> his purse of 100): the win empties him ->
//     IOU (:150-180, equip 55). Read the IOU -> combination (equip 60, quest_death.rs2:26-34).
// 11. Five stone balls (ground, x 2893 z 3561..3565) onto the mechanism (quest_death.rs2:84-98: blue 2894,3562; yellow
//     2895,3562; red 2894,3563; purple 2895,3563; green 2895,3564) -> equip 70.
// 12. Tenzing (door free now): 10 bread + 10 trout + spiked boots -> secret way map (map 7). Back door 3746 (2820,3557),
//     stile 3730 (2817,3562), the trail north into zone 0_44_56_48_24 (2864-2871,3608-3615) -> map 8.
// 13. Games necklace -> Burthorpe -> Denulth: map + combination -> queue(death_quest_complete): equip 80 (complete),
//     steel claws, attack +30000 tenths x25, +1 qp. Leaves %death_equiproom = complete and map bits = 8: what Troll
//     Stronghold and Eadgar's Ruse need (Tenzing's door reads the map bits, quest_death.rs2:46-66).
import type { SpeedBot } from '../../../core.js';
import { objId, cheb } from '../../../core.js';
import { R, M2, M3, type FTok, inDialog, npc, locAt, opLocGo, useOnLocGo, rawResume, msgsSince, nav } from '../../q-lib.js';
import { opLocUntil, mkLog, qp, qStatus, closeChat, pagesUntil, walk, pickup, dead, fail, snapText, textSince,
    type Item, type QuestDef, type Requirements, type RunResult } from '../f2p-a/fa-lib.js';
import { doorOpen } from '../f2p-a/fa2-lib.js';
import { npcId, talkRb, rubTele, locDialog, msgSeen, stallTrace, textLog, textSeen } from './rb-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'Death Plateau', dir: 'quest_death', qp: 1 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0, skills: {},
    start: { x: 2897, z: 3529, level: 0 },   // next to Denulth (Imperial Guard tent, Burthorpe)
    end: { x: 2897, z: 3529, level: 0 },
};
/** 10 bread + 10 trout (Tenzing), iron bar (Dunstan), ale + Blurberry Special (Harold: the special makes every dice roll
 *  a win), 101 coins (the bet that empties Harold's purse of 100), a games necklace (2 charges: Tenzing -> Burthorpe and
 *  the scout zone -> Burthorpe). */
export const SUPPLY: Item[] = [
    { name: 'bread', n: 10 }, { name: 'trout', n: 10 }, { name: 'iron_bar', n: 1 }, { name: 'asgarnian_ale', n: 1 },
    // the premade special (Blurberry bar shop) is the live source; Harold takes either (death_guard_equiproom.rs2:280-287).
    // DP_PREMADE=0 reverts to the hand-made blurberry_special.
    { name: process.env.DP_PREMADE === '0' ? 'blurberry_special' : 'premade_blurberry_special', n: 1 }, { name: 'coins', n: 101 }, { name: 'necklace_of_minigames_8', n: 1 },
];

const DENULTH = npcId('death_ig_commander'), SABA = npcId('death_hermit'), TENZING = npcId('death_sherpa'),
    DUNSTAN = npcId('death_smithy'), EOHRIC = npcId('death_headservant'), HAROLD = npcId('death_guard_equiproom');
const AT = {
    denulth: { x: 2897, z: 3529 }, saba: { x: 2270, z: 4758 }, tenzing: { x: 2820, z: 3556 }, dunstan: { x: 2919, z: 3573 },
    eohric: { x: 2902, z: 3565, level: 1 }, harold: { x: 2905, z: 3539, level: 1 }, scout: { x: 2866, z: 3609 },
};
const LOC = {
    caveIn: { id: 3735, x: 2857, z: 3578 }, caveOut: { id: 3736, x: 2268, z: 4750 },
    hutDoor: { id: 3745, x: 2822, z: 3555 }, hutBack: { id: 3746, x: 2820, z: 3557 }, stile: { id: 3730, x: 2817, z: 3562 },
    castleUp: { id: 4626, x: 2897, z: 3566 }, castleDown: { id: 4625, x: 2897, z: 3567, level: 1 },
    pubUp: { id: 1722, x: 2914, z: 3539 }, pubDown: { id: 1723, x: 2914, z: 3540, level: 1 }, haroldDoor: { id: 3747, x: 2906, z: 3543, level: 1 },
    gamesUp: { id: 4622, x: 2207, z: 4935 }, gamesExit: { id: 4627, x: 2205, z: 4935, level: 1 },
};
const BALLS: Array<{ obj: string; at: { x: number; z: number }; to: { id: number; x: number; z: number } }> = [
    { obj: 'death_cannonball_red', at: { x: 2893, z: 3565 }, to: { id: 3677, x: 2894, z: 3563 } },
    { obj: 'death_cannonball_blue', at: { x: 2893, z: 3564 }, to: { id: 3676, x: 2894, z: 3562 } },
    { obj: 'death_cannonball_purple', at: { x: 2893, z: 3563 }, to: { id: 3677, x: 2895, z: 3563 } },
    { obj: 'death_cannonball_green', at: { x: 2893, z: 3562 }, to: { id: 3676, x: 2895, z: 3564 } },
    { obj: 'death_cannonball_yellow', at: { x: 2893, z: 3561 }, to: { id: 3676, x: 2895, z: 3562 } },
];
/**
 * Token plans (q-lib DIALOG BURST: sent the tick the first page shows, 5 pages/tick; a token that does not apply is dropped
 * and converse answers adaptively). Page counts from the scripts: death_ig_commander.rs2:88-113 / :160-185 / :186-221,
 * death_saba.rs2:29-49, death_sherpa.rs2:150-180 / :120-145 / :182-191, death_smithy.rs2:16-30 / :33-48+:187-210,
 * death_headservant.rs2:4-17+:51-57, death_guard_equiproom.rs2:33-37+:221-229 / :246-258 / :190-200.
 * RB_DP_PLANS=0 turns them off (A/B).
 */
const PLANS: Record<string, FTok[]> = {
    'denulth start': [R, R, M3[0]!, ...rr(6), M2[0]!, ...rr(13)],
    'saba': [R, R, M3[1]!, ...rr(14)],
    'tenzing1': [...rr(12), M2[0]!, R, R],
    'dunstan1': rr(12),
    'eohric1': [R, R, M3[0]!, ...rr(5)],
    'harold1': [R, R, M2[0]!, ...rr(4)],
    'denulth cert': rr(14),
    'eohric2': rr(5),
    'dunstan2': rr(9),
    'harold drinks': rr(5),
    'tenzing2': rr(12),
    'denulth final': rr(12),
    'gamble': [R, R, M3[1]!, R, R, R, R],
};
function rr(n: number): FTok[] { return Array(n).fill(R); }
function plan(label: string): FTok[] | undefined { return process.env.RB_DP_PLANS === '0' ? undefined : PLANS[label.replace(/\d+$/, '') === 'gamble' ? 'gamble' : label]; }
const inCave = (bot: SpeedBot) => bot.tile().z > 4700 && bot.tile().z < 4800 && bot.tile().x < 2300;
const inGames = (bot: SpeedBot) => bot.tile().z > 4900 && bot.tile().x < 2300;
const inHut = (bot: SpeedBot) => { const t = bot.tile(); return bot.minusedlevel === 0 && t.x >= 2819 && t.x <= 2822 && t.z >= 3554 && t.z <= 3557; };
const inHaroldRoom = (bot: SpeedBot) => { const t = bot.tile(); return bot.minusedlevel === 1 && t.x >= 2905 && t.x <= 2907 && t.z >= 3536 && t.z <= 3542; };

/** o.from = resume phase (1 Denulth start, 2 Saba/Tenzing/Dunstan, 3 Eohric+Harold 1, 4 cert, 5 Eohric 2, 6 Dunstan boots,
 *  7 Harold drinks + dice + IOU, 8 balls, 9 Tenzing map, 10 scout, 11 Denulth final): phases before it are skipped (the
 *  quest varps are not transmitted, so a resume point is the caller's knowledge). */
export async function run(bot: SpeedBot, o: { log?: boolean; from?: number } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'dp', !!o.log);
    const stopTrace = process.env.RB_TRACE ? stallTrace(bot, L) : () => {};
    // session 10: on a retry / resume (no explicit from), the first unfinished phase per the quest JOURNAL (death_journal.rs2:
    // its text accumulates, so each line = a stage reached on one of the two tracks). DP_RESUME=0 reverts.
    let from = o.from, dun1 = false;
    if (from === undefined && isResuming(bot) && process.env.DP_RESUME !== '0') {
        closeChat(bot);
        const j = await readJournal(bot, 'death');
        if (j.ok) {
            const t = j.text, r = (re: RegExp) => re.test(t);
            if (r(/QUEST COMPLETE/i)) { stopTrace(); return { ok: true, ticks: bot.tickCount - t0, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` }; }
            const started = !r(/I can start this quest/i), tenzing1 = r(/I found the sherpa's house/i);
            const smithy = r(/Dunstan will help me|given Dunstan the certificate/i), cert = r(/Denulth gave me a\s+certificate|given Dunstan the certificate/i);
            const boots = r(/Dunstan\s+made me the Spiked boots/i), gotMap = r(/given me a map of the secret way/i), scouted = r(/it is safe for the Imperial|another way up Death Plateau for Denulth/i);
            const harold1 = r(/guard wouldn't talk to me/i), eohric2 = r(/buy the guard a drink|bought the guard a drink/i), iou = r(/me an IOU/i), unlocked = r(/unlocked the door/i);
            const done = [started, tenzing1, harold1 && smithy, cert, eohric2, boots, iou, unlocked, gotMap, scouted];
            const k = done.findIndex(d => !d);
            from = k < 0 ? 11 : k + 1;
            dun1 = tenzing1 && !smithy;
            L(`[journal] death: '${j.open.slice(0, 120)}' -> phase ${from}${dun1 ? ' (+ Dunstan 1)' : ''} (${j.ticks} t)`);
        } else L('[journal] death: UNREADABLE');
    }
    try { return await body(bot, L, t0, qp0, from ?? 1, dun1); }
    finally { stopTrace(); /* no eat watch: the bread and trout are quest items (no combat in this quest) */ }
}

async function body(bot: SpeedBot, L: (s: string) => void, t0: number, qp0: number, from: number, dun1 = false): Promise<RunResult> {
    const ph = (n: number) => from <= n;
    const oldOrder = process.env.RB_DP_ORDER === 'old';   // A/B: Dunstan 1 straight after the necklace
    let needDunstan1 = dun1;
    await nav();
    textLog(bot);
    const fin = (ok: boolean, msg: string): RunResult => ({ ok, ticks: bot.tickCount - t0, msg });
    const has = (o: string) => bot.count(o) > 0;
    const check = (what: string) => { if (dead(bot)) fail(bot, `died (${what})`); };
    const done = () => qp(bot) > qp0;
    const finish = async () => { await pagesUntil(bot, () => !inDialog(bot), 8); closeChat(bot); };
    /** talk until the text (or `extra`) shows; then finish the npc's pages */
    const talkText = async (type: number, label: string, stand: { x: number; z: number; level?: number }, answers: RegExp[], re: RegExp, extra: () => boolean = () => false, useItem?: string) => {
        if (type !== EOHRIC) await castleDoor(false);
        const snap = snapText(bot), since = bot.tickCount;
        const ok = await talkRb(bot, type, { stand, near: 10, label, log: L, maxTicks: 150, answers, useItem, plan: plan(label),
            done: () => textSince(bot, snap, re) || textSeen(bot, since, re) || msgSeen(bot, since, re) || extra() });
        if (!ok) fail(bot, `${label}: no "${re.source}"`);
        if (process.env.RB_DEBUG) L(`${label} texts: ${JSON.stringify(textLog(bot).filter(e => e.t >= since).map(e => `${e.t - since}:${e.v.slice(0, 40)}`))}`);
        await finish();
        L(`${label} ok ${JSON.stringify(bot.pos())}`);
        failHook(label);
    };
    const climb = async (loc: { id: number; x: number; z: number; level?: number }, toLevel: number, label: string) => {
        if (bot.minusedlevel === toLevel) return;
        closeChat(bot);
        if (!(await opLocUntil(bot, loc, 1, () => bot.minusedlevel === toLevel, 60))) fail(bot, `${label}: still on level ${bot.minusedlevel}`);
    };
    const toBurthorpe = async (label: string) => {
        const ok = await rubTele(bot, /^necklace_of_minigames_\d$/, /Burthorpe/);
        if (!ok || !inGames(bot)) fail(bot, `${label}: games necklace`);
        if (bot.minusedlevel === 0) await climb(LOC.gamesUp, 1, 'games room stairs');
        if (!(await opLocUntil(bot, LOC.gamesExit, 1, () => !inGames(bot), 40))) fail(bot, `${label}: games room exit`);
        L(`${label}: necklace -> ${JSON.stringify(bot.pos())}`);
    };
    // Burthorpe castle's courtyard (castle stairs, Eohric, the stone balls; the games room exit lands in it) is walled; its
    // one way out is the south double door 1516/1519 (2898..2899,3558, N edge). Shut (rb53: "castle stairs: still on level
    // 0", walker parked at the door), nothing on our side opens it: open it ourselves before every crossing.
    const inCastle = () => bot.minusedlevel === 0 && bot.tile().z >= 3559 && bot.tile().z <= 3580 && bot.tile().x >= 2885 && bot.tile().x <= 2912;
    const castleDoor = async (wantIn: boolean) => {
        if (bot.minusedlevel !== 0 || inCastle() === wantIn) return;
        const side = inCastle() ? { x: 2898, z: 3559 } : { x: 2898, z: 3557 };
        if (!doorOpen(bot, 0, 2898, 3558) && !doorOpen(bot, 0, 2899, 3558)) {
            if (cheb(bot.tile(), side) > 1) await walk(bot, side, 1, 'castle door');
            if (!(await opLocUntil(bot, { id: 1516, x: 2898, z: 3558 }, 1, () => doorOpen(bot, 0, 2898, 3558) || doorOpen(bot, 0, 2899, 3558), 12, side))) L('castle door: no open leaf seen');
        }
        const thru = wantIn ? { x: 2898, z: 3560 } : { x: 2898, z: 3556 };
        await bot.walkTo(thru.x, thru.z, { near: 1, maxTicks: 20, log: false });
        if (inCastle() !== wantIn) L(`castle door: not through, at ${JSON.stringify(bot.pos())}`);
    };
    const toCastleL1 = async () => { if (bot.minusedlevel !== 1 || bot.tile().z < 3555) { await toL0(); await castleDoor(true); await climb(LOC.castleUp, 1, 'castle stairs'); } };
    const toL0 = async () => {
        if (bot.minusedlevel === 0) return;
        if (inHaroldRoom(bot)) await leaveHarold();
        if (bot.tile().z > 3555) await climb(LOC.castleDown, 0, 'castle stairs down'); else await climb(LOC.pubDown, 0, 'pub stairs down');
    };
    const toHarold = async () => {
        if (inHaroldRoom(bot)) return;
        if (bot.minusedlevel === 0) await castleDoor(false);
        if (bot.minusedlevel !== 1 || bot.tile().z > 3555) { await toL0(); await climb(LOC.pubUp, 1, 'pub stairs'); }
        const door = locAt(LOC.haroldDoor.id, LOC.haroldDoor.x, LOC.haroldDoor.z, 1);
        const ok = await locDialog(bot, () => { closeChat(bot); opLocGo(bot, door, 1, { x: 2906, z: 3543 }); }, () => inHaroldRoom(bot), [], 60);
        if (!ok) fail(bot, 'Harold door');
    };
    const leaveHarold = async () => {
        const door = locAt(LOC.haroldDoor.id, LOC.haroldDoor.x, LOC.haroldDoor.z, 1);
        const ok = await locDialog(bot, () => { closeChat(bot); opLocGo(bot, door, 1, { x: 2906, z: 3542 }); }, () => !inHaroldRoom(bot), [], 30);
        if (!ok) fail(bot, 'leave Harold room');
    };
    const intoHut = async () => {
        if (inHut(bot)) return;
        await castleDoor(false);
        // The yard fence gate 3725/3726 (2824,3554..3555, E edge) is shut in the default world; opened, its leaves 3727/3728
        // lie on the NORTH edges of (2825,3555) and (2826,3555) (probe-gate): an approach from z 3556 is walled off either
        // way and the walker stalled 16-19 t at (2825,3556) (rb20/rb23) or failed (rb24). Come in along row z 3555 from
        // (2827,3555): open the gate from (2825,3555) if shut, then straight west to the hut door's outside tile (2823,3555).
        const gateOpen = () => { for (const [k, id] of bot.liveLocs) { if (id !== 3727 && id !== 3728) continue; const [l, x, z] = k.split(',').map(Number); if (l === 0 && Math.abs(x! - 2824) <= 2 && Math.abs(z! - 3555) <= 2) return true; } return false; };
        const step = async (x: number, z: number, n = 8) => { if (bot.tile().x === x && bot.tile().z === z) return true; closeChat(bot); bot.sendRoute([{ x, z }], true); bot.queueFlush(); return bot.until(() => bot.tile().x === x && bot.tile().z === z, n); };
        if (bot.tile().x >= 2825) {
            if (!(bot.tile().z === 3555 && bot.tile().x <= 2827)) await walk(bot, { x: 2827, z: 3555 }, 0, 'yard gate approach');
            await step(2825, 3555);
            if (!gateOpen()) {
                if (!(await opLocUntil(bot, { id: 3725, x: 2824, z: 3555 }, 1, gateOpen, 12, { x: 2825, z: 3555 }))) L('yard gate: no open gate seen');
            }
            // the client's open-leaf belief can be stale (the gate reverts on a timer: rb54 saw leaf 3727 and stood shut out):
            // if the step west fails, op the CLOSED gate id (a no-op when it is really open) and try again
            for (let k = 0; k < 3 && !(await step(2823, 3555, 4)); k++) {
                L(`yard gate: not through (try ${k + 1}), at ${JSON.stringify(bot.pos())}`);
                await step(2825, 3555, 4);
                closeChat(bot); bot.opLoc(2824, 3555, 3725, 1); bot.queueFlush(); await bot.tick(2);
            }
        }
        if (cheb(bot.tile(), { x: 2823, z: 3555 }) > 3) await walk(bot, { x: 2823, z: 3555 }, 1, 'hut door');
        const door = locAt(LOC.hutDoor.id, LOC.hutDoor.x, LOC.hutDoor.z, 0);
        const ok = await locDialog(bot, () => { closeChat(bot); opLocGo(bot, door, 1, { x: 2823, z: 3555 }); }, () => inHut(bot), [/I'm not the milkman/], 60);
        if (!ok) fail(bot, 'into the hut');
    };
    const outHut = async () => {
        if (!inHut(bot)) return;
        const door = locAt(LOC.hutDoor.id, LOC.hutDoor.x, LOC.hutDoor.z, 0);
        const ok = await locDialog(bot, () => { closeChat(bot); opLocGo(bot, door, 1, { x: 2822, z: 3555 }); }, () => !inHut(bot), [], 30);
        if (!ok) fail(bot, 'out of the hut');
    };

    // 1. Denulth: start (journal colour)
    if (ph(1) && (qStatus(bot, 'death') === 'NOT_STARTED' || qStatus(bot, 'death') === 'NOT_OBSERVABLE')) {
        await talkText(DENULTH, 'denulth start', AT.denulth, [/^Do you have any quests for me\?$/, /^No but perhaps I could try and find one\?$/],
            /I'll get on it right away!|Well citizen, the Prince is fond of puzzles/, () => qStatus(bot, 'death') === 'IN_PROGRESS');
    }
    check('start');
    // 2. Saba
    const tenzingDone = () => has('death_climbingboots') || has('death_spikedboots') || has('death_entrancecert') || has('death_secretwaymap');
    if (ph(2) && !tenzingDone()) {
        if (!inCave(bot)) {
            await walk(bot, { x: 2860, z: 3578 }, 2, 'cave entrance');
            if (!(await opLocUntil(bot, LOC.caveIn, 1, () => inCave(bot), 40))) fail(bot, 'cave entrance');
        }
        await talkText(SABA, 'saba', AT.saba, [/^Do you know of another way up Death Plateau\?$/], /it can't be far as he used to be around|Where did you say this Sherpa was\?/);
        if (!(await opLocUntil(bot, LOC.caveOut, 1, () => !inCave(bot), 40))) fail(bot, 'cave exit');
        L(`out of the cave ${JSON.stringify(bot.pos())}`);
        // 3. Tenzing: into the hut (knock) and the climbing boots
        await intoHut();
        L('in the hut');
        const ok = await talkRb(bot, TENZING, { near: 6, label: 'tenzing1', log: L, maxTicks: 120, plan: plan('tenzing1'), answers: [/^OK, I'll get those for you\.$/], done: () => has('death_climbingboots') });
        if (!ok) fail(bot, 'Tenzing: no climbing boots');
        await finish();
        L('climbing boots');
        // 4. -> Burthorpe -> Dunstan (map 3): the necklace is rubbed INSIDE the hut (no door, ~7 t saved: rb23 stalled 7 t
        // on each side of the front door)
        if (process.env.RB_DP_NECK1 !== 'walk') await toBurthorpe('tenzing->burthorpe');
        else await outHut();
        needDunstan1 = true;
        if (oldOrder) { await talkText(DUNSTAN, 'dunstan1', AT.dunstan, [], /bring an Iron bar for the spikes|I just need to speak to Denulth/); needDunstan1 = false; }
    }
    check('map track 1');
    // 5. Eohric 1 (the necklace lands INSIDE the castle walls: Eohric first, then out round the walls to Dunstan, ~70 tiles,
    //    once instead of twice)  Dunstan 1  6. Harold 1  7. Denulth cert  8. Eohric 2  9. Dunstan boots
    const iou = () => has('death_iou') || has('death_combination');
    if (ph(3) && !iou()) {
        await toCastleL1();
        await talkText(EOHRIC, 'eohric1', AT.eohric, [/^I'm looking for the guard that was on last night\.$/], /Harold is staying at the Toad and Chicken|I found Harold but he won't talk/);
        if (needDunstan1) { await toL0(); await talkText(DUNSTAN, 'dunstan1', AT.dunstan, [], /bring an Iron bar for the spikes|I just need to speak to Denulth/); needDunstan1 = false; }
        await toHarold();
        await talkText(HAROLD, 'harold1', AT.harold, [/^You're the guard that was on duty last night\?$/], /I don't want to talk about it!/);
    }
    if (ph(4) && !has('death_spikedboots') && !has('death_secretwaymap')) {
        await toL0();
        if (!has('death_entrancecert')) await talkText(DENULTH, 'denulth cert', AT.denulth, [], /Denulth has given you a certificate|This certificate proves/, () => has('death_entrancecert'));
    }
    if (ph(5) && !iou()) {
        await toCastleL1();
        await talkText(EOHRIC, 'eohric2', AT.eohric, [], /Perhaps he'd open up after a drink\?|if you buy Harold a beer/);
    }
    if (ph(6) && !has('death_spikedboots') && !has('death_secretwaymap')) {
        await toL0();
        await castleDoor(false);
        const ok = await talkRb(bot, DUNSTAN, { stand: AT.dunstan, near: 10, label: 'dunstan2', log: L, maxTicks: 120, plan: plan('dunstan2'), answers: [], done: () => has('death_spikedboots') });
        if (!ok) fail(bot, 'Dunstan: no spiked boots');
        await finish();
        L('spiked boots');
        failHook('spiked boots');
    }
    check('boots');
    // 10. Harold: ale, blurberry special, one won roll -> IOU -> combination
    if (ph(7) && !iou()) {
        await toHarold();
        L('harold room');
        // ale (equip 50), then the second "Can I buy you a drink?" -> Blurberry Special (very drunk)
        // done on his last line: the special runs ~7 t of npc animation delays before it (death_guard_equiproom.rs2:276-284)
        // and an op sent meanwhile is dropped (rb13: 4 re-ops + a converse retry, 15 t)
        const snapD = snapText(bot), tD = bot.tickCount;
        // wait: no re-talk while his drink animations run (if_close + p_delays between the pages, :232-243 / :276-284)
        let lastDlg = bot.tickCount;
        const ok = await talkRb(bot, HAROLD, { near: 6, label: 'harold drinks', log: L, maxTicks: 120, plan: plan('harold drinks'),
            wait: () => bot.tickCount - lastDlg < 12,
            answers: [/^Can I buy you a drink\?$/], done: () => { if (inDialog(bot)) lastDlg = bot.tickCount; return textSince(bot, snapD, /Now THAT hit the spot!/) || textSeen(bot, tD, /Now THAT hit the spot!/); } });
        if (!ok) fail(bot, 'Harold: drinks not taken');
        if (process.env.RB_DEBUG) L(`drinks texts: ${JSON.stringify(textLog(bot).filter(e => e.t >= tD).map(e => `${e.t - tD}:${e.v.slice(0, 30)}`))}`);
        await finish();
        L(`harold drunk; ale ${bot.count('asgarnian_ale')}`);
        await gamble(bot, L);
    }
    if (has('death_iou')) {
        // OPHELD1 "Read" (quest_death.rs2:26-34): re-sent while nothing happens (a read sent while Harold's queued IOU pages
        // were still running was dropped in rb12)
        for (let k = 0; k < 6 && !has('death_combination'); k++) {
            if (!inDialog(bot)) { closeChat(bot); const s = bot.slot('death_iou'); if (s >= 0) { bot.opHeld1(objId('death_iou'), s); bot.queueFlush(); } }
            await pagesUntil(bot, () => has('death_combination'), 4);
        }
        await pagesUntil(bot, () => !inDialog(bot), 8);
        if (!has('death_combination')) fail(bot, 'IOU: no combination');
        closeChat(bot);
        L('combination');
        failHook('combination');
    }
    check('combination');
    // 11. stone balls
    const unlockSince = bot.tickCount;
    if (ph(8)) {
        if (inHaroldRoom(bot)) await leaveHarold();
        await toL0();
        await castleDoor(true);
        await placeBalls(bot, L);
        failHook('balls');
    }
    if (!msgSeen(bot, unlockSince, /The equipment room door has unlocked/)) L('WARN: no unlock message seen (balls placed)');
    check('balls');
    // 12. Tenzing: supplies -> map; scout
    if (ph(9) && !has('death_secretwaymap')) {
        await intoHut();
        const ok = await talkRb(bot, TENZING, { near: 6, label: 'tenzing2', log: L, maxTicks: 120, plan: plan('tenzing2'), answers: [], done: () => has('death_secretwaymap') });
        if (!ok) fail(bot, 'Tenzing: no map');
        await finish();
        L('secret way map');
    }
    const scoutSince = bot.tickCount;
    let scouted = false;
    if (ph(10)) {
        if (inHut(bot)) {
            const back = locAt(LOC.hutBack.id, LOC.hutBack.x, LOC.hutBack.z, 0);
            const ok = await locDialog(bot, () => { closeChat(bot); opLocGo(bot, back, 1, { x: 2820, z: 3557 }); }, () => !inHut(bot), [], 30);
            if (!ok) fail(bot, 'hut back door');
        }
        if (bot.tile().z < 3563) {
            if (!(await opLocUntil(bot, LOC.stile, 1, () => bot.tile().z >= 3564, 40, { x: 2817, z: 3561 }))) fail(bot, 'stile');
        }
        L(`over the stile ${JSON.stringify(bot.pos())}`);
        await bot.walkTo(AT.scout.x, AT.scout.z, { near: 1, maxTicks: 120, log: false });
        scouted = await bot.until(() => msgSeen(bot, scoutSince, /no trolls on the secret path|go and speak to Denulth/), 10);
        if (!scouted) fail(bot, `scout: no message at ${JSON.stringify(bot.pos())}`);
        await finish();
        L('scouted');
        failHook('scouted');
    }
    // 13. back to Denulth
    if (process.env.RB_DP_NECK2 !== 'walk') await toBurthorpe('scout->denulth');
    await castleDoor(false);
    const ok = await talkRb(bot, DENULTH, { stand: AT.denulth, near: 10, label: 'denulth final', log: L, maxTicks: 150, plan: plan('denulth final'), answers: [], done });
    if (!ok) fail(bot, 'Denulth: no quest complete');
    await finish();
    return fin(true, `qp ${qp0} -> ${qp(bot)}, attack ${bot.stat('attack').level}, steel claws ${has('steel_claws')}`);
}

/** Harold (very drunk): "Would you like to gamble?" -> count dialog 101 -> dice: click "roll" (death_dice:com_28), continue
 *  the pause -> his purse (100) cannot pay -> IOU (death_guard_equiproom.rs2:148-180). */
async function gamble(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    const ROLL = componentIdSafe('death_dice:com_28'), RESULT = componentIdSafe('death_dice:com_33');
    const coins = () => bot.count('coins');
    for (let k = 0; k < 3 && bot.count('death_iou') === 0; k++) {
        if (coins() < 101) fail(bot, `gamble: only ${coins()} coins`);
        const bet = 101;
        const ok = await talkRb(bot, HAROLD, { near: 6, label: `gamble${k + 1}`, log: L, maxTicks: 30, plan: plan('gamble'), answers: [/^Would you like to gamble\?$/],
            done: () => (bot as any).countDialogTick >= 0 || bot.count('death_iou') > 0 });
        if (!ok) { L(`gamble ${k + 1}: no count dialog`); continue; }
        if (bot.count('death_iou') > 0) break;
        (bot as any).submitCountDialog(bet); bot.queueFlush();
        const end = bot.tickCount + 40;
        L(`gamble ${k + 1}: bet ${bet} sent, roll com ${ROLL}`);
        while (bot.count('death_iou') === 0 && bot.tickCount < end && !bot.disposed) {
            if (process.env.RB_DEBUG) L(`  dice: main ${bot.mainModalId} chat ${bot.chatModalId} c33 ${JSON.stringify(bot.ifText.get(componentIdSafe('death_dice:com_33')))} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 1))}`);
            // the result text means player_roll has run dice_winnings (goldclaimed set, death_guard_equiproom.rs2:96-110);
            // its p_pausebutton never takes a RESUME_PAUSEBUTTON from us (rb14: 20+ t open), so CLOSE the dice: the queued
            // haroldgamble_end then pays out (purse 100) and writes the IOU (:148-180). Closing BEFORE the result loses the bet.
            const res = bot.ifText.get(RESULT) ?? '';
            if (bot.mainModalId !== -1 && /You win!|You lose!/.test(res)) { bot.closeModal(); bot.mainModalId = -1; }
            else if (ROLL > 0 && bot.mainModalId !== -1) bot.ifButton(ROLL);
            if (bot.chatModalId !== -1 && !bot.dialogOptions().length) bot.resumeDialogPage();
            bot.queueFlush();
            await bot.tick(1);
        }
        L(`gamble ${k + 1}: iou ${bot.count('death_iou')} coins ${coins()}`);
    }
    if (bot.count('death_iou') === 0) fail(bot, 'gamble: no IOU');
    await pagesUntil(bot, () => !inDialog(bot), 10);
    closeChat(bot);
}
import { componentId } from '../../../core.js';
function componentIdSafe(n: string): number { try { return componentId(n); } catch { return -1; } }

/** pick up each stone ball and use it on its mechanism tile (quest_death.rs2:84-98) */
async function placeBalls(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    // all five first (the pack has room: 28 - bread 10 - trout 10 - coins - necklace - boots - combination = 3 ... so place
    // as we go when the pack is short)
    for (const b of BALLS) {
        const id = objId(b.obj);
        const placed = () => bot.groundItems.has(`${b.to.x},${b.to.z},${id}`);
        if (placed()) continue;
        if (bot.count(id) === 0) {
            if (!(await pickup(bot, b.obj, b.at, 60))) fail(bot, `pickup ${b.obj}`);
        }
        const loc = locAt(b.to.id, b.to.x, b.to.z, 0);
        const c0 = bot.count(id);
        const ok = await opLocUntilUse(bot, loc, b.obj, () => bot.count(id) < c0 || placed(), 40);
        if (!ok) fail(bot, `place ${b.obj} on (${b.to.x},${b.to.z})`);
        L(`placed ${b.obj}`);
    }
}
async function opLocUntilUse(bot: SpeedBot, loc: ReturnType<typeof locAt>, obj: string, done: () => boolean, maxTicks: number): Promise<boolean> {
    const end = bot.tickCount + maxTicks; let last = -99, prev = '', still = 0;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        const t = bot.tile(), k = `${t.x},${t.z}`; still = k === prev ? still + 1 : 0; prev = k;
        if (last < 0 || (still >= 2 && bot.tickCount - last >= 3)) { closeChat(bot); useOnLocGo(bot, obj, loc); last = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}
export { M2, M3, R, npc };

// q-black-knights-fortress.ts — Black Knights' Fortress (3 QP), cheat-free. Lane f2p-b (agent fg). Rebuilt as a speedrun leg
// (the old kbd-swarm runner needs DoorTracker.openLeavesNear, which our private repo main lacks).
//
// Content (rev 289): areas/area_falador/scripts/sir_amik_varze.rs2 (SA), quests/quest_blackknight/scripts/quest_blackknight.rs2 (QB),
// ladders+stairs/scripts/ladders.rs2 + stairs.rs2, doors/scripts/open_and_close_doors.rs2
//   1. Sir Amik Varze (npc 608, Falador castle L2 2960,3336; m46_52): %spy 0, qp >= 12 -> "I seek a quest!" / "I laugh in the
//      face of danger!" -> %spy = 1 at the end of the talk                                          (SA:1-57, quest.constant:9)
//   2. The fortress (3016,3514). Door 2337 (bkfortressdoor1) opens from outside only with bronze_med_helm + iron_chainbody WORN
//      (QB:12-21); the doors 2337/2338/2339 and secret walls 2341 TELEPORT you through (open_and_close_door/door2:
//      open_and_close_doors.rs2:9-62). Ladders land on your own tile +-1 level (ladders.rs2:42-82), so the stand tile picks
//      the room. Route = offline Dijkstra over rsmod collision (probe-fg-bfs.ts; same as the old kbd-swarm solve).
//   3. Witch grill 2342 (3025,3507 L0) op1 at %spy 1: 9 pages, %spy = 2 after the last (QB:121-136).
//   4. Back round to the banquet hall door 2338 (guard asks: "I don't care. I'm going in anyway." -> through + the hall's
//      knights attack: QB:57-74), ladder 1750 (3022,3518) up, secret wall 2341 (3030,3510 L1) into the hole room.
//   5. Cabbage (obj 1965; NOT the Draynor magic_cabbage) on the hole 2336 (3031,3507 L1) at %spy 2: 4 messages with p_delay(2)
//      each, then %spy = 3 and a chatplayer page (QB:89-107). Teleport only after that page is closed (f2p-a trap: a
//      CLOSE_MODAL'd suspended script swallows the next teleport).
//   6. Falador Teleport, castle stairs x2, Sir Amik at %spy 3: 4 pages, queue(black_knights_fortress_quest_complete):
//      %spy 4, 2500 coins, quest scroll                                                                   (SA:59-75, QB:152-158)
//   Black Knights (179, cl33) huntmode cowardly = check_nottoostrong outside the wilderness: they only hunt players up to
//   combat 66 (2 x 33); door 2338's answer, door 2339 from inside and ladder (3022,3518 L1) set them on you regardless
//   (QB:139-147, ladders.rs2:68-76).
import { SpeedBot, objId, densify } from '../../../core.js';
import { tele, locAt, opLocGo, useOnLocGo, inDialog, nav, navSync, walkOp, type Tile } from '../../q-lib.js';
import { go, guard, fail, mkLog, completeCheck, glory, setRetaliate, syncLeaves, openNpc, type Item } from './fb-lib.js';
import { talkAll, wear, hasRunes, monitor, fixDoubleLeaves, climb, doorOpen, wallRow } from './fg-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: "Black Knights' Fortress", dir: 'quest_blackknight', qp: 3 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 12,   // Sir Amik refuses below 12 QP (sir_amik_varze.rs2:15)
    skills: {
        magic: [37, 'Falador Teleport back to Sir Amik (falador_teleport)'],
        defence: [40, 'black knights (cl33, max hit ~4) hit you through the hall and on the L1/L2 ladders; proven at def/hp 40'],
        hitpoints: [40, 'see defence'],
    } as Record<string, [number, string]>,
    start: { x: 2965, z: 3379, level: 0 },   // Falador square (Falador Teleport landing)
    end: { x: 2960, z: 3337, level: 2 },     // Sir Amik, Falador castle L2
};
export const SUPPLY: Item[] = [
    { name: 'bronze_med_helm', n: 1 }, { name: 'iron_chainbody', n: 1 }, { name: 'cabbage', n: 1 },
    { name: 'lawrune', n: 2 }, { name: 'airrune', n: 6 }, { name: 'waterrune', n: 2 },   // 2 Falador Teleports (out, back)
    { name: 'lobster', n: 4 },
];

const AMIK = 608, AMIK_AT = { x: 2960, z: 3336 };
const FALLY_RUNES = { lawrune: 1, airrune: 3, waterrune: 1 };

type FStep = { k: 'door' | 'ndoor' | 'ladder'; id: number; x: number; z: number; l: number; from: Tile; to?: Tile; ans?: RegExp[]; label: string };
const D = (id: number, x: number, z: number, l: number, fx: number, fz: number, tx: number, tz: number, label: string, ans?: RegExp[]): FStep =>
    ({ k: id === 1530 ? 'ndoor' : 'door', id, x, z, l, from: { x: fx, z: fz }, to: { x: tx, z: tz }, label, ans });
const LAD = (id: number, x: number, z: number, l: number, fx: number, fz: number, label: string): FStep => ({ k: 'ladder', id, x, z, l, from: { x: fx, z: fz }, label });
const GOING_IN = [/^I don't care\. I'm going in anyway\.$/];
// probe-fg-bfs.ts output (walk 0.5 t/step, door/ladder +3): to the grill cost 49, grill -> hole 65.5
export const TO_GRILL: FStep[] = [
    D(2337, 3016, 3514, 0, 3016, 3514, 3016, 3515, 'door1 in'),
    D(2341, 3016, 3517, 0, 3016, 3516, 3016, 3517, 'secret wall L0 in'),
    LAD(1750, 3015, 3519, 0, 3015, 3518, 'ladder L0->L1 (3015,3519)'),
    LAD(1750, 3016, 3519, 1, 3016, 3518, 'ladder L1->L2 (3016,3519)'),
    LAD(1746, 3017, 3516, 2, 3017, 3515, 'ladder L2->L1 (3017,3516)'),
    D(1530, 3019, 3515, 1, 3019, 3515, 3020, 3515, 'L1 door 1 east'),
    D(1530, 3021, 3515, 1, 3021, 3515, 3022, 3515, 'L1 door 2 east'),
    LAD(1750, 3023, 3513, 1, 3023, 3514, 'ladder L1->L2 (3023,3513)'),
    LAD(1749, 3025, 3513, 2, 3025, 3514, 'ladder L2->L1 (3025,3513)'),
    D(2339, 3025, 3511, 1, 3026, 3511, 3025, 3511, 'door3 west'),
    LAD(1746, 3021, 3510, 1, 3022, 3510, 'ladder L1->L0 (3021,3510) grill room'),
];
export const GRILL_TO_HOLE: FStep[] = [
    LAD(1747, 3021, 3510, 0, 3022, 3510, 'ladder L0->L1 (3021,3510)'),
    D(2339, 3025, 3511, 1, 3025, 3511, 3026, 3511, 'door3 east'),
    LAD(1750, 3025, 3513, 1, 3025, 3514, 'ladder L1->L2 (3025,3513)'),
    LAD(1749, 3023, 3513, 2, 3023, 3514, 'ladder L2->L1 (3023,3513)'),
    D(1530, 3021, 3515, 1, 3022, 3515, 3021, 3515, 'L1 door 2 west'),
    D(1530, 3019, 3515, 1, 3020, 3515, 3019, 3515, 'L1 door 1 west'),
    LAD(1747, 3017, 3516, 1, 3016, 3516, 'ladder L1->L2 (3017,3516)'),
    LAD(1749, 3016, 3519, 2, 3016, 3518, 'ladder L2->L1 (3016,3519)'),
    LAD(1749, 3015, 3519, 1, 3015, 3518, 'ladder L1->L0 (3015,3519)'),
    D(2341, 3016, 3517, 0, 3016, 3517, 3016, 3516, 'secret wall L0 out'),
    D(2338, 3020, 3515, 0, 3019, 3515, 3020, 3515, 'door2 (guard) in', GOING_IN),
    LAD(1750, 3022, 3518, 0, 3022, 3517, 'ladder L0->L1 (3022,3518)'),
    D(2341, 3030, 3510, 1, 3030, 3510, 3030, 3509, 'secret wall L1 in'),
];
/** From outside door1 straight to the hole room (A/B: teleport out after the grill and come back in). */
export const OUT_TO_HOLE: FStep[] = [
    D(2337, 3016, 3514, 0, 3016, 3514, 3016, 3515, 'door1 in'),
    D(2338, 3020, 3515, 0, 3019, 3515, 3020, 3515, 'door2 (guard) in', GOING_IN),
    LAD(1750, 3022, 3518, 0, 3022, 3517, 'ladder L0->L1 (3022,3518)'),
    D(2341, 3030, 3510, 1, 3030, 3510, 3030, 3509, 'secret wall L1 in'),
];

const at = (bot: SpeedBot, t: Tile, l: number) => bot.minusedlevel === l && bot.tile().x === t.x && bot.tile().z === t.z;

/** Run a fortress step list: walk onto each step's exact `from` tile, then cross (door / wall: we must land on `to`;
 *  ladder: the level must change). A step already done (we stand past it) is skipped. */
async function runSteps(bot: SpeedBot, steps: FStep[], log: ReturnType<typeof mkLog>): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        const next = steps[i + 1];
        // skip: already on the far side (a door's `to`, or the next step's level/tile after a ladder)
        if (s.to && at(bot, s.to, s.l)) continue;
        if (s.k === 'ladder' && next && bot.minusedlevel === next.l && bot.minusedlevel !== s.l) continue;
        if (bot.minusedlevel !== s.l) fail(bot, `${s.label}: on level ${bot.minusedlevel}, expected ${s.l}`);
        syncLeaves(bot); fixDoubleLeaves(bot);
        // RIDE (A/B FG_BKF_RIDE=1, off by default: no gain, fgb4 step intervals = fgb3's; p_arrivedelay eats it): route to the
        // exact stand tile with the OPLOC in the same tick, when no earlier tile of that route reaches the loc (else the
        // engine fires the op there: a ladder would land us in another room)
        let rode = false;
        if (s.k !== 'ndoor' && process.env.FG_BKF_RIDE === '1' && !at(bot, s.from, s.l)) {
            const nv = navSync(), me = bot.tile(), loc = locAt(s.id, s.x, s.z, s.l), fa = nv.locForceApproach(loc.id);
            const dense = densify([me, ...nv.findLongPath(s.l, me.x, me.z, s.from.x, s.from.z, 200)]).slice(1);
            const last = dense[dense.length - 1];
            const early = dense.slice(0, -1).some(t => nv.reachedLoc(s.l, t.x, t.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa));
            if (last && last.x === s.from.x && last.z === s.from.z && !early && dense.length <= 30) { opLocGo(bot, loc, 1, s.from); rode = true; }
        }
        if (!rode) await go(bot, s.from, 0, s.label, 120, s.l);
        const t0 = bot.tickCount, lv0 = bot.minusedlevel;
        const crossed = () => s.k === 'ladder' ? bot.minusedlevel !== lv0 : at(bot, s.to!, s.l);
        if (s.k === 'ndoor') {
            // a plain door: open it ourselves if it is shut (walkOp's tracker took it for open and wedged 20 re-plans before
            // shutting/opening it: L1 door 2, sim fgb2 23 t), then step through
            if (!doorOpen(bot, s.id, s.x, s.z, s.l)) {
                let lo = -100;
                while (!doorOpen(bot, s.id, s.x, s.z, s.l)) {
                    if (bot.tickCount - t0 > 20) fail(bot, `${s.label}: door does not open`);
                    if (bot.tickCount - lo >= 3) { bot.opLoc(s.x, s.z, s.id, 1); bot.queueFlush(); lo = bot.tickCount; }
                    await bot.tick(1);
                }
                syncLeaves(bot);
            }
            const r = bot.sendRoute([s.to!]); bot.queueFlush();
            if (!r || !(await bot.until(crossed, 4))) await go(bot, s.to!, 0, s.label, 60, s.l);
        }
        let lastOp = rode ? bot.tickCount : -100;
        while (!crossed()) {
            if (bot.tickCount - t0 > 40) fail(bot, `${s.label}: not crossed`);
            if (inDialog(bot)) {
                if (bot.dialogOptions().length) { for (const re of s.ans ?? []) if (bot.clickDialogByText(re) > 0) break; }
                else bot.resumeDialogPage();
                bot.queueFlush();
            } else if (bot.tickCount - lastOp >= 4) {
                if (!at(bot, s.from, s.l) && !(rode && bot.tickCount - t0 < 12)) await go(bot, s.from, 0, s.label, 30, s.l);
                bot.opLoc(s.x, s.z, s.id, 1); bot.queueFlush(); lastOp = bot.tickCount;
            }
            await bot.tick(1);
        }
        log(`  ${s.label} (${bot.tickCount - t0} t)`);
    }
}

/** Falador castle: west stairs L0 (2954,3338) -> L1 (2956,3338); L1 stairs (2960,3338) -> L2 (2959,3339) (stairs.rs2:198-199). */
async function castleUp(bot: SpeedBot, log: ReturnType<typeof mkLog>): Promise<void> {
    // walkOp to a stand tile next to the stairs with the OPLOC riding the last chunk (walkOp opens the castle doors; a bare
    // opLocGo routed through the shut castle door and stood still 150 t, sim fgb1)
    const stairs = [{ id: 1738, x: 2954, z: 3338, level: 0, stand: { x: 2956, z: 3339 } }, { id: 1738, x: 2960, z: 3338, level: 1, stand: { x: 2959, z: 3338 } }];
    for (const s of stairs) {
        if (bot.minusedlevel !== s.level) continue;
        await climb(bot, s, s.stand, `castle L${s.level}`);
        log.split(`castle L${s.level}->L${bot.minusedlevel}`);
    }
}

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'bkf', o.log !== false);
    { const s0 = log.split; log.split = (k: string) => { s0(k); failHook(k); }; }
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    // session 10: on a retry / resume, the stage from the quest JOURNAL (blackknight_journal.rs2): 1 Amik's talk done, 2 the grill
    // heard, 3 the potion sabotaged (then the cabbage is gone: only Amik is left). 0 on a fresh attempt. BKF_RESUME=0 reverts.
    let js = 0;
    if (isResuming(bot) && process.env.BKF_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); await bot.tick(1); }
        js = await journalStage<number>(bot, 'fortress', [[/QUEST COMPLETE/i, 4], [/Now that I have sabotaged/i, 3], [/destroyed with a normal\s+cabbage/i, 2], [/asked me to investigate the\s+Black/i, 1]], 0, s => console.log(`[bkf] ${s}`));
        if (js >= 4) return { ok: true, ticks: bot.tickCount - log.t0, msg: 'journal: quest complete' };
    }
    const g = guard(bot);
    const mon = monitor(bot, [179, 609], 'bkf');
    const n = (k: string) => bot.count(objId(k));
    setRetaliate(bot, false);   // a knight's hit must not drag us into a fight (auto_retaliate -> p_opnpc(2))
    try {
        if (qp0 < 12) fail(bot, `need 12 qp (have ${qp0})`);
        if (js < 3 && n('cabbage') < 1) fail(bot, 'no cabbage');
        // 0. the disguise, worn (QB:12-21)
        await wear(bot, ['bronze_med_helm', 'iron_chainbody'].filter(i => n(i) > 0), 'disguise');
        // 1. Sir Amik (castle L2)
        if (js < 1) {
        if (bot.minusedlevel === 0) await castleUp(bot, log);
        const s1 = await talkAll(bot, AMIK, AMIK_AT, [/^I seek a quest!$/, /^I laugh in the face of danger!$/], 'amik1', { maxTicks: 40 });
        if (s1.some(t => /unexperienced quester/.test(t))) fail(bot, 'Sir Amik: below 12 qp');
        if (!s1.some(t => /give it a try|How's the mission going/.test(t))) fail(bot, `amik1: start not seen`);
        log.split('amik1');
        }
        if (js < 3) {
        // 2. to the fortress door1 (3016,3514)
        // A/B FG_BKF_TRAVEL: fally (default: a 2nd Falador Teleport, 176 steps, no wilderness) | glory (Edgeville, walk kept
        // south of the wilderness: 201 steps) | wild (Edgeville through wilderness levels 1-4: 133 steps, warning modal)
        const travel = process.env.FG_BKF_TRAVEL ?? 'fally';
        // session 11: on a resume the route's own travel may already have used a Falador Teleport: a 2nd one from the square
        // cannot move > 8 tiles and reads as failed (q-lib tele; fork qya06). Already near Falador: walk from here. BKF_FALLY_HERE=0 reverts.
        const nearFally = js >= 1 && process.env.BKF_FALLY_HERE !== '0' && bot.minusedlevel === 0 && Math.max(Math.abs(bot.tile().x - 2965), Math.abs(bot.tile().z - 3379)) <= 20;
        if (nearFally) log.split('tele Falador (already here)');
        else if (travel === 'fally') {
            if (!(bot.stat('magic').level >= 37 && hasRunes(bot, { lawrune: 2, airrune: 6, waterrune: 2 }))) fail(bot, 'need 2 Falador Teleports (magic 37 + runes)');
            if (!(await tele(bot, 'falador_teleport')).ok) fail(bot, 'Falador Teleport failed');
            log.split('tele Falador');
        } else { await glory(bot, 'edgeville', 'glory'); log.split('glory Edgeville'); }
        const undo = travel === 'wild' ? () => undefined : wallRow(3520, 2940, 3110);
        // wild: the wilderness warning (interface 1908, areas/area_wilderness/scripts/wilderness_warning.rs2:6-27) opens as a
        // main modal on entry and holds the walk (fgw606-808: +240 t): a watcher closes it the tick it shows
        const watch = { stop: false };
        if (travel === 'wild') (async () => { while (!watch.stop && !bot.disposed) { if (bot.mainModalId === 1908) { bot.closeModal(); bot.queueFlush(); } await bot.until(() => false, 1); } })();
        try {
            const t1 = bot.tickCount;
            while (!at(bot, { x: 3016, z: 3514 }, 0) && !at(bot, { x: 3016, z: 3515 }, 0)) {
                if (bot.tickCount - t1 > 400) fail(bot, 'walk to door1');
                if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }   // the wilderness warning
                // door1's OPLOC rides the walk's last chunk: only the outside tile (3016,3514) reaches it from out here
                // (A/B FG_BKF_DOOR1RIDE=0: walk, stop, then op)
                if (process.env.FG_BKF_DOOR1RIDE !== '0') {
                    syncLeaves(bot);
                    if (await walkOp(bot, { x: 3016, z: 3514 }, () => { bot.opLoc(3016, 3514, 2337, 1); }, () => bot.tile().z >= 3515 && bot.tile().z < 3520 && bot.tile().x < 3030,
                        { near: 0, maxTicks: 300, log: false })) break;
                }
                await go(bot, { x: 3016, z: 3514 }, 0, 'to door1', 300, 0).catch(e => { if (bot.mainModalId === -1) throw e; });
            }
        } finally { undo(); watch.stop = true; }
        log.split('walk door1');
        // 3. in, to the grill
        await runSteps(bot, TO_GRILL, log);
        log.split('to grill');
        const grill = locAt(2342, 3025, 3507, 0);
        const tg = bot.tickCount; let lastG = -100, heard = js >= 2;
        const snap = new Map(bot.ifText);
        while (!heard || bot.chatModalId !== -1) {
            if (bot.tickCount - tg > 40) fail(bot, 'grill: conversation not heard');
            for (const [k, v] of bot.ifText) if (snap.get(k) !== v) { snap.set(k, v); if (/Yes mithreth/.test(v)) heard = true; if (/can't hear much/.test(v)) fail(bot, 'grill: %spy not 1'); }
            if (inDialog(bot)) { for (let i = 0; i < 4; i++) bot.resumeDialogPage(); bot.queueFlush(); }
            else if (!heard && bot.tickCount - lastG >= 5) { opLocGo(bot, grill, 1); lastG = bot.tickCount; }
            await bot.tick(1);
        }
        log.split('grill');
        // 4. round to the hole room
        await runSteps(bot, GRILL_TO_HOLE, log);
        log.split('to hole');
        // 5. cabbage down the hole; wait for the chatplayer page after the 4 timed messages (%spy = 3 is set before it)
        const hole = locAt(2336, 3031, 3507, 1);
        const th = bot.tickCount; let lastU = -100, sabotaged = false;
        const snap2 = new Map(bot.ifText);
        while (!sabotaged || bot.chatModalId !== -1) {
            // session 11 fix 366b (qx193p: a drop right after the use ate the 'successfully sabotaged' page; the cabbage was gone and the
            // journal said stage 3): inv_del runs first (quest_blackknight.rs2:101), the stage update 8 t later (4x p_delay(2)), so
            // the cabbage gone 12 t after our use = sabotaged. BK_CABBAGE_GONE=0 reverts.
            if (!sabotaged && lastU >= 0 && n('cabbage') === 0 && bot.tickCount - lastU >= 12 && process.env.BK_CABBAGE_GONE !== '0') sabotaged = true;
            if (bot.tickCount - th > 40) fail(bot, 'hole: cabbage not used');
            for (const [k, v] of bot.ifText) if (snap2.get(k) !== v) { snap2.set(k, v); if (/successfully sabotaged/.test(v)) sabotaged = true; if (/Why would I want to do that/.test(v)) fail(bot, 'hole: %spy not 2'); }
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
            else if (!sabotaged && n('cabbage') > 0 && bot.tickCount - lastU >= 5) {
                useOnLocGo(bot, 'cabbage', hole); lastU = bot.tickCount;
            }
            await bot.tick(1);
        }
        log.split('cabbage');
        }
        // 6. back to Sir Amik
        // session 11 fix 366 (qx193p: a drop at the hole -> retries resumed at journal stage 3 after the route's own travel had cast
        // Falador Teleport to the square; this 2nd cast from (2964,3376) cannot move > 8 tiles, q-lib tele read it as failed:
        // 'Falador Teleport failed' x2, 39 t + 3 casts each, then bkf SKIPPED for the partner): step 2's BKF_FALLY_HERE check, for
        // step 6 too. BK_FALLY_BACK=0 reverts.
        if (process.env.BK_FALLY_BACK !== '0' && bot.minusedlevel === 0 && Math.max(Math.abs(bot.tile().x - 2965), Math.abs(bot.tile().z - 3379)) <= 20) log.split('tele Falador (already here)');
        else {
        if (!(bot.stat('magic').level >= 37 && hasRunes(bot, FALLY_RUNES))) fail(bot, 'no Falador Teleport (magic 37 + runes)');
        if (!(await tele(bot, 'falador_teleport')).ok) fail(bot, 'Falador Teleport failed');
        log.split('tele Falador');
        }
        await castleUp(bot, log);
        // session 11 fix 396c (qx353m: Amik's chat opened (optrace t65813 modal 2) but closed after the player's first page, never his
        // reply; %spy stayed 3 (retry journal: stage 3) -> 'amik2: no completion' + a 60 t retry. First in 605 bkf DONEs; the closer
        // is not in the logs). Without completion, talk again: at %spy 3 the reward dialog replays (sir_amik_varze.rs2:67-73).
        // BK_396C=0 = one talk as before; BK_396C_TEST=1 = the first talk is closed after page 1 (= the qx353 state)
        let s2: string[] = [];
        for (let k = 0; k < (process.env.BK_396C === '0' ? 1 : 3) && !done(); k++) {
            if (k > 0) console.log(`[bkf] 396c: amik2 gave no completion (seen ${JSON.stringify(s2.slice(-3))}); talking to Sir Amik again (${k + 1}/3)`);
            if (k === 0 && process.env.BK_396C_TEST === '1') {
                await openNpc(bot, AMIK, AMIK_AT, 'amik2 396c TEST'); bot.closeModal(); bot.queueFlush(); await bot.tick(2);
                s2 = ['(396c TEST: chat closed after page 1)']; console.log(`[bkf] 396c TEST: closed Amik's chat after page 1`); continue;
            }
            s2 = await talkAll(bot, AMIK, AMIK_AT, [], 'amik2', { maxTicks: 40, done });
            if (!done()) await bot.until(done, 10);
        }
        if (!done()) fail(bot, `amik2: no completion (seen ${JSON.stringify(s2.slice(-3))})`);
        log.split('complete');
        if (g.dead) fail(bot, 'died');
        return { ok: true, ticks: bot.tickCount - log.t0, msg: `${JSON.stringify(log.splits)} ate ${g.ate}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - log.t0, msg: (e as Error).message };
    } finally { mon.stop = true; g.stop = true; bot.holdDialogs = false; }
}

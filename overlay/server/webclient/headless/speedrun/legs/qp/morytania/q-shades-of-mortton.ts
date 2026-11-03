// q-shades-of-mortton.ts — Shades of Mort'ton (rev 289), cheat-free quest code. Content: quests/quest_mortton/scripts/
// {quest_mortton,razmire_keelgan,ulsquire_shauncy,afflicted}.rs2, minigames/game_mortton/scripts/{flamtaer_temple,
// mortton_shades,mortton_pyre}.rs2, skill_herblore/scripts/herblore.rs2, general/scripts/book.rs2.
//
// Stages (quest_mortton.constant) and what sets each:
//   5   read Herbi Flax's diary to its last page (shelf 3481,3279 gives it; quest_mortton.rs2:1-11,102-128)
//   10  brew serum 207 yourself: ashes on a tarromin potion (unf), herblore 15 (herblore.rs2:10-17, brew_potion.struct:286)
//   15  serum on Razmire (he is afflicted until a serum dose clears him for 200 t), "What are all these shadow creatures?",
//       "Yes, I'll dispatch..." (razmire_keelgan.rs2:27-48,85-93,170-184)
//   20..40 five Loar shades killed (mortton_shades.rs2:7-46); each drops Loar remains (shade_bones1)
//   45  Razmire takes 2 remains (razmire_keelgan.rs2:99-112)
//   47  Ulsquire (serum) takes 1 (ulsquire_shauncy.rs2:73-87); 50 "What can you tell me about that temple?" (:171-180)
//   55    the first temple repair action (flamtaer_temple.rs2:76-78) opens Ulsquire's post-rebuild menu: "What should I do
//         when the temple is built?" gives oliveoil3 ONCE (bit shades_ulsquire_oil_given, needs a free slot;
//         ulsquire_shauncy.rs2:90-93,125-141). Supply-gap change the quest takes this oil instead of a supplied
//         flask; the cleared Ulsquire (serum dose at stage 47, 200 t) is still talkable after one repair action.
//   55/60 repair the Flamtaer temple: 15 walls x 10 levels; a wall gains at most one level per repair action, and level
//       k -> k+1 only once the build total passes 300 + 400k (build += 5 x resources per action; each action takes 3 t and
//       repeats by itself; flamtaer_temple.rs2:1-156,236-252). We track the build from the crafting xp (12.5 displayed xp
//       per resource at x25) and pick the next wall that can level.
//   -   light the fire altar (tinderbox, firemaking roll; flamtaer_temple.rs2:167-234)
//   65  olive oil in the sacred flame -> sacred oil (flamtaer_temple.rs2:280-304)
//   70  sacred oil (2 doses: flamtaer_pyre.struct pyre_logs pyre_required_doses 2, mortton_pyre.rs2:16-25) on logs -> pyre logs (mortton_pyre.rs2:1-42, flamtaer_pyre.struct)
//   75/80 pyre logs on a funeral pyre, Loar remains on it, light it (mortton_pyre.rs2:44-200)
//   done Ulsquire (serum): "I've put the Shade's spirit to rest!" -> queue complete (ulsquire_shauncy.rs2:106-110)
import { SpeedBot, objId, cheb } from '../../../core.js';
import { nav, talk, npcsOf, inDialog, levelUpOpen, walkOp, locAt, dismiss, waitText, msgsSince, approachNpc, openDoorAt, R, M2, M3, M4, M5, qp, type FTok } from '../../q-lib.js';
import { attackFrom, talkAt, fail, has, stamp, withSafety, opUntil, opLocReach, useOnNpcUntil, useOnLocUntil, routeNextTo, pickup, packStr, type Item, type QuestMeta, type Reqs, type RunResult } from './mo-lib.js';
import { failHook, isResuming, journalStage } from '../journal.js';
import { doorDef } from '../../../../../../../sdk/navgrid/door-tracker';

export const QUEST: QuestMeta = { name: "Shades of Mort'ton", dir: 'quest_mortton', qp: 3 };
export const REQUIREMENTS: Reqs = {
    quests: ['Priest in Peril (Morytania access)'], qp: 0,
    skills: {
        herblore: [15, 'serum 207 (brew_potion.struct:289)'],
        crafting: [20, 'temple repair (flamtaer_temple.rs2:11-14)'],
        firemaking: [5, 'pyre logs from normal logs (flamtaer_pyre.struct: pyre_level 5)'],
        attack: [70, 'five Loar shades (38 hp, att 45, def 26); sim-proven level'],
        prayer: [43, 'Protect from Melee nulls every shade hit; dozens of shades converge on the temple while it is built'],
    },
    start: { x: 3483, z: 3281, level: 0 },   // Herbi Flax's house, Mort'ton (west)
    end: { x: 3496, z: 3290, level: 0 },     // next to Ulsquire, Mort'ton
};
/** 4 temple resource sets (1 plank + 1 limestone brick + 5 swamp paste = +800 pool each): ~157 actions x 7-9 at low
 *  crafting = ~1,450; at crafting 50+ the rolls take more per action (up to ~2,600 at crafting ~64) */
export const SETS = 4;
export const SUPPLY: Item[] = [
    { name: 'tarrominvial', n: 2 }, { name: 'ashes', n: 2 }, { name: 'hammer', n: 1 }, { name: 'tinderbox', n: 1 },
    { name: 'logs', n: 1 },   // olive oil: Ulsquire's 3 doses (in-quest); a supplied oliveoil4/3/2 is used instead if held
    { name: 'woodplank', n: SETS }, { name: 'limestonebrick', n: SETS }, { name: 'swamppaste', n: 5 * SETS },
    { name: '4doseprayerrestore', n: 3 },
];
export const WEAR = ['rune_scimitar'];

const RAZMIRE = [1253, 1254], ULSQUIRE = [1251, 1252], SHADES = [1240, 1241];
const RAZ_AT = { x: 3489, z: 3295 }, ULS_AT = { x: 3496, z: 3290 };
const SERUMS = ['mort_serum3', 'mort_serum2', 'mort_serum1', 'mort_serum4'];
const seenText = (bot: SpeedBot, re: RegExp) => { const v = [...bot.ifText.values()]; return v.some(x => re.test(x)) || re.test(v.join(' ')); };

// ---- the temple: 15 walls (11 reachable from inside, the 4 corners from outside) --------------------------------------
type Wall = { x: number; z: number; base: number; stand: { x: number; z: number }; corner: boolean };
const W = (x: number, z: number, sx: number, sz: number, corner = false): Wall => ({ x, z, base: corner ? 4079 : 4068, stand: { x: sx, z: sz }, corner });
const WALLS: Wall[] = [
    W(3504, 3315, 3505, 3315), W(3505, 3314, 3505, 3315), W(3504, 3316, 3505, 3316), W(3504, 3317, 3505, 3317), W(3505, 3318, 3505, 3317),
    W(3506, 3318, 3506, 3317), W(3507, 3318, 3507, 3317), W(3508, 3317, 3507, 3317), W(3508, 3316, 3507, 3316), W(3508, 3315, 3507, 3315),
    W(3507, 3314, 3507, 3315),
    W(3504, 3314, 3504, 3313, true), W(3508, 3314, 3508, 3313, true), W(3508, 3318, 3509, 3318, true), W(3504, 3318, 3503, 3318, true),
];
const ALTAR = { x: 3506, z: 3316 };

export interface ShadeOpts { log?: boolean; sim?: boolean; from?: string }

export async function run(bot: SpeedBot, o: ShadeOpts = {}): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, qp0 = qp(bot), v = o.log !== false;
    const at = (k: string) => { stamp(bot, t0, k, v); failHook(k); };
    let done = false;
    try { await withSafety(bot, 'mortton', async () => { done = await body(bot, o, at); }); }
    catch (e) { return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    return { ok: done, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}${done ? ', quest complete scroll seen' : ''}` };
}

/** Loar shades (huntrange 3) attack anyone passing and every hit closes the open interface (mortton_shades.rs2:154):
 *  kill whatever shade is on us (the risen form 1241 within 2 tiles) before an interface step. */
export async function defend(bot: SpeedBot, maxTicks = 120): Promise<void> {
    const t0 = bot.tickCount; let target = -1, last = -99;
    while (bot.tickCount - t0 < maxTicks) {
        const on = npcsOf(bot, 1241).filter(q => q.d <= 2);
        if (!on.length) return;
        const lvl = levelUpOpen(bot);
        if (bot.chatModalId !== -1 && !lvl) dismiss(bot);
        const t = on.find(q => q.idx === target) ?? on[0]!;
        if (lvl || t.idx !== target || bot.tickCount - last >= 6) { attackFrom(bot, t); target = t.idx; last = bot.tickCount; }
        await bot.tick(1);
    }
}
/** Protect from Melee makes every Loar shade hit 0 (mortton_shades.rs2:168-170): keep it up through the shade and temple
 *  phases (dozens of shades walk to the temple while it is being built, razmire_keelgan.rs2:266-272) and sip prayer
 *  potions below 12 points. Returns a stop function. */
const PRAYER_POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'];
export function prayGuard(bot: SpeedBot, prayer = 'protectfrommelee'): () => void {
    let on = true, lastSip = -99;
    const tick0 = (bot as any).sendWait.bind(bot);
    (async () => {
        while (on && !bot.disposed) {
            const pr = bot.stat('prayer');
            if (pr.level >= 43) {
                if (pr.cur < 12 && bot.tickCount - lastSip >= 3) {
                    const pot = PRAYER_POTS.find(x => has(bot, x));
                    if (pot) { bot.opHeld1(objId(pot), bot.slot(pot)); bot.queueFlush(); lastSip = bot.tickCount; }
                }
                if (pr.cur > 0 && !bot.isPrayerActive(prayer)) { bot.activatePrayer(prayer); bot.queueFlush(); }
            }
            await tick0(1);
        }
    })();
    return () => { on = false; if (bot.isPrayerActive(prayer)) { (bot as any).setPrayer(prayer, false); bot.queueFlush(); } };
}
/** the serum (any dose count) held, or null */
function serum(bot: SpeedBot): string | null { return SERUMS.find(s => has(bot, s)) ?? null; }
/** brew a serum when none is held (ashes on tarromin unf, 1 action) */
async function ensureSerum(bot: SpeedBot): Promise<string> {
    let s = serum(bot);
    if (s) return s;
    if (!has(bot, 'tarrominvial') || !has(bot, 'ashes')) fail(bot, 'no serum and no tarromin potion (unf) + ashes to brew one');
    for (let k = 0; k < 4 && !serum(bot); k++) {
        dismiss(bot);
        bot.useItemOnItem(objId('ashes'), bot.slot('ashes'), objId('tarrominvial'), bot.slot('tarrominvial')); bot.queueFlush();
        await bot.until(() => !!serum(bot), 4);
    }
    s = serum(bot); if (!s) fail(bot, 'serum not brewed');
    return s;
}
/** Use a serum dose on an afflicted Razmire/Ulsquire (clears him for 200 t) and drive the dialogue plan that follows. */
async function serumTalk(bot: SpeedBot, types: number[], at: { x: number; z: number }, plan: FTok[], done: () => boolean, label: string, answers: RegExp[] = []): Promise<void> {
    // session 11 fix 281 (qyo04/qyo11 seed 9431 'razmire15: not done': 150 t at 3488,3294 re-sending OPNPCU on Razmire,
    // ACK-NOACK every send): we stood at 3488,3294, ON the tile of his shop door (loc 1530, wall on its north edge; fork
    // qyr08/qyr09 logged it chaos-CLOSED there). With Razmire within 1 tile (he wanders his shop, e.g. 3489,3295)
    // walkOp(near 1) is 'arrived' at once and only go() runs: routeNextTo (doors:false, by design: no door op in the npc
    // op's flush) never opens it, and the engine parks each use behind the door with no message, 3 x 60 t (INFERRED for
    // qyo04: npc tile not logged; with him 2 tiles in, qyr09 MORT_RAZ=0, walkOp's own door handling got through +47 t). 281: the npc op goes through approachNpc
    // with doors ON (a closed door on the route is walked to and opened first, the op follows on the next send), a
    // closed door next to us or the npc is opened explicitly, and 6 shorter rounds (30 t) instead of 3 x 60.
    // MORT_RAZ=0 reverts.
    const RAZ = process.env.MORT_RAZ !== '0';
    for (let k = 0; k < (RAZ ? 6 : 3) && !done(); k++) {
        await defend(bot);
        dismiss(bot); await bot.tick(1);   // a leftover page (e.g. the brew message box) blocks walking
        if (!npcsOf(bot, types).length) await walkOp(bot, at, null, () => npcsOf(bot, types).length > 0, { near: 3, maxTicks: 300 });
        const n = npcsOf(bot, types)[0]; if (!n) fail(bot, `${label}: npc not in view`);
        // the cleared (visible) form answers OPNPC1 directly; the afflicted one needs the serum (opnpcu)
        const s = await ensureSerum(bot);
        const visible = n.type === types[1];
        if (RAZ) {
            const d = closedDoorNear(bot, n);
            if (k > 0 || d) console.log(`[mortton] ${label} round ${k + 1}: me ${bot.tile().x},${bot.tile().z} npc ${n.type}@${n.x},${n.z} closed door ${d ? `${d.locId}@${d.x},${d.z}` : '-'}`);
            if (d) {
                openDoorAt(bot, d.locId, d.x, d.z);
                await bot.until(() => !bot.doorTracker?.closedDoorAt(bot.minusedlevel, d.x, d.z), 8);
            }
        }
        const go = () => {
            const m = npcsOf(bot, types)[0]; if (!m) return false;
            if (RAZ) { approachNpc(bot, m, () => { if (visible) bot.opNpc(m.idx, 1); else { const sl = bot.slot(s); if (sl >= 0) bot.useItemOnNpc(m.idx, objId(s), sl); } }); return true; }
            routeNextTo(bot, m); if (visible) bot.opNpc(m.idx, 1); else bot.useItemOnNpc(m.idx, objId(s), bot.slot(s)); bot.queueFlush(); return true;
        };
        if (!(await walkOp(bot, { x: n.x, z: n.z }, go, () => inDialog(bot), { near: 1, maxTicks: RAZ ? 30 : 60 }))) {
            const m = npcsOf(bot, types)[0], dd = m ? closedDoorNear(bot, m) : null;
            console.log(`[mortton] ${label} round ${k + 1}: no dialog; me ${bot.tile().x},${bot.tile().z} npc ${m ? `${m.type}@${m.x},${m.z}` : '-'} closed door ${dd ? `${dd.locId}@${dd.x},${dd.z}` : '-'} chat ${bot.chatModalId} main ${bot.mainModalId}`);
            continue;
        }
        await talk(bot, [], plan, { noOp: true, done, answers, maxTicks: 40, label });
    }
    if (!done()) fail(bot, `${label}: not done`);
    dismiss(bot);
}
/** fix 281: a CLOSED door (live tracker) within 1 tile of us or of the npc, nearest the npc first */
function closedDoorNear(bot: SpeedBot, n: { x: number; z: number }): { locId: number; x: number; z: number } | null {
    const tr = bot.doorTracker; if (!tr) return null;
    const me = bot.tile(), lv = bot.minusedlevel;
    for (const c of [n, me]) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const x = c.x + dx, z = c.z + dz;
        if (cheb({ x, z }, me) > 2 && cheb({ x, z }, n) > 1) continue;
        const cd = tr.closedDoorAt(lv, x, z);
        if (cd) return { locId: cd.locId, x, z };
    }
    return null;
}

async function body(bot: SpeedBot, o: ShadeOpts, at: (k: string) => void): Promise<boolean> {
    let skipping = !!o.from;
    const P = (name: string) => { if (skipping && name === o.from) skipping = false; return !skipping; };
    const shelf = locAt(4062, 3481, 3279, 0);

    if (P('book')) {
        // ---- 1. the diary: shelf -> read to page 12 (5) --------------------------------------------------------------
        if (!has(bot, 'serum_book') && !(await opLocReach(bot, shelf, 1, () => has(bot, 'serum_book'), { maxTicks: 120 }))) fail(bot, 'no diary from the shelf');
        dismiss(bot);
        for (let k = 0; k < 6 && !seenText(bot, /Index of Solution/); k++) {
            await defend(bot); dismiss(bot);
            bot.opHeld1(objId('serum_book'), bot.slot('serum_book')); bot.queueFlush();
            await bot.until(() => inDialog(bot) || bot.mainModalId === 837, 6);
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }      // the objbox page before the book
            await bot.until(() => bot.mainModalId === 837, 6);
            // 12 x "next page" (book:com_86), 5 per tick
            for (let p = 0; p < 12; p++) bot.ifButton(841);
            bot.queueFlush();
            await bot.until(() => seenText(bot, /Index of Solution/), 6);
        }
        if (!seenText(bot, /Index of Solution/)) fail(bot, 'diary: last page not reached');
        bot.closeModal(); await bot.tick(1);
        at('stage5');
    }
    if (P('serum')) {
        // ---- 2. brew serum 207 (10): must be brewed AFTER reading (herblore.rs2:16) ----------------------------------
        await ensureSerum(bot);
        at('stage10');
    }
    if (P('razmire1')) {
        // TEST (fix 281 proof): MORT_TEST_RAZDOOR=1 stands at 3488,3294 (the qyo04 spot) with Razmire's doorway door
        // (tracker tile 3488,3294, our own tile) CLOSED first: closes it when open (the open leaf within 1 tile, its own op)
        if (process.env.MORT_TEST_RAZDOOR === '1') {
            await walkOp(bot, { x: 3488, z: 3294 }, null, () => false, { maxTicks: 60 });
            for (let k = 0; k < 4 && bot.doorTracker?.isOpen(0, 3488, 3294) !== false; k++) {
                let leaf: { x: number; z: number; id: number; op: number } | null = null;
                for (const [key, id] of bot.liveLocs) {
                    const [l, x, z] = key.split(',').map(Number); const d = doorDef(id);
                    if (l === 0 && d?.state === 'open' && cheb({ x: x!, z: z! }, { x: 3488, z: 3294 }) <= 1) { leaf = { x: x!, z: z!, id, op: d.op }; break; }
                }
                console.log(`[mortton] TEST razdoor: tracker open=${bot.doorTracker?.isOpen(0, 3488, 3294)} leaf ${leaf ? `${leaf.id}@${leaf.x},${leaf.z} op${leaf.op}` : '-'}`);
                if (!leaf) break;
                bot.opLoc(leaf.x, leaf.z, leaf.id, leaf.op); bot.queueFlush();
                await bot.until(() => bot.doorTracker?.isOpen(0, 3488, 3294) === false, 6);
                if (cheb(bot.tile(), { x: 3488, z: 3294 }) > 0) await walkOp(bot, { x: 3488, z: 3294 }, null, () => false, { maxTicks: 20 });
            }
            console.log(`[mortton] TEST razdoor: at ${bot.tile().x},${bot.tile().z}, door closed=${bot.doorTracker?.isOpen(0, 3488, 3294) === false}`);
        }
        await serumTalk(bot, RAZMIRE, RAZ_AT, [R, M5[3]!, R, R, R, M3[0]!, R, R], () => seenText(bot, /inspect them/), 'razmire15',
            [/^What are all these shadow creatures/, /^Yes, I'll dispatch/]);
        at('stage15');
    }
    const stopPray = prayGuard(bot);
    try {
    if (P('shades')) {
        // ---- 3. five Loar shades (20..40) and their remains ------------------------------------------------------------
        const since = bot.tickCount;
        const bones = objId('shade_bones1');
        // session 11 fix 275c (qx31 retry 'need 5 free slots for the Loar remains (free 4)' while holding 3): a retry keeps
        // the remains it holds and the kills the quest already counted. Kill baseline = the JOURNAL's 'I've killed N shades'
        // (mortton_journal.rs2:76-87; the kill messages of the first attempt are not seen again); free slots needed = the
        // remains still missing, after dropping junk (empty vials; the diary once stage 5 is past). MORT_HELD=0 reverts.
        const HELD = process.env.MORT_HELD !== '0';
        let base = 0;
        if (HELD && isResuming(bot)) {
            const W: Array<[RegExp, number]> = [[/killed all\s+five\s+shades/i, 5], [/killed four\s+shades/i, 4], [/killed three\s+shades/i, 3], [/killed two\s+shades/i, 2], [/killed one\s+shade/i, 1]];
            base = await journalStage(bot, 'mortton', W, 0, s => console.log(`[mortton] ${s}`));
        }
        const kills = () => { const m = msgsSince(bot, since).join(' | '); return Math.max(base, /all five Shades/.test(m) ? 5 : /four Shades/.test(m) ? 4 : /three Shades/.test(m) ? 3 : /two Shades/.test(m) ? 2 : /one Shade!/.test(m) ? 1 : 0); };
        const need = () => HELD ? Math.max(0, 5 - bot.count(bones)) : 5;
        if (HELD && bot.free() < need()) {
            const junk = ['vial_empty', ...(serum(bot) ? ['serum_book'] : [])].filter(x => has(bot, x));
            if (junk.length) { await bot.dropAll(junk); console.log(`[mortton] dropped ${junk.join(',')} for the remains (free ${bot.free()}, need ${need()})`); }
        }
        if (bot.free() < need()) fail(bot, `need ${need()} free slots for the Loar remains (free ${bot.free()})`);
        let target = -1, lastAtk = -99;
        let lastPick = -99;
        // session 11 fix 275a/b (qx31 'shades: 3/5 kills after 900 t', ~700 t standing still at 3494,3289 with hp rising):
        // Loar shadows wander 30 tiles (maxrange 60, mortton_shades.npc) into the ruins; attackFrom finds no path to a shade
        // behind a ruin wall, sends a bare opnpc the naive server approach never completes, and the loop re-attacked that
        // same unreachable target every 6 t forever (or idled at the 3492,3290 spot with none in view). 275a: no progress
        // (no tile change, no combat xp, no new kill) for 12 t on one target -> skip it for 150 t; 275b: none (left) in
        // view -> roam the spawn points of m54_51 (25 spawns, respawn 35 t) instead of standing. MORT_STALL=0 reverts both.
        const STALL = process.env.MORT_STALL !== '0';
        const skip = new Map<number, number>();
        const ROAM = [{ x: 3492, z: 3290 }, { x: 3496, z: 3296 }, { x: 3483, z: 3295 }, { x: 3488, z: 3282 }, { x: 3474, z: 3280 }, { x: 3501, z: 3294 }];
        let roam = 0;
        const cxp = () => bot.stat('attack').xp + bot.stat('strength').xp + bot.stat('defence').xp + bot.stat('hitpoints').xp;
        let progT = bot.tickCount, progXp = cxp(), progTile = `${bot.tile().x},${bot.tile().z}`, progKey = '';
        let lastDiag = bot.tickCount, stillTile = '', stillT = bot.tickCount, xpSeen = cxp();
        // Razmire wants FIVE remains in the pack (razmire_keelgan.rs2:102; takes 2), Ulsquire 1, the pyre 1: extra kills
        // still drop remains
        while (kills() < 5 || bot.count(bones) < 5) {
            if (bot.tickCount - since > 900) fail(bot, `shades: ${kills()}/5 kills, ${bot.count(bones)} remains after 900 t`);
            const lvl = levelUpOpen(bot);
            if (bot.chatModalId !== -1 && !lvl) dismiss(bot);
            // TEST (fix 275 proof): SR_FAIL_AT=mort-shades3 throws once at 3 kills (the qx31 state) so the retry runs 275c
            if (kills() === 3) failHook('mort-shades3');
            const all = npcsOf(bot, SHADES).filter(q => !STALL || (skip.get(q.idx) ?? -1) < bot.tickCount);
            if (STALL) {
                const tile = `${bot.tile().x},${bot.tile().z}`, key = `${kills()}/${bot.count(bones)}`, xp = cxp();
                if (xp !== xpSeen || key !== progKey) { xpSeen = xp; stillT = bot.tickCount; }
                if (tile !== stillTile) { stillTile = tile; stillT = bot.tickCount; }
                // 275b: standing on one tile 40 t with no kill (fork qyo07: 180 t in Razmire's doorway 3488,3295 under door
                // chaos, every shade skipped in turn) -> a door-aware walkOp to the next roam point
                else if (bot.tickCount - stillT >= 40) {
                    const p = ROAM[roam++ % ROAM.length]!;
                    console.log(`[mortton] standing 40 t at ${tile}: roam to ${p.x},${p.z}`);
                    await walkOp(bot, p, null, () => false, { near: 2, maxTicks: 40 });
                    stillT = bot.tickCount; target = -1; progT = bot.tickCount; await bot.tick(1); continue;
                }
                if (tile !== progTile || xp !== progXp || key !== progKey) { progTile = tile; progXp = xp; progKey = key; progT = bot.tickCount; }
                else if (target >= 0 && bot.tickCount - progT >= 12) {
                    console.log(`[mortton] shade ${target} no progress for 12 t at ${tile}: skipped for 150 t (kills ${kills()}, remains ${bot.count(bones)})`);
                    skip.set(target, bot.tickCount + 150); target = -1; progT = bot.tickCount; continue;
                }
                if (bot.tickCount - lastDiag >= 150) { lastDiag = bot.tickCount; console.log(`[mortton] shades +${bot.tickCount - since}: kills ${kills()} remains ${bot.count(bones)} in view ${all.length} me ${tile}`); }
            }
            const fighting = all.filter(q => q.d <= 1);
            const g = bot.findGroundItem(bones, 12);
            // remains vanish after 200 t (lootdrop.constant): pick them up even mid-fight (a pickup is 1-2 t)
            if (g && bot.count(bones) < 5 && (!fighting.length || bot.tickCount - lastPick > 8)) {
                lastPick = bot.tickCount; await pickup(bot, 'shade_bones1', 12, 8); continue;
            }
            let t = all.find(q => q.idx === target) ?? null;
            if (!t) t = all[0] ?? null;
            if (!t && STALL) {
                const p = ROAM[roam++ % ROAM.length]!;
                await walkOp(bot, p, null, () => npcsOf(bot, SHADES).some(q => (skip.get(q.idx) ?? -1) < bot.tickCount && q.d <= 8), { near: 2, maxTicks: 40 });
                target = -1; progT = bot.tickCount; await bot.tick(1); continue;
            }
            if (!t) { await walkOp(bot, { x: 3492, z: 3290 }, null, () => npcsOf(bot, SHADES).length > 0, { near: 2, maxTicks: 60 }); await bot.tick(1); continue; }   // the tick: walkOp returns at once when already there (a hot loop froze the process)
            // TEST (fix 275a proof): MORT_TEST_STALL=1 picks targets but sends no attack for the first 40 t (a stuck target)
            if (process.env.MORT_TEST_STALL === '1' && bot.tickCount - since < 40) { if (t.idx !== target) { target = t.idx; } }
            else if (lvl || t.idx !== target || bot.tickCount - lastAtk >= 6) { attackFrom(bot, t); target = t.idx; lastAtk = bot.tickCount; }
            if (process.argv.includes('--laps') && (bot.tickCount - since) % 20 === 0) console.log(`[shades +${bot.tickCount - since}] kills ${kills()} bones ${bot.count(bones)} tgt ${t.type}@${t.x},${t.z} d${t.d} me ${JSON.stringify(bot.pos())} near ${all.filter(q => q.d <= 3).length} msgs ${msgsSince(bot, bot.tickCount - 20).slice(-2).join(' / ')}`);
            await bot.tick(1);
        }
        // session 10: the mark is a bare 'stage40' (route-legs phaseRun maps marks by their exact text: 'stage40 remains=N' never
        // matched, so a retry after the shades restarted them); MORT_MARK=0 = the old mark
        if (process.env.MORT_MARK === '0') at(`stage40 remains=${bot.count(bones)}`);
        else { console.log(`[mortton] Loar remains ${bot.count(bones)}`); at('stage40'); }
    }
    if (P('razmire2')) {
        const n0 = bot.count('shade_bones1');
        await serumTalk(bot, RAZMIRE, RAZ_AT, [R, R, R, R, R, R, R], () => bot.count('shade_bones1') <= n0 - 2 && bot.dialogOptions().some(x => /general store/.test(x.text)), 'razmire45');
        at('stage45');
    }
    if (P('ulsquire')) {
        const n0 = bot.count('shade_bones1');
        await serumTalk(bot, ULSQUIRE, ULS_AT, [R, R, R, R, R, R], () => bot.count('shade_bones1') < n0 && !inDialog(bot), 'ulsquire47');
        at('stage47');
        await serumTalk(bot, ULSQUIRE, ULS_AT, [R, M5[1]!, R, R, R, R], () => seenText(bot, /Razmire stocks all these items/), 'ulsquire50', [/^What can you tell me about that temple/]);
        at('stage50');
    }
    if (P('temple')) {
        const xpBase = bot.stat('crafting').xp;
        if (!heldOil(bot)) await oilFromUlsquire(bot, at);
        await repairTemple(bot, at, xpBase);
        at('stage60');
    }
    if (P('altar')) {
        // ---- 5. light the altar, sanctify the olive oil (65), pyre logs (70) ---------------------------------------------
        // the altar is only "unbroken" (4091) for 99 t after a repair action at 100%, and lit (4090) for 99 t
        // (flamtaer_temple.rs2:85-91,232): light it at once; if it reverted, one more repair action re-arms it
        const live = () => bot.liveLocs.get(`0,${ALTAR.x},${ALTAR.z}`);
        const lit = () => live() === 4090;
        const base = locAt(4092, ALTAR.x, ALTAR.z, 0);
        const t1 = bot.tickCount; let last = -99;
        while (!lit() && bot.tickCount - t1 < 150) {
            if (bot.chatModalId !== -1) dismiss(bot);
            if (bot.tickCount - last >= 8) {
                last = bot.tickCount;
                if (live() === 4091) { if (cheb(bot.tile(), { x: 3506, z: 3315 }) > 0) await walkOp(bot, { x: 3506, z: 3315 }, null, () => false, { maxTicks: 10 }); bot.opLoc(base.x, base.z, 4091, 1); bot.queueFlush(); }
                else { const w = WALLS[1]!; if (cheb(bot.tile(), w.stand) > 0) await walkOp(bot, w.stand, null, () => false, { maxTicks: 10 }); bot.opLoc(w.x, w.z, w.base + 10, 1); bot.queueFlush(); }
            }
            await bot.tick(1);
        }
        if (!lit()) fail(bot, `altar not lit (live ${live()})`);
        const altar = base;
        at('altar-lit');
        const fire = { ...altar, id: 4090 };
        const oil = heldOil(bot); if (!oil) fail(bot, 'no olive oil');
        if (!(await useOnLocUntil(bot, oil, fire as any, { x: 3505, z: 3316 }, () => ['sacred_oil4', 'sacred_oil3', 'sacred_oil2'].some(x => has(bot, x)), { maxTicks: 20 }))) fail(bot, 'no sacred oil');
        at('stage65');
        const so = ['sacred_oil4', 'sacred_oil3', 'sacred_oil2'].find(x => has(bot, x))!;
        for (let k = 0; k < 4 && !has(bot, 'logs_pyre'); k++) {
            dismiss(bot);
            bot.useItemOnItem(objId(so), bot.slot(so), objId('logs'), bot.slot('logs')); bot.queueFlush();
            await bot.until(() => has(bot, 'logs_pyre'), 3);
        }
        if (!has(bot, 'logs_pyre')) fail(bot, 'no pyre logs');
        at('stage70');
    }
    if (P('pyre')) {
        // ---- 6. the pyre (75/80): logs, remains, light -------------------------------------------------------------------
        const pyre = locAt(4093, 3507, 3276, 0);
        const live = () => bot.liveLocs.get(`0,${pyre.x},${pyre.z}`);
        if (!(await useOnLocUntil(bot, 'logs_pyre', pyre, { x: 3506, z: 3277 }, () => !has(bot, 'logs_pyre'), { maxTicks: 200 }))) fail(bot, 'pyre logs on the pyre');
        at('stage75');
        // route runner (fix 93): a resumed pyre phase (the logs already on it) starts far away: walk to the pyre first
        if (cheb(bot.tile(), { x: 3506, z: 3277 }) > 2) await bot.walkTo(3506, 3277, { near: 1, maxTicks: 120, log: false });
        const withLogs = { ...pyre, id: 4094 }, withBones = { ...pyre, id: 4100 };
        for (let k = 0; k < 6 && live() !== 4100; k++) { dismiss(bot); bot.useItemOnLoc(pyre.x, pyre.z, 4094, objId('shade_bones1'), bot.slot('shade_bones1')); bot.queueFlush(); await bot.until(() => live() === 4100, 4); }
        if (live() !== 4100) fail(bot, `remains on the pyre (live ${live()})`);
        void withLogs;
        const since = bot.tickCount;
        for (let k = 0; k < 40 && !msgsSince(bot, since).some(m => /You light|burns|pyre/i.test(m) && !/attempt/i.test(m)) && live() === 4100; k++) {
            if (k % 8 === 0) { dismiss(bot); bot.opLoc(withBones.x, withBones.z, withBones.id, 1); bot.queueFlush(); }
            await bot.tick(1);
        }
        await bot.tick(2);
        at('stage80');
    }
    } finally { stopPray(); }
    // ---- 7. Ulsquire: complete ------------------------------------------------------------------------------------------
    await serumTalk(bot, ULSQUIRE, ULS_AT, [R, R, R], () => seenText(bot, /Mort'ton' Quest Complete/), 'complete');
    await waitText(bot, /Mort'ton' Quest Complete/, 10);
    at('complete');
    return seenText(bot, /Mort'ton' Quest Complete/);
}

/** Repair the 15 temple walls to level 10 (stage 55 -> 60). */
const OILS = ['oliveoil4', 'oliveoil3', 'oliveoil2'];   // >= 2 doses: the pyre logs take 2 (flamtaer_pyre.struct)
const heldOil = (bot: SpeedBot) => OILS.find(x => has(bot, x)) ?? null;

/** Supply-gap change one temple repair action (stage 50 -> 55, flamtaer_temple.rs2:76-78), then Ulsquire's
 *  "What should I do when the temple is built?" -> oliveoil3 (ulsquire_shauncy.rs2:128-137, once, needs a free slot).
 *  He is still cleared from the stage-47 serum dose (200 t), else serumTalk spends a dose. */
async function oilFromUlsquire(bot: SpeedBot, at: (k: string) => void): Promise<void> {
    if (!has(bot, 'hammer') && !has(bot, 'flamtaer_hammer')) fail(bot, 'no hammer');
    const w = WALLS[0]!, xp0 = bot.stat('crafting').xp;
    const loc = { ...locAt(w.base, w.x, w.z, 0), id: w.base };
    for (let k = 0; k < 4 && bot.stat('crafting').xp === xp0; k++) {
        await defend(bot);
        if (bot.chatModalId !== -1) dismiss(bot);
        if (cheb(bot.tile(), w.stand) === 0) { bot.opLoc(loc.x, loc.z, loc.id, 1); bot.queueFlush(); }
        else await walkOp(bot, w.stand, () => bot.opLoc(loc.x, loc.z, loc.id, 1), () => cheb(bot.tile(), w.stand) === 0, { maxTicks: 60 });
        await bot.until(() => bot.stat('crafting').xp > xp0, 8);
    }
    if (bot.stat('crafting').xp === xp0) fail(bot, 'oil: first temple repair action not done (stage 55)');
    at('stage55');
    if (bot.free() < 1) fail(bot, 'oil: Ulsquire needs a free slot for the olive oil');
    await serumTalk(bot, ULSQUIRE, ULS_AT, [R, R, R, M4[0]!, R, R, R], () => has(bot, 'oliveoil3'), 'ulsquire-oil', [/^What should I do when the temple is built/]);
    at('oil from Ulsquire');
}

async function repairTemple(bot: SpeedBot, at: (k: string) => void, xpBase?: number): Promise<void> {
    if (!has(bot, 'hammer') && !has(bot, 'flamtaer_hammer')) fail(bot, 'no hammer');
    const lvl = (w: Wall) => { const id = bot.liveLocs.get(`0,${w.x},${w.z}`); return id === undefined ? 0 : Math.max(0, id - w.base); };
    const repairedP = () => bot.getVarp(343);
    const done = () => repairedP() >= 100 || WALLS.every(w => lvl(w) >= 10);
    let build = 0, xp0 = xpBase ?? bot.stat('crafting').xp, current: Wall | null = null, lastXpTick = bot.tickCount, actions = 0, lastSend = -99;
    const t0 = bot.tickCount;
    const can = (w: Wall) => lvl(w) < 10 && build + 35 > 300 + 400 * lvl(w);
    const choose = (): Wall => {
        const me = bot.tile();
        const open = WALLS.filter(w => lvl(w) < 10);
        const ok = open.filter(can);
        const pool = ok.length ? ok : open;
        // stay if the current wall can still level; else nearest by stand distance, interior before corners
        if (current && pool.includes(current) && (can(current) || !ok.length)) return current;
        return pool.slice().sort((a, b) => (Number(a.corner) - Number(b.corner)) || (cheb(a.stand, me) - cheb(b.stand, me)) || (lvl(a) - lvl(b)))[0]!;
    };
    while (!done()) {
        // route runner (fix 89): 1200 t was too short for a high-crafting route account (qri2m 95% after 1200 t twice; the
        // header measures up to ~2,600 t at crafting ~64)
        if (bot.tickCount - t0 > 3000) fail(bot, `temple: ${repairedP()}% after 3000 t (walls ${WALLS.map(lvl).join(',')})`);
        if (msgsSince(bot, bot.tickCount - 2).some(m => /need to increase your material resource/.test(m)) || seenText(bot, /Resources needed/)) fail(bot, 'temple: out of resources');
        const xp = bot.stat('crafting').xp;
        if (xp > xp0) { build += Math.round((xp - xp0) * 0.4); xp0 = xp; actions++; lastXpTick = bot.tickCount; }
        if (bot.chatModalId !== -1) { if (levelUpOpen(bot)) bot.resumeDialogPage(); else dismiss(bot); bot.queueFlush(); }
        // shades rise near the temple while it is being built and attack us: kill them first (+60 sanctity each, mortton_shades.rs2:20-28)
        if (!bot.isPrayerActive('protectfrommelee') && npcsOf(bot, 1241).some(q => q.d <= 2)) { await defend(bot, 200); current = null; continue; }
        const next = choose();
        const stale = bot.tickCount - lastXpTick > 6 && bot.tickCount - lastSend > 6;
        if (next !== current || stale) {
            current = next;
            const loc = { ...locAt(next.base, next.x, next.z, 0), id: next.base + lvl(next) };
            if (cheb(bot.tile(), next.stand) === 0) { bot.opLoc(loc.x, loc.z, loc.id, 1); bot.queueFlush(); }
            else await walkOp(bot, next.stand, () => bot.opLoc(loc.x, loc.z, loc.id, 1), () => cheb(bot.tile(), next.stand) === 0, { maxTicks: 30 });
            lastSend = bot.tickCount;
        }
        await bot.tick(1);
        if (process.argv.includes('--laps') && (bot.tickCount - t0) % 30 === 0) console.log(`[temple +${bot.tickCount - t0}] actions ${actions} build~${build} repaired ${repairedP()}% walls ${WALLS.map(lvl).join(',')} res ${bot.getVarp(344)}% sanct ${bot.getVarp(345)}%`);
    }
    at(`temple ${actions} actions build~${build}`);
}

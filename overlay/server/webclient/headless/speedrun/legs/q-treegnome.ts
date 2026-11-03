// q-treegnome.ts — Tree Gnome Village (quest_tree): 11,450 base attack xp (x25 -> attack 80 from 1; on top of the
// Waterfall's 83 it puts attack at ~93). Prerequisite of Monkey Madness (with The Grand Tree). LOCAL ONLY.
// Content: scripts/quests/quest_tree/*, areas/area_gnome/scripts/{king_bolren,commander_montai,elkoy,gnomevillage_fence}.rs2
// (static map: `bun plan/tools/quest-contract.ts treequest` in the 289 tree).
//
// PRECONDITIONS: Camelot teleport runes (law 1, air 5) (Ardougne teleport needs Plague City), `logs` x6, sharks, a melee weapon wielded (the Khazard
//   warlord: 170 hp, def 80, crush). Prayer > 0 helps (Protect from Melee) but is not required.
// EXIT STATE: next to King Bolren inside the village (2542,3169), attack +114,500 tenths xp, quest points +2.
// STEPS:
//   maze -> Bolren ("Can I help at all?" / "I would be glad to help.", Elkoy jumps you out to 2504,3191)
//   -> Montai x3 (wood / 6 logs / "I'll try my best.") -> ballista op2 with the FIXED coordinates 4,3,5 (quest_tree.rs2:
//   no tracker gnomes needed) -> climb the rubble wall (2509,3253) -> ladder up -> chest (open, search: orb)
//   -> ladder down -> stronghold door out -> Elkoy ("Yes please." -> 2515,3159) -> loose railing north
//   -> Bolren ("I will find the warlord...", Elkoy jumps you out) -> kill the warlord (2457,3302, wanders 9)
//   -> Elkoy -> railing -> Bolren (orbs: quest complete).
import { startEatWatch } from './k-mcannon-quest.js';
import { SpeedBot, objId, cheb } from '../core.js';
import { nav, npc, npcsOf, opNpcGo, drive, inDialog, log, trace, tele, locAt, opLocGo, qp, dismiss, talk, waitText, type Tile } from './q-lib.js';
import { isResuming, journalStage, failHook } from './qp/journal.js';

export const TREEGNOME_SUPPLY = [{ name: 'logs', n: 6 }];
/** session 11 fix 408b: accounts (lowercase) whose 6 logs Montai has taken this process (a route retry then needs none) */
export const TGV_LOGS_GIVEN = new Set<string>();
/** live prerequisites (quest-sharing.md): what an account needs before treeGnomeLeg; the launcher prints and checks them */
export const TREEGNOME_REQUIREMENTS = {
    quests: [] as string[],
    // hard = the game refuses below it (checked by the launcher); soft = recommended combat levels (sim-proven levels in the why)
    skills: [
        { skill: 'magic', level: 45, hard: true, why: 'the leg starts with a Camelot teleport (law 1 + air 5)' },
        { skill: 'attack', level: 60, hard: false, why: 'the Khazard warlord (lvl 112, 170 hp, def 80): the sim runs att/str 83' },
        { skill: 'strength', level: 60, hard: false, why: 'same fight' },
        { skill: 'hitpoints', level: 60, hard: false, why: 'the warlord hits hard: the sim runs hp 72 with 10 sharks' },
        { skill: 'prayer', level: 43, hard: false, why: 'Protect from Melee (lvl 43) during the warlord, topped up with prayer restores (optional but the sim always has it)' },
    ],
    gear: 'a melee weapon wielded (the sim wields a rune scimitar); the warlord (att 75, str 78) hits crush',
    start: 'anywhere a Camelot teleport works (not Wilderness > 20, not mid-dialog)',
};
const POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'].map(n => objId(n));
const BOLREN = 469, MONTAI = 470, ELKOY = 473, WARLORD = 477, COMMANDER = 478;
const MAZE_ENTRY = { x: 2504, z: 3192 }, RAIL_N = { x: 2515, z: 3161 }, RAIL_S = { x: 2515, z: 3160 }, BOLREN_AT = { x: 2540, z: 3169 };   // Bolren stands against a fence on his east side: approach from the west
const ELKOY_AT = { x: 2504, z: 3191 }, MONTAI_AT = { x: 2523, z: 3210 }, BALLISTA_STAND = { x: 2508, z: 3209 };
const WALL_STAND = { x: 2509, z: 3252 }, LADDER = { x: 2503, z: 3252 }, CHEST = { x: 2506, z: 3259 }, WARLORD_AT = { x: 2457, z: 3302 };
const RAILING = () => locAt(2186, 2515, 3161), BALLISTA = () => locAt(2181, 2508, 3210), WALL = () => locAt(2185, 2509, 3253);
const LADDER_UP = () => locAt(1747, 2503, 3252), LADDER_DOWN = () => locAt(1746, 2503, 3252, 1), DOOR = () => locAt(2184, 2502, 3250);
const LOGS = objId('logs'), ORB = objId('orb_of_protection'), ORBS = objId('orbs_of_protection');

export async function treeGnomeLeg(bot: SpeedBot, o: { verbose?: boolean; maxTicks?: number; teleport?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;   // T13: LeanBot's own dialog driver answered the ballista's x page with option 1
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    if (o.verbose) trace(bot, t0);
    const at = (s: string) => { m[s] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${s} pos=${JSON.stringify(bot.tile())} L${bot.minusedlevel} hp=${bot.stat('hitpoints').cur}`); failHook(`tgv:${s}`); };
    const fail = (s: string): never => { throw new Error(`treegnome: ${s} at ${JSON.stringify(bot.pos())}`); };
    const qp0 = qp(bot);
    const walk = async (to: Tile, label: string, near = 1, level?: number) => {
        const r = await bot.walkTo(to.x, to.z, { near, maxTicks: 600, level: level ?? bot.minusedlevel, log: !!process.env.TG_LOG });
        if (cheb(bot.tile(), to) > near + 2) fail(`walk ${label} ${JSON.stringify(r)}`);
    };
    const talkTo = async (type: number, stand: Tile, answers: RegExp[], done: () => boolean, label: string) => {
        if (npc(bot, type) === null || cheb(bot.tile(), stand) > 6) await walk(stand, label, 2);
        // done only counts after this talk opened a dialog (T7: montai-1 'finished' before talking, !inDialog was already true)
        let opened = false;
        const r = await talk(bot, type, [], { done: () => { if (inDialog(bot)) opened = true; return opened && done(); }, answers, maxTicks: 80, label });
        if (!r.ok) fail(`${label} dialog`);
        dismiss(bot); at(label);
    };
    // into the village: Elkoy (outside) jumps you to 2515,3159 once the quest is started; then the loose railing north
    const squeezeIn = async (label: string) => {
        // the railing (south wall of 2515,3161) moves you one tile, (2515,3160) -> (2515,3161); the maze and the village both lie
        // around it, so success = standing on the north tile, not a z test
        let ok = false;
        for (let k = 0; k < 3 && !ok; k++) {
            if (cheb(bot.tile(), RAIL_S) > 0) await walk(RAIL_S, `railing-s-${label}`, 0);
            opLocGo(bot, RAILING(), 1, RAIL_S); bot.queueFlush();
            ok = await bot.until(() => bot.tile().x === RAIL_N.x && bot.tile().z === RAIL_N.z, 8);
        }
        if (!ok) fail(`loose railing (${label})`);
        at(`railing-${label}`);
    };
    // 286 (qx32m 'elkoy-in dialog' at (2501,3190) after the warlord; a plain fork qyt03 did not reproduce; cause INFERRED: no
    // drop near it (the 1012 was ~500 t earlier and later talks worked), no stuck report at the spot (the bot kept moving =
    // chasing Elkoy), Elkoy's shape is the plain 'Yes please.' one: Elkoy wandered behind the maze hedge next to the entrance,
    // where an OPNPC route is the maze itself, and 80 t ran out): round 2 = walk onto his stand + wait up to 10 t for him to
    // be within 2 tiles, talk again; round 3 = through the maze as at the start (same railing). Each failed round logs where
    // Elkoy was. TGV_ELKOY_FIX=0 = one talk as before; TGV_ELKOY_TEST=1|2 = force round 1 (|and 2) to fail (TEST only).
    const elkoyInMaze = async (label: string) => {
        await walk(MAZE_ENTRY, `maze-entry-${label}`, 2);
        await squeezeIn(`maze-${label}`);
    };
    const toVillage = async () => {
        const elkoyDone = () => cheb(bot.tile(), { x: 2515, z: 3159 }) <= 2 && !inDialog(bot);
        if (process.env.TGV_ELKOY_FIX === '0') {
            await talkTo(ELKOY, ELKOY_AT, [/^Yes please\.$/], elkoyDone, 'elkoy-in');
            await squeezeIn('elkoy');
            return;
        }
        const forced = Number(process.env.TGV_ELKOY_TEST ?? 0);
        for (let k = 0; k < 2; k++) {
            try {
                if (k < forced) throw new Error(`TEST: elkoy-in round ${k + 1} forced to fail`);
                if (k === 1) {   // round 2: onto his stand, give him time to wander back out of the hedge
                    if (bot.chatModalId !== -1) { dismiss(bot); await bot.tick(1); }
                    await walk(ELKOY_AT, 'elkoy-stand', 1);
                    await bot.until(() => { const e = npc(bot, ELKOY); return e !== null && e.d <= 2; }, 10);
                }
                await talkTo(ELKOY, ELKOY_AT, [/^Yes please\.$/], elkoyDone, 'elkoy-in');
                await squeezeIn('elkoy');
                return;
            } catch (e) {
                const el = npc(bot, ELKOY);
                log(bot, t0, `286: elkoy-in round ${k + 1} failed (${String((e as Error).message).slice(0, 80)}); bot ${JSON.stringify(bot.tile())} Elkoy ${el ? `${el.x},${el.z} d${el.d}` : 'not seen'} chat ${bot.chatModalId}`);
                if (bot.tile().x === RAIL_N.x && bot.tile().z === RAIL_N.z) return;   // in already
                if (cheb(bot.tile(), { x: 2515, z: 3159 }) <= 2) { await squeezeIn('elkoy-again'); return; }   // jumped in, the railing failed
            }
        }
        if (bot.chatModalId !== -1) { dismiss(bot); await bot.tick(1); }
        log(bot, t0, '286: elkoy-in round 3: through the maze');
        await elkoyInMaze('elkoy');
    };

    // session 11 (so the route may retry TGV): on a retry, the stage the quest JOURNAL shows (tree_journal.rs2, open-task text,
    // latest first): 0 not started .. 8 warlord dead. Every later step is re-entrant (the chest re-gives a lost orb up to stage
    // 6, the warlord re-drops lost orbs at 7/8), so a stage whose item is no longer held falls back one step. TGV_RESUME=0 =
    // from the top as before.
    let S = 0;
    if (isResuming(bot) && process.env.TGV_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        S = await journalStage<number>(bot, 'tree', [
            [/QUEST COMPLETE/i, 9], [/return them now to\s+King Bolren/i, 8], [/retrieve the\s+two remaining orbs/i, 7],
            [/return the\s+orb\s+to\s+King Bolren/i, 6], [/get inside and retrieve/i, 5], [/three\s+Gnome\s+trackers/i, 4],
            [/speak to\s+Montai\s+again/i, 3], [/need to bring\s+Montai\s+logs/i, 2], [/Commander Montai/i, 1],
        ], 0, s2 => log(bot, t0, s2));
        if (S === 9) { m.ok = true; m.resumed = true; return m; }
        if (S === 6 && !bot.count(ORB)) S = 5;
        if (S === 8 && !bot.count(ORBS)) S = 7;
        if (S === 2 && bot.count(LOGS) < 6) log(bot, t0, `resume at the logs with only ${bot.count(LOGS)} logs held`);
        m.resumeStage = S;
        log(bot, t0, `resume at stage ${S}`);
    }
    if (o.teleport ?? true) { if (!(await tele(bot, 'camelot_teleport')).ok) fail('camelot teleport'); at('tele'); }   // Ardougne teleport needs Plague City
    // 1. maze -> Bolren: start the quest
    if (S <= 0) {
    await walk(MAZE_ENTRY, 'maze-entry', 2);
    await squeezeIn('maze');   // T4 (sim): the maze ends SOUTH of the loose railing; the village is north of it
    await talkTo(BOLREN, BOLREN_AT, [/^Can I help at all\?$/, /^I would be glad to help\.$/], () => cheb(bot.tile(), ELKOY_AT) <= 2 && !inDialog(bot), 'bolren-start');
    }
    // 2. Montai: talk, logs, "I'll try my best."
    if (S <= 1 && process.env.TG_LOGS_TEST !== '1') await talkTo(MONTAI, MONTAI_AT, [/^Ok, I'll gather some wood\.$/], () => !inDialog(bot), 'montai-1');
    // late replies (live, sim XA1/XA2): montai-1's done can fire in the gap between two pages, BEFORE the gather-wood choice;
    // answer it here too (the runday q-treegnome-safe fix) or montai-logs loops until it fails
    if (S <= 2) {
    // session 11 fix 348 (qx136m: a single drop at t10944 killed montai-1's talk before the gather-wood choice; its done fired at
    // the re-attach; montai-logs then got the stage-1 talk, answered the choice (commander_montai.rs2:14-17) and that talk ENDS
    // without taking the logs (only the next one does, :23-33): 80 t idle, 'montai-logs dialog', leg retry ~300 t): first any
    // finished Montai talk, then one more while the 6 logs are still held. TG_LOGS2=0 reverts. TEST TG_LOGS_TEST=1 skips montai-1.
    if (process.env.TG_LOGS2 !== '0') {
        await talkTo(MONTAI, MONTAI_AT, [/^Ok, I'll gather some wood\.$/], () => !inDialog(bot), 'montai-logs');
        if (bot.count(LOGS) >= 6) await talkTo(MONTAI, MONTAI_AT, [/^Ok, I'll gather some wood\.$/], () => bot.count(LOGS) < 6 && !inDialog(bot), 'montai-logs2');
    } else
    await talkTo(MONTAI, MONTAI_AT, [/^Ok, I'll gather some wood\.$/], () => bot.count(LOGS) < 6 && !inDialog(bot), 'montai-logs');
    if (bot.count(LOGS) >= 6) fail('montai took no logs');
    TGV_LOGS_GIVEN.add(String((bot as any).loginUser ?? '').toLowerCase());   // session 11 fix 408b (route.ts need())
    }
    if (S <= 3) await talkTo(MONTAI, MONTAI_AT, [/^I'll try my best\.$/], () => !inDialog(bot), 'montai-3');
    // 3. ballista: height 4, x 3, y 5 (fixed in quest_tree.rs2)
    if (S <= 4) {
    await walk(BALLISTA_STAND, 'ballista', 1);
    {
        // three p_choice5_header pages share one interface: answer by the HEADER text, once per page (T9: answering by
        // position re-clicked the height page and fired with the wrong x)
        const want: [RegExp, RegExp][] = [[/height-coordinate/i, /^0004$/], [/x-coordinate/i, /^0003$/], [/y-coordinate/i, /^0005$/]];
        let fired = false;
        for (let k = 0; k < 3 && !fired; k++) {
            opLocGo(bot, BALLISTA(), 2, BALLISTA_STAND); bot.queueFlush();
            let answered = '', lastClick = -9; const end = bot.tickCount + 40;
            while (bot.tickCount < end) {
                const text = [...bot.ifText.values()].join(' | ');
                if (/directly into|reduced to rubble|already been breached/i.test(text)) { fired = true; break; }
                if (/missed the target/i.test(text) && answered.length === 3) break;
                if (inDialog(bot)) {
                    const header = bot.ifText.get(2493) ?? '';
                    const w = want.findIndex(([h]) => h.test(header));
                    if (process.env.TG_DEBUG) console.log(`[tg] t=${bot.tickCount} modal=${bot.chatModalId} header='${header}' opts=${bot.dialogOptions().map(x => x.text).join('/')} answered=${answered}`);
                    if (bot.dialogOptions().length && w >= 0) { if (!answered.includes(String(w)) && bot.tickCount - lastClick >= 2 && bot.clickDialogByText(want[w]![1]) > 0) { answered += String(w); lastClick = bot.tickCount; } }
                    else if (!bot.dialogOptions().length) bot.resumeDialogPage();
                    bot.queueFlush();
                }
                await bot.tick(1);
            }
        }
        if (!fired) fail('ballista');
        await drive(bot, () => !inDialog(bot), [/.*/], 10);
        at('ballista');
    }
    }
    // 4. stronghold: rubble wall, ladder, chest
    if (S <= 5) {
    await walk(WALL_STAND, 'wall', 0);
    for (let k = 0; k < 3 && bot.tile().z < 3254; k++) { dismiss(bot); opLocGo(bot, WALL(), 1, WALL_STAND); bot.queueFlush(); await bot.until(() => bot.tile().z >= 3254, 10); await drive(bot, () => !inDialog(bot), [/.*/], 6); }
    if (bot.tile().z < 3254) fail('rubble wall');
    at('wall');
    // the Khazard commander (lvl 48, 22 hp) attacks after the wall cutscene and keeps interrupting the ladder (T14): kill it
    const killNear = async (type: number, r: number, max: number) => {
        const end = bot.tickCount + max; let lastOp = -99;
        while (bot.tickCount < end) {
            const n = npc(bot, type); if (!n || n.d > r) return;
            if (bot.tickCount - lastOp > 4) { bot.opNpc(n.idx, 2); bot.queueFlush(); lastOp = bot.tickCount; }
            await bot.tick(1);
        }
    };
    for (let k = 0; k < 4 && bot.minusedlevel === 0; k++) {
        if (o.verbose) log(bot, t0, `ladder try ${k}: at ${JSON.stringify(bot.tile())} npcs ${npcsOf(bot, [COMMANDER, WARLORD, 476, 479, 480]).map(n => `${n.type}@${n.x},${n.z}`).join(' ')} hp ${bot.stat('hitpoints').cur}`);
        if (cheb(bot.tile(), { x: 2503, z: 3253 }) > 1) await bot.walkTo(2503, 3253, { near: 0, maxTicks: 20 });
        opLocGo(bot, LADDER_UP(), 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 1, 12);
    }
    if (bot.minusedlevel !== 1) fail('ladder up');
    at('upstairs');
    for (let k = 0; k < 4 && !bot.count(ORB); k++) {
        const live = bot.liveLocs.get(`1,${CHEST.x},${CHEST.z}`), open = live === 2182;
        if (o.verbose) log(bot, t0, `chest try ${k}: live ${live} at ${JSON.stringify(bot.tile())} L${bot.minusedlevel}`);
        if (open) bot.opLoc(CHEST.x, CHEST.z, 2182, 1); else opLocGo(bot, locAt(2183, CHEST.x, CHEST.z, 1), 1);   // the opened chest is a dynamic loc (not in the static scene)
        bot.queueFlush();
        await bot.until(() => bot.count(ORB) > 0 || (!open && bot.liveLocs.get(`1,${CHEST.x},${CHEST.z}`) === 2182), 12);
        await drive(bot, () => !inDialog(bot), [/.*/], 6);
    }
    if (!bot.count(ORB)) fail('chest orb');
    at('orb');
    for (let k = 0; k < 3 && bot.minusedlevel === 1; k++) { opLocGo(bot, LADDER_DOWN(), 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 0, 12); }
    if (bot.minusedlevel !== 0) fail('ladder down');
    // door 2184 = NORTH wall of (2502,3250) (angle 1): from (2502,3251) it walks you onto (2502,3250), outside (T19)
    for (let k = 0; k < 3 && bot.tile().z > 3250; k++) { opLocGo(bot, DOOR(), 1, { x: 2502, z: 3251 }); bot.queueFlush(); await bot.until(() => bot.tile().z <= 3250, 10); }
    if (bot.tile().z > 3250) fail('stronghold door');
    at('out');
    }
    // 5. orb to Bolren
    if (S <= 6) {
    await toVillage();
    await talkTo(BOLREN, BOLREN_AT, [/^I will find the warlord and bring back the orbs\.$/], () => bot.count(ORB) === 0 && cheb(bot.tile(), ELKOY_AT) <= 2 && !inDialog(bot), 'bolren-orb');
    }
    // 6. the warlord
    if (S <= 7) {
    await walk(WARLORD_AT, 'warlord', 6);
    {
        const stopEat = startEatWatch(bot, Math.max(10, Math.floor(bot.stat('hitpoints').level / 2)));
        // chained runs arrive with the prayer drained by earlier legs (a checkpoint starts full): keep it up with the
        // prayer restores, or the warlord out-damages 12 sharks (TGa/TGb sim lanes died here)
        const pot = () => bot.inv().find(x => POTS.includes(x.obj));
        let lastPot = -99;
        const keepPrayer = () => {
            const p = bot.stat('prayer').cur, s = pot();
            if (p < 20 && s && bot.tickCount - lastPot >= 3 && !inDialog(bot)) { bot.opHeld1(s.obj, s.slot); lastPot = bot.tickCount; }
            if (bot.stat('prayer').cur > 0 && !bot.activePrayers().includes('protectfrommelee')) bot.activatePrayer('protectfrommelee');
            bot.queueFlush();
        };
        keepPrayer();
        let lastOp = -99; const end = bot.tickCount + 900;
        try {
            while (!bot.count(ORBS) && bot.tickCount < end) {
                keepPrayer();
                if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
                const w = npc(bot, WARLORD);
                if (w && bot.tickCount - lastOp > 6) { bot.opNpc(w.idx, 2); bot.queueFlush(); lastOp = bot.tickCount; }
                else if (!w && cheb(bot.tile(), WARLORD_AT) > 4) await walk(WARLORD_AT, 'warlord-find', 4);
                await bot.tick(1);
            }
        } finally { stopEat(); bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        if (!bot.count(ORBS)) fail('warlord');
        await drive(bot, () => !inDialog(bot), [/.*/], 8);
        at('warlord');
    }
    }
    // 7. orbs to Bolren: quest complete
    await toVillage();
    await talkTo(BOLREN, BOLREN_AT, [], () => qp(bot) > qp0, 'bolren-done');
    await drive(bot, () => !inDialog(bot), [/.*/], 30);
    m.ticks = bot.tickCount - t0; m.ok = qp(bot) > qp0;
    if (o.verbose) log(bot, t0, `done ${JSON.stringify(m)}`);
    return m;
}

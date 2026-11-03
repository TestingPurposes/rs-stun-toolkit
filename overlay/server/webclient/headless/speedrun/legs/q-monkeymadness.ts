// q-monkeymadness.ts — Monkey Madness (quest_mm): Daero's training reward = stat_advance 350000/200000 tenths in
// att/def/str/hp (x25: several million xp in each). rev 289 content, cheat-free (live: run-monkey-madness.ts --live). Walkthrough + every id:
// plan/quests/MONKEY-MADNESS.md (S1..S48). Tested chapter by chapter in the offline sim (plan/SIM.md).
//
// PRECONDITIONS: The Grand Tree + Tree Gnome Village complete; leg starts where the Grand Tree leg ends (Narnode,
//   under the Grand Tree). Supplies (MM_SUPPLY): gold bar, ball of wool, 5 bananas, Karamja monkey bones, sharks,
//   prayer potions, Fire Wave runes for the Jungle Demon.
//   Stats + the full supply lists + live requirements: run-monkey-madness.ts header (the standalone launcher). Live-relevant
//   facts found in the clean sim runs: Defence ~70 (at 1 the sharks run out), 12 sharks + 4 prayer potions, never teleport
//   while the backpack monkey is held (post_tele_checks deletes it: this leg walks zoo -> Grand Tree).
// Quest varps are not transmitted: each step checks its own evidence (items, position, dialog, xp).
import { startEatWatch } from './k-mcannon-quest.js';
import { SpeedBot, objId, objDebugName, cheb, spellCom } from '../core.js';
import { ClientProt } from '#/io/ClientProt.js';
import { nav, npc, npcsOf, drive, inDialog, levelUpOpen, log, trace, locAt, opLocGo, dismiss, talk, msgsSince, walkOp, withNpcBlocks, opNpcGo, tele, textMark, sawText, type Tile } from './q-lib.js';
import { solvePuzzle } from './mm-puzzle.js';
import { wield, unwieldAll, enterGnomeStronghold } from './run-lib.js';
import { isTileWalkable } from '../../../../../sdk/pathfinding';
import { readJournal, failHook } from './qp/journal.js';

export const MM_SUPPLY = [
    { name: 'gold_bar', n: 1 }, { name: 'ball_of_wool', n: 1 }, { name: 'banana', n: 5 }, { name: 'mm_normal_monkey_bones', n: 1 },
];
/** Handed over at the Grand Tree on the way back from the zoo (chapter 3): Fire Wave x160 for the Jungle Demon (staff =
 *  fire runes + accuracy), the Varrock teleport out of the atoll, food for the fight. */
export const MM_DEMON_SUPPLY = [
    { name: 'staff_of_fire', n: 1 }, { name: 'bloodrune', n: 160 }, { name: 'airrune', n: 800 }, { name: 'lawrune', n: 1 }, { name: 'shark', n: 8 },
];
const NARNODE = 670, PILOT = 170, CARANOCK = 1427, DAERO = 1407, WAYDAR = 1408, LUMDO = 1419;
const DEMON = 1472, GARKOR_FB = 1412, ZOOKNOCK_FB = 1426, GARKOR = 1411, ZOOKNOCK = 1425, ELDER = 1462, KRUK = 1441, MINDER = 1469, ZOOMONKEY = 1463, JAILGUARDS = [1431, 1432], CHILD = 1452, AUNT = 1454, DUGOPUL = 1429;
const o2 = (n: string) => objId(n);
const POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'].map(n => objId(n));
const SHARK = objId('shark');
const MELEE_AGGRO = [1447, 1459, 1460, 1465, 1466, 1467, 1471, 1473, 1477, 1478, 1479];
const NARNODE_AT = { x: 2466, z: 3496 }, PILOT_AT = { x: 2465, z: 3501 }, GANDIUS_PILOT = { x: 2970, z: 2973 };
const GATE_W = { x: 2944, z: 3041 }, CARANOCK_AT = { x: 2956, z: 3025 }, DAERO_BAR = { x: 2484, z: 3486 };
const HANGAR1 = { x: 2393, z: 9892 }, PANEL = { x: 2394, z: 9883 }, HANGAR2 = { x: 2649, z: 4507 }, CRASH = { x: 2893, z: 2725 }, ATOLL = { x: 2801, z: 2707 };
const PUZZLE_COM = 11130, PUZZLE_IF = 11126;
const RAVINE_STAND = { x: 2720, z: 2752 }, JAIL_DOOR = { x: 2771, z: 2795 }, JAIL_SAFE_GUARD = { x: 2772, z: 2801 };
const JAIL_PATH: Tile[] = [{ x: 2771, z: 2796 }, { x: 2770, z: 2797 }, { x: 2769, z: 2798 }, { x: 2767, z: 2798 }, { x: 2765, z: 2799 }, { x: 2763, z: 2799 }];
const inJail = (t: Tile) => t.x >= 2770 && t.x <= 2776 && t.z >= 2793 && t.z <= 2795;
const GARKOR_STAND = { x: 2806, z: 2762 };
const WH_DOOR = { x: 2764, z: 2764 }, WH_PATH: Tile[] = [{ x: 2764, z: 2765 }, { x: 2767, z: 2765 }, { x: 2767, z: 2766 }, { x: 2768, z: 2767 }, { x: 2768, z: 2769 }];
const BRIDGE_N = { x: 2803, z: 2735 }, BEACH = { x: 2803, z: 2724 }, CAVE_LADDER = { x: 2763, z: 2703 }, CAVE_IN = { x: 2763, z: 9103 }, ZOOKNOCK_AT = { x: 2804, z: 9144 };
const onBeach = (t: Tile) => t.z <= 2726 && t.z > 2688 && t.x >= 2690 && t.x <= 2815;

const MM_SAFETY_GEN = new WeakMap<SpeedBot, number>();
export async function monkeyMadnessLeg(bot: SpeedBot, o: { verbose?: boolean; startAt?: string; stopAt?: string } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    if (o.verbose) trace(bot, t0);
    // failHook: resume proofs (SR_FAIL_AT=<step label> throws once right after that label is logged)
    const at = (s: string) => { m[s] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${s} pos=${JSON.stringify(bot.tile())} L${bot.minusedlevel} hp=${bot.stat('hitpoints').cur}`); try { failHook(s); } catch (e) { cleanup(); throw e; } };
    let cleanup = () => { };
    const fail = (s: string): never => { cleanup(); throw new Error(`mm: ${s} at ${JSON.stringify(bot.pos())}`); };
    const walk = async (to: Tile, label: string, near = 1, level = 0) => {
        const r = await bot.walkTo(to.x, to.z, { near, maxTicks: 900, level, log: !!process.env.MM_LOG });
        if (cheb(bot.tile(), to) > near + 2 || bot.minusedlevel !== level) fail(`walk ${label} ${JSON.stringify(r)}`);
    };
    const nearNpcs = () => Array.from(bot.npcIndices.slice(0, bot.npcCount), i => bot.npcs[i]).filter(Boolean).map(n => n!.typeId).slice(0, 12).join(',');
    /** The backpack monkey (zoo -> Awowogei) chatters on a timer (mm_zoo_monkey.rs2 monkey_backpack_timer): its chatnpc page
     *  ("The monkey in your backpack...") pops up mid-approach, talk() takes it for the npc's first page and never re-ops the
     *  npc (sim: Waydar at the hangar, 60 t). Title component = chat modal + 2 (4882/4884, 4887/4889, 4893/4895). */
    const monkeyChat = () => bot.chatModalId !== -1 && bot.ifText.get(bot.chatModalId + 2) === 'The monkey in your backpack...';
    const clearMonkeyChat = async () => { for (let k = 0; k < 12 && monkeyChat(); k++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); } };
    /** talk() that, when the monkey interrupts, continues the chatter and talks again (within maxTicks). */
    const talkPastMonkey = async (type: number, opts: (mt: number) => Parameters<typeof talk>[3], maxTicks: number, reset: () => void) => {
        const end = bot.tickCount + maxTicks;
        let r = { ok: false, ticks: 0, firstPage: -1 };
        for (let k = 0; k < 6 && bot.tickCount < end; k++) {
            await clearMonkeyChat();
            r = await talk(bot, type, [], opts(Math.max(6, end - bot.tickCount)));
            if (!monkeyChat()) break;
            // route runner (fix 68, qri2m 'waydar-crash-2'): the monkey's chatter can come AFTER the step already happened (the
            // glider landed on Crash Island): clear it and re-check the step's own goal before talking again
            await clearMonkeyChat();
            if ((opts(0) as { done?: () => boolean }).done?.()) { r = { ...r, ok: true }; break; }
            if (o.verbose) log(bot, t0, `${(opts(0) as { label?: string }).label}: the backpack monkey interrupted, talking again`);
            r = { ...r, ok: false }; reset();
        }
        return r;
    };
    const talkTo = async (type: number, stand: Tile | null, level: number, answers: RegExp[], done: () => boolean, label: string, maxTicks = 120) => {
        if (stand && (npc(bot, type) === null || cheb(bot.tile(), stand) > 6 || bot.minusedlevel !== level)) await walk(stand, label, 2, level);
        let opened = false;
        const opts = (mt: number) => ({ done: () => { if (monkeyChat()) return true; if (inDialog(bot)) opened = true; return opened && done(); }, answers, maxTicks: mt, label });
        let r = await talkPastMonkey(type, opts, Math.ceil(maxTicks / 2), () => { opened = false; });
        if (!r.ok && !opened) {
            // the npc never answered (sim, long sessions: Zooknock, Waydar at the hangar, Garkor; 60-300 t of ignored OPNPCs,
            // npc visible 1-4 tiles away): close whatever the client holds, walk onto a free tile next to the npc, re-talk
            const n = npc(bot, type);
            if (o.verbose) log(bot, t0, `${label}: no answer in ${Math.ceil(maxTicks / 2)} t (npc ${n ? `${n.x},${n.z} d${n.d}` : '-'}, me ${JSON.stringify(bot.tile())}): re-approaching`);
            bot.closeModal(); bot.queueFlush(); await bot.tick(1);
            if (n) {
                const me = bot.tile();
                const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: n.x + dx!, z: n.z + dz! }))
                    .filter(t => { try { return isTileWalkable(bot.minusedlevel, t.x, t.z); } catch { return false; } })
                    .sort((a, b) => cheb(a, me) - cheb(b, me))[0];
                if (nb && cheb(nb, me) > 0) await bot.walkTo(nb.x, nb.z, { near: 0, maxTicks: 30, level: bot.minusedlevel });
            }
            r = await talkPastMonkey(type, opts, Math.floor(maxTicks / 2), () => { opened = false; });
        }
        if (!r.ok && o.verbose) log(bot, t0, `${label}: modal ${bot.chatModalId}/${bot.mainModalId} opts [${bot.dialogOptions().map(x => x.text).join(' | ')}] text ${[...bot.ifText.values()].slice(-4).join(' / ').slice(0, 300)}`);
        if (!r.ok) fail(`${label} dialog (npc ${type} ${npc(bot, type) ? 'visible' : 'NOT visible'}; near: ${nearNpcs()})`);
        dismiss(bot); at(label);
    };
    /** done() helper: the chat has been closed for `n` consecutive checks (objbox/p_delay gaps reopen it). */
    const quiet = (n = 3) => { let q = 0, seen = false; return () => { if (inDialog(bot)) { seen = true; q = 0; } else q++; return seen && q >= n; }; };
    /** Close main modals (chapter screens) that a quest step opens. */
    const closeMain = async () => { for (let k = 0; k < 4 && bot.mainModalId !== -1; k++) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); } };
    // ---- the Grand Tree trunk (see q-grandtree.ts): doors 1967 from (2465,3491); ladders at (2466,3495)
    const TRUNK_LADDER = { x: 2466, z: 3495 };
    const inTrunk = () => { const t = bot.tile(); return t.x >= 2460 && t.x <= 2470 && t.z >= 3493 && t.z <= 3500 && (bot.minusedlevel > 0 || (t.x >= 2463 && t.x <= 2468 && t.z <= 3498)); };
    const ladder = async (id: number, p: Tile, level: number, op: number, toLevel: number, label: string) => {
        for (let k = 0; k < 4 && bot.minusedlevel !== toLevel; k++) { opLocGo(bot, locAt(id, p.x, p.z, level), op); bot.queueFlush(); await bot.until(() => bot.minusedlevel === toLevel, 12); dismiss(bot); }
        if (bot.minusedlevel !== toLevel) fail(`ladder ${label} L${level}->L${toLevel}`);
    };
    const trunkDoor = async (enter: boolean) => {
        const stand = enter ? { x: 2465, z: 3491 } : { x: 2465, z: 3493 };
        if (cheb(bot.tile(), stand) > 0) await walk(stand, enter ? 'trunk-door-out' : 'trunk-door-in', 0);
        for (let k = 0; k < 3 && inTrunk() !== enter; k++) { opLocGo(bot, locAt(1967, 2464, 3492), 1, stand); bot.queueFlush(); await bot.until(() => inTrunk() === enter, 8); }
        if (inTrunk() !== enter) fail(`tree door ${enter ? 'in' : 'out'}`);
    };
    const trunkTo = async (level: number) => {
        if (bot.tile().z > 6400) {   // under the tree: ladder_from_cellar (2463,9897) -> trunk L0
            for (let k = 0; k < 3 && bot.tile().z > 6400; k++) { opLocGo(bot, locAt(1755, 2463, 9897), 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 6400, 15); dismiss(bot); }
            if (bot.tile().z > 6400) fail('cellar ladder');
        }
        if (bot.minusedlevel === 0 && !inTrunk()) await trunkDoor(true);
        const ids: Record<number, number> = { 0: 1747, 1: 1748, 2: 2884, 3: 1746 };
        while (bot.minusedlevel !== level) {
            const cur = bot.minusedlevel, up = level > cur;
            if (cheb(bot.tile(), TRUNK_LADDER) > 1) await walk({ x: 2466, z: 3494 }, `trunk-ladder-L${cur}`, 1, cur);
            await ladder(ids[cur]!, TRUNK_LADDER, cur, cur === 0 || cur === 3 ? 1 : up ? 2 : 3, up ? cur + 1 : cur - 1, 'trunk');
        }
    };
    /** Gnome glider: pilot dialog "Can you take me on the glider?" -> glidermap button. */
    const glider = async (pilotAt: Tile, level: number, button: number, dest: (t: Tile) => boolean, label: string) => {
        if (npc(bot, PILOT) === null || cheb(bot.tile(), pilotAt) > 6) { await bot.walkTo(pilotAt.x, pilotAt.z, { near: 2, maxTicks: 300, level }); if (npc(bot, PILOT) === null) fail(`no pilot near ${label}`); }
        for (let k = 0; k < 3 && !dest(bot.tile()); k++) {
            await talk(bot, PILOT, [], { done: () => bot.mainModalId !== -1 || dest(bot.tile()), answers: [/^Can you take me on the glider\?$/], maxTicks: 40, label });
            if (bot.mainModalId !== -1) { bot.ifButton(button); bot.queueFlush(); }
            await bot.until(() => dest(bot.tile()), 12);
        }
        if (!dest(bot.tile())) fail(`glider ${label}`);
        await closeMain(); at(label);
    };
    const stage = o.startAt ?? 'start';
    const order = ['start', 'karamja', 'orders', 'daero', 'puzzle', 'crash', 'atoll', 'jail1', 'garkor', 'warehouse', 'cellar', 'tobeach', 'zooknock1', 'out1', 'jail2', 'temple', 'child', 'zooknock2', 'ch3', 'kruk', 'tozoo', 'zoo', 'fromzoo', 'hangar2', 'throne2', 'demon', 'offatoll', 'reward'];
    const stop = o.stopAt ? order.indexOf(o.stopAt) : order.length;
    const from = (s: string) => order.indexOf(stage) <= order.indexOf(s) && order.indexOf(s) < stop;

    // ================================================================ Chapter 1
    if (from('start')) {
        // S1 Narnode (under the tree right after the Grand Tree leg, or in the trunk): "Start Monkey Madness?" Yes -> seal
        const stand = bot.tile().z > 6400 ? null : NARNODE_AT;
        if (stand) await trunkTo(0);
        await talkTo(NARNODE, stand, 0, [/^Yes$/], () => bot.count(o2('mm_gnome_royal_seal')) > 0 && !inDialog(bot), 'narnode-start', 160);
        await closeMain();
        await trunkTo(0);   // up into the trunk: the quest supplies are handed over here (runner leg mm1)
    }
    if (from('karamja')) {
        // S2 glider to Gandius, S4 shipyard gate (seal -> mm_main 2, moved inside), S6 Caranock, S7 glider back
        // route runner (fix 87): re-entrant by position: already on Karamja (a stage resume) -> no Grand Tree / glider out
        const onKaramja = () => bot.tile().x > 2880 && bot.tile().z < 3200 && bot.tile().z > 2900;
        if (!onKaramja()) {
            await trunkTo(3);
            await glider(PILOT_AT, 3, 824, t => t.x > 2900 && t.z < 3000, 'glider-gandius');
        }
        // route runner (fix 132, qrq4m/qrq6m/qrq7m: 'walk caranock' 900 t wedged on the gate tile 2944,3041 every run; the stage
        // resume then passed): the glider lands at (2970,2969), x >= 2945 but OUTSIDE the yard, so the x test skipped the gate.
        // Inside = the yard box the exit below uses.
        const inYard = () => bot.tile().x >= 2945 && bot.tile().z > 3000 && bot.tile().z < 3070;
        if (!inYard()) await walk(GATE_W, 'shipyard-gate', 0);
        for (let k = 0; k < 6 && !inYard(); k++) {
            if (cheb(bot.tile(), GATE_W) > 2) await walk(GATE_W, 'shipyard-gate', 0);
            opLocGo(bot, locAt(2438, 2945, 3041), 1); bot.queueFlush();
            await drive(bot, () => inYard() && !inDialog(bot), [], 40);
            await bot.tick(2);
        }
        if (!inYard()) fail('shipyard gate');
        at('shipyard');
        await talkTo(CARANOCK, CARANOCK_AT, 0, [], () => !inDialog(bot), 'caranock', 160);
        // route runner (fix 87, qrj3m 'no pilot near glider-back' at the gate tile 2945,3041): out through the shipyard gate
        // explicitly (the walker wedged on it; qri1m was rescued by the LeanBot traveller once)
        if (bot.tile().x >= 2945 && bot.tile().z > 3000 && bot.tile().z < 3070) {
            if (cheb(bot.tile(), { x: 2945, z: 3041 }) > 1) await bot.walkTo(2946, 3041, { near: 1, maxTicks: 60, log: false });
            for (let k = 0; k < 4 && bot.tile().x >= 2945; k++) {
                opLocGo(bot, locAt(2438, 2945, 3041), 1); bot.queueFlush();
                await drive(bot, () => bot.tile().x < 2945 && !inDialog(bot), [/.*/], 30);
            }
        }
        await glider(GANDIUS_PILOT, 0, 825, t => t.x < 2500 && bot.minusedlevel === 3, 'glider-back');
    }
    if (from('orders')) {
        // S7 Narnode -> orders (p_delay 3 while he writes: do not interrupt)
        await trunkTo(0);
        // 319b (qx78m: a server drop mid Daero's dialog AFTER he took the orders; every resume at 'orders' waited for a new
        // scroll Narnode never writes: with %mm_daero >= daero_given_orders he only asks "How goes the mission?"
        // (mm_narnode.rs2:33-50), 6 x 'narnode-orders dialog', STOPPED): that line = the orders stage is done, go to Daero.
        // MM_ORDERS_DONE=0 reverts.
        const mk = textMark(bot);
        const ordersGiven = () => process.env.MM_ORDERS_DONE !== '0' && sawText(bot, /How goes the mission\?/i, mk);
        await talkTo(NARNODE, NARNODE_AT, 0, [], () => (bot.count(o2('mm_narnode_orders')) > 0 || ordersGiven()) && !inDialog(bot), 'narnode-orders', 160);
        if (ordersGiven()) log(bot, t0, 'narnode-orders: Daero has the orders already (resume): on to Daero');
    }
    const inHangar1 = () => cheb(bot.tile(), HANGAR1) <= 12 && bot.tile().z > 6400;
    // session 8 (allchaos qt32m: the Regicide messenger's summons arrived in the hangar mid-scene and its page watcher closed
    // Daero's dialog, so 'daero-hangar' ended without the reinit stage; the panel never opened and every resume at 'daero'
    // tried the trunk's cellar ladder from the hangar: 7 x 'cellar ladder'). A resume that is already in the hangar skips the
    // bar and talks to Daero there; the panel re-talks Daero once when it does not open. MM_HANGAR_RESUME=0 reverts.
    const hangarResume = process.env.MM_HANGAR_RESUME !== '0';
    // session 11 fix 368 MM_DAERO_MENU (qx196m: the Regicide messenger came right after 'daero-hangar' and the panel's
    // 15 t ran out, 'puzzle did not open'; the re-talk ('daero-hangar (again)', then 6 x 'daero-hangar (resume)') met
    // Daero's started_reinit menu (mm_daero.rs2:50-51 p_choice4) with no answer: 7 x ~100 t, STOPPED at qp 68). That
    // menu = the hangar scene is done: "How do I leave?" closes it in 2 pages, then the puzzle. MM_DAERO_MENU=0 reverts.
    const daeroMenu = process.env.MM_DAERO_MENU !== '0' ? [/^How do I leave\?$/] : [];
    // session 9 (allchaos qu18m: 'daero-reinit dialog (npc 1407 NOT visible)' in the reinit room (2645,4533), then every resume
    // at 'daero' walked for the trunk door from there: 'walk trunk-door-out' 900 t x3, STOPPED): in that room the daero stage is
    // done; the puzzle stage (reinit) follows. (inHangar2 is defined below: same box inline.)
    const inReinitRoom = () => { const t = bot.tile(); return bot.minusedlevel === 0 && t.x >= 2620 && t.x <= 2680 && t.z >= 4490 && t.z <= 4560; };
    if (from('daero') && hangarResume && inReinitRoom()) log(bot, t0, `resume in the reinit room at ${JSON.stringify(bot.tile())}: daero stage done`);
    else if (from('daero') && hangarResume && inHangar1()) {
        log(bot, t0, `resume in the hangar at ${JSON.stringify(bot.tile())}: Daero here`);
        await talkTo(DAERO, null, 0, daeroMenu, () => !inDialog(bot), 'daero-hangar (resume)', 200);
    } else if (from('daero')) {
        // S8 Daero (bar, L1): three topics (each "Return to previous menu"), then Leave... / Who is it? -> hangar
        await trunkTo(1);
        const topics = [/^Talk about the journey\.\.\.$/, /^Talk about the 10th squad\.\.\.$/, /^Talk about Caranock\.\.\.$/];
        const used = new Set<number>();
        if (npc(bot, DAERO) === null || cheb(bot.tile(), DAERO_BAR) > 5) await walk(DAERO_BAR, 'daero-bar', 2, 1);
        const n = npc(bot, DAERO); if (!n) fail(`daero not visible (${nearNpcs()})`);
        bot.opNpc(n!.idx, 1); bot.queueFlush();
        const inHangar = () => cheb(bot.tile(), HANGAR1) <= 12 && bot.tile().z > 6400;
        const end = bot.tickCount + 300; let lastSig = '', lastClick = -9, lastDlg = bot.tickCount, daeroTestDone = false;
        while (bot.tickCount < end && !inHangar()) {
            // 319a (qx78m: a server drop (ws 1012) mid Daero's topics closed the dialog; the loop only answered open
            // dialogs and sat 300 t at the bar, 'daero -> hangar'): 8 t with no dialog = talk to Daero again.
            // MM_DAERO_REOP=0 reverts.
            if (inDialog(bot)) lastDlg = bot.tickCount;
            else if (process.env.MM_DAERO_REOP !== '0' && bot.tickCount - lastDlg >= 8) {
                const d = npc(bot, DAERO);
                if (d) { log(bot, t0, `daero: no dialog for ${bot.tickCount - lastDlg} t: talk again (d${d.d})`); bot.opNpc(d.idx, 1); bot.queueFlush(); }
                lastDlg = bot.tickCount; lastSig = '';
            }
            if (inDialog(bot)) {
                const opts = bot.dialogOptions().map(x => x.text);
                const sig = `${bot.chatModalId}:${opts.join('|')}`;
                if (opts.length) {
                    if (sig !== lastSig || bot.tickCount - lastClick > 4) {
                        const has = (re: RegExp) => opts.some(t => re.test(t));
                        let re: RegExp | null = null;
                        if (has(/^Leave\.\.\.$/)) re = /^Leave\.\.\.$/;
                        else if (has(/^Who is it\?$/)) re = /^Who is it\?$/;
                        else if (has(/Return to previous menu/)) re = /Return to previous menu/;
                        else for (let i = 0; i < topics.length && !re; i++) if (!used.has(i) && has(topics[i]!)) { re = topics[i]!; used.add(i); }
                        // 319 test marks: MM_DAERO_TEST=1 closes the dialog after the first topic once (= a drop, 319a);
                        // SR_FAIL_AT=mm-daero-topic throws there (a retry after Daero took the orders, 319b)
                        if (used.size === 1 && re) { if (process.env.MM_DAERO_TEST === '1' && !daeroTestDone) { daeroTestDone = true; used.clear(); bot.closeModal(); bot.queueFlush(); await bot.tick(1); continue; } failHook('mm-daero-topic'); }
                        if (re && bot.clickDialogByText(re) > 0) { bot.queueFlush(); lastSig = sig; lastClick = bot.tickCount; }
                    }
                } else { bot.resumeDialogPage(); bot.queueFlush(); }
            }
            await bot.tick(1);
        }
        if (!inHangar()) fail('daero -> hangar');
        await drive(bot, () => !inDialog(bot), [/.*/], 10);
        at('hangar');
        // S9 Daero in the hangar (Waydar within 14): long scene -> started_reinit
        await talkTo(DAERO, null, 0, daeroMenu, () => !inDialog(bot), 'daero-hangar', 200);
    }
    // route session 5 (allchaos qsdm: the cutscene landed at (2645,4533), 26 from HANGAR2, so 'hangar cutscene' threw and every
    // resume at 'puzzle' tried to walk from the post-reinit hangar to the panel: 4 x 900 t): the post-reinit hangar is the
    // whole x 2620-2680 / z 4490-4560 box, and a resume that is already there skips the puzzle
    const inHangar2 = () => { const t = bot.tile(); return bot.minusedlevel === 0 && t.x >= 2620 && t.x <= 2680 && t.z >= 4490 && t.z <= 4560; };
    if (from('puzzle') && inHangar2()) at('reinit');
    else if (from('puzzle')) {
        // S10 reinitialisation panel: read the board (inv on component 11130), solve, send every click at once (the
        // server runs <= 5 OPHELD per tick and keeps the rest queued; no delay per move). Then stay in the zone ~17 t.
        if (cheb(bot.tile(), PANEL) > 3) await walk({ x: 2394, z: 9884 }, 'panel', 1);
        let solved = false;
        for (let attempt = 0; attempt < 3 && !solved; attempt++) {
            opLocGo(bot, locAt(4871, PANEL.x, PANEL.z), 1); bot.queueFlush();
            if (!(await bot.until(() => bot.mainModalId === PUZZLE_IF && !!(bot as any).invs.get(PUZZLE_COM), 15))) {
                if (o.verbose) log(bot, t0, `puzzle did not open (modal ${bot.mainModalId})`);
                if (hangarResume && attempt === 0 && inHangar1()) { dismiss(bot); await talkTo(DAERO, null, 0, daeroMenu, () => !inDialog(bot), 'daero-hangar (again)', 200); }
                continue;
            }
            await bot.tick(1);
            const inv = (bot as any).invs.get(PUZZLE_COM) as { ids: Int32Array | number[]; counts: Int32Array | number[] };
            const board = Array.from({ length: 25 }, (_, s) => { const id = inv.ids[s] ?? 0; return id > 0 && (inv.counts[s] ?? 0) > 0 ? ((id - 3904) >> 1) + 1 : 0; });
            const sol = solvePuzzle(board);
            if (!sol) fail(`no puzzle solution for ${board.join(',')}`);
            if (o.verbose) log(bot, t0, `puzzle ${board.join(',')} -> ${sol!.length} moves`);
            const out = (bot as any).out;
            const cur = board.slice();
            for (const s of sol!) {
                const tile = cur[s]!; const obj = 3904 + 2 * (tile - 1);
                out.p1Enc(ClientProt.OPHELD5); out.p2(obj); out.p2(s); out.p2(PUZZLE_COM);
                const hole = cur.indexOf(0); cur[hole] = tile; cur[s] = 0;
            }
            bot.queueFlush();
            solved = await bot.until(() => bot.mainModalId !== PUZZLE_IF, Math.ceil(sol!.length / 5) + 10);
        }
        if (!solved) fail('puzzle');
        at('puzzle');
        // hangar cutscene: settimer 3, fade, p_delay 4 + 3 + 7, teleport to the post-reinit hangar
        if (!(await bot.until(() => cheb(bot.tile(), HANGAR2) <= 10 || inHangar2(), 40))) fail('hangar cutscene');
        at('reinit');
    }
    if (from('crash')) {
        // route runner (fixes 53/56/58): the stage is re-entrant by position. Already at the atoll (a resume after the
        // cutscene): nothing to do. On Crash Island: skip the hangar talks (Daero is not there).
        const atAtoll = () => cheb(bot.tile(), ATOLL) <= 6;
        const onCrash = () => cheb(bot.tile(), CRASH) <= 20;
        if (!atAtoll()) {
        // S11 Daero (Waydar within 14), S12 Waydar "Yes" -> glider (do not close) -> Crash Island
        if (!onCrash()) {
            // session 9 (qu18m 'daero-reinit dialog (npc 1407 NOT visible)' at 2645,4533): not in view = walk to the hangar spot first
            await talkTo(DAERO, process.env.MM_HANGAR_RESUME !== '0' && !npc(bot, DAERO) ? HANGAR2 : null, 0, [], () => !inDialog(bot), 'daero-reinit', 160);
            await talkTo(WAYDAR, null, 0, [/^Yes$/], () => cheb(bot.tile(), CRASH) <= 8, 'waydar-fly', 120);
        }
        await closeMain();
        // S13 Waydar, S14 Lumdo, S15 Waydar "I cannot convince Lumdo..." (Lumdo within 10) -> chapter 2 cutscene -> atoll
        const quietW = quiet();
        const convince = /^I cannot convince Lumdo to take us to the island\.\.\.$/;
        // a resumed stage whose Lumdo refusal already happened gets Waydar's 4-option menu here: take the cutscene
        await talkTo(WAYDAR, null, 0, [convince], () => quietW() || atAtoll() || !onCrash(), 'waydar-island', 60);
        // the cutscene moves us off the island (2596,4581) before the atoll: wait for the landing (qri1m talked to Lumdo
        // inside the cutscene and failed 'ch2-cutscene-0')
        if (!onCrash()) await bot.until(atAtoll, 80);
        for (let k = 0; k < 3 && !atAtoll(); k++) {
            await talkTo(LUMDO, null, 0, [], quiet(4), `lumdo-${k}`, 120);
            if (!onCrash()) { await bot.until(atAtoll, 80); break; }
            // Waydar's 4th option only exists once Lumdo said he will not take us; anything else: back to Lumdo
            let missing = false;
            await talkTo(WAYDAR, null, 0, [convince], () => {
                const opts = bot.dialogOptions(); if (opts.length && !opts.some(x => convince.test(x.text))) { missing = true; return true; }
                return (atAtoll() && !inDialog(bot)) || !onCrash();
            }, `ch2-cutscene-${k}`, 300);
            if (!onCrash()) await bot.until(atAtoll, 80);
            if (missing) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        }
        }
        if (!atAtoll()) fail('chapter 2 cutscene');
        await closeMain();
        at('atoll');
    }
    // ---- safety loop for the atoll (chapters 2-4): eat, protection prayer by area, prayer potions. `want` picks the prayer.
    let want: string | null = null, safetyOn = false;
    let demonAdjacent = false, demonEat297 = false;   // fix 297c (set by the demon fight loop)
    // session 11: one safety loop per bot. A throw that bypassed fail() (cleanup) left the previous attempt's loop running
    // next to the retry's, and the two toggled the protection prayers against each other (sim qwc01/qwc02 died to the Jungle
    // Demon after a resume). A newer attempt's generation stops the older loop. MM_SAFETY_GEN=0 reverts.
    const safetyGen = (MM_SAFETY_GEN.get(bot) ?? 0) + 1; MM_SAFETY_GEN.set(bot, safetyGen);
    const stale = () => process.env.MM_SAFETY_GEN !== '0' && MM_SAFETY_GEN.get(bot) !== safetyGen;
    const onAtollSurface = () => { const t = bot.tile(); return t.x >= 2688 && t.x <= 2815 && t.z >= 2688 && t.z <= 2815; };
    const startSafety = () => {
        if (safetyOn) return; safetyOn = true;
        let lastEat = -9, lastPot = -9, lastMsgTick = bot.tickCount, poisoned = false;
        (async () => {
            while (safetyOn && !bot.disposed && !stale()) {
                // a level-up page (none of the quest's conversations) blocks eating, potions and the next op: continue it
                if (levelUpOpen(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
                const hpNow = bot.stat('hitpoints').cur, hpMax = bot.stat('hitpoints').level;
                const critical = hpNow <= Math.max(14, Math.floor(hpMax * 0.25));
                // session 11 fix 291b MM_DEMON_EAT (qx42m: hp 45/77 and prayer 25 when a 39 t engine-restart drop left us standing
                // next to the demon, unable to kite or eat -> dead): in the demon fight (want = Protect from Magic) eat at 70% and
                // drink a prayer potion under 30, a buffer for an outage. 16 sharks + 4 potions come in the kit. =0 reverts.
                const demonFight = want === 'protectfrommagic' && process.env.MM_DEMON_EAT !== '0';
                // 297c: in the demon's melee range (fix 297 above) eat at 85%: one melee hit is ~30
                if (hpNow <= Math.max(20, Math.floor(hpMax * (demonFight ? (demonEat297 && demonAdjacent ? 0.85 : 0.7) : 0.5))) && (critical || !inDialog(bot)) && bot.count(SHARK) > 0 && bot.tickCount - lastEat >= 3) { bot.opHeld1(SHARK, bot.slot(SHARK)); bot.queueFlush(); lastEat = bot.tickCount; }
                const t = bot.tile(), inTemple = t.x >= 2786 && t.x <= 2812 && t.z >= 2774 && t.z <= 2793 && t.z < 6400;
                // melee aggressors (Padulah, gorillas, zombies, skeletons, spiders/scorpions/snakes) close by: melee; else the archers
                const archersNear = npcsOf(bot, [1456, 1457, 1458]).some(n => n.d <= 9);   // their volleys (~27) outdamage any melee mob
                // ...except a melee mob right next to us: Padulah (1447) by the monkey child's garden hits through Protect from
                // Missiles for the whole 100 t banana wait (sim: 5 sharks gone there, then death on the way to Zooknock)
                const meleeAdj = npcsOf(bot, MELEE_AGGRO).some(n => n.d <= 2);   // 2: size-2 gorillas are read by their SW tile
                const meleeNear = meleeAdj || (!archersNear && npcsOf(bot, MELEE_AGGRO).some(n => n.d <= 3));
                const p = want ?? (onAtollSurface() && !greegreeOn() ? (inTemple || meleeNear ? 'protectfrommelee' : 'protectfrommissiles') : null);
                if (msgsSince(bot, lastMsgTick).some(m => /You have been poisoned|poison/.test(m) && !/immune|cure/i.test(m))) poisoned = true;
                lastMsgTick = bot.tickCount;
                if (inDialog(bot) && !critical) { await bot.tick(1); continue; }   // prayer clicks and potions close quest dialogs
                if (poisoned) {
                    const ap = bot.inv().find(x => /^[1234]doseantipoison$/.test(objDebugName(x.obj)));
                    if (ap && bot.tickCount - lastPot >= 2) { bot.opHeld1(ap.obj, ap.slot); bot.queueFlush(); lastPot = bot.tickCount; poisoned = false; }
                }
                // Protect prayers are exclusive: lighting one puts the other out server-side. So switch by lighting the wanted
                // one ONLY. (Before: the old one was also clicked off in the same tick; its varp still read 1, so that click
                // re-lit it and put the new one out again -> melee->missiles never switched and the ravine archers hit
                // through a melee prayer: 72 -> 15 hp and ~8 sharks gone on the walk to the jail.)
                if (p) { if (!bot.isPrayerActive(p) && bot.stat('prayer').cur > 0) { bot.activatePrayer(p); bot.queueFlush(); } }
                else for (const n of ['protectfrommissiles', 'protectfrommelee', 'protectfrommagic']) if (bot.isPrayerActive(n)) { bot.deactivatePrayer(n); bot.queueFlush(); }
                if (o.verbose && bot.tickCount % 10 === 0) log(bot, t0, `safety: hp ${hpNow}/${hpMax} pray ${bot.stat('prayer').cur} ${p ?? '-'} pos ${t.x},${t.z} sharks ${bot.count(SHARK)} npcs ${npcsOf(bot, Array.from({ length: 1500 }, (_, i) => 1400 + i)).filter(n => n.d <= 4).map(n => `${n.type}`).join(',')}`);
                if (p && bot.stat('prayer').cur < (demonFight ? 30 : 15) && bot.tickCount - lastPot >= 3) {
                    const pot = bot.inv().find(x => POTS.includes(x.obj));
                    if (pot) { bot.opHeld1(pot.obj, pot.slot); bot.queueFlush(); lastPot = bot.tickCount; }
                }
                await bot.tick(1);
            }
        })();
    };
    const stopSafety = () => { safetyOn = false; for (const n of ['protectfrommissiles', 'protectfrommelee', 'protectfrommagic']) if (bot.isPrayerActive(n)) bot.deactivatePrayer(n); bot.queueFlush(); };
    const greegreeOn = () => bot.isWorn(o2('mm_monkey_greegree_for_normal_monkey'));
    // + auto-retaliate back on (the temple step turns it off, see leaveTemple) if a step fails while it is off
    cleanup = () => { stopSafety(); if (bot.getVarp(172) === 1) { bot.ifButton(150); bot.queueFlush(); } };
    // ================================================================ Chapter 2 (human on Ape Atoll)
    /** Ravine archers (reachable from the beach): 1 in 20 arrows knocks you out -> jail. Protect from Missiles = no damage. */
    const getJailed = async (label: string) => {
        if (inJail(bot.tile())) return;
        startSafety();
        const end = bot.tickCount + 900;
        while (!inJail(bot.tile()) && bot.tickCount < end) {
            if (cheb(bot.tile(), RAVINE_STAND) > 3 && bot.tile().z < 6400) await bot.walkTo(RAVINE_STAND.x, RAVINE_STAND.z, { near: 2, maxTicks: 120, level: 0 });
            await bot.tick(1);
        }
        if (!inJail(bot.tile())) fail(`${label}: no knockout`);
        at(label);
    };
    /**
     * Jail escape. The guards (size-2 gorillas, punch an adjacent human every 2 ticks) patrol the only corridor:
     * west (2768,2798)/(2770,2798) -> north (2772,2801) p6 -> south door (2772,2796)/(2771,2796) p6 x3 -> north p6 ->
     * south x3 -> north p6 -> west -> hand-over at (2767,2802). Window: pick the lock during the THIRD north pause
     * (37.5% per try at thieving 1), wait at the door until the guard has gone west into the hand-over corner, then
     * run (2772,2797) -> (2772,2801) -> (2771,2800) -> (2770,2799) -> west along z 2799.
     */
    const escapeJail = async (label: string) => {
        const end = bot.tickCount + 1200;
        const EXIT = { x: 2762, z: 2799 };
        const guards = () => npcsOf(bot, JAILGUARDS);
        const isNorth = (g: Tile) => g.x === 2772 && g.z === 2801;
        const isWest = (g: Tile) => g.z <= 2799 && g.x <= 2770;
        const inHandover = (g: Tile) => g.x >= 2763 && g.x <= 2769 && g.z >= 2800;
        let active = -1, norths = 0, wasNorth = false, lastLog = -99, lastX = -1, westward = false;
        const near = (t: Tile, d: number) => guards().some(g => Math.max(Math.abs(g.x - t.x), Math.abs(g.z - t.z), Math.abs(g.x + 1 - t.x), Math.abs(g.z + 1 - t.z)) <= d && cheb(g, t) <= d);
        while (bot.tickCount < end) {
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
            const me = bot.tile(), gs = guards();
            if (me.x <= 2764 && me.z >= 2797 && me.z <= 2800) break;   // out
            // track the active guard (the one that is not in the hand-over corner)
            const act = gs.find(g => !inHandover(g)) ?? null;
            if (act && act.idx !== active) { active = act.idx; norths = 0; wasNorth = false; }
            if (act) {
                if (lastX >= 0 && act.x !== lastX) westward = act.x < lastX;
                lastX = act.x;
                if (isWest(act) && !westward) norths = 0;
                if (isNorth(act) && !wasNorth) norths++;
                wasNorth = isNorth(act);
            }
            if (o.verbose && bot.tickCount - lastLog >= 6) { lastLog = bot.tickCount; log(bot, t0, `jail: me ${me.x},${me.z} guards ${gs.map(g => `${g.type}@${g.x},${g.z}`).join(' ')} active ${act ? `${act.x},${act.z}` : '-'} norths ${norths}`); }
            if (inJail(me)) {
                // window: its third north pause, then its walk west into the hand-over corner (the door tile stays >= 2 from it)
                const window = !act || (isNorth(act) && norths >= 3) || (norths >= 3 && westward && (isWest(act) || act.z >= 2799));
                if (window) { opLocGo(bot, locAt(4799, JAIL_DOOR.x, JAIL_DOOR.z), 1); bot.queueFlush(); await bot.until(() => !inJail(bot.tile()), 3); continue; }
            } else {
                // out of the cell: go once the active guard is in the hand-over corner (or gone), and the next tiles are clear
                const goNow = !act || inHandover(act) || (act.x <= 2768);
                const path = (await nav()).findLongPath(0, me.x, me.z, EXIT.x, EXIT.z, 200);
                const next = path.slice(0, 3);
                if (goNow && next.every(t => !near(t, 1))) { bot.sendRoute(path); bot.queueFlush(); }
            }
            await bot.tick(1);
        }
        const me = bot.tile();
        if (!(me.x <= 2764)) fail(`${label}: jail escape`);
        at(label);
    };
    /** Walk in the village; a knockout (guards, the Aunt, Dugopul) lands us in jail: escape and walk again. */
    const villageWalk = async (to: Tile, label: string, near = 1, via: Tile[] = []) => {
        for (let k = 0; k < 4; k++) {
            if (inJail(bot.tile())) { if (o.verbose) log(bot, t0, `${label}: jailed (${msgsSince(bot, bot.tickCount - 40).slice(-4).join(' | ')})`); await escapeJail(`${label}-escape-${k}`); }
            for (const v of (k === 0 ? via : via.slice(-1))) { await bot.walkTo(v.x, v.z, { near: 1, maxTicks: 200, level: 0 }); if (inJail(bot.tile())) break; }   // after a jail escape only the last waypoint applies
            if (inJail(bot.tile())) continue;
            await bot.walkTo(to.x, to.z, { near, maxTicks: 300, level: 0 });
            if (!inJail(bot.tile()) && cheb(bot.tile(), to) <= near + 1) return;
        }
        fail(`village walk ${label}`);
    };
    if (order.indexOf(stage) >= order.indexOf('atoll') || from('atoll')) startSafety();
    if (from('atoll')) {
        await getJailed('jail-1');
    }
    if (from('jail1')) {
        await escapeJail('escape-1');
    }
    if (from('garkor')) {
        // S16 Garkor (nook east of the hall wall). Burst his pages (Dugopul's spotting closes chats: re-talk).
        await villageWalk(GARKOR_STAND, 'garkor-walk', 1);
        // done = his last line was shown (Dugopul's if_close can cut the talk short: then talk again)
        // session 11 fix 401a2 (MM_GARKOR_TOLD; qx405m/qx322m: a resume at 'garkor' after his story was told: at %mm_garkor =
        // speak_zooknock he opens with "Have you spoken to Zooknock about the monkey disguise yet?" (mm_garkor.rs2:77) and never
        // says the last line (:126) again -> 'his story did not finish' x5 = ROUTE STOPPED): that opener = told. =0 reverts.
        const TOLD = process.env.MM_GARKOR_TOLD !== '0' ? /find my squad mage|Have you spoken to Zooknock/ : /find my squad mage/;
        const lastLine = () => [...bot.ifText.values()].some(t => TOLD.test(t));
        for (let k = 0; k < 4 && !lastLine(); k++) {
            if (inJail(bot.tile())) await villageWalk(GARKOR_STAND, `garkor-again-${k}`, 1);
            await talk(bot, GARKOR, [], { done: () => lastLine() && !inDialog(bot), answers: [/.*/], maxTicks: 80, label: 'garkor' });
        }
        if (!lastLine()) fail('garkor: his story did not finish');
        at('garkor');
    }
    /** op a loc and answer its dialog until done(). */
    /** Kill the aggressive mob next to us (spiders/zombies): every hit if_closes the open dialog (npc_combat: playerhit), so a
     *  crate/trapdoor question never gets answered while one is chewing on us (sim: the warehouse hole, 3 tries, a spider). */
    const clearFoes = async (label: string) => {
        if (greegreeOn()) return;
        for (let k = 0; k < 3; k++) {
            const foe = npcsOf(bot, MELEE_AGGRO).find(n => n.d <= 2);
            if (!foe) return;
            if (o.verbose) log(bot, t0, `${label}: fighting off npc ${foe.type} at ${foe.x},${foe.z} first`);
            // session 8 (allchaos fork qt49fm 'mould' x7: a warehouse spider 2 tiles off was 'fought off' 7 times and never died:
            // the raw OPNPC from 2 tiles is discarded): route to it (q-lib opNpcGo). MM_FOE_ROUTE=0 reverts.
            if (process.env.MM_FOE_ROUTE !== '0') opNpcGo(bot, foe, 2); else bot.opNpc(foe.idx, 2); bot.queueFlush();
            await bot.until(() => !npcsOf(bot, MELEE_AGGRO).some(n => n.idx === foe.idx), 25);
        }
    };
    const opLocAnswer = async (id: number, p: Tile, answers: RegExp[], done: () => boolean, label: string, o2_: { level?: number; stand?: Tile; maxTicks?: number } = {}) => {
        for (let k = 0; k < 4 && !done(); k++) {
            // session 11 fix 401a3 (MM_OPLOC_JAIL; qx405m: knocked out at the dentures crate, 4 crate ops from the cell = 'I can't
            // reach that!' for 200 t): jailed = fail now; the stage resume escapes (villageWalk) and comes back. =0 reverts.
            if (process.env.MM_OPLOC_JAIL !== '0' && inJail(bot.tile())) break;
            if (k > 0 || npcsOf(bot, MELEE_AGGRO).some(n => n.d <= 1)) await clearFoes(label);
            opLocGo(bot, locAt(id, p.x, p.z, o2_.level ?? 0), 1, o2_.stand); bot.queueFlush();
            await drive(bot, done, answers, o2_.maxTicks ?? 40);
        }
        if (!done()) fail(`${label} (${msgsSince(bot, bot.tickCount - 60).slice(-5).join(' | ')})`);
        at(label);
    };
    const useOnNpc = async (type: number, item: string, done: () => boolean, label: string) => {
        for (let k = 0; k < 3 && !done(); k++) {
            const n = npc(bot, type); if (!n) fail(`${label}: npc ${type} not visible`);
            if (levelUpOpen(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
            bot.useItemOnNpc(n!.idx, o2(item), bot.slot(item)); bot.queueFlush();
            await drive(bot, done, [/.*/], 30);
        }
        if (!done()) fail(label);
        at(label);
    };
    /** From anywhere on the village side: bridge ladder (north side) -> L2 -> jumping square -> beach. */
    const toBeach = async () => {
        for (let attempt = 0; attempt < 4 && !onBeach(bot.tile()); attempt++) {
            if (inJail(bot.tile())) await escapeJail(`escape-beach-${attempt}`);
            if (bot.minusedlevel === 0) {
                await bot.walkTo(BRIDGE_N.x, BRIDGE_N.z, { near: 1, maxTicks: 200, level: 0 });
                if (inJail(bot.tile())) continue;
                for (let k = 0; k < 3 && bot.minusedlevel === 0 && !inJail(bot.tile()); k++) { opLocGo(bot, locAt(4743, 2803, 2734), 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 2 || inJail(bot.tile()), 8); }
            }
            if (bot.minusedlevel === 2) {
                for (let k = 0; k < 3 && !onBeach(bot.tile()) && !inJail(bot.tile()); k++) {
                    opLocGo(bot, locAt(4745, 2803, 2727, 2), 1); bot.queueFlush();
                    await bot.until(() => (onBeach(bot.tile()) && bot.minusedlevel === 0) || inJail(bot.tile()), 12);
                }
            }
        }
        if (!onBeach(bot.tile())) fail('to beach (bridge / jumping square)');
        at('beach');
    };
    const toZooknock = async () => {
        if (bot.tile().z < 6400) {
            // session 11 fix 392b (qx322m: knocked out between the beach and the cave ladder; 'walk cave-ladder ... at 2770,2793
            // no route' from INSIDE the jail, the resume then went to 'garkor' x5 = ROUTE STOPPED): out of the jail first (toBeach
            // escapes it and crosses again), then walk; re-try once more if knocked out on the way. MM_ZK_JAIL=0 reverts.
            // fix 392b TEST (MM_ZK_JAIL_TEST=1): get jailed once (getJailed) right here, the first time per bot
            if (process.env.MM_ZK_JAIL_TEST === '1' && !(bot as any).__zkJailTest) { (bot as any).__zkJailTest = true; await getJailed('zk-jail-test'); }
            for (let j = 0; process.env.MM_ZK_JAIL !== '0' && j < 3 && (inJail(bot.tile()) || cheb(bot.tile(), { x: 2763, z: 2704 }) > 3); j++) {
                if (inJail(bot.tile())) await toBeach();
                await bot.walkTo(2763, 2704, { near: 1, maxTicks: 900, level: 0 });
            }
            await walk({ x: 2763, z: 2704 }, 'cave-ladder', 1);
            for (let k = 0; k < 3 && bot.tile().z < 6400; k++) { opLocGo(bot, locAt(4780, CAVE_LADDER.x, CAVE_LADDER.z), 1); bot.queueFlush(); await bot.until(() => bot.tile().z > 6400, 8); }
            if (bot.tile().z < 6400) fail('cave ladder');
        }
        want = 'protectfrommelee';   // zombie monkeys / skeletons
        await walk(ZOOKNOCK_AT, 'to-zooknock', 2);
    };
    if (from('warehouse')) {
        // S19 dentures: secure door (south wall), hand-walk east of the sleeping monkey's zone, crate from (2768,2769)
        // around the warehouse (its interior = the sleeping monkey's alarm) and north of the hall (Dugopul watches its south side)
        await villageWalk({ x: 2764, z: 2763 }, 'warehouse-door', 0, bot.tile().x > 2795 ? [{ x: 2806, z: 2772 }, { x: 2790, z: 2765 }, { x: 2776, z: 2770 }] : [{ x: 2776, z: 2770 }]);
        for (let k = 0; k < 3 && bot.tile().z < 2764; k++) { opLocGo(bot, locAt(4710, WH_DOOR.x, WH_DOOR.z), 1); bot.queueFlush(); await bot.until(() => bot.tile().z >= 2764, 6); }
        if (bot.tile().z < 2764) fail('warehouse door');
        for (const t of WH_PATH.slice(1)) { bot.sendRoute([t]); bot.queueFlush(); await bot.until(() => cheb(bot.tile(), t) === 0, 6); }
        // fix 401a TEST (MM_DENT_JAIL_TEST=1): the qx405m case: get jailed once (getJailed) right before the dentures crate
        if (process.env.MM_DENT_JAIL_TEST === '1' && !(bot as any).__dentJailTest) { (bot as any).__dentJailTest = true; await getJailed('dent-jail-test'); }
        await opLocAnswer(4715, { x: 2767, z: 2769 }, [/^Yes$/], () => bot.count(o2('mm_monkey_dentures')) > 0 && !inDialog(bot), 'dentures', { stand: { x: 2768, z: 2769 }, maxTicks: 20 });
        // S20 crate over the hole -> cellar (agility >= ~68 lands safely)
        await opLocAnswer(4714, { x: 2769, z: 2765 }, [/^Yes, I'm sure\.$/], () => bot.tile().z > 6400 && !inDialog(bot), 'hole');
    }
    if (from('cellar')) {
        // session 8 (allchaos fork qt49gm 'mould' x7: the crate dialog ran to 'Yes' every time, but the pack was 28/28 and
        // inv_add drops nothing in: quest_mm.rs2:934-942; the route's slot watcher only eats when hp has 20 room): free a slot
        // first (eat a shark, else drop one). MM_MOULD_SLOT=0 reverts.
        for (let k = 0; k < 3 && process.env.MM_MOULD_SLOT !== '0' && bot.free() < 1 && bot.count(o2('mm_monkey_amulet_mould')) === 0; k++) {
            const sl = bot.slot('shark');
            if (sl >= 0) { if (k === 0) bot.opHeld1(o2('shark'), sl); else bot.dropItem(o2('shark'), sl); bot.queueFlush(); await bot.until(() => bot.free() > 0, 4); }
            else break;
        }
        await opLocAnswer(4724, { x: 2782, z: 9172 }, [/^Yes$/], () => bot.count(o2('mm_monkey_amulet_mould')) > 0 && !inDialog(bot), 'mould');
        // eastern rope -> sleeping monkey's zone (guards): run for the bridge (a knockout is handled by toBeach via the jail)
        for (let k = 0; k < 3 && bot.tile().z > 6400; k++) { opLocGo(bot, locAt(4728, 2798, 9169), 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 6400, 8); }
        if (bot.tile().z > 6400) fail('east rope');
        at('rope-up');
        for (let k = 0; k < 3 && bot.tile().z >= 2764 && bot.tile().x <= 2770; k++) { opLocGo(bot, locAt(4710, WH_DOOR.x, WH_DOOR.z), 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 2764 || inJail(bot.tile()), 6); }
    }
    if (from('tobeach')) {
        await toBeach();
    }
    if (from('zooknock1')) {
        // S18 Zooknock: whole chain (found -> ... -> need_items) ends at a multi2; close it. S21: gold bar, dentures, mould.
        await toZooknock();
        at('at-zooknock');
        await talkTo(ZOOKNOCK, null, 0, [], () => bot.dialogOptions().some(x => /What do we need for the monkey amulet\?/.test(x.text)), 'zooknock-story', 200);
        bot.closeModal(); bot.queueFlush(); await bot.tick(1);
        for (const it of ['gold_bar', 'mm_monkey_dentures', 'mm_monkey_amulet_mould']) {
            if (bot.count(it) === 0 && it !== 'mm_monkey_amulet_mould') continue;
            await useOnNpc(ZOOKNOCK, it, it === 'mm_monkey_amulet_mould' ? () => bot.count(o2('mm_enchanted_gold_bar')) > 0 && !inDialog(bot) : () => bot.count(it) === 0 && !inDialog(bot), `zooknock-${it}`);
        }
        want = null;
    }
    const leaveCave = async (label: string) => {
        if (bot.tile().z < 6400) return;
        want = 'protectfrommelee';
        await walk({ x: 2763, z: 9104 }, `${label}-walk`, 1);
        for (let k = 0; k < 3 && bot.tile().z > 6400; k++) { opLocGo(bot, locAt(4781, CAVE_IN.x, CAVE_IN.z), 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 6400, 8); }
        if (bot.tile().z > 6400) fail(`${label}: cave exit`);
        want = null; at(label);
        // session 11 fix 342c: qx128m left the cave with the greegree off (cause unknown): say so when it happens
        if (/^cave-out-2/.test(label) && !greegreeOn()) log(bot, t0, `342c: greegree OFF at ${label} (pack ${bot.free()} free, scim worn ${bot.isWorn(o2('rune_scimitar'))})`);
    };
    const inGarden = (t: Tile) => t.x >= 2740 && t.x <= 2746 && t.z >= 2792 && t.z <= 2798;
    const auntSafe = () => { const a = npc(bot, AUNT); return !a || !inGarden(a); };
    if (from('out1')) {
        await leaveCave('cave-out-1');
    }
    if (from('jail2')) {
        await getJailed('jail-2');
        await escapeJail('escape-2');
    }
    // ---- temple floor navigation: the trapdoor gorillas (1460, size 2, blockwalk=all, tethered 2 tiles to their spawns)
    //      box the trapdoor; route with a local BFS that avoids their 2x2 footprints, re-planned every tick
    // Temple guards trap: the box was z 2778..2792, which cut off both outer aisles round
    // the two east pillars (x 2804-2807, z 2778-2781 and z 2789-2792: the aisles run along z 2777 and z 2793). With the guards
    // in the middle aisle the BFS then had NO path, the bot stood still inside their maxrange, and a guard fighting an
    // adjacent player never moves (Npc.ts aiMode: tryInteract before pathToTarget), so the box held for good (600 t x 3, then
    // prayer out: death). Now the whole floor is in the box, and leaveTemple prices the guards' reach (see GUARD_SPAWNS).
    const GUARD_SPAWNS: Tile[] = [{ x: 2803, z: 2785 }, { x: 2805, z: 2783 }, { x: 2805, z: 2786 }];   // m43_43.jm2 npc 1460 (SW tiles)
    /** a trapdoor guard keeps its target only while the target is within maxrange+1 = 3 of its SPAWN, corners excluded
     *  (Npc.ts targetWithinMaxRange, OpTrigger branch; quest_mm.npc maxrange=2): outside every guard's reach none can hold us */
    const inGuardReach = (t: Tile) => GUARD_SPAWNS.some(s => { const dx = Math.abs(t.x - s.x), dz = Math.abs(t.z - s.z); return Math.max(dx, dz) <= 3 && !(dx === 3 && dz === 3); });
    const templeNav = await (async () => {
            const stands: Tile[] = [];
                // local search in the temple (x 2795..2811, z 2776..2794) over static 1-step edges, avoiding every gorilla's 2x2 footprint
                const n = await nav();
                const X0 = 2795, X1 = 2811, Z0 = 2776, Z1 = 2794;
                const edge = new Map<string, boolean>();
                const canStep = (x: number, z: number, dx: number, dz: number) => {
                    const k = `${x},${z},${dx},${dz}`; let v = edge.get(k);
                    if (v === undefined) { try { const p = n.findLongPath(0, x, z, x + dx, z + dz, 3); const e = p[p.length - 1]; v = !!e && e.x === x + dx && e.z === z + dz && p.length <= 1; } catch { v = false; } edge.set(k, v); }
                    return v;
                };
                const occ = (x: number, z: number) => npcsOf(bot, [1460]).some(g => x >= g.x && x <= g.x + 1 && z >= g.z && z <= g.z + 1);
                const bfs = (from: Tile): Tile[] | null => {
                    const prev = new Map<string, string | null>(); const key = (x: number, z: number) => `${x},${z}`;
                    const q: Tile[] = [from]; prev.set(key(from.x, from.z), null);
                    while (q.length) {
                        const c = q.shift()!;
                        if (stands.some(t => t.x === c.x && t.z === c.z)) {
                            const path: Tile[] = []; let k: string | null = key(c.x, c.z);
                            while (k) { const [x, z] = k.split(',').map(Number); path.unshift({ x: x!, z: z! }); k = prev.get(k)!; }
                            return path.slice(1);
                        }
                        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                            const nx = c.x + dx, nz = c.z + dz; if (nx < X0 || nx > X1 || nz < Z0 || nz > Z1) continue;
                            if (prev.has(key(nx, nz)) || occ(nx, nz) || !canStep(c.x, c.z, dx, dz)) continue;
                            prev.set(key(nx, nz), key(c.x, c.z)); q.push({ x: nx, z: nz });
                        }
                    }
                    return null;
                };
                /** cheapest path (Dijkstra, 1 per step + cost(tile)) to any goal; null = boxed in */
                const cheapest = (from: Tile, goals: Tile[], cost: (x: number, z: number) => number): Tile[] | null => {
                    const key = (x: number, z: number) => `${x},${z}`, goal = new Set(goals.map(t => key(t.x, t.z)));
                    const dist = new Map<string, number>([[key(from.x, from.z), 0]]), prev = new Map<string, string | null>([[key(from.x, from.z), null]]);
                    const open: Array<[number, number, number]> = [[0, from.x, from.z]];
                    while (open.length) {
                        let bi = 0; for (let i = 1; i < open.length; i++) if (open[i]![0] < open[bi]![0]) bi = i;
                        const [d, x, z] = open.splice(bi, 1)[0]!;
                        if (d > (dist.get(key(x, z)) ?? Infinity)) continue;
                        if (goal.has(key(x, z))) {
                            const path: Tile[] = []; let k: string | null = key(x, z);
                            while (k) { const [px, pz] = k.split(',').map(Number); path.unshift({ x: px!, z: pz! }); k = prev.get(k)!; }
                            return path.slice(1);
                        }
                        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                            const nx = x + dx, nz = z + dz; if (nx < X0 || nx > X1 || nz < Z0 || nz > Z1) continue;
                            if (occ(nx, nz) || !canStep(x, z, dx, dz)) continue;
                            const nd = d + 1 + cost(nx, nz), k = key(nx, nz);
                            if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, key(x, z)); open.push([nd, nx, nz]); }
                        }
                    }
                    return null;
                };

            const bfsTo = (from: Tile, goals: Tile[]): Tile[] | null => { stands.splice(0, stands.length, ...goals); return bfs(from); };
            return { bfsTo, cheapest, occ };
    })();
    /**
     * fix 304b (CONFIRMED qx59m: 'trapdoor: 30 t in the guards' reach at 2804,2785 (gorillas 2803,2786 2803,2783 2801,2785):
     * back off (no way out)' x13 over 450 t, the same three tiles every time; then the retry walked from that tile for 750 t
     * ('TRAVEL WEDGED ... NO tile and NO waypoint progress'), the prayer potions ran out and the bot DIED). The pocket
     * (2803-2804,2785: statue east) closed by three size-2 guards (blockwalk=all) never opens: the one that holds us swings
     * every 4 t and never moves (Npc.ts tryInteract before pathToTarget), the other two are refused by the single-way check
     * (npc_combat.rs2 npc_default_attack: npc_check_notcombat -> setmode null) and re-hunt us from where they stand. The
     * religious guards never knock out (aa_monkey_guard.rs2), and Protect from Melee takes their hits, so nothing ends it.
     * Way out: kill the guard that holds us (melee, op2; 130 hp, heals 24 at <= 30 hp 1 in 12; attacking another one is
     * refused 'I'm already under attack!' -> next one). Its 2x2 footprint frees the way. Bounded by MM_BOX_TICKS (300 t).
     * MM_BOX_KILL=0 reverts; MM_BOX_TEST=1 runs it once on the first adjacent guard of the trapdoor approach.
     */
    const BOX_KILL = process.env.MM_BOX_KILL !== '0';
    /** trapdoor guards (2x2) cardinally next to `me` (melee reach), the one facing a player first */
    const guardsNextTo = (me: Tile) => npcsOf(bot, [1460]).filter(g => {
        const dx = me.x < g.x ? g.x - me.x : me.x > g.x + 1 ? me.x - g.x - 1 : 0, dz = me.z < g.z ? g.z - me.z : me.z > g.z + 1 ? me.z - g.z - 1 : 0;
        return dx + dz === 1;
    }).sort((a, b) => Number(((bot as any).npcs[b.idx]?.faceEntity ?? -1) >= 32768) - Number(((bot as any).npcs[a.idx]?.faceEntity ?? -1) >= 32768));
    const cxp = () => ['attack', 'strength', 'defence', 'hitpoints'].reduce((a, k) => a + bot.stat(k).xp, 0);
    const boxBreak = async (me0: Tile): Promise<void> => {
        const cands = guardsNextTo(me0); if (!cands.length) { if (o.verbose) log(bot, t0, 'box breaker: no guard next to us'); return; }
        // the route account usually wears no weapon here (qx59m: robes only, a dragon longsword from the Upass leftovers in the
        // pack): wield the best melee weapon held for the fight (fists barely hit defence 200) and take it off afterwards
        const W = ['dragon_longsword', 'dragon_scimitar', 'rune_scimitar', 'rune_longsword', 'rune_2h_sword', 'rune_battleaxe', 'adamant_scimitar'];
        // fix 310a MM_SCIM: the route now wears a rune scimitar from the MM bank visit (route-legs mm.wear): fight with what is
        // worn and leave it on; else (MM_SCIM=0 / a standalone run) the best one held, taken off afterwards as before
        const wornW = W.find(n => { try { return bot.isWorn(o2(n)); } catch { return false; } });
        const wpn = wornW ? undefined : W.find(n => { try { return bot.count(n) > 0; } catch { return false; } });
        if (wpn) await wield(bot, [wpn]);
        try {
        const endB = bot.tickCount + Number(process.env.MM_BOX_TICKS ?? 300);
        let ci = 0, lastOp = -99, xp = cxp(), xpT = bot.tickCount, swaps = 0; const xp0 = xp;
        if (o.verbose) log(bot, t0, `box breaker: ${wornW ? `${wornW} (worn)` : wpn ?? 'no weapon'}, at ${me0.x},${me0.z} guards ${cands.map(g => `${g.idx}@${g.x},${g.z}`).join(' ')}`);
        while (bot.tickCount < endB && bot.tile().z < 6400 && !bot.disposed) {
            const g = cands[ci % cands.length]!;
            // a boxed guard never moves: gone or moved = the box is open (TEST: follow it by idx, it is not boxing us)
            if (!npcsOf(bot, [1460]).some(n => n.idx === g.idx && (process.env.MM_BOX_TEST === '1' || (n.x === g.x && n.z === g.z)))) { if (o.verbose) log(bot, t0, `box breaker: guard ${g.idx}@${g.x},${g.z} gone (killed or moved) after ${bot.tickCount - (endB - Number(process.env.MM_BOX_TICKS ?? 300))} t`); return; }
            const x = cxp(); if (x !== xp) { xp = x; xpT = bot.tickCount; }
            if (lastOp > 0 && msgsSince(bot, lastOp).some(t => /already under attack/i.test(t))) { ci++; swaps++; lastOp = -99; if (swaps > 6) { await bot.tick(9); swaps = 0; } continue; }
            if (bot.tickCount - lastOp >= 8 && bot.tickCount - xpT >= 8) { if (bot.chatModalId !== -1) bot.closeModal(); bot.opNpc(g.idx, 2); bot.queueFlush(); lastOp = bot.tickCount; }
            await bot.tick(1);
        }
        if (o.verbose) log(bot, t0, `box breaker: time up (${process.env.MM_BOX_TICKS ?? 300} t) at ${JSON.stringify(bot.tile())}, combat xp +${cxp() - xp0}, guard swaps ${ci}`);
        } finally { if (wpn && bot.free() > 0) await unwieldAll(bot, new RegExp(`^${wpn}$`)); }
    };
    /** Leave the temple floor (rope landing) westwards, around the gorillas. */
    const leaveTempleInner = async () => {
        const exits: Tile[] = []; for (let z = 2777; z <= 2793; z++) exits.push({ x: 2796, z });
        // Temple guards trap: route round the guards' reach, not through it. The rope lands 1-2 tiles from the
        // trapdoor (mm_temple.rs2: map_findsquare(55_33, 1, 2)), i.e. inside all three guards' reach; the straight way west
        // runs between them, and one step into the trapdoor's stand pocket (2806,2785: statue west, trapdoor east) or next to
        // two of them closes the box. The guards cannot hold us at x >= 2809, z >= 2790 or z <= 2779 (the outer aisles) or
        // x <= 2799: price every tile in their reach (+3). Keep a plan while its next tiles stay free (sim mkr1: a price on
        // tiles next to a live guard flipped the plan east/west every 2 t as the guard stepped, 80 t of ping-pong).
        const cost = (x: number, z: number) => inGuardReach({ x, z }) ? 3 : 0;
        let plan: Tile[] = [];
        // route runner (fix 107, qrl2m 'boxed in' after 300 t): give up after 600 t
        const end = bot.tickCount + 600;
        // still boxed (no path at all): from the trapdoor's stand tile (or on the way to it) drop down the trapdoor and climb
        // the rope again: off the floor every guard drops us and wanders home, and the rope lands on a new random tile.
        // (fix 130 tried a dip from ANY boxed tile and never reached the stand: 'dip 1-3: false' in qrqfm; that box was the
        // old search's blind spot, reachable now. A dip is only tried here once the stand tile itself is reachable.)
        // A box also forms with a way out that a guard keeps shutting: sim mks0, the pocket z 2786 x 2805-2807 (statue and
        // trapdoor south, a wall east): the north guard steps along with us (npcs move before players), so every plan
        // north closed a tick later, 144 t of ping-pong. So 12 t in the guards' reach without getting out = boxed as well.
        const STAND = { x: 2806, z: 2785 }; let boxed = 0, dips = 0, inReach = bot.tickCount;
        while (bot.tickCount < end && bot.tile().x > 2796 && bot.tile().z < 6400) {
            const me = bot.tile();
            if (!inGuardReach(me)) inReach = bot.tickCount;
            const stuck = bot.tickCount - inReach >= 12 && dips < 4;
            const i = plan.findIndex(t => t.x === me.x && t.z === me.z); if (i >= 0) plan = plan.slice(i + 1);
            const keep = plan.length > 0 && (i >= 0 || cheb(me, plan[0]!) <= 1) && !plan.slice(0, 4).some(t => templeNav.occ(t.x, t.z));
            const p = stuck ? null : keep ? plan : templeNav.cheapest(me, exits, cost);
            if (p && p.length) { boxed = 0; plan = p; bot.sendRoute(p); bot.queueFlush(); await bot.tick(1); continue; }
            plan = [];
            if ((!stuck && ++boxed < 3) || dips >= 4) { await bot.tick(1); continue; }
            const toStand = cheb(me, STAND) === 0 ? [] : templeNav.bfsTo(me, [STAND]);
            if (!toStand) { inReach = bot.tickCount; await bot.tick(1); continue; }   // the stand is boxed off too: plan again
            if (toStand.length) { bot.sendRoute(toStand); bot.queueFlush(); await bot.until(() => cheb(bot.tile(), STAND) === 0, 4); if (cheb(bot.tile(), STAND) > 0) continue; }
            dips++;
            if (o.verbose) log(bot, t0, `leave temple: boxed in at ${me.x},${me.z} (gorillas ${npcsOf(bot, [1460]).map(g => `${g.x},${g.z}`).join(' ')}): dip ${dips} down the trapdoor`);
            for (let k = 0; k < 6 && bot.tile().z < 6400; k++) {
                const open = bot.liveLocs.get(`0,2807,2785`) === 4880;   // op1: closed = open it, open = climb down (3 t fade)
                bot.opLoc(2807, 2785, open ? 4880 : 4879, 1); bot.queueFlush();
                await bot.until(() => bot.tile().z > 6400 || (!open && bot.liveLocs.get(`0,2807,2785`) === 4880), open ? 8 : 4);
            }
            if (bot.tile().z < 6400) { inReach = bot.tickCount; continue; }
            // the guards drop us (target off their maxrange) and wander back; meanwhile walk to the rope (sim mku*: the drop
            // left us at 2806,9199, and an op from there never climbed)
            const back = bot.tickCount + 8;
            await walk({ x: 2808, z: 9202 }, 'temple-rope-dip', 1);
            if (bot.tickCount < back) await bot.tick(back - bot.tickCount);
            for (let k = 0; k < 4 && bot.tile().z > 6400; k++) { bot.opLoc(2808, 9201, 4881, 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 6400, 8); }
            if (bot.tile().z > 6400) fail('temple rope (after a dip)');
            boxed = 0; inReach = bot.tickCount;
        }
        if (bot.tile().x > 2796 && bot.tile().z < 6400) fail('leave temple: boxed in by the temple guards');
    };
    /** auto-retaliate (varp 172 option_nodef, 0 = on; controls:com_2 = 150 on, com_3 = 151 off, player_controls.rs2) */
    const setRetaliate = async (on: boolean) => {
        for (let k = 0; k < 3 && bot.getVarp(172) !== (on ? 0 : 1); k++) { bot.ifButton(on ? 150 : 151); bot.queueFlush(); await bot.until(() => bot.getVarp(172) === (on ? 0 : 1), 2); }
    };
    /** Temple guards trap: auto-retaliate OFF while leaving. Every guard hit (0 with Protect from Melee, but a hit)
     *  queues playerhit_n_retaliate, which re-targets us onto that guard with p_opnpc (auto_retaliate.rs2:7) and drops the walk
     *  we just sent; after a dip the cave's zombies did the same to the walk back to the rope (sim mkv19: stuck at 2806,9199,
     *  'temple rope (after a dip)'). Back on afterwards: the rest of the quest was tuned with it on. */
    const leaveTemple = async () => {
        await setRetaliate(false);
        try { await leaveTempleInner(); } finally { await setRetaliate(true); }
    };
    if (from('temple')) {
        // S22 temple trapdoor (gorillas: Protect from Melee), S23 enchanted bar on the wall of flame (mould held), S24 wool
        want = 'protectfrommelee';
        // route runner (fix 90, qrj3m): re-entrant once the monkey-speak amulet is made (a resume after 'leave temple: boxed
        // in' redid the wall of flame: 'no enchanted bar'): skip to the rope up and out
        const amuletDone = () => bot.count(o2('mm_amulet_of_monkey_speak')) > 0 || bot.isWorn(o2('mm_amulet_of_monkey_speak'));
        if (!amuletDone()) {
        // Temple guards trap: auto-retaliate off for the whole temple step (see leaveTemple; on again at its end)
        await setRetaliate(false);
        await bot.walkTo(2803, 2785, { near: 2, maxTicks: 200, level: 0 });   // gorillas (size 2) box the trapdoor: approach along z 2785
        {
            const TD = { x: 2807, z: 2785 }, stands = [{ x: 2806, z: 2785 }];   // forceapproach=east, rotated: only the west tile reaches (sim probe)
            let end = bot.tickCount + 450, last = -9, boxed = 0, since = bot.tickCount, noWay = 0, boxTest = process.env.MM_BOX_TEST === '1';
            const west: Tile[] = []; for (let z = 2780; z <= 2790; z++) west.push({ x: 2796, z });
            // Temple guards trap: the same ping-pong as on the rope landing, here between
            // (2801,2788) and (2803,2788) for 240 t, then boxed at (2803,2785) until the 450 t cap: neither the path nor the
            // lure ever failed long enough for the 15 t fallback. So after 30 t without getting down: step out of every guard's
            // reach (they drop us and wander home), wait, and come again.
            const outOfReach: Tile[] = []; for (let x = 2795; x <= 2811; x++) for (let z = 2776; z <= 2794; z++) if (!inGuardReach({ x, z })) outOfReach.push({ x, z });
            while (bot.tile().z < 6400 && bot.tickCount < end) {
                const me = bot.tile(), open = bot.liveLocs.get(`0,2807,2785`) === 4880;
                const adj = stands.some(t => t.x === me.x && t.z === me.z);
                if (!adj && bot.tickCount - since >= 30) {
                    const w = templeNav.cheapest(me, outOfReach, (x, z) => inGuardReach({ x, z }) ? 3 : 0);
                    if (o.verbose) log(bot, t0, `trapdoor: 30 t in the guards' reach at ${me.x},${me.z} (gorillas ${npcsOf(bot, [1460]).map(g => `${g.x},${g.z}`).join(' ')}): back off ${w ? `to ${JSON.stringify(w[w.length - 1] ?? me)}` : '(no way out)'}`);
                    if (w && w.length) { noWay = 0; bot.sendRoute(w); bot.queueFlush(); await bot.until(() => !inGuardReach(bot.tile()), 15); await bot.tick(8); }
                    // fix 304b: boxed with no way out twice in a row (60 t) -> fight our way out (see boxBreak)
                    else if (BOX_KILL && ++noWay >= 2) { noWay = 0; const b0 = bot.tickCount; await boxBreak(me); end = Math.max(end, bot.tickCount + 120); if (o.verbose) log(bot, t0, `trapdoor: box breaker ran ${bot.tickCount - b0} t`); }
                    since = bot.tickCount; boxed = 0;
                }
                else if (boxTest && BOX_KILL && guardsNextTo(me).length) { boxTest = false; if (o.verbose) log(bot, t0, 'trapdoor: MM_BOX_TEST: box breaker on the adjacent guard'); await boxBreak(me); since = bot.tickCount; }
                else if (adj && bot.tickCount - last >= 2) { last = bot.tickCount; bot.opLoc(TD.x, TD.z, open ? 4880 : 4879, 1); bot.queueFlush(); }
                else if (!adj) {
                    const p = templeNav.bfsTo(me, stands);
                    if (p && p.length) { bot.sendRoute(p); bot.queueFlush(); }
                    else if (cheb(me, { x: 2801, z: 2785 }) > 1) {   // lure them west
                        const l = templeNav.bfsTo(me, [{ x: 2801, z: 2785 }]);
                        if (l && l.length) { bot.sendRoute(l); bot.queueFlush(); boxed = 0; }
                        // boxed in by the guards (sim: 200 t stuck at 2803,2787): fall back out of the temple's west side and
                        // come back, which pulls them off the trapdoor
                        else if (++boxed >= 15) { const w = templeNav.bfsTo(me, west); if (w && w.length) { bot.sendRoute(w); bot.queueFlush(); await bot.until(() => bot.tile().x <= 2797, 20); await bot.tick(6); } boxed = 0; }
                    }
                }
                await bot.tick(1);
            }
            if (o.verbose && bot.tile().z < 6400) log(bot, t0, `trapdoor: me ${JSON.stringify(bot.tile())} loc ${bot.liveLocs.get(`0,2807,2785`)} gorillas ${npcsOf(bot, [1459, 1460]).map(g => `${g.type}@${g.x},${g.z}`).join(' ')} msgs ${msgsSince(bot, bot.tickCount - 30).join(' | ')}`);
        }
        if (bot.tile().z < 6400) fail('temple trapdoor');
        at('temple-cave');
        await walk({ x: 2809, z: 9191 }, 'firewall', 0);   // wall 4765 rot 2 = east edge of (2809,9191): stand on its tile
        for (let k = 0; k < 3 && !bot.count(o2('mm_amulet_of_monkey_speak_without_string')); k++) {
            const slot = bot.slot('mm_enchanted_gold_bar'); if (slot < 0) fail('no enchanted bar');
            bot.useItemOnLoc(2809, 9191, 4765, o2('mm_enchanted_gold_bar'), slot); bot.queueFlush();
            await bot.until(() => bot.count(o2('mm_amulet_of_monkey_speak_without_string')) > 0, 8);
            await drive(bot, () => !inDialog(bot), [/.*/], 4);
        }
        if (!bot.count(o2('mm_amulet_of_monkey_speak_without_string'))) fail(`wall of flame (${msgsSince(bot, bot.tickCount - 30).join(' | ')})`);
        // the amulet's +200 crafting xp can open a level-up page, which swallows the next item-on-item (sim: "string amulet"
        // failed at crafting 24 -> 25): continue it first, and retry
        for (let k = 0; k < 4 && !bot.count(o2('mm_amulet_of_monkey_speak')); k++) {
            if (levelUpOpen(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
            bot.useItemOnItem(o2('mm_amulet_of_monkey_speak_without_string'), bot.slot('mm_amulet_of_monkey_speak_without_string'), o2('ball_of_wool'), bot.slot('ball_of_wool')); bot.queueFlush();
            await bot.until(() => bot.count(o2('mm_amulet_of_monkey_speak')) > 0, 6);
        }
        if (!bot.count(o2('mm_amulet_of_monkey_speak'))) fail('string amulet');
        bot.opHeld2(o2('mm_amulet_of_monkey_speak'), bot.slot('mm_amulet_of_monkey_speak')); bot.queueFlush();
        await bot.until(() => bot.isWorn(o2('mm_amulet_of_monkey_speak')), 4);
        at('amulet');
        }
        if (!bot.isWorn(o2('mm_amulet_of_monkey_speak')) && bot.count(o2('mm_amulet_of_monkey_speak'))) { bot.opHeld2(o2('mm_amulet_of_monkey_speak'), bot.slot('mm_amulet_of_monkey_speak')); bot.queueFlush(); await bot.until(() => bot.isWorn(o2('mm_amulet_of_monkey_speak')), 4); }
        // S25 rope up (back among the trapdoor gorillas); auto-retaliate off from before the landing (leaveTemple turns it on)
        await setRetaliate(false);
        if (bot.tile().z > 6400) {
            await walk({ x: 2808, z: 9202 }, 'temple-rope', 1);
            for (let k = 0; k < 3 && bot.tile().z > 6400; k++) { bot.opLoc(2808, 9201, 4881, 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 6400, 8); }
            if (bot.tile().z > 6400) fail('temple rope');
        }
        await leaveTemple();
        want = null;
    }
    if (from('child')) {
        // S26-S28 monkey child (garden G = x 2740-2746, z 2792-2798; amulet worn). The Aunt calls the guards when she is within
        // 5 and we are in the same area as her: with us in G that means she is in G too. Talk while she is outside G, step
        // out east the moment she walks in (she checks every 2 ticks), come back when she has left.
        const WAIT = { x: 2750, z: 2791 }, GATE = { x: 2743, z: 2791 };   // the Aunt's patrol: garden <-> house, and out through the gate to (2741,2786)
        const inHouse = (t: Tile) => t.x >= 2733 && t.x <= 2739 && t.z >= 2792 && t.z <= 2794;
        await villageWalk(WAIT, 'garden-east', 1);
        const childAnswers = [/^Well I'll be a monkey's uncle!$/, /^How many bananas did Aunty want\?$/, /^Yes/];
        let tGiven = -1, lastOp = -9, lastClick = -9, lastSig = ''; const hist: string[] = [];
        const end = bot.tickCount + 700;
        while (!bot.count(o2('mm_monkey_talisman')) && bot.tickCount < end) {
            if (inJail(bot.tile())) { if (o.verbose) log(bot, t0, `aunt history: ${hist.slice(-30).join(' ')}`); await villageWalk(WAIT, 'garden-again', 1); continue; }
            const me = bot.tile(), a = npc(bot, AUNT), meIn = inGarden(me), auntIn = !!a && inGarden(a);
            if (tGiven < 0 && bot.count(o2('banana')) === 0) { tGiven = bot.tickCount; at('bananas'); }
            // the Aunt's rule (mm_monkeys_aunt.rs2): caught iff she is within 5, we are on the same side of the garden edge as
            // her, and she is not at home while we are outside her house box
            const safeAt = (t: Tile) => !a || cheb(a, t) > 5 || inGarden(a) !== inGarden(t) || (inHouse(a) && !(t.x >= 2732 && t.x <= 2739 && t.z >= 2789 && t.z <= 2796));
            const wantTalk = tGiven < 0 || bot.tickCount - tGiven >= 100;
            hist.push(`[${bot.tickCount - t0} me ${me.x},${me.z} aunt ${a ? `${a.x},${a.z}` : '-'} ${safeAt(me) ? 'ok' : 'UNSAFE'}${inDialog(bot) ? ' dlg' : ''}${msgsSince(bot, bot.tickCount).length ? ' msg:' + msgsSince(bot, bot.tickCount).join('/') : ''}]`);
            const mayEnter = !!a ? (inHouse(a) || (!auntIn && cheb(a, GATE) > 6)) : true;
            if ((meIn && auntIn) || (!meIn && !safeAt(me)) || (!wantTalk && (meIn || cheb(me, WAIT) > 0)) || (!meIn && !mayEnter && cheb(me, WAIT) > 0)) {
                if (inDialog(bot) && meIn && auntIn) bot.closeModal();
                if (cheb(me, WAIT) > 0) { bot.sendRoute((await nav()).findLongPath(0, me.x, me.z, WAIT.x, WAIT.z, 60)); bot.queueFlush(); }
            } else if (!meIn && !mayEnter) {
                // at WAIT: the Aunt is at the gate side or in the garden
            } else if (inDialog(bot)) {
                const opts = bot.dialogOptions();
                if (opts.length) {
                    const sig = opts.map(x => x.text).join('|');
                    if (sig !== lastSig || bot.tickCount - lastClick >= 4) { for (const re of childAnswers) if (bot.clickDialogByText(re) > 0) { lastSig = sig; lastClick = bot.tickCount; break; } }
                } else for (let k = 0; k < 4; k++) bot.resumeDialogPage();
                bot.queueFlush();
            } else if (wantTalk) {
                const c = npc(bot, CHILD);
                if (c && bot.tickCount - lastOp >= 4) { opNpcGo(bot, c, 1); lastOp = bot.tickCount; }
            }
            await bot.tick(1);
        }
        if (!bot.count(o2('mm_monkey_talisman'))) fail(`talisman (bananas left ${bot.count(o2('banana'))})`);
        at('talisman');
        await toBeach();
    }
    if (from('zooknock2')) {
        // S29 Zooknock: talisman + Karamja monkey bones -> greegree; chapter 3 cutscene follows (queued)
        await toZooknock();
        for (const it of ['mm_monkey_talisman', 'mm_normal_monkey_bones']) {
            await useOnNpc(ZOOKNOCK, it, it === 'mm_normal_monkey_bones' ? () => bot.count(o2('mm_monkey_greegree_for_normal_monkey')) > 0 && !inDialog(bot) : () => bot.count(it) === 0 && !inDialog(bot), `zooknock-${it}`);
        }
        // chapter 3 cutscene (19 lines, teleports away and back): click through until quiet
        await drive(bot, quiet(8), [/.*/], 200);
        await closeMain();
        want = null;
        at('greegree');
    }
    // ================================================================ Chapter 3 (a Karamja monkey)
    const GREEGREE = 'mm_monkey_greegree_for_normal_monkey';
    const wearGreegree = async () => {
        // "You cannot use this whilst in combat." (mm_greegree.rs2: 10 t after the last hit) - the cave's spiders/zombies keep
        // that timer alive (sim: an aggressive spider right after Zooknock's hand-over). Fight the closest attacker off, retry.
        for (let k = 0; k < 12 && !greegreeOn(); k++) {
            const t1 = bot.tickCount;
            if (levelUpOpen(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
            if (bot.slot(GREEGREE) >= 0) { bot.opHeld2(o2(GREEGREE), bot.slot(GREEGREE)); bot.queueFlush(); }
            await bot.until(greegreeOn, 4);
            if (greegreeOn()) break;
            if (msgsSince(bot, t1 - 1).some(m => /whilst in combat/.test(m))) {
                const foe = npcsOf(bot, MELEE_AGGRO).find(n => n.d <= 2);
                if (foe) { bot.opNpc(foe.idx, 2); bot.queueFlush(); await bot.until(() => !npcsOf(bot, MELEE_AGGRO).some(n => n.idx === foe.idx), 20); }
                await bot.tick(10);
            }
        }
        if (!greegreeOn()) fail('wear greegree');
    };
    /** fix 310a MM_SCIM: the rune scimitar is worn from the bank (route-legs mm.wear). Wearing
     *  the greegree swaps it into the pack (slot-neutral); when the greegree comes off, wield it again from the pack, which
     *  frees that slot, so outside monkey form the pack is what it was without the scimitar (the phase-3 demon kit hand-off
     *  fills the pack to 28/28). */
    const SCIM_ON = process.env.MM_SCIM !== '0';
    const scimBack = async () => {
        if (!SCIM_ON || greegreeOn() || bot.slot('rune_scimitar') < 0 || bot.isWorn(o2('rune_scimitar'))) return;
        for (let k = 0; k < 3 && !bot.isWorn(o2('rune_scimitar')) && bot.slot('rune_scimitar') >= 0; k++) await wield(bot, ['rune_scimitar']);
        if (o.verbose) log(bot, t0, `310a: rune scimitar ${bot.isWorn(o2('rune_scimitar')) ? 'worn again' : 'NOT worn'} after the greegree, free ${bot.free()}`);
    };
    const unwearGreegree = async (rewieldScim = true) => {
        for (let k = 0; k < 4 && greegreeOn(); k++) { bot.unequipItem(o2(GREEGREE)); bot.queueFlush(); await bot.until(() => !greegreeOn(), 4); }
        if (rewieldScim) await scimBack();
    };
    /** Ravine gate (monkeys only): from the south (beach side) to the village or back. */
    const ravineGate = async (north: boolean) => {
        // the gate (mm_bamboo_largedoor 4787 at (2719,2766), 2 wide) is reached from the tile right next to it on either side:
        // (2720,2765) south, (2720,2767) north. From (2720,2769) the server answers "I can't reach that!" (sim-proven).
        const stand = north ? { x: 2720, z: 2765 } : { x: 2720, z: 2767 };
        const done = () => north ? bot.tile().z >= 2768 && bot.tile().x >= 2715 && bot.tile().x <= 2725 : bot.tile().z <= 2765 && bot.tile().x >= 2715 && bot.tile().x <= 2725;
        if (done()) return;
        // session 11 fix 342 MM_GATE_JAIL (qx128m seed 9528: the greegree was off at cave-out-2 (the safety loop prayed
        // Protect from Missiles = !greegreeOn), a ravine archer's knockout (mm_archer.rs2 aa_archer_knockout: 1 arrow in 20,
        // only without a greegree) put us in the jail cell (2770-2776,2793-2794), and every 'ch3' resume (x6) asked travel
        // for the gate from inside the locked cell: 'no route' in 6 t -> STOPPED qp 68). 342b: jailed = escape first (the
        // patrol only hits a player without a greegree, mm_jail.rs2 mm_jail_patrol); the escape lands in the village, which
        // is north of the gate already. 342a: no greegree on the way north = wear it before the ravine (no knockout, and the
        // gate needs it: 'The gate is too heavy to move!'). MM_GATE_JAIL=0 reverts. TEST MM_GATE_JAIL_TEST=1: the first north
        // crossing takes the greegree off and waits at the ravine for a knockout (getJailed), then goes on as a jailed resume.
        if (north && process.env.MM_GATE_JAIL !== '0') {
            if (process.env.MM_GATE_JAIL_TEST === '1' && !(globalThis as any).__mmGateJailTest) {
                (globalThis as any).__mmGateJailTest = true;
                log(bot, t0, '342 TEST: greegree off, waiting for a ravine knockout');
                await unwearGreegree(false); await getJailed('342-test-jailed');
            }
            if (inJail(bot.tile())) {
                log(bot, t0, `342b: jailed at ${JSON.stringify(bot.tile())} before the ravine gate: escape (the village is north of the gate)`);
                if (!greegreeOn()) await wearGreegree();
                await escapeJail('gate-jail-escape');
                return;
            }
            if (!greegreeOn()) { log(bot, t0, `342a: greegree OFF at ${JSON.stringify(bot.tile())} before the ravine: wear it`); await wearGreegree(); }
        }
        await walk(stand, north ? 'gate-south' : 'gate-north', 1);
        for (let k = 0; k < 3 && cheb(bot.tile(), stand) > 0; k++) { bot.sendRoute([stand]); bot.queueFlush(); await bot.until(() => cheb(bot.tile(), stand) === 0, 6); }
        for (let k = 0; k < 3 && !done(); k++) { bot.opLoc(2719, 2766, 4787, 1); bot.queueFlush(); await drive(bot, () => done() && !inDialog(bot), [], 10); }
        if (!done()) fail(`ravine gate ${north ? 'north' : 'south'}`);
    };
    const toLumdo = async () => {
        // from the village side as a monkey: back through the ravine gate, then east along the beach
        if (!onBeach(bot.tile()) && !(bot.tile().x >= 2715 && bot.tile().x <= 2725 && bot.tile().z <= 2765)) await ravineGate(false);   // monkeys cannot use the jumping square
        await walk({ x: 2803, z: 2709 }, 'lumdo-atoll', 2);
    };
    // 266b (allchaos qx09m: a throw at Lumdo resumed at 'kruk' with Lumdo's flight already landed, on Crash Island (2894,2726):
    // 'wear greegree' x4, STOPPED qp 68). Crash Island (mapsquare 45_42) is outside ~mm_greegree_zone (quest_mm.rs2), so the
    // greegree only says "nothing happens" there; nor is Kruk's work left to do (we only fly from the atoll after
    // Awowogei's mission). On Crash Island at a 'kruk' (or 'ch3') resume = skip to 'tozoo' (Lumdo is skipped too, 266a).
    // MM_CRASH_RESUME=0 reverts.
    const onCrashIsland = () => bot.minusedlevel === 0 && bot.tile().x >= 2880 && bot.tile().x <= 2943 && bot.tile().z >= 2688 && bot.tile().z <= 2751;
    // (the stage line stays 'if (from(...)) {': route-legs mmLabels parses it to map step labels to stages)
    const crashResume = (stage === 'kruk' || stage === 'ch3') && process.env.MM_CRASH_RESUME !== '0' && onCrashIsland();
    if (crashResume) log(bot, t0, `resume: on Crash Island already (${JSON.stringify(bot.tile())}), Lumdo flew us: kruk done, on to the zoo`);
    if (from('ch3')) { if (!crashResume) {
        await wearGreegree();
        at('greegree-on');
        await leaveCave('cave-out-2');
        await ravineGate(true);
        // S31 Garkor (seek alliance), S32 Elder Guard (sends us to Kruk)
        if (!(await walkOp(bot, GARKOR_STAND, null, () => cheb(bot.tile(), GARKOR_STAND) <= 1, { maxTicks: 200 }))) fail('walk garkor-2');
        await talkTo(GARKOR, null, 0, [], quiet(3), 'garkor-alliance', 120);
        await talkTo(ELDER, { x: 2801, z: 2755 }, 0, [], quiet(3), 'elder-guard', 80);
    } }
    if (from('kruk')) { if (!crashResume) {
        if (!greegreeOn()) await wearGreegree();
        // session 11 (audit): a resume INTO this stage (startAt 'kruk': only mmStaged's retries pass it) after Kruk already
        // escorted us (%mm_kruk = kruk_spoken) dead-ended: Kruk only says 'far too busy' (mm_kruk.rs2:10-13), x6. The journal's
        // Awowogei line shows whether the captive mission is given (then only the way out is left); else the Elder Guard's
        // 'I must speak with Awowogei again.' (mm_elder_guard.rs2:27-36, only once Kruk is spoken) takes us in without the
        // watchtower pocket; if he does not offer it, the pocket and Kruk as before. MM_KRUK_RESUME=0 reverts.
        let krukMission = false, krukIn = false;
        const inHallK = () => bot.minusedlevel === 0 && bot.tile().x >= 2800 && bot.tile().x <= 2804 && bot.tile().z >= 2759 && bot.tile().z <= 2765;
        if (stage === 'kruk' && process.env.MM_KRUK_RESUME !== '0') {
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            const j = await readJournal(bot, 'mm');
            krukMission = j.ok && /asked\s+to\s+rescue\s+one\s+of\s+the\s+Karamjan|rescued\s+one\s+of\s+the\s+monkeys/i.test(j.text);
            log(bot, t0, `[journal] mm: ${j.ok ? `captive mission given ${krukMission}` : 'UNREADABLE'} (${j.ticks} t) at ${JSON.stringify(bot.tile())}`);
            krukIn = inHallK();
            if (!krukMission && !krukIn) {
                if (onBeach(bot.tile()) || (bot.tile().z <= 2765 && bot.tile().x <= 2730)) await ravineGate(true);
                if (npc(bot, ELDER) === null || cheb(bot.tile(), { x: 2801, z: 2755 }) > 6) await walk({ x: 2801, z: 2755 }, 'elder-again-k', 2);
                await talk(bot, ELDER, [], { done: () => bot.tile().z >= 2759 && !inDialog(bot), answers: [/^I must speak with Awowogei again\.$/], maxTicks: 40, label: 'elder-again-k' });
                await bot.until(() => !inDialog(bot), 4);
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
                krukIn = inHallK();
                log(bot, t0, `resume: Elder Guard let us in ${krukIn} at ${JSON.stringify(bot.tile())}`);
            }
        }
        if (!krukMission && !krukIn) {
        // S33 Kruk -> escorted into the throne room; S34 the throne (Uwogo + Muruwoi within 7); S35 out via the Elder Guard
        // Kruk's ravine is a closed pocket: west jungle -> west watchtower (2713,2766) up 2 -> walkway -> east tower down 2
        // only from the beach side of the ravine gate (a checkpoint start, or the cave): straight after the Elder Guard we are
        // already in the village (z ~2758 too, but EAST of the ravine) and a walk to the gate's south stand cannot arrive
        if (onBeach(bot.tile()) || (bot.tile().z <= 2765 && bot.tile().x <= 2730)) await ravineGate(true);
        // straight after the Elder Guard (S32) we stand at (2803,2757) right next to him: the planned route runs west through
        // his tiles and the server drops every MOVE whose first step is into him (no step for 900 t). Step around him first.
        if (cheb(bot.tile(), { x: 2801, z: 2757 }) <= 3) {
            for (const t of [{ x: 2804, z: 2755 }, { x: 2795, z: 2755 }]) { bot.sendRoute([t]); bot.queueFlush(); await bot.until(() => cheb(bot.tile(), t) === 0, 15); }
        }
        if (!(await walkOp(bot, { x: 2712, z: 2766 }, null, () => bot.tile().x === 2712 && bot.tile().z === 2766, { maxTicks: 300 }))) fail('walk west watchtower');   // forceapproach east, rot 2: from the west
        for (let k = 0; k < 3 && bot.minusedlevel === 0; k++) { bot.opLoc(2713, 2766, 4775, 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 2, 6); }
        if (bot.minusedlevel !== 2) fail('west watchtower up');
        await walk({ x: 2730, z: 2766 }, 'walkway', 0, 2);   // east tower top (rot 0): from the east
        for (let k = 0; k < 3 && bot.minusedlevel === 2; k++) { bot.opLoc(2729, 2766, 4776, 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 0, 6); }
        if (bot.minusedlevel !== 0) fail('east watchtower down');
        at('kruk-pocket');
        await talkTo(KRUK, null, 0, [], () => bot.tile().x >= 2795 && bot.tile().z >= 2758 && !inDialog(bot), 'kruk', 80);
        // TEST (session 11 proof): SR_FAIL_AT=mm-kruk-out leaves the hall after Kruk's escort (no mission yet), then throws
        if (process.env.SR_FAIL_AT === 'mm-kruk-out' && !(globalThis as any).__mmKrukOut) { (globalThis as any).__mmKrukOut = 1; await talkTo(ELDER, null, 0, [/^I would like to leave now\.$/], () => bot.tile().z <= 2756 && !inDialog(bot), 'leave-hall-test', 60); at('mm-kruk-out'); }
        }
        if (!krukMission) {
        // Awowogei only sets the captive mission (mm_awowogei 1) when Uwogo (1449) AND Murowoi (1450) are within 7 tiles of us
        // (mm_awowogei.rs2); otherwise the talk just ends after our offer and the zoo monkey is worthless later (Garkor then
        // never starts chapter 4). The mission talk ends on our line "...with one of the captives.": retry until we see it.
        const missionGiven = () => [...bot.ifText.values()].some(t => /with one of the captives/.test(t));
        const advisersNear = () => [1449, 1450].every(id => npcsOf(bot, id).some(n => n.d <= 6));
        for (let k = 0; k < 8 && !missionGiven(); k++) {
            await bot.until(advisersNear, 40);
            await walkOp(bot, { x: 2802, z: 2764 }, () => { bot.opLoc(2802, 2765, 4771, 1); }, () => inDialog(bot), { maxTicks: 15 });
            await drive(bot, quiet(3), [/.*/], 60);
        }
        if (!missionGiven()) fail('awowogei-1: no captive mission (Uwogo + Murowoi not within 7)');
        at('awowogei-1');
        }
        if (!krukMission || inHallK()) await talkTo(ELDER, null, 0, [/^I would like to leave now\.$/], () => bot.tile().z <= 2756 && !inDialog(bot), 'leave-hall', 60);
        await toLumdo();
    } }
    if (from('tozoo')) {
        // S36 Lumdo -> Crash Island -> Waydar glider -> Gnomeball pitch -> spirit tree -> Battlefield of Khazard -> zoo
        await unwearGreegree();
        // 266a (allchaos qx09m: 'lumdo-crash dialog' at (2802,2706) after 20 t with the dialog seen, then Lumdo's flight landed
        // us on Crash Island anyway a few ticks AFTER the throw; the level-up text in the log was stale, 1,300 t old). Lumdo's
        // script (mm_lumdo.rs2) is chatplayer, chatnpc, if_close, fade_out, p_delay(3), p_teleport: done = ON Crash Island
        // (any interrupting page is paged by talk(); a level-up box is not a dialog), wait out the flight, re-talk only from the
        // atoll, 3 rounds. Already on Crash Island (a resume) = skip. MM_LUMDO_CRASH=0 reverts (the one 40 t talkTo).
        if (process.env.MM_LUMDO_CRASH !== '0') {
            const onCrashL = () => cheb(bot.tile(), { x: 2894, z: 2726 }) <= 4;
            for (let k = 0; k < 3 && !onCrashL(); k++) {
                if (bot.chatModalId !== -1 && !levelUpOpen(bot)) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
                if (levelUpOpen(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
                if (npc(bot, LUMDO) === null || cheb(bot.tile(), ATOLL) > 6) await walk({ x: 2803, z: 2709 }, 'lumdo-atoll-r', 2);
                await talk(bot, LUMDO, [], { done: onCrashL, answers: [/^Can you take me back to Crash Island\?$/], maxTicks: 30, label: 'lumdo-crash' });
                await bot.until(onCrashL, 10);   // the fade + p_delay(3) + teleport can land after talk() gave up
                if (!onCrashL() && o.verbose) log(bot, t0, `lumdo-crash: round ${k + 1} not flown (me ${JSON.stringify(bot.tile())}, modal ${bot.chatModalId}/${bot.mainModalId}, lumdo ${npc(bot, LUMDO) ? 'visible' : '-'})`);
            }
            if (!onCrashL()) fail('lumdo-crash: not flown to Crash Island (3 rounds)');
            await bot.until(() => !inDialog(bot), 4);
            dismiss(bot);
            // TEST (266 proof): SR_FAIL_AT=mm-lumdo-flown throws once on Crash Island BEFORE the 'lumdo-crash' mark, so the retry
            // resumes at stage 'kruk' (the qx09m case)
            try { failHook('mm-lumdo-flown'); } catch (e) { cleanup(); throw e; }
            at('lumdo-crash');
        } else
        await talkTo(LUMDO, null, 0, [/^Can you take me back to Crash Island\?$/], () => cheb(bot.tile(), { x: 2894, z: 2726 }) <= 4 && !inDialog(bot), 'lumdo-crash', 40);
        await talkTo(WAYDAR, null, 0, [/^I need to return to your kingdom\.$/], () => cheb(bot.tile(), { x: 2393, z: 3466 }) <= 6 && !inDialog(bot), 'waydar-home', 60);
        await closeMain();
        await walk({ x: 2459, z: 3446 }, 'spirit-tree', 1);
        let ok = false;
        for (let k = 0; k < 3 && !ok; k++) {
            opLocGo(bot, locAt(1293, 2460, 3445), 1); bot.queueFlush();
            ok = await drive(bot, () => cheb(bot.tile(), { x: 2555, z: 3259 }) <= 4 && !inDialog(bot), [/^Where can I go\?$/, /^Battlefield of Khazard\.$/], 40);
        }
        if (!ok) fail('spirit tree -> Khazard');
        at('khazard');
    }
    if (from('zoo')) {
        // S37-S39 zoo: greegree inside the zoo zone, minder -> cage, zoo monkey -> backpack monkey, greegree off, minder -> out
        await walk({ x: 2597, z: 3277 }, 'zoo', 2);
        await wearGreegree();
        await talkTo(MINDER, null, 0, [/.*/], () => cheb(bot.tile(), { x: 2604, z: 3281 }) <= 2 && !inDialog(bot), 'minder-in', 60);
        await talkTo(ZOOMONKEY, null, 0, [/.*/], () => bot.count(o2('mm_monkey_in_backpack')) > 0 && !inDialog(bot), 'zoo-monkey', 80);
        await unwearGreegree();
        // out: the minder telejumps us to map_findsquare(npc_coord, 1, 5) round HIMSELF (mm_monkey_minder.rs2:19), so the
        // landing can be <= 3 from the cage tile (mk A/B seed 4612: out at 2605,3283, 'minder-out dialog' after 60 t).
        // Done = outside his cage zones (mm_monkey_minder.rs2:7, 0_40_51 = 2560,3264).
        const inCage = (t: Tile) => (t.x >= 2598 && t.x <= 2600 && t.z >= 3274 && t.z <= 3278) || (t.x >= 2600 && t.x <= 2604 && t.z >= 3276 && t.z <= 3282) || (t.x >= 2605 && t.x <= 2606 && t.z >= 3276 && t.z <= 3281);
        await talkTo(MINDER, null, 0, [/.*/], () => !inCage(bot.tile()) && !inDialog(bot), 'minder-out', 60);
    }
    if (from('fromzoo')) {
        // S40 zoo -> the Grand Tree ON FOOT. NOT the spirit trees (young tree -> village -> stronghold): every spirit-tree hop
        // runs post_tele_checks (teleport.rs2), which deletes the backpack monkey "in a puff of smoke" -> Awowogei has no
        // captive, Garkor never starts chapter 4 (sim-proven; the speedrun only ever got past here via a checkpoint that
        // handed the monkey over AT the stronghold). Walking north-west through the stronghold gate is ~250 tiles.
        // the stronghold gate is a scripted walk-through (gnome_gate.rs2; the plain walker wedges at 2461,3382): run-lib's helper
        try { await enterGnomeStronghold(bot); } catch (e) { fail(`stronghold gate: ${(e as Error).message}`); } finally { bot.holdDialogs = true; }
        await walk({ x: 2465, z: 3489 }, 'zoo-to-grand-tree', 3);
        if (bot.count(o2('mm_monkey_in_backpack')) === 0) fail('the backpack monkey is gone (a teleport on the way?)');
        at('stronghold-2');
    }
    if (from('hangar2')) {
        // route runner (fix 68): re-entrant by position (a stage resume on Crash Island walked for the trunk door, qri2m)
        const onCrash2 = () => cheb(bot.tile(), CRASH) <= 20, atAtoll2 = () => cheb(bot.tile(), ATOLL) <= 6;
        if (!onCrash2() && !atAtoll2()) {
            // session 9 (allchaos qu07m: 'waydar-crash-2 dialog' in the hangar, then every resume walked for the trunk door from
            // the hangar: 'walk trunk-door-out' 900 t x5, STOPPED): already in the hangar = straight to Waydar (MM_HANGAR_RESUME=0)
            if (!(hangarResume && inHangar2())) {
                await trunkTo(1);
                await talkTo(DAERO, DAERO_BAR, 1, [/^Yes$/], () => cheb(bot.tile(), HANGAR2) <= 12 && !inDialog(bot), 'daero-hangar-2', 80);
            } else log(bot, t0, 'resume: in the hangar already, straight to Waydar');
            await talkTo(WAYDAR, null, 0, [/^Yes$/], () => cheb(bot.tile(), CRASH) <= 8 && !inDialog(bot), 'waydar-crash-2', 60);
        }
        await closeMain();
        if (!atAtoll2()) await talkTo(LUMDO, null, 0, [/.*/], () => cheb(bot.tile(), ATOLL) <= 6 && !inDialog(bot), 'lumdo-atoll', 60);
    }
    // session 8 (allchaos qt50m: 'sigil teleport' failed in chapter 4, every resume re-ran throne2 and died at 'no backpack
    // monkey to hand over' x6): with the sigil already held/worn throne2 is done. MM_SIGIL_RESUME=0 reverts.
    const sigilHeld = () => bot.count(o2('mm_sigil')) > 0 || bot.isWorn(o2('mm_sigil'));
    if (from('throne2') && process.env.MM_SIGIL_RESUME !== '0' && sigilHeld() && bot.count(o2('mm_monkey_in_backpack')) === 0) log(bot, t0, 'resume: sigil held, throne2 already done');
    else if (from('throne2')) {
        // S41 Elder Guard ("I must speak with Awowogei again.") -> throne: the backpack monkey; out; S42 Garkor -> chapter 4 cutscene; S43 sigil
        // session 11 (audit: after the backpack monkey is handed over at 'awowogei-2', any throw before the sigil resumed here and
        // failed 'throne: no backpack monkey' x6, a deterministic dead end): no monkey + the journal's Awowogei line 'I have
        // rescued one of the monkeys from the zoo' (mm_awowogei > sent_mission, mm_journal.rs2) = handed over already: out of the
        // hall, Garkor (mm_garkor.rs2 seek_alliance -> mm_garkor_p4 -> chapter 4 cutscene; learned_plan -> the sigil).
        // A drop inside the cutscene (zone 1_41_71): one walk click resumes it (mm_ch4_walktrigger), then page through.
        // MM_GARKOR_RESUME=0 reverts (the old fail).
        const inCutZone = () => bot.minusedlevel === 1 && bot.tile().x >= 2624 && bot.tile().x <= 2687 && bot.tile().z >= 4544 && bot.tile().z <= 4607;
        const inHall = () => bot.minusedlevel === 0 && bot.tile().x >= 2800 && bot.tile().x <= 2804 && bot.tile().z >= 2759 && bot.tile().z <= 2765;
        let handed = false;
        if (bot.count(o2('mm_monkey_in_backpack')) === 0 && process.env.MM_GARKOR_RESUME !== '0') {
            if (inCutZone()) handed = true;
            else {
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
                const j = await readJournal(bot, 'mm');
                handed = j.ok && /rescued\s+one\s+of\s+the\s+monkeys/i.test(j.text);
                log(bot, t0, `[journal] mm: ${j.ok ? `monkey handed over ${handed}, sigil given ${/given\s+me\s+a\s+sigil/i.test(j.text)}` : 'UNREADABLE'} (${j.ticks} t)`);
            }
        }
        if (!handed) {
        if (bot.count(o2('mm_monkey_in_backpack')) === 0) fail('throne: no backpack monkey to hand over');
        await wearGreegree();
        await ravineGate(true);
        await talkTo(ELDER, { x: 2801, z: 2755 }, 0, [/.*/], () => bot.tile().z >= 2759 && !inDialog(bot), 'elder-again', 60);
        await walkOp(bot, { x: 2802, z: 2764 }, () => { bot.opLoc(2802, 2765, 4771, 1); }, () => bot.count(o2('mm_monkey_in_backpack')) === 0, { maxTicks: 30 });
        await drive(bot, quiet(3), [/.*/], 60);
        if (bot.count(o2('mm_monkey_in_backpack'))) fail('throne: monkey not handed over');
        at('awowogei-2');
        await talkTo(ELDER, null, 0, [/^I would like to leave now\.$/], () => bot.tile().z <= 2756 && !inDialog(bot), 'leave-hall-2', 60);
        } else if (!inCutZone()) {
            log(bot, t0, `resume: the backpack monkey is with Awowogei already (journal): out of the hall, to Garkor from ${JSON.stringify(bot.tile())}`);
            if (!greegreeOn()) await wearGreegree();
            if (inHall()) await talkTo(ELDER, null, 0, [/^I would like to leave now\.$/], () => bot.tile().z <= 2756 && !inDialog(bot), 'leave-hall-2r', 60);
            else if (onBeach(bot.tile()) || (bot.tile().z <= 2765 && bot.tile().x <= 2730)) await ravineGate(true);
        }
        // Garkor -> "Listen closely..." -> chapter 4 cutscene: away to (2671,4579,L1), 25 lines (one if_close at part 18), back
        let away = false;
        const back = () => { const t = bot.tile(); if (cheb(t, GARKOR_STAND) > 20) away = true; return away && cheb(t, GARKOR_STAND) <= 3; };
        const sigilNow = () => bot.count(o2('mm_sigil')) > 0;
        if (handed && inCutZone()) {
            // paused cutscene (a drop closed its page): one walk click fires the walktrigger, the queue goes on with the next part
            log(bot, t0, `resume: inside the chapter 4 cutscene at ${JSON.stringify(bot.tile())}: a walk click resumes it`);
            back();
            if (!inDialog(bot)) { const t = bot.tile(); bot.sendRoute([{ x: t.x, z: t.z + 1 }]); bot.queueFlush(); await bot.until(() => inDialog(bot) || back(), 6); }
        } else {
            if (!(await walkOp(bot, GARKOR_STAND, null, () => cheb(bot.tile(), GARKOR_STAND) <= 1, { maxTicks: 200 }))) fail('walk garkor-3');
            // TEST (session 11 proof): SR_FAIL_AT=mm-ch4-cut stops the talk on the first cutscene page in the cut zone, closes it (as a drop) and throws
            const cutTest = () => process.env.SR_FAIL_AT === 'mm-ch4-cut' && !(globalThis as any).__mmCh4Cut && inCutZone() && inDialog(bot);
            await talkPastMonkey(GARKOR, mt => ({ done: () => cutTest() || monkeyChat() || back() || (handed && sigilNow()), answers: [/.*/], maxTicks: mt, label: 'ch4-start' }), 60, () => { });
            if (cutTest()) { (globalThis as any).__mmCh4Cut = 1; bot.closeModal(); bot.queueFlush(); await bot.tick(1); at('mm-ch4-cut'); }
        }
        if (!(handed && sigilNow() && !away)) { let q = 0; const end = bot.tickCount + 300;
          while (bot.tickCount < end && !(back() && q >= 4)) {
            // TEST (session 11 proof): SR_FAIL_AT=mm-ch4-cut closes a cutscene page while away (as a drop) and throws
            if ((away || inCutZone()) && inDialog(bot) && process.env.SR_FAIL_AT === 'mm-ch4-cut' && !(globalThis as any).__mmCh4Cut) { (globalThis as any).__mmCh4Cut = 1; bot.closeModal(); bot.queueFlush(); await bot.tick(1); at('mm-ch4-cut'); }
            if (inDialog(bot)) { q = 0; for (let k = 0; k < 4; k++) bot.resumeDialogPage(); bot.queueFlush(); } else q++; await bot.tick(1); } }
        if (!back() && !(handed && sigilNow())) fail(`chapter 4 cutscene (away ${away})`);
        await closeMain();
        at('ch4-cutscene');
        if (!sigilNow()) await talkTo(GARKOR, null, 0, [/.*/], () => bot.count(o2('mm_sigil')) > 0 && !inDialog(bot), 'sigil', 80);
        else dismiss(bot);
    }
    // ================================================================ Chapter 4: the Jungle Demon, rewards
    if (from('demon')) {
        // S44 greegree off, scimitar on, sigil on (10-tick timer -> arena L1 -> allies + demon). Do not act during the ~25 t chain.
        const inArena = () => bot.minusedlevel === 1 && bot.tile().z > 6400;
        // session 11 fix 291c MM_DEATH_RESUME (CONFIRMED qx42m: a ws 1012 engine restart mid-fight, 39 t offline, 'DIED while
        // disconnected' -> Lumbridge, pack 24 -> 3; the fight loop read 'demon out of view' as killed, logged 'demon' AT
        // LUMBRIDGE, then 'final-battle Garkor' and 6 resumes 'wear sigil' at (3220,3218)): out of the arena with neither the
        // sigil nor the staff, the demon kit died with us. A replica sigil needs Waymottin (Zooknock's cave, mm_garkor.rs2) and
        // a new kit: no recovery path yet, so fail honestly at once (mmStaged does not retry 'mm: DIED'). =0 reverts.
        const fix291c = process.env.MM_DEATH_RESUME !== '0';
        const kitGone = () => !inArena() && bot.count(o2('mm_sigil')) === 0 && !bot.isWorn(o2('mm_sigil')) && bot.count(o2('staff_of_fire')) === 0 && !bot.isWorn(o2('staff_of_fire'));
        if (fix291c && kitGone()) fail(`DIED before the demon was killed: sigil + demon kit lost (no replica-sigil path), pack ${bot.inv().length}`);
        // fix 310a: the scimitar sits in the pack while the greegree is on (+1 vs before): with a full pack the greegree cannot
        // come off, so leave it on and let the staff wield below swap it out (slot-neutral). No scimitar re-wield here.
        if (!(SCIM_ON && greegreeOn() && bot.free() === 0)) await unwearGreegree(false);
        else log(bot, t0, `310a: pack full (scimitar held): the staff wield swaps the greegree out`);
        // session 11 fix 291a MM_STAFF_FIX (INFERRED qx42m: the staff of fire stayed in the pack after the one-shot wield (pack line
        // at q+325 'staff_of_fire,...' with the sigil already worn; no server answer logged), so every Fire Wave was refused
        // ('not enough Fire Runes' x75+), the allies alone took the demon 170 -> 96 in 400 t, and the long fight met the 1012
        // drop that killed us): wield with retries and check it; in the fight re-wield whenever it is not worn. =0 reverts.
        // TEST (MM_STAFF_TEST=1): the first demon attempt skips the pre-fight wield (the qx42 state), so the in-fight check must do it.
        const fix291a = process.env.MM_STAFF_FIX !== '0';
        const STAFF = process.env.MM_DEMON === 'melee' ? 'rune_scimitar' : 'staff_of_fire';
        const staffTest = process.env.MM_STAFF_TEST === '1' && !(globalThis as any).__mmStaffTest;
        if (staffTest) { (globalThis as any).__mmStaffTest = 1; log(bot, t0, `TEST 291a: ${STAFF} wield skipped`); }
        else {
            await wield(bot, [STAFF]);
            for (let k = 0; fix291a && k < 4 && !bot.isWorn(o2(STAFF)) && bot.slot(STAFF) >= 0; k++) {
                log(bot, t0, `fix 291a: ${STAFF} not worn after the wield (try ${k + 1}): again`);
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
                await wield(bot, [STAFF]);
            }
        }
        for (let k = 0; k < 3 && !bot.isWorn(o2('mm_sigil')); k++) { bot.opHeld2(o2('mm_sigil'), bot.slot('mm_sigil')); bot.queueFlush(); await bot.until(() => bot.isWorn(o2('mm_sigil')), 4); }
        if (!bot.isWorn(o2('mm_sigil'))) fail('wear sigil');
        // a resumed attempt (or a lost timer) with the sigil already worn: take it off and on again to restart its 10-tick
        // timer, twice (MM_SIGIL_RESUME=0 reverts)
        for (let k = 0; k < 2 && process.env.MM_SIGIL_RESUME !== '0' && !(await bot.until(inArena, 40)); k++) {
            log(bot, t0, `sigil teleport not yet (try ${k + 1}): re-wearing the sigil`);
            bot.unequipItem(o2('mm_sigil')); bot.queueFlush(); await bot.until(() => !bot.isWorn(o2('mm_sigil')), 4);
            bot.opHeld2(o2('mm_sigil'), bot.slot('mm_sigil')); bot.queueFlush(); await bot.until(() => bot.isWorn(o2('mm_sigil')), 4);
        }
        if (!(await bot.until(inArena, 40))) fail('sigil teleport');
        at('arena');
        // S45 melee with Protect from Magic (spells do 0; its melee still lands at defence 1: eat)
        want = 'protectfrommagic';
        // session 11 fix 297 (qx56m: DIED in the demon fight holding 10 sharks; hp 69 -> 38 -> 17 -> 10 -> 5 -> 0 in 40 t parked
        // at 2699,9168 = 1 tile from the demon's body, every eat 'NOT eaten' and no step taken (ops silently discarded).
        // CONFIRMED: auto_retaliate.rs2 playerhit_n_retaliate p_opnpc(2) after every demon cast re-targets us onto the demon
        // with the staff (melee) and walks us into its melee range (mm_demon.rs2: npc_range < 3 -> 50% melee, strength 170,
        // no prayer against it); there the kite branch ran up to 168 findLongPath searches EVERY tick. INFERRED (engine log
        // 'tick 29500: 74/500 ticks ran on the 200 ms deadline without an ack (qx56m 74)', the death window): that CPU made the
        // client fall tens of ticks behind the server, so it read hp 38 while the server player was already dying and every
        // eat/step landed during the death delay):
        //   297a MM_DEMON_NORETAL: auto-retaliate OFF for the magic demon fight (back on afterwards; cleanup also restores it).
        //   297b MM_KITE_FAST: kite search at most every 2 t, nearest candidates first, <= 12 path searches; slow searches logged.
        //   297c MM_DEMON_ADJ_EAT: in its melee range eat at 85% (one melee hit can be ~30).
        // =0 reverts each. TEST MM_DEMON_TEST=1: the first 12 t of the fight walk INTO the demon's melee range with
        // auto-retaliate ON (the qx56 state), then the normal loop must get out and eat.
        const MAGIC_D = process.env.MM_DEMON !== 'melee';
        const fix297a = process.env.MM_DEMON_NORETAL !== '0' && MAGIC_D, fix297b = process.env.MM_KITE_FAST !== '0';
        const fix297c = process.env.MM_DEMON_ADJ_EAT !== '0';
        let lastKite = -99, kiteMs = 0, kiteN = 0, kiteMax = 0, kiteSlowLogs = 0, lastRet = -99, retSends = 0;
        // TEST state: 40 t after the demon is first seen (its cutscene p_delays are over), melee it with auto-retaliate on until
        // we have stood in its melee range for 12 t (or 60 t passed), then the normal loop takes over
        let testFrom = process.env.MM_DEMON_TEST === '1' ? 0 : -1, testInside = -1, testAtt = -99, demonSeenAt = -1;
        if (fix297a) await setRetaliate(false);
        demonAdjacent = false; demonEat297 = fix297c;
        let killed = false, lastOp = -99, seen = false, lastWield = -99, rewields = 0; const end = bot.tickCount + 900;
        try {
        while (bot.tickCount < end) {
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
            // 291c: out of the arena (death / a lost teleport) the demon is merely out of view, not killed
            if (fix291c && !inArena()) { if (kitGone()) fail(`DIED in the demon fight: sigil + demon kit lost, pack ${bot.inv().length}`); fail('jungle demon: out of the arena'); }
            const d = npc(bot, DEMON);
            if (d && demonSeenAt < 0) demonSeenAt = bot.tickCount;
            // TEST 297 window (see testFrom above)
            if (testFrom === 0 && d && demonSeenAt >= 0 && bot.tickCount - demonSeenAt >= 40) {
                testFrom = bot.tickCount; log(bot, t0, 'TEST 297: melee the demon with auto-retaliate on (the qx56 state)');
                bot.ifButton(150); bot.queueFlush();
            }
            if (testFrom > 0 && d) {
                const me = bot.tile(), bd = Math.max(me.x < d.x ? d.x - me.x : me.x > d.x + 2 ? me.x - d.x - 2 : 0, me.z < d.z ? d.z - me.z : me.z > d.z + 2 ? me.z - d.z - 2 : 0);
                if (testInside < 0 && bd < 3) testInside = bot.tickCount;
                if ((testInside < 0 && bot.tickCount - testFrom < 60) || (testInside >= 0 && bot.tickCount - testInside < 12)) {
                    if (bot.getVarp(172) !== 0 && bot.tickCount - lastRet >= 3) { bot.ifButton(150); bot.queueFlush(); lastRet = bot.tickCount; }
                    if (bot.tickCount - testAtt >= 4) { bot.opNpc(d.idx, 2); bot.queueFlush(); testAtt = bot.tickCount; }
                    demonAdjacent = bd < 3;
                    await bot.tick(1); continue;
                }
                log(bot, t0, `TEST 297: done, ${testInside >= 0 ? `${bot.tickCount - testInside} t in melee range` : 'never in melee range'}, hp ${bot.stat('hitpoints').cur}, retaliate ${bot.getVarp(172) === 1 ? 'off' : 'on'}`);
                testFrom = -1;
            }
            // 297a: the button sent on arrival can land in the cutscene's p_delay and be dropped (qyy01): keep re-sending it
            if (fix297a && bot.getVarp(172) !== 1 && bot.tickCount - lastRet >= 3) { bot.ifButton(151); bot.queueFlush(); lastRet = bot.tickCount; retSends++; }
            // 291a: re-wield the staff whenever it is not worn (a discarded wear; TEST: the skipped one)
            if (fix291a && !bot.isWorn(o2(STAFF)) && bot.slot(STAFF) >= 0 && bot.tickCount - lastWield >= 4) {
                if (++rewields <= 3) log(bot, t0, `fix 291a: ${STAFF} not worn in the fight: wield (#${rewields})`);
                bot.opHeld2(o2(STAFF), bot.slot(STAFF)); bot.queueFlush(); lastWield = bot.tickCount;
            }
            if (d) {
                seen = true;
                const MAGIC = process.env.MM_DEMON !== 'melee';
                const boxDist = (t: Tile) => Math.max(t.x < d.x ? d.x - t.x : t.x > d.x + 2 ? t.x - d.x - 2 : 0, t.z < d.z ? d.z - t.z : t.z > d.z + 2 ? t.z - d.z - 2 : 0);
                const me = bot.tile();
                demonAdjacent = boxDist(me) < 3;
                if (MAGIC && boxDist(me) < 3) {   // keep >= 3 tiles from its 3x3 body: it then only casts (Protect from Magic: 0)
                    // 297b: one search per 2 t, nearest candidates first, at most 12 path searches (old: up to 168 every tick)
                    if (!fix297b || bot.tickCount - lastKite >= 2) {
                    const n = await nav(); let best: Tile[] | null = null; const w0 = Date.now(); let calls = 0;
                    const cands: Tile[] = [];
                    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
                        const t = { x: me.x + dx, z: me.z + dz }; if (boxDist(t) < 3 || boxDist(t) > 6) continue;
                        cands.push(t);
                    }
                    if (fix297b) cands.sort((a, b) => cheb(a, me) - cheb(b, me));
                    for (const t of cands) {
                        if (fix297b && (calls >= 12 || (best && best.length <= cheb(t, me)))) break;
                        calls++;
                        const p = n.findLongPath(1, me.x, me.z, t.x, t.z, 20); const e = p[p.length - 1];
                        if (e && e.x === t.x && e.z === t.z && (!best || p.length < best.length)) best = p;
                    }
                    const ms = Date.now() - w0; kiteMs += ms; kiteN++; if (ms > kiteMax) kiteMax = ms;
                    if (ms >= 100 && kiteSlowLogs++ < 5) log(bot, t0, `[297] kite search ${ms} ms (${calls} paths, best ${best ? best.length : '-'}) at boxDist ${boxDist(me)}`);
                    if (best) { bot.sendRoute(best); bot.queueFlush(); }
                    lastKite = bot.tickCount;
                    }
                } else if (bot.tickCount - lastOp >= 5) {
                    if (MAGIC) bot.opNpcT(d.idx, spellCom('fire_wave')); else bot.opNpc(d.idx, 2);
                    bot.queueFlush(); lastOp = bot.tickCount;
                }
            }
            else if (seen) { killed = true; break; }
            if (o.verbose && (bot.tickCount - t0) % 10 === 0) { const dn = d ? bot.npcs[d.idx] as any : null; log(bot, t0, `demon: ${d ? `${d.x},${d.z} d${d.d} hp ${dn?.hpCur}/${dn?.hpMax} hits ${dn?.hitCount} last ${dn?.lastDamage}` : 'none'} me ${JSON.stringify(bot.tile())} hp ${bot.stat('hitpoints').cur} sharks ${bot.count(SHARK)} pray ${bot.stat('prayer').cur} ${bot.isPrayerActive('protectfrommagic') ? 'PM' : '--'} msgs ${msgsSince(bot, bot.tickCount - 10).slice(-3).join(' | ')}`); }
            await bot.tick(1);
        }
        } finally {
            demonAdjacent = false;
            log(bot, t0, `[297] demon fight: ${killed ? 'killed' : 'not killed'}, kite searches ${kiteN} (${kiteMs} ms, max ${kiteMax} ms), retaliate ${bot.getVarp(172) === 1 ? 'off' : 'on'} (${retSends} in-fight sends), hp ${bot.stat('hitpoints').cur}, sharks ${bot.count(SHARK)}`);
            if (fix297a && !bot.disposed) { try { bot.ifButton(150); bot.queueFlush(); } catch { /* gone */ } }
        }
        if (fix297a && killed) await setRetaliate(true);
        want = null;
        if (!killed) fail('jungle demon');
        at('demon');
        // S46 Garkor (final battle) -> Zooknock -> atoll surface (2712,2784)
        await drive(bot, () => !inDialog(bot), [/.*/], 10);
        // Garkor (sets finished, spawns Zooknock: no dialog) -> Zooknock (no dialog: fade + teleport to the atoll surface)
        await bot.tick(2);   // the kill's queued script sets %mm_main = defeated_demon
        // Garkor wanders while his allies fight: keep re-sending the op until we stand next to him (his op has no dialog)
        for (let k = 0; k < 12 && !inDialog(bot); k++) {
            const g = npc(bot, GARKOR_FB); if (!g) { await bot.tick(1); continue; }
            opNpcGo(bot, g, 1); bot.queueFlush(); await bot.until(() => inDialog(bot), 3);
        }
        if (!inDialog(bot)) fail('final-battle Garkor: no dialog');
        if (o.verbose) log(bot, t0, `garkor-final dialog: modal ${bot.chatModalId} text ${[...bot.ifText.values()].slice(-3).join(' / ').slice(0, 200)}`);
        await drive(bot, quiet(3), [/.*/], 80);   // his lines, then %mm_garkor = finished + Zooknock spawned next to us
        for (let k = 0; k < 6 && bot.tile().z > 6400; k++) {
            const z = npc(bot, ZOOKNOCK_FB), g = npc(bot, GARKOR_FB);
            if (o.verbose) log(bot, t0, `final: zooknock ${z ? `${z.x},${z.z} d${z.d}` : '-'} garkor ${g ? `${g.x},${g.z} d${g.d}` : '-'} me ${JSON.stringify(bot.tile())} msgs ${msgsSince(bot, bot.tickCount - 12).join(' | ')}`);
            if (k === 0 && process.env.MM_DEBUG) { for (const v of ['mm_main', 'mm_garkor']) { bot.sendCheat(`getvar ${v}`); bot.queueFlush(); await bot.tick(1); } await bot.tick(1); log(bot, t0, `vars: ${msgsSince(bot, bot.tickCount - 4).join(' | ')}`); }
            if (k === 3 && g) { opNpcGo(bot, g, 1); bot.queueFlush(); await bot.tick(4); }
            if (z) { opNpcGo(bot, z, 1); bot.queueFlush(); } await drive(bot, () => bot.tile().z < 6400, [/.*/], 14);   // "Bear with me now." then the teleport
        }
        if (bot.tile().z > 6400) fail('zooknock final teleport');
        at('out-of-arena');
    }
    // session 11 fix 375 MM_OFFATOLL_STAGE (qx242m: after the demon kill a ravine archer's knockout (mm_archer.rs2:51,
    // strongqueue with the arrow's flight delay, then p_delay 2+3 -> jail telejump) landed AFTER the Varrock teleport
    // (law 3 -> 2): inVarrock() held, the young tree was op'd from the jail for 180 t -> 'young tree', and the resume went
    // to 'demon' = the sigil, which never fires once %mm_main >= mm_defeated_demon (mm_demon.rs2:18): 'sigil teleport' x5,
    // ROUTE STOPPED at qp 68). The way off the atoll is its own stage ('out-of-arena' / 'escape-tele-*' resume here,
    // route-legs mmLabels); a jail jump ends the young-tree wait at once: escape and cast again (one more round = one of
    // the 2 spare laws). =0 reverts (one round, the old resume mapping).
    if (from('offatoll')) {
        const fix375 = process.env.MM_OFFATOLL_STAGE !== '0';
        const jailed = () => fix375 && inJail(bot.tile());
        // off the atoll: Varrock teleport -> young tree -> Tree Gnome Village -> stronghold (no village walk, no jail risk)
        // (, mk A/B seed 4611: a village guard knocked us out while the spell was cast: the jail telejump moved us
        // > 8 tiles, so tele() said ok, and the young tree was op'd from the jail cell for 180 t -> 'young tree'. Check that
        // we are in Varrock; from the jail: escape and cast again.)
        const inVarrock = () => cheb(bot.tile(), { x: 3213, z: 3424 }) <= 20;
        let ok = false;
        for (let r = 0; r < (fix375 ? 2 : 1) && !ok; r++) {
            for (let k = 0; k < 3 && !inVarrock(); k++) {
                if (inJail(bot.tile())) await escapeJail(`escape-tele-${k}`);
                await tele(bot, 'varrock_teleport');
                if (!inVarrock()) await bot.until(() => inVarrock() || inJail(bot.tile()), 8);
            }
            if (!inVarrock()) fail(`varrock teleport (at ${JSON.stringify(bot.tile())})`);
            for (let k = 0; k < 3 && !ok && !jailed(); k++) { opLocGo(bot, locAt(1317, 3177, 3506), 1); bot.queueFlush(); ok = await drive(bot, () => (cheb(bot.tile(), { x: 2543, z: 3168 }) <= 4 && !inDialog(bot)) || jailed(), [/^Yes please\.$/], 60) && !jailed(); }
            if (!ok && jailed()) log(bot, t0, `fix 375: jailed after the Varrock teleport (a late knockout) at ${JSON.stringify(bot.tile())}: escape and cast again (round ${r + 1})`);
        }
        if (!ok) fail('young tree');
        ok = false;
        for (let k = 0; k < 3 && !ok; k++) { opLocGo(bot, locAt(1294, 2543, 3168), 1); bot.queueFlush(); ok = await drive(bot, () => cheb(bot.tile(), { x: 2461, z: 3444 }) <= 4 && !inDialog(bot), [/^Where can I go\?$/, /^Gnome stronghold\.$/], 40); }
        if (!ok) fail('village tree -> stronghold');
        at('stronghold');
    }
    if (from('reward')) {
        // S47 Narnode (>= 3 free slots) -> coins + diamonds, quest complete (queued); S48 Daero: training option 2
        // fix 310a: the carried scimitar can cost one more slot here: drop up to 3 spent quest items (was 1) until 3 are free
        for (let k = 0; k < (SCIM_ON ? 3 : 1) && bot.free() < 3; k++) { const junk = bot.inv().find(x => [o2('mm_gnome_royal_seal'), o2('mm_amulet_of_monkey_speak'), o2(GREEGREE)].includes(x.obj)); if (!junk) break; const f0 = bot.free(); bot.dropItem(junk.obj, junk.slot); bot.queueFlush(); await bot.tick(1); if (SCIM_ON) await bot.until(() => bot.free() > f0, 3); }
        // session 11 fix 271 MM_REWARD_RESUME (qyj03: 'narnode-reward dialog' x6; the 1st try got the qp, then daero-training
        // failed; every retry re-read qp0 AFTER the quest was complete, so 'qp > qp0' could never come true and Narnode only
        // said 'Good of you to stop by' (mm_narnode.rs2:2-8)): a resume at 'reward' reads the journal first ('QUEST COMPLETE'
        // = skip Narnode; 'enrolled in the Royal Guard training' = skip Daero too), Narnode's post-quest line also counts as
        // done, the queued complete chat is paged out before the ladder, and Daero gets 2 tries. MM_REWARD_RESUME=0 reverts.
        const fix271 = process.env.MM_REWARD_RESUME !== '0';
        let completeJ = false, trainedJ = false;
        if (fix271 && stage === 'reward') {
            const j = await readJournal(bot, 'mm');
            completeJ = j.ok && /QUEST COMPLETE/i.test(j.text);
            trainedJ = j.ok && /enrolled\s+in\s+the\s+Royal\s+Guard\s+training/i.test(j.text);
            log(bot, t0, `[journal] mm reward resume: ${j.ok ? `complete ${completeJ}, trained ${trainedJ}` : 'UNREADABLE'} (${j.ticks} t)`);
        }
        const postComplete = () => [...bot.ifText.values()].some(t => /Good of you to stop by|How fares the kingdom today/.test(t));
        const narnodeDone = () => completeJ || postComplete();
        if (!completeJ) await trunkTo(0);
        const qp0 = bot.getVarp(101);
        // Two talks: at mm_defeated_demon the first one only
        // reports and points us to Daero (mm_narnode.rs2:14-40, no fall-through to mm_narnode_reward); the reward (and the qp)
        // comes on the next talk. talkTo re-ops only while no dialog has opened, so it waited out the first talk for 120 t.
        const reported = () => [...bot.ifText.values()].some(t => /mandatory training programme|in charge of the training programme/.test(t));
        // session 9 (allchaos qu05m: 'narnode-report dialog' with a crowd trade's texts on screen, then every resume went back to
        // 'demon' and the sigil): a report talk that did not show its line is not fatal: the reward talk (done = quest points)
        // follows anyway. MM_REPORT_SOFT=0 reverts.
        if (process.env.MM_REPORT_SOFT === '0') await talkTo(NARNODE, NARNODE_AT, 0, [/.*/], () => (bot.getVarp(101) > qp0 || reported()) && !inDialog(bot), 'narnode-report', 120);
        else if (!completeJ) {
            try { await talkTo(NARNODE, NARNODE_AT, 0, [/.*/], () => (bot.getVarp(101) > qp0 || reported() || (fix271 && postComplete())) && !inDialog(bot), 'narnode-report', 120); }
            catch (e) { log(bot, t0, `narnode-report not confirmed (${(e as Error).message.slice(0, 80)}): on to the reward talk`); bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        }
        if (!fix271) {
            if (!(bot.getVarp(101) > qp0)) await talkTo(NARNODE, NARNODE_AT, 0, [/.*/], () => bot.getVarp(101) > qp0 && !inDialog(bot), 'narnode-reward', 120);
            await closeMain();
            await trunkTo(1);
            const def0 = bot.stat('defence').xp;
            await talkTo(DAERO, DAERO_BAR, 1, [/^Focus on improving attack and defence techniques\.\.\.$/], () => bot.stat('defence').xp > def0 && !inDialog(bot), 'daero-training', 120);
            await closeMain();
            m.ok = bot.stat('defence').xp > def0;
        } else {
            if (!narnodeDone() && !(bot.getVarp(101) > qp0)) {
                // a reward that was given but whose queued quest-complete script waits behind an open modal (qyj01): close, give it 3 t
                bot.closeModal(); bot.queueFlush(); await bot.until(() => bot.getVarp(101) > qp0, 3);
            }
            if (!narnodeDone() && !(bot.getVarp(101) > qp0)) await talkTo(NARNODE, NARNODE_AT, 0, [/.*/], () => (bot.getVarp(101) > qp0 || postComplete()) && !inDialog(bot), 'narnode-reward', 120);
            // the quest-complete scroll + the queued 'sign up for training' chat (mm_narnode.rs2 mm_complete_dialogue) play out
            // HERE, not on the way to Daero, where they ate the Daero talk (qyj03, INFERRED): page them until 4 t quiet (<= 24 t)
            for (let k = 0, q = 0; k < 24 && q < 4; k++) {
                if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); q = 0; }
                else if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); q = 0; }
                else q++;
                await bot.tick(1);
            }
            await closeMain();
            failHook('mm-reward-got');   // TEST mark (fix 271 proof): quest complete, Daero not yet talked to = the qyj03 state
            if (!trainedJ) {
                const def0 = bot.stat('defence').xp;
                for (let k = 0; k < 2 && !(bot.stat('defence').xp > def0); k++) {
                    try {
                        await trunkTo(1);
                        await talkTo(DAERO, DAERO_BAR, 1, [/^Focus on improving attack and defence techniques\.\.\.$/], () => bot.stat('defence').xp > def0 && !inDialog(bot), 'daero-training', 120);
                    } catch (e) {
                        if (k === 1) throw e;
                        log(bot, t0, `fix 271: daero-training try ${k + 1} failed (${(e as Error).message.slice(0, 80)}): close + re-talk`);
                        dismiss(bot); bot.queueFlush(); await bot.tick(2);
                    }
                }
                await closeMain();
                m.ok = bot.stat('defence').xp > def0;
            } else log(bot, t0, 'fix 271: journal says the Daero training is done: skip it');
        }
    }
    stopSafety();
    m.ticks = bot.tickCount - t0; m.ok = true;
    if (o.verbose) log(bot, t0, `done ${JSON.stringify(m)}`);
    return m;
}

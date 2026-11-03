// q-fremennik.ts — The Fremennik Trials (3 QP). CHEAT-FREE. Content: server/content/scripts/quests/quest_viking/scripts/*.rs2
// (cited as file:line without the viking_ prefix), area_vt/scripts/vt_council_workman.rs2, area_seers/scripts/poison_salesman.rs2,
// skill_crafting/scripts/spinning/spinning.rs2. Seven votes from seven trials, then Brundt (brundt:21-30, quest_viking.rs2:134-148).
// ROUTES.m (default, sim-proven): firecracker startsM east1 rock east2 seers altar votes peer brundt — the trial starts are merged
// into Sigmund's forward chain (startsM); ROUTES.a is the first build below. A/B + ticks: STATUS-fremennik.md.
// Stages (route a, in order):
//   firecracker beer on the council workman (2655,3592) -> firecracker (vt_council_workman.rs2:20-24).
//   starts      Brundt start (brundt:122-142); Manni start, take his keg (reveller:288-294), light the firecracker and put it
//               in the longhall pipe (reveller:240-285); start Olaf, Sigli (talisman), Thorvald, Swensen (+ the maze:
//               hallifred:117-160, 248-287), Sigmund (sigmund:52-59) — all before Sigmund's chain adds a menu to every npc.
//   east1       musical tree branch (WC 40, olaf:147-168), knife -> unstrung lyre (craft 40, :170-184), Lalli "Other human?"
//               (troll:65-69).
//   chain       Askeladden pet rock (askelapen:19-53); Sigmund's chain forward then back (13 npcs, "Ask about the Merchant's
//               trial"; Askeladden's note costs 5000 gp) -> Sigmund vote (sigmund:10-17).
//   east2       rock + cabbage + potato + onion in Lalli's cauldron (troll:105-137) -> golden fleece (troll:28-42); the Draugen
//               (talisman Locate, sigil:178-251; kill it) -> charged talisman.
//   seers       Camelot Teleport; low-alcohol keg 250 gp (poison_salesman.rs2:94-114); spin the fleece (Seers wheel), string the
//               lyre (fletch 25, olaf:228-239); bank the gear Thorvald's ladder refuses (thorvald:435-481).
//   altar       raw shark on the Fossegrimen altar 4141 (2626,3598) -> enchanted lyre (olaf:186-225).
//   votes       Sigli (talisman), longhall keg swap + Manni, backstage door + Play (olaf:264-274,466-503), Thorvald + Koschei
//               (unarmed; form 4 = honour death, thorvald:230-427).
//   peer        Peer's riddle door + water/disk puzzle (peer:40-1056) — last: his spell banks everything.
//   brundt      Brundt with 7 votes -> complete.
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { npc, npcsOf, navSync, situation, inDialog, locAt, opLocGo, opNpcGo, useOnLocGo, dismiss, tele, qp, pickupGo, type Tile } from '../../q-lib.js';
import { Ctx, QuestFail, go, walk, converse, sawMsg, dead, eatIfLow, nav, packStr, obstacle, talkTo, talkPick as talkPick0, useOnNpcGo, openDoorNear, locAny, type Item } from './lib-troll.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'The Fremennik Trials', dir: 'quest_viking', qp: 3 };
export const REQUIREMENTS = {
    quests: [] as string[],
    qp: 0,
    skills: {
        woodcutting: [40, 'branch from the musical tree (olaf:148-149)'],
        crafting: [40, 'unstrung lyre (olaf:175)'],
        fletching: [25, 'string the lyre (olaf:230)'],
        magic: [45, 'Camelot Teleport (the Seers trip)'],
    } as Record<string, [number, string]>,
    start: { x: 2757, z: 3478, level: 0 },   // Camelot Teleport landing
    end: { x: 2659, z: 3669, level: 0 },     // Brundt
};
export const SUPPLY: Item[] = [
    { name: 'coins', n: 5300 }, { name: 'beer', n: 1 }, { name: 'tinderbox', n: 1 }, { name: 'rune_axe', n: 1 }, { name: 'knife', n: 1 },
    { name: 'raw_shark', n: 1 }, { name: 'cabbage', n: 1 }, { name: 'potato', n: 1 }, { name: 'onion', n: 1 },
    { name: 'lawrune', n: 1 }, { name: 'airrune', n: 5 }, { name: 'shark', n: 6 }, { name: '4dose2attack', n: 1 }, { name: '4dose2strength', n: 1 },
];
export const STAGES = ['firecracker', 'starts', 'east1', 'chain', 'east2', 'seers', 'altar', 'votes', 'peer', 'brundt', 'startsM', 'rock'] as const;
/** Route A (first build): starts, Lalli, chain in Rellekka, Lalli again. Route M (default): the trial starts merged into Sigmund's
 *  forward chain (one Rellekka loop), Lalli, back for the rock only, Lalli again (A/B: STATUS-fremennik.md). */
export const ROUTES: Record<string, Array<typeof STAGES[number]>> = {
    a: ['firecracker', 'starts', 'east1', 'chain', 'east2', 'seers', 'altar', 'votes', 'peer', 'brundt'],
    m: ['firecracker', 'startsM', 'east1', 'rock', 'east2', 'seers', 'altar', 'votes', 'peer', 'brundt'],
};
export interface FremOpts { log?: boolean; from?: string; to?: string; route?: string }

const N = { olaf: 1269, lalli: 1270, draugen: 1279, sigli: 1281, sigmund: 1282, swensen: 1283, manni: 1286, workman: 1287, peer: 1288,
    thorvald: 1289, brundt: 1294, askeladden: 1295, thora: 1300, yrsa: 1301, fisherman: 1302, skulgrimen: 1303, sailor: 1304, salesman: 820 };
const AT: Record<string, Tile> = {
    olaf: { x: 2673, z: 3682 }, lalli: { x: 2770, z: 3624 }, sigli: { x: 2660, z: 3655 }, sigmund: { x: 2641, z: 3682 }, swensen: { x: 2646, z: 3662 },
    manni: { x: 2660, z: 3671 }, workman: { x: 2655, z: 3594 }, peer: { x: 2634, z: 3670 }, thorvald: { x: 2666, z: 3691 }, brundt: { x: 2659, z: 3671 },
    askeladden: { x: 2658, z: 3662 }, thora: { x: 2662, z: 3675 }, yrsa: { x: 2625, z: 3677 }, fisherman: { x: 2641, z: 3697 },
    skulgrimen: { x: 2663, z: 3692 }, sailor: { x: 2629, z: 3691 },
};
const BECOME = /^Ask about becoming a Fremennik$/, MERCHANT = /^Ask about the Merchant's trial$/, YES = /^Yes$/;

export async function run(bot: SpeedBot, o: FremOpts = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    const c = new Ctx(bot, 'fremennik', o);
    await nav();
    bot.holdDialogs = true;
    const qp0 = qp(bot); QP0 = qp0;
    c.startEater();
    try {
        const route = ROUTES[o.route ?? 'm'] ?? c.fail(`unknown route ${o.route}`);
        const from = route.indexOf((o.from ?? 'firecracker') as typeof STAGES[number]);
        if (from < 0) c.fail(`stage ${o.from} not in route ${o.route ?? 'm'}`);
        for (const st of route.slice(from)) {
            if (dead(bot)) c.fail('died');
            await STEP[st](c);
            c.mark(st);
            failHook(st);
            if (st === o.to) return { ok: false, ticks: c.t, msg: `stopped after ${st} (probe); marks ${JSON.stringify(c.marks)}` };
        }
        const done = () => qp(bot) >= qp0 + QUEST.qp || bot.count('viking_helmet') > 0;
        if (!(await bot.until(done, 20))) c.fail(`no completion observable (qp ${qp0} -> ${qp(bot)})`);
        return { ok: true, ticks: c.t, msg: `qp ${qp0} -> ${qp(bot)}; marks ${JSON.stringify(c.marks)}` };
    } catch (e) {
        if (!(e instanceof QuestFail)) throw e;
        return { ok: false, ticks: c.t, msg: e.message };
    } finally { c.stopEater(); }
}

const has = (bot: SpeedBot, name: string) => bot.count(name) > 0;
let QP0 = 0;
const DEBUG = !!(globalThis as any).process?.env?.FREM_DEBUG;
const qpUp = (bot: SpeedBot) => qp(bot) >= QP0 + QUEST.qp;

/** Open a closed door (by its closed id) at a known tile if it is still closed (chaos engines randomise door states; the walker
 *  stalls on some, e.g. the Seers spinning-wheel house door loc_1530 2716,3472, sim tf7). */
async function openDoorAt(c: Ctx, id: number, x: number, z: number, level = 0): Promise<void> {
    const bot = c.bot, d = locAny(id, x, z, level);
    if (!doorClosed(bot, d)) return;
    if (cheb(bot.tile(), d) > 12) await walk(bot, { x, z }, null, () => cheb(bot.tile(), d) <= 3 || !doorClosed(bot, d), { near: 3, maxTicks: 300 });
    for (let k = 0; k < 4 && doorClosed(bot, d); k++) { opLocGo(bot, d, 1); await bot.until(() => !doorClosed(bot, d), 4 + cheb(bot.tile(), d)); }
}
/** Door-table doors: the live door tracker (zone LOC_DEL / LOC_ADD_CHANGE, sdk/navgrid/door-tracker.ts) is the truth; doors
 *  outside the table that loc_change in place (fur doors): the live loc override. */
function doorClosed(bot: SpeedBot, d: { id: number; x: number; z: number; level: number }): boolean {
    const t = (bot as any).doorTracker?.isOpen(d.level, d.x, d.z) as boolean | undefined;
    return t === undefined ? bot.locAlive(d) : !t;
}
/** Use a held item on a loc until it is gone from the pack (walks next to the loc first: a far OPLOCU is discarded). */
async function useOnLoc(c: Ctx, item: string, l: { id: number; x: number; z: number; level?: number }, done: () => boolean, label: string, maxTries = 4): Promise<void> {
    const bot = c.bot, loc = locAny(l.id, l.x, l.z, l.level ?? 0);
    if (cheb(bot.tile(), loc) > 6) await walk(bot, { x: loc.x, z: loc.z }, null, () => cheb(bot.tile(), loc) <= 3, { near: 3, maxTicks: 400 });
    for (let k = 0; k < maxTries && !done(); k++) {
        if (inDialog(bot)) { dismiss(bot); await bot.tick(1); }
        useOnLocGo(bot, item, loc);
        await bot.until(() => done() || inDialog(bot), 6 + cheb(bot.tile(), loc));
    }
    if (!done()) c.fail(`${label}: use ${item} on loc ${l.id}`);
}
/** Lalli's cauldron 4149 (2772,3623): any of rock/cabbage/potato/onion goes in whenever %viking > 0 (troll:95-127). */
async function stew(c: Ctx, items: string[]): Promise<void> {
    for (const it of items) if (has(c.bot, it)) await useOnLoc(c, it, { id: 4149, x: 2772, z: 3623 }, () => !has(c.bot, it), 'cauldron');
    dismiss(c.bot);
}

/** Rellekka's fur doors (viking_fur_door 4250, area_vt/scripts/viking_door.rs2:1-6: loc_change in place for 500 ticks) are not
 *  in the navgrid's door table, so the walker / opNpcGo stop at them (sim tf2: Yrsa's shop door 2627,3675). */
const FUR_DOORS: Tile[] = [[2627, 3656], [2627, 3675], [2638, 3652], [2655, 3654], [2664, 3652], [2665, 3702], [2671, 3652], [2671, 3665],
    [2672, 3675], [2677, 3690], [2678, 3665], [2682, 3685], [2683, 3679], [2683, 3680], [2684, 3673]].map(([x, z]) => ({ x: x!, z: z! }));
/** Fur-door truth. liveLocs goes STALE here: a zone reset (UPDATE_ZONE_FULL_FOLLOWS on re-entering view) drops the 500-tick
 *  revert, so an "open" entry can outlive the door (sim tf34). Truth = the zone events we saw ourselves: open while < 480 ticks
 *  since our own open was confirmed by a LOC_ADD_CHANGE to the open id 4251. */
const FUR_OPEN = new Map<string, number>(), FUR_EVT = new Map<string, { id: number; tick: number }>();
function hookFur(bot: SpeedBot): void {
    if ((bot as any).__furHook) return; (bot as any).__furHook = true;
    const prev = (bot as any).onLocZoneChange as ((l: number, x: number, z: number, id: number) => void) | undefined;
    (bot as any).onLocZoneChange = (l: number, x: number, z: number, id: number) => { prev?.(l, x, z, id); FUR_EVT.set(`${x},${z}`, { id, tick: bot.tickCount }); };
}
const furOpen = (bot: SpeedBot, d: Tile) => bot.tickCount - (FUR_OPEN.get(`${d.x},${d.z}`) ?? -9999) < 480;
async function openFurNear(c: Ctx, at: Tile, r = 6, force = false): Promise<boolean> {
    const bot = c.bot; hookFur(bot);
    if (!force && reachable(bot, at)) return false;
    const d = FUR_DOORS.filter(t => cheb(t, at) <= r).sort((a, b) => cheb(a, at) - cheb(b, at))[0];
    if (!d) { c.log(`fur door: none near (${at.x},${at.z})`); return false; }
    if (furOpen(bot, d)) return false;
    const l = locAny(4250, d.x, d.z, 0), k0 = `${d.x},${d.z}`;
    if (cheb(d, bot.tile()) > 15) await walk(bot, d, null, () => cheb(bot.tile(), d) <= 3, { near: 2, maxTicks: 200 });
    for (let k = 0; k < 3 && !furOpen(bot, d); k++) {
        const t0 = bot.tickCount;
        opLocGo(bot, l, 1);
        await bot.until(() => (FUR_EVT.get(k0)?.tick ?? -1) >= t0, 8 + cheb(d, bot.tile()));
        const e = FUR_EVT.get(k0);
        if (e && e.tick >= t0 && e.id === 4251) FUR_OPEN.set(k0, e.tick);   // else we just CLOSED an open door: op again
    }
    c.log(`fur door (${d.x},${d.z}) ${furOpen(bot, d) ? 'opened' : 'still closed'}`);
    return furOpen(bot, d);
}
/** Does an rsmod path (static collision: a closed fur door is a wall) end next to `at`? */
function reachable(bot: SpeedBot, at: Tile, detour = 0): boolean {
    const me = bot.tile();
    if (cheb(me, at) <= 1) return true;
    try {
        const pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, at.x, at.z, 500); const e = pts[pts.length - 1];
        if (!e || cheb(e, at) > 1) return false;
        if (!detour) return true;
        // and not a long way round (the hunt's steps: a river detour walked the bot away from the target, sim tf45)
        let len = 0, p: Tile = me; for (const q of pts) { len += cheb(p, q); p = q; }
        return len <= cheb(me, at) * detour + 4;
    } catch { return true; }
}
/** talkPick, opening a closed fur door near the npc first (and once more on a failed dialog). */
async function talkPick(c: Ctx, type: number, stand: Tile | null, answers: RegExp[], final: RegExp, label: string, extraDone: () => boolean = () => false): Promise<void> {
    const n = npc(c.bot, type), at = n ?? stand;
    // an npc right behind a fur door (Yrsa: 2627,3675): open it up front (sim tf23: the reachability test missed it -> ~150 t lost)
    if (stand && FUR_DOORS.some(t => cheb(t, stand) <= 3)) {
        await openFurNear(c, stand, 3, true);
        // and step inside: from the doorway tile every TALK was discarded once (sim tf32, Yrsa at 2626,3675, bot on the door tile)
        await walk(c.bot, stand, null, () => cheb(c.bot.tile(), stand) <= 1, { near: 1, maxTicks: 40 });
    }
    else if (at) await openFurNear(c, at, 5);
    try { await talkPick0(c, type, stand, answers, final, label, extraDone); c.log(`talk ${label}`); }
    catch (e) {
        // session 11: say where the npc and we stand (qx01m 'askeladden-note: dialog' left nothing to diagnose)
        if (e instanceof QuestFail) { const m = npc(c.bot, type), me = c.bot.tile(); c.log(`${label} failed: npc ${m ? `(${m.x},${m.z}) d ${m.d}` : 'not visible'}, me (${me.x},${me.z}), chat ${c.bot.chatModalId}`); }
        if (!(e instanceof QuestFail) || !at || !(await openFurNear(c, npc(c.bot, type) ?? at, 6, true))) throw e;
        await talkPick0(c, type, stand, answers, final, label, extraDone);
    }
}

/** musical tree 4142 (2738,3638): any usable axe, WC 40, a free slot (olaf:147-168); knife on the branch -> lyre (east1; 364d) */
async function makeLyre(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (has(bot, 'viking_unstrung_lyre')) return;
    await obstacle(c, { id: 4142, x: 2738, z: 3638 }, null, () => has(bot, 'viking_musical_tree_branch'), 'musical tree');
    for (let k = 0; k < 3 && !has(bot, 'viking_unstrung_lyre'); k++) {
        bot.useItemOnItem(objId('knife'), bot.slot('knife'), objId('viking_musical_tree_branch'), bot.slot('viking_musical_tree_branch')); bot.queueFlush();
        await bot.until(() => has(bot, 'viking_unstrung_lyre'), 4);
    }
    if (!has(bot, 'viking_unstrung_lyre')) c.fail('unstrung lyre');
}

const STEP: Record<typeof STAGES[number], (c: Ctx) => Promise<void>> = {
    firecracker: async c => {
        const bot = c.bot;
        if (has(bot, 'viking_firecracker') || has(bot, 'viking_firecracker_lit')) return;
        await go(c, AT.workman!, 'council workman', { near: 4, maxTicks: 400 });
        for (let k = 0; k < 4 && !has(bot, 'viking_firecracker'); k++) {
            const w = npc(bot, N.workman); if (!w) c.fail('council workman not visible');
            useOnNpcGo(bot, w!, 'beer');
            await bot.until(() => has(bot, 'viking_firecracker') || inDialog(bot), 8);
            if (inDialog(bot)) await converse(bot, () => has(bot, 'viking_firecracker') && !inDialog(bot), [], 10, 5);
        }
        if (!has(bot, 'viking_firecracker')) c.fail('no firecracker');
        dismiss(bot);
    },
    starts: async c => {
        const bot = c.bot;
        await talkPick(c, N.brundt, AT.brundt!, [/^Do you have any quests\?$/, /^Yes, I am interested\.$/, /^I want to become a Fremennik!$/], /^I want to become a Fremennik!$/, 'brundt-start');
        await talkPick(c, N.manni, AT.manni!, [BECOME, YES], YES, 'manni-start');
        await kegAndFirecracker(c);
        await talkPick(c, N.olaf, AT.olaf!, [BECOME, YES, /^I don't need a reminder$/], YES, 'olaf-start');
        await talkPick(c, N.thorvald, AT.thorvald!, [BECOME, YES], YES, 'thorvald-start');
        await talkPick(c, N.sigli, AT.sigli!, [BECOME, /^What's a Draugen\?$/, YES], YES, 'sigli-start', () => has(bot, 'viking_draugen_talisman_uncharged'));
        await talkPick(c, N.swensen, AT.swensen!, [BECOME, YES], YES, 'swensen-start');
        await maze(c);
        await talkPick(c, N.sigmund, AT.sigmund!, [BECOME, YES], YES, 'sigmund-start');
    },
    startsM: async c => {
        // session 11 (allchaos qx01m/qt44m/qs7m): (1) a retry resumed at 'startsM' re-talked Brundt, whose mid-quest menu has no
        // start option -> 'brundt-start: dialog'. On a retry / resume the quest JOURNAL (viking_journal.rs2) gives the chain stage
        // and the trial starts, and the held viking_* items the back-chain position: every sub-step already done is skipped.
        // FREM_STARTS_RESUME=0 reverts. (2) a forward talk can end without its stage (dialog cut after the MERCHANT click): every
        // later npc then gives the default answer and Askeladden only says "Nope, sorry buddy!" (askelapen:121) -> 240 t of
        // 'askeladden-note: dialog'. Before the note the journal is checked and the chain re-walked from where it really is
        // (FREM_CHAIN_CHECK=0 reverts).
        const bot = c.bot;
        let st: FremState | null = null;
        if (isResuming(bot) && process.env.FREM_STARTS_RESUME !== '0') st = await fremState(c);
        if (st?.sig === 15) { c.log('[resume] Sigmund vote already given: startsM done'); return; }
        const held = chainHeld(bot);
        if (held < 0) {
            await startsFwd(c, st);
            for (let pass = 0; pass < 2 && process.env.FREM_CHAIN_CHECK !== '0'; pass++) {
                const s2 = await fremState(c);
                if (!s2 || s2.sig >= 13 || chainHeld(bot) >= 0) break;
                c.log(`[chain] journal says Sigmund stage ${s2.sig} (want 13): re-walking the chain from there`);
                await startsFwd(c, s2);
            }
        } else c.log(`[resume] holding chain item ${CHAIN_ITEMS[held]}: skip the forward chain`);
        await chainNoteAndBack(c);
    },
    rock: async c => {
        const bot = c.bot;
        await talkPick(c, N.askeladden, AT.askeladden!, [BECOME], BECOME, 'askeladden-rock', () => has(bot, 'vt_useless_rock'));
        if (!has(bot, 'vt_useless_rock')) c.fail('no pet rock (Lalli first?)');
    },
    east1: async c => {
        await makeLyre(c);
        // Lalli: "Other human?" -> olaf_spoken_lalli (troll:65-69), which Askeladden's pet rock needs
        await talkPick(c, N.lalli, AT.lalli!, [/^Other human\?$/], /^Other human\?$/, 'lalli-1');
        await stew(c, ['cabbage', 'potato', 'onion']);   // the vegetables go in now (no gate, troll:95-127); only the rock waits
    },
    chain: async c => {
        const bot = c.bot;
        // Askeladden's pet rock ("Ask about becoming a Fremennik", askelapen:19-53)
        await talkPick(c, N.askeladden, AT.askeladden!, [BECOME], BECOME, 'askeladden-rock', () => has(bot, 'vt_useless_rock'));
        if (!has(bot, 'vt_useless_rock')) c.fail('no pet rock (Lalli first?)');
        // Sigmund's chain forward: each npc's "Ask about the Merchant's trial" from the exact previous stage
        const FWD: Array<keyof typeof N> = ['sailor', 'olaf', 'yrsa', 'brundt', 'sigli', 'skulgrimen', 'fisherman', 'swensen', 'peer', 'thorvald', 'manni', 'thora'];
        for (const who of FWD) await talkPick(c, N[who], AT[who]!, [MERCHANT], MERCHANT, `fwd-${who}`);
        await chainNoteAndBack(c);
    },
    east2: async c => {
        const bot = c.bot;
        // session 11 fix 364d (qx192m: the death in the hunt dropped the unstrung lyre too; the retry resumed here and would only
        // have failed at Seers' 'string the lyre'): make it again first (the tree is ungated, olaf:145-184). FR_DRG_REGET=0 reverts.
        if (process.env.FR_DRG_REGET !== '0' && !has(bot, 'viking_unstrung_lyre') && !has(bot, 'viking_strung_lyre')) { c.log('364d: no lyre held: musical tree again'); await makeLyre(c); }
        // the stone soup: pet rock + cabbage + potato + onion in Lalli's cauldron 4149 (2772,3623), then Lalli -> golden fleece
        await stew(c, ['vt_useless_rock', 'cabbage', 'potato', 'onion']);
        await talkPick(c, N.lalli, AT.lalli!, [], /^$/, 'lalli-fleece', () => has(bot, 'viking_golden_fleece'));
        if (!has(bot, 'viking_golden_fleece')) c.fail('no golden fleece');
        c.mark('fleece');
        await draugen(c);
        // from here to Koschei nothing attacks (Seers, the altar, Rellekka): eat only below 30% so we reach form 4 with low hp
        // (form 4 lasts ~2 ticks per hp, thorvald:351-379)
        c.stopEater(); c.startEater(0.3);
    },
    seers: async c => {
        const bot = c.bot;
        dismiss(bot);
        if (!(await tele(bot, 'camelot_teleport')).ok) c.fail('camelot teleport');
        c.mark('camelot');
        // spin the fleece upstairs (house door loc_1530 @ 2716,3472; ladder 1747 @ 2715,3470; wheel 2644 @ 2711,3471 L1), string
        // the lyre (spinning.rs2:17-28; the Rellekka wheel 4309 is Fremennik-only, :2-6)
        await openDoorAt(c, 1530, 2716, 3472);
        await obstacle(c, { id: 1747, x: 2715, z: 3470 }, null, () => bot.minusedlevel === 1, 'Seers ladder up');
        await useOnLoc(c, 'viking_golden_fleece', { id: 2644, x: 2711, z: 3471, level: 1 }, () => has(bot, 'viking_golden_wool'), 'spin the golden fleece');
        await obstacle(c, { id: 1746, x: 2715, z: 3470, level: 1 }, null, () => bot.minusedlevel === 0, 'Seers ladder down');
        for (let k = 0; k < 3 && !has(bot, 'viking_strung_lyre'); k++) {
            bot.useItemOnItem(objId('viking_golden_wool'), bot.slot('viking_golden_wool'), objId('viking_unstrung_lyre'), bot.slot('viking_unstrung_lyre')); bot.queueFlush();
            await bot.until(() => has(bot, 'viking_strung_lyre'), 4);
        }
        if (!has(bot, 'viking_strung_lyre')) c.fail('string the lyre (fletching 25)');
        c.mark('lyre');
        // low-alcohol keg (250 gp): "Talk about the Fremennik Trials" -> "Yes" (poison_salesman.rs2:57-114); west, on the way out
        const LOWALC = 'viking_low_alcahol_beerkeg';
        await openDoorAt(c, 1530, 2716, 3472);
        // two salesmen spawn (2695,3495) and (2737,3491) (m42_54.jm2); the west one failed once on chaos seed 6401 -> the east one
        const SALES = [/^Talk about the Fremennik Trials$/, YES];
        try { await talkPick(c, N.salesman, { x: 2695, z: 3497 }, SALES, /^$/, 'poison salesman', () => has(bot, LOWALC)); }
        catch (e) {
            if (!(e instanceof QuestFail)) throw e;
            c.log(`salesman west failed: ${(e as Error).message.slice(0, 200)} | ${situation(bot, 6).slice(0, 400)}`);
            await go(c, { x: 2736, z: 3491 }, 'salesman east', { near: 3, maxTicks: 200 });
            await talkPick(c, N.salesman, null, SALES, /^$/, 'poison salesman east', () => has(bot, LOWALC));
        }
        if (!has(bot, LOWALC)) c.fail('no low-alcohol keg');
    },
    altar: async c => {
        const bot = c.bot;
        await go(c, { x: 2627, z: 3600 }, 'Fossegrimen altar', { near: 2, maxTicks: 500 });
        const altar = locAny(4141, 2626, 3598, 0);
        for (let k = 0; k < 4 && !has(bot, 'viking_enchanted_strung_lyre'); k++) {
            useOnLocGo(bot, 'raw_shark', altar);
            await bot.until(() => has(bot, 'viking_enchanted_strung_lyre') || inDialog(bot), 8);
            if (inDialog(bot)) await converse(bot, () => has(bot, 'viking_enchanted_strung_lyre') && !inDialog(bot), [], 12, 5);
        }
        if (!has(bot, 'viking_enchanted_strung_lyre')) c.fail('Fossegrimen did not enchant the lyre');
        dismiss(bot);
    },
    votes: async c => {
        const bot = c.bot;
        // session 10 (a retry inside 'votes' re-asked votes already given: Manni / Olaf's lyre): on a retry / resume, the council
        // votes the quest JOURNAL lists (viking_journal.rs2 'I now have the <role>'s vote') are skipped. FREM_VOTES_RESUME=0 reverts.
        const V = { hunter: false, reveller: false, bard: false, warrior: false };
        if (isResuming(bot) && process.env.FREM_VOTES_RESUME !== '0') {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
            const j = await readJournal(bot, 'viking');
            if (j.ok) for (const [k, role] of [['hunter', 'Hunter'], ['reveller', 'Reveller'], ['bard', 'Bard'], ['warrior', 'Warrior']] as const) V[k] = new RegExp(`I now have the ${role}'s vote`).test(j.text);
            c.log(`[journal] viking votes: ${j.ok ? JSON.stringify(V) : 'UNREADABLE'} (${j.ticks} t)`);
        }
        // Sigli: the charged talisman in the pack (sigil:15-31)
        if (!V.hunter) {
        await talkPick(c, N.sigli, AT.sigli!, [BECOME], /^$/, 'sigli-vote', () => !has(bot, 'viking_draugen_talisman'));
        c.mark('sigli'); failHook('sigli');
        }
        if (!V.reveller) {
        // Manni: in the longhall (zone 2655-2662,3665-3681) swap the kegs, then drink against him (reveller:174-229)
        await go(c, { x: 2659, z: 3672 }, 'longhall', { near: 1, maxTicks: 300 });
        for (let k = 0; k < 3 && has(bot, 'viking_low_alcahol_beerkeg'); k++) {
            bot.useItemOnItem(objId('viking_beerkeg'), bot.slot('viking_beerkeg'), objId('viking_low_alcahol_beerkeg'), bot.slot('viking_low_alcahol_beerkeg')); bot.queueFlush();
            await bot.until(() => !has(bot, 'viking_low_alcahol_beerkeg'), 4);
        }
        if (has(bot, 'viking_low_alcahol_beerkeg')) c.fail('keg swap (firecracker placed?)');
        await talkPick(c, N.manni, AT.manni!, [BECOME, YES], YES, 'manni-vote');
        c.mark('manni'); failHook('manni');
        }
        if (!V.bard) {
        // a resume past Manni: into the longhall first (the backstage door is reached from inside it; qwb20 stood outside at 2667,3681)
        if (V.reveller) await go(c, { x: 2659, z: 3672 }, 'longhall (resume)', { near: 1, maxTicks: 300 });
        // Olaf: backstage door 4148 (2667,3683) with the enchanted lyre, then Play on the stage (olaf:264-274, 466-503)
        await obstacle(c, { id: 4148, x: 2667, z: 3683 }, null, () => bot.tile().x < 2667 && bot.tile().z >= 3682, 'backstage door');
        dismiss(bot);
        await go(c, { x: 2659, z: 3684 }, 'stage', { near: 1, maxTicks: 60 });
        let voted = false;
        const latch = () => (voted ||= /earned my vote/.test([...bot.ifText.values()].join(' ')));
        (await import('./lib-troll.js')).opHeld(bot, 'viking_enchanted_strung_lyre', 1);
        await converse(bot, () => latch() && !inDialog(bot), [], 120, 1);
        if (!voted) c.fail('no vote from Olaf');
        dismiss(bot);
        c.mark('olaf');
        // out the way we came: the backstage door again (from inside it is a plain open-and-close door, olaf:492-497)
        await obstacle(c, { id: 4148, x: 2667, z: 3683 }, null, () => bot.tile().x >= 2667, 'backstage door out');
        failHook('olaf');
        }
        if (!V.warrior) await koschei(c);
    },
    peer: async c => { await peer(c); },
    brundt: async c => {
        const bot = c.bot;
        // seven votes (%viking = 8): Brundt queues viking_quest_complete (brundt:21-30, quest_viking.rs2:134-148)
        await talkTo(c, N.brundt, AT.brundt!, [], [BECOME], () => bot.count('viking_helmet') > 0 || qpUp(bot), 'brundt-finish');
    },
};

async function kegAndFirecracker(c: Ctx): Promise<void> {
    const bot = c.bot;
        // Manni's keg (ground obj on the table, 2660,3676) — only once his trial is started (reveller:288-294)
        for (let k = 0; k < 4 && !has(bot, 'viking_beerkeg'); k++) { pickupGo(bot, 'viking_beerkeg', { x: 2660, z: 3676 }); await bot.until(() => has(bot, 'viking_beerkeg'), 8); dismiss(bot); }
        if (!has(bot, 'viking_beerkeg')) c.fail('Manni\'s keg');
        // session 11: no firecracker (lit or not) on a resume / chain re-walk = it is already in the pipe (only the pipe takes it)
        if (!has(bot, 'viking_firecracker') && !has(bot, 'viking_firecracker_lit') && process.env.FREM_STARTS_RESUME !== '0') { c.log('[resume] firecracker already in the pipe'); return; }
        // light the firecracker and put it in the longhall pipe end 4162 (2663,3674) (explodes 140-200 t after lighting)
        for (let k = 0; k < 3 && !has(bot, 'viking_firecracker_lit'); k++) {
            bot.useItemOnItem(objId('tinderbox'), bot.slot('tinderbox'), objId('viking_firecracker'), bot.slot('viking_firecracker')); bot.queueFlush();
            await bot.until(() => has(bot, 'viking_firecracker_lit'), 3);
        }
        if (!has(bot, 'viking_firecracker_lit')) c.fail('light the firecracker');
        await obstacle(c, { id: 4162, x: 2663, z: 3674 }, null, () => !has(bot, 'viking_firecracker_lit'), 'longhall pipe');
        dismiss(bot);
}
/** The quest state a client can read (session 11): the JOURNAL (viking_journal.rs2:28-170). sig = Sigmund chain stage
 *  (quest_viking.constant sigmund_*; 1 also stands for 2 = spoke_sailor, the journal shows no line for either). */
interface FremState { started: boolean; sig: number; olaf: boolean; sigli: boolean; thorvald: boolean; manni: boolean; swensen: boolean; maze: boolean }
const SIG_LINES: Array<[RegExp, number]> = [[/Merchant's vote/i, 15], [/Askeladden wants is some money/i, 13], [/The reveller is looking/i, 12],
    [/The warrior is looking/i, 11], [/The seer is looking/i, 10], [/The navigator is looking/i, 9], [/The fisherman is looking/i, 8],
    [/The armourer is looking/i, 7], [/The hunter is looking/i, 6], [/The chieftan wants/i, 5], [/The shopkeeper is looking/i, 4],
    [/The bard is looking/i, 3], [/The Merchant will vote/i, 1]];
async function fremState(c: Ctx): Promise<FremState | null> {
    const bot = c.bot;
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
    const j = await readJournal(bot, 'viking');
    if (!j.ok) { c.log('[journal] viking: UNREADABLE'); return null; }
    const t = j.text.replace(/\s+/g, ' ');
    const role = (r: string) => new RegExp(`${r} will vote|${r}'s vote`).test(t);
    const s: FremState = { started: !/I can start this quest/.test(t), sig: SIG_LINES.find(([re]) => re.test(t))?.[1] ?? 0,
        olaf: role('Bard'), sigli: role('Hunter'), thorvald: role('Warrior'), manni: role('Reveller'), swensen: role('Navigator'), maze: /Navigator's vote/.test(t) };
    c.log(`[journal] viking: ${JSON.stringify(s)} (${j.ticks} t)`);
    return s;
}
/** Sigmund's chain items in back-chain order: CHAIN_ITEMS[i] is swapped by BACK[i] (Sigmund takes the last). */
const CHAIN_ITEMS = ['viking_promissary_note2', 'viking_legendary_cocktail', 'viking_champion_token', 'viking_promissary_note3', 'viking_weather_forecast',
    'viking_another_map', 'viking_unique_fish', 'viking_bowstring', 'viking_map_to_hunting_grounds', 'viking_promissary_note', 'viking_new_boots',
    'viking_song', 'viking_rare_flower'];
const BACK: Array<keyof typeof N> = ['thora', 'manni', 'thorvald', 'peer', 'swensen', 'fisherman', 'skulgrimen', 'sigli', 'brundt', 'yrsa', 'olaf', 'sailor'];
const chainHeld = (bot: SpeedBot) => process.env.FREM_STARTS_RESUME === '0' ? -1 : CHAIN_ITEMS.findIndex(n => has(bot, n));
/** startsM's forward half: Brundt + Sigmund starts, Sigmund's chain forward to Thora with every other trial started on the way.
 *  st = the journal state (a retry / the chain check): sub-steps it shows done are skipped; null = do all. failHook marks
 *  'frem:<label>' after each sub-step (SR_FAIL_AT tests). */
async function startsFwd(c: Ctx, st: FremState | null): Promise<void> {
    const bot = c.bot;
    const sub = async (label: string, skip: boolean, f: () => Promise<void>) => {
        if (skip) { c.log(`[resume] skip ${label}`); return; }
        await f(); failHook(`frem:${label}`);
    };
    // chain step `who` moves sig from `at - 1` to `at` (sailor 1 -> 2 is invisible in the journal: redone, its answer is harmless)
    const fwd = (who: keyof typeof N, at: number) => sub(`fwd-${who}`, !!st && st.sig >= at, () => talkPick(c, N[who], AT[who]!, [MERCHANT], MERCHANT, `fwd-${who}`));
    await sub('brundt-start', !!st?.started, () => talkPick(c, N.brundt, AT.brundt!, [/^Do you have any quests\?$/, /^Yes, I am interested\.$/, /^I want to become a Fremennik!$/], /^I want to become a Fremennik!$/, 'brundt-start'));
    await sub('sigmund-start', !!st && st.sig >= 1, () => talkPick(c, N.sigmund, AT.sigmund!, [BECOME, YES], YES, 'sigmund-start'));
    // Sigmund's chain needs each npc in order (sigmund_spoke_* stages, quest_viking.constant); every other trial is started on
    // the way ("Ask about becoming a Fremennik" is the second option while the chain runs)
    await fwd('sailor', 3);
    await sub('olaf-start', !!st?.olaf, () => talkPick(c, N.olaf, AT.olaf!, [BECOME, YES, /^I don't need a reminder$/], YES, 'olaf-start'));
    await fwd('olaf', 3);
    await fwd('yrsa', 4);
    await fwd('brundt', 5);
    await sub('sigli-start', !!st?.sigli, () => talkPick(c, N.sigli, AT.sigli!, [BECOME, /^What's a Draugen\?$/, YES], YES, 'sigli-start', () => has(bot, 'viking_draugen_talisman_uncharged')));
    await fwd('sigli', 6);
    await fwd('skulgrimen', 7);
    await fwd('fisherman', 8);
    await fwd('swensen', 9);
    await sub('swensen-start', !!st?.swensen, () => talkPick(c, N.swensen, AT.swensen!, [BECOME, YES], YES, 'swensen-start'));
    await sub('maze', !!st?.maze, () => maze(c));
    await fwd('peer', 10);
    await sub('thorvald-start', !!st?.thorvald, () => talkPick(c, N.thorvald, AT.thorvald!, [BECOME, YES], YES, 'thorvald-start'));
    await fwd('thorvald', 11);
    await sub('manni-start', !!st?.manni, () => talkPick(c, N.manni, AT.manni!, [BECOME, YES], YES, 'manni-start'));
    await sub('keg', false, () => kegAndFirecracker(c));
    await fwd('manni', 12);
    await fwd('thora', 13);
}
async function chainNoteAndBack(c: Ctx): Promise<void> {
    const bot = c.bot;
        if (chainHeld(bot) < 0) {
        await talkPick(c, N.askeladden, AT.askeladden!, [MERCHANT, YES], YES, 'askeladden-note', () => has(bot, 'viking_promissary_note2'));
        if (!has(bot, 'viking_promissary_note2')) c.fail('no promissory note (5000 gp?)');
        failHook('frem:askeladden-note');
        }
        // back: each npc swaps the item you carry (checked before any menu); a resume starts at the npc that takes the held item
        const sig = () => bot.inv().filter(s => /^viking_/.test(objDebugName(s.obj))).map(s => s.obj).sort().join(',');
        const from = Math.max(0, chainHeld(bot));
        if (from > 0) c.log(`[resume] back chain from ${BACK[from] ?? 'sigmund'} (holding ${CHAIN_ITEMS[from]})`);
        for (const who of BACK.slice(from)) {
            const s0 = sig();
            await talkPick(c, N[who], AT[who]!, [MERCHANT], /^$/, `back-${who}`, () => sig() !== s0);
            if (sig() === s0) c.fail(`chain back: ${who} did not swap (pack ${packStr(bot)})`);
            failHook(`frem:back-${who}`);
        }
        const s1 = sig();
        await talkPick(c, N.sigmund, AT.sigmund!, [MERCHANT], /^$/, 'sigmund-vote', () => sig() !== s1);
    }

/** Thorvald's arena: ladder 4187 (2667,3694) op2 with no weapon/armour/runes; Koschei's forms 1-3 unarmed (they can kill: eat
 *  below 15 hp), form 4 (255 hp, max 1, every tick): take the hits until the honour death moves you out with the vote
 *  (thorvald:155-427). No Protect from Melee (it makes form 4's hits 0, :375-377). */
async function koschei(c: Ctx): Promise<void> {
    const bot = c.bot, FORMS = [1290, 1291, 1292, 1293];
    // the ladder refuses weapons/armour (worn or held), runes, arrows, logs, axes, pickaxes... (thorvald:435-481): unwield and drop
    // them at its foot (faster than any bank; the route carries nothing it needs after this)
    // session 11 fix 346 (qx144m 'fremennik FAILED ... died (Koschei)': the Draugen hunt spent ~1,230 t / 1,079 locates at
    // 2639,3624 among the viking wolves (npc 1330, cb 64, maps m41_56) and ate all 6 sharks; Koschei started at hp 24/94 with NO
    // food and form 3 (str 60) killed us. A form 1-3 death is real (thorvald:230-279). Healthy qx137/qx138 entered at 62-64 hp, out
    // of form 3 at 45-49): hp + food below FR_KOS_MIN (45) = fail clean up here; the retry banks (supply sharks) and resumes at
    // 'votes' with the given votes skipped (FREM_VOTES_RESUME). FR_KOS_GATE=0 reverts; FR_KOS_TEST=gate forces it on a 1st attempt.
    const { FOODS } = await import('./lib-troll.js');
    const foodHp = () => bot.inv().filter(x => FOODS.includes(objDebugName(x.obj))).reduce((a, x) => a + (/shark|manta|turtle/.test(objDebugName(x.obj)) ? 20 : 10), 0);
    if (process.env.FR_KOS_GATE !== '0') {
        const hp = bot.stat('hitpoints').cur, min = Number(process.env.FR_KOS_MIN ?? 45);
        if (hp + foodHp() < min || (process.env.FR_KOS_TEST === 'gate' && !isResuming(bot))) c.fail(`Koschei: hp ${hp} + food ${foodHp()} < ${min}: not going down (fix 346)`);
    }
    await go(c, { x: 2667, z: 3693 }, 'Thorvald ladder foot', { near: 1, maxTicks: 300 });
    const { unwieldAll, dropExcept } = await import('../../run-lib.js');
    const BAD = /axe|scimitar|sword|dagger|mace|warhammer|battleaxe|halberd|spear|claws|whip|staff|bow|arrow|bolt|dart|knife_thrown|javelin|helm|coif|hat|body|chainbody|platebody|top|legs|skirt|shield|defender|cape|cloak|gloves|gauntlet|vambraces|rune$|logs$/;   // route session 5: + gauntlet (Family Crest steel_gauntlets: armour_hands, thorvald:436; qs7m/qs11m stuck at the ladder)
    await unwieldAll(bot, BAD);
    await dropExcept(bot, new RegExp(`^(?!.*(${BAD.source})).*$|^(knife|tinderbox|viking_.*)$`));
    await obstacle(c, { id: 4187, x: 2667, z: 3694 }, null, () => bot.tile().z > 6400, 'Thorvald ladder', 2);
    c.stopEater();
    // Koschei spawns 20-70 ticks after the climb next to you (thorvald:157-185). Forms 1-3 (30/50/70 hp, str 20/40/60) fight with
    // the normal melee script and CAN kill; form 4 (255 hp/def, str 5, attackrate 1) hits ~0-1 every tick and the hit that takes you
    // to exactly 0 hp is the honour death: vote + teleport out at full hp (thorvald:381-427). So: eat only when a form 1-3 hit could
    // kill, never pray, and do not eat during form 4 (low hp = a short form 4).
    try {
        const end = bot.tickCount + 900;
        let lastAtk = -99, lastLog = -99, form = 0, atkForm = -1, hits = 0, dmg = 0, atks = 0, hpXp = bot.stat('hitpoints').baseXp;
        while (bot.tickCount < end && bot.tile().z > 6400) {
            if (dead(bot)) c.fail('died (Koschei)');
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
            const k = npcsOf(bot, FORMS)[0];
            const hx = bot.stat('hitpoints').baseXp; if (hx > hpXp) { hits++; dmg += (hx - hpXp) * 0.75; } hpXp = hx;
            if (k && FORMS.indexOf(k.type) + 1 !== form) { c.log(`form ${form} done: ${hits} hits, ${Math.round(dmg)} damage, ${atks} attack sends`); hits = 0; dmg = 0; atks = 0; form = FORMS.indexOf(k.type) + 1; c.log(`Koschei form ${form} (hp ${bot.stat('hitpoints').cur} att ${bot.stat('attack').cur} str ${bot.stat('strength').cur} pray ${bot.stat('prayer').cur} ustr ${bot.isPrayerActive('ultimatestrength' as any)})`); }
            if (k && k.type !== 1293) {
                if (bot.stat('hitpoints').cur <= SAFE[form - 1]!) eatIfLow(bot, 1);
                // session 11 fix 346b: no food left and one more form 1-3 hit (+7: the climb takes ~2 t) could kill = climb out
                // (viking_warrior_ladder_up 4188 @ 2672,10099 L2 -> 2666,3694 L0, thorvald:164-174) and fail clean: a death here is
                // real (items lost) and the arena tile has no bank route (qx144m 'no reachable bank'). FR_KOS_BAIL=0 reverts;
                // FR_KOS_TEST=bail bails at the first form on a first attempt.
                if (process.env.FR_KOS_BAIL !== '0' && ((foodHp() === 0 && bot.stat('hitpoints').cur <= SAFE[form - 1]! + 7) || (process.env.FR_KOS_TEST === 'bail' && !isResuming(bot)))) {
                    c.log(`Koschei form ${form}: hp ${bot.stat('hitpoints').cur}, no food: climbing out (fix 346b)`);
                    await obstacle(c, { id: 4188, x: 2672, z: 10099, level: 2 }, null, () => bot.tile().z < 6400, 'arena ladder up (fix 346b)');
                    c.fail(`Koschei: hp ${bot.stat('hitpoints').cur}, no food at form ${form}: climbed out (fix 346b)`);
                }
                boostPrayers(bot, true);
                drinkBoost(bot);
            } else if (k) boostPrayers(bot, false);
            // attack every form, form 4 too: left alone it stopped hitting back (sim tf11: 450 ticks at hp 14-18, no hits)
            // re-send only on a new form or every ATK_RESEND ticks: an OPNPC every 4 ticks restarted the unarmed swing (form 3 took
            // ~200 t instead of the ~65 the hit maths gives)
            if (k && (form !== atkForm || bot.tickCount - lastAtk >= ATK_RESEND)) { bot.opNpc(k.idx, 2); bot.queueFlush(); lastAtk = bot.tickCount; atkForm = form; atks++; }
            if (bot.tickCount - lastLog >= 30) { lastLog = bot.tickCount; c.log(`arena: form ${form} hp ${bot.stat('hitpoints').cur}`); }
            await bot.tick(1);
        }
        if (bot.tile().z > 6400) c.fail(`Koschei: still in the arena (form ${form})`);
        // the honour death lands on Thorvald's upper floor (1_41_57_43_44, thorvald:417): down viking_warrior_ladder_down 4189
        if (bot.minusedlevel === 1) await obstacle(c, { id: 4189, x: 2667, z: 3694, level: 1 }, null, () => bot.minusedlevel === 0, 'Thorvald ladder down');
    } finally { c.startEater(); }
}
/** Unarmed fight: the best strength + attack prayers the player has (Koschei drains prayer at form 4 anyway, thorvald:290-298;
 *  never Protect from Melee: form 4's hits must land, :375-377). */
function boostPrayers(bot: SpeedBot, on: boolean): void {
    const lv = bot.stat('prayer').level, cur = bot.stat('prayer').cur;
    const want = [lv >= 31 ? 'ultimatestrength' : lv >= 13 ? 'superhumanstrength' : lv >= 4 ? 'strengthburst' : '',
        lv >= 34 ? 'incrediblereflexes' : lv >= 16 ? 'improvedreflexes' : lv >= 7 ? 'clarity' : ''].filter(Boolean);
    let sent = false;
    for (const p of want) {
        if (on && cur > 0 && !bot.isPrayerActive(p as any)) { bot.activatePrayer(p as any); sent = true; }
        if (!on && bot.isPrayerActive(p as any)) { bot.deactivatePrayer(p as any); sent = true; }
    }
    if (sent) bot.queueFlush();
}
/** Super attack + super strength for the unarmed forms 1-3 (potions are not on the ladder's list, thorvald:435-481): one dose each
 *  when the boost has worn down to < +8. */
let lastDrink = -10;
function drinkBoost(bot: SpeedBot): void {
    if (bot.tickCount - lastDrink < 3) return;
    for (const [stat, re] of [['strength', /^[1-4]dose2strength$/], ['attack', /^[1-4]dose2attack$/]] as const) {
        const st = bot.stat(stat); if (st.cur >= st.level + 8) continue;
        const it = bot.inv().find(x => re.test(objDebugName(x.obj)));
        if (it) { bot.opHeld1(it.obj, it.slot); bot.queueFlush(); lastDrink = bot.tickCount; return; }
    }
}
const ATK_RESEND = Number((globalThis as any).process?.env?.FREM_ATK ?? 16);
/** Eat during forms 1-3 at or below this hp (their max hits ~3/5/7 at str 20/40/60 + a margin). */
const SAFE = [5, 8, 11];

/** The Draugen hunt: the talisman's Locate gives one of 8 directions to an invisible marker in one of 4 areas (sigil:196-251);
 *  within 4 tiles the Draugen spawns. Walk towards the area centre the direction points at, re-locate every ~10 tiles. */
async function draugen(c: Ctx): Promise<void> {
    const bot = c.bot, TAL = 'viking_draugen_talisman_uncharged';
    if (has(bot, 'viking_draugen_talisman')) return;
    // the target is an invisible-ish npc viking_draugen_safe (1280) spawned within 20 tiles of one of 4 forest points at the first
    // Locate (sigil:229-251); each Locate names the octant from you to it, and < 4 tiles spawns the Draugen (:192-212). Keep the 4
    // boxes (point +-20), clip them by every answer, walk at the nearest remaining box; walk straight at 1280 once it is in view.
    const START: Array<[number, number, number, number]> = [[2688, 3572], [2720, 3616], [2656, 3616], [2720, 3680]].map(([x, z]) => [x! - 20, x! + 20, z! - 20, z! + 20]);
    const AREA = [2600, 2780, 3530, 3720];
    let R = [...AREA];
    const HIST: Array<{ me: Tile; dx: number; dz: number }> = [];
    const DIRS: Record<string, [number, number]> = { 'north-west': [-1, 1], 'south-west': [-1, -1], 'north-east': [1, 1], 'south-east': [1, -1], east: [1, 0], west: [-1, 0], south: [0, -1], north: [0, 1] };
    const { opHeld } = await import('./lib-troll.js'), { msgsSince } = await import('../../q-lib.js');
    // session 9 (allchaos qu11m: 900 t without the kill, the retry found it in 11 locates): 1500 t (FREM_DRAUGEN_T)
    const end = bot.tickCount + Number(process.env.FREM_DRAUGEN_T ?? 1500);
    let locates = 0;
    // session 11 fix 364 (qx192m 'fremennik FAILED ... died (Draugen)', retry 'no Draugen talisman' -> STOPPED qp 92): the hunt
    // stood ~900 t on 2643,3620 (qx144m: 2639,3624, 1,079 locates in 1,230 t; 150 runs: median 26, p90 125) inside the viking
    // wolf spawns (npc 1330 cb 64, huntrange 1, cowardly = hunts cb <= 128; maps m41_56), ate all 6 sharks, and met the Draugen
    // at hp 7. The ~1 t loop: butterfly 1280 in view (map_findsquare_none, sigil:248: any tile) but the walk at it never moved
    // us, and the step walk below stops at once while 1280 is in view. The death dropped talisman + fleece + lyre.
    // 364a: hp + food < FR_DRG_MIN (30), no Draugen up = fail clean (alive: talisman + fleece stay, the retry banks sharks and
    // resumes 'east2'). FR_DRG_GATE=0 reverts. 364b: a butterfly walk that moved us < 2 tiles or got no closer = ignore 1280
    // for 60 t (Locate steering only). FR_DRG_FLY=0 reverts. 364c: no talisman held (lost on a death) = Sigli gives another at
    // sigli_started (sigil:42-51). FR_DRG_REGET=0 reverts. TEST (1st attempt only): FR_DRG_TEST=gate | fly | drop.
    const { FOODS } = await import('./lib-troll.js');
    const foodHp = () => bot.inv().filter(x => FOODS.includes(objDebugName(x.obj))).reduce((a, x) => a + (/shark|manta|turtle/.test(objDebugName(x.obj)) ? 20 : 10), 0);
    const test = isResuming(bot) ? '' : process.env.FR_DRG_TEST ?? '';
    let flyOff = -1, flyTest = test === 'fly';
    if (test === 'drop' && has(bot, TAL)) { await bot.dropAll(TAL); await bot.tick(2); c.log('TEST: Draugen talisman dropped (364c)'); }
    if (!has(bot, TAL) && process.env.FR_DRG_REGET !== '0') {
        c.log('364c: no Draugen talisman held: Sigli gives another');
        await talkPick(c, N.sigli, AT.sigli!, [BECOME], /^$/, 'sigli-again', () => has(bot, TAL));
        if (!has(bot, TAL)) c.fail('no Draugen talisman (Sigli gave none: pack full?)');
    }
    while (bot.tickCount < end && !has(bot, 'viking_draugen_talisman')) {
        if (dead(bot)) c.fail('died (Draugen)');
        const d = npcsOf(bot, [N.draugen])[0];
        if (!d && process.env.FR_DRG_GATE !== '0') {
            const hp = bot.stat('hitpoints').cur, min = Number(process.env.FR_DRG_MIN ?? 30);
            if (hp + foodHp() < min || test === 'gate') c.fail(`Draugen hunt: hp ${hp} + food ${foodHp()} < ${min} after ${locates} locates at ${bot.tile().x},${bot.tile().z}: out (fix 364)`);
        }
        if (d) {   // fight (melee; it only answers to you, sigil:142-153)
            bot.opNpc(d.idx, 2); bot.queueFlush();
            await bot.until(() => npcsOf(bot, [N.draugen]).length === 0 || has(bot, 'viking_draugen_talisman'), 4);
            continue;
        }
        const fly = npcsOf(bot, [1280])[0];
        if (fly && cheb(fly, bot.tile()) > 2 && bot.tickCount >= flyOff) {
            const d0 = cheb(fly, bot.tile()), me0 = bot.tile();
            if (!flyTest) await walk(bot, { x: fly.x, z: fly.z }, null, () => cheb(bot.tile(), npcsOf(bot, [1280])[0] ?? fly) <= 2, { near: 2, maxTicks: 30 });
            const d1 = cheb(npcsOf(bot, [1280])[0] ?? fly, bot.tile());
            if (process.env.FR_DRG_FLY !== '0' && d1 > 2 && (flyTest || cheb(bot.tile(), me0) < 2 || d1 >= d0)) {
                flyOff = bot.tickCount + 60; flyTest = false;
                c.log(`364b: butterfly (${fly.x},${fly.z}) d ${d0} -> ${d1}, moved ${cheb(bot.tile(), me0)}: Locate steering for 60 t (hp ${bot.stat('hitpoints').cur}, food ${foodHp()}, ${locates} locates)`);
            }
        }
        if (!has(bot, TAL)) c.fail('no Draugen talisman');
        const since = bot.tickCount;
        opHeld(bot, TAL, 1); locates++;
        await bot.until(() => sawMsg(bot, /talisman guides you|Draugen is here/, since), 4);
        const msgs = msgsSince(bot, since);
        if (msgs.some(t => /moved elsewhere/.test(t))) HIST.length = 0;
        const msg = msgs.find(t => /talisman guides you|Draugen is here/.test(t)) ?? '';
        if (/Draugen is here/.test(msg)) { await bot.until(() => npcsOf(bot, [N.draugen]).length > 0, 4); continue; }
        const m = /guides you (north-west|south-west|north-east|south-east|east|west|south|north)/.exec(msg);
        if (!m) { await bot.tick(1); continue; }
        const [dx, dz] = DIRS[m[1]!]!, me = bot.tile();
        // R: everything the answers allow (the butterfly npc WANDERS: sim tf27 found it just outside its spawn box, so the boxes only
        // steer; an empty R restarts from this answer alone)
        const clip = (b: number[], h: { me: Tile; dx: number; dz: number } = { me, dx, dz }) => {
            const { me, dx, dz } = h;
            if (dx > 0) b[0] = Math.max(b[0]!, me.x + 1); else if (dx < 0) b[1] = Math.min(b[1]!, me.x - 1); else { b[0] = Math.max(b[0]!, me.x - 1); b[1] = Math.min(b[1]!, me.x + 1); }
            if (dz > 0) b[2] = Math.max(b[2]!, me.z + 1); else if (dz < 0) b[3] = Math.min(b[3]!, me.z - 1); else { b[2] = Math.max(b[2]!, me.z - 1); b[3] = Math.min(b[3]!, me.z + 1); }
            return b[0]! <= b[1]! && b[2]! <= b[3]!;
        };
        // only the last 4 answers count (it keeps moving), and a flip among them = it is a few tiles away: step 2-3 straight at it
        HIST.push({ me, dx, dz }); if (HIST.length > 4) HIST.shift();
        R = [...AREA]; for (const h of HIST.slice().reverse()) { const t = [...R]; if (!clip(t, h)) break; R = t; }
        const flip = HIST.length >= 2 && HIST.slice(-3).some(h => h.dx !== dx || h.dz !== dz);
        const isect = (a: number[], b: number[]) => [Math.max(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[2]!, b[2]!), Math.min(a[3]!, b[3]!)];
        const near = (b: number[]) => ({ x: Math.min(Math.max(me.x, b[0]!), b[1]!), z: Math.min(Math.max(me.z, b[2]!), b[3]!) });
        const cands = START.map(b => isect(R, [b[0] - 8, b[1] + 8, b[2] - 8, b[3] + 8])).filter(b => b[0]! <= b[1]! && b[2]! <= b[3]!);
        const box = (cands.length ? cands : [R]).sort((a, b) => cheb(near(a), me) - cheb(near(b), me))[0]!;
        const goal = flip ? { x: me.x + dx * 3, z: me.z + dz * 3 } : { x: Math.round((box[0]! + box[1]!) / 2), z: Math.round((box[2]! + box[3]!) / 2) };
        if (DEBUG) c.log(`locate ${m[1]} at ${me.x},${me.z} R ${JSON.stringify(R)} goal ${goal.x},${goal.z} msgs ${msgs.join('|').slice(0, 60)}`);
        // far: run 16 tiles at the goal; close: half way (re-locate often)
        const dist = cheb(goal, me), len = flip ? 3 : dist > 20 ? 16 : Math.max(3, Math.ceil(dist / 2));
        // the first REACHABLE tile on the way (forest/river: a blind step stalled 7 locates at 2645,3638 in sim tf40), turning
        // up to 90 degrees off the line if needed
        const ang0 = Math.atan2(goal.z - me.z, goal.x - me.x);
        let step: Tile = { x: me.x, z: me.z };
        // a short way first; boxed in (river/cliff, sim tf48: 300 t waiting at 2692,3644) -> accept a detour, then any path
        search: for (const det of [1.5, 3, 0]) for (const L of [len, Math.ceil(len / 2), 3]) for (const da of [0, 0.5, -0.5, 1, -1, 1.57, -1.57]) {
            const t = { x: me.x + Math.round(Math.cos(ang0 + da) * Math.min(L, dist || L)), z: me.z + Math.round(Math.sin(ang0 + da) * Math.min(L, dist || L)) };
            if (cheb(t, me) >= 2 && reachable(bot, t, det)) { step = t; break search; }
        }
        if (cheb(step, me) < 2) { await bot.tick(3); continue; }   // boxed in: let the butterfly wander (wanderrange 40, viking.npc:312)
        // 364b: while 1280 is ignored (flyOff) only the Draugen stops the step
        await walk(bot, step, null, () => cheb(bot.tile(), step) <= 1 || npcsOf(bot, bot.tickCount < flyOff ? [N.draugen] : [N.draugen, 1280]).length > 0, { near: 1, maxTicks: 25 });
    }
    if (!has(bot, 'viking_draugen_talisman')) c.fail('Draugen not killed');
    c.log(`Draugen: ${locates} locates`);
}

/** Swensen's maze: ladder 4158 (2644,3657) down, the seven fixed portals (hallifred:248-287), exit ladder 4160 (2665,10037). */
async function maze(c: Ctx): Promise<void> {
    const bot = c.bot;
    const PORTALS: Array<{ id: number; x: number; z: number; land: Tile }> = [
        { id: 4150, x: 2631, z: 10002, land: { x: 2642, z: 10018 } }, { id: 4151, x: 2639, z: 10015, land: { x: 2650, z: 10004 } },
        { id: 4152, x: 2656, z: 10004, land: { x: 2668, z: 10015 } }, { id: 4153, x: 2665, z: 10018, land: { x: 2630, z: 10029 } },
        { id: 4154, x: 2630, z: 10023, land: { x: 2653, z: 10034 } }, { id: 4155, x: 2656, z: 10037, land: { x: 2669, z: 10026 } },
        { id: 4156, x: 2666, z: 10029, land: { x: 2665, z: 10038 } },
    ];
    await obstacle(c, { id: 4158, x: 2644, z: 3657 }, null, () => bot.tile().z > 6400, 'maze ladder down');
    for (const p of PORTALS) await obstacle(c, p, null, () => cheb(bot.tile(), p.land) <= 2, `portal ${p.id}`);
    await obstacle(c, { id: 4160, x: 2665, z: 10037 }, null, () => bot.tile().z < 6400, 'maze exit ladder');
    // Swensen's vote speech (hallifred:146-160) opens a tick or two AFTER the climb (p_delay): wait for it, then continue it (sim
    // tf22: an unseen npcchat2 left open blocked every op for 400 ticks)
    await bot.until(() => inDialog(bot), 4);
    await converse(bot, () => !inDialog(bot), [], 16, 5);
    dismiss(bot);
    await leaveSwensen(c);
}

/** Out of Swensen's house: its door viking_abode_door 4247 (2645,3663) re-closes while you are in the maze, and the walker
 *  wedged inside for ~450 ticks (sim tf1). An OPLOC on the CLOSED id is a no-op when the door is already open. */
async function leaveSwensen(c: Ctx): Promise<void> {
    const bot = c.bot, out = { x: 2645, z: 3665 }, inside = () => bot.tile().z < 3664 && bot.tile().x >= 2642 && bot.tile().x <= 2652 && bot.tile().z >= 3656;
    if (!inside()) return;
    const door = locAny(4247, 2645, 3663, 0);
    for (let k = 0; k < 6 && inside(); k++) {
        if (inDialog(bot)) await converse(bot, () => !inDialog(bot), [], 10, 5);
        // always op: the tracker may hold a stale "open" (it re-closed while we were underground); an op on the closed id is
        // simply dropped by the server when the door is open
        if (k > 0 || doorClosed(bot, door)) { opLocGo(bot, door, 1); await bot.until(() => !doorClosed(bot, door), 6); }
        await walk(bot, out, null, () => !inside(), { near: 1, maxTicks: 12 });
    }
    if (inside()) c.fail(`stuck in Swensen's house | ${situation(bot, 6).slice(0, 700)}`);
}
export { objDebugName, npcsOf, locAt, opLocGo, opNpcGo, useOnLocGo, tele, walk, sawMsg, eatIfLow, packStr, talkTo, openDoorNear, locAny };

// ---- Peer the Seer (peer:1-233 start + bank, :280-408 riddle door, :409-1087 the house) ----
const WORN_INV = 1688;
function wornAny(bot: SpeedBot): boolean { const w = (bot as any).invs.get(WORN_INV) as { ids: Int32Array } | undefined; return !!w && [...w.ids].some(id => id > 0); }
const RIDDLE: Record<string, string> = { mage: 'MIND', tar: 'TREE', 'the well': 'LIFE', fish: 'FIRE', water: 'TIME', wizard: 'WIND' };
const COMBO = { modal: 10051, letter: [10095, 10096, 10097, 10098], minus: [10099, 10101, 10103, 10105], plus: [10100, 10102, 10104, 10106], enter: 10109 };

/** Op a loc that only exists at runtime (an opened cupboard/chest/trapdoor: loc_change in place): the static loc's shape, new id. */
async function opRuntime(c: Ctx, staticId: number, runtimeId: number, x: number, z: number, level: number, op: number, done: () => boolean, label: string, maxTicks = 40): Promise<void> {
    const bot = c.bot, l = { ...locAny(staticId, x, z, level), id: runtimeId } as ReturnType<typeof locAny>;
    const end = bot.tickCount + maxTicks; let last = -99;
    while (!done() && bot.tickCount < end) {
        if (inDialog(bot)) { dismiss(bot); await bot.tick(1); continue; }
        if (bot.tickCount - last >= 5) { opLocGo(bot, l, op); last = bot.tickCount; }
        await bot.tick(1);
    }
    if (!done()) c.fail(`${label} (runtime loc ${runtimeId} @ ${x},${z},${level})`);
}
/** Use one held item on another until `done`. */
async function combine(c: Ctx, src: string, dst: string, done: () => boolean, label: string): Promise<void> {
    const bot = c.bot;
    for (let k = 0; k < 4 && !done(); k++) {
        if (!has(bot, src) || !has(bot, dst)) break;
        // the engine runs [opheldu,<one of the two>] with last_useitem = the other; which one is "used" was wrong once (bucket on
        // jug ran the bucket's script: "The jug is empty"), so alternate the order
        const [a, b] = k % 2 === 0 ? [dst, src] : [src, dst];
        bot.useItemOnItem(objId(a), bot.slot(a), objId(b), bot.slot(b)); bot.queueFlush();
        await bot.until(done, 3);
    }
    if (!done()) c.fail(`${label}: ${src} on ${dst} (pack ${packStr(bot)})`);
}

async function peer(c: Ctx): Promise<void> {
    const bot = c.bot, L2 = 2;
    // start: "Yes" (riddle drawn, peer:20-26), then "Yes" to bank everything worn + held (peer:163-233): the house needs an empty
    // pack and nothing worn (door1, :290-294)
    const empty = () => bot.inv().length === 0 && !wornAny(bot);
    await talkTo(c, N.peer, AT.peer!, [], [YES, BECOME], () => empty() && !inDialog(bot), 'peer-start');
    c.mark('peer-bank');
    // the riddle door: "Read the riddle" shows it in two mesboxes, then the combination lock opens (peer:296-375)
    const door1 = locAny(4165, 2631, 3667, 0);
    let word = '';
    const scan = () => { if (!word) { const m = /My first is in (mage|tar|the well|fish|water|wizard)\b/.exec([...bot.ifText.values()].join(' ')); if (m) word = RIDDLE[m[1]!]!; } return word; };
    for (let k = 0; k < 4 && bot.mainModalId !== COMBO.modal; k++) {
        if (!inDialog(bot)) { opLocGo(bot, door1, 1); await bot.until(() => inDialog(bot) || bot.mainModalId === COMBO.modal, 12); }
        await converse(bot, () => { scan(); return bot.mainModalId === COMBO.modal; }, [/^Read the riddle$/], 20, 1);
    }
    scan();
    if (bot.mainModalId !== COMBO.modal || !word) c.fail(`riddle door: modal ${bot.mainModalId} word '${word}'`);
    c.log(`riddle answer ${word}`);
    for (let i = 0; i < 4; i++) {
        const want = word.charCodeAt(i) - 65;
        for (let k = 0; k < 6; k++) {
            const cur = (bot.ifText.get(COMBO.letter[i]!) ?? 'A').charCodeAt(0) - 65;
            if (cur === want) break;
            const up = (want - cur + 26) % 26, n = Math.min(up <= 13 ? up : 26 - up, 6);
            bot.burst(Array.from({ length: n }, () => () => bot.ifButton(up <= 13 ? COMBO.plus[i]! : COMBO.minus[i]!)));
            await bot.until(() => (bot.ifText.get(COMBO.letter[i]!) ?? 'A').charCodeAt(0) - 65 !== cur, 3);
        }
    }
    const got = COMBO.letter.map(id => bot.ifText.get(id) ?? '?').join('');
    if (got !== word) c.fail(`combination shows ${got}, want ${word}`);
    const t0 = bot.tickCount;
    bot.ifButton(COMBO.enter); bot.queueFlush();
    if (!(await bot.until(() => sawMsg(bot, /solved the riddle/, t0), 4))) c.fail(`riddle ${word} not accepted`);
    c.mark('riddle');
    // in (an empty pack opens it), up the west ladder to the attic (L2)
    await obstacle(c, { id: 4165, x: 2631, z: 3667 }, null, () => bot.tile().z <= 3666 && bot.tile().z >= 3660, 'Peer door 1');
    await obstacle(c, { id: 4163, x: 2631, z: 3663 }, null, () => bot.minusedlevel === L2, 'Peer ladder up');
    const at = (id: number, x: number, z: number) => ({ id, x, z, level: L2 });
    // the heads put mesboxes up BEFORE the inv_add (peer:487-511): continue them (obstacle's dismiss would close and abort)
    const search = async (id: number, x: number, z: number, item: string) => {
        const l = locAny(id, x, z, L2);
        for (let k = 0; k < 4 && !has(bot, item); k++) {
            if (!inDialog(bot)) { opLocGo(bot, l, 1); await bot.until(() => inDialog(bot) || has(bot, item), 8 + cheb(bot.tile(), l)); }
            await converse(bot, () => has(bot, item), [], 12, 1);
        }
        if (!has(bot, item)) c.fail(`search ${item}`);
        if (inDialog(bot)) await converse(bot, () => !inDialog(bot), [], 6, 1);
    };
    // the two red disks: unicorn head (left eye, :487-498), bull head (plain disk, :500-511) + the red herring (bookcase :421-429)
    // cooked on the range -> red goop (:830-858) on the plain disk (:947-954)
    await search(4171, 2634, 3665, 'viking_red_herring');
    await search(4182, 2634, 3660, 'viking_uncoloured_wooden_coin');
    // the jug (chest: open, then search, :471-485) and the bucket (cupboard: open, then search, :765-787)
    await obstacle(c, at(4167, 2635, 3660), null, () => !bot.locAlive(at(4167, 2635, 3660)), 'jug chest open');
    await opRuntime(c, 4167, 4168, 2635, 3660, L2, 2, () => has(bot, 'viking_jug_empty'), 'jug chest search');
    await search(4181, 2632, 3660, 'viking_red_wooden_coin');
    await obstacle(c, at(4177, 2629, 3660), null, () => !bot.locAlive(at(4177, 2629, 3660)), 'cupboard open');
    await opRuntime(c, 4177, 4178, 2629, 3660, L2, 2, () => has(bot, 'viking_bucket_empty'), 'cupboard search');
    await useOnLoc(c, 'viking_red_herring', at(4172, 2629, 3663), () => has(bot, 'viking_red_splat'), 'range: herring');
    await combine(c, 'viking_red_splat', 'viking_uncoloured_wooden_coin', () => bot.count('viking_red_wooden_coin') >= 2, 'red goop on the disk');
    // 4 litres for the scales chest (:801-829): fill 5, pour into the 3 jug (5->2), empty the jug, pour (2->0, jug 2), fill 5,
    // top up the jug (5->4)
    const TAP = at(4176, 2629, 3661), DRAIN = at(4175, 2629, 3662);
    await useOnLoc(c, 'viking_bucket_empty', TAP, () => has(bot, 'viking_bucket_5'), 'tap 1');
    await combine(c, 'viking_bucket_5', 'viking_jug_empty', () => has(bot, 'viking_bucket_2'), 'bucket 5 -> jug');
    await useOnLoc(c, 'viking_jug_3', DRAIN, () => has(bot, 'viking_jug_empty'), 'drain');
    await combine(c, 'viking_bucket_2', 'viking_jug_empty', () => has(bot, 'viking_jug_2'), 'bucket 2 -> jug');
    await useOnLoc(c, 'viking_bucket_empty', TAP, () => has(bot, 'viking_bucket_5'), 'tap 2');
    await combine(c, 'viking_bucket_5', 'viking_jug_2', () => has(bot, 'viking_bucket_4'), 'bucket 5 -> jug 2');
    await useOnLoc(c, 'viking_bucket_4', at(4170, 2632, 3665), () => has(bot, 'viking_airtight_vase'), 'scales chest');
    await useOnLoc(c, 'viking_airtight_vase', TAP, () => has(bot, 'viking_airtight_vase_water'), 'tap: vase');
    c.mark('vase');
    // the mural is in the EAST ground-floor room (sim tf15: from the west room every OPLOCU was discarded): open the east trapdoor
    // (:1025-1033), climb down, both red disks -> the vase lid (:1006-1023), back up the east ladder 4164 (:413-415)
    await obstacle(c, at(4174, 2636, 3663), null, () => !bot.locAlive(at(4174, 2636, 3663)), 'east trapdoor open');
    await opRuntime(c, 4174, 4173, 2636, 3663, L2, 1, () => bot.minusedlevel === 0, 'east trapdoor down');
    const MURAL = { id: 4179, x: 2634, z: 3663, level: 0 };
    await useOnLoc(c, 'viking_red_wooden_coin', MURAL, () => bot.count('viking_red_wooden_coin') <= 1, 'mural disk 1');
    await useOnLoc(c, 'viking_red_wooden_coin', MURAL, () => has(bot, 'viking_vase_lid'), 'mural disk 2');
    await obstacle(c, { id: 4164, x: 2636, z: 3663 }, null, () => bot.minusedlevel === L2, 'Peer east ladder up');
    // lid on the water-filled vase, freeze it on the table (:741-763), melt the ice on the range -> the key (:830-858)
    await combine(c, 'viking_vase_lid', 'viking_airtight_vase_water', () => has(bot, 'viking_airtight_vase_with_lid_water'), 'vase lid');
    await useOnLoc(c, 'viking_airtight_vase_with_lid_water', at(4169, 2638, 3665), () => has(bot, 'viking_key_in_ice'), 'frozen table');
    await useOnLoc(c, 'viking_key_in_ice', at(4172, 2629, 3663), () => has(bot, 'viking_key'), 'range: key');
    c.mark('key');
    // east trapdoor (open it, then climb down, :1025-1033) and unlock door 2 from inside (:1035-1056) -> Peer's vote
    if (bot.locAlive(at(4174, 2636, 3663))) await obstacle(c, at(4174, 2636, 3663), null, () => !bot.locAlive(at(4174, 2636, 3663)), 'east trapdoor open 2');
    await opRuntime(c, 4174, 4173, 2636, 3663, L2, 1, () => bot.minusedlevel === 0, 'east trapdoor down 2');
    const t1 = bot.tickCount;
    await useOnLoc(c, 'viking_key', { id: 4166, x: 2636, z: 3667, level: 0 }, () => !has(bot, 'viking_key') || sawMsg(bot, /unlock the door/, t1), 'door 2');
    await converse(bot, () => !inDialog(bot), [], 12, 3);
}

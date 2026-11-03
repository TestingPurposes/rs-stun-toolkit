// legs/qp/f2p-a/fa-lib.ts — lane-local helpers for the f2p-a quest builders (Cook's Assistant, Sheep Shearer, The
// Restless Ghost, Demon Slayer, Gertrude's Cat). Quest code here is CHEAT-FREE; the only cheat path is `launch()`'s
// --sim setup (stats, prerequisite varps, supplies, teleport), which refuses a non-local LC_HOST.
//
// converse(): one robust npc conversation driver. The tick the first page is visible it sends a planned token burst
// (q-lib sendToks: RESUME / choice IF_BUTTON; a packet that does not apply is DROPPED by the engine, so a padded plan
// is safe), then answers adaptively (choices by text, pages by a resume burst), and re-talks if the conversation ends
// before `done()`. Every quest step gates on an observable (items, qp, position, dialog text, game messages).
import { SpeedBot, CHEATS, localSetup, objId, objDebugName, cheb, densify } from '../../../core.js';
import DOOR_STATES from '../../../../../../../sdk/navgrid/door-states.json';
import { readBotEnv, createLive } from '../../k-live.js';
import { useOnLocGo, levelUpOpen, pickupGo, situation, nav, npc, opNpcGo, locAt, opLocGo, navSync, turning, type NpcRef, inDialog, sendToks, dropAllOf, KIT_JUNK, qp, log, walkOp, msgsSince, routeNextTo as qRouteNextTo, pagesUntil as qPagesUntil, type FTok, type Tile } from '../../q-lib.js';

// the webclient tsconfig has no node/bun types (every framework launcher shows these as pre-existing errors)
declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(code?: number): never };

export type Item = { name: string; n: number };
export interface QuestDef { name: string; dir: string; qp: number }
export interface Requirements {
    quests: string[]; qp: number; skills: Record<string, [number, string]>;
    start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number };
}
export interface RunResult { ok: boolean; ticks: number; msg: string }

export class QuestFail extends Error {}
export const fail = (bot: SpeedBot, s: string): never => { console.log(`[fa] FAIL ${s} | ${situation(bot)}`); throw new QuestFail(`${s} at ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur}`); };

/** a named debug log with the quest's own tick origin */
export function mkLog(bot: SpeedBot, tag: string, on: boolean) {
    const t0 = bot.tickCount;
    return (s: string) => { if (on) console.log(`[${tag} +${String(bot.tickCount - t0).padStart(4)}] ${s}`); };
}

// ---------------------------------------------------------------------------------------------------------
// conversation
// ---------------------------------------------------------------------------------------------------------
export interface ConverseOpts {
    /** token burst sent the tick the first page is visible (padded R's are safe: a resume on a choice is dropped) */
    plan?: FTok[];
    /** choice answers in priority order (first regex matching an option's text wins) */
    answers?: RegExp[];
    /** the step is done (checked every tick) */
    done: () => boolean;
    /** walk here first if the npc is not within `near` tiles (or not visible) */
    stand?: Tile;
    near?: number;
    maxTicks?: number;
    /** times to (re)start the conversation before giving up */
    tries?: number;
    label?: string;
    /** use an item on the npc instead of Talk-to (OPNPCU) */
    useItem?: string;
    /** npc op (default 1 = Talk-to) */
    op?: number;
    /** a dialog is already open (e.g. started by a loc op): skip the first OPNPC */
    noOp?: boolean;
    /** extra tokens to append after the plan burst (e.g. a re-OPNPC that starts the next conversation) */
    after?: FTok[];
    log?: (s: string) => void;
    /** while true, do not (re)start the conversation (e.g. a scripted hand-in loop is running without a dialog) */
    wait?: () => boolean;
    /** choose the npc to talk to (default: the nearest of `type`); null = not now (checked every tick) */
    pick?: () => NpcRef | null;
}
export async function converse(bot: SpeedBot, type: number | number[], o: ConverseOpts): Promise<boolean> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, maxTicks = o.maxTicks ?? 300, tries = o.tries ?? 4;
    let starts = o.noOp ? 1 : 0, opTick = o.noOp ? t0 : -100, planSent = false, lastSig = '', lastClick = -99, lastOpen = o.noOp ? t0 : -1;
    while (!bot.disposed && bot.tickCount - t0 < maxTicks) {
        if (o.done()) return true;
        if (dead(bot)) fail(bot, `died in ${o.label ?? 'converse'}`);
        if (inDialog(bot)) {
            lastOpen = bot.tickCount;
            if (!planSent && o.plan?.length) { sendToks(bot, [...o.plan, ...(o.after ?? [])]); planSent = true; await bot.tick(1); continue; }
            const opts = bot.dialogOptions();
            if (opts.length && opts.some(x => x.text)) {
                const sig = opts.map(x => x.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 3) {
                    let hit = -1;
                    for (const re of o.answers ?? []) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                    if (hit < 0) { o.log?.(`${o.label}: unplanned choice [${opts.map(x => x.text).join(' | ')}]`); console.log(`[fa] ${o.label ?? 'converse'}: unplanned choice [${opts.map(x => x.text).join(' | ')}]`); }
                    else { lastSig = sig; lastClick = bot.tickCount; }
                }
            } else if (!opts.length) { for (let i = 0; i < 5; i++) bot.resumeDialogPage(); }
            bot.queueFlush();
            await bot.tick(1); continue;
        }
        // no dialog open: (re)start the conversation
        if (bot.tickCount - opTick >= 5 && bot.tickCount - lastOpen >= 1 && !o.wait?.()) {
            if (starts >= tries) break;
            const n = o.pick ? (npc(bot, type) && cheb(bot.tile(), npc(bot, type)!) <= (o.near ?? 12) ? o.pick() : npc(bot, type)) : npc(bot, type);
            if (o.pick && n && n.d <= (o.near ?? 12) && !o.pick()) { await bot.tick(1); continue; }
            if (!n || (o.stand && n.d > (o.near ?? 12))) {
                if (!o.stand) { await bot.tick(1); continue; }
                await bot.walkTo(o.stand.x, o.stand.z, { near: 2, maxTicks: Math.max(20, maxTicks - (bot.tickCount - t0)), log: false, closeDoors: true });
                if (!npc(bot, type)) { await bot.tick(1); continue; }
                // route runner: already at the stand with the npc in view but > near: walkTo returns at once, and
                // a bare `continue` spun the event loop forever (both route accounts froze, sims qrd6/qrd7): wait a tick
                await bot.tick(1);
                continue;
            }
            // a retry (the last op opened no dialog): the npc may stand behind a door the rsmod path treats as open; core
            // walkTo opens closed doors on its route (Traiborn behind the tower L1 door 1536 on a chaos engine)
            // a second retry walks onto the npc's own tile: an adjacent npc can stand behind a wall (Rovin on palace L2, fa28),
            // and the static map lets us path onto its tile from the right side (opNpcGo steps off it again)
            if (starts > 0 && (cheb(bot.tile(), n) > 1 || starts >= 2)) { await bot.walkTo(n.x, n.z, { near: starts >= 2 ? 0 : 1, maxTicks: 60, log: false, closeDoors: true }); if (inDialog(bot) || o.done()) continue; }
            planSent = false; starts++;
            o.log?.(`${o.label}: op #${starts} -> npc ${n.type}@${n.x},${n.z} from ${JSON.stringify(bot.tile())}`);
            if (o.useItem) {
                const id = objId(o.useItem), slot = bot.slot(id);
                if (slot < 0) fail(bot, `${o.label}: ${o.useItem} not held`);
                routeNextTo(bot, n);
                bot.useItemOnNpc(n.idx, id, slot); bot.queueFlush();
            } else opNpcGo(bot, n, o.op ?? 1);
            opTick = bot.tickCount;
        }
        await bot.tick(1);
    }
    return o.done();
}

/** MOVE_OPCLICK to the tile before an npc (no op sent). MIGRATED q-lib routeNextTo (door-aware, wall-aware). */
export function routeNextTo(bot: SpeedBot, n: NpcRef): number { return qRouteNextTo(bot, n); }
/** journal-colour quest status ('NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'NOT_OBSERVABLE'); key = questlist key */
export function qStatus(bot: SpeedBot, key: string): string { return bot.questState(key).status; }
/** close any open chat/main modal (CLOSE_MODAL): in rev 289 an open chat page blocks movement */
export function closeChat(bot: SpeedBot): void { if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.chatModalId = -1; bot.mainModalId = -1; } }
/** continue every non-choice page (resume burst) until done(). MIGRATED q-lib pagesUntil (identical). */
export const pagesUntil = qPagesUntil;
/** the text of every chat-page IF_SETTEXT seen since `snap` (dialog observables) */
export function snapText(bot: SpeedBot): Map<number, string> { return new Map(bot.ifText); }
export function textSince(bot: SpeedBot, snap: Map<number, string>, re: RegExp): boolean {
    for (const [k, v] of bot.ifText) if (snap.get(k) !== v && re.test(v)) return true;
    return false;
}
/** a game message matching `re` arrived at or after tick `since` */
export const msgSince = (bot: SpeedBot, since: number, re: RegExp) => msgsSince(bot, since).some(t => re.test(t));

// ---------------------------------------------------------------------------------------------------------
// safety: eat, death
// ---------------------------------------------------------------------------------------------------------
const FOODS = ['shark', 'lobster', 'swordfish', 'monkfish', 'trout', 'salmon', 'tuna', 'cake', 'bread', 'shrimp', 'cooked_meat', 'cooked_chicken'];
/** eat any carried food when hp < `pct` of the hitpoints level (default 50%). Returns a stop function. */
export function eatWatch(bot: SpeedBot, pct = 0.5): () => void {
    let stop = false, last = -10;
    const ids = FOODS.map(f => { try { return objId(f); } catch { return -1; } }).filter(i => i > 0);
    (async () => {
        while (!stop && !bot.disposed) {
            const hp = bot.stat('hitpoints');
            if (hp.level > 0 && hp.cur === 0 && (bot as any).__faDied === undefined) { (bot as any).__faDied = bot.tickCount; console.log(`[fa] DIED at ${JSON.stringify(bot.pos())}`); }
            if (hp.cur > 0 && hp.cur < hp.level * pct && bot.tickCount - last >= 3 && !inDialog(bot)) {
                const s = bot.inv().find(x => ids.includes(x.obj));
                if (s) { bot.opHeld1(s.obj, s.slot); bot.queueFlush(); last = bot.tickCount; }
            }
            await bot.tick(1);
        }
    })();
    return () => { stop = true; };
}
/** died during this quest: hp 0 seen by eatWatch (sticky), or hp 0 right now */
export function dead(bot: SpeedBot): boolean { const h = bot.stat('hitpoints'); return (bot as any).__faDied !== undefined || (h.level > 0 && h.cur === 0); }

// ---------------------------------------------------------------------------------------------------------
// small actions
// ---------------------------------------------------------------------------------------------------------
// ---- open-door leaves ----------------------------------------------------------------------------------------------
// An OPEN door's leaf stands on the next tile and walls it off; the static planners have the door closed-but-passable, so a
// walk through such a doorway re-plans into the same wall and core walkTo falls back to LeanBot's traveller, which can burn
// the whole budget (Wizards' Tower cellar door 1530 (3111,9559) open on chaos seeds 4242/202: fa56, fa63). walkTo's
// closeDoors only runs when the walk RETURNS short. walkSafe() bounds each attempt and closes open leaves near us between.
let DOORS: Record<string, { state: string; op: number }> | null = null;
function doorDefs() {
    if (DOORS) return DOORS;
    DOORS = DOOR_STATES as unknown as Record<string, { state: string; op: number }>;
    return DOORS!;
}
/** close every OPEN door leaf within `radius` of us (route next to it + OPLOC), returns how many were closed */
export async function closeOpenDoorsNear(bot: SpeedBot, radius = 5): Promise<number> {
    const defs = doorDefs(), me = bot.tile(); let n = 0;
    for (const [key, id] of [...bot.liveLocs]) {
        const d = defs[String(id)]; if (!d || d.state !== 'open') continue;
        const [l, x, z] = key.split(',').map(Number);
        if (l !== bot.minusedlevel || cheb({ x: x!, z: z! }, me) > radius) continue;
        // stand on the leaf's own tile or a walkable cardinal neighbour we can path to
        const cands = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]].map(([dx, dz]) => ({ x: x! + dx!, z: z! + dz! }));
        let best: Tile[] | null = null;
        for (const c of cands) {
            let p: Tile[] = [];
            try { p = navSync().findLongPath(bot.minusedlevel, me.x, me.z, c.x, c.z, 60); } catch { p = []; }
            const e = p[p.length - 1];
            if ((c.x === me.x && c.z === me.z) || (e && e.x === c.x && e.z === c.z)) { const r = densify([me, ...p]); if (!best || r.length < best.length) best = r; }
        }
        if (!best) continue;
        const steps = best.slice(1);
        if (steps.length) bot.sendRoute(turning(me, steps), true);
        bot.opLoc(x!, z!, id, d.op ?? 1); bot.queueFlush();
        await bot.until(() => bot.liveLocs.get(key) !== id, Math.ceil(steps.length / 2) + 4);
        if (bot.liveLocs.get(key) !== id) n++;
    }
    return n;
}
/** core walkTo in bounded attempts, closing open door leaves near us between attempts */
export async function walkSafe(bot: SpeedBot, to: Tile & { level?: number }, near: number, maxTicks = 1500): Promise<boolean> {
    const end = bot.tickCount + maxTicks;
    const there = () => cheb(bot.tile(), to) <= near && (to.level === undefined || bot.minusedlevel === to.level);
    for (let k = 0; k < 5 && !there() && bot.tickCount < end; k++) {
        const per = k === 0 ? Math.min(end - bot.tickCount, cheb(bot.tile(), to) + 60) : Math.min(end - bot.tickCount, cheb(bot.tile(), to) + 40);
        if (per <= 0) break;
        await bot.walkTo(to.x, to.z, { near, level: to.level, maxTicks: per, log: false, closeDoors: true });
        if (there()) break;
        const c = await closeOpenDoorsNear(bot, 6);
        console.log(`[fa] walkSafe(${to.x},${to.z}) attempt ${k + 1} ended at ${JSON.stringify(bot.pos())}; closed ${c} open door(s)`);
    }
    return there();
}

/** walk (core walkTo: navgrid + doors), failing loudly if we end more than `near`+2 away */
export async function walk(bot: SpeedBot, to: Tile & { level?: number }, near: number, what: string, maxTicks = 1500): Promise<void> {
    // closeDoors: an OPEN door leaf walls off the tile it swings onto, which the static planner cannot see (the Wizards'
    // Tower cellar door 1530 at (3111,9559) on a chaos engine); walkTo then closes it and re-plans
    // a level-up page (teleport/quest xp) blocks movement in rev 289; LeanBot's brain continues it unless holdDialogs is
    // set, which every quest dialog sets: release it for the walk (the multi-level traveller has no level-up handling)
    if (levelUpOpen(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
    const hold = bot.holdDialogs; bot.holdDialogs = false;
    let r; try {
        if (to.level !== undefined && to.level !== bot.minusedlevel) r = await bot.walkTo(to.x, to.z, { near, level: to.level, maxTicks, log: false, closeDoors: true });
        // a cross-level trip ends in LeanBot's traveller, which calls "arrived" within 6 tiles: finish on the level itself
        if (cheb(bot.tile(), to) > near && (to.level === undefined || bot.minusedlevel === to.level)) r = await walkSafe(bot, { x: to.x, z: to.z }, near, maxTicks);
    } finally { bot.holdDialogs = hold; }
    if (dead(bot)) fail(bot, `died walking to ${what}`);
    if (cheb(bot.tile(), to) > near + 2 || (to.level !== undefined && bot.minusedlevel !== to.level)) fail(bot, `walk to ${what} (${JSON.stringify(r)})`);
}
/** pick up a ground obj at a tile (route + OPOBJ3), until the pack count rises */
export async function pickup(bot: SpeedBot, obj: string, at: Tile, maxTicks = 60): Promise<boolean> {
    const id = objId(obj), c0 = bot.count(id), end = bot.tickCount + maxTicks;
    // the walk gets at most half the budget: a wedged walk ends in the traveller and used to eat it all (fa56/fa63 stood on
    // the skull's tile with no pickup ever sent)
    if (cheb(bot.tile(), at) > 1) await walkSafe(bot, at, 1, Math.floor(maxTicks / 2));
    let last = -99, waited = 0, sends = 0;
    const visible = () => bot.groundItems.has(`${at.x},${at.z},${id}`);
    while (bot.count(id) <= c0 && bot.tickCount < end && !bot.disposed) {
        if (!visible()) { waited++; await bot.tick(1); continue; }   // a global spawn someone took: wait for the respawn
        if (bot.tickCount - last >= 4) {
            if (++sends % 10 === 0) console.log(`[fa] pickup ${obj}: still trying at ${JSON.stringify(bot.tile())} modal ${bot.mainModalId}/${bot.chatModalId} text ${JSON.stringify([...bot.ifText.values()].filter(v => v).slice(-3))} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 40))}`);
            closeChat(bot); pickupGo(bot, obj, at); last = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (waited) console.log(`[fa] pickup ${obj}: waited ${waited} t for the ground spawn at (${at.x},${at.z})`);
    return bot.count(id) > c0;
}
/** route + OPLOC (q-lib opLocGo) and wait for `done`; re-sent every `every` ticks while the player stands still */
/** route (door-aware walk to an interaction tile) + use an inventory item on a loc, until `done` */
export async function useOnLocUntil(bot: SpeedBot, loc: { id: number; x: number; z: number; level?: number }, obj: string, done: () => boolean, maxTicks = 200, stand?: Tile): Promise<boolean> {
    return opLocUntil(bot, loc, 1, done, maxTicks, stand, obj);
}
export async function opLocUntil(bot: SpeedBot, loc: { id: number; x: number; z: number; level?: number }, op: number, done: () => boolean, maxTicks = 200, stand?: Tile, useObj?: string): Promise<boolean> {
    const l = locAt(loc.id, loc.x, loc.z, loc.level ?? bot.minusedlevel);
    const end = bot.tickCount + maxTicks; let last = -99, prev = '', still = 0;
    // core walkTo first (navgrid + live door opener): opLocGo's rsmod path treats doors as open and stops at a shut one
    // the walk target: the given stand, else the end of the engine's reach-aware path to the loc (an interaction tile; the
    // loc's own tile is often blocked and a walk to it wanders: the sewer ladder (3230,9904) sent fa26 30 tiles away)
    let near: Tile | null = stand ?? null;
    if (!near) {
        const n = navSync(), me = bot.tile(), lv = bot.minusedlevel, fa = n.locForceApproach(l.id);
        if (!n.reachedLoc(lv, me.x, me.z, l.x, l.z, l.width, l.length, l.angle, l.shape, fa)) {
            const path = n.findPathToLoc(lv, me.x, me.z, l.x, l.z, l.width, l.length, l.angle, l.shape, 500, fa);
            const end = path[path.length - 1];
            if (end && n.reachedLoc(lv, end.x, end.z, l.x, l.z, l.width, l.length, l.angle, l.shape, fa)) near = end;
        }
    }
    if (!done() && near && cheb(bot.tile(), near) > 2) { closeChat(bot); await walkSafe(bot, near, 0, Math.max(20, maxTicks - 10)); }
    while (!done() && bot.tickCount < end && !bot.disposed) {
        const t = bot.tile(), k = `${t.x},${t.z}`; still = k === prev ? still + 1 : 0; prev = k;
        if (last < 0 || (still >= 3 && bot.tickCount - last >= 4)) { closeChat(bot); if (useObj) useOnLocGo(bot, useObj, l, stand); else opLocGo(bot, l, op, stand); last = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}
/** wield/wear from the pack (OPHELD2) until worn */
export async function wear(bot: SpeedBot, obj: string, maxTicks = 6): Promise<boolean> {
    const id = objId(obj);
    if (bot.isWorn(id)) return true;
    const s = bot.slot(id); if (s < 0) return false;
    bot.opHeld2(id, s); bot.queueFlush();
    return bot.until(() => bot.isWorn(id), maxTicks);
}

// ---------------------------------------------------------------------------------------------------------
// the launcher (run-<q>.ts): --live <account> | --sim [name] | --supply
// ---------------------------------------------------------------------------------------------------------
export interface QuestModule {
    QUEST: QuestDef; REQUIREMENTS: Requirements; SUPPLY: Item[];
    run: (bot: SpeedBot, o?: { log?: boolean; helper?: string }) => Promise<RunResult>;
}
export interface SimSetup {
    /** sim stats (setstat) — the proven-lowest set, mirrored in REQUIREMENTS.skills */
    stats?: Record<string, number>;
    /** prerequisite quest varps etc. (each a `setvar <name> <value>` cheat) */
    varps?: string[];
    /** extra sim-only items (gear) and items to wield after the hand-over */
    items?: Item[]; wield?: string[];
    /** extra sim-only staging before the supplies are handed over (e.g. bones into a bank) */
    preSim?: (bot: SpeedBot) => Promise<void>;
    /** extra run options (e.g. a helper's name), computed after the sim setup */
    runOpts?: (bot: SpeedBot, name: string) => Promise<Record<string, unknown>>;
}
export async function launch(m: QuestModule, tag: string, sim0: SimSetup = {}): Promise<never> {
    const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
    const show = (l: Item[]) => l.length ? l.map(i => `${i.name} x${i.n}`).join(', ') : '(nothing)';
    if (process.argv.includes('--supply')) {
        console.log(`${m.QUEST.name}: ${show(m.SUPPLY)}`);
        console.log(`requirements: ${JSON.stringify(m.REQUIREMENTS)}`);
        process.exit(0);
    }
    const live = arg('--live'), sim = process.argv.includes('--sim');
    if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `run-${tag} --live`;
    const name = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `${tag.slice(0, 4)}${Date.now() % 100000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(name);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    if (sim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
        for (const v of sim0.varps ?? []) { await bot.cheat(v); await bot.tick(1); }
        await localSetup(bot, { stats: sim0.stats, items: sim0.items });
        console.log(`[${tag}] sim stats: ${Object.keys(sim0.stats ?? {}).map(k => `${k} ${bot.stat(k).level}`).join(", ")}`);
        if (sim0.preSim) await sim0.preSim(bot);
        const have = (i: Item) => bot.count(objId(i.name)) + (bot.isWorn(objId(i.name)) ? 1 : 0);
        await localSetup(bot, { items: m.SUPPLY.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) });
        for (const w of sim0.wield ?? []) await wear(bot, w);
        const s = m.REQUIREMENTS.start;
        await localSetup(bot, { tele: { x: s.x, z: s.z, level: s.level } });
        await bot.tick(2);
    }
    const held = (i: Item) => bot.count(objId(i.name)) + (bot.isWorn(objId(i.name)) ? 1 : 0);
    const missing = m.SUPPLY.filter(i => held(i) < i.n).map(i => `${i.name} ${held(i)}/${i.n}`);
    if (missing.length) await fin(1, `[${tag}] missing ${missing.join(', ')}`);
    const low = Object.entries(m.REQUIREMENTS.skills).filter(([s, [l]]) => bot.stat(s).level < l);
    if (low.length) await fin(1, `[${tag}] too low: ${low.map(([s, [l, why]]) => `${s} ${bot.stat(s).level}/${l} (${why})`).join(', ')}`);
    const qp0 = qp(bot), t0 = bot.tickCount;
    console.log(`[${tag}] ${name}: start ${JSON.stringify(bot.pos())} qp ${qp0} pack ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    let r: RunResult;
    const extra = sim && sim0.runOpts ? await sim0.runOpts(bot, name) : {};
    try { r = await m.run(bot, { log: !process.env.FA_QUIET, ...extra }); }
    catch (e) { r = { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    console.log(`[${tag}] ${r.ok ? 'ok' : 'FAILED'}: ${r.msg} | end ${JSON.stringify(bot.pos())} qp ${qp0} -> ${qp(bot)} | pack ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (r.ok) return fin(0, `[${tag}] QUEST COMPLETE in ${r.ticks} ticks (${m.QUEST.name}, quest points ${qp0} -> ${qp(bot)})`);
    return fin(1, `[${tag}] FAILED after ${r.ticks} ticks: ${r.msg}`);
}

export { log, qp, cheb };

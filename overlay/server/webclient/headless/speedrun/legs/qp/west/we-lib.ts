// legs/qp/west/we-lib.ts — lane-local helpers for the west lane (Underground Pass, Regicide, Watch Tower).
// Quest code is CHEAT-FREE; the only cheat path is launch()'s --sim setup (stats, prerequisite varps, supplies, teleport,
// and --from <segment> debug states), which refuses a non-local LC_HOST.
//
// Patterned on f2p-a/fa-lib.ts (converse / eatWatch / launch), plus act() (op-until-observable with dialog + eating, from
// q-shilo.ts), fight() and a segment runner.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName, cheb, densify, spellCom } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { nav, npc, npcsOf, opNpcGo, navSync, turning, type NpcRef, inDialog, sendToks, dropAllOf, KIT_JUNK, qp, walkOp, msgsSince, routeNextTo as qRouteNextTo, type FTok, type Tile } from '../../q-lib.js';

// the webclient tsconfig has no node/bun types
declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(code?: number): never };

export type Item = { name: string; n: number };
export interface QuestDef { name: string; dir: string; qp: number }
export interface Requirements {
    quests: string[]; qp: number; skills: Record<string, [number, string]>;
    start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number };
}
export interface RunResult { ok: boolean; ticks: number; msg: string; splits?: Record<string, number> }

export class QuestFail extends Error {}
export const fail = (bot: SpeedBot, s: string): never => {
    throw new QuestFail(`${s} at ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 8).slice(-4))}`);
};

export function mkLog(bot: SpeedBot, tag: string, on: boolean) {
    const t0 = bot.tickCount;
    return (s: string) => { if (on) { const p = bot.pos(); console.log(`[${tag} +${String(bot.tickCount - t0).padStart(5)}] (${p.x},${p.z},L${p.level}) hp=${bot.stat('hitpoints').cur} ${s}`); } };
}

// ---------------------------------------------------------------------------------------------------------
// conversation (fa-lib converse, with the "answer anything" fallback for single-path choice pages)
// ---------------------------------------------------------------------------------------------------------
export interface ConverseOpts {
    plan?: FTok[];
    answers?: RegExp[];
    done: () => boolean;
    stand?: Tile;
    near?: number;
    maxTicks?: number;
    tries?: number;
    label?: string;
    useItem?: string;
    op?: number;
    noOp?: boolean;
    after?: FTok[];
    log?: (s: string) => void;
}
export async function converse(bot: SpeedBot, type: number | number[], o: ConverseOpts): Promise<boolean> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, maxTicks = o.maxTicks ?? 300, tries = o.tries ?? 4;
    let starts = o.noOp ? 1 : 0, opTick = o.noOp ? t0 : -100, planSent = false, lastSig = '', lastClick = -99, lastOpen = o.noOp ? t0 : -1;
    while (!bot.disposed && bot.tickCount - t0 < maxTicks) {
        if (o.done()) return true;
        if (inDialog(bot)) {
            lastOpen = bot.tickCount;
            if (!planSent && o.plan?.length) { sendToks(bot, [...o.plan, ...(o.after ?? [])]); planSent = true; await bot.tick(1); continue; }
            const opts = bot.dialogOptions();
            if (opts.length && opts.some(x => x.text)) {
                const sig = opts.map(x => x.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 3) {
                    let hit = -1;
                    for (const re of o.answers ?? []) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                    if (hit < 0) console.log(`[we] ${o.label ?? 'converse'}: unplanned choice [${opts.map(x => x.text).join(' | ')}]`);
                    else { lastSig = sig; lastClick = bot.tickCount; }
                }
            } else if (!opts.length) { for (let i = 0; i < 5; i++) bot.resumeDialogPage(); }
            bot.queueFlush();
            await bot.tick(1); continue;
        }
        if (bot.tickCount - opTick >= 5 && bot.tickCount - lastOpen >= 1) {
            if (starts >= tries) break;
            let n = npc(bot, type);
            if (!n || (o.stand && n.d > (o.near ?? 12) && cheb(bot.tile(), o.stand) > 2)) {
                if (!o.stand) { await bot.tick(1); continue; }
                // walkTo opens doors on the way (the OPNPC route below does not); it may return at once (already there),
                // so always fall through to a tick
                await bot.walkTo(o.stand.x, o.stand.z, { near: 2, maxTicks: Math.max(20, maxTicks - (bot.tickCount - t0)), log: false });
                n = npc(bot, type);
                if (!n) { await bot.tick(1); continue; }
            }
            planSent = false; starts++;
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
export const msgSince = (bot: SpeedBot, since: number, re: RegExp) => msgsSince(bot, since).some(t => re.test(t));

/** Answer whatever chat page is open: a choice -> first matching answer (or option `fallback` if given); a page ->
 *  resume. Returns what it did. */
export function answer(bot: SpeedBot, answers: RegExp[], fallback = -1): 'choice' | 'page' | 'none' | 'stuck' {
    if (bot.chatModalId === -1) return 'none';
    const opts = bot.dialogOptions();
    if (opts.length && opts.some(x => x.text)) {
        for (const re of answers) if (bot.clickDialogByText(re) > 0) { bot.queueFlush(); return 'choice'; }
        if (fallback >= 0 && opts[fallback]) { bot.ifButton(opts[fallback]!.com); bot.queueFlush(); return 'choice'; }
        return 'stuck';
    }
    bot.resumeDialogPage(); bot.queueFlush();
    return 'page';
}

// ---------------------------------------------------------------------------------------------------------
// safety: eat, death
// ---------------------------------------------------------------------------------------------------------
export const FOODS = ['shark', 'monkfish', 'swordfish', 'lobster', 'tuna', 'salmon', 'trout', 'meat_pizza', 'meat_pie', 'stew', 'bread',
    'cake', 'shrimp', 'cooked_meat', 'cooked_chicken'];
let FOOD_IDS: number[] | null = null;
export function foodIds(): number[] { return (FOOD_IDS ??= FOODS.map(f => { try { return objId(f); } catch { return -1; } }).filter(i => i > 0)); }
/** Eat one food now (best-known first) if hp < pct of the level; returns true if a bite was sent. */
export function eatNow(bot: SpeedBot, pct = 0.5): boolean {
    const hp = bot.stat('hitpoints');
    if (hp.cur <= 0 || hp.cur >= hp.level * pct) return false;
    const ids = foodIds();
    const s = bot.inv().filter(x => ids.includes(x.obj)).sort((a, b) => ids.indexOf(b.obj) - ids.indexOf(a.obj))[0];   // eat the cheapest first
    if (!s) return false;
    bot.opHeld1(s.obj, s.slot); bot.queueFlush();
    return true;
}
/** Background eater: eat below pct (default 50%) at most every 3 ticks, never with an npc dialog open. */
export function eatWatch(bot: SpeedBot, pct = 0.5): () => void {
    let stop = false, last = -10;
    (async () => {
        while (!stop && !bot.disposed) {
            if (bot.tickCount - last >= 3 && !inDialog(bot) && eatNow(bot, pct)) last = bot.tickCount;
            await bot.tick(1);
        }
    })();
    return () => { stop = true; };
}
export function dead(bot: SpeedBot): boolean { const h = bot.stat('hitpoints'); return h.level > 0 && h.cur === 0; }
export function foodCount(bot: SpeedBot): number { const ids = foodIds(); return bot.inv().filter(s => ids.includes(s.obj)).reduce((a, s) => a + s.count, 0); }

// ---------------------------------------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------------------------------------
export async function walk(bot: SpeedBot, to: Tile & { level?: number }, near: number, what: string, maxTicks = 1500): Promise<void> {
    let r = await bot.walkTo(to.x, to.z, { near, level: to.level, maxTicks, log: false });
    // LeanBot's multi-level traveller reports "arrived" at the top of the stairs: finish on the level with the fast walker
    for (let k = 0; k < 2 && (cheb(bot.tile(), to) > near || (to.level !== undefined && bot.minusedlevel !== to.level)); k++)
        r = await bot.walkTo(to.x, to.z, { near, level: to.level, maxTicks, log: false });
    if (cheb(bot.tile(), to) > near + 2 || (to.level !== undefined && bot.minusedlevel !== to.level)) fail(bot, `walk to ${what} (${JSON.stringify(r)})`);
}
export async function pickup(bot: SpeedBot, obj: string | number, at: Tile, maxTicks = 60): Promise<boolean> {
    const id = objId(obj), c0 = bot.count(id);
    return walkOp(bot, at, () => { bot.opObj(at.x, at.z, id, 3); }, () => bot.count(id) > c0, { maxTicks, near: 0 });
}
export async function wear(bot: SpeedBot, obj: string | number, maxTicks = 6): Promise<boolean> {
    const id = objId(obj);
    if (bot.isWorn(id)) return true;
    const s = bot.slot(id); if (s < 0) return false;
    bot.opHeld2(id, s); bot.queueFlush();
    return bot.until(() => bot.isWorn(id), maxTicks);
}
export function wornIds(bot: SpeedBot): number[] {
    const w = (bot as any).invs.get(1688) as { ids: Int32Array } | undefined;
    const out: number[] = []; if (w) for (const id of w.ids) if (id > 0) out.push(id);
    return out;
}
/** Unequip every worn item except `keep` (burst); waits until done. Needs free pack slots. */
export async function unequipExcept(bot: SpeedBot, keep: Array<string | number>): Promise<boolean> {
    const k = new Set(keep.map(objId));
    const ids = wornIds(bot).filter(id => !k.has(id));
    if (!ids.length) return true;
    bot.burst(ids.map(id => () => bot.unequipItem(id)));
    return bot.until(() => wornIds(bot).every(id => k.has(id)), 6);
}

/**
 * The workhorse (q-shilo act): fire `op` every `every` ticks while no dialog is open (op may return false = not yet
 * possible), answer dialogs with `answers` (or fallback option index), eat below 50%, until `done()` or `max` ticks.
 */
export async function act(bot: SpeedBot, label: string, op: (() => boolean | void) | null, done: () => boolean,
    o: { answers?: RegExp[]; fallback?: number; every?: number; max?: number; eatPct?: number; noDialog?: boolean } = {}): Promise<boolean> {
    const end = bot.tickCount + (o.max ?? 200), every = o.every ?? 5;
    let last = -1000, stuck = '';
    bot.holdDialogs = true;
    while (bot.tickCount < end && !bot.disposed) {
        if (done()) return true;
        if (dead(bot)) return false;
        if (bot.chatModalId !== -1 && !o.noDialog) {
            const r = answer(bot, o.answers ?? [], o.fallback ?? -1);
            if (r === 'stuck') {
                const sig = bot.dialogOptions().map(x => x.text).join(' | ');
                if (sig !== stuck) { console.log(`[we] ${label}: unplanned choice [${sig}]`); stuck = sig; }
                bot.closeModal(); bot.chatModalId = -1;
            }
        } else {
            if (eatNow(bot, o.eatPct ?? 0.5)) { await bot.tick(1); continue; }
            if (op && bot.tickCount - last >= every) { const r = op(); if (r !== false) last = bot.tickCount; }
        }
        await bot.tick(1);
    }
    return done();
}

/**
 * Fight one npc (op2 Attack) until it is gone from view or `done()`; re-attacks every 6 ticks if we are not in combat,
 * eats below `eatPct`. `pick` chooses the target among visible npcs of `type`.
 */
export async function fight(bot: SpeedBot, type: number | number[], o: { done?: () => boolean; max?: number; eatPct?: number; label?: string;
    pick?: (l: NpcRef[]) => NpcRef | null; spell?: string; log?: (s: string) => void; reissue?: number } = {}): Promise<boolean> {
    const end = bot.tickCount + (o.max ?? 400);
    let target: NpcRef | null = null, lastOp = -100, lastHit = bot.tickCount, lastLog = bot.tickCount;
    bot.holdDialogs = true;
    const types = Array.isArray(type) ? type : [type];
    const visible = () => target ? npcsOf(bot, types).find(n => n.idx === target!.idx) ?? null : null;
    const startXp = bot.xpAll().reduce((a, b) => a + b, 0);
    let lastXp = startXp;
    while (bot.tickCount < end && !bot.disposed) {
        if (o.done?.()) return true;
        if (dead(bot)) return false;
        if (bot.chatModalId !== -1) { answer(bot, [], 0); await bot.tick(1); continue; }
        const xp = bot.xpAll().reduce((a, b) => a + b, 0);
        if (xp > lastXp) { lastXp = xp; lastHit = bot.tickCount; }
        const cur = visible();
        if (target && !cur) { if (!o.done) return true; }   // target gone (died / despawned)
        if (cur && bot.tickCount - lastHit >= 15 && bot.tickCount - lastLog >= 15) {
            lastLog = bot.tickCount;
            console.log(`[we] fight ${o.label ?? cur.type}: no xp for ${bot.tickCount - lastHit} t; me ${bot.tile().x},${bot.tile().z} npc ${cur.x},${cur.z} d${cur.d} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 15).slice(-3))}`);
            // stuck (no line of sight / out of reach): walk next to it before the next attack
            if (cur.d > 1) await bot.walkTo(cur.x, cur.z, { near: 1, maxTicks: 20, log: false });
        }
        if (!target || !cur) {
            const l = npcsOf(bot, types);
            target = o.pick ? o.pick(l) : l[0] ?? null;
            if (!target) { await bot.tick(1); if (!o.done) return false; continue; }
            lastOp = -100;
        }
        if (eatNow(bot, o.eatPct ?? 0.5)) { await bot.tick(1); continue; }
        // melee: re-issue the attack when no xp for a while (not engaged). Spells: one OPNPCT per cast (no autocast), every
        // 5 ticks (the spell attack delay; an early OPNPCT just re-targets)
        if (o.spell ? bot.tickCount - lastOp >= 5 : (bot.tickCount - lastOp >= (o.reissue ?? 8) && bot.tickCount - lastHit >= Math.min(6, o.reissue ?? 6))) {
            const t = visible() ?? target;
            if (o.spell) { routeNextTo(bot, t); bot.opNpcT(t.idx, spellCom(o.spell)); bot.queueFlush(); }
            else opNpcGo(bot, t, 2);
            lastOp = bot.tickCount;
        }
        await bot.tick(1);
    }
    return o.done ? o.done() : false;
}

// ---------------------------------------------------------------------------------------------------------
// the launcher (run-<q>.ts): --live <account> | --sim [name] [--from <seg>] | --supply
// ---------------------------------------------------------------------------------------------------------
/** mid-quest supply hand-off (sim: a cheat give; live: undefined, the quest falls back to a bank) */
export type Handoff = (label: string, items: Item[]) => Promise<void>;
export interface QuestModule {
    QUEST: QuestDef; REQUIREMENTS: Requirements; SUPPLY: Item[];
    run: (bot: SpeedBot, o?: { log?: boolean; from?: string; handoff?: Handoff }) => Promise<RunResult>;
}
export interface SimSetup {
    stats?: Record<string, number>;
    varps?: string[];
    items?: Item[]; wield?: string[];
    /** relog after the sim setup (login-armed timers) */
    relog?: boolean;
    /** debug entry points: --from <seg> applies these (cheats, sim only) instead of the start setup */
    segs?: Record<string, { varps?: string[]; items?: Item[]; wield?: string[]; drop?: string[]; tele: { x: number; z: number; level?: number } }>;
}
export async function launch(m: QuestModule, tag: string, sim0: SimSetup = {}): Promise<never> {
    const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
    // --env K=V (repeatable): debug/A-B switches read by the quest code (qpsim.sh passes no environment through WSL)
    process.argv.forEach((a, i) => { if (a === '--env') { const [k, ...v] = (process.argv[i + 1] ?? '').split('='); if (k) process.env[k] = v.join('='); } });
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
    const from = arg('--from');
    if (from && (!sim || !sim0.segs?.[from])) { console.error(`--from ${from}: sim only, one of ${Object.keys(sim0.segs ?? {}).join(' ')}`); process.exit(2); }
    const name = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `${tag.slice(0, 4)}${Date.now() % 100000}`);
    let bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(name);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    if (sim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
        for (const v of sim0.varps ?? []) { await bot.cheat(v); await bot.tick(1); }
        await localSetup(bot, { stats: sim0.stats, items: sim0.items });
        for (const w of sim0.wield ?? []) await wear(bot, w);
        const have = (i: Item) => bot.count(objId(i.name));
        const seg = from ? sim0.segs![from]! : null;
        if (seg) {   // the segment's own quest items first (a full pack would drop a later give on the floor)
            for (const v of seg.varps ?? []) { await bot.cheat(v); await bot.tick(1); }
            await localSetup(bot, { items: seg.items });
            for (const w of seg.wield ?? []) await wear(bot, w);
        }
        await localSetup(bot, { items: m.SUPPLY.filter(i => have(i) < i.n && !seg?.drop?.includes(i.name)).map(i => ({ name: i.name, n: i.n - have(i) })) });
        const s = seg?.tele ?? m.REQUIREMENTS.start;
        await localSetup(bot, { tele: { x: s.x, z: s.z, level: s.level ?? 0 } });
        await bot.tick(2);
    }
    // a relog (Regicide: the King's messenger timer is armed only at login, login.rs2:74); live only when asked by --relog
    if ((sim0.relog && sim && !from) || process.argv.includes('--relog')) {
        console.log(`[${tag}] relog (arms login timers)`);
        bot = live ? await (async () => { await bot.logout(); return createLive(readBotEnv(live)); })() : await bot.relogin();
        await bot.tick(3);
    }
    if (!from) {
        const missing = m.SUPPLY.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
        if (missing.length) await fin(1, `[${tag}] missing ${missing.join(', ')}`);
        const low = Object.entries(m.REQUIREMENTS.skills).filter(([s, [l]]) => bot.stat(s).level < l);
        if (low.length) await fin(1, `[${tag}] too low: ${low.map(([s, [l, why]]) => `${s} ${bot.stat(s).level}/${l} (${why})`).join(', ')}`);
    }
    const qp0 = qp(bot), t0 = bot.tickCount;
    console.log(`[${tag}] ${name}: start ${JSON.stringify(bot.pos())}${from ? ` from ${from}` : ''} qp ${qp0} pack ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    let r: RunResult;
    const handoff: Handoff | undefined = sim ? async (label, items) => { console.log(`[${tag}] sim hand-off ${label}: ${show(items)}`); await localSetup(bot, { items }); } : undefined;
    try { r = await m.run(bot, { log: !process.env.WE_QUIET, from, handoff }); }
    catch (e) { r = { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    console.log(`[${tag}] ${r.ok ? 'ok' : 'FAILED'}: ${r.msg} | end ${JSON.stringify(bot.pos())} qp ${qp0} -> ${qp(bot)} | splits ${JSON.stringify(r.splits ?? {})} | pack ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (r.ok) return fin(0, `[${tag}] QUEST COMPLETE in ${r.ticks} ticks (${m.QUEST.name}, quest points ${qp0} -> ${qp(bot)})`);
    return fin(1, `[${tag}] FAILED after ${r.ticks} ticks: ${r.msg}`);
}

export { qp, cheb };

import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { SpeedBot, localSetup, objId, objDebugName, certOf, cheb, initNav, densify, spellCom, LOG_DIR, STAT_NAMES } from '../core.js';
import * as ls from '../../loc-scene.js';
import { LEVELUP_IDS, walkOp, locAt, openLoc } from './q-lib.js';
import { LOGS, logSequence } from './p1-firemaking.js';

export type Tile = { x: number; z: number; level?: number };
export interface Item { name: string; n: number; noted?: boolean }

// ---------------------------------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------------------------------
/** Debugname a helper must HOLD for this item (the cert when noted and a cert exists). */
export function heldName(it: Item): string {
    const id = objId(it.name);
    if (it.noted) { const c = certOf(id); if (c > 0) return objDebugName(c); }
    return objDebugName(id);
}
export function heldId(it: Item): number { return objId(heldName(it)); }
/** Backpack slots the item takes when held. */
export function slotsOf(it: Item): number {
    const id = heldId(it);
    const stack = isStackable(id);
    return stack ? 1 : it.n;
}
const STACKABLE_RE = /^cert_|(?<!blank)rune$|^coins$|_arrow$|arrowheads$|^headless_arrow$|^feather$|^thread$|_knife$|^mcannonball$/;
export function isStackable(id: number): boolean { return STACKABLE_RE.test(objDebugName(id)); }
/** Merge repeated entries (same item, same noted flag): a stack listed twice is still one slot. */
export function mergeItems(items: Item[]): Item[] {
    const out: Item[] = [];
    for (const it of items) {
        const same = out.find(o => o.name === it.name && !!o.noted === !!it.noted);
        if (same) same.n += it.n; else out.push({ ...it });
    }
    return out;
}
export function itemsSlots(items: Item[]): number { return items.reduce((a, it) => a + slotsOf(it), 0); }

// ---------------------------------------------------------------------------------------------------
// the trainee clock (logged-in ticks across sessions) + the timeline (logs/speedrun/run-<ts>.jsonl)
// ---------------------------------------------------------------------------------------------------
export class Clock {
    base = 0;                 // ticks of previous sessions
    constructor(public bot: () => SpeedBot) { }
    now(): number { return this.base + this.bot().tickCount; }
}

export interface TLRec {
    kind: 'leg' | 'transition' | 'handoff' | 'session' | 'note' | 'header' | 'summary' | 'failure';
    name: string; group?: string; start?: number; end?: number; ticks?: number; wallMs?: number;
    xp?: Record<string, number>; levels?: Record<string, string>; total?: number; ok?: boolean; error?: string; [k: string]: unknown;
}
export class Timeline {
    readonly file: string;
    readonly rows: TLRec[] = [];
    constructor(tag: string) {
        mkdirSync(LOG_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.file = resolve(LOG_DIR, `run-${ts}-${tag}.jsonl`);
    }
    write(r: TLRec): void {
        const row = { at: new Date().toISOString(), ...r };
        this.rows.push(row);
        appendFileSync(this.file, JSON.stringify(row) + '\n');
    }
}

export function totalLevel(b: SpeedBot): number {
    let t = 0;
    STAT_NAMES.forEach((n, i) => { if (!/^stat1[89]$/.test(n)) t += b.stat(i).level; });
    return t;
}
export function levelMap(b: SpeedBot): Record<string, number> {
    const o: Record<string, number> = {};
    STAT_NAMES.forEach((n, i) => { if (!/^stat1[89]$/.test(n)) o[n] = b.stat(i).level; });
    return o;
}

// ---------------------------------------------------------------------------------------------------
// supply manifest
// ---------------------------------------------------------------------------------------------------
export interface ManifestRow { handoff: string; where: string; item: string; qty: number; noted: boolean; via: string }
export class Manifest {
    rows: ManifestRow[] = [];
    add(handoff: string, where: string, items: Item[], via = 'trade'): void {
        for (const it of items) this.rows.push({ handoff, where, item: it.name, qty: it.n, noted: !!it.noted && certOf(objId(it.name)) > 0, via });
    }
    print(): string {
        const lines = ['| hand-off | where | item | qty | noted | via |', '|---|---|---|---|---|---|'];
        for (const r of this.rows) lines.push(`| ${r.handoff} | ${r.where} | ${r.item} | ${r.qty} | ${r.noted ? 'yes' : 'no'} | ${r.via} |`);
        return lines.join('\n');
    }
}

// ---------------------------------------------------------------------------------------------------
// modals
// ---------------------------------------------------------------------------------------------------
/** Close level-up pages / quest scrolls / stray chat modals (one CLOSE_MODAL per tick). Returns ticks. */
export async function drainModals(b: SpeedBot, o: { keepMain?: boolean; maxTicks?: number } = {}): Promise<number> {
    const t0 = b.tickCount;
    b.holdDialogs = false;
    const open = () => b.chatModalId !== -1 || (!o.keepMain && b.mainModalId !== -1);
    while (open() && b.tickCount - t0 < (o.maxTicks ?? 30)) {
        b.closeModal();
        await b.tick(1);
    }
    return b.tickCount - t0;
}
export function levelUpOpen(b: SpeedBot): boolean { return LEVELUP_IDS.has(b.chatModalId); }

// ---------------------------------------------------------------------------------------------------
// helpers (in the same process, filled by cheat, pre-positioned before the trainee arrives)
// ---------------------------------------------------------------------------------------------------
/** Fill a helper: clear the pack, give the items (noted where asked), teleport to `at`. */
export async function fillHelper(h: SpeedBot, items: Item[], at?: Tile, o: { clear?: boolean } = {}): Promise<void> {
    items = mergeItems(items);
    if (h.mainModalId !== -1 || h.chatModalId !== -1) { h.closeModal(); await h.tick(1); }
    if (o.clear !== false && h.inv().length) await localSetup(h, { clear: true });
    // stacks first (1 cheat each), then unnoted singles
    const give = items.map(it => ({ name: heldName(it), n: it.n }));
    if (itemsSlots(items) > 28) throw new Error(`fillHelper ${h.loginUser}: ${itemsSlots(items)} slots > 28 (${give.map(g => g.name).join(',')})`);
    await localSetup(h, { items: give, ...(at ? { tele: { x: at.x, z: at.z, level: at.level ?? 0 } } : {}) });
    for (const g of give) if (h.count(g.name) < g.n) throw new Error(`fillHelper ${h.loginUser}: ${g.name} ${h.count(g.name)}/${g.n}`);
}

/**
 * One hand-off TRADE: helper gives everything listed, the trainee accepts. Both loops run on their own
 * clocks in parallel (mutual OPPLAYER4 opens the window a tick sooner). Returns trainee ticks.
 */
/** OPPLAYER4 does not self-route (measured: no window ever opened 2+ tiles apart): get next to the helper. */
async function besideHelper(t: SpeedBot, h: SpeedBot): Promise<void> {
    const ht = h.tile(), me = t.tile();
    if (h.minusedlevel !== t.minusedlevel) return;
    const nav = await initNav();
    const lvl = t.minusedlevel;
    // a neighbour of the helper with an OPEN one-step edge to it (Chebyshev 1 across a fence/stall wall never trades;
    // measured in the Ardougne market: adjacent, both visible, no window for 60 ticks)
    const linked = (n: { x: number; z: number }) => {
        if (n.x === ht.x && n.z === ht.z) return false;
        const p = nav.findLongPath(lvl, n.x, n.z, ht.x, ht.z, 3);
        return p.length === 1 && p[0]!.x === ht.x && p[0]!.z === ht.z;
    };
    if (cheb(ht, me) === 1 && linked(me)) return;
    if (t.mainModalId !== -1 || t.chatModalId !== -1) t.closeModal();
    let best: { x: number; z: number; d: number } | null = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const n = { x: ht.x + dx!, z: ht.z + dz! };
        if (!linked(n)) continue;
        const p = nav.findLongPath(lvl, me.x, me.z, n.x, n.z, 60);
        const e = p[p.length - 1];
        const d = n.x === me.x && n.z === me.z ? 0 : e && e.x === n.x && e.z === n.z ? densify([me, ...p]).length : 999;
        if (d < 999 && (!best || d < best.d)) best = { ...n, d };
    }
    if (best) await t.stepTo(best.x, best.z, 40);
    else await t.walkTo(ht.x, ht.z, { near: 1, maxTicks: 60, log: false });
}
export async function tradeIn(t: SpeedBot, h: SpeedBot, items: Item[], o: { maxTicks?: number; exact?: boolean } = {}): Promise<{ ok: boolean; ticks: number; message?: string }> {
    const t0 = t.tickCount;
    await besideHelper(t, h);
    const want = new Map<number, number>(); for (const it of items) want.set(heldId(it), (want.get(heldId(it)) ?? 0) + it.n);
    let give: Array<{ obj: number; n: number | 'all' }> = [...want.keys()].filter(id => h.count(id) > 0)
        .map(id => ({ obj: id, n: o.exact ? Math.min(h.count(id), want.get(id)!) : 'all' as const }));
    const cnt = (g: { obj: number; n: number | 'all' }) => (g.n === 'all' ? h.count(g.obj) : g.n);
    if (!give.length) return { ok: false, ticks: 0, message: `${h.loginUser} holds none of the items` };
    // a trade whose goods exceed the receiver's free slots can never be confirmed: trim the biggest non-stackable
    {
        const slotsOf = (id: number) => h.inv().filter(s => s.obj === id).length;
        // session 11 fix 315 (SR_TRADE_SLOTS; CONFIRMED qyf01 'trimmed to fit 21 free slots: ...,4doseprayerrestorexall,sharkx6'
        // = 15 kit slots + pot counted 0 + 6 sharks = 21, real 22; qx71m/qyt04 the same Legends B belt, 4 tries + relog x 40 t
        // 'timeout' both sides, trainee m3323): ONE held slot was read as a stack, so a non-stackable the helper holds once
        // (prayer potion, hammer) counted 0 slots when the trainee already held one. The engine refuses the accept
        // (trade.rs2 ~.enough_trade_space) and the giver never re-offers on the reopened window. A stack = one slot with a
        // count > 1, or a stackable name (runes, coins, certs...). SR_TRADE_SLOTS=0 reverts.
        const STACK_NAME = /^cert_|(?<!blank)rune$|^coins$|arrow|^feather$|^thread$|^mcannonball$/;
        const stack = process.env.SR_TRADE_SLOTS === '0' ? (id: number) => slotsOf(id) === 1
            : (id: number) => slotsOf(id) === 1 && (h.count(id) > 1 || STACK_NAME.test(objDebugName(id)));
        let need = give.reduce((a, g) => a + (stack(g.obj) ? (t.count(g.obj) > 0 ? 0 : 1) : cnt(g)), 0);
        const free = t.free();
        if (need > free) {
            const ns = give.filter(g => !stack(g.obj)).sort((a, b) => cnt(b) - cnt(a));
            for (const g of ns) {
                if (need <= free) break;
                const keep = Math.max(0, cnt(g) - (need - free));
                need -= cnt(g) - keep;
                g.n = keep;
            }
            give = give.filter(g => g.n === 'all' || (g.n as number) > 0);
            console.log(`[trade] ${h.loginUser} -> ${t.loginUser}: trimmed to fit ${free} free slots: ${give.map(g => objDebugName(g.obj) + 'x' + g.n).join(',')}`);
        }
    }
    if (t.mainModalId !== -1 || t.chatModalId !== -1) { t.closeModal(); }
    const [a, g] = await Promise.all([t.acceptTradeFrom(h.loginUser, { maxTicks: o.maxTicks ?? 60 }), h.giveTo(t.loginUser, give, { maxTicks: o.maxTicks ?? 60 })]);
    const ok = a.ok && g.ok;
    const dbg = ok ? '' : ` | t@${JSON.stringify(t.pos())} m${t.mainModalId}/${t.chatModalId} sees h=${t.findPlayerByName(h.loginUser)} h@${JSON.stringify(h.pos())} m${h.mainModalId}/${h.chatModalId} sees t=${h.findPlayerByName(t.loginUser)} tfree=${t.free()} tmsgs=${JSON.stringify(t.getChat({ limit: 6 }).map((m: any) => m.text))} hmsgs=${JSON.stringify(h.getChat({ limit: 6 }).map((m: any) => m.text))}`;
    return { ok, ticks: t.tickCount - t0, message: ok ? undefined : `accept=${JSON.stringify(a)} give=${JSON.stringify(g)}${dbg}` };
}
/** Trainee gives `items` (held ids, whole stacks) to a helper. */
export async function tradeOut(t: SpeedBot, h: SpeedBot, ids: number[], o: { maxTicks?: number } = {}): Promise<{ ok: boolean; ticks: number; message?: string }> {
    const t0 = t.tickCount;
    const give = [...new Set(ids)].filter(id => t.count(id) > 0).map(id => ({ obj: id, n: 'all' as const }));
    if (!give.length) return { ok: true, ticks: 0, message: 'nothing to give' };
    await besideHelper(t, h);
    const [g, a] = await Promise.all([t.giveTo(h.loginUser, give, { maxTicks: o.maxTicks ?? 60 }), h.acceptTradeFrom(t.loginUser, { maxTicks: o.maxTicks ?? 60 })]);
    const ok = a.ok && g.ok;
    return { ok, ticks: t.tickCount - t0, message: ok ? undefined : `give=${JSON.stringify(g)} accept=${JSON.stringify(a)}` };
}

// ---------------------------------------------------------------------------------------------------
// bank adapters (Varrock west / Falador west booths)
// ---------------------------------------------------------------------------------------------------
export async function openBooth(t: SpeedBot, maxTicks = 40): Promise<void> {
    const t0 = t.tickCount;
    let tries = 0;
    while (!t.bankOpen()) {
        if (t.chatModalId !== -1) t.closeModal();
        // booths first; after a miss a banker NPC counts too (live acct23 Catherby the nearest 'Bank booth' was op-less 2214)
        const r = await t.openBank({ kind: tries++ === 0 ? 'booth' : 'any', radius: 20 });
        if (r.ok) break;
        if (t.tickCount - t0 > maxTicks) throw new Error(`openBooth failed at ${JSON.stringify(t.pos())}: ${JSON.stringify(r)}`);
        await t.tick(1);
    }
}
/** Deposit everything except `keep` (the bank must be open); waits until done. */
export async function depositExcept(t: SpeedBot, keep: Array<number | string> = []): Promise<void> {
    const r = await t.depositAll(keep);
    if (!r.ok) throw new Error(`deposit failed ${JSON.stringify(r)} inv=${JSON.stringify(t.inv())}`);
}
/** Deposit all but `keep` and withdraw `want` in ONE burst (bank open). Missing bank items throw. */
export async function swap(t: SpeedBot, keep: Array<number | string>, want: Array<{ obj: string; n: number | 'all'; noted?: boolean }>): Promise<void> {
    const have = want.filter(w => t.bankCount(w.obj) > 0);
    const miss = want.filter(w => t.bankCount(w.obj) === 0).map(w => w.obj);
    if (miss.length) throw new Error(`bank lacks ${miss.join(',')}`);
    const r = await t.bankSwap(keep, have);
    if (!r.ok) throw new Error(`bankSwap failed ${JSON.stringify(r)} want=${JSON.stringify(want)} inv=${JSON.stringify(t.inv().map(s => objDebugName(s.obj) + 'x' + s.count))}`);
}

/** Wield items from the pack (burst), wait until worn. */
export async function wield(t: SpeedBot, names: string[]): Promise<number> {
    const t0 = t.tickCount;
    const ids = names.map(objId).filter(id => !t.isWorn(id) && t.slot(id) >= 0);
    if (!ids.length) return 0;
    t.burst(ids.map(id => () => t.opHeld2(id, t.slot(id))));
    await t.until(() => ids.every(id => t.isWorn(id)), 6);
    return t.tickCount - t0;
}
/** Unequip every worn item matching `re` (by debugname). */
export async function unwieldAll(t: SpeedBot, re: RegExp): Promise<number> {
    const t0 = t.tickCount;
    const w = (t as any).invs.get(1688) as { ids: Int32Array } | undefined;
    const ids: number[] = [];
    if (w) for (const id of w.ids) if (id > 0 && re.test(objDebugName(id))) ids.push(id);
    if (!ids.length) return 0;
    t.burst(ids.map(id => () => t.unequipItem(id)));
    await t.until(() => ids.every(id => !t.isWorn(id)), 6);
    return t.tickCount - t0;
}
/** Burst-drop every pack stack whose debugname does NOT match `keep`. */
export async function dropExcept(t: SpeedBot, keep: RegExp): Promise<number> {
    const objs = [...new Set(t.inv().filter(s => !keep.test(objDebugName(s.obj))).map(s => s.obj))];
    if (!objs.length) return 0;
    return t.dropAll(objs, 20);
}

// ---------------------------------------------------------------------------------------------------
// FIREMAKING 1->30 from the INVENTORY on the spot (Sea Slug prerequisite; no bank on the way)
// ---------------------------------------------------------------------------------------------------
/** Logs for firemaking fromXp -> to (normal logs, oak...). */
export function fmInvSupply(fromXp: number, to: number): Item[] {
    const c: Record<string, number> = {};
    for (const l of logSequence(fromXp, to)) c[l] = (c[l] ?? 0) + 1;
    return Object.entries(c).map(([name, n]) => ({ name, n: n + (name === 'logs' ? 1 : 0) }));
}
/**
 * Burn logs from the pack in a westward line near the current tile until firemaking `to`.
 * Preconditions: tinderbox + logs in the pack. Exit: at the line's end (west), logs used up.
 */
export async function fmInvLeg(t: SpeedBot, to = 30): Promise<{ logs: number; walk: number; relights: number }> {
    const nav = await initNav();
    const TB = objId('tinderbox');
    const logIds = new Set(LOGS.map(l => objId(l.name)));
    const n = t.inv().filter(s => logIds.has(s.obj)).length;
    // nearest start tile with n west-walkable steps (no live locs on them). Static floor decoration (inside Doric's house)
    // also refuses a fire ("You can't light a fire here": map_locaddunsafe) and is not in liveLocs: such tiles go into `bad`
    // and the line is picked again (LV34 + FMF1: the line started indoors, every light refused, no xp)
    const bad = new Set<string>();
    const westOk = (x: number, z: number) => {
        if (bad.has(`${x},${z}`) || t.liveLocs.has(`0,${x},${z}`)) return false;
        const p = nav.findLongPath(0, x, z, x - 1, z, 3);
        return p.length === 1 && p[0]!.x === x - 1 && p[0]!.z === z;
    };
    const findLine = (n: number) => {
        const me = t.tile();
        let best: { x: number; z: number; d: number } | null = null;
        const cache = new Map<string, boolean>();
        const ok1 = (x: number, z: number) => { const k = `${x},${z}`; let v = cache.get(k); if (v === undefined) { v = westOk(x, z); cache.set(k, v); } return v; };
        const cands: Array<{ x: number; z: number; r: number }> = [];
        for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) cands.push({ x: me.x + dx, z: me.z + dz, r: Math.max(Math.abs(dx), Math.abs(dz)) });
        cands.sort((a, b) => a.r - b.r);
        for (const cnd of cands) {
            if (best && cnd.r > best.d) break;
            let ok = true;
            for (let i = 0; i < n && ok; i++) ok = ok1(cnd.x - i, cnd.z);
            if (!ok) continue;
            if (cnd.r === 0) { best = { x: cnd.x, z: cnd.z, d: 0 }; break; }
            const path = nav.findLongPath(0, me.x, me.z, cnd.x, cnd.z, 40);
            const end = path[path.length - 1];
            if (!end || end.x !== cnd.x || end.z !== cnd.z) continue;
            const d = densify([me, ...path]).length - 1;
            if (!best || d < best.d) best = { x: cnd.x, z: cnd.z, d };
        }
        return best;
    };
    const toLine = async (n: number) => {
        const best = findLine(n);
        if (!best) throw new Error(`fmInv: no ${n}-tile west line near ${t.tile().x},${t.tile().z}`);
        const w0 = t.tickCount;
        if (best.d > 0) { const r = await t.walkTo(best.x, best.z, { maxTicks: 80, log: false }); if (!r.ok) throw new Error(`fmInv: walk to line failed ${JSON.stringify(r)}`); }
        console.log(`[fmInv] line start ${best.x},${best.z} (path ${best.d} tiles, walked ${t.tickCount - w0}t) for ${n} logs`);
        return t.tickCount - w0;
    };
    const w0 = t.tickCount;
    await toLine(n);
    const walk = t.tickCount - w0;
    let logs = 0, relights = 0;
    // game messages by identity, not getNewChat: its cursor is shared (the refusal was read elsewhere first: FMF1/FMF2)
    const seen = new WeakSet<object>();
    const newMsgs = (): string => { const out: string[] = []; for (const m of (t as any).getChat({ types: [0], limit: 0, includeSelf: true }) as any[]) if (!seen.has(m)) { seen.add(m); out.push(m.text); } return out.join(' | '); };
    newMsgs();
    while (t.stat('firemaking').level < to) {
        const order = LOGS.map(l => objId(l.name));
        const lvl = t.stat('firemaking').level;
        const s = t.inv().filter(x => logIds.has(x.obj) && LOGS.find(l => objId(l.name) === x.obj)!.level <= lvl).sort((a, b) => order.indexOf(a.obj) - order.indexOf(b.obj))[0];
        if (!s) throw new Error(`fmInv: out of usable logs at firemaking ${lvl}`);
        const xp0 = t.stat('firemaking').xp, cnt0 = t.count(s.obj);
        if (t.chatModalId !== -1) t.closeModal();
        t.useItemOnItem(TB, t.slotOf(TB), s.obj, s.slot); t.queueFlush();
        let dropped = false, sentAt = t.tickCount, dropTile = t.tile(), groundOp = -1;
        while (true) {
            await t.tick(1);
            if (t.stat('firemaking').xp > xp0) break;
            // the log is on the ground: the engine re-tries the light by itself (p_opobj 4) until it catches, but anything
            // that interrupts the player ends that loop and leaves the log lying there (LV34: no xp for 60 ticks at level 1).
            // Nothing for 6 ticks -> light it from the ground (OPOBJ4 'Light', the same label as the held light)
            if (dropped && t.tickCount - Math.max(sentAt, groundOp) >= 6) { relights++; t.opObj(dropTile.x, dropTile.z, s.obj, 4); t.queueFlush(); groundOp = t.tickCount; }
            if (!dropped) {
                if (t.count(s.obj) < cnt0) { dropped = true; dropTile = t.tile(); continue; }
                const msgs = newMsgs();
                if (/can't light a fire here/i.test(msgs)) {
                    if (bad.size > 40) throw new Error('fmInv: every nearby tile refuses a fire');
                    const m = t.tile(); for (let i = 0; i < 3; i++) bad.add(`${m.x - i},${m.z}`);
                    await toLine(t.inv().filter(x => logIds.has(x.obj)).length);
                    relights++; if (t.chatModalId !== -1) t.closeModal(); t.useItemOnItem(TB, t.slotOf(TB), s.obj, t.slotOf(s.obj)); t.queueFlush(); sentAt = t.tickCount; newMsgs(); continue;
                }
                if (t.tickCount - sentAt >= 3) { relights++; if (t.chatModalId !== -1) t.closeModal(); t.useItemOnItem(TB, t.slotOf(TB), s.obj, t.slotOf(s.obj)); t.queueFlush(); sentAt = t.tickCount; }
            }
            if (t.tickCount - sentAt > 120) throw new Error('fmInv: no xp for 120 ticks');
        }
        logs++;
        await t.tick(1);
    }
    return { logs, walk, relights };
}

// ---------------------------------------------------------------------------------------------------
// RUNE SCIMITAR: 2 rune ore + 16 coal superheated at the booth, one anvil action (Varrock west anvil)
// ---------------------------------------------------------------------------------------------------
const ANVIL = { x: 3188, z: 3426, id: 2783 };
const SMITHING_IF = 994, COLUMN1 = 1119, SCIMITAR_SLOT = 2;
/** Preconditions: at a Varrock west booth, staff of fire worn, nature runes >= 2 + hammer in the pack, bank
 *  holds runite_ore x2 + coal x16, smithing >= 90. Exit: next to the anvil, rune_scimitar in the pack. */
export async function scimitarLeg(t: SpeedBot): Promise<{ casts: number; ticks: number }> {
    const nav = await initNav();
    const t0 = t.tickCount;
    const ORE = objId('runite_ore'), COAL = objId('coal'), BAR = objId('runite_bar'), SCIM = objId('rune_scimitar');
    if (t.count(ORE) < 2 || t.count(COAL) < 16) {
        await openBooth(t);
        await swap(t, ['hammer', 'naturerune'], [{ obj: 'runite_ore', n: 2 }, { obj: 'coal', n: 16 }]);
        t.closeBank();
    }
    const SH = spellCom('superheat_item');
    let casts = 0;
    while (t.count(BAR) < 2) {
        if (t.tickCount - t0 > 60) throw new Error(`scimitar: superheat stalled inv=${JSON.stringify(t.inv().map(s => objDebugName(s.obj) + 'x' + s.count))} msgs=${t.getNewChat().map(m => m.text).join(' | ')}`);
        const s = t.slot(ORE);
        if (s < 0) break;
        if (t.chatModalId !== -1) t.closeModal();
        const b0 = t.count(BAR);
        t.opHeldT(ORE, s, SH); t.queueFlush();
        await t.until(() => t.count(BAR) > b0, 3);
        if (t.count(BAR) > b0) casts++;
    }
    if (t.count(BAR) < 2) throw new Error(`scimitar: only ${t.count(BAR)} rune bars`);
    const anvil = ls.getLocsAt(ANVIL.x, ANVIL.z, 0).find(l => l.id === ANVIL.id);
    if (!anvil) throw new Error('scimitar: anvil not found');
    const send = () => {
        const me = t.tile();
        const fa = nav.locForceApproach(anvil.id);
        if (!nav.reachedLoc(0, me.x, me.z, anvil.x, anvil.z, anvil.width, anvil.length, anvil.angle, anvil.shape, fa)) {
            const path = nav.findPathToLoc(0, me.x, me.z, anvil.x, anvil.z, anvil.width, anvil.length, anvil.angle, anvil.shape, 500, fa);
            t.sendRoute(densify([me, ...path]).slice(1), true);
        }
        t.useItemOnLoc(anvil.x, anvil.z, anvil.id, BAR, t.slot(BAR)); t.queueFlush();
    };
    if (t.chatModalId !== -1) t.closeModal();
    send();
    let sent = t.tickCount;
    while (t.mainModalId !== SMITHING_IF) {
        await t.tick(1);
        if (t.mainModalId !== SMITHING_IF && t.tickCount - sent > 10) { if (t.chatModalId !== -1) t.closeModal(); send(); sent = t.tickCount; }
        if (t.tickCount - t0 > 120) throw new Error('scimitar: smithing interface never opened');
    }
    t.invButton(1, SCIM, SCIMITAR_SLOT, COLUMN1); t.queueFlush();
    if (!(await t.until(() => t.count(SCIM) > 0, 12))) throw new Error(`scimitar: not made (msgs ${t.getNewChat().map(m => m.text).join(' | ')})`);
    return { casts, ticks: t.tickCount - t0 };
}

// ---------------------------------------------------------------------------------------------------
// webs (knife), Mage Arena chamber -> cellar -> hut -> Wilderness agility course door
// ---------------------------------------------------------------------------------------------------
async function slashWeb(t: SpeedBot, w: { x: number; z: number; id: number }, stand: Tile): Promise<void> {
    const KNIFE = objId('knife');
    const slashed = () => { const v = t.liveLocs.get(`0,${w.x},${w.z}`); return v !== undefined && v !== w.id; };
    if (slashed()) { openLoc(w); return; }
    const use = () => { const s = t.slot(KNIFE); if (s >= 0) t.useItemOnLoc(w.x, w.z, w.id, KNIFE, s); };
    if (!(await walkOp(t, stand, use, slashed, { maxTicks: 40 }))) {
        for (let k = 0; k < 16 && !slashed(); k++) { use(); t.queueFlush(); await t.tick(1); }
    }
    if (!slashed()) throw new Error(`web ${w.x},${w.z} not slashed`);
    openLoc(w);
}
/** From the Mage Arena chamber (after the guardian / Charge) to the Wilderness course ridge door (2998,3916). */
export async function chamberToCourse(t: SpeedBot): Promise<{ ticks: number; split: Record<string, number> }> {
    await initNav();
    const t0 = t.tickCount, split: Record<string, number> = {};
    let mark = t0;
    const lap = (k: string) => { split[k] = t.tickCount - mark; mark = t.tickCount; };
    t.holdDialogs = false;
    if (t.chatModalId !== -1 || t.mainModalId !== -1) t.closeModal();
    // 1. sparkling pool (2508,4686) -> cellar (2542,4718)
    if (t.tile().z > 4600 && t.tile().x < 2530) {
        const pool = locAt(2879, 2508, 4686, 0);
        const ok = await walkOp(t, { x: 2509, z: 4689 }, () => t.opLoc(pool.x, pool.z, pool.id, 1), () => t.tile().x > 2530, { maxTicks: 60 });
        if (!ok) throw new Error(`pool to the cellar failed at ${JSON.stringify(t.pos())}`);
        lap('pool');
    }
    // 2. cellar ladder 2872 (2542,4713) -> hut (3091,3957)
    if (t.tile().z > 4600) {
        const lad = locAt(2872, 2542, 4713, 0);
        const ok = await walkOp(t, { x: 2542, z: 4714 }, () => t.opLoc(lad.x, lad.z, lad.id, 1), () => t.tile().z < 4600, { maxTicks: 40 });
        if (!ok) throw new Error(`cellar ladder failed at ${JSON.stringify(t.pos())}`);
        lap('ladder');
    }
    if (t.chatModalId !== -1) t.closeModal();
    // 3. hut webs (3093,3957) and (3095,3957), from the inside going east
    if (t.tile().x < 3096 && t.tile().z > 3950 && t.tile().z < 3965) {
        await slashWeb(t, { x: 3093, z: 3957, id: 733 }, { x: 3092, z: 3957 });
        await slashWeb(t, { x: 3095, z: 3957, id: 733 }, { x: 3094, z: 3957 });
        lap('webs');
    }
    // 4. walk to the course ridge door
    const w = await t.walkTo(2998, 3916, { maxTicks: 300 });
    if (!w.ok) throw new Error(`walk to the Wilderness course failed ${JSON.stringify(w)}`);
    lap('walk');
    return { ticks: t.tickCount - t0, split };
}

export { cheb };

// ---------------------------------------------------------------------------------------------------
// Gnome Stronghold south gate (2459,3383). Femi (Grand Tree) stops a first-time visitor at the gate with a
// "lift these boxes?" dialog; LeanBot's dialog driver answers option 1 ("Sorry, I'm a bit busy.") and the
// gate is operated again. The plain walker/traveller wedges here (seen: 300-tick stall at 2461,3382).
// ---------------------------------------------------------------------------------------------------
export async function enterGnomeStronghold(t: SpeedBot): Promise<{ ticks: number; ops: number }> {
    const t0 = t.tickCount;
    t.holdDialogs = false;
    const inside = () => { const m = t.tile(); return m.x >= 2370 && m.x <= 2510 && m.z >= 3385 && m.z <= 3520; };
    if (inside()) return { ticks: 0, ops: 0 };
    {
        const w = await t.walkTo(2461, 3381, { near: 1, maxTicks: 400, log: false });
        if (!w.ok) throw new Error(`walk to the Gnome Stronghold gate failed ${JSON.stringify(w)}`);
    }
    const gate = locAt(190, 2459, 3383, 0);
    let ops = 0, last = -100;
    while (!inside()) {
        if (t.tickCount - t0 > 400) throw new Error(`Gnome Stronghold gate: still outside at ${JSON.stringify(t.pos())}`);
        if (t.chatModalId === -1 && t.mainModalId === -1 && t.tickCount - last >= 5) { t.opLocReach(gate, 1); ops++; last = t.tickCount; }
        await t.tick(1);
    }
    return { ticks: t.tickCount - t0, ops };
}
// ---------------------------------------------------------------------------------------------------
// ADAMANT ARMOUR for the combat block (orchestrator): full helm 2 + platebody 5 + platelegs 3 + kiteshield 3
// = 13 adamantite bars, smithed by the trainee at the Varrock west anvil right after the rune scimitar (smithing 99).
// smithing.inv: adamant3 = chainbody, platelegs, plateskirt, platebody | adamant4 = med helm, full helm, sq shield, kiteshield
// ---------------------------------------------------------------------------------------------------
export const ADAMANT_SET = [
    { obj: 'adamant_platebody', col: 1121, slot: 3 }, { obj: 'adamant_platelegs', col: 1121, slot: 1 },
    { obj: 'adamant_full_helm', col: 1122, slot: 1 }, { obj: 'adamant_kiteshield', col: 1122, slot: 3 },
];
export async function adamantArmourLeg(t: SpeedBot): Promise<{ ticks: number; made: string[] }> {
    const nav = await initNav();
    const t0 = t.tickCount;
    const BAR = objId('adamantite_bar');
    if (t.count(BAR) < 13) {
        await openBooth(t);
        await swap(t, ['hammer', 'rune_scimitar', 'naturerune'], [{ obj: 'adamantite_bar', n: 13, noted: false }]);
        t.closeBank();
    }
    const anvil = ls.getLocsAt(ANVIL.x, ANVIL.z, 0).find(l => l.id === ANVIL.id);
    if (!anvil) throw new Error('armour: anvil not found');
    const made: string[] = [];
    for (const it of ADAMANT_SET) {
        const id = objId(it.obj);
        if (t.count(id) > 0) continue;
        const send = () => {
            const me = t.tile();
            const fa = nav.locForceApproach(anvil.id);
            if (!nav.reachedLoc(0, me.x, me.z, anvil.x, anvil.z, anvil.width, anvil.length, anvil.angle, anvil.shape, fa)) {
                const path = nav.findPathToLoc(0, me.x, me.z, anvil.x, anvil.z, anvil.width, anvil.length, anvil.angle, anvil.shape, 500, fa);
                t.sendRoute(densify([me, ...path]).slice(1), true);
            }
            if (t.chatModalId !== -1) t.closeModal();
            t.useItemOnLoc(anvil.x, anvil.z, anvil.id, BAR, t.slot(BAR)); t.queueFlush();
        };
        for (let k = 0; k < 4 && t.count(id) === 0; k++) {
            send();
            if (!(await t.until(() => t.mainModalId === SMITHING_IF, 14))) continue;
            t.invButton(1, id, it.slot, it.col); t.queueFlush();
            await t.until(() => t.count(id) > 0, 12);
        }
        if (t.count(id) === 0) throw new Error(`armour: ${it.obj} not made (bars ${t.count(BAR)}, msgs ${t.getNewChat().map(m => m.text).join(' | ')})`);
        made.push(it.obj);
    }
    return { ticks: t.tickCount - t0, made };
}

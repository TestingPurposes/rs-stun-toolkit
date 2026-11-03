// rb-lib.ts — lane "rebuild" helpers (Rune Mysteries, Death Plateau). Cheat-free. Builds on fa-lib / fa2-lib / q-lib by
// import (none of them is edited).
import { readFileSync } from 'fs';
import { resolve } from 'path';

let NPCS: Map<string, number> | null = null;
/** npc type id by debugname (content/pack/npc.pack); throws on an unknown name */
export function npcId(name: string): number {
    if (!NPCS) {
        NPCS = new Map();
        const txt = readFileSync(resolve((import.meta as any).dir, '../../../../../../content/pack/npc.pack'), 'utf8');
        for (const m of txt.matchAll(/^(\d+)=([a-z0-9_]+)\s*$/gm)) NPCS.set(m[2]!, Number(m[1]));
    }
    const id = NPCS.get(name);
    if (id === undefined) throw new Error(`npcId: unknown npc ${name}`);
    return id;
}

import type { SpeedBot } from '../../../core.js';
import { objId, cheb } from '../../../core.js';
import { npc, opNpcGo, inDialog, levelUpOpen, nav, type NpcRef } from '../../q-lib.js';
import { routeNextTo, closeChat } from '../f2p-a/fa-lib.js';
import { isTileWalkable } from '../../../../../../../sdk/pathfinding';

/**
 * Start a conversation fast: route + OPNPC (or use-item-on-npc), and RE-SEND it with the npc's current tile whenever we
 * stood still for `still` ticks without a dialog. fa-lib converse() retries only after 5 t and then walks onto the npc
 * (Sedridor in the tower cellar: the first op from the ladder landing parks at (3108,9570) with no dialog and no message,
 * probe-rm; converse's retry cost 28-31 t per conversation). Returns true once a dialog page is open.
 */
export async function opNpcUntilDialog(bot: SpeedBot, type: number, o: { useItem?: string; op?: number; maxTicks?: number; still?: number; log?: (s: string) => void; opRange?: number; noWalk?: boolean } = {}): Promise<boolean> {
    await nav();
    const end = bot.tickCount + (o.maxTicks ?? 60), still = o.still ?? 2;
    let prev = '', st = 0, sent = -99, n0: NpcRef | null = null, sends = 0;
    while (bot.tickCount < end && !bot.disposed) {
        if (inDialog(bot)) return true;
        const t = bot.tile(), k = `${t.x},${t.z},${bot.minusedlevel}`;
        st = k === prev ? st + 1 : 0; prev = k;
        const n = npc(bot, type);
        const moved = n && n0 && (n.x !== n0.x || n.z !== n0.z);
        if (n && (sent < 0 || (st >= still && bot.tickCount - sent >= still) || (moved && bot.tickCount - sent >= 2 && cheb(t, n) > 1))) {
            if (bot.chatModalId !== -1 && !levelUpOpen(bot)) closeChat(bot);
            // a re-send after we stood still: the engine routes an OPNPC itself, naively (it parks behind the open cellar leaf
            // 1531 on the N edge of (3107,9570): probe-cellar), so WALK next to the npc first (core walkTo: navgrid + doors)
            if ((sends > 0 && cheb(t, n) > 1) || (sends === 0 && cheb(t, n) > (o.opRange ?? 2) && !o.noWalk)) {
                await bot.walkTo(n.x, n.z, { near: 1, maxTicks: cheb(t, n) * 2 + 8, log: false });
                if (inDialog(bot)) return true;
                const m = npc(bot, type); if (!m) continue;
                Object.assign(n, m);
            }
            // standing ON the npc's tile: q-lib opNpcGo steps off and ops in one burst, which the engine did not take
            // (rb61: Aubury, 4 re-ops from his own tile, 10 t). Step off first, op on the next tick.
            {
                const me = bot.tile();
                if (me.x === n.x && me.z === n.z) {
                    const off = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: me.x + dx!, z: me.z + dz! }))
                        .find(q => { try { return isTileWalkable(bot.minusedlevel, q.x, q.z); } catch { return false; } });
                    if (off) { bot.sendRoute([off], true); bot.queueFlush(); await bot.tick(1); }
                }
            }
            if (o.useItem) {
                const id = objId(o.useItem), slot = bot.slot(id);
                if (slot < 0) return false;
                routeNextTo(bot, n);
                if (levelUpOpen(bot)) bot.resumeDialogPage();
                bot.useItemOnNpc(n.idx, id, slot); bot.queueFlush();
            } else opNpcGo(bot, n, o.op ?? 1);
            sent = bot.tickCount; n0 = n; sends++;
            if (sends > 1) o.log?.(`re-op #${sends} npc ${type}@${n.x},${n.z} from ${JSON.stringify(t)}`);
        }
        await bot.tick(1);
    }
    return inDialog(bot);
}

import { objDebugName } from '../../../core.js';
import { drive, msgsSince } from '../../q-lib.js';
import { converse, walk } from '../f2p-a/fa-lib.js';
import { opHeld } from '../f2p-b/fb-lib.js';

/** fast start (stand walk when the npc is out of view, then opNpcUntilDialog) + fa-lib converse for the pages */
export async function talkRb(bot: SpeedBot, type: number, o: Parameters<typeof converse>[2]): Promise<boolean> {
    if (!o.done()) {
        // a page left open by the previous step (a door knock's npc line, a scripted chatplayer) would read as "our"
        // dialog: finish it first (rb16: Harold's op #2 cost 10 t)
        if (inDialog(bot)) { const e = bot.tickCount + 6; while (inDialog(bot) && bot.tickCount < e) { if (!bot.dialogOptions().length) bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); } closeChat(bot); }
        const n = npc(bot, type);
        if (o.stand && (!n || n.d > 10)) await walk(bot, o.stand, 4, `${o.label} stand`);
        const t1 = bot.tickCount;
        const r = await opNpcUntilDialog(bot, type, { useItem: o.useItem, op: o.op, maxTicks: 40, log: o.log });
        if (process.env.RB_DEBUG) o.log?.(`${o.label}: opNpcUntilDialog ${r} in ${bot.tickCount - t1}t chat ${bot.chatModalId} opts ${bot.dialogOptions().length} text ${JSON.stringify([...bot.ifText.values()].filter(v => v).slice(-1))}`);
    }
    return converse(bot, type, { ...o, noOp: inDialog(bot) });
}

/** Rub a charged jewellery item (OPHELD4) and pick the destination by option text; resolves when the position jumps.
 *  (lib-troll rubTeleport without its Ctx; never in the same flush as a CLOSE_MODAL: the engine drops the OPHELD4) */
export async function rubTele(bot: SpeedBot, base: RegExp, dest: RegExp, maxTicks = 12): Promise<boolean> {
    const p0 = bot.pos();
    const moved = () => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level;
    for (let k = 0; k < 3 && !moved(); k++) {
        const item = bot.inv().find(s => base.test(objDebugName(s.obj)));
        if (!item) return false;
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { closeChat(bot); bot.queueFlush(); await bot.tick(1); }
        opHeld(bot, 4, item.obj, item.slot);
        await drive(bot, moved, [dest], maxTicks, 1);
    }
    return moved();
}

/** OPLOC a loc (route + op, re-sent while standing still) until a dialog opens or `done`; then answer pages/choices until done */
export async function locDialog(bot: SpeedBot, op: () => void, done: () => boolean, answers: RegExp[], maxTicks = 60): Promise<boolean> {
    const end = bot.tickCount + maxTicks;
    let prev = '', st = 0, sent = -99;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (inDialog(bot)) { await drive(bot, () => done() || !inDialog(bot), answers, end - bot.tickCount); continue; }
        const t = bot.tile(), k = `${t.x},${t.z},${bot.minusedlevel}`; st = k === prev ? st + 1 : 0; prev = k;
        if (sent < 0 || (st >= 3 && bot.tickCount - sent >= 4)) { op(); sent = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}
export const msgSeen = (bot: SpeedBot, since: number, re: RegExp) => msgsSince(bot, since).some(t => re.test(t));

/** RB_TRACE: log every stall (same tile >= 3 t, no dialog) with its tile and length; returns a stop function */
export function stallTrace(bot: SpeedBot, L: (s: string) => void): () => void {
    let stop = false;
    (async () => {
        let prev = '', since = bot.tickCount;
        while (!stop && !bot.disposed) {
            const t = bot.tile(), k = `${bot.minusedlevel},${t.x},${t.z}`;
            if (process.env.RB_TRACE === '2' && bot.tickCount % 3 === 0) L(`  @${k}`);
            if (k !== prev) {
                const n = bot.tickCount - since;
                if (n >= 3 && prev) L(`  stall ${n}t at ${prev}${inDialog(bot) ? ' (dialog)' : ''}`);
                prev = k; since = bot.tickCount;
            }
            await bot.tick(1);
        }
    })();
    return () => { stop = true; };
}

/**
 * Every IF_SETTEXT this bot receives, with its tick. A 5-resume burst runs several chat pages inside one server tick and
 * bot.ifText keeps only the last text per component, so textSince() misses the pages in between (rb17-rb26: Eohric's
 * "Perhaps he'd open up after a drink?" was never seen and converse re-talked, ~5 t each). Installed once per bot by
 * wrapping this instance's ifText.set (no shared file changed).
 */
const TEXTLOG = new WeakMap<object, Array<{ t: number; v: string }>>();
export function textLog(bot: SpeedBot): Array<{ t: number; v: string }> {
    let log = TEXTLOG.get(bot);
    if (!log) {
        const l: Array<{ t: number; v: string }> = [];
        log = l; TEXTLOG.set(bot, l);
        const m = bot.ifText, orig = m.set.bind(m);
        m.set = (k: number, v: string) => { if (v) { l.push({ t: bot.tickCount, v }); if (l.length > 400) l.splice(0, 200); } return orig(k, v); };
    }
    return log;
}
/** a chat/interface text matching `re` arrived at or after tick `since` (needs textLog(bot) installed before) */
export function textSeen(bot: SpeedBot, since: number, re: RegExp): boolean {
    // a page's text is split over several line components ("...Perhaps he'd open" + "up after a drink?"): match the
    // texts joined in arrival order
    return re.test(textLog(bot).filter(e => e.t >= since).map(e => e.v).join(' '));
}

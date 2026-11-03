/// <reference types="bun" />
// fg-lib.ts — helpers for lane f2p-b's Goblin Diplomacy + Black Knights' Fortress legs (agent "fg"). Cheat-free.
// Builds on fb-lib.ts (imported unchanged) and the framework (q-lib.ts / core.ts). Nothing here edits a shared file.
import * as rsmodPF from '../../../../../../vendor/rsmod-pathfinder';
import { SpeedBot, objId, cheb, stepOpen } from '../../../core.js';
import { nav, navSync, walkOp, inDialog, npc, climb as qClimb, doorOpen as qDoorOpen, type Tile, type Wall } from '../../q-lib.js';
import { fail, openNpc, answerUntil } from './fb-lib.js';

/**
 * Double-door LEFT leaves (doubledoors.rs2:40-52: left leaf angle+3, right +1; goblin generals' hut 1516/1517 at 2957,3509,
 * sim fg1-3303). MIGRATED: the framework walls every open leaf from the zone stream's
 * own angle (speedrun/leaf-walls.ts), so left leaves are exact and there is nothing to correct. Kept as a no-op for callers.
 */
export function fixDoubleLeaves(_bot: SpeedBot, _radius = 30): number { return 0; }

/** Use one backpack item on another (OPHELDU). `use` is the selected item, `on` the target. True when sent. */
export function useOn(bot: SpeedBot, use: string, on: string): boolean {
    const u = objId(use), t = objId(on), us = bot.slot(u), ts = bot.slot(t);
    if (us < 0 || ts < 0) return false;
    bot.useItemOnItem(t, ts, u, us); bot.queueFlush();
    return true;
}

/**
 * Talk to an npc and drive the whole conversation adaptively (resume pages in bursts, answer choices by text) until the
 * chat closes. Returns the texts shown (IF_SETTEXT diffs), so the caller can check which conversation it was: quest
 * varps are not transmitted. `done` short-cuts (an item observable).
 */
export async function talkAll(bot: SpeedBot, type: number | number[], at: Tile, answers: RegExp[], label: string,
    o: { stand?: Tile; maxTicks?: number; done?: () => boolean; burst?: number; keepOpen?: boolean } = {}): Promise<string[]> {
    // keepOpen: a chat already open is this npc's (the caller chained the OPNPC): drive it instead of closing it
    if (bot.chatModalId !== -1 && !o.keepOpen) { bot.closeModal(); await bot.tick(1); }
    const seen: string[] = [];
    const snap = new Map(bot.ifText);
    const collect = () => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v) { seen.push(v); snap.set(k, v); } };
    await nav();
    let fixT = -100;
    const fix = () => { if (bot.tickCount - fixT >= 3) { fixT = bot.tickCount; fixDoubleLeaves(bot); } };
    fix();
    await openNpc(bot, type, at, label, { stand: o.stand, done: () => { fix(); return inDialog(bot) || (o.done?.() ?? false); } });
    collect();
    const end = bot.tickCount + (o.maxTicks ?? 40);
    let lastSig = '', lastClick = -99;
    while (bot.tickCount < end && !bot.disposed) {
        collect();
        if (bot.chatModalId === -1) break;
        const opts = bot.dialogOptions();
        if (opts.length) {
            // one click per choice page (a second click on a still-shown page lands on the next page)
            const sig = opts.map(x => x.text).join('|');
            if (sig !== lastSig || bot.tickCount - lastClick >= 4) {
                let hit = -1;
                for (const re of answers) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                if (hit < 0) fail(bot, `${label}: unplanned choice [${opts.map(x => x.text).join(' | ')}]`);
                lastSig = sig; lastClick = bot.tickCount;
            }
        } else for (let i = 0; i < (o.burst ?? 5); i++) bot.resumeDialogPage();
        bot.queueFlush();
        await bot.tick(1);
        if (o.done?.() && bot.chatModalId === -1) break;
    }
    collect();
    if (bot.chatModalId !== -1 && !(await answerUntil(bot, () => !inDialog(bot), answers, 20))) fail(bot, `${label}: chat did not close`);
    return seen;
}

/** Climb a staircase/ladder (walkOp with the op on the last chunk, re-op every 4 t until the level changes).
 *  MIGRATED q-lib climb (the fk-lib/fg-lib copy moved into the framework); fails the quest like before. */
export async function climb(bot: SpeedBot, loc: { id: number; x: number; z: number; level: number }, stand: Tile, label: string, op = 1, maxTicks = 300): Promise<void> {
    if (!(await qClimb(bot, loc, stand, op, { maxTicks }))) fail(bot, `${label}: climb ${loc.id} failed`);
}

/** Runes for a spell are in the pack (no staff assumed except the wielded one, which the caller passes as 0). */
export function hasRunes(bot: SpeedBot, need: Record<string, number>): boolean {
    return Object.entries(need).every(([k, n]) => bot.count(objId(k)) >= n);
}

/** Wear backpack items (OPHELD2) until worn; resolves when none of them is left in the pack. */
export async function wear(bot: SpeedBot, items: string[], label = 'wear'): Promise<void> {
    const t0 = bot.tickCount;
    while (items.some(i => bot.count(objId(i)) > 0)) {
        if (bot.tickCount - t0 > 10) fail(bot, `${label}: could not wear ${items.filter(i => bot.count(objId(i)) > 0).join(',')}`);
        for (const i of items) { const id = objId(i), s = bot.slot(id); if (s >= 0) bot.opHeld2(id, s); }
        bot.queueFlush();
        await bot.tick(1);
    }
}

export { cheb, npc };

/** FG_DEBUG=1: per-tick monitor line (pos, chat/main modal, nearby npcs of `types`, new game messages). Returns a stopper. */
export function monitor(bot: SpeedBot, types: number[], label = 'mon'): { stop: boolean } {
    const st = { stop: false };
    if (!process.env.FG_DEBUG) return st;
    const { npcsOf, msgsSince } = require('../../q-lib.js');
    (async () => {
        let t = bot.tickCount;
        while (!st.stop && !bot.disposed) {
            const ns = npcsOf(bot, types).slice(0, 3).map((q: any) => `${q.type}@${q.x},${q.z}`).join(' ');
            const m = msgsSince(bot, t); t = bot.tickCount;
            console.log(`[${label} t${bot.tickCount}] me=${bot.tile().x},${bot.tile().z} chat=${bot.chatModalId} main=${bot.mainModalId} npcs=${ns}${m.length ? ' msg=' + m.join(' | ') : ''}`);
            await new Promise(r => setTimeout(r, 0));
            await bot.until(() => false, 1);
        }
    })();
    return st;
}

/** Is the single door `id` at (x,z,l) open? MIGRATED q-lib doorOpen (the same exact leaf-tile rule: the leaf
 *  stands on the door's own tile or across its own edge, never a neighbour's: BKF L1 pair 3019/3021,3515, sim fgb4). */
export function doorOpen(bot: SpeedBot, id: number, x: number, z: number, l: number): boolean { return qDoorOpen(bot, id, x, z, l); }

/** Process-wide rsmod walls along the south edge of row `z` for x in [x0, x1] (keep the planner out of the wilderness);
 *  returns an undo. Only edges that are open statically are added/removed. */
export function wallRow(z: number, x0: number, x1: number, level = 0): () => void {
    const n = navSync(), added: number[] = [];
    for (let x = x0; x <= x1; x++) {
        void n; if (!stepOpen(level, x, z - 1, x, z)) continue;   // core.ts stepOpen = the 3-step probe
        rsmodPF.changeWall(x, z, level, 3, 0, false, false, true); added.push(x);
    }
    return () => { for (const x of added) rsmodPF.changeWall(x, z, level, 3, 0, false, false, false); };
}

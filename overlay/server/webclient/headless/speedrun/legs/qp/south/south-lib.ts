/// <reference types="bun" />
// south-lib.ts — lane-local helpers for the south lane's quest code (cheat-free: never calls cheat/setvar/localSetup).
// Framework: q-lib.ts (talk, walkOp, opNpcGo, npc), core.ts (SpeedBot). Anything here the framework should own is listed
// under "Framework requests" in STATUS.md.
import { NO_GLORY, noGloryHop } from '../noglory.js';
import { ClientProt } from '#/io/ClientProt.js';
import { SpeedBot, objId, objDebugName, cheb, densify } from '../../../core.js';
import {
    npc, npcsOf, navSync, nav, turning, walkOp, levelUpOpen, inDialog, msgsSince, opLocGo, routeToLoc, dismiss, opNpcGo, talk,
    opHeld as qOpHeld, msgMark, msgAfterMark, textLog, textMark, sawText,
    type NpcRef, type Tile, type FTok, type TalkOpts,
} from '../../q-lib.js';
import * as locScene from '../../../../loc-scene.js';

export type Item = { name: string; n: number };
export const INV_COM = 3214;   // inventory:inv (leanbot.ts INV_INTERFACE)

export class QuestFail extends Error {}
/** Throw with position + pack, so a failed proof run says where it stopped. */
export function fail(bot: SpeedBot, s: string): never {
    const p = bot.pos();
    throw new QuestFail(`${s} @ (${p.x},${p.z},L${p.level}) hp=${bot.stat('hitpoints').cur} pack=[${bot.inv().map(x => `${objDebugName(x.obj)}x${x.count}`).join(',')}]`);
}
export function dead(bot: SpeedBot): boolean { return bot.stat('hitpoints').level > 0 && bot.stat('hitpoints').cur === 0; }

/** OPHELD<op> on a backpack item (op 4 = Rub on jewellery). MIGRATED q-lib opHeld. */
export function opHeld(bot: SpeedBot, obj: number | string, op: 1 | 2 | 3 | 4 | 5): boolean { return qOpHeld(bot, obj, op); }

export function opNpcN(bot: SpeedBot, index: number, op: 1 | 2 | 3 | 4 | 5): void { bot.opNpc(index, op); bot.queueFlush(); }
/** q-lib opNpcGo (route next to the npc in the same tick) for any op 1-5. MIGRATED opNpcGo carries ops 4/5 now. */
export function opNpcGoN(bot: SpeedBot, n: NpcRef, op: 1 | 2 | 3 | 4 | 5): void { opNpcGo(bot, n, op); }

/** A static scene loc at (x,z) by id; `asId` re-labels it (a loc_change'd loc keeps the static footprint). */
export function locHere(id: number, x: number, z: number, level = 0, asId?: number): locScene.SceneLoc {
    const all = locScene.getLocsAt(x, z, level, { includeUnnamed: true });
    const l = all.find(s => s.id === id);
    if (!l) throw new Error(`loc ${id} not at L${level}(${x},${z})`);
    return asId === undefined ? l : { ...l, id: asId };
}
/** The loc id on a tile right now (zone-stream override, else the static one we name). */
export function liveId(bot: SpeedBot, x: number, z: number, staticId: number, level = 0): number {
    return bot.liveLocs.get(`${level},${x},${z}`) ?? staticId;
}

/** Zone-stream loc events with their tick ("level,x,z" -> {id, tick}); wraps core's liveLocs hook once per bot. A zone
 *  re-sync after walking back into view does NOT replay a revert to the static loc, so liveLocs can hold a stale
 *  loc_change'd id: use the event tick to judge freshness. */
const LOC_EVENTS = new WeakMap<SpeedBot, Map<string, { id: number; tick: number }>>();
export function locEvents(bot: SpeedBot): Map<string, { id: number; tick: number }> {
    let m = LOC_EVENTS.get(bot);
    if (m) return m;
    m = new Map(); LOC_EVENTS.set(bot, m);
    const prev = bot.onLocZoneChange, mm = m;
    bot.onLocZoneChange = (level, x, z, locId) => { prev?.(level, x, z, locId); mm.set(`${level},${x},${z}`, { id: locId, tick: bot.tickCount }); };
    return m;
}
/** Game messages (MESSAGE_GAME) received strictly after `tick` that match `re`. WARNING: a message caused by an action
 *  sent on tick T can carry tick label T (decoded before that cycle's PLAYER_INFO): prefer chatMark/chatSince. */
export function msgAfter(bot: SpeedBot, tick: number, re: RegExp): boolean {
    return (bot as any).getChat({ types: [0], limit: 0, includeSelf: true }).some((m: any) => m.tick > tick && re.test(m.text));
}
/** A mark in the game-message log. MIGRATED (fix 6): q-lib msgMark (the chat log's monotonic cursor; was the
 *  newest line object). Opaque to callers: pass it to chatSince. */
export function chatMark(bot: SpeedBot): number { return msgMark(bot); }
/** Did a game message matching `re` arrive after `mark` (no tick-label ambiguity)? MIGRATED q-lib msgAfterMark. */
export function chatSince(bot: SpeedBot, mark: unknown, re: RegExp): boolean { return msgAfterMark(bot, typeof mark === 'number' ? mark : 0, re); }

/** Every IF_SETTEXT the client decodes, in order ({tick, com, text}); a mark into it; did any text after the mark match (each
 *  tick's lines also matched joined). MIGRATED (fix 10): q-lib textLog / textMark / sawText (this was their origin;
 *  the framework one also strips colour tags). */
export { textLog, textMark, sawText };

/** Re-send `send` every `every` ticks until `done` (max `maxTicks`). */
export async function retry(bot: SpeedBot, send: () => void, done: () => boolean, maxTicks: number, every = 3): Promise<boolean> {
    const end = bot.tickCount + maxTicks;
    let last = -100;
    while (!done()) {
        if (bot.tickCount >= end || bot.disposed || dead(bot)) return done();
        if (bot.tickCount - last >= every) {
            if (levelUpOpen(bot)) bot.resumeDialogPage();
            send(); bot.queueFlush(); last = bot.tickCount;
        }
        await bot.tick(1);
    }
    return true;
}
/** Route to the loc + op, re-sent until `done`. */
export function opLocUntil(bot: SpeedBot, loc: locScene.SceneLoc, op: number, done: () => boolean, maxTicks = 40, every = 4): Promise<boolean> {
    return retry(bot, () => opLocGo(bot, loc, op), done, maxTicks, every);
}
/** Use an inventory item on a loc (route + OPLOCU), re-sent until `done`. */
export function useOnLocUntil(bot: SpeedBot, obj: number | string, loc: locScene.SceneLoc, done: () => boolean, maxTicks = 40, every = 4): Promise<boolean> {
    const id = objId(obj);
    return retry(bot, () => { const s = bot.slot(id); if (s < 0) return; routeToLoc(bot, loc); bot.useItemOnLoc(loc.x, loc.z, loc.id, id, s); }, done, maxTicks, every);
}

/** Wear/wield every held item in `names` (burst), wait until worn. */
export async function wear(bot: SpeedBot, names: string[], maxTicks = 6): Promise<boolean> {
    const ids = names.map(objId).filter(id => !bot.isWorn(id) && bot.slot(id) >= 0);
    if (!ids.length) return names.map(objId).every(id => bot.isWorn(id));
    bot.burst(ids.map(id => () => bot.opHeld2(id, bot.slot(id))));
    return bot.until(() => ids.every(id => bot.isWorn(id)), maxTicks);
}
/** Unequip until it is no longer worn (a p_delay'd script drops the first click). */
export async function unwear(bot: SpeedBot, obj: number | string, maxTicks = 12): Promise<boolean> {
    const id = objId(obj);
    return retry(bot, () => { if (bot.isWorn(id)) bot.unequipItem(id); }, () => !bot.isWorn(id), maxTicks, 2);
}

/** HP: eat the first food in `foods` when hp <= frac of max. */
export const FOODS = ['shark', 'manta_ray', 'sea_turtle', 'monkfish', 'swordfish', 'lobster', 'bass', 'tuna', 'salmon', 'trout', 'cake', '2/3_cake', 'slice_of_cake'];
const lastEat = new WeakMap<SpeedBot, number>();
export function eatIfLow(bot: SpeedBot, frac = 0.5, foods = FOODS): boolean {
    const hp = bot.stat('hitpoints');
    if (hp.cur <= 0 || hp.cur > Math.floor(hp.level * frac) || bot.tickCount - (lastEat.get(bot) ?? -10) < 3) return false;
    for (const f of foods) {
        let id: number; try { id = objId(f); } catch { continue; }
        const s = bot.slot(id); if (s < 0) continue;
        bot.opHeld1(id, s); bot.queueFlush(); lastEat.set(bot, bot.tickCount); return true;
    }
    return false;
}
export function foodCount(bot: SpeedBot, foods = FOODS): number {
    let n = 0; for (const f of foods) { try { n += bot.count(objId(f)); } catch { /* not an obj */ } } return n;
}

/** Glory rub (OPHELD4) + the destination (amulet_of_glory.rs2:13: 1 Edgeville, 2 Karamja, 3 Draynor, 4 Al Kharid). */
const M5 = [2494, 2495, 2496, 2497, 2498];
export async function glory(bot: SpeedBot, dest: 1 | 2 | 3 | 4): Promise<boolean> {
    if (NO_GLORY()) return noGloryHop(bot, dest, `south glory ${dest}`);   // charger pair (SR_NO_GLORY=1, noglory.ts)
    const names = ['amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'];
    const p0 = bot.pos();
    for (let k = 0; k < 3; k++) {
        const g = names.map(n => objId(n)).find(i => bot.count(i) > 0);
        if (g === undefined) return false;
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) bot.closeModal();
        // the rub runs its script inside the packet handler (p_choice5 opens at once): the answer rides the same burst
        opHeld(bot, g, 4); bot.ifButton(M5[dest - 1]!); bot.queueFlush();
        await bot.tick(1);
        if (bot.dialogOptions().length >= 4) { const o = bot.dialogOptions(); bot.ifButton(o[dest - 1]!.com); bot.queueFlush(); }
        if (await bot.until(() => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level, 10)) return true;
    }
    return false;
}

/** Ground item of `obj` within `r` tiles (LeanBot's OBJ_ADD tracker). */
export function groundOf(bot: SpeedBot, obj: number | string, r = 10): { x: number; z: number; obj: number; count: number } | undefined {
    return (bot as any).findGroundItem(objId(obj), r);
}

/** Talk to the nearest npc of `type` even across closed doors: walkOp (door tracker) to the npc with the OPNPC on the
 *  last chunk, then the plan burst (q-lib talk, noOp). q-lib talk alone routes with rsmod, which treats closed doors as
 *  open: an npc that wandered out of a building (Lucien left the Ardougne inn) is never reached. */
export async function talkTo(bot: SpeedBot, type: number | number[], plan: FTok[], o: TalkOpts & { tries?: number; walkTicks?: number; at?: Tile } = {}): Promise<boolean> {
    const done = o.done ?? (() => false);
    for (let k = 0; k < (o.tries ?? 3) && !done(); k++) {
        if (dead(bot)) return false;
        if (!inDialog(bot)) {
            let n = npc(bot, type);
            // not in view (or far): walk to its home tile first
            if ((!n || n.d > 14) && o.at) { await walkOp(bot, o.at, null, () => { const m = npc(bot, type); return !!m && m.d <= 8; }, { near: 2, maxTicks: o.walkTicks ?? 300 }); n = npc(bot, type); }
            if (!n) { await bot.tick(2); continue; }
            // 1) the direct way (rsmod route + OPNPC in one tick): enough unless a closed door is in between
            opNpcGo(bot, n, 1);
            if (!(await bot.until(() => inDialog(bot) || done(), Math.ceil(n.d / 2) + 4))) {
                // 2) door-aware walk next to it (the door tracker opens doors on the way), then the OPNPC
                await walkOp(bot, { x: n.x, z: n.z }, () => { const m = npc(bot, type); if (!m) return false; opNpcGo(bot, m, 1); }, () => inDialog(bot) || done(),
                    { near: 2, maxTicks: o.walkTicks ?? 60 });
                if (!inDialog(bot)) await bot.until(() => inDialog(bot) || done(), 4);
            }
            if (!inDialog(bot)) continue;
        }
        await talk(bot, type, plan, { ...o, noOp: true });
    }
    return done();
}

/** walkOp with a hard fail. */
export async function go(bot: SpeedBot, dest: Tile, label: string, o: { near?: number; maxTicks?: number; finalOp?: (() => void | boolean) | null; done?: () => boolean } = {}): Promise<void> {
    const done = o.done ?? (() => cheb(bot.tile(), dest) <= (o.near ?? 0));
    if (!(await walkOp(bot, dest, o.finalOp ?? null, done, { near: o.near ?? 0, maxTicks: o.maxTicks ?? 600 }))) fail(bot, `${label}: walk to (${dest.x},${dest.z}) failed`);
}

export { npc, npcsOf, navSync, nav, turning, walkOp, inDialog, msgsSince, dismiss, densify, cheb };
export type { NpcRef, Tile };

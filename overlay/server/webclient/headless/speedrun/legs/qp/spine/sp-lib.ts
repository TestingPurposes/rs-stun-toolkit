/// <reference types="bun" />
// sp-lib.ts — lane "spine" helpers (Dragon Slayer, Hero's Quest, Family Crest). Cheat-free. Built on the framework
// (q-lib.ts / core.ts / run-lib.ts); nothing here edits a shared file. The npc/door/walk patterns follow lane f2p-b's
// fb-lib.ts (sim-proven there), copied so the lanes stay independent.
import { failHook } from '../journal.js';
import { reconnectsOf } from '../route/drops.js';
import { NO_GLORY, noGloryHop } from '../noglory.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ClientProt } from '#/io/ClientProt.js';
import { getLocsAt } from '../../../../loc-scene.js';
import * as ls from '../../../../loc-scene.js';
import { SpeedBot, objId, objDebugName, cheb, densify, spellCom } from '../../../core.js';
import {
    nav, navSync, npc, npcsOf, inDialog, walkOp, opNpcGo, dismiss, routeToLoc, msgsSince, situation, turning, levelUpOpen,
    opHeld as qOpHeld, useOnNpcGo as qUseOnNpcGo, type NpcRef, type Tile, type Wall,
} from '../../q-lib.js';
import { leafWallList } from '../../../leaf-walls.js';

export type Item = { name: string; n: number };
export const QUESTSCROLL = 297;   // interface.pack 297=questscroll (send_quest_complete opens it, general/scripts/quests.rs2:27-60)
const INV_COM = 3214;             // inventory:inv
export const WILD_WARNING = 1908;  // interface.pack 1908=wilderness_warning

export class QuestFail extends Error { }
export function fail(bot: SpeedBot, s: string): never { throw new QuestFail(`${s} at ${JSON.stringify(bot.pos())} | ${situation(bot)}`); }

/** One line per step with the tick offset from the quest's t0; split(k) records a named segment. */
export function mkLog(bot: SpeedBot, tag: string, on = true) {
    const t0 = bot.tickCount;
    const splits: Record<string, number> = {};
    let last = t0;
    const f = (s: string) => { if (on) console.log(`[${tag} +${String(bot.tickCount - t0).padStart(5)}] ${s}`); };
    f.split = (k: string) => { splits[k] = bot.tickCount - last; last = bot.tickCount; f(`${k} (${splits[k]} t) pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur} free=${bot.free()} gp=${bot.count(995)}`); failHook(k); };
    f.splits = splits; f.t0 = t0;
    return f;
}
export type Log = ReturnType<typeof mkLog>;

// ---------------------------------------------------------------------------------------------------------------------
// doors / walking
// ---------------------------------------------------------------------------------------------------------------------
/** Open door leaves near us as planner walls. MIGRATED: the framework walls every
 *  open leaf on the shared planner map from the zone stream's exact angle (speedrun/leaf-walls.ts); this lists them. */
export function leafWalls(bot: SpeedBot, radius = 30): Wall[] {
    const me = bot.tile(), lv = bot.minusedlevel;
    return leafWallList().filter(w => w.level === lv && Math.max(Math.abs(w.x - me.x), Math.abs(w.z - me.z)) <= radius)
        .map(w => ({ level: w.level, x: w.x, z: w.z, shape: 0, angle: w.angle }));
}

/** Walk (walkOp: navgrid/rsmod + live door tracker); falls back to SpeedBot.walkTo (multi-level traveller). */
export async function go(bot: SpeedBot, dest: Tile, near = 0, label = 'go', maxTicks = 1500, level?: number): Promise<void> {
    await nav();
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) dismiss(bot);
    const lv = level ?? bot.minusedlevel;
    startWarningCloser(bot);
    const at = () => bot.minusedlevel === lv && cheb(bot.tile(), dest) <= near && (near > 0 || (bot.tile().x === dest.x && bot.tile().z === dest.z));
    if (at()) return;
    if (lv === bot.minusedlevel && await walkOp(bot, dest, null, at, { near, maxTicks, log: false })) return;   // leaf walls: on the map (framework)
    if (at()) return;
    const r = await bot.walkTo(dest.x, dest.z, { near, maxTicks, level: lv, log: false, closeDoors: true });
    if (!r.ok && !at()) fail(bot, `${label}: walk to (${dest.x},${dest.z}) failed`);
}

/** QTRACE=1: one line per tick when this bot's tile / level / modal / hp / prayer changes (tagged, for two-bot runs). */
export function spTrace(bot: SpeedBot, tag: string): void {
    if (process.env.QTRACE !== '1') return;
    const b = bot as any; if (b.__spTrace) return; b.__spTrace = true;
    const t0 = bot.tickCount; let last = '';
    (async () => {
        while (!bot.disposed) {
            const p = bot.pos();
            const s = `(${p.x},${p.z},L${p.level}) hp=${bot.stat('hitpoints').cur} pr=${bot.stat('prayer').cur} chat=${bot.chatModalId} main=${bot.mainModalId}`;
            if (s !== last) console.log(`[${tag} t+${bot.tickCount - t0}] ${s}`);
            last = s;
            await bot.tick(1);
        }
    })();
}
/** Auto-retaliate off (IF_BUTTON 151, leanbot.ts RETALIATE_OFF_BUTTON; auto_retaliate.rs2:3-22): an attacker otherwise
 *  hijacks every loc/npc interaction (sim spc3: the Witchaven lever never toggled while ogres hit us). */
export function retaliateOff(bot: SpeedBot): void { bot.ifButton(151); bot.queueFlush(); }
/** Background: close the wilderness warning whenever it opens (once per process per bot). */
export function startWarningCloser(bot: SpeedBot): void {
    const b = bot as any; if (b.__spWarn) return; b.__spWarn = true;
    (async () => { while (!bot.disposed) { if (bot.mainModalId === WILD_WARNING) { bot.closeModal(); bot.queueFlush(); } await bot.tick(1); } })();
}
/** A loc at an exact tile (any layer, unnamed too). */
export function locHere(id: number, x: number, z: number, level = 0): ls.SceneLoc {
    const l = getLocsAt(x, z, level, { includeUnnamed: true }).find(s => s.id === id);
    if (!l) throw new Error(`loc ${id} not at L${level}(${x},${z})`);
    return l;
}
export function locIdOf(name: string): number {
    const m = locPack().get(name); if (m === undefined) throw new Error(`unknown loc ${name}`); return m;
}
let LOCPACK: Map<string, number> | null = null;
function locPack(): Map<string, number> {
    if (LOCPACK) return LOCPACK;
    LOCPACK = new Map();
    for (const line of readFileSync(resolve(import.meta.dir, '../../../../../../content/pack/loc.pack'), 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('='); if (i > 0) LOCPACK.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
    }
    return LOCPACK;
}
let NPCPACK: Map<string, number> | null = null;
export function npcIdOf(name: string): number {
    if (!NPCPACK) {
        NPCPACK = new Map();
        for (const line of readFileSync(resolve(import.meta.dir, '../../../../../../content/pack/npc.pack'), 'utf8').split(/\r?\n/)) {
            const i = line.indexOf('='); if (i > 0) NPCPACK.set(line.slice(i + 1).trim(), Number(line.slice(0, i)));
        }
    }
    const m = NPCPACK.get(name); if (m === undefined) throw new Error(`unknown npc ${name}`); return m;
}

/** Walk to `stand` (or the loc's interaction tile) and op the loc until done(); retries the op every `every` ticks. */
export async function opLocUntil(bot: SpeedBot, loc: ls.SceneLoc, op: number, done: () => boolean, label: string, o: { stand?: Tile; maxTicks?: number; every?: number } = {}): Promise<void> {
    await nav();
    if (done()) return;
    if (bot.chatModalId !== -1) dismiss(bot);
    const t0 = bot.tickCount, max = o.maxTicks ?? 120;
    if (o.stand && cheb(bot.tile(), o.stand) > 6) await go(bot, o.stand, 2, label, max);
    let last = -100;
    while (!done() && bot.tickCount - t0 < max && !bot.disposed) {
        if (bot.tickCount - last >= (o.every ?? 4)) {
            if (bot.chatModalId !== -1 && !inDialog(bot)) bot.resumeDialogPage();
            routeToLoc(bot, loc, o.stand); if (levelUpOpen(bot)) bot.resumeDialogPage();
            bot.opLoc(loc.x, loc.z, loc.id, op); bot.queueFlush(); last = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: oploc ${loc.id}@${loc.x},${loc.z} op${op} not done`);
}
/** Use a held item on a loc until done(). */
export async function useOnLocUntil(bot: SpeedBot, obj: number | string, loc: ls.SceneLoc, done: () => boolean, label: string, o: { stand?: Tile; maxTicks?: number; every?: number } = {}): Promise<void> {
    await nav();
    if (done()) return;
    const id = objId(obj);
    if (bot.chatModalId !== -1) dismiss(bot);
    const t0 = bot.tickCount, max = o.maxTicks ?? 120;
    if (o.stand && cheb(bot.tile(), o.stand) > 6) await go(bot, o.stand, 2, label, max);
    let last = -100;
    while (!done() && bot.tickCount - t0 < max && !bot.disposed) {
        if (bot.tickCount - last >= (o.every ?? 4)) {
            const s = bot.slot(id); if (s < 0) fail(bot, `${label}: ${objDebugName(id)} not held`);
            if (bot.chatModalId !== -1) dismiss(bot);
            routeToLoc(bot, loc, o.stand); if (levelUpOpen(bot)) bot.resumeDialogPage();
            bot.useItemOnLoc(loc.x, loc.z, loc.id, id, s); bot.queueFlush(); last = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: use ${objDebugName(id)} on loc ${loc.id}@${loc.x},${loc.z} not done`);
}

// ---------------------------------------------------------------------------------------------------------------------
// npcs + dialog
// ---------------------------------------------------------------------------------------------------------------------
/** opNpcGo, but a cardinal neighbour across a WALL is not adjacent (fb-lib opNpcReach). MIGRATED q-lib opNpcGo
 *  does this itself now (QLIB.doorAware), and opens a closed door on the way. */
export function opNpcReach(bot: SpeedBot, n: NpcRef, op = 1): number { return opNpcGo(bot, n, op); }

/** Walk near the npc's spawn `at` and open it with OPNPC `op` until done() (default: a dialog page is open). */
export async function openNpc(bot: SpeedBot, type: number | number[], at: Tile, label: string, o: { op?: number; near?: number; done?: () => boolean; maxTicks?: number; stand?: Tile; roam?: boolean } = {}): Promise<void> {
    await nav();
    const done = o.done ?? (() => inDialog(bot));
    if (done()) return;
    if (bot.chatModalId !== -1) dismiss(bot);
    if (o.stand && cheb(bot.tile(), o.stand) > 1) await go(bot, o.stand, 1, label, o.maxTicks ?? 600);
    const opN = () => { const n = npc(bot, type); if (!n) return false; opNpcReach(bot, n, o.op ?? 1); return true; };
    const t0 = bot.tickCount, max = o.maxTicks ?? 600;
    const n0 = npc(bot, type);
    if (!(n0 && n0.d <= 6)) await walkOp(bot, at, opN, done, { near: o.near ?? 3, maxTicks: max, log: false, walls: leafWalls(bot) });
    let lastOp = -100, ops = 0;
    while (!done() && bot.tickCount - t0 < max && !bot.disposed) {
        if (bot.tickCount - lastOp >= 5 && bot.chatModalId === -1) {
            // knocked back out of a building (a shut door between us and the npc: the npc op never opens doors, sim sp16 lost
            // 490 t outside Oziach's hut): walk to the stand again (walkOp opens doors)
            // session 11 fix 359 (o.roam, FC_JOHN_ROAM): a wandering npc IN VIEW is chased by opNpcReach (door-aware) alone; the
            // stand return here and the walkTo(spawn) below pulled us back every 5/15 t and fought every OPNPC route that leaves
            // the room (qx167m Johnathon in the Jolly Boar's east room, 606 t loop). Out of view: as before.
            const roam = !!o.roam && !!npc(bot, type);
            if (o.stand && ops > 0 && !roam && cheb(bot.tile(), o.stand) > 1) await go(bot, o.stand, 1, label, 200);
            // route session 5 (allchaos qsip Dragon 'guildmaster: npc 198 not opened' x2 at (3194,3357), outside the Champions'
            // Guild with its door in a random state): every 3rd op, core walkTo to the npc's spawn (door-aware, closeDoors)
            if (ops >= 3 && ops % 3 === 0 && !roam && cheb(bot.tile(), at) > 2) { try { await bot.walkTo(at.x, at.z, { near: 2, closeDoors: true, maxTicks: 120, log: false }); } catch { /* best effort */ } }
            if (!opN()) { const n = npc(bot, type); if (!n && cheb(bot.tile(), at) > 2) await go(bot, at, 2, label, 200); }
            lastOp = bot.tickCount; ops++;
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: npc ${type} not opened`);
}

/** Choice picker: given the visible option texts return the index to click (or -1 = none matched). */
export type Picker = (opts: string[]) => number;
/** Picker from an ordered regex list (first regex that matches any option wins). */
export function byText(...res: RegExp[]): Picker {
    return opts => { for (const re of res) { const i = opts.findIndex(t => re.test(t)); if (i >= 0) return i; } return -1; };
}
/**
 * Drive the open chat until done(): plain pages get a 5-resume burst (each RESUME runs the script synchronously, so
 * up to 5 pages per tick; a resume that does not apply is dropped, ResumePauseButtonHandler.ts); a choice page gets ONE
 * click + 4 resumes, then waits for the option list to change before clicking again (multi pages reuse one interface).
 */
export async function chat(bot: SpeedBot, pick: Picker, done: () => boolean, label: string, maxTicks = 60): Promise<void> {
    const end = bot.tickCount + maxTicks;
    let lastSig = '', lastClick = -100;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (bot.chatModalId !== -1) {
            const opts = bot.dialogOptions();
            if (opts.length) {
                const sig = opts.map(x => x.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 4) {
                    const i = pick(opts.map(x => x.text));
                    if (i < 0) fail(bot, `${label}: unplanned choice [${sig}]`);
                    bot.ifButton(opts[i]!.com);
                    for (let k = 0; k < 4; k++) (bot as any).sendResume(bot.chatModalId);
                    bot.queueFlush(); lastSig = sig; lastClick = bot.tickCount;
                }
            } else {
                for (let k = 0; k < 5; k++) (bot as any).sendResume(bot.chatModalId);
                bot.queueFlush(); lastSig = '';
            }
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: chat not done (options ${JSON.stringify(bot.dialogOptions().map(x => x.text))})`);
}
/** Wait until done(), continuing any plain chat page on the way (many scripts show a mesbox BEFORE the effect, e.g.
 *  ned.rs2:330-331, magic_door.rs2:56-57). Choice pages are left alone. */
export async function untilChat(bot: SpeedBot, done: () => boolean, maxTicks: number): Promise<boolean> {
    return bot.until(() => { if (done()) return true; if (bot.chatModalId !== -1 && !bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); } return false; }, maxTicks);
}
/** openNpc + chat. */
export async function converse(bot: SpeedBot, type: number | number[], at: Tile, pick: Picker, done: () => boolean, label: string, o: { op?: number; maxTicks?: number; stand?: Tile; near?: number; roam?: boolean } = {}): Promise<void> {
    if (done()) return;
    // session 10 (generic drop-proofing): a reconnect closes the dialog server-side and kills the npc script; when the talk
    // failed (or ended not done) after a reconnect, open the npc again, up to 2 more times (SP_CONVERSE_REOP=0 = old)
    const acct = String((bot as any).loginUser ?? '').toLowerCase();
    for (let k = 0; ; k++) {
        const rc = reconnectsOf(acct);
        let cut = false;
        try {
            await openNpc(bot, type, at, label, { op: o.op, stand: o.stand, near: o.near, roam: o.roam, done: () => inDialog(bot) || done() });
            if (done()) return;
            // fix 392c TEST (SP_SHUT_TEST=<label>): cut the just-opened dialog once (IF_CLOSE), as qx324p's re-sent OPNPC did
            if (process.env.SP_SHUT_TEST === label && k === 0) { bot.closeModal(); await bot.tick(2); }
            await chat(bot, pick, done, label, o.maxTicks ?? 60);
            if (done() || reconnectsOf(acct) === rc || k >= 2 || process.env.SP_CONVERSE_REOP === '0') return;
        } catch (e) {
            if (done()) return;
            // session 11 fix 392c (qx324p 'katrine: chat not done (options [])': her dialog opened (eng t42901), a re-sent OPNPC
            // closed it while simdoors had just shut her door, the server walked us round the house, chat() waited 60 t on no
            // dialog): a talk that ended with NO dialog open (cut, not a wrong answer) is re-opened like a reconnect (openNpc's
            // every-3rd-op door-aware walkTo gets back in). SP_CONVERSE_SHUT=0 reverts.
            cut = process.env.SP_CONVERSE_SHUT !== '0' && bot.chatModalId === -1 && /chat not done \(options \[\]\)/.test(String((e as Error).message));
            if ((reconnectsOf(acct) === rc && !cut) || k >= 2 || process.env.SP_CONVERSE_REOP === '0') throw e;
        }
        console.log(`[sp] ${label}: ${cut ? 'dialog cut' : 'reconnect during the talk'}, not done: re-opening (${k + 1})`);
        await clearModals(bot);
    }
}
/** Text seen since `since` (IF_SETTEXT changed after the snapshot, or a game message). */
export function textWatch(bot: SpeedBot) {
    const log = textLog(bot); const i0 = log.length; const since = bot.tickCount;
    // chat pages arrive one line per component (a long npc line is split): also test the new strings joined by spaces
    return (re: RegExp) => {
        for (let i = i0; i < log.length; i++) if (re.test(log[i]!)) return true;
        if (log.length > i0 && re.test(log.slice(i0).join(' '))) return true;
        return msgsSince(bot, since).some(t => re.test(t));
    };
}
/** Every IF_SETTEXT string in arrival order (a burst of dialog pages overwrites the same components within one tick, so
 *  reading bot.ifText afterwards misses the middle pages). Wraps this bot's ifText.set once; framework untouched. */
export function textLog(bot: SpeedBot): string[] {
    const b = bot as any;
    if (!b.__spTextLog) {
        const arr: string[] = []; b.__spTextLog = arr;
        const m = bot.ifText as Map<number, string>; const orig = m.set.bind(m);
        m.set = (k: number, v: string) => { arr.push(v); return orig(k, v); };
    }
    return b.__spTextLog;
}
/** Close every chat/main modal (level-ups, mesboxes, quest scroll). */
export async function clearModals(bot: SpeedBot, maxTicks = 6): Promise<void> {
    for (let k = 0; k < maxTicks && (bot.chatModalId !== -1 || bot.mainModalId !== -1); k++) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
}

// ---------------------------------------------------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------------------------------------------------
/** OPHELD<op> on a backpack item (op 4 = Rub on a glory, op 1 = Read/Eat...). MIGRATED q-lib opHeld. */
export function opHeldN(bot: SpeedBot, obj: number, op: number): void {
    if (!qOpHeld(bot, obj, op as 1 | 2 | 3 | 4 | 5)) throw new Error(`opHeldN: ${objDebugName(obj)} not held`);
}
export function useItemOnItem(bot: SpeedBot, a: number | string, b: number | string): void {
    const ia = objId(a), ib = objId(b);
    bot.useItemOnItem(ib, bot.slot(ib), ia, bot.slot(ia)); bot.queueFlush();
}
/** Use `obj` on the npc (route next to it + OPNPCU, same tick). MIGRATED q-lib useOnNpcGo (door-aware). */
export function useOnNpc(bot: SpeedBot, obj: number | string, n: NpcRef): void { qUseOnNpcGo(bot, n, obj); }
/** Pick up a ground obj (nearest within radius) until the pack count rises. */
export async function pickup(bot: SpeedBot, obj: number | string, label: string, o: { radius?: number; maxTicks?: number } = {}): Promise<void> {
    const id = objId(obj); const c0 = bot.count(id); const t0 = bot.tickCount;
    let last = -100;
    while (bot.count(id) <= c0 && bot.tickCount - t0 < (o.maxTicks ?? 40) && !bot.disposed) {
        const g = bot.findGroundItem(id, o.radius ?? 10);
        if (g && bot.tickCount - last >= 3) {
            if (bot.chatModalId !== -1) dismiss(bot);
            const me = bot.tile();
            if (me.x !== g.x || me.z !== g.z) {
                const pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, g.x, g.z, 500);
                const dense = densify([me, ...pts]).slice(1);
                // fix 183 (allchaos qt22fm Hero's 'hot_feather not picked up': a chaos-shut gate (1553 @2854,3370) on the way,
                // fix 176 = the same on a key's tile): open the first shut door/gate the static path crosses (or on the item's
                // tile) before the pick-up. SP_PICKUP_DOOR=0 reverts.
                if (process.env.SP_PICKUP_DOOR !== '0') {
                    for (const t of [...dense.slice(0, 8), { x: g.x, z: g.z }]) {
                        const cd = bot.doorTracker?.closedDoorAt(bot.minusedlevel, t.x, t.z);
                        if (cd) { bot.opLoc(t.x, t.z, cd.locId, cd.op); bot.queueFlush(); await bot.tick(3); console.log(`[pickup] ${label}: opened a shut door at ${t.x},${t.z}: ${!bot.doorTracker?.closedDoorAt(bot.minusedlevel, t.x, t.z)}`); break; }
                    }
                }
                if (dense.length) bot.sendRoute(turning(me, dense), true);
            }
            bot.opObj(g.x, g.z, g.obj, 3); bot.queueFlush(); last = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (bot.count(id) <= c0) fail(bot, `${label}: ${objDebugName(id)} not picked up`);
}
/** Glory rub: OPHELD4 + the destination choice (amulet_of_glory.rs2:13: 1 Edgeville, 2 Karamja, 3 Draynor, 4 Al Kharid). */
export async function glory(bot: SpeedBot, dest: 1 | 2 | 3 | 4, label: string): Promise<void> {
    // charger pair (SR_NO_GLORY=1, noglory.ts): travel to the glory landing without a glory
    if (NO_GLORY()) { if (!(await noGloryHop(bot, dest, label))) fail(bot, `${label}: no-glory travel to landing ${dest} failed`); return; }
    const names = ['amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'];
    //  acct25 crest 'glory al kharid: no charged glory' (the pair's existing.ts flips SR_NO_GLORY 1 -> 0 for the
    // whole process when the LAST side charges at the fountain; a quest whose kit was packed glory-free before the flip then hits
    // a real rub with no glory in the pack). No charged glory held = travel glory-free instead of failing. SR_GLORY_FALLBACK=0 reverts.
    if (process.env.SR_GLORY_FALLBACK !== '0' && !names.some(n => bot.count(objId(n)) > 0)) {
        console.log(`[glory] ${label}: no charged glory in the pack: glory-free travel to landing ${dest}`);
        if (!(await noGloryHop(bot, dest, label))) fail(bot, `${label}: no charged glory, and the no-glory travel to landing ${dest} failed`);
        return;
    }
    const p0 = bot.pos();
    // session 11 fix 313b SR_GLORY_HIT (CONFIRMED qx69p heros 'glory draynor: glory teleport 3 failed' x3 in the Ice Queen
    // lair, an Ice warrior hitting us (hp 59 -> 44), the glory never spent a charge: every npc melee swing, hit or miss, runs
    // if_close on us (npc_combat_melee.rs2:36 playerhit_n_melee), which kills the rub's p_choice5 menu
    // (amulet_of_glory.rs2:12) between our OPHELD4 and the answer; attackrate 4 vs a ~2-3 t menu window; qzh01 with only
    // more rubs: 4 Ice warriors next to us, rub 1 'no menu'): the answer goes IN THE SAME FLUSH as the rub (IF_BUTTON
    // multi5:com_<dest> = 2493+dest, chat.rs2 p_choice5_header): the server reads both in one tick, the rub suspends on the
    // menu and the answer resumes it at once (IfButtonHandler resumeButtons), so the teleport's p_delay starts before any npc
    // swings (if_close does not stop a delayed script). Reading the menu stays as the fallback; up to 6 rubs, a rub that
    // showed no menu waits 2 t (not 10). SR_GLORY_HIT=0 reverts (3 rubs, read the menu, 10 t each).
    const G313 = process.env.SR_GLORY_HIT !== '0';
    for (let k = 0; k < (G313 ? 6 : 3); k++) {
        const g = names.map(n => objId(n)).find(i => bot.count(i) > 0);
        if (g === undefined) fail(bot, `${label}: no charged glory`);
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); }
        const sw = G313 ? lockAttackers(bot).map(a => `${a.type}@${a.x},${a.z}`).join(' ') : '';
        opHeldN(bot, g, 4);
        if (G313) {
            const tr = bot.tickCount;
            bot.ifButton(2493 + dest); bot.queueFlush();
            if (await bot.until(() => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level, 5)) {
                if (sw) console.log(`[glory] ${label}: rub ${k + 1} under attack (${sw}): rub+answer in one flush, teleported in ${bot.tickCount - tr} t`);
                await bot.tick(1); return;
            }
        }
        let clicked = false;
        if (await bot.until(() => bot.dialogOptions().length >= 4, G313 ? 1 : 4)) {
            const o = bot.dialogOptions(); bot.ifButton(o[dest - 1]!.com); bot.queueFlush(); clicked = true;
        }
        if (await bot.until(() => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level, G313 ? (clicked ? 6 : 2) : 10)) { await bot.tick(1); return; }
        if (G313) console.log(`[glory] ${label}: rub ${k + 1} no teleport (${clicked ? 'answered' : 'no menu'}), attackers next to us ${lockAttackers(bot).map(a => `${a.type}@${a.x},${a.z}`).join(' ') || 'none'}, hp ${bot.stat('hitpoints').cur}`);
    }
    fail(bot, `${label}: glory teleport ${dest} failed`);
}
/** Standard spellbook teleport (q-lib tele with a level-up/dialog close first). */
export async function teleSpell(bot: SpeedBot, spell: string, label: string): Promise<void> {
    const p0 = bot.pos();
    for (let k = 0; k < 3; k++) {
        bot.closeModal(); bot.ifButton(spellCom(spell)); bot.queueFlush();
        if (await bot.until(() => cheb(bot.tile(), p0) > 8, 10)) { await bot.tick(1); return; }
    }
    fail(bot, `${label}: ${spell} failed`);
}
export async function wieldAll(bot: SpeedBot, names: string[]): Promise<void> {
    const ids = names.map(objId).filter(id => !bot.isWorn(id) && bot.slot(id) >= 0);
    if (!ids.length) return;
    bot.burst(ids.map(id => () => bot.opHeld2(id, bot.slot(id))));
    await bot.until(() => ids.every(id => bot.isWorn(id)), 6);
}

// ---------------------------------------------------------------------------------------------------------------------
// combat
// ---------------------------------------------------------------------------------------------------------------------
const PRAYER_POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'].map(n => { try { return objId(n); } catch { return -1; } }).filter(i => i > 0);
/** Keep a prayer up (guard() re-activates it and drinks prayer potions below 10 points); null = off. */
export function prayKeep(bot: SpeedBot, name: string | null): void {
    (bot as any).__spWantPray = name ?? undefined;
    if (name) { if (bot.stat('prayer').cur > 0 && !bot.isPrayerActive(name)) bot.activatePrayer(name); }
    else for (const p of ['protectfrommelee', 'protectfrommagic']) if (bot.isPrayerActive(p)) (bot as any).setPrayer(p, false);
    bot.queueFlush();
}
export const FOODS = ['shark', 'swordfish', 'lobster', 'monkfish', 'tuna', 'salmon', 'trout', 'bass', 'cake', 'bread'];
/** Background eater (hp < frac of base, no chat open) + death flag. stop() it when done. */
export function guard(bot: SpeedBot, frac = 0.5, food: string[] = FOODS) {
    const ids = food.map(f => { try { return objId(f); } catch { return -1; } }).filter(i => i > 0);
    const st = { stop: false, dead: false, ate: 0, frac, warnings: 0 };
    let last = -10;
    (async () => {
        while (!st.stop && !bot.disposed) {
            const hp = bot.stat('hitpoints');
            if (hp.level > 0 && hp.cur === 0) st.dead = true;
            // the wilderness warning (main modal 1908) opens once per account on entering z 3512-3515 / 9912-9915 and
            // blocks every move until closed (area_wilderness/scripts/wilderness_warning.rs2:6-21; sim sp5: 250 t wedged)
            if (bot.mainModalId === WILD_WARNING) { bot.closeModal(); bot.queueFlush(); st.warnings++; }
            // prayer potions keep Protect from Melee up (prayer drains 1 point per few ticks while active)
            // (an emptied prayer switches itself off, so key on the wish, not on the active flag)
            const want = (bot as any).__spWantPray as string | undefined;
            if (want && bot.stat('prayer').cur < 10 && bot.tickCount - last >= 3) {
                const pp = PRAYER_POTS.find(i => bot.count(i) > 0);
                if (pp !== undefined) { bot.opHeld1(pp, bot.slot(pp)); bot.queueFlush(); last = bot.tickCount; }
            }
            if (want && bot.stat('prayer').cur > 0 && !bot.isPrayerActive(want) && bot.tickCount - last >= 2) { bot.activatePrayer(want); bot.queueFlush(); }
            if (hp.cur > 0 && hp.cur < hp.level * st.frac && bot.tickCount - last >= 3) {
                const f = ids.find(i => bot.count(i) > 0);
                // below 30%: CLOSE_MODAL first (a suspended dialog blocks eating; sim spc10 sat at hp 2 with 6 sharks)
                if (f !== undefined) { if (hp.cur < hp.level * 0.3) bot.closeModal(); bot.opHeld1(f, bot.slot(f)); bot.queueFlush(); last = bot.tickCount; st.ate++; }
            }
            await bot.tick(1);
        }
    })();
    return st;
}
/** Attack the nearest npc of `types` (re-attack while it lives) until `done()`; then pick up `loot` if given. */
export async function killNpc(bot: SpeedBot, types: number[], label: string, o: { done?: () => boolean; maxTicks?: number; radius?: number; loot?: number; anchor?: Tile; dead?: () => boolean } = {}): Promise<void> {
    const end = bot.tickCount + (o.maxTicks ?? 300);
    let target = -1, atk = -100, xpTick = bot.tickCount, xpSum = combatXp(bot);
    const lootGone = () => o.loot !== undefined && bot.findGroundItem(o.loot, 12) !== undefined;
    const done = o.done ?? (() => lootGone());
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (o.dead?.()) fail(bot, `${label}: died`);
        if (bot.chatModalId !== -1) bot.closeModal();
        const x = combatXp(bot); if (x !== xpSum) { xpSum = x; xpTick = bot.tickCount; }
        const alive = target >= 0 && npcsOf(bot, types).some(q => q.idx === target);
        // re-attack only when the target is gone or no combat xp for 8 ticks since the last attack (a fresh OPNPC2 mid-fight
        // can cost a swing)
        if (!alive || (bot.tickCount - atk > 8 && bot.tickCount - xpTick > 8)) {
            const c = npcsOf(bot, types).filter(q => q.d <= (o.radius ?? 14))[0];
            if (c) { opNpcReach(bot, c, 2); target = c.idx; atk = bot.tickCount; }
            else if (o.anchor && cheb(bot.tile(), o.anchor) > 2) await go(bot, o.anchor, 1, label, 60);
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: kill not done`);
}
/**
 * Kill the nearest npc of `types` with a combat spell (OPNPCT; each cast is one click, the engine only continues with
 * autocast, player_magic.rs2:192-196). Re-casts when the magic xp stops moving for 6 ticks (a cast lands every 5 ticks,
 * %action_delay +5 :187) or the target changed. Walks toward it when it is more than `range` tiles away.
 */
export async function castKill(bot: SpeedBot, types: number[], spell: string | (() => string), label: string, o: { done?: () => boolean; maxTicks?: number; range?: number; dead?: () => boolean; anchor?: Tile; every?: number; noLock?: boolean; pick?: number; lockAvoid?: number[]; lockAvoidSize?: number; lockSpell?: string | (() => string); lockTicks?: number } = {}): Promise<void> {
    // session 11 fix 351: `spell` may be a function, re-picked before every cast (the crest lock breaker's rune reserve)
    const comOf = () => spellCom(typeof spell === 'function' ? spell() : spell);
    const end = bot.tickCount + (o.maxTicks ?? 300);
    let target = o.pick ?? -1, cast = -100, xpTick = bot.tickCount, xp = bot.stat('magic').xp, locks = 0;
    const done = o.done ?? (() => false);
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (o.dead?.()) fail(bot, `${label}: died`);
        if (bot.chatModalId !== -1) bot.closeModal();
        const x = bot.stat('magic').xp; if (x !== xp) { xp = x; xpTick = bot.tickCount; }
        // fix 301: the last cast was refused by the single-way lock -> break it (kill the swinger / let it lapse), 4 per call
        if (!o.noLock && LOCK_FIX && cast > 0 && locks < 4 && hasMsg(bot, cast, /already under attack/i)) {
            // fix 303a (CONFIRMED qx60m crest: the pre-cast spider clear's lock breaker took CHRONOZON (667@3088,9942, adjacent,
            // facing us) as the swinger because notTypes held only the spider type, and fire-blasted him ~25 times in 4 x 40 t
            // (engine [optrace] t39435-39697 'OPNPCT com 1181 -> ACCEPT ... npc 667'), fire runes 82 -> 2: he regenerates and
            // cannot die before all four blasts, so 'fire_blast: never landed'). lockAvoid = types the breaker must never fight;
            // when one of them holds the lock this castKill stops (the caller's real target is the lock holder, so its cast is
            // allowed). SR_LOCK_AVOID=0 reverts to fix 301 as it was.
            // The holder can be big (Chronozon is size 3: his SW tile is up to 3 tiles off while he stands next to us), so the
            // avoid test measures to the footprint (o.lockAvoidSize, default 3).
            const AV = process.env.SR_LOCK_AVOID !== '0';
            const holder = AV && o.lockAvoid?.length ? facingNear(bot, o.lockAvoid, o.lockAvoidSize ?? 3)[0] : undefined;
            if (holder) {
                console.log(`[lock ${label}] cast refused 'already under attack': the lock holder ${holder.type}@${holder.x},${holder.z} is on the avoid list: stop (fix 303a)`);
                break;
            }
            // fix 303d (CONFIRMED qzb02 FC_LOCK_TEST: 12 x '[lock poison spider] ... no attacker next to us: waited 9 t', 108 t:
            // the holder was ANOTHER poison spider, and notTypes = our own types hid it): a holder of our own types = switch
            // the target to it (killing it is the job anyway). SR_LOCK_AVOID=0 reverts.
            const same = AV ? lockAttackers(bot, []).find(a => types.includes(a.type) && a.idx !== target) : undefined;
            if (same && locks < 4) {
                locks++; console.log(`[lock ${label}] cast refused 'already under attack' (#${locks}): holder is ${same.type}@${same.x},${same.z} of our own types: target it`);
                target = same.idx; cast = -100; continue;
            }
            locks++; const r = await breakCombatLock(bot, o.lockSpell ?? spell, label, { notTypes: types, dead: o.dead, maxTicks: o.lockTicks });
            console.log(`[lock ${label}] cast refused 'already under attack' (#${locks}): ${r}`);
            cast = -100; continue;
        }
        const live = npcsOf(bot, types);
        const t = live.find(q => q.idx === target) ?? live[0];
        if (!t) { if (o.anchor && cheb(bot.tile(), o.anchor) > 2) await go(bot, o.anchor, 1, label, 60); await bot.tick(1); continue; }
        const ev = o.every ?? 6;
        if (t.idx !== target || (bot.tickCount - cast >= ev && bot.tickCount - xpTick >= ev)) {
            if (t.d > (o.range ?? 7)) {
                const me = bot.tile();
                let pts: Tile[] = []; try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, t.x, t.z, 500); } catch { pts = []; }
                const dense = densify([me, ...pts]).slice(1, Math.max(1, densify([me, ...pts]).length - 4));
                if (dense.length) bot.sendRoute(turning(me, dense), true);
            }
            if (levelUpOpen(bot)) bot.resumeDialogPage();
            // a server-side dialog left suspended (client thinks it is closed) blocks every op while walking still works
            // (sims spc10/spfc1/sphc1: casts, eating and fishing silently ignored): CLOSE_MODAL first, same burst
            else if (bot.tickCount - cast >= 12) bot.closeModal();
            bot.opNpcT(t.idx, comOf()); bot.queueFlush(); target = t.idx; cast = bot.tickCount;
            if (process.env.SP_CASTLOG) console.log(`[cast ${label}] t${bot.tickCount} target ${t.type}@${t.x},${t.z} d${t.d} me ${JSON.stringify(bot.pos())} death ${bot.count('deathrune')} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 6).slice(-2))}`);
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: spell kill not done`);
}
/**
 * fix 301 (CONFIRMED qx57m crest: 5 casts at Chronozon answered "I'm already under attack!", death runes 29 -> 0 on
 * spider kills, 'wind_blast: never landed'): the single-way combat lock. player_combat.rs2 player_in_combat_check refuses
 * any attack/cast while %lastcombat + 8 > map_clock and %aggressive_npc is ANOTHER npc (npc_combat.rs2
 * npc_set_attack_vars: set on every swing an npc takes at us, hit or miss, prayer or not). Killing a bystander does not
 * clear it; only the npc that swings at us does (npc_death.rs2: %lastcombat = null for its killer) or 8 quiet ticks.
 * The swinger is a melee npc next to us facing a player (faceEntity >= 32768; seg-a/seg-b use the same test).
 */
const LOCK_FIX = process.env.SR_LOCK_FIX !== '0';
export function lockAttackers(bot: SpeedBot, notTypes: number[] = []): NpcRef[] {
    const me = bot.tile(); const out: NpcRef[] = [];
    for (let i = 0; i < bot.npcCount; i++) {
        const idx = bot.npcIndices[i]!; const n = bot.npcs[idx] as any;
        if (!n || notTypes.includes(n.typeId) || (n.faceEntity ?? -1) < 32768) continue;
        const t = bot.npcTileOf(n); const d = cheb(t, me);
        if (d <= 1) out.push({ idx, type: n.typeId, x: t.x, z: t.z, d });
    }
    return out;
}
/** fix 303a: npcs of `types` facing a player whose size x size footprint (SW tile = the npc tile) touches ours */
export function facingNear(bot: SpeedBot, types: number[], size: number): NpcRef[] {
    const me = bot.tile(); const out: NpcRef[] = [];
    for (let i = 0; i < bot.npcCount; i++) {
        const idx = bot.npcIndices[i]!; const n = bot.npcs[idx] as any;
        if (!n || !types.includes(n.typeId) || (n.faceEntity ?? -1) < 32768) continue;
        const t = bot.npcTileOf(n);
        const dx = me.x < t.x ? t.x - me.x : me.x > t.x + size - 1 ? me.x - t.x - size + 1 : 0, dz = me.z < t.z ? t.z - me.z : me.z > t.z + size - 1 ? me.z - t.z - size + 1 : 0;
        if (Math.max(dx, dz) <= 1) out.push({ idx, type: n.typeId, x: t.x, z: t.z, d: Math.max(dx, dz) });
    }
    return out;
}
/** fix 301: break the single-way lock: kill the npc that swings at us with `spell` (bounded), else stand still 9 t so the
 *  lock lapses. SR_LOCK_FIX=0: callers keep their old handling. Returns what it did (for the log). */
export async function breakCombatLock(bot: SpeedBot, spell: string | (() => string), label: string, o: { notTypes?: number[]; dead?: () => boolean; maxTicks?: number; avoid?: number[] } = {}): Promise<string> {
    const a = lockAttackers(bot, o.notTypes)[0];
    if (!a) { await bot.tick(9); return 'no attacker next to us: waited 9 t'; }
    // fix 303a: never fight an avoided type (see castKill); the caller decides what to do instead
    if (o.avoid?.includes(a.type) && process.env.SR_LOCK_AVOID !== '0') return `attacker ${a.type}@${a.x},${a.z} is on the avoid list: left alone`;
    const t0 = bot.tickCount, xp0 = bot.stat('magic').xp;
    const gone = () => !npcsOf(bot, [a.type]).some(q => q.idx === a.idx);
    await castKill(bot, [a.type], spell, `${label} lock`, { done: gone, dead: o.dead, maxTicks: o.maxTicks ?? 40, range: 5, noLock: true, pick: a.idx }).catch(() => undefined);
    return `attacker ${a.type}@${a.x},${a.z} ${gone() ? 'killed' : 'still alive'} in ${bot.tickCount - t0} t (magic xp +${bot.stat('magic').xp - xp0})`;
}
export function combatXp(bot: SpeedBot): number { let s = 0; for (const k of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic']) s += bot.stat(k).xp; return s; }
export function packStr(bot: SpeedBot): string { return bot.inv().map(s => `${objDebugName(s.obj)}${s.count > 1 ? 'x' + s.count : ''}`).join(','); }
export function hasMsg(bot: SpeedBot, since: number, re: RegExp): boolean { return msgsSince(bot, since).some(t => re.test(t)); }
export type { NpcRef, Tile };

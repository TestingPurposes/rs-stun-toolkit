/// <reference types="bun" />
// fb-lib.ts — lane f2p-b helpers shared by the lane's quest files (Witch's Potion, Prince Ali, Knight's Sword, Pirate's
// Treasure, Shield of Arrav). Cheat-free. Built on the framework (q-lib.ts / core.ts); nothing here edits a shared file.
import { NO_GLORY, noGloryHop } from '../noglory.js';
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import {
    nav, talk, npc, npcsOf, inDialog, walkOp, opNpcGo, dismiss, routeToLoc, msgsSince, situation, trace, opHeld as qOpHeld, type FTok, type NpcRef, type Tile, type Wall,
} from '../../q-lib.js';
import { leafWallList } from '../../../leaf-walls.js';

export type Item = { name: string; n: number };
export const QUESTSCROLL = 297;   // interface.pack 297=questscroll (send_quest_complete opens it, quests.rs2:27-60)

export class QuestFail extends Error { }
export function fail(bot: SpeedBot, s: string): never { throw new QuestFail(`${s} at ${JSON.stringify(bot.pos())}`); }

/** One line per step with the tick offset from the quest's t0. */
export function mkLog(bot: SpeedBot, tag: string, on = true) {
    const t0 = bot.tickCount;
    const splits: Record<string, number> = {};
    let last = t0;
    const f = (s: string) => { if (on) console.log(`[${tag} +${String(bot.tickCount - t0).padStart(4)}] ${s}`); };
    if (process.env.QTRACE === '1') trace(bot, t0);   // q-lib: per-tick pos/modal/options + dialog text diffs
    f.split = (k: string) => { splits[k] = bot.tickCount - last; last = bot.tickCount; f(`${k} (${splits[k]} t) pos=${JSON.stringify(bot.pos())}`); };
    f.splits = splits; f.t0 = t0;
    return f;
}

/**
 * Open door leaves near us as planner walls. MIGRATED: the framework now walls every
 * open door leaf on the shared planner map straight from the zone stream's own shape/angle (speedrun/leaf-walls.ts, exact for
 * single, reversed and left/right double doors), so the lane's derived edges (angle+1 / +3 guesses, sim fb4-fb13) are gone.
 * leafWalls() lists the framework's walls near us (diagnostics); syncLeaves() is a no-op kept for callers.
 */
export function leafWalls(bot: SpeedBot, radius = 30): Wall[] {
    const me = bot.tile(), lv = bot.minusedlevel;
    return leafWallList().filter(w => w.level === lv && Math.max(Math.abs(w.x - me.x), Math.abs(w.z - me.z)) <= radius)
        .map(w => ({ level: w.level, x: w.x, z: w.z, shape: 0, angle: w.angle }));
}
export function syncLeaves(_bot: SpeedBot): number { return leafWallList().length; }

/** Al Kharid toll wall (railing x=3267/3268, z~3204-3238). border_gate.rs2:21-53: ~chatplayer "Can I come through this gate?"
 *  -> (prince saved) chatnpc "You may pass for free" -> pass | (else) chatnpc + p_choice3 "Yes, ok." -> 10 gp -> pass. Every page
 *  is a chat1/chat2 modal that waits for continue.  acct25 (route-hard-full, Prince Ali AK3 walk to Hassan, no
 *  charged glory): the walk op'd the gate and sat 390+ t on chat=968 (chat1, "Can I come through this gate?") because walkOp never
 *  resumes dialog pages. Crossing the wall is now its own step that answers every page. FB_TOLL_STEP=0 reverts. */
/** Does the planner's own walk src -> dest go through the toll gate (x 3267|3268, z 3227/3228)? The fence is not a closed
 *  ring (navgrid BFS with the gate cut still reaches Hassan from Lumbridge), so a side test (x >= 3268, z 3150-3242) alone also caught walks that
 *  never touch the gate: Al Kharid mine / Varrock -> Al Kharid from the north, the Duel Arena -> north (it then crossed the gate
 *  the WRONG way and paid). Walks whose path the planner routes through the gate are exactly the ones walkOp wedges on. */
export function viaAkToll(n: { findLongPath: (l: number, sx: number, sz: number, dx: number, dz: number, max?: number) => Array<{ x: number; z: number }> }, src: Tile, dest: Tile): boolean {
    if ((src.x <= 3267) === (dest.x <= 3267)) return false;
    const pts = [src, ...n.findLongPath(0, src.x, src.z, dest.x, dest.z, 2000)];
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!;
        if ((a.x <= 3267) === (b.x <= 3267)) continue;
        const zc = a.z + (b.z - a.z) * ((3267.5 - a.x) / (b.x - a.x));   // rsmod legs are straight or diagonal
        if (zc >= 3225.5 && zc <= 3229.5) return true;
    }
    return false;
}
export async function crossAkToll(bot: SpeedBot, label: string): Promise<void> {
    // the side is x vs the gate (viaAkToll picked a walk through it): a z box would misread a Duel Arena start as outside
    const east = () => bot.tile().x >= 3268, wasIn = east(), t0 = bot.tickCount;
    const stand = wasIn ? { x: 3268, z: 3227 } : { x: 3267, z: 3227 };
    if (bot.count('coins') < 10) console.log(`[fb] ${bot.loginUser} ${label}: ${bot.count('coins')} gp for the Al Kharid toll (free only once the prince is saved)`);
    if (cheb(bot.tile(), stand) > 0) await bot.walkTo(stand.x, stand.z, { near: 0, maxTicks: 2500, log: false });
    for (let k = 0, sent = 0; k < 150 && east() === wasIn && !bot.disposed; k++) {
        if (bot.dialogOptions().length) { bot.clickDialogByText(/^Yes, ok\./); bot.queueFlush(); }
        else if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
        else if (k % 10 === 0) {
            // find_and_talk_to_border_guard wants the same-side guard within 1 tile: alternate the gate op with talking to a guard
            const g = (npcsOf(bot, [925, 926]) as any[]).sort((x, y) => x.d - y.d)[0];
            if (sent++ % 2 === 1 && g) opNpcGo(bot, g, 1); else bot.opLoc(3268, 3227, 2882, 1);
            bot.queueFlush();
        }
        await bot.tick(1);
    }
    dismiss(bot);
    console.log(`[fb] ${bot.loginUser} ${label}: Al Kharid toll ${east() !== wasIn ? 'crossed' : 'NOT crossed'} (${bot.tickCount - t0} t) at ${JSON.stringify(bot.pos())}`);
    // under 10 gp (prince not saved yet) the guard refuses: leave it to the old walk (around the wall), as before this step existed
    if (east() === wasIn && bot.count('coins') >= 10) fail(bot, `${label}: Al Kharid toll gate not crossed (${bot.count('coins')} gp) | ${situation(bot)}`);
}

/** Walk (framework walkOp: navgrid/rsmod + live door tracker); falls back to SpeedBot.walkTo (multi-level traveller). */
export async function go(bot: SpeedBot, dest: Tile, near = 0, label = 'go', maxTicks = 1500, level?: number): Promise<void> {
    await nav();
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) dismiss(bot);
    if (process.env.FB_TOLL_STEP !== '0' && bot.minusedlevel === 0 && (level ?? 0) === 0 && dest.z < 4000 && bot.tile().z < 4000
        && viaAkToll(await nav(), bot.tile(), dest)) await crossAkToll(bot, label);
    const lv = level ?? bot.minusedlevel;
    syncLeaves(bot);
    const at = () => bot.minusedlevel === lv && cheb(bot.tile(), dest) <= near && (near > 0 || (bot.tile().x === dest.x && bot.tile().z === dest.z));
    if (at()) return;
    // re-sync the door leaves every 4 ticks while walking: a leaf opened by someone else only becomes visible on approach
    // (sim fbs27: the partner opened Katrine's door, our walk wedged 20 re-plans on its leaf and q-lib shut the door)
    let syncT = bot.tickCount;
    const doneSync = () => { if (bot.tickCount - syncT >= 4) { syncT = bot.tickCount; syncLeaves(bot); } return at(); };
    if (lv === bot.minusedlevel && await walkOp(bot, dest, null, doneSync, { near, maxTicks, log: false })) return;
    if (at()) return;
    const r = await bot.walkTo(dest.x, dest.z, { near, maxTicks, level: lv, log: false, closeDoors: true });
    if (!r.ok && !at()) fail(bot, `${label}: walk to (${dest.x},${dest.z}) failed | walls ${JSON.stringify(leafWalls(bot).map(w => `${w.x},${w.z},${w.angle}`))} | ${situation(bot)}`);
}

/** Walk next to the npc (spawn tile `at`) and open its first dialog page with OPNPC `op` (route + op in one tick). */
export async function openNpc(bot: SpeedBot, type: number | number[], at: Tile, label: string, o: { op?: number; near?: number; done?: () => boolean; maxTicks?: number; stand?: Tile } = {}): Promise<void> {
    await nav();
    const done = o.done ?? (() => inDialog(bot));
    if (done()) return;
    if (bot.chatModalId !== -1) dismiss(bot);
    // npc inside a building: walk onto a stand tile inside first (walkOp opens the closed doors on the way; the static map
    // the npc planner uses has every door OPEN — Hetty stood in her closed doorway, sim fb2)
    if (o.stand && cheb(bot.tile(), o.stand) > 1) await go(bot, o.stand, 1, label, o.maxTicks ?? 600);
    syncLeaves(bot);
    const opN = () => { const n = npc(bot, type); if (!n) return false; opNpcReach(bot, n, o.op ?? 1); return true; };
    const t0 = bot.tickCount, max = o.maxTicks ?? 600;
    // close: OPNPC straight away (the engine walks us); far: walk to the spawn area with the op riding the last chunk
    const n0 = npc(bot, type);
    let syncT = bot.tickCount;
    const doneSync = () => { if (bot.tickCount - syncT >= 4) { syncT = bot.tickCount; syncLeaves(bot); } return done(); };
    if (!(n0 && n0.d <= 6)) await walkOp(bot, at, opN, doneSync, { near: o.near ?? 1, maxTicks: max, log: false, quickGiveUp: true });
    let lastOp = -100, ops = 0;
    while (!done() && bot.tickCount - t0 < max && !bot.disposed) {
        if (bot.tickCount - lastOp >= 5 && bot.chatModalId === -1) {
            // two ops without a page: the npc is behind something the op route cannot pass (a closed door: Ned's house on
            // chaos seed 222, sim fbp11/fbp13) -> walk next to it with walkOp, which opens doors on the way
            const n = npc(bot, type);
            if (n && ops >= 2 && n.d > 1) { await go(bot, { x: n.x, z: n.z }, 1, label, 120).catch(() => undefined); ops = 0; }
            if (!opN()) { if (!n && cheb(bot.tile(), at) > 2) await go(bot, at, 2, label, 200); }
            else ops++;
            lastOp = bot.tickCount;
        }
        await bot.tick(1);
    }
    if (!done()) fail(bot, `${label}: npc ${type} dialog never opened`);
}

/** opNpcGo, but a cardinal neighbour across a WALL is not "adjacent" (Hetty through her west wall, sim fb1: ACK-NOACK-TALK-NPC
 *  for 30 t). MIGRATED: q-lib opNpcGo does exactly this now (QLIB.doorAware: one-step edge check + closed doors). */
export function opNpcReach(bot: SpeedBot, n: NpcRef, op = 1): number { return opNpcGo(bot, n, op); }

/** openNpc + the planned burst + adaptive fallback until `done`. */
export async function converse(bot: SpeedBot, type: number | number[], at: Tile, plan: FTok[], done: () => boolean, answers: RegExp[], label: string, o: { op?: number; maxTicks?: number; stand?: Tile; tries?: number } = {}): Promise<void> {
    // a conversation cut short (eating closes the chat; an aggressive npc's hit can too) is simply started again
    for (let attempt = 0; !done(); attempt++) {
        await openNpc(bot, type, at, label, { op: o.op, stand: o.stand, done: () => inDialog(bot) || done() });
        if (done()) return;
        // stop waiting 3 ticks after the chat closed without `done` (cut short), instead of sitting out maxTicks
        let closed = 0;
        const done2 = () => { if (done()) return true; closed = bot.chatModalId === -1 ? closed + 1 : 0; return closed >= 3; };
        await talk(bot, type, plan, { noOp: true, done: done2, answers, maxTicks: o.maxTicks ?? 60, label });
        if (done()) return;
        if (attempt + 1 >= (o.tries ?? 3)) fail(bot, `${label}: dialog did not finish (options ${JSON.stringify(bot.dialogOptions().map(x => x.text))})`);
        console.log(`[fb] ${label}: dialog cut short, again (attempt ${attempt + 2}) | ${situation(bot, 7).slice(0, 600)}`);
        if (bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
    }
}

/** openNpc + the planned burst; done = the chat closed after the plan (talk's default); a plan that went wrong falls back to
 *  answering by option text until the chat closes. For conversations with no item/varp observable at their end. */
export async function chat(bot: SpeedBot, type: number | number[], at: Tile, plan: FTok[], answers: RegExp[], label: string, o: { op?: number; maxTicks?: number; stand?: Tile; expect?: RegExp } = {}): Promise<void> {
    // a page left over from the previous conversation would take the plan: close it first
    if (bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
    for (let attempt = 0; ; attempt++) {
        // `expect`: a line that must show up in this conversation (the only proof that it was the right one: quest varps are
        // not transmitted). Seen texts are collected every tick while the conversation runs.
        const seen: string[] = [];
        const snap = new Map(bot.ifText);
        const collect = () => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v) { seen.push(v); snap.set(k, v); } };
        await openNpc(bot, type, at, label, { op: o.op, stand: o.stand });
        collect();
        const r = await talk(bot, type, plan, { noOp: true, answers, maxTicks: o.maxTicks ?? 40, label, done: undefined });
        collect();
        if (!r.ok && !(await answerUntil(bot, () => { collect(); return !inDialog(bot); }, answers, 30))) fail(bot, `${label}: chat did not close`);
        if (!o.expect || seen.some(t => o.expect!.test(t))) return;
        if (attempt >= 2) fail(bot, `${label}: expected line ${o.expect} never shown`);
        console.log(`[fb] ${label}: expected ${o.expect} not seen, talking again`);
    }
}

/** Answer whatever chat is open until `done` (resume pages, choose by text). */
export async function answerUntil(bot: SpeedBot, done: () => boolean, answers: RegExp[], maxTicks = 40): Promise<boolean> {
    const end = bot.tickCount + maxTicks;
    while (!done() && bot.tickCount < end && !bot.disposed) {
        if (bot.chatModalId !== -1) {
            if (bot.dialogOptions().length) { for (const re of answers) if (bot.clickDialogByText(re) > 0) break; }
            else bot.resumeDialogPage();
            bot.queueFlush();
        }
        await bot.tick(1);
    }
    return done();
}

/** Eat when hp < frac of base (no chat open; eating closes it). Returns a stopper. Also flags death. */
/**
 * Background guard for a quest run: eats below `frac` of base hp (only with no chat open, unless below 25%: eating closes the
 * dialog), and FAILS AT ONCE ON DEATH: while it runs, every bot.tick() throws QuestFail('died') once hp hit 0, so no step
 * keeps retrying from the respawn point. Call `st.stop = true` (finally) to restore bot.tick.
 */
export function guard(bot: SpeedBot, food: string[] = ['shark', 'lobster', 'swordfish', 'trout', 'salmon', 'tuna', 'bread', 'cake'], frac = 0.5) {
    const ids = food.map(f => { try { return objId(f); } catch { return -1; } }).filter(i => i > 0);
    const st = { stop: false, dead: false, ate: 0 };
    let last = -10;
    const orig = bot.tick.bind(bot);
    (bot as any).tick = async (n = 1) => { await orig(n); if (st.dead && !st.stop) throw new QuestFail(`died at ${JSON.stringify(bot.pos())}`); };
    (async () => {
        while (!st.stop && !bot.disposed) {
            const hp = bot.stat('hitpoints');
            if (hp.level > 0 && hp.cur === 0) st.dead = true;
            const low = hp.cur > 0 && hp.cur < hp.level * frac, crit = hp.cur > 0 && hp.cur < hp.level * 0.25;
            if (low && bot.tickCount - last >= 3 && (bot.chatModalId === -1 || crit)) {
                const f = ids.find(i => bot.count(i) > 0);
                if (f !== undefined) { bot.opHeld1(f, bot.slot(f)); bot.queueFlush(); last = bot.tickCount; st.ate++; }
            }
            await orig(1);
        }
        delete (bot as any).tick;   // back to the prototype method
    })();
    return st;
}

/** Kill npcs of `types` near `anchor` until `have()`; picks up `loot` (own drops) on the way. */
export async function killFor(bot: SpeedBot, label: string, types: number[], anchor: Tile, loot: number[], have: () => boolean, o: { maxTicks?: number; radius?: number } = {}): Promise<void> {
    if (have()) return;
    const lootSet = new Set(loot);
    const end = bot.tickCount + (o.maxTicks ?? 600);
    let target = -1, atk = -100, pick = -100;
    // walk to the hunting ground with walkOp first: it opens/closes doors on the way (an npc op straight from inside a house
    // left us wedged on the open door leaf for 300 t, sim fb4)
    if (cheb(bot.tile(), anchor) > 4) await go(bot, anchor, 4, label, 300);
    let lastPos = '', still = 0;
    while (!have() && bot.tickCount < end && !bot.disposed) {
        if (bot.tickCount % 5 === 0) syncLeaves(bot);
        const pk = `${bot.tile().x},${bot.tile().z}`; still = pk === lastPos ? still + 1 : 0; lastPos = pk;
        const tgt = npcsOf(bot, types).find(q => q.idx === target);
        if (still >= 8 && (!tgt || tgt.d > 1)) { still = 0; if (!(await bot.closeBlockingDoor())) await go(bot, tgt ?? anchor, 1, label, 60).catch(() => undefined); target = -1; continue; }
        if (bot.chatModalId !== -1) { bot.closeModal(); }
        const g = bot.findGroundItem(lootSet, 10);
        if (g && bot.free() > 0) {
            if (bot.tickCount - pick >= 3) {
                const me = bot.tile();
                if (me.x !== g.x || me.z !== g.z) routeToLoc(bot, { id: -1, x: g.x, z: g.z, width: 1, length: 1, angle: 0, shape: 10 } as any, { x: g.x, z: g.z });
                bot.opObj(g.x, g.z, g.obj, 3); bot.queueFlush(); pick = bot.tickCount;
            }
            await bot.tick(1); continue;
        }
        if (process.env.FB_DEBUG) console.log(`[kill ${label} t${bot.tickCount}] me=${JSON.stringify(bot.tile())} hp=${bot.stat('hitpoints').cur} target=${target} cands=${JSON.stringify(npcsOf(bot, types).slice(0, 3).map(q => [q.idx, q.x, q.z, q.d]))} ground=${JSON.stringify(bot.findGroundItem(lootSet, 15) ?? null)}`);
        const alive = target >= 0 && npcsOf(bot, types).some(q => q.idx === target);
        if (!alive || bot.tickCount - atk > 20) {
            const c = npcsOf(bot, types).filter(q => q.d <= (o.radius ?? 12))[0];
            if (c) {
                opNpcReach(bot, c, 2); target = c.idx; atk = bot.tickCount;
                // session 11 fix 347: q-lib approachNpc opened the door between us and the npc instead of attacking: attack again
                // in 2 t, not 21 (the route's fix 154 shuts an open leaf on our own tile after 20 t still). WP_DOORNPC=0 reverts.
                if ((bot as any).__qDoorOpTick === bot.tickCount && process.env.WP_DOORNPC !== '0') atk = bot.tickCount - 19;
            }
            else if (cheb(bot.tile(), anchor) > 3) await go(bot, anchor, 3, label, 200);
        }
        await bot.tick(1);
    }
    if (!have()) fail(bot, `${label}: kill/loot not done | ${situation(bot)}`);
}

/** Pick an item from a loc (e.g. onion plant op2) until the count rises. */
export async function pickLoc(bot: SpeedBot, loc: { id: number; x: number; z: number }, op: number, obj: string, want: number, label: string): Promise<void> {
    const id = objId(obj);
    const { locAt } = await import('../../q-lib.js');
    const l = locAt(loc.id, loc.x, loc.z, bot.minusedlevel);
    const t0 = bot.tickCount;
    while (bot.count(id) < want) {
        if (bot.tickCount - t0 > 120) fail(bot, `${label}: ${obj} ${bot.count(id)}/${want}`);
        const c = bot.count(id);
        routeToLoc(bot, l); bot.opLoc(l.x, l.z, l.id, op); bot.queueFlush();
        await bot.until(() => bot.count(id) > c, 8);
    }
}

/** Open an npc's shop (op `op`, usually 3 = Trade) and buy `items`; closes the shop. */
export async function buyFrom(bot: SpeedBot, type: number, at: Tile, items: Item[], label: string, op = 3): Promise<void> {
    const need = () => items.filter(i => bot.count(i.name) < i.n);
    if (!need().length) return;
    await openNpc(bot, type, at, label, { op, done: () => bot.shopIsOpen() });
    const t0 = bot.tickCount;
    while (need().length && bot.tickCount - t0 < 30) {
        const w = need()[0]!;
        bot.shopBuy(objId(w.name), w.n - bot.count(w.name)); bot.queueFlush();
        await bot.tick(1);
    }
    bot.closeModal(); await bot.tick(1);
    if (need().length) fail(bot, `${label}: could not buy ${need().map(i => i.name).join(',')} (coins ${bot.count('coins')})`);
}

/** OPHELD<op> on a backpack item. MIGRATED: q-lib opHeld (same packet; argument order kept for callers). */
export function opHeld(bot: SpeedBot, op: 1 | 2 | 3 | 4 | 5, obj: number | string, slot?: number): boolean { return qOpHeld(bot, obj, op, slot); }
export const GLORIES = ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1'];
export const GLORY_DEST = {   // general/scripts/enchanted_jewellry/amulet_of_glory.rs2:12-34 (p_choice5_header; coords 0_mx_mz_lx_lz)
    edgeville: { opt: /^Edgeville\.$/, at: { x: 3087, z: 3496 } },
    karamja: { opt: /^Karamja\.$/, at: { x: 2918, z: 3176 } },
    draynor: { opt: /^Draynor Village\.$/, at: { x: 3105, z: 3251 } },
    alkharid: { opt: /^Al Kharid\.$/, at: { x: 3293, z: 3163 } },
} as const;
/** Rub a charged amulet of glory (worn or in the pack: opheld4 from the pack) and pick the destination. Resolves on landing. */
export async function glory(bot: SpeedBot, dest: keyof typeof GLORY_DEST, label = 'glory'): Promise<number> {
    const t0 = bot.tickCount, d = GLORY_DEST[dest];
    if (cheb(bot.tile(), d.at) <= 3) return 0;
    // charger pair (SR_NO_GLORY=1, noglory.ts): travel to the glory landing without a glory
    if (NO_GLORY()) { if (!(await noGloryHop(bot, dest, label))) fail(bot, `${label}: no-glory travel to ${dest} failed`); return bot.tickCount - t0; }
    const p0 = bot.tile();
    let last = -100;
    while (cheb(bot.tile(), p0) <= 8 || bot.minusedlevel !== 0) {
        if (bot.tickCount - t0 > 30) fail(bot, `${label}: glory teleport to ${dest} failed (pack ${packStr(bot)})`);
        if (bot.chatModalId !== -1 && bot.dialogOptions().length) { bot.clickDialogByText(d.opt); bot.queueFlush(); }
        else if (bot.chatModalId !== -1 && !inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
        else if (bot.tickCount - last >= 5) {
            const g = GLORIES.find(n => bot.count(n) > 0);
            if (!g) fail(bot, `${label}: no charged amulet of glory`);
            if (bot.mainModalId !== -1 || bot.chatModalId !== -1) bot.closeModal();
            opHeld(bot, 4, g); last = bot.tickCount;
            // session 11 fix 395b (qx339m/qzm96p prince 'glory teleport to alkharid failed' 30 t after keli1 in the Draynor jail, no
            // charge spent: a jail guard's swing if_closes the p_choice5 menu before our answer; sp-lib fix 313b): answer in the
            // SAME flush (multi5 com_<n> = 2493+n: 1 Edgeville, 2 Karamja, 3 Draynor, 4 Al Kharid). FB_GLORY_FLUSH=0 reverts.
            if (process.env.FB_GLORY_FLUSH !== '0') { bot.ifButton(2493 + ({ edgeville: 1, karamja: 2, draynor: 3, alkharid: 4 } as const)[dest]); bot.queueFlush(); }
        }
        await bot.tick(1);
    }
    if (bot.chatModalId !== -1) dismiss(bot);
    return bot.tickCount - t0;
}

/** Auto-retaliate (controls:com_3 buttons 151 off / 150 on, LeanBot RETALIATE_*_BUTTON). With it on, every melee hit from an
 *  aggressive npc queues playerhit_n_retaliate -> p_opnpc(2) (auto_retaliate.rs2:3-22): we turn round and fight, dropping the
 *  walk / op / use-item we were doing (Draynor jail guards: Keli never got tied, sim fbp12). */
export function setRetaliate(bot: SpeedBot, on: boolean): void { bot.ifButton(on ? 150 : 151); bot.queueFlush(); }

/** Quest complete: qp rose by `n` or the quest scroll opened. */
export function completeCheck(bot: SpeedBot, qp0: number, n: number): () => boolean {
    return () => bot.getVarp(101) >= qp0 + n || bot.mainModalId === QUESTSCROLL;
}
export function packStr(bot: SpeedBot): string { return bot.inv().map(s => `${objDebugName(s.obj)}${s.count > 1 ? 'x' + s.count : ''}`).join(','); }
export function hasMsg(bot: SpeedBot, since: number, re: RegExp): boolean { return msgsSince(bot, since).some(t => re.test(t)); }
export type { NpcRef, Tile };

/// <reference types="node" />
import { ClientProt } from '#/io/ClientProt.js';
// mo-lib.ts — lane-local helpers for the morytania quest lane (Priest in Peril, Nature Spirit, In Search of the Myreque,
// Shades of Mort'ton, Haunted Mine). Cheat-free except simSetup()/launch(), which only run in --sim on a local engine.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName, cheb, densify } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { locAt, opLocGo, levelUpOpen, npcsOf, opNpcGo, walkOp, inDialog, dismiss, msgsSince, dropAllOf, KIT_JUNK, qp, navSync, turning, trace, talk, situation, routeNextTo as qRouteNextTo, opHeld as qOpHeld, type NpcRef, type FTok, type TalkOpts } from '../../q-lib.js';
import * as locScene from '../../../../loc-scene.js';
import { openBooth } from '../../run-lib.js';

export type Item = { name: string; n: number };
export type Tile = { x: number; z: number };
export interface QuestMeta { name: string; dir: string; qp: number }
export interface Reqs {
    quests: string[]; qp: number; skills: Record<string, [number, string]>;
    start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number };
}
export type RunResult = { ok: boolean; ticks: number; msg: string };

export function fail(bot: SpeedBot, s: string): never { throw new Error(`${s} at ${JSON.stringify(bot.pos())}`); }
export const has = (bot: SpeedBot, o: string | number) => bot.count(objId(o)) > 0;
export function stamp(bot: SpeedBot, t0: number, label: string, verbose = true): void {
    if (verbose) console.log(`[q +${String(bot.tickCount - t0).padStart(4)}] ${label} pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur} run=${bot.runEnergy}`);
}

/** Food the safety net eats, best first (debug names). */
export const FOODS = ['shark', 'swordfish', 'lobster', 'tuna', 'salmon', 'trout', 'meat_pie', 'apple_pie', 'half_a_meat_pie', 'half_an_apple_pie', 'cake', 'bread'];
function foodSlot(bot: SpeedBot): { obj: number; slot: number } | null {
    for (const f of FOODS) { let id: number; try { id = objId(f); } catch { continue; } const s = bot.slot(id); if (s >= 0) return { obj: id, slot: s }; }
    return null;
}
/**
 * Run `body` with a safety net: eat at <= 50% hp (pages only interrupted when critical), and a death watcher: "Oh dear,
 * you are dead!" or a jump to the Lumbridge respawn makes every later bot.tick throw at once (fail fast on death).
 */
export async function withSafety<T>(bot: SpeedBot, label: string, body: () => Promise<T>, o: { eatAt?: number } = {}): Promise<T> {
    let on = true, lastEat = -9, dead = '';
    const tick0 = bot.tick.bind(bot), since = bot.tickCount, start = bot.tile();
    const startInLumby = start.x >= 3200 && start.x <= 3245 && start.z >= 3195 && start.z <= 3240;
    (bot as any).tick = async (n = 1) => { await tick0(n); if (dead) throw new Error(dead); };
    (async () => {
        while (on && !bot.disposed) {
            const t = bot.tile();
            if (!dead && (msgsSince(bot, since).some(m => /Oh dear,? you are dead/i.test(m))
                || (!startInLumby && t.x >= 3200 && t.x <= 3245 && t.z >= 3195 && t.z <= 3240 && bot.minusedlevel === 0)))
                dead = `${label}: DIED (respawned at ${t.x},${t.z})`;
            const hp = bot.stat('hitpoints'), critical = hp.cur <= Math.max(8, Math.floor(hp.level * 0.3));
            if (hp.cur <= Math.floor(hp.level * (o.eatAt ?? 0.5)) && (critical || bot.chatModalId === -1) && bot.tickCount - lastEat >= 3) {
                const f = foodSlot(bot);
                if (f) { bot.opHeld1(f.obj, f.slot); bot.queueFlush(); lastEat = bot.tickCount; }
            }
            await tick0(1);
        }
    })();
    try { return await body(); }
    catch (e) { if (dead) throw new Error(dead); throw e; }
    finally { on = false; (bot as any).tick = tick0; }
}

/** The npc's live hp ratio entity (health/totalHealth are set by hitsplat updates). */
export function npcEntity(bot: SpeedBot, idx: number): any { return (bot as any).npcs[idx]; }

/**
 * Attack the nearest npc of `types` (locks onto one instance) until it is gone from the npc list (dead) or `done()`.
 * Walks to `home` when none is in view. Re-sends the attack every `every` ticks while the target is not adjacent.
 */
export async function kill(bot: SpeedBot, types: number | number[], o: { home?: Tile; maxTicks?: number; done?: () => boolean; label?: string; pick?: (n: NpcRef) => boolean } = {}): Promise<boolean> {
    const t0 = bot.tickCount, maxTicks = o.maxTicks ?? 200;
    let target = -1, lastAtk = -99, seen = false;
    while (bot.tickCount - t0 < maxTicks) {
        if (o.done?.()) return true;
        // a level-up page stops the fight (x25 xp: frequent): re-attack in the same tick (opNpcGo resumes it first)
        const lvl = levelUpOpen(bot);
        if (bot.chatModalId !== -1 && !lvl) { bot.resumeDialogPage(); bot.queueFlush(); }
        const all = npcsOf(bot, types).filter(n => !o.pick || o.pick(n));
        let n = all.find(q => q.idx === target) ?? null;
        if (target >= 0 && !n) {   // the locked target vanished: dead (or out of view)
            if (seen && !o.done) return true;
            target = -1;
        }
        if (!n) n = all[0] ?? null;
        if (!n) {
            if (o.home) await walkOp(bot, o.home, null, () => npcsOf(bot, types).length > 0, { near: 2, maxTicks: 40 });
            await bot.tick(1); continue;
        }
        const e = npcEntity(bot, n.idx);
        if (e && e.totalHealth > 0) seen = true;
        if (lvl || n.idx !== target || bot.tickCount - lastAtk >= (n.d > 1 ? 4 : 16)) { opNpcGo(bot, n, 2); target = n.idx; lastAtk = bot.tickCount; seen = true; }
        await bot.tick(1);
    }
    return o.done ? o.done() : false;
}

/** Operate a loc (walkOp to `stand`, op `op`) until `done()`; retries a few times. */
export async function opUntil(bot: SpeedBot, loc: locScene.SceneLoc, op: number, stand: Tile, done: () => boolean, o: { maxTicks?: number; tries?: number; level?: number } = {}): Promise<boolean> {
    for (let k = 0; k < (o.tries ?? 4) && !done(); k++) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        if (await walkOp(bot, stand, () => bot.opLoc(loc.x, loc.z, loc.id, op), done, { maxTicks: o.maxTicks ?? 60, level: o.level })) return true;
    }
    return done();
}
export async function useOnLocUntil(bot: SpeedBot, obj: string, loc: locScene.SceneLoc, stand: Tile, done: () => boolean, o: { maxTicks?: number; tries?: number } = {}): Promise<boolean> {
    const id = objId(obj);
    for (let k = 0; k < (o.tries ?? 4) && !done(); k++) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        if (await walkOp(bot, stand, () => { const s = bot.slot(id); if (s < 0) return false; bot.useItemOnLoc(loc.x, loc.z, loc.id, id, s); }, done, { maxTicks: o.maxTicks ?? 60 })) return true;
    }
    return done();
}
/** Use a held obj on the nearest npc of `type` until `done()`. */
export async function useOnNpcUntil(bot: SpeedBot, obj: string, type: number, done: () => boolean, maxTicks = 40): Promise<boolean> {
    const id = objId(obj), t0 = bot.tickCount; let last = -99;
    while (bot.tickCount - t0 < maxTicks && !done()) {
        // the use may open chat pages (e.g. Drezel blessing the water: 2 pages before the swap): continue them
        if (inDialog(bot) && !bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); continue; }
        const n = npcsOf(bot, type)[0];
        if (n && bot.tickCount - last >= 5 && bot.chatModalId === -1) {
            const s = bot.slot(id); if (s < 0) return done();
            routeNextTo(bot, n);
            bot.useItemOnNpc(n.idx, id, s); bot.queueFlush(); last = bot.tickCount;
        }
        await bot.tick(1);
    }
    return done();
}

/** MOVE_OPCLICK to the tile before an npc (no op sent). MIGRATED q-lib routeNextTo (door-aware, wall-aware). */
export function routeNextTo(bot: SpeedBot, n: NpcRef): number { return qRouteNextTo(bot, n); }
/** Pick up a ground obj (nearest stack within `range`) until held. */
export async function pickup(bot: SpeedBot, obj: string, range = 12, maxTicks = 30): Promise<boolean> {
    const id = objId(obj), c0 = bot.count(id), t0 = bot.tickCount; let last = -99;
    while (bot.tickCount - t0 < maxTicks) {
        if (bot.count(id) > c0) return true;
        const g = bot.findGroundItem(id, range);
        if (g && bot.tickCount - last >= 4) { (await import('../../q-lib.js')).pickupGo(bot, id, g); last = bot.tickCount; }
        await bot.tick(1);
    }
    return bot.count(id) > c0;
}

/** Wield held items (one burst), wait until worn. */
export async function wieldAll(bot: SpeedBot, names: string[]): Promise<void> {
    const ids = names.map(objId).filter(id => !bot.isWorn(id) && bot.slot(id) >= 0);
    if (!ids.length) return;
    bot.burst(ids.map(id => () => bot.opHeld2(id, bot.slot(id))));
    await bot.until(() => ids.every(id => bot.isWorn(id)), 6);
}

export const packStr = (bot: SpeedBot) => bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ');

// ---------------------------------------------------------------------------------------------------------------------
// launcher (run-<q>.ts): --live <account> | --sim [name] | --supply
// ---------------------------------------------------------------------------------------------------------------------
export interface LaunchSpec {
    quest: QuestMeta; reqs: Reqs; supply: Item[];
    /** extra sim-only setup after the stats (prerequisite quest varps, untradeable prerequisite items). */
    simVarps?: Array<[string, number]>;
    simStats?: Record<string, number>;
    /** sim-only: untradeable items a live account keeps from earlier quests (e.g. the ghostspeak amulet). */
    simKeep?: Item[];
    /** worn at the start (sim: handed over and wielded; live: must be worn or held). */
    wear?: string[];
    /** sim-only: items put into the bank before the run (setup, not timed), deposited at `bankAt` (default Varrock east). */
    simBank?: Item[];
    bankAt?: Tile;
    run: (bot: SpeedBot, o: { log?: boolean; sim?: boolean; from?: string }) => Promise<RunResult>;
    tag: string;
}
export async function launch(s: LaunchSpec): Promise<never> {
    const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
    const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
    if (process.argv.includes('--supply')) {
        console.log(`${s.quest.name} SUPPLY: ${show(s.supply)}${s.wear?.length ? ` | worn: ${s.wear.join(', ')}` : ''}`);
        console.log(`requirements: quests [${s.reqs.quests.join(', ')}], qp ${s.reqs.qp}, skills ${Object.entries(s.reqs.skills).map(([k, v]) => `${k} ${v[0]} (${v[1]})`).join('; ')}`);
        console.log(`start ${JSON.stringify(s.reqs.start)} -> end ${JSON.stringify(s.reqs.end)}`);
        process.exit(0);
    }
    const live = arg('--live'), sim = process.argv.includes('--sim');
    if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `run-${s.tag} --live`;
    const name = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `${s.tag.slice(0, 6)}${Date.now() % 100000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(name);
    await bot.tick(3);
    const fin = async (code: number, msg: string): Promise<never> => { console.log(msg); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    const have = (i: Item) => bot.count(objId(i.name));
    if (sim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);
        for (const [v, n] of s.simVarps ?? []) { await bot.cheat(`setvar ${v} ${n}`); await bot.tick(1); }
        // --stats a=1,b=2 overrides/extends the launcher's sim stats (A/B runs)
        const extra = Object.fromEntries((arg('--stats') ?? '').split(',').filter(Boolean).map(kv => [kv.split('=')[0]!, Number(kv.split('=')[1])]));
        await localSetup(bot, { stats: { ...(s.simStats ?? {}), ...extra } });
        if (s.simBank?.length) {
            const b = s.bankAt ?? { x: 3253, z: 3421 };
            await localSetup(bot, { tele: b, items: s.simBank });
            await openBooth(bot);
            await bot.depositAll([]);
            bot.closeBank(); await bot.tick(2);
            for (const i of s.simBank) if (bot.bankCount(i.name) < i.n) await fin(1, `[${s.tag}] sim bank setup: ${i.name} ${bot.bankCount(i.name)}/${i.n}`);
        }
        const wear = (s.wear ?? []).filter(n => !bot.isWorn(objId(n))).map(n => ({ name: n, n: 1 }));
        await localSetup(bot, { items: wear.filter(i => have(i) < i.n) });
        await wieldAll(bot, s.wear ?? []);
        const all = [...(s.simKeep ?? []), ...s.supply];
        await localSetup(bot, { items: all.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) });
        await localSetup(bot, { tele: s.reqs.start });
        // debug resume: --setvar a=1,b=2  --give obj:n,obj:n  --drop obj,obj  --tele x,z,level  (passed to run as o.from = --from)
        for (const kv of (arg('--setvar') ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); await bot.cheat(`setvar ${k} ${v}`); }
        const drop = (arg('--drop') ?? '').split(',').filter(Boolean); if (drop.length) await bot.dropAll(drop);
        const give = (arg('--give') ?? '').split(',').filter(Boolean).map(g => ({ name: g.split(':')[0]!, n: Number(g.split(':')[1] ?? 1) }));
        if (give.length) await localSetup(bot, { items: give });
        const tl = arg('--tele'); if (tl) { const [x, z, l] = tl.split(',').map(Number); await localSetup(bot, { tele: { x: x!, z: z!, level: l ?? 0 } }); }
        await bot.tick(2);
    }
    const res = await runSpec(bot, s, { name, sim, from: sim ? arg('--from') : undefined, trace: process.argv.includes('--trace') });
    return fin(res.code, res.msg);
}

export async function runSpec(bot: SpeedBot, s: LaunchSpec, o: { name: string; sim: boolean; from?: string; trace?: boolean }): Promise<{ code: number; msg: string }> {
    const { name, sim } = o;
    const have = (i: Item) => bot.count(objId(i.name));
    const miss = s.supply.filter(i => have(i) < i.n).map(i => `${i.name} ${have(i)}/${i.n}`);
    for (const w of s.wear ?? []) if (!bot.isWorn(objId(w)) && !have({ name: w, n: 1 })) miss.push(`${w} (wear)`);
    if (miss.length && !(sim && o.from)) return { code: 1, msg: `[${s.tag}] missing ${miss.join(', ')}` };
    const low = Object.entries(s.reqs.skills).filter(([k, v]) => bot.stat(k).level < v[0]);
    if (low.length) console.log(`[${s.tag}] WARNING below the proven levels: ${low.map(([k, v]) => `${k} ${bot.stat(k).level}/${v[0]}`).join(', ')}`);
    console.log(`[${s.tag}] ${name}: start ${JSON.stringify(bot.pos())} qp ${qp(bot)} pack: ${packStr(bot)}`);
    const t0 = bot.tickCount;
    if (o.trace) { process.env.QTRACE = '1'; trace(bot, t0); }
    let r: RunResult;
    try { r = await s.run(bot, { log: true, sim, from: sim ? o.from : undefined }); }
    catch (e) { r = { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    console.log(`[${s.tag}] ${r.msg} | pack: ${packStr(bot)}`);
    if (!r.ok) console.log(`[${s.tag}] situation: ${situation(bot, 8)}`);
    if (r.ok) return { code: 0, msg: `[${s.tag}] QUEST COMPLETE in ${r.ticks} ticks (${s.quest.name}), qp ${qp(bot)}` };
    return { code: 1, msg: `[${s.tag}] FAILED after ${r.ticks} ticks: ${r.msg}` };
}
export { cheb, inDialog };

/** Open (op1) a trapdoor if closed, then climb down (op1 on the open one) until underground. The open state comes from the
 *  zone stream, but a trapdoor reverts by itself after 500 ticks (trapdoors.rs2:6) and the revert can leave our live-loc
 *  map stale (seen: 20 discarded OPLOCs on a 1570 that had closed): when an op gets no reaction, try the other id. */
export async function trapdoorDown(bot: SpeedBot, at: { x: number; z: number }, closedId: number, openId: number, stand: { x: number; z: number }): Promise<void> {
    const l = locAt(closedId, at.x, at.z, 0);
    // walk first (no op): a stale open/closed id must not burn the long walk budget on discarded OPLOCs
    if (!(bot.tile().z > 6400) && cheb(bot.tile(), stand) > 0) await walkOp(bot, stand, null, () => false, { maxTicks: 400 });
    let flip = false;
    for (let k = 0; k < 10 && !(bot.tile().z > 6400); k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        const live = bot.liveLocs.get(`0,${at.x},${at.z}`);
        let id = live === openId ? openId : closedId;
        if (flip) id = id === openId ? closedId : openId;
        const before = bot.liveLocs.get(`0,${at.x},${at.z}`);
        const ok = await walkOp(bot, stand, () => bot.opLoc(l.x, l.z, id, 1),
            () => (bot.tile().z > 6400) || bot.liveLocs.get(`0,${at.x},${at.z}`) !== before, { maxTicks: 6 });
        if (!ok && !(bot.tile().z > 6400)) flip = !flip;
    }
    if (!(bot.tile().z > 6400)) fail(bot, `trapdoor ${closedId} at ${at.x},${at.z}`);
}

/** Walk toward `at` (or the npc once in view, so walkOp's door handling opens any closed door on the way) and OPNPC1 it
 *  when the route ends; then send the dialog plan (q-lib talk, noOp). An OPNPC across a closed door is silently discarded
 *  by the engine (seen at King Roald's throne-room door, 3219,3472), hence the walk to the npc's own tile first. */
export async function talkAt(bot: SpeedBot, type: number, at: Tile, plan: FTok[], o: TalkOpts & { walkTicks?: number; level?: number } = {}): Promise<boolean> {
    const t0 = bot.tickCount, budget = o.walkTicks ?? 400;
    for (let k = 0; k < 20 && !inDialog(bot) && bot.tickCount - t0 < budget; k++) {
        const n = npcsOf(bot, type)[0];
        const dest = n ? { x: n.x, z: n.z } : at;
        const go = () => { const m = npcsOf(bot, type)[0]; if (!m) return false; opNpcGo(bot, m, 1); return true; };
        // re-plan when the npc wandered off the destination; walkOp closes an opened door leaf that walls us in (20 replans)
        const moved = () => { const m = npcsOf(bot, type)[0]; return !!n && !!m && cheb(m, dest) > 2; };
        const me0 = bot.tile();
        await walkOp(bot, dest, n ? go : null, () => inDialog(bot) || moved() || (!n && npcsOf(bot, type).length > 0), { near: n ? 0 : 2, maxTicks: n ? 40 : budget, level: o.level });
        if (!inDialog(bot) && cheb(bot.tile(), me0) === 0) { if (!(await bot.closeBlockingDoor())) await bot.tick(1); }
    }
    if (!inDialog(bot)) return false;
    const r = await talk(bot, type, plan, { ...o, noOp: true });
    return r.ok;
}

/** OPHELD<op> (1-5) on a backpack item. MIGRATED q-lib opHeld (same packet). */
export function opHeld(bot: SpeedBot, op: 1 | 2 | 3 | 4 | 5, obj: number, slot: number): void { qOpHeld(bot, obj, op, slot); }

// ---------------------------------------------------------------------------------------------------------------------
// Mort Myre blooming (Nature Spirit, Myreque top-up): the blessed sickle (op3) blooms the 3x3 around the player
// ---------------------------------------------------------------------------------------------------------------------
const BLOOMED = new Set([3509, 3511, 3513]);   // log / branch / pear tree, bloomed (loc_change for 25 t)
/** (3437,3349): the pear bush (3437,3348) is the first match of the sickle's x-major 3x3 scan, so every cast blooms it;
 *  the branch (3437,3350) blooms half the time. Both are cardinal neighbours (pickable without moving). */
export const PEAR_AT = { x: 3437, z: 3349 };
/** At PEAR_AT: cast the blessed sickle and pick until 3 pears (or 2 pears + a stem) are held. */
export async function harvestPears(bot: SpeedBot): Promise<void> {
    if (cheb(bot.tile(), PEAR_AT) > 0) await walkOp(bot, PEAR_AT, null, () => false, { maxTicks: 300 });
    const enough = () => bot.count('mortmyrepear') >= 3 || (bot.count('mortmyrepear') >= 2 && bot.count('mortmyrebuddingstem') >= 1);
    const pearUp = () => bloomedNear(bot, PEAR_AT).some(l => l.id === 3513);
    // session 11 fix 395a TEST (NS_TEST395=1, sim): cast the sickle until prayer is 0 first; the sip below must recover
    if (process.env.NS_TEST395 === '1') { for (let k = 0; k < 40 && bot.stat('prayer').cur > 0; k++) { dismiss(bot); opHeld(bot, 3, objId('silver_sickle_blessed'), bot.slot('silver_sickle_blessed')); await bot.tick(3); } console.log(`[ns] 395 TEST: prayer ${bot.stat('prayer').cur} after the drain`); }
    for (let k = 0; k < 12 && !enough(); k++) {
        // session 11 fix 395a (qx344m: prayer ran out mid-harvest, and the retry threw in 3 t): drink a prayer potion when
        // out, and fail only without one. NS_PRAY395=0 reverts.
        if (bot.stat('prayer').cur <= 0 && process.env.NS_PRAY395 !== '0') {
            const pot = bot.inv().find(s2 => /^[1-4]doseprayerrestore$/.test(objDebugName(s2.obj)));
            if (pot) { dismiss(bot); bot.opHeld1(pot.obj, pot.slot); bot.queueFlush(); await bot.until(() => bot.stat('prayer').cur > 0, 4); console.log(`[ns] 395a: sipped ${objDebugName(pot.obj)} -> prayer ${bot.stat('prayer').cur}`); }
        }
        if (bot.stat('prayer').cur <= 0) fail(bot, 'out of prayer for the sickle');
        // session 11 fix 398a (qx366m/qx370m STOP qp 96 'pears 2, stems 0' / 'pears 1, stems 1', retry the same: the pack was
        // 28/28 = 395a's 2 kept prayer potions + Drezel's 6 pies all rotted by the ghasts (6 rotten_food + 6 piedish), so the
        // 3rd pick never landed; before 395a those 2 slots were free): drop the rotten food and pie dishes when the pack
        // can't take the rest. NS_JUNK398=0 reverts. TEST: NS_TEST398=1 drops them whenever any are held (exercises the path).
        const need398 = 3 - bot.count('mortmyrepear') - Math.min(1, bot.count('mortmyrebuddingstem'));
        if (process.env.NS_JUNK398 !== '0' && (bot.free() < need398 || process.env.NS_TEST398 === '1')) {
            const f0 = bot.free(), n398 = dropAllOf(bot, ['rotten_food', 'piedish']);
            if (n398) { await bot.until(() => !bot.inv().some(s2 => /^(rotten_food|piedish)$/.test(objDebugName(s2.obj))), 6); console.log(`[ns] 398a: dropped ${n398} rotten_food/piedish, free ${f0} -> ${bot.free()} (need ${need398})`); }
        }
        dismiss(bot);
        if (!pearUp()) { opHeld(bot, 3, objId('silver_sickle_blessed'), bot.slot('silver_sickle_blessed')); await bot.until(pearUp, 4); }
        await pickBloomed(bot, PEAR_AT, 2, ['mortmyrepear', 'mortmyrebuddingstem']);
        await bot.tick(1);
    }
    if (!enough()) fail(bot, `pears ${bot.count('mortmyrepear')}, stems ${bot.count('mortmyrebuddingstem')}`);
}
/** Bloomed locs (log/branch/pear tree, live ids) on the 4 CARDINAL neighbours of `c` (the only ones pickable from c). */
export function bloomedNear(bot: SpeedBot, c: { x: number; z: number }): Array<{ x: number; z: number; id: number }> {
    const out: Array<{ x: number; z: number; id: number }> = [];
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const id = bot.liveLocs.get(`0,${c.x + dx},${c.z + dz}`);
        if (id !== undefined && BLOOMED.has(id)) out.push({ x: c.x + dx, z: c.z + dz, id });
    }
    return out;
}
/** Pick (op2) every bloomed loc around `c` (one per tick: each is a 1-tick interaction), or only those giving `want`. */
export async function pickBloomed(bot: SpeedBot, c: { x: number; z: number }, maxPicks: number, want?: string[]): Promise<void> {
    const prodOf: Record<number, string> = { 3509: 'mortmyremushroom', 3511: 'mortmyrebuddingstem', 3513: 'mortmyrepear' };
    for (let k = 0; k < maxPicks; k++) {
        const b = bloomedNear(bot, c).filter(l => !want || want.includes(prodOf[l.id]!));
        if (!b.length) return;
        const l = b[0]!, prod = prodOf[l.id]!, n0 = bot.count(prod);
        dismiss(bot);
        bot.opLoc(l.x, l.z, l.id, 2); bot.queueFlush();
        await bot.until(() => bot.count(prod) > n0, 5);
    }
}

/** OPLOC with the engine-valid approach (rsmod findPathToLoc, footprint + forceapproach aware; q-lib opLocGo) until
 *  `done()`: for multi-tile scenery where a hand-picked stand tile is easy to get wrong. */
export async function opLocReach(bot: SpeedBot, loc: locScene.SceneLoc, op: number, done: () => boolean, o: { maxTicks?: number; every?: number } = {}): Promise<boolean> {
    const t0 = bot.tickCount; let last = -99;
    while (bot.tickCount - t0 < (o.maxTicks ?? 60) && !done()) {
        // a page the op opened (e.g. the stalagmite's mesbox before the squeeze) must be CONTINUED: closing it aborts the script
        if (inDialog(bot) && !bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); last = bot.tickCount; }
        else if (bot.tickCount - last >= (o.every ?? 6)) { if (bot.chatModalId !== -1 || bot.mainModalId !== -1) dismiss(bot); opLocGo(bot, loc, op); last = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}

/** Out of Filliman's grotto / camp island (Nature Spirit's end): grotto exit (3442,9733) -> (3440,3337), then the agility
 *  "Jump" bridge south (3440,3331) (quest_druidspirit.rs2:26-61,108-115). No-op elsewhere. */
export async function leaveFillimanCamp(bot: SpeedBot): Promise<void> {
    const t = () => bot.tile();
    const inGrotto = () => t().z > 9700 && t().z < 9760 && t().x > 3420 && t().x < 3470;
    const inCamp = () => bot.minusedlevel === 0 && t().x >= 3434 && t().x <= 3446 && t().z >= 3331 && t().z <= 3342;
    if (inGrotto() && !(await opLocReach(bot, locAt(3525, 3442, 9733, bot.minusedlevel), 1, () => !inGrotto(), { maxTicks: 30 }))) fail(bot, 'grotto exit');
    if (inCamp() && !(await opUntil(bot, locAt(3522, 3440, 3331, 0), 1, { x: 3440, z: 3332 }, () => !inCamp(), { maxTicks: 60, tries: 6 }))) fail(bot, 'jump out of the camp');
}

/** Melee a 1x1 npc: route to its best CARDINAL neighbour (melee never hits diagonally, and a bare OPNPC from a diagonal
 *  tile next to a wall never starts the fight: seen with Loar shades in Mort'ton) + OPNPC2 in the same tick. */
export function attackFrom(bot: SpeedBot, n: NpcRef): void {
    const me = bot.tile();
    if (levelUpOpen(bot)) bot.resumeDialogPage();
    if (Math.abs(me.x - n.x) + Math.abs(me.z - n.z) !== 1) {
        let best: Tile[] | null = null;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const t = { x: n.x + dx, z: n.z + dz };
            let pts: Tile[] = [];
            try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, t.x, t.z, 500); } catch { pts = []; }
            const end = pts[pts.length - 1];
            if (!(t.x === me.x && t.z === me.z) && (!end || end.x !== t.x || end.z !== t.z)) continue;
            const dense = t.x === me.x && t.z === me.z ? [] : densify([me, ...pts]).slice(1);
            if (!best || dense.length < best.length) best = dense;
        }
        if (best && best.length) bot.sendRoute(turning(me, best), true);
    }
    bot.opNpc(n.idx, 2); bot.queueFlush();
}

/// <reference types="bun" />
// q-shield-of-arrav.ts — Shield of Arrav (1 QP each), a PAIR of accounts: one Phoenix Gang, one Black Arm Gang. Cheat-free.
//
// Content (rev 289; quests/quest_blackarmgang + areas/area_varrock/scripts):
//   The gang choice is permanent: Katrine refuses a Phoenix member (katrine.rs2:2-7), Straven a Black Arm (straven.rs2:4).
//   The halves sit behind each gang's door: arravshield1 in the Phoenix HQ chest (quest_blackarmgang.rs2:32-41, door :14-30
//   needs %phoenixgang >= joined), arravshield2 in the Black Arm cupboard (:99-116, door needs %blackarmgang >= joined).
//   The Curator turns BOTH halves into 2 certificates for a joined member of either gang (curator.rs2:7-23); King Roald takes
//   one certificate from each joined member and queues the completion (king_roald.rs2:11-27), which sets %phoenixgang = 10
//   if it was 9 (joined), else %blackarmgang = 4 (quest_blackarmgang.rs2:118-128). Both accounts get the QP (quests.rs2:170).
//
// PHOENIX (P): Reldo (3209,3495) "I'm in search of a quest." -> palace bookcase 2402 (3212,3493) op2 = book -> read it
//   (opheld1, arrav_book.rs2:2-9) -> Reldo again (reldo.rs2:39-44) -> Baraek (3218,3435) "Can you tell me where I can find
//   the Phoenix Gang?" + 20 gp (baraek.rs2:99-117) -> cellar ladder 1754 (3244,3383) -> Straven (3246,9780) "I know who you
//   are!" / "I'd like to offer you my services." (straven.rs2:24-50) -> kill Jonny the Beard (Blue Moon Inn, 8 hp; always
//   drops the intelligence report, drop tables/scripts/jonny_the_beard.rs2:3-11) -> Straven: joined + phoenixkey2
//   (straven.rs2:63-78) -> HQ door 2397 (3247,9779) -> chest 2403/2404 (3235,9761): arravshield1 -> out, ladder 2405 up ->
//   weapon store door 2398 (3251,3385) with the key (oplocu, :46-64) -> ladder 1747 (3252,3384) to L1 -> kill the
//   Weaponsmaster (20 hp; he stops any crossbow pickup within 10 tiles, :88-97 / weaponsmaster.rs2:18-24) -> 2 phoenix
//   crossbows (L1 3243,3383 and 3245,3385) -> down and out.
// BLACK ARM (B): tramp (3208,3391) "Is there anything down this alleyway?" / "Do you think they would let me join?"
//   (tramp.rs2:26-47) -> Katrine (3186,3385) "I've heard you're the Black Arm Gang." / "I'd rather not reveal my sources."
//   / "I want to become a member of your gang." / "Well, you can give me a try can't you?" / "Ok, no problem."
//   (katrine.rs2:14-78) -> [2 crossbows] -> Katrine: joined (:90-97) -> door 2399 (3185,3388) -> stairs 1722 (3188,3389)
//   -> cupboard 2400/2401 (L1 3188,3385): arravshield2.
// HANDSHAKES (core giveTo/acceptTradeFrom; each side walks to its meet tile and waits for the partner — works in one process
//   or in two):
//   H1 P -> B: 2 phoenix crossbows + arravshield1, outside the weapon store (meet tiles MEET1_P / MEET1_B).
//   B: Katrine (joined), cupboard (arravshield2), Curator (3255,3445): 2 certificates.
//   H2 B -> P: 1 certificate, in King Roald's room (MEET2_P / MEET2_B). Then both hand in to the King.
// Every step is gated on an observable (items, position, qp), so a rerun resumes where it stopped.
import { SpeedBot, objId, stepOpen } from '../../../core.js';
import { M2, M3, M4, R, navSync, situation, locAt, opLocGo, useOnLocGo, inDialog, nav, talk, dismiss, type Tile } from '../../q-lib.js';
import { openNpc, converse, chat, killFor, go, guard, fail, mkLog, completeCheck, answerUntil, syncLeaves, packStr, type Item } from './fb-lib.js';

export const QUEST = { name: 'Shield of Arrav', dir: 'quest_blackarmgang', qp: 1 };
/** Completion varps (not transmitted; for --sim setup of later quests, e.g. Hero's Quest): */
export const COMPLETE_VARPS = {
    phoenix: { varp: 'phoenixgang', id: 146, value: 10, cheat: 'setvar phoenixgang 10' },   // varp.pack 146; quest.constant:8
    blackarm: { varp: 'blackarmgang', id: 145, value: 4, cheat: 'setvar blackarmgang 4' },  // varp.pack 145; quest.constant:7
};
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        attack: [30, 'Phoenix side kills Jonny the Beard (8 hp) and the Weaponsmaster (cl23, 20 hp, att/def 21). Works at att/str/def/hp 30 (Weaponsmaster 72-107 t); proven fast at att/str 60, def/hp 30 (35 t)'],
        strength: [30, 'as attack'],
    } as Record<string, [number, string]>,
    start: { x: 3210, z: 3424, level: 0 },   // Varrock square (both accounts)
    end: { x: 3222, z: 3474, level: 0 },     // King Roald's room
};
export const REQUIREMENTS_BLACKARM = { ...REQUIREMENTS, skills: {} as Record<string, [number, string]> };
/** Phoenix account: 20 gp for Baraek (baraek.rs2:109-113) + food for the two fights. */
export const SUPPLY_PHOENIX: Item[] = [{ name: 'coins', n: 20 }, { name: 'lobster', n: 3 }];
/** Black Arm account: nothing (the crossbows and shield half come from the partner). */
export const SUPPLY_BLACKARM: Item[] = [];
export const SUPPLY: Item[] = SUPPLY_PHOENIX;
/** Variant FAST (`--xbows-supplied`): a helper hands the Black Arm account 2 phoenix crossbows (tradeable; their only source
 *  is the Phoenix weapon store, katrine.rs2:92-96 only counts them). The Phoenix side then skips the store and the Weaponsmaster. */
export const SUPPLY_BLACKARM_FAST: Item[] = [{ name: 'phoenix_crossbow', n: 2 }];

// ---- ids / tiles -------------------------------------------------------------------------------------------------------------
const N = { reldo: 647, baraek: 547, straven: 644, jonny: 645, weaponsmaster: 643, tramp: 641, katrine: 642, curator: 646, king: 648 };
const O = { book: 'the_shield_of_arrav', key: 'phoenixkey2', report: 'intelligence_report', half1: 'arravshield1', half2: 'arravshield2', xbow: 'phoenix_crossbow', cert: 'arravcertificate' };
const T = {
    reldo: { x: 3209, z: 3495 }, baraek: { x: 3218, z: 3435 }, straven: { x: 3246, z: 9780 }, jonny: { x: 3223, z: 3395 },
    tramp: { x: 3208, z: 3391 }, katrine: { x: 3186, z: 3385 }, curator: { x: 3255, z: 3445 }, king: { x: 3222, z: 3476 },
};
// H1 in Katrine's room: the Black Arm side goes straight back to her (a level-3 account waiting outside the weapon store was
// killed by the mugger at 3249,3391 — sim fbs2), and the Phoenix side's detour is shorter than the Black Arm's round trip
export const MEET1_P: Tile = { x: 3189, z: 3384 }, MEET1_B: Tile = { x: 3188, z: 3384 };
export const MEETM_P: Tile = { x: 3254, z: 3448 }, MEETM_B: Tile = { x: 3255, z: 3448 };   // museum, by the Curator (variant FAST)
export const MEET2_P: Tile = { x: 3221, z: 3473 }, MEET2_B: Tile = { x: 3222, z: 3473 };   // King Roald's room
const L = {
    bookcase: { id: 2402, x: 3212, z: 3493, level: 0 },
    cellar: { id: 1754, x: 3244, z: 3383, level: 0 }, hqLadder: { id: 2405, x: 3244, z: 9783, level: 0 },
    hqDoor: { id: 2397, x: 3247, z: 9779, level: 0 }, chestShut: { id: 2403, x: 3235, z: 9761, level: 0 },
    storeDoor: { id: 2398, x: 3251, z: 3385, level: 0 }, storeUp: { id: 1747, x: 3252, z: 3384, level: 0 }, storeDown: { id: 1746, x: 3252, z: 3384, level: 1 },
    baDoor: { id: 2399, x: 3185, z: 3388, level: 0 }, baUp: { id: 1722, x: 3188, z: 3389, level: 0 }, baDown: { id: 1723, x: 3188, z: 3390, level: 1 },
    cupShut: { id: 2400, x: 3188, z: 3385, level: 1 },
};
const XBOW_AT: Tile[] = [{ x: 3243, z: 3383 }, { x: 3245, z: 3385 }];
const underground = (bot: SpeedBot) => bot.tile().z > 6400;
const inStore = (bot: SpeedBot) => { const t = bot.tile(); return t.x >= 3242 && t.x <= 3253 && t.z >= 3380 && t.z <= 3385; };

type Res = { ok: boolean; ticks: number; msg: string };
/** A/B switch (env ARRAV_JONNY_FIRST=0 restores the Straven -> Jonny -> Straven order). */
const JONNY_FIRST = process.env.ARRAV_JONNY_FIRST !== '0';
/** In-process pair: a side that fails sets this so the partner stops waiting at a meet tile. */
export const PAIR = { failed: '' };
type Log = ReturnType<typeof mkLog>;

/** Operate a loc (route + op in one tick, re-sent every `every` ticks) until `done`. */
async function opUntil(bot: SpeedBot, l: { id: number; x: number; z: number; level: number }, op: number, done: () => boolean, label: string, o: { maxTicks?: number; every?: number; answers?: RegExp[]; liveId?: number } = {}): Promise<void> {
    // liveId: operate the loc that stands there NOW (e.g. an opened chest) with the static loc's geometry for the approach
    const loc0 = locAt(l.id, l.x, l.z, l.level);
    const loc = o.liveId ? { ...loc0, id: o.liveId } : loc0;
    const t0 = bot.tickCount; let last = -100, sends = 0;
    syncLeaves(bot);
    // walk to the interaction tile with walkOp first (it opens closed doors on the way; routeToLoc + OPLOC does not:
    // sim fbs1 stood at a closed door (3241,3382) under the cellar ladder for 40 t)
    const approach = async () => {
        const n = navSync(), me = bot.tile(), fa = n.locForceApproach(loc.id);
        if (n.reachedLoc(bot.minusedlevel, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, fa)) return;
        const path = n.findPathToLoc(bot.minusedlevel, me.x, me.z, loc.x, loc.z, loc.width, loc.length, loc.angle, loc.shape, 500, fa);
        const end = path[path.length - 1];
        if (end && Math.max(Math.abs(end.x - me.x), Math.abs(end.z - me.z)) > 1) await go(bot, end, 0, label, 600).catch(() => undefined);
    };
    if (!done()) await approach();
    while (!done()) {
        if (bot.tickCount - t0 > (o.maxTicks ?? 120)) fail(bot, `${label}: no effect | ${situation(bot)}`);
        if (bot.chatModalId !== -1) { if (bot.dialogOptions().length) { for (const re of o.answers ?? []) if (bot.clickDialogByText(re) > 0) break; } else bot.resumeDialogPage(); bot.queueFlush(); }
        else if (bot.tickCount - last >= (o.every ?? 6)) {
            if (bot.mainModalId !== -1) bot.closeModal();
            if (sends > 0 && sends % 2 === 0) await approach();
            opLocGo(bot, loc, op); last = bot.tickCount; sends++;
        }
        await bot.tick(1);
    }
}
/** Get to a loc's surroundings first with the long-range walker when it is far. */
async function near(bot: SpeedBot, t: Tile, label: string, d = 6): Promise<void> {
    const me = bot.tile();
    if (Math.max(Math.abs(me.x - t.x), Math.abs(me.z - t.z)) > d) await go(bot, t, Math.min(d, 3), label);
}

/**
 * Trade with the partner near `meet`. Both sides walk to their meet tile (best effort: a chaos-closed door can stop either),
 * then the GIVER walks to a free tile next to wherever the partner really stands and trades; a neighbour from which the trade
 * window never opens (adjacent across a closed door: sim fbs12, Katrine's door 3190,3384) is skipped. If the giver cannot get
 * there, the receiver walks to the giver after 60 t. Works in one process or in two (only the partner's name is needed).
 */
async function handshake(bot: SpeedBot, partner: string, meet: Tile, give: Array<{ obj: string; n: number | 'all' }> | null, gotIt: () => boolean, label: string, log: Log, maxWait = 3000): Promise<void> {
    if (gotIt()) return;
    try { await go(bot, meet, 0, label, 600); } catch (e) { log(`${label}: meet tile not reached (${(e as Error).message.slice(0, 80)}), going on`); }
    log(`${label}: near the meet tile, waiting for ${partner}`);
    const t0 = bot.tickCount, bad = new Set<string>();
    let seenAt = -1;
    const n = navSync();
    const linkedNeighbours = (pt: Tile): Tile[] => {
        const me = bot.tile(), lv = bot.minusedlevel, out: Array<Tile & { d: number }> = [];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
            const nb = { x: pt.x + dx, z: pt.z + dz };
            if (bad.has(`${nb.x},${nb.z}`)) continue;
            if (!stepOpen(lv, nb.x, nb.z, pt.x, pt.z)) continue;   // core.ts stepOpen = the 3-step findLongPath probe
            const d = nb.x === me.x && nb.z === me.z ? 0 : n.findLongPath(lv, me.x, me.z, nb.x, nb.z, 80).length ? Math.max(Math.abs(nb.x - me.x), Math.abs(nb.z - me.z)) + (dx && dz ? 0.5 : 0) : 999;
            if (d < 999) out.push({ ...nb, d });
        }
        return out.sort((a, c) => a.d - c.d);
    };
    for (let attempt = 0; !gotIt(); attempt++) {
        if (bot.tickCount - t0 > maxWait) fail(bot, `${label}: ${partner} never traded`);
        if (PAIR.failed) fail(bot, `${label}: partner failed (${PAIR.failed})`);
        const pt = bot.playerTileByName(partner);
        if (!pt || Math.max(Math.abs(pt.x - bot.tile().x), Math.abs(pt.z - bot.tile().z)) > 14) { await bot.tick(1); continue; }
        if (seenAt < 0) seenAt = bot.tickCount;
        syncLeaves(bot);
        // the giver approaches; the receiver only after 60 t without a trade (the giver may be stuck behind a door)
        if (give || bot.tickCount - seenAt > 60) {
            const me = bot.tile();
            const adj = Math.max(Math.abs(pt.x - me.x), Math.abs(pt.z - me.z)) === 1 && !bad.has(`${me.x},${me.z}`) && linkedNeighbours(pt).some(t => t.x === me.x && t.z === me.z);
            if (!adj) {
                const nb = linkedNeighbours(pt)[0];
                if (nb) await go(bot, nb, 0, `${label} to partner`, 60).catch(() => { bad.add(`${nb.x},${nb.z}`); });
                else await bot.tick(1);
                continue;
            }
        }
        const tradeTicks = 16;
        let r;
        if (give) {
            const items = give.filter(g => bot.count(g.obj) > 0).map(g => ({ obj: g.obj, n: g.n }));
            if (!items.length) fail(bot, `${label}: nothing to give`);
            r = await bot.giveTo(partner, items, { maxTicks: tradeTicks });
            if (r.ok) { log(`${label}: gave ${JSON.stringify(items)}`); return; }
        } else {
            r = await bot.acceptTradeFrom(partner, { maxTicks: tradeTicks, maxDist: 2 });
            if (r.ok && gotIt()) { log(`${label}: received`); return; }
        }
        if (bot.mainModalId !== -1) { bot.closeModal(); await bot.tick(1); }
        // no window from here: try another neighbour next time
        if (give || bot.tickCount - seenAt > 60) { const me = bot.tile(); bad.add(`${me.x},${me.z}`); log(`${label}: no trade from (${me.x},${me.z}) [${r?.message ?? ''}]`); }
        if (bad.size > 8) bad.clear();
    }
}

// =============================================================================================================================
// PHOENIX
// =============================================================================================================================
/** o.xbowsSupplied: the Black Arm partner was handed 2 phoenix crossbows by a helper (variant FAST): skip the weapon store,
 *  receive arravshield2 in the museum (MEETM_*), visit the Curator yourself and send a certificate back at the King. */
export async function runPhoenix(bot: SpeedBot, partner: string, o: { log?: boolean; xbowsSupplied?: boolean } = {}): Promise<Res> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'arrav-P', o.log !== false);
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    const g = guard(bot);
    const has = (k: string) => bot.count(k) > 0;
    try {
        const joined = () => has(O.key) || has(O.half1) || has(O.xbow) || has(O.cert);
        // ---- 1. Reldo, book, Reldo, Baraek, Straven (gated on the coins Baraek takes: no observable before that) ----
        let baraekDone = false;
        if (!joined() && !has(O.report)) {
            const coins0 = bot.count('coins');
            if (coins0 < 20) fail(bot, 'need 20 coins for Baraek');
            if (!has(O.book)) {
                await chat(bot, N.reldo, T.reldo, [R, M3[0]!, R, R, R, R, R], [/^I'm in search of a quest\.$/], 'reldo1');
                log.split('reldo1');
                await opUntil(bot, L.bookcase, 2, () => has(O.book), 'bookcase', { answers: [] });
                await answerUntil(bot, () => !inDialog(bot), [], 10);
                log.split('book');
            }
            // read it (opheld1 sets read_book at once, arrav_book.rs2:2-9), close the book, Reldo again
            // the read is only observable as the book interface opening (main modal): retry until it does (sim fbs20: the op
            // was swallowed by a page still open from the bookcase, Reldo then offered no Phoenix line)
            {
                const t1 = bot.tickCount; let last = -100;
                while (bot.mainModalId === -1) {
                    if (bot.tickCount - t1 > 20) fail(bot, 'book: never opened');
                    if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                    else if (bot.tickCount - last >= 3) { bot.opHeld1(objId(O.book), bot.slot(O.book)); bot.queueFlush(); last = bot.tickCount; }
                    await bot.tick(1);
                }
                bot.closeModal();
            }
            await openNpc(bot, N.reldo, T.reldo, 'reldo2');
            await talk(bot, N.reldo, [R, R, R, R], { noOp: true, maxTicks: 20, label: 'reldo2' });
            log.split('reldo2');
            await converse(bot, N.baraek, T.baraek, [M3[0]!, R, R, R, R, R, R, M3[0]!, R, R, R, R], () => bot.count('coins') <= coins0 - 20 && !inDialog(bot),
                [/^Can you tell me where I can find the Phoenix Gang\?$/, /^Okay\. Have 20 gold coins\.$/], 'baraek', { maxTicks: 30 });
            baraekDone = true;
            log.split('baraek');
            // Jonny the Beard always drops the report (no quest gate, jonny_the_beard.rs2:3-11) and the Blue Moon Inn is on the
            // way from Baraek to the cellar: kill him BEFORE the first Straven talk, then talk to Straven twice in a row
            // (A/B: fbs5 Straven -> Jonny -> Straven cost 105 t for straven1+jonny+straven2)
            if (JONNY_FIRST && !has(O.report)) { await killFor(bot, 'jonny', [N.jonny], T.jonny, [objId(O.report)], () => has(O.report), { maxTicks: 400 }); log.split('jonny'); }
            await toStraven(bot, log);
            await chat(bot, N.straven, T.straven, [R, R, M3[0]!, R, R, R, R, M2[0]!, R, R, R, R, R, R, R, R, R, R],
                [/^I know who you are!$/, /^I'd like to offer you my services\.$/], 'straven1');
            log.split('straven1');
        }
        // ---- 2. Jonny the Beard -> intelligence report ----
        if (!joined() && !has(O.report)) {
            if (underground(bot)) await upFromHq(bot, log);
            await killFor(bot, 'jonny', [N.jonny], T.jonny, [objId(O.report)], () => has(O.report), { maxTicks: 400 });
            log.split('jonny');
        }
        // ---- 3. Straven: joined + key ----
        if (!joined()) {
            await toStraven(bot, log);
            await converse(bot, N.straven, T.straven, [R, R, R, R, R, R, R, R, R, R], () => has(O.key) && !inDialog(bot), [], 'straven2', { maxTicks: 30 });
            log.split('straven2');
        }
        // ---- 4. HQ chest -> arravshield1 ----
        if (!has(O.half1) && !has(O.cert)) {
            if (!underground(bot)) await toStraven(bot, log);
            // through the HQ door (it teleports you in: quest_blackarmgang.rs2:66-86), to the chest
            await opUntil(bot, L.hqDoor, 1, () => bot.tile().z <= 9779, 'hq door', { maxTicks: 40 });
            await near(bot, { x: L.chestShut.x, z: L.chestShut.z + 1 }, 'to chest', 2);
            const openId = 2404;
            const chestOpen = () => bot.liveLocs.get(`0,${L.chestShut.x},${L.chestShut.z}`) === openId;
            // the chest may already stand open (another player, or our last visit: it reverts after 300 t, chests.rs2:63-69)
            for (let k = 0; k < 4 && !has(O.half1); k++) {
                if (!chestOpen()) await opUntil(bot, L.chestShut, 1, chestOpen, 'chest open', { maxTicks: 30 });
                await opUntil(bot, L.chestShut, 1, () => has(O.half1) || !chestOpen(), 'chest search', { maxTicks: 30, liveId: openId }).catch(() => undefined);
            }
            if (!has(O.half1)) fail(bot, 'chest: no shield half');
            await answerUntil(bot, () => !inDialog(bot), [], 10);
            log.split('chest');
        }
        // ---- 5. weapon store -> 2 crossbows ----
        if (!o.xbowsSupplied && bot.count(O.xbow) < 2 && !has(O.cert)) {
            if (underground(bot)) await upFromHq(bot, log);
            // door (key, teleports you in) then ladder; re-checked every tick so a bounce back out re-enters
            {
                const door = locAt(L.storeDoor.id, L.storeDoor.x, L.storeDoor.z, 0), lad = locAt(L.storeUp.id, L.storeUp.x, L.storeUp.z, 0);
                if (!inStore(bot) && bot.minusedlevel === 0) await near(bot, { x: L.storeDoor.x, z: L.storeDoor.z + 1 }, 'to store', 1);
                const t1 = bot.tickCount; let last = -100;
                while (bot.minusedlevel === 0) {
                    if (bot.tickCount - t1 > 80) fail(bot, `store: still on L0 | ${situation(bot)}`);
                    if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                    else if (bot.tickCount - last >= 5) {
                        syncLeaves(bot);
                        if (inStore(bot)) opLocGo(bot, lad, 1);
                        else if (Math.max(Math.abs(bot.tile().x - 3251), Math.abs(bot.tile().z - 3386)) > 1) await go(bot, { x: 3251, z: 3386 }, 0, 'to store door', 60).catch(() => undefined);
                        else useOnLocGo(bot, O.key, door);
                        last = bot.tickCount;
                    }
                    await bot.tick(1);
                }
            }
            log.split('store');
            await killFor(bot, 'weaponsmaster', [N.weaponsmaster], { x: 3246, z: 3384 }, [], () => npcsAlive(bot, N.weaponsmaster) === 0, { maxTicks: 300 });
            log.split('weaponsmaster');
            const t2 = bot.tickCount;
            while (bot.count(O.xbow) < 2) {
                if (bot.tickCount - t2 > 60) fail(bot, `crossbows ${bot.count(O.xbow)}/2`);
                const gi = bot.findGroundItem(objId(O.xbow), 8);
                if (gi) { const { pickupGo } = await import('../../q-lib.js'); const c0 = bot.count(O.xbow); pickupGo(bot, O.xbow, { x: gi.x, z: gi.z }); await bot.until(() => bot.count(O.xbow) > c0, 8); }
                else await bot.tick(1);
            }
            log.split('crossbows');
            await opUntil(bot, L.storeDown, 1, () => bot.minusedlevel === 0, 'store ladder down');
            const door = locAt(L.storeDoor.id, L.storeDoor.x, L.storeDoor.z, 0);
            const t3 = bot.tickCount;
            while (inStore(bot)) {
                if (bot.tickCount - t3 > 40) fail(bot, 'store door out');
                if ((bot.tickCount - t3) % 5 === 0) opLocGo(bot, door, 1);
                await bot.tick(1);
            }
            log.split('out');
        }
        if (!o.xbowsSupplied) {
            // ---- H1: crossbows + shield half -> Black Arm ----
            await handshake(bot, partner, MEET1_P, [{ obj: O.xbow, n: 'all' }, { obj: O.half1, n: 1 }], () => !has(O.xbow) && !has(O.half1), 'H1', log);
            log.split('H1');
            // ---- H2: a certificate back, in the King's room ----
            await handshake(bot, partner, MEET2_P, null, () => has(O.cert), 'H2', log, 4000);
            log.split('H2');
        } else {
            if (underground(bot)) await upFromHq(bot, log);
            // ---- H1 (FAST): arravshield2 from the Black Arm partner, in the museum; Curator; a certificate back at the King ----
            await handshake(bot, partner, MEETM_P, null, () => has(O.half2) || has(O.cert), 'H1m', log, 4000);
            log.split('H1m');
            await curator(bot, log);
            await handshake(bot, partner, MEET2_P, [{ obj: O.cert, n: 1 }], () => bot.count(O.cert) === 1, 'H2', log, 4000);
            log.split('H2');
        }
        await king(bot, done);
        log.split('complete');
        if (g.dead) fail(bot, 'died');
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        PAIR.failed ||= `${bot.loginUser}: ${(e as Error).message}`;
        return { ok: false, ticks: bot.tickCount - log.t0, msg: `${(e as Error).message} | pack ${packStr(bot)}` };
    } finally { g.stop = true; bot.holdDialogs = false; }
}
function npcsAlive(bot: SpeedBot, type: number): number {
    let n = 0; for (let i = 0; i < bot.npcCount; i++) { const q = bot.npcs[bot.npcIndices[i]!]; if (q && q.typeId === type) n++; } return n;
}
async function toStraven(bot: SpeedBot, log: Log): Promise<void> {
    if (underground(bot)) { await near(bot, T.straven, 'to straven', 3); return; }
    await near(bot, L.cellar, 'to cellar', 4);
    await opUntil(bot, L.cellar, 1, () => underground(bot), 'cellar ladder', { maxTicks: 60 });
    log('down the cellar ladder');
    await near(bot, T.straven, 'to straven', 3);
}
async function upFromHq(bot: SpeedBot, log: Log): Promise<void> {
    if (bot.tile().z <= 9779) await opUntil(bot, L.hqDoor, 1, () => bot.tile().z >= 9780, 'hq door out', { maxTicks: 40 });
    await near(bot, L.hqLadder, 'to hq ladder', 3);
    await opUntil(bot, L.hqLadder, 1, () => !underground(bot), 'hq ladder up', { maxTicks: 60 });
    log('up from the HQ');
}
async function curator(bot: SpeedBot, log: Log): Promise<void> {
    if (bot.count(O.cert) > 0) return;
    if (bot.count(O.half1) === 0 || bot.count(O.half2) === 0) fail(bot, 'Curator: need both shield halves');
    await converse(bot, N.curator, T.curator, [R, R, R, R, R, R, R, R, R, R, R, R], () => bot.count(O.cert) >= 2 && !inDialog(bot), [], 'curator',
        { maxTicks: 30, stand: { x: 3254, z: 3447 } /* inside the museum (doors 1520/1517 at 3253,3448-9) */ });
    log.split('curator');
}
async function king(bot: SpeedBot, done: () => boolean): Promise<void> {
    if (done()) return;
    await openNpc(bot, N.king, T.king, 'king', { done: () => inDialog(bot) || done() });
    const t0 = bot.tickCount;
    while (!done()) {
        if (bot.tickCount - t0 > 60) fail(bot, 'king: no completion');
        if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
        else if ((bot.tickCount - t0) % 8 === 7) await openNpc(bot, N.king, T.king, 'king', { done: () => inDialog(bot) || done() });
        await bot.tick(1);
    }
}

// =============================================================================================================================
// BLACK ARM
// =============================================================================================================================
export async function runBlackArm(bot: SpeedBot, partner: string, o: { log?: boolean } = {}): Promise<Res> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'arrav-B', o.log !== false);
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    const g = guard(bot);
    const has = (k: string) => bot.count(k) > 0;
    try {
        const joinedItems = () => has(O.half2) || has(O.cert);
        const fast = bot.count(O.xbow) >= 2 && !has(O.half1);   // variant FAST: a helper gave us the crossbows
        const KAT = [/^I've heard you're the Black Arm Gang\.$/, /^I'd rather not reveal my sources\.$/, /^I want to become a member of your gang\.$/, /^Well, you can give me a try can't you\?$/, /^Ok, no problem\.$/];   // fix 362: katrine1 + katrine2
        // ---- 1. tramp + Katrine (spoken_katrine) — no observable: skipped only when already past it ----
        if (!joinedItems() && !(bot.count(O.xbow) >= 2 && has(O.half1))) {
            await chat(bot, N.tramp, T.tramp, [R, M4[3]!, R, R, M2[1]!, R, R, R],
                [/^Is there anything down this alleyway\?$/, /^Do you think they would let me join\?$/], 'tramp');
            log.split('tramp');
            // session 11 fix 362 (qx182p: a scheduled sim drop 1 t after Katrine's first page closed the dialog, chat() saw no
            // dialog and returned: spoken_katrine (katrine.rs2:68) never set, katrine2 got the first-time menu with no answers,
            // 'dialog did not finish' after 3 tries -> both routes STOPPED (arrav is NO_RETRY, route.ts:62; PAIR.failed is
            // never reset). katrine1 must SHOW the line after the varp ('Great! You'll find ...'), or the got-yet/joined
            // lines when a drop came after it; katrine2 answers the join menu too. AR_KAT=0 reverts. TEST: AR_KAT_TEST=1
            // skips katrine1 (= the qx182 state).
            const katFix = process.env.AR_KAT !== '0';
            if (process.env.AR_KAT_TEST === '1') log(`362 TEST: katrine1 skipped`);
            else await chat(bot, N.katrine, T.katrine, [R, R, M3[0]!, R, R, M3[0]!, R, R, M3[0]!, R, R, R, R, M2[0]!, R, R, R, R, R, R, M2[0]!, R, R], KAT, 'katrine1',
                katFix ? { expect: /Great! You'll find|crossbows for me yet|You can join our gang now/i } : {});
            log.split('katrine1');
        }
        if (!fast) {
            // ---- H1: crossbows + arravshield1 from the Phoenix partner ----
            await handshake(bot, partner, MEET1_B, null, () => (bot.count(O.xbow) >= 2 && has(O.half1)) || joinedItems(), 'H1', log, 6000);
            log.split('H1');
        }
        // ---- 2. Katrine: joined ----
        if (bot.count(O.xbow) >= 2) {
            await converse(bot, N.katrine, T.katrine, [R, R, R, R], () => bot.count(O.xbow) === 0 && !inDialog(bot), process.env.AR_KAT !== '0' ? KAT : [], 'katrine2', process.env.AR_KAT !== '0' ? { maxTicks: 60, tries: 4 } : { maxTicks: 20 });   // fix 362
            log.split('katrine2');
        }
        // ---- 3. cupboard -> arravshield2 ----
        if (!has(O.half2) && !has(O.cert)) {
            if (bot.minusedlevel === 0) {
                await opUntil(bot, L.baDoor, 1, () => bot.tile().z >= 3388, 'black arm door', { maxTicks: 40 });
                await opUntil(bot, L.baUp, 1, () => bot.minusedlevel === 1, 'stairs up', { maxTicks: 40 });
            }
            const openId = 2401;
            const cupOpen = () => bot.liveLocs.get(`1,${L.cupShut.x},${L.cupShut.z}`) === openId;
            // the cupboard may already stand open (it reverts after 300 t, cupboards.rs2:41-47): sim fbs11/fbs15 found it open
            // from the previous pair's visit and op'd it from the stairs without walking over (OPLOC does not self-route)
            for (let k = 0; k < 4 && !has(O.half2); k++) {
                if (!cupOpen()) await opUntil(bot, L.cupShut, 1, cupOpen, 'cupboard open', { maxTicks: 30 });
                await opUntil(bot, L.cupShut, 2, () => has(O.half2) || !cupOpen(), 'cupboard search', { maxTicks: 30, liveId: openId }).catch(() => undefined);
            }
            if (!has(O.half2)) fail(bot, 'cupboard: no shield half');
            await answerUntil(bot, () => !inDialog(bot), [], 10);
            log.split('cupboard');
            await opUntil(bot, L.baDown, 1, () => bot.minusedlevel === 0, 'stairs down', { maxTicks: 40 });
            await opUntil(bot, L.baDoor, 1, () => bot.tile().z < 3388, 'black arm door out', { maxTicks: 40 });
        }
        if (!fast) {
            // ---- 4. Curator: 2 certificates ----
            await curator(bot, log);
            // ---- H2: one certificate to the partner, then the King ----
            if (bot.count(O.cert) >= 2) {
                await handshake(bot, partner, MEET2_B, [{ obj: O.cert, n: 1 }], () => bot.count(O.cert) === 1, 'H2', log, 4000);
                log.split('H2');
            }
        } else {
            // ---- FAST: arravshield2 to the Phoenix partner in the museum, a certificate back at the King ----
            await handshake(bot, partner, MEETM_B, [{ obj: O.half2, n: 1 }], () => !has(O.half2), 'H1m', log, 4000);
            log.split('H1m');
            await handshake(bot, partner, MEET2_B, null, () => has(O.cert), 'H2', log, 4000);
            log.split('H2');
        }
        await king(bot, done);
        log.split('complete');
        if (g.dead) fail(bot, 'died');
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        PAIR.failed ||= `${bot.loginUser}: ${(e as Error).message}`;
        return { ok: false, ticks: bot.tickCount - log.t0, msg: `${(e as Error).message} | pack ${packStr(bot)}` };
    } finally { g.stop = true; bot.holdDialogs = false; }
}

/** Contract `run`: a solo account cannot finish this quest (it needs a partner of the other gang). */
export async function run(bot: SpeedBot, _o?: { log?: boolean }): Promise<Res> {
    return { ok: false, ticks: 0, msg: `${bot.loginUser}: Shield of Arrav needs a pair: call runPhoenix(bot, partner) and runBlackArm(bot2, partner) together (run-shield-of-arrav.ts)` };
}
export { dismiss };

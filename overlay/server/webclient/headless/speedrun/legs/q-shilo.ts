// q-shilo.ts — JUNGLE POTION + SHILO VILLAGE, then the account may mine the Shilo gem rocks (uncut opal / jade / red topaz).
//
// WHY: on rev 289 red topaz has ONE source — gem_rock_table (skill_mining/configs/gem_rock_table.dbrow: opal 60 / jade 30 / red topaz 15 /
// sapphire 9 / emerald 5 / ruby 5 / diamond 4 of 128), rolled ONLY by the 7 `gemrock` locs (2111) at x2820-2825 z2998-3003
// (GET /api/market/items/1625|1627|1629 -> volume 0). Digsite panning gives opal + jade but never red topaz. Shilo's
// wooden gate (zqwoodengateclosed_l 2261 @2867,2953) answers "The gate won't open." until %zombiequeen >= complete
// (quest_zombiequeen.rs2:101-133), and rsmod confirms the mine is only reachable through it. So: do the quest.
//
// PREREQUISITES (checked, not assumed): Agility 32 (fissure + Cairn Isle crawl-way, quest_zombiequeen.rs2:390/619), Crafting 20
// (bone key, :1285), Prayer 10 (crystal, unused here), Herblore 3 (identify the Jungle Potion herbs, identify.rs2), Mining 40
// (the gem rocks afterwards, mine.dbrow gem_rock level 40). Train those first; this file does the rest:
//
//   mainland  m-bank (coins + sharks) -> m-tools (Lumbridge Bob: bronze pickaxe) -> m-meats (Lumbridge chicken + 4 bones, cow
//             beef, swamp giant rat) -> m-mine (Varrock SE copper/tin/iron to 40) -> m-weapon (Varrock sword shop adamant
//             longsword, wield) -> m-bear (Taverley dark bears) -> m-druidic (Druidic Ritual, walking) -> m-boat (Port Sarim
//             -> Musa Point)
//   karamja   k-shop (Jiminua: spade chisel rope tinderbox candle hammer 2 bronze bars) -> k-smith (Tai Bwo Wannai anvil:
//             dagger for Smithing 4, then bronze wire) -> k-jungle (Jungle Potion) -> k-belt (Mosol Rei) -> k-start (belt on
//             Trufitus) -> k-mound (stepping stones, search/dig/light/rope, crawl in) -> k-azr (plaque, scrolls, Zadimus,
//             waterfall exit) -> k-bury (bone shard) -> k-cairn1 (Bervirius tomb dolmen) -> k-beads -> k-tomb (bone key,
//             3 bones, Nazastarool x3, corpse) -> k-cairn2 (corpse on the dolmen = QUEST COMPLETE) -> k-enter (Mosol: into
//             the village).
//
// Every phase checks an OBSERVABLE (item, stat, position) before and after; a finished phase is recorded in
// logs/shilo/<acct>.json so a relaunch resumes. Coordinates: content jm2 scans + rsmod (sim/shilo-geo.test.ts checks each).
// LOCAL (cheats, engine copy on :8891):  LC_HOST=localhost:8891 bun headless/speedrun/legs/q-shilo.ts local <user> <phase|all> [--setup]
// LIVE:  LC_HOST=rs-sdk-demo.fly.dev bun headless/speedrun/legs/q-shilo.ts live <acct> [all|<phase>...]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { SpeedBot, localSetup, objId, cheb } from '../core.js';
import { BANKS } from '../../bank-sites.js';
import { isTileWalkable } from '../../../../../sdk/pathfinding';
import * as rsmodPF from '../../../../vendor/rsmod-pathfinder';
import {
    nav, npc, npcsOf, inDialog, walkOp, locAt, opNpcGo, routeToLoc, dismiss, msgsSince, type Tile, type NpcRef,
} from './q-lib.js';

// ---- ids (content/pack/obj.pack, npc.pack, loc.pack) ----------------------------------------------------------------------
export const O = {
    coins: 995, shark: 385, bones: 526, spade: 952, chisel: 1755, rope: 954, tinderbox: 590, unlitCandle: 36, litCandle: 33,
    torchUnlit: 596, torchLit: 594, hammer: 2347, bronzeBar: 2349, bronzeDagger: 1205, wire: 1794, bronzePickaxe: 1265,
    rawChicken: 2138, rawBeef: 2132, rawRat: 2134, rawBear: 2136, enchBeef: 522, enchRat: 523, enchBear: 524, enchChicken: 525,
    copperOre: 436, tinOre: 438, ironOre: 440, adamantLongsword: 1301,
    belt: 625, plaque: 606, crumpled: 608, tattered: 607, notes: 624, zadimus: 610, boneShard: 604, key: 605, pommel: 623,
    boneBeads: 618, deadBeads: 616, crystal: 611, corpse: 609,
    uSnake: 1525, snake: 1526, uArdrigal: 1527, ardrigal: 1528, uSito: 1529, sito: 1530, uVolencia: 1531, volencia: 1532,
    uRogues: 1533, rogues: 1534,
    uOpal: 1625, uJade: 1627, uTopaz: 1629,
} as const;
export const N = {
    mosol: 500, trufitus: 740, jiminua: 560, zadimus: 501, naz1: 507, naz2: 508, naz3: 509, rash: 506,
    undead: [502, 503, 504, 505], sailors: [376, 377, 378], bob: 519, swordshop: 551, kaqemeex: 455, sanfew: 454,
    chicken: 41, cow: [81, 397], giantrat: [86, 87], darkbear: 106, suit: 453,
} as const;
// locs: [id, x, z] (origin tiles, m44/45/43 jm2 LOC sections)
export const L = {
    anvil: { id: 2783, x: 2790, z: 3101 },
    snakeVine: [{ id: 2575, x: 2760, z: 3014 }, { id: 2575, x: 2761, z: 3017 }],
    ardrigal: [{ id: 2577, x: 2870, z: 3115 }, { id: 2577, x: 2874, z: 3124 }, { id: 2577, x: 2877, z: 3120 }],
    sito: [{ id: 2579, x: 2789, z: 3047 }, { id: 2579, x: 2790, z: 3049 }, { id: 2579, x: 2791, z: 3047 }, { id: 2579, x: 2784, z: 3067 }],
    volencia: [{ id: 2581, x: 2850, z: 3035 }, { id: 2581, x: 2851, z: 3033 }, { id: 2581, x: 2851, z: 3036 }],
    pothole: { id: 2584, x: 2824, z: 3118 },
    fungus: [{ id: 2583, x: 2869, z: 9517 }, { id: 2583, x: 2869, z: 9492 }, { id: 2583, x: 2850, z: 9476 }],
    caveOut: { id: 2585, x: 2830, z: 9522 },
    stones: [{ id: 2335, x: 2925, z: 2948 }, { id: 2334, x: 2925, z: 2949 }, { id: 2333, x: 2925, z: 2950 }],
    mound: { id: 2217, x: 2921, z: 2999 },
    secretStone: { id: 2221, x: 2901, z: 9379 },
    rubbleN: { id: 2220, x: 2887, z: 9373 },
    sacks: { id: 2223, x: 2939, z: 9285 },
    rubbleBook: { id: 2222, x: 2885, z: 9317 },
    gallows: { id: 2224, x: 2934, z: 9325 },
    waterfall: { id: 2225, x: 2940, z: 9349 },
    climbRocks: { id: 2231, x: 2794, z: 2979 },          // east face of the Cairn Isle climbing rocks (3 tiles z2978-2980)
    climbRocksW: { id: 2231, x: 2792, z: 2979 },
    crawl: { id: 2234, x: 2762, z: 2990 },
    dolmen: { id: 2235, x: 2766, z: 9364 },
    handholds: { id: 2236, x: 2765, z: 9376 },
    hidyTree: { id: 2237, x: 2916, z: 3092 },
    tombGate: { id: 2255, x: 2928, z: 9516 },
    rashRocks: { id: 2257, x: 2928, z: 9515 },          // DOWN: the rock right below the gate (live-probed locally: the others answer "I can't reach that!")
    rashRocksUp: { id: 2257, x: 2928, z: 9512 },        // UP from the bottom tile (2928,9511)
    tombDoor: { id: 2246, x: 2892, z: 9480 },
    rashDolmen: { id: 2258, x: 2892, z: 9487 },
    exitDoor: { id: 2242, x: 2929, z: 9527 },
} as const;
// npc / station tiles
export const T = {
    portSarimDock: { x: 3029, z: 3217 }, karamjaShip: { x: 2956, z: 3143 }, karamjaPlank: { id: 2082, x: 2956, z: 3144 },
    jiminua: { x: 2767, z: 3121 }, trufitus: { x: 2809, z: 3087 }, mosol: { x: 2884, z: 2951 },
    stonesSouth: { x: 2925, z: 2947 }, moundStand: { x: 2920, z: 2999 },
    azrNorth: { x: 2898, z: 9401 }, azrSouth: { x: 2888, z: 9283 },
    sacred: { x: 2796, z: 3088 },                         // inzone 0_43_48_42_15 .. 46_18 = x2794-2798 z3087-3090
    cairnEast: { x: 2795, z: 2979 }, cairnWest: { x: 2791, z: 2979 }, cairnLand: { x: 2765, z: 2976 },
    stonesNorth: { x: 2925, z: 2951 },
    berviriusLand: { x: 2760, z: 9389 },
    tombOutside: { x: 2916, z: 3094 }, tombIn: { x: 2929, z: 9525 },   // the exit lands on (2916,3093), a statically blocked tile
    bob: { x: 3231, z: 3203 }, chickens: { x: 3229, z: 3298 }, cows: { x: 3255, z: 3277 }, rats: { x: 3195, z: 3205 },
    ratsAlt: { x: 3211, z: 3185 }, mineVarrock: { x: 3286, z: 3367 }, swordshop: { x: 3205, z: 3398 },
    bears: { x: 2966, z: 3474 }, kaqemeex: { x: 2924, z: 3486 },
} as const;

// ---- progress file ---------------------------------------------------------------------------------------------------------
const LOGDIR = resolve(import.meta.dir, '../../../../../logs/shilo');
export function progPath(acct: string): string { return resolve(LOGDIR, `${acct}.json`); }
export function readProg(acct: string): { done: string[]; notes?: Record<string, unknown> } {
    try { const j = JSON.parse(readFileSync(progPath(acct), 'utf8')); return { done: Array.isArray(j.done) ? j.done : [], notes: j.notes ?? {} }; } catch { return { done: [], notes: {} }; }
}
function writeProg(acct: string, p: { done: string[]; notes?: Record<string, unknown> }): void {
    try { mkdirSync(LOGDIR, { recursive: true }); writeFileSync(progPath(acct), JSON.stringify({ ...p, ts: Date.now() }, null, 1)); } catch { /* best effort */ }
}

// ---- small helpers ----------------------------------------------------------------------------------------------------------
let T0 = 0;
function log(bot: SpeedBot, s: string): void { const p = bot.pos(); console.log(`[shilo +${String(bot.tickCount - T0).padStart(5)}] (${p.x},${p.z},L${p.level}) hp=${bot.stat('hitpoints').cur} ${s}`); }
function fail(bot: SpeedBot, s: string): never { throw new Error(`${s} @ ${JSON.stringify(bot.pos())} inv=${JSON.stringify(bot.inv().map(x => `${x.obj}x${x.count}`))}`); }
const has = (bot: SpeedBot, o: number, n = 1) => bot.count(o) >= n;
const lvl = (bot: SpeedBot, s: string) => bot.stat(s).level;
function inBox(t: Tile, x0: number, z0: number, x1: number, z1: number): boolean { return t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1; }
/** on the Karamja landmass (rc-solo onKaramja: the island box) */
export function onKaramja(t: Tile): boolean { return t.z < 4000 && t.x >= 2740 && t.x <= 2970 && t.z >= 2880 && t.z <= 3240; }

/** Protect from Melee on/off (Ah Za Rhoon and Rashiliyia's tomb are full of undead that attack on sight). */
function pray(bot: SpeedBot, on: boolean): void {
    if (on && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
    if (!on && bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
}
// ---- Karamja walk components (rsmod canTravel BFS, sim/shilo-geo.test.ts) ----------------------------------------------------
// The south of Karamja is THREE walk components on the real collision: MAIN (Tai Bwo Wannai, Musa Point, Shilo's south strip),
// EAST (the Ah Za Rhoon mound, the waterfall's north exit and Rashiliyia's hidden tomb doors — x2889-3004 z2950-3119; entered
// only over the 3 stepping stones at (2925,2948-2950)) and CAIRN ISLE (Bervirius' crawl-way; only over the climbing rocks at
// x2792-2794 z2978-2980). goK() inserts those crossings.
const COMP = new Map<string, Set<string>>();
function component(seed: Tile, cap = 40_000): Set<string> {
    const key = `${seed.x},${seed.z}`; const have = COMP.get(key); if (have) return have;
    const seen = new Set<string>([key]); const q: Tile[] = [seed];
    while (q.length && seen.size < cap) {
        const t = q.pop()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const k = `${t.x + dx},${t.z + dz}`; if (seen.has(k)) continue;
            if (!(rsmodPF as any).canTravel(0, t.x, t.z, dx, dz, 1, 0, 0)) continue;
            seen.add(k); q.push({ x: t.x + dx, z: t.z + dz });
        }
    }
    COMP.set(key, seen); return seen;
}
export type KRegion = 'main' | 'east' | 'cairn' | 'stones' | 'other';
export function regionOf(t: Tile): KRegion {
    if (t.z > 4000 || !onKaramja(t)) return 'other';
    if (t.x === 2925 && t.z >= 2948 && t.z <= 2950) return 'stones';   // ON a stepping stone (river tiles: no walk component)
    // a tile the static map blocks (a teleport landing next to scenery: the tomb exit drops you on (2916,3093)) takes the
    // component of its first walkable neighbour
    const east = component({ x: 2925, z: 2951 }), cairn = component({ x: 2765, z: 2976 });
    for (const [dx, dz] of [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const k = `${t.x + dx},${t.z + dz}`;
        if (east.has(k)) return 'east';
        if (cairn.has(k)) return 'cairn';
        if (dx === 0 && dz === 0 ? isTileWalkable(0, t.x, t.z) : false) break;
    }
    return 'main';
}
/** Eat a shark when hp is low (any time, no wait). */
function eatIfLow(bot: SpeedBot, frac = 0.55): void {
    const s = bot.stat('hitpoints');
    if (s.cur > 0 && s.cur <= Math.max(10, Math.floor(s.level * frac)) && has(bot, O.shark)) { bot.opHeld1(O.shark, bot.slot(O.shark)); bot.queueFlush(); }
}
/** Answer an open dialog page: a choice -> first matching answer (else the fallback index, else nothing); a page -> resume. */
function answerDialog(bot: SpeedBot, answers: RegExp[], o: { anyChoice?: boolean } = {}): 'choice' | 'page' | 'none' | 'stuck' {
    if (bot.chatModalId === -1) return 'none';
    const opts = bot.dialogOptions();
    if (opts.length) {
        for (const re of answers) if (bot.clickDialogByText(re) > 0) { bot.queueFlush(); return 'choice'; }
        if (o.anyChoice) { bot.ifButton(opts[0]!.com); bot.queueFlush(); return 'choice'; }
        return 'stuck';
    }
    bot.resumeDialogPage(); bot.queueFlush();
    return 'page';
}
/**
 * The workhorse: fire `op` (an OP-sender (route + op); it may return false = "not yet possible") every `every` ticks while no dialog
 * is open, drive any dialog with `answers`, eat when low, until `done()` or `max` ticks. Returns done().
 */
async function act(bot: SpeedBot, label: string, op: (() => boolean | void) | null, done: () => boolean, o: { answers?: RegExp[]; every?: number; max?: number; anyChoice?: boolean; quiet?: boolean } = {}): Promise<boolean> {
    const end = bot.tickCount + (o.max ?? 200), every = o.every ?? 6;
    let last = -1000, stuckLogged = '';
    while (bot.tickCount < end && !bot.disposed) {
        if (done()) return true;
        eatIfLow(bot);
        if (bot.chatModalId !== -1) {
            const r = answerDialog(bot, o.answers ?? [], { anyChoice: o.anyChoice });
            if (r === 'stuck') {
                const sig = bot.dialogOptions().map(x => x.text).join(' | ');
                if (sig !== stuckLogged) { log(bot, `${label}: unplanned choice [${sig}]`); stuckLogged = sig; }
                bot.closeModal(); bot.chatModalId = -1;
            }
        } else if (op && bot.tickCount - last >= every) {
            const r = op();
            last = r === false ? last : bot.tickCount;
        }
        await bot.tick(1);
    }
    const ok = done();
    if (!ok && !o.quiet) {
        const near = npcsOf(bot, [...new Set(Array.from({ length: bot.npcCount }, (_, i) => bot.npcs[bot.npcIndices[i]!]?.typeId ?? -1))] as any).filter(q => q.d <= 8).map(q => `${q.type}@${q.x},${q.z}`);
        log(bot, `${label}: NOT done after ${o.max ?? 200} ticks — chat=${bot.chatModalId} main=${bot.mainModalId} msgs=${JSON.stringify(msgsSince(bot, end - (o.max ?? 200)).slice(-4))} npcs=${near.join(' ')}`);
    }
    return ok;
}
/** Close any open modal (shop/bank/smithing/dialog). */
async function closeAll(bot: SpeedBot): Promise<void> { if (bot.mainModalId !== -1 || bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); dismiss(bot); } }
/** Long walk (core walkTo: navgrid/rsmod, doors) with a retry; throws when it never gets within `near`. */
/** Al Kharid sits behind the toll wall (railing x=3267/3268, z~3204-3238); the gate (toll-gate.ts TOLL_GATE 2882 @3268,3227)
 *  charges 10 gp: border guard dialog p_choice3 option "Yes, ok." teleports you across.  the quest walk out of
 *  Al Kharid (after the craft lane) wedged on the gate. */
const inAlKharid = (t: Tile) => t.x >= 3268 && t.z >= 3150 && t.z <= 3242;
async function crossToll(bot: SpeedBot, label: string): Promise<void> {
    const wasIn = inAlKharid(bot.tile());
    const stand = wasIn ? { x: 3268, z: 3227 } : { x: 3267, z: 3227 };
    if (bot.count(O.coins) < 10) fail(bot, `${label}: no 10 gp for the Al Kharid toll`);
    await bot.walkTo(stand.x, stand.z, { near: 0, maxTicks: 2500, log: false });
    if (!(await act(bot, `${label}: toll gate`, () => { bot.opLoc(3268, 3227, 2882, 1); bot.queueFlush(); }, () => inAlKharid(bot.tile()) !== wasIn, { answers: [/^Yes, ok\./], max: 60, every: 8 }))) fail(bot, `${label}: toll gate not crossed`);
    await closeAll(bot);
}
async function go(bot: SpeedBot, t: Tile, near = 2, label = 'walk', maxTicks = 2500): Promise<void> {
    if (bot.minusedlevel === 0 && t.z < 4000 && inAlKharid(bot.tile()) !== inAlKharid(t)) await crossToll(bot, label);
    for (let k = 0; k < 3; k++) {
        if (bot.minusedlevel === 0 && cheb(bot.tile(), t) <= near) return;
        await closeAll(bot);
        const r = await bot.walkTo(t.x, t.z, { near, maxTicks, log: false });
        if (bot.minusedlevel === 0 && cheb(bot.tile(), t) <= near) return;
        log(bot, `${label}: walk to (${t.x},${t.z}) ended ${JSON.stringify(r.at)} (${r.how}) — retry ${k + 1}`);
        await bot.tick(3);
    }
    fail(bot, `${label}: cannot reach (${t.x},${t.z})`);
}
/** go() on southern Karamja, crossing the stepping stones / Cairn climbing rocks as needed. */
export async function goK(bot: SpeedBot, t: Tile, near = 1, label = 'walk'): Promise<void> {
    for (let k = 0; k < 14; k++) {
        eatIfLow(bot, 0.6);
        const a = regionOf(bot.tile()), b = regionOf(t);
        log(bot, `${label}: goK ${a} -> ${b} (${t.x},${t.z})`);
        if (a === 'stones') { await crossStones(bot, b === 'east' ? 1 : -1); continue; }
        // on Cairn Isle walk with the server's own BFS (rsmod) only: walkTo's navgrid leg left the isle for the north shore
        // (2767,2999) in the local rehearsal and wedged there
        if (a === 'cairn' && b === 'cairn') {
            await closeAll(bot);
            if (await walkOp(bot, t, null, () => cheb(bot.tile(), t) <= near, { near, maxTicks: 300 })) return;
            // the log bridge (zone 0_43_46_24_32, agility roll every 20 ticks) drops a failed balance into the river and washes
            // you up on the NORTH shore (2765,2997) — MAIN again: re-plan from the regions (climb the rocks again)
            log(bot, `${label}: Cairn walk did not arrive (bridge fall?) — now ${regionOf(bot.tile())}, re-planning`);
            eatIfLow(bot, 0.7);
            continue;
        }
        if (a === b || a === 'other' || b === 'other') return go(bot, t, near, label);
        if (a === 'cairn') { await cairnEastward(bot); continue; }
        if (a === 'east') { await crossStonesSouth(bot); continue; }
        if (b === 'east') { await crossStonesNorth(bot); continue; }
        if (b === 'cairn') { await cairnWestward(bot); continue; }
    }
    return go(bot, t, near, label);
}
function sceneLoc(l: { id: number; x: number; z: number }, level = 0) { return locAt(l.id, l.x, l.z, level); }
/** Walkable tiles on the ring around a loc's footprint (both orientations: loc-scene and rsmod disagree on pre-rotation for
 *  some non-square locs, e.g. Ah Za Rhoon's rubble 2x1 @angle 3 — rsmod said "reached" from a tile the server refuses). */
function ringAround(bot: SpeedBot, l: { x: number; z: number }, size = 2): Tile[] {
    const me = bot.tile(), out: Tile[] = [];
    for (let x = l.x - 1; x <= l.x + size; x++) for (let z = l.z - 1; z <= l.z + size; z++) {
        // the 2x2 box itself is kept: for a 2x1 loc half of it is a valid (walkable) stand
        try { if (isTileWalkable(bot.minusedlevel, x, z)) out.push({ x, z }); } catch { /* off map */ }
    }
    return out.sort((a, b) => cheb(a, me) - cheb(b, me));
}
/** "I can't reach that!" arrived at/after `tick` */
function cantReach(bot: SpeedBot, tick: number): boolean { return msgsSince(bot, tick).some(m => /can't reach that/i.test(m)); }
/** A sender that routes to the loc's interaction tile and sends `send(slocId)`; after an "I can't reach that!" it walks the
 *  footprint ring instead, one stand tile per attempt. */
function locSender(bot: SpeedBot, l: { id: number; x: number; z: number }, send: (s: { x: number; z: number; id: number }) => boolean, stand?: Tile): () => boolean {
    let k = -1, lastSend = -100;
    return () => {
        const s = sceneLoc(l, bot.minusedlevel);
        if (k >= 0 || (lastSend > 0 && cantReach(bot, lastSend))) k++;
        const ring = k >= 0 ? ringAround(bot, s, Math.max(s.width, s.length)) : [];
        const st = k >= 0 && ring.length ? ring[k % ring.length] : stand;
        if (st) { const me = bot.tile(); if (me.x !== st.x || me.z !== st.z) routeToLoc(bot, s, st); } else routeToLoc(bot, s);
        if (!send(s)) return false;
        bot.queueFlush(); lastSend = bot.tickCount;
        return true;
    };
}
/** route (MOVE_OPCLICK) to an interaction tile of the loc + OPLOC<op> in the same tick */
function opLocNow(bot: SpeedBot, l: { id: number; x: number; z: number }, op: number, stand?: Tile): () => boolean {
    return locSender(bot, l, s => { bot.opLoc(s.x, s.z, s.id, op); return true; }, stand);
}
function useOnLocNow(bot: SpeedBot, obj: number, l: { id: number; x: number; z: number }, stand?: Tile): () => boolean {
    return locSender(bot, l, s => { const slot = bot.slot(obj); if (slot < 0) return false; bot.useItemOnLoc(s.x, s.z, s.id, obj, slot); return true; }, stand);
}
/** OPHELDU with `a` as the TARGET (packet obj) and `b` as the used item (useObj): the engine tries [opheldu,a] first and only
 *  swaps when a has no script (OpHeldUHandler) — chisel/tinderbox HAVE generic scripts, so the quest item must be `a`. */
function useOnItemNow(bot: SpeedBot, a: number, b: number): () => boolean {
    return () => { const sa = bot.slot(a), sb = bot.slot(b); if (sa < 0 || sb < 0) return false; bot.useItemOnItem(a, sa, b, sb); bot.queueFlush(); return true; };
}
function opNpcNow(bot: SpeedBot, types: number | readonly number[], op: number): () => boolean {
    return () => { const n = npc(bot, types as any); if (!n) return false; opNpcGo(bot, n, op); return true; };
}
/** A loc whose TYPE changes in place (fissure stages, tomb-door recesses, hidden doors): route by the static geometry of
 *  `geomId`, then send the op (or the item use) to EVERY candidate id in one burst — an OPLOC/OPLOCU naming a type that is
 *  not there is dropped by OpLocHandler (World.getLoc misses -> UnsetMapFlag), so exactly one lands. */
function anyLocNow(bot: SpeedBot, ids: number[], x: number, z: number, what: { op: number } | { use: number }, geomId = ids[0]!): () => boolean {
    return () => {
        let s; try { s = locAt(geomId, x, z, bot.minusedlevel); } catch { s = { id: geomId, x, z, width: 1, length: 1, angle: 0, shape: 10 } as any; }
        routeToLoc(bot, s);
        for (const id of ids) {
            if ('op' in what) bot.opLoc(x, z, id, what.op);
            else { const slot = bot.slot(what.use); if (slot < 0) return false; bot.useItemOnLoc(x, z, id, what.use, slot); }
        }
        bot.queueFlush(); return true;
    };
}
function useOnNpcNow(bot: SpeedBot, obj: number, type: number): () => boolean {
    return () => {
        const n = npc(bot, type); const slot = bot.slot(obj); if (!n || slot < 0) return false;
        opNpcGo(bot, n, 1); // routes next to the npc; the OPNPC1 is replaced by the OPNPCU below in the same flush order
        bot.useItemOnNpc(n.idx, obj, slot); bot.queueFlush(); return true;
    };
}

// ---- shop / bank -------------------------------------------------------------------------------------------------------------
/** Open the shop of npc `type` (OPNPC3 Trade) and buy each item up to its target count. */
async function shop(bot: SpeedBot, label: string, type: number, at: Tile, want: Array<{ obj: number; n: number }>): Promise<void> {
    const need = () => want.filter(w => bot.count(w.obj) < w.n);
    if (!need().length) return;
    await go(bot, at, 4, label);
    if (!(await act(bot, `${label}: open`, opNpcNow(bot, type, 3), () => bot.shopIsOpen(), { answers: [/^Yes/, /What are you selling/, /^Sure/], max: 60 }))) fail(bot, `${label}: shop did not open`);
    for (let k = 0; k < 80 && need().length; k++) {
        const w = need()[0]!;
        if (bot.shopStockOf(w.obj) <= 0) { log(bot, `${label}: ${w.obj} sold out`); want = want.filter(x => x !== w); continue; }
        if (bot.free() <= 0 && bot.count(w.obj) === 0) { log(bot, `${label}: pack full`); break; }
        bot.shopBuy(w.obj, w.n - bot.count(w.obj)); bot.queueFlush();
        await bot.tick(1);
    }
    await closeAll(bot);
    const miss = need();
    if (miss.length) fail(bot, `${label}: still missing ${JSON.stringify(miss)} (coins ${bot.count(O.coins)})`);
    log(bot, `${label}: bought ${JSON.stringify(want.map(w => `${w.obj}x${bot.count(w.obj)}`))}`);
}
/** At the nearest bank: deposit everything except `keep`, withdraw `take` (obj -> wanted count in the pack). */
/** booth banks the walk may use (bank-sites stands, geo-checked) — the nearest is walked to first */
const BOOTH_BANKS = [BANKS.alkharid, BANKS.draynor1, BANKS.varrockE1, BANKS.varrockW1, BANKS.faladorW, BANKS.faladorE1, BANKS.edgeville, BANKS.catherby, BANKS.seers1];
async function bank(bot: SpeedBot, label: string, keep: number[], take: Array<{ obj: number; n: number }>): Promise<void> {
    if (bot.minusedlevel === 0 && bot.tile().z < 6400) {
        const me = bot.tile();
        // Al Kharid only from inside the toll wall (x >= 3268): go() does not pay the toll gate
        const b = [...BOOTH_BANKS].filter(k => k !== BANKS.alkharid || me.x >= 3268).sort((a, c) => cheb(a.stand, me) - cheb(c.stand, me))[0]!;
        if (cheb(b.stand, me) > 3) await go(bot, b.stand, 0, label);
    } else fail(bot, `${label}: not on the surface (L${bot.minusedlevel})`);
    const r = await bot.openBank({ kind: 'any', radius: 30, maxTicks: 120 });
    if (!r.ok) fail(bot, `${label}: bank did not open (${JSON.stringify(r)})`);
    await bot.depositAll(keep as any);
    for (const t of take) {
        const missing = t.n - bot.count(t.obj);
        if (missing > 0) await bot.withdraw(t.obj, missing);
    }
    await bot.tick(1);
    await closeAll(bot);
    log(bot, `${label}: pack ${JSON.stringify(bot.inv().map(x => `${x.obj}x${x.count}`))}`);
}

// ---- combat ------------------------------------------------------------------------------------------------------------------
/** Kill npcs of `types` near `anchor` until the pack holds `obj` x `n` (loot picked up). */
async function killFor(bot: SpeedBot, label: string, types: readonly number[], anchors: Tile[], obj: number, n: number, o: { extra?: Array<{ obj: number; n: number }>; maxTicks?: number } = {}): Promise<void> {
    const wantMore = () => bot.count(obj) < n || (o.extra ?? []).some(e => bot.count(e.obj) < e.n);
    if (!wantMore()) return;
    const lootIds = new Set([obj, ...(o.extra ?? []).map(e => e.obj)]);
    let ai = 0;
    await go(bot, anchors[0]!, 3, label);
    const end = bot.tickCount + (o.maxTicks ?? 1500);
    let target: NpcRef | null = null, attackTick = -100, idle = 0;
    while (wantMore() && bot.tickCount < end) {
        eatIfLow(bot);
        if (bot.chatModalId !== -1) { answerDialog(bot, [], { anyChoice: true }); await bot.tick(1); continue; }
        if (bot.free() === 0) { // make room: drop anything that is not loot/food/tools we came with
            const junk = bot.inv().find(s => s.obj === O.rawBeef && !lootIds.has(s.obj) || s.obj === 1739 && !lootIds.has(s.obj));
            if (junk) { bot.dropItem(junk.obj, junk.slot); bot.queueFlush(); }
        }
        const g = (bot as any).findGroundItem(new Set([...lootIds].filter(id => id === obj ? bot.count(obj) < n : (o.extra ?? []).some(e => e.obj === id && bot.count(id) < e.n))), 8);
        if (g && bot.free() > 0) {
            const me = bot.tile();
            if (me.x !== g.x || me.z !== g.z) { routeToLoc(bot, { id: -1, x: g.x, z: g.z, width: 1, length: 1, angle: 0, shape: 10 } as any, { x: g.x, z: g.z }); }
            bot.opObj(g.x, g.z, g.obj, 3); bot.queueFlush();
            await bot.tick(2); continue;
        }
        const alive = target && npcsOf(bot, types as any).some(q => q.idx === target!.idx);
        if (!alive || bot.tickCount - attackTick > 40) {
            const cands = npcsOf(bot, types as any).filter(q => q.d <= 14);
            if (cands.length) { target = cands[0]!; opNpcGo(bot, target, 2); attackTick = bot.tickCount; idle = 0; }
            else if (++idle > 25) { ai = (ai + 1) % anchors.length; await go(bot, anchors[ai]!, 3, label); idle = 0; }
        }
        await bot.tick(1);
    }
    if (wantMore()) fail(bot, `${label}: still short of ${obj} (${bot.count(obj)}/${n})`);
    log(bot, `${label}: got ${obj}x${bot.count(obj)}`);
}

// =====================================================================================================================
// MAINLAND
// =====================================================================================================================
/** Out of the Tree Gnome Stronghold (the agility stage leaves the account on the course): the walled stronghold has no walk
 *  route out; gnome_gate.rs2 [oploc1,gnome_areagate] (loc 190 @2459,3383) walks/teleports you from the north entrance
 *  (2461,3385) to the south one (2461,3382).  the craft lane sat on "ROUTE UNAVAILABLE" at (2484,3438). */
export function inGnomeStronghold(t: Tile): boolean { return t.x >= 2380 && t.x <= 2500 && t.z >= 3384 && t.z <= 3520; }
async function mGnome(bot: SpeedBot): Promise<void> {
    if (bot.minusedlevel !== 0 || !inGnomeStronghold(bot.tile())) return;
    if (cheb(bot.tile(), { x: 2461, z: 3385 }) > 3) await go(bot, { x: 2461, z: 3386 }, 1, 'm-gnome');
    if (!(await act(bot, 'gnome gate', opLocNow(bot, { id: 190, x: 2459, z: 3383 }, 1), () => bot.tile().z <= 3382, { max: 60, every: 8, anyChoice: true }))) fail(bot, 'm-gnome: still inside the stronghold');
    log(bot, 'm-gnome: out of the stronghold');
}
const FOOD_N = 14;
async function mBank(bot: SpeedBot): Promise<void> {
    // coins (shops, boat, tanning) + sharks; deposit clutter, keep tools/quest items
    const keep = [O.coins, O.shark, O.bronzePickaxe, 1267, 1269, 1271, 1273, 1275, O.adamantLongsword, O.chisel, O.spade, O.rope, O.tinderbox, O.hammer,
        O.bones, O.rawChicken, O.rawBeef, O.rawRat, O.rawBear, O.enchBeef, O.enchBear, O.enchChicken, O.enchRat];
    await bank(bot, 'm-bank', keep, [{ obj: O.coins, n: 25_000 }, { obj: O.shark, n: FOOD_N }]);
    if (bot.count(O.coins) < 3_000) fail(bot, 'm-bank: fewer than 3,000 coins');
}
async function mTools(bot: SpeedBot): Promise<void> {
    if ([O.bronzePickaxe, 1267, 1269, 1271, 1273, 1275].some(p => has(bot, p) || (bot as any).isWorn?.(p))) return;
    await shop(bot, 'm-tools Bob', N.bob, T.bob, [{ obj: O.bronzePickaxe, n: 1 }]);
}
async function mMeats(bot: SpeedBot): Promise<void> {
    await killFor(bot, 'chicken', [N.chicken], [T.chickens], O.rawChicken, 1, { extra: [{ obj: O.bones, n: 4 }] });
    await killFor(bot, 'cow', N.cow, [T.cows], O.rawBeef, 1);
    await killFor(bot, 'giant rat', N.giantrat, [T.rats, T.ratsAlt], O.rawRat, 1);
}
async function mMine(bot: SpeedBot): Promise<void> {
    if (lvl(bot, 'mining') >= 40) return;
    const { miningLeg } = await import('./g1-mining.js');
    await go(bot, T.mineVarrock, 3, 'm-mine');
    const r = await miningLeg(bot, { spot: 'varrock', lowSpot: 'varrock', to: 40, clock: false, maxTicks: 9000 });
    log(bot, `m-mine: ${JSON.stringify({ ok: r.ok, level: r.level })}`);
    await bot.dropAll([O.copperOre, O.tinOre, O.ironOre]);
    if (lvl(bot, 'mining') < 40) fail(bot, 'm-mine: mining < 40');
}
async function mWeapon(bot: SpeedBot): Promise<void> {
    if ((bot as any).isWorn?.(O.adamantLongsword)) return;
    if (!has(bot, O.adamantLongsword)) await shop(bot, 'm-weapon', N.swordshop, T.swordshop, [{ obj: O.adamantLongsword, n: 1 }]);
    const r = await (bot as any).equipItem(O.adamantLongsword);
    log(bot, `m-weapon: wield ${JSON.stringify(r)}`);
}
async function mBear(bot: SpeedBot): Promise<void> {
    await killFor(bot, 'bear', [N.darkbear, 105], [T.bears, { x: 2967, z: 3480 }, { x: 2979, z: 3501 }], O.rawBear, 1);
}
/** Druidic Ritual (q-druidic.ts flow, walking instead of the Falador teleport). */
async function mDruidic(bot: SpeedBot): Promise<void> {
    if (lvl(bot, 'herblore') >= 3) return;
    const MEATS = [O.rawBeef, O.rawRat, O.rawBear, O.rawChicken], ENCH = [O.enchBeef, O.enchRat, O.enchBear, O.enchChicken];
    const herb0 = bot.stat('herblore').xp;
    const stairs0 = locAt(1738, 2898, 3428, 0), stairs1 = locAt(1740, 2898, 3428, 1), ladder = locAt(1759, 2884, 3397, 0);
    const door = locAt(2144, 2889, 9830, 0), cauldron = locAt(2142, 2893, 9831, 0), upLadder = locAt(1755, 2884, 9797, 0);
    const haveAllEnch = () => ENCH.every(e => has(bot, e));
    if (!haveAllEnch() && !MEATS.every((m, i) => has(bot, m) || has(bot, ENCH[i]!))) fail(bot, 'm-druidic: meats missing');
    // 1. Kaqemeex (skip when the meats are already enchanted: the quest is past this step)
    if (!haveAllEnch()) {
        await go(bot, T.kaqemeex, 3, 'm-druidic');
        await act(bot, 'kaqemeex1', opNpcNow(bot, N.kaqemeex, 1), () => false, { answers: [/^I'm in search of a quest\.$/, /^Ok, I will try and help\.$/], max: 40, quiet: true });
        // 2. Sanfew L1: "I've been sent to help purify..." then "Ok, I'll do that then."
        if (!(await walkOp(bot, { x: 2900, z: 3428 }, () => bot.opLoc(stairs0.x, stairs0.z, stairs0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 400 }))) fail(bot, 'm-druidic: stairs up');
        dismiss(bot);
        await act(bot, 'sanfew1', opNpcNow(bot, N.sanfew, 1), () => false, { answers: [/^I've been sent to help purify/, /^Ok, I'll do that then\./], max: 30, quiet: true });
        if (!(await walkOp(bot, { x: 2898, z: 3427 }, () => bot.opLoc(stairs1.x, stairs1.z, stairs1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 40 }))) fail(bot, 'm-druidic: stairs down');
        // 3. dungeon, cauldron door (ops 1-2 wake two suits of armour), dip
        if (!(await walkOp(bot, { x: 2885, z: 3397 }, () => bot.opLoc(ladder.x, ladder.z, ladder.id, 1), () => bot.tile().z > 6400, { maxTicks: 200 }))) fail(bot, 'm-druidic: ladder down');
        if (bot.stat('prayer').cur >= 43) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
        let inside = false;
        for (let k = 0; k < 10 && !inside; k++) {
            inside = await walkOp(bot, { x: 2888, z: 9830 }, () => bot.opLoc(door.x, door.z, door.id, 1), () => bot.tile().x >= 2889, { maxTicks: k === 0 ? 60 : 6 });
            eatIfLow(bot);
        }
        if (!inside) fail(bot, 'm-druidic: cauldron door');
        for (let k = 0; k < 20 && !haveAllEnch(); k++) {
            const next = MEATS.find(m => has(bot, m)); if (!next) break;
            await walkOp(bot, { x: 2892, z: 9831 }, () => bot.useItemOnLoc(cauldron.x, cauldron.z, cauldron.id, next, bot.slot(next)), () => !has(bot, next), { maxTicks: 12 });
        }
        if (!haveAllEnch()) fail(bot, 'm-druidic: meats not enchanted');
        for (let k = 0; k < 8 && bot.tile().x >= 2889; k++) await walkOp(bot, { x: 2889, z: 9830 }, () => bot.opLoc(door.x, door.z, door.id, 1), () => bot.tile().x < 2889, { maxTicks: 5 });
        if (!(await walkOp(bot, { x: 2884, z: 9798 }, () => bot.opLoc(upLadder.x, upLadder.z, upLadder.id, 1), () => bot.tile().z < 6400, { maxTicks: 120 }))) fail(bot, 'm-druidic: ladder up');
        if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
    }
    // 4. Sanfew hand-in, 5. Kaqemeex completes
    if (!(await walkOp(bot, { x: 2900, z: 3428 }, () => bot.opLoc(stairs0.x, stairs0.z, stairs0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 300 }))) fail(bot, 'm-druidic: stairs up 2');
    dismiss(bot);
    if (!(await act(bot, 'sanfew2', opNpcNow(bot, N.sanfew, 1), () => ENCH.every(e => !has(bot, e)), { max: 40 }))) fail(bot, 'm-druidic: Sanfew hand-in');
    if (!(await walkOp(bot, { x: 2898, z: 3427 }, () => bot.opLoc(stairs1.x, stairs1.z, stairs1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 40 }))) fail(bot, 'm-druidic: stairs down 2');
    dismiss(bot);
    await go(bot, T.kaqemeex, 3, 'm-druidic');
    if (!(await act(bot, 'kaqemeex2', opNpcNow(bot, N.kaqemeex, 1), () => bot.stat('herblore').xp > herb0, { max: 40, anyChoice: true }))) fail(bot, 'm-druidic: no herblore xp');
    await closeAll(bot);
    log(bot, `m-druidic: DONE herblore=${lvl(bot, 'herblore')}`);
}
async function mBoat(bot: SpeedBot): Promise<void> {
    if (onKaramja(bot.tile())) return;
    if (bot.count(O.coins) < 30) fail(bot, 'm-boat: no fare');
    await go(bot, T.portSarimDock, 3, 'm-boat');
    if (!(await act(bot, 'sailor', opNpcNow(bot, N.sailors, 1), () => bot.minusedlevel === 1 && cheb(bot.tile(), T.karamjaShip) <= 3, { answers: [/^Yes please/], max: 80, anyChoice: false }))) fail(bot, 'm-boat: did not sail');
    await closeAll(bot);
    if (!(await act(bot, 'plank', () => { bot.opLoc(T.karamjaPlank.x, T.karamjaPlank.z, T.karamjaPlank.id, 1); bot.queueFlush(); }, () => bot.minusedlevel === 0, { max: 30 }))) fail(bot, 'm-boat: plank');
    log(bot, 'm-boat: on Karamja');
}

// =====================================================================================================================
// KARAMJA
// =====================================================================================================================
async function kShop(bot: SpeedBot): Promise<void> {
    const want = [
        { obj: O.spade, n: 1 }, { obj: O.chisel, n: 1 }, { obj: O.rope, n: 1 }, { obj: O.tinderbox, n: 1 }, { obj: O.hammer, n: 1 },
        ...(has(bot, O.wire) ? [] : [{ obj: O.bronzeBar, n: lvl(bot, 'smithing') >= 4 ? 1 : 2 }]),
        ...(has(bot, O.litCandle) || has(bot, O.unlitCandle) ? [] : [{ obj: O.unlitCandle, n: 1 }]),
    ];
    // room first (live: craft-lane needle/thread + the old staff of air filled the pack at Jiminua's): drop leftovers that are
    // no quest item, then sharks down to 8 if the buys still do not fit
    const need = want.filter(w => bot.count(w.obj) < w.n).reduce((n, w) => n + (w.n - bot.count(w.obj)), 0);
    await bot.dropAll([1733, 1734, 1381, 1171, 1007, O.rawChicken, O.rawBeef, O.rawRat, O.rawBear, 1059]);
    for (let k = 0; k < 10 && bot.free() < need && bot.count(O.shark) > 8; k++) { bot.dropItem(O.shark, bot.slot(O.shark)); await bot.tick(1); }
    await shop(bot, 'k-shop Jiminua', N.jiminua, T.jiminua, want);
}
const SMITH_COL1 = 1119, SMITH_COL5 = 1123;
async function kSmith(bot: SpeedBot): Promise<void> {
    if (has(bot, O.wire) || has(bot, O.deadBeads)) return;
    await go(bot, { x: 2790, z: 3100 }, 2, 'k-smith');
    const smithOnce = async (product: number, slot: number, col: number, done: () => boolean, label: string) => {
        for (let k = 0; k < 6 && !done(); k++) {
            await closeAll(bot);
            await act(bot, `${label}: anvil`, useOnLocNow(bot, O.bronzeBar, L.anvil), () => bot.mainModalId !== -1, { max: 25, quiet: true });
            if (bot.mainModalId === -1) continue;
            bot.invButton(1, product, slot, col); bot.queueFlush();
            await bot.until(done, 12);
        }
        if (!done()) fail(bot, `${label}: failed`);
    };
    if (lvl(bot, 'smithing') < 4) {
        const xp0 = bot.stat('smithing').xp;
        await smithOnce(O.bronzeDagger, 0, SMITH_COL1, () => bot.stat('smithing').xp > xp0, 'k-smith dagger');
        await closeAll(bot);
        await bot.dropAll(O.bronzeDagger);
    }
    if (lvl(bot, 'smithing') < 4) fail(bot, 'k-smith: smithing < 4 after the dagger');
    await smithOnce(O.wire, 3, SMITH_COL5, () => has(bot, O.wire), 'k-smith wire');
    await closeAll(bot);
    log(bot, 'k-smith: bronze wire made');
}

// ---- Jungle Potion ------------------------------------------------------------------------------------------------------------
const HERBS = [
    { name: 'snake weed', unid: O.uSnake, herb: O.snake, locs: L.snakeVine, cave: false },
    { name: 'ardrigal', unid: O.uArdrigal, herb: O.ardrigal, locs: L.ardrigal, cave: false },
    { name: 'sito foil', unid: O.uSito, herb: O.sito, locs: L.sito, cave: false },
    { name: 'volencia moss', unid: O.uVolencia, herb: O.volencia, locs: L.volencia, cave: false },
    { name: 'rogues purse', unid: O.uRogues, herb: O.rogues, locs: L.fungus, cave: true },
] as const;
const TRUF_START = [/^It sounds like just the challenge for me/, /^Me\? How can I help\?/, /^A proposition eh/, /^Yes, of course I do/, /^What does Bwana mean/];
async function trufitusTalk(bot: SpeedBot, label: string, done: () => boolean, answers: RegExp[], max = 120): Promise<boolean> {
    await goK(bot, T.trufitus, 4, label);
    return act(bot, label, opNpcNow(bot, N.trufitus, 1), done, { answers, max, every: 10 });
}
async function kJungle(bot: SpeedBot, acct: string): Promise<void> {
    const prog = readProg(acct);
    const given: string[] = (prog.notes?.jpGiven as string[]) ?? [];
    const save = () => { const p = readProg(acct); p.notes = { ...(p.notes ?? {}), jpGiven: given }; writeProg(acct, p); };
    if (lvl(bot, 'herblore') < 3) fail(bot, 'k-jungle: herblore < 3 (Druidic Ritual first)');
    // a herb needs a free slot ("You find a herb, but you have no place to store it", live: a 28/28 pack): drop the smithing
    // leftovers, then sharks down to 6, until 4 slots are free
    await bot.dropAll([O.bronzeDagger, O.hammer, 1733, 1734, 1381]);
    for (let k = 0; k < 12 && bot.free() < 4 && bot.count(O.shark) > 6; k++) { bot.dropItem(O.shark, bot.slot(O.shark)); await bot.tick(1); }
    if (!prog.notes?.jpStarted) {
        // done = Trufitus names the first herb ("...gather is called" / "Snake Weed") — or, already started, asks for it
        const snap = new Map(bot.ifText);
        const saw = (re: RegExp) => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v && re.test(v)) return true; return false; };
        await go(bot, T.trufitus, 4, 'k-jungle start');
        const ok = await act(bot, 'k-jungle start', opNpcNow(bot, N.trufitus, 1), () => saw(/Snake Weed|do you have the Snake Weed/i), {
            answers: [...TRUF_START, /^Not yet, sorry, what's the clue again\?/], max: 120, every: 12,
        });
        await act(bot, 'k-jungle start (finish pages)', null, () => bot.chatModalId === -1, { answers: [/^Not yet, sorry/], max: 30, quiet: true });
        if (!ok) fail(bot, 'k-jungle: Trufitus never named the Snake Weed (Druidic Ritual done?)');
        const p = readProg(acct); p.notes = { ...(p.notes ?? {}), jpStarted: true }; writeProg(acct, p);
    }
    for (const h of HERBS) {
        if (given.includes(h.name)) continue;
        // pick (the loc only yields while the quest stage asks for THIS herb)
        if (!has(bot, h.unid) && !has(bot, h.herb)) {
            if (h.cave) await enterRoguesCave(bot);
            let got = false;
            for (const l of h.locs) {
                if (got) break;
                const sl = sceneLoc(l);
                if (!(bot as any).locAlive?.(sl) && (bot as any).locAlive) { /* depleted variant shown: try the next */ }
                got = await act(bot, `pick ${h.name}`, opLocNow(bot, l, 2), () => has(bot, h.unid) || has(bot, h.herb), { max: 60, every: 8, anyChoice: true, quiet: true });
            }
            if (h.cave) await leaveRoguesCave(bot);
            if (!got) fail(bot, `k-jungle: no ${h.name} (quest not at that stage? check Trufitus)`);
        }
        // identify (Herblore 3)
        if (has(bot, h.unid)) {
            await act(bot, `identify ${h.name}`, () => { const s = bot.slot(h.unid); if (s < 0) return false; bot.opHeld1(h.unid, s); bot.queueFlush(); }, () => has(bot, h.herb), { max: 12, every: 3 });
            if (!has(bot, h.herb)) fail(bot, `k-jungle: cannot identify ${h.name}`);
        }
        // hand in: "Of course!"
        if (!(await trufitusTalk(bot, `give ${h.name}`, () => !has(bot, h.herb), [/^Of course!$/]))) fail(bot, `k-jungle: Trufitus kept the ${h.name}?`);
        given.push(h.name); save();
        log(bot, `k-jungle: gave ${h.name}`);
        await closeAll(bot);
    }
    // the last hand-in sets found_all_herbs and QUEUES junglepotion_quest_complete (herblore 7750 tenths) — live, the queue
    // never ran (we closed the pages and walked off): Mosol answered "talk to Trufitus". Talk again until the reward lands.
    await finishJunglePotion(bot);
    log(bot, `k-jungle: DONE herblore=${lvl(bot, 'herblore')}`);
}
/** Talk to Trufitus until the Jungle Potion reward (herblore xp) lands: at found_all_herbs his op1 runs trufitus_finish_quest
 *  (mesbox + queue(junglepotion_quest_complete)); after completion he gives the "greatest respects" pages (no xp). */
async function finishJunglePotion(bot: SpeedBot): Promise<boolean> {
    const xp0 = bot.stat('herblore').xp;
    const snap = new Map(bot.ifText);
    const respects = () => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v && /greatest respects|communed with my gods/i.test(v)) return true; return false; };
    await goK(bot, T.trufitus, 4, 'jp finish');
    for (let k = 0; k < 4 && bot.stat('herblore').xp === xp0 && !respects(); k++) {
        await act(bot, 'jp finish', opNpcNow(bot, N.trufitus, 1), () => bot.stat('herblore').xp > xp0 || respects(), { max: 40, every: 15, anyChoice: true, quiet: true });
        // pages done: let the queued completion run with no modal open
        await closeAll(bot); await bot.tick(4);
    }
    await closeAll(bot);
    const ok = bot.stat('herblore').xp > xp0 || respects();
    log(bot, `jp finish: ${ok ? 'Jungle Potion complete' : 'NO reward seen'} herblore xp ${xp0} -> ${bot.stat('herblore').xp}`);
    return ok;
}
async function enterRoguesCave(bot: SpeedBot): Promise<void> {
    if (bot.tile().z > 6400) return;
    await go(bot, { x: 2824, z: 3117 }, 2, 'rogues cave');
    if (!(await act(bot, 'pothole', opLocNow(bot, L.pothole, 2), () => bot.tile().z > 6400, { answers: [/^Yes, I'll enter the cave\./], max: 40 }))) fail(bot, 'k-jungle: cave entrance');
    await closeAll(bot);
}
async function leaveRoguesCave(bot: SpeedBot): Promise<void> {
    if (bot.tile().z < 6400) return;
    await walkOp(bot, { x: 2831, z: 9521 }, null, () => cheb(bot.tile(), { x: 2831, z: 9521 }) <= 1, { maxTicks: 300 });
    if (!(await act(bot, 'cave out', opLocNow(bot, L.caveOut, 1), () => bot.tile().z < 6400, { max: 40, anyChoice: true }))) fail(bot, 'k-jungle: cave exit');
    await closeAll(bot);
}

// ---- Shilo Village ------------------------------------------------------------------------------------------------------------
const MOSOL_BELT = [/^I'll go to see the Shaman\./, /^Yes, I'm sure and I'll take the Wampum belt/, /^What can we do\?/, /^Rashiliyia\? Who is she\?/, /^Why do I need to run\?/];
async function kBelt(bot: SpeedBot): Promise<void> {
    if (has(bot, O.belt)) return;
    // Mosol Rei wanders outside the gates; look for him from a few tiles (live: the first walk ended at (2880,2952) and the
    // OPNPC never fired — he was not in the npc list there)
    let jpChecked = false;
    for (const spot of [T.mosol, { x: 2886, z: 2948 }, { x: 2882, z: 2956 }, { x: 2890, z: 2952 }, T.mosol]) {
        if (has(bot, O.belt)) break;
        // "Sorry Bwana, I cannot help you at this time. Go and talk to Trufitus" = Jungle Potion not complete yet
        if (!jpChecked && [...bot.ifText.values()].some(v => /talk to Trufitus at Tai Bwo Wannai/i.test(v))) { jpChecked = true; await finishJunglePotion(bot); }
        await goK(bot, spot, 1, 'k-belt');
        if (!npc(bot, N.mosol)) { const seen = [...new Set(Array.from({ length: bot.npcCount }, (_, i) => bot.npcs[bot.npcIndices[i]!]?.typeId ?? -1))]; log(bot, `k-belt: no Mosol in view at (${spot.x},${spot.z}); npcs ${JSON.stringify(seen)}`); continue; }
        // live: Mosol stood next to us among a dozen zombies (504/505) and ignored every Talk-to — clear the undead near him first
        for (let k = 0; k < 8; k++) {
            const m = npc(bot, N.mosol); if (!m) break;
            const z = npcsOf(bot, [504, 505, 502, 503] as any).find(q => Math.max(Math.abs(q.x - m.x), Math.abs(q.z - m.z)) <= 6);
            if (!z) break;
            pray(bot, true);
            opNpcGo(bot, z, 2);
            await bot.until(() => !npcsOf(bot, [z.type] as any).some(q => q.idx === z.idx), 40);
            await bot.tick(2);
        }
        pray(bot, false);
        await act(bot, 'mosol', opNpcNow(bot, N.mosol, 1), () => has(bot, O.belt), { answers: MOSOL_BELT, max: 120, every: 12 });
    }
    if (!has(bot, O.belt)) fail(bot, 'k-belt: no wampum belt');
    await closeAll(bot);
}
const TRUF_BELT = [/^Yes, I will seriously look for Ah Za Rhoon/, /^I am going to search for Ah Za Rhoon!/, /^Why was it called Ah Za Rhoon\?/, /^Mosol Rei said something about a legend\?/];
async function kStart(bot: SpeedBot): Promise<void> {
    if (!has(bot, O.belt)) return;   // the belt is taken when the quest starts (trufitus.rs2:536-539)
    await goK(bot, T.trufitus, 4, 'k-start');
    if (!(await act(bot, 'belt -> Trufitus', useOnNpcNow(bot, O.belt, N.trufitus), () => !has(bot, O.belt), { answers: TRUF_BELT, max: 150, every: 12 }))) fail(bot, 'k-start: belt still held');
    await closeAll(bot);
    log(bot, 'k-start: Shilo Village started');
}
/** Cross the river over the three stepping stones (2925, 2948..2950): each OPLOC1 on the ADJACENT stone hops one tile onto it
 *  (shortcuts.rs2 _karamja_stepping_stone; agility roll 50..253 — a slip washes you onto a bank with 10-20% damage, then retry).
 *  dir +1 = north (MAIN south strip -> EAST), -1 = south. */
async function crossStones(bot: SpeedBot, dir: 1 | -1): Promise<void> {
    const want: KRegion = dir === 1 ? 'east' : 'main';
    const startTile = dir === 1 ? T.stonesSouth : T.stonesNorth;
    for (let k = 0; k < 24 && regionOf(bot.tile()) !== want; k++) {
        eatIfLow(bot);
        const me = bot.tile();
        const onLine = me.x === 2925 && me.z >= 2947 && me.z <= 2951;
        // NOT go(): the planner sometimes routes over the stones by itself (live: a walk to the south stand ended on the north
        // bank) — re-read the region after every walk instead of throwing on a "missed" stand
        if (!onLine) { await closeAll(bot); await bot.walkTo(startTile.x, startTile.z, { near: 0, maxTicks: 1500, log: false }); continue; }
        const nextZ = me.z + dir;
        const st = L.stones.find(q => q.z === nextZ);
        if (!st) { await walkOp(bot, { x: 2925, z: nextZ }, null, () => bot.tile().z === nextZ, { maxTicks: 8 }); continue; }   // last hop onto the bank
        bot.opLoc(st.x, st.z, st.id, 1); bot.queueFlush();
        await bot.until(() => bot.tile().z !== me.z || bot.tile().x !== me.x, 8);
        await bot.tick(1);
    }
    if (regionOf(bot.tile()) !== want) fail(bot, `stepping stones: not across (${dir === 1 ? 'north' : 'south'})`);
}
async function crossStonesNorth(bot: SpeedBot): Promise<void> { return crossStones(bot, 1); }
async function crossStonesSouth(bot: SpeedBot): Promise<void> { return crossStones(bot, -1); }
async function kMound(bot: SpeedBot): Promise<void> {
    if (bot.tile().z > 9200 && bot.tile().z < 9420 && bot.tile().x > 2870) return;   // already inside Ah Za Rhoon
    if (!has(bot, O.spade) || !has(bot, O.rope) || !has(bot, O.tinderbox) || !(has(bot, O.unlitCandle) || has(bot, O.litCandle))) fail(bot, 'k-mound: tools missing');
    await goK(bot, T.moundStand, 0, 'k-mound');
    // search (op2) twice: found_mound -> searched_mound; then spade -> dug; lit candle -> lit; rope -> roped
    await act(bot, 'mound search', opLocNow(bot, L.mound, 2), () => false, { max: 14, every: 6, anyChoice: true, quiet: true });
    await closeAll(bot);
    const rope0 = bot.count(O.rope);
    await act(bot, 'mound dig', anyLocNow(bot, [2217, 2218, 2219], L.mound.x, L.mound.z, { use: O.spade }), () => msgsSince(bot, T0).some(m => /small fissure|already excavated/.test(m)), { max: 30, every: 10 });
    if (has(bot, O.unlitCandle) && !has(bot, O.litCandle)) await act(bot, 'light candle', useOnItemNow(bot, O.tinderbox, O.unlitCandle), () => has(bot, O.litCandle), { max: 8, every: 3 });
    const FISSURE = [2217, 2218, 2219];   // ahzarhoon_entrance / _fissure / _fissure_withrope (loc_change'd in place, 50-tick revert)
    if (has(bot, O.litCandle)) await act(bot, 'candle -> fissure', anyLocNow(bot, FISSURE, L.mound.x, L.mound.z, { use: O.litCandle }), () => !has(bot, O.litCandle), { max: 30, every: 10, anyChoice: true });
    await closeAll(bot);
    await act(bot, 'rope -> fissure', anyLocNow(bot, FISSURE, L.mound.x, L.mound.z, { use: O.rope }), () => bot.count(O.rope) < rope0, { max: 30, every: 10, anyChoice: true });
    await closeAll(bot);
    if (!(await act(bot, 'crawl in', anyLocNow(bot, FISSURE, L.mound.x, L.mound.z, { op: 2 }), () => bot.tile().z > 9000, { answers: [/^Yes, I'll give it a go!/], max: 60, every: 10 }))) fail(bot, 'k-mound: not inside');
    await closeAll(bot);
    log(bot, 'k-mound: inside Ah Za Rhoon');
}
/** Ah Za Rhoon's rubble (quest_zombiequeen.rs2:826-835: oploc2 -> mesbox -> p_choice2 -> p_teleport; no stage, item or delay check), in
 *  bounded rounds: walk to the stand, 40 t of op + answers, and on a miss log it, close and go again (3 rounds, then fail as before).
 *  On a live server one 40 t window once got no server answer at all (no message, no dialog, no op ack), so one window is
 *  not enough. */
async function rubbleThrough(bot: SpeedBot, label: string, stand: Tile, sender: () => () => boolean, done: () => boolean): Promise<void> {
    for (let r = 1; r <= 3 && !done(); r++) {
        await go(bot, stand, 1, `azr ${label}`);
        const ok = await act(bot, label, sender(), done, { answers: [/^Yes, I'll wriggle through\./], max: 40 });
        await closeAll(bot);
        if (ok || done()) return;
        log(bot, `${label}: round ${r} not through at (${bot.tile().x},${bot.tile().z}) hp ${bot.stat('hitpoints').cur}${r < 3 ? ', again' : ''}`);
        await bot.tick(2);
    }
    if (!done()) fail(bot, `k-azr: ${label}`);
}
async function kAzr(bot: SpeedBot): Promise<void> {
    const inside = () => bot.tile().z > 9200 && bot.tile().z < 9420;
    if (!inside()) return;
    pray(bot, true);
    if (!has(bot, O.plaque)) {
        await go(bot, { x: 2900, z: 9380 }, 2, 'azr stone');
        await act(bot, 'chisel -> stone', useOnLocNow(bot, O.chisel, L.secretStone), () => has(bot, O.plaque), { max: 40, every: 8, anyChoice: true });
        await closeAll(bot);
    }
    if (bot.tile().z > 9344) {
        await rubbleThrough(bot, 'rubble', { x: 2887, z: 9374 }, () => opLocNow(bot, L.rubbleN, 2, { x: 2887, z: 9374 }), () => bot.tile().z < 9344);
    }
    if (!has(bot, O.crumpled)) {
        await go(bot, { x: 2938, z: 9285 }, 1, 'azr sacks');
        await act(bot, 'sacks', opLocNow(bot, L.sacks, 2), () => has(bot, O.crumpled), { max: 40, anyChoice: true });
        await closeAll(bot);
    }
    await act(bot, 'read crumpled', () => { const s = bot.slot(O.crumpled); if (s < 0) return false; bot.opHeld1(O.crumpled, s); bot.queueFlush(); }, () => false, { answers: [/^Yes please\./], max: 25, every: 30, quiet: true });
    await closeAll(bot);
    for (let k = 0; k < 6 && !has(bot, O.tattered); k++) {
        await go(bot, { x: 2886, z: 9318 }, 1, 'azr book');
        await act(bot, 'rubble book', opLocNow(bot, L.rubbleBook, 2), () => has(bot, O.tattered), { answers: [/^Yes, I'm quite sure\./], max: 30, every: 12 });
        await closeAll(bot);
    }
    if (!has(bot, O.tattered)) fail(bot, 'k-azr: no tattered scroll');
    // session 11 fix 378 TEST: SH_TEST378=1 skips this read (what qx269m's zombie if_close did) -> the crawl at the cairn fails
    // with msgs=[] unless fix 378 (SH_TATTERED) re-reads there
    if (process.env.SH_TEST378 !== '1') await act(bot, 'read tattered', () => { const s = bot.slot(O.tattered); if (s < 0) return false; bot.opHeld1(O.tattered, s); bot.queueFlush(); }, () => false, { answers: [/^Yes please\./], max: 25, every: 30, quiet: true });
    await closeAll(bot);
    if (!has(bot, O.zadimus) && !has(bot, O.boneShard)) {
        await go(bot, { x: 2933, z: 9326 }, 1, 'azr gallows');
        // route runner (fix 112, qrh7m + qrl3m 'no Zadimus corpse': 4 searches, the gallows mesbox (363) never continued while
        // a zombie (502/505) hit us; same remedy as k-belt's Mosol): clear the undead near the gallows first, then search
        for (let r = 0; r < 3 && !has(bot, O.zadimus); r++) {
            for (let k = 0; k < 8; k++) {
                const z = npcsOf(bot, [504, 505, 502, 503] as any).find(q => Math.max(Math.abs(q.x - 2933), Math.abs(q.z - 9326)) <= 5);
                if (!z) break;
                pray(bot, true);
                opNpcGo(bot, z, 2);
                await bot.until(() => !npcsOf(bot, [z.type] as any).some(q => q.idx === z.idx), 40);
                await bot.tick(2);
            }
            pray(bot, false);
            await go(bot, { x: 2933, z: 9326 }, 1, 'azr gallows');
            await act(bot, 'gallows', opLocNow(bot, L.gallows, 2), () => has(bot, O.zadimus), { answers: [/^Yes, I may find something else on the corpse\./], max: 40, every: 12 });
        }
        await closeAll(bot);
        if (!has(bot, O.zadimus)) fail(bot, 'k-azr: no Zadimus corpse');
    }
    // out: back through the rubble (the waterfall ledge is reached from the NORTH half only — rsmod: south landing -> (2939,9349)
    // ends at (2933,9329)), then the waterfall path (agility roll; a fall throws you out with damage — either way you leave;
    // z >= 9351 exits on the mound's north bank 0_45_46_48_7, quest_zombiequeen.rs2:1045-1050)
    if (bot.tile().z < 9344) {
        await rubbleThrough(bot, 'rubble back', { x: 2887, z: 9284 }, () => opLocNow(bot, { id: 2220, x: 2886, z: 9283 }, 2), () => bot.tile().z > 9344);
    }
    await go(bot, { x: 2939, z: 9353 }, 1, 'azr waterfall');
    if (!(await act(bot, 'waterfall', opLocNow(bot, { id: 2225, x: 2940, z: 9353 }, 2), () => bot.tile().z < 4000, { answers: [/^Yes, I'll follow the path\./], max: 60, every: 12 }))) fail(bot, 'k-azr: still inside');
    await closeAll(bot);
    pray(bot, false);
    log(bot, 'k-azr: out of Ah Za Rhoon');
}
async function kBury(bot: SpeedBot): Promise<void> {
    if (has(bot, O.boneShard) || has(bot, O.key)) return;
    if (!has(bot, O.zadimus)) fail(bot, 'k-bury: no corpse');
    await goK(bot, T.sacred, 0, 'k-bury');
    if (!(await act(bot, 'bury Zadimus', () => { const s = bot.slot(O.zadimus); if (s < 0) return false; bot.opHeld1(O.zadimus, s); bot.queueFlush(); }, () => has(bot, O.boneShard), { max: 40, every: 15, anyChoice: true }))) fail(bot, 'k-bury: no bone shard');
    await closeAll(bot);
}
/** Cairn Isle climbing rocks: east -> west (agility 15 roll; a fall hurts and leaves you east). Region-based: the north shore
 *  (x < 2792, z ~2997) is MAIN, not Cairn — an x test sent a bot there and called it "across" (local rehearsal). */
async function cairnWestward(bot: SpeedBot): Promise<void> {
    for (let k = 0; k < 12 && regionOf(bot.tile()) !== 'cairn'; k++) {
        if (cheb(bot.tile(), T.cairnEast) > 0) await go(bot, T.cairnEast, 0, 'cairn rocks');
        bot.opLoc(L.climbRocks.x, L.climbRocks.z, L.climbRocks.id, 1); bot.queueFlush();
        await bot.until(() => regionOf(bot.tile()) === 'cairn', 10);
        await bot.tick(2); eatIfLow(bot);
    }
    if (regionOf(bot.tile()) !== 'cairn') fail(bot, 'cairn: climbing rocks westward');
}
async function cairnEastward(bot: SpeedBot): Promise<void> {
    for (let k = 0; k < 12 && regionOf(bot.tile()) === 'cairn'; k++) {
        if (cheb(bot.tile(), T.cairnWest) > 0) await go(bot, T.cairnWest, 0, 'cairn rocks back');
        bot.opLoc(L.climbRocksW.x, L.climbRocksW.z, L.climbRocksW.id, 1); bot.queueFlush();
        await bot.until(() => regionOf(bot.tile()) !== 'cairn', 10);
        await bot.tick(2); eatIfLow(bot);
    }
    if (regionOf(bot.tile()) === 'cairn') fail(bot, 'cairn: climbing rocks eastward');
}
/** session 11 fix 378: read the tattered scroll (opheld1 -> mesbox -> "Yes please." sets ^zq_read_tattered_scroll, then opens the
 *  scroll "Bervirius, son of King Danthalas..." — quest_zombiequeen.rs2:862-869, scroll.rs2:234-236); true once that text is up. */
async function readTattered(bot: SpeedBot): Promise<boolean> {
    for (let k = 0; k < 3; k++) {
        await closeAll(bot);
        const ok = await act(bot, 'read tattered (378)', () => { const s = bot.slot(O.tattered); if (s < 0) return false; bot.opHeld1(O.tattered, s); bot.queueFlush(); }, () => bot.mainModalId !== -1 && bot.chatModalId === -1 && [...bot.ifText.values()].some(v => /son of King Danthalas/.test(v)), { answers: [/^Yes please\./], max: 15, every: 8, quiet: true });
        await closeAll(bot);
        if (ok) return true;
    }
    log(bot, 'read tattered (378): scroll text never shown');
    return false;
}
/** Cairn Isle crawl-way -> Bervirius' tomb (agility roll; a fail hurts and you stay outside). */
async function intoBervirius(bot: SpeedBot): Promise<void> {
    if (bot.tile().z > 9300) return;
    // session 11 fix 378 (SH_TATTERED; qx269m 'cairn: not into the tomb' x2, 10+10 crawls with msgs=[] and chat 356 = the
    // "nothing of significance" mesbox, quest_zombiequeen.rs2:613-647; the end save had zq_map_mechanisms (varp 117) = 0): the
    // Ah Za Rhoon read never set ^zq_read_tattered_scroll — a zombie melee hit runs if_close (npc_combat_melee.rs2:36) and kills
    // the "Yes please." choice, and that act fires once with done=false, so nobody saw it. Varp 117 is not transmitted:
    // re-read here (no undead on Cairn Isle; the setbit is idempotent) until the scroll text shows. The retry resumes at k-cairn1
    // (route-legs fix 76) and passes here too. SH_TATTERED=0 reverts.
    let read378 = process.env.SH_TATTERED === '0' || !has(bot, O.tattered);
    for (let k = 0; k < 8 && bot.tile().z < 9300; k++) {
        await goK(bot, { x: 2762, z: 2989 }, 1, 'cairn crawl');
        if (!read378) read378 = await readTattered(bot);
        await act(bot, 'crawl-way', opLocNow(bot, L.crawl, 2), () => bot.tile().z > 9300, { answers: [/^Yes Please, I can think of nothing nicer!/], max: 40, every: 12 });
        await closeAll(bot);
    }
    if (bot.tile().z < 9300) fail(bot, 'cairn: not into the tomb (did we read the tattered scroll / leave Ah Za Rhoon?)');
}
async function outOfBervirius(bot: SpeedBot): Promise<void> {
    for (let k = 0; k < 8 && bot.tile().z > 9300; k++) {
        // a successful climb is forcemove -> teleport -> delay -> forcemove (several ticks after the "climb back out" line):
        // sim the act window closed mid-climb, the next go() walked from the surface and threw "cannot reach"
        try { await go(bot, { x: 2764, z: 9376 }, 1, 'handholds'); } catch (e) { if (bot.tile().z < 9300) break; throw e; }
        await act(bot, 'handholds', opLocNow(bot, L.handholds, 1), () => bot.tile().z < 9300, { max: 20, every: 8, anyChoice: true });
        await bot.until(() => bot.tile().z < 9300, 8);
        eatIfLow(bot);
    }
    if (bot.tile().z > 9300) fail(bot, 'cairn: still in the tomb');
    await cairnEastward(bot);
}
async function kCairn1(bot: SpeedBot): Promise<void> {
    if (has(bot, O.pommel) || has(bot, O.boneBeads) || has(bot, O.deadBeads)) { if (bot.tile().z > 9300) await outOfBervirius(bot); return; }
    await intoBervirius(bot);
    await go(bot, { x: 2766, z: 9366 }, 1, 'dolmen');
    if (!(await act(bot, 'dolmen', opLocNow(bot, L.dolmen, 2), () => has(bot, O.pommel), { max: 40, every: 12, anyChoice: true }))) fail(bot, 'k-cairn1: no pommel');
    await closeAll(bot);
    await outOfBervirius(bot);
}
async function kBeads(bot: SpeedBot): Promise<void> {
    if (!has(bot, O.deadBeads) && !(bot as any).isWorn?.(O.deadBeads)) {
        if (!has(bot, O.boneBeads)) await act(bot, 'chisel -> pommel', useOnItemNow(bot, O.pommel, O.chisel), () => has(bot, O.boneBeads), { max: 15, every: 5, anyChoice: true });
        await closeAll(bot);
        // the beads need zq_read_crumpled_scroll (set by READING the crumpled scroll: opheld1 -> mesbox -> "Yes please.");
        // live the Ah Za Rhoon read did not stick ("You're not really sure how this would fit together") — read it again here
        for (let k = 0; k < 3 && !has(bot, O.deadBeads); k++) {
            if (has(bot, O.crumpled)) {
                await act(bot, 'read crumpled', () => { const sl = bot.slot(O.crumpled); if (sl < 0) return false; bot.opHeld1(O.crumpled, sl); bot.queueFlush(); }, () => [...bot.ifText.values()].some(v => /Rashiliyia/i.test(v)) && bot.chatModalId === -1 && bot.mainModalId !== -1, { answers: [/^Yes please\./], max: 20, every: 25, quiet: true });
                await closeAll(bot); await bot.tick(1);
            }
            await act(bot, 'wire -> beads', useOnItemNow(bot, O.boneBeads, O.wire), () => has(bot, O.deadBeads), { max: 15, every: 5, anyChoice: true });
            await closeAll(bot);
        }
        await closeAll(bot);
        if (!has(bot, O.deadBeads)) fail(bot, 'k-beads: no Beads of the Dead (crumpled scroll read? crafting 16?)');
    }
    if (!(bot as any).isWorn?.(O.deadBeads)) { const r = await (bot as any).equipItem(O.deadBeads); log(bot, `k-beads: wear ${JSON.stringify(r)}`); }
}
async function kTomb(bot: SpeedBot): Promise<void> {
    if (has(bot, O.corpse)) { if (bot.tile().z > 9400) await tombExit(bot); return; }
    if (bot.count(O.bones) < 3 && bot.tile().z < 9400) fail(bot, 'k-tomb: need 3 bones');
    if (bot.tile().z < 9400) {
        await goK(bot, T.tombOutside, 1, 'k-tomb');
        for (let k = 0; k < 6 && bot.tile().z < 9400; k++) {
            // reveal the doors (zq_doorblock_jungle1/2 -> hillsideclosedl/r 2240/2241 @ (2917,3090)/(2916,3090); they hide again
            // into the key, use it on the door (-> loc_2238/2239 opened), then Enter (op1).
            await act(bot, 'palm trees', opLocNow(bot, L.hidyTree, 2), () => false, { max: 8, every: 8, anyChoice: true, quiet: true });
            await closeAll(bot);
            await act(bot, 'examine door', anyLocNow(bot, [2240], 2917, 3090, { op: 2 }, 2244), () => false, { max: 6, every: 6, anyChoice: true, quiet: true });
            await closeAll(bot);
            if (!has(bot, O.key)) await act(bot, 'chisel -> bone shard', useOnItemNow(bot, O.boneShard, O.chisel), () => has(bot, O.key), { max: 10, every: 4, anyChoice: true });
            await closeAll(bot);
            if (!has(bot, O.key)) { log(bot, 'k-tomb: no bone key yet (found_door not set?)'); continue; }
            await act(bot, 'key -> door', anyLocNow(bot, [2240], 2917, 3090, { use: O.key }, 2244), () => msgsSince(bot, T0).some(m => /doors$|creak open/.test(m)), { max: 10, every: 5, anyChoice: true, quiet: true });
            await act(bot, 'enter', anyLocNow(bot, [2238, 2239], 2917, 3090, { op: 1 }, 2244), () => bot.tile().z > 9400, { max: 16, every: 4, anyChoice: true });
            await closeAll(bot);
        }
        if (bot.tile().z < 9400) fail(bot, 'k-tomb: not in the tomb');
    }
    // gate (beads worn) -> rocks down -> tomb door (3 bones) -> dolmen -> Nazastarool x3 -> corpse
    if (bot.tile().z > 9515) {
        await act(bot, 'gate', opLocNow(bot, L.tombGate, 1), () => bot.tile().z <= 9515, { max: 40, every: 6, anyChoice: true });
    }
    if (bot.tile().z > 9511) {
        await act(bot, 'rocks down', opLocNow(bot, L.rashRocks, 1), () => bot.tile().z <= 9511, { max: 40, every: 8, anyChoice: true });
    }
    if (bot.tile().z > 9481 && bot.tile().z <= 9511) {
        await go(bot, { x: 2892, z: 9479 }, 1, 'tomb door');
        for (let k = 0; k < 6 && bot.tile().z < 9481; k++) {
            // thzq_tombrooml1 -> l2 -> l3 (2246/2248/2249) and r1 -> r2 (2247/2250) as the 3 recesses fill; the 3rd bone opens it
            await act(bot, 'bones -> door', anyLocNow(bot, [2246, 2248, 2249, 2247, 2250], 2892, 9480, { use: O.bones }, 2246), () => bot.tile().z >= 9481, { max: 12, every: 4, anyChoice: true });
            await closeAll(bot);
            if (bot.tile().z < 9481) await act(bot, 'door', anyLocNow(bot, [2246, 2248, 2249], 2892, 9480, { op: 1 }, 2246), () => bot.tile().z >= 9481, { max: 8, every: 4, anyChoice: true });
        }
    }
    if (!(bot.tile().z >= 9481 && bot.tile().z < 9495)) fail(bot, 'k-tomb: not inside the tomb room');
    pray(bot, true);
    const NAZ = [N.naz1, N.naz2, N.naz3];
    const end = bot.tickCount + 1500;
    let touched = -100;
    while (!has(bot, O.corpse) && bot.tickCount < end) {
        eatIfLow(bot, 0.6);
        if (bot.chatModalId !== -1) { answerDialog(bot, [], { anyChoice: true }); await bot.tick(1); continue; }
        const corpseOnGround = (bot as any).findGroundItem(O.corpse, 6);
        if (corpseOnGround) { bot.opObj(corpseOnGround.x, corpseOnGround.z, O.corpse, 3); bot.queueFlush(); await bot.tick(2); continue; }
        const naz = npcsOf(bot, NAZ as any)[0] ?? null;
        if (naz) { if (bot.tickCount % 6 === 0) opNpcGo(bot, naz, 2); await bot.tick(1); continue; }
        const minion = npcsOf(bot, N.undead as any).find(q => q.d <= 2);
        if (minion && bot.tickCount % 6 === 0) { opNpcGo(bot, minion, 2); await bot.tick(1); continue; }
        if (bot.tickCount - touched > 25) { opLocNow(bot, L.rashDolmen, 1)(); touched = bot.tickCount; }
        await bot.tick(1);
    }
    if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
    if (!has(bot, O.corpse)) fail(bot, 'k-tomb: no corpse');
    log(bot, 'k-tomb: Rashiliyia\'s corpse taken');
    await tombExit(bot);
}
async function tombExit(bot: SpeedBot): Promise<void> {
    // tomb room -> through the door north -> rocks up -> gate -> exit doors (bone key) -> outside (2916,3093)
    if (bot.tile().z < 9400) return;
    if (bot.tile().z < 9495) await act(bot, 'door out', anyLocNow(bot, [2246, 2248, 2249, 2251], 2892, 9480, { op: 1 }, 2246), () => bot.tile().z < 9481, { max: 20, every: 5, anyChoice: true });
    if (bot.tile().z <= 9511) { await go(bot, { x: 2928, z: 9511 }, 1, 'rocks'); await act(bot, 'rocks up', opLocNow(bot, L.rashRocksUp, 1), () => bot.tile().z >= 9515, { max: 40, every: 8, anyChoice: true }); }
    if (bot.tile().z <= 9516) await act(bot, 'gate up', opLocNow(bot, L.tombGate, 1), () => bot.tile().z >= 9518, { max: 40, every: 6, anyChoice: true });
    await go(bot, { x: 2929, z: 9526 }, 1, 'exit doors');
    if (!(await act(bot, 'key -> exit', () => { const s = bot.slot(O.key); if (s < 0) return false; bot.useItemOnLoc(L.exitDoor.x, L.exitDoor.z, L.exitDoor.id, O.key, s); bot.queueFlush(); }, () => bot.tile().z < 4000, { max: 40, every: 8, anyChoice: true }))) fail(bot, 'k-tomb: exit door');
    await closeAll(bot);
}
async function kCairn2(bot: SpeedBot): Promise<void> {
    if (!has(bot, O.corpse)) return;
    const cr0 = bot.stat('crafting').xp;
    await intoBervirius(bot);
    await go(bot, { x: 2766, z: 9366 }, 1, 'dolmen');
    if (!(await act(bot, 'corpse -> dolmen', useOnLocNow(bot, O.corpse, L.dolmen), () => !has(bot, O.corpse), { max: 60, every: 15, anyChoice: true }))) fail(bot, 'k-cairn2: corpse still held');
    await bot.until(() => bot.stat('crafting').xp > cr0, 10);
    await closeAll(bot);
    log(bot, `k-cairn2: QUEST COMPLETE? crafting xp ${cr0} -> ${bot.stat('crafting').xp}`);
    await outOfBervirius(bot);
}
async function kEnter(bot: SpeedBot): Promise<void> {
    const inVillage = () => inBox(bot.tile(), 2817, 2944, 2866, 3008);
    if (inVillage()) return;
    await goK(bot, T.mosol, 3, 'k-enter');
    if (!(await act(bot, 'mosol enter', opNpcNow(bot, N.mosol, 1), () => inVillage(), { answers: [/^Yes, I'll give it a go!/], max: 60, every: 12 }))) fail(bot, 'k-enter: not in the village (quest not complete?)');
    await closeAll(bot);
    log(bot, 'k-enter: in Shilo Village');
}

// ---- phase table --------------------------------------------------------------------------------------------------------------
export const PHASES: Array<{ id: string; run: (bot: SpeedBot, acct: string) => Promise<void> }> = [
    { id: 'm-gnome', run: b => mGnome(b) },
    { id: 'm-bank', run: b => mBank(b) },
    { id: 'm-tools', run: b => mTools(b) },
    { id: 'm-meats', run: b => mMeats(b) },
    { id: 'm-mine', run: b => mMine(b) },
    { id: 'm-weapon', run: b => mWeapon(b) },
    { id: 'm-bear', run: b => mBear(b) },
    { id: 'm-druidic', run: b => mDruidic(b) },
    { id: 'm-boat', run: b => mBoat(b) },
    { id: 'k-shop', run: b => kShop(b) },
    { id: 'k-smith', run: b => kSmith(b) },
    { id: 'k-jungle', run: (b, a) => kJungle(b, a) },
    { id: 'k-belt', run: b => kBelt(b) },
    { id: 'k-start', run: b => kStart(b) },
    { id: 'k-mound', run: b => kMound(b) },
    { id: 'k-azr', run: b => kAzr(b) },
    { id: 'k-bury', run: b => kBury(b) },
    { id: 'k-cairn1', run: b => kCairn1(b) },
    { id: 'k-beads', run: b => kBeads(b) },
    { id: 'k-tomb', run: b => kTomb(b) },
    { id: 'k-cairn2', run: b => kCairn2(b) },
    { id: 'k-enter', run: b => kEnter(b) },
];

/** LOCAL rehearsal setups (cheats): the state an account has when it reaches the phase. */
export const LOCAL_SETUP: Record<string, { stats?: Record<string, number>; items?: Array<{ name: string; n: number }>; tele?: { x: number; z: number; level?: number }; clear?: boolean; vars?: Record<string, number> }> = {
    'm-gnome': { tele: { x: 2484, z: 3439 } },
    'm-bank': { clear: true, stats: { prayer: 99, attack: 99, strength: 99, defence: 99, hitpoints: 99, agility: 32, crafting: 20, magic: 99 }, items: [{ name: 'coins', n: 30000 }, { name: 'shark', n: 5 }], tele: { x: 3255, z: 3277 } },
    'm-meats': { clear: true, items: [{ name: 'shark', n: 10 }], tele: { x: 3230, z: 3290 } },
    'm-druidic': { clear: true, stats: { prayer: 99, attack: 99, strength: 99, defence: 99, hitpoints: 99 }, items: [{ name: 'raw_beef', n: 1 }, { name: 'raw_rat_meat', n: 1 }, { name: 'raw_bear_meat', n: 1 }, { name: 'raw_chicken', n: 1 }, { name: 'shark', n: 10 }], tele: { x: 2924, z: 3480 } },
    'm-boat': { clear: true, items: [{ name: 'coins', n: 5000 }], tele: { x: 3027, z: 3220 } },
    'k-shop': { clear: true, stats: { herblore: 3, agility: 32, crafting: 20, mining: 40, prayer: 99, attack: 99, strength: 99, defence: 99, hitpoints: 99 }, items: [{ name: 'coins', n: 20000 }, { name: 'shark', n: 12 }, { name: 'bones', n: 4 }], tele: { x: 2768, z: 3118 } },
    'k-jungle': { vars: { druidquest: 4 }, tele: { x: 2808, z: 3088 } },
    'k-belt': { vars: { druidquest: 4, junglepotion: 13 }, tele: { x: 2884, z: 2953 } },
};

export async function runPhases(bot: SpeedBot, acct: string, which: string[]): Promise<void> {
    await nav();
    bot.holdDialogs = true;
    T0 = bot.tickCount;
    const prog = readProg(acct);
    for (const ph of PHASES) {
        if (which[0] !== 'all' && !which.includes(ph.id)) continue;
        if (which[0] === 'all' && prog.done.includes(ph.id)) continue;
        log(bot, `PHASE ${ph.id} — start`);
        await ph.run(bot, acct);
        const p = readProg(acct);
        if (!p.done.includes(ph.id)) p.done.push(ph.id);
        writeProg(acct, p);
        log(bot, `PHASE ${ph.id} — DONE`);
    }
}

if (import.meta.main) {
    const [mode, user, ...rest] = process.argv.slice(2);
    if ((mode !== 'local' && mode !== 'live') || !user) { console.error('usage: q-shilo.ts local <user> <phase|all> [--setup] | live <acct> [all|phase...]'); process.exit(1); }
    const which = rest.filter(a => !a.startsWith('--'));
    if (!which.length) which.push('all');
    let bot: SpeedBot;
    if (mode === 'local') {
        if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('local: set LC_HOST=localhost:8891'); process.exit(1); }
        bot = await SpeedBot.create(user);
        if (rest.includes('--setup')) { for (const w of which.slice(0, 1)) { const s = LOCAL_SETUP[w]; if (!s) continue; /* the FIRST phase's state only */ await localSetup(bot, s); for (const [k, v] of Object.entries(s.vars ?? {})) await bot.cheat(`setvar ${k} ${v}`); } }
    } else {
        if (!process.env.LC_HOST) { console.error('live: set LC_HOST=rs-sdk-demo.fly.dev'); process.exit(1); }
        const { readBotEnv, createLive } = await import('./k-live.js');
        const creds = readBotEnv(user);
        console.log(`[shilo] LIVE as ${creds.user} on ${process.env.LC_HOST}`);
        try { bot = await createLive(creds); } catch (e) { console.error(`[shilo] login failed: ${(e as Error).message}`); process.exit(2); }
    }
    let code = 0;
    try { await runPhases(bot!, user, which); console.log('[shilo] ALL REQUESTED PHASES DONE'); }
    catch (e) { console.error(`[shilo] FAILED: ${(e as Error).message}`); code = 3; }
    try { await bot!.logout(); } catch { /* gone */ }
    process.exit(code);
}

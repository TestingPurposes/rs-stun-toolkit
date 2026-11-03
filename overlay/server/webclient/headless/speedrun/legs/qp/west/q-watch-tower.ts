// q-watch-tower.ts — WATCH TOWER (4 QP), cheat-free. West lane.
//
// Content: ~/sim/rs-qp/server/content/scripts/quests/quest_itwatchtower/** + areas/area_yanille/scripts/ogre_trader.rs2
// (rev 289). Stage constants quest_itwatchtower.constant. %itwatchtower / %itwatchtower_bits / %gutanoth_gold are NOT
// transmitted: every step gates on observables (items, position, dialog text, messages, qp).
//
// Geography (probe-wt-regions.ts on the 289 collision, gates walled off): the HILL (tower, Og, caves 1-5, Toban's cave,
// the enclave exit) is one walk region; W-CITY (cake counter, battlement west, enclave guard) is behind gate2 (relic);
// the E-POCKET (cave 6 east face) behind gate1 (gold bar); S-JUMP (battlement east .. the chasm), the city-guard LEDGE,
// Toban's PLATEAU, Grew's ISLAND and the HILL-LOWER pocket are closed pockets reached only by their scripted crossings.
// The Gu'Tanoth gates are planner-passable "doors" for rsmod/navgrid, so run() walls them off for the planners and every
// crossing is an explicit op.
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { nav, npc, npcsOf, opNpcGo, locAt, msgsSince, opLocGo, routeToLoc, trace, addWalls, situation, navSync, type Tile } from '../../q-lib.js';
import { act, converse, fail, fight, mkLog, wear, eatNow, eatWatch, dead, foodCount, msgSince, walk, pickup, qp, foodIds, routeNextTo, type Item, type RunResult } from './we-lib.js';
declare const process: { env: Record<string, string | undefined> };

export const QUEST = { name: 'Watch Tower', dir: 'quest_itwatchtower', qp: 4 };
export const WEAPON = process.env.WT_WEAPON ?? 'dragon_longsword';
export const REQUIREMENTS = {
    quests: ['Lost City (only to wield the dragon longsword; any weapon works)'] as string[],
    qp: 0,
    skills: {
        agility: [25, 'climbing rocks 18 (quest_itwatchtower.rs2:2), chasm jump 25 (:393)'],
        thieving: [15, 'rock cake counter (area_yanille/scripts/ogre_trader.rs2:22)'],
        herblore: [14, 'ogre potion mixing (ogre_potion.rs2:57,72)'],
        magic: [14, 'magic ogre potion on a shaman (ogre_shaman.rs2:23)'],
        mining: [40, 'Rock of Dalgroth (quest_itwatchtower.rs2:483) with a usable pickaxe'],
        attack: [60, `wield ${WEAPON} for Gorad (cl68, 80 hp)`],
    } as Record<string, [number, string]>,
    start: { x: 2549, z: 3120, level: 0 },   // just north of the watchtower's climbing rocks (2548,3119)
    end: { x: 2928, z: 4715, level: 2 },     // the lever drops you in the completed tower's copy (quest_itwatchtower.rs2:522)
};
export const SUPPLY: Item[] = [
    { name: 'rope', n: 1 }, { name: 'dragon_bones', n: 1 }, { name: 'gold_bar', n: 1 }, { name: 'deathrune', n: 1 },
    { name: 'coins', n: 20 }, { name: 'lit_candle', n: 1 }, { name: 'guam_leaf', n: 1 }, { name: 'vial_water', n: 1 },
    // jangerberries: picked up in-quest from the ground spawns on Grew's island (supply-gap change
    //); a supplied one is used instead if held
    { name: 'ground_bat_bones', n: 1 }, { name: 'adamant_pickaxe', n: 1 },
    { name: WEAPON, n: 1 }, { name: 'shark', n: 8 },
];

// ---- ids (content/pack) --------------------------------------------------------------------------------------------
export const N = { wizard: 872, og: 853, grew: 854, toban: 855, gorad: 856, guard1: 858, guard2: 859, guard3: 860, guard4: 861,
    cityGuard: 862, scared: 863, mad: 864, talker1: 865, talker2: 866, talker3: 867, talker4: 868, enclaveGuard: 870, shaman: 871,
    trader2: 875 } as const;
export const O = { nails: 2384, key: 2378, gold: 2393, tooth: 2377, part1: 2373, part2: 2374, part3: 2375, relic: 2372, cake: 2379,
    map: 2376, nightshade: 2398, c1: 2380, c2: 2381, c3: 2382, c4: 2383, guamvial: 91, guamjanger: 2390, potion: 2394, magicPotion: 2395,
    scroll: 2396 } as const;
type LocRef = { id: number; x: number; z: number; level?: number };
const L = {
    rocks: { id: 2299, x: 2548, z: 3119 },                       // climbing rocks -> L1 (2548,3117)
    ladderUp1: { id: 2796, x: 2549, z: 3111, level: 1 },        // watchladderup L1 -> L2 (2549,3112)
    ladderDown2: { id: 2797, x: 2549, z: 3111, level: 2 },      // watchladderdown L2 -> L1 (2549,3112)
    ladderTop1: { id: 1746, x: 2544, z: 3111, level: 1 },       // laddertop L1 -> L0
    towerLadder: { id: 2833, x: 2544, z: 3111 },                 // L0 -> L1 (stage >= 1)
    lever: { id: 2794, x: 2543, z: 3115, level: 2 },
    bush: { id: 2799, x: 2544, z: 3134 },
    ropeTree: { id: 2326, x: 2499, z: 3087 },                    // rope on it (within 3) -> Grew's island
    swingOut: { id: 2324, x: 2511, z: 3090 },                    // swing back off the island -> (2511,3096)
    tobanCave: { id: 2811, x: 2499, z: 2989 },                   // -> plateau (2576,3029)
    tobanLadder: { id: 2812, x: 2575, z: 3029 },                 // plateau -> (2500,2988)
    tobanChest: { id: 2790, x: 2575, z: 3031 },
    gate2: { id: 2788, x: 2504, z: 3062 },                       // NW gate (relic guard)
    gate1: { id: 2786, x: 2550, z: 3028 },                       // E gate (gold guard)
    counter: { id: 2793, x: 2506, z: 3023 },
    battlement: { id: 2832, x: 2507, z: 3011 },
    jump1: { id: 2830, x: 2530, z: 3026 },                       // chasm jump (agility 25 + 20 gp) -> (2530,3029)
    jump2: { id: 2831, x: 2531, z: 3029 },                       // free jump back -> (2531,3026)
    cave1: { id: 2805, x: 2560, z: 3022 }, cave2: { id: 2806, x: 2522, z: 3068 }, cave3: { id: 2807, x: 2539, z: 3052 },
    cave4: { id: 2808, x: 2552, z: 3052 }, cave5: { id: 2809, x: 2553, z: 3033 }, cave6: { id: 2810, x: 2527, z: 3011 },
    exit1: { id: 2817, x: 2497, z: 9418 }, exit2: { id: 2818, x: 2532, z: 9470 }, exit3: { id: 2819, x: 2518, z: 9456 },
    exit4: { id: 2820, x: 2497, z: 9451 }, exit5: { id: 2821, x: 2504, z: 9442 }, exit6: { id: 2822, x: 2521, z: 9411 },
    enclaveExit: { id: 2813, x: 2598, z: 9468 },
    rock: { id: 2816, x: 2590, z: 9449 },
} as const;

// ---- small helpers (lane-local copies of the q-underground-pass ones) ------------------------------------------------
const has = (bot: SpeedBot, o: string | number, n = 1) => bot.count(objId(o)) >= n;
const inBox = (bot: SpeedBot, x0: number, z0: number, x1: number, z1: number, level = 0) => { const t = bot.tile(); return bot.minusedlevel === level && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1; };
const lvl = (l: LocRef) => l.level ?? 0;
async function actAt(bot: SpeedBot, label: string, stand: Tile | undefined, op: () => boolean | void, done: () => boolean,
    o: { every?: number; max?: number; answers?: RegExp[]; level?: number }): Promise<boolean> {
    if (stand && !done() && cheb(bot.tile(), stand) > 0 && cheb(bot.tile(), stand) <= 120) await bot.walkTo(stand.x, stand.z, { maxTicks: 300, log: false });
    return act(bot, label, op, done, { every: o.every ?? 6, max: o.max ?? 120, answers: o.answers });
}
function opUntil(bot: SpeedBot, label: string, loc: LocRef, op: number, done: () => boolean, o: { stand?: Tile; every?: number; max?: number; answers?: RegExp[] } = {}) {
    const l = locAt(loc.id, loc.x, loc.z, lvl(loc));
    return actAt(bot, label, o.stand, () => { opLocGo(bot, l, op, o.stand); }, done, o);
}
function useOnLoc(bot: SpeedBot, label: string, obj: number, loc: LocRef, done: () => boolean, o: { stand?: Tile; every?: number; max?: number; answers?: RegExp[] } = {}) {
    const l = locAt(loc.id, loc.x, loc.z, lvl(loc));
    return actAt(bot, label, o.stand, () => { const sl = bot.slot(obj); if (sl < 0) return false; routeToLoc(bot, l, o.stand); bot.useItemOnLoc(l.x, l.z, l.id, obj, sl); bot.queueFlush(); }, done, o);
}
/** use an item on the nearest npc of `type` (route + OPNPCU each try), answering dialogs, until done */
function useOnNpc(bot: SpeedBot, label: string, obj: number, type: number, done: () => boolean, o: { every?: number; max?: number; answers?: RegExp[] } = {}) {
    return act(bot, label, () => {
        const n = npc(bot, type), sl = bot.slot(obj); if (!n || sl < 0) return false;
        routeNextTo(bot, n); bot.useItemOnNpc(n.idx, obj, sl); bot.queueFlush();
    }, done, { every: o.every ?? 6, max: o.max ?? 120, answers: o.answers });
}
/** a dialog text page (IF_SETTEXT) matching `re` appeared after `snap` was taken, or a game message did */
function textSince(bot: SpeedBot, snap: Map<number, string>, since: number, re: RegExp): boolean {
    for (const [k, v] of bot.ifText) if (snap.get(k) !== v && re.test(v)) return true;
    return msgsSince(bot, since).some(t => re.test(t));
}
/** talk to an npc and wait until a page matching `re` was shown and the chat closed */
async function talkUntil(bot: SpeedBot, type: number, re: RegExp, answers: RegExp[], o: { stand?: Tile; near?: number; maxTicks?: number; label?: string; extra?: () => boolean } = {}): Promise<boolean> {
    const snap = new Map(bot.ifText), t0 = bot.tickCount; let saw = false;
    return converse(bot, type, { done: () => { if (textSince(bot, snap, t0, re) || o.extra?.()) saw = true; return saw && bot.chatModalId === -1; },
        answers, stand: o.stand, near: o.near ?? 10, maxTicks: o.maxTicks ?? 150, label: o.label });
}

// ---- regions ----------------------------------------------------------------------------------------------------------
const onIsland = (b: SpeedBot) => inBox(b, 2502, 3077, 2522, 3095);
/** same walk region as `anchor` (rsmod reachability either way, cached per tile) — for pockets with irregular shapes */
const REG = new Map<string, boolean>();
function sameRegion(b: SpeedBot, anchor: Tile, level = 0): boolean {
    if (b.minusedlevel !== level) return false;
    const me = b.tile(), k = `${anchor.x},${anchor.z}|${me.x},${me.z}`;
    const c = REG.get(k); if (c !== undefined) return c;
    const reach = (a: Tile, t: Tile) => { let p: Tile[] = []; try { p = navSync().findLongPath(level, a.x, a.z, t.x, t.z, 800); } catch { p = []; } const e = p[p.length - 1]; return cheb(a, t) === 0 || (!!e && e.x === t.x && e.z === t.z); };
    const r = cheb(me, anchor) < 40 && (reach(me, anchor) || reach(anchor, me));
    REG.set(k, r); return r;
}
const onPlateau = (b: SpeedBot) => sameRegion(b, { x: 2576, z: 3029 });
const inEnclave = (b: SpeedBot) => inBox(b, 2560, 9390, 2630, 9480);
const inCaves = (b: SpeedBot) => inBox(b, 2490, 9400, 2545, 9480);
const inTower = (b: SpeedBot) => b.minusedlevel >= 1 && inBox(b, 2538, 3105, 2556, 3122, b.minusedlevel);
/** inside Gu'Tanoth (the walled city, any pocket) — z band of the city south of the hill */
const inCity = (b: SpeedBot) => inBox(b, 2490, 2995, 2570, 3061) && !onPlateau(b);

// ---- tower -----------------------------------------------------------------------------------------------------------
/** climb to the wizard's floor (L2) from anywhere on the hill */
async function toTop(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    if (bot.minusedlevel === 2) return;
    if (bot.minusedlevel === 0) {
        // the climbing rocks (agility 18) are the only way up before stage 1 and are right outside; always use them
        // walk close, then let opLocGo pick the interaction tile (a fixed stand next to this wall decoration is refused)
        if (cheb(bot.tile(), { x: 2549, z: 3121 }) > 6) await walk(bot, { x: 2549, z: 3121 }, 2, 'watchtower', 600);
        if (!(await opUntil(bot, 'climbing rocks', L.rocks, 1, () => bot.minusedlevel === 1, { every: 6, max: 60 }))) fail(bot, 'climbing rocks');
    }
    if (bot.minusedlevel === 1 && !(await opUntil(bot, 'ladder up', L.ladderUp1, 1, () => bot.minusedlevel === 2, { every: 5, max: 40 }))) fail(bot, 'watchtower ladder up');
    log('top of the watchtower');
}
async function toGround(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    if (bot.minusedlevel === 2 && !(await opUntil(bot, 'ladder down', L.ladderDown2, 1, () => bot.minusedlevel === 1, { every: 5, max: 40 }))) fail(bot, 'watchtower ladder down');
    if (bot.minusedlevel === 1 && !(await opUntil(bot, 'ladder top', L.ladderTop1, 1, () => bot.minusedlevel === 0, { every: 5, max: 40 }))) fail(bot, 'watchtower ground ladder');
    // out of the tower's ground floor (its door is handled by walkTo)
    if (inBox(bot, 2538, 3105, 2556, 3118)) await bot.walkTo(2549, 3121, { maxTicks: 60, log: false });
    log('down from the watchtower');
}
async function wizard(bot: SpeedBot, re: RegExp, answers: RegExp[], label: string, extra?: () => boolean): Promise<void> {
    if (!(await talkUntil(bot, N.wizard, re, answers, { maxTicks: 120, label, extra }))) fail(bot, `wizard: ${label}`);
}
async function useOnWizard(bot: SpeedBot, obj: number, done: () => boolean, label: string): Promise<void> {
    if (!(await useOnNpc(bot, label, obj, N.wizard, done, { every: 8, max: 80 }))) fail(bot, `wizard: ${label}`);
}

// ---- gates ------------------------------------------------------------------------------------------------------------
/** walls for the planners: the two Gu'Tanoth double gates (getDoorAt geometry: west edge of x2504 z3062-63; south edge of
 *  x2549-2550 z3028) — crossings are explicit ops */
const GATE_WALLS = [
    { level: 0, x: 2504, z: 3062, shape: 0, angle: 0, blockrange: true }, { level: 0, x: 2504, z: 3063, shape: 0, angle: 0, blockrange: true },
    { level: 0, x: 2549, z: 3028, shape: 0, angle: 3, blockrange: true }, { level: 0, x: 2550, z: 3028, shape: 0, angle: 3, blockrange: true },
];
const wCity = (b: SpeedBot) => inBox(b, 2490, 3005, 2507, 3061) || inBox(b, 2490, 3013, 2525, 3045);   // refined in the sim
/** out of the west city through gate2 (opens freely at stage >= 4, quest_itwatchtower.rs2:271-284) */
async function outGate2(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    // the gate is on the west edge of x2504: inside (2503,3062) -> op -> (2504,3062) outside (probe-useloc.ts)
    const out = () => bot.tile().x >= 2504 && bot.tile().z >= 3060 && bot.tile().z <= 3070;
    if (!(await opUntil(bot, 'gate2 out', L.gate2, 1, out, { stand: { x: 2503, z: 3062 }, every: 6, max: 80 }))) fail(bot, 'out of gate2');
    log('out through the NW gate');
}

// ---- segments ---------------------------------------------------------------------------------------------------------
type Seg = (bot: SpeedBot, log: (s: string) => void) => Promise<void>;
const P = { started: false };

/** wizard: "What's the matter?" -> "So how come the spell doesn't work?" -> "Can I be of help?" (=1) */
const segStart: Seg = async (bot, log) => {
    await toTop(bot, log);
    await wizard(bot, /surrounding area|bring it here/i, [/What's the matter/i, /spell doesn't work/i, /Can I be of help/i], 'start');
    log('wizard: started (=1)');
};
/** the bush north of the tower (2544,3134): fingernails (stage 1 only, quest_itwatchtower.rs2:17-29) */
const segNails: Seg = async (bot, log) => {
    if (has(bot, O.nails)) return;
    await toGround(bot, log);
    if (!(await opUntil(bot, 'nail bush', L.bush, 1, () => has(bot, O.nails), { every: 6, max: 120 }))) fail(bot, 'fingernails');
    log('fingernails');
};
/** wizard with the nails (=2): "What do you suggest I do?" -> "So what do I do?" */
const segWiz2: Seg = async (bot, log) => {
    await toTop(bot, log);
    await wizard(bot, /Tribal ogres|ogre settlements/i, [/What do you suggest/i, /So what do I do/i], 'nails');
    log('wizard: fingernails (=2)');
    await bot.dropAll([O.nails], 4);
};
/** Og (2506,3116): "I seek entrance to the city of ogres." -> Toban's key */
const segOg1: Seg = async (bot, log) => {
    if (has(bot, O.key) || has(bot, O.gold) || has(bot, O.part1)) return;
    await toGround(bot, log);
    if (!(await talkUntil(bot, N.og, /key to the chest/i, [/I seek entrance/i], { stand: { x: 2506, z: 3114 }, near: 6, label: 'og', extra: () => has(bot, O.key) }))) fail(bot, 'Og: key');
    log("Og: Toban's key");
};
/** rope on the tree (2499,3087) -> Grew's island; Grew: "Don't eat me; I can help you."; or hand him the tooth */
async function islandVisit(bot: SpeedBot, log: (s: string) => void, tooth: boolean): Promise<void> {
    if (!onIsland(bot)) {
        if (!has(bot, 'rope')) fail(bot, 'no rope for the island');
        if (!(await useOnLoc(bot, 'rope tree', objId('rope'), L.ropeTree, () => onIsland(bot), { stand: { x: 2500, z: 3087 }, every: 8, max: 60 }))) fail(bot, 'rope swing onto the island');
        log("on Grew's island");
    }
    if (tooth) {
        if (!(await talkUntil(bot, N.grew, /one of the crystals|part of a horrible statue/i, [], { label: 'grew2', extra: () => has(bot, O.part2) }))) fail(bot, 'Grew: tooth');
        log('Grew: relic part 2 + crystal 1');
    } else {
        if (!(await talkUntil(bot, N.grew, /knock one of his teeth out/i, [/Don't eat me/i], { label: 'grew1' }))) fail(bot, 'Grew: task');
        log('Grew: knock out a tooth');
    }
    await getBerries(bot, log, tooth);
    // swing off (tree_ropeswing3, agility 10): stand on its start tile (2511,3091)
    if (!(await opUntil(bot, 'swing off', L.swingOut, 1, () => !onIsland(bot), { stand: { x: 2511, z: 3091 }, every: 6, max: 60 }))) fail(bot, 'swing off the island');
}
const segGrew1: Seg = async (bot, log) => { if (has(bot, O.tooth) || has(bot, O.part2)) return; await islandVisit(bot, log, false); };
/** Toban's plateau: Toban x2 (bones), Gorad (tooth), the chest (gold), the rope spawn, ladder down; the death rune spawn */
const segToban: Seg = async (bot, log) => {
    if (has(bot, O.part3) && has(bot, O.tooth) && has(bot, O.gold)) return;
    // A/B (--env WT_RUNE=spawn): do without the supplied death rune and take the spawn by the plateau ladder (2500,2967)
    if (process.env.WT_RUNE === 'spawn' && has(bot, 'deathrune')) await bot.dropAll(['deathrune'], 4);
    if (!onPlateau(bot)) {
        if (!(await opUntil(bot, 'toban cave', L.tobanCave, 1, () => onPlateau(bot), { every: 8, max: 300 }))) fail(bot, "Toban's cave");
        log('on the plateau');
    }
    if (!has(bot, O.part3)) {
        // first talk sets spoken_toban ("bring me the bones"), then the bones on him give part 3 (toban.rs2:23-60)
        await talkUntil(bot, N.toban, /bones of an adult dragon|did you bring the dragon bone/i, [/I seek entrance/i, /I could do something/i], { label: 'toban1', extra: () => has(bot, O.part3) });
        if (!has(bot, O.part3) && !(await useOnNpc(bot, 'bones on toban', objId('dragon_bones'), N.toban, () => has(bot, O.part3), { every: 8, max: 60 }))) fail(bot, 'Toban: part 3');
        log('Toban: relic part 3');
    }
    const chestStep = async () => {
    if (!has(bot, O.gold)) {
        if (!(await opUntil(bot, 'toban chest', L.tobanChest, 1, () => has(bot, O.gold), { every: 6, max: 60 }))) fail(bot, "Toban's chest");
        log('stolen gold');
    }
    };
    const toothStep = async () => {
    if (!has(bot, O.tooth)) {
        const w = objId(WEAPON); if (has(bot, w) && !bot.isWorn(w)) await wear(bot, w);
        // the plateau's ogres (115, aggressive) pin us in single combat ("I'm already under attack!"): kill the pinning one first
        for (let k = 0; k < 12 && !has(bot, O.tooth); k++) {
            if (bot.free() < 1) { const f = bot.inv().find(s => foodIds().includes(s.obj)); if (f) { bot.opHeld1(f.obj, f.slot); bot.queueFlush(); await bot.tick(2); } }
            const t0 = bot.tickCount;
            await fight(bot, N.gorad, { max: 40, label: 'gorad', reissue: 4, done: () => has(bot, O.tooth) || msgSince(bot, t0, /already under attack/i) });
            if (dead(bot)) return;
            if (msgSince(bot, t0, /already under attack/i)) {
                // single combat: find which adjacent ogre is the one hitting us (the others answer "already under attack"),
                // kill it, then back to Gorad
                for (const cand of npcsOf(bot, [115]).filter(n => n.d <= 3)) {
                    const t1 = bot.tickCount;
                    opNpcGo(bot, cand, 2);
                    await bot.tick(3);
                    if (msgSince(bot, t1, /already under attack/i)) continue;
                    log(`an ogre pins us at ${cand.x},${cand.z}: killing it`);
                    await fight(bot, 115, { max: 80, reissue: 4, pick: l => l.find(n => n.idx === cand.idx) ?? null });
                    break;
                }
            }
            await bot.until(() => has(bot, O.tooth), 3);
        }
        if (!has(bot, O.tooth)) fail(bot, "Gorad's tooth");
        log("Gorad's tooth");
    }
    };
    // A/B (--env WT_ORDER=chest): chest before Gorad; default Gorad first (the chest walk pulls the ogres onto us)
    if (process.env.WT_ORDER === 'chest') { await chestStep(); await toothStep(); } else { await toothStep(); await chestStep(); }
    if (dead(bot)) return;
    if (bot.count('rope') < 1) {
        const g = bot.findGroundItem(objId('rope'), 15);
        if (g) await pickup(bot, 'rope', { x: g.x, z: g.z }, 40);
        log(`rope spawn: ${bot.count('rope')}`);
    }
    if (!(await opUntil(bot, 'toban ladder', L.tobanLadder, 1, () => !onPlateau(bot), { every: 6, max: 60 }))) fail(bot, 'plateau ladder down');
    if (!has(bot, 'deathrune')) await pickup(bot, 'deathrune', { x: 2500, z: 2967 }, 80);
};
/** Og: the gold -> relic part 1 (automatic hand-in, og.rs2:44-54) */
const segOg2: Seg = async (bot, log) => {
    if (has(bot, O.part1)) return;
    if (!(await talkUntil(bot, N.og, /part of a horrible statue|little rat has got it/i, [/I have your gold/i], { stand: { x: 2506, z: 3114 }, near: 6, label: 'og2', extra: () => has(bot, O.part1) }))) fail(bot, 'Og: part 1');
    log('Og: relic part 1');
};
const segGrew2: Seg = async (bot, log) => { if (has(bot, O.part2)) return; await islandVisit(bot, log, true); };
/** the three parts on the wizard -> the ogre relic (=3), watchtower_wizard.rs2:247-322 */
const segRelic: Seg = async (bot, log) => {
    if (has(bot, O.relic)) return;
    await toTop(bot, log);
    for (const p of [O.part1, O.part2, O.part3]) if (has(bot, p)) await useOnWizard(bot, p, () => !has(bot, p), `part ${p}`);
    if (!(await bot.until(() => has(bot, O.relic), 20))) fail(bot, 'ogre relic');
    log('ogre relic (=3)');
};
/** Supply-gap change: the ogre potion takes ONE jangerberries (ogre_potion.rs2:71-88). Its ground spawns (map
 *  m39_48 obj 247, local (14,18) (16,8) (20,14) (21,10) = (2510,3090) (2512,3080) (2516,3086) (2517,3082)) are on GREW'S ISLAND
 *  (a closed pocket; the first sim try to walk there from the gate side spun on "route unavailable"): take one during an
 *  island visit, the (2510,3090) pile is next to the swing-off tile (2511,3091). `must` (2nd visit) waits for a respawn.
 *  Skipped when berries (or a later potion stage) are already held. */
const needBerries = (bot: SpeedBot) => !(has(bot, 'jangerberries') || has(bot, O.guamjanger) || has(bot, O.potion) || has(bot, O.magicPotion));
async function getBerries(bot: SpeedBot, log: (s: string) => void, must: boolean): Promise<void> {
    if (!needBerries(bot)) return;
    const id = objId('jangerberries'), t0 = bot.tickCount;
    for (let k = 0; k < (must ? 6 : 1) && !has(bot, id); k++) {
        const g = bot.findGroundItem(id, 14);
        if (g) await pickup(bot, id, { x: g.x, z: g.z }, 30);
        else if (must) await bot.tick(15);   // all taken: wait for a respawn
    }
    if (has(bot, id)) log(`jangerberries picked up (${bot.tickCount - t0} t)`);
    else if (must) fail(bot, 'jangerberries: no ground spawn on the island');
}
/** the relic on the NW gate guard (2505,3062) -> stage 4 and inside the city */
const segGate2: Seg = async (bot, log) => {
    if (wCity(bot) || inCity(bot) && !inBox(bot, 2540, 3020, 2560, 3040)) return;
    await toGround(bot, log);
    // the NW gate is reached from the east along z~3060 (the slope north of it is cut off): (2509,3062)
    if (cheb(bot.tile(), { x: 2509, z: 3062 }) > 4) await walk(bot, { x: 2509, z: 3062 }, 2, 'NW gate', 600);
    if (!(await useOnNpc(bot, 'relic on guard2', O.relic, N.guard2, () => bot.tile().x <= 2503 && bot.tile().z < 3064, { every: 8, max: 60 }))) fail(bot, 'NW gate (relic)');
    log('inside Gu\'Tanoth (=4)');
    await bot.dropAll([O.relic], 4);   // not needed again (gate2 opens freely from stage 4)
};
/** cake counter (thieving 15; trader2 must be > 3 tiles away), battlement guard ("But I am a friend to ogres..."), cake */
const segCake: Seg = async (bot, log) => {
    const east = () => inBox(bot, 2508, 3005, 2535, 3027);
    if (east()) return;
    if (!has(bot, O.cake)) {
        const counter = locAt(L.counter.id, L.counter.x, L.counter.z, 0);
        // the counter refuses (and the trader attacks) while trader2 is within 3 tiles of US (ogre_trader.rs2:26-30): steal
        // from its north side (2506,3024) when he has wandered to z <= 3020
        const stand = { x: 2506, z: 3024 };
        if (cheb(bot.tile(), stand) > 0) await walk(bot, stand, 0, 'cake counter', 300);
        const ok = await act(bot, 'cake', () => {
            if (cheb(bot.tile(), stand) > 0) { bot.sendRoute([stand]); return; }
            const tr = npc(bot, N.trader2);
            if (tr && cheb(tr, stand) <= 3) return false;
            bot.opLoc(counter.x, counter.z, counter.id, 1); bot.queueFlush();
        }, () => has(bot, O.cake), { every: 2, max: 300 });
        if (!ok) fail(bot, 'rock cake');
        log('rock cake');
    }
    // battlement: first op -> guard3 (within 7) dialog option 1 sets market=1; second op (holding the cake) gives it and climbs
    const ok = await opUntil(bot, 'battlement', L.battlement, 1, east, { stand: { x: 2506, z: 3011 }, answers: [/friend to ogres/i], every: 8, max: 120 });
    if (!ok) fail(bot, 'battlement');
    log('over the battlement');
};
/** chasm jump (guard4 within 8: "Okay, I'll pay it.", 20 gp) -> ledge; death rune on the city guard -> the map (=6) */
const segMap: Seg = async (bot, log) => {
    if (has(bot, O.map)) return;
    const ledge = () => inBox(bot, 2526, 3028, 2550, 3040);
    if (!ledge()) {
        if (!(await opUntil(bot, 'chasm jump', L.jump1, 1, ledge, { stand: { x: 2531, z: 3026 }, answers: [/Okay, I'll pay it/i], every: 8, max: 80 }))) fail(bot, 'chasm jump');
        log('over the chasm');
    }
    if (!(await useOnNpc(bot, 'death rune on city guard', objId('deathrune'), N.cityGuard, () => has(bot, O.map), { every: 8, max: 80 }))) fail(bot, 'city guard map');
    log('skavid map (=6)');
};
/** back: jump2 -> battlement west -> gate2 out */
const segBack: Seg = async (bot, log) => {
    // fix 180 (allchaos qt21fm 'cave5: enter' 270 t at (2545,3032), "I can't reach that!"): the death-rune use on the city guard
    // left us at (2542,3027), one row south of the ledge BOX, so the jump back was skipped and cave 5 was out of reach. The
    // ledge is also the walk region of the chasm landing (2530,3029). WT_LEDGE_REGION=0 reverts.
    const ledge = () => inBox(bot, 2526, 3028, 2550, 3040) || (process.env.WT_LEDGE_REGION !== '0' && sameRegion(bot, { x: 2530, z: 3029 }) && !sameRegion(bot, { x: 2549, z: 3031 }));
    if (ledge() && !(await opUntil(bot, 'jump back', L.jump2, 1, () => !ledge(), { every: 6, max: 40 }))) fail(bot, 'jump back');
    if (inBox(bot, 2508, 3005, 2535, 3027) && !(await opUntil(bot, 'battlement back', L.battlement, 1, () => bot.tile().x <= 2506, { stand: { x: 2508, z: 3011 }, every: 6, max: 60 }))) fail(bot, 'battlement back');
    if (bot.tile().z < 3062 && bot.tile().x <= 2530) await outGate2(bot, log);
};

/** one skavid cave visit: enter (map + lit light), talk to its skavid with the answer, pick up items, exit */
async function cave(bot: SpeedBot, log: (s: string) => void, entry: LocRef, exit: LocRef, talker: number, answers: RegExp[], done: () => boolean, pick: Array<[number, Tile]> = [], label = ''): Promise<void> {
    if (!inCaves(bot)) {
        if (!(await opUntil(bot, `${label} in`, entry, 1, () => inCaves(bot), { every: 8, max: 300 }))) fail(bot, `${label}: enter`);
    }
    if (!done()) {
        const snap = new Map(bot.ifText), t0 = bot.tickCount;
        const ok = await converse(bot, talker, { done: () => done() && bot.chatModalId === -1, answers, maxTicks: 120, tries: 6, label });
        if (!ok) fail(bot, `${label}: talk (${msgsSince(bot, t0).slice(-3).join(' | ')})`);
        void snap;
    }
    for (const [o, at] of pick) if (!has(bot, o)) await pickup(bot, o, at, 60);
    if (!(await opUntil(bot, `${label} out`, exit, 1, () => !inCaves(bot), { every: 6, max: 80 }))) fail(bot, `${label}: exit`);
    log(`${label} done`);
}
const FLAGS = { scared: false, cur: false, ar: false, ig: false, nod: false, pushed: false, bribed: false };
const understood = (bot: SpeedBot, since: number) => msgSince(bot, since, /skavid understood you/i);
/** caves 5 (scared skavid), 4 (Cur), [gate1 push], 3 (Ar), 2 (Ig + nightshade), 1 (Nod), gate1 bribe, 6 (mad skavid + nightshade) */
const segCaves: Seg = async (bot, log) => {
    if (has(bot, O.c2)) return;
    if (!bot.inv().some(s => [33, 594, 32].includes(s.obj))) fail(bot, 'no lit light source for the caves');
    let t = bot.tickCount;
    await cave(bot, log, L.cave5, L.exit5, N.scared, [/Okay, okay, I'm not going to hurt you/i], () => FLAGS.scared || (FLAGS.scared = msgSince(bot, t, /Those will gets you started/i) || [...bot.ifText.values()].some(v => /Those will gets you started/i.test(v))), [], 'cave5');
    t = bot.tickCount; await cave(bot, log, L.cave4, L.exit4, N.talker3, [/^Cur\.$/i], () => FLAGS.cur || (FLAGS.cur = understood(bot, t)), [], 'cave4');
    t = bot.tickCount; await cave(bot, log, L.cave3, L.exit3, N.talker2, [/^Ar\.$/i], () => FLAGS.ar || (FLAGS.ar = understood(bot, t)), [], 'cave3');
    t = bot.tickCount; await cave(bot, log, L.cave2, L.exit2, N.talker1, [/^Ig\.$/i], () => FLAGS.ig || (FLAGS.ig = understood(bot, t)), [[O.nightshade, { x: 2530, z: 9462 }]], 'cave2');
    t = bot.tickCount; await cave(bot, log, L.cave1, L.exit1, N.talker4, [/^Nod\.$/i], () => FLAGS.nod || (FLAGS.nod = understood(bot, t)), [], 'cave1');
    // gate1: the first touch always pushes you to the hill (ogre_guard.rs2:21-28), the second (with the gold bar) lets you in
    const ePocket = () => inBox(bot, 2520, 3005, 2560, 3027);
    for (let k = 0; k < 3 && !ePocket(); k++) {
        const t1 = bot.tickCount;
        if (!npc(bot, N.guard1)) await walk(bot, { x: 2549, z: 3031 }, 3, 'east gate', 300);
        await useOnNpc(bot, 'gold to guard1', objId('gold_bar'), N.guard1, () => ePocket() || msgSince(bot, t1, /pushes you outside/i), { every: 8, max: 120 });
        if (!ePocket()) await bot.tick(2);
    }
    if (!ePocket()) fail(bot, 'east gate (gold bar)');
    log('inside the east pocket');
    // cave 6: the mad skavid (random line; answers: "Ar cur" -> Gor, "Bidith ig" -> Cur, "Cur tanath" -> Bidith, skavid.rs2:165-210)
    if (!inCaves(bot) && !(await opUntil(bot, 'cave6 in', L.cave6, 1, () => inCaves(bot), { stand: { x: 2528, z: 3012 }, every: 8, max: 120 }))) fail(bot, 'cave6: enter');
    await madSkavid(bot, log);
    if (!has(bot, O.c2)) fail(bot, 'mad skavid crystal');
    log('crystal 2 (=7)');
    if (!has(bot, O.nightshade, 2)) await pickup(bot, O.nightshade, { x: 2528, z: 9415 }, 60);
    if (!(await opUntil(bot, 'cave6 out', L.exit6, 1, () => !inCaves(bot), { every: 6, max: 80 }))) fail(bot, 'cave6: exit');
};
/** the mad skavid's line is random(3): read it, answer the matching word; a wrong answer is free (talk again) */
async function madSkavid(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    for (let k = 0; k < 8 && !has(bot, O.c2); k++) {
        const snap = new Map(bot.ifText), t0 = bot.tickCount;
        const line = () => { for (const [kk, v] of bot.ifText) if (snap.get(kk) !== v) { if (/Ar cur/i.test(v)) return /^Gor\.$/i; if (/Bidith ig/i.test(v)) return /^Cur\.$/i; if (/Cur tanath/i.test(v)) return /^Bidith\.$/i; } return null; };
        let opened = false;
        for (let w = 0; w < 40 && !bot.disposed; w++) {
            if (has(bot, O.c2) && bot.chatModalId === -1) break;
            if (bot.chatModalId === -1) {
                if (opened && bot.tickCount - t0 > 4) break;
                if (w % 6 === 0) { const m = npc(bot, N.mad); if (m) opNpcGo(bot, m, 1); }
            } else {
                opened = true;
                const opts = bot.dialogOptions();
                if (opts.length && opts.some(x => x.text)) { const re = line(); if (re) bot.clickDialogByText(re); else bot.clickDialogByText(/^Gor\.$/i); }
                else bot.resumeDialogPage();
                bot.queueFlush();
            }
            await bot.tick(1);
        }
        log(`mad skavid try ${k + 1}: ${has(bot, O.c2) ? 'crystal' : 'wrong'}`);
    }
}
/** nightshade on the enclave guard (=8 first time) -> into the enclave; leave by the enclave cave (-> 2540,3054) */
let NS_TESTED = false;
async function enclaveIn(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    if (inEnclave(bot)) return;
    // session 11 fix 265 (qx10m: an engine-restart drop during enclave1's 'nightshade on guard' -> the re-sent use spent the
    // 2nd nightshade; 'no nightshade' at shamans and every retry threw in 0 t): with none held, refill from the cave 2 ground
    // spawn (2530,9462; respawns) before the gates. WT_NS_REFILL=0 reverts.
    // TEST (WT_NS_TEST=1): the 2nd enclave entry (shamans) starts with the nightshade dropped, once per process
    if (process.env.WT_NS_TEST === '1' && has(bot, O.magicPotion) && !NS_TESTED) { NS_TESTED = true; for (const sl of bot.inv()) if (sl.obj === O.nightshade) bot.dropItem(sl.obj, sl.slot); bot.queueFlush(); await bot.until(() => !has(bot, O.nightshade), 6); log('TEST: nightshade dropped'); }
    if (!has(bot, O.nightshade) && process.env.WT_NS_REFILL !== '0') {
        if (bot.minusedlevel !== 0) await toGround(bot, log);
        if (inBox(bot, 2520, 3005, 2560, 3027) && !(await opUntil(bot, 'gate1 out', { id: 2787, x: 2549, z: 3028 }, 1, () => bot.tile().z >= 3028, { stand: { x: 2549, z: 3027 }, every: 6, max: 60 }))) fail(bot, 'gate1 out');
        await cave(bot, log, L.cave2, L.exit2, N.talker1, [], () => true, [[O.nightshade, { x: 2530, z: 9462 }]], 'cave2 nightshade refill');
    }
    if (!has(bot, O.nightshade)) fail(bot, 'no nightshade');
    // E pocket -> gate1 opens freely now; hill -> gate2 (stage >= 4) -> enclave guard
    // gate1 leaves are on the south edge of z3028: (2549,3027) -> op the right leaf (2549,3028) -> (2549,3028) outside
    if (inBox(bot, 2520, 3005, 2560, 3027) && !(await opUntil(bot, 'gate1 out', { id: 2787, x: 2549, z: 3028 }, 1, () => bot.tile().z >= 3028, { stand: { x: 2549, z: 3027 }, every: 6, max: 60 }))) fail(bot, 'gate1 out');
    if (!wCity(bot)) {
        if (bot.minusedlevel !== 0) await toGround(bot, log);
        if (!(await opUntil(bot, 'gate2 in', L.gate2, 1, () => bot.tile().x <= 2503 && bot.tile().z <= 3063, { stand: { x: 2504, z: 3062 }, every: 6, max: 300 }))) fail(bot, 'gate2 in');
    }
    if (!npc(bot, N.enclaveGuard) || cheb(bot.tile(), { x: 2507, z: 3038 }) > 8) await walk(bot, { x: 2508, z: 3038 }, 2, 'enclave guard', 300);
    if (!(await useOnNpc(bot, 'nightshade on guard', O.nightshade, N.enclaveGuard, () => inEnclave(bot), { every: 8, max: 120 }))) fail(bot, 'enclave guard');
    log('in the enclave');
}
async function enclaveOut(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    if (!inEnclave(bot)) return;
    if (!(await opUntil(bot, 'enclave exit', L.enclaveExit, 1, () => !inEnclave(bot), { every: 6, max: 200 }))) fail(bot, 'enclave exit');
    log('out of the enclave');
}
const segEnclave1: Seg = async (bot, log) => { await enclaveIn(bot, log); await enclaveOut(bot, log); };
/** wizard (=9), brew the potion on the spot (guam+vial, berries, bones: ogre_potion.rs2), give it (=10, magic potion) */
const segPotion: Seg = async (bot, log) => {
    if (has(bot, O.magicPotion)) return;
    await toTop(bot, log);
    await wizard(bot, /potion|guam/i, [], 'learn potion');
    const mix = async (a: string | number, b: string | number, want: number) => {
        const A = objId(a), B = objId(b);
        if (has(bot, want)) return;
        if (!(await act(bot, `mix ${objDebugName(A)}`, () => { const sa = bot.slot(A), sb = bot.slot(B); if (sa < 0 || sb < 0) return false; bot.useItemOnItem(B, sb, A, sa); bot.queueFlush(); }, () => has(bot, want), { every: 4, max: 20 }))) fail(bot, `mix -> ${want}`);
    };
    await mix('guam_leaf', 'vial_water', O.guamvial);          // guam used on the water -> unfinished guam
    await mix('jangerberries', O.guamvial, O.guamjanger);       // berries used on it
    await mix('ground_bat_bones', O.guamjanger, O.potion);      // the BONES must be the used item (ogre_potion.rs2:36-54)
    log('ogre potion');
    await useOnWizard(bot, O.potion, () => has(bot, O.magicPotion), 'potion');
    log('magic ogre potion (=10)');
};
/** enclave: the potion on 6 shamans (crystal 3 on the 6th), mine the Rock of Dalgroth (crystal 4), out */
const segShamans: Seg = async (bot, log) => {
    if (has(bot, O.c3) && has(bot, O.c4)) return;
    await enclaveIn(bot, log);
    // session 11 fix 292 (CONFIRMED qx47m: 'shaman 3' at hp 38/76 by (2601,9437), 11 t later dead at (2605,9447) with "You're
    // horribly burnt by the dragon fire!"; a blue dragon spawns at (2604,9443) (m40_147: 6 blue dragons among the shamans).
    // Unprotected dragon fire hits up to 50 (dragon.rs2 dragon_fire), the 50% eater does not eat at 38/76, so one breath killed
    // us with 7 sharks in the pack; other runs also sit at 38-45 hp here):
    //  292a WT_SHAMAN_EAT: eat below 75% in the enclave (one breath can no longer kill from there);
    //  292b WT_SHAMAN_PRAY: Protect from Magic in the enclave (dragon fire max 50 -> 10; level 37 needed, prayer 47 here);
    //  292c WT_SHAMAN_ESCAPE: low hp with no food -> leave by the enclave exit and fail (the retry re-supplies); dead -> fail now.
    // Each =0 reverts. TEST (WT_DRAGON_TEST=1): once per process, stand next to the blue dragon (2604,9443) for 30 t first.
    const eat292 = process.env.WT_SHAMAN_EAT !== '0', pray292 = process.env.WT_SHAMAN_PRAY !== '0', esc292 = process.env.WT_SHAMAN_ESCAPE !== '0';
    const stopEat292 = eat292 ? eatWatch(bot, 0.75) : () => { };
    let prayOn = pray292 && bot.stat('prayer').level >= 37;
    if (pray292) log(`fix 292: hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level} prayer ${bot.stat('prayer').cur}/${bot.stat('prayer').level} sharks ${bot.count('shark')}`);
    void (async () => {
        while (prayOn && !bot.disposed) {
            if (!bot.isPrayerActive('protectfrommagic') && bot.stat('prayer').cur > 0 && inEnclave(bot)) { bot.activatePrayer('protectfrommagic'); bot.queueFlush(); }
            await bot.tick(3);
        }
    })();
    try {
    if (process.env.WT_DRAGON_TEST === '1' && !DRAGON_TESTED) {
        DRAGON_TESTED = true;
        await bot.walkTo(2603, 9447, { near: 1, maxTicks: 60, log: false });
        const h0 = bot.stat('hitpoints').cur, s0 = bot.count('shark'), tt = bot.tickCount;
        await bot.tick(30);
        log(`TEST 292: 30 t by the blue dragon at ${JSON.stringify(bot.tile())}: hp ${h0} -> ${bot.stat('hitpoints').cur}, sharks ${s0} -> ${bot.count('shark')}, msgs ${msgsSince(bot, tt).filter(m => /dragon|fire|shield/i.test(m)).slice(-3).join(' | ')}`);
    }
    // route runner: 10 tries ran out while waiting for shamans to respawn (sims qre2m/qre4m: 6 kills logged,
    // one potion use missed): up to 40 tries, a 5-tick wait when none is in view
    for (let k = 0; k < 40 && !has(bot, O.c3); k++) {
        if (esc292 && dead(bot)) fail(bot, 'died at the shamans');
        if (esc292 && bot.stat('hitpoints').cur <= bot.stat('hitpoints').level * 0.4 && foodCount(bot) === 0) {
            log(`fix 292c: hp ${bot.stat('hitpoints').cur} and no food: out of the enclave`);
            await enclaveOut(bot, log); fail(bot, 'shamans: low hp, no food (escaped)');
        }
        const t0 = bot.tickCount;
        let sh = npc(bot, N.shaman);
        if (!sh) { await bot.walkTo(2592, 9440, { near: 4, maxTicks: 60, log: false }); sh = npc(bot, N.shaman); }
        if (!sh) { await bot.tick(5); continue; }
        await useOnNpc(bot, 'potion on shaman', O.magicPotion, N.shaman, () => msgSince(bot, t0, /dissolves/i) || has(bot, O.c3), { every: 6, max: 40 });
        log(`shaman ${k + 1}`);
    }
    if (!has(bot, O.c3)) fail(bot, 'crystal 3 (6 shamans)');
    if (!has(bot, O.c4) && !(await opUntil(bot, 'rock of dalgroth', L.rock, 2, () => has(bot, O.c4), { every: 8, max: 80 }))) fail(bot, 'crystal 4');
    log('crystals 3 + 4');
    await enclaveOut(bot, log);
    } finally {
        stopEat292();
        if (prayOn) { prayOn = false; if (bot.isPrayerActive('protectfrommagic')) { bot.deactivatePrayer('protectfrommagic'); bot.queueFlush(); } }
    }
};
let DRAGON_TESTED = false;
/** wizard (=11) and the lever (=13, qp +4), then read the scroll (=14) */
const segFinish: Seg = async (bot, log) => {
    const q0 = qp(bot);
    await toTop(bot, log);
    await wizard(bot, /all the crystals|Throw the lever|not activated/i, [], 'crystals');
    if (!(await opUntil(bot, 'lever', L.lever, 1, () => qp(bot) >= q0 + QUEST.qp || has(bot, O.scroll), { every: 6, max: 40 }))) fail(bot, 'lever');
    // read the spell scroll (=14: Watchtower Teleport learnt, quest_itwatchtower.rs2:554-559); the wizard's lines may be open
    await bot.until(() => has(bot, O.scroll), 10);
    await act(bot, 'read scroll', () => { const sl = bot.slot(O.scroll); if (sl < 0) return false; bot.opHeld1(O.scroll, sl); bot.queueFlush(); }, () => !has(bot, O.scroll) && bot.chatModalId === -1, { every: 4, max: 30 });
    log(`QUEST COMPLETE (qp ${q0} -> ${qp(bot)})`);
};

export const SEGMENTS: Array<[string, Seg]> = [['start', segStart], ['nails', segNails], ['wiz2', segWiz2], ['og1', segOg1], ['grew1', segGrew1],
    ['toban', segToban], ['og2', segOg2], ['grew2', segGrew2], ['relic', segRelic], ['gate2', segGate2], ['cake', segCake], ['map', segMap],
    ['back', segBack], ['caves', segCaves], ['enclave1', segEnclave1], ['potion', segPotion], ['shamans', segShamans], ['finish', segFinish]];

export async function run(bot: SpeedBot, o: { log?: boolean; from?: string } = {}): Promise<RunResult> {
    await nav();
    await addWalls(GATE_WALLS);
    bot.holdDialogs = true;
    const log = mkLog(bot, 'wt', o.log !== false);
    const t0 = bot.tickCount, splits: Record<string, number> = {}, q0 = qp(bot);
    trace(bot, t0);
    const stopEat = eatWatch(bot, 0.5);
    let started = !o.from;
    try {
        for (const [name, seg] of SEGMENTS) {
            if (!started && name === o.from) started = true;
            if (!started) continue;
            const s0 = bot.tickCount;
            await seg(bot, log);
            if (dead(bot)) return { ok: false, ticks: bot.tickCount - t0, msg: `died in ${name}`, splits };
            splits[name] = bot.tickCount - s0;
            log(`== ${name} done in ${splits[name]} t`);
            if (process.env.WT_TO === name) return { ok: false, ticks: bot.tickCount - t0, msg: `stopped after ${name} (WT_TO)`, splits };
        }
    } finally { stopEat(); }
    const ok = qp(bot) >= q0 + QUEST.qp;
    return { ok, ticks: bot.tickCount - t0, msg: ok ? 'lever pulled: Watch Tower complete' : `not finished (${situation(bot, 3)})`, splits };
}
void npcsOf; void opNpcGo; void eatNow; void P;

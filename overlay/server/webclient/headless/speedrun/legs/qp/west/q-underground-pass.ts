// q-underground-pass.ts — UNDERGROUND PASS (5 QP), cheat-free. West lane.
//
// Content: ~/sim/rs-qp/server/content/scripts/quests/quest_upass/** (rev 289). Coordinates from the m*_*.jm2 map dumps
// (map square mx_mz, script coord L_mx_mz_lx_lz = (mx*64+lx, mz*64+lz)). Stage constants: quest_upass.constant.
// Quest varps (%upass, %ibanmulti) are NOT transmitted: every step gates on observables (position, items, messages).
//
// Segments (each re-checks its own start state, so a missed click never desyncs the sequence):
//   lathas   King Lathas (E Ardougne castle L1) starts it: %ibanmulti started bit + the per-player grid (king_lathas.rs2:88-110)
//   enter    Koftik at the cave (2436,3315): oploc the entrance -> his dialog (=1) -> oploc again -> (2494,9716)
//   bridge   3 rockslides to Koftik #2 (damp cloth), cloth+arrow, tinderbox, wield bow + fire arrow, shoot the guide
//            rope (aploc, ranged roll 160/300) -> the bridge falls, (2442,9716) (=2) (upass_bridge.rs2:35-79)
//   ... (further segments added as they are built)
import { SpeedBot, objId, objDebugName, cheb, LOG_DIR } from '../../../core.js';
// @ts-ignore -- the webclient tsconfig has no node types (bun provides fs/path at runtime)
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
// @ts-ignore
import { resolve, dirname } from 'path';
declare const process: { env: Record<string, string | undefined> };
import { nav, npc, npcsOf, opNpcGo, inDialog, walkOp, locAt, msgsSince, dismiss, opLocGo, routeToLoc, trace, navSync, turning, tele, dropAllOf, situation, type Tile } from '../../q-lib.js';
import { densify } from '../../../core.js';
import { failHook } from '../journal.js';
import { act, converse, fail, fight, mkLog, wear, eatNow, eatWatch, dead, msgSince, answer, walk, pickup, unequipExcept, wornIds, qp, foodIds, foodCount, type Item, type RunResult } from './we-lib.js';

export const QUEST = { name: 'Underground Pass', dir: 'quest_upass', qp: 5 };
export const REQUIREMENTS = {
    quests: ['Biohazard'],
    qp: 0,
    skills: {
        ranged: [25, 'King Lathas refuses below stat_base(ranged) 25 (king_lathas.rs2:95)'],
        thieving: [50, 'cage lock cave_railings5 stat(thieving) 50 (quest_upass.rs2:248)'],
    } as Record<string, [number, string]>,
    start: { x: 2573, z: 3296, level: 0 },   // East Ardougne castle, at the foot of the stairs to King Lathas
    end: { x: 2578, z: 3292, level: 1 },
};
export const WEAPON = process.env.UPASS_WEAPON ?? 'dragon_longsword';
/** combat spell for the 7 kills (paladins/demons magicdefence -10: magic always lands); '' = melee with WEAPON */
export const SPELL = process.env.UPASS_SPELL ?? 'fire_wave';
export const SPELL_RUNES: Record<string, Item[]> = {
    // session 11 fix 341b (UP_RUNE80=0 reverts to 70): 70 casts was exact for the 7 kills (healthy runs end 10-25 spare,
    // qx127m ran dry before Kalrag); +10 casts (runes stack: no slot cost)
    fire_wave: process.env.UP_RUNE80 === '0' ? [{ name: 'bloodrune', n: 70 }, { name: 'firerune', n: 490 }, { name: 'airrune', n: 350 }]
        : [{ name: 'bloodrune', n: 80 }, { name: 'firerune', n: 560 }, { name: 'airrune', n: 400 }],   // magic 75, max 20
    fire_blast: [{ name: 'deathrune', n: 80 }, { name: 'firerune', n: 400 }, { name: 'airrune', n: 320 }],  // magic 59, max 16
};
export const SUPPLY: Item[] = [
    { name: 'shortbow', n: 1 }, { name: 'bronze_arrow', n: 5 }, { name: 'tinderbox', n: 1 },
    { name: 'rope', n: 1 }, { name: 'spade', n: 1 }, { name: 'bucket_empty', n: 1 },
    { name: 'shark', n: 15 }, { name: 'zamrobetop', n: 1 }, { name: 'zamrobebottom', n: 1 },
    { name: 'lawrune', n: 2 }, { name: 'waterrune', n: 2 },
    ...(SPELL ? SPELL_RUNES[SPELL] ?? [] : [{ name: WEAPON, n: 1 }]),
];
// session 11 fix 341 (UP_RUNE_MELEE; qx127m 'died in tombkalrag' hp 0): SPELL_RUNES was exactly 70 fire_wave casts for the
// 7 kills (healthy runs end 10-25 casts spare); qx127m's paladins (228 t) and demons (356 t) ate more and it reached Kalrag
// with none: 'You do not have enough Blood Runes' x25, fight() re-sent the cast every 5 t for 400 t while Kalrag + the
// spiders ate all the food (hp 56 -> 0). Fix: a cast that cannot be paid for falls back to melee with the worn WEAPON
// (dragon_longsword, re-worn by fix 280). UP_RUNE_MELEE=0 reverts. TEST: UP_RUNE_TEST=1 treats the runes as spent at Kalrag.
const SPELL_COST: Record<string, Record<string, number>> = {   // magic_combat_spells.dbrow runesrequired
    fire_wave: { bloodrune: 1, firerune: 7, airrune: 5 }, fire_blast: { deathrune: 1, firerune: 5, airrune: 4 } };
const canCast = (bot: SpeedBot, spell: string) => Object.entries(SPELL_COST[spell] ?? {}).every(([r, n]) => bot.count(objId(r)) >= n);
async function upFight(bot: SpeedBot, type: number, o: NonNullable<Parameters<typeof fight>[2]>, test = false): Promise<boolean> {
    if (process.env.UP_RUNE_MELEE === '0' || !o.spell) return fight(bot, type, o);
    const can = () => !test && canCast(bot, o.spell!);
    if (can()) {
        const r = await fight(bot, type, { ...o, done: () => (o.done?.() ?? false) || !can() });
        if (dead(bot) || can() || o.done?.()) return r;
    }
    const w = objId(WEAPON);
    if (!bot.isWorn(w) && has(bot, w)) await wear(bot, w);
    console.log(`[upass] 341: out of ${o.spell} runes -> melee ${type} (${WEAPON} worn ${bot.isWorn(w)})`);
    return fight(bot, type, { ...o, spell: undefined });
}

// ---- ids (content/pack) ----------------------------------------------------------------------------------------------
export const N = { lathas: 364, koftik1: 972, koftik2: 973, koftik3: 974, koftik4: 975, koftik5: 976, boulder: 986, paladins: [988, 989, 990],
    nilhoof: 994, klank: 995, cat: 993, kalrag: 997, othainian: 998, doomion: 999, holthion: 1000, iban: 1003 } as const;
export const L = {
    caveEntrance: { id: 3213, x: 2433, z: 3313 },      // upass_caveentrance2
    guideRope: { id: 3340, x: 2443, z: 9718 },         // oldbridge_guiderope (aploc1 Fire-at)
    rockslide: 3309,                                   // rockslide2_obstacle_upass (op1 Climb-over, agility 160/300)
    swingRock: { id: 2276, x: 2460, z: 9699 },         // loc_2276: rope on it -> forcemove (2462,9699), swing to (2466,9699)
    handholds: { id: 3365, x: 2395, z: 9559 },         // upass_grilltrap_hand_holds: out of the grid pit -> (2477,9677)
    lever: { id: 3337, x: 2466, z: 9672 },             // portcullis_lever_up: forcemoves us west through the portcullis
    furnace: { id: 3294, x: 2454, z: 9682 },           // furnace_upass: orb on it -> %ibanmulti orb bit (smelting.rs2:17-18)
    well: { id: 3264, x: 2416, z: 9674 },              // cave_well: all 4 orb bits -> (2423,9660) area 2 (=3)
    logtrap: { id: 3339, x: 2382, z: 9668 },           // upass_logtrap_trigger: Search + "Yes" + thieving 160/300 -> caveorb1
    cage2: { id: 3266, x: 2393, z: 9655 },             // cave_railings2 (south door of the slave-cage row): pick 128/400
    mud: { id: 3216, x: 2393, z: 9650 },               // upass_mud: spade -> (2392,9646)
    ledge: { id: 3238, x: 2374, z: 9644 },             // upass_ledge (x2374 z9639-9644): agility 200/260, fail = rat pit 5 hp
    cage5a: { id: 3268, x: 2380, z: 9619 },            // cave_railings5: thieving 50 + 128/400
    cage5b: { id: 3268, x: 2404, z: 9620 },
    pipe6: { id: 3237, x: 2417, z: 9605 },             // upass_pipe6 (east end): crawl west, +1 telejump before the unicorn dies
    railing3: { id: 3267, x: 2397, z: 9605 },          // cave_railings3 op2 Search -> caverailing
    cageRemains: { id: 3308, x: 2371, z: 9603 },       // unicorncage_destroyed_upass op1 -> cave_unicorn_horn
    unicornDoorW: { id: 3219, x: 2375, z: 9611 },      // upass_unicorn_doorl (west copy) -> telejump (2371,9666)
    bloodwell: { id: 3305, x: 2373, z: 9718 },         // bloodwell_upass: horn + 3 badges -> the skull door unlocks
    templeDoor2: { id: 3220, x: 2368, z: 9717 },       // cavetempledoor2l -> L1 (2173,4725) (=5)
} as const;
export const O = { caveorb1: 1481, caveorb2: 1482, caveorb3: 1483, caveorb4: 1484, railing: 1486, horn: 1487, badge1: 1488, badge2: 1489, badge3: 1490,
    cat: 1491, doll: 1492, dove: 1496, oAmulet: 1497, dAmulet: 1498, hAmulet: 1499, shadow: 1500, brew: 1501, ashes: 1502, bucket: 1925, spade: 952 } as const;
export const T = {
    lathas: { x: 2577, z: 3293 }, koftikOut: { x: 2436, z: 3315 }, entry: { x: 2494, z: 9716 },
    koftik2: { x: 2449, z: 9716 }, shoot: { x: 2444, z: 9721 }, landing: { x: 2442, z: 9716 },
    swingStand: { x: 2459, z: 9699 }, swingLand: { x: 2466, z: 9699 },
    gridEast: { x: 2477, z: 9677 }, gridWest: { x: 2466, z: 9677 },
    orb2: { x: 2386, z: 9677 }, orb3: { x: 2385, z: 9685 }, orb4: { x: 2416, z: 9698 },
    area2: { x: 2423, z: 9660 },
} as const;
const ROCKS_TO_GRID = [
    { loc: { x: 2491, z: 9691 }, from: { x: 2491, z: 9692 }, to: { x: 2491, z: 9690 } },
    { loc: { x: 2482, z: 9679 }, from: { x: 2483, z: 9679 }, to: { x: 2481, z: 9679 } },
];
/** rockslide route entry -> Koftik #2: [loc x,z, stand side, landing side] (region probe: probe-regions.ts) */
const ROCKS_NORTH = [
    { loc: { x: 2478, z: 9721 }, from: { x: 2479, z: 9721 }, to: { x: 2477, z: 9721 } },
    { loc: { x: 2467, z: 9723 }, from: { x: 2468, z: 9723 }, to: { x: 2466, z: 9723 } },
    { loc: { x: 2460, z: 9720 }, from: { x: 2460, z: 9721 }, to: { x: 2460, z: 9719 } },
];
const ROCKS_SOUTH = [
    { loc: { x: 2480, z: 9713 }, from: { x: 2480, z: 9714 }, to: { x: 2480, z: 9712 } },
    { loc: { x: 2471, z: 9706 }, from: { x: 2472, z: 9706 }, to: { x: 2470, z: 9706 } },
    { loc: { x: 2458, z: 9712 }, from: { x: 2458, z: 9711 }, to: { x: 2458, z: 9713 } },
];

/** Revisit mode (Regicide: back through the pass to Iban's temple after the quest): orbs, horn, paladins and the doll are
 *  done and stay done (%ibanmulti bits), so those steps are skipped; the temple door then sends us west. */
export const MODE = { revisit: false };
/** 305d re-entry after a retry from outside: what the earlier attempt finished stays done in the game (%ibanmulti orb bits;
 *  the horn + badges in the blood well) */
const RE = { orbsDone: false, area2Done: false, paladinsDone: false, nilhoofDone: false, dollDone: false };
// session 11 fix 379a/379b (UP_CAT_GONE / UP_NIL_RE): one-time steps this process saw done in the game ('<acct>:cat' =
// %ibanmulti dropped_cat, '<acct>:nilhoof' = %upass 6); kept across route retries (the module stays loaded)
const GAME = new Set<string>();
const who = (bot: SpeedBot) => String(bot.loginUser ?? '').toLowerCase();
// session 11 fix 401c (UP_DOLL_NIL): the doll was found (%upass >= 7: this process saw the chest give it = '<acct>:doll', or the
// resume is past 'doll') but none is held (a death drops it; one of a kind) -> Nilhoof hands a new one (nilhoof.rs2:27-36)
const dollLost = (bot: SpeedBot) => process.env.UP_DOLL_NIL !== '0' && !has(bot, O.doll) && (RE.dollDone || GAME.has(`${who(bot)}:doll`));
/** The grid digits are per player and fixed at King Lathas (king_lathas.rs2:105): remember them per account so a later
 *  pass (Regicide) walks straight across. logs/west/upass-grid.json = { <account>: "345" } */
const GRID_FILE = resolve(LOG_DIR, '../west/upass-grid.json');
export function savedGrid(acct: string): string | null {
    try { const v = JSON.parse(readFileSync(GRID_FILE, 'utf8'))[acct.toLowerCase()]; return typeof v === 'string' && /^[1-5]{3}$/.test(v) ? v : null; } catch { return null; }
}
export function saveGrid(acct: string, g: string): void {
    try {
        mkdirSync(dirname(GRID_FILE), { recursive: true });
        let db: Record<string, string> = {};
        try { db = JSON.parse(readFileSync(GRID_FILE, 'utf8')); } catch { db = {}; }
        db[acct.toLowerCase()] = g; writeFileSync(GRID_FILE, JSON.stringify(db, null, 1));
    } catch { /* best effort */ }
}
export const underground = (bot: SpeedBot) => bot.tile().z > 6400;
/** Iban's lair (L1 x 2040-2200, z 4540-4760; the Well of Voyage side is x < 2100): part of the pass although z < 6400 (305d) */
const inLair = (bot: SpeedBot) => { const t = bot.tile(); return t.x >= 2040 && t.x <= 2200 && t.z >= 4540 && t.z <= 4760; };
const inArea1 = (bot: SpeedBot) => { const t = bot.tile(); return t.z >= 9590 && t.z <= 9730 && t.x >= 2370 && t.x <= 2500 && bot.minusedlevel === 0; };
export const has = (bot: SpeedBot, o: string | number, n = 1) => bot.count(objId(o)) >= n;
const litArrowIds = () => ['litarrow', 'iron_litarrow', 'steel_litarrow', 'mithril_litarrow', 'adamant_litarrow', 'rune_litarrow'].map(objId);
const unlitArrowIds = () => ['unlitarrow', 'iron_unlitarrow', 'steel_unlitarrow', 'mithril_unlitarrow', 'adamant_unlitarrow', 'rune_unlitarrow'].map(objId);
const arrowIds = () => ['bronze_arrow', 'iron_arrow', 'steel_arrow', 'mithril_arrow', 'adamant_arrow', 'rune_arrow'].map(objId);

/** climb one rockslide from `from` to `to` (agility roll: a slip costs 3 hp and leaves us on `from`) */
async function climbRock(bot: SpeedBot, r: typeof ROCKS_NORTH[number], log: (s: string) => void): Promise<void> {
    const loc = locAt(L.rockslide, r.loc.x, r.loc.z, 0);
    // session 11 fix 305a (UP_ROCK_ROUNDS; qx66m 'rockslide 2467,9723 at (2468,9723)': the 80 t budget ran out the moment the
    // walk reached the stand tile, no 'You climb onto the rock' ever. CONFIRMED cause: the process's event loop was blocked
    // ~14 s by the helper's travel plan into the Gnome Stronghold ('[helper] ... (2465,3489): none (est Infinity t)' logged
    // right then; engine 'tick 23000: 71/500 ticks ran on the 200 ms deadline without an ack (qx66m 71)'), so 71 of the 80
    // ticks passed with no client; qx67m lost ~27 t the same way and crossed after 67 t). A budget is not proof of failure:
    // up to 3 rounds, a new round only while the rock is not crossed; between rounds step back onto `from`. =0 reverts.
    // TEST: UP_ROCK_TEST=1 gives the first round of the 2nd north rock 1 t (a lost round).
    const rounds = process.env.UP_ROCK_ROUNDS === '0' ? 1 : 3;
    const crossed = () => cheb(bot.tile(), r.to) === 0;
    for (let k = 0; k < rounds && !crossed(); k++) {
        const test = process.env.UP_ROCK_TEST === '1' && k === 0 && r.loc.x === 2467 && !(globalThis as any).__upRockTest;
        if (test) { (globalThis as any).__upRockTest = 1; log('305a TEST: round 1 of rock 2467,9723 gets 1 t'); }
        const ok = await act(bot, `rock ${r.loc.x},${r.loc.z}`, () => { opLocGo(bot, loc, 1, r.from); }, crossed, { every: 6, max: test ? 1 : 80 });
        if (ok) break;
        if (k + 1 < rounds) { log(`305a rock ${r.loc.x},${r.loc.z}: round ${k + 1} ran out at (${bot.tile().x},${bot.tile().z}): another round`); await bot.tick(2); }
    }
    if (!crossed()) fail(bot, `rockslide ${r.loc.x},${r.loc.z}`);
    log(`rock ${r.loc.x},${r.loc.z} crossed`);
}

/** reach King Lathas through the throne-room door (loc_1536, west edge of (2575,3293)) and talk until `done` */
export async function talkLathas(bot: SpeedBot, done: () => boolean, log: (s: string) => void): Promise<boolean> {
    for (let k = 0; k < 4 && !done(); k++) {
        await openDoor(bot, { id: 1536, x: 2575, z: 3293 }, { x: 2574, z: 3293 }, 1);
        if (await converse(bot, N.lathas, { done, stand: { x: 2576, z: 3293 }, near: 3, maxTicks: 50, tries: 3, label: 'lathas' })) return true;
        log(`lathas: no dialog yet (${situation(bot, 4)})`);
        // an open leaf can wall off the way in (core walkTo note): shut what stands open next to us, re-open properly
        await bot.closeBlockingDoor();
    }
    return done();
}

/** open a (wall) door from `stand` if it is still the closed loc there; returns when it is gone from its tile */
export async function openDoor(bot: SpeedBot, d: { id: number; x: number; z: number }, stand: Tile, level: number): Promise<void> {
    // the door tracker follows the live zone stream (an opened door is a LOC_DEL here + its open pair nearby)
    const closed = () => !!bot.doorTracker?.closedDoorAt(level, d.x, d.z);
    if (!closed()) return;
    if (cheb(bot.tile(), stand) > 0) await bot.walkTo(stand.x, stand.z, { level, maxTicks: 60, log: false });
    for (let k = 0; k < 4 && closed(); k++) { bot.opLoc(d.x, d.z, d.id, 1); bot.queueFlush(); await bot.until(() => !closed(), 3); }
}

/** PAUSED item 3: 'walk to castle stairs' stalled ~2 in 10 runs: from the Ardougne teleport landing the
 *  multi-level walk never started a travel (no plan line, 0 tiles) and sat 1,500 t near (2660,3300) (SCENARIO-HARNESS.md).
 *  Now as Regicide does it: a same-level walk to the castle's double door (2576,3298), open it, the stairs (L0 2571,3295) by
 *  hand; the multi-level walk only as the fallback. UP_CASTLE_HAND=0 reverts. */
async function castleUp(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    if (bot.minusedlevel === 1) return;
    if (process.env.UP_CASTLE_HAND !== '0' && bot.minusedlevel === 0) {
        const t0 = bot.tickCount;
        if (bot.tile().x >= 2577) await bot.walkTo(2577, 3298, { near: 1, maxTicks: 300, log: false });
        if (bot.tile().x >= 2576) await openDoor(bot, { id: 2546, x: 2576, z: 3298 }, { x: 2576, z: 3298 }, 0);
        await opUntil(bot, 'castle stairs up', { id: 1722, x: 2571, z: 3295 }, 1, () => bot.minusedlevel === 1, { stand: { x: 2572, z: 3298 }, every: 5, max: 80 });
        log(`castle stairs by hand: level ${bot.minusedlevel} in ${bot.tickCount - t0} t`);
    }
    if (bot.minusedlevel !== 1) await walk(bot, { x: 2572, z: 3294, level: 1 }, 3, 'castle stairs');
}

// ---- segments --------------------------------------------------------------------------------------------------------
type Seg = (bot: SpeedBot, log: (s: string) => void) => Promise<void>;

/** King Lathas: biohazard complete + ranged base 25 -> "Go meet my main tracker, Koftik." */
const segLathas: Seg = async (bot, log) => {
    if (underground(bot)) return;
    // up the castle stairs (L0 2571,3295 -> L1 2571,3294); converse() routes the last tiles to the king itself
    await castleUp(bot, log);
    // the dialog runs 5 pages a tick, so intermediate pages never show: the LAST page ("...lethal...") stays up
    const snap = new Map(bot.ifText);
    const said = () => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v && /lethal|how are you managing/i.test(v)) return true; return false; };
    let saw = false;
    // the throne-room door loc_1536 (west edge of 2575,3293, closed) is in the way and neither walker opens it reliably:
    // open it from (2574,3293) unless the zone stream already shows it open (liveLocs), then walk in
    const ok = await talkLathas(bot, () => { if (said()) saw = true; return saw && bot.chatModalId === -1; }, log);
    if (!ok) fail(bot, 'King Lathas: no start dialog (Biohazard done? ranged base 25?)');
    log('lathas: started');
};

/** Koftik at the cave: the first entrance op opens his dialog (=1), the second takes us in. */
const segEnter: Seg = async (bot, log) => {
    if (underground(bot)) return;
    const ent = locAt(L.caveEntrance.id, L.caveEntrance.x, L.caveEntrance.z, 0);
    // out of the throne room and down the castle stairs by hand (with the door shut the multi-level planner detours over
    // another castle ladder on L1 and wedges)
    if (bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2572, z: 3294 }) < 12) {
        await openDoor(bot, { id: 1536, x: 2575, z: 3293 }, { x: 2575, z: 3293 }, 1);
        if (!(await opUntil(bot, 'stairs down', { id: 1723, x: 2571, z: 3295 }, 1, () => bot.minusedlevel === 0, { level: 1, stand: { x: 2572, z: 3294 }, every: 5, max: 40 }))) fail(bot, 'castle stairs down');
    }
    // East -> West Ardougne: the city wall doors (shape-10 locs x2557-2558 z3299-3300, so the planners see a wall) open for
    // Biohazard-complete players and forcemove 2 tiles west (area_ardougne_west/scripts/doors.rs2:24-49)
    if (bot.tile().x >= 2559 && bot.tile().z > 3200 && bot.tile().z < 3400) {
        if (!(await opUntil(bot, 'city wall door', { id: 2049, x: 2558, z: 3300 }, 1, () => bot.tile().x <= 2556, { stand: { x: 2559, z: 3300 }, every: 6, max: 60 }))) fail(bot, 'West Ardougne wall door');
        log('through the West Ardougne wall door');
    }
    if (cheb(bot.tile(), T.koftikOut) > 8) await walk(bot, { ...T.koftikOut, level: 0 }, 3, 'Koftik at the cave', 2000);
    // the entrance is 2x4 (x2433-2434, z3313-3316): stand east of it (rsmod's reach test misjudges the rotated footprint)
    const ok = await act(bot, 'enter', () => { opLocGo(bot, ent, 1, { x: 2435, z: 3315 }); }, () => underground(bot), { answers: [/take my chances/i], every: 6, max: 120 });
    if (!ok) fail(bot, 'cave entrance');
    log('entered the pass');
};

/** Koftik #2 cloth -> fire arrow -> shoot the guide rope -> across the bridge. */
const segBridge: Seg = async (bot, log) => {
    const across = () => bot.tile().x <= T.landing.x && inArea1(bot) && bot.tile().z > 9700;
    // swing landing (2466,9699), and the rockslides were climbed from the wrong side: 'rockslide 2478,9721', "I can't reach
    // that!"). Walkable to the bridge landing or the swing landing on the navgrid = past the bridge (the rocks, the bridge and
    // the swing are scripted crossings the navgrid never walks).
    const reach = (b: Tile) => { const t = bot.tile(); if (t.x === b.x && t.z === b.z) return true; try { const p = navSync().findLongPath(0, t.x, t.z, b.x, b.z, 4000); const e = p[p.length - 1]; return !!e && e.x === b.x && e.z === b.z; } catch { return false; } };
    if (across()) return;
    if (inArea1(bot) && bot.tile().z <= 9712 && (reach(T.landing) || reach(T.swingLand))) { log(`resume past the bridge at (${bot.tile().x},${bot.tile().z}): bridge skipped`); return; }
    // entry -> Koftik #2 region (3 rockslides)
    const rocks = process.env.UPASS_ROCKS === 'south' ? ROCKS_SOUTH : ROCKS_NORTH;
    const inKoftikRegion = () => { const t = bot.tile(); return t.x >= 2440 && t.x <= 2462 && t.z >= 9712 && t.z <= 9722; };
    if (!inKoftikRegion()) for (const r of rocks) await climbRock(bot, r, log);
    log('at Koftik #2 region');
    const cloth = objId('damp_cloth'), bow = objId('shortbow');
    for (let attempt = 0; attempt < 8 && !across(); attempt++) {
        // a lit arrow ready (worn or held)? else make one: cloth (Koftik gives one when we have none) + arrow, tinderbox
        const litHeld = () => bot.inv().find(s => litArrowIds().includes(s.obj));
        const litWorn = () => litArrowIds().some(id => bot.isWorn(id));
        if (!litWorn() && !litHeld()) {
            // 305e (with UP_REENTER; qzc08m re-entry after 'paladins': 'cloth on arrow' + "You don't have space to do that."):
            // a retry re-supplies the whole kit AND keeps the quest items it holds (the cave railing), so the pack was 28/28;
            // the cloth and the unlit arrow need a slot each. Drop the railing once area 2 is done, then food.
            const needSlots = (has(bot, cloth) ? 0 : 1) + (bot.inv().some(s => unlitArrowIds().includes(s.obj)) ? 0 : 1);
            if (process.env.UP_REENTER !== '0' && bot.free() < needSlots) {
                const before = bot.free();
                for (let k = 0; k < 6 && bot.free() < needSlots; k++) {
                    const j = bot.inv().find(s => (RE.area2Done && s.obj === O.railing)) ?? bot.inv().find(s => foodIds().includes(s.obj));
                    if (!j) break;
                    bot.dropItem(j.obj, j.slot); bot.queueFlush(); await bot.tick(1);
                }
                log(`305e bridge: free ${before} -> ${bot.free()} (need ${needSlots})`);
            }
            if (!has(bot, cloth) && !bot.inv().some(s => unlitArrowIds().includes(s.obj))) {
                const ok = await converse(bot, N.koftik2, { done: () => has(bot, cloth) && bot.chatModalId === -1, answers: [/litter/i], maxTicks: 60, label: 'koftik2' });
                if (!ok) fail(bot, 'Koftik #2: no cloth');
            }
            if (!bot.inv().some(s => unlitArrowIds().includes(s.obj))) {
                const a = bot.inv().find(s => arrowIds().includes(s.obj));
                if (!a) fail(bot, 'no arrows left');
                bot.useItemOnItem(cloth, bot.slot(cloth), a!.obj, a!.slot); bot.queueFlush();
                if (!(await bot.until(() => bot.inv().some(s => unlitArrowIds().includes(s.obj)), 4))) fail(bot, 'cloth on arrow');
            }
            const u = bot.inv().find(s => unlitArrowIds().includes(s.obj))!;
            const tb = objId('tinderbox');
            bot.useItemOnItem(tb, bot.slot(tb), u.obj, u.slot); bot.queueFlush();
            if (!(await bot.until(() => !!litHeld(), 4))) fail(bot, 'light the arrow');
        }
        if (!bot.isWorn(bow)) await wear(bot, bow);
        const lh = litHeld(); if (lh) await wear(bot, lh.obj);
        if (!litWorn() || !bot.isWorn(bow)) fail(bot, 'wield bow + fire arrow');
        const rope = locAt(L.guideRope.id, L.guideRope.x, L.guideRope.z, 0);
        const t0 = bot.tickCount;
        // aploc1 fires from wherever we are once in range, and the script wants x >= 2443 and z >= 9720 (upass_bridge.rs2:36-43):
        // stand on the shooting tile first, then fire
        if (cheb(bot.tile(), T.shoot) > 0) await bot.stepTo(T.shoot.x, T.shoot.z, 20);
        await act(bot, 'shoot', () => { bot.opLoc(rope.x, rope.z, rope.id, 1); bot.queueFlush(); },
            () => across() || msgSince(bot, t0, /just misses the rope|impales the rope|clear shot|need something to fire|equip a bow/i), { every: 8, max: 30 });
        if (msgSince(bot, t0, /impales the rope/i)) await bot.until(across, 25);   // forcewalk over the falling bridge, then (2442,9716)
        if (msgSince(bot, t0, /clear shot|need something to fire|equip a bow/i)) fail(bot, `shoot: ${msgsSince(bot, t0).join(' | ')}`);
        if (!across() && !msgSince(bot, t0, /just misses the rope/i)) await bot.until(across, 25);
        log(across() ? 'bridge down, across' : `missed the rope (${msgsSince(bot, t0).join(' | ')})`);
    }
    if (!across()) fail(bot, 'bridge');
    await unequipExcept(bot, []);   // the bow + any arrows: not needed again (revisit: Regicide passes twice, keep them)
    if (!MODE.revisit) await bot.dropAll(['shortbow', ...arrowIds(), ...unlitArrowIds(), ...litArrowIds(), objId('damp_cloth')].filter(o => bot.count(o) > 0), 6);
    // session 11 fix 280 (UP_KIT15): the kit now carries 15 sharks (robes worn from the bank, no trim): wield the weapon again
    // here (the bow swapped it into the pack), one slot back for the 4 orbs held at once (paladins would wear it anyway)
    const w = objId(WEAPON);
    if (process.env.UP_KIT15 !== '0' && !bot.isWorn(w) && has(bot, w)) await wear(bot, w);
};

/** landing -> rope swing (rope on loc_2276, agility 100/410) -> rockslides (2491,9691) S and (2482,9679) W -> grid east */
const segSwing: Seg = async (bot, log) => {
    const atGridEast = () => { const t = bot.tile(); return t.x >= 2477 && t.x <= 2484 && t.z >= 9672 && t.z <= 9682; };
    if (atGridEast()) return;
    const inSwingEast = () => { const t = bot.tile(); return t.x >= 2463 && t.x <= 2495 && t.z >= 9690 && t.z <= 9705 && !(t.x <= 2462); };
    if (!inSwingEast()) {
        if (!has(bot, 'rope')) fail(bot, 'no rope for the swing');
        const rock = locAt(L.swingRock.id, L.swingRock.x, L.swingRock.z, 0);
        const rope = objId('rope');
        const ok = await act(bot, 'swing', () => {
            const sl = bot.slot(rope); if (sl < 0) return false;
            routeToLoc(bot, rock, T.swingStand); bot.useItemOnLoc(rock.x, rock.z, rock.id, rope, sl); bot.queueFlush();
        }, () => cheb(bot.tile(), T.swingLand) <= 1, { every: 8, max: 120 });
        if (!ok) fail(bot, 'rope swing');
        log('swung across');
    }
    for (const r of ROCKS_TO_GRID) if (!atGridEast()) await climbRock(bot, r, log);
};

/**
 * The grid (upass_grid.rs2:45-99): three overlapping column bands, each with one safe 2-row pair (digits 1-5, each next
 * digit within 1 of the last), per player and not transmitted. A tile is safe if it lies in ANY band's safe pair; else
 * the 1-tick timer drops us into the pit (15 hp, (2395-2396,9559-9560)); the hand holds put us back at (2477,9677).
 * Bands (x): 1 = 2473-2478, 2 = 2469-2474, 3 = 2467-2470; the fail zone is x 2467-2476, z 9673-9682.
 * Probe each digit by standing on a tile that only that band covers; a fall rules the candidate out.
 */
const rowZ = (d: number) => 9673 + 2 * (d - 1);
// 305d: the pit box only (2395-2396, 9559-9560 + margin); 'z < 9600' was true on the surface too, so a retry from outside
// at the grid 'fell into the pit' and threw 'grid pit hand holds' in 2 t (qx67m attempts 2 + 3). UP_REENTER=0 reverts.
const inPit = (bot: SpeedBot) => { const t = bot.tile(); return process.env.UP_REENTER === '0' ? t.z < 9600 : t.z >= 9550 && t.z <= 9570 && t.x >= 2385 && t.x <= 2405; };
const segGrid: Seg = async (bot, log) => {
    const west = () => { const t = bot.tile(); return t.x <= 2466 && t.z >= 9670 && t.z <= 9684 && bot.tile().z > 9600; };
    if (west()) return;
    const holds = locAt(L.handholds.id, L.handholds.x, L.handholds.z, 0);
    let falls = 0;
    const climbOut = async () => {
        falls++;
        log(`fell into the grid pit (${falls})`);
        // the pit drops us on one of 4 tiles (2395-2396, 9559-9560), each with its own wall hand hold: use the one on our tile
        const mine = () => { const t = bot.tile(); try { return locAt(L.handholds.id, t.x, t.z, 0); } catch { return holds; } };
        if (!(await act(bot, 'handholds', () => { const h = mine(); bot.opLoc(h.x, h.z, h.id, 1); bot.queueFlush(); }, () => !inPit(bot), { every: 4, max: 40 }))) fail(bot, 'grid pit hand holds');
    };
    /** walk the axis-aligned waypoints in order, ONE straight MOVE each (never the planner: a diagonal shortcut crosses
     *  unknown rows), then hold 2 ticks. The trap timer fires on the first tick on an unsafe tile ("It's a trap!") and the
     *  pit teleport follows 2-3 ticks later (upass_grid.rs2:85-99). true = still standing; false = fell (and climbed back). */
    // session 11 fix 305c (UP_GRID_REACH; qx67m 'grid digit 2' after 4 falls): a ws 1012 drop (engine restart) hit while
    // probing digit 1 at (2477,9675); the step onto the probe tile (2476,9675) was lost, the 12 t wait ran out, no trap
    // message, so tryPath said 'safe' and logged 'grid d1=2' standing at (2477,9675) (CONFIRMED: that position in the log
    // line; the fork qzc02 logs d1 at (2476,9675)). A wrong digit 1 makes every digit-2 path cross an unsafe tile: 3 falls,
    // fail. Now a waypoint counts only when we stand on it: an unreached one is re-sent (3 tries), and a probe that never
    // reached its last tile fails honestly instead of returning 'safe'. =0 reverts. TEST: UP_GRID_TEST=1 skips the first
    // send of the first probe's last step (as the drop did).
    const reach = process.env.UP_GRID_REACH !== '0';
    const tryPath = async (pts: Tile[]): Promise<boolean> => {
        const t0 = bot.tickCount;
        for (const p of pts) {
            for (let k = 0; k < (reach ? 3 : 1); k++) {
                if (inPit(bot) || msgSince(bot, t0, /It's a trap/i)) break;
                if (cheb(bot.tile(), p) === 0) break;
                const skip = process.env.UP_GRID_TEST === '1' && p === pts[pts.length - 1] && !(globalThis as any).__upGridTest;
                if (skip) { (globalThis as any).__upGridTest = 1; log(`305c TEST: the step to (${p.x},${p.z}) is not sent`); }
                else bot.sendRoute([p]);
                await bot.until(() => cheb(bot.tile(), p) === 0 || inPit(bot) || msgSince(bot, t0, /It's a trap/i), 12);
            }
            if (inPit(bot) || msgSince(bot, t0, /It's a trap/i)) break;
            if (reach && cheb(bot.tile(), p) !== 0) fail(bot, `grid: never reached (${p.x},${p.z}) from (${bot.tile().x},${bot.tile().z}) (305c)`);
        }
        await bot.tick(2);
        if (inPit(bot) || msgSince(bot, t0, /It's a trap/i)) {
            if (!(await bot.until(() => inPit(bot), 6))) fail(bot, 'grid: trap message but no pit');
            await climbOut(); return false;
        }
        return true;
    };
    const order = (cands: number[], prefer: number) => cands.filter(v => v >= 1 && v <= 5).sort((a, b) => Math.abs(a - prefer) - Math.abs(b - prefer));
    // x 2477 is outside the fail zone (x 2467-2476): the safe corridor to reach any row
    const back = (z: number): Tile[] => [{ x: 2477, z: bot.tile().z > 9600 ? bot.tile().z : 9677 }, { x: 2477, z }];
    const known = savedGrid(bot.loginUser);
    if (known) {
        const [a, b, c] = known.split('').map(Number) as [number, number, number];
        if (await tryPath([...back(rowZ(a)), { x: 2473, z: rowZ(a) }, { x: 2473, z: rowZ(b) }, { x: 2469, z: rowZ(b) }, { x: 2469, z: rowZ(c) }, { x: 2466, z: rowZ(c) }]) && west()) {
            log(`grid ${known} (remembered) crossed`);
            return;
        }
        log(`remembered grid ${known} was wrong: probing`);
    }
    // digit 1: only band 1 covers x 2475-2476
    let d1 = 0;
    for (const c of order([1, 2, 3, 4, 5], 3)) if (await tryPath([...back(rowZ(c)), { x: 2476, z: rowZ(c) }])) { d1 = c; break; }
    if (!d1) fail(bot, 'grid digit 1');
    log(`grid d1=${d1}`);
    const toD1 = (): Tile[] => [...back(rowZ(d1)), { x: 2476, z: rowZ(d1) }, { x: 2473, z: rowZ(d1) }];
    // digit 2: from x 2473 (bands 1+2) move along x 2473 to the candidate row, then onto x 2472 (band 2 only)
    let d2 = 0;
    for (const c of order([d1 - 1, d1, d1 + 1], d1)) {
        const here = bot.tile();
        const pre = here.x === 2473 && here.z === rowZ(d1) ? [] : toD1();
        if (await tryPath([...pre, { x: 2473, z: rowZ(c) }, { x: 2472, z: rowZ(c) }])) { d2 = c; break; }
    }
    if (!d2) fail(bot, 'grid digit 2');
    log(`grid d2=${d2}`);
    const toD2 = (): Tile[] => [...toD1(), { x: 2473, z: rowZ(d2) }, { x: 2469, z: rowZ(d2) }];
    // digit 3: from x 2469 (bands 2+3) along x 2469 to the candidate row, then x 2468 (band 3 only)
    let d3 = 0;
    for (const c of order([d2 - 1, d2, d2 + 1], d2)) {
        const here = bot.tile();
        const pre = here.x === 2472 && here.z === rowZ(d2) ? [{ x: 2469, z: rowZ(d2) }] : here.x === 2469 && here.z === rowZ(d2) ? [] : toD2();
        if (await tryPath([...pre, { x: 2469, z: rowZ(c) }, { x: 2468, z: rowZ(c) }])) { d3 = c; break; }
    }
    if (!d3) fail(bot, 'grid digit 3');
    log(`grid ${d1}${d2}${d3} solved (falls ${falls})`);
    saveGrid(bot.loginUser, `${d1}${d2}${d3}`);
    await tryPath([{ x: 2466, z: rowZ(d3) }]);
    if (!west()) fail(bot, 'grid exit');
};

/** lever -> portcullis (west), 4 orbs (3 ground objs + the log-trap orb), furnace x4, the well -> area 2 */
const segOrbs: Seg = async (bot, log) => {
    const inArea2 = () => { const t = bot.tile(); return t.z >= 9640 && t.z <= 9664 && t.x >= 2370 && t.x <= 2430; };
    if (inArea2()) return;
    const pastPortcullis = () => { const t = bot.tile(); return t.x <= 2464 && t.z > 9600 && t.z < 9700; };
    if (!pastPortcullis()) {
        const lever = locAt(L.lever.id, L.lever.x, L.lever.z, 0);
        if (!(await act(bot, 'lever', () => { opLocGo(bot, lever, 1); }, pastPortcullis, { every: 6, max: 40 }))) fail(bot, 'portcullis lever');
        log('through the portcullis');
    }
    const orbs = MODE.revisit || RE.orbsDone ? [] : [O.caveorb1, O.caveorb2, O.caveorb3, O.caveorb4];   // revisit: the 4 orb bits are set
    const burnt = new Set<number>(MODE.revisit || RE.orbsDone ? [O.caveorb1, O.caveorb2, O.caveorb3, O.caveorb4] : []);
    const need = (o: number) => !burnt.has(o) && !has(bot, o);
    // A/B (UPASS_ORBS): 'fwd' = orb4, orb3, orb2, log-trap orb1 (default); 'rev' = orb1 first, then orb2, orb3, orb4
    const rev = process.env.UPASS_ORBS === 'rev';
    const logTrap = async () => {
        if (!need(O.caveorb1)) return;
        const trap = locAt(L.logtrap.id, L.logtrap.x, L.logtrap.z, 0);
        if (!(await act(bot, 'logtrap', () => { opLocGo(bot, trap, 1); }, () => has(bot, O.caveorb1), { answers: [/give it a go/i], every: 6, max: 120 }))) fail(bot, 'log trap orb');
        log('orb 1 (log trap)');
    };
    const ground: Array<[number, Tile]> = [[O.caveorb4, T.orb4], [O.caveorb3, T.orb3], [O.caveorb2, T.orb2]];
    if (rev) { ground.reverse(); await logTrap(); }
    for (const [o, at] of ground) {
        if (!need(o)) continue;
        if (!(await pickup(bot, o, at, 250)) && !(await pickup(bot, o, at, 60))) fail(bot, `orb ${o}`);
        log(`orb ${o}`);
    }
    await logTrap();
    const furnace = locAt(L.furnace.id, L.furnace.x, L.furnace.z, 0);
    for (const o of orbs) {
        if (burnt.has(o)) continue;
        if (!has(bot, o)) fail(bot, `orb ${o} lost`);
        const ok = await act(bot, `furnace ${o}`, () => { const sl = bot.slot(o); if (sl < 0) return false; routeToLoc(bot, furnace); bot.useItemOnLoc(furnace.x, furnace.z, furnace.id, o, sl); bot.queueFlush(); }, () => !has(bot, o), { every: 6, max: 150 });
        if (!ok) fail(bot, `furnace ${o}`);
        burnt.add(o);
    }
    log('4 orbs burnt');
    const well = locAt(L.well.id, L.well.x, L.well.z, 0);
    if (!(await act(bot, 'well', () => { opLocGo(bot, well, 1); }, inArea2, { every: 6, max: 120 }))) fail(bot, 'well');
    log('down the well: area 2');
};

// ---- area 2 ------------------------------------------------------------------------------------------------------------
/** op a loc until done. With `stand`: walk onto the stand tile first (an OPLOC sent while still walking self-routes
 *  naively and can pick a side the loc refuses, e.g. a forceapproach barrel), then op from there. */
export async function opUntil(bot: SpeedBot, label: string, loc: { id: number; x: number; z: number }, op: number, done: () => boolean,
    o: { stand?: Tile; every?: number; max?: number; answers?: RegExp[]; level?: number } = {}): Promise<boolean> {
    const l = locAt(loc.id, loc.x, loc.z, o.level ?? 0);
    return actAt(bot, label, o.stand, () => { opLocGo(bot, l, op, o.stand); }, done, o);
}
export async function useOnLoc(bot: SpeedBot, label: string, obj: number, loc: { id: number; x: number; z: number }, done: () => boolean,
    o: { stand?: Tile; every?: number; max?: number; level?: number } = {}): Promise<boolean> {
    const l = locAt(loc.id, loc.x, loc.z, o.level ?? 0);
    return actAt(bot, label, o.stand, () => { const sl = bot.slot(obj); if (sl < 0) return false; routeToLoc(bot, l, o.stand); bot.useItemOnLoc(l.x, l.z, l.id, obj, sl); bot.queueFlush(); }, done, o);
}
export async function actAt(bot: SpeedBot, label: string, stand: Tile | undefined, op: () => boolean | void, done: () => boolean,
    o: { every?: number; max?: number; answers?: RegExp[] }): Promise<boolean> {
    if (stand && !done() && cheb(bot.tile(), stand) > 0) {
        await bot.walkTo(stand.x, stand.z, { maxTicks: 80 + 2 * cheb(bot.tile(), stand), log: false });
    }
    return act(bot, label, op, done, { every: o.every ?? 6, max: o.max ?? 120, answers: o.answers });
}
export const inBox = (bot: SpeedBot, x0: number, z0: number, x1: number, z1: number, level = 0) => { const t = bot.tile(); return bot.minusedlevel === level && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1; };
/** route next to an npc and use an item on it (OPNPCU) in one tick */
function useOnNpcGo(bot: SpeedBot, n: { idx: number; x: number; z: number }, obj: number, slot: number): void {
    const me = bot.tile();
    if (cheb(me, n) > 1) {
        let pts: Tile[] = [];
        try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, n.x, n.z, 500); } catch { pts = []; }
        const dense = densify([me, ...pts]).slice(1);
        while (dense.length && cheb(dense[dense.length - 1]!, n) === 0) dense.pop();
        if (dense.length) bot.sendRoute(turning(me, dense), true);
    }
    bot.useItemOnNpc(n.idx, obj, slot); bot.queueFlush();
}

/** area 2: slave cage (pick), mud (spade), ledge, two thieving-50 cages, pipe, railing on the boulder (=4), horn, door */
const segArea2: Seg = async (bot, log) => {
    // a position state machine: every pass acts on where we stand, so a slip (the ledge drops us into the rat pit) or a
    // missed op is simply retried from the new position
    const paladinArea = () => inBox(bot, 2366, 9666, 2430, 9730);
    const cageRow = () => inBox(bot, 2375, 9655, 2425, 9663);           // the slave-cage corridor + the well landing
    const cell = () => inBox(bot, 2392, 9650, 2394, 9654);              // behind cage door (2393,9655), with the mud
    const north = () => inBox(bot, 2375, 9643, 2393, 9646);             // mud landing .. ledge (north end)
    const ratPit = () => inBox(bot, 2366, 9639, 2373, 9654);            // below the ledge (leads back to the well landing only)
    const ratSide = () => inBox(bot, 2366, 9613, 2380, 9638);           // ledge south end .. first thieving cage
    const between = () => inBox(bot, 2381, 9613, 2403, 9625);
    const pipeSide = () => inBox(bot, 2404, 9600, 2425, 9640) && !inBox(bot, 2390, 9590, 2413, 9612);
    const eastCopy = () => inBox(bot, 2395, 9590, 2420, 9612) && !pipeSide();
    const westCopy = () => inBox(bot, 2365, 9590, 2394, 9612);
    for (let pass = 0; pass < 16 && !paladinArea(); pass++) {
        if (dead(bot)) return;
        if (cageRow()) {
            if (!(await opUntil(bot, 'slave cage', L.cage2, 1, cell, { stand: { x: 2393, z: 9655 } }))) fail(bot, 'slave cage lock');
            log('through the slave cage');
        } else if (cell()) {
            if (!(await useOnLoc(bot, 'mud', O.spade, L.mud, north, { stand: { x: 2393, z: 9651 } }))) fail(bot, 'dig the mud');
            log('through the mud tunnel');
            // fix 174 (allchaos qt19fm 'dig the mud' after a ledge fall: the spade was dropped right after the first dig, and the
            // way back from the rat pit digs the mud again). The spade is dropped once over the ledge. UP_SPADE_EARLY=1 reverts.
            if (!MODE.revisit && process.env.UP_SPADE_EARLY === '1') await bot.dropAll(['spade'], 4);
        } else if (north()) {
            await opUntil(bot, 'ledge', L.ledge, 1, () => ratSide() || ratPit(), { stand: { x: 2375, z: 9644 }, every: 6, max: 60 });
            log(ratSide() ? 'over the ledge' : 'fell off the ledge into the rat pit');
            if (ratSide() && !MODE.revisit && process.env.UP_SPADE_EARLY !== '1' && bot.count(O.spade) > 0) await bot.dropAll(['spade'], 4);
        } else if (ratPit()) {
            await walk(bot, T.area2, 2, 'out of the rat pit');   // 67 steps back to the well landing: redo cage/mud/ledge
        } else if (ratSide()) {
            if (!(await opUntil(bot, 'cage 5a', L.cage5a, 1, between, { stand: { x: 2380, z: 9619 } }))) fail(bot, 'thieving cage A');
            log('cage A');
        } else if (between()) {
            if (!(await opUntil(bot, 'cage 5b', L.cage5b, 1, pipeSide, { stand: { x: 2403, z: 9620 } }))) fail(bot, 'thieving cage B');
            log('cage B');
        } else if (pipeSide()) {
            // before the unicorn dies the pipe ends in the east copy; after it (revisit) it telejumps 26 west (upass_obstacles.rs2:351-355)
            if (!(await opUntil(bot, 'pipe', L.pipe6, 1, () => eastCopy() || westCopy(), { every: 8, max: 80 }))) fail(bot, 'pipe');
            log('through the pipe (east copy)');
        } else if (eastCopy()) {
            if (!has(bot, O.railing)) {
                if (!(await opUntil(bot, 'railing', L.railing3, 2, () => has(bot, O.railing), { stand: { x: 2397, z: 9605 } }))) fail(bot, 'loose railing');
            }
            const ok = await act(bot, 'boulder', () => {
                const b = npc(bot, N.boulder); const sl = bot.slot(O.railing); if (!b || sl < 0) return false;
                useOnNpcGo(bot, b, O.railing, sl);
            }, westCopy, { every: 6, max: 60 });
            if (!ok) fail(bot, 'railing on the boulder');
            log('boulder rolled: the unicorn is dead (=4)');
        } else if (westCopy()) {
            if (!has(bot, O.horn) && !MODE.revisit && !RE.paladinsDone) {
                // the smashed cage is 3x4 (x2371-2373, z9603-9606): search it from its east side
                if (!(await opUntil(bot, 'horn', L.cageRemains, 1, () => has(bot, O.horn), { stand: { x: 2374, z: 9604 } }))) fail(bot, 'unicorn horn');
                log('horn');
            }
            if (!(await opUntil(bot, 'unicorn door', L.unicornDoorW, 1, paladinArea))) fail(bot, 'unicorn door');
            log('door to the paladins');
        } else fail(bot, 'area 2: lost (no known region)');
    }
    if (!paladinArea()) fail(bot, 'area 2: not at the paladins');
};

/** the 3 paladins (each drops his badge on death, sir_*.rs2:1-10), horn + badges into the blood well, the skull door -> L1 */
const segPaladins: Seg = async (bot, log) => {
    if (bot.minusedlevel === 1) return;
    if (MODE.revisit || RE.paladinsDone) {   // the badges and the horn are in the well already: the skull door just opens
        if (!(await opUntil(bot, 'skull door', L.templeDoor2, 1, () => bot.minusedlevel === 1, { every: 6, max: 120 }))) fail(bot, 'skull door (revisit)');
        log("into Iban's lair (L1)");
        return;
    }
    const w = objId(WEAPON);
    if (!bot.isWorn(w) && has(bot, w)) await wear(bot, w);
    const badges = [O.badge1, O.badge2, O.badge3];
    const ready = () => badges.every(b => has(bot, b)) && has(bot, O.horn);
    for (let k = 0; k < 6 && !badges.every(b => has(bot, b)); k++) {
        // the dead paladin's badge lies where he fell: pick up anything already on the floor first
        for (const b of badges) {
            if (has(bot, b)) continue;
            const g = bot.findGroundItem(b, 15);
            if (g) { await pickup(bot, b, { x: g.x, z: g.z }, 40); log(`badge ${b}`); }
        }
        const alive = npcsOf(bot, [...N.paladins]).filter(n => !has(bot, O.badge1 + (n.type - N.paladins[0])));
        if (!alive.length) {
            if (!npcsOf(bot, [...N.paladins]).length) await walk(bot, { x: 2421, z: 9719 }, 4, 'paladins');
            await bot.tick(1); continue;
        }
        const target = alive[0]!;
        log(`fighting paladin ${target.type}`);
        await upFight(bot, target.type, { max: 300, label: `paladin ${target.type}`, spell: SPELL || undefined, done: () => bot.findGroundItem(O.badge1 + (target.type - N.paladins[0]), 15) !== undefined || has(bot, O.badge1 + (target.type - N.paladins[0])) });
        if (dead(bot)) return;
    }
    if (!badges.every(b => has(bot, b))) fail(bot, 'paladin badges');
    log('3 badges');
    for (const o of [O.horn, ...badges]) {
        if (!has(bot, o)) continue;
        if (!(await useOnLoc(bot, `well ${o}`, o, L.bloodwell, () => !has(bot, o), { every: 4, max: 80 }))) fail(bot, `blood well ${o}`);
    }
    log('blood well: the skull door clicks');
    if (!(await opUntil(bot, 'skull door', L.templeDoor2, 1, () => bot.minusedlevel === 1, { every: 6, max: 60 }))) fail(bot, 'skull door');
    log('into Iban\'s lair (L1) (=5)');
};

// ---- Iban's lair (L1 bridges) and the dwarves' cavern below (L0) ---------------------------------------------------
// L1 is islands joined by length-3 collapsed bridges (op1 Cross: agility 160/300 jump to the far end; a slip drops you to
// L0 (2335,9821)/(2333,9866) for 25%+4 hp, upass_obstacles.rs2:371-407). Islands (probe-regions.ts on the 289 collision):
const ISL = {
    hub: { x: 2173, z: 4725 },       // arrival from the skull door; both tunnels down (2150,4545) and (2112,4729)
    cat: { x: 2142, z: 4604 },       // Kardia's cat (2131,4602)
    oth: { x: 2125, z: 4566 },       // Othainian
    dem: { x: 2136, z: 4579 },       // Doomion, Holthion, the shut chest
    witch: { x: 2157, z: 4566 },     // Kardia's house
    temple: { x: 2144, z: 4647 },    // Iban's temple door (east side)
    cage: { x: 2134, z: 4701 },      // the dove's cage
    i10: { x: 2146, z: 4604 }, i14: { x: 2160, z: 4628 }, i15: { x: 2161, z: 4657 },
} as const;
type Isl = keyof typeof ISL;
/** bridges: loc (id 3254/3255 by the jm2), the two jump ends and the islands they join */
const BRIDGES: Array<{ x: number; z: number; a: Tile; b: Tile; ia: Isl; ib: Isl }> = [
    { x: 2156, z: 4582, a: { x: 2155, z: 4582 }, b: { x: 2159, z: 4582 }, ia: 'witch', ib: 'hub' },
    { x: 2147, z: 4583, a: { x: 2146, z: 4583 }, b: { x: 2150, z: 4583 }, ia: 'cat', ib: 'witch' },
    { x: 2142, z: 4562, a: { x: 2142, z: 4561 }, b: { x: 2142, z: 4565 }, ia: 'dem', ib: 'cat' },
    { x: 2126, z: 4566, a: { x: 2125, z: 4566 }, b: { x: 2129, z: 4566 }, ia: 'oth', ib: 'dem' },
    { x: 2121, z: 4686, a: { x: 2120, z: 4686 }, b: { x: 2124, z: 4686 }, ia: 'hub', ib: 'cage' },
    { x: 2143, z: 4604, a: { x: 2142, z: 4604 }, b: { x: 2146, z: 4604 }, ia: 'cat', ib: 'i10' },
    { x: 2160, z: 4625, a: { x: 2160, z: 4624 }, b: { x: 2160, z: 4628 }, ia: 'i10', ib: 'i14' },
    { x: 2161, z: 4637, a: { x: 2161, z: 4636 }, b: { x: 2161, z: 4640 }, ia: 'i14', ib: 'temple' },
    { x: 2162, z: 4663, a: { x: 2162, z: 4662 }, b: { x: 2162, z: 4666 }, ia: 'i15', ib: 'cage' },
    { x: 2161, z: 4654, a: { x: 2161, z: 4653 }, b: { x: 2161, z: 4657 }, ia: 'temple', ib: 'i15' },
];
const BRIDGE_IDS = [3254, 3255];
const ISL_CACHE = new Map<string, Isl | null>();
/** which L1 island we stand on (rsmod reachability to each anchor; cached per tile) */
function island(bot: SpeedBot): Isl | null {
    if (bot.minusedlevel !== 1) return null;
    const me = bot.tile(), k = `${me.x},${me.z}`;
    if (ISL_CACHE.has(k)) return ISL_CACHE.get(k)!;
    let hit: Isl | null = null;
    for (const [name, t] of Object.entries(ISL) as Array<[Isl, Tile]>) {
        if (cheb(me, t) === 0) { hit = name; break; }
        // either direction (a few cave tiles are one-way edges for rsmod)
        const reach = (a: Tile, b: Tile) => { let p: Tile[] = []; try { p = navSync().findLongPath(1, a.x, a.z, b.x, b.z, 4000); } catch { p = []; } const e = p[p.length - 1]; return !!e && e.x === b.x && e.z === b.z; };
        if (reach(me, t) || reach(t, me)) { hit = name; break; }
    }
    ISL_CACHE.set(k, hit);
    return hit;
}
type Hop = { br: typeof BRIDGES[number]; stand: Tile; land: Tile; next: Isl };
/** BFS over the bridge graph: the bridge sequence from island `from` to `to` */
function bridgePlan(from: Isl, to: Isl): Hop[] {
    const prev = new Map<Isl, { br: typeof BRIDGES[number]; from: Isl }>();
    const q: Isl[] = [from]; const seen = new Set<Isl>([from]);
    while (q.length) {
        const c = q.shift()!;
        if (c === to) break;
        for (const br of BRIDGES) {
            const nxt = br.ia === c ? br.ib : br.ib === c ? br.ia : null;
            if (!nxt || seen.has(nxt)) continue;
            seen.add(nxt); prev.set(nxt, { br, from: c }); q.push(nxt);
        }
    }
    const out: Hop[] = [];
    for (let c: Isl = to; c !== from;) {
        const p = prev.get(c); if (!p) return [];
        const fwd = p.br.ia === p.from;
        out.unshift({ br: p.br, stand: fwd ? p.br.a : p.br.b, land: fwd ? p.br.b : p.br.a, next: c });
        c = p.from;
    }
    return out;
}
/** cross bridges until we stand on island `to` (L1). A slip to L0 throws. */
async function goIsland(bot: SpeedBot, to: Isl, log: (s: string) => void): Promise<void> {
    for (let guard = 0; guard < 12; guard++) {
        const cur = island(bot);
        if (cur === to) return;
        if (!cur) fail(bot, `goIsland(${to}): not on a known island`);
        const plan = bridgePlan(cur!, to);
        if (!plan.length) fail(bot, `goIsland: no bridge path ${cur} -> ${to}`);
        const step = plan[0]!;
        const id = BRIDGE_IDS.find(i => { try { locAt(i, step.br.x, step.br.z, 1); return true; } catch { return false; } });
        if (id === undefined) fail(bot, `no bridge loc at ${step.br.x},${step.br.z}`);
        const loc = locAt(id!, step.br.x, step.br.z, 1);
        const ok = await actAt(bot, `bridge ${step.br.x},${step.br.z}`, step.stand, () => { opLocGo(bot, loc, 1, step.stand); },
            () => cheb(bot.tile(), step.land) === 0 || bot.minusedlevel !== 1, { every: 6, max: 80 });
        if (bot.minusedlevel !== 1) fail(bot, `slipped off bridge ${step.br.x},${step.br.z} to L0`);
        if (!ok) fail(bot, `bridge ${step.br.x},${step.br.z}`);
        log(`bridge ${step.br.x},${step.br.z} -> ${step.next}`);
    }
    fail(bot, `goIsland(${to}): too many bridges`);
}

const LL = {
    tunnelDownA: { id: 3222, x: 2150, z: 4545 }, tunnelDownB: { id: 3222, x: 2112, z: 4729 },   // L1 -> (2336,9794) / (2305,9915)
    tunnelUpA: { id: 3223, x: 2336, z: 9793 }, tunnelUpB: { id: 3223, x: 2304, z: 9915 },       // L0 -> (2150,4546) / (2113,4729)
    barrel: { id: 3344, x: 2327, z: 9799 },          // upassdwarfbrewbarrel: bucket -> dwarf brew
    witchDoor: { id: 3270, x: 2158, z: 4566 },        // cat on it (oplocu) sets the bit; op1 then opens
    witchChest: { id: 3272, x: 2157, z: 4564 },       // =6 -> doll, journal, 2 potions (=7)
    shutChest: { id: 3274, x: 2136, z: 4578 },        // the 3 demon amulets -> Iban's shadow
    cage: { id: 3351, x: 2134, z: 4702 },             // aploc1: Iban's dove (bite 10 without Klank's gauntlets)
    tomb: { id: 3353, x: 2356, z: 9800 },             // brew (=7) then tinderbox -> Iban's ashes
    templeDoor: { id: 3334, x: 2143, z: 4647 },       // robe-only; complete doll -> =8
    altar: { id: 3359, x: 2136, z: 4647 },            // the doll into the pit -> =9, thrown to (2482,9607)
} as const;
const JUNK_AFTER_CHEST = ['old_journal', '3dose2attack', '3dosestatrestore'];
/** tools the quest no longer needs once in the lair (drop to make room: the doll, the cat, amulets, ashes...) */
const LAIR_JUNK = ['shortbow', 'bronze_arrow', 'iron_arrow', 'damp_cloth', 'unlitarrow', 'litarrow', 'rope', 'spade', 'woodplank', 'old_journal',
    '3dose2attack', '3dosestatrestore', 'vial_empty', 'caverailing', 'upass_journal'];
async function freeUp(bot: SpeedBot, n: number): Promise<void> {
    if (bot.free() >= n) return;
    const junk = new Set(LAIR_JUNK.map(objId));
    // drops sent during an exactmove/delay (bridge jump, pipe) are ignored: retry a few ticks
    for (let k = 0; k < 6 && bot.free() < n; k++) {
        const drop = bot.inv().filter(s => junk.has(s.obj));
        if (!drop.length) break;
        bot.burst(drop.map(s => () => bot.dropItem(s.obj, s.slot)));
        await bot.tick(1);
    }
    // still short: drop food, but keep at least 5 (the lair quest items are one-of-a-kind; food is not)
    for (let k = 0; k < 6 && bot.free() < n && bot.inv().filter(s => foodIds().includes(s.obj)).length > 5; k++) {
        const f = bot.inv().find(s => foodIds().includes(s.obj)); if (!f) break;
        bot.dropItem(f.obj, f.slot); bot.queueFlush(); await bot.tick(1);
    }
}
const inLower = (bot: SpeedBot) => bot.minusedlevel === 0 && inBox(bot, 2290, 9780, 2370, 9925);
/** use a part on the doll (opheldu,ibandoll) and wait until the part is gone */
async function onDoll(bot: SpeedBot, part: number, log: (s: string) => void): Promise<void> {
    if (!has(bot, part)) return;
    const ok = await act(bot, `doll ${part}`, () => {
        const d = bot.slot(O.doll), p = bot.slot(part); if (d < 0 || p < 0) return false;
        bot.useItemOnItem(O.doll, d, part, p); bot.queueFlush();
    }, () => !has(bot, part), { every: 10, max: 30 });
    if (!ok) fail(bot, `doll + ${part}`);
    log(`doll + ${objDebugName(part)}`);
    GAME.add(`${who(bot)}:part${part}`);   // session 11 fix 401c: on the doll for good (%ibanmulti bit), a new doll carries it
}
/** a tunnel between L1 and the cavern; the first descent runs Koftik's "is that you" dialog (act answers it) */
async function tunnel(bot: SpeedBot, t: { id: number; x: number; z: number }, level: number, done: () => boolean, label: string): Promise<void> {
    if (done()) return;
    // session 8 (allchaos qt35m DIED at 'tunnel up (B)': 150 t on (2359,9912) being hit, every tunnel op lost to the
    // retaliation, "I'm already under attack!"): op in 60 t slices; when hp fell during a slice, kill whatever npc stands
    // next to us first. UP_TUNNEL_FIGHT=0 reverts.
    if (process.env.UP_TUNNEL_FIGHT === '0') { if (!(await opUntil(bot, label, t, 1, done, { level, every: 8, max: 300 }))) fail(bot, label); return; }
    for (let slice = 0; slice < 5 && !done(); slice++) {
        const hp0 = bot.stat('hitpoints').cur;
        if (await opUntil(bot, label, t, 1, done, { level, every: 8, max: 60 })) return;
        if (dead(bot)) return;
        if (bot.stat('hitpoints').cur < hp0) {
            const me = bot.tile(); const near: number[] = [];
            for (let i = 0; i < bot.npcCount; i++) { const n = bot.npcs[bot.npcIndices[i]!]; const nt = n ? bot.npcTileOf(n) : null; if (n && nt && cheb(nt, me) <= 1) near.push(n.typeId); }
            console.log(`[upass] ${label}: hit while trying (hp ${hp0} -> ${bot.stat('hitpoints').cur}), npcs next to us ${JSON.stringify(near)}: fighting`);
            if (near.length) await fight(bot, near, { max: 80 });
        }
    }
    if (!done()) fail(bot, label);
}

/** stage 5 -> 6: down to the dwarves (tunnel B), Nilhoof, fill the bucket with brew */
const segNilhoof: Seg = async (bot, log) => {
    const lost = dollLost(bot);
    if (!lost && (has(bot, O.doll) || has(bot, O.brew))) return;
    if (bot.minusedlevel === 1) {
        await goIsland(bot, 'hub', log);
        await tunnel(bot, LL.tunnelDownB, 1, () => inLower(bot), 'tunnel down (B)');
        log('down tunnel B');
    }
    if (!inLower(bot)) fail(bot, 'not in the cavern');
    // session 11 fix 401c (UP_DOLL_NIL; qx409m: died at Kalrag, the doll dropped with the death; both retries went to Kardia's
    // chest, which at %upass >= 7 only says "the doll's gone" (kardia.rs2:95-104) -> 'witch chest (doll)' x2 = ROUTE STOPPED
    // qp 63): at =7 Nilhoof gives a new doll to a player without one (nilhoof.rs2:27-36; at =8 too, :43-53). What is already on
    // the doll lives in %ibanmulti bits (quest_upass.rs2:547-568, kalrag.rs2:29), so the new doll carries it. The brew is only
    // needed while the ashes are not on the doll (else the tomb gives "nothing", quest_upass.rs2:483-489).
    // TEST: UP_DOLL_TEST=1 / =2 (segTombKalrag). UP_DOLL_NIL=0 reverts.
    if (lost) {
        const ok = await converse(bot, N.nilhoof, { done: () => has(bot, O.doll) && bot.chatModalId === -1, stand: { x: 2316, z: 9805 }, near: 3, maxTicks: 200, label: 'nilhoof-doll' });
        if (!ok) fail(bot, 'Nilhoof (a new doll)');
        log('401c a new doll from Nilhoof (=7)');
        if (has(bot, O.brew) || GAME.has(`${who(bot)}:part${O.ashes}`)) return;
    }
    // session 11 fix 379b (UP_NIL_RE; qx274m retries 2-4 'Nilhoof' at (2315,9809)/(2316,9802) hp 64/57: attempt 1 had talked
    // (=6) and filled the brew; the retry's bank prep deposited the brew, 305d re-entered from 'enter', and the talk ran
    // again, but Nilhoof gives the pies only at =5 (nilhoof.rs2:2-19; at =6 just 'So you still live'), so 'done' never
    // came. Skip the talk when this process saw it or the resume is past it; the barrel needs only a bucket
    // (quest_upass.rs2:421-428). TEST: SR_FAIL_AT=upass:nilhoof (the retry banks the brew and re-enters); UP_NIL_RE=0 reverts.
    // fix 401d (apply401 edge case: a lost doll with no 379b markers, e.g. two retries in a row inside the pass, fell through to
    // the pie talk, which can't finish once the doll was found): a lost doll means Nilhoof was spoken to.
    if (process.env.UP_NIL_RE !== '0' && (lost || RE.nilhoofDone || GAME.has(`${who(bot)}:nilhoof`))) log('379b Nilhoof already spoken (=6): straight to the barrel');
    else {
        const pies0 = bot.count(objId('meat_pie'));
        const ok = await converse(bot, N.nilhoof, { done: () => bot.count(objId('meat_pie')) > pies0 && bot.chatModalId === -1, stand: { x: 2316, z: 9805 }, near: 3, maxTicks: 200, label: 'nilhoof' });
        if (!ok) fail(bot, 'Nilhoof');
        GAME.add(`${who(bot)}:nilhoof`);
        log('Nilhoof (=6)');
    }
    // forceapproach=south on an angle-1 barrel = its west side (2326,9799)
    if (!(await useOnLoc(bot, 'barrel', O.bucket, LL.barrel, () => has(bot, O.brew), { stand: { x: 2326, z: 9799 }, max: 40 }))
        && !(await useOnLoc(bot, 'barrel', O.bucket, LL.barrel, () => has(bot, O.brew), { stand: { x: 2328, z: 9799 }, max: 40 }))) fail(bot, 'dwarf brew');
    log('dwarf brew');
};
/** =6 -> 7: up tunnel A, Kardia's cat, the cat at her door, her chest -> the doll */
const segDoll: Seg = async (bot, log) => {
    if (has(bot, O.doll)) return;
    if (inLower(bot)) await tunnel(bot, LL.tunnelUpA, 0, () => bot.minusedlevel === 1, 'tunnel up (A)');
    const inHouse = () => inBox(bot, 2151, 4564, 2157, 4567, 1);   // walls x2150/2158, z4563/4568; door on the west edge of (2158,4566)
    // session 11 fix 379a (UP_CAT_GONE): a retry after the cat went in (the bit stays; a 2nd cat only gets 'busy playing with
    // her other cat', kardia.rs2:31, and stays in the pack): no cat, straight to the door
    let catIn = process.env.UP_CAT_GONE !== '0' && GAME.has(`${who(bot)}:cat`);
    if (!inHouse()) {
        if (!catIn && !has(bot, O.cat)) {
            await goIsland(bot, 'cat', log);
            await freeUp(bot, 4);   // cat now; doll + journal + 2 potions at the chest
            if (!npc(bot, N.cat)) await bot.walkTo(2133, 4600, { near: 3, maxTicks: 60, log: false });   // the cat wanders around (2131,4602)
            // session 9 (allchaos qu14m: 120 t of ops from the bridge end (2146,4583), never moved, 'pick up the cat'): 4 rounds of
            // 30 t, each after a door-aware walk next to the cat (UP_CAT_WALK=0 reverts)
            let ok = false;
            if (process.env.UP_CAT_WALK === '0') ok = await act(bot, 'cat', () => { const c = npc(bot, N.cat); if (!c) return false; opNpcGo(bot, c, 1); }, () => has(bot, O.cat), { every: 6, max: 120 });
            else for (let r = 0; r < 4 && !ok; r++) {
                const c0 = npc(bot, N.cat);
                if (r > 0 || !c0) { const t = c0 ? { x: c0.x, z: c0.z } : { x: 2133, z: 4600 }; await bot.walkTo(t.x, t.z, { near: 1, maxTicks: 40, log: false, level: 1 } as any); console.log(`[upass] cat round ${r + 1}: cat ${c0 ? `${c0.x},${c0.z} d${c0.d}` : 'not visible'} me ${JSON.stringify(bot.tile())}`); }
                ok = await act(bot, 'cat', () => { const c = npc(bot, N.cat); if (!c) return false; opNpcGo(bot, c, 1); }, () => has(bot, O.cat), { every: 6, max: 30 });
            }
            if (!ok) fail(bot, 'pick up the cat');
            log('cat');
        }
        await goIsland(bot, 'witch', log);
        if (!catIn && has(bot, O.cat)) {
            const t0 = bot.tickCount;
            // session 11 fix 379a (UP_CAT_GONE; qx274m 'cat at the door' at (2157,4568) hp 43: the engine restart (ws 1012) hit
            // while the drop label ran (kardia.rs2:69-78: inv_del cat, p_walk (2157,4568), p_delay 5, bit, THEN the message);
            // 38 t offline lost the only proof we waited for although the cat was in. The cat leaving the pack is proof too
            // (only that label deletes it; we never op5 it): accept it, then let the label's delay end before the door op1
            // (op1 without the bit = the witch's 25% hit). TEST: UP_CAT_TEST=1 ignores the message (as if lost).
            const gone = process.env.UP_CAT_GONE !== '0';
            const took = () => process.env.UP_CAT_TEST !== '1' && msgSince(bot, t0, /witch takes the cat inside/i);
            if (!(await useOnLoc(bot, 'cat on door', O.cat, LL.witchDoor, () => took() || (gone && !has(bot, O.cat)), { level: 1, stand: { x: 2158, z: 4566 }, max: 60 }))) fail(bot, 'cat at the door');
            if (gone) { for (let k = 0; k < 10 && !took(); k++) await bot.tick(1); GAME.add(`${who(bot)}:cat`); }
            catIn = true;
            log('the witch took the cat');
        }
        if (!(await opUntil(bot, 'witch door', LL.witchDoor, 1, inHouse, { level: 1, stand: { x: 2158, z: 4566 }, max: 60 }))) fail(bot, `witch door (cat in: ${catIn})`);
    }
    if (!(await opUntil(bot, 'witch chest', LL.witchChest, 1, () => has(bot, O.doll), { level: 1, max: 60 }))) fail(bot, 'witch chest (doll)');
    log('doll (=7)');
    GAME.add(`${who(bot)}:doll`);   // session 11 fix 401c (UP_DOLL_NIL): %upass 7 stays
    dropAllOf(bot, JUNK_AFTER_CHEST); await bot.tick(1);
    // out again: the door shuts behind us (open_and_close_door3), op it from inside
    if (inHouse() && !(await opUntil(bot, 'witch door out', LL.witchDoor, 1, () => !inHouse(), { level: 1, stand: { x: 2157, z: 4566 }, max: 40 }))) fail(bot, 'out of the witch house');
};
/** the three demons (amulets drop only at =7), the shut chest -> shadow; then onto the doll */
const segShadow: Seg = async (bot, log) => {
    if (has(bot, O.shadow) || bot.minusedlevel !== 1) return;
    await freeUp(bot, 4);   // 3 amulets + the shadow
    const amulets: Array<[number, number, Isl]> = [[N.doomion, O.dAmulet, 'dem'], [N.holthion, O.hAmulet, 'dem'], [N.othainian, O.oAmulet, 'oth']];
    for (const [type, am, isl] of amulets) {
        for (let k = 0; k < 4 && !has(bot, am); k++) {
            await goIsland(bot, isl, log);
            const g = bot.findGroundItem(am, 15);
            if (g) { await pickup(bot, am, { x: g.x, z: g.z }, 40); continue; }
            if (!npc(bot, type)) { await bot.tick(2); continue; }
            log(`fighting ${type}`);
            await upFight(bot, type, { max: 400, spell: SPELL || undefined, done: () => bot.findGroundItem(am, 15) !== undefined || has(bot, am) });
            if (dead(bot)) return;
        }
        if (!has(bot, am)) fail(bot, `amulet ${am}`);
        log(`amulet ${objDebugName(am)}`);
    }
    await goIsland(bot, 'dem', log);
    if (!(await opUntil(bot, 'shut chest', LL.shutChest, 1, () => has(bot, O.shadow), { level: 1, max: 60 }))) fail(bot, 'shut chest (shadow)');
    await onDoll(bot, O.shadow, log);
};
/** the tomb (brew, then tinderbox -> ashes) and Kalrag (blood on the doll), both in the cavern; in by tunnel A */
const segTombKalrag: Seg = async (bot, log) => {
    if (bot.minusedlevel === 1) {
        await goIsland(bot, 'hub', log);
        await tunnel(bot, LL.tunnelDownA, 1, () => inLower(bot), 'tunnel down (A)');
    }
    if (!inLower(bot)) fail(bot, 'tomb/kalrag: not in the cavern');
    // fix 401c TEST (UP_DOLL_TEST=1: drop the doll once here, as if lost with a death -> the guard below; =2: drop it and throw,
    // so the route retry banks, re-enters and segNilhoof gets the new doll = the qx409m path)
    if (/^[12]$/.test(process.env.UP_DOLL_TEST ?? '') && !GAME.has(`${who(bot)}:dolltest`) && has(bot, O.doll)) {
        GAME.add(`${who(bot)}:dolltest`); bot.dropItem(O.doll, bot.slot(O.doll)); bot.queueFlush(); await bot.until(() => !has(bot, O.doll), 6);
        log(`401c TEST: doll dropped (held ${has(bot, O.doll)})`);
        if (process.env.UP_DOLL_TEST === '2') fail(bot, '401c TEST: doll dropped, retry');
    }
    // fix 401c: found but not held here (a resume inside the pass skips segNilhoof): Nilhoof first, same cavern
    if (dollLost(bot)) await segNilhoof(bot, log);
    // fix 401c: ashes already on the doll -> the tomb gives nothing ('light the tomb' would fail): skip the brew/tomb
    if (has(bot, O.brew) && !(process.env.UP_DOLL_NIL !== '0' && GAME.has(`${who(bot)}:part${O.ashes}`))) {
        if (!(await useOnLoc(bot, 'brew on tomb', O.brew, LL.tomb, () => !has(bot, O.brew), { stand: { x: 2357, z: 9799 } }))) fail(bot, 'pour the brew');
        const tb = objId('tinderbox');
        if (!(await useOnLoc(bot, 'light tomb', tb, LL.tomb, () => has(bot, O.ashes), { stand: { x: 2357, z: 9799 } }))) fail(bot, 'light the tomb');
        log("Iban's ashes");
    }
    await onDoll(bot, O.ashes, log);
    // Kalrag: his death script smears the blood on the doll (kalrag.rs2:15-31); observable = its message
    const blood = (since: number) => msgSince(bot, since, /smear the doll of Iban in the poisoned blood|already collected Iban's blood/i);
    if (!blood(0)) {
        const t0 = bot.tickCount;
        // session 11 fix 401b (UP_KALRAG_LOCK; qx409m 'died in tombkalrag' -> doll lost -> 'witch chest (doll)' x2 = ROUTE STOPPED
        // qp 63): after the engine restart a blessed spider (977, huntrange 1, upass.npc:92) swung at us next to Kalrag, so every
        // fire wave at him was refused "I'm already under attack!" (single-way): eng [optrace] t24763ff 181 x OPNPCT on 997, the
        // retaliation on 977 cleared by each re-cast, no xp for ~500 t, sharks + pies gone, hp 52 -> 0. Fight in 60 t slices; a
        // refused cast ends the slice: kill the npc facing us next to us first (the sp-lib lockAttackers rule, fix 301), else let
        // the lock lapse (9 t). 401b2: out of food at hp <= 25% -> fail ALIVE (the doll and the quest items stay, 379c keep)
        // instead of dying. UP_KALRAG_LOCK=0 reverts. TEST (UP_KLOCK_TEST=1): first time per process, attack a blessed spider just
        // before Kalrag, so it holds the lock.
        const KLOCK = process.env.UP_KALRAG_LOCK !== '0';
        const slumped = () => msgSince(bot, t0, /Kalrag slumps to the floor/i);
        const holder = () => { const me = bot.tile(); for (let i = 0; i < bot.npcCount; i++) { const idx = bot.npcIndices[i]!; const n = bot.npcs[idx] as any; if (!n || n.typeId === N.kalrag || (n.faceEntity ?? -1) < 32768) continue; const t = bot.npcTileOf(n); if (cheb(t, me) <= 1) return { idx, type: n.typeId as number, x: t.x, z: t.z }; } return null; };
        for (let k = 0; k < 3 && !blood(t0); k++) {
            if (!npc(bot, N.kalrag)) await walk(bot, { x: 2350, z: 9905 }, 6, 'Kalrag');
            if (process.env.UP_KLOCK_TEST === '1' && !GAME.has(`${who(bot)}:klocktest`)) {
                GAME.add(`${who(bot)}:klocktest`);
                const sp = npcsOf(bot, [977]).sort((a, b) => a.d - b.d)[0];
                log(`401b TEST: blessed spider ${sp ? `${sp.x},${sp.z} d${sp.d}` : 'none in view'}: attacking it first`);
                if (sp) { opNpcGo(bot, sp, 2); bot.queueFlush(); await bot.until(() => holder() !== null, 20); }
            }
            log('fighting Kalrag');
            if (!KLOCK) await upFight(bot, N.kalrag, { max: 400, spell: SPELL || undefined, done: slumped }, process.env.UP_RUNE_TEST === '1');
            else for (const end = bot.tickCount + 400; bot.tickCount < end && !slumped() && !dead(bot);) {
                const s0 = bot.tickCount, refused = () => msgSince(bot, s0, /already under attack/i);
                await upFight(bot, N.kalrag, { max: Math.min(60, end - bot.tickCount), spell: SPELL || undefined, done: () => slumped() || refused() }, process.env.UP_RUNE_TEST === '1');
                if (dead(bot) || slumped()) break;
                if (foodCount(bot) === 0 && bot.stat('hitpoints').cur * 4 <= bot.stat('hitpoints').level) fail(bot, 'Kalrag: out of food (401b2: bailed out alive, the doll kept)');
                if (!refused()) continue;
                const h = holder();
                log(`401b Kalrag: cast refused 'already under attack': ${h ? `killing the lock holder ${h.type}@${h.x},${h.z} first` : 'no holder next to us: 9 t for the lock to lapse'}`);
                if (h) await upFight(bot, h.type, { max: 60, spell: SPELL || undefined, pick: l => l.find(q => q.idx === h.idx) ?? null, done: () => !npcsOf(bot, [h.type]).some(q => q.idx === h.idx) }, process.env.UP_RUNE_TEST === '1');
                else await bot.tick(9);
            }
            if (dead(bot)) return;
            await bot.until(() => blood(t0), 8);
        }
        if (!blood(t0)) fail(bot, 'Kalrag blood');
    }
    log('blood on the doll');
};
/** 277: eatWatch with a pause switch (Iban's temple runs its own best-food eater) */
const EAT = { pause: false };
function pausableEatWatch(bot: SpeedBot, pct: number): () => void {
    if (process.env.UP_TEMPLE_EAT === '0') return eatWatch(bot, pct);
    let stop = false, last = -10;
    (async () => {
        while (!stop && !bot.disposed) {
            if (!EAT.pause && bot.tickCount - last >= 3 && !inDialog(bot) && eatNow(bot, pct)) last = bot.tickCount;
            await bot.tick(1);
        }
    })();
    return () => { stop = true; EAT.pause = false; };
}
/** up tunnel B, the dove's cage, then the bridges to the temple; robes only, the doll into the pit (=9) */
const segTemple: Seg = async (bot, log) => {
    if (inLower(bot)) await tunnel(bot, LL.tunnelUpB, 0, () => bot.minusedlevel === 1, 'tunnel up (B)');
    if (bot.minusedlevel !== 1) return;   // already thrown out (=9)
    if (!has(bot, O.dove) && !msgSince(bot, 0, /rub it into the doll/i)) {
        await goIsland(bot, 'cage', log);
        // the cage (2x2 at 2134-2135,4702-4703) is walled in; its south side (2134,4701) is reached round by x2131/2133
        await freeUp(bot, 1);
        if (!(await opUntil(bot, 'dove cage', LL.cage, 1, () => has(bot, O.dove), { level: 1, stand: { x: 2134, z: 4701 }, every: 8, max: 60 }))) fail(bot, 'dove');
    }
    await onDoll(bot, O.dove, log);
    await goIsland(bot, 'temple', log);
    // robe-only door (quest_upass.rs2:586): worn = exactly the Zamorak robe top + bottom
    // (a wear sent while a bridge jump's exactmove still runs is dropped: retry until both are on)
    for (let k = 0; k < 4 && !['zamrobetop', 'zamrobebottom'].every(r => bot.isWorn(objId(r))); k++) {
        for (const r of ['zamrobetop', 'zamrobebottom']) if (!bot.isWorn(objId(r))) await wear(bot, r);
    }
    await unequipExcept(bot, ['zamrobetop', 'zamrobebottom']);
    log(`worn: ${wornIds(bot).map(objDebugName).join(', ')}`);
    // fix 280: the food carried to the temple door (the kit's 15 sharks, minus what the pass cost)
    log(`280 temple door: food ${bot.inv().filter(x => foodIds().includes(x.obj)).length} (sharks ${bot.count(objId('shark'))}), hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level}, free ${bot.free()}`);
    const inTemple = () => inBox(bot, 2125, 4635, 2142, 4660, 1);
    // session 11 fix 277 (UP_TEMPLE_EAT): qx29m DIED 'doll into the pit' hp 0 at (2140,4647). Iban's ai_timer (timer=10,
    // lord_iban.rs2) fires 8 rounds x 25 bolts on the 6x12 box (2136-2141, 4639-4650): each hit 5-10 hp + a 1-tile push east
    // (cancels the doll op). act() eats INSTEAD of the op below 50% (eatNow -> continue) and eats the CHEAPEST food first
    // (half meat pies, 3 hp), so once under 50% the doll was never re-sent and the bot ate pies under the bolts until dead
    // (other runs: qx01 62 -> 14, qx03 66 -> 15 in the same step). Fix: top up best food first to level-12 before the door;
    // in the temple the generic eater is paused, a best-food eater runs at < 60% (3 t apart) and the doll op is re-sent
    // every 3 t regardless; out of food at <= 12 hp (bolts hit 5-10) -> walk out of the temple and fail cleanly (no death;
    // the route retry cannot re-enter the pass, so it STOPS alive: qyp04 TEST). Observed: ~0.55 hp/t in the bolt box.
    // UP_TEMPLE_EAT=0 reverts. TEST: UP_TEMPLE_TEST=<ticks> stands in the bolt box that long before the throw.
    const T277 = process.env.UP_TEMPLE_EAT !== '0';
    const hpNow = () => bot.stat('hitpoints').cur, hpMax = () => bot.stat('hitpoints').level;
    const eatBest = (): boolean => {   // FOODS is best-first: eat the lowest index we hold
        const ids = foodIds(); const s = bot.inv().filter(x => ids.includes(x.obj)).sort((a, b) => ids.indexOf(a.obj) - ids.indexOf(b.obj))[0];
        if (!s || hpNow() <= 0) return false;
        bot.opHeld1(s.obj, s.slot); bot.queueFlush(); return true;
    };
    if (T277) {
        for (let k = 0; k < 6 && hpNow() < hpMax() - 12 && eatBest(); k++) await bot.tick(3);
        log(`277 topped up: hp ${hpNow()}/${hpMax()}, food ${bot.inv().filter(x => foodIds().includes(x.obj)).length}`);
    } else for (let k = 0; k < 4 && bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 20 && eatNow(bot, 1); k++) await bot.tick(3);   // top up before the bolts
    if (!(await opUntil(bot, 'temple door', LL.templeDoor, 1, inTemple, { level: 1, stand: { x: 2144, z: 4647 }, max: 40 }))) fail(bot, 'temple door (robes? doll complete?)');
    log('in the temple (=8)');
    const t0 = bot.tickCount;
    const destroyed = () => has(bot, 'ibanstaff') || msgSince(bot, t0, /Iban slumps motionless/i);
    if (T277) {
        EAT.pause = true;
        let stop = false, last = -10, eats = 0, bail = false;
        (async () => {
            while (!stop && !bot.disposed) {
                if (bot.tickCount - last >= 3 && hpNow() > 0 && hpNow() < Math.max(25, hpMax() * 0.6) && eatBest()) { last = bot.tickCount; eats++; }
                await bot.tick(1);
            }
        })();
        try {
            const test = Number(process.env.UP_TEMPLE_TEST || 0);
            if (test > 0) {   // TEST: stand in the bolt box to draw Iban's fire, eater on
                await bot.walkTo(2139, 4645, { near: 0, maxTicks: 10, log: false });
                const te = bot.tickCount + test;
                while (bot.tickCount < te && !dead(bot) && !(hpNow() <= 12 && !bot.inv().some(x => foodIds().includes(x.obj)))) await bot.tick(1);
                log(`277 TEST: ${test} t in the bolt box, hp ${hpNow()}/${hpMax()}, ${eats} eats`);
            }
            const out = () => { if (hpNow() <= 12 && !bot.inv().some(x => foodIds().includes(x.obj))) bail = true; return bail; };
            const l = locAt(LL.altar.id, LL.altar.x, LL.altar.z, 1), stand = { x: 2138, z: 4647 };
            if (!destroyed() && !out() && cheb(bot.tile(), stand) > 0) await bot.walkTo(stand.x, stand.z, { maxTicks: 20, log: false });
            const ok = await act(bot, 'doll in the pit', () => { const sl = bot.slot(O.doll); if (sl < 0) return false; routeToLoc(bot, l, stand); bot.useItemOnLoc(l.x, l.z, l.id, O.doll, sl); bot.queueFlush(); },
                () => destroyed() || out(), { every: 3, max: 60, eatPct: 0 });
            log(`277 temple: ${eats} eats, hp ${hpNow()}/${hpMax()}, ${bot.tickCount - t0} t${bail ? ' BAIL (no food)' : ''}`);
            if (bail && !destroyed()) {
                // out through the temple door from inside (open_iban_door else-branch: 'walk out of the temple')
                await opUntil(bot, 'temple door (out)', LL.templeDoor, 1, () => !inTemple(), { level: 1, max: 20, every: 3 });
                fail(bot, `temple: out of food at hp ${hpNow()}, left the temple`);
            }
            if (!ok || !destroyed()) fail(bot, 'doll into the pit');
        } finally { stop = true; EAT.pause = false; }
    } else
    // the pit/altar is 2x2 (2136-2137, 4647-4648): use the doll from its east side; Iban's bolts (5-10 hp) rain here
    if (!(await useOnLoc(bot, 'doll in the pit', O.doll, LL.altar, () => has(bot, 'ibanstaff') || msgSince(bot, t0, /Iban slumps motionless/i), { level: 1, stand: { x: 2138, z: 4647 }, every: 4, max: 60 }))) fail(bot, 'doll into the pit');
    log('Iban destroyed (=9)');
    // the collapse throws us to (2482,9607) a few ticks later (quest_upass.rs2:679-693)
    if (!(await bot.until(() => bot.minusedlevel === 0 && bot.tile().z > 9500, 30))) fail(bot, 'not thrown out of the temple');
};

/** =9 -> done: Ardougne teleport, the castle, King Lathas (queue upass_quest_complete: qp +5, king_lathas.rs2:81-87) */
const segFinish: Seg = async (bot, log) => {
    const q0 = qp(bot);
    if (underground(bot)) {
        const r = await tele(bot, 'ardougne_teleport');
        if (!r.ok) fail(bot, 'Ardougne teleport (magic 51 + 2 law + 2 water)');
        log('teleported to Ardougne');
    }
    await castleUp(bot, log);
    const done = () => qp(bot) >= q0 + QUEST.qp || msgSince(bot, 0, /completed the/i);
    const ok = await talkLathas(bot, done, log);
    if (!ok && !(await bot.until(done, 10))) fail(bot, 'King Lathas: quest not completed');
    log(`QUEST COMPLETE (qp ${q0} -> ${qp(bot)})`);
};

/** revisit: island hops to the temple, then the temple door from the east sends a Regicide player (stage >= 2) to the
 *  Well of Voyage side, (2014,4711) L1 (quest_upass.rs2:575-584) */
const segToWell: Seg = async (bot, log) => {
    const atWellSide = () => bot.minusedlevel === 1 && bot.tile().x < 2100 && bot.tile().z > 4650;
    if (atWellSide()) return;
    await goIsland(bot, 'temple', log);
    if (!(await opUntil(bot, 'temple door (west)', LL.templeDoor, 1, atWellSide, { level: 1, stand: { x: 2144, z: 4647 }, max: 40 }))) fail(bot, 'temple door to the well (Regicide stage >= 2?)');
    log('through the temple: the Well of Voyage side');
};
/** Regicide: from King Lathas back through the pass to the Well of Voyage side of Iban's temple (same account, quest done) */
export const REVISIT: Array<[string, Seg]> = [['enter', async (b, l) => segEnter(b, l)], ['bridge', async (b, l) => segBridge(b, l)],
    ['swing', async (b, l) => segSwing(b, l)], ['grid', async (b, l) => segGrid(b, l)], ['well', async (b, l) => segOrbs(b, l)],
    ['area2', async (b, l) => segArea2(b, l)], ['door', async (b, l) => segPaladins(b, l)], ['towell', segToWell]];
export async function passToWell(bot: SpeedBot, log: (s: string) => void, splits: Record<string, number> = {}): Promise<void> {
    await nav();
    MODE.revisit = true;
    try {
        for (const [name, seg] of REVISIT) { const s0 = bot.tickCount; await seg(bot, log); splits[`pass.${name}`] = bot.tickCount - s0; if (dead(bot)) fail(bot, `died in the pass (${name})`); }
    } finally { MODE.revisit = false; }
}

export const SEGMENTS: Array<[string, Seg]> = [['lathas', segLathas], ['enter', segEnter], ['bridge', segBridge], ['swing', segSwing], ['grid', segGrid], ['orbs', segOrbs], ['area2', segArea2], ['paladins', segPaladins],
    ['nilhoof', segNilhoof], ['doll', segDoll], ['shadow', segShadow], ['tombkalrag', segTombKalrag], ['temple', segTemple], ['finish', segFinish]];

export async function run(bot: SpeedBot, o: { log?: boolean; from?: string } = {}): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'upass', o.log !== false);
    const t0 = bot.tickCount, splits: Record<string, number> = {};
    trace(bot, t0);
    // 277: the generic eater pauses in Iban's temple (its cheapest-first bites take the eat delay from the sharks)
    const stopEat = pausableEatWatch(bot, 0.5);
    // wear the Zamorak robes from the start: 2 pack slots back (the 4 orbs and the lair items need the room), and the
    // temple wants exactly them worn anyway (quest_upass.rs2:586)
    for (let k = 0; k < 3 && ['zamrobetop', 'zamrobebottom'].some(r => has(bot, r) && !bot.isWorn(objId(r))); k++)
        for (const r of ['zamrobetop', 'zamrobebottom']) if (has(bot, r)) await wear(bot, r);
    // session 11 fix 305d (UP_REENTER; qx66m/qx67m: the retry banked, so it starts OUTSIDE the pass, and resumed at 'bridge' /
    // 'grid': 'rockslide 2478,9721' at (2727,3340), 'grid pit hand holds' at (2573,3296), route-stopper x2). Check where we
    // are: a resume past 'enter' that is not underground re-enters (the entrance works any time after Koftik #1,
    // quest_upass.rs2:80-96) and walks the pass again from 'enter' (each segment skips by position; the bridge must be shot
    // again, the grid digits are remembered); what stays done in the game is skipped: past 'orbs' the 4 orb bits are set
    // (well only), past 'paladins' the skull door just opens (no horn / paladins). 'finish' runs from anywhere.
    // TEST: SR_FAIL_AT=upass:<segment> throws once right after that segment (the route retry banks: outside).
    const names = SEGMENTS.map(x => x[0]);
    let from = o.from;
    RE.orbsDone = false; RE.area2Done = false; RE.paladinsDone = false; RE.nilhoofDone = false; RE.dollDone = false;
    if (process.env.UP_REENTER !== '0' && from && names.indexOf(from) > names.indexOf('enter') && from !== 'finish' && !underground(bot) && !inLair(bot)) {
        RE.orbsDone = names.indexOf(from) > names.indexOf('orbs');
        RE.area2Done = names.indexOf(from) > names.indexOf('area2');
        RE.paladinsDone = names.indexOf(from) > names.indexOf('paladins');
        RE.nilhoofDone = names.indexOf(from) > names.indexOf('nilhoof');   // session 11 fix 379b (UP_NIL_RE): %upass 6 stays
        RE.dollDone = names.indexOf(from) > names.indexOf('doll');   // session 11 fix 401c (UP_DOLL_NIL): %upass 7 stays
        log(`305d resume '${from}' but outside the pass at (${bot.tile().x},${bot.tile().z},L${bot.minusedlevel}): re-entering from 'enter' (orbs done ${RE.orbsDone}, paladins done ${RE.paladinsDone})`);
        from = 'enter';
    }
    let started = !from;
    for (const [name, seg] of SEGMENTS) {
        if (!started && name === from) started = true;
        if (!started) continue;
        const s0 = bot.tickCount;
        await seg(bot, log);
        if (dead(bot)) { stopEat(); return { ok: false, ticks: bot.tickCount - t0, msg: `died in ${name}`, splits }; }
        splits[name] = bot.tickCount - s0;
        log(`== ${name} done in ${splits[name]} t`);
        failHook(`upass:${name}`);
        if (process.env.UPASS_TO === name) { stopEat(); return { ok: false, ticks: bot.tickCount - t0, msg: `stopped after ${name} (UPASS_TO)`, splits }; }
    }
    stopEat();
    const ok = qp(bot) > 0 && !underground(bot) && bot.minusedlevel === 1 && cheb(bot.tile(), T.lathas) <= 4;
    return { ok, ticks: bot.tickCount - t0, msg: ok ? 'King Lathas: Underground Pass complete' : 'not finished', splits };
}

// =====================================================================================================
// extract-wood-sites.ts — GENERATOR for headless/data/wood-sites.json
// =====================================================================================================
//
//   cd server/webclient && bun headless/data/extract-wood-sites.ts
//   bun headless/data/extract-wood-sites.ts --dry        # print the summary, write nothing
//   bun headless/data/extract-wood-sites.ts --lot=16     # lot radius (default 16 — see CAPACITY)
//
// ⛔ NOTHING IN THE OUTPUT IS HAND-TYPED. Every tile comes from `loc-scene`, which is the packed map
// data the engine itself loads (`server/content/maps/m*_*.jm2`), and every tree id comes from
// `skilling-tables.ts`'s `TREE_BY_LOC`, which is generated from `skill_woodcutting/configs/trees.dbrow`.
// The one thing a human chose is the LOT RADIUS, and the capacity model below is calibrated against two
// live measurements rather than assumed.
//
// -----------------------------------------------------------------------------------------------------
// THE SUPPLY PHYSICS, FROM THE CONTENT (skill_woodcutting/scripts/woodcut.rs2:117-141)
// -----------------------------------------------------------------------------------------------------
//   def_int $deplete_chance = 8;                       // 1/8 for every tree with a dbrow respawnrate
//   if ($respawnrate = 0) {                            // ...but NORMAL trees have respawnrate 0:
//       $respawnrate = add(120, random(80));           //   120..199 ticks, and
//       $deplete_chance = 0;                           //   `random(0) = 0` is ALWAYS true, so
//   }                                                  //   a normal tree DEPLETES ON EVERY LOG.
//   if (random($deplete_chance) = 0) { loc_change(next_loc_stage, ~scale_by_playercount($respawnrate)); }
//
// So: a NORMAL tree (and every dead tree / evergreen — they are all `normal_tree_table`) yields exactly
// ONE log and then respawns after 120+rnd(80) ticks, mean 159.5. An OAK/WILLOW/MAPLE/YEW/MAGIC yields
// ~8 logs per depletion (1/8 chance) on a fixed respawnrate. That difference is a factor of EIGHT in
// site supply and it is why `treesEquivalent` below is not just a tree count.
//
// -----------------------------------------------------------------------------------------------------
// ⭐ THE CAPACITY MODEL — CALIBRATED, NOT GUESSED
// -----------------------------------------------------------------------------------------------------
// Two live measurements at the Lumbridge wood line (3230,3230), which this generator reproduces exactly
// from the map data:
//     radius 12 -> 2 normal trees -> feeds exactly 1 bot
//     radius 16 -> 7 normal trees -> feeds 3 bots
//     (3 bots on the radius-12 lot STALLED: treeWait=9,634 ticks)
// `floor(trees / 2)` is the only simple rule that reproduces BOTH points (2/2 = 1; 7/2 = 3.5 -> 3), so
// TREES_PER_BOT = 2. It is a per-bot SHARE of a respawn queue, not a claim that a bot works two trees.
//
// ⛔ AND IT IS A CEILING, NOT A TARGET. Even at capacity this lane is TREE-SUPPLY BOUND: 2 trees at a
// 159.5-tick mean respawn is one log per ~80 ticks per bot, which at the demo's 300ms is ~150 logs/hr
// for the whole lot. `logsPerHr` is emitted per site so an allocator can rank sites by SUPPLY rather
// than by bot slots, and so nobody quotes an xp/hr that the trees cannot physically produce.
// =====================================================================================================
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as locScene from '../loc-scene.js';
import { TREE_BY_LOC, TREES, type TreeEntry } from '../skilling-tables.js';

const OUT = join(import.meta.dir, 'wood-sites.json');
const argOf = (n: string, d: number): number => {
    const hit = process.argv.find(a => a.startsWith(`--${n}=`));
    return hit ? Number(hit.slice(n.length + 3)) : d;
};

/** Lot radius in tiles. 16 is the measured sweet spot: r12 held 1 bot, r16 held 3. */
const LOT_RADIUS = argOf('lot', 16);
/** A lot with fewer trees than this is not a site; it is a tree. */
const MIN_TREES = argOf('min-trees', 2);
/** Calibrated at the Lumbridge lot — see THE CAPACITY MODEL. */
const TREES_PER_BOT = argOf('trees-per-bot', 2);
/**
 * ⛔ THE LARGEST BOT-COUNT ANYONE HAS ACTUALLY MEASURED ON ONE LOT. Beyond this, `capacity` is an
 * EXTRAPOLATION of a two-point calibration and is labelled as one (`confidence`). It matters: the
 * densest lot in the world holds 257 trees, which the model happily reads as room for 128 woodcutters — a number nobody
 * has ever observed and which quietly assumes tree contention is the ONLY thing that scales. The
 * allocator therefore defaults to this cap, so a large group spreads over many lots instead of
 * piling onto three forests on the strength of arithmetic.
 */
const MEASURED_MAX_BOTS = argOf('measured-max', 3);
/** Ticks. `120 + random(80)`, mean. Only normal trees use it; the rest carry their own respawnrate. */
const NORMAL_RESPAWN_MEAN = 159.5;
/** `$deplete_chance = 8` -> expected logs before a depletion, for every non-normal tree. */
const LOGS_PER_DEPLETION_TIERED = 8;
/** The demo realm's tick, for the `logsPerHr` figure (fly.toml:19 NODE_TICKRATE=300). */
const TICK_MS = 300;

// -----------------------------------------------------------------------------------------------------
// 1. EVERY PLACED TREE, from the map data
// -----------------------------------------------------------------------------------------------------
console.log('[ws] building loc-scene...');
locScene.init();
const st = locScene.stats();
console.log(`[ws] loc-scene: ${st.placedLocs} placed locs, ${st.mapSquares} map squares, ${st.buildMs}ms`);

/** The DISPLAY names the tree loc ids resolve to — derived, never typed. */
const treeNames = new Set<string>();
for (const id of TREE_BY_LOC.keys()) { const n = locScene.locName(id); if (n) treeNames.add(n); }
const NAME_RE = new RegExp(`^(${[...treeNames].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i');
console.log(`[ws] tree display names (${treeNames.size}): ${[...treeNames].join(', ')}`);

interface Tree { x: number; z: number; id: number; row: TreeEntry }
const trees: Tree[] = locScene
    .findInBox(NAME_RE, { minX: 0, maxX: 4095, minZ: 0, maxZ: 12000, level: 0 })
    .flatMap(l => { const row = TREE_BY_LOC.get(l.id); return row ? [{ x: l.x, z: l.z, id: l.id, row }] : []; });
console.log(`[ws] ${trees.length} placed tree locs on level 0`);

/** Bank booths, so a FIREMAKING lane can avoid a bank zone (area_allow_loc_add refuses a fire inside one). */
const banks = locScene.findInBox(/^bank booth$/i, { minX: 0, maxX: 4095, minZ: 0, maxZ: 12000, level: 0 });
console.log(`[ws] ${banks.length} bank booths on level 0 (used only for the fireSafe flag)`);

// -----------------------------------------------------------------------------------------------------
// 2. GREEDY DENSEST-FIRST CLUSTERING
// -----------------------------------------------------------------------------------------------------
// ⛔ GREEDY DENSEST-FIRST, NOT A GRID. A fixed grid splits a dense wood line straight down the middle
// and turns one 3-bot lot into two 1-bot lots — an under-count that makes it look as if you need
// twice the sites. Repeatedly taking the densest remaining neighbourhood keeps a wood line whole.
const CELL = LOT_RADIUS;
const cellKey = (x: number, z: number): number => ((x / CELL) | 0) * 100000 + ((z / CELL) | 0);
const grid = new Map<number, Tree[]>();
for (const t of trees) {
    const k = cellKey(t.x, t.z);
    const b = grid.get(k); if (b) b.push(t); else grid.set(k, [t]);
}
const claimed = new Set<Tree>();
function neighbours(x: number, z: number): Tree[] {
    const out: Tree[] = [];
    const cx = (x / CELL) | 0, cz = (z / CELL) | 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const b = grid.get((cx + dx) * 100000 + (cz + dz));
        if (!b) continue;
        for (const t of b) {
            if (claimed.has(t)) continue;
            if (Math.max(Math.abs(t.x - x), Math.abs(t.z - z)) <= LOT_RADIUS) out.push(t);
        }
    }
    return out;
}

interface Lot { seed: Tree; members: Tree[] }
const lots: Lot[] = [];
{
    // One density pass, then re-score only the seeds whose neighbourhood a claimed lot touched. A full
    // re-score every round is O(n^2) and this table is regenerated by hand, so keep it honest but cheap.
    let pool = trees.slice();
    while (pool.length > 0) {
        let best: Tree | null = null, bestN: Tree[] = [];
        for (const t of pool) {
            if (claimed.has(t)) continue;
            const n = neighbours(t.x, t.z);
            if (n.length > bestN.length) { best = t; bestN = n; }
        }
        if (!best || bestN.length < MIN_TREES) break;
        for (const t of bestN) claimed.add(t);
        lots.push({ seed: best, members: bestN });
        pool = pool.filter(t => !claimed.has(t));
    }
}
console.log(`[ws] ${lots.length} lots of >=${MIN_TREES} trees at radius ${LOT_RADIUS} ` +
    `(${claimed.size}/${trees.length} trees claimed)`);

// -----------------------------------------------------------------------------------------------------
// 3. ANCHOR = A STANDABLE TILE, NOT A TREE TILE
// -----------------------------------------------------------------------------------------------------
// ⛔ THE MEDOID OF A WOOD IS USUALLY A TREE, AND A TREE TILE IS NOT STANDABLE. A site whose anchor the
// bot can never occupy makes the drift walk fail forever and the whole lot reads as unreachable. Search
// outward from the centroid for a tile carrying NO named loc at all — the cheapest stand-in for walkable
// that the static index can answer, and it is right far more often than the centroid is.
function anchorFor(members: Tree[]): { x: number; z: number } {
    const cx = Math.round(members.reduce((a, t) => a + t.x, 0) / members.length);
    const cz = Math.round(members.reduce((a, t) => a + t.z, 0) / members.length);
    for (let r = 0; r <= 6; r++) {
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = cx + dx, z = cz + dz;
            if (locScene.getLocsAt(x, z, 0).length === 0) return { x, z };
        }
    }
    return { x: cx, z: cz };
}

// -----------------------------------------------------------------------------------------------------
// 4. EMIT
// -----------------------------------------------------------------------------------------------------
/** Expected logs per hour a tree of this row supplies, at TICK_MS. */
function logsPerHr(row: TreeEntry): number {
    const respawn = row.respawn > 0 ? row.respawn : NORMAL_RESPAWN_MEAN;
    const logsPerCycle = row.respawn > 0 ? LOGS_PER_DEPLETION_TIERED : 1;
    return logsPerCycle * 3_600_000 / (respawn * TICK_MS);
}

const rows = lots.map(lot => {
    const anchor = anchorFor(lot.members);
    const byTier: Record<string, number> = {};
    let supply = 0, minLevel = 99;
    for (const t of lot.members) {
        byTier[t.row.table] = (byTier[t.row.table] ?? 0) + 1;
        supply += logsPerHr(t.row);
        if (t.row.level < minLevel) minLevel = t.row.level;
    }
    const chopNow = lot.members.filter(t => t.row.level === 0).length;
    // ⭐ AND THE HEADLINE `capacity` IS COUNTED ON THE EXACT BASIS THAT WAS MEASURED: locs whose DISPLAY
    // name is "Tree", because that is what `/^tree$/i` selected in both live runs. `Dead tree` and
    // `Evergreen` are the SAME `normal_tree_table` row (same respawn, same `logs`, same 25 xp) and the
    // emitted `treePattern` does include them — so `capacity` is deliberately CONSERVATIVE rather than
    // silently extended onto a basis nobody has ever run a bot against. `capacityWide` is that
    // extension, reported and labelled, for whoever measures it next.
    const namedTree = lot.members.filter(t => t.row.level === 0 && locScene.locName(t.id).toLowerCase() === 'tree').length;
    /** the level-0 display names actually present here — the pattern the bot should match. */
    const l0Names = [...new Set(lot.members.filter(t => t.row.level === 0).map(t => locScene.locName(t.id)))].sort();
    const bank = banks.reduce((best, b) =>
        Math.min(best, Math.max(Math.abs(b.x - anchor.x), Math.abs(b.z - anchor.z))), Infinity);
    const bbox = lot.members.reduce((b, t) => ({
        x0: Math.min(b.x0, t.x), x1: Math.max(b.x1, t.x), z0: Math.min(b.z0, t.z), z1: Math.max(b.z1, t.z),
    }), { x0: 9999, x1: 0, z0: 99999, z1: 0 });
    return {
        id: `wood-${anchor.x}-${anchor.z}`,
        anchor, radius: LOT_RADIUS, level: 0,
        mapsquare: `${anchor.x >> 6}_${anchor.z >> 6}`,
        trees: lot.members.length,
        treesLevel0: chopNow,
        /** locs whose display name is exactly "Tree" — THE BASIS `capacity` IS CALIBRATED ON. */
        treesNamedTree: namedTree,
        minLevel,
        byTier,
        /** ANCHORED regex source for this site's choppables. `^(...)$` — a bare substring also matches
         *  `Tree stump`, the loc with no chop op that stands exactly where the felled tree was. */
        treePattern: `^(${l0Names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
        /** SUPPLY, not slots: expected logs/hr from every tree in the lot at NODE_TICKRATE=300. */
        logsPerHr: Math.round(supply),
        /** bots this lot supports without oversubscription — see THE CAPACITY MODEL. Measured basis. */
        capacity: Math.floor(namedTree / TREES_PER_BOT),
        /** the same rule over EVERY level-0 choppable. Mechanically identical trees, UNMEASURED basis. */
        capacityWide: Math.floor(chopNow / TREES_PER_BOT),
        /** 'measured' while capacity is inside the live-observed envelope (<= 3 bots); else 'extrapolated'. */
        confidence: (Math.floor(namedTree / TREES_PER_BOT) <= MEASURED_MAX_BOTS ? 'measured' : 'extrapolated') as 'measured' | 'extrapolated',
        /** Chebyshev tiles to the nearest bank booth. A FIREMAKING lane needs this > ~16. */
        bankDist: Number.isFinite(bank) ? bank : -1,
        bbox,
        tiles: lot.members.map(t => ({ x: t.x, z: t.z, id: t.id })).sort((a, b) => a.x - b.x || a.z - b.z),
    };
}).filter(s => s.capacityWide > 0)
    .sort((a, b) => b.capacity - a.capacity || b.logsPerHr - a.logsPerHr || a.id.localeCompare(b.id));

const totalCapacity = rows.reduce((n, s) => n + s.capacity, 0);
const cappedCapacity = rows.reduce((n, s) => n + Math.min(s.capacity, MEASURED_MAX_BOTS), 0);
console.log(`[ws] ${rows.length} sites with capacity >= 1: ${totalCapacity} bots by the model, ` +
    `${cappedCapacity} inside the measured envelope (<=${MEASURED_MAX_BOTS}/site), ` +
    `median supply ${rows.map(s => s.logsPerHr).sort((a, b) => a - b)[rows.length >> 1]} logs/hr/site`);
console.log(`[ws] top 5 by capacity: ${rows.slice(0, 5).map(s => `${s.id}(${s.capacity}b,${s.trees}t,${s.confidence})`).join(' ')}`);
console.log(`[ws] confidence: ${rows.filter(s => s.confidence === 'measured').length} measured, ` +
    `${rows.filter(s => s.confidence === 'extrapolated').length} extrapolated`);

// -----------------------------------------------------------------------------------------------------
// ⛔ THE TWO LIVE MEASUREMENTS ARE RE-DERIVED FROM THE MAP DATA AND ASSERTED HERE, so a change to the
// clustering, the radius or the tree-name resolution that silently stops reproducing them fails IN THE
// GENERATOR rather than on a live ramp. These are not the clustered lots — they are the raw counts
// the live runs were measured against, which is the only thing the calibration can honestly be checked
// against. `LUMBRIDGE_WOOD` in wood-sites.ts is exactly the radius-12 point.
// -----------------------------------------------------------------------------------------------------
const CAL = { x: 3230, z: 3230 };
const around = (r: number) => trees.filter(t => t.row.level === 0
    && locScene.locName(t.id).toLowerCase() === 'tree'
    && Math.max(Math.abs(t.x - CAL.x), Math.abs(t.z - CAL.z)) <= r).length;
const cal12 = around(12), cal16 = around(16);
const calOk = cal12 === 2 && cal16 === 7
    && Math.floor(cal12 / TREES_PER_BOT) === 1 && Math.floor(cal16 / TREES_PER_BOT) === 3;
console.log(`[ws] CALIBRATION @(${CAL.x},${CAL.z}): r12=${cal12} trees -> ${Math.floor(cal12 / TREES_PER_BOT)} bot(s) ` +
    `(live: 2 trees, 1 bot) | r16=${cal16} trees -> ${Math.floor(cal16 / TREES_PER_BOT)} bot(s) (live: 7 trees, 3 bots) ` +
    `=> ${calOk ? 'REPRODUCED' : '⛔ DIVERGED'}`);
if (!calOk) {
    console.error('[ws] ⛔ REFUSING TO WRITE: the capacity model no longer reproduces the live measurements it ' +
        'was calibrated on. Either the map data changed or the model did; do not ship a table whose ' +
        'capacity column is unanchored.');
    process.exit(1);
}

const payload = {
    $schema: 'wood-sites.schema — see headless/wood-sites.ts for the typed contract',
    generatedBy: 'headless/data/extract-wood-sites.ts',
    generatedAt: new Date().toISOString().slice(0, 10),
    provenance: {
        maps: 'server/content/maps/m*_*.jm2 via headless/loc-scene.ts (the packed data the engine loads)',
        treeIds: 'headless/skilling-tables.ts TREE_BY_LOC, generated from skill_woodcutting/configs/trees.dbrow',
        depletion: 'skill_woodcutting/scripts/woodcut.rs2:117-141 ($deplete_chance = 0 for respawnrate-0 rows)',
        respawnNormal: '120 + random(80) ticks, mean 159.5 (woodcut.rs2:126-129)',
        respawnTiered: 'the dbrow respawnrate, with an expected 8 logs per depletion (1/8 chance)',
        tickMs: TICK_MS,
        capacityCalibration: 'LIVE: radius-12 lot (2 normal trees) fed 1 bot; radius-16 (7 trees) fed 3; ' +
            '3 bots on the radius-12 lot stalled at treeWait=9,634. floor(trees/2) reproduces both.',
    },
    model: {
        lotRadius: LOT_RADIUS, minTrees: MIN_TREES, treesPerBot: TREES_PER_BOT,
        measuredMaxBots: MEASURED_MAX_BOTS, tickMs: TICK_MS,
        calibration: { r12Trees: cal12, r12Bots: 1, r16Trees: cal16, r16Bots: 3, at: CAL },
    },
    totals: {
        sites: rows.length, capacity: totalCapacity, capacityMeasuredEnvelope: cappedCapacity,
        placedTrees: trees.length, clustered: claimed.size,
    },
    sites: rows,
};

if (process.argv.includes('--dry')) {
    console.log('[ws] --dry: nothing written');
} else {
    writeFileSync(OUT, JSON.stringify(payload, null, 1));
    console.log(`[ws] wrote ${OUT} (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
}

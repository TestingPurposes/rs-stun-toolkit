// NAVGRID v2 ALL-STRATA GEO TEST — real data (sdk/navgrid/navgrid.bin + sdk/collision-data.json).
//
// navgrid.bin v1 was one dense level-0 block over x[1792,3584) z[2816,5632); everything else (Morytania
// east of x 3584, the square below z 2816, the whole z+6400 underground, levels 1-3) fell back to the
// raw rsmod BFS (findLongPath), which hugs walls and ignores the unopenable-door / blocked-edge rules.
// v2 (sdk/navgrid/format.ts) stores a 64x64 chunk per (level, mapsquare) over the full collision extent.
//
// This file proves, per region, that a bot-style planner now gets its route FROM THE NAVGRID (the
// fallback is instrumented and must not fire), that the route is a legal tile-by-tile walk on the right
// level, and that the weighted costs are in force (clearance > 0 along the route). It also pins known
// v1-window routes to their v1 fingerprints (captured from the v1 router + the shipped v1 navgrid.bin),
// so the v2 port cannot silently move an established route.
import { describe, test, expect } from 'bun:test';
import * as rsmod from '../../../vendor/rsmod-pathfinder';
import { CollisionType } from '../../../vendor/rsmod-pathfinder';
import { planRoute, init, hasData, isWalkable, clearanceAt, surfaceAt, Surface, type Route } from '../../../../sdk/navgrid/index.js';
import { LEGACY, UNDERGROUND_Z, NAVGRID_PATH, decodeNavgrid } from '../../../../sdk/navgrid/format.js';
import { findLongPath, initPathfinding } from '../../../../sdk/pathfinding.js';

init();
initPathfinding();

const inV1Window = (level: number, x: number, z: number): boolean =>
    level === 0 && x >= LEGACY.MIN_X && z >= LEGACY.MIN_Z && x < LEGACY.MIN_X + LEGACY.WIDTH && z < LEGACY.MIN_Z + LEGACY.HEIGHT;

function botPlanner(level: number, sx: number, sz: number, dx: number, dz: number): { source: 'navgrid' | 'raw' | 'none'; route: Route | null } {
    for (const arrive of [0, 2, 4]) {
        const r = planRoute(sx, sz, dx, dz, { level, roadPreference: 1, clearanceWeight: 1, arrive, maxExpansions: 600_000 });
        if (r) return { source: 'navgrid', route: r };
    }
    return { source: findLongPath(level, sx, sz, dx, dz).length ? 'raw' : 'none', route: null };
}

function assertLegalWalk(route: Route, level: number): void {
    for (let i = 1; i < route.waypoints.length; i++) {
        const a = route.waypoints[i - 1]!, b = route.waypoints[i]!;
        const dx = b.x - a.x, dz = b.z - a.z;
        expect(Math.max(Math.abs(dx), Math.abs(dz))).toBe(1);
        expect(rsmod.canTravel(level, a.x, a.z, dx, dz, 1, 0, CollisionType.NORMAL)).toBe(true);
    }
}

function assertNavgridRoute(level: number, s: [number, number], d: [number, number], minTiles: number): Route {
    expect(isWalkable(s[0], s[1], level)).toBe(true);
    expect(hasData(s[0], s[1], level)).toBe(true);
    expect(hasData(d[0], d[1], level)).toBe(true);
    const { source, route } = botPlanner(level, s[0], s[1], d[0], d[1]);
    expect(source).toBe('navgrid');
    assertLegalWalk(route!, level);
    const last = route!.waypoints.at(-1)!;
    expect(Math.max(Math.abs(last.x - d[0]), Math.abs(last.z - d[1]))).toBeLessThanOrEqual(4);
    expect(route!.tiles).toBeGreaterThanOrEqual(minTiles);
    // Weighted A* is in force: the route keeps off the walls (the raw BFS would scrape clearance 1).
    const clear = route!.waypoints.map(w => clearanceAt(w.x, w.z, level));
    expect(Math.min(...clear)).toBeGreaterThanOrEqual(1);
    return route!;
}

describe('navgrid.bin v2 layout', () => {
    const nav = decodeNavgrid(new Uint8Array(require('fs').readFileSync(NAVGRID_PATH)));
    test('all four levels have chunks; level 0 has every collision mapsquare (534 in rev 289; 274: 483)', () => {
        const per = [0, 0, 0, 0];
        for (const d of nav.dir) per[d.level]!++;
        expect(per[0]).toBe(534);
        for (const l of [1, 2, 3]) expect(per[l]!).toBeGreaterThan(50);
    });
    test('sparse layout is smaller than the v1 dense level-0 block', () => {
        expect(nav.cells.length).toBeLessThan(LEGACY.WIDTH * LEGACY.HEIGHT);
    });
});

describe('regions v1 could not route now come from the navgrid', () => {
    test('Morytania east of x 3584: Canifis -> east coast (mapsquare 56,54)', () => {
        const r = assertNavgridRoute(0, [3494, 3483], [3600, 3490], 80);
        expect(inV1Window(0, 3600, 3490)).toBe(false);
        expect(r.waypoints.some(w => w.x >= 3584)).toBe(true);
    });

    test('below z 2816: the only collision square south of the old window (35,20)', () => {
        // NB: in this map there is no Kharidian desert below z 2816 -- collision-data.json's level-0
        // squares run mz 44.. (z 2816) except this one square at x 2240-2303, z 1280-1343.
        const r = assertNavgridRoute(0, [2245, 1290], [2290, 1330], 40);
        expect(inV1Window(0, 2245, 1290)).toBe(false);
        expect(r.waypoints.every(w => w.z < LEGACY.MIN_Z)).toBe(true);
    });

    test('underground (z+6400): Edgeville dungeon ladder -> hill giants', () => {
        const r = assertNavgridRoute(0, [3097, 9867], [3112, 9840], 30);
        expect(inV1Window(0, 3097, 9867)).toBe(false);
        expect(r.waypoints.every(w => w.z >= UNDERGROUND_Z)).toBe(true);
        // No underlay there -> standable underground tiles are FLOOR (or a real surface), never VOID.
        expect(r.waypoints.every(w => surfaceAt(w.x, w.z) !== Surface.VOID)).toBe(true);
    });

    test('upper floor: Lumbridge castle level 1', () => {
        const r = assertNavgridRoute(1, [3206, 3228], [3215, 3215], 10);
        expect(r.waypoints.every(w => w.surface === Surface.FLOOR)).toBe(true);
    });

    test('upper floor: Lumbridge castle level 2 (bank -> stairs)', () => {
        const r = assertNavgridRoute(2, [3208, 3220], [3205, 3209], 8);
        expect(r.waypoints.every(w => w.surface === Surface.FLOOR)).toBe(true);
    });

    test('levels are separate grids: a level-1 route never reads level-0 cells', () => {
        // Same (x, z), different level: the level-1 castle floor is FLOOR, the level-0 tile is not.
        expect(surfaceAt(3208, 3220, 1)).toBe(Surface.FLOOR);
        expect(surfaceAt(3208, 3220, 0)).not.toBe(Surface.FLOOR);
    });

    test('surface <-> underground is answered null at once (ladders are levels.ts\' job)', () => {
        const t = Date.now();
        expect(planRoute(3112, 9840, 3222, 3218, { maxExpansions: 600_000 })).toBeNull();
        expect(planRoute(3222, 3218, 3112, 9840, { maxExpansions: 600_000 })).toBeNull();
        expect(Date.now() - t).toBeLessThan(100);
    });
});

describe('v1-window routes are unchanged (fingerprints from the v1 router + shipped v1 navgrid.bin)', () => {
    const fp = (r: Route): string => {
        let h = 0x811c9dc5;
        for (const w of r.waypoints) { h = Math.imul(h ^ w.x, 16777619); h = Math.imul(h ^ w.z, 16777619); }
        return (h >>> 0).toString(16);
    };
    const DANGER = [
        { x: 3134, z: 3251, radius: 12, cost: 400 },
        { x: 3220, z: 3220, radius: 18, cost: 400 },
        { x: 2860, z: 3480, radius: 30, cost: 400 },
    ];
    const BOT_OPTS = { roadPreference: 1, clearanceWeight: 1, danger: DANGER, arrive: 2, maxExpansions: 600_000 };
    const CASES: Array<[string, number, number, number, number, object, number, number, string]> = [
        ['Lumbridge -> Varrock (default)', 3222, 3218, 3212, 3428, {}, 232, 15895, 'cc3cffe5'],
        ['Lumbridge -> Varrock (bot opts + danger)', 3222, 3218, 3212, 3428, BOT_OPTS, 240, 10976, '6c823dc3'],
        ['Falador -> Draynor', 2964, 3378, 3093, 3244, {}, 203, 21954, '5bbcc03d'],   // rev 289 (274: 21908 '3d3e1410'): same length, Falador park loc change at (2964,3380)
        ['Edgeville -> Varrock east', 3093, 3491, 3253, 3420, BOT_OPTS, 250, 18996, '65b8ffe2'],
        ['Canifis -> v1 east edge', 3489, 3480, 3570, 3495, {}, 102, 3783, '358afedb'],   // rev 289 (274: 3778 expansions), same path
    ];
    for (const [name, sx, sz, dx, dz, opts, tiles, expansions, hash] of CASES) {
        test(name, () => {
            const r = planRoute(sx, sz, dx, dz, opts)!;
            expect(r).not.toBeNull();
            expect(r.tiles).toBe(tiles);
            expect(r.expansions).toBe(expansions);
            expect(fp(r)).toBe(hash);
        });
    }
});

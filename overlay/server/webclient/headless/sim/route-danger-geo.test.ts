// cd server/webclient/headless/sim && bun test route-danger-geo.test.ts      (~15-40 s navgrid init, ~1 GB RSS)
//
// WHITE WOLF MOUNTAIN CROSSING, offline on the REAL rev-289 collision (navgrid/rsmod) and the REAL
// npc spawns (npc-scene). Pins route-danger.ts:
//   - WWM_SPAWNS is exactly the aggressive static spawns of those types around the mountain (content drift = fail);
//   - NO crossing avoids every aggro zone (if one ever appears, make the zones a HARD block instead of a cost);
//   - the long-haul planner with WWM_DANGER crosses with no more exposure than the exhaustive min-exposure crossing,
//     and never enters the aggro zone of a spawn that the min-exposure crossing avoids (an "avoidable" spawn).
// Aggro zone of a spawn = tiles within huntrange (Chebyshev) of any footprint tile the npc can wander to
// (flood fill over real collision inside its wander square, engine Npc.ts wander()/HuntIterator).
import { describe, test, expect, beforeAll } from 'bun:test';
import { WWM_SPAWNS, WWM_DANGER, LEGACY_WWM_BLOB, type DangerZone, inDanger, pathHitsDanger, rawLegFallback, rawFallbackSafe, DangerRefusals, SHORT_RAW_LEG } from '../route-danger.js';

type XZ = { x: number; z: number };
let navgrid: any, rsmod: any, npcScene: any, findLongPath: any;
const X0 = 2690, X1 = 2990, Z0 = 3330, Z1 = 3630, W = X1 - X0 + 1, N = W * (Z1 - Z0 + 1);
const idx = (x: number, z: number) => (z - Z0) * W + (x - X0);
const inBox = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const BASE: DangerZone[] = [{ x: 3134, z: 3251, radius: 12, cost: 400 }, { x: 3220, z: 3220, radius: 18, cost: 400 }];
const PAIRS: [string, XZ, XZ][] = [
    ['Catherby bank <-> Varrock West', { x: 2810, z: 3440 }, { x: 3185, z: 3436 }],
    ['Lumbridge <-> Ardougne south', { x: 3222, z: 3218 }, { x: 2655, z: 3283 }],
    ['Taverley <-> Seers', { x: 2895, z: 3445 }, { x: 2725, z: 3485 }],
];
let zones: Set<number>[] = [];
let cnt = new Int32Array(N);

const can = (x: number, z: number, dx: number, dz: number, size = 1) => rsmod.canTravel(0, x, z, dx, dz, size, 0, rsmod.CollisionType.NORMAL);
function aggroZone(s: typeof WWM_SPAWNS[number]): Set<number> {
    const seen = new Set([`${s.x},${s.z}`]), q: [number, number][] = [[s.x, s.z]], out = new Set<number>();
    for (let h = 0; h < q.length; h++) {
        const [x, z] = q[h]!;
        for (let fx = x - s.hunt; fx <= x + s.size - 1 + s.hunt; fx++)
            for (let fz = z - s.hunt; fz <= z + s.size - 1 + s.hunt; fz++) if (inBox(fx, fz)) out.add(idx(fx, fz));
        for (const [dx, dz] of DIRS) {
            const nx = x + dx, nz = z + dz;
            if (Math.abs(nx - s.x) > s.wander || Math.abs(nz - s.z) > s.wander || seen.has(`${nx},${nz}`)) continue;
            if (!can(x, z, dx, dz, s.size)) continue;
            seen.add(`${nx},${nz}`); q.push([nx, nz]);
        }
    }
    return out;
}
const densify = (wps: XZ[]): XZ[] => {
    const out: XZ[] = [wps[0]!]; let p = wps[0]!;
    for (const w of wps.slice(1)) while (p.x !== w.x || p.z !== w.z) { p = { x: p.x + Math.sign(w.x - p.x), z: p.z + Math.sign(w.z - p.z) }; out.push(p); }
    return out;
};
const exposure = (tiles: XZ[]) => {
    let steps = 0; const hit = new Set<number>();
    for (const t of tiles) { if (!inBox(t.x, t.z)) continue; const i = idx(t.x, t.z); if (cnt[i]) steps++; zones.forEach((z, k) => { if (z.has(i)) hit.add(k); }); }
    return { steps, hit };
};
/** Exhaustive min-exposure walk (Dijkstra, exposure dominates length) between two tiles inside the box. */
function minExposurePath(a: XZ, b: XZ): XZ[] {
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap: [number, number][] = [];
    const push = (e: [number, number]) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]![0] <= heap[i]![0]) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p; } };
    const pop = () => { const top = heap[0]!; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; i = m; } } return top; };
    const s = idx(a.x, a.z), t = idx(b.x, b.z); dist[s] = 0; push([0, s]);
    while (heap.length) {
        const [d, i] = pop(); if (d > dist[i]!) continue; if (i === t) break;
        const x = X0 + i % W, z = Z0 + ((i / W) | 0);
        for (const [dx, dz] of DIRS) {
            const nx = x + dx, nz = z + dz; if (!inBox(nx, nz) || !can(x, z, dx, dz)) continue;
            const n = idx(nx, nz), nd = d + (dx && dz ? 14 : 10) + 100_000 * cnt[n]!;
            if (nd < dist[n]!) { dist[n] = nd; prev[n] = i; push([nd, n]); }
        }
    }
    const path: XZ[] = []; for (let j = t; j !== -1; j = prev[j]!) path.push({ x: X0 + j % W, z: Z0 + ((j / W) | 0) });
    return path.reverse();
}
function plan(a: XZ, b: XZ, danger: DangerZone[]) {
    for (const arrive of [0, 2, 4]) {
        const r = navgrid.planRoute(a.x, a.z, b.x, b.z, { level: 0, roadPreference: 1, clearanceWeight: 1, danger, arrive, maxExpansions: 600_000 });
        if (r) return { tiles: r.tiles as number, path: densify(r.waypoints) };
    }
    return null;
}
const minCheb = (path: XZ[], s: XZ) => Math.min(...path.map(p => Math.max(Math.abs(p.x - s.x), Math.abs(p.z - s.z))));
const label = (k: number) => `${WWM_SPAWNS[k]!.name}@${WWM_SPAWNS[k]!.x},${WWM_SPAWNS[k]!.z}`;

let optimum = { steps: 0, hit: new Set<number>() };
beforeAll(async () => {
    const pf = await import('../../../../sdk/pathfinding'); pf.initPathfinding(); findLongPath = pf.findLongPath;
    navgrid = await import('../../../../sdk/navgrid/index.js'); navgrid.init();
    rsmod = require('../../../vendor/rsmod-pathfinder');
    npcScene = await import('../npc-scene.js'); npcScene.init();
    zones = WWM_SPAWNS.map(aggroZone);
    cnt = new Int32Array(N); zones.forEach(z => z.forEach(i => cnt[i]!++));
    optimum = exposure(minExposurePath({ x: 2810, z: 3440 }, { x: 2895, z: 3440 }));
}, 240_000);

describe('White Wolf Mountain crossing (rev 289)', () => {
    test('WWM_SPAWNS = the aggressive static spawns of those types around the mountain (content drift fails here)', () => {
        const ids = new Set(WWM_SPAWNS.map(s => s.id));
        const live = npcScene.getNpcSpawnsInRadius(2840, 3470, 0, 120, {}).filter((s: any) => ids.has(s.id));
        const key = (s: any) => `${s.id}@${s.x},${s.z}`;
        expect(live.map(key).sort()).toEqual(WWM_SPAWNS.map(key).sort());
        for (const s of WWM_SPAWNS) {
            const d = npcScene.npcSpawnDef(s.id);
            expect({ wander: d.wanderRange, hunt: d.huntRange, size: d.size }).toEqual({ wander: s.wander, hunt: s.hunt, size: s.size });
        }
        expect(WWM_DANGER.length).toBe(WWM_SPAWNS.length);
    });

    test('no crossing avoids every aggro zone (so the zones are a COST; if this fails, make them a hard block)', () => {
        console.log(`[wwm] min-exposure crossing: ${optimum.steps} exposed tiles, unavoidable spawns: ${[...optimum.hit].map(label).join(' ')}`);
        expect(optimum.steps).toBeGreaterThan(0);
    });

    for (const [name, a, b] of PAIRS) {
        for (const [from, to] of [[a, b], [b, a]] as const) {
            test(`${name}: ${from.x},${from.z} -> ${to.x},${to.z} enters no avoidable aggro zone, exposure <= the min-exposure crossing`, () => {
                const before = plan(from, to, [...BASE, LEGACY_WWM_BLOB]);
                const after = plan(from, to, [...BASE, ...WWM_DANGER]);
                expect(after).not.toBeNull();
                const e = exposure(after!.path), e0 = before ? exposure(before.path) : null;
                const avoidable = [...e.hit].filter(k => !optimum.hit.has(k)).map(label);
                const avoidable0 = e0 ? [...e0.hit].filter(k => !optimum.hit.has(k)).map(label) : [];
                console.log(`[wwm] ${from.x},${from.z}->${to.x},${to.z}: tiles ${before?.tiles}->${after!.tiles} (+${after!.tiles - (before?.tiles ?? 0)}), exposed ${e0?.steps}->${e.steps}, avoidable zones entered ${avoidable0.join(' ') || 'none'} -> ${avoidable.join(' ') || 'none'}`);
                console.log(`[wwm]   min Chebyshev to spawn (before->after): ${WWM_SPAWNS.map((s, k) => `${label(k)} ${before ? minCheb(before.path, s) : '-'}->${minCheb(after!.path, s)}`).join(', ')}`);
                expect(avoidable).toEqual([]);
                expect(e.steps).toBeLessThanOrEqual(optimum.steps + 2);
            }, 120_000);
        }
    }
});

// ---- RAW-FALLBACK GUARD -------------------------------------------------------------------------
// The planners fall back to the raw rsmod findLongPath when
// navgrid.planRoute returns null on a <=40-tile leg — and that raw path ignores danger (a level-3 account died
// twice at (2842,3500) on such a leg). route-danger.ts rawLegFallback refuses a raw leg into a WWM aggro circle.

describe('pathHitsDanger (pure)', () => {
    const Z: DangerZone[] = [{ x: 100, z: 100, radius: 3, cost: 1 }];
    test('a straight segment whose CORNERS are both outside but whose tiles cross the circle hits', () => {
        expect(inDanger(90, 100, Z)).toBe(false); expect(inDanger(110, 100, Z)).toBe(false);
        expect(pathHitsDanger([{ x: 110, z: 100 }], 90, 100, Z)).toBe(true);
    });
    test('a diagonal segment through the circle hits; one beside it does not', () => {
        expect(pathHitsDanger([{ x: 110, z: 110 }], 90, 90, Z)).toBe(true);
        expect(pathHitsDanger([{ x: 110, z: 96 }], 90, 96, Z)).toBe(false);   // 4 tiles south of centre, r=3
    });
    test('a detour around the circle (corners + segments all outside) is clean', () => {
        expect(pathHitsDanger([{ x: 95, z: 105 }, { x: 105, z: 105 }, { x: 110, z: 100 }], 90, 100, Z)).toBe(false);
    });
    test('only the segment tiles between corners are checked, not just corners (multi-waypoint)', () => {
        // corners (95,95) and (105,105) are outside (d^2=50 > 9); the segment between them runs through the centre
        expect(pathHitsDanger([{ x: 95, z: 95 }, { x: 105, z: 105 }, { x: 110, z: 110 }], 90, 90, Z)).toBe(true);
    });
    test('already inside: walking OUT is allowed, cutting DEEPER toward the spawn is not', () => {
        expect(pathHitsDanger([{ x: 110, z: 100 }], 102, 100, Z)).toBe(false);   // from d=2 straight out
        expect(pathHitsDanger([{ x: 90, z: 100 }], 102, 100, Z)).toBe(true);     // from d=2 back through the centre
    });
    test('empty path / no zones near = no hit; underground legs always pass rawFallbackSafe', () => {
        expect(pathHitsDanger([], 100, 100, Z)).toBe(false);
        expect(pathHitsDanger([{ x: 10, z: 10 }], 0, 0, Z)).toBe(false);
        expect(rawFallbackSafe([{ x: 2842, z: 9900 }], 2842, 9890, 9900)).toBe(true);
        expect(rawFallbackSafe([{ x: 2842, z: 3480 }], 2842, 3522, 3480)).toBe(false);   // through the wolf pack
    });
});

describe('short-leg raw fallback with navgrid forced to null (rev 289 collision)', () => {
    const quiet = () => new DangerRefusals(15_000, 5_000, () => { });
    const plannerNavNull = (refusals: DangerRefusals) => (level: number, sx: number, sz: number, dx: number, dz: number) => {
        for (const _arrive of [0, 2, 4]) { const r = null; if (r) return r; }
        return rawLegFallback(findLongPath, level, sx, sz, dx, dz, refusals, '[test]');
    };
    const walk = (x: number, z: number) => navgrid.isWalkable(x, z, 0);
    /** Short legs (<= SHORT_RAW_LEG) on the mountain, start outside every circle, whose RAW path walks into one.
     *  Seeded (deterministic) sample over the mountain box + the leg navgrid really returns null for at ANY budget
     *  (west valley -> north rim, through the ice giants / pack: , 3M expansions = null). */
    function packLegs(): [XZ, XZ][] {
        const out: [XZ, XZ][] = [[{ x: 2806, z: 3499 }, { x: 2840, z: 3524 }]];
        let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let k = 0; k < 2000 && out.length < 16; k++) {
            const sx = 2800 + Math.floor(rnd() * 90), sz = 3425 + Math.floor(rnd() * 110);
            const dx = sx + Math.floor(rnd() * 81) - 40, dz = sz + Math.floor(rnd() * 81) - 40;
            if (!walk(sx, sz) || !walk(dx, dz) || inDanger(sx, sz)) continue;
            let raw: XZ[] = []; try { raw = findLongPath(0, sx, sz, dx, dz).map((w: XZ) => ({ x: w.x, z: w.z })); } catch { /* none */ }
            if (raw.length && pathHitsDanger(raw, sx, sz)) out.push([{ x: sx, z: sz }, { x: dx, z: dz }]);
        }
        return out.filter(([a, b]) => { try { const r = findLongPath(0, a.x, a.z, b.x, b.z); return r.length > 0 && pathHitsDanger(r, a.x, a.z); } catch { return false; } });
    }
    test('a <=40-tile leg across a wolf circle returns [] or a danger-free path — never a path through the circle', () => {
        const legs = packLegs();
        console.log(`[wwm] ${legs.length} short legs whose raw path crosses an aggro circle: ${legs.map(([a, b]) => `${a.x},${a.z}->${b.x},${b.z}`).join(' ')}`);
        expect(legs.length).toBeGreaterThan(5);   // the hole is real on this collision: the raw planner DOES cut through
        let notes = 0;
        const refusals = new DangerRefusals(15_000, 5_000, () => { notes++; });
        const plan = plannerNavNull(refusals);
        for (const [a, b] of legs) {
            const p = plan(0, a.x, a.z, b.x, b.z);
            expect(p.length === 0 || !pathHitsDanger(p, a.x, a.z)).toBe(true);
            expect(refusals.refused(`0,${a.x},${a.z},${b.x},${b.z}`)).toBe(true);   // refused legs are recorded (no per-tick re-search)
        }
        expect(notes).toBe(legs.length);   // and logged — never silent
    }, 120_000);
    test('a short raw leg that stays clear of every circle still passes (Catherby bank area)', () => {
        const p = plannerNavNull(quiet())(0, 2809, 3440, 2820, 3440);
        expect(p.length).toBeGreaterThan(0);
    }, 60_000);
    test('legs longer than SHORT_RAW_LEG on the surface never fall back to raw', () => {
        expect(plannerNavNull(quiet())(0, 2809, 3440, 2860, 3440)).toEqual([]);
    });
});

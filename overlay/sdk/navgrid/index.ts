// Navgrid router: weighted A* over real collision + real surface data.
//
// Why this exists instead of rsmod.findLongPath:
//   - findLongPath is a plain BFS, so it takes the *shortest* route, which hugs
//     walls and fences. A few tiles of position drift then drops the bot into a
//     one-exit pocket and it stalls. We add a clearance penalty.
//   - The old init opened 361 zones of pure void as walkable, so routes could
//     cross terrain that does not exist. We only open zones with real land.
//   - The old init unmasked every door, including 513 edges the server refuses.
//     We reject those edges outright.
//   - Roads are open corridors and the safest way to cross the world. We know
//     where they really are now, so we prefer them.
//
// Coverage (navgrid.bin v2, format.ts): EVERY mapsquare with collision data, on all four levels --
// the overworld (incl. east of x 3584), the z+6400 underground, the instanced interiors and the
// upper floors. Pass `level` to route on levels 1-3. Each (level, mapsquare) is a 64x64 chunk; a cell
// id is `slot * 4096 + lz * 64 + lx`. Inside the old v1 window (level 0, x 1792..3583, z 2816..5631)
// the cells and costs are the v1 ones, so those routes are unchanged.
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../server/vendor/rsmod-pathfinder';
import { loadCollisionTables } from '../collision-store';   // NOT the JSON import: Bun pins an imported JSON for the process lifetime
import diagonalDoors from './diagonal-doors.json';
import unopenableDoors from './unopenable-doors.json';
import questGatedDoors from './quest-gated-doors.json';   // hand-kept: doors a quest script locks/keys (not in the generated set)
import { BLOCKED_EDGES } from '../../server/webclient/headless/blocked-tiles.js';
import { reapplyDirectedBlocks } from './edge-blocks.js';
import { sweepLiveLeaves } from './live-leaves.js';   // live open-door leaf walls (zone stream) expire here too
import { Surface } from './surface.js';
import {
    NAVGRID_PATH, LEVELS, MX0, MZ0, MSQ_W, MSQ_H, CHUNK_SHIFT, CHUNK, UNDERGROUND_Z,
    cellSurface, cellClearance, inBounds, squareKey, decodeNavgrid,
} from './format.js';

export interface DoorInfo {
    level: number;
    x: number;
    z: number;
    shape: number;
    angle: number;
    blockrange: boolean;
}

export interface DangerZone {
    x: number;
    z: number;
    radius: number;
    /** Extra cost per step inside the zone. ~200 makes a bot take a long detour. */
    cost: number;
}

export interface RouteOptions {
    level?: number;
    /** 0 = ignore roads, 1 = default pull, >1 = hug roads harder. */
    roadPreference?: number;
    /** 0 = allow wall-hugging (shortest), 1 = default, >1 = stay further out. */
    clearanceWeight?: number;
    danger?: DangerZone[];
    /** Cost of stepping through a door. High enough to prefer an open way round. */
    doorCost?: number;
    /** >1 trades optimality for speed. 1 = optimal. */
    heuristicWeight?: number;
    maxExpansions?: number;
    /**
     * Stop this many tiles from the destination. Plenty of "real" coords (shop
     * counters, fountains, city squares) are standable but cannot be *entered*
     * from any neighbour, so demanding the exact tile fails on perfectly good
     * routes. RS's own pathfinder does the same thing via moveNear.
     */
    arrive?: number;
}

export interface Waypoint {
    x: number;
    z: number;
    surface: Surface;
}

export interface Route {
    waypoints: Waypoint[];
    /** Doors that lie on the route, in the order they're met. */
    doors: DoorInfo[];
    tiles: number;
    onRoadPct: number;
    longestOffRoad: number;
    expansions: number;
    ms: number;
}

// --- costs, in tenths of a tile so we can stay in integers.
const STEP_CARDINAL = 10;
const STEP_DIAGONAL = 14;
const SURFACE_MULT: Record<number, number> = {
    [Surface.ROAD]: 0.55,
    [Surface.PATH]: 0.75,
    [Surface.LAND]: 1.0,
    [Surface.WATER]: 1.0, // never reached; blocked below
    [Surface.VOID]: 1.0,
    [Surface.FLOOR]: 1.0,
};
/** Penalty by clearance, index = tiles from the nearest blocked tile. */
const CLEARANCE_PENALTY = [30, 12, 5, 2, 1, 0];

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, STEP_CARDINAL], [-1, 0, STEP_CARDINAL], [0, 1, STEP_CARDINAL], [0, -1, STEP_CARDINAL],
    [1, 1, STEP_DIAGONAL], [1, -1, STEP_DIAGONAL], [-1, 1, STEP_DIAGONAL], [-1, -1, STEP_DIAGONAL],
];

let grid: Uint8Array | null = null;
/** (level, mapsquare) -> chunk slot, or -1. Indexed by format.squareKey. */
let slotOf: Int32Array = new Int32Array(0);
/** Per slot: world x / z of the chunk's south-west tile. */
let slotX: Int32Array = new Int32Array(0);
let slotZ: Int32Array = new Int32Array(0);
const doorIndex = new Map<string, DoorInfo>();
const blockedEdges = new Set<number>();

// Doors that only open from one side; routing through traps the bot.
const ONE_WAY_DOORS = new Set(['0,3108,3353', '0,3109,3353']);

const key = (level: number, x: number, z: number): string => `${level},${x},${z}`;
/** Directed step out of a cell. Cell ids are per level, so this is level-specific by construction. */
const edgeKey = (cell: number, dx: number, dz: number): number => cell * 9 + ((dx + 1) * 3 + (dz + 1));

const cellX = (i: number): number => slotX[i >> 12]! + (i & 63);
const cellZ = (i: number): number => slotZ[i >> 12]! + ((i >> 6) & 63);

/** Cell id of (level, x, z), or -1 where the navgrid has no data. */
function cellAt(level: number, x: number, z: number): number {
    if (!inBounds(x, z, level)) return -1;
    const slot = slotOf[squareKey(level, x >> CHUNK_SHIFT, z >> CHUNK_SHIFT)]!;
    return slot < 0 ? -1 : (slot << 12) | ((z & 63) << 6) | (x & 63);
}


export function init(): void {
    if (grid) return;
    const start = Date.now();

    const nav = decodeNavgrid(new Uint8Array(require('fs').readFileSync(NAVGRID_PATH)));
    slotOf = new Int32Array(LEVELS * MSQ_H * MSQ_W).fill(-1);
    slotX = new Int32Array(nav.dir.length);
    slotZ = new Int32Array(nav.dir.length);
    nav.dir.forEach((d, slot) => {
        if (d.level >= LEVELS || d.mx < MX0 || d.mz < MZ0 || d.mx >= MX0 + MSQ_W || d.mz >= MZ0 + MSQ_H) {
            throw new Error(`navgrid.bin: chunk (${d.level},${d.mx},${d.mz}) is outside format.ts's extent`);
        }
        slotOf[squareKey(d.level, d.mx, d.mz)] = slot;
        slotX[slot] = d.mx << CHUNK_SHIFT;
        slotZ[slot] = d.mz << CHUNK_SHIFT;
    });
    grid = nav.cells;

    // flat tables (collision-store.ts), local: the 20 MB tile table is dropped after init
    const { zones: Z, tiles: T, doors: D } = loadCollisionTables();
    for (let i = 0; i < Z.length; i += 3) rsmod.allocateIfAbsent(Z[i + 1]!, Z[i + 2]!, Z[i]!);
    for (let i = 0; i < T.length; i += 4) rsmod.__set(T[i + 1]!, T[i + 2]!, T[i]!, T[i + 3]!);

    // Unmask doors so routes can pass through them, but keep one-way + SCRIPTLESS doors shut
    // (scriptless = op "Open" with no handler -> never opens live; see sdk/pathfinding.ts).
    const deadDoors = new Set(([...unopenableDoors, ...questGatedDoors] as Array<{ level: number; x: number; z: number }>).map(d => key(d.level, d.x, d.z)));
    for (let i = 0; i < D.length; i += 6) {
        const level = D[i]!, x = D[i + 1]!, z = D[i + 2]!, shape = D[i + 3]!, angle = D[i + 4]!, blockrange = D[i + 5]!;
        const k = key(level, x, z);
        if (ONE_WAY_DOORS.has(k) || deadDoors.has(k)) continue;
        rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
        doorIndex.set(k, { level, x, z, shape, angle, blockrange: !!blockrange });
    }

    // DIAGONAL (shape-9) openable doors — omitted from collision-data.json and untouchable by
    // changeWall (they block their whole tile via the LOC layer; engine parity = changeLoc). Same
    // set + treatment as sdk/pathfinding.ts init (shared rsmod singleton, idempotent either order).
    // OPEN-STATE PARITY: block each door's LEAF tile too (the open script loc_adds the leaf there) —
    // routes must go AROUND the swung-open leaf (live-verified: the wizard-tower south corridor).
    for (const d of diagonalDoors as Array<{ level: number; x: number; z: number; angle: number; leaf?: { x: number; z: number } }>) {
        const k = key(d.level, d.x, d.z);
        if (ONE_WAY_DOORS.has(k)) continue;
        rsmod.changeLoc(d.x, d.z, d.level, 1, 1, true, false, false);
        if (d.leaf) rsmod.changeLoc(d.leaf.x, d.leaf.z, d.level, 1, 1, true, false, true);
        doorIndex.set(k, { level: d.level, x: d.x, z: d.z, shape: 9, angle: d.angle, blockrange: true });
    }

    // The 513 steps the server actually refuses despite the unmask above. They were measured on
    // level 0 (blocked-tiles.ts), so they apply to level 0 only.
    for (const [x, z, dx, dz] of BLOCKED_EDGES) {
        const c = cellAt(0, x, z);
        if (c >= 0) blockedEdges.add(edgeKey(c, dx, dz));
    }

    // The __set + unmask above REWRITES every tile on the shared rsmod map, which used to silently undo
    // applyBlockedEdges() when an entry point called it first (e.g. speedrun initNav: every re-closed
    // door tile re-opened, per the collision oracle). Re-apply the DIRECTED edge blocks so the order of
    // initPathfinding / applyBlockedEdges / navgrid.init no longer matters (no-op if none were registered).
    reapplyDirectedBlocks();

    console.log(
        `navgrid ready in ${Date.now() - start}ms ` +
        `(${nav.dir.length} chunks, ${doorIndex.size} doors, ${blockedEdges.size} blocked edges)`
    );
}

/** Does the navgrid have data for this tile? (false -> planRoute returns null there.) */
export function hasData(x: number, z: number, level = 0): boolean {
    init();
    return cellAt(level, x, z) >= 0;
}

export function surfaceAt(x: number, z: number, level = 0): Surface {
    const c = grid ? cellAt(level, x, z) : -1;
    return c < 0 ? Surface.VOID : cellSurface(grid![c]!);
}

export function clearanceAt(x: number, z: number, level = 0): number {
    const c = grid ? cellAt(level, x, z) : -1;
    return c < 0 ? 0 : cellClearance(grid![c]!);
}

/** Can a bot stand here? Answered by collision, not surface. */
export function isWalkable(x: number, z: number, level = 0): boolean {
    if (!inBounds(x, z, level)) return false;
    return (
        rsmod.canTravel(level, x, z, 1, 0, 1, 0, CollisionType.NORMAL) ||
        rsmod.canTravel(level, x, z, -1, 0, 1, 0, CollisionType.NORMAL) ||
        rsmod.canTravel(level, x, z, 0, 1, 1, 0, CollisionType.NORMAL) ||
        rsmod.canTravel(level, x, z, 0, -1, 1, 0, CollisionType.NORMAL)
    );
}

export function getDoorAt(level: number, x: number, z: number): DoorInfo | undefined {
    return doorIndex.get(key(level, x, z));
}

/** Re-add a door's wall collision, e.g. after finding it locked in game. */
export function blockDoor(level: number, x: number, z: number): void {
    const d = doorIndex.get(key(level, x, z));
    if (!d) return;
    // shape 9 = diagonal: full-tile LOC collision — changeWall would be a silent no-op. Revert to the
    // CLOSED-state model: re-block the door tile, UN-block its swing leaf.
    if (d.shape === 9) {
        rsmod.changeLoc(d.x, d.z, d.level, 1, 1, d.blockrange, false, true);
        const leaf = (diagonalDoors as Array<{ level: number; x: number; z: number; leaf?: { x: number; z: number } }>)
            .find(q => q.level === level && q.x === x && q.z === z)?.leaf;
        if (leaf) rsmod.changeLoc(leaf.x, leaf.z, level, 1, 1, true, false, false);
    } else rsmod.changeWall(d.x, d.z, d.level, d.angle, d.shape, d.blockrange, false, true);
    doorIndex.delete(key(level, x, z));
}

/** Min-heap over (f, cell), stored as parallel typed arrays. */
class Heap {
    private f = new Int32Array(1 << 16);
    private v = new Int32Array(1 << 16);
    private n = 0;

    get size(): number { return this.n; }
    clear(): void { this.n = 0; }

    push(f: number, v: number): void {
        if (this.n === this.f.length) {
            const nf = new Int32Array(this.n * 2); nf.set(this.f); this.f = nf;
            const nv = new Int32Array(this.n * 2); nv.set(this.v); this.v = nv;
        }
        let i = this.n++;
        this.f[i] = f; this.v[i] = v;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.f[p]! <= this.f[i]!) break;
            this.swap(p, i); i = p;
        }
    }

    pop(): number {
        const top = this.v[0]!;
        this.n--;
        if (this.n > 0) {
            this.f[0] = this.f[this.n]!; this.v[0] = this.v[this.n]!;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < this.n && this.f[l]! < this.f[m]!) m = l;
                if (r < this.n && this.f[r]! < this.f[m]!) m = r;
                if (m === i) break;
                this.swap(m, i); i = m;
            }
        }
        return top;
    }

    private swap(a: number, b: number): void {
        const f = this.f[a]!; this.f[a] = this.f[b]!; this.f[b] = f;
        const v = this.v[a]!; this.v[a] = this.v[b]!; this.v[b] = v;
    }
}

// Reused across calls; allocating 5M-entry arrays per route would be silly.
let gScore: Int32Array | null = null;
let cameFrom: Int32Array | null = null;
let stamp: Int32Array | null = null;
let epoch = 0;
const heap = new Heap();

/** the last planRoute's search facts (speedrun fix 309a): `exhausted` = the open set ran dry (the source's whole region
 *  was searched); `minDist` = the smallest Chebyshev distance to the destination of any cell the search reached. With the
 *  same budget a bigger `arrive` orders the far cells the same way, so a failed search whose minDist > A cannot succeed
 *  with arrive A either. */
export const LAST_SEARCH = { exhausted: false, minDist: Infinity, expansions: 0 };

/** can planRoute ever step ONTO (x, z)? (some neighbour cell steps into it: the same canTravel + blocked-edge test the search
 *  uses). A search with arrive 0 to a tile nothing steps onto (a bank booth, a ladder, a counter) searches the whole region
 *  and fails (speedrun fix 309d). */
export function enterable(level: number, x: number, z: number): boolean {
    init();
    for (const [dx, dz] of NEIGHBOURS) {
        const sx = x - dx, sz = z - dz;
        const c = cellAt(level, sx, sz);
        if (c < 0 || cellAt(level, x, z) < 0) continue;
        if (blockedEdges.has(edgeKey(c, dx, dz))) continue;
        if (rsmod.canTravel(level, sx, sz, dx, dz, 1, 0, CollisionType.NORMAL)) return true;
    }
    return false;
}
/** cell id of (level, x, z) or -1 (speedrun fix 309b: region membership tests) */
export function cellOf(level: number, x: number, z: number): number { init(); return cellAt(level, x, z); }
/** right after a planRoute whose LAST_SEARCH.exhausted is true: the searched region (every cell reachable from the source)
 *  as a bitset over cell ids; null otherwise (speedrun fix 309b) */
export function lastRegion(): Uint8Array | null {
    if (!LAST_SEARCH.exhausted || !stamp) return null;
    const bits = new Uint8Array((stamp.length >> 3) + 1);
    for (let i = 0; i < stamp.length; i++) if (stamp[i] === epoch) bits[i >> 3] = bits[i >> 3]! | (1 << (i & 7));
    return bits;
}

export function planRoute(
    srcX: number, srcZ: number, destX: number, destZ: number, opts: RouteOptions = {}
): Route | null {
    init();
    sweepLiveLeaves();
    const started = Date.now();

    const level = opts.level ?? 0;
    const roadPref = opts.roadPreference ?? 1;
    const clearWeight = opts.clearanceWeight ?? 1;
    const doorCost = opts.doorCost ?? 60;
    const hWeight = opts.heuristicWeight ?? 1.15;
    const maxExpansions = opts.maxExpansions ?? 3_000_000;
    const danger = opts.danger ?? [];
    const arrive = opts.arrive ?? 2;
    LAST_SEARCH.exhausted = false; LAST_SEARCH.minDist = Infinity; LAST_SEARCH.expansions = 0;

    if (!inBounds(srcX, srcZ, level) || !inBounds(destX, destZ, level)) return null;
    // The surface and the z+6400 underground are never connected on foot (only by ladders/stairs,
    // which are levels.ts' job). Answer at once instead of exhausting a whole stratum -- which is
    // also what v1 did, since the underground was simply out of its bounds.
    if ((srcZ >= UNDERGROUND_Z) !== (destZ >= UNDERGROUND_Z)) return null;
    if (!isWalkable(srcX, srcZ, level)) {
        throw new Error(
            `navgrid: source (${srcX},${srcZ}) is not a standable tile. ` +
            `A bot's live position always is, so this usually means a hardcoded coord is wrong.`
        );
    }
    const start = cellAt(level, srcX, srcZ);
    if (start < 0) return null;   // the rim of an unallocated square: standable, but no chunk

    if (!gScore || gScore.length !== grid!.length) {
        gScore = new Int32Array(grid!.length);
        cameFrom = new Int32Array(grid!.length);
        stamp = new Int32Array(grid!.length);
        epoch = 0;
    }
    epoch++;
    heap.clear();

    // Non-null views, so the hot loop below isn't littered with assertions.
    const cells = grid!;
    const gs = gScore!;
    const from = cameFrom!;
    const seen = stamp!;

    // Cheapest possible step, so the heuristic stays admissible at weight 1.
    const minStep = STEP_CARDINAL * (roadPref > 0 ? SURFACE_MULT[Surface.ROAD]! : 1);
    const h = (i: number): number => {
        const x = cellX(i), z = cellZ(i);
        const dx = Math.abs(x - destX), dz = Math.abs(z - destZ);
        // Octile distance, discounted by the arrival tolerance so it stays admissible.
        const d = (dx + dz) + (STEP_DIAGONAL / STEP_CARDINAL - 2) * Math.min(dx, dz);
        return (Math.max(0, d - arrive) * minStep * hWeight) | 0;
    };

    const reachedGoal = (i: number): boolean => {
        const x = cellX(i), z = cellZ(i);
        return Math.max(Math.abs(x - destX), Math.abs(z - destZ)) <= arrive;
    };

    gs[start] = 0;
    seen[start] = epoch;
    from[start] = -1;
    heap.push(h(start), start);

    let expansions = 0;
    let goal = -1;
    let minDist = Math.max(Math.abs(srcX - destX), Math.abs(srcZ - destZ));

    while (heap.size > 0) {
        const cur = heap.pop();
        if (reachedGoal(cur)) { goal = cur; break; }
        if (++expansions > maxExpansions) break;

        const cx = cellX(cur);
        const cz = cellZ(cur);
        const lx = cur & 63, lz = (cur >> 6) & 63;
        const g = gs[cur]!;

        for (const [dx, dz, base] of NEIGHBOURS) {
            const nx = cx + dx, nz = cz + dz;
            // Same chunk: plain offset. Across a chunk edge: look the neighbour chunk up (no chunk = no
            // data = not enterable, exactly like v1's out-of-bounds skip).
            const llx = lx + dx, llz = lz + dz;
            const n = (llx >= 0 && llx < CHUNK && llz >= 0 && llz < CHUNK)
                ? cur + dz * CHUNK + dx
                : cellAt(level, nx, nz);
            if (n < 0) continue;
            const cell = cells[n]!;
            const surf = cellSurface(cell);

            // Collision is the sole authority on walkability -- surface data only
            // shapes preference. Gating on surface here would block bridges (water
            // underneath) and city floors (no underlay recorded).
            if (blockedEdges.has(edgeKey(cur, dx, dz))) continue;
            if (!rsmod.canTravel(level, cx, cz, dx, dz, 1, 0, CollisionType.NORMAL)) continue;

            let cost = base * (roadPref > 0
                ? 1 - (1 - (SURFACE_MULT[surf] ?? 1)) * roadPref
                : 1);

            const clear = cellClearance(cell);
            cost += (CLEARANCE_PENALTY[Math.min(clear, CLEARANCE_PENALTY.length - 1)] ?? 0) * clearWeight;

            if (doorIndex.has(key(level, nx, nz))) cost += doorCost;

            for (const d of danger) {
                const ddx = nx - d.x, ddz = nz - d.z;
                if (ddx * ddx + ddz * ddz <= d.radius * d.radius) cost += d.cost;
            }

            const ng = g + Math.max(1, cost | 0);
            if (seen[n] === epoch && gs[n]! <= ng) continue;

            seen[n] = epoch;
            gs[n] = ng;
            from[n] = cur;
            heap.push(ng + h(n), n);
            const nd = Math.max(Math.abs(nx - destX), Math.abs(nz - destZ)); if (nd < minDist) minDist = nd;
        }
    }
    LAST_SEARCH.exhausted = goal === -1 && heap.size === 0; LAST_SEARCH.minDist = minDist; LAST_SEARCH.expansions = expansions;

    if (goal === -1) return null;

    const waypoints: Waypoint[] = [];
    for (let i = goal; i !== -1; i = from[i]!) {
        waypoints.push({
            x: cellX(i),
            z: cellZ(i),
            surface: cellSurface(cells[i]!),
        });
        if (i === start) break;
    }
    waypoints.reverse();

    const doors: DoorInfo[] = [];
    for (const w of waypoints) {
        const d = doorIndex.get(key(level, w.x, w.z));
        if (d) doors.push(d);
    }

    let onRoad = 0, run = 0, longestOffRoad = 0;
    for (const w of waypoints) {
        if (w.surface === Surface.ROAD || w.surface === Surface.PATH) {
            onRoad++;
            run = 0;
        } else {
            longestOffRoad = Math.max(longestOffRoad, ++run);
        }
    }

    return {
        waypoints,
        doors,
        tiles: waypoints.length,
        onRoadPct: waypoints.length ? (onRoad / waypoints.length) * 100 : 0,
        longestOffRoad,
        expansions,
        ms: Date.now() - started,
    };
}

/**
 * Thin the route to the corners a walker actually needs. Keeps every door tile,
 * since the bot has to stop and open those.
 */
export function toVias(route: Route, maxSpacing = 12): Waypoint[] {
    const pts = route.waypoints;
    if (pts.length <= 2) return [...pts];

    const doorTiles = new Set(route.doors.map(d => `${d.x},${d.z}`));
    const vias: Waypoint[] = [pts[0]!];
    let lastDx = 0, lastDz = 0, since = 0;

    for (let i = 1; i < pts.length; i++) {
        const cur = pts[i]!, prev = pts[i - 1]!;
        const dx = Math.sign(cur.x - prev.x);
        const dz = Math.sign(cur.z - prev.z);
        const turned = dx !== lastDx || dz !== lastDz;
        const isDoor = doorTiles.has(`${cur.x},${cur.z}`);

        if ((turned && since > 0) || isDoor || ++since >= maxSpacing) {
            vias.push(cur);
            since = 0;
        }
        lastDx = dx; lastDz = dz;
    }

    const last = pts[pts.length - 1]!;
    const tail = vias[vias.length - 1]!;
    if (tail.x !== last.x || tail.z !== last.z) vias.push(last);
    return vias;
}

export { Surface };

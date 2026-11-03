// DIRECTED single-step blocks on the SHARED rsmod collision map (sdk/pathfinding.ts + sdk/navgrid/index.ts).
//
// headless/blocked-tiles.ts BLOCKED_EDGES lists DIRECTED steps [x, z, dx, dz] that the SDK's doors-open model
// allows but the server refuses. navgrid.planRoute has always honoured them as its own directed edge set. rsmod
// (findLongPath / findPathToLoc / reachedLoc) did not, for two reasons:
//   1. blocked-edges.applyBlockedEdges closed a WHOLE door (pf.blockDoor) whenever one directed edge touched it —
//      the over-mask that sealed the Ardougne shop room, and it deleted the door from pf's index;
//   2. every entry point then called navgrid.init(), which re-__sets every tile from collision-data.json and
//      re-opens every door, silently undoing (1). Measured: 35/35 re-closed door tiles open again.
//
// Here a directed step is blocked by ONE wall flag on the DESTINATION tile, on the side the step enters from.
// rsmod (like the engine's StepValidator) checks only the destination tile's flags for the entering side, so:
//   - a CARDINAL step A->B: B gets the wall on A's side (e.g. north step => WALL_SOUTH on B);
//   - a DIAGONAL step A->B: B gets the CORNER wall facing A (e.g. NE step => WALL_SOUTH_WEST on B), which only
//     the matching diagonal entry consults.
// The reverse step is untouched (it checks A's flags). Measured over the whole blocked-tiles corridor
// (x2590-3270, z3190-3530, L0, 8 directions): applying all 83 BLOCKED_EDGES refuses EXACTLY those 83 steps, 0 extra,
// 0 missing; blocked-edges.applyBlockedEdges applies the 28 the engine really refuses (live-accepted-edges.json holds the
// other 55) and the oracle pins exactly that set (sim/collision-oracle.test.ts, "init order").
//
// ORDER-INDEPENDENT: the edges live in a registry and are re-ORed after anything that rewrites or clears flags —
// pf.initPathfinding() and navgrid.init() (both re-__set every tile) and pf's door open/close toggle (changeWall
// add=false clears a door's wall bits, which can include one of ours). Re-applying is idempotent (bitwise OR).
import * as rsmod from '../../server/vendor/rsmod-pathfinder';

/** Wall flag to set on the DESTINATION of step (dx, dz): the side/corner the step enters from. */
const ENTRY_WALL: Record<string, number> = {
    '1,0': 0x80,    // east step  -> WALL_WEST on dest
    '-1,0': 0x8,    // west step  -> WALL_EAST
    '0,1': 0x20,    // north step -> WALL_SOUTH
    '0,-1': 0x2,    // south step -> WALL_NORTH
    '1,1': 0x40,    // NE step    -> WALL_SOUTH_WEST
    '1,-1': 0x1,    // SE step    -> WALL_NORTH_WEST
    '-1,1': 0x10,   // NW step    -> WALL_SOUTH_EAST
    '-1,-1': 0x4,   // SW step    -> WALL_NORTH_EAST
};

export interface DirectedEdge { level: number; x: number; z: number; dx: number; dz: number }

const registry = new Map<string, DirectedEdge>();
const edgeKey = (level: number, x: number, z: number, dx: number, dz: number): string => `${level},${x},${z},${dx},${dz}`;

export function entryWallFlag(dx: number, dz: number): number {
    const f = ENTRY_WALL[`${dx},${dz}`];
    if (f === undefined) throw new Error(`edge-blocks: (${dx},${dz}) is not a single step`);
    return f;
}

/** OR one flag into a tile. rsmod has no read-all getter, so rebuild the word bit by bit (32 cheap wasm calls). */
function orFlag(level: number, x: number, z: number, flag: number): void {
    if (!rsmod.isZoneAllocated(x, z, level)) return;   // unallocated = already blocked; re-applied after init anyway
    if (rsmod.isFlagged(x, z, level, flag)) return;
    let v = flag;
    for (let i = 0; i < 32; i++) {
        const b = (1 << i) >>> 0;
        if (rsmod.isFlagged(x, z, level, b)) v |= b;
    }
    rsmod.__set(x, z, level, v >>> 0);
}

function applyOne(e: DirectedEdge): void {
    orFlag(e.level, e.x + e.dx, e.z + e.dz, entryWallFlag(e.dx, e.dz));
}

/**
 * Register directed edges [x, z, dx, dz] on `level` and block them in rsmod now. Idempotent.
 * Returns the number of edges in the call (the registry de-duplicates).
 */
export function addDirectedBlocks(edges: Iterable<readonly [number, number, number, number]>, level = 0): number {
    let n = 0;
    for (const [x, z, dx, dz] of edges) {
        entryWallFlag(dx, dz);   // validate
        const e = { level, x, z, dx, dz };
        registry.set(edgeKey(level, x, z, dx, dz), e);
        applyOne(e);
        n++;
    }
    return n;
}

/** Re-OR every registered edge (call after anything that re-__sets tiles or clears wall bits). Cheap: ~1 wasm call per edge when intact. */
export function reapplyDirectedBlocks(): void {
    for (const e of registry.values()) applyOne(e);
}

export function isDirectedBlocked(level: number, x: number, z: number, dx: number, dz: number): boolean {
    return registry.has(edgeKey(level, x, z, dx, dz));
}

export function directedBlocks(): DirectedEdge[] {
    return [...registry.values()];
}

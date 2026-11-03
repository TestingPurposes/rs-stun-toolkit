// =====================================================================================================
// speedrun/leaf-walls.ts — LIVE door-leaf walls on the shared planner map
// =====================================================================================================
//
// THE BUG CLASS (every quest lane rediscovered it: fb-lib leafWalls/syncLeaves, fg-lib fixDoubleLeaves, sp-lib leafWalls,
// fa-lib closeOpenDoorsNear, ar-lib walkLive, rm-driver RM_OPEN_LEAF_WALLS, essence-miner walkUnwedge): the planners (rsmod
// findLongPath, navgrid planRoute, findPathToLoc) model every door as an open GAP at its closed position. An OPENED door is
// a different loc: doors.rs2 open_door loc_dels the closed door and loc_adds the open leaf on the tile across its own edge
// turned to angle+1 (open_door_reversed: same tile, angle+3); doubledoors.rs2:40-52 turns the LEFT leaf to angle+3 and the
// RIGHT leaf to angle+1 (reversed doubles :196-208 stay on their tile with the same split). That leaf is a real wall on the
// NEXT tile the static map knows nothing about: a planned step across it is refused by the server, the walk wedges, the
// re-plan returns the same route, and no door is "closed" for the door logic to open.
//
// THE FIX: no rules to re-derive. The zone stream's LOC_ADD_CHANGE carries the added loc's shape and angle
// (LocAddChangeEncoder: p1(shape << 2 | angle)), so the open leaf's wall is known EXACTLY. For every live-added loc whose id
// door-states.json lists as an OPEN door variant and whose shape is wall_straight (0), the edge `angle` of its tile is
// walled on the shared rsmod map (which navgrid planRoute, findLongPath, findPathToLoc and reachedLoc all read). The wall is
// taken out again when the leaf goes (LOC_DEL on its tile, the door closed), when the zone is reset to the static map
// (UPDATE_ZONE_FULL_FOLLOWS: the 500-tick revert happened while we were away), or when every bot that saw it is gone.
//
// SAFETY: an edge that is already walled in the map (a real wall on the same side) is never touched — not added, so never
// removed. Removing a wall re-ORs the registered directed edge blocks (edge-blocks.ts), because rsmod changeWall(add=false)
// clears both tiles' bits. Several bots in one process share the map: an entry is reference-counted per bot.
// Switch: SR_LEAF_WALLS=0 (env) or SpeedBot.leafWalls = false turns it off per process / bot.
import * as rsmod from '../../../vendor/rsmod-pathfinder';
import { doorDef } from '../../../../sdk/navgrid/door-tracker.js';
import { reapplyDirectedBlocks } from '../../../../sdk/navgrid/edge-blocks.js';

/** rsmod wall flag on the leaf's own tile for a wall_straight loc at `angle` (0=W 1=N 2=E 3=S), and on the neighbour. */
const OWN_FLAG = [0x80, 0x2, 0x8, 0x20];     // WALL_WEST, WALL_NORTH, WALL_EAST, WALL_SOUTH
const NB_FLAG = [0x8, 0x20, 0x80, 0x2];      // the neighbour's opposite side
const NB = [[-1, 0], [0, 1], [1, 0], [0, -1]];

interface Entry { level: number; x: number; z: number; angle: number; locId: number; owners: Set<object>; added: boolean }
const ENTRIES = new Map<string, Entry>();     // "level,x,z" -> the open leaf standing on that tile (one wall-layer loc per tile)
const tkey = (level: number, x: number, z: number) => `${level},${x},${z}`;

/** Is `locId` (with this shape) an open door leaf the planners must see as a wall? */
export function isOpenLeaf(locId: number, shape: number | undefined): boolean {
    if (shape !== 0) return false;   // wall_straight only (diagonal doors are a different mechanic, see sim SimDoorLoc)
    return doorDef(locId)?.state === 'open';
}

function edgeFlagged(level: number, x: number, z: number, angle: number): boolean {
    try {
        if (!rsmod.isZoneAllocated(x, z, level)) return true;
        const [dx, dz] = NB[angle]!;
        return rsmod.isFlagged(x, z, level, OWN_FLAG[angle]!) || rsmod.isFlagged(x + dx!, z + dz!, level, NB_FLAG[angle]!);
    } catch { return true; }
}

function drop(k: string, e: Entry, owner: object): void {
    e.owners.delete(owner);
    if (e.owners.size) return;
    ENTRIES.delete(k);
    if (e.added) { try { rsmod.changeWall(e.x, e.z, e.level, e.angle, 0, false, false, false); reapplyDirectedBlocks(); } catch { /* map gone */ } }
}

/** LOC_ADD_CHANGE seen by `owner`: a loc now stands on (x,z). Adds the leaf wall if it is an open door leaf. */
export function leafAdded(owner: object, level: number, x: number, z: number, locId: number, shape: number | undefined, angle: number | undefined): void {
    const k = tkey(level, x, z);
    const cur = ENTRIES.get(k);
    if (cur && (cur.locId !== locId || cur.angle !== angle)) drop(k, cur, owner);   // the tile's wall loc changed
    if (!isOpenLeaf(locId, shape) || angle === undefined) return;
    let e = ENTRIES.get(k);
    if (!e) {
        const added = !edgeFlagged(level, x, z, angle);
        if (added) { try { rsmod.changeWall(x, z, level, angle, 0, false, false, true); } catch { /* map gone */ } }
        e = { level, x, z, angle, locId, owners: new Set(), added };
        ENTRIES.set(k, e);
    }
    e.owners.add(owner);
}

/** LOC_DEL seen by `owner` on (x,z): an open leaf there is gone (the door shut / reverted). */
export function leafRemoved(owner: object, level: number, x: number, z: number): void {
    const k = tkey(level, x, z); const e = ENTRIES.get(k);
    if (e) drop(k, e, owner);
}

/** UPDATE_ZONE_FULL_FOLLOWS seen by `owner`: every leaf it reported in the 8x8 zone (SW zoneX,zoneZ) is forgotten. */
export function leafZoneReset(owner: object, level: number, zoneX: number, zoneZ: number): void {
    for (const [k, e] of [...ENTRIES]) {
        if (e.level !== level || (e.x >> 3) !== (zoneX >> 3) || (e.z >> 3) !== (zoneZ >> 3)) continue;
        drop(k, e, owner);
    }
}

/** The bot is gone (logout/dispose): release everything it reported. */
export function leafRelease(owner: object): void {
    for (const [k, e] of [...ENTRIES]) if (e.owners.has(owner)) drop(k, e, owner);
}

/** Current leaf walls (diagnostics/tests): level,x,z,angle,locId,added. */
export function leafWallList(): Array<{ level: number; x: number; z: number; angle: number; locId: number; added: boolean }> {
    return [...ENTRIES.values()].map(e => ({ level: e.level, x: e.x, z: e.z, angle: e.angle, locId: e.locId, added: e.added }));
}
/** Drop every entry (tests). */
export function leafWallsReset(): void { for (const [k, e] of [...ENTRIES]) for (const o of [...e.owners]) drop(k, e, o); }

// ---------------------------------------------------------------------------------------------------------------------
// TEMPORARY directed step blocks (q-lib walkOp's refused-step learner). A step the server keeps refusing that no known door
// explains (a leaf of a loc door-states.json does not list: curtains, fur doors, Miscellania loc_1512, ...) is walled for
// the rest of ONE walk, then released. Same encoding as edge-blocks.ts (one wall flag on the DESTINATION tile, on the side
// the step enters from); a flag that was already set is never cleared.
// ---------------------------------------------------------------------------------------------------------------------
const ENTRY_WALL: Record<string, number> = { '1,0': 0x80, '-1,0': 0x8, '0,1': 0x20, '0,-1': 0x2, '1,1': 0x40, '1,-1': 0x1, '-1,1': 0x10, '-1,-1': 0x4 };
function readFlags(level: number, x: number, z: number): number {
    let v = 0;
    for (let i = 0; i < 32; i++) { const b = (1 << i) >>> 0; if (rsmod.isFlagged(x, z, level, b)) v |= b; }
    return v >>> 0;
}
/** Block the single step (x,z)->(x+dx,z+dz) on `level` (and its reverse). Returns the undo. */
export function tempBlockStep(level: number, x: number, z: number, dx: number, dz: number): () => void {
    const undo: Array<() => void> = [];
    for (const [sx, sz, ddx, ddz] of [[x, z, dx, dz], [x + dx, z + dz, -dx, -dz]] as const) {
        const f = ENTRY_WALL[`${ddx},${ddz}`]; if (f === undefined) continue;
        const tx = sx + ddx, tz = sz + ddz;
        try {
            if (!rsmod.isZoneAllocated(tx, tz, level) || rsmod.isFlagged(tx, tz, level, f)) continue;
            rsmod.__set(tx, tz, level, (readFlags(level, tx, tz) | f) >>> 0);
            undo.push(() => { try { if (rsmod.isFlagged(tx, tz, level, f)) rsmod.__set(tx, tz, level, (readFlags(level, tx, tz) & ~f) >>> 0); } catch { /* gone */ } });
        } catch { /* map gone */ }
    }
    return () => { for (const u of undo) u(); };
}

// LIVE OPEN-DOOR LEAVES on the SHARED rsmod collision map (navgrid.planRoute + sdk/pathfinding read it).
//
// navgrid.init() UNMASKS every straight (shape 0) door so routes pass through it, but nothing put back the wall the
// door becomes when it is OPEN. The open script (doors.rs2 [proc,open_door]) loc_dels the closed door and loc_adds the
// open variant on the NEIGHBOUR tile (door_open: west -1,0 / north 0,+1 / east +1,0 / south 0,-1), rotated +1 — a
// full wall on that tile's side. A route that goes through a door and turns along the wall on the leaf side walks into
// it, and the server (no re-pathing) refuses the step forever.
// Example: Lumbridge castle kitchen north door loc_1536 @(3207,3217) angle 1 (north) opens to loc_1537
// @(3207,3218) angle 2 = a wall on the EAST side of (3207,3218). Every plan from (3207,3218) to Falador went
// (3207,3218)->(3211,3218) due east through it: "TRAVEL WEDGED ... idx=1/456" forever.
// (Diagonal shape-9 doors already block their leaf tile statically: index.ts init.)
//
// Here: the zone stream's LOC_ADD_CHANGE of a door's OPEN variant (shape 0) adds that wall; LOC_DEL / a closed variant
// at the tile / a FULL zone reset removes it again. A leaf we never saw close expires after LEAF_TTL_MS (the
// engine reverts a door after 500 ticks = 300 s). An edge that was ALREADY blocked is never registered, so removing a
// leaf can never clear a static wall.
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../server/vendor/rsmod-pathfinder';
import { reapplyDirectedBlocks } from './edge-blocks.js';

export const LEAF_TTL_MS = 330_000;
const STEP: Record<number, [number, number]> = { 0: [-1, 0], 1: [0, 1], 2: [1, 0], 3: [0, -1] };   // the side the wall is on

interface Leaf { level: number; x: number; z: number; angle: number; until: number }
const leaves = new Map<string, Leaf>();
const key = (level: number, x: number, z: number): string => `${level},${x},${z}`;
let nowFn: () => number = () => Date.now();
/** TEST HOOK: a fake clock */
export function setLeafClock(f: (() => number) | null): void { nowFn = f ?? (() => Date.now()); }

function drop(k: string, l: Leaf): void {
    leaves.delete(k);
    if (rsmod.isZoneAllocated(l.x, l.z, l.level)) rsmod.changeWall(l.x, l.z, l.level, l.angle, 0, false, false, false);
    reapplyDirectedBlocks();   // changeWall(add=false) clears both tiles' side bits: put back any registered directed block
}

/** Expire leaves past their TTL. Cheap (a handful of entries); called on every add/del and by planRoute. */
export function sweepLiveLeaves(): void {
    if (leaves.size === 0) return;
    const now = nowFn();
    for (const [k, l] of leaves) if (l.until <= now) drop(k, l);
}

/**
 * An OPEN door variant appeared at (x,z) with this shape/angle. Only straight walls (shape 0) are modelled.
 * Returns true when the wall is (now) ours — i.e. the step it blocks was free before.
 */
export function addLiveLeaf(level: number, x: number, z: number, shape: number, angle: number): boolean {
    sweepLiveLeaves();
    if (shape !== 0 || !(angle in STEP) || !rsmod.isZoneAllocated(x, z, level)) return false;
    const k = key(level, x, z);
    const cur = leaves.get(k);
    if (cur && cur.angle === angle) { cur.until = nowFn() + LEAF_TTL_MS; return true; }
    if (cur) drop(k, cur);
    const [dx, dz] = STEP[angle]!;
    if (!rsmod.canTravel(level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) return false;   // already a wall there: not ours
    rsmod.changeWall(x, z, level, angle, 0, false, false, true);
    leaves.set(k, { level, x, z, angle, until: nowFn() + LEAF_TTL_MS });
    return true;
}

/** The loc at (x,z) went away (LOC_DEL) or became a non-open loc: lift our leaf there, if any. */
export function delLiveLeaf(level: number, x: number, z: number): boolean {
    sweepLiveLeaves();
    const k = key(level, x, z); const l = leaves.get(k);
    if (!l) return false;
    drop(k, l);
    return true;
}

/** UPDATE_ZONE_FULL_FOLLOWS: the 8x8 zone is back to the static map; the server re-sends any leaf still open. */
export function clearLiveLeavesInZone(level: number, zoneX: number, zoneZ: number): void {
    for (const [k, l] of leaves) if (l.level === level && l.x >> 3 === zoneX >> 3 && l.z >> 3 === zoneZ >> 3) drop(k, l);
}

/**
 * First step of a DENSE (1-step) route the collision map now refuses, checking `maxSteps` steps from `from` through
 * pts[idx..]: its index into pts, or -1. Call after addLiveLeaf to see whether the leaf cut the route being walked.
 */
export function firstRefusedStep(level: number, from: { x: number; z: number }, pts: ReadonlyArray<{ x: number; z: number }>, idx: number, maxSteps = 12): number {
    let a = from;
    for (let i = Math.max(0, idx); i < pts.length && i < idx + maxSteps; i++) {
        const b = pts[i]!; const dx = b.x - a.x, dz = b.z - a.z;
        if ((dx !== 0 || dz !== 0) && Math.abs(dx) <= 1 && Math.abs(dz) <= 1
            && !rsmod.canTravel(level, a.x, a.z, dx, dz, 1, 0, CollisionType.NORMAL)) return i;
        a = b;
    }
    return -1;
}
export function liveLeaves(): Array<{ level: number; x: number; z: number; angle: number }> {
    return [...leaves.values()].map(l => ({ level: l.level, x: l.x, z: l.z, angle: l.angle }));
}
export function clearAllLiveLeaves(): void { for (const [k, l] of leaves) drop(k, l); }

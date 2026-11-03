// cd server/webclient/headless/sim && bun test castle-door-geo.test.ts      (~20 s pathfinder init)
//
// LUMBRIDGE CASTLE SOUTH CORRIDOR GEOMETRY against the REAL server collision (rsmod, sdk/pathfinding):
// the (3215,3211) door edge, the tiles it is operable from, the route through it, and the route the
// planner takes when that edge is masked (what leanbot's wedge rung re-plans with). Offline truth only.
import { describe, test, expect, beforeAll } from 'bun:test';
import { initPathfinding, findLongPath, getDoorAt, reachedLoc, knownDoorCoords } from '../../../../sdk/pathfinding';
import * as rsmod from '../../../vendor/rsmod-pathfinder';
import { doorDef } from '../../../../sdk/navgrid/door-tracker.js';
import { TRAVEL_DOORS, stepCrossesDoorEdge } from '../leanbot.js';

beforeAll(() => { initPathfinding(); }, 120_000);

const DEST = { x: 3104, z: 3161 };

/** Every tile reachable from (sx,sz) by cardinal steps within r, with EVERY known door edge closed. */
function pocket(sx: number, sz: number, r: number): Set<string> {
    const seen = new Set([`${sx},${sz}`]); const q: Array<[number, number]> = [[sx, sz]];
    while (q.length) {
        const [x, z] = q.shift()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
            if (seen.has(k) || Math.abs(nx - sx) > r || Math.abs(nz - sz) > r) continue;
            if (!rsmod.canTravel(0, x, z, dx, dz, 1, 0, 0)) continue;
            const a = { x, z }, b = { x: nx, z: nz };
            const da = getDoorAt(0, x, z), db = getDoorAt(0, nx, nz);
            if ((da && stepCrossesDoorEdge(da, a, b)) || (db && stepCrossesDoorEdge(db, a, b))) continue;
            seen.add(k); q.push([nx, nz]);
        }
    }
    return seen;
}

describe('the (3215,3211) door', () => {
    test('is a straight wall door on the NORTH edge of its tile, loc 1536 (closed variant), routed by the planner', () => {
        expect(getDoorAt(0, 3215, 3211)).toEqual({ level: 0, x: 3215, z: 3211, shape: 0, angle: 1, blockrange: true });
        expect(knownDoorCoords().has('0,3215,3211')).toBe(true);
        const td = TRAVEL_DOORS.find(d => d.level === 0 && d.x === 3215 && d.z === 3211);
        expect(td).toMatchObject({ locId: 1536, op: 1 });   // junk-listed id, kept because the planner routes through it
        expect(doorDef(1536)).toMatchObject({ state: 'closed', pair: 1537, op: 1 });
    });
    test('its edge is crossed by (3215,3211)<->(3215,3212) only', () => {
        const d = getDoorAt(0, 3215, 3211)!;
        expect(stepCrossesDoorEdge(d, { x: 3215, z: 3211 }, { x: 3215, z: 3212 })).toBe(true);
        expect(stepCrossesDoorEdge(d, { x: 3215, z: 3212 }, { x: 3215, z: 3211 })).toBe(true);
        expect(stepCrossesDoorEdge(d, { x: 3215, z: 3211 }, { x: 3214, z: 3211 })).toBe(false);
        expect(stepCrossesDoorEdge(d, { x: 3215, z: 3211 }, { x: 3215, z: 3210 })).toBe(false);
        expect(stepCrossesDoorEdge(d, { x: 3214, z: 3211 }, { x: 3215, z: 3211 })).toBe(false);
    });
    test('is operable from the door tile itself, its north neighbour and both side neighbours — not from the south', () => {
        const op = (x: number, z: number) => reachedLoc(0, x, z, 3215, 3211, 1, 1, 1, 0);
        expect(op(3215, 3211)).toBe(true);
        expect(op(3215, 3212)).toBe(true);
        expect(op(3214, 3211)).toBe(true);
        expect(op(3216, 3211)).toBe(true);
        expect(op(3215, 3210)).toBe(false);
    });
});

describe('the south corridor (the castle stair landing) is a two-door pocket', () => {
    test('with every door edge closed, (3215,3211) and the stair landing (3205,3209) share a sealed 29-tile pocket', () => {
        const p = pocket(3215, 3211, 25);
        expect(p.size).toBe(29);
        expect(p.has('3205,3209')).toBe(true);
        expect(p.has('3208,3211')).toBe(true);
        expect(p.has('3215,3212')).toBe(false);
    });
    test('the planner routes (3215,3211)->(3104,3161) NORTH through the 1536 edge (the live route)', () => {
        const wp = findLongPath(0, 3215, 3211, DEST.x, DEST.z, 600);
        expect(wp[0]).toMatchObject({ x: 3215, z: 3217 });   // first turning point: straight north through the edge
        expect(wp[wp.length - 1]).toMatchObject(DEST);
    });
    test('with that edge MASKED the planner leaves by the WEST door (3208,3211) and still reaches the destination', () => {
        const d = getDoorAt(0, 3215, 3211)!;
        const wp = findLongPath(0, 3215, 3211, DEST.x, DEST.z, 600, [d]);
        expect(wp[0]).toMatchObject({ x: 3208, z: 3211 });
        expect(wp[1]).toMatchObject({ x: 3208, z: 3216 });   // north through the 1530 edge
        expect(wp[wp.length - 1]).toMatchObject(DEST);
        // the mask is per-query: the shared collision is restored afterwards
        expect(findLongPath(0, 3215, 3211, DEST.x, DEST.z, 600)[0]).toMatchObject({ x: 3215, z: 3217 });
    });
    test('with BOTH exits masked there is no way out (the masked re-plan cannot invent one)', () => {
        const wp = findLongPath(0, 3215, 3211, DEST.x, DEST.z, 600, [getDoorAt(0, 3215, 3211)!, getDoorAt(0, 3208, 3211)!]);
        const end = wp[wp.length - 1];
        expect(!end || end.x !== DEST.x || end.z !== DEST.z).toBe(true);
    });
});

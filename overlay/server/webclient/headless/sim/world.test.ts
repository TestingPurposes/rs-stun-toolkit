// bun test server/webclient/headless/sim/world.test.ts
//
// The engine-semantics layer: takeStep order, the permanent-wedge rule, run vs
// walk, MOVE-cancels-OP, loc ops only on a zero-step tick, npc wander/patrol.
// Uses openField() collision (no WASM) except the real-collision suite at the
// bottom, which is what caught the toVias corner-cutting bug offline.
import { describe, test, expect, beforeAll } from 'bun:test';
import { ClientProt } from '#/io/ClientProt.js';
import { SimWorld, simulateWaypoints, simulateRoute, openField, rsmodCanTravel, type CanTravelFn } from './world.ts';

const open = openField();
// Wall segment: blocks all movement across the x=10/x=11 boundary for z in [0,20].
const wallAtX10: CanTravelFn = (_l, x, _z, dx, _dz) => {
    if (dx > 0 && x === 10) return false;
    if (dx < 0 && x === 11) return false;
    return true;
};

describe('takeStep — engine order and the wedge rule', () => {
    // Every MOVE packet's path[0] is the player's OWN tile (it is the packet's absolute
    // start field; MoveClickHandler queues it verbatim). takeStep against a waypoint you
    // already stand on returns [0,0], so the FIRST tick after any move click is consumed
    // advancing past that self-start waypoint with zero steps. Real engine behavior —
    // it is why the brains keep a "+1 cursor" and why a resend replays a leg.
    test('the self-start waypoint (path[0] === own tile) burns one tick, then movement flows', () => {
        const w = new SimWorld(0, 0, open);
        w.player.queueWaypoints([{ x: 0, z: 0 }, { x: 1, z: 1 }]);
        w.player.processMovement(false);
        expect({ x: w.player.x, z: w.player.z }).toEqual({ x: 0, z: 0 }); // burned
        w.player.processMovement(false);
        expect({ x: w.player.x, z: w.player.z }).toEqual({ x: 1, z: 1 }); // then steps
    });

    test('diagonal preferred when legal', () => {
        const w = new SimWorld(0, 0, open);
        w.player.queueWaypoints([{ x: 1, z: 1 }]);
        w.player.processMovement(false);
        expect({ x: w.player.x, z: w.player.z }).toEqual({ x: 1, z: 1 });
    });

    test('falls back to E/W when the diagonal is blocked, producing the L-shaped wiggle', () => {
        // block only the diagonal NE step from (0,0)
        const canTravel: CanTravelFn = (_l, x, z, dx, dz) => !(x === 0 && z === 0 && dx === 1 && dz === 1);
        const w = new SimWorld(0, 0, canTravel);
        w.player.queueWaypoints([{ x: 1, z: 1 }]);
        w.player.processMovement(false);
        expect({ x: w.player.x, z: w.player.z }).toEqual({ x: 1, z: 0 }); // E/W first, not N/S
    });

    test('fully blocked = [0,0], waypoint index NOT advanced -> permanent wedge', () => {
        const w = new SimWorld(10, 5, wallAtX10);
        w.player.queueWaypoints([{ x: 11, z: 5 }]);
        const idxBefore = w.player.wpIndex;
        for (let i = 0; i < 5; i++) w.player.processMovement(true);
        expect({ x: w.player.x, z: w.player.z }).toEqual({ x: 10, z: 5 }); // never moved
        expect(w.player.wpIndex).toBe(idxBefore);                          // never advanced
        expect(w.player.hasWaypoints()).toBe(true);                        // stuck forever
    });

    test('run takes 2 steps/tick; the 2nd is re-validated (blocked mid-run = 1 step)', () => {
        const w = new SimWorld(8, 5, wallAtX10);
        w.player.queueWaypoints([{ x: 9, z: 5 }, { x: 10, z: 5 }, { x: 11, z: 5 }]);
        w.player.processMovement(true);
        expect(w.player.x).toBe(10); // two steps
        w.player.processMovement(true);
        expect(w.player.x).toBe(10); // wall: zero steps, not one
    });

    test('walk takes exactly 1 step/tick', () => {
        const w = new SimWorld(0, 0, open);
        w.player.queueWaypoints([{ x: 1, z: 0 }, { x: 2, z: 0 }]);
        w.player.processMovement(false);
        expect(w.player.x).toBe(1);
    });

    test('queueWaypoints reverses and caps at 25', () => {
        const w = new SimWorld(0, 0, open);
        const path = Array.from({ length: 40 }, (_, i) => ({ x: i, z: 0 }));
        w.player.queueWaypoints(path);
        expect(w.player.wpIndex).toBe(24);
        expect(w.player.wp[w.player.wpIndex]).toEqual({ x: 15, z: 0 }); // last 25 of 40, consumed from index 24
    });

    test('MOVE cancels a pending OPNPC too (same clearPendingAction root)', () => {
        const w = new SimWorld(0, 0, open);
        w.addNpc(7, 23, 1, 0);
        w.tickOnce([{ type: 'opnpc', op: 3, index: 7 }]); // adjacent -> would fire
        const ev = w.tickOnce([
            { type: 'opnpc', op: 3, index: 7 },
            { type: 'move', opcode: ClientProt.MOVE_GAMECLICK, opclick: false, ctrl: 1, path: [{ x: 0, z: 0 }, { x: 0, z: 1 }] },
        ]);
        expect(ev.some(e => e.kind === 'op-cancelled-by-move')).toBe(true);
        expect(ev.some(e => e.kind === 'op-fired')).toBe(false);
    });
});

describe('simulateWaypoints — the offline path oracle', () => {
    test('a legal per-tile path arrives', () => {
        const path = Array.from({ length: 6 }, (_, i) => ({ x: i, z: i }));
        const r = simulateWaypoints(open, { x: 0, z: 0 }, path);
        expect(r.arrived).toBe(true);
        expect(r.end).toEqual({ x: 5, z: 5 });
    });

    test('a corner-cutting path (the toVias bug) wedges at the wall', () => {
        // "via" style: jump from (9,5) straight to (12,5) — the densified straight
        // line crosses the x=10|11 wall, which the naive server cannot step through.
        const r = simulateWaypoints(wallAtX10, { x: 9, z: 5 }, [{ x: 9, z: 5 }, { x: 12, z: 5 }]);
        expect(r.arrived).toBe(false);
        expect(r.wedgedAt).toEqual({ x: 10, z: 5 });
    });
});

describe('SimWorld tick semantics', () => {
    test('MOVE cancels a pending OPLOC (clearPendingAction) — THE gate bug', () => {
        const w = new SimWorld(3, 5, open);
        w.addDoor(6, 5, 1551, [[5, 5, 1, 0]]);
        // walk toward the door + request the open (one flush): op stays pending while stepping
        w.tickOnce([
            { type: 'move', opcode: ClientProt.MOVE_GAMECLICK, opclick: true, ctrl: 1, path: [{ x: 3, z: 5 }, { x: 4, z: 5 }, { x: 5, z: 5 }] },
            { type: 'oploc', op: 1, x: 6, z: 5, locId: 1551 },
        ]);
        // the brain impatiently re-sends a MOVE before the op could fire -> cancelled
        const ev = w.tickOnce([{ type: 'move', opcode: ClientProt.MOVE_GAMECLICK, opclick: false, ctrl: 1, path: [{ x: 4, z: 5 }, { x: 5, z: 5 }] }]);
        expect(ev.some(e => e.kind === 'op-cancelled-by-move')).toBe(true);
        expect(w.doors[0]!.open).toBe(false); // the door never opened — this is why suppressMoveUntil exists
    });

    test('...and holding MOVEs after the OPLOC lets it fire (suppressMoveUntil works)', () => {
        const w = new SimWorld(3, 5, open);
        w.addDoor(6, 5, 1551, [[5, 5, 1, 0]]);
        w.tickOnce([
            { type: 'move', opcode: ClientProt.MOVE_GAMECLICK, opclick: true, ctrl: 1, path: [{ x: 3, z: 5 }, { x: 4, z: 5 }, { x: 5, z: 5 }] },
            { type: 'oploc', op: 1, x: 6, z: 5, locId: 1551 },
        ]);
        let opened = false;
        for (let i = 0; i < 6 && !opened; i++) opened = w.tickOnce([]).some(e => e.kind === 'door-opened'); // no MOVEs
        expect(opened).toBe(true);
        expect(w.canStep(0, 5, 5, 1, 0)).toBe(true);
    });

    test('OPLOC with no MOVE after it fires and opens the door', () => {
        const w = new SimWorld(5, 5, open);
        w.addDoor(6, 5, 1551, [[5, 5, 1, 0]]);
        // door edge is closed: cannot step east
        expect(w.canStep(0, 5, 5, 1, 0)).toBe(false);
        const ev = w.tickOnce([{ type: 'oploc', op: 1, x: 6, z: 5, locId: 1551 }]);
        expect(ev.some(e => e.kind === 'op-fired')).toBe(true);
        expect(w.doors[0]!.open).toBe(true);
        expect(w.canStep(0, 5, 5, 1, 0)).toBe(true); // now passable
    });

    test('a loc op does NOT fire on a tick where the player stepped', () => {
        const w = new SimWorld(3, 5, open);
        w.addDoor(6, 5, 1551, [[5, 5, 1, 0]]);
        // walk toward the door AND request the op in the same tick: move wins, op is cancelled
        const ev = w.tickOnce([
            { type: 'move', opcode: ClientProt.MOVE_GAMECLICK, opclick: false, ctrl: 1, path: [{ x: 3, z: 5 }, { x: 4, z: 5 }, { x: 5, z: 5 }] },
            { type: 'oploc', op: 1, x: 6, z: 5, locId: 1551 },
        ]);
        expect(ev.some(e => e.kind === 'op-fired')).toBe(false);
        expect(w.doors[0]!.open).toBe(false);
    });

    test('OPNPC fires when cardinally adjacent, and the engine walks us there otherwise', () => {
        const w = new SimWorld(0, 0, open);
        w.addNpc(7, 23, 4, 0);
        // far: engine re-paths toward the npc, no op yet
        const ev = w.tickOnce([{ type: 'opnpc', op: 3, index: 7 }]);
        expect(ev.some(e => e.kind === 'op-fired')).toBe(false);
        expect(w.player.x).toBeGreaterThan(0);
        // keep ticking with no further client input: engine keeps walking, then fires
        let fired = false;
        for (let i = 0; i < 6 && !fired; i++) fired = w.tickOnce([]).some(e => e.kind === 'op-fired');
        expect(fired).toBe(true);
        expect(Math.abs(w.player.x - 4) + Math.abs(w.player.z - 0)).toBe(1); // adjacent, not under
    });

    test('illegal (non-adjacent) waypoint hops are flagged', () => {
        const w = new SimWorld(0, 0, open);
        const ev = w.tickOnce([{ type: 'move', opcode: ClientProt.MOVE_GAMECLICK, opclick: false, ctrl: 1, path: [{ x: 0, z: 0 }, { x: 5, z: 0 }] }]);
        expect(ev.some(e => e.kind === 'illegal-waypoint-gap')).toBe(true);
    });

    test('npc wander stays within its range of SPAWN and re-rolls while moving', () => {
        const w = new SimWorld(100, 100, open, 7);
        const npc = w.addNpc(1, 23, 50, 50, { mode: 'wander', range: 5 });
        for (let i = 0; i < 300; i++) w.tickOnce([]);
        expect(Math.abs(npc.x - 50)).toBeLessThanOrEqual(5);
        expect(Math.abs(npc.z - 50)).toBeLessThanOrEqual(5);
        expect(npc.x !== 50 || npc.z !== 50).toBe(true); // it actually moved
    });

    test('npc patrol visits both of its points', () => {
        const w = new SimWorld(100, 100, open);
        const npc = w.addNpc(1, 23, 0, 0, { mode: 'patrol', points: [{ x: 3, z: 0 }, { x: 0, z: 0 }] });
        const seen = new Set<string>();
        for (let i = 0; i < 20; i++) { w.tickOnce([]); seen.add(`${npc.x},${npc.z}`); }
        expect(seen.has('3,0')).toBe(true);
        expect(seen.has('0,0')).toBe(true);
        expect(npc.x).toBeGreaterThanOrEqual(0);
        expect(npc.x).toBeLessThanOrEqual(3);
    });
});

describe('REAL collision (rsmod WASM) — the Ardougne market', () => {
    let real: CanTravelFn;
    beforeAll(async () => {
        const { initPathfinding, blockDoor } = await import('../../../../sdk/pathfinding');
        initPathfinding();
        const { applyBlockedEdges } = await import('../blocked-edges.ts');
        applyBlockedEdges(blockDoor);
        real = rsmodCanTravel();
    }, 60_000);

    test('navgrid per-tile route to the bank stand is step-legal and arrives', async () => {
        const navgrid = await import('../../../../sdk/navgrid/index.ts');
        navgrid.init();
        const route = navgrid.planRoute(2661, 3305, 2655, 3283, { level: 0, arrive: 0, maxExpansions: 200_000 });
        expect(route).not.toBeNull();
        const path = route!.waypoints.map(w => ({ x: w.x, z: w.z }));
        // every hop is a legal 1-step move (the naive-router contract)
        for (let i = 1; i < path.length; i++) {
            const p = path[i - 1]!, q = path[i]!;
            expect(real(0, p.x, p.z, q.x - p.x, q.z - p.z)).toBe(true);
        }
        const r = simulateRoute(real, path);
        expect(r.arrived).toBe(true);
        expect(r.end).toEqual({ x: 2655, z: 3283 });
    }, 60_000);

    test('a >25-tile route sent in ONE packet beelines and misses (engine waypoint cap)', async () => {
        const navgrid = await import('../../../../sdk/navgrid/index.ts');
        const route = navgrid.planRoute(2661, 3305, 2655, 3283, { level: 0, arrive: 0, maxExpansions: 200_000 })!;
        const path = route.waypoints.map(w => ({ x: w.x, z: w.z }));
        expect(path.length).toBeGreaterThan(25); // the cap matters here
        const r = simulateWaypoints(real, path[0]!, path);
        expect(r.arrived).toBe(false); // only the LAST 25 waypoints survive queueWaypoints
    }, 60_000);

    test('toVias-style thinning of that same route CUTS CORNERS and wedges', async () => {
        const navgrid = await import('../../../../sdk/navgrid/index.ts');
        const route = navgrid.planRoute(2661, 3305, 2655, 3283, { level: 0, arrive: 0, maxExpansions: 200_000 })!;
        const vias = navgrid.toVias(route, 12);
        // densify between vias with straight diagonal-first lines (what the old client did)
        const dense: Array<{ x: number; z: number }> = [{ x: vias[0]!.x, z: vias[0]!.z }];
        for (let i = 1; i < vias.length; i++) {
            let { x, z } = dense[dense.length - 1]!;
            while (x !== vias[i]!.x || z !== vias[i]!.z) {
                x += Math.sign(vias[i]!.x - x); z += Math.sign(vias[i]!.z - z);
                dense.push({ x, z });
            }
        }
        const illegal = dense.slice(1).filter((p, i) => !real(0, dense[i]!.x, dense[i]!.z, p.x - dense[i]!.x, p.z - dense[i]!.z));
        expect(illegal.length).toBeGreaterThan(0); // corner-cut steps the server refuses
        const r = simulateWaypoints(real, dense[0]!, dense);
        expect(r.arrived).toBe(false);             // and the naive router wedges on one
    }, 60_000);
});

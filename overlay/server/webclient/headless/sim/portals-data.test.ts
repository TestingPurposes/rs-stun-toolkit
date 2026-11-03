// PORTAL-DATA INTEGRITY — static assertions over the EXTRACTED portals.json (no WASM, no server).
// Pins the invariants that live-bit us, so the extractor can't silently regress the graph.
//
// The stair_options bug: a `stair_options(up, down)`
// staircase is the "Climb up or down" MENU op (oploc1). Its DIRECT climb ops are op2=Climb-up and
// op3=Climb-down (verified in stairs.rs2: [oploc2,loc_1739] telejumps UP, [oploc3,loc_1739] telejumps
// DOWN). The extractor used to emit the down leg as op2 (its stair_options arg index) — so the bot
// OPLOC'd op2, which LIVE climbs UP to L2, then wedged re-OPLOCing an L1 loc from L2 and parked.
import { describe, test, expect } from 'bun:test';
import PORTALS from '../../../../sdk/navgrid/portals.json';

type P = { x: number; z: number; level: number; op: number; locId: number | null; label?: string;
    dest: { level: number; x: number; z: number } };
const portals = PORTALS as P[];

describe('portals.json — stair_options climb ops', () => {
    test('every stair_options-derived portal uses op2 for UP and op3 for DOWN (never op1/op2)', () => {
        // stair_options portals carry the '-up'/'-down' label suffix the extractor stamps.
        const stairOpts = portals.filter(p => /-(up|down)$/.test(p.label ?? ''));
        expect(stairOpts.length).toBeGreaterThan(0);   // sanity: they exist
        const wrong = stairOpts.filter(p => {
            const goesUp = p.dest.level > p.level;
            const goesDown = p.dest.level < p.level;
            return (goesUp && p.op !== 2) || (goesDown && p.op !== 3);
        });
        expect(wrong.map(p => `loc${p.locId}@(${p.level},${p.x},${p.z}) op=${p.op} ->L${p.dest.level}`)).toHaveLength(0);
    });

    test('the Lumbridge South staircase (loc 1739) specifically climbs DOWN via op3 -> L0', () => {
        const down = portals.find(p => p.locId === 1739 && p.x === 3204 && p.z === 3207 && p.dest.level === 0);
        expect(down).toBeDefined();
        expect(down!.op).toBe(3);
        const up = portals.find(p => p.locId === 1739 && p.x === 3204 && p.z === 3207 && p.dest.level === 2);
        expect(up).toBeDefined();
        expect(up!.op).toBe(2);
    });

    test('no portal is self-referential (dest === source) — a no-op climb that would hang the follower', () => {
        const selfies = portals.filter(p => p.dest.level === p.level && p.dest.x === p.x && p.dest.z === p.z);
        expect(selfies.map(p => `loc${p.locId}@(${p.level},${p.x},${p.z})`)).toHaveLength(0);
    });
});

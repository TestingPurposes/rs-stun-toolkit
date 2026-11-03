// DOOR-CONSISTENCY SUITE — pins the invariant behind the wizard-tower wedge (live-caught TWICE on
//): the pathfinder ROUTES THROUGH every door it unmasks (collision-data wall doors + the
// diagonal set), so the bots must be WILLING TO OPLOC every one of them that has a door-table entry.
// A junk-classified loc id (1530/1536/...) placed as a real travel door must pass the TRAVEL_DOORS
// filter at that coordinate, or a route that needs it wedges the bot at a closed door forever.
// Fast + static (no WASM init): the filter and the coord set are both derivable from checked-in data.
import { describe, test, expect } from 'bun:test';
import { TRAVEL_DOORS } from '../leanbot.ts';
import { DOORS } from '../door-table.ts';
import { knownDoorCoords } from '../../../../sdk/pathfinding';
import DIAGONAL_DOORS from '../../../../sdk/navgrid/diagonal-doors.json';

// ⛔ THE ONE EXCEPTION, AND WHY THE INVARIANT NEEDS ONE. The invariant above assumes OPLOC-able ==
// passable. For the AL KHARID TOLL GATE that is simply false: its op1 does not swing anything, it opens a
// p_choice DIALOG asking for 10gp (border_gate.rs2:35), and no amount of OPLOCing opens it. Leaving it in
// TRAVEL_DOORS is what let doTravel's stall handler open the modal for a bot that had no idea it was
// crossing a border, whereupon the base driveDialog answered with option 1 = "No thank you, I'll walk
// around." — thousands of clicks, zero progress, inside a healthy connection. So the gate is
// excluded from the blind opener and crossing it belongs to the brains that KNOW they are crossing
// (TrainBot.travelAssist / OutfitterBot), which pay it by geography at the operable tile.
const TOLL_GATE_COORDS = ['0,3268,3227', '0,3268,3228'];

describe('door-table / pathfinder consistency', () => {
    test('every pathfinder-routed door with a door-table entry is OPLOC-able (no junk-filter wedge)', () => {
        const pathed = knownDoorCoords();   // "level,x,z"
        const travel = new Set(TRAVEL_DOORS.map(d => `${d.level},${d.x},${d.z}`));
        const missing = DOORS.filter(d =>
            /^(door|gate|large door)/i.test(d.name) && pathed.has(`${d.level},${d.x},${d.z}`)
            && !travel.has(`${d.level},${d.x},${d.z}`)
            && !TOLL_GATE_COORDS.includes(`${d.level},${d.x},${d.z}`));
        expect(missing.map(d => `${d.name}#${d.locId}@(${d.level},${d.x},${d.z})`)).toHaveLength(0);
    });

    test('the TOLL GATE is deliberately NOT in the blind opener (its op1 is a dialog, not a hinge)', () => {
        const travel = new Set(TRAVEL_DOORS.map(d => `${d.level},${d.x},${d.z}`));
        for (const c of TOLL_GATE_COORDS) expect(travel.has(c)).toBe(false);
        // and it IS still in the raw table, because the toll-aware brains OPLOC it explicitly by id
        expect(DOORS.some(d => d.locId === 2882 && d.x === 3268 && d.z === 3227)).toBe(true);
    });

    test('every diagonal door has a door-table entry (else nothing can open it live)', () => {
        const table = new Set(DOORS.map(d => `${d.level},${d.x},${d.z}`));   // the table is now ALL levels
        const missing = (DIAGONAL_DOORS as Array<{ level: number; x: number; z: number; locId: number }>)
            .filter(d => !table.has(`${d.level},${d.x},${d.z}`));
        expect(missing).toHaveLength(0);
    });

    test('the wizard tower doors specifically (the original wedge) are all OPLOC-able', () => {
        const travel = new Set(TRAVEL_DOORS.map(d => `${d.level},${d.x},${d.z}`));
        for (const c of ['0,3107,3162', '0,3109,3166', '0,3111,3163']) expect(travel.has(c)).toBe(true);
    });
});

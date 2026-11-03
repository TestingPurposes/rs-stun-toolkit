// cd server/webclient/headless/sim && bun test quest-troll-geo.test.ts      (~30 s pathfinder init)
//
// TROLL STRONGHOLD GEOMETRY against the REAL server collision (rsmod, sdk/pathfinding): every scripted transition's
// stand tile is one the engine's own reached() accepts (incl. the stairs' rotated forceapproach), every walking leg
// between two transitions routes on its plane, and quest-troll.ts's classifyRegion() agrees with rsmod
// connectivity tile-for-tile in the ambiguous areas. Offline truth only — no live claim.
import { describe, test, expect, beforeAll } from 'bun:test';
import { initPathfinding, findLongPath, isTileWalkable } from '../../../../sdk/pathfinding';
import * as rsmod from '../../../vendor/rsmod-pathfinder';
import { locDims } from '../../../../sdk/navgrid/locmeta';
import { TROLL_T, TROLL_NPC_AT, GODRIC_CELL, classifyRegion, type TrollRegion } from '../quest-troll.js';

beforeAll(() => { initPathfinding(); }, 120_000);

/** jm2 placement (shape, angle) of each transition loc — cited in quest-troll.ts TROLL_T. */
const PLACE: Record<string, { shape: number; angle: number }> = {
    DP_UP: { shape: 22, angle: 0 }, DP_DOWN: { shape: 22, angle: 0 }, RS_N: { shape: 10, angle: 2 }, RS_S: { shape: 10, angle: 2 },
    R2834_S: { shape: 10, angle: 2 }, CLIMB1_E: { shape: 22, angle: 2 }, CLIMB1_W: { shape: 22, angle: 2 }, CLIMB2_E: { shape: 22, angle: 3 },
    CLIMB2_W: { shape: 22, angle: 1 }, ARENA_IN: { shape: 0, angle: 0 }, ARENA_OUT_W: { shape: 0, angle: 0 }, ARENA_EXIT: { shape: 0, angle: 3 },
    PASS_IN: { shape: 10, angle: 0 }, PASS_OUT: { shape: 10, angle: 0 }, SH_DOOR: { shape: 10, angle: 0 }, L2_DOWN: { shape: 10, angle: 1 },
    L1_UP: { shape: 10, angle: 1 }, PRISON_DOOR: { shape: 0, angle: 0 }, L1_DOWN: { shape: 10, angle: 0 }, PRISON_EXIT: { shape: 10, angle: 2 },
};
/** forceapproach (pack LocConfig: all four bits minus the approach side): stairs 3788 = south, stairstop 3789 = north. */
const FORCE: Record<number, number> = { 3788: 0b1011, 3789: 0b1110 };

function reached(level: number, sx: number, sz: number, id: number, x: number, z: number, shape: number, angle: number): boolean {
    const d = locDims(id); const w = (angle & 1) ? d.l : d.w, l = (angle & 1) ? d.w : d.l;
    return rsmod.reached(level, sx, sz, x, z, w, l, 1, angle, shape, FORCE[id] ?? 0);
}
function routes(level: number, sx: number, sz: number, dx: number, dz: number): boolean {
    if (sx === dx && sz === dz) return true;
    const wp = findLongPath(level, sx, sz, dx, dz, 600); const e = wp[wp.length - 1];
    return !!e && e.x === dx && e.z === dz;
}

describe('every scripted transition is operable from its stand tile', () => {
    for (const [id, t] of Object.entries(TROLL_T)) {
        test(id, () => {
            const p = PLACE[id]!;
            expect(isTileWalkable(t.level, t.stand.x, t.stand.z)).toBe(true);
            expect(reached(t.level, t.stand.x, t.stand.z, t.loc.id, t.loc.x, t.loc.z, p.shape, p.angle)).toBe(true);
        });
    }
    test("Godric's cell door", () => {
        expect(reached(0, GODRIC_CELL.stand.x, GODRIC_CELL.stand.z, GODRIC_CELL.loc.id, GODRIC_CELL.loc.x, GODRIC_CELL.loc.z, 0, 0)).toBe(true);
    });
    test('the stairs REFUSE the wrong face (forceapproach is real)', () => {
        expect(reached(2, 2843, 10107, 3789, 2843, 10108, 10, 1)).toBe(false);   // south face of the L2 stairstop
        expect(reached(1, 2851, 10107, 3789, 2852, 10107, 10, 0)).toBe(false);   // west face of the L1 stairstop
    });
});

describe('every walking leg routes on its plane', () => {
    // [label, level, from(x,z), to(x,z)] — landing tile of one transition -> stand tile of the next (both directions)
    const T = TROLL_T;
    const LEGS: Array<[string, number, number, number, number, number]> = [
        ['Denulth -> DP_UP', 0, TROLL_NPC_AT.DENULTH.x, TROLL_NPC_AT.DENULTH.z, T.DP_UP!.stand.x, T.DP_UP!.stand.z],
        ['Denulth -> Tenzing', 0, TROLL_NPC_AT.DENULTH.x, TROLL_NPC_AT.DENULTH.z, TROLL_NPC_AT.TENZING.x, TROLL_NPC_AT.TENZING.z],
        ['Tenzing -> DP_UP', 0, TROLL_NPC_AT.TENZING.x, TROLL_NPC_AT.TENZING.z, T.DP_UP!.stand.x, T.DP_UP!.stand.z],
        ['DP_UP -> RS_N', 0, 2880, 3596, T.RS_N!.stand.x, T.RS_N!.stand.z],
        ['RS_N -> CLIMB1_E', 0, 2856, 3613, T.CLIMB1_E!.stand.x, T.CLIMB1_E!.stand.z],
        ['CLIMB1_E -> CLIMB2_E', 0, 2861, 3626, T.CLIMB2_E!.stand.x, T.CLIMB2_E!.stand.z],
        ['CLIMB2_E -> ARENA_IN', 0, 2880, 3622, T.ARENA_IN!.stand.x, T.ARENA_IN!.stand.z],
        ['ARENA_IN -> Dad', 0, 2897, 3618, TROLL_NPC_AT.DAD.x, TROLL_NPC_AT.DAD.z],
        ['ARENA_IN -> ARENA_EXIT', 0, 2897, 3618, T.ARENA_EXIT!.stand.x, T.ARENA_EXIT!.stand.z],
        ['ARENA_EXIT -> PASS_IN', 0, 2916, 3629, T.PASS_IN!.stand.x, T.PASS_IN!.stand.z],
        ['PASS_IN -> PASS_OUT (underground)', 0, 2907, 10019, T.PASS_OUT!.stand.x, T.PASS_OUT!.stand.z],
        ['PASS_OUT -> SH_DOOR', 0, 2908, 3654, T.SH_DOOR!.stand.x, T.SH_DOOR!.stand.z],
        ['SH_DOOR -> L2 General hall (via the interior door)', 2, 2837, 10090, TROLL_NPC_AT.GENERAL_HALL.x, TROLL_NPC_AT.GENERAL_HALL.z],
        ['General hall -> L2_DOWN', 2, TROLL_NPC_AT.GENERAL_HALL.x, TROLL_NPC_AT.GENERAL_HALL.z, T.L2_DOWN!.stand.x, T.L2_DOWN!.stand.z],
        ['SH_DOOR -> L2_DOWN', 2, 2837, 10090, T.L2_DOWN!.stand.x, T.L2_DOWN!.stand.z],
        ['L2_DOWN -> PRISON_DOOR', 1, 2841, 10108, T.PRISON_DOOR!.stand.x, T.PRISON_DOOR!.stand.z],
        ['L2_DOWN -> L1_UP', 1, 2841, 10108, T.L1_UP!.stand.x, T.L1_UP!.stand.z],
        ['PRISON_DOOR -> L1_DOWN', 1, 2848, 10107, T.L1_DOWN!.stand.x, T.L1_DOWN!.stand.z],
        ['L1_DOWN -> Twig', 0, 2852, 10105, TROLL_NPC_AT.TWIG.x, TROLL_NPC_AT.TWIG.z],
        ["Twig -> Godric's cell", 0, TROLL_NPC_AT.TWIG.x, TROLL_NPC_AT.TWIG.z, GODRIC_CELL.stand.x, GODRIC_CELL.stand.z],
        ['cell -> PRISON_EXIT', 0, GODRIC_CELL.stand.x, GODRIC_CELL.stand.z, T.PRISON_EXIT!.stand.x, T.PRISON_EXIT!.stand.z],
        ['PRISON_EXIT -> R2834_S', 0, 2827, 3646, T.R2834_S!.stand.x, T.R2834_S!.stand.z],
        ['R2834_S -> RS_S', 0, 2834, 3627, T.RS_S!.stand.x, T.RS_S!.stand.z],
        ['RS_S -> DP_DOWN', 0, 2856, 3611, T.DP_DOWN!.stand.x, T.DP_DOWN!.stand.z],
        ['DP_DOWN -> Dunstan', 0, 2880, 3593, TROLL_NPC_AT.DUNSTAN.x, TROLL_NPC_AT.DUNSTAN.z],
        // the reverse climbs (a 'claim'/'complete' run that wakes up on the shelves)
        ['ARENA_OUT_W -> CLIMB2_W', 0, 2896, 3618, T.CLIMB2_W!.stand.x, T.CLIMB2_W!.stand.z],
        ['CLIMB2_W -> CLIMB1_W', 0, 2877, 3622, T.CLIMB1_W!.stand.x, T.CLIMB1_W!.stand.z],
        ['CLIMB1_W -> RS_S', 0, 2858, 3626, T.RS_S!.stand.x, T.RS_S!.stand.z],
    ];
    for (const [label, level, sx, sz, dx, dz] of LEGS) test(label, () => { expect(routes(level, sx, sz, dx, dz)).toBe(true); });

    test('the rocks and doors are REAL barriers (each leg needs its transition)', () => {
        expect(routes(0, 2880, 3593, 2880, 3596)).toBe(false);     // Death Plateau rocks
        expect(routes(0, 2856, 3611, 2856, 3613)).toBe(false);     // rockslide
        expect(routes(0, 2858, 3626, 2861, 3626)).toBe(false);     // first climb
        expect(routes(0, 2877, 3622, 2880, 3622)).toBe(false);     // second climb
        expect(routes(0, 2916, 3630, 2908, 3654)).toBe(false);     // only the troll pass leads north
        expect(routes(1, 2841, 10108, 2852, 10109)).toBe(false);   // the prison door is shut
        expect(routes(0, 2827, 3646, 2896, 3530)).toBe(false);     // the back exit's ledge needs the 3748 rocks
    });
});

describe('classifyRegion agrees with rsmod connectivity', () => {
    function sweep(level: number, x0: number, z0: number, x1: number, z1: number, anchors: Array<[TrollRegion, number, number]>): string[] {
        const bad: string[] = [];
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            if (!isTileWalkable(level, x, z)) continue;
            const hit = anchors.find(([, ax, az]) => routes(level, x, z, ax, az));
            if (!hit) continue;
            const got = classifyRegion(level, x, z);
            if (got !== hit[0]) bad.push(`(${x},${z},L${level}) ${got} != ${hit[0]}`);
        }
        return bad;
    }
    test('Death Plateau shelf (south) vs the corridor above the rocks (plateau)', () => {
        expect(sweep(0, 2830, 3585, 2885, 3611, [['plateau', 2880, 3596], ['south', 2880, 3593]])).toEqual([]);
    }, 120_000);
    test('the ledges between the rocks: band / mid / east / xpocket', () => {
        expect(sweep(0, 2821, 3612, 2896, 3647, [['band', 2856, 3613], ['mid', 2861, 3626], ['xpocket', 2827, 3646], ['east', 2880, 3622]])
            .filter(s => !/arena|north/.test(s))).toEqual([]);   // east connects through the (masked-open) arena doors
    }, 120_000);
    test('L1: west of the prison door vs the pocket east of it', () => {
        expect(sweep(1, 2836, 10096, 2860, 10111, [['L1e', 2852, 10109], ['L1w', 2841, 10108]])).toEqual([]);
    }, 120_000);
    test('L0: the prison vs the east wing', () => {
        expect(sweep(0, 2816, 10046, 2870, 10111, [['prison', 2852, 10105], ['L0east', 2852, 10064]])).toEqual([]);
    }, 120_000);
});

// NAVGRID SURFACE COVERAGE — the mainland's named sites (rune altars, Lumbridge swamp, Falador
// stone circle, Al Kharid, Edgeville + monastery, Draynor, the wilderness dungeon entrance) route
// correctly through sdk/navgrid's single-stratum planRoute. Companion to levels.test.ts
// (multi-level / cross-stratum) and portals-data.test.ts (portal graph integrity).
//
// BACKGROUND ( coverage audit): learnings/nature-rc-standup.md theorised a "navgrid
// coverage boundary around z3200" that made the nature altar (and, by extension, anything else
// south of it) unreachable. MEASURED against the current collision-data.json + navgrid.bin:
//   - navgrid.bin's surface window is x[1792,3584) z[2816,5632) — every site below is well inside it.
//   - collision-data.json's zones span far wider (x[1856,3640] z[1280,10360] incl. the z+6400
//     underground) and are NOT a blanket fill (30,912 real zones/level, scattered, not a filled
//     rectangle) — see sdk/navgrid/build.ts's "phantom void" comment for the bug this replaced.
//   - EVERY required site (all 6 f2p/low-level altars, Lumbridge swamp, the Falador-area stone
//     circle, Al Kharid, Edgeville+monastery, Draynor, the wilderness dungeon entrance) ALREADY
//     routes correctly with the current data. No navgrid data file needed to change.
//   - The ONE genuine gap is the nature altar, and it is NOT a data hole: a full BFS flood-fill
//     (server/webclient/headless/sim, run offline) shows its ruins sit on a 26,603-tile landmass
//     (bounds x[2704,2959] z[2939,3247], which contains Brimhaven) that shares NO walkable edge
//     with the 380,328-tile mainland (Lumbridge) component. That matches the real geography: the
//     only connector is the Ardougne<->Brimhaven ship (general_use/gangplank.rs2 boarding a boat +
//     area_ardougne_east/captain_barnaby.rs2's dialogue + a 30gp fee, area_karamja/customs_officer.rs2
//     on the return leg) — an NPC-dialogue interaction, not an OPLOC portal, so it cannot be
//     represented in portals.json/levels.ts's Portal type (locId + op to OPLOC) without misrepresenting
//     the interaction. Wiring it is a bot-travel-behaviour task (walk to the dock, OPNPC the sailor,
//     navigate the dialogue, pay), not a navgrid data extension — tracked here as a documented,
//     regression-locked non-coverage case rather than silently assumed-fixable.
import { describe, test, expect } from 'bun:test';
import { planRoute, init, isWalkable, type Route } from '../../../../sdk/navgrid/index.ts';

init();

/** The naive-router invariant (learnings/navgrid-and-pathing.md): the server NEVER re-paths, so
 * every consecutive waypoint pair must be a legal 1-step (chebyshev-1) move, or a live bot wedges
 * silently mid-route. */
function assertNaiveRouterInvariant(route: Route): void {
    for (let i = 1; i < route.waypoints.length; i++) {
        const a = route.waypoints[i - 1]!, b = route.waypoints[i]!;
        const cheb = Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
        expect(cheb).toBe(1);
    }
}

/** The route "reaches" the target the same way planRoute's own goal test does: within `arrive`
 * tiles (chebyshev) of the destination — see index.ts's reachedGoal(). */
function assertReaches(route: Route, x: number, z: number, arrive: number): void {
    const last = route.waypoints.at(-1)!;
    expect(Math.max(Math.abs(last.x - x), Math.abs(last.z - z))).toBeLessThanOrEqual(arrive);
}

// Verified-standable hub origins (compare.ts / navgrid-and-pathing.md).
const LUMBRIDGE = [3222, 3218] as const;
const VARROCK = [3210, 3424] as const;
const FALADOR = [2965, 3379] as const;

describe('navgrid surface coverage — required mainland sites', () => {
    const SITES: Array<[string, readonly [number, number], number, number]> = [
        // name, origin, destX, destZ  (arrive tolerance is fixed at 4 below — the long-haul ladder's
        // final rung, learnings/navgrid-and-pathing.md "Arrival tolerance: ladder it [0,1,2,4]")
        ['air altar ruins (obj 2452)', FALADOR, 2984, 3291],
        ['mind altar ruins (obj 2453)', VARROCK, 2981, 3513],
        ['water altar ruins (obj 2454)', LUMBRIDGE, 3184, 3164],
        ['earth altar ruins (obj 2455)', VARROCK, 3305, 3473],
        ['fire altar ruins (obj 2456)', LUMBRIDGE, 3312, 3254],
        ['body altar ruins (obj 2457)', VARROCK, 3052, 3444],
        ['Lumbridge swamp', LUMBRIDGE, 3195, 3183],
        ["Falador-area stone circle (Druids' Circle henge, loc 407/408)", FALADOR, 2925, 3480],
        ['Al Kharid', LUMBRIDGE, 3297, 3150],
        ['Edgeville', VARROCK, 3098, 3488],
        ['Edgeville monastery', VARROCK, 3052, 3477],
        ['Draynor village', LUMBRIDGE, 3120, 3267],
        ['wilderness dungeon entrance', VARROCK, 3044, 3924],
    ];
    const ARRIVE = 4;

    for (const [name, [ox, oz], tx, tz] of SITES) {
        test(`${name} (${tx},${tz}) routes from (${ox},${oz})`, () => {
            const route = planRoute(ox, oz, tx, tz, { arrive: ARRIVE, maxExpansions: 600_000 });
            expect(route).not.toBeNull();
            assertNaiveRouterInvariant(route!);
            assertReaches(route!, tx, tz, ARRIVE);
        }, 30_000);
    }
});

describe('nature altar — documented non-coverage (sea crossing, not a navgrid data gap)', () => {
    const RUINS = { x: 2868, z: 3018 };

    test('the ruins tile itself is real, standable land (not void/phantom)', () => {
        expect(isWalkable(RUINS.x, RUINS.z, 0)).toBe(true);
    });

    test('the ruins are NOT reachable from the mainland by any walkable path', () => {
        // Cap comfortably above the measured mainland component (380,328 tiles) so a null result
        // means genuine exhaustion of the reachable area, not a budget cutoff.
        const route = planRoute(LUMBRIDGE[0], LUMBRIDGE[1], RUINS.x, RUINS.z, {
            arrive: 4, maxExpansions: 2_000_000,
        });
        expect(route).toBeNull();
    }, 30_000);
});

describe('regression — pre-existing long-haul routes are unaffected', () => {
    // Exact tile counts captured from sdk/navgrid/compare.ts against the CURRENT (unmodified)
    // collision-data.json + navgrid.bin. This suite changed no navgrid data file, so these must
    // stay byte-for-byte identical; a future data change that alters them here must be deliberate.
    const ROUTES: Array<[string, number, number, number, number, number]> = [
        ['Lumbridge -> Varrock', 3222, 3218, 3210, 3424, 228],
        ['Lumbridge -> Draynor bank', 3222, 3218, 3092, 3243, 171],
        ['Varrock -> Falador', 3210, 3424, 2965, 3379, 274],
        ['Lumbridge -> Ardougne mkt', 3222, 3218, 2655, 3283, 927],   // rev 289 collision (274: 923)
    ];

    for (const [name, sx, sz, dx, dz, expectedTiles] of ROUTES) {
        test(`${name}: ${expectedTiles} tiles, naive-router invariant holds`, () => {
            const route = planRoute(sx, sz, dx, dz);   // default options, same as compare.ts
            expect(route).not.toBeNull();
            expect(route!.tiles).toBe(expectedTiles);
            assertNaiveRouterInvariant(route!);
        }, 30_000);
    }
});

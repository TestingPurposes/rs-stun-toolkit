// MULTI-LEVEL PLANNER SUITE — the navgrid cross-stratum upgrade. Uses the REAL rsmod collision (all
// levels, underground) + the auto-extracted portal graph, so it's a ~10s WASM test (like world.test).
// Asserts the planner picks the RIGHT ladder to reach upper floors + the underground.
import { describe, test, expect } from 'bun:test';
import { planMultiLevel, allPortals } from '../../../../sdk/navgrid/levels.ts';

describe('navgrid multi-level planner', () => {
    test('portal graph auto-loaded from the ladder/stairs scripts (>200 portals)', () => {
        expect(allPortals().length).toBeGreaterThan(200);
    });

    test('Lumbridge -> Sedridor (wizard-tower BASEMENT): climbs the ladder down', () => {
        const plan = planMultiLevel({ level: 0, x: 3222, z: 3218 }, { level: 0, x: 3103, z: 9571 });
        expect(plan).not.toBeNull();
        // exactly one ladder hop, landing in the basement (z > 9000)
        const climbs = plan!.filter(l => l.portal);
        expect(climbs).toHaveLength(1);
        expect(climbs[0]!.portal!.dest.z).toBeGreaterThan(9000);
        expect(plan![plan!.length - 1]!.waypoints.at(-1)).toMatchObject({ x: 3103, z: 9571 });   // arrives at Sedridor
    }, 30_000);

    test('Lumbridge -> Duke (castle LEVEL 1): climbs the staircase up', () => {
        const plan = planMultiLevel({ level: 0, x: 3222, z: 3218 }, { level: 1, x: 3212, z: 3220 });
        expect(plan).not.toBeNull();
        const climbs = plan!.filter(l => l.portal);
        expect(climbs).toHaveLength(1);
        expect(climbs[0]!.portal!.dest.level).toBe(1);   // lands on level 1 where Duke is
    }, 30_000);

    test('Falador -> Dwarven mine coal (UNDERGROUND): climbs down to the mine', () => {
        const plan = planMultiLevel({ level: 0, x: 3038, z: 3341 }, { level: 0, x: 3041, z: 9769 });
        expect(plan).not.toBeNull();
        expect(plan!.some(l => l.portal && l.portal.dest.z > 9000)).toBe(true);
    }, 30_000);

    test('same-level route needs no ladder', () => {
        const plan = planMultiLevel({ level: 0, x: 3222, z: 3218 }, { level: 0, x: 3245, z: 3238 });
        expect(plan).not.toBeNull();
        expect(plan!.every(l => !l.portal)).toBe(true);
    }, 30_000);
});

// MULTI-LEVEL TRAVEL SUITE — the LeanBot.mlDrive follower, OFFLINE. This closes the sim's biggest
// travel blind spot: ladders/telejump were previously live-smoke-only (4 integration bugs were found
//  that this suite would have caught). The CoopWorld portal model (SimPortal +
// pendingPortal self-routing) mirrors the engine: OPLOC -> self-route adjacent -> p_telejump.
//
// What this PROVES offline: the follower mechanism (walk leg -> OPLOC/re-OPLOC -> telejump -> detect ->
// advance -> arrive), the climb bail-out (PARK, never wander), and peer-player visibility.
// What it CANNOT prove: real portal DATA accuracy (portals.json dests) — that stays a live probe
// (ml-follow-probe.ts), exactly like quest fixtures.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness } from './coop.ts';
import { LeanBot, type MlLeg } from '../leanbot.ts';
import { openField } from './world.ts';
import { linePath } from './harness.ts';

// travel-only bot: doCombat neutered so nothing moves after arrival (mode 'combat' routes brain() to
// doTravel while !arrived, which is the machinery under test)
class TravelBot extends LeanBot {
    constructor() { super(); this.mode = 'combat'; this.quiet = true; this.arrived = true; }
    protected override doCombat(): void { this.warm(); }
}

const mkPlanner = () => (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);

const START = { x: 3200, z: 3200 };
const LADDER = { x: 3212, z: 3200, locId: 999, op: 1 as const };
const BASEMENT = { level: 0, x: 3212, z: 9600 };    // the z+6400 underground convention
const GOAL = { x: 3205, z: 9600 };

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

describe('LeanBot.mlDrive — the multi-level follower, offline', () => {
    test('walks the leg, climbs the ladder (telejump z+6400), advances, arrives at the goal', async () => {
        const world = new CoopWorld(openField());
        world.addPortal({ ...LADDER, dest: BASEMENT });
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        // hand-built plan (the PLANNER is proven in levels.test.ts; here we prove the FOLLOWER)
        const plan: MlLeg[] = [
            { waypoints: [{ x: LADDER.x - 1, z: LADDER.z }], portal: { ...LADDER, level: 0, dest: BASEMENT } },
            { waypoints: [{ x: GOAL.x, z: GOAL.z }] },
        ];
        bot.multiLevelPlanFn = () => plan;
        h.add({ bot: bot as any, name: 'climber1', index: 10, x: START.x, z: START.z });
        await h.start();
        bot.startMultiTravel(BASEMENT.level, GOAL.x, GOAL.z);

        let ticks = 0;
        while (!bot.multiTravelDone && ticks < 200) { await h.tick(); ticks++; }
        const p = h.playerOf('climber1');
        expect(bot.multiTravelDone).toBe(true);                                   // full journey completed
        expect(Math.max(Math.abs(p.x - GOAL.x), Math.abs(p.z - GOAL.z))).toBeLessThanOrEqual(6);   // world agrees
        expect(p.z).toBeGreaterThan(9000);                                        // actually underground
        // the climb happened via the portal (not a phantom walk across 6400 tiles)
        const climbed = world.events.some(e => e.kind === 'portal-climbed');
        expect(climbed).toBe(true);
    }, 30_000);

    test('re-OPLOC pattern: a MOVE-cancelled first OPLOC still climbs (the portalHop lesson)', async () => {
        // the world model cancels pendingPortal on any MOVE (clearPendingAction). mlDrive holds MOVEs
        // while climbing and re-OPLOCs every 8 ticks — so even if the first OPLOC lands while the last
        // MOVE is still in flight, a later re-OPLOC completes the climb. Assert >1 oploc was needed OR
        // the climb completed — and that it NEVER wedges.
        const world = new CoopWorld(openField());
        world.addPortal({ ...LADDER, dest: BASEMENT });
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        bot.multiLevelPlanFn = () => [
            { waypoints: [{ x: LADDER.x - 1, z: LADDER.z }], portal: { ...LADDER, level: 0, dest: BASEMENT } },
            { waypoints: [{ x: GOAL.x, z: GOAL.z }] },
        ];
        h.add({ bot: bot as any, name: 'climber2', index: 11, x: LADDER.x - 6, z: LADDER.z });   // starts near: OPLOC fires while walking
        await h.start();
        bot.startMultiTravel(BASEMENT.level, GOAL.x, GOAL.z);
        let ticks = 0;
        while (!bot.multiTravelDone && ticks < 200) { await h.tick(); ticks++; }
        expect(bot.multiTravelDone).toBe(true);
        expect(h.playerOf('climber2').z).toBeGreaterThan(9000);
    }, 30_000);

    test('BAIL-OUT: an unclimbable ladder PARKS the bot (arrived, no wander) after ~50 ticks', async () => {
        const world = new CoopWorld(openField());
        // portal NOT registered -> the OPLOC does nothing server-side (the wizard-tower class of failure)
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        bot.multiLevelPlanFn = () => [
            { waypoints: [{ x: LADDER.x - 1, z: LADDER.z }], portal: { ...LADDER, level: 0, dest: BASEMENT } },
            { waypoints: [{ x: GOAL.x, z: GOAL.z }] },
        ];
        h.add({ bot: bot as any, name: 'stucky', index: 12, x: START.x, z: START.z });
        await h.start();
        bot.startMultiTravel(BASEMENT.level, GOAL.x, GOAL.z);
        let ticks = 0;
        while (!bot.arrived && ticks < 150) { await h.tick(); ticks++; }
        const p = h.playerOf('stucky');
        expect(bot.arrived).toBe(true);                                            // parked, not hung
        expect((bot as any).mlGoal).toBeNull();                                    // plan abandoned
        expect(Math.max(Math.abs(p.x - LADDER.x), Math.abs(p.z - LADDER.z))).toBeLessThanOrEqual(6);   // did NOT wander off chasing z=9600
        expect(p.z).toBeLessThan(9000);                                            // still on the surface
        // the re-OPLOC pattern was active while it waited (>=2 attempts hit the world)
        const oplocs = world.events.filter(e => e.kind === 'oploc').length;
        expect(oplocs).toBeGreaterThanOrEqual(2);
    }, 30_000);
});

describe('staircase climb (UPSTAIRS: dest 1 tile away horizontally — the false-advance regression)', () => {
    test('the follower waits for the REAL plane change, never advances from the entrance tile', async () => {
        // A staircase's dest is ~1 tile from its entrance on x/z. Proximity-only landing detection
        // "advances" while still standing at the entrance on the wrong plane (live-caught on the Duke
        // run — the faithful extracted dest got blamed). The fix gates on minusedlevel === dest.level.
        const STAIRS = { x: 3210, z: 3200, locId: 998, op: 1 as const };
        const UP = { level: 1, x: 3211, z: 3201 };
        const world = new CoopWorld(openField());
        world.addPortal({ ...STAIRS, dest: UP });
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        bot.multiLevelPlanFn = () => [
            { waypoints: [{ x: STAIRS.x - 1, z: STAIRS.z }], portal: { ...STAIRS, level: 0, dest: UP } },
            { waypoints: [{ x: 3215, z: 3205 }] },
        ];
        h.add({ bot: bot as any, name: 'stairbot', index: 13, x: 3204, z: 3200 });
        await h.start();
        bot.startMultiTravel(UP.level, 3215, 3205);
        let ticks = 0;
        while (!bot.multiTravelDone && ticks < 200) { await h.tick(); ticks++; }
        const p = h.playerOf('stairbot');
        expect(bot.multiTravelDone).toBe(true);
        expect(p.level).toBe(1);                                   // the WORLD says it climbed (not just the follower's bookkeeping)
        expect((bot as any).minusedlevel).toBe(1);                 // and the CLIENT decoded the real plane
        expect(Math.max(Math.abs(p.x - 3215), Math.abs(p.z - 3205))).toBeLessThanOrEqual(6);
    }, 30_000);
});

describe('peer players ARE rendered in the coop sim (the peer.probe claim is about the old SimHarness)', () => {
    test('two bots see each other: playerCount > 0 and findPlayerIndexByName resolves', async () => {
        const world = new CoopWorld(openField());
        h = new CoopHarness(world);
        const a = new TravelBot(); a.findLongPathFn = mkPlanner();
        const b = new TravelBot(); b.findLongPathFn = mkPlanner();
        h.add({ bot: a as any, name: 'peera', index: 20, x: 3200, z: 3200 });
        h.add({ bot: b as any, name: 'peerb', index: 21, x: 3202, z: 3200 });
        await h.start();
        for (let i = 0; i < 6; i++) await h.tick();
        expect((a as any).playerCount).toBeGreaterThan(0);
        expect((a as any).findPlayerIndexByName('peerb')).toBe(21);
        expect((b as any).findPlayerIndexByName('peera')).toBe(20);
    }, 30_000);
});

// =====================================================================================================
// THE 2x3-STAIRCASE REPOSITION GATE — movement, not `reachedLoc`
// =====================================================================================================
// The reposition recovery (walk ONTO the op-tile, then OPLOC) used to be gated on `!atValidTile`, i.e. on
// `reachedLoc` saying our tile was NOT interaction-valid. For a MULTI-TILE loc that test is a LIE: measured
// against the real collision data, a 2x3 loc at (3210,3200) reports interaction-valid from tiles up to
// THREE tiles away — (3210,3203), (3212,3202), ... — while the live op only fires from the true operable
// face. So a bot parked on one of those tiles believed it was in position, never repositioned, and burned
// its 50-tick climb budget re-OPLOCing from a tile the server would not accept: the leg PARKED. Every
// dungeon camp in P2 sits behind a loc of that shape.
//
// The world model here mirrors that exactly: `size: 0` makes the telejump fire ONLY from the loc tile, and
// one blocked edge wedges the engine's naive self-route (as a wall corner does live) so the ONLY way in is
// the pathfinder-routed reposition.
describe('reposition recovery is gated on MOVEMENT, not on reachedLoc (the 2x3 staircase)', () => {
    const STAIR = { x: 3210, z: 3200, locId: 997, op: 1 as const };
    const DOWN = { level: 0, x: 3210, z: 9600 };
    const START_TILE = { x: 3210, z: 3203 };          // reachedLoc says VALID here (d=3) — measured, see above
    const DETOUR = [
        { x: 3210, z: 3203 }, { x: 3211, z: 3203 }, { x: 3211, z: 3202 },
        { x: 3211, z: 3201 }, { x: 3210, z: 3200 },
    ];

    test('it repositions onto the op-tile and completes the climb instead of parking', async () => {
        // one blocked edge: straight north out of the start tile. The naive self-route (and any straight
        // MOVE) wedges on it; the detour above is legal.
        const canTravel = (_l: number, x: number, z: number, dx: number, dz: number) => {
            if (x === START_TILE.x && z === START_TILE.z && dz === -1) return false;   // N + both diagonals
            if (x === START_TILE.x && z === START_TILE.z - 1 && dz === 1) return false; // and its reverse
            return true;
        };
        const world = new CoopWorld(canTravel);
        world.addPortal({ ...STAIR, dest: DOWN, size: 0 });        // fires ONLY from the loc tile
        h = new CoopHarness(world);
        const bot = new TravelBot();
        // planner: the detour when asked for the op-tile, straight lines otherwise
        bot.findLongPathFn = (_l, sx, sz, dx, dz) =>
            (dx === STAIR.x && dz === STAIR.z && sx === START_TILE.x && sz === START_TILE.z)
                ? DETOUR.map(t => ({ ...t }))
                : linePath(sx, sz, dx, dz);
        bot.multiLevelPlanFn = () => [
            {
                waypoints: [{ x: START_TILE.x, z: START_TILE.z }],
                // dims/shape/angle are what make reachedLoc report VALID from 3 tiles away
                portal: { ...STAIR, level: 0, dest: DOWN, dims: { w: 2, l: 3 }, angle: 0, shape: 10 },
            },
            { waypoints: [{ x: DOWN.x, z: DOWN.z }] },
        ];
        h.add({ bot: bot as any, name: 'stair2x3', index: 14, x: START_TILE.x, z: START_TILE.z });
        await h.start();
        bot.startMultiTravel(DOWN.level, DOWN.x, DOWN.z);

        let ticks = 0;
        while (!bot.multiTravelDone && ticks < 240) { await h.tick(); ticks++; }
        const p = h.playerOf('stair2x3');
        expect(world.events.some(e => e.kind === 'portal-climbed')).toBe(true);   // it actually climbed
        expect(p.z).toBeGreaterThan(9000);
        expect(bot.multiTravelDone).toBe(true);
        // it did NOT sit on the "valid" tile until the bail-out parked it
        expect(p.x === START_TILE.x && p.z === START_TILE.z).toBe(false);
    }, 60_000);

    test('a wedged reposition stops calling the walker and hands the ticks back (no starvation)', async () => {
        // Same footprint, but now there is NO way onto the op-tile at all: the walker can never move us, so
        // the movement gate must give up after a few attempts and let the re-OPLOC pattern keep firing —
        // the property the old `!atValidTile` guard existed to protect. The leg then parks CLEANLY.
        const canTravel = (_l: number, _x: number, _z: number, _dx: number, _dz: number) => false;
        const world = new CoopWorld(canTravel);
        world.addPortal({ ...STAIR, dest: DOWN, size: 0 });
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        bot.multiLevelPlanFn = () => [
            {
                waypoints: [{ x: START_TILE.x, z: START_TILE.z }],
                portal: { ...STAIR, level: 0, dest: DOWN, dims: { w: 2, l: 3 }, angle: 0, shape: 10 },
            },
            { waypoints: [{ x: DOWN.x, z: DOWN.z }] },
        ];
        h.add({ bot: bot as any, name: 'stairwedge', index: 15, x: START_TILE.x, z: START_TILE.z });
        await h.start();
        bot.startMultiTravel(DOWN.level, DOWN.x, DOWN.z);
        let ticks = 0;
        while (!bot.arrived && ticks < 240) { await h.tick(); ticks++; }
        expect(bot.arrived).toBe(true);                       // parked, not hung
        expect((bot as any).mlGoal).toBeNull();
        expect(h.playerOf('stairwedge').z).toBeLessThan(9000);
        // the re-OPLOC pattern kept running while the walker was wedged (it was NOT starved). A registered
        // portal answers an OPLOC with 'portal-pending' (the engine's held op), so that is the event to count.
        const reOplocs = world.events.filter(e => e.kind === 'portal-pending' || e.kind === 'oploc').length;
        expect(reOplocs).toBeGreaterThanOrEqual(3);
    }, 60_000);
});


describe('a CLOSED Ice Mountain trapdoor is opened by the climb alternation', () => {
    // The map PLACES this trapdoor open (1570 trapdoor_open), so the MANUAL portal climbs 1570 — but any player can
    // Close it (trapdoors.rs2: loc_change(trapdoor=1568, 500)), after which OPLOC 1570 is silently ignored
    // (World.getLoc misses). The relay re-OPLOC'd 1570 from (3020,3451) and parked every 50 ticks for 4+ hours with
    // zero movement. levels.ts now carries altLocId 1568, so odd attempts op1 "Open" the closed variant.
    const DOWN = { level: 0, x: 3019, z: 9850 };
    const START_TILE = { x: 3020, z: 3451 };
    const run = async (altLocId: number | undefined) => {
        const world = new CoopWorld(openField());
        // sim two-stage model: closed accepts only locId (1568, opens), open accepts only altLocId (1570, climbs)
        world.addPortal({ x: 3019, z: 3450, locId: 1568, altLocId: 1570, op: 1, dest: DOWN, open: false });
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        bot.multiLevelPlanFn = () => [
            { waypoints: [{ x: START_TILE.x, z: START_TILE.z }], portal: { x: 3019, z: 3450, locId: 1570, altLocId, op: 1, level: 0, dest: DOWN, dims: { w: 1, l: 1 }, angle: 2, shape: 22 } },
            { waypoints: [{ x: DOWN.x, z: DOWN.z }] },
        ];
        h.add({ bot: bot as any, name: 'tdclosed', index: 16, x: START_TILE.x, z: START_TILE.z });
        await h.start();
        bot.startMultiTravel(DOWN.level, DOWN.x, DOWN.z);
        let ticks = 0;
        while (!bot.multiTravelDone && !(bot.arrived && (bot as any).mlGoal === null) && ticks < 240) { await h.tick(); ticks++; }
        return { world, climbed: world.events.some(e => e.kind === 'portal-climbed'), z: h.playerOf('tdclosed').z };
    };
    test('with altLocId 1568 it opens the trapdoor, then climbs', async () => {
        const r = await run(1568);
        expect(r.world.events.some(e => e.kind === 'portal-opened')).toBe(true);
        expect(r.climbed).toBe(true);
        expect(r.z).toBeGreaterThan(9000);
    }, 60_000);
    test('without it (the old entry) every OPLOC is ignored and the leg parks — the live symptom', async () => {
        const r = await run(undefined);
        expect(r.climbed).toBe(false);
        expect(r.world.events.some(e => e.kind === 'oploc-id-mismatch')).toBe(true);
    }, 60_000);
    test('the real MANUAL portal carries the closed variant', async () => {
        const { allPortals } = await import('../../../../sdk/navgrid/levels.ts') as any;
        const p = allPortals().find((q: any) => q.x === 3019 && q.z === 3450 && q.level === 0);
        expect(p?.altLocId).toBe(1568);
    });
});

describe('mlDrive plans from the plane the bot is ON, not a stale travelLevel', () => {
    //  7 rmquest bots stood on castle L1 beside the Duke; travelLevel was still 0 from an earlier
    // leg, so the planner routed "L0 -> south staircase -> L1" and they walked an L0 path on L1 for 3 hours.
    test('a bot logged in on level 1 passes level 1 as the plan source', async () => {
        const world = new CoopWorld(openField());
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        const seen: number[] = [];
        bot.multiLevelPlanFn = (src: { level: number }) => { seen.push(src.level); return [{ waypoints: [{ x: 3205, z: 3200 }] }]; };
        h.add({ bot: bot as any, name: 'upstairs1', index: 11, x: 3200, z: 3200, level: 1 });
        await h.start();
        for (let i = 0; i < 3; i++) await h.tick();
        expect(bot.travelLevel).toBe(0);            // the stale value the bug planned from
        bot.startMultiTravel(1, 3205, 3200);
        for (let i = 0; i < 5 && !seen.length; i++) await h.tick();
        expect(seen[0]).toBe(1);
    }, 30_000);
});

describe('the dLadder<=1 climb backstop is 1x1-only', () => {
    test('adjacent to a 2x2 staircase on a side reachedLoc rejects -> keeps walking the leg, does not OPLOC from there', async () => {
        const world = new CoopWorld(openField());
        const DEST = { level: 1, x: 3205, z: 3209 };
        world.addPortal({ x: 3204, z: 3207, locId: 1738, op: 1, dest: DEST, size: 2 });
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = mkPlanner();
        bot.multiLevelPlanFn = () => [
            { waypoints: [{ x: 3206, z: 3209 }], portal: { x: 3204, z: 3207, locId: 1738, op: 1, level: 0, dest: DEST, dims: { w: 2, l: 2 }, angle: 3, shape: 10 } },
            { waypoints: [{ x: 3205, z: 3209 }] },
        ];
        h.add({ bot: bot as any, name: 'stair2x2', index: 17, x: 3204, z: 3206 });
        await h.start();
        bot.startMultiTravel(1, 3205, 3209);
        await h.tick(); await h.tick(); await h.tick();
        // real collision: (3204,3206) is NOT interaction-valid for 1738 — the old backstop OPLOC'd from here at once
        expect(world.events.some(e => e.kind === 'portal-pending' || e.kind === 'oploc')).toBe(false);
    }, 30_000);
});

// cd server/webclient/headless/sim && bun test castle-door-wedge.test.ts      (~20 s pathfinder init)
//
// THE LUMBRIDGE CASTLE (3215,3211) WEDGE, reproduced offline on the REAL collision + the REAL planner.
//
// Geometry (castle-door-geo.test.ts pins it): the castle stair landing (3205,3209) sits in a 29-tile
// south corridor whose ONLY exits are two wall doors on the NORTH edge of their tiles — loc 1536 @
// (3215,3211) and loc 1530 @ (3208,3211), both shape 0 angle 1. The planner treats both as passable and
// routes (3215,3211)->(3104,3161) straight north through the 1536 edge. The bot stands ON the door tile.
//
// Live (..05, logs/paths/rm-acct15.log): the bot passed that door earlier (so its tracker
// saw the LOC_DEL = OPEN), sat >500 ticks on L1 with the Duke while the door reverted (loc_del(500)),
// climbed down — every L0 zone arrives as UPDATE_ZONE_FULL_FOLLOWS, which RESETS the zone to the map and
// re-sends only differences, so the reverted (closed) door was never re-announced — and the tracker kept
// saying OPEN. tryOpenDoor skips tracker-open doors, the proactive opener only acts on tracker-closed
// ones, so NOTHING ever operated the door: "rung 1 re-plan / rung 4 sidestep" forever (rung 2 silent).
//
// The sim models a wall door as an EDGE (the door tile is walkable; only the crossing is blocked), the
// world opens it on a matching OPLOC and emits the real zone LOC_DEL, so the bot's tracker learns it
// through the live decode path.
import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { ServerProt } from '#/io/ServerProt.js';
import { CoopWorld, CoopHarness, type SimDoorLoc } from './coop.js';
import { SimWorld, rsmodCanTravel } from './world.js';
import { ServerPacketStream } from './protocol.js';
import { LeanBot } from '../leanbot.js';
import { initPathfinding, findLongPath } from '../../../../sdk/pathfinding';
import { DoorTracker } from '../../../../sdk/navgrid/door-tracker.js';

const D1536 = { x: 3215, z: 3211, locId: 1536, op: 1, shape: 0, angle: 1 };   // the wedge door
const D1530 = { x: 3208, z: 3211, locId: 1530, op: 1, shape: 0, angle: 1 };   // the pocket's other exit
const DEST = { x: 3104, z: 3161 };                                              // Wizards' Tower approach (RM leg 0 end)

interface EdgeDoor { x: number; z: number; shape: number; angle: number; sim: SimDoorLoc | null }

/** The WORLD's physics for a straight wall door (angle 0=W 1=N 2=E 3=S edge of its tile) — written here,
 *  independently of the bot's own edge test, so the sim cannot agree with a bot bug by construction. */
function blocksStep(e: EdgeDoor, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const o = [[-1, 0], [0, 1], [1, 0], [0, -1]][e.angle]!;
    const beyond = { x: e.x + o[0]!, z: e.z + o[1]! };
    const is = (p: { x: number; z: number }, q: { x: number; z: number }) => p.x === q.x && p.z === q.z;
    return (is(a, e) && is(b, beyond)) || (is(b, e) && is(a, beyond));
}

/** Real rsmod collision + closed wall-door EDGES. `sim: null` = a door that never opens (OPLOC discarded). */
class EdgeDoorWorld extends CoopWorld {
    edges: EdgeDoor[] = [];
    addEdgeDoor(d: typeof D1536, openable: boolean): EdgeDoor {
        const sim = openable ? this.addSimDoor({ x: d.x, z: d.z, locId: d.locId, op: d.op }) : null;
        const e = { x: d.x, z: d.z, shape: d.shape, angle: d.angle, sim };
        this.edges.push(e);
        return e;
    }
    override canStep(level: number, x: number, z: number, dx: number, dz: number): boolean {
        const a = { x, z }, b = { x: x + dx, z: z + dz };
        for (const e of this.edges) {
            if (e.sim?.open) continue;
            if (blocksStep(e, a, b)) return false;
            if (dx !== 0 && dz !== 0) {   // a diagonal needs both of its L-shaped cardinal pairs clear (rsmod)
                const h = { x: x + dx, z }, v = { x, z: z + dz };
                if (blocksStep(e, a, h) || blocksStep(e, h, b) || blocksStep(e, a, v) || blocksStep(e, v, b)) return false;
            }
        }
        // skip CoopWorld's TILE door model (it blocks ENTRY to the door tile — wrong for a wall-edge door)
        return SimWorld.prototype.canStep.call(this, level, x, z, dx, dz);
    }
}

class TravelBot extends LeanBot {
    constructor() { super(); this.mode = 'combat'; this.quiet = true; this.enableDoorTracker(); }
    protected override doCombat(): void { this.warm(); }
    go(x: number, z: number) { this.travelDest = { x, z }; this.travelPath = null; this.arrived = false; }
}

beforeAll(() => { initPathfinding(); }, 120_000);
let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

const realPlanner = (l: number, sx: number, sz: number, dx: number, dz: number) =>
    findLongPath(l, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z }));

/** Out of the south corridor = north of the doors' z row (both exits lead north). */
const escaped = (p: { x: number; z: number }) => p.z >= 3212;

async function setup(opts: { d1536Openable: boolean; staleOpen: boolean }) {
    const world = new EdgeDoorWorld(rsmodCanTravel());
    world.addEdgeDoor(D1536, opts.d1536Openable);
    world.addEdgeDoor(D1530, true);
    h = new CoopHarness(world);
    const bot = new TravelBot();
    bot.findLongPathFn = realPlanner;
    // park the base brain's default trip on our own tile, so nothing travels (or pokes a door) before go()
    bot.travelDest = { x: D1536.x, z: D1536.z };
    // the live shape: the tracker saw this door OPEN earlier (LOC_DEL) and never saw it revert
    if (opts.staleOpen) bot.doorTracker!.onLocDel(0, D1536.x, D1536.z);
    h.add({ bot: bot as never, name: 'rmq', index: 60, x: D1536.x, z: D1536.z });
    await h.start();
    return { world, bot, h };
}

async function runUntilEscaped(hh: CoopHarness, maxTicks: number): Promise<number> {
    let t = 0;
    while (t < maxTicks && !escaped(hh.playerOf('rmq'))) { await hh.tick(); t++; }
    return t;
}

describe('DoorTracker zone reset (UPDATE_ZONE_FULL_FOLLOWS)', () => {
    test('a FULL zone update restores seeded doors to the map state and drops live-only leaves', () => {
        const t = new DoorTracker();
        t.seed(0, 3215, 3211, 1536);
        expect(t.isOpen(0, 3215, 3211)).toBe(false);
        t.onLocDel(0, 3215, 3211);              // someone opened it
        t.onLocAddChange(0, 3215, 3212, 1537);  // the open leaf at the swing tile
        expect(t.isOpen(0, 3215, 3211)).toBe(true);
        t.resetZone(1, 3208, 3208);             // another PLANE's zone: untouched
        expect(t.isOpen(0, 3215, 3211)).toBe(true);
        t.resetZone(0, 3208, 3208);             // the zone (3208..3215, 3208..3215) on L0
        expect(t.isOpen(0, 3215, 3211)).toBe(false);
        expect(t.closedDoorAt(0, 3215, 3211)).toEqual({ locId: 1536, op: 1 });
        expect(t.isOpen(0, 3215, 3212)).toBeUndefined();
    });
});

describe('Lumbridge castle (3215,3211) wedge — real collision, real planner', () => {
    test('stale-OPEN tracker + the FULL zone update on re-entry: tracker resets, bot opens the door and leaves', async () => {
        const { world, bot, h: hh } = await setup({ d1536Openable: true, staleOpen: true });
        expect(bot.doorTracker!.isOpen(0, D1536.x, D1536.z)).toBe(true);
        // the server's FULL_FOLLOWS for the door's zone, exactly as a level change / zone re-entry sends it
        const e = (hh as any).entries[0];
        const { zx, zz } = ServerPacketStream.zoneDoorOp(D1536.x, D1536.z, bot.mapBuildBaseX, bot.mapBuildBaseZ, 'del');
        e.stream.push(e.enc.frame(ServerProt.UPDATE_ZONE_FULL_FOLLOWS, Uint8Array.from([zx & 0xff, zz & 0xff])));
        await hh.tick();
        expect(bot.doorTracker!.isOpen(0, D1536.x, D1536.z)).toBe(false);
        bot.go(DEST.x, DEST.z);
        const t = await runUntilEscaped(hh, 200);
        expect(escaped(hh.playerOf('rmq'))).toBe(true);
        expect(world.events.some(ev => ev.kind === 'door-opened' && ev.detail.x === D1536.x && ev.detail.z === D1536.z)).toBe(true);
        expect(t).toBeLessThan(60);   // no wedge ladder needed: the ordinary stall opener handles a known-closed door
    }, 60_000);

    test('stale-OPEN tracker WITHOUT the reset (backstop): the wedge rung blind-opens the route door and the bot leaves', async () => {
        const { world, bot, h: hh } = await setup({ d1536Openable: true, staleOpen: true });
        bot.go(DEST.x, DEST.z);
        const t = await runUntilEscaped(hh, 400);
        expect(escaped(hh.playerOf('rmq'))).toBe(true);
        expect(world.events.some(ev => ev.kind === 'door-opened' && ev.detail.x === D1536.x && ev.detail.z === D1536.z)).toBe(true);
        expect(t).toBeLessThan(150);
    }, 60_000);

    test('a door that NEVER opens (OPLOC discarded): after the bounded tries its edge is masked and the bot routes out via the other door', async () => {
        const { world, bot, h: hh } = await setup({ d1536Openable: false, staleOpen: false });
        bot.go(DEST.x, DEST.z);
        const t = await runUntilEscaped(hh, 600);
        const p = hh.playerOf('rmq');
        expect(escaped(p)).toBe(true);
        expect(world.events.some(ev => ev.kind === 'door-opened' && ev.detail.x === D1530.x && ev.detail.z === D1530.z)).toBe(true);
        expect(p.x).toBeLessThan(D1536.x);   // left by the WEST exit, not through the jammed edge
        expect(t).toBeLessThan(500);
    }, 90_000);

    test('a correctly-tracked closed door is opened by the ordinary opener — the wedge rung never fires', async () => {
        const { world, h: hh, bot } = await setup({ d1536Openable: true, staleOpen: false });
        const errs: string[] = [];
        const orig = console.error;
        console.error = (...a: unknown[]) => { errs.push(a.map(String).join(' ')); };
        try {
            bot.go(DEST.x, DEST.z);
            const t = await runUntilEscaped(hh, 200);
            expect(escaped(hh.playerOf('rmq'))).toBe(true);
            expect(t).toBeLessThan(60);
        } finally { console.error = orig; }
        expect(errs.filter(s => s.includes('TRAVEL WEDGED'))).toEqual([]);
        expect(world.events.filter(ev => ev.kind === 'door-opened').length).toBe(1);
    }, 60_000);
});

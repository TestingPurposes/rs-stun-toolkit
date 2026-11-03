// DOOR-CROSSING SUITE (fully offline) — the follow-up the door-tracker work named. A bot travels
// through a CLOSED door; the world blocks the tile, the bot's door-aware follower OPLOCs it, the world
// opens it and EMITS THE REAL ZONE PACKET (LOC_DEL), the bot's DoorTracker decodes it and flips the
// door open, and the bot crosses. This exercises the ENTIRE live path offline:
//   world opens door -> UPDATE_ZONE_PARTIAL_ENCLOSED/LOC_DEL -> LeanBot zone decode -> tracker -> cross.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness } from './coop.ts';
import { LeanBot } from '../leanbot.ts';
import { openField } from './world.ts';
import { linePath } from './harness.ts';

// a real door from the table (so enableDoorTracker seeds it + tryOpenDoor will OPLOC it): Lumbridge
// castle door loc 1530 @ (3226,3223). openField collision => only the sim door blocks the tile.
const DOOR = { x: 3226, z: 3223, locId: 1530, op: 1 as const };

class TravelBot extends LeanBot {
    constructor() { super(); this.mode = 'combat'; this.quiet = true; this.enableDoorTracker(); }
    protected override doCombat(): void { this.warm(); }
    go(x: number, z: number) { this.travelDest = { x, z }; this.travelPath = null; this.arrived = false; }
}

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

describe('door crossing — full offline path (world -> zone packet -> tracker -> cross)', () => {
    test('a closed door blocks, the bot opens it (tracker flips from the zone packet), then crosses', async () => {
        const world = new CoopWorld(openField());
        world.addSimDoor({ x: DOOR.x, z: DOOR.z, locId: DOOR.locId, op: DOOR.op });   // starts CLOSED
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        // sanity: the tracker seeded the real door as closed
        expect(bot.doorTracker!.isOpen(0, DOOR.x, DOOR.z)).toBe(false);
        h.add({ bot: bot as never, name: 'crosser', index: 40, x: DOOR.x - 6, z: DOOR.z });
        await h.start();
        bot.go(DOOR.x + 12, DOOR.z);   // FAR past the door — arriving (dist<=6) REQUIRES crossing it

        let ticks = 0;
        while (!bot.arrived && ticks < 200) { await h.tick(); ticks++; }
        const p = h.playerOf('crosser');
        expect(bot.arrived).toBe(true);                                   // made it to the far side
        expect(p.x).toBeGreaterThan(DOOR.x);                             // physically past the door tile
        expect(bot.doorTracker!.isOpen(0, DOOR.x, DOOR.z)).toBe(true);    // tracker flipped from the LOC_DEL packet
        expect(world.simDoors[0]!.open).toBe(true);                       // the world actually opened it
        expect(world.events.some(e => e.kind === 'door-opened')).toBe(true);
    }, 30_000);

    test('the follower never OPLOCs a door the tracker already knows is open (no closing it)', async () => {
        const world = new CoopWorld(openField());
        const door = world.addSimDoor({ x: DOOR.x, z: DOOR.z, locId: DOOR.locId, op: DOOR.op });
        door.open = true;   // already open — canStep lets the bot through; the tracker should learn it and not touch it
        h = new CoopHarness(world);
        const bot = new TravelBot();
        bot.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        // pretend the bot already observed it open (as it would on scene load / a prior pass)
        bot.doorTracker!.onLocDel(0, DOOR.x, DOOR.z);
        expect(bot.doorTracker!.isOpen(0, DOOR.x, DOOR.z)).toBe(true);
        h.add({ bot: bot as never, name: 'passer', index: 41, x: DOOR.x - 5, z: DOOR.z });
        await h.start();
        bot.go(DOOR.x + 5, DOOR.z);

        let ticks = 0;
        const oplocsBefore = () => world.events.filter(e => e.kind === 'door-pending').length;
        while (!bot.arrived && ticks < 200) { await h.tick(); ticks++; }
        expect(bot.arrived).toBe(true);
        expect(world.simDoors[0]!.open).toBe(true);        // still open — never closed
        expect(oplocsBefore()).toBe(0);                    // the bot never even tried to operate it
    }, 30_000);
});

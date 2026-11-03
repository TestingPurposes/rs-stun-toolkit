// brain-sim-door.ts: two real bot brains in the offline brain simulator. No engine, no network.
//
// A walker bot starts 6 tiles west of the closed Lumbridge castle door (loc 1530 at 3226,3223) and is told to go
// 12 tiles past it. To get there it has to open the door: it sends the loc op, the simulated world opens the door
// and sends the real zone packet, the bot's door tracker reads that packet, and the bot walks through. A second
// bot stands nearby and checks that it can see the walker by name, the way two live players see each other.
//
//   cd rs-sdk/server/webclient
//   bun ../../../rs-sdk-stun-toolkit/examples/brain-sim-door.ts
//
// Exit code 0 = the walker crossed the door and the watcher saw it. See docs/BRAIN-SIM.md.
import { join } from 'path';

const H = join(process.cwd(), 'headless');
const { LeanBot } = await import(join(H, 'leanbot.ts'));
const { CoopWorld, CoopHarness } = await import(join(H, 'sim/coop.ts'));
const { openField } = await import(join(H, 'sim/world.ts'));
const { linePath } = await import(join(H, 'sim/harness.ts'));

const DOOR = { x: 3226, z: 3223, locId: 1530, op: 1 };

// A brain: LeanBot's own travel follower does the walking and the door opening; this subclass only sets a goal.
class Walker extends LeanBot {
    constructor() { super(); this.mode = 'combat'; this.quiet = true; this.exitOnStuck = false; this.enableDoorTracker(); }
    doCombat() { this.warm(); }                  // nothing to fight: just stay active
    go(x: number, z: number) { this.travelDest = { x, z }; this.travelPath = null; this.arrived = false; }
}
const watcher = new LeanBot();
watcher.quiet = true; watcher.exitOnStuck = false;

const world = new CoopWorld(openField());       // open field: only the simulated door blocks
world.addSimDoor({ x: DOOR.x, z: DOOR.z, locId: DOOR.locId, op: DOOR.op });   // starts closed
const h = new CoopHarness(world);
const walker = new Walker();
walker.findLongPathFn = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
h.add({ bot: walker, name: 'walker', index: 40, x: DOOR.x - 6, z: DOOR.z });
h.add({ bot: watcher, name: 'watcher', index: 41, x: DOOR.x - 4, z: DOOR.z + 3 });
await h.start();
walker.go(DOOR.x + 12, DOOR.z);

let tick = 0, openedAt = -1, seen = false;
while (!walker.arrived && tick < 200) {
    await h.tick(); tick++;
    if (openedAt < 0 && world.simDoors[0].open) openedAt = tick;
    if (watcher.findPlayerIndexByName('walker') >= 0) seen = true;
}
const p = h.playerOf('walker');
const ok = walker.arrived && p.x > DOOR.x && openedAt > 0 && walker.doorTracker.isOpen(0, DOOR.x, DOOR.z) && seen;
console.log(`[brain-sim-door] door opened at tick ${openedAt}, walker arrived=${walker.arrived} at (${p.x},${p.z}) on tick ${tick}`);
console.log(`[brain-sim-door] walker's door tracker says open: ${walker.doorTracker.isOpen(0, DOOR.x, DOOR.z)}; watcher saw "walker": ${seen}`);
console.log(`[brain-sim-door] ${ok ? 'PASS' : 'FAIL'}`);
await h.stop();
process.exit(ok ? 0 : 1);

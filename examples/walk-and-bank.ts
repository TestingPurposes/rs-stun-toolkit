// walk-and-bank.ts: a minimal custom bot for the lockstep sim.
//
// Logs in a fresh account, uses the local engine's setup cheats to empty its pack, give it 100 coins and put it in
// Lumbridge, walks to Draynor Village bank, deposits everything and checks that the bank now holds the coins.
// Run it from rs-sdk/server/webclient with SIM_LOCKSTEP=1 and LC_HOST=localhost:<engine web port>; the script
// sim-walk-and-bank.sh next to this file does that. Exit code 0 = the coins are in the bank.
//
// SpeedBot (headless/speedrun/core.ts) is LeanBot plus awaitable helpers: walkTo (navgrid route, doors), openBank,
// depositAll, withdraw, tick/until (wait for game ticks). localSetup only works against a local engine.
import { join } from 'path';

const { SpeedBot, localSetup } = await import(join(process.cwd(), 'headless/speedrun/core.ts'));

// account names starting "run" and ending "t" (12 characters at most) are the ones the engine's seed and chaos
// switches target by default
const name = `run${String(Date.now() % 100000).padStart(5, '0')}t`;
const bot = await SpeedBot.create(name);
await bot.tick(3);
await localSetup(bot, { clear: true, items: [{ name: 'coins', n: 100 }], tele: { x: 3222, z: 3218 } });
await bot.tick(2);

const t0 = bot.tickCount;
const walk = await bot.walkTo(3093, 3243, { near: 2 });   // Draynor Village bank
console.log(`[walk-and-bank] walk ok=${walk.ok} ticks=${walk.ticks} tiles=${walk.tiles} doors=${walk.doors} at (${walk.at.x},${walk.at.z})`);
const open = await bot.openBank();
const dep = open.ok ? await bot.depositAll() : { ok: false, ticks: 0 };
await bot.tick(2);
const banked = bot.bankCount('coins');
console.log(`[walk-and-bank] bank open=${open.ok} deposit=${dep.ok} coins in bank=${banked} pack=${bot.inv().length} stacks`);
const ok = walk.ok && open.ok && dep.ok && banked >= 100 && bot.inv().length === 0;
console.log(`[walk-and-bank] ${ok ? 'PASS' : 'FAIL'} in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(ok ? 0 : 1);

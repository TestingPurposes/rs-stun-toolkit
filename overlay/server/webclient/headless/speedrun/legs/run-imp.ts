// =====================================================================================================
// legs/run-imp.ts — standalone launcher for the Imp Catcher quest leg (q-imp.ts).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-imp.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements: Imp Catcher NOT started. No quests or levels needed. Pack: one each of red, yellow, black and
//       white bead. Start anywhere on the mainland that routes to the Wizards' Tower (the leg was built from Lumbridge).
//       The leg DROPS the tutorial-kit items (bronze tools/weapons, shortbow, arrows, mind/earth/body runes, net,
//       bucket, pot, bread, shrimp, tinderbox) while it walks: bank them first if you want them.
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-imp.ts --sim [name]
//       fresh account: drops the tutorial kit, gives the four beads, teleports to Lumbridge. Refuses a non-local host.
//       Use a new name per run: accounts persist.
//
//   --supply  prints the supply list and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { impLeg, impPrep } from './q-imp.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';

type Item = { name: string; n: number };
const SUPPLY: Item[] = [{ name: 'red_bead', n: 1 }, { name: 'yellow_bead', n: 1 }, { name: 'black_bead', n: 1 }, { name: 'white_bead', n: 1 }];
const LUMBRIDGE = { x: 3222, z: 3222 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`Imp Catcher: ${show(SUPPLY)}`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-imp --live';   // any cheat call now throws

const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `imp${Date.now() % 100000}`;
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName);
await bot.tick(3);
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
    await localSetup(bot, { items: SUPPLY.filter(i => bot.count(objId(i.name)) < i.n), tele: LUMBRIDGE });
    await bot.tick(2);
}
const missing = SUPPLY.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
if (missing.length) { console.error(`[imp] missing ${missing.join(', ')}`); await bot.logout(); process.exit(1); }

await impPrep(bot.tile());
const t0 = bot.tickCount;
let r: Record<string, number | boolean> = {};
try { r = await impLeg(bot, { verbose: true }); } catch (e) { console.error(`[imp] ${(e as Error).message}`); }
console.log(`[imp] ${JSON.stringify(r)}`);
console.log(`[imp] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (r.ok) console.log(`[imp] QUEST COMPLETE in ${bot.tickCount - t0} ticks (magic ${bot.stat('magic').level})`);
await bot.logout();
process.exit(r.ok ? 0 : 1);

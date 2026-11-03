// =====================================================================================================
// legs/run-druidic.ts — standalone launcher for the Druidic Ritual quest leg (q-druidic.ts).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-druidic.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements: Druidic Ritual NOT started (members world: Taverley). The leg always starts with Falador Teleport:
//       Magic 37 and air rune x3, water rune x1, law rune x1. Pack: raw beef, raw rat meat, raw bear meat, raw chicken
//       (1 each). Recommended Prayer 43: Protect from Melee is switched on in Taverley dungeon, where the cauldron door
//       wakes two suits of armour (they hit up to ~2; the sim runs with it on, a run without it is untested).
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-druidic.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Magic 37 and Prayer 43, gives the meats and teleport runes,
//       teleports to Lumbridge. Refuses a non-local host. Use a new name per run: accounts persist.
//
//   --supply  prints the supply list and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { druidicLeg, druidicPrep } from './q-druidic.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';

type Item = { name: string; n: number };
const SUPPLY: Item[] = [{ name: 'raw_beef', n: 1 }, { name: 'raw_rat_meat', n: 1 }, { name: 'raw_bear_meat', n: 1 }, { name: 'raw_chicken', n: 1 },
    { name: 'airrune', n: 3 }, { name: 'waterrune', n: 1 }, { name: 'lawrune', n: 1 }];
const LUMBRIDGE = { x: 3222, z: 3222 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`Druidic Ritual: ${show(SUPPLY)}`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-druidic --live';   // any cheat call now throws

const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `druid${Date.now() % 100000}`;
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName);
await bot.tick(3);
const need = (l: Item[]) => l.filter(i => bot.count(objId(i.name)) < i.n);
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
    await localSetup(bot, { stats: { magic: 37, prayer: 43 } });
    await localSetup(bot, { items: need(SUPPLY).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })), tele: LUMBRIDGE });
    await bot.tick(2);
}
const missing = need(SUPPLY).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
if (bot.stat('magic').level < 37) missing.push(`magic ${bot.stat('magic').level}/37 (Falador Teleport)`);
if (missing.length) { console.error(`[druidic] missing ${missing.join(', ')}`); await bot.logout(); process.exit(1); }

await druidicPrep();
const t0 = bot.tickCount;
let r: Record<string, number | boolean> = {};
try { r = await druidicLeg(bot, { verbose: true }); } catch (e) { console.error(`[druidic] ${(e as Error).message}`); }
console.log(`[druidic] ${JSON.stringify(r)}`);
console.log(`[druidic] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (r.ok) console.log(`[druidic] QUEST COMPLETE in ${bot.tickCount - t0} ticks (herblore ${bot.stat('herblore').level})`);
await bot.logout();
process.exit(r.ok ? 0 : 1);

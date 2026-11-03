// =====================================================================================================
// legs/run-doric.ts — standalone launcher for the Doric's Quest leg (q-doric.ts).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-doric.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements: Doric's Quest NOT started. Pack: clay x6, copper ore x4, iron ore x2.
//       Started more than 120 tiles from Doric (north of Falador), the leg casts Falador Teleport: then it also needs
//       Magic 37 (the spell's level) and air rune x3, water rune x1, law rune x1. Started closer, it just walks.
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-doric.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Magic 37, gives the ores, clay and teleport runes, teleports to
//       Lumbridge (so the run includes the Falador Teleport). Refuses a non-local host. Use a new name per run.
//
//   --supply  prints the supply list and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName, cheb } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { doricLeg, doricPrep, DORIC_SUPPLY } from './q-doric.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';

type Item = { name: string; n: number };
const TELE_RUNES: Item[] = [{ name: 'airrune', n: 3 }, { name: 'waterrune', n: 1 }, { name: 'lawrune', n: 1 }];
const DORIC_AT = { x: 2952, z: 3451 }, LUMBRIDGE = { x: 3222, z: 3222 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`Doric's Quest: ${show(DORIC_SUPPLY)}\n  + Falador Teleport (Magic 37) when starting > 120 tiles from Doric: ${show(TELE_RUNES)}`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-doric --live';   // any cheat call now throws

const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `doric${Date.now() % 100000}`;
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName);
await bot.tick(3);
const need = (l: Item[]) => l.filter(i => bot.count(objId(i.name)) < i.n);
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
    await localSetup(bot, { stats: { magic: 37 } });
    await localSetup(bot, { items: need([...DORIC_SUPPLY, ...TELE_RUNES]).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })), tele: LUMBRIDGE });
    await bot.tick(2);
}
const far = cheb(bot.tile(), DORIC_AT) > 120;
const missing = need([...DORIC_SUPPLY, ...(far ? TELE_RUNES : [])]).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
if (far && bot.stat('magic').level < 37) missing.push(`magic ${bot.stat('magic').level}/37 (Falador Teleport)`);
if (missing.length) { console.error(`[doric] missing ${missing.join(', ')}`); await bot.logout(); process.exit(1); }

await doricPrep();
const t0 = bot.tickCount;
let r: Record<string, number | boolean> = {};
try { r = await doricLeg(bot, { verbose: true }); } catch (e) { console.error(`[doric] ${(e as Error).message}`); }
console.log(`[doric] ${JSON.stringify(r)}`);
console.log(`[doric] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (r.ok) console.log(`[doric] QUEST COMPLETE in ${bot.tickCount - t0} ticks (mining ${bot.stat('mining').level})`);
await bot.logout();
process.exit(r.ok ? 0 : 1);

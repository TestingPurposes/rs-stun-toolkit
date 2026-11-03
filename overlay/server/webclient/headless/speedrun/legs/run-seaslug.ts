// =====================================================================================================
// legs/run-seaslug.ts — standalone launcher for the Sea Slug quest leg (q-seaslug.ts).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-seaslug.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements (see run-seaslug.share.md for the why):
//       - No quests. Firemaking 30 (CURRENT level: the "rub together" torch step refuses below it).
//       - Magic 45 (Camelot teleport to start; the leg always teleports).
//       - Pack: SS0 below + 3 free slots. The script checks it and stops with the missing list. Nothing fights.
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-seaslug.ts --sim [name]
//       fresh account: drops the tutorial kit, sets magic 45 + firemaking 30, hands over the supplies and teleports to
//       Varrock west bank. Refuses a non-local host. New name per run.
//   --supply  prints the supply list and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { seaslugLeg, seaslugPrep, SEASLUG_SUPPLY } from './q-seaslug.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';

type Item = { name: string; n: number };
/** swamp paste + unlit torch (quest items) + one Camelot teleport (SEASLUG_SUPPLY has the law rune; 5 air added here) */
const SS0: Item[] = [...SEASLUG_SUPPLY, { name: 'airrune', n: 5 }];
const START = { x: 3185, z: 3436 };   // sim: Varrock west bank (the leg teleports to Camelot)

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`SS0 (before the start): ${show(SS0)}`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-seaslug --live';   // any cheat call now throws

const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `ss${Date.now() % 100000}`);
await bot.tick(3);

const missing = (l: Item[]) => l.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
async function supply(tag: string, l: Item[]): Promise<void> {
    if (sim) { await localSetup(bot, { items: l.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })) }); await bot.tick(2); }
    const m = missing(l);
    if (m.length) { console.error(`[ss] ${tag}: missing ${m.join(', ')}`); await bot.logout(); process.exit(1); }
}

if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // a fresh account holds the tutorial kit
    await localSetup(bot, { stats: { magic: 45, firemaking: 30 }, tele: START });
}
await supply('before the start', SS0);
if (bot.stat('firemaking').cur < 30 || bot.stat('magic').cur < 45) {
    console.error(`[ss] needs firemaking 30 (now ${bot.stat('firemaking').cur}) and magic 45 (now ${bot.stat('magic').cur}), current levels`);
    await bot.logout(); process.exit(1);
}
if (bot.inv().length > 28 - 3) { console.error('[ss] needs 3 free pack slots (glass, damp sticks, pearls)'); await bot.logout(); process.exit(1); }
await seaslugPrep();
const t0 = bot.tickCount;
let r: Record<string, number | boolean>;
try { r = await seaslugLeg(bot, { verbose: true }); }
catch (e) { console.error(`[ss] leg threw: ${(e as Error).message}`); await bot.logout(); process.exit(1); }
console.log(`[ss] result: ${JSON.stringify(r).slice(0, 400)}`);
console.log(`[ss] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok) { await bot.logout(); process.exit(1); }
console.log(`[ss] QUEST COMPLETE in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(0);

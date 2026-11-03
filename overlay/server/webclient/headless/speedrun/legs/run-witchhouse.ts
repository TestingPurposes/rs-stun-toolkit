// =====================================================================================================
// legs/run-witchhouse.ts — standalone launcher for the Witch's House quest leg (q-witchhouse.ts).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-witchhouse.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements (see run-witchhouse.share.md for the why):
//       - No quests. Magic 37 for the Falador teleport (or WH_TELEPORT=0 and start in Taverley next to the boy, 2928,3456).
//       - The four shapeshifter forms (combat 19/30/42/53) are fought in the shed. The leg punches unarmed or with whatever
//         is wielded, eats sharks at half hp and keeps Protect from Melee up (prayer 43) with a prayer potion.
//       - Pack: WH0 below (+ Falador teleport runes). The script checks it and stops with the missing list.
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-witchhouse.ts --sim [name]
//       fresh account: drops the tutorial kit, sets a mid-level account (att/str 60, def/hp 40, prayer 43, magic 37),
//       hands over the supplies and teleports to Varrock west bank. Refuses a non-local host. New name per run.
//   --supply  prints the supply list and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { witchHouseLeg, WITCHHOUSE_SUPPLY } from './q-witchhouse.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';

type Item = { name: string; n: number };
const TELEPORT = process.env.WH_TELEPORT !== '0';
const FALADOR_RUNES: Item[] = [{ name: 'lawrune', n: 1 }, { name: 'airrune', n: 3 }, { name: 'waterrune', n: 1 }];
/** the quest items + 6 sharks for the shed fight (+ the teleport runes) */
const WH0: Item[] = [...WITCHHOUSE_SUPPLY, { name: 'shark', n: 6 }, ...(TELEPORT ? FALADOR_RUNES : [])];
const START = { x: 3185, z: 3436 };   // sim: Varrock west bank (the leg teleports to Falador)

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`WH0 (before the start): ${show(WH0)}`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-witchhouse --live';   // any cheat call now throws

const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `wh${Date.now() % 100000}`);
await bot.tick(3);

const missing = (l: Item[]) => l.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
async function supply(tag: string, l: Item[]): Promise<void> {
    if (sim) { await localSetup(bot, { items: l.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })) }); await bot.tick(2); }
    const m = missing(l);
    if (m.length) { console.error(`[wh] ${tag}: missing ${m.join(', ')}`); await bot.logout(); process.exit(1); }
}

if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // a fresh account holds the tutorial kit
    await localSetup(bot, { stats: { attack: 60, strength: 60, defence: 40, hitpoints: 40, prayer: 43, magic: 37 }, tele: START });
}
await supply('before the start', WH0);
const t0 = bot.tickCount;
let r: Record<string, number | boolean>;
try { r = await witchHouseLeg(bot, { verbose: true, teleport: TELEPORT }); }
catch (e) { console.error(`[wh] leg threw: ${(e as Error).message}`); await bot.logout(); process.exit(1); }
console.log(`[wh] result: ${JSON.stringify(r).slice(0, 400)}`);
console.log(`[wh] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok) { await bot.logout(); process.exit(1); }
console.log(`[wh] QUEST COMPLETE in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(0);

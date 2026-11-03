// =====================================================================================================
// legs/run-treegnome.ts — standalone launcher for the Tree Gnome Village quest leg (q-treegnome.ts).
// =====================================================================================================
// Modes (exactly one):
//
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-treegnome.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements: TREEGNOME_REQUIREMENTS in q-treegnome.ts (printed with --supply). Magic 45 is checked (the leg starts
//     with a Camelot teleport); combat levels are recommendations. Carry TG0 (below) and wield a melee weapon; the
//     launcher stops with the missing list before it moves.
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-treegnome.ts --sim [name]
//       fresh account: drops the tutorial kit, sets stats (att/str 83, hp 72, magic 80, prayer 99: the speedrun trainee at
//       this point), wields a rune scimitar and hands over TG0 with cheats. No prerequisite quests. Refuses any non-local
//       host. Use a new name per run: accounts persist.
//
//   --supply  prints the requirements and the supply list, then exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { treeGnomeLeg, TREEGNOME_SUPPLY, TREEGNOME_REQUIREMENTS as REQ } from './q-treegnome.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';
import { wield } from './run-lib.js';

type Item = { name: string; n: number };
/** the whole quest in one phase: quest logs + Camelot teleport runes + warlord food and prayer */
const TG0: Item[] = [...TREEGNOME_SUPPLY, { name: 'lawrune', n: 1 }, { name: 'airrune', n: 5 }, { name: 'shark', n: 10 }, { name: '4doseprayerrestore', n: 2 }];
const SIM_STATS = { attack: 83, strength: 83, hitpoints: 72, magic: 80, prayer: 99 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) {
    console.log(`quests: ${REQ.quests.join(', ') || 'none'}`);
    for (const s of REQ.skills) console.log(`${s.skill} ${s.level}${s.hard ? ' (required)' : ' (recommended)'}: ${s.why}`);
    console.log(`gear: ${REQ.gear}\nstart: ${REQ.start}\nTG0 (carry at the start): ${show(TG0)}`);
    process.exit(0);
}

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-treegnome --live';   // any cheat call now throws

const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `tg${Date.now() % 100000}`);
await bot.tick(3);

const stop = async (msg: string): Promise<never> => { console.error(`[tg] ${msg}`); await bot.logout(); process.exit(1); };
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // a fresh account still holds the 18-slot tutorial kit
    await localSetup(bot, { stats: SIM_STATS, items: [{ name: 'rune_scimitar', n: 1 }] });
    await wield(bot, ['rune_scimitar']);
    await localSetup(bot, { items: TG0.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })) });
    await bot.tick(2);
}
const low = REQ.skills.filter(s => s.hard && bot.stat(s.skill).level < s.level).map(s => `${s.skill} ${bot.stat(s.skill).level}/${s.level} (${s.why})`);
if (low.length) await stop(`below the required levels: ${low.join('; ')}`);
for (const s of REQ.skills) if (!s.hard && bot.stat(s.skill).level < s.level) console.log(`[tg] note: ${s.skill} ${bot.stat(s.skill).level} < recommended ${s.level} (${s.why})`);
const missing = TG0.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
if (missing.length) await stop(`missing ${missing.join(', ')} (see --supply)`);
if (!((bot as any).invs.get(1688)?.ids?.[3] > 0)) console.log('[tg] note: no weapon wielded; the Khazard warlord will take a long time barehanded');

const t0 = bot.tickCount;
const r = await treeGnomeLeg(bot, { verbose: true }).catch((e: Error) => ({ ok: false, error: e.message }) as Record<string, unknown>);
console.log(`[tg] result: ${JSON.stringify(r).slice(0, 400)}`);
console.log(`[tg] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok) await stop('quest not complete');
console.log(`[tg] QUEST COMPLETE in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(0);

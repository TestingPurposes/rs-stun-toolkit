// =====================================================================================================
// legs/run-mcannon.ts — standalone launcher for the Dwarf Cannon quest leg (k-mcannon-quest.ts, mcannonQuestLeg only).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-mcannon.ts --live <account> [--tele] [--eat N]
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//       Default: WALKS everywhere (Lawgof's camp north of Ardougne <-> Nulodion at the Ice Mountain dwarf camp).
//       --tele: Camelot teleport x2 + Falador teleport x1 instead (magic 45 + law 3, air 13, water 1).
//     Requirements (yours to meet before you start; the why is in run-mcannon.share.md):
//       - No quests, no skill requirements. Crafting and Smithing make the railings and the cannon repair succeed more
//         often (every failed railing costs 1-3 hp); the sim ran at crafting 40 / smithing 40 / hp 30.
//       - Food: sharks, eaten at hp <= 15 by default (--eat N). 8 free slots (6 railings, remains, toolkit, mould, notes;
//         the railings and remains are used up along the way).
//       - Start anywhere on the mainland the walker can reach Lawgof (2571,3463) from.
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-mcannon.ts --sim [name] [--tele]
//       fresh account: drops the tutorial kit, sets crafting 40 / smithing 40 / hp 30 (magic 45 with --tele), hands over
//       the supplies and teleports to Varrock west bank (3185,3436), the start the leg was tested from.
//       Refuses any non-local host. Use a new name per run: accounts persist.
//
//   --supply  prints the supply lists and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { mcannonQuestLeg, mcannonPrep, MCANNON_SUPPLY } from './k-mcannon-quest.js';
import { dropAllOf, KIT_JUNK, qp } from './q-lib.js';
import * as ls from '../../loc-scene.js';

type Item = { name: string; n: number };
const tele = process.argv.includes('--tele');
const WALK: Item[] = [{ name: 'shark', n: 10 }];
/** teleport runes (Camelot x2 + Falador x1) + 4 sharks, + 6 more sharks for a low-level account */
const TELE: Item[] = [...MCANNON_SUPPLY.filter(i => i.name !== 'shark'), { name: 'shark', n: 10 }];
const VARROCK_WEST = { x: 3185, z: 3436 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`walking (default): ${show(WALK)}\n--tele: ${show(TELE)} (magic 45)\nboth: 8 free slots`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-mcannon --live';   // any cheat call now throws
const eatAt = Number(arg('--eat') ?? 15);
ls.init();

const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `mc${Date.now() % 100000}`;
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName);
await bot.tick(3);
const fin = async (code: number, s: string) => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };

const need = tele ? TELE : WALK;
const have = (i: Item) => bot.count(objId(i.name));
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
    await localSetup(bot, { stats: { crafting: 40, smithing: 40, hitpoints: 30, ...(tele ? { magic: 45 } : {}) } });
    await localSetup(bot, { items: need.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })), tele: VARROCK_WEST });
    await bot.tick(2);
}
const miss = need.filter(i => have(i) < i.n).map(i => `${i.name} ${have(i)}/${i.n}`);
if (miss.length) await fin(1, `[mc] missing ${miss.join(', ')}`);
if (tele && bot.stat('magic').level < 45) await fin(1, `[mc] --tele needs magic 45 (have ${bot.stat('magic').level})`);
if (bot.free() < 8) await fin(1, `[mc] ${bot.free()} free slots: the quest items need 8`);
console.log(`[mc] start ${JSON.stringify(bot.pos())} quest points ${qp(bot)} crafting ${bot.stat('crafting').level} smithing ${bot.stat('smithing').level} hp ${bot.stat('hitpoints').cur}`);
if (tele) await mcannonPrep();

const t0 = bot.tickCount, qp0 = qp(bot);
/** fail at once on death (a respawn far away would otherwise leave the leg retrying ops in Lumbridge) */
(async () => { while (!bot.disposed) { if (bot.stat('hitpoints').level > 0 && bot.stat('hitpoints').cur === 0) await fin(1, `[mc] DIED at ${JSON.stringify(bot.pos())} after ${bot.tickCount - t0} ticks`); await bot.tick(1); } })();
let r: Record<string, number | boolean>;
try { r = await mcannonQuestLeg(bot, { verbose: true, walk: !tele, eatAt }); }
catch (e) { await fin(1, `[mc] FAILED after ${bot.tickCount - t0} ticks: ${(e as Error).message}`); throw e; }
console.log(`[mc] leg: ${JSON.stringify(r)}`);
console.log(`[mc] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok || qp(bot) <= qp0) await fin(1, `[mc] quest points did not rise (${qp0} -> ${qp(bot)}): not complete`);
await fin(0, `[mc] QUEST COMPLETE in ${bot.tickCount - t0} ticks (Dwarf Cannon, ${tele ? 'teleports' : 'walking'}), quest points ${qp0} -> ${qp(bot)}`);

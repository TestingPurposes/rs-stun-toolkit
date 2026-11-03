// =====================================================================================================
// legs/run-magearena.ts — standalone launcher for the Mage Arena quest leg (q-magearena.ts), optionally followed by the
// Charge burst (q-charge.ts: magic 80 -> 99 right after the guardian hands over the god staff).
// =====================================================================================================
// Modes:
//
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-magearena.ts --live <account> [--charge]
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     WILDERNESS: the Ardougne lever drops you at (3154,3924), deep Wilderness (level ~50). Other players can attack you
//     from the lever until the cellar ladder (~60 ticks of walking + web cutting). Carry nothing you are not willing to lose.
//     Requirements (yours to meet before you start; see run-magearena.share.md for the why):
//       - Magic 60 base (Kolodion refuses below 60; Fire Blast itself is 59). 80 for --charge.
//       - Prayer 37+ (Protect from Magic for the fight; without it Kolodion's god spells hit up to 20). 43 also turns on
//         Protect from Melee on the walk from the lever.
//       - Hitpoints high (the sim ran at 80). The leg eats a shark below 40 hp if you carry some.
//       - Equipment: wield a staff of fire. NO weapon or armour other than staffs/capes/amulets/rings, worn OR in the
//         pack (mage_arena.rs2 can_enter_mage_arena: also no arrows, bows, logs, clue scrolls, cannon parts).
//       - Pack: the supply list (--supply) + 2 free slots (cape, staff). Start in Ardougne (the leg walks to the lever at
//         2561,3311; the sim starts at the market 2655,3307).
//       - The leg ends INSIDE the Mage Arena chamber (~2508,4697, not Wilderness). Leaving is yours (teleport).
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-magearena.ts --sim [name] [--charge]
//       fresh account: drops the tutorial kit (its dagger/sword/bow/axe/pickaxe would block the arena), sets stats
//       (magic 80, prayer 70, hp 80), hands over the supplies, wields the staff of fire and teleports to Ardougne market.
//       Refuses any non-local host. Use a new name per run: accounts persist.
//
//   --supply  prints the supply lists and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { magearenaLeg, magearenaPrep, MAGEARENA_SUPPLY, MAGEARENA_PRAYER } from './q-magearena.js';
import { chargeLeg, chargeCasts } from './q-charge.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';
import { wield } from './run-lib.js';

type Item = { name: string; n: number };
/** the arena: staff of fire (wielded or in the pack), knife (webs), 120 Fire Blasts (death + 4 air; the staff covers fire),
 *  one prayer potion; sharks are optional (the leg eats one below 40 hp) */
const MA0: Item[] = [...MAGEARENA_SUPPLY, MAGEARENA_PRAYER];
const ARDOUGNE = { x: 2655, z: 3307 };
const STAFF_OF_FIRE = objId('staff_of_fire');

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
const charge = process.argv.includes('--charge');
if (process.argv.includes('--supply')) {
    console.log(`MA0 (before the lever): ${show(MA0)} (+ optional sharks; 2 free slots)`);
    console.log(`--charge (after the staff): bloodrune x3n + airrune x3n with the staff of fire wielded, n = ceil((998458 - magic xp) / 4500); n = 163 from exactly magic 80`);
    process.exit(0);
}

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-magearena --live';   // any cheat call now throws

const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `ma${Date.now() % 100000}`;
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName);
await bot.tick(3);

const have = (i: Item) => bot.count(objId(i.name)) + (objId(i.name) === STAFF_OF_FIRE && bot.isWorn(STAFF_OF_FIRE) ? 1 : 0);
const missing = (l: Item[]) => l.filter(i => have(i) < i.n).map(i => `${i.name} ${have(i)}/${i.n}`);
async function supply(tag: string, l: Item[]): Promise<void> {
    if (sim) { await localSetup(bot, { items: l.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) }); await bot.tick(2); }
    const m = missing(l);
    if (m.length) { console.error(`[ma] ${tag}: missing ${m.join(', ')}`); await bot.logout(); process.exit(1); }
}
const fin = async (code: number, s: string) => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };

if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit (weapons block the arena)
    await localSetup(bot, { stats: { magic: 80, prayer: 70, hitpoints: 80 }, items: [{ name: 'shark', n: 5 }] });
}
await supply('before the lever', MA0);
await wield(bot, ['staff_of_fire']);
if (!bot.isWorn(STAFF_OF_FIRE)) await fin(1, '[ma] could not wield the staff of fire');
if (bot.stat('magic').level < 60) await fin(1, `[ma] magic ${bot.stat('magic').level}: Kolodion needs 60 base`);
if (bot.free() < 2) await fin(1, `[ma] ${bot.free()} free slots: the cape and the staff need 2`);
if (sim) await localSetup(bot, { tele: ARDOUGNE });
await magearenaPrep(bot.tile());
await bot.tick(2);

const t0 = bot.tickCount;
/** fail at once on death (a respawn far away would otherwise leave the leg retrying ops in Lumbridge) */
(async () => { while (!bot.disposed) { if (bot.stat('hitpoints').level > 0 && bot.stat('hitpoints').cur === 0) await fin(1, `[ma] DIED at ${JSON.stringify(bot.pos())} after ${bot.tickCount - t0} ticks`); await bot.tick(1); } })();
let r: Record<string, number | boolean>;
try { r = await magearenaLeg(bot, { verbose: true }); }
catch (e) { await fin(1, `[ma] FAILED: ${(e as Error).message}`); throw e; }
console.log(`[ma] leg: ${JSON.stringify(r)}`);
console.log(`[ma] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok || bot.count(2416) === 0)   // 2416 = the god staff (q-magearena STAFF)
    await fin(1, '[ma] no god staff: quest not complete');
console.log(`[ma] QUEST COMPLETE in ${bot.tickCount - t0} ticks (Mage Arena: god staff + cape in the pack)`);

if (charge) {
    if (bot.stat('magic').level < 80) await fin(1, `[ma] --charge needs magic 80 (have ${bot.stat('magic').level})`);
    const n = chargeCasts(bot.stat('magic').xp);
    await supply('before Charge', [{ name: 'bloodrune', n: 3 * n }, { name: 'airrune', n: 3 * n }]);
    const t1 = bot.tickCount;
    const c = await chargeLeg(bot, { verbose: true });
    console.log(`[ma] charge: ${JSON.stringify(c)} in ${bot.tickCount - t1} ticks, magic ${bot.stat('magic').level}`);
    if (!c.ok) await fin(1, '[ma] Charge burst did not reach 99');
}
await fin(0, `[ma] done in ${bot.tickCount - t0} ticks`);

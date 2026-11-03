// =====================================================================================================
// legs/run-shilo.ts — standalone launcher for JUNGLE POTION + SHILO VILLAGE (q-shilo.ts, the Karamja phases).
// =====================================================================================================
// q-shilo.ts also has mainland prep phases (bank, tools, meats, mining, Druidic Ritual); this launcher runs only the
// quest part: [m-boat] -> k-shop -> k-smith -> k-jungle (Jungle Potion) -> k-belt -> k-start ->
// k-mound -> k-azr -> k-bury -> k-cairn1 -> k-beads -> k-tomb -> k-cairn2 (Shilo Village complete) -> k-enter.
// Every phase checks an observable (item, stat, position) before acting; finished phases are recorded in
// logs/shilo/<account>.json, so a rerun with the same account resumes after the last finished phase.
//
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-shilo.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements (yours to meet before you start; the why is in run-shilo.share.md):
//       - Druidic Ritual complete (Jungle Potion needs it; it also gives Herblore 3, needed to identify the herbs).
//       - Agility 32, Crafting 20, Smithing 4 (bronze wire), Prayer 43 recommended (Protect from Melee in the undead
//         dungeons), a weapon and combat good enough for Nazastarool's three forms. PROVEN at 99 melee/hp/prayer
//         (clean sim, 3644 ticks, 10 of 15 sharks eaten). At 80 melee/hp + prayer 70 the sim DIED in the tomb (Protect
//         from Melee runs out: Ah Za Rhoon + the tomb drain it and the leg has no prayer restore); at 70/43 it ran out of
//         food (hp 1). Lower accounts: untested.
//       - Pack: coins >= 2,000 (Jiminua's tools + the boat), 3 bones, 15 sharks; free slots for the tools and quest items.
//       - Start on Karamja, or anywhere the walker can reach Port Sarim from (the m-boat phase sails to Musa Point, 30 gp).
//       - Resume from a phase with SHILO_START=<phase> (names: PHASES below).
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-shilo.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Druidic Ritual complete (%druidquest = 4), sets the stats above,
//       hands over the supplies + an adamant longsword (wielded) and teleports to Jiminua's store (2768,3118).
//       Refuses any non-local host. Use a new name per run: accounts (and logs/shilo/<name>.json) persist.
//
//   --supply  prints the supply list and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { runPhases, readProg, PHASES as ALL_PHASES, onKaramja } from './q-shilo.js';
import { dropAllOf, KIT_JUNK, qp } from './q-lib.js';
import { wield } from './run-lib.js';

type Item = { name: string; n: number };
const PHASES = ['m-boat', 'k-shop', 'k-smith', 'k-jungle', 'k-belt', 'k-start', 'k-mound', 'k-azr', 'k-bury', 'k-cairn1', 'k-beads', 'k-tomb', 'k-cairn2', 'k-enter'];
/** carried in: coins for Jiminua (spade, chisel, rope, tinderbox, hammer, bronze bar, candle) + the boat; 3 bones for the
 *  tomb door; sharks (undead dungeons, the stepping stones and climbing rocks hurt on a slip) */
const SH0: Item[] = [{ name: 'coins', n: 2000 }, { name: 'bones', n: 3 }, { name: 'shark', n: 15 }];
const JIMINUA = { x: 2768, z: 3118 };
const SIM_STATS = { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99, agility: 32, crafting: 20, smithing: 4, herblore: 3 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`SH0 (before the first phase): ${show(SH0)} + a wielded weapon`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-shilo --live';   // any cheat call now throws
const START = process.env.SHILO_START;
if (START && !PHASES.includes(START)) { console.error(`SHILO_START=${START}: unknown phase (one of ${PHASES.join(' ')})`); process.exit(2); }
if (PHASES.some(p => !ALL_PHASES.some(q => q.id === p))) { console.error('q-shilo.ts phase table changed'); process.exit(2); }

const acct = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `sh${Date.now() % 100000}`);
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(acct);
await bot.tick(3);
const fin = async (code: number, s: string) => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };

const todo = PHASES.slice(START ? PHASES.indexOf(START) : 0);
/** a fresh start (not a resume from logs/shilo/<account>.json or SHILO_START): set up (sim) and check the supplies */
const fresh = todo[0] === PHASES[0] && readProg(acct).done.length === 0;
if (sim && fresh) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the 18-slot tutorial kit
    await bot.cheat('setvar druidquest 4'); await bot.tick(1);                  // Druidic Ritual complete (^druid_complete)
    await localSetup(bot, { stats: SIM_STATS, items: [{ name: 'adamant_longsword', n: 1 }] });
    await wield(bot, ['adamant_longsword']);
}
if (fresh) {
    const have = (i: Item) => bot.count(objId(i.name));
    if (sim) { await localSetup(bot, { items: SH0.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) }); await bot.tick(2); }
    const m = SH0.filter(i => have(i) < i.n).map(i => `${i.name} ${have(i)}/${i.n}`);
    if (m.length) await fin(1, `[shilo] missing ${m.join(', ')}`);
    const low = Object.entries({ agility: 32, crafting: 20, herblore: 3 }).filter(([s, l]) => bot.stat(s).level < l);
    if (low.length) await fin(1, `[shilo] too low: ${low.map(([s, l]) => `${s} ${bot.stat(s).level}/${l}`).join(', ')} (herblore 3 = Druidic Ritual)`);
    if (sim) await localSetup(bot, { tele: JIMINUA });
}
console.log(`[shilo] ${acct}: phases ${todo.join(' ')}; already done: ${readProg(acct).done.join(' ') || '-'}; on Karamja: ${onKaramja(bot.tile())}`);

const t0 = bot.tickCount;
const qp0 = qp(bot);
/** fail at once on death (a respawn far away would otherwise leave the leg retrying ops in Lumbridge) */
(async () => { while (!bot.disposed) { if (bot.stat('hitpoints').level > 0 && bot.stat('hitpoints').cur === 0) await fin(1, `[shilo] DIED at ${JSON.stringify(bot.pos())} after ${bot.tickCount - t0} ticks`); await bot.tick(1); } })();
for (const ph of todo) {
    if (readProg(acct).done.includes(ph)) { console.log(`[shilo] ${ph}: done earlier, skipped`); continue; }
    try { await runPhases(bot, acct, [ph]); }
    catch (e) { await fin(1, `[shilo] FAILED in ${ph} after ${bot.tickCount - t0} ticks: ${(e as Error).message}`); }
    if (ph === 'k-jungle') console.log(`[shilo] Jungle Potion done at +${bot.tickCount - t0} ticks`);
    if (ph === 'k-cairn2') console.log(`[shilo] corpse laid at +${bot.tickCount - t0} ticks`);
}
console.log(`[shilo] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
// k-enter only succeeds through the gate once %zombiequeen is complete: standing in the village is the proof
const t = bot.tile();
if (!(t.x >= 2817 && t.x <= 2866 && t.z >= 2944 && t.z <= 3008)) await fin(1, `[shilo] not inside Shilo Village at (${t.x},${t.z})`);
await fin(0, `[shilo] QUEST COMPLETE in ${bot.tickCount - t0} ticks (Jungle Potion + Shilo Village; standing in Shilo Village), quest points ${qp0} -> ${qp(bot)}`);

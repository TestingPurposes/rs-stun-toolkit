// =====================================================================================================
// legs/run-waterfall.ts — standalone launcher for the Waterfall Quest leg (q-waterfall.ts).
// =====================================================================================================
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-waterfall.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements (see run-waterfall.share.md for the why):
//       - No quests. Magic 45 (two Camelot teleports). Prayer 43 recommended (Protect from Melee in three dungeons).
//       - Wear NOTHING but jewellery and carry no weapon/armour: Glarial's tomb refuses them. It also refuses ANY rune, so
//         the pack holds exactly two Camelot teleports (10 air + 2 law), which the leg spends before the tomb.
//       - Phase 1 (start -> out of Glarial's tomb, holding the amulet + urn): WF0 below. Checked at the start.
//       - Phase 2 (raft -> pillars -> chalice) needs WFP (6 air, 6 earth, 6 water) for the pillars. A helper can trade
//         them at the tomb exit; otherwise the script stops after the tomb with the missing list: fetch the runes (keep
//         the amulet + urn), then rerun with WATERFALL_START=part2 from near Almera's house (2522,3498); keep the rope too.
//       - Free slots: >= 7 at the chalice (the reward needs 5).
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-waterfall.ts --sim [name]
//       fresh account: drops the tutorial kit, sets magic 45, prayer 43, hp/def 30, hands over WF0, teleports to Varrock
//       west bank; the pillar runes are handed over by cheat at the tomb exit. WATERFALL_START=part2 starts at the tomb
//       exit (quest varp 4 + amulet + urn + rope). Refuses a non-local host. New name per run.
//   --supply  prints the supply lists and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { waterfallLeg, waterfallPrep, WATERFALL_SUPPLY, WATERFALL_PILLAR_SUPPLY } from './q-waterfall.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';

type Item = { name: string; n: number };
const WF0: Item[] = WATERFALL_SUPPLY;           // rope, 10 air + 2 law (exactly two Camelot teleports), 3 sharks
const WFP: Item[] = WATERFALL_PILLAR_SUPPLY;    // 6 air, 6 earth, 6 water: one of each on the six pillars
/** WATERFALL_START=part2: what phase 1 leaves in the pack that phase 2 still uses (the rope goes on the rock + tree) */
const PART2_ITEMS: Item[] = [{ name: 'glarials_amulet_waterfall_quest', n: 1 }, { name: 'glarials_urn_full_waterfall_quest', n: 1 }, { name: 'rope', n: 1 }];
const START = { x: 3185, z: 3436 }, TOMB_EXIT = { x: 2557, z: 3444 };
const PART2 = process.env.WATERFALL_START === 'part2';
if (process.env.WATERFALL_START && !PART2) { console.error(`WATERFALL_START=${process.env.WATERFALL_START}: only 'part2' (after Glarial's tomb)`); process.exit(2); }

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) {
    console.log(`WF0 (phase 1, at the start; nothing else may be worn or carried into the tomb): ${show(WF0)}\nWFP (phase 2, after the tomb): ${show(WFP)}`);
    process.exit(0);
}

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-waterfall --live';   // any cheat call now throws

const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `wf${Date.now() % 100000}`);
await bot.tick(3);

const missing = (l: Item[]) => l.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
async function supply(tag: string, l: Item[], hint = ''): Promise<void> {
    if (sim) { await localSetup(bot, { items: l.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })) }); await bot.tick(2); }
    const m = missing(l);
    if (m.length) { console.error(`[wf] ${tag}: missing ${m.join(', ')}${hint}`); await bot.logout(); process.exit(1); }
}

if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // the tutorial kit (its runes would shut the tomb)
    await localSetup(bot, { stats: { magic: 45, prayer: 43, hitpoints: 30, defence: 30 } });
    if (PART2) {
        await bot.cheat('setvar waterfall_quest 4'); await bot.tick(1);   // ^waterfall quest stage after the tomb (leg comment: =4)
        await localSetup(bot, { items: PART2_ITEMS, tele: TOMB_EXIT });
    } else await localSetup(bot, { tele: START });
}
if (PART2) await supply('before phase 2', PART2_ITEMS, ' (they come from Glarial\'s tomb: run phase 1)');
else {
    await supply('before phase 1', WF0);
    if (bot.stat('magic').cur < 45) { console.error(`[wf] needs magic 45 (now ${bot.stat('magic').cur}) for the Camelot teleports`); await bot.logout(); process.exit(1); }
}
await waterfallPrep();
// the pillar runes: in the sim a cheat hand-over at the tomb exit; live they must be in the pack by now (a helper trade
// here, or a restock + WATERFALL_START=part2)
const giveRunes = () => supply('before phase 2 (pillars)', WFP, ' — fetch them, keep the amulet + urn + rope, then rerun with WATERFALL_START=part2');
const t0 = bot.tickCount;
let r: Record<string, number | boolean>;
try { r = await waterfallLeg(bot, { verbose: true, part2: PART2, giveRunes }); }
catch (e) { console.error(`[wf] leg threw: ${(e as Error).message}`); await bot.logout(); process.exit(1); }
console.log(`[wf] result: ${JSON.stringify(r).slice(0, 400)}`);
console.log(`[wf] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok) { await bot.logout(); process.exit(1); }
console.log(`[wf] QUEST COMPLETE in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(0);

// =====================================================================================================
// legs/run-grandtree.ts — standalone launcher for The Grand Tree quest leg (q-grandtree.ts).
// =====================================================================================================
// Modes (exactly one):
//
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-grandtree.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements: GRANDTREE_REQUIREMENTS in q-grandtree.ts (printed with --supply): Tree Gnome Village complete (the leg
//     travels by the village spirit tree), agility 25 and magic 25 (checked), start inside the village next to the spirit
//     tree (where run-treegnome.ts ends). Carry GT0 (below), wield a melee weapon, keep 6 slots free. The launcher stops with
//     the missing list before it moves.
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-grandtree.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Tree Gnome Village complete (%treequest 9), sets stats (att 92, str 83,
//       hp 72, magic 80, prayer 99, agility 25: the speedrun trainee at this point, agility at the minimum), wields a rune
//       scimitar, teleports next to the village spirit tree and hands over GT0 with cheats. GT_START=<stage> starts from a
//       mid-quest checkpoint (%grandtree + items + position, the speedrun runner's table). Refuses any non-local host. Use a
//       new name per run: accounts persist.
//
//   --supply  prints the requirements and the supply list, then exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { grandTreeLeg, GRANDTREE_SUPPLY, GRANDTREE_REQUIREMENTS as REQ } from './q-grandtree.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';
import { wield } from './run-lib.js';

type Item = { name: string; n: number };
/** the whole quest in one phase: Black Demon food + prayer, Varrock teleport runes (Karamja -> the young tree) */
const GT0: Item[] = [...GRANDTREE_SUPPLY, { name: 'lawrune', n: 1 }, { name: 'airrune', n: 3 }, { name: 'firerune', n: 1 }];
const SIM_STATS = { attack: 92, strength: 83, hitpoints: 72, magic: 80, prayer: 99, agility: 25 };
const VILLAGE_TREE = { x: 2542, z: 3170 };
/** GT_START checkpoints (sim only): the leg's stage order, %grandtree value at that stage, items held there, position */
const ORDER = ['start', 'hazel', 'relay', 'glider', 'return', 'evidence', 'twigs', 'demon', 'roots'];
const CHECKPOINTS: Record<string, { v: number; items: Item[]; at: { x: number; z: number; level?: number } }> = {
    start: { v: 0, items: [], at: VILLAGE_TREE }, hazel: { v: 10, items: [{ name: 'grandtree_barksample', n: 1 }], at: { x: 2461, z: 3444 } },
    relay: { v: 20, items: [{ name: 'grandtree_scroll', n: 1 }], at: { x: 2461, z: 3444 } }, glider: { v: 80, items: [], at: { x: 2465, z: 3497, level: 3 } },
    return: { v: 90, items: [{ name: 'grandtree_order', n: 1 }], at: { x: 2998, z: 3043 } }, evidence: { v: 90, items: [{ name: 'grandtree_order', n: 1 }], at: { x: 2461, z: 3444 } },
    twigs: { v: 110, items: [{ name: 'grandtree_invasionplans', n: 1 }], at: { x: 2466, z: 3494 } }, demon: { v: 130, items: [], at: { x: 2486, z: 3464, level: 2 } },
    roots: { v: 140, items: [], at: { x: 2466, z: 9895 } },
};

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) {
    console.log(`quests: ${REQ.quests.join(', ') || 'none'}`);
    for (const s of REQ.skills) console.log(`${s.skill} ${s.level}${s.hard ? ' (required)' : ' (recommended)'}: ${s.why}`);
    console.log(`gear: ${REQ.gear}\nstart: ${REQ.start}\nGT0 (carry at the start): ${show(GT0)}`);
    process.exit(0);
}

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
const START = process.env.GT_START;
if (START && !ORDER.includes(START)) { console.error(`GT_START=${START}: unknown stage (one of ${ORDER.join(' ')})`); process.exit(2); }
if (live) CHEATS.blocked = 'run-grandtree --live';   // any cheat call now throws

const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `gt${Date.now() % 100000}`);
await bot.tick(3);

const stop = async (msg: string): Promise<never> => { console.error(`[gt] ${msg}`); await bot.logout(); process.exit(1); };
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // a fresh account still holds the 18-slot tutorial kit
    const cp = CHECKPOINTS[START ?? 'start']!;
    await bot.cheat('setvar treequest 9'); await bot.tick(2);   // ^tree_complete (quest.constant): the village spirit tree works
    await bot.cheat(`setvar grandtree ${cp.v}`); await bot.tick(2);
    await localSetup(bot, { stats: SIM_STATS, items: [{ name: 'rune_scimitar', n: 1 }] });
    await wield(bot, ['rune_scimitar']);
    await localSetup(bot, { items: [...GT0.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })), ...cp.items] });
    await localSetup(bot, { tele: cp.at });
    await bot.tick(2);
}
const low = REQ.skills.filter(s => s.hard && bot.stat(s.skill).level < s.level).map(s => `${s.skill} ${bot.stat(s.skill).level}/${s.level} (${s.why})`);
if (low.length) await stop(`below the required levels: ${low.join('; ')}`);
for (const s of REQ.skills) if (!s.hard && bot.stat(s.skill).level < s.level) console.log(`[gt] note: ${s.skill} ${bot.stat(s.skill).level} < recommended ${s.level} (${s.why})`);
// stages after 'return' no longer need the teleport runes
const need = ORDER.indexOf(START ?? 'start') > ORDER.indexOf('return') ? GT0.filter(i => !/rune$/.test(i.name)) : GT0;
const missing = need.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
if (missing.length) await stop(`missing ${missing.join(', ')} (see --supply)`);
if (bot.free() < 6) await stop(`only ${bot.free()} free slots; the quest items need 6`);
if (!((bot as any).invs.get(1688)?.ids?.[3] > 0)) console.log('[gt] note: no weapon wielded; the Black Demon will take a long time barehanded');
if (!START && Math.max(Math.abs(bot.tile().x - VILLAGE_TREE.x), Math.abs(bot.tile().z - VILLAGE_TREE.z)) > 12) console.log(`[gt] note: start is ${JSON.stringify(bot.tile())}, not next to the village spirit tree ${JSON.stringify(VILLAGE_TREE)}; the walk there may fail outside the village`);

const t0 = bot.tickCount;
const r = await grandTreeLeg(bot, { verbose: true, startAt: START }).catch((e: Error) => ({ ok: false, error: e.message }) as Record<string, unknown>);
console.log(`[gt] result: ${JSON.stringify(r).slice(0, 400)}`);
console.log(`[gt] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
if (!r.ok) await stop('quest not complete');
console.log(`[gt] QUEST COMPLETE in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(0);

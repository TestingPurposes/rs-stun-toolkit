// =====================================================================================================
// legs/run-monkey-madness.ts — standalone launcher for the Monkey Madness quest leg (q-monkeymadness.ts).
// =====================================================================================================
// Two modes:
//
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/run-monkey-madness.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements (yours to meet before you start; every one of them was hit in the offline sim):
//       - Quests: The Grand Tree and Tree Gnome Village complete. Start next to King Narnode under the Grand Tree (2464,9896).
//       - Magic 75+ (Fire Wave for the Jungle Demon; the Varrock teleport out of the atoll needs 25).
//       - Agility 68+ (the crate drop into the Ape Atoll warehouse cellar; lower = a fall that can fail the step).
//       - Prayer 43+ (Protect from Melee AND Protect from Missiles, 40). More is better: the atoll runs a protect prayer for
//         ~3000 ticks; the sim runs with 99 prayer and 4 prayer potions and ends phase 2 with 0-2 potions left.
//       - Defence ~70 and Hitpoints ~70. At defence 1 the gorillas/archers/temple guards eat all the sharks before the
//         greegree is made (sim: died at the temple). Even at defence 70 a run with extra knockouts (village guards -> jail)
//         used 10 sharks before the second Zooknock visit and died: MM0 carries 12. A weapon (the sim wields a rune scimitar) is optional.
//       - Pack: nothing but the supplies. MM0 is 25 items + the seal; the quest adds up to 4 more, the greegree takes the
//         weapon slot (your weapon goes to the pack), Narnode's reward needs 3 free slots.
//       - Do not teleport (spell, tab, spirit tree, ...) while the backpack monkey is in the pack (zoo -> Awowogei): every
//         teleport deletes it. The script walks from the zoo to the Grand Tree on purpose.
//       - Phase 1 needs nothing. Before phase 2 the script checks the pack for MM0 and stops with the missing list if
//         anything is short; before phase 3 it checks MMD (lists below, also printed with --supply).
//       - Resume mid-quest with MM_START=<stage> (stage names: ORDER below). Items already used up are not asked for.
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/run-monkey-madness.ts --sim [name]
//       fresh account: drops the tutorial kit, sets the two prerequisite quests complete, sets stats (att/str 75, def 70,
//       hp 72, magic 80, prayer 99, agility 75), wields a rune scimitar, teleports to Narnode and hands over each phase's
//       supplies with cheats. MM_START=<stage> starts from a mid-quest checkpoint (quest varbits + items + position, the
//       same table as the speedrun runner). Refuses any non-local host. Use a new name per run: accounts persist.
//
//   --supply  prints the supply lists and exits.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../core.js';
import { readBotEnv, createLive } from './k-live.js';
import { monkeyMadnessLeg, MM_SUPPLY, MM_DEMON_SUPPLY } from './q-monkeymadness.js';
import { dropAllOf, KIT_JUNK } from './q-lib.js';
import { wield } from './run-lib.js';

type Item = { name: string; n: number };
/** phase 2 (from Karamja): quest items + food/potions; phase 3 (from the hangar, second trip): the Jungle Demon kit */
// MM_PROFILE=route (sim): the route main as it reaches MM (qrq* timelines: att 99 str 88 def 88 hp 77 pray 81 mage 94 agil 85, unarmed,
// the runner adapter's phase-2 kit of 10 sharks, legs/qp/route/route-legs.ts mm)
const ROUTE_PROFILE = process.env.MM_PROFILE === 'route';
const MM0: Item[] = [...MM_SUPPLY, { name: 'shark', n: ROUTE_PROFILE ? 10 : 12 }, { name: '4doseprayerrestore', n: 4 }, { name: '3doseantipoison', n: 1 }];
const MMD: Item[] = ROUTE_PROFILE ? [...MM_DEMON_SUPPLY.map(i => i.name === 'shark' ? { ...i, n: 16 } : i.name === 'lawrune' ? { ...i, n: i.n + 2 } : i), { name: '4doseprayerrestore', n: 4 }] : MM_DEMON_SUPPLY;
const NARNODE = { x: 2464, z: 9896 };

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
if (process.argv.includes('--supply')) { console.log(`MM0 (before phase 2): ${show(MM0)}\nMMD (before phase 3): ${show(MMD)}`); process.exit(0); }

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-monkey-madness --live';   // any cheat call now throws

const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `mm${Date.now() % 100000}`);
await bot.tick(3);

const missing = (l: Item[]) => l.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
async function supply(tag: string, l: Item[]): Promise<void> {
    if (sim) { await localSetup(bot, { items: l.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) })) }); await bot.tick(2); }
    const m = missing(l);
    if (m.length) { console.error(`[mm] ${tag}: missing ${m.join(', ')} — stage them and rerun with MM_START (see q-monkeymadness.ts)`); await bot.logout(); process.exit(1); }
}

/** --sim with MM_START=<stage>: mid-quest checkpoint (quest varbits + the items held there + position), for iterating on one
 *  stage. Same table as the speedrun runner's mmCheckpoint. Stages not listed here start from 'start'. */
type V = Record<string, number>;
const C2: V = { mm_main: 3, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, mm_waydar: 1, mm_lumdo: 3 };
const ZK: V = { ...C2, mm_garkor: 2, mm_zooknock: 5, mm_zooknock_player_is_collecting_for_talisman: 1 };
const C3: V = { mm_main: 4, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, mm_waydar: 1, mm_lumdo: 3, mm_zooknock: 6, mm_monkey_child: 7 };
const C3K: V = { ...C3, mm_garkor: 4, mm_elder_guard: 1, mm_kruk: 1, mm_awowogei: 1 };
const SEAL = { name: 'mm_gnome_royal_seal', n: 1 }, SPEAK = { name: 'mm_amulet_of_monkey_speak', n: 1 }, GG = { name: 'mm_monkey_greegree_for_normal_monkey', n: 1 }, PET = { name: 'mm_monkey_in_backpack', n: 1 };
const CHECKPOINTS: Record<string, { v: V; items: Item[]; at: { x: number; z: number; level?: number } }> = {
    karamja: { v: { mm_main: 1, mm_narnode: 3 }, items: [SEAL], at: { x: 2466, z: 3496 } },
    atoll: { v: C2, items: [SEAL], at: { x: 2801, z: 2707 } },
    garkor: { v: C2, items: [SEAL], at: { x: 2763, z: 2799 } },
    warehouse: { v: { ...C2, mm_garkor: 2 }, items: [SEAL], at: { x: 2764, z: 2762 } },
    cellar: { v: { ...C2, mm_garkor: 2 }, items: [SEAL, { name: 'mm_monkey_dentures', n: 1 }], at: { x: 2801, z: 9169 } },
    tobeach: { v: { ...C2, mm_garkor: 2 }, items: [SEAL, { name: 'mm_monkey_dentures', n: 1 }, { name: 'mm_monkey_amulet_mould', n: 1 }], at: { x: 2764, z: 2762 } },
    zooknock1: { v: { ...C2, mm_garkor: 2 }, items: [SEAL, { name: 'mm_monkey_dentures', n: 1 }, { name: 'mm_monkey_amulet_mould', n: 1 }], at: { x: 2803, z: 2724 } },
    out1: { v: ZK, items: [SEAL, { name: 'mm_enchanted_gold_bar', n: 1 }, { name: 'mm_monkey_amulet_mould', n: 1 }], at: { x: 2804, z: 9142 } },
    temple: { v: ZK, items: [SEAL, { name: 'mm_enchanted_gold_bar', n: 1 }, { name: 'mm_monkey_amulet_mould', n: 1 }], at: { x: 2763, z: 2799 } },
    child: { v: ZK, items: [SEAL, SPEAK], at: { x: 2790, z: 2785 } },
    zooknock2: { v: { ...ZK, mm_monkey_child: 7 }, items: [SEAL, SPEAK, { name: 'mm_monkey_talisman', n: 1 }], at: { x: 2803, z: 2724 } },
    ch3: { v: { ...C3, mm_garkor: 2 }, items: [SEAL, SPEAK, GG], at: { x: 2804, z: 9143 } },
    kruk: { v: { ...C3, mm_garkor: 4, mm_elder_guard: 1 }, items: [SEAL, SPEAK, GG], at: { x: 2760, z: 2706 } },
    tozoo: { v: C3K, items: [SEAL, SPEAK, GG], at: { x: 2803, z: 2709 } },
    zoo: { v: C3K, items: [SEAL, SPEAK, GG], at: { x: 2555, z: 3259 } },
    fromzoo: { v: C3K, items: [SEAL, SPEAK, GG, PET], at: { x: 2595, z: 3279 } },
    hangar2: { v: C3K, items: [SEAL, SPEAK, GG, PET], at: { x: 2461, z: 3444 } },
    throne2: { v: C3K, items: [SEAL, SPEAK, GG, PET], at: { x: 2802, z: 2708 } },
    demon: { v: { ...C3K, mm_main: 5, mm_awowogei: 2, mm_garkor: 6 }, items: [SEAL, SPEAK, GG, { name: 'mm_sigil', n: 1 }], at: { x: 2806, z: 2762 } },
};
const START = process.env.MM_START;
/** the leg's stage order (q-monkeymadness.ts `order`): phase 1 = start; phase 2 = karamja..fromzoo; phase 3 = hangar2.. */
const ORDER = ['start', 'karamja', 'orders', 'daero', 'puzzle', 'crash', 'atoll', 'jail1', 'garkor', 'warehouse', 'cellar', 'tobeach', 'zooknock1', 'out1', 'jail2', 'temple', 'child', 'zooknock2', 'ch3', 'kruk', 'tozoo', 'zoo', 'fromzoo', 'hangar2', 'throne2', 'demon', 'reward'];
if (START && !ORDER.includes(START)) { console.error(`MM_START=${START}: unknown stage (one of ${ORDER.join(' ')})`); process.exit(2); }
if (START && sim && !['start', 'hangar2'].includes(START) && !CHECKPOINTS[START]) { console.error(`MM_START=${START}: no sim checkpoint for this stage (have: start hangar2 ${Object.keys(CHECKPOINTS).join(' ')})`); process.exit(2); }
const phaseOf = (s: string | undefined) => { const i = ORDER.indexOf(s ?? 'start'); return i <= 0 ? 1 : i < ORDER.indexOf('hangar2') ? 2 : 3; };
if (sim) {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);   // a fresh account still holds the 18-slot tutorial kit (runes too: 2 slots)
    for (const [v, val] of [['grandtree', 160], ['treequest', 9]] as const) { await bot.cheat(`setvar ${v} ${val}`); await bot.tick(1); }
    // a mid-level account (the speedrun trainee had att 99 / str 83 / hp 72 / mage 80 / pray 99 / agil 75 but DEFENCE 1, and at
    // defence 1 the atoll's gorillas + archers eat all 10 sharks before chapter 3: defence ~70 is what makes 10 sharks enough)
    if (ROUTE_PROFILE) await localSetup(bot, { stats: { attack: 99, strength: 88, defence: 88, hitpoints: 77, ranged: 68, magic: 94, prayer: 81, agility: 85, crafting: 50, thieving: 78 } });
    else {
    await localSetup(bot, { stats: { attack: 75, strength: 75, defence: 70, hitpoints: 72, magic: 80, prayer: 99, agility: 75 }, items: [{ name: 'rune_scimitar', n: 1 }] });
    await wield(bot, ['rune_scimitar']);
    }
    const cp = START ? CHECKPOINTS[START] : undefined;
    if (cp) {
        for (const [k, v] of Object.entries(cp.v)) { await bot.cheat(`setvar ${k} ${v}`); await bot.tick(1); }
        await localSetup(bot, { items: cp.items });
        if (cp.items.some(i => i.name === SPEAK.name)) await wield(bot, [SPEAK.name]);
    }
    await localSetup(bot, { tele: cp?.at ?? NARNODE });
}
const t0 = bot.tickCount;
const phase = async (name: string, o: { startAt?: string; stopAt?: string }) => {
    const r = await monkeyMadnessLeg(bot, { verbose: true, ...o });
    console.log(`[mm] ${name}: ${JSON.stringify(r).slice(0, 300)}`);
    console.log(`[mm] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (!r.ok) { await bot.logout(); process.exit(1); }
};
const P = phaseOf(START);
if (P <= 1) await phase('phase 1 (Narnode -> Karamja)', { startAt: START, stopAt: 'karamja' });
if (P <= 2) {
    // resuming mid-phase: quest items already used up are not needed (gold bar -> Zooknock, wool -> amulet, bananas ->
    // the monkey child, bones -> Zooknock's greegree)
    const usedAt: Record<string, string> = { gold_bar: 'zooknock1', ball_of_wool: 'temple', banana: 'child', mm_normal_monkey_bones: 'zooknock2' };
    const at = ORDER.indexOf(START ?? 'start');
    await supply('before phase 2', MM0.filter(i => !usedAt[i.name] || at <= ORDER.indexOf(usedAt[i.name]!)));
    await phase('phase 2 (Karamja -> Ape Atoll -> stronghold)', { startAt: P === 2 ? START : 'karamja', stopAt: 'hangar2' });
}
// the route adapter drops what phase 3 never uses before its demon kit (route-legs.ts mm, fix 61)
if (ROUTE_PROFILE) { dropAllOf(bot, ['vial_empty', 'mm_monkey_amulet_mould', 'banana', 'ball_of_wool', 'gold_bar', 'mm_normal_monkey_bones', '1doseantipoison', '2doseantipoison', '3doseantipoison']); await bot.tick(3); }
await supply('before phase 3', MMD);
await phase('phase 3 (Jungle Demon -> reward)', { startAt: P === 3 && START ? START : 'hangar2' });
console.log(`[mm] QUEST COMPLETE in ${bot.tickCount - t0} ticks`);
await bot.logout();
process.exit(0);

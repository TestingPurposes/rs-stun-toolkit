// =====================================================================================================
// quests-share/run-troll-stronghold.ts — standalone launcher for the Troll Stronghold driver (quest-troll.ts).
// =====================================================================================================
// The quest logic is cheat-free: driveTrollStronghold() — Denulth (start) -> buy climbing boots
// from Tenzing (12 gp; Death Plateau leaves you none) -> the Death Plateau rocks and the troll climbing rocks -> the arena:
// beat the Troll Champion ("Dad", lvl 101) -> the troll pass -> the stronghold door -> a Troll General (lvl 113) for the
// prison key -> the prison -> pickpocket Twig for Godric's cell key -> free Godric -> out -> Dunstan: LAW TALISMAN. Every
// decision is a pure function of observable state + what the run learned from dialog text, so a relaunch resumes where
// the account stands.
//
//   LIVE  (any server, NO cheats — every staff command throws):
//     bun headless/quests-share/run-troll-stronghold.ts --live <account>
//       reads bots/<account>/bot.env. Requirements (REQUIREMENTS below): Death Plateau complete; Agility 15 (the troll
//       climbing rocks); Thieving 30 (Twig — the script kills him for the key otherwise); Prayer 43 (Protect from Melee:
//       the General hits up to 38, the driver keeps it on in all three fights — arrive with full prayer); strong melee
//       (live: 99s won both fights UNARMED with protection; str/def 75 with fists lost to Dad) — a wielded weapon helps.
//       Supplies: 12+ coins (boots), ~20 sharks (live: 8 went on the rock throwers before the stronghold door).
//   SIM   (a LOCAL engine with staff cheats):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-troll-stronghold.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Death Plateau complete (varps death_equiproom 80, death_map 8), stats (attack/strength/
//       defence/hitpoints 90, prayer 70, agility 30, thieving 40), gives + wields a rune scimitar, gives 100 coins + 20
//       sharks, teleports to Denulth (Burthorpe). Refuses a non-local host. Use a new name per run.
//   --supply   prints the supply list and exits.
import { parseMode, initWorld, loginAndRun, simSetup, finish, show, missing, waitTicks, type Item } from './share-lib.js';

const TAG = 'troll';
const SHARK = 385, COINS = 995, RUNE_SCIMITAR = 1333, LAW_TALISMAN = 1458;
export const REQUIREMENTS = {
    quests: ['Death Plateau (Denulth only starts Troll Stronghold after it)'],
    skills: {
        agility: '15 — troll climbing rocks (quest_troll.rs2 exactmove, agility 15)',
        thieving: '30 — pickpocket Twig for the cell key (lower: the script kills him instead)',
        prayer: '43 — Protect from Melee; the Troll General hits up to 38',
        melee: 'high: Dad (lvl 101, max hit 27) and a Troll General (lvl 113); live 99s won unarmed with protection',
    },
    start: 'anywhere on the mainland south of the plateau (the script walks to Denulth, Burthorpe)',
} as const;
export const SUPPLY: Item[] = [{ name: 'coins', id: COINS, n: 12 }, { name: 'shark', id: SHARK, n: 20 }];

const mode = parseMode(TAG, 'run-troll-stronghold.ts --live <account> | --sim [name] | --supply');
if (mode.kind === 'supply') { console.log(`Troll Stronghold supplies: ${show(SUPPLY)} (+ a melee weapon if you have one; full prayer)`); process.exit(0); }

const W = await initWorld();
const { TrollQuestBot, driveTrollStronghold } = await import('../quest-troll.js');
const { levelForDisplayedXp } = await import('../leanbot.js');

const bot: any = W.wire(new TrollQuestBot(), { multiLevel: false });
await loginAndRun(bot, mode, TAG);
if (mode.kind === 'sim') {
    await simSetup(bot, mode, {
        varps: { death_equiproom: 80, death_map: 8 },   // complete + map track at scouted_area (Tenzing's hut door checks it)
        stats: { attack: 90, strength: 90, defence: 90, hitpoints: 90, prayer: 70, agility: 30, thieving: 40 },
        items: [{ name: 'rune_scimitar', id: RUNE_SCIMITAR, n: 1 }, { name: 'coins', id: COINS, n: 100 }, { name: 'shark', id: SHARK, n: 20 }],
        tele: { x: 2898, z: 3528 },
    }, levelForDisplayedXp);
    const r = await bot.equipItem(RUNE_SCIMITAR);   // an ordinary wield (not a cheat)
    console.log(`[${TAG}] wield rune scimitar: ${JSON.stringify(r).slice(0, 120)}`);
    await waitTicks(bot, 2);
}
const t0 = bot.tickCount;
const m = missing(bot, SUPPLY);
if (m.length) console.warn(`[${TAG}] short of ${m.join(', ')} — the driver stops when it needs them`);
console.log(`[${TAG}] journal 'death': ${bot.questState?.('death')?.status}, 'troll': ${bot.questState?.('troll')?.status}`);

let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    ok = await driveTrollStronghold(bot, { findLongPath: W.findLongPath, timeoutMs: 45 * 60_000, tick: () => waitTicks(bot, 1), log: (s: string) => console.log(`[${TAG}] ${s}`) });
    if (!ok) console.log(`[${TAG}] attempt ${attempt} ended at ${bot.trollStage} — resuming`);
}
console.log(`[${TAG}] journal 'troll': ${bot.questState?.('troll')?.status}; law talisman x${bot.countOf(LAW_TALISMAN)}`);
await finish(bot, TAG, ok, t0, 'Troll Stronghold');

// =====================================================================================================
// quests-share/run-lost-city.ts — standalone launcher for the Lost City driver (quest-lostcity.ts).
// =====================================================================================================
// The quest logic is unchanged and cheat-free: driveLostCity() — the Warrior (Lumbridge swamp) -> Shamus
// (chop the leprechaun tree) -> knife (Lumbridge spawn) -> stash everything but the kit at Draynor bank -> monk boat to
// Entrana -> cave monk -> zombies for an axe -> the Dramen tree (Tree spirit fight, unarmed) -> branch -> carve the staff
// -> magic door (deep wilderness) -> walk home -> enter Zanaris through the Lumbridge-swamp shed with the staff worn
// (that entry completes the quest) -> back out. Every decision is a pure function of observable state, so a relaunch
// resumes from wherever the account stands. No account locks, status files or per-account
// state files.
//
//   LIVE  (any server, NO cheats — every staff command throws):
//     bun headless/quests-share/run-lost-city.ts --live <account>
//       reads bots/<account>/bot.env. Requirements (REQUIREMENTS below; the driver refuses rather than gamble):
//       Woodcutting 36, Crafting 31, any axe you can use (pack or worn), and enough melee + sharks for the UNARMED Tree
//       spirit fight (Entrana bans weapons and armour): the driver computes P(win) from your levels and sharks and refuses
//       the boat below 97% — e.g. attack/strength/defence/hitpoints 60 with 20 sharks = 99.8%, 50s need ~26 sharks.
//   SIM   (a LOCAL engine with staff cheats):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-lost-city.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Woodcutting 36, Crafting 31, attack/strength/defence/hitpoints 60, gives
//       a bronze axe + 20 sharks. Refuses a non-local host. Use a new name per run.
//   --supply   prints the supply list and exits.
//   LC_BRANCHES=<n> staves to make (default 1). The pack is BANKED at Draynor before the boat
//   (everything except knife + sharks); the driver's "restore" step (re-bank a spare staff, withdraw a pickaxe) is off.
import { parseMode, initWorld, loginAndRun, simSetup, finish, show, baseLevel, missing, waitTicks, type Item } from './share-lib.js';

const TAG = 'lostcity';
const SHARK = 385, BRONZE_AXE = 1351;
export const REQUIREMENTS = {
    quests: [],
    skills: { woodcutting: '36 — the Dramen tree refuses lower', crafting: '31 — carving the branch into a staff', melee: 'attack/strength/defence/hitpoints so P(win) >= 97% vs the Tree spirit (lvl 101) UNARMED with your sharks; ~60s + 20 sharks' },
    items: 'any axe usable at your Woodcutting level (the leprechaun tree that summons Shamus); a knife is optional (the script picks up the Lumbridge spawn)',
    start: 'anywhere on the mainland',
} as const;
export const SUPPLY: Item[] = [{ name: 'bronze_axe', id: BRONZE_AXE, n: 1 }, { name: 'shark', id: SHARK, n: 20 }];

const mode = parseMode(TAG, 'run-lost-city.ts --live <account> | --sim [name] | --supply');
if (mode.kind === 'supply') { console.log(`Lost City supplies: ${show(SUPPLY)} (any axe will do; sharks: enough for P(win) >= 97%, at least 14)`); process.exit(0); }

const W = await initWorld();
const { LostCityBot, driveLostCity, lcMeleeStats } = await import('../quest-lostcity.js');
const { spiritWinChance } = await import('../lostcity-spirit.js');
const { levelForDisplayedXp } = await import('../leanbot.js');

const bot: any = W.wire(new LostCityBot());
await loginAndRun(bot, mode, TAG);
if (mode.kind === 'sim') {
    await simSetup(bot, mode, {
        stats: { woodcutting: 36, crafting: 31, attack: 60, strength: 60, defence: 60, hitpoints: 60 },
        items: SUPPLY,
    }, levelForDisplayedXp);
}
const t0 = bot.tickCount;
const lv = (s: string) => baseLevel(bot, s, levelForDisplayedXp);
const win = spiritWinChance(lcMeleeStats(bot), bot.countOf(SHARK));
console.log(`[${TAG}] wc ${lv('woodcutting')} craft ${lv('crafting')} melee ${JSON.stringify(lcMeleeStats(bot))} sharks ${bot.countOf(SHARK)} -> Tree spirit P(win) ${win ? (win.win * 100).toFixed(1) + '% (' + win.style + ')' : '?'}; journal 'zanaris': ${bot.questState?.('zanaris')?.status}`);
const short = missing(bot, SUPPLY.filter(i => i.id === SHARK));
if (short.length) console.warn(`[${TAG}] low on sharks (${short.join(', ')}) — the driver decides from P(win) and may refuse the boat`);

const branches = Math.max(1, Number(process.env.LC_BRANCHES ?? 1) || 1);
let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    ok = await driveLostCity(bot, { timeoutMs: 120 * 60_000, tick: () => waitTicks(bot, 1), goal: { branches, restore: false }, log: (s: string) => console.log(`[${TAG}] ${s}`) });
    if (!ok && /^fail/.test(bot.lcStage)) { console.error(`[${TAG}] the driver refused: ${bot.lcFailWhy}`); break; }   // a reasoned fail will not fix itself
    if (!ok) console.log(`[${TAG}] attempt ${attempt} ended at ${bot.lcStage} — resuming`);
}
console.log(`[${TAG}] journal 'zanaris': ${bot.questState?.('zanaris')?.status}; dramen staff ${bot.isWorn?.(772) ? 'worn' : bot.countOf(772)}`);
await finish(bot, TAG, ok, t0, 'Lost City');

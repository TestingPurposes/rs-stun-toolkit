// =====================================================================================================
// quests-share/run-death-plateau.ts — standalone launcher for the Death Plateau drivers.
// =====================================================================================================
// The quest logic is cheat-free:
//   phase 1 (quest-supplies.ts, driveDpSupplies): get 10 BREAD + 10 COOKED TROUT into the pack — Gerrant (Port Sarim) fly
//           rod + feathers -> fly-fish trout at the Seers' river -> 10 bread at the Ardougne baker -> cook the trout on the
//           Burthorpe camp fire. Skipped when the pack already holds them (or the journal is green).
//   phase 2 (quest-death.ts, driveDeathPlateau): Denulth -> Saba -> Tenzing -> Dunstan -> Denulth (certificate) -> Dunstan
//           (iron bar -> spiked boots) -> Tenzing (supplies -> secret way map) -> scout the secret path; Eohric -> Harold
//           -> Eohric -> Asgarnian ale -> dice with Harold until his IOU -> read it -> five stone balls on the mechanism
//           -> Denulth with map + combination = complete. Knowledge comes from pack + dialog text (quest varps are not
//           transmitted), persisted per account so a relaunch resumes.
// Phase 1 and phase 2 are separate bot classes, so the launcher logs in twice when phase 1 runs.
//
//   LIVE  (any server, NO cheats — every staff command throws):
//     bun headless/quests-share/run-death-plateau.ts --live <account>
//       reads bots/<account>/bot.env. Requirements (REQUIREMENTS below): no quests, no levels for the quest itself.
//       Carry: an IRON BAR (no script gets one: no shop stocks it), coins (~3,500: the dice with Harold are bold-play bets
//       of up to 1,000 gp — fund >= 3,200 — plus ale 2 gp; phase 1 needs ~400 more). Phase 1 needs Fishing 20 (fly
//       fishing trout), Cooking 15 (trout; burnt ones are dropped and re-fished) and enough combat to cross White Wolf
//       Mountain (a level-3 account died there in the sim; ~40 melee, 50 defence/hitpoints walk it). Free slots: the pack must fit 10 bread
//       + 10 trout + iron bar + coins + 5 quest items (keep it otherwise empty). Knowledge persists in
//       bots/<account>/death-plateau.json. DP_SKIP_SUPPLIES=1 skips phase 1.
//   SIM   (a LOCAL engine with staff cheats):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-death-plateau.ts --sim [name] [--gather]
//       fresh account: drops the tutorial kit, gives an iron bar + 5,000 coins, teleports to Denulth (Burthorpe). Without
//       --gather it also gives the 10 bread + 10 trout (phase 1 skipped); with --gather it sets Fishing 40 / Cooking 40
//       (+ attack/strength 40, defence/hitpoints 50 for the White Wolf Mountain walk)
//       and phase 1 gathers them cheat-free. Refuses a non-local host. Use a new name per run.
//   --supply   prints the supply list and exits.
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { parseMode, initWorld, loginAndRun, simSetup, finish, show, missing, flag, sleep, type Item } from './share-lib.js';

const TAG = 'dp';
const COINS = 995, IRON_BAR = 2351, BREAD = 2309, TROUT = 333;
export const REQUIREMENTS = {
    quests: [],
    skills: { fishing: '20 — phase 1 only (fly fishing trout)', cooking: '15 — phase 1 only (trout; 99 never burns)', combat: 'phase 1 only: the walk to the Seers river crosses White Wolf Mountain (aggressive wolves); a level-3 account died there in the sim — ~40 melee / 50 defence+hitpoints walks it' },
    items: 'iron bar (Dunstan makes the spiked boots from it; not gathered), coins for the dice',
    start: 'anywhere on the mainland (phase 2 lives around Burthorpe)',
} as const;
export const SUPPLY: Item[] = [{ name: 'iron_bar', id: IRON_BAR, n: 1 }, { name: 'coins', id: COINS, n: 3500 }, { name: 'bread', id: BREAD, n: 10 }, { name: 'trout', id: TROUT, n: 10 }];

const mode = parseMode(TAG, 'run-death-plateau.ts --live <account> | --sim [name] [--gather] | --supply');
if (mode.kind === 'supply') {
    console.log(`Death Plateau supplies: ${show(SUPPLY)}\n  (bread + trout are gathered by phase 1 if missing: needs ~400 more coins, Fishing 20, Cooking 15; the iron bar is yours to bring)`);
    process.exit(0);
}
const gather = flag('--gather');
// lockstep sim: the drivers pace themselves with 600 ms sleeps (live tick length); hold each sim tick ~150 ms so a sleep
// spans a handful of ticks instead of a hundred. Override with SR_SETTLE_MS.
if (mode.kind === 'sim' && process.env.SIM_LOCKSTEP === '1') process.env.SR_SETTLE_MS ??= '150';

const W = await initWorld();
const { DeathPlateauBot, driveDeathPlateau } = await import('../quest-death.js');
const { DpKitBot, driveDpSupplies } = await import('../quest-supplies.js');
const { levelForDisplayedXp } = await import('../leanbot.js');

// knowledge store: live -> bots/<account>/death-plateau.json (resume across runs); sim -> memory (fresh accounts)
const mem: { k: any } = { k: null };
const storeFile = mode.kind === 'live' ? resolve(import.meta.dir, '../../../../bots', mode.acct, 'death-plateau.json') : '';
const store = {
    load: () => { if (!storeFile) return mem.k; try { return JSON.parse(readFileSync(storeFile, 'utf8')); } catch { return null; } },
    save: (k: any) => { if (!storeFile) { mem.k = { ...k }; return; } try { writeFileSync(storeFile, JSON.stringify(k)); } catch { /* best effort */ } },
};

const needSupplies = (b: any) => b.countOf(BREAD) < 10 || b.countOf(TROUT) < 10;
let t0 = -1, ticksBefore = 0;

// ---- phase 1: supplies (only when the pack lacks them) ----
let bot: any = W.wire(new DpKitBot());
await loginAndRun(bot, mode, TAG);
if (mode.kind === 'sim') {
    await simSetup(bot, mode, {
        stats: gather ? { fishing: 40, cooking: 40, attack: 40, strength: 40, defence: 50, hitpoints: 50 } : {},   // the Seers walk crosses White Wolf Mountain: a level-3 account died there (sim)
        items: gather ? SUPPLY.filter(i => i.id === IRON_BAR || i.id === COINS).map(i => i.id === COINS ? { ...i, n: 5000 } : i)
            : SUPPLY.map(i => i.id === COINS ? { ...i, n: 5000 } : i),
        tele: { x: 2898, z: 3528 },
    }, levelForDisplayedXp);
}
t0 = bot.tickCount;
const journal = () => bot.questState?.('death')?.status ?? 'NOT_OBSERVABLE';
console.log(`[${TAG}] journal 'death': ${journal()}; pack: bread ${bot.countOf(BREAD)} trout ${bot.countOf(TROUT)} iron bar ${bot.countOf(IRON_BAR)} coins ${bot.countOf(COINS)}`);
if (journal() === 'COMPLETE') { console.log(`[${TAG}] Death Plateau is already complete`); await finish(bot, TAG, true, t0, 'Death Plateau'); }
if (needSupplies(bot) && process.env.DP_SKIP_SUPPLIES !== '1') {
    console.log(`[${TAG}] phase 1: gathering 10 bread + 10 cooked trout`);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        ok = await driveDpSupplies(bot, { timeoutMs: 90 * 60_000, shouldStop: () => false, log: (s: string) => console.log(`[${TAG}] ${s}`) });
        if (!ok) console.log(`[${TAG}] phase 1 attempt ${attempt} ended — ${bot.status()}`);
    }
    if (!ok) await finish(bot, TAG, false, t0, 'Death Plateau phase 1 (supplies)');
    console.log(`[${TAG}] phase 1 done in ${bot.tickCount - t0} ticks`);
}
ticksBefore = bot.tickCount - t0;
try { bot.destroy(); } catch { /* gone */ }
await sleep(3000);
bot = W.wire(new DeathPlateauBot());
await loginAndRun(bot, mode, TAG);
const t1 = bot.tickCount;
const short = missing(bot, SUPPLY.filter(i => i.id !== COINS));
if (short.length) console.warn(`[${TAG}] short of ${short.join(', ')} — the driver stops with 'need' when it gets there`);
let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    ok = await driveDeathPlateau(bot, { findLongPath: W.findLongPath, timeoutMs: 60 * 60_000, shouldStop: () => false, store, log: (s: string) => console.log(`[${TAG}] ${s}`) });
    if (!ok) console.log(`[${TAG}] attempt ${attempt} ended — ${bot.status()}`);
}
console.log(`[${TAG}] journal 'death': ${bot.questState?.('death')?.status}; phase 1 ${ticksBefore} ticks, phase 2 ${bot.tickCount - t1} ticks`);
await finish(bot, TAG, ok, t1 - ticksBefore, 'Death Plateau');

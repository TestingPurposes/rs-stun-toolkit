// =====================================================================================================
// legs/g1-mining.ts — MINING 49->99 (and a 1->49 fallback) (owner: g1). LOCAL rehearsal + leg module.
// =====================================================================================================
// Method: power-mine IRON with the FLETCH CLOCK (g1-clock.ts): a roll every 3 ticks with ANY pickaxe
// (the clock replaces the pickaxe's own rate, so a bronze pickaxe from level 1 equals rune; mining
// success depends on the rock only), and rock switches of up to ~4 tiles cost nothing (the op lands at
// R+2/R+3 and rolls at R+3). Iron is `mining_rock_fast` (no p_delay on success), respawn ~20 ticks, so
// the spot needs >= 7 rocks within a few tiles for an unbroken 3-tick chain.
// Copper/tin (1->15 fallback only): `p_delay(0)` on success refuses the R+1 burst, so we burst at R+2.
//
// Preconditions: near the spot (CLI teleports). Inventory: any pickaxe (bronze is enough with the clock;
//   rune needs mining 41 to wield/use), knife, 5 logs (normal; spare clock fuel). hp 10 survived at all three spots.
// Exit state: at the spot; inventory = pickaxe, knife, logs (+ uncut gems, + <=1 ore not yet dropped).
// Supply list (demo): rune_pickaxe x1 (bronze works with the clock; rune is the fallback if the clock breaks),
//   knife x1, logs x5.
// MEASURED (local): fremmy 49->99 = 3,855 ticks, gh 49->99 = 3,951 (bronze pickaxe, fuel 5->5); varrock 1->49 = 274.
//   Travel: WC-gh spot -> gh rocks walk 62; Camelot tele -> fremmy 155 (walk from WC-gh 233). Net: a tie.
//   Rune pickaxe plain vs clock at fremmy, 400-tick bands: 55: 7.9 vs 9.5, 75: 8.2 vs 10.0, 92: 7.7 vs 9.7.
//
// CLI: LC_HOST=localhost:8888 bun headless/speedrun/legs/g1-mining.ts [spot=fremmy|gh|varrock] [from=49] [to=99] [clock=1] [maxTicks] [pick=bronze_pickaxe]

import { SpeedBot, runLeg, localSetup, objId, initNav } from '../core.js';
import * as ls from '../../loc-scene.js';
import { gather, locTarget, locPathLen, clockReady, type GatherStats, type Target } from './g1-clock.js';

export const MINE_SPOTS = {
    // 9 iron rocks at 2722-2728,3688-3696 (Fremennik coast north of Seers/Camelot; walkable, no gate)
    fremmy: { stand: { x: 2724, z: 3693 }, radius: 7 },
    // gh_kadeski's 6 rocks at 2602-2605,3233-3237 (west of Ardougne)
    gh: { stand: { x: 2604, z: 3235 }, radius: 5 },
    // Varrock SE mine: 4 iron + 15 copper/tin (1->49 fallback, ~75 tiles from Varrock teleport)
    varrock: { stand: { x: 3286, z: 3367 }, radius: 8 },
} as const;
export type MineSpot = keyof typeof MINE_SPOTS;
const GEMS = ['uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond'];

export interface MineOpts { spot?: MineSpot; lowSpot?: MineSpot; to?: number; clock?: boolean; maxTicks?: number }
export interface MineResult { ok: boolean; level: number; phases: Array<{ rock: string; from: number; to: number; stats: GatherStats }> }

export async function miningLeg(bot: SpeedBot, opts: MineOpts = {}): Promise<MineResult> {
    const to = opts.to ?? 99, clock = opts.clock ?? true;
    const nav = await initNav();
    if (clock && !clockReady(bot)) throw new Error('fletch clock needs a knife + 1 logs in the backpack');
    const end = bot.tickCount + (opts.maxTicks ?? 20_000);
    const phases: MineResult['phases'] = [];
    const lvl = () => bot.stat('mining').level;
    const drop = [objId('iron_ore'), objId('copper_ore'), objId('tin_ore'), ...GEMS.map(objId)];
    for (const ph of [{ re: /(copper|tin) ore/i, until: 15, name: 'copper/tin', spot: opts.lowSpot ?? 'varrock' }, { re: /iron ore/i, until: 99, name: 'iron', spot: opts.spot ?? 'fremmy' }]) {
        if (lvl() >= Math.min(ph.until, to)) continue;
        const spot = MINE_SPOTS[ph.spot as MineSpot];
        if (Math.max(Math.abs(bot.tile().x - spot.stand.x), Math.abs(bot.tile().z - spot.stand.z)) > 15) {
            const w = await bot.walkTo(spot.stand.x, spot.stand.z, { near: 2 });
            if (!w.ok) throw new Error(`walk to ${ph.spot} failed: ${JSON.stringify(w)}`);
        }
        const from = lvl();
        const pick = (prev: Target | null, isBad: (k: string) => boolean): Target | null => {
            if (prev && prev.alive()) return prev;
            const cands = ls.findNearbyLocs(ph.re, spot.stand.x, spot.stand.z, bot.minusedlevel, spot.radius)
                .filter(l => bot.locAlive(l) && !isBad(`${l.x},${l.z}`) && l.optionsWithIndex.some(q => /mine/i.test(q.text)));
            let best: Target | null = null, bestLen = 1e9;
            for (const l of cands) { const len = locPathLen(bot, l, nav); if (len < bestLen) { bestLen = len; best = locTarget(bot, l, /mine/i, nav); } }
            return best;
        };
        const stats = await gather(bot, {
            skill: 'mining', clock, depleteOnSuccess: 12, successDelay: ph.name === 'iron' ? 0 : 1, maxTicks: end - bot.tickCount,
            done: () => lvl() >= Math.min(ph.until, to), pick, drop,
        });
        phases.push({ rock: ph.name, from, to: lvl(), stats });
        if (bot.tickCount >= end) break;
    }
    return { ok: lvl() >= to, level: lvl(), phases };
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const spot = (process.argv[2] ?? 'fremmy') as MineSpot;
    const from = Number(process.argv[3] ?? 49), to = Number(process.argv[4] ?? 99);
    const clock = (process.argv[5] ?? '1') !== '0', maxTicks = Number(process.argv[6] ?? 20000);
    const pickaxe = process.argv[7] ?? 'bronze_pickaxe';
    const bot = await SpeedBot.create(`g1m${spot.slice(0, 2)}${Date.now() % 100000}`);
    const s = MINE_SPOTS[from < 15 ? 'varrock' : spot];
    await localSetup(bot, { clear: true, stats: { mining: from }, items: [{ name: pickaxe, n: 1 }, { name: 'knife', n: 1 }, { name: 'logs', n: 5 }], tele: s.stand });
    if (process.env.G1_CHAT) (bot as any).chatLogging = true;
    await bot.tick(2);
    const { rec } = await runLeg(bot, `g1-mining-${spot}-${from}-${to}${clock ? '-clock' : '-plain'}-${pickaxe}`, b => miningLeg(b, { spot, to, clock, maxTicks }));
    console.log(`RESULT ${JSON.stringify(rec.result)} ticks=${rec.ticks} hp=${bot.stat('hitpoints').cur}`);
    await bot.logout();
    process.exit(0);
}

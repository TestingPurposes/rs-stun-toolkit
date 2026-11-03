// =====================================================================================================
// legs/p1-common.ts — shared helpers for the p1 production legs (firemaking, crafting, smithing+magic,
// prayer+fletching). LOCAL scaffolding (stockBank) refuses to run unless LC_HOST is localhost.
// =====================================================================================================
import { SpeedBot, localSetup, objId, objDebugName, certOf, cheb, XP_RATE } from '../core.js';
import { levelForDisplayedXp } from '../../leanbot.js';

export { levelForDisplayedXp };

/** DISPLAYED xp (what UPDATE_STAT carries) needed for level L. Mirrors engine Player.ts levelExperience. */
const LEVEL_XP_DISPLAY: number[] = (() => {
    const t: number[] = [0, 0];
    let acc = 0;
    for (let i = 0; i < 98; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2.0, level / 10.0) * 300.0);
        t.push((Math.floor(acc / 4) * 10) / 10);   // t[L] = displayed xp for level L
    }
    return t;
})();
export function xpForLevel(level: number): number { return level <= 1 ? 0 : LEVEL_XP_DISPLAY[Math.min(99, level)]!; }
/** Displayed xp gained for a content `stat_advance(stat, tenths)` value (engine multiplies by XP_RATE). */
export function dispXp(tenths: number): number { return (tenths * XP_RATE) / 10; }

export const VARROCK_WEST = { booth: { x: 3186, z: 3436 }, inside: { x: 3185, z: 3436 }, door: { x: 3182, z: 3432 } };

/** Close any main modal + a short settle (used only in setup code). */
export async function closeAll(bot: SpeedBot): Promise<void> {
    if (bot.mainModalId !== -1 || bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
}

/**
 * LOCAL ONLY: stock the bank with `items` (given noted by cheat when a cert exists, then deposited) and
 * leave the backpack holding exactly `keep` (given unnoted). Must stand within ~10 tiles of a bank.
 */
export async function stockBank(bot: SpeedBot, items: Array<{ name: string; n: number }>, keep: Array<{ name: string; n: number }> = []): Promise<void> {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) throw new Error('stockBank refuses to run unless LC_HOST is localhost');
    let r = await bot.openBank();
    if (!r.ok) throw new Error(`stockBank: openBank failed ${JSON.stringify(r)}`);
    await bot.depositAll();
    // give in batches of <= 4 stacks (noted), deposit each batch
    for (let i = 0; i < items.length; i += 4) {
        const batch = items.slice(i, i + 4);
        bot.closeModal(); await bot.tick(1);
        for (const it of batch) {
            const id = objId(it.name), c = certOf(id);
            const give = c > 0 ? objDebugName(c) : objDebugName(id);
            const want = bot.count(c > 0 ? c : id) + it.n;
            for (let k = 0; k < 3 && bot.count(c > 0 ? c : id) < want; k++) {
                await bot.cheat(`give ${give} ${it.n}`);
                await bot.until(() => bot.count(c > 0 ? c : id) >= want, 3);
            }
            if (bot.count(c > 0 ? c : id) < want) throw new Error(`stockBank: give ${give} ${it.n} did not land`);
        }
        r = await bot.openBank();
        if (!r.ok) throw new Error(`stockBank: reopen failed ${JSON.stringify(r)}`);
        await bot.depositAll();
    }
    bot.closeModal(); await bot.tick(1);
    if (keep.length) await localSetup(bot, { items: keep });
    for (const it of items) {
        if (it.n <= 0) continue;
    }
}

/** Sum of a bank item after the bank was opened at least once (bankItems persists after close). */
export function bankHas(bot: SpeedBot, name: string): number { return bot.bankCount(name); }

/** Use tool (first) on target: OPHELDU obj=tool, useObj=target. Returns false if either is missing. */
export function useOn(bot: SpeedBot, tool: number, target: number, targetSlot: number): boolean {
    const ts = bot.slotOf(tool);
    if (ts < 0 || targetSlot < 0) return false;
    bot.useItemOnItem(tool, ts, target, targetSlot);
    return true;
}

/** Slots (ascending) holding obj id. */
export function slotsOf(bot: SpeedBot, id: number): number[] { return bot.inv().filter(s => s.obj === id).map(s => s.slot); }

export function fmtTicks(t: number): string { return `${t} ticks (${(t * 0.3 / 60).toFixed(1)} min @300ms)`; }

export { cheb };

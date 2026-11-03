// =====================================================================================================
// legs/p1-firemaking.ts — FIREMAKING leg (supplied logs, tinderbox, line burning at Varrock west bank)
// =====================================================================================================
//
// Engine facts this leg is built on (content/scripts/skill_firemaking/scripts/firemaking.rs2):
//  * Lighting from the pack drops the log and loops p_opobj(4) until %action_delay == map_clock, then rolls
//    stat_random(64,512) (certain from level 43). A success sets %action_delay = clock+4, so the NEXT log
//    rolls the moment the clock reaches it: 4 ticks per log is the floor, as long as the next light is
//    processed in the window T+2..T+4 after a success at T (T+1 is the push's p_delay(0) and is rejected).
//    We send it right after the T+1 update -> processed T+2 (2 ticks of slack for demo latency).
//  * A light processed later than T+4 restarts the 3-tick lead-in. Never send a second light for the same
//    log: each accepted light DROPS another log (the first one would be left under the fire).
//  * push_player moves us W, else E, else S, else N. Lines therefore run WEST.
//  * No fires inside bank zones (bank_zones.dbrow; Varrock west bank = x3180-3190, z3433-3447).
//
// Preconditions: anywhere within ~20 tiles of Varrock west bank (3185,3436), level 0. Backpack: tinderbox
//   (anything else is banked on the first visit). Bank: the logs of the ladder (see SUPPLY / supplyFor()).
//   Any firemaking level (the leg walks the log ladder from the current xp).
// Exit state: next to the Varrock west bank booth (bank closed), backpack = tinderbox only, FM = target.
//
// CLI (from server/webclient):
//   LC_HOST=localhost:8888 bun headless/speedrun/legs/p1-firemaking.ts [from=1] [to=99] [suffix]
import { SpeedBot, runLeg, localSetup, objId, cheb, initNav } from '../core.js';
import { dispXp, xpForLevel, levelForDisplayedXp, stockBank, VARROCK_WEST, fmtTicks } from './p1-common.js';

export const LOGS: Array<{ name: string; level: number; tenths: number }> = [
    { name: 'magic_logs', level: 75, tenths: 3038 },
    { name: 'yew_logs', level: 60, tenths: 2025 },
    { name: 'maple_logs', level: 45, tenths: 1350 },
    { name: 'willow_logs', level: 30, tenths: 900 },
    { name: 'oak_logs', level: 15, tenths: 600 },
    { name: 'logs', level: 1, tenths: 400 },
];

/** The deterministic log sequence from `fromXp` (displayed) to level `to` (xp per log is fixed; failed rolls only cost time). */
export function logSequence(fromXp: number, to: number): string[] {
    const seq: string[] = [];
    let xp = fromXp;
    const goal = xpForLevel(to);
    while (xp < goal) {
        const lvl = levelForDisplayedXp(xp);
        const log = LOGS.find(l => l.level <= lvl)!;
        seq.push(log.name);
        xp += dispXp(log.tenths);
    }
    return seq;
}
export function supplyFor(from: number, to: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const l of logSequence(xpForLevel(from), to)) out[l] = (out[l] ?? 0) + 1;
    return out;
}

/** Burn rows outside the Varrock west bank zone; the south door of the bank is at (3182,3432). */
const ROWS = [
    { z: 3431, xMin: 3168, xMax: 3201 },
    { z: 3430, xMin: 3171, xMax: 3210 },
    { z: 3429, xMin: 3170, xMax: 3210 },
];
const DOOR_X = 3182;

export interface FiremakingOpts { to?: number; log?: boolean }

export async function firemakingLeg(bot: SpeedBot, opts: FiremakingOpts = {}) {
    const to = opts.to ?? 99;
    const nav = await initNav();
    const TB = objId('tinderbox');
    const logIds = new Set(LOGS.map(l => objId(l.name)));
    const fmXp = () => bot.stat('firemaking').xp;
    const stats = { logs: 0, lines: 0, bankTicks: 0, walkTicks: 0, burnTicks: 0, relights: 0, cantLight: 0, failedRolls: 0 };
    const rowUse = new Map<number, number>();   // row z -> tick its last line ended

    const rowOk = (z: number, x: number) => {
        // walkable west step and no live loc (fire) on the tile
        if (bot.liveLocs.has(`0,${x},${z}`)) return false;
        const p = nav.findLongPath(0, x, z, x - 1, z, 3);
        return p.length === 1 && p[0]!.x === x - 1 && p[0]!.z === z;
    };
    const westOkCache = new Map<string, boolean>();
    const staticOk = (z: number, x: number) => {
        const k = `${x},${z}`;
        if (!westOkCache.has(k)) westOkCache.set(k, rowOk(z, x));
        return westOkCache.get(k)! && !bot.liveLocs.has(`0,${x},${z}`);
    };
    const pickLine = (n: number): { x: number; z: number } => {
        let best: { x: number; z: number; cost: number } | null = null;
        for (const r of ROWS) {
            for (let xs = r.xMin + n; xs <= r.xMax; xs++) {
                let ok = true;
                for (let i = 0; i < n && ok; i++) ok = staticOk(r.z, xs - i);
                if (!ok) continue;
                const cost = Math.abs(xs - DOOR_X) + Math.abs(xs - n + 1 - DOOR_X) + 2 * Math.abs(r.z - 3432) + (rowUse.has(r.z) ? 0 : 0);
                if (!best || cost < best.cost) best = { x: xs, z: r.z, cost };
            }
        }
        if (!best) throw new Error('no free burn line');
        return best;
    };

    while (bot.stat('firemaking').level < to) {
        // ---- bank: deposit everything but the tinderbox, withdraw the next <=27 logs of the ladder ----
        const tb0 = bot.tickCount;
        const seq = logSequence(fmXp(), to);
        const hold = Math.min(27, seq.length);
        const want: Record<string, number> = {};
        for (const l of seq.slice(0, hold)) want[l] = (want[l] ?? 0) + 1;
        const o = await bot.openBank({ radius: 30, kind: 'booth' });
        if (!o.ok) throw new Error(`openBank failed: ${JSON.stringify(o)}`);
        const sw = await bot.bankSwap(['tinderbox'], Object.entries(want).map(([obj, n]) => ({ obj, n })));
        if (!sw.ok) throw new Error(`bankSwap failed: ${JSON.stringify(sw)} want=${JSON.stringify(want)} bank=${JSON.stringify(Object.keys(want).map(k => [k, bot.bankCount(k)]))}`);
        stats.bankTicks += bot.tickCount - tb0;
        if (opts.log !== false) console.log(`[fm] bank: open ${o.ticks}t (${o.target}) swap ${sw.ticks}t`);
        // ---- walk to the line start ----
        const n = bot.inv().filter(s => logIds.has(s.obj)).length;
        const line = pickLine(n);
        bot.closeBank();
        const tw0 = bot.tickCount;
        const w = await bot.walkTo(line.x, line.z, { log: false });
        if (!w.ok) throw new Error(`walk to line failed ${JSON.stringify(w)}`);
        stats.walkTicks += bot.tickCount - tw0;
        stats.lines++;
        // ---- burn the line ----
        const tbn = bot.tickCount;
        bot.getNewChat();
        while (bot.stat('firemaking').level < to) {
            const order = LOGS.map(l => objId(l.name));
            const lvl = bot.stat('firemaking').level;
            const slot = bot.inv().filter(s => logIds.has(s.obj) && LOGS.find(l => objId(l.name) === s.obj)!.level <= lvl)
                .sort((a, b) => order.indexOf(a.obj) - order.indexOf(b.obj))[0];
            if (!slot) break;
            const xp0 = fmXp(), cnt0 = bot.count(slot.obj);
            bot.useItemOnItem(TB, bot.slotOf(TB), slot.obj, slot.slot); bot.queueFlush();
            let dropped = false, sentAt = bot.tickCount, lastRoll = bot.tickCount;
            while (true) {
                await bot.tick(1);
                if (fmXp() > xp0) break;
                if (!dropped) {
                    if (bot.count(slot.obj) < cnt0) { dropped = true; lastRoll = bot.tickCount; continue; }
                    const msgs = bot.getNewChat().map(m => m.text).join(' | ');
                    if (/can't light a fire here/i.test(msgs)) {
                        stats.cantLight++;
                        const me = bot.tile();
                        await bot.stepTo(me.x - 1, me.z);
                        bot.useItemOnItem(TB, bot.slotOf(TB), slot.obj, bot.slotOf(slot.obj)); bot.queueFlush(); sentAt = bot.tickCount;
                        continue;
                    }
                    if (bot.tickCount - sentAt >= 3) {   // light was rejected (delayed / lost): resend
                        stats.relights++;
                        bot.useItemOnItem(TB, bot.slotOf(TB), slot.obj, bot.slotOf(slot.obj)); bot.queueFlush(); sentAt = bot.tickCount;
                    }
                } else if (bot.tickCount - lastRoll >= 4) { stats.failedRolls++; lastRoll = bot.tickCount; }
                if (bot.tickCount - sentAt > 80) throw new Error('firemaking: no xp for 80 ticks');
            }
            stats.logs++;
            // success processed at T (xp seen now). T+1 = push p_delay(0): wait it out, next light lands T+2.
            await bot.tick(1);
        }
        stats.burnTicks += bot.tickCount - tbn;
        rowUse.set(line.z, bot.tickCount);
        if (opts.log !== false) console.log(`[fm] line ${stats.lines} @(${line.x},${line.z}) n=${n}: lvl ${bot.stat('firemaking').level}, t=${bot.tickCount}`);
    }
    // finish next to the bank (so the next leg starts at the booth)
    const tb1 = bot.tickCount;
    const oe = await bot.openBank({ radius: 30, kind: 'booth' });
    stats.bankTicks += bot.tickCount - tb1;
    if (opts.log !== false) console.log(`[fm] final bank: ${oe.ticks}t (${oe.target})`);
    bot.closeBank();
    await bot.tick(1);
    return { ...stats, level: bot.stat('firemaking').level };
}

// ---------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------
if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const from = Number(process.argv[2] ?? 1), to = Number(process.argv[3] ?? 99);
    const sfx = process.argv[4] ?? String(Date.now() % 100000);
    const supply = supplyFor(from, to);
    console.log(`[fm] supply ${from}->${to}: ${JSON.stringify(supply)} (${Object.values(supply).reduce((a, b) => a + b, 0)} logs)`);
    const bot = await SpeedBot.create(`p1fm${sfx}`);
    await localSetup(bot, { tele: VARROCK_WEST.inside, stats: { firemaking: from } });
    await stockBank(bot, Object.entries(supply).map(([name, n]) => ({ name, n })), [{ name: 'tinderbox', n: 1 }]);
    await bot.stepTo(VARROCK_WEST.inside.x, VARROCK_WEST.inside.z);
    await bot.tick(2);
    const { rec } = await runLeg(bot, `p1-firemaking-${from}-${to}`, b => firemakingLeg(b, { to }));
    console.log(`[fm] ${fmtTicks(rec.ticks)} result=${JSON.stringify(rec.result)}`);
    await bot.logout();
    process.exit(0);
}

// q-charge.ts — Charge spell burst, magic 80 -> 99 (speedrun: right after q-magearena hands over the god staff). LOCAL ONLY.
//
// Charge (skill_magic/scripts/spells/charge.rs2): IF_BUTTON magic:charge, no delay, no cooldown (the 2005 one is
// commented out), gate %magearena >= 8 (staff given) + CURRENT magic >= 80, 3 fire + 3 blood + 3 air per cast,
// 1,800 tenths = 180 base xp = 4,500 displayed. The script starts with if_close, so level-up pages never block it.
// All casts are written in ONE burst: the engine runs 5 successful USER_EVENT packets per tick and carries the
// rest over in order, so 163 casts take ceil(163/5) = 33 ticks with no client round trips at all.
//
// PRECONDITIONS: %magearena >= 8 (q-magearena), magic >= 80 (base and current), anywhere outside combat.
//   Pack: bloodrune >= 3n, airrune >= 3n, firerune >= 3n (n = casts; 163 from exactly 80 = 1,067,... see below),
//   or wield staff_of_fire 1387 (no fire runes) / staff_of_air 1381 (no air runes).
// EXIT STATE: same tile, magic 99, runes spent.
// SUPPLY (helper -> trainee): bloodrune 565 x489, airrune 556 x489, firerune 554 x489  (or a staff of fire
//   1387 and no fire runes: 489 blood + 489 air). Blood runes: Magic Guild store (Yanille), not Lundail.
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-charge.ts [suffix] [staff]
import { SpeedBot, runLeg, localSetup, spellCom } from '../core.js';
import { log, sendToks } from './q-lib.js';

export const XP99 = 998458;   // displayed xp for 99 on the 2^(L/10) curve (Player.ts:77-85)
export function chargeCasts(xpNow: number): number { return Math.max(0, Math.ceil((XP99 - xpNow) / 4500)); }

export async function chargeLeg(bot: SpeedBot, o: { verbose?: boolean; casts?: number } = {}): Promise<Record<string, number | boolean>> {
    bot.holdDialogs = true;
    const t0 = bot.tickCount, xp0 = bot.stat('magic').xp;
    const n = o.casts ?? chargeCasts(xp0);
    const com = spellCom('charge');
    sendToks(bot, Array.from({ length: n }, () => () => bot.ifButton(com)));
    const ok = await bot.until(() => bot.stat('magic').level >= 99, Math.ceil(n / 5) + 10);
    const m = { casts: n, ticks: bot.tickCount - t0, ok, castsDone: Math.round((bot.stat('magic').xp - xp0) / 4500) };
    if (o.verbose) log(bot, t0, `charge ${JSON.stringify(m)} magic=${JSON.stringify(bot.stat('magic'))}`);
    return m;
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const staff = process.argv[3] === 'staff';
    const bot = await SpeedBot.create(`qchg${sfx}`, { nav: false });
    bot.holdDialogs = true;
    await localSetup(bot, { clear: true, stats: { magic: 80 } });
    await bot.cheat('setvar magearena 8');
    const n = chargeCasts(bot.stat('magic').xp);
    await localSetup(bot, { items: [{ name: 'bloodrune', n: 3 * n }, { name: 'airrune', n: 3 * n }, ...(staff ? [{ name: 'staff_of_fire', n: 1 }] : [{ name: 'firerune', n: 3 * n }])] });
    if (staff) { bot.opHeld2(1387, bot.slot(1387)); bot.queueFlush(); await bot.tick(2); }
    await bot.tick(1);
    console.log(`[q-charge] magic ${JSON.stringify(bot.stat('magic'))}, ${n} casts needed, runes blood=${bot.count('bloodrune')} air=${bot.count('airrune')} fire=${bot.count('firerune')}`);
    const { rec } = await runLeg(bot, 'q-charge-80-99', b => chargeLeg(b, { verbose: true }));
    console.log(`[q-charge] ${rec.ticks} ticks ${JSON.stringify(rec.result)} left: blood=${bot.count('bloodrune')} air=${bot.count('airrune')} fire=${bot.count('firerune')}`);
    await bot.logout();
    process.exit(rec.ok ? 0 : 1);
}

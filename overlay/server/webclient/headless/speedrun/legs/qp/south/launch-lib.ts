/// <reference types="bun" />
// launch-lib.ts — the south lane's shared launcher (modes --live <account> | --sim [name] | --supply), shaped like
// legs/run-shilo.ts. Cheats are used ONLY in --sim setup (refuses a non-local LC_HOST); --live blocks every staff command.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { dropAllOf, KIT_JUNK, qp } from '../../q-lib.js';

export type Item = { name: string; n: number };
export interface QuestModule {
    QUEST: { name: string; dir: string; qp: number };
    REQUIREMENTS: { quests: string[]; qp: number; skills: Record<string, [number, string]>; start: { x: number; z: number; level: number } };
    SUPPLY: Item[];
    run: (bot: SpeedBot, o?: { log?: boolean }) => Promise<{ ok: boolean; ticks: number; msg: string }>;
}
export interface SimSetup {
    /** setvar lines for prerequisite quests, e.g. ['druidquest 4'] */
    varps?: string[];
    /** stats for the sim account (REQUIREMENTS levels are the floor; these are the proof stats) */
    stats: Record<string, number>;
    /** extra items handed over in --sim only (e.g. a weapon) and worn */
    wear?: string[];
    extra?: Item[];
    /** cheats run after the varps (e.g. a quest's own completion setup) */
    after?: (bot: SpeedBot) => Promise<void>;
}

// KEY=VAL launcher args become env vars at import time (before the run file reads its env knobs)
for (const kv of process.argv.filter(a => /^[A-Z_][A-Z0-9_]*=/.test(a))) { const i = kv.indexOf('='); process.env[kv.slice(0, i)] = kv.slice(i + 1); }

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };

export async function launch(tag: string, m: QuestModule, sim: SimSetup): Promise<void> {
    const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
    if (process.argv.includes('--supply')) {
        console.log(`${m.QUEST.name} — SUPPLY (carried in at the start): ${show(m.SUPPLY)}`);
        console.log(`requirements: quests [${m.REQUIREMENTS.quests.join(', ') || '-'}], skills ${Object.entries(m.REQUIREMENTS.skills).map(([s, [l]]) => `${s} ${l}`).join(', ') || '-'}; start (${m.REQUIREMENTS.start.x},${m.REQUIREMENTS.start.z},${m.REQUIREMENTS.start.level})`);
        process.exit(0);
    }
    const live = arg('--live'), isSim = process.argv.includes('--sim');
    if (!!live === isSim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
    if (isSim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `${tag} --live`;
    const simName = arg('--sim');
    const acct = live ?? (simName && !simName.startsWith('-') ? simName : `${tag}${Date.now() % 100000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(acct);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    const have = (i: Item) => bot.count(objId(i.name));
    if (isSim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);
        for (const v of sim.varps ?? []) { await bot.cheat(`setvar ${v}`); await bot.tick(1); }
        await localSetup(bot, { stats: sim.stats, items: [...(sim.extra ?? []), ...(sim.wear ?? []).map(n => ({ name: n, n: 1 }))] });
        if (sim.wear?.length) { bot.burst(sim.wear.map(n => objId(n)).filter(id => bot.slot(id) >= 0).map(id => () => bot.opHeld2(id, bot.slot(id)))); await bot.tick(3); }
        if (sim.after) await sim.after(bot);
        await localSetup(bot, { items: m.SUPPLY.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) });
        await bot.tick(2);
    }
    const missing = m.SUPPLY.filter(i => have(i) < i.n).map(i => `${i.name} ${have(i)}/${i.n}`);
    if (missing.length) await fin(1, `[${tag}] missing ${missing.join(', ')}`);
    const low = Object.entries(m.REQUIREMENTS.skills).filter(([s, [l]]) => !/optional/i.test(m.REQUIREMENTS.skills[s]![1]) && bot.stat(s).level < l);
    if (low.length) await fin(1, `[${tag}] too low: ${low.map(([s, [l]]) => `${s} ${bot.stat(s).level}/${l}`).join(', ')}`);
    if (isSim) { const s = m.REQUIREMENTS.start; await localSetup(bot, { tele: { x: s.x, z: s.z, level: s.level } }); await bot.tick(2); }
    console.log(`[${tag}] ${acct}: ${m.QUEST.name} start at ${JSON.stringify(bot.pos())}, qp ${qp(bot)}, stats ${Object.keys(sim.stats).map(s => `${s} ${bot.stat(s).level}`).join(' ')}`);
    // fail at once on death (a respawn far away would otherwise leave the quest code retrying in Lumbridge)
    const t0 = bot.tickCount;
    (async () => { while (!bot.disposed) { if (bot.stat('hitpoints').level > 0 && bot.stat('hitpoints').cur === 0) await fin(1, `[${tag}] DIED at ${JSON.stringify(bot.pos())} after ${bot.tickCount - t0} ticks`); await bot.tick(1); } })();
    if (process.argv.includes('--trace')) {
        process.env.QTRACE = '1';   // q-lib trace(): one line per tick
        // also echo every game message as it arrives
        let lastMsg: unknown = null;
        (async () => { while (!bot.disposed) { const all = (bot as any).getChat({ types: [0], limit: 0, includeSelf: true }) as Array<{ text: string; tick: number }>;
            let i = lastMsg === null ? 0 : all.lastIndexOf(lastMsg as any) + 1; for (; i < all.length; i++) console.log(`    msg: ${all[i]!.text}`);
            if (all.length) lastMsg = all[all.length - 1]; await bot.tick(1); } })();
    }
    const r = await m.run(bot, { log: true });
    console.log(`[${tag}] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (!r.ok) return fin(1, `[${tag}] FAILED after ${r.ticks} ticks: ${r.msg}`);
    return fin(0, `[${tag}] QUEST COMPLETE in ${r.ticks} ticks (${r.msg})`);
}

/** stats override from env (e.g. IKOV_STATS="ranged=99,hitpoints=99") on top of the defaults */
export function statsFromEnv(def: Record<string, number>, env?: string): Record<string, number> {
    const out = { ...def };
    for (const kv of (env ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); if (k && v) out[k.trim()] = +v; }
    return out;
}

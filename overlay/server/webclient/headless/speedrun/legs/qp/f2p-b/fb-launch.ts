/// <reference types="bun" />
// fb-launch.ts — the common launcher body for lane f2p-b's run-<quest>.ts files (shape of legs/run-shilo.ts):
//   --live <account>  reads bots/<account>/bot.env (k-live.ts) and sets CHEATS.blocked first: any staff command throws.
//   --sim [name]      local LC_HOST only: drops the tutorial kit, sets prerequisite varps + stats, hands over SUPPLY (+ sim
//                     extras such as a weapon), teleports to REQUIREMENTS.start, then calls run().
//   --supply          prints the supply list and exits.
// Prints "QUEST COMPLETE in <n> ticks" on success.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { dropAllOf, KIT_JUNK, qp } from '../../q-lib.js';
import { wield } from '../../run-lib.js';

export type Item = { name: string; n: number };
export interface QuestModule {
    QUEST: { name: string; dir: string; qp: number };
    REQUIREMENTS: { quests: string[]; qp: number; skills: Record<string, [number, string]>; start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number } };
    SUPPLY: Item[];
    run(bot: SpeedBot, o?: { log?: boolean }): Promise<{ ok: boolean; ticks: number; msg: string }>;
}
export interface SimSetup {
    stats?: Record<string, number>;
    /** staff commands run before the stats (prerequisite quest varps), e.g. 'setvar druidquest 4' */
    cheats?: string[];
    /** extra sim-only items (a weapon to wield, food) on top of SUPPLY */
    extra?: Item[];
    wield?: string[];
}

/** Sim stats: the launcher default, overridden by FB_SIM_STATS=skill:level,... (A/B runs). */
export function simStats(def: Record<string, number>): Record<string, number> {
    const o = { ...def };
    for (const kv of (process.env.FB_SIM_STATS ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split(':'); if (k && v) o[k] = Number(v); }
    return o;
}
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };

export async function launch(m: QuestModule, sim0: SimSetup, tag: string): Promise<void> {
    const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ') || '(nothing)';
    if (process.argv.includes('--supply')) {
        console.log(`${m.QUEST.name}: SUPPLY ${show(m.SUPPLY)}`);
        console.log(`requirements: quests [${m.REQUIREMENTS.quests.join(', ')}] qp ${m.REQUIREMENTS.qp}; ${Object.entries(m.REQUIREMENTS.skills).map(([s, [l, w]]) => `${s} ${l} (${w})`).join('; ') || 'no skills'}`);
        console.log(`start ${JSON.stringify(m.REQUIREMENTS.start)} -> end ${JSON.stringify(m.REQUIREMENTS.end)}`);
        process.exit(0);
    }
    const live = arg('--live'), sim = process.argv.includes('--sim');
    if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `run-${tag} --live`;
    const acct = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `fb${Date.now() % 100000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(acct);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    if (sim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);
        for (const c of sim0.cheats ?? []) await bot.cheat(c, 2);
        if (sim0.stats && Object.keys(sim0.stats).length) { await localSetup(bot, { stats: sim0.stats }); console.log(`[${tag}] sim stats ${JSON.stringify(sim0.stats)}`); }
        const items = [...m.SUPPLY, ...(sim0.extra ?? [])];
        const want = items.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) }));
        if (want.length) await localSetup(bot, { items: want });
        if (sim0.wield?.length) await wield(bot, sim0.wield);
        const s = m.REQUIREMENTS.start;
        await localSetup(bot, { tele: { x: s.x, z: s.z, level: s.level } });
        await bot.tick(2);
    }
    const miss = m.SUPPLY.filter(i => bot.count(objId(i.name)) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
    // FB_IGNORE_REQ=1 (sim only): run below the declared skill levels (A/B for the lowest safe stats)
    if (!(sim && process.env.FB_IGNORE_REQ === '1')) for (const [s, [l]] of Object.entries(m.REQUIREMENTS.skills)) if (bot.stat(s).level < l) miss.push(`${s} ${bot.stat(s).level}/${l}`);
    if (miss.length) await fin(1, `[${tag}] missing: ${miss.join(', ')}`);
    const qp0 = qp(bot);
    console.log(`[${tag}] ${acct}: ${m.QUEST.name} start at ${JSON.stringify(bot.pos())} qp ${qp0}`);
    let r: { ok: boolean; ticks: number; msg: string };
    try { r = await m.run(bot, { log: true }); }
    catch (e) { r = { ok: false, ticks: -1, msg: (e as Error).message }; }
    console.log(`[${tag}] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (r.ok) return fin(0, `[${tag}] QUEST COMPLETE in ${r.ticks} ticks (${m.QUEST.name}; qp ${qp0} -> ${qp(bot)}) ${r.msg}`);
    return fin(1, `[${tag}] FAILED: ${r.msg}`);
}

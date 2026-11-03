/// <reference types="bun" />
// sp-launch.ts — the common launcher body for lane spine's single-account run-<quest>.ts files (shape of legs/run-shilo.ts):
//   --live <account>  reads bots/<account>/bot.env (k-live.ts) and sets CHEATS.blocked first: any staff command throws.
//   --sim [name]      local LC_HOST only: drops the tutorial kit, sets prerequisite quest varps + qp + stats, hands over
//                     SUPPLY (+ sim extras), wields the gear, teleports to REQUIREMENTS.start, then calls run().
//   --supply          prints the supply list and exits.
// Prints "QUEST COMPLETE in <n> ticks" on success.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { dropAllOf, KIT_JUNK, qp } from '../../q-lib.js';
import { wieldAll, type Item } from './sp-lib.js';

export interface QuestModule {
    QUEST: { name: string; dir: string; qp: number };
    REQUIREMENTS: { quests: string[]; qp: number; skills: Record<string, [number, string]>; start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number } };
    SUPPLY: Item[];
    WEAR?: string[];
    run(bot: SpeedBot, o?: { log?: boolean }): Promise<{ ok: boolean; ticks: number; msg: string }>;
}
export interface SimSetup {
    stats?: Record<string, number>;
    /** staff commands run first (prerequisite quest varps), e.g. 'setvar zanaris 6' */
    cheats?: string[];
    /** extra sim-only items on top of SUPPLY */
    extra?: Item[];
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
export const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ') || '(nothing)';

/** Sim setup for one bot (shared with the two-account Hero's launcher). */
export async function simPrep(bot: SpeedBot, supply: Item[], wear: string[], sim0: SimSetup, start: { x: number; z: number; level: number }): Promise<void> {
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);
    for (const c of sim0.cheats ?? []) await bot.cheat(c, 2);
    if (sim0.stats) await localSetup(bot, { stats: sim0.stats });
    const items = [...supply, ...(sim0.extra ?? [])];
    const want = items.filter(i => bot.count(objId(i.name)) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(objId(i.name)) }));
    if (want.length) await localSetup(bot, { items: want });
    if (wear.length) await wieldAll(bot, wear);
    await localSetup(bot, { tele: { x: start.x, z: start.z, level: start.level } });
    await bot.tick(2);
}
export function missing(bot: SpeedBot, m: Pick<QuestModule, 'SUPPLY' | 'REQUIREMENTS' | 'WEAR'>): string[] {
    const miss = m.SUPPLY.filter(i => bot.count(objId(i.name)) + (bot.isWorn(objId(i.name)) ? 1 : 0) < i.n).map(i => `${i.name} ${bot.count(objId(i.name))}/${i.n}`);
    for (const [s, [l]] of Object.entries(m.REQUIREMENTS.skills)) if (bot.stat(s).level < l) miss.push(`${s} ${bot.stat(s).level}/${l}`);
    if (qp(bot) < m.REQUIREMENTS.qp) miss.push(`qp ${qp(bot)}/${m.REQUIREMENTS.qp}`);
    return miss;
}

export async function launch(m: QuestModule, sim0: SimSetup, tag: string): Promise<void> {
    if (process.argv.includes('--supply')) {
        console.log(`${m.QUEST.name}: SUPPLY ${show(m.SUPPLY)}${m.WEAR?.length ? ` | worn at the start: ${m.WEAR.join(', ')}` : ''}`);
        console.log(`requirements: quests [${m.REQUIREMENTS.quests.join(', ')}] qp ${m.REQUIREMENTS.qp}; ${Object.entries(m.REQUIREMENTS.skills).map(([s, [l, w]]) => `${s} ${l} (${w})`).join('; ') || 'no skills'}`);
        console.log(`start ${JSON.stringify(m.REQUIREMENTS.start)} -> end ${JSON.stringify(m.REQUIREMENTS.end)}`);
        process.exit(0);
    }
    const live = arg('--live'), sim = process.argv.includes('--sim');
    if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `run-${tag} --live`;
    const acct = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `sp${Date.now() % 100000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(acct);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    if (sim) await simPrep(bot, m.SUPPLY, m.WEAR ?? [], sim0, m.REQUIREMENTS.start);
    const miss = missing(bot, m);
    if (miss.length) await fin(1, `[${tag}] missing: ${miss.join(', ')}`);
    const qp0 = qp(bot);
    console.log(`[${tag}] ${acct}: ${m.QUEST.name} start at ${JSON.stringify(bot.pos())} qp ${qp0} stats ${['attack', 'strength', 'defence', 'hitpoints', 'magic', 'prayer'].map(s => `${s.slice(0, 3)} ${bot.stat(s).level}`).join(' ')}`);
    let r: { ok: boolean; ticks: number; msg: string };
    try { r = await m.run(bot, { log: true }); }
    catch (e) { r = { ok: false, ticks: -1, msg: (e as Error).message }; }
    console.log(`[${tag}] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (r.ok) return fin(0, `[${tag}] QUEST COMPLETE in ${r.ticks} ticks (${m.QUEST.name}; qp ${qp0} -> ${qp(bot)}) ${r.msg}`);
    return fin(1, `[${tag}] FAILED: ${r.msg}`);
}

// ar-launch.ts — the shared launcher body for the ardougne lane's run-<quest>.ts files (modes per QP-BUILD.md §2 and
// learnings/quest-sharing.md):
//   --live <account>  reads bots/<account>/bot.env (k-live.ts), sets CHEATS.blocked FIRST (any staff command throws),
//                     checks the pack against SUPPLY and the skills against REQUIREMENTS, then runs the quest.
//   --sim [name]      LOCAL engine only (refuses a non-local LC_HOST): drops the tutorial kit, sets the prerequisite quest
//                     varps and the sim stats, hands over SUPPLY (+ sim extras), teleports to REQUIREMENTS.start, runs.
//   --supply          prints SUPPLY and exits.
// Prints `QUEST COMPLETE in <n> ticks` on success (exit 0), `QUEST FAILED ...` otherwise (exit 1).
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { dropAllOf, KIT_JUNK, qp } from '../../q-lib.js';
import type { Item } from './ar-lib.js';

/** the webclient tsconfig carries no node types: type the bits of `process` we use */
const process = (globalThis as any).process as { argv: string[]; env: Record<string, string | undefined>; exit(code?: number): never };

export interface QuestModule {
    QUEST: { name: string; dir: string; qp: number };
    REQUIREMENTS: { quests: string[]; qp: number; skills: Record<string, [number, string]>; start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number } };
    SUPPLY: Item[];
    run(bot: SpeedBot, o?: { log?: boolean }): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }>;
}
export interface SimSetup {
    /** prerequisite quest completion: `setvar <name> <value>` cheats (sim only) */
    varps?: Array<[string, number]>;
    /** sim stats (setstat) */
    stats?: Record<string, number>;
    /** extra sim-only items beyond SUPPLY (e.g. a weapon to wield, food) */
    extra?: Item[];
    /** worn after the hand-over (sim only) */
    wield?: string[];
    /** account prefix for auto names */
    prefix: string;
}

export async function launch(q: QuestModule, sim: SimSetup): Promise<never> {
    const argv = process.argv;
    const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
    const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ') || '(nothing)';
    if (argv.includes('--supply')) {
        console.log(`${q.QUEST.name} SUPPLY: ${show(q.SUPPLY)}`);
        console.log(`requirements: quests [${q.REQUIREMENTS.quests.join(', ')}] qp ${q.REQUIREMENTS.qp}; skills ${Object.entries(q.REQUIREMENTS.skills).map(([s, [l, why]]) => `${s} ${l} (${why})`).join('; ') || '-'}`);
        console.log(`start ${JSON.stringify(q.REQUIREMENTS.start)} -> end ${JSON.stringify(q.REQUIREMENTS.end)}`);
        process.exit(0);
    }
    const live = arg('--live'), isSim = argv.includes('--sim');
    if (!!live === isSim) { console.error('use exactly one of --live <account> | --sim [name] | --supply'); process.exit(2); }
    const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
    if (isSim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `run ${q.QUEST.dir} --live`;
    const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `${sim.prefix}${Date.now() % 100000}`;
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<never> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } return process.exit(code); };
    const have = (i: Item) => bot.count(objId(i.name));
    if (isSim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);
        for (const [v, n] of sim.varps ?? []) { await bot.cheat(`setvar ${v} ${n}`); await bot.tick(1); }
        await localSetup(bot, { stats: sim.stats ?? {} });
        const all = [...q.SUPPLY, ...(sim.extra ?? [])];
        await localSetup(bot, { items: all.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) });
        await bot.tick(2);
        if (sim.wield?.length) {
            bot.burst(sim.wield.map(n => () => bot.opHeld2(objId(n), bot.slot(n))));
            await bot.until(() => sim.wield!.every(n => bot.isWorn(objId(n))), 6);
        }
        const s = q.REQUIREMENTS.start;
        await localSetup(bot, { tele: { x: s.x, z: s.z, level: s.level } });
        await bot.tick(2);
    }
    const miss = q.SUPPLY.filter(i => have(i) < i.n).map(i => `${i.name} ${have(i)}/${i.n}`);
    if (miss.length) await fin(1, `QUEST FAILED: missing ${miss.join(', ')}`);
    const low = Object.entries(q.REQUIREMENTS.skills).filter(([s, [l]]) => bot.stat(s).level < l);
    if (low.length) await fin(1, `QUEST FAILED: skills too low: ${low.map(([s, [l]]) => `${s} ${bot.stat(s).level}/${l}`).join(', ')}`);
    console.log(`[${q.QUEST.dir}] ${bot.loginUser}: start at ${JSON.stringify(bot.pos())}, qp ${qp(bot)}, pack ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    const t0 = bot.tickCount;
    const r = await q.run(bot, { log: true });
    console.log(`[${q.QUEST.dir}] marks ${JSON.stringify(r.marks ?? {})}`);
    console.log(`[${q.QUEST.dir}] pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    if (!r.ok) await fin(1, `QUEST FAILED after ${bot.tickCount - t0} ticks: ${r.msg}`);
    return await fin(0, `QUEST COMPLETE in ${r.ticks} ticks (${q.QUEST.name}; ${r.msg})`);
}

// launch-lib.ts — the troll lane's shared launcher (the run-shilo.ts shape): --live <account> | --sim [name] | --supply.
//   --live: reads bots/<account>/bot.env via k-live.ts, sets CHEATS.blocked first (every staff command throws).
//   --sim:  refuses a non-local LC_HOST; drops the tutorial kit, sets prerequisite quest varps and stats, hands over the
//           SUPPLY (+ sim-only gear), wields, teleports to the start, then calls run(). This file is the ONLY cheat path.
//   --supply: prints the supply list and exits.
// Prints `QUEST COMPLETE in <n> ticks` on success (exit 0), else the failure (exit 1).
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { dropAllOf, KIT_JUNK, qp } from '../../q-lib.js';
import { wield } from '../../run-lib.js';
import { type Item, packStr } from './lib-troll.js';

export interface QuestModule {
    QUEST: { name: string; dir: string; qp: number };
    REQUIREMENTS: { quests: string[]; qp: number; skills: Record<string, [number, string]>; start: { x: number; z: number; level: number }; end: { x: number; z: number; level: number } };
    SUPPLY: Item[];
    run: (bot: SpeedBot, o?: { log?: boolean }) => Promise<{ ok: boolean; ticks: number; msg: string }>;
}
export interface SimSpec {
    /** prerequisite quest varps (name -> value), set in order */
    varps?: Array<[string, number]>;
    stats?: Record<string, number>;
    /** sim-only extras handed over on top of SUPPLY (gear the route would carry) */
    extra?: Item[];
    wield?: string[];
    /** override REQUIREMENTS.start for the sim teleport */
    start?: { x: number; z: number; level?: number };
    /** items the route keeps in the BANK for a mid-quest withdrawal (given, then deposited at Falador west bank) */
    bank?: Item[];
    prefix: string;
}

export async function launch(m: QuestModule, sim: SimSpec): Promise<void> {
    const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
    const show = (l: Item[]) => l.map(i => `${i.name} x${i.n}`).join(', ');
    if (process.argv.includes('--supply')) {
        console.log(`${m.QUEST.name} SUPPLY: ${show(m.SUPPLY) || '(none)'}`);
        console.log(`requirements: quests [${m.REQUIREMENTS.quests.join(', ')}], qp ${m.REQUIREMENTS.qp}, skills ${Object.entries(m.REQUIREMENTS.skills).map(([s, [l, why]]) => `${s} ${l} (${why})`).join('; ') || '-'}`);
        console.log(`start ${JSON.stringify(m.REQUIREMENTS.start)} -> end ${JSON.stringify(m.REQUIREMENTS.end)}`);
        process.exit(0);
    }
    const live = arg('--live'), isSim = process.argv.includes('--sim');
    if (!!live === isSim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
    if (isSim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
    if (live) CHEATS.blocked = `${m.QUEST.dir} --live`;
    const name = live ?? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `${sim.prefix}${Date.now() % 100000}`);
    const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(name);
    await bot.tick(3);
    const fin = async (code: number, s: string): Promise<void> => { console.log(s); try { await bot.logout(); } catch { /* gone */ } process.exit(code); };
    if (isSim) {
        dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(3);
        if (bot.inv().length) await localSetup(bot, { clear: true });   // an empty pack before the hand-over (a full one dropped supplies once)
        if (sim.bank?.length) {
            await localSetup(bot, { items: sim.bank, tele: { x: 2946, z: 3370 } });
            const ob = await bot.openBank({ radius: 10 });
            if (!ob.ok) throw new Error(`sim bank setup: ${ob.message ?? ''}`);
            await bot.depositAll([]); bot.closeBank(); await bot.tick(2);
        }
        for (const [v, val] of sim.varps ?? []) { await bot.cheat(`setvar ${v} ${val}`); await bot.tick(1); }
        if (sim.stats) await localSetup(bot, { stats: sim.stats });
        const all: Item[] = [];
        for (const i of [...m.SUPPLY, ...(sim.extra ?? [])]) { const e = all.find(a => a.name === i.name); if (e) e.n += i.n; else all.push({ ...i }); }
        const have = (i: Item) => bot.count(objId(i.name)) + (bot.isWorn(objId(i.name)) ? 1 : 0);
        // gear to wear first (it then takes no pack slot), then the rest in batches
        const wearFirst = all.filter(i => sim.wield?.includes(i.name)), rest = all.filter(i => !sim.wield?.includes(i.name));
        if (wearFirst.length) { await localSetup(bot, { items: wearFirst.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) }); await wield(bot, sim.wield!); }
        for (let k = 0; k < rest.length; k += 6) await localSetup(bot, { items: rest.slice(k, k + 6).filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) })) });
        if (sim.wield?.length) await wield(bot, sim.wield);
        const st = sim.start ?? m.REQUIREMENTS.start;
        await localSetup(bot, { tele: { x: st.x, z: st.z, level: st.level ?? 0 } });
        await bot.tick(2);
    }
    const held = (i: Item) => bot.count(objId(i.name)) + (bot.isWorn(objId(i.name)) ? 1 : 0);   // worn gear counts
    const missing = m.SUPPLY.filter(i => held(i) < i.n).map(i => `${i.name} ${held(i)}/${i.n}`);
    if (missing.length) await fin(1, `[${m.QUEST.dir}] missing supply: ${missing.join(', ')}`);
    const low = Object.entries(m.REQUIREMENTS.skills).filter(([s, [l]]) => bot.stat(s).level < l).map(([s, [l]]) => `${s} ${bot.stat(s).level}/${l}`);
    if (low.length) await fin(1, `[${m.QUEST.dir}] skills too low: ${low.join(', ')}`);
    console.log(`[${m.QUEST.dir}] ${name}: start ${JSON.stringify(bot.pos())} qp ${qp(bot)} pack: ${packStr(bot)}`);
    const qp0 = qp(bot), t0 = bot.tickCount;
    let r: { ok: boolean; ticks: number; msg: string };
    try { r = await m.run(bot, { log: true }); }
    catch (e) { r = { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    console.log(`[${m.QUEST.dir}] pack: ${packStr(bot)} | qp ${qp0} -> ${qp(bot)} | ${JSON.stringify(bot.pos())}`);
    if (!r.ok) await fin(1, `[${m.QUEST.dir}] FAILED after ${r.ticks} ticks: ${r.msg}`);
    await fin(0, `[${m.QUEST.dir}] QUEST COMPLETE in ${r.ticks} ticks (${m.QUEST.name}: ${r.msg})`);
}
export { objDebugName };

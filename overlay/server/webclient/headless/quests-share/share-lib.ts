// quests-share/share-lib.ts — the shared harness for the standalone LeanBot quest launchers (run-*.ts in this folder).
//
// It does the minimum a single account needs:
//   - modes: --live <account> (bots/<account>/bot.env, every staff command throws), --sim [name] (a LOCAL engine only;
//     staff cheats allowed for the setup), --supply (print the supply list and exit);
//   - the planners (navgrid road planner with an rsmod fallback, the multi-level
//     ladder planner, the door tracker);
//   - login, tutorial skip (LeanBot does it on its own), the run loop, and a tick-accurate wait.
// Nothing here is quest logic. Cheats exist only in simSetup(), and simSetup() refuses unless the mode is --sim on a
// local LC_HOST.
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export type Mode = { kind: 'live'; acct: string } | { kind: 'sim'; name: string } | { kind: 'supply' };
export interface Item { name: string; id: number; n: number }
export const show = (l: readonly Item[]) => l.length ? l.map(i => `${i.name} x${i.n}`).join(', ') : '(nothing)';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
export const flag = (k: string) => process.argv.includes(k);
export const LOCAL = () => /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');

/** Parse the mode. Must run BEFORE the LeanBot modules are imported: leanclient reads LC_HOST at import time. */
export function parseMode(tag: string, usage: string): Mode {
    if (flag('--supply')) return { kind: 'supply' };
    const live = arg('--live'), sim = flag('--sim');
    if (!!live === sim) { console.error(`usage: ${usage}`); process.exit(2); }
    if (live) {
        const env = readBotEnv(live);
        if (!process.env.LC_HOST && env.server) process.env.LC_HOST = env.server;
        liveCreds = env;
        return { kind: 'live', acct: live };
    }
    if (!LOCAL()) { console.error(`[${tag}] --sim needs a local engine: LC_HOST=localhost:<port> (it uses staff cheats)`); process.exit(2); }
    const n = arg('--sim');
    return { kind: 'sim', name: n && !n.startsWith('-') ? n : `${tag.slice(0, 4)}${Date.now() % 100000}` };
}

let liveCreds: { user: string; pass: string; server?: string } | null = null;
/** bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER), relative to the repo root; RUN_BOTS_DIR/<account>/bot.env when
 *  RUN_BOTS_DIR is set (the run-route --live credential dir, shared with core.ts passwordOf and k-live readBotEnv). */
export function readBotEnv(acct: string): { user: string; pass: string; server?: string } {
    const p = process.env.RUN_BOTS_DIR ? resolve(process.env.RUN_BOTS_DIR, acct, 'bot.env') : resolve(import.meta.dir, '../../../../bots', acct, 'bot.env');
    if (!existsSync(p)) { console.error(`no ${p} (create the bot first: bun bots/create-bot.ts ${acct})`); process.exit(2); }
    const kv: Record<string, string> = {};
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m) kv[m[1]!] = m[2]!; }
    if (!kv.PASSWORD) { console.error(`no PASSWORD in ${p}`); process.exit(2); }
    return { user: kv.BOT_USERNAME || acct, pass: kv.PASSWORD, server: kv.SERVER };
}

export async function initWorld() {
    const { initPathfinding, blockDoor, findLongPath } = await import('../../../../sdk/pathfinding');
    initPathfinding();
    const { applyBlockedEdges } = await import('../blocked-edges.js');
    applyBlockedEdges(blockDoor);
    blockDoor(0, 3046, 9756);   // the mining-guild door: refuses a low-level miner, never route through it
    const navgrid = await import('../../../../sdk/navgrid/index.ts');
    navgrid.init();
    const locScene = await import('../loc-scene.js'); locScene.init();
    const npcScene = await import('../npc-scene.js'); npcScene.init();
    const { planMultiLevel } = await import('../../../../sdk/navgrid/levels.js');
    // the route planner: navgrid road planner; rsmod for underground and short legs
    const DANGER = [{ x: 3134, z: 3251, radius: 12, cost: 400 }, { x: 3220, z: 3220, radius: 18, cost: 400 }, { x: 2860, z: 3480, radius: 30, cost: 400 }];
    const cache = new Map<string, { x: number; z: number }[]>();
    const navFindPath = (level: number, sx: number, sz: number, dx: number, dz: number): { x: number; z: number }[] => {
        const key = `${sx},${sz},${dx},${dz}`;
        const hit = cache.get(key); if (hit) return hit;
        try {
            for (const arrive of [0, 2, 4]) {
                const r = navgrid.planRoute(sx, sz, dx, dz, { level, roadPreference: 1, clearanceWeight: 1, danger: DANGER as any, arrive, maxExpansions: 600_000 });
                if (r) { const w = r.waypoints.map(p => ({ x: p.x, z: p.z })); cache.set(key, w); return w; }
            }
            if (dz > 6000 || sz > 6000 || Math.max(Math.abs(dx - sx), Math.abs(dz - sz)) <= 40) {
                const raw = findLongPath(level, sx, sz, dx, dz);
                if (raw.length) { const w = raw.map(p => ({ x: p.x, z: p.z })); cache.set(key, w); return w; }
            }
            return [];   // never cache a failure
        } catch { return []; }
    };
    const rawFindLongPath = (level: number, sx: number, sz: number, dx: number, dz: number) => findLongPath(level, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z }));
    return {
        navFindPath, rawFindLongPath, findLongPath: findLongPath as any,
        wire(b: any, o: { multiLevel?: boolean; doors?: boolean } = {}) {
            b.findLongPathFn = navFindPath; b.quiet = true;
            if (o.multiLevel !== false) b.multiLevelPlanFn = (from: any, to: any, opt?: any) => planMultiLevel(from, to, opt) as any;
            if (o.doors !== false) b.enableDoorTracker?.();
            return b;
        },
    };
}

const TUTORIAL = (t: { x: number; z: number }) => t.x >= 3040 && t.x <= 3140 && t.z >= 3040 && t.z <= 3140;

/** Log a wired bot in and start its loop; resolves once the pack is decoded and the account is off tutorial island.
 *  --live: the bot.env password, and every staff command throws from here on. --sim: password 'x' (local engine). */
export async function loginAndRun(bot: any, mode: Mode, tag: string): Promise<void> {
    if (mode.kind === 'supply') throw new Error('loginAndRun in --supply mode');
    if (mode.kind === 'live') bot.sendCheat = (cmd: string) => { throw new Error(`[${tag}] --live: staff command refused (${cmd})`); };
    const user = mode.kind === 'live' ? liveCreds!.user : mode.name, pass = mode.kind === 'live' ? liveCreds!.pass : 'x';
    let ok = false;
    for (let attempt = 1; attempt <= 6 && !ok; attempt++) {
        ok = await bot.login(user, pass);
        if (!ok) { console.error(`[${tag}] login attempt ${attempt} failed (${bot.lastDropReason ?? 'no reason'}) — retrying in 10 s`); await sleep(10_000); }
    }
    if (!ok) { console.error(`[${tag}] login failed`); process.exit(1); }
    bot.run(Number.MAX_SAFE_INTEGER).catch((e: any) => console.error(`[${tag}] run ended: ${e?.message}`));
    const t0 = Date.now();
    while (Date.now() - t0 < 5 * 60_000 && (!bot.backpack() || (bot.tile().x === 0 && bot.tile().z === 0) || TUTORIAL(bot.tile()))) await sleep(300);
    if (TUTORIAL(bot.tile())) { console.error(`[${tag}] still on tutorial island after 5 min`); process.exit(1); }
    await waitTicks(bot, 5);   // the login burst: stats, journal colours, worn items
    console.log(`[${tag}] ${user} logged in @ (${bot.tile().x},${bot.tile().z}) — tick ${bot.tickCount}`);
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Wait n SERVER ticks (resolved by the decode loop: exact in a lockstep sim and live). */
export async function waitTicks(bot: any, n: number): Promise<void> { for (let i = 0; i < n && !bot.disposed; i++) await bot.sendWait(1); }
async function until(bot: any, pred: () => boolean, ticks: number): Promise<boolean> {
    for (let i = 0; i < ticks && !pred(); i++) await waitTicks(bot, 1);
    return pred();
}

export const SKILL: Record<string, number> = {
    attack: 0, defence: 1, strength: 2, hitpoints: 3, ranged: 4, prayer: 5, magic: 6, cooking: 7, woodcutting: 8, fletching: 9,
    fishing: 10, firemaking: 11, crafting: 12, smithing: 13, mining: 14, herblore: 15, agility: 16, thieving: 17, slayer: 18, runecraft: 20,
};
/** Base level of a skill, from xp (the boosted/drained level is statLevel). */
export function baseLevel(bot: any, skill: string, levelForDisplayedXp: (xp: number) => number): number {
    const xp = bot.statXp?.[SKILL[skill]!] ?? 0; return Math.max(1, levelForDisplayedXp(xp));
}

/**
 * --sim ONLY: staff-cheat setup of a fresh account. Drops the whole tutorial kit first, then quest varps, stats, items,
 * position. Throws in --live or on a non-local host. The quest code itself never calls this.
 */
export async function simSetup(bot: any, mode: Mode, s: {
    varps?: Record<string, number>; stats?: Record<string, number>; items?: readonly Item[]; tele?: { x: number; z: number; level?: number }; keepPack?: boolean;
}, levelForDisplayedXp: (xp: number) => number): Promise<void> {
    if (mode.kind !== 'sim' || !LOCAL()) throw new Error('simSetup refused: --sim on a local LC_HOST only');
    const cheat = async (c: string) => { bot.sendCheat(c); await waitTicks(bot, 1); };
    if (!s.keepPack) {
        for (let k = 0; k < 4 && bot.backpackSlots().length; k++) { for (const it of bot.backpackSlots()) bot.dropItem(it.obj, it.slot); await waitTicks(bot, 2); }
        if (bot.backpackSlots().length) console.warn(`[sim] pack still holds ${bot.backpackSlots().length} slot(s) after the kit drop`);
    }
    for (const [v, val] of Object.entries(s.varps ?? {})) await cheat(`setvar ${v} ${val}`);
    for (const [skill, lvl] of Object.entries(s.stats ?? {})) {
        for (let k = 0; k < 3 && baseLevel(bot, skill, levelForDisplayedXp) !== lvl; k++) { await cheat(`setstat ${skill} ${lvl}`); await until(bot, () => baseLevel(bot, skill, levelForDisplayedXp) === lvl, 3); }
        if (baseLevel(bot, skill, levelForDisplayedXp) !== lvl) console.warn(`[sim] setstat ${skill} ${lvl}: level reads ${baseLevel(bot, skill, levelForDisplayedXp)}`);
    }
    for (const it of s.items ?? []) {
        const want = bot.countOf(it.id) + it.n;
        for (let k = 0; k < 3 && bot.countOf(it.id) < want; k++) { await cheat(`give ${it.name} ${it.n}`); await until(bot, () => bot.countOf(it.id) >= want, 3); }
        if (bot.countOf(it.id) < want) throw new Error(`[sim] give ${it.name} ${it.n} did not land (${bot.countOf(it.id)}/${want})`);
    }
    if (s.tele) {
        const { x, z } = s.tele, l = s.tele.level ?? 0;
        for (let k = 0; k < 3 && (bot.tile().x !== x || bot.tile().z !== z); k++) { await cheat(`tele ${l},${x >> 6},${z >> 6},${x & 63},${z & 63}`); await until(bot, () => bot.tile().x === x && bot.tile().z === z, 4); }
    }
    await waitTicks(bot, 2);
}

/** Items short of a list (pack only). */
export const missing = (bot: any, l: readonly Item[]) => l.filter(i => bot.countOf(i.id) < i.n).map(i => `${i.name} ${bot.countOf(i.id)}/${i.n}`);

/** End of a run: report and exit (closing the socket logs the account out). */
export async function finish(bot: any, tag: string, ok: boolean, t0: number, what: string): Promise<never> {
    console.log(ok ? `[${tag}] ${what} COMPLETE in ${bot.tickCount - t0} ticks @ (${bot.tile().x},${bot.tile().z})` : `[${tag}] ${what} FAILED after ${bot.tickCount - t0} ticks @ (${bot.tile().x},${bot.tile().z})`);
    await waitTicks(bot, 3);
    try { bot.destroy?.(); } catch { /* gone */ }
    process.exit(ok ? 0 : 1);
}

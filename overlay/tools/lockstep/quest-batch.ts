#!/usr/bin/env bun
// quest-batch.ts: run one quest launcher N times on K local lockstep engines and report pass rate and tick spread.
//
//   bun tools/lockstep/quest-batch.ts <run-<quest>.ts> [--runs N] [--instances K] [--seed S] [--chaos] [--crowd]
//                                     [--det] [--fast] [--tag xx] [--first F] [--keep] [-- <extra launcher args>]
//
//   --runs N       lanes to run (default 4)          --instances K   engines to start, 1..10 (default min(runs, 4))
//   --seed S       lane i gets SIM_SEED=S+i on a freshly started engine: re-running with the same S replays the same
//                  world rolls, so a failure can be reproduced and an A/B of a code change compares like with like
//   --chaos        every realism switch on (see sim-engine.ts CHAOS): proof batches should always run with it
//   --det          SIM_DET=1 (reproducible-seed mode, use with --seed)     --fast   SIM_FAST=1 (same world, faster)
//   --tag xx       1-3 letters for the lane account names (run<tag><nn>t); default: random
//   --first F      use engine instances F..F+K-1 (default 0), e.g. when instances 0 and 1 are already running
//   --keep         leave the engines running at the end
//
// One lane per engine at a time (lanes in one world compete for the same npcs, rocks and doors). Logs go to
// logs/sim/<lane>.log and logs/sim/engine<N>.log under the checkout root. Result table: lane, seed, pass/fail, ticks.
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { engineEnv, webPort, ENGINE_DIR } from './sim-engine.ts';

const a = process.argv.slice(2);
if (!a.length || a.includes('--help')) { console.log(readFileSync(import.meta.path, 'utf8').split('\n').slice(1, 18).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(a.length ? 0 : 2); }
const dd = a.indexOf('--');
const extra = dd >= 0 ? a.slice(dd + 1) : [];
const own = dd >= 0 ? a.slice(0, dd) : a;
const VALUED = ['--runs', '--instances', '--seed', '--tag', '--first'];
const opt = (f: string) => { const i = own.indexOf(f); return i >= 0 ? own[i + 1] : undefined; };
const launcher = own.find((x, i) => !x.startsWith('--') && !VALUED.includes(own[i - 1] ?? ''));
if (!launcher || !existsSync(launcher)) { console.error(`no launcher: ${launcher ?? '(none)'}`); process.exit(2); }
const RUNS = Number(opt('--runs') ?? 4);
const FIRST = Math.max(0, Math.min(9, Number(opt('--first') ?? 0)));
const K = Math.max(1, Math.min(10 - FIRST, Number(opt('--instances') ?? Math.min(RUNS, 4))));
const SEED = opt('--seed') !== undefined ? Number(opt('--seed')) : undefined;
const TAG = (opt('--tag') ?? Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 3)).slice(0, 3);
const flags = { chaos: own.includes('--chaos'), crowd: own.includes('--crowd'), det: own.includes('--det'), fast: own.includes('--fast') };
const ROOT = join(import.meta.dir, '..', '..');
const LOGS = join(ROOT, 'logs', 'sim');
mkdirSync(LOGS, { recursive: true });
const WEBCLIENT = join(ROOT, 'server', 'webclient');

const engines = new Map<number, ChildProcess>();
async function startEngine(n: number, seed?: number): Promise<void> {
    await stopEngine(n);
    const log = join(LOGS, `engine${n}.log`);
    const out = createWriteStream(log);
    const p = spawn('bun', ['run', 'src/app.ts'], { cwd: ENGINE_DIR, env: { ...process.env, ...engineEnv({ instance: n, seed, ...flags }) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    const onData = (b: Buffer) => { out.write(b); if (!ready && b.toString().includes('World ready')) ready = true; };
    p.stdout!.on('data', onData); p.stderr!.on('data', onData);
    engines.set(n, p);
    const t0 = Date.now();
    while (!ready) {
        if (p.exitCode !== null) throw new Error(`engine ${n} exited (${p.exitCode}); see ${log}`);
        if (Date.now() - t0 > 15 * 60_000) throw new Error(`engine ${n} not ready after 15 min; see ${log}`);
        await Bun.sleep(500);
    }
}
async function stopEngine(n: number) {
    const p = engines.get(n);
    if (!p || p.exitCode !== null) return;
    p.kill('SIGTERM');
    for (let i = 0; i < 40 && p.exitCode === null; i++) await Bun.sleep(250);
    if (p.exitCode === null) p.kill('SIGKILL');
    engines.delete(n);
}
type Res = { lane: string; seed?: number; ok: boolean; ticks: number | null; code: number | null; secs: number };
function runLane(n: number, lane: string): Promise<Res & { code: number | null }> {
    const t0 = Date.now();
    return new Promise(res => {
        const out = createWriteStream(join(LOGS, `${lane}.log`));
        const env = { ...process.env, SIM_LOCKSTEP: '1', LC_HOST: `localhost:${webPort(n)}`, TELEMETRY: 'false' };
        const p = spawn('bun', [resolve(launcher!), '--sim', lane, ...extra], { cwd: WEBCLIENT, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let tail = '';
        const onData = (b: Buffer) => { out.write(b); tail = (tail + b.toString()).slice(-4000); };
        p.stdout!.on('data', onData); p.stderr!.on('data', onData);
        p.on('exit', code => {
            out.end();
            const m = [...tail.matchAll(/(\d[\d,]*)\s*(?:ticks|t)\b/g)].pop();
            res({ lane, ok: code === 0, ticks: m ? Number(m[1].replace(/,/g, '')) : null, code, secs: Math.round((Date.now() - t0) / 1000) });
        });
    });
}

const lanes = Array.from({ length: RUNS }, (_, i) => ({ i, lane: `run${TAG}${String(i).padStart(2, '0')}t`, seed: SEED !== undefined ? SEED + i : undefined }));
console.log(`[batch] ${launcher}: ${RUNS} lane(s) on ${K} engine(s)${SEED !== undefined ? `, seeds ${SEED}..${SEED + RUNS - 1}` : ''}${flags.chaos ? ', CHAOS' : ''}${flags.det ? ', SIM_DET' : ''}${flags.fast ? ', SIM_FAST' : ''}; logs in ${LOGS}`);
const results: Res[] = [];
const stopAll = async () => { if (!own.includes('--keep')) for (const n of [...engines.keys()]) await stopEngine(n); };
process.on('SIGINT', async () => { await stopAll(); process.exit(130); });
try {
    // seeded lanes need a fresh world each (the seed is an engine setting); unseeded lanes reuse their engine
    if (SEED === undefined) { for (let n = FIRST; n < FIRST + K; n++) await startEngine(n); }   // one by one: the first start may build the cache
    const queue = [...lanes];
    await Promise.all(Array.from({ length: K }, async (_, k) => {
        const n = FIRST + k;
        for (let l = queue.shift(); l; l = queue.shift()) {
            if (l.seed !== undefined) await startEngine(n, l.seed);
            const r = await runLane(n, l.lane);
            r.seed = l.seed;
            results.push(r);
            console.log(`[batch] ${r.lane}${r.seed !== undefined ? ` seed ${r.seed}` : ''}: ${r.ok ? 'PASS' : `FAIL (exit ${r.code})`}${r.ticks !== null ? ` ${r.ticks} t` : ''} in ${r.secs}s`);
        }
    }));
} finally { await stopAll(); }

const ok = results.filter(r => r.ok), t = ok.map(r => r.ticks).filter((x): x is number => x !== null).sort((x, y) => x - y);
console.log('\nlane         seed   result  ticks   wall');
for (const r of results.sort((x, y) => x.lane.localeCompare(y.lane))) console.log(`${r.lane.padEnd(12)} ${String(r.seed ?? '-').padStart(5)}  ${r.ok ? 'PASS' : 'FAIL'}   ${String(r.ticks ?? '-').padStart(6)}  ${r.secs}s`);
console.log(`\n${ok.length}/${results.length} passed` + (t.length ? `; ticks min ${t[0]}, median ${t[Math.floor(t.length / 2)]}, max ${t[t.length - 1]}` : ''));
process.exit(ok.length === results.length ? 0 : 1);

#!/usr/bin/env bun
// run-sim.ts: run one quest launcher in --sim mode against a local sim engine (tools/lockstep/sim-engine.ts).
//
//   bun tools/lockstep/run-sim.ts <run-<quest>.ts> [--instance N] [--name <account>] [-- <extra launcher args>]
//
// Sets SIM_LOCKSTEP=1 and LC_HOST=localhost:<web port of instance N> (unless already set), and passes
// `--sim <account>`. The default account name is run<5 digits>t: a fresh account each time (12 characters at most;
// names starting "run" and ending "t" are the ones the engine's chaos switches and SIM_SEED anchor target by default).
// Exit code = the launcher's (0 = quest complete).
import { spawnSync } from 'child_process';
import { resolve, join } from 'path';
import { webPort } from './sim-engine.ts';

const a = process.argv.slice(2);
const dd = a.indexOf('--');
const extra = dd >= 0 ? a.slice(dd + 1) : [];
const own = dd >= 0 ? a.slice(0, dd) : a;
const opt = (f: string) => { const i = own.indexOf(f); return i >= 0 ? own[i + 1] : undefined; };
const launcher = own.find((x, i) => !x.startsWith('--') && !['--instance', '--name'].includes(own[i - 1] ?? ''));
if (!launcher || own.includes('--help')) { console.log('usage: bun tools/lockstep/run-sim.ts <run-<quest>.ts> [--instance N] [--name <account>] [-- <launcher args>]'); process.exit(launcher ? 0 : 2); }
const instance = Number(opt('--instance') ?? 0);
const name = opt('--name') ?? `run${String(Date.now() % 100000).padStart(5, '0')}t`;
if (name.length > 12) { console.error('account names are at most 12 characters'); process.exit(2); }
const env = { ...process.env, SIM_LOCKSTEP: process.env.SIM_LOCKSTEP ?? '1', LC_HOST: process.env.LC_HOST ?? `localhost:${webPort(instance)}`, TELEMETRY: process.env.TELEMETRY ?? 'false' };
console.log(`[run-sim] ${launcher} --sim ${name}  (LC_HOST=${env.LC_HOST}, SIM_LOCKSTEP=${env.SIM_LOCKSTEP})`);
const r = spawnSync('bun', [resolve(launcher), '--sim', name, ...extra], { cwd: join(import.meta.dir, '..', '..', 'server', 'webclient'), env, stdio: 'inherit' });
process.exit(r.status ?? 1);

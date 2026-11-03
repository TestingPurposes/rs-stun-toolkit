#!/usr/bin/env bun
// sim-engine.ts: start a local rev-289 engine as an offline simulator (foreground; Ctrl+C stops it).
//
//   bun tools/lockstep/sim-engine.ts [--instance N] [--seed S] [--det] [--fast] [--chaos] [--crowd] [--realtime]
//
//   --instance N   ports of instance N: web 8892 + 20*N (LC_HOST=localhost:<web>), so up to 10 engines run side by side
//   --seed S       SIM_SEED=S: seeded world randomness, reseeded every tick from (seed, ticks since the first "run...t" login)
//   --det          SIM_DET=1: reproducible-seed mode (no tick before the first client, generous ack/login waits)
//   --fast         SIM_FAST=1: engine speed-ups that compute the same world (same draws, same order)
//   --chaos        every realism switch on (doors, socket drops, network jitter, resource competition): see CHAOS below
//   --crowd        also a ~945-player crowd at the Ardougne market (heavy: costs engine CPU)
//   --realtime     no lockstep: the engine ticks on the wall clock (NODE_TICKRATE, default 400 ms), like a real server
//
// Lockstep (SIM_LOCKSTEP=1): there is no wall clock. A tick runs as soon as every connected client has answered the
// previous one (or after SIM_ACK_MS, 200). Bots must run with SIM_LOCKSTEP=1 too (tools/lockstep/run-sim.ts sets it).
// Staff level 4 (LOCAL_STAFF_LEVEL) lets the quest launchers' --sim setup use cheats; production worlds ignore it.
// Any SIM_* variable already in the environment wins over the presets here.
import { spawn } from 'child_process';
import { join } from 'path';

export const CHAOS: Record<string, string> = {
    SIM_DOORS: 'random:1', SIM_DOORS_FLIP: '300:0.1',            // doors/gates left open or shut, toggled like players do
    SIM_DROP: 'random:1', SIM_DROP_WINDOW: '100-3000', SIM_DROP_GAP: '600', SIM_DROP_DOWN: '30',   // a server restart: every socket closes
    SIM_DROP_ONE: 'random:2', SIM_DROP_ONE_GAP: '300',            // one bot's connection dies
    SIM_NET_LATE: '0.02:2',                                       // input held 1-2 ticks (late, in order)
    SIM_COMPETE: '0.05:20',                                       // other players deplete rocks/trees near the bot
};
export const CROWD: Record<string, string> = { SIM_CROWD: '2655,3290,16,945', SIM_CROWD_WANDER: '1', SIM_CROWD_NEAR: '40' };
export const webPort = (n: number) => 8892 + 20 * n;
export function engineEnv(o: { instance: number; seed?: number; det?: boolean; fast?: boolean; chaos?: boolean; crowd?: boolean; realtime?: boolean }): Record<string, string> {
    const off = 20 * o.instance;
    const env: Record<string, string> = {
        LOCAL_STAFF_LEVEL: '4', SIM_INSTANCE: String(o.instance),
        // upstream 2012ab67f's own cache build fails its .loc checksum on a clean clone (also without this toolkit);
        // the check only guards against accidental content edits, so local sim engines skip it
        BUILD_VERIFY: process.env.BUILD_VERIFY ?? 'false',
        WEB_PORT: String(webPort(o.instance)), NODE_PORT: String(43597 + off), HISCORES_WEB_PORT: String(8893 + off),
        WEB_MANAGEMENT_PORT: String(8898 + off), LOGIN_PORT: String(43512 + off), FRIEND_PORT: String(45110 + off), LOGGER_PORT: String(43513 + off),
    };
    if (!o.realtime) env.SIM_LOCKSTEP = '1';
    if (o.seed !== undefined) { env.SIM_SEED = String(o.seed); env.SIM_DOORS_FLIP_SEED = String(o.seed); }
    if (o.det) Object.assign(env, { SIM_DET: '1', SIM_ACK_MS: '5000', SIM_LOGIN_MS: '5000' });
    if (o.fast) env.SIM_FAST = '1';
    if (o.chaos) Object.assign(env, CHAOS, o.seed !== undefined ? { SIM_DOORS: `random:${o.seed}`, SIM_DROP: `random:1:${o.seed}`, SIM_DROP_ONE: `random:2:${o.seed}` } : {});
    if (o.crowd) Object.assign(env, CROWD);
    for (const k of Object.keys(env)) if (k.startsWith('SIM_') && process.env[k] !== undefined) env[k] = process.env[k]!;
    return env;
}
export const ENGINE_DIR = join(import.meta.dir, '..', '..', 'server', 'engine');

if (import.meta.main) {
    const a = process.argv.slice(2);
    if (a.includes('--help') || a.includes('-h')) { console.log(require('fs').readFileSync(import.meta.path, 'utf8').split('\n').slice(1, 18).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
    const num = (f: string) => { const i = a.indexOf(f); return i >= 0 ? Number(a[i + 1]) : undefined; };
    const o = { instance: num('--instance') ?? 0, seed: num('--seed'), det: a.includes('--det'), fast: a.includes('--fast'), chaos: a.includes('--chaos'), crowd: a.includes('--crowd'), realtime: a.includes('--realtime') };
    if (o.instance < 0 || o.instance > 9) { console.error('--instance 0..9'); process.exit(2); }
    const env = engineEnv(o);
    console.log(`sim engine ${o.instance}: ${o.realtime ? 'real time' : 'LOCKSTEP'}${o.seed !== undefined ? `, seed ${o.seed}` : ''}${o.det ? ', SIM_DET' : ''}${o.fast ? ', SIM_FAST' : ''}${o.chaos ? ', CHAOS' : ''}${o.crowd ? ', CROWD' : ''}`);
    console.log(`clients: LC_HOST=localhost:${webPort(o.instance)}${o.realtime ? '' : ' SIM_LOCKSTEP=1'}   (wait for "World ready"; the first start builds the cache)`);
    const p = spawn('bun', ['run', 'src/app.ts'], { cwd: ENGINE_DIR, env: { ...process.env, ...env }, stdio: 'inherit' });
    const stop = () => { try { p.kill('SIGTERM'); } catch { /* gone */ } };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    p.on('exit', c => process.exit(c ?? 0));
}

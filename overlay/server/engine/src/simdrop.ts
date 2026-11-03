// rs-sdk OFFLINE SIM ONLY (rig): the demo's mass socket drops (live run 4 vcs: every socket closed at once,
// `ws close code=1012 reason=restarting`, then "connect timed out" spells). Off unless one of these is set:
//   SIM_DROP=<t1,t2,...>            close EVERY client socket at these world ticks
//   SIM_DROP=random:<N>[:<seed>]    N drops at random ticks in SIM_DROP_WINDOW=<from>-<to> (default 600-36000), at least
//                                   SIM_DROP_GAP (default 1500) apart; seed default SIM_SEED or 1. Own PRNG: world RNG untouched.
//   SIM_DROP_AT=<x0>,<z0>,<x1>,<z1>,<level>[;...]   drop the moment a player whose name matches SIM_DROP_WHO (regex,
//                                   default ^run.*t$ = the trainee) stands inside the box (once per box), e.g. the gnome
//                                   course L2 platform
//   SIM_DROP_ONE=random:<N>[:<seed>]  (FINAL3) N SINGLE-socket drops: each closes ONE random connected client whose
//                                   name matches SIM_DROP_ONE_WHO (regex, default ^run = any of our bots) abruptly
//                                   (ws terminate -> the client sees 1006, like a network hiccup); logins stay open.
//                                   Same window env as random mass drops; SIM_DROP_ONE_GAP (default 600) apart.
//   SIM_DROP_DOWN=<ticks>          after a drop the 'restarting' server REFUSES logins for this many ticks (login response
//                                   14 'server being updated', the engine's own shutdown answer); default 30 = ~18 s live.
//                                   (v1 dropped re-logged sessions again instead: a harsher-than-live storm that broke
//                                   half-sent reconnect bursts; the demo's restarts fail the connect/login, not the session)
// The close is server-side (1012 'restarting'); the engine's normal ws close path then runs (client.state -1, the player
// keeps a NullClientSocket and stays in the world until its logout timer), the same as on the demo.
import { isClientConnected } from '#/engine/entity/NetworkPlayer.js';

const SPEC = (process.env.SIM_DROP ?? '').trim();
const AT = (process.env.SIM_DROP_AT ?? '').trim();
const DOWN = Number(process.env.SIM_DROP_DOWN ?? 30);
const WHO = new RegExp(process.env.SIM_DROP_WHO ?? '^run.*t$', 'i');

function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let ticks: number[] = [];
let boxes: Array<{ x0: number; z0: number; x1: number; z1: number; level: number; done: boolean }> = [];
let downUntil = -1;
let inited = false, enabled = false;
const ONE = (process.env.SIM_DROP_ONE ?? '').trim();
const ONE_WHO = new RegExp(process.env.SIM_DROP_ONE_WHO ?? '^run', 'i');
let oneTicks: number[] = [];
let oneRng: () => number = Math.random;

function init(): void {
    inited = true;
    if (SPEC) {
        const r = /^random:(\d+)(?::(-?\d+))?$/.exec(SPEC);
        if (r) {
            const n = Number(r[1]), rng = mulberry(Number(r[2] ?? process.env.SIM_SEED ?? 1) ^ 0xd409);
            const [from, to] = (process.env.SIM_DROP_WINDOW ?? '600-36000').split('-').map(Number) as [number, number];
            const gap = Number(process.env.SIM_DROP_GAP ?? 1500);
            for (let k = 0; ticks.length < n && k < 1000; k++) {
                const t = Math.floor(from + rng() * (to - from));
                if (ticks.every(u => Math.abs(u - t) >= gap)) ticks.push(t);
            }
        } else ticks = SPEC.split(',').map(s => Number(s.trim())).filter(t => Number.isFinite(t) && t > 0);
        ticks.sort((a, b) => a - b);
    }
    for (const part of AT.split(';').map(s => s.trim()).filter(Boolean)) {
        const v = part.split(',').map(Number);
        if (v.length === 5 && v.every(Number.isFinite)) boxes.push({ x0: Math.min(v[0]!, v[2]!), z0: Math.min(v[1]!, v[3]!), x1: Math.max(v[0]!, v[2]!), z1: Math.max(v[1]!, v[3]!), level: v[4]!, done: false });
        else console.error(`[simdrop] bad SIM_DROP_AT box '${part}' (x0,z0,x1,z1,level): ignored`);
    }
    if (ONE) {
        const r = /^random:(\d+)(?::(-?\d+))?$/.exec(ONE);
        if (!r) console.error(`[simdrop] bad SIM_DROP_ONE=${ONE} (random:<N>[:<seed>]): ignored`);
        else {
            const n = Number(r[1]), seed = Number(r[2] ?? process.env.SIM_SEED ?? 1);
            const rng = mulberry(seed ^ 0x51e6); oneRng = mulberry(seed ^ 0x0e1e);
            const [from, to] = (process.env.SIM_DROP_WINDOW ?? '600-36000').split('-').map(Number) as [number, number];
            const gap = Number(process.env.SIM_DROP_ONE_GAP ?? 600);
            for (let k = 0; oneTicks.length < n && k < 1000; k++) {
                const t = Math.floor(from + rng() * (to - from));
                if (oneTicks.every(u => Math.abs(u - t) >= gap)) oneTicks.push(t);
            }
            oneTicks.sort((a, b) => a - b);
            console.log(`[simdrop] single-socket drops armed for /${ONE_WHO.source}/: ticks [${oneTicks.join(', ')}]`);
        }
    }
    enabled = ticks.length > 0 || boxes.length > 0 || oneTicks.length > 0;
    if (enabled) console.log(`[simdrop] armed: ticks [${ticks.join(', ')}]${boxes.length ? `, ${boxes.length} box(es) for /${WHO.source}/` : ''}, down ${DOWN} t after each drop`);
}

function closeAll(world: any): number {
    let n = 0;
    for (const p of world.playerLoop.all() as Iterable<any>) {
        if (!isClientConnected(p)) continue;
        const c = p.client as any;
        try { if (c.socket?.close) c.socket.close(1012, 'restarting'); else c.close(); n++; } catch { /* already gone */ }
    }
    return n;
}

export function simDropTick(world: any): void {
    if (!inited) init();
    if (!enabled) return;
    const now: number = world.currentTick;
    while (oneTicks.length && oneTicks[0]! <= now) {
        oneTicks.shift();
        const cands = [...(world.playerLoop.all() as Iterable<any>)].filter(p => isClientConnected(p) && ONE_WHO.test(String(p.username ?? '')));
        const p = cands.length ? cands[Math.floor(oneRng() * cands.length)] : null;
        if (!p) { console.log(`[simdrop] tick ${now}: single drop: no connected /${ONE_WHO.source}/ client`); continue; }
        const c = p.client as any;
        try { if (c.socket?.terminate) c.socket.terminate(); else if (c.socket?.close) c.socket.close(1001, 'network'); else c.close(); } catch { /* gone */ }
        console.log(`[simdrop] tick ${now}: SINGLE DROP of ${p.username} at ${p.x},${p.z} L${p.level} (${cands.length} candidates)`);
    }
    let why = '';
    while (ticks.length && ticks[0]! <= now) { ticks.shift(); why = 'scheduled'; }
    if (!why) {
        for (const b of boxes) {
            if (b.done) continue;
            for (const p of world.playerLoop.all() as Iterable<any>) {
                const name = String(p.username ?? p.displayName ?? '');
                if (!WHO.test(name) || p.level !== b.level || p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1) continue;
                b.done = true; why = `${name} entered box ${b.x0},${b.z0}-${b.x1},${b.z1} L${b.level} at ${p.x},${p.z}`; break;
            }
            if (why) break;
        }
    }
    if (why) {
        const n = closeAll(world);
        downUntil = now + DOWN;
        console.log(`[simdrop] tick ${now}: DROP (${why}): closed ${n} client sockets (1012 restarting); logins dropped again until tick ${downUntil}`);
        return;
    }
}
/** World.processLogins: refuse a login while the simulated restart is on (response 14, like the shutdown path). */
let refused = 0;
export function simDropRefusing(world: any): boolean {
    if (!enabled || world.currentTick >= downUntil) return false;
    if (++refused % 20 === 1) console.log(`[simdrop] tick ${world.currentTick}: still restarting: refused a login (${refused} so far)`);
    return true;
}

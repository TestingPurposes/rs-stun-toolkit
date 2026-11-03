// rs-sdk OFFLINE SIM perf (SIM_LOCKSTEP=1 + SIM_PROF=<n>, diagnostic only; reads the clock and nothing else, so it can
// never change what the world does). Splits the wall time of every tick into
//   compute  = the cycle body, per phase (performance.now marks)
//   ackWait  = tick written -> the last connected client's first frame after it arrived (client work + transport)
//   pickup   = that arrival -> the next cycle starting (engine poll / event-loop latency)
//   io       = ticks held by a login/logout in flight (SIM_LOGIN_MS), deadline = ticks that ran on SIM_ACK_MS
// and prints one `[simprof]` line every <n> ticks (SIM_PROF=1 -> 500).
export const SIM_PROF_N = process.env.SIM_LOCKSTEP === '1' && process.env.SIM_PROF ? (Number(process.env.SIM_PROF) > 1 ? Number(process.env.SIM_PROF) : 500) : 0;
export const SIM_PROF = SIM_PROF_N > 0;
// SIM_BENCH_TICKS=<n> (with SIM_PROF and SIM_IDLE_MS=0): engine-only benchmark. Nobody connects; the world ticks back to back;
// after <n> ticks one `[simbench]` line (compute per tick by phase) and the process exits. Same seeded world every run.
const SIM_BENCH_TICKS = SIM_PROF ? Number(process.env.SIM_BENCH_TICKS ?? 0) : 0;
let benchTicks = 0, benchCompute = 0, benchStart = 0;
const benchPhase = new Float64Array(15);

export const PHASES = ['hooks', 'world', 'clientIn', 'npcEv', 'npc', 'player', 'logout', 'audit', 'login', 'zone', 'info', 'clientOut', 'feed', 'cleanup', 'post'] as const;
const NP = PHASES.length;
const phaseSum = new Float64Array(NP);
let last = 0, idx = 0;
let ticks = 0, wallStart = 0, computeSum = 0, cycleStart = 0;
let ackSum = 0, pickupSum = 0, ioTicks = 0, ioSum = 0, deadlineTicks = 0, idleTicks = 0, idleSum = 0, clientsSum = 0;
const ackHist: number[] = [];
let tickSent = 0;

/** cycle start: begin the phase marks */
export function profStart(): void {
    const now = performance.now();
    if (!wallStart) wallStart = now;
    cycleStart = now; last = now; idx = 0;
}
/** end of phase i (in PHASES order) */
export function profMark(i: number): void {
    const now = performance.now();
    phaseSum[i] += now - last; last = now; idx = i + 1;
}
/** cycle body done (before simAwaitAcks) */
export function profEnd(): void {
    const now = performance.now();
    computeSum += now - cycleStart;
    tickSent = now;
}
/** nobody connected: close an open window (a run just ended) */
export function profIdle(tick: number): void { if (ticks > 0) { report(tick, tickSent); phaseSum.fill(0); computeSum = 0; } }
/** the wait for this tick ended: lastAck = latest first-frame-after-tick (perf ms, 0 = no clients) */
export function profWaitDone(lastAck: number, clients: number, io: boolean, deadline: boolean, tick: number): void {
    const now = performance.now();
    if (!clients && SIM_BENCH_TICKS > 0) {
        if (benchTicks === 0) benchStart = now;
        benchTicks++; benchCompute += computeSum; for (let i = 0; i < NP; i++) benchPhase[i] += phaseSum[i];
        phaseSum.fill(0); computeSum = 0;
        if (benchTicks >= SIM_BENCH_TICKS) {
            const ph = PHASES.map((p, i) => [p, benchPhase[i] / benchTicks] as const).filter(x => x[1] >= 0.02).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${v.toFixed(3)}`).join(' ');
            console.log(`[simbench] ${benchTicks} idle ticks: compute ${(benchCompute / benchTicks).toFixed(3)} ms/tick [${ph}] wall ${((now - benchStart) / benchTicks).toFixed(3)} ms/tick`);
            process.exit(0);
        }
        return;
    }
    if (!clients) {   // nobody connected: close the window (a run just ended) and don't count idle time
        if (ticks > 0) report(tick, tickSent);
        phaseSum.fill(0); computeSum = 0; wallStart = now; return;
    }
    ticks++; clientsSum += clients;
    if (io) { ioTicks++; ioSum += now - tickSent; }
    else {
        const a = Math.max(0, lastAck - tickSent);
        ackSum += a; pickupSum += Math.max(0, now - Math.max(lastAck, tickSent));
        ackHist.push(a);
        if (deadline) deadlineTicks++;
    }
    if (ticks >= SIM_PROF_N) report(tick, now);
}
function report(tick: number, now: number): void {
    const wall = now - wallStart, n = ticks, busy = n - idleTicks - ioTicks;
    ackHist.sort((x, y) => x - y);
    const q = (p: number) => ackHist.length ? ackHist[Math.min(ackHist.length - 1, Math.floor(p * ackHist.length))].toFixed(1) : '-';
    const ph = PHASES.map((p, i) => [p, phaseSum[i] / n] as const).filter(x => x[1] >= 0.05).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${v.toFixed(2)}`).join(' ');
    console.log(`[simprof] tick ${tick}: ${n} t in ${(wall / 1000).toFixed(2)} s = ${(n * 1000 / wall).toFixed(1)} t/s | per tick ms: compute ${(computeSum / n).toFixed(2)} [${ph}]` +
        ` | busy ${busy}: ackWait ${(busy ? ackSum / busy : 0).toFixed(2)} (p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)}) pickup ${(busy ? pickupSum / busy : 0).toFixed(2)} deadline ${deadlineTicks}` +
        ` | io ${ioTicks} t ${(ioSum / Math.max(1, ioTicks)).toFixed(1)} ms | idle ${idleTicks} t | clients ${(clientsSum / n).toFixed(1)}`);
    phaseSum.fill(0); ticks = 0; wallStart = now; computeSum = 0; ackSum = 0; pickupSum = 0; ioTicks = 0; ioSum = 0; deadlineTicks = 0; idleTicks = 0; idleSum = 0; clientsSum = 0; ackHist.length = 0;
}

// ---- SIM_TRACE=<file> (replay check, diagnostic only): one line per tick with a hash of every decoded client packet
// (opcode + payload, NO_TIMEOUT acks excluded) and of the world (every npc's x/z/level/hp + every player's x/z/level),
// so two runs can be diffed to the FIRST diverging tick (input first = client timing; world first = engine).
import fs from 'fs';
export const SIM_TRACE = process.env.SIM_LOCKSTEP === '1' ? (process.env.SIM_TRACE ?? '') : '';
let inHash = 0x811c9dc5 | 0, inCount = 0, inOps = '';
const traceBuf: string[] = [];
const fnv = (h: number, v: number) => Math.imul(h ^ (v & 0xff), 0x01000193);
export function simTraceInput(pid: number, opcode: number, data: Uint8Array, len: number, name: string): void {
    if (opcode === 181 || name === 'NO_TIMEOUT') return;   // 181 = NO_TIMEOUT (the lockstep ack)
    let h = fnv(fnv(inHash, pid), opcode);
    for (let i = 0; i < len; i++) h = fnv(h, data[i]);
    inHash = h; inCount++; inOps += (inOps ? ',' : '') + opcode;
}
export function simTraceTick(world: any): void {
    let w = 0x811c9dc5 | 0, n = 0;
    for (const npc of world.npcs) { w = fnv(fnv(fnv(fnv(w, npc.x), npc.x >> 8), npc.z), npc.z >> 8); w = fnv(fnv(w, npc.level), npc.levels?.[3] ?? 0); n++; }
    let pl = '';
    for (const p of world.playerLoop.all()) { w = fnv(fnv(fnv(w, p.x), p.z), p.level); pl += ` ${p.username}@${p.x},${p.z},${p.level}`; }
    traceBuf.push(`${world.currentTick} in=${(inHash >>> 0).toString(16)}/${inCount} w=${(w >>> 0).toString(16)} n=${n}${pl}${inOps ? ' ops=' + inOps : ''}`);
    inHash = 0x811c9dc5 | 0; inCount = 0; inOps = '';
    if (traceBuf.length >= 200) simTraceFlush();
}
export function simTraceFlush(): void {
    if (!traceBuf.length) return;
    fs.appendFileSync(SIM_TRACE, traceBuf.join('\n') + '\n'); traceBuf.length = 0;
}

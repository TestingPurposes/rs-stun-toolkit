// rs-sdk OFFLINE SIM ONLY (FINAL3): live network jitter. The sim has ~0 latency, so every click lands on the
// tick it was meant for; on the demo some land a tick or two late (live run 5's lost trade offer: a click sent the tick a
// window opened). Off unless set:
//   SIM_NET_LATE=<p>[:<maxTicks>]   each tick, a connected player whose name matches SIM_NET_WHO (regex, default ^run = our
//                                   bots) starts, with probability p, a hold of 1..maxTicks (default 2) ticks during which the
//                                   engine does NOT read its input. Bytes stay buffered in order (TCP), so everything it sent
//                                   meanwhile arrives together after the hold - late, never reordered, never lost.
// Lockstep acks are read off the socket (client.lastRecvAt), not decoded, so a hold never stalls the world.
const SPEC = (process.env.SIM_NET_LATE ?? '').trim();
const WHO = new RegExp(process.env.SIM_NET_WHO ?? '^run', 'i');

function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let inited = false, p = 0, maxT = 2, rng: () => number = Math.random;
const holdUntil = new Map<string, number>();
let holds = 0, heldTicks = 0, lastReport = 0;

function init(): void {
    inited = true;
    if (!SPEC) return;
    const m = /^(0?\.\d+|0|1(?:\.0*)?)(?::(\d+))?$/.exec(SPEC);
    if (!m) { console.error(`[simnet] bad SIM_NET_LATE=${SPEC} (<p>[:<maxTicks>]): ignored`); return; }
    p = Number(m[1]); maxT = Math.max(1, Number(m[2] ?? 2));
    rng = mulberry(Number(process.env.SIM_SEED ?? 1) ^ 0x1a7e);
    console.log(`[simnet] SIM_NET_LATE=${p}:${maxT} for /${WHO.source}/: input held 1-${maxT} ticks at p=${p}/tick/player`);
}

/** World.processClientsIn: true = do not decode this player's input this tick (it stays buffered for a later tick). */
export function simNetHold(player: any, now: number): boolean {
    if (!inited) init();
    if (p <= 0) return false;
    const name = String(player.username ?? '');
    if (!WHO.test(name)) return false;
    const until = holdUntil.get(name) ?? -1;
    let held = now < until;
    if (!held && rng() < p) { holdUntil.set(name, now + 1 + Math.floor(rng() * maxT)); holds++; held = true; }
    if (held) {
        heldTicks++;
        player.userPath = []; player.opcalled = false;   // decodeIn would reset these; nothing of last tick may be replayed
    }
    if (now - lastReport >= 500) { lastReport = now; if (holds) console.log(`[simnet] tick ${now}: ${holds} holds, ${heldTicks} player-ticks held since the last report`); holds = 0; heldTicks = 0; }
    return held;
}

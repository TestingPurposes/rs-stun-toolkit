// rs-sdk OFFLINE SIM (SIM_LOCKSTEP=1 only): SIM_SEED=<int> makes the world's randomness repeatable. Imported first by
// app.ts so Math.random is replaced BEFORE any module draws from it (JavaRandom's own seed, NPC wander, hunt targets).
// A single stream is not enough: any extra draw (a helper logging in a tick earlier) shifts every later roll. So the
// World reseeds both generators at the start of every cycle from (seed, ticks since the anchor login), see simReseed:
// the rolls of tick N after the trainee logged in are the same in every run with the same seed.
// SIM_SEED_ANCHOR (regex, default ^run.+t$ = the runner's trainee) names the login that starts the count.
// Never active on a normal (wall-clock) engine.
const seedEnv = process.env.SIM_LOCKSTEP === '1' ? process.env.SIM_SEED : undefined;
export const simSeed: number | null = seedEnv !== undefined && seedEnv !== '' ? (Number(seedEnv) >>> 0 || 1) : null;
export const simSeedAnchor = new RegExp(process.env.SIM_SEED_ANCHOR ?? '^run.+t$', 'i');
let a = simSeed ?? 1;
const mix = (x: number, y: number) => { let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ y; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
/** Reseed Math.random for tick `n` (since the anchor); returns a 31-bit seed for JavaRandom. */
export function simReseed(n: number): number {
    a = mix(simSeed!, n) || 1;
    return mix(simSeed! ^ 0x5bd1e995, n) & 0x7fffffff;
}
/** sim fusion 3 (SIM_TRACE_ENGINE): Math.random draws so far (the per-tick trace prints the delta) */
export let simRandDraws = 0;
if (simSeed !== null) {
    // mulberry32
    Math.random = () => {
        simRandDraws++;
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    console.log(`[sim] SIM_SEED=${simSeed}: world randomness reseeded every tick (anchor ${simSeedAnchor})`);
}

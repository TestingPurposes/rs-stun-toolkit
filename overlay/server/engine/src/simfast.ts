// rs-sdk OFFLINE SIM perf: SIM_FAST=1 (with SIM_LOCKSTEP=1) switches on engine speed-ups that compute exactly the same world
// (same order of operations, same random draws): proven tick-identical by plan/tools/simspeed (per-tick input + world hash
// traces). Never active on a normal (wall-clock) engine. See plan/SIM-SPEED.md in our private notes.
// SIM_FAST_OFF=<list> turns single items off for A/B timing: iter (EntityList/LinkList iterators).
// Tried and dropped (no measurable gain, plan/SIM-SPEED.md): a one-entry collision zone cache, a script trigger memo.
const on = process.env.SIM_LOCKSTEP === '1' && process.env.SIM_FAST === '1';
const off = new Set((process.env.SIM_FAST_OFF ?? '').split(',').map(s => s.trim()).filter(Boolean));
export const SIM_FAST = on;
export const SIM_FAST_ITER = on && !off.has('iter');

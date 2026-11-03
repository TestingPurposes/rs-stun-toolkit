// WASM TRAP RECOVERY.
// LIVE: a bot at the Ardougne bank (2655,3283) threw "RuntimeError: Out of bounds memory access
// (wasm.findLongPath ...)" 5,500x and went BRAIN-SILENT. A wasm trap leaks the shadow stack, so a poisoned instance
// traps on every later call. The rsmod glue now re-instantiates the module, rebuilds the collision, replays the
// post-init edits, retries once, and after PF_TRAP_EXIT failed recoveries declares the pathfinder dead.
//   bun test headless/sim/pathfinder-trap.test.ts
//   PF_TRAP_REAL=1 ...  also the REAL failure: grow the instance to the 4 GB cap so findLongPath's buffer grow fails
//                       (allocates ~4 GB of virtual memory; off by default).
import { describe, test, expect } from 'bun:test';
import * as rsmod from '../../../vendor/rsmod-pathfinder';
import { initPathfinding, findLongPath, blockDoor, getDoorAt, isTileWalkable, pathfinderHealth, onPathfinderDead, __injectPathfinderTraps } from '../../../../sdk/pathfinding.ts';

initPathfinding();
const R = rsmod as any;
const BANK = { x: 2655, z: 3283 };
const route = () => findLongPath(0, BANK.x, BANK.z, 2662, 3283).map(w => `${w.x},${w.z}`).join(' ');
/** the full collision word of every tile in a box (32 isFlagged calls per tile, as edge-blocks reads it) */
function words(x0: number, z0: number, n: number): number[] {
    const out: number[] = [];
    for (let x = x0; x < x0 + n; x++) for (let z = z0; z < z0 + n; z++) {
        let w = 0;
        for (let b = 0; b < 32; b++) if (rsmod.isFlagged(x, z, 0, (1 << b) >>> 0)) w |= 1 << b;
        out.push(w >>> 0);
    }
    return out;
}

describe('rsmod wasm trap guard', () => {
    test('the glue is patched (guard + reinstantiate)', () => {
        expect(typeof R.__reinstantiate).toBe('function');
        expect(R.__guard?.onTrap).toBeTypeOf('function');
        expect(R.__guard?.journal).toBeInstanceOf(Map);
    });

    test('one trap: fresh instance, collision + post-init edits rebuilt, the call is answered', () => {
        // a post-init edit that must survive the rebuild: re-wall a known door near the bank (blockDoor -> journal)
        let door: { x: number; z: number } | null = null;
        for (let dx = -30; dx <= 30 && !door; dx++) for (let dz = -30; dz <= 30 && !door; dz++) {
            if (getDoorAt(0, BANK.x + dx, BANK.z + dz)) door = { x: BANK.x + dx, z: BANK.z + dz };
        }
        expect(door).not.toBeNull();
        expect(blockDoor(0, door!.x, door!.z)).toBe(true);
        const before = route();
        const box = words(BANK.x - 32, BANK.z - 32, 64);
        const wasmBefore = R.__wasmNow();
        __injectPathfinderTraps(1, { reset: true, cooldownMs: 0 });
        const after = route();   // traps, recovers, retries
        expect(R.__wasmNow()).not.toBe(wasmBefore);   // a NEW instance answered
        expect(after).toBe(before);
        expect(after.length).toBeGreaterThan(0);
        expect(words(BANK.x - 32, BANK.z - 32, 64)).toEqual(box);   // base + the re-walled door, word for word
        const h = pathfinderHealth();
        expect(h.traps).toBe(1); expect(h.recoveries).toBe(1); expect(h.streak).toBe(0); expect(h.dead).toBe(false);
        expect(isTileWalkable(0, BANK.x, BANK.z)).toBe(true);
    }, 120_000);

    test('repeated traps: NO PATH (never a throw), then dead after PF_TRAP_EXIT failed recoveries, once; then recoverable', () => {
        const dead: string[] = [];
        const off = onPathfinderDead(why => dead.push(why));
        try {
            __injectPathfinderTraps(1_000_000, { reset: true, cooldownMs: 0 });   // every call traps, the rebuild's too
            for (let i = 0; i < 5; i++) expect(findLongPath(0, BANK.x, BANK.z, 2662, 3283)).toEqual([]);
            expect(rsmod.isFlagged(BANK.x, BANK.z, 0, 0x100)).toBe(true);   // a trapped query answers "blocked"
            expect(dead.length).toBe(1);   // fired once at the 3rd failed recovery (PF_TRAP_EXIT default)
            expect(dead[0]).toMatch(/failed wasm recoveries in a row/);
            const h = pathfinderHealth();
            expect(h.dead).toBe(true); expect(h.failedRecoveries).toBeGreaterThanOrEqual(3);
            // inside a cooldown: answered NO PATH with no rebuild per call
            __injectPathfinderTraps(1_000_000, { cooldownMs: 60_000 });
            const t0 = performance.now();
            for (let i = 0; i < 1000; i++) findLongPath(0, BANK.x, BANK.z, 2662, 3283);
            expect(performance.now() - t0).toBeLessThan(2000);
            expect(pathfinderHealth().suppressed).toBeGreaterThanOrEqual(1000);
            // memory back: the next recovery after the cooldown heals the (poisoned) module
            __injectPathfinderTraps(0, { reset: true, cooldownMs: 0 });
            expect(R.__guard.poisoned).toBe(true);
            expect(route().length).toBeGreaterThan(0);
            expect(R.__guard.poisoned).toBe(false);
            expect(pathfinderHealth().recoveries).toBe(1);
        } finally { off(); __injectPathfinderTraps(0, { reset: true }); }
    }, 300_000);

    test('no listener: a dead pathfinder exits the process with code 3 (never BRAIN-SILENT)', () => {
        const script = `
            const pf = await import(${JSON.stringify(require('path').resolve(import.meta.dir, '../../../../sdk/pathfinding.ts'))});
            pf.initPathfinding();
            pf.__injectPathfinderTraps(1e9, { reset: true, cooldownMs: 0 });
            for (let i = 0; i < 10; i++) pf.findLongPath(0, 2655, 3283, 2662, 3283);
            console.log('STILL ALIVE'); process.exit(0);`;
        const r = Bun.spawnSync([process.execPath, '-e', script], { env: { ...process.env, PF_PREWARM: '0' }, stdout: 'pipe', stderr: 'pipe' });
        const err = r.stderr.toString();
        expect(r.exitCode).toBe(3);
        expect(r.stdout.toString()).not.toContain('STILL ALIVE');
        expect(err).toContain('PATHFINDER DEAD');
        expect((err.match(/WASM TRAP #/g) ?? []).length).toBe(3);   // one line per recovery attempt, not per call
    }, 300_000);

    test.skipIf(process.env.PF_TRAP_REAL !== '1')('REAL: a failed memory.grow traps, the fresh instance answers', () => {
        // a FRESH instance has no search buffer yet; cap its memory so the first findLongPath's ~40 MB grow fails
        R.__reinstantiate();
        const mem: WebAssembly.Memory = R.__wasmNow().memory;
        mem.grow(65536 - mem.buffer.byteLength / 65536 - 100);   // 100 pages (6.4 MB) left: the ~40 MB buffer cannot grow
        __injectPathfinderTraps(0, { reset: true, cooldownMs: 0 });
        const r = route();   // REAL trap ("Unreachable"), recovery = fresh 17-page instance + rebuild + prewarm, retry OK
        expect(r.length).toBeGreaterThan(0);
        const h = pathfinderHealth();
        expect(h.traps).toBeGreaterThanOrEqual(1); expect(h.recoveries).toBe(1);
        expect(h.lastError).toMatch(/Unreachable|Out of bounds/);
    }, 300_000);
});

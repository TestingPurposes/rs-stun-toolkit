import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness } from './coop.ts';
import { LeanBot } from '../leanbot.ts';
import { openField } from './world.ts';

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

const mkBot = () => { const b = new LeanBot(); b.quiet = true; (b as any).exitOnStuck = false; return b; };

describe('crowd / viewDistance cap (the 250-player collapse)', () => {
    test('THE COLLAPSE: a player beyond the 250 nearest is INVISIBLE — findPlayerIndexByName never resolves it', async () => {
        const world = new CoopWorld(openField());
        h = new CoopHarness(world);
        const seer = mkBot(), target = mkBot();
        // seer + target + a 300-strong crowd, ALL on level 0. The crowd packs tight ON the seer
        // (chebyshev <= 1); the target sits 8 tiles out — so the seer's nearest-250 are all crowd and
        // the target falls outside the gather.
        h.add({ bot: seer as any, name: 'seer1', index: 10, x: 3200, z: 3200 });
        h.add({ bot: target as any, name: 'target1', index: 11, x: 3208, z: 3200 });
        world.addCrowd(300, 3200, 3200, 0, 1000);
        await h.start();
        for (let i = 0; i < 40; i++) await h.tick();

        expect((seer as any).findPlayerIndexByName('target1')).toBeLessThan(0);   // never rendered
    }, 30_000);

    test('CONTROL: with no crowd the same player is visible', async () => {
        const world = new CoopWorld(openField());
        h = new CoopHarness(world);
        const seer = mkBot(), target = mkBot();
        h.add({ bot: seer as any, name: 'seer1', index: 10, x: 3200, z: 3200 });
        h.add({ bot: target as any, name: 'target1', index: 11, x: 3208, z: 3200 });
        await h.start();
        for (let i = 0; i < 10; i++) await h.tick();

        expect((seer as any).findPlayerIndexByName('target1')).toBeGreaterThanOrEqual(0);
    }, 30_000);

    test('LEVEL-SCOPED DODGE: a 300-crowd on ANOTHER floor does not exist — the player stays visible', async () => {
        const world = new CoopWorld(openField());
        h = new CoopHarness(world);
        const seer = mkBot(), target = mkBot();
        // seer + target on level 0; the 300 crowd is UPSTAIRS on level 1. Gathering is level-scoped,
        // so the crowd never renders for the L0 bots — the target is visible.
        h.add({ bot: seer as any, name: 'seer1', index: 10, x: 3200, z: 3200 });
        h.add({ bot: target as any, name: 'target1', index: 11, x: 3208, z: 3200 });
        world.addCrowd(300, 3200, 3200, 1, 1000);   // <-- level 1, a different plane
        await h.start();
        for (let i = 0; i < 10; i++) await h.tick();

        expect((seer as any).findPlayerIndexByName('target1')).toBeGreaterThanOrEqual(0);   // crowd filtered by plane
    }, 30_000);

    test('the cap is exactly the nearest 250: at 249 crowd the player is still visible, at 300 it is not', async () => {
        // boundary check — proves it's the count, not distance alone, that hides the player.
        for (const [crowd, wantVisible] of [[249, true], [300, false]] as const) {
            const world = new CoopWorld(openField());
            const hh = new CoopHarness(world);
            const seer = mkBot();
            hh.add({ bot: seer as any, name: 'g', index: 10, x: 3200, z: 3200 });
            hh.add({ bot: mkBot() as any, name: 'r', index: 11, x: 3208, z: 3200 });
            world.addCrowd(crowd, 3200, 3200, 0, 1000);
            await hh.start();
            for (let i = 0; i < 3; i++) await hh.tick();
            expect((seer as any).findPlayerIndexByName('r') >= 0).toBe(wantVisible);
            await hh.stop();
        }
    }, 30_000);
});

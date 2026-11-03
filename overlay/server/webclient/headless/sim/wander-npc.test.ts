// WANDERING-NPC APPROACH SUITE — the reusable primitive (LeanBot.stepToNpc) that unblocks Rune
// Mysteries' Duke and every future pacing quest-giver / guard / shopkeeper. A naive chase fails two
// ways (jitter re-planning to the moving tile; targeting the wrong side of a wall); stepToNpc walks a
// THROTTLED stable target via the real pathfinder (npc's own side of walls), then hands the last step
// to the engine's npc-follow. This test is STRICTER than live: the coop sim does NOT model the
// engine's follow, so the bot must approach + catch a moving npc in range on its own — pass here and
// it's a lock live.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness } from './coop.ts';
import { QuestRunnerBot } from '../quest-runner.ts';
import { openField } from './world.ts';
import { linePath } from './harness.ts';

const AIR_TALISMAN = 1438, RM_VARP = 20;

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

function mkQuester() {
    const q = new QuestRunnerBot(); q.quiet = true;
    (q as any).exitOnStuck = false; (q as any).travelEnabled = false; (q as any).arrived = true;
    (q as any).findLongPathFn = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
    return q;
}

describe('stepToNpc — reach a WANDERING quest-giver and complete the step', () => {
    test('bot 8 tiles from a pacing Duke approaches, catches him in range, talks, gets the item', async () => {
        const world = new CoopWorld(openField());
        world.registerQuest([{ npc: 741, op: 'talk', varp: RM_VARP, whenState: 0, toState: 1, pages: 1, addItem: AIR_TALISMAN }]);
        world.addNpc(1, 741, 3210, 3221, { mode: 'wander', range: 2 });   // Duke PACES within 2 of spawn
        h = new CoopHarness(world);
        const q = mkQuester();
        q.setSteps([{ npcType: 741, xz: { x: 3210, z: 3221 }, op: 'talk', expectItem: AIR_TALISMAN }]);
        h.add({ bot: q as any, name: 'wander1', index: 10, x: 3202, z: 3221 });   // 8 tiles away
        await h.start();
        let ticks = 0;
        while (!(q as any).done && ticks < 600) { await h.tick(); ticks++; }
        expect((q as any).done).toBe(true);
        expect(world.questState(RM_VARP)).toBe(1);
        expect((q as any).countOf(AIR_TALISMAN)).toBeGreaterThan(0);
    }, 60_000);

    test('a USE-item step on a wandering npc also lands (the Aubury/OPNPCU class)', async () => {
        const RESEARCH_PACKAGE = 290;
        const world = new CoopWorld(openField());
        world.registerQuest([{ npc: 553, op: 'use', useItem: RESEARCH_PACKAGE, varp: 30, whenState: 0, toState: 1, requireItem: RESEARCH_PACKAGE, pages: 1, delItem: RESEARCH_PACKAGE }]);
        world.addNpc(2, 553, 3253, 3402, { mode: 'wander', range: 3 });   // Aubury, wider pace
        h = new CoopHarness(world);
        const q = mkQuester();
        q.setSteps([{ npcType: 553, xz: { x: 3253, z: 3402 }, op: 'use', useItem: RESEARCH_PACKAGE, consumeItem: RESEARCH_PACKAGE }]);
        h.add({ bot: q as any, name: 'wander2', index: 11, x: 3245, z: 3402, inv: [{ id: RESEARCH_PACKAGE, count: 1 }] });
        await h.start();
        let ticks = 0;
        while (!(q as any).done && ticks < 600) { await h.tick(); ticks++; }
        expect((q as any).done).toBe(true);
        expect(world.questState(30)).toBe(1);
    }, 60_000);
});

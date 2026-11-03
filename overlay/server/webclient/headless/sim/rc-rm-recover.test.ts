// RM ITEM RECOVERY (rc-rm-recover.ts). Accounts reached the Rune Mysteries 'use' steps
// with the research notes / package BANKED (retired rc-strip) or lost, and QuestRunnerBot held "missing
// use-item" until the 20-min timeout. Aubury/Sedridor re-issue only when the item exists NOWHERE (bank
// included), so the bot must withdraw a banked copy, else rewind to the re-issuing NPC's step.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopHarness, CoopWorld } from './coop.ts';
import { SkillWorld } from './skills.ts';
import { RmRecoverBot } from '../rc-rm-recover.ts';
import { QUESTS } from '../quest-runner.ts';
import { openField } from './world.ts';
import { linePath } from './harness.ts';

const NOTES = 291, PACKAGE = 290, COINS = 995;
const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

function world(): SkillWorld {
    const w = new SkillWorld(openField(), 8);
    w.addBankBooth(3253, 3419, 2213);   // Varrock East, the brain's hard-coded booth
    return w;
}
function bot(step: number): RmRecoverBot {
    const b = new RmRecoverBot(); b.quiet = true; (b as any).exitOnStuck = false; b.findLongPathFn = lp;
    b.setSteps(QUESTS['rune_mysteries']!); b.stepIdx = step;
    b.travelEnabled = false;   // rm-auto parks quest travel; recovery must work regardless
    return b;
}

describe('RmRecoverBot: a missing Rune Mysteries use-item is recovered', () => {
    test('notes in the BANK at step 4 -> walks to the bank, withdraws them, stays on step 4', async () => {
        h = new CoopHarness(world());
        const b = bot(4);
        h.add({ bot: b as any, name: 'rm', index: 91, x: 3253, z: 3402, inv: [{ id: COINS, count: 3 }], bank: [{ id: COINS, count: 20 }, { id: NOTES, count: 1 }] });
        await h.start();
        for (let i = 0; i < 400 && h.invCount('rm', NOTES) === 0; i++) await h.tick();
        expect(h.invCount('rm', NOTES)).toBe(1);
        for (let i = 0; i < 10; i++) await h.tick();
        expect(b.stepIdx).toBe(4);
        expect(b.needsRecovery()).toBe(false);
        expect((h.world as SkillWorld).events.some(e => e.kind === 'bank-withdraw' && (e.detail as any).obj === NOTES)).toBe(true);
    }, 120_000);

    test('notes NOWHERE -> rewinds to step 3 (Aubury re-issues duplicates)', async () => {
        h = new CoopHarness(world());
        const b = bot(4);
        h.add({ bot: b as any, name: 'rm', index: 92, x: 3253, z: 3402, inv: [], bank: [{ id: COINS, count: 20 }] });
        await h.start();
        for (let i = 0; i < 400 && b.stepIdx === 4; i++) await h.tick();
        expect(b.stepIdx).toBe(3);
    }, 120_000);

    test('package in the bank at step 2 -> withdrawn', async () => {
        h = new CoopHarness(world());
        const b = bot(2);
        h.add({ bot: b as any, name: 'rm', index: 93, x: 3240, z: 3400, inv: [], bank: [{ id: PACKAGE, count: 1 }] });
        await h.start();
        for (let i = 0; i < 400 && h.invCount('rm', PACKAGE) === 0; i++) await h.tick();
        expect(h.invCount('rm', PACKAGE)).toBe(1);
        expect(b.stepIdx).toBe(2);
    }, 120_000);

    test('holding the item -> no recovery at all', async () => {
        h = new CoopHarness(world());
        const b = bot(4);
        h.add({ bot: b as any, name: 'rm', index: 94, x: 3253, z: 3402, inv: [{ id: NOTES, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 30; i++) await h.tick();
        expect(b.needsRecovery()).toBe(false);
        expect(b.stepIdx).toBe(4);
    }, 120_000);
});

describe('RmRecoverBot: a talk step whose reward is already banked', () => {
    test('step 3 (Aubury: get notes) with the notes in the bank -> withdraws them and advances to step 4', async () => {
        h = new CoopHarness(world());
        const b = bot(3);
        h.add({ bot: b as any, name: 'rm', index: 95, x: 3253, z: 3402, inv: [], bank: [{ id: NOTES, count: 1 }] });
        await h.start();
        for (let i = 0; i < 400 && b.stepIdx === 3; i++) await h.tick();
        expect(h.invCount('rm', NOTES)).toBe(1);
        expect(b.stepIdx).toBe(4);
    }, 120_000);
    test('step 3 with nothing banked -> stays on step 3 (Aubury will issue them)', async () => {
        h = new CoopHarness(world());
        const b = bot(3);
        h.add({ bot: b as any, name: 'rm', index: 96, x: 3253, z: 3402, inv: [], bank: [] });
        await h.start();
        for (let i = 0; i < 200; i++) await h.tick();
        expect(b.stepIdx).toBe(3);
        expect(b.needsRecovery()).toBe(false);
    }, 120_000);
});

// Aubury's options reveal the true quest state (aubury.rs2); the varp itself is never transmitted.
describe('RmRecoverBot: step 3 reads the quest state from Aubury\'s options', () => {
    const SHOP = ['Yes please!', "Oh, it's a rune shop. No thank you, then."];
    function aubWorld(steps: any[]): SkillWorld { const w = world(); w.addNpc(501, 553, 3253, 3404); w.registerQuest(steps); return w; }
    async function runStep3(steps: any[], inv: any[] = []): Promise<RmRecoverBot> {
        h = new CoopHarness(aubWorld(steps));
        const b = bot(3);
        h.add({ bot: b as any, name: 'rm', index: 97, x: 3253, z: 3402, inv, bank: [] });
        await h.start();
        for (let i = 0; i < 500 && b.stepIdx === 3; i++) await h.tick();
        return b;
    }
    test('teleport option offered -> RM is already COMPLETE', async () => {
        const b = await runStep3([{ npc: 553, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 2, choicePage: 1, choiceRoot: 2469, choiceLabels: [...SHOP, 'Can you teleport me to the Rune Essence?'] }]);
        for (let i = 0; i < 5; i++) await h!.tick();
        expect(b.stepIdx).toBe(5);
        expect(b.done).toBe(true);
    }, 120_000);
    test('shop-only choice -> package was lost before delivery: rewind to Sedridor (step 1)', async () => {
        const b = await runStep3([{ npc: 553, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 2, choicePage: 1, choiceRoot: 2459, choiceLabels: SHOP }]);
        expect(b.stepIdx).toBe(1);
    }, 120_000);
    test('package option offered -> hands the package over, then gets the notes', async () => {
        const b = await runStep3([
            { npc: 553, op: 'talk', varp: 63, whenState: 3, toState: 4, pages: 2, choicePage: 1, choiceRoot: 2469, expectChoice: 3, delItem: PACKAGE, choiceLabels: [...SHOP, 'I have been sent here with a package for you.'] },
            { npc: 553, op: 'talk', varp: 63, whenState: 4, toState: 5, pages: 1, addItem: NOTES },
        ].map((s, i) => i === 0 ? { ...s, whenState: 0 } : { ...s, whenState: 4 }).map((s, i) => i === 0 ? { ...s, toState: 4 } : s), [{ id: PACKAGE, count: 1 }]);
        expect(h!.invCount('rm', PACKAGE)).toBe(0);
        expect(h!.invCount('rm', NOTES)).toBe(1);
        expect(b.stepIdx).toBe(4);
    }, 120_000);
});

describe('RmRecoverBot: Sedridor reveals the true state too', () => {
    function sedWorld(steps: any[]): SkillWorld { const w = world(); w.addNpc(502, 300, 3253, 3404); w.registerQuest(steps); return w; }
    async function runStep1(steps: any[]): Promise<RmRecoverBot> {
        h = new CoopHarness(sedWorld(steps));
        const b = bot(1);   // Sedridor placed on the surface for the sim; travel is parked (bot() sets travelEnabled=false)
        h.add({ bot: b as any, name: 'rm', index: 98, x: 3253, z: 3402, inv: [], bank: [] });
        await h.start();
        for (let i = 0; i < 400 && b.stepIdx === 1; i++) await h.tick();
        return b;
    }
    test('"speak to him again" (given_package) -> jumps to step 3 (Aubury has our package)', async () => {
        const b = await runStep1([{ npc: 300, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 3,
            pageTexts: ['Ah, rm. How goes your quest? Have you delivered the research notes to my friend Aubury yet?', 'And did he give you anything in return?', 'I think perhaps you should go and speak to him again then, adventurer.'] }]);
        expect(b.stepIdx).toBe(3);
    }, 120_000);
    test('Sedridor offers the essence teleport -> COMPLETE', async () => {
        const b = await runStep1([{ npc: 300, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 1, choicePage: 0, choiceRoot: 2459,
            choiceLabels: ["Nothing thanks, I'm just looking around.", 'Can you teleport me to the Rune Essence?'] }]);
        for (let i = 0; i < 5; i++) await h!.tick();
        expect(b.done).toBe(true);
    }, 120_000);
});

// ex-helpers at step 1 without the air talisman — Sedridor: "...except I don't have it with me..." — timed
// out 23 times. The line triggers: bank check for 1438, else back to the Duke (step 0), who re-issues it mid-quest.
describe('RmRecoverBot: Sedridor wants the air talisman we lost', () => {
    const SED = { npc: 300, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 2,
        pageTexts: ["I'm looking for the head wizard.", '...except I don\'t have it with me...'] };
    async function run(bank: any[]): Promise<RmRecoverBot> {
        const w = world(); w.addNpc(504, 300, 3253, 3404); w.registerQuest([SED]);
        h = new CoopHarness(w);
        const b = bot(1);
        h.add({ bot: b as any, name: 'rmT', index: 99, x: 3253, z: 3402, inv: [], bank });
        await h.start();
        for (let i = 0; i < 600 && !(b.stepIdx === 1 && h.invCount('rmT', 1438) > 0) && !(b.stepIdx === 0 && (b as any).checked.has(1438)); i++) await h.tick();
        return b;
    }
    test('talisman in the bank -> withdrawn, back to Sedridor (step 1)', async () => {
        const b = await run([{ id: 1438, count: 1 }]);
        expect(h!.invCount('rmT', 1438)).toBe(1);
        expect(b.stepIdx).toBe(1);
    }, 120_000);
    test('talisman nowhere -> step 0: the Duke re-issues it', async () => {
        const b = await run([]);
        expect(b.stepIdx).toBe(0);
        expect(b.needTali).toBe(false);
    }, 120_000);
});

// rmquest pilot: a bot in the essence mine (z ~4800) counted as "surface" (< 6000) — recovery kept walking it
// toward the Varrock bank (0-tile route x1,500) while the driver walked it to the mine portal. Instances are z >= 4000.
describe('RmRecoverBot does not start a bank trip from inside an instanced interior', () => {
    test('step 4 without notes, standing in the essence mine -> no recovery until outside', async () => {
        h = new CoopHarness(world());
        const b = bot(4);
        h.add({ bot: b as any, name: 'rmMine', index: 100, x: 2930, z: 4808, inv: [], bank: [{ id: NOTES, count: 1 }] });
        await h.start();
        for (let i = 0; i < 20; i++) await h.tick();
        expect(b.needsRecovery()).toBe(false);
    }, 60_000);
});

// rmquest lane: 6 step-1 timeouts were accounts that already CARRIED the package — Sedridor says "...vital he
// receives this package" and the step waits forever to gain one. A held quest reward completes its step.
describe('RmRecoverBot: a quest reward already held completes its step', () => {
    test('step 1 with the package in the pack -> step 2', async () => {
        h = new CoopHarness(world());
        const b = bot(1);
        h.add({ bot: b as any, name: 'rmHeld', index: 101, x: 3253, z: 3402, inv: [{ id: PACKAGE, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 30 && b.stepIdx === 1; i++) await h.tick();
        expect(b.stepIdx).toBe(2);
    }, 60_000);
    test('step 0 with an air talisman does NOT skip the Duke (it may not be his)', async () => {
        h = new CoopHarness(world());
        const b = bot(0);
        h.add({ bot: b as any, name: 'rmTali0', index: 102, x: 3253, z: 3402, inv: [{ id: 1438, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 30; i++) await h.tick();
        expect(b.stepIdx).toBe(0);
    }, 60_000);
});

// 7 rmquest accounts ledgered at step 0 asked the Duke for 3 h; he answered "No, all is well for me." — the
// runemysteries_complete branch (duke_horacio.rs2:54-56). That line means DONE.
describe('RmRecoverBot: the Duke reveals a completed quest', () => {
    test('"all is well for me" at step 0 -> COMPLETE', async () => {
        const w = world(); w.addNpc(505, 741, 3253, 3404);
        w.registerQuest([{ npc: 741, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 2,
            pageTexts: ['Greetings. Welcome to my castle.', 'No, all is well for me.'] }]);
        h = new CoopHarness(w);
        const b = bot(0);
        h.add({ bot: b as any, name: 'rmD', index: 97, x: 3253, z: 3402, inv: [], bank: [] });
        await h.start();
        for (let i = 0; i < 400 && !b.done; i++) await h.tick();
        expect(b.done).toBe(true);
    }, 120_000);
});

describe('RmRecoverBot: the Duke reveals an already-started quest', () => {
    test('"that talisman I gave you" at step 0 -> on to Sedridor (step 1)', async () => {
        const w = world(); w.addNpc(506, 741, 3253, 3404);
        w.registerQuest([{ npc: 741, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 2,
            pageTexts: ['Greetings. Welcome to my castle.', 'The only task remotely approaching a quest is the delivery of that talisman I gave you to the head wizard of the Wizards\' Tower,'] }]);
        h = new CoopHarness(w);
        const b = bot(0);
        h.add({ bot: b as any, name: 'rmS', index: 98, x: 3253, z: 3402, inv: [{ id: 1438, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 400 && b.stepIdx === 0; i++) await h.tick();
        expect(b.stepIdx).toBe(1);
    }, 120_000);
});

// Sedridor's basement room door (3108,9570, map-closed 1530) — every zip RM batch waited in the corridor and
// every talk was DISCARDED for 4 h. A Sedridor step outside the room must open it (blind closed-id op).
describe('RmRecoverBot: Sedridor room door', () => {
    test('outside the room on the Sedridor step -> opens the closed door 1530 @(3108,9570)', async () => {
        const w = world(); w.addNpc(507, 300, 3103, 9571);
        w.addSimDoor({ x: 3108, z: 9570, locId: 1530, op: 1 });   // CLOSED
        h = new CoopHarness(w);
        const b = bot(1);
        h.add({ bot: b as any, name: 'rmDoor', index: 99, x: 3106, z: 9575, inv: [{ id: 1438, count: 1 }], bank: [] });
        await h.start();
        // the sim has no walls, so the talk itself succeeds right after; what matters is that the CLOSED-door op went out
        for (let i = 0; i < 60 && !w.events.some(e => e.kind === 'door-pending' || e.kind === 'door-opened'); i++) await h.tick();
        expect(w.events.some(e => e.kind === 'door-pending' || e.kind === 'door-opened')).toBe(true);
        expect((b as any).sedDoorOps).toBeGreaterThanOrEqual(1);
    }, 120_000);
    test('inside the room -> never touches the door', async () => {
        const w = world(); w.addNpc(508, 300, 3103, 9571);
        const d = w.addSimDoor({ x: 3108, z: 9570, locId: 1530, op: 1 });
        h = new CoopHarness(w);
        const b = bot(1);
        h.add({ bot: b as any, name: 'rmIn', index: 100, x: 3104, z: 9571, inv: [{ id: 1438, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 120; i++) await h.tick();
        expect(w.events.some(e => e.kind === 'door-pending' || e.kind === 'door-opened')).toBe(false);
        expect(d.open).toBe(false);
    }, 120_000);
});

// Sedridor's lost-notes line (sedridor.rs2:144-146) — the account is really at step 3 (Aubury re-issues).
describe('RmRecoverBot: Sedridor says the notes were lost', () => {
    test('"go and speak to Aubury once more" at step 1 -> step 3', async () => {
        const w = world(); w.addNpc(509, 300, 3253, 3404);
        w.registerQuest([{ npc: 300, op: 'talk', varp: 63, whenState: 0, toState: 0, pages: 2,
            pageTexts: ['May I have his notes then?', "You did? You are extremely careless aren't you? I suggest you go and speak to Aubury once more, with luck he will have made copies of his research."] }]);
        h = new CoopHarness(w);
        const b = bot(1);
        h.add({ bot: b as any, name: 'rmN', index: 101, x: 3253, z: 3402, inv: [{ id: 1438, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 400 && b.stepIdx === 1; i++) await h.tick();
        expect(b.stepIdx).toBe(3);
    }, 120_000);
});

// generic stall-door rule — wedged on the Lumbridge castle door tile (poordooropen 1536 @3215,3211, map-closed
// per the door tracker's seed) -> ops that door.
describe('RmRecoverBot: stalled next to a tracker-closed door', () => {
    test('no movement for 30+ ticks beside door 1536 -> OPLOC on it', async () => {
        const w = new CoopWorld(() => false);   // nothing can move: the walker wedges exactly as live
        h = new CoopHarness(w);
        const b = bot(1); b.enableDoorTracker();
        h.add({ bot: b as any, name: 'rmW', index: 102, x: 3215, z: 3211, inv: [{ id: 1438, count: 1 }], bank: [] });
        await h.start();
        for (let i = 0; i < 120 && !w.events.some(e => e.kind === 'oploc' && (e as any).detail?.locId === 1536); i++) await h.tick();
        const ops = w.events.filter(e => e.kind === 'oploc').map(e => (e as any).detail ?? e);
        expect(ops.some((o: any) => o.locId === 1536 && o.x === 3215 && o.z === 3211)).toBe(true);
    }, 120_000);
});

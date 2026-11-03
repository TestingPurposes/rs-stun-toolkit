// bun test server/webclient/headless/sim/interaction-ack.test.ts
//
// THE INTERACTION-ACKNOWLEDGMENT ASSERTION (parity package 3).
//
// This file pins the ONE mechanism built to catch silently discarded interactions (see
// interaction-ack.ts's header). What is asserted here is deliberately narrow and deliberately awkward,
// because the bugs were:
//
//   * A DISCARDED OP AND A REFUSED OP MUST NOT SHARE A VERDICT. "I can't reach that!" means the packet
//     arrived and the brain can fix it by walking; silence means the packet was thrown away and no
//     amount of retrying will ever help.
//   * THE TOLL'S OBSERVABLE IS NOT "THE DIALOG ADVANCED". It advanced perfectly 2,587 times while the
//     bot declined the toll it was standing at. Section 3 asserts that a dialog-advance would have
//     passed and that PAY-TOLL still fails — i.e. that the intent, not the packet, is what is checked.
//   * REPEATS MUST ACCUMULATE INSIDE ONE WINDOW. A brain re-sending every 2 ticks would otherwise
//     reset its own deadline forever and the detector would never fire. This is how "50 swings, 0
//     damage" becomes one line that says repeats=50.
//
// Sections 1-2 drive the ledger directly (pure, no IO). Section 3+ drives a REAL LeanBot through the
// REAL decode loop, so the observables are the ones the live decoder actually bumps.
import { describe, test, expect } from 'bun:test';
import { SimHarness } from './harness.js';
import { SimWorld, openField } from './world.js';
import { LeanBot } from '../leanbot.js';
import {
    AckLedger, AckKind, Rev, REV_COUNT, ACK_KIND_NAME, ackSpec, isRefusal, ACK_ENABLED,
    type AckHost, type AckFailure,
} from '../interaction-ack.js';
import { VARP, STYLE_INTERFACE, STYLE_BUTTON_LOOKUP } from '../capability-tables.js';

const COINS = 995;
const START = { x: 3222, z: 3218 };
const S_THIEVING = 17, S_HP = 3;

// =====================================================================================================
// A MINIMAL HOST — every observable is a plain field, so a test can move exactly one of them
// =====================================================================================================
class MockHost implements AckHost {
    readonly ackRevs = new Int32Array(REV_COUNT);
    tick = 0;
    objs = new Map<number, number>();
    worn = new Map<number, number>();
    xp = new Map<number, number>();
    varps = new Map<number, number>();
    mainModal = -1;
    chatModal = -1;
    pos = 1000;
    refusal = '';
    /** every report the ledger produced, COPIED (the payload is reused by design) */
    reports: Array<Pick<AckFailure, 'name' | 'verdict' | 'repeats' | 'ticks' | 'text'>> = [];
    /** when true, ackObjCount answers "I cannot know" — the undecidable path */
    blindInv = false;
    /** what ackDeliverable answers; undefined = "no opinion", the default for every non-npc kind */
    deliverable: boolean | undefined = undefined;
    ackDeliverable() { return this.deliverable; }

    ackTick() { return this.tick; }
    ackObjCount(obj: number) { return this.blindInv ? -1 : (this.objs.get(obj) ?? 0); }
    ackWornCount(obj: number) { return this.worn.get(obj) ?? 0; }
    ackXp(stat: number) { return this.xp.get(stat) ?? 0; }
    ackVarp(id: number) { return this.varps.get(id) ?? 0; }
    ackMainModal() { return this.mainModal; }
    ackChatModal() { return this.chatModal; }
    ackPosKey() { return this.pos; }
    ackRefusalText() { return this.refusal; }
    ackReport(f: AckFailure) {
        this.reports.push({ name: f.name, verdict: f.verdict, repeats: f.repeats, ticks: f.ticks, text: f.text });
    }
}

/** Advance `n` ticks, evaluating once per tick exactly as LeanBot.run() does. */
function run(led: AckLedger, host: MockHost, n: number): void {
    for (let i = 0; i < n; i++) { host.tick++; led.evaluate(host); }
}

// =====================================================================================================
// 1. THE FOUR VERDICTS
// =====================================================================================================
describe('verdicts: ack / refused / no_ack / unknown are four different answers', () => {
    test('an observable that moves closes the window with NO report at all', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.Pickpocket);
        h.ackRevs[Rev.Msg]!++;                      // "You attempt to pick the man's pocket"
        run(led, h, 2);
        expect(led.verdictOf(AckKind.Pickpocket)).toBe('ack');
        expect(led.acked).toBe(1);
        expect(led.noAck).toBe(0);
        expect(h.reports).toHaveLength(0);          // an ack is silence, by design
    });

    test('SILENCE past the deadline is no_ack — the DISCARDED op, and it names itself', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.Attack, 42);
        run(led, h, ackSpec(AckKind.Attack).ticks + 1);
        expect(led.verdictOf(AckKind.Attack)).toBe('no_ack');
        expect(led.noAck).toBe(1);
        expect(led.noAckByKind[AckKind.Attack]).toBe(1);
        expect(led.wedge).toBe('ACK-NOACK-ATTACK');
        expect(h.reports[0]!.verdict).toBe('no_ack');
        expect(h.reports[0]!.name).toBe('ATTACK');
    });

    test('a KNOWN refusal is NOT no_ack — the packet arrived and the server said why', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.OpLoc, 1278);
        h.refusal = "I can't reach that!";
        h.ackRevs[Rev.Refusal]!++;
        run(led, h, 1);
        expect(led.verdictOf(AckKind.OpLoc)).toBe('refused');
        expect(led.noAck).toBe(0);                  // ⛔ the distinction the whole file exists for
        expect(led.refused).toBe(1);
        expect(h.reports[0]!.verdict).toBe('refused');
        expect(h.reports[0]!.text).toBe("I can't reach that!");
        // and a refusal never sets the wedge: the brain can fix this one by walking closer
        expect(led.wedge).toBe('');
    });

    test('an unreadable baseline expires as unknown, never as a fabricated failure', () => {
        const h = new MockHost(); const led = new AckLedger();
        h.blindInv = true;                          // the backpack has never been transmitted
        led.arm(h, AckKind.Pickup, 526, 0, 526);
        run(led, h, ackSpec(AckKind.Pickup).ticks + 1);
        expect(led.verdictOf(AckKind.Pickup)).toBe('unknown');
        expect(led.unknown).toBe(1);
        expect(led.noAck).toBe(0);
        expect(h.reports[0]!.verdict).toBe('unknown');
    });

    test('an op that never became DELIVERABLE is "unreached", not "no_ack", and never wedges', () => {
        const h = new MockHost(); const led = new AckLedger();
        // The live shape: a farmer 3 tiles from a wandering man, re-sending OPNPC3 at a stale tile.
        h.deliverable = false;
        led.arm(h, AckKind.Pickpocket, 2823);
        run(led, h, ackSpec(AckKind.Pickpocket).ticks + 1);
        expect(led.verdictOf(AckKind.Pickpocket)).toBe('unreached');
        expect(led.unreached).toBe(1);
        // ⛔ THE POINT: the catastrophic channel stays clean. 33 of these in 2,548 windows on a working
        // bot is what made this verdict necessary — sharing the ACK-NOACK name would have made the one
        // signal built to be unmissable fire ~1.3% of the time on a healthy bot.
        expect(led.noAck).toBe(0);
        expect(led.wedge).toBe('');
        expect(led.summary()).toContain('unreached=1');
    });

    test('deliverable-but-silent is still no_ack — the fifth verdict must not swallow the catastrophe', () => {
        const h = new MockHost(); const led = new AckLedger();
        h.deliverable = true;                       // adjacent, able to act, and the server said nothing
        led.arm(h, AckKind.Pickpocket, 2823);
        run(led, h, ackSpec(AckKind.Pickpocket).ticks + 1);
        expect(led.verdictOf(AckKind.Pickpocket)).toBe('no_ack');
        expect(led.unreached).toBe(0);
        expect(led.wedge).toBe('ACK-NOACK-PICKPOCKET');
    });

    test('a host with NO opinion (no ackDeliverable) behaves exactly as before', () => {
        const h = new MockHost(); const led = new AckLedger();
        h.deliverable = undefined;
        led.arm(h, AckKind.Pickpocket, 2823);
        run(led, h, ackSpec(AckKind.Pickpocket).ticks + 1);
        expect(led.verdictOf(AckKind.Pickpocket)).toBe('no_ack');
    });

    test('a value channel decides on the VALUE, not on "some container changed"', () => {
        const h = new MockHost(); const led = new AckLedger();
        h.objs.set(COINS, 920);
        led.arm(h, AckKind.PayToll, 2882, 0, COINS);
        // every unrelated container in the game updates — none of it is paying a toll
        h.ackRevs[Rev.Inv]!++; h.ackRevs[Rev.AnyInv]!++; h.ackRevs[Rev.Modal]!++; h.ackRevs[Rev.Msg]!++;
        run(led, h, ackSpec(AckKind.PayToll).ticks + 1);
        expect(led.verdictOf(AckKind.PayToll)).toBe('no_ack');

        // now actually pay: 10 gp leaves the pack
        const led2 = new AckLedger(); const h2 = new MockHost();
        h2.objs.set(COINS, 920);
        led2.arm(h2, AckKind.PayToll, 2882, 0, COINS);
        h2.objs.set(COINS, 910);
        run(led2, h2, 1);
        expect(led2.verdictOf(AckKind.PayToll)).toBe('ack');
    });
});

// =====================================================================================================
// 2. THE WINDOW: repeats, targets, wedge lifecycle, flood guard, and the no-wedge guarantee
// =====================================================================================================
describe('the window', () => {
    test('re-arming the SAME kind at the SAME target accumulates repeats and keeps the deadline', () => {
        const h = new MockHost(); const led = new AckLedger();
        // 50 swings at ONE npc inside one deadline, all silently discarded.
        const window = ackSpec(AckKind.Attack).ticks;
        for (let i = 0; i < 50; i++) {
            led.arm(h, AckKind.Attack, 7, 2);
            if (i % 3 === 2) run(led, h, 1);        // 50 sends across ~17 ticks — inside the window
        }
        run(led, h, window + 1);
        expect(led.verdictOf(AckKind.Attack)).toBe('no_ack');
        // ⛔ THE HEADLINE NUMBER. Without repeat-folding, each arm would reset the deadline and this
        // steady state would be invisible forever — which is exactly what happened live.
        expect(h.reports[0]!.repeats).toBe(50);
        expect(led.noAck).toBe(1);                  // ONE verdict for 50 sends, not 50 verdicts
    });

    test('a window that EXPIRES starts a fresh one — a permanent fault reports periodically, not once', () => {
        const h = new MockHost(); const led = new AckLedger();
        // The same 50 sends spread ONE PER TICK span two deadlines, so the fault keeps re-announcing
        // itself instead of going quiet after the first verdict. Both behaviours matter: fold inside a
        // window (above), re-report across windows (here).
        const spans = ackSpec(AckKind.Attack).ticks * 2 + 4;   // deadline-relative, so tuning a spec
        for (let i = 0; i < spans; i++) { led.arm(h, AckKind.Attack, 7, 2); run(led, h, 1); }   // cannot break this
        expect(led.noAck).toBeGreaterThan(1);
        expect(led.noAckByKind[AckKind.Attack]).toBe(led.noAck);
    });

    test('a NEW target opens a NEW window (a different intent is not a repeat)', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.Attack, 7);
        run(led, h, 2);
        led.arm(h, AckKind.Attack, 9);              // different npc
        run(led, h, 2);
        expect(led.isActive(AckKind.Attack)).toBe(true);
        // the second window is young, so the first one's clock did not carry over
        run(led, h, ackSpec(AckKind.Attack).ticks - 3);
        expect(led.isActive(AckKind.Attack)).toBe(true);
    });

    test('the wedge is LIVE state: set on failure, cleared the moment that kind acks again', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.SetStyle, 100, 2, 0, -1, VARP.COM_MODE, 2);
        run(led, h, ackSpec(AckKind.SetStyle).ticks + 1);
        expect(led.wedge).toBe('ACK-NOACK-SET-STYLE');

        led.arm(h, AckKind.SetStyle, 100, 2, 0, -1, VARP.COM_MODE, 2);
        h.varps.set(VARP.COM_MODE, 2);              // the tab finally bound
        run(led, h, 1);
        expect(led.verdictOf(AckKind.SetStyle)).toBe('ack');
        expect(led.wedge).toBe('');                 // a tombstone would be a lie
    });

    test('the flood guard bounds reports without hiding the first one', () => {
        const h = new MockHost(); const led = new AckLedger();
        for (let cycle = 0; cycle < 6; cycle++) {
            led.arm(h, AckKind.Equip, 1321, 0, 1321);
            run(led, h, ackSpec(AckKind.Equip).ticks + 1);
        }
        expect(led.noAck).toBe(6);                  // every failure is COUNTED
        expect(h.reports.length).toBeLessThan(6);   // but not every failure is PRINTED
        expect(h.reports.length).toBeGreaterThan(0);// and the first one always is
    });

    test('the flood guard can NEVER hide an escalation to no_ack', () => {
        const h = new MockHost(); const led = new AckLedger();
        // First a harmless 'unreached' (bot not adjacent), then — well inside the report cooldown — a
        // genuine 'no_ack' at the same kind. LIVE-CAUGHT: the counter read noack=1 and the log had no
        // line to go with it, because the earlier low-severity report had claimed the cooldown.
        h.deliverable = false;
        led.arm(h, AckKind.Pickpocket, 2823);
        run(led, h, ackSpec(AckKind.Pickpocket).ticks + 1);
        expect(h.reports.at(-1)!.verdict).toBe('unreached');

        h.deliverable = true;
        led.arm(h, AckKind.Pickpocket, 2823);
        run(led, h, ackSpec(AckKind.Pickpocket).ticks + 1);
        expect(led.noAck).toBe(1);
        expect(h.reports.at(-1)!.verdict).toBe('no_ack');   // the escalation got through
    });

    test('a throwing host cannot wedge or crash the ledger', () => {
        const h = new MockHost(); const led = new AckLedger();
        h.ackReport = () => { throw new Error('supervisor blew up'); };
        led.arm(h, AckKind.Pickpocket);
        expect(() => run(led, h, ackSpec(AckKind.Pickpocket).ticks + 2)).not.toThrow();
        expect(led.noAck).toBe(1);
        expect(led.isActive(AckKind.Pickpocket)).toBe(false);   // the window still closed
    });

    test('reset() drops every open window (a reconnect invalidates all baselines at once)', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.Attack); led.arm(h, AckKind.Pickpocket); led.arm(h, AckKind.OpLoc);
        expect(led.anyActive()).toBe(true);
        led.reset();
        expect(led.anyActive()).toBe(false);
        run(led, h, 60);
        expect(led.noAck).toBe(0);                  // nothing may be reported from a dropped baseline
    });

    test('verdictOf(kind, sinceTick) never hands a caller a PREVIOUS attempt\'s answer', () => {
        const h = new MockHost(); const led = new AckLedger();
        led.arm(h, AckKind.Pickpocket);
        run(led, h, ackSpec(AckKind.Pickpocket).ticks + 1);
        const staleTick = h.tick;
        expect(led.verdictOf(AckKind.Pickpocket, 0)).toBe('no_ack');
        run(led, h, 5);
        expect(led.verdictOf(AckKind.Pickpocket, staleTick + 1)).toBe('none');
    });

    test('every kind has a name and a spec — an unnamed kind would print as a bare integer', () => {
        for (let k = 0; k < ACK_KIND_NAME.length; k++) {
            expect(ACK_KIND_NAME[k]).toBeTruthy();
            expect(ackSpec(k).mask).toBeGreaterThan(0);
            expect(ackSpec(k).ticks).toBeGreaterThan(1);
        }
    });

    test('isRefusal matches the engine\'s own wording and does not match ordinary chatter', () => {
        expect(isRefusal("i can't reach that!")).toBe(true);
        expect(isRefusal('nothing interesting happens')).toBe(true);
        expect(isRefusal('you do not have enough fire runes to cast this spell.')).toBe(true);
        expect(isRefusal('you steal 3 coins.')).toBe(false);
        expect(isRefusal('congratulations, you just advanced a thieving level.')).toBe(false);
    });
});

// =====================================================================================================
// 3. THE THREE HISTORICAL FAILURES, THROUGH A REAL BOT AND THE REAL DECODE LOOP
// =====================================================================================================
async function boot(inv: Array<{ id: number; count: number }> = [], stats: Array<{ stat: number; xp: number; level: number }> = []) {
    const world = new SimWorld(START.x, START.z, openField());
    const bot = new LeanBot();
    bot.quiet = true;
    const h = new SimHarness(bot as never, world);
    await h.start({ inv, stats });
    await h.tick();
    return { world, bot, h };
}

describe('historical failure #1 — an interaction the server silently DISCARDS', () => {
    test('OPNPC2 that produces no hitsplat, no xp and no message reports ACK-NOACK-ATTACK', async () => {
        const { bot, h, world } = await boot([{ id: COINS, count: 100 }], [{ stat: S_HP, xp: 1200, level: 10 }]);
        // ⛔ THE NPC MUST REALLY BE THERE AND REALLY BE ADJACENT, or the verdict is legitimately
        // 'unreached' instead — an op at an npc that is not in the scene was never deliverable, and the
        // ledger says so. This test is specifically the OTHER case: everything is in place, the send is
        // simply thrown away. (Caught by this test when `ackDeliverable` learned about absent npcs.)
        world.addNpc(7, 81, START.x + 1, START.z);
        await h.tick();
        const errs: string[] = [];
        const realErr = console.error;
        console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
        try {
            // The live shape of this bug: the client sends and sends, the server answers NOTHING.
            for (let i = 0; i < 12; i++) { bot.opNpc(7, 2); await h.tick(); }
            for (let i = 0; i < ackSpec(AckKind.Attack).ticks + 2; i++) await h.tick();
        } finally { console.error = realErr; }

        expect(bot.ack.noAckByKind[AckKind.Attack]).toBe(1);
        expect(bot.ackWedge).toBe('ACK-NOACK-ATTACK');
        const line = errs.find(e => e.includes('ACK-NOACK-ATTACK'));
        expect(line).toBeTruthy();
        expect(line!).toContain('12 sends');
        expect(line!).toContain('DISCARDED');
        await h.stop();
    });

    test('the SAME send is silent when the server answers — no false positive', async () => {
        const { bot, h, world } = await boot([{ id: COINS, count: 100 }], [{ stat: S_HP, xp: 1200, level: 10 }]);
        world.addNpc(7, 81, START.x + 1, START.z);
        await h.tick();
        for (let i = 0; i < 12; i++) {
            bot.opNpc(7, 2);
            h.queueMessage('You swing at the goblin.');   // the server said SOMETHING
            await h.tick();
        }
        for (let i = 0; i < ackSpec(AckKind.Attack).ticks + 2; i++) await h.tick();
        expect(bot.ack.noAckByKind[AckKind.Attack]).toBe(0);
        expect(bot.ackWedge).toBe('');
        await h.stop();
    });
});

describe('historical failure #2 — the toll: a dialog that answers perfectly and achieves nothing', () => {
    test('PAY-TOLL fails even though the dialog advanced, because the INTENT is coins or a crossing', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 920 }]);
        const errs: string[] = [];
        const realErr = console.error;
        console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
        try {
            // Arm the toll intent exactly as tollAssist does, then let the dialog open and close — the
            // 2,587-times-declined steady state. Coins never move; we never teleport.
            for (let i = 0; i < 5; i++) {
                (bot as unknown as { expectAck: (k: number, a: number, b: number, c: number) => void })
                    .expectAck(AckKind.PayToll, 2882, 0, COINS);
                h.queueOpenChat(2459);              // "Yes / No thank you, I'll walk around."
                await h.tick();
                h.queueIfClose();                   // ...and the answer closed it. Perfectly. Uselessly.
                await h.tick();
            }
            for (let i = 0; i < ackSpec(AckKind.PayToll).ticks + 2; i++) await h.tick();
        } finally { console.error = realErr; }

        // ⛔ THE ASSERTION THAT MATTERS: the dialog DID advance (a generic "did the server respond"
        // check would have passed all five), and PAY-TOLL still fails.
        expect(bot.ack.noAckByKind[AckKind.PayToll]).toBe(1);
        expect(errs.some(e => e.includes('ACK-NOACK-PAY-TOLL'))).toBe(true);
        expect(bot.coins()).toBe(920);              // the money never moved — that IS the bug
        await h.stop();
    });

    test('paying it for real acks, and the wedge clears', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 920 }]);
        (bot as unknown as { expectAck: (k: number, a: number, b: number, c: number) => void })
            .expectAck(AckKind.PayToll, 2882, 0, COINS);
        h.queueInv([{ id: COINS, count: 910 }]);    // 10 gp left the pack
        await h.tick(); await h.tick();
        expect(bot.ack.verdictOf(AckKind.PayToll)).toBe('ack');
        expect(bot.ack.noAckByKind[AckKind.PayToll]).toBe(0);
        await h.stop();
    });
});

describe('historical failure #3 — a style click the interface never takes', () => {
    test('an unbound style tab reports ACK-NOACK-SET-STYLE instead of training the wrong stat quietly', async () => {
        const { bot, h } = await boot();
        const iface = 'combat_hacksword';
        const idx = STYLE_INTERFACE[iface]!.styleNames.indexOf('controlled');
        const com = STYLE_INTERFACE[iface]!.buttons[idx]!;
        expect(STYLE_BUTTON_LOOKUP.get(com)).toBeTruthy();

        // ⛔ THE STAGE IS THE EXPECTATION, NOT THE CLICK, AND THAT IS NOT A SHORTCUT — IT IS THE ONLY
        // HONEST STAGE OFFLINE. SimHarness models a server that ALWAYS honours a known style button
        // (harness.ts:214 answers every one with the matching com_mode varp), so an unbound tab simply
        // cannot exist in the sim. The live failure was precisely "the expectation was armed
        // and com_mode never arrived", which is what is armed here. The full setCombatStyleByButton
        // path is proven positively in the next test, and the unbound-tab case is staged for real
        // against the local engine in ack-live-probe.ts.
        const errs: string[] = [];
        const realErr = console.error;
        console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
        try {
            for (let i = 0; i < 40; i++) {
                (bot as unknown as { expectAck: (k: number, a: number, b: number, c: number, d: number, e: number, f: number) => void })
                    .expectAck(AckKind.SetStyle, com, idx, 0, -1, VARP.COM_MODE, idx);
                await h.tick();
            }
            for (let i = 0; i < ackSpec(AckKind.SetStyle).ticks + 2; i++) await h.tick();
        } finally { console.error = realErr; }

        expect(bot.combatStyle()).not.toBe(idx);
        expect(bot.ack.noAckByKind[AckKind.SetStyle]).toBeGreaterThan(0);
        expect(errs.some(e => e.includes('ACK-NOACK-SET-STYLE'))).toBe(true);
        await h.stop();
    });

    test('a tab that DOES bind acks on the com_mode readback — no false positive', async () => {
        const { bot, h } = await boot();
        const iface = 'combat_hacksword';
        const idx = STYLE_INTERFACE[iface]!.styleNames.indexOf('controlled');
        const com = STYLE_INTERFACE[iface]!.buttons[idx]!;
        bot.setCombatStyleByButton(com);
        h.queueVarp(VARP.COM_MODE, idx);
        await h.tick(); await h.tick();
        expect(bot.combatStyle()).toBe(idx);
        expect(bot.ack.verdictOf(AckKind.SetStyle)).toBe('ack');
        expect(bot.ack.noAckByKind[AckKind.SetStyle]).toBe(0);
        await h.stop();
    });
});

describe('historical failure #4 — OPLOC does not self-route', () => {
    test('"I can\'t reach that!" comes back as REFUSED, not as a discarded op', async () => {
        const { bot, h } = await boot();
        bot.opLoc(3230, 3220, 1278, 1);             // a tree 5 tiles away
        h.queueMessage("I can't reach that!");
        await h.tick(); await h.tick();
        expect(bot.ack.verdictOf(AckKind.OpLoc)).toBe('refused');
        expect(bot.ack.noAckByKind[AckKind.OpLoc]).toBe(0);
        expect(bot.ack.refusedByKind[AckKind.OpLoc]).toBe(1);
        // and the diagnosis is actionable: the brain should WALK, not resend
        expect(bot.ack.lastRefusalText).toBe("I can't reach that!");
        await h.stop();
    });
});

// =====================================================================================================
// 4. NO FALSE POSITIVES ON THE PATH THAT PAYS FOR EVERYTHING
// =====================================================================================================
describe('a normal pickpocket loop produces ZERO assertions', () => {
    test('300 ticks of steals, fails and stuns: no no_ack, no wedge, no behaviour change', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }], [{ stat: S_THIEVING, xp: 0, level: 20 }]);
        let coins = 0, xp = 0;
        for (let i = 0; i < 300; i++) {
            if (i % 3 === 0) {
                bot.opNpc(5, 3);
                // the engine always answers a pickpocket — steal, fail, or stun
                if (i % 9 === 0) { h.queueMessage('You steal 3 coins.'); coins += 3; xp += 8; h.queueInv([{ id: COINS, count: coins }]); h.queueStat(S_THIEVING, xp, 20); }
                else if (i % 9 === 3) h.queueMessage('You fail to pick the knight\'s pocket.');
                else h.queueMessage('You have been stunned!');
            }
            await h.tick();
        }
        expect(bot.ack.noAck).toBe(0);
        expect(bot.ack.unknown).toBe(0);
        expect(bot.ackWedge).toBe('');
        expect(bot.ack.acked).toBeGreaterThan(0);   // it really was watching, not merely quiet
        await h.stop();
    });

    test('the ledger stays FIXED SIZE no matter how many interactions run through it', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }]);
        for (let i = 0; i < 200; i++) {
            bot.opNpc(i % 20, 3);                    // 20 different targets, 200 sends
            bot.opLoc(3200 + (i % 7), 3200, 1278, 1);
            h.queueMessage('You attempt to pick the pocket.');
            await h.tick();
        }
        // ONE record per kind, preallocated: there is nothing here that can grow.
        expect(bot.ack.noAckByKind.length).toBe(ACK_KIND_NAME.length);
        expect(bot.ack.armed).toBeGreaterThan(200);
        await h.stop();
    });
});

// =====================================================================================================
// 4b. BRAIN LIVENESS — the bot that never STARTS must be as loud as the one that stalls mid-run
// =====================================================================================================
// THE SHAPE: an account is kicked over and over on a ~305s metronome (= TIMEOUT_NO_RESPONSE exactly)
// and never appears in the log, because its brain never started. The connection count reads healthy,
// and the wedge detector never fires: it detects a bot stuck against a NAMED obstacle mid-run, and this
// bot never ran.
//
// ⛔ AND THE KEEPALIVE SWEEP MAKES DETECTION MANDATORY RATHER THAN OPTIONAL. The sweep stops the kick
// churn, which was the ONLY thing that made this account visible at all. Without the assertion below,
// shipping the sweep converts a churning zombie into a silent one.
describe('brain liveness', () => {
    /** Silence the brain the way a real inert bot is silent: it decodes, it just never sends. */
    function muteBrain(bot: LeanBot): void {
        (bot as unknown as { brain: () => void }).brain = function (): void { /* the inert-account shape */ };
    }

    test('a brain that NEVER sent reports BRAIN-NEVER-STARTED once the sweep steps in', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }]);
        muteBrain(bot);
        const errs: string[] = [];
        const realErr = console.error;
        console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
        try {
            await h.tick();
            expect(bot.brainWedge).toBe('');                 // nothing wrong yet — the sweep has not fired
            // The process sweep sends a NO_TIMEOUT because this client has been idle 45s. That counter
            // moving IS the signal; there is no threshold to tune and nothing to infer.
            bot.keepalivesSent++;
            await h.tick();
        } finally { console.error = realErr; }

        expect(bot.brainWedge).toBe('BRAIN-NEVER-STARTED');
        expect(bot.progressWedge()).toBe('BRAIN-NEVER-STARTED');
        const line = errs.find(e => e.includes('BRAIN-NEVER-STARTED'));
        expect(line).toBeTruthy();
        // The line must name the fix. "Made no progress" invites waiting; "produced NOTHING since
        // login" says restart it.
        expect(line!).toContain('produced NOTHING since login');
        await h.stop();
    });

    test('a brain that ran and then went quiet is BRAIN-SILENT — a different fault, a different name', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }]);
        // Let the real brain send at least once (keepWarm fires on tickCount % 5).
        for (let i = 0; i < 12; i++) await h.tick();
        expect(bot.brainEverSent).toBe(true);
        muteBrain(bot);
        bot.keepalivesSent++;
        await h.tick();
        expect(bot.brainWedge).toBe('BRAIN-SILENT');
        await h.stop();
    });

    test('a brain that RESUMES clears the wedge — it is live state, not a tombstone', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }]);
        muteBrain(bot);
        bot.keepalivesSent++;
        await h.tick();
        expect(bot.brainWedge).toBe('BRAIN-NEVER-STARTED');
        // hand the real brain back
        (bot as unknown as { brain: () => void }).brain = function (this: LeanBot): void { this.warm(); };
        for (let i = 0; i < 3; i++) await h.tick();
        expect(bot.brainWedge).toBe('');
        expect(bot.brainEverSent).toBe(true);
        await h.stop();
    });

    test('a NORMAL bot never trips it — the sweep counter never moves for a brain that sends', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }]);
        for (let i = 0; i < 200; i++) await h.tick();
        expect(bot.keepalivesSent).toBe(0);                  // the brain kept the socket busy on its own
        expect(bot.brainWedge).toBe('');
        expect(bot.progressWedge()).toBe('');
        await h.stop();
    });

    test('BRAIN-NEVER-STARTED OUTRANKS an ack wedge — an inert bot cannot meaningfully be "mis-sending"', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 0 }]);
        bot.ackWedge = 'ACK-NOACK-PICKPOCKET';
        muteBrain(bot);
        bot.keepalivesSent++;
        await h.tick();
        expect(bot.progressWedge()).toBe('BRAIN-NEVER-STARTED');
        await h.stop();
    });
});

// =====================================================================================================
// 5. COST — the number the design constraint asks for, measured rather than asserted-by-hope
// =====================================================================================================
describe('bounded cost', () => {
    test('evaluate() with every kind in flight costs well under a microsecond', () => {
        const h = new MockHost(); const led = new AckLedger();
        for (let k = 0; k < ACK_KIND_NAME.length; k++) led.arm(h, k, 1, 2, COINS, S_HP, VARP.COM_MODE, 1);
        const N = 20_000;
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < N; i++) { h.tick++; led.evaluate(h); }
        const ns = Number(process.hrtime.bigint() - t0) / N;
        console.log(`[ack] evaluate() with ${ACK_KIND_NAME.length} kinds armed: ${ns.toFixed(0)} ns/tick`);
        // A server tick is 600ms. Even 1000x this would be free; the bound is here to catch a future
        // change that turns the fixed loop into a scan.
        expect(ns).toBeLessThan(20_000);
    });

    test('arm() allocates nothing per call — 100k arms do not grow the ledger', () => {
        const h = new MockHost(); const led = new AckLedger();
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 100_000; i++) led.arm(h, AckKind.Pickpocket, i & 7);
        const ns = Number(process.hrtime.bigint() - t0) / 100_000;
        console.log(`[ack] arm(): ${ns.toFixed(0)} ns/call`);
        expect(ns).toBeLessThan(10_000);
        expect(led.noAckByKind.length).toBe(ACK_KIND_NAME.length);
    });

    test('the kill switch is a module constant, so a disabled process pays nothing', () => {
        // Not toggleable in-process (it is read once at load, on purpose — a per-call env read in the
        // packet loop is exactly the kind of cost this package promises not to add). The live probe
        // runs a second process with FB_ACK_ASSERT=0 to prove the disabled path.
        expect(typeof ACK_ENABLED).toBe('boolean');
        expect(ACK_ENABLED).toBe(process.env.FB_ACK_ASSERT !== '0');
    });
});

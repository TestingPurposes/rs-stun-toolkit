// bun test server/webclient/headless/sim/skilling-actions.test.ts
//
// BEHAVIOUR TESTS for the seven skilling actions added to LeanBot in parity package 2b:
// chopTree, burnLogs, fletchLogs, craftLeather, craftJewelry, enchantItem, stringAmulet.
//
// The companion file skilling-tables.test.ts pins the DATA (ids re-derived from the packed tables).
// This file pins the WIRE SEQUENCE AND THE DECISIONS — the part a stale id table cannot catch:
//
//   * OPHELDU IS TOOL-FIRST for all four tools. Tool-second lands in OpHeldUHandler.ts:95-99, which
//     swaps lastItem/lastUseItem unconditionally once the first lookup misses — sometimes right, never
//     reliably. Every one of the four is asserted by argument POSITION, not by "a packet was sent".
//   * SKILL_MULTI MAKE BUTTONS ARE IF_BUTTON, and makeX must WAIT for P_COUNTDIALOG before replying.
//     A reply sent early is dropped by the engine with no error, so the ordering is asserted directly.
//   * leather_chaps' Make-5/Make-10 buttons are a CONTENT BUG (all three bind @craft_leather(...,1)).
//     craftLeather must loop make-1 for that row and never click the lying buttons. Confirmed live.
//   * ENCHANT REPLACES THE ITEM IN PLACE, so the occupied-slot count never moves. Success must be read
//     from the slot's obj id; a count-based detector is asserted to be the wrong instrument here.
//   * A REFUSAL MUST COME BACK TYPED. Every action returns {success:false, reason} rather than hanging
//     or claiming success — the failure class this package exists to remove.
//
// Everything runs through the REAL decode loop (SimHarness drives an actual LeanBot's run()), so the
// packets asserted below are the bytes the bot would really put on the wire.
import { describe, test, expect } from 'bun:test';
import { SimHarness } from './harness.js';
import { SimWorld, openField } from './world.js';
import type { ClientAction } from './protocol.js';
import { LeanBot } from '../leanbot.js';
import {
    TINDERBOX, KNIFE, NEEDLE, THREAD, LEATHER, BALL_OF_WOOL, ARROW_SHAFT, ASHES,
    GOLD_BAR, JEWELRY, JEWELRY_ROW_BY_GROUP, LEATHER_CRAFTING, LEATHER_PRODUCT_BY_NAME,
    SKILL_MULTI_BY_NAME, FLETCH_LOG_BY_OBJ, ENCHANT_BY_TIER, TREES, TREE_BY_LOC, MESSAGES,
} from '../skilling-tables.js';

// stat indices (engine PlayerStat.ts)
const S_MAGIC = 6, S_WC = 8, S_FLETCH = 9, S_FIRE = 11, S_CRAFT = 12;
// objs referenced by the fixtures
const LOGS = 1511, OAK_LOGS = 1521, UNSTRUNG_SHORTBOW = 50, UNSTRUNG_LONGBOW = 48;
const SAPPHIRE_RING = 1637, RING_OF_RECOIL = 2550, RUBY_RING = 1641;
const UNSTRUNG_GOLD_AMULET = 1673, STRUNG_GOLD_AMULET = 1692, BRONZE_AXE = 1351, COINS = 995;
const GLOVES = LEATHER_PRODUCT_BY_NAME['leather_gloves']!.productObj;
const CHAPS = LEATHER_PRODUCT_BY_NAME['leather_chaps']!.productObj;
const GOLD_RING = JEWELRY_ROW_BY_GROUP['rings']!.slots[0]!.productObj;

const START = { x: 3222, z: 3218 };

/** A SceneLoc-shaped tree next to the bot, so no locScene index is needed to drive chopTree. */
const treeLoc = (id = 1278, x = START.x + 1, z = START.z) => ({
    id, name: 'Tree', x, z, level: 0, distance: 1, shape: 10, angle: 0, width: 1, length: 1,
    options: ['Chop down'], optionsWithIndex: [{ text: 'Chop down', opIndex: 1 }],
});

async function boot(inv: Array<{ id: number; count: number }>, stats: Array<{ stat: number; xp: number; level: number }> = []) {
    const world = new SimWorld(START.x, START.z, openField());
    const bot = new LeanBot();
    bot.quiet = true;
    const h = new SimHarness(bot as never, world);
    await h.start({ inv, stats });
    await h.tick();          // let the opening UPDATE_INV / UPDATE_STAT land
    return { world, bot, h };
}

/** Drive n ticks, returning every client action the bot emitted across them. */
async function drive(h: SimHarness, n: number): Promise<ClientAction[]> {
    const out: ClientAction[] = [];
    for (let i = 0; i < n; i++) out.push(...(await h.tick()).actions);
    return out;
}

/**
 * Await a skilling action, driving ticks until it settles.
 *
 * ⛔ NEVER write a bare `await someAction()` in this file. These actions resolve from the DECODE LOOP
 * (sendWait -> tickWaiters), so a test that stops ticking and then awaits parks the whole suite with
 * no output and no failure — which is exactly what happened while this file was being written, and
 * bun's per-test timeout did not rescue it. This turns "never settled" into a normal test failure.
 */
async function settle<T>(h: SimHarness, p: Promise<T>, maxTicks = 60): Promise<T> {
    let done = false;
    const watched = p.then(v => { done = true; return v; }, e => { done = true; throw e; });
    for (let i = 0; i < maxTicks && !done; i++) await h.tick();
    if (!done) throw new Error(`skilling action never settled within ${maxTicks} ticks`);
    return watched;
}

const opheldus = (a: ClientAction[]) => a.filter(x => x.type === 'opheldu') as Extract<ClientAction, { type: 'opheldu' }>[];
const ifbuttons = (a: ClientAction[]) => a.filter(x => x.type === 'ifbutton') as Extract<ClientAction, { type: 'ifbutton' }>[];
const oplocs = (a: ClientAction[]) => a.filter(x => x.type === 'oploc') as Extract<ClientAction, { type: 'oploc' }>[];
const oplocus = (a: ClientAction[]) => a.filter(x => x.type === 'oplocu') as Extract<ClientAction, { type: 'oplocu' }>[];
const invbuttons = (a: ClientAction[]) => a.filter(x => x.type === 'invbutton') as Extract<ClientAction, { type: 'invbutton' }>[];
const opheldts = (a: ClientAction[]) => a.filter(x => x.type === 'opheldt') as Extract<ClientAction, { type: 'opheldt' }>[];
const countreplies = (a: ClientAction[]) => a.filter(x => x.type === 'countreply') as Extract<ClientAction, { type: 'countreply' }>[];

// =====================================================================================================
// 1. OPHELDU IS TOOL-FIRST — the trap that produces a silent no-op, locked for all four tools
// =====================================================================================================
describe('OPHELDU argument order: the TOOL always goes first', () => {
    test('burnLogs sends p2(tinderbox) before p2(logs)', async () => {
        const { bot, h } = await boot([{ id: TINDERBOX, count: 1 }, { id: LOGS, count: 5 }], [{ stat: S_FIRE, xp: 0, level: 99 }]);
        const p = bot.burnLogs();
        const acts = await drive(h, 2);
        const u = opheldus(acts)[0];
        expect(u).toBeTruthy();
        expect(u!.obj).toBe(TINDERBOX);       // the TOOL — [opheldu,tinderbox] resolves on this pair
        expect(u!.useObj).toBe(LOGS);
        expect(u!.slot).toBe(0);
        expect(u!.useSlot).toBe(1);
        h.queueStat(S_FIRE, 400, 99);
        await drive(h, 3);
        expect((await settle(h, p)).success).toBe(true);
        await h.stop();
    });

    test('fletchLogs sends p2(knife) before p2(logs)', async () => {
        const { bot, h } = await boot([{ id: KNIFE, count: 1 }, { id: LOGS, count: 5 }], [{ stat: S_FLETCH, xp: 0, level: 99 }]);
        const p = bot.fletchLogs('shortbow');
        const acts = await drive(h, 2);
        const u = opheldus(acts)[0];
        expect(u!.obj).toBe(KNIFE);
        expect(u!.useObj).toBe(LOGS);
        h.queueOpenChat(SKILL_MULTI_BY_NAME['skill_multi3']!.root);
        await drive(h, 2);
        h.queueInv([{ id: KNIFE, count: 1 }, { id: LOGS, count: 4 }, { id: UNSTRUNG_SHORTBOW, count: 1 }]);
        h.queueStat(S_FLETCH, 50, 99);
        await drive(h, 4);
        expect((await settle(h, p)).success).toBe(true);
        await h.stop();
    });

    test('craftLeather sends p2(needle) before p2(leather)', async () => {
        const { bot, h } = await boot(
            [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 5 }, { id: LEATHER, count: 5 }],
            [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.craftLeather('leather_gloves');
        const acts = await drive(h, 2);
        const u = opheldus(acts)[0];
        expect(u!.obj).toBe(NEEDLE);
        expect(u!.useObj).toBe(LEATHER);
        h.queueOpenMain(LEATHER_CRAFTING.ROOT);
        await drive(h, 2);
        h.queueInv([{ id: NEEDLE, count: 1 }, { id: THREAD, count: 5 }, { id: LEATHER, count: 4 }, { id: GLOVES, count: 1 }]);
        await drive(h, 4);
        expect((await settle(h, p)).success).toBe(true);
        await h.stop();
    });

    test('stringAmulet sends p2(ball_of_wool) before p2(unstrung amulet)', async () => {
        const { bot, h } = await boot(
            [{ id: BALL_OF_WOOL, count: 3 }, { id: UNSTRUNG_GOLD_AMULET, count: 2 }],
            [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.stringAmulet();
        const acts = await drive(h, 2);
        const u = opheldus(acts)[0];
        expect(u!.obj).toBe(BALL_OF_WOOL);
        expect(u!.useObj).toBe(UNSTRUNG_GOLD_AMULET);
        h.queueInv([{ id: BALL_OF_WOOL, count: 2 }, { id: UNSTRUNG_GOLD_AMULET, count: 1 }, { id: STRUNG_GOLD_AMULET, count: 1 }]);
        h.queueStat(S_CRAFT, 40, 99);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.itemsMade).toBe(1);
        await h.stop();
    });
});

// =====================================================================================================
// 2. chopTree
// =====================================================================================================
describe('chopTree', () => {
    test('sends exactly ONE OPLOC1 on the resolved tree and never the continuation op 3', async () => {
        const { bot, h } = await boot([{ id: BRONZE_AXE, count: 1 }], [{ stat: S_WC, xp: 0, level: 99 }]);
        const t = treeLoc();
        const p = bot.chopTree(t);
        const acts = await drive(h, 3);
        const locs = oplocs(acts).filter(a => a.locId === t.id);
        expect(locs.length).toBe(1);
        expect(locs[0]!.op).toBe(1);
        expect(locs[0]!.x).toBe(t.x);
        expect(locs[0]!.z).toBe(t.z);
        // ⛔ op3 is woodcut.rs2's INTERNAL re-arm ([oploc3,_tree]); a bot that sends it is impersonating
        // the server's own continuation and restarts the cycle from scratch.
        expect(oplocs(acts).some(a => a.op === 3)).toBe(false);
        h.queueInv([{ id: BRONZE_AXE, count: 1 }, { id: LOGS, count: 1 }]);
        h.queueStat(S_WC, 25, 99);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.logs?.id).toBe(LOGS);
        expect(r.xpGained).toBe(25);
        await h.stop();
    });

    test('no axe -> {success:false, reason:"no_axe"} and NOTHING is sent', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 100 }], [{ stat: S_WC, xp: 0, level: 99 }]);
        const before = (await h.tick()).actions.length;
        const r = await bot.chopTree(treeLoc());
        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_axe');
        expect(oplocs(await drive(h, 2)).length).toBe(0);
        expect(before).toBeGreaterThanOrEqual(0);
        await h.stop();
    });

    test('a loc that is not in TREE_BY_LOC is refused locally, not sent hopefully', async () => {
        const { bot, h } = await boot([{ id: BRONZE_AXE, count: 1 }], [{ stat: S_WC, xp: 0, level: 99 }]);
        const r = await bot.chopTree({ ...treeLoc(), id: 2213, name: 'Bank booth' });
        expect(r.success).toBe(false);
        expect(r.reason).toBe('not_a_tree');
        expect(oplocs(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('a tree above the bot\'s Woodcutting level is refused with level_too_low', async () => {
        const yew = TREES.find(t => t.table === 'yew_tree_table')!;
        const { bot, h } = await boot([{ id: BRONZE_AXE, count: 1 }], [{ stat: S_WC, xp: 0, level: 1 }]);
        const r = await bot.chopTree({ ...treeLoc(), id: yew.locs[0]!.id, name: 'Yew' });
        expect(r.success).toBe(false);
        expect(r.reason).toBe('level_too_low');
        expect(oplocs(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('"I can\'t reach that!" comes back as reason:"cant_reach", not as a timeout', async () => {
        // The live finding this locks: OPLOC does NOT self-route. From 5 tiles away the engine answers
        // this every tick and the player never takes a step, so "nothing happened" and "you were never
        // close enough" MUST be distinguishable at the call site.
        const { bot, h } = await boot([{ id: BRONZE_AXE, count: 1 }], [{ stat: S_WC, xp: 0, level: 99 }]);
        const p = bot.chopTree(treeLoc(), { timeoutTicks: 12 });
        await drive(h, 2);
        h.queueMessage("I can't reach that!");
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('cant_reach');
        await h.stop();
    });

    test('a full inventory is reported as inventory_full', async () => {
        const { bot, h } = await boot([{ id: BRONZE_AXE, count: 1 }], [{ stat: S_WC, xp: 0, level: 99 }]);
        const p = bot.chopTree(treeLoc(), { timeoutTicks: 12 });
        await drive(h, 2);
        h.queueMessage(MESSAGES.woodcutting.invFull);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.reason).toBe('inventory_full');
        await h.stop();
    });

    test('every TREES row\'s locs are in TREE_BY_LOC, so findTree can never resolve a tree it cannot chop', () => {
        for (const t of TREES) for (const l of t.locs) expect(TREE_BY_LOC.get(l.id)).toBe(t);
    });
});

// =====================================================================================================
// 3. burnLogs
// =====================================================================================================
describe('burnLogs', () => {
    test('reports where the FIRE is, which is NOT where the player ends up', async () => {
        // ~push_player teleports the player one tile on success and the fire lands on the OLD tile.
        // A brain that re-reads its own position and drops the next log there gets "You can't light a
        // fire here." forever, so burnLogs returns the pre-push tile explicitly.
        const { bot, world, h } = await boot([{ id: TINDERBOX, count: 1 }, { id: LOGS, count: 5 }], [{ stat: S_FIRE, xp: 0, level: 99 }]);
        const before = { x: START.x, z: START.z };
        const p = bot.burnLogs();
        await drive(h, 2);
        world.player.teleport(START.x + 1, START.z);      // the server's push
        h.queueStat(S_FIRE, 400, 99);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.xpGained).toBe(400);
        expect(r.fireAt).toEqual(before);
        expect(bot.tile()).not.toEqual(before);
        await h.stop();
    });

    test('no tinderbox -> reason:"no_tinderbox" and no packet', async () => {
        const { bot, h } = await boot([{ id: LOGS, count: 5 }], [{ stat: S_FIRE, xp: 0, level: 99 }]);
        const r = await bot.burnLogs();
        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_tinderbox');
        expect(r.xpGained).toBe(0);
        expect(opheldus(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('no logs -> reason:"no_logs" (a tinderbox alone is not a firemaking session)', async () => {
        const { bot, h } = await boot([{ id: TINDERBOX, count: 1 }], [{ stat: S_FIRE, xp: 0, level: 99 }]);
        const r = await bot.burnLogs();
        expect(r.reason).toBe('no_logs');
        expect(opheldus(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('"You can\'t light a fire here." is reported as no_space, and ASHES is the table\'s obj', async () => {
        const { bot, h } = await boot([{ id: TINDERBOX, count: 1 }, { id: LOGS, count: 5 }], [{ stat: S_FIRE, xp: 0, level: 99 }]);
        const p = bot.burnLogs(undefined, { timeoutTicks: 12 });
        await drive(h, 2);
        h.queueMessage(MESSAGES.firemaking.noSpace);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_space');
        expect(ASHES).toBe(592);
        await h.stop();
    });

    test('a log below the firemaking level requirement is refused locally', async () => {
        const { bot, h } = await boot([{ id: TINDERBOX, count: 1 }, { id: 1515, count: 3 }], [{ stat: S_FIRE, xp: 0, level: 5 }]);
        const r = await bot.burnLogs();          // yew_logs need 60
        expect(r.reason).toBe('level_too_low');
        expect(opheldus(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });
});

// =====================================================================================================
// 4. fletchLogs — the skill_multi contract
// =====================================================================================================
describe('fletchLogs', () => {
    test('count 1/5/10 click the make-N component of the POSITIONAL slot for that product', async () => {
        const m3 = SKILL_MULTI_BY_NAME['skill_multi3']!;
        const { bot, h } = await boot([{ id: KNIFE, count: 1 }, { id: LOGS, count: 20 }], [{ stat: S_FLETCH, xp: 0, level: 99 }]);
        const p = bot.fletchLogs('longbow', { count: 10 });
        await drive(h, 2);
        h.queueOpenChat(m3.root);
        const acts = await drive(h, 3);
        // plain logs put shafts/short/long in slots a/b/c — "longbow" is slot c, and its make-10 button
        // is the ONLY button that may be clicked. Reading the LABEL instead would be a different lookup.
        expect(ifbuttons(acts).map(b => b.com)).toContain(m3.slots[2]!.make10);
        expect(ifbuttons(acts).map(b => b.com)).not.toContain(m3.slots[0]!.make10);
        h.queueInv([{ id: KNIFE, count: 1 }, { id: LOGS, count: 10 }, { id: UNSTRUNG_LONGBOW, count: 10 }]);
        h.queueStat(S_FLETCH, 1000, 99);
        await drive(h, 6);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.itemsMade).toBe(10);
        await h.stop();
    });

    test('a count outside {1,5,10} uses makeX and REPLIES ONLY AFTER P_COUNTDIALOG', async () => {
        // ResumePCountDialogHandler DROPS a reply that arrives before the prompt, with no error. So the
        // order below is the contract, not a nicety: no countreply may exist until the prompt lands.
        const m3 = SKILL_MULTI_BY_NAME['skill_multi3']!;
        const { bot, h } = await boot([{ id: KNIFE, count: 1 }, { id: LOGS, count: 20 }], [{ stat: S_FLETCH, xp: 0, level: 99 }]);
        const p = bot.fletchLogs('shafts', { count: 4 });
        await drive(h, 2);
        h.queueOpenChat(m3.root);
        const afterOpen = await drive(h, 3);
        expect(ifbuttons(afterOpen).map(b => b.com)).toContain(m3.slots[0]!.makeX);
        expect(countreplies(afterOpen).length).toBe(0);          // ⛔ nothing yet — the prompt has not arrived
        h.queueCountDialog();
        const afterPrompt = await drive(h, 3);
        expect(countreplies(afterPrompt).map(c => c.n)).toEqual([4]);
        h.queueInv([{ id: KNIFE, count: 1 }, { id: LOGS, count: 16 }, { id: ARROW_SHAFT, count: 60 }]);
        h.queueStat(S_FLETCH, 300, 99);
        await drive(h, 6);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.itemsMade).toBe(60);          // 4 logs x 15 shafts — the table's per-log yield
        await h.stop();
    });

    test('the dialog never opening is reason:"dialog_not_opened", and the members refusal is its own reason', async () => {
        const { bot, h } = await boot([{ id: KNIFE, count: 1 }, { id: LOGS, count: 5 }], [{ stat: S_FLETCH, xp: 0, level: 99 }]);
        const p = bot.fletchLogs('shortbow');
        await drive(h, 2);
        h.queueMessage(MESSAGES.fletching.membersRefusal);
        await drive(h, 18);
        const r = await settle(h, p);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('members');
        await h.stop();
    });

    test('a product that log cannot make is refused locally with the options listed', async () => {
        const { bot, h } = await boot([{ id: KNIFE, count: 1 }, { id: OAK_LOGS, count: 5 }], [{ stat: S_FLETCH, xp: 0, level: 99 }]);
        const r = await bot.fletchLogs('shafts');           // oak has NO shaft line (skill_multi2)
        expect(r.success).toBe(false);
        expect(r.reason).toBe('unknown_product');
        expect(r.message).toContain('shortbow');
        expect(opheldus(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('oak logs use skill_multi2, where "longbow" is slot b — NOT slot c as on plain logs', async () => {
        // The positional trap: the same word maps to a different component depending on the log, which
        // is exactly why the product table and the dialog table must be paired rather than guessed.
        const oak = FLETCH_LOG_BY_OBJ.get(OAK_LOGS)!;
        expect(oak.iface).toBe('skill_multi2');
        expect(oak.products[1]!.kind).toBe('longbow');
        const m2 = SKILL_MULTI_BY_NAME['skill_multi2']!;
        const { bot, h } = await boot([{ id: KNIFE, count: 1 }, { id: OAK_LOGS, count: 5 }], [{ stat: S_FLETCH, xp: 0, level: 99 }]);
        const p = bot.fletchLogs('longbow');
        await drive(h, 2);
        h.queueOpenChat(m2.root);
        const acts = await drive(h, 3);
        expect(ifbuttons(acts).map(b => b.com)).toContain(m2.slots[1]!.make1);
        h.queueInv([{ id: KNIFE, count: 1 }, { id: OAK_LOGS, count: 4 }, { id: 56, count: 1 }]);
        h.queueStat(S_FLETCH, 250, 99);
        await drive(h, 6);
        expect((await settle(h, p)).success).toBe(true);
        await h.stop();
    });

    test('no knife / no logs are refused before anything is sent', async () => {
        const a = await boot([{ id: LOGS, count: 5 }]);
        expect((await a.bot.fletchLogs()).reason).toBe('no_knife');
        await a.h.stop();
        const b = await boot([{ id: KNIFE, count: 1 }]);
        expect((await b.bot.fletchLogs()).reason).toBe('no_logs');
        await b.h.stop();
    });
});

// =====================================================================================================
// 5. craftLeather — including the content bug
// =====================================================================================================
describe('craftLeather', () => {
    test('a healthy row uses ONE make-N click for the whole batch', async () => {
        const gloves = LEATHER_PRODUCT_BY_NAME['leather_gloves']!;
        const { bot, h } = await boot(
            [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 20 }, { id: LEATHER, count: 20 }],
            [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.craftLeather('leather_gloves', { count: 10 });
        await drive(h, 2);
        h.queueOpenMain(LEATHER_CRAFTING.ROOT);
        const acts = await drive(h, 3);
        expect(ifbuttons(acts).map(b => b.com)).toEqual([gloves.buttons[10]!]);
        h.queueInv([{ id: NEEDLE, count: 1 }, { id: THREAD, count: 18 }, { id: LEATHER, count: 10 }, { id: GLOVES, count: 10 }]);
        h.queueStat(S_CRAFT, 1380, 99);
        await drive(h, 8);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.itemsCrafted).toBe(10);
        await h.stop();
    });

    test('leather_chaps x3 crafts with make-1 clicks (count 3 < 5) and never the Make-5/Make-10 components', async () => {
        // 274 CONTENT BUG (leather.rs2 bound all three chaps buttons to count 1, so the lane looped make-1).
        // REV 289 FIXED IT: com_125/124/123 = 1/5/10, brokenCounts is false and the 5/10 buttons exist. A count of
        // 3 still crafts with three make-1 clicks, so the loop below holds on both revisions.
        const chaps = LEATHER_PRODUCT_BY_NAME['leather_chaps']!;
        expect(chaps.brokenCounts).toBe(false);
        expect(chaps.buttons[5]).toBe(chaps.bindings[1]!.com);
        expect(chaps.buttons[10]).toBe(chaps.bindings[2]!.com);
        const { bot, h } = await boot(
            [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 20 }, { id: LEATHER, count: 20 }],
            [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.craftLeather('leather_chaps', { count: 3 });
        const clicks: number[] = [];
        // @craft_leather begins with if_close, so each click closes the modal and the next round re-opens
        // it — reproduced here exactly, because that is what forces the loop to be a loop.
        for (let round = 0; round < 3; round++) {
            await drive(h, 2);
            h.queueOpenMain(LEATHER_CRAFTING.ROOT);
            clicks.push(...ifbuttons(await drive(h, 3)).map(b => b.com));
            h.queueIfClose();
            h.queueInv([{ id: NEEDLE, count: 1 }, { id: THREAD, count: 20 }, { id: LEATHER, count: 19 - round },
                { id: CHAPS, count: round + 1 }]);
            await drive(h, 3);
        }
        await drive(h, 4);
        const r = await settle(h, p);
        expect(clicks).toEqual([chaps.buttons[1]!, chaps.buttons[1]!, chaps.buttons[1]!]);
        expect(clicks).not.toContain(chaps.bindings[1]!.com);      // the "Make 5 pairs" component
        expect(clicks).not.toContain(chaps.bindings[2]!.com);      // the "Make 10 pairs" component
        expect(r.success).toBe(true);
        expect(r.itemsCrafted).toBe(3);
        await h.stop();
    });

    test('no thread -> reason:"no_thread" and NOTHING is sent (the thread check is why the modal never opens)', async () => {
        const { bot, h } = await boot([{ id: NEEDLE, count: 1 }, { id: LEATHER, count: 5 }], [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const r = await bot.craftLeather('leather_gloves');
        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_thread');
        expect(opheldus(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('no needle / no leather / unknown product are all refused locally', async () => {
        const a = await boot([{ id: LEATHER, count: 5 }, { id: THREAD, count: 5 }]);
        expect((await a.bot.craftLeather()).reason).toBe('no_needle');
        await a.h.stop();
        const b = await boot([{ id: NEEDLE, count: 1 }, { id: THREAD, count: 5 }]);
        expect((await b.bot.craftLeather()).reason).toBe('no_leather');
        await b.h.stop();
        const c = await boot([{ id: NEEDLE, count: 1 }, { id: THREAD, count: 5 }, { id: LEATHER, count: 5 }]);
        expect((await c.bot.craftLeather('dragon_platebody')).reason).toBe('unknown_product');
        await c.h.stop();
    });

    test('the modal never opening is reason:"interface_not_opened", and it names the thread cause', async () => {
        const { bot, h } = await boot(
            [{ id: NEEDLE, count: 1 }, { id: THREAD, count: 5 }, { id: LEATHER, count: 5 }],
            [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.craftLeather('leather_gloves');
        const r = await (async () => { await drive(h, 20); return p; })();
        const res = await r;
        expect(res.success).toBe(false);
        expect(res.reason).toBe('interface_not_opened');
        expect(res.message).toContain('thread');
        await h.stop();
    });
});

// =====================================================================================================
// 6. craftJewelry — INV_BUTTON on a dummy inv, not IF_BUTTON
// =====================================================================================================
describe('craftJewelry', () => {
    const rings = JEWELRY_ROW_BY_GROUP['rings']!;
    const mould = 1592;   // ring_mould
    const furnace = { x: START.x + 1, z: START.z, id: 2781, width: 1, length: 1, angle: 0 };

    test('opens with OPLOCU then answers with INV_BUTTON on the row component — never IF_BUTTON', async () => {
        const { bot, h } = await boot([{ id: GOLD_BAR, count: 10 }, { id: mould, count: 1 }], [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.craftJewelry('gold_ring', { count: 5, furnace });
        const open = await drive(h, 2);
        const lu = oplocus(open)[0];
        expect(lu).toBeTruthy();
        expect(lu!.locId).toBe(furnace.id);
        expect(lu!.obj).toBe(GOLD_BAR);
        h.queueOpenMain(JEWELRY.ROOT);
        h.queueInv(rings.slots.map(s => (s.slot === 0 ? { id: s.slotObjId, count: 1 } : { id: -1, count: 0 })), rings.com);
        const acts = await drive(h, 6);
        const ib = invbuttons(acts).filter(a => a.com === rings.com);
        expect(ib.length).toBe(1);
        // make-5 is INV_BUTTON op 2 (the table's own count -> op map, not an arithmetic guess)
        expect(rings.buttons[5]).toBe(2);
        expect(ib[0]!.op as number).toBe(rings.buttons[5]!);
        expect(ib[0]!.obj).toBe(rings.slots[0]!.slotObjId);
        expect(ib[0]!.slot).toBe(0);
        expect(ifbuttons(acts).map(b => b.com)).not.toContain(rings.com);
        h.queueInv([{ id: GOLD_BAR, count: 5 }, { id: mould, count: 1 }, { id: GOLD_RING, count: 5 }]);
        h.queueStat(S_CRAFT, 750, 99);
        await drive(h, 8);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.itemsCrafted).toBe(5);
        await h.stop();
    });

    test('without the mould the row is never transmitted, so the click is refused BEFORE it is sent', async () => {
        const { bot, h } = await boot([{ id: GOLD_BAR, count: 10 }], [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const r = await bot.craftJewelry('gold_ring', { furnace });
        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_mould');
        expect(oplocus(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('a modal that opens with NO UPDATE_INV on the row is reason:"row_not_transmitted", not a blind click', async () => {
        // InvButtonHandler validates inv.hasAt(slot, obj). Clicking a slot the server never filled is
        // dropped silently — so the transmitted inv is checked first and the failure is named.
        const { bot, h } = await boot([{ id: GOLD_BAR, count: 10 }, { id: mould, count: 1 }], [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.craftJewelry('gold_ring', { furnace });
        await drive(h, 2);
        h.queueOpenMain(JEWELRY.ROOT);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('row_not_transmitted');
        expect(invbuttons(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });

    test('a gem row without its gem is refused: slots 1..5 only exist while you hold the gem', async () => {
        const { bot, h } = await boot([{ id: GOLD_BAR, count: 10 }, { id: mould, count: 1 }], [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const r = await bot.craftJewelry('sapphire_ring', { furnace });
        expect(r.reason).toBe('no_gem');
        await h.stop();
    });

    test('no bar and an unknown product are refused locally', async () => {
        const a = await boot([{ id: mould, count: 1 }]);
        expect((await a.bot.craftJewelry('gold_ring', { furnace })).reason).toBe('no_bar');
        await a.h.stop();
        const b = await boot([{ id: GOLD_BAR, count: 5 }, { id: mould, count: 1 }]);
        expect((await b.bot.craftJewelry('rune_platebody', { furnace })).reason).toBe('unknown_product');
        await b.h.stop();
    });
});

// =====================================================================================================
// 7. enchantItem — the in-place replacement
// =====================================================================================================
describe('enchantItem', () => {
    test('picks the spell component from the TARGET, and success is read from the SLOT, not a count', async () => {
        const spell = ENCHANT_BY_TIER.get(1)!;
        const { bot, h } = await boot(
            [{ id: SAPPHIRE_RING, count: 1 }, { id: 555, count: 10 }, { id: 564, count: 10 }],
            [{ stat: S_MAGIC, xp: 0, level: 99 }]);
        const occupiedBefore = bot.backpackSlots().length;
        const p = bot.enchantItem();
        const acts = await drive(h, 2);
        const t = opheldts(acts)[0];
        expect(t).toBeTruthy();
        expect(t!.obj).toBe(SAPPHIRE_RING);
        expect(t!.spellCom).toBe(spell.com);
        // inv_setslot: the slot's obj CHANGES and the occupied count does not move.
        h.queueInv([{ id: RING_OF_RECOIL, count: 1 }, { id: 555, count: 9 }, { id: 564, count: 9 }]);
        h.queueStat(S_MAGIC, 17, 99);
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(true);
        expect(r.product?.id).toBe(RING_OF_RECOIL);
        expect(bot.backpackSlots().length).toBe(occupiedBefore);   // ⛔ a count-based detector sees NOTHING
        await h.stop();
    });

    test('a different target selects a different tier — ruby_ring is enchant_lvl3', async () => {
        const spell3 = ENCHANT_BY_TIER.get(3)!;
        const { bot, h } = await boot([{ id: RUBY_RING, count: 1 }, { id: 554, count: 20 }, { id: 564, count: 10 }],
            [{ stat: S_MAGIC, xp: 0, level: 99 }]);
        const p = bot.enchantItem(RUBY_RING, { timeoutTicks: 8 });
        const acts = await drive(h, 2);
        expect(opheldts(acts)[0]!.spellCom).toBe(spell3.com);
        await drive(h, 10);
        await settle(h, p);
        await h.stop();
    });

    test('the rune refusal comes back as reason:"no_runes" with the server\'s own sentence', async () => {
        const { bot, h } = await boot([{ id: SAPPHIRE_RING, count: 1 }], [{ stat: S_MAGIC, xp: 0, level: 99 }]);
        const p = bot.enchantItem(undefined, { timeoutTicks: 15 });
        await drive(h, 2);
        h.queueMessage('You do not have enough Water Runes to cast this spell.');
        await drive(h, 4);
        const r = await settle(h, p);
        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_runes');
        expect(r.message).toContain('Water Runes');
        await h.stop();
    });

    test('a level refusal and a wrong-target refusal are distinct reasons', async () => {
        const a = await boot([{ id: SAPPHIRE_RING, count: 1 }], [{ stat: S_MAGIC, xp: 0, level: 99 }]);
        const pa = a.bot.enchantItem(undefined, { timeoutTicks: 15 });
        await drive(a.h, 2);
        a.h.queueMessage(MESSAGES.enchant.lowLevel);
        await drive(a.h, 4);
        expect((await settle(a.h, pa)).reason).toBe('level_too_low');
        await a.h.stop();

        const b = await boot([{ id: SAPPHIRE_RING, count: 1 }], [{ stat: S_MAGIC, xp: 0, level: 99 }]);
        const pb = b.bot.enchantItem(undefined, { timeoutTicks: 15 });
        await drive(b.h, 2);
        b.h.queueMessage(ENCHANT_BY_TIER.get(1)!.wrongTargetMessage);
        await drive(b.h, 4);
        expect((await settle(b.h, pb)).reason).toBe('wrong_target');
        await b.h.stop();
    });

    test('nothing enchantable in the pack -> reason:"item_not_found" and no cast', async () => {
        const { bot, h } = await boot([{ id: COINS, count: 500 }], [{ stat: S_MAGIC, xp: 0, level: 99 }]);
        const r = await bot.enchantItem();
        expect(r.reason).toBe('item_not_found');
        expect(opheldts(await drive(h, 2)).length).toBe(0);
        await h.stop();
    });
});

// =====================================================================================================
// 8. stringAmulet
// =====================================================================================================
describe('stringAmulet', () => {
    test('one OPHELDU per amulet — count:2 sends exactly two', async () => {
        const { bot, h } = await boot(
            [{ id: BALL_OF_WOOL, count: 5 }, { id: UNSTRUNG_GOLD_AMULET, count: 3 }],
            [{ stat: S_CRAFT, xp: 0, level: 99 }]);
        const p = bot.stringAmulet(undefined, { count: 2 });
        const all: ClientAction[] = [];
        all.push(...await drive(h, 2));
        h.queueInv([{ id: BALL_OF_WOOL, count: 4 }, { id: UNSTRUNG_GOLD_AMULET, count: 2 }, { id: STRUNG_GOLD_AMULET, count: 1 }]);
        all.push(...await drive(h, 4));
        h.queueInv([{ id: BALL_OF_WOOL, count: 3 }, { id: UNSTRUNG_GOLD_AMULET, count: 1 }, { id: STRUNG_GOLD_AMULET, count: 2 }]);
        h.queueStat(S_CRAFT, 80, 99);
        all.push(...await drive(h, 6));
        const r = await settle(h, p);
        expect(opheldus(all).length).toBe(2);
        expect(r.success).toBe(true);
        expect(r.itemsMade).toBe(2);
        await h.stop();
    });

    test('no wool / no unstrung piece are refused locally', async () => {
        const a = await boot([{ id: UNSTRUNG_GOLD_AMULET, count: 1 }]);
        expect((await a.bot.stringAmulet()).reason).toBe('no_string');
        await a.h.stop();
        const b = await boot([{ id: BALL_OF_WOOL, count: 5 }]);
        expect((await b.bot.stringAmulet()).reason).toBe('no_amulet');
        await b.h.stop();
    });

    test('stringing is NOT level-gated: string_amulet hard-codes 40 crafting xp and never reads levelrequired', async () => {
        // The table's `level` is the level to CRAFT the unstrung piece. Enforcing it here would refuse
        // work the server does happily, so a level-1 bot must be allowed to string a diamond amulet.
        const { bot, h } = await boot(
            [{ id: BALL_OF_WOOL, count: 5 }, { id: 1681, count: 1 }],       // unstrung_diamond_amulet, craft level 70
            [{ stat: S_CRAFT, xp: 0, level: 1 }]);
        const p = bot.stringAmulet(undefined, { count: 1 });
        const acts = await drive(h, 2);
        expect(opheldus(acts)[0]!.useObj).toBe(1681);
        h.queueInv([{ id: BALL_OF_WOOL, count: 4 }, { id: 1700, count: 1 }]);
        h.queueStat(S_CRAFT, 40, 2);
        await drive(h, 4);
        expect((await settle(h, p)).success).toBe(true);
        await h.stop();
    });
});

// cd server/webclient/headless/sim && bun test druidic-ritual.test.ts
// (or: cd server/webclient && bun headless/sim/run-tests.ts --filter=druidic   — NEVER `bun test headless/sim`)
//
// =====================================================================================================
// DRUIDIC RITUAL — the ONLY herblore bootstrap, driven end-to-end through the real QuestRunnerBot
// =====================================================================================================
//
// WHY THIS QUEST AND NOT ANOTHER: `identify.rs2:64-70` gates identifying a herb on
// `stat(herblore) >= identified_herb_level` and the MINIMUM such level over every herb row is 3;
// brewing is 3+ too, and grinding awards nothing. A herblore-1 account can earn LITERALLY ZERO xp, so
// `quest_druid.rs2:3  stat_advance(herblore, 2500)` is the only door. herblore-lane.test.ts asserts
// that cliff against the content files; this file asserts that the RUNNER can walk through the door.
//
// ⛔ WHAT THIS PROVES AND WHAT IT DOES NOT. It proves the runner EXECUTES the step list: the right
// choice on each p_choiceN page, the kill->loot lane, the OPLOCU dips in the right order behind the
// quest gate, the hand-over, and the journal-colour completion check. It does NOT prove the quest
// completes live — the step list is a hand-transcription of the RS2 scripts and every coordinate in it
// is offline-derived (rsmod findPathToLoc/reachedLoc), never live-smoked. See quest-runner.ts's header.
//
// THE ONE THING HERE THAT IS A REAL BUG-CATCHER RATHER THAN A RESTATEMENT:
//   ⭐ CARDINAL ADJACENCY. `CoopWorld.registerTransmuteLoc` refuses an OPLOCU from a DIAGONAL tile the
//      way rsmod's reached() does (Manhattan 1, not Chebyshev 1) — measured offline for loc 2142: all
//      four cardinal faces answer reached=TRUE and all four diagonals answer FALSE while being
//      perfectly walkable. A step list that parks on a diagonal stalls FOREVER live with no message;
//      here it fails a test in 30 seconds.
import { describe, test, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoopWorld, CoopHarness, type QuestStep } from './coop.ts';
import { QuestRunnerBot, QUESTS, druidicRitualSteps, inDoneBox, TAVERLEY_DUNGEON } from '../quest-runner.ts';
import { openField } from './world.ts';

const CONTENT = join(import.meta.dir, '..', '..', '..', 'content', 'scripts');
const readContent = (p: string): string => readFileSync(join(CONTENT, p), 'utf8');

// obj ids (server/content/pack/obj.pack)
const RAW_BEEF = 2132, RAW_RAT = 2134, RAW_BEAR = 2136, RAW_CHICKEN = 2138;
const ENCH_BEEF = 522, ENCH_RAT = 523, ENCH_BEAR = 524, ENCH_CHICKEN = 525;
// npc ids (server/content/pack/npc.pack)
const KAQEMEEX = 455, SANFEW = 454, COW = 81, CHICKEN = 41, GIANTRAT = 87, DARKBEAR = 106;
// loc id (server/content/pack/loc.pack)
const CAULDRON = 2142;
// %druidquest stages (quest_druid/configs/quest_druid.constant)
const DRUID_VARP = 77;   // sim-internal id; the real varp does NOT transmit (quest-state.ts)
const NOT_STARTED = 0, STARTED = 1, SPOKEN_SANFEW = 2, GIVEN_INGREDIENTS = 3, COMPLETE = 4;
// questlist:druid component id — quest-state.ts:256 (extracted from interface.pack), the row whose
// IF_SETCOLOUR is the ONLY completion observable this quest has.
const DRUID_JOURNAL_COM = 7355;
const UNICORN = 89, UNICORN_HORN = 237, SHARK = 385;

// ⭐ THE SIM USES THE REAL TILES. The cauldron (2893,9831), its west stand tile (2892,9831), the door
// leaf (2889,9830) and its west stand tile (2888,9830) are the SHIPPED coordinates, not stand-ins.
// The collision is openField() (the point is the OP semantics, not the walk), so what is under test is
// ADJACENCY and ORDERING. ⛔ The door is deliberately run against the REAL loc 2144, which the door
// tracker CANNOT see — see the door-states.json test at the bottom.
const CAULDRON_XZ = { x: 2893, z: 9831 };
const CAULDRON_STAND = { x: 2892, z: 9831 };
const DOOR = { x: 2889, z: 9830, locId: 2144, op: 1 };
const DOOR_STAND = { x: 2888, z: 9830 };

/**
 * The observable CONTRACT of the two Kaqemeex/Sanfew conversations, transcribed from
 * `kaqemeex.rs2` / `sanfew.rs2`. `pages` counts continue-clicks before the effect; `choicePage` /
 * `expectChoice` model the p_choiceN branch the runner must pick.
 *
 * ⛔ A FIXTURE IS A TRANSCRIPTION AND CAN DRIFT FROM THE SCRIPT. The `describe` block at the bottom
 * re-reads the .rs2 files and pins the option ORDER, so a content reorder breaks the test rather than
 * a live run.
 */
function druidFixture(): QuestStep[] {
    return [
        // kaqemeex.rs2:5 multi3 — option 2 "I'm in search of a quest." -> ... -> p_choice3 option 1
        // "Ok, I will try and help." (kaqemeex.rs2:61) -> %druidquest = ^druid_started (line 76).
        // The runner's `choices: [2, 1]` drives BOTH pages; the fixture models the second (decisive) one.
        { npc: KAQEMEEX, op: 'talk', varp: DRUID_VARP, whenState: NOT_STARTED, toState: STARTED, pages: 2, choicePage: 1, choiceRoot: 2469, expectChoice: 2 },
        // sanfew.rs2:26 multi2 — option 1 -> druid_sanfew_information -> ^druid_spoken_sanfew (line 40)
        { npc: SANFEW, op: 'talk', varp: DRUID_VARP, whenState: STARTED, toState: SPOKEN_SANFEW, pages: 2, choicePage: 1, choiceRoot: 2459, expectChoice: 1 },
        // sanfew.rs2:53-66 — requires all four ENCHANTED meats; deletes them; ^druid_given_ingredients.
        // (The sim's fixture can require/delete ONE item, so it gates on enchanted beef and the test
        //  asserts the other three separately.)
        { npc: SANFEW, op: 'talk', varp: DRUID_VARP, whenState: SPOKEN_SANFEW, toState: GIVEN_INGREDIENTS, requireItem: ENCH_BEEF, delItem: ENCH_BEEF, pages: 3 },
        // kaqemeex.rs2:9-10 -> @druid_completion -> quest_druid.rs2:2-6 (^druid_complete + the xp).
        // NO ITEM IS HANDED OVER — the only wire-visible outcome is the journal row going GREEN
        // (quests.rs2:50), which is what the runner's `questComplete: 'druid'` gate reads.
        { npc: KAQEMEEX, op: 'talk', varp: DRUID_VARP, whenState: GIVEN_INGREDIENTS, toState: COMPLETE, pages: 2, journalComponent: DRUID_JOURNAL_COM, journalComplete: COMPLETE },
    ];
}

/**
 * The SHIPPED step list, with only the NPC/kill steps re-anchored onto the co-located sim tile (travel
 * is proven elsewhere; here the interaction+ordering machinery is under test). The `useloc`/`oploc`
 * steps are passed through UNTOUCHED — their real stand tiles are what the adjacency model judges.
 */
function simSteps(at: { x: number; z: number }): ReturnType<typeof druidicRitualSteps> {
    return druidicRitualSteps().map(s => (s.op === 'useloc' || s.op === 'oploc') ? s : { ...s, xz: at });
}

/** A runner that seeds the shipped door table, exactly as the standalone runner does. */
class TrackedRunner extends QuestRunnerBot {
    constructor() { super(); this.enableDoorTracker(); }
}

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

/** Drive `n` ticks (or until `stop()`), returning EVERY event the world emitted along the way. */
async function drive(harness: CoopHarness, n: number, stop?: () => boolean): Promise<string[]> {
    const kinds: string[] = [];
    for (let i = 0; i < n; i++) {
        if (stop?.()) break;
        const r = await harness.tick();
        for (const e of r.events) kinds.push(e.kind);
    }
    return kinds;
}

function buildWorld(): CoopWorld {
    const world = new CoopWorld(openField());
    world.registerQuest(druidFixture());
    world.registerTransmuteLoc({
        x: CAULDRON_XZ.x, z: CAULDRON_XZ.z, locId: CAULDRON,
        gateVarp: DRUID_VARP, gateState: SPOKEN_SANFEW,           // quest_druid.rs2:16
        map: { [RAW_BEEF]: ENCH_BEEF, [RAW_RAT]: ENCH_RAT, [RAW_BEAR]: ENCH_BEAR, [RAW_CHICKEN]: ENCH_CHICKEN },
    });
    world.registerKillDrop(CHICKEN, RAW_CHICKEN);   // chicken.rs2:14
    world.registerKillDrop(COW, RAW_BEEF);          // cow.rs2:11
    world.registerKillDrop(GIANTRAT, RAW_RAT);      // giant_rat.rs2:8
    world.registerKillDrop(DARKBEAR, RAW_BEAR);     // bear.rs2:12
    return world;
}

/**
 * THE CAULDRON ROOM as the rev-289 collision has it (druidic-geo.test.ts (e) pins the real thing): interior x 2889-2897,
 * z 9826-9836, three entrances — the PRISON DOOR 2144/2143 on the west edge of (2889,9830/9831) (prison_doors.rs2: the
 * suits wake, then it swings shut around you), the ordinary GATE 1557/1558 on the west edge of (2898,9831/9832) and the
 * ordinary DOOR 1542/1544 on the south edge of (2892/2893,9826). Everything else on the perimeter is wall (locId < 0:
 * nothing can op it). `sealed` bricks up the gate and the door too.
 */
function buildCauldronRoom(world: CoopWorld, o: { sealed?: boolean } = {}): void {
    const wall = (x: number, z: number, angle: 0 | 1 | 2 | 3) => world.addWallDoor({ x, z, angle, locId: -1, op: -1, script: 'open' });
    for (let z = 9826; z <= 9836; z++) {
        if (z === 9830) world.addWallDoor({ x: 2889, z, angle: 0, locId: 2144, op: 1, script: 'open_and_close', wakeFromBeyond: 2 });
        else if (z === 9831) world.addWallDoor({ x: 2889, z, angle: 0, locId: 2143, op: 1, script: 'open_and_close' });
        else wall(2889, z, 0);
        if ((z === 9831 || z === 9832) && !o.sealed) world.addWallDoor({ x: 2898, z, angle: 0, locId: z === 9831 ? 1557 : 1558, op: 1, script: 'open', group: 'gate' });
        else wall(2898, z, 0);
    }
    for (let x = 2889; x <= 2897; x++) {
        if ((x === 2892 || x === 2893) && !o.sealed) world.addWallDoor({ x, z: 9826, angle: 3, locId: x === 2892 ? 1542 : 1544, op: 1, script: 'open', group: 'door' });
        else wall(x, 9826, 3);
        wall(x, 9836, 1);
    }
}
/**
 * The planner the runner gets, in the sim: BFS (8-way, rsmod diagonal rule via world.canStep) where ORDINARY
 * doors (an op-able `open` wall door) count as walkable — exactly like rsmod, which masks every door open — and the
 * prison door does NOT, like sdk/navgrid/quest-gated-doors.json. `maskPrison` = the pre-fix planner (prison door walkable).
 */
function roomPath(world: CoopWorld, sx: number, sz: number, dx: number, dz: number, maskPrison = false): Array<{ x: number; z: number }> {
    const doors = ((world as any).wallDoors as Array<{ locId: number; script: string; open?: boolean }>)
        .filter(d => (d.script === 'open' && d.locId > 0) || (maskPrison && d.script === 'open_and_close'));
    const was = doors.map(d => d.open);
    for (const d of doors) d.open = true;
    try {
        const key = (x: number, z: number) => `${x},${z}`;
        const prev = new Map<string, string | null>([[key(sx, sz), null]]);
        const q: Array<[number, number]> = [[sx, sz]];
        while (q.length) {
            const [x, z] = q.shift()!;
            if (x === dx && z === dz) break;
            for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
                const nx = x + ox, nz = z + oz, k = key(nx, nz);
                if (prev.has(k) || Math.abs(nx - sx) > 30 || Math.abs(nz - sz) > 30) continue;
                if (!world.canStep(0, x, z, ox, oz)) continue;
                prev.set(k, key(x, z)); q.push([nx, nz]);
            }
        }
        if (!prev.has(key(dx, dz))) return [];
        const out: Array<{ x: number; z: number }> = [];
        for (let c: string | null = key(dx, dz); c; c = prev.get(c)!) { const [x, z] = c.split(',').map(Number); out.unshift({ x: x!, z: z! }); }
        return out;
    } finally { doors.forEach((d, i) => { d.open = was[i]; }); }
}

describe('QuestRunnerBot drives DRUIDIC RITUAL end-to-end (kill lane + cauldron + hand-over)', () => {
    test('all 12 steps: 4 kills, 2 talks, 4 OPLOCU dips, hand-over, completion — the prison door is never touched', async () => {
        // Co-locate the NPCs next to the cauldron stand so the (travel-disabled) runner reaches the real cauldron on foot.
        // (The way INTO the room is proven by the routing test below and on the real collision in druidic-geo.test.ts (e).)
        const at = { x: CAULDRON_STAND.x, z: CAULDRON_STAND.z + 1 };
        const world = buildWorld();
        // the prison door is still modelled: a runner that ops it (the old step list) wakes the suits and this test says so
        world.addWallDoor({ x: DOOR.x, z: DOOR.z, angle: 0, locId: DOOR.locId, op: DOOR.op, script: 'open_and_close', wakeFromBeyond: 2 });
        world.addNpc(1, KAQEMEEX, at.x, at.z);
        world.addNpc(2, SANFEW, at.x, at.z);
        world.addNpc(3, CHICKEN, at.x, at.z - 1);
        world.addNpc(4, COW, at.x, at.z - 1);
        world.addNpc(5, GIANTRAT, at.x, at.z - 1);
        world.addNpc(6, DARKBEAR, at.x, at.z - 1);
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        q.setSteps(simSteps(at));
        h.add({ bot: q as any, name: 'druid1', index: 10, x: at.x, z: at.z });
        await h.start();

        const kinds = await drive(h, 1200, () => (q as any).done);
        expect((q as any).done).toBe(true);
        expect((q as any).stepIdx).toBe(12);
        expect(world.questState(DRUID_VARP)).toBe(COMPLETE);
        expect(kinds.filter(k => k === 'npc-killed').length).toBe(4);   // one per meat
        expect(kinds.filter(k => k === 'obj-taken').length).toBe(4);    // ...and each pile was TAKEN
        expect(kinds.filter(k => k === 'transmuted').length).toBe(4);   // ...and dipped
        expect(kinds).not.toContain('suit-woke');
        expect(kinds).not.toContain('walldoor-through');
    }, 90_000);

    test('BANK STEP + HORNS: clear a production pack (keep 5 sharks), quest, 3 unicorn horns AFTER the quest, bank them', async () => {
        const at = { x: CAULDRON_STAND.x, z: CAULDRON_STAND.z + 1 }, BOOTH = { x: at.x - 2, z: at.z + 3 }, STAND = { x: at.x - 2, z: at.z + 2 };
        const world = buildWorld();
        world.addBankBooth(BOOTH.x, BOOTH.z);
        world.registerKillDrop(UNICORN, UNICORN_HORN);   // unicorn.rs2:11 obj_add(npc_coord, unicorn_horn, 1, ...)
        world.npcRespawn = new Map([[UNICORN, 30]]);     // 3 horns off ONE spawn: the engine re-adds it after respawnrate
        world.addNpc(1, KAQEMEEX, at.x, at.z); world.addNpc(2, SANFEW, at.x, at.z);
        world.addNpc(3, CHICKEN, at.x, at.z - 1); world.addNpc(4, COW, at.x, at.z - 1); world.addNpc(5, GIANTRAT, at.x, at.z - 1); world.addNpc(6, DARKBEAR, at.x, at.z - 1);
        world.addNpc(7, UNICORN, at.x, at.z - 1);
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        const bank = { stand: STAND, booth: BOOTH, keep: { [SHARK]: 5 } };
        q.setSteps(druidicRitualSteps({ horns: 3, bankFirst: bank, bankEnd: bank }).map(st => (st.op === 'useloc' || st.op === 'oploc' || st.op === 'bank') ? st : { ...st, xz: at }));
        // acct10's real pack (vault): coins, 21 sharks, harpoon, big net = 24 slots
        const inv = [{ id: 995, count: 470 }, ...Array.from({ length: 21 }, () => ({ id: SHARK, count: 1 })), { id: 311, count: 1 }, { id: 305, count: 1 }];
        h.add({ bot: q as any, name: 'druid5', index: 10, x: at.x, z: at.z, inv });
        await h.start();
        await drive(h, 2400, () => (q as any).done);
        expect((q as any).done).toBe(true);
        expect(world.questState(DRUID_VARP)).toBe(COMPLETE);
        const p = world.playersByIndex.get(10)!;
        expect(p.bank.get(UNICORN_HORN)).toBe(3);                     // horns banked by the trailing bank step
        expect(p.bank.get(995)).toBe(470);
        expect(p.inv.filter(x => x && x.id === SHARK).length).toBe(5);   // the keep
        expect(p.inv.filter(x => x && x.id !== SHARK).length).toBe(0);
        const order = (q as any).steps.map((st: any) => st.op);
        expect(order[0]).toBe('bank'); expect(order[order.length - 1]).toBe('bank');
        expect((q as any).steps[order.length - 2].expectItem).toBe(UNICORN_HORN);   // horns AFTER the quest (room in the pack)
    }, 120_000);

    test('HORNS ONLY: bank -> 4 unicorn horns -> bank, no quest step, no quest NPC needed', async () => {
        const at = { x: CAULDRON_STAND.x, z: CAULDRON_STAND.z + 1 }, BOOTH = { x: at.x - 2, z: at.z + 3 }, STAND = { x: at.x - 2, z: at.z + 2 };
        const world = buildWorld();
        world.addBankBooth(BOOTH.x, BOOTH.z);
        world.registerKillDrop(UNICORN, UNICORN_HORN);
        world.npcRespawn = new Map([[UNICORN, 30]]);
        world.addNpc(7, UNICORN, at.x, at.z - 1);    // no Kaqemeex / Sanfew / meat NPCs in this world at all
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        const bank = { stand: STAND, booth: BOOTH, keep: { [SHARK]: 5 } };
        const steps = druidicRitualSteps({ horns: 4, bankFirst: bank, bankEnd: bank, hornsOnly: true });
        expect(steps.map(s => s.op)).toEqual(['bank', 'kill', 'bank']);
        expect(steps[1]!.expectItem).toBe(UNICORN_HORN); expect(steps[1]!.expectCount).toBe(4);
        q.setSteps(steps.map(st => st.op === 'bank' ? st : { ...st, xz: at }));
        // the trainer mid-herb-lane: unf potions + vials in the pack, 21 sharks
        const inv = [...Array.from({ length: 21 }, () => ({ id: SHARK, count: 1 })), { id: 101, count: 1 }, { id: 227, count: 1 }];
        h.add({ bot: q as any, name: 'druid9', index: 10, x: at.x, z: at.z, inv });
        await h.start();
        await drive(h, 1600, () => (q as any).done);
        expect((q as any).done).toBe(true);
        const p = world.playersByIndex.get(10)!;
        expect(p.bank.get(UNICORN_HORN)).toBe(4);
        expect(p.bank.get(101)).toBe(1);
        expect(p.inv.filter(x => x && x.id === SHARK).length).toBe(5);
        expect(p.inv.filter(x => x && x.id !== SHARK).length).toBe(0);
    }, 120_000);

    test('⛔  a doneBox / skipIfIn box never matches the OTHER stratum (surface vs z>6400)', () => {
        // the old door step had doneBox {x0: 2889} and was marked "through" at (2890,3408) on the SURFACE after a stalled climb
        const stand = { x: 2888, z: 9830 };
        expect(inDoneBox({ x: 2890, z: 3408 }, { x0: 2889 }, stand)).toBe(false);
        expect(inDoneBox({ x: 2890, z: 9830 }, { x0: 2889 }, stand)).toBe(true);
        expect(inDoneBox({ x: 2888, z: 9830 }, TAVERLEY_DUNGEON)).toBe(true);
        expect(inDoneBox({ x: 2898, z: 3426 }, TAVERLEY_DUNGEON)).toBe(false);
    });

    test('RESUME IN THE DUNGEON (the live relaunch): bank/kills/Kaqemeex/Sanfew are all skipped without walking, it goes straight to the dips', async () => {
        const at = { x: CAULDRON_STAND.x, z: CAULDRON_STAND.z + 1 }, BOOTH = { x: at.x - 2, z: at.z + 3 }, STAND = { x: at.x - 2, z: at.z + 2 };
        const world = buildWorld();
        world.setQuestVar(DRUID_VARP, SPOKEN_SANFEW);
        world.addBankBooth(BOOTH.x, BOOTH.z);
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = true; (q as any).arrived = true;
        (q as any).findLongPathFn = (_l: number, sx: number, sz: number, dx: number, dz: number) => roomPath(world, sx, sz, dx, dz);
        const bank = { stand: STAND, booth: BOOTH, keep: { [SHARK]: 5 } };
        const steps = druidicRitualSteps({ horns: 0, bankFirst: bank });
        q.setSteps(steps);
        const inv = [RAW_CHICKEN, RAW_BEEF, RAW_RAT, RAW_BEAR].map(id => ({ id, count: 1 }));
        // acct10's live tile: just outside the prison door, the four raw meats in the pack
        h.add({ bot: q as any, name: 'druid6', index: 10, x: DOOR_STAND.x, z: DOOR_STAND.z, inv });
        await h.start();
        const firstDip = steps.findIndex(st => st.op === 'useloc');
        const lines: string[] = []; const orig = console.log;
        console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
        let kinds: string[] = [];
        try { kinds = await drive(h, 60, () => (q as any).stepIdx >= firstDip); } finally { console.log = orig; }
        expect((q as any).stepIdx).toBe(firstDip);
        expect(kinds).not.toContain('npc-killed');
        expect(lines.filter(l => l.includes('resume: already at')).length).toBe(2);   // Kaqemeex + Sanfew
        const p = world.playersByIndex.get(10)!;
        expect(Math.max(Math.abs(p.x - DOOR_STAND.x), Math.abs(p.z - DOOR_STAND.z))).toBeLessThanOrEqual(2);   // never walked away
    }, 60_000);

    test('RESUME AFTER THE DIPS (rig sim rdr1): four ENCHANTED meats held -> every dip is skipped, it resumes at the Sanfew hand-over', async () => {
        const world = buildWorld();
        world.setQuestVar(DRUID_VARP, SPOKEN_SANFEW);
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = true; (q as any).arrived = true;
        (q as any).findLongPathFn = (_l: number, sx: number, sz: number, dx: number, dz: number) => roomPath(world, sx, sz, dx, dz);
        const steps = druidicRitualSteps({ horns: 0 });
        q.setSteps(steps);
        const inv = [ENCH_CHICKEN, ENCH_BEEF, ENCH_RAT, ENCH_BEAR].map(id => ({ id, count: 1 }));
        h.add({ bot: q as any, name: 'druid9', index: 10, x: CAULDRON_STAND.x, z: CAULDRON_STAND.z, inv });
        await h.start();
        const handover = steps.findIndex(st => st.consumeItem === ENCH_BEEF);
        await drive(h, 60, () => (q as any).stepIdx >= handover);
        expect((q as any).stepIdx).toBe(handover);
        const p = world.playersByIndex.get(10)!;
        expect([ENCH_CHICKEN, ENCH_BEEF, ENCH_RAT, ENCH_BEAR].every(id => p.inv.some(x => x && x.id === id))).toBe(true);
    }, 60_000);

    test('⭐ THE LIVE WEDGE, MODELLED: from outside the prison door the dips route through the EAST GATE (no suits, no door op)', async () => {
        const world = buildWorld();
        world.setQuestVar(DRUID_VARP, SPOKEN_SANFEW);
        buildCauldronRoom(world);
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = true; (q as any).arrived = true;
        (q as any).findLongPathFn = (_l: number, sx: number, sz: number, dx: number, dz: number) => roomPath(world, sx, sz, dx, dz);
        q.setSteps(druidicRitualSteps().filter(st => st.op === 'useloc'));
        const inv = [RAW_CHICKEN, RAW_BEEF, RAW_RAT, RAW_BEAR].map(id => ({ id, count: 1 }));
        h.add({ bot: q as any, name: 'druid7', index: 10, x: DOOR_STAND.x, z: DOOR_STAND.z, inv });
        await h.start();
        const kinds = await drive(h, 900, () => (q as any).done);
        expect((q as any).done).toBe(true);
        expect(kinds.filter(k => k === 'transmuted').length).toBe(4);
        expect(kinds).toContain('door-opened');                 // the ordinary gate (or door), opened by the runner
        expect(kinds).not.toContain('suit-woke');
        expect(kinds).not.toContain('walldoor-through');
    }, 90_000);

    test('NO 7,400-TICK SILENT LOOP: a stand the walk cannot reach re-plans, then says WEDGED at error level', async () => {
        const world = buildWorld();
        world.setQuestVar(DRUID_VARP, SPOKEN_SANFEW);
        buildCauldronRoom(world, { sealed: true });     // gate + door bricked up: only the prison door remains
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = true; (q as any).arrived = true;
        // the PRE-FIX planner shape: it believes the prison door is walkable (rsmod masks every door open)
        (q as any).findLongPathFn = (_l: number, sx: number, sz: number, dx: number, dz: number) => roomPath(world, sx, sz, dx, dz, true);
        q.setSteps(druidicRitualSteps().filter(st => st.op === 'useloc').slice(0, 1));
        h.add({ bot: q as any, name: 'druid8', index: 10, x: DOOR_STAND.x, z: DOOR_STAND.z, inv: [{ id: RAW_BEEF, count: 1 }] });
        const prev = { t: process.env.QR_CLOSE_TICKS, r: process.env.QR_CLOSE_REPLANS };
        process.env.QR_CLOSE_TICKS = '20'; process.env.QR_CLOSE_REPLANS = '2';
        const errs: string[] = []; const oe = console.error, ol = console.log;
        console.error = (...a: unknown[]) => { errs.push(a.join(' ')); }; console.log = () => {};
        try { await h.start(); await drive(h, 400); }
        finally {
            console.error = oe; console.log = ol;
            if (prev.t === undefined) delete process.env.QR_CLOSE_TICKS; else process.env.QR_CLOSE_TICKS = prev.t;
            if (prev.r === undefined) delete process.env.QR_CLOSE_REPLANS; else process.env.QR_CLOSE_REPLANS = prev.r;
        }
        expect((q as any).done).toBe(false);
        expect(errs.filter(e => e.includes('RE-PLANNING travel')).length).toBe(2);
        expect(errs.some(e => e.includes('WEDGED step') && e.includes('dip raw beef'))).toBe(true);
    }, 60_000);

    test('THE CAULDRON IS GATED: a dip before the Sanfew talk transmutes NOTHING', async () => {
        const at = { x: 3210, z: 3221 };
        const world = buildWorld();
        h = new CoopHarness(world);
        const q = new QuestRunnerBot(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        // ONLY the dip step, with the quest still at ^druid_not_started.
        q.setSteps([{
            xz: CAULDRON_STAND, level: 0, op: 'useloc',
            loc: { x: CAULDRON_XZ.x, z: CAULDRON_XZ.z, id: CAULDRON }, useItem: RAW_BEEF, expectItem: ENCH_BEEF,
        }]);
        h.add({ bot: q as any, name: 'druid2', index: 10, x: CAULDRON_STAND.x, z: CAULDRON_STAND.z, inv: [{ id: RAW_BEEF, count: 1 }] });
        await h.start();
        const kinds = await drive(h, 120, () => (q as any).done);
        expect((q as any).done).toBe(false);                                   // never advances
        expect(kinds).toContain('transmute-gated');                            // and the server said why
    }, 60_000);

    test('⭐ CARDINAL, NOT DIAGONAL: a dip from a diagonal tile is REFUSED', async () => {
        const world = buildWorld();
        world.setQuestVar(DRUID_VARP, SPOKEN_SANFEW);                          // gate satisfied
        h = new CoopHarness(world);
        const q = new QuestRunnerBot(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        const diag = { x: CAULDRON_XZ.x - 1, z: CAULDRON_XZ.z - 1 };          // walkable, Chebyshev 1, NOT cardinal
        q.setSteps([{ xz: diag, level: 0, op: 'useloc', loc: { x: CAULDRON_XZ.x, z: CAULDRON_XZ.z, id: CAULDRON }, useItem: RAW_BEEF, expectItem: ENCH_BEEF }]);
        h.add({ bot: q as any, name: 'druid3', index: 10, x: diag.x, z: diag.z, inv: [{ id: RAW_BEEF, count: 1 }] });
        await h.start();
        const kinds = await drive(h, 120, () => (q as any).done);
        expect((q as any).done).toBe(false);
        expect(kinds).toContain('cant-reach');
        expect(kinds).not.toContain('transmuted');
    }, 60_000);

    test('NO SILENT STALL: a blocked step keeps naming itself on the log', async () => {
        const world = buildWorld();
        world.setQuestVar(DRUID_VARP, SPOKEN_SANFEW);
        h = new CoopHarness(world);
        const q = new QuestRunnerBot(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        // a dip with NO raw beef in the pack: the step cannot proceed and must say so.
        q.setSteps([{
            xz: CAULDRON_STAND, level: 0, op: 'useloc',
            loc: { x: CAULDRON_XZ.x, z: CAULDRON_XZ.z, id: CAULDRON }, useItem: RAW_BEEF, expectItem: ENCH_BEEF,
            label: 'dip raw beef',
        }]);
        h.add({ bot: q as any, name: 'druid4', index: 10, x: CAULDRON_STAND.x, z: CAULDRON_STAND.z });
        await h.start();
        const lines: string[] = [];
        const orig = console.log;
        console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
        try { for (let i = 0; i < 60; i++) await h.tick(); } finally { console.log = orig; }
        expect((q as any).done).toBe(false);
        const named = lines.filter(l => l.includes('missing use-item') && l.includes('dip raw beef'));
        expect(named.length).toBeGreaterThan(0);
    }, 60_000);
});

// ⭐  (acct10, step 3/17 for ~1 h): the rat anchor sat inside Melzar's Maze behind a door that never opens
// on op1, and the leanbot ladder re-planned the same route forever. These two pin the runner-side cures: a kill step with
// fallback anchors moves on when travel wedges, and a relaunch mid-gather does not bank / re-hunt the meats it carries.
describe('the rat step: fallback anchors on a travel wedge + a relaunch that resumes instead of redoing', () => {
    /** open field + a sealed box (a locked maze) around the first anchor — the planner (linePath) still plans straight in */
    class MazeWorld extends CoopWorld {
        constructor(readonly box: { x0: number; x1: number; z0: number; z1: number }) { super(openField()); }
        override canStep(level: number, x: number, z: number, dx: number, dz: number): boolean {
            const tx = x + dx, tz = z + dz, b = this.box;
            if (tx >= b.x0 && tx <= b.x1 && tz >= b.z0 && tz <= b.z1) return false;
            return super.canStep(level, x, z, dx, dz);
        }
    }
    const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => { const o = [{ x: sx, z: sz }]; let x = sx, z = sz; while (x !== dx || z !== dz) { x += Math.sign(dx - x); z += Math.sign(dz - z); o.push({ x, z }); } return o; };
    const ratStep = () => druidicRitualSteps().find(st => st.op === 'kill' && st.expectItem === RAW_RAT)!;

    test('the shipped rat step has fallback spots and is no longer anchored in the maze', () => {
        const r = ratStep();
        expect(r.xz).not.toEqual({ x: 2931, z: 3249 });
        expect((r.xzAlts ?? []).length).toBeGreaterThanOrEqual(2);
        expect(r.heldAlso).toEqual([ENCH_RAT]);
    });

    /** one rat step, anchor 1 sealed inside a box of `rad`, a rat only at anchor 2; true = the meat was won AT anchor 2 */
    async function runFallback(rad: number, env: Record<string, string>): Promise<void> {
        const prev: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; }
        try {
            const A1 = { x: 2931, z: 3249 }, A2 = { x: 2950, z: 3222 }, START = { x: 2952, z: 3249 };
            const world = new MazeWorld({ x0: A1.x - rad, x1: A1.x + rad, z0: A1.z - rad, z1: A1.z + rad });
            world.registerKillDrop(GIANTRAT, RAW_RAT);
            world.addNpc(5, GIANTRAT, A2.x + 1, A2.z);
            h = new CoopHarness(world);
            const q = new QuestRunnerBot(); q.quiet = true; (q as any).exitOnStuck = false;
            q.findLongPathFn = lp; (q as any).travelEnabled = true; (q as any).arrived = true;
            q.setSteps([{ ...ratStep(), xz: A1, xzAlts: [A2] }]);
            h.add({ bot: q as any, name: 'druid9', index: 10, x: START.x, z: START.z });
            await h.start();
            const kinds = await drive(h, 900, () => (q as any).done);
            expect((q as any).done).toBe(true);
            expect(kinds.filter(k => k === 'npc-killed').length).toBe(1);
            const p = world.playersByIndex.get(10)!;
            expect(p.inv.some(x => x && x.id === RAW_RAT)).toBe(true);
            expect(Math.max(Math.abs(p.x - A2.x), Math.abs(p.z - A2.z))).toBeLessThanOrEqual(8);   // it hunted at anchor 2
        } finally {
            for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        }
    }
    // the live shape: the walker stops at the maze wall 10 tiles short (beyond leanbot's 6-tile "arrived") and never moves again
    test('TRAVEL WEDGED short of anchor 1 (sealed, 10 tiles out) -> it walks to the next anchor and gets the meat there', async () => {
        await runFallback(9, { QR_WEDGE_TICKS: '15', QR_WEDGE_MAX: '2' });
    }, 90_000);
    // the near shape: the wall is within 6 tiles, so the walker "arrives" outside it and the kill lane finds nothing to kill
    test('ARRIVED outside a sealed anchor with no reachable rat -> after QR_KILL_TICKS it moves to the next anchor', async () => {
        await runFallback(4, { QR_KILL_TICKS: '40' });
    }, 90_000);

    test('RELAUNCH holding raw chicken + raw beef: the first bank keeps them, chicken/cow are skipped, it resumes at the rat', async () => {
        const at = DOOR_STAND, BOOTH = { x: at.x - 2, z: at.z + 3 }, STAND = { x: at.x - 2, z: at.z + 2 };
        const world = buildWorld();
        world.addBankBooth(BOOTH.x, BOOTH.z);
        world.addNpc(5, GIANTRAT, at.x, at.z - 1);   // ONLY a rat: a runner that re-hunted chicken/cow would hold forever
        h = new CoopHarness(world);
        const q = new TrackedRunner(); q.quiet = true; (q as any).exitOnStuck = false;
        (q as any).travelEnabled = false; (q as any).arrived = true;
        const bank = { stand: STAND, booth: BOOTH, keep: { [SHARK]: 5 } };
        const steps = druidicRitualSteps({ horns: 0, bankFirst: bank }).map(st => (st.op === 'useloc' || st.op === 'oploc' || st.op === 'bank') ? st : { ...st, xz: at });
        q.setSteps(steps);
        const ratIdx = steps.findIndex(st => st.expectItem === RAW_RAT);
        expect(ratIdx).toBe(3);   // bank, chicken, cow, RAT — the live wedge was "step 3/17"
        const inv = [{ id: RAW_CHICKEN, count: 1 }, { id: RAW_BEEF, count: 1 }, ...Array.from({ length: 5 }, () => ({ id: SHARK, count: 1 }))];
        h.add({ bot: q as any, name: 'druid10', index: 10, x: at.x, z: at.z, inv });
        await h.start();
        const kinds = await drive(h, 400, () => (q as any).stepIdx > ratIdx);
        expect((q as any).stepIdx).toBeGreaterThan(ratIdx);
        expect(kinds.filter(k => k === 'npc-killed').length).toBe(1);   // the rat, nothing else
        const p = world.playersByIndex.get(10)!;
        expect(p.bank.size).toBe(0);                                       // the first bank step deposited nothing
        for (const id of [RAW_CHICKEN, RAW_BEEF, RAW_RAT]) expect({ id, held: p.inv.some(x => x && x.id === id) }).toEqual({ id, held: true });
    }, 90_000);
});

describe('the step list matches the CONTENT it was transcribed from', () => {
    const steps = QUESTS.druidic_ritual!;

    test('it is registered under the quest table like every other quest', () => {
        expect(Object.keys(QUESTS)).toContain('druidic_ritual');
        expect(steps.length).toBe(12);   // no prison-door steps  (the room's gate is an ordinary door)
    });

    test('KAQEMEEX multi3 option 2 is "I\'m in search of a quest.", then p_choice3 option 1 agrees', () => {
        const src = readContent('areas/area_taverly/scripts/kaqemeex.rs2');
        // kaqemeex.rs2:5 — the not-started multi3, in published order
        const multi3 = /@multi3\("Who are you\?", kaqemeex_who_are_you, "I'm in search of a quest\.", druidic_ritual_start_1, "Did you build this\?", kaqemeex_did_you_build\)/;
        expect(src).toMatch(multi3);
        // kaqemeex.rs2:61 — option 1 is the agree branch
        expect(src).toMatch(/~p_choice3\("Ok, I will try and help\.", 1,/);
        expect(src).toMatch(/\[label,druid_agree_to_help\][\s\S]*?%druidquest = \^druid_started/);
        const kaq = steps.find(s => s.label?.startsWith('Kaqemeex: start'))!;
        expect(kaq.choices).toEqual([2, 1]);
    });

    test('SANFEW multi2 option 1 accepts the errand, then p_choice2 option 2 ends the page', () => {
        const src = readContent('areas/area_taverly/scripts/sanfew.rs2');
        expect(src).toMatch(/@multi2\("I've been sent to help purify the Varrock stone circle\.", druid_sanfew_information, "Actually I don't need to speak to you\.", sanfew_dont_need\)/);
        expect(src).toMatch(/~p_choice2\("Where can I find this cauldron\?", 1, "Ok, I'll do that then\.", 2\)/);
        expect(src).toMatch(/\[label,druid_sanfew_information\][\s\S]*?%druidquest = \^druid_spoken_sanfew/);
        const san = steps.find(s => s.label?.startsWith('Sanfew: learn'))!;
        expect(san.choices).toEqual([1, 2]);
    });

    test('the four dips match the cauldron script row for row, and the gate precedes them', () => {
        const src = readContent('quests/quest_druid/scripts/quest_druid.rs2');
        expect(src).toMatch(/\[oplocu,cauldron_of_thunder\]/);
        expect(src).toMatch(/if\(%druidquest ! \^druid_spoken_sanfew\)/);   // the gate
        for (const [raw, ench] of [['raw_rat_meat', 'enchanted_rat_meat'], ['raw_beef', 'enchanted_beef'], ['raw_bear_meat', 'enchanted_bear_meat'], ['raw_chicken', 'enchanted_chicken']]) {
            expect(src).toMatch(new RegExp(`inv_del\\(inv, ${raw}, 1\\);[\\s\\S]{0,60}inv_add\\(inv, ${ench}, 1\\)`));
        }
        const dips = steps.filter(s => s.op === 'useloc');
        expect(dips.length).toBe(4);
        expect(dips.map(s => s.useItem).sort()).toEqual([RAW_BEEF, RAW_RAT, RAW_BEAR, RAW_CHICKEN].sort());
        expect(dips.map(s => s.expectItem).sort()).toEqual([ENCH_BEEF, ENCH_RAT, ENCH_BEAR, ENCH_CHICKEN].sort());
        // ORDER MATTERS: the Sanfew talk that sets ^druid_spoken_sanfew must come BEFORE every dip.
        const sanfewIdx = steps.findIndex(s => s.label?.startsWith('Sanfew: learn'));
        expect(sanfewIdx).toBeGreaterThanOrEqual(0);
        expect(steps.findIndex(s => s.op === 'useloc')).toBeGreaterThan(sanfewIdx);
    });

    test('the four meats come from the drop tables that GUARANTEE them', () => {
        for (const [file, obj] of [['cow.rs2', 'raw_beef'], ['chicken.rs2', 'raw_chicken'], ['giant_rat.rs2', 'raw_rat_meat'], ['bear.rs2', 'raw_bear_meat']]) {
            expect(readContent(join('drop tables', 'scripts', file))).toMatch(new RegExp(`obj_add\\(npc_coord, ${obj}, 1, \\^lootdrop_duration\\)`));
        }
        const kills = steps.filter(s => s.op === 'kill');
        expect(kills.length).toBe(4);
        expect(kills.every(s => (s.npcTypes?.length ?? 0) > 0 && s.expectItem !== undefined)).toBe(true);
    });

    test('the completion observable is the JOURNAL COLOUR — there is no reward item to watch', () => {
        const quests = readContent('general/scripts/quests.rs2');
        expect(quests).toMatch(/\[proc,send_quest_complete\][\s\S]*?if_setcolour\(\$component, \^green_rgb\)/);
        const druid = readContent('quests/quest_druid/scripts/quest_druid.rs2');
        expect(druid).toMatch(/~send_quest_complete\(questlist:druid,/);
        expect(druid).toMatch(/stat_advance\(herblore, 2500\)/);
        const last = steps[steps.length - 1]!;
        expect(last.questComplete).toBe('druid');
        expect(last.expectItem).toBeUndefined();
    });

    test('NO step ops the prison door; the planners treat it as a wall (quest-gated-doors.json) because the script never opens it', () => {
        const src = readContent('areas/area_taverly/dungeon/scripts/prison_doors.rs2');
        expect(src).toMatch(/npc_add\(\$northern_position, suit_of_armour, 500\)/);
        expect(src).toMatch(/\[oploc1,cauldrondoor_l\]/);
        expect(src).toContain("~open_and_close_double_door2($inside, $side, iron_door_open);");
        expect(steps.some(st => st.op === 'oploc')).toBe(false);
        const gated = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'sdk', 'navgrid', 'quest-gated-doors.json'), 'utf8')) as Array<{ x: number; z: number; locId: number }>;
        for (const [x, z, id] of [[2889, 9830, 2144], [2889, 9831, 2143]] as const) expect(gated.some(g => g.x === x && g.z === z && g.locId === id)).toBe(true);
        // the dips come straight after the Sanfew talk, and the hand-over straight after the last dip
        const dips = steps.map((st, i) => st.op === 'useloc' ? i : -1).filter(i => i >= 0);
        expect(dips[0]).toBe(steps.findIndex(st => st.label?.startsWith('Sanfew: learn')) + 1);
        expect(steps[dips[dips.length - 1]! + 1]!.label).toMatch(/^Sanfew: hand over/);
    });

    test('⛔ THE CAULDRON DOOR IS INVISIBLE TO THE DOOR TRACKER — pin the reason, not the symptom', () => {
        // The runner spends a BOUNDED op budget on this door instead of waiting for an `isOpen` that
        // can never arrive. That is only correct while the premise holds, so the premise is asserted:
        //   (a) the loc config's category matches NEITHER suffix extract-door-states.mjs classifies by,
        //   (b) so door-states.json has no row for 2143/2144,
        //   (c) so DoorTracker.seed()/onLocDel() (which both start with `doorDef(locId)`) skip it.
        // If someone widens the extractor, THIS test fails and the budget can be replaced by the real
        // observable — which is exactly when you want to be told.
        const cfg = readContent('areas/area_taverly/dungeon/configs/taverly_dungeon.loc');
        expect(cfg).toMatch(/\[cauldrondoor\][\s\S]*?category=double_door_open_and_close_right/);
        expect(cfg).toMatch(/\[cauldrondoor_l\][\s\S]*?category=double_door_open_and_close_left/);
        const states = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'sdk', 'navgrid', 'door-states.json'), 'utf8')) as Record<string, unknown>;
        expect(states['2143']).toBeUndefined();
        expect(states['2144']).toBeUndefined();
    });

    test('every useloc stand tile is CARDINAL to its loc (Manhattan 1), never diagonal (the wall door is opped ON its tile from inside)', () => {
        for (const s of steps.filter(st => st.op === 'useloc' || (st.op === 'oploc' && st.doneBox?.x0 !== undefined))) {
            const d = Math.abs(s.xz.x - s.loc!.x) + Math.abs(s.xz.z - s.loc!.z);
            expect({ label: s.label, manhattan: d }).toEqual({ label: s.label, manhattan: 1 });
        }
    });

    test('DR_SKIP_GATHER drops the kill lane and nothing else (hot-swap, read at call time)', () => {
        const before = druidicRitualSteps().length;
        process.env.DR_SKIP_GATHER = '1';
        try {
            const after = druidicRitualSteps();
            expect(after.length).toBe(before - 4);
            expect(after.some(s => s.op === 'kill')).toBe(false);
        } finally { delete process.env.DR_SKIP_GATHER; }
        expect(druidicRitualSteps().length).toBe(before);
    });

    test('DR_*_XZ hunt anchors are overridable at call time', () => {
        process.env.DR_BEAR_XZ = '2965,3465';
        try {
            const bear = druidicRitualSteps().find(s => s.label?.includes('bear'))!;
            expect(bear.xz).toEqual({ x: 2965, z: 3465 });
        } finally { delete process.env.DR_BEAR_XZ; }
        expect(druidicRitualSteps().find(s => s.label?.includes('bear'))!.xz).toEqual({ x: 2966, z: 3474 });
    });

    test('horns / bank steps are opt-in (the bare QUESTS entry has none) and the horn step comes after the completion', () => {
        expect(steps.some(s => s.op === 'bank' || s.expectItem === UNICORN_HORN)).toBe(false);
        const b = { stand: { x: 3094, z: 3491 }, booth: { x: 3095, z: 3491 } };
        const full = druidicRitualSteps({ horns: 16, bankFirst: b, bankEnd: b });
        expect(full.length).toBe(12 + 3);
        const comp = full.findIndex(s => s.questComplete === 'druid');
        const horn = full.findIndex(s => s.expectItem === UNICORN_HORN);
        expect(horn).toBe(comp + 1); expect(full[horn]!.expectCount).toBe(16);
        expect(full[0]!.op).toBe('bank'); expect(full[full.length - 1]!.op).toBe('bank');
        expect(full[0]!.loc).toEqual({ x: 3095, z: 3491, id: 2213, op: 2 });
    });
});

// cd server/webclient/headless/sim && bun test quest-death-sim.test.ts
//
// DEATH PLATEAU through the CoopHarness: the REAL DeathPlateauBot (QuestRunnerBot underneath) on the wire.
//   1. a dialog step whose wanted option is NOT option 1 (Saba's p_choice3) is answered by TEXT, and the NPC's line
//      raises the driver's knowledge;
//   2. Denulth's start flips the journal row yellow -> the knowledge floor reads it;
//   3. the five stone balls go from their courtyard spawns onto the right mechanism tiles from CARDINAL stand tiles,
//      a wrong ball on a target tile is lifted first, and the server's unlock message ends the task;
//   4. reading the IOU (OPHELD1) yields the combination;
//   5. the dice modal: count dialog -> bet, "Your roll..." -> IF_BUTTON com_28, "You win!" -> RESUME_PAUSEBUTTON, and the
//      modal is NEVER closed by the bot (closing before the roll forfeits the stake).
// ⛔ What this does NOT prove: that the live server's dialog pages / modal timings match these fixtures. The fixtures
// are transcriptions of quest_death/scripts/*.rs2; the quest needs one live smoke (see the report).
import { describe, test, expect, afterEach } from 'bun:test';
import { ClientProt } from '#/io/ClientProt.js';
import { CoopWorld, CoopHarness, CoopPlayer, type QuestStep } from './coop.js';
import type { ClientAction } from './protocol.js';
import { openField } from './world.js';
import { linePath } from './harness.js';
import { DeathPlateauBot, DP_NPC, DP_OBJ, DP_IF, DP_WANT, BALL_TARGETS, BALL_SPAWNS, EQ, floorFromInventory, nextAction } from '../quest-death.js';

const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
const EQUIP_VARP = 900, MAP_VARP = 901;   // sim-internal ids: the real varps do not transmit
const INV_INTERFACE = 3214;
const BALLS = new Set<number>([DP_OBJ.BALL_RED, DP_OBJ.BALL_BLUE, DP_OBJ.BALL_YELLOW, DP_OBJ.BALL_PURPLE, DP_OBJ.BALL_GREEN]);

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

function mkBot(): DeathPlateauBot {
    const b = new DeathPlateauBot();
    b.quiet = true; (b as any).exitOnStuck = false; b.findLongPathFn = lp;
    b.travelEnabled = false; b.arrived = true;
    b.log = () => {};
    return b;
}

/**
 * The stone mechanism + the IOU, ported from quest_death.rs2:
 *  [oplocu,death_stone_mechanism_*] -> @death_place_stone (:84-98): refuse if any ball is already on the loc tile,
 *    else inv_dropitem onto the loc tile; if %death_equiproom = found_combo and all five are right -> unlock.
 *  [opheld1,death_iou] (:26-35): IOU -> combination, found_combo.
 * Ground objs reach the client the way the harness emits them (OBJ_ADD on an 'npc-killed'-shaped event).
 */
class DpWorld extends CoopWorld {
    private announced = false;
    private ev(kind: string, detail: Record<string, unknown>) { const e = { tick: this.tick, kind, detail }; this.events.push(e); return e; }
    private msgTo(p: CoopPlayer, text: string) { (p.outPre as unknown as Array<{ kind: string; text: string }>).push({ kind: 'msg', text }); }
    override coopTick(actions: Map<number, ClientAction[]>) {
        const out = super.coopTick(actions);
        if (!this.announced) {
            this.announced = true;
            for (const g of this.groundObjs) out.push(this.ev('npc-killed', { player: '-', npc: -1, type: -1, drop: g.obj, x: g.x, z: g.z }));
        }
        return out;
    }
    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        if (a.type === 'oplocu') {
            const t = BALL_TARGETS.find(m => m.x === a.x && m.z === a.z && m.locId === a.locId);
            if (t) {
                if (Math.abs(p.x - t.x) + Math.abs(p.z - t.z) !== 1) { this.msgTo(p, "I can't reach that!"); this.ev('cant-reach', { at: { x: p.x, z: p.z } }); return; }
                const why = this.oplocuRejected(p, a);
                if (why) { this.ev('oplocu-rejected', { why }); return; }
                if (!BALLS.has(a.obj)) { this.msgTo(p, 'Nothing interesting happens.'); return; }
                if (this.groundObjs.some(g => g.x === t.x && g.z === t.z && BALLS.has(g.obj))) { this.msgTo(p, 'There is already a stone ball here.'); this.ev('ball-occupied', { x: t.x, z: t.z }); return; }
                this.invRemove(p.inv, a.obj, 1); p.outInvs.add(INV_INTERFACE);
                this.groundObjs.push({ x: t.x, z: t.z, obj: a.obj, count: 1 });
                this.ev('npc-killed', { player: p.name, npc: -1, type: -1, drop: a.obj, x: t.x, z: t.z });
                this.ev('ball-placed', { obj: a.obj, x: t.x, z: t.z });
                if (this.questState(EQUIP_VARP) === EQ.FOUND_COMBO && BALL_TARGETS.every(b => this.groundObjs.some(g => g.x === b.x && g.z === b.z && g.obj === b.obj))) {
                    this.msgTo(p, 'The equipment room door has unlocked.');
                    this.setQuestVar(EQUIP_VARP, EQ.UNLOCKED_DOOR);
                    this.ev('door-unlocked', {});
                }
                return;
            }
        }
        if (a.type === 'opheld' && a.op === ClientProt.OPHELD1 && a.obj === DP_OBJ.IOU) {
            const s = p.inv[a.slot];
            if (s && s.id === DP_OBJ.IOU) {
                p.inv[a.slot] = null; this.invAdd(p.inv, DP_OBJ.COMBINATION, 1); p.outInvs.add(INV_INTERFACE);
                this.msgTo(p, 'You have found the combination!');
                if (this.questState(EQUIP_VARP) === EQ.GIVEN_IOU) this.setQuestVar(EQUIP_VARP, EQ.FOUND_COMBO);
                this.ev('iou-read', {});
            }
            return;
        }
        super.applyAction(p, a);
    }
}

async function until(n: number, stop: () => boolean): Promise<string[]> {
    const kinds: string[] = [];
    for (let i = 0; i < n && !stop(); i++) { const r = await h!.tick(); for (const e of r.events) kinds.push(e.kind); }
    return kinds;
}

describe('DeathPlateauBot: dialog steps', () => {
    test("Saba's p_choice3 is answered by TEXT (option 2), and her line raises the map knowledge", async () => {
        const at = { x: 2900, z: 3540 };
        const world = new DpWorld(openField());
        const saba: QuestStep = {
            npc: DP_NPC.SABA, op: 'talk', varp: MAP_VARP, whenState: 0, toState: 1, pages: 2, choicePage: 1, choiceRoot: 2469, expectChoice: 2,
            // death_saba.rs2:384 — the wanted option is SECOND
            choiceLabels: ["I'm looking for the guard that was on last night.", 'Do you know of another way up Death Plateau?', 'Nothing, sorry!'],
            // (the sim applies a choice only on the LAST page, so Saba's answer line is modelled on page 0)
            pageTexts: ["Before the trolls came there used to be a nettlesome Sherpa that took humans exploring or something equally stupid. Perhaps he'd know another way."],
        };
        world.registerQuest([saba]);
        world.addNpc(1, DP_NPC.SABA, at.x + 1, at.z);
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.STARTED;
        h.add({ bot: b as any, name: 'dp1', index: 11, x: at.x, z: at.z });
        await h.start();
        b.runTalk({ npcType: DP_NPC.SABA, xz: at, level: 0, op: 'talk', label: 'Saba' }, DP_WANT.saba);
        const kinds = await until(200, () => b.done && world.questState(MAP_VARP) === 1);
        expect(world.questState(MAP_VARP)).toBe(1);
        expect(kinds).not.toContain('quest-wrong-choice');
        for (let i = 0; i < 5; i++) await h.tick();
        expect(b.k.map).toBe(1);
        expect(nextAction(b.k, b.has)).toMatchObject({ kind: 'talk', npc: 'tenzing' });
    }, 60_000);

    test("Denulth's start turns the journal yellow -> the knowledge floor reads IN_PROGRESS", async () => {
        const at = { x: 2896, z: 3529 };
        const world = new DpWorld(openField());
        world.registerQuest([{
            npc: DP_NPC.DENULTH, op: 'talk', varp: EQUIP_VARP, whenState: 0, toState: EQ.STARTED, pages: 2, choicePage: 1, choiceRoot: 2469, expectChoice: 1,
            choiceLabels: ['Do you have any quests for me?', 'What is this place?', "You can't, thanks."],
            pageTexts: ['Hello citizen, how can I help?'],
            journalComponent: DP_IF.JOURNAL, journalComplete: EQ.COMPLETE,
        }]);
        world.addNpc(1, DP_NPC.DENULTH, at.x, at.z - 1);
        h = new CoopHarness(world);
        const b = mkBot();
        h.add({ bot: b as any, name: 'dp2', index: 12, x: at.x, z: at.z });
        await h.start();
        b.runTalk({ npcType: DP_NPC.DENULTH, xz: at, level: 0, op: 'talk', label: 'Denulth' }, DP_WANT.denulthStart);
        await until(200, () => b.done && world.questState(EQUIP_VARP) === EQ.STARTED);
        for (let i = 0; i < 3; i++) await h.tick();
        expect(world.questState(EQUIP_VARP)).toBe(EQ.STARTED);
        expect(b.journal()).toBe('IN_PROGRESS');
        floorFromInventory(b.k, b.has, b.journal());
        expect(b.k.equip).toBe(EQ.STARTED);
        expect(nextAction(b.k, b.has)).toMatchObject({ kind: 'talk', npc: 'saba' });
    }, 60_000);
});

function ballWorld(extra: Array<{ x: number; z: number; obj: number }> = []): DpWorld {
    const world = new DpWorld(openField());
    for (const [obj, s] of Object.entries(BALL_SPAWNS)) world.addGroundObj(s.x, s.z, Number(obj));
    for (const e of extra) world.addGroundObj(e.x, e.z, e.obj);
    world.setQuestVar(EQUIP_VARP, EQ.FOUND_COMBO);
    return world;
}
const ballOn = (w: DpWorld, x: number, z: number) => w.groundObjs.filter(g => g.x === x && g.z === z && BALLS.has(g.obj)).map(g => g.obj);

describe('DeathPlateauBot: the stone balls', () => {
    test('five balls, spawn -> mechanism, cardinal stand tiles, unlock message ends the task', async () => {
        const world = ballWorld();
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.FOUND_COMBO; b.k.map = 8;
        h.add({ bot: b as any, name: 'dp3', index: 13, x: 2897, z: 3563 });
        await h.start();
        const task = b.startTask({ kind: 'balls', label: 'balls', until: () => b.k.equip >= EQ.UNLOCKED_DOOR, retryTicks: 1, budget: 1500 });
        const kinds = await until(900, () => task.result !== 'run');
        expect(task.result).toBe('ok');
        expect(world.questState(EQUIP_VARP)).toBe(EQ.UNLOCKED_DOOR);
        expect(b.k.equip).toBe(EQ.UNLOCKED_DOOR);
        for (const t of BALL_TARGETS) expect(ballOn(world, t.x, t.z)).toEqual([t.obj]);
        expect(kinds.filter(k => k === 'ball-placed').length).toBe(5);
        expect(kinds).not.toContain('cant-reach');
        expect(kinds).not.toContain('oplocu-rejected');
        expect(h.violations.filter(v => v.type === 'silent-bot')).toEqual([]);
    }, 120_000);

    test("a WRONG ball on a target tile is lifted first (red on blue's tile)", async () => {
        const world = ballWorld([{ x: 2894, z: 3562, obj: DP_OBJ.BALL_RED }]);
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.FOUND_COMBO; b.k.map = 8;
        h.add({ bot: b as any, name: 'dp4', index: 14, x: 2897, z: 3563 });
        await h.start();
        const task = b.startTask({ kind: 'balls', label: 'balls', until: () => b.k.equip >= EQ.UNLOCKED_DOOR, retryTicks: 1, budget: 1500 });
        const kinds = await until(900, () => task.result !== 'run');
        expect(task.result).toBe('ok');
        for (const t of BALL_TARGETS) expect(ballOn(world, t.x, t.z)).toEqual([t.obj]);
        const firstTake = kinds.indexOf('obj-taken');
        expect(firstTake).toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf('ball-placed')).toBeGreaterThan(firstTake);
        expect(kinds).not.toContain('ball-occupied');
    }, 120_000);

    test('placed before found_combo -> no unlock; the task lifts one ball and re-places it once the stage is right', async () => {
        // all five already on their tiles (e.g. placed while the IOU was still unread), no unlock happened
        const world = new DpWorld(openField());
        for (const t of BALL_TARGETS) world.addGroundObj(t.x, t.z, t.obj);
        world.setQuestVar(EQUIP_VARP, EQ.FOUND_COMBO);
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.FOUND_COMBO; b.k.map = 8;
        h.add({ bot: b as any, name: 'dp5', index: 15, x: 2897, z: 3563 });
        await h.start();
        const task = b.startTask({ kind: 'balls', label: 'balls', until: () => b.k.equip >= EQ.UNLOCKED_DOOR, retryTicks: 1, budget: 1500 });
        const kinds = await until(600, () => task.result !== 'run');
        expect(task.result).toBe('ok');
        expect(kinds).toContain('door-unlocked');
        expect(kinds.filter(k => k === 'ball-placed').length).toBe(1);
    }, 120_000);
});

describe('DeathPlateauBot: IOU and dice', () => {
    test('reading the IOU (OPHELD1) yields the combination and the found_combo fact', async () => {
        const world = new DpWorld(openField());
        world.setQuestVar(EQUIP_VARP, EQ.GIVEN_IOU);
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_IOU; b.k.map = 8;
        h.add({ bot: b as any, name: 'dp6', index: 16, x: 2900, z: 3540, inv: [{ id: DP_OBJ.IOU, count: 1 }] });
        await h.start();
        const task = b.startTask({ kind: 'held', label: 'read the IOU', obj: DP_OBJ.IOU, until: () => b.countOf(DP_OBJ.COMBINATION) > 0, retryTicks: 10, budget: 4 });
        await until(80, () => task.result !== 'run');
        for (let i = 0; i < 3; i++) await h.tick();
        expect(task.result).toBe('ok');
        expect(h.invCount('dp6', DP_OBJ.COMBINATION)).toBe(1);
        expect(b.k.equip).toBe(EQ.FOUND_COMBO);
        expect(nextAction(b.k, b.has)).toEqual({ kind: 'balls' });
    }, 60_000);

    test('count dialog -> the planned bet; dice: roll on "Your roll...", resume on "You win!", never close it', async () => {
        const world = new DpWorld(openField());
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_ALE; b.k.map = 8; b.k.purse = 100;
        h.add({ bot: b as any, name: 'dp7', index: 17, x: 2900, z: 3540, inv: [{ id: DP_OBJ.COINS, count: 2000 }] });
        world.registerStackable(DP_OBJ.COINS);
        await h.start();
        const p = h.playerOf('dp7');
        const push = (o: Record<string, unknown>) => (p.outPre as unknown as Array<Record<string, unknown>>).push(o);
        const acts: ClientAction[] = [];
        const step = async (n = 1) => { for (let i = 0; i < n; i++) { const r = await h!.tick(); acts.push(...(r.actions.get('dp7') ?? [])); } };
        await step(2);
        b.pendingBet = 101;
        push({ kind: 'countdialog' });                            // p_countdialog (death_guard_equiproom.rs2:227)
        await step(3);
        expect(acts.some(a => a.type === 'countreply' && a.n === 101)).toBe(true);
        expect(b.pendingBet).toBe(0);
        // harold_roll: settext "Harold rolls..." then if_openmain(death_dice)
        push({ kind: 'settext', com: DP_IF.DICE_STATUS, text: 'Harold rolls...' });
        push({ kind: 'openmain', com: DP_IF.DICE_ROOT });
        p.modal = DP_IF.DICE_ROOT;
        await step(4);
        expect(acts.some(a => a.type === 'ifbutton' && a.com === DP_IF.DICE_ROLL)).toBe(false);   // not before Harold has rolled
        push({ kind: 'settext', com: DP_IF.DICE_STATUS, text: 'Your roll...' });
        await step(3);
        expect(acts.filter(a => a.type === 'ifbutton' && a.com === DP_IF.DICE_ROLL).length).toBe(1);
        push({ kind: 'settext', com: DP_IF.DICE_STATUS, text: 'You win!' });
        await step(3);
        expect(acts.some(a => a.type === 'resume')).toBe(true);
        expect(b.lastRoll).toMatchObject({ bet: 101, text: 'You win!' });
        expect(acts.some(a => a.type === 'closemodal')).toBe(false);
    }, 60_000);
});

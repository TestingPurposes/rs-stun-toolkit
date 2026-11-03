// DEATH PLATEAU DICE — a CONTENT-FAITHFUL model of death_guard_equiproom.rs2 ( sim review).
//
// The older dice test (quest-death-sim.test.ts) PUSHES "Your roll..." / "You win!" itself, whatever the bot does — it
// cannot catch a bot that never actually rolls, nor a result that never arrives. Live (10-07/08) the bot logged
// "dice — rolling" 63 times and never one result line while losing 8 bets. This world runs the script instead:
//   [label,harold_roll]  settext "Harold rolls..." + if_openmain(death_dice); p_delay(2) x2 (Harold's two dice);
//                        queue(haroldgamble_end); if_sethide(com_27,false); settext "Your roll..."
//   [if_button,death_dice:com_28] -> [label,player_roll]  (IfButtonHandler drops a click on a HIDDEN component: com_28
//                        sits in com_27) hide com_27; p_delay(2) x2; ~dice_winnings; settext "You win!"/"You lose!";
//                        unhide com_29; p_pausebutton; if_close
//   ~dice_winnings       goldclaimed; win (player > harold, or Harold very drunk) -> harold pays (if his gold covers the
//                        bet, else harold_lostall), lose -> pay Harold. mes() lines as in the script.
//   [queue,haroldgamble_end]  a NORMAL queue: runs only when NO modal is open (Player.canAccess) — i.e. after the
//                        close. Unclaimed -> ~dice_winnings (player roll 0 = a loss); lostall -> IOU.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness, CoopPlayer } from './coop.js';
import type { ClientAction } from './protocol.js';
import { openField } from './world.js';
import { linePath } from './harness.js';
import { DeathPlateauBot, DP_OBJ, DP_IF, EQ } from '../quest-death.js';

const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
const INV_INTERFACE = 3214;
let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

function mkBot(): DeathPlateauBot {
    const b = new DeathPlateauBot();
    b.quiet = true; (b as any).exitOnStuck = false; b.findLongPathFn = lp;
    b.travelEnabled = false; b.arrived = true;
    b.log = () => {};
    return b;
}

type Dice = { bet: number; harold: number; player: number; claimed: boolean; com27: boolean; paused: boolean; at: number; stage: 'harold' | 'await-roll' | 'rolling' | 'paused' };

class DiceWorld extends CoopWorld {
    haroldGold = 100; veryDrunk = false; lostAll = false;
    rolls: number[] = [];                 // scripted ~random_range(1,6) results, consumed in order
    dice: Dice | null = null; countArmed = false; endQueued = false;
    clicksWhileHidden = 0; ious = 0; results: string[] = [];
    private roll(): number { return this.rolls.length ? this.rolls.shift()! : 1 + Math.floor(Math.random() * 6); }
    private pre(p: CoopPlayer, o: Record<string, unknown>) { (p.outPre as unknown as Array<Record<string, unknown>>).push(o); }
    private mes(p: CoopPlayer, text: string) { this.pre(p, { kind: 'msg', text }); }
    private settext(p: CoopPlayer, text: string) { this.pre(p, { kind: 'settext', com: DP_IF.DICE_STATUS, text }); }
    armCount(p: CoopPlayer) { this.countArmed = true; this.pre(p, { kind: 'countdialog' }); }
    private dicePlayer(): CoopPlayer { return [...this.playersByIndex.values()][0]!; }

    private winnings(p: CoopPlayer, d: Dice) {
        d.claimed = true;
        const coins = p.inv.reduce((n, s) => n + (s && s.id === DP_OBJ.COINS ? s.count : 0), 0);
        if (coins < d.bet) return;
        if (d.player > 0 && (this.veryDrunk || d.player > d.harold)) {
            if (this.haroldGold - d.bet < 0) { this.lostAll = true; return; }   // paid out in the queue (IOU)
            this.mes(p, 'Harold has given you your winnings!');
            this.invAdd(p.inv, DP_OBJ.COINS, d.bet); this.haroldGold -= d.bet;
        } else {
            this.mes(p, 'You give Harold his winnings.');
            this.invRemove(p.inv, DP_OBJ.COINS, d.bet); this.haroldGold += d.bet;
        }
        p.outInvs.add(INV_INTERFACE);
    }
    private endQueue(p: CoopPlayer) {   // [queue,haroldgamble_end] — only once no modal is open
        const d = this.dice; this.endQueued = false; this.dice = null;
        if (d && !d.claimed) this.winnings(p, d);
        if (this.lostAll) { this.lostAll = false; this.invAdd(p.inv, DP_OBJ.IOU, 1); p.outInvs.add(INV_INTERFACE); this.mes(p, 'Harold has given you an IOU scribbled on some paper.'); this.ious++; }
    }
    override coopTick(actions: Map<number, ClientAction[]>) {
        const out = super.coopTick(actions);
        const p = this.dicePlayer(); const d = this.dice;
        if (d && d.stage === 'harold' && this.tick - d.at >= 4) {
            d.harold = this.roll() + this.roll(); d.stage = 'await-roll';
            this.endQueued = true; d.com27 = true; this.settext(p, 'Your roll...');
        } else if (d && d.stage === 'rolling' && this.tick - d.at >= 4) {
            d.player = this.roll() + this.roll();
            this.winnings(p, d);
            const r = d.player > d.harold || this.veryDrunk ? 'You win!' : 'You lose!';
            this.results.push(r); this.settext(p, r); d.stage = 'paused'; d.paused = true;
        }
        if (this.endQueued && p.modal === -1) this.endQueue(p);
        return out;
    }
    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        if (a.type === 'countreply' && this.countArmed) {     // [label,harold_roll](entered value)
            this.countArmed = false;
            this.dice = { bet: a.n, harold: 0, player: 0, claimed: false, com27: false, paused: false, at: this.tick, stage: 'harold' };
            this.settext(p, 'Harold rolls...');
            this.pre(p, { kind: 'openmain', com: DP_IF.DICE_ROOT }); p.modal = DP_IF.DICE_ROOT;
            return;
        }
        if (a.type === 'ifbutton' && a.com === DP_IF.DICE_ROLL) {
            const d = this.dice;
            if (!d || p.modal !== DP_IF.DICE_ROOT || !d.com27 || d.stage !== 'await-roll') { this.clicksWhileHidden++; return; }   // IfButtonHandler: hidden -> dropped
            d.com27 = false; d.stage = 'rolling'; d.at = this.tick;
            return;
        }
        if (a.type === 'resume' && this.dice?.paused) { p.modal = -1; return; }   // p_pausebutton -> if_close
        if (a.type === 'closemodal' && p.modal === DP_IF.DICE_ROOT) { p.modal = -1; return; }   // forfeits an unrolled game
        super.applyAction(p, a);
    }
}

async function play(world: DiceWorld, b: DeathPlateauBot, name: string, bet: number, ticks = 40) {
    const p = h!.playerOf(name);
    b.pendingBet = bet; world.armCount(p);
    for (let i = 0; i < ticks && (world.dice !== null || world.countArmed); i++) await h!.tick();
    for (let i = 0; i < 3; i++) await h!.tick();
}
const coinsOf = (name: string) => h!.invCount(name, DP_OBJ.COINS);

describe('death_dice, run from the script (not pushed)', () => {
    test('a WIN: the bot rolls only once "Your roll..." shows, sees "You win!", resumes; coins +bet', async () => {
        const world = new DiceWorld(openField()); world.registerStackable(DP_OBJ.COINS);
        world.rolls = [1, 1, 6, 6];   // Harold 2, player 12
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_ALE; b.k.map = 8;
        h.add({ bot: b as any, name: 'dd1', index: 31, x: 2906, z: 3540, inv: [{ id: DP_OBJ.COINS, count: 5000 }] });
        await h.start();
        await play(world, b, 'dd1', 50);
        expect(world.results).toEqual(['You win!']);
        expect(world.clicksWhileHidden).toBe(0);
        expect(b.lastRoll).toMatchObject({ bet: 50, text: 'You win!' });
        expect(coinsOf('dd1')).toBe(5050);
        expect(h.playerOf('dd1').modal).toBe(-1);   // resumed -> if_close
    }, 60_000);

    test('a LOSS: coins -bet, the bot still resumes (never closes before the result)', async () => {
        const world = new DiceWorld(openField()); world.registerStackable(DP_OBJ.COINS);
        world.rolls = [6, 6, 1, 1];
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_ALE; b.k.map = 8;
        h.add({ bot: b as any, name: 'dd2', index: 32, x: 2906, z: 3540, inv: [{ id: DP_OBJ.COINS, count: 5000 }] });
        await h.start();
        await play(world, b, 'dd2', 1000);
        expect(world.results).toEqual(['You lose!']);
        expect(b.lastRoll).toMatchObject({ text: 'You lose!' });
        expect(coinsOf('dd2')).toBe(4000);
    }, 60_000);

    test('a WIN larger than Harold\'s purse -> harold_lostall -> the IOU arrives after the close (haroldgamble_end)', async () => {
        const world = new DiceWorld(openField()); world.registerStackable(DP_OBJ.COINS);
        world.haroldGold = 100; world.rolls = [1, 2, 5, 6];
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_ALE; b.k.map = 8;
        h.add({ bot: b as any, name: 'dd3', index: 33, x: 2906, z: 3540, inv: [{ id: DP_OBJ.COINS, count: 5000 }] });
        await h.start();
        await play(world, b, 'dd3', 1000);
        expect(world.ious).toBe(1);
        expect(h.invCount('dd3', DP_OBJ.IOU)).toBe(1);
        expect(coinsOf('dd3')).toBe(5000);   // no coins moved on a lost-all win
    }, 60_000);

    test('very drunk Harold: every roll wins (the script\'s verydrunk branch)', async () => {
        const world = new DiceWorld(openField()); world.registerStackable(DP_OBJ.COINS);
        world.veryDrunk = true; world.haroldGold = 10_000; world.rolls = [6, 6, 1, 1];
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_ALE; b.k.map = 8;
        h.add({ bot: b as any, name: 'dd4', index: 34, x: 2906, z: 3540, inv: [{ id: DP_OBJ.COINS, count: 5000 }] });
        await h.start();
        await play(world, b, 'dd4', 500);
        expect(world.results).toEqual(['You win!']);
        expect(coinsOf('dd4')).toBe(5500);
    }, 60_000);
});

describe('death_dice: the result TEXT never arrives (the live symptom)', () => {
    test('the bot decides the roll from the winnings MESSAGE and resumes the paused modal', async () => {
        class NoTextWorld extends DiceWorld {
            protected override applyAction(p: CoopPlayer, a: ClientAction): void { super.applyAction(p, a); }
        }
        const world = new NoTextWorld(openField()); world.registerStackable(DP_OBJ.COINS);
        world.rolls = [1, 1, 6, 6];
        // drop the result settext: intercept the outPre queue for "You win!/You lose!"
        h = new CoopHarness(world);
        const b = mkBot(); b.k.equip = EQ.GIVEN_ALE; b.k.map = 8;
        h.add({ bot: b as any, name: 'dd5', index: 35, x: 2906, z: 3540, inv: [{ id: DP_OBJ.COINS, count: 5000 }] });
        await h.start();
        const p = h.playerOf('dd5');
        const q = p.outPre as unknown as Array<Record<string, unknown>>;
        const origPush = q.push.bind(q);
        q.push = (...items: Array<Record<string, unknown>>) => origPush(...items.filter(o => !(o.kind === 'settext' && /^You (win|lose)!/.test(String(o.text)))));
        await play(world, b, 'dd5', 50);
        expect(world.results).toEqual(['You win!']);              // the world resolved it ...
        expect(b.lastRoll).toMatchObject({ text: 'You win!' });     // ... and the bot knew, from the message alone
        expect(h.playerOf('dd5').modal).toBe(-1);                   // and resumed -> if_close
        expect(coinsOf('dd5')).toBe(5050);
    }, 60_000);
});

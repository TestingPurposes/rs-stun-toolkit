// cd server/webclient/headless/sim && bun test quest-supplies-sim.test.ts
//
// DEATH PLATEAU SUPPLIES through the CoopHarness: the REAL DpKitBot (quest-supplies.ts) on the wire.
//   1. Gerrant: OPNPC3 -> shop modal 3824 -> fly rod + 60 feathers via the 1/5/10 buttons, modal closed after, and
//      the carried iron bar / sharks / coins (minus the price) untouched;
//   2. the baker: a DRAINED shared shelf (stock 4) is waited out (restock) with the modal open until 10 bread are held;
//   3. the Burthorpe fire: OPLOCU raw trout from the CARDINAL stand, one per use, until 10 cooked (no make-X);
//   4. lure fishing: OPNPC1 on the spot from a cardinal land tile, salmon dropped when the pack is nearly full, the
//      cast re-kicked after the drop, until 10 raw trout are held.
// ⛔ What this does NOT prove: live shop prices / restock timing, the real lure cadence, that the spot tiles' cardinal
// neighbours are land live. The worlds below are transcriptions of the content (see quest-supplies.ts citations).
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness, type CoopPlayer } from './coop.js';
import type { ClientAction } from './protocol.js';
import { openField } from './world.js';
import { linePath } from './harness.js';
import { DpKitBot, SUP_OBJ, SUP_NPC, SUP_LOC, SUP_SITES, FIRE_STAND } from '../quest-supplies.js';

const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
const INV_INTERFACE = 3214;

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

function mkBot(): DpKitBot {
    const b = new DpKitBot();
    b.quiet = true; (b as any).exitOnStuck = false; b.findLongPathFn = lp;
    b.travelEnabled = false; b.arrived = true;
    b.log = () => {};
    return b;
}
/** what the quester carries in (never to be touched) */
const CARRIED = [{ id: SUP_OBJ.COINS, count: 4000 }, { id: SUP_OBJ.IRON_BAR, count: 1 }, { id: SUP_OBJ.SHARK, count: 1 }, { id: SUP_OBJ.SHARK, count: 1 }, { id: SUP_OBJ.SHARK, count: 1 }, { id: SUP_OBJ.SHARK, count: 1 }];

async function tickUntil(n: number, stop: () => boolean): Promise<string[]> {
    const kinds: string[] = [];
    for (let i = 0; i < n && !stop(); i++) { const r = await h!.tick(); for (const e of r.events) kinds.push(e.kind); }
    return kinds;
}

describe('DpKitBot: shops', () => {
    test('Gerrant: fly rod + 60 feathers, modal closed, carried items untouched', async () => {
        const at = { x: 3013, z: 3227 };
        const world = new CoopWorld(openField());
        world.registerStackable(SUP_OBJ.FEATHER);
        world.registerCost(SUP_OBJ.FLY_ROD, 5); world.registerCost(SUP_OBJ.FEATHER, 2);
        world.addNpc(5, SUP_NPC.GERRANT, SUP_SITES.GERRANT.at.x, SUP_SITES.GERRANT.at.z);
        // port_sarim.inv [fishingshop]: net 5, fishing_rod 5, fly_fishing_rod 5, ..., feather 1000
        world.addShop(5, [{ id: 303, count: 5 }, { id: 307, count: 5 }, { id: SUP_OBJ.FLY_ROD, count: 5 }, { id: SUP_OBJ.FEATHER, count: 1000 }]);
        h = new CoopHarness(world);
        const b = mkBot();
        h.add({ bot: b as any, name: 'sup1', index: 21, x: at.x, z: at.z, inv: CARRIED });
        await h.start();
        const t = b.startTask({ kind: 'shop', label: 'Gerrant', npcType: SUP_NPC.GERRANT, buys: [{ obj: SUP_OBJ.FLY_ROD, target: 1 }, { obj: SUP_OBJ.FEATHER, target: 60 }], budget: 200 });
        const kinds = await tickUntil(200, () => t.result !== 'run');
        for (let i = 0; i < 3; i++) await h.tick();
        expect(t.result).toBe('ok');
        expect(kinds).toContain('shop-opened');
        expect(b.countOf(SUP_OBJ.FLY_ROD)).toBe(1);
        expect(b.countOf(SUP_OBJ.FEATHER)).toBe(60);
        expect(b.countOf(SUP_OBJ.COINS)).toBe(4000 - 5 - 60 * 2);
        expect(b.countOf(SUP_OBJ.IRON_BAR)).toBe(1);
        expect(b.countOf(SUP_OBJ.SHARK)).toBe(4);
        expect(world.playersByIndex.get(21)!.modal).toBe(-1);   // closed after buying
    }, 60_000);

    test('baker: a drained shared shelf is waited out with the modal open until 10 bread', async () => {
        const at = { x: 2669, z: 3312 };
        const world = new CoopWorld(openField());
        world.registerCost(SUP_OBJ.BREAD, 12);
        world.addNpc(6, SUP_NPC.BAKER, SUP_SITES.BAKER.at.x, SUP_SITES.BAKER.at.z);
        // ardougne_east.inv [bakery]: bread,10,100 — modelled drained to 4, +1 per 5 ticks
        world.addShop(6, [{ id: SUP_OBJ.BREAD, count: 4 }, { id: 1891, count: 3 }], false, { id: SUP_OBJ.BREAD, per: 5, max: 10 });
        h = new CoopHarness(world);
        const b = mkBot();
        h.add({ bot: b as any, name: 'sup2', index: 22, x: at.x, z: at.z, inv: CARRIED });
        await h.start();
        const t = b.startTask({ kind: 'shop', label: 'Baker', npcType: SUP_NPC.BAKER, buys: [{ obj: SUP_OBJ.BREAD, target: 10 }], budget: 400 });
        await tickUntil(400, () => t.result !== 'run');
        for (let i = 0; i < 3; i++) await h.tick();
        expect(`${t.result} ${t.why}`).toBe('ok everything bought');
        expect(b.countOf(SUP_OBJ.BREAD)).toBe(10);
        expect(b.countOf(SUP_OBJ.COINS)).toBe(4000 - 120);
        expect(b.countOf(SUP_OBJ.SHARK)).toBe(4);
        expect(world.playersByIndex.get(22)!.modal).toBe(-1);
    }, 60_000);
});

describe('DpKitBot: cook', () => {
    test('Cooking < 15: raw shrimp cooked FIRST (trains it), then trout once Cooking reaches 15', async () => {
        const fire = SUP_SITES.FIRE_BURTHORPE.at;
        const world = new CoopWorld(openField());
        world.registerTransmuteLoc({ x: fire.x, z: fire.z, locId: SUP_LOC.FIRE, map: { [SUP_OBJ.RAW_TROUT]: SUP_OBJ.TROUT, 317: 315 } });
        h = new CoopHarness(world);
        const b = mkBot() as any;
        let lvl = 1; b.cookLvl = () => lvl;
        const raw = Array.from({ length: 3 }, () => ({ id: SUP_OBJ.RAW_TROUT, count: 1 }));
        h.add({ bot: b, name: 'sup5', index: 25, x: FIRE_STAND.x, z: FIRE_STAND.z, inv: [...CARRIED, { id: 317, count: 1 }, ...raw] });
        await h.start();
        const t = b.startTask({ kind: 'cook', label: 'cook', target: 3, loc: { x: fire.x, z: fire.z, id: SUP_LOC.FIRE }, stand: FIRE_STAND, budget: 200 });
        await tickUntil(200, () => b.countOf(315) > 0 || t.result !== 'run');
        expect(b.countOf(315)).toBe(1);
        expect(b.countOf(SUP_OBJ.RAW_TROUT)).toBe(3);
        lvl = 30;
        await tickUntil(200, () => t.result !== 'run');
        expect(t.result).toBe('ok'); expect(b.countOf(SUP_OBJ.TROUT)).toBe(3);
    });
    test('Cooking < 15 with no shrimp/anchovy: fails at once, trout untouched', async () => {
        const fire = SUP_SITES.FIRE_BURTHORPE.at;
        const world = new CoopWorld(openField());
        world.registerTransmuteLoc({ x: fire.x, z: fire.z, locId: SUP_LOC.FIRE, map: { [SUP_OBJ.RAW_TROUT]: SUP_OBJ.TROUT } });
        h = new CoopHarness(world);
        const b = mkBot() as any; b.cookLvl = () => 1;
        h.add({ bot: b, name: 'sup6', index: 26, x: FIRE_STAND.x, z: FIRE_STAND.z, inv: [...CARRIED, { id: SUP_OBJ.RAW_TROUT, count: 1 }] });
        await h.start();
        const t = b.startTask({ kind: 'cook', label: 'cook', target: 1, loc: { x: fire.x, z: fire.z, id: SUP_LOC.FIRE }, stand: FIRE_STAND, budget: 200 });
        await tickUntil(50, () => t.result !== 'run');
        expect(t.result).toBe('fail'); expect(b.countOf(SUP_OBJ.RAW_TROUT)).toBe(1);
    });
    test('raw trout -> trout on the Burthorpe fire from the cardinal stand, one per use', async () => {
        const fire = SUP_SITES.FIRE_BURTHORPE.at;
        const world = new CoopWorld(openField());
        world.registerTransmuteLoc({ x: fire.x, z: fire.z, locId: SUP_LOC.FIRE, map: { [SUP_OBJ.RAW_TROUT]: SUP_OBJ.TROUT } });
        h = new CoopHarness(world);
        const b = mkBot();
        // start DIAGONAL to the fire (a refused tile) — the task must walk onto the cardinal stand first
        const raw = Array.from({ length: 10 }, () => ({ id: SUP_OBJ.RAW_TROUT, count: 1 }));
        h.add({ bot: b as any, name: 'sup3', index: 23, x: fire.x - 1, z: fire.z - 1, inv: [...CARRIED, ...raw] });
        await h.start();
        (b as any).cookLvl = () => 99;   // the trout path proper; Cooking < 15 is tested below
        const t = b.startTask({ kind: 'cook', label: 'cook', target: 10, loc: { x: fire.x, z: fire.z, id: SUP_LOC.FIRE }, stand: FIRE_STAND, budget: 200 });
        const kinds = await tickUntil(200, () => t.result !== 'run');
        expect(t.result).toBe('ok');
        expect(b.countOf(SUP_OBJ.TROUT)).toBe(10);
        expect(b.countOf(SUP_OBJ.RAW_TROUT)).toBe(0);
        expect(kinds.filter(k => k === 'transmuted').length).toBe(10);
        expect(kinds).not.toContain('cant-reach');
        expect(kinds).not.toContain('oplocu-rejected');
        expect(b.countOf(SUP_OBJ.SHARK)).toBe(4);
    }, 60_000);
});

/**
 * Lure fishing, ported from freshfish.rs2 / fishing.rs2: OPNPC1 on a freshfish spot from a CARDINAL tile with a fly rod
 * + a feather starts a self-continuing cast; every 5 ticks it lands salmon or trout (alternating here; ~45/55 live) and
 * eats a feather; a full pack stops it ("You can't carry any more fish."); any MOVE / OPHELD cancels it.
 */
class FishWorld extends CoopWorld {
    fishing = new Map<number, number>();   // player index -> next catch tick
    private n = 0;
    private ev(kind: string, detail: Record<string, unknown> = {}) { this.events.push({ tick: this.tick, kind, detail }); }
    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        if (a.type === 'opnpc' && a.op === 1) {
            const npc = this.npcs.get(a.index);
            if (npc && npc.typeId === SUP_NPC.SPOT_SEERS) {
                if (Math.abs(p.x - npc.x) + Math.abs(p.z - npc.z) !== 1) { this.ev('cant-reach', { at: { x: p.x, z: p.z } }); return; }
                if (this.invTotal(p.inv, SUP_OBJ.FLY_ROD) < 1 || this.invTotal(p.inv, SUP_OBJ.FEATHER) < 1) { this.ev('no-tackle'); return; }
                if (!this.fishing.has(p.index)) this.fishing.set(p.index, this.tick + 5);
                this.ev('cast');
                return;
            }
        }
        if (a.type === 'move' || a.type === 'opheld') this.fishing.delete(p.index);
        super.applyAction(p, a);
    }
    override coopTick(actions: Map<number, ClientAction[]>) {
        const out = super.coopTick(actions);
        for (const [idx, next] of this.fishing) {
            if (this.tick < next) continue;
            const p = this.playersByIndex.get(idx)!;
            if (this.freeSlots(p.inv) === 0) { this.fishing.delete(idx); out.push({ tick: this.tick, kind: 'pack-full', detail: {} } as any); continue; }
            const fish = this.n++ % 2 === 0 ? SUP_OBJ.RAW_SALMON : SUP_OBJ.RAW_TROUT;
            this.invRemove(p.inv, SUP_OBJ.FEATHER, 1);
            this.invAdd(p.inv, fish, 1);
            p.outInvs.add(INV_INTERFACE);
            this.fishing.set(idx, this.tick + 5);
            out.push({ tick: this.tick, kind: fish === SUP_OBJ.RAW_TROUT ? 'caught-trout' : 'caught-salmon', detail: {} } as any);
        }
        return out;
    }
}

describe('DpKitBot: lure fishing', () => {
    test('cardinal tile, cast once, salmon dropped near-full, re-kick, 10 raw trout', async () => {
        const spot = { x: 2716, z: 3530 };
        const world = new FishWorld(openField());
        world.registerStackable(SUP_OBJ.FEATHER);
        world.addNpc(7, SUP_NPC.SPOT_SEERS, spot.x, spot.z);
        h = new CoopHarness(world);
        const b = mkBot();
        // carried 6 slots + 2 bread + rod + feathers = 10 used -> 18 free: 10 trout + 10 alternating salmon do not fit,
        // so the near-full salmon drop MUST fire for the last trout to land
        const filler = Array.from({ length: 2 }, () => ({ id: SUP_OBJ.BREAD, count: 1 }));
        h.add({ bot: b as any, name: 'sup4', index: 24, x: spot.x + 3, z: spot.z + 4, inv: [...CARRIED, ...filler, { id: SUP_OBJ.FLY_ROD, count: 1 }, { id: SUP_OBJ.FEATHER, count: 40 }] });
        await h.start();
        const t = b.startTask({ kind: 'fish', label: 'lure', npcType: SUP_NPC.SPOT_SEERS, target: 10, budget: 600 });
        const kinds = await tickUntil(600, () => t.result !== 'run');
        expect(t.result).toBe('ok');
        expect(b.countOf(SUP_OBJ.RAW_TROUT)).toBe(10);
        expect(kinds).not.toContain('cant-reach');
        expect(kinds).toContain('item-dropped');            // salmon went overboard
        expect(kinds.filter(k => k === 'cast').length).toBeGreaterThan(1);   // re-kicked after the drop cancelled it
        expect(kinds.filter(k => k === 'cast').length).toBeLessThan(15);     // ...but not every tick (kick once)
        expect(b.countOf(SUP_OBJ.SHARK)).toBe(4);
        expect(b.countOf(SUP_OBJ.IRON_BAR)).toBe(1);
        expect(b.countOf(SUP_OBJ.BREAD)).toBe(2);
    }, 60_000);
});

describe('driveGearBuy', () => {
    test('buys the adamant longsword at the swordshop keeper and WIELDS it', async () => {
        const { driveGearBuy } = await import('../quest-supplies.js');
        const at = { x: 3205, z: 3398 };
        const world = new CoopWorld(openField());
        world.registerCost(1301, 3200);
        world.registerEquippable(1301, { wearpos: 'rhand' });   // live accounts have Attack 99 (adamant needs 30)
        world.addNpc(7, 551, at.x + 1, at.z);
        world.addShop(7, [{ id: 1301, count: 1 }]);
        h = new CoopHarness(world);
        const b = mkBot() as any;
        h.add({ bot: b, name: 'gb1', index: 27, x: at.x, z: at.z, inv: [{ id: SUP_OBJ.COINS, count: 5000 }] });
        await h.start();
        let done: boolean | null = null;
        driveGearBuy(b, { npc: 551, at, buy: 1301 }, { shouldStop: () => false, log: (s: string) => console.log("[gbtest] " + s) }).then(v => { done = v; });
        for (let i = 0; i < 2000 && done === null; i++) { await h.tick(); await new Promise(r => setTimeout(r, 25)); }   // the driver sleeps in real time
        expect(done).toBe(true);
        expect(b.countOf(1301)).toBe(0);                                   // left the pack ...
        expect(world.playersByIndex.get(27)!.worn.get('rhand')?.id).toBe(1301);   // ... into the worn slot (server side)
        expect(b.countOf(SUP_OBJ.COINS)).toBe(5000 - 3200);
    }, 120_000);
    test('parseGearCfg: valid / invalid', async () => {
        const { parseGearCfg } = await import('../quest-supplies.js');
        expect(parseGearCfg('npc=551;at=3205,3398;buy=1301')).toEqual({ npc: 551, at: { x: 3205, z: 3398 }, buy: 1301 });
        expect(parseGearCfg('npc=551;buy=1301')).toBeNull();
    });
});

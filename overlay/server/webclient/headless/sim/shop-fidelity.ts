// =====================================================================================================
// ShopSimWorld — a FAITHFUL offline model of shop.rs2 + World.ts's restock, for the OUTFITTER suite
// =====================================================================================================
// CoopWorld already has a shop model, but it is deliberately minimal (it exists for the pickless-miner
// self-heal and the quartermaster's allstock trap) and it does NOT match the engine in three ways that
// are load-bearing for a shop-buying brain — one whose job is "buy the right number of units off a
// shallow, slowly-refilling shelf without stripping it":
//
//   1. BUTTON -> UNITS IS WRONG FOR SHOPS. shop.rs2:168-170 wires INV_BUTTON2/3/4 to 1/5/10 (and
//      INV_BUTTON1 to a price CHECK that buys nothing). CoopWorld routes shop clicks through its
//      bank/trade amount mapping (button1/2/3/4 = 1/5/10/ALL) and then re-derives an op, so an
//      INV_BUTTON2 — which buys ONE unit live — buys TEN in that model. A pacing bug would pass offline
//      and strip the shelf live: precisely the pilot's failure, invisible to the test that should catch it.
//   2. NO PER-SLOT RESTOCK. World.ts:1216-1223 adds +1 per `stockrate` ticks PER SLOT and stops at that
//      slot's base count. CoopWorld models one (id, per, max) triple per shop. Zeke has four slots on four
//      different rates (100 / 200 / 600 / 4000), and the whole architecture turns on "the shelf caps at
//      base, so a buyer must return inside base*rate ticks".
//   3. NO PRICE LADDER. shop.rs2:131-147 + :183-192 raise the unit price as the shelf drains
//      (price_mod = stockNow - stockBase, scaled by the keeper's shop_delta). A `maxprice` guard cannot be
//      tested against a flat price.
//
// Rather than edit coop.ts (which other suites depend on byte-for-byte), this subclass
// intercepts shop clicks in `applyAction` and re-implements the buy loop line-by-line from shop.rs2,
// keeping its shelves INSIDE `CoopWorld.shops` so the harness's existing com-3900 transmit path (and the
// count-0-slot-is-not-nulled behaviour of Inventory.ts:180's `stockObj` guard) work unchanged.
//
// PORTED, WITH CITATIONS:
//   [label,buy_item]           shop.rs2:59-97    the per-unit loop, its three refusals and their messages
//   [proc,adjusted_item_cost_buying] shop.rs2:139-147   price of the next unit at a given shelf depth
//   [proc,price_mod]           shop.rs2:131-136  mod = stockNow - stockBase
//   [proc,calc_shop_value]     shop.rs2:183-192  min(1000, max(-5000, mod*delta)); max(100, sell-that); scale/1000
//   inv_button2/3/4 on 3900    shop.rs2:168-170  buy 1 / 5 / 10
//   inv_button1 on 3900        shop.rs2:52-56    price check only — buys NOTHING
//   restock                    World.ts:1216-1223  +1 per stockrate ticks per slot, capped at base,
//                                                  world-global and NOT scaled by player count
//   slot not nulled at 0       Inventory.ts:152-180 (`stockObj` guard) — a drained slot still restocks
//
// NOT modelled (and not needed here): selling to a shop (CoopWorld's own path is left alone), shop
// haggle drift over time, and `allstock` general stores.
// =====================================================================================================
import { CoopWorld, type CoopPlayer } from './coop.js';
import type { ClientAction } from './protocol.js';

const SHOP_MAIN = 3824, SHOP_INV = 3900, INV_INTERFACE = 3214;
const COINS = 995;

/** One shelf slot, exactly as an .inv `stockN=obj,base,rate` line declares it. */
export interface ShelfSlot {
    objId: number;
    /** the slot's CAP: restock stops here (World.ts:1218) */
    base: number;
    /** ticks per +1 unit */
    rate: number;
    /** unit cost from the obj config (`cost=`), before the keeper's multipliers */
    cost: number;
}

export interface KeeperPricing {
    /** npc `param=shop_sell_multiplier` — what the PLAYER pays through (shopkeeper.param default 100) */
    sellMultiplier: number;
    /** npc `param=shop_delta` (default 10) */
    delta: number;
}

interface Shelf extends ShelfSlot { count: number }

export class ShopSimWorld extends CoopWorld {
    /** keeper npc index -> its shelves, in .inv slot order (= com 3900 slot order) */
    shelves = new Map<number, { slots: Shelf[]; pricing: KeeperPricing }>();
    /** every buy the world actually performed: the ground truth a test asserts against */
    buys: Array<{ tick: number; player: string; objId: number; units: number; coins: number; shelfAfter: number }> = [];
    refusals: Array<{ tick: number; player: string; objId: number; why: 'stock' | 'coins' | 'space' }> = [];

    /**
     * Register a faithful shop. Shelves are stored in BOTH `shelves` (for the buy loop) and CoopWorld's
     * `shops` map (so the harness transmits com 3900 unchanged) — and the two are kept in sync on every
     * buy and every restock, never derived independently.
     */
    addFaithfulShop(keeperNpcIndex: number, slots: ShelfSlot[], pricing: KeeperPricing = { sellMultiplier: 1000, delta: 20 }): void {
        const shelf = slots.map(s => ({ ...s, count: s.base }));
        this.shelves.set(keeperNpcIndex, { slots: shelf, pricing });
        for (const s of slots) this.registerCost(s.objId, s.cost);
        // Insertion order defines com 3900's slot indices — keep it identical to the .inv's stockN order.
        this.addShop(keeperNpcIndex, shelf.map(s => ({ id: s.objId, count: s.count })), false);
    }

    /** the live count of a shelf slot — what a test asserts a `floor` guard against */
    shelfCount(keeperNpcIndex: number, objId: number): number {
        return this.shelves.get(keeperNpcIndex)?.slots.find(s => s.objId === objId)?.count ?? -1;
    }

    /** shop.rs2:183-192 `calc_shop_value` */
    private calcShopValue(baseCost: number, delta: number, mult: number, priceMod: number): number {
        let i5 = Math.min(1000, Math.max(-5000, priceMod * delta));
        i5 = Math.max(100, mult - i5);
        return Math.floor((i5 * baseCost) / 1000);
    }
    /** shop.rs2:131-147 — price of the next unit with `stockNow` units on the shelf */
    priceAt(keeperNpcIndex: number, objId: number, stockNow: number): number {
        const shop = this.shelves.get(keeperNpcIndex);
        const s = shop?.slots.find(x => x.objId === objId);
        if (!shop || !s) return 1;
        return Math.max(1, this.calcShopValue(s.cost, shop.pricing.delta, shop.pricing.sellMultiplier, stockNow - s.base));
    }

    private syncShopInv(keeperNpcIndex: number): void {
        const shop = this.shops.get(keeperNpcIndex);
        const shelf = this.shelves.get(keeperNpcIndex);
        if (!shop || !shelf) return;
        // Set, never delete: Inventory.remove's `stockObj` guard keeps a drained slot present at count 0
        // (Inventory.ts:176-180), which is exactly why a drained shelf keeps restocking.
        for (const s of shelf.slots) shop.stock.set(s.objId, s.count);
    }

    /**
     * World.ts:1216-1223 — per slot, `+1` when `count < base` and `tick % rate === 0`.
     * ⛔ NOT player-count-scaled: `World.scaleByPlayerCount` is never called on this path, so more
     * players do NOT make shops refill faster.
     */
    protected override restockShops(): void {
        for (const [keeper, shop] of this.shelves) {
            let changed = false;
            for (const s of shop.slots) {
                if (s.rate <= 0 || s.base <= 0) continue;         // base 0 or rate 0 => never restocks
                if (s.count < s.base && this.tick % s.rate === 0) { s.count++; changed = true; }
                else if (s.count > s.base && this.tick % s.rate === 0) { s.count--; changed = true; }
            }
            if (changed) {
                this.syncShopInv(keeper);
                for (const p of this.playersByIndex.values()) if (p.modal === SHOP_MAIN && p.openShop === keeper) p.outInvs.add(SHOP_INV);
            }
        }
        super.restockShops();     // any legacy CoopWorld shop registered with addShop(...restock)
    }

    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        // Only intercept BUY clicks on a faithful shop; everything else (bank, trade, movement, ops)
        // stays byte-identical to CoopWorld.
        if (a.type === 'invbutton' && a.com === SHOP_INV && p.modal === SHOP_MAIN && this.shelves.has(p.openShop)) {
            this.buyFaithful(p, a.op, a.obj);
            return;
        }
        super.applyAction(p, a);
    }

    /** [label,buy_item] shop.rs2:59-97, unit by unit, with the same three refusals in the same order. */
    private buyFaithful(p: CoopPlayer, button: number, objId: number): void {
        // shop.rs2:52-56 — inv_button1 on the shop inv is the PRICE CHECK. It buys nothing. A brain that
        // used op1 expecting a purchase would silently never buy; make that visible instead of free.
        const amount = button === 2 ? 1 : button === 3 ? 5 : button === 4 ? 10 : 0;
        if (amount === 0) {
            this.events.push({ tick: this.tick, kind: 'shop-price-check', detail: { player: p.name, obj: objId, button } });
            return;
        }
        const shop = this.shelves.get(p.openShop)!;
        const s = shop.slots.find(x => x.objId === objId);
        if (!s) { this.events.push({ tick: this.tick, kind: 'shop-not-stocked', detail: { player: p.name, obj: objId } }); return; }

        let bought = 0, spent = 0;
        for (let i = 0; i < amount; i++) {
            const price = Math.max(1, this.calcShopValue(s.cost, shop.pricing.delta, shop.pricing.sellMultiplier, s.count - s.base));
            if (this.invTotal(p.inv, COINS) < price) {                    // shop.rs2:69-75
                this.refusals.push({ tick: this.tick, player: p.name, objId, why: 'coins' });
                p.outPre.push({ kind: 'msg', text: "You don't have enough coins." });
                break;
            }
            if (s.count <= 0) {                                            // shop.rs2:76-82
                this.refusals.push({ tick: this.tick, player: p.name, objId, why: 'stock' });
                p.outPre.push({ kind: 'msg', text: 'The shop has run out of stock.' });
                break;
            }
            if (this.freeSlots(p.inv) <= 0 && !this.isStackable(objId)) {   // shop.rs2:85-91
                this.refusals.push({ tick: this.tick, player: p.name, objId, why: 'space' });
                p.outPre.push({ kind: 'msg', text: "You don't have enough inventory space." });
                break;
            }
            this.invRemove(p.inv, COINS, price);
            const added = this.invAdd(p.inv, objId, 1);
            if (added === 0) { this.invAdd(p.inv, COINS, price); break; }   // pack filled mid-loop
            s.count--;
            bought += added;
            spent += price;
        }
        if (bought > 0) {
            this.syncShopInv(p.openShop);
            this.buys.push({ tick: this.tick, player: p.name, objId, units: bought, coins: spent, shelfAfter: s.count });
            this.events.push({ tick: this.tick, kind: 'shop-buy', detail: { player: p.name, obj: objId, n: bought, coins: spent, shelfAfter: s.count, button } });
        }
        p.outInvs.add(INV_INTERFACE).add(SHOP_INV).add(3823);
    }

    /** total units of `objId` this world has sold to anyone — the over-buy ground truth */
    unitsSold(objId: number): number { return this.buys.filter(b => b.objId === objId).reduce((a, b) => a + b.units, 0); }
    /** total units sold to ONE player */
    unitsSoldTo(player: string, objId: number): number {
        return this.buys.filter(b => b.player === player && b.objId === objId).reduce((a, b) => a + b.units, 0);
    }
    /** the lowest the shelf has ever been — a `floor` guard's assertion */
    shelfLow(objId: number): number {
        const lows = this.buys.filter(b => b.objId === objId).map(b => b.shelfAfter);
        return lows.length ? Math.min(...lows) : -1;
    }
}

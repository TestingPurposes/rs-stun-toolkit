// cd server/webclient/headless/sim && bun test quest-supplies.test.ts
//
// PURE tests of the Death Plateau supplies planner (quest-supplies.ts nextSupplyAction / parseSupCfg / feathersFor):
// the next step from the observed pack, shopping amounts, the room/money gates, the resume ordering.
import { describe, test, expect } from 'bun:test';
import { nextSupplyAction, parseSupCfg, feathersFor, coinsNeeded, DEFAULT_SUP_CFG, SUP_SITES, FISH_SITES, CATCHES_PER_TROUT, type SupObs } from '../quest-supplies.js';

/** The quester as it arrives: iron bar + coins + 4 sharks, 22 free. */
const base = (o: Partial<SupObs> = {}): SupObs => ({ bread: 0, trout: 0, raw: 0, junk: 0, rod: 0, feathers: 0, coins: 4000, sharks: 4, free: 22, ...o });

describe('nextSupplyAction: the trip order', () => {
    test('fresh: tackle first (rod + featherBuy feathers)', () => {
        expect(nextSupplyAction(base())).toEqual({ kind: 'buy-tackle', rod: true, feathers: DEFAULT_SUP_CFG.featherBuy });
    });
    test('rod held, too few feathers for 10 trout -> top up feathers only', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 5, free: 21 }))).toEqual({ kind: 'buy-tackle', rod: false, feathers: DEFAULT_SUP_CFG.featherBuy - 5 });
    });
    test('tackled -> fish to 10 raw', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 60, free: 20 }))).toEqual({ kind: 'fish', target: 10 });
    });
    test('fishing resumed half way: target stays the absolute raw count', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 40, raw: 6, free: 14 }))).toEqual({ kind: 'fish', target: 10 });
    });
    test('feathers enough for the REMAINING catches is enough (no trip back to Port Sarim)', () => {
        // 2 raw short -> needs >= 1 + ceil(2 * 1.81) = 5 feathers to try
        expect(nextSupplyAction(base({ rod: 1, feathers: 6, raw: 8, free: 12 }))).toEqual({ kind: 'fish', target: 10 });
        expect(nextSupplyAction(base({ rod: 1, feathers: 2, raw: 8, free: 12 }))).toMatchObject({ kind: 'buy-tackle', rod: false });
    });
    test('raw covered -> bread next (default order), then cook', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 30, raw: 10, free: 10 }))).toEqual({ kind: 'buy-bread', target: 10 });
        expect(nextSupplyAction(base({ rod: 1, feathers: 30, raw: 10, bread: 10, free: 0 }))).toEqual({ kind: 'cook', n: 10 });
    });
    test('partially cooked: cook only what is still missing', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 30, raw: 4, trout: 7, bread: 10, free: 0 }))).toEqual({ kind: 'cook', n: 3 });
    });
    test('done when both held — extra raw / tackle are irrelevant', () => {
        expect(nextSupplyAction(base({ bread: 10, trout: 10 }))).toEqual({ kind: 'done' });
        expect(nextSupplyAction(base({ bread: 12, trout: 11, raw: 3, junk: 2 }))).toEqual({ kind: 'done' });
    });
    test('a trout already cooked reduces the fishing target; bread-only remaining skips the tackle trip', () => {
        expect(nextSupplyAction(base({ trout: 10, free: 18 }))).toEqual({ kind: 'buy-bread', target: 10 });
        expect(nextSupplyAction(base({ trout: 6, rod: 1, feathers: 60, free: 16 }))).toEqual({ kind: 'fish', target: 4 });
    });
    test('junk (raw salmon / burnt) is dropped before anything else', () => {
        expect(nextSupplyAction(base({ junk: 3, rod: 1, feathers: 30 }))).toEqual({ kind: 'drop-junk' });
    });
    test("order 'bread-first' (cfg) buys bread before fishing", () => {
        const cfg = parseSupCfg('order=tackle,bread,fish,cook');
        expect(nextSupplyAction(base({ rod: 1, feathers: 60, free: 20 }), cfg)).toEqual({ kind: 'buy-bread', target: 10 });
    });
});

describe('nextSupplyAction: room + money', () => {
    test('a pack that cannot hold the plan eats a shark (never drops it)', () => {
        // 10 raw + 2 tackle + 10 bread = 22 > 20 free
        expect(nextSupplyAction(base({ free: 20 }))).toMatchObject({ kind: 'eat-shark' });
    });
    test('fishing done + no room for the bread -> drop the tackle first, not a shark', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 20, raw: 10, free: 8 }))).toEqual({ kind: 'drop-tackle' });
    });
    test('mayEat=0 and no room -> need (no silent wedge)', () => {
        expect(nextSupplyAction(base({ free: 20 }), parseSupCfg('eat=0'))).toMatchObject({ kind: 'need' });
    });
    test('no sharks and no room -> need', () => {
        expect(nextSupplyAction(base({ free: 10, sharks: 0 }))).toMatchObject({ kind: 'need' });
    });
    test('reserveFree is honoured', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 30, raw: 10, free: 12 }), parseSupCfg('reserve=3'))).toEqual({ kind: 'drop-tackle' });
    });
    test('broke -> need coins; list-price affordable -> proceed even if the pessimistic estimate says no', () => {
        expect(nextSupplyAction(base({ coins: 50 }))).toMatchObject({ kind: 'need' });
        // list: 120 bread + 5 rod + 35*2 feathers = 195; pessimistic: 200 + 10 + 60*4 = 450
        expect(coinsNeeded(base(), DEFAULT_SUP_CFG)).toBe(450);
        expect(nextSupplyAction(base({ coins: 300 }))).toMatchObject({ kind: 'buy-tackle' });
    });
});

describe('nextSupplyAction: resume from where the account stands', () => {
    test('standing at the baker with bread still needed -> buy bread now even though fishing is "first"', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 60, free: 20, pos: { x: 2668, z: 3312 } }))).toEqual({ kind: 'buy-bread', target: 10 });
    });
    test('standing at the fire with raw covering the need -> cook', () => {
        expect(nextSupplyAction(base({ raw: 10, free: 2, bread: 10, pos: SUP_SITES.FIRE_BURTHORPE.at }))).toEqual({ kind: 'cook', n: 10 });
    });
    test('standing at the fire WITHOUT enough raw does not cook early (it would strand the remainder)', () => {
        expect(nextSupplyAction(base({ raw: 4, rod: 1, feathers: 40, bread: 10, free: 8, pos: SUP_SITES.FIRE_BURTHORPE.at }))).toEqual({ kind: 'fish', target: 10 });
    });
    test('at the fishing site -> fish', () => {
        expect(nextSupplyAction(base({ rod: 1, feathers: 60, bread: 10, free: 10, pos: FISH_SITES.seers!.travel }))).toEqual({ kind: 'fish', target: 10 });
    });
});

describe('helpers', () => {
    test('feathersFor covers ~3x the mean catches', () => {
        expect(feathersFor(0)).toBe(0);
        expect(feathersFor(10)).toBe(35);
        expect(feathersFor(10)).toBeGreaterThan(10 * CATCHES_PER_TROUT * 1.5);
    });
    test('parseSupCfg', () => {
        const c = parseSupCfg('bread=12;trout=11;feathers=80;eat=0;reserve=2;fish=barb;order=fish,cook,bread,tackle;bogus=1');
        expect(c).toMatchObject({ bread: 12, trout: 11, featherBuy: 80, mayEat: false, reserveFree: 2, fish: 'barb', order: ['fish', 'cook', 'bread', 'tackle'] });
        expect(parseSupCfg('fish=nowhere').fish).toBe(DEFAULT_SUP_CFG.fish);
        expect(parseSupCfg(undefined)).toEqual(DEFAULT_SUP_CFG);
    });
});

// COOKING < 15: fisher leftovers are junk; raw shrimp/anchovy are kept until Cooking 15 (they train it).
test('junkIds: net + cooked/burnt shrimp always junk, raw shrimp/anchovy only once Cooking >= 15', async () => {
    const { junkIds, LOWCOOK_RAW } = await import('../quest-supplies.ts');
    const low = junkIds(1), high = junkIds(15);
    for (const id of [303, 315, 319, 323]) { expect(low).toContain(id); expect(high).toContain(id); }
    for (const id of LOWCOOK_RAW) { expect(low).not.toContain(id); expect(high).toContain(id); }
});

// =====================================================================================================
// CARRIED-RISK MODEL — "what does it cost if THIS bot dies right now?"
// =====================================================================================================
// Pure, offline, allocation-light. Reads `item-values.ts` (generated from the runtime obj table) and
// nothing else; it never connects and never looks at a bot.
//
// ⛔ WHY IT EXISTS. `COLLECT_ACCT_N` died in transit holding 20.4M and nothing in the stack could have said
// so beforehand. "Bank before you travel" has been a CONVENTION in this repo for weeks — a rule you
// have to remember, which is the same category of non-fix as "remember to restart the dashboard".
// This makes the exposure a NUMBER a supervisor can gate on.
//
// -----------------------------------------------------------------------------------------------------
// THE CONTRACT (player/scripts/death.rs2 — verified, not assumed)
// -----------------------------------------------------------------------------------------------------
//   PvE  [proc,death_lose_items]:      `inv_dropall(inv)` + `inv_dropall(worn)`. NOTHING IS KEPT.
//                                      Exposure is the WHOLE backpack AND the WHOLE worn set.
//   PvP  [proc,pvp_death_lose_items]:  ~move_priciest_item_on_hero_to_death x3 (x0 if SKULLED, +1 with
//                                      Protect Item), ranked by `oc_cost` — so `cost` is literally the
//                                      keep-order key, and this module ranks by exactly that field.
//   Either: an obj with `destroy_drop`/`destroy_death` is `inv_delslot`'d — DESTROYED, never reaching
//           the ground pile. It is unrecoverable rather than merely at risk, so it is scored SEPARATELY.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ THREE VALUATION TRAPS, EACH OF WHICH WOULD PRODUCE A CONFIDENT WRONG NUMBER
// -----------------------------------------------------------------------------------------------------
// 1. `cost === 1` IS "UNPRICED", NOT "WORTHLESS". 1329 of 3894 objs sit at the default. Coins and a
//    blue partyhat are both 1. Summing them as 1gp each renders a bank-run bot's exposure as ~30gp and
//    would green-light exactly the trip that lost 20.4M. So cost-1 items are counted in a SEPARATE
//    `unpriced` channel and never folded into the priced total.
// 2. COINS ARE THE ONE EXCEPTION AND THEY MUST BE. A coin's value IS its count. They are scored at
//    FACE VALUE in their own field, so `unpriced` stays a genuine "I do not know" list rather than being poisoned by the one cost-1
//    obj whose value is certain.
// 3. DUMMY OBJS ARE NOT WEALTH. `coins_2..coins_10000` are interface graphics (dummyitem != 0) that can
//    never be held. A decoder that forgot the wire's +1 offset reads coins (995) as coins_2 (996) — so
//    a valuer that priced dummies would silently value a bot's coins as artwork. They
//    are dropped before valuation and counted, so the count is visible if it is ever non-zero.
import { itemValue, COINS_OBJ, type ItemValue } from './item-values.js';

/** One held stack. `count` is 1 for a non-stackable slot. */
export interface HeldStack {
    id: number;
    count: number;
}

/** A single item's contribution, kept so a caller can name WHAT the risk is instead of just its size. */
export interface RiskItem {
    id: number;
    name: string;
    count: number;
    /** `cost * count`, or 0 when unpriced. Coins carry their face value here. */
    value: number;
    /** unit `oc_cost` — the PvP keep-order key. */
    cost: number;
    worn: boolean;
}

export interface CarriedRisk {
    // ---- PvE: the number that matters for travel ------------------------------------------------
    /**
     * ⭐ WHAT A PvE DEATH COSTS: coins at face value + every PRICED item's `cost * count`, across the
     * backpack AND the worn set. Excludes destroyOnDeath (scored below), dummies (not real) and
     * unpriced items (unknowable — see `unpricedCount`).
     */
    pveLoss: number;
    coins: number;
    /** priced non-coin items only. `pveLoss - coins`. */
    itemValue: number;
    // ---- PvP ------------------------------------------------------------------------------------
    /** what a PvP death costs given `keep` items are kept, ranked by `cost` exactly as the engine does. */
    pvpLoss: number;
    /** the items the engine would keep, most expensive first. */
    pvpKept: RiskItem[];
    // ---- the things that are NOT simply "lost" ---------------------------------------------------
    /** value of destroyOnDeath items: DELETED on death, never droppable, never recoverable. */
    destroyedValue: number;
    destroyed: RiskItem[];
    /**
     * ⛔ ITEMS WHOSE VALUE IS UNKNOWN (`cost === 1`, excluding coins). NOT zero. A non-empty list means
     * `pveLoss` is a LOWER BOUND, and any gate reading it must say so.
     */
    unpricedCount: number;
    unpriced: RiskItem[];
    /** interface-only objs seen and skipped. Non-zero means a decoder somewhere lost the wire offset. */
    dummyCount: number;
    /** obj ids not in the table at all (should be 0; non-zero = a table/regen mismatch). */
    unknownIds: number[];
    /** every priced contribution, descending — "what am I actually carrying?" */
    items: RiskItem[];
    /** slots inspected (backpack + worn). */
    slots: number;
    /** true when `unpricedCount > 0`: the total is a floor, not an answer. */
    isLowerBound: boolean;
    /** one greppable line. Never empty. */
    note: string;
}

export interface RiskOptions {
    /** items a PvP death keeps. 3 normally, 0 SKULLED, 4 with Protect Item (death.rs2). Default 3. */
    keep?: number;
}

const EMPTY: RiskItem[] = [];

function push(out: RiskItem[], v: ItemValue, count: number, worn: boolean, value: number): RiskItem {
    const r: RiskItem = { id: v.id, name: v.name ?? v.debugname, count, value, cost: v.cost, worn };
    out.push(r);
    return r;
}

/**
 * Value what a bot is carrying against the death contract.
 *
 * `backpack` and `worn` are both fully exposed to a PvE death — the split is kept only so a caller can
 * say WHERE the risk sits (a bot can bank its pack but not its gear).
 */
export function carriedRisk(
    backpack: readonly HeldStack[],
    worn: readonly HeldStack[] = EMPTY as unknown as HeldStack[],
    opts: RiskOptions = {},
): CarriedRisk {
    const keep = opts.keep ?? 3;
    const items: RiskItem[] = [];
    const destroyed: RiskItem[] = [];
    const unpriced: RiskItem[] = [];
    const unknownIds: number[] = [];
    let coins = 0, itemValueSum = 0, destroyedValue = 0, dummyCount = 0, slots = 0;

    const scan = (stacks: readonly HeldStack[], isWorn: boolean) => {
        for (const s of stacks) {
            if (!s || s.id <= 0 || s.count <= 0) continue;      // an empty slot is not a holding
            slots++;
            const v = itemValue(s.id);
            if (!v) { unknownIds.push(s.id); continue; }
            // Trap 3: an interface-only obj can never be held. Counting one is evidence of a decode bug
            // upstream, so it is tallied rather than silently dropped.
            if (v.dummy) { dummyCount++; continue; }

            // Trap 2: coins are the one cost-1 obj whose value is certain.
            if (v.id === COINS_OBJ) {
                coins += s.count;
                push(items, v, s.count, isWorn, s.count);
                continue;
            }
            // DESTROYED, not dropped. Scored apart because the recovery story is completely different:
            // a dropped stack sits on the floor for ^lootdrop_duration and can be walked back to.
            if (v.destroyOnDeath) {
                const val = v.cost > 1 ? v.cost * s.count : 0;
                destroyedValue += val;
                push(destroyed, v, s.count, isWorn, val);
                continue;
            }
            // Trap 1: the default cost is "unpriced". It is NOT a value.
            if (v.cost <= 1) { push(unpriced, v, s.count, isWorn, 0); continue; }

            const val = v.cost * s.count;
            itemValueSum += val;
            push(items, v, s.count, isWorn, val);
        }
    };
    scan(backpack, false);
    scan(worn, true);

    items.sort((a, b) => b.value - a.value);

    // PvP: the engine ranks by `oc_cost` (unit cost), not by stack value — ~move_priciest_item_on_hero
    // moves ONE obj at a time. So the keep set is the `keep` most expensive UNITS. Coins are cost 1 and
    // are therefore never kept, which is the observed in-game behaviour.
    const pvpCandidates = [...items, ...unpriced].sort((a, b) => b.cost - a.cost || b.value - a.value);
    const pvpKept = keep > 0 ? pvpCandidates.slice(0, keep) : [];
    const keptValue = pvpKept.reduce((a, r) => a + r.value, 0);
    const pveLoss = coins + itemValueSum;

    const isLowerBound = unpriced.length > 0;
    const note =
        `carried-risk pve=${pveLoss}gp (coins=${coins} items=${itemValueSum}) pvp=${Math.max(0, pveLoss - keptValue)}gp ` +
        `destroyed=${destroyedValue}gp slots=${slots}` +
        (isLowerBound ? ` ⛔ LOWER BOUND: ${unpriced.length} unpriced item(s) (cost=1): ${unpriced.slice(0, 4).map(u => u.name).join(', ')}` : '') +
        (dummyCount ? ` ⛔ ${dummyCount} DUMMY obj(s) held — a wire-offset decode bug upstream` : '') +
        (unknownIds.length ? ` ⛔ ${unknownIds.length} obj id(s) not in the table` : '');

    return {
        pveLoss, coins, itemValue: itemValueSum,
        pvpLoss: Math.max(0, pveLoss - keptValue), pvpKept,
        destroyedValue, destroyed,
        unpricedCount: unpriced.length, unpriced,
        dummyCount, unknownIds,
        items, slots, isLowerBound, note,
    };
}

/**
 * The cheap half — just the PvE number, for a per-cycle reporter that does not want the item lists.
 * One pass, no arrays allocated, no sorting. ~0.2us for a full 28-slot pack + 11 worn slots.
 */
export function pveExposure(backpack: readonly HeldStack[], worn: readonly HeldStack[] = EMPTY as unknown as HeldStack[]): number {
    let total = 0;
    for (let k = 0; k < 2; k++) {
        const stacks = k === 0 ? backpack : worn;
        for (let i = 0; i < stacks.length; i++) {
            const s = stacks[i]!;
            if (!s || s.id <= 0 || s.count <= 0) continue;
            const v = itemValue(s.id);
            if (!v || v.dummy || v.destroyOnDeath) continue;
            if (v.id === COINS_OBJ) { total += s.count; continue; }
            if (v.cost <= 1) continue;                   // unpriced — never guessed at
            total += v.cost * s.count;
        }
    }
    return total;
}

/**
 * THE DISCIPLINE, AS A FUNCTION. "Should this bot bank before it travels?"
 *
 * Deliberately a threshold and not a policy: how much a bot may risk per trip is the caller's
 * choice, and burying it in a brain is how it stops being reviewable. `RISK_BANK_BEFORE_TRAVEL` is the
 * one lever; the default is deliberately low, because the failure mode is asymmetric — banking costs a
 * few seconds, a death in transit cost 20.4M.
 */
export const BANK_BEFORE_TRAVEL_GP = Number(process.env.RISK_BANK_BEFORE_TRAVEL ?? 50_000);

export function shouldBankBeforeTravel(exposureGp: number, threshold = BANK_BEFORE_TRAVEL_GP): boolean {
    return exposureGp >= threshold;
}

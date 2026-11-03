// DEATH PLATEAU SUPPLIES DRIVER — gets one account to >= 10 BREAD (2309) + >= 10 COOKED TROUT (333) in its backpack, the
// supplies Tenzing asks for (death_sherpa.rs2; quest-death.ts nextAction 'need' at map stage given_cert). Built the same
// way as quest-death.ts: a LeanBot subclass with small tick-driven TASKS (shop / fish / cook / drop / eat), an async
// DRIVER that travels with startMultiTravel and runs one task at a time, and a PURE next-action function. Resumable
// purely from the pack (no store): every decision is re-derived from the counts + the tile on every loop.
//
// THE TRIP (offline-routed with rsmod findLongPath / planMultiLevel; corner-sum lengths in tiles):
//   Dwarven Mine (3015,9825) -> Gerrant 274 (stairs (3058,9778) -> Falador (3062,3376));  Burthorpe -> Gerrant 345
//   Gerrant -> Seers' spot (2716,3531) 591;  Seers -> Baker 252;  Baker -> Burthorpe fire stand (2893,3531) 538
//   (bread-first is the same total: Gerrant -> Baker 647, Baker -> Seers 259, Seers -> fire 475)
//   Barbarian Village instead of Seers: Gerrant -> Barb 234 but Barb -> Baker 650 (worse overall). The lure spots
//   0_44_52 (318, ~2845,3358) do NOT route from Port Sarim/Burthorpe (end short at (2884,3353)) — not used.
//   1. Gerrant's Fishy Business, Port Sarim — fly fishing rod + feathers (the only rod shop open to a non-Fremennik)
//   2. a river LURE spot ("freshfish" category) — fly-fish raw trout; at Fishing >= 30 every cast rolls SALMON first
//      (fishing.rs2 ~fish_roll), so ~45% of the catches are raw salmon: dropped on the spot.
//   3. Ardougne baker's stall — 10 bread (a real shop: [opnpc3,baker_merchant] -> ~openshop_activenpc)
//   4. the camp fire in Burthorpe's Imperial Guard camp — cook the trout (Cooking 99 never burns trout: see COOK note)
//
// CONTENT SOURCE OF TRUTH (server/content/...). NONE of this has had a live smoke.
import { QuestRunnerBot } from './quest-runner.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// =====================================================================================================================
// IDS — server/content/pack/{obj,npc,loc}.pack ("<id>=<name>")
// =====================================================================================================================
export const SUP_OBJ = {
    BREAD: 2309,          // obj.pack:2310 2309=bread
    TROUT: 333,           // obj.pack:334  333=trout
    RAW_TROUT: 335,       // obj.pack:336  335=raw_trout
    RAW_SALMON: 331,      // obj.pack:332  331=raw_salmon (the 2nd lure catch at Fishing >= 30)
    SALMON: 329,          // obj.pack:330  329=salmon
    BURNT_FISH: 343,      // obj.pack:344  343=burntfish2 (trout's burnt product, cooking_generic.dbrow:260)
    FLY_ROD: 309,         // obj.pack:310  309=fly_fishing_rod
    FEATHER: 314,         // obj.pack:315  314=feather (stackable bait)
    COINS: 995,
    IRON_BAR: 2351,       // carried for Dunstan — NEVER touched
    SHARK: 385,           // carried food — eaten only to make room (opts.mayEat), never dropped/banked
} as const;
export const SUP_NPC = {
    GERRANT: 558,         // npc.pack:559 558=gerrant — port_sarim.npc:253-286 op3=Trade, owned_shop=fishingshop
    BAKER: 571,           // npc.pack:572 571=baker_merchant — ardougne_east.npc:394-426 op3=Trade, owned_shop=bakery
    SPOT_SEERS: 315,      // npc.pack:316 315=0_42_55_freshfish (op1=Lure, fishing.npc:186-202)
    SPOT_TAVERLEY_S: 318, // npc.pack:319 318=0_44_52_freshfish
    SPOT_BARB: 328,       // npc.pack:329 328=0_48_53_freshfish (Barbarian Village)
    SPOT_LUMB: 329,       // npc.pack:330 329=0_50_50_freshfish (Lumbridge river)
} as const;
export const SUP_LOC = {
    FIRE: 2732,           // loc.pack 2732 "Fire" category=cooking_fire (cooking_sources.loc:59-68)
} as const;
/** Every freshfish spot type: [opnpc1,_freshfish] = Lure (fly rod + feather) (freshfish.rs2:1-3). */
export const FRESHFISH_SPOTS: ReadonlySet<number> = new Set([309, 310, 311, 314, 315, 317, 318, 328, 329, 331, 927, 1189, 1190]);

// =====================================================================================================================
// SHOPS — the .inv rows (stock, restock) and what we buy
//   [fishingshop] port_sarim.inv:77-99: stock3=fly_fishing_rod,5,100  stock7=feather,1000,1
//   [bakery]      ardougne_east.inv:15-28: stock1=bread,10,100 (scope=shared: other players drain it; it refills)
// Shop modal = shop_template 3824, stock inv 3900, side inv 3823 (LeanBot SHOP.*); buy buttons are 1/5/10 only.
// =====================================================================================================================
/** Pessimistic unit prices (obj cost: rod 5 (fishing.obj:69), feather 2, bread 12 (wiki) + shop_delta headroom). */
export const SUP_PRICE = { [SUP_OBJ.FLY_ROD]: 10, [SUP_OBJ.FEATHER]: 4, [SUP_OBJ.BREAD]: 20 } as Readonly<Record<number, number>>;

// =====================================================================================================================
// WHERE — map placements (server/content/maps/mX_Z.jm2, coord = mapX*64+lx, mapZ*64+lz), all level 0
// =====================================================================================================================
export interface Tile { x: number; z: number }
// near = 6: doTravel declares ARRIVED within 6 tiles (leanbot.ts mlDrive landing), so a tighter `near` would re-kick
// travel forever; each task walks the last tiles itself (stepToNpc / walkToExact).
export interface Site { label: string; level: number; at: Tile; near: number }
export const SUP_SITES = {
    // m47_50.jm2 NPC "0 5 25: 558" -> (3013,3225); moverestrict=indoors (he stays in his shop)
    GERRANT: { label: "Gerrant's Fishy Business (Port Sarim)", level: 0, at: { x: 3013, z: 3225 }, near: 6 },
    // m41_51.jm2 NPC "0 45 46: 571" -> (2669,3310) (the EAST stall; a 2nd Baker "0 30 47" stands at (2654,3311)).
    // Both run the SAME shared [bakery] inv. wanderrange=2.
    BAKER: { label: "Ardougne baker's stall", level: 0, at: { x: 2669, z: 3310 }, near: 6 },
    // m45_55.jm2 LOC "0 13 12: 2732 10" -> (2893,3532): a MAP-PLACED fire (never expires — only player-lit 2732s
    // despawn, cookbot.ts header) in the Imperial Guard camp, 4 tiles from Denulth (2896,3528).
    FIRE_BURTHORPE: { label: 'Burthorpe camp fire', level: 0, at: { x: 2893, z: 3532 }, near: 6 },
    BURTHORPE: { label: 'Burthorpe (Denulth)', level: 0, at: { x: 2896, z: 3528 }, near: 6 },
} as const satisfies Record<string, Site>;

/** A lure-spot cluster: the spot npc type, where its placements / movement coords are, and a land tile to travel to. */
export interface FishSite { label: string; spot: number; level: number; travel: Tile; coords: readonly Tile[] }
export const FISH_SITES: Readonly<Record<string, FishSite>> = {
    // m42_55.jm2 NPC "0 26 12/0 26 13/0 28 10/0 30 9: 315"; fishing_movement.enum [fishing_movement_seers_village_enum]
    // = 0_42_55_{40_4,39_4,38_4,30_9,28_10,26_12,26_13} -> the river north of Seers' Village.
    seers: {
        label: "Seers' river (lure)", spot: SUP_NPC.SPOT_SEERS, level: 0, travel: { x: 2716, z: 3531 },
        coords: [{ x: 2728, z: 3524 }, { x: 2727, z: 3524 }, { x: 2726, z: 3524 }, { x: 2718, z: 3529 }, { x: 2716, z: 3530 }, { x: 2714, z: 3532 }, { x: 2714, z: 3533 }],
    },
    // m48_53.jm2 NPC "0 32 32/0 38 42: 328" -> (3104,3424),(3110,3434) Barbarian Village
    barb: { label: 'Barbarian Village river (lure)', spot: SUP_NPC.SPOT_BARB, level: 0, travel: { x: 3104, z: 3425 }, coords: [{ x: 3104, z: 3424 }, { x: 3110, z: 3434 }] },
};

// =====================================================================================================================
// COOKING — cooking.rs2 [oplocu,_cooking_fire] -> @attempt_cook_item -> @cook_item: ONE item per use (no make-X in this
// era), p_delay(1). Trout: cooking_generic.dbrow:256-264 levelrequired 15, successchance 88,432. STAT_RANDOM
// (engine PlayerOps.ts:582-590): value = floor(88*(99-L)/98) + floor(432*(L-1)/98) + 1 = 433 at L99 > any roll of
// 0..255 -> Cooking 99 NEVER burns a trout. FISHING (freshfish.rs2:57-88 + fishing.rs2 ~fish_roll): at Fishing >= 30 a
// cast rolls salmon first (16,96 -> 97/256 at L99), then trout (32,192 -> 193/256): per cast P(salmon)=.379,
// P(trout)=.468, P(nothing)=.153 -> one feather per catch, ~1.8 catches per trout.
// =====================================================================================================================
export const CATCHES_PER_TROUT = (0.379 + 0.468) / 0.468;   // ~1.81

// =====================================================================================================================
// THE PLAN — pure
// =====================================================================================================================
export interface SupObs {
    bread: number; trout: number; raw: number;   // bread, cooked trout, raw trout
    junk: number;                                // raw salmon + burnt fish (dropped)
    rod: number; feathers: number; coins: number; sharks: number;
    free: number;                                // free backpack slots
    pos?: Tile;                                  // for the opportunistic "already here" ordering
}
export type SupStep = 'tackle' | 'fish' | 'bread' | 'cook';
export interface SupCfg {
    bread: number; trout: number;
    featherBuy: number;          // feathers to hold after a tackle trip
    order: readonly SupStep[];   // the geographic order of the trip (first needed step wins)
    mayEat: boolean;             // may eat sharks to make room (never drop/bank them)
    reserveFree: number;         // slots to leave free at the end (quest items)
    fish: string;                // FISH_SITES key
}
export const DEFAULT_SUP_CFG: SupCfg = { bread: 10, trout: 10, featherBuy: 60, order: ['tackle', 'fish', 'bread', 'cook'], mayEat: true, reserveFree: 0, fish: 'seers' };

export type SupAction =
    | { kind: 'done' }
    | { kind: 'drop-junk' }
    | { kind: 'drop-tackle' }
    | { kind: 'eat-shark'; why: string }
    | { kind: 'buy-tackle'; rod: boolean; feathers: number }
    | { kind: 'fish'; target: number }         // raw-trout count to reach
    | { kind: 'buy-bread'; target: number }    // bread count to reach
    | { kind: 'cook'; n: number }
    | { kind: 'need'; what: string };

/** Feathers needed to be reasonably sure of `raw` more trout (3x the mean catches + 5; P(short) < 1%). */
export function feathersFor(raw: number): number { return raw <= 0 ? 0 : Math.ceil(raw * 3) + 5; }

/** Coins the rest of the plan needs (pessimistic prices). */
export function coinsNeeded(o: SupObs, cfg: SupCfg): number {
    const troutNeed = Math.max(0, cfg.trout - o.trout);
    const rawShort = Math.max(0, troutNeed - o.raw);
    let c = Math.max(0, cfg.bread - o.bread) * SUP_PRICE[SUP_OBJ.BREAD]!;
    if (rawShort > 0) {
        if (o.rod <= 0) c += SUP_PRICE[SUP_OBJ.FLY_ROD]!;
        if (o.feathers < feathersFor(rawShort)) c += Math.max(0, Math.max(cfg.featherBuy, feathersFor(rawShort)) - o.feathers) * SUP_PRICE[SUP_OBJ.FEATHER]!;
    }
    return c;
}

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export function nextSupplyAction(o: SupObs, cfg: SupCfg = DEFAULT_SUP_CFG): SupAction {
    const troutNeed = Math.max(0, cfg.trout - o.trout);
    const breadNeed = Math.max(0, cfg.bread - o.bread);
    if (troutNeed === 0 && breadNeed === 0) return { kind: 'done' };
    if (o.junk > 0) return { kind: 'drop-junk' };
    const rawShort = Math.max(0, troutNeed - o.raw);

    // ---- room: everything still to come must fit. No salmon buffer: fishTick drops salmon at free <= 1, so the
    //      last trout can take the last slot. ----
    const tackleBuySlots = rawShort > 0 ? (o.rod > 0 ? 0 : 1) + (o.feathers > 0 ? 0 : 1) : 0;
    const need = rawShort + tackleBuySlots + breadNeed + cfg.reserveFree;
    if (o.free < need) {
        const tackleHeld = (o.rod > 0 ? 1 : 0) + (o.feathers > 0 ? 1 : 0);
        if (rawShort === 0 && tackleHeld > 0) return { kind: 'drop-tackle' };
        if (cfg.mayEat && o.sharks > 0) return { kind: 'eat-shark', why: `${o.free} free, the rest of the plan needs ${need}` };
        return { kind: 'need', what: `${need} free slots (have ${o.free}; nothing droppable)` };
    }
    // ---- money ----
    const cost = coinsNeeded(o, cfg);
    if (o.coins < cost) {
        // the pessimistic estimate can overshoot: refuse only if even list prices cannot pay
        const floor = breadNeed * 12 + (rawShort > 0 ? (o.rod > 0 ? 0 : 5) + Math.max(0, feathersFor(rawShort) - o.feathers) * 2 : 0);
        if (o.coins < floor) return { kind: 'need', what: `${floor}+ coins (have ${o.coins})` };
    }

    const tackleShort = rawShort > 0 && (o.rod <= 0 || o.feathers < Math.min(feathersFor(rawShort), 1 + Math.ceil(rawShort * CATCHES_PER_TROUT)));
    const wants: Record<SupStep, SupAction | null> = {
        tackle: tackleShort ? { kind: 'buy-tackle', rod: o.rod <= 0, feathers: Math.max(0, Math.max(cfg.featherBuy, feathersFor(rawShort)) - o.feathers) } : null,
        fish: rawShort > 0 && !tackleShort ? { kind: 'fish', target: o.raw + rawShort } : null,
        bread: breadNeed > 0 ? { kind: 'buy-bread', target: cfg.bread } : null,
        cook: troutNeed > 0 && o.raw > 0 && rawShort === 0 ? { kind: 'cook', n: Math.min(o.raw, troutNeed) } : null,
    };
    // OPPORTUNISTIC: a needed step whose site we are already standing at goes first (a resume mid-trip)
    if (o.pos) {
        const fish = FISH_SITES[cfg.fish];
        const here: Array<[SupStep, Tile]> = [['bread', SUP_SITES.BAKER.at], ['cook', SUP_SITES.FIRE_BURTHORPE.at], ['tackle', SUP_SITES.GERRANT.at]];
        if (fish) here.push(['fish', fish.travel]);
        for (const [s, t] of here) if (wants[s] && cheb(o.pos, t) <= 25) return wants[s]!;
    }
    for (const s of cfg.order) if (wants[s]) return wants[s]!;
    // cook before raw is complete is never chosen above; if raw covers the need but the order omitted cook:
    if (wants.cook) return wants.cook;
    return { kind: 'need', what: `no step in order [${cfg.order.join(',')}] covers trout ${o.trout}/${cfg.trout} bread ${o.bread}/${cfg.bread}` };
}

/** Parse 'k=v;k=v' config (DS_CFG_<acct>): bread, trout, feathers, order=tackle,fish,bread,cook, eat=0|1, reserve, fish. */
export function parseSupCfg(s: string | undefined, base: SupCfg = DEFAULT_SUP_CFG): SupCfg {
    const c: SupCfg = { ...base, order: [...base.order] };
    for (const kv of (s ?? '').split(';')) {
        const [k, v] = kv.split('=').map(x => x?.trim());
        if (!k || v === undefined) continue;
        if (k === 'bread') c.bread = Number(v) || c.bread;
        else if (k === 'trout') c.trout = Number(v) || c.trout;
        else if (k === 'feathers') c.featherBuy = Number(v) || c.featherBuy;
        else if (k === 'eat') c.mayEat = v !== '0';
        else if (k === 'reserve') c.reserveFree = Number(v) || 0;
        else if (k === 'fish' && FISH_SITES[v]) c.fish = v;
        else if (k === 'order') { const o = v.split(',').filter(x => ['tackle', 'fish', 'bread', 'cook'].includes(x)) as SupStep[]; if (o.length) c.order = o; }
    }
    return c;
}

// =====================================================================================================================
// THE BOT — tick-driven tasks
// =====================================================================================================================
const JUNK: ReadonlySet<number> = new Set([SUP_OBJ.RAW_SALMON, SUP_OBJ.BURNT_FISH]);
// COOKING < 15: trout needs Cooking 15 (cooking_generic.dbrow levelrequired 15); three RC-99 law accounts at
// Cooking 1 failed 'cook 10 trout' 8x. Raw shrimp/anchovy cook at level 1 and one cook is many levels on this realm, so
// cookTick cooks those FIRST while Cooking < 15 (the law chain's 'cookprep' step nets a few). Fisher leftovers (net, cooked
// or burnt shrimp/anchovy — and the raw ones once Cooking >= 15) are junk: they ate the free slots ("need 22 free").
export const LOWCOOK_RAW = [317, 321] as const;          // raw shrimps, raw anchovies (cook at level 1)
const FISHER_LEFTOVERS = [303, 311, 315, 319, 323, 359, 371] as const;  // small net, harpoon, shrimps, anchovies, burnt fish, raw tuna, raw swordfish
export const TROUT_COOK_LEVEL = 15;
const STAT_COOKING = 7;                                   // attack defence strength hitpoints ranged prayer magic COOKING
export function junkIds(cookLvl: number): number[] {
    return [...JUNK, ...FISHER_LEFTOVERS, ...(cookLvl >= TROUT_COOK_LEVEL ? LOWCOOK_RAW : [])];
}
const SHOP_MAIN = 3824;

export interface ShopBuy { obj: number; target: number }   // buy until countOf(obj) >= target
type TaskKind = 'shop' | 'fish' | 'cook' | 'drop' | 'eat';
export interface SupTask {
    kind: TaskKind; label: string;
    npcType?: number;          // shop keeper / fishing spot type
    buys?: ShopBuy[];          // shop
    target?: number;           // fish: raw count; cook: cooked count
    loc?: { x: number; z: number; id: number }; stand?: Tile;   // cook
    objs?: number[];           // drop: obj ids to drop
    budget: number;            // ticks
    // runtime
    startTick: number; lastOp: number; tries: number;
    result: 'run' | 'ok' | 'fail'; why?: string;
}

export class DpKitBot extends QuestRunnerBot {
    task: SupTask | null = null;
    log: (s: string) => void = s => console.log(s);
    /** last tick a raw fish (trout or salmon) landed — the fishing idle detector */
    lastCatchTick = -100;
    private lastKick = -100;
    private prevFish = -1;
    private standCache = new Map<string, Tile | null>();
    private orthoSince = -1;
    private shopWait = -1;

    constructor() { super(); this.steps = []; this.done = true; this.foodObj = SUP_OBJ.SHARK; }

    cookLvl(): number { return (this as any).statLevel?.[STAT_COOKING] ?? 1; }
    obs(): SupObs {
        return {
            bread: this.countOf(SUP_OBJ.BREAD), trout: this.countOf(SUP_OBJ.TROUT), raw: this.countOf(SUP_OBJ.RAW_TROUT),
            junk: junkIds(this.cookLvl()).reduce((n, id) => n + this.countOf(id), 0),
            rod: this.countOf(SUP_OBJ.FLY_ROD), feathers: this.countOf(SUP_OBJ.FEATHER), coins: this.countOf(SUP_OBJ.COINS),
            sharks: this.countOf(SUP_OBJ.SHARK), free: this.freePackSlots(), pos: this.tile(),
        };
    }

    startTask(t: Omit<SupTask, 'startTick' | 'lastOp' | 'tries' | 'result'>): SupTask {
        this.task = { ...t, startTick: this.tickCount, lastOp: -100, tries: 0, result: 'run' };
        this.prevFish = -1; this.orthoSince = -1; this.shopWait = -1; this.lastKick = -100; this.lastCatchTick = -100;
        return this.task;
    }
    private finish(t: SupTask, ok: boolean, why: string): void {
        if (t.result !== 'run') return;
        t.result = ok ? 'ok' : 'fail'; t.why = why;
        this.log(`[sup] ${this.loginUser}: task '${t.label}' ${ok ? 'ok' : 'FAILED'} — ${why}`);
    }

    // ---- the SHOP modal: buy the list, then close it ----------------------------------------------------------------
    protected override handleMainModal(): boolean {
        const t = this.task;
        if (this.mainModalId === SHOP_MAIN && t && t.kind === 'shop' && t.result === 'run') {
            const next = t.buys!.find(b => this.countOf(b.obj) < b.target);
            if (!next) { this.sendCloseModalPublic(); this.finish(t, true, 'everything bought'); return true; }
            if (this.freePackSlots() <= 0 && !this.isStackableHeld(next.obj)) { this.sendCloseModalPublic(); this.finish(t, false, 'pack full in the shop'); return true; }
            if (this.shopStockOf(next.obj) <= 0) {
                // shared stock drained by someone else: it restocks (+1 per 100 ticks for bread, ardougne_east.inv:24) —
                // wait with the modal open (UPDATE_INV streams the restock), bounded by the task budget
                if (this.shopWait < 0) { this.shopWait = this.tickCount; this.log(`[sup] ${this.loginUser}: shop out of ${next.obj} — waiting for the restock`); }
                if (this.tickCount - t.startTick > t.budget) { this.sendCloseModalPublic(); this.finish(t, false, `shop out of ${next.obj}`); return true; }
                // belt and braces: re-open every 60 ticks (a fresh open re-sends the whole stock inv)
                if (this.tickCount - this.shopWait > 60) { this.shopWait = -1; this.sendCloseModalPublic(); t.lastOp = this.tickCount - 4; return true; }
                this.warm(); return true;
            }
            if (this.countOf(SUP_OBJ.COINS) <= 0) { this.sendCloseModalPublic(); this.finish(t, false, 'no coins'); return true; }
            if (this.shopClickReady()) this.shopBuy(next.obj, next.target - this.countOf(next.obj)); else this.warm();
            return true;
        }
        return super.handleMainModal();
    }
    private isStackableHeld(obj: number): boolean { return (obj === SUP_OBJ.FEATHER || obj === SUP_OBJ.COINS) && this.countOf(obj) > 0; }

    // ---- THE TICK -------------------------------------------------------------------------------------------------
    protected override doCombat(): void {
        if (!this.backpack()) { this.warm(); return; }
        const t = this.task;
        if (t && t.result === 'run') {
            if (this.tryHeal()) return;
            if (this.tickCount - t.startTick > t.budget && t.kind !== 'shop') { this.finish(t, false, `budget ${t.budget} ticks spent`); this.warm(); return; }
            switch (t.kind) {
                case 'shop': this.shopTick(t); return;
                case 'fish': this.fishTick(t); return;
                case 'cook': this.cookTick(t); return;
                case 'drop': this.dropTick(t); return;
                case 'eat': this.eatTick(t); return;
            }
        }
        super.doCombat();
    }

    private shopTick(t: SupTask): void {
        if (t.buys!.every(b => this.countOf(b.obj) >= b.target)) { this.finish(t, true, 'already held'); this.warm(); return; }
        if (this.tickCount - t.startTick > t.budget) { this.finish(t, false, `shop not opened/served in ${t.budget} ticks (${t.tries} trade ops)`); this.warm(); return; }
        const n = this.findNearestNpc(n => n.typeId === t.npcType);
        if (!n) { this.warm(); return; }
        if (this.stepToNpc(n.index, 1)) return;
        if (this.tickCount - t.lastOp < 8) { this.warm(); return; }
        this.opNpc(n.index, 3);   // op3=Trade: [opnpc3,_shop_keeper] / [opnpc3,baker_merchant] -> ~openshop_activenpc
        t.lastOp = this.tickCount; t.tries++;
    }

    /** A walkable tile cardinally adjacent to `spot` that the pathfinder can END on (cached per spot tile). */
    /** Land tiles that stalled a 40-tick approach (a water tile the planner's arrive ladder hid, a fenced tile). */
    private badStands = new Set<string>();
    private landStand(spot: Tile): Tile | null {
        const key = `${spot.x},${spot.z}`;
        if (this.standCache.has(key)) return this.standCache.get(key)!;
        const me = this.tile();
        const nbrs = [{ x: spot.x, z: spot.z + 1 }, { x: spot.x, z: spot.z - 1 }, { x: spot.x + 1, z: spot.z }, { x: spot.x - 1, z: spot.z }]
            .filter(n => !this.badStands.has(`${n.x},${n.z}`))
            .sort((a, b) => cheb(a, me) - cheb(b, me));
        let found: Tile | null = null;
        if (this.findLongPathFn) {
            for (const nb of nbrs) {
                if (nb.x === me.x && nb.z === me.z) { found = nb; break; }
                try {
                    const p = this.findLongPathFn(this.travelLevel, me.x, me.z, nb.x, nb.z);
                    const end = p[p.length - 1];
                    if (end && end.x === nb.x && end.z === nb.z) { found = nb; break; }
                } catch { /* next */ }
            }
        }
        // an arrive-ladder planner may stop short of a riverbank tile: fall back to the nearest untried neighbour
        // (walkToExact re-plans with the raw server-collision pathfinder; a stall marks it bad below)
        if (!found) found = nbrs[0] ?? null;
        if (!found) this.badStands.clear();   // all four failed: start over next tick
        this.standCache.set(key, found);
        return found;
    }

    private fishTick(t: SupTask): void {
        const raw = this.countOf(SUP_OBJ.RAW_TROUT);
        const fishNow = raw + this.countOf(SUP_OBJ.RAW_SALMON);
        if (this.prevFish >= 0 && fishNow > this.prevFish) this.lastCatchTick = this.tickCount;
        this.prevFish = fishNow;
        if (raw >= t.target!) { this.finish(t, true, `${raw} raw trout`); this.warm(); return; }
        if (this.countOf(SUP_OBJ.FLY_ROD) <= 0) { this.finish(t, false, 'no fly fishing rod'); this.warm(); return; }
        if (this.countOf(SUP_OBJ.FEATHER) <= 0) { this.finish(t, false, 'out of feathers'); this.warm(); return; }
        // drop salmon / burnt only when the pack is nearly full (a drop interrupts the cast -> re-kick)
        if (this.freePackSlots() <= 1) {
            for (const id of JUNK) {
                const s = this.slotOf(id);
                // the drop cancels the cast (OPHELD clears the pending interaction) -> allow an immediate re-kick
                if (s >= 0) { if (this.tickCount - t.lastOp >= 2) { this.dropItem(id, s); t.lastOp = this.tickCount; this.lastCatchTick = -100; this.lastKick = -100; } else this.warm(); return; }
            }
            if (this.freePackSlots() <= 0) { this.finish(t, false, 'pack full of non-junk'); this.warm(); return; }
        }
        const me = this.tile();
        const spot = this.findNearestNpc(n => n.typeId === t.npcType);
        if (!spot) { this.warm(); return; }
        const s = { x: spot.x, z: spot.z };
        const manh = Math.abs(me.x - s.x) + Math.abs(me.z - s.z);
        if (manh === 1) {
            this.orthoSince = -1;
            // KICK ONCE: the lure self-continues via p_opnpc(4); re-sending resets the cast (fisher.ts). Re-kick when
            // nothing landed for 15 ticks (a cast cycle is 5 ticks: freshfish.rs2 %action_delay map_clock+4).
            if (this.tickCount - this.lastCatchTick >= 15 && this.tickCount - this.lastKick >= 15 && this.tickCount - t.lastOp >= 1) { this.opNpc(spot.index, 1); this.lastKick = this.tickCount; t.lastOp = this.tickCount; t.tries++; }
            else this.warm();
            return;
        }
        // to a land tile cardinally next to the spot (a diagonal tile catches nothing — fisher.ts)
        const stand = this.landStand(s);
        if (!stand) { this.warm(); return; }
        if (this.orthoSince < 0) this.orthoSince = this.tickCount;
        if (this.tickCount - this.orthoSince > 40) { this.badStands.add(`${stand.x},${stand.z}`); this.standCache.delete(`${s.x},${s.z}`); this.orthoSince = -1; this.warm(); return; }
        if (!this.walkToExact(stand.x, stand.z)) this.warm();
    }

    private cookTick(t: SupTask): void {
        const raw = this.countOf(SUP_OBJ.RAW_TROUT);
        if (this.countOf(SUP_OBJ.TROUT) >= t.target!) { this.finish(t, true, `${this.countOf(SUP_OBJ.TROUT)} cooked trout`); this.warm(); return; }
        if (raw <= 0) { this.finish(t, false, `out of raw trout at ${this.countOf(SUP_OBJ.TROUT)} cooked`); this.warm(); return; }
        const st = t.stand!; const me = this.tile();
        if (me.x !== st.x || me.z !== st.z) { if (!this.walkToExact(st.x, st.z)) this.warm(); return; }
        if (this.mainModalId !== -1 || this.chatModalId !== -1) { this.warm(); return; }   // the backpack must be visible
        if (this.tickCount - t.lastOp < 3) { this.warm(); return; }   // cook_item: p_delay(1) — one per ~2 ticks
        // Cooking < 15: level up on shrimp/anchovy first (see LOWCOOK_RAW); none left -> fail loudly, not 8 silent retries
        let obj: number = SUP_OBJ.RAW_TROUT;
        if (this.cookLvl() < TROUT_COOK_LEVEL) {
            const low = LOWCOOK_RAW.find(id => this.countOf(id) > 0);
            if (low === undefined) { this.finish(t, false, `Cooking ${this.cookLvl()} < ${TROUT_COOK_LEVEL} and no raw shrimp/anchovy to train on`); this.warm(); return; }
            obj = low;
        }
        const slot = this.slotOf(obj);
        this.useItemOnLoc(t.loc!.x, t.loc!.z, t.loc!.id, obj, slot);
        t.lastOp = this.tickCount; t.tries++;
    }

    private dropTick(t: SupTask): void {
        for (const id of t.objs!) {
            const s = this.slotOf(id);
            if (s < 0) continue;
            if (this.tickCount - t.lastOp >= 2) { this.dropItem(id, s); t.lastOp = this.tickCount; t.tries++; } else this.warm();
            return;
        }
        this.finish(t, true, 'dropped'); this.warm();
    }

    private eatTick(t: SupTask): void {
        if (t.target !== undefined && this.countOf(SUP_OBJ.SHARK) <= t.target) { this.finish(t, true, 'ate one'); this.warm(); return; }
        if (this.tickCount - t.lastOp < 4) { this.warm(); return; }
        const s = this.slotOf(SUP_OBJ.SHARK);
        if (s < 0) { this.finish(t, false, 'no shark'); this.warm(); return; }
        this.opHeld1(SUP_OBJ.SHARK, s); t.lastOp = this.tickCount; t.tries++;
    }

    override status(): string {
        const o = this.obs();
        return `${this.loginUser}:sup[bread=${o.bread} trout=${o.trout} raw=${o.raw} rod=${o.rod} fea=${o.feathers} free=${o.free}${this.task?.result === 'run' ? ` task=${this.task.label}` : ''}]`;
    }
}

// =====================================================================================================================
// THE ASYNC DRIVER
// =====================================================================================================================
export interface SupDriveOpts {
    timeoutMs: number;
    shouldStop: () => boolean;
    log?: (s: string) => void;
    cfg?: Partial<SupCfg>;
}

/** The cardinal stand for the Burthorpe fire: south of it, on the camp side (routed offline). */
export const FIRE_STAND: Tile = { x: 2893, z: 3531 };

/**
 * Drive a logged-in DpKitBot until its pack holds cfg.bread bread + cfg.trout cooked trout (default 10 + 10).
 * Resolves true when held; false on timeout / stop / an unrecoverable 'need' (logged).
 */
export async function driveDpSupplies(bot: any, opts: SupDriveOpts): Promise<boolean> {
    const b = bot as DpKitBot;
    const log = opts.log ?? ((s: string) => console.log(s));
    b.log = log;
    const cfg: SupCfg = { ...DEFAULT_SUP_CFG, ...(opts.cfg ?? {}) };
    const fishSite = FISH_SITES[cfg.fish] ?? FISH_SITES.seers!;
    const t0 = Date.now();
    const stop = () => opts.shouldStop() || Date.now() - t0 > opts.timeoutMs || b.disposed;
    const me = () => b.tile();
    const lvl = () => ((b as any).minusedlevel ?? b.travelLevel ?? 0) as number;
    const pos = () => `(${me().x},${me().z},L${lvl()})`;

    for (let i = 0; i < 100 && !stop() && (!b.backpack() || (me().x === 0 && me().z === 0)); i++) await sleep(300);
    await sleep(1200);

    const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
        const t = Date.now();
        while (!pred() && Date.now() - t < ms && !stop()) await sleep(600);
        return pred();
    };
    const runTask = async (t: Parameters<DpKitBot['startTask']>[0]): Promise<boolean> => {
        const task = b.startTask(t);
        await waitFor(() => task.result !== 'run', (t.budget + 30) * 650);
        if (task.result === 'run') { task.result = 'fail'; task.why = 'driver timeout'; log(`[sup] ${b.loginUser}: task '${task.label}' TIMED OUT @ ${pos()}`); }
        b.task = null;
        if (b.mainModalId === SHOP_MAIN) (b as any).sendCloseModalPublic();
        return task.result === 'ok';
    };
    const travel = async (s: { level: number; at: Tile; near: number; label: string }, ms = 15 * 60_000): Promise<boolean> => {
        const ok = () => lvl() === s.level && cheb(me(), s.at) <= s.near;
        if (ok()) return true;
        log(`[sup] ${b.loginUser}: travelling to ${s.label} (${s.at.x},${s.at.z}) from ${pos()}`);
        b.startMultiTravel(s.level, s.at.x, s.at.z);
        const t = Date.now();
        let best = cheb(me(), s.at), bestAt = Date.now();
        while (!ok() && Date.now() - t < ms && !stop()) {
            if (b.arrived && !ok()) b.startMultiTravel(s.level, s.at.x, s.at.z);
            const d = cheb(me(), s.at);
            if (d < best) { best = d; bestAt = Date.now(); }
            if (Date.now() - bestAt > 4 * 60_000) { log(`[sup] ${b.loginUser}: no progress toward ${s.label} for 4 min @ ${pos()} (best ${best})`); break; }
            await sleep(1500);
        }
        b.arrived = true;
        if (!ok()) log(`[sup] ${b.loginUser}: could not reach ${s.label} — stuck @ ${pos()}`);
        return ok();
    };

    let lastLog = 0, fails = 0;
    while (!stop()) {
        const o = b.obs();
        const a = nextSupplyAction(o, cfg);
        if (Date.now() - lastLog > 15_000) { log(`[sup] ${b.loginUser}: ${b.status()} coins=${o.coins} sharks=${o.sharks} next=${a.kind} @ ${pos()}`); lastLog = Date.now(); }
        if (a.kind === 'done') { log(`[sup] ${b.loginUser}: SUPPLIES HELD — bread ${o.bread}, trout ${o.trout} @ ${pos()}`); return true; }
        if (a.kind === 'need') { log(`[sup] ${b.loginUser}: ⛔ cannot continue — need ${a.what}`); return false; }
        if (fails >= 8) { log(`[sup] ${b.loginUser}: ⛔ ${fails} failed tasks in a row — giving up this run`); return false; }
        let ok = true;
        switch (a.kind) {
            case 'drop-junk':
                ok = await runTask({ kind: 'drop', label: 'drop raw salmon / burnt fish', objs: junkIds(b.cookLvl()), budget: 60 });
                break;
            case 'drop-tackle':
                ok = await runTask({ kind: 'drop', label: 'drop the fly rod + feathers (fishing done, room for bread)', objs: [SUP_OBJ.FLY_ROD, SUP_OBJ.FEATHER], budget: 30 });
                break;
            case 'eat-shark':
                log(`[sup] ${b.loginUser}: eating a shark for room — ${a.why}`);
                ok = await runTask({ kind: 'eat', label: 'eat a shark (room)', target: o.sharks - 1, budget: 30 });
                break;
            case 'buy-tackle': {
                if (!await travel(SUP_SITES.GERRANT)) { ok = false; break; }
                const buys: ShopBuy[] = [];
                if (a.rod) buys.push({ obj: SUP_OBJ.FLY_ROD, target: 1 });
                if (a.feathers > 0) buys.push({ obj: SUP_OBJ.FEATHER, target: o.feathers + a.feathers });
                ok = await runTask({ kind: 'shop', label: `Gerrant: ${a.rod ? 'fly rod + ' : ''}${a.feathers} feathers`, npcType: SUP_NPC.GERRANT, buys, budget: 200 });
                break;
            }
            case 'fish':
                if (!await travel({ level: fishSite.level, at: fishSite.travel, near: 6, label: fishSite.label })) { ok = false; break; }
                ok = await runTask({ kind: 'fish', label: `lure trout -> ${a.target} raw`, npcType: fishSite.spot, target: a.target, budget: 2500 });
                break;
            case 'buy-bread':
                if (!await travel(SUP_SITES.BAKER)) { ok = false; break; }
                // 10 bread is the WHOLE shelf (stock1=bread,10,100): if others drained it, wait for the refill
                ok = await runTask({ kind: 'shop', label: `Baker: bread -> ${a.target}`, npcType: SUP_NPC.BAKER, buys: [{ obj: SUP_OBJ.BREAD, target: a.target }], budget: 1500 });
                break;
            case 'cook':
                if (!await travel(SUP_SITES.FIRE_BURTHORPE)) { ok = false; break; }
                ok = await runTask({
                    kind: 'cook', label: `cook ${a.n} trout on the Burthorpe fire`, target: o.trout + a.n,
                    loc: { x: SUP_SITES.FIRE_BURTHORPE.at.x, z: SUP_SITES.FIRE_BURTHORPE.at.z, id: SUP_LOC.FIRE }, stand: FIRE_STAND, budget: 40 + a.n * 8,
                });
                break;
        }
        fails = ok ? 0 : fails + 1;
        if (!ok) await sleep(3000);
    }
    log(`[sup] ${b.loginUser}: driver stopped (${opts.shouldStop() ? 'shouldStop' : 'timeout'}) — ${b.status()} @ ${pos()}`);
    return false;
}

// =====================================================================================================================
// GEAR BUY: travel to a shop, buy ONE item with the proven shop task, then WIELD it.
// The RC-99 law accounts fight Dad (Troll Stronghold) with FISTS — at str/def 75 acct11 still fled at hp ~16 with all
// 20 sharks eaten (42 retreats). Adamant longsword (1301) @ Varrock swordshop (swordshop1 npc 551, op3=Trade), 3,200 gp.
// cfg GB_CFG_<user>: npc=<type>;at=<x>,<z>;buy=<obj>   — status gb=run|done|fail
// =====================================================================================================================
export function parseGearCfg(s: string | undefined): { npc: number; at: Tile; buy: number } | null {
    const kv = Object.fromEntries((s ?? '').split(';').map(p => p.split('=').map(x => x.trim())).filter(p => p.length === 2)) as Record<string, string>;
    const [x, z] = (kv.at ?? '').split(',').map(Number);
    const npc = Number(kv.npc), buy = Number(kv.buy);
    if (!(npc > 0) || !(buy > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { npc, at: { x: x!, z: z! }, buy };
}
export async function driveGearBuy(bot: any, cfg: { npc: number; at: Tile; buy: number }, opts: { shouldStop: () => boolean; log: (s: string) => void }): Promise<boolean> {
    const b = bot as DpKitBot & any;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const me = () => b.tile() as Tile;
    const worn = () => !!b.isWorn?.(cfg.buy);
    if (worn()) { opts.log(`gear ${cfg.buy} already worn`); return true; }
    if (b.countOf(cfg.buy) === 0) {
        if (cheb(me(), cfg.at) > 3) {
            b.startMultiTravel(0, cfg.at.x, cfg.at.z);
            const t0 = Date.now();
            while (cheb(me(), cfg.at) > 3 && Date.now() - t0 < 15 * 60_000 && !opts.shouldStop()) { if (b.arrived && cheb(me(), cfg.at) > 3) b.startMultiTravel(0, cfg.at.x, cfg.at.z); await sleep(1500); }
            b.arrived = true;
            if (cheb(me(), cfg.at) > 3) { opts.log(`could not reach the shop (${cfg.at.x},${cfg.at.z}) @ (${me().x},${me().z})`); return false; }
        }
        const task = b.startTask({ kind: 'shop', label: `buy ${cfg.buy}`, npcType: cfg.npc, buys: [{ obj: cfg.buy, target: 1 }], budget: 300 });
        const t1 = Date.now();
        while (task.result === 'run' && Date.now() - t1 < 330 * 650 && !opts.shouldStop()) await sleep(600);
        b.task = null;
        if (b.mainModalId === SHOP_MAIN) b.sendCloseModalPublic();
        await sleep(1800);
        if (b.countOf(cfg.buy) === 0) { opts.log(`shop did not sell ${cfg.buy} (${task.why ?? task.result}; coins ${b.countOf(SUP_OBJ.COINS)})`); return false; }
    }
    for (let k = 0; k < 6 && !worn() && !opts.shouldStop(); k++) {
        const slot = b.slotOf(cfg.buy);
        if (slot >= 0) b.opHeld2(cfg.buy, slot);   // OPHELD2 = Wield
        await sleep(2500);
        if (b.countOf(cfg.buy) === 0) break;          // left the pack = worn (isWorn may be absent)
    }
    const ok = worn() || b.countOf(cfg.buy) === 0;
    opts.log(ok ? `WIELDED ${cfg.buy}` : `could not wield ${cfg.buy}`);
    return ok;
}

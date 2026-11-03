// SKILLING MODEL — mining ported from the engine's own mining.rs2 (every rule cited); fishing is a
// BEHAVIORAL port of the live-proven lessons (kick-once, orthogonal adjacency, ~5t catch cadence).
// This is the module that turns cadence questions ("does re-poking reset the swing?", "why did the
// coal lane capture zero?") into offline experiments — the class that burned ~2 live sessions.
//
// Mining contract (mining.rs2 + mine.dbrow + PlayerOps.ts STAT_RANDOM):
//   - swing clock: %action_delay. firstswing/continue: if delay < clock -> delay = clock + pickRate
//     (NO roll); if delay == clock -> ROLL. A NEW OPLOC while delay is in the future does NOT reset
//     it (mining.rs2:56-65) — re-poking is timer-neutral (matches the live iron A/B: 9 vs 9).
//   - roll: stat_random(mining, low, high): value = floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1,
//     success iff value > rand(0..255)  (PlayerOps.ts:582-590)
//   - success: ore + xp (units; displayed = units*xprate/10), rock loc_change -> empty stage for
//     respawnrate ticks. Poking the EMPTY stage answers "There is no ore currently available in this
//     rock." (mining.rs2:19-24) — the fast-rotate signal. Poking the LIVE id on a depleted tile is a
//     MISS (no-op, no message) — the wrong-variant trap.
//   - interaction persists across ticks (p_oploc) until a MOVE/modal cancels it.
import { CoopWorld, CoopPlayer } from './coop.ts';
import type { ClientAction } from './protocol.ts';
import { ClientProt } from '#/io/ClientProt.js';
import { LEATHER_PRODUCTS, LEATHER_CRAFTING, HARD_LEATHER as HARD_LEATHER_PRODUCT, type LeatherProduct } from '../skilling-tables.ts';

export const STAT_MINING = 14, STAT_FISHING = 10, STAT_RUNECRAFT = 20, STAT_FLETCHING = 9, XPRATE = 25;
export const RUNE_ESSENCE = 1436, KNIFE = 946;
/** LEATHER (rev 289 leather.rs2 + the generated skilling-tables, which extract-skilling.mjs reads from interface.pack). */
export const STAT_CRAFTING = 12, SIM_NEEDLE = 1733, SIM_THREAD = 1734, SIM_LEATHER = 1741, SIM_HARD_LEATHER = 1743;
export const LEATHER_MAIN: number = LEATHER_CRAFTING.ROOT;
const SIM_HARDLEATHER_BODY: LeatherProduct = HARD_LEATHER_PRODUCT;
/** if_button com -> (product, count) — every binding leather.rs2 declares for a non-members, soft-leather product. */
export const LEATHER_BUTTONS: ReadonlyMap<number, { product: LeatherProduct; count: number }> = new Map(
    LEATHER_PRODUCTS.flatMap(p => p.bindings.map(b => [b.com, { product: p, count: b.count }] as const)));
/** memberfish.rs2's two tools and the big net's headline catch (obj.sym). */
export const HARPOON = 311, BIG_NET = 305, RAW_MACKEREL = 353;
/** CASKET MODEL: memberfish.rs2 `[opheld1,casket]` + `~fish_roll_big_net`'s
 *  seven tables. Opt-in per spot (`bigNetTable`) so every pre-existing big-net test keeps its one-mackerel roll. */
export const CASKET = 405, COSMIC_TALISMAN = 1454, UNCUT_SAPPHIRE = 1623, UNCUT_EMERALD = 1621, UNCUT_RUBY = 1619,
    UNCUT_DIAMOND = 1617, KEYHALF1 = 985, KEYHALF2 = 987, SIM_COINS = 995;
/** objbox1 (interface.pack 306): the chat modal `~objbox` opens; p_pausebutton keeps the player busy() until resumed/closed. */
export const OBJBOX1 = 306;
/** The fish_roll_big_net table in script order: obj, stat_random low/high, xp units. Cod needs Fishing 23, bass 46 (early return). */
export const BIG_NET_TABLE: Array<{ obj: number; low: number; high: number; units: number; minLevel?: number; msg: string }> = [
    { obj: 1061, low: 10, high: 10, units: 10, msg: 'You catch some boots.' },
    { obj: 401, low: 10, high: 10, units: 1, msg: 'You catch some seaweed.' },
    { obj: 1059, low: 5, high: 5, units: 10, msg: 'You catch some gloves.' },
    { obj: 353, low: 5, high: 65, units: 200, msg: 'You catch a mackerel.' },
    { obj: 353, low: 10, high: 10, units: 200, msg: 'You catch a mackerel.' },   // another mackerel
    { obj: 407, low: 3, high: 7, units: 100, msg: 'You catch an oyster shell.' },
    { obj: CASKET, low: 1, high: 2, units: 100, msg: 'You catch a casket.' },
    { obj: 341, low: 4, high: 55, units: 450, minLevel: 23, msg: 'You catch a cod.' },
    { obj: 363, low: 3, high: 40, units: 1000, minLevel: 46, msg: 'You catch a bass.' },
];
export const PICK_LEVEL: Record<number, number> = { 1265: 1, 1267: 1, 1269: 6, 1273: 21, 1271: 31, 1275: 41 };   // pickaxes.obj levelrequire
export const PICK_RATE: Record<number, number> ={ 1265: 7, 1267: 6, 1269: 5, 1273: 4, 1271: 3, 1275: 2 };   // bronze..rune (learnings: 7t -> 2t)

export interface OreStats { level: number; expUnits: number; low: number; high: number; respawn: number; ore: number }
export const ORES: Record<string, OreStats> = {   // mine.dbrow rows
    copper: { level: 1, expUnits: 175, low: 128, high: 400, respawn: 10, ore: 436 },
    tin: { level: 1, expUnits: 175, low: 128, high: 400, respawn: 10, ore: 438 },
    iron: { level: 15, expUnits: 350, low: 96, high: 350, respawn: 20, ore: 440 },
    coal: { level: 30, expUnits: 500, low: 16, high: 100, respawn: 100, ore: 453 },
    mithril: { level: 55, expUnits: 800, low: 5, high: 50, respawn: 400, ore: 447 },
    adamantite: { level: 70, expUnits: 950, low: 2, high: 25, respawn: 800, ore: 449 },
    essence: { level: 1, expUnits: 50, low: 128, high: 400, respawn: 0, ore: 1436 },   // rune essence (blankrunestone -> blankrune); level 1, inexhaustible (respawn 0)
};

interface Rock { x: number; z: number; liveLoc: number; emptyLoc: number; ore: OreStats; depleted: boolean; respawnAt: number }
interface MineState { rock: Rock | null; actionDelay: number }

/**
 * A registered fishing spot. `engine` selects WHICH of the two fishing models this spot runs under —
 * see the ENGINE FISHING MODEL block below for why both exist.
 */
export interface FishSpotInfo {
    /** op3 (harpoon) catch. */
    fish: number; level: number; expUnits: number;
    /** ⭐ TRUE = the real `memberfish.rs2` `%action_delay` state machine (op1 net + op3 harpoon, the
     *  hidden repeat labels, the exact-tick roll). FALSE/absent = the legacy fixed-timer model that
     *  every pre-existing fishing test in this suite was written against. */
    engine?: boolean;
    /** `~check_fish_equipment` tools. op3 = harpoon, op1 = big net. */
    tool?: number; netTool?: number;
    /** op1's own gates and its headline catch (`fish_roll_big_net`). */
    netLevel?: number; netFish?: number; netExpUnits?: number; netLow?: number; netHigh?: number;
    /** TRUE = op1's roll is the FULL `~fish_roll_big_net` (seven tables incl. the casket), not the one-mackerel shorthand. */
    bigNetTable?: boolean;
}

/** The four-branch machine's per-player interaction state (the engine's `p_opnpc` target). */
interface FishPend { spotIndex: number; kind: 'shark' | 'net'; hidden: boolean }

export class SkillWorld extends CoopWorld {
    constructor(...args: ConstructorParameters<typeof CoopWorld>) {
        super(...args);
        this.registerStackable(SIM_THREAD);   // thread is stackable (obj config) — 40 reels are ONE slot, as live
    }
    private rocks: Rock[] = [];
    private mineState = new Map<number, MineState>();   // player index -> swing state
    fishing = { catchEveryTicks: 5, low: 128, high: 400 };   // behavioral (per live lessons)
    private fishState = new Map<number, { spotIndex: number; startedAt: number; lastCatchRoll: number }>();
    private fishSpots = new Map<number, FishSpotInfo>();   // npc index -> catch

    addRock(x: number, z: number, liveLoc: number, emptyLoc: number, ore: keyof typeof ORES): Rock {
        const r: Rock = { x, z, liveLoc, emptyLoc, ore: ORES[ore]!, depleted: false, respawnAt: 0 };
        this.rocks.push(r);
        return r;
    }
    /** `opts` is ADDITIVE and optional: every existing caller keeps the legacy timer model byte for byte. */
    addFishingSpot(npcIndex: number, typeId: number, x: number, z: number, fish: number, level = 1, expUnits = 100,
        opts: Partial<Omit<FishSpotInfo, 'fish' | 'level' | 'expUnits'>> = {}): void {
        this.addNpc(npcIndex, typeId, x, z);
        this.fishSpots.set(npcIndex, { fish, level, expUnits, ...opts });
    }
    /** The shark rig: memberfish 322 under the REAL engine model, harpoon on op3 and big net on op1. */
    addMemberFishSpot(npcIndex: number, x: number, z: number, fish: number, level = 76, expUnits = 1100,
        opts: Partial<FishSpotInfo> = {}): void {
        this.addFishingSpot(npcIndex, 322, x, z, fish, level, expUnits, {
            engine: true, tool: HARPOON, netTool: BIG_NET, netLevel: 16, netFish: RAW_MACKEREL,
            netExpUnits: 200, netLow: 5, netHigh: 65, ...opts,
        });
    }

    // ---- SPOT ROAM (skill_fishing/scripts/fishing_movement.rs2) ---------------------------------
    // ⭐ A FISHING SPOT DOES NOT WANDER — IT TELEPORTS, AND THE SIM COULD NOT REPRESENT THAT.
    // The real script moves EVERY Catherby spot npc (all seven, all three types) to a random free coord
    // of `fishing_movement_catherby_enum` every 280 + random(250) ticks. Nothing in this world modelled
    // it, so every fishing test ran against a spot nailed to one tile — and a brain that could not follow
    // a jump passed the whole offline suite and then caught nothing live, logging thousands of lines of
    // "no spot in the npc scene".
    //
    // ⛔ AND IT CANNOT BE DONE FROM A TEST. `npc.teleport()` sets a `teleported` flag that `coopTick`
    // CLEARS at the top of the next tick, and that flag is the ONLY thing that makes the harness emit the
    // remove+re-add a viewer needs in order to learn the new coordinates (a teleport produces no `steps`).
    // A test that teleports between `run()` calls therefore moves the npc server-side while every client
    // keeps fishing thin air at the old tile — which is a simulator artefact that looks exactly like the
    // live bug. So the move has to happen INSIDE the tick, after resetTransient: here.
    //
    // `everyTicks` collapses the 280-530 tick timer, and the coord walk is DETERMINISTIC (round-robin,
    // skipping any coord another roaming spot is standing on — the script's "free coord" rule) because a
    // reproducible failure is worth more than a realistic one.
    private spotRoams: Array<{ index: number; coords: Array<{ x: number; z: number }>; every: number; next: number; cursor: number }> = [];
    addSpotRoam(npcIndex: number, coords: Array<{ x: number; z: number }>, everyTicks: number): void {
        this.spotRoams.push({ index: npcIndex, coords, every: Math.max(1, everyTicks), next: this.tick + Math.max(1, everyTicks), cursor: 0 });
    }
    private roamSpots(): void {
        for (const r of this.spotRoams) {
            if (this.tick < r.next) continue;
            r.next = this.tick + r.every;
            const npc = this.npcs.get(r.index);
            if (!npc) continue;
            const taken = new Set<string>();
            for (const o of this.spotRoams) {
                if (o === r) continue;
                const on = this.npcs.get(o.index);
                if (on) taken.add(`${on.x},${on.z}`);
            }
            for (let i = 0; i < r.coords.length; i++) {
                r.cursor = (r.cursor + 1) % r.coords.length;
                const c = r.coords[r.cursor]!;
                if (taken.has(`${c.x},${c.z}`) || (c.x === npc.x && c.z === npc.z)) continue;
                npc.teleport(c.x, c.z);
                this.events.push({ tick: this.tick, kind: 'spot-roamed', detail: { index: r.index, x: c.x, z: c.z } });
                break;
            }
        }
    }

    // ---- RUNECRAFTING (runecraft.rs2/.dbrow, contract verified live in the nature-rune discovery):
    // oploc Craft-rune at the altar binds ALL rune essence AT ONCE — 1 rune/essence below the double
    // threshold, 2x at/above it; nature = level 44, 9.0xp (90 units), 2x at 91 (runecraft.rs2:80-82).
    private altars: Array<{ x: number; z: number; locId: number; rune: number; level: number; expUnits: number; doubleAt: number }> = [];
    addAltar(x: number, z: number, locId: number, rune: number, level: number, expUnits: number, doubleAt = 91): void {
        this.registerStackable(rune);   // runes stack (obj configs: stackable=yes)
        this.altars.push({ x, z, locId, rune, level, expUnits, doubleAt });
    }
    // RC Mysterious Ruins: USE the matching talisman on the ruins loc -> telejump INSIDE (to the altar
    // interior). Runecraft.rs2 [oplocu,_rc_ruins]: checks the talisman matches, then p_telejumps to the
    // enter_coord. (The EXIT portal reuses the generic addPortal/SimPortal — [oploc1,_rc_exit_portal].)
    private rcRuins: Array<{ x: number; z: number; locId: number; talisman: number; inX: number; inZ: number; entries?: ReadonlyArray<{ x: number; z: number }> }> = [];
    /** `entries`: several enter_coords — runecraft.rs2 [label,teleport_to_ruins] picks one with
     *  random(db_getfieldcount(enter_coord)); the world rng picks here (inX/inZ are then ignored). */
    addRcRuins(x: number, z: number, locId: number, talisman: number, inX: number, inZ: number, entries?: ReadonlyArray<{ x: number; z: number }>): void {
        this.rcRuins.push({ x, z, locId, talisman, inX, inZ, entries });
    }
    private craftRunes(p: CoopPlayer, altar: (typeof this.altars)[number]): void {
        const rc = this.stat(p, STAT_RUNECRAFT);
        if (rc.level < altar.level) { p.outPre.push({ kind: 'msg', text: `You need a Runecrafting level of ${altar.level} to craft this rune.` }); return; }
        const ess = this.invTotal(p.inv, RUNE_ESSENCE);
        if (ess < 1) { p.outPre.push({ kind: 'msg', text: 'You do not have any rune essence to bind.' }); return; }
        this.invRemove(p.inv, RUNE_ESSENCE, ess);
        const mult = rc.level >= altar.doubleAt ? 2 : 1;
        this.invAdd(p.inv, altar.rune, ess * mult);
        this.advanceStat(p, STAT_RUNECRAFT, altar.expUnits * ess);
        p.outInvs.add(3214);
        this.events.push({ tick: this.tick, kind: 'runes-crafted', detail: { player: p.name, rune: altar.rune, n: ess * mult } });
    }

    // ---- FLETCHING (fletching.rs2, live-verified numbers: knife on logs = 15 shafts/log ~375xp
    // displayed at 25x = 150 units/log; products gate by level — shortbow_u at 5, etc.)
    fletchProducts: Array<{ logs: number; product: number; count: number; level: number; expUnits: number }> = [
        { logs: 1511, product: 52, count: 15, level: 1, expUnits: 150 },     // logs -> 15 arrow shafts
        { logs: 1511, product: 50, count: 1, level: 5, expUnits: 200 },      // shortbow_u (the L5 option)
    ];
    private fletch(p: CoopPlayer, obj: number, useObj: number): void {
        const pair = new Set([obj, useObj]);
        if (!pair.has(KNIFE)) return;
        const logsId = obj === KNIFE ? useObj : obj;
        const fl = this.stat(p, STAT_FLETCHING);
        const opts = this.fletchProducts.filter(f => f.logs === logsId && fl.level >= f.level);
        if (!opts.length || this.invTotal(p.inv, logsId) < 1) return;
        const make = opts[opts.length - 1]!;
        this.invRemove(p.inv, logsId, 1);
        this.invAdd(p.inv, make.product, make.count);
        this.advanceStat(p, STAT_FLETCHING, make.expUnits);
        p.outInvs.add(3214);
        this.events.push({ tick: this.tick, kind: 'fletched', detail: { player: p.name, product: make.product, n: make.count } });
    }

    // ---- LEATHER CRAFTING (rev 289 skill_crafting/scripts/leather/leather.rs2, ported line by line) --------------
    // [opheldu,needle] / [opheldu,leather]: leather -> @craft_leather_interface (thread check -> objbox, else
    //   if_openmain(leather_crafting) = 2311); hard_leather -> @craft_leather(hardleather_body, 1) INLINE.
    // [if_button,leather_crafting:com_N] -> @craft_leather(product, count): if_close FIRST, level / leather / thread
    //   gates, then @process_leather_crafting: %action_delay = clock + 2 (if stale) and a WEAKQUEUE of
    //   (action_delay - clock) ticks; each queue run makes ONE, uses thread (one reel per five, %thread_used) and
    //   re-queues 2 ticks later until $count runs out or the leather does.
    // ⛔ THE TRAP THIS MODELS: the batch is a WEAK queue, and EVERY op packet
    //   (OPHELDU included) runs clearPendingAction() -> closeModal() -> weakQueue.clear(). A brain that re-sends
    //   needle-on-leather two ticks after the click cancels its own batch before the first item lands: the modal
    //   opens, the button closes it, the next OPHELDU kills the queue — forever, zero xp, modal=-1 at every sample.
    private leatherQueue = new Map<number, { product: LeatherProduct; count: number; due: number }>();
    private leatherActionDelay = new Map<number, number>();   // %action_delay (a varp: survives the clears)
    private threadUsed = new Map<number, number>();            // %thread_used
    static clearsWeakQueue(a: ClientAction): boolean {
        switch (a.type) {
            case 'move': return !a.opclick;
            case 'opheldu': case 'opheld': case 'opheldt': case 'oploc': case 'opnpc': case 'opobj': case 'oplocu':
            case 'opnpcu': case 'opnpct': case 'opobjt': case 'opplayer4': case 'closemodal': case 'wield': return true;
            default: return false;
        }
    }
    private leatherOpHeldU(p: CoopPlayer, a: ClientAction & { type: 'opheldu' }): boolean {
        const pair = [a.obj, a.useObj];
        if (!pair.includes(SIM_NEEDLE)) return false;
        const other = a.obj === SIM_NEEDLE ? a.useObj : a.obj;
        if (other !== SIM_LEATHER && other !== SIM_HARD_LEATHER && other !== SIM_THREAD) return false;
        // OpHeldUHandler: both items must be at the named slots (else a silent clearPendingAction)
        const s1 = p.inv[a.slot], s2 = p.inv[a.useSlot];
        if (!s1 || s1.id !== a.obj || !s2 || s2.id !== a.useObj) {
            this.events.push({ tick: this.tick, kind: 'opheldu-rejected', detail: { player: p.name, obj: a.obj, useObj: a.useObj } });
            return true;
        }
        if (p.modal !== -1) this.closeModalForSkill(p);   // clearPendingAction -> closeModal (main AND chat)
        if (p.chatModal !== -1) { p.chatModal = -1; p.outPre.push({ kind: 'close' }); }
        if (other === SIM_THREAD) { p.outPre.push({ kind: 'msg', text: 'Perhaps I should use a needle with a piece of leather instead.' }); return true; }
        if (other === SIM_HARD_LEATHER) { this.craftLeather(p, SIM_HARDLEATHER_BODY, 1); return true; }
        if (this.invTotal(p.inv, SIM_THREAD) < 1) {
            p.outPre.push({ kind: 'msg', text: 'You need some thread to make anything out of leather.' });
            this.events.push({ tick: this.tick, kind: 'leather-no-thread', detail: { player: p.name } });
            return true;
        }
        p.modal = LEATHER_MAIN;
        p.outPre.push({ kind: 'openmain', com: LEATHER_MAIN });
        this.events.push({ tick: this.tick, kind: 'leather-interface-opened', detail: { player: p.name } });
        return true;
    }
    private closeModalForSkill(p: CoopPlayer): void { p.modal = -1; p.openShop = -1; p.outPre.push({ kind: 'close' }); }
    /** [label,craft_leather] */
    private craftLeather(p: CoopPlayer, product: LeatherProduct, count: number): void {
        if (p.modal !== -1) this.closeModalForSkill(p);   // if_close
        const cr = this.stat(p, STAT_CRAFTING);
        if (cr.level < product.level) {
            p.outPre.push({ kind: 'msg', text: `You need a Crafting level of ${product.level} to make ${product.name}.` });
            this.events.push({ tick: this.tick, kind: 'leather-level-low', detail: { player: p.name, product: product.product } });
            return;
        }
        if (this.invTotal(p.inv, product.leatherObj) < product.leatherCount) {
            p.outPre.push({ kind: 'msg', text: `You don't have enough leather to make ${product.name}.` });
            return;
        }
        if (this.invTotal(p.inv, SIM_THREAD) < 1) { p.outPre.push({ kind: 'msg', text: 'You need some thread to make anything out of leather.' }); return; }
        if (product.productObj === SIM_HARDLEATHER_BODY.productObj) { this.makeOneLeather(p, product); return; }
        this.processLeather(p, product, count);
    }
    /** [label,process_leather_crafting]: %action_delay = clock+2 if stale, weakqueue*(delay - clock). */
    private processLeather(p: CoopPlayer, product: LeatherProduct, count: number): void {
        let delay = this.leatherActionDelay.get(p.index) ?? -1;
        if (delay < this.tick) { delay = this.tick + 2; this.leatherActionDelay.set(p.index, delay); }
        this.leatherQueue.set(p.index, { product, count, due: delay });
        this.events.push({ tick: this.tick, kind: 'leather-batch-queued', detail: { player: p.name, product: product.product, count, due: delay } });
    }
    /** inv_del leather, inv_add product, stat_advance, the thread-per-five rule. */
    private makeOneLeather(p: CoopPlayer, product: LeatherProduct): void {
        this.invRemove(p.inv, product.leatherObj, product.leatherCount);
        this.invAdd(p.inv, product.productObj, 1);
        this.advanceStat(p, STAT_CRAFTING, product.xp);
        p.outPre.push({ kind: 'msg', text: `You make ${product.name}.` });
        const used = (this.threadUsed.get(p.index) ?? 0) + 1;
        if (used > 4) {
            this.invRemove(p.inv, SIM_THREAD, 1);
            this.threadUsed.set(p.index, 0);
            p.outPre.push({ kind: 'msg', text: this.invTotal(p.inv, SIM_THREAD) === 0 ? 'You use up your last reel of thread' : 'You use up one of your reels of thread' });
        } else this.threadUsed.set(p.index, used);
        p.outInvs.add(3214);
        this.events.push({ tick: this.tick, kind: 'leather-crafted', detail: { player: p.name, product: product.productObj } });
    }
    /** [queue,craft_leather_queue] — runs when due and the player can access (not busy). */
    private runLeatherQueues(): void {
        for (const [idx, q] of [...this.leatherQueue]) {
            const p = this.playersByIndex.get(idx);
            if (!p) { this.leatherQueue.delete(idx); continue; }
            if (this.tick < q.due || this.busy(p)) continue;
            this.leatherQueue.delete(idx);
            if (this.invTotal(p.inv, q.product.leatherObj) === 0) { p.outPre.push({ kind: 'msg', text: 'You have run out of leather.' }); continue; }
            this.makeOneLeather(p, q.product);
            // the thread rule's `return` on the last reel ENDS the batch (leather.rs2 craft_leather_queue)
            if (this.invTotal(p.inv, SIM_THREAD) === 0) continue;
            const left = q.count - 1;
            if (left < 1) continue;
            this.leatherActionDelay.set(idx, this.tick + 2);
            this.processLeather(p, q.product, left);
        }
    }

    private stat(p: CoopPlayer, stat: number): { xp: number; level: number } {
        let s = p.stats.get(stat);
        if (!s) { s = { xp: 0, level: 1 }; p.stats.set(stat, s); }
        return s;
    }
    private advanceStat(p: CoopPlayer, stat: number, units: number): void {
        const s = this.stat(p, stat);
        const before = s.level;
        s.xp += (units * XPRATE) / 10;   // displayed
        // level from the engine's flat curve (combat.ts exports it; avoid the import cycle: inline)
        while (s.level < 99 && s.xp >= SkillWorld.xpFor(s.level + 1)) s.level++;
        p.outStats.push(stat);
        // Player.statAdvance: ONE [advancestat] script per advance that raised the base level (opt-in splash model)
        if (s.level > before) this.enqueueLevelUp(p, stat);
    }
    private static XP_TABLE: number[] | null = null;
    static xpFor(level: number): number {
        if (!this.XP_TABLE) {
            const out: number[] = [0, 0];
            let acc = 0;
            for (let i = 0; i < 99; i++) { acc += Math.floor(i + 1 + Math.pow(2, (i + 1) / 10) * 300); out[i + 2] = Math.floor(acc / 4); }
            this.XP_TABLE = out;
        }
        return this.XP_TABLE[level]!;
    }

    private statRandom(level: number, low: number, high: number): boolean {
        const value = Math.floor((low * (99 - level)) / 98) + Math.floor((high * (level - 1)) / 98) + 1;
        return value > Math.floor(this.rng() * 256);
    }
    /** pickaxe_checker.rs2 gates every tier on stat(mining) >= oc_param(levelrequire). Opt-in: older tests hand out
     *  rune/adamant picks without a Mining stat and keep the ungated model; the essence-wave phase-2 tests turn it on. */
    pickLevelGate = false;
    /** mining.rs2 [label,get_ore_essence] has NO success roll: every essence swing yields (opt-in; older tests keep the roll) */
    essenceNoRoll = false;
    /** the mining_rate of the pick the last swing used (tests) */
    lastPickRate: number | null = null;
    private bestPickRate(p: CoopPlayer): number | null {
        let best: number | null = null;
        const ok = (id: number) => PICK_RATE[id] !== undefined && (!this.pickLevelGate || this.stat(p, STAT_MINING).level >= (PICK_LEVEL[id] ?? 1));
        for (const s of p.inv) if (s && ok(s.id)) best = best === null ? PICK_RATE[s.id]! : Math.min(best, PICK_RATE[s.id]!);
        // pickaxe_checker.rs2: the WORN right hand counts too
        for (const w of p.worn.values()) if (ok(w.id)) best = best === null ? PICK_RATE[w.id]! : Math.min(best, PICK_RATE[w.id]!);
        this.lastPickRate = best;
        return best;
    }

    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        if (a.type === 'oplocu') {
            const why = this.oplocuRejected(p, a);
            if (why) { this.events.push({ tick: this.tick, kind: 'oplocu-rejected', detail: { player: p.name, loc: a.locId, obj: a.obj, slot: a.slot, why } }); return; }
        }
        // MOVE cancels the ACTION. ⛔ It does NOT clear `%action_delay`: that is a varp on the player,
        // not part of the interaction, which is exactly why the brains' walk-before-op (a MOVE_OPCLICK
        // to its own tile, needed because 274 replays the CLIENT's route) does not break the prime.
        if (a.type === 'move') { this.mineState.delete(p.index); this.wcState.delete(p.index); this.fishState.delete(p.index); this.fishPend.delete(p.index); }
        // CASKET OBJBOX (memberfish.rs2 [opheld1,casket] -> ~objbox -> p_pausebutton). The loot is added BEFORE the box;
        // the box is a CHAT modal, so the player is busy() (Player.ts canAccess) and the fishing interaction cannot run
        // until it is resumed or closed. Any op packet's clearPendingAction() closes it (closeModal), as does a MOVE.
        if (this.casketBox.has(p.index) && (a.type === 'resume' || a.type === 'closemodal' || a.type === 'opnpc' || a.type === 'opheld' || a.type === 'move' || a.type === 'oploc')) {
            this.casketBox.delete(p.index);
            p.outPre.push({ kind: 'close' });
            this.events.push({ tick: this.tick, kind: 'objbox-closed', detail: { player: p.name, by: a.type } });
            if (a.type === 'resume' || a.type === 'closemodal') return;
        }
        // OpHeldHandler.ts: `if (com.rootLayer != player.modalMain) player.clearPendingAction()` -- ANY held-item op (drop,
        // eat, open) kills the p_opnpc fishing loop. %action_delay (a varp) survives, exactly as for a MOVE.
        if (a.type === 'opheld') this.fishPend.delete(p.index);
        if (a.type === 'opheld' && a.op === ClientProt.OPHELD1 && a.obj === CASKET) { this.openCasket(p, a.slot); return; }
        if (a.type === 'oploc' && (a.op === 1 || a.op === 3)) {
            const rock = this.rocks.find(r => r.x === a.x && r.z === a.z);
            if (rock) { this.pokeRock(p, rock, a.locId); return; }
            const tree = this.trees.find(t => t.x === a.x && t.z === a.z);
            if (tree) {
                if (Math.abs(p.x - tree.x) + Math.abs(p.z - tree.z) > 2) { this.events.push({ tick: this.tick, kind: 'cant-reach', detail: { player: p.name } }); return; }
                const cur = tree.depleted ? tree.emptyLoc : tree.liveLoc;
                if (a.locId !== cur) { this.events.push({ tick: this.tick, kind: 'op-miss', detail: { player: p.name } }); return; }
                if (tree.depleted) { this.events.push({ tick: this.tick, kind: 'tree-stump', detail: { player: p.name } }); return; }
                const st = this.wcState.get(p.index) ?? { tree: null, actionDelay: -1 };
                st.tree = tree;
                this.wcState.set(p.index, st);
                this.chopSwing(p, st);
                return;
            }
        }
        if (a.type === 'opnpc' && this.fishSpots.has(a.index)) {
            if (this.fishSpots.get(a.index)!.engine) this.opFishSpot(p, a.index, a.op);
            else this.kickSpot(p, a.index);
            return;
        }
        if (a.type === 'opnpc' && a.op === 3 && this.pickpockets.has(this.npcs.get(a.index)?.typeId ?? -1)) { this.pickpocket(p, a.index); return; }
        if (a.type === 'oploc' || a.type === 'oplocu') {
            const altar = this.altars.find(al => al.x === (a as { x: number }).x && al.z === (a as { z: number }).z);
            if (altar && Math.max(Math.abs(p.x - altar.x), Math.abs(p.z - altar.z)) <= 2) { this.craftRunes(p, altar); return; }
        }
        if (a.type === 'oplocu') {
            const proc = this.processLocs.find(l => l.x === a.x && l.z === a.z && l.locId === a.locId);
            if (proc && Math.abs(p.x - a.x) + Math.abs(p.z - a.z) <= 1) { this.cookAt(p, a.obj); return; }
            // RC ruins: the RIGHT talisman used on the ruins telejumps the player into the altar interior.
            const ruins = this.rcRuins.find(r => r.x === a.x && r.z === a.z && r.talisman === a.obj);
            // REACH: every Mysterious ruins is 3x3 (runecraft.loc width/length 3) with its ORIGIN at the SW corner,
            // so the far faces (x+3 / z+3) are 3 from the origin — the old origin-Chebyshev<=2 rule refused the cosmic ruins'
            // valid north face (3176,9499). Footprint adjacency (rsmod reached for a 3x3) OR the old rule (no regression).
            const fd = ruins ? Math.max(Math.max(0, ruins.x - p.x, p.x - (ruins.x + 2)), Math.max(0, ruins.z - p.z, p.z - (ruins.z + 2))) : 99;
            if (ruins && (fd <= 1 || Math.max(Math.abs(p.x - a.x), Math.abs(p.z - a.z)) <= 2)) {
                const e = ruins.entries?.length ? ruins.entries[Math.floor(this.rng() * ruins.entries.length)]! : { x: ruins.inX, z: ruins.inZ };
                p.teleport(e.x, e.z);
                this.events.push({ tick: this.tick, kind: 'rc-entered', detail: { player: p.name, x: e.x, z: e.z } });
                return;
            }
        }
        // LEATHER (leather.rs2): every op packet's clearPendingAction() -> closeModal() CLEARS the weak queue the
        // make-N batch lives in; a MOVE_OPCLICK does not (rev 289 MoveClickHandler), an IF_BUTTON does not.
        if (this.leatherQueue.has(p.index) && SkillWorld.clearsWeakQueue(a)) {
            const q = this.leatherQueue.get(p.index)!;
            this.leatherQueue.delete(p.index);
            this.events.push({ tick: this.tick, kind: 'leather-batch-cancelled', detail: { player: p.name, by: a.type, left: q.count } });
        }
        if (a.type === 'ifbutton' && p.modal === LEATHER_MAIN && LEATHER_BUTTONS.has(a.com)) {
            const b = LEATHER_BUTTONS.get(a.com)!;
            this.craftLeather(p, b.product, b.count);
            return;
        }
        if (a.type === 'opheldu' && this.leatherOpHeldU(p, a)) return;
        if (a.type === 'opheldu') {
            if (this.combines.some(r => (r.a === a.obj && r.b === a.useObj) || (r.a === a.useObj && r.b === a.obj))) { this.combine(p, a.obj, a.useObj); return; }
            this.fletch(p, a.obj, a.useObj);
            return;
        }
        // FIDELITY: a DROP (OPHELD5) of a shark used to be modelled as EATING it — drops fall through to the drop model
        if (a.type === 'opheld' && a.op !== ClientProt.OPHELD5 && this.consumables.some(r => r.obj === a.obj)) { this.consume(p, a.obj); return; }
        super.applyAction(p, a);
    }

    // [oploc,_mining_rock_*] mining.rs2 — a NEW op packet runs firstswing (timer-neutral mid-swing)
    private pokeRock(p: CoopPlayer, rock: Rock, sentLocId: number): void {
        if (Math.abs(p.x - rock.x) + Math.abs(p.z - rock.z) > 2) { this.events.push({ tick: this.tick, kind: 'cant-reach', detail: { player: p.name } }); return; }
        const currentLoc = rock.depleted ? rock.emptyLoc : rock.liveLoc;
        if (sentLocId !== currentLoc) { this.events.push({ tick: this.tick, kind: 'op-miss', detail: { player: p.name, sent: sentLocId, actual: currentLoc } }); return; }   // wrong-variant/stage = silent no-op
        if (rock.depleted) {
            p.outPre.push({ kind: 'msg', text: 'There is no ore currently available in this rock.' });
            this.events.push({ tick: this.tick, kind: 'no-ore', detail: { player: p.name } });
            return;
        }
        const st = this.mineState.get(p.index) ?? { rock: null, actionDelay: -1 };
        st.rock = rock;
        this.mineState.set(p.index, st);
        this.mineSwing(p, st);   // firstswing runs THIS tick
    }
    private mineSwing(p: CoopPlayer, st: MineState): void {
        const rock = st.rock!;
        if (rock.depleted) { st.rock = null; return; }   // continue on a depleted rock ends the action
        if (this.freeSlots(p.inv) < 1) { p.outPre.push({ kind: 'msg', text: 'Your inventory is too full to hold any more ore.' }); st.rock = null; return; }
        const mining = this.stat(p, STAT_MINING);
        if (mining.level < rock.ore.level) { p.outPre.push({ kind: 'msg', text: `You need a Mining level of ${rock.ore.level} to mine this rock.` }); st.rock = null; return; }
        const rate = this.bestPickRate(p);
        if (rate === null) { p.outPre.push({ kind: 'msg', text: 'You need a Pickaxe to mine this rock.' }); st.rock = null; return; }
        if (st.actionDelay < this.tick) { st.actionDelay = this.tick + rate; return; }   // start/restart swing, NO roll
        if (st.actionDelay === this.tick) {   // roll is due
            st.actionDelay = this.tick + rate;   // continue swings regardless of outcome (mining.rs2:99)
            if ((this.essenceNoRoll && rock.ore.ore === 1436) || this.statRandom(mining.level, rock.ore.low, rock.ore.high)) {
                this.invAdd(p.inv, rock.ore.ore, 1);
                this.advanceStat(p, STAT_MINING, rock.ore.expUnits);
                rock.depleted = true;
                rock.respawnAt = this.tick + rock.ore.respawn;
                p.outInvs.add(3214);
                p.outPre.push({ kind: 'msg', text: 'You manage to mine some ore.' });
                this.events.push({ tick: this.tick, kind: 'ore-mined', detail: { player: p.name, ore: rock.ore.ore } });
            }
        }
    }

    // FISHING (behavioral): kick starts/RESETS the action (the live kick-once trap); a catch roll
    // every catchEveryTicks while orthogonally adjacent; success by the same stat_random shape.
    private kickSpot(p: CoopPlayer, spotIndex: number): void {
        const spot = this.npcs.get(spotIndex);
        if (!spot) return;
        if (Math.abs(p.x - spot.x) + Math.abs(p.z - spot.z) !== 1) { this.events.push({ tick: this.tick, kind: 'fish-diagonal-noop', detail: { player: p.name } }); return; }
        this.fishState.set(p.index, { spotIndex, startedAt: this.tick, lastCatchRoll: this.tick });   // RESET — this is the trap
        this.events.push({ tick: this.tick, kind: 'fish-kicked', detail: { player: p.name } });
    }

    // ================================================================================================
    // ENGINE FISHING MODEL — a line-by-line port of
    // `server/content/scripts/skill_fishing/scripts/fishing_spots/memberfish.rs2`.
    // ================================================================================================
    //
    // ⭐ WHY THE FIXED TIMER ABOVE COULD NOT ANSWER THE QUESTION IT WAS BEING ASKED. The legacy model
    // is "any opnpc on a spot arms it, then a catch roll every `catchEveryTicks` forever". Under it,
    // op1 and op3 are the same packet, a mid-cycle click is harmless, and the CADENCE of the clicks
    // cannot change the output at all — so a tick-manipulation experiment run against it would report
    // a flat 1.00 ratio no matter what the brain did, which is a simulator answering a different
    // question convincingly.
    //
    // THE REAL SHAPE (all four labels, both ops, one shared `%action_delay`):
    //   attempt_fish_shark   (opnpc3) : delay STALE -> delay = clock+5, p_opnpc(3)
    //                                   delay = clock+4 -> "You start Harpooning fish.", p_opnpc(5)
    //                                   delay = clock   -> ~fish_roll(raw_shark)   [and NO p_opnpc]
    //   fish_shark           (opnpc5) : delay STALE -> delay = clock+5 ; delay = clock -> roll
    //                                   ...and ALWAYS p_opnpc(5)  <- the self-sustaining AFK loop
    //   attempt_fish_mackerel(opnpc1) : delay STALE -> delay = clock+4, p_opnpc(1)   <- ⭐ THE PRIME
    //                                   delay = clock+3 -> "You cast out your net...", p_opnpc(4)
    //                                   delay = clock   -> ~fish_roll_big_net       [and NO p_opnpc]
    //   fish_mackerel        (opnpc4) : delay STALE -> delay = clock+5 ; delay = clock -> big-net roll
    //                                   ...and ALWAYS p_opnpc(4)
    //
    // TWO CONSEQUENCES THE BRAIN NOW DEPENDS ON, AND THAT ONLY THIS MODEL CAN EXPRESS:
    //   1. AFK steady state is SIX ticks per roll, not five: the hidden loop re-arms to clock+5 on the
    //      tick AFTER the roll (the roll leaves the delay stale), so rolls land at t, t+6, t+12...
    //   2. op1's +4 is ONE SHORTER than op3's +5. Prime with op1 at phase 0 and land op3 on phase 4 and
    //      the roll lands every FIVE ticks — 6/5 the sharks — and the op3 preempts the mackerel roll
    //      that would otherwise have fired on that same tick.
    //
    // ⛔ AND THE TRAP THAT MAKES THE PHASES EXACT RATHER THAN APPROXIMATE. An OPNPC whose delay matches
    // NONE of the three branches falls off the end of the label having already run clearPendingAction()
    // — no roll, no re-arm, no message. The fishing loop is simply GONE and the next thing the bot sees
    // is silence. That is why a "roughly every 5 ticks" harpoon click is not a slower version of this
    // optimisation, it is a dead lane.
    private fishDelay = new Map<number, number>();   // %action_delay — a VARP: survives a MOVE
    private fishPend = new Map<number, FishPend>();  // the p_opnpc interaction — a MOVE clears it
    private fishRanAt = new Map<number, number>();   // one label execution per player per tick

    /** The three gates every label re-checks; each one ~mesbox()es and ENDS the interaction. */
    private fishGates(p: CoopPlayer, info: FishSpotInfo, kind: 'shark' | 'net'): boolean {
        const mes = (why: string): false => {
            this.events.push({ tick: this.tick, kind: 'fish-mesbox', detail: { player: p.name, why, op: kind } });
            return false;
        };
        const fs = this.stat(p, STAT_FISHING);
        const need = kind === 'shark' ? info.level : (info.netLevel ?? 16);
        if (fs.level < need) return mes('level');
        const tool = kind === 'shark' ? info.tool : info.netTool;
        if (tool !== undefined && this.invTotal(p.inv, tool) < 1) return mes('equipment');
        if (this.freeSlots(p.inv) < 1) return mes('full');
        return true;
    }

    private fishRoll(p: CoopPlayer, info: FishSpotInfo, kind: 'shark' | 'net'): void {
        const fs = this.stat(p, STAT_FISHING);
        // ⭐ EMITTED ON EVERY ROLL, HIT OR MISS. The cadence changes the number of ROLLS; `statRandom`
        // decides how many of them land. A test that can see rolls separately from catches can assert
        // the mechanic deterministically instead of arguing with the RNG.
        this.events.push({ tick: this.tick, kind: 'fish-roll', detail: { player: p.name, op: kind } });
        if (kind === 'net' && info.bigNetTable) { this.bigNetRoll(p); return; }
        const fish = kind === 'shark' ? info.fish : (info.netFish ?? RAW_MACKEREL);
        const units = kind === 'shark' ? info.expUnits : (info.netExpUnits ?? 200);
        const low = kind === 'shark' ? this.fishing.low : (info.netLow ?? 5);
        const high = kind === 'shark' ? this.fishing.high : (info.netHigh ?? 65);
        if (!this.statRandom(fs.level, low, high) || this.freeSlots(p.inv) < 1) return;
        this.invAdd(p.inv, fish, 1);
        this.advanceStat(p, STAT_FISHING, units);
        p.outInvs.add(3214);
        this.events.push({ tick: this.tick, kind: 'fish-caught', detail: { player: p.name, fish } });
    }

    /** `~fish_roll_big_net` line by line: every table rolls INDEPENDENTLY (one attempt can land boots AND a casket AND a
     *  cod); cod/bass return early below Fishing 23/46. inv_add past a full pack is dropped here (the engine's own gate
     *  is only the label's `inv_freespace(inv) < 1`). */
    private bigNetRoll(p: CoopPlayer): void {
        const lvl = this.stat(p, STAT_FISHING).level;
        for (const row of BIG_NET_TABLE) {
            if (row.minLevel !== undefined && lvl < row.minLevel) return;
            if (!this.statRandom(lvl, row.low, row.high)) continue;
            if (this.invAdd(p.inv, row.obj, 1) < 1) continue;
            this.advanceStat(p, STAT_FISHING, row.units);
            p.outInvs.add(3214);
            p.outPre.push({ kind: 'msg', text: row.msg });
            this.events.push({ tick: this.tick, kind: row.obj === CASKET ? 'casket-caught' : 'fish-caught', detail: { player: p.name, fish: row.obj } });
        }
    }
    /** casket test seam: force the next casket's random(128) (null = the world rng). */
    casketRollOverride: number | null = null;
    private casketBox = new Set<number>();
    /** memberfish.rs2 `[opheld1,casket]`: inv_delslot(last_slot), random(128) -> one item, then the objbox. */
    private openCasket(p: CoopPlayer, slot: number): void {
        const s = p.inv[slot];
        if (!s || s.id !== CASKET) { this.events.push({ tick: this.tick, kind: 'casket-open-miss', detail: { player: p.name, slot } }); return; }
        if (s.count > 1) s.count--; else p.inv[slot] = null;
        const r = this.casketRollOverride ?? Math.floor(this.rng() * 128);
        this.casketRollOverride = null;
        let obj: number, n = 1;
        if (r < 60) { obj = SIM_COINS; n = Math.pow(2, Math.floor(this.rng() * 6) + 1) * 10; }
        else if (r < 92) obj = UNCUT_SAPPHIRE;
        else if (r < 108) obj = UNCUT_EMERALD;
        else if (r < 116) obj = UNCUT_RUBY;
        else if (r < 124) obj = COSMIC_TALISMAN;
        else if (r < 126) obj = UNCUT_DIAMOND;
        else if (r < 127) obj = KEYHALF1;
        else obj = KEYHALF2;
        this.invAdd(p.inv, obj, n);
        p.outInvs.add(3214);
        p.outPre.push({ kind: 'openchat', com: OBJBOX1 });
        this.casketBox.add(p.index);
        this.events.push({ tick: this.tick, kind: 'casket-opened', detail: { player: p.name, obj, n } });
    }

    /** ONE tick of the machine. `hidden` picks the p_opnpc(4)/(5) repeat label over the op1/op3 attempt. */
    private fishLabel(p: CoopPlayer, spotIndex: number, kind: 'shark' | 'net', hidden: boolean): void {
        const info = this.fishSpots.get(spotIndex);
        if (!info) return;
        this.fishRanAt.set(p.index, this.tick);
        if (!this.fishGates(p, info, kind)) { this.fishPend.delete(p.index); return; }
        const delay = this.fishDelay.get(p.index) ?? -1;
        if (hidden) {
            // fish_shark / fish_mackerel — BOTH re-arm to clock+5, and BOTH p_opnpc unconditionally.
            if (delay < this.tick) this.fishDelay.set(p.index, this.tick + 5);
            else if (delay === this.tick) this.fishRoll(p, info, kind);
            this.fishPend.set(p.index, { spotIndex, kind, hidden: true });
            return;
        }
        const start = kind === 'shark' ? 5 : 4;   // ⭐ op1's +4 against op3's +5 IS the prime
        if (delay < this.tick) {
            this.fishDelay.set(p.index, this.tick + start);
            this.fishPend.set(p.index, { spotIndex, kind, hidden: false });   // p_opnpc(3) / p_opnpc(1)
            this.events.push({ tick: this.tick, kind: 'fish-armed', detail: { player: p.name, op: kind, until: this.tick + start } });
            return;
        }
        if (delay === this.tick + start - 1) {
            this.fishPend.set(p.index, { spotIndex, kind, hidden: true });    // p_opnpc(5) / p_opnpc(4)
            this.events.push({ tick: this.tick, kind: kind === 'shark' ? 'fish-harpoon-start' : 'fish-net-cast', detail: { player: p.name } });
            if (kind === 'net' && info.bigNetTable) p.outPre.push({ kind: 'msg', text: 'You cast out your net...' });   // memberfish.rs2 mes()
            return;
        }
        if (delay === this.tick) {
            this.fishRoll(p, info, kind);
            this.fishPend.delete(p.index);   // the roll branch does NOT p_opnpc: the attempt ends here
            return;
        }
        // ⛔ NO BRANCH MATCHED — and clearPendingAction already ran. The loop is dead, silently.
        this.fishPend.delete(p.index);
        this.events.push({ tick: this.tick, kind: 'fish-loop-killed', detail: { player: p.name, op: kind, delay, clock: this.tick } });
    }

    /** The OPNPC packet: clearPendingAction() first, then the attempt label. */
    private opFishSpot(p: CoopPlayer, spotIndex: number, op: number): void {
        const spot = this.npcs.get(spotIndex);
        if (!spot) return;
        this.fishPend.delete(p.index);   // Player.ts:774-777 — the packet phase clears the interaction
        if (Math.abs(p.x - spot.x) + Math.abs(p.z - spot.z) !== 1) {
            this.events.push({ tick: this.tick, kind: 'fish-diagonal-noop', detail: { player: p.name } });
            return;
        }
        if (op !== 1 && op !== 3) return;
        this.fishLabel(p, spotIndex, op === 1 ? 'net' : 'shark', false);
    }

    // ================================================================================================
    // GENERIC SKILL ARCHETYPES: every skill is one of five interaction
    // shapes. Future side-steps (herblore, woodcutting, crafting, agility...) plug their engine
    // tables into these instead of porting scripts one by one.
    //   1. LOC-GATHER   — mining (pick-rate swings) / WOODCUTTING (3t swings, fall chance)
    //   2. PROCESS      — item-on-loc: COOKING (burn curve), smelting
    //   3. COMBINE      — item-on-item: fletching, HERBLORE, crafting
    //   4. CONSUME      — opheld1 self-ops: PRAYER bury, eating
    //   5. PICKPOCKET   — opnpc3: THIEVING (stat_random chance, stun+damage on fail)
    // ================================================================================================

    // ---- 1b. WOODCUTTING (woodcutting.rs2: swing every 3t regardless of axe — the axe scales the
    // CHANCE, not the rate; normal trees ALWAYS fall (respawn 120+rand80), others fall 1/8) ---------
    static AXE_IDS = [1351, 1349, 1353, 1355, 1357, 1359];   // bronze..rune (presence required)
    private trees: Array<{ x: number; z: number; liveLoc: number; emptyLoc: number; cfg: { level: number; expUnits: number; product: number; low: number; high: number; respawn: number; fall: number } ; depleted: boolean; respawnAt: number }> = [];
    private wcState = new Map<number, { tree: (typeof this.trees)[number] | null; actionDelay: number }>();
    addTree(x: number, z: number, liveLoc: number, emptyLoc: number, cfg: { level: number; expUnits: number; product: number; low: number; high: number; respawn: number; fall: number }): void {
        this.trees.push({ x, z, liveLoc, emptyLoc, cfg, depleted: false, respawnAt: 0 });
    }
    private chopSwing(p: CoopPlayer, st: { tree: (typeof this.trees)[number] | null; actionDelay: number }): void {
        const tree = st.tree!;
        if (tree.depleted) { st.tree = null; return; }
        if (this.freeSlots(p.inv) < 1) { p.outPre.push({ kind: 'msg', text: 'Your inventory is too full to hold any more logs.' }); st.tree = null; return; }
        const wc = this.stat(p, 8);   // STAT_WOODCUTTING = 8
        if (wc.level < tree.cfg.level) { p.outPre.push({ kind: 'msg', text: `You need a Woodcutting level of ${tree.cfg.level} to chop this tree.` }); st.tree = null; return; }
        if (!p.inv.some(s => s && SkillWorld.AXE_IDS.includes(s.id))) { p.outPre.push({ kind: 'msg', text: 'You need an axe to chop this tree.' }); st.tree = null; return; }
        if (st.actionDelay < this.tick) { st.actionDelay = this.tick + 3; return; }   // 3t, axe-independent
        if (st.actionDelay === this.tick) {
            st.actionDelay = this.tick + 3;
            if (this.statRandom(wc.level, tree.cfg.low, tree.cfg.high)) {
                this.invAdd(p.inv, tree.cfg.product, 1);
                this.advanceStat(p, 8, tree.cfg.expUnits);
                p.outInvs.add(3214);
                this.events.push({ tick: this.tick, kind: 'logs-chopped', detail: { player: p.name, product: tree.cfg.product } });
                // normal tree (fall=1): always falls; others 1/fall chance (woodcutting.rs2:123-140)
                if (tree.cfg.fall <= 1 || Math.floor(this.rng() * tree.cfg.fall) === 0) {
                    tree.depleted = true;
                    tree.respawnAt = this.tick + (tree.cfg.respawn || 120 + Math.floor(this.rng() * 80));
                    st.tree = null;
                    this.events.push({ tick: this.tick, kind: 'tree-fell', detail: { player: p.name } });
                }
            }
        }
    }

    // ---- 2. PROCESS (item-on-loc): cooking_generic.dbrow rows -------------------------------------
    private processLocs: Array<{ x: number; z: number; locId: number }> = [];
    cookTable: Array<{ raw: number; cooked: number; burnt: number; level: number; low: number; high: number; expUnits: number }> = [
        { raw: 317, cooked: 315, burnt: 323, level: 1, low: 128, high: 512, expUnits: 300 },      // shrimp
        { raw: 377, cooked: 379, burnt: 381, level: 40, low: 38, high: 332, expUnits: 1200 },     // lobster
        { raw: 371, cooked: 373, burnt: 375, level: 45, low: 18, high: 292, expUnits: 1400 },     // swordfish
        { raw: 383, cooked: 385, burnt: 387, level: 80, low: 1, high: 202, expUnits: 2100 },      // shark
    ];
    addCookLoc(x: number, z: number, locId: number): void { this.processLocs.push({ x, z, locId }); }
    private cookAt(p: CoopPlayer, obj: number): void {
        const row = this.cookTable.find(r => r.raw === obj);
        if (!row || this.invTotal(p.inv, obj) < 1) return;
        const ck = this.stat(p, 7);
        if (ck.level < row.level) { p.outPre.push({ kind: 'msg', text: `You need a Cooking level of ${row.level} to cook this.` }); return; }
        this.invRemove(p.inv, obj, 1);
        if (this.statRandom(ck.level, row.low, row.high)) {
            this.invAdd(p.inv, row.cooked, 1);
            this.advanceStat(p, 7, row.expUnits);
            this.events.push({ tick: this.tick, kind: 'cooked', detail: { player: p.name, cooked: row.cooked } });
        } else {
            this.invAdd(p.inv, row.burnt, 1);
            this.events.push({ tick: this.tick, kind: 'burnt', detail: { player: p.name } });
        }
        p.outInvs.add(3214);
    }

    // ---- 3. COMBINE (item-on-item): herblore/crafting rows; fletching stays on its own table ------
    combines: Array<{ a: number; b: number; product: number; count: number; stat: number; level: number; expUnits: number; consumeA?: boolean; onMake?: (p: CoopPlayer) => void }> = [
        // HERBLORE examples (register more rows as the cohort needs them):
        { a: 227, b: 249, product: 91, count: 1, stat: 15, level: 1, expUnits: 250 },    // vial_of_water + guam -> guam_unf
        { a: 91, b: 221, product: 121, count: 1, stat: 15, level: 3, expUnits: 625 },    // guam_unf + eye_of_newt -> attack_potion(3)
    ];
    private combine(p: CoopPlayer, obj: number, useObj: number): void {
        const row = this.combines.find(r => (r.a === obj && r.b === useObj) || (r.a === useObj && r.b === obj));
        if (!row) return;
        const st = this.stat(p, row.stat);
        if (st.level < row.level) { p.outPre.push({ kind: 'msg', text: 'Your level is not high enough to make this.' }); return; }
        if (this.invTotal(p.inv, row.a) < 1 || this.invTotal(p.inv, row.b) < 1) return;
        // consumeA === false: `a` is a TOOL (knife on a dramen branch: quest_zanaris.rs2 [label,cut_dramenstaff] deletes only the branch)
        if (row.consumeA !== false) this.invRemove(p.inv, row.a, 1);
        this.invRemove(p.inv, row.b, 1);
        this.invAdd(p.inv, row.product, row.count);
        this.advanceStat(p, row.stat, row.expUnits);
        p.outInvs.add(3214);
        this.events.push({ tick: this.tick, kind: 'combined', detail: { player: p.name, product: row.product } });
        row.onMake?.(p);   // the script's side effects (a quest varp, a message) — e.g. [label,cut_dramenstaff]
    }

    // ---- 4. CONSUME (opheld1): bury / eat ---------------------------------------------------------
    consumables: Array<{ obj: number; stat?: number; expUnits?: number; heal?: number }> = [
        { obj: 532, stat: 5, expUnits: 150 },   // big_bones -> Prayer (live-proven: 375 displayed at 25x)
        { obj: 526, stat: 5, expUnits: 37 },    // bones
        { obj: 385, heal: 20 },                  // shark
    ];
    private consume(p: CoopPlayer, obj: number): void {
        const row = this.consumables.find(r => r.obj === obj);
        if (!row || this.invTotal(p.inv, obj) < 1) return;
        this.invRemove(p.inv, obj, 1);
        if (row.stat !== undefined && row.expUnits) this.advanceStat(p, row.stat, row.expUnits);
        if (row.heal) p.hp = Math.min(p.maxHp, p.hp + row.heal);
        p.outInvs.add(3214);
        this.events.push({ tick: this.tick, kind: 'consumed', detail: { player: p.name, obj } });
    }

    // ---- 5. PICKPOCKET (opnpc3): pickpocket.dbrow rows + the 8-tick stun --------------------------
    pickpockets = new Map<number, { level: number; expUnits: number; stunTicks: number; stunDamage: number; lootId: number; lootN: number; low: number; high: number }>();
    // man row (pickpocket.dbrow): level 1, exp 80, stun 8t/1dmg, chance 180,240, loot 3gp
    registerPickpocket(npcTypeId: number, row: { level: number; expUnits: number; stunTicks: number; stunDamage: number; lootId: number; lootN: number; low: number; high: number }): void {
        this.pickpockets.set(npcTypeId, row);
    }
    private pickpocket(p: CoopPlayer, npcIndex: number): void {
        const npc = this.npcs.get(npcIndex);
        const row = npc ? this.pickpockets.get(npc.typeId) : undefined;
        if (!npc || !row) return;
        if ((p as CoopPlayer & { stunnedUntil?: number }).stunnedUntil! > this.tick) return;   // stunned: op dropped
        const th = this.stat(p, 17);
        if (th.level < row.level) { p.outPre.push({ kind: 'msg', text: 'Your Thieving level is not high enough.' }); return; }
        if (Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) > 1) return;
        if (this.statRandom(th.level, row.low, row.high)) {
            this.invAdd(p.inv, row.lootId, row.lootN);
            this.advanceStat(p, 17, row.expUnits);
            p.outInvs.add(3214);
            this.events.push({ tick: this.tick, kind: 'pickpocketed', detail: { player: p.name, loot: row.lootN } });
        } else {
            (p as CoopPlayer & { stunnedUntil?: number }).stunnedUntil = this.tick + row.stunTicks;
            p.hp -= row.stunDamage;
            p.outPre.push({ kind: 'msg', text: "You've been stunned!" });
            this.events.push({ tick: this.tick, kind: 'stunned', detail: { player: p.name, hp: p.hp } });
            if (p.hp <= 0) this.killPlayer(p);
        }
    }

    override coopTick(actions: Map<number, ClientAction[]>) {
        // own the event window: continue-loop events (ore-mined, fish-caught) land AFTER the base
        // tick's slice and would otherwise be invisible to the caller
        const before = this.events.length;
        super.coopTick(actions);
        // ⛔ AFTER super, NEVER BEFORE: `coopTick` clears every npc's `teleported` flag at the top, and
        // that flag is what makes the harness tell viewers the spot has moved. See addSpotRoam.
        this.roamSpots();
        this.runLeatherQueues();
        // rock/tree respawns
        for (const r of this.rocks) if (r.depleted && this.tick >= r.respawnAt) r.depleted = false;
        for (const t of this.trees) if (t.depleted && this.tick >= t.respawnAt) t.depleted = false;
        // mining/woodcutting continue (p_oploc chains)
        for (const [idx, st] of this.mineState) {
            const p = this.playersByIndex.get(idx);
            if (!p || !st.rock) continue;
            this.mineSwing(p, st);
        }
        for (const [idx, st] of this.wcState) {
            const p = this.playersByIndex.get(idx);
            if (!p || !st.tree) continue;
            this.chopSwing(p, st);
        }
        // ---- ENGINE-MODEL fishing continues (the p_opnpc repeat) ----------------------------------
        // ⛔ AFTER the packet phase and ONCE per player per tick. `fishRanAt` is what keeps an OPNPC that
        // landed THIS tick from being executed a second time by the interaction that it just installed —
        // in the engine the label runs once per tick, and running it twice would halve every delay.
        for (const [idx, st] of [...this.fishPend]) {
            if (this.fishRanAt.get(idx) === this.tick) continue;
            const p = this.playersByIndex.get(idx);
            const spot = this.npcs.get(st.spotIndex);
            if (!p || !spot) { this.fishPend.delete(idx); continue; }
            // ⭐ THE TELEPORT DEATH, MODELLED. The spots JUMP (fishing_movement.rs2) and an interaction
            // whose npc is no longer adjacent just stops producing — no message, no error. That silent
            // dead time is half of what the prime cadence buys back, because the cadence re-establishes
            // the interaction from scratch every five ticks.
            if (Math.abs(p.x - spot.x) + Math.abs(p.z - spot.z) !== 1) { this.fishPend.delete(idx); continue; }
            if (this.casketBox.has(idx)) continue;   // busy(): an open objbox holds the interaction (it stays queued)
            this.fishLabel(p, st.spotIndex, st.kind, st.hidden);
        }
        this.fishRanAt.clear();
        // fishing continues
        for (const [idx, st] of this.fishState) {
            const p = this.playersByIndex.get(idx);
            const spot = this.npcs.get(st.spotIndex);
            const info = this.fishSpots.get(st.spotIndex);
            if (!p || !spot || !info) continue;
            if (Math.abs(p.x - spot.x) + Math.abs(p.z - spot.z) !== 1) continue;
            if (this.tick - st.lastCatchRoll >= this.fishing.catchEveryTicks) {
                st.lastCatchRoll = this.tick;
                const fs = this.stat(p, STAT_FISHING);
                if (fs.level >= info.level && this.statRandom(fs.level, this.fishing.low, this.fishing.high) && this.freeSlots(p.inv) > 0) {
                    this.invAdd(p.inv, info.fish, 1);
                    this.advanceStat(p, STAT_FISHING, info.expUnits);
                    p.outInvs.add(3214);
                    this.events.push({ tick: this.tick, kind: 'fish-caught', detail: { player: p.name, fish: info.fish } });
                }
            }
        }
        return this.events.slice(before);
    }
}

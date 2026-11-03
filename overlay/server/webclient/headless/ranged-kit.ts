// =====================================================================================================
// RANGED KIT — the bow/arrow pairing rules and the honest cost model for the ranged leg
// =====================================================================================================
// Build support for the RANGED lane (OPERATION-BRIEFING §19). Everything here is DERIVED, at import
// time, from the generated `data/gear.json` (itself extracted from server/content) — there is no
// hand-typed bow or arrow ladder, because the five hand-maintained ladders this repo already carries
// are its stated cautionary precedent.
//
// -----------------------------------------------------------------------------------------------------
// ⭐ THE HEADLINE, AND IT CORRECTS THE BRIEFING
// -----------------------------------------------------------------------------------------------------
// §19 reads "ranged 40/damage ... so ranged is the slowest leg". THE DIRECTION IS INVERTED. `arg` is
// xp granted PER POINT OF DAMAGE, so a HIGHER arg means FEWER damage points are needed, not more:
//
//     combat.rs2:155  ranged accurate/rapid -> stat_advance(ranged, scale(400,100, dmg*10)) = 40/dmg
//     combat.rs2:160  magic normal          -> scale(200,100, ...)                          = 20/dmg
//     combat.rs2:151  melee controlled      -> scale(133,100, ...) x3 stats                 = 13.3/dmg
//
// Level 99 costs 399,383 arg (998,458 displayed xp / the 2.5 displayed-per-arg the wire carries:
// Player.ts:1841 multiplies by xpRate 25, UpdateStatEncoder.ts:11 sends exp/10). So:
//
//     ranged  9,985 damage   <- the CHEAPEST of the three
//     magic  19,969 damage   <- 2x ranged, and it also needs a runecrafting lane
//     melee  30,029 damage   <- but buys att+str+def+hp at once
//
// Ranged is the FASTEST remaining leg, not the slowest. It should still start first, but because it
// finishes almost immediately, not because it is the long pole. Magic is the long pole.
//
// -----------------------------------------------------------------------------------------------------
// ⭐⭐ AND THE CONSEQUENCE: THE RANGED LEG IS A PASSENGER ON THE PRAYER GRIND
// -----------------------------------------------------------------------------------------------------
// 9,985 damage is ~525 kills at an hp-19 al_kharid_warrior, ~734 at an hp-13.6 red-armour goblin. The
// camps already MEASURE 142-217 bones/hr/bot (BRIEFING §6), and a bone is a kill. So ranged 1->99 is
// ~3.4-6.3 hours of camp time per bot — against the ~410 hours the prayer leg needs from the SAME
// kills. `rangedPlan()` below shows the kill loop is SPAWN-bound, not dps-bound, for >99% of the
// climb: a ranged bot at these camps kills at the same cadence a melee bot does, so it buries the same
// bones and prayer does not slow down. The ranged leg costs ~nothing but arrows.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ THE ONE SILENT BRICK IN THIS WHOLE LANE
// -----------------------------------------------------------------------------------------------------
// `player_ranged_check_ammo` (player_ranged.rs2:97-99) refuses the SHOT — not the wear — when
//     oc_param($ammo, levelrequire) > oc_param($rhand, levelrequire)
// So steel arrows (levelrequire 5) in a plain shortbow (levelrequire 1) EQUIP FINE, sit in the quiver,
// and the bot then never fires: `mes("Your bow isn't powerful enough for those arrows.")` and
// `p_stopaction`. It is bounded by the BOW's tier, NOT by the player's ranged level, so a level-70
// archer holding a shortbow still cannot use steel. `canBowFire()` is that rule and nothing in this
// lane may equip ammo without asking it.
// =====================================================================================================

import { loadGear, type GearItem } from './gear-table.js';
import { STYLE_INTERFACE } from './capability-tables.js';

// -----------------------------------------------------------------------------------------------------
// style buttons — READ FROM THE GENERATED TABLE, never retyped
// -----------------------------------------------------------------------------------------------------
// capability-tables.ts is extracted from pack/interface.pack + player_attackstyles.rs2:
//   combat_bow buttons { 0: 1772 accurate, 1: 1771 rapid, 2: 1770 longrange }, styleNames in that order.
const BOW_TAB = 'combat_bow';

export type RangedStyle = 'accurate' | 'rapid' | 'longrange';

/** The com_mode index a named bow style selects, or -1. Sourced from the generated style table. */
export function bowStyleIndex(style: RangedStyle): number {
    return STYLE_INTERFACE[BOW_TAB]?.styleNames.indexOf(style) ?? -1;
}

/** The IF_BUTTON component that selects `style` on the bow tab, or -1 if the table does not know it. */
export function bowStyleButton(style: RangedStyle): number {
    const idx = bowStyleIndex(style);
    if (idx < 0) return -1;
    const com = STYLE_INTERFACE[BOW_TAB]?.buttons[idx];
    return com === undefined ? -1 : com;
}

/**
 * Does this style grant PURE ranged xp?
 *
 * combat.rs2:155 gives accurate AND rapid the full `scale(400,100,$base)` to ranged alone; :157 splits
 * longrange into `scale(200,100,...)` ranged + the same to defence. When defence is already 99,
 * longrange would literally halve the leg for nothing — hence this predicate rather than a comment.
 */
export function isPureRangedStyle(style: RangedStyle): boolean {
    return style === 'accurate' || style === 'rapid';
}

// -----------------------------------------------------------------------------------------------------
// bows + arrows, derived from gear.json
// -----------------------------------------------------------------------------------------------------

/** `oc_param(levelrequire)`; the engine's default is 0 (combat.param:80-82), and absent means 0. */
export const powerTier = (g: GearItem): number => g.levelrequire ?? 0;

/** Every bow in the content, weakest first. `weapon_bow` only — crossbows take bolts, not arrows. */
export const BOWS: GearItem[] = loadGear().items
    .filter(i => i.category === 'weapon_bow')
    .sort((a, b) => powerTier(a) - powerTier(b) || (a.stats.rangeattack ?? 0) - (b.stats.rangeattack ?? 0));

/**
 * Every arrow, weakest first.
 *
 * ⛔ THE `_p` POISON VARIANTS AND THE FIRE-ARROW LINE ARE EXCLUDED. They are all `members=yes` and, more
 * to the point, `next_obj_stage`/`weapon_poisoned` chains that turn into something else — a kit
 * that shipped `bronze_arrow_p` would be paying members prices for a stack whose only difference is a
 * 1/8 poison proc on an npc that dies in four hits anyway.
 */
export const ARROWS: GearItem[] = loadGear().items
    .filter(i => i.category === 'arrows' && /^(bronze|iron|steel|mithril|adamant|rune)_arrow$/.test(i.name))
    .sort((a, b) => powerTier(a) - powerTier(b) || (a.stats.rangebonus ?? 0) - (b.stats.rangebonus ?? 0));

/**
 * ⭐ THE RULE THE WHOLE LANE HANGS ON — player_ranged.rs2:97-99.
 *
 * Note what it is NOT keyed on: the player's ranged level. A bot with 99 ranged holding a plain shortbow
 * still cannot fire steel arrows, and the failure is a per-swing `p_stopaction` with a chat line the
 * headless client does not read as an error. Always ask before equipping.
 */
export function canBowFire(bow: GearItem | undefined, arrow: GearItem | undefined): boolean {
    if (!bow || !arrow) return false;
    if (bow.category !== 'weapon_bow') return false;      // crossbows want `bolts`, not `arrows`
    if (arrow.category !== 'arrows') return false;
    return powerTier(arrow) <= powerTier(bow);
}

export interface KitContext {
    /** the bot's CURRENT ranged level (statLevel[4]); gates which bows it may wield at all */
    rangedLevel: number;
    /** WorldConfig.ts:100 is `members: true`, but a bare local engine is not — and on a free world
     *  combat.rs2:16 silently maps a members weapon to `weapon_unarmed_table`, i.e. no ranged row. */
    members: boolean;
}

/** Can this bot wield `bow` right now? levelrequire.rs2:38-44 checks `stat_base(ranged)`. */
export function canWieldBow(bow: GearItem, ctx: KitContext): boolean {
    if (bow.members && !ctx.members) return false;
    return ctx.rangedLevel >= (bow.gate?.ranged ?? 0);
}

/**
 * The best bow from `held` this bot may wield, or undefined.
 *
 * "Best" is by power tier, which is also the arrow tiers it unlocks. Deliberately NOT by rangeattack:
 * accuracy saturates against these camps' defence-1-to-4 npcs long before it matters, whereas the tier
 * decides whether the ammo we ship can be fired at all.
 */
export function bestBowFrom(held: Iterable<number>, ctx: KitContext): GearItem | undefined {
    let best: GearItem | undefined;
    for (const id of held) {
        const bow = BOWS.find(b => b.id === id);
        if (!bow || !canWieldBow(bow, ctx)) continue;
        if (!best || powerTier(bow) > powerTier(best)) best = bow;
    }
    return best;
}

/**
 * The best arrow from `held` that `bow` can actually fire, or undefined.
 *
 * ⛔ RETURNING undefined WHEN THE BOT IS HOLDING THOUSANDS OF ARROWS IS A REAL, EXPECTED ANSWER — it is
 * the steel-in-a-shortbow case. The caller must treat it as "no usable ammo" and say so, not as "no
 * ammo delivered", because those two need opposite fixes (ship a better bow vs ship more arrows).
 */
export function bestArrowFrom(held: Iterable<number>, bow: GearItem | undefined, ctx: KitContext): GearItem | undefined {
    if (!bow) return undefined;
    let best: GearItem | undefined;
    for (const id of held) {
        const arrow = ARROWS.find(a => a.id === id);
        if (!arrow) continue;
        if (arrow.members && !ctx.members) continue;
        if (!canBowFire(bow, arrow)) continue;
        if (!best || (arrow.stats.rangebonus ?? 0) > (best.stats.rangebonus ?? 0)) best = arrow;
    }
    return best;
}

export function arrowsUsableWith(bow: GearItem | undefined, ctx: KitContext): GearItem[] {
    if (!bow) return [];
    return ARROWS.filter(a => canBowFire(bow, a) && (!a.members || ctx.members));
}

// -----------------------------------------------------------------------------------------------------
// the cost model
// -----------------------------------------------------------------------------------------------------
// Every formula below is the engine's, cited inline. This is an EXPECTED-VALUE model: it uses mean
// damage per swing rather than sampling randominc, so it answers "how many kills / how many arrows",
// not "what does one run look like". Variance is irrelevant at 500+ kills.

/** Player.ts:77-85 — the FLATTENED curve, 2^(L/10) not 2^(L/7). Rebuilt here, not copied. */
const LEVEL_XP = (() => {
    const t = new Int32Array(99);
    let acc = 0;
    for (let i = 0; i < 99; i++) { acc += Math.floor(i + 1 + Math.pow(2, (i + 1) / 10) * 300); t[i] = Math.floor(acc / 4) * 10; }
    return t;
})();
/** DISPLAYED xp (what the wire carries) needed for `level`. Level 99 = 998,458. */
export function displayedXpForLevel(level: number): number {
    if (level <= 1) return 0;
    return LEVEL_XP[Math.min(99, level) - 2]! / 10;
}
export function levelForDisplayedXp(displayed: number): number {
    const internal = displayed * 10;
    for (let i = 98; i >= 0; i--) if (internal >= LEVEL_XP[i]!) return Math.min(i + 2, 99);
    return 1;
}
/** Player.ts:1841 `stats[stat] += xp * xpRate` (25), UpdateStatEncoder.ts:11 sends `exp/10`. */
export const DISPLAYED_XP_PER_ARG = 25 / 10;
/** combat.rs2:155 — `scale(400,100, $damage*10)`. */
export const RANGED_ARG_PER_DAMAGE = 40;

/** combat.rs2:8 `(combat_stat + 320) / 640`, combat.rs2:12 `effective * (bonus + 64)`. */
export function rangedMaxHit(effectiveRanged: number, rangebonus: number): number {
    return Math.floor((effectiveRanged * (rangebonus + 64) + 320) / 640);
}
/**
 * player_combat.rs2:58 `randominc($attack_roll) > randominc($defence_roll)`, both inclusive 0..n, so
 * P(A > D) has a closed form. NumberOps.ts:37 is the randominc opcode.
 */
export function hitChance(attackRoll: number, defenceRoll: number): number {
    const na = attackRoll + 1, nd = defenceRoll + 1;
    if (na <= 0 || nd <= 0) return 0;
    if (attackRoll >= defenceRoll) return (na * nd - (nd * (nd + 1)) / 2) / (na * nd);
    return ((na * (na - 1)) / 2) / (na * nd);
}
/** player_combat_stat.rs2:74 — effective = level + 8 + the style's invisible bonus (combat.rs2:55-57). */
export function effectiveRanged(level: number, style: RangedStyle): number {
    return level + 8 + (style === 'accurate' ? 3 : 0);
}
/** player_ranged.rs2:20-24 — the weapon's attackrate, minus one tick on rapid. */
export function swingTicks(bow: GearItem, style: RangedStyle): number {
    return Math.max(1, (bow.attackrate > 0 ? bow.attackrate : 4) - (style === 'rapid' ? 1 : 0));
}

export interface CampTarget {
    name: string;
    /** the npc's hitpoints — damage needed per kill */
    hp: number;
    /** npc defence LEVEL and its `rangedefence` bonus, for the accuracy roll */
    defenceLevel: number;
    rangeDefence: number;
    /**
     * The camp's MEASURED melee kills/hr/bot (BRIEFING §6 = its bones/hr/bot). At melee 99 the npc dies
     * in one or two swings, so essentially all of that interval is respawn + walk — i.e. the per-kill
     * budget a ranged bot at the same seat also pays. It is the ceiling this model checks dps against.
     */
    measuredKillsPerHour: number;
}

export interface RangedPlan {
    hours: number;
    kills: number;
    swings: number;
    damage: number;
    /** 1 arrow leaves the quiver per SWING, hit or miss (player_ranged.rs2:68 is outside the hit `if`). */
    arrowsGross: number;
    /** ranged_dropammo_npc: `random(5) != 0` drops it on npc_coord; the other 1/5 is `inv_del`'d. */
    arrowsDestroyed: number;
    /** kills whose time-to-kill exceeded the camp's spawn budget — where ranged genuinely IS slower */
    dpsBoundKills: number;
    /** true when the loop is limited by respawns, not by our damage, for >=99% of kills */
    spawnBound: boolean;
}

/** ranged_dropammo_npc (player_ranged.rs2:123-134) with ^dropammo_chance = 5 (combat.constant:4). */
export const AMMO_GROUND_RECOVERY = 4 / 5;

/**
 * Simulate ranged `fromLevel` -> `toLevel` at one camp target, in expectation.
 *
 * ⛔ THE PER-KILL max() IS LOAD-BEARING AND WAS THE FIRST VERSION'S BUG. Taking `max(totalDpsTicks,
 * totalSpawnTicks)` at the END hides the opening levels, which really are dps-bound: at ranged 1 a bot
 * needs ~80 swings to drop an hp-19 warrior. Charging `max()` PER KILL keeps that visible — and it is
 * what shows the early phase is only one or two kills long, because the flat curve makes level 2 cost
 * 80 displayed xp, i.e. a SINGLE point of damage.
 */
export function rangedPlan(
    npc: CampTarget, bow: GearItem, arrow: GearItem, style: RangedStyle,
    opts: { fromLevel?: number; toLevel?: number; dutyFraction?: number; ticksPerHour?: number } = {},
): RangedPlan {
    const from = opts.fromLevel ?? 1, to = opts.toLevel ?? 99;
    const duty = opts.dutyFraction ?? 1;
    // Tick-length independent by construction: the spawn budget is derived from a MEASURED kills/hr, and
    // ticksPerHour only converts our own swing counts. 400ms is Environment.ts:46's NODE_TICKRATE default.
    const ticksPerHour = opts.ticksPerHour ?? 3600 / 0.4;
    if (!canBowFire(bow, arrow)) throw new Error(`${bow.name} cannot fire ${arrow.name} (player_ranged.rs2:97)`);

    const perSwing = swingTicks(bow, style);
    const spawnTicksPerKill = ticksPerHour / npc.measuredKillsPerHour;
    const defRoll = (npc.defenceLevel + 8) * (npc.rangeDefence + 64);

    let displayed = displayedXpForLevel(from);
    let ticks = 0, swings = 0, kills = 0, damage = 0, dpsBoundKills = 0;
    let hpLeft = npc.hp, killTicks = 0;
    for (let guard = 0; levelForDisplayedXp(displayed) < to; guard++) {
        if (guard > 5_000_000) throw new Error('rangedPlan did not converge — check the target is killable');
        const lv = levelForDisplayedXp(displayed);
        const eff = effectiveRanged(lv, style);
        const mh = rangedMaxHit(eff, arrow.stats.rangebonus ?? 0);
        const p = hitChance(eff * ((bow.stats.rangeattack ?? 0) + 64), defRoll);
        // randominc(maxhit) is inclusive 0..maxhit, so the mean of a LANDED hit is maxhit/2. Capped by the
        // npc's remaining hp because combat.rs2:53 awards on `min($damage, npc_stat(hitpoints))`.
        const expected = Math.min(p * (mh / 2), hpLeft);
        if (expected <= 1e-9) throw new Error(`${bow.name}+${arrow.name} cannot hurt ${npc.name} at ranged ${lv}`);
        swings++; killTicks += perSwing; hpLeft -= expected; damage += expected;
        displayed += expected * RANGED_ARG_PER_DAMAGE * DISPLAYED_XP_PER_ARG;
        if (hpLeft <= 1e-9) {
            kills++; hpLeft = npc.hp;
            if (killTicks > spawnTicksPerKill) dpsBoundKills++;
            ticks += Math.max(killTicks, spawnTicksPerKill);
            killTicks = 0;
        }
    }
    return {
        hours: ticks / ticksPerHour / duty,
        kills, swings, damage,
        arrowsGross: swings,
        arrowsDestroyed: swings * (1 - AMMO_GROUND_RECOVERY),
        dpsBoundKills,
        spawnBound: dpsBoundKills <= kills * 0.01,
    };
}

/**
 * The camps this plan targets, with the rates BRIEFING §6 measured. Kept here so the plan can
 * be re-run against a real seat rather than a hypothetical one.
 */
export const CAMP_TARGETS: Record<string, CampTarget> = {
    // alkharid.npc: al_kharid_warrior hp 19, defence 4, no rangedefence param (default 0)
    al_kharid_warrior: { name: 'al_kharid_warrior', hp: 19, defenceLevel: 4, rangeDefence: 0, measuredKillsPerHour: 142 },
    // goblin-redarmour-goblin-village, §6's table: hp 13.6 effective, defence 1
    goblin_redarmour: { name: 'goblin_redarmour', hp: 13.6, defenceLevel: 1, rangeDefence: 0, measuredKillsPerHour: 217 },
    // giantrat-palace-dungeon — the best camp found, 361 bones/hr/bot
    giant_rat: { name: 'giant_rat', hp: 7.5, defenceLevel: 1, rangeDefence: 0, measuredKillsPerHour: 361 },
    // train200-223's 14 small camps: chickens/cows/rats, ~197 bones/hr/bot
    small_camp: { name: 'small_camp', hp: 8, defenceLevel: 1, rangeDefence: -21, measuredKillsPerHour: 197 },
};

export const byName = (n: string): GearItem => {
    const g = loadGear().items.find(i => i.name === n);
    if (!g) throw new Error(`no gear row named ${n}`);
    return g;
};

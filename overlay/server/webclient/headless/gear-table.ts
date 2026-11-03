// =====================================================================================================
// GEAR TABLE — loader, validator and the upgrade-comparison logic for headless/data/gear.json
// =====================================================================================================
// The JSON is EXTRACTED, never hand-edited: `bun headless/data/extract-gear.mjs` regenerates it from
// server/content (obj configs, the 341 levelrequire wear gates, the combat style dbrow, obj.pack).
// Provenance for every field is echoed into gear.json's `provenance` block.
//
// This module makes the data SAFE and USEFUL to consume:
//   - loadGear()          parse + validate; throws at import, not mid-run
//   - gearFor(id)        O(1) lookup
//   - canWear(item, ctx)  every reason a wear can fail, INCLUDING the silent ones
//   - upgradeDelta(...)   is this drop actually better than what is worn, for the style in use?
//
// ⛔ THE THREE WAYS A WEAR SILENTLY DOES NOTHING (all three cost a live run if you learn them the hard way):
//  1. NO `iop2`. OpHeldHandler.ts:46 returns false with NO message. 23 wearables have no iop2 at all.
//  2. MEMBERS OBJ ON A FREE WORLD. ObjType.ts:59-73 strips iop, sets category=-1 and DELETES every
//     combat param, so the item is both unwearable AND reads as zero-stat. No message either.
//  3. A QUEST LOCK. 12 objs (rune platebody and friends) check a varp; the bot CAN see this one, as two
//     mes() lines, but it must not mistake it for a level gate — the level will never become high enough.
// A level gate, by contrast, is worth retrying later: it clears as the bot trains. So `canWear` reports
// WHY, and the caller retries only the reason that can change.
// =====================================================================================================

import RAW from './data/gear.json';

// -----------------------------------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------------------------------

/** Worn-inventory (com 1688) slot index == the obj's `wearpos` id (equip.rs2:344,364). */
export type WearSlot = number;

export interface GearGate {
    handler: string;
    attack?: number;
    defence?: number;
    strength?: number;
    ranged?: number;
    magic?: number;
    /** varp name (e.g. "dragonquest") — a permanent block for a bot that cannot quest. */
    quest?: string;
    /** an unconditional refusal handler (tutorial_island_equip). */
    blocked?: string;
    /** the extractor could not resolve the handler; attempt + rely on the wear-fail self-heal. */
    unknownHandler?: boolean;
}

export interface GearStyle {
    table: string;
    damagestyle: string[];
    damagetype: string[];
    /** attack param scored for com_mode i. weapon_slash CONTROLLED (i=2) is STABATTACK, not slash. */
    attackParam: (string | null)[];
}

export interface GearItem {
    id: number;
    name: string;
    slot: WearSlot;
    wearpos: string;
    slot2?: WearSlot;
    slot3?: WearSlot;
    members?: true;
    iop2: string | null;
    category: string | null;
    cost?: number;
    attackrate: number;
    /**
     * `oc_param(levelrequire)` straight off the .obj — NOT the same thing as `gate`, and the difference
     * is a silent brick. `gate` is the [opheld2] WEAR gate from tier*.rs2; arrows have no such entry
     * (they fall through equip.rs2:1's catch-all) so their `gate` is null and they equip at any level.
     * The gate that does bind them is per-SWING: player_ranged.rs2:97-99 refuses to fire when
     * `oc_param(ammo, levelrequire) > oc_param(rhand, levelrequire)`. Absent = the engine's default 0.
     */
    levelrequire?: number;
    gate: GearGate | null;
    style: GearStyle | null;
    stats: Record<string, number>;
}

export interface GearTable {
    provenance: { generatedBy: string; generatedAt: string; sources: Record<string, string>; notes: string[] };
    counts: Record<string, number>;
    wearposToSlot: Record<string, number>;
    items: GearItem[];
}

// -----------------------------------------------------------------------------------------------------
// load + validate
// -----------------------------------------------------------------------------------------------------

export function validateGearTable(t: GearTable): string[] {
    const errs: string[] = [];
    if (!t.items?.length) errs.push('no items');
    const seen = new Set<number>();
    for (const it of t.items ?? []) {
        if (!Number.isInteger(it.id) || it.id < 0) errs.push(`bad id ${it.id} (${it.name})`);
        if (seen.has(it.id)) errs.push(`duplicate id ${it.id} (${it.name})`);
        seen.add(it.id);
        if (!Number.isInteger(it.slot) || it.slot < 0 || it.slot > 13) errs.push(`${it.name}: slot ${it.slot} outside the 14-slot worn inv`);
        if (it.style && it.style.damagetype.length !== it.style.attackParam.length) errs.push(`${it.name}: style arrays disagree`);
        for (const [k, v] of Object.entries(it.stats ?? {})) if (!Number.isFinite(v)) errs.push(`${it.name}: stat ${k} is not finite`);
    }
    // The generated table must still contain the facts the hand-written ladders encoded, or a regeneration
    // has silently lost something. These four are the ones prior live runs paid for.
    const by = new Map(t.items.map(i => [i.id, i]));
    const scim = by.get(1321);
    if (!scim?.style || scim.style.attackParam[2] !== 'stabattack') errs.push('bronze_scimitar controlled must score on stabattack (combat.dbrow weapon_slash_table)');
    const runePlate = by.get(1127);
    if (!runePlate?.gate?.quest) errs.push('rune_platebody must carry its Dragon Slayer quest lock (tier40.rs2:26)');
    if (runePlate?.gate && runePlate.gate.defence !== 40) errs.push('rune_platebody must ALSO carry defence 40');
    const runeChain = by.get(1113);
    if (runeChain?.gate?.quest) errs.push('rune_chainbody must NOT be quest-locked (it is the wearable rune body)');
    return errs;
}

let CACHE: GearTable | null = null;
export function loadGear(): GearTable {
    if (CACHE) return CACHE;
    const t = RAW as unknown as GearTable;
    const errs = validateGearTable(t);
    if (errs.length) throw new Error(`gear.json is invalid (regenerate with extract-gear.mjs):\n  ${errs.join('\n  ')}`);
    CACHE = t;
    return t;
}

let BY_ID: Map<number, GearItem> | null = null;
export function gearFor(id: number): GearItem | undefined {
    if (!BY_ID) BY_ID = new Map(loadGear().items.map(i => [i.id, i]));
    return BY_ID.get(id);
}
/** True if this obj id is wearable at all (i.e. present in the table). */
export function isWearable(id: number): boolean { return gearFor(id) !== undefined; }

// -----------------------------------------------------------------------------------------------------
// can we wear it?
// -----------------------------------------------------------------------------------------------------

export interface WearContext {
    /** base levels by skill name, e.g. {attack: 60, defence: 22, strength: 34}. */
    levels: Record<string, number>;
    /** is this a members world? The demo is (fly.toml NODE_MEMBERS=true); a bare local engine is not. */
    members: boolean;
}
export type WearVerdict =
    | { ok: true }
    | { ok: false; reason: 'no-iop2' | 'members' | 'quest' | 'blocked'; retryable: false; detail: string }
    | { ok: false; reason: 'level'; retryable: true; detail: string; needs: Record<string, number> };

export function canWear(item: GearItem, ctx: WearContext): WearVerdict {
    // 1. silently-undroppable cases first — these never become true, so never retry them
    if (!item.iop2) return { ok: false, reason: 'no-iop2', retryable: false, detail: `${item.name} has no iop2; OPHELD2 is dropped with no message` };
    if (item.members && !ctx.members) return { ok: false, reason: 'members', retryable: false, detail: `${item.name} is members and this world is free; iop/params are stripped (ObjType.ts:59-73)` };
    const g = item.gate;
    if (g?.blocked) return { ok: false, reason: 'blocked', retryable: false, detail: `${item.name} gated by @${g.blocked}` };
    if (g?.quest) return { ok: false, reason: 'quest', retryable: false, detail: `${item.name} needs quest %${g.quest}` };
    // 2. the one gate that CAN clear with training
    if (g) {
        const needs: Record<string, number> = {};
        for (const stat of ['attack', 'defence', 'strength', 'ranged', 'magic'] as const) {
            const req = g[stat];
            if (req !== undefined && (ctx.levels[stat] ?? 1) < req) needs[stat] = req;
        }
        if (Object.keys(needs).length) {
            return { ok: false, reason: 'level', retryable: true, needs, detail: `${item.name} needs ${Object.entries(needs).map(([s, n]) => `${s} ${n}`).join(', ')}` };
        }
    }
    return { ok: true };
}

// -----------------------------------------------------------------------------------------------------
// is it an upgrade?
// -----------------------------------------------------------------------------------------------------

/** The defence param an incoming attack of `damagetype` is reduced by (equip.rs2:238-249 sums these). */
export const DEFENCE_PARAM_FOR: Record<string, string> = {
    stab_style: 'stabdefence', slash_style: 'slashdefence', crush_style: 'crushdefence',
    ranged_style: 'rangedefence', magic_style: 'magicdefence',
};

/**
 * The com_mode index whose damagestyle is CONTROLLED for this weapon's class, or -1 if the class has none.
 *
 * ⛔ READ THIS BEFORE TOUCHING WEAPON SELECTION. Only 5 of the 15 style tables have a controlled row, and
 * the index is NOT constant:
 *     weapon_slash / claws / spiked -> 2      weapon_polearm -> 0      weapon_spear -> 0,1,2
 *     weapon_stab (DAGGERS), 2h_sword, axe, blunt, pickaxe, scythe, staff, unarmed -> NONE
 * `weapon_stab_table` is [accurate, aggressive, aggressive, defensive]. So "upgrade the bronze scimitar to
 * the iron_dagger the warrior just dropped" — which a raw dps estimate scores as +1.5 BETTER — would silently
 * drop the bot from training att+str+def+hp to training attack alone. That is the single most expensive
 * mistake this feature could make, and it looks like an improvement in every log line.
 */
export function controlledComMode(item: GearItem): number {
    if (!item.style) return -1;
    return item.style.damagestyle.findIndex(s => s.includes('controlled'));
}

/** Score a WEAPON for the style the bot actually uses (comMode = com_mode index). */
export function weaponScore(item: GearItem, comMode: number): number {
    // ⛔ STYLE-AWARE ON PURPOSE. weapon_slash's controlled row scores on stabattack while weapon_stab's
    // controlled row scores on slashattack — the two are INVERTED. Scoring every weapon on slashattack
    // would rank an iron dagger above a bronze scimitar for a controlled-style bot, which silently costs
    // the three-stat training the whole program depends on.
    const param = item.style?.attackParam[comMode] ?? item.style?.attackParam[0] ?? 'slashattack';
    const acc = item.stats[param] ?? 0;
    const str = item.stats.strengthbonus ?? 0;
    // dps estimate from the engine's own formulas: accuracy and max hit both scale on (bonus + 64), and the
    // whole thing is divided by attackrate (combat.rs2:7-12). Constants cancel in a comparison.
    const rate = item.attackrate > 0 ? item.attackrate : 4;
    return ((acc + 64) * (str + 64)) / rate;
}

/** Score ARMOUR against the damage type we are actually being hit by. */
export function armourScore(item: GearItem, incoming: string): number {
    const key = DEFENCE_PARAM_FOR[incoming] ?? 'crushdefence';
    // weight the targeted defence, but count the others so a strictly-better piece never reads as equal
    const primary = item.stats[key] ?? 0;
    const others = ['stabdefence', 'slashdefence', 'crushdefence'].filter(k => k !== key)
        .reduce((a, k) => a + (item.stats[k] ?? 0), 0);
    return primary * 4 + others;
}

// -----------------------------------------------------------------------------------------------------
// WHICH WORN SLOTS AN OBJ CLAIMS — the TWO-HANDED rule
// -----------------------------------------------------------------------------------------------------
// ⛔ THIS IS WHAT AN INFINITE EQUIP LOOP IS MADE OF, AND IT COST A LIVE CHAMPION ITS WHOLE SHIFT.
// equip.rs2:434-447 (`proc,wearpos_conflicts`) unequips ANY worn obj that shares ANY of the incoming
// obj's THREE wearpos fields. A shortbow declares `wearpos=righthand` AND `wearpos2=lefthand`
// (server/content/scripts/skill_combat/configs/ranged/bows.obj:30) — so wielding it strips the shield,
// and wearing the shield strips it back. A SLOT-BY-SLOT comparator sees an empty shield slot, equips a
// shield, sees an empty weapon slot, equips the bow, forever: 2,971 of 4,000 log lines were this thrash
// (logs/koth-champion4.log), the bot earned nothing, and half the time it stood on the hill UNARMED.
//
// The fix is not a special case for bows. It is to price a wear as a WHOLE LOADOUT: what the candidate
// adds MINUS what it knocks off. See `loadoutDelta`.
export const WEAPON_SLOT = 3;   // righthand
export const SHIELD_SLOT = 5;   // lefthand
/** where ammo lives; the only inv `player_ranged_check_ammo` reads. Was private to rangedbot.ts. */
export const QUIVER_SLOT = 13;

/** Every worn slot this obj claims — wearpos, wearpos2, wearpos3 (ObjType.ts:211-229). */
export function wearSlots(item: GearItem): WearSlot[] {
    const out: WearSlot[] = [item.slot];
    if (item.slot2 !== undefined && !out.includes(item.slot2)) out.push(item.slot2);
    if (item.slot3 !== undefined && !out.includes(item.slot3)) out.push(item.slot3);
    return out;
}

/** Would equipping `candidate` force `worn` off? The 3x3 test `proc,wearpos_conflicts` runs, verbatim. */
export function wearposConflicts(candidate: GearItem, worn: GearItem): boolean {
    const theirs = wearSlots(worn);
    return wearSlots(candidate).some(s => theirs.includes(s));
}

/** A TWO-HANDED weapon: a righthand obj that ALSO claims the lefthand (shield) slot. */
export function isTwoHanded(item: GearItem): boolean {
    return item.slot === WEAPON_SLOT && wearSlots(item).includes(SHIELD_SLOT);
}

/**
 * Weapon categories that CANNOT SWING AT ALL without separate ammo loaded in the quiver.
 *
 * ⛔ A BOW WITH NO ARROWS IS NOT A WEAK WEAPON, IT IS NO WEAPON. player_ranged.rs2 refuses the swing
 * outright, so a bot holding one deals ZERO damage — strictly worse than bare fists, which at least use
 * `weapon_unarmed_table`. Thrown weapons and javelins ARE their own ammo (slot 3, no quiver row), so
 * they are deliberately absent from this map.
 */
export const AMMO_CATEGORY_FOR: Readonly<Record<string, string>> = { weapon_bow: 'arrows', weapon_crossbow: 'bolts' };
/** The quiver category `item` must be fed, or undefined when it needs no ammo. */
export function ammoCategoryFor(item: GearItem): string | undefined {
    return item.slot === WEAPON_SLOT ? AMMO_CATEGORY_FOR[item.category ?? ''] : undefined;
}

export interface UpgradeCtx extends WearContext {
    /** com_mode currently set (2 = controlled on a slash weapon). */
    comMode: number;
    /** the damagetype the camp's npcs attack with, e.g. 'crush_style'. */
    incoming: string;
    /**
     * Weapon class the bot's style BUTTON belongs to (e.g. 'weapon_slash'). A weapon from another class
     * opens a DIFFERENT combat interface with different component ids, so the configured styleButton
     * (combat_hacksword:hack2 = 2431 for slash) would no longer select controlled. Set this and weapon
     * swaps stay inside the class whose button we know; leave it null to allow any class.
     */
    weaponClass?: string | null;
    /** true when the bot must keep a CONTROLLED style (the max-stats trainer). */
    requireControlled?: boolean;
    /**
     * Can this weapon actually be SWUNG right now? Supplied by the bot, because only the bot can see its
     * own quiver and backpack (see `AMMO_CATEGORY_FOR`). Leave it undefined and every weapon is assumed
     * usable, which is the old behaviour byte for byte.
     *
     * ⛔ IT IS ASKED OF THE WORN WEAPON TOO, not just of candidates. A bot that is ALREADY holding an
     * arrowless bow must score it at ZERO, or the bow it cannot fire blocks the scimitar in its pack
     * from ever being wielded — which is the same "alive and earning nothing" shape by another road.
     */
    usableWeapon?: (item: GearItem) => boolean;
}

/** Why a weapon candidate was rejected — surfaced so a log can explain a refusal instead of going quiet. */
export type WeaponReject = 'not-wearable' | 'wrong-class' | 'no-controlled' | 'unusable' | 'not-better' | null;

/** What a WORN weapon is actually delivering. Zero for one that cannot swing (a bow with no arrows). */
function wornWeaponScore(worn: GearItem | undefined, ctx: UpgradeCtx): number {
    if (!worn) return 0;
    if (ctx.usableWeapon && !ctx.usableWeapon(worn)) return 0;
    return weaponScore(worn, ctx.requireControlled ? Math.max(0, controlledComMode(worn)) : ctx.comMode);
}

export function weaponRejectReason(candidate: GearItem, worn: GearItem | undefined, ctx: UpgradeCtx): WeaponReject {
    if (!canWear(candidate, ctx).ok) return 'not-wearable';
    if (ctx.weaponClass && candidate.category !== ctx.weaponClass) return 'wrong-class';
    if (ctx.requireControlled && controlledComMode(candidate) < 0) return 'no-controlled';
    if (ctx.usableWeapon && !ctx.usableWeapon(candidate)) return 'unusable';
    const mode = ctx.requireControlled ? controlledComMode(candidate) : ctx.comMode;
    const mine = wornWeaponScore(worn, ctx);
    return weaponScore(candidate, mode) - mine > 0 ? null : 'not-better';
}

/**
 * Positive if `candidate` beats `worn` in its slot. `worn` may be undefined (empty slot).
 * Returns 0 when it is not wearable, not better, or would cost us the controlled style.
 */
export function upgradeDelta(candidate: GearItem, worn: GearItem | undefined, ctx: UpgradeCtx): number {
    if (!canWear(candidate, ctx).ok) return 0;
    if (candidate.slot === WEAPON_SLOT) {
        if (weaponRejectReason(candidate, worn, ctx) !== null) return 0;
        const mode = ctx.requireControlled ? controlledComMode(candidate) : ctx.comMode;
        return weaponScore(candidate, mode) - wornWeaponScore(worn, ctx);
    }
    const mine = worn ? armourScore(worn, ctx.incoming) : 0;
    return armourScore(candidate, ctx.incoming) - mine;
}

/** What a worn obj is worth where it sits, in the units its own slot is scored in. */
function slotValue(item: GearItem, ctx: UpgradeCtx): number {
    return item.slot === WEAPON_SLOT ? wornWeaponScore(item, ctx) : armourScore(item, ctx.incoming);
}

/**
 * ⭐ THE WHOLE-LOADOUT VERDICT — `upgradeDelta` MINUS everything the wear knocks off.
 *
 * `upgradeDelta` answers a SLOT question, and for a two-handed weapon that question has no honest
 * answer: the bow beats an empty righthand and the shield beats an empty lefthand, both are true at the
 * same moment, and a chooser that believes both alternates between them until the process is killed.
 * This prices the trade the engine will actually make (`wearpos_conflicts`, equip.rs2:434), so
 * "2H weapon" and "1H weapon + shield" are compared as the alternative LOADOUTS they are.
 *
 * `worn` is the FULL worn set keyed by each obj's own primary slot — i.e. LeanBot's `wornGear()`. A
 * two-handed weapon therefore appears once, under slot 3, and its claim on slot 5 is read from its
 * `wearpos2` rather than from a second map entry.
 *
 * ⚠ THE UNITS ARE UNCHANGED AND STILL MIXED (weapon scores run ~1000s, armour ~tens), exactly as
 * `tryEquipGear` has always compared them. That bias is deliberate here: a real weapon outranks a
 * shield, and the ONLY reason the shield ever wins is `usableWeapon` scoring an unfirable bow at zero.
 */
export function loadoutDelta(candidate: GearItem, worn: ReadonlyMap<WearSlot, GearItem>, ctx: UpgradeCtx): number {
    const gain = upgradeDelta(candidate, worn.get(candidate.slot), ctx);
    if (gain <= 0) return 0;
    let displaced = 0;
    for (const [slot, it] of worn) {
        if (slot === candidate.slot) continue;      // already priced, as the slot's incumbent
        if (!wearposConflicts(candidate, it)) continue;
        displaced += slotValue(it, ctx);
    }
    const net = gain - displaced;
    return net > 0 ? net : 0;
}

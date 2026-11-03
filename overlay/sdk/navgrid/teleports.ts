// TELEPORT EDGES for the multi-level planner (levels.ts planMultiLevel). A teleport is an edge usable
// from (almost) ANY tile, gated by a requirement the BOT must satisfy (magic level + runes/staff, a
// charged jewellery item in the pack, a quest), landing in a fixed area (+ the script's scatter).
//
// EVERY ROW BELOW IS READ FROM THE CONTENT SCRIPTS of this revision — nothing is from memory of a later
// game. Sources (server/content/scripts/...):
//   skill_magic/scripts/spells/teleport.rs2
//     :1-7    [if_button,magic:<x>_teleport] @magic_teleport(^<x>_teleport)  — the cast is an IF_BUTTON
//     :14     ~check_spell_requirements (magic.rs2:12-51): members world, stat(magic) >= levelrequired,
//             inv_total(inv, rune) >= count per rune AFTER ~staff_runes removed the staff's element
//     :17-21  wilderness level > 20 -> "A mysterious force blocks your teleport spell!" (no cast)
//     :22-38  Ardougne needs %elenaquest >= ^elena_complete_read_scroll (30), Watchtower needs
//             %itwatchtower >= ^itwatchtower_complete_read_scroll (14), Trollheim %eadgar_quest >= 110
//     :39     ~pre_tele_checks (tutorial island, trawler, mime/maze random events, DUEL ARENA)
//     :51     map_findsquare(tele_coord, 0, 2, lineofwalk) — "Always a radius of 2" scatter
//     :54-62  player_teleport_normal: anim, p_delay(2), p_telejump  -> lands ~3 ticks after the click
//   skill_magic/configs/magic_spells.dbrow:62-123   levelrequired / runesrequired / tele_coord per spell
//   skill_magic/configs/magic_staff.dbrow:1-31      staff -> element (worn in wearpos_rhand only, magic.rs2:63)
//   general/scripts/enchanted_jewellry/amulet_of_glory.rs2:1-35   opheld4 Rub, p_choice5, wildy > 30 blocks,
//             EXACT coords (no map_findsquare), amulet_of_glory_4..1 -> next stage, plain amulet = "lost its charge"
//   general/scripts/enchanted_jewellry/ring_of_dueling.rs2:1-31     opheld4 Rub, p_choice2, wildy > 20, scatter 2
//   general/scripts/enchanted_jewellry/necklace_of_minigames.rs2:1-29  opheld4 Rub, p_choice2, wildy > 20, scatter 2
// UNDERGROUND / UPPER FLOORS: none of these scripts checks the plane or the z+6400 underground, so a
// teleport is castable from a dungeon or an upper floor (the caller can forbid it: `fromUnderground:false`).
// Coord decode: level_mx_mz_lx_lz -> x = mx*64+lx, z = mz*64+lz.
//
// Obj/component ids: server/content/pack/obj.pack + interface.pack (1164=magic:varrock_teleport, ...).

export interface TeleCoord { level: number; x: number; z: number }

export interface TeleportDef {
    id: string;                       // stable key (used for the session deny-list)
    label: string;
    kind: 'spell' | 'item';
    landing: TeleCoord;               // script's centre tile
    scatter: number;                  // map_findsquare radius (0 = exact)
    maxWildy: number;                 // castable while wilderness level <= this
    members: boolean;
    // spell
    magicLevel?: number;
    runes?: Array<{ obj: number; count: number }>;
    spellCom?: number;                // IF_BUTTON component (magic:<x>_teleport)
    quest?: QuestKey;                 // quest gate (varps are NOT transmitted -> the caller declares it)
    // item (OPHELD4 "Rub" from the BACKPACK — opheld only, a worn item has no rub op in this revision)
    items?: number[];                 // any of these obj ids (charged stages)
    choice?: string;                  // dialog option label to click (p_choiceN_header)
    itemOp?: number;                  // OPHELD op (default 4 "Rub"; the enchanted lyre is iop1 "Play")
    source: string;                   // content ref
}

export type QuestKey = 'plague_city' | 'watchtower' | 'eadgars_ruse';

// obj ids (obj.pack)
export const RUNE = { fire: 554, water: 555, air: 556, earth: 557, mind: 558, body: 559, death: 560, nature: 561, chaos: 562, law: 563, cosmic: 564, blood: 565, soul: 566 } as const;
const R = RUNE;

/** magic_staff.dbrow: staff obj -> runes it substitutes (only when WIELDED in the right hand). */
export const STAFF_RUNES: ReadonlyMap<number, readonly number[]> = new Map<number, number[]>([
    [1381, [R.air]], [1397, [R.air]], [1405, [R.air]],            // staff_of_air, air_battlestaff, mystic_air_staff
    [1383, [R.water]], [1395, [R.water]], [1403, [R.water]],      // staff_of_water, water_battlestaff, mystic_water_staff
    [1385, [R.earth]], [1399, [R.earth]], [1407, [R.earth]],      // staff_of_earth, earth_battlestaff, mystic_earth_staff
    [1387, [R.fire]], [1393, [R.fire]], [1401, [R.fire]],         // staff_of_fire, fire_battlestaff, mystic_fire_staff
    [3053, [R.earth, R.fire]], [3054, [R.earth, R.fire]],         // lava_battlestaff, mystic_lava_staff
]);

export const GLORY_CHARGED = [1712, 1710, 1708, 1706];            // amulet_of_glory_4..1 (1704 = uncharged)
export const DUELING_RINGS = [2552, 2554, 2556, 2558, 2560, 2562, 2564, 2566];   // ring_of_dueling_8..1
export const GAMES_NECKLACES = [3853, 3855, 3857, 3859, 3861, 3863, 3865, 3867];  // necklace_of_minigames_8..1

const SPELL_SRC = 'skill_magic/scripts/spells/teleport.rs2 + configs/magic_spells.dbrow';
export const TELEPORTS: readonly TeleportDef[] = [
    // ---- standard spellbook (magic_spells.dbrow:62-123; tele_coord decoded) ----
    { id: 'varrock', label: 'Varrock teleport', kind: 'spell', magicLevel: 25, members: false, spellCom: 1164,
      runes: [{ obj: R.fire, count: 1 }, { obj: R.air, count: 3 }, { obj: R.law, count: 1 }],
      landing: { level: 0, x: 3213, z: 3424 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:62-69 (0_50_53_13_32)` },
    { id: 'lumbridge', label: 'Lumbridge teleport', kind: 'spell', magicLevel: 31, members: false, spellCom: 1167,
      runes: [{ obj: R.earth, count: 1 }, { obj: R.air, count: 3 }, { obj: R.law, count: 1 }],
      landing: { level: 0, x: 3221, z: 3218 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:71-78 (0_50_50_21_18)` },
    { id: 'falador', label: 'Falador teleport', kind: 'spell', magicLevel: 37, members: false, spellCom: 1170,
      runes: [{ obj: R.water, count: 1 }, { obj: R.air, count: 3 }, { obj: R.law, count: 1 }],
      landing: { level: 0, x: 2965, z: 3378 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:80-87 (0_46_52_21_50)` },
    { id: 'camelot', label: 'Camelot teleport', kind: 'spell', magicLevel: 45, members: true, spellCom: 1174,
      runes: [{ obj: R.air, count: 5 }, { obj: R.law, count: 1 }],
      landing: { level: 0, x: 2757, z: 3478 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:89-96 (0_43_54_5_22)` },
    { id: 'ardougne', label: 'Ardougne teleport', kind: 'spell', magicLevel: 51, members: true, spellCom: 1540, quest: 'plague_city',
      runes: [{ obj: R.water, count: 2 }, { obj: R.law, count: 2 }],
      landing: { level: 0, x: 2661, z: 3301 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:98-105 (0_41_51_37_37); quest gate teleport.rs2:22-25,35-38` },
    { id: 'watchtower', label: 'Watchtower teleport', kind: 'spell', magicLevel: 58, members: true, spellCom: 1541, quest: 'watchtower',
      runes: [{ obj: R.earth, count: 2 }, { obj: R.law, count: 2 }],
      landing: { level: 2, x: 2933, z: 4713 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:107-114 (2_45_73_53_41); quest gate teleport.rs2:26-29,35-38` },
    { id: 'trollheim', label: 'Trollheim teleport', kind: 'spell', magicLevel: 61, members: true, spellCom: 7455, quest: 'eadgars_ruse',
      runes: [{ obj: R.fire, count: 2 }, { obj: R.law, count: 2 }],
      landing: { level: 0, x: 2890, z: 3679 }, scatter: 2, maxWildy: 20, source: `${SPELL_SRC}:116-123 (0_45_57_10_31); quest gate teleport.rs2:30-33` },
    // ---- jewellery (OPHELD4 "Rub" + a choice dialog) ----
    { id: 'glory-edgeville', label: 'Amulet of glory -> Edgeville', kind: 'item', members: true, items: GLORY_CHARGED, choice: 'Edgeville',
      landing: { level: 0, x: 3087, z: 3496 }, scatter: 0, maxWildy: 30, source: 'enchanted_jewellry/amulet_of_glory.rs2:13,19,30 (0_48_54_15_40)' },
    { id: 'glory-karamja', label: 'Amulet of glory -> Karamja', kind: 'item', members: true, items: GLORY_CHARGED, choice: 'Karamja',
      landing: { level: 0, x: 2918, z: 3176 }, scatter: 0, maxWildy: 30, source: 'enchanted_jewellry/amulet_of_glory.rs2:13,19,31 (0_45_49_38_40)' },
    { id: 'glory-draynor', label: 'Amulet of glory -> Draynor Village', kind: 'item', members: true, items: GLORY_CHARGED, choice: 'Draynor',
      landing: { level: 0, x: 3105, z: 3251 }, scatter: 0, maxWildy: 30, source: 'enchanted_jewellry/amulet_of_glory.rs2:13,19,32 (0_48_50_33_51)' },
    { id: 'glory-alkharid', label: 'Amulet of glory -> Al Kharid', kind: 'item', members: true, items: GLORY_CHARGED, choice: 'Al Kharid',
      landing: { level: 0, x: 3293, z: 3163 }, scatter: 0, maxWildy: 30, source: 'enchanted_jewellry/amulet_of_glory.rs2:13,19,33 (0_51_49_29_27)' },
    { id: 'dueling-arena', label: 'Ring of dueling -> Duel Arena', kind: 'item', members: true, items: DUELING_RINGS, choice: 'Duel Arena',
      landing: { level: 0, x: 3315, z: 3235 }, scatter: 2, maxWildy: 20, source: 'enchanted_jewellry/ring_of_dueling.rs2:7,12,21 (0_51_50_51_35)' },
    { id: 'games-burthorpe', label: 'Games necklace -> Burthorpe Games Rooms', kind: 'item', members: true, items: GAMES_NECKLACES, choice: 'Burthorpe',
      landing: { level: 0, x: 2207, z: 4940 }, scatter: 2, maxWildy: 20, source: 'enchanted_jewellry/necklace_of_minigames.rs2:7,12,21 (0_34_77_31_12)' },
    // ---- TRAVEL NETWORK ----
    // ring_of_dueling.rs2:7 p_choice3_header option 2 "Castle Wars Arena.", :11-19 wildy > 20 + pre_tele_checks, :23 map_findsquare(0_38_48_8_18, 0, 2)
    { id: 'dueling-castlewars', label: 'Ring of dueling -> Castle Wars', kind: 'item', members: true, items: DUELING_RINGS, choice: 'Castle Wars',
      landing: { level: 0, x: 2440, z: 3090 }, scatter: 2, maxWildy: 20, source: 'enchanted_jewellry/ring_of_dueling.rs2:7,23 (0_38_48_8_18)' },
    // quests/quest_viking/scripts/viking_olaf.rs2:246-262 [opheld1,magic_strung_lyre]: wildy > 20 blocks (:248-252), pre_tele_checks,
    // map_findsquare(0_41_56_38_60, 0, 2) (:260), then the lyre becomes viking_strung_lyre 3689 (:262: one charge; recharged at the
    // Fossegrimen). Obj 3691 magic_strung_lyre: iop1=Play, members=yes (quest_viking/configs/*.obj). No choice dialog.
    { id: 'lyre-rellekka', label: 'Enchanted lyre -> Rellekka', kind: 'item', members: true, items: [3691], itemOp: 1,
      landing: { level: 0, x: 2662, z: 3644 }, scatter: 2, maxWildy: 20, source: 'quests/quest_viking/scripts/viking_olaf.rs2:246-262 (0_41_56_38_60)' },
];

/** The refusal lines a failed cast/rub answers with (the bot drops that teleport for the session). */
export const TELEPORT_REFUSALS: readonly string[] = [
    'Your Magic level is not high enough',            // magic.rs2:23
    'Runes to cast this spell',                        // magic.rs2:35/39/43
    "You need to be on a members' server",             // magic.rs2:18
    'A mysterious force blocks your teleport',         // wildy (teleport.rs2:18, glory:21, ring/necklace:13)
    'You must have completed Plague City',             // teleport.rs2:23
    'You need to have completed the',                  // teleport.rs2:27,31
    "You haven't learnt how to cast this spell",       // teleport.rs2:36
    'The amulet has lost its charge',                  // amulet_of_glory.rs2:5
    'You cannot teleport from Tutorial Island',        // pre_tele_checks
    "Coward! You can't teleport from a duel",
    "You can't teleport whilst swimming",
    "too far from shore to teleport",
];

// ---- wilderness (areas/area_wilderness/configs/wilderness_zones.dbrow + wilderness_levels.rs2:4-16) ----
// main 0_46_55_0_0 .. 3_52_99_63_63  -> x 2944..3391, z 3520..6399 (all planes)
// edgeville dungeon 0_46_155_0_0 .. 0_52_199_63_63 -> x 2944..3391, z 9920..12799 (level 0)
export function wildernessLevel(c: TeleCoord): number {
    if (c.x < 2944 || c.x > 3391) return 0;
    if (c.z >= 3520 && c.z <= 6399) return Math.floor((c.z - 3520) / 8) + 1;
    if (c.level === 0 && c.z >= 9920 && c.z <= 12799) return Math.floor((c.z - 9920) / 8) + 1;
    return 0;
}
// pre_tele_checks zones a bot can stand in. Duel arena = ~in_duel_arena (duel_arena.rs2:350) over
// duelarena.dbrow fight + obstacle zones, all inside 0_52_50_5_6..0_52_50_60_58 (bounding box, level 0).
// Tutorial island = ~in_tutorial_island (tutorial/scripts/util.rs2:1-10), both boxes, any plane.
function blockedZone(c: TeleCoord): string | null {
    if (c.level === 0 && c.x >= 3333 && c.x <= 3388 && c.z >= 3206 && c.z <= 3258) return 'duel arena';
    if (c.x >= 3053 && c.x <= 3156 && c.z >= 3056 && c.z <= 3136) return 'tutorial island';
    if (c.x >= 3072 && c.x <= 3118 && c.z >= 9492 && c.z <= 9535) return 'tutorial island';
    return null;
}

// ---- capability (plain data the BOT supplies; LeanBot builds it from its decoded state) ----
export interface TeleportCaps {
    magicLevel?: number;                            // CURRENT magic level (stat(magic) — boosts count)
    inv?: Record<number, number> | Map<number, number>;   // backpack obj -> count (runes + jewellery)
    worn?: number[];                                // equipped obj ids (the right-hand staff counts)
    quests?: Partial<Record<QuestKey, boolean>>;    // caller-declared (quest varps are not transmitted)
    members?: boolean;                              // members world (default true)
    deny?: Iterable<string>;                        // teleport ids to never use (session drop-list)
    only?: Iterable<string>;                        // optional allow-list
    fromUnderground?: boolean;                      // default true (no script forbids it)
    costTiles?: number;                             // planner cost of one teleport (default 15 tiles)
    minSaveTiles?: number;                          // teleport must beat walking by at least this (default 10)
}

const invGet = (inv: TeleportCaps['inv'], obj: number): number =>
    !inv ? 0 : inv instanceof Map ? (inv.get(obj) ?? 0) : (inv[obj] ?? 0);

/** Runes the wielded staff makes free (magic.rs2:53-89). Only one staff can be in the right hand. */
export function freeRunes(worn: number[] | undefined): Set<number> {
    const s = new Set<number>();
    for (const o of worn ?? []) for (const r of STAFF_RUNES.get(o) ?? []) s.add(r);
    return s;
}

/** Requirement predicate. `from` = where the bot would cast (wilderness/zone/underground checks). */
export function teleportUsable(t: TeleportDef, caps: TeleportCaps, from?: TeleCoord): { ok: boolean; why?: string } {
    if (caps.deny) for (const d of caps.deny) if (d === t.id) return { ok: false, why: 'denied' };
    if (caps.only) { let hit = false; for (const d of caps.only) if (d === t.id) hit = true; if (!hit) return { ok: false, why: 'not allowed' }; }
    if (t.members && caps.members === false) return { ok: false, why: 'members' };
    if (from) {
        if (wildernessLevel(from) > t.maxWildy) return { ok: false, why: `wilderness > ${t.maxWildy}` };
        const z = blockedZone(from); if (z) return { ok: false, why: z };
        if (caps.fromUnderground === false && from.z >= 6400) return { ok: false, why: 'underground' };
    }
    if (t.kind === 'spell') {
        if ((caps.magicLevel ?? 0) < (t.magicLevel ?? 1)) return { ok: false, why: `magic ${caps.magicLevel ?? 0} < ${t.magicLevel}` };
        if (t.quest && !caps.quests?.[t.quest]) return { ok: false, why: `quest ${t.quest}` };
        const free = freeRunes(caps.worn);
        for (const r of t.runes ?? []) if (!free.has(r.obj) && invGet(caps.inv, r.obj) < r.count) return { ok: false, why: `runes ${r.obj} x${r.count}` };
        return { ok: true };
    }
    for (const o of t.items ?? []) if (invGet(caps.inv, o) > 0) return { ok: true };
    return { ok: false, why: 'no charged item in pack' };
}

/** Teleports castable right now from `from` (global kill switch + env NAV_TELEPORTS=0 honoured per call). */
export function usableTeleports(caps: TeleportCaps | null | undefined, from?: TeleCoord): TeleportDef[] {
    if (!caps || !teleportsEnabled()) return [];
    return TELEPORTS.filter(t => teleportUsable(t, caps, from).ok);
}

/** First charged item of a teleport present in the pack (the follower's OPHELD4 target). */
export function teleportItemIn(t: TeleportDef, inv: TeleportCaps['inv']): number | undefined {
    return t.items?.find(o => invGet(inv, o) > 0);
}

// HOT-SWAP KILL SWITCH: setTeleportsEnabled(false) at runtime, or NAV_TELEPORTS=0|off in the env
// (read on every call, never captured at module scope).
let enabledFlag = true;
export function setTeleportsEnabled(on: boolean): void { enabledFlag = on; }
export function teleportsEnabled(): boolean {
    const e = (typeof process !== 'undefined' ? process.env.NAV_TELEPORTS : undefined)?.toLowerCase();
    return enabledFlag && e !== '0' && e !== 'off' && e !== 'false';
}

export function teleportById(id: string): TeleportDef | undefined { return TELEPORTS.find(t => t.id === id); }

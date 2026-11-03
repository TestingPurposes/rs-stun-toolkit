// ZANARIS. Shared geometry + pure helpers for the
// two brains that cross into the Lost City: rc-solo's cosmic crafter (cap=cosmic) and the Lost City quest driver
// (quest-lostcity.ts). Every constant is decoded from the content (cited) and every stand tile / walk is checked on the
// REAL 289 collision by sim/rc-cosmic-geo.test.ts.
//
// CONTENT
//   shed door  zanarisdoor 2406 @ (3202,3169) shape 0 angle 0 (west wall) — m50_49.jm2 "0 2 33: 2406 0".
//              quest_zanaris.rs2 [oploc1,zanarisdoor]: $entering = ~check_axis(coord, loc_coord, loc_angle) is TRUE only ON the
//              door's own tile (x == 3202, the shed side). From OUTSIDE (3201,3169) $entering = false: the door script
//              p_teleports you onto (3202,3169) and then — `inv_total(worn, dramen_staff) > 0 & map_members` — telejumps you
//              to 0_50_149_20_56 = (3220,9592). NO quest varp is checked: the WORN staff is the only key (the first entry
//              with %zanaris = ^zanaris_staff_made also completes the quest). Without the staff you just end up in the shed;
//              op'ing the door from inside (entering = true) puts you back outside on (3201,3169).
//   ladder out ladder_from_cellar 1755 @ (3222,9588) — m50_149.jm2 "0 22 52: 1755 10"; ladders.rs2 [oploc1,ladder_from_cellar]:
//              loc_coord 0_50_149_22_52 -> ~climb_ladder(0_50_49_1_33) = (3201,3169), i.e. right outside the shed door.
//              (The fairy ladder 2410 @ (3253,9591) -> Al Kharid (3260,3171) needs a dialog; not used.)
//   zone       runecraft.constant ^zanaris_nw 0_49_148_0_0 .. ^zanaris_se 0_51_150_0_0 = x 3136-3263, z 9472-9599.
//              ^shack_nw 0_50_49_2_31 .. ^shack_se 0_50_49_5_34 = the shed interior x 3202-3205, z 3167-3170.
//   cosmic     runecraft.dbrow [runecraft_cosmic]: level 27, rune cosmicrune 564, talisman cosmic_talisman 1454, multiplier
//              59 (2 runes/essence from RC 59), altar_coord 0_49_148_40_25 (3176,9497 = the ruins' centre), FOUR enter_coords
//              (random) 0_33_75_30_13 (2142,4813) / 0_33_75_50_33 (2162,4833) / 0_33_75_30_53 (2142,4853) / 0_33_75_10_33
//              (2122,4833), exit_coord 0_49_148_37_29 = (3173,9501). jm2: cosmictemple_ruined 2458 3x3 @(3175,9496) angle 2
//              (m49_148 "0 39 24: 2458 10 2"); cosmic_altar 2484 3x3 @(2141,4832) (m33_75 "0 29 32: 2484 10"); four
//              cosmictemple_exit_portal 2471, one beside each entry: (2121,4833) (2142,4812) (2142,4854) (2163,4833).
//   bank       Zanaris has fairy bankers (npc 498 op3, m49_149) but the solo crafter mines its own essence at Aubury, so it
//              uses the Varrock East bank like every other typed crafter (runes are carried/flushed as usual).
//   npcs       fairies, butterflies, otherworldly beings (no huntmode), spiders (lvl 1): nothing aggressive to a crafter.

export type XZ = { x: number; z: number };
export const ZANARIS = {
    shedDoor: { x: 3202, z: 3169, loc: 2406 },
    /** OUTSIDE the door: the only tile from which the door teleports a staff-wielder (check_axis false) */
    shedStand: { x: 3201, z: 3169 },
    arrival: { x: 3220, z: 9592 },
    ladder: { x: 3222, z: 9588, loc: 1755 },
    /** north face of the ladder (reachedLoc TRUE; the arrival is 3 tiles away) */
    ladderStand: { x: 3222, z: 9589 },
    ladderLanding: { x: 3201, z: 3169 },
} as const;
export const DRAMEN_STAFF = 772, DRAMEN_BRANCH = 771;
/** Pure: inside the Lost City (level 0 zone ^zanaris_nw..^zanaris_se). */
export function inZanaris(p: XZ): boolean { return p.x >= 3136 && p.x < 3264 && p.z >= 9472 && p.z < 9600; }
/** Pure: inside the Lumbridge-swamp shed (^shack_nw..^shack_se) — a dead-end pocket; leave by op'ing the door. */
export function inShed(p: XZ): boolean { return p.x >= 3202 && p.x <= 3205 && p.z >= 3167 && p.z <= 3170; }
/** Pure: the Zanaris crossing to take from `me` toward `target` ('in' = shed door with the staff worn, 'out' = the
 *  entrance-room ladder), or null when no crossing separates them. Interiors (altar rooms z 4800-4900) and other
 *  underground areas are never crossed here (the caller's own phase machine owns those). */
export function zanarisLegFor(me: XZ, target: XZ): 'in' | 'out' | 'shed' | null {
    if (inShed(me)) return 'shed';
    const a = inZanaris(me), b = inZanaris(target);
    if (a === b) return null;
    if (a) return 'out';
    // only from the overworld surface (z < 4000): an altar interior / mine is left by its own portal first
    return me.z < 4000 && target.z >= 9000 ? 'in' : null;
}

/** The cosmic altar interior (m33_75): the ruins drop you on ONE of four entries at random; each has its own exit portal. */
export const COSMIC_ENTRIES: readonly XZ[] = [{ x: 2142, z: 4813 }, { x: 2162, z: 4833 }, { x: 2142, z: 4853 }, { x: 2122, z: 4833 }];
export const COSMIC_EXITS: ReadonlyArray<XZ & { loc: number }> = [
    { x: 2121, z: 4833, loc: 2471 }, { x: 2142, z: 4812, loc: 2471 }, { x: 2142, z: 4854, loc: 2471 }, { x: 2163, z: 4833, loc: 2471 },
];
/** exit_coord 0_49_148_37_29 (radius 0: exact) */
export const COSMIC_EXIT_LANDING: XZ = { x: 3173, z: 9501 };
/** Pure: the exit portal nearest to `me` (Chebyshev). */
export function nearestOf<T extends XZ>(me: XZ, list: readonly T[]): T {
    let best = list[0]!, bd = Infinity;
    for (const p of list) { const d = Math.max(Math.abs(p.x - me.x), Math.abs(p.z - me.z)); if (d < bd) { bd = d; best = p; } }
    return best;
}

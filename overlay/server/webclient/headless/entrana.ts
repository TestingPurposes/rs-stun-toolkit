// Entrana boat legs and two pure area tests (Entrana, Wilderness)
type XZ = { x: number; z: number };

/**
 * ENTRANA. The law ruins (lawtemple_ruined 2459, 3x3 @2857,3380 — m44_52.jm2 "0 41 52: 2459 10")
 * are on Entrana, an island. Pure: is this overworld tile on it? The island's walk component measured with findLongPath
 * from the landing (2834,3335) is x[2802,2878] z[3329,3393]; the nearest MAINLAND tiles in that window (Taverley coast)
 * are x>=2876 only at z>=3396 (and x>=2879 at z 3392-3395), so the box below holds no mainland tile.
 */
export function onEntrana(p: XZ): boolean {
    if (p.z >= 4000) return false;
    return p.x >= 2795 && p.x <= 2878 && p.z >= 3320 && p.z <= 3393;
}
/**
 * The two Entrana legs — FREE (no fare), read from the content:
 *  out: areas/area_port_sarim/scripts/monk_of_entrana.rs2 [opnpc1,shipmonk] (npc 657, spawns m47_50 (3045,3236) (3046,3234)
 *       (3049,3235)): p_choice2("No, not right now."=1, "Yes, okay, I'm ready to go."=2) — option 1 DECLINES, so the
 *       answer is picked by TEXT. Then ~has_entrana_restricted_items (every weapon/armour category, pack OR worn) or
 *       ~set_sail("Entrana", .., 1_44_52_18_3 = (2834,3331) L1, ..). Disembark: ship_from_entrana_off 2415 @(2834,3333) L1,
 *       angle north (m44_52 "1 18 5: 2415 10 1") -> gangplank.rs2 telejumps to (2834,3335) L0.
 *  back: areas/area_entrana/scripts/monk_of_entrana.rs2 [opnpc1,shipmonk2] (npc 658, spawns m44_52 (2830,3335) (2835,3336)
 *       (2839,3335)): p_choice2("Yes, I'm ready to go."=1, "Not just yet."=2) -> ~set_sail("Port Sarim", .., 1_47_50_40_31
 *       = (3048,3231) L1). Disembark: ship_to_entrana_off 2413 @(3048,3232) L1, angle north (m47_50 "1 40 32: 2413 10 1")
 *       -> (3048,3234) L0.
 * `step` is the deck tile cardinally next to the plank (Entrana's plank is 2 north of the landing tile).
 */
export const ENTRANA_LEGS = {
    toEntrana: { npcs: [657], dock: { x: 3048, z: 3234 }, fee: 0, arrival: { x: 2834, z: 3331 }, plank: { loc: 2415, x: 2834, z: 3333 }, step: { x: 2834, z: 3332 } },
    toPortSarim: { npcs: [658], dock: { x: 2834, z: 3335 }, fee: 0, arrival: { x: 3048, z: 3231 }, plank: { loc: 2413, x: 3048, z: 3232 }, step: { x: 3048, z: 3231 } },
} as const;
/** both monks' "board" option, matched by text (Port Sarim: option 2; Entrana: option 1) */
export const ENTRANA_BOARD = /ready to go/i;
/** Pure: is this overworld tile in the Wilderness (x 2944-3391, z 3520-3967; 2004 map, no ditch)? */
export function inWilderness(p: XZ): boolean { return p.x >= 2944 && p.x < 3392 && p.z >= 3520 && p.z < 3968; }

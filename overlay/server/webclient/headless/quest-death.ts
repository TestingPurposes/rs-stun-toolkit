// DEATH PLATEAU DRIVER — a resumable quest driver for one quester account, built on QuestRunnerBot's step executor
// (travel via startMultiTravel, stepToNpc approach, OPNPC, continue-page driving, verify) the same way the Rune
// Mysteries driver (rm-driver.ts + rc-rm-recover.ts) is. Brain wiring: see the report / the 'dpquest' snippet in
// the header of driveDeathPlateau() below.
//
// ⛔ THE QUEST VARPS ARE NOT TRANSMITTED. %death_equiproom / %death_map / %death_bits are `scope=perm` with no
// `transmit` (quest_death.varp), and quest-state.ts marks death_equiproom `transmitted:false` — the client sees only
// the journal COLOUR (red/yellow/green on questlist:death = 8438). So the driver keeps its own KNOWLEDGE (two lower
// bounds: equip stage, map stage) and raises it from three observables:
//   1. the pack (IOU, combination, climbing/spiked boots, certificate, secret-way map — each exists in exactly one
//      stage window, see floorFromInventory);
//   2. the TEXT the server sends (NPC lines, objbox/mesbox lines, MESSAGE_GAME) — TEXT_FACTS, every row cited.
//      Facts are FLOORS (raise), CEILINGS (lower: the NPC is in an EARLIER stage than we assumed) and EXCLUSIONS
//      (this branch only runs outside stages a..b). Every state of every probed NPC answers with at least one of them.
//   ⛔ THERE IS NO "NO-PROGRESS BUMP" ANY MORE (removed). It used to move a track to the next stage when a
//      probe matched nothing — live a full pack dropped Denulth's certificate on the floor,
//      every later probe "matched nothing" and the driver bumped map 4 -> 8, then asked Tenzing for a map he never
//      draws at map 4, forever. Now: no evidence = no change; the same action repeated without ANY change to the
//      knowledge or the quest items stops the driver with a reason (NoProgressGuard) instead of guessing.
// A restart re-derives its position from the pack + the journal + the next NPC line (a wrong persisted `store` is
// corrected by the first ceiling line); an optional `store` (opts.store) persists the knowledge + Harold's purse.
//
// CONTENT SOURCE OF TRUTH: server/content/scripts/quests/quest_death/scripts/*.rs2 (quoted as qd:<file>:<line>).
// Every coordinate below is from server/content/maps/mX_Z.jm2 (coord = mapX*64+lx, mapZ*64+lz) and was routed
// OFFLINE with rsmod findLongPath / planMultiLevel (see the report). NONE of it has had a live smoke.
import { QuestRunnerBot, type QStep } from './quest-runner.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// =====================================================================================================================
// IDS — server/content/pack/{obj,npc,loc,interface}.pack (the number before '=' is the id)
// =====================================================================================================================
export const DP_OBJ = {
    COINS: 995, TROUT: 333, BREAD: 2309, IRON_BAR: 2351, ASGARNIAN_ALE: 1905, SHARK: 385, STEEL_CLAWS: 3097,
    COMBINATION: 3102, IOU: 3103, SECRET_MAP: 3104, CLIMBING_BOOTS: 3105, SPIKED_BOOTS: 3107,
    BALL_RED: 3109, BALL_BLUE: 3110, BALL_YELLOW: 3111, BALL_PURPLE: 3112, BALL_GREEN: 3113, CERTIFICATE: 3114,
} as const;
export const DP_NPC = {
    DENULTH: 1060,   // death_ig_commander
    SABA: 1070,      // death_saba
    TENZING: 1071,   // death_sherpa
    HAROLD: 1078,    // death_guard_equiproom
    TOSTIG: 1079,    // death_barman (owned_shop=death_pub: asgarnian_ale x12, quest_death.npc + burthorpe.inv:19-25)
    EOHRIC: 1080,    // death_headservant
    DUNSTAN: 1082,   // death_smithy
} as const;
export const DP_LOC = {
    MECH_CORNER: 3676, MECH_SIDE: 3677,          // death_stone_mechanism_corner / _side
    CAVE_ENTRANCE: 3735, CAVE_EXIT: 3736,        // death_hermitcave_entrance / _exit
    CASTLE_DOOR: 3743,                           // death_castledoor (the equipment room)
    SHERPA_DOOR: 3745, SHERPA_BACKDOOR: 3746, HAROLD_DOOR: 3747, STILE: 3730,
} as const;
export const DP_IF = {
    DICE_ROOT: 6675,      // death_dice
    DICE_ROLL: 8421,      // death_dice:com_28 "Roll Dice!" -> [if_button,death_dice:com_28] @player_roll
    DICE_CONTINUE: 8423,  // death_dice:com_30 buttontype=pause "Continue..." (answered with RESUME_PAUSEBUTTON)
    DICE_STATUS: 8426,    // death_dice:com_33 "Harold rolls..." / "Your roll..." / "You win!" / "You lose!"
    JOURNAL: 8438,        // questlist:death
    SHOP_MAIN: 3824,      // shop_template
} as const;
const BALL_IDS: ReadonlySet<number> = new Set([DP_OBJ.BALL_RED, DP_OBJ.BALL_BLUE, DP_OBJ.BALL_YELLOW, DP_OBJ.BALL_PURPLE, DP_OBJ.BALL_GREEN]);

// =====================================================================================================================
// STAGES — quest_death.constant (equip track = %death_equiproom, map track = getbit_range(%death_map, 0, 3))
// =====================================================================================================================
export const EQ = { NOT_STARTED: 0, STARTED: 10, SPOKEN_HEADSERVANT: 20, SPOKEN_HAROLD: 30, SPOKEN_HEADSERVANT2: 40, GIVEN_ALE: 50, GIVEN_IOU: 55, FOUND_COMBO: 60, UNLOCKED_DOOR: 70, COMPLETE: 80 } as const;
export const MAP = { NONE: 0, SPOKEN_SABA: 1, SPOKEN_TENZING: 2, SPOKEN_SMITHY: 3, GOT_ENTRANCECERT: 4, GIVEN_CERT: 5, GIVEN_SUPPLIES: 6, GOT_MAP: 7, SCOUTED_AREA: 8 } as const;
export const EQUIP_STAGES: readonly number[] = [0, 10, 20, 30, 40, 50, 55, 60, 70, 80];
const nextEquipStage = (s: number) => EQUIP_STAGES.find(v => v > s) ?? s;

// =====================================================================================================================
// WHERE THINGS ARE — map placements (level x z), each routed offline
// =====================================================================================================================
export interface Tile { x: number; z: number }
export const DP_PLACES = {
    // m45_55.jm2 NPC "0 16 8: 1060"  (Imperial Guard camp tent)
    DENULTH: { level: 0, x: 2896, z: 3528 },
    // m45_55.jm2 NPC "1 22 45: 1080"  (Burthorpe castle, UPSTAIRS; planMultiLevel: stairs (2898,3565)->(1,2897,3569))
    EOHRIC: { level: 1, x: 2902, z: 3565 },
    // m45_55.jm2 NPC "1 25 19: 1078"  (Toad and Chicken, UPSTAIRS, behind death_harold_door; stairs (2914,3538)->(1,2914,3542))
    HAROLD: { level: 1, x: 2905, z: 3539 },
    // m45_55.jm2 NPC "0 26 17: 1079"  (behind the bar counter loc 4138 @ (2906,3538); customers stand SOUTH at (2906,3535))
    TOSTIG: { level: 0, x: 2906, z: 3537 }, TOSTIG_STAND: { level: 0, x: 2908, z: 3539 }   /*  the old (2906,3535) is OUTSIDE the pub's south wall (brickwall row z3535) — every op ignored; customers stand N of the counter (z3538), the stools z3539 */,
    // m45_55.jm2 NPC "0 39 54: 1082"  (Burthorpe smithy)
    DUNSTAN: { level: 0, x: 2919, z: 3574 },
    // m44_55.jm2 NPC "0 4 36: 1071"  (inside the sherpa hut — reachable ONLY through death_sherpa_door)
    TENZING: { level: 0, x: 2820, z: 3556 },
    // m35_74.jm2 NPC "0 30 23: 1070"  (inside the hermit cave; qd:quest_death.rs2:3 p_teleport(0_35_74_29_16) = (2269,4752))
    SABA: { level: 0, x: 2270, z: 4759 },
} as const;
export const DP_DOORS = {
    // m44_55.jm2 LOC "0 41 58: 3735 10" — 3x2 centrepiece, footprint x2857-2859 z3578-3579; findPathToLoc ends EAST (2860,3578)
    CAVE_ENTRANCE: { loc: { x: 2857, z: 3578, id: DP_LOC.CAVE_ENTRANCE, op: 1 }, stand: { x: 2860, z: 3578 }, level: 0 },
    // m35_74.jm2 LOC "0 28 14: 3736 10 2" — footprint x2268-2270 z4750-4751; stand on the entry landing (2269,4752).
    // qd:quest_death.rs2:7 p_teleport(0_44_55_42_57) = (2858,3577)
    CAVE_EXIT: { loc: { x: 2268, z: 4750, id: DP_LOC.CAVE_EXIT, op: 1 }, stand: { x: 2269, z: 4752 }, level: 0 },
    // m44_55.jm2 LOC "0 6 35: 3745 0 2" — wall on the EAST edge of (2822,3555): (2822,3555) is INSIDE, (2823,3555) OUTSIDE.
    // qd:quest_death.rs2:51-66: from outside it KNOCKS (Tenzing within 5 says "No milk today!") and opens only once
    // map >= spoken_saba; open_and_close_door2 TELEPORTS the player through (doors/scripts/open_and_close_doors.rs2:43-62).
    SHERPA_FRONT_OUT: { loc: { x: 2822, z: 3555, id: DP_LOC.SHERPA_DOOR, op: 1 }, stand: { x: 2823, z: 3555 }, level: 0 },
    SHERPA_FRONT_IN: { loc: { x: 2822, z: 3555, id: DP_LOC.SHERPA_DOOR, op: 1 }, stand: { x: 2822, z: 3555 }, level: 0 },
    // m44_55.jm2 LOC "0 4 37: 3746 0 1" — wall on the NORTH edge of (2820,3557): (2820,3557) INSIDE, (2820,3558) the yard.
    // qd:quest_death.rs2:68-75: leaving via it needs map >= got_map ("This is private property!"); entering is free.
    SHERPA_BACK_IN: { loc: { x: 2820, z: 3557, id: DP_LOC.SHERPA_BACKDOOR, op: 1 }, stand: { x: 2820, z: 3557 }, level: 0 },
    SHERPA_BACK_OUT: { loc: { x: 2820, z: 3557, id: DP_LOC.SHERPA_BACKDOOR, op: 1 }, stand: { x: 2820, z: 3558 }, level: 0 },
    // m44_55.jm2 LOC "0 1 42: 3730 10" — death_fullstyle, length 2 (z3562-3563). qd:quest_death.rs2:100-115: from the
    // south you land on (2817,3564); from the north on (2817,3561).
    STILE_SOUTH: { loc: { x: 2817, z: 3562, id: DP_LOC.STILE, op: 1 }, stand: { x: 2817, z: 3561 }, level: 0 },
    STILE_NORTH: { loc: { x: 2817, z: 3562, id: DP_LOC.STILE, op: 1 }, stand: { x: 2817, z: 3564 }, level: 0 },
    // m45_55.jm2 LOC "1 26 23: 3747 0 3" — wall on the SOUTH edge of (2906,3543) L1: the door tile itself is OUTSIDE,
    // (2906,3542) is Harold's room. qd:quest_death.rs2:9-24: from outside it needs equip >= spoken_headservant and
    // Harold within 7 ("Come in!"), then teleports you in; from inside it just opens.
    HAROLD_OUT: { loc: { x: 2906, z: 3543, id: DP_LOC.HAROLD_DOOR, op: 1 }, stand: { x: 2906, z: 3543 }, level: 1 },
    HAROLD_IN: { loc: { x: 2906, z: 3543, id: DP_LOC.HAROLD_DOOR, op: 1 }, stand: { x: 2906, z: 3542 }, level: 1 },
    // m45_55.jm2 LOC "0 14 46: 3743 0 1" — the equipment-room door, wall on the NORTH edge of (2894,3566).
    // qd:quest_death.rs2:77-82: "The door is locked." until equip >= unlocked_door. Used only as a PROBE.
    CASTLE_DOOR: { loc: { x: 2894, z: 3566, id: DP_LOC.CASTLE_DOOR, op: 1 }, stand: { x: 2894, z: 3566 }, level: 0 },
} as const;
// [zone,0_44_56_48_24] (qd:quest_death.rs2:127-134) = the 8x8 zone x2864-2871 z3608-3615. Offline flood fill: the
// reachable zone tiles are (2867-2871,3608), (2864-2869,3609), (2863-2864,3610). (2866,3609) is in it.
export const SCOUT_TILE: Tile = { x: 2866, z: 3609 };
export const SCOUT_ZONE = { x0: 2864, x1: 2871, z0: 3608, z1: 3615 } as const;

// =====================================================================================================================
// POCKETS — areas a closed QUEST door (not in door-states.json, so invisible to the door tracker and masked OPEN in
// the pathfinder's collision) or a stile seals off. Exact tile sets from an offline rsmod flood fill with the hut
// doors / Harold's door re-walled (findLongPath blockedDoors). Travel must never be asked to route out of these.
// =====================================================================================================================
function parseRuns(s: string): Set<string> {
    const out = new Set<string>();
    for (const row of s.split(';')) {
        const [zs, xs] = row.split(':');
        for (const run of xs!.split(',')) {
            const [a, b] = run.split('-').map(Number);
            for (let x = a!; x <= (b ?? a!); x++) out.add(`${x},${zs}`);
        }
    }
    return out;
}
const POCKET_TILES: Record<'yard' | 'hut' | 'north' | 'harold' | 'cave', { level: number; tiles: Set<string> }> = {
    yard: { level: 0, tiles: parseRuns('3552:2814-2818;3553:2814-2817;3554:2814-2817;3555:2814-2817;3556:2814-2817;3557:2814-2817;3558:2814-2820;3559:2814-2820;3560:2814-2820;3561:2814-2820;3562:2814-2816,2818-2819') },
    hut: { level: 0, tiles: parseRuns('3554:2819-2821;3555:2819-2822;3556:2819-2822;3557:2820-2821') },
    north: { level: 0, tiles: parseRuns('3563:2816;3564:2816-2817;3565:2816-2817;3566:2817;3567:2817;3568:2817;3569:2817;3570:2817;3571:2817;3572:2817;3573:2817;3574:2817;3575:2817;3576:2817;3577:2817;3578:2817;3579:2817;3580:2817;3581:2817;3582:2817;3583:2817;3584:2817-2819;3585:2817-2819;3586:2817-2820;3587:2817-2820;3588:2817-2820;3589:2818-2824;3590:2821-2826;3591:2823-2828;3592:2824-2829;3593:2826-2830;3594:2828-2831;3595:2830-2832;3596:2830-2833,2880-2881;3597:2830-2833,2880-2881;3598:2831-2833,2880-2881;3599:2832-2834,2880-2881;3600:2833-2834,2880-2881;3601:2834-2838,2880-2881;3602:2835-2840,2878-2880;3603:2836-2841,2877-2880;3604:2839-2842,2876-2880;3605:2840-2843,2875-2879;3606:2841-2843,2874-2875;3607:2843-2847,2872-2874;3608:2845-2848,2855-2858,2867-2873;3609:2846-2869;3610:2848-2850,2855-2857,2863-2864;3611:2856-2857') },
    harold: { level: 1, tiles: parseRuns('3536:2905;3537:2905;3538:2905-2906;3539:2905-2906;3540:2905-2906;3541:2905-2906;3542:2905-2907') },
    cave: { level: 0, tiles: parseRuns('4752:2268-2270;4753:2267-2268,2270-2271;4754:2268-2271;4755:2268-2271;4756:2269-2271;4757:2269-2271;4758:2269-2271;4759:2267-2271;4760:2267,2271') },
};
export type Pocket = keyof typeof POCKET_TILES;
/** Which sealed pocket (if any) this tile is in. Cave = the whole hermit-cave instance band too. */
export function pocketOf(level: number, x: number, z: number): Pocket | null {
    if (z >= 4700 && z < 4800 && x >= 2240 && x < 2300) return 'cave';
    for (const k of Object.keys(POCKET_TILES) as Pocket[]) {
        const p = POCKET_TILES[k];
        if (p.level === level && p.tiles.has(`${x},${z}`)) return k;
    }
    return null;
}

// =====================================================================================================================
// KNOWLEDGE
// =====================================================================================================================
export interface DpKnowledge {
    equip: number;            // LOWER BOUND on %death_equiproom
    map: number;              // LOWER BOUND on the map track
    purse: number | null;     // Harold's purse as tracked from our own rolls (null = unknown)
    complete: boolean;
    mapGiven?: boolean;       // Denulth holds the secret-way map (bit denulth_given_map) — no need to carry another
    comboGiven?: boolean;     // Denulth holds the combination (bit denulth_given_combo)
    doorLocked?: boolean;     // the castle-door probe answered "The door is locked."
}
export const freshKnowledge = (): DpKnowledge => ({ equip: 0, map: 0, purse: null, complete: false });

/**
 * A text fact: when `re` matches a server line, move the bounds. Every row cites the line that emits it
 * (qd:<file>:<line> = server/content/scripts/quests/quest_death/scripts/<file>).
 *   equip/map           FLOOR   — the line is only said at or after this stage (raise).
 *   equipMax/mapMax     CEILING — the line is only said at or BEFORE this stage (lower: we assumed too much).
 *   equipNotIn/mapNotIn EXCLUSION [a,b] — the branch that says it runs only OUTSIDE stages a..b; when the knowledge sits
 *                       inside a..b it moves to the first stage after b. (Positive evidence, never a guess.)
 * A line that pins ONE stage carries both a floor and a ceiling (e.g. map: 5, mapMax: 5).
 */
interface TextFact {
    re: RegExp; equip?: number; map?: number; complete?: true; mapGiven?: true; comboGiven?: true; doorLocked?: true; purse0?: true;
    equipMax?: number; mapMax?: number; equipNotIn?: readonly [number, number]; mapNotIn?: readonly [number, number];
}
export const TEXT_FACTS: readonly TextFact[] = [
    // ---- equip track ----
    { re: /The equipment room is unlocked when the stone balls|Well citizen, the Prince is fond of puzzles/, equip: 10 },     // qd:death_ig_commander.rs2:109/114 denulth_quests
    // qd:death_ig_commander.rs2:20 — Denulth's DEFAULT branch: reached only when NOT (map 3..4 -> @denulth_cert, :17-19)
    // and NOT (equip=unlocked & map=scouted -> @denulth_has_map, :14-16). So in progress, and map is outside 3..4.
    { re: /Hello citizen, is there anything you'd like to know\?/, equip: 10, mapNotIn: [MAP.SPOKEN_SMITHY, MAP.GOT_ENTRANCECERT] },
    { re: /Harold is staying at the (local inn, the )?Toad and Chicken/, equip: 20 },                                          // qd:death_headservant.rs2:47/55
    { re: /I don't want to talk about it!/, equip: 30 },                                                                         // qd:death_guard_equiproom.rs2 harold_duty
    { re: /I said I don't want to talk about it!/, equip: 30, equipMax: 30 },                                                   // harold_duty at exactly spoken_harold
    { re: /I found Harold but he won't talk to me!/, equip: 30 },                                                                // qd:death_headservant.rs2:10 (30 -> 40)
    { re: /Perhaps he'd open up after a drink\?|if you buy Harold a beer he might talk to you/, equip: 40 },                   // qd:death_headservant.rs2:12/6
    { re: /Yes, if you buy Harold a beer he might talk to you/, equipMax: 40 },                                                 // qd:death_headservant.rs2:6 (exactly 40)
    { re: /Now you're talking! An Asgarnian Ale please!/, equip: 40 },                                                          // harold_drink: offered from spoken_headservant2 on
    { re: /I honestly don't know! I've looked everywhere/, equip: 50 },                                                         // harold_combo: offered only at given_ale/given_iou
    // qd:death_headservant.rs2:22 — Eohric's p_choice4 menu ("What is this castle?") runs only when equip is NOT
    // started/spoken_headservant (multi3, :17-20) and NOT spoken_harold/spoken_headservant2 (return, :4-15).
    { re: /What is this castle\?/, equipNotIn: [EQ.STARTED, EQ.SPOKEN_HEADSERVANT2] },
    { re: /You give Harold an Asgarnian Ale\./, equip: 50 },                                                                     // harold_drink objbox/mes
    { re: /I've run out of money!|I'm shure I had money|Harold has given you an IOU|I'll write you out an IOU|I owe you the resht/, equip: 55 },
    { re: /You have found the combination!|which you know is the combination/, equip: 60 },                                    // qd:quest_death.rs2:31 / harold_reclaim_iou
    { re: /The equipment room door has unlocked\.|I've unlocked the equipment room/, equip: 70 },                              // qd:quest_death.rs2:94 / qd:death_ig_commander.rs2:128
    // denulth_remind (qd:death_ig_commander.rs2:127-133): "I've unlocked..." is said when equip=70 — which, had map been
    // scouted, would have taken the has_map branch instead -> map < scouted. "I've found a secret way..." is the ELSE: equip < 70.
    { re: /I've unlocked the equipment room so I just need to find an alternate route/, mapMax: MAP.GOT_MAP },
    { re: /I've found a secret way up Death Plateau so I just need to find the combination/, equipMax: EQ.FOUND_COMBO },
    { re: /The door is locked\./, doorLocked: true },                                                                           // qd:quest_death.rs2:78 death_castledoor
    { re: /I'd better not go into someone's bedroom without a reason!/, equipMax: EQ.STARTED },                             // qd:quest_death.rs2:16 (equip < spoken_headservant)
    { re: /Here's what I have\.|Heresh shome of it\./, purse0: true },
    // ---- map track: SABA (qd:death_saba.rs2) ----
    { re: /Perhaps he'd know another way\./, map: 1 },                                                                        // :51 (0 -> 1)
    { re: /Where did you say this Sherpa was\?/, map: 1, mapMax: 1 },                                                         // :26 exactly spoken_saba
    { re: /I'm working on it!/, map: 2 },                                                                                    // :19 map >= spoken_tenzing
    // ---- map track: the SHERPA HUT DOORS (qd:quest_death.rs2:46-71) ----
    // front door from OUTSIDE knocks only while map < spoken_tenzing; Tenzing lets you in only from spoken_saba
    { re: /No milk today! Thank you!/, mapMax: MAP.NONE },                                                                     // :55 (raised again by the next line)
    { re: /I'm not the milkman, I need your help!/, map: 1 },                                                                 // :57 map >= spoken_saba (and < 2: it knocked)
    { re: /Where do you think you're going\? This is private property!/, mapMax: MAP.GIVEN_SUPPLIES },                      // :70 back door, map < got_map
    // ---- map track: TENZING (qd:death_sherpa.rs2) — EVERY state he can be in has a line here ----
    { re: /Saba seemed to think you'd be able to help|Ah\.\.\.Saba is still alive and kicking\?/, map: 1, mapMax: 1 },      // :118-119 spoken_saba
    { re: /Tenzing has given you his climbing boots\./, map: 2 },                                                            // :135 (1 -> 2)
    { re: /Has Dunstan added spikes to my climbing boots yet\?|Well, when he has, bring the boots to me/, map: 2, mapMax: 4 }, // :112-114 spoken_tenzing..got_entrancecert
    { re: /Have you brought me the items I asked for\?|do not lose another pair!|I don't have the: ?(Spiked boots|Ten loaves|Ten cooked trout)/, map: 5, mapMax: 5 },   // :74-109 given_cert
    { re: /You give Tenzing the Spiked boots\./, map: 6 },                                                                    // :98 (5 -> 6)
    { re: /Thanks again for the food and boots\./, map: 6, mapMax: 6 },                                                       // :70 given_supplies (-> got_map at :145)
    { re: /Tenzing has given you a map of the secret way!/, map: 7 },                                                        // :51/:146
    { re: /Hello again traveller\. What can I do for you\?|I've lost the secret way map\./, map: 7 },                        // :47/:49 got_map/scouted_area (and :4 complete)
    { re: /I thought you were going to investigate the secret way/, map: 7, mapMax: 7 },                                       // :61 exactly got_map
    // ---- map track: DUNSTAN (qd:death_smithy.rs2) ----
    { re: /Tenzing has asked me to bring you his climbing boots/, map: 2 },                                                   // :18 spoken_tenzing (-> 3 at :26)
    { re: /You'll need to bring an Iron bar for the spikes!/, map: 3 },                                                     // :29
    { re: /Not yet! I just need to speak to Denulth!/, map: 3, mapMax: 3 },                                                   // :53 exactly spoken_smithy
    { re: /Have you managed to get my son signed up for the Imperial Guard\?/, map: 3, mapMax: 4 },                            // :38/:52
    { re: /I have but I don't have the entrance certificate on me\./, map: 4, mapMax: 4 },                                    // :47 got_entrancecert, no cert held
    { re: /You give Dunstan the certificate\./, map: 5, mapMax: 5 },                                                          // :42 (4 -> 5)
    { re: /Now to keep my end of the bargain|I see you've got the spiked boots/, map: 5, mapMax: 5 },                         // :171/:175 dunstan_bargain (given_cert only)
    { re: /Dunstan has given you the Spiked boots\./, map: 5 },                                                               // :115/:187 (bargain, or the >= given_supplies re-spike)
    // :56 "Hi! Did you want something?" is the fall-through: map is NOT spoken_tenzing..given_cert (:16-55);
    // :90 "How is your son getting on?" is offered only from given_supplies on (:86-91).
    { re: /Hi! Did you want something\?/, mapNotIn: [MAP.SPOKEN_TENZING, MAP.GIVEN_CERT] },
    { re: /How is your son getting on\?/, map: 6 },
    // ---- map track: DENULTH (qd:death_ig_commander.rs2) ----
    { re: /Yes there is another way up Death Plateau!/, map: 3, mapMax: 3 },                                                 // :171 spoken_smithy (-> 4 at :179)
    { re: /Denulth has given you a certificate\.|I just need to give the certificate to Dunstan|I'm working on it but I've lost the certificate!/, map: 4, mapMax: 4 },   // :161-182
    { re: /You can see that there are no trolls on the secret path\.|I've found a secret way up Death Plateau/, map: 8 },     // qd:quest_death.rs2:133 / :131
    // ---- the finish: denulth_has_map (:186-221) runs only at equip = unlocked_door AND map = scouted_area ----
    { re: /There is a path that runs from a Sherpa's hut|I don't have the map on me\.|I have opened the door but I don't have the combination on me\./, equip: 70, map: 8 },
    { re: /You give Denulth the map of the secret way\.|I have the map of the secret way you gave me earlier/, mapGiven: true, equip: 70, map: 8 },
    { re: /You give Denulth the combination to the equipment room\.|I have the combination to the equipment room that you recovered/, comboGiven: true, equip: 70, map: 8 },
    { re: /Well done citizen! We will reward you by training you in attack!|You have completed.{0,4}Death Plateau|You are now an honorary member of the Imperial Guard!/, complete: true },
];

/** Apply one server line to the knowledge. Returns the matched fact's source regex (for the log) or null. */
export function applyText(k: DpKnowledge, text: string): string | null {
    const t = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    let hit: string | null = null;
    for (const f of TEXT_FACTS) {
        if (!f.re.test(t)) continue;
        hit = f.re.source;
        if (f.equip !== undefined && f.equip > k.equip) k.equip = f.equip;
        if (f.map !== undefined && f.map > k.map) k.map = f.map;
        if (f.complete) { k.complete = true; k.equip = EQ.COMPLETE; k.map = MAP.SCOUTED_AREA; }
        if (f.mapGiven) k.mapGiven = true;
        if (f.comboGiven) k.comboGiven = true;
        if (f.doorLocked) k.doorLocked = true;
        if (f.purse0) k.purse = 0;
        if (f.equipMax !== undefined && k.equip > f.equipMax && !k.complete) k.equip = f.equipMax;
        if (f.mapMax !== undefined && k.map > f.mapMax && !k.complete) k.map = f.mapMax;
        if (f.equipNotIn && k.equip >= f.equipNotIn[0] && k.equip <= f.equipNotIn[1]) k.equip = nextEquipStage(f.equipNotIn[1]);
        if (f.mapNotIn && k.map >= f.mapNotIn[0] && k.map <= f.mapNotIn[1]) k.map = f.mapNotIn[1] + 1;
    }
    return hit;
}

export type Journal = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'NOT_OBSERVABLE';
/** Raise the bounds from what the pack holds and the journal colour. Each quest item exists in ONE stage window. */
export function floorFromInventory(k: DpKnowledge, has: (obj: number) => number, journal: Journal): void {
    if (journal === 'COMPLETE') { k.complete = true; k.equip = EQ.COMPLETE; k.map = MAP.SCOUTED_AREA; return; }
    if (journal === 'NOT_STARTED') { k.equip = 0; k.map = 0; return; }   // red row = %death_equiproom 0, and Saba gates the map track on it
    if (journal === 'IN_PROGRESS' && k.equip < EQ.STARTED) k.equip = EQ.STARTED;
    const up = (f: 'equip' | 'map', v: number) => { if (k[f] < v) k[f] = v; };
    if (has(DP_OBJ.IOU) > 0) up('equip', EQ.GIVEN_IOU);                  // harold gamble end -> given_iou
    if (has(DP_OBJ.COMBINATION) > 0) up('equip', EQ.FOUND_COMBO);         // reading the IOU -> found_combo
    if (has(DP_OBJ.CLIMBING_BOOTS) > 0 && k.equip < EQ.COMPLETE) up('map', MAP.SPOKEN_TENZING);
    if (has(DP_OBJ.CERTIFICATE) > 0) up('map', MAP.GOT_ENTRANCECERT);
    if (has(DP_OBJ.SPIKED_BOOTS) > 0 && k.equip < EQ.COMPLETE) up('map', MAP.GIVEN_CERT);
    if (has(DP_OBJ.SECRET_MAP) > 0) up('map', MAP.GOT_MAP);
    if (has(DP_OBJ.STEEL_CLAWS) > 0 && journal !== 'IN_PROGRESS') { /* claws can be bought elsewhere — not a fact */ }
}

// =====================================================================================================================
// DICE — qd:death_guard_equiproom.rs2:126-146. A WIN (player 2d6 > Harold 2d6, ties lose) with bet > purse sets
// harold_lostall -> IOU (the queue at :148-186 also hands over the remaining purse). A win with bet <= purse moves
// `bet` from his purse to us; a loss moves `bet` from us to his purse (capped 10000, death_set_haroldgold). Bets are
// 1..1000 (:230) and must be held (:239). Purse starts at 100 (denulth_quests ~death_set_haroldgold(100)).
// =====================================================================================================================
/** P(player 2d6 > Harold 2d6) = (1 - P(tie)) / 2 = (1 - 146/1296) / 2 = 575/1296 ≈ 0.4437. */
export const P_WIN = 575 / 1296;
export const MAX_BET = 1000;
export interface BetPlan { bet: number; winsIou: boolean; why: string }
/**
 * Bold play toward the IOU. purse < 1000: bet purse+1 (a win ends the game). purse >= 1000: no bet can end it, so bet
 * exactly enough to bring the purse to 999 on a win (bold play is optimal in a sub-fair game: P_WIN < 1/2), capped
 * at 1000. Unknown purse: bet 1000 (wins the IOU whenever the purse is < 1000). null = cannot afford the plan.
 */
export function nextBet(purse: number | null, coins: number): BetPlan | null {
    if (coins <= 0) return null;
    if (purse === null) {
        const bet = Math.min(MAX_BET, coins);
        return { bet, winsIou: false, why: 'purse unknown: max affordable bet' };
    }
    if (purse < MAX_BET) {
        const bet = purse + 1;
        return coins >= bet ? { bet, winsIou: true, why: `purse ${purse}: bet purse+1` } : null;
    }
    const bet = Math.min(MAX_BET, purse - (MAX_BET - 1));
    return coins >= bet ? { bet, winsIou: false, why: `purse ${purse} >= ${MAX_BET}: bring it down to ${purse - bet}` } : null;
}
export type RollOutcome = 'win' | 'lose' | 'iou';
/** Harold's purse after one roll (null stays null except on the IOU, which empties it). */
export function applyRoll(purse: number | null, bet: number, outcome: RollOutcome): number | null {
    if (outcome === 'iou') return 0;
    if (purse === null) return null;
    if (outcome === 'win') return Math.max(0, purse - bet);
    return Math.min(10000, purse + bet);
}
/** Coins needed to survive n straight losses from `purse` with nextBet (for the pre-flight funding check). */
export function coinsForLosses(purse: number, n: number): number {
    let need = 0, p = purse;
    for (let i = 0; i < n; i++) { const b = nextBet(p, Number.MAX_SAFE_INTEGER)!; need += b.bet; p = applyRoll(p, b.bet, 'lose')!; }
    return need;
}

// =====================================================================================================================
// THE STONE BALLS — qd:quest_death.rs2:84-98 (the unlock check) + :28-35 (the combination text):
//   "Red is North of Blue. Yellow is South of Purple. Green is North of Purple. Blue is West of Yellow. Purple is East
//    of Red." -> blue (2894,3562) yellow (2895,3562) red (2894,3563) purple (2895,3563) green (2895,3564)
//   (0_45_55_14_42 / 15_42 / 14_43 / 15_43 / 15_44). The check runs ONLY inside a placement while
//   %death_equiproom = ^death_found_combo, and only when all five are on their tiles.
// Mechanisms: m45_55.jm2 LOC "0 14 42: 3676" "0 14 43: 3677" "0 14 44: 3676" "0 15 42: 3676" "0 15 43: 3677"
//   "0 15 44: 3676" (all shape 10, 1x1, blocking). Use from the CARDINAL tile: x=2894 from the west (2893,z), x=2895
//   from the east (2896,z) — both columns walkable offline.
// Spawns (where the balls come from — the TODO in the playbook): m45_55.jm2 OBJ "0 13 41: 3111" "0 13 42: 3113"
//   "0 13 43: 3112" "0 13 44: 3110" "0 13 45: 3109" = respawning ground objs in the castle courtyard, x=2893.
// =====================================================================================================================
export interface BallTarget { obj: number; x: number; z: number; locId: number; stand: Tile }
export const BALL_TARGETS: readonly BallTarget[] = [
    { obj: DP_OBJ.BALL_BLUE, x: 2894, z: 3562, locId: DP_LOC.MECH_CORNER, stand: { x: 2893, z: 3562 } },
    { obj: DP_OBJ.BALL_YELLOW, x: 2895, z: 3562, locId: DP_LOC.MECH_CORNER, stand: { x: 2896, z: 3562 } },
    { obj: DP_OBJ.BALL_RED, x: 2894, z: 3563, locId: DP_LOC.MECH_SIDE, stand: { x: 2893, z: 3563 } },
    { obj: DP_OBJ.BALL_PURPLE, x: 2895, z: 3563, locId: DP_LOC.MECH_SIDE, stand: { x: 2896, z: 3563 } },
    { obj: DP_OBJ.BALL_GREEN, x: 2895, z: 3564, locId: DP_LOC.MECH_CORNER, stand: { x: 2896, z: 3564 } },
];
export const BALL_SPAWNS: Readonly<Record<number, Tile>> = {
    [DP_OBJ.BALL_YELLOW]: { x: 2893, z: 3561 }, [DP_OBJ.BALL_GREEN]: { x: 2893, z: 3562 },
    [DP_OBJ.BALL_PURPLE]: { x: 2893, z: 3563 }, [DP_OBJ.BALL_BLUE]: { x: 2893, z: 3564 }, [DP_OBJ.BALL_RED]: { x: 2893, z: 3565 },
};
export type BallAction =
    | { kind: 'take'; obj: number; x: number; z: number; stand: Tile; why: string }
    | { kind: 'place'; obj: number; target: BallTarget; why: string }
    | { kind: 'all-placed' };
export interface BallView {
    /** ball objs we currently SEE on a tile */
    onTile(x: number, z: number): number[];
    held(obj: number): number;
}
/** Pure: the next ball action. Clears wrong balls off target tiles first, then fills the missing targets in order. */
export function planBalls(v: BallView): BallAction {
    for (const t of BALL_TARGETS) {
        const wrong = v.onTile(t.x, t.z).find(o => o !== t.obj && BALL_IDS.has(o));
        if (wrong !== undefined) return { kind: 'take', obj: wrong, x: t.x, z: t.z, stand: t.stand, why: `wrong ball ${wrong} on the ${t.obj} tile` };
    }
    const missing = BALL_TARGETS.filter(t => !v.onTile(t.x, t.z).includes(t.obj));
    if (!missing.length) return { kind: 'all-placed' };
    const m = missing[0]!;
    if (v.held(m.obj) > 0) return { kind: 'place', obj: m.obj, target: m, why: `place ${m.obj}` };
    const s = BALL_SPAWNS[m.obj]!;
    return { kind: 'take', obj: m.obj, x: s.x, z: s.z, stand: s, why: `fetch ${m.obj} from its spawn` };
}

// =====================================================================================================================
// THE PLAN — pure: what to do next from the knowledge + the pack
// =====================================================================================================================
export type NpcKey = 'denulth' | 'eohric' | 'harold' | 'saba' | 'tenzing' | 'dunstan';
export type DpAction =
    | { kind: 'done' }
    | { kind: 'talk'; npc: NpcKey; label: string; want: RegExp[]; probe?: { track: 'equip' | 'map'; stage: number }; gamble?: boolean }
    | { kind: 'buy-ale' }
    | { kind: 'read-iou' }
    | { kind: 'balls' }
    | { kind: 'scout' }
    | { kind: 'need'; what: string };

// Wanted options per conversation (text, never index — option order is content and varies with state).
export const DP_WANT = {
    denulthStart: [/^Do you have any quests for me\?$/, /^No but perhaps I could try and find one\?$/],   // denulth multi3 + p_choice2
    eohric: [/^I'm looking for the guard that was on last night\.$/, /^Where is the guard that was on last night staying\?$/],
    haroldDuty: [/^You're the guard that was on duty last night\?$/],
    gamble: [/^Would you like to gamble\?$/],
    saba: [/^Do you know of another way up Death Plateau\?$/],                                            // death_saba.rs2:384 option 2
    tenzing: [/^OK, I'll get those for you\.$/],                                                          // death_sherpa.rs2:539 option 1
    dunstan: [/^Yes, but I still want them\.$/],
    none: [] as RegExp[],
};
/** Conversation exits, consulted AFTER the wanted options: never let a probe wander into a sub-menu. */
export const EXIT_OPTIONS: readonly RegExp[] = [
    /^That's all, thanks\.$/, /^No, I'm just looking around\.$/, /^Nothing, thanks!?\.?$/, /^Nothing, sorry!$/,
    /^No, thanks\.$/, /^You can't, thanks\.$/, /^See you about Denulth!$/, /^I'm sorry, there's nothing I can do\.$/,
    /^I'm sorry to hear that\.$/, /^No, sorry\.$/,
];

export interface PackView { (obj: number): number }
export function nextAction(k: DpKnowledge, has: PackView): DpAction {
    if (k.complete || k.equip >= EQ.COMPLETE) return { kind: 'done' };
    if (k.equip < EQ.STARTED) return { kind: 'talk', npc: 'denulth', label: 'Denulth: start', want: DP_WANT.denulthStart, probe: { track: 'equip', stage: 0 } };
    // ---- the map track first: it gives away 20 slots of bread/trout, which the balls/ale/IOU then fit into ----
    if (k.map < MAP.SCOUTED_AREA) {
        switch (k.map) {
            case MAP.NONE: return { kind: 'talk', npc: 'saba', label: 'Saba: another way up?', want: DP_WANT.saba, probe: { track: 'map', stage: 0 } };
            case MAP.SPOKEN_SABA: return { kind: 'talk', npc: 'tenzing', label: 'Tenzing: take his climbing boots', want: DP_WANT.tenzing, probe: { track: 'map', stage: 1 } };
            case MAP.SPOKEN_TENZING: return { kind: 'talk', npc: 'dunstan', label: 'Dunstan: spikes (asks for the Guard place)', want: DP_WANT.none, probe: { track: 'map', stage: 2 } };
            case MAP.SPOKEN_SMITHY: return { kind: 'talk', npc: 'denulth', label: 'Denulth: entrance certificate', want: DP_WANT.none, probe: { track: 'map', stage: 3 } };
            case MAP.GOT_ENTRANCECERT:
                // Denulth re-issues a lost certificate (denulth_cert: obj_gettotal = 0); Dunstan takes it.
                return has(DP_OBJ.CERTIFICATE) > 0
                    ? { kind: 'talk', npc: 'dunstan', label: 'Dunstan: certificate -> spiked boots', want: DP_WANT.dunstan, probe: { track: 'map', stage: 4 } }
                    : { kind: 'talk', npc: 'denulth', label: 'Denulth: duplicate certificate', want: DP_WANT.none, probe: { track: 'map', stage: 4 } };
            case MAP.GIVEN_CERT:
                if (has(DP_OBJ.SPIKED_BOOTS) > 0) {
                    if (has(DP_OBJ.BREAD) < 10) return { kind: 'need', what: `10 bread (have ${has(DP_OBJ.BREAD)})` };
                    if (has(DP_OBJ.TROUT) < 10) return { kind: 'need', what: `10 cooked trout (have ${has(DP_OBJ.TROUT)})` };
                    return { kind: 'talk', npc: 'tenzing', label: 'Tenzing: supplies -> secret way map', want: DP_WANT.none, probe: { track: 'map', stage: 5 } };
                }
                // no spiked boots yet: Dunstan's bargain needs the climbing boots + an iron bar (death_smithy.rs2:729-753);
                // Tenzing re-issues lost climbing boots at given_cert (death_sherpa.rs2:485-491)
                if (has(DP_OBJ.CLIMBING_BOOTS) === 0) return { kind: 'talk', npc: 'tenzing', label: 'Tenzing: replacement climbing boots', want: DP_WANT.none, probe: { track: 'map', stage: 5 } };
                if (has(DP_OBJ.IRON_BAR) === 0) return { kind: 'need', what: 'an iron bar for the spikes' };
                return { kind: 'talk', npc: 'dunstan', label: 'Dunstan: bargain -> spiked boots', want: DP_WANT.dunstan, probe: { track: 'map', stage: 5 } };
            case MAP.GIVEN_SUPPLIES: return { kind: 'talk', npc: 'tenzing', label: 'Tenzing: secret way map', want: DP_WANT.none, probe: { track: 'map', stage: 6 } };
            case MAP.GOT_MAP:
                return has(DP_OBJ.SECRET_MAP) > 0 ? { kind: 'scout' }
                    : { kind: 'talk', npc: 'tenzing', label: 'Tenzing: replacement map', want: DP_WANT.none, probe: { track: 'map', stage: 7 } };
        }
    }
    // ---- the equipment-room track ----
    if (k.equip < EQ.UNLOCKED_DOOR) {
        switch (k.equip) {
            case EQ.STARTED: return { kind: 'talk', npc: 'eohric', label: 'Eohric: the guard on last night', want: DP_WANT.eohric, probe: { track: 'equip', stage: 10 } };
            case EQ.SPOKEN_HEADSERVANT: return { kind: 'talk', npc: 'harold', label: 'Harold: on duty last night?', want: DP_WANT.haroldDuty, probe: { track: 'equip', stage: 20 } };
            case EQ.SPOKEN_HAROLD: return { kind: 'talk', npc: 'eohric', label: 'Eohric: Harold will not talk', want: DP_WANT.eohric, probe: { track: 'equip', stage: 30 } };
            case EQ.SPOKEN_HEADSERVANT2:
                return has(DP_OBJ.ASGARNIAN_ALE) > 0
                    ? { kind: 'talk', npc: 'harold', label: 'Harold: ale, then gamble', want: DP_WANT.gamble, probe: { track: 'equip', stage: 40 }, gamble: true }
                    : { kind: 'buy-ale' };
            case EQ.GIVEN_ALE: return { kind: 'talk', npc: 'harold', label: 'Harold: gamble', want: DP_WANT.gamble, gamble: true };
            case EQ.GIVEN_IOU:
                // Harold re-writes a lost IOU when neither IOU nor combination exists (harold_reclaim_iou)
                return has(DP_OBJ.IOU) > 0 ? { kind: 'read-iou' }
                    : { kind: 'talk', npc: 'harold', label: 'Harold: replacement IOU', want: DP_WANT.none };
            case EQ.FOUND_COMBO: return { kind: 'balls' };
        }
        return { kind: 'need', what: `unhandled equip stage ${k.equip}` };
    }
    // ---- the finish: Denulth wants the map AND the combination in the pack (denulth_has_map) ----
    // Harold re-issues the combination itself once found_combo is passed (harold_reclaim_iou: obj_gettotal of IOU and
    // combination both 0); Tenzing re-draws a lost map at got_map/scouted (death_sherpa.rs2:458-465).
    if (has(DP_OBJ.COMBINATION) === 0 && !k.comboGiven) {
        if (has(DP_OBJ.IOU) > 0) return { kind: 'read-iou' };
        return { kind: 'talk', npc: 'harold', label: 'Harold: replacement combination', want: DP_WANT.none };
    }
    // Tenzing re-draws the map ONLY at got_map/scouted_area (death_sherpa.rs2:45-55). This talk is also a PROBE of the
    // map track: if map >= scouted is a stale belief, his answer is a CEILING line ("Has Dunstan added spikes...",
    // "Have you brought me the items...") and the plan falls back to the right map-track step.
    if (has(DP_OBJ.SECRET_MAP) === 0 && !k.mapGiven) return { kind: 'talk', npc: 'tenzing', label: 'Tenzing: replacement map (for Denulth)', want: DP_WANT.none, probe: { track: 'map', stage: MAP.SCOUTED_AREA } };
    return { kind: 'talk', npc: 'denulth', label: 'Denulth: map + combination -> complete', want: DP_WANT.none };
}

/** Quest items whose presence pins a stage window (floorFromInventory) — part of the progress signature. */
const QUEST_ITEMS: readonly number[] = [DP_OBJ.IOU, DP_OBJ.COMBINATION, DP_OBJ.SECRET_MAP, DP_OBJ.CLIMBING_BOOTS, DP_OBJ.SPIKED_BOOTS, DP_OBJ.CERTIFICATE, DP_OBJ.ASGARNIAN_ALE];
/** Knowledge + quest items: if neither changes across an action, the action achieved nothing observable. */
export function progressSignature(k: DpKnowledge, has: PackView): string {
    return `${k.equip}/${k.map}/${k.complete ? 1 : 0}/${k.mapGiven ? 1 : 0}/${k.comboGiven ? 1 : 0}|${QUEST_ITEMS.map(o => has(o)).join(',')}`;
}
/**
 * ⛔ NO GUESSING. The same action repeated `limit` times in a row with an unchanged progressSignature means the driver
 * does not know the real state (or the world refuses the step) — stop with a reason instead of advancing a stage on
 * no evidence (the old no-progress bump) or looping forever (the 'replacement map (for Denulth)' wedge).
 */
export class NoProgressGuard {
    private key = ''; private n = 0;
    constructor(readonly limit = 3) {}
    /** Record one finished action. Returns how many times in a row it has now made no progress (0 = progress). */
    note(key: string, before: string, after: string): number {
        if (before !== after) { this.key = ''; this.n = 0; return 0; }
        if (key !== this.key) { this.key = key; this.n = 0; }
        return ++this.n;
    }
    stuck(): boolean { return this.n >= this.limit; }
}

/** Supply leftovers the quest never needs — dropped (in this order) when an NPC is about to hand over an item
 *  into a FULL pack (inv_add overflow goes to the FLOOR under the player, InvOps.ts INV_ADD; Denulth's
 *  certificate was once lost that way). Never coins, food, bread/trout, the iron bar or a quest item. */
export const DP_JUNK: readonly number[] = [343 /* burntfish2 */, 331 /* raw_salmon */, 335 /* raw_trout */, 309 /* fly_fishing_rod */, 314 /* feather */];
/** Talks in which the NPC may inv_add a quest item (cert, boots, map, IOU, combination). */
export function talkMayGrant(a: Extract<DpAction, { kind: 'talk' }>): boolean {
    if (a.npc === 'tenzing' || a.npc === 'harold') return true;
    return a.npc === 'denulth' && a.label !== 'Denulth: map + combination -> complete';
}

// =====================================================================================================================
// THE BOT — QuestRunnerBot + text knowledge + the dice/shop/count-dialog hooks + small tick-driven loc/obj tasks
// =====================================================================================================================
type TaskKind = 'oploc' | 'walk' | 'balls' | 'held' | 'shop';
interface Task {
    kind: TaskKind; label: string;
    stand?: Tile; loc?: { x: number; z: number; id: number; op: number };
    obj?: number;
    until: () => boolean;
    retryTicks: number; budget: number;    // ops allowed (oploc/held) or ticks (walk/balls/shop)
    tries: number; lastOp: number; startTick: number;
    result: 'run' | 'ok' | 'fail';
    why?: string;
}

export class DeathPlateauBot extends QuestRunnerBot {
    k: DpKnowledge = freshKnowledge();
    /** fired whenever the knowledge changes (persist hook) */
    onKnowledge: ((k: DpKnowledge, why: string) => void) | null = null;
    log: (s: string) => void = s => console.log(s);
    task: Task | null = null;
    /** pages driven during the current talk (probe accounting) */
    pagesSeen = 0;
    factsSeen = 0;
    // ---- dice ----
    pendingBet = 0;
    betSentTick = -1;
    lastRoll: { bet: number; text: string; tick: number } | null = null;
    private diceOpen = false; private diceRolled = -1; private diceResumed = -1; private diceBet = 0; private diceLastText = '';
    // ---- shop ----
    wantAle = false;
    private shopSeenTick = -1;
    private lastMsgTick = -1;
    private labelWait = -1;

    /** per-component IF_SETTEXT revision: a RE-SENT identical line (the same NPC sentence in a later talk) is a new event */
    private ifTextRev = new Map<number, number>();
    private lastRev = new Map<number, number>();

    constructor() {
        super(); this.steps = []; this.done = true;
        // ⛔ observe() used to dedupe by TEXT, so when an NPC said the same line in a later talk (Tenzing's "Has Dunstan
        // added spikes...?" on every retry) the component's text did not change and the line was never seen again.
        // Count every IF_SETTEXT instead (LeanBot's decoder only ever calls ifText.set).
        const revs = this.ifTextRev;
        this.ifText = new (class extends Map<number, string> {
            override set(k: number, v: string): this { revs.set(k, (revs.get(k) ?? 0) + 1); return super.set(k, v); }
        })(this.ifText);
    }

    // ---- KNOWLEDGE INTAKE -----------------------------------------------------------------------------------------
    /** Scan IF_SETTEXT changes and new MESSAGE_GAME lines for facts. Cheap; called from every hook. */
    observe(): void {
        // ⛔ ~chatnpc / ~chatplayer / ~objbox SPLIT a line at 380px across up to four text components
        // (interface_chat/scripts/chat.rs2:323-333 split_init), so a sentence can arrive as two IF_SETTEXTs. The
        // components that changed together are one page: join them in component order and match the whole.
        const fresh: Array<[number, string]> = [];
        for (const [c, t] of this.ifText) {
            const rev = this.ifTextRev.get(c) ?? 0;
            if (this.lastRev.get(c) === rev) continue;
            this.lastRev.set(c, rev);
            if (t) fresh.push([c, t]);
        }
        if (fresh.length) this.fact(fresh.sort((a, b) => a[0] - b[0]).map(f => f[1]).join(' '));
        const msgs = this.getChat({ types: [0], limit: 0, includeSelf: true } as any) as Array<{ tick: number; text: string }>;
        // every line stamped at/after the previous observe() (dedup by tick+text: a tick can be scanned twice)
        for (const m of msgs) {
            if (m.tick < this.lastMsgTick) continue;
            const key = `${m.tick}:${m.text}`;
            if (this.seenMsgs.has(key)) continue;
            this.seenMsgs.add(key);
            this.fact(m.text);
        }
        if (this.lastMsgTick !== this.tickCount) {
            this.lastMsgTick = this.tickCount;
            for (const key of this.seenMsgs) if (Number(key.slice(0, key.indexOf(':'))) < this.lastMsgTick) this.seenMsgs.delete(key);
        }
    }
    private seenMsgs = new Set<string>();
    private fact(text: string): void {
        const before = JSON.stringify(this.k);
        const hit = applyText(this.k, text);
        if (hit) this.factsSeen++;
        if (JSON.stringify(this.k) !== before) {
            const why = `"${text.slice(0, 80)}"`;
            this.log(`[dp] ${this.loginUser}: fact ${why} -> equip>=${this.k.equip} map>=${this.k.map}${this.k.complete ? ' COMPLETE' : ''}`);
            this.onKnowledge?.(this.k, why);
        }
    }
    has = (obj: number): number => this.countOf(obj);
    journal(): Journal {
        const q = this.questState('death') as { status: string };
        const s = q?.status;
        return s === 'COMPLETE' || s === 'IN_PROGRESS' || s === 'NOT_STARTED' ? s : 'NOT_OBSERVABLE';
    }

    // ---- DIALOG: text policy (dialogPolicy) with a short wait for trailing option labels -------------------------
    protected override driveDialog(): void {
        this.observe();
        this.pagesSeen++;
        const opts = this.dialogOptions();
        if (opts.length && opts.some(o => !o.text.trim())) {
            if (this.labelWait < 0) this.labelWait = this.tickCount;
            if (this.tickCount - this.labelWait < 3) { this.warm(); return; }   // labels trail IF_OPENCHAT by a tick
        } else this.labelWait = -1;
        super.driveDialog();   // QuestRunnerBot (no step.choices) -> LeanBot: dialogPolicy first, else option 1
    }
    setPolicy(want: readonly RegExp[]): void {
        this.dialogPolicy = [...want.map(m => ({ match: m, label: 'dp-want' })), ...EXIT_OPTIONS.map(m => ({ match: m, label: 'dp-exit' }))];
    }

    // ---- MAIN MODALS: the dice game, the pub shop; everything else -> base (dismiss) ------------------------------
    protected override handleMainModal(): boolean {
        this.observe();
        if (this.mainModalId === DP_IF.DICE_ROOT) {
            if (!this.diceOpen) { this.diceOpen = true; this.diceRolled = -1; this.diceResumed = -1; this.diceBet = this.lastBetSent; }
            const t = this.ifText.get(DP_IF.DICE_STATUS) ?? '';
            // DIAG ( sim review): live never logged "You win!/You lose!" (63 rolls, 8 bets lost) while the sim's
            // scripted dice test passes — log every status-text change with the tick, to see what the live client receives
            if (t !== this.diceLastText) { this.log(`[dp] ${this.loginUser}: dice text '${t}' modal=${this.mainModalId} t=${this.tickCount}`); this.diceLastText = t; }
            if (/^Your roll/.test(t) && (this.diceRolled < 0 || this.tickCount - this.diceRolled > 12)) {
                // com_27 (the roll layer) is un-hidden on the same tick this text is set (death_guard_equiproom.rs2:99-100);
                // IF_BUTTON on a hidden component is dropped by the server (IfButtonHandler isComponentVisible)
                this.ifButton(DP_IF.DICE_ROLL); this.diceRolled = this.tickCount;
                this.log(`[dp] ${this.loginUser}: dice — rolling (bet ${this.diceBet})`);
                return true;
            }
            // FALLBACK OUTCOME ( sim review): ~dice_winnings mes()es "Harold has given you your winnings!" / "You give
            // Harold his winnings." on the SAME tick it sets the result text — if the text never shows (live: 63 rolls, no
            // result line) the message still decides the roll, and the resume below closes the paused modal.
            if (this.diceRolled >= 0 && this.diceResumed < 0 && !/^You (win|lose)!/.test(t)) {
                const m = this.chatLog.all().slice(-12).reverse().find(c => c.tick >= this.diceRolled && /Harold has given you your winnings!|You give Harold his winnings\./.test(c.text));
                if (m) {
                    const won = /given you your winnings/.test(m.text);
                    this.lastRoll = { bet: this.diceBet, text: won ? 'You win!' : 'You lose!', tick: this.tickCount };
                    this.log(`[dp] ${this.loginUser}: dice — outcome from message "${m.text}" (status text '${t}') — resuming`);
                    (this as any).sendResume(DP_IF.DICE_CONTINUE); this.diceResumed = this.tickCount;
                    return true;
                }
            }
            if (/^You (win|lose)!/.test(t) && this.diceRolled >= 0 && (this.diceResumed < 0 || this.tickCount - this.diceResumed > 6)) {
                if (this.diceResumed < 0) { this.lastRoll = { bet: this.diceBet, text: t, tick: this.tickCount }; this.log(`[dp] ${this.loginUser}: dice — ${t} (bet ${this.diceBet})`); }
                // p_pausebutton (:123) is answered by RESUME_PAUSEBUTTON — an IF_BUTTON on com_30 finds no
                // [if_button] script and is NOT a registered resume button (IfButtonHandler), so it would do nothing.
                (this as any).sendResume(DP_IF.DICE_CONTINUE);
                this.diceResumed = this.tickCount;
                return true;
            }
            this.warm();
            return true;   // NEVER let branch (c) close it: closing before the roll forfeits the stake (haroldgamble_end)
        }
        this.diceOpen = false;
        if (this.mainModalId !== DP_IF.SHOP_MAIN) this.shopSeenTick = -1;
        if (this.mainModalId === DP_IF.SHOP_MAIN && this.wantAle) {
            //  the shop's stock inv can land a tick or more AFTER the modal opens; reading 0 on the open tick
            // closed the shop at once, every retry, forever. Only call it empty after the stock had time to arrive.
            if (this.shopSeenTick < 0) { this.shopSeenTick = this.tickCount; console.log(`[dp] ${this.loginUser}: shop open — ale stock ${this.shopStockOf(DP_OBJ.ASGARNIAN_ALE)}`); }
            const stock = this.shopStockOf(DP_OBJ.ASGARNIAN_ALE);
            if (this.countOf(DP_OBJ.ASGARNIAN_ALE) === 0 && stock <= 0 && this.tickCount - this.shopSeenTick < 6) { this.warm(); return true; }
            if (this.countOf(DP_OBJ.ASGARNIAN_ALE) > 0 || stock <= 0) { if (stock <= 0) console.log(`[dp] ${this.loginUser}: ale stock still ${stock} — closing`); this.wantAle = false; return super.handleMainModal(); }
            if (this.shopClickReady()) this.shopBuy(DP_OBJ.ASGARNIAN_ALE, 1); else this.warm();
            return true;
        }
        return super.handleMainModal();
    }
    private lastBetSent = 0;

    // ---- THE TICK: count dialog, then a task, then the QuestRunner step machine -----------------------------------
    protected override doCombat(): void {
        this.observe();
        if (!this.backpack()) { this.warm(); return; }
        if (this.pendingBet > 0 && this.countDialogTick >= 0) {
            // qd:death_guard_equiproom.rs2:227 p_countdialog — the reply is DROPPED unless the prompt is pending
            // (ResumePCountDialogHandler), hence the countDialogTick gate.
            this.submitCountDialog(this.pendingBet);
            this.log(`[dp] ${this.loginUser}: bet ${this.pendingBet} entered`);
            this.lastBetSent = this.pendingBet; this.betSentTick = this.tickCount; this.pendingBet = 0;
            return;
        }
        if (this.task && this.task.result === 'run') {
            if (this.tryHeal()) return;
            this.runTask(this.task);
            return;
        }
        super.doCombat();
    }

    startTask(t: Omit<Task, 'tries' | 'lastOp' | 'startTick' | 'result'>): Task {
        this.task = { ...t, tries: 0, lastOp: -100, startTick: this.tickCount, result: 'run' };
        return this.task;
    }
    private finishTask(t: Task, ok: boolean, why: string): void {
        t.result = ok ? 'ok' : 'fail'; t.why = why;
        this.log(`[dp] ${this.loginUser}: task '${t.label}' ${ok ? 'ok' : 'FAILED'} — ${why}`);
    }
    private onTile(s: Tile): boolean { const me = this.tile(); return me.x === s.x && me.z === s.z; }
    private walkPrev = ''; private walkStall = 0;

    private runTask(t: Task): void {
        if (t.until()) { this.finishTask(t, true, 'condition met'); this.warm(); return; }
        const age = this.tickCount - t.startTick;
        switch (t.kind) {
            case 'walk': {
                if (age > t.budget) { this.finishTask(t, false, `not on (${t.stand!.x},${t.stand!.z}) after ${t.budget} ticks`); return; }
                {   // open a closed door/gate we are wedged against (walkToExact never does;  ball yard)
                    const me = this.tile(); const k = `${me.x},${me.z}`;
                    if (k === this.walkPrev) this.walkStall++; else { this.walkStall = 0; this.walkPrev = k; }
                    if (this.walkStall >= 4 && this.tickCount - t.lastOp >= 6) {
                        const cd = this.doorTracker?.nearestClosed(this.travelLevel, me.x, me.z, 2);
                        if (cd) { console.log(`[dp] ${this.loginUser}: wedged @(${me.x},${me.z}) — opening ${cd.locId}@(${cd.x},${cd.z})`); this.opLoc(cd.x, cd.z, cd.locId, cd.op); t.lastOp = this.tickCount; this.walkStall = 0; return; }
                    }
                }
                if (!this.walkToExact(t.stand!.x, t.stand!.z)) this.warm();
                return;
            }
            case 'oploc': {
                if (t.stand && !this.onTile(t.stand)) {
                    if (age > 200 + t.budget * t.retryTicks) { this.finishTask(t, false, `could not stand on (${t.stand.x},${t.stand.z})`); return; }
                    // walkToExact never opens doors and the pathfinder treats every door as OPEN: a tracked closed
                    // door/gate within 2 tiles (the sherpa yard's fence gates 3725/3726 at x2824) gets opened here
                    const me = this.tile(); const k = `${me.x},${me.z}`;
                    if (k === this.walkPrev) this.walkStall++; else { this.walkStall = 0; this.walkPrev = k; }
                    if (this.walkStall >= 4 && this.tickCount - t.lastOp >= 6) {
                        const cd = this.doorTracker?.nearestClosed(this.travelLevel, me.x, me.z, 2);
                        if (cd) { this.opLoc(cd.x, cd.z, cd.locId, cd.op); t.lastOp = this.tickCount; this.walkStall = 0; return; }
                    }
                    if (!this.walkToExact(t.stand.x, t.stand.z)) this.warm();
                    return;
                }
                if (this.tickCount - t.lastOp < t.retryTicks) { this.warm(); return; }
                if (t.tries >= t.budget) { this.finishTask(t, false, `${t.budget} OPLOCs on ${t.loc!.id}@(${t.loc!.x},${t.loc!.z}) without the outcome`); return; }
                this.opLoc(t.loc!.x, t.loc!.z, t.loc!.id, t.loc!.op);
                t.tries++; t.lastOp = this.tickCount;
                return;
            }
            case 'held': {
                if (this.tickCount - t.lastOp < t.retryTicks) { this.warm(); return; }
                if (t.tries >= t.budget) { this.finishTask(t, false, `${t.budget} OPHELD1 on obj ${t.obj} without the outcome`); return; }
                const slot = this.slotOf(t.obj!);
                if (slot < 0) { this.finishTask(t, false, `obj ${t.obj} not in the pack`); return; }
                this.opHeld1(t.obj!, slot); t.tries++; t.lastOp = this.tickCount;
                return;
            }
            case 'shop': {
                if (age > t.budget) { this.finishTask(t, false, 'no ale after the shop budget'); return; }
                const stand = DP_PLACES.TOSTIG_STAND;
                if (Math.max(Math.abs(this.tile().x - stand.x), Math.abs(this.tile().z - stand.z)) > 1) {
                    // the pub's customer side is reached through its NORTH door
                    const me = this.tile(); const k = `${me.x},${me.z}`;
                    if (k === this.walkPrev) this.walkStall++; else { this.walkStall = 0; this.walkPrev = k; }
                    if (this.walkStall >= 4 && this.tickCount - t.lastOp >= 6) {
                        const cd = this.doorTracker?.nearestClosed(this.travelLevel, me.x, me.z, 2);
                        if (cd) { this.opLoc(cd.x, cd.z, cd.locId, cd.op); t.lastOp = this.tickCount; this.walkStall = 0; return; }
                    }
                    if (!this.walkToExact(stand.x, stand.z)) this.warm();
                    return;
                }
                if (this.tickCount - t.lastOp < t.retryTicks) { this.warm(); return; }
                const n = this.findNearestNpc(n => n.typeId === DP_NPC.TOSTIG);
                if (!n) {
                    if (age % 50 === 0) { const seen = new Set<number>(); for (let i = 0; i < this.npcCount; i++) { const q = this.npcs[this.npcIndices[i]!]; if (q) seen.add(q.typeId); } console.log(`[dp] ${this.loginUser}: Tostig (${DP_NPC.TOSTIG}) not in scene; visible types ${[...seen].join(',')}`); }
                    this.warm(); return;
                }
                //  OPNPC3 from the stand tile (d=2) never opened the shop. Fallbacks: the map's ground ale
                // spawn (m45_55 OBJ "0 26 18: 1905" = 2906,3538, on the counter) and Talk-to (apnpc1 -> "Yes, please." ->
                // ~openshop_activenpc), alternated with Trade.
                const g = this.findGroundItem(new Set([DP_OBJ.ASGARNIAN_ALE]), 6, new Set());
                if (g) { console.log(`[dp] ${this.loginUser}: taking the ground ale @(${g.x},${g.z})`); this.opObj(g.x, g.z, g.obj, 3); t.lastOp = this.tickCount; t.tries++; return; }
                const op = t.tries % 2 === 0 ? 3 : 1;
                if (t.tries % 5 === 0) console.log(`[dp] ${this.loginUser}: OPNPC${op} Tostig idx ${n.index} d=${n.dist} (try ${t.tries})`);
                this.wantAle = true;
                this.opNpc(n.index, op);   // [apnpc3,death_barman] Trade / [apnpc1] Talk-to; both p_aprange(3)
                t.lastOp = this.tickCount; t.tries++;
                return;
            }
            case 'balls': { this.ballsTick(t); return; }
        }
    }

    // ---- BALLS ---------------------------------------------------------------------------------------------------
    private ballAct: { key: string; tick: number; inv: number; ground: string } | null = null;
    private retrigTick = -1;
    private lastPlaceTick = -100;
    ballView(): BallView {
        const items = this.groundItems;
        return {
            onTile: (x, z) => { const out: number[] = []; for (const g of items.values()) if (g.x === x && g.z === z && BALL_IDS.has(g.obj)) out.push(g.obj); return out; },
            held: obj => this.countOf(obj),
        };
    }
    private ballsTick(t: Task): void {
        if (this.tickCount - t.startTick > t.budget) { this.finishTask(t, false, `balls not done in ${t.budget} ticks`); return; }
        const v = this.ballView();
        let a = planBalls(v);
        if (a.kind === 'all-placed') {
            // the unlock check fires inside the LAST placement (quest_death.rs2:91-97). All five seen in place and no
            // message: either our view is stale or the placements happened before found_combo -> lift one and re-place.
            if (this.tickCount - this.lastPlaceTick < 6) { this.warm(); return; }
            if (this.retrigTick >= 0 && (this.lastPlaceTick > this.retrigTick || this.tickCount - this.retrigTick > 150)) {
                this.finishTask(t, false, 'all five in place, re-placed once, still no unlock message (probe the door)'); return;
            }
            if (this.retrigTick < 0) { this.retrigTick = this.tickCount; this.log(`[dp] ${this.loginUser}: all five balls seen in place, no unlock — lifting one to re-trigger the check`); }
            const g = BALL_TARGETS[BALL_TARGETS.length - 1]!;
            a = { kind: 'take', obj: g.obj, x: g.x, z: g.z, stand: g.stand, why: 're-trigger the unlock check' };
        }
        const key = a.kind === 'take' ? `take:${a.obj}@${a.x},${a.z}` : a.kind === 'place' ? `place:${a.obj}` : 'x';
        const stand = a.kind === 'take' ? a.stand : a.kind === 'place' ? a.target.stand : null;
        if (!stand) { this.warm(); return; }
        if (!this.onTile(stand)) { if (!this.walkToExact(stand.x, stand.z)) this.warm(); return; }
        // one op, then let the server answer (inventory / OBJ_ADD / OBJ_DEL) before re-planning
        const invSig = BALL_TARGETS.reduce((s, b) => s + this.countOf(b.obj), 0);
        const groundSig = BALL_TARGETS.map(b => v.onTile(b.x, b.z).join('+')).join('|');
        if (this.ballAct && this.ballAct.key === key && this.ballAct.inv === invSig && this.ballAct.ground === groundSig && this.tickCount - this.ballAct.tick < 8) { this.warm(); return; }
        if (a.kind === 'take') {
            if (this.freePackSlots() <= 0) { this.finishTask(t, false, 'pack full — cannot take a stone ball'); return; }
            this.opObj(a.x, a.z, a.obj, 3);
        } else if (a.kind === 'place') {
            const slot = this.slotOf(a.obj);
            if (slot < 0) { this.warm(); return; }
            this.useItemOnLoc(a.target.x, a.target.z, a.target.locId, a.obj, slot);
            this.lastPlaceTick = this.tickCount;
        }
        this.ballAct = { key, tick: this.tickCount, inv: invSig, ground: groundSig };
    }
    resetBalls(): void { this.ballAct = null; this.retrigTick = -1; this.lastPlaceTick = -100; }

    /** Run ONE talk through the QuestRunner step machine. */
    runTalk(step: QStep, want: readonly RegExp[]): void {
        this.setPolicy(want);
        this.task = null;
        this.pagesSeen = 0; this.factsSeen = 0;
        this.setSteps([step]); this.stepIdx = 0; this.done = false;
        const self = this as any;
        self.phase = 'travel'; self.mlStarted = false; self.attemptSince = -1; self.choiceIdx = 0; self.locOps = 0;
    }

    override status(): string { return `${this.loginUser}:dp[equip>=${this.k.equip} map>=${this.k.map}${this.k.complete ? ' DONE' : ''}${this.task?.result === 'run' ? ` task=${this.task.label}` : ''}]`; }
}

// =====================================================================================================================
// THE ASYNC DRIVER
// =====================================================================================================================
export interface DpStore { load(): Partial<DpKnowledge> | null | undefined; save(k: DpKnowledge): void }
export interface DpDriveOpts {
    findLongPath: (level: number, sx: number, sz: number, dx: number, dz: number) => Array<{ x: number; z: number }>;
    timeoutMs: number;
    shouldStop: () => boolean;
    log?: (s: string) => void;
    /** optional persistence of the knowledge + Harold's purse (strongly recommended: see the header) */
    store?: DpStore;
}

const NPC_SPOT: Record<NpcKey, { type: number; level: number; xz: Tile; room?: 'cave' | 'hut' | 'harold' }> = {
    denulth: { type: DP_NPC.DENULTH, level: 0, xz: { x: DP_PLACES.DENULTH.x, z: DP_PLACES.DENULTH.z } },
    eohric: { type: DP_NPC.EOHRIC, level: 1, xz: { x: DP_PLACES.EOHRIC.x, z: DP_PLACES.EOHRIC.z } },
    harold: { type: DP_NPC.HAROLD, level: 1, xz: { x: 2905, z: 3540 }, room: 'harold' },
    saba: { type: DP_NPC.SABA, level: 0, xz: { x: 2270, z: 4758 }, room: 'cave' },
    tenzing: { type: DP_NPC.TENZING, level: 0, xz: { x: 2821, z: 3556 }, room: 'hut' },
    dunstan: { type: DP_NPC.DUNSTAN, level: 0, xz: { x: 2918, z: 3574 } },
};

/**
 * Drive a logged-in DeathPlateauBot (backpack decoded) through Death Plateau. Resolves true when the quest is
 * complete (journal green / Denulth's reward lines), false on timeout / stop / a missing supply (logged).
 */
export async function driveDeathPlateau(bot: any, opts: DpDriveOpts): Promise<boolean> {
    const b = bot as DeathPlateauBot;
    const log = opts.log ?? ((s: string) => console.log(s));
    b.log = log;
    const t0 = Date.now();
    const stop = () => opts.shouldStop() || Date.now() - t0 > opts.timeoutMs || b.disposed;
    const me = () => b.tile();
    const lvl = () => ((b as any).minusedlevel ?? b.travelLevel ?? 0) as number;
    const pos = () => `(${me().x},${me().z},L${lvl()})`;
    const pocket = () => pocketOf(lvl(), me().x, me().z);
    const save = () => { try { opts.store?.save(b.k); } catch (e) { log(`[dp] store.save failed: ${(e as Error).message}`); } };
    b.onKnowledge = () => save();

    // ---- boot: wait for the pack + the login journal burst, then seed the knowledge ----
    for (let i = 0; i < 100 && !stop() && (!b.backpack() || (me().x === 0 && me().z === 0)); i++) await sleep(300);
    await sleep(2000);
    try { const s = opts.store?.load(); if (s) Object.assign(b.k, s); } catch (e) { log(`[dp] store.load failed: ${(e as Error).message}`); }
    b.observe();

    // ---- helpers ----
    const waitFor = async (pred: () => boolean, ms: number): Promise<boolean> => {
        const t = Date.now();
        while (!pred() && Date.now() - t < ms && !stop()) await sleep(600);
        return pred();
    };
    const runTask = async (t: Parameters<DeathPlateauBot['startTask']>[0], ms: number): Promise<boolean> => {
        const task = b.startTask(t);
        await waitFor(() => task.result !== 'run', ms);
        if (task.result === 'run') { task.result = 'fail'; task.why = 'driver timeout'; log(`[dp] ${b.loginUser}: task '${task.label}' TIMED OUT @ ${pos()}`); }
        b.task = null;
        return task.result === 'ok';
    };
    const travel = async (level: number, x: number, z: number, near: number, ms: number): Promise<boolean> => {
        const d = () => Math.max(Math.abs(me().x - x), Math.abs(me().z - z));
        const ok = () => lvl() === level && d() <= near;
        if (ok()) return true;
        b.startMultiTravel(level, x, z);
        const t = Date.now();
        while (!ok() && Date.now() - t < ms && !stop()) {
            if (b.arrived && !ok()) {
                // base travel calls "within 6" ARRIVED, so a tighter `near` re-planned and "arrived" forever (,
                // pub + ball yard). Finish short hops with the exact-tile walk instead.
                if (lvl() === level && d() <= 8) { await walk({ level, x, z } as Tile, `final approach (${x},${z})`, 80); if (!ok()) await sleep(1500); continue; }
                b.startMultiTravel(level, x, z);
            }
            await sleep(1500);
        }
        b.arrived = true;
        return ok();
    };
    const useDoor = async (d: { loc: { x: number; z: number; id: number; op: number }; stand: Tile; level: number }, label: string, until: () => boolean): Promise<boolean> =>
        runTask({ kind: 'oploc', label, stand: d.stand, loc: d.loc, until, retryTicks: 14, budget: 5 }, 120_000);
    const walk = async (s: Tile, label: string, ticks = 160): Promise<boolean> =>
        runTask({ kind: 'walk', label, stand: s, until: () => me().x === s.x && me().z === s.z, retryTicks: 1, budget: ticks }, ticks * 700);

    // Leave whatever sealed pocket we are in, toward `to` (another pocket, or null = the open world).
    const leavePocket = async (to: Pocket | null): Promise<void> => {
        for (let guard = 0; guard < 6 && !stop(); guard++) {
            const p = pocket();
            if (p === to || p === null) return;
            log(`[dp] ${b.loginUser}: in the ${p} pocket @ ${pos()} -> heading for ${to ?? 'the open world'}`);
            {
                if (p === 'cave') await useDoor(DP_DOORS.CAVE_EXIT, 'leave the hermit cave', () => pocket() !== 'cave');
                else if (p === 'harold') await useDoor(DP_DOORS.HAROLD_IN, "leave Harold's room", () => pocket() !== 'harold');
                else if (p === 'hut') {
                    if (to === 'yard' || to === 'north') await useDoor(DP_DOORS.SHERPA_BACK_IN, 'hut -> yard (back door)', () => pocket() === 'yard');
                    else await useDoor(DP_DOORS.SHERPA_FRONT_IN, 'hut -> outside (front door)', () => pocket() !== 'hut');
                } else if (p === 'yard') {
                    if (to === 'north') await useDoor(DP_DOORS.STILE_SOUTH, 'yard -> secret path (stile)', () => pocket() === 'north');
                    else await useDoor(DP_DOORS.SHERPA_BACK_OUT, 'yard -> hut (back door)', () => pocket() === 'hut');
                } else if (p === 'north') {
                    if (!(me().x === 2817 && me().z === 3564)) await walk(DP_DOORS.STILE_NORTH.stand, 'secret path -> stile', 260);
                    await useDoor(DP_DOORS.STILE_NORTH, 'secret path -> yard (stile)', () => pocket() === 'yard');
                }
            }
        }
    };
    const enterRoom = async (room: 'cave' | 'hut' | 'harold'): Promise<boolean> => {
        if (pocket() === room) return true;
        await leavePocket(room === 'hut' && (pocket() === 'yard' || pocket() === 'north') ? 'hut' : null);
        if (pocket() === room) return true;
        const d = room === 'cave' ? DP_DOORS.CAVE_ENTRANCE : room === 'hut' ? DP_DOORS.SHERPA_FRONT_OUT : DP_DOORS.HAROLD_OUT;
        if (!await travel(d.level, d.stand.x, d.stand.z, 4, 8 * 60_000)) { log(`[dp] ${b.loginUser}: could not reach the ${room} door stand (${d.stand.x},${d.stand.z},L${d.level}) — stuck @ ${pos()}`); return false; }
        return useDoor(d, `enter the ${room}`, () => pocket() === room);
    };

    const talk = async (a: Extract<DpAction, { kind: 'talk' }>): Promise<{ ok: boolean; pages: number; facts: number }> => {
        const spot = NPC_SPOT[a.npc];
        if (spot.room) { if (!await enterRoom(spot.room)) return { ok: false, pages: 0, facts: 0 }; }
        else await leavePocket(null);
        const inRoom = !!spot.room;
        const saved = b.doorTracker; if (inRoom) b.doorTracker = null;
        b.travelEnabled = !inRoom;
        b.runTalk({ npcType: spot.type, xz: spot.xz, level: spot.level, op: 'talk', label: a.label }, a.want);
        await waitFor(() => b.done, 10 * 60_000);
        b.travelEnabled = true; b.doorTracker = saved;
        // let trailing pages / objboxes land, then read them
        await waitFor(() => b.chatModalId === -1 && b.mainModalId === -1, 15_000);
        b.observe();
        return { ok: b.done, pages: b.pagesSeen, facts: b.factsSeen };
    };

    // ---- pre-flight: room for the quest items (boots + certificate + ale + IOU/ combination + a ball) ----
    const freeUp = async () => {
        for (let i = 0; i < 6 && b.freePackSlots() < 3 && b.countOf(DP_OBJ.SHARK) > 0 && !stop(); i++) {
            const s = b.slotOf(DP_OBJ.SHARK); if (s >= 0) b.opHeld1(DP_OBJ.SHARK, s);
            log(`[dp] ${b.loginUser}: pack nearly full (${b.freePackSlots()} free) — eating a shark to make room`);
            await sleep(2400);
        }
    };

    // ---- room for an item an NPC is about to hand over: a full pack drops it on the FLOOR (InvOps.ts INV_ADD overflow) ----
    const ensureRoom = async (why: string): Promise<boolean> => {
        await freeUp();
        for (let i = 0; i < 6 && b.freePackSlots() < 1 && !stop(); i++) {
            const junk = DP_JUNK.find(o => b.slotOf(o) >= 0);
            if (junk === undefined) break;
            log(`[dp] ${b.loginUser}: pack full before '${why}' — dropping obj ${junk} (supply leftover) so the quest item lands in the pack`);
            b.dropItem(junk, b.slotOf(junk));
            await waitFor(() => b.slotOf(junk) < 0 || b.freePackSlots() >= 1, 4000);
        }
        return b.freePackSlots() >= 1;
    };

    const progress = new NoProgressGuard(3);
    let gambleStuck = 0;
    /** after an action: true = stop the driver (the same action made no observable progress `limit` times running) */
    const noProgress = (key: string, before: string): boolean => {
        floorFromInventory(b.k, b.has, b.journal());
        const n = progress.note(key, before, progressSignature(b.k, b.has));
        if (n === 0) return false;
        log(`[dp] ${b.loginUser}: '${key}' changed nothing (equip>=${b.k.equip} map>=${b.k.map}) — NOT advancing any stage on no evidence (${n}/${progress.limit})`);
        if (!progress.stuck()) return false;
        log(`[dp] ${b.loginUser}: ⛔ '${key}' made no progress ${progress.limit}x in a row — stopping instead of guessing (equip>=${b.k.equip} map>=${b.k.map} @ ${pos()})`);
        return true;
    };

    let lastLog = 0;
    while (!stop()) {
        const j = b.journal();
        floorFromInventory(b.k, b.has, j);
        if (j === 'COMPLETE' || b.k.complete) { b.k.complete = true; save(); log(`[dp] ${b.loginUser}: DEATH PLATEAU COMPLETE @ ${pos()}`); return true; }
        const a = nextAction(b.k, b.has);
        if (Date.now() - lastLog > 10_000) { log(`[dp] ${b.loginUser}: ${b.status()} journal=${j} next=${a.kind}${a.kind === 'talk' ? `(${a.label})` : ''} @ ${pos()}`); lastLog = Date.now(); }
        if (a.kind === 'done') continue;
        if (a.kind === 'need') { log(`[dp] ${b.loginUser}: ⛔ cannot continue — need ${a.what} (equip>=${b.k.equip} map>=${b.k.map})`); return false; }
        await freeUp();

        if (a.kind === 'talk') {
            if (talkMayGrant(a) && !await ensureRoom(a.label)) {
                log(`[dp] ${b.loginUser}: ⛔ cannot continue — need a free pack slot for '${a.label}' (the NPC's item would drop on the floor; nothing droppable in ${DP_JUNK.join('/')})`);
                return false;
            }
            const sigBefore = progressSignature(b.k, b.has);
            if (a.gamble) {
                const plan = nextBet(b.k.purse, b.countOf(DP_OBJ.COINS));
                if (!plan) { log(`[dp] ${b.loginUser}: ⛔ cannot fund the next bet (purse ${b.k.purse ?? '?'}, coins ${b.countOf(DP_OBJ.COINS)})`); return false; }
                b.pendingBet = plan.bet; b.lastRoll = null; b.betSentTick = -1;
                log(`[dp] ${b.loginUser}: gambling — ${plan.why} (bet ${plan.bet})`);
            }
            if (a.gamble) b.countDialogTick = -1;   // never answer a STALE count prompt with the bet
            const coinsBefore = b.countOf(DP_OBJ.COINS);
            const r = await talk(a);
            if (a.gamble) {
                // the count dialog follows the dialog close (if_close; p_countdialog), then the dice modal
                await waitFor(() => b.betSentTick >= 0, 12_000);
                if (b.betSentTick >= 0) await waitFor(() => b.lastRoll !== null, 45_000);
                b.pendingBet = 0;
                if (b.lastRoll) {
                    await waitFor(() => b.countOf(DP_OBJ.IOU) > 0 || (b.mainModalId === -1 && b.chatModalId === -1), 20_000);
                    await sleep(2400);
                    b.observe();
                    const outcome: RollOutcome = b.countOf(DP_OBJ.IOU) > 0 ? 'iou' : /win/i.test(b.lastRoll.text) ? 'win' : 'lose';
                    const prev = b.k.purse;
                    b.k.purse = applyRoll(prev, b.lastRoll.bet, outcome);
                    if (outcome === 'iou' && b.k.equip < EQ.GIVEN_IOU) b.k.equip = EQ.GIVEN_IOU;
                    if (b.k.equip < EQ.GIVEN_ALE) b.k.equip = EQ.GIVEN_ALE;   // a dice game is only offered from given_ale
                    log(`[dp] ${b.loginUser}: roll ${outcome} (bet ${b.lastRoll.bet}) purse ${prev ?? '?'} -> ${b.k.purse ?? '?'} coins ${coinsBefore} -> ${b.countOf(DP_OBJ.COINS)}`);
                    save();
                    continue;
                }
            }
            // ⛔ NO BUMP: a probe that produced no stage evidence leaves the knowledge exactly where it is (see the header).
            if (a.probe && r.pages > 0 && r.facts === 0) log(`[dp] ${b.loginUser}: probe '${a.label}' drove ${r.pages} page(s) and matched no fact — no stage evidence, knowledge unchanged`);
            save();
            // GAMBLE: a dice game is LUCK, and the roll result is not always observed ( no "You win/lose!" line on
            // either account, acct7 still got through on a later bet; acct8 stopped after 3 with 9,562 gp left). Keep
            // betting while nextBet() can fund it (it returns null -> 'cannot fund' stop above) — capped at 12 extra rounds.
            if (a.gamble ? (noProgress(`talk:${a.label}`, sigBefore) && ++gambleStuck > 12) : noProgress(`talk:${a.label}`, sigBefore)) return false;
            if (!r.ok) await sleep(3000);
            continue;
        }
        if (a.kind === 'buy-ale') {
            await leavePocket(null);
            // long-haul only: base travel calls anything within 6 tiles "ARRIVED", so a tolerance-3 travel from just outside
            // the pub wall (2907,3535 -> 4 tiles) re-planned and "arrived" forever. The shop task walks the
            // last tiles itself (through the pub's north door).
            { const me = b.tile(); if (Math.max(Math.abs(me.x - DP_PLACES.TOSTIG_STAND.x), Math.abs(me.z - DP_PLACES.TOSTIG_STAND.z)) > 8) await travel(0, DP_PLACES.TOSTIG_STAND.x, DP_PLACES.TOSTIG_STAND.z, 8, 8 * 60_000); }
            b.setPolicy([/^Yes, please\.$/]);   // Talk-to fallback: "Would you like to buy a drink?" (EXIT_OPTIONS would say "No, thanks.")
            const ok = await runTask({ kind: 'shop', label: 'buy an Asgarnian ale (Tostig)', until: () => b.countOf(DP_OBJ.ASGARNIAN_ALE) > 0 && b.mainModalId !== DP_IF.SHOP_MAIN, retryTicks: 10, budget: 150 }, 150_000);
            b.wantAle = false;
            if (b.mainModalId === DP_IF.SHOP_MAIN) (b as any).sendCloseModalPublic();
            if (!ok) await sleep(5000);
            continue;
        }
        if (a.kind === 'read-iou') {
            const sigBefore = progressSignature(b.k, b.has);
            await runTask({ kind: 'held', label: 'read the IOU', obj: DP_OBJ.IOU, until: () => b.countOf(DP_OBJ.COMBINATION) > 0, retryTicks: 10, budget: 4 }, 60_000);
            await waitFor(() => b.chatModalId === -1, 10_000);
            b.observe();
            if (noProgress('read-iou', sigBefore)) return false;
            continue;
        }
        if (a.kind === 'balls') {
            await leavePocket(null);
            await travel(0, 2893, 3563, 3, 8 * 60_000);
            b.resetBalls();
            const ok = await runTask({ kind: 'balls', label: 'stone balls -> mechanism', until: () => b.k.equip >= EQ.UNLOCKED_DOOR, retryTicks: 1, budget: 1500 }, 1500 * 700);
            if (!ok && b.k.equip < EQ.UNLOCKED_DOOR) {
                // PROBE the equipment-room door: "The door is locked." = still found_combo; a teleport through = unlocked
                b.k.doorLocked = false;
                await useDoor(DP_DOORS.CASTLE_DOOR, 'probe the equipment-room door', () => b.k.doorLocked === true || me().z >= 3567);
                if (me().z >= 3567) {
                    b.k.equip = EQ.UNLOCKED_DOOR; save();
                    log(`[dp] ${b.loginUser}: the equipment-room door OPENED — equip >= unlocked_door`);
                    await useDoor({ ...DP_DOORS.CASTLE_DOOR, stand: { x: 2894, z: 3567 } }, 'step back out of the equipment room', () => me().z <= 3566);
                } else log(`[dp] ${b.loginUser}: equipment-room door still locked — retrying the balls`);
            }
            continue;
        }
        if (a.kind === 'scout') {
            const sigBefore = progressSignature(b.k, b.has);
            await enterRoom('hut');
            await leavePocket('north');
            if (pocket() !== 'north') {
                // a "private property" refusal at the back door is a CEILING (map < got_map) and re-plans on its own
                log(`[dp] ${b.loginUser}: could not reach the secret path @ ${pos()}`);
                if (noProgress('scout', sigBefore)) return false;
                await sleep(3000); continue;
            }
            await walk(SCOUT_TILE, 'walk the secret path into the scouting zone', 400);
            const inZone = me().x >= SCOUT_ZONE.x0 && me().x <= SCOUT_ZONE.x1 && me().z >= SCOUT_ZONE.z0 && me().z <= SCOUT_ZONE.z1;
            await waitFor(() => b.k.map >= MAP.SCOUTED_AREA, 8000);
            if (inZone && b.k.map < MAP.SCOUTED_AREA) {
                // [zone,0_44_56_48_24] fires only at exactly got_map; silence in the zone means we already scouted
                log(`[dp] ${b.loginUser}: in the scouting zone and no message — assuming the area is already scouted`);
                b.k.map = MAP.SCOUTED_AREA; save();
            }
            await leavePocket(null);
            if (noProgress('scout', sigBefore)) return false;
            continue;
        }
    }
    log(`[dp] ${b.loginUser}: driver stopped (${opts.shouldStop() ? 'shouldStop' : 'timeout'}) — ${b.status()} @ ${pos()}`);
    return false;
}

// TROLL STRONGHOLD DRIVER — "Death Plateau complete" -> "law talisman in the pack", and afterwards the
// Dunstan re-issue ("Can I have another law talisman?") that makes the quest a durable LAW TALISMAN SOURCE for
// the law-rune crafters. Modelled on rm-driver.ts (an async orchestration over a LeanBot-derived bot, many
// accounts per process, one shared pathfinder) — but the step list is NOT quest-runner's: most of this quest
// is scripted locs (agility rocks, a teleporting cave, a stronghold door, stairs, a key-gated prison door) and two
// fights, which quest-runner cannot express. Instead every decision is a PURE function of OBSERVABLE state
// (position/plane, pack, journal colour) plus what the bot has LEARNED this run from dialog/game text — so a
// restarted bot resumes from wherever it stands (decideTroll()).
//
// ⛔ OFFLINE-DERIVED, NOT LIVE-PROVEN. Every id/tile below is cited to the content and every walking leg was
// routed offline with rsmod (findLongPath / findPathToLoc / reachedLoc incl. forceapproach) — see
// sim/quest-troll-geo.test.ts. The fights, the rock-climb failure loop and the dialog texts need a live smoke.
//
// CONTENT (server/content/scripts/quests/quest_troll/scripts/*.rs2 unless noted):
//   start   Denulth (npc 1060 death_ig_commander) @ (2896,3528) [m45_55 "0 16 8"] — death_ig_commander.rs2:52-55
//           multi3 "How goes your fight with the trolls?" -> denulth_troll (:79-100) p_choice2 "Is there anything I
//           can do to help?" -> p_choice2 "I'll get Godric back!" -> %troll_quest = ^troll_started (10).
//           Once started, opnpc1 short-circuits into denulth_trollquest (:2-4, :28-48) whose FIRST LINE NAMES THE
//           STAGE — the driver's quest-state oracle (the varp is not transmitted, quest-state.ts:632).
//   boots   death_climbingboots (obj 3105) WORN. Spiked boots (3107) do NOT count and cannot be worn
//           (quest_death.rs2:127-128). After Death Plateau the climbing boots are GONE (Dunstan swapped them for the
//           spiked boots, which Tenzing kept: death_smithy.rs2:183-185, death_sherpa.rs2:100-106), so the driver
//           buys a pair from Tenzing (npc 1071 @ (2820,3556) [m44_55 "0 4 36"]) for 12 gp: death_sherpa.rs2:5-27.
//   route   Burthorpe -> death_climbingrocks_bottom 3723 @ (2880,3594) (worn boots, quest_death.rs2:167-174)
//           -> troll_climbingrocks 3748 @ (2856,3612) (rockslide_obstacle; quest started + worn boots when standing
//           at z=3611, quest_troll.rs2:1-15) -> troll_climbingrocks_top 3790 @ (2859,3626) (:17-43) ->
//           troll_climbingrocks_bottom 3791 @ (2878,3622) (:45-72) -> arena entrance 3782 @ (2897,3618) (:74-88).
//   Dad     troll_champion npc 1125 (lvl 101, hp 120, att 60 str 120 def 50, attackbonus 40 strbonus 70, crush,
//           attackrate 8 -> max hit 27; quest_troll.npc [troll_champion]). Beaten at <20 hp (troll_champion.rs2
//           :104-131: "Stop! You win." + p_choice2 "I'll be going now."). Arena exit 3785 @ (2916,3629) opens only
//           at >= ^troll_defeated_dad (quest_troll.rs2:90-106).
//   north   troll_pass_entrance 3757 @ (2903,3644) -> (2907,10019) underground; troll_pass_exit 3758 @ (2906,10036)
//           -> (2908,3654) (quest_troll.rs2:121-127); walk to troll_stronghold_door 3771 @ (2839,3689) -> level 2
//           (2837,10090) (:197-199).
//   key     Troll General (1115/1116/1117, lvl 113, hp 140, max hit 38!) drops troll_key_prison 3135 while
//           troll_quest < entered_prison (drop tables/troll_commander.rs2:1-7).
//   prison  L2 stairstop 3789 @ (2843,10108) -> L1 (2841,10108); prison door 3780 @ (2848,10107) L1 (key consumed
//           once, sets ^troll_entered_prison: quest_troll.rs2:222-233); L1 stairstop 3789 @ (2852,10107) -> L0
//           (2852,10105) (:204-211).
//   Godric  pickpocket Twig (1128, op3, thieving 30; 99 = never fails: troll_stronghold_camp_guard.rs2:41-71) for
//           troll_key_godric 3136 (or kill: mountain_troll.rs2:5-8), op1 cell door 3767 @ (2832,10078)
//           (quest_troll.rs2:241,261-280) -> ^troll_freed_godric.
//   out     troll_stronghold_exit 3761 @ (2823,10048) -> (2827,3646) (:116-119), back over 3748 @ (2834,3628),
//           3748 @ (2856,3612), death_climbingrocks_top 3722 @ (2880,3595) (worn boots).
//   reward  Dunstan (npc 1082 death_smithy) @ (2919,3574) [m45_55 "0 39 54"] at ^troll_freed_godric ->
//           troll_quest_complete: inv_add(law_talisman 1458) (death_smithy.rs2:1-9, quest_troll.rs2:364-369).
//   reissue Dunstan multi5 "Can I have another law talisman?" — only when complete AND ~obj_gettotal(law_talisman)=0
//           (pack + BANK + worn) AND death map >= given_supplies (death_smithy.rs2:70-90).
//
// Coordinates: mX_Z.jm2 "level lx lz: id shape angle" -> (X*64+lx, Z*64+lz); underground = z+6400.
import { LeanBot, levelForDisplayedXp } from './leanbot.js';

const sleepMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ---- ids (server/content/pack/*.pack) -------------------------------------------------------------------------
export const TROLL_IDS = {
    // npc.pack
    DENULTH: 1060, DUNSTAN: 1082, TENZING: 1071, DAD: 1125,
    GENERALS: [1115, 1116, 1117] as readonly number[],
    TWIG_ASLEEP: 1128, TWIG_AWAKE: 1126, BERRY_ASLEEP: 1129, BERRY_AWAKE: 1127, GODRIC: 1114,
    // obj.pack
    LAW_TALISMAN: 1458, CLIMBING_BOOTS: 3105, SPIKED_BOOTS: 3107,
    PRISON_KEY: 3135, CELL_KEY_GODRIC: 3136, CELL_KEY_EADGAR: 3137, SHARK: 385, COINS: 995,
} as const;

/** %troll_quest stages (quest_troll.constant + general/configs/quest.constant:61). */
export const TROLL_STAGE = { NOT_STARTED: 0, STARTED: 10, DEFEATED_DAD: 20, ENTERED_PRISON: 30, FREED_GODRIC: 40, COMPLETE: 50 } as const;

/** NPC anchors: a walkable tile beside each NPC's spawn (offline-routed from Burthorpe). */
export const TROLL_NPC_AT = {
    DENULTH: { x: 2896, z: 3530 }, DUNSTAN: { x: 2919, z: 3576 }, TENZING: { x: 2821, z: 3557 },
    DAD: { x: 2908, z: 3614 },                      // spawn 0_45_56_32_29 (2912,3613) / map (2911,3612), size 3
    GENERAL_HALL: { x: 2826, z: 10086 },            // L2 west hall: generals @ (2831,10086) (2822,10073) (2829,10100)
    TWIG: { x: 2834, z: 10079 },                    // L0, Twig (2832,10079) size 2; cells x<=2831
} as const;

// ---- geometry --------------------------------------------------------------------------------------------------
export type TrollRegion =
    | 'south' | 'plateau' | 'band' | 'xpocket' | 'mid' | 'east' | 'arena' | 'north' | 'pass' | 'troll'
    | 'L2' | 'L1w' | 'L1e' | 'prison' | 'L0east' | 'unknown';

/**
 * The connected component the bot stands in, between the scripted transitions. Pure; rectangles + one diagonal
 * rule, verified tile-for-tile against rsmod connectivity in sim/quest-troll-geo.test.ts.
 *
 * The one ambiguous strip is z 3585-3611 x 2830-2885: the Death Plateau shelf ('south', walkable from Burthorpe)
 * interleaves with the corridor ABOVE the Death Plateau rocks ('plateau', reachable only by climbing 3723). The
 * west diagonal path (z - x >= 761) and the east corridor (x >= 2880 or x + z >= 6478, z >= 3596) belong to
 * 'plateau'; so does everything at z >= 3607.
 */
export function classifyRegion(level: number, x: number, z: number): TrollRegion {
    if (z > 6400) {
        if (level === 0 && x >= 2880 && x <= 2935 && z >= 10000 && z <= 10045) return 'pass';
        if (x >= 2816 && x <= 2879 && z >= 10046 && z <= 10112) {
            if (level === 2) return 'L2';
            if (level === 1) return (x >= 2848 && x <= 2858 && z >= 10100) ? 'L1e' : 'L1w';
            if (level === 0) return (x <= 2843 || z >= 10102) ? 'prison' : 'L0east';
        }
        return 'unknown';
    }
    if (level !== 0) return 'unknown';
    if (x >= 2897 && x <= 2924 && z >= 3598 && z <= 3628) return 'arena';      // troll_champion.rs2:44 inzone
    if (z >= 3648 && z <= 3720 && x >= 2816 && x <= 2940) return 'troll';
    if (z >= 3629 && z <= 3647 && x >= 2880 && x <= 2935) return 'north';
    if (x >= 2880 && x <= 2896 && z >= 3612 && z <= 3628) return 'east';
    if (x >= 2861 && x <= 2877 && z >= 3615 && z <= 3628) return 'mid';
    if (x >= 2821 && x <= 2836 && z >= 3629 && z <= 3647) return 'xpocket';
    if (x >= 2826 && x <= 2858 && z >= 3612 && z <= 3628) return 'band';
    if (x >= 2830 && x <= 2885 && z >= 3585 && z <= 3611) {
        const plateau = z >= 3607 || (z >= 3596 && (x >= 2880 || x + z >= 6478)) || (z - x >= 761);
        return plateau ? 'plateau' : 'south';
    }
    return 'south';
}

/** The lowest %troll_quest stage that standing in `r` proves (you cannot get there otherwise). */
export function regionFloor(r: TrollRegion): number {
    switch (r) {
        case 'band': case 'xpocket': case 'mid': case 'east': case 'arena': return TROLL_STAGE.STARTED;   // 3748 checks started
        case 'north': case 'pass': case 'troll': case 'L2': case 'L1w': case 'L0east': return TROLL_STAGE.DEFEATED_DAD;
        case 'L1e': case 'prison': return TROLL_STAGE.ENTERED_PRISON;
        default: return -1;
    }
}

export interface Pos { level: number; x: number; z: number }
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** A scripted loc the driver walks up to (EXACT stand tile, rsmod reachedLoc incl. forceapproach) and OPLOCs. */
export interface TrollTransition {
    id: string; level: number;
    stand: { x: number; z: number };
    loc: { id: number; x: number; z: number; op: number };
    landed: (p: Pos) => boolean;
    needsBoots?: boolean;
    /** game/dialog text that means "refused" — the transition stops early and the knowledge is updated */
    refuse?: RegExp;
    cite: string;
}

export const TROLL_T: Record<string, TrollTransition> = {
    DP_UP: { id: 'DP_UP', level: 0, stand: { x: 2880, z: 3593 }, loc: { id: 3723, x: 2880, z: 3594, op: 1 }, needsBoots: true,
        // z >= 3596: the script force-moves to z+2 (3595, still 'south' in classifyRegion) and only then teleports to z+3 — a
        // landing at 3595 re-chose DP_UP, which returned 'ok' at once, a hot loop that froze the process
        landed: p => p.level === 0 && p.z >= 3596 && cheb(p, { x: 2880, z: 3596 }) <= 1, refuse: /need climbing boots/i,
        cite: 'death_climbingrocks_bottom m45_56 "0 0 10: 3723 22"; quest_death.rs2:167-174 force z+2 then +1' },
    DP_DOWN: { id: 'DP_DOWN', level: 0, stand: { x: 2880, z: 3596 }, loc: { id: 3722, x: 2880, z: 3595, op: 1 }, needsBoots: true,
        landed: p => p.level === 0 && cheb(p, { x: 2880, z: 3593 }) <= 1, refuse: /need climbing boots/i,
        cite: 'death_climbingrocks_top m45_56 "0 0 11: 3722 22"; quest_death.rs2:158-165 exactmove z-3' },
    RS_N: { id: 'RS_N', level: 0, stand: { x: 2856, z: 3611 }, loc: { id: 3748, x: 2856, z: 3612, op: 1 }, needsBoots: true,
        landed: p => p.level === 0 && p.z >= 3613 && cheb(p, { x: 2856, z: 3613 }) <= 2, refuse: /need some climbing boots|need a good reason/i,
        cite: 'troll_climbingrocks m44_56 "0 40 28: 3748 10 2"; quest_troll.rs2:1-15 + upass_obstacles.rs2 rockslide_obstacle (agility 160/300, 3 dmg on a slip)' },
    RS_S: { id: 'RS_S', level: 0, stand: { x: 2856, z: 3613 }, loc: { id: 3748, x: 2856, z: 3612, op: 1 },
        landed: p => p.level === 0 && p.z <= 3611 && cheb(p, { x: 2856, z: 3611 }) <= 2,
        cite: 'same rock from the north (no boots check: coordz != 3611)' },
    R2834_S: { id: 'R2834_S', level: 0, stand: { x: 2834, z: 3629 }, loc: { id: 3748, x: 2834, z: 3628, op: 1 },
        landed: p => p.level === 0 && p.z <= 3627 && cheb(p, { x: 2834, z: 3627 }) <= 2, refuse: /need a good reason/i,
        cite: 'troll_climbingrocks m44_56 "0 18 44: 3748 10 2"' },
    CLIMB1_E: { id: 'CLIMB1_E', level: 0, stand: { x: 2858, z: 3626 }, loc: { id: 3790, x: 2859, z: 3626, op: 1 },
        landed: p => p.level === 0 && p.x >= 2861 && p.x <= 2877 && p.z >= 3615 && p.z <= 3628,
        cite: 'troll_climbingrocks_top m44_56 "0 43 42: 3790 22 2"; quest_troll.rs2:17-43 exactmove x+3 (agility 15, 170/253)' },
    CLIMB1_W: { id: 'CLIMB1_W', level: 0, stand: { x: 2861, z: 3626 }, loc: { id: 3791, x: 2860, z: 3626, op: 1 },
        landed: p => p.level === 0 && p.x <= 2858 && p.z >= 3612 && p.z <= 3628,
        cite: 'troll_climbingrocks_bottom m44_56 "0 44 42: 3791 22 2"; quest_troll.rs2:45-72 forcemove x-2 then x-1' },
    CLIMB2_E: { id: 'CLIMB2_E', level: 0, stand: { x: 2877, z: 3622 }, loc: { id: 3791, x: 2878, z: 3622, op: 1 },
        landed: p => p.level === 0 && p.x >= 2880 && p.x <= 2896 && p.z >= 3612 && p.z <= 3628,
        cite: 'troll_climbingrocks_bottom m44_56 "0 62 38: 3791 22 3"; quest_troll.rs2:45-72 forcemove x+2 then x+1' },
    CLIMB2_W: { id: 'CLIMB2_W', level: 0, stand: { x: 2880, z: 3622 }, loc: { id: 3790, x: 2879, z: 3622, op: 1 },
        landed: p => p.level === 0 && p.x <= 2877 && p.x >= 2861 && p.z >= 3615 && p.z <= 3628,
        cite: 'troll_climbingrocks_top m44_56 "0 63 38: 3790 22 1"; exactmove x-3' },
    ARENA_IN: { id: 'ARENA_IN', level: 0, stand: { x: 2896, z: 3618 }, loc: { id: 3782, x: 2897, z: 3618, op: 1 },
        landed: p => p.level === 0 && classifyRegion(p.level, p.x, p.z) === 'arena',
        cite: 'troll_stronghold_arena_entrance_left m45_56 "0 17 34: 3782 0"; quest_troll.rs2:74-88 (door teleports you onto (2897,3618))' },
    ARENA_OUT_W: { id: 'ARENA_OUT_W', level: 0, stand: { x: 2897, z: 3618 }, loc: { id: 3782, x: 2897, z: 3618, op: 1 },
        landed: p => p.level === 0 && classifyRegion(p.level, p.x, p.z) === 'east',
        cite: 'same door from ON its tile: check_axis true -> dest (2896,3618)' },
    ARENA_EXIT: { id: 'ARENA_EXIT', level: 0, stand: { x: 2916, z: 3628 }, loc: { id: 3785, x: 2916, z: 3629, op: 1 },
        landed: p => p.level === 0 && classifyRegion(p.level, p.x, p.z) === 'north', refuse: /No human pass through arena/i,
        cite: 'troll_stronghold_arena_exit_left m45_56 "0 36 45: 3785 0 3"; quest_troll.rs2:90-106' },
    PASS_IN: { id: 'PASS_IN', level: 0, stand: { x: 2904, z: 3643 }, loc: { id: 3757, x: 2903, z: 3644, op: 1 },
        landed: p => p.level === 0 && classifyRegion(p.level, p.x, p.z) === 'pass',
        cite: 'troll_pass_entrance m45_56 "0 23 60: 3757 10" (3x2); quest_troll.rs2:121-123 -> 0_45_156_27_35 (2907,10019)' },
    PASS_OUT: { id: 'PASS_OUT', level: 0, stand: { x: 2907, z: 10035 }, loc: { id: 3758, x: 2906, z: 10036, op: 1 },
        landed: p => p.level === 0 && classifyRegion(p.level, p.x, p.z) === 'troll',
        cite: 'troll_pass_exit m45_156 "0 26 52: 3758 10"; quest_troll.rs2:125-127 -> 0_45_57_28_6 (2908,3654)' },
    SH_DOOR: { id: 'SH_DOOR', level: 0, stand: { x: 2840, z: 3690 }, loc: { id: 3771, x: 2839, z: 3689, op: 1 },
        landed: p => p.level === 2 && p.z > 6400,
        cite: 'troll_stronghold_door m44_57 "0 23 41: 3771 10" (1x3); quest_troll.rs2:197-199 -> 2_44_157_21_42 (2837,10090)' },
    L2_DOWN: { id: 'L2_DOWN', level: 2, stand: { x: 2845, z: 10108 }, loc: { id: 3789, x: 2843, z: 10108, op: 1 },
        landed: p => p.level === 1 && p.z > 6400,
        cite: 'troll_stronghold_stairstop m44_157 "2 27 60: 3789 10 1" (2x2, forceapproach north rotated -> east face); quest_troll.rs2:204-211 -> L1 (2841,10108)' },
    L1_UP: { id: 'L1_UP', level: 1, stand: { x: 2841, z: 10108 }, loc: { id: 3788, x: 2842, z: 10108, op: 1 },
        landed: p => p.level === 2 && p.z > 6400,
        cite: 'troll_stronghold_stairs m44_157 "1 26 60: 3788 10 1"; quest_troll.rs2:213-220 -> L2 (2845,10108)' },
    PRISON_DOOR: { id: 'PRISON_DOOR', level: 1, stand: { x: 2847, z: 10107 }, loc: { id: 3780, x: 2848, z: 10107, op: 1 },
        landed: p => p.level === 1 && classifyRegion(p.level, p.x, p.z) === 'L1e', refuse: /^You need a key\.$/,
        cite: 'troll_stronghold_prison_door_closed m44_157 "1 32 59: 3780 0"; quest_troll.rs2:222-233' },
    L1_DOWN: { id: 'L1_DOWN', level: 1, stand: { x: 2852, z: 10109 }, loc: { id: 3789, x: 2852, z: 10107, op: 1 },
        landed: p => p.level === 0 && classifyRegion(p.level, p.x, p.z) === 'prison',
        cite: 'troll_stronghold_stairstop m44_157 "1 36 59: 3789 10" (forceapproach north); -> L0 (2852,10105)' },
    PRISON_EXIT: { id: 'PRISON_EXIT', level: 0, stand: { x: 2823, z: 10050 }, loc: { id: 3761, x: 2823, z: 10048, op: 1 },
        landed: p => p.level === 0 && p.z < 6400,
        cite: 'troll_stronghold_exit m44_157 "0 7 0: 3761 10 2"; quest_troll.rs2:116-119 -> 0_44_56_11_62 (2827,3646)' },
};

/** Godric's cell door (op1 Unlock with Cell key 1 in the pack) and its stand tile (reachedLoc-verified). */
export const GODRIC_CELL = { stand: { x: 2832, z: 10078 }, loc: { id: 3767, x: 2832, z: 10078, op: 1 } } as const;

// ---- knowledge -----------------------------------------------------------------------------------------------
/** What this run has PROVEN about %troll_quest: an interval [lb, ub]. The varp is never transmitted. */
export interface TrollKnowledge {
    lb: number; ub: number;
    oracleDone: boolean;        // Denulth consulted this run (his first line names the stage)
    prereqMissing: boolean;     // Denulth answered with the not-started-Death-Plateau menu
    bootsRefused: boolean;
    claimNotOffered: boolean;   // Dunstan had no "another law talisman" option
    noRoom: boolean;
    claimed: boolean;
}
export function newKnowledge(): TrollKnowledge {
    return { lb: -1, ub: TROLL_STAGE.COMPLETE, oracleDone: false, prereqMissing: false, bootsRefused: false, claimNotOffered: false, noRoom: false, claimed: false };
}
const raise = (k: TrollKnowledge, v: number) => { if (v > k.lb) k.lb = v; if (k.ub < k.lb) k.ub = k.lb; };
const cap = (k: TrollKnowledge, v: number) => { if (v < k.ub) k.ub = v; if (k.lb > k.ub) k.lb = k.ub; };
const exact = (k: TrollKnowledge, v: number) => { k.lb = v; k.ub = v; };

/** Every server line (dialog page text or game message) this driver understands. Pure; updates `k`. */
export function learnFromText(k: TrollKnowledge, text: string, ctx: { cellKeyHeld?: boolean } = {}): string | null {
    const t = text.replace(/<[^>]*>/g, '').trim();
    const S = TROLL_STAGE;
    // Denulth (death_ig_commander.rs2:28-48) — the oracle
    if (/I have freed Godric!|You should hurry to tell Dunstan/i.test(t)) { exact(k, S.FREED_GODRIC); k.oracleDone = true; return 'freed (Denulth)'; }
    if (/I've found my way into the prison\.|Find a way to free Godric/i.test(t)) { exact(k, S.ENTERED_PRISON); k.oracleDone = true; return 'entered prison (Denulth)'; }
    if (/I've defeated the troll champion!|I've found my way into the stronghold!/i.test(t)) { exact(k, S.DEFEATED_DAD); k.oracleDone = true; return 'defeated Dad (Denulth)'; }
    if (/How are you getting on with rescuing Godric\?|I haven't found a way to climb up yet|God speed friend/i.test(t)) { exact(k, S.STARTED); k.oracleDone = true; return 'started (Denulth)'; }
    if (/We are busy preparing for an attack/i.test(t)) { exact(k, S.COMPLETE); k.oracleDone = true; return 'complete (Denulth)'; }
    if (/We were ambushed by trolls coming from the north/i.test(t)) { cap(k, S.NOT_STARTED); k.oracleDone = true; return 'not started (Denulth)'; }
    if (/Hello citizen/i.test(t)) { k.prereqMissing = true; k.oracleDone = true; return 'Death Plateau NOT complete (Denulth)'; }
    // Dad (troll_champion.rs2:104-131, :151-154)
    if (/Stop! You win\. Not hurt Dad\.|You don't need to fight him again/i.test(t)) { raise(k, S.DEFEATED_DAD); return 'Dad defeated'; }
    if (/No human pass through arena without defeating Dad/i.test(t)) { cap(k, S.DEFEATED_DAD - 1); return 'arena exit refused (Dad not beaten)'; }
    // prison (quest_troll.rs2:222-233, :303-309; troll_stronghold_camp_guard.rs2:64-67)
    if (/^You need a key\.$/.test(t)) { cap(k, S.ENTERED_PRISON - 1); return 'prison door refused (no key, not entered)'; }
    if (/You unlock the prison door/i.test(t)) { raise(k, S.ENTERED_PRISON); return 'entered prison'; }
    if (/Thank you, my friend\.|You have no need to do this\./i.test(t)) { raise(k, S.FREED_GODRIC); return 'Godric freed'; }
    if (/You pick the guard's pocket but find nothing/i.test(t) && !ctx.cellKeyHeld) { raise(k, S.FREED_GODRIC); return 'Twig had no key -> Godric already freed'; }
    // Dunstan (death_smithy.rs2:1-15, :54-68)
    if (/He is safe and sound, thanks to you/i.test(t)) { exact(k, S.COMPLETE); return 'quest complete (Dunstan)'; }
    if (/Have you managed to rescue Godric yet\?/i.test(t)) { cap(k, S.FREED_GODRIC - 1); raise(k, S.STARTED); return 'Dunstan: Godric not freed yet'; }
    if (/Dunstan hands you a law talisman/i.test(t)) { k.claimed = true; return 'law talisman re-issued'; }
    if (/don't have any room to carry it/i.test(t)) { k.noRoom = true; return 'no room for the talisman'; }
    // rocks
    if (/That looks dangerous\. I'll need a good reason/i.test(t)) { cap(k, S.NOT_STARTED); k.oracleDone = false; return 'rocks refused: quest not started'; }
    if (/need (some )?climbing boots/i.test(t)) { k.bootsRefused = true; return 'rocks refused: boots not worn'; }
    if (/You have completed[\s\S]{0,4}Troll Stronghold/i.test(t)) { exact(k, S.COMPLETE); return 'quest complete'; }   // quest_troll.rs2:369 scroll
    return null;
}

// ---- observation + decision ---------------------------------------------------------------------------------
export interface TrollObs {
    pos: Pos;
    region: TrollRegion;
    journal: 'COMPLETE' | 'IN_PROGRESS' | 'NOT_STARTED' | 'NOT_OBSERVABLE';
    lawTalisman: number; bootsWorn: boolean; bootsHeld: number; coins: number;
    prisonKey: number; cellKey: number; food: number;
}
export type TrollAction =
    | { kind: 'done' }
    | { kind: 'fail'; why: string }
    | { kind: 'transition'; t: TrollTransition }
    | { kind: 'talkDenulth' } | { kind: 'buyBoots' } | { kind: 'wearBoots' }
    | { kind: 'fightDad' } | { kind: 'getPrisonKey' } | { kind: 'getCellKey' } | { kind: 'freeGodric' }
    | { kind: 'dunstanComplete' } | { kind: 'dunstanClaim' };

/**
 * THE STEP TABLE. Pure: the next thing to do from what is observable plus what this run has learned.
 * goal 'quest' = complete the quest (its reward IS a law talisman); 'claim' = the Dunstan re-issue only.
 */
export function decideTroll(o: TrollObs, k: TrollKnowledge, goal: 'quest' | 'claim' | 'descend' = 'quest'): TrollAction {
    const S = TROLL_STAGE;
    if (k.prereqMissing) return { kind: 'fail', why: 'Death Plateau is not complete (Denulth offers the Death Plateau menu)' };
    const complete = o.journal === 'COMPLETE' || k.lb >= S.COMPLETE;
    if (o.lawTalisman > 0 && (complete || goal === 'claim')) return { kind: 'done' };
    if (goal === 'claim' && k.claimNotOffered) return { kind: 'fail', why: 'Dunstan offered no law talisman (one exists in the bank/worn, or the quest is not complete)' };
    if (goal === 'claim' && k.noRoom) return { kind: 'fail', why: 'pack full — Dunstan cannot hand the talisman over' };
    if (goal === 'quest' && complete && k.claimNotOffered) return { kind: 'fail', why: 'quest complete but no talisman in the pack and Dunstan will not re-issue (one is banked?)' };
    // 'descend': just get OFF the plateau/stronghold to the south region (the law chain's melee training on the
    // Lumbridge cows: a bot sat at (2881,3596) for 8 h — "route has 0 tiles" — the way down is the boots-only rocks 3722).
    const returning = complete || goal === 'claim' || goal === 'descend' || k.lb >= S.FREED_GODRIC;
    const lb = Math.max(k.lb, regionFloor(o.region));
    const T = TROLL_T;
    const go = (t: TrollTransition): TrollAction => {
        if (t.needsBoots && !o.bootsWorn) {
            if (o.bootsHeld > 0) return { kind: 'wearBoots' };
            if (o.region === 'south') return { kind: 'buyBoots' };
            return { kind: 'fail', why: `climbing boots needed for ${t.id} but none held (region ${o.region})` };
        }
        return { kind: 'transition', t };
    };
    switch (o.region) {
        case 'prison':
            if (returning) return go(T.PRISON_EXIT!);
            return o.cellKey > 0 ? { kind: 'freeGodric' } : { kind: 'getCellKey' };
        case 'L1e': return go(T.L1_DOWN!);
        case 'L1w':
            if (o.prisonKey > 0 || lb >= S.ENTERED_PRISON || k.ub >= S.ENTERED_PRISON) return go(T.PRISON_DOOR!);   // unknown -> try: the door tells
            return go(T.L1_UP!);
        case 'L2':
            if (o.prisonKey > 0 || lb >= S.ENTERED_PRISON || k.ub >= S.ENTERED_PRISON) return go(T.L2_DOWN!);
            return { kind: 'getPrisonKey' };
        case 'troll': return go(T.SH_DOOR!);
        case 'pass': return go(T.PASS_OUT!);
        case 'north': return go(T.PASS_IN!);
        case 'arena':
            if (returning) return go(T.ARENA_OUT_W!);
            if (lb >= S.DEFEATED_DAD || k.ub >= S.DEFEATED_DAD) return go(T.ARENA_EXIT!);   // unknown -> try: refusal says fight
            return { kind: 'fightDad' };
        case 'east': return go(returning ? T.CLIMB2_W! : T.ARENA_IN!);
        case 'mid': return go(returning ? T.CLIMB1_W! : T.CLIMB2_E!);
        case 'band': return go(returning ? T.RS_S! : T.CLIMB1_E!);
        case 'xpocket': return go(T.R2834_S!);
        case 'plateau': return go(returning ? T.DP_DOWN! : T.RS_N!);
        case 'south': {
            if (goal === 'descend') return { kind: 'done' };
            if (goal === 'claim' || complete) return { kind: 'dunstanClaim' };
            if (lb >= S.FREED_GODRIC) return { kind: 'dunstanComplete' };
            if (!k.oracleDone && o.journal !== 'NOT_STARTED') return { kind: 'talkDenulth' };   // learn the exact stage
            if (k.ub < S.STARTED) return { kind: 'talkDenulth' };                               // start it
            if (!o.bootsWorn) return o.bootsHeld > 0 ? { kind: 'wearBoots' } : { kind: 'buyBoots' };
            return go(T.DP_UP!);
        }
        case 'L0east': return { kind: 'fail', why: 'in the stronghold L0 east wing (no route from there is modelled)' };
        default: return { kind: 'fail', why: `position (${o.pos.x},${o.pos.z},L${o.pos.level}) is outside the modelled Troll Stronghold area` };
    }
}

// ---- fight policy ---------------------------------------------------------------------------------------------
export const TROLL_FIGHT = { eatFrac: 0.5, fleeFrac: 0.25, protectMinPrayerLevel: 43 } as const;
export interface FightObs { hp: number; maxHp: number; food: number; prayerPts: number; prayerLevel: number; protectOn: boolean; wantProtect: boolean; targetVisible: boolean }
export interface FightPlan { flee: boolean; eat: boolean; pray: boolean; attack: boolean }
/** Pure: eat at <=50% (a shark heals 20), flee at <=25% with no food, keep Protect from Melee lit while points last. */
export function fightPlan(o: FightObs, t: { eatFrac: number; fleeFrac: number; protectMinPrayerLevel: number } = TROLL_FIGHT): FightPlan {
    const known = o.maxHp > 0 && o.hp >= 0;
    const low = known && o.hp <= Math.floor(o.maxHp * t.eatFrac);
    const critical = known && o.hp <= Math.floor(o.maxHp * t.fleeFrac);
    const flee = critical && o.food === 0 && !(o.protectOn && o.prayerPts > 0);
    return {
        flee,
        eat: !flee && low && o.food > 0,
        pray: !flee && o.wantProtect && !o.protectOn && o.prayerPts > 0 && o.prayerLevel >= t.protectMinPrayerLevel,
        attack: !flee && o.targetVisible,
    };
}

// ---- dialog policy --------------------------------------------------------------------------------------------
/**
 * Which option to click on a choice page, by LABEL (never by position — option order varies with state the bot
 * cannot see). Pure. Unknown pages fall to a safe "leave" option, never to option 1.
 */
export function trollDialogPick(options: readonly string[], s: { wantBoots: boolean; claim: boolean }): RegExp | null {
    const order: Array<RegExp | null> = [
        /^How goes your fight with the trolls\?/,             // death_ig_commander.rs2:8
        /^Is there anything I can do to help\?/,              // :87
        /^I'll get Godric back!/,                             // :92
        s.claim ? /^Can I have another law talisman\?/ : null, // death_smithy.rs2:86
        s.wantBoots ? /^Can I buy some Climbing boots\?/ : null, // death_sherpa.rs2:5
        s.wantBoots ? /^OK, sounds good\./ : null,             // death_sherpa.rs2:10
        /^I'll be going now\./,                              // troll_champion.rs2:116
        /^Nothing, thanks/,                                  // Dunstan / Tenzing exits
        /^No, thanks\./, /^See you about Denulth!/, /^That's all, thanks\./, /^You can't, thanks\./, /^No thanks/,
    ];
    for (const re of order) if (re && options.some(o => re.test(o.trim()))) return re;
    return null;
}

// ---- the bot -------------------------------------------------------------------------------------------------
/**
 * LeanBot shell for the driver: never travels on its own (arrived stays true), heals every tick, and answers
 * choice pages by label via `trollPick` (waiting a tick for labels that trail IF_OPENCHAT).
 */
export class TrollQuestBot extends LeanBot {
    trollPick: ((options: string[]) => RegExp | null) | null = null;
    trollStage = '-';
    tsq = 'idle';
    private labelWait = 0;
    constructor() {
        super();
        this.mode = 'combat'; this.arrived = true; this.quiet = true;
        this.foodObj = TROLL_IDS.SHARK; this.healFrac = TROLL_FIGHT.eatFrac;
    }
    protected override doCombat(): void { if (this.tryHeal()) return; this.warm(); }
    protected override driveDialog(): void {
        const opts = this.dialogOptions();
        if (opts.length && opts.some(o => o.text === '') && this.labelWait < 5) { this.labelWait++; this.warm(); return; }
        this.labelWait = 0;
        if (opts.length && this.trollPick) {
            const re = this.trollPick(opts.map(o => o.text));
            this.dialogPolicy = re ? [{ match: re, label: 'troll' }] : [];
        }
        super.driveDialog();
    }
    trollStatus(): string { return `${this.loginUser}:troll[${this.trollStage}] ${this.tsq}`; }
}

// ---- the driver ----------------------------------------------------------------------------------------------
export interface TrollDriveOpts {
    findLongPath: (level: number, sx: number, sz: number, dx: number, dz: number) => Array<{ x: number; z: number }>;
    timeoutMs: number;
    shouldStop?: () => boolean;
    log?: (s: string) => void;
    /** one game tick (default 600 ms); the sim injects a harness-synchronised tick */
    tick?: () => Promise<void>;
    /** use Protect from Melee in the Dad / General / Twig fights (default true) */
    prayer?: boolean;
}

interface Ctx {
    bot: any; o: TrollDriveOpts; k: TrollKnowledge; goal: 'quest' | 'claim' | 'descend';
    t0: number; lastTexts: Map<number, string>; chatSince: number; seenChat: Set<string>;
    wantBoots: boolean; protectClicks: number; refusals: Map<string, number>;
}

const P = TROLL_IDS;
function prayerBase(bot: any): number { const xp = bot.statXp?.[5]; return typeof xp === 'number' && xp > 0 ? levelForDisplayedXp(xp) : 99; }
function plane(bot: any): number { return typeof bot.minusedlevel === 'number' ? bot.minusedlevel : 0; }
function pos(bot: any): Pos { const t = bot.tile(); return { level: plane(bot), x: t.x, z: t.z }; }
function log(c: Ctx, s: string): void { (c.o.log ?? ((m: string) => console.log(`[troll] ${c.bot.loginUser ?? ''}: ${m}`)))(s); }
function stopped(c: Ctx): boolean { return !!c.o.shouldStop?.() || Date.now() - c.t0 > c.o.timeoutMs; }
async function tick(c: Ctx): Promise<void> { await (c.o.tick ? c.o.tick() : sleepMs(600)); observe(c); }
function dialogOpen(bot: any): boolean { return (bot.chatModalId ?? -1) !== -1; }
function journal(bot: any): TrollObs['journal'] {
    try { const s = bot.questState?.('troll')?.status; return s === 'COMPLETE' || s === 'IN_PROGRESS' || s === 'NOT_STARTED' ? s : 'NOT_OBSERVABLE'; } catch { return 'NOT_OBSERVABLE'; }
}

/** Fold every NEW dialog text / game message into the knowledge. */
function observe(c: Ctx): void {
    const bot = c.bot;
    const cellKeyHeld = (bot.countOf?.(P.CELL_KEY_GODRIC) ?? 0) > 0;
    const texts: string[] = [];
    const it: Map<number, string> | undefined = bot.ifText;
    if (it) for (const [com, t] of it) if (c.lastTexts.get(com) !== t) { c.lastTexts.set(com, t); if (t) texts.push(t); }
    try {
        for (const m of (bot.getChat?.({ types: [0], limit: 40 }) ?? []) as Array<{ text: string; tick: number }>) {
            const key = `${m.tick}:${m.text}`;
            if (m.tick >= c.chatSince && !c.seenChat.has(key)) { c.seenChat.add(key); texts.push(m.text); }
        }
        if (c.seenChat.size > 400) c.seenChat = new Set([...c.seenChat].slice(-200));
    } catch { /* no chat log */ }
    for (const t of texts) {
        const why = learnFromText(c.k, t, { cellKeyHeld });
        if (why) log(c, `learned: ${why} -> stage in [${c.k.lb}, ${c.k.ub}]  ("${t.replace(/<[^>]*>/g, '').slice(0, 70)}")`);
    }
}

function obs(c: Ctx): TrollObs {
    const bot = c.bot; const p = pos(bot);
    const count = (id: number) => bot.countOf?.(id) ?? 0;
    const region = classifyRegion(p.level, p.x, p.z);
    raise(c.k, regionFloor(region));
    return {
        pos: p, region, journal: journal(bot),
        lawTalisman: count(P.LAW_TALISMAN) + (bot.isWorn?.(P.LAW_TALISMAN) ? 1 : 0),
        bootsWorn: !!bot.isWorn?.(P.CLIMBING_BOOTS), bootsHeld: count(P.CLIMBING_BOOTS), coins: count(P.COINS),
        prisonKey: count(P.PRISON_KEY), cellKey: count(P.CELL_KEY_GODRIC), food: count(P.SHARK),
    };
}

/** Corner-walk on the current plane (rm-driver cornerWalkToTrapdoor pattern), opening tracked doors when stuck. */
async function walkTo(c: Ctx, level: number, x: number, z: number, tol = 0, maxTicks = 400): Promise<boolean> {
    const bot = c.bot; let lastKey = ''; let stuck = 0; let sentTo = ''; let sentAt = -100;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (dialogOpen(bot)) { await tick(c); continue; }
        const me = pos(bot);
        if (me.level !== level) return false;
        if (cheb(me, { x, z }) <= tol) return true;
        const key = `${me.x},${me.z}`; stuck = key === lastKey ? stuck + 1 : 0; lastKey = key;
        bot.travelLevel = level;
        if (stuck >= 3 && stuck % 4 === 3 && bot.doorTracker && typeof bot.tryOpenDoor === 'function' && bot.tryOpenDoor(me.x, me.z, 4)) { await tick(c); continue; }
        // quest gates/doors are not in TRAVEL_DOORS;
        // the tracker knows them, and nearestClosed prefers the orthogonal leaf of a 2-leaf gate
        if (stuck >= 5 && stuck % 4 === 1 && bot.doorTracker) { const cd = bot.doorTracker.nearestClosed(level, me.x, me.z, 2); if (cd) { log(c, `wedged @ (${me.x},${me.z}) — opening ${cd.locId}@(${cd.x},${cd.z})`); bot.opLoc(cd.x, cd.z, cd.locId, cd.op); await tick(c); continue; } }
        if (stuck >= 40) { log(c, `walk to (${x},${z},L${level}) WEDGED at (${me.x},${me.z})`); return false; }
        let corners: Array<{ x: number; z: number }> = [];
        try { corners = c.o.findLongPath(level, me.x, me.z, x, z); } catch { /* direct */ }
        const tgt = corners.find(w => cheb(w, me) >= 1) ?? { x, z };
        // Re-send only on a new corner, a stall, or every 5 ticks: a MOVE every tick re-queues the route from the
        // start tile and the server spends the tick popping it (the player never steps — sim-caught).
        const tk = `${tgt.x},${tgt.z}`;
        if (tk !== sentTo || (stuck >= 2 && i - sentAt >= 3) || i - sentAt >= 5) { bot.sendMove(tgt.x, tgt.z, true); sentTo = tk; sentAt = i; }
        await tick(c);
    }
    return cheb(pos(bot), { x, z }) <= tol && pos(bot).level === level;
}

/** Walk onto the stand tile, OPLOC, wait for the landing; bounded retries (rock climbs can slip). */
export async function runTransition(c: Ctx, t: TrollTransition, maxOps = 12): Promise<'ok' | 'refused' | 'fail'> {
    const bot = c.bot;
    for (let op = 0; op < maxOps && !stopped(c); op++) {
        if (t.landed(pos(bot))) return 'ok';
        if (!(await walkTo(c, t.level, t.stand.x, t.stand.z, 0))) {
            if (t.landed(pos(bot))) return 'ok';
            log(c, `${t.id}: could not stand on (${t.stand.x},${t.stand.z},L${t.level}) — at (${pos(bot).x},${pos(bot).z},L${pos(bot).level})`);
            return 'fail';
        }
        const ubBefore = c.k.ub, bootsBefore = c.k.bootsRefused;
        bot.opLoc(t.loc.x, t.loc.z, t.loc.id, t.loc.op);
        for (let w = 0; w < 7 && !stopped(c); w++) {
            await tick(c);
            if (t.landed(pos(bot))) { log(c, `${t.id}: landed @ (${pos(bot).x},${pos(bot).z},L${pos(bot).level})`); return 'ok'; }
            if (t.refuse && (c.k.ub < ubBefore || (!bootsBefore && c.k.bootsRefused))) { log(c, `${t.id}: REFUSED (stage now [${c.k.lb},${c.k.ub}])`); return 'refused'; }
        }
    }
    return t.landed(pos(bot)) ? 'ok' : 'fail';
}

function nearestNpc(bot: any, types: readonly number[]): { index: number; x: number; z: number; dist: number; type: number } | null {
    const me = bot.tile(); let best: { index: number; x: number; z: number; dist: number; type: number } | null = null;
    for (let i = 0; i < (bot.npcCount ?? 0); i++) {
        const idx = bot.npcIndices[i]; const n = bot.npcs[idx];
        if (!n || !types.includes(n.typeId)) continue;
        const w = bot.npcTileOf(n); const d = cheb(w, me);
        if (!best || d < best.dist) best = { index: idx, x: w.x, z: w.z, dist: d, type: n.typeId };
    }
    return best;
}

/** Talk to an NPC (walk-before-op) and let the bot's dialog policy drive the pages; resolves once a dialog was seen and closed. */
async function talkTo(c: Ctx, npc: number, at: { x: number; z: number }, maxTicks = 200): Promise<boolean> {
    const bot = c.bot;
    if (pos(bot).level !== 0 || cheb(pos(bot), at) > 3) if (!(await walkTo(c, 0, at.x, at.z, 2))) return false;
    // An NPC line identical to one already on a component would not register as NEW (observe() diffs values), so a
    // second oracle talk would learn nothing: blank every stale line the oracle understands before talking.
    const it: Map<number, string> | undefined = bot.ifText;
    if (it) for (const [com, t] of it) if (t && learnFromText(newKnowledge(), t) !== null) { it.set(com, ''); c.lastTexts.set(com, ''); }
    let saw = false, lastOp = -100, closedFor = 0;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (dialogOpen(bot) || (bot.mainModalId ?? -1) !== -1) { saw = true; closedFor = 0; await tick(c); continue; }
        if (saw && ++closedFor >= 3) return true;
        if (!saw && i - lastOp >= 8) {
            const n = nearestNpc(bot, [npc]);
            if (n) { bot.sendMove(n.x, n.z, true); bot.opNpc(n.index, 1); lastOp = i; }
            else if (i - lastOp >= 30) { log(c, `npc ${npc} not in scene near (${at.x},${at.z})`); lastOp = i; }
        }
        await tick(c);
    }
    return saw;
}

/** Melee loop with Protect from Melee + sharks until `until()`; 'gone' when no target has been visible for a while. */
async function fight(c: Ctx, types: readonly number[], until: () => boolean, label: string, maxTicks = 900): Promise<'won' | 'fled' | 'gone' | 'timeout'> {
    const bot = c.bot; let lastAtk = -100, missing = 0, lastLog = -100;
    const wantProtectBase = c.o.prayer !== false;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (until()) { if (bot.isPrayerActive?.('protectfrommelee')) bot.deactivatePrayer?.('protectfrommelee'); return 'won'; }
        const n = nearestNpc(bot, types);
        const plan = fightPlan({
            hp: bot.hp ?? -1, maxHp: bot.maxHp ?? -1, food: bot.countOf(P.SHARK),
            prayerPts: bot.statLevel?.[5] ?? 0, prayerLevel: prayerBase(bot),
            protectOn: !!bot.isPrayerActive?.('protectfrommelee'), wantProtect: wantProtectBase && c.protectClicks < 8,
            targetVisible: !!n,
        });
        if (plan.flee) { log(c, `${label}: FLEEING — hp ${bot.hp}/${bot.maxHp}, no food`); return 'fled'; }
        if (plan.eat) bot.tryHeal?.();
        if (plan.pray && bot.activatePrayer?.('protectfrommelee')) c.protectClicks++;
        if (bot.isPrayerActive?.('protectfrommelee')) c.protectClicks = 0;
        if (plan.attack && n) {
            missing = 0;
            if (!dialogOpen(bot) && i - lastAtk >= 4) { if (n.dist >= 2) bot.sendMove(n.x, n.z, true); bot.opNpc(n.index, 2); lastAtk = i; }
        } else if (!n && ++missing > 60) return 'gone';
        if (i - lastLog >= 25) { log(c, `${label}: hp ${bot.hp}/${bot.maxHp} food ${bot.countOf(P.SHARK)} prayer ${bot.statLevel?.[5]} protect ${!!bot.isPrayerActive?.('protectfrommelee')} target ${n ? `${n.type}@${n.x},${n.z}` : '-'}`); lastLog = i; }
        await tick(c);
    }
    return 'timeout';
}

/** Take a ground item (walk-before-op OPOBJ3) until it is in the pack. */
async function loot(c: Ctx, obj: number, maxTicks = 60): Promise<boolean> {
    const bot = c.bot; const before = bot.countOf(obj);
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (bot.countOf(obj) > before) return true;
        const g = bot.findGroundItem?.(obj, 14);
        if (!g) { if (i > 10) return false; await tick(c); continue; }
        if (i % 3 === 0) { if (cheb(g, bot.tile()) >= 1) bot.sendMove(g.x, g.z, true); bot.opObj(g.x, g.z, obj, 3); }
        await tick(c);
    }
    return bot.countOf(obj) > before;
}

// ---- action executors ---------------------------------------------------------------------------------------
async function doBuyBoots(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (bot.countOf(P.CLIMBING_BOOTS) > 0 || bot.isWorn?.(P.CLIMBING_BOOTS)) return true;
    if (bot.countOf(P.COINS) < 12) { log(c, 'need 12 coins for climbing boots (Tenzing)'); return false; }
    c.wantBoots = true;
    // Tenzing is INSIDE his hut and its door (death_sherpa_door 3745 @ (2822,3555)) is closed; a talk from
    // the doorstep was discarded. After Death Plateau (map >= spoken_tenzing) op1 just opens it (quest_death.rs2:46-51).
    // ⛔ INSIDE = the hut's floor tiles (quest-death.ts POCKET_TILES.hut, rsmod flood fill), NOT "x <= 2821": the door
    // TELEPORTS you onto (2822,3555), which is inside. The old test kept looping there and the next op1 teleported the bot
    // back OUT (sim, clean checkout: 6 ops = in/out x3, ends outside, Tenzing's talk discarded through the wall).
    const inHut = () => { const t = bot.tile(); return pos(bot).level === 0 && ((t.z === 3554 && t.x >= 2819 && t.x <= 2821) || ((t.z === 3555 || t.z === 3556) && t.x >= 2819 && t.x <= 2822) || (t.z === 3557 && t.x >= 2820 && t.x <= 2821)); };
    // max-QP session 11 fix 299 (qx53m trollsh 'driver failed (15,367 t in the driver session)': 18 x buyBoots, every one
    // 'walk to (2823,3555) WEDGED at (2825,3556)' + 'ACK-NOACK-OPLOC ... target=3725' (the closed leaf was not there)).
    // CAUSE (fence + gate from m44_55.jm2 and gates.rs2 ~open_gate): the yard gate (3725 @2824,3555 / 3726 @2824,3554, angle
    // east) was OPEN (SIM_DOORS random boot state; on live a player leaves it so). An open gate puts both leaves EAST of the
    // fence as walls on the NORTH edge of (2825,3555) and (2826,3555); the fence runs on the west edge of (2825,3556). The
    // bot comes from Denulth (north-east) and stops on (2825,3556): south and west are walls, the naive 1-step route toward
    // (2823,3555) never moves, and the gate op is discarded (nothing closed to open). It only got in once a door flip shut the
    // gate. 299a TROLL_GATE_DETOUR: north of the gate line with the gate open (tracker) or after a wedge, walk round the open
    // leaves: (2827,3556) -> (2827,3555) -> (2825,3555), then west through the gap. =0 reverts.
    // 299b TROLL_BOOTS_MAX_T (default 400 t): one buyBoots call stops when its budget is spent (was 6 x up to ~300 t);
    // TROLL_BOOTS_SESSION_T (default 1000 t): past that much buyBoots time in one driver session, runTroll fails at once (every
    // attempt), so a wedge here costs ~1,000 t + the route retry instead of 15,000 t. 0 = unbounded (old).
    // TEST TROLL_GATE_TEST=1: open the gate from the east and park on (2825,3556), north of the open leaves (the qx53m spot).
    const tB = bot.tickCount ?? 0, maxT = Number(process.env.TROLL_BOOTS_MAX_T ?? 400);
    const left = () => maxT > 0 ? maxT - ((bot.tickCount ?? 0) - tB) : 1e9;
    const lim = (n: number) => Math.max(1, Math.min(n, left()));
    const detour = process.env.TROLL_GATE_DETOUR !== '0';
    const gateOpen = () => bot.doorTracker?.isOpen?.(0, 2825, 3555) === true || bot.doorTracker?.isOpen?.(0, 2824, 3555) === true;
    const northOfGate = () => { const t = bot.tile(); return pos(bot).level === 0 && t.x >= 2825 && t.x <= 2830 && t.z >= 3556 && t.z <= 3560; };
    try {
    if (process.env.TROLL_GATE_TEST === '1' && !bot.trollGateTested && !inHut()) {
        bot.trollGateTested = true;
        await walkTo(c, 0, 2825, 3555, 0, 200);
        if (!gateOpen()) { bot.opLoc(2824, 3555, 3725, 1); for (let w = 0; w < 3; w++) await tick(c); }
        await walkTo(c, 0, 2827, 3555, 0, 20); await walkTo(c, 0, 2827, 3556, 0, 20); await walkTo(c, 0, 2825, 3556, 0, 20);
        log(c, `TEST: Tenzing's gate open ${gateOpen()} (tracker 2825,3555 ${bot.doorTracker?.isOpen?.(0, 2825, 3555)} / 2824,3555 ${bot.doorTracker?.isOpen?.(0, 2824, 3555)}), parked at ${bot.tile().x},${bot.tile().z}`);
    }
    for (let k = 0; k < 6 && !inHut() && left() > 0; k++) {
        if (detour && northOfGate() && (gateOpen() || k > 0)) {
            log(c, `299a: at ${bot.tile().x},${bot.tile().z} north of Tenzing's gate (open ${gateOpen()}, try ${k + 1}): round the open leaves via 2827,3556 -> 2825,3555`);
            await walkTo(c, 0, 2827, 3556, 0, lim(25)); await walkTo(c, 0, 2827, 3555, 0, lim(15)); await walkTo(c, 0, 2825, 3555, 0, lim(20));
        }
        if (bot.tile().x !== 2823 || bot.tile().z !== 3555) await walkTo(c, 0, 2823, 3555, 0, lim(200));
        // (qyz01: the tracker learns the gate state only once the zone is in view, so try 1 starts blind: detour right after the wedge)
        if (detour && northOfGate() && left() > 0) {
            log(c, `299a: wedged at ${bot.tile().x},${bot.tile().z} north of Tenzing's gate (open ${gateOpen()}): round the open leaves`);
            await walkTo(c, 0, 2827, 3556, 0, lim(25)); await walkTo(c, 0, 2827, 3555, 0, lim(15)); await walkTo(c, 0, 2825, 3555, 0, lim(20));
            await walkTo(c, 0, 2823, 3555, 0, lim(60));
        }
        // max-QP session 8 (allchaos qt42m: 'walk to (2823,3555) WEDGED at (2825,3556)' x ~50, 6,578 t: the double GATE in
        // front of the hut (3725 @2824,3555 / 3726 @2824,3554, a2) was shut again (doors revert 500 t after an op; the route
        // walker had opened it before the session). Open it from the east and walk again. TROLL_TENZING_GATE=0 reverts.
        if ((bot.tile().x !== 2823 || bot.tile().z !== 3555) && process.env.TROLL_TENZING_GATE !== '0' && bot.tile().x >= 2824 && Math.abs(bot.tile().z - 3555) <= 3) {
            if (bot.tile().x !== 2825 || bot.tile().z !== 3555) await walkTo(c, 0, 2825, 3555, 0, lim(40));
            if (!(detour && gateOpen())) { bot.opLoc(2824, 3555, 3725, 1); for (let w = 0; w < 3; w++) await tick(c); }
            await walkTo(c, 0, 2823, 3555, 0, lim(60));
            log(c, `Tenzing's gate opened: now at ${bot.tile().x},${bot.tile().z}`);
        }
        bot.opLoc(2822, 3555, 3745, 1);
        for (let w = 0; w < 6 && !inHut(); w++) await tick(c);
    }
    if (inHut() || left() > 0) await talkTo(c, P.TENZING, TROLL_NPC_AT.TENZING);
    else log(c, `299b: buyBoots budget ${maxT} t spent, not in the hut (at ${bot.tile().x},${bot.tile().z}; gate open ${gateOpen()})`);
    } finally { bot.trollBootsSpent = (bot.trollBootsSpent ?? 0) + ((bot.tickCount ?? 0) - tB); }
    c.wantBoots = false;
    return bot.countOf(P.CLIMBING_BOOTS) > 0;
}
async function doWearBoots(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    for (let i = 0; i < 3 && !bot.isWorn?.(P.CLIMBING_BOOTS); i++) {
        if (typeof bot.equipItem === 'function') { const r = await bot.equipItem(P.CLIMBING_BOOTS); if (!r?.success) log(c, `wear boots: ${r?.message}`); }
        else { const s = bot.slotOf(P.CLIMBING_BOOTS); if (s >= 0) bot.opHeld2(P.CLIMBING_BOOTS, s); await tick(c); await tick(c); }
    }
    c.k.bootsRefused = false;
    return !!bot.isWorn?.(P.CLIMBING_BOOTS);
}
async function doFightDad(c: Ctx): Promise<boolean> {
    const r = await fight(c, [P.DAD], () => c.k.lb >= TROLL_STAGE.DEFEATED_DAD, 'Dad');
    if (r === 'gone' && c.k.lb < TROLL_STAGE.DEFEATED_DAD) { log(c, 'Dad not visible — re-trying the arena exit'); c.k.ub = TROLL_STAGE.COMPLETE; }
    return r === 'won' || r === 'gone';
}
async function doGetPrisonKey(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (await loot(c, P.PRISON_KEY, 4)) return true;
    if (cheb(pos(bot), TROLL_NPC_AT.GENERAL_HALL) > 8 || !nearestNpc(bot, P.GENERALS)) {
        await walkTo(c, 2, TROLL_NPC_AT.GENERAL_HALL.x, TROLL_NPC_AT.GENERAL_HALL.z, 4, 300);
    }
    const r = await fight(c, P.GENERALS, () => bot.countOf(P.PRISON_KEY) > 0 || !!bot.findGroundItem?.(P.PRISON_KEY, 14), 'Troll General');
    if (r === 'fled') return false;
    const got = await loot(c, P.PRISON_KEY, 40);
    if (!got) { log(c, 'a general died but no prison key dropped (one banked? stage >= entered_prison?) — trying the door'); c.k.ub = TROLL_STAGE.COMPLETE; }
    return got;
}
async function doGetCellKey(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (await loot(c, P.CELL_KEY_GODRIC, 4)) return true;
    if (cheb(pos(bot), TROLL_NPC_AT.TWIG) > 3) await walkTo(c, 0, TROLL_NPC_AT.TWIG.x, TROLL_NPC_AT.TWIG.z, 1, 300);
    let lastOp = -100, awakeFor = 0;
    for (let i = 0; i < 200 && !stopped(c); i++) {
        if (bot.countOf(P.CELL_KEY_GODRIC) > 0 || c.k.lb >= TROLL_STAGE.FREED_GODRIC) return true;
        const asleep = nearestNpc(bot, [P.TWIG_ASLEEP]);
        if (asleep) {
            awakeFor = 0;
            if (!dialogOpen(bot) && i - lastOp >= 5) { if (asleep.dist >= 2) bot.sendMove(asleep.x, asleep.z, true); bot.opNpc(asleep.index, 3); lastOp = i; }
        } else if (nearestNpc(bot, [P.TWIG_AWAKE]) && ++awakeFor > 60) {
            log(c, 'Twig stays awake — killing him for the key (mountain_troll.rs2:5-8)');
            await fight(c, [P.TWIG_AWAKE, P.TWIG_ASLEEP], () => bot.countOf(P.CELL_KEY_GODRIC) > 0 || !!bot.findGroundItem?.(P.CELL_KEY_GODRIC, 14), 'Twig');
            return loot(c, P.CELL_KEY_GODRIC, 40);
        }
        await tick(c);
    }
    return bot.countOf(P.CELL_KEY_GODRIC) > 0;
}
async function doFreeGodric(c: Ctx): Promise<boolean> {
    const bot = c.bot; const g = GODRIC_CELL;
    for (let a = 0; a < 8 && !stopped(c); a++) {
        if (c.k.lb >= TROLL_STAGE.FREED_GODRIC) return true;
        if (!(await walkTo(c, 0, g.stand.x, g.stand.z, 0))) return false;
        const before = bot.countOf(P.CELL_KEY_GODRIC);
        bot.opLoc(g.loc.x, g.loc.z, g.loc.id, g.loc.op);
        for (let w = 0; w < 8; w++) {
            await tick(c);
            if (before > 0 && bot.countOf(P.CELL_KEY_GODRIC) < before) { raise(c.k, TROLL_STAGE.FREED_GODRIC); log(c, 'Godric FREED (cell key consumed)'); return true; }
            if (c.k.lb >= TROLL_STAGE.FREED_GODRIC) return true;
        }
    }
    return c.k.lb >= TROLL_STAGE.FREED_GODRIC;
}
async function doDunstan(c: Ctx, claim: boolean): Promise<boolean> {
    const bot = c.bot; const before = bot.countOf(P.LAW_TALISMAN);
    await talkTo(c, P.DUNSTAN, TROLL_NPC_AT.DUNSTAN);
    for (let i = 0; i < 6 && bot.countOf(P.LAW_TALISMAN) <= before; i++) await tick(c);
    const got = bot.countOf(P.LAW_TALISMAN) > before;
    if (got) { if (!claim) exact(c.k, TROLL_STAGE.COMPLETE); return true; }
    if (claim && !c.k.noRoom) c.k.claimNotOffered = true;
    if (!claim && c.k.ub < TROLL_STAGE.FREED_GODRIC) c.k.oracleDone = false;   // Dunstan says Godric is still captive
    return false;
}

function makeCtx(bot: any, o: TrollDriveOpts, goal: 'quest' | 'claim' | 'descend' = 'quest'): Ctx {
    // texts already on screen / in the chat log when the driver starts are NOT evidence about this run
    return { bot, o, k: newKnowledge(), goal, t0: Date.now(), lastTexts: new Map(bot.ifText ?? []), chatSince: (bot.tickCount ?? 0) + 1,
        seenChat: new Set(), wantBoots: false, protectClicks: 0, refusals: new Map() };
}

async function runTroll(bot: any, o: TrollDriveOpts, goal: 'quest' | 'claim' | 'descend'): Promise<boolean> {
    const c = makeCtx(bot, o, goal);
    bot.foodObj = P.SHARK; if (!(bot.healFrac > 0)) bot.healFrac = TROLL_FIGHT.eatFrac;
    bot.trollPick = (opts: string[]) => trollDialogPick(opts, { wantBoots: c.wantBoots && bot.countOf(P.CLIMBING_BOOTS) === 0 && !bot.isWorn?.(P.CLIMBING_BOOTS), claim: goal === 'claim' || c.k.lb >= TROLL_STAGE.COMPLETE || journal(bot) === 'COMPLETE' });
    if (!(bot instanceof TrollQuestBot)) {
        // a plain LeanBot has no label-wait hook: a static policy is the best it can do
        bot.dialogPolicy = [/^How goes your fight with the trolls\?/, /^Is there anything I can do to help\?/, /^I'll get Godric back!/, /^Can I have another law talisman\?/, /^I'll be going now\./, /^Nothing, thanks/].map(match => ({ match }));
    }
    bot.travelEnabled = false; bot.arrived = true;
    if (journal(bot) === 'COMPLETE') exact(c.k, TROLL_STAGE.COMPLETE);
    else if (journal(bot) === 'NOT_STARTED') cap(c.k, TROLL_STAGE.NOT_STARTED);
    let failures = 0, last = '';
    while (!stopped(c)) {
        observe(c);
        if (dialogOpen(bot)) { await tick(c); continue; }
        const ob = obs(c);
        const act = decideTroll(ob, c.k, goal);
        const name = act.kind === 'transition' ? act.t.id : act.kind;
        bot.trollStage = name;
        if (name !== last) { log(c, `-> ${name} @ (${ob.pos.x},${ob.pos.z},L${ob.pos.level}) region=${ob.region} stage=[${c.k.lb},${c.k.ub}] journal=${ob.journal}`); last = name; }
        let ok = true;
        switch (act.kind) {
            case 'done': log(c, `DONE — law talisman x${ob.lawTalisman} @ (${ob.pos.x},${ob.pos.z})`); return true;
            case 'fail': log(c, `FAIL — ${act.why}`); return false;
            case 'transition': {
                const r = await runTransition(c, act.t);
                ok = r !== 'fail';
                await tick(c);   // never spin: a transition that is 'already landed' returns without awaiting a tick
                if (r === 'refused') {
                    const n = (c.refusals.get(act.t.id) ?? 0) + 1; c.refusals.set(act.t.id, n);
                    if (n >= 6) { log(c, `FAIL — ${act.t.id} refused ${n} times`); return false; }
                }
                break;
            }
            case 'talkDenulth': {
                const before = c.k.oracleDone;
                ok = await talkTo(c, P.DENULTH, TROLL_NPC_AT.DENULTH);
                if (!c.k.oracleDone && ok && !before && journal(bot) === 'IN_PROGRESS') { raise(c.k, TROLL_STAGE.STARTED); c.k.oracleDone = true; log(c, 'Denulth: no stage line recognised — journal is yellow, assuming started'); }
                break;
            }
            case 'buyBoots': {
                // fix 299b TROLL_BOOTS_SESSION_T: a bounded failure, not 3 attempts x 6 x ~850 t (qx53m)
                const cap = Number(process.env.TROLL_BOOTS_SESSION_T ?? 1000);
                if (cap > 0 && (bot.trollBootsSpent ?? 0) > cap) { log(c, `FAIL — buyBoots spent ${bot.trollBootsSpent} t in this driver session (cap ${cap} t), at ${ob.pos.x},${ob.pos.z}`); return false; }
                ok = await doBuyBoots(c); break;
            }
            case 'wearBoots': ok = await doWearBoots(c); break;
            case 'fightDad': ok = await doFightDad(c); break;
            case 'getPrisonKey': ok = await doGetPrisonKey(c); break;
            case 'getCellKey': ok = await doGetCellKey(c); break;
            case 'freeGodric': ok = await doFreeGodric(c); break;
            case 'dunstanComplete': ok = await doDunstan(c, false); break;
            case 'dunstanClaim': ok = await doDunstan(c, true); break;
        }
        if (!ok) { failures++; log(c, `${name} did not succeed (${failures})`); if (failures >= 6) { log(c, 'FAIL — too many failed actions'); return false; } await tick(c); }
        else failures = 0;
    }
    log(c, `stopped/timed out at ${bot.trollStage}`);
    return false;
}

/** Drive Troll Stronghold from "Death Plateau complete" to "law talisman in the pack". Resumable from any point. */
export async function driveTrollStronghold(bot: any, opts: TrollDriveOpts): Promise<boolean> {
    return runTroll(bot, opts, 'quest');
}

/**
 * After completion: walk to Dunstan and take "Can I have another law talisman?" (offered only when the account holds
 * NONE anywhere, bank included — death_smithy.rs2:87). Resolves true once a law talisman is in the pack.
 */
export async function descendToSouth(bot: any, opts: TrollDriveOpts): Promise<boolean> {
    return runTroll(bot, opts, 'descend');
}
export async function requestLawTalisman(bot: any, opts: TrollDriveOpts): Promise<boolean> {
    return runTroll(bot, opts, 'claim');
}

/** @internal test hooks */
export const __troll = { runTransition, walkTo, talkTo, fight, loot, doGetPrisonKey, doGetCellKey, doFreeGodric, doDunstan, observe, obs,
    makeCtx };

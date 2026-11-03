// QUEST RUNNER — a reusable declarative step-list executor for quests (Rune Mysteries -> essence/RC;
// Dragon Slayer -> rune platebody BiS + the anti-dragon shield -> the 4.8x dragon-bones prayer lane).
// A quest is CONTENT, not a mechanic: this brain does NOT know any quest's internals — it executes a
// step list, where each step is {travel to an NPC, talk or use-item, drive the dialog (continue +
// pick a choice), then verify an OBSERVABLE outcome (item gained/consumed) before advancing}.
//
// It gates on OBSERVABLES (inventory + dialog open/closed), never the server varp (the client may not
// even decode it) — the faithful, robust way a real quest bot works.
//
// ⛔ The sim proves this runner EXECUTES a step list correctly (right travel, right option, right
// item, no wedge, retry on a wrong branch). It does NOT prove a given quest completes live — the
// step list is a hand-transcription of the RS2 scripts and must get one live smoke per quest. Boss
// fights / instanced legs are separate (combat.ts math + live).
//
// Cheat-free class. Steps are provided programmatically (setSteps) or via QR_QUEST (a named quest in
// QUESTS below). Run: LC_HOST=localhost:8888 bun server/webclient/headless/quest-runner.ts
import { LeanBot } from './leanbot.js';
import { guardRaw } from './route-danger.js';   // raw-fallback guard: never walk a raw leg into a White Wolf Mountain aggro circle

const CHOICE_ROOTS = new Set([2459, 2469, 2480, 2492]);   // multi2/3/4/5 dialog roots (leanbot CHOICE_ROOTS)

export interface QStep {
    npcType?: number;                // the NPC's type id (found in scene by type). talk/use/kill.
    npcTypes?: number[];             // op:'kill' — any of these types is an acceptable target
    xz: { x: number; z: number };    // where to stand to reach it (op:'useloc' -> the CARDINAL face tile)
    level?: number;                  // plane (Duke is on castle level 1; basements are level 0 at z+6400)
    op: 'talk' | 'use' | 'useloc' | 'oploc' | 'kill' | 'bank';
    // bank  = walk onto the booth's stand (`xz`), OPLOC2 the booth (`loc`), deposit everything except `keep`
    //         (obj -> units left in the pack), close. DONE when the pack holds nothing beyond `keep` (see doBankStep).
    keep?: Record<number, number>;
    // talk  = OPNPC1                     use    = OPNPCU (use item on npc)
    // useloc= OPLOCU (use item on a loc) oploc  = OPLOC<op> until the door tracker says it opened
    // kill  = OPNPC2 + OPOBJ3 until `expectItem` x `expectCount` is in the pack
    useItem?: number;                // for op:'use' / op:'useloc'
    loc?: { x: number; z: number; id: number; op?: number };   // op:'useloc'/'oploc' — the loc's ORIGIN tile + id
    choice?: number;                 // 1-based option to click if a SINGLE p_choiceN page appears
    choices?: number[];              // 1-based options for a SEQUENCE of p_choice pages (e.g. Sedridor [3,1,1])
    expectItem?: number;            // step is DONE when this item appears in the pack
    expectCount?: number;           // ...this many of them (default 1; op:'kill' loots until it holds them)
    consumeItem?: number;           // step is DONE when this item leaves the pack
    questComplete?: string;         // step is DONE when the JOURNAL ROW for this quest key goes GREEN
    // (quest-state.ts: IF_SETCOLOUR on questlist:<key>; the ONLY observable for a quest whose
    //  reward is neither an item nor a dialog — see the druidic_ritual note below)
    /** op:'oploc' on a WALK-THROUGH door (the server p_teleports you across; the door never shows as open): the step is
     *  DONE when the player stands inside this box — i.e. on the far side. Checked before any walking, so a bot that is
     *  already through (a resume, a teleport a tick early) never walks back to the near-side stand. With a doneBox the op
     *  budget is a RETRY window, never an "advance blind". */
    doneBox?: { x0?: number; x1?: number; z0?: number; z1?: number };
    /** op:'kill' — FALLBACK hunt anchors, tried in order (then back to `xz`) when travel to the current one WEDGES: no new
     *  closest approach and no real move (> 4 tiles) for QR_WEDGE_TICKS ticks, QR_WEDGE_MAX times (env, read at call time;
     *  default 50 x 2).  the old rat anchor sat inside Melzar's Maze (locked door) and the runner re-planned
     *  the same impossible route for an hour — a second spot would have saved it. */
    xzAlts?: Array<{ x: number; z: number }>;
    /** op:'kill' — the step is ALREADY DONE (skipped before any walking) while the pack holds `expectItem` x `expectCount`
     *  or ANY of these (e.g. the enchanted twin of a meat already dipped): a relaunch never re-hunts what it carries. */
    heldAlso?: number[];
    /** RESUME: the step is ALREADY DONE (skipped before any walking) when it starts with the player inside this box (level 0,
     *  the underground box). For a step whose only observable is unreadable (a talk that sets a server varp) but that a LATER leg
     *  can only follow: the Druidic Ritual's Kaqemeex/Sanfew talks are skipped by a relaunch that wakes up in the Taverley
     *  dungeon — the runner only goes down there after Sanfew unlocked the cauldron. */
    skipIfIn?: { x0?: number; x1?: number; z0?: number; z1?: number };
    label?: string;
}

// Named quests (hand-transcribed CONTRACTS — verify each with a live smoke before trusting).
// Rune Mysteries: Duke(741) talk -> +air_talisman; Sedridor(300) use talisman -> -talisman; Sedridor
// talk -> +research_package; Aubury(553) use package -> -package; Aubury talk -> +research_notes;
// Sedridor use notes -> complete. (duke_horacio.rs2 / sedridor.rs2 / aubury.rs2,.)
const AIR_TALISMAN = 1438, RESEARCH_PACKAGE = 290, RESEARCH_NOTES = 291;
export const QUESTS: Record<string, QStep[]> = {
    // Coords + FLOW VERIFIED LIVE: the live smoke corrected TWO transcription errors the
    // sim (co-located NPCs) could not catch — (a) Duke 741 is on castle LEVEL 1, and (b) you TALK
    // Sedridor (not use-item), and that ONE conversation (choices [3,1,1]) hands the talisman AND
    // gives the package, collapsing two steps. Sedridor 300 @ (3103,9571) wizard-tower BASEMENT;
    // Aubury 553 @ (3253,3402) Varrock; package/notes ARE use-item at Aubury/Sedridor (opnpcu).
    rune_mysteries: [
        // Duke's fixture tile is his ROOM (reachable from the L1 staircase, central to his wander area),
        // NOT his exact spawn (3212,3220) — that tile is UNREACHABLE, so multi-level travel dead-ended
        // in the corridor WEST of the interior wall and the bot could never cross to him (live-caught).
        // Landing IN the room + stepToNpc's follow catches the pacing Duke trivially.
        { npcType: 741, xz: { x: 3210, z: 3220 }, level: 1, op: 'talk', expectItem: AIR_TALISMAN, label: 'Duke: start' },
        { npcType: 300, xz: { x: 3103, z: 9571 }, level: 0, op: 'talk', choices: [3, 1, 1], expectItem: RESEARCH_PACKAGE, label: 'Sedridor: talisman + package' },
        { npcType: 553, xz: { x: 3253, z: 3402 }, level: 0, op: 'use', useItem: RESEARCH_PACKAGE, consumeItem: RESEARCH_PACKAGE, label: 'Aubury: give package' },
        // choice:2 = "Oh, it's a rune shop. No thank you." — Aubury hands the notes on the FIRST talk with
        // no choice page (state given_package, aubury.rs2:2-8), but if verify is slow and we re-talk (state
        // received_notes) he offers his rune SHOP as a multi2/3 whose option 1 "Yes please!" opens the shop
        // and TRAPS the dialog loop (base picks opt1 forever → step 3 never advances; live-caught RC_MINER_N
        //). Picking opt2 declines the shop so verify can see the notes and advance. Harmless on
        // the first talk (no choice page appears there).
        { npcType: 553, xz: { x: 3253, z: 3402 }, level: 0, op: 'talk', choice: 2, expectItem: RESEARCH_NOTES, label: 'Aubury: get notes' },
        { npcType: 300, xz: { x: 3103, z: 9571 }, level: 0, op: 'use', useItem: RESEARCH_NOTES, consumeItem: RESEARCH_NOTES, label: 'Sedridor: complete' },
    ],
};

// =====================================================================================================
// DRUIDIC RITUAL — the ONLY herblore bootstrap on this server
// =====================================================================================================
// WHY IT EXISTS AT ALL: identify.rs2:64-70 gates identifying a herb on `stat(herblore) >=
// identified_herb_level`, and the MINIMUM identified_herb_level over every herb row is 3; brewing is
// likewise 3+; grinding (herblore.rs2:28-38) has no stat_advance and awards zero. A herblore-1 account
// can therefore earn LITERALLY ZERO xp, and the single unlock is
// `quest_druid.rs2:3  stat_advance(herblore, 2500)`, which clears the level-3 floor.
//
// THE FLOW, transcribed line-by-line (every claim below carries its file:line):
//   1. KAQEMEEX (npc 455) @ (2924,3486), the Taverley stone circle — kaqemeex.rs2:1-5. Not-started
//      opens `@multi3("Who are you?", "I'm in search of a quest.", "Did you build this?")`; option 2
//      -> druidic_ritual_start_1 (kaqemeex.rs2:49-52) -> @kaqemeex_our_circle -> `~p_choice3("Ok, I
//      will try and help." = 1, ...)` (kaqemeex.rs2:61) -> @druid_agree_to_help sets
//      `%druidquest = ^druid_started` (kaqemeex.rs2:76).  => choices [2, 1]
//   2. SANFEW (npc 454) @ (2897,3426) LEVEL 1 (upstairs, m45_53.jm2 NPC "1 17 34: 454") — sanfew.rs2:25
//      `%druidquest = ^druid_started` -> `@multi2("I've been sent to help purify the Varrock stone
//      circle." = 1, "Actually I don't need to speak to you." = 2)`; option 1 -> druid_sanfew_information
//      sets `%druidquest = ^druid_spoken_sanfew` (sanfew.rs2:40) then falls into
//      `@druid_sanfew_questions` -> `~p_choice2("Where can I find this cauldron?" = 1, "Ok, I'll do
//      that then." = 2)` (sanfew.rs2:44). Option 2 ENDS the conversation.  => choices [1, 2]
//   3. FOUR RAW MEATS, one per animal (sanfew.rs2:38 "the raw meat of four different animals"):
//      raw_beef 2132 (cow 81, `drop tables/scripts/cow.rs2:11`), raw_chicken 2138 (chicken 41,
//      chicken.rs2:14), raw_rat_meat 2134 (giantrat1 87, giant_rat.rs2:8), raw_bear_meat 2136
//      (darkbear 106, bear.rs2:12). All four are GUARANTEED drops, not rolls.
//   4. CAULDRON OF THUNDER (loc 2142) @ (2893,9831), Taverley dungeon — `[oplocu,cauldron_of_thunder]`
//      quest_druid.rs2:14-38. It REFUSES unless `%druidquest = ^druid_spoken_sanfew`
//      (quest_druid.rs2:16), which is why step 2 must precede it. Each dip swaps one raw meat for its
//      enchanted twin: 2132->522, 2134->523, 2136->524, 2138->525 (quest_druid.rs2:20-35).
//   5. SANFEW again — `%druidquest = ^druid_spoken_sanfew` short-circuits at sanfew.rs2:2-4 into
//      @druid_sanfew_give_ingredients, which requires ALL FOUR enchanted meats in one pack
//      (sanfew.rs2:56), deletes them (sanfew.rs2:60-63) and sets `^druid_given_ingredients`.
//      NO CHOICE PAGE is reached on the success branch — the p_choice2 at sanfew.rs2:70 is behind the
//      `return` at line 66, so this step drives continue-pages only.
//   6. KAQEMEEX again — `%druidquest = ^druid_given_ingredients` -> @druid_completion (kaqemeex.rs2:9)
//      -> `queue*(druid_quest_complete, ...)` -> quest_druid.rs2:2-6: `^druid_complete`,
//      `stat_advance(herblore, 2500)` and `~send_quest_complete(questlist:druid, ...)`.
//
// ⛔ THE COMPLETION OBSERVABLE IS THE JOURNAL COLOUR, NOT AN ITEM. The reward is XP + a quest-scroll
// modal; nothing enters the pack. `~send_quest_complete` (general/scripts/quests.rs2:15-52) ends with
// `if_setcolour($component, ^green_rgb)` on questlist:druid = component 7355, and leanbot.ts:2279
// decodes IF_SETCOLOUR into `ifColour`, which quest-state.ts turns into COMPLETE. So the last step
// gates on `questComplete: 'druid'` — a real server observable, not "we clicked and hoped".
// (The quest scroll itself is a MAIN modal; leanbot brain() branch (c) dismisses it automatically.)
//
// (The step list no longer uses this door — the room has an ordinary gate + door, see the step list.)
// ⛔ THE CAULDRON DOOR SPAWNS TWO SUITS OF ARMOUR. prison_doors.rs2:1-22: opening `cauldrondoor` from
// OUTSIDE while a `suitofarmour_darkknight` loc still stands at (2887,9829) or (2887,9832) deletes the
// loc, spawns `suit_of_armour` (npc 453, level 19 / 29hp / att 16 / str 14) and RETURNS WITHOUT OPENING
// THE DOOR. So the door needs up to THREE op1s and the bot takes melee in between — which is why this
// lane is for an armed knight, and why the runner heals every tick (see doCombat).
//
// COORDINATE PROVENANCE — every tile below is map/collision-derived and OFFLINE-verified with
// rsmod (findLongPath / findPathToLoc / reachedLoc,). NONE of it has had a live smoke.
//   (2924,3486) Kaqemeex spawn   m45_54.jm2 NPC "0 44 30: 455"           routable from Falador W bank
//   (2897,3426) Sanfew spawn L1  m45_53.jm2 NPC "1 17 34: 454"           planMultiLevel: stairs (2900,3428) -> (1,2898,3427)
//   (2884,3397) dungeon ladder   m45_53.jm2 LOC "0 4 5: 1759 10"         see the MANUAL portal in sdk/navgrid/levels.ts
//   (2888,9830) door stand tile  W face of loc 2144 @(2889,9830)         reachedLoc TRUE (E/N/S all FALSE or blocked)
//   (2892,9831) cauldron stand   W face of loc 2142 @(2893,9831)         reachedLoc TRUE
// ⛔ CARDINAL, NOT DIAGONAL — MEASURED, NOT ASSUMED. For the cauldron the four cardinal faces all
// answer reachedLoc TRUE and all four DIAGONALS answer FALSE while being perfectly walkable. A
// diagonal stand tile is the silent-forever stall this engine punishes; the two stand tiles above are
// the ones rsmod's own reached() accepts.
const RAW_BEEF = 2132, RAW_RAT_MEAT = 2134, RAW_BEAR_MEAT = 2136, RAW_CHICKEN = 2138;
const ENCH_BEEF = 522, ENCH_RAT = 523, ENCH_BEAR = 524, ENCH_CHICKEN = 525;
const KAQEMEEX = 455, SANFEW = 454, CAULDRON_LOC = 2142;
/** the Taverley dungeon squares the Druidic Ritual uses (m44_152..m45_153 underground; QStep.skipIfIn) */
export const TAVERLEY_DUNGEON = { x0: 2816, x1: 2943, z0: 9664, z1: 9855 } as const;
const COW = 81, CHICKEN = 41, GIANTRAT = 87, GIANTRAT_ALT = 86, DARKBEAR = 106, BROWNBEAR = 105;

/** "x,z" env override, or the compiled-in default. Read at CALL time — hot-swappable, never a const. */
function envXZ(name: string, dx: number, dz: number): { x: number; z: number } {
    const raw = process.env[name];
    if (!raw) return { x: dx, z: dz };
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(raw);
    if (!m) { console.error(`[quest] ${name}="${raw}" is not "x,z" — using the default (${dx},${dz})`); return { x: dx, z: dz }; }
    return { x: Number(m[1]), z: Number(m[2]) };
}

/** `inside` test for QStep.doneBox (every bound optional, inclusive). */
export function inDoneBox(t: { x: number; z: number }, b: NonNullable<QStep['doneBox']>, stand?: { x: number; z: number }): boolean {
    // ⛔ SAME STRATUM AS THE STEP'S STAND: a box with only an x bound also matches the surface 6,400 tiles north of an
    // underground door ( 'through — now at (2890,3408)' for the Taverley cauldron door).
    if (stand && (t.z >= 6400) !== (stand.z >= 6400)) return false;
    return (b.x0 === undefined || t.x >= b.x0) && (b.x1 === undefined || t.x <= b.x1) && (b.z0 === undefined || t.z >= b.z0) && (b.z1 === undefined || t.z <= b.z1);
}

const UNICORN = 89, UNICORN_HORN = 237;
/**
 * The Druidic Ritual step list, BUILT ON EVERY ACCESS so `process.env` is read at call time
 * (hot-swap rule: no module-scope env consts).
 *   DR_CHICKEN_XZ / DR_COW_XZ / DR_RAT_XZ / DR_BEAR_XZ / DR_UNICORN_XZ   "x,z" hunt anchors
 *   DR_SKIP_GATHER=1   the pack already holds the four raw meats — skip the kill lane
 *   DR_HORNS=<n>       ALSO kill unicorns (npc 89, unicorn.rs2 drops unicorn_horn 237 every kill) until n horns are held —
 *                      the herblore lane's antipoison secondary (horn + pestle -> unicorn_horn_dust). AFTER the quest (the
 *                      meats are gone, the pack has room): the 2 spawns south of Edgeville (3084,3454 / 3090,3450), on the
 *                      way to the herblore station. ⛔ NOT the 4 spawns south-west of Taverley (2838-2863,3370-3378): rsmod
 *                      and navgrid both fail to reach that pen from Falador (sim/druidic-geo.test.ts). Default 0 = no step.
 *   `o.horns` overrides DR_HORNS.
 */
export interface DruidBank { stand: { x: number; z: number }; booth: { x: number; z: number }; keep?: Record<number, number> }
export function druidicRitualSteps(o: { horns?: number; bankFirst?: DruidBank; bankEnd?: DruidBank; hornsOnly?: boolean } = {}): QStep[] {
    const horns = Math.max(0, Math.floor(o.horns ?? Number(process.env.DR_HORNS ?? 0)) || 0);
    // HORNS ONLY: the trainer's quest is long done (Herblore 99) and the herb lane
    // needs MORE unicorn horns -> [bankFirst] -> kill unicorns until `horns` are held -> [bankEnd]. The SAME horn + bank steps
    // as the full list (one code path), nothing else. sim/druidic-ritual.test.ts 'HORNS ONLY'.
    if (o.hornsOnly) return druidicRitualSteps({ ...o, hornsOnly: false }).filter(s => s.op === 'bank' || s.expectItem === UNICORN_HORN);
    const gather: QStep[] = process.env.DR_SKIP_GATHER === '1' ? [] : [
        { npcTypes: [CHICKEN], xz: envXZ('DR_CHICKEN_XZ', 3017, 3289), op: 'kill', expectItem: RAW_CHICKEN, heldAlso: [ENCH_CHICKEN], label: 'kill chicken -> raw chicken' },
        { npcTypes: [COW], xz: envXZ('DR_COW_XZ', 2921, 3287), op: 'kill', expectItem: RAW_BEEF, heldAlso: [ENCH_BEEF], label: 'kill cow -> raw beef' },
        // GIANT RATS. ⛔ NOT (2925-2935,3244-3256): those 6 spawns are INSIDE MELZAR'S MAZE — its only door (melzardoor 2595
        // @2941,3248) is "securely locked" on op1 and opens only with the Dragon Slayer maze key (melzars_maze.rs2:2-17). Live
        // the runner wedged at that door for an hour. Shipped: the 2 giantrat1 spawns west of Port Sarim
        // (m46_49: 2995,3191 / 2999,3194), then the Lumbridge swamp (4 giantrat @3192-3197,3201-3207; 7 giantrat1
        // @3200-3215,3172-3195) — all reached from the cow field on the REAL collision (sim/druidic-geo.test.ts).
        { npcTypes: [GIANTRAT, GIANTRAT_ALT], xz: envXZ('DR_RAT_XZ', 2997, 3192), xzAlts: [{ x: 3195, z: 3205 }, { x: 3211, z: 3185 }], op: 'kill', expectItem: RAW_RAT_MEAT, heldAlso: [ENCH_RAT], label: 'kill giant rat -> raw rat meat' },
        { npcTypes: [DARKBEAR, BROWNBEAR], xz: envXZ('DR_BEAR_XZ', 2966, 3474), op: 'kill', expectItem: RAW_BEAR_MEAT, heldAlso: [ENCH_BEAR], label: 'kill bear -> raw bear meat' },
    ];
    const bankStep = (b: DruidBank, label: string, also: Record<number, number> = {}): QStep => ({ xz: b.stand, level: 0, op: 'bank', loc: { x: b.booth.x, z: b.booth.z, id: 2213, op: 2 }, keep: { ...also, ...(b.keep ?? {}) }, label });
    // ⛔ THE FIRST BANK KEEPS THE QUEST MEATS (raw + enchanted, 1 each): a RELAUNCH mid-gather re-enters at step 0 holding
    // the meats already won; without this keep it deposited them and re-hunted all four. With it, the bank step is
    // 'pack already clean' and every kill step whose meat is carried is skipped before any walking (QStep.heldAlso).
    const MEATS: Record<number, number> = { [RAW_BEEF]: 1, [RAW_RAT_MEAT]: 1, [RAW_BEAR_MEAT]: 1, [RAW_CHICKEN]: 1, [ENCH_BEEF]: 1, [ENCH_RAT]: 1, [ENCH_BEAR]: 1, [ENCH_CHICKEN]: 1 };
    return [
        ...(o.bankFirst ? [bankStep(o.bankFirst, 'bank: clear the pack for the kill lane', MEATS)] : []),
        ...gather,
        { npcType: KAQEMEEX, xz: { x: 2924, z: 3486 }, level: 0, op: 'talk', choices: [2, 1], skipIfIn: TAVERLEY_DUNGEON, label: 'Kaqemeex: start the quest' },
        { npcType: SANFEW, xz: { x: 2897, z: 3426 }, level: 1, op: 'talk', choices: [1, 2], skipIfIn: TAVERLEY_DUNGEON, label: 'Sanfew: learn the ritual (unlocks the cauldron)' },
        // ⛔ NO PRISON-DOOR STEP. The cauldron room (x 2889-2897, z 9826-9836 on the real collision) has THREE
        // entrances: the prison door 2143/2144 @(2889,9830-9831) on the west (prison_doors.rs2: wakes the two suits of armour,
        // then swings shut around you — never a walkable edge), an ordinary GATE 1557/1558 @(2898,9831-9832) on the east and
        // an ordinary DOOR 1542/1544 @(2892-2893,9826) on the south (door-states.json rows, the door tracker opens them). The
        // prison door is in sdk/navgrid/quest-gated-doors.json now, so every planner walks the dips (and the Sanfew leg out)
        // through the gate/door.  the old door step was marked done on the SURFACE (its doneBox `x >= 2889`
        // had no z bound and the runner stood at (2890,3408) after a stalled climb), and the first dip then walked at the
        // shut prison door from (2888,9830) for 7,400 ticks. sim/druidic-geo.test.ts (e) proves the route on real collision.
        { xz: { x: 2892, z: 9831 }, level: 0, op: 'useloc', loc: { x: 2893, z: 9831, id: CAULDRON_LOC }, useItem: RAW_BEEF, expectItem: ENCH_BEEF, label: 'dip raw beef' },
        { xz: { x: 2892, z: 9831 }, level: 0, op: 'useloc', loc: { x: 2893, z: 9831, id: CAULDRON_LOC }, useItem: RAW_RAT_MEAT, expectItem: ENCH_RAT, label: 'dip raw rat meat' },
        { xz: { x: 2892, z: 9831 }, level: 0, op: 'useloc', loc: { x: 2893, z: 9831, id: CAULDRON_LOC }, useItem: RAW_BEAR_MEAT, expectItem: ENCH_BEAR, label: 'dip raw bear meat' },
        { xz: { x: 2892, z: 9831 }, level: 0, op: 'useloc', loc: { x: 2893, z: 9831, id: CAULDRON_LOC }, useItem: RAW_CHICKEN, expectItem: ENCH_CHICKEN, label: 'dip raw chicken' },
        // choice 2 = "I'll get on with it." — the SUCCESS branch (all four meats held) reaches NO choice
        // page at all: sanfew.rs2:66 `return`s before the p_choice2 at line 70. The option only matters
        // on the FAILURE branch, where picking 1 loops back through @druid_sanfew_questions forever;
        // 2 ends the page so the step can retry cleanly. (Same shape as Aubury's choice:2 above.)
        { npcType: SANFEW, xz: { x: 2897, z: 3426 }, level: 1, op: 'talk', choice: 2, consumeItem: ENCH_BEEF, label: 'Sanfew: hand over the four enchanted meats' },
        { npcType: KAQEMEEX, xz: { x: 2924, z: 3486 }, level: 0, op: 'talk', questComplete: 'druid', label: 'Kaqemeex: complete (herblore 1 -> 2500 units)' },
        ...(horns > 0 ? [{ npcTypes: [UNICORN], xz: envXZ('DR_UNICORN_XZ', 3087, 3452), op: 'kill' as const, expectItem: UNICORN_HORN, expectCount: horns, label: `kill unicorns -> ${horns} unicorn horn` }] : []),
        ...(o.bankEnd ? [bankStep(o.bankEnd, 'bank: deposit the horns + leftovers at the herblore station')] : []),
    ];
}
Object.defineProperty(QUESTS, 'druidic_ritual', { enumerable: true, get: druidicRitualSteps });

export class QuestRunnerBot extends LeanBot {
    private stallKey = ''; private stallSince = 0; private stallDoorAt = -100; private stallDoorOps = 0;   // stall-door rule
    steps: QStep[] = [];
    stepIdx = 0;
    travelEnabled = true;
    private lastActTick = -100; private attemptSince = -1; private preItem = -1; private sawDialog = false;
    private choiceIdx = 0;   // which p_choice page we're on within the current step (for choices[])
    private mlStarted = false;   // per-step latch: have we kicked off startMultiTravel for this step yet?
    private locOps = 0;          // OPLOCs spent on the CURRENT 'oploc' step (see doLocStep's budget)
    private phase: 'travel' | 'interact' | 'dialog' | 'verify' = 'travel';
    done = false;

    // arrived=true at construction so the base loop runs doCombat (our step machine) FIRST — its
    // phase='travel' block kicks startMultiTravel, which flips arrived=false and hands off to doTravel.
    // Without this a fresh account would doTravel toward a default (0,0) travelDest before we set a goal.
    constructor() { super(); this.mode = 'combat'; this.quiet = true; this.arrived = true; if (process.env.QR_TRAVEL === '0') this.travelEnabled = false; }
    setSteps(steps: QStep[]): void { this.steps = steps; }

    // OVERRIDE the base dialog driver ONLY for an active quest CHOICE page — pick the STEP's option.
    // For everything else (the TUTORIAL-SKIP guide prompt, and quest continue-pages) DEFER to the base
    // driveDialog: it resumes continue pages and picks option 1, which is exactly right for the skip's
    // "Yes please" and for continue-drive. (Overriding those broke the tutorial skip: a fresh account
    // never left the island — .)
    protected override driveDialog(): void {
        const step = this.cur();
        const onChoice = this.phase === 'dialog' && CHOICE_ROOTS.has(this.chatModalId);
        // the option for THIS choice page: choices[choiceIdx] (a sequence) or the single `choice`
        const opt = step ? (step.choices ? step.choices[this.choiceIdx] : (this.choiceIdx === 0 ? step.choice : undefined)) : undefined;
        if (this.phase === 'dialog') this.sawDialog = true;   // any dialog while mid-step counts as seen
        if (onChoice && opt !== undefined) {
            if (this.resumedDialog) return;
            this.ifButton(this.chatModalId + 1 + opt);
            this.choiceIdx++;
            this.resumedDialog = true;
            return;
        }
        super.driveDialog();   // tutorial-skip prompt + quest continue-pages (base resumes / picks opt 1)
    }

    private cur(): QStep | null { return this.stepIdx < this.steps.length ? this.steps[this.stepIdx] : null; }

    // ---- KILL-ANCHOR FALLBACK (QStep.xzAlts) ----------------------------------------------------------------------
    // Our own travel watchdog, independent of leanbot's unwedge ladder ( that ladder sat on rung 1 for an
    // hour: each re-plan resets its progress key). Progress = a new closest approach to the anchor OR a real move (> 4
    // tiles from where the stall started) — so a sidestep does not count, and a long detour away from the anchor does.
    private candStepIdx = -1; private killCand = 0;
    private twBest = Infinity; private twAt = { x: 0, z: 0 }; private twSince = -1; private twHits = 0;
    /** the anchor the current step travels to: `xz`, or its k-th fallback once the earlier ones wedged */
    protected stepXZ(step: QStep): { x: number; z: number } {
        if (this.candStepIdx !== this.stepIdx) { this.candStepIdx = this.stepIdx; this.killCand = 0; this.twReset(); }
        const alts = step.xzAlts ?? [];
        const k = this.killCand % (alts.length + 1);
        return k === 0 ? step.xz : alts[k - 1]!;
    }
    private twReset(): void { this.twBest = Infinity; this.twSince = -1; this.twHits = 0; this.killSince = -1; }
    private killSince = -1;   // tick the kill step first hunted at the CURRENT anchor (-1 = not yet)
    /** next anchor of a kill step with fallbacks; restarts travel from the step machine (doCombat runs while arrived) */
    private nextKillAnchor(step: QStep, why: string): void {
        const from = this.stepXZ(step);
        this.killCand++; this.twReset();
        const nx = this.stepXZ(step);
        console.log(`[quest] ${this.loginUser}: step ${this.stepIdx} (${step.label ?? ''}): anchor (${from.x},${from.z}) ${why} — trying the next spot (${nx.x},${nx.z})`);
        this.resetStepToNpc(); this.phase = 'travel'; this.mlStarted = false;
    }
    /** called every travelling tick of a step with fallbacks; true = it switched the anchor (re-plan next tick) */
    private killAnchorWatch(step: QStep): boolean {
        if (!step.xzAlts?.length) return false;
        const ticks = Math.max(5, Number(process.env.QR_WEDGE_TICKS ?? 50) || 50);
        const max = Math.max(1, Number(process.env.QR_WEDGE_MAX ?? 2) || 2);
        const me = this.tile(); const to = this.stepXZ(step);
        const d = Math.max(Math.abs(me.x - to.x), Math.abs(me.z - to.z));
        const moved = Math.max(Math.abs(me.x - this.twAt.x), Math.abs(me.z - this.twAt.z)) > 4;
        if (this.twSince < 0 || d < this.twBest || moved) { this.twBest = Math.min(this.twBest, d); this.twAt = me; this.twSince = this.tickCount; return false; }
        if (this.tickCount - this.twSince < ticks) return false;
        this.twHits++; this.twSince = this.tickCount; this.twAt = me;
        console.log(`[quest] ${this.loginUser}: step ${this.stepIdx} (${step.label ?? ''}) travel to (${to.x},${to.z}) WEDGED at (${me.x},${me.z}) — ${this.twHits}/${max}`);
        if (this.twHits < max) return false;
        this.killCand++; this.twReset();
        const nx = this.stepXZ(step);
        console.log(`[quest] ${this.loginUser}: step ${this.stepIdx}: anchor (${to.x},${to.z}) unreachable — trying the next spot (${nx.x},${nx.z})`);
        this.startMultiTravel(step.level ?? 0, nx.x, nx.z);   // re-target NOW: doCombat does not run while arrived=false
        this.mlStarted = true;
        return true;
    }
    // ⛔ WHY THE WATCH HANGS OFF travelAssist: LeanBot.brain() hands every tick with arrived=false to travelAssist() +
    // doTravel() and never calls doCombat (our step machine), so a watch placed in the travel phase would never run.
    protected override travelAssist(): boolean {
        const step = this.cur();
        if (step && step.op === 'kill' && this.phase === 'travel' && this.mlStarted && this.killAnchorWatch(step)) return true;
        return super.travelAssist();
    }
    /** QStep.heldAlso / expectItem: the kill step's product is already in the pack */
    private killHeld(step: QStep): boolean {
        if (step.expectItem !== undefined && this.countOf(step.expectItem) >= (step.expectCount ?? 1)) return true;
        return (step.heldAlso ?? []).some(o => this.countOf(o) > 0);
    }
    private npcIndexOf(type: number): number { for (let i = 0; i < this.npcCount; i++) { const idx = this.npcIndices[i]; const n = this.npcs[idx]; if (n && n.typeId === type) return idx; } return -1; }
    private npcIndexOfAny(types: readonly number[]): number {
        for (let i = 0; i < this.npcCount; i++) { const idx = this.npcIndices[i]; const n = this.npcs[idx]; if (n && types.includes(n.typeId)) return idx; }
        return -1;
    }

    // ---- NO SILENT STALL ----------------------------------------------------------------------------
    // ⛔ EVERY WAITING PATH IN THIS CLASS ROUTES THROUGH HERE. The failure this repo keeps paying for is
    // a step that cannot proceed and says NOTHING — a diagonal stand tile, a missing use-item, an npc
    // that never respawned. A progress line naming the STAGE (step index + label + phase + tile) every
    // QR_LOG_TICKS ticks turns "the bot is wedged" into "step 6 useloc is holding at (2892,9831) with no
    // raw beef in the pack". `why` is the specific reason THIS tick could not advance.
    private hold(step: QStep | null, why: string): void {
        const every = Math.max(1, Number(process.env.QR_LOG_TICKS ?? 10));
        if (this.tickCount % every === 0) {
            const me = this.tile();
            const stage = step ? `step ${this.stepIdx}/${this.steps.length} [${step.label ?? step.op}]` : 'no step';
            console.log(`[quest] ${this.loginUser}: ${stage} phase=${this.phase} @(${me.x},${me.z},L${this.travelLevel}) — ${why}`);
        }
        this.warm();
    }
    // WALK-BEFORE-OP (the tutorial-guide / attack pattern): a MOVE(opclick) to the npc's LIVE tile
    // makes the server route there and hold the queued op until in range — and the engine FOLLOWS a
    // wandering npc. Bare OPNPC did NOT self-route across the 5-tile gap to a pacing Duke on L1
    // (live-caught); this does. useItem (OPNPCU) rides the same approach.
    private approachAndOp(idx: number, step: QStep): void {
        const n = this.npcs[idx]; if (n) { const w = this.npcWorldTile(n); this.sendMove(w.x, w.z, true); }
        if (step.op === 'use') { const slot = step.useItem !== undefined ? this.slotOf(step.useItem) : -1; if (slot >= 0) this.useItemOnNpc(idx, step.useItem!, slot); }
        else this.opNpc(idx, 1);
    }

    /** stall-door rule (see the comment inside); true = it issued a door op this tick. Called by doCombat and by
     *  subclasses that return early (RmRecoverBot) so it always runs. */
    protected stallDoorTick(): boolean {
    // STALLED NEXT TO A CLOSED DOOR (generic; moved here from RmRecoverBot so EVERY quest bot has it): the
    // planner masks doors and the quest walker never opens them, so a MAP-PLACED CLOSED door wedges the bot on its tile
    // (live: Lumbridge castle 1536 held the RM batches; Dunstan's smithy door 1530 @(2920,3576) held the Death Plateau
    // quester in 'waiting for the dialog to open'). No tile change for 30 ticks on travel/interact/dialog/verify with
    // no dialog open -> op the nearest door the tracker knows as CLOSED within 3 tiles (rate-limited, <= 8 per tile; a
    // tracker that is wrong about an open door costs only an id-miss).
        const ph = this.phase; const me = this.tile(); const key = `${me.x},${me.z}`;
        const noDialog = (this as any).chatModalId === -1 && (this as any).mainModalId === -1;
        if (key !== this.stallKey) { this.stallKey = key; this.stallSince = this.tickCount; this.stallDoorOps = 0; }
        else if ((ph === 'travel' || ph === 'interact' || ph === 'dialog' || ph === 'verify') && noDialog
            && this.tickCount - this.stallSince >= 30 && this.stallDoorOps < 8 && this.tickCount - this.stallDoorAt >= 15) {
            const cd = (this as any).doorTracker?.nearestClosed((this as any).travelLevel ?? 0, me.x, me.z, 3);
            if (cd) {
                this.opLoc(cd.x, cd.z, cd.locId, cd.op); this.stallDoorAt = this.tickCount; this.stallDoorOps++;
                console.log(`[quest] ${this.loginUser}: stalled ${this.tickCount - this.stallSince} ticks at (${me.x},${me.z}) — opening closed door ${cd.locId} @(${cd.x},${cd.z})`);
                return true;
            }
        }
        return false;
    }

    protected override doCombat(): void {
        if (!this.backpack()) { this.warm(); return; }
        const step = this.cur();
        if (!step) { if (!this.done) { this.done = true; console.log(`[quest] ${this.loginUser}: ALL STEPS DONE`); } this.warm(); return; }

        // ⛔ HEAL FIRST. brain() routes mode==='combat' straight into doCombat and RETURNS, so the base
        // heal loop at branch (e3) never runs for this class. That was harmless while every step was a
        // conversation; the Taverley-dungeon leg takes real melee from two suits of armour
        // (prison_doors.rs2:6-19), so an unfed runner would stand there and die mid-quest.
        if (this.tryHeal()) return;

        if (this.stallDoorTick()) return;

        // completion check runs every tick (the effect lands async after the dialog closes)
        if (this.phase === 'verify') {
            const want = step.expectCount ?? 1;
            const gained = step.expectItem !== undefined && this.countOf(step.expectItem) >= Math.max(want, (this.preItem < 0 ? 0 : this.preItem) + 1);
            const consumed = step.consumeItem !== undefined && this.countOf(step.consumeItem) === 0;
            // ⛔ THE JOURNAL COLOUR IS THE ONLY OBSERVABLE A REWARD-LESS FINAL STEP HAS. `undefined` here
            // means NOT_OBSERVABLE (the client never saw an IF_SETCOLOUR for this row), which is NOT
            // "incomplete" — so it neither advances nor is mistaken for failure; the retry arm below
            // re-talks and the log names it.
            const questDone = step.questComplete !== undefined && this.isQuestComplete(step.questComplete) === true;
            const noGate = step.expectItem === undefined && step.consumeItem === undefined && step.questComplete === undefined;
            if (gained || consumed || questDone || noGate) {
                console.log(`[quest] ${this.loginUser}: step ${this.stepIdx} (${step.label ?? ''}) done`);
                this.stepIdx++; this.phase = 'travel'; this.attemptSince = -1; this.mlStarted = false; this.locOps = 0;
                return;
            }
            // outcome not observed -> the interaction didn't take (wrong branch / not in range): retry
            if (this.tickCount - this.attemptSince > 40) { this.phase = 'interact'; this.attemptSince = this.tickCount; }
            this.hold(step, `waiting for the outcome (${step.questComplete ? `journal '${step.questComplete}'=${this.isQuestComplete(step.questComplete) ?? 'NOT_OBSERVABLE'}` : step.expectItem !== undefined ? `+obj ${step.expectItem}` : `-obj ${step.consumeItem}`})`);
            return;
        }

        // TRAVEL: MULTI-LEVEL aware. A quest NPC can be upstairs (Duke, castle L1) or in a basement
        // (Sedridor, wizard-tower underground z>6400); startMultiTravel plans the ladder chain (via the
        // injected multiLevelPlanFn) and doTravel/mlDrive drive it while arrived=false — so THIS block
        // (which the base loop only runs once arrived) just kicks the plan off, then waits for arrival.
        if (this.phase === 'travel') {
            // RESUME: a kill step whose product is already carried (relaunch mid-gather) is done before any walking
            if (step.op === 'kill' && this.backpack() && this.killHeld(step)) { this.advanceStep(step, 'already in the pack'); return; }
            // RESUME: a use-on-loc step whose PRODUCT is carried and whose input is gone already ran (relaunch after the druidic
            // dips: sim rdr1 held 'missing use-item 2132 — nothing to dip' forever with the enchanted beef in the pack)
            if (step.op === 'useloc' && this.backpack() && step.useItem !== undefined && step.expectItem !== undefined
                && this.slotOf(step.useItem) < 0 && this.countOf(step.expectItem) > 0) { this.advanceStep(step, 'product already in the pack'); return; }
            if (!this.travelEnabled) { this.phase = 'interact'; this.attemptSince = this.tickCount; return; }
            const to = this.stepXZ(step);
            if (!this.mlStarted) {
                const me = this.tile(); const lvl = step.level ?? 0;
                // a walk-through door we are ALREADY past (resume / early teleport): never walk back to its near side
                if (step.op === 'oploc' && step.doneBox && lvl === this.travelLevel && inDoneBox(me, step.doneBox, step.xz)) { this.advanceStep(step, `already past (${me.x},${me.z})`); return; }
                if (step.skipIfIn && this.travelLevel === 0 && inDoneBox(me, step.skipIfIn)) { this.advanceStep(step, `resume: already at (${me.x},${me.z}), past this step's leg`); return; }
                if (step.op === 'bank' && this.packClean(step)) { this.advanceStep(step, 'pack already clean'); return; }
                const atTarget = lvl === this.travelLevel && Math.max(Math.abs(me.x - to.x), Math.abs(me.z - to.z)) <= 3;
                if (atTarget) { this.phase = 'interact'; this.attemptSince = this.tickCount; return; }
                if (!this.findLongPathFn) { this.hold(step, 'no findLongPathFn injected — travel cannot start'); return; }
                this.startMultiTravel(lvl, to.x, to.z);   // sets arrived=false -> doTravel takes over
                this.mlStarted = true; return;
            }
            if (this.arrived) { this.mlStarted = false; this.phase = 'interact'; this.attemptSince = this.tickCount; return; }
            this.hold(step, `travelling to (${to.x},${to.z},L${step.level ?? 0})`); return;   // doTravel is driving
        }

        // ---- LOC STEPS ('useloc' / 'oploc') and 'kill' -----------------------------------------------
        // These have no dialog, so they run interact -> verify directly (a 50-tick "maybe there was no
        // dialog" wait x4 dips would burn two minutes for nothing).
        if (this.phase === 'interact' && (step.op === 'useloc' || step.op === 'oploc')) { this.doLocStep(step); return; }
        if (this.phase === 'interact' && step.op === 'bank') { this.doBankStep(step); return; }
        if (this.phase === 'interact' && step.op === 'kill') { this.doKillStep(step); return; }

        if (this.phase === 'interact') {
            const idx = this.npcIndexOf(step.npcType!);
            if (idx < 0) {
                // FAR FROM THE NPC'S SPOT (a death respawn, a teleport, a resume): travel back instead of waiting here forever.
                // Sim (clean checkout): a level-3 Rune Mysteries runner died in Aubury's shop at step 3, respawned in
                // Lumbridge and held 'npc 553 is not in the scene' in 'interact' for good. Within 12 tiles: wait as before.
                const me = this.tile(), to = this.stepXZ(step);
                if (this.travelEnabled && ((step.level ?? 0) !== this.travelLevel || Math.max(Math.abs(me.x - to.x), Math.abs(me.z - to.z)) > 12)) {
                    console.log(`[quest] ${this.loginUser}: step ${this.stepIdx} (${step.label ?? ''}): npc ${step.npcType} not here and we are at (${me.x},${me.z},L${this.travelLevel}), far from (${to.x},${to.z},L${step.level ?? 0}) — travelling back`);
                    this.resetStepToNpc(); this.phase = 'travel'; this.mlStarted = false; return;
                }
                this.resetStepToNpc(); this.hold(step, `npc ${step.npcType} is not in the scene`); return;
            }
            // APPROACH the (possibly wandering) npc to interaction range via the reusable stepToNpc
            // primitive — a throttled stable target on the npc's OWN side of walls. Multi-level travel
            // only gets us within ~6; this closes the finicky last stretch to a moving Duke without the
            // jitter that a per-tick chase or a fixed-coord arrival hit.
            if (this.stepToNpc(idx, 2)) { this.warm(); return; }
            if (this.tickCount - this.lastActTick < 4) { this.warm(); return; }
            this.preItem = step.expectItem !== undefined ? this.countOf(step.expectItem) : -1;
            if (step.op === 'use' && this.slotOf(step.useItem ?? -1) < 0) { this.hold(step, `missing use-item ${step.useItem} — cannot proceed`); return; }
            this.approachAndOp(idx, step);   // in range -> walk-before-op; engine follows the last 1-2 tiles
            this.lastActTick = this.tickCount;
            this.phase = 'dialog'; this.attemptSince = this.tickCount; this.sawDialog = false; this.choiceIdx = 0;
            return;
        }

        // DIALOG: the base brain() intercepts an OPEN chat modal and routes it to our driveDialog()
        // override (which picks the step's choice / clicks continue), returning before doCombat. So
        // doCombat only runs here with the modal CLOSED — we detect completion / drive the approach:
        //   sawDialog (the override drove >=1 page) + modal closed  -> the interaction finished -> verify
        //   never opened after a LONG timeout                       -> no dialog (direct effect) -> verify
        if (this.phase === 'dialog') {
            if (this.sawDialog) { this.phase = 'verify'; this.attemptSince = this.tickCount; this.warm(); return; }
            // Not talking YET: the walk-before-op issued in `interact` self-routes the server to the npc
            // AND the engine FOLLOWS a WANDERING npc from that SINGLE issue. Do NOT re-issue while waiting
            // (each new MOVE resets the route to the npc's changed tile -> jitter). But if the npc has
            // WANDERED OUT of interaction range, the follow won't recover -> re-APPROACH (back to interact,
            // which stepToNpc's the stable-target walk again). Otherwise wait; a long timeout assumes a
            // direct/no-dialog effect.
            const idx = this.npcIndexOf(step.npcType!);
            if (idx >= 0 && this.stepToNpc(idx, 4)) { this.phase = 'interact'; this.attemptSince = this.tickCount; return; }
            if (this.tickCount - this.attemptSince > 50) { this.phase = 'verify'; this.attemptSince = this.tickCount; }
            this.hold(step, 'waiting for the dialog to open');
            return;
        }
    }

    /**
     * OPLOCU / OPLOC on a FIXED loc (the Cauldron of Thunder; the cauldron door).
     *
     * ⛔ CARDINAL, NOT DIAGONAL, AND THE STAND TILE IS EXACT. OPLOC/OPLOCU do NOT self-route (leanbot
     * opLoc's own note: from out of reach the engine answers "I can't reach that!" every tick and the
     * player never steps), and rsmod's reached() accepts ONLY the four cardinal faces of a 1x1 loc —
     * measured offline for loc 2142: all four diagonals are walkable AND all four answer reached=false.
     * So this walks to `step.xz` EXACTLY (not "within 3") before it sends anything, and says so if it
     * cannot get there.
     */
    private doLocStep(step: QStep): void {
        const loc = step.loc;
        if (!loc) { this.hold(step, `op '${step.op}' has no loc — the step list is malformed`); return; }
        const me = this.tile();
        // WALK-THROUGH DOOR: the observable is WHICH SIDE we stand on (the server p_teleports the player across; a prison
        // door never reports open). Checked before walking: once through, the near-side stand is behind a shut door.
        if (step.op === 'oploc' && step.doneBox && inDoneBox(me, step.doneBox, step.xz)) { this.advanceStep(step, `through — now at (${me.x},${me.z})`); return; }
        if (this.closeIn(step, step.xz.x, step.xz.z, 'closing to the CARDINAL stand tile')) return;
        if (this.tickCount - this.lastActTick < 4) { this.warm(); return; }
        if (step.op === 'oploc') {
            // A door that is ALREADY open must not be op'd again — op1 on an open door CLOSES it.
            if (this.doorTracker?.isOpen(this.travelLevel, loc.x, loc.z) === true) {
                console.log(`[quest] ${this.loginUser}: step ${this.stepIdx} (${step.label ?? ''}) done — door (${loc.x},${loc.z}) is open (tracker)`);
                this.stepIdx++; this.phase = 'travel'; this.attemptSince = -1; this.mlStarted = false; this.locOps = 0; return;
            }
            // ⛔ THE CAULDRON DOOR IS INVISIBLE TO THE DOOR TRACKER, AND THAT IS A CONTENT-SHAPE FACT,
            // NOT A BUG HERE. `DoorTracker.seed`/`onLocDel` only touch a tile whose locId has a row in
            // door-states.json, and `extract-door-states.mjs` classifies by a category ending in
            // `_closed`/`_opened`. `cauldrondoor`/`cauldrondoor_l` (loc 2143/2144,
            // area_taverly/dungeon/configs/taverly_dungeon.loc:7,17) carry
            // `category=double_door_open_and_close_right`/`_left`, which matches NEITHER suffix — so the
            // extractor skips them, `doorDef(2144)` is undefined, and `isOpen` answers `undefined`
            // FOREVER no matter how many times the server swings the door.
            //
            // So this step spends a BOUNDED op budget instead of waiting on an observable that cannot
            // arrive: prison_doors.rs2:6-19 needs up to THREE ops (the first two spawn a suit of armour
            // and return early), QR_DOOR_OPS defaults to 6 for margin, and the budget being SPENT is
            // reported at error level rather than silently. The next step (the first cauldron dip) has
            // a real observable — enchanted beef in the pack — so a door that never opened surfaces
            // there as a named `useloc` hold, not as a wedge.
            const budget = Math.max(1, Number(process.env.QR_DOOR_OPS ?? 6));
            if (this.locOps >= budget && step.doneBox) {
                // a doneBox door has a REAL observable, so a spent budget is a retry window, never "advance blind"
                // (an advance from the wrong side of a prison door wedges the next step behind it).
                if (this.tickCount - this.lastActTick < 60) { this.hold(step, `spent ${budget} OPLOCs on loc ${loc.id}@(${loc.x},${loc.z}) and still on the near side — retrying in ${60 - (this.tickCount - this.lastActTick)}t`); return; }
                console.error(`[quest] ${this.loginUser}: ⛔ step ${this.stepIdx} (${step.label ?? ''}) — ${budget} OPLOCs on loc ${loc.id} did not put us through; retrying (the suits of armour respawn every 500t)`);
                this.locOps = 0;
            }
            if (this.locOps >= budget) {
                console.error(`[quest] ${this.loginUser}: ⛔ step ${this.stepIdx} (${step.label ?? ''}) — spent all ${budget} ` +
                    `OPLOCs on loc ${loc.id}@(${loc.x},${loc.z}) and the door tracker cannot see this loc ` +
                    `(no door-states.json row for ${loc.id}). ADVANCING BLIND; if the door is in fact still ` +
                    `shut the next step will hold and name itself.`);
                this.stepIdx++; this.phase = 'travel'; this.attemptSince = -1; this.mlStarted = false; this.locOps = 0; return;
            }
            this.opLoc(loc.x, loc.z, loc.id, loc.op ?? 1);
            this.locOps++;
            this.lastActTick = this.tickCount;
            this.hold(step, `OPLOC ${loc.id}@(${loc.x},${loc.z}) ${this.locOps}/${budget} (a suit of armour may have spawned instead of the door opening)`);
            return;
        }
        const slot = this.slotOf(step.useItem ?? -1);
        if (slot < 0) { this.hold(step, `missing use-item ${step.useItem} — nothing to dip`); return; }
        this.preItem = step.expectItem !== undefined ? this.countOf(step.expectItem) : -1;
        this.useItemOnLoc(loc.x, loc.z, loc.id, step.useItem!, slot);
        this.lastActTick = this.tickCount;
        this.phase = 'verify'; this.attemptSince = this.tickCount;
    }

    /**
     * KILL-AND-LOOT: swing at any npc of `npcTypes` until `expectItem` x `expectCount` is in the pack.
     *
     * The drop is a GUARANTEED `obj_add(npc_coord, <meat>, 1, ^lootdrop_duration)` in the npc's
     * ai_queue3 death script (cow.rs2:11, chicken.rs2:14, giant_rat.rs2:8, bear.rs2:12), so this needs
     * no drop-rate model — kill, take, done. Loot is taken FIRST (a pile despawns; a respawning npc
     * does not), and OPOBJ self-routes naively so a MOVE precedes it, exactly like tryTakeLoot.
     */
    private doKillStep(step: QStep): void {
        const want = step.expectCount ?? 1;
        if (step.expectItem !== undefined && this.countOf(step.expectItem) >= want) {
            this.preItem = -1; this.phase = 'verify'; this.attemptSince = this.tickCount; return;
        }
        if (step.expectItem !== undefined) {
            const pile = this.findGroundItem(step.expectItem, 12);
            if (pile) {
                const me = this.tile();
                if (Math.max(Math.abs(pile.x - me.x), Math.abs(pile.z - me.z)) >= 2) this.sendMove(pile.x, pile.z, true);
                if (this.tickCount - this.lastActTick >= 2) { this.opObj(pile.x, pile.z, pile.obj, 3); this.lastActTick = this.tickCount; }
                this.hold(step, `taking obj ${step.expectItem} at (${pile.x},${pile.z})`);
                return;
            }
        }
        // ARRIVED BUT NOTHING TO SHOW FOR IT (no target in the scene, or one we can see but never reach — the maze rats are
        // visible through the walls): with fallback anchors, QR_KILL_TICKS (default 300) without the product -> next spot.
        if (step.xzAlts?.length && this.travelEnabled) {
            if (this.killSince < 0) this.killSince = this.tickCount;
            else if (this.tickCount - this.killSince > Math.max(20, Number(process.env.QR_KILL_TICKS ?? 300) || 300)) { this.nextKillAnchor(step, `gave no obj ${step.expectItem} in ${this.tickCount - this.killSince} ticks`); return; }
        }
        const types = step.npcTypes ?? (step.npcType !== undefined ? [step.npcType] : []);
        const idx = this.npcIndexOfAny(types);
        if (idx < 0) { this.resetStepToNpc(); this.hold(step, `no npc of type(s) [${types.join(',')}] in the scene — waiting for a respawn`); return; }
        if (this.stepToNpc(idx, 1)) { this.hold(step, `closing on npc index ${idx}`); return; }
        // Re-issue the attack on a cadence: the engine keeps swinging on its own, but a dead target /
        // a stolen kill leaves us idle, and OPNPC2 on an already-engaged target is harmless.
        if (this.tickCount - this.lastActTick >= 8) {
            const n = this.npcs[idx];
            if (n) { const w = this.npcWorldTile(n); this.sendMove(w.x, w.z, true); }
            this.opNpc(idx, 2);
            this.lastActTick = this.tickCount;
        }
        this.hold(step, `fighting npc index ${idx} for obj ${step.expectItem}`);
    }

    // ---- CLOSE-IN WATCHDOG (generic, every exact-stand step: useloc / oploc / bank) ------------------------------------
    // ⛔  the first cauldron dip held 'closing to the CARDINAL stand tile (2892,9831)' from (2888,9830) for
    // 7,400 ticks — walkToExact planned through a door the server never opens, the bot never moved, and the only trace was
    // the same INFO line every 10 ticks. The interact phase only closes the LAST few tiles (travel delivered us within 3),
    // so (a) a stand FAR away / in the other stratum means travel never delivered (a parked multi-level plan), and (b) no
    // tile change for QR_CLOSE_TICKS ticks (default 50; the stall-door rule opens a tracked door after 30) means the walk
    // is wedged. Either way: re-plan from scratch through the travel phase, up to QR_CLOSE_REPLANS times (default 3), each
    // at ERROR level; after that it keeps walking but says WEDGED at error level every 100 ticks. Env read at call time.
    private closeKey = ''; private closeTile = ''; private closeSince = -1; private closeReplans = 0; private closeLoudAt = -1000;
    /** true = still closing in on (tx,tz) (the caller returns); false = standing on it. */
    private closeIn(step: QStep, tx: number, tz: number, what: string): boolean {
        const me = this.tile();
        const key = `${this.stepIdx}:${tx},${tz}`;
        if (key !== this.closeKey) { this.closeKey = key; this.closeReplans = 0; this.closeSince = -1; this.closeTile = ''; }
        if (me.x === tx && me.z === tz) { this.closeSince = -1; this.closeTile = ''; return false; }
        const tk = `${me.x},${me.z}`;
        if (tk !== this.closeTile) { this.closeTile = tk; this.closeSince = this.tickCount; }
        const d = Math.max(Math.abs(me.x - tx), Math.abs(me.z - tz));
        const far = (me.z >= 6400) !== (tz >= 6400) || d > Math.max(8, Number(process.env.QR_CLOSE_FAR ?? 24) || 24);
        const still = this.tickCount - this.closeSince;
        if (far || still >= Math.max(10, Number(process.env.QR_CLOSE_TICKS ?? 50) || 50)) {
            const max = Math.max(0, Number(process.env.QR_CLOSE_REPLANS ?? 3) || 0);
            const why = far ? `the stand (${tx},${tz}) is ${d} tiles away / in the other stratum — travel never delivered us`
                : `no tile change at (${me.x},${me.z}) for ${still} ticks walking at the stand (${tx},${tz})`;
            if (this.travelEnabled && this.closeReplans < max) {
                this.closeReplans++;
                console.error(`[quest] ${this.loginUser}: ⛔ step ${this.stepIdx} (${step.label ?? step.op}) — ${why}; RE-PLANNING travel (${this.closeReplans}/${max})`);
                this.phase = 'travel'; this.mlStarted = false; this.attemptSince = -1; this.closeSince = this.tickCount; this.closeTile = '';
                this.warm(); return true;
            }
            if (this.tickCount - this.closeLoudAt >= 100) {
                this.closeLoudAt = this.tickCount;
                console.error(`[quest] ${this.loginUser}: ⛔ WEDGED step ${this.stepIdx} (${step.label ?? step.op}) — ${why}; ${this.travelEnabled ? `${max} re-plans spent` : 'travel disabled'}. A wall/door the planners do not model sits between us and the stand: fix the step list or the navgrid door data (sdk/navgrid/quest-gated-doors.json).`);
            }
        }
        if (this.walkToExact(tx, tz)) { this.hold(step, `${what} (${tx},${tz})`); return true; }
        return false;
    }

    /** advance past the current step with a log line (the verify phase's own advance, reused by doneBox/bank). */
    protected advanceStep(step: QStep, why: string): void {
        console.log(`[quest] ${this.loginUser}: step ${this.stepIdx} (${step.label ?? ''}) done — ${why}`);
        this.stepIdx++; this.phase = 'travel'; this.attemptSince = -1; this.mlStarted = false; this.locOps = 0; this.bankOpenAt = -100;
    }

    // ---- BANK STEP -------------------------------------------------------------------------------------------------
    // ⛔ WHY A QUEST LIST BANKS AT ALL: an account can arrive with a full pack (21 sharks + coins + harpoon + net
    // = 24 slots) and the kill lane needs 4 slots for the meats plus `expectCount` for anything else it
    // collects (unicorn horns). A kill step that cannot pick its drop up holds forever. Synchronous + packet-level like
    // every bank driver here (the tick hook must never await): OPLOC2 the booth, then one deposit per 2 ticks from the
    // bank side panel (2006) — deposit-all (op4) for an id with no keep, else the largest of 10/5/1 that does not
    // overshoot the keep — and close. The pack itself is the observable: DONE when nothing exceeds `keep`.
    private bankOpenAt = -100;
    private static readonly BANK_MAIN = 5292;
    private static readonly BANK_SIDE = 2006;
    /** obj -> units in the pack beyond the step's keep (0 entries omitted). */
    private packExcess(step: QStep): Map<number, { n: number; slot: number }> {
        const out = new Map<number, { n: number; slot: number }>();
        const held = new Map<number, { n: number; slot: number }>();
        for (const s of this.backpackSlots()) { const h = held.get(s.obj); if (h) h.n += s.count; else held.set(s.obj, { n: s.count, slot: s.slot }); }
        for (const [obj, h] of held) { const ex = h.n - (step.keep?.[obj] ?? 0); if (ex > 0) out.set(obj, { n: ex, slot: h.slot }); }
        return out;
    }
    protected packClean(step: QStep): boolean { return this.backpack() !== undefined && this.packExcess(step).size === 0; }
    private doBankStep(step: QStep): void {
        if (this.packClean(step)) { this.advanceStep(step, 'pack clean'); return; }
        const loc = step.loc;
        if (!loc) { this.hold(step, `op 'bank' has no booth loc — the step list is malformed`); return; }
        const me = this.tile();
        if (this.closeIn(step, step.xz.x, step.xz.z, 'walking onto the booth stand')) return;
        if (this.mainModalId === QuestRunnerBot.BANK_MAIN) { this.warm(); return; }   // handleMainModal drives it
        if (this.tickCount - this.bankOpenAt >= 8) { this.opLoc(loc.x, loc.z, loc.id, loc.op ?? 2); this.bankOpenAt = this.tickCount; }
        this.hold(step, `opening the bank booth ${loc.id}@(${loc.x},${loc.z})`);
    }
    protected override handleMainModal(): boolean {
        const step = this.cur();
        if (!step || step.op !== 'bank' || this.mainModalId !== QuestRunnerBot.BANK_MAIN) return super.handleMainModal();
        if (this.tickCount - this.lastActTick < 2) { this.warm(); return true; }
        const ex = this.packExcess(step);
        if (ex.size === 0) { this.sendCloseModalPublic(); this.lastActTick = this.tickCount; this.advanceStep(step, 'deposited'); return true; }
        const [obj, e] = ex.entries().next().value as [number, { n: number; slot: number }];
        const keepN = step.keep?.[obj] ?? 0;
        const op = keepN === 0 ? 4 : e.n >= 10 ? 3 : e.n >= 5 ? 2 : 1;   // bank side: op1/2/3/4 = deposit 1/5/10/all
        this.invButton(op, obj, e.slot, QuestRunnerBot.BANK_SIDE);
        this.lastActTick = this.tickCount;
        return true;
    }

    status(): string { return `${this.loginUser}:quest[step ${this.stepIdx}/${this.steps.length}${this.done ? ' DONE' : ''}]`; }
}

// ---- STANDALONE RUNNER --------------------------------------------------------------------------
// Live smoke: LC_HOST=localhost:8888 QR_QUEST=rune_mysteries bun server/webclient/headless/quest-runner.ts [user] [pass]
// Injects BOTH planners: findLongPathFn (navgrid + underground fallback, per-stratum) AND
// multiLevelPlanFn (the cross-stratum ladder planner) — so the runner WALKS to a basement/upstairs
// NPC via the real ladders instead of a scaffold tele.
if (import.meta.main) {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    if (!process.env.LC_HOST) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const questName = process.env.QR_QUEST ?? 'rune_mysteries';
    const steps = QUESTS[questName];
    if (!steps) { console.error(`unknown QR_QUEST=${questName}; known: ${Object.keys(QUESTS).join(', ')}`); process.exit(1); }
    const USER = process.argv[2] || 'qrunner1';
    const PASS = process.argv[3] || 'x';

    console.log('[quest] warming pathfinder + navgrid...');
    const { initPathfinding, blockDoor, findLongPath } = await import('../../../sdk/pathfinding');
    initPathfinding();
    const { applyBlockedEdges } = await import('./blocked-edges.js');
    applyBlockedEdges(blockDoor);
    const navgrid = await import('../../../sdk/navgrid/index');
    navgrid.init();
    const { planMultiLevel } = await import('../../../sdk/navgrid/levels');

    const bot = new QuestRunnerBot();
    bot.quiet = true;
    bot.setSteps(steps);
    // RESUME: a partially-done quest (e.g. talisman already obtained) must not re-run an early step
    // whose gain-check can't re-trigger (already holding the item) — it would retry forever. Set
    // QR_START_STEP to skip to the first un-done step.
    if (process.env.QR_START_STEP) bot.stepIdx = Number(process.env.QR_START_STEP);
    bot.enableDoorTracker();   // authoritative door state: skip open doors, proactively open closed ones
    const noNavgrid = process.env.QR_NO_NAVGRID === '1';   // force rsmod findLongPath (models building
    // walls correctly) — navgrid is a coarse surface overlay that routes THROUGH the wizard-tower walls,
    // so its path stalls the naive router at the tower entrance (RM step-4 live-caught). rsmod's exact
    // collision routes around them; fine for the short final legs.
    bot.findLongPathFn = (level, sx, sz, dx, dz) => {
        // navgrid.bin is a LEVEL-0 surface overlay — using it for upper floors (or underground) returns
        // a path computed against the wrong plane's clearance data. Only the SURFACE uses navgrid;
        // every other stratum goes straight to findLongPath (rsmod is fully multi-level). Live-caught:
        // the RM gap-close to Duke stalled on L1 because planRoute returned a bogus L0-derived path.
        if (!noNavgrid && navgrid.hasData(sx, sz, level) && navgrid.hasData(dx, dz, level)) {
            for (const arrive of [0, 2, 4]) {
                try { const r = navgrid.planRoute(sx, sz, dx, dz, { level, roadPreference: 1, clearanceWeight: 1, arrive, maxExpansions: 600_000 }); if (r) return r.waypoints.map(w => ({ x: w.x, z: w.z })); } catch { /* next */ }
            }
        }
        try { return guardRaw(findLongPath(level, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z })), level, sx, sz, dx, dz, '[quest]'); } catch { return []; }   // ⛔ WWM-guarded raw fallback
    };
    // cross-stratum planner: the ladder graph. Returns a leg plan or null.
    bot.multiLevelPlanFn = (from, to) => planMultiLevel(from, to) as any;

    if (!(await bot.login(USER, PASS))) { console.error('[quest] login failed'); process.exit(1); }
    bot.run(Number.MAX_SAFE_INTEGER).catch(e => console.error('[quest] run ended:', e?.message));
    // SUPERVISOR PRE-CHECK (quest-state.ts WIRING SPEC step 5): the journal colours arrive in the LOGIN
    // burst (~update_questlist runs before the first movement), so a quest that is ALREADY green can be
    // skipped without walking anywhere — and a yellow row warns that starting from step 0 will re-run a
    // step whose gain-check can no longer fire. NOT_OBSERVABLE is reported as such, never as "not done".
    const journalKey = steps[steps.length - 1]?.questComplete;
    if (journalKey) {
        await sleep(3000);
        const obs = bot.questState(journalKey);
        console.log(`[quest] journal '${journalKey}': ${obs.status} (atLeast=${obs.atLeast} atMost=${obs.atMost} via ${obs.source})`);
        if (obs.status === 'COMPLETE') { console.log(`[quest] ${questName} ALREADY COMPLETE — nothing to do`); process.exit(0); }
        if (obs.status === 'IN_PROGRESS' && !process.env.QR_START_STEP) {
            console.error(`[quest] ⛔ '${journalKey}' is IN_PROGRESS but QR_START_STEP is unset — step 0 will ` +
                `retry a stage the server has already passed. Set QR_START_STEP to the first un-done step.`);
        }
    }
    // The base loop auto-skips the tutorial island on its own (talks the guide while z<3180, before any
    // mode logic — leanbot.ts:1656); driveDialog() defers that guide prompt to super. Once in Lumbridge
    // the step machine takes over. No explicit skip call needed.

    const t0 = Date.now();
    while (!(bot as any).done && Date.now() - t0 < 20 * 60_000) {
        if ((bot as any).tickCount % 50 === 0) console.log(`[quest] ${bot.status()} @ (${bot.tile().x},${bot.tile().z})`);
        await sleep(600);
    }
    console.log((bot as any).done ? `[quest] ${questName} COMPLETE in ${((Date.now() - t0) / 1000).toFixed(0)}s` : `[quest] ${questName} TIMED OUT at ${bot.status()}`);
    process.exit((bot as any).done ? 0 : 1);
}

// =====================================================================================================
// ROUTE-FEASIBILITY ORACLE — "can THIS BOT actually walk this route, and if not, what stops it?"
// =====================================================================================================
// STANDALONE + OFFLINE. Reads map/config/script data only; never connects, never sends a packet, knows
// nothing about a live bot. How a caller wires it in is described in the WIRING SPEC at the bottom of
// this file.
//
// -----------------------------------------------------------------------------------------------------
// THE BUG THIS ANSWERS
// -----------------------------------------------------------------------------------------------------
// Bots can sit on (3268,3227), the Al Kharid toll gate's operable tile, indefinitely while their
// connection status reads healthy. `navgrid` masks that gate as an ordinary door, so it plans a route
// straight THROUGH a toll the bot has not handled: it blind-declines the modal over and over, even
// while holding enough coins for the 10 gp fare.
//
// `camp-reach-plan.ts` already answers "can navgrid PLAN a path?". That question was answered YES the
// whole time. This module answers the different one:
//
//     given a bot's coins, items, worn gear, skill levels and quest state — is every obstacle on this
//     route one that THIS bot can actually get through, and if not, WHICH one stops it and WHAT does it
//     need?
//
// -----------------------------------------------------------------------------------------------------
// ⛔ THE ONE INVARIANT: `UNKNOWN` IS A FIRST-CLASS ANSWER AND IS NEVER SILENTLY PASSABLE
// -----------------------------------------------------------------------------------------------------
// Under-reporting a blocker is the exact failure described above, so the whole stack is biased the
// other way. A loc whose handler this oracle cannot read, or that advertises "Open" with no script bound
// to it at all, comes back `UNKNOWN` — and an `UNKNOWN` anywhere on a route degrades the OVERALL verdict
// to `UNKNOWN`, which a supervisor must treat as "do not commit to this trip silently". A false
// `PASSABLE` is the dangerous outcome; a false `UNKNOWN` costs one probe.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ A RECORDED CONDITION IS THE REQUIREMENT, NOT THE REFUSAL — AND THAT IS THE GENERATOR'S JOB
// -----------------------------------------------------------------------------------------------------
// A gate's comparison in the content script is not necessarily the condition the bot must make true.
// Half the gates in the game are written the other way round:
//
//     mcannon_doors.rs2:3   if (%mcannon <  ^stage) { mes("The door is locked."); } else { open }
//     mcannon_doors.rs2:11  if (%mcannon >= ^stage) { open } else { mes("The door is locked."); }
//
// Six lines apart, opposite operators, IDENTICAL requirement. Reading the first one literally says a bot
// passes while its progress is BELOW the threshold — it calls a locked door open for a fresh account and
// a working door shut for a finished one, on all 53 refusal-shaped `<` gates.
//
// The fix lives in `extract-obstacles.mjs`, which parses the if/else chain around each comparison and
// emits the comparison ALREADY FLIPPED where the test guards a refusal, plus `rawOp` (what the script
// wrote), `polarity` and `strength`. This file consumes that and does not re-derive it. Where the
// generator could not read the branch it says `polarity: 'unknown'`, and that lands here as UNKNOWN —
// never as PASSABLE. See `questSatisfied` and `unreadableGate`.
//
// -----------------------------------------------------------------------------------------------------
// HOW AN OBSTACLE IS FOUND (geometry, not names)
// -----------------------------------------------------------------------------------------------------
// For each 1-tile step A->B of the route, `loc-scene` is asked for the locs on A and on B, and each is
// tested against the ENGINE's own collision geometry (server/engine/src/engine/routefinder/
// CollisionEngine.ts:137-212, mirrored in `blockedEdgesOf`/`footprintOf` below):
//   - a WALL-layer loc (shape 0..3) blocks a specific EDGE between two tiles;
//   - a GROUND-layer loc (shape 9..21) blocks its whole width x length FOOTPRINT.
// A loc is an obstacle only when the step actually crosses that edge / enters that footprint. Names are
// never used to decide — `Gate` is dozens of loc ids and half of them are ordinary hinges.
//
// Anything found this way is, by construction, something the ROUTER thought was open: a live-collision
// mask (`applyBlockedEdges`) or the navgrid's door handling let the plan through it. So every hit is
// worth classifying.
//
// -----------------------------------------------------------------------------------------------------
// COST (measured, see the test file's PERF block)
// -----------------------------------------------------------------------------------------------------
// This runs ONCE before a long trip, not per tick. Classification of an already-planned 1000-tile route
// is ~1-3 ms after warmup (it is 1000 zone-bucket lookups against loc-scene's in-memory index). The
// expensive part is the one-time warmup shared with the rest of the stack: `locScene.init()` (~2-4 s,
// one copy per process).
//
// =====================================================================================================

import * as locScene from './loc-scene.js';
import type { SceneLoc } from './loc-scene.js';
import RAW from './data/obstacles.json';

// -----------------------------------------------------------------------------------------------------
// public types
// -----------------------------------------------------------------------------------------------------

export interface Tile { x: number; z: number }
export interface Pos { x: number; z: number; level?: number }

/**
 * What a single obstacle demands of the bot standing in front of it.
 *
 * `UNKNOWN` is deliberately in the same enum as the rest, not a separate error channel: a caller that
 * switches on this type is forced to write a branch for "I do not know", which is the branch that is
 * easiest to forget.
 */
export type ObstacleClass =
    | 'PASSABLE'
    | 'NEEDS_PAYMENT'
    | 'NEEDS_ITEM'
    | 'NEEDS_LEVEL'
    | 'NEEDS_QUEST'
    | 'NEEDS_MEMBERS'
    | 'IMPASSABLE'
    | 'UNKNOWN';

/** A concrete thing the bot must acquire/do. Deduped across the route into `RouteVerdict.needs`. */
export type Need =
    | { kind: 'coins'; amount: number }
    | { kind: 'item'; objIds: number[]; objName: string; worn: boolean; count: number }
    | { kind: 'level'; skill: string; level: number }
    | { kind: 'quest'; quest: string; varp: string; stage: string | null; stageValue: number | null }
    | { kind: 'members' }
    | { kind: 'probe'; what: string };

/**
 * The bot, as far as an obstacle is concerned. EVERY FIELD IS OPTIONAL AND `undefined` MEANS "UNKNOWN",
 * NOT "ZERO" — a profile that omits `quests` must not make a quest gate look impossible, and one that
 * omits `skills` must not make an agility shortcut look failed. Omitted state downgrades the relevant
 * obstacle to `UNKNOWN` instead of inventing an answer.
 */
export interface BotProfile {
    /** Total coins carried (obj 995 and its stack variants). */
    coins?: number;
    /** obj ids in the inventory. */
    inventory?: number[];
    /** obj ids currently worn. */
    worn?: number[];
    /** Skill name (lowercase, engine spelling: `agility`, `defence`, `runecraft`) -> level. */
    skills?: Record<string, number>;
    /**
     * Quest VARP name (`princequest`, `priestperil`) -> its current stage VALUE.
     *
     * ⛔ THE MAP IS AUTHORITATIVE WHEN PRESENT. Every varp is 0 until the engine sets it, so a MISSING
     * KEY in a supplied map means "not started" (0), not "unknown" — a client that can read varps reads
     * all of them, and treating `{}` as unknown would make every quest-gated door in the world UNKNOWN
     * for a fresh account. To say "I cannot read quest state at all", OMIT THE WHOLE FIELD; that is
     * what produces UNKNOWN.
     */
    quests?: Record<string, number>;
    /**
     * NON-quest progress varps a gate can test, by varp NAME -> value. Today that is `tutorial`
     * (tutorial/configs/tutorial.varp), which gates the eight tutorial-island doors and ladders.
     *
     * Same contract as `quests`: supplying the map makes it authoritative (a missing key is 0), and
     * OMITTING it is what yields UNKNOWN. A bot that ran `skipTutorial()` knows its own value;
     * nothing here guesses one.
     */
    progress?: Record<string, number>;
    members?: boolean;
}

export interface RouteObstacle {
    /** 0-based position in `RouteVerdict.obstacles`, i.e. ROUTE ORDER. */
    index: number;
    /** Index of the step (route waypoint) this obstacle sits on. */
    stepIndex: number;
    /** The step it blocks. */
    from: Tile;
    to: Tile;
    /** Where the loc itself is placed. */
    at: { x: number; z: number; level: number };
    locId: number;
    locName: string;
    internal: string;
    category: string;
    shape: number;
    angle: number;
    /** The op the bot would have to use, and its menu text. null when the loc has no traversal op. */
    op: number | null;
    opText: string | null;
    cls: ObstacleClass;
    /** One sentence a human can act on. */
    reason: string;
    /** `server/content/scripts/...:LINE` — the authority for `cls`. null when there is no handler. */
    source: string | null;
    /** What this bot must acquire to pass. Empty for PASSABLE. */
    needs: Need[];
    /** Set when a requirement did not apply to THIS bot, e.g. the toll waived by a finished quest. */
    waived?: string;
}

export type OverallVerdict = 'PASSABLE' | 'BLOCKED' | 'UNKNOWN' | 'NO_ROUTE';

export interface RouteVerdict {
    /** true only for a clean `PASSABLE`. `UNKNOWN` is NOT ok. */
    ok: boolean;
    verdict: OverallVerdict;
    from: Pos;
    to: Pos;
    /** Number of route tiles inspected (0 when the planner returned nothing). */
    routeTiles: number;
    /** Every obstacle found, IN ROUTE ORDER, including the PASSABLE ones (a door is still a door). */
    obstacles: RouteObstacle[];
    /** The first obstacle whose class is not PASSABLE. This is the thing to fix. null when clean. */
    firstBlocking: RouteObstacle | null;
    /** Deduped union of every `needs` entry, so a caller can go shopping once. */
    needs: Need[];
    /** How many obstacles came back UNKNOWN. Non-zero forces the overall verdict to UNKNOWN. */
    unknownCount: number;
    /** Wall-clock cost of the classification (excludes any planning done by the caller's planner). */
    ms: number;
    /** Loud, single-line, greppable summary. Never empty. */
    note: string;
}

// -----------------------------------------------------------------------------------------------------
// the generated table (headless/data/extract-obstacles.mjs)
// -----------------------------------------------------------------------------------------------------

/**
 * How sure the generator is about a gate it read, and in which direction.
 *
 * ⛔ `strength` IS NOT DECORATION. `sufficient` means "meeting this proves you get through, FAILING IT
 * PROVES NOTHING" — the gate sat in an `A | B` (or the negation of an `A & B`) next to a condition this
 * table does not model, typically which SIDE of the door you are standing on. Treating an unmet
 * `sufficient` as BLOCKED would invent a wall; treating it as PASSABLE would hide one. It is UNKNOWN,
 * and that is the honest answer.
 */
type ReqStrength = 'exact' | 'required' | 'sufficient' | 'unknown';

/**
 * What the generator concluded the recorded comparison MEANS.
 *   satisfy   the bot must make `op` true (the condition guards the pass branch)
 *   negated   `op` has ALREADY been flipped from `rawOp` (the condition guarded a refusal branch)
 *   unknown   the branch structure was unreadable — this forces the obstacle to UNKNOWN
 * (`inert` exists in the generator and never reaches this file: those rows are dropped at build time
 * because both branches pass, so the comparison decides nothing. See extract-obstacles.mjs.)
 */
type ReqPolarity = 'satisfy' | 'negated' | 'unknown';

interface RawReq {
    /**
     * `progress` is a quest-shaped gate on a NON-quest variable (`%tutorial`); `puzzle` is a `testbit()`
     * lever/latch state no profile can supply and is therefore always UNKNOWN.
     */
    kind: 'payment' | 'item' | 'level' | 'quest' | 'progress' | 'puzzle' | 'members';
    key: string;
    amount?: number;
    objId?: number;
    objIds?: number[];
    objName?: string;
    worn?: boolean;
    count?: number;
    /** the item is required by the OPLOCU (use-item-on-loc) path, i.e. it is a key. */
    useItem?: boolean;
    skill?: string;
    level?: number | null;
    levelParam?: string;
    varp?: string;
    quest?: string | null;
    /** ⛔ THE CONDITION THE BOT MUST SATISFY — already polarity-corrected. Not what the script wrote. */
    op?: string;
    /** What the script literally wrote, for checking a row against its cited file:line. */
    rawOp?: string;
    polarity?: ReqPolarity;
    strength?: ReqStrength;
    /** compact branch evidence, e.g. `refuse:sole`, `pass:and:chain2`, `may-pass:or`. */
    shape?: string;
    /** `puzzle` only: what a human would have to read. */
    probe?: string;
    stage?: string | null;
    stageValue?: number | null;
    waivedBy?: { quest: string; varp: string; op: string; stage: string | null; stageValue: number | null };
}

/**
 * One arm of a `switch_coord (loc_coord)` handler: the rules that apply at ONE placement coordinate.
 * See `RawOp.coordCases`.
 */
interface RawCoordCase {
    /** The engine's coord literal, e.g. `0_40_53_10_49`. Provenance only; match on level/x/z. */
    coord: string;
    level: number;
    x: number;
    z: number;
    cls: string;
    reqs: RawReq[];
}

interface RawOp {
    /**
     * The oploc index (1..5) — EXCEPT `0`, which is the OPLOCU (use-item-on-loc) sentinel: a key door
     * whose ordinary "Open" only reports it locked. A brain acting on an `op: 0` obstacle must send
     * use-item-on-loc with the obj from `needs`, not an OPLOC.
     */
    op: number;
    opText: string;
    /** true on the `op: 0` key-door pseudo-op. */
    useItem?: boolean;
    cls: string;
    why?: string;
    via: string | null;
    source: string | null;
    /**
     * The WHOLE-HANDLER union of requirements. For a coord-scoped handler this is a superset of what
     * runs at any single placement — use `coordCases`/`coordDefault` for a placement-accurate answer.
     * Kept as the union because `extract-quests.mjs` inventories quest gates from exactly this array.
     */
    reqs: RawReq[];
    /** True when the handler is a `switch_coord (loc_coord)`; `coordCases`/`coordDefault` are then set. */
    coordScoped?: boolean;
    /** Per-coordinate rules, one per enumerated `case <coord>:`. */
    coordCases?: RawCoordCase[];
    /** What runs at a coordinate the switch does NOT enumerate. */
    coordDefault?: { cls: string; why?: string; reqs: RawReq[]; note?: string };
    note: string;
}

interface RawEntry {
    locId: number;
    internal: string;
    name: string;
    category: string;
    barrier: boolean;
    blockwalk: boolean;
    active: number;
    width: number;
    length: number;
    cls: string;
    ops: RawOp[];
}

interface RawTable {
    provenance: Record<string, unknown>;
    tally: Record<string, number>;
    tallyBarrier: Record<string, number>;
    /** Loc type ids declaring `blockwalk=no`. See `paintsCollision`. */
    nonBlockingLocIds: number[];
    entries: RawEntry[];
}

const TABLE = RAW as unknown as RawTable;

const BY_LOC_ID = new Map<number, RawEntry>();
for (const e of TABLE.entries) BY_LOC_ID.set(e.locId, e);

const NON_BLOCKING = new Set<number>(TABLE.nonBlockingLocIds);

/**
 * Does this loc type paint collision at all? `GameMap.ts:280` only calls `changeLocCollision`
 * `if (type.blockwalk)`, so a `blockwalk=no` type is INVISIBLE to the router and can never be an
 * obstacle no matter what its shape says.
 *
 * ⛔ THIS CHECK IS LOAD-BEARING. Without it, real navgrid routes came back littered with IMPASSABLE
 * Daisies, Ferns, Heather and Cabbages — 6 of the 8 "obstacles" on the 908-tile wedge-tile-to-Ardougne
 * run were flowers. A false blocker is not harmless here: it buries the true one.
 */
export function paintsCollision(locId: number): boolean {
    return !NON_BLOCKING.has(locId);
}

/** The generated requirement rules for a loc type, or undefined when it has no traversal op at all. */
export function obstacleRule(locId: number): RawEntry | undefined {
    return BY_LOC_ID.get(locId);
}

/** Provenance + per-class counts of the generated table, for the report and for tests. */
export function tableStats(): { provenance: Record<string, unknown>; tally: Record<string, number>; tallyBarrier: Record<string, number>; entries: number } {
    return { provenance: TABLE.provenance, tally: TABLE.tally, tallyBarrier: TABLE.tallyBarrier, entries: TABLE.entries.length };
}

// -----------------------------------------------------------------------------------------------------
// engine collision geometry (mirrors CollisionEngine.ts:137-212 exactly)
// -----------------------------------------------------------------------------------------------------

export const LOC_LAYER_WALL = 0;
export const LOC_LAYER_WALL_DECOR = 1;
export const LOC_LAYER_GROUND = 2;
export const LOC_LAYER_GROUND_DECOR = 3;

/** flags.ts:137 locShapeLayer — shapes 0..3 are walls, 4..8 decor (no collision), 9..21 ground, 22 decor. */
export function locShapeLayer(shape: number): number {
    if (shape >= 0 && shape <= 3) return LOC_LAYER_WALL;
    if (shape >= 4 && shape <= 8) return LOC_LAYER_WALL_DECOR;
    if (shape >= 9 && shape <= 21) return LOC_LAYER_GROUND;
    return LOC_LAYER_GROUND_DECOR;
}

/** An undirected edge between two orthogonally- or diagonally-adjacent tiles. */
export interface Edge { ax: number; az: number; bx: number; bz: number }

const edge = (ax: number, az: number, bx: number, bz: number): Edge => ({ ax, az, bx, bz });

/**
 * The tile-to-tile edges a WALL-layer loc blocks, from the engine's own `changeWallStraight` /
 * `changeWallL` / `changeWallCorner`. Angles are `LocAngle` WEST=0, NORTH=1, EAST=2, SOUTH=3.
 *
 * Straight (shape 0)  — one edge, on the named side of the loc's own tile.
 * L      (shape 2)    — TWO edges (the corner blocks both of its arms).
 * Corner (shapes 1,3) — one DIAGONAL edge only; it is a post, so it blocks the diagonal squeeze past it
 *                       and nothing else.
 */
export function blockedEdgesOf(x: number, z: number, shape: number, angle: number): Edge[] {
    if (shape === 0) {
        if (angle === 0) return [edge(x, z, x - 1, z)];      // WEST
        if (angle === 1) return [edge(x, z, x, z + 1)];      // NORTH
        if (angle === 2) return [edge(x, z, x + 1, z)];      // EAST
        return [edge(x, z, x, z - 1)];                       // SOUTH
    }
    if (shape === 2) {
        if (angle === 0) return [edge(x, z, x, z + 1), edge(x, z, x - 1, z)];   // north + west
        if (angle === 1) return [edge(x, z, x, z + 1), edge(x, z, x + 1, z)];   // north + east
        if (angle === 2) return [edge(x, z, x, z - 1), edge(x, z, x + 1, z)];   // south + east
        return [edge(x, z, x, z - 1), edge(x, z, x - 1, z)];                     // south + west
    }
    if (shape === 1 || shape === 3) {
        if (angle === 0) return [edge(x, z, x - 1, z + 1)];  // NW
        if (angle === 1) return [edge(x, z, x + 1, z + 1)];  // NE
        if (angle === 2) return [edge(x, z, x + 1, z - 1)];  // SE
        return [edge(x, z, x - 1, z - 1)];                    // SW
    }
    return [];
}

/**
 * The tiles a GROUND-layer loc occupies. GameMap.ts:349-360 swaps width/length when the loc faces
 * NORTH or SOUTH, exactly as reproduced here — get this backwards and a 1x3 gate is checked against the
 * wrong three tiles.
 */
export function footprintOf(x: number, z: number, angle: number, width: number, length: number): Tile[] {
    const w = (angle === 1 || angle === 3) ? length : width;
    const l = (angle === 1 || angle === 3) ? width : length;
    const out: Tile[] = [];
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < l; dz++) out.push({ x: x + dx, z: z + dz });
    return out;
}

const sameEdge = (e: Edge, ax: number, az: number, bx: number, bz: number): boolean =>
    (e.ax === ax && e.az === az && e.bx === bx && e.bz === bz) ||
    (e.ax === bx && e.az === bz && e.bx === ax && e.bz === az);

/** Does this placed loc stand between `from` and `to`? Pure geometry; no table lookup. */
export function locBlocksStep(loc: SceneLoc, from: Tile, to: Tile): boolean {
    const layer = locShapeLayer(loc.shape);
    if (layer === LOC_LAYER_WALL) {
        return blockedEdgesOf(loc.x, loc.z, loc.shape, loc.angle)
            .some(e => sameEdge(e, from.x, from.z, to.x, to.z));
    }
    if (layer === LOC_LAYER_GROUND) {
        // Entering the footprint is blocked; standing in it already (`from`) is not this step's problem.
        return footprintOf(loc.x, loc.z, loc.angle, loc.width, loc.length)
            .some(t => t.x === to.x && t.z === to.z)
            && !(from.x === to.x && from.z === to.z);
    }
    return false;                                            // wall decor / ground decor never block
}

// -----------------------------------------------------------------------------------------------------
// requirement evaluation
// -----------------------------------------------------------------------------------------------------

/** obj.pack coin stack variants — `coins` plus `coins_2` .. `coins_10000`, all one currency to a bot. */
const COIN_IDS = new Set([995, 996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004]);

/**
 * Does this bot MEET the condition the gate demands? `undefined` => unknown, not "no".
 *
 * ⛔ `req.op` IS ALREADY THE BOT'S SIDE OF THE TEST, NOT THE SCRIPT'S. `extract-obstacles.mjs` reads
 * which branch the comparison guards and flips it when it guards a refusal, so
 * `mcannon_doors.rs2:3`'s `if (%mcannon < ^stage) { mes("The door is locked."); }` arrives here as
 * `op: '>='` with `rawOp: '<'`. Reading the raw comparison as the requirement is the polarity bug this
 * function used to have: it told a fresh account that a locked door was open and a finished account
 * that it was shut, on every one of the 53 refusal-shaped `<` gates in the game.
 *
 * A supplied `quests`/`progress` map is authoritative: an absent key is stage 0, because that is what
 * the engine reports for a varp nobody has written. Only an entirely absent map is unknown.
 */
function questSatisfied(req: RawReq, profile: BotProfile): boolean | undefined {
    const map = req.kind === 'progress' ? profile.progress : profile.quests;
    if (!map || !req.varp) return undefined;
    const have = map[req.varp] ?? 0;
    const want = req.stageValue;
    if (want === null || want === undefined) return undefined;   // `switch_int` form: stage unknowable
    switch (req.op) {
        case '>=': return have >= want;
        case '>': return have > want;
        case '<=': return have <= want;
        case '<': return have < want;
        case '=': return have === want;
        case '!': return have !== want;
        default: return undefined;
    }
}

/**
 * A gate this table read but could not point in a direction. Both halves force UNKNOWN, never PASSABLE.
 * Kept as one predicate so the quest, progress and key-door branches cannot drift apart.
 */
function unreadableGate(req: RawReq): boolean {
    return req.polarity === 'unknown' || req.strength === 'unknown';
}

interface Eval { cls: ObstacleClass; needs: Need[]; reason: string; waived?: string }

/**
 * Turn one traversal op's generated requirements into a verdict FOR THIS BOT.
 *
 * Order is deliberate and mirrors what actually stops a bot first: a hard `IMPASSABLE` beats everything;
 * then members, quest, level, item, payment. Anything the profile cannot answer becomes `UNKNOWN` rather
 * than an assumption in either direction.
 */
/**
 * Which arm of a coord-scoped handler actually runs AT THIS PLACEMENT.
 *
 * ⛔ WHY THIS EXISTS, in one example. `[oploc1,loc_1747]` — the generic "Ladder / Climb-up", 147
 * placements including an Ardougne ladder — is
 * `switch_coord (loc_coord) { case 0_40_53_10_49 : @ladder_to_dwarf_remains;  case default : ~climb_ladder(...); }`.
 * Reading requirements from the whole handler attributed the Dwarf Cannon quest gate to the TYPE, so the
 * oracle said every one of those ladders was NEEDS_QUEST — a false blocker on some of the most-walked
 * routes in the game. The same construct fails the OTHER way for the generic staircases (loc_1722/1723/1738/...):
 * their default arm is `@unhandled_stairs`, a debug `mes()` that moves nobody, so the enumerated coords
 * are a WHITELIST and every other placement is a silent dead click that a whole-handler read called
 * PASSABLE.
 *
 * A false PASSABLE is the dangerous direction and a false blocker buries the real one, so both halves
 * matter and both are fixed by asking WHERE the loc is.
 */
function coordArm(op: RawOp, at: { x: number; z: number; level: number } | null):
    { cls: string; why?: string; reqs: RawReq[]; note?: string; matched: RawCoordCase | null } | null {
    if (!op.coordScoped) return null;
    if (at) {
        for (const c of op.coordCases ?? []) {
            if (c.level === at.level && c.x === at.x && c.z === at.z) return { ...c, matched: c };
        }
    }
    // No placement given, or the placement is not on the whitelist -> the default arm runs.
    // ⛔ WITH NO PLACEMENT WE MUST NOT ASSUME THE DEFAULT. A caller that cannot say where the loc is
    // gets UNKNOWN, because "which arm runs" is precisely the thing it failed to tell us.
    if (!at) {
        return {
            cls: 'unknown', why: 'coord-scoped-unlocated', reqs: [], matched: null,
            note: `handler is coord-scoped (${(op.coordCases ?? []).length} enumerated coords) and no placement was supplied`,
        };
    }
    return { ...(op.coordDefault ?? { cls: 'unknown', why: 'unhandled-coord', reqs: [] }), matched: null };
}

function evaluateOp(op: RawOp, profile: BotProfile, at: { x: number; z: number; level: number } | null = null): Eval {
    // A coord-scoped handler is evaluated against the arm that runs AT THIS PLACEMENT, not the union.
    const arm = coordArm(op, at);
    const cls0 = arm ? arm.cls : op.cls;
    const reqs0 = arm ? arm.reqs : op.reqs;
    const why0 = arm ? arm.why : op.why;

    if (cls0 === 'impassable') {
        return { cls: 'IMPASSABLE', needs: [], reason: `no way through: ${arm?.note || op.note || 'handler only prints a locked message'}` };
    }
    // ⛔ TWO OF THE UNKNOWN REASONS ARE EXPLAINABLE, so do NOT short-circuit on them. A handler whose
    // class is UNKNOWN because it holds a lever puzzle or a gate whose direction could not be read still
    // has REQUIREMENTS worth reporting, and the loop below turns each into a named probe ("read bit
    // state of %ernestlever") instead of the generic "READ IT". The verdict is UNKNOWN either way —
    // every such req sets `sawUnknown` — but the caller gets something it can act on.
    const explainable = why0 === 'puzzle-state' || why0 === 'unreadable-gate';
    if (cls0 === 'unknown' && !explainable) {
        const why =
            why0 === 'no-handler'
                ? `loc offers "${op.opText}" but NO [oploc${op.op}] handler binds it — clicking it does nothing`
                : why0 === 'unhandled-coord'
                    ? `loc offers "${op.opText}" and the handler at ${op.source} IS a switch_coord whitelist, but `
                    + `THIS placement (${at?.x},${at?.z},L${at?.level}) is not one of its ${(op.coordCases ?? []).length} `
                    + `enumerated coords — it falls to @unhandled_stairs/@unhandled_ladder, which only prints a debug `
                    + `line. The click does NOTHING, silently and forever.`
                    : why0 === 'coord-scoped-unlocated'
                        ? `handler at ${op.source} is coord-scoped and no placement coordinate was supplied — `
                        + `cannot tell which arm runs. Call classifyLoc with the PLACED loc.`
                        : `handler at ${op.source} matched no known requirement and no pass primitive — READ IT before trusting this route`;
        return { cls: 'UNKNOWN', needs: [{ kind: 'probe', what: why }], reason: why };
    }

    const needs: Need[] = [];
    let cls: ObstacleClass = 'PASSABLE';
    const reasons: string[] = [];
    let waived: string | undefined;
    let sawUnknown = false;

    const worse = (a: ObstacleClass, b: ObstacleClass): ObstacleClass => {
        const rank: Record<ObstacleClass, number> = {
            PASSABLE: 0, NEEDS_MEMBERS: 1, NEEDS_PAYMENT: 2, NEEDS_ITEM: 3,
            NEEDS_LEVEL: 4, NEEDS_QUEST: 5, UNKNOWN: 6, IMPASSABLE: 7,
        };
        return rank[a] >= rank[b] ? a : b;
    };

    // ⛔ A QUEST THAT WAIVES A FEE IS NOT ALSO A GATE. border_gate.rs2:28 tests `%princequest` purely to
    // let a friend of Al-Kharid through free; the fare below it is the real requirement. Counting the
    // same `if` twice made the toll gate report NEEDS_QUEST (rank 5) instead of NEEDS_PAYMENT (rank 2) —
    // i.e. "this bot can never cross" instead of "hand it 10 gp". Waiver vars are consumed by the
    // payment branch and skipped here.
    const waiverVars = new Set(reqs0.filter(r => r.kind === 'payment' && r.waivedBy).map(r => r.waivedBy!.varp));

    for (const req of reqs0) {
        if ((req.kind === 'quest' || req.kind === 'progress') && waiverVars.has(req.varp ?? '')) continue;
        if (req.kind === 'members') {
            if (profile.members === false) {
                cls = worse(cls, 'NEEDS_MEMBERS');
                needs.push({ kind: 'members' });
                reasons.push('members-only');
            }
            continue;
        }

        // A `testbit()` lever/latch combination. Nothing a profile can hold answers it, and the pass
        // branch of such a handler DOES contain a door primitive — which is exactly why all nine
        // Haunted Mine doors used to read PASSABLE. It is UNKNOWN, permanently, until someone probes it.
        if (req.kind === 'puzzle') {
            sawUnknown = true;
            reasons.push(`opens only on a lever/latch pattern (%${req.varp})`);
            needs.push({ kind: 'probe', what: req.probe ?? `read bit state of %${req.varp}` });
            continue;
        }

        if (req.kind === 'quest' || req.kind === 'progress') {
            const label = req.kind === 'progress' ? `progress %${req.varp}` : `quest ${req.quest ?? req.varp}`;
            if (unreadableGate(req)) {
                // The generator found the comparison but could not tell which branch it guards (a mixed
                // `A & (B | C)`, an unresolved else-chain, or a `switch_int` whose stage set is not a
                // threshold). ⛔ NEVER GUESS A DIRECTION HERE: guessing "satisfied" is the toll-gate bug,
                // and guessing "blocked" strands a bot in front of a door that opens.
                sawUnknown = true;
                reasons.push(`${label} gate direction unreadable (script wrote \`${req.rawOp}\`, shape ${req.shape ?? '?'})`);
                needs.push({ kind: 'probe', what: `READ ${req.varp} gate at its source — this table could not tell which branch it guards` });
                continue;
            }
            const ok = questSatisfied(req, profile);
            if (ok === true) continue;
            if (ok === undefined) {
                sawUnknown = true;
                reasons.push(`${label} state unknown (needs %${req.varp} ${req.op} ^${req.stage ?? '?'})`);
                needs.push({ kind: 'probe', what: `read ${req.kind} var %${req.varp}${req.quest ? ` (${req.quest})` : ''}` });
                continue;
            }
            if (req.strength === 'sufficient') {
                // ⛔ FAILING A SUFFICIENT CONDITION PROVES NOTHING. It sat beside an unmodelled
                // condition (usually which side of the door you approach from), so the door may still
                // open. Reporting BLOCKED here would be a false blocker, and a false blocker buries the
                // real one — the whole `blockwalk=no` lesson.
                sawUnknown = true;
                reasons.push(`${label} would guarantee passage (%${req.varp} ${req.op} ^${req.stage}) but is unmet; the rest of the gate is unmodelled`);
                needs.push({ kind: 'probe', what: `${req.varp} ${req.op} ^${req.stage} would open this; unmet, so the outcome depends on a condition this table does not model (${req.shape ?? '?'})` });
                continue;
            }
            cls = worse(cls, 'NEEDS_QUEST');
            needs.push({ kind: 'quest', quest: req.quest ?? req.varp!, varp: req.varp!, stage: req.stage ?? null, stageValue: req.stageValue ?? null });
            reasons.push(`${label} must satisfy %${req.varp} ${req.op} ^${req.stage}`);
            continue;
        }

        if (req.kind === 'level') {
            if (req.level === null || req.level === undefined) {
                sawUnknown = true;
                reasons.push(`${req.skill} level requirement is a loc_param this table could not resolve`);
                needs.push({ kind: 'probe', what: `resolve loc_param ${req.levelParam} for the ${req.skill} gate` });
                continue;
            }
            const have = profile.skills?.[req.skill!];
            if (have === undefined) {
                sawUnknown = true;
                reasons.push(`${req.skill} level unknown (needs ${req.level})`);
                needs.push({ kind: 'probe', what: `read ${req.skill} level (gate wants ${req.level})` });
                continue;
            }
            if (have >= req.level) continue;
            cls = worse(cls, 'NEEDS_LEVEL');
            needs.push({ kind: 'level', skill: req.skill!, level: req.level });
            reasons.push(`${req.skill} ${have} < ${req.level}`);
            continue;
        }

        if (req.kind === 'item') {
            if (unreadableGate(req)) {
                sawUnknown = true;
                reasons.push(`key/item gate direction unreadable for ${req.objName} (${req.shape ?? '?'})`);
                needs.push({ kind: 'probe', what: `READ the ${req.objName} test at its source — which branch it guards is unclear` });
                continue;
            }
            const ids = req.objIds ?? (req.objId !== undefined ? [req.objId] : []);
            const pool = req.worn ? profile.worn : profile.inventory;
            if (pool === undefined) {
                sawUnknown = true;
                reasons.push(`cannot tell whether ${req.worn ? 'worn' : 'carried'} ${req.objName} is present`);
                needs.push({ kind: 'probe', what: `read ${req.worn ? 'equipment' : 'inventory'} for ${req.objName}` });
                continue;
            }
            if (ids.some(id => pool.includes(id))) continue;
            if (req.strength === 'sufficient') {
                sawUnknown = true;
                reasons.push(`${req.objName} would open this but is not carried; the rest of the gate is unmodelled`);
                needs.push({ kind: 'probe', what: `carrying ${req.objName} would open this; without it the outcome depends on a condition this table does not model` });
                continue;
            }
            cls = worse(cls, 'NEEDS_ITEM');
            needs.push({ kind: 'item', objIds: ids, objName: req.objName ?? String(ids[0]), worn: req.worn === true, count: req.count ?? 1 });
            reasons.push(`${req.worn ? 'wear' : 'carry'} ${req.objName}`);
            continue;
        }

        if (req.kind === 'payment') {
            // A quest may waive the fare outright — border_gate.rs2:28 lets a friend of Al-Kharid
            // through for free. Check that BEFORE deciding the bot is short of coins.
            if (req.waivedBy) {
                const ok = questSatisfied({ kind: 'quest', key: req.waivedBy.varp, ...req.waivedBy }, profile);
                if (ok === true) {
                    waived = `fee waived: ${req.waivedBy.quest} quest at ^${req.waivedBy.stage}`;
                    continue;
                }
            }
            const amount = req.amount ?? 0;
            if (profile.coins === undefined) {
                sawUnknown = true;
                reasons.push(`toll of ${amount} gp, coins unknown`);
                needs.push({ kind: 'probe', what: `read coin count (toll wants ${amount})` });
                continue;
            }
            if (profile.coins >= amount) {
                // Affordable — but STILL an obstacle, not a plain door: the bot must know to answer the
                // fare dialog. Reported as NEEDS_PAYMENT with the need satisfied, so a brain can arm its
                // toll handler instead of walking into the modal blind.
                cls = worse(cls, 'NEEDS_PAYMENT');
                needs.push({ kind: 'coins', amount });
                reasons.push(`toll ${amount} gp (affordable: has ${profile.coins})`);
                continue;
            }
            cls = worse(cls, 'NEEDS_PAYMENT');
            needs.push({ kind: 'coins', amount });
            reasons.push(`toll ${amount} gp, has ${profile.coins}`);
            continue;
        }
    }

    if (sawUnknown) cls = worse(cls, 'UNKNOWN');
    return {
        cls,
        needs,
        reason: reasons.length ? reasons.join('; ') : `plain ${op.opText?.toLowerCase() ?? 'open'} (${op.source ?? 'no source'})`,
        waived,
    };
}

/**
 * Classify one placed loc for one bot. Exposed because a brain that has ALREADY stalled at a door wants
 * exactly this answer for that one loc, without re-planning a route.
 */
export function classifyLoc(loc: SceneLoc, profile: BotProfile): Omit<RouteObstacle, 'index' | 'stepIndex' | 'from' | 'to'> {
    const base = {
        at: { x: loc.x, z: loc.z, level: loc.level },
        locId: loc.id,
        locName: loc.name,
        shape: loc.shape,
        angle: loc.angle,
    };
    const rule = BY_LOC_ID.get(loc.id);
    if (!rule) {
        // The loc blocks the step and has no traversal op at all. Either it is a genuine wall the router
        // should never have crossed (a live-collision mask bug — worth shouting about), or it is a
        // decorative type. Either way: not something this bot can open.
        const hasOps = loc.optionsWithIndex.length > 0;
        return {
            ...base,
            internal: '', category: '', op: null, opText: null,
            cls: 'IMPASSABLE',
            reason: hasOps
                ? `loc has options [${loc.options.join(', ')}] but none of them is a way through`
                : 'solid loc with no operable option — the router should not have crossed this; suspect a collision mask',
            source: null,
            needs: [],
        };
    }

    // A loc may offer several ways through (a free "Open" and a paid "Pay-fare"). Take the CHEAPEST
    // outcome for this bot, but keep the op that produced it so a brain knows which one to send.
    const rank: Record<ObstacleClass, number> = {
        PASSABLE: 0, NEEDS_MEMBERS: 1, NEEDS_PAYMENT: 2, NEEDS_ITEM: 3,
        NEEDS_LEVEL: 4, NEEDS_QUEST: 5, UNKNOWN: 6, IMPASSABLE: 7,
    };
    let best: { op: RawOp; ev: Eval } | null = null;
    for (const op of rule.ops) {
        // The PLACED coords are passed through: a coord-scoped handler cannot be answered without them.
        const ev = evaluateOp(op, profile, { x: loc.x, z: loc.z, level: loc.level });
        if (!best || rank[ev.cls] < rank[best.ev.cls]) best = { op, ev };
    }
    const { op, ev } = best!;
    return {
        ...base,
        internal: rule.internal,
        category: rule.category,
        op: op.op,
        opText: op.opText,
        cls: ev.cls,
        reason: ev.reason,
        source: op.source,
        needs: ev.needs,
        ...(ev.waived ? { waived: ev.waived } : {}),
    };
}

// -----------------------------------------------------------------------------------------------------
// route classification
// -----------------------------------------------------------------------------------------------------

export interface ClassifyOptions {
    /**
     * Report PASSABLE obstacles too (every ordinary door on the way). Default TRUE — a route's door
     * count is how a supervisor sees "this trip has 40 doors in it", and hiding them is how a door
     * table drifts. Set false for a terse verdict.
     */
    includePassable?: boolean;
    /** Stop at the first non-PASSABLE obstacle. Default false: the whole list is the useful artifact. */
    stopAtFirstBlocker?: boolean;
    /** Level the route runs on when the tiles do not carry one. Default 0. */
    level?: number;
}

const key = (x: number, z: number, level: number, id: number): string => `${level}:${x}:${z}:${id}`;

/**
 * THE CORE. Classify an ALREADY-PLANNED route (per-tile waypoints, chebyshev-1 apart — exactly what
 * `navgrid.planRoute().waypoints` returns; see learnings/navgrid-and-pathing.md "Never toVias").
 *
 * Synchronous and pure. Requires `locScene.init()` (or `await locScene.initAsync()`) to have run.
 */
export function classifyRouteTiles(
    tiles: readonly Tile[],
    profile: BotProfile,
    opts: ClassifyOptions = {},
): RouteVerdict {
    const t0 = performance.now();
    const level = opts.level ?? 0;
    const includePassable = opts.includePassable !== false;
    const from: Pos = tiles.length ? { ...tiles[0]!, level } : { x: 0, z: 0, level };
    const to: Pos = tiles.length ? { ...tiles[tiles.length - 1]!, level } : { x: 0, z: 0, level };

    if (tiles.length < 2) {
        return {
            ok: tiles.length === 1, verdict: tiles.length === 1 ? 'PASSABLE' : 'NO_ROUTE',
            from, to, routeTiles: tiles.length, obstacles: [], firstBlocking: null, needs: [],
            unknownCount: 0, ms: performance.now() - t0,
            note: tiles.length === 1
                ? 'route is a single tile — nothing to cross'
                : 'NO ROUTE: the planner returned no waypoints, so there is nothing to classify. That is a PLANNING failure, not a feasibility one — check camp-reach-plan.ts / the sealed-pocket trap.',
        };
    }

    const obstacles: RouteObstacle[] = [];
    const seen = new Set<string>();
    let firstBlocking: RouteObstacle | null = null;
    let unknownCount = 0;

    outer:
    for (let i = 0; i + 1 < tiles.length; i++) {
        const a = tiles[i]!;
        const b = tiles[i + 1]!;
        if (a.x === b.x && a.z === b.z) continue;

        // Candidates: locs standing on either end of the step. A wall on B's west edge blocks a step
        // from A=B-1 just as much as one on A's east edge does, so both tiles must be asked.
        // `includeUnnamed` is ON: an unnamed wall loc still blocks, and skipping it is exactly the kind
        // of silent omission this module exists to prevent.
        const candidates = [
            ...locScene.getLocsAt(a.x, a.z, level, { includeUnnamed: true }),
            ...locScene.getLocsAt(b.x, b.z, level, { includeUnnamed: true }),
        ];

        for (const loc of candidates) {
            if (!paintsCollision(loc.id)) continue;          // blockwalk=no — the router never saw it
            if (!locBlocksStep(loc, a, b)) continue;
            const k = key(loc.x, loc.z, loc.level, loc.id);
            if (seen.has(k)) continue;
            seen.add(k);

            const classified = classifyLoc(loc, profile);
            if (classified.cls === 'PASSABLE' && !includePassable) continue;

            const obstacle: RouteObstacle = {
                index: obstacles.length,
                stepIndex: i,
                from: { x: a.x, z: a.z },
                to: { x: b.x, z: b.z },
                ...classified,
            };
            obstacles.push(obstacle);
            if (obstacle.cls === 'UNKNOWN') unknownCount++;
            if (obstacle.cls !== 'PASSABLE' && !firstBlocking) {
                firstBlocking = obstacle;
                if (opts.stopAtFirstBlocker) break outer;
            }
        }
    }

    // Dedupe the shopping list. Coins take the MAX single fare, not the sum: a bot pays each toll
    // separately and they are not simultaneous... but it must be able to afford the whole trip, so the
    // sum is what it needs to carry. Both are reported: `amount` is the sum, and a caller that
    // wants the per-gate figure has it on the obstacle.
    const needs: Need[] = [];
    let coinTotal = 0;
    const needSeen = new Set<string>();
    for (const o of obstacles) {
        for (const n of o.needs) {
            if (n.kind === 'coins') { coinTotal += n.amount; continue; }
            const nk = JSON.stringify(n);
            if (needSeen.has(nk)) continue;
            needSeen.add(nk);
            needs.push(n);
        }
    }
    if (coinTotal > 0) needs.unshift({ kind: 'coins', amount: coinTotal });

    const blocking = obstacles.filter(o => o.cls !== 'PASSABLE' && o.cls !== 'UNKNOWN');
    const hard = obstacles.filter(o => o.cls === 'IMPASSABLE');
    let verdict: OverallVerdict;
    if (hard.length || blocking.length) verdict = 'BLOCKED';
    else if (unknownCount) verdict = 'UNKNOWN';
    else verdict = 'PASSABLE';

    const ms = performance.now() - t0;
    return {
        ok: verdict === 'PASSABLE',
        verdict, from, to,
        routeTiles: tiles.length,
        obstacles, firstBlocking, needs, unknownCount, ms,
        note: describe(verdict, tiles.length, obstacles, firstBlocking, unknownCount, needs),
    };
}

function describe(
    verdict: OverallVerdict, routeTiles: number, obstacles: RouteObstacle[],
    firstBlocking: RouteObstacle | null, unknownCount: number, needs: Need[],
): string {
    const doors = obstacles.filter(o => o.cls === 'PASSABLE').length;
    const head = `${verdict} route=${routeTiles}t obstacles=${obstacles.length} (passable=${doors} unknown=${unknownCount})`;
    if (verdict === 'PASSABLE') return `${head} — every obstacle on this route is one this bot can open`;
    if (!firstBlocking) return `${head} — no single blocker identified`;
    const shopping = needs.map(n =>
        n.kind === 'coins' ? `${n.amount}gp`
            : n.kind === 'item' ? `${n.worn ? 'worn ' : ''}${n.objName}`
                : n.kind === 'level' ? `${n.skill} ${n.level}`
                    : n.kind === 'quest' ? `quest:${n.quest}`
                        : n.kind === 'members' ? 'members'
                            : `probe:${n.what.slice(0, 40)}`).join(', ');
    return `${head} — FIRST BLOCKER ${firstBlocking.cls} at (${firstBlocking.at.x},${firstBlocking.at.z}) `
        + `loc ${firstBlocking.locId} "${firstBlocking.locName || firstBlocking.internal}" step ${firstBlocking.stepIndex}/${routeTiles}: `
        + `${firstBlocking.reason} [${firstBlocking.source ?? 'no handler'}] NEEDS: ${shopping || 'nothing acquirable'}`;
}

// -----------------------------------------------------------------------------------------------------
// planner-backed entry point
// -----------------------------------------------------------------------------------------------------

/** A route planner: returns per-tile waypoints, or [] when the destination is unreachable. */
export type RoutePlanner = (from: Pos, to: Pos) => Tile[];

let defaultPlanner: RoutePlanner | null = null;

/**
 * Install the planner `classifyRoute` uses. A CALLER MUST DO THIS (or pass `opts.planner`) — this module
 * deliberately does not reach for navgrid itself.
 *
 * ⛔ WHY NOT AUTO-WIRE navgrid. `sdk/navgrid` needs the exact init prelude documented at the top of
 * `camp-reach-plan.ts` (`initPathfinding()` FIRST, then `applyBlockedEdges(blockDoor)`, then
 * `navgrid.init()`), and getting that order wrong makes EVERY planRoute return null — you then
 * "discover" that most of the world is unreachable. Owning that prelude here would mean a second copy of
 * it drifting away from the first, which is the precise mechanism behind the toll-gate bug
 * (two modules each kept their own copy of a door table). So: the caller injects the planner it
 * already has, and there is exactly one init sequence in the repo.
 *
 * `camp-reach-plan.ts initNav()` returns a ready-made hybrid context; adapt it in three lines.
 */
export function setDefaultPlanner(planner: RoutePlanner | null): void {
    defaultPlanner = planner;
}

export interface RouteClassifyOptions extends ClassifyOptions {
    planner?: RoutePlanner;
}

/**
 * Plan `from -> to` and classify it. Convenience over `classifyRouteTiles` for callers that have not
 * planned yet; a brain that ALREADY has waypoints should call `classifyRouteTiles` and skip re-planning
 * (planRoute is a synchronous A* charged to every bot in the process — see the navgrid learnings).
 */
export function classifyRoute(from: Pos, to: Pos, profile: BotProfile, opts: RouteClassifyOptions = {}): RouteVerdict {
    const planner = opts.planner ?? defaultPlanner;
    if (!planner) {
        throw new Error(
            'route-feasibility: no planner. Call setDefaultPlanner(fn) once at startup, or pass ' +
            'opts.planner. This module never builds its own navgrid — see setDefaultPlanner\'s note on ' +
            'why a second copy of the init prelude is the bug we are trying not to repeat.'
        );
    }
    const tiles = planner(from, to);
    return classifyRouteTiles(tiles, profile, { ...opts, level: opts.level ?? from.level ?? 0 });
}

// -----------------------------------------------------------------------------------------------------
// readiness
// -----------------------------------------------------------------------------------------------------

/** Build the loc index this oracle queries. Idempotent; safe for every bot to call defensively. */
export function init(): void {
    locScene.init();
}

/** Same, yielding to the event loop between map squares — use when a packet loop is already running. */
export function initAsync(): Promise<void> {
    return locScene.initAsync();
}

export function isReady(): boolean {
    return locScene.isReady();
}

// =====================================================================================================
// WIRING SPEC — for the integration pass (NOTHING BELOW IS WIRED YET)
// =====================================================================================================
//
// WHERE TO CALL IT
//   ONCE, at the moment a brain COMMITS to a long travel — i.e. immediately after it plans a route and
//   BEFORE it sends the first MOVE. Concretely that is where a brain currently does
//   `const path = navFindPath(...)` for a cross-map destination (a memoised long-haul
//   planner, LeanBot.doTravel's route acquisition, any camp/bank re-target). Pass the waypoints straight
//   into `classifyRouteTiles(path, profile)` — do NOT re-plan.
//
//   NEVER per tick and never inside the packet loop's hot path. It is ~1-3 ms for a 1000-tile route,
//   which is fine ONCE per trip and far too slow per tick across many bots. Memoise it like the route
//   cache: key on `${sx},${sz},${dx},${dz}` PLUS a coarse profile fingerprint (coins bucket, quest
//   stage, agility level) — the profile is what makes two identical routes differ.
//
// BUILDING THE PROFILE FROM A LIVE BOT
//   coins      sum of inventory slots whose id is in COIN_IDS
//   inventory  inventory obj ids
//   worn       equipment obj ids
//   skills     { agility: lvl, ... } — engine spelling, lowercase
//   quests     quest VARP name -> stage value. If the client cannot read a varp, OMIT THE KEY. Omitting
//              yields UNKNOWN (a probe), which is correct; guessing 0 would block the bot on
//              every quest-gated door and guessing "complete" would re-create the toll-gate bug.
//   progress   NON-quest progress varps, same contract. Today that is only `tutorial`. A bot that
//              ran skipTutorial() knows its own value; omit the field rather than guess one.
//   members    default true
//
// ⛔ AN OBSTACLE WITH `op: 0` IS A KEY DOOR, NOT AN OPLOC. Its ordinary "Open" only reports the door
//   locked; the way through is USE-ITEM-ON-LOC with the obj named in `needs` (melzar's maze colour
//   doors, capt_siad_cell_door, the Taverley jail doors). Sending OPLOC0 would do nothing.
//
// WHAT TO DO PER VERDICT CLASS
//   PASSABLE        travel. Also arm the door opener for each PASSABLE obstacle — they are real doors.
//   NEEDS_PAYMENT   the bot can pay: ARM THE TOLL HANDLER for that specific gate before departing
//                   (headless/toll-gate.ts already owns the Al Kharid geography and the "answer option 3,
//                   not option 1" rule). If it cannot pay, treat as BLOCKED and re-target.
//   NEEDS_ITEM      fetch the objIds (e.g. from a bank) first, or pick a different destination.
//                   Never depart hoping the door is optional.
//   NEEDS_LEVEL     this bot will never pass today: pick another route/destination. Do not retry.
//   NEEDS_QUEST     same — unless a quest-runner is in scope, this is a permanent re-target.
//   NEEDS_MEMBERS   re-target.
//   IMPASSABLE      re-target, AND report loudly: an IMPASSABLE with `source === null` on a route means
//                   the ROUTER crossed a solid wall, i.e. a collision-mask defect (the
//                   over-mask class). That is a bug report, not a bot problem.
//   UNKNOWN         ⛔ DO NOT DEPART SILENTLY. Either (a) send the bot but mark the trip `unverified` and
//                   trip the supervisor if it makes no progress within N ticks, or (b) re-target. Never
//                   treat UNKNOWN as PASSABLE. Every UNKNOWN carries a `needs: [{kind:'probe'}]` naming
//                   exactly what a human must read.
//
// HOW IT MUST SURFACE TO A SUPERVISOR (this project's rule: absence must never look like zero)
//   The failure being prevented is a healthy-looking connection count hiding bots that moved zero
//   tiles, so the verdict must be visible WITHOUT anyone going looking:
//     1. Log `verdict.note` at the moment of departure for every non-PASSABLE verdict. It is one
//        greppable line and it already names the loc, the tile, the content file:line and the shopping
//        list.
//     2. Add to your status reporter:
//            `infeas=<n>`   bots currently holding a non-PASSABLE verdict
//            `unk=<n>`      bots holding an UNKNOWN verdict
//            `blockers=<top obstacle summary>`  e.g. `2882@3268,3227 NEEDS_PAYMENT x25`
//        A constant non-zero `infeas=` with zero progress is the exact signature of the outage, and it
//        is now a number on the dashboard instead of a silent 2,587-line dialog loop.
//     3. A bot that departs on an UNKNOWN and then fails to advance its waypoint cursor for N ticks must
//        re-run the oracle from its CURRENT tile and log the delta. The obstacle it is standing at is in
//        the result, by construction.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
//   - It does not plan. Injection only (see setDefaultPlanner).
//   - It does not model MULTI-LEVEL legs. `sdk/navgrid/levels.ts planMultiLevel` returns Leg[]; classify
//     each leg's waypoints separately with that leg's level. The PORTAL (ladder/stairs) between legs is
//     not classified here.
//   - It does not model NPC blockers, aggression, or death risk — those are camp-reach-plan's danger
//     zones, not obstacles.
//   - It does not open anything. It is an oracle; the brain acts.
// =====================================================================================================

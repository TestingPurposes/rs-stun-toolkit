//
// LeanBot: the headless game client. LeanClient (the base class) logs in and decodes PLAYER_INFO
// for the local player's position; LeanBot adds the decoders and actions a script needs to play
// without a browser:
//   1. accept the character design  -> get into the world
//   2. skip the tutorial            -> teleport to Lumbridge (~3222,3222)
//   3. a per-tick brain (dialogs, modals, travel, combat, eating) plus awaitable actions
//      (walk, talk, attack, pick up, bank, skilling) that scripts drive one tick at a time.
//
// Must live inside server/webclient/ so the "#/" import alias resolves.
//
// ⚠ REV 289: the opcode NUMBERS in parentheses below are rev-274 history. Every send/decode now goes
// through the ClientProt/ServerProt enums (src/io/*Prot.ts), never a raw number. See PORT-289.md.
//
// -- What was ported and from where -----------------------------------------
// INCOMING (added to the run() dispatch; pure decoders copy-ported from
//   src/client/Client.ts, config-table lookups replaced by raw ids so no cache
//   needs loading):
//   - NPC_INFO(197)          -> getNpcPos family (bit-packed, mirrors the
//                               inherited getPlayerPos). Tracks each npc's local
//                               index, scene x/z and 11-bit type id.
//   - UPDATE_INV_FULL(106) / UPDATE_INV_PARTIAL(172) -> inventory per interface
//                               (the backpack is inventory:inv 3214).
//   - UPDATE_STAT(105)       -> per-skill level/xp.
//   - IF_OPENMAIN(211)/IF_OPENMAIN_SIDE(158)/IF_OPENCHAT(166)/IF_CLOSE(171)/
//     IF_SETTEXT(44)         -> modal + dialog tracking.
// OUTGOING (encoders ported from Client.ts; byte layout verified against the
//   server's own decoders in engine/src/network/game/client/):
//   - IF_BUTTON(9)           -> accept char design (player_kit:accept = 3651)
//                               and pick dialog options (multi2:com_1 = 2461).
//   - RESUME_PAUSEBUTTON(72) -> "click here to continue" dialogs.
//   - MOVE_OPCLICK(138) / MOVE_GAMECLICK(207) -> route to a tile. The client runs
//     clientRoutefinder=true, so the server walks our waypoints itself (naive,
//     collision-checked) -> no client collision map needed in open terrain, and
//     an interaction MUST be preceded by a MOVE route or the server replies
//     "I can't reach that!" (see server/PATCHES.md).
//   - OPNPC1..OPNPC5         -> npc ops. op1 = Talk-to, op2 = Attack; op3 is whatever the
//     content script defines (Pickpocket on most humans, Trade on shopkeepers).

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import Packet from '#/io/Packet.js';
import JString from '#/datastruct/JString.js';
import { ServerProt, ServerProtSizes } from '#/io/ServerProt.js';
import { ClientProt } from '#/io/ClientProt.js';
import {
    gearFor, loadoutDelta, isWearable, controlledComMode, ammoCategoryFor,
    WEAPON_SLOT, QUIVER_SLOT, type GearItem, type UpgradeCtx,
} from './gear-table.js';
// ⛔ REUSED, NOT RESTATED (§63: a private copy has shadowed a shared fix in this codebase before).
// `canBowFire` is the engine's per-swing ammo rule; `weaponUsable` below is its only new caller.
import { canBowFire } from './ranged-kit.js';
import {
    MAX_VARP_ID, VARP, PRAYER, PRAYERS, STYLE_INTERFACE, STYLE_BUTTON_LOOKUP, DIALOG_ROOTS, DIALOG_ROOT_BY_ID,
    SHOP, SHOP_BUY_BUTTON, SHOP_SELL_BUTTON, SHOP_STEPS, WORN_INV, UNEQUIP_BUTTON, NO_RUNES_MESSAGE,
    type PrayerEntry, type StyleInterfaceEntry,
} from './capability-tables.js';
import { LeanClient, LeanPlayer, simLoginGate } from './leanclient.js';
// ENTITY-BY-NAME DISCOVERY. Imported at MODULE scope on purpose: ESM module state IS the
// process-global singleton, so every bot in the process shares the one ~18.5MB index. NEVER store the
// index (or anything derived from it that retains it) on `this` — that would multiply it by the bot
// count — and NEVER call locScene.init() from here: it is ~420ms of synchronous file IO and belongs at
// process start beside navgrid.init(), never inside the packet loop.
import * as locScene from './loc-scene.js';
import {
    ChatLog, appearanceName, chunkMessage, writeMessagePublic, decodeMessagePublic, decodeMessagePrivate,
    MAX_MESSAGE_LENGTH, type ChatMaskUpdate, type ChatMessage, type ChatQuery, type ChatWait,
} from './chat-codec.js';
import { DOORS } from './door-table.js';
// QUEST STATE. The table + every judgement lives in quest-state.ts; leanbot only owns the wire decode
// (IF_SETCOLOUR) and hands the raw observations back. Type-only where possible so the 63-row table is
// not retained by a bot that never asks.
import { questState, isComplete, questProfile, QUESTS, type QuestObservation, type QuestProfileResult } from './quest-state.js';
// CARRIED RISK + the generic PROGRESS WATCHDOG. Both are small, pure and packet-loop safe by
// construction (measured: 38ns/observe, ~2us/valuation); neither reaches back into leanbot.
import { carriedRisk, pveExposure, type CarriedRisk } from './carried-risk.js';
import { ProgressWatchdog } from './progress-watchdog.js';
// ROUTE FEASIBILITY at the travel commit point. route-gate owns the memo, the profile snapshot and the
// never-throws contract; this file owns only the call site (doTravel's lazy path compute).
import { gateRoute, profileFromBot, type GateResult } from './route-gate.js';
// NPC TARGETS BY NAME. Replaces the hardcoded numeric type-sets; see npc-target.ts for the three ways
// a name query goes wrong and why resolution is paired with a placement check.
import { resolveTargetOr } from './npc-target.js';
// INTERACTION ACKNOWLEDGMENT (parity package 3). The detector for "the client believed it acted, the
// server ignored it". See interaction-ack.ts for the design; everything here is arming call sites + the observable counters.
import {
    AckLedger, AckKind, Rev, REV_COUNT, isRefusal, ACK_ENABLED, ackSpec, ACK_KIND_NAME,
    type AckHost, type AckFailure, type AckVerdict,
} from './interaction-ack.js';
// SKILLING TABLES (parity package 2b). GENERATED from the engine's own packed id tables and content
// scripts (headless/data/extract-skilling.mjs) — nothing below is a typed-in id. Imported at module
// scope: they are frozen literals, so every bot in the process shares one copy.
import {
    AXES, CHOP_OP, TREE_BY_LOC, TINDERBOX, ASHES, LOG_BY_OBJ, LOGS as LOG_TABLE,
    KNIFE, ARROW_SHAFT, FLETCH_LOG_BY_OBJ, FLETCH_LOGS, SKILL_MULTI_BY_NAME,
    NEEDLE, THREAD, LEATHER, HARD_LEATHER_OBJ, HARD_LEATHER, LEATHER_CRAFTING, LEATHER_PRODUCTS,
    GOLD_BAR, PERFECT_GOLD_BAR, JEWELRY, JEWELRY_MOULDS, JEWELRY_ROWS,
    BALL_OF_WOOL, STRINGABLE, STRINGABLE_BY_OBJ, ENCHANT_BY_TARGET, ENCHANT_SPELLS,
    MESSAGES as SKILL_MES,
    type TreeEntry, type LeatherProduct, type JewelryRow, type JewelrySlot, type FletchProduct,
} from './skilling-tables.js';
import {
    TOLL_GATE, TOLL_COST, TOLL_RADIUS, atTollGate, cheb as tollCheb, crossesToll,
    tollGuardFrom, tollSideOf, tollStandFrom, routeCrossesTollFrom, stepCrossesTollGate, type Tile as TollTile,
} from './toll-gate.js';
import { guardRaw, pathHitsDanger } from './route-danger.js';   // ⛔ raw legs must never walk into a White Wolf Mountain aggro circle
import { findLongPath as rawFindLongPath, knownDoorCoords, reachedLoc, withMaskedTiles, findPathToLoc, getDoorAt, isTileWalkable, type DoorInfo } from '../../../sdk/pathfinding';
import { locForceApproach } from '../../../sdk/navgrid/locmeta';
import { DoorTracker, isDoorLoc, doorDef } from '../../../sdk/navgrid/door-tracker.js';
import { addLiveLeaf, delLiveLeaf, clearLiveLeavesInZone, firstRefusedStep } from '../../../sdk/navgrid/live-leaves.js';
import { scaledMs } from '../../../bots/tick.js';

// Multi-level travel plan shapes (mirror sdk/navgrid/levels.ts; kept local so base LeanBot never
// imports the portal graph — the planner is injected as multiLevelPlanFn).
export interface MlCoord { level: number; x: number; z: number }
export interface MlPortal {
    x: number; z: number; level: number; dest: MlCoord; locId?: number; op?: number; label?: string;
    altLocId?: number;   // two-stage locs (trapdoor/manhole): OPLOC closed id opens it (loc_change), then OPLOC this OPEN id climbs
    shape?: number; angle?: number; dims?: { w: number; l: number };   // placement geometry (reachedLoc gating)
    stand?: { x: number; z: number };   // NAV PHASE 1: operate ONLY from this tile (generic ladders, transports)
    action?: MlPortalAction; id?: string;   // NAV PHASE 1: not a plain OPLOC (use-item, pay/talk to an npc)
}
// TELEPORT step (sdk/navgrid/teleports.ts + levels.ts TeleportLeg): cast spellCom (IF_BUTTON) or rub one of
// `items` (OPHELD4) + click `choice`, then land within `scatter` of dest.
export interface MlTeleport {
    id: string; label?: string; kind: 'spell' | 'item'; dest: MlCoord; scatter: number;
    spellCom?: number; items?: number[]; choice?: string;
    itemOp?: number;   // TRAVEL NETWORK: OPHELD op (default 4 "Rub"; the enchanted lyre plays with op 1)
}
export interface MlLeg { waypoints: Array<{ x: number; z: number }>; portal?: MlPortal; teleport?: MlTeleport }
// NAV PHASE 1. Only opt-in graph edges carry these.
// NAV PHASE 2 adds: npc `choose` (dialog option texts to click while this transport runs, before the option-1 default:
// the Entrana monk's option 1 is "No"), npc `doneItem` (the npc phase is over once this obj is in the pack: the Shantay
// pass), and kind 'walkafter' (OPLOC until a doneMsgs line, then WALK to dest: a slashed web stays where it is; with no
// slash weapon worn, OPLOCU `knife` instead).
export type MlPortalAction = { kind: 'useitem'; obj: number }
    | { kind: 'npc'; npc: number; npcOp: number; then: 'land' | 'oploc'; doneMsgs?: string[]; choose?: string[]; doneItem?: number; ifModal?: number; ifButton?: number }
    | { kind: 'walkafter'; doneMsgs: string[]; knife?: number }
    // NAV PHASE 3: several OPLOCs in a row, each from the tile the previous one left us on (stepping stones, jungle chops)
    | { kind: 'chain'; steps: Array<{ from: { x: number; z: number }; x: number; z: number; locId: number; op?: number }>; choose?: string[] }
    // TRAVEL NETWORK: a plain OPLOC whose script asks a p_choice (spirit trees, the Ardougne lever, the Zanaris
    // ladder); npc ifModal/ifButton = click IF_BUTTON ifButton once the npc's dialog opens main modal ifModal (glider map).
    | { kind: 'oploc'; choose: string[] };
/** NAV PHASE 2: quests = quest-state.ts QUESTS keys whose journal reads COMPLETE (filled from isQuestComplete unless set in
 *  mlTransportOpts); worn = equipped obj ids (gas mask, the Entrana search); canSlash = override of the slash test. */
/*  STARTED-GATED EDGES: questsStarted = keys whose journal is yellow OR green (questState IN_PROGRESS|COMPLETE), for
 *  the started-gated v3 edges (Mort Myre gate, Waterfall raft, troll rocks); filled from questState unless set in mlTransportOpts. */
export interface MlTransportCaps { items?: number[]; coins?: number; stats?: Record<string, number>; hasAxe?: boolean; deny?: string[]; quests?: string[]; worn?: number[]; canSlash?: boolean; questsStarted?: string[]; wilderness?: boolean; members?: boolean }
const ML_AXES = [1351, 1349, 1353, 1361, 1355, 1357, 1359];   // bronze..rune (obj.pack)
// What the planner needs to know to offer teleports (teleports.ts TeleportCaps, structurally).
export interface MlTeleportCaps {
    magicLevel: number; inv: Record<number, number>; worn: number[];
    quests?: Partial<Record<'plague_city' | 'watchtower' | 'eadgars_ruse', boolean>>;
    members?: boolean; deny?: string[]; only?: string[]; fromUnderground?: boolean; costTiles?: number; minSaveTiles?: number;
}
// Refusal lines of the teleport scripts (mirror of teleports.ts TELEPORT_REFUSALS; LeanBot never imports the graph).
export const SIM_LOCKSTEP = process.env.SIM_LOCKSTEP === '1';
/** offline sim, replayable runs: wall-clock polls on the tick path become per-tick polls (sim only; see speedrun/core.ts create) */
export const SIM_DET = SIM_LOCKSTEP && process.env.SIM_DET === '1';
/** offline sim speed-ups that are proven tick-identical (plan/SIM-SPEED.md); sim only, opt-in */
export const SIM_FAST = SIM_LOCKSTEP && process.env.SIM_FAST === '1';
/** SIM_FAST self-check: compute the fast and the original answer and report any mismatch */
export const SIM_FAST_CHECK = SIM_LOCKSTEP && process.env.SIM_FAST_CHECK === '1';
// SIM_FAST: settle 0. The engine sends a tick's processClientsOut output as ONE websocket frame (WSClientSocket batching) and
// earlier mid-tick packets before it, so once the waiter wakes (a microtask) any timer runs after the whole frame is decoded:
// the 2 ms only added wall time (traces identical, SIM-SPEED.md)
export const SIM_SETTLE_MS = Number(process.env.SR_SETTLE_MS ?? (SIM_LOCKSTEP ? (SIM_FAST ? 0 : 2) : 25));
/** SIM_FAST_IMM=1 (A/B): setImmediate instead of the ~1 ms timers for the settle and the ack (and its first ~2 ms of retries) */
export const SIM_FAST_IMM = SIM_FAST && process.env.SIM_FAST_IMM === '1';
/** offline sim: the longest a bot holds its tick ack for a woken controller to park again (engine deadline: SIM_ACK_MS 200) */
export const SIM_ACK_WAIT_MS = Number(process.env.SIM_ACK_WAIT_MS ?? 60);
/** offline sim perf (diagnostic only, SIM_PROF=1 on the bot process): per-tick PLAYER_INFO -> ack latency, printed at exit */
const SIM_PROF = SIM_LOCKSTEP && !!process.env.SIM_PROF;
const simProfLat: number[] = [];
let simProfCap = 0, simProfCapMs = 0, simProfRetry = 0;
function simProfAck(ms: number, cap: boolean): void {
    simProfLat.push(ms);
    if (cap) { simProfCap++; simProfCapMs += ms; }
}
// ---- SIM_FAST ack barrier for several bots in ONE process (offline sim only) --------------------------------------------
// With the 2 ms settle gone, a controller woken by bot A's tick that writes for bot B could miss B's ack (B's 1 ms ack timer
// fired first): SoA replay broke 1/2 (tick 57, one bot's op a tick late). So no bot here acks until every in-game bot's
// woken waiters have parked again (they all ack the same engine tick anyway). A "tick barrier" (waiters wait for every
// bot's PLAYER_INFO) was tried too: not needed, and it reordered redundant level-up RESUMEs in the route runner.
// SIM_FAST_BARRIER=0 turns the barrier off (A/B only).
const simBots = new Set<LeanBot>();
const SIM_BARRIER = (SIM_FAST || SIM_DET) && process.env.SIM_FAST_BARRIER !== '0';
function simLive(b: LeanBot): boolean { return !b.disposed && b.alive && b.tickCount > 0; }
function simAllParked(): boolean {
    for (const b of simBots) if (simLive(b) && b.simNew < b.simDue) return false;
    return true;
}

if (SIM_PROF) process.on('exit', () => {
    const a = simProfLat.slice().sort((x, y) => x - y), n = a.length, q = (p: number) => n ? a[Math.min(n - 1, Math.floor(p * n))]!.toFixed(1) : '-';
    const sum = a.reduce((s, x) => s + x, 0);
    console.log(`[simprof-bot] ${n} acks: recv->ack avg ${(sum / Math.max(1, n)).toFixed(2)} ms (p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(1)}), total ${(sum / 1000).toFixed(2)} s; cap hits ${simProfCap} (${(simProfCapMs / 1000).toFixed(2)} s); retries ${simProfRetry}; >10ms ${(a.filter(x => x > 10).reduce((s, x) => s + x, 0) / 1000).toFixed(2)} s in ${a.filter(x => x > 10).length}`);
});

const ML_TELE_REFUSALS = [
    'Your Magic level is not high enough', 'Runes to cast this spell', "You need to be on a members' server",
    'A mysterious force blocks your teleport', 'You must have completed Plague City', 'You need to have completed the',
    "You haven't learnt how to cast this spell", 'The amulet has lost its charge', 'You cannot teleport from Tutorial Island',
    "Coward! You can't teleport from a duel", "You can't teleport whilst swimming", 'too far from shore to teleport',
];

// =====================================================================================================
// ⛔ THE TRAVEL WEDGE — one TRAVELING line per bot, repeated for 33,000 ticks
// =====================================================================================================
// Bots spent the whole run in `ph=travel` with ZERO tile progress, each printing ONE line forever, in three shapes:
//
//   1. `TRAVELING (2538,3094)->(2846,3430) path=514wp idx=1`   routeVerdict=BLOCKED   (surface)
//   2. `computed 0-corner / 0-tile route (3236,9857)->(2846,3430)` + `ROUTE UNAVAILABLE` (Varrock sewers)
//   3. `TRAVELING (2655,9714)->(2846,3430) path=58wp idx=1`    routeVerdict=PASSABLE(!) (underground)
//
// ⛔ AND `idx=1` IS NOT A PATHFINDER FAULT — IT IS A RE-PLAN LOOP EATING ITS OWN MOVES. This is the
// same wedge seen elsewhere as `path=905wp idx=1` (tile frozen, HP still regenerating):
// `doTravel`'s stall repair re-plans, sets `travelIdx = 0` and `lastTravelMoveTick = -100`, so the very
// next line emits a fresh MOVE_GAMECLICK. A MOVE_GAMECLICK **REPLACES** the server-side route — so a
// client that re-sends one EVERY tick resets the route before the player takes a single step. The
// walker's skip-my-own-tile loop then parks the cursor on index 1, and `idx=1` is that loop's
// signature, not a stuck pathfinder. Whatever makes the repair fire per-tick (a starved packet loop, or
// a subclass that SHADOWS `travelPrevTile`) produces it.
//
// THE THREE PROPERTIES ADDED BELOW, each of which one of the three shapes needed:
//   * TRAVEL_REPLAN_MIN_TICKS — a hard floor between two full re-plans, so no amount of upstream
//     corruption can make the repair (and therefore the MOVE) fire every tick again.
//   * the WAYPOINT-PROGRESS watchdog — wedging is measured on `(tile, travelIdx)`, so a bot that is
//     re-planning busily while going nowhere is still, correctly, "not travelling".
//   * `stratumEscape` — off-surface, the exit is a LADDER and no amount of re-planning can express one.

/**
 * z at or below which a tile is on the SURFACE stratum.
 *
 * ⛔ THIS IS A z THRESHOLD, NOT A PLANE. A dungeon is level 0 shifted +6400 (movecoord ±6400,
 * trapdoors.rs2 / stairs.rs2), so a bot in a cave and a bot in a field BOTH report `minusedlevel === 0`
 * and any check that asks for the plane calls them identical. 5631 is also where navgrid.bin's window
 * ends, which is why a surface planner answers EMPTY for every tile above it — a statement about the
 * PLANNER, never about the bot being walled in.
 *
 * Subclasses that need the same threshold should import this constant rather than restate it.
 */
export const UNDERGROUND_Z = 5631;
/** Ticks with NO tile AND no waypoint-index change before the travel layer escalates. */
export const TRAVEL_WEDGE_TICKS = Number(process.env.FB_TRAVEL_WEDGE_TICKS ?? 24);
/** Minimum ticks between two escalation rungs — an escalation ladder must not be a spin either. */
export const TRAVEL_UNWEDGE_COOLDOWN = Number(process.env.FB_TRAVEL_UNWEDGE_COOLDOWN ?? 12);
/**
 * ⭐ THE CPU / MOVE BRAKE. Hard floor, in ticks, between two FULL re-plans in doTravel.
 * `planRoute` is SYNCHRONOUS (~570ms for a long route) inside the packet loop, and each re-plan also
 * re-arms an immediate MOVE. Six ticks is what the stall repair already intends (it zeroes its own
 * counter every time it fires); making it an EXPLICIT floor is what survives a corrupted counter.
 */
export const TRAVEL_REPLAN_MIN_TICKS = Number(process.env.FB_TRAVEL_REPLAN_MIN_TICKS ?? 6);
/**
 * WEDGE-DOOR rung (travelUnwedge rung 2): blind OPLOCs of the route's next door edge before that edge is
 * MASKED for re-planning, and how long the mask lives. The mask is per-bot and expires, so a door that was
 * merely held shut (another bot, a stale tracker) costs one detour, never a permanent re-wall.
 */
export const TRAVEL_WEDGE_DOOR_TRIES = Number(process.env.FB_TRAVEL_WEDGE_DOOR_TRIES ?? 2);
export const TRAVEL_DOOR_MASK_TICKS = Number(process.env.FB_TRAVEL_DOOR_MASK_TICKS ?? 600);
/** How far along the route (tiles from the walker cursor) the wedge rung looks for the blocking door. */
export const TRAVEL_WEDGE_DOOR_LOOKAHEAD = 12;
/** TRAVEL_DOORS keyed "level,x,z" — the closed-variant loc id/op a blind wedge OPLOC sends. */
let travelDoorByKey: Map<string, (typeof TRAVEL_DOORS)[number]> | null = null;
export function travelDoorAt(level: number, x: number, z: number): (typeof TRAVEL_DOORS)[number] | undefined {
    if (!travelDoorByKey) { travelDoorByKey = new Map(); for (const d of TRAVEL_DOORS) travelDoorByKey.set(`${d.level},${d.x},${d.z}`, d); }
    return travelDoorByKey.get(`${level},${x},${z}`);
}
/** WALK-DOOR (LeanBot.openDoorOnWalk): blind opens per door per window, and the minimum spacing between two of them. */
export const WALK_DOOR_TRIES = Number(process.env.FB_WALK_DOOR_TRIES ?? 3);
export const WALK_DOOR_WINDOW = Number(process.env.FB_WALK_DOOR_WINDOW ?? 200);
export const WALK_DOOR_SPACING = 6;
/** Corner route -> per-tile route (Chebyshev steps), the first entry kept as-is. */
export function densifyCorners(corners: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    for (const c of corners) {
        if (!out.length) { out.push({ x: c.x, z: c.z }); continue; }
        let { x, z } = out[out.length - 1]!;
        while (x !== c.x || z !== c.z) { if (x < c.x) x++; else if (x > c.x) x--; if (z < c.z) z++; else if (z > c.z) z--; out.push({ x, z }); }
    }
    return out;
}
/**
 * The first known door EDGE (getDoorAt + stepCrossesDoorEdge) a per-tile route crosses, walking from `me` through
 * path[from .. from+lookahead). Only real single steps count. Shared by LeanBot's wedge rung (travelPath) and walk-door.
 */
export function doorEdgeOnPath(level: number, me: { x: number; z: number }, path: Array<{ x: number; z: number }> | null | undefined,
    from: number, lookahead: number): DoorInfo | null {
    if (!path || path.length === 0) return null;
    let prev: { x: number; z: number } = me;
    const lim = Math.min(from + lookahead, path.length);
    for (let i = from; i < lim; i++) {
        const t = path[i]!;
        if (Math.max(Math.abs(t.x - prev.x), Math.abs(t.z - prev.z)) === 1) {   // a real single step
            for (const c of [prev, t]) {
                const d = getDoorAt(level, c.x, c.z);
                if (d && stepCrossesDoorEdge(d, prev, t)) return d;
            }
        }
        prev = t;
    }
    return null;
}
/**
 * Does the single step a->b cross door `d`'s EDGE? A straight wall door (shape 0) sits on ONE edge of its
 * tile (angle 0=W 1=N 2=E 3=S — rsmod/engine convention), so the door tile itself is walkable and the
 * blocked move is door-tile <-> the neighbour on that side. Lumbridge castle (3215,3211) is angle 1: the
 * bot stands ON the door tile and the closed edge is its NORTH side — which is why a tile-membership test
 * ("is the next path tile a door?") never sees it. Other shapes (diagonal etc.): touching the tile counts.
 */
export function stepCrossesDoorEdge(d: { x: number; z: number; shape: number; angle: number }, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const onA = a.x === d.x && a.z === d.z, onB = b.x === d.x && b.z === d.z;
    if (!onA && !onB) return false;
    if (d.shape !== 0) return true;
    const o = [[-1, 0], [0, 1], [1, 0], [0, -1]][d.angle & 3]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    if (onA) return (o[0] !== 0 && dx === o[0]) || (o[1] !== 0 && dz === o[1]);
    return (o[0] !== 0 && dx === -o[0]) || (o[1] !== 0 && dz === -o[1]);
}
/** Climb-out attempts (one per exit tried) before the bot goes quiet and asks for extraction. */
export const STRATUM_ESCAPE_MAX_TRIES = Number(process.env.FB_STRATUM_ESCAPE_TRIES ?? 6);
/** Ticks one exit gets to actually land us on the surface before it is blacklisted. */
export const STRATUM_CLIMB_TICKS = Number(process.env.FB_STRATUM_CLIMB_TICKS ?? 60);
/** Widening search radii for a climbable exit. Nearest-first inside each ring. */
export const STRATUM_SEARCH_RADII = [24, 48, 96] as const;
/**
 * Ticks before a "no reachable exit" answer is re-asked.
 *
 * ⛔ A LATCH WOULD BE WRONG HERE. "No exit is reachable FROM THIS TILE" is a statement about a tile,
 * and a bot that drifts, is knocked back, or is pushed by a respawn is not on that tile any more.
 * Latched, a bot that could now walk out would never try again. So: re-ask, but rarely, because the
 * answer costs real pathfinder searches.
 */
export const STRATUM_RESCAN_TICKS = Number(process.env.FB_STRATUM_RESCAN_TICKS ?? 300);
/** Exits whose reachability is probed per acquisition — the probe is a real pathfinder call. */
export const STRATUM_PROBE_MAX = Number(process.env.FB_STRATUM_PROBE_MAX ?? 6);
/**
 * One planner retry in this many ticks for an off-surface bot with no escape to make.
 *
 * ⛔ REMOVING A SPIN'S BRAKE IS ITSELF AN OUTAGE. Four bots re-planning per tick from a dungeon burned
 * 492s of CPU in six minutes, emitted 19KB of `ROUTE UNAVAILABLE` per 25s, and starved the logins that
 * had not connected yet — `planRoute` is SYNCHRONOUS inside the packet loop, so one bot's spin stalls
 * every bot in the same process.
 */
export const OFF_SURFACE_RETRY_TICKS = Number(process.env.FB_OFF_SURFACE_RETRY_TICKS ?? 50);
/**
 * A route whose LAST tile is further than this from `travelDest` **and on the other stratum** is a
 * cross-stratum misclassification, not a route. See the note at its use site in doTravel.
 */
export const CROSS_STRATUM_SHORT_TILES = Number(process.env.FB_CROSS_STRATUM_SHORT ?? 48);
/**
 * Loc option TEXT that means "this takes me UP a stratum".
 *
 * ⛔ MATCH THE OP, NOT THE NAME: the ops are what the client offers the player, and guessing at names misses half the exits. Anchored, so `Pick-up`,
 * `Climb-over` (22 of them — a fence, not an exit), `Climb-across`, `Climb-to` and `Climb-on` can
 * never match, and a bare `Climb` (loc_1739, which is BOTH directions) is skipped in favour of that
 * same loc's explicit `Climb-up` op2.
 */
export const CLIMB_UP_OP = /^(?:climb|walk)[-_ ]?(?:up|out)$/i;
/** One climbable UP transition: everything an OPLOC needs plus what a log line needs. */
export interface ClimbExit { x: number; z: number; locId: number; op: number; name: string; dist: number }

// Openable doors/gates on the travel network (static table from the server map).
// Scenery locs whose "Open" op is content junk are excluded (OPLOCing them does
// nothing and the pathfinder wrongly treats them as passable). op index -> opcode.
// EXCEPTION (the wizard-tower wedge, live-caught twice): NEVER junk-filter a door at a coordinate the
// PATHFINDER routes through (knownDoorCoords = collision-data wall doors + the diagonal set). A junk
// loc id (e.g. 1536) placed as a real travel door must be OPLOC-able or the route wedges at it.
const JUNK_DOOR_LOCS = new Set([71, 72, 73, 74, 1512, 1516, 1519, 1530, 1536]);
const PATHED_DOOR_COORDS = knownDoorCoords();   // "level,x,z" — a junk loc id placed as a real routed door
// ⛔ SCRIPTED OBSTACLES ARE NOT DOORS, AND THE BLIND OPENER MUST NEVER TOUCH THEM. The Al Kharid toll
// gate halves (border_gate_toll_left/right) are named "Gate" with op1=Open in the door table, so they
// used to qualify as travel doors — but their op1 does not swing anything, it opens a DIALOG that asks
// for 10gp (border_gate.rs2:35). doTravel's stall handler used to blind-OPLOC the gate, the base
// driveDialog then answered with option 1 = "No thank you, I'll walk around.", the walk stalled again,
// and the bot re-declined the toll indefinitely. A toll crossing belongs to a brain that KNOWS it is
// crossing (it pays explicitly by geography); a stall-triggered blind open can only ever decline it.
const SCRIPTED_OBSTACLE_LOCS = new Set([2882, 2883]);   // the toll gate halves — pay, never "open"
// NAMES ENDING IN "door": the old ^(door|gate|large door) filter dropped every prefixed door — "Magic guild
// door" wedged the teleport pilot inside the guild (its op1 teleports you through). +61 doors (guild/prison/metal doors —
// a locked one only answers with a message; the wedge rung masks it after 2 tries). "Trap door" is not a walk-through.
export const TRAVEL_DOORS = DOORS.filter(d => (/^(door|gate|large door)/i.test(d.name) || (/\bdoor$/i.test(d.name) && !/^trap door$/i.test(d.name)))
    && !SCRIPTED_OBSTACLE_LOCS.has(d.locId)
    && (!JUNK_DOOR_LOCS.has(d.locId) || PATHED_DOOR_COORDS.has(`${d.level},${d.x},${d.z}`)));
const OPLOC_OPCODES = [0, ClientProt.OPLOC1, ClientProt.OPLOC2, ClientProt.OPLOC3, ClientProt.OPLOC4, ClientProt.OPLOC5];   // rev 289 (was 215,103,187,157,127 @274)
// OPOBJ<op> opcodes (ClientGameProt.ts): op3 = "Take" a ground item (ObjType.op[2]).
const OPOBJ_OPCODES = [0, ClientProt.OPOBJ1, ClientProt.OPOBJ2, ClientProt.OPOBJ3, ClientProt.OPOBJ4, ClientProt.OPOBJ5];   // rev 289 (was 247,169,108,62,117 @274)
// INV_BUTTON<op> opcodes (ClientGameProt.ts): op1=make-1, op2=make-5, op3=make-10, op4/op5 spare.
// Used to click a transmitted inv list (e.g. the smithing anvil's smithing:columnN "make 1/5/10").
const INV_BUTTON_OPCODES = [0, ClientProt.INV_BUTTON1, ClientProt.INV_BUTTON2, ClientProt.INV_BUTTON3, ClientProt.INV_BUTTON4, ClientProt.INV_BUTTON5];   // rev 289 (was 74,82,239,179,46 @274)

// ---- outgoing opcodes (verbatim from src/io/ClientProt.ts; VERIFIED against
//      server engine ClientGameProt.ts + the codec decoders) -----------------
const enum Out {
    OPNPC1 = ClientProt.OPNPC1,
    OPNPC2 = ClientProt.OPNPC2,  // "Attack" (op2 on man/goblin/chicken/rat)
    OPNPC3 = ClientProt.OPNPC3,
    // ⛔ THE OP LABELS ARE CONTENT, AND THIS CONTENT IS NOT THE OBVIOUS ORDER. `login.rs2:18-32` is
    // the authority: op2 = "Attack" (and ONLY inside the wilderness — `set_player_op(null, 2, …)`
    // everywhere else, wilderness.rs2 re-enables it), op3 = "Follow", op4 = "Trade with", op5 = null.
    // Guessing op2=Follow (the intuitive order) sends a NULL op: the engine accepts the packet, sets
    // an ENGINE interaction with no script behind it, and the bot takes one step and stops — a
    // failure that looks exactly like "follow is flaky". .
    OPPLAYER1 = ClientProt.OPPLAYER1,   // "Challenge" (duel arena challenge area only: duel_arena.rs2:399-402). payload = p2(playerWorldIndex)
    OPPLAYER2 = ClientProt.OPPLAYER2,   // "Attack" (PvP; wilderness only). payload = p2(playerWorldIndex). ClientGameProt(166, 2)
    OPPLAYER3 = ClientProt.OPPLAYER3,   // "Follow". payload = p2(playerWorldIndex). ClientGameProt(196, 2)
    OPPLAYER4 = ClientProt.OPPLAYER4,    // "Trade with". payload = p2(playerWorldIndex).  (NOT 72!)
    // Cast a spell on a GROUND item (alch/telegrab on the floor). ClientGameProt(91, 8);
    // OpObjTDecoder reads g2 x, g2 z, g2 obj, g2 spellCom.
    OPOBJT = ClientProt.OPOBJT,
    INV_BUTTON4 = ClientProt.INV_BUTTON4, // "offer all" on an inv com. payload = p2(obj) p2(slot) p2(com).  (NOT 160!)
    IF_BUTTON = ClientProt.IF_BUTTON,
    RESUME_PAUSEBUTTON = ClientProt.RESUME_PAUSEBUTTON,
    CLOSE_MODAL = ClientProt.CLOSE_MODAL,
    // Sidebar tab click. ClientGameProt(94, 1); TutClickSideDecoder reads ONE byte (the tab index)
    // and TutClickSideHandler rejects anything outside 0..13.
    TUT_CLICKSIDE = ClientProt.TUT_CLICKSIDE,
    MOVE_OPCLICK = ClientProt.MOVE_OPCLICK,
    MOVE_GAMECLICK = ClientProt.MOVE_GAMECLICK,
    OPHELD1 = ClientProt.OPHELD1,     // "eat"/op1 on an inv item. payload = p2(obj) p2(slot) p2(com).
    NO_TIMEOUT = ClientProt.NO_TIMEOUT,
    // Character design. ClientGameProt(125, 13); IdkSaveDesignDecoder reads g1 gender + 7 g1 kits
    // (255 => -1) + 5 g1 colours. Headless previously only ACCEPTED the server default via IF_BUTTON.
    IDK_SAVEDESIGN = ClientProt.IDK_SAVEDESIGN,
    // Public chat. ClientGameProt(253, -1) — variable BYTE size; body = p1(colour) p1(effect) + wordpack.
    MESSAGE_PUBLIC = ClientProt.MESSAGE_PUBLIC
}

// ---- npc extended-update masks (verbatim from src/dash3d/ClientNpc.ts) -----
const enum NpcUpdate {
    HITMARK2 = 0x1,
    ANIM = 0x2,
    FACEENTITY = 0x4,
    SAY = 0x8,
    HITMARK = 0x10,
    CHANGETYPE = 0x20,
    SPOTANIM = 0x40,
    FACESQUARE = 0x80
}

// ---- game constants (looked up in server/content/pack + scripts) -----------
const GUIDE_TYPE = 945;                 // newbie_basics_instructor (RuneScape Guide)
// Combat-training targets (FB_MODE=combat): weak NPCs east of the Lumbridge
// bridge. Dealing damage is what grants Hitpoints xp (1.33/dmg, x25 xprate) —
// the goal is maxHp for travel survivability, not kills per hour.
const COMBAT_TYPES = new Set([41, 47, 100, 81]); // chicken, rat, goblin, cow (81: 8hp, harmless, best HP-xp/kill)
// Default = WEST-bank goblin cluster on the Draynor road (6 spawns ~3183-3187,
// 3244-3246; 11 more at ~3141-3146,3227-3234 — set FB_COMBAT_X/Z to split
// bots between them). The east goblin field needs the Lumbridge bridge, whose rail rows
// are inviswall_blockrange (loc 85) that the offline pathfinder can't see —
// bots stall at (3241,3224) forever trying to cut the rail diagonally.
const GOBLIN_SPOT = {
    x: Number(process.env.FB_COMBAT_X ?? 3185),
    z: Number(process.env.FB_COMBAT_Z ?? 3245)
};
const HP_STAT = 3;                      // hitpoints stat index
const PRAYER_STAT = 5;                  // prayer stat index (bury_bone.rs2 stat_advance target)
const COINS_OBJ = 995;                  // coins
const INV_INTERFACE = 3214;             // inventory:inv (main backpack)
/** RS stat index -> name (PlayerStat.ts order; same table as route-gate.ts STAT_NAMES, kept local: no import cycle). */
const ACCT_STAT_NAMES: readonly string[] = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'stat18', 'stat19', 'runecraft'];
const WORN_INTERFACE = 1688;            // wornitems:wear — the EQUIPPED inv (isWorn reads this)

// ============================================================================
// BONES — THE COMPLETE BURY TABLE (id -> bone_exp), enumerated from source.
// ============================================================================
// `bury_bone.rs2:1` registers exactly ONE trigger: `[opheld1,_bones]`. The leading `_` is a
// CATEGORY dispatch, so OPHELD1 buries any obj with `category=bones` and grants
// `oc_param($obj, bone_exp)` prayer xp (`bury_bone.rs2:15`). Every id below was read off
// `server/content/scripts/skill_prayer/configs/bones.obj` (16 entries) +
// `scripts/_unpack/274/all.obj:342-353` (monkey bones) and resolved through
// `server/content/pack/obj.pack`. 2530 (newbiebones) has NO category but its OWN
// `[opheld1,newbiebones]` trigger (`tut_bury_bone.rs2:1`) — it buries too, so it is in the set.
//
// ⛔ WHY THE FULL TABLE AND NOT JUST 526: THE CAKE-HUSK PRECEDENT. A multi-stage consumable we
// new loot ON THE FLOOR. Bones are the same shape: 17 distinct ids, NONE stackable (1 slot each),
// so a bone this table misses is a permanent slot leak that looks like nothing at all. Hence
// `bonesHeld()`/`boneNotesHeld()` are reported like `husks=`.
export const BURYABLE_BONES = new Map<number, number>([
    [526, 45],    // bones             — the DEFAULT npc death drop (npc_combat.param:29-31)
    [528, 45],    // bones_burnt
    [530, 45],    // bat_bones         (members)
    [532, 150],   // big_bones         — giants/ogres/trolls/cyclops override; 3.33x plain
    [534, 300],   // babydragon_bones  (members)
    [536, 720],   // dragon_bones      (members)
    [2859, 45],   // wolf_bones        (members)
    [3123, 250],  // tbwt_beast_bones  (members)
    [3125, 150],  // tbwt_jogre_bones  (members)
    [3127, 160],  // tbwt_burnt_jogre_bones
    [3128, 170],  // ...in_raw_karambwanji_paste
    [3129, 160],  // ...in_cooked_karambwanji_paste
    [3130, 180],  // ...marinated_in_karambwanji
    [3131, 160],  // tbwt_jogre_bones_in_raw_karambwanji_paste
    [3132, 160],  // ...in_cooked_karambwanji_paste
    [3133, 170],  // ...marinated_in_karambwanji
    [3183, 50],   // mm_normal_monkey_bones
    [2530, 45],   // newbiebones — own trigger (tut_bury_bone.rs2), no category
]);
// LOOKALIKES THAT CANNOT BE BURIED — the trap that makes a name-matching bot leak slots forever.
//  - cert_* notes are `id + 1` and inherit the base item's NAME (ObjType.ts:308) while getting NO
//    `iop` (so OpHeldHandler.ts:46 silently DROPS the packet). "Big bones" in the client, unburyable.
//  - mm_* ninja/gorilla/zombie/skeleton monkey bones show a "Bury" right-click but sit in
//    `category=6` (door_opened), so `_bones` never fires and nothing happens, forever.
// Counted (never buried) so the leak is visible instead of invisible.
export const BONE_LOOKALIKES = new Set([
    527, 529, 531, 533, 535, 537, 2531, 2860, 3124, 3126, 3184,   // cert_* notes
    3179, 3180, 3181, 3182, 3185, 3186, 3187,                     // mm_* category=6 decoys
]);
const PLAYER_KIT_MODAL = 3559;          // player_kit char-design modal
const PLAYER_KIT_ACCEPT = 3651;         // player_kit:accept button
// p_choice2 opens multi2 (root 2459); option 1 = multi2:com_1 = root+2.
// multi2/3/4/5 roots. DERIVED from the generated table rather than re-typed, so this and the option
// components can never drift apart.
const CHOICE_ROOTS = new Set(DIALOG_ROOTS.map(d => d.root));
const NPC_ARRAY = 16384;
const LOCAL_PLAYER_INDEX = 2047;

// ⛔ TUTORIAL ISLAND IS A BOUNDED BOX, NOT TWO HALF-PLANES. ⛔
//
// A fresh account spawns at (3094,3106) (`Player.ts:415-417`) and the RuneScape Guide (npc 945) has
// EXACTLY ONE spawn in the whole world, at (3094,3107) — so the island is a small rectangle, and every
// tile outside it must classify as mainland.
//
// THIS PREDICATE HAS BRICKED AN ACCOUNT TWICE, THE SECOND TIME AFTER A "FIX".
//   * v1 `z < 3180` — the Al Kharid warrior camp sits at z 3168-3177, so a bot parked there woke up
//     believing it was on tutorial island.
//   * v2 `x < 3200 && z < 3180` — still TWO HALF-PLANES, i.e. the ENTIRE SOUTH-WEST QUADRANT OF THE
//     WORLD (Karamja, Brimhaven, Yanille, Feldip, south Ardougne, the Lumbridge swamp...). Its own
//     comment claimed "nothing east of x=3200 is ever tutorial", which is true and beside the point:
//     an account that logged out at (3109,3167) — WEST of 3200 and SOUTH of 3180 — satisfied both.
//     It then sat inert for 75 minutes: brain() below took the tutorial branch, found no guide, and
//     RETURNED WITHOUT SENDING A BYTE, every tick, so the engine kicked it on a 305s metronome
//     (TIMEOUT_NO_RESPONSE = 1000 ticks, World.ts:132) — 14 kicks, zero log lines, with a healthy connection count.
//
// v3 IS MEASURED, NOT GUESSED. Flood-filling the engine's own collision data from the guide's spawn
// yields a connected region of 1,695 tiles bounded by x[3056,3107] z[3059,3133] that does NOT touch the
// mainland (it is an island). The box below is that region with generous slack, and it was verified
// against a 160,759-tile flood from Lumbridge: **0 mainland-reachable tiles fall inside the box, and 0
// island tiles fall outside it.** So no parked bot anywhere on the mainland can ever take the tutorial
// branch again, and a genuinely fresh account still does.
const TUTORIAL_ISLAND = { x0: 3040, x1: 3140, z0: 3040, z1: 3140 } as const;
/** Ticks to keep looking for the RuneScape Guide before declaring TUTORIAL-NO-GUIDE and running the
 *  normal brain instead. The guide's only spawn is ONE TILE from where a fresh account materialises,
 *  so 25 ticks (~7.5s live) is four scene updates' worth of grace and still 40x inside the engine's
 *  1000-tick idle kick — the window that used to be infinite. */
const TUTORIAL_GUIDE_PATIENCE = Number(process.env.FB_TUTORIAL_GUIDE_PATIENCE ?? 25);
const onTutorialIsland = (t: { x: number; z: number }): boolean =>
    t.x >= TUTORIAL_ISLAND.x0 && t.x <= TUTORIAL_ISLAND.x1 &&
    t.z >= TUTORIAL_ISLAND.z0 && t.z <= TUTORIAL_ISLAND.z1;

// ============================================================================
// THE XP TABLE — ported verbatim from the engine (Player.ts:77-85 + getLevelByExp:87-95).
// ============================================================================
// ⛔ WHY A CLIENT NEEDS THIS: UPDATE_STAT's `level` byte for hitpoints is the CURRENT (drained) hp, not
// the base level ("// not base level" — UpdateStatEncoder.ts:12). LeanBot therefore estimated maxHp as
// "the highest current hp I have ever seen this session", which is WRONG the moment a bot logs in hurt:
// a bot that reconnected at 1/25 hp reported maxHp=1, so the RELATIVE food threshold
// max(2, floor(maxHp*0.4)) collapsed to 2 and it walked around at 1 hp with 14 kebabs in its pack.
// That is the FOOD-GATE TRAP again, wearing the other mask — a relative gate is only as good as the
// denominator. The base level is derivable exactly, from xp, so derive it.
// NOTE the units: the wire carries DISPLAYED xp (`(exp / 10) | 0`), the table is INTERNAL.
const LEVEL_XP: number[] = (() => {
    const t: number[] = [];
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2.0, level / 10.0) * 300.0);
        t.push(Math.floor(acc / 4) * 10);
    }
    return t;
})();
/** Base level for a DISPLAYED xp value (what UPDATE_STAT carries). Mirrors engine getLevelByExp. */
export function levelForDisplayedXp(displayedXp: number): number {
    const internal = displayedXp * 10;
    for (let i = 98; i >= 0; i--) if (internal >= LEVEL_XP[i]!) return Math.min(i + 2, 99);
    return 1;
}

/**
 * TARGET CLAIMS — "nearest live spawn not already committed to by another bot in THIS PROCESS".
 *
 * ⛔ WHY THIS EXISTS. The old picker was `byDist[(uid + combatRepick) % K]` over the nearest 5, which
 * deliberately walked a bot past closer spawns so several bots would not dogpile one npc (the engine
 * credits a kill's drop to exactly ONE player, so contention is real). That anti-contention is worth
 * keeping — but it was paid for in the bucket that turned out to dominate: `approach` was 57% of all
 * ticks, at 0.10-0.21 tiles/tick, with 10.5 commitments per kill. Choosing by CLAIM instead of by hash is
 * simultaneously anti-contention and distance-minimal: no two bots commit to the same npc, and each takes
 * the nearest one nobody holds.
 *
 * It is shared by every bot in one process, so a plain Map is free and needs no IPC. A solo bot injects
 * nothing, every npc reads as free, and the picker degrades to PLAIN NEAREST rather than breaking.
 * ⛔ AND IT IS TTL'd IN TICKS. A bot that crashes, reconnects or wanders off must never hold a spawn forever:
 * a claim not refreshed within `ttlTicks` is dead and the spawn is claimable again. The TTL is the only thing
 * standing between "one bot per npc" and "one npc parked forever by a ghost".
 */
export class TargetClaimRegistry {
    private held = new Map<number, { uid: number; tick: number }>();
    constructor(readonly ttlTicks = Number(process.env.FB_CLAIM_TTL ?? 50)) {}
    /** uid holding this npc right now, or undefined. Expired claims are treated as absent AND reaped. */
    ownerOf(index: number, tick: number): number | undefined {
        const c = this.held.get(index);
        if (!c) return undefined;
        if (tick - c.tick > this.ttlTicks) { this.held.delete(index); return undefined; }
        return c.uid;
    }
    /** claim (or refresh) an npc for uid. False when someone else holds it. */
    claim(index: number, uid: number, tick: number): boolean {
        const owner = this.ownerOf(index, tick);
        if (owner !== undefined && owner !== uid) return false;
        this.held.set(index, { uid, tick });
        return true;
    }
    release(index: number, uid: number): void {
        if (this.held.get(index)?.uid === uid) this.held.delete(index);
    }
    size(tick: number): number {
        let n = 0;
        for (const [i] of this.held) if (this.ownerOf(i, tick) !== undefined) n++;
        return n;
    }
}

class LeanNpc extends LeanPlayer {
    typeId = -1;

    // ---- HITSPLAT / HEALTH RETENTION (P1-E) -----------------------------------------------------
    // The NPC extended-info block already carried dmg/type/hp/maxhp on every hit; the decode read the
    // four bytes purely to stay aligned and threw them away. They are the ONLY per-npc health signal a
    // headless bot can have — NPC_INFO has no "current hp" field of its own, the hitsplat IS the
    // broadcast. Retaining them costs nothing (the bytes are already being read) and turns "is this
    // npc nearly dead / is anyone actually hitting it" from a guess into a measurement.
    //
    // ⛔ hp/maxHp are ONLY meaningful once lastHitCycle >= 0. Before the first hitsplat they are -1,
    // NOT "full health" — a brain that read 0/0 as "dead" would be reading the absence of data.
    /** damage of the most recent hitsplat (0 = a miss; the engine sends a 0-damage splat for a block) */
    lastDamage = -1;
    /** hitsplat type byte (0 = block/miss colouring, 1 = damage; content-defined) */
    lastDamageType = -1;
    /** npc current hitpoints as of the last hitsplat, in the engine's 0..255 wire units */
    hpCur = -1;
    /** npc max hitpoints as of the last hitsplat */
    hpMax = -1;
    /** this.loopCycle at the last hitsplat; -1 = never hit in our view */
    lastHitCycle = -1;
    /** hitsplats seen on this npc since it entered our view (both HITMARK and HITMARK2 slots) */
    hitCount = 0;

    override reset(): void {
        super.reset();
        this.typeId = -1;
        this.lastDamage = -1;
        this.lastDamageType = -1;
        this.hpCur = -1;
        this.hpMax = -1;
        this.lastHitCycle = -1;
        this.hitCount = 0;
    }

    /** Health as a 0..1 fraction, or -1 when no hitsplat has ever been seen for this npc. */
    healthFrac(): number {
        if (this.lastHitCycle < 0 || this.hpMax <= 0) return -1;
        return Math.max(0, Math.min(1, this.hpCur / this.hpMax));
    }

    /** Record one hitsplat. Shared by the HITMARK and HITMARK2 decode arms so they cannot drift. */
    noteHit(cycle: number, damage: number, type: number, cur: number, max: number): void {
        this.lastDamage = damage;
        this.lastDamageType = type;
        this.hpCur = cur;
        this.hpMax = max;
        this.lastHitCycle = cycle;
        this.hitCount++;
    }
}

// Same freelist rationale as LeanPlayer's in leanclient.ts, and npcs churn HARDER: a bot re-vis's the
// whole npc neighbourhood on every scene rebuild. Release happens only where the decoder nulls the slot, acquire POPS, so an object is never live twice.
const NPC_POOL_MAX = 4096;
const npcPool: LeanNpc[] = [];

function acquireNpc(): LeanNpc {
    const n = npcPool.pop();
    if (n) {
        n.reset();
        return n;
    }
    return new LeanNpc();
}

function releaseNpc(n: LeanNpc): void {
    if (npcPool.length < NPC_POOL_MAX) npcPool.push(n);
}

// =================================================================================================
// SKILLING RESULT SHAPES (parity package 2b)
// =================================================================================================
// Deliberately the SAME field names as sdk/types.ts (ChopTreeResult, BurnLogsResult, FletchResult,
// CraftLeatherResult, CraftJewelryResult, EnchantResult, StringAmuletResult) so package 3's typed-
// result generalisation is a rename-free merge. Two honest divergences:
//   * `reason` is present on EVERY shape. The browser SDK omits it on ChopTreeResult/BurnLogsResult/
//     FletchResult, which forces a caller to regex the human-readable `message` to tell "no axe" from
//     "the tree is gone" — the exact failure class this package exists to remove.
//   * items are {slot,id,name,count} — the SDK's InventoryItem minus `optionsWithIndex`, which is a
//     CLIENT-scene field the headless stack has no source for (the server never transmits obj ops).

/** The engine's refusal when a loc/obj op is issued from out of reach (OpLocHandler -> ~cant_reach).
 *  Already counted by the MESSAGE_GAME decode as `cantReachMsgs`; the skilling actions read it too,
 *  because for them it is the difference between "nothing happened" and "you were never close enough". */
const CANT_REACH_MESSAGE = "I can't reach that!";

/** One backpack entry. Field names match sdk/types.ts InventoryItem. */
export interface SkillItem {
    slot: number;
    id: number;
    /** display name from the obj table; '' when locScene has not been init()'d in this process */
    name: string;
    count: number;
}

// =====================================================================================================
// THE ASYNC-ACTION ADAPTER — types
// =====================================================================================================
// See `startAction()` for the whole design essay. These two types are the contract:
//   * every action this adapter can drive reports {success, reason?, message?} — the typed refusal
//     shape every skilling action already returns;
//   * every outcome the adapter hands back names the action, says whether it SUCCEEDED (not merely
//     "resolved"), and CARRIES THE REASON. Swallowing `reason` is how a lane learns that "it didn't
//     work" and never learns that the answer was `no_axe`.

/** What the adapter requires of anything it drives. Deliberately structural: `bot.chopTree`,
 *  `bot.burnLogs` and every future async action already satisfy it without being changed. */
export interface AsyncActionResult {
    success: boolean;
    reason?: string;
    message?: string;
}

/** The settled result of one adapter-driven action. `result` is the action's own typed object, so a
 *  caller that wants `logs`/`xpGained`/`fireAt` reads it there with no casting away of the shape. */
export interface ActionOutcome<T extends AsyncActionResult = AsyncActionResult> {
    /** the label the brain started it under — the same string that appears in `tickBucket` and the wedge */
    name: string;
    /** the action RESOLVED and reported success. A timeout/throw is `false`, never a silent maybe. */
    ok: boolean;
    /** '' on success; else the action's own `reason`, or the adapter's `action_timeout` / `action_threw`. */
    reason: string;
    message: string;
    /** the action's full typed result — null when the adapter abandoned it or it threw. */
    result: T | null;
    /** server ticks the action was held in flight. */
    ticks: number;
}

export interface ChopTreeResult {
    success: boolean;
    message: string;
    logs?: SkillItem;
    xpGained?: number;
    reason?: 'no_axe' | 'tree_not_found' | 'not_a_tree' | 'level_too_low' | 'inventory_full' | 'cant_reach' | 'timeout';
}

export interface BurnLogsResult {
    success: boolean;
    xpGained: number;
    message: string;
    /** The tile the FIRE is on — ~push_player moved the player off it (see burnLogs). */
    fireAt?: { x: number; z: number };
    reason?: 'no_tinderbox' | 'no_logs' | 'no_space' | 'level_too_low' | 'timeout';
}

export interface FletchResult {
    success: boolean;
    message: string;
    xpGained?: number;
    product?: SkillItem;
    itemsMade?: number;
    reason?: 'no_knife' | 'no_logs' | 'unknown_product' | 'members' | 'dialog_not_opened'
        | 'countdialog_not_offered' | 'level_too_low' | 'timeout';
}

export interface CraftLeatherResult {
    success: boolean;
    message: string;
    xpGained?: number;
    itemsCrafted?: number;
    product?: SkillItem;
    reason?: 'no_needle' | 'no_leather' | 'no_thread' | 'unknown_product' | 'interface_not_opened'
        | 'level_too_low' | 'timeout';
}

export interface CraftJewelryResult {
    success: boolean;
    message: string;
    xpGained?: number;
    product?: SkillItem;
    itemsCrafted?: number;
    reason?: 'no_bar' | 'no_mould' | 'no_furnace' | 'no_gem' | 'unknown_product' | 'interface_not_opened'
        | 'row_not_transmitted' | 'level_too_low' | 'timeout';
}

export interface EnchantResult {
    success: boolean;
    message: string;
    xpGained?: number;
    product?: SkillItem;
    reason?: 'item_not_found' | 'not_enchantable' | 'no_runes' | 'level_too_low' | 'members'
        | 'wrong_target' | 'timeout';
}

export interface StringAmuletResult {
    success: boolean;
    message: string;
    xpGained?: number;
    product?: SkillItem;
    itemsMade?: number;
    reason?: 'no_amulet' | 'no_string' | 'unknown_product' | 'level_too_low' | 'timeout';
}

// =================================================================================================
// VERIFIED-INTERACTION RESULT SHAPES (parity package 3)
// =================================================================================================
// Field names follow sdk/types.ts so a reader who knows `AttackResult.reason` / `PickupResult.reason`
// can predict headless behaviour. Two deliberate additions the browser SDK does not have:
//
//   * `'no_ack'` — THE NEW REASON, and the one this package exists for. Not "the action failed" and
//     not "the server said no": the server never answered at all, so the op was DISCARDED. A caller
//     that treats `no_ack` like `timeout` will retry forever.
//   * `'unknown'` — the observable could not be read. Never silently rendered as success or failure.
//
// ⛔ COMPATIBILITY. Every method below is NEW. Not one existing primitive changed its signature or its
// bytes, because brains ignore return values and a refactor that "improved" a return would have
// silently changed their behaviour. The verified forms are opt-in.

/** Reasons shared by every verified interaction. */
export type AckFailReason = 'no_ack' | 'refused' | 'unknown' | 'timeout';

export interface AttackResult {
    success: boolean;
    message: string;
    /** hitsplats observed on the target while this call was watching */
    damageDealt?: number;
    killed?: boolean;
    reason?: 'npc_not_found' | 'npc_busy' | 'already_under_attack' | 'cant_reach' | 'dead' | AckFailReason;
}

export interface PickupResult {
    success: boolean;
    message: string;
    item?: SkillItem;
    reason?: 'item_not_found' | 'inventory_full' | 'cant_reach' | AckFailReason;
}

export interface LocInteractResult {
    success: boolean;
    message: string;
    reason?: 'loc_not_found' | 'no_such_option' | 'cant_reach' | AckFailReason;
}

export interface DoorResult {
    success: boolean;
    message: string;
    /** true when the door was ALREADY open — nothing was sent (op1 on an open door CLOSES it) */
    alreadyOpen?: boolean;
    reason?: 'not_found' | 'cant_reach' | AckFailReason;
}

export interface EquipResult {
    success: boolean;
    message: string;
    reason?: 'not_held' | 'not_worn' | 'level_too_low' | 'members' | 'quest_locked' | AckFailReason;
}

export interface EatResult {
    success: boolean;
    message: string;
    hpGained: number;
    reason?: 'no_food' | 'already_full' | AckFailReason;
}

export interface BankResult {
    success: boolean;
    message: string;
    /** how many units actually moved, read from the containers — never from the click */
    moved: number;
    reason?: 'bank_not_open' | 'not_held' | 'not_banked' | 'bank_full' | 'inventory_full' | AckFailReason;
}

export interface TravelStepResult {
    success: boolean;
    message: string;
    tilesMoved: number;
    reason?: 'blocked' | 'already_there' | AckFailReason;
}

/**
 * The result of `LeanBot.requestCleanLogout()`.
 *
 * ⛔ THREE STATES, NOT A BOOLEAN, because "we asked" and "the engine did it" are different facts and the
 * whole hiscore problem is what happens when they get conflated. `published` is the only one that means
 * a hiscore row is being written.
 */
export interface CleanLogoutOutcome {
    state: 'published' | 'timeout' | 'dead';
    /** wall-clock ms this account spent on the wind-down. Bill it: it is time off the ranked clock. */
    ms: number;
    /** how many times the logout button had to be pressed (see the one-shot note on requestLogout). */
    presses: number;
}

class LeanBot extends LeanClient implements AckHost {
    out!: Packet;
    debug = !!process.env.FB_DEBUG;

    // =============================================================================================
    // INTERACTION ACKNOWLEDGMENT (parity package 3) — see interaction-ack.ts for WHY
    // =============================================================================================
    // ⛔ PURE OBSERVATION. Nothing in this block sends a packet, blocks a tick, or changes a decision.
    // A brain that never reads `ackWedge` behaves exactly as it did before this existed, and
    // `FB_ACK_ASSERT=0` removes even the arming.
    /** Revision counters bumped by the decode arms. ONE Int32Array per bot, allocated once. */
    readonly ackRevs = new Int32Array(REV_COUNT);
    /** One record per interaction kind, preallocated. */
    readonly ack = new AckLedger();
    ackWedge = '';
    /** The most recent KNOWN_REFUSALS line the server sent (for the 'refused' verdict's message). */
    private ackRefusal = '';
    /** Total ns spent inside evaluate() — the measured packet-loop overhead. */
    ackEvalNs = 0;
    ackEvalCalls = 0;

    ackTick(): number { return this.tickCount; }
    ackObjCount(obj: number): number {
        const inv = this.invForInventory();
        if (!inv) return -1;                      // NOT 0 — see the AckHost contract
        let n = 0;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) n += inv.counts[i]!;
        return n;
    }
    ackWornCount(obj: number): number {
        const w = this.invs.get(WORN_INTERFACE);
        if (!w) return -1;
        let n = 0;
        for (let i = 0; i < w.ids.length; i++) if (w.ids[i] === obj) n += w.counts[i]!;
        return n;
    }
    ackXp(stat: number): number {
        if (stat < 0 || stat >= this.statXp.length) return -1;
        return this.statXp[stat] ?? -1;
    }
    ackVarp(id: number): number { return this.getVarp(id); }
    ackMainModal(): number { return this.mainModalId; }
    ackChatModal(): number { return this.chatModalId; }
    ackPosKey(): number {
        // routeX[0], never x>>7 — the fine coords freeze where the entity entered view (stale-tile rule).
        return (this.mapBuildBaseX + this.localPlayer.routeX[0]!) * 16384 + (this.mapBuildBaseZ + this.localPlayer.routeZ[0]!);
    }
    ackRefusalText(): string { return this.ackRefusal; }

    /**
     * "Could this op have been carried out by now?" — for an npc interaction, that means ADJACENT.
     *
     * ⛔ THIS IS WHAT KEEPS `ACK-NOACK-` TRUSTWORTHY. Without it, a bot chasing a wandering npc
     * (2-4 tiles, OPNPC3 re-sent at a tile the npc has already left) reports the SAME catastrophic name
     * as a bot whose packets are being thrown away by the engine — measured at 33 of 2,548 windows.
     * `false` here routes them to `ACK-UNREACHED-*`, which is counted and visible but does not wedge.
     *
     * Only consulted at a deadline, i.e. only on the rare tick a window is about to fail.
     */
    ackDeliverable(kind: AckKind, detail: number): boolean | undefined {
        if (kind !== AckKind.Pickpocket && kind !== AckKind.Attack && kind !== AckKind.TalkNpc) return undefined;
        const npc = this.npcs[detail];
        // ⛔ GONE FROM THE SCENE IS "NOT DELIVERABLE", NOT "NO OPINION". You cannot interact with an npc
        // that is not there, so those sends were never discarded — the target left. Returning
        // `undefined` here would let them fall through to ACK-NOACK as false positives.
        if (!npc) return false;
        const p = this.npcWorldTile(npc);
        const me = this.playerTile();
        // ⛔ CARDINAL, NOT CHEBYSHEV. A DIAGONALLY adjacent npc is 1 tile away by chebyshev and cannot
        // be interacted with — the same reach rule `adjacentToLoc` already encodes for locs. Counting a
        // diagonal as deliverable produced residual false ACK-NOACK-PICKPOCKETs.
        const d = Math.abs(p.x - me.x) + Math.abs(p.z - me.z);
        return d <= 1;
    }

    /**
     * THE LOUD, NAMED, GREPPABLE SIGNAL. This is the whole point: a supervisor greps `ACK-NOACK-` and
     * sends that were swallowed.
     *
     * ⛔ NEVER A SILENT RETRY. This method logs and sets a field; it does not re-send, back off, or
     * "fix" anything. Deciding what to do about a dropped interaction belongs to the brain that owns
     * the intent — an assertion layer that starts retrying is a second brain nobody wrote down.
     */
    ackReport(f: AckFailure): void {
        if (f.verdict === 'no_ack') {
            this.ackWedge = `ACK-NOACK-${f.name}`;
            console.error(`[ack] ${this.loginUser}: ⛔ ACK-NOACK-${f.name} — ${f.repeats} send${f.repeats === 1 ? '' : 's'} ` +
                `over ${f.ticks} ticks (from t${f.sentTick}) and the server NEVER answered: no message, no ` +
                `inventory/xp/varp/modal/position change. The op was DISCARDED, not refused — retrying cannot ` +
                `fix it. target=${f.detail}${f.detail2 ? `/${f.detail2}` : ''} at (${this.playerTile().x},${this.playerTile().z})` +
                this.ackNpcDetail(f));
        } else if (f.verdict === 'unknown') {
            this.ackWedge = `ACK-UNKNOWN-${f.name}`;
            console.error(`[ack] ${this.loginUser}: ⛔ ACK-UNKNOWN-${f.name} — cannot decide whether ${f.repeats} ` +
                `send${f.repeats === 1 ? '' : 's'} over ${f.ticks} ticks worked: the container this depends on has ` +
                `never been transmitted. Reporting UNKNOWN rather than guessing. target=${f.detail}`);
        } else if (f.verdict === 'unreached') {
            // ⛔ NOT A WEDGE, AND DEBUG-ONLY BY DEFAULT. This is a duty-cycle number ("the bot never got
            // close enough to act"), it is counted in `ack.unreached`, and on a healthy wandering-npc
            // ACK-NOACK channel worthless. Grep `ACK-UNREACHED-` with FB_DEBUG=1 when chasing duty cycle.
            if (this.debug) {
                console.log(`[ack] ${this.loginUser}: ACK-UNREACHED-${f.name} x${f.repeats} over ${f.ticks} ticks` +
                    this.ackNpcDetail(f));
            }
        } else if (this.debug || f.repeats > 3) {
            // 'refused' is the GOOD failure — the server answered. Only worth a line when it repeats.
            console.log(`[ack] ${this.loginUser}: ACK-REFUSED-${f.name} x${f.repeats} over ${f.ticks} ticks — ` +
                `"${f.text}" (target=${f.detail}). The packet arrived; the requirement was not met.`);
        }
    }

    // =============================================================================================
    // BRAIN LIVENESS — the watchdog for "the brain never sent anything at all"
    // =============================================================================================
    // ⛔ THE SHAPE THIS EXISTS FOR, AND WHY `wedged=` COULD NOT SEE IT. One account was kicked 14 times
    // on a server-side metronome — intervals mean 305.4s, sigma 1.4s, i.e. TIMEOUT_NO_RESPONSE (1000
    // ticks x 300ms) plus one 5s reporter bucket. It appeared ZERO times in the log while every other bot
    // logged ARRIVED. Its brain never entered a phase
    // and therefore never sent a byte, so the server timed it out, forever, on a perfect clock.
    //
    // Every instrument we had was blind to it:
    //   * `conn=50/50` — it kept reconnecting, so it was CONNECTED. Healthy.
    //   * `wedged=` — never fired: it detects a bot stuck against a NAMED obstacle mid-run, and this
    //     bot never started running. A watchdog that only watches things that have begun cannot see
    //     the one that never did.
    //
    // ⛔ AND THE PROCESS-LEVEL KEEPALIVE SWEEP MAKES THIS *MORE* URGENT, NOT LESS. The sweep
    // (leanclient.ts, LC_KEEPALIVE) stops the kick churn — which is exactly what made the fault
    // visible. It does NOT fix the broken brain. Left here, it would convert a visibly churning zombie
    // into a SILENT one: this project's "absence must never look like zero", introduced deliberately.
    // So the sweep's own counter becomes the detector.
    //
    // THE SIGNAL IS EXACT AND COSTS ONE INTEGER COMPARE. `keepalivesSent` increments ONLY when the
    // sweep found this client with no outbound bytes for KEEPALIVE_IDLE_MS (45s). A healthy brain
    // flushes every tick. So `keepalivesSent` climbing IS "this bot's brain is not sending" — there is
    // nothing to infer and no threshold to tune.
    /** '' when the brain is producing output; else 'BRAIN-NEVER-STARTED' or 'BRAIN-SILENT'. */
    brainWedge = '';
    /** Has the brain EVER put a byte on the wire? Distinguishes "never started" from "went quiet". */
    brainEverSent = false;
    /** Tick the brain went quiet, -1 when it is fine. */
    brainSilentSince = -1;
    private lastKeepalivesSeen = 0;
    private lastBrainSilentLogTick = -1_000_000;
    /** Consecutive ticks whose brain put ZERO bytes in `out`. The keepalive-independent arm. */
    silentTicks = 0;
    /**
     * Ticks of unbroken silence that raise the wedge WITHOUT the process keepalive sweep.
     *
     * ⛔ THIS ARM EXISTS BECAUSE THE OTHER ONE CAN BE TURNED OFF. The escalation below keys on
     * `keepalivesSent`, which only moves when leanclient's sweep is running — so `LC_KEEPALIVE=0`
     * silently disarms the ONE detector whose diagnosis is "this account is inert, restart it".
     * A tick count needs no cooperation from anything: the engine kicks at 1000 ticks of no response
     * (World.ts:132), so 200 is a 5x margin and still ~60s live — no legitimate brain is quiet that
     * long, because every waiting path in this file calls `warm()`.
     *
     * `FB_SILENT_TICKS=0` (or any value <= 0) disables this arm — for a PROBE that deliberately parks
     * its brain and drives the bot by hand. The sweep arm above is untouched by that.
     */
    silentTickLimit = Number(process.env.FB_SILENT_TICKS ?? 200);

    /** Did brain() itself put bytes in `out` on the tick just decoded? Set at the run() choke point,
     *  from a DELTA across brain(), so nothing else this tick (and above all the anti-kick warm below)
     *  can forge a liveness signal. */
    brainSentThisTick = false;

    /**
     * Consecutive silent brain ticks after which the tick loop sends a NO_TIMEOUT ITSELF.
     *
     * ⭐ THIS IS THE FLOOR UNDER THE WHOLE BUG CLASS. A branch that returns without sending is a bug in
     * that branch; a branch that returns without sending AND gets the account KICKED every 1000 ticks
     * (TIMEOUT_NO_RESPONSE, World.ts:132) is a bug that also destroys the evidence — the supervisor
     * rebuilds a fresh object, the same fixpoint reforms, and the log shows 14 reconnects and nothing
     * else. So the kick is removed STRUCTURALLY, at the one choke point, for every branch of every
     * brain including ones this file cannot see (a subclass override, a facade hold, a future one):
     * after `FB_SILENT_WARM` silent ticks the loop warms the link itself.
     *
     * ⛔ THIS DOES NOT MAKE THE BOT HEALTHY AND MUST NEVER BE MISTAKEN FOR IT. A warmed silent bot gets
     * exactly as much done as a kicked one: nothing. It is a floor that keeps the account ALIVE AND NAMED
     * so the wedge below can point at it, instead of losing it in reconnect churn. The wedge is raised BEFORE this ever fires and keeps escalating.
     *
     * 25 ticks is ~15s live: 40x inside the kick, and longer than any legitimate quiet gap (every
     * waiting path in this file already calls `warm()`, and the longest deliberate stand-down — the
     * 2-tick bank click gap — is an order of magnitude shorter). `FB_SILENT_WARM=0` disables it.
     */
    silentWarmAfter = Number(process.env.FB_SILENT_WARM ?? 25);
    silentWarms = 0;

    /**
     * ONE integer compare per tick, at the same choke point as the ack ledger.
     *
     * ⛔ MUST BE CALLED WHILE `this.out.pos` STILL HOLDS THIS TICK'S BYTES — i.e. BEFORE `flush()`.
     * `brainSentThisTick` (a delta measured across brain(), see run()) is the exact, zero-cost answer to
     * "did the brain do anything this tick?", and it needs no cooperation from any brain (which is the
     * point: the bug was that liveness depended on brain control flow via six hand-picked
     * `tickCount % 5` branches).
     */
    private checkBrainLiveness(): void {
        if (this.brainSentThisTick) {
            // The brain produced output this tick. That is the whole definition of alive.
            this.brainEverSent = true;
            this.silentTicks = 0;
            if (this.brainWedge) {
                console.log(`[fb] ${this.loginUser}: brain RESUMED sending after ${this.tickCount - this.brainSilentSince} ticks silent (was ${this.brainWedge})`);
                this.brainWedge = '';
                this.brainSilentSince = -1;
            }
            return;
        }
        this.silentTicks++;
        // TWO INDEPENDENT ARMS, ONE VERDICT. Either the process sweep had to step in (>=45s of wall
        // clock with no bytes), OR we have simply counted `silentTickLimit` consecutive silent ticks —
        // which needs no sweep, no timer and no cooperation, and is therefore the arm that still fires
        // under LC_KEEPALIVE=0. Whichever trips first raises the same wedge.
        const ka = this.keepalivesSent;
        const bySweep = ka > this.lastKeepalivesSeen;
        const byCount = this.silentTickLimit > 0
            && (this.silentTicks === this.silentTickLimit
                || (this.silentTicks > this.silentTickLimit && this.silentTicks % this.silentTickLimit === 0));
        // ⛔ THE WARM GOES *AFTER* THE COUNT AND *AFTER* THE WEDGE TEST, NEVER BEFORE. `silentTicks` was
        // already incremented from `brainSentThisTick`, which this write cannot touch, so the diagnosis
        // is taken from the brain's own behaviour and only THEN is the link kept alive. Reverse these
        // two and the detector acks itself — the failure mode this whole block exists to prevent.
        if (this.silentWarmAfter > 0 && this.silentTicks >= this.silentWarmAfter) {
            this.warm();
            this.silentWarms++;
        }
        if (!bySweep && !byCount) return;
        this.lastKeepalivesSeen = ka;
        if (this.brainSilentSince < 0) this.brainSilentSince = this.tickCount - this.silentTicks + 1;
        // NEVER STARTED is the strictly worse diagnosis and gets its own name: a bot that has produced
        // nothing since login is not stalled, it is inert, and it will never recover on its own.
        this.brainWedge = this.brainEverSent ? 'BRAIN-SILENT' : 'BRAIN-NEVER-STARTED';
        if (this.tickCount - this.lastBrainSilentLogTick >= 200) {
            this.lastBrainSilentLogTick = this.tickCount;
            const me = this.playerTile();
            console.error(`[fb] ${this.loginUser}: ⛔ ${this.brainWedge} — ` +
                (bySweep
                    ? `the process keepalive sweep has sent ${ka} NO_TIMEOUT(s) for this bot because its BRAIN sent nothing for 45s+. `
                    : `its BRAIN has put ZERO bytes on the wire for ${this.silentTicks} consecutive ticks ` +
                      `(limit ${this.silentTickLimit}; the engine kicks at 1000 — World.ts:132). `) +
                (this.brainEverSent
                    ? `It ran once and stopped (silent since t${this.brainSilentSince}).`
                    : `It has produced NOTHING since login — this is the inert-account shape: without the sweep the ` +
                      `server would kick it every 1000 ticks forever, and WITH the sweep it would sit here silently.`) +
                ` at (${me.x},${me.z}) tick ${this.tickCount} phase-bucket=${this.tickBucket}` +
                // NAME THE BRANCH, NOT JUST THE SYMPTOM. `tickBucket` is set by whichever brain branch
                // was reached, so it says WHERE the silence is; the sub-wedges say WHY when one applies.
                (this.dialogWedge || this.modalWedge ? ` sub-wedge=${this.dialogWedge || this.modalWedge}` : '') +
                (this.silentWarms > 0 ? ` (its own tick loop has sent ${this.silentWarms} anti-kick NO_TIMEOUT(s) — ` +
                    `it is ALIVE and DOING NOTHING, which is the point of this line)` : ''));
        }
    }

    /**
     * The ONE name a status line should show for "this bot is making no progress, and here is why".
     *
     * ⛔ ONE STRING, ONE ORDER, THREE DETECTORS. Each answers a strictly different question, and each
     * implies a DIFFERENT FIX — which is why they compose into a severity order here rather than
     * overwriting each other or all being reported at once (a bot carrying two competing wedge strings
     * would double-count in `wedgedBy` and send a supervisor after the wrong one):
     *
     *   1. brainWedge  "did we SEND anything?"        (out.pos, escalated by keepalivesSent)
     *                  BRAIN-NEVER-STARTED / BRAIN-SILENT.  FIX: restart this account.
     *   2. ackWedge    "did the server ANSWER our op?" (the interaction-ack ledger)
     *                  FIX: the op is being discarded — reposition, or the target data is wrong.
     *   3. STALL:<ph>  "did anything CHANGE?"          (xp / gp / position, phase-aware patience)
     *                  FIX: depends — it is the generic net that catches causes nobody has named yet.
     *
     * Most severe first: a bot that sends nothing at all cannot meaningfully also be "wedged on an
     * interaction", and a bot that is inert cannot meaningfully also be "not progressing" — that is implied.
     *
     * ⛔ THE STALL ARM IS WHAT COVERS `LC_KEEPALIVE=0`. The brain-liveness detector is escalated by
     * `keepalivesSent`, which never moves when the process sweep is disabled — so with the sweep off,
     * detector (1) is UN-ARMED. Detector (3) depends on nothing but the bot's own xp/gp/tile and fires
     * regardless, which is precisely why it is not redundant with (1) and why neither may be deleted.
     * (It is the weaker diagnosis: it says "no progress" without saying "inert", so it is ordered last.)
     */
    progressWedge(): string {
        // `tutorialWedge` sits beside brainWedge (not below ackWedge): like BRAIN-NEVER-STARTED it is a
        // "this bot is not doing its job at all" diagnosis with a specific, actionable fix (its logout
        // position is wrong / it is genuinely stranded on tutorial island), and it is raised at the one
        // branch that historically could not be seen at all.
        // `dialogWedge`/`modalWedge` sit with `tutorialWedge`, for the same reason and from the same
        // audit: each names a brain() branch that could historically return WITHOUT sending, WITHOUT
        // logging and WITHOUT changing state — a permanent silent fixpoint — and each now says so by
        // name with an actionable fix (the page/modal is not advancing; the bot has been force-freed and
        // is running the normal brain again). They rank ABOVE ackWedge because they answer "is this bot
        // doing its job at all", not "is one op being discarded".
        // `actionWedge` joins that group for the same reason: an in-flight async action PINS the brain
        // hook exactly as an open modal does (`driveAction()` takes the whole tick), so a hung one is a
        // "this bot is not doing its job at all" diagnosis with a specific fix — the action is awaiting
        // something unbounded — and not "one op is being discarded". See startAction()'s property (3).
        return this.brainWedge || this.tutorialWedge || this.dialogWedge || this.modalWedge
            || this.actionWedge || this.ackWedge || this.watchdog?.stalled?.name || '';
    }

    /**
     * Ticks after a death during which NOTHING is armed.
     *
     * ⛔ LIVE-DERIVED, NOT A HUNCH. A dead player's ops are ignored by the engine until the respawn
     * completes, so a brain that keeps interacting over its own corpse is, strictly, being silently
     * discarded — and the detector said so, six times in one 150s run, always exactly 3 ticks after a
     * `DIED (#n)` line. That is TRUE and USELESS: it is a known, self-clearing transient, and with many
     * bots it would bury the permanent faults this layer exists to surface. A signal that fires on the
     * ordinary is not a signal.
     */
    ackDeathBlackoutTicks = Number(process.env.FB_ACK_DEATH_BLACKOUT ?? 40);
    /** Tick until which arming is suppressed (post-death respawn). -1 = not blacked out. */
    protected ackBlackoutUntil = -1;

    /**
     * For the npc-targeted kinds, say WHERE the target is now.
     *
     * ⛔ A NAME WITHOUT A CAUSE IS HALF A SIGNAL. The first live run of this layer reported
     * `ACK-NOACK-PICKPOCKET target=2823` twelve times and there was no way to tell from the line
     * whether the op was being discarded (the bug this layer hunts) or whether the brain was simply
     * fixated on a man it could not get to (a duty-cycle problem, in a different file). The distance
     * answers that in the line itself. Computed ONLY on failure, so it costs nothing in steady state.
     */
    private ackNpcDetail(f: AckFailure): string {
        if (f.kind !== AckKind.Pickpocket && f.kind !== AckKind.Attack && f.kind !== AckKind.TalkNpc) return '';
        const npc = this.npcs[f.detail];
        if (!npc) return ' — the target is NO LONGER IN VIEW (it despawned or walked out of the scene)';
        const p = this.npcWorldTile(npc);
        const me = this.playerTile();
        const d = Math.max(Math.abs(p.x - me.x), Math.abs(p.z - me.z));
        return ` — target npc${f.detail} (type ${npc.typeId}) is at (${p.x},${p.z}), ${d} tile(s) away` +
            (d > 1 ? ' — NOT ADJACENT, so this is a REACH/duty-cycle problem, not a discarded packet' : '');
    }

    /** Arm an expectation. Thin wrapper so every call site reads the same and the ledger stays private. */
    protected expectAck(kind: AckKind, detail = 0, detail2 = 0,
        wantObj = 0, wantStat = -1, wantVarp = -1, wantValue = 0): void {
        if (this.tickCount < this.ackBlackoutUntil) return;
        this.ack.arm(this, kind, detail, detail2, wantObj, wantStat, wantVarp, wantValue);
    }

    // --- TICK-BUDGET instrumentation: attribute each tick to exactly ONE bucket ----------------------
    // The brain sets `tickBucket` at whatever decision it reaches this tick (firing / adjWait / chasing /
    // searching / banking / stalling / eating / stunned / traveling / respawn / other). It is counted ONCE per tick at the single choke point in run() (right after brain()), then
    // reset to 'other'. MECC by construction: exactly one set wins per tick, so the counts sum to ticks
    // and an unclassified tick shows up as 'other' rather than being silently dropped. Pure measurement —
    // setting the field has NO effect on behaviour.
    tickBucket = 'other';
    readonly tickBudget: Record<string, number> = {};

    // --- GENERIC PROGRESS WATCHDOG ------------------------------------------------------------------
    // ⛔ OPT-IN, AND IT DEFAULTS TO ON FOR EVERY BOT. `FB_WATCHDOG=0` turns it off for a probe that
    // legitimately does nothing for a long time. The instrument is 38ns/tick and the failure it catches
    // (a bot that stops making progress without any other signal) is otherwise invisible — so the
    // default is armed.
    //
    // NOTE the watchdog is fed at the SINGLE tick choke point in run(), never from a brain, so a
    // subclass cannot forget to wire it and there is exactly one definition of "a tick happened".
    watchdog: ProgressWatchdog | null =
        process.env.FB_WATCHDOG === '0' ? null : new ProgressWatchdog();

    // --- npc tracking (parallels the inherited player tracking) -------------
    npcs: (LeanNpc | null)[] = new Array(NPC_ARRAY).fill(null);
    npcCount = 0;
    npcIndices = new Int32Array(NPC_ARRAY);
    // ground items in view (from OBJ_ADD/REVEAL zone packets), keyed "wx,wz,obj" — the loot registry.
    groundItems = new Map<string, { x: number; z: number; obj: number; count: number; tick: number }>();

    // --- inventory tracking: comId -> { ids, counts } -----------------------
    invs = new Map<number, { ids: Int32Array; counts: Int32Array }>();

    // --- dialog / modal state ----------------------------------------------
    mainModalId = -1;
    chatModalId = -1;
    resumedDialog = false; // acted on the current dialog page already
    ifText = new Map<number, string>();
    /**
     * IF_SETCOLOUR observations, keyed by COMPONENT id -> the 15-bit wire colour. THE QUEST CHANNEL:
     * `questlist:<quest>` rows are coloured red/yellow/green on every login by ~update_questlist, and
     * that is the only quest state a client can see (see the IF_SETCOLOUR decode arm for why).
     *
     * ⛔ A COMPONENT THAT WAS NEVER SEEN IS ABSENT, NOT ZERO. That is why it is a Map: `questState()`
     * must be able to answer NOT_OBSERVABLE, and it cannot if absence renders as a colour.
     */
    ifColour = new Map<number, number>();
    /** IF_SETCOLOUR packets decoded. 0 after a completed login = the journal channel is not arriving. */
    ifColourUpdates = 0;

    // --- VARPS (P0-A) -------------------------------------------------------
    // The server's authoritative player-variable set. ONE array, not the browser client's two: see the
    // VARP_SYNC decode arm for why a non-predicting client needs no shadow copy.
    // Int32Array because VARP_LARGE carries a signed 32-bit value.
    varps = new Int32Array(MAX_VARP_ID + 1);
    /** ticks at which each varp last CHANGED — lets a caller wait for a confirm without polling state. */
    varpTick = new Int32Array(MAX_VARP_ID + 1).fill(-1);
    varpUpdates = 0;
    varpSyncs = 0;
    /** Optional hook: fired on every varp CHANGE (not every packet). Never throws into the decode loop. */
    onVarp: ((id: number, value: number, prev: number) => void) | null = null;

    /**
     * ⭐ THE AUTHORITATIVE LIVE LOC CHANNEL — opt-in, default null, zero behaviour change when unset.
     *
     * ⛔ WHY THIS HAD TO EXIST BEFORE ANY GATHERING BRAIN COULD WORK. `locScene` is the STATIC map
     * index: it knows where a tree was PLACED and can never know that the tree is a stump right now.
     * A chop brain built on it alone fixates — LIVE-CAUGHT on the first skill-lane run: the bot felled
     * the nearest tree, `findTree` kept returning that same coordinate because the static index still
     * had a tree there, and every subsequent OPLOC was DISCARDED by the server (`ACK-NOACK-OPLOC`, no
     * message, no refusal) for four minutes. The same shape applies to every depleting resource: rocks,
     * fishing spots, altars.
     *
     * The server already tells us. The zone stream carries the runtime loc changes verbatim, and
     * `DoorTracker` has been consuming exactly these two packets to authoritative effect since the
     * door-state work — it just filtered everything that was not a door. This hook is the same
     * channel, unfiltered:
     *   * `locId >= 0` — LOC_ADD_CHANGE: this tile now holds THAT loc (tree -> stump, rock -> depleted).
     *   * `locId === -1` — LOC_DEL: the runtime change was REMOVED, so the static map loc is back
     *     (stump -> tree, i.e. respawn). This is the restore signal; treating it as "the loc vanished"
     *     is the one misreading to avoid.
     *
     * COST WHEN UNSET: one null check per zone sub-message. It cannot throw into the decode loop — a
     * consumer's exception would desync the packet stream, which is the one failure a hook must not be
     * able to cause.
     */
    onLocZoneChange: ((level: number, x: number, z: number, locId: number, shape?: number, angle?: number) => void) | null = null;
    /** Zone UPDATE_ZONE_FULL_FOLLOWS: the server reset this 8x8 zone (SW tile zoneX,zoneZ on
     *  `level`) to the static map and re-sends only what differs, so every runtime loc change a consumer remembers there is
     *  stale (a trapdoor/door that reverted while we were out of view is never re-announced). Same signal DoorTracker.resetZone
     *  uses. Swallowed like onLocZoneChange. */
    onZoneReset: ((level: number, zoneX: number, zoneZ: number) => void) | null = null;
    protected fireZoneReset(level: number, zoneX: number, zoneZ: number): void {
        if (!this.onZoneReset) return;
        try { this.onZoneReset(level, zoneX, zoneZ); } catch (e) { this.locHookErrors++; console.error(`[fb] ${this.loginUser}: onZoneReset threw (swallowed): ${(e as Error)?.message ?? e}`); }
    }
    /** Exceptions swallowed out of `onLocZoneChange`. Non-zero means a consumer is broken. */
    locHookErrors = 0;
    private lastLocHookErrorSig = '';
    // protected: SpeedBot overrides it to keep liveLocs + leaf walls in step even when a consumer replaces
    // onLocZoneChange without passing every argument through.
    protected fireLocZoneChange(level: number, x: number, z: number, locId: number, shape?: number, angle?: number): void {
        if (!this.onLocZoneChange) return;
        try {
            this.onLocZoneChange(level, x, z, locId, shape, angle);
        } catch (e) {
            this.locHookErrors++;
            const err = e as Error;
            const sig = `${err?.name}:${err?.message}`;
            if (sig !== this.lastLocHookErrorSig) {
                this.lastLocHookErrorSig = sig;
                console.error(`[fb] ${this.loginUser}: ⛔ onLocZoneChange THREW (swallowed so the zone decode stays ` +
                    `aligned; error #${this.locHookErrors}):\n${err?.stack ?? String(e)}`);
            }
        }
    }

    // --- run energy (P1-H) --------------------------------------------------
    /** 0..100 percent, or -1 before the first UPDATE_RUNENERGY of the session. */
    runEnergy = -1;
    /** our own player slot from UPDATE_PID (-1 until it arrives): an npc whose FACE_ENTITY is selfPid + 32768 is targeting us. */
    selfPid = -1;

    // --- CHAT (parity package 4) --------------------------------------------
    // A 500-deep ring with the SDK's read surface. Populated from THREE wire paths, which is the
    // whole point — miss one and a bot is deaf in exactly the situation that matters:
    //   * the player-update CHAT mask (0x40)  -> someone within 14 tiles spoke (leanclient hook)
    //   * ServerProt.MESSAGE_PUBLIC  (255)    -> someone FURTHER than 14 tiles spoke (global fan-out)
    //   * ServerProt.MESSAGE_PRIVATE (235)    -> a PM
    // MESSAGE_GAME lands here too, as SDK type 0, so `getChat({types:[0]})` sees system lines.
    //
    // ⛔ THE RETENTION IS PER BOT, AND SYSTEM LINES ARE NOT RARE. The default 500 is SDK parity
    // (sdk/chat-history.ts CHAT_HISTORY_LIMIT), and for player chat that is free — our bots do not
    // talk. But MESSAGE_GAME fires on every steal/level/refusal, so a full ring is ~500 objects plus
    // their strings, call it ~100KB per bot, held forever. FB_CHAT_RING is the lever — lower it (e.g. 20)
    // when many bots share one process; leave it alone for a probe that reads history.
    readonly chatLog = new ChatLog(Number(process.env.FB_CHAT_RING ?? 500));
    /** Lines heard, by source. A deaf bot and a silent world look identical without this. */
    chatHeard = 0;
    chatPublicPackets = 0;
    chatPrivatePackets = 0;
    /** Public lines SENT (sendSay calls that actually wrote bytes). */
    chatSent = 0;
    /**
     * ⛔ OFF BY DEFAULT AND IT MUST STAY THAT WAY. The engine broadcasts every public line to EVERY
     * player outside the 14-tile bubble (MessagePublicHandler's `World.playerLoop.all()` fan-out) — so
     * with many bots in one process, logging every received line would turn one chatty stranger into
     * hundreds of log lines per tick. FB_CHAT_LOG=1 for a single-bot probe only. (This gates LOGGING
     * only; capture is always on and costs a decode of <=80 bytes on the rare tick a nearby player
     * actually speaks.)
     */
    chatLogging = process.env.FB_CHAT_LOG === '1';
    /** Tick of the last MESSAGE_PUBLIC we sent — the engine accepts ONE social packet per tick. */
    lastSayTick = -100;

    /**
     * The player-update CHAT (0x40) listener. LeanClient decodes the block (it has to — the decode is
     * inside a PRIVATE method there) and hands it here with the speaker's world INDEX.
     *
     * ⭐ THE NAME IS NOT IN THE PACKET. The mask carries colour/effect/rights/text and nothing else;
     * the real client resolves the sender from the cached appearance blob. So do we — from the SAME
     * `playerAppearanceBuffer` that `playerName()`/`findPlayerIndexByName()` (every lookup of a player by
     * name) already depend on. `LeanPlayer.name` is ALWAYS null headless (setAppearance is a stub), so reading that instead would make every message anonymous.
     */
    protected override onPlayerChat = (index: number, chat: ChatMaskUpdate): void => {
        const self = index === LOCAL_PLAYER_INDEX;
        const sender = self
            ? this.loginUser
            : (appearanceName(this.playerAppearanceBuffer[index]?.data) ?? '');
        this.recordChat({ type: chat.type, text: chat.text, sender, tick: this.tickCount, fromSelf: self });
    };

    /** Record one decoded line and (optionally) log it. The single funnel for all three wire paths. */
    private recordChat(m: ChatMessage): void {
        this.chatHeard++;
        this.chatLog.record(m);
        if (this.chatLogging) {
            console.log(`[fb] ${this.loginUser}: CHAT t${m.tick} type=${m.type} <${m.sender || '?'}> ${m.text}`);
        }
    }

    // --- tick waiters (sendWait) ------------------------------------------------------------------
    // Resolved from the ONE place tickCount advances (the PLAYER_INFO arm), never polled. Cleared on
    // LOGOUT so a reconnect cannot strand a caller awaiting a tick that will never come.
    private tickWaiters: Array<{ at: number; resolve: () => void }> = [];

    // --- rune exhaustion (P1-F) --------------------------------------------
    /** count of "You do not have enough X Runes" refusals — the caster's cantReachMsgs. */
    noRunesMsgs = 0;
    lastNoRunesTick = -1;
    /** which rune types the server has told us we are short of this session. */
    noRunesFor = new Set<string>();

    // --- skills / vitals ----------------------------------------------------
    hp = -1;        // current hitpoints (UPDATE_STAT stat=3 level field = CURRENT, drained by fails)
    maxHp = -1;     // base hitpoints
    hitpointsXp = 0;
    // General per-stat capture, indexed by RS stat id (attack 0, defence 1, strength 2, hitpoints 3,
    // ranged 4, prayer 5, magic 6, ... thieving 17, ... runecraft 20).
    statXp: number[] = new Array(25).fill(0);
    statLevel: number[] = new Array(25).fill(0);

    // --- death tracking (a death respawns the player at Lumbridge, 3221,3218) --
    deathCount = 0;

    // --- heal loop (eat food when HP low) -----------------------------------
    healThreshold = Number(process.env.FB_HEAL ?? 4); // eat when hp <= this
    healFrac = Number(process.env.FB_HEAL_FRAC ?? 0);
    foodObj = -1;           // obj id of food we carry (set per mode; -1 = no healing)
    lastEatTick = -100;
    /** The HP at or below which this bot eats — relative when healFrac is set, else absolute. */
    eatAtHp(): number {
        if (this.healFrac > 0 && this.maxHp > 0) return Math.max(2, Math.floor(this.maxHp * this.healFrac));
        return this.healThreshold;
    }

    // --- loot + bury (build-list item 1) ------------------------------------
    // OFF by default: every existing brain keeps its exact behaviour. The trainer turns it on.
    lootBury = false;
    /** Extra ground objs to take alongside bones (e.g. COINS_OBJ). */
    lootTypes = new Set<number>();
    lootRadius = 6;             // chebyshev tiles; a kill drops ON the npc's tile, so this is generous
    buryCadence = 3;            // ticks between OPHELD1 buries (bury is p_delay(0), lands in 1-2 ticks)
    bonesTaken = 0;             // counted from INVENTORY GROWTH, not from packets sent
    bonesBuried = 0;            // counted from PRAYER XP (the server's own ledger — see UPDATE_STAT)
    buryAttempts = 0;           // OPHELD1s sent; attempts >> buried means bones are being refused
    lootTaken = 0;              // non-bone piles taken (coins etc.)
    combatLockMsgs = 0;         // "Someone else is fighting that."  -> multiway hypothesis DEAD
    underAttackMsgs = 0;        // "I'm already under attack!"       -> same single-way lock block
    notAfterYouMsgs = 0;        // "It's not after you."             -> macro-event npc, NOT the lock
    cantReachMsgs = 0;          // "I can't reach that!"             -> naive self-route failed
    /** last HINT_ARROW tile (type 2..6; null after hint_stop / never) — e.g. the Agility Arena's flashing pillar */
    hintTile: { x: number; z: number; tick: number } | null = null;
    hintArrowPackets = 0;
    noAmmoMsgs = 0;             // "There is no ammo left in your quiver." -> wielding a bow with no arrows
    // OPNPC2s sent (re-issued every 8 ticks while a fight runs, so it is an ENGAGEMENT cadence, not a kill
    // count). ⛔ IT ANSWERS A QUESTION NO OTHER COUNTER CAN: bones=0 with attacks CLIMBING is "the harvest
    // is being lost" (npc_findhero gave the drop to someone else, or the loot step is broken); bones=0 with
    // attacks FLAT is "this bot is not fighting at all". The aggregate status could not tell those apart.
    attackOps = 0;
    /** hp-xp GRANT TICKS = swings the SERVER landed for us. The true duty cycle is
     *  `swingsLanded / (ticks / attackRateTicks)`; nothing else the client sees measures a swing. */
    swingsLanded = 0;
    /** hp lost, summed from every observed hp DROP. The retaliate-off arm's safety number. */
    damageTaken = 0;
    brainErrors = 0;
    private lastBrainErrorSig = '';
    // ------------------------------------------------------------------------------------------------
    // FIGHT UPTIME — the one number left, and no existing bucket can see it
    // ------------------------------------------------------------------------------------------------
    // ⛔ THE DEAD TIME IS SILENT. Across a 1,600-tick gap the server said NOTHING: no "already under
    // attack", no "can't reach", and `npc_is_attackable` almost always emits a `mes()`, so it is not that
    // either. The only silent no-swing exits in `player_melee.rs2` are `:8` (`%action_delay > map_clock` —
    // harmless cooldown) and `:13` (npc at 0 hp mid-death-animation). The server will never explain this
    // gap, so it has to be COUNTED client-side. Measured shape to separate: adjacent for 779 of 800 ticks
    // but in an armed fight for ~19% of them, with dead stretches of 36 and 188 ticks next to a live npc.
    /** ticks cardinally adjacent to the committed target (melee reach), whatever else was happening */
    adjacentTicks = 0;
    /** ticks where a swing landed within the last swing period = the fight was demonstrably ARMED.
     *  `armedTicks / adjacentTicks` IS fight uptime — the whole remaining prize in one ratio. */
    armedTicks = 0;
    /** attack ops that produced NO hp xp inside `opArmWindow` ticks: the fight never armed.
     *  ⛔ THE PAIR THAT MATTERS: this vs the gap histogram separates "cooldown not yet clear" (harmless,
     *  gaps land on multiples of the 4-tick attackrate) from "the op did nothing" (the 6x). It is also the
     *  general form of chicken-kingdom-of-misthalin's 445-ops/0-swings: the extreme of the same stall. */
    attackOpsNoSwing = 0;
    /** ticks after an op within which a landed swing counts as "it armed" (2 swing periods, minus jitter) */
    opArmWindow = Number(process.env.FB_OP_ARM_WINDOW ?? 6);
    private pendingOpTick = -1;
    private pendingOpAdjacent = false;
    /** attack ops sent while still walking to the target — approach noise, NOT a failure to engage */
    opsWhileApproaching = 0;
    /** MOVEs suppressed because their destination was our own tile (each one would arm AllowRepath.NONE) */
    selfTileMovesSuppressed = 0;
    targetClaims: TargetClaimRegistry | null = null;
    pickerClaims = process.env.FB_PICKER === '1';
    /**
     * ⛔ THE DEFECT, COUNTED IN BOTH ARMS. Incremented whenever the OLD hash pick would have committed to a
     * spawn FURTHER away than the nearest FREE one — i.e. whenever the old algorithm chose to walk past a
     * spawn nobody was holding. Counted even when the picker is disabled, so the control arm reports what it
     * is losing instead of the improvement being assumed.
     */
    walkedPastCloserFree = 0;
    /** tiles of avoidable approach the picker saved (or, disabled, would have saved) */
    tilesSavedByPicker = 0;
    /** commitments where EVERY visible spawn was already claimed, so it fell back to the hash pick */
    pickerFallbacks = 0;
    // ------------------------------------------------------------------------------------------------
    // CHURN vs STALL vs DISTANCE — three counters that discriminate every remaining hypothesis, with no A/B
    // ------------------------------------------------------------------------------------------------
    // The magnitude bound is what makes these decisive: **97.3 approach ticks per kill against 3-9 ticks of
    // actual walking distance** (~90 ticks/kill unexplained), and r²=0.055 for every distance measure the
    // camp agent could construct. So:
    //   tilesMovedDuringApproach ≈ approachTicks, but ≫ direct distance  ⇒ CHURN (walk-abandon-walk)
    //   tilesMovedDuringApproach ≪ approachTicks                        ⇒ STALL (the engine is not moving us)
    //   a few LONG commitments rather than many short ones               ⇒ distance after all
    /** tiles actually walked on ticks charged to `approach` */
    tilesMovedDuringApproach = 0;
    /** approach ticks charged to the CURRENT commitment (bucketed into approachPerCommitment when it ends) */
    private approachTicksThisCommit = 0;
    /** histogram of approach ticks per target commitment — a fat tail of SHORT ones is churn */
    approachPerCommitment: Record<string, number> = {};
    /** target commitments made (a new npc committed to) */
    commitments = 0;
    /** commitments that ended with the target GONE after we had landed a swing on it = a kill we shared in */
    targetKills = 0;
    private lastApproachTileKey = '';
    /**
     * TICKS BETWEEN LANDED SWINGS, bucketed. Multiples of 4 are the weapon cadence (4 = hit, 8 = one miss,
     * 12 = two): 96-100% of gaps landing there is what proved the cadence lever EXHAUSTED. Anything else —
     * and especially the long tail — is the silent stall, and its shape per camp is the diagnosis.
     */
    swingGaps: Record<string, number> = {};
    private lastSwingTick = -1;
    /**
     * Bucket a swing gap, in BRAIN ticks.
     *
     * ⛔ THE FIRST VERSION OF THIS WAS AN ARTEFACT GENERATOR. It demanded EXACT multiples of 4 and dumped
     * everything else into `off-cadence` — and live that bucket read **42%**, which would have been read as
     * "the weapon cadence is broken". But UPDATE_STAT is written after the PLAYER_INFO the brain ticks on,
     * so a grant is visible one tick late *sometimes*: a true 4-4-4 cadence measured with ±1 tick of packet
     * jitter produces 3s and 5s, and an exact-multiple test calls half of them anomalous.
     * So: keep the RAW gap for every small value (1-16) and let the READER decide what counts as cadence
     * (the reporter treats within ±1 of a multiple of 4 as on-cadence). Storage stays honest; interpretation
     * is separate and auditable.
     */
    private bucketGap(gap: number): string {
        if (gap <= 0) return 'other';
        if (gap <= 16) return String(gap);                 // RAW: 3/4/5 are the jittered weapon cadence
        if (gap <= 31) return '17-31';
        if (gap <= 63) return '32-63';
        if (gap <= 127) return '64-127';
        return '128+';                                     // dead stretches: 188-tick gaps were observed
    }
    // ------------------------------------------------------------------------------------------------
    // AUTO-RETALIATE — the one button that hijacks every fight
    // ------------------------------------------------------------------------------------------------
    // ⛔ ON BY DEFAULT FOR EVERY BOT (varp 172). On EVERY incoming melee hit `npc_combat_melee.rs2:48`
    // queues `playerhit_n_retaliate`, and `auto_retaliate.rs2:3-22` — gated only on
    // `%option_nodef = ^player_auto_retaliate_on` — then (a) refreshes `%action_delay` by a FLINCH of
    // `attackrate/2` and (b) RETARGETS us onto whoever just hit us via `p_opnpc(2)`, discarding the target
    // the brain chose. `player_melee.rs2:8` then returns WITHOUT swinging. So our swing cadence is set by
    // the INCOMING HIT RATE, not by our own weapon — which is exactly why bots at strength 21 and at strength 52
    // both measured ~930 dmg/hr/bot, an invariance nobody could explain.
    //
    // `[if_button,controls:com_3]` = component 151 turns it OFF (150 turns it back on). One packet, once,
    // after login. Behind an env flag so it can be one arm of a clean A/B comparison.
    //
    // ⚠ SAFETY: with it off the bot does NOT fight back automatically. `damageTaken`/`deaths` are the
    // numbers that must be watched, and the heal path is what makes it survivable.
    static readonly RETALIATE_OFF_BUTTON = 151;
    static readonly RETALIATE_ON_BUTTON = 150;
    retaliateOff = process.env.FB_RETAL_OFF === '1';
    /** set once the button has actually been sent, so it is exactly one packet per session */
    retaliateOffSent = false;
    /** A/B arm label for the reporter ('' = not in an experiment) */
    armLabel = '';
    /** IN-REACH abandon: ticks of no hp xp while ADJACENT before the commitment is dropped */
    targetAbandonTicks = Number(process.env.FB_TARGET_ABANDON ?? 10);
    /**
     * APPROACH TIMEOUT — ticks spent NOT YET IN REACH before a commitment is abandoned, unconditionally.
     *
     * ⛔ THIS TIMER'S ABSENCE COST A 50x THROUGHPUT COLLAPSE. Gating the single no-xp timer on adjacency
     * removed the only escape from a doomed approach: a bot walking toward a target it could not reach never
     * abandoned it. Settled window: 251,141 approach ticks across 152 commitments = **1,650 ticks per
     * commitment**, `adj` 432 ticks out of ~299,000, duty 0.2%, 116 swings. Two timers are needed, not one:
     * "never abandon a target you have already walked to" is about the IN-REACH timer, and says nothing about
     * how long an APPROACH may last.
     * 50 ticks is generous against reality (median walked distance at these camps is 6-9 tiles ⇒ 6-18 ticks
     * of running) and still 30x tighter than the 1,650 observed.
     */
    approachTimeoutTicks = Number(process.env.FB_APPROACH_TIMEOUT ?? 50);
    /**
     * STALL GUARD — ticks of approach with ZERO tiles walked before abandoning immediately.
     * Needs no timeout: standing still while committed and out of reach IS the stall shape (0.02 tiles/tick
     * live), and waiting out a 50-tick clock to discover it is 50 wasted ticks.
     */
    stallGuardTicks = Number(process.env.FB_STALL_GUARD ?? 12);
    /** commitments dropped by the approach timeout (never arrived) */
    approachTimeouts = 0;
    /** commitments dropped by the stall guard (committed, out of reach, and NOT MOVING) */
    stallAbandons = 0;
    /** tiles walked during the CURRENT commitment — the stall guard's evidence */
    private tilesThisCommit = 0;
    private lastCommitTileKey = '';
    /**
     * ⛔ CLEAR THE PER-COMMITMENT CLOCKS ON EVERY ABANDON — and force the next pick to register as a NEW
     * commitment. SIM-CAUGHT LIVELOCK: with only one npc in view the re-pick chooses the SAME index, so the
     * "commitment changed" block never ran, the clocks kept their expired values, and the stall guard fired
     * again on the very next tick — 7 abandons in 14 ticks. Resetting `targetCommitIdx` is what makes the
     * re-commit a real one (and keeps `commitments` honest).
     */
    private resetCommitClocks(): void {
        this.approachTicksThisCommit = 0;
        this.tilesThisCommit = 0;
        this.lastCommitTileKey = '';
        this.targetCommitIdx = -1;
    }
    /** ticks a target's TILE may sit unchanged while paying nothing before it is treated as unhittable.
     *  20 = 5 swing periods, so a miss streak at hitChance 67% survives it ~99.6% of the time. */
    targetStaleTicks = Number(process.env.FB_TARGET_STALE ?? 20);
    /**
     * ⛔ DEFAULT **OFF**. The honest history of this switch, because it is a lesson:
     *   1. built on a mechanism that turned out to be FALSE (`getNpcPos` rebuilds npcIndices every cycle, so
     *      a corpse cannot be iterated) — RETRACTED;
     *   2. kept anyway on the strength of "it fired ZERO times in 269,706 live bot-ticks" — and that
     *      evidence is now void: the next build fired it **158 times**, which a widened window cannot
     *      explain, so the zero was most likely measured on a build that did not contain the guard;
     *   3. and the cost of a WRONG drop is now known to land on the DOMINANT bucket: `approach` is 57% of
     *      all ticks, so a dropped commitment buys another walk.
     * A guard with a retracted mechanism, void evidence and a cost that lands on the dominant term does not
     * get to stay on by default. `FB_CORPSE_DROP=1` re-enables it; it now records adjacency and per-target
     * productivity on every drop, so an opt-in run produces a verdict rather than another argument.
     */
    corpseDropEnabled = process.env.FB_CORPSE_DROP === '1';
    /** targets dropped as unhittable. ⛔ A CLIMBING NUMBER IS A MEASUREMENT TO EXPLAIN, not a fix to ship. */
    corpseDrops = 0;
    /** of those, how many were dropped while IN REACH (the walk was already paid for) */
    corpseDropsAdjacent = 0;
    /** of those, how many had already landed a swing on that target (the harmful case) */
    corpseDropsAfterSwing = 0;
    /** targets abandoned by the no-xp timer while in reach (the benign case: adjacent and not paying) */
    targetAbandonsAdjacent = 0;
    /** has the CURRENT committed target ever paid us a swing? Reset on every re-commit. */
    private targetHasSwung = false;
    private targetCommitIdx = -1;
    private lastTargetTileKey = '';
    private lastTargetMoveTick = -1000;
    /** hp xp within this many ticks == the server's own `p_opnpc(2)` loop is still running our fight */
    fightAliveTicks = Number(process.env.FB_FIGHT_ALIVE ?? 6);
    private lastSentTargetIdx = -1;
    private lastBonesHeld = 0;
    private lastTakeTick = -100;
    private lastBuryTick = -100;
    private lootTries = new Map<string, number>();   // "x,z,obj" -> attempts (blacklist after N)
    private lootSkip = new Map<string, number>();    // "x,z,obj" -> tick the blacklist expires
    private prayerBaselined = false;

    // --- brain bookkeeping --------------------------------------------------
    acceptedTick = -1;
    lastActionTick = -100;
    lastGuideTalkTick = -100;
    /** Tick we FIRST looked for the RuneScape Guide inside the tutorial box and found nothing; -1 = we
     *  can see one (or we are not on the island). Drives the TUTORIAL-NO-GUIDE bail-out in brain(). */
    noGuideSince = -1;
    tutorialWedge = '';

    // --- THE DIALOG / MODAL FIXPOINT GUARDS ---------------------------------------------------------
    // ⛔ THREE brain() branches used to be able to return WITHOUT SENDING, WITHOUT LOGGING and WITHOUT
    // CHANGING STATE — the exact shape that made a bot sit inert for 75 minutes and eat 14 kicks:
    //   (b)  `driveDialog()`'s `if (this.resumedDialog) return;`  — a dialog page that never advances
    //   (b3) `handleMainModal()` returning true while sending nothing — a modal a subclass claims and
    //        then does nothing with (the shape of ~30 `return true` sites across 7 brains)
    //   (c)  the dismiss-unknown-modal branch — a modal the server will not close
    // Each is now bounded IN TICKS and each ends in a NAMED wedge on progressWedge(). A tick budget is
    // the right instrument rather than a boolean: it fails SAFE (it expires by itself), it cannot be
    // left latched by a caller that threw, and it turns "forever" into a number you can print.
    /** 'DIALOG-STUCK-<modal>' while a chat page has stopped advancing; '' when healthy. */
    dialogWedge = '';
    /** 'MODAL-HELD-IDLE-<id>' / 'MODAL-STUCK-<id>' while a main modal is wedged; '' when healthy. */
    modalWedge = '';
    /** Tick `driveDialog` last ACTED on the open page (sent a click/resume). -1 = never. */
    private dialogActedTick = -1;
    /** Times we have re-driven the CURRENT page. Reset by every page change (see the decode arms). */
    private dialogRedrives = 0;
    /** Ticks to wait for the server to answer a dialog action before re-driving the same page. A page
     *  normally advances within a tick or two; 10 is generous and still 100x inside the idle kick. */
    dialogRedriveTicks = Number(process.env.FB_DIALOG_REDRIVE ?? 10);
    /** Re-drives before we give up, name DIALOG-STUCK and force the page closed. */
    dialogMaxRedrives = Number(process.env.FB_DIALOG_REDRIVES ?? 5);
    /** The reason string of the brain branch currently producing nothing, and how long it has. See
     *  spendIdleTick(): a per-BRANCH count, separate from `silentTicks`, because the anti-kick warm this
     *  path issues would ack the whole-brain counter and blind it. */
    private branchIdleReason = '';
    private branchIdleTicks = 0;
    /** Consecutive ticks branch (c) has been trying to dismiss the same main modal. */
    private modalDismissTicks = 0;
    private modalDismissId = -1;
    /** Silent claimed-modal ticks before MODAL-HELD-IDLE. A bank run clicks every 2 ticks and a smith
     *  every 3, so 60 is ~20 missed clicks — far past "slow" and squarely at "nothing is happening". */
    modalIdleLimit = Number(process.env.FB_MODAL_IDLE ?? 60);

    // --- PUBLIC MODAL / DIALOG LEASES (facade support) ----------------------------------------------
    /**
     * Hold the main modal open until this TICK. brain() branch (c) stands down while `tickCount` is
     * below it, so a wrapper (bot-facade.ts's `openBank`/`openShop`) can own a bank/shop window without
     * subclassing. -1 = never held, which reproduces the previous behaviour byte for byte.
     *
     * ⛔ A TICK LEASE, NOT A BOOLEAN, AND THAT IS THE WHOLE POINT. A boolean set by a caller that then
     * throws mid-bank leaves the bot holding a modal open FOREVER — a brand-new instance of the exact
     * bug class this file's audit was about. A lease expires whether or not anybody remembers to clear
     * it, so the worst case is bounded by the number the caller chose.
     */
    holdModalUntil = -1;
    /** Same contract for the chat dialog: brain() branch (b) leaves the page alone until this tick, so
     *  `talkTo`/`navigateDialog` can read and answer it instead of racing the option-1 auto-driver. */
    holdDialogUntil = -1;
    /** Take (or extend) a modal lease. Ticks, from now. `releaseModal()` ends it early. */
    leaseModal(ticks: number): void { this.holdModalUntil = this.tickCount + Math.max(0, ticks); }
    leaseDialog(ticks: number): void { this.holdDialogUntil = this.tickCount + Math.max(0, ticks); }
    releaseModal(): void { this.holdModalUntil = -1; }
    releaseDialog(): void { this.holdDialogUntil = -1; }
    /** True while either lease is live. Read by the two brain branches; also useful in a status line. */
    modalLeased(): boolean { return this.tickCount < this.holdModalUntil; }
    dialogLeased(): boolean { return this.tickCount < this.holdDialogUntil; }

    /** Tick until which the player is stunned (set from the "stunned" game message, e.g. a failed
     *  pickpocket stuns for 8 ticks per pickpocket.dbrow). The server ignores ops until then. */
    stunnedUntil = -1;

    // --- brain mode + waypoint travel ---------------------------------------
    /**
     * What the brain does once no dialog/modal/tutorial step is pending:
     *   'idle'   — nothing; scripts drive the bot through the async actions (the idle tick keeps the
     *              link warm through `idleTick()`).
     *   'travel' — walk to `travelDest` / the multi-level goal while `arrived` is false, then idle.
     *   'combat' — travel when `arrived` is false, otherwise run doCombat().
     * Travel runs in every mode except 'idle' while `arrived` is false (startMultiTravel clears it).
     */
    mode: 'idle' | 'travel' | 'combat' = 'idle';
    // Latched true the first time we leave the tutorial-island box. South-map destinations (the
    // wizard tower @ z~3162, anywhere south of Lumbridge) would otherwise be mistaken for the island
    // and re-trigger "talk to the guide" every tick, wedging travel. Once the island is left the
    // account never legitimately returns to it, so this latch suppresses the tutorial branch.
    leftTutorial = false;
    arrived = false;
    travelDest = { x: GOBLIN_SPOT.x, z: GOBLIN_SPOT.z };
    travelPath: { x: number; z: number }[] | null = null;
    travelIdx = 0;
    travelStartTick = -1;
    travelStartMs = -1;
    lastTravelMoveTick = -100;
    travelPrevTile = '';
    travelStallTicks = 0;
    travelSuppressMoveUntil = 0;               // hold MOVEs while an OPLOC door-open resolves
    private travelDoorTried = new Map<string, number>(); // "x,z" -> tick of last open attempt
    // WEDGE-DOOR state (travelUnwedge rung 2). Tries per door edge ("level,x,z" -> count + last tick), and
    // the door edges masked out of re-planning after they would not open ("level,x,z" -> door + expiry).
    #twDoorTries = new Map<string, { n: number; tick: number }>();
    #twMaskedDoors = new Map<string, { door: DoorInfo; until: number }>();

    // --- TRAVEL WEDGE WATCHDOG + STRATUM ESCAPE ---------------------------------------------------
    // ⛔ THESE ARE `#`-PRIVATE, AND THAT IS THE POINT, NOT A STYLE CHOICE. The wedge this machinery
    // exists to break was CAUSED by a subclass re-declaring `travelPrevTile` and `travelStallTicks`
    // in its own file: at runtime a subclass field of the same name IS this field, so the
    // subclass's own watchdog wrote the tile key every tick BEFORE doTravel compared it, the stall
    // counter never reset, and the repair — and its MOVE — fired every tick forever. TypeScript did
    // say so (TS4114 x2), buried in the tree's 690 standing errors. A `#`-private field cannot be
    // shadowed by any subclass in any language-level way, so this class of fault cannot recur here.
    // Read them through `travelWedgeInfo()`.
    #twKey = '';                 // "x,z#idx": tile AND waypoint cursor — progress is either one moving
    #twSince = -1;               // tick #twKey last changed
    #twSteps = 0;                // escalation rung reached in the current wedge
    #twActTick = -1e9;           // tick an escalation rung last acted (the rung cooldown)
    #twReplanTick = -1e9;        // tick of the last FULL re-plan (the CPU / MOVE brake)
    #twLogTick = -1e9;           // last "ladder exhausted" line
    #twSideIdx = 0;              // sidestep direction cursor
    #seTarget: ClimbExit | null = null;   // the exit currently being climbed
    #seTries = 0;                // exits given up on (bounds the whole escape)
    #seStartTick = -1e9;         // tick this exit was acquired
    #seOpTick = -1e9;            // last OPLOC at this exit
    #seBlacklist = new Set<string>();     // exits that did not land us on the surface
    #seLogTick = -1e9;           // last "sealed pocket" line
    #seNoExitTick = -1e9;        // last scan that found no reachable exit (rescan cooldown)
    arrivedTick = -1;
    // synchronous long-path fn, injected before run() so brain() never awaits.
    findLongPathFn: ((level: number, sx: number, sz: number, dx: number, dz: number) => { x: number; z: number }[]) | null = null;
    // MULTI-LEVEL travel planner (injected; default null = single-level travel only, behaviour
    // unchanged). Returns a leg plan: walk `waypoints`, then CLIMB `portal` (OPLOC its locId/op ->
    // telejump), repeat. sdk/navgrid/levels.planMultiLevel — decoupled via injection so base LeanBot
    // never imports the portal graph.
    // 3rd arg (TELEPORTS): `{ teleports: caps }` ONLY when teleports are enabled for this bot — otherwise the
    // call is the old 2-arg one, so every existing planner binding (and its plans) is unchanged.
    multiLevelPlanFn: ((from: MlCoord, to: MlCoord, opts?: { teleports?: MlTeleportCaps; transports?: MlTransportCaps }) => MlLeg[] | null) | null = null;
    // TRANSPORT SWITCH (NAV PHASE 1, opt-in; read at every plan): true = pass this bot's caps (items, coins, agility,
    // woodcutting, axe) so the planner may use transports.json edges (ships, the Brimhaven dungeon fee + obstacles, the
    // Taverley dusty-key gate). null/false = the old call, unchanged plans. mlTransportOpts.deny drops edges by id.
    mlTransports: boolean | null = null;
    mlTransportOpts: Partial<MlTransportCaps> = {};
    private mlNpcDone = false; private mlNpcOps = 0; private mlStandTile = ''; private mlStandMoveTick = 0;
    // TELEPORT SWITCH (hot-swappable: read at every plan). true/false = explicit; null = follow env FB_TELEPORTS=1.
    mlTeleports: boolean | null = null;
    // Caller-declared quest completions (the gating varps are NOT transmitted to the client).
    mlTeleportQuests: MlTeleportCaps['quests'] = {};
    // Extra planner knobs merged into the caps (members/fromUnderground/costTiles/minSaveTiles/only).
    mlTeleportOpts: Partial<MlTeleportCaps> = {};
    readonly mlTeleDropped = new Set<string>();   // teleports refused/failed THIS SESSION — never planned again
    // DOOR-STATE TRACKER (null = off). When set, the base packet loop
    // decodes zone LOC_ADD_CHANGE/LOC_DEL and feeds it live door open/closed state read from the SERVER,
    // and the follower SKIPS open doors (never closes one) + PROACTIVELY opens closed ones on the path.
    doorTracker: DoorTracker | null = null;
    private zoneBaseX = 0; private zoneBaseZ = 0;
    // Turn on door-state tracking: seed every known door as closed (map-placed state), then let the wire
    // correct it live. Call once after construction on any bot that travels through doors.
    enableDoorTracker(): void {
        const t = new DoorTracker();
        for (const d of DOORS) if (isDoorLoc(d.locId)) t.seed(d.level, d.x, d.z, d.locId);   // per-level seed
        this.doorTracker = t;
    }
    travelLevel = 0;                       // plane for findLongPathFn in doTravel (0 = surface/underground)
    private mlGoal: MlCoord | null = null;
    private mlPlan: MlLeg[] | null = null;
    private mlLegIdx = 0; private mlLegLevel = 0; private mlClimbing = false; private lastMlOplocTick = -100;
    private mlClimbStartTick = -100;   // when the current climb began (bail-out if the telejump never lands)
    // Reposition-recovery state (see the MOVEMENT gate in mlDrive). `mlRepoStall` counts consecutive
    // reposition ticks with no tile change; `mlRepoExtended` is the ONE latched bail-out extension.
    private mlRepoPrevTile = ''; private mlRepoStall = 0; private mlRepoExtended = false;
    /** per-climb reposition stand for a multi-tile loc (sideApproachTile; undefined = not chosen yet, null = none) */
    private mlRepoTarget: { x: number; z: number } | null | undefined = undefined;
    private mlForceCommit = false;     // stall-repair -> mlDrive handoff: walking wedged at the leg end, commit the op
    // Teleport-leg state: null = not casting. `casts` bounds the retries; `rubTick` = OPHELD4 sent, awaiting the choice.
    private mlTele: { startTick: number; castTick: number; casts: number; rubTick: number; chose: boolean; from: { x: number; z: number; level: number } } | null = null;
    // Start a cross-stratum journey to (level,x,z). No-op degrade to single-level if no planner/route.
    startMultiTravel(level: number, x: number, z: number): void {
        this.mlGoal = { level, x, z }; this.mlPlan = null; this.mlLegIdx = 0; this.mlClimbing = false; this.mlForceCommit = false; this.mlTele = null;
        this.mlRepoStall = 0; this.mlRepoPrevTile = ''; this.mlRepoExtended = false; this.mlRepoTarget = undefined;   // per-climb reposition state
        this.arrived = false; this.travelPath = null;
    }
    get multiTravelDone(): boolean { return this.mlGoal === null && this.arrived; }

    private invForInventory(): { ids: Int32Array; counts: Int32Array } | undefined {
        return this.invs.get(INV_INTERFACE);
    }

    private coinsIn(inv: { ids: Int32Array; counts: Int32Array }): number {
        let t = 0;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === COINS_OBJ) t += inv.counts[i];
        return t;
    }

    coins(): number {
        // Coins only ever land in the main backpack; the bank inv (which starts
        // with 25 coins) is never transmitted because we never open a bank.
        let total = 0;
        const inv = this.invForInventory();
        if (inv) {
            for (let i = 0; i < inv.ids.length; i++) {
                if (inv.ids[i] === COINS_OBJ) total += inv.counts[i];
            }
            return total;
        }
        // fallback: sum across every transmitted inv
        for (const v of this.invs.values()) {
            for (let i = 0; i < v.ids.length; i++) {
                if (v.ids[i] === COINS_OBJ) total += v.counts[i];
            }
        }
        return total;
    }

    private ensureInv(comId: number, minSize: number): { ids: Int32Array; counts: Int32Array } {
        let inv = this.invs.get(comId);
        if (!inv || inv.ids.length < minSize) {
            const ids = new Int32Array(Math.max(minSize, 44));
            const counts = new Int32Array(Math.max(minSize, 44));
            if (inv) {
                ids.set(inv.ids);
                counts.set(inv.counts);
            }
            inv = { ids, counts };
            this.invs.set(comId, inv);
        }
        return inv;
    }

    // ========================================================================
    // decode loop (overrides LeanClient.run — same framing, more opcodes)
    // ========================================================================
    override async run(maxTicks: number): Promise<void> {
        this.out = Packet.alloc(1);
        this.out.random = this.outIsaac; // p1Enc encrypts opcodes with outgoing ISAAC

        for (;;) {
            const rawOpcode = await this.readByte();
            const opcode = (rawOpcode - this.inIsaac.nextInt) & 0xff;

            let psize = ServerProtSizes[opcode];
            if (psize === -1) {
                psize = await this.readByte();
            } else if (psize === -2) {
                const hi = await this.readByte();
                const lo = await this.readByte();
                psize = (hi << 8) | lo;
            }

            if (psize > 0) {
                await this.readBody(psize);
            }
            this.in.pos = 0;

            switch (opcode) {
                case ServerProt.LOGOUT:
                    // A kick and a clean logout are byte-identical on the wire, and a DUPLICATE LOGIN
                    // is answered with a kick of the incumbent (World.ts:865) — so this is the packet a
                    // self-inflicted login war arrives as. It used to `return` (which RESOLVES run(), so
                    // the supervisor's .catch never fired) and record nothing: 3,953 kicks in one night,
                    // invisible. Still resolve — every other caller depends on that — but say why.
                    // The publish ack. See LeanClient.serverLogoutAt for why this is a different fact
                    // from `lastDropReason` and why a lane's wind-down waits for THIS one.
                    this.serverLogoutAt = Date.now();
                    this.lastDropReason = 'server LOGOUT (kick or idle-logout)';
                    if (!this.quiet) console.log('[fb] server sent LOGOUT');
                    // ⛔ STRANDED AWAITERS. A 30s waitForChat / a sendWait parked on a tick that will
                    // never arrive keeps the supervisor's reconnect path waiting on a dead session (and
                    // holds the event loop for its full timeout). Settle them all before we resolve.
                    this.releaseAwaiters();
                    return;

                case ServerProt.REBUILD_NORMAL: {
                    const zoneX = this.in.g2();
                    const zoneZ = this.in.g2();
                    const oldBaseX = this.mapBuildBaseX;
                    const oldBaseZ = this.mapBuildBaseZ;
                    this.mapBuildCentreZoneX = zoneX;
                    this.mapBuildCentreZoneZ = zoneZ;
                    this.mapBuildBaseX = (zoneX - 6) * 8;
                    this.mapBuildBaseZ = (zoneZ - 6) * 8;
                    // Rebase every tracked entity to the new scene origin, as the real
                    // client does (Client.ts REBUILD_NORMAL rebases routeX/routeZ and
                    // fine x/z for all npcs + players). Without this, a walk-driven
                    // rebuild leaves routes in OLD-base coords: position becomes
                    // fiction offset by the base delta, MOVE start tiles go wrong,
                    // and the server silently ignores all movement (travel desync).
                    // First rebuild after login (base 0,0) is reset by the login
                    // teleport instead.
                    if (oldBaseX !== 0 || oldBaseZ !== 0) {
                        const dx = oldBaseX - this.mapBuildBaseX;
                        const dz = oldBaseZ - this.mapBuildBaseZ;
                        if (dx !== 0 || dz !== 0) {
                            for (const p of this.players) {
                                if (!p) continue;
                                for (let i = 0; i < p.routeX.length; i++) {
                                    p.routeX[i] += dx;
                                    p.routeZ[i] += dz;
                                }
                                p.x += dx * 128;
                                p.z += dz * 128;
                            }
                            for (const n of this.npcs) {
                                if (!n) continue;
                                for (let i = 0; i < n.routeX.length; i++) {
                                    n.routeX[i] += dx;
                                    n.routeZ[i] += dz;
                                }
                                n.x += dx * 128;
                                n.z += dz * 128;
                            }
                        }
                    }
                    break;
                }

                case ServerProt.PLAYER_INFO: {
                    this.loopCycle++;
                    try {
                        this.getPlayerPos(this.in, psize);
                    } catch (e) {
                        console.error(`[fb] DESYNC PLAYER_INFO (psize=${psize}):`, (e as Error).stack ?? (e as Error).message);
                        this.dumpHex(this.in.data, psize);
                        throw e;
                    }
                    this.tickCount++;
                    // offline sim (engine SIM_LOCKSTEP=1): tell the engine we are done with this tick — after the
                    // settle window and after the brain's own sends (setImmediate x2), so actions land on the next cycle
                    // and only once every controller this tick woke (a sendWait that resolved) has parked again on a
                    // ack sent before it decides makes its ops land a tick late. Bounded by SIM_ACK_WAIT_MS.
                    if (SIM_LOCKSTEP) {
                        this.simHold = true; this.simDue = 0; this.simNew = 0;
                        if (SIM_BARRIER) simBots.add(this);
                        const t0 = Date.now(), tick = this.tickCount;
                        const p0 = SIM_PROF ? performance.now() : 0;
                        const ack = () => {
                            if ((this as any).disposed || this.tickCount !== tick) return;
                            if (this.simNew < this.simDue && Date.now() - t0 < SIM_ACK_WAIT_MS) { if (SIM_PROF) simProfRetry++; retry(); return; }
                            if (SIM_DET && simLoginGate.n > 0 && Date.now() - t0 < 4000) { setTimeout(ack, 1); return; }   // SIM_DET login gate (leanclient.ts)
                            if (SIM_BARRIER && simBots.size > 1 && !simAllParked() && Date.now() - t0 < SIM_ACK_WAIT_MS) { if (SIM_PROF) simProfRetry++; retry(); return; }   // ack barrier
                            if (SIM_PROF) simProfAck(performance.now() - p0, this.simNew < this.simDue || (SIM_BARRIER && simBots.size > 1 && !simAllParked()));
                            if (SIM_PROF && process.env.SIM_PROF_CAP && Date.now() - t0 >= SIM_ACK_WAIT_MS) console.log(`[simprof-cap] t${this.tickCount} ${this.loginUser} due ${this.simDue} new ${this.simNew} gate ${simLoginGate.n} ${Date.now() - t0} ms`);
                            this.out.p1Enc(Out.NO_TIMEOUT); this.simAcking = true;
                            try { this.flush(); } catch { /* socket gone */ } finally { this.simAcking = false; }
                        };
                        const retry = (): void => { if (SIM_FAST_IMM && Date.now() - t0 < 2) setImmediate(ack); else setTimeout(ack, 0); };
                        if (SIM_FAST_IMM) setImmediate(() => setImmediate(() => setImmediate(ack)));
                        else setTimeout(() => setImmediate(() => setImmediate(ack)), SIM_SETTLE_MS + 1);
                    }
                    this.doorTracker?.setTick(this.tickCount);
                    if (this.acctDirty) this.snapshotAccount();   // flush a throttled stat change (account ledger)
                    // ---- GROUND-ITEM SWEEP -------------------------------------------------------------
                    // ⛔ groundItems ONLY EVER SHRANK INSIDE A READER. Eviction lived in findGroundItem()
                    // and tryTakeLoot(), so a bot whose brain never looks at loot — which is most bots —
                    // grew the map without bound for its entire uptime. OBJ_ADD fires for
                    // every pile ANY player drops in view; only an OBJ_DEL actually witnessed in view
                    // removes one, and a bot that walks away never witnesses it. A long-haul traveller
                    // accumulates tens of thousands of dead records, each an object plus its string key.
                    //
                    // WHAT PROVES IT SAFE: this evicts on the EXACT predicate both readers already apply
                    // (`tickCount - g.tick > 300`), and nothing ever refreshes `tick` in place — only
                    // OBJ_ADD/OBJ_REVEAL write one and those replace the whole record. So every entry
                    // dropped here is one both readers would have skipped AND deleted themselves on their
                    // next scan; a looting brain sees identical answers. Deleting during iteration is what those readers already do.
                    // Every 256 ticks (~2.5 min) keeps the O(size) walk amortised to nothing; bots log
                    // in staggered so their tickCounts are offset and the sweeps do not all land at once.
                    if ((this.tickCount & 255) === 0 && this.groundItems.size > 0) {
                        for (const [key, g] of this.groundItems) {
                            if (this.tickCount - g.tick > 300) this.groundItems.delete(key);
                        }
                    }
                    if (this.tickWaiters.length > 0) this.wakeTickWaiters();
                    // ⛔ MEASURE THE BRAIN, NOT THE SOCKET. `brainSentThisTick` is the DELTA across
                    // brain() alone, which is a strictly sharper answer to "did the brain do anything?"
                    // than `out.pos > 0` (that also counts a byte written by anything else this tick) —
                    // and it is REQUIRED, not merely nicer, now that checkBrainLiveness() warms a
                    // provably-silent brain to keep it off the kick metronome: with a raw `out.pos`
                    // read, the anti-kick warm would ACK ITSELF and the detector would go blind on the
                    // very fault it exists to catch. See checkBrainLiveness().
                    const outPosBeforeBrain = this.out.pos;
                    try {
                        this.brain();
                    } catch (e) {
                        // ⛔ THE STACK, NOT THE MESSAGE. This catch is what keeps one bad tick from killing a
                        // whole process — which is also what makes it a perfect hiding place: the bot keeps
                        // decoding, its connection stays healthy, and the brain silently does NOTHING every
                        // tick. A one-line `e.message` does not say WHERE. Example: a TDZ crash
                        // (`Cannot access 'x' before initialization`) thrown every tick inside the combat
                        // brain — `tsc` cannot catch a TDZ, it is a runtime error.
                        // A message alone names the symptom; only the stack names the line. Print it once per
                        // distinct error so a per-tick throw cannot flood the log it needs to be visible in.
                        const err = e as Error;
                        const sig = `${err?.name}:${err?.message}`;
                        this.brainErrors++;
                        if (sig !== this.lastBrainErrorSig) {
                            this.lastBrainErrorSig = sig;
                            console.error(`[fb] ${this.loginUser}: ⛔ BRAIN THREW (tick ${this.tickCount}, ` +
                                `error #${this.brainErrors}) — the bot will keep decoding and do NOTHING each ` +
                                `tick while conn= looks perfect:\n${err?.stack ?? String(e)}`);
                        } else if (this.brainErrors % 500 === 0) {
                            console.error(`[fb] ${this.loginUser}: ⛔ BRAIN STILL THROWING (${this.brainErrors}x): ${sig}`);
                        }
                    }
                    // ⛔ A THROWN BRAIN IS A SILENT BRAIN. The catch above keeps the bot decoding, which
                    // is exactly why the throw hides — so the throw must feed the SAME liveness signal a
                    // silent branch does, or a per-tick TDZ crash reads as "healthy, just idle".
                    this.brainSentThisTick = this.out.pos > outPosBeforeBrain;
                    // ---- INTERACTION ACKNOWLEDGMENT (parity package 3) --------------------------------
                    // ONE pass over the preallocated per-kind records, AFTER brain() so an expectation
                    // armed this tick is measured from this tick. It cannot throw into the loop, it
                    // cannot block, and it never sends — see interaction-ack.ts's wedge-proof note.
                    if (ACK_ENABLED) {
                        // Bun.nanoseconds(), not process.hrtime.bigint(): the latter allocated TWO heap
                        // BigInts per tick per bot (plus a third for the subtraction) purely to feed a
                        // number counter, on a 600ms tick, for instrumentation nobody reads per-tick. Same nanosecond unit and
                        // same monotonic base, so `ackEvalNs` keeps its exact meaning; leanclient.ts:129
                        // already uses this call for the keepalive sweep timing.
                        const t0 = Bun.nanoseconds();
                        try { this.ack.evaluate(this); } catch (e) {
                            // An assertion layer that can kill a bot is worse than no assertion layer.
                            console.error(`[ack] ${this.loginUser}: assertion layer threw (disabled for this bot): ${(e as Error).message}`);
                            this.ack.reset();
                        }
                        this.ackEvalNs += Bun.nanoseconds() - t0;
                        this.ackEvalCalls++;
                        // MIRROR, DO NOT INVENT: `ackWedge` is exactly the ledger's live wedge state, so
                        // it clears the moment the failing kind acknowledges again. A wedge that
                        // survives its own cause is a tombstone, and a tombstone in a status line is a
                        // supervisor chasing a fault that fixed itself an hour ago.
                        if (this.ackWedge !== this.ack.wedge) this.ackWedge = this.ack.wedge;
                    }
                    // ---- BRAIN LIVENESS ---------------------------------------------------------------
                    // ⛔ BEFORE flush(), WHILE `out.pos` STILL HOLDS THIS TICK'S BYTES — after the flush
                    // `pos` is 0 for every bot and the signal is destroyed. This is the COMPLEMENT of the
                    // progress watchdog below, not a duplicate of it: that one asks "did anything change?"
                    // (xp/gp/position), this one asks "did we SEND anything?". A bot whose brain never
                    // entered a phase produces neither, but only the second question distinguishes an
                    // inert bot from one that is merely between rewards — and only the second one has a
                    // fix that is "restart this account", not "wait longer". See checkBrainLiveness().
                    this.checkBrainLiveness();
                    if (process.env.FB_RECORD) this.recordTick();
                    // ---- PROGRESS WATCHDOG (generic stall detector) -----------------------------------
                    // ⛔ HERE, AT THE ONE CHOKE POINT, AND BEFORE tickBucket IS RESET. The bucket the brain
                    // just reached IS the phase, and the phase is what selects the patience — read it a
                    // line later and every stall would be attributed to 'other'.
                    //
                    // 38ns/call measured (`bun headless/progress-watchdog.ts --bench`); `xp`/`gp` are
                    // already-computed fields and the tile read is two array indexes. Nothing here allocates unless a stall is RAISED.
                    if (this.watchdog) {
                        const wt = this.playerTile();
                        const st = this.watchdog.observe(this.tickCount, {
                            xp: this.totalXp(), gp: this.coins(), x: wt.x, z: wt.z, phase: this.tickBucket,
                        });
                        if (st && st.ticks === st.patience) {
                            console.error(`[fb] ${this.loginUser}: ${st.note}`);
                        }
                    }
                    // Count THIS tick against whatever bucket the brain reached, then reset. One count
                    // per tick, so the budget sums to ticks; an unclassified tick lands in 'other'.
                    this.tickBudget[this.tickBucket] = (this.tickBudget[this.tickBucket] ?? 0) + 1;
                    this.tickBucket = 'other';
                    this.flush();
                    if (!this.quiet && this.tickCount % 3 === 0) this.status();
                    if (this.tickCount >= maxTicks) {
                        if (!this.quiet) console.log(`[fb] reached ${maxTicks} ticks, stopping.`);
                        return;
                    }
                    break;
                }

                case ServerProt.NPC_INFO: {
                    try {
                        this.getNpcPos(this.in, psize);
                    } catch (e) {
                        console.error(`[fb] DESYNC NPC_INFO (psize=${psize}):`, (e as Error).stack ?? (e as Error).message);
                        this.dumpHex(this.in.data, psize);
                        throw e;
                    }
                    break;
                }

                // ---- ZONE UPDATES -> door tracker (no-op unless doorTracker is set) --------------------
                // FOLLOWS: the zone sub-messages arrive as SUBSEQUENT top-level packets (set the base,
                // then LOC_ADD_CHANGE/LOC_DEL land as their own cases below). ENCLOSED: sub-messages are
                // inline in this packet. Byte-exact decode, so alignment is safe.
                case ServerProt.UPDATE_ZONE_PARTIAL_FOLLOWS: { this.zoneBaseX = this.in.g1(); this.zoneBaseZ = this.in.g1(); break; }
                // FULL = "this zone is back to the static map; only what differs follows" — reset the
                // tracker's doors in it to their map state, or a door that reverted while we were away
                // (another plane, out of view) stays believed-OPEN forever (DoorTracker.resetZone).
                case ServerProt.UPDATE_ZONE_FULL_FOLLOWS: {
                    this.zoneBaseX = this.in.g1(); this.zoneBaseZ = this.in.g1();
                    this.doorTracker?.resetZone(this.minusedlevel, this.mapBuildBaseX + this.zoneBaseX, this.mapBuildBaseZ + this.zoneBaseZ);
                    if (this.doorTracker) clearLiveLeavesInZone(this.minusedlevel, this.mapBuildBaseX + this.zoneBaseX, this.mapBuildBaseZ + this.zoneBaseZ);
                    this.fireZoneReset(this.minusedlevel, this.mapBuildBaseX + this.zoneBaseX, this.mapBuildBaseZ + this.zoneBaseZ);
                    break;
                }
                case ServerProt.UPDATE_ZONE_PARTIAL_ENCLOSED: {
                    this.zoneBaseX = this.in.g1(); this.zoneBaseZ = this.in.g1();
                    while (this.in.pos < psize) { const sub = this.in.g1(); this.decodeZoneOp(sub); }
                    break;
                }
                case ServerProt.LOC_ADD_CHANGE: case ServerProt.LOC_DEL: this.decodeZoneOp(opcode); break;
                // ⛔ These four used to be decoded ONLY inside the ENCLOSED branch, so every
                // STANDALONE (…_FOLLOWS) obj event was silently discarded — and the killer's OWN drop
                // arrives as exactly that: a player-scoped OBJ_ADD following an
                // UPDATE_ZONE_PARTIAL_FOLLOWS, ~100 ticks BEFORE the shared ENCLOSED OBJ_REVEAL. So a
                // LeanBot-derived looter could not see its own kill's bones at all; it would have waited
                // out the whole private window and then "worked", looking merely slow.
                case ServerProt.OBJ_ADD: case ServerProt.OBJ_DEL:
                case ServerProt.OBJ_REVEAL: case ServerProt.OBJ_COUNT: this.decodeZoneOp(opcode); break;

                case ServerProt.UPDATE_INV_FULL: {
                    const comId = this.in.g2();
                    const size = this.in.g2();   // rev 289: p2 (was p1 @274)
                    const inv = this.ensureInv(comId, size);
                    for (let i = 0; i < size; i++) {
                        inv.ids[i] = this.in.g2() - 1; // server sends obj.id+1 (0 = empty)
                        let count = this.in.g1();
                        if (count === 255) count = this.in.g4();
                        inv.counts[i] = count;
                    }
                    for (let i = size; i < inv.ids.length; i++) {
                        inv.ids[i] = 0;
                        inv.counts[i] = 0;
                    }
                    // ACK OBSERVABLE (parity package 3): three integer bumps, no scan, no allocation.
                    this.ackRevs[Rev.AnyInv]!++;
                    if (comId === INV_INTERFACE) this.ackRevs[Rev.Inv]!++;
                    else if (comId === WORN_INTERFACE) this.ackRevs[Rev.Worn]!++;
                    if (this.debug) console.log(`[fb] INV_FULL com=${comId} size=${size} coins=${this.coinsIn(inv)}`);
                    if (comId === 5382) this.snapshotVault();   // client-side resource ledger (see snapshotVault)
                    // A wear only COUNTS when the server moves the obj into the worn inv. Counting the
                    // OPHELD2 we sent instead would count every silent refusal as a success.
                    if (comId === WORN_INTERFACE && this.gearMode) this.noteGearWorn();
                    break;
                }

                case ServerProt.UPDATE_INV_PARTIAL: {
                    const comId = this.in.g2();
                    let inv = this.ensureInv(comId, 44);
                    while (this.in.pos < psize) {
                        const slot = this.in.gsmart();   // rev 289: psmart (was p1 @274)
                        const id = this.in.g2() - 1; // server sends obj.id+1 (0 = empty)
                        let count = this.in.g1();
                        if (count === 255) count = this.in.g4();
                        // max-QP session 8 (glory audit 'LOST 1' in qt26/qt35 = a glory_3 deposited into a NEW bank slot was
                        // never seen): INV_FULL sizes the inv to the slots it sent (the bank: used slots only), so a partial
                        // update for the next free slot fell outside and was DROPPED. Grow to fit (bank <= 288 slots).
                        if (slot >= inv.ids.length && slot < 1024) inv = this.ensureInv(comId, slot + 1);
                        if (slot >= 0 && slot < inv.ids.length) {
                            inv.ids[slot] = id;
                            inv.counts[slot] = count;
                        }
                    }
                    this.ackRevs[Rev.AnyInv]!++;
                    if (comId === INV_INTERFACE) this.ackRevs[Rev.Inv]!++;
                    else if (comId === WORN_INTERFACE) this.ackRevs[Rev.Worn]!++;
                    if (this.debug) console.log(`[fb] INV_PARTIAL com=${comId} coins=${this.coinsIn(inv)}`);
                    if (comId === 5382) this.snapshotVault();   // deposits stream in as PARTIAL updates
                    if (comId === WORN_INTERFACE && this.gearMode) this.noteGearWorn();
                    break;
                }

                case ServerProt.UPDATE_STAT: {
                    const stat = this.in.g1();
                    const xp = this.in.g4();
                    const level = this.in.g1();
                    this.ackRevs[Rev.Stat]!++;
                    // BURY COUNTING FROM THE SERVER'S OWN LEDGER. Counting the OPHELD1 packets we SEND
                    // would count refusals as successes (a noted bone or a full-slot timing clash sends the same
                    // bytes and grants nothing). `bury_bone.rs2:15` is the ONLY thing that advances prayer
                    // xp for a bot that does not pray, and it grants exactly once per bury — so a prayer-xp
                    // rise IS a bury.
                    // Gated on having seen the login baseline, else the first UPDATE_STAT reads as a bury.
                    if (stat === PRAYER_STAT) {
                        if (this.prayerBaselined && xp > this.statXp[stat]!) this.bonesBuried++;
                        this.prayerBaselined = true;
                    }
                    if (stat >= 0 && stat < this.statXp.length) {
                        this.statXp[stat] = xp;
                        this.statLevel[stat] = level;
                        this.snapshotAccount();   // account ledger: stats (see snapshotAccount)
                    }
                    if (stat === HP_STAT) {
                        // The `level` field is the CURRENT (drained) hitpoints — NOT the base level
                        // (UpdateStatEncoder.ts:12 says so in a comment). The base level comes from xp.
                        // ⛔ CREDIT THE SWING HERE, NOT IN doCombat. The brain early-returns on eating,
                        // gearing, looting, burying and travel — and an hp-xp grant that lands on one of
                        // those ticks was being collapsed into the next credited one, MERGING gaps and
                        // under-counting swings (sim-caught: swingsLanded stayed 0 while xp was flowing).
                        // The decode path sees every grant exactly once, whatever the brain is doing.
                        if (this.lastHpXpVal >= 0 && xp !== this.lastHpXpVal) {
                            if (this.lastSwingTick >= 0) {
                                const k = this.bucketGap(this.tickCount - this.lastSwingTick);
                                this.swingGaps[k] = (this.swingGaps[k] ?? 0) + 1;
                            }
                            this.lastSwingTick = this.tickCount;
                            this.lastHpXpGainTick = this.tickCount;
                            this.swingsLanded++;
                        }
                        if (this.lastHpXpVal < 0) this.lastHpXpVal = xp;   // baseline, never a swing
                        // DAMAGE TAKEN, from hp DROPS. ⛔ REQUIRED BY THE RETALIATE-OFF EXPERIMENT: with
                        // auto-retaliate off a bot does NOT fight back on its own, so "are we being eaten?"
                        // stops being a rhetorical question. A drop is only counted when it is a real
                        // decrease (a heal or a respawn is an increase) and only after a baseline exists.
                        if (this.hp >= 0 && level < this.hp) this.damageTaken += this.hp - level;
                        this.hp = level;
                        this.hitpointsXp = xp;
                        this.lastHpXpVal = xp;            // the swing ledger is settled above
                        // ⛔ WAS `if (this.maxHp < level) this.maxHp = level;` — "the most hp I've ever
                        // seen", which reads 1 for a bot that logs in at 1/25 and silently destroys the
                        // relative food threshold that depends on it (live-caught on the pilot probe).
                        this.maxHp = Math.max(levelForDisplayedXp(xp), level);
                    }
                    break;
                }

                // ---- VARPS (P0-A) ---------------------------------------------------------------
                // The server's authoritative player-variable channel, and the ONLY readback there is for
                // prayer state and the selected attack style. Sizes/layout from the engine's own
                // encoders (VarpSmallEncoder p2+p1, VarpLargeEncoder p2+p4) and re-checked against the
                // browser client's decode (Client.ts:9118-9158): VARP_SMALL reads the value SIGNED
                // (`g1b`), VARP_LARGE signed 32-bit (`g4`). Getting the signedness wrong would not
                // desync — it would silently mis-read every negative varp, which is worse.
                case ServerProt.VARP_SMALL: {
                    const id = this.in.g2();
                    const value = this.in.g1b();
                    this.setVarp(id, value);
                    this.ackRevs[Rev.Varp]!++;
                    break;
                }
                case ServerProt.VARP_LARGE: {
                    const id = this.in.g2();
                    const value = this.in.g4();
                    this.setVarp(id, value);
                    this.ackRevs[Rev.Varp]!++;
                    break;
                }
                // VARP_SYNC (190, size 0) — the engine calls it RESET_CLIENT_VARCACHE. The browser client
                // keeps TWO arrays (`var` predicted, `varServ` authoritative) and this packet copies
                // server->predicted after a client-side prediction. A headless bot NEVER predicts a varp
                // (nothing here writes one speculatively), so our single array is already the
                // authoritative set and this is a no-op. It is decoded explicitly rather than left to the
                // default arm so the intent is on the record and the zero-length read is deliberate.
                case ServerProt.VARP_SYNC:
                    this.varpSyncs++;
                    break;

                // ---- RUN ENERGY (P1-H) ----------------------------------------------------------
                // UpdateRunEnergyEncoder.ts sends `(energy / 100) | 0` — the engine holds 0..10000
                // internally and the wire carries 0..100, i.e. a PERCENTAGE, unsigned (Client.ts:8834
                // reads g1). This package only records it; no travel behaviour reads it yet (see the
                // follow-up note in the report).
                case ServerProt.UPDATE_RUNENERGY: {
                    this.runEnergy = this.in.g1();
                    break;
                }

                // ---- OUR OWN PLAYER SLOT (Client.ts UPDATE_PID: g2 slot, g1 members) -------------------
                case ServerProt.UPDATE_PID: {
                    this.selfPid = this.in.g2();
                    this.in.g1();
                    break;
                }

                case ServerProt.IF_OPENMAIN: {
                    this.mainModalId = this.in.g2();
                    this.ackRevs[Rev.Modal]!++;
                    if (this.debug) console.log(`[fb] MODAL open=${this.mainModalId} t${this.tickCount}`);
                    this.chatModalId = -1;
                    this.onDialogPageChanged();   // resumedDialog + the fixpoint guard (re-drive budget)
                    break;
                }

                case ServerProt.IF_OPENMAIN_SIDE: {
                    this.mainModalId = this.in.g2();
                    this.ackRevs[Rev.Modal]!++;
                    this.in.g2(); // sideComId (ignored)
                    if (this.debug) console.log(`[fb] MODAL open_side=${this.mainModalId} t${this.tickCount}`);
                    this.chatModalId = -1;
                    this.onDialogPageChanged();   // resumedDialog + the fixpoint guard (re-drive budget)
                    break;
                }

                case ServerProt.IF_OPENCHAT: {
                    this.chatModalId = this.in.g2();
                    this.ackRevs[Rev.Modal]!++;
                    this.onDialogPageChanged();   // resumedDialog + the fixpoint guard (re-drive budget)
                    break;
                }

                case ServerProt.IF_CLOSE: {
                    if (this.debug && this.mainModalId !== -1) {
                        console.log(`[fb] MODAL close (was ${this.mainModalId}) t${this.tickCount}`);
                    }
                    this.mainModalId = -1;
                    this.chatModalId = -1;
                    this.ackRevs[Rev.Modal]!++;
                    this.onDialogPageChanged();   // resumedDialog + the fixpoint guard (re-drive budget)
                    break;
                }

                case ServerProt.P_COUNTDIALOG: {   // 210, size 0 — the bank's Withdraw-X/
                    // Deposit-X amount prompt. The engine suspends the bank script in COUNTDIALOG until
                    // RESUME_P_COUNTDIALOG arrives, and DROPS a reply sent before this packet
                    // (ResumePCountDialogHandler.ts:10-13) — so callers wait on this flag first.
                    this.countDialogTick = this.tickCount;
                    this.ackRevs[Rev.CountDlg]!++;
                    break;
                }

                case ServerProt.IF_SETTEXT: {
                    const comId = this.in.g2();
                    const text = this.in.gjstr();
                    this.ifText.set(comId, text);
                    break;
                }

                // ---- IF_SETCOLOUR (183, size 4) — THE QUEST CHANNEL --------------------------------
                // `p2(component) p2(colour)` (IfSetColourEncoder.ts:9-12), the colour already pushed
                // through ColorConversion.rgb24to15 (5 bits/channel).
                //
                // ⛔ THIS IS THE ONLY WAY A CLIENT CAN SEE QUEST STATE. Of the 61 quests with a progress
                // varp, exactly ONE transmits (Player.ts:515-521 skips every !type.transmit entry at the
                // login dump), so getVarp reads 0 forever for the other 60 — and 0 is also the real
                // "not started" value, i.e. indistinguishable. But login.rs2:96 -> ~update_questlist
                // (quests.rs2:254) sends a journal COLOUR for ALL 63 on EVERY login, before the bot has
                // moved: red 31744 = not started, yellow 32736 = in progress, green 992 = complete.
                // Decoding it takes 62 quests from NOT_OBSERVABLE to answerable and closes 32 of the 43
                // varps that gate a loc in obstacles.json (quest-state.ts JOURNAL_OBSERVABLE_GATING_VARPS).
                //
                // ⛔ NEVER DEFAULT AN ENTRY TO 0. An unobserved component must stay ABSENT from the map —
                // a Map, not an array — or "never seen" acquires a fourth meaning that decodes as one of
                // the three. quest-state.questStateFromColour returns NOT_OBSERVABLE for anything that is
                // not exactly one of the three known colours, which is the correct answer, and it can
                // only do that if absence is representable.
                //
                // Cost: two g2() reads on a packet that arrives ~63 times per LOGIN and then only when a
                // quest advances. It is not on any hot path.
                case ServerProt.IF_SETCOLOUR: {
                    const comId = this.in.g2();
                    const colour = this.in.g2();
                    this.ifColour.set(comId, colour);
                    this.ifColourUpdates++;
                    break;
                }

                case ServerProt.MESSAGE_GAME: {
                    const text = this.in.gjstr();
                    if (text && process.env.FB_RECORD && this.recentMsgs.length < 20) this.recentMsgs.push(text);
                    if (text) {
                        // ---- ACK OBSERVABLES (parity package 3) ------------------------------------
                        // Rev.Msg = "the server said SOMETHING", which is the difference between an op
                        // that was refused and an op that was DISCARDED. The refusal classification is
                        // gated on a window actually being open, so the substring scan costs nothing on
                        // the overwhelming majority of ticks (no interaction pending -> no scan).
                        this.ackRevs[Rev.Msg]!++;
                        if (ACK_ENABLED && this.ack.anyActive()) {
                            const lower = text.toLowerCase();
                            if (isRefusal(lower)) { this.ackRefusal = text; this.ackRevs[Rev.Refusal]!++; }
                        }
                        // Stun (a failed pickpocket stuns for 8 ticks, pickpocket.dbrow): the server
                        // ignores ops until it wears off, so record when that is.
                        if (text.includes('stunned')) this.stunnedUntil = this.tickCount + 9;
                        // Mining: the server ANSWERS a poke at an empty rock — rotation can be
                        // message-driven instead of waiting out a dwell timer (miners were standing
                        // idle at spent rocks for 50 ticks each).
                        if (text.includes('currently available in this rock')) this.lastNoOreTick = this.tickCount;
                        // ⭐ THE MULTIWAY EXPERIMENT'S INSTRUMENT. Both single-way combat locks live inside
                        // `if (map_multiway(npc_coord) = false)` (player_combat.rs2:95 and :125), so in a
                        // multiway zone these must NEVER appear. A non-zero count is the hypothesis dying,
                        // and it decides whether bots need target allocation at all — so it is counted,
                        // not inferred. ("It's not after you." is OUTSIDE the guard: it is a macro-event
                        // ownership message, so it is counted SEPARATELY and does not falsify multiway.)
                        if (text.includes('Someone else is fighting that')) this.combatLockMsgs++;
                        else if (text.includes("I'm already under attack")) this.underAttackMsgs++;
                        else if (text.includes("It's not after you")) this.notAfterYouMsgs++;
                        // OPOBJ/OPLOC self-route naively — an unreachable pile answers with this. Counted so
                        // a loot loop that is quietly failing looks different from one with nothing to take.
                        else if (text.includes("can't reach that")) this.cantReachMsgs++;
                        // EMPTY QUIVER: a bot that ran out of arrows while still wielding its bow "attacks" forever —
                        // ranged.rs2 answers every swing with this and nothing happens. Counted so melee brains can unwield.
                        else if (text.includes('no ammo left in your quiver')) this.noAmmoMsgs++;
                        // ⭐ RUNE EXHAUSTION (P1-F). magic.rs2:35/39/43 answers a cast with too few runes
                        // with `You do not have enough <Rune> Runes to cast this spell.` and returns
                        // false — the cast NEVER HAPPENS. Without this the caster looks perfectly healthy:
                        // it keeps sending OPNPCT every 5 ticks, the server keeps refusing, magic xp stays
                        // flat, and the connection looks healthy the whole time. Exactly the cantReachMsgs failure
                        // class, and it needs exactly the same instrument. The rune NAME is interpolated
                        // (`string_removeright(oc_name($rune), 5)` strips the "rune" suffix), so match the
                        // invariant prefix+suffix and keep the name for the log line.
                        if (text.startsWith(NO_RUNES_MESSAGE.prefix) && text.endsWith(NO_RUNES_MESSAGE.suffix)) {
                            const rune = text.slice(NO_RUNES_MESSAGE.prefix.length, text.length - NO_RUNES_MESSAGE.suffix.length).trim();
                            this.noRunesMsgs++;
                            this.lastNoRunesTick = this.tickCount;
                            if (rune) this.noRunesFor.add(rune);
                            if (this.noRunesMsgs === 1 || this.noRunesMsgs % 25 === 0) {
                                console.log(`[fb] ${this.loginUser}: OUT OF ${rune.toUpperCase()} RUNES — the cast was REFUSED ` +
                                    `(#${this.noRunesMsgs}); a caster that ignores this burns ticks forever and earns 0 magic xp`);
                            }
                        }
                        // Death: "Oh dear you are dead!" — respawn at Lumbridge.
                        if (text.toLowerCase().includes('you are dead')) {
                            this.deathCount++;
                            this.hp = this.maxHp; // reset on respawn
                            // ⛔ A DEATH INVALIDATES EVERY ACK BASELINE, exactly like a reconnect. The
                            // engine ignores ops from a dead player and the respawn teleports us across
                            // the map, so every open window is measuring a world that no longer exists.
                            // Ops sent while the corpse was still on the ground would otherwise be
                            // reported as unanswered (ACK-NOACK false positives).
                            this.ack.reset();
                            this.ackWedge = '';
                            this.ackBlackoutUntil = this.tickCount + this.ackDeathBlackoutTicks;
                            console.log(`[fb] ${this.loginUser}: DIED (#${this.deathCount}) at tick ${this.tickCount}`);
                        }
                        if (this.debug && !text.includes(':')) console.log(`[fb] MSG: ${text}`);
                        // System lines are SDK chat type 0. Recorded so `getChat({types:[0]})` and a
                        // waitForChat on a server message work the same way they do in the browser SDK.
                        this.recordChat({ type: 0, text, sender: '', tick: this.tickCount, fromSelf: false });
                    }
                    break;
                }

                // ---- PLAYER CHAT (parity package 4) ---------------------------------------------
                // ⭐ THESE ARE THE ONLY WAY TO HEAR SOMEONE FURTHER THAN 14 TILES AWAY. The overhead
                // CHAT mask rides PLAYER_INFO and therefore only reaches players who can SEE the
                // speaker; MessagePublicHandler fans a second copy out to literally everyone else
                // (`World.playerLoop.all()`, skipping the same-level dx<=14 && dz<=14 bubble). Both are
                // variable-BYTE (ServerProtSizes[255] = ServerProtSizes[235] = -1) and already flow
                // through the shared readBody() above, so adding these arms is PURELY ADDITIVE: the
                // bytes were being read and discarded before, and the cursor was never consulted.
                case ServerProt.MESSAGE_PUBLIC: {
                    const pub = decodeMessagePublic(this.in, psize);
                    this.chatPublicPackets++;
                    this.recordChat({
                        type: pub.type, text: pub.text, sender: pub.sender, tick: this.tickCount,
                        // The engine never echoes our own line back to us this way (`other.slot ===
                        // player.slot` is skipped), but compare anyway — a name match is free and a
                        // mis-attributed self-message would poison every waitForChat({includeSelf:false}).
                        fromSelf: pub.sender.toLowerCase() === this.loginUser.toLowerCase(),
                    });
                    break;
                }

                case ServerProt.MESSAGE_PRIVATE: {
                    const pm = decodeMessagePrivate(this.in, psize);
                    this.chatPrivatePackets++;
                    this.recordChat({
                        type: pm.type, text: pm.text, sender: pm.sender, tick: this.tickCount,
                        fromSelf: false,
                    });
                    break;
                }

                // HINT ARROW (e.g. the Brimhaven Agility Arena's flashing pillar is ONLY published as a
                // hint_coord). Wire = HintArrowEncoder: g1 type; 1 = npc (g2 nid), 2..6 = tile (g2 x, g2 z, g1 height),
                // 10 = player, 255 (-1) = hint_stop. Read-only state, no brain looks at it unless it wants to.
                case ServerProt.HINT_ARROW: {
                    const t = this.in.g1();
                    if (t >= 2 && t <= 6) { const x = this.in.g2(); const z = this.in.g2(); this.hintTile = { x, z, tick: this.tickCount }; }
                    else if (t === 255 || t === 0) this.hintTile = null;
                    this.hintArrowPackets++;
                    break;
                }

                // every other opcode: bytes already consumed, discard to stay aligned
            }
        }
    }

    // ========================================================================
    // outgoing helpers (write into this.out; flushed once per tick)
    // ========================================================================
    // offline sim: once in game, everything the bot writes during a tick goes out as ONE frame together with that
    // tick's NO_TIMEOUT ack (the engine starts the next cycle on the first frame after a tick, so a frame sent early
    // would end the tick before the bot is done, and the ack would then count for a tick the bot never saw)
    private simHold = false;
    private simAcking = false;
    simDue = 0;      // tick waiters this tick woke
    simNew = 0;      // tick waiters registered since this tick arrived
    private flush(): void {
        if (SIM_LOCKSTEP && this.simHold && !this.simAcking) return;
        if (this.out.pos > 0) {
            this.stream.write(this.out.data, this.out.pos);
            this.out.pos = 0;
        }
    }

    private sendIfButton(comId: number): void {
        this.out.p1Enc(Out.IF_BUTTON);
        this.out.p2(comId);
    }

    private sendResume(comId: number): void {
        if (process.env.SIM_TRACE_RESUME) console.log(`[resume t${this.tickCount} ${this.loginUser}] ${(new Error().stack ?? '').split(String.fromCharCode(10)).slice(2, 5).map(l => l.trim().replace(/^at /, '').replace(/\(.*\/headless\//, '(')).join(' < ')}`);
        // server RESUME_PAUSEBUTTON decoder reads nothing but the prot size is 2,
        // so the client always writes the component id (server discards it).
        this.out.p1Enc(Out.RESUME_PAUSEBUTTON);
        this.out.p2(comId);
    }

    private sendCloseModal(): void {
        // NOTE: closing trademain/tradeconfirm makes the ENGINE tell your partner
        // "Other player declined trade." — so a stray CLOSE_MODAL cancels the trade.
        if (this.debug) console.log(`[fb] SEND close_modal (modal=${this.mainModalId}) t${this.tickCount}`);
        this.out.p1Enc(Out.CLOSE_MODAL);
    }

    // Route to a world tile. clientRoutefinder=true => server walks our path.
    // We send start = current tile + one waypoint = destination (open-terrain
    // naive walk; matches MoveClickDecoder's start-then-signed-delta layout).
    // `protected`, not private: subclasses need a RAW single-tile step in places where the navgrid
    // cannot help them — above all on LEVEL 1, where findLongPath/findNearPath plan against level-0
    // collision and would route a bot through walls that only exist downstairs.
    protected sendMove(destX: number, destZ: number, opclick: boolean): void {
        const curX = this.mapBuildBaseX + this.localPlayer.routeX[0];
        const curZ = this.mapBuildBaseZ + this.localPlayer.routeZ[0];
        const dx = destX - curX;
        const dz = destZ - curZ;
        this.out.p1Enc(opclick ? Out.MOVE_OPCLICK : Out.MOVE_GAMECLICK);
        this.out.p1(2 * 2 + 3); // bufferSize=2 (start + 1 waypoint) -> length 7
        this.out.p1(1); // ctrl/run
        this.out.p2(curX);
        this.out.p2(curZ);
        this.out.p1(dx & 0xff); // signed byte, server reads g1b
        this.out.p1(dz & 0xff);
    }

    // ⭐ `protected`, NOT `private`, AND THAT IS THE WHOLE MAGIC LANE'S HOOK. Every brain reaches the
    // attack wire through this one method, and the ONLY difference between a melee trainee and a caster
    // is which packet the "Attack" decision emits — OPNPC2 vs OPNPCT with a spell component. Overriding
    // here means MagicBot inherits LeanBot's target selection, claim registry, adjacency accounting,
    // approach timers and abandon logic UNCHANGED, instead of forking the 300 lines that produce
    // `target`. (The same reasoning that made `wantStyleButton()` a hook for RangedBot.)
    protected sendOpNpc(index: number, op: number): void {
        // ops 4/5: they used to fall through to OPNPC3, so Pluck (op 4) / the chompy's Attack
        // (op 5) silently became op 3 (south lane #5). Ops 1-3 are unchanged.
        this.out.p1Enc(op === 1 ? Out.OPNPC1 : op === 2 ? Out.OPNPC2 : op === 4 ? ClientProt.OPNPC4 : op === 5 ? ClientProt.OPNPC5 : Out.OPNPC3);
        this.out.p2(index);
        // ⛔ ARMED AT THE PRIMITIVE, NOT AT THE BRAIN — deliberately. Every brain in the repo reaches the
        // wire through this one method, so coverage here is coverage everywhere WITHOUT editing a single
        // brain (and brains ignore return values, so a returned result would have caught nothing).
        // This is the exact send that produced "50 swings, 0 damage, no message".
        this.expectAck(op === 1 ? AckKind.TalkNpc : op === 2 ? AckKind.Attack : AckKind.Pickpocket, index, op);
    }
    // NOTE: the public `opNpc(index, op)` primitive lives with the other op wrappers further down
    // (search "Interact with an npc"). A SECOND copy was added here at some point and tsc flagged it as a
    // duplicate implementation — identical body, so it was dead weight, and `bun build` does not typecheck.

    // INV_BUTTON4 ("do everything"/offer-all). payload = obj, slot, component id.
    // The server validates inv.hasAt(slot, obj), so obj is the RAW obj id (995),
    // NOT the +1 the inventory packets use on the wire.
    private sendInvButton4(obj: number, slot: number, com: number): void {
        this.out.p1Enc(Out.INV_BUTTON4);
        this.out.p2(obj);
        this.out.p2(slot);
        this.out.p2(com);
    }

    private keepWarm(): void {
        if (this.tickCount % 5 === 0) this.out.p1Enc(Out.NO_TIMEOUT);
    }

    // CLIENT_CHEAT (224): a '::' command, e.g. sendCheat('tele 0,41,51,37,41').
    // Server-side gated on staffModLevel (>=2 for ::tele, >=4 for ::~debugprocs) —
    // on the demo this is a silent no-op; a LOCAL_STAFF_LEVEL server honors it.
    // NOT public chat: sdk.say('::x')/MESSAGE_PUBLIC broadcasts the text instead.
    sendCheat(cmd: string): void {
        const text = (cmd.startsWith('::') ? cmd.slice(2) : cmd).toLowerCase();
        this.out.p1Enc(ClientProt.CLIENT_CHEAT);
        this.out.p1(text.length + 1); // +1 = pjstr's \0 terminator
        this.out.pjstr(text);
    }

    /** Override to drive a main modal this bot opened itself. Return true if handled. */
    protected handleMainModal(): boolean {
        return false;
    }

    /** CLOSE_MODAL, for subclasses that drive their own modal (e.g. the bank). */
    protected sendCloseModalPublic(): void {
        this.sendCloseModal();
    }

    /**
     * Send an explicit per-tile MOVE path. doTravel() treats `dist <= 6` as ARRIVED, which is far
     * too loose to operate a loc (a bank booth needs you on the EXACT operable tile), so a subclass
     * that must land precisely walks the last leg itself with this.
     *
     * Without it `BotFacade.walkTo` on a plain LeanBot falls back to one verified `moveStep` per hop:
     * correct, but ~24x the packets on a 24-tile leg. `FacadeBot.walkPath()` remains as the compatible alias.
     *
     * ⛔ RAW WAYPOINTS ONLY. The server NEVER re-paths: every hop must be a legal 1-step move. Do not
     * thin these through `toVias` (it emits the tile AFTER a turn, and densify then diagonal-shortcuts
     * through the very wall the corner avoided). See the naive-router rule.
     */
    sendPath(pts: { x: number; z: number }[]): void {
        if (pts.length) this.sendMultiMove(pts);
    }

    /** INV_BUTTON4 on an arbitrary component (bank deposit-all reuses the trade offer-all packet). */
    protected invButton4(obj: number, slot: number, com: number): void {
        this.sendInvButton4(obj, slot, com);
    }
    // Decode a nearby player's username from the appearance blob we cached in
    // playerAppearanceBuffer[index]. The blob layout (Player.generateAppearance):
    //   gender(1) headicons(1) 12*slot(1|2) 5*colour(1) 7*anim(2) name(8) ...
    // We replay the same cursor walk as ClientPlayer.setAppearance up to name(8).
    private playerName(index: number): string | null {
        const buf = this.playerAppearanceBuffer[index];
        if (!buf) return null;
        try {
            buf.pos = 0;
            buf.g1(); // gender
            buf.g1(); // headicons
            for (let part = 0; part < 12; part++) {
                const msb = buf.g1();
                if (msb !== 0) {
                    const v = (msb << 8) + buf.g1();
                    if (part === 0 && v === 65535) {
                        buf.g2(); // transmog npc id
                        break;
                    }
                }
            }
            for (let c = 0; c < 5; c++) buf.g1();   // colours
            for (let a = 0; a < 7; a++) buf.g2();   // anims
            const name37 = buf.g8();                 // username, base37
            const raw = JString.toRawUsername(name37);
            return raw === 'invalid_name' ? null : raw;
        } catch {
            return null;
        }
    }

    /**
     * Find the world index of a visible player by EXACT name (case-insensitive). Never a substring
     * match: "bob" must not resolve to "bob2". Returns -1 when the player is not in view (the client
     * only renders the nearest 250 players on its level).
     */
    protected findPlayerIndexByName(name: string): number {
        const want = name.trim().toLowerCase();
        if (!want) return -1;
        for (let i = 0; i < this.playerCount; i++) {
            const idx = this.playerIds[i];
            if (idx === LOCAL_PLAYER_INDEX) continue;
            const nm = this.playerName(idx);
            if (nm && nm.trim().toLowerCase() === want) return idx;   // EXACT — never a prefix
        }
        return -1;
    }

    protected playerWorldTile(index: number): { x: number; z: number } {
        const p = this.players[index]!;
        return { x: this.mapBuildBaseX + p.routeX[0], z: this.mapBuildBaseZ + p.routeZ[0] };
    }

    /** Chebyshev distance to a visible player, in tiles. */
    protected distanceToPlayer(index: number): number {
        const t = this.playerWorldTile(index);
        const me = this.playerTile();
        return Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z));
    }

    // ------------------------------------------------------------------------------------------------
    // Walk to an EXACT tile over a collision-legal route (the navgrid planner when injected, else a
    // naive MOVE). Raw sendMove is a NAIVE walk that wedges on any obstacle between here and there
    // (rock clusters, a cooking fire, fences); this threads a real route and lands ON the tile. Use it
    // for station approaches and anything that must stand on one specific tile.
    // Returns true while still walking (caller should return and wait), false once ON the tile.
    // ------------------------------------------------------------------------------------------------
    private _wePath: { x: number; z: number }[] | null = null;
    private _weKey = ''; private _weIdx = 0;
    private _weLastSend = -100; private _wePrev = ''; private _weStall = 0;
    private _weDensify(corners: { x: number; z: number }[]): { x: number; z: number }[] {
        const out: { x: number; z: number }[] = [];
        for (let i = 0; i < corners.length; i++) {
            const c = corners[i];
            if (i === 0) { out.push({ x: c.x, z: c.z }); continue; }
            let { x, z } = out[out.length - 1];
            while (x !== c.x || z !== c.z) { if (x < c.x) x++; else if (x > c.x) x--; if (z < c.z) z++; else if (z > c.z) z--; out.push({ x, z }); }
        }
        return out;
    }
    protected walkToExact(tx: number, tz: number): boolean {
        const me = this.playerTile();
        // ON the tile: clear only OUR OWN cached route. Nulling unconditionally clobbered a DIFFERENT
        // target's in-flight route when a brain exact-walks two targets in one tick (e.g. an on-tile
        // station check followed by a gap-close) — the second walk then replanned EVERY tick, its
        // stall counter pinned at 0, and the stall fallbacks below never engaged (found live: the QM
        // return leg pinned at the dwarf station re-sending a fresh route each tick).
        if (me.x === tx && me.z === tz) { if (this._weKey === `${tx},${tz}`) this._wePath = null; return false; }
        if (!this.findLongPathFn) {   // no planner -> naive step fallback (co-located tests)
            if (this.tickCount - this._weLastSend >= 3) { this.sendMove(tx, tz, true); this._weLastSend = this.tickCount; }
            return true;
        }
        const key = `${tx},${tz}`, meKey = `${me.x},${me.z}`;
        if (meKey === this._wePrev) this._weStall++; else { this._weStall = 0; this._wePrev = meKey; }
        // FALLBACK: stalled within a few tiles of the target (a short final hop the segment walker
        // won't complete — e.g. it would emit a (0,0)-leading MOVE) -> push with a plain MOVE. The
        // window is BOUNDED: a naive push into a wall never succeeds, and an unbounded fallback
        // starves the re-plan branch below (the exact-route fix) forever — the Dwarven miner sat one
        // tile from the portal stand doing exactly this.
        if (this._weStall >= 5 && this._weStall < 12 && Math.max(Math.abs(me.x - tx), Math.abs(me.z - tz)) <= 3) {
            if (this.tickCount - this._weLastSend >= 2) { this.sendMove(tx, tz, true); this._weLastSend = this.tickCount; }
            return true;
        }
        if (this._weKey !== key || !this._wePath || this._weStall >= 8) {
            let corners = this.findLongPathFn(this.travelLevel, me.x, me.z, tx, tz);
            // EXACT means EXACT: shared planners run an arrive-LADDER ([0,2,4]) and may return a route
            // that stops 2-4 tiles SHORT — from ≤2 tiles out that is a ZERO-PROGRESS route and this
            // walker livelocks on it forever (a bot pinned ONE tile from its target). So when
            // the route does not END on the target tile, re-plan with the raw server-collision
            // pathfinder, which has no arrive ladder and mirrors the server exactly.
            const end = corners[corners.length - 1];
            if (!end || end.x !== tx || end.z !== tz) {
                try {
                    const raw = guardRaw(rawFindLongPath(this.travelLevel, me.x, me.z, tx, tz), this.travelLevel, me.x, me.z, tx, tz, `[fb] ${this.loginUser} walkExact`);
                    const rl = raw[raw.length - 1];
                    if (rl && rl.x === tx && rl.z === tz) corners = raw.map(w => ({ x: w.x, z: w.z }));
                } catch { /* keep the short route; the stall fallback still applies */ }
            }
            // CORNER ROUTES NEED THE START TILE. The raw rsmod pathfinder returns TURNING POINTS (a
            // straight 3-tile hop = ONE waypoint, the destination) and _weDensify interpolates only
            // BETWEEN entries — without the start tile a corner route "densifies" to the corner list
            // itself, and a sendPath whose FIRST step is >1 tile is an ILLEGAL MOVE the server silently
            // drops (the naive-router rule): the walk then re-plans a len=1 sendPath (a 3-tile jump)
            // forever. Underground (z>5631) the raw planner is the ONLY planner, so every off-navgrid
            // exact walk hit this. Prepending the CURRENT tile
            // is a no-op for dense navgrid routes (the skip-current-tile loop below drops it).
            this._wePath = this._weDensify(corners.length ? [{ x: me.x, z: me.z }, ...corners] : corners);
            this._weKey = key; this._weIdx = 0; this._weStall = 0; this._weLastSend = -100;
        }
        const path = this._wePath;
        // no route: a blind MOVE lets the SERVER path us — but never straight into a White Wolf Mountain aggro circle
        // (the planner refused that leg on purpose; stand and keep re-planning instead).
        if (!path.length) { if (this.tickCount - this._weLastSend >= 3) { if (me.z > 6000 || !pathHitsDanger([{ x: tx, z: tz }], me.x, me.z)) this.sendMove(tx, tz, true); else this.warm(); this._weLastSend = this.tickCount; } return true; }
        let nearest = this._weIdx, best = Infinity;
        for (let i = this._weIdx; i < Math.min(this._weIdx + 40, path.length); i++) { const d = Math.max(Math.abs(path[i].x - me.x), Math.abs(path[i].z - me.z)); if (d < best) { best = d; nearest = i; } }
        // Skip the current tile so the emitted MOVE never leads with a (0,0) waypoint — the server
        // won't step off its own start tile, which otherwise hangs one tile short.
        while (nearest < path.length - 1 && path[nearest].x === me.x && path[nearest].z === me.z) nearest++;
        this._weIdx = nearest;
        const end = Math.min(this._weIdx + 16, path.length - 1);
        const seg = path.slice(this._weIdx, end + 1);
        const reached = Math.max(Math.abs(path[end].x - me.x), Math.abs(path[end].z - me.z)) <= 1;
        if (this._weLastSend < 0 || reached || this.tickCount - this._weLastSend >= 6) { this.sendPath(seg); this._weLastSend = this.tickCount; }
        return true;
    }

    // ========================================================================
    // npc position decode (ported from Client.getNpcPos*; NpcType lookups
    // replaced with the raw 11-bit type id, SeqType priority logic dropped —
    // neither touches the byte cursor)
    // ========================================================================
    private getNpcPos(buf: Packet, size: number): void {
        this.entityRemovalCount = 0;
        this.entityUpdateCount = 0;

        this.getNpcPosOldVis(buf, size);
        this.getNpcPosNewVis(buf, size);
        this.getNpcPosExtended(buf);

        for (let i = 0; i < this.entityRemovalCount; i++) {
            const index = this.entityRemovalIds[i];
            const npc = this.npcs[index];
            if (!npc) continue;
            if (npc.cycle !== this.loopCycle) { this.npcs[index] = null; releaseNpc(npc); }
        }

        if (buf.pos !== size) {
            throw new Error(`size mismatch in getnpcpos - pos:${buf.pos} psize:${size}`);
        }

        for (let i = 0; i < this.npcCount; i++) {
            if (!this.npcs[this.npcIndices[i]]) {
                throw new Error(`null entry in npc list - pos:${i} size:${this.npcCount}`);
            }
        }
    }

    private getNpcPosOldVis(buf: Packet, _size: number): void {
        buf.gBitStart();

        const count = buf.gBit(8);
        if (count < this.npcCount) {
            for (let i = count; i < this.npcCount; i++) {
                this.entityRemovalIds[this.entityRemovalCount++] = this.npcIndices[i];
            }
        }
        if (count > this.npcCount) {
            throw new Error('eek! Too many npcs');
        }

        this.npcCount = 0;
        for (let i = 0; i < count; i++) {
            const index = this.npcIndices[i];
            const npc = this.npcs[index];

            const info = buf.gBit(1);
            if (info === 0) {
                this.npcIndices[this.npcCount++] = index;
                if (npc) npc.cycle = this.loopCycle;
            } else {
                const op = buf.gBit(2);
                if (op === 0) {
                    this.npcIndices[this.npcCount++] = index;
                    if (npc) npc.cycle = this.loopCycle;
                    this.pushEntityUpdate(index);
                } else if (op === 1) {
                    this.npcIndices[this.npcCount++] = index;
                    if (npc) npc.cycle = this.loopCycle;
                    const walkDir = buf.gBit(3);
                    npc?.moveCode(false, walkDir);
                    if (buf.gBit(1) === 1) this.pushEntityUpdate(index);
                } else if (op === 2) {
                    this.npcIndices[this.npcCount++] = index;
                    if (npc) npc.cycle = this.loopCycle;
                    const walkDir = buf.gBit(3);
                    npc?.moveCode(true, walkDir);
                    const runDir = buf.gBit(3);
                    npc?.moveCode(true, runDir);
                    if (buf.gBit(1) === 1) this.pushEntityUpdate(index);
                } else if (op === 3) {
                    this.entityRemovalIds[this.entityRemovalCount++] = index;
                }
            }
        }
    }

    private getNpcPosNewVis(buf: Packet, size: number): void {
        while (buf.bitPos + 21 < size * 8) {
            const index = buf.gBit(14);
            if (index === 16383) break;

            if (!this.npcs[index]) this.npcs[index] = acquireNpc();
            const npc = this.npcs[index]!;
            this.npcIndices[this.npcCount++] = index;
            npc.cycle = this.loopCycle;
            npc.typeId = buf.gBit(11); // was NpcType.list(...) -> keep raw id

            let dx = buf.gBit(5);
            if (dx > 15) dx -= 32;
            let dz = buf.gBit(5);
            if (dz > 15) dz -= 32;

            const jump = buf.gBit(1);
            npc.teleport(jump === 1, this.localPlayer.routeX[0] + dx, this.localPlayer.routeZ[0] + dz);

            if (buf.gBit(1) === 1) this.pushEntityUpdate(index);
        }
        buf.gBitEnd();
    }

    // ⛔ BOUNDS GUARD ON A PROCESS-SHARED ARRAY. `entityUpdateIds` IS LeanClient.sharedEntityUpdateIds
    // (leanclient.ts:535-539), sized MAX_PLAYER_COUNT = 2048 because the PLAYER scan sized it — but the
    // npc scan above fills it with npc indices, whose own capacity is NPC_ARRAY = 16384. Today the
    // engine's npc view limit keeps the count far below 2048 so nothing overflows; the hazard is the
    // FAILURE MODE if that ever stops being true. A write past the end of a typed array SILENTLY
    // NO-OPS while `entityUpdateCount` still increments, so getNpcPosExtended() below reads back
    // `undefined`, takes its `if (!npc) continue` arm, and never consumes the mask byte the server
    // sent — desyncing the whole stream with nothing logged anywhere near the cause. Refusing the write
    // and saying so ONCE converts a future resize (or a wider engine view) from a silent desync into a
    // log line. Costs one predictable compare per updated npc; identical behaviour below capacity.
    private entityUpdateOverflowed = false;
    private pushEntityUpdate(index: number): void {
        if (this.entityUpdateCount >= this.entityUpdateIds.length) {
            if (!this.entityUpdateOverflowed) {
                this.entityUpdateOverflowed = true;
                console.error(`[fb] ${this.loginUser}: ⛔ entityUpdateIds OVERFLOW at capacity ` +
                    `${this.entityUpdateIds.length} (npc scan, tick ${this.tickCount}) — extended-info ` +
                    `blocks are being dropped and the packet stream WILL desync. Grow ` +
                    `LeanClient.sharedEntityUpdateIds to NPC_ARRAY (16384).`);
            }
            return;
        }
        this.entityUpdateIds[this.entityUpdateCount++] = index;
    }

    private getNpcPosExtended(buf: Packet): void {
        for (let i = 0; i < this.entityUpdateCount; i++) {
            const id = this.entityUpdateIds[i];
            const npc = this.npcs[id];
            if (!npc) continue;

            const mask = buf.g1();

            // ⛔ BYTE LAYOUT UNCHANGED — four g1()s, same order, same count. The only difference from the
            // old code is that the values are now KEPT instead of dropped on the floor. (Client.ts's
            // player-side twin reads the identical dmg/type/health/totalHealth quartet.)
            if ((mask & NpcUpdate.HITMARK2) !== 0) {
                const dmg = buf.g1(), type = buf.g1(), cur = buf.g1(), max = buf.g1();
                npc.noteHit(this.loopCycle, dmg, type, cur, max);
                this.ackRevs[Rev.Hit]!++;   // ACK OBSERVABLE: a swing LANDED (see interaction-ack.ts)
            }
            if ((mask & NpcUpdate.ANIM) !== 0) {
                buf.g2(); buf.g1(); // seqId, delay (SeqType priority logic dropped)
            }
            if ((mask & NpcUpdate.FACEENTITY) !== 0) {
                npc.faceEntity = buf.g2();
                if (npc.faceEntity === 65535) npc.faceEntity = -1;
            }
            if ((mask & NpcUpdate.SAY) !== 0) {
                npc.chatMessage = buf.gjstr();
            }
            if ((mask & NpcUpdate.HITMARK) !== 0) {
                const dmg = buf.g1(), type = buf.g1(), cur = buf.g1(), max = buf.g1();
                npc.noteHit(this.loopCycle, dmg, type, cur, max);
                this.ackRevs[Rev.Hit]!++;
            }
            if ((mask & NpcUpdate.CHANGETYPE) !== 0) {
                npc.typeId = buf.g2();
            }
            if ((mask & NpcUpdate.SPOTANIM) !== 0) {
                buf.g2(); buf.g4(); // spotanimId, height/delay
            }
            if ((mask & NpcUpdate.FACESQUARE) !== 0) {
                npc.faceSquareX = buf.g2();
                npc.faceSquareZ = buf.g2();
            }
        }
    }

    // ========================================================================
    // brain — runs once per server tick (on PLAYER_INFO)
    // ========================================================================
    // NOTE: use routeX[0]/routeZ[0] (the live tile the server placed us on via walk
    // steps), NOT the fine x/z. The headless client never renders, so moveCode never
    // interpolates x/z — those only update on teleport. routeX[0]/routeZ[0] is the
    // real current tile after every walk step. (This is why travel looked "frozen".)
    private playerTile(): { x: number; z: number } {
        return {
            x: this.mapBuildBaseX + this.localPlayer.routeX[0],
            z: this.mapBuildBaseZ + this.localPlayer.routeZ[0]
        };
    }

    private npcWorld(npc: LeanNpc): { x: number; z: number } {
        return {
            x: this.mapBuildBaseX + npc.routeX[0],
            z: this.mapBuildBaseZ + npc.routeZ[0]
        };
    }
    // Subclass accessor for a scene npc's LIVE world tile (routeX[0], never x>>7 — the stale-tile rule).
    protected npcWorldTile(npc: LeanNpc): { x: number; z: number } { return this.npcWorld(npc); }

    // ---- WANDERING-NPC APPROACH (reusable; the RM/Duke class, and every future pacing npc) ----------
    // Walk to within `range` tiles of a (possibly MOVING) npc, robustly. Returns true while still
    // approaching, false once in range — the caller then OPLOCs/uses-item/attacks and lets the ENGINE
    // FOLLOW the final 1-2 tiles (the reliable primitive for a moving target; naive-router rule).
    // Two failure modes a naive chase hits, both fixed here:
    //   (1) JITTER — re-planning to the npc's per-tick tile oscillates. Fix: a THROTTLED stable target
    //       (re-aim only when the npc drifts >2, or every 12 ticks), so the walk is smooth.
    //   (2) WRONG SIDE OF A WALL — a fixed quest coord can sit across an interior wall from the npc.
    //       Fix: walkToExact routes to the npc's OWN live tile via the real pathfinder, which ends on
    //       the npc's walkable side (the exact bug that stranded the bot 5 tiles from a walled-in Duke).
    private _snX = -1; private _snZ = -1; private _snTick = -100;
    protected stepToNpc(idx: number, range = 1): boolean {
        const n = this.npcs[idx]; if (!n) return true;   // not in scene -> keep "approaching"; caller re-finds
        const N = this.npcWorldTile(n); const me = this.playerTile();
        if (process.env.SN_TRACE && this.tickCount % 8 === 0) console.log(`[sn] me(${me.x},${me.z}) npc(${N.x},${N.z}) lvl=${this.travelLevel} minused=${this.minusedlevel} d=${Math.max(Math.abs(me.x - N.x), Math.abs(me.z - N.z))} tgt(${this._snX},${this._snZ})`);
        if (Math.max(Math.abs(me.x - N.x), Math.abs(me.z - N.z)) <= range) return false;   // in range on the LIVE tile
        // DOOR ON THE APPROACH: walkToExact does NOT open doors, so a closed door between us and the npc
        // (e.g. the Lumbridge-castle L1 interior door that walls off Duke's room) would stall the whole
        // approach. Open it with the level-aware tracker's exact loc/op BEFORE walking (hold MOVEs so
        // the open isn't cancelled). Once the tracker sees it open, nearestClosed skips it and we walk.
        const cd = this.doorTracker?.nearestClosed(this.travelLevel, me.x, me.z, 2);
        if (cd) {
            if (this.tickCount - (this.travelDoorTried.get(`${cd.x},${cd.z}`) ?? -100) >= 8) {
                this.travelDoorTried.set(`${cd.x},${cd.z}`, this.tickCount);
                this.opLoc(cd.x, cd.z, cd.locId, cd.op);
                this.travelSuppressMoveUntil = this.tickCount + 4;
            }
            return true;
        }
        if (this.tickCount < this.travelSuppressMoveUntil) { this.warm(); return true; }   // let a just-issued open resolve
        if (this._snX < 0 || Math.max(Math.abs(this._snX - N.x), Math.abs(this._snZ - N.z)) > 2 || this.tickCount - this._snTick > 12) {
            this._snX = N.x; this._snZ = N.z; this._snTick = this.tickCount;   // re-aim only on real drift / periodically
        }
        this.walkToExact(this._snX, this._snZ);   // real pathfinder -> ends adjacent to the npc on its side of walls
        return true;
    }
    protected resetStepToNpc(): void { this._snX = -1; this._snZ = -1; this._snTick = -100; }

    // SCRATCH LOCALS, NOT OBJECTS. This is a per-tick, per-bot scan over every npc in view (dozens in
    // the Ardougne market), and the old body allocated one playerTile() pair, one npcWorld() pair PER
    // NPC, and a fresh `best` record on every improvement — all garbage the moment the scan returns.
    // A world tile is two adds, so inlining costs nothing, and the coordinates come from exactly the
    // same routeX[0]/routeZ[0] the wrappers read, so the stale-tile rule (see npcWorld) still holds.
    // Exactly ONE object is built, on return, so every caller sees the identical shape and the
    // tie-breaking is unchanged (strictly-less-than keeps the FIRST npc at the minimum distance).
    protected findNearestNpc(pred: (n: LeanNpc) => boolean): { npc: LeanNpc; index: number; x: number; z: number; dist: number } | null {
        const baseX = this.mapBuildBaseX, baseZ = this.mapBuildBaseZ;
        const meX = baseX + this.localPlayer.routeX[0], meZ = baseZ + this.localPlayer.routeZ[0];
        let bestNpc: LeanNpc | null = null;
        let bestIndex = -1, bestX = 0, bestZ = 0, bestDist = 0;
        for (let i = 0; i < this.npcCount; i++) {
            const index = this.npcIndices[i];
            const npc = this.npcs[index];
            if (!npc || !pred(npc)) continue;
            const wx = baseX + npc.routeX[0], wz = baseZ + npc.routeZ[0];
            const dist = Math.max(Math.abs(wx - meX), Math.abs(wz - meZ));
            if (!bestNpc || dist < bestDist) { bestNpc = npc; bestIndex = index; bestX = wx; bestZ = wz; bestDist = dist; }
        }
        return bestNpc ? { npc: bestNpc, index: bestIndex, x: bestX, z: bestZ, dist: bestDist } : null;
    }

    /**
     * ⭐ THE ESCAPE HATCH FOR `driveDialog`'s ONE-ACTION-PER-PAGE GUARD.
     *
     * Returns TRUE while the caller should keep holding this page (the tick has already been SPENT
     * loudly enough — see below), FALSE when the page must be driven AGAIN because our last action was
     * evidently dropped. It is written to be safe for an OVERRIDE to call first and then delegate to
     * `super.driveDialog()`: when it returns false it also clears `resumedDialog`, so the base's own
     * guard sees a fresh page and acts rather than re-entering this method.
     *
     * THE THREE OUTCOMES, in tick order:
     *   < dialogRedriveTicks        warm(). NEVER a silent tick — that is the whole bug.
     *   every dialogRedriveTicks    re-drive the page (up to dialogMaxRedrives). A dropped click is the
     *                               single likeliest cause and one more click is free.
     *   after dialogMaxRedrives     DIALOG-STUCK-<modal>: say so at error level, CLOSE the modal and
     *                               clear our own view of it.
     *
     * ⛔ WHY THE ESCAPE IS A CLOSE, NOT A LONGER WAIT. `chatModalId !== -1` pins brain() to branch (b);
     * while it holds, NO other behaviour of any brain can run. Waiting longer on a page that has not
     * advanced in `5 x 10` ticks does not make it advance, it just extends a total outage. Closing
     * hands the bot back to its real brain, where the watchdogs judge it like everyone else — the same
     * argument the TUTORIAL-NO-GUIDE bail-out makes, for the same reason.
     *
     * ⛔ AND WE CLEAR `chatModalId` OURSELVES rather than waiting for IF_CLOSE. The failure being
     * escaped IS "the server is not answering this page", so a fix that depends on the server answering
     * is not a fix. If IF_CLOSE does arrive it re-clears the same fields — idempotent either way.
     */
    protected holdDialogPage(): boolean {
        const waited = this.tickCount - this.dialogActedTick;
        if (this.dialogActedTick < 0) { this.dialogActedTick = this.tickCount; this.warm(); return true; }
        if (waited < this.dialogRedriveTicks) { this.tickBucket = 'dialog'; this.warm(); return true; }
        if (this.dialogRedrives >= this.dialogMaxRedrives) {
            const held = this.tickCount - this.dialogActedTick + this.dialogRedrives * this.dialogRedriveTicks;
            this.dialogWedge = `DIALOG-STUCK-${this.chatModalId}`;
            const me = this.playerTile();
            console.error(`[fb] ${this.loginUser}: ⛔ ${this.dialogWedge} at (${me.x},${me.z}) — chat modal ` +
                `${this.chatModalId} has not advanced after ${this.dialogRedrives} re-drives over ~${held} ticks. ` +
                `An open chat modal pins brain() to branch (b), so this bot can do NOTHING ELSE while it ` +
                `stands: force-closing the page and returning it to its real brain rather than holding a ` +
                `silent tick forever (the driveDialog fixpoint).`);
            this.sendCloseModalPublic();
            this.chatModalId = -1;
            this.resumedDialog = false;
            this.dialogRedrives = 0;
            this.dialogActedTick = this.tickCount;
            this.tickBucket = 'dialog';
            return true;                        // the CLOSE was this tick's action
        }
        this.dialogRedrives++;
        console.log(`[fb] ${this.loginUser}: dialog page on modal ${this.chatModalId} did not advance in ` +
            `${waited} ticks — re-driving it (${this.dialogRedrives}/${this.dialogMaxRedrives}); a dropped ` +
            `click is the likeliest cause`);
        this.resumedDialog = false;             // let the (possibly overridden) driver act on it again
        return false;
    }

    /**
     * brain() branch (b3) accounting: a subclass CLAIMED the open main modal this tick. `silent` is the
     * measured truth ("it put no bytes on the wire"), never a guess.
     *
     * A claimed-and-silent tick is normal in ones and twos — every bank driver in this repo spaces its
     * clicks with `if (tick - lastBankTick < 2) return true`. It is a WEDGE in the sixties: at that
     * point the state machine is not spacing, it is stopped, and because the claim also suppresses
     * branch (c) nothing will ever close the window either. So: warm the link, name the modal, and keep
     * saying it. We deliberately do NOT force the modal shut here — unlike a chat page, the claimer may
     * legitimately own real work behind it (a 200-tick smithing batch), and stealing its window would
     * turn a diagnosis into a new bug. Naming it is the fix; a supervisor restarts the account.
     */
    private noteModalClaim(silent: boolean): void {
        if (!silent) { this.clearBranchIdle(); return; }
        this.spendIdleTick(`MODAL-HELD-IDLE-${this.mainModalId}`,
            `handleMainModal() has CLAIMED main modal ${this.mainModalId} without sending a single byte. ` +
            `A claim suppresses brain()'s dismiss branch, so nothing will close this window and no other ` +
            `behaviour can run. Look for an await with no timeout arm (a P_COUNTDIALOG that never arrived ` +
            `is the known one).`);
    }

    /**
     * ⭐ THE ONE PLACE A BRAIN BRANCH IS ALLOWED TO DO NOTHING — and it is never free, never silent and
     * never anonymous.
     *
     * Every top brain() branch measures its own output and calls this when it produced ZERO bytes. Three
     * things happen, in this order and for three different reasons:
     *   1. `warm()`   — so the branch cannot get the account KICKED. The kick is what destroyed the
     *                   evidence last time: 14 reconnects, a fresh object each time, the same fixpoint.
     *   2. a COUNT    — so "idle for a moment" and "idle forever" are different observable states. This
     *                   is deliberately NOT the generic `silentTicks` counter: the warm above would ack
     *                   that one (it measures the whole brain), which is exactly why branch-level idling
     *                   needs its own count.
     *   3. a WEDGE    — `<REASON>` on progressWedge(), re-stated every `modalIdleLimit` ticks, so a
     *                   status line names the branch instead of showing a healthy connection.
     *
     * ⛔ IT DOES NOT TRY TO FIX ANYTHING. A branch that can be fixed generically (a chat page that will
     * not advance) is fixed at the branch — see holdDialogPage's force-close. This is the net under the
     * ones that cannot be, above all a subclass override in a file this one does not own.
     */
    protected spendIdleTick(reason: string, why: string): void {
        this.warm();
        if (reason !== this.branchIdleReason) { this.branchIdleReason = reason; this.branchIdleTicks = 0; }
        this.branchIdleTicks++;
        if (this.modalIdleLimit <= 0 || this.branchIdleTicks < this.modalIdleLimit) return;
        if (this.branchIdleTicks % this.modalIdleLimit !== 0) return;
        this.modalWedge = reason;
        const me = this.playerTile();
        console.error(`[fb] ${this.loginUser}: ⛔ ${reason} at (${me.x},${me.z}) — this brain branch has ` +
            `produced ZERO bytes for ${this.branchIdleTicks} consecutive ticks. ${why} The link is being ` +
            `kept warm so the account is not kicked, which means it is ALIVE AND DOING NOTHING — that is ` +
            `the whole reason this line exists rather than a quiet forever.`);
    }

    /** A branch produced output: the idle run is over. */
    private clearBranchIdle(): void {
        if (this.branchIdleTicks === 0 && !this.modalWedge) return;
        if (this.modalWedge && this.modalWedge === this.branchIdleReason) {
            console.log(`[fb] ${this.loginUser}: branch RECOVERED (was ${this.modalWedge})`);
            this.modalWedge = '';
        }
        this.branchIdleTicks = 0;
        this.branchIdleReason = '';
    }

    /** brain() branch (c) accounting: we are trying to dismiss a modal the server will not close. Same
     *  argument as above — the close IS being sent (so no kick), but a modal that outlives ~60 closes is
     *  a bot that cannot reach its own brain, and that must have a name rather than a quiet forever. */
    private noteModalDismiss(): void {
        if (this.mainModalId !== this.modalDismissId) {
            this.modalDismissId = this.mainModalId;
            this.modalDismissTicks = 0;
            if (this.modalWedge.startsWith('MODAL-STUCK')) this.modalWedge = '';
        }
        this.modalDismissTicks++;
        if (this.modalIdleLimit <= 0 || this.modalDismissTicks < this.modalIdleLimit) return;
        if (this.modalDismissTicks % this.modalIdleLimit !== 0) return;
        this.modalWedge = `MODAL-STUCK-${this.mainModalId}`;
        const me = this.playerTile();
        console.error(`[fb] ${this.loginUser}: ⛔ ${this.modalWedge} at (${me.x},${me.z}) — main modal ` +
            `${this.mainModalId} has survived ${Math.floor(this.modalDismissTicks / 2)} CLOSE_MODALs over ` +
            `${this.modalDismissTicks} ticks. brain() cannot get past branch (c) while it stands, so this ` +
            `account is making NO progress with a perfectly healthy connection.`);
    }

    /** Called by every decode arm that observes a NEW dialog/modal page. Resets the fixpoint guard so a
     *  page that genuinely advanced does not inherit the previous one's re-drive budget. */
    protected onDialogPageChanged(): void {
        this.resumedDialog = false;
        this.dialogRedrives = 0;
        this.dialogActedTick = -1;
        if (this.dialogWedge) {
            console.log(`[fb] ${this.loginUser}: dialog RECOVERED (was ${this.dialogWedge})`);
            this.dialogWedge = '';
        }
    }

    // protected so a quest-runner subclass can override the choice logic (the base picks option 1 /
    // click-continue, which is wrong for a quest that needs a specific p_choice branch).
    protected driveDialog(): void {
        // ⛔ THIS GUARD USED TO BE `if (this.resumedDialog) return;` AND IT WAS A PERMANENT SILENT
        // FIXPOINT — structurally identical to the tutorial-island one that cost 14 reconnects and a
        // permanently-zero account. `resumedDialog` is cleared ONLY by a decode arm (IF_OPENCHAT /
        // IF_OPENMAIN / IF_OPENMAIN_SIDE / IF_CLOSE). So if our click is dropped, or the page is a
        // terminal one whose RESUME the server discards, the server sends nothing, nothing clears the
        // flag, and this branch returns having sent nothing, logged nothing and changed nothing — every
        // tick, forever, with `chatModalId !== -1` pinning brain() to branch (b) so no other behaviour
        // can ever run. `holdDialogPage()` bounds it: warm, re-drive, then name it and force the page
        // shut. See holdDialogPage() for why the escape is a CLOSE and not a longer wait.
        if (this.resumedDialog && this.holdDialogPage()) return;
        this.dialogActedTick = this.tickCount;
        const root = DIALOG_ROOT_BY_ID.get(this.chatModalId);
        if (root) {
            // ---- multiN choice ------------------------------------------------------------------
            // Order of precedence, most specific first:
            //   1. the per-brain dialogPolicy (regex -> option), consulted in the order given;
            //   2. the toll-gate payment below;
            //   3. option 1 — the default. (That default is load-bearing: it is "Yes please." on the
            //      guide's skip-tutorial prompt, which every account passes through.)
            for (const rule of [...this.mlTransportDialog(), ...this.dialogPolicy]) {
                const picked = this.clickDialogByText(rule.match);
                if (picked > 0) {
                    console.log(`[fb] dialog: policy ${rule.label ? `'${rule.label}' ` : ''}${rule.match} -> option ${picked} on modal ${this.chatModalId}`);
                    this.resumedDialog = true;
                    return;
                }
            }
            // ---- THE TOLL GATE ----------------------------------------------------------------------
            // Ahead of the option-1 default and BELOW an explicit per-brain policy. This is the clause
            // that makes the wedge unreachable for EVERY brain, including one that never calls
            // tollAssist(): whatever opened this modal — our own OPNPC, a stalled walk's blind
            // door-opener, a stray guard talk — if we are at the gate and mean to cross it, we PAY.
            // Option 1 here is "No thank you, I'll walk around." (border_gate.rs2:35); declining it is
            // what left bots re-declining the toll indefinitely.
            if (this.tollDialogIsOurs()) {
                const picked = this.clickDialogByText(/^yes/i);
                if (picked > 0) {
                    const opt = this.dialogOptions()[picked - 1]!;
                    const me = this.tile();
                    this.resumedDialog = true;
                    this.tollAccepts++;
                    this.lastTollAcceptTick = this.tickCount;
                    console.log(`[fb] ${this.loginUser}: TOLL ${tollSideOf(me)}->${tollSideOf(me) === 'east' ? 'west' : 'east'} ` +
                        `-> clicking "${opt.text}" (com ${opt.com}) at (${me.x},${me.z}), coins=${this.coins()}, accept #${this.tollAccepts}`);
                    return;
                }
                // Labels have not arrived yet (IF_SETTEXT can trail IF_OPENCHAT by a tick). Do NOT fall
                // through to the positional default — option 1 is the DECLINE. Spend the tick instead;
                // the text lands next tick and we answer then.
                this.resumedDialog = true;
                return;
            }

            const optCom = root.optionComs[0]!;
            this.sendIfButton(optCom);
            console.log(`[fb] dialog: choosing option 1 on modal ${this.chatModalId} (com=${optCom})`);
        } else {
            this.sendResume(this.chatModalId);
        }
        this.resumedDialog = true;
    }

    private brain(): void {
        // ⛔ THE INVARIANT THIS BLOCK ENFORCES: **no top-level brain() branch may return without putting
        // a byte on the wire, and no branch may be idle ANONYMOUSLY.** Each branch measures its own
        // `out.pos` delta and routes a zero-delta tick through spendIdleTick(), which warms the link
        // (no kick) and names the branch on progressWedge() once the idling is no longer plausibly
        // transient. This is what makes the fix a BUG-CLASS fix rather than 189 individual ones: the
        // audit found ~30 `return true` sites across 7 subclass handleMainModal overrides that send
        // nothing on the tick they claim, and the shape is reachable in files leanbot.ts does not own.

        // (a) character-design modal open -> accept it
        if (this.mainModalId === PLAYER_KIT_MODAL) {
            const before = this.out.pos;
            if (this.tickCount - this.lastActionTick >= 3) {
                this.sendIfButton(PLAYER_KIT_ACCEPT); // [if_button,player_kit:accept]
                this.lastActionTick = this.tickCount;
                this.acceptedTick = this.tickCount;
                console.log('[fb] accepting character design (IF_BUTTON player_kit:accept)');
            }
            this.tickBucket = 'kit-modal';
            if (this.out.pos === before) {
                this.spendIdleTick(`KIT-MODAL-STUCK-${this.mainModalId}`,
                    `The character-design accept is being sent and the modal is not closing, so login ` +
                    `never completes and no inventory tab is ever attached.`);
            } else this.clearBranchIdle();
            return;
        }

        // (b) any dialog open -> drive it (skip choice / click-to-continue)
        if (this.chatModalId !== -1) {
            // A tick-bounded LEASE lets a wrapper (bot-facade.ts's talkTo / navigateDialog) read and
            // answer the page itself instead of racing the option-1 auto-driver. Default -1 = never
            // leased, so every existing brain is byte-identical. The tick spent is still SENT: a lease
            // is permission to leave the page alone, never permission to go silent. It is NOT counted
            // as branch-idle — a lease is explicit, caller-owned and already bounded by its own tick
            // budget, so naming it would be a false positive on a facade doing exactly as it said.
            if (this.dialogLeased()) { this.tickBucket = 'dialog-leased'; this.warm(); return; }
            // ⛔ MEASURE THE OVERRIDE, DO NOT TRUST IT. `driveDialog` is protected and overridden by
            // the quest runners and bot-facade.ts's FacadeBot — and FacadeBot's override is a
            // bare `if (this.facadeHoldDialog) return;`, i.e. exactly the fixpoint shape this audit is
            // about, in a file this one does not own. So branch (b) checks the WIRE rather than the
            // contract: whatever the subclass did, a zero-byte tick is warmed AND NAMED here. That makes
            // the invariant hold for overrides that have not been written yet.
            const before = this.out.pos;
            this.driveDialog();
            if (this.out.pos === before) {
                this.spendIdleTick(`DIALOG-DRIVER-IDLE-${this.chatModalId}`,
                    `driveDialog() (or an override of it) returned without acting, and an open chat modal ` +
                    `pins brain() to this branch — so NOTHING else this bot knows how to do can run.`);
            } else this.clearBranchIdle();
            return;
        }

        // (b3) subclass hook: a subclass that deliberately OPENED a main modal (e.g. the bank,
        //      mainModalId 5292) gets first refusal on it, so branch (c) below doesn't slam it
        //      shut. Default impl returns false, so behaviour is unchanged for every other bot.
        //
        // ⛔ A CLAIM IS A PROMISE TO ACT ON IT. `return true` here takes the whole tick — brain() stops
        // — and the audit found ~30 `return true` sites across 7 handleMainModal overrides that send
        // NOTHING on the tick they claim (the ubiquitous `if (tick - lastBankTick < 2) return true`
        // spacer, and every await-the-count-dialog branch). Each is fine while the state machine keeps
        // moving and each becomes a PERMANENT SILENT FIXPOINT the moment it stops — a deposit-X
        // await with no timeout arm at all is exactly that. Rather than auditing thirty
        // sites in seven files forever, the CLAIM ITSELF is measured here, once, for every override
        // that exists or ever will.
        // TRAVEL NETWORK: a transport that opened its own interface (the gnome glider map) answers it before (b3)/(c) can close it.
        if (this.mainModalId !== -1 && this.mlTransportModal()) { this.clearBranchIdle(); return; }
        if (this.mainModalId !== -1) {
            const before = this.out.pos;
            if (this.handleMainModal()) {
                this.tickBucket = 'banking';
                this.noteModalClaim(this.out.pos === before);
                return;
            }
        }

        // (c) a non-design main modal (e.g. a level-up splash) -> dismiss it
        if (this.mainModalId !== -1) {
            // The facade's modal lease (see holdModalUntil): a wrapper that opened this window owns it
            // for a BOUNDED number of ticks. Unleased behaviour below is unchanged.
            if (this.modalLeased()) { this.tickBucket = 'modal-leased'; this.warm(); return; }
            if (this.tickCount - this.lastActionTick >= 2) {
                this.sendCloseModal();
                this.lastActionTick = this.tickCount;
            } else this.warm();   // the spacer tick is SPENT, never silent
            this.noteModalDismiss();
            this.tickBucket = 'modal-dismiss';
            return;
        }
        // No modal and no dialog: every branch above is behind us, so any modal/branch wedge they left
        // is a TOMBSTONE. A wedge that survives its own cause sends a supervisor after a fault that
        // fixed itself an hour ago — the same argument ackWedge makes for mirroring the ledger.
        this.modalDismissTicks = 0;
        this.modalDismissId = -1;
        this.clearBranchIdle();

        const me = this.playerTile();

        // (d) still on tutorial island (Lumbridge is z~3222) -> talk to the guide
        //     to trigger the skip. Wait a few ticks after accept so the server's
        //     queued script has set %tutorial = designed_character (else the guide
        //     takes the no-skip "return" branch).
        if (!this.leftTutorial && onTutorialIsland(me)) {
            if (this.acceptedTick >= 0 && this.tickCount - this.acceptedTick < 3) return;
            const guide = this.findNearestNpc(n => n.typeId === GUIDE_TYPE);
            if (guide) {
                this.noGuideSince = -1;
                if (this.tickCount - this.lastGuideTalkTick >= 4) {
                    this.sendMove(guide.x, guide.z, true); // MOVE_OPCLICK route (walk-before-op)
                    this.sendOpNpc(guide.index, 1);        // OPNPC1 = Talk-to
                    this.lastGuideTalkTick = this.tickCount;
                    if (!this.quiet) console.log(`[fb] talking to RuneScape Guide (npc ${guide.index}) to skip tutorial`);
                }
                this.tickBucket = 'tutorial';
                return;
            }
            // ⛔ NO GUIDE IN VIEW. THIS `return` USED TO BE THE WHOLE BUG. ⛔
            // It sent nothing, logged nothing (the line above is `!quiet`-gated and most bots run
            // quiet) and never changed any state — a PERFECT FIXPOINT. The engine then kicked the bot
            // on the TIMEOUT_NO_RESPONSE metronome, the supervisor rebuilt a fresh bot with
            // leftTutorial=false, and the fixpoint reformed. 14 times, 75 minutes, zero log lines.
            //
            // The box above now makes the misclassification impossible, but "impossible" is exactly
            // what the previous two versions of that predicate also claimed. So this branch is ALSO
            // made incapable of being quiet: it says WHERE it is and WHY it is doing nothing, and it
            // BAILS OUT. Standing inside the tutorial box with no guide anywhere in the scene means the
            // skip cannot happen from here whatever we believe, so continuing to hunt one is strictly
            // worse than letting the real brain run and be judged by the watchdogs like everyone else.
            if (this.noGuideSince < 0) this.noGuideSince = this.tickCount;
            const waited = this.tickCount - this.noGuideSince;
            if (waited >= TUTORIAL_GUIDE_PATIENCE) {
                console.error(`[fb] ${this.loginUser}: ⛔ TUTORIAL-NO-GUIDE at (${me.x},${me.z}) — this position is ` +
                    `inside the tutorial-island box x[${TUTORIAL_ISLAND.x0},${TUTORIAL_ISLAND.x1}] ` +
                    `z[${TUTORIAL_ISLAND.z0},${TUTORIAL_ISLAND.z1}] but no RuneScape Guide (npc ${GUIDE_TYPE}) has ` +
                    `been in view for ${waited} ticks. Either this bot is NOT on tutorial island (a stale ` +
                    `logout position misclassified — see onTutorialIsland) or the guide is gone. Latching ` +
                    `leftTutorial=true and running the normal brain rather than sitting here silently.`);
                this.tutorialWedge = 'TUTORIAL-NO-GUIDE';
                this.leftTutorial = true;
                // fall through to the normal brain THIS tick — never spend another silent one
            } else {
                // Still inside the grace window. Spend the tick, but SEND — a tick that puts no byte on
                // the wire is a tick the server counts toward the idle kick, and this branch is the one
                // that proved it can last forever.
                this.tickBucket = 'tutorial';
                this.warm();
                return;
            }
        }
        // Off the island -> latch tutorial as DONE so a later trip into the box (wizard tower,
        // etc.) is treated as normal travel, not a tutorial relapse.
        if (!onTutorialIsland(me)) this.leftTutorial = true;

        if (this.mode !== 'idle' && !this.arrived) {
            // Subclass hook, ADDITIVE (base returns false, so every existing brain is byte-identical).
            // Some routes need a scripted step the naive walker cannot express — the Al Kharid toll gate
            // is a DIALOG (pay 10gp) that p_teleports you through, not a door you can open. doTravel is
            // private and owns the whole walk, so the hook lives here, ahead of it.
            // ⛔⛔ DO NOT OVERWRITE A BUCKET THE ASSIST ALREADY NAMED. This line used to read
            // `if (this.travelAssist()) { this.tickBucket = 'traveling'; return; }` — unconditionally —
            // and that one assignment hid the real phase of a stalled bot.
            //
            // `travelAssist()` is an OVERRIDE POINT, and its overrides may set their own, more specific
            // bucket before returning true (the BASE `tollAssist()` sets 'tolling'). Every one of those
            // was then stamped back to 'traveling' here, one line later, by the caller.
            //
            // TWO THINGS WERE WRONG WITH THAT, and neither is cosmetic:
            //   1. THE LABEL. A bot stuck before departure reported `STALL:traveling`, which points at
            //      the planner instead of the step that was actually blocked. The whole point of naming
            //      a phase is that the name says what the bot was trying to do.
            //   2. THE PATIENCE. `progress-watchdog.ts` selects patience BY PHASE and 'traveling' is
            //      500 ticks against the 300 default — so a non-travel stall was being judged against
            //      travel's clock and took ~66% longer to surface.
            //
            // The fix reads the bucket back: it is reset to 'other' once per tick at the top of the
            // brain (leanbot.ts:1996), so "still 'other' after the call" is exactly "the assist named
            // nothing", and only then does the caller supply the generic label.
            const bucketBefore = this.tickBucket;
            if (this.travelAssist()) {
                if (this.tickBucket === bucketBefore) this.tickBucket = 'traveling';
                return;
            }
            // ⛔ ATTRIBUTE THE TRAVEL TICK. `travelAssist` set 'traveling' but `doTravel` — the branch
            // that owns the ENTIRE long walk — set nothing, so every tile of every cross-map trip was
            // charged to 'other'. Two things were wrong with that: the duty-cycle instrument's own
            // documented 'traveling' bucket read ~0 for the base brain, and the progress watchdog
            // selects its patience BY PHASE, so a genuinely long walk was being judged against the
            // 300-tick default instead of travel's 500. LIVE-CAUGHT: a bot wedged at the Al Kharid toll
            // reported `STALL:other`, which is true but says nothing about what it was trying to do.
            this.tickBucket = 'traveling';
            this.doTravel();
            return;
        }

        // (e2b) combat training mode: punch weak NPCs until the HP target.
        if (this.mode === 'combat') {
            this.doCombat();
            return;
        }

        // (e3) heal loop — eat food when HP is low. HP regenerates only very slowly, so eating is
        //      what keeps a damaged bot alive. No-op unless `foodObj` is set and carried.
        if (this.tryHeal()) { this.tickBucket = 'eating'; return; }

        this.idleTick();
    }

    // Combat training (FB_MODE=combat): attack the nearest chicken/rat/goblin
    // with fists until base Hitpoints reaches FB_HP_TARGET (default 20). Server
    // self-routes to the attack target, so no raw MOVE churn while fighting.
    private lastAttackTick = -100;
    private lastSearchMoveTick = -100;   // separate from lastAttackTick — see the searching branch
    protected combatHpTarget = Number(process.env.FB_HP_TARGET ?? 20);
    private fleeing = false;
    private lastDeathSeen = 0;
    private combatTargetIdx = -1; // committed combat target (npc index); -1 = none
    private combatRepick = 0;     // offset so a re-pick chooses a DIFFERENT target
    private lastHpXpVal = -1; private lastHpXpGainTick = -1000;   // -1000: 'no fight has ever run', not 'one just did'

    // --- BUILD ITEM 2: attack style + spare weapon (defaults keep every existing brain identical) ---
    /**
     * npc type ids to attack. Defaults to the weak-npc HP-training set; the trainer overrides it.
     *
     * ⛔ PREFER `setCombatTargetName()` OVER ASSIGNING IDS. A magic id set cannot be checked against
     * anything: an id list like `[23, 26]`, where npc 26 is placed ZERO times in the world, is half dead
     * weight and nothing says so.
     */
    combatTypes: Set<number> = COMBAT_TYPES;
    /** What `combatTypes` was resolved FROM, when it came from a name. '' when ids were set directly. */
    combatTargetName = '';

    /**
     * ⭐ SET THE COMBAT TARGET BY NAME, ONCE, AT ASSIGNMENT.
     *
     * Resolves the display name to the type ids that are both PLACED in the world and advertise an
     * `Attack` op, and says out loud what it found — including the ids that matched the name but exist
     * nowhere (`[23, 26]`) and the ids that matched but cannot be attacked. Falls back to the current
     * set, loudly, when npc-scene was not built in this process.
     *
     * ⛔ NEVER PER TICK. Resolution is ~5us and reaches npc-scene's tables; the hot path only ever
     * tests the resulting `Set`. Call it where a bot is given its job.
     */
    setCombatTargetName(pattern: string | RegExp): Set<number> {
        this.combatTargetName = String(pattern);
        this.combatTypes = resolveTargetOr(pattern, this.combatTypes, s => console.log(`[fb] ${this.loginUser}: ${s}`));
        return this.combatTypes;
    }
    /** Camp centre to walk back to when no target is in scene (was hardcoded to the goblin field). */
    combatAnchor: { x: number; z: number } = GOBLIN_SPOT;
    /** Weapon obj id to keep wielded (-1 = fists). A spare of the SAME id in the pack is the death spare. */
    weaponObj = -1;
    /** IF_BUTTON component id for the wanted attack style. Scimitar/weapon_slash CONTROLLED = 2431. */
    styleButton = -1;
    private stylePrepped = false;
    private styleClicks = 0;
    private styleWieldFails = 0;
    weaponMissing = false;         // wielded nothing and no spare in the pack (post-death, kit gone)
    /** Damage DEALT this session, derived from the engine's own hitpoints grant (see damageDealt()). */
    private hpXpBase = -1;
    // combat.rs2:89 `$base = multiply($damage,10)`, then hitpoints ALWAYS gets `scale(133,100,$base)` =
    // 13.3 arg per damage (combat.rs2:167). Player.ts:1830 multiplies the arg by NODE_XPRATE (25) into the
    // INTERNAL stat — but the wire does NOT carry the internal value: UpdateStatEncoder.ts:11 sends
    // `(exp / 10) | 0`, i.e. DISPLAYED xp. So displayed xp per damage = 13.3 * 25 / 10 = 33.25.
    // ⛔ This was 332.5 (the internal figure) and under-reported damage by exactly 10x — caught LIVE on
    // the probe, where a bot whose strength had climbed 9 -> 19 (~60 damage) was reporting `dmg=6`.
    // Reported as a derived estimate, never as a measured hit log — a miss grants zero, so this is exactly
    // "damage that landed", which is the quantity the whole design budgets in (30,029 to max melee).
    static readonly HP_XP_PER_DAMAGE = 33.25;
    damageDealt(): number {
        if (this.hpXpBase < 0) return 0;
        return Math.max(0, this.hitpointsXp - this.hpXpBase) / LeanBot.HP_XP_PER_DAMAGE;
    }
    /** Wield the configured weapon (or a spare after a death) and set the attack style. True = tick spent.
     *
     * ORDER IS MANDATORY AND WAS A REAL BUG: IfButtonHandler rejects the style click unless the component
     * is visible, and the combat tab is only bound to the weapon's style interface by `if_settab` when a
     * weapon of that class is WORN (player_attackstyles.rs2:154). Clicking while unarmed is silently
     * dropped — which is what once made a hero train ONLY attack. So: wield, THEN click.
     *
     * And `com_mode` is SCOPE_TEMP (no `scope=perm` in all.varp; Player.ts:216 persists only PERM), so it
     * RESETS TO 0 ON EVERY LOGIN. A once-ever click is wrong for a bot that reconnects — re-arm on every
     * new session and after every re-wield. */
    protected prepWeaponStyle(): boolean {
        if (this.weaponObj < 0) return false;                       // fists: nothing to prep
        // ⛔ DO NOT INSIST ON `weaponObj` SPECIFICALLY. Once gear-from-drops is on, tryEquipGear will wear a
        // BETTER same-class weapon (a looted steel scimitar over our bronze) — and if this method still
        // demands weaponObj it re-wields the worse one, gear re-wears the better one, and the two fight over
        // the slot forever, burning every tick and never fighting. REHEARSAL-CAUGHT as 8 "EQUIPPED excalibur"
        // lines in a row. So "armed" means: a weapon is worn that satisfies the class + controlled
        // requirement. weaponObj is only the FALLBACK to reach for when nothing acceptable is on.
        if (this.gearMode && this.acceptablyArmed()) {
            this.styleWieldFails = 0;
            this.weaponMissing = false;
            if (this.styleButton > 0) return this.applyStyle();
            return false;
        }
        const spare = this.slotOf(this.weaponObj);
        if (!this.isWorn(this.weaponObj)) {
            if (spare < 0) {                                        // nothing worn AND no spare = kit lost
                if (!this.weaponMissing) console.log(`[fb] ${this.loginUser}: WEAPON LOST (no ${this.weaponObj} worn or in pack) — fighting with fists`);
                this.weaponMissing = true;
                return false;                                       // fall through to fists rather than idle
            }
            if (this.styleWieldFails > 8) return false;                  // server keeps refusing: don't spin
            this.styleWieldFails++;
            this.opHeld2(this.weaponObj, spare);                    // OPHELD2 = Wield
            this.stylePrepped = false; this.styleClicks = 0;        // a (re-)wield resets the style
            this.weaponMissing = false;
            this.warm();
            return true;
        }
        this.styleWieldFails = 0;
        this.weaponMissing = false;
        if (this.styleButton > 0) return this.applyStyle();
        return false;
    }

    /** ⭐ THE SET-WITH-VERIFY REPLACEMENT for the blind triple-click (P0-D).
     *
     * WHAT THE OLD CODE DID: click `styleButton`, three times, then latch `stylePrepped = true` and
     * never look again. The three clicks existed to "absorb the tab-visibility timing" — i.e. it was
     * already known that the click can be dropped, and the response was to send more of them and hope.
     * If all three landed while unarmed (or before `if_settab` bound the tab), the bot trained the wrong
     * stat for the rest of the session and every counter said it was fine.
     *
     * WHAT THIS DOES: click, then read `com_mode` back off the server and keep clicking (at a sane
     * interval) until it matches — then stop. If it never matches, LATCH `styleFailed` and say so at
     * error level, because a bot that cannot select its style is not a healthy bot doing slightly worse,
     * it is a bot training a stat nobody asked for.
     *
     * FB_STYLE_VERIFY=0 restores the old blind-triple-click path verbatim — the rollback switch, since
     * this sits in the combat path of every bot.
     */
    private styleVerify = process.env.FB_STYLE_VERIFY !== '0';
    private applyStyle(): boolean {
        if (!this.styleVerify) {
            // legacy path, byte-identical to the pre- behaviour
            if (this.stylePrepped) return false;
            this.ifButton(this.styleButton);
            if (++this.styleClicks >= 3) this.stylePrepped = true;
            this.warm();
            return true;
        }
        const sent = this.setCombatStyleByButton(this.styleButton);
        // Keep the legacy flags meaningful for anything that reads them (subclasses, status lines).
        this.stylePrepped = this.styleConfirmed;
        if (sent) { this.styleClicks++; this.warm(); return true; }
        return false;
    }

    /** Re-arm weapon/style prep — call on a death or a fresh session.
     *  ⛔ MUST also clear the VERIFY state: com_mode is SCOPE_TEMP and resets to 0 on every login, so a
     *  reconnect that kept `styleConfirmed` from the previous session would never re-assert the style. */
    protected rearmStyle(): void {
        this.stylePrepped = false; this.styleClicks = 0; this.styleWieldFails = 0;
        this.styleConfirmed = false; this.styleFailed = false;
        this.styleAttempts = 0; this.styleWantCom = -1; this.styleWantIdx = -1;
    }

    // ========================================================================
    // GEAR FROM DROPS — take + equip genuine upgrades (user requirement)
    // ========================================================================
    // OFF by default (gearMode=false), so every existing brain is unchanged. The table is GENERATED from
    // content by data/extract-gear.mjs; see gear-table.ts for the three ways a wear silently no-ops.
    gearMode = false;
    /** Is this a MEMBERS world? The demo is; a bare local engine is NOT, and that changes everything
     *  (ObjType.ts:59-73 strips iop/category/params from members objs, so OPHELD2 dies silently). */
    // Parsed the way the ENGINE parses its own booleans (TryParse.ts:1-9: only the literal 'true'/'false'
    // count, anything else falls back to the default). A `!== '0'` test would have read FB_MEMBERS=false as
    // TRUE — and a wrong members flag makes every gear verdict wrong in the silent direction.
    worldMembers = process.env.FB_MEMBERS === 'false' ? false : true;
    /** Weapon class whose style BUTTON we know (styleButton). Swaps stay inside it, or the button stops
     *  selecting controlled — a different weapon class opens a different combat interface. */
    weaponClass: string | null = null;
    /** Must the bot keep a CONTROLLED style? (the max-stats trainer: yes) */
    requireControlled = false;
    /** The damagetype this camp's npcs hit with — decides which defence stat we optimise. */
    incomingDamage = 'crush_style';
    gearTaken = 0;
    gearEquipped = 0;
    private gearWearFails = new Map<number, number>();
    private gearUnwearable = new Set<number>();   // quest-locked / no-iop2 / server keeps refusing
    private lastGearWearTick = -100;

    // ---- THE OSCILLATION LATCH -------------------------------------------------------------------
    // ⛔ A BOUNDED, COUNTED GIVE-UP — the same shape as the 4-refusal wear blacklist above, aimed at the
    // other failure: not a wear the server REFUSES, but two wears the server GRANTS in turn forever.
    // The 2H fix in gear-table removes the known cycle; this catches the unknown one, because the live
    // cost of a cycle is total (74% of all log output, zero xp, zero gp, and the bot half-naked) while
    // the cost of latching is one frozen loadout. Never unbounded retry, and never silent.
    /** re-wears of ONE obj inside `gearSwapWindow` ticks before the loadout is frozen (FB_GEAR_SWAP_MAX). */
    gearSwapMax = Math.max(1, Number(process.env.FB_GEAR_SWAP_MAX ?? 3));
    /** How close together two wears of the same obj must be to count as a SWAP rather than a legitimate
     *  re-arm. Re-wielding after each of three deaths is hundreds of ticks apart; a cycle is a handful
     *  (FB_GEAR_SWAP_WINDOW). */
    gearSwapWindow = Math.max(1, Number(process.env.FB_GEAR_SWAP_WINDOW ?? 100));
    /** TRUE once the loadout has been frozen. ⛔ This is a FAILURE state — never render it as a wear. */
    gearLatched = false;
    /** what tripped the latch, for the status line (empty while healthy). */
    gearLatchReason = '';
    /** wears suppressed since the latch fired — the size of the thrash that would otherwise be running. */
    gearWearsSuppressed = 0;
    private gearWearHistory = new Map<number, { tick: number; n: number }>();

    /** RS stat indices (statLevel/statXp): 0 att, 1 def, 2 str, 3 hp, 4 ranged, 5 prayer, 6 magic. */
    private gearCtx(): UpgradeCtx {
        return {
            levels: {
                attack: this.statLevel[0] ?? 1, defence: this.statLevel[1] ?? 1, strength: this.statLevel[2] ?? 1,
                ranged: this.statLevel[4] ?? 1, magic: this.statLevel[6] ?? 1,
            },
            members: this.worldMembers,
            comMode: 0,   // only consulted when requireControlled is false
            incoming: this.incomingDamage,
            weaponClass: this.weaponClass,
            requireControlled: this.requireControlled,
            usableWeapon: it => this.weaponUsable(it),
        };
    }

    /**
     * Can this weapon actually SWING for us right now?
     *
     * ⛔ THE ONE CASE THAT IS NOT A DEGRADED WEAPON BUT NO WEAPON AT ALL: a bow with no firable arrow.
     * `player_ranged.rs2` will not fire it, so it deals ZERO damage — worse than bare fists, which still
     * use `weapon_unarmed_table`. A salvaged shortbow scores 1,152 on the dps estimate and would otherwise
     * beat a bronze scimitar's 1,242 the moment the weapon slot is empty; live, that put a champion on a
     * contested hill holding a bow it could not shoot.
     *
     * The firing rule itself is `canBowFire` from ranged-kit (player_ranged.rs2:97-99, ammo tier <= bow
     * tier) — REUSED, not restated. RangedBot's `ammoState()` is the three-valued form of this same
     * question, for a caller that must tell "ship a better bow" from "ship more arrows".
     */
    protected weaponUsable(item: GearItem): boolean {
        const ammoCat = ammoCategoryFor(item);
        if (!ammoCat) return true;                             // melee, thrown, javelin: its own ammo
        // The QUIVER first (worn inv) — the only place player_ranged_check_ammo looks — then the pack,
        // because `tryEquipArrows` moves pack arrows into it as soon as the bow is worn.
        for (const row of this.heldAmmoRows()) {
            if (row.category !== ammoCat) continue;
            if (ammoCat === 'arrows' && !canBowFire(item, row)) continue;   // steel arrows in a shortbow
            return true;
        }
        return false;
    }
    /** Every quiver-slot obj we hold, worn or packed, with a positive count. */
    private heldAmmoRows(): GearItem[] {
        const out: GearItem[] = [];
        const w = this.invs.get(WORN_INTERFACE);
        if (w) for (let i = 0; i < w.ids.length; i++) {
            if (w.ids[i]! <= 0 || w.counts[i]! <= 0) continue;
            const row = gearFor(w.ids[i]!);
            if (row && row.slot === QUIVER_SLOT) out.push(row);
        }
        for (const s of this.backpackSlots()) {
            if (s.count <= 0) continue;
            const row = gearFor(s.obj);
            if (row && row.slot === QUIVER_SLOT) out.push(row);
        }
        return out;
    }

    /** The worn weapon's name, or `UNARMED`. The one readout that answers "can this bot fight?". */
    armedWith(): string {
        const row = this.wornGear().get(WEAPON_SLOT);
        if (!row) return 'UNARMED';
        return this.weaponUsable(row) ? row.name : `${row.name}(NO-AMMO)`;
    }

    /** What we are wearing in each worn-inv slot, as gear rows (undefined = empty/unknown obj). */
    private wornGear(): Map<number, GearItem> {
        const out = new Map<number, GearItem>();
        const w = this.invs.get(WORN_INTERFACE);
        if (!w) return out;
        for (let i = 0; i < w.ids.length; i++) {
            const id = w.ids[i]!;
            if (id <= 0) continue;
            const row = gearFor(id);
            if (row) out.set(row.slot, row);
        }
        return out;
    }
    /** One-letter-per-slot worn readout for the reporter (weapon/hat/torso/legs/shield). */
    wornSummary(): string {
        const g = this.wornGear();
        const tag = (slot: number) => {
            const it = g.get(slot);
            if (!it) return '-';
            const m = /^(bronze|iron|steel|black|mithril|adamant|adamnt|rune|dragon|leather|hardleather|studded)/.exec(it.name);
            return m ? (m[1] === 'adamnt' ? 'a' : m[1]![0]!) : '?';
        };
        return `w${tag(3)}h${tag(0)}b${tag(4)}l${tag(7)}s${tag(5)}`;
    }
    /** Would taking this ground obj be a real upgrade for us right now? */
    protected gearUpgradeDelta(objId: number): number {
        const row = gearFor(objId);
        if (!row || this.gearUnwearable.has(objId)) return 0;
        // ⛔ WHOLE LOADOUT, NOT THE SLOT. A shield is not an upgrade while a two-handed weapon is worn,
        // however empty the shield slot looks — see loadoutDelta. And a latched bot wants no more gear:
        // it cannot wear what it takes, so taking it only fills the pack.
        if (this.gearLatched) return 0;
        return loadoutDelta(row, this.wornGear(), this.gearCtx());
    }
    /** Equip the best upgrade sitting in the backpack. True = this tick is spent. */
    protected tryEquipGear(): boolean {
        if (!this.gearMode) return false;
        if (this.gearLatched) { this.gearWearsSuppressed++; return false; }
        if (this.tickCount - this.lastGearWearTick < 3) return true;   // let a prior wear land before re-scanning
        const ctx = this.gearCtx();
        const worn = this.wornGear();
        let best: { id: number; slot: number; delta: number } | null = null;
        for (const s of this.backpackSlots()) {
            if (this.gearUnwearable.has(s.obj)) continue;
            const row = gearFor(s.obj);
            if (!row) continue;
            const d = loadoutDelta(row, worn, ctx);
            if (d > 0 && (!best || d > best.delta)) best = { id: s.obj, slot: s.slot, delta: d };
        }
        if (!best) return false;
        // ⛔ SELF-HEAL. A wear can be refused for reasons the table cannot see (an unknown gate handler, a
        // quest varp we mis-read, a members flag that disagrees with the world). Count the refusals and
        // BLACKLIST after 4 — otherwise the bot re-offers the same doomed item forever and never fights.
        const fails = (this.gearWearFails.get(best.id) ?? 0) + 1;
        this.gearWearFails.set(best.id, fails);
        if (fails > 4) {
            this.gearUnwearable.add(best.id);
            console.log(`[fb] ${this.loginUser}: gear ${best.id} refused ${fails}x — BLACKLISTING (unseen gate?)`);
            return false;
        }
        this.opHeld2(best.id, best.slot);
        // ⛔ RESTYLE ON EVERY WEAPON CHANGE. The attack-style tab is REBUILT per weapon
        // (player_attackstyles.rs2:128/:197), so a swap silently resets com_mode to that weapon's default —
        // which is ACCURATE, not controlled. Without this a bot that upgrades its scimitar (or is handed one
        // by the armourer, or re-wields a spare after a death) keeps training only attack while every log
        // line still says it is armed. One re-arm point for all three paths.
        if (best.slot === 3) this.rearmStyle();
        this.lastGearWearTick = this.tickCount;
        return true;
    }
    /** Called when the worn set changes, to confirm a wear landed and clear its fail counter. */
    private lastWornIds = new Set<number>();
    private lastWornWeapon = 0;
    private noteGearWorn(): void {
        // Count an equip when an id NEWLY APPEARS in the worn inv. Keying off the fail-counter instead
        // double-counted every re-wear (one item logged 8 times in the rehearsal), and a metric that
        // inflates is worse than no metric — it would have "proved" gear progression that wasn't happening.
        const now = new Set<number>();
        const wornWeapon = this.wornGear().get(3)?.id ?? 0;
        if (wornWeapon !== this.lastWornWeapon) {
            // Belt-and-braces on the restyle above: catches a weapon change we did NOT initiate (a
            // death re-wield, an armourer delivery equipped by another path, a server-side swap).
            this.lastWornWeapon = wornWeapon;
            if (wornWeapon > 0) this.rearmStyle();
        }
        for (const [, it] of this.wornGear()) {
            now.add(it.id);
            this.gearWearFails.delete(it.id);          // it went on: clear any refusal streak
            if (!this.lastWornIds.has(it.id)) {
                this.gearEquipped++;
                console.log(`[fb] ${this.loginUser}: EQUIPPED ${it.name} (${this.wornSummary()})`);
                this.noteWearChurn(it);
            }
        }
        this.lastWornIds = now;
    }

    /**
     * Count RE-wears of one obj and freeze the loadout if they keep coming.
     *
     * The window is what separates the two shapes: re-wielding a scimitar after each of three deaths is
     * healthy and hundreds of ticks apart, while an equip cycle re-wears the SAME obj every few ticks
     * forever. Only the second trips the latch.
     */
    private noteWearChurn(it: GearItem): void {
        const prev = this.gearWearHistory.get(it.id);
        const n = prev && this.tickCount - prev.tick <= this.gearSwapWindow ? prev.n + 1 : 1;
        this.gearWearHistory.set(it.id, { tick: this.tickCount, n });
        if (this.gearWearHistory.size > 64) {
            for (const [id, h] of this.gearWearHistory) {
                if (this.tickCount - h.tick > this.gearSwapWindow) this.gearWearHistory.delete(id);
            }
        }
        if (n <= this.gearSwapMax || this.gearLatched) return;
        this.gearLatched = true;
        this.gearLatchReason = `${it.name} re-worn ${n}x in ${this.gearSwapWindow}t`;
        // ⛔ SAY IT AS A FAILURE. This must never be mistaken for the `EQUIPPED` line above it: the loop
        // it ends produced 24,868 of those and the bot made no progress the whole time.
        console.error(`[fb] ${this.loginUser}: ⛔ GEAR LATCHED — ${this.gearLatchReason}. Two objs are fighting ` +
            `over one worn slot (a two-handed weapon against a shield?). FREEZING the loadout at ` +
            `${this.wornSummary()} armed=${this.armedWith()}; no further wears this session.`);
    }
    /** Hook: handle a scripted obstacle on the travel route. Return true = this tick is spent. */
    protected travelAssist(): boolean { return this.tollAssist(); }

    // =============================================================================================
    // THE AL KHARID TOLL GATE — shared crossing, inherited by EVERY brain
    // =============================================================================================
    // ⛔ WHY THIS LIVES IN THE BASE AND NOT IN A BRAIN. Per-brain copies missed the brain that actually
    // needed it: a brain with its own travel loop never reached LeanBot.travelAssist and never overrode
    // driveDialog, so the base answered the toll's p_choice3 with option 1 = "No thank you, I'll walk
    // around." 2,587 times across 15 minutes, at 0 gp, while the connection looked perfectly healthy.
    //
    // THE MECHANISM, exactly (verified offline against the planner):
    //   navgrid masks the gate open (it is shape 0 / angle 0 = a wall on the tile's WEST edge, and it
    //   IS a door), so planRoute's FIRST STEP out of (3268,3227) is (3267,3227) — straight through the
    //   toll. The server refuses that step forever, so the walk never leaves waypoint 1
    //   (`wp=1/1014 still=10`), the stall handler blind-OPLOCs the "Gate", and the dialog it opens gets
    //   declined. Every escalation the travel loop has (recompute -> door sweep -> LOOP-STUCK reset)
    //   re-derives the SAME first step, which is why 15 stuck windows changed nothing.
    //
    // WHY PAYING AND NOT ROUTING AROUND. Both were measured with the planner. Walking around the
    // fence's north end is a REAL route (983 waypoints vs 906, +8.5%) — but it crosses the x=3268
    // meridian at (3268,3234)->(3267,3235), i.e. straight along the railing-997 line, which is exactly
    // this project's fake-gap trap class ("513 fake-gap edges, source of every Draynor trap"). The toll
    // is 10 gp, it is two packets, and it
    // p_teleports us onto waypoint 2 of the route the planner ALREADY produced. Paying is both cheaper
    // and the only one of the two that is proven.
    /** Toll crossings this bot has paid for, and dialogs it opened on purpose. Reported, never hidden. */
    tollAccepts = 0;
    tollAttempts = 0;
    /** LOUD: set once we are at the gate, want to cross, and cannot afford the 10 gp. */
    tollBroke = false;
    // protected, not private: a subclass that drives its own toll step reads the same clocks.
    protected lastTollTick = -100;
    protected lastTollAcceptTick = -100;
    protected tollBrokeSince = -1;

    /**
     * Where this brain ultimately wants to be, for TOLL purposes ONLY.
     *
     * ⛔ THE DESTINATION, NOT THE NEXT WAYPOINT. A via-point on our own side of the wall answers "no
     * crossing needed" and disarms the toll for the rest of the walk — that is how an earlier copy
     * silently did nothing. Return `null` for "no travel intent", which never pays and never crosses.
     */
    protected tollDestination(): TollTile | null {
        return this.arrived ? null : this.travelDest;
    }

    mustCrossToll(): boolean {
        const dest = this.tollDestination();
        if (!dest) return false;
        // ⛔ A PLANNED ROUTE TO THIS VERY DESTINATION IS THE TRUTH (toll-gate.ts routeCrossesTollFrom): the walker
        // walks the route, not the half-plane. A destination that is "same side" by the map can still be routed
        // through the gate by the planner — the toll never armed and the bot wedged 500+ ticks. No route yet, or
        // a brain whose toll destination is not the current travel destination, falls back to the geography.
        const p = this.travelPath;
        if (p && p.length > 1 && !this.arrived && dest.x === this.travelDest.x && dest.z === this.travelDest.z)
            return routeCrossesTollFrom(p, this.travelIdx, this.tile());
        return crossesToll(this.tile(), dest);
    }

    /**
     * Pay our way through the gate. Returns true when this tick was spent on the crossing.
     * Safe to call unconditionally from any travel loop: it is a no-op unless the wall is genuinely
     * between this bot and its destination AND we are already near the gate.
     */
    protected tollAssist(): boolean {
        this.skipPaidTollStep();
        if (!this.mustCrossToll()) { this.tollBroke = false; this.tollBrokeSince = -1; return false; }
        const me = this.tile();
        if (!atTollGate(me)) return false;              // not our business yet — let the walker walk

        // ⛔ BROKE IS A LOUD FAILURE, NOT A QUIET LOOP. The border guards are not pickpocketable and the
        // gate is a dead end, so a bot that reaches it with <10 gp can NEVER get through where it
        // stands. Say so, once a minute, on stderr — "absence must never look like zero". A brain that
        // can do something about it (e.g. fetch coins first) overrides travelAssist and never gets here.
        if (this.coins() < TOLL_COST) {
            if (this.tollBrokeSince < 0) this.tollBrokeSince = this.tickCount;
            this.tollBroke = true;
            if ((this.tickCount - this.tollBrokeSince) % 100 === 0) {
                console.error(`[fb] ${this.loginUser}: ⛔ TOLL-BROKE at (${me.x},${me.z}) — ${this.coins()} gp, ` +
                    `toll costs ${TOLL_COST}; cannot cross to ${tollSideOf(me) === 'east' ? 'west' : 'east'}. Needs coins.`);
            }
            return false;                               // let the base close the dialog; do not spin
        }
        this.tollBroke = false; this.tollBrokeSince = -1;

        // Stand on the operable tile on OUR side. Standing exactly there makes BOTH content paths work
        // with no further movement: the same-side guard is inside npc_find(coord, borderguardN, 1, 0),
        // and the gate loc is adjacent for the OPLOC path.
        // ⛔ walkToExact, NEVER a bare sendMove. The server is a naive router: from (3263,3226) every
        // gate-adjacent tile is 5 legal steps for a chebyshev distance of 4, so a single far MOVE is
        // corner-cut into the fence and wedges permanently.
        const stand = tollStandFrom(me);
        if (tollCheb(me, stand) !== 0 && this.walkToExact(stand.x, stand.z)) { this.tickBucket = 'traveling'; return true; }

        // ⛔ GIVE THE TOLL ITS OWN TICK BUCKET. Wave 1's budget read `{other:3257, traveling:24}` and
        // nobody could tell that every one of those ticks was a toll dialog.
        this.tickBucket = 'tolling';
        if (this.tickCount - this.lastTollTick < 8) { this.warm(); return true; }   // let the script run
        this.lastTollTick = this.tickCount;
        this.tollAttempts++;

        // Prefer OPNPC1 on the guard on OUR side: the engine self-routes to him and
        // talk_to_border_guard then ~forcemove()s us onto the operable tile for free. The gate is SHUT,
        // so the guard across it is "I can't reach that!" forever — tollGuardFrom() picks ours.
        const guardType = tollGuardFrom(me);
        const guard = this.findNearestNpc(n => n.typeId === guardType);
        if (this.tollAttempts % 20 === 1) {
            console.log(`[fb] ${this.loginUser}: TOLL try #${this.tollAttempts} at (${me.x},${me.z}) side=${tollSideOf(me)} ` +
                `coins=${this.coins()} guard${guardType}=${guard ? `idx${guard.index}@d${guard.dist}` : 'not in scene (OPLOC path)'}`);
        }
        // ⛔ HISTORICAL FAILURE #2, AND THE REASON THIS ASSERTION IS NOT "THE DIALOG ADVANCED".
        // The blind option-1 answer DECLINED this toll 2,587 times and the dialog advanced PERFECTLY
        // every single time, so a generic "did the server respond" check would have called all 2,587 of them a success. The only honest
        // observable for a toll is the INTENT: either 10 gp left the pack, or the engine teleported us
        // across. Armed HERE (not at the accept) so it covers whoever answers the dialog — including a
        // stall handler's blind opener.
        this.expectAck(AckKind.PayToll, TOLL_GATE.loc, 0, COINS_OBJ);
        if (guard) { this.opNpc(guard.index, 1); return true; }          // -> talk_to_border_guard(null)
        this.opLoc(TOLL_GATE.x, TOLL_GATE.z, TOLL_GATE.loc, 1);          // -> find_and_talk_to_border_guard
        return true;
    }

    /**
     * After the toll teleports us across, the walker can still be aiming at a waypoint on the FAR side of the fence (its
     * index was re-seeded by distance while we stood on the stand — sim trace aimed at (3268,3226) from
     * (3267,3227), i.e. straight back through the railing, until the wedge watchdog re-planned). If the route's gate
     * step lies just behind us — its FROM tile across the fence, its TO tile beside us — aim at the TO tile instead.
     */
    private skipPaidTollStep(): void {
        const p = this.travelPath;
        if (!p || this.arrived || p.length < 2) return;
        const me = this.tile();
        if (!atTollGate(me, 3)) return;
        const west = me.x < TOLL_GATE.x;
        for (let i = Math.max(0, this.travelIdx - 1); i + 1 < p.length && i <= this.travelIdx + 12; i++) {
            const a = p[i]!, b = p[i + 1]!;
            if (stepCrossesTollGate(a, b) && (a.x < TOLL_GATE.x) !== west && tollCheb(me, b) <= 2) {
                if (this.travelIdx < i + 1) this.travelIdx = i + 1;
                return;
            }
        }
    }

    /**
     * Is the choice dialog in front of us THE TOLL, and should we pay it?
     *
     * ⛔ GEOGRAPHY, NOT A LATCH. The obvious guard is "a flag I set when I OPLOCed the gate", and it is
     * wrong: in the live wedge the modal was opened by the TRAVEL LOOP'S BLIND DOOR-OPENER, not by any
     * toll code, so no latch this class could set would have covered it. All four clauses matter:
     *   1. a multiN choice is open      -> there is something to answer
     *   2. the wall is still between us and our destination -> the instant the accept teleports us
     *                                      across, this goes false and we stop (an earlier version armed
     *                                      off a lifetime flag and paid 19 tolls for one crossing)
     *   3. we are AT the gate           -> nothing else within 8 tiles opens a p_choice
     *   4. we can actually pay          -> broke, let the base decline so the dialog closes and
     *                                      tollAssist's TOLL-BROKE line is what the supervisor sees
     */
    tollDialogIsOurs(): boolean {
        if (!DIALOG_ROOT_BY_ID.has(this.chatModalId)) return false;
        if (!this.mustCrossToll()) return false;
        if (!atTollGate(this.tile(), TOLL_RADIUS)) return false;
        if (this.coins() < TOLL_COST) return false;
        if (this.tickCount - this.lastTollAcceptTick < 8) return false;   // one accept per dialog, not per tick
        return true;
    }
    /** True if the WORN weapon already satisfies our class + controlled contract (so leave it alone). */
    protected acceptablyArmed(): boolean {
        // Resolve the weapon through the GEAR TABLE rather than trusting an index. The live worn inv is
        // indexed by wearpos, but reading `ids[3]` literally is brittle — it silently found nothing in the
        // sim, where worn items pack from 0, and the wield war it was meant to stop reappeared. wornGear()
        // keys every worn obj by its OWN declared slot, so this is right on both.
        const row = this.wornGear().get(3);     // slot 3 == righthand
        if (!row) return false;
        if (this.weaponClass && row.category !== this.weaponClass) return false;
        if (this.requireControlled && controlledComMode(row) < 0) return false;
        return true;
    }
    // Fenced-field gate passage (cow field etc). FB_GATE="x,z,locId[;x,z,locId]"
    // = openable gate loc(s). The offline pathfinder wrongly sees the fence as
    // open, so doTravel parks us just WEST of the gate; we OPLOC-Open it and step
    // 1 east, retrying if it auto-closed (user-validated recipe).
    protected gates = (process.env.FB_GATE ?? '').split(';').filter(Boolean).map(s => { const [x, z, loc] = s.split(',').map(Number); return { x, z, loc }; });
    protected gatePassed = false;
    private lastGateTick = -100;
    protected doCombat(): void {
        if (this.maxHp >= this.combatHpTarget) {
            if (this.tickCount % 100 === 0) {
                console.log(`[fb] ${this.loginUser}: HP target reached (base hp ${this.maxHp} >= ${this.combatHpTarget}) — idle`);
            }
            if (this.tickCount % 5 === 0) this.out.p1Enc(Out.NO_TIMEOUT);
            return;
        }
        // Death (goblin got us) -> we respawned at Lumbridge: walk back out.
        if (this.deathCount !== this.lastDeathSeen) {
            this.lastDeathSeen = this.deathCount;
            this.arrived = false;
            this.travelPath = null;
            this.fleeing = false;
            this.gatePassed = false; // respawned at Lumbridge -> re-open the gate on the way back
            // A DEATH DROPS EVERYTHING, weapon included (death.rs2 keeps 3). So the wielded weapon is
            // gone and a spare (if any) is gone too — re-arm so the wield+style prep runs again from
            // scratch on the way back, rather than believing a style we no longer have.
            this.rearmStyle();
            return; // brain's (e2) travel branch takes over next tick
        }
        // Damage baseline — set on the first combat tick so damageDealt() measures THIS session only.
        if (this.hpXpBase < 0 && this.hitpointsXp > 0) this.hpXpBase = this.hitpointsXp;
        // Keep the bone ledger honest every tick (inventory truth, not packet optimism).
        if (this.lootBury) this.accountBones();
        // Fenced-field gate: open it and step through before we can fight inside.
        if (this.gates.length && !this.gatePassed && this.passGate()) return;
        // Death is a FREE full-HP reset. HP-xp comes only from damage DEALT, and
        // natural regen is ~1hp/30s — so fleeing to regen from 4->10 wastes ~3 min
        // dealing zero damage. Dying instead respawns us at Lumbridge at full 10 HP;
        // the ~30s walk back beats fleeing 4-6x. So by DEFAULT we do NOT flee — we
        // fight to the death and let the death handler above walk us back. FB_FLEE=1
        // restores the old retreat-and-regen behaviour if ever needed.
        if (process.env.FB_FLEE === '1') {
            if (this.fleeing && this.hp >= 7) this.fleeing = false;
            if (this.fleeing || (this.hp >= 0 && this.hp <= 4)) {
                this.fleeing = true;
                if (this.tickCount - this.lastAttackTick >= 6) {
                    this.sendMove(GOBLIN_SPOT.x + 2, GOBLIN_SPOT.z - 14, true); // south of the cluster
                    this.lastAttackTick = this.tickCount;
                }
                return;
            }
        }
        // ⛔ FIRST, ONCE: turn AUTO-RETALIATE off. It must be sent from the combat brain rather than at
        // login time because it is a UI button — the interface has to exist — and because only combat
        // brains want it. One packet per session, latched, and never sent when the flag is off so the
        // control arm of an A/B comparison is byte-identical to the default behaviour.
        if (this.retaliateOff && !this.retaliateOffSent) {
            this.ifButton(LeanBot.RETALIATE_OFF_BUTTON);
            this.retaliateOffSent = true;
            if (!this.quiet) console.log(`[fb] ${this.loginUser}: AUTO-RETALIATE OFF (if_button ${LeanBot.RETALIATE_OFF_BUTTON}) — the brain owns target choice now`);
            this.tickBucket = 'retalOff';
            return;
        }

        // EAT FIRST — relative threshold (healFrac). Nothing below matters if we die holding the kit.
        if (this.foodObj >= 0 && this.hp >= 0 && this.maxHp > 0 && this.hp <= this.eatAtHp()
            && this.tickCount - this.lastEatTick >= 3) {
            const fs = this.slotOf(this.foodObj);
            if (fs >= 0) { this.opHeld1(this.foodObj, fs); this.lastEatTick = this.tickCount; this.tickBucket = 'eating'; return; }
        }

        // WIELD + STYLE. Also the spare-weapon re-equip: after a death the worn weapon is gone, so the
        // moment a spare exists in the pack this wields it and re-clicks the style.
        if (this.prepWeaponStyle()) { this.tickBucket = 'gearing'; return; }

        // GEAR: equip anything in the pack that beats what we are wearing. Ahead of looting so a just-taken
        // upgrade goes ON before we spend slots on more drops, and ahead of attacking so we fight in it.
        if (this.tryEquipGear()) { this.tickBucket = 'gearing'; return; }

        // LOOT + BURY (item 1). BURY BEFORE TAKE: burying frees the slot the next take needs, and a full
        // 28-slot pack makes the engine throw fresh drops ON THE FLOOR (the cake-husk failure shape).
        // And burying must never be interleaved with a MOVE — tryBuryBones holds the tick for
        // buryCadence, so no take/attack MOVE can cancel the pending bury.
        if (this.tryBuryBones()) { this.tickBucket = 'burying'; return; }
        if (this.tryTakeLoot()) { this.tickBucket = 'looting'; return; }

        // Spread bots across the visible targets by uid — everyone piling onto
        // the single NEAREST npc leaves the rest of the cluster untouched (one
        // npc fights one attacker; the others get nothing done).
        const targets: { index: number; x: number; z: number }[] = [];
        for (let i = 0; i < this.npcCount; i++) {
            const index = this.npcIndices[i];
            const npc = this.npcs[index];
            if (!npc || !this.combatTypes.has(npc.typeId)) continue;
            const w = this.npcWorld(npc);
            targets.push({ index, x: w.x, z: w.z });
        }
        if (targets.length === 0) {
            // ⛔ THE SCENE EMPTIED: drop any claim first. This branch returns BEFORE target selection, so a
            // release placed only on the re-pick path would leak the spawn until the TTL expired — and a
            // leaked claim is a spawn no other bot in the process may take (sim-caught).
            if (this.combatTargetIdx >= 0) { this.targetClaims?.release(this.combatTargetIdx, this.uid); this.combatTargetIdx = -1; }
            const anchor = this.combatAnchor;
            if (process.env.FB_GATE && this.tickCount % 30 === 0) { const m = this.playerTile(); console.log(`[fb] ${this.loginUser} t${this.tickCount}: COW-DBG no targets, walk->(${anchor.x},${anchor.z}) from (${m.x},${m.z})`); }
            // no targets in scene -> walk back toward the camp centre.
            // ⛔ ITS OWN THROTTLE. This branch used to stamp `lastAttackTick`, which is ALSO the 8-tick
            // attack gate — so every searching tick bought an 8-tick (2.4s) attack blackout the moment a
            // target reappeared. At a 9-spawn camp with 50-tick respawns, "no target in scene" happens
            // constantly, so this was pure duty-cycle loss charged to exactly the metric the probe
            // measures. (It also fires on the very first tick after any login/rebuild, because the brain
            // runs on PLAYER_INFO and NPC_INFO arrives after it.)
            // ⛔ NEVER MOVE TO THE TILE WE ARE ALREADY ON. `MoveClickHandler.ts:41-43` is the ONLY place the
            // engine sets `AllowRepath.NONE`, and it does so for exactly one packet shape: a MOVE whose single
            // waypoint IS the player's current tile ("clicking on their current tile"). Once NONE is set,
            // `Player.ts:1082`'s `allowRepath === BEFOREDEST` guard fails forever, `naivePathToTarget()` never
            // runs, and the engine STOPS closing on an op target — so when a warrior respawns the bot stands
            // still while this brain счита the tick as `approach`. This branch fired `sendMove(anchor)` every
            // 3 ticks, and a bot with no target in view is usually STANDING ON the anchor: it was arming the
            // stall over and over. (Verified against the engine source, then reproduced in the sim.)
            const at = this.playerTile();
            if (this.tickCount - this.lastSearchMoveTick >= 3 && (at.x !== anchor.x || at.z !== anchor.z)) {
                this.sendMove(anchor.x, anchor.z, true);
                this.lastSearchMoveTick = this.tickCount;
            } else if (at.x === anchor.x && at.z === anchor.z) {
                this.selfTileMovesSuppressed++;
            }
            this.tickBucket = 'searching';
            return;
        }
        // Commit to one target until it dies/leaves scene, THEN pick a new one
        // (uid-spread). Re-picking every tick thrashes as targets wander in/out of
        // view. BUT drop a target that yields no HP-xp for ~30 ticks (unreachable /
        // across a fence — else we attack it forever), advancing the pick offset.
        // ⛔ hp XP IS THE ONLY HONEST SWING SIGNAL. Every landed hit grants hitpoints xp (combat.rs2:167), so
        // a tick where `hitpointsXp` moved is a tick the SERVER swung for us. Nothing else the client can see
        // says that. Captured BEFORE the stamp so the bucketing below can use it.
        // The swing ledger is maintained at the DECODE (see the hp-xp branch): a grant that lands while the
        // brain is eating or looting still counts, and gaps are not merged. Here we only READ it.
        // ⛔ ONE TICK OF SLACK, BY PACKET ORDER: UPDATE_STAT is written in processClientsOut, i.e. AFTER the
        // PLAYER_INFO the brain ticks on — so a swing landed at tick T is only visible to the brain at T+1.
        // An exact `=== tickCount` test therefore never fires (sim-caught: swingsLanded climbed while the
        // `swinging` bucket stayed empty). The bucket means "a swing landed on, or just before, this tick".
        const xpLanded = this.tickCount - this.lastHpXpGainTick <= 1;
        // ---- DID THE LAST OP ARM A FIGHT? ----------------------------------------------------------
        // Resolved here (not at send time) because the answer only exists a few ticks later. An op that
        // produced no xp inside the window did NOT start a fight — and that, not the cadence, is the gap.
        if (this.pendingOpTick >= 0) {
            if (this.lastHpXpGainTick > this.pendingOpTick) this.pendingOpTick = -1;         // it armed
            else if (this.tickCount - this.pendingOpTick > this.opArmWindow) {
                // only an op sent IN REACH can have failed to engage; the rest were approach noise
                if (this.pendingOpAdjacent) this.attackOpsNoSwing++;
                this.pendingOpTick = -1;
            }
        }
        // ---- ABANDON A NON-PRODUCING TARGET, BUT ONLY WHILE IN REACH -------------------------------
        // ⛔ THIS TIMER MEANS "I am next to it and it pays nothing", NOT "I am still walking". Ungated it
        // produces exactly the churn the approach measurement makes unaffordable: commit to a spawn 6-10
        // tiles away, walk 10+ ticks without landing a hit (because we have not ARRIVED), abandon, re-pick,
        // walk again — paying the DOMINANT cost twice for no reason (`approach` is 57% of all ticks live).
        // The 20 -> 10 shortening earlier tonight was made when we believed the loss was cadence;
        // adjacency-gating is what makes a short window safe, so 10 stays (2.5 swing periods once in reach).
        //
        // ⛔ AND IT IS A STANDALONE `if` NOW. It had become an `else if` on the pending-op block above when
        // swing crediting moved to the decode, so the abandon timer silently only ran on ticks with no
        // op in flight — an accidental coupling between two unrelated timers that nothing would have caught.
        const meNow = this.playerTile();
        const committedT = this.combatTargetIdx >= 0 ? targets.find(t => t.index === this.combatTargetIdx) : undefined;
        const adjToCommitted = !!committedT && Math.abs(committedT.x - meNow.x) + Math.abs(committedT.z - meNow.z) === 1;
        // ---- THE APPROACH CLOCK. Counted here, unconditionally, so it cannot depend on which bucket the
        // tick was labelled with (a bot sending an op every 8 ticks would otherwise lose 1 in 8 of its own
        // approach clock and the timeout would drift).
        if (this.combatTargetIdx >= 0 && !adjToCommitted) {
            this.approachTicksThisCommit++;
            const ck = `${meNow.x},${meNow.z}`;
            if (this.lastCommitTileKey && ck !== this.lastCommitTileKey) this.tilesThisCommit++;
            this.lastCommitTileKey = ck;
        }
        // ---- TIMER 1: THE APPROACH TIMEOUT (unconditional) — the one whose absence cost 50x -----------
        if (this.combatTargetIdx >= 0 && !adjToCommitted && this.approachTicksThisCommit > this.approachTimeoutTicks) {
            this.targetClaims?.release(this.combatTargetIdx, this.uid);
            this.combatTargetIdx = -1;
            this.combatRepick++;
            this.approachTimeouts++;
            this.resetCommitClocks();
        }
        // ---- TIMER 1b: THE STALL GUARD — committed, out of reach, and not moving at all ---------------
        else if (this.combatTargetIdx >= 0 && !adjToCommitted
            && this.approachTicksThisCommit >= this.stallGuardTicks && this.tilesThisCommit === 0) {
            this.targetClaims?.release(this.combatTargetIdx, this.uid);
            this.combatTargetIdx = -1;
            this.combatRepick++;
            this.stallAbandons++;
            this.resetCommitClocks();
        }
        // ---- TIMER 2: THE IN-REACH ABANDON — reached, but not paying (unchanged) ----------------------
        else if (adjToCommitted && this.tickCount - this.lastHpXpGainTick > this.targetAbandonTicks) {
            this.targetClaims?.release(this.combatTargetIdx, this.uid);
            this.combatTargetIdx = -1;
            this.combatRepick++;
            this.targetAbandonsAdjacent++;
            this.resetCommitClocks();
        }
        let target = targets.find(t => t.index === this.combatTargetIdx);
        // ⛔ A KILL WE SHARED IN: the npc we were committed to is GONE from the scene and it had paid us at
        // least one swing. `npc_findhero` gives the DROP to one bot, so bones under-count kills; this counts
        // the commitments that actually ended in a corpse. `commitments / targetKills` is the churn ratio.
        if (!target && this.combatTargetIdx >= 0 && this.targetCommitIdx === this.combatTargetIdx && this.targetHasSwung) {
            this.targetKills++;
        }
        if (!target && this.combatTargetIdx >= 0) this.targetClaims?.release(this.combatTargetIdx, this.uid);
        if (!target) {
            // Pick among the NEAREST few, uid-spread. Hash-picking across the whole
            // list dogpiles fine in an open goblin field, but in a FENCED field (cows)
            // it keeps committing to far cows across internal fences the server can't
            // route to -> zero HP-xp thrash. Nearest-K stays on our side of the fence;
            // combatRepick advances within the near set to skip a fenced-off near cow.
            const me = this.playerTile();
            const dist = (t: { x: number; z: number }) => Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z));
            const byDist = targets.slice().sort((a, b) => dist(a) - dist(b) || a.index - b.index);
            const K = Math.min(5, byDist.length);
            // the OLD pick, always computed: it is the control arm AND the fallback
            const hashPick = byDist[(this.uid + this.combatRepick) % K]!;
            const freePick = byDist.find(t => {
                const owner = this.targetClaims?.ownerOf(t.index, this.tickCount);
                return owner === undefined || owner === this.uid;
            });
            // ⛔ MEASURE THE DEFECT IN BOTH ARMS: how often does the hash pick walk past a closer FREE spawn?
            if (freePick && dist(hashPick) > dist(freePick)) {
                this.walkedPastCloserFree++;
                this.tilesSavedByPicker += dist(hashPick) - dist(freePick);
            }
            if (this.pickerClaims && freePick) {
                target = freePick;
            } else {
                if (this.pickerClaims && !freePick) this.pickerFallbacks++;   // every spawn claimed: never idle
                target = hashPick;
            }
            // release the previous commitment before taking the new one, so a switch cannot leak a claim
            if (this.combatTargetIdx >= 0 && this.combatTargetIdx !== target.index) {
                this.targetClaims?.release(this.combatTargetIdx, this.uid);
            }
            this.combatTargetIdx = target.index;
            this.targetClaims?.claim(target.index, this.uid, this.tickCount);
        }
        const me2 = this.playerTile();
        // ⛔ ADJACENCY FIRST, BECAUSE APPROACH IS THE DOMINANT COST. Live: `approach` is **57% of all ticks**
        // — bots spend more than half their lives walking to a target — while fight uptime once in reach is
        // 63%. That inverts the priority of every timer below: a target you are still WALKING to must never
        // be abandoned for "paying nothing", because the replacement costs another walk. Walk-abandon-walk
        // is the most expensive mistake available at this camp, and both timers below could make it.
        const adjToTarget = Math.abs(target.x - me2.x) + Math.abs(target.z - me2.z) === 1;
        // ⛔ THE MECHANISM THIS WAS BUILT ON IS RETRACTED. "a removed npc keeps its last
        // routeX[0] and reads as permanently adjacent" is FALSE: `getNpcPos` is a faithful client port — it
        // collects entityRemovalIds, nulls stale-cycle npcs and REBUILDS npcIndices every cycle, so
        // iterating npcIndices cannot see a corpse. The guard is kept only as a bound on an UNHITTABLE
        // committed target, and its justification is now empirical, not mechanical:
        //
        //   `corpseDrop` never appears in the tick budget and the drop log (which prints on the FIRST drop)
        //   printed nothing in a 55-minute measured run, so it is inert in normal fighting.
        //
        // ⚠ AND THE FALSE-POSITIVE RISK IS REAL, SO THE WINDOW IS WIDENED: at the measured hitChance of
        // 67-85%, a healthy warrior standing still and being MISSED satisfies both clauses. At 10 ticks
        // (2.5 swing periods) that is P(miss)^2.5 ~ 3.6% of streaks; at 20 ticks (5 periods) it is ~0.4%.
        // 20 it is — and `FB_CORPSE_DROP=0` turns the whole thing off in one env var if it ever fires.
        // ⛔ DO NOT re-derive a mechanism from this counter: if it starts firing, that is a MEASUREMENT to
        // explain, not a licence to patch again.
        // ⛔ REFRESH WHILE COMMITTED. The TTL is what stops a ghost holding a spawn, so a live fight has to
        // keep saying "still mine" — otherwise the claim lapses mid-kill and a second bot commits to the npc
        // we are already killing, which is the contention the picker exists to prevent.
        this.targetClaims?.claim(target.index, this.uid, this.tickCount);
        // per-target productivity + the commitment ledger. A commitment ENDS when we commit to a different
        // npc; its approach cost is bucketed then, so the histogram's shape answers churn-vs-distance.
        if (this.targetCommitIdx !== target.index) {
            if (this.targetCommitIdx >= 0) {
                const k = this.bucketGap(this.approachTicksThisCommit);
                this.approachPerCommitment[k] = (this.approachPerCommitment[k] ?? 0) + 1;
            }
            this.approachTicksThisCommit = 0;
            this.tilesThisCommit = 0;
            this.lastCommitTileKey = '';
            this.targetCommitIdx = target.index;
            this.targetHasSwung = false;
            this.commitments++;
        }
        if (this.tickCount - this.lastHpXpGainTick <= 1) this.targetHasSwung = true;
        const tKey = `${target.index}:${target.x},${target.z}`;
        if (tKey !== this.lastTargetTileKey) { this.lastTargetTileKey = tKey; this.lastTargetMoveTick = this.tickCount; }
        const tileStale = this.tickCount - this.lastTargetMoveTick > this.targetStaleTicks;
        const paysNothing = this.tickCount - this.lastHpXpGainTick > this.targetStaleTicks;
        if (this.corpseDropEnabled && adjToTarget && this.combatTargetIdx >= 0 && tileStale && paysNothing && this.attackOps > 0) {
            this.corpseDrops++;
            // ⛔ THE TWO FACTS THAT DECIDE THE SIGN of this guard, recorded per drop instead of argued about:
            // was the bot IN REACH when it gave up (so the walk was already paid for), and had this target
            // ever paid a swing (so the commitment was productive)? A drop that is adjacent-and-had-swung is
            // the harmful case; one that never paid anything is the benign case. Earlier drops
            // could not be classified after the fact — this makes the next run answer it in one number.
            if (adjToTarget) this.corpseDropsAdjacent++;
            if (this.targetHasSwung) this.corpseDropsAfterSwing++;
            if (!this.quiet && this.corpseDrops % 20 === 1) {
                console.log(`[fb] ${this.loginUser}: dropping npc ${target.index} — tile unchanged ` +
                    `${this.tickCount - this.lastTargetMoveTick} ticks, no xp, adjacent=${adjToTarget}, ` +
                    `hadSwungThisTarget=${this.targetHasSwung}`);
            }
            this.combatTargetIdx = -1;
            this.combatRepick++;
            this.lastTargetTileKey = '';
            this.tickBucket = 'corpseDrop';
            return;
        }
        if (process.env.FB_GATE && this.tickCount % 30 === 0) { const m = me2; console.log(`[fb] ${this.loginUser} t${this.tickCount}: COW-DBG me=(${m.x},${m.z}) targets=${targets.length} tgt=(${target.x},${target.z}) idx=${target.index} hpXp=${this.hitpointsXp}`); }
        // ------------------------------------------------------------------------------------------
        // THE ATTACK SEND GATE  (rewritten from the engine source, see §9o)
        // ------------------------------------------------------------------------------------------
        // ⛔ THE SERVER MAINTAINS THE FIGHT BY ITSELF. `player_melee.rs2` ends EVERY tick of a running
        // fight with `p_opnpc(2)` — it re-arms the interaction itself, swinging whenever
        // `%action_delay <= map_clock` (attackrate 4 for a scimitar). So a client re-send is NEVER needed
        // while xp is flowing, and it is not free either:
        //   * `OpNpcHandler` runs `clearPendingAction()` (clearInteraction + closeModal) before setting the
        //     interaction again, i.e. it tears down the fight the script just re-armed;
        //   * and it re-enters `player_combat_start` -> `~player_in_combat_check`, which in a SINGLE-WAY
        //     zone prints "Someone else is fighting that." / "I'm already under attack!" and returns FALSE
        //     — ENDING a fight the server was running (measured: hundreds of lock / under-attack messages
        //     per hour in a single-way zone).
        // So: send when the fight is NOT running, and stay quiet when it is.
        // ⛔ TWO WAYS THIS TEST CAN LIE, BOTH CAUGHT IN SIM: a bot that has NEVER landed a swing has
        // `lastHpXpGainTick` at its initial value, which on the first ticks of a session reads as "a fight
        // is running" and suppresses the very first attack forever (6 sim tests caught exactly that); and
        // xp from the npc we just KILLED is still recent when we turn to the next one, which would re-impose
        // the idle gap this change exists to remove. So: only ever true for the SAME npc, and only once a
        // swing has actually landed.
        const newTargetForFight = target.index !== this.lastSentTargetIdx;
        const fightRunning = !newTargetForFight && this.swingsLanded > 0
            && this.tickCount - this.lastHpXpGainTick <= this.fightAliveTicks;
        // ⛔ AND RE-ENGAGE A **NEW** TARGET IMMEDIATELY. `lastAttackTick` gates re-sends to one per 8 ticks,
        // which is right for the same npc and wrong the instant the old one dies: the engine has stopped
        // (`player_melee_attack` returns WITHOUT re-arming when the npc is not attackable), so those up-to-8
        // idle ticks are 2.4s of a ~22s kill cycle — ~10% of the whole duty cycle, spent doing nothing at a
        // camp where a fresh npc is already standing in front of us.
        if (!fightRunning && (newTargetForFight || this.tickCount - this.lastAttackTick >= 8)) {
            this.sendOpNpc(target.index, 2); // OPNPC2 = Attack
            this.attackOps++;
            this.pendingOpTick = this.tickCount;
            // ⛔ WAS THIS OP A REAL ENGAGEMENT ATTEMPT? An op sent while still WALKING cannot be a
            // failure-to-engage — the engine is self-routing us and the swing is simply not due yet. Live,
            // `opsNoSwing` read 69% while `approach` was 57% of ticks, i.e. the counter was largely measuring
            // approach and its name was lying. Split at the source: adjacency is known here, not later.
            this.pendingOpAdjacent = adjToTarget;
            if (!adjToTarget) this.opsWhileApproaching++;
            this.lastSentTargetIdx = target.index;
            this.lastAttackTick = this.tickCount;
            this.tickBucket = 'attackSent';
        } else {
            // ⛔ HONEST BUCKETS, AND A DELIBERATE RENAME. `firing` used to mean "the tick we re-sent
            // OPNPC2", so its ceiling was 1-in-8 = 12.5% BY CONSTRUCTION — and measurement read 13.0% of
            // its combat ticks, i.e. the gate was SATURATED. Any model multiplying that number is
            // multiplying a constant, and "get firing to 30%" is arithmetically impossible. These three
            // buckets are what the model actually needs, and they partition the old `engaged`:
            //   swinging — hp xp landed this tick (the SERVER swung: the only ground truth available)
            //   adjWait  — cardinally adjacent to the target (melee reach) and NOT swinging: waiting on
            //              `%action_delay`, on a respawn, or on a fight the server has silently dropped
            //   approach — has a target but is not in reach yet (walking / engine self-route / blocked)
            const adj = Math.abs(target.x - me2.x) + Math.abs(target.z - me2.z) === 1;
            // FIGHT UPTIME, counted where the truth is known: adjacency is geometry, "armed" is a landed
            // swing inside the last swing period. The ratio is the number the whole remaining gap lives in.
            if (adj) {
                this.adjacentTicks++;
                if (this.tickCount - this.lastHpXpGainTick <= 4) this.armedTicks++;
            }
            this.tickBucket = xpLanded ? 'swinging' : adj ? 'adjWait' : 'approach';
            // TILES vs TICKS on approach — the churn/stall discriminator. Counted here so it can only ever be
            // charged on a tick this brain actually classified as `approach`.
            if (this.tickBucket === 'approach') {
                // tiles for the reporter's tiles/tick RATIO only — its denominator is the `approach` BUCKET,
                // so this must be charged on exactly the ticks that bucket counts. The approach CLOCK that
                // drives the timeout is counted separately and unconditionally (see above).
                const key = `${me2.x},${me2.z}`;
                if (this.lastApproachTileKey && key !== this.lastApproachTileKey) this.tilesMovedDuringApproach++;
                this.lastApproachTileKey = key;
            }
        }
        if (!this.quiet && this.tickCount % 50 === 0) {
            console.log(`[fb] ${this.loginUser} t${this.tickCount}: combat hpXp=${this.hitpointsXp} hp=${this.hp}/${this.maxHp} (goal lvl ${this.combatHpTarget}) tgt=(${target.x},${target.z})`);
        }
    }

    // Open a fenced-field gate and step through (user-validated recipe): walk to
    // the tile just WEST of the gate, OPLOC-Open it, then step 1 east; if the
    // step didn't land (gate auto-closed) the cycle re-opens and retries.
    private gateDebugged = false;
    /** The fenced field's centre, when the brain knows it (CombatPrepBot: its cfg field). null = legacy x-line test only. */
    protected gateFieldCenter(): { x: number; z: number } | null { return null; }
    private gateInsideKey = ''; private gateInsideVal = false;
    /**
     * INSIDE BY ROUTE: "inside" was only me.x >= gate.x, but the Lumbridge cow pen's fence bends WEST north
     * of the gate \u2014 18 combat-prep crafters stood INSIDE at (3252,3273) for 11-87 h walking at the outside approach
     * spot (3252,3267), which is only reachable back THROUGH the gate. Inside = the route to the field centre crosses no
     * gate tile. Cached per tile (one route per step).
     */
    private insideByRoute(me: { x: number; z: number }): boolean {
        const c = this.gateFieldCenter();
        if (!c || !this.findLongPathFn) return false;
        const key = me.x + ',' + me.z;
        if (key === this.gateInsideKey) return this.gateInsideVal;
        this.gateInsideKey = key; this.gateInsideVal = false;
        const p = this.findLongPathFn(0, me.x, me.z, c.x, c.z) as Array<{ x: number; z: number }> | null;
        if (!p || !p.length) return false;
        let cx = me.x, cz = me.z;
        for (const w of p) {
            while (cx !== w.x || cz !== w.z) {
                cx += Math.sign(w.x - cx); cz += Math.sign(w.z - cz);
                if (this.gates.some(g => g.x === cx && g.z === cz)) return false;
            }
        }
        this.gateInsideVal = true;
        return true;
    }
    protected passGate(): boolean {
        const me = this.playerTile();
        // Pick the leaf whose WEST wall the player is directly touching: its operable
        // tile is (leaf.x-1, leaf.z) == our tile. Opening EITHER leaf opens BOTH
        // (content gates.rs2 ~open_gate), so OPLOC exactly ONE — never both in a tick
        // (OpLocHandler clears+sets per packet, so a 2nd OPLOC overwrites the 1st and
        // can pick an out-of-range leaf that then fails to open).
        const g = this.gates.find(gg => gg.x - 1 === me.x && gg.z === me.z) ?? this.gates[0];
        const spot = { x: g.x - 1, z: g.z }; // operable tile, just west of the gate
        if (!this.gateDebugged) { this.gateDebugged = true; console.log(`[fb] ${this.loginUser}: passGate ACTIVE gates=${JSON.stringify(this.gates)} me=(${me.x},${me.z}) spot=(${spot.x},${spot.z}) leaf=${g.loc}`); }

        if (me.x >= g.x || this.insideByRoute(me)) { // east of the gate line, or a gate-free route to the field centre = inside
            this.gatePassed = true;
            console.log(`[fb] ${this.loginUser}: THROUGH the gate -> inside at (${me.x},${me.z})`);
            return false;
        }

        // Walk onto the exact operable tile first (west-wall gates are finicky).
        if (me.x !== spot.x || me.z !== spot.z) {
            if (this.tickCount % 10 === 0) console.log(`[fb] ${this.loginUser}: gate approach me=(${me.x},${me.z}) -> spot=(${spot.x},${spot.z})`);
            if (this.tickCount - this.lastAttackTick >= 3) { this.sendMove(spot.x, spot.z, true); this.lastAttackTick = this.tickCount; }
            return true;
        }

        // On the operable tile. Cycle (MoveClickHandler.clearPendingAction() cancels a
        // pending open on ANY move, so hold moves while the open script runs):
        //   dt 0     : OPLOC1(215) Open the in-range leaf. NO move.
        //   dt 1..4  : send nothing — let the engine run the open script.
        //   dt 5,8,11: step EAST through the now-open gate (stays open 500 ticks).
        //   dt >=12  : re-OPLOC (safety retry).
        const dt = this.tickCount - this.lastGateTick;
        if (dt >= 12) {
            this.out.p1Enc(ClientProt.OPLOC1); this.out.p2(g.x); this.out.p2(g.z); this.out.p2(g.loc); // OPLOC1 = Open (op1)
            this.lastGateTick = this.tickCount;
            console.log(`[fb] ${this.loginUser}: OPLOC1-Open leaf ${g.loc}@(${g.x},${g.z}) from (${me.x},${me.z}); holding MOVEs`);
        } else if (dt >= 5 && (dt - 5) % 3 === 0) {
            this.sendMove(g.x, me.z, true); // gate open -> step 1 tile east through it
            if (dt === 5) console.log(`[fb] ${this.loginUser}: gate open -> stepping east to (${g.x},${me.z})`);
        }
        return true;
    }

    /**
     * The brain's last branch: nothing else wants the tick. Subclasses override it to do their own
     * per-tick work; the base keeps the link warm (a NO_TIMEOUT every 5 ticks) so the server never
     * idle-kicks a bot that is waiting for a script.
     */
    protected idleTick(): void {
        this.keepWarm();
    }
    // Slot of an obj in the backpack, or -1.
    private invSlotOf(obj: number): number {
        const inv = this.invForInventory();
        if (!inv) return -1;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) return i;
        return -1;
    }

    private countInInv(obj: number): number {
        const inv = this.invForInventory();
        if (!inv) return 0;
        let n = 0;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) n += inv.counts[i];
        return n;
    }

    // OPHELD1 = "eat"/op1-on-inv-item. payload = obj(g2) slot(g2) com(g2).
    private sendEat(obj: number, slot: number): void {
        this.out.p1Enc(Out.OPHELD1);
        this.out.p2(obj);
        this.out.p2(slot);
        this.out.p2(INV_INTERFACE);
    }

    // --- public action wrappers (for probes + skilling/combat brains) ----------
    // op1 on an inv item: bury bones, eat food, light logs, etc. (OPHELD1).
    opHeld1(obj: number, slot: number): void {
        this.sendEat(obj, slot);
        this.expectAck(BURYABLE_BONES.has(obj) ? AckKind.BuryBone : AckKind.EatFood, obj, slot, obj);
    }
    // op2 on an inv item = Wield/Wear a weapon/armour (OPHELD2, opcode 2). Same 6-byte payload.
    opHeld2(obj: number, slot: number): void {
        this.out.p1Enc(ClientProt.OPHELD2);
        this.out.p2(obj);
        this.out.p2(slot);
        this.out.p2(INV_INTERFACE);
        // WORN_UP, not INV — "the server moved it into the worn container" is the only proof of a wear,
        // exactly as the gear ledger already argues at the UPDATE_INV_FULL arm.
        this.expectAck(AckKind.Equip, obj, slot, obj);
    }
    // Interact with an npc: OPNPC<op>. op2 = Attack, op1 = Talk-to, op3 = Pickpocket.
    opNpc(index: number, op: number): void { this.sendOpNpc(index, op); }
    // Use an inventory item ON an npc: OPNPCU (150, size 8) -> p2(npcIndex) p2(obj) p2(slot) p2(com).
    // Quest steps use this (e.g. use air_talisman on Sedridor). ADDITIVE — only the quest runner calls it.
    useItemOnNpc(index: number, obj: number, slot: number): void {
        this.out.p1Enc(ClientProt.OPNPCU); this.out.p2(index); this.out.p2(obj); this.out.p2(slot); this.out.p2(INV_INTERFACE);
        // ⭐ ARMED AT THE PRIMITIVE, exactly as opNpc/opLoc/opObj already are. `expectAck` stays
        // protected on purpose: a public arm invites a brain to arm a kind it does not observe, which is the cry-wolf failure
        // ACK-UNREACHED was added to prevent. Arming here gives coverage everywhere with no new public
        // surface at all, and it is what lets a caller report `no_ack` ("the op was DISCARDED, retrying
        // will not help") instead of the far weaker `timeout` it could only manage from observables.
        this.expectAck(AckKind.UseItemOnNpc, index, obj, obj);
    }
    // Advance the current "click to continue" chat page (RESUME_PAUSEBUTTON). Public wrapper so a
    // quest-runner subclass can drive dialog page-by-page; choice pages use ifButton(root+1+opt).
    resumeDialogPage(): void { if (this.chatModalId !== -1) this.sendResume(this.chatModalId); }
    // Cast a spell (magic-tab component) on an npc: OPNPCT (181, size 4) -> p2(npcIndex) p2(spellCom).
    opNpcT(index: number, spellCom: number): void {
        this.out.p1Enc(ClientProt.OPNPCT); this.out.p2(index); this.out.p2(spellCom);
        // AckKind.CastSpell already existed with the right observables (HIT|STAT|MSG|INV) — only the
        // arm was missing, so `castSpellOnNpc` verified from observables alone and reported `timeout`
        // where the ledger would have said `no_ack`. `detail` is the npc index so ackNpcDetail()-style
        // "target is N tiles away" reasoning stays available to a reader of the failure line.
        this.expectAck(AckKind.CastSpell, index, spellCom);
    }
    // Cast a spell on an inventory item: OPHELDT (135, size 8) -> p2(obj) p2(slot) p2(com) p2(spellCom).
    // Used for high-alch (spellCom = magic:highlvl_alchemy = 1178) on a junk item.
    opHeldT(obj: number, slot: number, spellCom: number): void {
        this.out.p1Enc(ClientProt.OPHELDT); this.out.p2(obj); this.out.p2(slot); this.out.p2(INV_INTERFACE); this.out.p2(spellCom);
        // High-alch is the only caller today: the answer is the junk item leaving the pack, the coins
        // arriving, magic xp, or "you cannot alch that". CastSpell's mask (HIT|STAT|MSG|INV) covers all
        // four; `wantObj = obj` makes the INV arm specific to the item we actually targeted.
        this.expectAck(AckKind.CastSpell, obj, spellCom, obj);
    }
    // Take/interact with a GROUND obj: OPOBJ<op> (op3=108="Take", ObjType.op[2]). payload p2(worldX)
    // p2(worldZ) p2(objRAW). Ground objs carry the RAW obj id (NOT the inv +1). OPOBJ self-routes
    // NAIVELY like OPLOC — be ON/adjacent to the tile (a preceding MOVE walks you there). Additive
    // primitive for any loot step: take an item off a tile.
    opObj(x: number, z: number, obj: number, op = 3): void {
        this.out.p1Enc(OPOBJ_OPCODES[op]);
        this.out.p2(x); this.out.p2(z); this.out.p2(obj);
        this.expectAck(AckKind.Pickup, obj, x * 16384 + z, obj);
    }
    // Nearest tracked ground item whose obj matches (an id or a set), within maxRange (chebyshev tiles).
    // Prunes stale entries as it scans (ground items despawn; a missed OBJ_DEL would otherwise linger).
    findGroundItem(match: number | Set<number>, maxRange = 12, skip?: Set<string>): { x: number; z: number; obj: number; count: number } | undefined {
        const me = this.playerTile();
        const want = (id: number) => (typeof match === 'number' ? id === match : match.has(id));
        let best: { x: number; z: number; obj: number; count: number } | undefined; let bestD = Infinity;
        for (const [key, g] of this.groundItems) {
            if (this.tickCount - g.tick > 300) { this.groundItems.delete(key); continue; }
            if (!want(g.obj) || skip?.has(key)) continue;   // skip = blacklisted (unreachable) tiles
            const d = Math.max(Math.abs(g.x - me.x), Math.abs(g.z - me.z));
            if (d <= maxRange && d < bestD) { bestD = d; best = { x: g.x, z: g.z, obj: g.obj, count: g.count }; }
        }
        return best;
    }
    // Backpack inventory ({ids,counts}) or undefined before the first UPDATE_INV.
    backpack(): { ids: Int32Array; counts: Int32Array } | undefined { return this.invForInventory(); }
    // First backpack slot holding obj, or -1.
    slotOf(obj: number): number { return this.invSlotOf(obj); }
    // Route-corrected player tile / npc tile (reads routeX[0], never x>>7 — see stale-tile rule).
    tile(): { x: number; z: number } { return this.playerTile(); }
    npcTileOf(npc: LeanNpc): { x: number; z: number } { return this.npcWorld(npc); }
    // Click an interface button (IF_BUTTON) — e.g. an attack-style button. A real demo packet, not a cheat.
    ifButton(comId: number): void { this.out.p1Enc(Out.IF_BUTTON); this.out.p2(comId); }

    // =================================================================================================
    // ⭐⭐ CLEAN LOGOUT — THE ONLY THING THAT PUBLISHES A HISCORE ROW ON DEMAND
    // =================================================================================================
    // ⛔ PERSISTENCE AND PUBLICATION ARE DIFFERENT PIPELINES. Surviving a kill proves the .sav was
    // written; it proves NOTHING about being scored. Traced end to end in the engine source, not assumed:
    //
    //   IF_BUTTON(2458)                 component.sym:2396  `2458  logout:try_logout`
    //     -> IfButtonHandler.handle()   requires Component.buttonType != NO_BUTTON and
    //                                   `player.isComponentVisible(com)` (Player.ts:2134). 2458's root
    //                                   layer is the LOGOUT TAB (interface.sym:54 `2449 logout`), which
    //                                   sits in `player.tabs` — so it is visible with a modal open or
    //                                   shut, and no interface has to be opened first.
    //     -> [if_button,logout:try_logout]  content/scripts/login_logout/logout.rs2:10
    //                                   `if_close; if (p_finduid(uid)) { ...duel/gnomeball guards...
    //                                    p_logout; }`
    //     -> P_LOGOUT                   PlayerOps.ts:626 -> `player.requestLogout = true`
    //     -> World.processLogouts()     World.ts:796 requestLogout -> `loggingOut = true`, gated by
    //                                   `preventLogoutUntil` (combat_preventlogout = 16 ticks)
    //     -> World.removePlayer()       World.ts:1717 -> `player.logout()` — NetworkPlayer.ts:229 writes
    //                                   ServerProt.LOGOUT(88) TO US, which is the ack this waits for —
    //                                   and then `flushPlayer()`
    //     -> World.flushPlayer()        World.ts:2633 `logoutRequests.set(username, {save, lastAttempt:-1})`
    //     -> World.processLogouts() tail World.ts:839 posts `{type:'player_logout'}` to the login thread
    //     -> LoginServer.ts:566-609     writes `<username>.sav` AND `await updateHiscores(...)`.
    //                                   ⭐ THE ONLY CALLER IN THE ENGINE. The `player_autosave` branch
    //                                   right beside it (LoginServer.ts:610-621) writes the same .sav
    //                                   and calls nothing — which is why 1500-tick autosaves and hard
    //                                   kills leave an account with real progress and no hiscore row
    //                                   until the engine's own idle reap (World.ts:145-146,
    //                                   TIMEOUT_NO_CONNECTION = 500 ticks) eventually removes it.
    //
    // ⛔ `requestLogout` IS ONE-SHOT. World.ts:804 clears it EVERY cycle whether or not it was honoured,
    // so a bot inside the 16-tick post-combat anti-log window has its request dropped on the floor with
    // only a game message to show for it. That is why this RE-PRESSES on a cadence instead of pressing
    // once and hoping. (`loggingOut`, once set, latches — but the press that sets it may be the fifth.)
    static readonly LOGOUT_BUTTON = 2458;

    /**
     * Ask the SERVER to end this session, and wait for its ServerProt.LOGOUT ack.
     *
     * Returns `published` only when the engine acknowledged — i.e. `removePlayer` ran, which is exactly
     * the condition under which `updateHiscores` is reached. `timeout` means we pressed and were not
     * answered inside the budget (the caller should say so out loud rather than claim a publish);
     * `dead` means there was no live session to log out in the first place.
     *
     * ⛔ DOES NOT DESTROY THE CLIENT. The caller owns teardown ordering — and on the `published` path
     * the engine has already closed the socket for us.
     */
    async requestCleanLogout(opts: { timeoutMs?: number; pressEveryMs?: number } = {}): Promise<CleanLogoutOutcome> {
        // defaults sized at the 300 ms tick; scaledMs = same tick count at logs/tick.json's tick, never shorter
        const timeoutMs = Math.max(1_000, opts.timeoutMs ?? scaledMs(20_000));
        const pressEveryMs = Math.max(300, opts.pressEveryMs ?? scaledMs(1_200));
        const t0 = Date.now();
        let presses = 0;
        if (this.serverLogoutAt) return { state: 'published', ms: 0, presses: 0 };
        if (this.disposed || !this.alive) return { state: 'dead', ms: 0, presses: 0 };
        while (Date.now() - t0 < timeoutMs) {
            if (this.serverLogoutAt) return { state: 'published', ms: Date.now() - t0, presses };
            if (this.disposed) return { state: 'dead', ms: Date.now() - t0, presses };
            try {
                this.ifButton(LeanBot.LOGOUT_BUTTON);
                // Flush NOW rather than waiting for the next PLAYER_INFO tick: on the wind-down path the
                // brain may already be parked, and a press sitting in `out` is a press that never
                // happened. Writing two synchronous bytes+short cannot interleave with the decode loop
                // (one thread, no await between them), so the ISAAC stream stays in order.
                this.flush();
                presses++;
            } catch {
                return { state: 'dead', ms: Date.now() - t0, presses };
            }
            // SIM_DET=1 (offline sim, replayable runs): poll once per server tick and re-press every ~pressEveryMs/400 ticks.
            // The 50 ms wall poll let the NEXT bot's logout (run-route cheatless supply-in: for (sb of sups) await sb.logout())
            // start 0-5 ticks later run to run (trace: the IF_BUTTON at tick 610 vs 613). The LOGOUT ack releases tick waiters.
            if (SIM_DET) {
                const pressTicks = Math.max(1, Math.round(pressEveryMs / 400));
                for (let k = 0; k < pressTicks && !this.serverLogoutAt && !this.disposed; k++) await this.sendWait(1);
                continue;
            }
            const until = Date.now() + pressEveryMs;
            // Poll finely so the ack is noticed in ~50ms rather than at the next press.
            while (Date.now() < until && !this.serverLogoutAt && !this.disposed) {
                await new Promise(r => setTimeout(r, 50));
            }
        }
        return { state: this.serverLogoutAt ? 'published' : 'timeout', ms: Date.now() - t0, presses };
    }
    // Keep the link warm (NO_TIMEOUT) so an idle bot isn't force-logged-out (server kicks after ~1000 quiet ticks).
    warm(): void { this.out.p1Enc(Out.NO_TIMEOUT); }

    // =================================================================================================
    // ENTITY BY NAME (parity package 2) — locScene, the offline loc scene
    // =================================================================================================
    // The server NEVER transmits locs; they live in the map cache. That is why every headless brain
    // until now was handed hardcoded coordinates and bare numeric ids, while the browser SDK could say
    // findNearbyLoc(/^bank booth$/i). These wrappers close that gap by asking the process-global index
    // the same question, anchored on THIS bot's live position and level.
    //
    // ⛔ THE ANCHORED-PATTERN TRAP. A bare string is a case-insensitive SUBSTRING (SDK semantics), and
    // near the Ardougne bank `'booth'` matches `Closed bank booth` (loc 2215) — a decoration with no
    // usable op that you can never bank at, sitting closer than the real thing. Pass /^bank booth$/i.
    //
    // ⛔ REQUIRES locScene.init() AT PROCESS START (beside navgrid.init()). These throw a loud,
    // actionable error otherwise rather than answering null — a silent "nothing nearby" is the failure
    // mode that costs an agent a whole probe run to diagnose.

    locSceneReady(): boolean { return locScene.isReady(); }

    // ⛔ NO `level()` HELPER HERE ON PURPOSE. Subclasses in other files already declare
    // `level(): number { return this.minusedlevel; }`, and with
    // `noImplicitOverride` a base copy would make each of them a compile error in files this one does
    // not own. `minusedlevel` is already public on LeanClient — the queries below read it directly.

    /** Nearest named loc matching `pattern` around the bot, or null. SDK findNearbyLoc semantics. */
    findNearbyLoc(pattern: string | RegExp, radius = 15): locScene.SceneLoc | null {
        const me = this.playerTile();
        return locScene.findNearbyLoc(pattern, me.x, me.z, this.minusedlevel, radius);
    }

    /** Every named loc matching `pattern` around the bot, nearest first. */
    findNearbyLocs(pattern: string | RegExp, radius = 15): locScene.SceneLoc[] {
        const me = this.playerTile();
        return locScene.findNearbyLocs(pattern, me.x, me.z, this.minusedlevel, radius);
    }

    /** Every named loc around the bot, nearest first (SDK scanNearbyLocs). */
    getNearbyLocs(radius = 15): locScene.SceneLoc[] {
        const me = this.playerTile();
        return locScene.getNearbyLocs(me.x, me.z, this.minusedlevel, radius);
    }

    /** Every named loc placed on one exact tile, on the bot's current plane. */
    getLocsAt(x: number, z: number): locScene.SceneLoc[] {
        return locScene.getLocsAt(x, z, this.minusedlevel);
    }

    /** Display name of a loc / npc / obj TYPE id ('' when unnamed or unknown). */
    locName(locId: number): string { return locScene.locName(locId); }
    npcName(typeId: number): string { return locScene.npcName(typeId); }
    objName(objId: number): string { return locScene.objName(objId); }
    /** Display name of a TRACKED npc — the bridge from NPC_INFO's numeric type id to a name. */
    npcNameOf(npc: LeanNpc): string { return locScene.npcName(npc.typeId); }

    /**
     * ⭐ THE FULL NAME -> INTERACT PATH. Find the nearest loc by NAME and OPLOC it, with no hardcoded
     * coordinates or ids anywhere. `op` is either a 1-based op index or a pattern matched against the
     * loc's own option TEXT (SDK `interactLoc(target, 'mine')` parity) — the text form is the robust
     * one, because the op INDEX of "Open" differs between a door and a gate.
     * Returns what it targeted, or null if nothing matched (nothing is sent in that case).
     */
    opLocByName(pattern: string | RegExp, op: number | string | RegExp = 1, radius = 15): locScene.SceneLoc | null {
        const loc = this.findNearbyLoc(pattern, radius);
        if (!loc) return null;
        let opIndex: number;
        if (typeof op === 'number') {
            opIndex = op;
        } else {
            const re = typeof op === 'string' ? new RegExp(op, 'i') : op;
            const hit = loc.optionsWithIndex.find(o => { re.lastIndex = 0; return re.test(o.text); });
            if (!hit) return null;   // the op the caller wants is not on this loc — sending would be a guess
            opIndex = hit.opIndex;
        }
        if (opIndex < 1 || opIndex > 5) return null;
        this.opLoc(loc.x, loc.z, loc.id, opIndex);
        return loc;
    }

    // =================================================================================================
    // CHAT (parity package 4) — read + send
    // =================================================================================================
    // Read surface delegates to ChatLog so it behaves exactly like sdk/index.ts getChat/getNewChat/
    // getChatFrom/waitForChat: player-chat types only by default, own lines excluded, 20 deep, and a
    // monotonic cursor for getNewChat.

    /** Recent player chat, oldest first. `{ limit: 0 }` returns everything the ring still holds. */
    getChat(opts: ChatQuery = {}): ChatMessage[] { return this.chatLog.getChat(opts); }
    /** Only what has arrived since the previous call (cursor-based, cannot re-surface a line). */
    getNewChat(opts: Omit<ChatQuery, 'limit'> = {}): ChatMessage[] { return this.chatLog.getNewChat(opts); }
    /** Recent lines from one sender (case-insensitive substring). */
    getChatFrom(name: string, opts: { limit?: number } = {}): ChatMessage[] { return this.chatLog.getChatFrom(name, opts); }
    /** Wait for the NEXT matching line. Resolves null on timeout (default 30s) or on LOGOUT. */
    waitForChat(opts: ChatWait = {}): Promise<ChatMessage | null> { return this.chatLog.waitForChat(opts); }

    /**
     * Say one line of public chat (MESSAGE_PUBLIC, ClientGameProt(253, -1)).
     *
     * ⛔ ONE SOCIAL PACKET PER TICK. MessagePublicHandler bails on `player.socialProtect`, which only
     * Player.ts's per-tick reset clears — a second line in the same tick is discarded with NO reply, so
     * it would look exactly like a delivered message that nobody heard. This refuses locally instead of
     * lying; use {@link say} for anything multi-chunk.
     *
     * ⛔ AND DO NOT BUILD A BOT-TO-BOT MESSAGE BUS OUT OF THIS. Every public line is fanned out to every
     * player outside the 14-tile bubble, so each line costs one outbound packet per player online.
     *
     * Colour must be 0..11 and effect 0..2; the engine SILENTLY DROPS anything else (so does this,
     * loudly, by throwing — a dropped packet with no reply is unfalsifiable at the far end).
     */
    sendSay(text: string, opts: { colour?: number; effect?: number } = {}):
        { sent: boolean; text: string; normalized: string; truncated: boolean; reason?: string } {
        if (this.lastSayTick === this.tickCount) {
            return { sent: false, text: '', normalized: '', truncated: false, reason: 'socialProtect: already said something this tick' };
        }
        const payload = writeMessagePublic(this.out, text, { colour: opts.colour ?? 0, effect: opts.effect ?? 0 });
        this.lastSayTick = this.tickCount;
        this.chatSent++;
        return { sent: true, text: payload.text, normalized: payload.normalized, truncated: payload.truncated };
    }

    /**
     * Say text of any length: chunked on word boundaries at the 80-char wire cap and sent one chunk per
     * tick (the socialProtect cadence). Mirrors sdk/index.ts say(), including chunkMessage's quirks
     * (whitespace runs collapse; empty input sends nothing).
     */
    async say(
        text: string,
        opts: { maxLen?: number; delayTicks?: number; colour?: number; effect?: number } = {},
    ): Promise<string[]> {
        const maxLen = Math.min(opts.maxLen ?? MAX_MESSAGE_LENGTH, MAX_MESSAGE_LENGTH);
        const delayTicks = Math.max(1, opts.delayTicks ?? 1);
        const chunks = chunkMessage(text, maxLen);
        const sent: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
            // A caller may already have said something this tick; wait it out rather than dropping.
            if (this.lastSayTick === this.tickCount) await this.sendWait(1);
            const r = this.sendSay(chunks[i]!, { colour: opts.colour, effect: opts.effect });
            if (r.sent) sent.push(r.text);
            if (i < chunks.length - 1) await this.sendWait(delayTicks);
        }
        return sent;
    }

    // =================================================================================================
    // THE SIX MISSING ACTION ENCODERS (parity package 3)
    // =================================================================================================
    // Every opcode below was read out of src/io/ClientProt.ts AND re-checked against the engine's own
    // ClientGameProt.ts (opcode + declared size) and its decoder, because a wrong size on a fixed-size
    // prot desyncs the server's read of EVERY subsequent packet on the connection.

    /**
     * Cast a spell on a GROUND item — OPOBJT (91, size 8). OpObjTDecoder: g2 x, g2 z, g2 obj, g2 spellCom.
     * SDK parity: sendSpellOnGroundItem. This is alch/telegrab on the floor.
     * Like OPOBJ/OPLOC it self-routes NAIVELY — be on or adjacent to the tile (send a MOVE first if not).
     * `obj` is the RAW ground obj id (ground objs never carry the inventory +1).
     */
    opObjT(x: number, z: number, obj: number, spellCom: number): void {
        this.out.p1Enc(Out.OPOBJT);
        this.out.p2(x); this.out.p2(z); this.out.p2(obj); this.out.p2(spellCom);
    }

    /**
     * Interact with a PLAYER — OPPLAYER<op>. Payload is just the target's world index (p2), and the
     * engine's OpPlayerDecoder reads exactly that for every op. Which op MEANS what is content, not
     * protocol: see the Out enum above (op2 = Attack, op3 = Follow, op4 = Trade with).
     */
    opPlayer(worldIndex: number, op: number): void {
        const opcode = op === 1 ? Out.OPPLAYER1 : op === 2 ? Out.OPPLAYER2 : op === 3 ? Out.OPPLAYER3 : Out.OPPLAYER4;
        this.out.p1Enc(opcode);
        this.out.p2(worldIndex);
    }
    /** OPPLAYER3 (196) — "Follow" the given player index. Re-issue it: one op = one approach. */
    followPlayer(worldIndex: number): void { this.opPlayer(worldIndex, 3); }
    /** OPPLAYER2 (166) — "Attack" a player. ⛔ Only bound INSIDE THE WILDERNESS (login.rs2 nulls op2
     *  everywhere else), and `pvp_is_attackable` refuses out-of-range level differences. Outside the
     *  wilderness this is accepted by the engine and does nothing but walk you to the target. */
    attackPlayer(worldIndex: number): void { this.opPlayer(worldIndex, 2); }
    /** Resolve a visible player by EXACT name, then follow/attack. -1 if not visible. */
    findPlayerByName(name: string): number { return this.findPlayerIndexByName(name); }

    /**
     * Switch sidebar tab — TUT_CLICKSIDE (94, size 1). SDK parity: sendSetTab.
     * NOTE the honest scope: the browser's `setTab` is PURELY CLIENT-SIDE (it repaints a panel and
     * sends nothing). The only tab packet the real client emits is this one, and TutClickSideHandler
     * uses it to fire the TUTORIAL trigger — it rejects anything outside 0..13 and does nothing else.
     * So this is tab-click PARITY ON THE WIRE, not a server-side "current tab" that can be read back.
     */
    sendSetTab(tabIndex: number): boolean {
        if (!Number.isInteger(tabIndex) || tabIndex < 0 || tabIndex > 13) return false;
        this.out.p1Enc(Out.TUT_CLICKSIDE);
        this.out.p1(tabIndex);
        return true;
    }

    /**
     * Click the Nth option of the currently open dialog — IF_BUTTON on the component behind it.
     * SDK parity: sendClickInterfaceOption(optionIndex), 0-based, resolved from live state rather than
     * a hardcoded component id. Returns the component clicked, or -1 when no such option is on offer.
     * Prefer {@link clickDialogByText}: option ORDER is content and moves with unrelated quest vars.
     */
    sendClickInterfaceOption(optionIndex: number): number {
        const options = this.dialogOptions();
        const opt = options[optionIndex];
        if (!opt) return -1;
        this.ifButton(opt.com);
        return opt.com;
    }

    /**
     * Wait N game ticks. SDK parity: sendWait(ticks).
     * Resolved from the decode loop's tick advance — never a timer, so it tracks the SERVER's clock
     * (which is what every cadence in this codebase is measured in) and cannot drift at NODE_TICKRATE=40.
     * Resolves early if the session ends, so a caller can never park forever on a dead connection.
     */
    sendWait(ticks = 1): Promise<void> {
        const n = Math.max(1, Math.floor(ticks));
        if (this.disposed) return Promise.resolve();
        if (SIM_LOCKSTEP) this.simNew++;
        return new Promise<void>(resolve => {
            this.tickWaiters.push({ at: this.tickCount + n, resolve });
        });
    }

    /** Valid, non-disabled idk kit ids per IdkType.type, dumped from the engine's own IdkType table
     *  (`IdkType.load('data/pack')`, filtering `disable`). Types 0..6 are male hair/jaw/torso/arms/
     *  hands/legs/feet, 7..13 the female set. ⭐ TYPE 8 (female jaw) IS DELIBERATELY EMPTY: the engine
     *  has no valid entry and special-cases it (`type == 8 && idkit[i] === -1` -> continue), which is
     *  why a female design must send 255 for that slot. */
    private static readonly IDK_KITS: Readonly<Record<number, readonly number[]>> = {
        0: [0, 1, 2, 3, 4, 5, 6, 7, 8], 1: [10, 11, 12, 13, 14, 15, 16, 17],
        2: [18, 19, 20, 21, 22, 23, 24, 25], 3: [26, 27, 28, 29, 30, 31],
        4: [33, 34], 5: [36, 37, 38, 39, 40], 6: [42, 43],
        7: [45, 46, 47, 48, 49, 50, 51, 52, 53, 54], 8: [],
        9: [56, 57, 58, 59, 60], 10: [61, 62, 63, 64, 65], 11: [67, 68],
        12: [70, 71, 72, 73, 74, 75, 76, 77], 13: [79, 80],
    };
    /** Per-colour palette sizes, from Player.DESIGN_BODY_COLORS (engine Player.ts:102). */
    private static readonly IDK_COLOUR_COUNTS = [12, 16, 16, 6, 8];

    /**
     * Save a character design — IDK_SAVEDESIGN (125, size 13). IdkSaveDesignDecoder: g1 gender, 7x g1
     * kit (255 reads back as -1), 5x g1 colour. SDK parity: sendRandomizeCharacterDesign /
     * setCharacterDesign. Without it headless could only ACCEPT the server default (IF_BUTTON on
     * player_kit:accept), so every headless bot looked identical.
     *
     * ⛔ THE ENGINE VALIDATES AND THEN SAYS NOTHING. IdkSaveDesignHandler returns false — with no
     * message and no packet — if `allowDesign` is off (i.e. you are not at the design screen), if any
     * kit is disabled or belongs to the wrong part, or if a colour is out of palette range. So a
     * malformed design is INVISIBLE at the client. Both guards below are therefore local: the kit ids
     * come from the engine's own table and the ranges are checked before a byte is written.
     *
     * @param gender 0 = male, 1 = female.
     * @param kits   7 kit ids, one per part (hair, jaw, torso, arms, hands, legs, feet). -1 => 255.
     * @param colours 5 palette indices.
     */
    sendIdkSaveDesign(gender: number, kits: readonly number[], colours: readonly number[]): boolean {
        if (gender !== 0 && gender !== 1) return false;
        if (kits.length !== 7 || colours.length !== 5) return false;
        for (let i = 0; i < 5; i++) {
            const c = colours[i]!;
            if (!Number.isInteger(c) || c < 0 || c >= LeanBot.IDK_COLOUR_COUNTS[i]!) return false;
        }
        for (let i = 0; i < 7; i++) {
            const k = kits[i]!;
            if (k === -1) {
                // Only the female jaw may legitimately be absent.
                if (!(gender === 1 && i === 1)) return false;
                continue;
            }
            if (!LeanBot.IDK_KITS[i + (gender === 1 ? 7 : 0)]!.includes(k)) return false;
        }
        this.out.p1Enc(Out.IDK_SAVEDESIGN);
        this.out.p1(gender);
        for (let i = 0; i < 7; i++) this.out.p1(kits[i]! === -1 ? 255 : kits[i]!);
        for (let i = 0; i < 5; i++) this.out.p1(colours[i]!);
        return true;
    }

    /** Randomize the design from the engine's valid kit table and send it. SDK: sendRandomizeCharacterDesign. */
    randomizeCharacterDesign(gender?: number): boolean {
        const g = gender === 0 || gender === 1 ? gender : (Math.random() < 0.5 ? 0 : 1);
        const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
        const kits: number[] = [];
        for (let i = 0; i < 7; i++) {
            const valid = LeanBot.IDK_KITS[i + (g === 1 ? 7 : 0)]!;
            kits.push(valid.length === 0 ? -1 : pick(valid));   // female jaw has no valid kit
        }
        const colours = LeanBot.IDK_COLOUR_COUNTS.map(n => Math.floor(Math.random() * n));
        return this.sendIdkSaveDesign(g, kits, colours);
    }

    /** The local player's own appearance blob, or null before the first APPEARANCE block. The design
     *  READBACK: gender(1) headicons(1) then the 12 worn/kit slots, so a saved design is verifiable. */
    myAppearanceBytes(): Uint8Array | null {
        return this.playerAppearanceBuffer[LOCAL_PLAYER_INDEX]?.data ?? null;
    }

    /** Wake every tick waiter whose deadline has passed. Called from the ONE place tickCount advances. */
    private wakeTickWaiters(): void {
        const due = this.tickWaiters.filter(w => this.tickCount >= w.at);
        if (due.length === 0) return;
        this.tickWaiters = this.tickWaiters.filter(w => this.tickCount < w.at);
        if (SIM_LOCKSTEP) this.simDue += due.length;
        for (const w of due) w.resolve();
    }

    /** A supervisor-initiated teardown is just as fatal to a parked awaiter as a server LOGOUT. */
    override destroy(): void {
        super.destroy();
        if (SIM_BARRIER) simBots.delete(this);
        this.releaseAwaiters();
    }

    /** Settle every parked awaiter (chat waits + tick waits). Called on the LOGOUT path. */
    protected releaseAwaiters(): void {
        this.chatLog.cancelWaiters();
        const parked = this.tickWaiters;
        this.tickWaiters = [];
        for (const w of parked) w.resolve();
    }

    // ⛔ THE OPEN DOOR IS A WALL TOO (Lumbridge castle kitchen north door 1536
    // @(3207,3217)): navgrid unmasks every straight door, but the OPEN variant the script loc_adds on the neighbour tile
    // (loc_1537 @(3207,3218), a wall on its EAST side) was in no model, so every plan from (3207,3218) walked due east
    // into it -> "TRAVEL WEDGED idx=1/456" for good. Feed each OPEN door variant (shape 0, from the zone stream) into the
    // shared collision as a wall (sdk/navgrid/live-leaves.ts) and drop the route being walked if the leaf cut it, so the
    // walker re-plans around the leaf at once instead of after a 24-tick wedge. Door-tracking bots only.
    private liveLeafFeed(level: number, x: number, z: number, loc: number, info: number): void {
        if (!this.doorTracker || process.env.NAV_LIVE_LEAVES !== '1') return;
        if (doorDef(loc)?.state !== 'open' || (info >> 2) !== 0) { delLiveLeaf(level, x, z); return; }
        if (!addLiveLeaf(level, x, z, 0, info & 3)) return;
        const p = this.travelPath;
        if (!p || this.travelLevel !== level) return;
        const i = firstRefusedStep(level, this.tile(), p, this.travelIdx);
        if (i < 0) return;
        console.log(`[fb] ${this.loginUser}: open door leaf ${loc} @(${x},${z}) now walls the route at step ${i} ` +
            `(${p[i]!.x},${p[i]!.z}) — re-planning around it`);
        this.travelPath = null; this.travelIdx = 0; this.lastTravelMoveTick = -100;
    }

    // Decode ONE zone sub-message (byte-exact, so alignment holds in both the FOLLOWS path and
    // the ENCLOSED path). Only LOC_ADD_CHANGE / LOC_DEL feed the door tracker — the rest are consumed
    // to stay aligned. Coord = (x<<4)|z within the 8x8 zone; level = the player's current plane.
    private decodeZoneOp(opcode: number): void {
        const pos = this.in.g1();
        const wx = this.mapBuildBaseX + this.zoneBaseX + ((pos >> 4) & 0x7);
        const wz = this.mapBuildBaseZ + this.zoneBaseZ + (pos & 0x7);
        const level = this.minusedlevel;
        switch (opcode) {
            case ServerProt.LOC_ADD_CHANGE: { const info = this.in.g1(); const loc = this.in.g2(); this.ackRevs[Rev.Loc]!++; this.doorTracker?.onLocAddChange(level, wx, wz, loc); this.liveLeafFeed(level, wx, wz, loc, info); this.fireLocZoneChange(level, wx, wz, loc, info >> 2, info & 3); break; }
            case ServerProt.LOC_DEL: { const info = this.in.g1(); this.ackRevs[Rev.Loc]!++; this.doorTracker?.onLocDel(level, wx, wz); if (this.doorTracker) delLiveLeaf(level, wx, wz); this.fireLocZoneChange(level, wx, wz, -1, info >> 2, info & 3); break; }
            case ServerProt.LOC_ANIM: { this.in.g1(); this.in.g2(); break; }
            // GROUND ITEMS (loot): OBJ_ADD/REVEAL = coord + obj + count; OBJ_DEL = coord + obj. Track them
            // in groundItems so a looter (talisman hunter) can find + OPOBJ-Take its kill drops.
            case ServerProt.OBJ_ADD: { const obj = this.in.g2(); const count = this.in.g2(); this.ackRevs[Rev.Ground]!++; this.groundItems.set(`${wx},${wz},${obj}`, { x: wx, z: wz, obj, count, tick: this.tickCount }); break; }
            case ServerProt.OBJ_REVEAL: { const obj = this.in.g2(); const count = this.in.g2(); this.in.g2(); this.ackRevs[Rev.Ground]!++; this.groundItems.set(`${wx},${wz},${obj}`, { x: wx, z: wz, obj, count, tick: this.tickCount }); break; }
            case ServerProt.OBJ_DEL: { const obj = this.in.g2(); this.ackRevs[Rev.Ground]!++; this.groundItems.delete(`${wx},${wz},${obj}`); break; }
            case ServerProt.OBJ_COUNT: { const obj = this.in.g2(); this.in.g2(); const nc = this.in.g2(); this.ackRevs[Rev.Ground]!++; const g = this.groundItems.get(`${wx},${wz},${obj}`); if (g) g.count = nc; break; }
            case ServerProt.MAP_ANIM: { this.in.g2(); this.in.g1(); this.in.g2(); break; }
            case ServerProt.MAP_PROJANIM: { this.in.g1(); this.in.g1(); this.in.g2(); this.in.g2(); this.in.g1(); this.in.g1(); this.in.g2(); this.in.g2(); this.in.g1(); this.in.g1(); break; }
            case ServerProt.P_LOCMERGE: { this.in.g1(); this.in.g2(); this.in.g2(); this.in.g2(); this.in.g2(); this.in.g1(); this.in.g1(); this.in.g1(); this.in.g1(); break; }
            default: /* unknown zone op — cannot stay aligned; stop this enclosed block */ this.in.pos = this.in.data.length; break;
        }
    }

    // --- LOC / skilling primitives (mine a rock, use ore on a furnace, smith a bar on an anvil) --------
    // Operate a loc: OPLOC<op> (op1=215, op2=103, op3=187, op4=157, op5=127). payload p2(x) p2(z) p2(loc).
    // MINE a rock = OPLOC1 (op1=Mine); the engine self-continues each swing via p_oploc internally, so one
    // send starts a sustained mine. OPLOC self-routes NAIVELY, so be ON or adjacent to the operable tile.
    opLoc(x: number, z: number, loc: number, op = 1): void {
        this.out.p1Enc(OPLOC_OPCODES[op]);
        this.out.p2(x); this.out.p2(z); this.out.p2(loc);
        // OPLOC DOES NOT SELF-ROUTE. From out of reach the engine answers "I can't reach that!" every
        // tick and the player never steps — which lands as verdict 'refused' (the server DID answer), a
        // materially different diagnosis from the silent-discard case above. Both are named.
        this.expectAck(AckKind.OpLoc, loc, x * 16384 + z);
    }
    // Use an inventory item on a loc: OPLOCU (opcode 60, size 12). Wire order (OpLocUDecoder.ts):
    //   p2(x) p2(z) p2(loc) p2(useObj) p2(useSlot) p2(useCom).
    // SMELT: use an ore on a furnace  -> smelts ONE bar per call (1 runite ore + 8 coal -> 1 runite bar).
    // SMITH: use a bar on an anvil    -> opens the smithing main modal (then click a column via invButton).
    useItemOnLoc(x: number, z: number, loc: number, obj: number, slot: number): void {
        this.out.p1Enc(ClientProt.OPLOCU);
        this.out.p2(x); this.out.p2(z); this.out.p2(loc);
        this.out.p2(obj); this.out.p2(slot); this.out.p2(INV_INTERFACE);
        this.expectAck(AckKind.UseItemOnLoc, loc, obj);
    }
    // Use one inventory item on another: OPHELDU (opcode 136, size 12). Wire order (OpHeldUDecoder.ts):
    //   p2(obj) p2(slot) p2(com) p2(useObj) p2(useSlot) p2(useCom). Both coms are the main backpack.
    useItemOnItem(obj: number, slot: number, useObj: number, useSlot: number): void {
        this.out.p1Enc(ClientProt.OPHELDU);
        this.out.p2(obj); this.out.p2(slot); this.out.p2(INV_INTERFACE);
        this.out.p2(useObj); this.out.p2(useSlot); this.out.p2(INV_INTERFACE);
        this.expectAck(AckKind.UseItemOnItem, obj, useObj);
    }
    // Click a transmitted inventory-list button: INV_BUTTON<op> (op1=make-1, op2=make-5, op3=make-10).
    // payload p2(obj) p2(slot) p2(com). The smithing anvil interface routes its make-N clicks through
    // inv_button1/2/3 on smithing:columnN (column1=1119; rune_scimitar sits at slot 2 of that column).
    invButton(op: number, obj: number, slot: number, com: number): void {
        this.out.p1Enc(INV_BUTTON_OPCODES[op]);
        this.out.p2(obj); this.out.p2(slot); this.out.p2(com);
        // ⭐ THE FLOOR, not a diagnosis. Callers that know WHAT they clicked (shopBuy/shopSell/
        // depositItem/withdrawItem/setCombatStyleByButton) arm their own specific kind immediately
        // after this line, and that record is the one a supervisor should read. This one exists for the
        // callers that do not — a smithing make-N, a trade offer, a hand-rolled bank click in a
        // subclass — so that "the server ignored my container click entirely" is never UNOBSERVED.
        // See AckKind.InvButton's SPEC entry for why its mask is the loosest in the table.
        this.expectAck(AckKind.InvButton, com, obj);
    }
    // Tick of the last "no ore currently available" server message (empty-rock poke answer) — lets
    // mining brains rotate IMMEDIATELY off spent rocks instead of dwelling on a timer.
    lastNoOreTick = -1;

    // =================================================================================================
    // CAPABILITY LAYER — varps, dialog-by-text, prayer, combat style, shop, unequip
    // =================================================================================================
    // Every id used below comes from `capability-tables.ts`, which is GENERATED from the engine's own
    // pack + symbol tables and content scripts (see data/extract-capabilities.mjs). Nothing here
    // hard-codes a component id, and nothing derives one arithmetically — the style buttons alone would
    // defeat that (combat_heavysword runs 4711/4714/4713/4712 for styles 0/1/2/3).
    //
    // THE SHARED DESIGN RULE FOR THIS WHOLE SECTION: **click, then CONFIRM FROM THE SERVER.** Every
    // capability here replaces something that used to fire a packet and assume. The engine silently
    // refuses a click it does not like (an invisible component, a missing weapon tab, an unaffordable
    // buy) — `IfButtonHandler` just returns. So a send is never evidence; the varp, the inventory delta
    // or the worn container is. This is the same lesson as "count the buys from the inventory, not from
    // the clicks" and "a prayer-xp rise IS a bury" (the UPDATE_STAT arm above),
    // applied to every remaining assume-it-worked path in the client.

    // ---- VARPS ------------------------------------------------------------------------------------
    /** Record a varp from the decode loop. Out-of-range ids are IGNORED, never thrown on: the varp set
     *  can grow server-side, and a decode-loop throw kills the bot for a value it does not even read. */
    private setVarp(id: number, value: number): void {
        if (id < 0 || id >= this.varps.length) {
            if (this.debug) console.log(`[fb] varp ${id} out of range (max ${MAX_VARP_ID}) — ignored`);
            return;
        }
        const prev = this.varps[id]!;
        this.varpUpdates++;
        if (prev === value) return;
        this.varps[id] = value;
        this.varpTick[id] = this.tickCount;
        if (this.onVarp) {
            // A hook that throws must not desync the stream: the packet is fully consumed by now, but a
            // throw here would escape the decode loop entirely and drop the bot.
            try { this.onVarp(id, value, prev); } catch (e) { console.error(`[fb] onVarp hook threw:`, (e as Error).stack ?? e); }
        }
    }
    /** Current value of a player variable (0 if never sent — varps default to 0 server-side too). */
    getVarp(id: number): number { return id >= 0 && id < this.varps.length ? this.varps[id]! : 0; }
    /** Tick at which this varp last CHANGED, or -1 if it never has. */
    varpChangedAt(id: number): number { return id >= 0 && id < this.varpTick.length ? this.varpTick[id]! : -1; }

    // ---- QUEST STATE (journal colour channel) ------------------------------------------------------
    // quest-state.ts owns the table and every judgement; this is the three-line bridge from the wire.
    //
    // ⛔ `getVarp` IS PASSED IN, BUT THE TABLE PUBLISHES AN ID FOR EXACTLY ONE QUEST. Every other row
    // carries readVarpId: -1 and quest-state never calls getVarp for it, so there is no way for this
    // bridge to read a non-transmitted varp's permanent 0 as a stage. That is deliberate and it is
    // structural, not a convention — see quest-state.ts's header.

    /**
     * One quest's state as an INTERVAL. `quest` is a questlist key ('prince') or a progress varp name
     * ('princequest'). Returns NOT_OBSERVABLE — never NOT_STARTED — when neither channel can see it.
     */
    questState(quest: string): QuestObservation {
        return questState(id => this.getVarp(id), quest, this.ifColour);
    }

    /** true / false / **undefined** when the state cannot be observed. `if (!isQuestComplete(x))` is
     *  the bug this `undefined` exists to make visible: write `=== false`. */
    isQuestComplete(quest: string): boolean | undefined {
        return isComplete(id => this.getVarp(id), quest, this.ifColour);
    }

    /**
     * The `quests` half of a route-feasibility `BotProfile`, ALL-OR-NOTHING.
     *
     * `.profile` is `{}` (the key ABSENT) unless every required varp is pinned, because
     * route-feasibility reads a supplied map as authoritative — a missing key there means stage 0, so a
     * partial map would silently assert "not started" for everything it omits. Absent => the gate
     * degrades to UNKNOWN, which is the honest answer.
     *
     * Pass the narrow set of varps a specific route actually gates on to get a definite answer far more
     * often than the default (every gating varp in the world).
     */
    questProfilePart(requiredVarps?: readonly string[]): QuestProfileResult {
        return questProfile(id => this.getVarp(id), { journal: this.ifColour, requiredVarps });
    }

    // ---- DIALOG BY TEXT (P0-B) --------------------------------------------------------------------
    // The engine builds a choice with `if_settext(multiN:com_i, "<label>")` + `if_addresumebutton(...)`
    // and resolves p_choiceN from `last_com` (chat.rs2). So the label for option i is ALREADY in
    // `ifText` — the decode has been storing it since IF_SETTEXT was added and nothing ever read it.
    //
    // ⛔ WHY TEXT AND NOT AN OPTION INDEX. Option ORDER is content, and content varies on state the bot
    // cannot see. Karim's kebab prompt is a multi2 normally but a MULTI3 while `%crestquest` is set
    // (kebab_seller.rs2:9-13) — a bot keyed to "root 2459, option 2" answers a different question the
    // moment an unrelated quest var moves. Matching "Yes please." is stable across both.

    /** An ordered policy: the FIRST entry whose regex matches an option's text wins. Empty = today's
     *  behaviour exactly (option 1), so adding this field regressed nothing. */
    dialogPolicy: Array<{ match: RegExp; label?: string }> = [];

    /** The options currently on offer, in display order (index 0 = option 1). Empty unless a multiN
     *  choice is open. An option whose IF_SETTEXT has not arrived yet reads as ''. */
    dialogOptions(): Array<{ com: number; text: string }> {
        const root = DIALOG_ROOT_BY_ID.get(this.chatModalId);
        if (!root) return [];
        return root.optionComs.map(com => ({ com, text: this.ifText.get(com) ?? '' }));
    }

    /** The choice header ("Select an Option", or a custom one from p_choiceN_header). */
    dialogHeader(): string {
        const root = DIALOG_ROOT_BY_ID.get(this.chatModalId);
        return root ? (this.ifText.get(root.headerCom) ?? '') : '';
    }

    /** Click the first option whose label matches. Returns the 1-based option number, or -1 if no
     *  option matched (in which case NOTHING was sent — the caller decides what to do instead). */
    clickDialogByText(pattern: RegExp): number {
        const opts = this.dialogOptions();
        for (let i = 0; i < opts.length; i++) {
            const t = opts[i]!.text.trim();
            if (t && pattern.test(t)) {
                this.ifButton(opts[i]!.com);
                if (this.debug) console.log(`[fb] dialog: "${t}" (option ${i + 1}, com ${opts[i]!.com}) matched ${pattern}`);
                return i + 1;
            }
        }
        return -1;
    }

    // ---- PRAYER (P0-C) ----------------------------------------------------------------------------
    // A prayer toggle is an IF_BUTTON on the prayer tab component; the button's OWN `pushvar,prayerN`
    // binding names the varp that reads 1 while it is lit, so activation is CONFIRMABLE. The mapping is
    // not derivable: the constants run thickskin=1, rockskin=2, steelskin=3 while the varps run
    // thickskin=prayer0, strengthburst=prayer1, clarity=prayer2 — different orders entirely.
    private lastPrayerClick = new Map<number, number>();
    /** Ticks to wait for the varp confirm before re-clicking a prayer (the server answers next tick). */
    prayerConfirmTicks = Number(process.env.FB_PRAYER_CONFIRM_TICKS ?? 4);

    /** Look a prayer up by short name ('protectfrommelee') or full name ('prayer_protectfrommelee'). */
    prayerEntry(name: string): PrayerEntry | undefined {
        return PRAYER[name] ?? PRAYER[name.replace(/^prayer_/, '')];
    }
    /** Is this prayer lit, per the server's own varp? */
    isPrayerActive(name: string): boolean {
        const p = this.prayerEntry(name);
        return !!p && this.getVarp(p.varp) === 1;
    }
    /** Short names of every prayer the server currently reports as lit. */
    activePrayers(): string[] { return PRAYERS.filter(p => this.getVarp(p.varp) === 1).map(p => p.name); }
    /** Is anything praying? Derived from the per-prayer varps, which DO transmit.
     *
     * ⛔ DO NOT REACH FOR `prayer_drain_effect` HERE. It looks like the perfect signal — prayer.rs2 keeps
     * it as the drain timer's running total — but it is declared WITHOUT `transmit=yes`, so the server
     * never sends it and a client-side read is 0 forever. The first cut of this package did exactly
     * that, and the live probe caught it: drain_effect read 0 while protect-from-melee was lit and
     * burning prayer points 45 -> 44. A silent 0 there would have read as "no prayers active" — absence
     * looking exactly like zero. The generator now refuses to emit non-transmitted varps at all. */
    prayersActive(): boolean { return PRAYERS.some(p => this.getVarp(p.varp) === 1); }

    /** Toggle a prayer TOWARDS `want`. Returns true if a click was sent (i.e. the tick was spent).
     *  Idempotent: already in the wanted state -> false, no packet. Re-clicks only after the confirm
     *  window lapses, so a refused click (level too low, prayer points at 0 — prayer.rs2:2-8 answers
     *  with a message and `return(false)`) retries at a sane rate instead of every tick. */
    private setPrayer(name: string, want: boolean): boolean {
        const p = this.prayerEntry(name);
        if (!p) { console.error(`[fb] ${this.loginUser}: unknown prayer '${name}' — known: ${PRAYERS.map(x => x.name).join(', ')}`); return false; }
        if ((this.getVarp(p.varp) === 1) === want) return false;
        const last = this.lastPrayerClick.get(p.com) ?? -1000;
        if (this.tickCount - last < this.prayerConfirmTicks) return false;
        this.lastPrayerClick.set(p.com, this.tickCount);
        this.ifButton(p.com);
        return true;
    }
    /** Light a prayer. True = a click was sent this tick. */
    activatePrayer(name: string): boolean { return this.setPrayer(name, true); }
    /** Extinguish a prayer. True = a click was sent this tick. */
    deactivatePrayer(name: string): boolean { return this.setPrayer(name, false); }
    /** Turn every lit prayer off. True = a click was sent this tick. */
    deactivateAllPrayers(): boolean {
        for (const p of PRAYERS) if (this.getVarp(p.varp) === 1 && this.setPrayer(p.name, false)) return true;
        return false;
    }

    // ---- COMBAT STYLE (P0-D) ----------------------------------------------------------------------
    // `%com_mode` is the selected style index and is READ BACK, which is the whole point: the old
    // prepWeaponStyle clicked a hardcoded button three times and declared victory, because there was no
    // way to ask. There is now.
    //
    // ⛔ THE FAILURE THIS PREVENTS (measured): the style click is only
    // accepted while the weapon's tab is bound, and the tab is only bound by `if_settab` when a weapon of
    // that class is WORN (player_attackstyles.rs2). Click unarmed and the server drops it silently. The
    // bot then trains ATTACK ONLY — `weapon_unarmed_table` has no controlled row at all — while every
    // counter says it is fighting fine. Three blind clicks could not tell that apart from success; a
    // varp readback can, and says so loudly.
    //
    // And com_mode is SCOPE_TEMP (no `scope=perm`), so it RESETS TO 0 ON EVERY LOGIN. A bot that
    // reconnects must re-assert it per session — which is why `styleConfirmed` is session state, not a
    // once-ever latch.

    /** The style the server says is selected (0..3). Fresh session = 0 until we set it. */
    combatStyle(): number { return this.getVarp(VARP.COM_MODE); }

    /** The style table for a weapon tab, e.g. STYLE_INTERFACE.combat_hacksword. */
    styleInterface(iface: string): StyleInterfaceEntry | undefined { return STYLE_INTERFACE[iface]; }

    /** Resolve a style NAME ('controlled') to its com_mode index for a given weapon tab, or -1 when
     *  that weapon has no such style. Unarmed has no 'controlled' — the caller must be able to find
     *  that out rather than click into the void. */
    styleIndexFor(iface: string, styleName: string): number {
        const s = STYLE_INTERFACE[iface];
        if (!s) return -1;
        const want = styleName.toLowerCase();
        for (let i = 0; i < s.styleNames.length; i++) if (s.styleNames[i] === want) return i;
        return -1;
    }

    /** The component that selects `style` on `iface`, or -1. */
    styleButtonFor(iface: string, style: number): number {
        const s = STYLE_INTERFACE[iface];
        const com = s?.buttons[style];
        return com === undefined ? -1 : com;
    }

    /** Reverse lookup for a legacy hardcoded button id: which tab + style is it? Used to keep the old
     *  `styleButton` field working while telling us what it actually means. */
    styleOfButton(com: number): { iface: string; style: number } | undefined { return STYLE_BUTTON_LOOKUP.get(com); }

    // Set-with-verify state. Keyed on nothing but the session: a re-wield resets it via rearmStyle().
    private styleWantCom = -1;
    private styleWantIdx = -1;
    private lastStyleClick = -100;
    private styleAttempts = 0;
    /** Set once the server's com_mode matches what we asked for. */
    styleConfirmed = false;
    /** Latched when the retries run out — a supervisor/status line can SEE a bot training the wrong stat. */
    styleFailed = false;
    /** Ticks to wait for the com_mode confirm before re-clicking. */
    styleConfirmTicks = Number(process.env.FB_STYLE_CONFIRM_TICKS ?? 4);
    /** How many clicks before giving up and latching styleFailed. */
    styleMaxAttempts = Number(process.env.FB_STYLE_ATTEMPTS ?? 6);

    /** Ask for a style by BUTTON component id, and verify via com_mode.
     *  Returns true when a click was sent this tick (the tick is spent), false when there is nothing to
     *  do — either because it is already confirmed or because we have given up. */
    setCombatStyleByButton(com: number): boolean {
        const known = STYLE_BUTTON_LOOKUP.get(com);
        if (com !== this.styleWantCom) {   // a new target resets the attempt budget
            this.styleWantCom = com;
            this.styleWantIdx = known ? known.style : -1;
            this.styleConfirmed = false;
            this.styleFailed = false;
            this.styleAttempts = 0;
        }
        // CONFIRMED: the server's own com_mode is the style we asked for. When the button is not in the
        // generated table (a caller passing a raw id we do not know) we cannot verify — say so once and
        // fall back to the old fire-and-hope, rather than looping forever on an unverifiable target.
        if (this.styleWantIdx < 0) {
            if (!this.styleConfirmed) {
                console.log(`[fb] ${this.loginUser}: style button ${com} is not a known style component — ` +
                    `clicking it UNVERIFIED (no com_mode readback possible)`);
                this.ifButton(com);
                this.styleConfirmed = true;
                return true;
            }
            return false;
        }
        if (this.combatStyle() === this.styleWantIdx) {
            if (!this.styleConfirmed) {
                this.styleConfirmed = true;
                if (this.debug) console.log(`[fb] ${this.loginUser}: style CONFIRMED com_mode=${this.styleWantIdx} (${known!.iface})`);
            }
            return false;
        }
        this.styleConfirmed = false;
        if (this.styleFailed) return false;
        if (this.tickCount - this.lastStyleClick < this.styleConfirmTicks) return false;
        if (this.styleAttempts >= this.styleMaxAttempts) {
            this.styleFailed = true;
            console.error(`[fb] ${this.loginUser}: ⛔ ATTACK STYLE NOT SET after ${this.styleAttempts} clicks — ` +
                `wanted ${known!.iface} style ${this.styleWantIdx}` +
                `${known!.iface in STYLE_INTERFACE && STYLE_INTERFACE[known!.iface]!.styleNames[this.styleWantIdx] ? ` (${STYLE_INTERFACE[known!.iface]!.styleNames[this.styleWantIdx]})` : ''}` +
                `, com_mode is still ${this.combatStyle()}. The tab is almost certainly not bound (no weapon of ` +
                `that class worn) — this bot is training the WRONG STAT and will keep looking healthy.`);
            return false;
        }
        this.styleAttempts++;
        this.lastStyleClick = this.tickCount;
        this.ifButton(com);
        // HISTORICAL FAILURE #3: a blind style triple-click trained attack-only for
        // an hour. The bespoke budget above already catches it for THIS call site; arming the shared
        // ledger too is what puts it on the SAME greppable channel (`ACK-NOACK-SET-STYLE`) as every
        // other silent interaction, so a supervisor greps one string and finds the whole class.
        // VARP_IS, not VARP: the assertion is "com_mode became the style we asked for", nothing weaker.
        this.expectAck(AckKind.SetStyle, com, this.styleWantIdx, 0, -1, VARP.COM_MODE, this.styleWantIdx);
        return true;
    }

    /** Ask for a style by NAME on a named weapon tab, e.g. ('combat_hacksword', 'controlled').
     *  Returns false and logs if that weapon has no such style (unarmed has no controlled row). */
    setCombatStyle(iface: string, styleName: string): boolean {
        const idx = this.styleIndexFor(iface, styleName);
        if (idx < 0) {
            const s = STYLE_INTERFACE[iface];
            console.error(`[fb] ${this.loginUser}: '${styleName}' is not a style of ${iface} ` +
                `(it has: ${s ? s.styleNames.join(', ') || '<unknown>' : 'no such tab'})`);
            return false;
        }
        const com = this.styleButtonFor(iface, idx);
        return com > 0 ? this.setCombatStyleByButton(com) : false;
    }

    // ---- SHOP (P1-G) ------------------------------------------------------------------------------
    // ONE shop API for the three that existed. shop.rs2 is the ground truth for all of it:
    //   * op3 on the keeper opens `shop_template` + `shop_template_side` (IF_OPENMAIN_SIDE), so the modal
    //     id to watch is SHOP.MAIN;
    //   * the shop's stock is transmitted to SHOP.INV, a mirror of YOUR backpack to SHOP.SIDE_INV;
    //   * inv_button2/3/4 = quantity 1/5/10 on BOTH sides, and there is NO buy-X or sell-X.
    //
    // ⛔ THE COUNTER BUG THIS FIXES. An earlier shopper clicked INV_BUTTON2 — which buys exactly ONE —
    // and did `bought += 5`. A counter that over-reports 5x does not merely mislead: it hides a drained
    // shelf behind healthy-looking shopping. So the shared primitive does not count clicks: `shopBuy`/`shopSell` report
    // what the INVENTORY actually did, and the click quantity is chosen from the generated button table
    // rather than assumed.
    private lastShopClick = -100;
    /** Minimum ticks between shop clicks — an UPDATE_INV lands a tick or more after the click, and a
     *  loop that re-reads inventory faster than that buys again against a stale number. */
    shopClickGap = Number(process.env.FB_SHOP_GAP ?? 2);

    /** Is a shop modal open right now? */
    shopIsOpen(): boolean { return this.mainModalId === SHOP.MAIN; }

    /** Has the inter-click gap elapsed, i.e. would a `shopBuy`/`shopSell` be allowed to send now?
     *
     *  ⛔ WHY A CALLER NEEDS THIS: `shopBuy` returns 0 for FIVE different reasons — shop not open, want
     *  < 1, gap not elapsed, item not carried/sold out, quantity step overshoots — and a caller reading
     *  only the 0 cannot tell "wait one tick" from "this shelf is empty, go somewhere else". That is the
     *  same ambiguity class the rest of this package exists to remove, one call lower down.
     *  ⛔ AND NO PRICE LOGIC LIVES HERE. maxprice sizing needs stockBase/sellMultiplier/shop_delta, and
     *  the shop modal transmits NONE of them — a primitive that guessed would be inventing numbers. */
    shopClickReady(): boolean { return this.tickCount - this.lastShopClick >= this.shopClickGap; }

    /** The shop's stock: every slot with its obj and count. A sold-out line still SHOWS, at count 0 —
     *  presence is not stock, which is why `shopStockOf` exists separately. */
    shopStock(): Array<{ slot: number; obj: number; count: number }> {
        const inv = this.invs.get(SHOP.INV);
        if (!inv) return [];
        const out: Array<{ slot: number; obj: number; count: number }> = [];
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i]! > 0) out.push({ slot: i, obj: inv.ids[i]!, count: inv.counts[i]! });
        return out;
    }
    /** How many of `obj` the shop currently has in stock (0 = sold out or not carried). */
    shopStockOf(obj: number): number {
        const inv = this.invs.get(SHOP.INV);
        if (!inv) return 0;
        let n = 0;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) n += inv.counts[i]!;
        return n;
    }
    /** The shop's slot holding `obj` WITH stock in it, or -1. */
    shopSlotOf(obj: number, requireStock = true): number {
        const inv = this.invs.get(SHOP.INV);
        if (!inv) return -1;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj && (!requireStock || inv.counts[i]! > 0)) return i;
        return -1;
    }
    /** Our backpack MIRROR as the shop sees it (SHOP.SIDE_INV) — the slot a sell click must name. */
    shopSellSlotOf(obj: number): number {
        const inv = this.invs.get(SHOP.SIDE_INV);
        if (!inv) return -1;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) return i;
        return -1;
    }

    /** The largest single-click quantity that does not exceed `want`, and its INV_BUTTON op.
     *  Returns null when even the smallest step overshoots (i.e. want < 1). */
    private shopStep(want: number, buttons: Readonly<Record<number, number>>): { qty: number; op: number } | null {
        for (const qty of SHOP_STEPS) {
            if (qty <= want) {
                const op = buttons[qty];
                if (op !== undefined) return { qty, op };
            }
        }
        return null;
    }

    /** Buy up to `want` of `obj` with ONE click, sized to overshoot neither `want` nor the shelf.
     *  Returns the quantity the click ASKED for (0 = nothing sent). The caller must confirm the result
     *  from its own inventory delta — the server refuses an unaffordable or out-of-stock buy silently. */
    shopBuy(obj: number, want = 1): number {
        if (!this.shopIsOpen() || want < 1) return 0;
        if (this.tickCount - this.lastShopClick < this.shopClickGap) return 0;
        const slot = this.shopSlotOf(obj, true);
        if (slot < 0) return 0;                                   // sold out / not carried
        const cap = Math.min(want, this.shopStockOf(obj));        // never ask for more than the shelf holds
        const step = this.shopStep(cap, SHOP_BUY_BUTTON);
        if (!step) return 0;
        this.invButton(step.op, obj, slot, SHOP.INV);
        this.lastShopClick = this.tickCount;
        this.expectAck(AckKind.ShopBuy, obj, step.qty);
        return step.qty;
    }

    /** Sell up to `want` of `obj` with ONE click. Same contract as shopBuy: the return value is what was
     *  ASKED for, not what moved — a shop that does not stock the item refuses click by click. */
    shopSell(obj: number, want = 1): number {
        if (!this.shopIsOpen() || want < 1) return 0;
        if (this.tickCount - this.lastShopClick < this.shopClickGap) return 0;
        const slot = this.shopSellSlotOf(obj);
        if (slot < 0) return 0;
        const step = this.shopStep(Math.min(want, this.countInInv(obj)), SHOP_SELL_BUTTON);
        if (!step) return 0;
        this.invButton(step.op, obj, slot, SHOP.SIDE_INV);
        this.lastShopClick = this.tickCount;
        this.expectAck(AckKind.ShopSell, obj, step.qty);
        return step.qty;
    }

    // ---- UNEQUIP (P1-I) ---------------------------------------------------------------------------
    // equip.rs2:3-8 — `[inv_button1,wornitems:wear] ... ~unequip(last_slot)`. So removing a worn item is
    // an INV_BUTTON1 against the WORN container, naming the WORN slot (not a backpack slot). Both the op
    // and the container come from the generated table, so a content change moves them here first.
    //
    // NOTE the asymmetry with equipping: OPHELD2 wears from the backpack, but there is no OPHELD
    // equivalent for removal — the worn container is an inv like any other and its button1 is the
    // "Remove" op.
    /** The worn container's slot holding `obj`, or -1. */
    wornSlotOf(obj: number): number {
        const inv = this.invs.get(WORN_INV);
        if (!inv) return -1;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) return i;
        return -1;
    }
    // ---- CARRIED RISK (what a death costs right now) ----------------------------------------------
    // The contract is `player/scripts/death.rs2`: a PvE death `inv_dropall`s BOTH the backpack and the
    // worn set — nothing is kept. carried-risk.ts owns the valuation and every trap in it (cost===1 is
    // UNPRICED, not worthless; dummy objs are artwork, not wealth; destroyOnDeath is DELETED, not
    // dropped). This is just the two container reads.

    /** Total experience across every skill. Monotone and server-granted — the watchdog's best signal. */
    totalXp(): number {
        let t = 0;
        for (let i = 0; i < this.statXp.length; i++) t += this.statXp[i] ?? 0;
        return t;
    }

    /** Backpack contents as {id, count}, empty slots omitted. */
    invStacks(): Array<{ id: number; count: number }> {
        const inv = this.invs.get(INV_INTERFACE);
        if (!inv) return [];
        const out: Array<{ id: number; count: number }> = [];
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i]! > 0) out.push({ id: inv.ids[i]!, count: inv.counts[i]! });
        return out;
    }

    /** Worn contents as {id, count}. Same shape as invStacks so a valuer takes both without a branch. */
    wornStacks(): Array<{ id: number; count: number }> {
        return this.wornSlots().map(w => ({ id: w.obj, count: w.count }));
    }

    /** Backpack obj ids — what `route-feasibility` NEEDS_ITEM gates are tested against. */
    invObjIds(): number[] {
        const inv = this.invs.get(INV_INTERFACE);
        if (!inv) return [];
        const out: number[] = [];
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i]! > 0) out.push(inv.ids[i]!);
        return out;
    }

    /**
     * ⭐ WHAT A DEATH COSTS RIGHT NOW, itemised. ~2-4us — a reporter-cadence call, not a per-tick one.
     * Use `exposureGp()` on any path that runs more often than that.
     */
    carriedRisk(opts?: { keep?: number }): CarriedRisk {
        return carriedRisk(this.invStacks(), this.wornStacks(), opts);
    }

    /** The cheap half: the PvE loss in gp, no lists, no sort, no allocation beyond the two reads.
     *  ⛔ A LOWER BOUND when unpriced items are held — `carriedRisk().isLowerBound` says so. */
    exposureGp(): number {
        return pveExposure(this.invStacks(), this.wornStacks());
    }

    /** Everything currently worn, as {slot, obj, count}. */
    wornSlots(): Array<{ slot: number; obj: number; count: number }> {
        const inv = this.invs.get(WORN_INV);
        if (!inv) return [];
        const out: Array<{ slot: number; obj: number; count: number }> = [];
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i]! > 0) out.push({ slot: i, obj: inv.ids[i]!, count: inv.counts[i]! });
        return out;
    }
    /** Remove a worn item back into the backpack. Returns false (nothing sent) when it is not worn.
     *  The result is confirmed by BOTH containers updating — worn loses it, backpack gains it — so a
     *  caller should verify with isWorn()/slotOf() rather than trusting this return. */
    unequipItem(obj: number): boolean {
        const slot = this.wornSlotOf(obj);
        if (slot < 0) return false;
        this.invButton(UNEQUIP_BUTTON, obj, slot, WORN_INV);
        // WORN_DOWN: the worn container LOSING it is the proof, exactly as the doc comment above says.
        // The boolean return is unchanged — every existing caller is byte-identical.
        this.expectAck(AckKind.Unequip, obj, slot, obj);
        return true;
    }

    // --- noted-bulk bank primitives (all numbers engine-verified) --------------------------
    // The bank amount prompt: set when P_COUNTDIALOG (210) arrives; -1 = no prompt pending.
    countDialogTick = -1;
    // RESUME_P_COUNTDIALOG (opcode 102, length 4, one signed p4): answers the Withdraw-X/Deposit-X
    // prompt. Send ONLY after countDialogTick is set — the server drops an unsolicited reply. N > held
    // withdraws everything available; N <= 0 aborts silently (bank.rs2:43-49).
    submitCountDialog(n: number): void { this.out.p1Enc(ClientProt.RESUME_P_COUNTDIALOG); this.out.p4(n); this.countDialogTick = -1; }
    // Bank note-mode: bank_main:com_93 (5386) = "Note", com_94 (5387) = "Item" -> %bankcert varp 115
    // (bank.rs2:12-13). ⚠ openbank RESETS %bankcert to 0 on EVERY open (bank.rs2:19) — re-arm the note
    // toggle after each bank open, never assume it stuck. With note mode ON a non-stackable withdraws
    // as its CERT id (cert_* = unnoted+1, stackable) via inv_moveitem_cert (InvOps.ts:554-557).
    bankSetNoteMode(on: boolean): void { this.ifButton(on ? 5386 : 5387); }
    // Withdraw-X / Deposit-X: INV_BUTTON5 on the bank inv coms (withdraw com 5382 = bank_main:inv,
    // slot+obj = the BANK slot being drawn from; deposit com 2006 = bank_side:inv, slot+obj = the
    // BACKPACK slot). The server then opens the count dialog -> submitCountDialog answers it.
    bankWithdrawX(obj: number, slot: number): void { this.invButton(5, obj, slot, 5382); }
    bankDepositX(obj: number, slot: number): void { this.invButton(5, obj, slot, 2006); }

    // ---- SEMANTIC SESSION RECORDER (FB_RECORD=path; additive) -------------------------------------
    // Appends one JSONL line per tick of the bot's DECODED view: position, backpack (aggregated),
    // last-seen messages, modal. The sim's replay validator (sim/replay-validate.ts) compares a live
    // recording's metric timeline against the SAME brain run offline — the drift detector that keeps
    // the sim honest against the real engine without re-porting anything.
    private recBuf: string[] = [];
    private lastRecMsgCount = 0;
    protected recentMsgs: string[] = [];   // rolling; MESSAGE_GAME decode appends when recording
    private recordTick(): void {
        try {
            const me = this.tile();
            const pack = new Map<number, number>();
            const inv = this.invForInventory();
            if (inv) for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] > 0) pack.set(inv.ids[i], (pack.get(inv.ids[i]) ?? 0) + inv.counts[i]);
            this.recBuf.push(JSON.stringify({ t: this.tickCount, x: me.x, z: me.z, modal: this.mainModalId, pack: [...pack], msgs: this.recentMsgs.splice(0) }));
            if (this.recBuf.length >= 50) {
                const { appendFileSync } = require('fs') as typeof import('fs');
                appendFileSync(process.env.FB_RECORD!, this.recBuf.splice(0).join('\n') + '\n');
            }
        } catch { /* recorder must never break the bot */ }
    }

    // ---- CLIENT-SIDE BANK LEDGER (additive) ---------------------------------------------
    // The demo server exposes NO server-side state, so a bank ledger is built purely
    // from what each CLIENT observes: the account's FULL bank arrives as inv com 5382 on every bank
    // open (and deposits stream in as partials). Snapshot bank+backpack to logs/vault/<account>.json
    // whenever 5382 updates. A missing or old snapshot means UNKNOWN — the ledger reader must never render absence as zero.
    private lastVaultWriteTick = -100;
    private snapshotVault(): void {
        if (!this.loginUser || this.tickCount - this.lastVaultWriteTick < 25) return;
        this.lastVaultWriteTick = this.tickCount;
        try {
            const dir = process.env.VAULT_DIR ?? `${import.meta.dir}/../../../logs/vault`;
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const dump = (inv: { ids: Int32Array; counts: Int32Array } | undefined) => {
                const agg = new Map<number, number>();
                if (inv) for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] > 0 && inv.counts[i] > 0) agg.set(inv.ids[i], (agg.get(inv.ids[i]) ?? 0) + inv.counts[i]);
                return [...agg].map(([id, n]) => ({ id, n }));
            };
            writeFileSync(`${dir}/${this.loginUser}.json`, JSON.stringify({
                account: this.loginUser, ts: Date.now(), tick: this.tickCount,
                bank: dump(this.invs.get(5382)), backpack: dump(this.invForInventory()),
            }));
        } catch { /* the ledger is best-effort observation — it must never break the bot */ }
    }

    // ---- ACCOUNT LEDGER: STATS. Bank contents are snapshotVault's job (logs/vault/<account>.json, on every bank update); this writes
    // logs/accounts/<account>.json — base level + xp per skill, total, tile, worn, backpack. Driven by UPDATE_STAT: the
    // server sends every stat at login, so even an idle bot writes once, then at most every ~2 min while xp moves (the
    // trailing stats of a login burst land in the next write). A ledger reader can merge both files.
    private lastAcctWriteTick = -1000; private acctDirty = false; private acctFirstSeen = -1;
    private snapshotAccount(): void {
        this.acctDirty = true;
        // first write ~10 ticks after the burst starts (the whole login burst has landed), then at most every 200 ticks
        if (!this.loginUser) return;
        if (this.lastAcctWriteTick < 0) { if (this.acctFirstSeen < 0) this.acctFirstSeen = this.tickCount; if (this.tickCount - this.acctFirstSeen < 10) return; }
        else if (this.tickCount - this.lastAcctWriteTick < 200) return;
        // wait until the login burst has delivered hitpoints (a fresh account's hp is 10, never 0): a write taken
        // after the first stat alone would record 20 skills as 0
        if (!(this.statXp[3]! > 0)) return;   // (stays dirty: the per-tick flush retries)
        this.lastAcctWriteTick = this.tickCount; this.acctDirty = false;
        try {
            const dir = process.env.ACCOUNTS_DIR ?? `${import.meta.dir}/../../../logs/accounts`;
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const skills: Record<string, { level: number; xp: number }> = {};
            let total = 0;
            ACCT_STAT_NAMES.forEach((name, i) => {
                if (name.startsWith('stat')) return;   // 18/19 are unused in this era
                const xp = this.statXp[i] ?? 0; const lvl = Math.max(1, levelForDisplayedXp(xp));
                skills[name] = { level: lvl, xp }; total += lvl;
            });
            const pack = new Map<number, number>(); const inv = this.invForInventory();
            if (inv) for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] > 0 && inv.counts[i] > 0) pack.set(inv.ids[i], (pack.get(inv.ids[i]) ?? 0) + inv.counts[i]);
            const worn: number[] = []; const w = this.invs.get(WORN_INTERFACE);
            if (w) for (let i = 0; i < w.ids.length; i++) if (w.ids[i] > 0) worn.push(w.ids[i]);
            const t = this.playerTile();
            writeFileSync(`${dir}/${this.loginUser}.json`, JSON.stringify({
                account: this.loginUser, ts: Date.now(), tile: { x: t.x, z: t.z, level: this.minusedlevel }, total, skills,
                worn, backpack: [...pack].map(([id, n]) => ({ id, n })),
            }));
        } catch { /* the ledger is best-effort observation — it must never break the bot */ }
    }

    // op5 on an inv item = Drop ([opheld5,_] -> ~dropslot). OPHELD5 opcode 42, payload obj/slot/com.
    // Skilling bots use it to clear a junk starter kit so a full ore+flux load (e.g. 1 ore + 8 coal) fits.
    dropItem(obj: number, slot: number): void {
        this.out.p1Enc(ClientProt.OPHELD5);
        this.out.p2(obj); this.out.p2(slot); this.out.p2(INV_INTERFACE);
        this.expectAck(AckKind.DropItem, obj, slot);
    }
    // Count of an obj across the backpack (skilling brains gate phases on ore/bar/product totals).
    countOf(obj: number): number { return this.countInInv(obj); }
    // Non-empty backpack slots as {slot,obj,count} — for clearing junk / inspecting a skilling load.
    backpackSlots(): { slot: number; obj: number; count: number }[] {
        const inv = this.invForInventory(); const out: { slot: number; obj: number; count: number }[] = [];
        if (!inv) return out;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] > 0 && inv.counts[i] > 0) out.push({ slot: i, obj: inv.ids[i], count: inv.counts[i] });
        return out;
    }

    // ========================================================================
    // BUILD ITEM 1 — LOOT + BURY. `[opheld1,_bones]` on anything in BURYABLE_BONES.
    // ========================================================================
    /** Buryable bones currently in the backpack (the thing that must not silently climb). */
    bonesHeld(): number {
        let n = 0;
        for (const s of this.backpackSlots()) if (BURYABLE_BONES.has(s.obj)) n += s.count;
        return n;
    }
    /** Bone-shaped items that CANNOT be buried (notes + the mm_* decoys) — a pure slot leak. */
    boneNotesHeld(): number {
        let n = 0;
        for (const s of this.backpackSlots()) if (BONE_LOOKALIKES.has(s.obj)) n += s.count;
        return n;
    }
    /** True if `obj` is EQUIPPED (worn inv 1688) — how we know a spare weapon needs wielding. */
    isWorn(obj: number): boolean {
        const w = this.invs.get(WORN_INTERFACE);
        if (!w) return false;
        for (let i = 0; i < w.ids.length; i++) if (w.ids[i] === obj) return true;
        return false;
    }
    /** Free backpack slots (28 total). A full pack makes the engine drop new loot ON THE FLOOR. */
    freePackSlots(): number {
        const inv = this.invForInventory();
        if (!inv) return 0;
        let used = 0;
        for (let i = 0; i < Math.min(28, inv.ids.length); i++) if (inv.ids[i]! > 0) used++;
        return 28 - used;
    }
    /** Bones acquired = inventory truth. Deaths/buries only ever REDUCE the count, so a rise is a take. */
    private accountBones(): void {
        const held = this.bonesHeld();
        if (held > this.lastBonesHeld) this.bonesTaken += held - this.lastBonesHeld;
        this.lastBonesHeld = held;
    }
    // Bury one bone from the backpack. Returns true if this tick is SPENT on burying.
    // ⛔ NEVER SEND A MOVE WHILE A BURY IS PENDING: bury_bone.rs2:8 is `p_stopaction`, and
    // OpHeldHandler calls clearPendingAction — a MOVE in the same or next tick cancels the bury and the
    // bone stays in the pack forever (the slot leak). So this returns true (holding the tick) for
    // buryCadence ticks after each send, and the caller must not walk while it does.
    protected tryBuryBones(): boolean {
        if (!this.lootBury) return false;
        if (this.tickCount - this.lastBuryTick < this.buryCadence) return this.bonesHeld() > 0;
        let slot = -1, obj = -1;
        for (const s of this.backpackSlots()) {
            // Best-value first: a big bone (150) is worth 3.33 plain ones, and a bot that dies with the
            // valuable bone still in the pack loses it — bury the expensive one first.
            if (!BURYABLE_BONES.has(s.obj)) continue;
            if (obj < 0 || BURYABLE_BONES.get(s.obj)! > BURYABLE_BONES.get(obj)!) { obj = s.obj; slot = s.slot; }
        }
        if (slot < 0) return false;
        this.opHeld1(obj, slot);
        this.buryAttempts++;
        this.lastBuryTick = this.tickCount;
        return true;
    }
    // Take the nearest wanted ground pile (bones + lootTypes). Returns true if this tick is SPENT.
    // OPOBJ self-routes NAIVELY (like OPLOC), so a MOVE precedes it when we are not already on/next to
    // the tile.
    protected tryTakeLoot(): boolean {
        if (!this.lootBury) return false;
        if (this.freePackSlots() <= 0) return false;                 // no room: bury first (caller order)
        const me = this.playerTile();
        // Hoisted once per call: wornGear() allocates, and this loop can see dozens of piles.
        const gctx = this.gearMode ? this.gearCtx() : null;
        const gworn = this.gearMode ? this.wornGear() : null;
        let best: { x: number; z: number; obj: number } | undefined; let bestD = Infinity;
        for (const [key, g] of this.groundItems) {
            if (this.tickCount - g.tick > 300) { this.groundItems.delete(key); continue; }
            // UPGRADE-ONLY GEAR LOOTING. The 28-slot budget already carries food + a bone buffer + the
            // death spare, so taking armour "to sort out later" is how the pack fills and the engine starts
            // throwing fresh drops on the floor. A wearable is taken ONLY if it beats what is worn right now.
            let wantGear = false;
            if (gctx && gworn && isWearable(g.obj) && !this.gearUnwearable.has(g.obj)) {
                const row = gearFor(g.obj);
                // WHOLE-LOADOUT, same verdict the wear loop uses — otherwise the walk to a pile and the
                // decision to wear it could disagree, and the bot would fetch what it will never put on.
                if (row && loadoutDelta(row, gworn, gctx) > 0) wantGear = true;
            }
            if (!wantGear && !BURYABLE_BONES.has(g.obj) && !this.lootTypes.has(g.obj)) continue;
            const skipUntil = this.lootSkip.get(key);
            if (skipUntil !== undefined && skipUntil > this.tickCount) continue;
            const d = Math.max(Math.abs(g.x - me.x), Math.abs(g.z - me.z));
            if (d <= this.lootRadius && d < bestD) { bestD = d; best = { x: g.x, z: g.z, obj: g.obj }; }
        }
        if (!best) return false;
        if (this.tickCount - this.lastTakeTick < 2) return true;   // a take is in flight
        const key = `${best.x},${best.z},${best.obj}`;
        // BLACKLIST A PILE WE CANNOT REACH. A drop behind a palace wall / under an npc answers "I can't
        // reach that!" forever, and a loot loop that never gives up never fights again — a zero-progress
        // bot inside a healthy conn=. Six tries, then ignore it for 300 ticks and go back to work.
        const tries = (this.lootTries.get(key) ?? 0) + 1;
        this.lootTries.set(key, tries);
        if (tries > 6) {
            this.lootSkip.set(key, this.tickCount + 300);
            this.lootTries.delete(key);
            return false;
        }
        if (bestD >= 2) this.sendMove(best.x, best.z, true);
        this.opObj(best.x, best.z, best.obj, 3);                   // OPOBJ3 = Take
        if (this.gearMode && isWearable(best.obj)) this.gearTaken++;
        else if (!BURYABLE_BONES.has(best.obj)) this.lootTaken++;
        this.lastTakeTick = this.tickCount;
        return true;
    }

    // Heal loop: if HP is low and we carry food, eat it (returns true if we acted).
    // Eating takes a few ticks, so gate resends. This is what stops stun-bleed death.
    protected tryHeal(): boolean {
        if (this.foodObj < 0 || this.hp < 0 || this.maxHp < 0) return false;
        if (this.hp > this.eatAtHp()) return false;
        const slot = this.invSlotOf(this.foodObj);
        if (slot < 0) return false; // out of food
        if (this.tickCount - this.lastEatTick < 3) return true; // already eating
        this.sendEat(this.foodObj, slot);
        this.lastEatTick = this.tickCount;
        console.log(`[fb] ${this.loginUser}: HP ${this.hp}/${this.maxHp} -> eating food ${this.foodObj}`);
        return true;
    }

    // Combat training: travel to the goblin field, then punch chickens/rats/
    // goblins to FB_HP_TARGET base hitpoints. `findLongPath` must be injected (the dynamic
    // import happens before run(), so the one-time WASM/collision load never blocks the packet loop).
    setCombatMode(findLongPath: NonNullable<LeanBot['findLongPathFn']>, dest = GOBLIN_SPOT): void {
        this.mode = 'combat';
        this.findLongPathFn = findLongPath;
        this.travelDest = dest;
        console.log(`[fb] ${this.loginUser}: COMBAT mode -> travel to (${dest.x},${dest.z}) then punch npcs ${[...COMBAT_TYPES].join('/')} to base hp ${this.combatHpTarget}`);
    }

    // Expand a coarse corner list into a per-tile path (corners are straight-line
    // connected, so stepping one tile at a time between them stays on walkable ground).
    private densify(corners: { x: number; z: number }[]): { x: number; z: number }[] {
        const out: { x: number; z: number }[] = [];
        for (let i = 0; i < corners.length; i++) {
            const c = corners[i];
            if (i === 0) { out.push({ x: c.x, z: c.z }); continue; }
            let { x, z } = out[out.length - 1];
            while (x !== c.x || z !== c.z) {
                if (x < c.x) x++; else if (x > c.x) x--;
                if (z < c.z) z++; else if (z > c.z) z--;
                out.push({ x, z });
            }
        }
        return out;
    }

    // Send a multi-waypoint MOVE_GAMECLICK: start = current tile, then up to 24
    // corner deltas (signed bytes, so each must be within ±120 of start). The
    // server's clientRoutefinder walks the WHOLE chain in one continuous route,
    // which is what keeps us running straight through highwayman territory.
    private sendMultiMove(pts: { x: number; z: number }[]): void {
        const me = this.playerTile();
        const chosen: { x: number; z: number }[] = [];
        for (const p of pts) {
            if (chosen.length >= 24) break;
            const dx = p.x - me.x;
            const dz = p.z - me.z;
            if (dx < -120 || dx > 120 || dz < -120 || dz > 120) break; // signed-byte reach
            chosen.push(p);
        }
        if (chosen.length === 0) return;
        if (this.debug) {
            const f = chosen[0], l = chosen[chosen.length - 1];
            console.log(`[fb] sendMultiMove from (${me.x},${me.z}) N=${chosen.length} first=(${f.x},${f.z}) last=(${l.x},${l.z}) size=${2 * chosen.length + 5}`);
        }
        this.out.p1Enc(Out.MOVE_GAMECLICK);
        // payload = ctrl(1)+startX(2)+startZ(2)+2*N  => length = 2*N + 5.
        // Server decodes waypoints = (length - 5)/2, so this MUST be 2N+5 (not 2N+3),
        // else 2 stray bytes desync the ISAAC stream and the server drops us.
        this.out.p1(2 * chosen.length + 5);
        this.out.p1(1);                      // ctrl/run
        this.out.p2(me.x);
        this.out.p2(me.z);
        for (const p of chosen) {
            this.out.p1((p.x - me.x) & 0xff);
            this.out.p1((p.z - me.z) & 0xff);
        }
    }

    // --- PORTALS (ADDITIVE; default empty = zero behaviour change) ---------------------------------
    // A surface<->underground hop: underground shares level 0 at z+6400 (movecoord ±6400,
    // trapdoors.rs2:9-11 / stairs.rs2:135), and the two strata are DISCONNECTED for any pathfinder —
    // travel across them must op a ladder/staircase, which telejumps the player. Each entry is the
    // portal on ONE stratum: stand on (standX,standZ) — walkToExact; the loc footprint itself is
    // blocked — then OPLOC<op> the loc at (locX,locZ). The engine telejumps us to the other side.
    portals: { standX: number; standZ: number; locX: number; locZ: number; locId: number; op: number }[] = [];
    private lastPortalTick = -100;
    // True while a cross-stratum hop toward (tx,tz) is being handled (caller should return and wait).
    protected portalHop(tx: number, tz: number): boolean {
        if (!this.portals.length) return false;
        const me = this.playerTile();
        const myUnder = me.z > 6000, destUnder = tz > 6000;
        if (myUnder === destUnder) return false;
        const p = this.portals.find(q => (q.standZ > 6000) === myUnder);   // the portal on MY stratum
        if (!p) {   // one-sided portal cfg would otherwise degrade to a SILENT replan loop (review finding)
            if (this.tickCount % 100 === 0) console.log(`[fb] ${this.loginUser}: cross-stratum dest (${tx},${tz}) but NO portal on this stratum — fix portal= cfg`);
            return false;
        }
        // FAR from the portal: hand the long haul to the NORMAL doTravel flow (door recovery, danger
        // zones, stall repair) by retargeting travelDest at the portal stand — same stratum, so no
        // recursion; walkToExact has no door handling and would wedge on any closed gate en route
        // (review finding). The brain's own travelTo re-asserts the real destination after the hop.
        if (Math.max(Math.abs(me.x - p.standX), Math.abs(me.z - p.standZ)) > 15) {
            this.travelDest = { x: p.standX, z: p.standZ };
            return false;
        }
        if (this.walkToExact(p.standX, p.standZ)) return true;
        if (this.tickCount - this.lastPortalTick >= 8) {
            this.opLoc(p.locX, p.locZ, p.locId, p.op);   // Climb-down/up -> p_telejump to the other side
            this.lastPortalTick = this.tickCount;
        } else this.warm();
        return true;
    }
    // cfg helper: "standX,standZ,locX,locZ,locId,op|standX,..." (used by RUNNER_CFG/MINER_CFG portal=)
    parsePortals(v: string): void {
        for (const part of v.split('|').map(s => s.trim()).filter(Boolean)) {
            const n = part.split(',').map(Number);
            if (n.length < 6 || n.some(x => !Number.isFinite(x))) { console.log(`[fb] bad portal spec '${part}' (want standX,standZ,locX,locZ,locId,op)`); continue; }
            this.portals.push({ standX: n[0], standZ: n[1], locX: n[2], locZ: n[3], locId: n[4], op: n[5] });
        }
    }

    // MULTI-LEVEL DRIVER (ADDITIVE): sequences the leg plan from multiLevelPlanFn — walk to a leg's
    // portal, OPLOC it (telejump), advance to the next leg on its stratum — reusing doTravel's proven
    // single-level walker (door recovery, stall repair) for each leg via travelDest+travelLevel.
    // Returns true = this tick is handled (doTravel returns); false = let doTravel walk the current leg.
    private setMlLeg(i: number): void {
        const leg = this.mlPlan![i]; const end = leg.waypoints[leg.waypoints.length - 1]!;
        this.travelDest = { x: end.x, z: end.z };
        const prev = i === 0 ? null : this.mlPlan![i - 1]!;
        this.travelLevel = prev ? (prev.portal?.dest.level ?? prev.teleport?.dest.level ?? this.mlLegLevel) : this.mlLegLevel;
        // FOLLOW THE PLAN'S OWN WAYPOINTS (engine-true routing: findPathToLoc ends on an interaction-
        // valid tile). Do NOT let doTravel re-derive them with the injected planner — its arrive-
        // laddering can return a degenerate "close enough" 1-waypoint path whose naive hop the server
        // refuses forever (live-caught at the Lumbridge staircase south face).
        this.travelPath = leg.waypoints.length > 1 ? this.densify(leg.waypoints.map(w => ({ x: w.x, z: w.z }))) : null;
        this.travelIdx = this.travelPath ? this.nearestPathIdx(this.travelPath) : 0;
        this.travelStartTick = this.tickCount;
        this.travelStartMs = Date.now();
    }
    // GLOBAL nearest-index snap over a full path. The walker's own snap scans a 40-index window ahead
    // of travelIdx only — re-seeding a long leg with travelIdx=0 while standing 130 tiles along it made
    // the bot MARCH BACKWARD to rejoin the path at index<=40, bouncing forever at the nasty-tree stall
    // (live-caught). Also the death-resume case: a respawned bot re-enters the leg wherever it stands.
    private nearestPathIdx(path: Array<{ x: number; z: number }>): number {
        const me = this.playerTile();
        let best = 0, bestD = Infinity;
        for (let i = 0; i < path.length; i++) {
            const d = Math.max(Math.abs(path[i]!.x - me.x), Math.abs(path[i]!.z - me.z));
            // EARLIEST close index wins, not globally-nearest: an around-the-walls path can END
            // spatially beside its START (2 tiles away THROUGH the wall) — snapping to the late index
            // aims the walker at the wall-blocked hop forever (live-caught at the castle stairs
            // dead-end pocket). Taking the first index within 2 preserves the path's logical order.
            if (d <= 2) return i;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }
    private mlDrive(): boolean {
        if (!this.mlGoal) return false;
        const me = this.playerTile();
        if (!this.mlPlan) {
            // plan from the plane the bot is ON: travelLevel can be stale from an earlier leg (7 rmquest bots on castle
            // L1 were routed "L0 -> staircase -> L1" and walked an L0 path upstairs for 3 h, )
            if (typeof this.minusedlevel === 'number') this.travelLevel = this.minusedlevel;
            const teleCaps = this.mlTeleportCaps();
            const trCaps = this.mlTransportCaps();
            const plan = !this.multiLevelPlanFn ? null : (teleCaps || trCaps)
                ? this.multiLevelPlanFn({ level: this.travelLevel, x: me.x, z: me.z }, this.mlGoal, { ...(teleCaps ? { teleports: teleCaps } : {}), ...(trCaps ? { transports: trCaps } : {}) })
                : this.multiLevelPlanFn({ level: this.travelLevel, x: me.x, z: me.z }, this.mlGoal);
            if (!plan || !plan.length) {   // no planner / no ladder chain -> degrade to single-level best-effort
                this.travelDest = { x: this.mlGoal.x, z: this.mlGoal.z }; this.travelLevel = this.mlGoal.level;
                this.mlGoal = null; return false;
            }
            this.mlPlan = plan; this.mlLegIdx = 0; this.mlLegLevel = this.travelLevel; this.mlClimbing = false;
            console.log(`[fb] ${this.loginUser}: MULTI-LEVEL plan ${plan.length} legs -> (${this.mlGoal.level},${this.mlGoal.x},${this.mlGoal.z}) from (${me.x},${me.z})` +
                plan.map((l, i) => ` | leg${i}: ${l.waypoints.length}wp [${l.waypoints[0]!.x},${l.waypoints[0]!.z}]..[${l.waypoints[l.waypoints.length - 1]!.x},${l.waypoints[l.waypoints.length - 1]!.z}]${l.portal ? ' CLIMB' : ''}${l.teleport ? ` TELEPORT(${l.teleport.id})` : ''}`).join(''));
            this.setMlLeg(0);
        }
        const leg = this.mlPlan[this.mlLegIdx]!;
        if (leg.teleport) return this.mlTeleportStep(leg.teleport, me);
        if (this.mlClimbing) {   // climb issued; keep re-issuing until the telejump lands near the dest
            const p = leg.portal!, d = p.dest;
            // Landing = x/z proximity AND the client's REAL plane (minusedlevel, the 2-bit level in the
            // PLAYER_INFO teleport). Proximity alone FALSE-FIRES on staircases: the dest is ~1 tile from
            // the entrance horizontally, so a bot still standing at the entrance is already "within 6"
            // of the dest and would advance without ever climbing (live-caught: the Duke run "landed" at
            // its own pre-climb tile; the extracted dest was blamed but was in fact faithful).
            // SAME-PLANE GATES (, the Gnome Stronghold gate 190: one loc, two edges, dests 3 tiles apart): when the
            // portal's dest is on the entry plane and within 8 of the loc, "within 6" is true from the ENTRANCE side too, so
            // the climb false-fired from (2463,3382) and leg 1 had no route (live: the swamp-toad camper wedged at the gate).
            // Those portals need the bot within 2 of the dest. Every other portal (ladders, z+6400 stairs) is unchanged.
            const samePlaneGate = d.level === this.mlLegLevel && Math.max(Math.abs(p.x - d.x), Math.abs(p.z - d.z)) <= 8;
            // NAV PHASE 1: a same-plane STAND portal (vines, gates, stones: dest 1-6 tiles from the stand) has landed when we
            // are within 1 of the dest AND off the stand (the stand itself can be within 1-2 of the dest).
            const standLand = p.stand && d.level === this.mlLegLevel
                ? Math.max(Math.abs(me.x - d.x), Math.abs(me.z - d.z)) <= 1 && (me.x !== p.stand.x || me.z !== p.stand.z) : null;
            if (this.minusedlevel === d.level && (standLand !== null ? standLand : Math.max(Math.abs(me.x - d.x), Math.abs(me.z - d.z)) <= (samePlaneGate ? 2 : 6))) {
                this.mlClimbing = false; this.mlForceCommit = false; this.mlLegIdx++; this.mlLegLevel = d.level;
                this.mlRepoStall = 0; this.mlRepoPrevTile = ''; this.mlRepoExtended = false; this.mlRepoTarget = undefined;   // per-climb state
                if (this.mlLegIdx >= this.mlPlan.length) { this.mlGoal = null; this.mlPlan = null; return false; }
                this.setMlLeg(this.mlLegIdx);
                console.log(`[fb] ${this.loginUser}: climbed to (${d.level},${me.x},${me.z}) -> leg ${this.mlLegIdx}`);
                return false;
            }
            // BAIL-OUT: a ladder whose interaction tile the bot can't reach (e.g. a walled tower whose
            // diagonal door the collision omits) would re-OPLOC forever. After ~50 ticks with no
            // telejump, abandon the plan and PARK where we are (arrived=true) — do NOT degrade to a
            // single-level walk toward the goal: a cross-stratum goal (underground z+6400, or an upper
            // floor) is unreachable on this plane, so findLongPathFn would send the bot wandering after
            // the nearest-projection tile (live-caught: it walked north chasing z=9571). Parking stops
            // cleanly and surfaces the bad portal; the caller sees arrived and can react.
            if (this.tickCount - this.mlClimbStartTick > (p.stand || p.action ? 150 : 50)) {   // obstacles/npcs: chance rolls + dialogs
                console.log(`[fb] ${this.loginUser}: CLIMB STALLED at (${me.x},${me.z}) on loc ${p.locId} -> abandoning ML plan + PARKING (unreachable ladder — bad portal data?)`);
                this.mlGoal = null; this.mlPlan = null; this.mlClimbing = false; this.mlForceCommit = false; this.arrived = true; this.arrivedTick = this.tickCount; return true;
            }
            if (p.stand || p.action) return this.mlStandStep(p, me);
            // REPOSITION RECOVERY (GENERAL): the reachedLoc commit accepts a tile the OFFLINE test calls
            // interaction-valid, but the LIVE op sometimes won't fire from there — down-staircases (the
            // op is a DIFFERENT loc from the up-landing you arrive on), forceapproach sides, finicky
            // stand tiles. After a grace window with no telejump, do what the PROVEN portalHop does:
            // walk the bot ONTO the op-tile (walkToExact stops adjacent to the occupied loc), then OPLOC
            // from there. Fixes the whole class (any plane, up or down), not just one staircase.
            const dLadder = Math.max(Math.abs(me.x - p.x), Math.abs(me.z - p.z));
            // ⛔ THE GATE IS MOVEMENT, NOT `atValidTile`. `reachedLoc` says whether the
            // OFFLINE model calls our tile interaction-valid, and for a MULTI-TILE staircase (a 2x3 loc)
            // it says YES for tiles the LIVE op refuses — so `!atValidTile` suppressed the reposition
            // recovery entirely and the leg ran out its 50 ticks and PARKED. Every dungeon camp in P2 is
            // behind a loc of that shape, so the suppression had to go.
            //
            // The guard it replaces was real, though: on a DOWN-staircase the op-tile is often
            // walk-UNREACHABLE from the up-landing you arrive on, and walkToExact then naive-pushes into
            // the wall returning true EVERY tick, starving the re-OPLOC below. Movement settles both
            // cases honestly — if the walker is moving us it is working; if our tile has not changed for
            // 4 attempts it cannot, so it stops being called and the re-OPLOC gets the tick back. A tile
            // change (ours or the engine's op self-route) re-enables it, so nothing is latched shut.
            const atValidTile = p.dims
                ? reachedLoc(this.mlLegLevel, me.x, me.z, p.x, p.z, p.dims.w, p.dims.l, p.angle ?? 0, p.shape ?? 10, locForceApproach(p.locId))
                : dLadder <= 1;
            // `atValidTile` keeps ONE job: a longer grace period before we bother repositioning, because
            // standing still and re-OPLOCing is the cheaper fix when it works (the down-staircase case).
            const graceTicks = atValidTile ? 24 : 12;
            // `|| !atValidTile`: the commit's dLadder<=1 backstop accepts a DIAGONAL tile next to a decor
            // trapdoor (shape 22 = rectangle reach, no corners); the Ice Mountain trapdoor relay sat at (3020,3451) diagonal
            // to (3019,3450) for 4+ hours because a d=1 bot was never repositioned onto the valid (3019,3451).
            const inRepoWindow = this.tickCount - this.mlClimbStartTick > graceTicks && (dLadder > 1 || !atValidTile);
            if (inRepoWindow) {
                const meKey = `${me.x},${me.z}`;
                if (meKey === this.mlRepoPrevTile) this.mlRepoStall++;
                else { this.mlRepoStall = 0; this.mlRepoPrevTile = meKey; }
                if (this.mlRepoStall < 4) {
                    // ONE latched extension of the bail-out clock, the first time a reposition begins: the
                    // walk itself needs ticks, and without this the 50-tick abandon fires mid-approach.
                    // Latched, so a wedged bot can never keep buying itself another window.
                    if (!this.mlRepoExtended) {
                        this.mlRepoExtended = true;
                        this.mlClimbStartTick = this.tickCount;
                        console.log(`[fb] ${this.loginUser}: repositioning onto the op-tile (${p.x},${p.z}) for loc ${p.locId} ` +
                            `from (${me.x},${me.z}) d=${dLadder} atValidTile=${atValidTile} — bail-out clock restarted ONCE`);
                    }
                    // Walk to the ENGINE-VALID approach tile (findPathToLoc honours walls + forceapproach), not onto the
                    // loc itself:  the Edgeville trapdoor (3097,3468) sits inside a ruined house whose east
                    // wall (oldwall x3098) put the arrival tile (3098,3469) diagonal-but-walled; walking "to the loc" never
                    // moved and every OPLOC from outside was ignored (8 chaos hunters parked there for hours).
                    // A MULTI-TILE loc (dims): its origin tile is OCCUPIED, so "walk onto (p.x,p.z)" never moves us. Walk to the
                    // nearest walkable SIDE-adjacent tile of the footprint instead (corners excluded:  the
                    // Dwarven Mine stairs 1734 (3x2 at 3059,9776) — acct4 sat DIAGONAL at (3058,9778) for hours; the offline
                    // reach model calls that corner valid, the engine refuses the op, and (3058,9777) was one step away).
                    // Chosen ONCE per climb: arriving on it hands the ticks to the re-OPLOC below; if the climb still stalls,
                    // the next climb attempt marks this stand tried and picks another face.
                    if (p.dims && this.mlRepoTarget === undefined) {
                        this.mlRepoTarget = this.sideApproachTile(p, me);
                        if (this.mlRepoTarget) console.log(`[fb] ${this.loginUser}: reposition stand for loc ${p.locId}: (${this.mlRepoTarget.x},${this.mlRepoTarget.z})`);
                    }
                    const side = p.dims ? this.mlRepoTarget : null;
                    if (side && me.x === side.x && me.z === side.z) { /* on the stand: the re-OPLOC below */ }
                    else if (this.walkToExact(side?.x ?? p.x, side?.z ?? p.z)) return true;
                } else if (this.mlRepoStall === 4) {
                    console.log(`[fb] ${this.loginUser}: reposition is not moving us off (${me.x},${me.z}) — handing the ticks back to the re-OPLOC`);
                }
            }
            // RE-OPLOC every 8 ticks (the proven portalHop pattern). A single OPLOC self-routes the bot
            // TOWARD the ladder but can stop a tile or two short of the interaction range (the op tile is
            // often un-standable); repeats close that gap and fire the climb once adjacent.
            // TWO-STAGE locs (trapdoor/manhole): the loc's id CHANGES when opened (loc_change), so
            // alternate closed-id (opens it) and altLocId (climbs the open variant) — a mismatched id is
            // silently ignored by the server (World.getLoc misses), so alternation is always safe.
            if (this.tickCount - this.lastMlOplocTick >= 8) {
                // A CLOSED DOOR between us and the operable face hangs the climb forever: the ENGINE's
                // op self-route never opens doors, and this state starves the walk-phase stall-repair
                // that would (RM live-caught: the castle door gated every pocket-side approach). Try a
                // nearby door FIRST; skip the ladder re-OPLOC that cycle so the door's pending op isn't
                // cancelled. tryOpenDoor's per-door 30-tick cooldown bounds the thrash.
                if (this.tryOpenDoor(me.x, me.z, 4)) { this.lastMlOplocTick = this.tickCount; return true; }
                const attempt = Math.floor((this.tickCount - this.mlClimbStartTick) / 8);
                const id = p.altLocId !== undefined && (attempt & 1) === 1 ? p.altLocId : (p.locId ?? 0);
                this.opLoc(p.x, p.z, id, p.op ?? 1);
                this.lastMlOplocTick = this.tickCount;
            }
            else this.warm();
            return true;
        }
        if (leg.portal) {   // walk the leg, then OPLOC once the ENGINE would accept the interaction
            const p = leg.portal;
            const end = leg.waypoints[leg.waypoints.length - 1]!;
            const dLadder = Math.max(Math.abs(me.x - p.x), Math.abs(me.z - p.z));
            const dEnd = Math.max(Math.abs(me.x - end.x), Math.abs(me.z - end.z));
            // Commit ONLY where the op can actually fire — reachedLoc, the ENGINE'S OWN test (footprint
            // + angle + shape + wall edges). Proximity gates failed live twice: committing 5 tiles away
            // THROUGH the wizard-tower wall, then committing 2 tiles from the Lumbridge staircase's
            // approach on a NON-valid tile — the bot froze MOVEs while the engine's self-route bounced,
            // and the bail-out parked a perfectly good plan. When the plan lacks geometry (hand-built
            // sim plans), fall back to tight proximity.
            const canOp = p.stand ? ((me.x === p.stand.x && me.z === p.stand.z) || this.mlForceCommit) : p.dims
                // dLadder<=1 backstop: standing on/adjacent to a 1x1 loc is ALWAYS interaction range —
                // covers decor-shape portals (trapdoor shape 22) if reached()'s dispatch is picky.
                // mlForceCommit: the stall-repair flags "walking wedged at the leg end" (a live-only
                // blocker on the final hop) — hand the last tiles to the ENGINE's op self-routing
                // instead of stalling forever. Bounded by the bail-out.
                // 1x1 ONLY: applied to the 2x2 Lumbridge castle staircase 1738 it committed a climb from
                // (3204,3206) — the walled SOUTH side (reachedLoc false; the engine's route goes round via doors 1536/1530 to
                // the north landing) — and two RM accounts parked there "CLIMB STALLED" for 30+ min.
                ? (reachedLoc(this.mlLegLevel, me.x, me.z, p.x, p.z, p.dims.w, p.dims.l, p.angle ?? 0, p.shape ?? 10, locForceApproach(p.locId))
                    || (dLadder <= 1 && p.dims.w === 1 && p.dims.l === 1)
                    || this.mlForceCommit
                    // PAY-THE-NPC-FIRST portals (then=oploc): hand over within 2 tiles of the leg end; the npc phase reaches
                    // the npc itself. The leg end can be the npc's OWN tile (Brimhaven: Saniboch wanders onto the tree's
                    // south approach) and npcs block players, so that walk never completes.
                    || (p.action?.kind === 'npc' && p.action.then === 'oploc' && dEnd <= 2))
                : (dLadder <= 2 || dEnd <= 2);
            if (canOp) {
                if (this.tickCount - this.lastMlOplocTick >= 8) { if (!this.mlClimbing) { this.mlNpcDone = false; this.mlNpcOps = 0; } if (!p.action || p.action.kind !== 'npc') this.mlOperatePortal(p, p.locId ?? 0); this.lastMlOplocTick = this.tickCount; if (!this.mlClimbing) { this.mlClimbStartTick = this.tickCount; this.mlRepoStall = 0; this.mlRepoPrevTile = ''; this.mlRepoExtended = false; this.mlRepoTarget = undefined; } this.mlClimbing = true; }
                else this.warm();
                return true;
            }
        }
        return false;   // mid-leg (or final leg) -> let doTravel walk travelDest at travelLevel
    }

    // NAV PHASE 1 — operate a portal. No action = the plain OPLOC every existing portal uses (byte-identical).
    //   useitem: OPLOCU the obj on the loc (OPLOCU self-routes naively too: callers are ON the stand already).
    //   npc then=land: OPNPC (dialogs answered by the base option-1 driver, e.g. Captain Barnaby's compliant branch).
    //   npc then=oploc: OPNPC until a doneMsgs line is seen, alternating with the loc op (an already-paid npc answers in
    //   chat, not with a message: the loc op then just works). Saniboch: opnpc3 pays 875 gp, the tree lets you in.
    private mlOperatePortal(p: MlPortal, id: number): void {
        const a = p.action;
        if (!a) { this.opLoc(p.x, p.z, id, p.op ?? 1); return; }
        if (a.kind === 'useitem') {
            const slot = this.invSlotOf(a.obj);
            if (slot < 0) { console.log(`[fb] ${this.loginUser}: transport ${p.id ?? p.label}: obj ${a.obj} not in the pack — cannot use it on loc ${id}`); return; }
            this.useItemOnLoc(p.x, p.z, id, a.obj, slot);
            return;
        }
        if (a.kind === 'chain') {   // NAV PHASE 3: OPLOC the step whose `from` we stand on (mlStandStep re-fires it)
            const me = this.playerTile(), step = a.steps.find(s => s.from.x === me.x && s.from.z === me.z);
            if (step) this.opLoc(step.x, step.z, step.locId, step.op ?? 1);
            else console.log(`[fb] ${this.loginUser}: transport ${p.id ?? p.label}: (${me.x},${me.z}) is not a chain step`);
            return;
        }
        if (a.kind === 'walkafter') {   // NAV PHASE 2: the op (slash) re-fires until a doneMsgs line; mlStandStep then walks
            const kslot = a.knife !== undefined && !this.mlWornSlash() ? this.invSlotOf(a.knife) : -1;
            if (kslot >= 0) this.useItemOnLoc(p.x, p.z, id, a.knife!, kslot); else this.opLoc(p.x, p.z, id, p.op ?? 1);
            return;
        }
        if (a.kind === 'oploc') { this.opLoc(p.x, p.z, id, p.op ?? 1); return; }   // TRAVEL NETWORK: the dialog is mlTransportDialog's
        if (a.then === 'oploc' && !this.mlNpcDone && (a.doneMsgs ?? []).some(m => this.sawMsg(this.mlClimbStartTick, m))) this.mlNpcDone = true;
        const attempt = Math.floor((this.tickCount - this.mlClimbStartTick) / 8);
        if (a.then === 'oploc' && (this.mlNpcDone || (attempt & 1) === 1)) { this.opLoc(p.x, p.z, id, p.op ?? 1); return; }
        const n = this.findNearestNpc(x => x.typeId === a.npc);
        if (n && n.dist <= 16) this.opNpc(n.index, a.npcOp);
        else console.log(`[fb] ${this.loginUser}: transport ${p.id ?? p.label}: npc ${a.npc} not in view from (${this.playerTile().x},${this.playerTile().z})`);
    }
    // One climbing tick of a STAND/ACTION portal: keep (or get back) on the stand tile, operate every 8 ticks (12 for an
    // npc: a ship's sail delay must not be re-triggered). Forced movement (stepping stones, pipes, a lava fail teleport)
    // moves us off the stand: wait while the tile keeps changing; walk back once it has been still for 4 ticks.
    private mlStandStep(p: MlPortal, me: { x: number; z: number }): boolean {
        const key = `${me.x},${me.z}`;
        if (key !== this.mlStandTile) { this.mlStandTile = key; this.mlStandMoveTick = this.tickCount; }
        const st = p.stand;
        const a = p.action;
        // NPC phase: OPNPC self-routes NAIVELY (local engine Saniboch stands south of the 4x4 tree, the bot
        // north of it, 150 ticks of OPNPC never reached him). Walk next to the npc ourselves (stepToNpc), then OPNPC.
        // then=oploc: a doneMsgs line (or 3 unanswered OPNPCs: an already-paid npc only chats) hands over to the loc op.
        if (a?.kind === 'npc' && !(a.then === 'oploc' && this.mlNpcDone)) {
            if (a.then === 'oploc' && ((a.doneMsgs ?? []).some(m => this.sawMsg(this.mlClimbStartTick, m)) || this.mlNpcOps >= 3
                || (a.doneItem !== undefined && this.invSlotOf(a.doneItem) >= 0))) this.mlNpcDone = true;
            else {
                const n = this.findNearestNpc(x => x.typeId === a.npc);
                if (!n || n.dist > 16) {
                    if (this.tickCount - this.lastMlOplocTick >= 12) { console.log(`[fb] ${this.loginUser}: transport ${p.id ?? p.label}: npc ${a.npc} not in view from (${me.x},${me.z})`); this.lastMlOplocTick = this.tickCount; }
                    this.warm(); return true;
                }
                // ⛔ NO MOVE AFTER THE OPNPC. A plain MOVE clears the pending interaction (MoveClickHandler clearPendingAction),
                // and stepping after a wandering npc every tick did exactly that: OPNPC accepted, next MOVE wiped it, the
                // script never ran (debug engine Saniboch, 60-tick wedges on 3 of 4 trips, one permanent).
                // And an npc op fires only from a SIDE-adjacent tile (reachedEntity: no diagonals), which the engine does not
                // route to for us: from further out step closer (stepToNpc), within 3 walk onto a free side tile, and send the
                // OPNPC only from there (no MOVE follows it while we stay put).
                const N = this.npcWorldTile(this.npcs[n.index]!);
                if (Math.abs(N.x - me.x) + Math.abs(N.z - me.z) !== 1) {
                    if (Math.max(Math.abs(N.x - me.x), Math.abs(N.z - me.z)) > 3) { if (this.stepToNpc(n.index, 1)) return true; }
                    const occ = new Set<string>();
                    for (let k = 0; k < this.npcCount; k++) { const m = this.npcs[this.npcIndices[k]!]; if (m) { const w = this.npcWorldTile(m); occ.add(`${w.x},${w.z}`); } }
                    let t: { x: number; z: number } | null = null, bd = Infinity;
                    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
                        const x = N.x + dx, z = N.z + dz;
                        if (occ.has(`${x},${z}`) || !isTileWalkable(this.mlLegLevel, x, z)) continue;
                        const d = Math.max(Math.abs(x - me.x), Math.abs(z - me.z)); if (d < bd) { bd = d; t = { x, z }; }
                    }
                    if (t && this.tickCount - this.mlStandMoveTick >= 2) this.walkToExact(t.x, t.z); else this.warm();
                    return true;
                }
                if (this.tickCount - this.lastMlOplocTick >= 12) { this.opNpc(n.index, a.npcOp); this.mlNpcOps++; this.lastMlOplocTick = this.tickCount; }
                else this.warm();
                return true;
            }
        }
        const npcLand = a?.kind === 'npc' && a.then === 'land';
        // NAV PHASE 2 walkafter: once the op has done its job (doneMsgs since the climb began), walk through to the dest
        if (a?.kind === 'walkafter' && a.doneMsgs.some(m => this.sawMsg(this.mlClimbStartTick, m))) {
            if (this.tickCount - this.mlStandMoveTick >= 2 && this.walkToExact(p.dest.x, p.dest.z)) return true;
            this.warm(); return true;
        }
        // PAID, NOW THE LOC. OPLOC does NOT self-route (the client routes), so an OPLOC from 2 tiles out answers "I can't
        // reach that!" forever: Brimhaven, Saniboch paid from the tree's south side, the bot 2 tiles off the tree while he
        // stood on the approach tile (debug engine, permanent wedge). Walk onto a FREE tile touching the loc first.
        if (a?.kind === 'npc' && a.then === 'oploc' && this.mlNpcDone && !st && p.dims
            && !reachedLoc(this.mlLegLevel, me.x, me.z, p.x, p.z, p.dims.w, p.dims.l, p.angle ?? 0, p.shape ?? 10, locForceApproach(p.locId ?? 0))) {
            const t = this.freeLocApproach(p, me);
            if (t && this.tickCount - this.mlStandMoveTick >= 2 && this.walkToExact(t.x, t.z)) return true;
            this.warm(); return true;
        }
        // NAV PHASE 3 chain (stepping stones, jungle chops): on a step's `from` tile, OPLOC that step (2 ticks after we
        // landed there, then every 8 while nothing moves us: a chop re-rolls, a jump waits out its exactmove). Off the
        // chain (a Shilo river fall washes you up on the FAR bank): once still for 4 ticks walk to the dest if we are past
        // the middle of stand -> dest, else back to the stand.
        if (a?.kind === 'chain' && st) {
            const step = a.steps.find(s => s.from.x === me.x && s.from.z === me.z);
            if (step) {
                // ... and not within 12 ticks of a dialog page; a dialog chain (`choose`: the shipyard password) re-ops only
                // every 40: an OPLOC sent while its script still runs is queued and fires AFTER the teleport inside, from the
                // inside, and the gate puts you back out (local engine nav321/nav322, 32-tick re-op).
                if (this.tickCount - this.mlStandMoveTick >= 2 && this.tickCount - this.dialogActedTick >= 12
                    && (this.tickCount - this.lastMlOplocTick >= (a.choose ? 40 : 8) || (this.lastMlOplocTick < this.mlStandMoveTick && this.mlStandMoveTick > this.mlClimbStartTick + 1))) {   // a real landing, not the first stand tick
                    this.opLoc(step.x, step.z, step.locId, step.op ?? 1); this.lastMlOplocTick = this.tickCount;
                } else this.warm();
                return true;
            }
            if (this.tickCount - this.mlStandMoveTick >= 4) {
                const vx = p.dest.x - st.x, vz = p.dest.z - st.z;
                const t = ((me.x - st.x) * vx + (me.z - st.z) * vz) / Math.max(1, vx * vx + vz * vz);
                const tg = t > 0.5 ? p.dest : st;
                if (this.walkToExact(tg.x, tg.z)) return true;
            }
            this.warm(); return true;
        }
        if (st && !npcLand && (me.x !== st.x || me.z !== st.z)) {
            if (this.tickCount - this.mlStandMoveTick >= 4 && this.walkToExact(st.x, st.z)) return true;
            this.warm(); return true;
        }
        // TRAVEL NETWORK 'oploc' (a dialog behind the op: spirit tree pages, the lever warning): re-op only every 40 ticks, like a
        // dialog chain, so a re-sent OPLOC never lands while the script still runs and restarts the conversation.
        if (this.tickCount - this.lastMlOplocTick >= (p.action?.kind === 'npc' ? 12 : p.action?.kind === 'oploc' ? 40 : 8)) { this.mlOperatePortal(p, p.locId ?? 0); this.lastMlOplocTick = this.tickCount; }
        else this.warm();
        return true;
    }
    // NAV PHASE 2: the active transport's dialog choices (npc `choose`), consulted before dialogPolicy while it runs.
    private mlTransportDialog(): Array<{ match: RegExp; label?: string }> {
        if (!this.mlClimbing || !this.mlPlan) return [];
        const a = this.mlPlan[this.mlLegIdx]?.portal?.action;
        return (a?.kind === 'npc' || a?.kind === 'chain' || a?.kind === 'oploc') && a.choose ? a.choose.map(c => ({ match: new RegExp(c, 'i'), label: 'transport' })) : [];
    }
    // TRAVEL NETWORK: the active transport's interface pick (gnome glider: npc dialog -> if_openmain(glidermap) -> IF_BUTTON on the
    // destination, gnome_glider.rs2:1-5,125). brain() asks this BEFORE the generic modal dismiss: true = this tick is ours. Inactive
    // (false) unless the running leg's npc action carries ifModal + ifButton and exactly that modal is open, so every other bot and
    // every other modal is untouched. Click once, re-click every 8 ticks while it stays open, give the modal back after 24.
    private mlIfClick = { modal: -1, tick: -1, first: -1 };
    private mlTransportModal(): boolean {
        if (!this.mlClimbing || !this.mlPlan || this.mainModalId === -1) return false;
        const a = this.mlPlan[this.mlLegIdx]?.portal?.action;
        if (a?.kind !== 'npc' || a.ifModal === undefined || a.ifButton === undefined || this.mainModalId !== a.ifModal) return false;
        if (this.mlIfClick.modal !== this.mainModalId || this.tickCount - this.mlIfClick.tick > 40) this.mlIfClick = { modal: this.mainModalId, tick: -1, first: this.tickCount };
        if (this.tickCount - this.mlIfClick.first > 24) return false;   // stuck: let the dismiss close it; the npc op loop retries
        if (this.mlIfClick.tick < 0 || this.tickCount - this.mlIfClick.tick >= 8) {
            this.ifButton(a.ifButton);
            this.mlIfClick.tick = this.tickCount;
            console.log(`[fb] ${this.loginUser}: transport ${this.mlPlan[this.mlLegIdx]?.portal?.id ?? '?'}: IF_BUTTON ${a.ifButton} on modal ${a.ifModal}`);
        } else this.warm();
        return true;
    }
    private mlWornSlash(): boolean {
        const w = this.invs.get(WORN_INTERFACE);
        if (!w) return false;
        LeanBot.slashIds ??= (() => { try { return new Set<number>(JSON.parse(readFileSync(new URL('../../../sdk/navgrid/obj-tables.json', import.meta.url), 'utf8')).slash); } catch { return new Set<number>(); } })();
        for (let i = 0; i < w.ids.length; i++) if (w.ids[i]! > 0 && LeanBot.slashIds.has(w.ids[i]!)) return true;
        return false;
    }
    private static slashIds: Set<number> | null = null;
    // TRANSPORT CAPABILITY (NAV PHASE 1): null = off (the old plan call). Read on EVERY plan (hot swap).
    private mlTransportCaps(): MlTransportCaps | null {
        if (!(this.mlTransports ?? (process.env.FB_TRANSPORTS === '1'))) return null;
        const items: number[] = []; let coins = 0;
        const pack = this.invForInventory();
        if (pack) for (let i = 0; i < pack.ids.length; i++) if (pack.ids[i]! > 0) { items.push(pack.ids[i]!); if (pack.ids[i] === 995) coins += pack.counts[i]!; }
        const w = this.invs.get(WORN_INTERFACE);
        const worn: number[] = [];
        if (w) for (let i = 0; i < w.ids.length; i++) if (w.ids[i]! > 0) { items.push(w.ids[i]!); worn.push(w.ids[i]!); }
        const quests = this.mlTransportOpts.quests ?? QUESTS.filter(q => this.isQuestComplete(q.key) === true).map(q => q.key);
        // started = journal yellow or green (NOT_OBSERVABLE, e.g. a journalAmbiguous row, never counts)
        const questsStarted = this.mlTransportOpts.questsStarted ?? QUESTS.filter(q => { const s = this.questState(q.key).status; return s === 'IN_PROGRESS' || s === 'COMPLETE'; }).map(q => q.key);
        return {
            ...this.mlTransportOpts, items, coins, worn, quests, questsStarted,
            stats: { agility: this.statLevel[16] ?? 0, woodcutting: this.statLevel[8] ?? 0, ...(this.mlTransportOpts.stats ?? {}) },
            hasAxe: this.mlTransportOpts.hasAxe ?? items.some(o => ML_AXES.includes(o)),
        };
    }

    // TELEPORT CAPABILITY for the planner: null = teleports off (the 2-arg plan call, unchanged plans).
    // Read on EVERY plan (hot swap): mlTeleports true/false, else env FB_TELEPORTS=1.
    private mlTeleportCaps(): MlTeleportCaps | null {
        const on = this.mlTeleports ?? (process.env.FB_TELEPORTS === '1');
        if (!on) return null;
        const inv: Record<number, number> = {};
        const pack = this.invForInventory();
        if (pack) for (let i = 0; i < pack.ids.length; i++) if (pack.ids[i]! > 0) inv[pack.ids[i]!] = (inv[pack.ids[i]!] ?? 0) + pack.counts[i]!;
        const worn: number[] = [];
        const w = this.invs.get(WORN_INTERFACE);
        if (w) for (let i = 0; i < w.ids.length; i++) if (w.ids[i]! > 0) worn.push(w.ids[i]!);
        return {
            ...this.mlTeleportOpts,
            magicLevel: this.statLevel[6] ?? 0, inv, worn, quests: this.mlTeleportQuests,
            deny: [...this.mlTeleDropped, ...(this.mlTeleportOpts.deny ?? [])],
        };
    }
    private mlTeleDrop(t: MlTeleport, why: string): boolean {
        this.mlTeleDropped.add(t.id);
        console.log(`[fb] ${this.loginUser}: TELEPORT ${t.id} DROPPED for this session (${why}) -> re-planning without it`);
        this.mlTele = null; this.mlPlan = null; this.mlLegIdx = 0;   // mlGoal kept: the next tick re-plans
        return true;
    }
    // One tick of a TELEPORT leg. Always returns true until it lands (then false: the next leg walks), so
    // doTravel never walks/arrives mid-cast. Spell = IF_BUTTON spellCom (teleport.rs2:1-7); item = OPHELD4
    // "Rub" from the pack + click the p_choice option (amulet_of_glory.rs2 / ring_of_dueling.rs2 /
    // necklace_of_minigames.rs2). Landing = a position jump onto dest's plane within scatter(+2) of dest.
    // Refusal message -> drop the teleport for the session and re-plan; no landing after 3 casts -> same.
    private mlTeleportStep(t: MlTeleport, me: { x: number; z: number }): boolean {
        const d = t.dest;
        let st = this.mlTele;
        if (!st) st = this.mlTele = { startTick: this.tickCount, castTick: -1, casts: 0, rubTick: -1, chose: false, from: { x: me.x, z: me.z, level: this.minusedlevel } };
        const moved = me.x !== st.from.x || me.z !== st.from.z || this.minusedlevel !== st.from.level;
        if (st.casts > 0 && moved && this.minusedlevel === d.level && Math.max(Math.abs(me.x - d.x), Math.abs(me.z - d.z)) <= t.scatter + 2) {
            console.log(`[fb] ${this.loginUser}: TELEPORTED (${t.id}) to (${d.level},${me.x},${me.z}) after ${this.tickCount - st.startTick} ticks -> leg ${this.mlLegIdx + 1}`);
            this.mlTele = null; this.mlLegIdx++; this.mlLegLevel = d.level;
            if (this.mlLegIdx >= this.mlPlan!.length) { this.mlGoal = null; this.mlPlan = null; return false; }
            this.setMlLeg(this.mlLegIdx);
            return false;
        }
        if (st.castTick >= 0) {
            const refusal = ML_TELE_REFUSALS.find(n => this.sawMsg(st!.castTick, n));
            if (refusal) return this.mlTeleDrop(t, `server: "${refusal}"`);
        }
        // item: the rub opened the p_choice dialog -> pick the destination (option ORDER is content; match text)
        if (t.kind === 'item' && st.rubTick >= 0 && !st.chose && t.choice) {
            const esc = t.choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (this.clickDialogByText(new RegExp(esc, 'i')) > 0) { st.chose = true; st.castTick = this.tickCount; return true; }
        }
        if (st.casts === 0 || this.tickCount - st.castTick >= 10) {
            if (st.casts >= 3) return this.mlTeleDrop(t, `no landing after ${st.casts} casts`);
            if (this.mainModalId !== -1) { this.sendCloseModal(); return true; }   // a modal hides the tabs/backpack
            if (t.kind === 'spell') {
                if (t.spellCom === undefined) return this.mlTeleDrop(t, 'no spell component');
                this.ifButton(t.spellCom);
            } else {
                const obj = (t.items ?? []).find(o => this.invSlotOf(o) >= 0);
                if (obj === undefined) return this.mlTeleDrop(t, 'no charged item in the pack');
                // TRAVEL NETWORK: itemOp (the enchanted lyre plays with OPHELD1); default the OPHELD4 "Rub" every older item uses
                const heldOp = [0, ClientProt.OPHELD1, ClientProt.OPHELD2, ClientProt.OPHELD3, ClientProt.OPHELD4, ClientProt.OPHELD5][t.itemOp ?? 4] ?? ClientProt.OPHELD4;
                this.out.p1Enc(heldOp /* obj, slot, com */); this.out.p2(obj); this.out.p2(this.invSlotOf(obj)); this.out.p2(INV_INTERFACE);
                st.rubTick = this.tickCount; st.chose = false;
            }
            st.castTick = this.tickCount; st.casts++;
            console.log(`[fb] ${this.loginUser}: TELEPORT cast #${st.casts} ${t.id} from (${this.minusedlevel},${me.x},${me.z}) -> (${d.level},${d.x},${d.z})`);
            return true;
        }
        this.warm();
        return true;
    }

    // ---- ROUTE FEASIBILITY -------------------------------------------------------------------------
    // The last route-gate verdict, populated at every travel commit from the planned route and the
    // account-state. `null` means NO TRIP IS IN FLIGHT — which is a different claim from "the trip is
    // fine", and the reporter renders the two differently.
    lastRouteGate: GateResult | null = null;
    /**
     * ⛔ NARROW THIS PER ROUTE WHERE YOU CAN. Left undefined, `questProfilePart` must pin EVERY gating
     * varp in the world before it will publish a quest map — and 10 of the 43 reach neither the varp
     * nor the journal channel, so the map is never published and every quest gate reads UNKNOWN. A
     * brain that knows its route only crosses, say, the Al Kharid toll sets `['princequest']` and gets
     * a definite answer.
     */
    routeGateQuestVarps: readonly string[] | undefined = undefined;
    /** Set true to refuse departure on a BLOCKED verdict instead of merely reporting it. Off by default:
     *  a brain that cannot re-target is better off walking as far as it can WITH the alarm raised than
     *  standing still with it. Every consumer of `lastRouteGate` sees the same verdict either way. */
    routeGateRefuse = false;

    /**
     * Classify a route the brain has just committed to. Never throws; never re-plans; memoised.
     * Returns the verdict (also stored on `lastRouteGate`).
     */
    protected gateTravelRoute(tiles: { x: number; z: number }[]): GateResult {
        const g = gateRoute(tiles, profileFromBot(this, { requiredVarps: this.routeGateQuestVarps }), { level: this.travelLevel });
        this.lastRouteGate = g;
        // ⛔ SAY IT AT DEPARTURE, EVERY TIME, FOR EVERY NON-PASSABLE VERDICT. `verdict.note` already
        // names the loc, the tile, the content file:line and the shopping list — it is one greppable
        // line, and without it a blocked route is invisible. A PASSABLE verdict says nothing: a bot plans
        // many routes, and a log that shouts on success is a log nobody reads.
        if (!g.ok && !g.cached) {
            console.error(`[fb] ${this.loginUser}: ROUTE ${g.verdict} -> (${this.travelDest.x},${this.travelDest.z}): ${g.note}`);
        }
        return g;
    }

    // =================================================================================================
    // TRAVEL WEDGE WATCHDOG + STRATUM ESCAPE — see the module header block for the three live shapes
    // =================================================================================================

    travelWedgeInfo(): { noProgressTicks: number; rung: number; escapeTries: number; escapeTarget: ClimbExit | null } {
        return {
            noProgressTicks: this.#twSince < 0 ? 0 : this.tickCount - this.#twSince,
            rung: this.#twSteps,
            escapeTries: this.#seTries,
            escapeTarget: this.#seTarget,
        };
    }

    /**
     * TEST SEAM: climbable UP transitions near the bot, nearest first, ALREADY vetted for
     * reachability. `null` (the default) reads the process-global loc scene and vets each candidate
     * with the rsmod pathfinder — which is the ONLY planner that has data off the navgrid window.
     */
    climbExitsFn: ((me: { x: number; z: number }, level: number, radius: number) => ClimbExit[]) | null = null;

    /** Every climb-UP loc within `radius`, nearest first. Empty when the loc scene is not built. */
    protected climbExits(radius: number): ClimbExit[] {
        const me = this.playerTile();
        if (this.climbExitsFn) return this.climbExitsFn(me, this.minusedlevel, radius);
        let locs: locScene.SceneLoc[];
        try {
            if (!locScene.isReady()) return [];
            locs = locScene.getNearbyLocs(me.x, me.z, this.minusedlevel, radius);
        } catch { return []; }
        const out: ClimbExit[] = [];
        // The essence mine and every runecrafting altar are INSTANCED REGIONS at z >= 4000 on level 0 whose only
        // way out is a "Portal" (op "Use") — not a ladder. Bots that started inside one (runecrafters in
        // the essence mine, a combat trainee in the air altar) sat in a SEALED POCKET
        // forever. Portals are offered ONLY from z >= 4000, so overworld travel can never wander into one.
        const inInterior = me.z >= 4000;
        for (const l of locs) {
            let op = l.optionsWithIndex.find(o => { CLIMB_UP_OP.lastIndex = 0; return CLIMB_UP_OP.test(o.text.trim()); });
            if (!op && inInterior && /portal/i.test(l.name)) op = l.optionsWithIndex.find(o => /^(use|enter|exit)$/i.test(o.text.trim()));
            if (!op) continue;
            out.push({ x: l.x, z: l.z, locId: l.id, op: op.opIndex, name: l.name, dist: l.distance });
        }
        out.sort((a, b) => a.dist - b.dist);
        return out;
    }

    /**
     * The nearest climb-up exit we can ACTUALLY WALK TO from here, or null.
     *
     * ⛔ A RESCUE TILE MUST BE REACHABLE **FROM HERE** (restated here for
     * ladders): from inside a pocket every exit on the map looks fine, and one that only exists on the
     * far side of a wall burns the whole escape budget. So each candidate is probed with the rsmod
     * pathfinder — the one planner with data below navgrid's window — and accepted only if the route
     * ENDS on or beside the loc. Bounded by STRATUM_PROBE_MAX because that probe is a real search.
     *
     * The `climbExitsFn` seam is trusted without a probe: an injector that supplies candidates is
     * asserting they are reachable, which is what makes this testable without an 18s map load.
     */
    private pickClimbExit(): ClimbExit | null {
        const me = this.playerTile();
        const injected = this.climbExitsFn !== null;
        for (const radius of STRATUM_SEARCH_RADII) {
            let probed = 0;
            for (const c of this.climbExits(radius)) {
                if (this.#seBlacklist.has(`${c.x},${c.z},${c.locId}`)) continue;
                if (Math.max(Math.abs(c.x - me.x), Math.abs(c.z - me.z)) <= 1) return c;   // standing at it
                if (injected) return c;
                if (probed++ >= STRATUM_PROBE_MAX) break;
                try {
                    const p = rawFindLongPath(this.travelLevel, me.x, me.z, c.x, c.z);
                    const end = p[p.length - 1];
                    if (end && Math.max(Math.abs(end.x - c.x), Math.abs(end.z - c.z)) <= 1) return c;
                } catch { /* an unroutable candidate is simply not our exit */ }
            }
        }
        return null;
    }

    /**
     * ⭐ CLIMB OUT. The bounded cross-stratum escape: walk to the nearest reachable climb-up loc,
     * OPLOC it, and re-route from the surface. Returns true when it CLAIMED the tick.
     *
     * ⛔ BEING ON THE WRONG STRATUM IS NOT A POCKET AND IT IS NOT A ROUTE FAILURE. `findLongPathFn` is
     * the SURFACE navgrid; above z5631 it answers EMPTY for every tile in the world, so "0-corner /
     * 0-tile route" underground says nothing about walls — the exit is a LADDER, which no single-level
     * planner can express. Re-planning it, at any rate, forever, is the wedge (live shapes 2 and 3).
     *
     * ⛔ AND IT IS BOUNDED IN BOTH DIRECTIONS. Every exit gets STRATUM_CLIMB_TICKS to actually land us
     * on the surface; one that does not is blacklisted and the next is tried; after
     * STRATUM_ESCAPE_MAX_TRIES the bot goes QUIET (one line per 1,500 ticks) and hands the tick back —
     * , the two live pairs at (3236,9857)/(2655,9714) sit in collision pockets from
     * which `findPathToLoc` dead-ends for EVERY target including the nearest ladder, and for those the
     * honest output is a diagnosis a supervisor can act on, not another plan.
     */
    protected stratumEscape(): boolean {
        const me = this.playerTile();
        if (me.z <= UNDERGROUND_Z) {
            // Surfaced (or never below): retire the escape and VOID the route planned from down there.
            if (this.#seTarget !== null || this.#seTries > 0) {
                console.log(`[fb] ${this.loginUser}: STRATUM ESCAPE COMPLETE — surfaced at (${me.x},${me.z}) ` +
                    `after ${this.#seTries} blacklisted exit(s); re-routing to (${this.travelDest.x},${this.travelDest.z})`);
                this.#seTarget = null; this.#seTries = 0; this.#seBlacklist.clear(); this.#seNoExitTick = -1e9;
                this.travelPath = null; this.travelIdx = 0; this.lastTravelMoveTick = -100;
                this.#twKey = ''; this.#twSince = this.tickCount; this.#twSteps = 0;
            }
            return false;
        }
        // Exhausted: say it rarely and LOUDLY, then hand the tick back. Never spin.
        if (this.#seTries >= STRATUM_ESCAPE_MAX_TRIES) {
            if (this.tickCount - this.#seLogTick >= 1500) {
                this.#seLogTick = this.tickCount;
                console.error(`[fb] ${this.loginUser}: ⛔ SEALED POCKET at (${me.x},${me.z}) — ${this.#seTries} climb-out ` +
                    `attempt(s) and no reachable up-transition. The exit is a ladder and none can be walked to from ` +
                    `this tile; the account needs external extraction, not another plan.`);
            }
            return false;
        }
        // A recent scan found nothing. Re-ask on a cooldown, never per tick (each scan is real
        // pathfinder searches) and never NEVER (see STRATUM_RESCAN_TICKS: a latch is the pocketStuck bug).
        if (this.#seTarget === null && this.tickCount - this.#seNoExitTick < STRATUM_RESCAN_TICKS) {
            this.warm();
            return true;   // claim the tick: there is nothing for the surface planner to do down here
        }
        // Acquire, or re-acquire after a timeout.
        if (this.#seTarget === null || this.tickCount - this.#seStartTick > STRATUM_CLIMB_TICKS) {
            if (this.#seTarget !== null) {
                const old = this.#seTarget;
                this.#seBlacklist.add(`${old.x},${old.z},${old.locId}`);
                this.#seTries++;
                console.log(`[fb] ${this.loginUser}: climb-out via "${old.name}" loc ${old.locId} @(${old.x},${old.z}) ` +
                    `did not surface us in ${STRATUM_CLIMB_TICKS}t — blacklisted (attempt ${this.#seTries}/${STRATUM_ESCAPE_MAX_TRIES})`);
                this.#seTarget = null;
                if (this.#seTries >= STRATUM_ESCAPE_MAX_TRIES) return false;
            }
            const next = this.pickClimbExit();
            if (!next) {
                this.#seNoExitTick = this.tickCount;
                if (this.tickCount - this.#seLogTick >= 1500) {
                    this.#seLogTick = this.tickCount;
                    console.error(`[fb] ${this.loginUser}: ⛔ SEALED POCKET at (${me.x},${me.z}) — no climb-up loc within ` +
                        `${STRATUM_SEARCH_RADII[STRATUM_SEARCH_RADII.length - 1]} tiles is REACHABLE from this tile` +
                        `${this.climbExitsFn === null && !locScene.isReady() ? ' (and the loc scene is NOT built — call locScene.init() at startup)' : ''}. ` +
                        `Re-asking every ${STRATUM_RESCAN_TICKS} ticks; if this line keeps coming the account needs external extraction.`);
                }
                this.warm();
                return true;   // claim the tick: the surface planner has no answer from down here either
            }
            this.#seTarget = next; this.#seStartTick = this.tickCount; this.#seOpTick = -1e9;
            console.log(`[fb] ${this.loginUser}: ⛔ OFF-SURFACE at (${me.x},${me.z}) with a SURFACE destination ` +
                `(${this.travelDest.x},${this.travelDest.z}) — navgrid has no data above z${UNDERGROUND_Z}, so the exit is a ` +
                `LADDER, not a re-plan. Climbing "${next.name}" loc ${next.locId} @(${next.x},${next.z}) d=${next.dist}.`);
        }
        const t = this.#seTarget!;
        // Walk onto/beside it first — the loc footprint itself is blocked, and walkToExact falls back to
        // the rsmod pathfinder, which is the only planner with data down here.
        if (Math.max(Math.abs(me.x - t.x), Math.abs(me.z - t.z)) > 1 && this.walkToExact(t.x, t.z)) return true;
        // Then OPLOC on the proven portalHop cadence: one send self-routes us toward the loc but can stop
        // short of interaction range; repeats close the gap and fire the climb once adjacent.
        if (this.tickCount - this.#seOpTick >= 8) { this.opLoc(t.x, t.z, t.locId, t.op); this.#seOpTick = this.tickCount; }
        else this.warm();
        return true;
    }

    /**
     * ONE RUNG PER CALL of the unwedge ladder. Returns true when it claimed the tick.
     *
     * ⛔ THE LADDER IS ITSELF BOUNDED. Rung 5 does not escalate again — it says so once per 600 ticks
     * and resets to rung 1, so the worst case is one re-plan per (5 x TRAVEL_UNWEDGE_COOLDOWN) ticks
     * plus one line per 600. An escalation ladder with no top is just a slower spin.
     */
    private travelUnwedge(me: { x: number; z: number }, wedged: number): boolean {
        const step = ++this.#twSteps;
        const say = (what: string): void => console.error(`[fb] ${this.loginUser}: ⛔ TRAVEL WEDGED at ` +
            `(${me.x},${me.z})->(${this.travelDest.x},${this.travelDest.z}) — ${wedged}t with NO tile and NO waypoint ` +
            `progress (idx=${this.travelIdx}/${this.travelPath?.length ?? 0}); rung ${step}: ${what}`);
        switch (step) {
            case 1:
                // RE-PATH from this tile. Falls through to the walker in the same tick (the lazy compute
                // below sees travelPath === null), so the log line CHANGES — which is the point: a bot
                // must never repeat the identical TRAVELING line forever.
                say('re-planning from this tile');
                this.travelPath = null; this.travelIdx = 0; this.lastTravelMoveTick = -100;
                this.#twReplanTick = this.tickCount;
                return false;
            case 2: {
                // A CLOSED DOOR/GATE the pathfinder routes THROUGH but the server will not let us walk.
                // ⭐ FIRST the route's own next door EDGE (wedgeDoor): operated blind with its CLOSED id
                // whatever the tracker believes, and masked out of the re-plan once it has refused
                // TRAVEL_WEDGE_DOOR_TRIES times. Only when the route crosses no known door does the
                // radius opener get the rung.
                const wd = this.wedgeDoor(me);
                if (wd !== null) { say(wd.what); return wd.claimed; }
                if (this.tryOpenDoor(me.x, me.z, 4)) { say('opening a door/gate on the path ahead'); return true; }
                return false;
            }
            case 3:
                // OFF-SURFACE with a SURFACE destination: no re-plan can express a ladder. A belt-and-
                // braces retry of the gate at the top of doTravel, and gated IDENTICALLY to it on
                // purpose — a bot wedged underground on its way to a DUNGEON camp must never be climbed out of the dungeon it is trying to cross. Skipped
                // while mlDrive owns a climb, for the same reason the gate is.
                if (me.z > UNDERGROUND_Z && this.travelDest.z <= UNDERGROUND_Z && this.mlGoal === null) {
                    say('off-surface — climbing out before re-routing');
                    if (this.stratumEscape()) return true;
                }
                return false;
            case 4: {
                // SIDESTEP. Two tiles off the path, cycling directions, then a fresh plan from wherever
                // that lands us — the cheap answer to a live-only blocker (a parked npc, a door that
                // will not open) that every re-plan from the SAME tile reproduces exactly.
                const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;
                const d = dirs[this.#twSideIdx++ % dirs.length]!;
                say(`sidestepping to (${me.x + d[0] * 2},${me.z + d[1] * 2}) and re-planning from there`);
                this.sendMove(me.x + d[0] * 2, me.z + d[1] * 2, true);
                this.travelPath = null; this.travelIdx = 0; this.lastTravelMoveTick = -100;
                this.#twReplanTick = this.tickCount;
                return true;
            }
            default:
                if (this.tickCount - this.#twLogTick >= 600) {
                    this.#twLogTick = this.tickCount;
                    console.error(`[fb] ${this.loginUser}: ⛔ TRAVEL STILL WEDGED at (${me.x},${me.z})->` +
                        `(${this.travelDest.x},${this.travelDest.z}) after the full unwedge ladder (${wedged}t, ` +
                        `verdict=${this.lastRouteGate?.verdict ?? 'none'}). Cycling the ladder; this account may need extraction.`);
                }
                this.#twSteps = 0;   // bounded: start again from rung 1, never a per-tick escalation
                return false;
        }
    }

    /**
     * The first known door EDGE the current route crosses, from our own tile through
     * TRAVEL_WEDGE_DOOR_LOOKAHEAD path tiles ahead of the cursor. Edge-exact (stepCrossesDoorEdge), so a
     * door whose closed edge is on the side of the tile we STAND on is found — the walker cursor has
     * already skipped our own tile, which is why the tile-based openers never looked at it.
     */
    private routeDoorAhead(me: { x: number; z: number }): DoorInfo | null {
        return doorEdgeOnPath(this.travelLevel, me, this.travelPath, this.travelIdx, TRAVEL_WEDGE_DOOR_LOOKAHEAD);
    }

    // WALK-DOOR (, live: the Lumbridge chicken pen gate (3236,3296) is SHUT in game but passable to the planner, so
    // the chicken lane's three hunters stood at (3237,3296) for 50 min with 0 kills). Brains that walk with walkToExact / raw
    // MOVEs (talisman-hunter's hunt walk) never reach doTravel's wedge rung; this is that rung for them. The caller says "I am
    // stuck walking toward dest"; the raw planner's route from our tile is scanned for a door-table door EDGE (TRAVEL_DOORS:
    // never a scripted obstacle like the toll gate) and, if it is operable from OUR tile (reachedLoc), its CLOSED variant is
    // OPLOCed blind like wedgeDoor (an already-open door is an id miss the server discards, so this never closes one).
    // Bounded: at most WALK_DOOR_TRIES per door per WALK_DOOR_WINDOW ticks, >= WALK_DOOR_SPACING apart. Returns what it did.
    #wdTries = new Map<string, { n: number; first: number; last: number }>();
    protected openDoorOnWalk(dest: { x: number; z: number }): string | null {
        const me = this.playerTile();
        let route: Array<{ x: number; z: number }> = [];
        try { route = rawFindLongPath(this.travelLevel, me.x, me.z, dest.x, dest.z).map(w => ({ x: w.x, z: w.z })); } catch { return null; }
        if (!route.length) return null;
        const d = doorEdgeOnPath(this.travelLevel, me, densifyCorners([{ x: me.x, z: me.z }, ...route]), 1, TRAVEL_WEDGE_DOOR_LOOKAHEAD);
        if (!d) return null;
        const td = travelDoorAt(d.level, d.x, d.z);
        if (!td) return null;   // not an openable travel door (scripted obstacles are never blind-opened)
        if (!reachedLoc(d.level, me.x, me.z, d.x, d.z, 1, 1, d.angle, d.shape)) return null;
        const key = `${d.level},${d.x},${d.z}`;
        let t = this.#wdTries.get(key);
        if (!t || this.tickCount - t.first > WALK_DOOR_WINDOW) { t = { n: 0, first: this.tickCount, last: -1e9 }; this.#wdTries.set(key, t); }
        if (t.n >= WALK_DOOR_TRIES || this.tickCount - t.last < WALK_DOOR_SPACING) return null;
        t.n++; t.last = this.tickCount;
        this.travelDoorTried.set(`${td.x},${td.z}`, this.tickCount);
        const lv = this.doorTracker?.closedDoorAt(d.level, td.x, td.z);   // PHASE 1b: live closed id first (see wedgeDoor)
        this.opLoc(td.x, td.z, lv?.locId ?? td.locId, lv?.op ?? td.op);
        return `walk to (${dest.x},${dest.z}) blocked at (${me.x},${me.z}) by "${td.name}" loc ${td.locId} @(${td.x},${td.z}) - blind OPLOC${td.op} (try ${t.n}/${WALK_DOOR_TRIES})`;
    }

    /**
     * WEDGE-DOOR rung. null = the route crosses no known travel door (the caller falls back). Otherwise:
     *  - fewer than TRAVEL_WEDGE_DOOR_TRIES tries on this edge: blind OPLOC its CLOSED variant (door-table
     *    id/op). The tracker's "open" is deliberately NOT trusted here: we are wedged against it, and it
     *    can be stale (a door that reverted while we were off its plane). An OPEN door is an id miss the
     *    server discards, so this can never close a door.
     *  - after that: MASK the edge for TRAVEL_DOOR_MASK_TICKS and void the route, so the lazy re-plan
     *    (planTravel) routes another way instead of re-deriving the identical route through it.
     */
    private wedgeDoor(me: { x: number; z: number }): { claimed: boolean; what: string } | null {
        const d = this.routeDoorAhead(me);
        if (!d) return null;
        const td = travelDoorAt(d.level, d.x, d.z);
        if (!td) return null;   // not an openable travel door (scripted obstacles are never blind-opened)
        // OPLOC does not self-route (opLoc): from a tile the engine cannot operate it from, the op is
        // refused — so this rung only acts when we stand on an operable tile of that door (the wedge at
        // the door itself). Anything else keeps the pre-existing behaviour.
        if (!reachedLoc(d.level, me.x, me.z, d.x, d.z, 1, 1, d.angle, d.shape)) return null;
        const key = `${d.level},${d.x},${d.z}`;
        const prevTry = this.#twDoorTries.get(key);
        const n = prevTry && this.tickCount - prevTry.tick <= TRAVEL_DOOR_MASK_TICKS ? prevTry.n : 0;
        if (n < TRAVEL_WEDGE_DOOR_TRIES) {
            this.#twDoorTries.set(key, { n: n + 1, tick: this.tickCount });
            this.travelDoorTried.set(`${td.x},${td.z}`, this.tickCount);
            // PHASE 1b: the tracker's LIVE closed id beats the static table id. A gate opened and closed
            // again is its next_loc_stage variant (Paterdomus 1598/1599 -> loc_1551/loc_1553, gates.loc) and the static id is
            // an id miss the server drops (sims p1m9/p1d7: 2 x 2 blind ops did nothing). Only a CLOSED tracker entry is used.
            const lv = this.doorTracker?.closedDoorAt(d.level, td.x, td.z);
            if (lv && lv.locId !== td.locId) { this.opLoc(td.x, td.z, lv.locId, lv.op); this.travelSuppressMoveUntil = this.tickCount + 6;
                return { claimed: true, what: `the route crosses "${td.name}" @(${td.x},${td.z}) — OPLOC${lv.op} of its LIVE closed loc ${lv.locId} (table ${td.locId}; try ${n + 1}/${TRAVEL_WEDGE_DOOR_TRIES})` }; }
            this.opLoc(td.x, td.z, td.locId, td.op);
            this.travelSuppressMoveUntil = this.tickCount + 6;   // a MOVE would cancel the pending open
            return { claimed: true, what: `the route crosses "${td.name}" loc ${td.locId} @(${td.x},${td.z}) — blind OPLOC${td.op} ` +
                `(try ${n + 1}/${TRAVEL_WEDGE_DOOR_TRIES}, tracker says ${this.doorTracker?.isOpen(d.level, d.x, d.z) ?? 'unknown'})` };
        }
        this.#twDoorTries.delete(key);
        this.#twMaskedDoors.set(key, { door: d, until: this.tickCount + TRAVEL_DOOR_MASK_TICKS });
        this.travelPath = null; this.travelIdx = 0; this.lastTravelMoveTick = -100;
        this.#twReplanTick = this.tickCount;
        return { claimed: false, what: `"${td.name}" @(${td.x},${td.z}) did not open after ${n} tries — re-planning with that ` +
            `door edge MASKED for ${TRAVEL_DOOR_MASK_TICKS}t` };
    }

    /** Door edges currently masked out of travel planning (expired ones dropped). */
    private activeMaskedDoors(): DoorInfo[] {
        if (this.#twMaskedDoors.size === 0) return [];
        const out: DoorInfo[] = [];
        for (const [k, m] of this.#twMaskedDoors) {
            if (m.until <= this.tickCount) this.#twMaskedDoors.delete(k);
            else if (m.door.level === this.travelLevel) out.push(m.door);
        }
        return out;
    }

    /**
     * The travel planner. Identical to `findLongPathFn` unless a wedge has masked a door edge: then the
     * exact rsmod planner runs with those edges walled (findLongPath's per-query blockedDoors — restored
     * before it returns), falling back to the injected planner if that finds nothing.
     */
    private planTravel(level: number, sx: number, sz: number, dx: number, dz: number): Array<{ x: number; z: number }> {
        const masked = this.activeMaskedDoors();
        if (masked.length) {
            try {
                const r = guardRaw(rawFindLongPath(level, sx, sz, dx, dz, 500, masked).map(w => ({ x: w.x, z: w.z })), level, sx, sz, dx, dz, `[fb] ${this.loginUser} masked-door`);
                if (r.length) return r;
            } catch { /* fall back to the injected planner */ }
        }
        return this.findLongPathFn ? this.findLongPathFn(level, sx, sz, dx, dz) : [];
    }

    private doTravel(): void {
        const me = this.playerTile();
        // Multi-level leg sequencing (no-op when mlGoal is null). Handles portals + stratum changes.
        if (this.mlGoal && this.mlDrive()) return;
        // Cross-stratum leg: legacy manual portal (no-op for every bot with no portals configured).
        if (this.portals.length && this.portalHop(this.travelDest.x, this.travelDest.z)) return;
        // A silently-wedged traveler is invisible (three found live, each costing a run) — say where
        // we are, where we're going, and whether we even have a path, once per 100 ticks.
        if (this.tickCount % 100 === 0) {
            console.log(`[fb] ${this.loginUser}: TRAVELING (${me.x},${me.z})->(${this.travelDest.x},${this.travelDest.z}) path=${this.travelPath ? `${this.travelPath.length}wp idx=${this.travelIdx}` : 'NONE'}`);
        }
        const distToDest = Math.max(Math.abs(me.x - this.travelDest.x), Math.abs(me.z - this.travelDest.z));

        // Arrival: within 6 tiles of travelDest. But a
        // mid-plan portal leg is NOT an arrival — mlDrive owns that leg's end (walk-up + OPLOC), and
        // its OPLOC only fires within 4 of the ladder while this dist<=6 gate is looser, so it would
        // otherwise "arrive" 2 tiles early and abandon the climb. Let mlDrive complete portal legs.
        const onMlPortalLeg = this.mlGoal !== null && this.mlPlan !== null && this.mlPlan[this.mlLegIdx]?.portal !== undefined;
        if (distToDest <= 6 && !onMlPortalLeg) {
            this.arrived = true;
            this.arrivedTick = this.tickCount;
            this.mlGoal = null; this.mlPlan = null;   // final leg reached -> clear any multi-level plan
            // Arriving IS completion: retire any climb-out state so the NEXT journey starts clean and
            // does not announce a stale "STRATUM ESCAPE COMPLETE" for a trip that already ended here.
            this.#seTarget = null; this.#seTries = 0; this.#seBlacklist.clear(); this.#seNoExitTick = -1e9;
            const secs = this.travelStartMs > 0 ? ((Date.now() - this.travelStartMs) / 1000).toFixed(1) : '?';
            console.log(`[fb] ${this.loginUser}: ARRIVED at (${me.x},${me.z}) after ${this.tickCount - this.travelStartTick} ticks / ${secs}s ALIVE -> working ${this.mode}`);
            return;
        }

        // ---- WAYPOINT-PROGRESS WATCHDOG ----------------------------------------------------------
        // ⛔ PROGRESS IS `(tile, travelIdx)`, NOT THE TILE ALONE. All three live wedges kept the tile
        // frozen; two of them also kept `travelIdx` pinned at 1 while re-planning busily every tick, so
        // a tile-only watchdog reads "stalled" for a bot the repair branch believes it is helping and a
        // repair-only view reads "working". Both must move, or nothing is happening.
        const progressKey = `${me.x},${me.z}#${this.travelIdx}`;
        if (progressKey !== this.#twKey) { this.#twKey = progressKey; this.#twSince = this.tickCount; this.#twSteps = 0; }
        else if (this.#twSince < 0) this.#twSince = this.tickCount;
        const wedged = this.tickCount - this.#twSince;

        // ⭐ OFF-SURFACE WITH A SURFACE DESTINATION: CLIMB FIRST, PLAN SECOND (live shapes 2 and 3).
        // `findLongPathFn` IS the surface navgrid — above z5631 it returns EMPTY for every tile in the
        // world — so a bot down here has nothing to re-plan and everything to climb. Fires on the FIRST
        // routeless tick (there is nothing to wait for) and on a wedge (shape 3 got a bogus 58-tile
        // route out of the raw planner and walked nowhere). Skipped while mlDrive owns a climb.
        //
        // ⛔ AND IT IS ALSO CALLED FROM THE SURFACE, WHENEVER AN ESCAPE IS IN FLIGHT. The telejump that
        // ENDS the escape puts us back under this gate's own `me.z > UNDERGROUND_Z` test, so a gate that
        // only ran below ground could never see its own success: the escape state would stay armed and
        // the route planned from the dungeon would stay on the books. `stratumEscape` retires itself
        // (and voids that route) on the surface, so it must get the tick to do it.
        if (this.#seTarget !== null && me.z <= UNDERGROUND_Z) {
            this.stratumEscape();   // retire the escape + void the underground route; never claims a tick
        } else if (me.z > UNDERGROUND_Z && this.travelDest.z <= UNDERGROUND_Z && this.mlGoal === null) {
            const routeless = !this.travelPath || this.travelPath.length === 0;
            if ((routeless || wedged >= TRAVEL_WEDGE_TICKS) && this.stratumEscape()) return;
            // ⛔ AND WHEN THE ESCAPE IS SPENT, THE PLANNER MUST NOT SPIN IN ITS PLACE. Off-surface,
            // `stratumEscape` returns false only after STRATUM_ESCAPE_MAX_TRIES exits have failed —
            // and the surface planner cannot answer from down here either, so re-asking it EVERY tick
            // is the pre-fix loop: ~570ms of synchronous search inside the packet loop, per bot, per tick
            // (it starves every other bot in the process, including pending logins). One retry in 50 ticks.
            if (routeless && this.tickCount % OFF_SURFACE_RETRY_TICKS !== 0) { this.warm(); return; }
        }
        if (wedged >= TRAVEL_WEDGE_TICKS && this.tickCount - this.#twActTick >= TRAVEL_UNWEDGE_COOLDOWN) {
            this.#twActTick = this.tickCount;
            if (this.travelUnwedge(me, wedged)) return;
        }

        // Lazy path compute (fast: WASM/collision already initialised before run()).
        if (!this.travelPath) {
            if (!this.findLongPathFn) { if (this.tickCount % 5 === 0) this.out.p1Enc(Out.NO_TIMEOUT); return; }
            const raw = this.planTravel(this.travelLevel, me.x, me.z, this.travelDest.x, this.travelDest.z);
            // PREPEND THE CURRENT TILE. findLongPath (the raw rsmod fallback when navgrid can't cover a
            // tile — e.g. INSIDE a building) returns TURNING POINTS that OMIT the start, so raw[0] can be
            // several tiles away; densify only interpolates BETWEEN entries, leaving an unfilled gap from
            // us to raw[0], and the emitted MOVE then leads with a non-adjacent waypoint the naive server
            // drops -> frozen forever (RM live-caught: the Duke down-climb dropped the bot INSIDE the
            // castle at 3205,3209, navgrid missed the interior, and the raw route's first turning point
            // sat 6 tiles south). Prepending us makes densify fill the gap; the skip-me loop below then
            // drops the leading (0,0). No-op for navgrid dense routes (raw[0] is already us/adjacent).
            this.travelPath = this.densify(raw.length ? [{ x: me.x, z: me.z }, ...raw] : raw);
            this.travelIdx = 0;
            this.travelStartTick = this.tickCount;
            this.travelStartMs = Date.now();
            console.log(`[fb] ${this.loginUser}: computed ${raw.length}-corner / ${this.travelPath.length}-tile route (${me.x},${me.z})->(${this.travelDest.x},${this.travelDest.z})`);
            // ---- ROUTE FEASIBILITY GATE ------------------------------------------------------------
            // ⛔ THIS IS THE COMMIT POINT, AND IT IS THE ONLY ONE. The route has just been PLANNED and
            // not a single MOVE has been sent. Classifying here answers the question that a healthy
            // connection count cannot: is every obstacle on this route one THIS bot can get
            // through? navgrid answered "can a path be planned?" — which was YES the whole time, through
            // a toll gate the bots could not pay.
            //
            // ⛔ COST DISCIPLINE. ~1.1ms for a 1000-tile route, memoised on endpoints + a coarse profile
            // fingerprint, and reached exactly as often as the planRoute above it — which the brain is
            // already paying for. NEVER per tick. `gateRoute` cannot throw.
            this.gateTravelRoute(this.travelPath);
            // ⛔ THE ROUTE GATE VOUCHES FOR THE OBSTACLES ON A ROUTE — NEVER FOR WHERE IT ENDS. It is
            // handed TILES and a profile; `travelDest` is not even a parameter, so a route that stops
            // 300 tiles short on the WRONG STRATUM is classified PASSABLE the moment none of its tiles
            // crosses a known gate. That is exactly live shape 3: `TRAVELING (2655,9714)->(2846,3430)
            // path=58wp idx=1  routeVerdict=PASSABLE`, a 58-tile crawl inside a dungeon vouched for as
            // a trip to a beach. So test the ONE thing the gate structurally cannot: does this route
            // even end on the destination's stratum? Narrow on purpose — a same-stratum short route is
            // legitimate (an arrive ladder stops up to 4 short; a 500-waypoint cap truncates a long
            // haul and walking it IS progress), so only the cross-stratum case is refused.
            const rEnd = this.travelPath[this.travelPath.length - 1];
            if (rEnd && (rEnd.z > UNDERGROUND_Z) !== (this.travelDest.z > UNDERGROUND_Z)
                && Math.max(Math.abs(rEnd.x - this.travelDest.x), Math.abs(rEnd.z - this.travelDest.z)) > CROSS_STRATUM_SHORT_TILES) {
                console.error(`[fb] ${this.loginUser}: ⛔ CROSS-STRATUM ROUTE REFUSED — the ${this.travelPath.length}-tile route ` +
                    `from (${me.x},${me.z}) ENDS at (${rEnd.x},${rEnd.z}), on the other side of z${UNDERGROUND_Z} from ` +
                    `(${this.travelDest.x},${this.travelDest.z}). The route gate classifies OBSTACLES, not destinations, so it ` +
                    `vouched for this one; walking it cannot arrive. Dropping it — the exit is a ladder.`);
                this.travelPath = null; this.travelIdx = 0;
                this.warm();
                return;
            }
        }
        const path = this.travelPath;
        if (path.length === 0) { // no route found -> keep the link warm and retry next tick
            if (this.tickCount % 5 === 0) this.out.p1Enc(Out.NO_TIMEOUT);
            this.travelPath = null;
            return;
        }

        // Stall detection: track whether the tile changed since last tick.
        const key = `${me.x},${me.z}`;
        if (key === this.travelPrevTile) this.travelStallTicks++;
        else { this.travelStallTicks = 0; this.travelPrevTile = key; }

        // PROACTIVE (tracker only): a CLOSED door on the immediate path ahead -> open it BEFORE walking
        // into it, so we never wedge on it in the first place. Bounded by authoritative state: the
        // moment the tracker sees it open, tryOpenDoor skips it and we walk through — no thrash, and no
        // risk of closing it (skip-open is enforced in tryOpenDoor). Reactive stall-open still backstops
        // unknown/bespoke doors below.
        if (this.doorTracker && this.travelPath) {
            for (let i = this.travelIdx; i < Math.min(this.travelIdx + 3, this.travelPath.length); i++) {
                const t = this.travelPath[i]!;
                if (this.doorTracker.closedDoorAt(this.travelLevel, t.x, t.z) && Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z)) <= 2) {
                    if (this.tryOpenDoor(me.x, me.z, 3)) return;
                    break;
                }
            }
        }

        // Genuinely stuck. FIRST try to OPEN a closed door/gate on the route — a far
        // travel (Ardougne etc.) crosses real gates the pathfinder routes THROUGH but
        // the server won't let us walk until opened. Only if there's no door to open do
        // we RE-PLAN from the current tile (fresh corners = a short straight leg again).
        // ⛔ AND THE REPAIR HAS A HARD FLOOR BETWEEN FIRINGS. Every branch below zeroes
        // `travelStallTicks`, so a CORRECT caller already reaches this at most once per 6 ticks — but
        // `travelStallTicks` is an ordinary public field and a subclass that re-declares it (or writes
        // `travelPrevTile` from its own watchdog before this comparison runs) makes the counter monotonic and the repair fire EVERY tick. Each firing re-plans (a
        // synchronous ~570ms navgrid search in the packet loop) and sets `lastTravelMoveTick = -100`,
        // which re-sends a MOVE_GAMECLICK — and a MOVE_GAMECLICK REPLACES the server-side route, so the
        // player never takes a step and `idx` sits at 1 forever. This floor makes that impossible
        // regardless of what any subclass does to the counter, and is a no-op for a correct caller.
        if (this.travelStallTicks >= 6 && this.tickCount - this.#twReplanTick >= TRAVEL_REPLAN_MIN_TICKS) {
            this.#twReplanTick = this.tickCount;
            if (this.tryOpenDoor(me.x, me.z, 4)) {
                this.travelStallTicks = 0; // give the open + server self-route a fresh window
            } else if (this.mlGoal && this.mlPlan && this.mlPlan[this.mlLegIdx]) {
                // ML leg stall. FAR from the leg end: re-route from the CURRENT tile with the injected
                // planner — the plan's static path can be blocked by something rsmod can't know (an NPC
                // parked on a corridor tile: the nasty tree); a fresh route from here goes around it.
                // The planner's arrive-laddering degeneracy only bites when the target is within its
                // arrive window, so guard on distance and keep plan-following for the final approach.
                const dEndStall = Math.max(Math.abs(me.x - this.travelDest.x), Math.abs(me.z - this.travelDest.z));
                // Wedged at a PORTAL leg's end: hand the last tiles to the engine's op self-routing via
                // an explicit flag — mlDrive runs at tick-top and NEVER sees travelStallTicks>=6 (this
                // block resets it in the same tick it reaches 6; the old stallTicks-based commit was
                // dead code, live-caught when the quest runner approached the stairs one tile off the
                // angle that had let reachedLoc fire directly).
                // Force-commit needs LOGICAL path progress (walker cursor at the path's end), not mere
                // spatial proximity: a start tile can sit 2 tiles from the leg end THROUGH A WALL (the
                // castle-stairs pocket), and a spatial gate committed the climb before the walk-around
                // ever started — freezing the bot (fidelity-reproduced, then fixed here).
                const atPathEnd = this.travelPath !== null && this.travelIdx >= this.travelPath.length - 4;
                if (dEndStall <= 2 && atPathEnd && this.mlPlan[this.mlLegIdx]!.portal) {
                    this.mlForceCommit = true;
                    this.travelStallTicks = 0;
                } else if (this.findLongPathFn) {
                    // Re-route AROUND live-only blockers at ANY distance: temporarily mask nearby
                    // SCENE-NPC tiles in the collision (rsmod can't know npcs — a parked one defeats
                    // every plain re-route: the nasty tree; a wanderer camped on the pocket exit) so
                    // the fresh path threads around them, then revert. Short-range uses the EXACT
                    // corner-router (rawFindLongPath) — the injected planner's arrive-laddering
                    // degenerates near the target — falling back to plan-refollow if it can't reach.
                    const npcTiles: Array<{ x: number; z: number }> = [];
                    for (let i = 0; i < this.npcCount; i++) {
                        const n = this.npcs[this.npcIndices[i]!];
                        if (!n) continue;
                        const w = this.npcWorld(n);
                        if (Math.max(Math.abs(w.x - me.x), Math.abs(w.z - me.z)) <= 3) npcTiles.push(w);
                    }
                    const fresh = withMaskedTiles(this.travelLevel, npcTiles, () =>
                        dEndStall > 8
                            ? this.planTravel(this.travelLevel, me.x, me.z, this.travelDest.x, this.travelDest.z)
                            : rawFindLongPath(this.travelLevel, me.x, me.z, this.travelDest.x, this.travelDest.z).map(w => ({ x: w.x, z: w.z })));
                    const fEnd = fresh[fresh.length - 1];
                    // Accept a fresh route ONLY if it ends within 1 of the leg end. Tolerance 2 is the
                    // through-wall trap: the injected planner's arrive-laddering returned a path ending
                    // in the castle POCKET (cheb 2 from the leg end, wall between) and the walker
                    // delivered the bot straight back into it (trace-caught). The plan's own waypoints
                    // end interaction-valid, so the fallback is always safe.
                    if (fEnd && Math.max(Math.abs(fEnd.x - this.travelDest.x), Math.abs(fEnd.z - this.travelDest.z)) <= 1) {
                        this.travelPath = this.densify([{ x: me.x, z: me.z }, ...fresh]);
                        this.travelIdx = 0;
                    } else {
                        this.travelPath = this.densify(this.mlPlan[this.mlLegIdx]!.waypoints.map(w => ({ x: w.x, z: w.z })));
                        this.travelIdx = this.nearestPathIdx(this.travelPath);
                    }
                    this.travelStallTicks = 0;
                    this.lastTravelMoveTick = -100;
                } else {
                    // NEAR the end: re-follow the PLAN's waypoints (engine-true; interaction-valid end),
                    // snapped GLOBALLY to where we stand (a 0-index reseed marched the bot backward).
                    this.travelPath = this.densify(this.mlPlan[this.mlLegIdx]!.waypoints.map(w => ({ x: w.x, z: w.z })));
                    this.travelIdx = this.nearestPathIdx(this.travelPath);
                }
                this.travelStallTicks = 0;
                this.lastTravelMoveTick = -100;
            } else if (this.findLongPathFn) {
                // prepend the current tile so a raw turning-point re-plan (navgrid miss) has no start gap
                // (see the initial-compute note above) — the naive server drops a non-adjacent first MOVE.
                const rr = this.planTravel(this.travelLevel, me.x, me.z, this.travelDest.x, this.travelDest.z);
                this.travelPath = this.densify(rr.length ? [{ x: me.x, z: me.z }, ...rr] : rr);
                this.travelIdx = 0;
                this.travelStallTicks = 0;
                this.lastTravelMoveTick = -100; // force an immediate send below
                if (this.debug) console.log(`[fb] ${this.loginUser}: re-planned at (${me.x},${me.z}) -> ${this.travelPath.length} tiles`);
            }
        }
        const p2 = this.travelPath;

        // Walk the FINE (per-tile) path. Snap the cursor to the nearest-ahead tile
        // (tolerates overshoot), then aim a SHORT hop LOOK tiles further along it.
        // Small on-path hops never cut across a wall corner, so the server's naive
        // per-hop router threads even tight wall mazes.
        {
            let nearest = this.travelIdx, best = Infinity;
            const lim = Math.min(this.travelIdx + 40, p2.length);
            for (let i = this.travelIdx; i < lim; i++) {
                const d = Math.max(Math.abs(p2[i].x - me.x), Math.abs(p2[i].z - me.z));
                if (d < best) { best = d; nearest = i; }
            }
            // Skip forward past any path tile that IS our own tile, so the emitted MOVE never LEADS
            // with a (0,0) waypoint — the server won't step off its own start tile and the bot wedges
            // FOREVER (every re-plan's path[0] is the current tile: findLongPath starts at the source).
            // walkToExact already does this; doTravel did not, which is the recurring "stuck at the
            // exact same tile" wedge (p3 at (2568,3458), m5, p4 — one root cause, live-reproduced).
            while (nearest < p2.length - 1 && p2[nearest].x === me.x && p2[nearest].z === me.z) nearest++;
            this.travelIdx = nearest;
        }
        // Send the next stretch as EXPLICIT per-tile waypoints (up to 16). A single
        // far hop makes the server NAIVE-step a straight line toward it, which cuts
        // corners into fence posts / walls and wedges the bot (e.g. the diagonal
        // fencing at (3237,3224)); per-tile waypoints leave it nothing to cut.
        const LOOK = 16;
        const end = Math.min(this.travelIdx + LOOK, p2.length - 1);
        let seg = p2.slice(this.travelIdx, end + 1);
        // GAP BRIDGE (the general adjacency guarantee). If the nearest path tile is >1 from us, the
        // emitted MOVE leads with a NON-ADJACENT waypoint and the naive server drops the whole path ->
        // frozen forever. This happens whenever travelPath doesn't start at our tile: a raw turning-point
        // route (navgrid can't cover this tile — inside a building — so findLongPath's fallback omits the
        // start), or a plan-refollow snapped forward to a corner we haven't reached. A straight densified
        // run from us to that tile restores adjacency — turning-point segments ARE straight walkable runs,
        // so it's collision-legal for the raw case, and a 1-2 tile hop for a close snap. One choke point
        // instead of a fragile prepend in every re-plan branch (RM live-caught: the Duke down-climb
        // dropped the bot inside Lumbridge castle at 3205,3209 and the route's first turning point sat 6
        // tiles south — the bot re-sent a 203-tile path at idx=1 for minutes without moving).
        const head = seg[0];
        if (head && Math.max(Math.abs(head.x - me.x), Math.abs(head.z - me.z)) > 1) {
            const bridge = this.densify([{ x: me.x, z: me.z }, { x: head.x, z: head.z }]).slice(1);   // drop leading (0,0)
            if (bridge.length) seg = [...bridge, ...seg].slice(0, LOOK + 1);
        }
        const tx = seg[seg.length - 1].x, tz = seg[seg.length - 1].z;

        // Re-send when we've reached the stretch end, after a quiet gap, or on a
        // stall — NOT every tick (that resets the route -> deadlock).
        const reachedHop = Math.max(Math.abs(tx - me.x), Math.abs(tz - me.z)) <= 1;
        // Hold MOVEs briefly after an OPLOC — a MOVE calls clearPendingAction() and
        // cancels the pending door-open, so the gate never swings and we thrash forever.
        if (this.tickCount < this.travelSuppressMoveUntil) { /* let the open resolve */ }
        else if (this.lastTravelMoveTick < 0 || reachedHop || this.tickCount - this.lastTravelMoveTick >= 6) {
            this.sendMultiMove(seg);
            this.lastTravelMoveTick = this.tickCount;
        }
    }

    // Blind-open the least-recently-tried door/gate within `radius` of (x,z). Returns
    // true if an OPLOC was sent (then MOVEs are suppressed ~6 ticks while the server
    // self-routes onto the operable tile and swings the gate). Cycling by last-tried
    // means repeated stalls try every nearby candidate, not just the closest.
    /** nearest walkable tile from which the loc is operable (reachedLoc) that no npc stands on (npcs block players); null = none */
    private freeLocApproach(p: MlPortal, me: { x: number; z: number }): { x: number; z: number } | null {
        if (!p.dims) return null;
        const occ = new Set<string>();
        for (let k = 0; k < this.npcCount; k++) { const m = this.npcs[this.npcIndices[k]!]; if (m) { const w = this.npcWorldTile(m); occ.add(`${w.x},${w.z}`); } }
        const span = Math.max(p.dims.w, p.dims.l), fa = locForceApproach(p.locId ?? 0);
        let best: { x: number; z: number } | null = null, bd = Infinity;
        for (let x = p.x - 1; x <= p.x + span; x++) for (let z = p.z - 1; z <= p.z + span; z++) {
            if (occ.has(`${x},${z}`) || !isTileWalkable(this.mlLegLevel, x, z)) continue;
            if (!reachedLoc(this.mlLegLevel, x, z, p.x, p.z, p.dims.w, p.dims.l, p.angle ?? 0, p.shape ?? 10, fa)) continue;
            const d = Math.max(Math.abs(x - me.x), Math.abs(z - me.z));
            if (d < bd) { bd = d; best = { x, z }; }
        }
        return best;
    }
    /** nearest walkable tile SIDE-adjacent to a multi-tile loc's footprint (no corners), other than our own; null = none.
     *  Footprint as findPathToLoc: odd angles swap w/l. Exported for sim/climb-reposition-side.test.ts. */
    sideApproachTile(p: { x: number; z: number; dims?: { w: number; l: number }; angle?: number; shape?: number; locId?: number }, me: { x: number; z: number }): { x: number; z: number } | null {
        if (!p.dims) return null;
        const odd = ((p.angle ?? 0) & 1) === 1;
        const w = Math.max(1, odd ? p.dims.l : p.dims.w), h = Math.max(1, odd ? p.dims.w : p.dims.l);
        const c: Array<{ x: number; z: number }> = [];
        for (let x = p.x; x < p.x + w; x++) c.push({ x, z: p.z - 1 }, { x, z: p.z + h });
        for (let z = p.z; z < p.z + h; z++) c.push({ x: p.x - 1, z }, { x: p.x + w, z });
        // TRIED tiles (per loc, this session): the offline reach model can call a face valid that the engine refuses (the
        // Dwarven Mine stairs: north face + corner accepted offline, only the west face climbs live), so a stand we were
        // stuck on is never picked again; the walk rotates through the faces instead of re-picking the nearest one.
        const key = `${p.x},${p.z}`;
        let tried = this.repoTried.get(key); if (!tried) { tried = new Set(); this.repoTried.set(key, tried); }
        tried.add(`${me.x},${me.z}`);
        let best: { x: number; z: number } | null = null, bd = Infinity;
        for (let pass = 0; pass < 2 && !best; pass++) for (const t of c) {
            if (t.x === me.x && t.z === me.z) continue;
            if (pass === 0 && tried.has(`${t.x},${t.z}`)) continue;
            // walkable AND an allowed side for the offline reach model (forceapproach locs refuse some faces)
            let ok = false;
            try { ok = isTileWalkable(this.mlLegLevel, t.x, t.z) && reachedLoc(this.mlLegLevel, t.x, t.z, p.x, p.z, p.dims.w, p.dims.l, p.angle ?? 0, p.shape ?? 10, locForceApproach(p.locId ?? 0)); } catch { ok = false; }
            if (!ok) continue;
            const d = Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z));
            if (d < bd) { bd = d; best = t; }
        }
        if (best && tried.has(`${best.x},${best.z}`)) tried.clear();   // every face tried: start over
        return best;
    }
    private repoTried = new Map<string, Set<string>>();

    private tryOpenDoor(x: number, z: number, radius: number): boolean {
        // Only consider doors ON THE PATH AHEAD (within 1 of the next ~10 path tiles). "Any door within
        // radius" fired on nearby-but-irrelevant doors (castle interiors are dense with table doors),
        // and each fire suppresses MOVEs 6 ticks — with 2+ doors cycling cooldowns the suppression is
        // CONTINUOUS and walking STARVES (trace-caught: 24 straight sup=true ticks, zero MOVEs). No
        // path context (non-travel callers) keeps the old radius behavior.
        const ahead: Array<{ x: number; z: number }> = [];
        if (this.travelPath) {
            for (let i = this.travelIdx; i < Math.min(this.travelIdx + 10, this.travelPath.length); i++) ahead.push(this.travelPath[i]!);
        }
        // ⛔ A DOOR THAT IS OPEN ON THE STATIC MAP AND WAS CLOSED (sim, Varrock church south door: the
        // double door 1517/1520 is OPEN at boot @(3255-3256,3471); closed, its leaf 1516 sits on (3255,3470), a tile the static
        // door table does not list). Every opener below keys off TRAVEL_DOORS (static tiles + ids), so nothing ever opened it:
        // 2 re-plans, then a 60-tick stall opener, then a frozen-tile relog. The tracker knows the LIVE closed
        // loc: op it first, by its live id, when it is next to us (OPLOC does not self-route) and next to the path ahead.
        // Only CLOSED tracker entries are used, so an open door is never opped (op1 of an open door shuts it). DOOR_LIVE_OPEN=0 = off.
        if (this.doorTracker && process.env.DOOR_LIVE_OPEN !== '0') {
            const live = this.doorTracker.nearestClosed(this.travelLevel, x, z, Math.min(radius, 1));
            if (live && (!ahead.length || ahead.some(t => Math.max(Math.abs(t.x - live.x), Math.abs(t.z - live.z)) <= 1))
                && this.tickCount - (this.travelDoorTried.get(`${live.x},${live.z}`) ?? -100) >= 12) {
                this.travelDoorTried.set(`${live.x},${live.z}`, this.tickCount);
                this.opLoc(live.x, live.z, live.locId, live.op);
                this.travelSuppressMoveUntil = this.tickCount + 6;
                if (!this.quiet) console.log(`[fb] ${this.loginUser}: OPEN live closed door ${live.locId} @(${live.x},${live.z}) OPLOC${live.op} (tracker; stalled r=${radius})`);
                return true;
            }
        }
        let best: (typeof TRAVEL_DOORS)[number] | null = null;
        let bestTried = Number.POSITIVE_INFINITY, bestD = Number.POSITIVE_INFINITY;
        for (const d of TRAVEL_DOORS) {
            if (d.level !== this.travelLevel) continue;   // only doors on the plane we're walking
            const dist = Math.max(Math.abs(d.x - x), Math.abs(d.z - z));
            if (dist > radius) continue;
            if (ahead.length && !ahead.some(t => Math.max(Math.abs(t.x - d.x), Math.abs(t.z - d.z)) <= 1)) continue;
            // NEVER OPLOC a door the tracker knows is OPEN — an open door's op1 is "Close", so a blind
            // re-OPLOC would SHUT it in the bot's face (or behind it). With authoritative state we simply
            // walk through the ones already open (undefined = unknown door -> fall back to trying it).
            if (this.doorTracker?.isOpen(this.travelLevel, d.x, d.z) === true) continue;
            // a door the wedge rung gave up on and masked: we are routing AROUND it, don't stop to poke it
            if (this.#twMaskedDoors.has(`${d.level},${d.x},${d.z}`)) continue;
            const tried = this.travelDoorTried.get(`${d.x},${d.z}`) ?? -100;
            // + Manhattan tie-break: a 2-leaf gate's DIAGONAL leaf cannot be operated (its OPLOCs are discarded)
            const dd = dist + (Math.abs(d.x - x) + Math.abs(d.z - z)) * 0.01;
            if (tried < bestTried || (tried === bestTried && dd < bestD)) { bestTried = tried; bestD = dd; best = d; }
        }
        if (!best) return false;
        if (this.tickCount - (this.travelDoorTried.get(`${best.x},${best.z}`) ?? -100) < 30) return false;
        this.travelDoorTried.set(`${best.x},${best.z}`, this.tickCount);
        this.out.p1Enc(OPLOC_OPCODES[best.op]);
        this.out.p2(best.x); this.out.p2(best.z); this.out.p2(best.locId);
        this.travelSuppressMoveUntil = this.tickCount + 6;
        if (!this.quiet) console.log(`[fb] ${this.loginUser}: OPEN "${best.name}" locId=${best.locId} @(${best.x},${best.z}) OPLOC${best.op} (stalled r=${radius})`);
        return true;
    }

    // =================================================================================================
    // ⭐ THE ASYNC-ACTION ADAPTER — the bridge between an AWAITED action and a SYNCHRONOUS brain
    // =================================================================================================
    //
    // ⛔ THE IMPEDANCE MISMATCH THIS EXISTS TO CLOSE. The seven skilling actions below are `async` and
    // park on `awaitTicks()` (i.e. on `sendWait`, resolved from the decode loop). Every brain is
    // the opposite shape: a SYNCHRONOUS per-tick state machine (`doCombat()` / `mineStep()` / `warm()`)
    // called once per tick from the packet loop, which must RETURN so the loop can flush and decode the
    // next tick. A brain cannot `await` one of these without leaving its tick — and if it did, the tick
    // that resolves it would never arrive, because the loop that advances the tick is the same loop it
    // just stopped returning to. The result was seven fully-built, live-proven, test-covered actions
    // with ZERO production callers.
    //
    // ⭐ THE FIX IS TO MAKE "IN FLIGHT" A PHASE. The brain starts an action, hands the promise to this
    // slot, and from then on spends each tick in `driveAction()` until the slot settles. Four
    // properties, each of which is a rule this codebase has already paid for:
    //
    //   1. THE TICK NEVER BLOCKS. `driveAction()` is a field test and a return. The packet loop is
    //      never suspended, so `planRoute`'s "synchronous work in the packet loop stops the whole
    //      process decoding" hazard is not re-introduced through the back door.
    //
    //   2. IN-FLIGHT IS OBSERVABLE, NOT SILENT. Two instruments would otherwise LIBEL a working bot:
    //        * `checkBrainLiveness()` measures `out.pos` ACROSS brain() only. An in-flight action's
    //          packets are written from a MICROTASK that runs after brain() has returned (and after
    //          `flush()`), so the brain's own delta is zero on every held tick and `silentTicks` would
    //          climb to BRAIN-SILENT on a bot that is doing exactly what it was told. `driveAction()`
    //          therefore `warm()`s — one NO_TIMEOUT byte per held tick — which is the same contract
    //          every other legitimate-wait branch in brain() honours (`dialogLeased`, `modalLeased`).
    //        * the progress watchdog selects its patience BY PHASE, so the bucket is set to
    //          `skill:<name>`. A stall inside an action therefore reports `STALL:skill:chopTree` and
    //          names the action instead of dissolving into 'other'.
    //      `spendIdleTick()` is deliberately NOT used: this branch is not idle, it is working, and
    //      routing it there would raise a modalWedge on a healthy bot (a false positive is how a real
    //      wedge gets ignored).
    //
    //   3. A HUNG ACTION IS BOUNDED AND FAILS LOUDLY. Every action here is internally bounded by
    //      `awaitTicks`, but "bounded today" is not a property the adapter may assume of an action it
    //      does not own (or of one written next month). So the SLOT carries its own deadline: past it
    //      the wedge `SKILL-HUNG-<name>` is raised on `progressWedge()` at error level; past twice it
    //      the promise is ORPHANED so the brain gets its bot back. That is the "never a silent
    //      fixpoint" rule enforced structurally rather than per-action.
    //
    //   4. LATE ANSWERS CANNOT LIE. An orphaned promise is still running and WILL eventually resolve.
    //      Every start takes a generation number; a resolution whose generation is stale is discarded
    //      and counted (`actionsOrphaned`) rather than being handed to whatever phase the brain has
    //      since moved on to. ⛔ An orphaned action can still put packets on the wire until its own
    //      `awaitTicks` runs out — which is exactly why the hard bound is 2x rather than 1x, and why
    //      the orphan is logged at error level instead of being swept up quietly.
    //
    // COST WHEN IDLE: `driveAction()` is `if (this.actionName === '') return false;` — one string field
    // read and a compare, no allocation, no Map, no timer. Measured in a micro-benchmark.
    //
    // ⛔ ONE ACTION AT A TIME, BY CONSTRUCTION. `startAction` refuses while a slot is occupied rather
    // than queueing: two concurrent awaited actions on one bot would interleave their packets and each
    // would confirm against a world the other was changing. A brain that needs two does them in two
    // phases, which is the state machine it already is.

    /**
     * Ticks an adapter-driven action may run before `SKILL-HUNG-<name>` is raised. Twice this and the
     * promise is abandoned.
     *
     * ⛔ IT MUST EXCEED THE SLOWEST ACTION'S OWN WORST CASE, OR THE NET FIRES ON HEALTHY WORK. Got this
     * wrong on the first live run: 90 was picked as "1.5x `skillTimeoutTicks`", forgetting that
     * `chopTree` also pays for the WALK — `tries(3) x ticksPerTry(15) + timeoutTicks(60) = 105`. The
     * adapter then wedged three times on chops that were merely slow, which is how a real detector gets
     * ignored. 240 is comfortably above every built-in action's worst case; a lane that knows its own
     * action tightens it per call (`startAction(..., { deadlineTicks })`), which is the right place for
     * a tight bound because only the caller knows what it started.
     */
    actionDeadlineTicks = Number(process.env.FB_ACTION_DEADLINE_TICKS ?? 240);

    /** '' when nothing is in flight. The action's label — also the `skill:<name>` tick bucket. */
    private actionName = '';
    private actionStartTick = -1;
    private actionDeadline = 0;
    /** Bumped on every start. A settle whose generation is stale is an ORPHAN and is discarded. */
    private actionGen = 0;
    private actionSettled: ActionOutcome | null = null;
    /** Raised while the in-flight action has blown its deadline. Surfaced on progressWedge(). */
    actionWedge = '';

    // --- counters (a lane reports these; absence must never look like zero) --------------------------
    actionsStarted = 0;
    /** actions that resolved and reported success. */
    actionsOk = 0;
    /** actions that resolved and reported a typed failure. NOT an error — a `no_logs` is information. */
    actionsFailed = 0;
    /** actions the adapter abandoned on its own deadline. ⛔ MUST BE 0 on a healthy lane. */
    actionsTimedOut = 0;
    /** late resolutions from an abandoned slot, discarded. Non-zero always accompanies a timeout/abort. */
    actionsOrphaned = 0;
    /** ⛔ of those, the ones that answered SUCCESS — work that was thrown away. MUST be ~0; see settleAction. */
    actionsOrphanedOk = 0;
    /** actions whose promise REJECTED. A throw inside an action is a bug, not a refusal. */
    actionsThrew = 0;
    /** ticks spent holding an action in flight — the lane's "engaged" denominator. */
    actionTicks = 0;
    /** reason -> count, over every non-ok outcome. The lane's failure taxonomy, for free. */
    readonly actionReasons: Record<string, number> = {};

    /** Is an adapter-driven action in flight right now? Pure; no side effects. */
    actionBusy(): boolean { return this.actionName !== ''; }
    /** The in-flight action's label, or '' — for a status line / BotDetail row. */
    actionLabel(): string { return this.actionName; }
    /** Ticks the current action has been in flight (0 when idle). */
    actionHeldTicks(): number { return this.actionName === '' ? 0 : this.tickCount - this.actionStartTick; }

    /**
     * Start an async action and hand its promise to the slot. Returns false (and does NOTHING) if one
     * is already in flight, so a brain may call this unconditionally from its decision branch.
     *
     * `start` is a THUNK, not a promise, so nothing is created when the slot is busy — and a
     * synchronous throw inside it (a bad table lookup, a null deref) is caught here and reported as an
     * outcome, rather than propagating into brain() where it becomes the "BRAIN THREW" silent-tick bug.
     */
    startAction<T extends AsyncActionResult>(name: string, start: () => Promise<T>,
        opts: { deadlineTicks?: number } = {}): boolean {
        if (this.actionName !== '') return false;
        const gen = ++this.actionGen;
        this.actionName = name;
        this.actionStartTick = this.tickCount;
        this.actionDeadline = Math.max(1, opts.deadlineTicks ?? this.actionDeadlineTicks);
        this.actionsStarted++;
        let p: Promise<T>;
        try {
            p = start();
        } catch (e) {
            this.settleAction(gen, name, null, e as Error);
            return true;
        }
        p.then(r => this.settleAction(gen, name, r, null), e => this.settleAction(gen, name, null, e as Error));
        return true;
    }

    /** Record an outcome, unless this is a late answer from a slot we already abandoned. */
    private settleAction<T extends AsyncActionResult>(gen: number, name: string, r: T | null, err: Error | null): void {
        if (gen !== this.actionGen) {
            // The slot moved on without it. Count it and say so ONCE — a late orphan that still sends
            // packets is the only way this adapter can surprise a brain, so it is never silent.
            this.actionsOrphaned++;
            // ⭐ THE ALARM THAT SHOULD HAVE CAUGHT IT SOONER, AND NOW WILL. An orphan that answers
            // SUCCESS means the adapter (or a brain's abort) threw away work that WORKED — the lane's
            // own production counter is then undercounting reality, which is the worst kind of wrong: a
            // healthy lane reporting failure. LIVE-CAUGHT on the skilling lane, twice in one session
            // (`chopped=0` while woodcutting xp climbed and 36 logs burned). `actionsOrphaned` alone
            // could not distinguish "we abandoned a hang" from "we abandoned a success".
            if (!err && r?.success === true) this.actionsOrphanedOk++;
            console.error(`[fb] ${this.loginUser}: ⛔ ORPHANED action '${name}' answered ${err ? `THREW ${err.message}` : `success=${r?.success}`} ` +
                `after the adapter had already abandoned it — DISCARDED (orphan #${this.actionsOrphaned}). It may have put ` +
                `packets on the wire behind the brain's back until its own awaitTicks ran out.`);
            return;
        }
        const ticks = this.tickCount - this.actionStartTick;
        const ok = !err && r !== null && r.success === true;
        const reason = err ? 'action_threw' : (ok ? '' : (r?.reason ?? 'unspecified'));
        this.actionSettled = {
            name, ok, reason,
            message: err ? (err.stack ?? err.message) : (r?.message ?? ''),
            result: err ? null : r, ticks,
        };
        if (ok) this.actionsOk++;
        else if (err) { this.actionsThrew++; this.actionReasons['action_threw'] = (this.actionReasons['action_threw'] ?? 0) + 1; }
        else { this.actionsFailed++; this.actionReasons[reason] = (this.actionReasons[reason] ?? 0) + 1; }
        if (err) {
            console.error(`[fb] ${this.loginUser}: ⛔ action '${name}' THREW after ${ticks} ticks — a throw is a BUG, ` +
                `not a refusal, and it would otherwise be invisible:\n${err.stack ?? err.message}`);
        }
        this.actionName = '';
        this.actionStartTick = -1;
        if (this.actionWedge) {
            console.log(`[fb] ${this.loginUser}: action RECOVERED (was ${this.actionWedge}, settled after ${ticks} ticks)`);
            this.actionWedge = '';
        }
    }

    /**
     * ⭐ THE PER-TICK STEP. `if (this.driveAction()) return;` at the top of a brain hook is the whole
     * integration. True means "an action owns this tick" — the brain must return without doing
     * anything else, exactly as it would for an open modal.
     */
    driveAction(): boolean {
        if (this.actionName === '') return false;
        this.actionTicks++;
        this.tickBucket = `skill:${this.actionName}`;
        // See property (2): the action's packets land from a microtask AFTER brain(), so without this
        // the brain-liveness detector would raise BRAIN-SILENT on a bot that is working correctly.
        this.warm();
        const held = this.tickCount - this.actionStartTick;
        if (held <= this.actionDeadline) return true;

        if (!this.actionWedge) {
            this.actionWedge = `SKILL-HUNG-${this.actionName}`;
            const me = this.playerTile();
            console.error(`[fb] ${this.loginUser}: ⛔ ${this.actionWedge} at (${me.x},${me.z}) — the async action ` +
                `'${this.actionName}' has been in flight for ${held} ticks (deadline ${this.actionDeadline}). Its own ` +
                `awaitTicks should have returned a typed timeout long before this, so either it is awaiting something ` +
                `unbounded or the tick stream stopped. The bot is ALIVE and DOING NOTHING; it will be abandoned at ` +
                `${this.actionDeadline * 2} ticks.`);
        }
        if (held <= this.actionDeadline * 2) return true;

        // ---- ABANDON. The slot is freed so the brain gets its bot back; the promise is orphaned. ----
        this.actionsTimedOut++;
        const name = this.actionName;
        this.actionReasons['action_timeout'] = (this.actionReasons['action_timeout'] ?? 0) + 1;
        this.actionGen++;                       // invalidates the in-flight promise (see settleAction)
        this.actionName = '';
        this.actionStartTick = -1;
        this.actionSettled = {
            name, ok: false, reason: 'action_timeout',
            message: `the adapter abandoned '${name}' after ${held} ticks (deadline ${this.actionDeadline})`,
            result: null, ticks: held,
        };
        console.error(`[fb] ${this.loginUser}: ⛔ ABANDONING action '${name}' after ${held} ticks — the brain is ` +
            `released and the promise is orphaned (timeout #${this.actionsTimedOut}). ${this.actionWedge} stays raised ` +
            `until an action settles normally.`);
        return true;   // this tick still belonged to the action; the brain resumes on the next one
    }

    /**
     * ⭐ THE BRAIN LEARNED THE ACTION IS DOOMED — free the slot NOW instead of waiting out its timeout.
     *
     * ⛔ THIS IS NOT A TIMEOUT AND MUST NOT BE COUNTED AS ONE. A timeout means "nothing answered and we
     * do not know why", which is a fault. An abort means "the world told us this cannot succeed" — the
     * live case that motivated it: a tree is picked, the walk takes ~10 ticks, and the SERVER's zone
     * stream says that tile became a stump while we were walking. The OPLOC is already doomed; without
     * this the action sits out its full 60-tick budget waiting for a log that can never arrive (measured:
     * 1 in 84 actions solo, and it was the ONLY residual defect in the healthy window).
     *
     * The abandoned promise keeps running and will answer late — the SAME generation guard the timeout
     * path uses discards it, so a late answer can never be applied to whatever the brain does next.
     */
    abortAction(reason: string, note = ''): boolean {
        if (this.actionName === '') return false;
        const name = this.actionName;
        const held = this.tickCount - this.actionStartTick;
        this.actionsAborted++;
        this.actionReasons[reason] = (this.actionReasons[reason] ?? 0) + 1;
        this.actionGen++;                       // invalidates the in-flight promise (see settleAction)
        this.actionName = '';
        this.actionStartTick = -1;
        this.actionWedge = '';
        this.actionSettled = {
            name, ok: false, reason,
            message: `the brain ABORTED '${name}' after ${held} ticks: ${note || reason}`,
            result: null, ticks: held,
        };
        return true;
    }

    /** actions the BRAIN abandoned because the world made them impossible. Not a fault — see abortAction. */
    actionsAborted = 0;

    /**
     * Take the settled outcome, or null when there is nothing to take. CONSUMING: a brain reads it once
     * and acts on it, and a second read cannot re-apply the same result.
     *
     * The cast is checked by construction — `startAction<T>` is the only writer of `result`, and it
     * writes exactly the `T` its own thunk resolved.
     */
    takeAction<T extends AsyncActionResult = AsyncActionResult>(): ActionOutcome<T> | null {
        const o = this.actionSettled;
        if (!o) return null;
        this.actionSettled = null;
        return o as ActionOutcome<T>;
    }

    // =================================================================================================
    // SKILLING ACTIONS (parity package 2b) — the seven the browser SDK had and headless did not
    // =================================================================================================
    // chopTree, burnLogs, fletchLogs, craftLeather, craftJewelry, enchantItem, stringAmulet.
    //
    // Every id, recipe and component below comes from `skilling-tables.ts`, which is GENERATED from
    // the engine's own packed id tables and content scripts. Nothing here hard-codes an id and nothing
    // reads a BUTTON LABEL to decide what a button does — the label lies (leather_crafting's "Make 10
    // pairs" of chaps makes exactly one; confirmed live, see A7 in skilling-live-probe.ts).
    //
    // THE SHARED DESIGN RULE, same as the capability layer: **act, then CONFIRM FROM THE SERVER.**
    // A send is never evidence. Each action below waits on the server-side fact the generator named
    // (an XP delta on the right stat, a backpack delta, a slot's obj id changing, a modal opening) and
    // otherwise reports a typed `reason` — it never assumes.
    //
    // ⛔ FOUR TRAPS THAT PRODUCE SILENT NO-OPS, all honoured here:
    //  1. OPHELDU IS TOOL-FIRST. knife/tinderbox/needle/ball_of_wool each have their own [opheldu,<obj>]
    //     trigger and read the target from last_useitem/last_useslot. Tool-SECOND falls into
    //     OpHeldUHandler.ts:95-99, which swaps lastItem/lastUseItem unconditionally once the first
    //     lookup misses — sometimes right, never reliably.
    //  2. SKILL_MULTI MAKE BUTTONS ARE IF_BUTTON, NOT RESUME_PAUSEBUTTON. ResumePauseButtonHandler
    //     REFUSES while a choice is pending, so the dialog-continue primitive silently does nothing.
    //     (Proven live: resumeDialogPage() on a pending skill_multi3 left the dialog open and the xp
    //     flat; IF_BUTTON on the make-1 component made the shafts.)
    //  3. FIREMAKING MOVES YOU. ~push_player teleports you one tile (west, east, south, north — first
    //     walkable wins) and the fire lands on your OLD tile. burnLogs returns that tile as `fireAt`.
    //  4. ENCHANT REPLACES THE ITEM IN PLACE (inv_setslot, not del+add). The occupied-slot count never
    //     moves, so a count-based detector is blind; enchantItem watches the SLOT's obj id.
    //
    // ⛔ AND THE STANDING PROTOCOL RULE: a MOVE cancels a pending interaction. These actions never send
    // one on their own except where noted, but a BRAIN that walks while awaiting one of them will
    // cancel it. Drive them from a phase that owns the ticks (the miner/smith pattern).

    /** Ticks a skilling action waits for its server-side confirmation before giving up. */
    skillTimeoutTicks = Number(process.env.FB_SKILL_TIMEOUT_TICKS ?? 60);

    /** Poll `pred` once per SERVER tick (never a timer) for at most `maxTicks`.
     *
     *  ⛔ THE ONLY LIVENESS GUARD HERE IS `disposed`, deliberately. `alive` is set by login() and by
     *  nothing else, so a bot driven WITHOUT a login — every SimHarness test, and any harness that
     *  attaches to an existing stream — would have every skilling action return on its first poll and
     *  report a timeout it never actually waited for. `sendWait` already resolves on dispose, and the
     *  LOGOUT arm wakes every parked tick waiter, so a dead session cannot strand this loop either. */
    private async awaitTicks(pred: () => boolean, maxTicks: number): Promise<boolean> {
        for (let i = 0; i < maxTicks; i++) {
            if (pred()) return true;
            if (this.disposed) return pred();
            await this.sendWait(1);
        }
        return pred();
    }

    /** Server MESSAGE_GAME lines (chat type 0) recorded at or after `tick`. */
    private skillMsgs(sinceTick: number): string[] {
        return this.getChat({ types: [0], limit: 0, includeSelf: true })
            .filter(m => m.tick >= sinceTick).map(m => m.text);
    }
    private sawMsg(sinceTick: number, needle: string): boolean {
        return this.skillMsgs(sinceTick).some(t => t.includes(needle));
    }

    /** Display name of an obj, or '' when this process never built the loc index. Never throws. */
    private objLabel(obj: number): string {
        try { return locScene.isReady() ? locScene.objName(obj) : ''; } catch { return ''; }
    }

    /** Backpack entry for the first slot holding `obj`, or undefined. */
    private skillItem(obj: number): SkillItem | undefined {
        const inv = this.invForInventory();
        if (!inv) return undefined;
        for (let i = 0; i < inv.ids.length; i++) {
            if (inv.ids[i] === obj) return { slot: i, id: obj, name: this.objLabel(obj), count: this.countInInv(obj) };
        }
        return undefined;
    }

    /** Is `obj` in the EQUIPPED container? (woodcutting_axe_checker looks in the right hand too.) */
    private isWornObj(obj: number): boolean {
        const w = this.invs.get(WORN_INTERFACE);
        if (!w) return false;
        for (let i = 0; i < w.ids.length; i++) if (w.ids[i] === obj) return true;
        return false;
    }

    /** A loc's occupied tile rectangle. width/length SWAP on an odd rotation, exactly as the engine
     *  reads them, so a 1x2 loc's footprint is right whichever way it was placed. */
    private locFootprint(loc: { x: number; z: number; width?: number; length?: number; angle?: number }):
        { x0: number; x1: number; z0: number; z1: number } {
        let w = Math.max(1, loc.width ?? 1), l = Math.max(1, loc.length ?? 1);
        if (((loc.angle ?? 0) & 1) === 1) { const t = w; w = l; l = t; }
        return { x0: loc.x, x1: loc.x + w - 1, z0: loc.z, z1: loc.z + l - 1 };
    }

    /** Cardinally adjacent to the loc's footprint (the reach an OPLOC actually needs). */
    private adjacentToLoc(loc: { x: number; z: number; width?: number; length?: number; angle?: number }): boolean {
        const f = this.locFootprint(loc); const me = this.playerTile();
        const inX = me.x >= f.x0 && me.x <= f.x1, inZ = me.z >= f.z0 && me.z <= f.z1;
        return (inX && (me.z === f.z0 - 1 || me.z === f.z1 + 1)) || (inZ && (me.x === f.x0 - 1 || me.x === f.x1 + 1));
    }

    /**
     * Walk to a tile beside a loc, because **OPLOC DOES NOT SELF-ROUTE** — measured, not assumed: a
     * bare OPLOC1 on a tree 5 tiles away answers "I can't reach that!" every tick and the player never
     * takes a step. The naive-router rule cuts deeper than "it paths badly":
     * for a loc op there is no routing at all, so an interact-from-range is a guaranteed silent no-op.
     *
     * Tries the nearest cardinal stand tiles in turn (a MOVE to a blocked one simply never arrives).
     * MOVE_OPCLICK, never MOVE_GAMECLICK — a gameclick MOVE before an interaction no-ops the interaction.
     *
     * ⛔ AND IT WALKS WITH THE NAVGRID WALKER WHEN THERE IS ONE. THE NAMED TRAP, third-party-verified
     * and paid for twice (Zeke, Karim, the Al Kharid gate): **a bare `sendMove` to a STATIC tile whose
     * straight line is blocked never arrives** — the server is a naive router that never re-paths, so
     * it returns [0,0] forever. That is tolerable for an NPC (the engine re-paths to a pathing entity
     * every tick) and fatal for a loc. A WOOD LOT IS THE WORST CASE FOR IT: trees are themselves
     * blocking locs, so the straight line to the far side of one tree runs through another.
     * LIVE-CAUGHT on the first skill-lane run: `sendMove`-only approach never arrived, the OPLOC was
     * then issued from range and SILENTLY DISCARDED (`ACK-NOACK-OPLOC` — no message, because
     * `canAccess()` gates the "I can't reach that!" reply as well as the interaction), and the action
     * burned its whole 60-tick budget. `walkToExact` is the project's navgrid walker with its own stall
     * detection; it is a PER-TICK walker, so it is re-driven from inside the wait rather than fired
     * once. Without a planner (`findLongPathFn` unset — every SimHarness test, co-located probes) the
     * old naive push is kept, because from one tile away it is exactly right.
     */
    private async approachLoc(loc: { x: number; z: number; width?: number; length?: number; angle?: number },
        opts: { ticksPerTry?: number; tries?: number } = {}): Promise<boolean> {
        if (this.adjacentToLoc(loc)) return true;
        const f = this.locFootprint(loc);
        const cands: { x: number; z: number }[] = [];
        for (let z = f.z0; z <= f.z1; z++) { cands.push({ x: f.x0 - 1, z }); cands.push({ x: f.x1 + 1, z }); }
        for (let x = f.x0; x <= f.x1; x++) { cands.push({ x, z: f.z0 - 1 }); cands.push({ x, z: f.z1 + 1 }); }
        const me = this.playerTile();
        cands.sort((a, b) => Math.max(Math.abs(a.x - me.x), Math.abs(a.z - me.z)) - Math.max(Math.abs(b.x - me.x), Math.abs(b.z - me.z)));
        for (const c of cands.slice(0, opts.tries ?? 3)) {
            if (this.findLongPathFn) {
                // The predicate DELIBERATELY has a side effect: walkToExact must be driven once per
                // tick (it re-plans on its own stall counter), and awaitTicks is the only per-tick
                // clock an async action has. It stops the moment we are adjacent, which can happen a
                // tile before the stand tile itself if the route passes one.
                if (await this.awaitTicks(() => {
                    if (this.adjacentToLoc(loc)) return true;
                    this.walkToExact(c.x, c.z);
                    return false;
                }, opts.ticksPerTry ?? 15)) return true;
            } else {
                this.sendMove(c.x, c.z, true);
                if (await this.awaitTicks(() => this.adjacentToLoc(loc), opts.ticksPerTry ?? 15)) return true;
            }
        }
        return this.adjacentToLoc(loc);
    }

    /** Best axe held, in woodcutting_axe_checker's OWN test order (backpack or right hand). */
    bestAxe(): { name: string; obj: number; slot: number; worn: boolean } | null {
        for (const a of AXES) {
            const slot = this.invSlotOf(a.obj);
            if (slot >= 0) return { name: a.name, obj: a.obj, slot, worn: false };
            if (this.isWornObj(a.obj)) return { name: a.name, obj: a.obj, slot: -1, worn: true };
        }
        return null;
    }

    /** Nearest chopppable tree around the bot, filtered by the generated TREE_BY_LOC table and by the
     *  bot's own Woodcutting level. `pattern` narrows by loc NAME ("willow", /^yew$/i, ...).
     *  ⛔ Requires locScene.init() at startup — locs are never transmitted. */
    findTree(pattern?: string | RegExp, radius = 12): (locScene.SceneLoc & { tree: TreeEntry }) | null {
        const level = this.statLevel[8] ?? 1;   // PlayerStat.WOODCUTTING
        const re = pattern === undefined ? null : (typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern);
        for (const loc of this.getNearbyLocs(radius)) {     // nearest first
            const tree = TREE_BY_LOC.get(loc.id);
            if (!tree || tree.level > level) continue;
            if (re) { re.lastIndex = 0; if (!re.test(loc.name)) continue; }
            return { ...loc, tree };
        }
        return null;
    }

    /**
     * Chop a tree and wait for the log. SDK parity: `chopTree(target?)`.
     *
     * PACKET: opLoc(x, z, locId, 1) — **ONE send**. woodcut.rs2 re-arms itself with `p_oploc(3)` every
     * cycle, so the server keeps swinging until the tree depletes, the pack fills or you move. Sending
     * op 3 yourself is never right: `[oploc3,_tree]` is the hidden continuation op.
     *
     * ⛔ OPLOC DOES NOT SELF-ROUTE — measured live, and stronger than the naive-router rule suggests:
     * from 5 tiles away the server answers "I can't reach that!" every tick and the player never moves.
     * So this WALKS first (MOVE_OPCLICK to a cardinal stand tile) unless `approach:false`.
     *
     * ⛔ AND A NORMAL TREE DEPLETES ON THE FIRST LOG. woodcut.rs2 does re-arm with p_oploc(3), but the
     * loc changes to a stump the moment it yields, so in practice ONE OPLOC = ONE log — which is
     * exactly the SDK's contract for this call. Loop it; do not wait for a second log.
     *
     * `target` is a loc name pattern ("willow", /^yew$/i) or a SceneLoc you already resolved.
     * Success = the row's product obj in the backpack — not the send.
     */
    async chopTree(target?: string | RegExp | locScene.SceneLoc, opts: { radius?: number; timeoutTicks?: number; approach?: boolean } = {}): Promise<ChopTreeResult> {
        const axe = this.bestAxe();
        if (!axe) return { success: false, message: 'No axe in the backpack or right hand', reason: 'no_axe' };

        let loc: locScene.SceneLoc | null;
        let tree: TreeEntry | undefined;
        if (target && typeof target === 'object' && 'id' in target) {
            loc = target; tree = TREE_BY_LOC.get(target.id);
            if (!tree) return { success: false, message: `loc ${target.id} ("${target.name}") is not a tree`, reason: 'not_a_tree' };
        } else {
            const found = this.findTree(target as string | RegExp | undefined, opts.radius ?? 12);
            if (!found) return { success: false, message: `No chopppable tree within ${opts.radius ?? 12} tiles`, reason: 'tree_not_found' };
            loc = found; tree = found.tree;
        }
        if (tree.level > (this.statLevel[8] ?? 1)) {
            return { success: false, message: `Woodcutting ${tree.level} needed for ${tree.table}`, reason: 'level_too_low' };
        }

        // ⛔ HONOUR THE APPROACH'S ANSWER. This used to be a bare `await this.approachLoc(loc)` whose
        // return value was DROPPED, so a tree we could not reach was OPLOC'd anyway — and because
        // `canAccess()` gates the "I can't reach that!" reply as well as the interaction, the server
        // answered with SILENCE. The action then spent its entire 60-tick budget waiting for a log that
        // could never come, and the bot's next pick was the same tree. That is the difference between a
        // 105-tick silent hang and a 45-tick TYPED refusal the caller can act on (cool the tile, take
        // the next tree) — the whole reason these actions return a `reason` at all.
        if (opts.approach !== false && !await this.approachLoc(loc)) {
            const at = this.playerTile();
            return {
                success: false, reason: 'cant_reach',
                message: `could not reach a tile cardinally adjacent to ${loc.name}@(${loc.x},${loc.z}) — standing at ` +
                    `(${at.x},${at.z}); OPLOC does not self-route, so sending it from here would be silently discarded`,
            };
        }

        const t0 = this.tickCount;
        const xpB4 = this.statXp[8] ?? 0;
        const logsB4 = this.countInInv(tree.productObj);
        this.opLoc(loc.x, loc.z, loc.id, CHOP_OP);

        const done = await this.awaitTicks(
            () => this.countInInv(tree!.productObj) > logsB4
                || this.sawMsg(t0, SKILL_MES.woodcutting.invFull)
                || this.sawMsg(t0, SKILL_MES.woodcutting.noAxe)
                || this.sawMsg(t0, SKILL_MES.woodcutting.levelPrefix)
                || this.sawMsg(t0, CANT_REACH_MESSAGE),
            opts.timeoutTicks ?? this.skillTimeoutTicks);

        const gained = this.countInInv(tree.productObj) - logsB4;
        if (gained > 0) {
            return {
                success: true, message: `Chopped ${loc.name} (${tree.table}) with the ${axe.name}`,
                logs: this.skillItem(tree.productObj), xpGained: (this.statXp[8] ?? 0) - xpB4,
            };
        }
        if (this.sawMsg(t0, SKILL_MES.woodcutting.invFull)) return { success: false, message: SKILL_MES.woodcutting.invFull, reason: 'inventory_full' };
        if (this.sawMsg(t0, SKILL_MES.woodcutting.noAxe)) return { success: false, message: SKILL_MES.woodcutting.noAxe, reason: 'no_axe' };
        if (this.sawMsg(t0, SKILL_MES.woodcutting.levelPrefix)) return { success: false, message: `Woodcutting level too low for ${loc.name}`, reason: 'level_too_low' };
        if (this.sawMsg(t0, CANT_REACH_MESSAGE)) {
            const me = this.playerTile();
            return {
                success: false, reason: 'cant_reach',
                message: `"${CANT_REACH_MESSAGE}" — standing at (${me.x},${me.z}), ${loc.name}@(${loc.x},${loc.z}) needs a CARDINALLY ` +
                    `adjacent tile and OPLOC will not walk you there`,
            };
        }
        return {
            success: false, reason: 'timeout',
            message: `No ${tree.product} after ${opts.timeoutTicks ?? this.skillTimeoutTicks} ticks on ${loc.name}@(${loc.x},${loc.z}) (done=${done})`,
        };
    }

    /**
     * Light a log with a tinderbox. SDK parity: `burnLogs(logsTarget?)`.
     *
     * PACKET: useItemOnItem(TINDERBOX, tbSlot, logObj, logSlot) — **tool first** (trap 1).
     * light_logs_inv drops the log on your tile, rolls, and re-arms with `p_opobj(4)` on failure, so
     * ONE send burns the log to completion or to a refusal.
     *
     * ⛔ ON SUCCESS THE SERVER MOVES YOU one tile and the FIRE is on your old tile — returned as
     * `fireAt`. Ignore that and the next log lands on the fire and is refused with "You can't light a
     * fire here." Bank zones refuse fires outright (area_allow_loc_add), by design.
     */
    async burnLogs(logTarget?: number | string | RegExp, opts: { timeoutTicks?: number } = {}): Promise<BurnLogsResult> {
        const tbSlot = this.invSlotOf(TINDERBOX);
        if (tbSlot < 0) return { success: false, xpGained: 0, message: 'No tinderbox in inventory', reason: 'no_tinderbox' };

        let logObj = -1;
        if (typeof logTarget === 'number') {
            logObj = logTarget;
        } else if (logTarget !== undefined) {
            const re = typeof logTarget === 'string' ? new RegExp(logTarget, 'i') : logTarget;
            for (const l of LOG_TABLE) { re.lastIndex = 0; if (re.test(l.name) && this.invSlotOf(l.obj) >= 0) { logObj = l.obj; break; } }
        } else {
            for (const l of LOG_TABLE) if (this.invSlotOf(l.obj) >= 0) { logObj = l.obj; break; }
        }
        const logSlot = logObj < 0 ? -1 : this.invSlotOf(logObj);
        if (logSlot < 0) return { success: false, xpGained: 0, message: 'No burnable logs in inventory', reason: 'no_logs' };

        const entry = LOG_BY_OBJ.get(logObj);
        if (entry && entry.level > (this.statLevel[11] ?? 1)) {
            return { success: false, xpGained: 0, message: `Firemaking ${entry.level} needed for ${entry.name}`, reason: 'level_too_low' };
        }

        const t0 = this.tickCount;
        const xpB4 = this.statXp[11] ?? 0;     // PlayerStat.FIREMAKING
        const tileB4 = this.playerTile();
        this.useItemOnItem(TINDERBOX, tbSlot, logObj, logSlot);

        await this.awaitTicks(
            () => (this.statXp[11] ?? 0) > xpB4 || this.sawMsg(t0, SKILL_MES.firemaking.noSpace)
                || this.sawMsg(t0, SKILL_MES.firemaking.noTinderbox) || this.sawMsg(t0, SKILL_MES.firemaking.levelPrefix),
            opts.timeoutTicks ?? this.skillTimeoutTicks);

        const xpGained = (this.statXp[11] ?? 0) - xpB4;
        if (xpGained > 0) {
            return {
                success: true, xpGained, fireAt: tileB4,
                message: `Burned ${entry?.name ?? this.objLabel(logObj)} — the fire is on (${tileB4.x},${tileB4.z}); ` +
                    `the server pushed you to (${this.playerTile().x},${this.playerTile().z})`,
            };
        }
        if (this.sawMsg(t0, SKILL_MES.firemaking.noSpace)) return { success: false, xpGained: 0, message: SKILL_MES.firemaking.noSpace, reason: 'no_space' };
        if (this.sawMsg(t0, SKILL_MES.firemaking.noTinderbox)) return { success: false, xpGained: 0, message: SKILL_MES.firemaking.noTinderbox, reason: 'no_tinderbox' };
        if (this.sawMsg(t0, SKILL_MES.firemaking.levelPrefix)) return { success: false, xpGained: 0, message: 'Firemaking level too low', reason: 'level_too_low' };
        return { success: false, xpGained: 0, reason: 'timeout', message: `No firemaking xp after ${opts.timeoutTicks ?? this.skillTimeoutTicks} ticks` };
    }

    /** The skill_multi slot for a product on a given log — POSITIONAL, resolved from the table, never
     *  from the button's label text. `product` matches the kind ('shafts'|'shortbow'|'longbow') or the
     *  product obj name ('unstrung_oak_longbow'). */
    private fletchSlotFor(logObj: number, product: string): { idx: number; p: FletchProduct } | null {
        const entry = FLETCH_LOG_BY_OBJ.get(logObj);
        if (!entry) return null;
        const want = product.toLowerCase().replace(/[\s_]+/g, '');
        for (let i = 0; i < entry.products.length; i++) {
            const p = entry.products[i]!;
            const keys = [p.kind, p.product, p.label].map(s => s.toLowerCase().replace(/[\s_]+/g, ''));
            if (keys.some(k => k === want || k.includes(want))) return { idx: i, p };
        }
        return null;
    }

    /**
     * Cut logs into arrow shafts or a bow. SDK parity: `fletchLogs(product?)`.
     *
     * PACKET: useItemOnItem(KNIFE, ...) — tool first — then the server if_openchat's skill_multi3 (plain
     * logs: shafts / short / long) or skill_multi2 (every other log). Then **IF_BUTTON** on the make
     * component, or makeX followed by submitCountDialog once P_COUNTDIALOG lands.
     *
     * ⛔ `[opheldu,knife]` lives in skill_cooking/.../cutting_fruit.rs2, NOT in skill_fletching:
     * cut_logs.rs2's own `case knife` is DEAD CODE, because obj-specific triggers resolve before
     * category ones. That is why the tool-first order matters here specifically.
     * ⛔ MEMBERS GATE: @fletch_log returns immediately on an F2P world and the dialog never opens.
     *
     * `count` is logs to consume (1 log = 15 shafts or 1 bow); 1/5/10 use the direct buttons, anything
     * else goes through makeX.
     */
    async fletchLogs(product = 'shortbow', opts: { count?: number; logObj?: number; timeoutTicks?: number } = {}): Promise<FletchResult> {
        const knifeSlot = this.invSlotOf(KNIFE);
        if (knifeSlot < 0) return { success: false, message: 'No knife in inventory', reason: 'no_knife' };

        let logObj = opts.logObj ?? -1;
        if (logObj < 0) for (const f of FLETCH_LOGS) if (this.invSlotOf(f.logObj) >= 0) { logObj = f.logObj; break; }
        const logSlot = logObj < 0 ? -1 : this.invSlotOf(logObj);
        if (logSlot < 0) return { success: false, message: 'No fletchable logs in inventory', reason: 'no_logs' };

        const entry = FLETCH_LOG_BY_OBJ.get(logObj)!;
        const pick = this.fletchSlotFor(logObj, product);
        if (!pick) {
            return {
                success: false, reason: 'unknown_product',
                message: `"${product}" is not made from ${entry.log} — offers: ${entry.products.map(p => p.kind).join(', ')}`,
            };
        }
        if (pick.p.level > (this.statLevel[9] ?? 1)) {   // PlayerStat.FLETCHING
            return { success: false, message: `Fletching ${pick.p.level} needed for ${pick.p.product}`, reason: 'level_too_low' };
        }

        const count = Math.max(1, Math.floor(opts.count ?? 1));
        const dialog = SKILL_MULTI_BY_NAME[entry.iface]!;
        const slot = dialog.slots[pick.idx]!;
        const timeout = opts.timeoutTicks ?? this.skillTimeoutTicks;

        const t0 = this.tickCount;
        const xpB4 = this.statXp[9] ?? 0;
        const madeB4 = this.countInInv(pick.p.productObj);
        this.useItemOnItem(KNIFE, knifeSlot, logObj, logSlot);

        if (!await this.awaitTicks(() => this.chatModalId === dialog.root, 15)) {
            if (this.sawMsg(t0, SKILL_MES.fletching.membersRefusal)) {
                return { success: false, message: SKILL_MES.fletching.membersRefusal, reason: 'members' };
            }
            return {
                success: false, reason: 'dialog_not_opened',
                message: `${entry.iface} (${dialog.root}) never opened — chatModalId=${this.chatModalId}. ` +
                    `Check the OPHELDU order is TOOL FIRST and that this world is members.`,
            };
        }

        if (count === 1 || count === 5 || count === 10) {
            this.ifButton(count === 1 ? slot.make1 : count === 5 ? slot.make5 : slot.make10);
        } else {
            this.countDialogTick = -1;
            this.ifButton(slot.makeX);
            if (!await this.awaitTicks(() => this.countDialogTick >= 0, 15)) {
                return { success: false, message: 'makeX did not produce a P_COUNTDIALOG prompt', reason: 'countdialog_not_offered' };
            }
            this.submitCountDialog(count);
        }

        const want = madeB4 + count * pick.p.count;
        await this.awaitTicks(
            () => this.countInInv(pick.p.productObj) >= want
                || this.sawMsg(t0, SKILL_MES.fletching.outOfLogsPrefix)
                || this.sawMsg(t0, SKILL_MES.leather.levelPrefix),
            timeout + count * 4);

        const made = this.countInInv(pick.p.productObj) - madeB4;
        const xpGained = (this.statXp[9] ?? 0) - xpB4;
        if (made > 0) {
            return {
                success: true, xpGained, itemsMade: made, product: this.skillItem(pick.p.productObj),
                message: `Fletched ${made} ${pick.p.product} from ${entry.log}`,
            };
        }
        return { success: false, xpGained, itemsMade: 0, reason: 'timeout', message: `No ${pick.p.product} appeared (msgs: ${this.skillMsgs(t0).join(' | ')})` };
    }

    /** A leather product row by product name, table name or the db name the server echoes. */
    private leatherProduct(product: string): LeatherProduct | undefined {
        const want = product.toLowerCase().replace(/[\s_]+/g, '');
        if (want === 'hardleatherbody' || want === 'hardleather') return HARD_LEATHER;
        return LEATHER_PRODUCTS.find(p =>
            [p.product, p.table, p.name].some(s => s.toLowerCase().replace(/[\s_]+/g, '').includes(want)));
    }

    /**
     * Sew a leather product. SDK parity: `craftLeather(product?)`.
     *
     * PACKET: useItemOnItem(NEEDLE, ...) — tool first — opens `leather_crafting` (main modal 2311),
     * then a plain **IF_BUTTON** on the product's make component (these are ordinary [if_button,...]
     * triggers, unlike skill_multiN). @craft_leather starts with if_close, so a successful click CLOSES
     * the modal: that IF_CLOSE is the acknowledgement, and the next batch must re-open it.
     *
     * ⛔ THE LABEL LIES ON leather_chaps. leather.rs2:17-19 binds all three chaps buttons to
     * `@craft_leather(leather_chaps, 1)`, so "Make 5 pairs" and "Make 10 pairs" each make ONE (proven
     * live). The table marks that row `brokenCounts`, and this loops make-1 for it instead.
     * ⛔ hard_leather has no interface at all — one body per useItemOnItem, synchronously.
     * THREAD: one reel per 5 products, from a var that PERSISTS across sessions.
     */
    async craftLeather(product = 'leather_gloves', opts: { count?: number; timeoutTicks?: number } = {}): Promise<CraftLeatherResult> {
        const needleSlot = this.invSlotOf(NEEDLE);
        if (needleSlot < 0) return { success: false, message: 'No needle in inventory', reason: 'no_needle' };
        const p = this.leatherProduct(product);
        if (!p) {
            return {
                success: false, reason: 'unknown_product',
                message: `unknown leather product "${product}" — known: ${LEATHER_PRODUCTS.map(x => x.product).join(', ')}, hardleather_body`,
            };
        }
        if (this.invSlotOf(p.leatherObj) < 0) return { success: false, message: `No ${p.leather} in inventory`, reason: 'no_leather' };
        if (this.invSlotOf(THREAD) < 0) return { success: false, message: SKILL_MES.leather.noThread, reason: 'no_thread' };
        if (p.level > (this.statLevel[12] ?? 1)) {   // PlayerStat.CRAFTING
            return { success: false, message: `Crafting ${p.level} needed for ${p.product}`, reason: 'level_too_low' };
        }

        const want = Math.max(1, Math.floor(opts.count ?? 1));
        const timeout = opts.timeoutTicks ?? this.skillTimeoutTicks;
        const t0 = this.tickCount;
        const xpB4 = this.statXp[12] ?? 0;
        const madeB4 = this.countInInv(p.productObj);

        // The hard_leather branch never opens an interface: one body per send.
        if (p === HARD_LEATHER) {
            for (let i = 0; i < want; i++) {
                const hSlot = this.invSlotOf(HARD_LEATHER_OBJ);
                if (hSlot < 0) break;
                const before = this.countInInv(p.productObj);
                this.useItemOnItem(NEEDLE, this.invSlotOf(NEEDLE), HARD_LEATHER_OBJ, hSlot);
                if (!await this.awaitTicks(() => this.countInInv(p.productObj) > before, timeout)) break;
            }
        } else {
            let remaining = want;
            let rounds = 0;
            while (remaining > 0 && rounds++ < want + 4) {
                const leatherSlot = this.invSlotOf(p.leatherObj);
                if (leatherSlot < 0) break;
                if (this.mainModalId !== LEATHER_CRAFTING.ROOT) {
                    this.useItemOnItem(NEEDLE, this.invSlotOf(NEEDLE), p.leatherObj, leatherSlot);
                    if (!await this.awaitTicks(() => this.mainModalId === LEATHER_CRAFTING.ROOT, 15)) {
                        if (this.countInInv(p.productObj) > madeB4) break;
                        return {
                            success: false, reason: 'interface_not_opened', itemsCrafted: this.countInInv(p.productObj) - madeB4,
                            message: `leather_crafting (${LEATHER_CRAFTING.ROOT}) never opened — mainModalId=${this.mainModalId}. ` +
                                `THREAD IS CHECKED FIRST: with no thread you get an objbox and no modal.`,
                        };
                    }
                }
                // brokenCounts rows only ever make ONE per click whatever the label says.
                const step = p.brokenCounts ? 1 : ([10, 5, 1].find(n => n <= remaining && p.buttons[n] !== undefined) ?? 1);
                const before = this.countInInv(p.productObj);
                this.ifButton(p.buttons[step] ?? p.bindings[0]!.com);
                await this.awaitTicks(
                    () => this.countInInv(p.productObj) >= before + step
                        || this.sawMsg(t0, SKILL_MES.leather.noThread)
                        || this.sawMsg(t0, SKILL_MES.leather.outOfPrefix),
                    timeout + step * 3);
                const got = this.countInInv(p.productObj) - before;
                if (got <= 0) break;
                remaining -= got;
            }
        }

        const crafted = this.countInInv(p.productObj) - madeB4;
        const xpGained = (this.statXp[12] ?? 0) - xpB4;
        if (crafted > 0) {
            return {
                success: true, xpGained, itemsCrafted: crafted, product: this.skillItem(p.productObj),
                message: `Crafted ${crafted} ${p.product}${crafted < want ? ` of ${want} requested` : ''}`,
            };
        }
        if (this.sawMsg(t0, SKILL_MES.leather.noThread)) return { success: false, message: SKILL_MES.leather.noThread, reason: 'no_thread' };
        return { success: false, xpGained, itemsCrafted: 0, reason: 'timeout', message: `No ${p.product} appeared (msgs: ${this.skillMsgs(t0).join(' | ')})` };
    }

    /** Find a jewelry row + slot by product name ('gold_ring', 'ruby amulet', 'sapphire_necklace'). */
    private jewelrySlotFor(product: string): { row: JewelryRow; slot: JewelrySlot } | null {
        const want = product.toLowerCase().replace(/[\s_]+/g, '');
        for (const row of JEWELRY_ROWS) {
            for (const s of row.slots) {
                if (s.product.toLowerCase().replace(/[\s_]+/g, '') === want) return { row, slot: s };
            }
        }
        for (const row of JEWELRY_ROWS) {
            for (const s of row.slots) {
                if (s.product.toLowerCase().replace(/[\s_]+/g, '').includes(want)) return { row, slot: s };
            }
        }
        return null;
    }

    /**
     * Make gold jewelry at a furnace. SDK parity: `craftJewelry(...)`.
     *
     * PACKET: useItemOnLoc(furnace, GOLD_BAR) opens `crafting_jewelry` (main modal 4161), then
     * **INV_BUTTON** (op 1/2/3 = make 1/5/10) on the row's component.
     *
     * ⛔ THIS IS AN INV COMPONENT, NOT A BUTTON GRID. The three rows are type=inv components fed by
     * inv_transmit from dummy invs, so IF_BUTTON is silently wrong — InvButtonHandler validates
     * inv.hasAt(slot, obj), which is why the obj id comes from the table and the row's transmitted inv
     * is CHECKED before clicking (proven live: only the row whose mould you hold is transmitted).
     * ⛔ PERFECT BARS PRE-EMPT and SUPPRESS the "You make ..." message — success is counted, never read.
     */
    async craftJewelry(product = 'gold_ring', opts: { count?: number; furnace?: { x: number; z: number; id: number; width?: number; length?: number; angle?: number }; radius?: number; timeoutTicks?: number; approach?: boolean } = {}): Promise<CraftJewelryResult> {
        const pick = this.jewelrySlotFor(product);
        if (!pick) {
            return {
                success: false, reason: 'unknown_product',
                message: `unknown jewelry product "${product}" — known: ${JEWELRY_ROWS.flatMap(r => r.slots.map(s => s.product)).join(', ')}`,
            };
        }
        const { row, slot } = pick;
        const mould = JEWELRY_MOULDS[row.group.replace(/s$/, '')];
        if (mould && this.invSlotOf(mould.obj) < 0) {
            return { success: false, message: `No ${mould.name} — without it the whole ${row.group} row is hidden and never transmitted`, reason: 'no_mould' };
        }
        // crafting_gold prefers a perfect bar when you hold one; send whichever we actually have.
        const barObj = this.invSlotOf(GOLD_BAR) >= 0 ? GOLD_BAR : (this.invSlotOf(PERFECT_GOLD_BAR) >= 0 ? PERFECT_GOLD_BAR : -1);
        if (barObj < 0) return { success: false, message: 'No gold bar in inventory', reason: 'no_bar' };
        if (slot.gemObj !== null && this.invSlotOf(slot.gemObj) < 0) {
            return { success: false, message: `No ${slot.gem} — slot ${slot.slot} is only stocked while you hold the gem`, reason: 'no_gem' };
        }
        if (slot.level > (this.statLevel[12] ?? 1)) {
            return { success: false, message: `Crafting ${slot.level} needed for ${slot.product}`, reason: 'level_too_low' };
        }

        const furnace = opts.furnace ?? this.findNearbyLoc(/^furnace$/i, opts.radius ?? 8);
        if (!furnace) return { success: false, message: `No furnace within ${opts.radius ?? 8} tiles`, reason: 'no_furnace' };
        // OPLOCU does not self-route either (see approachLoc). A 3x3 furnace also carries forceapproach,
        // so only ONE side actually works — walking to the nearest side is strictly better than standing
        // out of reach, but a caller that knows the operable tile should stand on it and pass approach:false.
        if (opts.approach !== false) await this.approachLoc(furnace as { x: number; z: number; width?: number; length?: number; angle?: number });

        const want = Math.max(1, Math.floor(opts.count ?? 1));
        const timeout = opts.timeoutTicks ?? this.skillTimeoutTicks;
        const t0 = this.tickCount;
        const xpB4 = this.statXp[12] ?? 0;
        const madeB4 = this.countInInv(slot.productObj);

        let remaining = want, rounds = 0;
        while (remaining > 0 && rounds++ < want + 4) {
            if (this.invSlotOf(barObj) < 0) break;
            if (this.mainModalId !== JEWELRY.ROOT) {
                this.useItemOnLoc(furnace.x, furnace.z, furnace.id, barObj, this.invSlotOf(barObj));
                if (!await this.awaitTicks(() => this.mainModalId === JEWELRY.ROOT, 20)) {
                    if (this.countInInv(slot.productObj) > madeB4) break;
                    return {
                        success: false, reason: 'interface_not_opened', itemsCrafted: this.countInInv(slot.productObj) - madeB4,
                        message: `crafting_jewelry (${JEWELRY.ROOT}) never opened — mainModalId=${this.mainModalId}. ` +
                            `OPLOCU self-routes naively: stand on the furnace's operable side first.`,
                    };
                }
            }
            // ⛔ WAIT FOR THE ROW'S OWN UPDATE_INV, do not test for it once. IF_OPENMAIN and the
            // inv_transmit arrive in the SAME server batch, but the modal packet is written during
            // processPlayers and the inv during processClientsOut — so a check that runs the instant the
            // modal opens can legitimately see no inv yet and would call a healthy furnace broken.
            const rowReady = () => { const d = this.invs.get(row.com); return !!d && d.ids[slot.slot] === slot.slotObjId; };
            if (!await this.awaitTicks(rowReady, 10)) {
                const dummy = this.invs.get(row.com);
                return {
                    success: false, reason: 'row_not_transmitted', itemsCrafted: this.countInInv(slot.productObj) - madeB4,
                    message: `dummy inv com ${row.com} slot ${slot.slot} does not hold ${slot.slotObj} (${slot.slotObjId}) — ` +
                        `InvButtonHandler validates hasAt(slot, obj), so the click would be dropped. got=${dummy ? dummy.ids[slot.slot] : 'no UPDATE_INV'}`,
                };
            }
            const step = [10, 5, 1].find(n => n <= remaining && row.buttons[n] !== undefined) ?? 1;
            const before = this.countInInv(slot.productObj);
            this.invButton(row.buttons[step]!, slot.slotObjId, slot.slot, row.com);
            await this.awaitTicks(
                () => this.countInInv(slot.productObj) >= before + step
                    || this.sawMsg(t0, SKILL_MES.jewelry.noBars) || this.sawMsg(t0, SKILL_MES.jewelry.noMould),
                timeout + step * 4);
            const got = this.countInInv(slot.productObj) - before;
            if (got <= 0) break;
            remaining -= got;
        }

        const crafted = this.countInInv(slot.productObj) - madeB4;
        const xpGained = (this.statXp[12] ?? 0) - xpB4;
        if (crafted > 0) {
            return {
                success: true, xpGained, itemsCrafted: crafted, product: this.skillItem(slot.productObj),
                message: `Made ${crafted} ${slot.product}${crafted < want ? ` of ${want} requested` : ''}`,
            };
        }
        if (this.sawMsg(t0, SKILL_MES.jewelry.noMould)) return { success: false, message: SKILL_MES.jewelry.noMould, reason: 'no_mould' };
        if (this.sawMsg(t0, SKILL_MES.jewelry.noBars)) return { success: false, message: SKILL_MES.jewelry.noBars, reason: 'no_bar' };
        return { success: false, xpGained, itemsCrafted: 0, reason: 'timeout', message: `No ${slot.product} appeared (msgs: ${this.skillMsgs(t0).join(' | ')})` };
    }

    /**
     * Cast an enchant spell on a ring/necklace/amulet. SDK parity: `enchantItem(...)`.
     *
     * PACKET: opHeldT(targetObj, targetSlot, spell.com) — the same primitive as high-alch. One cast.
     *
     * ⛔ THE SPELL ICON'S GREY-OUT IS CLIENT-ONLY: magic.if gates each icon with script1..3, but
     * OpHeldTHandler only checks actiontarget=heldobj and that the magic tab is open. So this fires
     * unconditionally and READS THE REFUSAL — a real headless advantage over the SDK's icon-state
     * modelling, and the reason a missing rune comes back as reason:'no_runes' rather than a hang.
     * ⛔ THE ITEM IS REPLACED IN PLACE (inv_setslot) — the occupied-slot count NEVER moves, so success
     * is detected from the SLOT'S OBJ ID, never from a count.
     */
    async enchantItem(target?: number | string | RegExp, opts: { timeoutTicks?: number } = {}): Promise<EnchantResult> {
        let obj = -1;
        if (typeof target === 'number') {
            obj = target;
        } else if (target !== undefined) {
            const re = typeof target === 'string' ? new RegExp(target.replace(/[\s_]+/g, '[\\s_]*'), 'i') : target;
            for (const s of ENCHANT_SPELLS) {
                for (const c of s.conversions) { re.lastIndex = 0; if (re.test(c.from) && this.invSlotOf(c.fromObj) >= 0) { obj = c.fromObj; break; } }
                if (obj >= 0) break;
            }
        } else {
            const inv = this.invForInventory();
            if (inv) for (let i = 0; i < inv.ids.length; i++) if (ENCHANT_BY_TARGET.has(inv.ids[i]!)) { obj = inv.ids[i]!; break; }
        }
        if (obj < 0) return { success: false, message: 'No enchantable item in inventory', reason: 'item_not_found' };

        const hit = ENCHANT_BY_TARGET.get(obj);
        if (!hit) return { success: false, message: `obj ${obj} (${this.objLabel(obj)}) is not enchantable by any tier`, reason: 'not_enchantable' };
        const slot = this.invSlotOf(obj);
        if (slot < 0) return { success: false, message: `${hit.result.from} is not in the backpack`, reason: 'item_not_found' };

        const t0 = this.tickCount;
        const xpB4 = this.statXp[6] ?? 0;    // PlayerStat.MAGIC
        this.opHeldT(obj, slot, hit.spell.com);

        const slotIs = (want: number): boolean => (this.invForInventory()?.ids[slot] ?? -1) === want;
        await this.awaitTicks(
            () => slotIs(hit.result.toObj) || (this.statXp[6] ?? 0) > xpB4
                || this.sawMsg(t0, SKILL_MES.enchant.lowLevel) || this.sawMsg(t0, SKILL_MES.enchant.noRunesPrefix)
                || this.sawMsg(t0, SKILL_MES.enchant.membersSpell) || this.sawMsg(t0, hit.spell.wrongTargetMessage),
            opts.timeoutTicks ?? this.skillTimeoutTicks);

        if (slotIs(hit.result.toObj) || this.countInInv(hit.result.toObj) > 0) {
            return {
                success: true, xpGained: (this.statXp[6] ?? 0) - xpB4, product: this.skillItem(hit.result.toObj),
                message: `Enchanted ${hit.result.from} -> ${hit.result.to} (enchant_lvl${hit.spell.tier}, slot ${slot} replaced in place)`,
            };
        }
        if (this.sawMsg(t0, SKILL_MES.enchant.noRunesPrefix)) return { success: false, message: this.skillMsgs(t0).find(m => m.startsWith(SKILL_MES.enchant.noRunesPrefix)) ?? 'Not enough runes', reason: 'no_runes' };
        if (this.sawMsg(t0, SKILL_MES.enchant.lowLevel)) return { success: false, message: SKILL_MES.enchant.lowLevel, reason: 'level_too_low' };
        if (this.sawMsg(t0, SKILL_MES.enchant.membersSpell)) return { success: false, message: SKILL_MES.enchant.membersSpell, reason: 'members' };
        if (this.sawMsg(t0, hit.spell.wrongTargetMessage)) return { success: false, message: hit.spell.wrongTargetMessage, reason: 'wrong_target' };
        return { success: false, reason: 'timeout', message: `Slot ${slot} still holds ${this.invForInventory()?.ids[slot]} (msgs: ${this.skillMsgs(t0).join(' | ')})` };
    }

    /**
     * Put a ball of wool on an unstrung amulet / holy symbol. SDK parity: `stringAmulet(...)`.
     *
     * PACKET: useItemOnItem(BALL_OF_WOOL, ...) — tool first. ONE amulet per send, synchronous, no
     * interface and no queue, so `count` is just a loop.
     *
     * ⛔ NO LEVEL CHECK AND NO XP TABLE: string_amulet hard-codes stat_advance(crafting, 40) for every
     * amulet and never reads levelrequired. The table's `level` is the level to CRAFT the unstrung
     * piece, kept for planning only — it is NOT enforced here, and enforcing it would refuse work the
     * server would happily do.
     */
    async stringAmulet(target?: number | string | RegExp, opts: { count?: number; timeoutTicks?: number } = {}): Promise<StringAmuletResult> {
        const woolSlot = this.invSlotOf(BALL_OF_WOOL);
        if (woolSlot < 0) return { success: false, message: 'No ball of wool in inventory', reason: 'no_string' };

        let unstrung = -1;
        if (typeof target === 'number') {
            unstrung = target;
        } else if (target !== undefined) {
            const re = typeof target === 'string' ? new RegExp(target.replace(/[\s_]+/g, '[\\s_]*'), 'i') : target;
            for (const s of STRINGABLE) { re.lastIndex = 0; if ((re.test(s.unstrung) || re.test(s.strung)) && this.invSlotOf(s.unstrungObj) >= 0) { unstrung = s.unstrungObj; break; } }
        } else {
            for (const s of STRINGABLE) if (this.invSlotOf(s.unstrungObj) >= 0) { unstrung = s.unstrungObj; break; }
        }
        if (unstrung < 0) return { success: false, message: 'No unstrung amulet in inventory', reason: 'no_amulet' };
        const entry = STRINGABLE_BY_OBJ.get(unstrung);
        if (!entry) return { success: false, message: `obj ${unstrung} (${this.objLabel(unstrung)}) is not stringable`, reason: 'unknown_product' };

        const want = Math.max(1, Math.floor(opts.count ?? 1));
        const timeout = opts.timeoutTicks ?? this.skillTimeoutTicks;
        const t0 = this.tickCount;
        const xpB4 = this.statXp[12] ?? 0;
        const madeB4 = this.countInInv(entry.strungObj);

        for (let i = 0; i < want; i++) {
            const uSlot = this.invSlotOf(unstrung), wSlot = this.invSlotOf(BALL_OF_WOOL);
            if (uSlot < 0 || wSlot < 0) break;
            const before = this.countInInv(entry.strungObj);
            this.useItemOnItem(BALL_OF_WOOL, wSlot, unstrung, uSlot);
            if (!await this.awaitTicks(() => this.countInInv(entry.strungObj) > before, timeout)) break;
        }

        const made = this.countInInv(entry.strungObj) - madeB4;
        const xpGained = (this.statXp[12] ?? 0) - xpB4;
        if (made > 0) {
            return {
                success: true, xpGained, itemsMade: made, product: this.skillItem(entry.strungObj),
                message: `Strung ${made} ${entry.stringingName}${made < want ? ` of ${want} requested` : ''}`,
            };
        }
        return { success: false, xpGained, itemsMade: 0, reason: 'timeout', message: `No ${entry.strung} appeared (msgs: ${this.skillMsgs(t0).join(' | ')})` };
    }

    // =================================================================================================
    // VERIFIED INTERACTIONS (parity package 3) — the typed half
    // =================================================================================================
    // ⛔ EVERY METHOD HERE IS NEW AND OPT-IN. The primitives they wrap are untouched, so a brain that
    // keeps calling `opNpc(idx, 3)` behaves EXACTLY as before.
    //
    // Each one follows the same three-step shape:
    //   1. read the intent's own observable baseline (coins, xp, worn, ground item, ...);
    //   2. send ONE packet through the existing primitive (which arms the ack ledger);
    //   3. wait for either the intent's observable OR the ledger's verdict, and report BOTH — the
    //      intent decides success, the ledger decides WHY on failure.
    // Step 3 is why `no_ack` is a first-class reason: without the ledger, "no coins appeared" and "the
    // packet was discarded" are the same timeout, and telling them apart is the whole package.

    /** Ticks a verified interaction waits beyond its ack deadline before calling it a timeout. */
    ackWaitSlack = Number(process.env.FB_ACK_SLACK ?? 4);

    /**
     * Wait for `kind`'s ack window to settle and report how it closed.
     *
     * Returns 'none' when the ledger is disabled (`FB_ACK_ASSERT=0`) or never armed — callers must
     * therefore treat 'none' as "no opinion" and fall back to their own observable, never as failure.
     */
    protected async settleAck(kind: AckKind, sentTick: number, extraTicks = 0): Promise<AckVerdict | 'none'> {
        if (!ACK_ENABLED) return 'none';
        const limit = ackSpec(kind).ticks + this.ackWaitSlack + extraTicks;
        await this.awaitTicks(() => !this.ack.isActive(kind), limit);
        const v = this.ack.verdictOf(kind, sentTick);
        return v === 'pending' ? 'none' : v;
    }

    /** Map an ack verdict onto the shared reason vocabulary. 'ack' means the send landed — the caller's
     *  own observable is then what decides success, so this returns undefined for it. */
    private ackReason(v: AckVerdict | 'none' | 'pending'): AckFailReason | undefined {
        return v === 'no_ack' ? 'no_ack' : v === 'refused' ? 'refused' : v === 'unknown' ? 'unknown' : undefined;
    }

    /** A human tail for a failure message that names WHICH diagnosis the ledger reached. */
    private ackTail(v: AckVerdict | 'none' | 'pending', kind: AckKind): string {
        if (v === 'no_ack') {
            return ` — ACK-NOACK-${ACK_KIND_NAME[kind]}: the server never answered (no message, no state ` +
                `change). The op was DISCARDED, not refused; retrying will not fix it.`;
        }
        if (v === 'refused') return ` — the server REFUSED it: "${this.ack.lastRefusalText}"`;
        if (v === 'unknown') return ` — ACK-UNKNOWN-${ACK_KIND_NAME[kind]}: the container this depends on was never transmitted.`;
        return '';
    }

    /**
     * Attack an npc and report whether the swing actually connected with the SERVER. SDK parity:
     * `attackNpc(target)`.
     *
     * ⛔ THE OBSERVABLE IS A HITSPLAT OR AN HP-XP GRANT, NEVER "we sent OPNPC2". The case that
     * motivated this package was 50 sends, 0 damage and no message, inside a bot that looked perfectly
     * healthy. `damageDealt` is read off the target's own hitsplat ledger.
     *
     * `npc_busy` is a REAL and NORMAL outcome when several players fight the same npcs — combat is a
     * fixed pie via an 8-tick npc lock — so it is reported separately from `no_ack`. Confusing the two
     * would make a healthy bot look broken every time it was merely contended.
     */
    async attackNpc(target: number | Set<number> | { index: number }, opts: { timeoutTicks?: number } = {}): Promise<AttackResult> {
        let index: number;
        let npc: LeanNpc | null = null;
        if (typeof target === 'object' && 'index' in target) {
            index = target.index;
            npc = this.npcs[index] ?? null;
        } else {
            const want = typeof target === 'number' ? new Set([target]) : target;
            const found = this.findNearestNpc(n => want.has(n.typeId));
            if (!found) return { success: false, reason: 'npc_not_found', message: 'No matching npc in view' };
            index = found.index;
            npc = found.npc;
        }
        if (!npc) return { success: false, reason: 'npc_not_found', message: `npc index ${index} is not in view` };

        const t0 = this.tickCount;
        const hitsB4 = npc.hitCount;
        const hpXpB4 = this.statXp[HP_STAT] ?? 0;
        this.opNpc(index, 2);

        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.Attack).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => (this.npcs[index]?.hitCount ?? hitsB4) > hitsB4
            || (this.statXp[HP_STAT] ?? 0) > hpXpB4
            || this.npcs[index] === null || this.npcs[index] === undefined
            || !this.ack.isActive(AckKind.Attack), limit);

        const now = this.npcs[index];
        const landed = (now?.hitCount ?? hitsB4) - hitsB4;
        // `lastDamage` is the most recent hitsplat value — the decoder keeps one splat, not a running
        // total, so this is honestly reported as the LAST hit rather than a sum we never observed.
        const dmg = landed > 0 ? Math.max(0, now?.lastDamage ?? 0) : 0;
        if (landed > 0 || (this.statXp[HP_STAT] ?? 0) > hpXpB4) {
            return { success: true, damageDealt: dmg, killed: !now, message: `${landed} hitsplat(s), last ${dmg} damage on npc ${index}${now ? '' : ' — target gone (killed or despawned)'}` };
        }
        if (!now) return { success: false, reason: 'dead', message: `npc ${index} left the scene before a hit landed` };
        if (this.combatLockMsgs > 0 || this.underAttackMsgs > 0) {
            const v0 = this.ack.verdictOf(AckKind.Attack, t0);
            if (v0 === 'ack') return { success: false, reason: 'npc_busy', message: `npc ${index} is locked to another attacker (single-way combat)` };
        }
        const v = this.ack.verdictOf(AckKind.Attack, t0);
        if (v === 'refused') return { success: false, reason: 'refused', message: `Attack refused${this.ackTail('refused', AckKind.Attack)}` };
        if (v === 'no_ack') {
            return {
                success: false, reason: 'no_ack',
                message: `Attacked npc ${index} and NOTHING happened${this.ackTail('no_ack', AckKind.Attack)} ` +
                    `The classic cause is a MOVE_GAMECLICK sent before the op (interactions need MOVE_OPCLICK).`,
            };
        }
        if (v === 'unknown') return { success: false, reason: 'unknown', message: `Attack outcome undecidable${this.ackTail('unknown', AckKind.Attack)}` };
        return { success: false, reason: 'timeout', message: `No hitsplat on npc ${index} within ${limit} ticks (contended target, or out of reach)` };
    }

    /**
     * Take a ground item. SDK parity: `pickupItem(target)`.
     *
     * ⛔ OPOBJ SELF-ROUTES NAIVELY, like OPLOC — from out of reach the server answers "I can't reach
     * that!" (verdict 'refused'), which is a DIFFERENT and easier problem than a discarded op. Both are
     * reported by name so a loot loop can walk closer for one and stop retrying for the other.
     */
    async pickupItem(target: number | Set<number>, opts: { maxRange?: number; timeoutTicks?: number } = {}): Promise<PickupResult> {
        const g = this.findGroundItem(target, opts.maxRange ?? 12);
        if (!g) return { success: false, reason: 'item_not_found', message: 'No matching ground item in range' };
        if (this.freePackSlots() <= 0 && this.invSlotOf(g.obj) < 0) {
            return { success: false, reason: 'inventory_full', message: `Backpack full — ${this.objLabel(g.obj) || g.obj} would land on the floor` };
        }
        const t0 = this.tickCount;
        const before = this.countInInv(g.obj);
        this.opObj(g.x, g.z, g.obj, 3);

        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.Pickup).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => this.countInInv(g.obj) > before || !this.ack.isActive(AckKind.Pickup), limit);

        if (this.countInInv(g.obj) > before) {
            return { success: true, item: this.skillItem(g.obj), message: `Took ${this.objLabel(g.obj) || g.obj} at (${g.x},${g.z})` };
        }
        const v = this.ack.verdictOf(AckKind.Pickup, t0);
        if (v === 'refused') {
            const txt = this.ack.lastRefusalText;
            const reason: PickupResult['reason'] = /reach/i.test(txt) ? 'cant_reach' : /inventory|space/i.test(txt) ? 'inventory_full' : 'refused';
            return { success: false, reason, message: `Pickup refused at (${g.x},${g.z}): "${txt}"` };
        }
        if (v === 'no_ack') return { success: false, reason: 'no_ack', message: `OPOBJ at (${g.x},${g.z}) produced nothing${this.ackTail('no_ack', AckKind.Pickup)}` };
        if (v === 'unknown') return { success: false, reason: 'unknown', message: `Pickup outcome undecidable${this.ackTail('unknown', AckKind.Pickup)}` };
        return { success: false, reason: 'timeout', message: `${this.objLabel(g.obj) || g.obj} never entered the backpack within ${limit} ticks` };
    }

    /**
     * Operate a loc by NAME and confirm the server acted. SDK parity: `interactLoc(target, option?)`.
     *
     * ⛔ WALKS FIRST BY DEFAULT. OPLOC does not self-route — measured, not assumed: from 5 tiles the
     * engine answers "I can't reach that!" every tick and the player never takes a step.
     */
    async interactLoc(pattern: string | RegExp, option: number | string | RegExp = 1,
        opts: { radius?: number; approach?: boolean; timeoutTicks?: number } = {}): Promise<LocInteractResult> {
        const loc = this.findNearbyLoc(pattern, opts.radius ?? 15);
        if (!loc) return { success: false, reason: 'loc_not_found', message: `No loc matching ${pattern} within ${opts.radius ?? 15} tiles` };
        if (opts.approach !== false) await this.approachLoc(loc);
        const t0 = this.tickCount;
        const sent = this.opLocByName(pattern, option, opts.radius ?? 15);
        if (!sent) return { success: false, reason: 'no_such_option', message: `${loc.name} has no option matching ${option} (has: ${loc.options.join(', ')})` };

        const v = await this.settleAck(AckKind.OpLoc, t0, opts.timeoutTicks ?? 0);
        if (v === 'ack' || v === 'none') return { success: true, message: `Operated ${sent.name}@(${sent.x},${sent.z}) op ${option}` };
        if (v === 'refused') {
            const txt = this.ack.lastRefusalText;
            return { success: false, reason: /reach/i.test(txt) ? 'cant_reach' : 'refused', message: `${sent.name}@(${sent.x},${sent.z}): "${txt}"` };
        }
        return {
            success: false, reason: this.ackReason(v) ?? 'timeout',
            message: `OPLOC on ${sent.name}@(${sent.x},${sent.z})${this.ackTail(v, AckKind.OpLoc)}`,
        };
    }

    /**
     * Open a door/gate and confirm the SERVER swung it. SDK parity: `openDoor(target?)`.
     *
     * ⛔ NEVER OP AN ALREADY-OPEN DOOR: op1 on an open door is CLOSE. The door tracker is the
     * authoritative live open/closed state (it reads the server's own LOC_DEL / LOC_ADD_CHANGE zone
     * stream), so this asks it first and reports `alreadyOpen` rather than helpfully shutting the door
     * the caller wanted to walk through — the stateless-door bug class this repo already paid for.
     *
     * The observable is a LOC change in the zone, which is exactly what a swinging door emits.
     */
    async openDoor(at?: { x: number; z: number; locId: number; op?: number },
        opts: { radius?: number; timeoutTicks?: number } = {}): Promise<DoorResult> {
        let target = at;
        if (!target) {
            const me = this.playerTile();
            const near = this.doorTracker?.nearestClosed(this.travelLevel, me.x, me.z, opts.radius ?? 2);
            if (!near) return { success: false, reason: 'not_found', message: `No closed door within ${opts.radius ?? 2} tiles (door tracker)` };
            target = { x: near.x, z: near.z, locId: near.locId, op: near.op };
        }
        if (this.doorTracker?.isOpen(this.travelLevel, target.x, target.z) === true) {
            return { success: true, alreadyOpen: true, message: `Door at (${target.x},${target.z}) is ALREADY open — op1 would have CLOSED it` };
        }
        const t0 = this.tickCount;
        this.opLoc(target.x, target.z, target.locId, target.op ?? 1);
        this.expectAck(AckKind.OpenDoor, target.locId, target.x * 16384 + target.z);

        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.OpenDoor).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => this.doorTracker?.isOpen(this.travelLevel, target!.x, target!.z) === true
            || !this.ack.isActive(AckKind.OpenDoor), limit);

        if (this.doorTracker?.isOpen(this.travelLevel, target.x, target.z) === true) {
            return { success: true, message: `Opened the door at (${target.x},${target.z})` };
        }
        const v = this.ack.verdictOf(AckKind.OpenDoor, t0);
        if (v === 'refused') {
            const txt = this.ack.lastRefusalText;
            return { success: false, reason: /reach/i.test(txt) ? 'cant_reach' : 'refused', message: `Door at (${target.x},${target.z}): "${txt}"` };
        }
        // 'ack' without a tracked open means the zone moved but this tile did not — honest UNKNOWN, not
        // a claimed success: without a door tracker attached there is no way to know either way.
        if (v === 'ack' && !this.doorTracker) {
            return { success: false, reason: 'unknown', message: `The server responded, but no DoorTracker is attached so the door's state cannot be read` };
        }
        return {
            success: false, reason: this.ackReason(v) ?? 'timeout',
            message: `Door at (${target.x},${target.z}) did not swing${this.ackTail(v, AckKind.OpenDoor)}`,
        };
    }

    /**
     * Equip an item and confirm the SERVER moved it into the worn container. SDK parity: `equipItem`.
     *
     * ⛔ WORN, NOT SENT. `tryEquipGear` already learned this the hard way (a wear can be refused for
     * reasons the gear table cannot see — quest gates, a missing iop2 — and the refusal is silent).
     */
    async equipItem(obj: number, opts: { timeoutTicks?: number } = {}): Promise<EquipResult> {
        const slot = this.invSlotOf(obj);
        if (slot < 0) {
            if (this.isWorn(obj)) return { success: true, message: `${this.objLabel(obj) || obj} is already worn` };
            return { success: false, reason: 'not_held', message: `${this.objLabel(obj) || obj} is not in the backpack` };
        }
        const t0 = this.tickCount;
        this.opHeld2(obj, slot);
        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.Equip).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => this.isWorn(obj) || !this.ack.isActive(AckKind.Equip), limit);
        if (this.isWorn(obj)) return { success: true, message: `Equipped ${this.objLabel(obj) || obj}` };
        const v = this.ack.verdictOf(AckKind.Equip, t0);
        if (v === 'refused') {
            const txt = this.ack.lastRefusalText;
            return { success: false, reason: /level|need/i.test(txt) ? 'level_too_low' : 'refused', message: `Wear refused: "${txt}"` };
        }
        return {
            success: false, reason: this.ackReason(v) ?? 'timeout',
            message: `${this.objLabel(obj) || obj} never entered the worn container${this.ackTail(v, AckKind.Equip)}`,
        };
    }

    /** Remove a worn item and confirm the worn container LOST it. SDK name `unequipItem` is already
     *  taken by the long-standing synchronous boolean form, which callers depend on — renaming it would
     *  break `if (bot.unequipItem(x))` into an always-true test, so the verified form is suffixed. */
    async unequipItemVerified(obj: number, opts: { timeoutTicks?: number } = {}): Promise<EquipResult> {
        if (!this.isWorn(obj)) return { success: false, reason: 'not_worn', message: `${this.objLabel(obj) || obj} is not worn` };
        const t0 = this.tickCount;
        this.unequipItem(obj);
        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.Unequip).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => !this.isWorn(obj) || !this.ack.isActive(AckKind.Unequip), limit);
        if (!this.isWorn(obj)) return { success: true, message: `Removed ${this.objLabel(obj) || obj}` };
        const v = this.ack.verdictOf(AckKind.Unequip, t0);
        return {
            success: false, reason: this.ackReason(v) ?? 'timeout',
            message: `${this.objLabel(obj) || obj} is still worn${this.ackTail(v, AckKind.Unequip)}`,
        };
    }

    /**
     * Eat food and report the HP actually restored. SDK parity: `eatFood(target)`.
     *
     * The observable is the ITEM LEAVING THE PACK plus the hp readback — not the OPHELD1 send. A full-hp
     * eat still consumes the food, so `hpGained` can legitimately be 0 on a success.
     */
    async eatFood(obj?: number, opts: { timeoutTicks?: number } = {}): Promise<EatResult> {
        // `foodObj` is the brain's configured heal item (tryHeal's own source of truth) — reused rather
        // than a second food table, so a verified eat and the heal loop can never disagree about what
        // counts as food.
        const food = obj ?? this.foodObj;
        if (food < 0) return { success: false, hpGained: 0, reason: 'no_food', message: 'No known food in the backpack' };
        const slot = this.invSlotOf(food);
        if (slot < 0) return { success: false, hpGained: 0, reason: 'no_food', message: `${this.objLabel(food) || food} is not in the backpack` };

        const t0 = this.tickCount;
        const hpB4 = this.hp;
        const heldB4 = this.countInInv(food);
        this.opHeld1(food, slot);
        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.EatFood).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => this.countInInv(food) < heldB4 || !this.ack.isActive(AckKind.EatFood), limit);

        if (this.countInInv(food) < heldB4) {
            return { success: true, hpGained: Math.max(0, this.hp - hpB4), message: `Ate ${this.objLabel(food) || food} (${hpB4} -> ${this.hp} hp)` };
        }
        const v = this.ack.verdictOf(AckKind.EatFood, t0);
        return {
            success: false, hpGained: 0, reason: this.ackReason(v) ?? 'timeout',
            message: `${this.objLabel(food) || food} never left the backpack${this.ackTail(v, AckKind.EatFood)}`,
        };
    }

    /**
     * Deposit an item into an OPEN bank and report how much actually moved. SDK parity: `depositItem`.
     *
     * ⛔ `moved` IS READ FROM THE CONTAINERS, never from the click. This is the shop-counter bug
     * in a different window: a click-counting deposit reports success against a bank that refused, and
     * a counter that over-reports hides the failure behind healthy-looking work.
     */
    async depositItem(obj: number, opts: { bankSideInv?: number; timeoutTicks?: number } = {}): Promise<BankResult> {
        const side = opts.bankSideInv ?? 2006;                 // bank_side:inv — the backpack mirror
        if (this.mainModalId === -1) return { success: false, moved: 0, reason: 'bank_not_open', message: 'No bank window is open' };
        const inv = this.invs.get(side);
        if (!inv) return { success: false, moved: 0, reason: 'bank_not_open', message: `bank side inv ${side} has never been transmitted` };
        let slot = -1;
        for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj) { slot = i; break; }
        if (slot < 0) return { success: false, moved: 0, reason: 'not_held', message: `${this.objLabel(obj) || obj} is not in the backpack` };

        const t0 = this.tickCount;
        const heldB4 = this.countInInv(obj);
        this.invButton4(obj, slot, side);                      // @bank_deposit(last_slot, ^max_32bit_int)
        this.expectAck(AckKind.BankDeposit, obj, slot);
        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.BankDeposit).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => this.countInInv(obj) < heldB4 || !this.ack.isActive(AckKind.BankDeposit), limit);

        const moved = heldB4 - this.countInInv(obj);
        if (moved > 0) return { success: true, moved, message: `Deposited ${moved} ${this.objLabel(obj) || obj}` };
        const v = this.ack.verdictOf(AckKind.BankDeposit, t0);
        return {
            success: false, moved: 0, reason: this.ackReason(v) ?? 'timeout',
            message: `Nothing left the backpack${this.ackTail(v, AckKind.BankDeposit)}`,
        };
    }

    /** Withdraw-all of `obj` from an OPEN bank. SDK parity: `withdrawItem`. Same contract as
     *  `depositItem`: `moved` comes from the backpack delta, never from the click. */
    async withdrawItem(obj: number, opts: { bankMainInv?: number; timeoutTicks?: number } = {}): Promise<BankResult> {
        const main = opts.bankMainInv ?? 5382;                 // bank_main:inv — the bank itself
        if (this.mainModalId === -1) return { success: false, moved: 0, reason: 'bank_not_open', message: 'No bank window is open' };
        const bank = this.invs.get(main);
        if (!bank) return { success: false, moved: 0, reason: 'bank_not_open', message: `bank inv ${main} has never been transmitted` };
        let slot = -1;
        for (let i = 0; i < bank.ids.length; i++) if (bank.ids[i] === obj && bank.counts[i]! > 0) { slot = i; break; }
        if (slot < 0) return { success: false, moved: 0, reason: 'not_banked', message: `${this.objLabel(obj) || obj} is not in the bank` };

        const t0 = this.tickCount;
        const heldB4 = this.countInInv(obj);
        this.invButton4(obj, slot, main);                      // @bank_withdraw(last_slot, ^max_32bit_int)
        this.expectAck(AckKind.BankWithdraw, obj, slot);
        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.BankWithdraw).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => this.countInInv(obj) > heldB4 || !this.ack.isActive(AckKind.BankWithdraw), limit);

        const moved = this.countInInv(obj) - heldB4;
        if (moved > 0) return { success: true, moved, message: `Withdrew ${moved} ${this.objLabel(obj) || obj}` };
        const v = this.ack.verdictOf(AckKind.BankWithdraw, t0);
        return {
            success: false, moved: 0, reason: this.ackReason(v) ?? 'timeout',
            message: `Nothing entered the backpack${this.ackTail(v, AckKind.BankWithdraw)}`,
        };
    }

    /**
     * ONE routed step, verified. SDK parity: the step underneath `walkTo`.
     *
     * ⛔ MOVE_OPCLICK when `forOp` (the default), because the very next thing a caller does is
     * interact, and a MOVE_GAMECLICK before an interaction silently no-ops it — historical failure #1,
     * the one that produced 50 swings and 0 damage with no message at all.
     *
     * ⛔ NOT ARMED FROM `sendMove`. Brains send MOVE constantly while doing something else (fighting,
     * banking, waiting out a stun), and "we did not move this tick" is their normal state — arming the
     * primitive would false-positive constantly. The assertion belongs here, where the
     * caller has actually asked to be somewhere else.
     *
     * ⛔ NAMED `moveStep`, NOT `stepTo` OR `walkTo`. Both of those are ALREADY TAKEN by existing
     * subclasses with different signatures (`rc-rm-step1.ts:54` has `stepTo(idx, range)`;
     * other subclasses have a private `walkTo(x, z): boolean`). Adding either
     * name to the base class makes those files fail to typecheck — caught by the tsc gate, three errors
     * in `rc-rm-step1.ts`, on a file this package never touched. Compatibility outranks naming taste.
     */
    async moveStep(x: number, z: number, opts: { forOp?: boolean; timeoutTicks?: number } = {}): Promise<TravelStepResult> {
        const from = this.playerTile();
        if (from.x === x && from.z === z) return { success: true, tilesMoved: 0, message: `Already at (${x},${z})` };
        const t0 = this.tickCount;
        this.sendMove(x, z, opts.forOp !== false);
        this.expectAck(AckKind.MoveStep, x, z);
        const limit = opts.timeoutTicks ?? (ackSpec(AckKind.MoveStep).ticks + this.ackWaitSlack);
        await this.awaitTicks(() => {
            const p = this.playerTile();
            return (p.x === x && p.z === z) || !this.ack.isActive(AckKind.MoveStep);
        }, limit);

        const now = this.playerTile();
        const moved = Math.max(Math.abs(now.x - from.x), Math.abs(now.z - from.z));
        if (now.x === x && now.z === z) return { success: true, tilesMoved: moved, message: `Arrived at (${x},${z})` };
        const v = this.ack.verdictOf(AckKind.MoveStep, t0);
        if (v === 'no_ack') {
            return {
                success: false, tilesMoved: 0, reason: 'no_ack',
                message: `MOVE to (${x},${z}) from (${from.x},${from.z}) moved us NOWHERE${this.ackTail('no_ack', AckKind.MoveStep)} ` +
                    `The server never re-paths: every waypoint must be a legal 1-step move.`,
            };
        }
        return {
            success: moved > 0, tilesMoved: moved, reason: moved > 0 ? undefined : 'blocked',
            message: moved > 0
                ? `Moved ${moved} tile(s) toward (${x},${z}), now at (${now.x},${now.z})`
                : `Still at (${now.x},${now.z}) — the route's first step is not legal`,
        };
    }

    private status(): void {
        const ackNote = this.ack.summary();          // '' in steady state — computed once, not twice
        const me = this.playerTile();
        const phase = this.mainModalId === PLAYER_KIT_MODAL ? 'design'
            : this.chatModalId !== -1 ? 'dialog'
            : onTutorialIsland(me) ? 'tutorial-island'
            : (this.mode !== 'idle' && !this.arrived) ? 'travel'
            : this.mode;
        console.log(
            `[fb] t${this.tickCount} [${phase}] pos=(${me.x},${me.z}) coins=${this.coins()}` +
            ` hp=${this.hp}/${this.maxHp} deaths=${this.deathCount}` +
            // `summary()` is '' until something has actually gone wrong, so a healthy bot's status line
            // stays short.
            (ackNote ? ` ${ackNote}` : '') +
            (this.ackWedge ? ` ⛔${this.ackWedge}` : '')
        );
    }
}


export { LeanBot, LeanNpc };

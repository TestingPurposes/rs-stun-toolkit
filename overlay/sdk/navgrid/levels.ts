// MULTI-LEVEL / CROSS-STRATUM PLANNER — the navgrid upgrade: route between ANY (level, x, z), across
// upper floors and the underground, by KNOWING WHICH LADDER/STAIRCASE bridges the strata.
//
// Grounding (verified): the rsmod collision loaded by initPathfinding() is ALREADY fully
// multi-level (collision-data.json carries [level,x,z] for L0-L3 + the z+6400 underground; L0 843k,
// L1 147k, L2 59k, L3 20k tiles). `findLongPath(level, ...)` already routes any single stratum. The
// ONLY missing piece was the CONNECTIVITY GRAPH between strata — which lives in the ladder/stairs
// scripts as (op-loc coord) -> p_telejump(dest coord), both level-encoded. This module is that graph
// plus a two-tier planner: findLongPath WITHIN a stratum, portal edges BETWEEN strata.
//
// A route becomes a sequence of LEGS: walk `waypoints` (in the current stratum), then CLIMB `portal`
// (OPLOC the ladder -> land in the next stratum), repeat, until the final walk reaches the goal.
import { findLongPath, findPathToLoc, reachedLoc, initPathfinding } from '../pathfinding.js';
import { locDims, locForceApproach } from './locmeta.js';
import EXTRACTED from './portals.json';   // auto-extracted from the ladder/stairs scripts (extract-portals.mjs)
import SUSPECTS from './portal-suspects.json';   // validate-portals.ts --write: sealed/broken/no-loc entries
import { usableTeleports, type TeleportCaps, type TeleportDef } from './teleports.js';
// NAV PHASE 1: reachability gate + opt-in graph extensions (generic ladders, transports). All OFF unless
// PlanOpts / env opt in, so default plans are byte-identical. See learnings/navgrid-and-pathing.md.
import { minPortals, minPortalsTo, componentsNear, entranceComponents, exitComponents, cutOverride, setReachOverride, buildReach } from './reach.js';
import { getDoorAt, isTileWalkable, type DoorInfo } from '../pathfinding.js';
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

export interface Coord { level: number; x: number; z: number }
export interface Portal {
    x: number; z: number; level: number;          // the loc's ORIGIN tile (op target coords)
    dest: Coord;                                   // where you land (p_telejump target)
    locId?: number; op?: number;                   // OPLOC to climb (runtime); omitted = resolve in-scene
    altLocId?: number;                             // two-stage locs (trapdoor/manhole): the OPEN variant
    trust?: 'exact' | 'estimate';                  // exact = absolute script coord / live-proven;
    label?: string;                                // estimate = player-relative movecoord (off by 1-3)
    shape?: number; angle?: number;                // jm2 placement geometry (interaction-valid routing)
    dims?: { w: number; l: number };               // footprint (configs) — resolved once in allPortals
    // NAV PHASE 1 (opt-in graph only; no base portal carries these):
    stand?: { x: number; z: number };              // operate ONLY from this exact tile (player-relative dest = stand + delta)
    action?: PortalAction;                         // how to operate it when it is not a plain OPLOC op on locId
    req?: TransportReq;                            // what the bot must hold/have (transports.json); planner filters on it
    id?: string; risk?: string;
    phase?: number;                                // transports.json: 2/3 = NAV PHASE 2/3 row (graph 'v3' only)
    // TRAVEL NETWORK (phase 4): travel = a long-haul edge the planner also weighs against a WALK that works (planTravel);
    // cost = its planner cost in tiles (dialog + flight/sail ticks), default TRAVEL_COST_TILES.
    travel?: boolean; cost?: number;
}
// TELEPORT leg (teleports.ts): after walking `waypoints` (the planner emits a 1-waypoint "stand here"),
// CAST the spell (IF_BUTTON spellCom) or RUB the item (OPHELD4 on any of `items`, then click `choice`),
// then land within `scatter` of `dest`. Exactly one of portal/teleport is set on a non-final leg.
export interface TeleportLeg {
    id: string; label: string; kind: 'spell' | 'item';
    dest: Coord; scatter: number;
    spellCom?: number; items?: number[]; choice?: string;
    itemOp?: number;                               // OPHELD op of an item teleport (default 4 "Rub"; the enchanted lyre is 1 "Play")
}
export interface Leg { waypoints: Array<{ x: number; z: number }>; portal?: Portal; teleport?: TeleportLeg }
// TRANSPORT actions (transports.json). Executor: LeanBot.mlDrive -> mlOperatePortal.
//   useitem: OPLOCU `obj` on the loc (dusty-key gate).
//   npc: OPNPC `npcOp` on the nearest `npc` (dialogs are driven by the base option-1 driver); then = 'land' (the npc
//        moves you: ships) or 'oploc' (once a doneMsgs line is seen, OPLOC the loc as usual: Saniboch + the tree).
// NAV PHASE 2: npc `choose` = dialog option texts (regex, case-insensitive) clicked before the option-1 default while the
//   transport runs (Entrana's monk: option 1 is "No"); npc `doneItem` = the npc phase is over once the obj is held (the
//   Shantay pass); walkafter = OPLOC until a doneMsgs line, then walk to dest (a slashed web: OPLOCU `knife` if no slash
//   weapon is worn).
export type PortalAction = { kind: 'useitem'; obj: number }
    | { kind: 'npc'; npc: number; npcOp: number; then: 'land' | 'oploc'; doneMsgs?: string[]; choose?: string[]; doneItem?: number; ifModal?: number; ifButton?: number }
    | { kind: 'walkafter'; doneMsgs: string[]; knife?: number }
    | { kind: 'chain'; steps: ChainStep[]; choose?: string[] }
    | { kind: 'oploc'; choose: string[] };
// TRAVEL NETWORK: npc `ifModal`/`ifButton` = once the npc's dialog opens the main
// modal `ifModal` (glidermap 802), click IF_BUTTON `ifButton` (the destination: glidermap:com_21..25, gnome_glider.rs2:1-5).
// kind 'oploc' = a plain OPLOC on the row's loc whose script asks a p_choice (spirit trees: "Where can I go?" + the tree; the
// Ardougne lever's first-pull warning; the Zanaris ladder attendant): `choose` regexes clicked while it runs, like npc `choose`.
// NAV PHASE 3: kind 'chain' = several OPLOCs in a row, each from the tile the previous one left you on
// (stepping stones: 3 jumps over water tiles; the Kharazi jungle: chop a plant, land 2 tiles on, chop the next). The
// in-between tiles are BLOCKED (water, jungle), so the reach graph cannot hold them as separate stand portals: the
// whole chain is ONE edge stand -> dest. Executor: at a step's `from` tile OPLOC its loc; a fall that washes you off
// the chain (Shilo river: you land on the far bank) walks on to dest when that side is nearer, else back to the stand.
// chain `choose` = dialog option regexes clicked while it runs, like npc `choose` (the Karamja shipyard gate password).
export interface ChainStep { from: { x: number; z: number }; x: number; z: number; locId: number; op?: number }
// NAV PHASE 2 adds: quests (journal keys of quest-state.ts QUESTS, ALL must be complete), worn (ALL worn: the
// gas mask for the Plague City pipe), anyItems (ANY one held: a knife OR ...), banned (a named obj list the bot must hold
// NONE of, pack or worn: 'entrana' = the monks' search, port_sarim/monk_of_entrana.rs2:27-55), slash (a wielded slash
// weapon or a knife: general/scripts/slash_checker.rs2 + web.rs2).
// STARTED-GATED EDGES add questsStarted: journal keys that must be STARTED (journal row yellow OR green). For gates
// whose content check is `%var ! not_started` (Mort Myre gate quest_druidspirit.rs2:5, Waterfall raft quest_waterfall.rs2:154-156,
// troll rocks quest_troll.rs2:2 `< troll_started` where troll_started = 10 is the first value ever set). The journal colour
// is 0 -> red, >= complete -> green, else yellow (general/scripts/quests.rs2:5-13) on the SAME varp, so yellow|green == var > 0.
export interface TransportReq {
    items?: number[]; coins?: number; stats?: Record<string, number>; axe?: boolean;
    quests?: string[]; worn?: number[]; anyItems?: number[]; banned?: 'entrana'; slash?: boolean;
    questsStarted?: string[];
    // TRAVEL NETWORK: wilderness = the edge drops you deep in the Wilderness (Ardougne lever -> level 51, the KBD
    // lever): OPT-IN, only a caller with caps.wilderness === true gets it. members = the script refuses on a free world
    // (map_members: spirit trees, gliders, Zanaris); refused only when caps.members === false.
    wilderness?: boolean; members?: boolean;
}
/** What a bot can use. items = obj ids held (pack + worn); stats by skill name; hasAxe = any usable axe.
 *  NAV PHASE 2: quests = journal keys (quest-state.ts QUESTS) whose journal shows COMPLETE (LeanBot fills it from
 *  isQuestComplete; absent = none: a quest-gated edge never opens for a bot that did not declare the quest);
 *  worn = equipped obj ids (absent: `items` is used); canSlash = override of the slash test (else: a worn slash weapon
 *  from obj-tables.json, or a knife held).
 *  questsStarted = journal keys whose row is yellow OR green (IN_PROGRESS or COMPLETE). A key in `quests` counts as started
 *  too, so a caller that only fills `quests` keeps its old behaviour (a started-gated edge opens for a complete quest). */
export interface TransportCaps {
    items?: number[]; coins?: number; stats?: Record<string, number>; hasAxe?: boolean; deny?: string[];
    quests?: string[]; worn?: number[]; canSlash?: boolean; questsStarted?: string[];
    wilderness?: boolean; members?: boolean;   // TRAVEL NETWORK: opt into deep-Wilderness edges; false = a free world
}
let OBJT: { slash: number[]; entranaBanned: number[] } | null = null;
/** obj-tables.json (extract-obj-tables.ts): slash weapons + the Entrana ban list, both read from the obj configs. */
export function objTables(): { slash: Set<number>; entranaBanned: Set<number> } {
    const f = navDir() + 'obj-tables.json';
    OBJT ??= existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { slash: [], entranaBanned: [] };
    return (objTablesSets ??= { slash: new Set(OBJT!.slash), entranaBanned: new Set(OBJT!.entranaBanned) });
}
let objTablesSets: { slash: Set<number>; entranaBanned: Set<number> } | null = null;
export const KNIFE = 946;
export function canSlash(caps: TransportCaps): boolean {
    if (caps.canSlash !== undefined) return caps.canSlash;
    const t = objTables();
    return (caps.worn ?? []).some(o => t.slash.has(o)) || !!caps.items?.includes(KNIFE);   // worn unknown = not worn
}
export function transportUsable(t: Portal, caps: TransportCaps): boolean {
    if (t.id && caps.deny?.includes(t.id)) return false;
    const r = t.req;
    if (!r) return true;
    if (r.items && !r.items.every(o => caps.items?.includes(o))) return false;
    if (r.coins && (caps.coins ?? 0) < r.coins) return false;
    if (r.axe && !caps.hasAxe) return false;
    for (const [k, v] of Object.entries(r.stats ?? {})) if ((caps.stats?.[k] ?? 0) < v) return false;
    if (r.quests && !r.quests.every(q => caps.quests?.includes(q))) return false;
    if (r.questsStarted && !r.questsStarted.every(q => caps.questsStarted?.includes(q) || caps.quests?.includes(q))) return false;
    if (r.worn && !r.worn.every(o => (caps.worn ?? caps.items)?.includes(o))) return false;
    if (r.anyItems && !r.anyItems.some(o => caps.items?.includes(o))) return false;
    if (r.banned === 'entrana') { const ban = objTables().entranaBanned; if ((caps.items ?? []).some(o => ban.has(o)) || (caps.worn ?? []).some(o => ban.has(o))) return false; }
    if (r.slash && !canSlash(caps)) return false;
    if (r.wilderness && caps.wilderness !== true) return false;
    if (r.members && caps.members === false) return false;
    return true;
}
function navDir(): string { return fileURLToPath(new URL('.', import.meta.url)); }
let GENERIC: Portal[] | null = null;
/** generic-ladders.json (extract-generic-ladders.ts): player-relative ladders the base extractor cannot see. */
export function genericLadders(): Portal[] {
    if (GENERIC) return GENERIC;
    const f = navDir() + 'generic-ladders.json';
    const raw = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Portal[] : [];
    // a placement the base graph already models (any base portal on the same loc tile) stays the base's
    const base = new Set(allPortals().map(p => `${p.level},${p.x},${p.z}`));
    GENERIC = raw.filter(p => !base.has(`${p.level},${p.x},${p.z}`)).map(p => ({ ...p, dims: locDims(p.locId), forceApproach: locForceApproach(p.locId) }));
    return GENERIC;
}
let AREA: Portal[] | null = null;
/** area-portals.json (extract-area-portals.ts, NAV PHASE 2): unconditional area/quest-script teleports (caves, ropes, exits). */
export function areaPortals(): Portal[] {
    if (AREA) return AREA;
    const f = navDir() + 'area-portals.json';
    const raw = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Portal[] : [];
    const base = new Set(allPortals().map(p => `${p.level},${p.x},${p.z}`));
    AREA = raw.filter(p => !base.has(`${p.level},${p.x},${p.z}`)).map(p => ({ ...p, dims: locDims(p.locId), forceApproach: locForceApproach(p.locId) }));
    return AREA;
}
let TRANSPORTS: Portal[] | null = null;
export function allTransports(): Portal[] {
    if (TRANSPORTS) return TRANSPORTS;
    const f = navDir() + 'transports.json';
    TRANSPORTS = (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Portal[] : []).map(p => ({ ...p, trust: p.trust ?? 'exact', dims: locDims(p.locId), forceApproach: locForceApproach(p.locId) }));
    return TRANSPORTS;
}
// NAV PHASE 3: v3 DOOR CUTS (v3-door-cuts.json). A quest door the base collision models OPEN (every door is
// masked open at init) makes the planner optimistic for EVERY caller (the Crandor secret door: from the volcano side only
// with Dragon Slayer, crandor.rs2:11-27). quest-gated-doors.json would close it for the default graph too, so instead a
// graph 'v3' query closes the cut doors in the shared collision for its own synchronous duration (restored in finally,
// before any other bot can path) and reads reach labels through an override that splits the door's component. Crossing
// the door is then a transports.json row with the quest in its req. Non-v3 callers never enter withV3Cuts.
export interface V3Cut { id: string; level: number; x: number; z: number; a: { x: number; z: number }; b: { x: number; z: number }; locId?: number; why?: string; cite?: string; tile?: boolean }
// `tile: true` = a HAZARD tile (a walkable trap: Isafdar pitfall leaves, tripwires, woodsprings): blocked as a full tile for the
// v3 query (only if it is walkable now, so the revert never erases real collision); crossing it is the trap's transport.
let CUTS: V3Cut[] | null = null;
export function v3DoorCuts(): V3Cut[] {
    if (CUTS) return CUTS;
    const f = navDir() + 'v3-door-cuts.json';
    CUTS = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as V3Cut[] : [];
    return CUTS;
}
let cutOv: Map<number, number> | null = null;
let cutDepth = 0;
let cutClosed: DoorInfo[] = [];
let cutTiles: V3Cut[] = [];
function isV3(opts: PlanOpts): boolean { return opts.graph === 'v3' || (opts.graph === undefined && process.env.NAV_GRAPH === 'v3'); }
function reopenCuts(): void {
    for (const d of cutClosed) rsmod.changeWall(d.x, d.z, d.level, d.angle, d.shape, d.blockrange, false, false);
    for (const c of cutTiles) rsmod.changeLoc(c.x, c.z, c.level, 1, 1, false, false, false);
    cutClosed = []; cutTiles = [];
}
export function withV3Cuts<T>(fn: () => T): T {
    const cuts = v3DoorCuts();
    if (!cuts.length) return fn();
    if (cutDepth++ === 0) {
        initPathfinding();
        // BUILD ORDER FIX: the BASE reach labels must be built with every door masked open. If the
        // first reach query of a process was a v3 one, cutOverride -> buildReach labelled the world with the cut doors CLOSED,
        // and every later non-v3 caller (and the override, which assumes open-door labels) read split components.
        buildReach();
        cutClosed = []; cutTiles = [];
        for (const c of cuts) {
            if (c.tile) {
                if (isTileWalkable(c.level, c.x, c.z)) { rsmod.changeLoc(c.x, c.z, c.level, 1, 1, false, false, true); cutTiles.push(c); }
                continue;
            }
            const d = getDoorAt(c.level, c.x, c.z);   // undefined = not masked open (or blockDoor'd for good): leave it
            if (!d || d.shape === 9) continue;
            rsmod.changeWall(d.x, d.z, d.level, d.angle, d.shape, d.blockrange, false, true);
            cutClosed.push(d);
        }
        try { cutOv ??= cutOverride(cuts); } catch (e) { reopenCuts(); cutDepth = 0; throw e; }
        setReachOverride(cutOv);
    }
    try { return fn(); }
    finally {
        if (--cutDepth === 0) {
            reopenCuts();
            setReachOverride(null);
        }
    }
}
// Planner context: which edges, and whether the reach gate prunes. Default (no opts, no env) = the base graph, no gate:
// the exact pre-phase-1 code path (same portal array, same cache keys).
interface PlanCtx { portals: Portal[]; gate: boolean; key: string; v3?: boolean }
const BASE_CTX: { v: PlanCtx | null } = { v: null };
const ctxCache = new Map<string, PlanCtx>();
function planCtx(opts: PlanOpts): PlanCtx {
    const lim = `${opts.maxPortals !== undefined && opts.maxPortals !== 3 ? '|mp' + opts.maxPortals : ''}${opts.maxWalk !== undefined && opts.maxWalk !== 700 ? '|mw' + opts.maxWalk : ''}`;
    const g = opts.graph ?? (process.env.NAV_GRAPH === 'v3' ? 'v3' : process.env.NAV_GRAPH === 'v2' ? 'v2' : 'base');
    const v3 = g === 'v3', v2 = g === 'v2' || v3;
    const tr = opts.transports ? allTransports().filter(t => (v3 || !(t.phase! >= 2)) && transportUsable(t, opts.transports!)) : [];
    const gate = v2 || tr.length > 0 || (opts.reachGate ?? process.env.NAV_REACH_GATE === '1');
    if (!v2 && !tr.length && !gate && !lim) return BASE_CTX.v ??= { portals: allPortals(), gate: false, key: '' };
    const key = `${lim}|${v3 ? 'v3' : v2 ? 'v2' : 'b'}${gate ? 'g' : ''}${tr.length ? ':' + tr.map(t => t.id).join(',') : ''}`;
    let c = ctxCache.get(key);
    if (!c) {
        c = { portals: v2 || tr.length ? [...allPortals(), ...(v2 ? genericLadders() : []), ...(v3 ? areaPortals() : []), ...tr] : allPortals(), gate, key, v3 };
        if (ctxCache.size > 64) ctxCache.clear();
        ctxCache.set(key, c);
    }
    return c;
}
/** Cheap "is there any portal chain at all" answer (reach.ts), using the same edges the planner would. null = no. */
// NAV PHASE 2 (graph 'v3'): with `teleports` in opts, a usable teleport is one more edge from the start (cost 1 hop) to its landing:
// the answer is min(walk chain, 1 + chain from each landing). Without teleports: unchanged.
export function reachCheck(from: Coord, to: Coord, opts: PlanOpts = {}): number | null {
    if (isV3(opts)) return withV3Cuts(() => reachCheckInner(from, to, opts));
    return reachCheckInner(from, to, opts);
}
function reachCheckInner(from: Coord, to: Coord, opts: PlanOpts): number | null {
    initPathfinding();
    const ctx = planCtx({ ...opts, reachGate: true }), portals = ctx.portals;
    let best = minPortals(from, to, portals);
    for (const t of opts.teleports && ctx.v3 ? usableTeleports(opts.teleports, from) : []) {
        if (best === 0) break;
        const r = minPortals(t.landing, to, portals, best === null ? 64 : best - 2);
        if (r !== null && (best === null || r + 1 < best)) best = r + 1;
    }
    return best;
}

// ---- PORTAL REGISTRY ------------------------------------------------------------------------------
// The graph = 258 portals AUTO-EXTRACTED from the ladder/stairs scripts (portals.json, built by
// extract-portals.mjs: switch_coord/if cases -> p_telejump / climb_ladder / stair_options dests, all
// level-encoded) + a few proven MANUAL portals (Dwarven mine + Ice
// Mountain live in AREA scripts, not ladders+stairs/, so they aren't in the auto set). Rebuild the
// auto set any time the scripts change: `node sdk/navgrid/extract-portals.mjs`.
const MANUAL: Portal[] = [
    // DIMS ADDED (camp reachability sweep). loc 1733/1734 are STAIRCASES with a 2x3 footprint
    // — every AUTO-extracted 1733/1734 entry carries `dims {w:2,l:3}`, but these two MANUAL twins had
    // none. Without dims, mlDrive's interaction test degrades from `reachedLoc(...)` to `dLadder <= 1`,
    // which is wrong for a multi-tile loc: the bot parks 2 tiles off a 2x3 staircase, calls itself
    // invalid, and walkToExact's into the staircase's own collision forever (live-caught here — the
    // Dwarven ascent stalled at (3058,9778) against a portal declared at z 9776).
    { x: 3059, z: 3376, level: 0, dest: { level: 0, x: 3058, z: 9776 }, locId: 1733, op: 1, trust: 'exact', dims: { w: 2, l: 3 }, shape: 10, label: 'Falador stairs -> Dwarven mine' },
    { x: 3058, z: 9776, level: 0, dest: { level: 0, x: 3059, z: 3376 }, locId: 1734, op: 1, trust: 'exact', dims: { w: 2, l: 3 }, shape: 10, label: 'Dwarven mine -> surface' },
    // X WAS OFF BY ONE on both halves of this pair (fixed, camp reachability sweep).
    // GROUND TRUTH from the maps, not a guess:
    //   surface trapdoor  server/content/maps/m47_53.jm2  LOC "0 11 58: 1570 22 2" -> abs (3019,3450)
    //   annex exit ladder server/content/maps/m47_153.jm2 LOC "0 11 58: 1755 10"   -> abs (3019,9850)
    // Both entries said x=3018. The symptom was exact and silent: mlDrive's `atValidTile` fallback is
    // `dLadder <= 1` (no dims on these entries), so standing at (3017,3450) measured 1 tile from the
    // WRONG x and declared itself interaction-valid — it therefore never repositioned, and re-OPLOC'd a
    // tile with no loc on it, which World.getLoc silently misses. The bot re-issued forever and the leg
    // timed out with no "CLIMB STALLED" reposition and no error message.
    // (Note loc 1570 is `trapdoor_open`, NOT the closed trapdoor: loc.pack 1569=trapdoor_level1,
    // 1570=trapdoor_open, 1571=trapdoor_open_level1. This one is PLACED OPEN on the map, so unlike the
    // auto-extracted 1568/altLocId=1570 trapdoors it needs no two-stage alternation -- BUT any player can Close it (trapdoors.rs2 loc_change(trapdoor,500)), so
    // altLocId 1568 lets the climb alternation op1 "Open" the closed variant.)
    // GNOME STRONGHOLD GATE: gnome_areagate loc 190 @ (2459,3383)
    // (m38_52.jm2 "0 27 55: 190 10 2"); OPLOC1 walks you through to the OTHER side — south tile (2461,3382) <-> north
    // tile (2461,3385) (area_gnome/scripts/gnome_gate.rs2). Same loc, two edges; the planner picks by where dest leads.
    // Without these the walled stronghold is a sealed component (agility course, Grand Tree) for every planner.
    { x: 2459, z: 3383, level: 0, dest: { level: 0, x: 2461, z: 3385 }, locId: 190, op: 1, trust: 'exact', shape: 10, angle: 2, label: 'Gnome stronghold gate -> inside' },
    { x: 2459, z: 3383, level: 0, dest: { level: 0, x: 2461, z: 3382 }, locId: 190, op: 1, trust: 'exact', shape: 10, angle: 2, label: 'Gnome stronghold gate -> outside' },
    { x: 3019, z: 3450, level: 0, dest: { level: 0, x: 3019, z: 9850 }, locId: 1570, altLocId: 1568, op: 1, trust: 'exact', label: 'Ice Mountain trapdoor -> Dwarven annex' },
    { x: 3019, z: 9850, level: 0, dest: { level: 0, x: 3019, z: 3450 }, locId: 1755, op: 1, trust: 'exact', label: 'Dwarven annex -> surface' },
    // Varrock sewers ladder -> surface: the manhole (locId 881/882,
    // auto-extracted) is DOWN-ONLY — manholes.rs2/trapdoors.rs2 have no "up" case, and extract-portals.mjs
    // explicitly skips underground placements for the two-stage family (`if (lvl !== 0 || z >= 6400) continue`).
    // The actual way back out is a SEPARATE loc — the same generic loc_1755 "mining guild ladder" family
    // already used above for the Dwarven annex/Ice Mountain exit (`~climb_ladder(movecoord(coord(), 0, 0,
    // -6400), true)` in ladders.rs2 — unconditional, not case-matched, so the auto-extractor's per-case
    // scanner can't see it at all). Six placements exist in the Varrock sewers map squares.
    // REJECTED (3237,9858): closer to Aubury, but findPathToLoc's best approach (3235,9858, 2 tiles
    // short) fails reachedLoc -> routeToPortal returns null -> invisible to the planner.
    // REJECTED (3116,9852): passes every offline check (findPathToLoc reaches it, reachedLoc true,
    // planMultiLevel returns a clean plan) — but LIVE-CAUGHT (2 real runs, SUPPLY_ACCT_N): its surface landing
    // (3116,3452) sits one hop from a PERMANENTLY LOCKED door at (3115,3450) — locId 1804, a
    // "brasskeydoor" (server/content/scripts/areas/area_edgeville/scripts/edgeville_dungeon.rs2:
    // `[oploc1,brasskeydoor] mes("The door is locked.")` — needs `edgevilledungeonkey` via `oplocu`,
    // plain OPLOC1 is a permanent no-op). Door-states.json has NO entry for locId 1804 (`doorDef(1804)`
    // = undefined), so DoorTracker.seed()/onLocAddChange() both silently skip it — the tracker has ZERO
    // knowledge of this door (not "seen as open", just never tracked), so any tracker-based stall-buster
    // finds nothing and the bot wedges forever. The static collision also can't warn you: ALL known
    // doors are masked open for planning (see the `2601 doors masked` boot line + `blockDoor`/
    // `applyBlockedEdges`), so the route looks perfectly legal offline. Lesson: a clean offline
    // findPathToLoc/reachedLoc/planMultiLevel pass is NOT proof a route is walkable live — some doors
    // are quest-key-gated dead ends the collision graph cannot represent. GROUND-TRUTHED the fix by
    // grepping door-table.ts for entries within ~2 tiles of the stall tile once TWO live runs wedged
    // identically at the same (x,z) with idx never advancing past 1.
    // USING (3096,9867 — server/content/maps/m48_154.jm2, local 24,11, shape 10 angle 0): reachedLoc
    // true, AND its surface leg (3096,3467) is a clean 43-waypoint walk to Varrock East bank with no
    // known-locked doors on the route (door-table.ts doors along it are ordinary tracked ids: 1530/
    // 1533/1536/etc., all present in door-states.json, so the normal door-tracker opens them).
    { x: 3096, z: 9867, level: 0, dest: { level: 0, x: 3096, z: 3467 }, locId: 1755, op: 1, trust: 'estimate', shape: 10, angle: 0, label: 'Varrock sewers ladder -> surface (west Varrock, clear of the brasskeydoor dead-end)' },
    // TAVERLEY DUNGEON (Druidic Ritual — the Cauldron of Thunder at (2893,9831) is the ONLY
    // one in the world and lives down here). INVISIBLE TO THE AUTO-EXTRACTOR for exactly the reason the
    // Varrock entry above documents: `[oploc1,loc_1759]` and `[oploc1,loc_1757]`/`[oploc1,loc_1755]`
    // (server/content/scripts/ladders+stairs/scripts/ladders.rs2:83-98) are UNCONDITIONAL
    // `~climb_ladder(movecoord(coord(), 0, 0, ±6400), ...)` bodies with no switch_coord case for the
    // extractor's per-case scanner to read.
    //
    // ⛔ TRUST = 'estimate' AND IT IS NOT A HEDGE: `coord()` is the PLAYER's coord, not `loc_coord()`,
    // so the landing tile is WHEREVER YOU STOOD ± 6400, i.e. one of the ladder's four cardinal faces.
    // ⛔ 1759 (ladder_cellar_inside_down) is `forceapproach=east` (locmeta mask 13): reachedLoc accepts ONLY (2885,3397), so
    // the landing is (2885,9797) — live, the climb from (2885,3397) logged "climbed to (0,2885,9797)". The up
    // ladder 1755 has no forceapproach; its dest below is the NORTH face's mirror; all four faces of BOTH ladders are walkable
    // (offline probe, rsmod collision), so routeWithin from any of them reaches the goal.
    //
    // ⛔ OFFLINE-DERIVED, NOT LIVE-PROVEN. Ground truth used:
    //   surface down-ladder  server/content/maps/m45_53.jm2  LOC "0 4 5: 1759 10" -> abs (2884,3397)
    //   dungeon  up-ladder   server/content/maps/m45_153.jm2 LOC "0 4 5: 1755 10" -> abs (2884,9797)
    //   findPathToLoc/reachedLoc both accept from (2884,3398) surface and (2884,9798) underground.
    // The Varrock note above is the standing warning that a clean offline pass is NOT proof of a live
    // walk; this pair still needs its first live smoke.
    { x: 2884, z: 3397, level: 0, dest: { level: 0, x: 2885, z: 9797 }, locId: 1759, op: 1, trust: 'estimate', shape: 10, angle: 0, label: 'Taverley dungeon ladder -> underground' },
    { x: 2884, z: 9797, level: 0, dest: { level: 0, x: 2884, z: 3398 }, locId: 1755, op: 1, trust: 'estimate', shape: 10, angle: 0, label: 'Taverley dungeon -> surface' },
    // MAGIC GUILD (Yanille) STAIRS UP, L0 -> L1. The AUTO-extracted twin is WRONG:
    // portals.json has 0,2590,3089 -> 1,2590,3085 ('estimate' — the extractor picked up a NEIGHBOURING case's
    // movecoord(coord, 0, 1, -4)), and (2590,3085) on L1 is not even walkable, so the planner found NO way up to the
    // Magic Guild Store. Ground truth: stairs.rs2 [oploc1,loc_1722] `case 0_40_48_30_17 : p_telejump(1_40_48_30_20);`
    // (commented "Yanille Wizard Tower - level 0", but 40_48_30_17 = (2590,3089) is the guild staircase:
    // m40_48.jm2 LOC "0 30 17: 1722 10"). The way DOWN (1,2590,3090 -> 0,2590,3088, loc 1723) is auto-extracted 'exact'.
    { x: 2590, z: 3089, level: 0, dest: { level: 1, x: 2590, z: 3092 }, locId: 1722, op: 1, trust: 'exact', shape: 10, angle: 0, label: 'Magic Guild stairs up (L0 -> L1, the guild store floor)' },
    // COOKS' GUILD L1 <-> L2 LADDER: the extractor only knows the L0/L1
    // staircase (stairs.rs2:217/321). L1 m49_53 "1 8 54: 1747 10 2" = (3144,3446) — ladders.rs2 [oploc1,loc_1747] default
    // climb_ladder(movecoord(coord(),0,1,0)) = the PLAYER's tile one level up; L2 "2 8 54: 1746 10 2" climbs back down
    // the same way (movecoord(coord(),0,-1,0)). The grape spawn is L2 (3144,3450). Dest = the approach tile (estimate).
    { x: 3144, z: 3446, level: 1, dest: { level: 2, x: 3144, z: 3447 }, locId: 1747, op: 1, trust: 'estimate', shape: 10, angle: 2, label: "Cooks' Guild ladder up (L1 -> L2, grape spawn floor)" },
    { x: 3144, z: 3446, level: 2, dest: { level: 1, x: 3144, z: 3447 }, locId: 1746, op: 1, trust: 'estimate', shape: 10, angle: 2, label: "Cooks' Guild ladder down (L2 -> L1)" },
];

// Edges LIVE-PROVEN broken (probe results) — curated like MANUAL, survives regeneration. The offline
// collision believes these approaches work; the live server refuses them, so the planner must fall
// back to an alternative portal (the system's trust loop: live probes feed this list).
const LIVE_DENY = new Set<string>([
    // Lumbridge castle NORTH stairs up: the courtyard faces are walled (offline AND live agree — the
    // earlier "divergence" was a misdiagnosis); the only approach is through the castle's door-gated
    // interior, which is unproven live. The SOUTH staircase route is 1-hop and LIVE-PROVEN (mlduke15
    // reached Duke's floor), so keep this edge denied until a live probe proves the north approach.
    '0,3204,3229>1,3205,3228',
    // Falador -> Dwarven Mine cellar stairs DOWN (stairs_cellar 1733, 2x3 angle 1, forceapproach north; stairs.rs2
    // 0_47_52_51_48). Live (2 bots x 6 bail-outs): every OPLOC from the offline-valid
    // north tiles (3059..3061,3378 — a woodenrailing 994 runs along their south edge) was DISCARDED (no message, no
    // move) -> CLIMB STALLED -> parked. Deny until a live probe proves an approach; the planner falls back to Ice Mountain.
    '0,3059,3376>0,3058,9776',
]);

// EXTRACTED loc-id corrections, keyed level,x,z of the op tile (survive a portals.json regeneration). The extractor
// took the id from the script LABEL, which is wrong when a case is shared: Burthorpe castle stairs (live,
// Death Plateau -> Eohric: "CLIMB STALLED on loc 1722") are board_game_stairs_grey_base 4626 @ 0_45_55_17_46 and
// _top 4625 @ 1_45_55_17_47 (m45_55.jm2; stairs.rs2:461-470); 1722/1723 sit at the PUB (2914,3539).
const LOCID_FIX: Record<string, number> = { '0,2897,3566': 4626, '1,2897,3567': 4625 };
let CACHE: Portal[] | null = null;
export function allPortals(): Portal[] {
    if (CACHE) return CACHE;
    // suspects (validate-portals.ts): sealed entrances, broken dests, no-loc entries — never plan
    // through them. Keyed on the full edge so a fixed re-extraction naturally rehabilitates them.
    const bad = new Set([
        ...(SUSPECTS as Array<{ x: number; z: number; level: number; dest: Coord }>)
            .map(s => `${s.level},${s.x},${s.z}>${s.dest.level},${s.dest.x},${s.dest.z}`),
        ...LIVE_DENY,
    ]);
    const auto = (EXTRACTED as Array<{ x: number; z: number; level: number; dest: Coord; locId?: number | null; op?: number; altLocId?: number; trust?: 'exact' | 'estimate'; shape?: number; angle?: number; label?: string }>)
        .map(p => ({ ...p, locId: LOCID_FIX[`${p.level},${p.x},${p.z}`] ?? p.locId ?? undefined }))
        .filter(p => !bad.has(`${p.level},${p.x},${p.z}>${p.dest.level},${p.dest.x},${p.dest.z}`));
    // LIVE_DENY covers the MANUAL twins too (the Falador cellar stairs live as both an auto and a MANUAL entry)
    CACHE = [...auto, ...MANUAL.filter(p => !bad.has(`${p.level},${p.x},${p.z}>${p.dest.level},${p.dest.x},${p.dest.z}`))].map(p => ({ ...p, dims: locDims(p.locId) }));
    return CACHE;
}

// ---- PLANNER --------------------------------------------------------------------------------------
// Within-stratum reachability + path (rsmod, all levels). `arrive` = how close is "reached": a PORTAL
// op-tile is a loc you can't stand ON (you climb it from ADJACENT), so approaching a ladder accepts
// ~2 tiles (OPLOC self-routes the last step); the final GOAL wants exact (<=1).
function routeWithin(level: number, sx: number, sz: number, dx: number, dz: number, arrive = 1): Array<{ x: number; z: number }> | null {
    if (Math.max(Math.abs(sx - dx), Math.abs(sz - dz)) <= arrive) return [{ x: sx, z: sz }];
    const wp = findLongPath(level, sx, sz, dx, dz, 600);
    if (!wp.length) return null;
    const end = wp[wp.length - 1]!;
    if (Math.max(Math.abs(end.x - dx), Math.abs(end.z - dz)) > arrive) return null;
    // PREPEND THE SOURCE: findLongPath returns CORNERS only — the implied straight first segment
    // (source -> corner 1) is otherwise lost to densification, and a follower snapping onto the
    // truncated path can land on the far side of a wall (the castle-pocket wedge, fidelity-caught).
    return [{ x: sx, z: sz }, ...wp.map(w => ({ x: w.x, z: w.z }))];
}
// STAND portals (generic ladders, transports): the dest is relative to WHERE you operate from, so route to that exact
// tile (arrive 0) — no other face is acceptable.
function routeToStand(level: number, sx: number, sz: number, st: { x: number; z: number }): Array<{ x: number; z: number }> | null {
    if (sx === st.x && sz === st.z) return [{ x: sx, z: sz }];
    const wp = findLongPath(level, sx, sz, st.x, st.z, 600);
    const end = wp[wp.length - 1];
    if (!end || end.x !== st.x || end.z !== st.z) return null;
    return [{ x: sx, z: sz }, ...wp.map(w => ({ x: w.x, z: w.z }))];
}
// Portal approach = ENGINE-IDENTICAL op routing: findPathToLoc targets the loc's FOOTPRINT (dims from
// the configs, shape+angle from the jm2 placement), so the path ends on an INTERACTION-VALID tile —
// one from which the engine's reachedLoc accepts the op. Proximity heuristics failed twice live: a
// tile 2 away THROUGH a wall (wizard ladder) and a wall-edged adjacent tile (Lumbridge staircase west
// face — walkable, but OPLOC never fires through the wall edge).
function routeToPortal(level: number, sx: number, sz: number, p: Portal): Array<{ x: number; z: number }> | null {
    if (p.stand) return routeToStand(level, sx, sz, p.stand);
    const { w, l } = locDims(p.locId);
    const shape = p.shape ?? 10, angle = p.angle ?? 0;
    const fa = locForceApproach(p.locId);
    if (reachedLoc(level, sx, sz, p.x, p.z, w, l, angle, shape, fa)) return [{ x: sx, z: sz }];
    const wp = findPathToLoc(level, sx, sz, p.x, p.z, w, l, angle, shape, 600, fa);
    if (!wp.length) return null;
    const end = wp[wp.length - 1]!;
    if (!reachedLoc(level, end.x, end.z, p.x, p.z, w, l, angle, shape, fa)) return null;   // best-effort fell short of a valid face
    return [{ x: sx, z: sz }, ...wp.map(v => ({ x: v.x, z: v.z }))];   // prepend source (see routeWithin)
}

// Plan a (possibly cross-stratum) route from -> to. GOAL-DIRECTED: find the ladder whose EXIT lands
// near the goal (few candidates — dest on the goal's level and close), then confirm its ENTRANCE is
// reachable from the start (recursively, for 2+ hops). This probes a handful of ladders, not all 258.
// Chain depth is tiny (1-2 ladders); most routes are a single surface<->basement / <->upstairs hop.
// PLAN CACHE — planning is SYNCHRONOUS and runs in the packet loop, so with many bots the cost is per
// DISTINCT (from,to) route, NOT per bot: bots leaving the same tile for the same target resolve to
// ONE plan. Keyed on EXACT tiles
// (the naive server wedges if the first waypoint isn't adjacent to where the bot stands). NULL (no
// route) is cached too, so an unreachable pair is probed ONCE, never re-hammered.
const planCache = new Map<string, Leg[] | null>();
const CACHE_MAX = 20_000;
let planHits = 0, planMisses = 0;
export function planCacheStats() { return { hits: planHits, misses: planMisses, size: planCache.size }; }
export function clearPlanCache() { planCache.clear(); teleSubCache.clear(); planHits = 0; planMisses = 0; }

export interface PlanOpts {
    maxPortals?: number; maxWalk?: number; cache?: boolean;
    // NAV PHASE 1 (all opt-in; env NAV_REACH_GATE=1 / NAV_GRAPH=v2 set the defaults):
    reachGate?: boolean;            // refuse in microseconds when reach.ts finds no portal chain; prune hopeless candidates
    graph?: 'base' | 'v2' | 'v3';   // v2 = + generic-ladders.json (forces the gate: 1,400 more edges); v3 = v2 + area portals + phase-2/3 transports + door cuts
    transports?: TransportCaps | null;   // + transports.json edges this bot can use (forces the gate)
    // TELEPORTS (teleports.ts) — OFF unless the caller passes the bot's capability. With it, a teleport
    // is an edge usable from the START tile (castable from any plane/stratum the scripts allow), chosen
    // only when cast cost + the walk from its landing beats the plain plan by `minSaveTiles`.
    teleports?: TeleportCaps | null;
    // WALL-CLOCK CAP (ms), OFF unless a caller passes it. The planner is
    // synchronous in the packet loop: live, one bot spent 24,046 ms on an 8-tile (2929,2954)->(2925,2947) hop at the
    // Karamja stepping stones (the river splits the plane, so every portal within maxWalk got a failed search), twice, and the
    // bot sat frozen while the server ticked on. Past the cap the search stops and returns null (no route), which the
    // caller already handles (mlDrive degrades to the single-level traveller). The null is cached like any no-route result.
    maxMs?: number;
    travel?: boolean;               // TRAVEL NETWORK: false = never weigh phase-4 `travel` rows against the plan (env NAV_TRAVEL=0)
}
// the running capped plan's deadline (Date.now() ms); Infinity = no cap. Set by planMultiLevel, read by plan().
let DEADLINE = Infinity, capHit = false, capLogged = 0;
const overDeadline = (): boolean => { if (DEADLINE !== Infinity && Date.now() > DEADLINE) capHit = true; return capHit; };

// Cost model (tiles). Walking = Chebyshev sum along the corner path; a climb ~5 tiles (op + telejump);
// a teleport ~15 tiles (IF_BUTTON -> p_delay(2) -> telejump + scatter; runes are NOT weighed).
export const PORTAL_COST_TILES = 5;
export const TELEPORT_COST_TILES = 15;
export const TELEPORT_MIN_SAVE_TILES = 10;
export const TELEPORT_MAX_PROBES = 4;
export function planCost(legs: Leg[] | null, teleportCost = TELEPORT_COST_TILES): number {
    if (!legs) return Infinity;
    let c = 0;
    for (const l of legs) {
        for (let i = 1; i < l.waypoints.length; i++) {
            const a = l.waypoints[i - 1]!, b = l.waypoints[i]!;
            c += Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
        }
        if (l.portal) c += PORTAL_COST_TILES;
        if (l.teleport) c += teleportCost;
    }
    return c;
}
// Admissible-ish lower bound on the walk a -> b: Chebyshev only within one plane of one stratum
// (surface vs the z>=6400 underground); across strata a ladder can shortcut, so 0.
function walkLowerBound(a: Coord, b: Coord): number {
    if (a.level !== b.level || (a.z >= 6400) !== (b.z >= 6400)) return 0;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}
export function teleportLeg(t: TeleportDef): TeleportLeg {
    return { id: t.id, label: t.label, kind: t.kind, dest: { ...t.landing }, scatter: t.scatter, spellCom: t.spellCom, items: t.items ? [...t.items] : undefined, choice: t.choice, ...(t.itemOp !== undefined ? { itemOp: t.itemOp } : {}) };
}

export function planMultiLevel(from: Coord, to: Coord, opts: PlanOpts = {}): Leg[] | null {
    const run = () => (isV3(opts) ? withV3Cuts(() => v3Face(from, to, opts, planMultiLevelInner(from, to, opts))) : planMultiLevelInner(from, to, opts));
    if (!opts.maxMs || DEADLINE !== Infinity) return run();
    const t0 = Date.now();
    DEADLINE = t0 + opts.maxMs; capHit = false;
    try {
        const r = run();
        if (capHit && capLogged++ < 20) console.log(`[navgrid] planMultiLevel (${from.level},${from.x},${from.z})->(${to.level},${to.x},${to.z}) capped at ${Date.now() - t0} ms (maxMs ${opts.maxMs}): no route`);
        return capHit ? null : r;
    } finally { DEADLINE = Infinity; capHit = false; }
}
// NAV PHASE 3 (graph 'v3' only): a BLOCKED goal tile (a crate, a bookcase: "search" targets) is "arrived" within 1,
// and the planner can end on a neighbour the engine never accepts the op from: across a wall, or a diagonal. Example
// (Dark Warriors' Fortress crate 357 @3026,3628): from the south-west gate the plan ended at (3026,3627),
// south of the crate behind the wall line z 3627|3628 ("I can't reach that!" x5, FAILED). The op needs a CARDINAL
// neighbour with no wall between (reachedLoc, 1x1 centrepiece). If the plan's end is not one, re-plan to each such face
// and keep the cheapest that ends on one; none = the original plan (never less reachable than before).
function v3Face(from: Coord, to: Coord, opts: PlanOpts, p: Leg[] | null): Leg[] | null {
    if (!p || isTileWalkable(to.level, to.x, to.z)) return p;
    const face = (x: number, z: number) => reachedLoc(to.level, x, z, to.x, to.z, 1, 1, 0, 10, 0);
    const end = (q: Leg[]) => q[q.length - 1]!.waypoints[q[q.length - 1]!.waypoints.length - 1]!;
    if (face(end(p).x, end(p).z)) return p;
    let best: Leg[] | null = null, bc = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const c = { level: to.level, x: to.x + dx, z: to.z + dz };
        if (!isTileWalkable(c.level, c.x, c.z) || !face(c.x, c.z)) continue;
        const q = planMultiLevelInner(from, c, opts);
        if (!q || !face(end(q).x, end(q).z)) continue;
        const k = planCost(q);
        if (k < bc) { bc = k; best = q; }
    }
    return best ?? p;
}
function planMultiLevelInner(from: Coord, to: Coord, opts: PlanOpts): Leg[] | null {
    return planTravel(from, to, opts, planMultiLevelBase(from, to, opts));
}
// TRAVEL NETWORK: the portal search above ends at the FIRST plan it finds and a
// plain walk always wins on one plane, so a glider / spirit tree / cart that beats a 600-tile walk was never chosen. Here
// every usable `travel: true` row (transports.json phase 4) is weighed like a teleport: approach (walk, or a short portal
// chain to the row's op tile) + its `cost` + the plan from its dest. It replaces `best` only when it saves TRAVEL_MIN_SAVE_TILES.
// No travel row usable (every non-v3 caller, every caller without the quests) = `best` untouched, byte-identical.
export const TRAVEL_COST_TILES = 20;
export const TRAVEL_MIN_SAVE_TILES = 10;
export const TRAVEL_MAX_PROBES = 4;
function travelEnabled(opts: PlanOpts): boolean {
    const e = process.env.NAV_TRAVEL?.toLowerCase();
    return opts.travel !== false && e !== '0' && e !== 'off' && e !== 'false';
}
function planTravel(from: Coord, to: Coord, opts: PlanOpts, best: Leg[] | null): Leg[] | null {
    if (!isV3(opts) || !opts.transports || !travelEnabled(opts)) return best;
    const ctx = planCtx(opts);
    const rows = ctx.portals.filter(p => p.travel);
    if (!rows.length) return best;
    const useCache = opts.cache !== false;
    const k = useCache ? `X|${from.level},${from.x},${from.z}>${to.level},${to.x},${to.z}${ctx.key}|${planCost(best)}` : '';
    if (useCache) { const hit = planCache.get(k); if (hit !== undefined) { planHits++; return hit; } planMisses++; }
    let bound = planCost(best) - TRAVEL_MIN_SAVE_TILES;
    // lower bound = walk distance where it is measurable (same plane + stratum) + the row's cost + PORTAL_COST_TILES per portal the
    // reach gate says each half needs (microseconds, no probe spent; null = that half cannot chain at all: dropped). Without the
    // portal term a Ta Quir Priw glider looked free from Al Kharid (another plane: distance 0) and ate the probe budget.
    const cands: Array<{ p: Portal; lb: number }> = [];
    for (const p of rows) {
        const lb0 = walkLowerBound(from, { level: p.level, x: p.x, z: p.z }) + (p.cost ?? TRAVEL_COST_TILES) + walkLowerBound(p.dest, to);
        if (lb0 >= bound) continue;
        const mA = minPortalsTo(from, new Set(entranceComponents(p)), ctx.portals, 6);
        const mR = mA === null ? null : minPortals(p.dest, to, ctx.portals, 6);
        if (mA !== null && mR !== null) cands.push({ p, lb: lb0 + PORTAL_COST_TILES * (mA + mR) });
    }
    cands.sort((a, b) => a.lb - b.lb);
    let probes = 0, out = best;
    for (const { p, lb } of cands) {
        if (lb >= bound) break;   // sorted: nothing later can win
        if (++probes > TRAVEL_MAX_PROBES) break;
        const pre = travelApproach(from, p, opts, ctx);
        if (!pre) continue;
        const rest = teleSubPlan(p.dest, to, opts);
        if (!rest) continue;
        const c = planCost(pre) + (p.cost ?? TRAVEL_COST_TILES) - PORTAL_COST_TILES + planCost(rest);   // planCost(pre) counts the row as a portal
        if (c < bound) { bound = c; out = [...pre, ...rest]; }
    }
    if (useCache && planCache.size < CACHE_MAX) planCache.set(k, out);
    return out;
}
// The legs from `from` to operating `p` (the last leg carries p as its portal): a direct same-plane approach, else the portal
// search with p as the goal portal (the Grand Tree glider from the ground: doors + 3 ladders), bounded by the gate.
function travelApproach(from: Coord, p: Portal, opts: PlanOpts, ctx: PlanCtx): Leg[] | null {
    if (p.level === from.level && (from.z >= 6400) === (p.z >= 6400)) {
        const d = routeToPortal(from.level, from.x, from.z, p);
        if (d) return [{ waypoints: d, portal: p }];
    }
    const op: Coord = { level: p.level, x: p.x, z: p.z };
    const max = Math.min(opts.maxPortals ?? 3, 6);
    const mp = minPortalsTo(from, new Set(entranceComponents(p)), ctx.portals, max);
    if (mp === null) return null;
    const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
    for (let depth = Math.max(1, mp); depth <= max; depth++) {
        const pre = plan(from, op, depth, opts.maxWalk ?? 700, new Set([`${p.x},${p.z},${p.dest.x},${p.dest.z}`]), cheb, p, ctx);
        if (pre) { pre[pre.length - 1]!.portal = p; return pre; }
    }
    return null;
}
function planMultiLevelBase(from: Coord, to: Coord, opts: PlanOpts): Leg[] | null {
    const teles = opts.teleports ? usableTeleports(opts.teleports, from) : [];
    if (!teles.length) return planWalk(from, to, opts);   // the pre-teleport planner, byte-identical plans
    initPathfinding();
    const caps = opts.teleports!;
    const tCost = caps.costTiles ?? TELEPORT_COST_TILES;
    const minSave = caps.minSaveTiles ?? TELEPORT_MIN_SAVE_TILES;
    const useCache = opts.cache !== false;
    // keyed on the USABLE SET (not rune counts): every bot with the same castable teleports shares one plan
    const k = useCache ? `T|${from.level},${from.x},${from.z}>${to.level},${to.x},${to.z}|${teles.map(t => t.id).join(',')}|${tCost}|${minSave}${planCtx(opts).key}` : '';
    if (useCache) { const hit = planCache.get(k); if (hit !== undefined) { planHits++; return hit; } planMisses++; }
    const walk = planWalk(from, to, opts);
    let best: Leg[] | null = walk;
    let bound = planCost(walk) - minSave;   // a teleport plan must come in UNDER this
    const cands = teles.map(t => ({ t, lb: tCost + walkLowerBound(t.landing, to) })).sort((a, b) => a.lb - b.lb);
    // PROBE BUDGET: an unreachable landing->goal pair costs a full failed search (seconds); cap the probes
    // (nearest-bound first). Results — null included — land in planCache keyed by the landing, so each
    // (landing, goal) pair is searched once per process however many bots ask.
    let probes = 0;
    for (const { t, lb } of cands) {
        if (lb >= bound) break;   // sorted: nothing later can win
        if (++probes > TELEPORT_MAX_PROBES || overDeadline()) break;
        const rest = teleSubPlan(t.landing, to, opts);
        if (!rest) continue;
        const c = tCost + planCost(rest);
        if (c < bound) { bound = c; best = [{ waypoints: [{ x: from.x, z: from.z }], teleport: teleportLeg(t) }, ...rest]; }
    }
    if (useCache && planCache.size < CACHE_MAX) planCache.set(k, best);
    return best;
}

// landing -> goal, BOUNDED: the general planner's worst case is an UNREACHABLE pair (Karamja landing ->
// mainland goal: every portal near the goal gets a failed search, x3 depths = minutes). A teleport only
// earns its place when its landing is close, so: same plane+stratum = ONE direct walk; otherwise at most
// ONE climb. Cached per (landing, goal) — shared by every bot and every start tile.
const teleSubCache = new Map<string, Leg[] | null>();
function teleSubPlan(landing: Coord, to: Coord, opts: PlanOpts): Leg[] | null {
    const k = `${landing.level},${landing.x},${landing.z}>${to.level},${to.x},${to.z}${planCtx(opts).key}`;
    const hit = teleSubCache.get(k);
    if (hit !== undefined) return hit;
    let r: Leg[] | null;
    const ctx = planCtx(opts);
    if (ctx.v3) {
        // NAV PHASE 2 (graph 'v3' callers only): the landing may need several portals (Trollheim
        // teleport -> the stronghold; glory Karamja -> a ship). The gate answers in microseconds, so only a reachable
        // landing pays for a search, bounded by the caller's maxPortals. Gate-off teleport callers keep the 1-climb rule.
        const mp = minPortals(landing, to, ctx.portals, opts.maxPortals ?? 3);
        if (mp === null) r = null;
        else if (mp === 0 && landing.level === to.level) { const d = routeWithin(to.level, landing.x, landing.z, to.x, to.z); r = d ? [{ waypoints: d }] : planWalk(landing, to, { ...opts, cache: false }); }
        else r = planWalk(landing, to, { ...opts, cache: false });
    } else if (landing.level === to.level && (landing.z >= 6400) === (to.z >= 6400)) {
        const d = routeWithin(to.level, landing.x, landing.z, to.x, to.z);
        r = d ? [{ waypoints: d }] : null;
    } else {
        r = planWalk(landing, to, { ...opts, maxPortals: 1, cache: false });
    }
    if (teleSubCache.size < CACHE_MAX) teleSubCache.set(k, r);
    return r;
}

function planWalk(from: Coord, to: Coord, opts: PlanOpts): Leg[] | null {
    initPathfinding();
    const ctx = planCtx(opts);
    const useCache = opts.cache !== false;
    const k = useCache ? `${from.level},${from.x},${from.z}>${to.level},${to.x},${to.z}${ctx.key}` : '';
    if (useCache) { const hit = planCache.get(k); if (hit !== undefined) { planHits++; return hit; } planMisses++; }
    // REACH GATE: no portal chain at all (or more portals than allowed) -> null in microseconds instead of a full failed
    // search (Karamja -> Seers was 52 s at maxPortals 2). Depths below the chain's minimum cannot succeed: skip them.
    let minDepth = 1;
    if (ctx.gate) {
        const mp = minPortals(from, to, ctx.portals, opts.maxPortals ?? 3);
        if (mp === null) { if (useCache && planCache.size < CACHE_MAX) planCache.set(k, null); return null; }
        minDepth = Math.max(1, mp);
    }
    const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
    // ITERATIVE DEEPENING: try 1-hop plans before allowing 2+, else the greedy nearest-exit ordering
    // happily builds an up-up-down 3-climb chain when a farther single staircase would do (seen the
    // moment the Lumbridge north stairs got live-denied: it chained L0->L1->L2->L1 instead of taking
    // the south stairs directly). Fewer climbs = fewer live failure points; depth-1 probes are cheap.
    let result: Leg[] | null = null;
    for (let depth = minDepth; depth <= (opts.maxPortals ?? 3) && !result && !overDeadline(); depth++) {
        result = plan(from, to, depth, opts.maxWalk ?? 700, new Set(), cheb, undefined, ctx);
    }
    if (useCache && planCache.size < CACHE_MAX) planCache.set(k, result);
    return result;
}

function plan(from: Coord, to: Coord, budget: number, maxWalk: number,
    used: Set<string>, cheb: (a: number, b: number, c: number, d: number) => number, goalPortal?: Portal, ctx: PlanCtx = planCtx({})): Leg[] | null {
    // direct within-stratum route? When `to` is a PORTAL's op tile (the recursive calls below), approach it the way the
    // engine ops it (routeToPortal: findPathToLoc + reachedLoc + forceapproach), NOT within 1 of the loc tile. Live
    // Sanfew (L1) -> Taverley dungeon planned the ladder 1759 (forceapproach=east) from its NORTH face
    // (2884,3398) via this branch; the climb never fired ('CLIMB STALLED ... PARKING') and the quest step behind it wedged.
    // fallback = the old within-1 walk (an estimate portal's shape/angle can be off)
    const walkToGoal = (level: number, sx: number, sz: number) => goalPortal && goalPortal.level === level
        ? (routeToPortal(level, sx, sz, goalPortal) ?? (goalPortal.stand ? null : routeWithin(level, sx, sz, to.x, to.z))) : routeWithin(level, sx, sz, to.x, to.z);
    // GATE PRUNING (ctx.gate only): skip a candidate whose exit cannot reach the goal, or whose entrance the start cannot
    // reach within the remaining budget — both are findLongPath calls that would fail (16 ms+ each, seconds when far).
    const goalComps = ctx.gate ? new Set(goalPortal ? entranceComponents(goalPortal) : componentsNear(to.level, to.x, to.z, 1)) : null;
    if (from.level === to.level) {
        const direct = walkToGoal(from.level, from.x, from.z);
        if (direct) return [{ waypoints: direct }];
    }
    if (budget <= 0) return null;
    const portals = ctx.portals;
    // ladders whose EXIT lands on the goal's level, near the goal — the ones that could END the route.
    const entries = portals
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.dest.level === to.level && cheb(p.dest.x, p.dest.z, to.x, to.z) <= maxWalk && !used.has(`${p.x},${p.z},${p.dest.x},${p.dest.z}`))
        // EXACT-trust portals first (absolute script coords / live-proven), then by distance —
        // 'estimate' dests (player-relative movecoord) can be 1-3 tiles off and are fallbacks only.
        .sort((a, b) => (a.p.trust === 'estimate' ? 1 : 0) - (b.p.trust === 'estimate' ? 1 : 0)
            || cheb(a.p.dest.x, a.p.dest.z, to.x, to.z) - cheb(b.p.dest.x, b.p.dest.z, to.x, to.z));
    for (const { p } of entries) {
        if (overDeadline()) return null;
        if (goalComps && !exitComponents(p.dest).some(c => goalComps.has(c))) continue;
        if (goalComps && minPortalsTo(from, new Set(entranceComponents(p)), portals, budget - 1) === null) continue;
        const toGoal = walkToGoal(to.level, p.dest.x, p.dest.z);
        if (!toGoal) continue;   // exit doesn't actually reach the goal
        const key = `${p.x},${p.z},${p.dest.x},${p.dest.z}`;
        const nextUsed = new Set(used); nextUsed.add(key);
        // reach this ladder's ENTRANCE (op tile) from the start — same stratum, or recurse.
        const opCoord: Coord = { level: p.level, x: p.x, z: p.z };
        if (p.level === from.level) {
            // cheap Chebyshev gate BEFORE the (16ms-if-unreachable) findLongPath: a ladder far from
            // the start on the same plane is not a sane first hop; skip the probe entirely.
            if (cheb(from.x, from.z, p.x, p.z) <= maxWalk) {
                const toOp = routeToPortal(from.level, from.x, from.z, p);
                if (toOp) return [{ waypoints: toOp, portal: p }, { waypoints: toGoal }];
            }
            // SAME PLANE BUT SEALED: the start can sit in a walled component of the same level (the gnome
            // stronghold; the underground is level 0 too). Then the entrance is only reachable through ANOTHER portal
            // first — recurse instead of giving up (before: "gnome course -> dwarves" = NO ROUTE although both hops plan).
            if (budget > 1) {
                const pre = plan(from, opCoord, budget - 1, maxWalk, nextUsed, cheb, p, ctx);
                if (pre) { pre[pre.length - 1]!.portal = p; return [...pre, { waypoints: toGoal }]; }
            }
        } else {
            const pre = plan(from, opCoord, budget - 1, maxWalk, nextUsed, cheb, p, ctx);
            if (pre) { pre[pre.length - 1]!.portal = p; return [...pre, { waypoints: toGoal }]; }
        }
    }
    return null;
}

// A compact textual plan (for logs / offline validation).
export function describePlan(legs: Leg[] | null): string {
    if (!legs) return 'NO ROUTE (no ladder chain connects the strata)';
    return legs.map((l, i) => {
        const end = l.waypoints[l.waypoints.length - 1]!;
        const walk = `walk ${l.waypoints.length}wp -> (${end.x},${end.z})`;
        if (l.teleport) return `${i}: ${walk} then TELEPORT ${l.teleport.label} -> (${l.teleport.dest.level},${l.teleport.dest.x},${l.teleport.dest.z}) r${l.teleport.scatter}`;
        return l.portal ? `${i}: ${walk} then ${l.portal.travel ? 'TRAVEL ' : ''}${l.portal.action ? l.portal.action.kind.toUpperCase() : 'CLIMB'} ${l.portal.label} -> (${l.portal.dest.level},${l.portal.dest.x},${l.portal.dest.z})` : `${i}: ${walk} [arrive]`;
    }).join('\n');
}

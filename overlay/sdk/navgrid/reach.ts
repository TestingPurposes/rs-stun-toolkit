// REACHABILITY GATE — a cheap "can this route exist AT ALL" answer for planMultiLevel.
//
// WHY: planMultiLevel is synchronous and an UNREACHABLE pair is a full failed search: measured Karamja
// (2764,2974) -> Seers (2651,3441) = 1.3 s at maxPortals 1, 52 s at 2, > 100 s at 3. When many bots share one
// event loop, one island target freezes all of them. This module labels every walkable tile of every plane with a
// CONNECTED-COMPONENT id (a flood over the SAME rsmod collision findLongPath uses, same step rules: cardinal = the dest
// tile's BLOCK_<dir> mask, diagonal = also both cardinal legs), then answers "fewest portals from A to B" by BFS over the
// component graph whose edges are the portals (ladders, stairs, gates, transports). Build ~2 s once per process
// (measured: 20,737 components over 136,704 zones); a query is microseconds.
//
// ⛔ CONSERVATIVE BY CONSTRUCTION — it must NEVER say "unreachable" where the planner would find a route:
//   * a portal's ENTRANCE / EXIT sides mirror what the planner can do (entranceComps / exitComps below);
//   * the goal side = the goal tile's component AND every 8-neighbour's (the planner accepts arrival within 1);
//   * it ignores the planner's maxWalk / findLongPath search-window limits (those only make the planner fail MORE).
// So "null" here => planMultiLevel returns null too (cheaply). A non-null answer is a lower bound on portals, not a
// promise that the planner finds the route.
// Collision edits made AFTER the build (blockDoor, setWall, live walls) are not seen: they can only make the gate
// optimistic (the planner then fails the slow way, exactly as before), except an edit that OPENS a wall — none of the
// runtime paths do that after init today. Call resetReach() after such an edit.
import { initPathfinding, isFlagged, isTileWalkable, reachedLoc } from '../pathfinding.js';
import { collisionZones } from '../collision-store';   // flat [level, zoneX, zoneZ] * n (NOT the JSON import: Bun pins it)
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { locDims, locForceApproach } from './locmeta.js';

export interface RCoord { level: number; x: number; z: number }
export interface REdge { level: number; x: number; z: number; dest: RCoord; locId?: number; shape?: number; angle?: number; stand?: { x: number; z: number } }

const WALK_BLOCKED = 2359552;
const BW = 2359560, BE = 2359680, BS = 2359554, BN = 2359584, BSW = 2359566, BSE = 2359683, BNW = 2359608, BNE = 2359776;
const zk = (l: number, x: number, z: number) => l * 268435456 + (x >> 3) * 16384 + (z >> 3);

let zoneIdx: Map<number, number> | null = null;
let lab: Uint16Array | Int32Array | null = null;
let compSize: number[] = [];
let buildMs = 0;

function slot(l: number, x: number, z: number): number {
    const s = zoneIdx!.get(zk(l, x, z));
    return s === undefined ? -1 : s * 64 + ((x & 7) << 3) + (z & 7);
}

/** Label every tile (idempotent). ~2 s, ~17 MB (Uint16; Int32 if > 65,535 components). */
export function buildReach(): void {
    if (lab) return;
    initPathfinding();
    const t0 = performance.now();
    const Z = collisionZones(), nz = Z.length / 3;   // [level, zoneX, zoneZ] rows
    zoneIdx = new Map();
    for (let i = 0; i < Z.length; i += 3) zoneIdx.set(zk(Z[i]!, Z[i + 1]!, Z[i + 2]!), zoneIdx.size);
    const L = new Int32Array(nz * 64);   // 0 = not yet visited, -1 = blocked, >0 = component
    const floor = loadUpperFloor();   // planes 1-3: tiles with NO map data ("air") count as walls (see extract-upper-floor.ts)
    const sizes: number[] = [0];
    const q = new Int32Array(nz * 64 * 2 > 8_000_000 ? 8_000_000 : nz * 128);
    let next = 0;
    for (let zi = 0; zi < Z.length; zi += 3) {
        const l = Z[zi]!, zx = Z[zi + 1]!, zz = Z[zi + 2]!;
        for (let dx = 0; dx < 8; dx++) for (let dz = 0; dz < 8; dz++) {
            const x = zx + dx, z = zz + dz;
            const s = slot(l, x, z);
            if (L[s] !== 0) continue;
            if (isFlagged(x, z, l, WALK_BLOCKED) || (floor && l > 0 && !hasFloor(floor, l, x, z))) { L[s] = -1; continue; }
            const id = ++next; L[s] = id; let n = 1;
            let h = 0, t = 0; q[t++] = x; q[t++] = z;
            while (h < t) {
                const cx = q[h++]!, cz = q[h++]!;
                const w = !isFlagged(cx - 1, cz, l, BW), e = !isFlagged(cx + 1, cz, l, BE);
                const so = !isFlagged(cx, cz - 1, l, BS), no = !isFlagged(cx, cz + 1, l, BN);
                const visit = (nx: number, nz: number) => {
                    const ns = slot(l, nx, nz);
                    if (ns < 0 || L[ns] !== 0) return;
                    if (floor && l > 0 && !hasFloor(floor, l, nx, nz)) { L[ns] = -1; return; }
                    L[ns] = id; n++; q[t++] = nx; q[t++] = nz;
                };
                if (w) visit(cx - 1, cz);
                if (e) visit(cx + 1, cz);
                if (so) visit(cx, cz - 1);
                if (no) visit(cx, cz + 1);
                if (w && so && !isFlagged(cx - 1, cz - 1, l, BSW)) visit(cx - 1, cz - 1);
                if (e && so && !isFlagged(cx + 1, cz - 1, l, BSE)) visit(cx + 1, cz - 1);
                if (w && no && !isFlagged(cx - 1, cz + 1, l, BNW)) visit(cx - 1, cz + 1);
                if (e && no && !isFlagged(cx + 1, cz + 1, l, BNE)) visit(cx + 1, cz + 1);
            }
            sizes.push(n);
        }
    }
    if (next <= 65535) { const u = new Uint16Array(L.length); for (let i = 0; i < L.length; i++) u[i] = L[i]! > 0 ? L[i]! : 0; lab = u; }
    else { for (let i = 0; i < L.length; i++) if (L[i]! < 0) L[i] = 0; lab = L; }
    compSize = sizes;
    buildMs = Math.round(performance.now() - t0);
    edgeCache.clear();
}
// ⛔ DELIBERATE DEVIATION from "exactly what rsmod allows": the engine lets you walk on upper-plane air (it only blocks
// BLOCK_MAP_SQUARE land), so findLongPath could in theory route Draynor upstairs -> over the sea -> Brimhaven upstairs.
// No sane route does that and no planner output relies on it, but it made every island look reachable. With
// upper-floor.json present the gate treats air as wall (its "null" then also refuses such air routes); without the
// file the gate falls back to raw rsmod connectivity.
let floorCache: Map<string, Uint8Array> | null | undefined;
function loadUpperFloor(): Map<string, Uint8Array> | null {
    if (floorCache !== undefined) return floorCache;
    const p = fileURLToPath(new URL('./upper-floor.json', import.meta.url));
    if (!existsSync(p)) return floorCache = null;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
    floorCache = new Map(Object.entries(raw).map(([k, b]) => [k, new Uint8Array(Buffer.from(b, 'base64'))]));
    return floorCache;
}
function hasFloor(floor: Map<string, Uint8Array>, l: number, x: number, z: number): boolean {
    const bits = floor.get(`${x >> 6}_${z >> 6}_${l}`);
    if (!bits) return false;
    const i = ((x & 63) << 6) + (z & 63);
    return (bits[i >> 3]! & (1 << (i & 7))) !== 0;
}
export function resetReach(): void { lab = null; zoneIdx = null; compSize = []; edgeCache.clear(); override = null; }
export function reachStats() { return { built: !!lab, components: compSize.length - 1, buildMs }; }

/** Component id of a tile (0 = blocked / unallocated). */
export function componentAt(level: number, x: number, z: number): number {
    buildReach();
    const s = slot(level, x, z);
    if (s < 0) return 0;
    if (override) { const o = override.get(s); if (o !== undefined) return o; }
    return lab![s]!;
}

// NAV PHASE 3: v3 DOOR CUTS. A quest door that the base collision models OPEN (masked like any door) splits
// its component for graph 'v3' callers only: levels.ts closes the cut doors in the shared collision for the duration
// of a v3 query, and the labels of the smaller side are overridden here (a sparse slot -> component map, built once
// with the doors closed). With no override set (every non-v3 caller) componentAt is exactly the old lookup.
let override: Map<number, number> | null = null;
export function setReachOverride(o: Map<number, number> | null): void { override = o; }
function floodSlots(l: number, x0: number, z0: number, cap: number): Set<number> | null {
    const floor = loadUpperFloor();
    const s0 = slot(l, x0, z0);
    if (s0 < 0 || !lab![s0]) return new Set();
    const seen = new Set<number>([s0]);
    const q: number[] = [x0, z0];
    for (let h = 0; h < q.length; h += 2) {
        if (seen.size > cap) return null;
        const cx = q[h]!, cz = q[h + 1]!;
        const w = !isFlagged(cx - 1, cz, l, BW), e = !isFlagged(cx + 1, cz, l, BE);
        const so = !isFlagged(cx, cz - 1, l, BS), no = !isFlagged(cx, cz + 1, l, BN);
        const visit = (nx: number, nz: number) => {
            const ns = slot(l, nx, nz);
            if (ns < 0 || seen.has(ns) || !lab![ns] || isFlagged(nx, nz, l, WALK_BLOCKED)) return;   // + v3 hazard tiles blocked now
            if (floor && l > 0 && !hasFloor(floor, l, nx, nz)) return;
            seen.add(ns); q.push(nx, nz);
        };
        if (w) visit(cx - 1, cz);
        if (e) visit(cx + 1, cz);
        if (so) visit(cx, cz - 1);
        if (no) visit(cx, cz + 1);
        if (w && so && !isFlagged(cx - 1, cz - 1, l, BSW)) visit(cx - 1, cz - 1);
        if (e && so && !isFlagged(cx + 1, cz - 1, l, BSE)) visit(cx + 1, cz - 1);
        if (w && no && !isFlagged(cx - 1, cz + 1, l, BNW)) visit(cx - 1, cz + 1);
        if (e && no && !isFlagged(cx + 1, cz + 1, l, BNE)) visit(cx + 1, cz + 1);
    }
    return seen;
}
/** Build the override for `cuts` (each: the two tiles either side of a door). CALL WITH THE CUT DOORS CLOSED in the
 *  collision. Per cut: flood both sides (capped); if they no longer meet, the smaller finished side gets a fresh
 *  component id. Both sides over the cap = left merged (the gate stays optimistic, as before). */
export function cutOverride(cuts: Array<{ level: number; a: { x: number; z: number }; b: { x: number; z: number } }>, cap = 60_000): Map<number, number> {
    buildReach();
    const ov = new Map<number, number>();
    for (const c of cuts) {
        const sa = slot(c.level, c.a.x, c.a.z), sb = slot(c.level, c.b.x, c.b.z);
        if (sa < 0 || sb < 0 || ov.has(sa) || ov.has(sb)) continue;
        const A = floodSlots(c.level, c.a.x, c.a.z, cap);
        if (A && A.has(sb)) continue;   // still connected another way: no cut
        const B = floodSlots(c.level, c.b.x, c.b.z, cap);
        if (B && B.has(sa)) continue;
        const side = A && B ? (A.size <= B.size ? A : B) : (A ?? B);
        if (!side || !side.size) continue;
        const id = compSize.length; compSize.push(side.size);
        for (const s of side) ov.set(s, id);
    }
    return ov;
}
export function componentSize(c: number): number { buildReach(); return compSize[c] ?? 0; }
/** Every component within Chebyshev r of the tile (the tile itself included). */
export function componentsNear(level: number, x: number, z: number, r = 1): number[] {
    const out = new Set<number>();
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { const c = componentAt(level, x + dx, z + dz); if (c) out.add(c); }
    return [...out];
}
// ENTRANCE side, matched to what the planner can actually do (levels.ts):
//   * a `stand` portal (generic ladder face, transport) is approached ON that exact tile -> its component only;
//   * otherwise routeToPortal ends on a tile where the engine's reachedLoc accepts the op (footprint ring, walls,
//     forceapproach) -> the components of those ring tiles; PLUS every component within 1 of the origin, because a
//     chained hop falls back to "walk within 1 of the op tile" (plan() walkToGoal). Using reachedLoc instead of the
//     raw ring stops a ladder against a cave wall from "leaking" into the walkable VOID behind it (allocated zones
//     with no floor are walkable to rsmod: the z+6400 band and the upper planes hold 100k-1.2M-tile void components).
function entranceComps(e: REdge): number[] {
    if (e.stand) { const c = componentAt(e.level, e.stand.x, e.stand.z); return c ? [c] : []; }
    const { w, l } = locDims(e.locId);
    const m = Math.max(w, l);
    const shape = e.shape ?? 10, angle = e.angle ?? 0, fa = locForceApproach(e.locId);
    const out = new Set<number>(componentsNear(e.level, e.x, e.z, 1));
    for (let x = e.x - 1; x <= e.x + m; x++) for (let z = e.z - 1; z <= e.z + m; z++) {
        const c = componentAt(e.level, x, z);
        if (c && !out.has(c) && reachedLoc(e.level, x, z, e.x, e.z, w, l, angle, shape, fa)) out.add(c);
    }
    return [...out];
}
// EXIT side: the planner continues from the dest tile itself (findLongPath from p.dest); only a blocked dest tile can
// step out to any neighbour.
function exitComps(d: RCoord): number[] {
    const c = componentAt(d.level, d.x, d.z);
    if (c && isTileWalkable(d.level, d.x, d.z)) return [c];
    return componentsNear(d.level, d.x, d.z, 1);
}

// adjacency per edge LIST (keyed by the caller's list identity: the planner passes allPortals() or a stable
// per-capability concatenation, so this is built once per distinct list)
const edgeCache = new Map<REdge[], Map<number, number[]>>();
function adjacency(edges: REdge[]): Map<number, number[]> {
    let adj = edgeCache.get(edges);
    if (adj) return adj;
    buildReach();
    adj = new Map();
    for (const e of edges) {
        const outs = exitComps(e.dest);
        if (!outs.length) continue;
        for (const a of entranceComps(e)) {
            let list = adj.get(a);
            if (!list) adj.set(a, list = []);
            for (const b of outs) if (b !== a && !list.includes(b)) list.push(b);
        }
    }
    if (edgeCache.size > 32) edgeCache.clear();
    edgeCache.set(edges, adj);
    return adj;
}

/** Fewest portal hops from `from` to `to` over `edges` (0 = same component), or null if NO chain of edges connects
 *  them (within `maxHops`, default unbounded). Conservative: null => the planner cannot route it either. */
export function minPortals(from: RCoord, to: RCoord, edges: REdge[], maxHops = 64): number | null {
    buildReach();
    return minPortalsTo(from, new Set(componentsNear(to.level, to.x, to.z, 1)), edges, maxHops);
}
/** Same, to an explicit goal component set (e.g. entranceComponents of a portal). */
export function minPortalsTo(from: RCoord, goals: Set<number>, edges: REdge[], maxHops = 64): number | null {
    buildReach();
    const starts = componentAt(from.level, from.x, from.z) && isTileWalkable(from.level, from.x, from.z)
        ? [componentAt(from.level, from.x, from.z)] : componentsNear(from.level, from.x, from.z, 1);
    if (!starts.length || !goals.size) return null;
    for (const s of starts) if (goals.has(s)) return 0;
    const adj = adjacency(edges);
    const seen = new Set<number>(starts);
    let frontier = starts;
    for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
        const nextF: number[] = [];
        for (const c of frontier) for (const n of adj.get(c) ?? []) {
            if (seen.has(n)) continue;
            if (goals.has(n)) return hop;
            seen.add(n); nextF.push(n);
        }
        frontier = nextF;
    }
    return null;
}
export function entranceComponents(e: REdge): number[] { buildReach(); return entranceComps(e); }
export function exitComponents(d: RCoord): number[] { buildReach(); return exitComps(d); }

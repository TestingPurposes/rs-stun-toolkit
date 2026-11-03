// route-danger.ts — the ONE shared White Wolf Mountain danger list for navgrid.planRoute({ danger }).
//
// WHY: level-3 accounts crossing White Wolf Mountain (the only land link between
// Catherby/Seers/Ardougne and Taverley/Falador) kept dying to the aggressive wolves (acct14 twice near
// (2842,3500) on a Catherby -> Varrock West walk). Every planner carried a hand copy of ONE blob,
// { x: 2860, z: 3480, radius: 30, cost: 400 } ("Ardougne wolves / death spot"), which prices the whole
// mountain the same and says nothing about where the npcs really stand. This replaces that blob with one
// circle per REAL aggressive spawn.
//
// THE DATA (rev-289 content, headless/npc-scene.ts over the jm2 NPC sections + .npc configs):
// every type below is huntmode=cowardly (= aggressive to any player under 2x its level outside the
// wilderness, i.e. to every low-level account), check_vis=lineofsight. The engine (Npc.ts wander()):
// an npc wanders to startX/Z + random(-wanderrange..+wanderrange) on each axis (a SQUARE), and hunts
// players within huntrange of its CURRENT SW tile. So a spawn can acquire you up to
// wander + (size-1) + hunt tiles (Chebyshev) from its spawn tile.
//
// IS THERE A SAFE "OUTER EDGE"? NO — measured offline (sim/route-danger-geo.test.ts): the mountain is a
// ring of paths (west valley up, north rim along z~3525, east descent down x~2872), and EVERY walkable
// crossing enters at least one aggro zone. The minimum-exposure crossing (exhaustive Dijkstra over real
// collision) IS the outer edge, but it still passes:
//   - the north rim (z 3522-3530, x 2817-2855): inside the wander-20 wolf PACK's reach (Wolf x6 + Big Wolf),
//     plus one level-38 white wolf pair / ice giant edge near (2822,3524);
//   - the east descent (x 2872-2874, z 3433-3451): a 1-3 tile corridor with two level-25 white wolf
//     sentries ON it (2870,3438) and (2872,3445) — where acct3 died at (2876,3434).
// So these are COSTS, not hard blocks: a hard block would leave no crossing at all. With these zones the
// planner takes the outer edge (the min-exposure route, 52 exposed tiles vs 58 with the old blob,
// +10 tiles of walking); it cannot make the crossing safe for a level-3. Real safety for low levels =
// don't walk it (ship/teleport), or carry food + keep running.
//
// Cost model: navgrid adds `cost` (tenths of a tile) per step for EVERY zone a tile is in, so overlapping
// zones stack = "how many npcs can reach you here". 1500 = 150 tiles of detour per exposed step.

export interface DangerZone { x: number; z: number; radius: number; cost: number }

export interface AggroSpawn {
    id: number; name: string; level: number;
    x: number; z: number; size: number;
    /** NpcType wanderrange (square around the spawn tile). */
    wander: number;
    /** NpcType huntrange (from the npc's current SW tile). */
    hunt: number;
}

/** Every aggressive static spawn on/around White Wolf Mountain (rev 289; sim test checks this against npc-scene). */
export const WWM_SPAWNS: readonly AggroSpawn[] = [
    { id: 96, name: 'White wolf', level: 25, x: 2870, z: 3438, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry — ON the east descent
    { id: 96, name: 'White wolf', level: 25, x: 2872, z: 3445, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry — ON the east descent
    { id: 96, name: 'White wolf', level: 25, x: 2842, z: 3450, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry
    { id: 96, name: 'White wolf', level: 25, x: 2864, z: 3453, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry
    { id: 96, name: 'White wolf', level: 25, x: 2847, z: 3474, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry
    { id: 96, name: 'White wolf', level: 25, x: 2846, z: 3477, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry
    { id: 96, name: 'White wolf', level: 25, x: 2860, z: 3492, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry
    { id: 96, name: 'White wolf', level: 25, x: 2865, z: 3509, size: 2, wander: 3, hunt: 2 },  // whitewolf_sentry
    { id: 97, name: 'White wolf', level: 38, x: 2850, z: 3484, size: 2, wander: 3, hunt: 2 },  // whitewolf
    { id: 97, name: 'White wolf', level: 38, x: 2848, z: 3487, size: 2, wander: 3, hunt: 2 },  // whitewolf
    { id: 97, name: 'White wolf', level: 38, x: 2856, z: 3508, size: 2, wander: 3, hunt: 2 },  // whitewolf
    { id: 97, name: 'White wolf', level: 38, x: 2854, z: 3509, size: 2, wander: 3, hunt: 2 },  // whitewolf
    { id: 97, name: 'White wolf', level: 38, x: 2833, z: 3513, size: 2, wander: 3, hunt: 2 },  // whitewolf
    { id: 97, name: 'White wolf', level: 38, x: 2831, z: 3515, size: 2, wander: 3, hunt: 2 },  // whitewolf
    { id: 111, name: 'Ice giant', level: 53, x: 2811, z: 3506, size: 2, wander: 3, hunt: 2 },  // icegiant
    { id: 111, name: 'Ice giant', level: 53, x: 2804, z: 3507, size: 2, wander: 3, hunt: 2 },  // icegiant
    { id: 111, name: 'Ice giant', level: 53, x: 2824, z: 3510, size: 2, wander: 3, hunt: 2 },  // icegiant
    { id: 111, name: 'Ice giant', level: 53, x: 2817, z: 3514, size: 2, wander: 3, hunt: 2 },  // icegiant
    { id: 125, name: 'Ice warrior', level: 57, x: 2850, z: 3512, size: 1, wander: 3, hunt: 5 },  // icewarrior
    { id: 125, name: 'Ice warrior', level: 57, x: 2847, z: 3514, size: 1, wander: 3, hunt: 5 },  // icewarrior
    { id: 141, name: 'Big Wolf', level: 73, x: 2840, z: 3497, size: 2, wander: 20, hunt: 2 },  // wolfpack_leader
    { id: 142, name: 'Wolf', level: 25, x: 2836, z: 3495, size: 2, wander: 20, hunt: 2 },  // pack_wolf
    { id: 142, name: 'Wolf', level: 25, x: 2837, z: 3499, size: 2, wander: 20, hunt: 2 },  // pack_wolf
    { id: 142, name: 'Wolf', level: 25, x: 2839, z: 3502, size: 2, wander: 20, hunt: 2 },  // pack_wolf
    { id: 142, name: 'Wolf', level: 25, x: 2842, z: 3504, size: 2, wander: 20, hunt: 2 },  // pack_wolf
    { id: 142, name: 'Wolf', level: 25, x: 2839, z: 3506, size: 2, wander: 20, hunt: 2 },  // pack_wolf
    { id: 142, name: 'Wolf', level: 25, x: 2844, z: 3507, size: 2, wander: 20, hunt: 2 },  // pack_wolf
];

/** Per-step cost inside one spawn's zone (tenths of a tile). */
export const WWM_COST = 1500;

/** Circle for one spawn: centred on its footprint, radius = wander + hunt + size (covers the acquire reach). */
export function spawnZone(s: AggroSpawn, cost = WWM_COST): DangerZone {
    return { x: s.x + (s.size - 1) / 2, z: s.z + (s.size - 1) / 2, radius: s.wander + s.hunt + s.size, cost };
}

/** White Wolf Mountain danger circles — spread this where the old `{ x: 2860, z: 3480, radius: 30 }` stood. */
export const WWM_DANGER: DangerZone[] = WWM_SPAWNS.map(s => spawnZone(s));

// ---- RAW-FALLBACK GUARD ------------------------------------------------------------------------
// Every planner that falls back to the raw rsmod findLongPath when navgrid.planRoute returns null (the <=40-tile
// short-leg fallback in the quest planners, and the unconditional fallbacks in
// quest-runner, ...) walks a path that ignores `danger` entirely. On White Wolf Mountain navgrid often returns
// null on the tight ledges, so the raw path walked a level-3 (acct14, died twice at (2842,3500)) straight
// through the wolf pack. These pure helpers let every such fallback FAIL CLOSED: a raw path that enters an aggro
// circle is refused (the planner then tries a danger-aware detour or returns [] = "no route", which the walkers
// treat as stand + re-plan + unwedge ladder). Only WWM_DANGER is checked: those are the lethal aggressive
// spawns. The planners' other circles (Draynor jail guard, the r18 'Lumbridge' blob that covers the castle) are
// legacy COST blobs; refusing raw legs through them would wedge every short in-town leg in Lumbridge castle.

type XZ = { x: number; z: number };
const d2 = (x: number, z: number, d: DangerZone) => (x - d.x) * (x - d.x) + (z - d.z) * (z - d.z);

/** Is (x,z) inside any of the zones (default: the White Wolf Mountain aggro circles)? */
export function inDanger(x: number, z: number, zones: readonly DangerZone[] = WWM_DANGER): boolean {
    for (const d of zones) if (d2(x, z, d) <= d.radius * d.radius) return true;
    return false;
}

/**
 * Does walking `wps` from (sx,sz) step into danger? Walks EVERY tile of each straight/diagonal segment (the raw
 * planner returns turning points only, so checking the corners alone misses a corridor straight through a
 * circle). A tile "hits" a zone when it is inside the circle AND strictly closer to its centre than the start
 * is. For a start outside every circle that is simply "enters a circle"; for a bot that is ALREADY
 * inside one (the only crossing passes some circles, so a mid-crossing re-plan starts inside), it allows walking
 * out or along at the same depth, and refuses cutting deeper toward the spawn (the acct14 shape: from the rim of
 * the r24 pack circle straight through its centre). Standing still inside a circle is never the safer answer.
 */
export function pathHitsDanger(wps: readonly XZ[], sx: number, sz: number, zones: readonly DangerZone[] = WWM_DANGER): boolean {
    const near = zones.filter(d => {   // cheap reject: only zones the path's bounding box can touch
        let x0 = sx, x1 = sx, z0 = sz, z1 = sz;
        for (const w of wps) { if (w.x < x0) x0 = w.x; if (w.x > x1) x1 = w.x; if (w.z < z0) z0 = w.z; if (w.z > z1) z1 = w.z; }
        return d.x + d.radius >= x0 && d.x - d.radius <= x1 && d.z + d.radius >= z0 && d.z - d.radius <= z1;
    });
    if (!near.length) return false;
    const startD2 = near.map(d => d2(sx, sz, d));
    const hit = (x: number, z: number) => near.some((d, k) => { const e = d2(x, z, d); return e <= d.radius * d.radius && e < startD2[k]!; });
    let px = sx, pz = sz;
    for (const w of wps) {
        const n = Math.max(Math.abs(w.x - px), Math.abs(w.z - pz));
        for (let i = 1; i <= n; i++) if (hit(px + Math.round((w.x - px) * i / n), pz + Math.round((w.z - pz) * i / n))) return true;
        px = w.x; pz = w.z;
    }
    return false;
}

/** Underground starts/ends (z > 6000): navgrid has no data there and no WWM zone can be hit. */
export const UNDERGROUND_RAW_Z = 6000;

/**
 * THE guard for a raw-findLongPath fallback: may this raw path be returned? Underground legs always (navgrid
 * does not cover them, no circle is there); surface legs only when they do not walk into a WWM aggro circle.
 */
export function rawFallbackSafe(raw: readonly XZ[], sx: number, sz: number, dz: number, zones: readonly DangerZone[] = WWM_DANGER): boolean {
    if (dz > UNDERGROUND_RAW_Z || sz > UNDERGROUND_RAW_Z) return true;
    return !pathHitsDanger(raw, sx, sz, zones);
}

/**
 * A refused fallback must never be SILENT and must never re-run an expensive search every tick for a bot that
 * stands still (its start tile, hence its key, does not change). `refused(key)` = this exact leg was refused
 * within `ttlMs` (skip straight to "no route"); `note(key, what)` records + logs it once per TTL. Bounded.
 */
export class DangerRefusals {
    private m = new Map<string, number>();
    constructor(private ttlMs = 15_000, private max = 5_000, private log: (s: string) => void = s => console.error(s)) { }
    refused(key: string): boolean {
        const t = this.m.get(key);
        if (t === undefined) return false;
        if (Date.now() - t > this.ttlMs) { this.m.delete(key); return false; }
        return true;
    }
    note(key: string, what: string): void {
        if (this.m.size >= this.max) this.m.clear();
        this.m.set(key, Date.now());
        this.log(`[route-danger] ⛔ RAW FALLBACK REFUSED ${what} — it walks into a White Wolf Mountain aggro circle; no route for ${this.ttlMs / 1000}s (walker re-plans / unwedges)`);
    }
}

const sharedRefusals = new DangerRefusals();
/**
 * One-call guard for the simple per-process planners (`navgrid ... ; return findLongPath(...)`): returns `raw`
 * when it is safe (or empty), else [] — logged once per leg per TTL. `who` names the caller in the log.
 */
export function guardRaw<T extends XZ>(raw: T[], level: number, sx: number, sz: number, dx: number, dz: number, who = ''): T[] {
    if (!raw.length || rawFallbackSafe(raw, sx, sz, dz)) return raw;
    const k = `${level},${sx},${sz},${dx},${dz}`;
    if (!sharedRefusals.refused(k)) sharedRefusals.note(k, `${who} (${sx},${sz})->(${dx},${dz}) L${level}`.trim());
    return [];
}

/** Longest surface leg (Chebyshev tiles) a planner hands to the raw pathfinder when navgrid returns null. */
export const SHORT_RAW_LEG = 40;

/**
 * THE shared short-leg / underground raw fallback of the planners (e.g. quests-share mkPlanner), called after navgrid.planRoute returned null for every arrive. Underground: the raw path as is.
 * Surface legs <= SHORT_RAW_LEG: the raw path unless it walks into a WWM aggro circle — then [] (refused, logged
 * via `refusals`). Longer surface legs: [] (never bypass danger routing). Never throws past its caller's try.
 */
export function rawLegFallback(
    findLongPath: (level: number, sx: number, sz: number, dx: number, dz: number) => readonly XZ[],
    level: number, sx: number, sz: number, dx: number, dz: number,
    refusals: DangerRefusals = sharedRefusals, who = '',
): XZ[] {
    const underground = dz > UNDERGROUND_RAW_Z || sz > UNDERGROUND_RAW_Z;
    if (!underground && Math.max(Math.abs(dx - sx), Math.abs(dz - sz)) > SHORT_RAW_LEG) return [];
    const raw = findLongPath(level, sx, sz, dx, dz).map(w => ({ x: w.x, z: w.z }));
    if (!raw.length || rawFallbackSafe(raw, sx, sz, dz)) return raw;
    refusals.note(`${level},${sx},${sz},${dx},${dz}`, `${who} (${sx},${sz})->(${dx},${dz}) L${level}`.trim());
    return [];
}

/** The legacy single blob, kept ONLY so before/after comparisons (tests, route-compare) can name it. */
export const LEGACY_WWM_BLOB: DangerZone = { x: 2860, z: 3480, radius: 30, cost: 400 };

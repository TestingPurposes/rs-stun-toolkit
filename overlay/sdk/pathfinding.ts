// Local pathfinding using bundled collision data
import * as rsmod from '../server/vendor/rsmod-pathfinder';
import { CollisionType, CollisionFlag } from '../server/vendor/rsmod-pathfinder';
// NOT `import ... from './collision-data.json'`: Bun keeps an imported JSON's arrays alive for the process lifetime
// (+205-220 MB per process). collision-store reads the generated flat sdk/collision-data.bin instead.
import { loadCollisionTables, collisionDoors } from './collision-store';
import diagonalDoors from './navgrid/diagonal-doors.json';
import unopenableDoors from './navgrid/unopenable-doors.json';
import questGatedDoors from './navgrid/quest-gated-doors.json';   // hand-kept: doors a quest script locks/keys (not in the generated set)
import { reapplyDirectedBlocks } from './navgrid/edge-blocks';   // directed blocked-tiles.ts edges (blocked-edges.applyBlockedEdges)

let initialized = false;

export interface DoorInfo {
    level: number;
    x: number;
    z: number;
    shape: number;
    angle: number;
    blockrange: boolean;
}

interface TemporaryDoorBlock {
    door: DoorInfo;
    expiresAt: number;
}

/**
 * Session-owned evidence that a door is temporarily impassable.
 *
 * Entries expire automatically so a transient route failure cannot poison the
 * process-wide collision map for every bot until restart. This is the TTL
 * counterpart to `blockDoor()` below: `blockDoor` is a PERMANENT, process-wide
 * re-wall (right when the door is genuinely never passable, e.g. a locked or
 * quest-gated door); a blocklist instance is per-SDK-session and self-healing
 * (right when a door merely failed to open a few times just now).
 */
export class TemporaryDoorBlocklist {
    private entries = new Map<string, TemporaryDoorBlock>();

    constructor(private readonly now: () => number = Date.now) {}

    block(door: DoorInfo, ttlMs: number = 30_000): void {
        this.entries.set(doorKey(door.level, door.x, door.z), {
            door,
            expiresAt: this.now() + Math.max(0, ttlMs)
        });
    }

    active(): DoorInfo[] {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(key);
        }
        return [...this.entries.values()].map(entry => entry.door);
    }

    has(level: number, x: number, z: number): boolean {
        this.active();
        return this.entries.has(doorKey(level, x, z));
    }

    clear(): void {
        this.entries.clear();
    }
}

// Spatial index of all known door positions, keyed by "level,x,z"
const doorIndex = new Map<string, DoorInfo>();

// Zones that have at least one collision tile — zones with zero collision data
// are likely open ocean/void and should not be treated as walkable land.
const populatedZones = new Set<string>();

// One-way doors that should NOT be unmasked in the door index.
// These doors can only be opened from one side; routing through them traps the bot.
const ONE_WAY_DOORS = new Set<string>([
    '0,3108,3353', // Draynor Manor front door (west tile) — only opens from outside
    '0,3109,3353', // Draynor Manor front door (east tile) — only opens from outside
    '0,2924,9654', // Melzar's Maze basement 'funexit' door — only opens from the maze side
    '0,2927,9649', // Melzar's Maze basement 'funexit' door — only opens from the maze side
    '0,2931,9640', // Melzar's Maze basement 'funexit' door — only opens from the maze side
]);

function doorKey(level: number, x: number, z: number): string {
    return `${level},${x},${z}`;
}

export function initPathfinding(): void {
    if (initialized) return;
    const start = Date.now();
    const { tiles, zones, source, doorCount, diagCount, skippedOneWay, deadSkipped } = loadBaseCollision(false);
    initialized = true;
    installTrapGuard();
    console.log(`Pathfinding initialized in ${Date.now() - start}ms (${zones} zones, ${tiles} tiles from ${source}, ${doorCount} doors masked, ${diagCount} diagonal doors masked, ${skippedOneWay} one-way + ${deadSkipped} scriptless doors blocked)`);
}

// =====================================================================================================
// ⛔ WASM TRAP RECOVERY. LIVE: a bot threw
// "RuntimeError: Out of bounds memory access (wasm.findLongPath ...)" 5,500 times and went BRAIN-SILENT, with the
// test host's commit memory at 0.6 GB free. Proven offline: the FIRST findLongPath of a process allocates a ~40 MB search
// buffer (memory.grow); when that grow fails the call traps ("Unreachable code"), and a wasm trap never restores the
// shadow-stack pointer (~240 B leaked per trap). After ~4,370 traps the 1 MB stack is gone and EVERY call (any export)
// is "Out of bounds memory access" forever, even after memory frees up. So:
//   * initPathfinding pre-allocates that buffer (one tiny findLongPath), so the grow happens at boot, not mid-run;
//   * a trap re-instantiates the module (fresh memory + stack), rebuilds the base collision, replays every collision
//     edit made since init (the glue's journal: doors, blockDoor, edge blocks), retries the call ONCE, and on a second
//     failure answers "no path" with one log line (later traps inside the cooldown are counted, logged every 500th);
//     safe stop + clean logout + exit 3, so the lane restarts it); with no listener the process exits 3 itself. A bot
//     must never sit BRAIN-SILENT on a dead pathfinder.
// The guard itself lives in the vendored glue (patches/server__vendor__rsmod-pathfinder__rsmod-pathfinder.js.diff),
// =====================================================================================================
const PF_TRAP_EXIT = Math.max(1, Number(process.env.PF_TRAP_EXIT ?? 3));
const PF_RECOVER_COOLDOWN_MS = Math.max(0, Number(process.env.PF_RECOVER_COOLDOWN_MS ?? 10_000));
const guard = (rsmod as any).__guard as {
    onTrap: ((name: string, err: Error, retry: () => unknown) => unknown) | null;
    journal: Map<string, [string, unknown[]]> | null; poisoned: boolean; inject: number; raw: Record<string, (...a: unknown[]) => unknown>;
} | undefined;
export interface PathfinderHealth { traps: number; recoveries: number; failedRecoveries: number; streak: number; suppressed: number; dead: boolean; lastError: string; journal: number }
const pfHealth: PathfinderHealth = { traps: 0, recoveries: 0, failedRecoveries: 0, streak: 0, suppressed: 0, dead: false, lastError: '', journal: 0 };
let lastRecoverAt = -Infinity;
let recovering = false;
const deadListeners = new Set<(why: string) => void>();

/** Trap/recovery counters (dashboards, tests). `dead` = PF_TRAP_EXIT failed recoveries in a row. */
export function pathfinderHealth(): PathfinderHealth { return { ...pfHealth, journal: guard?.journal?.size ?? 0 }; }
/** Called once when the pathfinder is declared dead. Returns an unsubscribe. With NO listener the process exits 3. */
export function onPathfinderDead(cb: (why: string) => void): () => void { deadListeners.add(cb); return () => deadListeners.delete(cb); }
/** TESTS ONLY: make the next `n` wasm calls trap (a synthetic WebAssembly.RuntimeError), and reset the counters. */
export function __injectPathfinderTraps(n: number, opts: { reset?: boolean; cooldownMs?: number } = {}): void {
    if (!guard) throw new Error('rsmod glue has no __guard (patch not applied)');
    guard.inject = n;
    if (opts.reset) { Object.assign(pfHealth, { traps: 0, recoveries: 0, failedRecoveries: 0, streak: 0, suppressed: 0, dead: false, lastError: '' }); lastRecoverAt = -Infinity; }
    if (opts.cooldownMs !== undefined) testCooldownMs = opts.cooldownMs;
}
let testCooldownMs: number | undefined;

function installTrapGuard(): void {
    if (!guard) { console.error('[pathfinding] ⚠ rsmod glue has no __guard: wasm trap recovery is OFF (re-run install.ps1)'); return; }
    guard.journal = new Map();
    guard.onTrap = onTrap;
}

/** Fresh wasm instance + base collision + the journal replayed. Throws (and leaves the guard poisoned) on failure. */
function rebuildWasm(): void {
    const g = guard!;
    const journal = g.journal;
    recovering = true; g.journal = null; g.poisoned = false;
    try {
        (rsmod as any).__reinstantiate();
        loadBaseCollision(true);
        if (journal) for (const [name, args] of journal.values()) g.raw[name]!(...args);
        reapplyDirectedBlocks();
    } catch (e) {
        g.poisoned = true;
        throw e;
    } finally {
        g.journal = journal;
        recovering = false;
    }
}

function onTrap(name: string, err: Error, retry: () => unknown): unknown {
    if (recovering) throw err;   // a trap inside the rebuild aborts the rebuild (rebuildWasm catches it)
    pfHealth.traps++;
    pfHealth.lastError = `${name}: ${err?.message ?? err}`;
    const now = Date.now();
    if (now - lastRecoverAt < (testCooldownMs ?? PF_RECOVER_COOLDOWN_MS)) {
        // inside the cooldown: answer the fallback (no path), never a rebuild per call and never a log line per call
        if (pfHealth.suppressed++ % 500 === 0) console.error(`[pathfinding] ⛔ wasm still trapping inside the recovery cooldown (${pfHealth.suppressed} calls answered NO PATH): ${pfHealth.lastError}`);
        return undefined;
    }
    lastRecoverAt = now;
    console.error(`[pathfinding] ⛔ WASM TRAP #${pfHealth.traps} in ${pfHealth.lastError} — the instance is poisoned (a trap leaks its shadow stack); re-instantiating + rebuilding collision (${guard!.journal?.size ?? 0} journaled edits)`);
    let rebuilt = false;
    try { rebuildWasm(); rebuilt = true; } catch (e) { console.error(`[pathfinding] ⛔ rebuild FAILED: ${(e as Error)?.message ?? e}`); }
    if (rebuilt) {
        try {
            const v = retry();
            pfHealth.recoveries++; pfHealth.streak = 0;
            console.error(`[pathfinding] ✓ recovered in ${Date.now() - now} ms (fresh wasm instance; recovery #${pfHealth.recoveries}); ${name} retried OK`);
            return v;
        } catch (e2) {
            if (!(e2 instanceof WebAssembly.RuntimeError)) throw e2;
            console.error(`[pathfinding] ⛔ the retry trapped again on the fresh instance: ${(e2 as Error).message}`);
        }
    }
    pfHealth.failedRecoveries++; pfHealth.streak++;
    console.error(`[pathfinding] ⛔ recovery failed (${pfHealth.streak}/${PF_TRAP_EXIT} in a row): ${name} answers its fallback (no path / blocked)`);
    if (pfHealth.streak >= PF_TRAP_EXIT && !pfHealth.dead) {
        pfHealth.dead = true;
        const why = `${pfHealth.streak} failed wasm recoveries in a row (${pfHealth.traps} traps; last ${pfHealth.lastError})`;
        console.error(`[pathfinding] ⛔⛔ PATHFINDER DEAD: ${why}`);
        if (deadListeners.size === 0) { console.error('[pathfinding] no onPathfinderDead listener: exiting 3 so the lane restarts this process'); process.exit(3); }
        for (const cb of deadListeners) { try { cb(why); } catch (e) { console.error('[pathfinding] onPathfinderDead listener threw:', e); } }
    }
    return undefined;
}

/** The base collision (bin tables + door masks). rebuild=true: collision only (the door index / zone set are kept). */
function loadBaseCollision(rebuild: boolean) {
    // Flat tables (collision-store.ts): zones [level, zoneX, zoneZ], tiles [level, x, z, flags],
    // doors [level, x, z, shape, angle, blockrange]. Local only: the 20 MB tile table is dropped after init.
    const { zones: Z, tiles: T, doors: D, source } = loadCollisionTables();

    // Allocate all zones first (includes walkable areas with no collision tiles)
    for (let i = 0; i < Z.length; i += 3) {
        rsmod.allocateIfAbsent(Z[i + 1]!, Z[i + 2]!, Z[i]!);
    }

    // NOTE: there used to be a "mainland fill" here that allocated every
    // unallocated zone in x 2304-3392 / z 2944-3584 as OPEN, on the theory that
    // it was open grassland missing from the collision export.
    //
    // It was not. All 361 zones it opened fall inside mapsquares that have no
    // .jm2 file at all -- they are off-map void, and it made 23,104 tiles of
    // nothing walkable. Routes could be planned straight through them, and a bot
    // handed such a route walks at a tile it can never reach and stalls.
    //
    // Removing it costs nothing: findLongPath still reaches Falador and Ardougne
    // from Lumbridge without it (verified). Unallocated zones stay blocked, which
    // is what the server does.

    // Set collision flags for tiles that have them (includes wall flags)
    for (let i = 0; i < T.length; i += 4) {
        const level = T[i]!, x = T[i + 1]!, z = T[i + 2]!;
        rsmod.__set(x, z, level, T[i + 3]!);
        // Track which zones have at least one collision tile (likely land, not ocean)
        if (!rebuild) populatedZones.add(`${level},${x & ~7},${z & ~7}`);
    }

    // Remove wall collision at door/gate positions so the pathfinder
    // routes through doorways while still respecting permanent walls.
    // Uses rsmod.changeWall(add=false) — the same method the server uses
    // when doors are opened at runtime.
    // SCRIPTLESS "openable" doors: op says Open but no oploc handler exists (direct or via category),
    // so OPLOC does nothing live — leave them WALLED (the engine export unmasks all open-op wall locs,
    // which would otherwise let offline routes cross an edge that never opens live). Derived offline by
    // navgrid/extract-scripted-doors.mjs (10 map-wide; mostly instanced/quest locs).
    const deadDoors = new Set(([...unopenableDoors, ...questGatedDoors] as Array<{ level: number; x: number; z: number }>).map(d => doorKey(d.level, d.x, d.z)));
    let deadSkipped = 0;
    let doorCount = 0;
    let skippedOneWay = 0;
    {   // wall doors
        for (let i = 0; i < D.length; i += 6) {
            const level = D[i]!, x = D[i + 1]!, z = D[i + 2]!, shape = D[i + 3]!, angle = D[i + 4]!, blockrange = D[i + 5]!;
            const key = doorKey(level, x, z);

            // Skip one-way doors — keep their wall collision so the pathfinder
            // won't route through them (entering traps the bot).
            if (ONE_WAY_DOORS.has(key)) {
                skippedOneWay++;
                continue;
            }
            if (deadDoors.has(key)) { deadSkipped++; continue; }   // scriptless: never opens live

            rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
            // rebuild: keep the index as it is (blockDoor() removed its doors from it; the journal re-walls them)
            if (!rebuild) doorIndex.set(key, {
                level, x, z, shape, angle, blockrange: !!blockrange
            });
            doorCount++;
        }
    }

    // DIAGONAL (shape-9) openable doors — collision-data.json OMITS them (its engine-side generator
    // keeps only LocLayer.WALL doors), and changeWall is a NO-OP for shape 9 anyway: a diagonal door
    // blocks its WHOLE tile via the LOC layer (engine GameMap.changeLocCollision:353-358 ->
    // rsmod.changeLoc, flags 0x100|0x20000). Mirror the engine exactly: changeLoc(add=false) with
    // blockrange=true. Without this, everything behind a diagonal door is unreachable (the wizard-
    // tower ladder was sealed inside a 16-tile pocket). Set extracted offline by
    // navgrid/extract-diagonal-doors.mjs (22 map-wide).
    let diagCount = 0;
    for (const d of diagonalDoors as Array<{ level: number; x: number; z: number; locId: number; op: number; angle: number; leaf?: { x: number; z: number } }>) {
        const key = doorKey(d.level, d.x, d.z);
        if (ONE_WAY_DOORS.has(key)) { skippedOneWay++; continue; }
        rsmod.changeLoc(d.x, d.z, d.level, 1, 1, true, false, false);
        // OPEN-STATE PARITY: the live open script loc_adds the door LEAF (another full-tile diagonal
        // blocker) at the swing tile, so model the door as OPEN: door tile clear + leaf tile blocked.
        // Without this, routes thread the leaf tile and wedge live (the wizard-tower corridor: the
        // ONLY interior path with the door open is AROUND the leaf — live-verified tile-by-tile).
        if (d.leaf) rsmod.changeLoc(d.leaf.x, d.leaf.z, d.level, 1, 1, true, false, true);
        if (!rebuild) doorIndex.set(key, { level: d.level, x: d.x, z: d.z, shape: 9, angle: d.angle, blockrange: true });
        diagCount++;
    }

    // The __set above rewrote every tile: put back any DIRECTED edge blocks registered before this init ran
    // (applyBlockedEdges may run before a lazy initPathfinding; order must not matter). No-op if none.
    reapplyDirectedBlocks();

    // PRE-ALLOCATE findLongPath's ~40 MB search buffer NOW (one tiny search, Lumbridge): the first call of a process
    // grows wasm memory by ~40 MB, and a grow that fails mid-run is what poisoned the live module (see above). At boot a
    // failure is loud and the lane just restarts the process. PF_PREWARM=0 skips it (tools that never route).
    if (process.env.PF_PREWARM !== '0') rsmod.findLongPath(0, 3222, 3218, 3223, 3218, 1, 1, 1, 0, -1, true, 0, 2, CollisionType.NORMAL);

    return { zones: Z.length / 3, tiles: T.length / 4, source, doorCount, diagCount, skippedOneWay, deadSkipped };
}

// Check if a zone has collision data
export function isZoneAllocated(level: number, x: number, z: number): boolean {
    if (!initialized) {
        initPathfinding();
    }
    return rsmod.isZoneAllocated(x, z, level);
}

// Find long-distance path (2048x2048 search grid, ±1024 tile reach)
export function findLongPath(
    level: number,
    srcX: number,
    srcZ: number,
    destX: number,
    destZ: number,
    maxWaypoints: number = 500,
    blockedDoors: Iterable<DoorInfo> = []
): Array<{ x: number; z: number; level: number }> {
    if (!initialized) {
        initPathfinding();
    }

    // Re-apply only this caller's temporary door walls for the duration of this
    // synchronous query. The shared collision snapshot is restored in `finally`,
    // before another bot can pathfind. Doors already gone from the index were
    // permanently re-walled by blockDoor() — reverting those would silently undo
    // the permanent block, so skip them.
    const applied: DoorInfo[] = [];
    try {
        for (const door of blockedDoors) {
            if (!doorIndex.has(doorKey(door.level, door.x, door.z))) continue;
            setDoorClosed(door, true);
            applied.push(door);
        }

        const waypointsRaw = rsmod.findLongPath(
            level, srcX, srcZ, destX, destZ,
            1, 1, 1, 0, -1, true, 0, maxWaypoints, CollisionType.NORMAL
        );

        return unpackWaypoints(waypointsRaw);
    } finally {
        for (const door of applied) {
            setDoorClosed(door, false);
        }
    }
}

// session 11 fix 389 (rotate once): SR_NAV_ROT1=0 = the OLD odd-angle width/length pre-swap (rsmod then rotates twice). Default off.
const NAV_PRESWAP = (globalThis as any).process?.env?.SR_NAV_ROT1 === '0';

/**
 * Route to a LOC the way the ENGINE routes an op: dest = the loc's footprint (width/height at its
 * placement angle + shape), so the path ends on an INTERACTION-VALID tile — one from which the op
 * actually fires. Proximity is NOT interaction validity: the Lumbridge staircase's west-adjacent tile
 * is walkable but has a wall on its east edge, so OPLOC from it never fires (live-caught: the follower
 * re-OPLOC'd for 50 ticks from a tile the engine can never accept). Mirrors OpLoc's reachedLoc test.
 */
export function findPathToLoc(
    level: number, srcX: number, srcZ: number,
    locX: number, locZ: number, width: number, height: number, angle: number, shape: number,
    maxWaypoints: number = 500, blockAccess: number = 0
): Array<{ x: number; z: number; level: number }> {
    if (!initialized) initPathfinding();
    // session 11 fix 389 (rotate once): pass the UNROTATED width/length, exactly as the engine does (PathingEntity.ts:475 hands
    // target.width/length raw; rsmod's reach strategy rotates them by angle). The old odd-angle pre-swap here made rsmod rotate a
    // SECOND time: every non-square loc at angle 1/3 got a wrong footprint (TT escape cart 2682 at (3287,3023): op from (3286,3025)
    // judged in reach, engine says diagonal -> "I can't reach that!"). SR_NAV_ROT1=0 restores the old pre-swap.
    const w = NAV_PRESWAP && (angle & 1) === 1 ? height : width;
    const h = NAV_PRESWAP && (angle & 1) === 1 ? width : height;
    const raw = rsmod.findLongPath(level, srcX, srcZ, locX, locZ, 1, w, h, angle, shape, true, blockAccess, maxWaypoints, CollisionType.NORMAL);
    return unpackWaypoints(raw);
}

/**
 * Run `fn` with temporary full-tile collision at `tiles` (then revert). For routing AROUND live-only
 * blockers rsmod cannot know — an npc parked on a corridor tile (the nasty tree) defeats every
 * re-route because the collision model thinks its tile is open. SAFETY: only tiles that are currently
 * ENTERABLE get masked (adding+removing the LOC bit on an already-blocked tile would ERASE the real
 * map's collision on revert — checked via canTravel from any cardinal neighbour).
 */
export function withMaskedTiles<T>(level: number, tiles: Array<{ x: number; z: number }>, fn: () => T): T {
    if (!initialized) initPathfinding();
    const masked: Array<{ x: number; z: number }> = [];
    for (const t of tiles) {
        const enterable =
            rsmod.canTravel(level, t.x - 1, t.z, 1, 0, 1, 0, CollisionType.NORMAL) ||
            rsmod.canTravel(level, t.x + 1, t.z, -1, 0, 1, 0, CollisionType.NORMAL) ||
            rsmod.canTravel(level, t.x, t.z - 1, 0, 1, 1, 0, CollisionType.NORMAL) ||
            rsmod.canTravel(level, t.x, t.z + 1, 0, -1, 1, 0, CollisionType.NORMAL);
        if (!enterable) continue;
        rsmod.changeLoc(t.x, t.z, level, 1, 1, false, false, true);
        masked.push(t);
    }
    try { return fn(); }
    finally { for (const t of masked) rsmod.changeLoc(t.x, t.z, level, 1, 1, false, false, false); }
}

/** The engine's own "can I interact from here" test (rsmod.reached; UNROTATED dims, rsmod rotates them: fix 389 above). */
export function reachedLoc(
    level: number, srcX: number, srcZ: number,
    locX: number, locZ: number, width: number, height: number, angle: number, shape: number,
    blockAccess: number = 0   // the loc's FORCEAPPROACH byte (locmeta.locForceApproach) — the engine passes it too (Player.ts:1167)
): boolean {
    if (!initialized) initPathfinding();
    const w = NAV_PRESWAP && (angle & 1) === 1 ? height : width;   // session 11 fix 389 (rotate once)
    const h = NAV_PRESWAP && (angle & 1) === 1 ? width : height;
    return rsmod.reached(level, srcX, srcZ, locX, locZ, w, h, 1, angle, shape, blockAccess);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if a tile is walkable (no blocking flags). */
export function isTileWalkable(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    return !rsmod.isFlagged(x, z, level, CollisionFlag.WALK_BLOCKED);
}

/** Check if a tile has specific collision flags set. */
export function isFlagged(x: number, z: number, level: number, masks: number): boolean {
    if (!initialized) initPathfinding();
    return rsmod.isFlagged(x, z, level, masks);
}

/**
 * Check if the zone containing (x, z) has any collision tiles.
 * Zones with zero collision data are likely open ocean/void — real walkable
 * land always has some collision data (objects, walls, floor flags nearby).
 */
export function isZoneLikelyLand(level: number, x: number, z: number): boolean {
    return populatedZones.has(`${level},${x & ~7},${z & ~7}`);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DOOR PATH ANALYSIS — identify doors a computed path crosses through
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Given a list of waypoints, return the doors the path passes through or
 * steps adjacent to (wall collision is directional so the path may step
 * beside a door tile rather than onto it).  Results are in path order.
 */
export function findDoorsAlongPath(
    waypoints: Array<{ x: number; z: number; level: number }>
): DoorInfo[] {
    const doors: DoorInfo[] = [];
    const seen = new Set<string>();

    for (const wp of waypoints) {
        // Check the waypoint tile and its 4 cardinal neighbours
        const candidates = [
            doorKey(wp.level, wp.x, wp.z),
            doorKey(wp.level, wp.x, wp.z + 1),
            doorKey(wp.level, wp.x, wp.z - 1),
            doorKey(wp.level, wp.x + 1, wp.z),
            doorKey(wp.level, wp.x - 1, wp.z),
        ];
        for (const key of candidates) {
            if (!seen.has(key) && doorIndex.has(key)) {
                seen.add(key);
                doors.push(doorIndex.get(key)!);
            }
        }
    }

    return doors;
}

/** Look up a door at an exact position. */
export function getDoorAt(level: number, x: number, z: number): DoorInfo | undefined {
    // The index is only populated by initPathfinding(); without this guard the first
    // caller (SDK.blockDoorTemporarily) would silently see "no door here".
    if (!initialized) initPathfinding();
    return doorIndex.get(doorKey(level, x, z));
}

/**
 * Coordinates of every door the pathfinder UNMASKS (wall doors from collision-data + the diagonal
 * set), i.e. every door a computed route may pass through. Bots must be willing to OPLOC exactly
 * these when stalled — a junk-classified loc id at one of these coordinates is a REAL travel door
 * there (the wizard tower's 1536 doors were junk-filtered while the route required them: wedge).
 * Static (no initPathfinding needed): built from the same door table the init loop reads.
 */
let knownDoorCache: Set<string> | null = null;
export function knownDoorCoords(): Set<string> {
    if (knownDoorCache) return knownDoorCache;
    const s = new Set<string>();   // keyed "level,x,z" — a door at (x,z) on L0 vs L1 is a distinct obstacle
    const D = collisionDoors();   // [level, x, z, shape, angle, blockrange] * n
    for (let i = 0; i < D.length; i += 6) {
        const level = D[i]!, x = D[i + 1]!, z = D[i + 2]!;
        if (!ONE_WAY_DOORS.has(doorKey(level, x, z))) s.add(`${level},${x},${z}`);
    }
    for (const d of diagonalDoors as Array<{ level: number; x: number; z: number }>) {
        if (!ONE_WAY_DOORS.has(doorKey(d.level, d.x, d.z))) s.add(`${d.level},${d.x},${d.z}`);
    }
    knownDoorCache = s;
    return s;
}

/**
 * Flip a door between the pathfinder's CLOSED (impassable) and OPEN (passable) collision models.
 * Shared by the permanent `blockDoor()` and the per-query temporary blocklist so both stay in
 * engine parity — in particular shape 9 (diagonal), where `changeWall` is a silent no-op because a
 * diagonal door blocks its WHOLE tile via the LOC layer and its open state also blocks the swing
 * leaf tile. `closed=false` restores exactly what initPathfinding() laid down.
 */
function setDoorClosed(door: DoorInfo, closed: boolean): void {
    const { level, x, z } = door;
    if (door.shape === 9) {
        // CLOSED: door tile blocked, swing leaf clear. OPEN: door tile clear, leaf blocked.
        rsmod.changeLoc(x, z, level, 1, 1, door.blockrange, false, closed);
        const leaf = (diagonalDoors as Array<{ level: number; x: number; z: number; leaf?: { x: number; z: number } }>)
            .find(d => d.level === level && d.x === x && d.z === z)?.leaf;
        if (leaf) rsmod.changeLoc(leaf.x, leaf.z, level, 1, 1, true, false, !closed);
    } else {
        rsmod.changeWall(x, z, level, door.angle, door.shape, door.blockrange, false, closed);
    }
    // changeWall(add=false) clears the door's wall bits on BOTH tiles, which can include a directed edge block
    // (sdk/navgrid/edge-blocks.ts) on the same side. Re-OR them (idempotent, ~1 wasm call per edge).
    reapplyDirectedBlocks();
}

/**
 * Re-add wall collision for a door that couldn't be opened (e.g. locked).
 * This causes the pathfinder to route around it on subsequent queries.
 * Also removes the door from the index so findDoorsAlongPath won't return it.
 *
 * PERMANENT and PROCESS-WIDE — it mutates the shared collision map for every bot in this process
 * until restart. For a door that merely failed to open right now, use a TemporaryDoorBlocklist
 * (per-session, TTL-expiring) and pass it to findLongPath instead.
 */
export function blockDoor(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    const key = doorKey(level, x, z);
    const door = doorIndex.get(key);
    if (!door) return false;
    setDoorClosed(door, true);
    doorIndex.delete(key);
    return true;
}

// Unpack waypoints from rsmod format
function unpackWaypoints(waypointsRaw: Uint32Array): Array<{ x: number; z: number; level: number }> {
    const waypoints: Array<{ x: number; z: number; level: number }> = [];
    for (let i = 0; i < waypointsRaw.length; i++) {
        const packed = waypointsRaw[i]!;
        waypoints.push({
            z: packed & 0x3FFF,
            x: (packed >> 14) & 0x3FFF,
            level: (packed >> 28) & 0x3
        });
    }
    return waypoints;
}

// Bakes navgrid.bin (v2, see format.ts): per-tile surface class + wall clearance for EVERY level and
// every mapsquare that has collision data -- the overworld, the z+6400 underground, the instanced
// interiors and the upper floors.
//
//   bun sdk/navgrid/build.ts [--jag=path/to/worldmap.jag] [--legacy-v1=old.bin] [--server=<url, only to fetch explicitly>] [--out=path]
//
// Surface source, in order: --jag, then the local pack (server/engine/data/pack/mapview/worldmap.jag),
// and only if neither exists AND --server=<url> is given, a fetch from that server (never implicit).
//
// Clearance is how far a tile sits from the nearest blocked tile (capped at 15).
// The router uses it to stop hugging walls and fences, which is what drops a
// drifted bot into a one-exit pocket.
import { existsSync } from 'fs';
import * as rsmod from '../../server/vendor/rsmod-pathfinder';
import { CollisionType } from '../../server/vendor/rsmod-pathfinder';
import collisionData from '../collision-data.json';
import { fetchSurfaceSquares, loadSurfaceSquares, surfaceSquareKey, Surface } from './surface.js';
import {
    MIN_X, MIN_Z, MAX_X, MAX_Z, LEVELS, CHUNK, CHUNK_CELLS, UNDERGROUND_Z, MAX_CLEARANCE, NAVGRID_PATH, LEGACY,
    packCell, encodeNavgrid, type ChunkDir,
} from './format.js';

interface CollisionData {
    tiles: Array<[number, number, number, number]>;
    zones: Array<[number, number, number]>;
    doors?: Array<[number, number, number, number, number, number]>;
}

const args = process.argv.slice(2);
const serverArg = args.find(a => a.startsWith('--server='))?.slice('--server='.length);
const jagArg = args.find(a => a.startsWith('--jag='))?.slice('--jag='.length);
const outArg = args.find(a => a.startsWith('--out='))?.slice('--out='.length);
// --legacy-v1=<v1 navgrid.bin>: copy that file's cells verbatim over the v1 window (level 0,
// x 1792..3583, z 2816..5631), so every route planned against v1 stays byte-identical. Without
// it the window is re-baked from today's collision-data.json (which moves 52 water-tile
// clearances in Taverley lake + 28 tiles on the x 3583 seam that now see Morytania's walls).
const legacyArg = args.find(a => a.startsWith('--legacy-v1='))?.slice('--legacy-v1='.length);
const legacy = legacyArg ? new Uint8Array(await Bun.file(legacyArg).arrayBuffer()) : null;
if (legacy && legacy.length !== LEGACY.WIDTH * LEGACY.HEIGHT) throw new Error(`--legacy-v1: ${legacyArg} is not a v1 navgrid.bin (${legacy.length} bytes)`);
let legacyCells = 0;
const LOCAL_JAG = new URL('../../server/engine/data/pack/mapview/worldmap.jag', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const t0 = Date.now();
const jagPath = jagArg ?? (existsSync(LOCAL_JAG) ? LOCAL_JAG : null);
if (!jagPath && !serverArg) {
    throw new Error(`no local worldmap.jag at ${LOCAL_JAG}: pass --jag=<path> (preferred) or --server=<url> to fetch one explicitly`);
}
console.log(`decoding worldmap surface from ${jagPath ?? `${serverArg} (FETCHED)`}...`);
const surface = jagPath
    ? await loadSurfaceSquares(jagPath)
    : await fetchSurfaceSquares(serverArg!);
console.log(`  ${surface.size} surface squares`);

// --- Load collision into rsmod.
//
// Collision is the ONLY authority on where a bot can stand. Surface data is not:
// 77% of tiles carry no underlay (so they'd read as "void" despite being real
// floor), and water tiles have walkable bridges over them. Surface is used for
// cost preference only.
//
// Note we deliberately do NOT reproduce the old mainland fill from
// sdk/pathfinding.ts, which opened 361 zones as walkable OPEN. Every one of them
// contains zero land -- it invented 23,104 phantom walkable tiles that routes
// could be planned straight through. Unallocated zones stay blocked, as intended.
console.log('loading collision...');
const data = collisionData as CollisionData;

const sq = (level: number, x: number, z: number): number => surfaceSquareKey(level, x >> 6, z >> 6);
const allocated = new Set<number>();     // squares with any zone, per level
const flagged = new Set<number>();       // squares with any collision flag or door, per level
for (const [level, zoneX, zoneZ] of data.zones) {
    rsmod.allocateIfAbsent(zoneX, zoneZ, level);
    allocated.add(sq(level, zoneX, zoneZ));
}
for (const [level, x, z, flags] of data.tiles) {
    rsmod.__set(x, z, level, flags);
    if (flags) flagged.add(sq(level, x, z));
}
console.log(`  ${data.zones.length.toLocaleString()} zones, ${data.tiles.length.toLocaleString()} collision tiles`);

// Doors must be unmasked before measuring clearance, or every doorway reads as a
// wall and the router would refuse to path through its own doors. (v1 did this for
// level 0 only, since it only baked level 0.)
let doors = 0;
for (const [level, x, z, shape, angle, blockrange] of data.doors ?? []) {
    rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
    flagged.add(sq(level, x, z));
    doors++;
}
console.log(`  ${doors.toLocaleString()} doors unmasked`);

// Which squares get a chunk. Level 0: every allocated square (as v1 had them all, densely). Levels 1-3:
// the server allocates every square on every level, and a square with no wall, loc or door on an upper
// level is pure "air" -- standable to rsmod, but nothing leads there and no route should cross it.
const keep = (level: number, mx: number, mz: number): boolean => {
    const k = surfaceSquareKey(level, mx, mz);
    return allocated.has(k) && (level === 0 || flagged.has(k));
};

const W = MAX_X - MIN_X, H = MAX_Z - MIN_Z;
const dir: ChunkDir[] = [];
const chunks: Uint8Array[] = [];
const blocked = new Uint8Array(W * H);
const clearance = new Uint8Array(W * H);
const queue = new Int32Array(W * H);
const counts = new Map<number, number>();

for (let level = 0; level < LEVELS; level++) {
    // --- Blocked mask: a tile is blocked if you cannot stand on it (or has no chunk).
    // Probed via rsmod so wall/loc/floor semantics stay exactly the server's.
    blocked.fill(1);
    const squares: Array<[number, number]> = [];
    for (let mz = MIN_Z >> 6; mz < MAX_Z >> 6; mz++) {
        for (let mx = MIN_X >> 6; mx < MAX_X >> 6; mx++) {
            const kept = keep(level, mx, mz);
            if (kept) squares.push([mx, mz]);
            // An upper-level "air" square we drop is a wall to the router, so it is a wall here too.
            else if (allocated.has(surfaceSquareKey(level, mx, mz))) continue;
            // An UNALLOCATED square is blocked, except that rsmod lets a tile on its rim step OUT into an
            // allocated neighbour, so v1's probe counted those rim tiles standable (never enterable, so
            // never routed through). Probe the rim too, so clearance next to it matches v1 exactly.
            for (let lz = 0; lz < CHUNK; lz++) {
                for (let lx = 0; lx < CHUNK; lx++) {
                    if (!kept && lz !== 0 && lz !== CHUNK - 1 && lx !== 0 && lx !== CHUNK - 1) continue;
                    const x = (mx << 6) + lx, z = (mz << 6) + lz;
                    // A tile you cannot step out of in any direction is not standable.
                    const standable =
                        rsmod.canTravel(level, x, z, 1, 0, 1, 0, CollisionType.NORMAL) ||
                        rsmod.canTravel(level, x, z, -1, 0, 1, 0, CollisionType.NORMAL) ||
                        rsmod.canTravel(level, x, z, 0, 1, 1, 0, CollisionType.NORMAL) ||
                        rsmod.canTravel(level, x, z, 0, -1, 1, 0, CollisionType.NORMAL);
                    if (standable) blocked[(z - MIN_Z) * W + (x - MIN_X)] = 0;
                }
            }
        }
    }

    // --- Multi-source BFS distance transform from every blocked tile.
    clearance.fill(MAX_CLEARANCE);
    let head = 0, tail = 0;
    for (let i = 0; i < blocked.length; i++) {
        if (blocked[i]) { clearance[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
        const i = queue[head++]!;
        const d = clearance[i]!;
        if (d >= MAX_CLEARANCE) continue;
        const ix = i % W, iz = (i / W) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = ix + dx, nz = iz + dz;
            if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
            const n = nz * W + nx;
            if (clearance[n]! > d + 1) { clearance[n] = d + 1; queue[tail++] = n; }
        }
    }

    // --- Pack: one byte per tile, surface in the low nibble, clearance in the high.
    let standableTiles = 0;
    for (const [mx, mz] of squares) {
        const surf = surface.get(surfaceSquareKey(level, mx, mz));
        const out = new Uint8Array(CHUNK_CELLS);
        for (let lz = 0; lz < CHUNK; lz++) {
            for (let lx = 0; lx < CHUNK; lx++) {
                const x = (mx << 6) + lx, z = (mz << 6) + lz;
                const i = (z - MIN_Z) * W + (x - MIN_X);
                let s = (surf?.[lz * CHUNK + lx] ?? Surface.VOID) as Surface;
                if (!blocked[i]) standableTiles++;
                // No surface data off the overworld: a standable tile there is real floor, not void.
                // (The overworld keeps v1's classes byte for byte, VOID floors included.)
                if (s === Surface.VOID && !blocked[i] && (level > 0 || z >= UNDERGROUND_Z)) s = Surface.FLOOR;
                out[lz * CHUNK + lx] = packCell(s, clearance[i]!);
                if (legacy && level === 0) {
                    const ix = x - LEGACY.MIN_X, iz = z - LEGACY.MIN_Z;
                    if (ix >= 0 && iz >= 0 && ix < LEGACY.WIDTH && iz < LEGACY.HEIGHT) {
                        const old = legacy[iz * LEGACY.WIDTH + ix]!;
                        if (old !== out[lz * CHUNK + lx]) legacyCells++;
                        out[lz * CHUNK + lx] = old;
                        s = (old & 0x0f) as Surface;
                    }
                }
                counts.set(s, (counts.get(s) ?? 0) + 1);
            }
        }
        dir.push({ level, mx, mz });
        chunks.push(out);
    }
    console.log(`  level ${level}: ${squares.length} chunks, ${standableTiles.toLocaleString()} standable tiles`);
}

console.log(
    `  land=${(counts.get(Surface.LAND) ?? 0).toLocaleString()}` +
    ` road=${(counts.get(Surface.ROAD) ?? 0).toLocaleString()}` +
    ` path=${(counts.get(Surface.PATH) ?? 0).toLocaleString()}` +
    ` water=${(counts.get(Surface.WATER) ?? 0).toLocaleString()}` +
    ` floor=${(counts.get(Surface.FLOOR) ?? 0).toLocaleString()}` +
    ` void=${(counts.get(Surface.VOID) ?? 0).toLocaleString()}`
);

if (legacy) console.log(`  --legacy-v1: kept ${legacyCells} v1 cells that a fresh bake would have changed`);

const bin = encodeNavgrid(dir, chunks);
const outPath = outArg ?? NAVGRID_PATH;
await Bun.write(outPath, bin);
console.log(`\nwrote ${outPath} (${(bin.length / 1e6).toFixed(2)} MB, ${dir.length} chunks of ${CHUNK}x${CHUNK}, levels 0-${LEVELS - 1}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

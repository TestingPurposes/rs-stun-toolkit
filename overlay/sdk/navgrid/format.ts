// Shared layout for navgrid.bin, so the builder and the runtime can't drift.
//
// v2 (2026-10): SPARSE, PER-MAPSQUARE, ALL FOUR LEVELS. v1 was one dense level-0 block over
// x 1792..3583 / z 2816..5631, so anything east of x 3584, below z 2816, underground (the z+6400
// convention) or upstairs fell back to the raw rsmod BFS. v2 stores one 64x64 chunk (one mapsquare)
// per (level, mx, mz) that has collision data, which covers the whole collision extent in less space
// than the v1 rectangle did:
//
//   0   'NAVG'                      magic
//   4   u16 version (=2), u16 chunk side (=64)
//   8   u32 chunkCount
//   12  chunkCount x [u8 level, u8 mx, u8 mz, u8 0]   directory, sorted by (level, mz, mx)
//   ..  chunkCount x 4096 cells, cell (lx, lz) at lz*64 + lx
//
// A cell is one byte: surface class in the low nibble, wall clearance in the high (unchanged from v1).
// Runtime cell ids are `slot * 4096 + lz * 64 + lx`, i.e. offsets into the cell region.
import { Surface } from './surface.js';

/** Mapsquare-aligned extent of sdk/collision-data.json (mx 28..56, mz 20..161), every level. */
export const MIN_X = 1792;
export const MIN_Z = 1280;
export const MAX_X = 3648;   // exclusive
export const MAX_Z = 10368;  // exclusive
export const LEVELS = 4;

export const CHUNK_SHIFT = 6;
export const CHUNK = 1 << CHUNK_SHIFT;          // 64 tiles: one mapsquare
export const CHUNK_CELLS = CHUNK * CHUNK;       // 4096
export const MX0 = MIN_X >> CHUNK_SHIFT;        // 28
export const MZ0 = MIN_Z >> CHUNK_SHIFT;        // 20
export const MSQ_W = (MAX_X - MIN_X) >> CHUNK_SHIFT;  // 29
export const MSQ_H = (MAX_Z - MIN_Z) >> CHUNK_SHIFT;  // 142

/** Everything at z >= this on level 0 is the underground ("z+6400") stratum. */
export const UNDERGROUND_Z = 6400;

/** The v1 dense window (level 0 only), kept for docs/tests that compare against it. */
export const LEGACY = { MIN_X: 1792, MIN_Z: 2816, WIDTH: 1792, HEIGHT: 2816 } as const;

export const MAGIC = 0x4e415647; // 'NAVG'
export const VERSION = 2;
export const HEADER_BYTES = 12;

/** Clearance saturates here; it only has to be big enough to steer routes. */
export const MAX_CLEARANCE = 15;

export const NAVGRID_PATH = new URL('./navgrid.bin', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function packCell(surface: Surface, clearance: number): number {
    return (surface & 0x0f) | ((Math.min(clearance, MAX_CLEARANCE) & 0x0f) << 4);
}

export function cellSurface(cell: number): Surface {
    return (cell & 0x0f) as Surface;
}

export function cellClearance(cell: number): number {
    return (cell >> 4) & 0x0f;
}

/**
 * Inside the navgrid's extent (any level 0-3). Geometric only: a mapsquare with no collision data
 * inside the extent still has no chunk, and the router answers null there exactly as before.
 */
export function inBounds(x: number, z: number, level = 0): boolean {
    return x >= MIN_X && z >= MIN_Z && x < MAX_X && z < MAX_Z && level >= 0 && level < LEVELS;
}

/** Index into a per-level mapsquare table of LEVELS * MSQ_H * MSQ_W entries (caller checks bounds). */
export function squareKey(level: number, mx: number, mz: number): number {
    return (level * MSQ_H + (mz - MZ0)) * MSQ_W + (mx - MX0);
}

export interface ChunkDir {
    level: number;
    mx: number;
    mz: number;
}

/** Serialise a v2 navgrid. `chunks[i]` must be CHUNK_CELLS bytes, matching `dir[i]`. */
export function encodeNavgrid(dir: ChunkDir[], chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(HEADER_BYTES + dir.length * 4 + dir.length * CHUNK_CELLS);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, MAGIC);
    dv.setUint16(4, VERSION);
    dv.setUint16(6, CHUNK);
    dv.setUint32(8, dir.length);
    let p = HEADER_BYTES;
    for (const d of dir) { out[p++] = d.level; out[p++] = d.mx; out[p++] = d.mz; out[p++] = 0; }
    for (const c of chunks) { out.set(c, p); p += CHUNK_CELLS; }
    return out;
}

export interface DecodedNavgrid {
    dir: ChunkDir[];
    /** All chunk cells, back to back: cell id = slot * CHUNK_CELLS + lz * CHUNK + lx. */
    cells: Uint8Array;
}

export function decodeNavgrid(buf: Uint8Array): DecodedNavgrid {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (buf.length < HEADER_BYTES || dv.getUint32(0) !== MAGIC) {
        throw new Error(
            `navgrid.bin is not a v${VERSION} navgrid (${buf.length} bytes; a v1 file was ${LEGACY.WIDTH * LEGACY.HEIGHT}). ` +
            `Re-run: bun sdk/navgrid/build.ts --jag=server/engine/data/pack/mapview/worldmap.jag`
        );
    }
    const version = dv.getUint16(4);
    const side = dv.getUint16(6);
    if (version !== VERSION || side !== CHUNK) throw new Error(`navgrid.bin: unsupported version ${version} / chunk ${side}`);
    const n = dv.getUint32(8);
    const dir: ChunkDir[] = [];
    let p = HEADER_BYTES;
    for (let i = 0; i < n; i++) { dir.push({ level: buf[p]!, mx: buf[p + 1]!, mz: buf[p + 2]! }); p += 4; }
    if (buf.length !== p + n * CHUNK_CELLS) throw new Error(`navgrid.bin is truncated (${buf.length} bytes, expected ${p + n * CHUNK_CELLS})`);
    return { dir, cells: buf.subarray(p) };
}

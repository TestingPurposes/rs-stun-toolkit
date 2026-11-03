// Decodes the mapview's worldmap.jag into per-tile surface data.
//
// This is the only source in the repo for what a tile is *made of* (road, water,
// grass, void). Collision tells us where we can step; surface tells us where we
// *want* to step, and which zones are real land vs open ocean.
import BZip2 from '../../server/engine/src/io/BZip2.js';

// Floor type ids, from server/content/pack/flo.pack.
export const ROAD_OVERLAYS = new Set([
    9,  // road
    10, // darkstone   <- what actually paints the overworld roads
    33, // road_bridge
    43, // road_no_occlude
]);

export const PATH_OVERLAYS = new Set([
    14, // mudfloor_bump   - dirt tracks
    16, // mudfloor2_bump
    105, 109, 184, 189, // oldbrick / brick / *_no_occlude - city streets
]);

export const WATER_OVERLAYS = new Set([
    5,  // water
    6,  // gungywater
    18, // lava
]);

function genHash(name: string): number {
    let hash = 0;
    for (const ch of name.toUpperCase()) hash = (hash * 61 + ch.charCodeAt(0) - 32) | 0;
    return hash;
}

class Reader {
    pos = 0;
    constructor(readonly d: Uint8Array) {}
    g1(): number { return this.d[this.pos++]!; }
    g2(): number { return (this.g1() << 8) | this.g1(); }
    g3(): number { return (this.g1() << 16) | (this.g1() << 8) | this.g1(); }
    g4s(): number { return (this.g1() << 24) | (this.g1() << 16) | (this.g1() << 8) | this.g1(); }
    get available(): number { return this.d.length - this.pos; }
}

function openJag(raw: Uint8Array): Map<number, Uint8Array> {
    const head = new Reader(raw);
    const unpackedSize = head.g3();
    const packedSize = head.g3();
    const compressWhole = unpackedSize !== packedSize;

    const body = compressWhole ? BZip2.decompress(raw.subarray(6), unpackedSize, true) : raw;
    const src = new Reader(body);
    if (!compressWhole) src.pos = 6;

    const count = src.g2();
    const entries = new Map<number, Uint8Array>();
    let pos = src.pos + count * 10;

    for (let i = 0; i < count; i++) {
        const hash = src.g4s();
        const unpacked = src.g3();
        const packed = src.g3();
        const slice = body.subarray(pos, pos + packed);
        entries.set(hash, compressWhole ? slice : BZip2.decompress(slice, unpacked, true));
        pos += packed;
    }
    return entries;
}

// The mapview stacks underground mapsquares below the overworld so the whole
// world fits one image. Undo that remap to recover true world coordinates;
// squares that were remapped are not overworld and we skip them.
function realMz(rawMz: number): { mz: number; overworld: boolean } {
    if (rawMz >= 144) return { mz: rawMz - 82, overworld: false };
    if (rawMz >= 70 && rawMz <= 76) return { mz: rawMz + 10, overworld: false };
    return { mz: rawMz, overworld: true };
}

export const enum Surface {
    VOID = 0,  // no land at all - ocean, off-map
    LAND = 1,  // ordinary walkable terrain (grass, floors)
    PATH = 2,  // dirt track / city street - mildly preferred
    ROAD = 3,  // real road surface - strongly preferred
    WATER = 4, // water or lava - never walk
    /**
     * Standable (per collision) but no surface data: underground (z+6400) tiles without an
     * underlay, and every standable tile on levels 1-3 (the worldmap only records level 0).
     * Costs exactly like LAND/VOID; it only says "real floor, not void".
     */
    FLOOR = 5,
}

export interface SurfaceMap {
    readonly minX: number;
    readonly minZ: number;
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array; // Surface, indexed [(z - minZ) * width + (x - minX)]
    at(x: number, z: number): Surface;
}

/** Decode worldmap.jag into a level-0 surface map in true world coordinates. */
export function decodeSurface(raw: Uint8Array): SurfaceMap {
    const jag = openJag(raw);

    // Matches MapView's window: 28<<6 .. and 44<<6 ..
    const minX = 1792, minZ = 2816;
    const width = 1792, height = 2816;
    const data = new Uint8Array(width * height); // defaults to VOID

    const idx = (x: number, z: number): number => {
        const ix = x - minX, iz = z - minZ;
        if (ix < 0 || iz < 0 || ix >= width || iz >= height) return -1;
        return iz * width + ix;
    };

    // Underlay first: any non-zero underlay means the tile is real land.
    const under = new Reader(jag.get(genHash('underlay.dat'))!);
    while (under.available > 0) {
        const mx = under.g1();
        const { mz, overworld } = realMz(under.g1());
        for (let x = 0; x < 64; x++) {
            for (let z = 63; z >= 0; z--) {
                const id = under.g1();
                if (!overworld || id === 0) continue;
                const i = idx(mx * 64 + x, mz * 64 + z);
                if (i >= 0) data[i] = Surface.LAND;
            }
        }
    }

    // Overlay refines it: roads, paths, water.
    const over = new Reader(jag.get(genHash('overlay.dat'))!);
    while (over.available > 0) {
        const mx = over.g1();
        const { mz, overworld } = realMz(over.g1());
        for (let x = 0; x < 64; x++) {
            for (let z = 63; z >= 0; z--) {
                const id = over.g1();
                if (id === 0) continue;
                over.g1(); // shape/rotation
                if (!overworld) continue;

                const i = idx(mx * 64 + x, mz * 64 + z);
                if (i < 0) continue;

                if (WATER_OVERLAYS.has(id)) data[i] = Surface.WATER;
                else if (ROAD_OVERLAYS.has(id)) data[i] = Surface.ROAD;
                else if (PATH_OVERLAYS.has(id)) data[i] = Surface.PATH;
                else if (data[i] === Surface.VOID) data[i] = Surface.LAND;
            }
        }
    }

    return {
        minX, minZ, width, height, data,
        at(x: number, z: number): Surface {
            const i = idx(x, z);
            return i < 0 ? Surface.VOID : (data[i] as Surface);
        },
    };
}

/** Key for decodeSurfaceSquares' map. */
export const surfaceSquareKey = (level: number, mx: number, mz: number): number => (level << 16) | (mx << 8) | mz;

/**
 * Decode worldmap.jag into per-mapsquare surface (64x64, cell lz*64+lx) in TRUE world coordinates,
 * for the v2 (all-levels) navgrid. Unlike decodeSurface this keeps the underground squares
 * (z >= 6400): the local pack (server/engine/data/pack/mapview/worldmap.jag) stores every square at its
 * real mz, so there is nothing to undo. The one level remap is the packer's own: Worldmap.ts draws
 * mx 33 / mz 71-73 (the underground pass) from LEVEL 1, so that surface belongs to level 1.
 *
 * Squares at mz 70-76 (instanced interiors: rune altars, the essence mine...) are still SKIPPED, exactly
 * as decodeSurface skips them, so the v1 window's cells stay byte-identical; standable tiles there get
 * no preference either way (VOID and LAND cost the same).
 */
export function decodeSurfaceSquares(raw: Uint8Array): Map<number, Uint8Array> {
    const jag = openJag(raw);
    const squares = new Map<number, Uint8Array>();
    const levelOf = (mx: number, mz: number): number => (mx === 33 && mz >= 71 && mz <= 73 ? 1 : 0);
    const skip = (mz: number): boolean => mz >= 70 && mz <= 76;
    const square = (mx: number, mz: number): Uint8Array => {
        const k = surfaceSquareKey(levelOf(mx, mz), mx, mz);
        let s = squares.get(k);
        if (!s) squares.set(k, (s = new Uint8Array(4096)));
        return s;
    };

    const under = new Reader(jag.get(genHash('underlay.dat'))!);
    while (under.available > 0) {
        const mx = under.g1(), mz = under.g1();
        const s = skip(mz) ? null : square(mx, mz);
        for (let x = 0; x < 64; x++) {
            for (let z = 63; z >= 0; z--) {
                const id = under.g1();
                if (s && id !== 0) s[z * 64 + x] = Surface.LAND;
            }
        }
    }

    const over = new Reader(jag.get(genHash('overlay.dat'))!);
    while (over.available > 0) {
        const mx = over.g1(), mz = over.g1();
        const s = skip(mz) ? null : square(mx, mz);
        for (let x = 0; x < 64; x++) {
            for (let z = 63; z >= 0; z--) {
                const id = over.g1();
                if (id === 0) continue;
                over.g1(); // shape/rotation
                if (!s) continue;
                const i = z * 64 + x;
                if (WATER_OVERLAYS.has(id)) s[i] = Surface.WATER;
                else if (ROAD_OVERLAYS.has(id)) s[i] = Surface.ROAD;
                else if (PATH_OVERLAYS.has(id)) s[i] = Surface.PATH;
                else if (s[i] === Surface.VOID) s[i] = Surface.LAND;
            }
        }
    }
    return squares;
}

export async function loadSurfaceSquares(path: string): Promise<Map<number, Uint8Array>> {
    return decodeSurfaceSquares(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

export async function fetchSurfaceSquares(server: string): Promise<Map<number, Uint8Array>> {
    const res = await fetch(`${server.replace(/\/$/, '')}/worldmap.jag`);
    if (!res.ok) throw new Error(`worldmap.jag: HTTP ${res.status}`);
    return decodeSurfaceSquares(new Uint8Array(await res.arrayBuffer()));
}

export async function loadSurface(path: string): Promise<SurfaceMap> {
    return decodeSurface(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

/** Pull worldmap.jag straight from a running server. */
export async function fetchSurface(server: string): Promise<SurfaceMap> {
    const res = await fetch(`${server.replace(/\/$/, '')}/worldmap.jag`);
    if (!res.ok) throw new Error(`worldmap.jag: HTTP ${res.status}`);
    return decodeSurface(new Uint8Array(await res.arrayBuffer()));
}

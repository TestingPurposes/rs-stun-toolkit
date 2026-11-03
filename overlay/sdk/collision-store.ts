// collision-store.ts: the RUNTIME form of sdk/collision-data.json (rsmod collision: zones, tiles, wall doors).
//
// WHY: `import collisionData from './collision-data.json'` made Bun keep every top-level key of the JSON as a live
// module export for the whole process: `tiles` alone is 1,268,350 small JS arrays (+205-220 MB committed per bun process),
// and dropping it after init does not help (the export binding still holds it; even parse-then-drop leaves ~150 MB of the
// parse peak committed). Now the same data is a flat Int32 file, sdk/collision-data.bin
// (~21 MB), read with one readFileSync; `tiles` is NOT cached here (pathfinding/navgrid init read it, use it, drop it),
// only the small `zones` (1.6 MB) and `doors` (65 KB) tables are kept for later readers (reach.ts, knownDoorCoords).
//
// The .bin is GENERATED, never hand-edited:   bun sdk/collision-bin.ts           (writes sdk/collision-data.bin)
//                                             bun sdk/collision-bin.ts --check   (exit 1 if the bin != the JSON)
// Regenerate it whenever sdk/collision-data.json changes (fetch-collision-data.ts). The loader REFUSES a bin that is not
// version COLLISION_BIN_VERSION, is truncated/corrupt (payload checksum), or whose recorded JSON byte size differs from a
// sdk/collision-data.json sitting next to it (= a stale bin); it then falls back to parsing the JSON, loudly.
// COLLISION_SOURCE=json forces the JSON path (A/B proofs).
//
// Layout (little-endian int32 words): header[16] | zones[3*nz] | doors[6*nd] | tiles[4*nt]
//   header: 0 magic 'RSCD' · 1 version · 2 nz · 3 nd · 4 nt · 5 JSON byte size · 6 FNV-1a of the payload words · 7 0
//           8..15 sha256 of the JSON bytes (checked by --check, not at run time)
//   rows are the JSON rows in JSON order: zones [level, zoneX, zoneZ], doors [level, x, z, shape, angle, blockrange],
//   tiles [level, x, z, flags].
import { existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

export const COLLISION_BIN_MAGIC = 0x44435352;   // bytes 'R','S','C','D'
export const COLLISION_BIN_VERSION = 1;
const HDR = 16;

export const COLLISION_JSON_PATH = fileURLToPath(new URL('./collision-data.json', import.meta.url));
export const COLLISION_BIN_PATH = fileURLToPath(new URL('./collision-data.bin', import.meta.url));

/** Flat row-major tables: zones 3 ints/row, doors 6 ints/row, tiles 4 ints/row (see the layout above). */
export interface CollisionTables {
    zones: Int32Array;
    doors: Int32Array;
    tiles: Int32Array;
    source: 'bin' | 'json';
}

interface CollisionJson {
    tiles: number[][];
    zones: number[][];
    doors?: number[][];
}

function fnv(words: Int32Array): number {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i]!, 16777619);
    return h;
}

function flatten(rows: number[][], width: number, name: string): Int32Array {
    const out = new Int32Array(rows.length * width);
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!;
        if (row.length !== width) throw new Error(`collision-data.json: ${name}[${r}] has ${row.length} values, want ${width}`);
        for (let k = 0; k < width; k++) {
            const v = row[k]!;
            if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new Error(`collision-data.json: ${name}[${r}][${k}] = ${v} is not an int32`);
            out[r * width + k] = v;
        }
    }
    return out;
}

function tablesFromJson(json: CollisionJson): CollisionTables {
    return { zones: flatten(json.zones, 3, 'zones'), doors: flatten(json.doors ?? [], 6, 'doors'), tiles: flatten(json.tiles, 4, 'tiles'), source: 'json' };
}

/** GENERATOR side: the JSON bytes -> the .bin bytes (deterministic: same JSON, same bytes). */
export function encodeCollisionBin(jsonBytes: Buffer): Buffer {
    const t = tablesFromJson(JSON.parse(jsonBytes.toString('utf8')) as CollisionJson);
    const words = new Int32Array(HDR + t.zones.length + t.doors.length + t.tiles.length);
    words.set(t.zones, HDR);
    words.set(t.doors, HDR + t.zones.length);
    words.set(t.tiles, HDR + t.zones.length + t.doors.length);
    words[0] = COLLISION_BIN_MAGIC;
    words[1] = COLLISION_BIN_VERSION;
    words[2] = t.zones.length / 3;
    words[3] = t.doors.length / 6;
    words[4] = t.tiles.length / 4;
    words[5] = jsonBytes.length;
    words[6] = fnv(words.subarray(HDR));
    words[7] = 0;
    const sha = createHash('sha256').update(jsonBytes).digest();
    for (let i = 0; i < 8; i++) words[8 + i] = sha.readInt32LE(i * 4);
    return Buffer.from(words.buffer, words.byteOffset, words.byteLength);
}

/** sha256 (hex) of the JSON the bin was generated from, as recorded in its header. */
export function binJsonSha(bin: Buffer): string {
    return bin.subarray(32, 64).toString('hex');
}

/** Parse + validate .bin bytes. Throws with the reason when the bin must not be used. */
export function decodeCollisionBin(buf: Buffer, jsonSizeOnDisk?: number): CollisionTables {
    if (buf.byteLength < HDR * 4 || buf.byteLength % 4 !== 0) throw new Error(`bad length ${buf.byteLength}`);
    // readFileSync buffers may sit at any offset in a shared pool: copy-free view only when 4-aligned
    const w = buf.byteOffset % 4 === 0
        ? new Int32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2)
        : new Int32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (w[0] !== COLLISION_BIN_MAGIC) throw new Error('bad magic (not a collision-data.bin, or big-endian host)');
    if (w[1] !== COLLISION_BIN_VERSION) throw new Error(`version ${w[1]}, this loader reads ${COLLISION_BIN_VERSION} (regenerate: bun sdk/collision-bin.ts)`);
    const nz = w[2]!, nd = w[3]!, nt = w[4]!;
    const want = HDR + nz * 3 + nd * 6 + nt * 4;
    if (w.length !== want) throw new Error(`size ${w.length} words, header promises ${want} (truncated?)`);
    if (jsonSizeOnDisk !== undefined && jsonSizeOnDisk !== w[5]) {
        throw new Error(`STALE: generated from a ${w[5]}-byte collision-data.json, the one on disk is ${jsonSizeOnDisk} bytes (regenerate: bun sdk/collision-bin.ts)`);
    }
    if (fnv(w.subarray(HDR)) !== w[6]) throw new Error('payload checksum mismatch (corrupt)');
    let o = HDR;
    const zones = w.subarray(o, o += nz * 3);
    const doors = w.subarray(o, o += nd * 6);
    const tiles = w.subarray(o, o += nt * 4);
    return { zones, doors, tiles, source: 'bin' };
}

let jsonCache: CollisionTables | null = null;   // fallback only: parsing is the expensive part, keep its flat result
let zonesCache: Int32Array | null = null;
let doorsCache: Int32Array | null = null;
let warned = false;

function fromJson(why: string): CollisionTables {
    if (!jsonCache) {
        if (!warned) {
            warned = true;
            console.warn(`[collision] WARNING ${why} -> parsing sdk/collision-data.json instead (slower start, ~+70-150 MB per process). Fix: bun sdk/collision-bin.ts`);
        }
        if (!existsSync(COLLISION_JSON_PATH)) throw new Error(`[collision] ${why}, and ${COLLISION_JSON_PATH} is missing too: no collision data`);
        jsonCache = tablesFromJson(JSON.parse(readFileSync(COLLISION_JSON_PATH, 'utf8')) as CollisionJson);
    }
    return jsonCache;
}

/**
 * The full collision tables. With the .bin this READS THE FILE EACH CALL and caches nothing big: use the result for the
 * init loop and drop it (pathfinding + navgrid init = two ~21 MB reads, both transient).
 */
export function loadCollisionTables(): CollisionTables {
    let t: CollisionTables;
    if (process.env.COLLISION_SOURCE === 'json') t = fromJson('COLLISION_SOURCE=json');
    else if (jsonCache) t = jsonCache;
    else if (!existsSync(COLLISION_BIN_PATH)) t = fromJson(`${COLLISION_BIN_PATH} is missing`);
    else {
        try {
            const jsonSize = existsSync(COLLISION_JSON_PATH) ? statSync(COLLISION_JSON_PATH).size : undefined;
            t = decodeCollisionBin(readFileSync(COLLISION_BIN_PATH), jsonSize);
        } catch (e) {
            t = fromJson(`refusing ${COLLISION_BIN_PATH}: ${e instanceof Error ? e.message : e}`);
        }
    }
    if (!zonesCache) zonesCache = t.zones.slice();
    if (!doorsCache) doorsCache = t.doors.slice();
    return t;
}

/** zones table [level, zoneX, zoneZ] * n (cached copy, 1.6 MB). */
export function collisionZones(): Int32Array {
    if (!zonesCache) loadCollisionTables();
    return zonesCache!;
}

/** wall-door table [level, x, z, shape, angle, blockrange] * n (cached copy, ~65 KB). */
export function collisionDoors(): Int32Array {
    if (!doorsCache) loadCollisionTables();
    return doorsCache!;
}

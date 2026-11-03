// ENTITY-BY-NAME DISCOVERY for the headless stack — an offline loc scene + name tables.
//
// THE GAP THIS CLOSES
//   The browser SDK finds things by name: findNearbyLoc(/^tree$/i), findNearbyNpc(/knight/i),
//   findGroundItem(/coins/i). It can do that because the CLIENT loads the map cache and builds a
//   scene, so LocType.list(id).name is right there (see StateCollector.scanNearbyLocs, ~line 702).
//   The headless stack has no scene at all: the server NEVER transmits locs — they live in the map
//   cache — so every headless bot has been handed hardcoded coordinates and bare numeric ids.
//
//   Locs are STATIC. There is nothing to receive. We can read the exact same data the server reads,
//   offline, once per process, and answer "what is near me and what is it called" from memory.
//
// PRECEDENT
//   headless/find-banks.ts already does both halves (loc.pack -> names; jm2 -> placed locs). This is
//   that code generalised into a queryable process-global index. The bridge-level rule below is
//   engine parity: GameMap.ts:229 shifts a loc down one level when the LEVEL-1 land flag at its tile
//   has LINK_BELOW set — for locs on EVERY level, not just level 1.
//
// SHAPE OF THE THING (and why)
//   - EAGER, whole-world, built ONCE per process. 819k placed locs in columnar typed arrays is ~7MB
//     — a third of navgrid's ~23MB. Module state in ESM is per-process, so every bot in the process
//     shares one copy. A per-bot index would multiply that by the bot count.
//   - Lazy per-map-square was rejected: it would put a synchronous readFileSync on the first query
//     into any new map square, i.e. inside the packet loop, where a long synchronous call stalls
//     every bot in the process. Eager warmup = zero file IO afterwards.
//   - Queries are bounded by an 8x8-tile ZONE bucket index, so a radius-15 question touches ~36
//     zones (~a few hundred candidates), never the world.
//
// USAGE
//     import * as locScene from './loc-scene.ts';
//     locScene.init();                       // ONCE, at startup, BEFORE the packet loop
//     const booth = locScene.findNearbyLoc(/^bank booth$/i, x, z, 0, 15);
//     if (booth) sendOpLoc(booth.x, booth.z, booth.id, 1);
//
// SCOPE: this module is pure data. It never connects, never sends, and knows nothing about a bot.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '../../..');
const CONTENT = path.join(ROOT, 'server', 'content');
const PACK_DIR = path.join(CONTENT, 'pack');
const MAPS_DIR = path.join(CONTENT, 'maps');
const SCRIPTS_DIR = path.join(CONTENT, 'scripts');

/** GameMap.LINK_BELOW — level-1 land flag meaning "this tile is a bridge; locs here belong below". */
const LINK_BELOW = 0x2;

/** Engine parity: OpLocHandler/OpNpcHandler/OpObjHandler REFUSE an op whose text is 'hidden'. */
const HIDDEN_OP = 'hidden';

/**
 * Browser parity: StateCollector renames ore rocks so a bot can say /rocks.*iron/i. The loc configs
 * just call them "Rocks", which is useless for targeting. Same table, same reason.
 */
const ROCK_ID_TO_ORE: Record<number, string> = {
    2090: 'copper', 2091: 'copper', 3042: 'copper',
    2094: 'tin', 2095: 'tin', 3043: 'tin',
    2092: 'iron', 2093: 'iron',
    2096: 'coal', 2097: 'coal',
    2098: 'gold', 2099: 'gold',
    2100: 'silver', 2101: 'silver',
    2102: 'mithril', 2103: 'mithril',
    2104: 'adamantite', 2105: 'adamantite',
    2106: 'runite', 2107: 'runite',
    2108: 'clay', 2109: 'clay',
    2110: 'blurite',
    2111: 'gem',
    2491: 'rune essence',
};

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

/** Mirrors sdk/types.ts LocOption. opIndex is 1-based, i.e. what you put in an OPLOC packet. */
export interface LocOption {
    text: string;
    opIndex: number;
}

/** A config-table entry: what a type id IS, independent of where it is placed. */
export interface TypeDef {
    id: number;
    /** The pack/internal name, e.g. 'bankbooth'. Unique per id. */
    internal: string;
    /** The display name the client would show, e.g. 'Bank booth'. '' for unnamed scenery. */
    name: string;
    /** Usable ops only — 'hidden' entries are dropped (the engine refuses them). */
    options: string[];
    optionsWithIndex: LocOption[];
}

export interface LocDef extends TypeDef {
    /** Footprint in tiles at angle 0. */
    width: number;
    length: number;
}

/**
 * A placed loc, shaped like sdk/types.ts NearbyLoc so integration is mechanical.
 * Extra fields the browser does not carry: level, shape, angle, width, length.
 */
export interface SceneLoc {
    /** locId — the id an OPLOC packet wants. Named `id` for NearbyLoc parity. */
    id: number;
    name: string;
    x: number;
    z: number;
    level: number;
    /** Chebyshev distance from the query origin, matching StateCollector's max(|dx|,|dz|). */
    distance: number;
    shape: number;
    angle: number;
    width: number;
    length: number;
    options: string[];
    optionsWithIndex: LocOption[];
}

export interface QueryOptions {
    /**
     * Include locs whose type has no display name (invisible walls, rug corners, ...).
     * Default false — the browser skips these, and they are never interactable.
     */
    includeUnnamed?: boolean;
    /** Cap the result set. Applied after the distance sort. */
    limit?: number;
}

export interface SceneStats {
    built: boolean;
    buildMs: number;
    placedLocs: number;
    mapSquares: number;
    zones: number;
    locTypes: number;
    npcTypes: number;
    objTypes: number;
    /** Bytes held by the columnar placement arrays (the part that scales with the world). */
    placementBytes: number;
}

// ---------------------------------------------------------------------------------------------
// Process-global state. ESM module scope == one copy per process, shared by every bot.
// ---------------------------------------------------------------------------------------------

let built = false;
let buildMs = 0;
let mapSquares = 0;

// Config tables (small: a few thousand entries each).
const locDefs = new Map<number, LocDef>();
const npcDefs = new Map<number, TypeDef>();
const objDefs = new Map<number, TypeDef>();

/**
 * locId -> 1 if the type has a display name. The hot loops skip unnamed scenery on EVERY candidate
 * (ground decor alone is 38% of the world's locs), so this replaces a Map hit with an array index.
 */
let locNamed = new Uint8Array(0);

// name -> ids reverse lookups. Keyed by LOWERCASED display name; several ids share a name
// (e.g. 'Gate' is dozens of ids), which is exactly why callers should not hardcode ids.
const locIdsByNameLc = new Map<string, number[]>();
const npcIdsByNameLc = new Map<string, number[]>();
const objIdsByNameLc = new Map<string, number[]>();

// Columnar placement store, counting-sorted so every zone's locs are one contiguous run.
// 9 bytes per placed loc. Parallel arrays beat 819k objects by roughly an order of magnitude.
let pX = new Uint16Array(0);
let pZ = new Uint16Array(0);
let pId = new Uint16Array(0);
let pLevel = new Uint8Array(0);
let pShape = new Uint8Array(0);
let pAngle = new Uint8Array(0);
let placedCount = 0;

/** zoneKey -> start * 65536 + count. Contiguous run into the columnar arrays. */
const zoneIndex = new Map<number, number>();

/**
 * zoneKey packs (level, zoneX, zoneZ) into 22 bits.
 * World bounds measured from the real maps: x 1856..3647 (zx <= 455, 9 bits),
 * z 1280..10367 (zz <= 1295, 11 bits), level 0..3 (2 bits).
 */
const ZONE_Z_BITS = 11;
const ZONE_X_BITS = 9;
const zoneKey = (level: number, zx: number, zz: number): number =>
    (level << (ZONE_X_BITS + ZONE_Z_BITS)) | (zx << ZONE_Z_BITS) | zz;

// ---------------------------------------------------------------------------------------------
// Pack + config loading
// ---------------------------------------------------------------------------------------------

/**
 * ONE reusable read buffer shared by every file the build touches (largest map square is 337 KB),
 * grown on demand. `readFileSync` per file allocates 51.5MB of short-lived Buffers whose arena Bun
 * does not hand back — measured at +37MB RSS for nothing. Reading into a buffer we own costs +0.2MB.
 */
let readBuf = Buffer.allocUnsafe(512 * 1024);

/** Read a whole file into `readBuf` (growing it if needed) and return the byte length. */
function readIntoScratch(file: string): number {
    const size = fs.statSync(file).size;
    if (size > readBuf.length) readBuf = Buffer.allocUnsafe(size + (64 * 1024));
    const fd = fs.openSync(file, 'r');
    try {
        return fs.readSync(fd, readBuf, 0, size, 0);
    } finally {
        fs.closeSync(fd);
    }
}

/** `<id>=<internal name>` per line. Same format for loc/npc/obj. */
function loadPack(file: string): Map<number, string> {
    const out = new Map<number, string>();
    const text = fs.readFileSync(path.join(PACK_DIR, file), 'ascii');
    for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const id = parseInt(line.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        out.set(id, line.slice(eq + 1).trim());
    }
    return out;
}

interface RawConfig {
    name?: string;
    width?: number;
    length?: number;
    ops: (string | null)[];
}

/** Walk SCRIPTS_DIR for `.loc` / `.npc` / `.obj` config files. */
function collectConfigFiles(dir: string, ext: string, out: string[]): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collectConfigFiles(p, ext, out);
        else if (e.name.endsWith(ext)) out.push(p);
    }
    return out;
}

/** True if `buf[at..at+word.length)` equals the ASCII `word`. Avoids slicing out a key string. */
function keyIs(buf: Buffer, at: number, keyEnd: number, word: string): boolean {
    if (keyEnd - at !== word.length) return false;
    for (let k = 0; k < word.length; k++) if (buf[at + k] !== word.charCodeAt(k)) return false;
    return true;
}

/**
 * Parse every config of one extension into `internal name -> fields`.
 * Format is ini-ish: `[internal_name]` then `key=value` lines, with `//` comments. Only the handful
 * of keys we can act on are kept; models/params/categories are dead weight for name discovery.
 *
 * BYTE-LEVEL for the same reason as the map parser, and it mattered MORE here: the string version
 * cost +58MB RSS to retain 6MB, because 457 files x `split('\n')` is ~129k throwaway strings. We
 * only materialise a string for a key we actually keep.
 */
function loadConfigs(ext: string): Map<string, RawConfig> {
    const out = new Map<string, RawConfig>();
    for (const file of collectConfigFiles(SCRIPTS_DIR, ext, [])) {
        const len = readIntoScratch(file);
        const buf = readBuf.subarray(0, len);
        let cur: RawConfig | null = null;
        let i = 0;

        while (i < len) {
            let nl = buf.indexOf(10 /* \n */, i);
            if (nl === -1) nl = len;
            let end = nl;
            // Trim trailing \r and whitespace.
            while (end > i && (buf[end - 1] === 13 || buf[end - 1] === 32 || buf[end - 1] === 9)) end--;
            let s = i;
            while (s < end && (buf[s] === 32 || buf[s] === 9)) s++;

            if (s === end || buf[s] === 47 /* / comment */) { i = nl + 1; continue; }

            if (buf[s] === 91 /* [ */ && buf[end - 1] === 93 /* ] */) {
                cur = { ops: [null, null, null, null, null] };
                out.set(buf.toString('utf8', s + 1, end - 1), cur);
                i = nl + 1;
                continue;
            }
            if (!cur) { i = nl + 1; continue; }

            const eq = buf.indexOf(61 /* = */, s);
            if (eq === -1 || eq >= end) { i = nl + 1; continue; }
            let v = eq + 1;
            while (v < end && (buf[v] === 32 || buf[v] === 9)) v++;

            if (keyIs(buf, s, eq, 'name')) cur.name = buf.toString('utf8', v, end);
            else if (keyIs(buf, s, eq, 'width')) cur.width = parseInt(buf.toString('ascii', v, end));
            else if (keyIs(buf, s, eq, 'length')) cur.length = parseInt(buf.toString('ascii', v, end));
            else if (eq - s === 3 && buf[s] === 111 /* o */ && buf[s + 1] === 112 /* p */) {
                const idx = buf[s + 2]! - 48;
                if (idx >= 1 && idx <= 5) cur.ops[idx - 1] = buf.toString('utf8', v, end);
            }

            i = nl + 1;
        }
    }
    return out;
}

function toOptions(ops: (string | null)[]): { options: string[]; optionsWithIndex: LocOption[] } {
    const optionsWithIndex: LocOption[] = [];
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        // Drop 'hidden': OpLocHandler.ts:38 (and the npc/obj twins) reject it outright, so offering
        // it to a caller can only produce an interaction the server silently refuses.
        if (!op || op === HIDDEN_OP) continue;
        optionsWithIndex.push({ text: op, opIndex: i + 1 });
    }
    return { options: optionsWithIndex.map(o => o.text), optionsWithIndex };
}

function indexByName(map: Map<string, number[]>, name: string, id: number): void {
    if (!name) return;
    const lc = name.toLowerCase();
    const list = map.get(lc);
    if (list) list.push(id);
    else map.set(lc, [id]);
}

function buildTypeTables(): void {
    const locPack = loadPack('loc.pack');
    const npcPack = loadPack('npc.pack');
    const objPack = loadPack('obj.pack');

    const locCfg = loadConfigs('.loc');
    const npcCfg = loadConfigs('.npc');
    const objCfg = loadConfigs('.obj');

    let maxLocId = 0;
    for (const id of locPack.keys()) if (id > maxLocId) maxLocId = id;
    locNamed = new Uint8Array(maxLocId + 1);

    for (const [id, internal] of locPack) {
        const cfg = locCfg.get(internal);
        // No `name=` means unnamed scenery (invisible walls, rug corners). The client shows nothing
        // and the player cannot click it — 1881 of 4671 loc ids are like this.
        const name = ROCK_ID_TO_ORE[id] ? `Rocks ${ROCK_ID_TO_ORE[id]} ore` : (cfg?.name ?? '');
        const { options, optionsWithIndex } = toOptions(cfg?.ops ?? []);
        locDefs.set(id, {
            id, internal, name, options, optionsWithIndex,
            width: cfg?.width ?? 1,
            length: cfg?.length ?? 1,
        });
        if (name) locNamed[id] = 1;
        indexByName(locIdsByNameLc, name, id);
    }

    for (const [id, internal] of npcPack) {
        const cfg = npcCfg.get(internal);
        const { options, optionsWithIndex } = toOptions(cfg?.ops ?? []);
        const name = cfg?.name ?? '';
        npcDefs.set(id, { id, internal, name, options, optionsWithIndex });
        indexByName(npcIdsByNameLc, name, id);
    }

    for (const [id, internal] of objPack) {
        let cfg = objCfg.get(internal);
        // Noted items (`cert_<base>`) have no config section of their own — the engine derives them
        // from the base obj. Fall back to the base's display name so /coins/i still matches a note.
        if (!cfg && internal.startsWith('cert_')) cfg = objCfg.get(internal.slice(5));
        const { options, optionsWithIndex } = toOptions(cfg?.ops ?? []);
        const name = cfg?.name ?? '';
        objDefs.set(id, { id, internal, name, options, optionsWithIndex });
        indexByName(objIdsByNameLc, name, id);
    }
}

// ---------------------------------------------------------------------------------------------
// Placed-loc index
// ---------------------------------------------------------------------------------------------

function ensureCapacity(need: number): void {
    if (need <= pX.length) return;
    let cap = pX.length || 1 << 20;
    while (cap < need) cap *= 2;
    const nx = new Uint16Array(cap); nx.set(pX); pX = nx;
    const nz = new Uint16Array(cap); nz.set(pZ); pZ = nz;
    const ni = new Uint16Array(cap); ni.set(pId); pId = ni;
    const nl = new Uint8Array(cap); nl.set(pLevel); pLevel = nl;
    const ns = new Uint8Array(cap); ns.set(pShape); pShape = ns;
    const na = new Uint8Array(cap); na.set(pAngle); pAngle = na;
}

/**
 * Scratch buffers for one map square's parse, reused across all 483 files so the build allocates
 * them once instead of 483 times. The biggest square holds ~5k locs; 1<<14 is ample headroom.
 */
const TMP_CAP = 1 << 14;
const tX = new Uint16Array(TMP_CAP), tZ = new Uint16Array(TMP_CAP), tId = new Uint16Array(TMP_CAP);
const tLevel = new Uint8Array(TMP_CAP), tShape = new Uint8Array(TMP_CAP), tAngle = new Uint8Array(TMP_CAP);
const tZone = new Int32Array(TMP_CAP);
const level1Flags = new Uint8Array(64 * 64);

/** Cursor for the byte scanner below — a return-two-values workaround without allocating. */
let scanPos = 0;

/** Read an unsigned decimal from `buf` starting at `p`; leaves the next index in `scanPos`. */
function readUint(buf: Buffer, p: number, end: number): number {
    let v = 0;
    while (p < end) {
        const c = buf[p]!;
        if (c < 48 || c > 57) break;
        v = v * 10 + (c - 48);
        p++;
    }
    scanPos = p;
    return v;
}

/**
 * Parse one packed map square and append its locs, zone-sorted, to the columnar store.
 *
 * BYTE-LEVEL ON PURPOSE. The naive `readFileSync(f,'utf8').split('\n')` version worked but churned
 * ~2.8M transient line strings across 51.5MB of map text, which pushed process RSS ~127MB above the
 * ~18MB the index actually retains. At many-bots-per-process that high-water mark is real money, so
 * we scan the raw Buffer and never materialise a string.
 *
 * Each file covers exactly one 64x64 map square, so its zones are disjoint from every other file's.
 * That means sorting WITHIN a file is enough to make each zone one contiguous global run — no
 * 816k-element global sort needed.
 */
function ingestMapSquare(file: string, msx: number, msz: number): void {
    const len = readIntoScratch(file);
    // View, not copy. Bounds every indexOf below to THIS file's bytes rather than the stale tail
    // of the shared scratch buffer.
    const buf = readBuf.subarray(0, len);

    // Level-1 land flags for the bridge rule. Only level-1 MAP lines matter, so we skip ~75% of the
    // two million MAP lines in the world with a single byte test.
    level1Flags.fill(0);

    let n = 0;
    let section = 0; // 0 none, 1 MAP, 2 LOC
    let i = 0;

    while (i < len) {
        let nl = buf.indexOf(10 /* \n */, i);
        if (nl === -1) nl = len;
        let end = nl;
        if (end > i && buf[end - 1] === 13 /* \r */) end--;

        if (end === i) { i = nl + 1; continue; }

        if (buf[i] === 61 /* = */) {
            // "==== MAP ====" / "==== LOC ====" — the tag's first letter is at +5.
            const tag = buf[i + 5];
            section = tag === 77 /* M */ ? 1 : tag === 76 /* L */ ? 2 : 0;
            i = nl + 1;
            continue;
        }
        if (section === 0) { i = nl + 1; continue; }

        // Header is always "<level> <x> <z>: ".
        const level = readUint(buf, i, end);
        const lx = readUint(buf, scanPos + 1, end);
        const lz = readUint(buf, scanPos + 1, end);
        let p = scanPos;
        if (buf[p] !== 58 /* : */) { i = nl + 1; continue; }
        p += 2;

        if (section === 1) {
            if (level === 1) {
                // Land tokens look like `h1 o6 f1 u63`; we only want `f`.
                while (p < end) {
                    if (buf[p] === 102 /* f */) {
                        level1Flags[lx * 64 + lz] = readUint(buf, p + 1, end) & 0xff;
                        break;
                    }
                    const sp = buf.indexOf(32 /* space */, p);
                    if (sp === -1 || sp >= end) break;
                    p = sp + 1;
                }
            }
            i = nl + 1;
            continue;
        }

        const locId = readUint(buf, p, end);
        p = scanPos;
        // Every LOC line in the shipped maps carries a shape; angle is optional and defaults to 0.
        const shape = p < end && buf[p] === 32 ? readUint(buf, p + 1, end) : 10;
        p = scanPos;
        const angle = p < end && buf[p] === 32 ? readUint(buf, p + 1, end) : 0;

        // GameMap.ts:229 — a loc on a bridged tile belongs one level DOWN, on any level.
        const bridged = (level1Flags[lx * 64 + lz]! & LINK_BELOW) === LINK_BELOW;
        const lvl = bridged ? level - 1 : level;
        if (lvl < 0) { i = nl + 1; continue; }

        if (n >= TMP_CAP) throw new Error(`loc-scene: ${file} has >${TMP_CAP} locs; raise TMP_CAP`);
        tX[n] = msx + lx;
        tZ[n] = msz + lz;
        tLevel[n] = lvl;
        tId[n] = locId;
        tShape[n] = shape;
        tAngle[n] = angle;
        n++;

        i = nl + 1;
    }

    if (n === 0) return;

    // Counting sort by zone key, so each zone becomes ONE contiguous run in the global store.
    const counts = new Map<number, number>();
    for (let j = 0; j < n; j++) {
        const k = zoneKey(tLevel[j]!, tX[j]! >> 3, tZ[j]! >> 3);
        tZone[j] = k;
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const base = placedCount;
    ensureCapacity(base + n);

    // Bucket offsets in ascending zone-key order, so runs are deterministic across builds.
    const cursor = new Map<number, number>();
    let off = base;
    for (const k of [...counts.keys()].sort((a, b) => a - b)) {
        // Two files could only share a zone if map squares overlapped, which they do not.
        if (zoneIndex.has(k)) throw new Error(`loc-scene: zone ${k} claimed twice (${file})`);
        const c = counts.get(k)!;
        zoneIndex.set(k, off * 65536 + c);
        cursor.set(k, off);
        off += c;
    }

    for (let j = 0; j < n; j++) {
        const k = tZone[j]!;
        const slot = cursor.get(k)!;
        cursor.set(k, slot + 1);
        pX[slot] = tX[j]!;
        pZ[slot] = tZ[j]!;
        pId[slot] = tId[j]!;
        pLevel[slot] = tLevel[j]!;
        pShape[slot] = tShape[j]!;
        pAngle[slot] = tAngle[j]!;
    }
    placedCount = base + n;
    mapSquares++;
}

function mapSquareFiles(): Array<{ file: string; msx: number; msz: number }> {
    const out: Array<{ file: string; msx: number; msz: number }> = [];
    for (const f of fs.readdirSync(MAPS_DIR)) {
        const m = /^m(\d+)_(\d+)\.jm2$/.exec(f);
        if (!m) continue;
        out.push({ file: path.join(MAPS_DIR, f), msx: parseInt(m[1]!) << 6, msz: parseInt(m[2]!) << 6 });
    }
    return out;
}

function trimArrays(): void {
    if (placedCount === pX.length) return;
    pX = pX.slice(0, placedCount);
    pZ = pZ.slice(0, placedCount);
    pId = pId.slice(0, placedCount);
    pLevel = pLevel.slice(0, placedCount);
    pShape = pShape.slice(0, placedCount);
    pAngle = pAngle.slice(0, placedCount);
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

/**
 * Build the process-global index. IDEMPOTENT — the second and every later call is a no-op, so every
 * bot in the process can call it defensively and only one pays.
 *
 * CALL THIS AT STARTUP, NOT FROM THE PACKET LOOP. It is synchronous and takes seconds, which stalls
 * every bot sharing the loop. Use initAsync() if you must warm up while a loop is already running.
 */
export function init(): void {
    if (built) return;
    const start = Date.now();
    buildTypeTables();
    for (const { file, msx, msz } of mapSquareFiles()) ingestMapSquare(file, msx, msz);
    trimArrays();
    built = true;
    buildMs = Date.now() - start;
}

/**
 * Same build, but yields to the event loop between map squares so an already-running packet loop
 * keeps reading packets. Idempotent, and safe to await concurrently from many bots — the first caller
 * builds and the rest await the same promise.
 */
let inFlight: Promise<void> | null = null;
export function initAsync(): Promise<void> {
    if (built) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
        const start = Date.now();
        buildTypeTables();
        let i = 0;
        for (const { file, msx, msz } of mapSquareFiles()) {
            ingestMapSquare(file, msx, msz);
            if (++i % 16 === 0) await new Promise<void>(r => setImmediate(r));
        }
        trimArrays();
        built = true;
        buildMs = Date.now() - start;
        inFlight = null;
    })();
    return inFlight;
}

export function isReady(): boolean {
    return built;
}

export function stats(): SceneStats {
    return {
        built,
        buildMs,
        placedLocs: placedCount,
        mapSquares,
        zones: zoneIndex.size,
        locTypes: locDefs.size,
        npcTypes: npcDefs.size,
        objTypes: objDefs.size,
        placementBytes: pX.byteLength + pZ.byteLength + pId.byteLength
            + pLevel.byteLength + pShape.byteLength + pAngle.byteLength,
    };
}

function requireReady(): void {
    if (!built) {
        throw new Error(
            'loc-scene: not initialised. Call locScene.init() once at startup (or await ' +
            'locScene.initAsync()) BEFORE querying. Building lazily from a query would put ' +
            'seconds of synchronous file IO inside the packet loop.'
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Name tables
// ---------------------------------------------------------------------------------------------

/** Display name of a loc type, '' for unnamed scenery. */
export function locName(locId: number): string {
    requireReady();
    return locDefs.get(locId)?.name ?? '';
}

/** Display name of an npc type, '' if unknown. */
export function npcName(typeId: number): string {
    requireReady();
    return npcDefs.get(typeId)?.name ?? '';
}

/** Display name of an obj (item) type, '' if unknown. */
export function objName(objId: number): string {
    requireReady();
    return objDefs.get(objId)?.name ?? '';
}

export function locDef(locId: number): LocDef | undefined {
    requireReady();
    return locDefs.get(locId);
}

export function npcDef(typeId: number): TypeDef | undefined {
    requireReady();
    return npcDefs.get(typeId);
}

export function objDef(objId: number): TypeDef | undefined {
    requireReady();
    return objDefs.get(objId);
}

function reverseLookup(
    table: Map<string, number[]>,
    defs: Map<number, { name: string }>,
    pattern: string | RegExp,
): number[] {
    // Exact-name fast path: one Map hit. Several ids routinely share a display name
    // ('Gate' is dozens), which is the whole reason callers should not hardcode ids.
    if (typeof pattern === 'string') return [...(table.get(pattern.toLowerCase()) ?? [])];
    const out: number[] = [];
    for (const [id, def] of defs) {
        if (def.name && pattern.test(def.name)) out.push(id);
    }
    return out.sort((a, b) => a - b);
}

/** All loc ids with this display name (string = exact, case-insensitive) or matching this regex. */
export function locIdsByName(pattern: string | RegExp): number[] {
    requireReady();
    return reverseLookup(locIdsByNameLc, locDefs, pattern);
}

export function npcIdsByName(pattern: string | RegExp): number[] {
    requireReady();
    return reverseLookup(npcIdsByNameLc, npcDefs, pattern);
}

export function objIdsByName(pattern: string | RegExp): number[] {
    requireReady();
    return reverseLookup(objIdsByNameLc, objDefs, pattern);
}

// ---------------------------------------------------------------------------------------------
// Spatial queries
// ---------------------------------------------------------------------------------------------

function materialise(slot: number, distance: number): SceneLoc {
    const id = pId[slot]!;
    const def = locDefs.get(id);
    return {
        id,
        name: def?.name ?? '',
        x: pX[slot]!,
        z: pZ[slot]!,
        level: pLevel[slot]!,
        distance,
        shape: pShape[slot]!,
        angle: pAngle[slot]!,
        width: def?.width ?? 1,
        length: def?.length ?? 1,
        options: def?.options ?? [],
        optionsWithIndex: def?.optionsWithIndex ?? [],
    };
}

/**
 * Walk the zone buckets covering a square neighbourhood and hand each candidate to `visit`.
 * Bounded by the radius, never by the world: radius 15 touches ~36 zones.
 */
function forEachInRadius(
    x: number, z: number, level: number, radius: number,
    visit: (slot: number, distance: number) => void,
): void {
    const zx0 = (x - radius) >> 3, zx1 = (x + radius) >> 3;
    const zz0 = (z - radius) >> 3, zz1 = (z + radius) >> 3;
    for (let zx = zx0; zx <= zx1; zx++) {
        if (zx < 0 || zx >= 1 << ZONE_X_BITS) continue;
        for (let zz = zz0; zz <= zz1; zz++) {
            if (zz < 0 || zz >= 1 << ZONE_Z_BITS) continue;
            const packed = zoneIndex.get(zoneKey(level, zx, zz));
            if (packed === undefined) continue;
            const count = packed % 65536;
            const start = (packed - count) / 65536;
            for (let s = start; s < start + count; s++) {
                const dx = pX[s]! - x, dz = pZ[s]! - z;
                const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
                const distance = adx > adz ? adx : adz;
                if (distance > radius) continue;
                visit(s, distance);
            }
        }
    }
}

/**
 * Every named loc within `radius` tiles (Chebyshev) of (x,z) on `level`, nearest first.
 * Mirrors SDK scanNearbyLocs(): same distance metric, same distance sort, same skip-the-unnamed rule.
 */
export function getNearbyLocs(
    x: number, z: number, level = 0, radius = 15, opts: QueryOptions = {},
): SceneLoc[] {
    requireReady();
    const out: SceneLoc[] = [];
    const all = opts.includeUnnamed === true;
    forEachInRadius(x, z, level, radius, (slot, distance) => {
        if (!all && locNamed[pId[slot]!] !== 1) return;
        out.push(materialise(slot, distance));
    });
    out.sort((a, b) => a.distance - b.distance);
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/**
 * Every named loc in radius whose display name matches, nearest first.
 * A bare string is treated as a case-insensitive SUBSTRING, exactly like SDK findNearbyLoc's
 * `new RegExp(pattern, 'i')` — so pass /^tree$/i when you mean a tree and not a tree stump.
 */
export function findNearbyLocs(
    pattern: string | RegExp, x: number, z: number, level = 0, radius = 15, opts: QueryOptions = {},
): SceneLoc[] {
    requireReady();
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    const out: SceneLoc[] = [];
    const all = opts.includeUnnamed === true;
    forEachInRadius(x, z, level, radius, (slot, distance) => {
        const id = pId[slot]!;
        if (!all && locNamed[id] !== 1) return;
        // Reset lastIndex so a caller's stray /g regex cannot make results depend on call order.
        regex.lastIndex = 0;
        if (!regex.test(locDefs.get(id)?.name ?? '')) return;
        out.push(materialise(slot, distance));
    });
    out.sort((a, b) => a.distance - b.distance);
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/**
 * The NEAREST loc in radius whose display name matches, or null.
 *
 * NOTE — a deliberate improvement on the SDK. Browser findNearbyLoc() reads `state.nearbyLocs`,
 * which is distance-sorted only if it came from a fresh scan; scanFindNearbyLoc() takes `.find()`
 * over the sorted scan. We always answer with the true nearest.
 */
export function findNearbyLoc(
    pattern: string | RegExp, x: number, z: number, level = 0, radius = 15, opts: QueryOptions = {},
): SceneLoc | null {
    const all = findNearbyLocs(pattern, x, z, level, radius, opts);
    return all.length > 0 ? all[0]! : null;
}

/** Every loc placed on one exact tile (all layers: wall, scenery, decor, ground decor). */
export function getLocsAt(x: number, z: number, level = 0, opts: QueryOptions = {}): SceneLoc[] {
    requireReady();
    const out: SceneLoc[] = [];
    const all = opts.includeUnnamed === true;
    forEachInRadius(x, z, level, 0, (slot, distance) => {
        if (!all && locNamed[pId[slot]!] !== 1) return;
        out.push(materialise(slot, distance));
    });
    return out;
}

/**
 * Rectangular sweep for OFFLINE tooling (route planners, table generators) — the "where in the
 * world is X" question that find-banks.ts answers by hand.
 *
 * NOT for the packet loop: cost scales with the box, not with a bot's neighbourhood — it is a full
 * scan of the 816k-loc store (~10ms). There is no query origin, so `distance` is always 0.
 */
export function findInBox(
    pattern: string | RegExp,
    box: { minX: number; maxX: number; minZ: number; maxZ: number; level?: number },
): SceneLoc[] {
    requireReady();
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    const out: SceneLoc[] = [];
    for (let s = 0; s < placedCount; s++) {
        if (box.level !== undefined && pLevel[s] !== box.level) continue;
        const x = pX[s]!, z = pZ[s]!;
        if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
        const name = locDefs.get(pId[s]!)?.name ?? '';
        if (!name) continue;
        regex.lastIndex = 0;
        if (!regex.test(name)) continue;
        out.push(materialise(s, 0));
    }
    return out;
}

/** Test-only. Drops the whole index so a test can prove init() rebuilds and is idempotent. */
export function __resetForTests(): void {
    built = false;
    buildMs = 0;
    mapSquares = 0;
    placedCount = 0;
    inFlight = null;
    locDefs.clear(); npcDefs.clear(); objDefs.clear();
    locIdsByNameLc.clear(); npcIdsByNameLc.clear(); objIdsByNameLc.clear();
    zoneIndex.clear();
    locNamed = new Uint8Array(0);
    pX = new Uint16Array(0); pZ = new Uint16Array(0); pId = new Uint16Array(0);
    pLevel = new Uint8Array(0); pShape = new Uint8Array(0); pAngle = new Uint8Array(0);
}

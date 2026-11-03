// STATIC NPC SPAWN INDEX for the headless stack — "where in the world is the nearest <name>, and
// how many are there?", answered offline.
//
// THE GAP THIS CLOSES
//   Both the browser SDK and the headless client can only see npcs the server has pushed into view
//   (StateCollector reads state.nearbyNpcs; leanclient reads NPC_INFO). Neither can answer a
//   PLANNING question — "where should this bot go to fight Hill Giants", "how many Knights of
//   Ardougne exist", "what is the nearest camp of something my level" — because that requires
//   knowing about npcs you cannot see.
//
//   Static npc spawns are DATA, not traffic. GameMap.loadNpcs() (server/engine/src/engine/
//   GameMap.ts:135) reads them out of the packed map squares at boot and calls World.addNpc for
//   each one. The same rows live in the shipped source maps, so we can read them offline, once per
//   process, and turn "train on X" into a query instead of a hardcoded numeric type-set.
//
// PRECEDENT — this is loc-scene.ts's twin
//   loc-scene.ts indexes the LOC half of the same .jm2 files and already loads the npc NAME table
//   (npcName / npcDef / npcIdsByName from npc.pack + the .npc configs). This module is the SPAWN
//   PLACEMENT half: it imports loc-scene for every name/op question and adds only what loc-scene
//   does not have — where the spawns are, and the npc-only config fields (wander range, combat
//   level, respawn rate, size, stats).
//
// SOURCE OF TRUTH — and the two engine-parity rules
//   server/content/maps/m<mx>_<mz>.jm2, section `==== NPC ====`, one spawn per line:
//       <level> <localX> <localZ>: <npcTypeId>
//   The engine consumes the PACKED form of exactly these rows (tools/pack/map/Pack.js groups the
//   lines by coord into n<mx>_<mz>), so the text is upstream of what the server boots with.
//
//   1. NO BRIDGE RULE. loc-scene shifts a loc down a level when the level-1 land flag has
//      LINK_BELOW set, because GameMap.ts:229 does. loadNpcs does NOT do that — the npc's level
//      comes straight off the packed coord, untouched. Applying the loc rule here would silently
//      move every bridge-adjacent spawn to the wrong plane.
//   2. MEMBERS FILTERING IS THE WORLD'S, NOT THE MAP'S. GameMap.ts:143/151 skips a spawn when the
//      world is f2p and either the npc type or the tile is members-only. The realm runs
//      members=true (util/WorldConfig.ts:100), so every static spawn is live. We index all of them
//      and expose `members` per spawn plus a `f2pOnly` query option, rather than baking in a world
//      mode this module cannot observe.
//
// SHAPE OF THE THING (and why)
//   - EAGER, whole-world, built ONCE per process, exactly like loc-scene. The placement store is
//     7 bytes per spawn — the entire world is ~52KB — so the interesting number is not the index,
//     it is that ESM module state is per-process: every bot in a process shares ONE copy. A per-bot
//     index would multiply the whole thing by the bot count and undo the RAM work that landed with
//     loc-scene.
//   - Two indexes over one columnar store: ZONE buckets (8x8 tiles) for neighbourhood queries, and
//     a TYPE-ordered slot index for "every <name> in the world". A world-wide question therefore
//     costs O(spawns of that type), not O(world).
//   - No lazy per-square loading. That would put a synchronous readFileSync on the first query into
//     a new map square, i.e. inside the packet loop — the planRoute scar (~570ms sync in the loop
//     starved logins with many bots).
//
// USAGE
//     import * as npcScene from './npc-scene.js';
//     npcScene.init();                          // ONCE at startup, beside navgrid/locScene
//     const camp = npcScene.findNearestNpcSpawn(/^Hill Giant$/i, x, z, 0);
//     const all  = npcScene.npcSpawnsByName(/^Knight of Ardougne$/i);   // every one, world-wide
//     const best = npcScene.findSpawnClusters(/^Guard$/i, { radius: 12 })[0];
//
// SCOPE: pure data. This module never connects, never sends, and knows nothing about a bot.
import fs from 'fs';
import path from 'path';

import * as locScene from './loc-scene.js';
import type { LocOption } from './loc-scene.js';

const ROOT = path.resolve(import.meta.dir, '../../..');
const MAPS_DIR = path.join(ROOT, 'server', 'content', 'maps');
const SCRIPTS_DIR = path.join(ROOT, 'server', 'content', 'scripts');

/** Section marker in a .jm2. Allocated once; Buffer.indexOf on it skips straight past MAP+LOC. */
const NPC_SECTION = Buffer.from('==== NPC ====', 'ascii');

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

/** Same shape as loc-scene's LocOption: op text plus the 1-based index an OPNPC packet wants. */
export type NpcOption = LocOption;

/**
 * The npc-only half of a type definition. loc-scene already owns name + ops (they come from the
 * same pack/config files it parses); these are the fields it has no reason to keep and a
 * target-selection query cannot work without.
 *
 * Defaults mirror NpcType.ts so an absent config key reads the same as it does in the engine.
 */
export interface NpcSpawnDef {
    id: number;
    /** Pack/internal name, e.g. 'knight_of_ardougne'. */
    internal: string;
    /** Display name, e.g. 'Knight of Ardougne'. From loc-scene. */
    name: string;
    /** Ops with their 1-based OPNPC index, 'hidden' already dropped. From loc-scene. */
    options: string[];
    optionsWithIndex: NpcOption[];
    /**
     * vislevel — the combat level the CLIENT would show, with the engine's own fallbacks:
     * `vislevel=hide` becomes 0 and an absent key becomes 1, because tools/pack/config/
     * NpcConfig.ts:154 maps 'hide' to 0 and :485 emits a hard-coded 1 when the key is missing.
     *
     * So a level of 0 or 1 means "the config never stated one" at least as often as it means a
     * genuinely weak npc — bankers and shopkeepers land there. `options.includes('Attack')` (or
     * the `withOption` query filter) is the reliable "is this a combat target" test; combat level
     * is for ORDERING targets you already know are fightable.
     */
    combatLevel: number;
    /** Tiles square. 2x2 npcs (giants, dragons) need a wider approach. */
    size: number;
    /** How far from its spawn tile the npc will wander. NpcType default 5. */
    wanderRange: number;
    /** Hard leash: it will not chase past this from spawn. NpcType default 7. */
    maxRange: number;
    /** How far it looks for a target. 0 = does not hunt. */
    huntRange: number;
    /** Attack reach in tiles. 0 = melee. */
    attackRange: number;
    /** Ticks between death and respawn. NpcType default 100 (60s). */
    respawnRate: number;
    hitpoints: number;
    attack: number;
    strength: number;
    defence: number;
    ranged: number;
    magic: number;
    /** Members-only type: skipped entirely by an f2p world (GameMap.ts:151). */
    members: boolean;
    /** e.g. 'blocked', 'indoors'. '' when the config does not say. */
    moveRestrict: string;
    /** Config category name, '' when unset. */
    category: string;
}

/**
 * One static spawn point. Shaped like sdk/types.ts NearbyNpc where the fields overlap, so wiring a
 * brain that already speaks NearbyNpc is mechanical.
 *
 * `id` is the npc TYPE id (what npc.pack keys and what a .npc config declares) — NOT a live server
 * nid/index. There is no live entity here; this is where the engine will place one at boot and
 * after every respawn.
 */
export interface NpcSpawn {
    id: number;
    name: string;
    x: number;
    z: number;
    level: number;
    /** Chebyshev distance from the query origin, matching StateCollector's max(|dx|,|dz|). */
    distance: number;
    /** See NpcSpawnDef.combatLevel — 0/1 often mean "the config never said", not "weak". */
    combatLevel: number;
    size: number;
    wanderRange: number;
    maxRange: number;
    respawnRate: number;
    members: boolean;
    options: string[];
    optionsWithIndex: NpcOption[];
}

export interface SpawnQueryOptions {
    /**
     * Drop members-only npc types, i.e. answer as an f2p world would (GameMap.ts:151).
     * Default false — the realm runs members=true, so everything static is live.
     */
    f2pOnly?: boolean;
    /** Only spawns whose combat level is at least this. */
    minCombatLevel?: number;
    /** Only spawns whose combat level is at most this. */
    maxCombatLevel?: number;
    /** Only types that offer this op (case-insensitive), e.g. 'Attack' or 'Pickpocket'. */
    withOption?: string;
    /** Cap the result set. Applied after the distance sort. */
    limit?: number;
}

/** A world region. Either a box or a Chebyshev radius around a point. */
export type SpawnArea =
    | { minX: number; maxX: number; minZ: number; maxZ: number; level?: number }
    | { x: number; z: number; radius: number; level?: number };

/** One row of a per-type spawn census over an area. */
export interface SpawnCensusRow {
    id: number;
    name: string;
    combatLevel: number;
    count: number;
    options: string[];
}

/** A candidate camp: a dense knot of matching spawns. */
export interface SpawnCluster {
    /** Centroid of the members, rounded — a reasonable tile to stand on. */
    x: number;
    z: number;
    level: number;
    count: number;
    /** Furthest member from the centroid, in tiles (Chebyshev). */
    spread: number;
    /** Which types make up the cluster (a name can cover several ids). */
    types: Array<{ id: number; name: string; count: number }>;
}

export interface NpcSceneStats {
    built: boolean;
    buildMs: number;
    /** Static spawn points in the world. */
    spawns: number;
    /** Map squares that actually contain an NPC section with rows. */
    mapSquares: number;
    /** Occupied 8x8 zone buckets. */
    zones: number;
    /** npc type ids that exist in npc.pack (placed or not). */
    npcTypes: number;
    /** Distinct npc types with at least one static spawn. */
    typesPlaced: number;
    /** Spawns whose type is members-only (an f2p world would drop these). */
    membersOnlySpawns: number;
    /** Bytes held by the columnar arrays + the type-order index (the part that scales with world). */
    placementBytes: number;
}

// ---------------------------------------------------------------------------------------------
// Process-global state. ESM module scope == one copy per process, shared by every bot.
// ---------------------------------------------------------------------------------------------

let built = false;
let buildMs = 0;
let mapSquares = 0;
let membersOnlySpawns = 0;

/** typeId -> the npc-only config fields. ~1359 entries; a Map is the right size here. */
const spawnDefs = new Map<number, NpcSpawnDef>();

// Columnar placement store, counting-sorted per map square so every zone is one contiguous run.
// 7 bytes per spawn. The whole world is ~52KB, but this is process-global on purpose.
let sX = new Uint16Array(0);
let sZ = new Uint16Array(0);
let sType = new Uint16Array(0);
let sLevel = new Uint8Array(0);
let spawnCount = 0;

/** zoneKey -> start * 65536 + count, a contiguous run into the columnar arrays. */
const zoneIndex = new Map<number, number>();

/**
 * Slot indices grouped by npc type, plus typeId -> [start, count] into it. This is what makes
 * "every Knight of Ardougne in the world" cost O(5) instead of O(7496): a world-wide question
 * never scans the world.
 */
let byType = new Uint32Array(0);
const typeRange = new Map<number, number>();

/** Same zone packing as loc-scene: level(2) | zoneX(9) | zoneZ(11). */
const ZONE_Z_BITS = 11;
const ZONE_X_BITS = 9;
const zoneKey = (level: number, zx: number, zz: number): number =>
    (level << (ZONE_X_BITS + ZONE_Z_BITS)) | (zx << ZONE_Z_BITS) | zz;

/**
 * Memo for pattern -> matching type ids. A brain calling findNearestNpcSpawn(/^Hill Giant$/i, ...)
 * every tick must not re-scan the 1359-entry name table each time; resolution is the only part of
 * a query that is not already O(matches).
 */
const idsMemo = new Map<string, number[]>();
const IDS_MEMO_CAP = 512;

// ---------------------------------------------------------------------------------------------
// Config loading (the npc-only fields; names and ops come from loc-scene)
// ---------------------------------------------------------------------------------------------

/**
 * ONE reusable read buffer for every file the build touches, grown on demand. readFileSync per
 * file allocates short-lived Buffers whose arena Bun does not hand back — loc-scene measured that
 * at +37MB RSS for nothing. 51.5MB of map text goes through this one buffer instead.
 */
let readBuf = Buffer.allocUnsafe(512 * 1024);

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

function collectConfigFiles(dir: string, ext: string, out: string[]): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collectConfigFiles(p, ext, out);
        else if (e.name.endsWith(ext)) out.push(p);
    }
    return out;
}

/** Raw npc-only fields keyed by INTERNAL name, before the join onto ids via loc-scene. */
interface RawNpcConfig {
    vislevel: number;
    size: number;
    wanderrange: number;
    maxrange: number;
    huntrange: number;
    attackrange: number;
    respawnrate: number;
    hitpoints: number;
    attack: number;
    strength: number;
    defence: number;
    ranged: number;
    magic: number;
    members: boolean;
    moverestrict: string;
    category: string;
}

/**
 * NpcType.ts field defaults, so an absent key reads exactly as the engine reads it.
 * vislevel is the one exception: NpcType's class default is -1, but the packer ALWAYS emits the
 * opcode (NpcConfig.ts:485 writes a literal 1 when the config omits it), so 1 is what a running
 * server actually holds.
 */
function defaultRaw(): RawNpcConfig {
    return {
        vislevel: 1, size: 1, wanderrange: 5, maxrange: -1, huntrange: 0, attackrange: 0,   // maxrange -1 = unset (see postDecode below)
        respawnrate: 100, hitpoints: 1, attack: 1, strength: 1, defence: 1, ranged: 1, magic: 1,
        members: false, moverestrict: '', category: '',
    };
}

/**
 * parseInt with a fallback, because these configs are not all numbers: `vislevel=hide` is real and
 * a bare parseInt would put NaN in the index, which then poisons every comparison silently (NaN
 * fails both `< min` and `> max`, so a bad row would slip through every level filter).
 */
function parseIntOr(text: string, fallback: number): number {
    const n = parseInt(text);
    return Number.isFinite(n) ? n : fallback;
}

/** True if buf[at..keyEnd) equals the ASCII `word`, without slicing a key string out. */
function keyIs(buf: Buffer, at: number, keyEnd: number, word: string): boolean {
    if (keyEnd - at !== word.length) return false;
    for (let k = 0; k < word.length; k++) if (buf[at + k] !== word.charCodeAt(k)) return false;
    return true;
}

/**
 * Parse every .npc config into `internal name -> npc-only fields`.
 *
 * BYTE-LEVEL, for the reason loc-scene documents: the string version of this parser cost +58MB RSS
 * to retain a few MB, because split('\n') over hundreds of config files is ~129k throwaway strings.
 * A string is only materialised for a key we keep.
 *
 * This duplicates loc-scene's config SCANNER (which is module-private there) but not its OUTPUT:
 * we deliberately keep none of the keys it already exposes — no name, no ops.
 */
function loadNpcConfigs(): Map<string, RawNpcConfig> {
    const out = new Map<string, RawNpcConfig>();
    for (const file of collectConfigFiles(SCRIPTS_DIR, '.npc', [])) {
        const len = readIntoScratch(file);
        const buf = readBuf.subarray(0, len);
        let cur: RawNpcConfig | null = null;
        let i = 0;

        while (i < len) {
            let nl = buf.indexOf(10 /* \n */, i);
            if (nl === -1) nl = len;
            let end = nl;
            while (end > i && (buf[end - 1] === 13 || buf[end - 1] === 32 || buf[end - 1] === 9)) end--;
            let s = i;
            while (s < end && (buf[s] === 32 || buf[s] === 9)) s++;

            if (s === end || buf[s] === 47 /* / */) { i = nl + 1; continue; }

            if (buf[s] === 91 /* [ */ && buf[end - 1] === 93 /* ] */) {
                cur = defaultRaw();
                out.set(buf.toString('utf8', s + 1, end - 1), cur);
                i = nl + 1;
                continue;
            }
            if (!cur) { i = nl + 1; continue; }

            const eq = buf.indexOf(61 /* = */, s);
            if (eq === -1 || eq >= end) { i = nl + 1; continue; }
            let v = eq + 1;
            while (v < end && (buf[v] === 32 || buf[v] === 9)) v++;

            // Ordered roughly by how often the key appears, so the common ones exit early.
            if (keyIs(buf, s, eq, 'vislevel')) {
                // NpcConfig.ts:154 — 'hide' is a real value and it means combat level 0.
                const raw = buf.toString('ascii', v, end);
                cur.vislevel = raw === 'hide' ? 0 : parseIntOr(raw, 1);
            }
            else if (keyIs(buf, s, eq, 'wanderrange')) cur.wanderrange = parseIntOr(buf.toString('ascii', v, end), 5);
            else if (keyIs(buf, s, eq, 'hitpoints')) cur.hitpoints = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'attack')) cur.attack = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'defence')) cur.defence = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'strength')) cur.strength = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'maxrange')) cur.maxrange = parseIntOr(buf.toString('ascii', v, end), -1);
            else if (keyIs(buf, s, eq, 'respawnrate')) cur.respawnrate = parseIntOr(buf.toString('ascii', v, end), 100);
            else if (keyIs(buf, s, eq, 'huntrange')) cur.huntrange = parseIntOr(buf.toString('ascii', v, end), 0);
            else if (keyIs(buf, s, eq, 'attackrange')) cur.attackrange = parseIntOr(buf.toString('ascii', v, end), 0);
            else if (keyIs(buf, s, eq, 'ranged')) cur.ranged = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'magic')) cur.magic = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'size')) cur.size = parseIntOr(buf.toString('ascii', v, end), 1);
            else if (keyIs(buf, s, eq, 'category')) cur.category = buf.toString('utf8', v, end);
            else if (keyIs(buf, s, eq, 'moverestrict')) cur.moverestrict = buf.toString('utf8', v, end);
            else if (keyIs(buf, s, eq, 'members')) cur.members = buf[v] === 121 /* y */ || buf[v] === 116 /* t */;

            i = nl + 1;
        }
    }
    return out;
}

/**
 * Join the npc-only config fields onto the ids loc-scene already resolved.
 * loc-scene owns npc.pack (id -> internal) and the display name + ops; we own everything else.
 */
function buildTypeTable(): void {
    const raw = loadNpcConfigs();
    // npc.pack ids are dense from 0. loc-scene.stats().npcTypes is the count.
    const count = locScene.stats().npcTypes;
    for (let id = 0; id < count; id++) {
        const base = locScene.npcDef(id);
        if (!base) continue;
        const cfg = raw.get(base.internal) ?? defaultRaw();
        spawnDefs.set(id, {
            id,
            internal: base.internal,
            name: base.name,
            options: base.options,
            optionsWithIndex: base.optionsWithIndex,
            combatLevel: cfg.vislevel,
            size: cfg.size,
            wanderRange: cfg.wanderrange,
            // NpcType.postDecode (rev 289): an unset maxrange is wanderrange + 2, and never below wanderrange.
            // (274 had a fixed class default of 7 and its content stated maxrange explicitly; 289 dropped those lines.)
            maxRange: Math.max(cfg.maxrange === -1 ? cfg.wanderrange + 2 : cfg.maxrange, cfg.wanderrange),
            huntRange: cfg.huntrange,
            attackRange: cfg.attackrange,
            respawnRate: cfg.respawnrate,
            hitpoints: cfg.hitpoints,
            attack: cfg.attack,
            strength: cfg.strength,
            defence: cfg.defence,
            ranged: cfg.ranged,
            magic: cfg.magic,
            members: cfg.members,
            moveRestrict: cfg.moverestrict,
            category: cfg.category,
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Spawn index
// ---------------------------------------------------------------------------------------------

function ensureCapacity(need: number): void {
    if (need <= sX.length) return;
    let cap = sX.length || 1 << 13;
    while (cap < need) cap *= 2;
    const nx = new Uint16Array(cap); nx.set(sX); sX = nx;
    const nz = new Uint16Array(cap); nz.set(sZ); sZ = nz;
    const nt = new Uint16Array(cap); nt.set(sType); sType = nt;
    const nl = new Uint8Array(cap); nl.set(sLevel); sLevel = nl;
}

/** Per-map-square scratch, reused across all 483 files. The densest square holds ~150 spawns. */
const TMP_CAP = 1 << 12;
const tX = new Uint16Array(TMP_CAP), tZ = new Uint16Array(TMP_CAP);
const tType = new Uint16Array(TMP_CAP), tLevel = new Uint8Array(TMP_CAP);
const tZone = new Int32Array(TMP_CAP);

/** Cursor for the byte scanner — a return-two-values workaround without allocating. */
let scanPos = 0;

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
 * Parse one map square's NPC section and append it, zone-sorted, to the columnar store.
 *
 * The sections always run MAP, LOC, NPC, OBJ, and MAP+LOC are ~99% of the bytes. One Buffer.indexOf
 * for the section marker skips all of it, so this parse touches only the handful of NPC lines even
 * though the file is up to 337KB. Reading the file is the cost; parsing it is not.
 *
 * Each file covers one 64x64 map square, so its zones are disjoint from every other file's — a
 * sort WITHIN the file is enough to make every zone one contiguous global run.
 */
function ingestMapSquare(file: string, msx: number, msz: number): void {
    const len = readIntoScratch(file);
    const buf = readBuf.subarray(0, len);

    const at = buf.indexOf(NPC_SECTION);
    if (at === -1) return;
    let i = buf.indexOf(10 /* \n */, at);
    if (i === -1) return;
    i++;

    let n = 0;
    while (i < len) {
        let nl = buf.indexOf(10, i);
        if (nl === -1) nl = len;
        let end = nl;
        if (end > i && buf[end - 1] === 13 /* \r */) end--;
        if (end === i) { i = nl + 1; continue; }
        // Next section marker ends the NPC block.
        if (buf[i] === 61 /* = */) break;

        // "<level> <x> <z>: <npcId>"
        const level = readUint(buf, i, end);
        const lx = readUint(buf, scanPos + 1, end);
        const lz = readUint(buf, scanPos + 1, end);
        let p = scanPos;
        if (buf[p] !== 58 /* : */) { i = nl + 1; continue; }
        const id = readUint(buf, p + 2, end);

        // NO BRIDGE ADJUSTMENT — GameMap.loadNpcs (:135) uses the packed level verbatim, unlike
        // loadLocations. See the header note.
        if (n >= TMP_CAP) throw new Error(`npc-scene: ${file} has >${TMP_CAP} npc spawns; raise TMP_CAP`);
        tX[n] = msx + lx;
        tZ[n] = msz + lz;
        tLevel[n] = level;
        tType[n] = id;
        n++;

        i = nl + 1;
    }

    if (n === 0) return;

    const counts = new Map<number, number>();
    for (let j = 0; j < n; j++) {
        const k = zoneKey(tLevel[j]!, tX[j]! >> 3, tZ[j]! >> 3);
        tZone[j] = k;
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const base = spawnCount;
    ensureCapacity(base + n);

    const cursor = new Map<number, number>();
    let off = base;
    for (const k of [...counts.keys()].sort((a, b) => a - b)) {
        // Two files could only share a zone if map squares overlapped, which they do not.
        if (zoneIndex.has(k)) throw new Error(`npc-scene: zone ${k} claimed twice (${file})`);
        const c = counts.get(k)!;
        zoneIndex.set(k, off * 65536 + c);
        cursor.set(k, off);
        off += c;
    }

    for (let j = 0; j < n; j++) {
        const k = tZone[j]!;
        const slot = cursor.get(k)!;
        cursor.set(k, slot + 1);
        sX[slot] = tX[j]!;
        sZ[slot] = tZ[j]!;
        sType[slot] = tType[j]!;
        sLevel[slot] = tLevel[j]!;
    }
    spawnCount = base + n;
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

/** Counting-sort the slots by type id, so "all spawns of type X" is one contiguous run. */
function buildTypeIndex(): void {
    const counts = new Map<number, number>();
    membersOnlySpawns = 0;
    for (let s = 0; s < spawnCount; s++) {
        const t = sType[s]!;
        counts.set(t, (counts.get(t) ?? 0) + 1);
        if (spawnDefs.get(t)?.members === true) membersOnlySpawns++;
    }
    byType = new Uint32Array(spawnCount);
    const cursor = new Map<number, number>();
    let off = 0;
    for (const t of [...counts.keys()].sort((a, b) => a - b)) {
        const c = counts.get(t)!;
        typeRange.set(t, off * 65536 + c);
        cursor.set(t, off);
        off += c;
    }
    for (let s = 0; s < spawnCount; s++) {
        const t = sType[s]!;
        const slot = cursor.get(t)!;
        cursor.set(t, slot + 1);
        byType[slot] = s;
    }
}

function trimArrays(): void {
    if (spawnCount === sX.length) return;
    sX = sX.slice(0, spawnCount);
    sZ = sZ.slice(0, spawnCount);
    sType = sType.slice(0, spawnCount);
    sLevel = sLevel.slice(0, spawnCount);
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

/**
 * Build the process-global spawn index. IDEMPOTENT — the second and every later call is a no-op,
 * so every bot in the process can call it defensively and only one pays.
 *
 * Calls locScene.init() first (also idempotent): the name table is loc-scene's, and this module is
 * the placement half of the same data. If loc-scene is already up, that call costs nothing.
 *
 * CALL THIS AT STARTUP, NOT FROM THE PACKET LOOP. It is synchronous file IO over the whole map set.
 */
export function init(): void {
    if (built) return;
    const start = Date.now();
    locScene.init();
    buildTypeTable();
    for (const { file, msx, msz } of mapSquareFiles()) ingestMapSquare(file, msx, msz);
    trimArrays();
    buildTypeIndex();
    built = true;
    buildMs = Date.now() - start;
}

/**
 * Same build, yielding to the event loop between map squares so an already-running packet loop
 * keeps reading packets. Idempotent, and safe to await concurrently — the first caller builds, the rest
 * await the same promise.
 */
let inFlight: Promise<void> | null = null;
export function initAsync(): Promise<void> {
    if (built) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
        const start = Date.now();
        await locScene.initAsync();
        buildTypeTable();
        let i = 0;
        for (const { file, msx, msz } of mapSquareFiles()) {
            ingestMapSquare(file, msx, msz);
            if (++i % 32 === 0) await new Promise<void>(r => setImmediate(r));
        }
        trimArrays();
        buildTypeIndex();
        built = true;
        buildMs = Date.now() - start;
        inFlight = null;
    })();
    return inFlight;
}

export function isReady(): boolean {
    return built;
}

export function stats(): NpcSceneStats {
    return {
        built,
        buildMs,
        spawns: spawnCount,
        mapSquares,
        zones: zoneIndex.size,
        npcTypes: spawnDefs.size,
        typesPlaced: typeRange.size,
        membersOnlySpawns,
        placementBytes: sX.byteLength + sZ.byteLength + sType.byteLength + sLevel.byteLength
            + byType.byteLength,
    };
}

function requireReady(): void {
    if (!built) {
        throw new Error(
            'npc-scene: not initialised. Call npcScene.init() once at startup (or await ' +
            'npcScene.initAsync()) BEFORE querying. Building lazily from a query would put ' +
            'hundreds of milliseconds of synchronous file IO inside the packet loop.'
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Type tables
// ---------------------------------------------------------------------------------------------

/** The npc-only config fields for a type id. Names/ops also included, sourced from loc-scene. */
export function npcSpawnDef(typeId: number): NpcSpawnDef | undefined {
    requireReady();
    return spawnDefs.get(typeId);
}

/**
 * Type ids matching a name. A bare string is EXACT and case-insensitive; a RegExp is tested
 * against the display name. Delegates to loc-scene's reverse lookup and memoises the answer, so a
 * brain can call this on every tick.
 *
 * The memo is why this is separate from the query functions: pattern resolution is the only part
 * of a spawn query that is not already proportional to the number of matches.
 */
export function npcSpawnTypeIds(pattern: string | RegExp): number[] {
    requireReady();
    const key = typeof pattern === 'string'
        ? `s:${pattern.toLowerCase()}`
        : `r:${pattern.source} ${pattern.flags}`;
    const hit = idsMemo.get(key);
    if (hit) return hit;
    // Only a memo MISS reaches into loc-scene, so the hot path never depends on it. Everything
    // else in this module answers from our own tables, which hold copies made at build time.
    if (!locScene.isReady()) {
        throw new Error(
            'npc-scene: loc-scene was torn down after npc-scene was built. Name resolution is ' +
            "loc-scene's table; re-run locScene.init() (it is idempotent) before querying by name."
        );
    }
    const ids = locScene.npcIdsByName(pattern);
    // Bounded: a caller building regexes in a loop must not grow this without limit.
    if (idsMemo.size >= IDS_MEMO_CAP) idsMemo.clear();
    idsMemo.set(key, ids);
    return ids;
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

function materialise(slot: number, distance: number): NpcSpawn {
    const id = sType[slot]!;
    const def = spawnDefs.get(id);
    return {
        id,
        name: def?.name ?? '',
        x: sX[slot]!,
        z: sZ[slot]!,
        level: sLevel[slot]!,
        distance,
        combatLevel: def?.combatLevel ?? -1,
        size: def?.size ?? 1,
        wanderRange: def?.wanderRange ?? 5,
        maxRange: def?.maxRange ?? 7,
        respawnRate: def?.respawnRate ?? 100,
        members: def?.members ?? false,
        options: def?.options ?? [],
        optionsWithIndex: def?.optionsWithIndex ?? [],
    };
}

/** Apply the type-level filters in SpawnQueryOptions. Cheap: one Map hit per candidate. */
function passesFilters(typeId: number, opts: SpawnQueryOptions, wantOpLc: string | null): boolean {
    if (opts.f2pOnly !== true && opts.minCombatLevel === undefined
        && opts.maxCombatLevel === undefined && wantOpLc === null) return true;
    const def = spawnDefs.get(typeId);
    if (!def) return false;
    if (opts.f2pOnly === true && def.members) return false;
    if (opts.minCombatLevel !== undefined && def.combatLevel < opts.minCombatLevel) return false;
    if (opts.maxCombatLevel !== undefined && def.combatLevel > opts.maxCombatLevel) return false;
    if (wantOpLc !== null) {
        let found = false;
        for (const o of def.options) if (o.toLowerCase() === wantOpLc) { found = true; break; }
        if (!found) return false;
    }
    return true;
}

const opFilter = (opts: SpawnQueryOptions): string | null =>
    opts.withOption === undefined ? null : opts.withOption.toLowerCase();

/** Build a Set of matching type ids, or null when the pattern matches nothing. */
function matchSet(pattern: string | RegExp): Set<number> | null {
    const ids = npcSpawnTypeIds(pattern);
    return ids.length === 0 ? null : new Set(ids);
}

/**
 * Walk the zone buckets covering a square neighbourhood and hand each candidate to `visit`.
 * Bounded by the radius, never by the world.
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
                const dx = sX[s]! - x, dz = sZ[s]! - z;
                const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
                const distance = adx > adz ? adx : adz;
                if (distance > radius) continue;
                visit(s, distance);
            }
        }
    }
}

/** Walk every spawn of every type in `ids` via the type-ordered index. O(matches), not O(world). */
function forEachOfTypes(ids: Iterable<number>, visit: (slot: number) => void): void {
    for (const t of ids) {
        const packed = typeRange.get(t);
        if (packed === undefined) continue;
        const count = packed % 65536;
        const start = (packed - count) / 65536;
        for (let i = start; i < start + count; i++) visit(byType[i]!);
    }
}

/**
 * The NEAREST static spawn of a named npc, searched over the WHOLE WORLD by default.
 *
 * This is the query the SDK cannot answer at all: the browser only knows about npcs already in
 * view, so "where is the nearest Hill Giant" has no answer there unless one is already on screen.
 *
 * Level-scoped by default (a spawn on another plane needs stairs to reach, so it is rarely the
 * right answer); pass `{ anyLevel: true }` to search every plane. Bound the search with
 * `{ maxRadius }` when you only care about the local neighbourhood.
 *
 * Cost is O(spawns of the matching types) — 5 for Knight of Ardougne, ~200 for Man. Cheap enough
 * to call from a brain.
 */
export function findNearestNpcSpawn(
    pattern: string | RegExp,
    x: number,
    z: number,
    level = 0,
    opts: SpawnQueryOptions & { anyLevel?: boolean; maxRadius?: number } = {},
): NpcSpawn | null {
    requireReady();
    const ids = matchSet(pattern);
    if (!ids) return null;
    const wantOp = opFilter(opts);
    const maxRadius = opts.maxRadius ?? Number.MAX_SAFE_INTEGER;
    let bestSlot = -1;
    let bestDist = Number.MAX_SAFE_INTEGER;
    forEachOfTypes(ids, slot => {
        if (opts.anyLevel !== true && sLevel[slot] !== level) return;
        const dx = sX[slot]! - x, dz = sZ[slot]! - z;
        const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
        const d = adx > adz ? adx : adz;
        if (d >= bestDist || d > maxRadius) return;
        if (!passesFilters(sType[slot]!, opts, wantOp)) return;
        bestDist = d;
        bestSlot = slot;
    });
    return bestSlot === -1 ? null : materialise(bestSlot, bestDist);
}

/**
 * Every static spawn of a named npc within `radius` tiles (Chebyshev) of (x,z) on `level`,
 * nearest first. Zone-bucketed, so cost tracks the radius and not the world.
 *
 * A bare string is a case-insensitive EXACT name here (unlike loc-scene's substring rule for locs)
 * because it resolves through the name -> ids table; pass a RegExp for anything looser.
 */
export function findNpcSpawnsInRadius(
    pattern: string | RegExp,
    x: number,
    z: number,
    level = 0,
    radius = 15,
    opts: SpawnQueryOptions = {},
): NpcSpawn[] {
    requireReady();
    const ids = matchSet(pattern);
    if (!ids) return [];
    const wantOp = opFilter(opts);
    const out: NpcSpawn[] = [];
    forEachInRadius(x, z, level, radius, (slot, distance) => {
        const t = sType[slot]!;
        if (!ids.has(t)) return;
        if (!passesFilters(t, opts, wantOp)) return;
        out.push(materialise(slot, distance));
    });
    out.sort((a, b) => a.distance - b.distance);
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/** Every static spawn of ANY type in radius, nearest first. The "what lives around here" query. */
export function getNpcSpawnsInRadius(
    x: number, z: number, level = 0, radius = 15, opts: SpawnQueryOptions = {},
): NpcSpawn[] {
    requireReady();
    const wantOp = opFilter(opts);
    const out: NpcSpawn[] = [];
    forEachInRadius(x, z, level, radius, (slot, distance) => {
        if (!passesFilters(sType[slot]!, opts, wantOp)) return;
        out.push(materialise(slot, distance));
    });
    out.sort((a, b) => a.distance - b.distance);
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/** Every static spawn on one exact tile (several npcs can share a spawn tile). */
export function getNpcSpawnsAt(x: number, z: number, level = 0, opts: SpawnQueryOptions = {}): NpcSpawn[] {
    return getNpcSpawnsInRadius(x, z, level, 0, opts);
}

/**
 * EVERY world location a named npc spawns at — all map squares, all planes — sorted by level then
 * x then z so the answer is stable across builds.
 *
 * This is the planning query: "how many Knights of Ardougne exist and where are they" is a fact
 * about the map, and it is not observable from a game connection at all.
 */
export function npcSpawnsByName(
    pattern: string | RegExp,
    opts: SpawnQueryOptions & { level?: number } = {},
): NpcSpawn[] {
    requireReady();
    const ids = matchSet(pattern);
    if (!ids) return [];
    const wantOp = opFilter(opts);
    const out: NpcSpawn[] = [];
    forEachOfTypes(ids, slot => {
        if (opts.level !== undefined && sLevel[slot] !== opts.level) return;
        if (!passesFilters(sType[slot]!, opts, wantOp)) return;
        out.push(materialise(slot, 0));
    });
    out.sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z || a.id - b.id);
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

function inArea(area: SpawnArea, x: number, z: number, level: number): boolean {
    if (area.level !== undefined && area.level !== level) return false;
    if ('radius' in area) {
        const dx = x - area.x, dz = z - area.z;
        const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
        return (adx > adz ? adx : adz) <= area.radius;
    }
    return x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;
}

/**
 * How many static spawns of a named npc exist, optionally restricted to an area.
 * With no area this is the world-wide population — the number that decides whether a camp can feed
 * one bot or forty.
 */
export function countNpcSpawns(
    pattern: string | RegExp, area?: SpawnArea, opts: SpawnQueryOptions = {},
): number {
    requireReady();
    const ids = matchSet(pattern);
    if (!ids) return 0;
    const wantOp = opFilter(opts);
    let n = 0;
    forEachOfTypes(ids, slot => {
        if (area && !inArea(area, sX[slot]!, sZ[slot]!, sLevel[slot]!)) return;
        if (!passesFilters(sType[slot]!, opts, wantOp)) return;
        n++;
    });
    return n;
}

/**
 * Per-type spawn census of an area, densest first. The neutral primitive behind "what can this bot
 * train on around here": filter by combat level and read off the types with enough bodies.
 *
 * A radius area walks the zone buckets; a box (or no area at all) scans the whole store, which is
 * ~7.5k entries — fine offline, and still sub-millisecond, but the radius form is the one to call
 * from a brain.
 */
export function census(area?: SpawnArea, opts: SpawnQueryOptions = {}): SpawnCensusRow[] {
    requireReady();
    const wantOp = opFilter(opts);
    const tally = new Map<number, number>();
    const bump = (slot: number): void => {
        const t = sType[slot]!;
        if (!passesFilters(t, opts, wantOp)) return;
        tally.set(t, (tally.get(t) ?? 0) + 1);
    };

    if (area && 'radius' in area && area.level !== undefined) {
        forEachInRadius(area.x, area.z, area.level, area.radius, slot => bump(slot));
    } else {
        for (let s = 0; s < spawnCount; s++) {
            if (area && !inArea(area, sX[s]!, sZ[s]!, sLevel[s]!)) continue;
            bump(s);
        }
    }

    const rows: SpawnCensusRow[] = [];
    for (const [id, count] of tally) {
        const def = spawnDefs.get(id);
        rows.push({
            id,
            name: def?.name ?? '',
            combatLevel: def?.combatLevel ?? -1,
            count,
            options: def?.options ?? [],
        });
    }
    rows.sort((a, b) => b.count - a.count || a.id - b.id);
    return opts.limit !== undefined ? rows.slice(0, opts.limit) : rows;
}

/**
 * Candidate CAMPS for a named npc: knots of matching spawns within `radius` of each other, densest
 * first, non-overlapping.
 *
 * This is the "training venue" query. `count` is how many bodies a bot standing at (x,z) has in
 * reach, which is the number that decides how many bots a camp can support.
 *
 * OFFLINE TOOLING, not the packet loop: the clustering is O(m^2) in the number of matching spawns.
 * That is nothing for a specific name (5 knights, ~30 hill giants) but a pattern matching thousands
 * of spawns will cost tens of milliseconds. Call it once when picking camps, not per tick.
 */
export function findSpawnClusters(
    pattern: string | RegExp,
    opts: SpawnQueryOptions & { radius?: number; level?: number; minCount?: number } = {},
): SpawnCluster[] {
    requireReady();
    const ids = matchSet(pattern);
    if (!ids) return [];
    const wantOp = opFilter(opts);
    const radius = opts.radius ?? 10;
    const minCount = opts.minCount ?? 1;

    const slots: number[] = [];
    forEachOfTypes(ids, slot => {
        if (opts.level !== undefined && sLevel[slot] !== opts.level) return;
        if (!passesFilters(sType[slot]!, opts, wantOp)) return;
        slots.push(slot);
    });
    if (slots.length === 0) return [];

    // Seed a candidate cluster on every spawn, scored by how many matching spawns sit within
    // `radius` of it on the same plane.
    const members: number[][] = [];
    for (let i = 0; i < slots.length; i++) {
        const a = slots[i]!;
        const ax = sX[a]!, az = sZ[a]!, al = sLevel[a]!;
        const group: number[] = [];
        for (let j = 0; j < slots.length; j++) {
            const b = slots[j]!;
            if (sLevel[b] !== al) continue;
            const dx = sX[b]! - ax, dz = sZ[b]! - az;
            const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
            if ((adx > adz ? adx : adz) <= radius) group.push(b);
        }
        members.push(group);
    }

    const order = slots.map((_, i) => i).sort((a, b) => members[b]!.length - members[a]!.length
        || sX[slots[a]!]! - sX[slots[b]!]! || sZ[slots[a]!]! - sZ[slots[b]!]!);

    const taken = new Set<number>();
    const out: SpawnCluster[] = [];
    for (const i of order) {
        const group = members[i]!;
        if (group.length < minCount) continue;
        // Greedy: skip a seed whose members are already claimed by a denser camp.
        let overlap = false;
        for (const s of group) if (taken.has(s)) { overlap = true; break; }
        if (overlap) continue;

        let sumX = 0, sumZ = 0;
        const typeTally = new Map<number, number>();
        for (const s of group) {
            taken.add(s);
            sumX += sX[s]!;
            sumZ += sZ[s]!;
            const t = sType[s]!;
            typeTally.set(t, (typeTally.get(t) ?? 0) + 1);
        }
        const cx = Math.round(sumX / group.length);
        const cz = Math.round(sumZ / group.length);
        let spread = 0;
        for (const s of group) {
            const dx = sX[s]! - cx, dz = sZ[s]! - cz;
            const adx = dx < 0 ? -dx : dx, adz = dz < 0 ? -dz : dz;
            const d = adx > adz ? adx : adz;
            if (d > spread) spread = d;
        }
        const types = [...typeTally].map(([id, count]) => ({
            id, name: spawnDefs.get(id)?.name ?? '', count,
        })).sort((a, b) => b.count - a.count || a.id - b.id);

        out.push({ x: cx, z: cz, level: sLevel[slots[i]!]!, count: group.length, spread, types });
    }
    out.sort((a, b) => b.count - a.count || a.x - b.x || a.z - b.z);
    return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/** Test-only. Drops the whole index so a test can prove init() rebuilds and is idempotent. */
export function __resetForTests(): void {
    built = false;
    buildMs = 0;
    mapSquares = 0;
    spawnCount = 0;
    membersOnlySpawns = 0;
    inFlight = null;
    spawnDefs.clear();
    zoneIndex.clear();
    typeRange.clear();
    idsMemo.clear();
    sX = new Uint16Array(0); sZ = new Uint16Array(0);
    sType = new Uint16Array(0); sLevel = new Uint8Array(0);
    byType = new Uint32Array(0);
}

// PORTAL-GRAPH VALIDATOR — the offline half of the portal trust pass. The auto-extracted portals.json
// coords are UNVERIFIED (two live defects found a walled-off entrance, an inaccurate dest).
// This validator catches the classes that are catchable OFFLINE against the real rsmod collision:
//   E-SEALED : the entrance op-tile has NO reachable adjacent stand (walled pocket — wizard-tower class)
//   E-UNREACH: a surface entrance a hub route can't reach (maybe fine — remote area — but flagged)
//   D-VOID   : the dest tile sits in unallocated/blocked collision (bad extraction — telejump to a wall)
//   D-POCKET : the dest is walkable but its pocket is tiny (<5 tiles) — a landing you can't leave
// What it CANNOT catch: a dest that is walkable but simply the WRONG tile (the castle-stairs class) —
// that needs the live probe (ml-follow-probe.ts) or a fixed extractor. Output: a console report +
// portal-suspects.json (consumed by levels.ts planMultiLevel — suspects are skipped in planning).
//
// Run: bun sdk/navgrid/validate-portals.ts [--write]
import { writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { findLongPath, initPathfinding, isZoneAllocated } from '../pathfinding.js';
import { allPortals, type Portal } from './levels.js';

// ---- loc footprint sizes (width/length from the .loc configs; default 1x1) -----------------------
// A staircase is 2x2+; its op-ORIGIN tile sits inside its OWN collision, so approachability must be
// measured against the FOOTPRINT edge, not the origin (first run false-flagged every big staircase,
// including two live-proven ones — Dwarven + Duke).
function locSizes(): Map<number, number> {
    const idByName = new Map<string, number>();
    for (const line of readFileSync(new URL('../../server/content/pack/loc.pack', import.meta.url), 'utf8').split('\n')) {
        const m = line.match(/^(\d+)=(\S+)/);
        if (m) idByName.set(m[2]!, Number(m[1]!));
    }
    const sizes = new Map<number, number>();
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            const p = join(dir, e);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!e.endsWith('.loc')) continue;
            let cur = -1, w = 1, l = 1;
            const flush = () => { if (cur >= 0 && Math.max(w, l) > 1) sizes.set(cur, Math.max(w, l)); };
            for (const line of readFileSync(p, 'utf8').split('\n')) {
                const b = line.match(/^\[(\S+)\]/);
                if (b) { flush(); cur = idByName.get(b[1]!) ?? -1; w = 1; l = 1; continue; }
                const wm = line.match(/^width=(\d+)/); if (wm) w = Number(wm[1]!);
                const lm = line.match(/^length=(\d+)/); if (lm) l = Number(lm[1]!);
            }
            flush();
        }
    };
    walk(new URL('../../server/content/scripts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
    return sizes;
}

const HUBS = [
    { name: 'Lumbridge', x: 3222, z: 3218 },
    { name: 'Varrock', x: 3212, z: 3422 },
    { name: 'Falador', x: 2965, z: 3380 },
    { name: 'Ardougne', x: 2662, z: 3305 },
    { name: 'AlKharid', x: 3293, z: 3174 },
    { name: 'Catherby', x: 2806, z: 3441 },
];
const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

// Can an entity standing at (x,z) reach a tile `r` away on this level? Proves the tile is inside a
// walkable pocket of useful size (a telejump onto a 1-tile island is a trap, not a landing).
function pocketReach(level: number, x: number, z: number, r: number): boolean {
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
        const wp = findLongPath(level, x, z, x + dx, z + dz, 300);
        if (wp.length) {
            const end = wp[wp.length - 1]!;
            if (cheb(end.x, end.z, x, z) >= Math.max(2, r - 2)) return true;
        }
    }
    return false;
}

initPathfinding();
const SIZES = locSizes();
const portals = allPortals();
console.log(`validating ${portals.length} portals (${SIZES.size} multi-tile loc sizes loaded)...`);

// entrance approachability: from ring tiles OUTSIDE the loc's footprint, can a route end adjacent to
// the footprint (within `size` of the origin)? Sealed = no ring source gets there. 1x1 ladders get the
// strict <=1 adjacency that catches the wizard-tower class; 2x2+ staircases are judged at their edge.
function entranceApproachable(level: number, x: number, z: number, size: number): boolean {
    // multiple radii: an UPSTAIRS op sits on a small floor — a wide ring lands in off-building void on
    // that plane (false SEALED); a tight ring may start inside the loc's own footprint (path fails,
    // harmless). Any success at any radius = approachable.
    for (const ring of [2, size + 1, size + 4]) {
        for (const [dx, dz] of [[ring, 0], [-ring, 0], [0, ring], [0, -ring], [ring, ring], [-ring, -ring], [ring, -ring], [-ring, ring]]) {
            const wp = findLongPath(level, x + dx, z + dz, x, z, 400);
            if (!wp.length) continue;
            const end = wp[wp.length - 1]!;
            if (cheb(end.x, end.z, x, z) <= size) return true;
        }
    }
    return false;
}

type Verdict = { portal: Portal; flags: string[] };
const results: Verdict[] = [];
let t0 = Date.now();

for (const [i, p] of portals.entries()) {
    const flags: string[] = [];
    const size = SIZES.get(p.locId ?? -1) ?? 1;

    // a portal without a loc id cannot be OPLOC'd by the follower at all
    if (p.locId === undefined) flags.push('NO-LOC');

    // --- dest sanity -----------------------------------------------------------------------------
    // The telejump PLACES the player, bypassing collision — the landing tile itself may sit on a
    // staircase footprint (rsmod-blocked) and still be perfectly fine live (the Dwarven return does).
    // So judge the LANDING AREA: the dest or any neighbour must connect to a pocket of useful size.
    if (!isZoneAllocated(p.dest.level, p.dest.x, p.dest.z)) flags.push('D-VOID');
    else {
        let connected = false;
        outer: for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (pocketReach(p.dest.level, p.dest.x + dx, p.dest.z + dz, 4)) { connected = true; break outer; }
        }
        if (!connected) flags.push('D-POCKET');
    }

    // --- entrance sanity -------------------------------------------------------------------------
    if (!entranceApproachable(p.level, p.x, p.z, size)) flags.push('E-SEALED');
    // hub-reach: SURFACE entrances only (underground/upper entrances are reached via the graph itself)
    if (p.level === 0 && p.z < 6400) {
        const hub = HUBS.reduce((a, b) => (cheb(a.x, a.z, p.x, p.z) <= cheb(b.x, b.z, p.x, p.z) ? a : b));
        const wp = findLongPath(0, hub.x, hub.z, p.x, p.z, 3000);
        const end = wp.length ? wp[wp.length - 1]! : null;
        if (!end || cheb(end.x, end.z, p.x, p.z) > 2) flags.push(`E-UNREACH(${hub.name})`);
    }

    if (flags.length) results.push({ portal: p, flags });
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${portals.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

console.log(`\n=== ${results.length}/${portals.length} portals flagged ===`);
const byFlag = new Map<string, number>();
for (const r of results) for (const f of r.flags) byFlag.set(f.split('(')[0]!, (byFlag.get(f.split('(')[0]!) ?? 0) + 1);
for (const [f, n] of [...byFlag].sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`);
console.log('');
for (const r of results.slice(0, 60)) {
    const p = r.portal;
    console.log(`  [${r.flags.join(',')}] (${p.level},${p.x},${p.z}) -> (${p.dest.level},${p.dest.x},${p.dest.z}) loc=${p.locId} ${p.label ?? ''}`);
}
if (results.length > 60) console.log(`  ... and ${results.length - 60} more`);

if (process.argv.includes('--write')) {
    // suspects = portals planMultiLevel must not route through: sealed entrances, broken dests, and
    // un-OPLOC-able entries. E-UNREACH alone is NOT disqualifying (a remote-but-valid ladder still
    // serves local routes — the planner verifies per-plan entrance reachability itself).
    const suspects = results
        .filter(r => r.flags.some(f => f === 'E-SEALED' || f === 'D-VOID' || f === 'D-POCKET' || f === 'NO-LOC'))
        .map(r => ({ x: r.portal.x, z: r.portal.z, level: r.portal.level, dest: r.portal.dest, flags: r.flags }));
    writeFileSync(new URL('./portal-suspects.json', import.meta.url), JSON.stringify(suspects, null, 1));
    console.log(`\nwrote ${suspects.length} suspects -> portal-suspects.json`);
}

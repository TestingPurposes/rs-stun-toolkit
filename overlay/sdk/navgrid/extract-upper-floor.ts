#!/usr/bin/env bun
// UPPER-PLANE FLOOR MAP -> upper-floor.json. Used by reach.ts only.
//
// WHY: the engine blocks a tile only when its map data says BLOCK_MAP_SQUARE (GameMap.ts:222-236); a plane-1..3 tile
// with NO map data at all ("air" around every building) is therefore walkable to rsmod, and those air tiles join into
// 1.2M-tile components that connect every upstairs room in the world. For the reachability gate that made "Draynor
// upstairs -> walk on air -> Brimhaven upstairs" a valid chain, so no island ever looked unreachable. This file lists,
// per mapsquare and ACTUAL plane (after the LINK_BELOW bridge shift, exactly as the engine applies it), the tiles that
// have map data. reach.ts treats the rest of planes 1-3 as walls. Underground "void" is NOT handled here (it has map
// data; it is just dark).
// Format: { "<mx>_<mz>_<plane>": base64(512-byte bitmap, bit (lx*64+lz)) }, planes 1..3 only.
// Run from the repo root (<rs-sdk checkout>): bun sdk/navgrid/extract-upper-floor.ts
import { readFileSync, readdirSync, writeFileSync } from 'fs';
const LINK_BELOW = 0x2;
const out: Record<string, string> = {};
let squares = 0, tiles = 0;
for (const f of readdirSync('server/content/maps')) {
    const m = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (!m) continue;
    const has = [0, 1, 2, 3].map(() => new Uint8Array(4096));
    const flags1 = new Int16Array(4096);
    let section = '';
    for (const line of readFileSync(`server/content/maps/${f}`, 'utf8').split(/\r?\n/)) {
        if (line.startsWith('====')) { section = line.replace(/=/g, '').trim(); continue; }
        if (section !== 'MAP' || !line.length) continue;
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const [lvl, lx, lz] = line.slice(0, colon).split(' ').map(Number) as number[];
        has[lvl!]![lx! * 64 + lz!] = 1;
        if (lvl === 1) for (const t of line.slice(colon + 2).split(' ')) if (t[0] === 'f') flags1[lx! * 64 + lz!] = parseInt(t.slice(1));
    }
    squares++;
    for (let plane = 1; plane <= 3; plane++) {
        const bits = new Uint8Array(512);
        let any = false;
        for (let i = 0; i < 4096; i++) {
            const bridged = (flags1[i]! & LINK_BELOW) === LINK_BELOW;
            const src = bridged ? plane + 1 : plane;   // bridged column: data at level k is actual plane k-1
            if (src <= 3 && has[src]![i]) { bits[i >> 3]! |= 1 << (i & 7); any = true; tiles++; }
        }
        if (any) out[`${m[1]}_${m[2]}_${plane}`] = Buffer.from(bits).toString('base64');
    }
}
writeFileSync('sdk/navgrid/upper-floor.json', JSON.stringify(out));
console.log(`[upper-floor] ${squares} mapsquares, ${Object.keys(out).length} square-planes with floor, ${tiles} floor tiles -> sdk/navgrid/upper-floor.json`);

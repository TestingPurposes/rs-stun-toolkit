#!/usr/bin/env bun
// GENERIC (player-relative) LADDERS -> generic-ladders.json.
//
// ⛔ THE GAP: extract-portals.mjs reads `case <coord> :` lines, so every ladder whose handler is the DEFAULT branch
// `~climb_ladder(movecoord(coord(), dx, dlevel, dz), ...)` (ladders.rs2: laddertop, ladder, laddermiddle op2/op3,
// laddertop_directional, ladder_directional, ladder_cellar, ladder_from_cellar, ladder_from_cellar_directional,
// ladder_cellar_inside_down) is INVISIBLE to the planner. The clue reach audit found these ladders next
// to 20+ unreachable targets (house upper floors, the Legends'/Witchaven-side hellhound cave, Taverley's north ladder).
// Gap 1 in learnings/navgrid-and-pathing.md, generalised.
//
// SEMANTICS (ladders.rs2:42-103, climb_ladder :154): `coord()` is the PLAYER's tile, so you land on YOUR stand tile
// shifted by (dx, dlevel, dz). So each map placement becomes one portal PER INTERACTION FACE: stand = a walkable tile
// from which the engine's reachedLoc accepts the op (shape/angle/forceapproach honoured), dest = stand + delta, kept
// only if the dest is walkable. `stand` is carried on the portal; the planner routes to that exact tile.
// Placements that a `case <coord>` / `loc_coord = <coord>` in the same handler overrides are skipped (portals.json
// already has them, with their real dests).
//
// Run from the repo root (<rs-sdk checkout>): bun sdk/navgrid/extract-generic-ladders.ts
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { initPathfinding, isTileWalkable, reachedLoc } from '../pathfinding.js';
import { locDims, locForceApproach } from './locmeta.js';

const ROOT = 'server/content';
const idByName = new Map<string, number>();
for (const line of readFileSync(`${ROOT}/pack/loc.pack`, 'utf8').split('\n')) { const m = line.match(/^(\d+)=(\S+)/); if (m) idByName.set(m[2]!, +m[1]!); }
const C = (s: string) => { const [l, mx, mz, lx, lz] = s.split('_').map(Number) as number[]; return { level: l!, x: mx! * 64 + lx!, z: mz! * 64 + lz! }; };

// 1. handlers: [oplocN,name] blocks with a DEFAULT movecoord(coord()) climb
type H = { locId: number; name: string; op: number; dx: number; dl: number; dz: number; except: Set<string> };
const handlers: H[] = [];
const walk = (d: string): string[] => readdirSync(d).flatMap(e => { const p = join(d, e); return statSync(p).isDirectory() ? (e === '_unpack' ? [] : walk(p)) : p.endsWith('.rs2') ? [p] : []; });
for (const f of walk(`${ROOT}/scripts`)) {
    const txt = readFileSync(f, 'utf8');
    if (!txt.includes('movecoord(coord()')) continue;
    const blocks = txt.split(/^(?=\[)/m);
    for (const b of blocks) {
        const hdr = /^\[oploc(\d),(\w+)\]/.exec(b);
        if (!hdr) continue;
        const locId = idByName.get(hdr[2]!);
        if (locId === undefined) continue;
        const except = new Set<string>();
        for (const m of b.matchAll(/(?:case|loc_coord =)\s*(\d+_\d+_\d+_\d+_\d+)/g)) { const c = C(m[1]!); except.add(`${c.level},${c.x},${c.z}`); }
        // the default climb: a movecoord(coord()) climb on a line that is NOT a `case <coord>` line
        // A CONDITIONAL or MENU climb is not a plain portal (grandtree_laddermiddle op1 = p_choice menu; slugladder = Sea
        // Slug quest state): skip the handler if a p_choice or a non-`loc_coord =` `if(` precedes the climb line.
        let gated = false;
        for (const line of b.split('\n')) {
            if (/p_choice|\bif\s*\(/.test(line) && !/loc_coord\s*=/.test(line)) { gated = true; continue; }
            if (/case\s+\d+_/.test(line)) continue;
            const m = /(?:climb_ladder|p_telejump)\(movecoord\(coord\(\),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\)/.exec(line);
            if (!m) continue;
            if (gated) break;
            handlers.push({ locId, name: hdr[2]!, op: +hdr[1]!, dx: +m[1]!, dl: +m[2]!, dz: +m[3]!, except });
            break;
        }
    }
}
console.log(`[generic-ladders] ${handlers.length} default-branch handlers: ${handlers.map(h => `${h.name}/op${h.op}(${h.dx},${h.dl},${h.dz})`).join(' ')}`);

// 2. placements (the LINK_BELOW bridge rule exactly as extract-portals.mjs applies it)
const LINK_BELOW = 0x2;
const byId = new Map<number, H[]>();
for (const h of handlers) { if (!byId.has(h.locId)) byId.set(h.locId, []); byId.get(h.locId)!.push(h); }
const known = new Set((JSON.parse(readFileSync('sdk/navgrid/portals.json', 'utf8')) as any[]).map(p => `${p.level},${p.x},${p.z},${p.locId}`));
initPathfinding();
const out: any[] = [];
let placements = 0, noFace = 0;
for (const f of readdirSync(`${ROOT}/maps`)) {
    const mm = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (!mm) continue;
    const bx = +mm[1]! * 64, bz = +mm[2]! * 64;
    const lines = readFileSync(`${ROOT}/maps/${f}`, 'utf8').split(/\r?\n/);
    const lvl1 = new Int16Array(64 * 64);
    let section = '';
    for (const line of lines) {
        if (line.startsWith('====')) { section = line.replace(/=/g, '').trim(); continue; }
        if (!line.length || (section !== 'MAP' && section !== 'LOC')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const [lvl, lx, lz] = line.slice(0, colon).split(' ').map(Number) as number[];
        const data = line.slice(colon + 2);
        if (section === 'MAP') { if (lvl === 1) for (const t of data.split(' ')) if (t[0] === 'f') lvl1[lx! * 64 + lz!] = parseInt(t.slice(1)); continue; }
        const parts = data.split(' ');
        const id = +parts[0]!;
        const hs = byId.get(id);
        if (!hs) continue;
        const shape = parts.length > 1 ? +parts[1]! : 10, angle = parts.length > 2 ? +parts[2]! : 0;
        const level = (lvl1[lx! * 64 + lz!]! & LINK_BELOW) === LINK_BELOW ? lvl! - 1 : lvl!;
        if (level < 0) continue;
        const x = bx + lx!, z = bz + lz!;
        for (const h of hs) {
            if (h.except.has(`${level},${x},${z}`) || known.has(`${level},${x},${z},${id}`)) continue;
            placements++;
            const { w, l } = locDims(id); const fa = locForceApproach(id); const m = Math.max(w, l);
            let faces = 0;
            for (let sx = x - 1; sx <= x + m; sx++) for (let sz = z - 1; sz <= z + m; sz++) {
                if (!isTileWalkable(level, sx, sz)) continue;
                if (!reachedLoc(level, sx, sz, x, z, w, l, angle, shape, fa)) continue;
                const dest = { level: level + h.dl, x: sx + h.dx, z: sz + h.dz };
                if (dest.level < 0 || dest.level > 3 || !isTileWalkable(dest.level, dest.x, dest.z)) continue;
                out.push({ x, z, level, dest, stand: { x: sx, z: sz }, locId: id, op: h.op, trust: 'estimate', shape, angle, label: `generic ${h.name}${h.op !== 1 ? ' op' + h.op : ''}` });
                faces++;
            }
            if (!faces) noFace++;
        }
    }
}
writeFileSync('sdk/navgrid/generic-ladders.json', JSON.stringify(out));
console.log(`[generic-ladders] ${placements} placements -> ${out.length} face-portals (${noFace} placements with no valid face) -> sdk/navgrid/generic-ladders.json`);

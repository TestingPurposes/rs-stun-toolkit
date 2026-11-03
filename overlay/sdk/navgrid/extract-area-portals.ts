#!/usr/bin/env bun
// AREA PORTALS -> area-portals.json.
//
// ⛔ THE GAP: extract-portals.mjs reads ladders+stairs/ only, and extract-generic-ladders.ts only reads the player-relative
// `movecoord(coord(), ...)` default branches. Every OTHER "op this loc -> you are somewhere else" handler lives in an AREA
// or QUEST script and was invisible to the planner: Brimstail's cave (area_gnome/scripts/brimstail_cave.rs2:1-2), Rantz's
// cave (quest_chompybird/scripts/quest_chompybird.rs2:1-11), Saba's cave (quest_death/scripts/quest_death.rs2:1-7), the
// Crandor rope (quest_dragon/scripts/crandor.rs2:7-9), ... The phase-2 clue audit found 3 medium clue npcs behind them.
//
// WHAT COUNTS (deliberately strict — a wrong edge is worse than a missing one):
//   * an [oplocN,<name>] handler (no categories: `_name` handlers are skipped) whose body makes EXACTLY ONE move call:
//     p_telejump(<abs coord>) / p_teleport(<abs coord>) / ~climb_ladder(<abs coord>, ...), the coord a literal
//     level_mx_mz_lx_lz or a ^constant from a .constant file;
//   * UNCONDITIONAL: no if / switch / while / p_choice / @label / queue / npc_find in the body. The ONE exception is the
//     members guard `if (map_members = ^false) { ...; return; }` (the realm is members), which is stripped first.
//   * skipped: ladders+stairs/ (portals.json + generic-ladders.json own those), _unpack/, _test/ (cheats), and any
//     placement the base graph (portals.json) already has on the same tile.
// Every map placement of the loc becomes one portal (trust 'exact': the dest is an absolute script coord). The approach
// side is NOT encoded: the planner reaches the loc like any ladder (findPathToLoc + reachedLoc), so a one-sided
// entrance can only be refused live, never mis-modelled as two-way (each placement is one directed edge).
//
// Run from the repo root (<rs-sdk checkout>): bun sdk/navgrid/extract-area-portals.ts
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = 'server/content';
const idByName = new Map<string, number>();
for (const line of readFileSync(`${ROOT}/pack/loc.pack`, 'utf8').split('\n')) { const m = line.match(/^(\d+)=(\S+)/); if (m) idByName.set(m[2]!, +m[1]!); }
const C = (s: string) => { const [l, mx, mz, lx, lz] = s.split('_').map(Number) as number[]; return { level: l!, x: mx! * 64 + lx!, z: mz! * 64 + lz! }; };
const walk = (d: string): string[] => readdirSync(d).flatMap(e => {
    const p = join(d, e);
    if (statSync(p).isDirectory()) return e === '_unpack' || e === '_test' || e === 'ladders+stairs' ? [] : walk(p);
    return p.endsWith('.rs2') || p.endsWith('.constant') ? [p] : [];
});
const files = walk(`${ROOT}/scripts`);
const consts = new Map<string, string>();
for (const f of files.filter(f => f.endsWith('.constant'))) for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\^(\w+)\s*=\s*(\d_\d+_\d+_\d+_\d+)\s*$/.exec(line.trim()); if (m) consts.set(m[1]!, m[2]!);
}
// THE LOC MUST HAVE THE OP IN A REV-289 CONFIG (non-_unpack .loc). A handler can outlive its loc's op: winchladder2
// (quest_itexam/area_digsite.rs2:702) has no 289 config at all (only _unpack/225), so OPLOC1 on it is silently
// discarded.  (nav206 parked: "CLIMB STALLED on loc 2353").
const opsOf = new Map<string, Set<number>>();
const walkLoc = (d: string): string[] => readdirSync(d).flatMap(e => { const p = join(d, e); return statSync(p).isDirectory() ? (e === '_unpack' ? [] : walkLoc(p)) : p.endsWith('.loc') ? [p] : []; });
for (const f of walkLoc(`${ROOT}/scripts`)) {
    let cur = '';
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const h = /^\[(\w+)\]/.exec(line); if (h) { cur = h[1]!; continue; }
        const o = /^op(\d)=/.exec(line); if (o && cur) { if (!opsOf.has(cur)) opsOf.set(cur, new Set()); opsOf.get(cur)!.add(+o[1]!); }
    }
}
let noOp = 0;
// trap/fail outcomes that happen to be written as an unconditional teleport (Underground Pass): not a way anywhere
const TRAPS = new Set(['upass_swampbubbles1', 'upass_grilltrap_hand_holds']);
type H = { locId: number; name: string; op: number; dest: { level: number; x: number; z: number }; src: string };
const handlers: H[] = [];
const MOVE = /(?:p_telejump|p_teleport|~climb_ladder)\(\s*(\d_\d+_\d+_\d+_\d+|\^\w+)\s*[,)]/g;
let rejected = 0;
for (const f of files.filter(f => f.endsWith('.rs2'))) {
    const txt = readFileSync(f, 'utf8');
    if (!/p_telejump|p_teleport|climb_ladder/.test(txt)) continue;
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const hdr = /^\[oploc(\d),(\w+)\]\s*(.*)$/.exec(lines[i]!);
        if (!hdr || hdr[2]!.startsWith('_') || TRAPS.has(hdr[2]!)) continue;
        if (hdr[3] && hdr[3].trim().startsWith('@')) continue;   // `[oploc1,x] @label;` — a shared label, not a plain body
        let j = i + 1; const body: string[] = [];
        while (j < lines.length && !lines[j]!.startsWith('[')) body.push(lines[j++]!);
        let b = body.map(l => l.replace(/\/\/.*$/, '')).join('\n');
        b = b.replace(/if\s*\(\s*map_members\s*=\s*\^false\s*\)\s*\{[^{}]*?return;\s*\}/g, '');   // members guard
        const moves = [...b.matchAll(MOVE)];
        if (moves.length !== 1) continue;
        if (/\b(if|switch_\w+|while)\s*\(|p_choice|@\w+|queue\(|npc_find|movecoord/.test(b)) { rejected++; continue; }
        const raw = moves[0]![1]!;
        const lit = raw.startsWith('^') ? consts.get(raw.slice(1)) : raw;
        const locId = idByName.get(hdr[2]!);
        if (!lit || locId === undefined) continue;
        if (!opsOf.get(hdr[2]!)?.has(+hdr[1]!)) { noOp++; continue; }
        handlers.push({ locId, name: hdr[2]!, op: +hdr[1]!, dest: C(lit), src: `${f.replace(/\\/g, '/').replace(`${ROOT}/scripts/`, '')}:${i + 1}` });
    }
}
const byId = new Map<number, H[]>();
for (const h of handlers) { if (!byId.has(h.locId)) byId.set(h.locId, []); byId.get(h.locId)!.push(h); }
// tiles the base graph or the hand-cited transports already model keep theirs
const known = new Set([...JSON.parse(readFileSync('sdk/navgrid/portals.json', 'utf8')), ...JSON.parse(readFileSync('sdk/navgrid/transports.json', 'utf8'))].map((p: any) => `${p.level},${p.x},${p.z}`));
const LINK_BELOW = 0x2;
const out: any[] = [];
for (const f of readdirSync(`${ROOT}/maps`)) {
    const mm = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (!mm) continue;
    const bx = +mm[1]! * 64, bz = +mm[2]! * 64;
    const lvl1 = new Int16Array(64 * 64);
    let section = '';
    for (const line of readFileSync(`${ROOT}/maps/${f}`, 'utf8').split(/\r?\n/)) {
        if (line.startsWith('====')) { section = line.replace(/=/g, '').trim(); continue; }
        if (!line.length || (section !== 'MAP' && section !== 'LOC')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const [lvl, lx, lz] = line.slice(0, colon).split(' ').map(Number) as number[];
        const data = line.slice(colon + 2);
        if (section === 'MAP') { if (lvl === 1) for (const t of data.split(' ')) if (t[0] === 'f') lvl1[lx! * 64 + lz!] = parseInt(t.slice(1)); continue; }
        const parts = data.split(' ');
        const hs = byId.get(+parts[0]!);
        if (!hs) continue;
        const shape = parts.length > 1 ? +parts[1]! : 10, angle = parts.length > 2 ? +parts[2]! : 0;
        const level = (lvl1[lx! * 64 + lz!]! & LINK_BELOW) === LINK_BELOW ? lvl! - 1 : lvl!;
        if (level < 0) continue;
        const x = bx + lx!, z = bz + lz!;
        if (known.has(`${level},${x},${z}`)) continue;
        for (const h of hs) out.push({ x, z, level, dest: h.dest, locId: h.locId, op: h.op, trust: 'exact', shape, angle, label: `area ${h.name}${h.op !== 1 ? ' op' + h.op : ''}`, cite: h.src });
    }
}
out.sort((a, b) => a.label.localeCompare(b.label) || a.x - b.x || a.z - b.z);
writeFileSync('sdk/navgrid/area-portals.json', JSON.stringify(out, null, 0).replace(/\},\{"x"/g, '},\n{"x"'));
console.log(`[area-portals] ${handlers.length} unconditional handlers (${rejected} conditional, ${noOp} without a rev-289 op skipped) -> ${out.length} placements -> sdk/navgrid/area-portals.json`);

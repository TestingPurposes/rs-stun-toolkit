// Auto-extracts the ladder/stairs portal graph -> portals.json, WITH the loc id + op to OPLOC.
import { readFileSync, readdirSync, writeFileSync } from 'fs';
const dir = 'server/content/scripts/ladders+stairs/scripts';
// loc name -> id (loc.sym: "id\tname")
const locId = new Map();
// rev289: server/engine/data/symbols/loc.sym is STALE upstream (still the 274 file, while 289 renamed many
// locs to loc_N), so resolve names from the content pack ("id=name"), the authoritative 289 mapping.
for (const line of readFileSync('server/content/pack/loc.pack', 'utf8').split('\n')) { const m = line.match(/^(\d+)=(\S+)/); if (m) locId.set(m[2], Number(m[1])); }
const C = s => { const [l, mx, mz, lx, lz] = s.split('_').map(Number); return { level: l, x: mx * 64 + lx, z: mz * 64 + lz }; };
const portals = [];
const add = (src, d, loc, op, label) => { if (src && d && d.dest && Number.isFinite(d.dest.x)) portals.push({ x: src.x, z: src.z, level: src.level, dest: d.dest, locId: loc ?? null, op: op ?? 1, trust: d.trust, label }); };
// trust: 'exact' = absolute coord straight from the script (rotation-independent, faithful);
//        'estimate' = movecoord relative to `coord` — the PLAYER's approach tile at runtime, NOT the
//        loc origin the extractor uses as base, so the dest can be off by the approach offset (1-3
//        tiles). Estimates stay in the graph (the level-gated follower tolerates small dest error and
//        re-paths from its REAL landing) but the planner prefers exact portals and the live sweep
//        (validate/probe) should replace estimates with probed truth.
const destFrom = (src, rest) => {
    let m;
    if ((m = /p_telejump\(movecoord\(coord\(?\)?,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/.exec(rest))) return { dest: { level: src.level + +m[2], x: src.x + +m[1], z: src.z + +m[3] }, trust: 'estimate' };
    if ((m = /p_telejump\((\d+_\d+_\d+_\d+_\d+)/.exec(rest))) return { dest: C(m[1]), trust: 'exact' };
    if ((m = /p_teleport\((\d+_\d+_\d+_\d+_\d+)/.exec(rest))) return { dest: C(m[1]), trust: 'exact' };
    if ((m = /climb_ladder\((\d+_\d+_\d+_\d+_\d+)/.exec(rest))) return { dest: C(m[1]), trust: 'exact' };
    if ((m = /climb_ladder\(movecoord\(coord\(?\)?,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/.exec(rest))) return { dest: { level: src.level + +m[2], x: src.x + +m[1], z: src.z + +m[3] }, trust: 'estimate' };
    return null;
};
for (const f of readdirSync(dir)) {
    if (!f.endsWith('.rs2')) continue;
    const txt = readFileSync(`${dir}/${f}`, 'utf8');
    // track the current [oplocN,locname] block so each case knows its loc id + op
    let curLoc = null, curOp = 1;
    for (const line of txt.split('\n')) {
        const hdr = /^\[oploc(\d),(\w+)\]/.exec(line);
        if (hdr) { curOp = +hdr[1]; curLoc = locId.get(hdr[2]) ?? null; continue; }
        // a "case SRC :" or "if ($coord = SRC)" within the current block
        const sm = /(?:case|\$coord =)\s*(\d+_\d+_\d+_\d+_\d+)/.exec(line);
        if (!sm) continue;
        const src = C(sm[1]); const rest = txt.slice(txt.indexOf(line), txt.indexOf(line) + 240);
        // stair_options(up, down) is the "Climb up or down" MENU op (op1). The bot should use the
        // DIRECT climb ops instead: op2 = Climb-up, op3 = Climb-down (verified in stairs.rs2 —
        // [oploc2,loc_1739] telejumps up, [oploc3,loc_1739] telejumps down). Emitting the down as op2
        // (its stair_options arg index) sent the bot UP to L2 instead of down (live-caught: the RM
        // Duke->Sedridor L1->L0 climb stalled). op2->up, op3->down.
        const om = /(?:stair|ladder)_options\((\d+_\d+_\d+_\d+_\d+),\s*(\d+_\d+_\d+_\d+_\d+)/.exec(rest);
        if (om) { add(src, { dest: C(om[1]), trust: 'exact' }, curLoc, 2, f + '-up'); add(src, { dest: C(om[2]), trust: 'exact' }, curLoc, 3, f + '-down'); continue; }
        add(src, destFrom(src, rest), curLoc, curOp, f);
    }
}
const seen = new Set(); const uniq = portals.filter(p => { const k = `${p.level},${p.x},${p.z}->${p.dest.level},${p.dest.x},${p.dest.z}`; if (seen.has(k)) return false; seen.add(k); return true; });

// Attach each portal's PLACEMENT geometry (shape+angle) from the jm2 maps — the planner routes to a
// portal like the ENGINE routes an op (findPathToLoc: footprint+angle+shape), so the leg ends on an
// INTERACTION-VALID tile. Proximity is not interaction validity (the Lumbridge staircase's west tile
// is walkable but walled off from the loc — OPLOC never fires there; live-caught).
const LINK_BELOW = 0x2;
const placement = new Map();   // "level,x,z" -> {shape, angle} (first matching loc placement wins)
for (const f of readdirSync('server/content/maps')) {
    const m = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (!m) continue;
    const baseX = +m[1] * 64, baseZ = +m[2] * 64;
    const lines = readFileSync(`server/content/maps/${f}`, 'utf8').split(/\r?\n/);
    const lvl1 = new Int16Array(64 * 64);
    let section = null;
    for (const line of lines) {
        if (line.startsWith('====')) { section = line.replace(/=/g, '').trim(); continue; }
        if (!line.length || (section !== 'MAP' && section !== 'LOC')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const [lvl, lx, lz] = line.slice(0, colon).split(' ').map(Number);
        const data = line.slice(colon + 2);
        if (section === 'MAP') { if (lvl === 1) for (const t of data.split(' ')) if (t[0] === 'f') lvl1[lx * 64 + lz] = parseInt(t.slice(1)); continue; }
        const parts = data.split(' ');
        const locid = +parts[0], shape = parts.length > 1 ? +parts[1] : 10, angle = parts.length > 2 ? +parts[2] : 0;
        const bridged = (lvl1[lx * 64 + lz] & LINK_BELOW) === LINK_BELOW;
        const level = bridged ? lvl - 1 : lvl;
        if (level < 0) continue;
        placement.set(`${level},${baseX + lx},${baseZ + lz},${locid}`, { shape, angle });
    }
}
let placed = 0;
for (const p of uniq) {
    const g = p.locId != null ? placement.get(`${p.level},${p.x},${p.z},${p.locId}`) : null;
    if (g) { p.shape = g.shape; p.angle = g.angle; placed++; }
}
console.log(`placement geometry attached to ${placed}/${uniq.length} portals`);

// TRAPDOOR/MANHOLE portals — a TWO-STAGE class the script scan can't see: the handler is GENERIC
// (general_use/trapdoors.rs2 + manholes.rs2, no coord cases) — op1 on the CLOSED loc opens it
// (loc_change to the open variant), op1 on the OPEN loc telejumps coord()+6400 (player-relative).
// So each is derived from its MAP PLACEMENT: dest = (x, z+6400) as an 'estimate' (landing = the
// player's stand tile, ≤1 off), with altLocId = the open variant the follower must OPLOC second.
const TWO_STAGE = [{ closed: 1568, open: 1570, label: 'trapdoor' }, { closed: 881, open: 882, label: 'manhole' }];
let twoStage = 0;
for (const [key, g] of placement) {
    const [lvl, x, z, locid] = key.split(',').map(Number);
    if (lvl !== 0 || z >= 6400) continue;   // surface, down-only
    const fam = TWO_STAGE.find(f => f.closed === locid);
    if (!fam) continue;
    uniq.push({ x, z, level: 0, dest: { level: 0, x, z: z + 6400 }, locId: fam.closed, altLocId: fam.open, op: 1, trust: 'estimate', shape: g.shape, angle: g.angle, label: fam.label });
    twoStage++;
}
console.log(`two-stage trapdoor/manhole portals added: ${twoStage}`);

// DROP loc-less portals. A portal with no loc id CANNOT be operated (the follower OPLOCs p.locId; a
// null id targets loc 0 = a no-op the server ignores) — it is dead weight the planner can still PICK by
// dest proximity, then the bot reaches the "entrance" and stalls with nothing to OPLOC. These come from
// stairs.rs2 coord cases whose loc is not PLACED on the map (unused/obscure content — e.g. mapsquare
// 34_77, entrance-unreachable). The offline validator flagged exactly these as NO-LOC; filtering them at
// the source is the general fix (also prevents any future loc-less case from re-entering the graph).
// MANUAL portals (hand-verified on a live engine) that the script patterns above cannot see, e.g. a quest-house ladder
// handled by a generic script with no literal coord. Kept in manual-portals.json so every regen keeps them.
try {
    const manual = JSON.parse(readFileSync('sdk/navgrid/manual-portals.json', 'utf8'));
    for (const m of manual) if (!uniq.some(p => p.level === m.level && p.x === m.x && p.z === m.z && p.dest.level === m.dest.level)) uniq.push(m);
    console.log(`manual portals merged: ${manual.length}`);
} catch { /* no manual file */ }
const usable = uniq.filter(p => p.locId != null);
const dropped = uniq.length - usable.length;
console.log(`dropped ${dropped} loc-less (un-OPLOC-able) portals`);
writeFileSync('sdk/navgrid/portals.json', JSON.stringify(usable));
console.log(`extracted ${usable.length} portals, all with a loc id. samples:`);
for (const p of [usable.find(x=>x.x===3104&&x.z===3162), usable.find(x=>x.x===3204&&x.z===3207)].filter(Boolean)) console.log(`  (${p.level},${p.x},${p.z}) loc=${p.locId} op=${p.op} -> (${p.dest.level},${p.dest.x},${p.dest.z})`);

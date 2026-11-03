// SCRIPTED-DOOR EXTRACTOR — derives which "openable" locs can ACTUALLY be opened. A loc with op
// "Open" but NO oploc handler (direct [oplocN,<debugname>] or via its config category, e.g.
// [oploc1,_door_closed]) is a DECOY: OPLOC does nothing live, ever (loc 1530 inaccastledoubledoorropen
// — the Lumbridge castle's dead leaves — is the proven case). The engine-side collision export unmasks
// ALL open-op wall locs, so offline routes legally cross edges that never open live: the RM bot walked
// the castle's whole perimeter fighting these edges one by one.
// Outputs:
//   scripted-door-ids.json  — loc ids whose Open op has a real handler (the OPLOC-able set)
//   unopenable-doors.json   — map placements of WALL-layer open-op locs WITHOUT a handler (re-block set)
// Rebuild: node sdk/navgrid/extract-scripted-doors.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../server/content');
const LINK_BELOW = 0x2;
const WALL_SHAPES = new Set([0, 1, 2, 3, 9]);   // wall-layer + diagonal: the shapes that gate movement

// id -> debugname
const nameById = new Map();
for (const line of readFileSync(join(ROOT, 'pack/loc.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) nameById.set(Number(m[1]), m[2]);
}
// debugname -> { ops[], category }
const defs = new Map();
const handlers = new Set();   // names with [oplocN,name] handlers (includes _category names)
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (e.endsWith('.loc')) {
            let cur = null;
            for (const line of readFileSync(p, 'utf8').split('\n')) {
                const b = line.match(/^\[(\S+)\]/);
                if (b) { cur = { ops: [], category: null }; defs.set(b[1], cur); continue; }
                if (!cur) continue;
                const om = line.match(/^op(\d)=(.+)/); if (om) cur.ops[Number(om[1]) - 1] = om[2].trim();
                const cm = line.match(/^category=(\S+)/); if (cm) cur.category = cm[1];
            }
        } else if (e.endsWith('.rs2')) {
            for (const m of readFileSync(p, 'utf8').matchAll(/^\[oploc\d,(\S+)\]/gm)) handlers.add(m[1]);
        }
    }
})(join(ROOT, 'scripts'));

const openable = (name) => {
    const d = defs.get(name);
    if (!d) return false;
    if (handlers.has(name)) return true;
    return d.category !== null && handlers.has('_' + d.category);
};

const scriptedIds = [];
const deadIds = new Set();
for (const [id, name] of nameById) {
    const d = defs.get(name);
    if (!d || !d.ops.some(o => o && /open/i.test(o))) continue;
    if (openable(name)) scriptedIds.push(id);
    else deadIds.add(id);
}

// map scan: WALL-layer placements of dead open-op locs
const out = [];
const mapsDir = join(ROOT, 'maps');
for (const f of readdirSync(mapsDir)) {
    const m = f.match(/^m(\d+)_(\d+)\.jm2$/);
    if (!m) continue;
    const baseX = Number(m[1]) * 64, baseZ = Number(m[2]) * 64;
    const lines = readFileSync(join(mapsDir, f), 'utf8').split(/\r?\n/);
    const level1Flags = new Int16Array(64 * 64);
    const locs = [];
    let section = null;
    for (const line of lines) {
        if (line.startsWith('====')) { section = line.replace(/=/g, '').trim(); continue; }
        if (!line.length || (section !== 'MAP' && section !== 'LOC')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const [lvl, lx, lz] = line.slice(0, colon).split(' ').map(Number);
        const data = line.slice(colon + 2);
        if (section === 'MAP') { if (lvl === 1) for (const t of data.split(' ')) if (t[0] === 'f') level1Flags[lx * 64 + lz] = parseInt(t.slice(1)); continue; }
        const parts = data.split(' ');
        locs.push({ level: lvl, lx, lz, locId: Number(parts[0]), shape: parts.length > 1 ? Number(parts[1]) : 10, angle: parts.length > 2 ? Number(parts[2]) : 0 });
    }
    for (const loc of locs) {
        if (!deadIds.has(loc.locId) || !WALL_SHAPES.has(loc.shape)) continue;
        const bridged = (level1Flags[loc.lx * 64 + loc.lz] & LINK_BELOW) === LINK_BELOW;
        const level = bridged ? loc.level - 1 : loc.level;
        if (level < 0) continue;
        out.push({ level, x: baseX + loc.lx, z: baseZ + loc.lz, locId: loc.locId, shape: loc.shape, angle: loc.angle });
    }
}
out.sort((a, b) => a.x - b.x || a.z - b.z || a.level - b.level);
writeFileSync(new URL('./scripted-door-ids.json', import.meta.url), JSON.stringify(scriptedIds.sort((a, b) => a - b)));
writeFileSync(new URL('./unopenable-doors.json', import.meta.url), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
console.log(`scripted (OPLOC-able) door ids: ${scriptedIds.length}; dead open-op ids: ${deadIds.size}; dead WALL placements: ${out.length}`);
console.log('castle leaf (3208,3211) in dead set:', out.some(d => d.x === 3208 && d.z === 3211));
console.log('wizard door 1536 scripted:', scriptedIds.includes(1536), '| dead ids sample:', [...deadIds].slice(0, 10).join(','));

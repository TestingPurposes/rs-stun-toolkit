// DIAGONAL-DOOR EXTRACTOR — offline derivation of the shape-9 (WALL_DIAGONAL) openable doors that
// collision-data.json OMITS (its engine-side generator keeps only LocLayer.WALL doors, api.ts:216).
// A diagonal door blocks its WHOLE tile via the LOC layer (engine: GameMap.changeLocCollision ->
// rsmod.changeLoc, flags 0x100|0x20000), so pathfinding must mask it with changeLoc, not changeWall —
// and without masking, everything behind one is unreachable (the wizard-tower ladder class).
//
// Sources (same as dump-doors.ts): maps/m*.jm2 LOC sections (level lx lz: locId shape [angle]) with the
// LINK_BELOW bridge adjust, pack/loc.pack (id=debugname), scripts/**/*.loc (op1..op5).
// A door = a shape-9 placement whose loc def has an op matching /open/i.
// Output: sdk/navgrid/diagonal-doors.json  [{level,x,z,locId,op,angle,name}]
// Rebuild: node sdk/navgrid/extract-diagonal-doors.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../server/content');
const LINK_BELOW = 0x2;

// id -> debugname
const nameById = new Map();
for (const line of readFileSync(join(ROOT, 'pack/loc.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) nameById.set(Number(m[1]), m[2]);
}
// debugname -> { name, ops[] }
const defs = new Map();
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!e.endsWith('.loc')) continue;
        let cur = null;
        for (const line of readFileSync(p, 'utf8').split('\n')) {
            const b = line.match(/^\[(\S+)\]/);
            if (b) { cur = { name: '', ops: [] }; defs.set(b[1], cur); continue; }
            if (!cur) continue;
            const nm = line.match(/^name=(.+)/); if (nm) cur.name = nm[1].trim();
            const om = line.match(/^op(\d)=(.+)/); if (om) cur.ops[Number(om[1]) - 1] = om[2].trim();
        }
    }
})(join(ROOT, 'scripts'));

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
        if (section === 'MAP') {
            if (lvl !== 1) continue;
            for (const tok of data.split(' ')) if (tok[0] === 'f') level1Flags[lx * 64 + lz] = parseInt(tok.slice(1));
        } else {
            const parts = data.split(' ');
            locs.push({ level: lvl, lx, lz, locId: Number(parts[0]), shape: parts.length > 1 ? Number(parts[1]) : 10, angle: parts.length > 2 ? Number(parts[2]) : 0 });
        }
    }
    for (const loc of locs) {
        if (loc.shape !== 9) continue;
        const bridged = (level1Flags[loc.lx * 64 + loc.lz] & LINK_BELOW) === LINK_BELOW;
        const level = bridged ? loc.level - 1 : loc.level;
        if (level < 0) continue;
        const def = defs.get(nameById.get(loc.locId));
        if (!def) continue;
        const opIdx = def.ops.findIndex(o => o && /open/i.test(o));
        if (opIdx < 0) continue;
        const x = baseX + loc.lx, z = baseZ + loc.lz;
        // DOOR SWING: opening loc_dels the closed door and loc_adds the OPEN LEAF (another full-tile
        // diagonal blocker) at the adjacent tile given by ~door_open(angle, wall_diagonal)
        // (door_procs.rs2): west(0)->(0,+1), north(1)->(+1,0), east(2)->(0,-1), south(3)->(-1,0).
        // The offline model must block the LEAF tile (open-state parity) or routes thread the tile the
        // open door occupies (the wizard-tower corridor trap).
        const LEAF = [[0, 1], [1, 0], [0, -1], [-1, 0]][loc.angle & 3];
        out.push({ level, x, z, locId: loc.locId, op: opIdx + 1, angle: loc.angle, leaf: { x: x + LEAF[0], z: z + LEAF[1] }, name: def.name });
    }
}
out.sort((a, b) => a.x - b.x || a.z - b.z || a.level - b.level);
writeFileSync(new URL('./diagonal-doors.json', import.meta.url), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
console.log(`extracted ${out.length} diagonal openable doors -> diagonal-doors.json`);
const wiz = out.find(d => d.x === 3107 && d.z === 3162);
console.log('wizard-tower door present:', wiz ? JSON.stringify(wiz) : 'MISSING!');

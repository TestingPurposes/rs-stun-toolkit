// cd server/webclient/headless/sim && bun test climb-reposition-side.test.ts
//
// CLIMB REPOSITION onto a MULTI-TILE loc: the x5 dwarf coal miner acct4 sat for hours at (3058,9778),
// DIAGONAL to the Dwarven Mine stairs 1734 (3x2 footprint at 3059,9776, angle 1). The offline reach model called the corner
// valid, the engine refused the op, and the reposition walked "onto (3059,9776)" — the occupied origin — so it never moved.
// LeanBot.sideApproachTile picks the nearest walkable, reach-valid SIDE tile instead.
import { test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LeanBot } from '../leanbot.js';

const ROOT = join(import.meta.dir, '..', '..', '..', '..');
test('dwarf mine stairs 1734: from the diagonal (3058,9778) the reposition target is a side tile, never the loc origin', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'sdk', 'navgrid', 'portals.json'), 'utf8'));
    const all: any[] = Array.isArray(raw) ? raw : (raw.portals ?? Object.values(raw));
    const p = all.find(x => x.locId === 1734 && x.x === 3059 && x.z === 9776);
    expect(p).toBeDefined();
    const b = new LeanBot() as any;
    const t = b.sideApproachTile({ ...p, dims: p.dims ?? { w: 2, l: 3 } }, { x: 3058, z: 9778 });
    expect(t).not.toBeNull();
    // west face, side-adjacent (the tile acct16 climbs from is (3058,9776))
    expect(t.x === 3058 && (t.z === 9776 || t.z === 9777) || t.z === 9778 && t.x >= 3059 && t.x <= 3061 || t.z === 9775).toBe(true);
    expect(t.x === 3059 && t.z === 9776).toBe(false);
    expect(b.sideApproachTile({ x: 1, z: 1 }, { x: 0, z: 0 })).toBeNull();   // no dims -> old behaviour
    // each stalled stand is marked tried: successive climbs rotate through the faces and reach the live-proven WEST face
    let me = { x: 3058, z: 9778 }; const seen: string[] = [];
    for (let k = 0; k < 6 && !(me.x === 3058 && me.z <= 9777); k++) { const n = b.sideApproachTile({ ...p, dims: p.dims ?? { w: 2, l: 3 } }, me); expect(n).not.toBeNull(); seen.push(`${n.x},${n.z}`); me = n; }
    expect(me.x === 3058 && me.z <= 9777).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);   // never the same stand twice
}, 120_000);

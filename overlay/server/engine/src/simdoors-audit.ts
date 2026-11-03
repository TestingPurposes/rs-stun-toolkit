// tool: for every wandering npc, the tiles its wander box lets it reach with the CURRENT door states
// (run with SIM_DOORS=closed and SIM_DOORS=open, then diff: tiles only reachable with doors open = it can get trapped there).
// Usage (server/engine): SIM_DOORS=closed bun src/simdoors-audit.ts out.json
import '#/simseed.js';
import { writeFileSync } from 'fs';
import NpcType from '#/cache/config/NpcType.js';
import World from '#/engine/World.js';
import { canTravel } from '#/engine/GameMap.js';
import { CollisionFlag } from '#/engine/routefinder/index.js';

await World.start(false, false);
const out: Record<string, { name: string; r: number; tiles: string[] }> = {};
let n = 0;
for (const npc of World.npcs as Iterable<any>) {
    if (!npc) continue;
    const t = NpcType.get(npc.type); const r = t.wanderrange;
    if (r <= 0) continue;
    const coll = npc.getCollisionStrategy(); if (coll === null) continue;
    const sx = npc.startX, sz = npc.startZ, lv = npc.level;
    const seen = new Set<string>([`${sx},${sz}`]); const q: Array<[number, number]> = [[sx, sz]];
    while (q.length) {
        const [x, z] = q.shift()!;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dz) continue;
            const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
            if (seen.has(k) || Math.abs(nx - sx) > r || Math.abs(nz - sz) > r) continue;
            if (!canTravel(lv, x, z, dx, dz, npc.width, CollisionFlag.OPEN, coll)) continue;
            seen.add(k); q.push([nx, nz]);
        }
    }
    out[`${npc.type}@${sx},${sz},${lv}`] = { name: t.name ?? t.debugname ?? String(npc.type), r, tiles: [...seen].sort() };
    n++;
}
writeFileSync(process.argv[2]!, JSON.stringify(out));
console.log(`[audit] SIM_DOORS=${process.env.SIM_DOORS ?? 'default'}: ${n} wandering npcs -> ${process.argv[2]}`);
process.exit(0);

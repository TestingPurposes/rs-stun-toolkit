// Compare the navgrid router against the shortest-path routing the bots use today.
//   bun sdk/navgrid/compare.ts
import { planRoute, toVias, clearanceAt, init, type Route } from './index.js';

// Endpoints verified standable. Note (3212,3428) LOOKS like Varrock square but is
// an enclosed tile you cannot enter -- exactly the kind of coord that silently
// broke routes before.
const ROUTES: Array<[string, number, number, number, number]> = [
    ['Lumbridge -> Varrock',      3222, 3218, 3210, 3424],
    ['Lumbridge -> Draynor bank', 3222, 3218, 3092, 3243],
    ['Varrock -> Falador',        3210, 3424, 2965, 3379],
    ['Lumbridge -> Ardougne mkt', 3222, 3218, 2655, 3283],
];

init();

// What the old stack effectively does: shortest path, blind to surface and walls.
const SHORTEST = { roadPreference: 0, clearanceWeight: 0, doorCost: 0 };

/** Tiles sitting directly against a wall - where drift traps a bot. */
function hugging(r: Route): number {
    return r.waypoints.filter(w => clearanceAt(w.x, w.z) <= 1).length;
}

function report(label: string, r: Route | null) {
    if (!r) {
        console.log(`  ${label.padEnd(9)} UNREACHABLE`);
        return;
    }
    const hug = hugging(r);
    console.log(
        `  ${label.padEnd(9)} ${String(r.tiles).padStart(4)} tiles | ` +
        `on-road ${r.onRoadPct.toFixed(0).padStart(3)}% | ` +
        `longest off-road ${String(r.longestOffRoad).padStart(3)} | ` +
        `wall-hugging ${String(hug).padStart(3)} (${((hug / r.tiles) * 100).toFixed(0).padStart(2)}%) | ` +
        `doors ${String(r.doors.length).padStart(2)} | ${String(r.ms).padStart(4)}ms`
    );
}

for (const [name, sx, sz, dx, dz] of ROUTES) {
    console.log(`\n${name}  (${sx},${sz}) -> (${dx},${dz})`);
    const before = planRoute(sx, sz, dx, dz, SHORTEST);
    const after = planRoute(sx, sz, dx, dz);

    report('shortest', before);
    report('navgrid', after);
    if (after) console.log(`  ${''.padEnd(9)} navgrid thins to ${toVias(after).length} vias`);
}

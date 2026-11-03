// LOC METADATA (offline, from the content configs) — footprint sizes for portal locs. A loc's op
// coord is its ORIGIN tile; big locs (2x2+ staircases) bury the origin inside their own collision, so
// both the PLANNER's arrival tolerance (levels.ts routeWithin) and any approachability validation must
// be judged against the FOOTPRINT edge: arrive = max(width,length), 1x1 ladders get strict adjacency
// (which is what catches walled-off ladders — the wizard-tower class — instead of accepting a tile 2
// away THROUGH the wall).
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

let SIZES: Map<number, number> | null = null;
let DIMS: Map<number, { w: number; l: number }> | null = null;
let FORCE: Map<number, number> | null = null;

/** The loc's FORCEAPPROACH byte exactly as the pack compiler encodes it (engine tools/pack/config/LocConfig.ts:149-165:
 *  0b1111 minus the allowed side: north 1, east 2, south 4, west 8); 0 = any side. Pass it to reachedLoc/findPathToLoc —
 *   the planner chose the EAST face of Burthorpe castle's stairs top (forceapproach=north) and every
 *  OPLOC was silently discarded. */
export function locForceApproach(locId: number | undefined): number {
    if (locId === undefined) return 0;
    if (!FORCE) { if (!SIZES) SIZES = load(); }
    return FORCE!.get(locId) ?? 0;
}

export function locSize(locId: number | undefined): number {
    if (locId === undefined) return 1;
    if (!SIZES) SIZES = load();
    return SIZES.get(locId) ?? 1;
}

/** Unrotated width/length from the configs (1x1 default). Rotate by placement angle at the call site. */
export function locDims(locId: number | undefined): { w: number; l: number } {
    if (locId === undefined) return { w: 1, l: 1 };
    if (!DIMS) { if (!SIZES) SIZES = load(); }
    return DIMS!.get(locId) ?? { w: 1, l: 1 };
}

function load(): Map<number, number> {
    const root = fileURLToPath(new URL('../../server/content', import.meta.url));
    const idByName = new Map<string, number>();
    for (const line of readFileSync(join(root, 'pack/loc.pack'), 'utf8').split('\n')) {
        const m = line.match(/^(\d+)=(\S+)/);
        if (m) idByName.set(m[2]!, Number(m[1]!));
    }
    const sizes = new Map<number, number>();
    DIMS = new Map();
    const dims = DIMS;
    FORCE = new Map();
    const force = FORCE;
    const SIDE: Record<string, number> = { north: 0b0001, east: 0b0010, south: 0b0100, west: 0b1000 };
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            const p = join(dir, e);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!e.endsWith('.loc')) continue;
            let cur = -1, w = 1, l = 1, fa = 0;
            const flush = () => { if (cur >= 0 && fa) force.set(cur, fa); if (cur >= 0 && Math.max(w, l) > 1) { sizes.set(cur, Math.max(w, l)); dims.set(cur, { w, l }); } };
            for (const line of readFileSync(p, 'utf8').split('\n')) {
                const b = line.match(/^\[(\S+)\]/);
                if (b) { flush(); cur = idByName.get(b[1]!) ?? -1; w = 1; l = 1; fa = 0; continue; }
                const fm = line.match(/^forceapproach=(\w+)/); if (fm && SIDE[fm[1]!]) fa = 0b1111 & ~SIDE[fm[1]!]!;
                const wm = line.match(/^width=(\d+)/); if (wm) w = Number(wm[1]!);
                const lm = line.match(/^length=(\d+)/); if (lm) l = Number(lm[1]!);
            }
            flush();
        }
    };
    walk(join(root, 'scripts'));
    return sizes;
}

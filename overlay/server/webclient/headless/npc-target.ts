// =====================================================================================================
// NPC TARGET RESOLUTION — turn a NAME into the set of type ids a brain fights, and VERIFY it.
// =====================================================================================================
//
// ⛔ THE THING THIS REPLACES. Brains carried hardcoded numeric type-sets:
//     leanbot.ts   COMBAT_TYPES = new Set([41, 47, 100, 81])
//     a knight brain KNIGHT_TYPES = new Set([23, 26])
//     hero.ts      MOSSGIANT = 112, COW = 81
//     trainbot.ts  CampSpec.npcTypes: [18]
// A magic number cannot be checked against anything. `[23, 26]` was HALF DEAD WEIGHT the whole time —
// npc 26 (`knight_of_ardougne2`) is placed **ZERO** times in the world, and all five Ardougne knights
// are id 23, four of them in a single camp at (2661,3307). Nobody could have known that by reading the
// constant, and nothing would have told them if id 23 had been the dead one instead.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ WHY THIS IS NOT JUST `npcSpawnTypeIds(name)` INLINE
// -----------------------------------------------------------------------------------------------------
// A name query is not automatically right, and three specific ways it goes wrong are already known:
//   * `Guard` resolves to **23 DISTINCT IDS** — a brain that fights "Guard" fights twenty-three
//     different npcs across the map, at different levels, some of which will kill it;
//   * the hill giant's display name is `Giant`, not "Hill giant" — a `/hill giant/i` query matches
//     NOTHING and the brain silently finds no targets, which looks exactly like an empty camp;
//   * a type can resolve and still be PLACED ZERO TIMES (npc 26), so a non-empty id list is not
//     evidence that anything exists to fight.
// So resolution is paired with a placement census and returns a verdict a caller must look at. The
// resolution happens ONCE, at assignment — never per tick.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ ATTACKABILITY IS `options.includes('Attack')`, NEVER A COMBAT LEVEL
// -----------------------------------------------------------------------------------------------------
// An npc with `vislevel=hide` reads combatLevel 0 — so a `combatLevel > 0` filter drops real, hittable
// targets and keeps unhittable scenery. The op list is the only honest test, and npc-scene exposes it.
import * as npcScene from './npc-scene.js';
import type { NpcSpawn, SpawnCluster } from './npc-scene.js';

export interface TargetType {
    id: number;
    name: string;
    combatLevel: number;
    /** placements in the WHOLE world. 0 = this id exists in the config and nowhere on the map. */
    placed: number;
    /** does the type advertise an `Attack` op? The only honest attackability test. */
    attackable: boolean;
    /** how far it will chase / how far it strays — the leash, and a camp's useful standing radius. */
    wanderRange: number;
    maxRange: number;
}

export interface TargetResolution {
    /** what was asked for. */
    pattern: string;
    /** every matching type, placement-verified. */
    types: TargetType[];
    /** ⭐ THE SET A BRAIN FIGHTS: attackable AND actually placed. This is what `combatTypes` becomes. */
    ids: Set<number>;
    /** total placements across `ids`. 0 means there is nothing in the world to fight. */
    placed: number;
    /** types that matched the name but are placed ZERO times — the `[23, 26]` half of the set. */
    unplaced: TargetType[];
    /** types that matched but advertise no `Attack` op. */
    unattackable: TargetType[];
    /** true only when the resolution produced something fightable. */
    ok: boolean;
    /** one greppable line. Never empty — a failed resolution must be as loud as a successful one. */
    note: string;
}

/**
 * Resolve a target NAME to the ids a brain should fight, verified against actual placements.
 *
 * ⛔ OFFLINE / ASSIGNMENT-TIME. `npcSpawnTypeIds` is memoised (0.77us on a hit) but `countNpcSpawns`
 * walks the type's placement range, so this belongs where a bot is given its job — once — not in a
 * tick loop. The result is a plain `Set<number>` that costs nothing to test against per tick, which is
 * the whole point: the NAME is resolved once, the SET is what the hot path sees.
 *
 * Throws only if npc-scene was never built; a name that matches nothing comes back `ok: false` with a
 * note that says so, because "no such npc" and "no npc nearby" must not look the same.
 */
export function resolveTarget(pattern: string | RegExp): TargetResolution {
    const label = typeof pattern === 'string' ? pattern : String(pattern);
    const ids = npcScene.npcSpawnTypeIds(pattern);
    // ⛔ PLACEMENTS ARE TALLIED PER *ID*, NOT PER NAME. `countNpcSpawns(pattern)` totals the whole
    // NAME, which is exactly the number that hides the defect: `[23, 26]` totals 5 and looks fine,
    // while id 26 contributes zero of them. One pass over the matching spawns, which is proportional
    // to the matches (5 for a knight, ~30 for a giant), not to the world.
    const placedById = new Map<number, number>();
    for (const sp of npcScene.npcSpawnsByName(pattern)) placedById.set(sp.id, (placedById.get(sp.id) ?? 0) + 1);
    const types: TargetType[] = [];
    for (const id of ids) {
        const def = npcScene.npcSpawnDef(id);
        if (!def) continue;
        types.push({
            id,
            name: def.name ?? '',
            combatLevel: def.combatLevel ?? -1,
            placed: placedById.get(id) ?? 0,
            // ⛔ THE OP LIST, NOT THE LEVEL. vislevel=hide reads 0 and would drop a real target.
            attackable: (def.options ?? []).some(o => o && /^attack$/i.test(o)),
            wanderRange: def.wanderRange ?? 5,
            maxRange: def.maxRange ?? 7,
        });
    }
    const unplaced = types.filter(t => t.placed === 0);
    const unattackable = types.filter(t => !t.attackable && t.placed > 0);
    const live = types.filter(t => t.placed > 0 && t.attackable);
    const placed = live.reduce((a, t) => a + t.placed, 0);
    const ok = live.length > 0 && placed > 0;

    const note = ok
        ? `npc-target '${label}' -> ${live.length} type(s) [${live.map(t => `${t.id}:${t.name}(L${t.combatLevel}) x${t.placed}`).join(', ')}] ` +
          `= ${placed} placement(s)` +
          (unplaced.length ? ` | ⛔ ${unplaced.length} matching type(s) are PLACED ZERO TIMES and are dead weight in any hardcoded set: ${unplaced.map(t => t.id).join(',')}` : '') +
          (unattackable.length ? ` | ⛔ ${unattackable.length} matching type(s) advertise NO 'Attack' op: ${unattackable.map(t => t.id).join(',')}` : '') +
          (live.length > 3 ? ` | ⛔ THIS NAME IS AMBIGUOUS (${live.length} distinct ids) — 'Guard' is 23 of them, at wildly different levels. Narrow the pattern.` : '')
        : types.length === 0
            ? `⛔ npc-target '${label}' MATCHED NO NPC TYPE AT ALL. Check the DISPLAY name — the hill giant is named 'Giant', not 'Hill giant', and a query that matches nothing looks exactly like an empty camp.`
            : `⛔ npc-target '${label}' matched ${types.length} type(s) but NONE is both placed and attackable ` +
              `(unplaced: ${unplaced.map(t => t.id).join(',') || '-'}; unattackable: ${unattackable.map(t => t.id).join(',') || '-'})`;

    return { pattern: label, types, ids: new Set(live.map(t => t.id)), placed, unplaced, unattackable, ok, note };
}

/**
 * Resolve a name, falling back to a literal id set when npc-scene is not built in this process.
 *
 * ⛔ THE FALLBACK IS NOT A CONVENIENCE, AND IT IS NOT SILENT. Several entry points (probes, co-located
 * tests, the sim world) never build the ~90ms npc index, and a brain that threw there would be a
 * regression dressed up as a safety feature. But a fallback that says nothing is how a bot ends up
 * running on the stale constant forever and nobody notices — which is the `[23, 26]` story exactly. So
 * it logs, once, saying which set is actually in force.
 */
export function resolveTargetOr(pattern: string | RegExp, fallback: Iterable<number>, log: (s: string) => void = console.log): Set<number> {
    if (!npcScene.isReady()) {
        log(`[npc-target] '${String(pattern)}': npc-scene NOT BUILT in this process — falling back to the ` +
            `hardcoded id set [${[...fallback].join(',')}]. Call npcScene.init() at startup (beside ` +
            `locScene.init(), ~90ms marginal) to resolve by name and get the placement check.`);
        return new Set(fallback);
    }
    const r = resolveTarget(pattern);
    log(`[npc-target] ${r.note}`);
    if (!r.ok) {
        log(`[npc-target] '${String(pattern)}': resolution FAILED — falling back to [${[...fallback].join(',')}]`);
        return new Set(fallback);
    }
    return r.ids;
}

/**
 * Pick a CAMP for a named target: the densest knot of its spawns, ONCE per bot at assignment.
 *
 * ⛔ NEVER PER TICK. `findSpawnClusters` is O(m^2) in the number of matching spawns — nothing for five
 * knights or thirty hill giants, tens of milliseconds for a pattern matching thousands. npc-scene's own
 * header says it and `census()` are OFFLINE TOOLING; putting either in the packet loop repeats the
 * 570ms-planRoute mistake with a different function.
 *
 * `radius` defaults to the target's own `wanderRange`, because that IS the camp's useful standing
 * radius: an npc will not stray further than its leash, so a camp wider than the leash contains spawns
 * a standing bot can never reach.
 */
export function pickCamp(
    pattern: string | RegExp,
    opts: { level?: number; minCount?: number; radius?: number; near?: { x: number; z: number } } = {},
): SpawnCluster | null {
    const r = resolveTarget(pattern);
    if (!r.ok) return null;
    const leash = Math.max(...r.types.filter(t => t.placed > 0).map(t => t.wanderRange), 5);
    const clusters = npcScene.findSpawnClusters(pattern, {
        radius: opts.radius ?? leash,
        level: opts.level ?? 0,
        minCount: opts.minCount ?? 1,
    });
    if (!clusters.length) return null;
    if (!opts.near) return clusters[0]!;
    // Densest-first is the default order; when a bot has somewhere it already is, break ties by
    // distance so it does not walk across the map past an equally good camp.
    const near = opts.near;
    return [...clusters].sort((a, b) =>
        (b.count - a.count) ||
        (Math.max(Math.abs(a.x - near.x), Math.abs(a.z - near.z)) - Math.max(Math.abs(b.x - near.x), Math.abs(b.z - near.z)))
    )[0]!;
}

/** Nearest live spawn of a resolved target set, for a brain that already has the ids. Packet-loop safe
 *  (npc-scene's zone index; 0.77us/query measured) but the SET must come from `resolveTarget`, once. */
export function nearestSpawnOf(pattern: string | RegExp, x: number, z: number, level = 0, maxRadius = 15): NpcSpawn | null {
    return npcScene.findNearestNpcSpawn(pattern, x, z, level, { maxRadius, withOption: 'Attack' });
}

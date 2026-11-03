// npc-scene: the headless stack's static NPC spawn index, checked against KNOWN GROUND TRUTH.
//
// Every placement assertion here is something we already knew independently, from learnings/ —
// the five Ardougne knights, the Lumbridge cow pen (learnings/real-content-map.md:16), the Lumbridge goblins (:17), the
// NE chicken pen and the Al Kharid warriors (learnings/KEY-FINDINGS.md:166), and the Edgeville
// dungeon hill giants (learnings/real-content-map.md:1253, "npc 117, (3099-3110, 9827-9845)").
// If the parser ever drifts off the map data, these break.
import { describe, test, expect, beforeAll } from 'bun:test';

import * as locScene from '../loc-scene.js';
import * as npcScene from '../npc-scene.js';

const ARDOUGNE_MARKET = { x: 2660, z: 3283 };

/** All five, from the map data. See the knight-count test for why this list is the whole world. */
const KNIGHT_SPAWNS = [
    { x: 2582, z: 3297 },
    { x: 2652, z: 3318 },
    { x: 2653, z: 3300 },
    { x: 2669, z: 3298 },
    { x: 2671, z: 3313 },
];

const LUMBRIDGE = { x: 3222, z: 3218 };

beforeAll(() => {
    npcScene.init();
});

describe('build', () => {
    test('parses every static spawn in the world once', () => {
        const s = npcScene.stats();
        expect(s.built).toBe(true);
        // 483 map squares ship; 296 of them contain an NPC section with rows.
        expect(s.mapSquares).toBe(330);   // rev 289: 534 squares ship, 330 carry NPC rows (274: 483 / 296)
        // Every non-empty line in every `==== NPC ====` section.
        expect(s.spawns).toBe(8142);   // rev 289 (274: 7321)
        expect(s.zones).toBe(4871);
        expect(s.npcTypes).toBe(1597);   // rev 289 (274: 1359)
        // 1114 of the 1359 npc types are actually placed somewhere. The other 245 are
        // script-spawned (npc_add) or quest-only, and no camp query can ever reach them.
        expect(s.typesPlaced).toBe(1259);   // rev 289 (274: 1114)
        expect(s.membersOnlySpawns).toBe(242);   // rev 289 (274: 234)
    });

    test('the placement store stays columnar and tiny', () => {
        const s = npcScene.stats();
        // 7 bytes per spawn (x,z,type as Uint16 + level as Uint8) plus a 4-byte type-order index.
        expect(s.placementBytes).toBe(s.spawns * 11);
        expect(s.placementBytes).toBeLessThan(128 * 1024);
    });

    test('spawns land on all four planes, and they add up', () => {
        const perLevel = [0, 1, 2, 3].map(level =>
            npcScene.census({ minX: 0, maxX: 20000, minZ: 0, maxZ: 20000, level })
                .reduce((a, r) => a + r.count, 0));
        expect(perLevel).toEqual([7565, 390, 166, 21]);   // rev 289 (274: [6818, 357, 131, 15])
        expect(perLevel.reduce((a, b) => a + b, 0)).toBe(npcScene.stats().spawns);
    });

    test('every placed type resolves to a def (the engine fatals otherwise)', () => {
        // GameMap.ts:148 printFatalError's on an unknown npc type in a map square. If this ever
        // fails, the index and the engine disagree about what the map contains.
        for (const row of npcScene.census()) {
            expect(npcScene.npcSpawnDef(row.id)).toBeDefined();
        }
    });
});

describe('type table', () => {
    test('names and ops are loc-scene\'s, not a second copy', () => {
        // This module owns placement; loc-scene owns npc.pack and the display names. A divergence
        // between the two would mean two different answers to "what is npc 23".
        for (const id of [23, 9, 32, 117, 81, 41]) {
            const def = npcScene.npcSpawnDef(id)!;
            expect(def.name).toBe(locScene.npcName(id));
            expect(def.options).toEqual(locScene.npcDef(id)!.options);
            expect(def.optionsWithIndex).toEqual(locScene.npcDef(id)!.optionsWithIndex);
        }
    });

    test('npc-only config fields come through with the engine\'s defaults', () => {
        const knight = npcScene.npcSpawnDef(23)!;
        expect(knight.internal).toBe('knight_of_ardougne');
        expect(knight.name).toBe('Knight of Ardougne');
        expect(knight.combatLevel).toBe(46);
        expect(knight.wanderRange).toBe(15);
        expect(knight.maxRange).toBe(17);
        expect(knight.respawnRate).toBe(50);   // ticks -> 30s
        expect(knight.hitpoints).toBe(52);
        expect(knight.attack).toBe(38);
        expect(knight.strength).toBe(40);
        expect(knight.defence).toBe(31);
        expect(knight.members).toBe(false);
        expect(knight.options).toEqual(['Attack', 'Pickpocket']);

        // A 2x2 npc — a bot has to approach these differently.
        const giant = npcScene.npcSpawnDef(117)!;
        expect(giant.size).toBe(2);
        expect(giant.combatLevel).toBe(28);
        expect(giant.hitpoints).toBe(35);
        // Wander/leash is much tighter than the knight's: a giant camp does not spread.
        expect(giant.wanderRange).toBe(3);
        expect(giant.maxRange).toBe(5);
    });

    test('absent config keys fall back exactly like NpcType.ts', () => {
        // The cow config states size/vislevel/respawnrate/hitpoints and says nothing about ranges.
        const cow = npcScene.npcSpawnDef(81)!;
        expect(cow.name).toBe('Cow');
        expect(cow.respawnRate).toBe(90);   // stated
        expect(cow.wanderRange).toBe(5);    // NpcType default
        expect(cow.maxRange).toBe(7);       // NpcType default
        expect(cow.huntRange).toBe(0);      // NpcType default

        // ...and a type that DOES state them keeps its own, so the default is not being smeared
        // over everything.
        const rat = npcScene.npcSpawnDef(47)!;
        expect(rat.name).toBe('Rat');
        expect(rat.wanderRange).toBe(15);
        expect(rat.maxRange).toBe(17);
        expect(rat.respawnRate).toBe(4);

        // moveRestrict/category survive as text (a pinned npc cannot be pulled off its tile).
        const banker = npcScene.npcSpawnDef(494)!;
        expect(banker.name).toBe('Banker');
        expect(banker.moveRestrict).toBe('nomove');
        expect(banker.category).toBe('bank_teller');
        expect(banker.wanderRange).toBe(5);   // rev 289 banker.npc dropped wanderrange=0 (moverestrict=nomove pins it) -> class default 5
    });

    test('vislevel=hide reads as 0, and NOTHING in the table is NaN', () => {
        // The regression this guards: `vislevel=hide` is a real config value (zoo_keeper), and a
        // bare parseInt puts NaN in the index. NaN then fails BOTH `< min` and `> max`, so a bad
        // row slips silently through every combat-level filter instead of being excluded.
        expect(npcScene.npcSpawnDef(28)!.name).toBe('Zoo keeper');
        expect(npcScene.npcSpawnDef(28)!.combatLevel).toBe(0);

        for (const row of npcScene.census()) {
            const d = npcScene.npcSpawnDef(row.id)!;
            for (const v of [d.combatLevel, d.size, d.wanderRange, d.maxRange, d.huntRange,
                d.attackRange, d.respawnRate, d.hitpoints, d.attack, d.strength, d.defence]) {
                expect(Number.isFinite(v)).toBe(true);
            }
        }
    });

    test('name -> ids delegates to loc-scene and memoises', () => {
        expect(npcScene.npcSpawnTypeIds(/^Knight of Ardougne$/i)).toEqual([23, 26]);
        expect(npcScene.npcSpawnTypeIds(/^Knight of Ardougne$/i))
            .toEqual(locScene.npcIdsByName(/^Knight of Ardougne$/i));
        // Second call must be the memoised array, not a fresh scan of the 1359-entry table.
        expect(npcScene.npcSpawnTypeIds(/^Knight of Ardougne$/i))
            .toBe(npcScene.npcSpawnTypeIds(/^Knight of Ardougne$/i));
        // A bare string is EXACT and case-insensitive here (it resolves through the name table).
        expect(npcScene.npcSpawnTypeIds('knight of ardougne')).toEqual([23, 26]);
        // 'Knight' is its OWN display name (the party room statue), not a prefix of the Ardougne
        // one — which is exactly the near-miss CLAUDE.md warns about, and why exact beats substring.
        expect(npcScene.npcSpawnTypeIds('knight')).toEqual([660]);
        expect(npcScene.npcSpawnDef(660)!.internal).toBe('partyroom_knight');
        expect(npcScene.countNpcSpawns('knight')).toBe(0);
    });
});

describe('GROUND TRUTH: the Ardougne knights', () => {
    test('there are exactly FIVE Knight of Ardougne spawns in the whole world', () => {
        const all = npcScene.npcSpawnsByName(/^Knight of Ardougne$/i);
        expect(all.length).toBe(5);
        expect(all.map(s => ({ x: s.x, z: s.z }))).toEqual(KNIGHT_SPAWNS);
        expect(all.every(s => s.level === 0)).toBe(true);
        expect(npcScene.countNpcSpawns(/^Knight of Ardougne$/i)).toBe(5);
    });

    test('all five are npc 23 — npc 26 shares the name but is NEVER placed', () => {
        // Both ids exist and are identical in the configs, which is exactly why the brains'
        // hardcoded `[23, 26]` type-set looks right and is half dead weight: 26 has no static
        // spawn anywhere, it only appears in the thieving scripts.
        const all = npcScene.npcSpawnsByName(/^Knight of Ardougne$/i);
        expect(all.every(s => s.id === 23)).toBe(true);
        expect(npcScene.npcSpawnDef(26)!.internal).toBe('knight_of_ardougne2');
        expect(npcScene.npcSpawnDef(26)!.name).toBe('Knight of Ardougne');
        expect(all.filter(s => s.id === 26)).toEqual([]);
    });

    test('the four market knights form ONE camp; the fifth is a 70-tile outlier', () => {
        // This is the venue question the brains cannot ask today. Four knights sit inside a
        // 25-tile circle around the market; (2582,3297) is on its own, west of the river.
        const camps = npcScene.findSpawnClusters(/^Knight of Ardougne$/i, { radius: 25 });
        expect(camps.length).toBe(2);
        expect(camps[0]!.count).toBe(4);
        expect(camps[0]!.x).toBe(2661);
        expect(camps[0]!.z).toBe(3307);
        expect(camps[1]!.count).toBe(1);
        expect(camps[1]!.x).toBe(2582);
    });

    test('a bot at the market finds its target BY NAME with no hardcoded id', () => {
        const k = npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i,
            ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 0)!;
        expect(k).not.toBeNull();
        expect(k.id).toBe(23);
        expect(k.x).toBe(2669);
        expect(k.z).toBe(3298);
        expect(k.distance).toBe(15);
        expect(k.combatLevel).toBe(46);
        // opIndex 2 is what an OPNPC packet needs for Attack.
        expect(k.optionsWithIndex).toEqual([
            { text: 'Attack', opIndex: 2 },
            { text: 'Pickpocket', opIndex: 3 },
        ]);
    });
});

describe('GROUND TRUTH: other well-known spawn sets', () => {
    test('the Lumbridge cow pen holds exactly 10 cows (real-content-map.md:16)', () => {
        // "Lumbridge pen (3255,3278) ~10 cows ... cow=81", pen x 3242-3265, z 3255-3298.
        const pen = { minX: 3242, maxX: 3265, minZ: 3255, maxZ: 3298, level: 0 };
        expect(npcScene.countNpcSpawns(/^Cow$/i, pen)).toBe(10);
        const cows = npcScene.npcSpawnsByName(/^Cow$/i, { level: 0 })
            .filter(s => s.x >= 3242 && s.x <= 3265 && s.z >= 3255 && s.z <= 3298);
        expect(cows.every(s => s.id === 81)).toBe(true);
        // The exact tile the learnings quote is a real spawn.
        expect(cows.some(s => s.x === 3255 && s.z === 3278)).toBe(true);
        // Cows are 2x2, which is why a bot has to stand off them.
        expect(cows[0]!.size).toBe(2);
    });

    test('the Lumbridge goblins are where real-content-map.md:17 says (goblin=100)', () => {
        const near = npcScene.findNpcSpawnsInRadius(/^Goblin$/i, 3253, 3243, 0, 15);
        // The note says "16 goblins" from a bot's view; the map has 18 inside 15 tiles and the
        // densest 12-tile camp is 17 — a view-count is a lower bound on a spawn count.
        expect(near.length).toBe(18);
        expect(near.every(s => s.id === 100)).toBe(true);
        const camp = npcScene.findSpawnClusters(/^Goblin$/i, { radius: 12, limit: 1 })[0]!;
        expect(camp.count).toBe(17);
        expect(camp.x).toBe(3252);
        expect(camp.z).toBe(3241);
    });

    test('the NE chicken pen is at (3230,3298) with npc 41 (KEY-FINDINGS.md:166)', () => {
        const chickens = npcScene.findNpcSpawnsInRadius(/^Chicken$/i, 3230, 3298, 0, 8);
        expect(chickens.length).toBe(9);
        expect(chickens.every(s => s.id === 41)).toBe(true);
        // A chicken spawns on the exact tile the field note quotes.
        expect(chickens[0]!.distance).toBe(0);
        expect(chickens[0]!.combatLevel).toBe(1);
    });

    test('the Al Kharid warriors are level 9, nine of them (KEY-FINDINGS.md:166)', () => {
        const akw = npcScene.findNpcSpawnsInRadius(/^Al-Kharid warrior$/i, 3293, 3175, 0, 20);
        expect(akw.length).toBe(9);
        expect(npcScene.countNpcSpawns(/^Al-Kharid warrior$/i)).toBe(9);
        expect(akw.every(s => s.id === 18 && s.combatLevel === 9)).toBe(true);
    });

    test('the Edgeville dungeon hill giants are npc 117 (real-content-map.md:1253)', () => {
        // The note: "the Edgeville-dungeon hill giants (npc 117, (3099-3110, 9827-9845))".
        // Confirmed — AND the display name in this cache is 'Giant', not 'Hill Giant'.
        expect(npcScene.npcSpawnDef(117)!.name).toBe('Giant');
        expect(npcScene.npcSpawnTypeIds(/^Hill Giant$/i)).toEqual([]);
        expect(npcScene.npcSpawnsByName(/^Hill Giant$/i)).toEqual([]);

        const giants = npcScene.npcSpawnsByName(/^Giant$/i);
        expect(giants.length).toBe(27);
        expect(giants.every(s => s.id === 117)).toBe(true);

        const dungeon = giants.filter(s => s.x >= 3090 && s.x <= 3125 && s.z >= 9800 && s.z <= 9860);
        expect(dungeon.length).toBe(12);
        expect(dungeon[0]!.x).toBe(3099);
        expect(dungeon[0]!.z).toBe(9832);
        // ...and it is the biggest Giant camp in the world by a factor of two.
        const best = npcScene.findSpawnClusters(/^Giant$/i, { radius: 15, limit: 1 })[0]!;
        expect(best.count).toBe(12);
        expect(best.x).toBe(3111);
        expect(best.z).toBe(9838);
    });

    test('the Varrock palace guards are npc 9, level 21', () => {
        const courtyard = npcScene.findNpcSpawnsInRadius(/^Guard$/i, 3213, 3462, 0, 12);
        expect(courtyard.length).toBe(6);
        expect(courtyard.every(s => s.id === 9 && s.combatLevel === 21)).toBe(true);
        // ...and the west-gate pair the routes pass, three more of the same type.
        expect(npcScene.findNpcSpawnsInRadius(/^Guard$/i, 3175, 3426, 0, 12).length).toBe(3);
    });

    test("'Guard' is 24 (rev 289; 274: 23) different type ids — the case against hardcoding them", () => {
        // A brain that hardcodes a guard id gets ONE city's guards. The Ardougne guards
        // are id 32 at level 20; Varrock's are id 9 at level 21; neither is 'the'
        // guard id.
        const ids = npcScene.npcSpawnTypeIds(/^Guard$/i);
        expect(ids.length).toBe(24);
        expect(ids).toContain(9);
        expect(ids).toContain(32);
        expect(npcScene.countNpcSpawns(/^Guard$/i)).toBe(98);   // rev 289 (274: 96)

        const ardougne = npcScene.findNpcSpawnsInRadius(/^Guard$/i, 2668, 3310, 0, 10);
        expect(ardougne.length).toBe(6);
        expect(ardougne.every(s => s.id === 32 && s.combatLevel === 20)).toBe(true);
    });
});

describe('query semantics', () => {
    test('distance is Chebyshev, exactly like StateCollector', () => {
        const k = npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i, 2669, 3298, 0)!;
        expect(k.distance).toBe(0);
        // (2669,3298) -> (2671,3313): dx=2, dz=15 -> 15, not 17.
        const two = npcScene.findNpcSpawnsInRadius(/^Knight of Ardougne$/i, 2669, 3298, 0, 15);
        expect(two.map(s => s.distance)).toEqual([0, 15]);
    });

    test('results are sorted nearest-first and limit applies after the sort', () => {
        const all = npcScene.getNpcSpawnsInRadius(3253, 3243, 0, 20);
        expect(all.length).toBeGreaterThan(10);
        for (let i = 1; i < all.length; i++) {
            expect(all[i]!.distance).toBeGreaterThanOrEqual(all[i - 1]!.distance);
        }
        expect(npcScene.getNpcSpawnsInRadius(3253, 3243, 0, 20, { limit: 3 })).toEqual(all.slice(0, 3));
    });

    test('radius is inclusive and actually bounds the result', () => {
        expect(npcScene.findNpcSpawnsInRadius(/^Knight of Ardougne$/i, 2669, 3298, 0, 15).length).toBe(2);
        expect(npcScene.findNpcSpawnsInRadius(/^Knight of Ardougne$/i, 2669, 3298, 0, 14).length).toBe(1);
        expect(npcScene.findNpcSpawnsInRadius(/^Knight of Ardougne$/i, 2669, 3298, 0, 0).length).toBe(1);
    });

    test('queries are level-scoped by default, and anyLevel widens them', () => {
        // Every knight is on level 0, so asking from level 1 finds nothing...
        expect(npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i, 2660, 3283, 1)).toBeNull();
        // ...unless you say you can change planes.
        const any = npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i, 2660, 3283, 1,
            { anyLevel: true })!;
        expect(any.level).toBe(0);
        expect(npcScene.getNpcSpawnsInRadius(2660, 3283, 1, 30).every(s => s.level === 1)).toBe(true);
    });

    test('maxRadius bounds the world-wide nearest search', () => {
        // The lone west-river knight is ~70 tiles from the market cluster.
        expect(npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i, 2560, 3297, 0)!.x).toBe(2582);
        expect(npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i, 2560, 3297, 0, { maxRadius: 10 }))
            .toBeNull();
    });

    test('filters: combat level, ops and members', () => {
        const box = { minX: 2570, maxX: 2700, minZ: 3260, maxZ: 3340, level: 0 };
        const attackable = npcScene.census(box, { withOption: 'Attack' });
        expect(attackable.every(r => r.options.includes('Attack'))).toBe(true);
        expect(attackable.some(r => r.name === 'Banker')).toBe(false);
        expect(attackable.some(r => r.name === 'Knight of Ardougne')).toBe(true);

        const mid = npcScene.census(box, { withOption: 'Attack', minCombatLevel: 40, maxCombatLevel: 50 });
        expect(mid.every(r => r.combatLevel >= 40 && r.combatLevel <= 50)).toBe(true);
        expect(mid.map(r => r.name)).toContain('Knight of Ardougne');

        // f2pOnly answers as an f2p world would (GameMap.ts:151).
        const f2p = npcScene.census(undefined, { f2pOnly: true }).reduce((a, r) => a + r.count, 0);
        expect(f2p).toBe(npcScene.stats().spawns - npcScene.stats().membersOnlySpawns);
    });

    test('getNpcSpawnsAt reads one exact tile', () => {
        const at = npcScene.getNpcSpawnsAt(2669, 3298, 0);
        expect(at.length).toBe(1);
        expect(at[0]!.id).toBe(23);
        expect(npcScene.getNpcSpawnsAt(2669, 3299, 0)).toEqual([]);
    });

    test('npcSpawnsByName is stably ordered, so a table generated from it is diffable', () => {
        const a = npcScene.npcSpawnsByName(/^Guard$/i);
        const b = npcScene.npcSpawnsByName(/^Guard$/i);
        expect(a).toEqual(b);
        for (let i = 1; i < a.length; i++) {
            const prev = a[i - 1]!, cur = a[i]!;
            expect(prev.level < cur.level
                || (prev.level === cur.level && prev.x < cur.x)
                || (prev.level === cur.level && prev.x === cur.x && prev.z <= cur.z)).toBe(true);
        }
    });

    test('no match returns null / empty / 0, never throws', () => {
        expect(npcScene.findNearestNpcSpawn(/^not a real npc$/i, LUMBRIDGE.x, LUMBRIDGE.z, 0)).toBeNull();
        expect(npcScene.findNpcSpawnsInRadius(/^nope$/i, LUMBRIDGE.x, LUMBRIDGE.z, 0, 20)).toEqual([]);
        expect(npcScene.npcSpawnsByName(/^nope$/i)).toEqual([]);
        expect(npcScene.countNpcSpawns(/^nope$/i)).toBe(0);
        expect(npcScene.findSpawnClusters(/^nope$/i)).toEqual([]);
        // Deep ocean: a coordinate with no map square at all.
        expect(npcScene.getNpcSpawnsInRadius(1900, 9000, 0, 15)).toEqual([]);
        expect(npcScene.npcSpawnDef(60000)).toBeUndefined();
    });

    test('a stray /g regex does not make results depend on call order', () => {
        const g = /^Knight of Ardougne$/gi;
        const first = npcScene.npcSpawnsByName(g);
        const second = npcScene.npcSpawnsByName(g);
        expect(second).toEqual(first);
        expect(first.length).toBe(5);
    });
});

describe('the training-venue query (what the hardcoded type-sets replace)', () => {
    test('"what can a level-40 bot fight near Ardougne" is one call', () => {
        const rows = npcScene.census({ x: ARDOUGNE_MARKET.x, z: ARDOUGNE_MARKET.z, radius: 60, level: 0 },
            { withOption: 'Attack', minCombatLevel: 20, maxCombatLevel: 100, limit: 5 });
        expect(rows.length).toBe(5);
        expect(rows[0]!.name).toBe('Guard');
        expect(rows[0]!.count).toBe(10);
        expect(rows.map(r => r.name)).toContain('Knight of Ardougne');
        // Densest first.
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i]!.count).toBeLessThanOrEqual(rows[i - 1]!.count);
        }
    });

    test('a camp carries its size, spread and composition', () => {
        const camp = npcScene.findSpawnClusters(/^Guard$/i, { radius: 12, limit: 1 })[0]!;
        expect(camp.count).toBe(11);
        expect(camp.level).toBe(0);
        expect(camp.spread).toBeLessThanOrEqual(12);
        // A camp can mix ids under one name — the reason a numeric type-set is the wrong unit.
        expect(camp.types.length).toBe(3);
        expect(camp.types.reduce((a, t) => a + t.count, 0)).toBe(camp.count);
    });

    test('clusters do not overlap, so the camps can be handed to different processes', () => {
        const camps = npcScene.findSpawnClusters(/^Goblin$/i, { radius: 12 });
        for (let i = 0; i < camps.length; i++) {
            for (let j = i + 1; j < camps.length; j++) {
                const a = camps[i]!, b = camps[j]!;
                if (a.level !== b.level) continue;
                // Distinct centres; membership is disjoint by construction.
                expect(a.x !== b.x || a.z !== b.z).toBe(true);
            }
        }
        expect(camps.reduce((a, c) => a + c.count, 0))
            .toBeLessThanOrEqual(npcScene.countNpcSpawns(/^Goblin$/i));
    });

    test('minCount drops the singletons a bot group cannot use', () => {
        const all = npcScene.findSpawnClusters(/^Knight of Ardougne$/i, { radius: 25 });
        const usable = npcScene.findSpawnClusters(/^Knight of Ardougne$/i, { radius: 25, minCount: 2 });
        expect(all.length).toBe(2);
        expect(usable.length).toBe(1);
        expect(usable[0]!.count).toBe(4);
    });
});

describe('packet-loop budget', () => {
    const budgetMs = (fn: () => unknown, iters: number): number => {
        for (let i = 0; i < 500; i++) fn();
        const t = performance.now();
        for (let i = 0; i < iters; i++) fn();
        return (performance.now() - t) / iters;
    };

    test('a WORLD-WIDE nearest-spawn query is microseconds', () => {
        // Measured ~0.8us for the knights, ~2.5us for the 96 guards. The type-order index means
        // cost tracks the number of spawns of that TYPE, not the 7321 in the world.
        expect(budgetMs(() => npcScene.findNearestNpcSpawn(/^Knight of Ardougne$/i, 2660, 3283, 0), 50000))
            .toBeLessThan(0.5);
        expect(budgetMs(() => npcScene.findNearestNpcSpawn(/^Guard$/i, 2660, 3283, 0), 20000))
            .toBeLessThan(0.5);
    });

    test('a radius query costs the radius, not the world', () => {
        const dense = budgetMs(() => npcScene.getNpcSpawnsInRadius(3253, 3243, 0, 15), 20000);
        const empty = budgetMs(() => npcScene.getNpcSpawnsInRadius(1900, 9000, 0, 15), 20000);
        expect(dense).toBeLessThan(0.5);   // measured ~0.007ms
        expect(empty).toBeLessThan(0.05);
        expect(empty).toBeLessThan(dense);
    });

    test('name resolution is memoised, so a per-tick call does not rescan the table', () => {
        expect(budgetMs(() => npcScene.npcSpawnTypeIds(/^Guard$/i), 100000)).toBeLessThan(0.01);
    });

    test('a radius census is still under a millisecond', () => {
        expect(budgetMs(() => npcScene.census({ x: 2660, z: 3283, radius: 30, level: 0 }), 5000))
            .toBeLessThan(1);   // measured ~0.005ms
    });
});

describe('process-global singleton', () => {
    test('init() is idempotent — the second and later calls do no work', () => {
        const before = npcScene.stats();
        const t = performance.now();
        npcScene.init();
        npcScene.init();
        npcScene.init();
        expect(performance.now() - t).toBeLessThan(5);
        expect(npcScene.stats()).toEqual(before);
        // buildMs still reports the ORIGINAL build, proving nothing was rebuilt.
        expect(npcScene.stats().buildMs).toBe(before.buildMs);
    });

    test('a second import shares one index, it does not build a second copy', async () => {
        const again = await import('../npc-scene.js');
        expect(again.isReady()).toBe(true);
        expect(again.stats()).toEqual(npcScene.stats());
        expect(again.findNearestNpcSpawn).toBe(npcScene.findNearestNpcSpawn);
        expect(again).toBe(npcScene as unknown as typeof again);
    });

    test('initAsync resolves immediately once built, and concurrent callers share one build', async () => {
        const t = performance.now();
        await Promise.all([npcScene.initAsync(), npcScene.initAsync(), npcScene.initAsync()]);
        expect(performance.now() - t).toBeLessThan(50);
        expect(npcScene.isReady()).toBe(true);
    });

    // LAST: this tears the index down, so nothing may depend on it afterwards.
    test('querying before init() throws an actionable error instead of building in the loop', () => {
        npcScene.__resetForTests();
        expect(npcScene.isReady()).toBe(false);
        expect(() => npcScene.npcSpawnDef(23)).toThrow(/not initialised/);
        expect(() => npcScene.findNearestNpcSpawn(/^Guard$/i, 2660, 3283, 0)).toThrow(/not initialised/);
        expect(() => npcScene.npcSpawnsByName(/^Guard$/i)).toThrow(/not initialised/);
        expect(() => npcScene.census()).toThrow(/not initialised/);

        // ...and a rebuild from scratch reproduces the same index.
        npcScene.init();
        expect(npcScene.stats().spawns).toBe(8142);
        expect(npcScene.stats().zones).toBe(4871);
        expect(npcScene.npcSpawnsByName(/^Knight of Ardougne$/i).map(s => ({ x: s.x, z: s.z })))
            .toEqual(KNIGHT_SPAWNS);
    });
});

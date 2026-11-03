// loc-scene: the headless stack's entity-by-name discovery, checked against KNOWN GROUND TRUTH.
//
// Every placement assertion here is a real thing at a real coordinate that we already knew about
// independently — the Al Kharid toll gate (locIds 2882/2883 at 3268,3227 and 3268,3228, the pair
// every Lumbridge->Al Kharid route opens), and the Ardougne bank booths that headless/find-banks.ts
// prints. If the parser ever drifts, these break.
import { describe, test, expect, beforeAll } from 'bun:test';
import * as locScene from '../loc-scene.js';

// Al Kharid toll gate — the two halves of the gate on the Lumbridge road.
const TOLL_LEFT = { id: 2882, x: 3268, z: 3227 };
const TOLL_RIGHT = { id: 2883, x: 3268, z: 3228 };

// Ardougne SOUTH bank (the receiver's old station) and NORTH bank, per find-banks.ts.
const ARD_SOUTH_BOOTHS = [{ x: 2656, z: 3283 }, { x: 2656, z: 3286 }];
const ARD_NORTH_BOOTHS = [{ x: 2615, z: 3331 }, { x: 2618, z: 3331 }, { x: 2619, z: 3331 }];
const BANK_BOOTH_ID = 2213;

const LUMBRIDGE = { x: 3222, z: 3218 };

beforeAll(() => {
    locScene.init();
});

describe('build', () => {
    test('parses the whole world once', () => {
        const s = locScene.stats();
        expect(s.built).toBe(true);
        // 483 map squares ship; 431 of them actually contain locs.
        expect(s.mapSquares).toBe(468);   // rev 289: 534 ship, 468 hold locs (274: 483 / 431)
        // Every placed loc in the shipped maps, minus the bridged level-0 ones the engine drops.
        expect(s.placedLocs).toBe(936653);   // rev 289 (274: 815960)
        expect(s.zones).toBe(35425);
        expect(s.locTypes).toBe(5117);
        expect(s.npcTypes).toBe(1597);
        expect(s.objTypes).toBe(4089);
    });

    test('placement store stays columnar and small', () => {
        const s = locScene.stats();
        // 9 bytes per loc (x,z,id as Uint16 + level,shape,angle as Uint8). An object per loc would
        // be ~10x this, and this index is process-global, so the constant matters.
        expect(s.placementBytes).toBe(s.placedLocs * 9);
        expect(s.placementBytes).toBeLessThan(9 * 1024 * 1024);   // rev 289: 8.04 MiB (274: 7.0 MiB) — still 9 B/loc
    });
});

describe('name tables', () => {
    test('locName resolves the Al Kharid toll gate halves', () => {
        expect(locScene.locName(TOLL_LEFT.id)).toBe('Gate');
        expect(locScene.locName(TOLL_RIGHT.id)).toBe('Gate');
        expect(locScene.locDef(TOLL_LEFT.id)?.internal).toBe('border_gate_toll_left');
        expect(locScene.locDef(TOLL_RIGHT.id)?.internal).toBe('border_gate_toll_right');
    });

    test('locName resolves a bank booth and a tree', () => {
        expect(locScene.locName(BANK_BOOTH_ID)).toBe('Bank booth');
        expect(locScene.locName(1278)).toBe('Tree');
        expect(locScene.locDef(1278)?.internal).toBe('tree2');
    });

    test('npcName and objName come from their own packs', () => {
        expect(locScene.npcName(1)).toBe('Man');
        expect(locScene.objName(995)).toBe('Coins');
    });

    test('noted items inherit the base item name', () => {
        // obj 6 = twpart1, obj 7 = cert_twpart1. Certs have no config section of their own.
        expect(locScene.objName(6)).toBe('Cannon base');
        expect(locScene.objName(7)).toBe('Cannon base');
    });

    test('unnamed scenery and unknown ids resolve to empty string, never throw', () => {
        expect(locScene.locName(83)).toBe('');            // inviswall: real id, no display name
        expect(locScene.locDef(83)?.internal).toBe('inviswall');
        expect(locScene.locName(60000)).toBe('');
        expect(locScene.npcName(60000)).toBe('');
        expect(locScene.objName(60000)).toBe('');
    });

    test('ore rocks are renamed for parity with the browser SDK', () => {
        // StateCollector rewrites rocks so a bot can target the ORE. The raw config just says
        // "Rocks", which is useless for /iron/i.
        expect(locScene.locName(2092)).toBe('Rocks iron ore');
        expect(locScene.locName(2096)).toBe('Rocks coal ore');
        expect(locScene.locName(2491)).toBe('Rocks rune essence ore');
    });

    test('options carry the op text and its 1-based OPLOC index', () => {
        expect(locScene.locDef(TOLL_LEFT.id)?.optionsWithIndex).toEqual([{ text: 'Open', opIndex: 1 }]);
        expect(locScene.locDef(BANK_BOOTH_ID)?.options).toEqual(['Use', 'Use-quickly']);
    });

    test("engine parity: 'hidden' ops are dropped", () => {
        // The tree config declares op1=Chop down AND op3=hidden. OpLocHandler refuses a hidden op,
        // so surfacing it could only produce an interaction the server silently ignores.
        const tree = locScene.locDef(1278)!;
        expect(tree.options).toEqual(['Chop down']);
        expect(tree.options).not.toContain('hidden');
    });

    test('footprint comes from the config', () => {
        expect(locScene.locDef(1278)?.width).toBe(2);   // tree
        expect(locScene.locDef(1278)?.length).toBe(2);
        expect(locScene.locDef(TOLL_LEFT.id)?.width).toBe(1);
    });
});

describe('name -> ids reverse lookup', () => {
    test('several ids share one display name (which is why callers must not hardcode ids)', () => {
        const gates = locScene.locIdsByName('Gate');
        expect(gates.length).toBe(88);
        expect(gates).toContain(TOLL_LEFT.id);
        expect(gates).toContain(TOLL_RIGHT.id);
    });

    test('string lookup is exact and case-insensitive', () => {
        expect(locScene.locIdsByName('gate')).toEqual(locScene.locIdsByName('Gate'));
        expect(locScene.locIdsByName('Bank booth')).toEqual([2213, 2214, 3045]);
        // Exact, not substring: 'Bank' alone is not a display name.
        expect(locScene.locIdsByName('Bank')).toEqual([]);
    });

    test('regex lookup scans the table', () => {
        expect(locScene.locIdsByName(/^Bank booth$/i)).toEqual([2213, 2214, 3045]);
        expect(locScene.npcIdsByName(/^Knight of Ardougne$/i)).toEqual([23, 26]);
        expect(locScene.objIdsByName('Coins')).toEqual([617, 995]);
    });
});

describe('placed-loc ground truth', () => {
    test('the Al Kharid toll gate is where we always knew it was', () => {
        const left = locScene.getLocsAt(TOLL_LEFT.x, TOLL_LEFT.z, 0);
        expect(left.map(l => l.id)).toContain(TOLL_LEFT.id);
        expect(left.find(l => l.id === TOLL_LEFT.id)!.name).toBe('Gate');

        const right = locScene.getLocsAt(TOLL_RIGHT.x, TOLL_RIGHT.z, 0);
        expect(right.map(l => l.id)).toContain(TOLL_RIGHT.id);
        expect(right.find(l => l.id === TOLL_RIGHT.id)!.name).toBe('Gate');
    });

    test('a bot standing south of the toll gate finds it BY NAME, with no hardcoded id', () => {
        const gate = locScene.findNearbyLoc(/^gate$/i, 3268, 3224, 0, 10);
        expect(gate).not.toBeNull();
        expect(gate!.x).toBe(3268);
        expect([TOLL_LEFT.id, TOLL_RIGHT.id]).toContain(gate!.id);
        expect(gate!.options).toContain('Open');
        // Nearest wins: z=3227 is 3 away, z=3228 is 4 away.
        expect(gate!.z).toBe(TOLL_LEFT.z);
    });

    test('the Ardougne SOUTH bank booths match find-banks.ts exactly', () => {
        const found = locScene.findNearbyLocs(/^bank booth$/i, 2655, 3283, 0, 10);
        expect(found.map(l => ({ x: l.x, z: l.z }))).toEqual(ARD_SOUTH_BOOTHS);
        expect(found.every(l => l.id === BANK_BOOTH_ID)).toBe(true);
        expect(found.every(l => l.level === 0)).toBe(true);
    });

    test('the Ardougne NORTH bank booths match find-banks.ts exactly', () => {
        const found = locScene.findNearbyLocs(/^bank booth$/i, 2617, 3331, 0, 3);
        expect(found.map(l => ({ x: l.x, z: l.z })).sort((a, b) => a.x - b.x)).toEqual(ARD_NORTH_BOOTHS);
        expect(found.every(l => l.id === BANK_BOOTH_ID)).toBe(true);
    });

    test('finds a booth find-banks.ts MISSED, because it searches display names not internal ones', () => {
        // find-banks matches /bank/i against the PACK name. loc 2214's pack name is 'loc_2214',
        // so it never showed up there — but its display name is 'Bank booth' and it is a real,
        // usable booth in Ardougne north. This is the whole point of a display-name index.
        const box = { minX: 2500, maxX: 2750, minZ: 3200, maxZ: 3400, level: 0 };
        const booths = locScene.findInBox(/^bank booth$/i, box);
        expect(booths.map(l => `${l.id}@${l.x},${l.z}`).sort()).toEqual([
            '2213@2615,3331', '2213@2618,3331', '2213@2619,3331',
            '2213@2656,3283', '2213@2656,3286',
            '2214@2613,3335', '2214@2614,3335',
        ]);
    });

    test('finds a common loc: trees around Lumbridge', () => {
        const trees = locScene.findNearbyLocs(/^tree$/i, LUMBRIDGE.x, LUMBRIDGE.z, 0, 20);
        expect(trees.length).toBeGreaterThan(3);
        expect(trees[0]!.name).toBe('Tree');
        expect(trees[0]!.options).toContain('Chop down');
        expect(trees[0]!.width).toBe(2);
        expect(trees.every(t => t.level === 0)).toBe(true);
    });

    test('anchored patterns exclude the near-miss the CLAUDE.md guide warns about', () => {
        // /^tree$/i must never return a 'Tree stump'.
        expect(locScene.locName(1341)).toBe('Tree stump');
        const strict = locScene.findNearbyLocs(/^tree$/i, 3200, 3230, 0, 25);
        expect(strict.every(l => l.name === 'Tree')).toBe(true);
        const stumps = locScene.locIdsByName('Tree stump');
        expect(stumps).toContain(1341);
        expect(locScene.locIdsByName('Tree')).not.toContain(1341);
    });

    test('mining rocks are findable by ore name', () => {
        const iron = locScene.findNearbyLocs(/rocks.*iron/i, 3285, 3365, 0, 20);
        expect(iron.length).toBeGreaterThan(0);
        expect(iron[0]!.name).toBe('Rocks iron ore');
    });
});

describe('query semantics (mirrors sdk/index.ts)', () => {
    test('distance is Chebyshev, exactly like StateCollector.scanNearbyLocs', () => {
        // From the south booth to the north one is dx=0, dz=3 -> 3.
        const [near, far] = locScene.findNearbyLocs(/^bank booth$/i, 2656, 3283, 0, 10);
        expect(near!.distance).toBe(0);
        expect(far!.distance).toBe(3);

        // A pure diagonal is max(|dx|,|dz|), not the sum.
        const diag = locScene.getLocsAt(TOLL_LEFT.x, TOLL_LEFT.z, 0);
        expect(diag.length).toBeGreaterThan(0);
        const fromDiag = locScene.findNearbyLocs(/^gate$/i, TOLL_LEFT.x - 2, TOLL_LEFT.z - 2, 0, 10);
        expect(fromDiag[0]!.distance).toBe(2);
    });

    test('results are sorted nearest-first', () => {
        const locs = locScene.getNearbyLocs(2655, 3283, 0, 15);
        expect(locs.length).toBeGreaterThan(10);
        for (let i = 1; i < locs.length; i++) {
            expect(locs[i]!.distance).toBeGreaterThanOrEqual(locs[i - 1]!.distance);
        }
    });

    test('findNearbyLoc returns the NEAREST match, not the first scanned', () => {
        const all = locScene.findNearbyLocs(/^bank booth$/i, 2656, 3286, 0, 10);
        const one = locScene.findNearbyLoc(/^bank booth$/i, 2656, 3286, 0, 10);
        expect(one!.z).toBe(3286);
        expect(one!.distance).toBe(0);
        expect(one).toEqual(all[0]!);
    });

    test('radius is inclusive and actually bounds the result', () => {
        expect(locScene.findNearbyLocs(/^bank booth$/i, 2656, 3283, 0, 3).length).toBe(2);
        expect(locScene.findNearbyLocs(/^bank booth$/i, 2656, 3283, 0, 2).length).toBe(1);
        expect(locScene.findNearbyLocs(/^bank booth$/i, 2656, 3283, 0, 0).length).toBe(1);
    });

    test('a bare string is a case-insensitive SUBSTRING, like new RegExp(pattern, "i")', () => {
        // A live example of the trap CLAUDE.md warns about. The loose pattern also drags in
        // 'Closed bank booth' (loc 2215), which is a decoration a bot can never bank at.
        const loose = locScene.findNearbyLocs('booth', 2655, 3283, 0, 10);
        expect(loose.map(l => l.name)).toEqual(['Bank booth', 'Closed bank booth', 'Bank booth']);

        const strict = locScene.findNearbyLocs(/^bank booth$/i, 2655, 3283, 0, 10);
        expect(strict.length).toBe(2);
        expect(strict.every(l => l.id === BANK_BOOTH_ID)).toBe(true);
    });

    test('no match returns null / empty, never throws', () => {
        expect(locScene.findNearbyLoc(/^definitely not a real loc$/i, LUMBRIDGE.x, LUMBRIDGE.z, 0, 15)).toBeNull();
        expect(locScene.findNearbyLocs(/^nope$/i, LUMBRIDGE.x, LUMBRIDGE.z, 0, 15)).toEqual([]);
        // Deep ocean: a coordinate with no map square at all.
        expect(locScene.getNearbyLocs(1900, 9000, 0, 15)).toEqual([]);
    });

    test('a stray /g regex does not make results depend on call order', () => {
        const g = /bank booth/gi;
        const first = locScene.findNearbyLocs(g, 2655, 3283, 0, 10);
        const second = locScene.findNearbyLocs(g, 2655, 3283, 0, 10);
        expect(second).toEqual(first);
        expect(first.length).toBe(3); // 2x 'Bank booth' + 1x 'Closed bank booth'
    });

    test('unnamed scenery is skipped by default, like the browser scene', () => {
        const named = locScene.getNearbyLocs(2655, 3283, 0, 15);
        const all = locScene.getNearbyLocs(2655, 3283, 0, 15, { includeUnnamed: true });
        expect(named.length).toBe(98);   // rev 289 (274: 95)
        expect(all.length).toBe(665);   // rev 289 (274: 664)
        expect(named.every(l => l.name !== '')).toBe(true);
    });

    test('limit caps the result after the distance sort', () => {
        const top3 = locScene.getNearbyLocs(2655, 3283, 0, 15, { limit: 3 });
        const full = locScene.getNearbyLocs(2655, 3283, 0, 15);
        expect(top3.length).toBe(3);
        expect(top3).toEqual(full.slice(0, 3));
    });

    test('queries are level-scoped', () => {
        // Lumbridge castle is three storeys; each level holds different furniture.
        const l0 = locScene.getNearbyLocs(3208, 3218, 0, 12);
        const l1 = locScene.getNearbyLocs(3208, 3218, 1, 12);
        const l2 = locScene.getNearbyLocs(3208, 3218, 2, 12);
        expect(l0.length).toBeGreaterThan(0);
        expect(l1.length).toBeGreaterThan(0);
        expect(l2.length).toBeGreaterThan(0);
        expect(l0.every(l => l.level === 0)).toBe(true);
        expect(l1.every(l => l.level === 1)).toBe(true);
        expect(l2.every(l => l.level === 2)).toBe(true);
        expect(locScene.getNearbyLocs(3208, 3218, 3, 12)).toEqual([]);
    });

    test('shape and angle survive the parse (the door tracker needs them)', () => {
        const gate = locScene.getLocsAt(TOLL_LEFT.x, TOLL_LEFT.z, 0).find(l => l.id === TOLL_LEFT.id)!;
        expect(gate.shape).toBe(0);   // shape 0 = wall
        expect(gate.angle).toBe(0);
        const booth = locScene.getLocsAt(2656, 3283, 0).find(l => l.id === BANK_BOOTH_ID)!;
        expect(booth.shape).toBe(10); // shape 10 = centrepiece
        expect(booth.angle).toBe(1);
    });
});

describe('packet-loop budget', () => {
    const budgetMs = (fn: () => unknown, iters: number): number => {
        for (let i = 0; i < 500; i++) fn();
        const t = performance.now();
        for (let i = 0; i < iters; i++) fn();
        return (performance.now() - t) / iters;
    };

    test('findNearbyLoc at r=15 is far under a millisecond', () => {
        const ms = budgetMs(() => locScene.findNearbyLoc(/^bank booth$/i, 2655, 3283, 0, 15), 20000);
        // Measured ~0.008ms. The bound is loose so a slow CI box cannot make this flaky.
        expect(ms).toBeLessThan(1);
    });

    test('getNearbyLocs at r=30 is still under a millisecond', () => {
        const ms = budgetMs(() => locScene.getNearbyLocs(LUMBRIDGE.x, LUMBRIDGE.z, 0, 30), 5000);
        expect(ms).toBeLessThan(1); // measured ~0.066ms
    });

    test('cost tracks the RADIUS, not the size of the world', () => {
        // If a query ever scanned the 816k-loc store, an empty tile would cost the same as a city
        // centre and both would be milliseconds. Bucketing keeps them proportional and tiny.
        const dense = budgetMs(() => locScene.getNearbyLocs(3364, 3412, 0, 15), 5000);
        const empty = budgetMs(() => locScene.getNearbyLocs(1900, 9000, 0, 15), 5000);
        expect(dense).toBeLessThan(1);
        expect(empty).toBeLessThan(0.05);
        expect(empty).toBeLessThan(dense);
    });

    test('a name lookup is effectively free', () => {
        const ms = budgetMs(() => locScene.locName(BANK_BOOTH_ID), 200000);
        expect(ms).toBeLessThan(0.01);
    });
});

describe('process-global singleton', () => {
    test('init() is idempotent — the second and later calls do no work', () => {
        const before = locScene.stats();
        const t = performance.now();
        locScene.init();
        locScene.init();
        locScene.init();
        const elapsed = performance.now() - t;
        // A real build is ~400ms. Repeat calls must return immediately.
        expect(elapsed).toBeLessThan(5);
        expect(locScene.stats()).toEqual(before);
        // buildMs still reports the ORIGINAL build, proving nothing was rebuilt.
        expect(locScene.stats().buildMs).toBe(before.buildMs);
    });

    test('a second import shares one index, it does not build a second copy', async () => {
        // ESM module state is per-process. Every bot importing this module gets THE SAME index —
        // which is the whole memory argument: ~7.3MB of placements once, not once per bot.
        const again = await import('../loc-scene.js');
        expect(again.isReady()).toBe(true);
        expect(again.stats()).toEqual(locScene.stats());
        // Same module namespace object, not a rebuilt clone.
        expect(again.findNearbyLoc).toBe(locScene.findNearbyLoc);
        expect(again).toBe(locScene as unknown as typeof again);
    });

    test('initAsync resolves immediately once built, and concurrent callers share one build', async () => {
        const t = performance.now();
        await Promise.all([locScene.initAsync(), locScene.initAsync(), locScene.initAsync()]);
        expect(performance.now() - t).toBeLessThan(50);
        expect(locScene.isReady()).toBe(true);
    });

    // LAST: this tears the index down, so nothing may depend on it afterwards.
    test('querying before init() throws an actionable error instead of building in the loop', () => {
        locScene.__resetForTests();
        expect(locScene.isReady()).toBe(false);
        expect(() => locScene.locName(BANK_BOOTH_ID)).toThrow(/not initialised/);
        expect(() => locScene.getNearbyLocs(2655, 3283, 0, 15)).toThrow(/not initialised/);
        expect(() => locScene.findNearbyLoc(/^tree$/i, 3222, 3218, 0, 15)).toThrow(/not initialised/);

        // ...and a rebuild from scratch reproduces the same index bit for bit.
        locScene.init();
        expect(locScene.stats().placedLocs).toBe(936653);
        expect(locScene.stats().zones).toBe(35425);
        expect(locScene.locName(TOLL_LEFT.id)).toBe('Gate');
        expect(locScene.findNearbyLocs(/^bank booth$/i, 2655, 3283, 0, 10)
            .map(l => ({ x: l.x, z: l.z }))).toEqual(ARD_SOUTH_BOOTHS);
    });
});

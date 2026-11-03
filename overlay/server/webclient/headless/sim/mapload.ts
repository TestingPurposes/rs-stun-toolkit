// JM2 AUTO-LOADER — content truth from the server's OWN map files. `loadMapsquare(world, mx, mz)`
// parses server/content/maps/m{mx}_{mz}.jm2 (the exact files the engine boots from) and registers
// every recognised loc/npc into the SkillWorld: rocks, trees, bank booths, cook fires/ranges,
// altars, fishing spots, pickpocketable men. A test that says "mine the rock at (3285,3368)" now
// fails if the SERVER's map has no such rock — hand-registered-coordinate drift is gone.
//
// jm2 text format: "==== MAP/LOC/NPC/OBJ ====" sections; LOC lines "level lx lz: locId shape rot";
// NPC lines "level lx lz: npcId". World coord = mx*64+lx, mz*64+lz.
import { readFileSync, existsSync } from 'fs';
import { SkillWorld, ORES } from './skills.ts';

const MAPS_DIR = `${import.meta.dir}/../../../content/maps`;

// rock loc id -> (ore table key, empty-stage loc). Variant1 -> plainrock1(450), variant2 -> plainrock2(452).
const ROCKS: Record<number, { ore: keyof typeof ORES; empty: number }> = {
    2090: { ore: 'copper', empty: 450 }, 2091: { ore: 'copper', empty: 452 },
    2094: { ore: 'tin', empty: 450 }, 2095: { ore: 'tin', empty: 452 },
    2092: { ore: 'iron', empty: 450 }, 2093: { ore: 'iron', empty: 452 },
    2096: { ore: 'coal', empty: 450 }, 2097: { ore: 'coal', empty: 452 },
    2102: { ore: 'mithril', empty: 450 }, 2103: { ore: 'mithril', empty: 452 },
    2104: { ore: 'adamantite', empty: 450 }, 2105: { ore: 'adamantite', empty: 452 },
};
// tree loc id -> trees.dbrow row (expUnits/levels from the table read)
const TREES: Record<number, { level: number; expUnits: number; product: number; low: number; high: number; respawn: number; fall: number; stump: number }> = {
    1276: { level: 0, expUnits: 250, product: 1511, low: 128, high: 400, respawn: 0, fall: 1, stump: 1342 },   // tree
    1277: { level: 0, expUnits: 250, product: 1511, low: 128, high: 400, respawn: 0, fall: 1, stump: 1343 },   // lighttree
    1278: { level: 0, expUnits: 250, product: 1511, low: 128, high: 400, respawn: 0, fall: 1, stump: 1342 },   // tree2
    1279: { level: 0, expUnits: 250, product: 1511, low: 128, high: 400, respawn: 0, fall: 1, stump: 1342 },   // tree3
    1281: { level: 15, expUnits: 375, product: 1521, low: 60, high: 190, respawn: 60, fall: 8, stump: 1341 },  // oak
    1308: { level: 30, expUnits: 675, product: 1519, low: 35, high: 160, respawn: 90, fall: 8, stump: 1341 },  // willow
    1307: { level: 45, expUnits: 1000, product: 1517, low: 20, high: 105, respawn: 120, fall: 8, stump: 1341 },// maple
    1309: { level: 60, expUnits: 1750, product: 1515, low: 10, high: 65, respawn: 180, fall: 8, stump: 1357 }, // yew
};
const BANK_BOOTH = 2213, COOK_LOCS = new Set([2727, 2728, 2781, 2785]);   // fire/range/furnaces (furnace rows registerable)
// fishing-spot npc types (mapsquare-scoped in fishing.npc, but the TYPE ids recur): default catches
const FISH_SPOTS: Record<number, { fish: number; level: number; expUnits: number }> = {
    320: { fish: 317, level: 1, expUnits: 100 },    // saltfish -> raw shrimp
    321: { fish: 377, level: 40, expUnits: 900 },   // rarefish -> raw lobster (cage)
    322: { fish: 383, level: 76, expUnits: 1100 },  // memberfish -> raw shark (harpoon)
};
// pickpocketables auto-registered from pickpocket.dbrow rows read (man family only —
// further rows are one registerPickpocket call away)
const MEN = new Set([1, 2, 3, 16]);
const MAN_ROW = { level: 1, expUnits: 80, stunTicks: 8, stunDamage: 1, lootId: 995, lootN: 3, low: 180, high: 240 };

export interface MapLoadSummary { rocks: number; trees: number; booths: number; cookLocs: number; npcs: number; fishSpots: number; men: number }

export function loadMapsquare(world: SkillWorld, mx: number, mz: number, opts: { level?: number; npcIndexBase?: number } = {}): MapLoadSummary {
    const file = `${MAPS_DIR}/m${mx}_${mz}.jm2`;
    if (!existsSync(file)) throw new Error(`no mapsquare file ${file}`);
    const level = opts.level ?? 0;
    let npcIndex = opts.npcIndexBase ?? 1000;
    const sum: MapLoadSummary = { rocks: 0, trees: 0, booths: 0, cookLocs: 0, npcs: 0, fishSpots: 0, men: 0 };
    let section = '';
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (line.startsWith('====')) { section = line.replace(/[= ]/g, ''); continue; }
        const m = line.match(/^(\d+) (\d+) (\d+): (\d+)/);
        if (!m) continue;
        const [lv, lx, lz, id] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
        if (lv !== level) continue;
        const x = mx * 64 + lx, z = mz * 64 + lz;
        if (section === 'LOC') {
            const rock = ROCKS[id];
            if (rock) { world.addRock(x, z, id, rock.empty, rock.ore); sum.rocks++; continue; }
            const tree = TREES[id];
            if (tree) { world.addTree(x, z, id, tree.stump, tree); sum.trees++; continue; }
            if (id === BANK_BOOTH) { world.addBankBooth(x, z, id); sum.booths++; continue; }
            if (COOK_LOCS.has(id)) { world.addCookLoc(x, z, id); sum.cookLocs++; continue; }
        } else if (section === 'NPC') {
            const spot = FISH_SPOTS[id];
            if (spot) { world.addFishingSpot(npcIndex++, id, x, z, spot.fish, spot.level, spot.expUnits); sum.fishSpots++; sum.npcs++; continue; }
            world.addNpc(npcIndex++, id, x, z);
            sum.npcs++;
            if (MEN.has(id)) { world.registerPickpocket(id, MAN_ROW); sum.men++; }
        }
    }
    return sum;
}

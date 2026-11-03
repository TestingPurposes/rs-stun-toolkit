// cd server/webclient/headless/sim && bun test quest-lostcity.test.ts      (NEVER `bun test headless/sim`)
//
// LOST CITY DRIVER (quest-lostcity.ts). Content pins (the facts the driver is built on, re-read from the .rs2/.obj/.jm2/.pack
// so a content drift breaks the test), pure tests of the step table / region model / dialog policy / text oracle, and sim
// tests of the real executors against CoopWorld: Shamus from the leprechaun tree, the Tree spirit fight + branches, carving,
// the shed door (worn staff), the ladder out, and the whole dungeon -> staff -> Zanaris -> done tail in one run.
// Walking legs on the REAL collision live in rc-cosmic-geo.test.ts (needs the pathfinder init).
import { describe, test, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoopHarness, type CoopPlayer, type CoopWorld } from './coop.js';
import { SkillWorld } from './skills.js';
import { openField } from './world.js';
import { linePath } from './harness.js';
import {
    LC_IDS, LC_STAGE, LC_LOC, LC_AT, LC_DIALOG, lcRegion, learnLcText, lcDialogPick, decideLostCity, newLcKnowledge,
    LostCityBot, driveLostCity, __lc, type LcObs, type LcKnowledge, type LcAction,
} from '../quest-lostcity.js';
import { ZANARIS, DRAMEN_STAFF } from '../zanaris.js';
import { SPIRIT, LC_TRAIN, LC_FOOD_SHARKS, LC_MIN_WIN, spiritProfile, unarmedProfile, mulberry32, type MeleeStats } from '../lostcity-spirit.js';
import { levelForDisplayedXp } from '../leanbot.js';

const CONTENT = join(import.meta.dir, '..', '..', '..', 'content');
const read = (p: string) => readFileSync(join(CONTENT, p), 'utf8');
const Q = (f: string) => read(`scripts/quests/quest_zanaris/scripts/${f}`);

// ---- content pins ----------------------------------------------------------------------------------------------
describe('content: the facts the driver is built on', () => {
    test('branch + staff are UNTRADEABLE (each crafter is its own quester); the staff wields with no requirement', () => {
        const obj = read('scripts/quests/quest_zanaris/configs/quest_zanaris.obj');
        const block = (n: string) => obj.slice(obj.indexOf(`[${n}]`), obj.indexOf('[', obj.indexOf(`[${n}]`) + 1) >>> 0 || undefined);
        expect(block('dramen_branch')).toMatch(/tradeable=no/);
        expect(block('dramen_staff')).toMatch(/tradeable=no/);
        expect(block('dramen_staff')).toMatch(/wearpos=righthand/);
        // no [opheld2,dramen_staff] level/quest gate anywhere (levelrequire/ has none)
        const lr = ['levelrequire.rs2', 'tier1.rs2', 'tier10.rs2', 'tier20.rs2', 'tier30.rs2', 'tier40.rs2', 'tier45.rs2', 'tier5.rs2', 'tier50.rs2', 'tier60.rs2', 'tier70.rs2']
            .map(f => read(`scripts/levelrequire/scripts/${f}`)).join('\n');
        expect(lr).not.toMatch(/dramen/);
    });
    test('the shed door: only a WORN staff telejumps, from OUTSIDE (check_axis false), no quest varp is checked', () => {
        const s = Q('quest_zanaris.rs2');
        const door = s.slice(s.indexOf('[oploc1,zanarisdoor]'), s.indexOf('[queue,zanaris_quest_complete]'));
        expect(door).toMatch(/if\(\$entering = false\) \{\s*if\(inv_total\(worn, dramen_staff\) > 0 & map_members = \^true\)/);
        expect(door).toContain('~player_teleport_normal(0_50_149_20_56);');   // (3220,9592)
        expect(door).not.toMatch(/%zanaris [<>]/);                            // only `= ^zanaris_staff_made` -> complete
        expect(door).toMatch(/if\(%zanaris = \^zanaris_staff_made\)/);
        const ax = read('scripts/doors/scripts/door_procs.rs2');
        expect(ax).toMatch(/case \^loc_west, \^loc_east :\s*if \(coordx\(\$coord\) = coordx\(\$loc_coord\)\)/);   // true ON the door tile
        expect(read('maps/m50_49.jm2')).toContain('0 2 33: 2406 0');           // west wall @ (3202,3169)
        expect(ZANARIS.shedStand).toEqual({ x: 3201, z: 3169 });
        expect([ZANARIS.arrival.x, ZANARIS.arrival.z]).toEqual([50 * 64 + 20, 149 * 64 + 56]);
    });
    test('the entrance-room ladder lands outside the shed door', () => {
        const l = read('scripts/ladders+stairs/scripts/ladders.rs2');
        expect(l).toMatch(/if\(loc_coord = 0_50_149_22_52\) \{ \/\/ Zanaris ladder \(entrance room\)\s*~climb_ladder\(0_50_49_1_33, true\);/);
        expect(read('maps/m50_149.jm2')).toContain('0 22 52: 1755 10');
        expect([ZANARIS.ladderLanding.x, ZANARIS.ladderLanding.z]).toEqual([50 * 64 + 1, 49 * 64 + 33]);
    });
    test('the tree: WC 36, spirit at spoken_shamus, a branch per op after; carving: Crafting 31 + knife', () => {
        const s = Q('quest_zanaris.rs2');
        expect(s).toMatch(/if\(stat\(woodcutting\) < 36\)/);
        expect(s).toMatch(/if\(%zanaris = \^zanaris_spoken_shamus\) \{\s*def_coord \$spawn = 0_44_152_44_9;/);
        expect(s).toContain('inv_add(inv, dramen_branch, 1);');
        expect(s).toMatch(/\[opheldu,dramen_branch\]\s*if\(last_useitem = knife\)/);
        expect(s).toMatch(/if\(stat\(crafting\) < 31\)/);
        expect(read('maps/m44_152.jm2')).toContain('0 44 6: 1292 10');
        expect(read('maps/m49_50.jm2')).toContain('0 2 12: 2409 10');
        expect(read('maps/m44_52.jm2')).toContain('0 4 46: 2408 10 2');
        expect(read('maps/m44_52.jm2')).toContain('0 6 46: 656');            // the cave monk on (2822,3374) — the ladder needs him there
        expect(read('maps/m49_50.jm2')).toContain('0 9 2: 650');             // the warrior
        expect(read('maps/m50_50.jm2')).toContain('0 24 2: 946 1');          // the knife spawn (3224,3202)
        const tsp = Q('tree_spirit.rs2');
        expect(tsp).toContain('%zanaris = ^zanaris_spirit_defeated;');
        expect(tsp).toContain('With the Tree Spirit defeated you can now chop the tree.');
    });
    test('the only axe on Entrana: zombies drop a bronze axe 50/128 (axes are Entrana-restricted)', () => {
        const z = read('scripts/drop tables/scripts/zombie.rs2');
        const zb = z.slice(z.indexOf('[ai_queue3,zombie_entranan]'));
        expect(zb).toMatch(/if \(\$dropint < 50\) \{\s*obj_add\(npc_coord, bronze_axe/);
        expect(read('scripts/areas/area_port_sarim/scripts/monk_of_entrana.rs2')).toMatch(/inv_totalcat\(inv, weapon_axe\)/);
        expect(read('scripts/skill_woodcutting/configs/axes/axes.obj')).toMatch(/\[bronze_axe\][\s\S]*?category=weapon_axe/);
    });
    test('pack ids', () => {
        const obj = read('pack/obj.pack'), npc = read('pack/npc.pack'), loc = read('pack/loc.pack');
        for (const [id, n] of [[771, 'dramen_branch'], [772, 'dramen_staff'], [946, 'knife'], [1351, 'bronze_axe'], [1349, 'iron_axe'], [1353, 'steel_axe'], [1355, 'mithril_axe'], [1357, 'adamant_axe'], [1359, 'rune_axe'], [1361, 'black_axe'], [385, 'shark'], [564, 'cosmicrune'], [1454, 'cosmic_talisman']] as const)
            expect(obj).toContain(`\n${id}=${n}\n`);
        for (const [id, n] of [[650, 'warrioradventurerpg'], [654, 'zanarisleprechaun'], [655, 'tree_spirit'], [656, 'cave_monk'], [76, 'zombie_entranan']] as const)
            expect(npc).toContain(`\n${id}=${n}\n`);
        for (const [id, n] of [[2406, 'zanarisdoor'], [2409, 'leprechauntree'], [1292, 'dramentree'], [2408, 'entranaladdertop'], [2407, 'zanarismagicdoor'], [1755, 'ladder_from_cellar'], [2458, 'cosmictemple_ruined'], [2484, 'cosmic_altar'], [2471, 'cosmictemple_exit_portal']] as const)
            expect(loc).toContain(`\n${id}=${n}\n`);
        expect(LC_IDS.AXES.length).toBe(7);
    });
    test('every text the oracle reads exists in the content verbatim', () => {
        const all = [Q('quest_zanaris.rs2'), Q('shamus.rs2'), Q('tree_spirit.rs2'), read('scripts/areas/area_lumbridge/scripts/warrior_zanaris.rs2'),
            read('scripts/skill_woodcutting/scripts/woodcut.rs2')].join('\n');
        for (const t of ['Hello there traveller.', 'So let me get this straight: I need to search the trees', 'Have you found anything yet?', 'Hey, thanks for all the information',
            'So a leprechaun knows where Zanaris is eh?', "Well you'll have to be catchin' me again when yer are", 'The monks are running a ship from Port Sarim to Entrana',
            'How do I get to Zanaris again?', 'The tree seems to have a ominous aura to it', 'You are not a high enough Woodcutting level to chop down this tree',
            'You do not have an axe which you have the level to use', 'With the Tree Spirit defeated you can now chop the tree', 'You cut a branch from the Dramen tree',
            'You need at least level 31 Crafting to make this into a staff', 'You carve the branch into a staff', 'Quest complete: Lost City'])
            expect(all).toContain(t);
    });
});

// ---- dialog policy against the REAL choice pages ------------------------------------------------------------------
describe('dialog policy: the right option on every decisive page, never a decline', () => {
    /** every multiN / p_choiceN option list in a script, in order */
    const choices = (src: string): string[][] => {
        const out: string[][] = [];
        for (const m of src.matchAll(/(?:@multi[23]|~p_choice[23])\(([^;]*)\);/g)) out.push([...m[1]!.matchAll(/"([^"]+)"/g)].map(x => x[1]!));
        return out;
    };
    test('warrior: camped -> think-here -> if-hidden -> "Looks like you don\'t know either." (the one that sets started)', () => {
        const w = read('scripts/areas/area_lumbridge/scripts/warrior_zanaris.rs2');
        const pages = choices(w);
        const pick = (opts: string[]) => { const re = lcDialogPick(opts); return re ? opts.find(o => re.test(o)) : null; };
        expect(pick(pages.find(p => p.includes('What are you camped here for?'))!)).toBe('What are you camped here for?');
        expect(pick(pages.find(p => p.includes("What makes you think it's out here?"))!)).toBe("What makes you think it's out here?");
        expect(pick(pages.find(p => p.includes("If it's hidden how are you planning to find it?"))!)).toBe("If it's hidden how are you planning to find it?");
        expect(pick(pages.find(p => p.includes("Looks like you don't know either."))!)).toBe("Looks like you don't know either.");
        // and that option is the one that sets the varp
        expect(w).toMatch(/Looks like you don't know either[\s\S]*?\} else if\(\$option = 2\) \{[\s\S]*?%zanaris = \^zanaris_started;/);
    });
    test('Shamus, the cave monk, the Port Sarim monk', () => {
        const sh = choices(Q('shamus.rs2'));
        expect(lcDialogPick(sh.find(p => p.includes('How does it fit in a shed then?'))!)!.test('How does it fit in a shed then?')).toBe(true);
        const cm = choices(read('scripts/areas/area_entrana/scripts/cave_monk.rs2'))[0]!;
        expect(cm).toEqual(["I don't think I'm strong enough to enter then.", 'Well that is a risk I will have to take.']);
        const re = lcDialogPick(cm)!; expect(re.test(cm[1]!)).toBe(true); expect(re.test(cm[0]!)).toBe(false);
        const pm = choices(read('scripts/areas/area_port_sarim/scripts/monk_of_entrana.rs2')).find(p => p.some(o => /ready to go/.test(o)))!;
        const r2 = lcDialogPick(pm)!; expect(pm.filter(o => r2.test(o))).toEqual(["Yes, okay, I'm ready to go."]);
    });
    test('no rule ever matches a decline / loop option', () => {
        for (const bad of ['Please tell me?', 'There\'s no such thing!', "Who's Zanaris?", "What's Zanaris?", "I don't think I'm strong enough to enter then.", 'No, not right now.', "I'm not sure."])
            expect(LC_DIALOG.some(re => re.test(bad))).toBe(false);
    });
});

// ---- region + decision -----------------------------------------------------------------------------------------
const ob = (p: { level?: number; x: number; z: number }, extra: Partial<LcObs> = {}): LcObs => {
    const pos = { level: p.level ?? 0, x: p.x, z: p.z };
    return { pos, region: lcRegion(pos.level, pos.x, pos.z), journal: 'IN_PROGRESS', staffWorn: false, staffPack: 0, branch: 0, knife: 0, axe: 0, food: 20, nonKit: 0, freeSlots: 10, pick: false, ...extra };
};
const kn = (lb: number, ub = 6, oracle = true): LcKnowledge => ({ ...newLcKnowledge(), lb, ub, oracleDone: oracle });
const name = (a: LcAction) => a.kind;
describe('region model', () => {
    test('anchors', () => {
        expect(lcRegion(0, LC_AT.WARRIOR.x, LC_AT.WARRIOR.z)).toBe('main');
        expect(lcRegion(0, LC_AT.DUNGEON.x, LC_AT.DUNGEON.z)).toBe('dungeon');
        expect(lcRegion(0, LC_AT.TREE_STAND.x, LC_AT.TREE_STAND.z)).toBe('dungeon');
        expect(lcRegion(0, LC_AT.MAGIC_DOOR_STAND.x, LC_AT.MAGIC_DOOR_STAND.z)).toBe('dungeon');
        expect(lcRegion(0, LC_AT.WILD_LANDING.x, LC_AT.WILD_LANDING.z)).toBe('wild');
        expect(lcRegion(0, LC_AT.ENT_LADDER_STAND.x, LC_AT.ENT_LADDER_STAND.z)).toBe('entrana');
        expect(lcRegion(1, 2834, 3331)).toBe('ship');
        expect(lcRegion(0, ZANARIS.arrival.x, ZANARIS.arrival.z)).toBe('zanaris');
        expect(lcRegion(0, 3203, 3168)).toBe('shed');
        expect(lcRegion(0, ZANARIS.shedStand.x, ZANARIS.shedStand.z)).toBe('main');
    });
});
describe('decideLostCity — the step table', () => {
    test('FORWARD CHAIN from a fresh account in the swamp to done', () => {
        const k = kn(-1, 6, false);
        let p: { level?: number; x: number; z: number } = LC_AT.WARRIOR;
        let ex: Partial<LcObs> = { nonKit: 3, axe: 1, pick: true };
        const seq: string[] = [];
        for (let i = 0; i < 40; i++) {
            const a = decideLostCity(ob(p, ex), k, undefined, seq.includes('restore'));
            seq.push(name(a));
            switch (a.kind) {
                case 'talkWarrior': learnLcText(k, 'Hello there traveller.'); learnLcText(k, 'So a leprechaun knows where Zanaris is eh?'); k.oracleDone = true; break;
                case 'findShamus': learnLcText(k, 'The monks are running a ship from Port Sarim to Entrana, I hear too.'); break;
                case 'getKnife': ex = { ...ex, knife: 1 }; break;
                case 'stash': ex = { ...ex, nonKit: 0, axe: 0, pick: false }; break;
                case 'sail': p = { level: 1, x: 2834, z: 3331 }; break;
                case 'disembark': p = { x: 2834, z: 3335 }; break;
                case 'enterDungeon': p = LC_AT.DUNGEON; break;
                case 'getAxe': ex = { ...ex, axe: 1 }; break;
                case 'chop': if (k.lb < LC_STAGE.SPIRIT_DEFEATED) learnLcText(k, 'With the Tree Spirit defeated you can now chop the tree.'); else ex = { ...ex, branch: (ex.branch ?? 0) + 1 }; break;
                case 'carve': ex = { ...ex, staffPack: (ex.staffPack ?? 0) + (ex.branch ?? 0), branch: 0 }; break;
                case 'exitDungeon': p = LC_AT.WILD_LANDING; ex = { ...ex, knife: 0, axe: 0, food: 0, staffWorn: true, staffPack: (ex.staffPack ?? 1) - 1 }; break;
                case 'travelHome': p = ZANARIS.shedStand; break;
                case 'enterZanaris': p = ZANARIS.arrival; learnLcText(k, 'Quest complete: Lost City'); break;
                case 'zanOut': p = ZANARIS.ladderLanding; break;
                case 'restore': ex = { ...ex, staffPack: 0, pick: true }; break;
            }
            if (a.kind === 'done' || a.kind === 'fail') break;
        }
        // a branch is carved as soon as it is held (chop #1 = the spirit, #2/#3 = branches)
        expect(seq).toEqual(['talkWarrior', 'findShamus', 'getKnife', 'stash', 'sail', 'disembark', 'enterDungeon', 'getAxe', 'chop', 'chop', 'carve',
            'chop', 'carve', 'exitDungeon', 'travelHome', 'enterZanaris', 'zanOut', 'restore', 'done']);
    });
    test('refusals and gaps fail loudly with the fix', () => {
        expect(decideLostCity(ob(LC_AT.TREE_STAND), { ...kn(2), wcLow: true })).toEqual({ kind: 'fail', why: expect.stringContaining('Woodcutting < 36') });
        expect(decideLostCity(ob(LC_AT.TREE_STAND, { branch: 1, knife: 1 }), { ...kn(3), craftLow: true })).toEqual({ kind: 'fail', why: expect.stringContaining('Crafting < 31') });
        expect(name(decideLostCity(ob(LC_AT.WARRIOR), kn(1)))).toBe('fail');                       // started, no axe for Shamus
        expect(name(decideLostCity(ob(LC_AT.WARRIOR, { axe: 1 }), kn(1)))).toBe('findShamus');
        // full pack + no knife: stash first, or getKnife waits forever on a pickup that cannot land (sim rlc1)
        expect(name(decideLostCity(ob(LC_AT.WARRIOR, { nonKit: 18, freeSlots: 0 }), kn(2)))).toBe('stash');
        expect(name(decideLostCity(ob(LC_AT.WARRIOR, { nonKit: 18, freeSlots: 1 }), kn(2)))).toBe('getKnife');
        expect(decideLostCity(ob(LC_AT.WARRIOR, { knife: 1, food: 2 }), kn(2))).toEqual({ kind: 'fail', why: expect.stringContaining('sharks') });
        expect(name(decideLostCity(ob(LC_AT.WARRIOR, { knife: 1, food: 0 }), kn(3)))).toBe('sail');   // spirit already dead: no food needed
        expect(name(decideLostCity(ob({ x: 2834, z: 3340 }, { staffPack: 1 }), kn(5)))).toBe('fail');  // on Entrana with a staff
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND), kn(-1, 1)))).toBe('fail');                // tree refuses: Shamus not spoken
    });
    test('resume from position + pack alone', () => {
        const k = newLcKnowledge();
        expect(name(decideLostCity(ob(LC_AT.WARRIOR), k))).toBe('talkWarrior');                     // unknown stage: ask the oracle
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { axe: 1 }), k))).toBe('chop');
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND), k))).toBe('getAxe');
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { staffPack: 2 }), k))).toBe('exitDungeon');
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { staffPack: 1, freeSlots: 0 }), k))).toBe('exitDungeon');
        expect(name(decideLostCity(ob(LC_AT.WILD_LANDING, { staffWorn: true }), k))).toBe('travelHome');
        expect(name(decideLostCity(ob(ZANARIS.shedStand, { staffPack: 1 }), k))).toBe('wield');
        expect(name(decideLostCity(ob(ZANARIS.shedStand, { staffWorn: true }), k))).toBe('enterZanaris');
        expect(name(decideLostCity(ob({ x: 3203, z: 3168 }), k))).toBe('shedOut');
        expect(name(decideLostCity(ob(ZANARIS.arrival, { staffWorn: true }), k))).toBe('zanOut');
        expect(name(decideLostCity(ob(ZANARIS.shedStand, { staffWorn: true, pick: true, journal: 'COMPLETE' }), k))).toBe('done');
    });
});

// ---- sim: real executors against CoopWorld ------------------------------------------------------------------
const VARP = 9147;   // the fixture's %zanaris
let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });
function simClock() {
    let waiters: Array<() => void> = [];
    const tick = () => new Promise<void>(r => waiters.push(r));
    async function pump<T>(harness: CoopHarness, p: Promise<T>, max = 1500): Promise<{ value: T | undefined; events: string[]; raw: any[] }> {
        let done = false; let value: T | undefined; const events: string[] = []; const raw: any[] = [];
        p.then(v => { done = true; value = v; }, e => { done = true; throw e; });
        for (let i = 0; i < max && !done; i++) {
            const r = await harness.tick();
            for (const e of r.events) { events.push(e.kind); raw.push(e); }
            const ws = waiters; waiters = []; ws.forEach(f => f());
            await new Promise(res => setTimeout(res, 0));
        }
        return { value, events, raw };
    }
    return { tick, pump };
}
const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
const STATS = [{ stat: 0, xp: 13_034_431, level: 99 }, { stat: 2, xp: 13_034_431, level: 99 }, { stat: 3, xp: 13_034_431, level: 99 },
    { stat: 8, xp: 25_707, level: 36 }, { stat: 12, xp: 14_833, level: 31 }, { stat: 14, xp: 13_034_431, level: 99 }];
/** the dramen tree's 2x2 footprint is solid (loc 1292 shape 10 at (2860,9734)); the rest of the fixture is open field */
const TREE_TILES = new Set(__lc.LC_TREE_FOOTPRINT.map(t => `${t.x},${t.z}`));
const treeField = () => (_l: number, x: number, z: number, dx: number, dz: number) => {
    const b = (tx: number, tz: number) => TREE_TILES.has(`${tx},${tz}`);
    return !b(x + dx, z + dz) && (dx === 0 || dz === 0 || (!b(x + dx, z) && !b(x, z + dz)));
};
/** the bot's planner over the WORLD's own collision (8-way BFS in a padded box): routes around the tree like the real one */
function bfsPlanner(w: CoopWorld) {
    return (level: number, sx: number, sz: number, dx: number, dz: number): Array<{ x: number; z: number }> => {
        if (sx === dx && sz === dz) return [{ x: sx, z: sz }];
        const M = 12, x0 = Math.min(sx, dx) - M, z0 = Math.min(sz, dz) - M, W = Math.abs(sx - dx) + 2 * M + 1, H = Math.abs(sz - dz) + 2 * M + 1;
        if (W * H > 400_000) return linePath(sx, sz, dx, dz);
        const prev = new Int32Array(W * H).fill(-1), id = (x: number, z: number) => (z - z0) * W + (x - x0);
        const q: number[] = [id(sx, sz)]; prev[id(sx, sz)] = id(sx, sz);
        for (let h = 0; h < q.length; h++) {
            const cur = q[h]!, cx = (cur % W) + x0, cz = Math.floor(cur / W) + z0;
            if (cx === dx && cz === dz) {
                const out: Array<{ x: number; z: number }> = [];
                for (let k = cur; ; k = prev[k]!) { out.push({ x: (k % W) + x0, z: Math.floor(k / W) + z0 }); if (k === prev[k]) break; }
                return out.reverse();
            }
            for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
                const nx = cx + ox, nz = cz + oz;
                if (nx < x0 || nz < z0 || nx >= x0 + W || nz >= z0 + H || prev[id(nx, nz)] !== -1 || !w.canStep(level, cx, cz, ox, oz)) continue;
                prev[id(nx, nz)] = cur; q.push(id(nx, nz));
            }
        }
        return [];
    };
}
let spiritIdx = 701;
/** the Lost City content, transcribed (each hook cites its script). `spirit`: the engine fight model's knobs. */
function lcWorld(spirit: { swings?: number; life?: number; maxHit?: number } = {}): SkillWorld {
    const w = new SkillWorld(treeField(), 8);
    w.registerFood(LC_IDS.SHARK, 20);
    w.registerEquippable(DRAMEN_STAFF, { wearpos: 'righthand' });
    // [oploc1,leprechauntree]: any axe -> Shamus spawns at (3139,3211) (npc_walk east omitted)
    w.registerLocScript({ ...LC_LOC.LEP_TREE, locId: LC_LOC.LEP_TREE.id, op: 1, reach: 2, run: (p) => {
        if (![...LC_IDS.AXES].some(a => w.invTotal(p.inv, a) > 0 || [...p.worn.values()].some(o => o.id === a))) { w.message(p, 'You do not have an axe which you have the level to use.'); return; }
        if (![...w.npcs.values()].some(n => n.typeId === LC_IDS.SHAMUS)) w.addNpc(700, LC_IDS.SHAMUS, 3139, 3211);
    } });
    // shamus.rs2 at started: p_choice2 (either) -> spoken_shamus (the sim models ONE choice page; the decisive line is on page 0)
    w.registerQuest([{ npc: LC_IDS.SHAMUS, op: 'talk', varp: VARP, whenState: LC_STAGE.STARTED, toState: LC_STAGE.SPOKEN_SHAMUS, pages: 2, choicePage: 1, choiceRoot: 2459, expectChoice: 1,
        choiceLabels: ['How does it fit in a shed then?', "I've been in that shed, I didn't see a city."], pageTexts: ['The monks are running a ship from Port Sarim to Entrana, I hear too.'] }]);
    // [oploc1,dramentree]
    w.registerLocScript({ ...LC_LOC.DRAMEN_TREE, locId: LC_LOC.DRAMEN_TREE.id, op: 1, reach: 2, run: (p) => {
        const st = w.questState(VARP);
        if (st < LC_STAGE.SPOKEN_SHAMUS) { w.message(p, 'The tree seems to have a ominous aura to it.'); return; }
        if ((p.stats.get(8)?.level ?? 1) < 36) { w.message(p, 'You are not a high enough Woodcutting level to chop down this tree.'); return; }
        if (st === LC_STAGE.SPOKEN_SHAMUS) {
            // def_coord $spawn = 0_44_152_44_9; npc_find($spawn, tree_spirit, 6, 0) = false -> npc_add($spawn, tree_spirit, 1000);
            // then ~npc_retaliate(0): the (old or new) spirit targets the chopper
            let sp = [...w.npcs.values()].find(n => n.typeId === LC_IDS.SPIRIT && Math.max(Math.abs(n.x - 2860), Math.abs(n.z - 9737)) <= 6);
            if (!sp) sp = w.addTimedNpc(spiritIdx++, LC_IDS.SPIRIT, 2860, 9737, spirit.life ?? 1000);
            w.engageNpc(sp.index, p);
            return;
        }
        w.message(p, 'You cut a branch from the Dramen tree.');
        if (st === LC_STAGE.SPIRIT_DEFEATED) w.setQuestState(VARP, LC_STAGE.TREE_CHOPPED);
        w.give(p, LC_IDS.BRANCH);
    } });
    // tree_spirit.npc: att 90 str 95 def 80 hp 85 — the ENGINE fight model (held OPNPC2, naive approach both ways, reachedEntity)
    w.registerFighter(LC_IDS.SPIRIT, { swings: spirit.swings ?? 5, maxHit: spirit.maxHit ?? 8, rate: 4 });
    // tree_spirit.rs2 [ai_queue3]: no drop; -> spirit_defeated + the mesbox line
    w.registerKillDrop(LC_IDS.SPIRIT, 0, (p) => { if (w.questState(VARP) === LC_STAGE.SPOKEN_SHAMUS) { w.setQuestState(VARP, LC_STAGE.SPIRIT_DEFEATED); w.message(p, 'With the Tree Spirit defeated you can now chop the tree.'); } });
    // zombie.rs2: a bronze axe (the sim guarantees the 50/128 roll)
    w.registerKillDrop(LC_IDS.ZOMBIE, 1351);
    // [label,cut_dramenstaff]: knife (kept) on the branch, Crafting 31
    w.combines.push({ a: LC_IDS.KNIFE, b: LC_IDS.BRANCH, product: LC_IDS.STAFF, count: 1, stat: 12, level: 31, expUnits: 0, consumeA: false,
        onMake: (p) => { w.message(p, 'You carve the branch into a staff.'); if (w.questState(VARP) === LC_STAGE.TREE_CHOPPED) w.setQuestState(VARP, LC_STAGE.STAFF_MADE); } });
    // the shed door + the ladder (zanaris.ts)
    w.registerLocScript({ ...ZANARIS.shedDoor, locId: ZANARIS.shedDoor.loc, op: 1, run: (p: CoopPlayer, ww: CoopWorld) => {
        if (p.x === ZANARIS.shedDoor.x) { p.teleport(ZANARIS.shedStand.x, ZANARIS.shedStand.z); return; }
        p.teleport(ZANARIS.shedDoor.x, ZANARIS.shedDoor.z);
        if ([...p.worn.values()].some(o => o.id === DRAMEN_STAFF)) { p.teleport(ZANARIS.arrival.x, ZANARIS.arrival.z); if (w.questState(VARP) === LC_STAGE.STAFF_MADE) { w.setQuestState(VARP, LC_STAGE.COMPLETE); ww.message(p, 'Quest complete: Lost City'); } }
    } });
    w.addPortal({ x: ZANARIS.ladder.x, z: ZANARIS.ladder.z, level: 0, locId: ZANARIS.ladder.loc, op: 1, dest: { level: 0, ...ZANARIS.ladderLanding } });
    return w;
}
function mkBot(w?: CoopWorld): LostCityBot { const b = new LostCityBot(); (b as any).exitOnStuck = false; b.findLongPathFn = w ? bfsPlanner(w) : lp; return b; }

describe('sim: driver executors', () => {
    test('findShamus: chops the leprechaun tree from (3140,3212), Shamus appears, the talk picks by label -> spoken_shamus', async () => {
        const w = lcWorld(); w.setQuestState(VARP, LC_STAGE.STARTED);
        h = new CoopHarness(w);
        const bot = mkBot();
        h.add({ bot: bot as any, name: 'lc1', index: 41, x: 3145, z: 3205, stats: STATS, worn: [{ wearpos: 'righthand', id: 1351 }] });
        await h.start();
        const clk = simClock();
        const c = __lc.makeCtx(bot, { timeoutMs: 120_000, tick: clk.tick, log: () => {} }); c.k.lb = 1; c.k.oracleDone = true;
        const { value, events, raw } = await clk.pump(h, __lc.doFindShamus(c), 600);
        expect(value).toBe(true);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPOKEN_SHAMUS);
        expect(events).not.toContain('quest-wrong-choice');
        expect(raw.find(e => e.kind === 'loc-script')!.detail).toMatchObject({ loc: 2409 });
    }, 60_000);

    test('chop: spawns the spirit, fights it, then cuts branches; carve keeps the knife', async () => {
        const w = lcWorld(); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'lc2', index: 42, x: 2850, z: 9740, stats: STATS, inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 10 }] });
        await h.start();
        const clk = simClock();
        const c = __lc.makeCtx(bot, { timeoutMs: 120_000, tick: clk.tick, log: () => {} }); c.k.lb = 2; c.k.oracleDone = true;
        const r1 = await clk.pump(h, __lc.doChop(c), 600);
        expect(r1.value).toBe(true);
        expect(r1.events).toContain('npc-killed');
        expect(c.k.lb).toBe(LC_STAGE.SPIRIT_DEFEATED);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPIRIT_DEFEATED);
        for (let i = 0; i < 2; i++) expect((await clk.pump(h, __lc.doChop(c), 300)).value).toBe(true);
        expect(h.invCount('lc2', LC_IDS.BRANCH)).toBe(2);
        expect((await clk.pump(h, __lc.doCarve(c), 300)).value).toBe(true);
        expect(h.invCount('lc2', LC_IDS.STAFF)).toBe(2);
        expect(h.invCount('lc2', LC_IDS.KNIFE)).toBe(1);
        // every chop was made from the S stand tile
        expect(h.playerOf('lc2').x).toBe(LC_AT.TREE_STAND.x); expect(h.playerOf('lc2').z).toBe(LC_AT.TREE_STAND.z);
    }, 90_000);

    // ---- the live wedge (acct5, 1.7 h at (2860,9733), "hp 79/79", a fresh spirit every ~1000 ticks) ----
    test('WEDGE REPRODUCED: from the S stand the old walk-before-op (MOVE straight at the spirit + OPNPC2) never lands a swing', async () => {
        const w = lcWorld(); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'lw1', index: 45, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: STATS, inv: [{ id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 5 }] });
        await h.start();
        const clk = simClock();
        const old = async () => {
            (bot as any).opLoc(LC_LOC.DRAMEN_TREE.x, LC_LOC.DRAMEN_TREE.z, LC_LOC.DRAMEN_TREE.id, 1);
            for (let i = 0; i < 80; i++) {
                await clk.tick();
                const sp = [...w.npcs.values()].find(n => n.typeId === LC_IDS.SPIRIT);
                if (sp && i % 4 === 0) { (bot as any).sendMove(sp.x, sp.z, true); (bot as any).opNpc(sp.index, 2); }
            }
        };
        const { raw } = await clk.pump(h, old(), 200);
        const sp = [...w.npcs.values()].find(n => n.typeId === LC_IDS.SPIRIT)!;
        expect({ x: sp.x, z: sp.z }).toEqual({ x: 2860, z: 9736 });                    // its naive chase parks it on the N face
        expect(raw.filter(e => e.kind === 'player-swing').length).toBe(0);               // ... and ours never reaches it
        expect(raw.filter(e => e.kind === 'npc-hit-player').length).toBe(0);             // nor its ours
        expect({ x: h.playerOf('lw1').x, z: h.playerOf('lw1').z }).toEqual(LC_AT.TREE_STAND);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPOKEN_SHAMUS);
    }, 60_000);

    test('chop -> spirit -> ROUTED fight (around the tree) -> defeat -> chop -> branch, from the live S stand', async () => {
        const w = lcWorld({ swings: 6, maxHit: 12 }); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'lw2', index: 46, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: STATS, inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 14 }] });
        await h.start();
        const clk = simClock();
        const logs: string[] = [];
        const c = __lc.makeCtx(bot, { timeoutMs: 120_000, tick: clk.tick, log: (s: string) => logs.push(s) }); c.k.lb = 2; c.k.oracleDone = true;
        const r1 = await clk.pump(h, __lc.doChop(c), 600);
        if (r1.value !== true) console.log(logs.join('\n'));
        expect(r1.value).toBe(true);
        const swings = r1.raw.filter(e => e.kind === 'player-swing');
        expect(swings.length).toBe(6);
        // every swing from a CARDINAL tile of the spirit, never through the tree
        for (const s of swings) expect(TREE_TILES.has(`${s.detail.at.x},${s.detail.at.z}`)).toBe(false);
        expect(swings[0]!.detail.at).not.toEqual(LC_AT.TREE_STAND);
        expect(r1.raw.some(e => e.kind === 'npc-killed' && e.detail.type === LC_IDS.SPIRIT)).toBe(true);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPIRIT_DEFEATED);
        expect(c.k.lb).toBe(LC_STAGE.SPIRIT_DEFEATED);
        expect(logs.some(l => /fighting/.test(l))).toBe(true);
        // re-chop from the stand -> a branch (the stage is past the spirit: no new spawn)
        const r2 = await clk.pump(h, __lc.doChop(c), 300);
        expect(r2.value).toBe(true);
        expect(h.invCount('lw2', LC_IDS.BRANCH)).toBe(1);
        expect(r2.raw.some(e => e.kind === 'npc-killed')).toBe(false);
        expect({ x: h.playerOf('lw2').x, z: h.playerOf('lw2').z }).toEqual(LC_AT.TREE_STAND);
        expect([...w.npcs.values()].some(n => n.typeId === LC_IDS.SPIRIT)).toBe(false);
    }, 90_000);

    test('PLANNER GAP: a planner that ignores the tree (straight lines) still gets the swings in', async () => {
        const w = lcWorld({ swings: 3 }); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        h = new CoopHarness(w);
        const bot = mkBot();   // linePath: every route "ends" on its target, through the tree included
        h.add({ bot: bot as any, name: 'lw5', index: 49, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: STATS, inv: [{ id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 6 }] });
        await h.start();
        const clk = simClock();
        const logs: string[] = [];
        const c = __lc.makeCtx(bot, { timeoutMs: 120_000, tick: clk.tick, log: (s: string) => logs.push(s) }); c.k.lb = 2; c.k.oracleDone = true;
        const r = await clk.pump(h, __lc.doChop(c), 900);
        if (r.value !== true) console.log(logs.join('\n'));
        expect(r.value).toBe(true);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPIRIT_DEFEATED);
    }, 90_000);

    test('a STALE spirit parked on the N face (left by an earlier run) is fought by its LIVE index — no second spawn', async () => {
        const w = lcWorld({ swings: 4 }); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        w.addTimedNpc(690, LC_IDS.SPIRIT, 2860, 9736, 1000);   // un-engaged, where the live one stood
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'lw3', index: 47, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: STATS, inv: [{ id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 6 }] });
        await h.start();
        const clk = simClock();
        const c = __lc.makeCtx(bot, { timeoutMs: 120_000, tick: clk.tick, log: () => {} }); c.k.lb = 2; c.k.oracleDone = true;
        const r = await clk.pump(h, __lc.doChop(c), 600);
        expect(r.value).toBe(true);
        const killed = r.raw.filter(e => e.kind === 'npc-killed');
        expect(killed.map(e => e.detail.npc)).toEqual([690]);
        expect(r.raw.filter(e => e.kind === 'player-swing').every(e => e.detail.npc === 690)).toBe(true);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPIRIT_DEFEATED);
    }, 90_000);

    test('DESPAWN mid-fight (npc_add duration): not taken as a defeat; the re-chop spawns a fresh spirit, it dies, the next chop cuts', async () => {
        // the first spirit cannot die in time (999 swings) and lives 40 ticks
        const w = lcWorld({ swings: 999, life: 40 }); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'lw4', index: 48, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: STATS, inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 10 }] });
        await h.start();
        const clk = simClock();
        const logs: string[] = [];
        const c = __lc.makeCtx(bot, { timeoutMs: 300_000, tick: clk.tick, log: (s: string) => logs.push(s) }); c.k.lb = 2; c.k.oracleDone = true;
        const r1 = await clk.pump(h, __lc.doChop(c), 400);
        expect(r1.value).toBe(false);                                                   // honest: no defeat claimed
        expect(r1.raw.some(e => e.kind === 'npc-despawned')).toBe(true);
        expect(r1.raw.filter(e => e.kind === 'player-swing').length).toBeGreaterThan(0); // it WAS reached this time
        expect(c.k.lb).toBe(LC_STAGE.SPOKEN_SHAMUS);
        expect(logs.some(l => /gone without the defeat line/.test(l))).toBe(true);
        // what the driver loop does next (decide -> 'chop' again): a fresh spirit (now killable) -> defeat -> chop -> branch
        w.registerFighter(LC_IDS.SPIRIT, { swings: 5, maxHit: 8, rate: 4 });
        const rechop = async () => { const res: boolean[] = []; for (let a = 0; a < 4 && h!.invCount('lw4', LC_IDS.BRANCH) === 0; a++) res.push(await __lc.doChop(c)); return res; };
        const r2 = await clk.pump(h, rechop(), 1200);
        if (h.invCount('lw4', LC_IDS.BRANCH) !== 1) console.log(logs.join('\n'));
        expect(r2.value).toEqual([true, true]);                                          // fight won, then the branch
        expect(r2.raw.filter(e => e.kind === 'npc-killed' && e.detail.type === LC_IDS.SPIRIT).length).toBe(1);
        expect(h.invCount('lw4', LC_IDS.BRANCH)).toBe(1);
        expect(w.questState(VARP)).toBe(LC_STAGE.TREE_CHOPPED);
    }, 180_000);

    test('THE WHOLE TAIL: dungeon (stage 2, knife + sharks) -> axe -> spirit -> 2 branches -> 2 staves -> magic door -> shed -> Zanaris -> ladder -> bank -> done', async () => {
        const w = lcWorld(); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        w.addNpc(710, LC_IDS.ZOMBIE, 2845, 9761);
        // the magic door telejumps to the deep wilderness; the fixture lands next to the shed instead (the wilderness walk is
        // a plain long travel — routed on the real collision in rc-cosmic-geo.test.ts)
        w.addPortal({ x: LC_LOC.MAGIC_DOOR.x, z: LC_LOC.MAGIC_DOOR.z, level: 0, locId: LC_LOC.MAGIC_DOOR.id, op: 1, dest: { level: 0, x: 3201, z: 3180 } });
        w.addBankBooth(LC_AT.VARROCK_E.booth.x, LC_AT.VARROCK_E.booth.z, 2213);
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'lc3', index: 43, x: LC_AT.DUNGEON.x, z: LC_AT.DUNGEON.z, stats: STATS, inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: LC_IDS.SHARK, count: 12 }] });
        h.playerOf('lc3').bank.set(1275, 1);   // the rune pickaxe the stash banked
        await h.start();
        const clk = simClock();
        let saved = -1;
        const logs: string[] = []; const { value, raw } = await clk.pump(h, driveLostCity(bot, { timeoutMs: 600_000, tick: clk.tick, log: (s: string) => logs.push(s), store: { load: () => ({ lb: 2 }), save: k => { saved = k.lb; } } }), 4000);
        if (value !== true || !h.playerOf('lc3').bank.get(DRAMEN_STAFF)) console.log(logs.join('\n'));
        expect(value).toBe(true);
        expect(w.questState(VARP)).toBe(LC_STAGE.COMPLETE);
        const P = h.playerOf('lc3');
        expect([...P.worn.values()].map(o => o.id)).toEqual([DRAMEN_STAFF]);   // one staff worn ...
        expect(P.bank.get(DRAMEN_STAFF)).toBe(1);                                // ... the spare banked
        expect(h.invCount('lc3', 1275)).toBe(1);                                 // pickaxe back for the solo crafter
        expect(h.invCount('lc3', LC_IDS.SHARK)).toBe(0);                         // stripped before the wilderness
        expect(saved).toBe(LC_STAGE.COMPLETE);
        const kinds = raw.map(e => e.kind);
        expect(kinds).toContain('npc-killed');
        expect(raw.filter(e => e.kind === 'loc-script' && e.detail.loc === ZANARIS.shedDoor.loc).length).toBe(1);   // one door op, from outside
        expect(raw.filter(e => e.kind === 'portal-climbed' && e.detail.from.x === ZANARIS.ladder.x).length).toBe(1);
    }, 240_000);

    test('shed door WITHOUT the staff worn: put into the shed, and shedOut gets back out', async () => {
        const w = lcWorld();
        h = new CoopHarness(w);
        const bot = mkBot();
        h.add({ bot: bot as any, name: 'lc4', index: 44, x: 3202, z: 3168, stats: STATS });
        await h.start();
        const clk = simClock();
        const c = __lc.makeCtx(bot, { timeoutMs: 60_000, tick: clk.tick, log: () => {} });
        expect((await clk.pump(h, __lc.doShedOut(c), 100)).value).toBe(true);
        expect({ x: h.playerOf('lc4').x, z: h.playerOf('lc4').z }).toEqual(ZANARIS.shedStand);
    }, 60_000);
});

// ---- THE TREE SPIRIT ON THE NUMBERS ( both live questers lost — str/def 26, 12 sharks, login style accurate) ----
// The pure gate (decideLostCity over obs.spiritWin) and the sim fight on the rev-289 rolls (CoopWorld registerFighter
// `combat` + the eat-delay model + com_mode from the style buttons). The odds themselves: sim/lostcity-spirit.test.ts.
describe('decideLostCity — the spirit gate', () => {
    test('dungeon, spirit still due: a losing pack walks OUT (magic door); a winning one chops; past the spirit no gate', () => {
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { axe: 1, knife: 1, food: 0, spiritWin: 0, spiritWinFull: 0.9 }), kn(2)))).toBe('retreat');
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { axe: 0, food: 3, spiritWin: 0.2 }), kn(2)))).toBe('retreat');   // before the zombies too
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { axe: 1, food: 18, spiritWin: 0.95 }), kn(2)))).toBe('chop');
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { axe: 1, food: 0, spiritWin: 0 }), kn(3)))).toBe('chop');   // spirit dead: branches
        expect(name(decideLostCity(ob(LC_AT.TREE_STAND, { axe: 1, food: 0 }), kn(2)))).toBe('chop');                // unknown odds: unchanged
    });
    test('mainland, before the boat: sail only on the numbers; RESTOCK when food would do, TRAIN when even a full pack loses', () => {
        const base = { knife: 1, nonKit: 0 };
        expect(name(decideLostCity(ob(LC_AT.WARRIOR, { ...base, food: 20, spiritWin: 0.999, spiritWinFull: 1 }), kn(2)))).toBe('sail');
        const restock = decideLostCity(ob(LC_AT.WARRIOR, { ...base, food: 12, spiritWin: 0.9, spiritWinFull: 0.999 }), kn(2));
        expect(restock).toEqual({ kind: 'fail', why: expect.stringMatching(/^restock: 12 sharks/) });
        const train = decideLostCity(ob(LC_AT.WARRIOR, { ...base, food: 12, spiritWin: 0.003, spiritWinFull: 0.6 }), kn(2));
        expect(train).toEqual({ kind: 'fail', why: expect.stringMatching(/^train: .*full pack/) });
        expect(decideLostCity(ob(LC_AT.WARRIOR, { ...base, food: 10 }), kn(2))).toEqual({ kind: 'fail', why: expect.stringMatching(/^restock: 10 sharks \(min 14\)/) });
        expect(name(decideLostCity(ob(LC_AT.WARRIOR, { ...base, food: 0, spiritWin: 0 }), kn(3)))).toBe('sail');   // spirit already dead
    });
});

const xpOf = (lvl: number) => { let acc = 0; for (let l = 1; l < lvl; l++) acc += Math.floor(l + Math.pow(2, l / 10) * 300); return Math.floor(acc / 4); };
const meleeStats = (s: MeleeStats) => [
    { stat: 0, xp: xpOf(s.att), level: s.att }, { stat: 1, xp: xpOf(s.def), level: s.def }, { stat: 2, xp: xpOf(s.str), level: s.str },
    { stat: 3, xp: xpOf(s.hp), level: s.hp }, { stat: 8, xp: 25_707, level: 36 }, { stat: 12, xp: 14_833, level: 31 }];
const LIVE_4RQ: MeleeStats = { att: 95, str: 26, def: 26, hp: 79 };
const TRAINED_4RQ: MeleeStats = { ...LIVE_4RQ, str: LC_TRAIN.str, def: LC_TRAIN.def };
/** lcWorld with the spirit on the 289 rolls (hp 85, its own rolls), consume.rs2's eat delay, a seeded world rng */
function lcCombatWorld(seed: number): SkillWorld {
    const w = lcWorld();
    w.registerFighter(LC_IDS.SPIRIT, { swings: 1_000_000, rate: 4, combat: { ...spiritProfile(), hp: SPIRIT.hp, regenTicks: SPIRIT.regenTicks } });
    w.eatDelayModel = true;
    w.rng = mulberry32(seed);
    return w;
}

describe('sim: the spirit fight on the 289 rolls', () => {
    test('xp helper = the driver level reading', () => {
        for (const l of [26, 45, 79, 95, 99]) expect(levelForDisplayedXp(xpOf(l))).toBe(l);
    });
    test('LIVE REPRODUCED: str/def 26, 12 sharks — the fight is lost (out of food), and the driver then WALKS OUT instead of failing', async () => {
        const w = lcCombatWorld(11); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        w.addPortal({ x: LC_LOC.MAGIC_DOOR.x, z: LC_LOC.MAGIC_DOOR.z, level: 0, locId: LC_LOC.MAGIC_DOOR.id, op: 1, dest: { level: 0, ...LC_AT.WILD_LANDING } });
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'sp1', index: 51, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: meleeStats(LIVE_4RQ), inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 12 }] });
        await h.start();
        const clk = simClock();
        const logs: string[] = [];
        const c = __lc.makeCtx(bot, { timeoutMs: 600_000, tick: clk.tick, log: (s: string) => logs.push(s) }); c.k.lb = 2; c.k.oracleDone = true;
        // the OLD order of events (no gate): chop -> fight -> out of food -> fled
        const r1 = await clk.pump(h, __lc.doChop(c), 1500);
        if (r1.value !== false) console.log(logs.join('\n'));
        expect(r1.value).toBe(false);
        expect(logs.some(l => /out of food/.test(l))).toBe(true);
        expect(r1.raw.some(e => e.kind === 'npc-killed')).toBe(false);
        expect(r1.raw.some(e => e.kind === 'style-set')).toBe(true);
        expect(h.invCount('sp1', LC_IDS.SHARK)).toBe(0);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPOKEN_SHAMUS);
        // the driver now: P(win) with 0 sharks -> retreat by the magic door (no 8 failed chops, no lcq=fail)
        const inDungeon = () => lcRegion(0, h!.playerOf('sp1').x, h!.playerOf('sp1').z) === 'dungeon';
        const r2 = await clk.pump(h, driveLostCity(bot, { timeoutMs: 600_000, tick: clk.tick, log: (s: string) => logs.push(s), shouldStop: () => !inDungeon(), store: { load: () => ({ lb: 2 }), save: () => {} } }), 1500);
        if (inDungeon()) console.log(logs.join('\n'));
        expect(r2.value).toBe(false);   // stopped (left the dungeon), not a FAIL
        expect(inDungeon()).toBe(false);
        expect(logs.some(l => /-> retreat/.test(l))).toBe(true);
        expect(logs.some(l => /did not succeed \(8\)|FAIL/.test(l))).toBe(false);
        expect(r2.raw.filter(e => e.kind === 'loc-script' && e.detail.loc === LC_LOC.DRAMEN_TREE.id).length).toBe(0);   // never re-spawned it
    }, 240_000);

    test('the same account arriving with 12 sharks never spawns the spirit: retreat straight away (P(win) < the dungeon gate)', async () => {
        const w = lcCombatWorld(12); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        w.addPortal({ x: LC_LOC.MAGIC_DOOR.x, z: LC_LOC.MAGIC_DOOR.z, level: 0, locId: LC_LOC.MAGIC_DOOR.id, op: 1, dest: { level: 0, ...LC_AT.WILD_LANDING } });
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: 'sp2', index: 52, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: meleeStats(LIVE_4RQ), inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: 12 }] });
        await h.start();
        const clk = simClock();
        const logs: string[] = [];
        const inDungeon = () => lcRegion(0, h!.playerOf('sp2').x, h!.playerOf('sp2').z) === 'dungeon';
        const r = await clk.pump(h, driveLostCity(bot, { timeoutMs: 600_000, tick: clk.tick, log: (s: string) => logs.push(s), shouldStop: () => !inDungeon(), store: { load: () => ({ lb: 2 }), save: () => {} } }), 800);
        if (inDungeon()) console.log(logs.join('\n'));
        expect(inDungeon()).toBe(false);
        expect(r.raw.some(e => e.kind === 'loc-script' && e.detail.loc === LC_LOC.DRAMEN_TREE.id)).toBe(false);
        expect(h.invCount('sp2', LC_IDS.SHARK)).toBe(12);   // nothing fed to a fight it would lose
    }, 120_000);

    for (const seed of [1, 2, 3, 4, 5]) test(`THE PLAN WINS (seed ${seed}): str/def ${LC_TRAIN.str}, ${LC_FOOD_SHARKS} sharks, aggressive set + verified -> spirit_defeated with sharks to spare`, async () => {
        const w = lcCombatWorld(seed); w.setQuestState(VARP, LC_STAGE.SPOKEN_SHAMUS);
        h = new CoopHarness(w);
        const bot = mkBot(w);
        h.add({ bot: bot as any, name: `sw${seed}`, index: 60 + seed, x: LC_AT.TREE_STAND.x, z: LC_AT.TREE_STAND.z, stats: meleeStats(TRAINED_4RQ), inv: [{ id: LC_IDS.KNIFE, count: 1 }, { id: 1351, count: 1 }, { id: LC_IDS.SHARK, count: LC_FOOD_SHARKS }] });
        await h.start();
        const clk = simClock();
        const logs: string[] = [];
        const c = __lc.makeCtx(bot, { timeoutMs: 600_000, tick: clk.tick, log: (s: string) => logs.push(s) }); c.k.lb = 2; c.k.oracleDone = true;
        await clk.pump(h, (async () => { for (let i = 0; i < 3; i++) await clk.tick(); })(), 10);   // stats on the wire
        expect(__lc.obs(c).spiritWin!).toBeGreaterThanOrEqual(LC_MIN_WIN);
        const r = await clk.pump(h, __lc.doChop(c), 1500);
        if (r.value !== true) console.log(logs.join('\n'));
        expect(r.value).toBe(true);
        expect(w.questState(VARP)).toBe(LC_STAGE.SPIRIT_DEFEATED);
        const swings = r.raw.filter(e => e.kind === 'player-swing');
        const dealt = swings.reduce((n, e) => n + (e.detail.dmg ?? 0), 0);
        expect(dealt).toBeGreaterThanOrEqual(SPIRIT.hp);                                                // killed on the rolls, not a swing count
        expect(swings.filter(e => e.detail.style === 1).length).toBeGreaterThan(swings.length * 0.8);   // aggressive (com_mode 1) once confirmed
        expect(swings.some(e => (e.detail.dmg ?? 0) > unarmedProfile(TRAINED_4RQ, 'accurate').maxHit)).toBe(true);   // the max-6 hits land
        const left = h.invCount(`sw${seed}`, LC_IDS.SHARK);
        console.log(`[spirit-sim] seed ${seed}: won with ${left}/${LC_FOOD_SHARKS} sharks left, ${swings.length} swings`);
        expect(left).toBeGreaterThanOrEqual(2);
    }, 240_000);
});

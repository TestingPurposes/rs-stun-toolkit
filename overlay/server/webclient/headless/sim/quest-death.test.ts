// cd server/webclient/headless/sim && bun test quest-death.test.ts
//
// DEATH PLATEAU — the PURE half of quest-death.ts, plus every id / coordinate / option string pinned against the
// CONTENT it was transcribed from (packs, jm2 maps, .rs2 scripts), so a content edit fails a test instead of a quester.
// The sim half (dialog step + ball placement through CoopHarness) is quest-death-sim.test.ts.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    DP_OBJ, DP_NPC, DP_LOC, DP_IF, DP_PLACES, DP_DOORS, DP_WANT, EXIT_OPTIONS, EQ, MAP, SCOUT_TILE, SCOUT_ZONE,
    BALL_TARGETS, BALL_SPAWNS, P_WIN, MAX_BET, nextBet, applyRoll, coinsForLosses, planBalls, nextAction, applyText,
    floorFromInventory, freshKnowledge, pocketOf, TEXT_FACTS, NoProgressGuard, progressSignature, talkMayGrant, DP_JUNK,
    type DpKnowledge, type BallView,
} from '../quest-death.js';

const CONTENT = join(import.meta.dir, '..', '..', '..', 'content');
const read = (p: string) => readFileSync(join(CONTENT, p), 'utf8');
const QD = (f: string) => read(join('scripts', 'quests', 'quest_death', 'scripts', f));
function packIds(pack: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of read(join('pack', pack)).split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) m.set(line.slice(i + 1).trim(), Number(line.slice(0, i))); }
    return m;
}
/** jm2 section rows: "level lx lz: id [shape [angle]]" -> world coords */
function jm2(map: string, section: 'NPC' | 'LOC' | 'OBJ'): Array<{ level: number; x: number; z: number; id: number; rest: number[] }> {
    const [mx, mz] = map.split('_').map(Number) as [number, number];
    const text = read(join('maps', `m${map}.jm2`));
    const start = text.indexOf(`==== ${section} ====`);
    const out: Array<{ level: number; x: number; z: number; id: number; rest: number[] }> = [];
    if (start < 0) return out;
    for (const line of text.slice(start).split(/\r?\n/).slice(1)) {
        if (line.startsWith('====')) break;
        const m = /^(\d+) (\d+) (\d+): (\d+)(.*)$/.exec(line.trim());
        if (m) out.push({ level: +m[1]!, x: mx * 64 + +m[2]!, z: mz * 64 + +m[3]!, id: +m[4]!, rest: m[5]!.trim().split(/\s+/).filter(Boolean).map(Number) });
    }
    return out;
}
const pack = (counts: Record<number, number>) => (obj: number) => counts[obj] ?? 0;
const K = (p: Partial<DpKnowledge>): DpKnowledge => ({ ...freshKnowledge(), ...p });

describe('ids match the packs', () => {
    test('objs', () => {
        const o = packIds('obj.pack');
        expect(o.get('coins')).toBe(DP_OBJ.COINS); expect(o.get('trout')).toBe(DP_OBJ.TROUT); expect(o.get('bread')).toBe(DP_OBJ.BREAD);
        expect(o.get('iron_bar')).toBe(DP_OBJ.IRON_BAR); expect(o.get('asgarnian_ale')).toBe(DP_OBJ.ASGARNIAN_ALE); expect(o.get('shark')).toBe(DP_OBJ.SHARK);
        expect(o.get('steel_claws')).toBe(DP_OBJ.STEEL_CLAWS);
        expect(o.get('death_combination')).toBe(DP_OBJ.COMBINATION); expect(o.get('death_iou')).toBe(DP_OBJ.IOU);
        expect(o.get('death_secretwaymap')).toBe(DP_OBJ.SECRET_MAP); expect(o.get('death_climbingboots')).toBe(DP_OBJ.CLIMBING_BOOTS);
        expect(o.get('death_spikedboots')).toBe(DP_OBJ.SPIKED_BOOTS); expect(o.get('death_entrancecert')).toBe(DP_OBJ.CERTIFICATE);
        expect(o.get('death_cannonball_red')).toBe(DP_OBJ.BALL_RED); expect(o.get('death_cannonball_blue')).toBe(DP_OBJ.BALL_BLUE);
        expect(o.get('death_cannonball_yellow')).toBe(DP_OBJ.BALL_YELLOW); expect(o.get('death_cannonball_purple')).toBe(DP_OBJ.BALL_PURPLE);
        expect(o.get('death_cannonball_green')).toBe(DP_OBJ.BALL_GREEN);
    });
    test('npcs / locs / interfaces', () => {
        const n = packIds('npc.pack');
        expect(n.get('death_ig_commander')).toBe(DP_NPC.DENULTH); expect(n.get('death_hermit')).toBe(DP_NPC.SABA);   // rev 289 renamed death_saba -> death_hermit (id 1070 unchanged; the script file is still death_saba.rs2)
        expect(n.get('death_sherpa')).toBe(DP_NPC.TENZING); expect(n.get('death_guard_equiproom')).toBe(DP_NPC.HAROLD);
        expect(n.get('death_barman')).toBe(DP_NPC.TOSTIG); expect(n.get('death_headservant')).toBe(DP_NPC.EOHRIC); expect(n.get('death_smithy')).toBe(DP_NPC.DUNSTAN);
        const l = packIds('loc.pack');
        expect(l.get('death_stone_mechanism_corner')).toBe(DP_LOC.MECH_CORNER); expect(l.get('death_stone_mechanism_side')).toBe(DP_LOC.MECH_SIDE);
        expect(l.get('death_hermitcave_entrance')).toBe(DP_LOC.CAVE_ENTRANCE); expect(l.get('death_hermitcave_exit')).toBe(DP_LOC.CAVE_EXIT);
        expect(l.get('death_castledoor')).toBe(DP_LOC.CASTLE_DOOR); expect(l.get('death_sherpa_door')).toBe(DP_LOC.SHERPA_DOOR);
        expect(l.get('death_sherpa_backdoor')).toBe(DP_LOC.SHERPA_BACKDOOR); expect(l.get('death_harold_door')).toBe(DP_LOC.HAROLD_DOOR);
        expect(l.get('death_fullstyle')).toBe(DP_LOC.STILE);
        const i = packIds('interface.pack');
        expect(i.get('death_dice')).toBe(DP_IF.DICE_ROOT); expect(i.get('death_dice:com_28')).toBe(DP_IF.DICE_ROLL);
        expect(i.get('death_dice:com_30')).toBe(DP_IF.DICE_CONTINUE); expect(i.get('death_dice:com_33')).toBe(DP_IF.DICE_STATUS);
        expect(i.get('questlist:death')).toBe(DP_IF.JOURNAL); expect(i.get('shop_template')).toBe(DP_IF.SHOP_MAIN);
        // com_28 is the clickable "Roll Dice!" (buttontype=normal), com_30 the pause button
        const ifsrc = read(join('scripts', 'quests', 'quest_death', 'interfaces', 'death_dice.if'));
        expect(ifsrc).toMatch(/\[com_28\][\s\S]*?buttontype=normal[\s\S]*?text=Roll Dice!/);
        expect(ifsrc).toMatch(/\[com_30\][\s\S]*?buttontype=pause/);
    });
});

describe('placements match the jm2 maps', () => {
    const npcAt = (map: string, id: number) => jm2(map, 'NPC').filter(r => r.id === id);
    test('NPC spawns (level, x, z)', () => {
        const at = (map: string, id: number, p: { level: number; x: number; z: number }) => expect(npcAt(map, id).map(r => ({ level: r.level, x: r.x, z: r.z }))).toContainEqual({ level: p.level, x: p.x, z: p.z });
        at('45_55', DP_NPC.DENULTH, DP_PLACES.DENULTH);
        at('45_55', DP_NPC.EOHRIC, DP_PLACES.EOHRIC);       // level 1
        at('45_55', DP_NPC.HAROLD, DP_PLACES.HAROLD);       // level 1
        at('45_55', DP_NPC.TOSTIG, DP_PLACES.TOSTIG);
        at('45_55', DP_NPC.DUNSTAN, DP_PLACES.DUNSTAN);
        at('44_55', DP_NPC.TENZING, DP_PLACES.TENZING);
        at('35_74', DP_NPC.SABA, DP_PLACES.SABA);
    });
    test('quest locs (doors, cave, stile, mechanisms)', () => {
        const locs = [...jm2('44_55', 'LOC'), ...jm2('45_55', 'LOC'), ...jm2('35_74', 'LOC')];
        const has = (id: number, level: number, x: number, z: number) => expect(locs.some(r => r.id === id && r.level === level && r.x === x && r.z === z)).toBe(true);
        for (const d of Object.values(DP_DOORS)) has(d.loc.id, d.level, d.loc.x, d.loc.z);
        for (const t of BALL_TARGETS) has(t.locId, 0, t.x, t.z);
    });
    test('the five stone balls spawn as ground objs in the castle courtyard', () => {
        const objs = jm2('45_55', 'OBJ');
        for (const [obj, s] of Object.entries(BALL_SPAWNS)) expect(objs.some(r => r.id === Number(obj) && r.level === 0 && r.x === s.x && r.z === s.z)).toBe(true);
    });
    test('script teleports: cave entrance lands in the cave, the exit lands outside', () => {
        const src = QD('quest_death.rs2');
        expect(src).toMatch(/\[oploc1,death_hermitcave_entrance\][\s\S]*?p_teleport\(0_35_74_29_16\)/);   // (2269,4752)
        expect(src).toMatch(/\[oploc1,death_hermitcave_exit\][\s\S]*?p_teleport\(0_44_55_42_57\)/);        // (2858,3577)
        expect(pocketOf(0, 35 * 64 + 29, 74 * 64 + 16)).toBe('cave');
        expect(pocketOf(0, 44 * 64 + 42, 55 * 64 + 57)).toBeNull();
        expect(src).toMatch(/\[zone,0_44_56_48_24\]/);
        expect(SCOUT_ZONE.x0 as number).toBe(44 * 64 + 48); expect(SCOUT_ZONE.z0 as number).toBe(56 * 64 + 24);
        expect(SCOUT_TILE.x >= SCOUT_ZONE.x0 && SCOUT_TILE.x <= SCOUT_ZONE.x1 && SCOUT_TILE.z >= SCOUT_ZONE.z0 && SCOUT_TILE.z <= SCOUT_ZONE.z1).toBe(true);
        expect(pocketOf(0, SCOUT_TILE.x, SCOUT_TILE.z)).toBe('north');
    });
});

describe('the stone-ball puzzle', () => {
    test('the targets are the tiles the unlock check reads', () => {
        const src = QD('quest_death.rs2');
        const want: Record<string, number> = { blue: DP_OBJ.BALL_BLUE, yellow: DP_OBJ.BALL_YELLOW, red: DP_OBJ.BALL_RED, purple: DP_OBJ.BALL_PURPLE, green: DP_OBJ.BALL_GREEN };
        const re = /obj_find\(0_45_55_(\d+)_(\d+), death_cannonball_(\w+)\)/g;
        let n = 0;
        for (const m of src.matchAll(re)) {
            if (src.slice(Math.max(0, m.index! - 200), m.index!).includes('loc_coord')) { /* the "already a ball" guard uses loc_coord */ }
            const x = 45 * 64 + Number(m[1]), z = 55 * 64 + Number(m[2]);
            const t = BALL_TARGETS.find(b => b.x === x && b.z === z);
            expect(t?.obj).toBe(want[m[3]!]);
            n++;
        }
        expect(n).toBe(5);
    });
    test('the targets satisfy the combination text', () => {
        const src = QD('quest_death.rs2');
        const pos = (o: number) => BALL_TARGETS.find(b => b.obj === o)!;
        const name: Record<string, number> = { Red: DP_OBJ.BALL_RED, Blue: DP_OBJ.BALL_BLUE, Yellow: DP_OBJ.BALL_YELLOW, Purple: DP_OBJ.BALL_PURPLE, Green: DP_OBJ.BALL_GREEN };
        const clues = [...src.matchAll(/"(\w+) is (North|South|East|West) of (\w+)\."/g)];
        expect(clues.length).toBe(5);
        for (const [, a, dir, b] of clues) {
            const A = pos(name[a!]!), B = pos(name[b!]!);
            const d = { North: [0, 1], South: [0, -1], East: [1, 0], West: [-1, 0] }[dir!]!;
            expect({ clue: `${a} ${dir} ${b}`, dx: A.x - B.x, dz: A.z - B.z }).toEqual({ clue: `${a} ${dir} ${b}`, dx: d[0], dz: d[1] });
        }
    });
    test('every stand tile is CARDINAL to its mechanism, and not a mechanism itself', () => {
        for (const t of BALL_TARGETS) {
            expect(Math.abs(t.stand.x - t.x) + Math.abs(t.stand.z - t.z)).toBe(1);
            expect(BALL_TARGETS.some(o => o.x === t.stand.x && o.z === t.stand.z)).toBe(false);
        }
    });
    const view = (ground: Array<[number, number, number]>, held: Record<number, number> = {}): BallView => ({
        onTile: (x, z) => ground.filter(g => g[0] === x && g[1] === z).map(g => g[2]),
        held: o => held[o] ?? 0,
    });
    test('planBalls: fetch, place, clear a wrong ball, done', () => {
        const blue = BALL_TARGETS[0]!;
        let a = planBalls(view([]));
        expect(a).toMatchObject({ kind: 'take', obj: DP_OBJ.BALL_BLUE, x: 2893, z: 3564 });                 // its spawn
        a = planBalls(view([], { [DP_OBJ.BALL_BLUE]: 1 }));
        expect(a).toMatchObject({ kind: 'place', obj: DP_OBJ.BALL_BLUE });
        if (a.kind === 'place') { expect(a.target).toBe(blue); expect(a.target.stand).toEqual({ x: 2893, z: 3562 }); }
        // a red ball sitting on BLUE's tile is lifted first, from blue's stand tile
        a = planBalls(view([[2894, 3562, DP_OBJ.BALL_RED]]));
        expect(a).toMatchObject({ kind: 'take', obj: DP_OBJ.BALL_RED, x: 2894, z: 3562, stand: { x: 2893, z: 3562 } });
        // blue placed -> next missing (yellow), fetched from ITS spawn
        a = planBalls(view([[2894, 3562, DP_OBJ.BALL_BLUE]]));
        expect(a).toMatchObject({ kind: 'take', obj: DP_OBJ.BALL_YELLOW, x: 2893, z: 3561 });
        const all = BALL_TARGETS.map(t => [t.x, t.z, t.obj] as [number, number, number]);
        expect(planBalls(view(all))).toEqual({ kind: 'all-placed' });
    });
});

describe('the dice', () => {
    test('P_WIN is P(2d6 > 2d6), ties lose', () => {
        let win = 0, n = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) { n++; if (a + b > c + d) win++; }
        expect(win / n).toBeCloseTo(P_WIN, 12);
        expect(P_WIN).toBeLessThan(0.5);
    });
    test('the script rules the strategy rests on', () => {
        const src = QD('death_guard_equiproom.rs2');
        expect(src).toMatch(/if\(\$entered_value > 1000\)/);                                         // max bet
        expect(src).toMatch(/if\(calc\(~death_get_haroldgold - ~death_get_bet\) < 0\) \{\s*%death_bits = setbit\(%death_bits, \^harold_lostall\)/);
        expect(src).toMatch(/~death_get_playerroll > ~death_get_haroldroll/);                       // strictly greater: ties lose
        expect(QD('death_ig_commander.rs2')).toMatch(/~death_set_haroldgold\(100\)/);               // the starting purse
        expect(MAX_BET).toBe(1000);
    });
    test('nextBet: purse+1 while the purse is under 1000', () => {
        expect(nextBet(100, 2000)).toMatchObject({ bet: 101, winsIou: true });
        expect(nextBet(201, 2000)).toMatchObject({ bet: 202, winsIou: true });
        expect(nextBet(999, 1000)).toMatchObject({ bet: 1000, winsIou: true });
        expect(nextBet(403, 300)).toBeNull();          // cannot afford the plan -> stop, never a sub-purse bet with our last coins
        expect(nextBet(100, 0)).toBeNull();
    });
    test('nextBet: bold play down to 999 when the purse is out of reach', () => {
        expect(nextBet(1615, 5000)).toMatchObject({ bet: 616, winsIou: false });
        expect(applyRoll(1615, 616, 'win')).toBe(999);
        expect(nextBet(999, 5000)).toMatchObject({ bet: 1000, winsIou: true });
        expect(nextBet(5000, 5000)).toMatchObject({ bet: 1000, winsIou: false });
        expect(nextBet(null, 700)).toMatchObject({ bet: 700 });
    });
    test('applyRoll tracks the purse (capped at 10000), the IOU empties it', () => {
        expect(applyRoll(100, 101, 'lose')).toBe(201);
        expect(applyRoll(9500, 1000, 'lose')).toBe(10000);
        expect(applyRoll(500, 200, 'win')).toBe(300);
        expect(applyRoll(100, 101, 'iou')).toBe(0);
        expect(applyRoll(null, 101, 'lose')).toBeNull();
    });
    test('funding: the 2000-coin kit survives 4 straight losses (101+202+404+808)', () => {
        expect(coinsForLosses(100, 4)).toBe(1515);
        expect(coinsForLosses(100, 5)).toBe(1515 + 616);
        // P(the IOU within the first 4 rolls) with purse+1 betting
        expect(1 - (1 - P_WIN) ** 4).toBeGreaterThan(0.9);
    });
});

describe('knowledge from text', () => {
    // pull the real strings out of the scripts so a reworded line breaks HERE
    const line = (file: string, needle: string) => {
        const src = QD(file);
        const m = new RegExp(`"(?:<p,\\w+>)?([^"]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`).exec(src);
        expect(m).not.toBeNull();
        return m![1]!;
    };
    const cases: Array<[string, string, Partial<DpKnowledge>]> = [
        ['death_headservant.rs2', 'Harold is staying at the Toad and Chicken.', { equip: 20 }],
        ['death_headservant.rs2', 'Harold is staying at the local inn', { equip: 20 }],
        ['death_guard_equiproom.rs2', "I don't want to talk about it!", { equip: 30 }],
        ['death_headservant.rs2', "Perhaps he'd open up after a drink?", { equip: 40 }],
        ['death_guard_equiproom.rs2', 'You give Harold an Asgarnian Ale.', { equip: 50 }],
        ['death_guard_equiproom.rs2', "I've run out of money!", { equip: 55 }],
        ['quest_death.rs2', 'You have found the combination!', { equip: 60 }],
        ['quest_death.rs2', 'The equipment room door has unlocked.', { equip: 70 }],
        ['death_saba.rs2', "Perhaps he'd know another way.", { map: 1 }],
        ['death_sherpa.rs2', 'Tenzing has given you his climbing boots.', { map: 2 }],
        ['death_smithy.rs2', "You'll need to bring an Iron bar for the spikes!", { map: 3 }],
        ['death_ig_commander.rs2', 'Denulth has given you a certificate.', { map: 4 }],
        ['death_smithy.rs2', 'You give Dunstan the certificate.', { map: 5 }],
        ['death_sherpa.rs2', 'You give Tenzing the Spiked boots.', { map: 6 }],
        ['death_sherpa.rs2', 'Tenzing has given you a map of the secret way!', { map: 7 }],
        ['quest_death.rs2', 'You can see that there are no trolls on the secret path.', { map: 8 }],
        ['death_ig_commander.rs2', 'You give Denulth the map of the secret way.', { mapGiven: true }],
        ['death_ig_commander.rs2', 'Well done citizen! We will reward you by training you in attack!', { complete: true }],
    ];
    for (const [file, needle, want] of cases) {
        test(`${file}: "${needle}"`, () => {
            const k = freshKnowledge();
            expect(applyText(k, line(file, needle))).not.toBeNull();
            expect(k).toMatchObject(want);
        });
    }
    test('a line split across two chat components still matches once the page is joined', () => {
        const k = freshKnowledge();
        applyText(k, 'Harold is staying at the local inn, the Toad and Chicken.'.slice(0, 40) + ' ' + 'Harold is staying at the local inn, the Toad and Chicken.'.slice(40));
        expect(k.equip).toBe(20);
    });
    test('facts only RAISE the bounds', () => {
        const k = K({ equip: 60, map: 7 });
        applyText(k, 'Harold is staying at the Toad and Chicken.');
        applyText(k, "Perhaps he'd know another way.");
        expect(k).toMatchObject({ equip: 60, map: 7 });
    });
    test('CEILING lines undo a wrong no-progress bump', () => {
        const k = K({ equip: 20, map: 7 });
        applyText(k, line('quest_death.rs2', "I'd better not go into someone's bedroom without a reason!"));
        expect(k.equip).toBe(EQ.STARTED);
        applyText(k, line('quest_death.rs2', 'This is private property!'));
        expect(k.map).toBe(MAP.GIVEN_SUPPLIES);
    });
    test('every fact regex compiles and none matches an empty line', () => {
        for (const f of TEXT_FACTS) expect(f.re.test('')).toBe(false);
    });
});

// THE RELAUNCH BUG: a full pack dropped Denulth's certificate,
// four probes "matched no fact" and each BUMPED the map track (4 -> 5 -> 6 -> 7 -> 8); persisted {equip:70,map:8} then
// sent every relaunch to Tenzing for a 'replacement map' he only draws at map >= got_map — forever. Every line below is
// pulled from the script so a reworded line fails HERE.
describe('every NPC state answers with stage evidence (no bump needed, none allowed)', () => {
    const line = (file: string, needle: string) => {
        const m = new RegExp(`"(?:<p,\\w+>)?([^"]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`).exec(QD(file));
        expect(m).not.toBeNull();
        return m![1]!;
    };
    const after = (start: Partial<DpKnowledge>, ...lines: string[]) => { const k = K(start); for (const l of lines) applyText(k, l); return k; };
    test('Tenzing: each map state pins the stage — and LOWERS a stale belief', () => {
        const stale = { equip: 70, map: 8 };   // the persisted live store
        expect(after(stale, line('death_sherpa.rs2', 'Saba seemed to think you')).map).toBe(MAP.SPOKEN_SABA);
        expect(after(stale, line('death_sherpa.rs2', 'Has Dunstan added spikes to my climbing boots yet?')).map).toBe(MAP.GOT_ENTRANCECERT);
        expect(after({ equip: 10, map: 1 }, line('death_sherpa.rs2', 'Has Dunstan added spikes to my climbing boots yet?')).map).toBe(MAP.SPOKEN_TENZING);
        expect(after(stale, line('death_sherpa.rs2', 'Have you brought me the items I asked for?')).map).toBe(MAP.GIVEN_CERT);
        expect(after(stale, "I don't have the: Ten loaves of bread. Ten cooked trout.").map).toBe(MAP.GIVEN_CERT);   // death_sherpa.rs2:109 + :91/:95
        expect(after(stale, line('death_sherpa.rs2', 'do not lose another pair!')).map).toBe(MAP.GIVEN_CERT);
        expect(after(stale, line('death_sherpa.rs2', 'Thanks again for the food and boots.')).map).toBe(MAP.GIVEN_SUPPLIES);
        expect(after(stale, line('death_sherpa.rs2', 'I thought you were going to investigate the secret way')).map).toBe(MAP.GOT_MAP);
        expect(after({ equip: 70, map: 6 }, line('death_sherpa.rs2', 'Hello again traveller. What can I do for you?')).map).toBe(MAP.GOT_MAP);
        expect(after(stale, line('death_sherpa.rs2', 'Hello again traveller. What can I do for you?')).map).toBe(MAP.SCOUTED_AREA);   // 7/8 both say it
    });
    test('the hut doors: the knock pins map <= spoken_saba, the back door pins map < got_map', () => {
        expect(after({ equip: 10, map: 5 }, line('quest_death.rs2', 'No milk today! Thank you!')).map).toBe(MAP.NONE);
        expect(after({ equip: 10, map: 5 }, line('quest_death.rs2', 'No milk today! Thank you!'), line('quest_death.rs2', "I'm not the milkman, I need your help!")).map).toBe(MAP.SPOKEN_SABA);
        expect(after({ equip: 10, map: 8 }, line('quest_death.rs2', 'This is private property!')).map).toBe(MAP.GIVEN_SUPPLIES);
    });
    test('Dunstan: each map state pins the stage; the fall-through EXCLUDES 2..5', () => {
        expect(after({ equip: 10, map: 8 }, line('death_smithy.rs2', 'Not yet! I just need to speak to Denulth!')).map).toBe(MAP.SPOKEN_SMITHY);
        expect(after({ equip: 10, map: 8 }, line('death_smithy.rs2', "I have but I don't have the entrance certificate on me.")).map).toBe(MAP.GOT_ENTRANCECERT);
        expect(after({ equip: 10, map: 8 }, line('death_smithy.rs2', 'Now to keep my end of the bargain')).map).toBe(MAP.GIVEN_CERT);
        expect(after({ equip: 10, map: 2 }, line('death_smithy.rs2', 'Hi! Did you want something?')).map).toBe(MAP.GIVEN_SUPPLIES);
        expect(after({ equip: 10, map: 5 }, line('death_smithy.rs2', 'Hi! Did you want something?')).map).toBe(MAP.GIVEN_SUPPLIES);
        expect(after({ equip: 10, map: 7 }, line('death_smithy.rs2', 'Hi! Did you want something?')).map).toBe(MAP.GOT_MAP);   // outside the window: untouched
        expect(after({ equip: 10, map: 1 }, line('death_smithy.rs2', 'Hi! Did you want something?')).map).toBe(MAP.SPOKEN_SABA);
    });
    test('Denulth: the cert branch pins 3/4; the default branch EXCLUDES 3..4; has_map pins equip 70 + map 8', () => {
        expect(after({ equip: 70, map: 8 }, line('death_ig_commander.rs2', "I'm working on it but I've lost the certificate!")).map).toBe(MAP.GOT_ENTRANCECERT);
        expect(after({ equip: 10, map: 6 }, line('death_ig_commander.rs2', 'I just need to give the certificate to Dunstan')).map).toBe(MAP.GOT_ENTRANCECERT);
        expect(after({ equip: 10, map: 3 }, line('death_ig_commander.rs2', "Hello citizen, is there anything you'd like to know?")).map).toBe(MAP.GIVEN_CERT);
        expect(after({ equip: 10, map: 6 }, line('death_ig_commander.rs2', "Hello citizen, is there anything you'd like to know?")).map).toBe(MAP.GIVEN_SUPPLIES);
        expect(after({ equip: 60, map: 7 }, line('death_ig_commander.rs2', "There is a path that runs from a Sherpa's hut"))).toMatchObject({ equip: EQ.UNLOCKED_DOOR, map: MAP.SCOUTED_AREA });
        expect(after({ equip: 70, map: 8 }, line('death_ig_commander.rs2', "I've unlocked the equipment room so I just need to find an alternate route")).map).toBe(MAP.GOT_MAP);
    });
    test('Saba / Eohric / Harold: the states a probe can meet all carry evidence', () => {
        expect(after({ equip: 10, map: 5 }, line('death_saba.rs2', 'Where did you say this Sherpa was?')).map).toBe(MAP.SPOKEN_SABA);
        expect(after({ equip: 10, map: 0 }, line('death_saba.rs2', "I'm working on it!")).map).toBe(MAP.SPOKEN_TENZING);
        expect(after({ equip: 10, map: 8 }, 'What is this castle? Where is the prince? Do you have any quests for me? No, I\'m just looking around.').equip).toBe(EQ.GIVEN_ALE);
        expect(after({ equip: 60, map: 8 }, 'What is this castle? Where is the prince?').equip).toBe(EQ.FOUND_COMBO);
        expect(after({ equip: 20, map: 8 }, line('death_guard_equiproom.rs2', "Now you're talking! An Asgarnian Ale please!")).equip).toBe(EQ.SPOKEN_HEADSERVANT2);
        expect(after({ equip: 20, map: 8 }, line('death_guard_equiproom.rs2', "I honestly don't know! I've looked everywhere.")).equip).toBe(EQ.GIVEN_ALE);
        expect(after({ equip: 50, map: 8 }, line('death_guard_equiproom.rs2', "I said I don't want to talk about it!")).equip).toBe(EQ.SPOKEN_HAROLD);
    });
    test('the live wedge, replayed: stale {70, 8} + Tenzing\'s answer -> the RIGHT next task (a duplicate certificate)', () => {
        const k = K({ equip: 70, map: 8, purse: 0 });
        const pack = (c: Record<number, number>) => (o: number) => c[o] ?? 0;
        const inv = { [DP_OBJ.COMBINATION]: 1, [DP_OBJ.CLIMBING_BOOTS]: 1, [DP_OBJ.IRON_BAR]: 1, [DP_OBJ.BREAD]: 10, [DP_OBJ.TROUT]: 10 };
        floorFromInventory(k, pack(inv), 'IN_PROGRESS');
        expect(nextAction(k, pack(inv))).toMatchObject({ npc: 'tenzing', label: 'Tenzing: replacement map (for Denulth)' });
        applyText(k, line('death_sherpa.rs2', 'Has Dunstan added spikes to my climbing boots yet?'));
        floorFromInventory(k, pack(inv), 'IN_PROGRESS');
        expect(k).toMatchObject({ equip: EQ.UNLOCKED_DOOR, map: MAP.GOT_ENTRANCECERT });
        expect(nextAction(k, pack(inv))).toMatchObject({ npc: 'denulth', label: 'Denulth: duplicate certificate' });
    });
    test('a line that matches nothing changes nothing', () => {
        const k = K({ equip: 70, map: 4 });
        expect(applyText(k, 'Go in peace traveller.')).toBeNull();
        expect(applyText(k, 'Thank you traveller!')).toBeNull();
        expect(k).toMatchObject({ equip: 70, map: 4 });
    });
});

describe('no guessing: the no-progress guard', () => {
    test('the same action with an unchanged signature stops after `limit`; any change resets', () => {
        const g = new NoProgressGuard(3);
        expect(g.note('talk:a', 's1', 's1')).toBe(1); expect(g.stuck()).toBe(false);
        expect(g.note('talk:a', 's1', 's1')).toBe(2);
        expect(g.note('talk:a', 's1', 's2')).toBe(0);            // progress
        expect(g.note('talk:a', 's2', 's2')).toBe(1);
        expect(g.note('talk:b', 's2', 's2')).toBe(1);            // a different action restarts the count
        expect(g.note('talk:b', 's2', 's2')).toBe(2);
        expect(g.note('talk:b', 's2', 's2')).toBe(3); expect(g.stuck()).toBe(true);
    });
    test('the signature sees the knowledge AND the quest items', () => {
        const p0 = (o: number) => (o === DP_OBJ.CERTIFICATE ? 0 : 0), p1 = (o: number) => (o === DP_OBJ.CERTIFICATE ? 1 : 0);
        expect(progressSignature(K({ equip: 70, map: 4 }), p0)).not.toBe(progressSignature(K({ equip: 70, map: 4 }), p1));
        expect(progressSignature(K({ equip: 70, map: 4 }), p0)).not.toBe(progressSignature(K({ equip: 70, map: 8 }), p0));
        expect(progressSignature(K({ equip: 70, map: 4 }), p0)).toBe(progressSignature(K({ equip: 70, map: 4 }), p0));
    });
    test('a full pack is cleared of supply leftovers before an NPC hands over an item; ids match obj.pack', () => {
        const o = packIds('obj.pack');
        expect(DP_JUNK).toEqual([o.get('burntfish2'), o.get('raw_salmon'), o.get('raw_trout'), o.get('fly_fishing_rod'), o.get('feather')]);
        for (const keep of [DP_OBJ.COINS, DP_OBJ.BREAD, DP_OBJ.TROUT, DP_OBJ.IRON_BAR, DP_OBJ.SHARK]) expect(DP_JUNK).not.toContain(keep);
        // the overflow rule this guards against: inv_add on a full pack drops the obj on the floor
        expect(readFileSync(join(CONTENT, '..', 'engine', 'src', 'engine', 'script', 'handlers', 'InvOps.ts'), 'utf8')).toMatch(/const overflow = count - player\.invAdd[\s\S]*?World\.addObj/);
        const t = (npc: any, label: string) => talkMayGrant({ kind: 'talk', npc, label, want: [] });
        expect(t('denulth', 'Denulth: duplicate certificate')).toBe(true);
        expect(t('tenzing', 'Tenzing: replacement map (for Denulth)')).toBe(true);
        expect(t('denulth', 'Denulth: map + combination -> complete')).toBe(false);
        expect(t('dunstan', 'Dunstan: certificate -> spiked boots')).toBe(false);
    });
});

describe('knowledge from the pack and the journal', () => {
    test('each quest item pins its stage window', () => {
        const k = freshKnowledge();
        floorFromInventory(k, pack({ [DP_OBJ.IOU]: 1 }), 'IN_PROGRESS'); expect(k.equip).toBe(EQ.GIVEN_IOU);
        floorFromInventory(k, pack({ [DP_OBJ.COMBINATION]: 1 }), 'IN_PROGRESS'); expect(k.equip).toBe(EQ.FOUND_COMBO);
        const m = freshKnowledge();
        floorFromInventory(m, pack({ [DP_OBJ.CLIMBING_BOOTS]: 1 }), 'IN_PROGRESS'); expect(m).toMatchObject({ equip: 10, map: 2 });
        floorFromInventory(m, pack({ [DP_OBJ.CERTIFICATE]: 1 }), 'IN_PROGRESS'); expect(m.map).toBe(4);
        floorFromInventory(m, pack({ [DP_OBJ.SPIKED_BOOTS]: 1 }), 'IN_PROGRESS'); expect(m.map).toBe(5);
        floorFromInventory(m, pack({ [DP_OBJ.SECRET_MAP]: 1 }), 'IN_PROGRESS'); expect(m.map).toBe(7);
    });
    test('the journal colour is authoritative at both ends', () => {
        const k = K({ equip: 55, map: 6 });
        floorFromInventory(k, pack({}), 'NOT_STARTED'); expect(k).toMatchObject({ equip: 0, map: 0 });
        floorFromInventory(k, pack({}), 'COMPLETE'); expect(k.complete).toBe(true);
    });
});

describe('the next step (resumable from any observed state)', () => {
    const kit = { [DP_OBJ.COINS]: 2000, [DP_OBJ.BREAD]: 10, [DP_OBJ.TROUT]: 10, [DP_OBJ.IRON_BAR]: 1 };
    const next = (k: Partial<DpKnowledge>, inv: Record<number, number> = kit) => nextAction(K(k), pack(inv));
    test('the full happy path, stage by stage', () => {
        expect(next({})).toMatchObject({ kind: 'talk', npc: 'denulth', label: 'Denulth: start' });
        expect(next({ equip: 10 })).toMatchObject({ kind: 'talk', npc: 'saba' });
        expect(next({ equip: 10, map: 1 })).toMatchObject({ kind: 'talk', npc: 'tenzing' });
        expect(next({ equip: 10, map: 2 }, { ...kit, [DP_OBJ.CLIMBING_BOOTS]: 1 })).toMatchObject({ kind: 'talk', npc: 'dunstan' });
        expect(next({ equip: 10, map: 3 })).toMatchObject({ kind: 'talk', npc: 'denulth' });
        expect(next({ equip: 10, map: 4 }, { ...kit, [DP_OBJ.CERTIFICATE]: 1, [DP_OBJ.CLIMBING_BOOTS]: 1 })).toMatchObject({ kind: 'talk', npc: 'dunstan' });
        expect(next({ equip: 10, map: 5 }, { ...kit, [DP_OBJ.CLIMBING_BOOTS]: 1 })).toMatchObject({ kind: 'talk', npc: 'dunstan' });
        expect(next({ equip: 10, map: 5 }, { ...kit, [DP_OBJ.SPIKED_BOOTS]: 1 })).toMatchObject({ kind: 'talk', npc: 'tenzing', label: 'Tenzing: supplies -> secret way map' });
        expect(next({ equip: 10, map: 6 })).toMatchObject({ kind: 'talk', npc: 'tenzing' });
        expect(next({ equip: 10, map: 7 }, { [DP_OBJ.SECRET_MAP]: 1 })).toEqual({ kind: 'scout' });
        expect(next({ equip: 10, map: 8 })).toMatchObject({ kind: 'talk', npc: 'eohric' });
        expect(next({ equip: 20, map: 8 })).toMatchObject({ kind: 'talk', npc: 'harold', want: DP_WANT.haroldDuty });
        expect(next({ equip: 30, map: 8 })).toMatchObject({ kind: 'talk', npc: 'eohric' });
        expect(next({ equip: 40, map: 8 })).toEqual({ kind: 'buy-ale' });
        expect(next({ equip: 40, map: 8 }, { [DP_OBJ.ASGARNIAN_ALE]: 1 })).toMatchObject({ kind: 'talk', npc: 'harold', gamble: true });
        expect(next({ equip: 50, map: 8 })).toMatchObject({ kind: 'talk', npc: 'harold', gamble: true });
        expect(next({ equip: 55, map: 8 }, { [DP_OBJ.IOU]: 1 })).toEqual({ kind: 'read-iou' });
        expect(next({ equip: 60, map: 8 })).toEqual({ kind: 'balls' });
        expect(next({ equip: 70, map: 8 }, { [DP_OBJ.COMBINATION]: 1, [DP_OBJ.SECRET_MAP]: 1 })).toMatchObject({ kind: 'talk', npc: 'denulth', label: 'Denulth: map + combination -> complete' });
        expect(next({ complete: true })).toEqual({ kind: 'done' });
    });
    test('lost items go back to the NPC that re-issues them', () => {
        expect(next({ equip: 10, map: 4 })).toMatchObject({ kind: 'talk', npc: 'denulth', label: 'Denulth: duplicate certificate' });
        expect(next({ equip: 10, map: 5 })).toMatchObject({ kind: 'talk', npc: 'tenzing', label: 'Tenzing: replacement climbing boots' });
        expect(next({ equip: 10, map: 7 })).toMatchObject({ kind: 'talk', npc: 'tenzing', label: 'Tenzing: replacement map' });
        expect(next({ equip: 55, map: 8 })).toMatchObject({ kind: 'talk', npc: 'harold', label: 'Harold: replacement IOU' });
        expect(next({ equip: 70, map: 8 }, { [DP_OBJ.SECRET_MAP]: 1 })).toMatchObject({ kind: 'talk', npc: 'harold', label: 'Harold: replacement combination' });
        expect(next({ equip: 70, map: 8, comboGiven: true })).toMatchObject({ kind: 'talk', npc: 'tenzing' });
        expect(next({ equip: 70, map: 8, comboGiven: true, mapGiven: true })).toMatchObject({ kind: 'talk', npc: 'denulth' });
    });
    test('a missing supply stops the driver with a reason, never a wedge', () => {
        expect(next({ equip: 10, map: 5 }, { [DP_OBJ.SPIKED_BOOTS]: 1, [DP_OBJ.BREAD]: 9, [DP_OBJ.TROUT]: 10 })).toMatchObject({ kind: 'need' });
        expect(next({ equip: 10, map: 5 }, { [DP_OBJ.CLIMBING_BOOTS]: 1 })).toMatchObject({ kind: 'need', what: 'an iron bar for the spikes' });
    });
    test('the replacement-map talk is a PROBE of the map track (its answer can correct a stale map >= scouted)', () => {
        expect(next({ equip: 70, map: 8 }, { [DP_OBJ.COMBINATION]: 1 })).toMatchObject({ npc: 'tenzing', label: 'Tenzing: replacement map (for Denulth)', probe: { track: 'map', stage: MAP.SCOUTED_AREA } });
    });
    test('the map track runs first (it frees the 20 bread/trout slots the equip track needs)', () => {
        expect(next({ equip: 10, map: 0 })).toMatchObject({ npc: 'saba' });
        expect(next({ equip: 40, map: 3 })).toMatchObject({ npc: 'denulth' });
    });
});

describe('dialog option text matches the scripts (option ORDER varies with state; text does not)', () => {
    const opts = (file: string) => [...QD(file).matchAll(/"([^"]+)", (?:\d+|[a-z_]+)[,)]/g)].map(m => m[1]!);
    const anyMatch = (res: readonly RegExp[], strings: string[]) => res.every(r => strings.some(s => r.test(s)));
    test('wanted options exist verbatim', () => {
        expect(anyMatch(DP_WANT.denulthStart, opts('death_ig_commander.rs2'))).toBe(true);
        expect(anyMatch(DP_WANT.eohric, opts('death_headservant.rs2'))).toBe(true);
        expect(anyMatch(DP_WANT.haroldDuty, opts('death_guard_equiproom.rs2'))).toBe(true);
        expect(anyMatch(DP_WANT.gamble, opts('death_guard_equiproom.rs2'))).toBe(true);
        expect(anyMatch(DP_WANT.saba, opts('death_saba.rs2'))).toBe(true);
        expect(anyMatch(DP_WANT.tenzing, opts('death_sherpa.rs2'))).toBe(true);
        expect(anyMatch(DP_WANT.dunstan, opts('death_smithy.rs2'))).toBe(true);
    });
    test('every conversation that can trap a probe has an exit we recognise', () => {
        const exits = (file: string) => opts(file).filter(s => EXIT_OPTIONS.some(r => r.test(s)));
        expect(exits('death_ig_commander.rs2')).toContain("That's all, thanks.");      // denulth multi4
        expect(exits('death_headservant.rs2')).toContain("No, I'm just looking around."); // eohric p_choice4 LOOP
        expect(exits('death_saba.rs2')).toContain('Nothing, sorry!');
        expect(exits('death_sherpa.rs2')).toContain('Nothing, thanks.');
        expect(exits('death_smithy.rs2')).toContain('Nothing, thanks.');
    });
    test('no exit option is ever a wanted option', () => {
        const wanted = Object.values(DP_WANT).flat();
        for (const file of ['death_ig_commander.rs2', 'death_headservant.rs2', 'death_guard_equiproom.rs2', 'death_saba.rs2', 'death_sherpa.rs2', 'death_smithy.rs2'])
            for (const s of opts(file)) expect(wanted.some(w => w.test(s)) && EXIT_OPTIONS.some(e => e.test(s))).toBe(false);
    });
});

describe('pockets (sealed by quest doors the tracker cannot see)', () => {
    test('classification', () => {
        expect(pocketOf(0, 2821, 3556)).toBe('hut');
        expect(pocketOf(0, 2817, 3561)).toBe('yard');
        expect(pocketOf(0, 2817, 3564)).toBe('north');
        expect(pocketOf(1, 2905, 3539)).toBe('harold');
        expect(pocketOf(0, 2905, 3539)).toBeNull();                 // same x,z on the ground floor = the bar
        expect(pocketOf(0, 2270, 4759)).toBe('cave');
        expect(pocketOf(0, 2896, 3528)).toBeNull();
    });
    test('every door stand is on the side its script expects', () => {
        expect(pocketOf(0, DP_DOORS.SHERPA_FRONT_OUT.stand.x, DP_DOORS.SHERPA_FRONT_OUT.stand.z)).toBeNull();
        expect(pocketOf(0, DP_DOORS.SHERPA_FRONT_IN.stand.x, DP_DOORS.SHERPA_FRONT_IN.stand.z)).toBe('hut');
        expect(pocketOf(0, DP_DOORS.SHERPA_BACK_IN.stand.x, DP_DOORS.SHERPA_BACK_IN.stand.z)).toBe('hut');
        expect(pocketOf(0, DP_DOORS.SHERPA_BACK_OUT.stand.x, DP_DOORS.SHERPA_BACK_OUT.stand.z)).toBe('yard');
        expect(pocketOf(0, DP_DOORS.STILE_SOUTH.stand.x, DP_DOORS.STILE_SOUTH.stand.z)).toBe('yard');
        expect(pocketOf(0, DP_DOORS.STILE_NORTH.stand.x, DP_DOORS.STILE_NORTH.stand.z)).toBe('north');
        expect(pocketOf(1, DP_DOORS.HAROLD_OUT.stand.x, DP_DOORS.HAROLD_OUT.stand.z)).toBeNull();
        expect(pocketOf(1, DP_DOORS.HAROLD_IN.stand.x, DP_DOORS.HAROLD_IN.stand.z)).toBe('harold');
        expect(pocketOf(0, DP_DOORS.CAVE_EXIT.stand.x, DP_DOORS.CAVE_EXIT.stand.z)).toBe('cave');
        expect(pocketOf(0, DP_DOORS.CAVE_ENTRANCE.stand.x, DP_DOORS.CAVE_ENTRANCE.stand.z)).toBeNull();
    });
    test('door geometry: check_axis puts the door tile on the side the script calls "leaving"', () => {
        // ~check_axis (doors/scripts/door_procs.rs2:77-88) is TRUE when the player stands on the loc's own row
        // (north/south walls: same z; east/west walls: same x). Harold's door script then KNOCKS on true (the door
        // tile is outside); the sherpa front door OPENS on true (its door tile is inside the hut).
        const src = QD('quest_death.rs2');
        expect(src).toMatch(/\[oploc1,death_harold_door\]\s*def_boolean \$leaving = ~check_axis\(coord, loc_coord, loc_angle\);\s*if\(\$leaving = false\) \{/);
        expect(DP_DOORS.HAROLD_OUT.stand).toEqual({ x: DP_DOORS.HAROLD_OUT.loc.x, z: DP_DOORS.HAROLD_OUT.loc.z });   // knock from the door tile
        expect(src).toMatch(/\[oploc1,death_sherpa_door\][\s\S]*?if\(\$leaving = true \| ~death_get_map >= \^death_spoken_tenzing\)/);
        expect(DP_DOORS.SHERPA_FRONT_IN.stand).toEqual({ x: 2822, z: 3555 });
    });
});

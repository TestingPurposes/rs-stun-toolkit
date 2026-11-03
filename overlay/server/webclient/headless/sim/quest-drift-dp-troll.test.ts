// QUEST DRIFT — DEATH PLATEAU + TROLL STRONGHOLD ( sim review). quest-drift.ts only covers the quest-runner
// fixtures (Rune Mysteries, Druidic Ritual); the two law-chain drivers are bespoke (quest-death.ts / quest-troll.ts) and
// learn their stage from the SERVER'S TEXT. A text pattern that no script emits is a silent drift: the bot never learns
// that stage. This file proves, against the REAL content (pack/*.pack + scripts/**/*.rs2):
//   1. every npc / obj / loc id the drivers use resolves to the expected debugname
//   2. the item hand-overs the drivers rely on are backed by an inv_add / inv_del in that npc's script
//   3. every TEXT pattern (quest-death TEXT_FACTS, quest-troll learnFromText) matches at least one script string
import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { npcItemContract } from './quest-drift.ts';
import { DP_NPC, DP_OBJ, DP_LOC, TEXT_FACTS } from '../quest-death.ts';
import { TROLL_IDS } from '../quest-troll.ts';

const REPO = join(import.meta.dir, '../../../..');
const pack = (f: string) => { const m = new Map<number, string>(); for (const l of readFileSync(join(REPO, 'server/content/pack', f), 'utf8').split('\n')) { const x = l.match(/^(\d+)=(\S+)/); if (x) m.set(Number(x[1]), x[2]!); } return m; };
const NPC = pack('npc.pack'), OBJ = pack('obj.pack'), LOC = pack('loc.pack');

function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.rs2')) out.push(p); }
    return out;
}
// every string literal any script can send (chatnpc/chatplayer/mes/objbox/mesbox/...), tags stripped; a "|" is a page/line
// break inside one speech, so both the joined line and each part are candidates
const STRINGS: string[] = (() => {
    const out: string[] = [];
    for (const f of walk(join(REPO, 'server/content/scripts'))) {
        for (const m of readFileSync(f, 'utf8').matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
            const s = m[1]!.replace(/<[^>]*>/g, '');
            out.push(s.replace(/\|/g, ' '), ...s.split('|'));
        }
    }
    return out;
})();
const emitted = (re: RegExp) => STRINGS.some(s => re.test(s));

describe('ids resolve to the expected content', () => {
    test('npcs', () => {
        const want: Record<number, string> = {
            [DP_NPC.DENULTH]: 'death_ig_commander', [DP_NPC.SABA]: 'death_hermit' /* rev 289 rename (274: death_saba) */, [DP_NPC.TENZING]: 'death_sherpa', [DP_NPC.HAROLD]: 'death_guard_equiproom',
            [DP_NPC.TOSTIG]: 'death_barman', [DP_NPC.EOHRIC]: 'death_headservant', [DP_NPC.DUNSTAN]: 'death_smithy',
            [TROLL_IDS.DAD]: 'troll_champion', [TROLL_IDS.GODRIC]: 'troll_godric', [TROLL_IDS.TWIG_ASLEEP]: 'troll_prison_guard1', [TROLL_IDS.TWIG_AWAKE]: 'troll_prison_guard1_awake',
            [TROLL_IDS.BERRY_ASLEEP]: 'troll_prison_guard2', [TROLL_IDS.BERRY_AWAKE]: 'troll_prison_guard2_awake',
        };
        for (const [id, name] of Object.entries(want)) expect(`${id}=${NPC.get(Number(id))}`).toBe(`${id}=${name}`);
        for (const g of TROLL_IDS.GENERALS) expect(NPC.get(g)).toMatch(/^troll_general\d?$/);
    });
    test('objs', () => {
        const want: Record<number, string> = {
            [DP_OBJ.IOU]: 'death_iou', [DP_OBJ.COMBINATION]: 'death_combination', [DP_OBJ.SECRET_MAP]: 'death_secretwaymap',
            [DP_OBJ.CLIMBING_BOOTS]: 'death_climbingboots', [DP_OBJ.SPIKED_BOOTS]: 'death_spikedboots', [DP_OBJ.CERTIFICATE]: 'death_entrancecert',
            [DP_OBJ.IRON_BAR]: 'iron_bar', [DP_OBJ.BREAD]: 'bread', [DP_OBJ.TROUT]: 'trout', [DP_OBJ.ASGARNIAN_ALE]: 'asgarnian_ale',
            [TROLL_IDS.LAW_TALISMAN]: 'law_talisman', [TROLL_IDS.PRISON_KEY]: 'troll_key_prison', [TROLL_IDS.CELL_KEY_GODRIC]: 'troll_key_godric',
        };
        for (const [id, name] of Object.entries(want)) expect(`${id}=${OBJ.get(Number(id))}`).toBe(`${id}=${name}`);
    });
    test('locs', () => {
        const want: Record<number, string> = {
            [DP_LOC.MECH_CORNER]: 'death_stone_mechanism_corner', [DP_LOC.MECH_SIDE]: 'death_stone_mechanism_side',
            [DP_LOC.CAVE_ENTRANCE]: 'death_hermitcave_entrance', [DP_LOC.CAVE_EXIT]: 'death_hermitcave_exit', [DP_LOC.CASTLE_DOOR]: 'death_castledoor',
            [DP_LOC.SHERPA_DOOR]: 'death_sherpa_door', [DP_LOC.HAROLD_DOOR]: 'death_harold_door',
            3722: 'death_climbingrocks_top', 3723: 'death_climbingrocks_bottom',   // quest-troll DP_DOWN / DP_UP
        };
        for (const [id, name] of Object.entries(want)) expect(`${id}=${LOC.get(Number(id))}`).toBe(`${id}=${name}`);
    });
});

describe('item hand-overs are backed by the npc scripts', () => {
    const c = npcItemContract();
    const has = (npc: number, kind: 'adds' | 'dels', obj: number) => !!c.get(npc)?.[kind].has(obj);
    test('Death Plateau', () => {
        expect(has(DP_NPC.TENZING, 'dels', DP_OBJ.BREAD)).toBe(true);          // supplies: Tenzing takes 10 bread ...
        expect(has(DP_NPC.TENZING, 'dels', DP_OBJ.TROUT)).toBe(true);          // ... and 10 cooked trout
        expect(has(DP_NPC.TENZING, 'adds', DP_OBJ.CLIMBING_BOOTS)).toBe(true); // and sells/gives the climbing boots
        expect(has(DP_NPC.HAROLD, 'adds', DP_OBJ.IOU)).toBe(true);             // the dice IOU
        expect(has(DP_NPC.DUNSTAN, 'dels', DP_OBJ.IRON_BAR)).toBe(true);       // the spikes need an iron bar
        expect(has(DP_NPC.DUNSTAN, 'adds', DP_OBJ.SPIKED_BOOTS)).toBe(true);
    });
    test('Troll Stronghold', () => {
        expect(has(TROLL_IDS.DUNSTAN, 'adds', TROLL_IDS.LAW_TALISMAN)).toBe(true);   // the reward / the re-issue
    });
});

describe('every TEXT pattern the drivers learn from is emitted by some script', () => {
    test('quest-death TEXT_FACTS', () => {
        const missing = TEXT_FACTS.map(f => f.re).filter(re => !emitted(re)).map(String);
        expect(missing).toEqual([]);
    });
    test('quest-troll learnFromText', () => {
        const src = readFileSync(join(import.meta.dir, '../quest-troll.ts'), 'utf8');
        const body = src.slice(src.indexOf('export function learnFromText'), src.indexOf('// ---- observation + decision'));
        const res = [...body.matchAll(/if \(\/(.+?)\/(i?)\.test\(t\)/g)].map(m => new RegExp(m[1]!, m[2]));
        expect(res.length).toBeGreaterThan(15);
        const missing = res.filter(re => !emitted(re)).map(String);
        expect(missing).toEqual([]);
    });
});

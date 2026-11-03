// bun test server/webclient/headless/sim/skilling-tables.test.ts
//
// DATA TESTS for `headless/skilling-tables.ts` (package 2, PHASE 1 — generated data + spec only;
// nothing is wired into a bot yet, so there is no behaviour to drive through the harness).
//
// WHAT THESE TESTS ARE FOR. A generated id table has exactly one failure mode that matters: it goes
// stale, silently, and a bot then clicks a component that moved. So every test below RE-DERIVES the
// fact from the same ground truth the generator used — the packed id tables and the content scripts —
// WITHOUT importing the generator. If extract-skilling.mjs and the checked-in table ever disagree, or
// if a repack moves an id, these fail; a hand-edit of skilling-tables.ts fails too.
//
// THE ID QUESTION THIS PACKAGE HAD TO SETTLE. extract-capabilities.mjs treats
// server/engine/data/symbols/component.sym as authoritative and refuses to emit an id missing from it.
// The leather-crafting buttons ARE missing from it (and its close button DISAGREES with it), so this
// package resolves ids from server/content/pack/interface.pack and cross-checks against
// server/engine/data/pack/server/interface.dat — the table the RUNNING engine loads. The tests pin
// that decision, including the one concrete divergence, so nobody "fixes" it back.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';

import {
    OPHELDU_TOOL_FIRST,
    SKILL_MULTI, SKILL_MULTI_BY_NAME, SKILL_MULTI_BY_ROOT, SKILL_MULTI_STEPS,
    CHOP_OP, CHOP_CONTINUE_OP, AXES, AXE_OBJS, TREES, TREE_BY_LOC, TREE_BY_TABLE,
    BURN_GROUND_OP, TINDERBOX, ASHES, LOGS, LOG_BY_OBJ, LOG_OBJS,
    KNIFE, ARROW_SHAFT, BOW_STRING, FLETCH_LOGS, FLETCH_LOG_BY_OBJ, BOW_STRINGING, BOW_STRING_BY_OBJ,
    NEEDLE, THREAD, LEATHER, HARD_LEATHER_OBJ, THREAD_USES, LEATHER_CRAFTING,
    LEATHER_PRODUCTS, LEATHER_PRODUCT_BY_NAME, HARD_LEATHER, DHIDE, DHIDE_BY_OBJ,
    GOLD_BAR, PERFECT_GOLD_BAR, SILVER_BAR, JEWELRY, JEWELRY_MOULDS, JEWELRY_ROWS,
    JEWELRY_ROW_BY_GROUP, JEWELRY_ROW_BY_COM,
    BALL_OF_WOOL, STRING_XP, STRINGABLE, STRINGABLE_BY_OBJ,
    ENCHANT_SPELLS, ENCHANT_BY_TARGET, ENCHANT_BY_TIER,
    MESSAGES, SKILLING_PROVENANCE,
} from '../skilling-tables.js';

// ---- ground truth, loaded independently of the generator -----------------------------------------
const url = (rel: string) => new URL(rel, import.meta.url);
const readText = (rel: string) => readFileSync(url(rel), 'utf8');
const readBin = (rel: string) => readFileSync(url(rel));

const CONTENT = '../../../content/';
const ENGINE_PACK = '../../../engine/data/pack/';
const SYMBOLS = '../../../engine/data/symbols/';

function readPack(file: string) {
    const byName = new Map<string, number>(), byId = new Map<number, string>();
    for (const line of readText(`${CONTENT}pack/${file}`).split('\n')) {
        const t = line.trim();
        const eq = t.indexOf('=');
        if (!t || eq <= 0) continue;
        const id = Number(t.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        byName.set(t.slice(eq + 1), id);
        byId.set(id, t.slice(eq + 1));
    }
    return { byName, byId };
}

/** Decode data/pack/server/interface.dat: g2 header, then [g2 id][jstr(\n) name][g1 overlay]*. */
function readRuntimeComponents() {
    const buf = readBin(`${ENGINE_PACK}server/interface.dat`);
    let p = 2;   // skip the header
    const byName = new Map<string, number>(), byId = new Map<number, string>();
    while (p < buf.length) {
        const id = (buf[p]! << 8) | buf[p + 1]!;
        p += 2;
        let name = '';
        while (p < buf.length && buf[p] !== 10) name += String.fromCharCode(buf[p++]!);
        p++;            // the \n terminator
        p++;            // the overlay bool
        byName.set(name, id);
        byId.set(id, name);
    }
    return { byName, byId };
}

function readSym(file: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of readText(`${SYMBOLS}${file}`).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const [idStr, name] = t.split('\t');
        const id = Number(idStr);
        if (Number.isFinite(id) && name) m.set(name, id);
    }
    return m;
}

const ifacePack = readPack('interface.pack');
const objPack = readPack('obj.pack');
const locPack = readPack('loc.pack');
const runtimeComs = readRuntimeComponents();
const componentSym = readSym('component.sym');
const datCount = (rel: string) => { const b = readBin(`${ENGINE_PACK}${rel}`); return (b[0]! << 8) | b[1]!; };
const OBJ_DAT_COUNT = datCount('server/obj.dat');
const LOC_DAT_COUNT = datCount('server/loc.dat');

const script = (rel: string) => readText(`${CONTENT}scripts/${rel}`);

/** Every (component id, expected content name) pair the tables claim, gathered once. */
function allComponentClaims(): [number, string][] {
    const out: [number, string][] = [];
    for (const m of SKILL_MULTI) {
        out.push([m.root, m.iface]);
        if (m.prompt !== null) out.push([m.prompt, `${m.iface}:prompt`]);
        for (const s of m.slots) {
            out.push([s.model, `${m.iface}:model_${s.slot}`]);
            out.push([s.make1, `${m.iface}:make1_${s.slot}`]);
            out.push([s.make5, `${m.iface}:make5_${s.slot}`]);
            out.push([s.make10, `${m.iface}:make10_${s.slot}`]);
            out.push([s.makeX, `${m.iface}:makex_${s.slot}`]);
        }
    }
    out.push([LEATHER_CRAFTING.ROOT, 'leather_crafting']);
    for (const p of LEATHER_PRODUCTS) for (const b of p.bindings) out.push([b.com, b.comName]);
    out.push([JEWELRY.ROOT, 'crafting_jewelry']);
    for (const r of JEWELRY_ROWS) {
        out.push([r.com, `crafting_jewelry:${r.group}_inv`]);
        out.push([r.mouldCom, `crafting_jewelry:${r.group.replace(/s$/, '')}_mould`]);
        out.push([r.layerCom, `crafting_jewelry:${r.group}_layer`]);
    }
    for (const s of ENCHANT_SPELLS) out.push([s.com, s.comName]);
    return out;
}

/** Every obj id the tables claim. */
function allObjIds(): number[] {
    const ids: number[] = [TINDERBOX, ASHES, KNIFE, ARROW_SHAFT, BOW_STRING, NEEDLE, THREAD, LEATHER,
        HARD_LEATHER_OBJ, GOLD_BAR, PERFECT_GOLD_BAR, SILVER_BAR, BALL_OF_WOOL];
    for (const a of AXES) ids.push(a.obj);
    for (const t of TREES) ids.push(t.productObj);
    for (const l of LOGS) ids.push(l.obj);
    for (const f of FLETCH_LOGS) { ids.push(f.logObj); for (const p of f.products) ids.push(p.productObj); }
    for (const b of BOW_STRINGING) { ids.push(b.unstrungObj); ids.push(b.productObj); }
    for (const p of [...LEATHER_PRODUCTS, HARD_LEATHER]) { ids.push(p.productObj); ids.push(p.leatherObj); }
    for (const d of DHIDE) { ids.push(d.leatherObj); for (const p of d.products) ids.push(p.productObj); }
    for (const r of JEWELRY_ROWS) for (const s of r.slots) {
        ids.push(s.slotObjId); ids.push(s.productObj); if (s.gemObj !== null) ids.push(s.gemObj);
    }
    for (const m of Object.values(JEWELRY_MOULDS)) ids.push(m.obj);
    for (const s of STRINGABLE) { ids.push(s.unstrungObj); ids.push(s.strungObj); }
    for (const s of ENCHANT_SPELLS) {
        for (const r of s.runes) ids.push(r.obj);
        for (const c of s.conversions) { ids.push(c.fromObj); ids.push(c.toObj); }
        if (s.unstrungObj !== null) ids.push(s.unstrungObj);
    }
    return ids;
}

// =====================================================================================================
// 1. ID GROUND TRUTH — the whole point of the package
// =====================================================================================================
describe('every emitted component id resolves to the right name in BOTH id tables', () => {
    const claims = allComponentClaims();

    test('the claim set is not accidentally empty', () => {
        expect(claims.length).toBeGreaterThanOrEqual(100);
    });

    test('interface.pack agrees on every id (the compiler resolves against this file)', () => {
        const bad: string[] = [];
        for (const [id, name] of claims) {
            if (ifacePack.byName.get(name) !== id) bad.push(`${name}: table=${id} pack=${ifacePack.byName.get(name)}`);
        }
        expect(bad).toEqual([]);
    });

    test('data/pack/server/interface.dat agrees on every id (the engine loads this at boot)', () => {
        const bad: string[] = [];
        for (const [id, name] of claims) {
            if (runtimeComs.byName.get(name) !== id) bad.push(`${name}: table=${id} runtime=${runtimeComs.byName.get(name)}`);
            if (runtimeComs.byId.get(id) !== name) bad.push(`id ${id}: table='${name}' runtime='${runtimeComs.byId.get(id)}'`);
        }
        expect(bad).toEqual([]);
    });

    test('no id is claimed twice under two different names', () => {
        const seen = new Map<number, string>();
        for (const [id, name] of claims) {
            const prev = seen.get(id);
            if (prev !== undefined) expect(prev).toBe(name);
            seen.set(id, name);
        }
    });
});

describe('component.sym is stale, and the tables deliberately do not follow it', () => {
    // ⛔ PINNED ON PURPOSE. If someone "restores" the sym-is-authoritative rule from
    // extract-capabilities.mjs, craftLeather would either refuse to generate or emit 2401 for the
    // close button and 21 missing ids for the make buttons. These two tests are the guard rail.
    test('the leather-crafting make buttons are ABSENT from component.sym but real in the runtime table', () => {
        const body = LEATHER_PRODUCT_BY_NAME['leather_armour']!;
        const make1 = body.bindings.find(b => b.count === 1)!;
        expect(make1.comName).toBe('leather_crafting:com_113');
        expect(componentSym.has(make1.comName)).toBe(false);              // the stale artifact never had it
        expect(runtimeComs.byName.get(make1.comName)).toBe(make1.com);    // the engine's own table does
        expect(ifacePack.byName.get(make1.comName)).toBe(make1.com);
    });

    test('leather_crafting:com_89 DISAGREES between pack/runtime and sym; the pack value is emitted', () => {
        const NAME = 'leather_crafting:com_89';
        expect(ifacePack.byName.get(NAME)).toBe(2422);
        expect(runtimeComs.byName.get(NAME)).toBe(2422);
        expect(componentSym.get(NAME)).toBe(2401);      // the stale value we must NOT use
        expect(LEATHER_CRAFTING.CLOSE).toBe(2422);
    });

    test('the compiler reads interface.pack, not the symbol table — the reason for all of the above', () => {
        const compiler = readText('../../../engine/tools/pack/Compiler.ts');
        expect(compiler).toContain("CompilerTypeInfo.load(`${Environment.build.srcDir}/pack/interface.pack`)");
        expect(compiler).not.toContain('data/symbols');
    });
});

describe('every emitted obj/loc id addresses a real record in the runtime config', () => {
    test('obj ids are inside obj.dat and round-trip through obj.pack', () => {
        const bad: number[] = [];
        for (const id of allObjIds()) {
            if (!(id >= 0 && id < OBJ_DAT_COUNT)) bad.push(id);
            if (!objPack.byId.has(id)) bad.push(id);
        }
        expect(bad).toEqual([]);
    });

    test('tree loc ids are inside loc.dat and round-trip through loc.pack by NAME', () => {
        const bad: string[] = [];
        for (const t of TREES) for (const l of t.locs) {
            if (!(l.id >= 0 && l.id < LOC_DAT_COUNT)) bad.push(`${l.name} out of range`);
            if (locPack.byName.get(l.name) !== l.id) bad.push(`${l.name}: table=${l.id} pack=${locPack.byName.get(l.name)}`);
        }
        expect(bad).toEqual([]);
    });

    test('named obj constants match obj.pack by name', () => {
        const pairs: [string, number][] = [
            ['tinderbox', TINDERBOX], ['ashes', ASHES], ['knife', KNIFE], ['arrow_shaft', ARROW_SHAFT],
            ['bow_string', BOW_STRING], ['needle', NEEDLE], ['thread', THREAD], ['leather', LEATHER],
            ['hard_leather', HARD_LEATHER_OBJ], ['gold_bar', GOLD_BAR], ['perfect_gold_bar', PERFECT_GOLD_BAR],
            ['silver_bar', SILVER_BAR], ['ball_of_wool', BALL_OF_WOOL],
        ];
        for (const [name, id] of pairs) expect(objPack.byName.get(name)).toBe(id);
    });
});

// =====================================================================================================
// 2. SKILL_MULTI — the make-N dialogs, and the reason this cannot be arithmetic
// =====================================================================================================
describe('SKILL_MULTI matches chat.rs2 and skill_multiN.if', () => {
    test('there are exactly the four dialogs, with 2/3/4/5 product slots', () => {
        expect(SKILL_MULTI.map(m => m.iface)).toEqual(['skill_multi2', 'skill_multi3', 'skill_multi4', 'skill_multi5']);
        for (const m of SKILL_MULTI) expect(m.slots.length).toBe(Number(m.iface.slice(-1)));
    });

    test('slot letters run a.. in product order and index is 0-based', () => {
        for (const m of SKILL_MULTI) {
            expect(m.slots.map(s => s.slot)).toEqual(['a', 'b', 'c', 'd', 'e'].slice(0, m.slots.length));
            expect(m.slots.map(s => s.index)).toEqual(m.slots.map((_, i) => i));
        }
    });

    test('chat.rs2 still resolves each button to the same (slot, count)', () => {
        const src = script('interface_chat/scripts/chat.rs2');
        for (const m of SKILL_MULTI) {
            for (const s of m.slots) {
                const n = s.index + 1;
                expect(src).toContain(`case ${m.iface}:make10_${s.slot} : return($obj${n}, 10);`);
                expect(src).toContain(`case ${m.iface}:make5_${s.slot} : return($obj${n}, 5);`);
                expect(src).toContain(`case ${m.iface}:make1_${s.slot} : return($obj${n}, 1);`);
                // the X button suspends into a count dialog instead of returning a literal
                expect(src).toContain(`case ${m.iface}:makex_${s.slot} :`);
            }
        }
    });

    test('every make button is registered with if_addresumebutton — so IF_BUTTON, not RESUME_PAUSEBUTTON', () => {
        const src = script('interface_chat/scripts/chat.rs2');
        for (const m of SKILL_MULTI) for (const s of m.slots) for (const kind of ['make1', 'make5', 'make10', 'makex']) {
            expect(src).toContain(`if_addresumebutton(${m.iface}:${kind}_${s.slot});`);
        }
    });

    test('there is NO [if_button,skill_multiN:...] trigger anywhere in the content', () => {
        // If one ever appears, the click contract changes and this table needs revisiting.
        for (const rel of ['interface_chat/scripts/chat.rs2', 'skill_fletching/scripts/cut_logs.rs2',
            'skill_crafting/scripts/leather/leather.rs2']) {
            expect(script(rel)).not.toMatch(/\[if_button,skill_multi\d:/);
        }
    });

    test('⛔ button ids are NOT in label order — no brain may derive them arithmetically', () => {
        // skill_multi2 slot a: make1 > make5 > make10 > makex. Any "root + N" formula is wrong.
        const m2a = SKILL_MULTI_BY_NAME['skill_multi2']!.slots[0]!;
        expect(m2a.make1).toBeGreaterThan(m2a.make5);
        expect(m2a.make5).toBeGreaterThan(m2a.make10);
        expect(m2a.make10).toBeGreaterThan(m2a.makeX);
    });

    test('all component ids within a dialog are distinct, and the lookups agree', () => {
        for (const m of SKILL_MULTI) {
            const ids = m.slots.flatMap(s => [s.model, s.make1, s.make5, s.make10, s.makeX]).concat(m.root);
            expect(new Set(ids).size).toBe(ids.length);
            expect(SKILL_MULTI_BY_NAME[m.iface]).toBe(m);
            expect(SKILL_MULTI_BY_ROOT.get(m.root)).toBe(m);
        }
    });

    test('SKILL_MULTI_STEPS is the set of one-click counts, largest first', () => {
        expect(SKILL_MULTI_STEPS).toEqual([10, 5, 1]);
    });
});

// =====================================================================================================
// 3. WOODCUTTING
// =====================================================================================================
describe('WOODCUTTING tables match woodcut.rs2 and trees.dbrow', () => {
    const src = script('skill_woodcutting/scripts/woodcut.rs2');

    test('the chop op is oploc1 and the continuation op (never sent by a bot) is 3', () => {
        expect(CHOP_OP).toBe(1);
        expect(CHOP_CONTINUE_OP).toBe(3);
        expect(src).toContain('[oploc1,_tree] @attempt_cut_tree;');
        expect(src).toContain('[oploc3,_tree] @cut_tree;');
    });

    test('AXES is the checker order, best first, and every axe is accepted from hand OR backpack', () => {
        expect(AXES.map(a => a.name)).toEqual(['rune_axe', 'adamant_axe', 'mithril_axe', 'black_axe',
            'steel_axe', 'iron_axe', 'bronze_axe']);
        for (const a of AXES) expect(src).toContain(`($obj1 = ${a.name} | inv_total(inv, ${a.name}) > 0)`);
        expect(AXE_OBJS.size).toBe(AXES.length);
    });

    test('every tree table row is present with its level/xp/product', () => {
        expect(TREES.length).toBe(10);
        const byTable = new Map(TREES.map(t => [t.table, t]));
        // spot-check the tiers a training brain will actually use
        expect(byTable.get('normal_tree_table')!.level).toBe(0);
        expect(byTable.get('normal_tree_table')!.xp).toBe(250);
        expect(byTable.get('oak_tree_table')!.level).toBe(15);
        expect(byTable.get('willow_tree_table')!.level).toBe(30);
        expect(byTable.get('maple_tree_table')!.level).toBe(45);
        expect(byTable.get('yew_tree_table')!.level).toBe(60);
        expect(byTable.get('magic_tree_table')!.level).toBe(75);
        expect(byTable.get('magic_tree_table')!.product).toBe('magic_logs');
    });

    test('TREE_BY_LOC covers every loc exactly once — no loc belongs to two tables', () => {
        let total = 0;
        for (const t of TREES) {
            total += t.locs.length;
            for (const l of t.locs) expect(TREE_BY_LOC.get(l.id)).toBe(t);
        }
        expect(TREE_BY_LOC.size).toBe(total);
        expect(Object.keys(TREE_BY_TABLE).length).toBe(TREES.length);
    });

    test('the jungle table has no axe roll — an empty successChance is meaningful, not missing data', () => {
        expect(Object.keys(TREE_BY_TABLE['jungle_tree_table']!.successChance).length).toBe(0);
        expect(Object.keys(TREE_BY_TABLE['yew_tree_table']!.successChance).length).toBe(AXES.length);
    });
});

// =====================================================================================================
// 4. FIREMAKING
// =====================================================================================================
describe('FIREMAKING tables match firemaking.rs2 and the category_22 objs', () => {
    const src = script('skill_firemaking/scripts/firemaking.rs2');

    test('both routes still exist: opobj4 on the ground, opheldu tinderbox in the backpack', () => {
        expect(BURN_GROUND_OP).toBe(4);
        expect(src).toContain('[opobj4,_category_22]');
        expect(src).toContain('[opheldu,tinderbox]');
        expect(src).toContain('case category_22 : @light_logs_inv(last_useslot);');
    });

    test('the success path MOVES the player — the fact a burn brain most needs', () => {
        expect(src).toContain('~push_player(obj_coord);');
        expect(src).toContain('[proc,push_player](coord $origin_coord)');
        // west, east, south, north — first walkable wins
        expect(src).toContain('movecoord(coord, -1, 0, 0)');
        expect(src).toContain('movecoord(coord, 1, 0, 0)');
    });

    test('bank zones refuse a fire by design', () => {
        expect(src).toContain('~inzone_coord_pair_table(bank_zones, coord)');
    });

    test('the log list is every category_22 obj, with levels ascending', () => {
        expect(LOGS.length).toBe(7);
        expect(LOGS.map(l => l.name)).toContain('logs');
        expect(LOGS.map(l => l.name)).toContain('magic_logs');
        for (let i = 1; i < LOGS.length; i++) expect(LOGS[i]!.level).toBeGreaterThanOrEqual(LOGS[i - 1]!.level);
        for (const l of LOGS) expect(LOG_BY_OBJ.get(l.obj)).toBe(l);
        expect(LOG_OBJS.size).toBe(LOGS.length);
    });

    test('⛔ achey logs burn for ZERO xp and have their own competing trigger', () => {
        const achey = LOGS.find(l => l.name === 'achey_tree_logs')!;
        expect(achey.xp).toBe(0);            // no productexp param -> param default 0
        expect(achey.level).toBe(0);
        expect(achey.hasOwnTrigger).toBe(true);
        expect(script('skill_firemaking/scripts/achey.rs2')).toContain('[opheldu,achey_tree_logs]');
        // and it is the ONLY log with a competing trigger
        expect(LOGS.filter(l => l.hasOwnTrigger).length).toBe(1);
    });

    test('normal logs are the f2p workhorse: level 1, 40 xp', () => {
        const l = LOGS.find(x => x.name === 'logs')!;
        expect(l.level).toBe(1);
        expect(l.xp).toBe(400);              // tenths
        expect(l.members).toBe(false);
    });
});

// =====================================================================================================
// 5. FLETCHING
// =====================================================================================================
describe('FLETCHING tables match the REAL dispatch path', () => {
    test('⛔ [opheldu,knife] lives in skill_cooking and is what actually routes fletching', () => {
        const knifeSrc = script('skill_cooking/scripts/gnome_cooking/cutting_fruit.rs2');
        expect(knifeSrc).toContain('[opheldu,knife]');
        expect(knifeSrc).toContain('@fletch_log(last_useitem);');
    });

    test('cut_logs.rs2\'s own "case knife" arm is dead code — a specific trigger outranks a category one', () => {
        // Both exist; the handler's resolution order (obj-specific before category) decides.
        expect(script('skill_fletching/scripts/cut_logs.rs2')).toContain('case knife : @fletch_log(last_item);');
        const handler = readText('../../../engine/src/network/game/client/handler/OpHeldUHandler.ts');
        const specificAt = handler.indexOf('getByTriggerSpecific(ServerTriggerType.OPHELDU, objType.id, -1)');
        const categoryAt = handler.indexOf('objCategory.id');
        expect(specificAt).toBeGreaterThan(-1);
        expect(categoryAt).toBeGreaterThan(specificAt);
    });

    test('⛔ fletching is gated on a members world', () => {
        const src = script('skill_fletching/scripts/cut_logs.rs2');
        expect(src).toContain('mes(^mes_members_fletching);');
        expect(MESSAGES.fletching.membersRefusal).toBe('You need to be on a members\' world to gain experience in Fletching.');
    });

    test('plain logs open skill_multi3 (shafts+short+long); every other log opens skill_multi2', () => {
        const normal = FLETCH_LOG_BY_OBJ.get(LOG_BY_OBJ.get(FLETCH_LOGS[0]!.logObj)!.obj)!;
        expect(normal.log).toBe('logs');
        expect(normal.shafts).toBe(15);
        expect(normal.iface).toBe('skill_multi3');
        expect(normal.products.map(p => p.kind)).toEqual(['shafts', 'shortbow', 'longbow']);
        for (const f of FLETCH_LOGS.filter(x => x.shafts === 0)) {
            expect(f.iface).toBe('skill_multi2');
            expect(f.products.map(p => p.kind)).toEqual(['shortbow', 'longbow']);
        }
    });

    test('products are POSITIONAL — products.length always equals the dialog\'s slot count', () => {
        for (const f of FLETCH_LOGS) {
            expect(f.products.length).toBe(SKILL_MULTI_BY_NAME[f.iface]!.slots.length);
        }
    });

    test('all six log tiers are present and the shaft line yields 15 for 75 xp', () => {
        expect(FLETCH_LOGS.length).toBe(6);
        expect(FLETCH_LOGS.map(f => f.log)).toEqual(['logs', 'oak_logs', 'willow_logs', 'maple_logs', 'yew_logs', 'magic_logs']);
        const shafts = FLETCH_LOGS[0]!.products[0]!;
        expect(shafts.count).toBe(15);
        expect(shafts.xp).toBe(75);          // shaft_count * 5, as cut_logs.rs2 computes it
        expect(shafts.productObj).toBe(ARROW_SHAFT);
    });

    test('bow stringing is a plain OPHELDU with no interface', () => {
        expect(script('skill_fletching/scripts/bows.rs2')).toContain('[opheldu,bow_string]');
        expect(BOW_STRINGING.length).toBe(12);   // 6 tiers x short/long
        for (const b of BOW_STRINGING) {
            expect(b.count).toBe(1);
            expect(BOW_STRING_BY_OBJ.get(b.unstrungObj)).toBe(b);
            expect(b.unstrungObj).not.toBe(b.productObj);
        }
    });

    test('every fletched bow is the input of exactly one stringing row', () => {
        for (const f of FLETCH_LOGS) for (const p of f.products) {
            if (p.kind === 'shafts') continue;
            expect(BOW_STRING_BY_OBJ.has(p.productObj)).toBe(true);
        }
    });
});

// =====================================================================================================
// 6. LEATHER
// =====================================================================================================
describe('LEATHER tables match leather.rs2', () => {
    const src = script('skill_crafting/scripts/leather/leather.rs2');

    test('the entry point is needle -> leather -> if_openmain(leather_crafting)', () => {
        expect(src).toContain('[opheldu,needle]');
        expect(src).toContain('case leather : @craft_leather_interface;');
        expect(src).toContain('if_openmain(leather_crafting);');
        expect(ifacePack.byName.get('leather_crafting')).toBe(LEATHER_CRAFTING.ROOT);
    });

    test('thread is checked BEFORE the interface opens — "no modal" usually means "no thread"', () => {
        expect(src).toMatch(/\[label,craft_leather_interface\]\s*\nif \(inv_total\(inv, thread\) < 1\)/);
        expect(THREAD_USES).toBe(5);
        expect(src).toContain('if (%thread_used > 4) {');
    });

    test('every button binding still says exactly what the table says it says', () => {
        for (const p of LEATHER_PRODUCTS) {
            expect(p.bindings.length).toBe(3);
            for (const b of p.bindings) {
                expect(src).toContain(`[if_button,${b.comName}] @craft_leather(${p.product}, ${b.count});`);
            }
        }
    });

    test('leather_chaps make-5/make-10: broken in 274 (all made ONE), FIXED in rev 289 — brokenCounts tracks the content', () => {
        const chaps = LEATHER_PRODUCT_BY_NAME['leather_chaps']!;
        // 274: brokenCounts true, counts [1,1,1], no 5/10 buttons. 289 leather.rs2 binds 1/5/10.
        expect(chaps.brokenCounts).toBe(false);
        expect(chaps.bindings.map(b => b.count)).toEqual([1, 5, 10]);
        expect(chaps.buttons[1]).toBeGreaterThan(0);
        expect(chaps.buttons[5]).toBeGreaterThan(0);
        expect(chaps.buttons[10]).toBeGreaterThan(0);
        // the interface LABEL claims otherwise — which is exactly what a live text scan would read
        expect(readText(`${CONTENT}scripts/skill_crafting/interfaces/leather_crafting.if`))
            .toContain('option=Make 10 pairs of @lre@Leather chaps');
    });

    test('every other product has a real 1/5/10 and no two products share a button id', () => {
        const seen = new Set<number>();
        for (const p of LEATHER_PRODUCTS) {
            if (!p.brokenCounts) {
                expect(p.buttons[1]).toBeGreaterThan(0);
                expect(p.buttons[5]).toBeGreaterThan(0);
                expect(p.buttons[10]).toBeGreaterThan(0);
            }
            for (const b of p.bindings) {
                expect(seen.has(b.com)).toBe(false);
                seen.add(b.com);
            }
        }
        expect(seen.size).toBe(LEATHER_PRODUCTS.length * 3);
    });

    test('the seven interface products are the f2p+coif set, level ordered', () => {
        expect(LEATHER_PRODUCTS.map(p => p.product)).toEqual([
            'leather_gloves', 'leather_boots', 'leather_cowl', 'leather_vambraces',
            'leather_armour', 'leather_chaps', 'coif']);
        for (let i = 1; i < LEATHER_PRODUCTS.length; i++) {
            expect(LEATHER_PRODUCTS[i]!.level).toBeGreaterThan(LEATHER_PRODUCTS[i - 1]!.level);
        }
        for (const p of LEATHER_PRODUCTS) expect(p.leatherObj).toBe(LEATHER);
    });

    test('hard leather bypasses the interface entirely (one body per packet)', () => {
        expect(src).toContain('case hard_leather : @craft_leather(hardleather_body, 1);');
        expect(HARD_LEATHER.product).toBe('hardleather_body');
        expect(HARD_LEATHER.leatherObj).toBe(HARD_LEATHER_OBJ);
        expect(HARD_LEATHER.bindings).toEqual([]);
        expect(Object.keys(HARD_LEATHER.buttons).length).toBe(0);
    });

    test('dragonhide uses skill_multi3, positional body/vambraces/chaps, with real hide costs', () => {
        expect(src).toContain('~skill_multi3($interface_item1');
        expect(DHIDE.length).toBe(4);
        for (const d of DHIDE) {
            expect(d.products.map(p => p.kind)).toEqual(['body', 'vambraces', 'chaps']);
            expect(d.products.map(p => p.leatherCount)).toEqual([3, 1, 2]);
            expect(d.products.length).toBe(SKILL_MULTI_BY_NAME['skill_multi3']!.slots.length);
            expect(DHIDE_BY_OBJ.get(d.leatherObj)).toBe(d);
            for (const p of d.products) expect(p.members).toBe(true);
        }
    });
});

// =====================================================================================================
// 7. JEWELRY
// =====================================================================================================
describe('JEWELRY tables match jewellery.rs2 + jewellery.inv', () => {
    const src = script('skill_crafting/scripts/jewellery/jewellery.rs2');

    test('a gold bar on a furnace opens the interface', () => {
        expect(script('skill_smithing/scripts/smelting/smelting.rs2'))
            .toContain('case gold_bar, perfect_gold_bar : @craft_gold_interface;');
        expect(src).toContain('if_openmain(crafting_jewelry);');
        expect(ifacePack.byName.get('crafting_jewelry')).toBe(JEWELRY.ROOT);
    });

    test('⛔ the answer is INV_BUTTON on a transmitted inv, not IF_BUTTON', () => {
        for (const r of JEWELRY_ROWS) {
            expect(r.buttons).toEqual({ 1: 1, 5: 2, 10: 3 });
            expect(src).toContain(`[inv_button1,crafting_jewelry:${r.group}_inv] @craft_gold(${r.dummyInv}, last_slot, 1);`);
            expect(src).toContain(`[inv_button2,crafting_jewelry:${r.group}_inv] @craft_gold(${r.dummyInv}, last_slot, 5);`);
            expect(src).toContain(`[inv_button3,crafting_jewelry:${r.group}_inv] @craft_gold(${r.dummyInv}, last_slot, 10);`);
            expect(src).toContain(`inv_transmit(${r.dummyInv}, crafting_jewelry:${r.group}_inv);`);
        }
        // there is no if_button binding on these rows anywhere
        expect(src).not.toMatch(/\[if_button,crafting_jewelry:\w+_inv\]/);
    });

    test('three rows, six slots each; slot 0 is gemless and 1..5 each need their gem', () => {
        expect(JEWELRY_ROWS.length).toBe(3);
        expect(JEWELRY_ROWS.map(r => r.group).sort()).toEqual(['amulets', 'necklaces', 'rings']);
        for (const r of JEWELRY_ROWS) {
            expect(r.slots.length).toBe(6);
            expect(r.slots.map(s => s.slot)).toEqual([0, 1, 2, 3, 4, 5]);
            expect(r.slots[0]!.gem).toBeNull();
            expect(r.slots[0]!.slotObjId).toBe(r.slots[0]!.productObj);   // the real obj, not a placeholder
            for (const s of r.slots.slice(1)) {
                expect(s.gem).not.toBeNull();
                expect(s.slotObjId).not.toBe(s.productObj);               // an invis_* placeholder
                expect(src).toContain(`inv_setslot(${r.dummyInv}, ${s.slot}, ${s.slotObj}, 1);`);
            }
            expect(JEWELRY_ROW_BY_GROUP[r.group]).toBe(r);
            expect(JEWELRY_ROW_BY_COM.get(r.com)).toBe(r);
        }
    });

    test('the gem order is sapphire/emerald/ruby/diamond/dragonstone in every row', () => {
        for (const r of JEWELRY_ROWS) {
            expect(r.slots.slice(1).map(s => s.gem)).toEqual(['sapphire', 'emerald', 'ruby', 'diamond', 'dragonstone']);
        }
    });

    test('each row is gated on its own mould', () => {
        expect(Object.keys(JEWELRY_MOULDS).sort()).toEqual(['amulet', 'necklace', 'ring']);
        for (const [k, m] of Object.entries(JEWELRY_MOULDS)) {
            expect(m.name).toBe(`${k}_mould`);
            expect(objPack.byName.get(m.name)).toBe(m.obj);
            expect(src).toContain(`if (inv_total(inv, ${m.name}) > 0) {`);
        }
    });

    test('⛔ a perfect gold bar pre-empts the normal one AND suppresses the success message', () => {
        expect(src).toContain('if (inv_total(inv, perfect_gold_bar) >= 1) {');
        expect(src).toContain('$bar = perfect_gold_bar;');
        expect(src).toContain('if ($bar = gold_bar) {');   // the mes() is inside this guard
    });
});

// =====================================================================================================
// 8. STRINGING
// =====================================================================================================
describe('STRINGING matches stringing.rs2', () => {
    const src = script('skill_crafting/scripts/jewellery/stringing.rs2');

    test('one packet per amulet, flat 40 xp, no level check', () => {
        expect(src).toContain('[opheldu,ball_of_wool]');
        expect(src).toContain('@string_amulet(last_useslot);');
        expect(src).toContain(`stat_advance(crafting, ${STRING_XP});`);
        expect(src).not.toContain('stat(crafting) <');
        expect(STRING_XP).toBe(40);
    });

    test('every stringable is in the ball_of_wool switch and maps to a different strung obj', () => {
        expect(STRINGABLE.length).toBe(8);
        for (const s of STRINGABLE) {
            expect(src).toContain(s.unstrung);
            expect(s.strungObj).not.toBe(s.unstrungObj);
            expect(STRINGABLE_BY_OBJ.get(s.unstrungObj)).toBe(s);
        }
    });

    test('the members-only pair is exactly the dragonstone amulet and the unholy symbol', () => {
        expect(STRINGABLE.filter(s => s.members).map(s => s.unstrung).sort())
            .toEqual(['nostringsnake', 'unstrung_dragonstone_amulet']);
    });

    test('the echoed noun defaults to "amulet" for the gem amulets and is custom for the symbols', () => {
        expect(STRINGABLE_BY_OBJ.get(STRINGABLE.find(s => s.unstrung === 'nostringstar')!.unstrungObj)!.stringingName)
            .toBe('holy symbol');
        expect(STRINGABLE.find(s => s.unstrung === 'unstrung_ruby_amulet')!.stringingName).toBe('amulet');
    });

    test('every strung amulet the enchant table consumes comes out of this table', () => {
        const strung = new Set(STRINGABLE.map(s => s.strungObj));
        for (const s of ENCHANT_SPELLS) {
            const amulet = s.conversions.find(c => c.from.startsWith('strung_'));
            if (amulet) expect(strung.has(amulet.fromObj)).toBe(true);
        }
    });
});

// =====================================================================================================
// 9. ENCHANT
// =====================================================================================================
describe('ENCHANT matches enchant.rs2, magic.if and magic_spells.dbrow', () => {
    const src = script('skill_magic/scripts/spells/enchant.rs2');
    const magicIf = script('skill_magic/interfaces/magic.if');

    test('five tiers, each bound by opheldt to its own magic-tab component', () => {
        expect(ENCHANT_SPELLS.map(s => s.tier)).toEqual([1, 2, 3, 4, 5]);
        for (const s of ENCHANT_SPELLS) {
            expect(src).toContain(`[opheldt,${s.comName}]@magic_spell_enchant(^${s.constant}, last_slot);`);
            expect(ENCHANT_BY_TIER.get(s.tier)).toBe(s);
        }
    });

    test('⛔ each spell component is actiontarget=heldobj — OpHeldTHandler rejects anything else', () => {
        for (const s of ENCHANT_SPELLS) {
            const section = magicIf.slice(magicIf.indexOf(`[${s.comName.split(':')[1]}]`));
            expect(section.slice(0, section.indexOf('\n[', 1))).toContain('actiontarget=heldobj');
        }
        const handler = readText('../../../engine/src/network/game/client/handler/OpHeldTHandler.ts');
        expect(handler).toContain('(spellCom.actionTarget & ComActionTarget.HELD) === 0');
    });

    test('⛔ the item is REPLACED IN PLACE — inventory length does not change on success', () => {
        expect(script('skill_magic/scripts/spells/enchant.rs2')).toContain('inv_setslot(inv, $slot, $final_obj, 1);');
    });

    test('levels and xp match the dbrow, and every tier needs a cosmic rune', () => {
        expect(ENCHANT_SPELLS.map(s => s.level)).toEqual([7, 27, 49, 57, 68]);
        expect(ENCHANT_SPELLS.map(s => s.xp)).toEqual([175, 370, 590, 670, 780]);
        for (const s of ENCHANT_SPELLS) {
            expect(s.runes.some(r => r.rune === 'cosmicrune' && r.count === 1)).toBe(true);
        }
        expect(ENCHANT_SPELLS.filter(s => s.members).map(s => s.tier)).toEqual([5]);
    });

    test('ENCHANT_BY_TARGET indexes every conversion and never collides', () => {
        const total = ENCHANT_SPELLS.reduce((n, s) => n + s.conversions.length, 0);
        expect(ENCHANT_BY_TARGET.size).toBe(total);
        for (const s of ENCHANT_SPELLS) for (const c of s.conversions) {
            const hit = ENCHANT_BY_TARGET.get(c.fromObj)!;
            expect(hit.spell.tier).toBe(s.tier);
            expect(hit.result.toObj).toBe(c.toObj);
        }
    });

    test('the unstrung-amulet hint points at the amulet the stringing table produces the input for', () => {
        for (const s of ENCHANT_SPELLS) {
            expect(s.unstrungObj).not.toBeNull();
            expect(s.unstrungMessage).toContain('before enchanting it.');
            const row = STRINGABLE_BY_OBJ.get(s.unstrungObj!)!;
            expect(row).toBeDefined();
            expect(s.conversions.some(c => c.fromObj === row.strungObj)).toBe(true);
        }
    });
});

// =====================================================================================================
// 10. MESSAGES + PROVENANCE
// =====================================================================================================
describe('every message literal is still present in the script it came from', () => {
    const cases: [string, string][] = [
        ['skill_woodcutting/scripts/woodcut.rs2', MESSAGES.woodcutting.swing],
        ['skill_woodcutting/scripts/woodcut.rs2', MESSAGES.woodcutting.noAxe],
        ['skill_woodcutting/scripts/woodcut.rs2', MESSAGES.woodcutting.invFull],
        ['skill_firemaking/scripts/firemaking.rs2', MESSAGES.firemaking.attempt],
        ['skill_firemaking/scripts/firemaking.rs2', MESSAGES.firemaking.success],
        ['skill_firemaking/scripts/firemaking.rs2', MESSAGES.firemaking.noSpace],
        ['skill_firemaking/scripts/firemaking.rs2', MESSAGES.firemaking.noTinderbox],
        ['skill_fletching/scripts/cut_logs.rs2', MESSAGES.fletching.shortbow],
        ['skill_fletching/scripts/cut_logs.rs2', MESSAGES.fletching.longbow],
        ['skill_fletching/scripts/bows.rs2', MESSAGES.fletching.bowStrung],
        ['skill_crafting/scripts/leather/leather.rs2', MESSAGES.leather.noThread],
        ['skill_crafting/scripts/leather/leather.rs2', MESSAGES.leather.threadLast],
        ['skill_crafting/scripts/jewellery/jewellery.rs2', MESSAGES.jewelry.noBars],
        ['skill_crafting/scripts/jewellery/jewellery.rs2', MESSAGES.jewelry.noMould],
        ['skill_magic/scripts/magic.rs2', MESSAGES.enchant.lowLevel],
        ['skill_magic/scripts/magic.rs2', MESSAGES.enchant.membersSpell],
    ];
    for (const [rel, text] of cases) {
        test(`${rel} still contains ${JSON.stringify(text.slice(0, 40))}`, () => {
            expect(script(rel)).toContain(`"${text}"`);
        });
    }

    test('interpolated messages are prefix/suffix pairs, never a whole sentence', () => {
        // The interpolated middle is an obj/level/name the brain does not control, so a full-sentence
        // match would never fire. These must stay open-ended.
        expect(MESSAGES.woodcutting.getPrefix.endsWith(' ')).toBe(true);
        expect(MESSAGES.enchant.noRunesPrefix.endsWith(' ')).toBe(true);
        expect(MESSAGES.enchant.noRunesSuffix.startsWith(' ')).toBe(true);
        expect(MESSAGES.fletching.shaftsSuffix.startsWith(' ')).toBe(true);
    });

    test('the "nothing interesting happens" fallback matches the displaymessage enum', () => {
        expect(readText(`${CONTENT}scripts/general/configs/displaymessage.enum`))
            .toContain(`val=^dm_default,${MESSAGES.nothingHappens}`);
    });
});

describe('SKILLING_PROVENANCE counters match the tables they describe', () => {
    // A hand-edit of skilling-tables.ts moves a table but not the counter — that is what this catches.
    test('every counter equals the live length', () => {
        expect(TREES.length).toBe(SKILLING_PROVENANCE.trees);
        expect(LOGS.length).toBe(SKILLING_PROVENANCE.logs);
        expect(FLETCH_LOGS.length).toBe(SKILLING_PROVENANCE.fletchLogs);
        expect(BOW_STRINGING.length).toBe(SKILLING_PROVENANCE.bowStringing);
        expect(LEATHER_PRODUCTS.length).toBe(SKILLING_PROVENANCE.leatherProducts);
        expect(DHIDE.length).toBe(SKILLING_PROVENANCE.dhide);
        expect(JEWELRY_ROWS.length).toBe(SKILLING_PROVENANCE.jewelryRows);
        expect(STRINGABLE.length).toBe(SKILLING_PROVENANCE.stringable);
        expect(ENCHANT_SPELLS.length).toBe(SKILLING_PROVENANCE.enchantSpells);
        expect(SKILL_MULTI.length).toBe(SKILLING_PROVENANCE.skillMulti);
    });

    test('the runtime record counts still match the packed configs', () => {
        expect(OBJ_DAT_COUNT).toBe(SKILLING_PROVENANCE.objDatRecords);
        expect(LOC_DAT_COUNT).toBe(SKILLING_PROVENANCE.locDatRecords);
    });

    test('the sym divergence counters still describe reality', () => {
        expect(SKILLING_PROVENANCE.symDivergent).toBe(1);      // leather_crafting:com_89
        expect(SKILLING_PROVENANCE.symAbsent).toBeGreaterThan(0);
    });

    test('the tool-first OPHELDU convention is asserted, not assumed', () => {
        expect(OPHELDU_TOOL_FIRST).toBe(true);
        // each of the four tools has its own [opheldu,<tool>] trigger, which is WHY tool-first works
        expect(script('skill_cooking/scripts/gnome_cooking/cutting_fruit.rs2')).toContain('[opheldu,knife]');
        expect(script('skill_firemaking/scripts/firemaking.rs2')).toContain('[opheldu,tinderbox]');
        expect(script('skill_crafting/scripts/leather/leather.rs2')).toContain('[opheldu,needle]');
        expect(script('skill_crafting/scripts/jewellery/stringing.rs2')).toContain('[opheldu,ball_of_wool]');
    });
});

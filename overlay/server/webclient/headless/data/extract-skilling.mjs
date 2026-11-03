#!/usr/bin/env bun
// SKILLING CAPABILITY EXTRACTOR — emits `headless/skilling-tables.ts`, the id + recipe tables the
// headless stack needs for the seven skills the browser SDK has and the headless client does not:
// chopTree, burnLogs, fletchLogs, craftLeather, craftJewelry, enchantItem, stringAmulet.
//
// ⛔ WHY GENERATED AND NOT SCANNED AT RUNTIME.
// The browser SDK discovers "which button makes a leather body?" by walking the loaded interface tree
// and reading component TEXT ("Make @lre@Leather body"). leanclient deliberately never builds the
// interface cache — no OnDemand worker, no config tables — so that scan does not exist headless. The
// same facts live in the packer's frozen id tables and in the content scripts that bind them, so we
// resolve them OFFLINE and check the result in.
//
// =================================================================================================
// ⛔ WHICH ID TABLE IS THE TRUTH — this generator DISAGREES with extract-capabilities.mjs, on evidence
// =================================================================================================
// extract-capabilities.mjs asserts that `server/engine/data/symbols/*.sym` is the live id set and
// refuses to emit any id absent from it. For the ids IT emits, pack and sym happen to agree, so its
// output is correct. For THIS package that rule would be fatally wrong, and the interface it breaks on
// is the one craftLeather is built out of:
//
//   leather_crafting:com_113  (the "Make Leather body" button)
//     server/content/pack/interface.pack ............. 8635
//     server/engine/data/pack/server/interface.dat ... 8635   <- the file the RUNNING engine loads
//     server/engine/data/symbols/component.sym ....... ABSENT (sym stops at com_110 = 2422)
//
// Three independent proofs that `.pack` is the truth and `.sym` is a stale build leftover:
//
//   1. The RuneScript compiler READS THE PACK. `server/engine/tools/pack/Compiler.ts:181`:
//          const componentInfo = CompilerTypeInfo.load(`${srcDir}/pack/interface.pack`);
//      Every id namespace it resolves (obj, loc, component, varp, ...) is loaded from
//      `server/content/pack/*.pack`. `data/symbols/*.sym` is never an input to it — it is a build
//      OUTPUT, and this checkout's copy is stale (symbols mtime 10:59, pack + all compiled
//      artifacts 14:26). So `[if_button,leather_crafting:com_113]` compiled to id 8635.
//
//   2. THE RUNTIME ARTIFACT AGREES WITH THE PACK, NOT THE SYM. `data/pack/server/interface.dat` is the
//      id->debugname table `Component.decodeExtra()` loads at engine boot; decoding it gives
//      8635 = "leather_crafting:com_113", exactly the pack. Both the client archive
//      (`data/pack/client/interface`) and this server table are written by the SAME
//      `packInterface()` call (PackClient.ts:37-44), from interface.pack — so client and server cannot
//      desync, which is the failure the sym check was written to prevent.
//
//   3. A LIVE-PROVEN ID CONFIRMS IT. leanbot.ts already high-alchs with spellCom 1178, and
//      interface.pack says 1178 = magic:highlvl_alchemy. A pack id is what the live server accepts.
//
// So this generator's cross-check is:
//     PRIMARY   server/content/pack/interface.pack           (the compiler's own input)
//     REQUIRED  server/engine/data/pack/server/interface.dat  (what the engine loads; must agree)
//     ADVISORY  server/engine/data/symbols/component.sym      (recorded on divergence, NEVER used)
// Every component id emitted below passed PRIMARY == REQUIRED. Divergences against the advisory sym
// are counted and printed in the emitted header so a future reader can see exactly where the stale
// artifact lies, instead of trusting a global "all clear" this repo cannot give.
//
// obj/loc ids come from obj.pack / loc.pack (same packer run, same frozen assignment — the house
// precedent, extract-gear.mjs:175 / extract-weapons.mjs:204) and are BOUND-CHECKED against the record
// count in the leading g2 of `data/pack/server/{obj,loc}.dat`, so an emitted id always addresses a
// real record in the file the engine actually reads.
//
// SOURCES (every one re-cited in the emitted provenance block):
//   server/content/pack/{interface,obj,loc}.pack            frozen id=name assignment
//   server/engine/data/pack/server/{interface,obj,loc}.dat  the runtime tables (cross-check)
//   interface_chat/scripts/chat.rs2                         skill_multiN: which button -> which
//                                                           (product slot, count). THE binding.
//   interface_chat/interfaces/skill_multi{2,3,4,5}.if       component layout of those dialogs
//   skill_woodcutting/scripts/woodcut.rs2                   oploc1 -> chop; axe list; messages
//   skill_woodcutting/configs/trees.dbrow                   tree loc -> product/level/xp/respawn
//   skill_firemaking/scripts/firemaking.rs2                 opheldu tinderbox / opobj4 ground light
//   skill_firemaking/configs/firemaking.obj                 log -> levelrequire / productexp
//   skill_fletching/scripts/cut_logs.rs2 + bows.rs2         knife->log (skill_multiN), bowstring
//   skill_fletching/configs/cut_logs/cut_logs.dbrow         fletch_bow_table
//   skill_fletching/configs/stringing/bows.dbrow            fletching_table (bow stringing)
//   skill_cooking/scripts/gnome_cooking/cutting_fruit.rs2   [opheldu,knife] — the trigger that ACTUALLY
//                                                           routes fletching (see FLETCHING notes)
//   skill_crafting/scripts/leather/leather.rs2              needle->leather; if_button -> product,count
//   skill_crafting/configs/leather/leather.dbrow            craft_leather_table + dhide_interface_table
//   skill_crafting/scripts/jewellery/jewellery.rs2          furnace interface; inv_buttonN -> count
//   skill_crafting/scripts/jewellery/stringing.rs2          ball_of_wool -> unstrung amulet
//   skill_crafting/configs/jewellery/*                      moulds, invis objs, struct params
//   skill_magic/scripts/spells/enchant.rs2                  [opheldt,magic:enchant_lvlN]
//   skill_magic/configs/magic_spells.dbrow                  enchant level/runes/xp/convertobj
//   general/configs/free_to_play.constant                   members refusal strings
//   general/configs/displaymessage.enum                     ^dm_default text
//
// Run: bun server/webclient/headless/data/extract-skilling.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const CONTENT = path.join(ROOT, 'server/content');
const SCRIPTS = path.join(CONTENT, 'scripts');
const PACK = path.join(CONTENT, 'pack');
const ENGINE_PACK = path.join(ROOT, 'server/engine/data/pack');
const SYMBOLS = path.join(ROOT, 'server/engine/data/symbols');
const OUT = path.join(import.meta.dir, '..', 'skilling-tables.ts');

const die = (msg) => { console.error(`[skill-extract] FATAL: ${msg}`); process.exit(1); };
const read = (p) => { if (!fs.existsSync(p)) die(`missing source ${p}`); return fs.readFileSync(p, 'utf8'); };
const rs = (rel) => read(path.join(SCRIPTS, rel));

// =================================================================================================
// ID TABLES
// =================================================================================================
function readPack(file) {
    const byName = new Map(), byId = new Map();
    let max = -1;
    for (const line of read(path.join(PACK, file)).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        const id = Number(t.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        const name = t.slice(eq + 1);
        byName.set(name, id);
        byId.set(id, name);
        if (id > max) max = id;
    }
    return { byName, byId, max };
}

const iface = readPack('interface.pack');
const objs = readPack('obj.pack');
const locs = readPack('loc.pack');

/** `data/pack/server/interface.dat` — the id<->debugname table Component.decodeExtra() loads at boot.
 *  Format (PackShared.ts): g2 header, then repeating [g2 id][jstr(\n) debugname][g1 overlay]. */
function readRuntimeInterfaceNames() {
    const file = path.join(ENGINE_PACK, 'server/interface.dat');
    if (!fs.existsSync(file)) die(`missing runtime table ${file} — run the packer before regenerating`);
    const buf = fs.readFileSync(file);
    let p = 0;
    const g1 = () => buf[p++];
    const g2 = () => { const v = (buf[p] << 8) | buf[p + 1]; p += 2; return v; };
    const gjstr = () => { let s = ''; while (p < buf.length && buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
    const header = g2();
    const byName = new Map(), byId = new Map();
    while (p < buf.length) { const id = g2(); const name = gjstr(); g1(); byName.set(name, id); byId.set(id, name); }
    return { byName, byId, header };
}
const runtimeIface = readRuntimeInterfaceNames();

/** Leading g2 of a server config .dat = the record count (see ObjType.parse / LocType.parse). */
function readDatCount(rel) {
    const file = path.join(ENGINE_PACK, rel);
    if (!fs.existsSync(file)) die(`missing runtime table ${file}`);
    const buf = fs.readFileSync(file);
    return (buf[0] << 8) | buf[1];
}
const OBJ_DAT_COUNT = readDatCount('server/obj.dat');
const LOC_DAT_COUNT = readDatCount('server/loc.dat');

/** ADVISORY only. Loaded so divergences can be REPORTED; never used to resolve an id. */
function loadSym(file) {
    const p = path.join(SYMBOLS, file);
    if (!fs.existsSync(p)) return null;
    const m = new Map();
    for (const line of read(p).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const [idStr, name] = t.split('\t');
        const id = Number(idStr);
        if (Number.isFinite(id) && name) m.set(name, id);
    }
    return m;
}
const componentSym = loadSym('component.sym');
const interfaceSym = loadSym('interface.sym');

let comLookups = 0;
const symDivergent = [];   // { name, pack, sym } — sym disagrees
const symMissing = [];     // name — sym has no entry at all (stale artifact, pre-dates the component)

/** Resolve a component/interface id. PRIMARY=interface.pack, REQUIRED cross-check=runtime interface.dat. */
function com(name) {
    const packId = iface.byName.get(name);
    if (packId === undefined) die(`component '${name}' not in interface.pack`);
    const rtId = runtimeIface.byName.get(name);
    if (rtId === undefined) {
        die(`component '${name}' is in interface.pack (${packId}) but NOT in the runtime table ` +
            `data/pack/server/interface.dat — the engine cannot address it. Refusing to emit.`);
    }
    if (rtId !== packId) {
        die(`component '${name}' DISAGREES: interface.pack=${packId} runtime interface.dat=${rtId}. ` +
            `Repack before regenerating — a hard-coded id here would address the wrong component.`);
    }
    const symId = componentSym?.get(name) ?? interfaceSym?.get(name);
    if (symId === undefined) symMissing.push(name);
    else if (symId !== packId) symDivergent.push({ name, pack: packId, sym: symId });
    comLookups++;
    return packId;
}

function obj(name) {
    const id = objs.byName.get(name);
    if (id === undefined) die(`obj '${name}' not in obj.pack`);
    if (id >= OBJ_DAT_COUNT) die(`obj '${name}' id ${id} is beyond the runtime obj.dat record count ${OBJ_DAT_COUNT}`);
    return id;
}
function loc(name) {
    const id = locs.byName.get(name);
    if (id === undefined) return null;   // a few tree loc names are map-only aliases; caller decides
    if (id >= LOC_DAT_COUNT) die(`loc '${name}' id ${id} is beyond the runtime loc.dat record count ${LOC_DAT_COUNT}`);
    return id;
}

// =================================================================================================
// GENERIC CONFIG PARSERS
// =================================================================================================
/** `[section]` then `key=value` lines. Repeats collected into arrays. */
function parseSections(src) {
    const out = new Map();
    let cur = null;
    for (const raw of src.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;
        const sec = /^\[([^\]]+)\]$/.exec(line);
        if (sec) { cur = { name: sec[1], keys: new Map() }; out.set(sec[1], cur); continue; }
        if (!cur) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const k = line.slice(0, eq), v = line.slice(eq + 1);
        if (!cur.keys.has(k)) cur.keys.set(k, []);
        cur.keys.get(k).push(v);
    }
    return out;
}

/** A .dbrow file: sections whose `data=<column>,<v1>,<v2>...` lines carry the row's fields. */
function parseDbrows(src) {
    const out = new Map();
    for (const [name, sec] of parseSections(src)) {
        const data = new Map();
        for (const d of sec.keys.get('data') ?? []) {
            const comma = d.indexOf(',');
            const col = comma < 0 ? d : d.slice(0, comma);
            const rest = comma < 0 ? '' : d.slice(comma + 1);
            if (!data.has(col)) data.set(col, []);
            data.get(col).push(rest);
        }
        out.set(name, { name, table: (sec.keys.get('table') ?? [])[0] ?? null, data });
    }
    return out;
}
const field = (row, col, i = 0) => (row.data.get(col) ?? [])[i];
const fieldAll = (row, col) => row.data.get(col) ?? [];
const intField = (row, col, dflt = null) => {
    const v = field(row, col);
    if (v === undefined) return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
};

/** A .obj / .struct file: sections with `param=<name>,<value>` lines plus plain keys. */
function parseConfigs(src) {
    const out = new Map();
    for (const [name, sec] of parseSections(src)) {
        const params = new Map();
        for (const p of sec.keys.get('param') ?? []) {
            const comma = p.indexOf(',');
            if (comma < 0) continue;
            params.set(p.slice(0, comma), p.slice(comma + 1));
        }
        out.set(name, { name, params, keys: sec.keys });
    }
    return out;
}
const key1 = (cfg, k) => (cfg.keys.get(k) ?? [])[0];

// =================================================================================================
// SKILL_MULTI — the "What would you like to make?" chat dialogs (2..5 products x make 1/5/10/X)
// =================================================================================================
// chat.rs2's `[proc,skill_multiN]` is the ONLY authoritative statement of which component means which
// (product slot, count). It registers every button with if_addresumebutton, pauses, then resolves:
//     case skill_multi3:make10_b : return($obj2, 10);
// i.e. slot 'b' = the 2nd product, and make10 = a count of 10. `makex_*` instead runs p_countdialog and
// returns last_int, so the X buttons need a follow-up RESUME_P_COUNTDIALOG. Both facts are PARSED, not
// assumed — nothing here derives a component id or a count arithmetically.
//
// ⛔ THESE ARE RESUME BUTTONS, NOT PLAIN if_button HANDLERS. IfButtonHandler routes a click on a
// registered resume button back into the SUSPENDED script (player.resumeButtons + ScriptState.PAUSEBUTTON)
// — there is no [if_button,skill_multi3:make1_a] trigger anywhere in the content. The wire packet is
// still IF_BUTTON on the component id; RESUME_PAUSEBUTTON is explicitly REFUSED while a choice is
// pending (ResumePauseButtonHandler.ts:15-19), so answering these with the dialog-continue primitive
// silently does nothing.
function parseSkillMulti() {
    const src = rs('interface_chat/scripts/chat.rs2');
    // one entry per skill_multiN interface: slot letter -> { objIndex, buttons: {count -> comName} }
    const byIface = new Map();
    const reCase = /^case\s+(skill_multi\d):(make(?:1|5|10|x))_([a-e])\s*:\s*(?:$|return\(\$obj(\d+),\s*(\d+)\))/;
    const lines = src.split('\n').map(s => s.trim());
    for (let i = 0; i < lines.length; i++) {
        const m = reCase.exec(lines[i]);
        if (!m) continue;
        const [, ifName, kind, slot] = m;
        let objIndex = m[4] !== undefined ? Number(m[4]) : null;
        let count = m[5] !== undefined ? Number(m[5]) : null;
        if (objIndex === null) {
            // `case skill_multiN:makex_a :` spans lines: p_countdialog; return($objK, last_int);
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                const r = /^return\(\$obj(\d+),\s*last_int\)/.exec(lines[j]);
                if (r) { objIndex = Number(r[1]); count = 'X'; break; }
                if (!/^p_countdialog;?$/.test(lines[j])) break;
            }
        }
        if (objIndex === null) die(`could not resolve the product index for ${ifName}:${kind}_${slot}`);
        if (!byIface.has(ifName)) byIface.set(ifName, new Map());
        const slots = byIface.get(ifName);
        if (!slots.has(slot)) slots.set(slot, { slot, objIndex, buttons: new Map() });
        const entry = slots.get(slot);
        if (entry.objIndex !== objIndex) die(`${ifName} slot ${slot} maps to both $obj${entry.objIndex} and $obj${objIndex}`);
        entry.buttons.set(count, `${ifName}:${kind}_${slot}`);
    }
    if (!byIface.size) die('parsed no skill_multiN resolutions from chat.rs2');
    return byIface;
}

const skillMultiRaw = parseSkillMulti();
const SKILL_MULTI = [...skillMultiRaw].sort((a, b) => a[0].localeCompare(b[0])).map(([ifName, slots]) => {
    // cross-check the parsed layout against the interface's own component list
    const ifSrc = read(path.join(SCRIPTS, `interface_chat/interfaces/${ifName}.if`));
    const declared = new Set([...parseSections(ifSrc).keys()]);
    const ordered = [...slots.values()].sort((a, b) => a.objIndex - b.objIndex);
    if (ordered.length !== Number(ifName.slice(-1))) {
        die(`${ifName}: parsed ${ordered.length} product slots, expected ${ifName.slice(-1)}`);
    }
    return {
        iface: ifName,
        root: com(ifName),
        prompt: declared.has('prompt') ? com(`${ifName}:prompt`) : null,
        slots: ordered.map(s => {
            for (const need of [`model_${s.slot}`, `make1_${s.slot}`, `make5_${s.slot}`, `make10_${s.slot}`, `makex_${s.slot}`]) {
                if (!declared.has(need)) die(`${ifName}.if has no [${need}] section`);
            }
            const want = [1, 5, 10, 'X'];
            for (const c of want) if (!s.buttons.has(c)) die(`${ifName} slot ${s.slot} has no make-${c} resolution in chat.rs2`);
            return {
                slot: s.slot,
                index: s.objIndex - 1,                       // 0-based product index
                model: com(`${ifName}:model_${s.slot}`),
                make1: com(s.buttons.get(1)),
                make5: com(s.buttons.get(5)),
                make10: com(s.buttons.get(10)),
                makeX: com(s.buttons.get('X')),
            };
        }),
    };
});

// =================================================================================================
// WOODCUTTING — OPLOC1 on the tree; the server drives every subsequent swing itself
// =================================================================================================
// woodcut.rs2: `[oploc1,_tree] @attempt_cut_tree;` then the script re-arms itself with p_oploc(3) each
// cycle, so ONE OPLOC1 starts a sustained chop that only ends when the tree depletes, the inventory
// fills, or the player moves. `[oploc3,_tree]` is the hidden continuation op — a bot must never send it.
const woodcutSrc = rs('skill_woodcutting/scripts/woodcut.rs2');
if (!/^\[oploc1,_tree\]\s*@attempt_cut_tree;/m.test(woodcutSrc)) die('woodcut.rs2 no longer binds oploc1 on _tree');
if (!/^\[oploc3,_tree\]\s*@cut_tree;/m.test(woodcutSrc)) die('woodcut.rs2 no longer binds oploc3 on _tree');

// The axe list, in the order woodcutting_axe_checker() tests it — that order IS the preference (best
// first), and the checker accepts an axe in the RIGHT HAND or in the backpack. There is no woodcutting
// level requirement on any axe in this content (the level-gated branch is commented out, with sources).
// ⛔ COMMENTS MUST BE STRIPPED FIRST. woodcut.rs2 keeps the ORIGINAL level-gated checker commented out
// directly above the live one, in the same shape — matching the raw file yields each axe TWICE, in an
// order that happens to look right. Strip `//` lines and the parse is the live function only.
const woodcutLive = woodcutSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const axeNames = [...woodcutLive.matchAll(/\(\$obj1\s*=\s*(\w+)\s*\|\s*inv_total\(inv,\s*\1\)\s*>\s*0\)/g)].map(m => m[1]);
if (axeNames.length !== 7) die(`woodcutting_axe_checker parsed ${axeNames.length} axes, expected exactly 7`);
if (new Set(axeNames).size !== axeNames.length) die(`woodcutting_axe_checker parse produced duplicates: ${axeNames.join(', ')}`);

const treeRows = parseDbrows(read(path.join(SCRIPTS, 'skill_woodcutting/configs/trees.dbrow')));
const TREES = [];
const treeSkippedLocs = [];
for (const [name, row] of treeRows) {
    if (row.table !== 'woodcutting_trees') continue;
    const locNames = fieldAll(row, 'tree');
    const resolved = [];
    for (const n of locNames) {
        const id = loc(n);
        if (id === null) { treeSkippedLocs.push(`${name}:${n}`); continue; }
        resolved.push({ name: n, id });
    }
    if (!resolved.length) die(`tree table '${name}' resolved to zero loc ids`);
    const productName = field(row, 'product');
    // successchance rows: `<axe>,<low>,<high>` — the per-axe roll band. Emitted so a brain can rank
    // tree x axe without re-deriving it; absent for the jungle table, which has no axe roll at all.
    const chance = {};
    for (const sc of fieldAll(row, 'successchance')) {
        const [axe, lo, hi] = sc.split(',');
        chance[axe] = [Number(lo), Number(hi)];
    }
    TREES.push({
        table: name,
        level: intField(row, 'levelrequired', 0),
        xp: intField(row, 'productexp', 0),
        product: productName,
        productObj: obj(productName),
        respawn: intField(row, 'respawnrate', 0),
        locs: resolved,
        successChance: chance,
    });
}
if (!TREES.length) die('parsed no woodcutting tree tables');

// =================================================================================================
// FIREMAKING — two independent routes, both already expressible with existing headless primitives
// =================================================================================================
//   INVENTORY  OPHELDU tinderbox -> logs. Reaches [opheldu,tinderbox] (firemaking.rs2:13), whose
//              `switch_category(oc_category(last_useitem))` sends category_22 to @light_logs_inv.
//              The script DROPS the log to the player's tile first (inv_dropslot), then rolls.
//   GROUND     OPOBJ4 on a log already on the ground ([opobj4,_category_22] -> @light_logs_ground).
// Both re-arm with p_opobj(4) on failure, so one send burns one log to completion (or to a refusal).
// On success ~push_player MOVES THE PLAYER ONE TILE (west, then east, then south, then north — first
// walkable wins), so a firemaking brain must re-read its own tile after every "fire catches".
const fmSrc = rs('skill_firemaking/scripts/firemaking.rs2');
if (!/^\[opobj4,_category_22\]/m.test(fmSrc)) die('firemaking.rs2 no longer binds opobj4 on _category_22');
if (!/^\[opheldu,tinderbox\]/m.test(fmSrc)) die('firemaking.rs2 no longer binds opheldu on tinderbox');
if (!/case category_22\s*:\s*@light_logs_inv\(last_useslot\);/.test(fmSrc)) die('the tinderbox->category_22 arm changed shape');

// Every obj declared `category=category_22` IS a firemaking log as far as the engine is concerned —
// the triggers key on the category, not on a name list. levelrequire/productexp are obj params.
const logSources = ['skill_firemaking/configs/firemaking.obj', 'skill_fletching/configs/ogre/ogre_arrows.obj'];
const LOGS = [];
for (const rel of logSources) {
    for (const [name, cfg] of parseConfigs(read(path.join(SCRIPTS, rel)))) {
        if (key1(cfg, 'category') !== 'category_22') continue;
        const level = cfg.params.get('levelrequire');
        const xp = cfg.params.get('productexp');
        LOGS.push({
            name,
            obj: obj(name),
            level: level === undefined ? 0 : Number(level),     // param default=0
            xp: xp === undefined ? 0 : Number(xp),              // param default=0
            members: key1(cfg, 'members') === 'yes',
            // achey has its own [opheldu,achey_tree_logs] trigger that BEATS [opheldu,tinderbox] when the
            // log is sent as the first pair. It also carries neither param, so it burns for 0 xp.
            hasOwnTrigger: name === 'achey_tree_logs',
        });
    }
}
if (!LOGS.length) die('parsed no category_22 log objs');
LOGS.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

// =================================================================================================
// FLETCHING — knife on logs -> skill_multi2 / skill_multi3; bowstring on an unstrung bow -> immediate
// =================================================================================================
// ⛔ THE TRIGGER THAT ACTUALLY RUNS IS [opheldu,knife], IN skill_cooking. cut_logs.rs2 opens with
// `[opheldu,_category_22] switch_obj(last_useitem) { case knife : @fletch_log(last_item); ... }`, which
// LOOKS like the fletching entry point and is DEAD CODE: OpHeldUHandler resolves specific obj triggers
// before category triggers, and `[opheldu,knife]` exists (cutting_fruit.rs2:1). It falls through its
// fruit cases to `if (oc_category(last_useitem) = category_22) { @fletch_log(last_useitem); }`. Reading
// only cut_logs.rs2 would give a brain the wrong mental model of which script it is talking to.
const knifeSrc = rs('skill_cooking/scripts/gnome_cooking/cutting_fruit.rs2');
if (!/^\[opheldu,knife\]/m.test(knifeSrc)) die('[opheldu,knife] is gone — fletching dispatch changed');
if (!/oc_category\(last_useitem\)\s*=\s*category_22\s*\)\s*\{\s*\n\s*@fletch_log\(last_useitem\);/.test(knifeSrc)) {
    die('[opheldu,knife] no longer routes category_22 to @fletch_log');
}
const cutLogsSrc = rs('skill_fletching/scripts/cut_logs.rs2');
const fletchMembersGate = /\[label,fletch_log\][\s\S]*?if \(map_members = \^false\) \{\s*\n\s*mes\(\^mes_members_fletching\);/.test(cutLogsSrc);
if (!fletchMembersGate) die('fletch_log no longer opens with the map_members gate — recheck the members note');

const fletchBow = parseDbrows(read(path.join(SCRIPTS, 'skill_fletching/configs/cut_logs/cut_logs.dbrow')));
const FLETCH_LOGS = [];
for (const [name, row] of fletchBow) {
    if (row.table !== 'fletch_bow_table') continue;
    const logName = field(row, 'log');
    const shafts = intField(row, 'shafts', 0);
    const [shortName, shortLvl, shortXp] = field(row, 'shortbow').split(',');
    const [longName, longLvl, longXp] = field(row, 'longbow').split(',');
    // cut_logs.rs2: shafts>0 -> skill_multi3(shafts, short, long); shafts<1 -> skill_multi2(short, long).
    // The slot letters are positional in the proc call, so product index N == slot letter N.
    const products = [];
    if (shafts >= 1) {
        products.push({ kind: 'shafts', product: 'arrow_shaft', productObj: obj('arrow_shaft'), count: shafts, level: 1, xp: shafts * 5, label: `${shafts} Arrow Shafts` });
    }
    products.push({ kind: 'shortbow', product: shortName, productObj: obj(shortName), count: 1, level: Number(shortLvl), xp: Number(shortXp), label: 'Short Bow' });
    products.push({ kind: 'longbow', product: longName, productObj: obj(longName), count: 1, level: Number(longLvl), xp: Number(longXp), label: 'Long Bow' });
    FLETCH_LOGS.push({
        table: name,
        log: logName,
        logObj: obj(logName),
        shafts,
        iface: shafts >= 1 ? 'skill_multi3' : 'skill_multi2',
        products,
    });
}
if (!FLETCH_LOGS.length) die('parsed no fletch_bow_table rows');
FLETCH_LOGS.sort((a, b) => a.products[a.products.length - 1].level - b.products[b.products.length - 1].level);

// bow stringing — one bow per OPHELDU, no interface, no count dialog
const bowsSrc = rs('skill_fletching/scripts/bows.rs2');
if (!/^\[opheldu,bow_string\]/m.test(bowsSrc)) die('bows.rs2 no longer binds opheldu on bow_string');
const BOW_STRINGING = [];
for (const [name, row] of parseDbrows(read(path.join(SCRIPTS, 'skill_fletching/configs/stringing/bows.dbrow')))) {
    if (row.table !== 'fletching_table') continue;
    const unstrung = field(row, 'item');
    const [productName, productCount] = field(row, 'product').split(',');
    BOW_STRINGING.push({
        table: name,
        unstrung, unstrungObj: obj(unstrung),
        product: productName, productObj: obj(productName), count: Number(productCount ?? 1),
        level: intField(row, 'level', 1),
        xp: intField(row, 'experience', 0),
    });
}
if (!BOW_STRINGING.length) die('parsed no fletching_table bow rows');
BOW_STRINGING.sort((a, b) => a.level - b.level);

// =================================================================================================
// LEATHER — needle on leather -> if_openmain(leather_crafting); then a plain IF_BUTTON per product/count
// =================================================================================================
// Unlike skill_multiN these ARE real `[if_button,leather_crafting:com_N]` triggers, one per
// (product, count) pair. The interface is a MAIN modal (if_openmain), so IF_BUTTON only lands while
// mainModalId === leather_crafting (Player.isComponentVisible checks com.rootLayer against the open
// modals). @craft_leather starts with if_close, so the modal closes itself on a successful click.
const leatherSrc = rs('skill_crafting/scripts/leather/leather.rs2');
// product -> ordered list of every [if_button,...] binding, WITH THE COUNT THE SCRIPT ACTUALLY PASSES.
// ⛔ We record the real count per component instead of assuming the label. leather.rs2 lines 17-19 bind
// leather_chaps' three buttons to @craft_leather(leather_chaps, 1) / 1 / 1 — the "Make 5" and "Make 10"
// chaps buttons make exactly ONE. Trusting the interface's own `option=Make 10 ...` text (which is what
// the SDK's live text scan reads) would have a brain believe it queued ten and silently get one.
const leatherButtons = new Map();
for (const m of leatherSrc.matchAll(/^\[if_button,(leather_crafting:com_\d+)\]\s*@craft_leather\((\w+),\s*(\d+)\);/gm)) {
    const [, comName, product, countStr] = m;
    if (!leatherButtons.has(product)) leatherButtons.set(product, []);
    leatherButtons.get(product).push({ comName, count: Number(countStr) });
}
if (!leatherButtons.size) die('parsed no leather_crafting if_button bindings');
const leatherClose = /^\[if_button,(leather_crafting:com_\d+)\]\s*if_close;/m.exec(leatherSrc);
if (!leatherClose) die('leather.rs2 has no leather_crafting close button binding');
if (!/case leather\s*:\s*@craft_leather_interface;/.test(leatherSrc)) die('[opheldu,needle] no longer opens the leather interface');
if (!/if_openmain\(leather_crafting\);/.test(leatherSrc)) die('craft_leather_interface no longer if_openmains leather_crafting');

const leatherRows = parseDbrows(read(path.join(SCRIPTS, 'skill_crafting/configs/leather/leather.dbrow')));
const leatherByProduct = new Map();
const DHIDE_LEATHERS = [];
for (const [name, row] of leatherRows) {
    if (row.table === 'craft_leather_table') {
        const product = field(row, 'product');
        const [leatherName, leatherCountStr] = field(row, 'leather').split(',');
        leatherByProduct.set(product, {
            table: name,
            product, productObj: obj(product),
            level: intField(row, 'levelrequired', 1),
            xp: intField(row, 'productexp', 0),
            leather: leatherName, leatherObj: obj(leatherName),
            leatherCount: Number(leatherCountStr ?? 1),
            members: field(row, 'members') === 'true',
            name: field(row, 'name'),
        });
    } else if (row.table === 'dhide_interface_table') {
        const leatherName = field(row, 'leather');
        const items = field(row, 'interface_items').split(',');
        DHIDE_LEATHERS.push({
            table: name,
            color: field(row, 'color'),
            leather: leatherName, leatherObj: obj(leatherName),
            // positional in the ~skill_multi3 call: body, vambraces, chaps
            products: [
                { kind: 'body', product: items[0], productObj: obj(items[0]) },
                { kind: 'vambraces', product: items[1], productObj: obj(items[1]) },
                { kind: 'chaps', product: items[2], productObj: obj(items[2]) },
            ],
        });
    }
}
if (!leatherByProduct.size) die('parsed no craft_leather_table rows');

const LEATHER_PRODUCTS = [];
for (const [product, binds] of leatherButtons) {
    const recipe = leatherByProduct.get(product);
    if (!recipe) die(`leather_crafting binds a button to '${product}' but craft_leather_table has no row for it`);
    if (binds.length !== 3) die(`${product} has ${binds.length} leather_crafting buttons, expected 3`);
    const bindings = binds.map(b => ({ com: com(b.comName), comName: b.comName, count: b.count }));
    const counts = {};
    for (const b of bindings) if (counts[b.count] === undefined) counts[b.count] = b.com;
    // A row is "broken" when the three buttons do not deliver three distinct counts — i.e. the interface
    // offers Make 1 / 5 / 10 but the script does not honour them.
    const distinct = new Set(bindings.map(b => b.count));
    LEATHER_PRODUCTS.push({ ...recipe, buttons: counts, bindings, brokenCounts: distinct.size !== 3 });
}
if (!LEATHER_PRODUCTS.some(p => p.buttons[1] !== undefined)) die('no leather product has a make-1 button');
LEATHER_PRODUCTS.sort((a, b) => a.level - b.level);

// The dhide path does NOT use leather_crafting: needle on a dragonhide runs ~skill_multi3 instead.
if (!/\$product, \$process_count = ~skill_multi3\(\$interface_item1/.test(leatherSrc)) {
    die('craft_dhide_interface no longer uses skill_multi3');
}
// Every dhide product still has to exist in craft_leather_table (that is what @craft_leather looks up).
for (const d of DHIDE_LEATHERS) {
    for (const p of d.products) {
        const r = leatherByProduct.get(p.product);
        if (!r) die(`dhide product '${p.product}' has no craft_leather_table row`);
        p.level = r.level; p.xp = r.xp; p.leatherCount = r.leatherCount; p.members = r.members; p.name = r.name;
    }
}
DHIDE_LEATHERS.sort((a, b) => a.products[0].level - b.products[0].level);

const HARD_LEATHER = leatherByProduct.get('hardleather_body');
if (!HARD_LEATHER) die('no craft_leather_table row for hardleather_body');
if (!/case hard_leather\s*:\s*@craft_leather\(hardleather_body, 1\);/.test(leatherSrc)) {
    die('[opheldu,needle] no longer routes hard_leather straight to a single hardleather_body');
}
// thread: 1 reel per 5 products (%thread_used > 4), and it is a HARD PREREQUISITE for opening at all.
const threadPerN = /if \(%thread_used > (\d+)\) \{/.exec(leatherSrc);
if (!threadPerN) die('could not parse the thread consumption threshold');
const THREAD_USES = Number(threadPerN[1]) + 1;

// =================================================================================================
// JEWELRY — gold bar on a furnace -> if_openmain(crafting_jewelry); INV_BUTTON on a transmitted dummy inv
// =================================================================================================
// This one is NOT an if_button interface: the three product rows are `type=inv` components fed by
// inv_transmit from dummy invs (crafting_make_rings/necklaces/amulets), and the make-1/5/10 options are
// INV_BUTTON ops 1/2/3 on those components — the same primitive shape as the shop and the bank.
// Slot layout is fixed: slot 0 is the gold item (stock1 in jewellery.inv), slots 1..5 are the
// invis_ringN / invis_necklaceN / invis_amuletN placeholders, and the server inv_delslot's a slot when
// the matching gem is absent. So the slot is static but its OCCUPANCY is not — read the transmitted inv.
const jewelSrc = rs('skill_crafting/scripts/jewellery/jewellery.rs2');
const jewelRows = new Map();          // component name -> { inv, buttons: {count -> op} }
for (const m of jewelSrc.matchAll(/^\[inv_button(\d),(crafting_jewelry:(\w+)_inv)\]\s*@craft_gold\((\w+),\s*last_slot,\s*(\d+)\);/gm)) {
    const [, opStr, comName, group, dummyInv, countStr] = m;
    if (!jewelRows.has(comName)) jewelRows.set(comName, { group, comName, dummyInv, buttons: {} });
    jewelRows.get(comName).buttons[Number(countStr)] = Number(opStr);
}
if (jewelRows.size !== 3) die(`expected 3 crafting_jewelry inv rows, parsed ${jewelRows.size}`);
if (!/if_openmain\(crafting_jewelry\);/.test(jewelSrc)) die('craft_gold_interface no longer if_openmains crafting_jewelry');
if (!/case gold_bar, perfect_gold_bar\s*:\s*@craft_gold_interface;/.test(rs('skill_smithing/scripts/smelting/smelting.rs2'))) {
    die('the furnace no longer routes a gold bar to craft_gold_interface');
}

const jewelStructs = parseConfigs(read(path.join(SCRIPTS, 'skill_crafting/configs/jewellery/jewellery.struct')));
const jewelObjFiles = ['rings.obj', 'necklaces.obj', 'amulets.obj', 'silver.obj', 'moulds.obj'];
const jewelObjs = new Map();
for (const f of jewelObjFiles) {
    for (const [n, c] of parseConfigs(read(path.join(SCRIPTS, `skill_crafting/configs/jewellery/${f}`)))) jewelObjs.set(n, c);
}

// slot -> obj name, straight out of jewellery.inv (stock1) + the inv_setslot calls in craft_gold_interface
const jewelInv = parseSections(read(path.join(SCRIPTS, 'skill_crafting/configs/jewellery/jewellery.inv')));
const JEWELRY_ROWS = [];
for (const row of [...jewelRows.values()].sort((a, b) => a.group.localeCompare(b.group))) {
    const invSec = jewelInv.get(row.dummyInv);
    if (!invSec) die(`jewellery.inv has no [${row.dummyInv}]`);
    const stock = (invSec.keys.get('stock1') ?? [])[0];
    if (!stock) die(`${row.dummyInv} has no stock1`);
    const slotObjs = new Map();
    slotObjs.set(0, stock.split(',')[0]);
    for (const m of jewelSrc.matchAll(new RegExp(`inv_setslot\\(${row.dummyInv}, (\\d+), (\\w+), 1\\);`, 'g'))) {
        slotObjs.set(Number(m[1]), m[2]);
    }
    const size = Number((invSec.keys.get('size') ?? [])[0] ?? 0);
    if (slotObjs.size !== size) die(`${row.dummyInv}: parsed ${slotObjs.size} slots but size=${size}`);
    const slots = [...slotObjs].sort((a, b) => a[0] - b[0]).map(([slot, objName]) => {
        const cfg = jewelObjs.get(objName);
        if (!cfg) die(`no obj config for '${objName}'`);
        const structName = cfg.params.get('crafting_jewelry_struct');
        if (!structName) die(`obj '${objName}' has no crafting_jewelry_struct param`);
        const st = jewelStructs.get(structName);
        if (!st) die(`no struct '${structName}'`);
        const product = st.params.get('product');
        const gem = st.params.get('gem') ?? null;
        return {
            slot,
            slotObj: objName, slotObjId: obj(objName),
            struct: structName,
            product, productObj: obj(product),
            gem, gemObj: gem ? obj(gem) : null,
            level: Number(st.params.get('levelrequired')),
            xp: Number(st.params.get('productexp')),
        };
    });
    for (const c of [1, 5, 10]) if (row.buttons[c] === undefined) die(`${row.comName} has no make-${c} inv_button`);
    JEWELRY_ROWS.push({
        group: row.group,
        com: com(row.comName),
        dummyInv: row.dummyInv,
        mouldCom: com(`crafting_jewelry:${row.group.replace(/s$/, '')}_mould`),
        layerCom: com(`crafting_jewelry:${row.group}_layer`),
        buttons: { 1: row.buttons[1], 5: row.buttons[5], 10: row.buttons[10] },
        slots,
    });
}
// the moulds each row needs, read from the gate in craft_gold_interface
const JEWELRY_MOULDS = {};
for (const m of jewelSrc.matchAll(/if \(inv_total\(inv, (\w+_mould)\) > 0\) \{/g)) {
    const mould = m[1];
    JEWELRY_MOULDS[mould.replace(/_mould$/, '')] = { name: mould, obj: obj(mould) };
}
if (Object.keys(JEWELRY_MOULDS).length !== 3) die(`expected 3 jewelry moulds, parsed ${Object.keys(JEWELRY_MOULDS).length}`);
const GOLD_BAR = obj('gold_bar');
const PERFECT_GOLD_BAR = obj('perfect_gold_bar');

// =================================================================================================
// STRINGING — ball of wool on an unstrung amulet. Flat 40 crafting xp, no level check, no interface.
// =================================================================================================
const stringSrc = rs('skill_crafting/scripts/jewellery/stringing.rs2');
if (!/^\[opheldu,ball_of_wool\]/m.test(stringSrc)) die('stringing.rs2 no longer binds opheldu on ball_of_wool');
const stringXp = /stat_advance\(crafting, (\d+)\);/.exec(stringSrc);
if (!stringXp) die('could not parse the stringing xp');
const stringCases = /\[opheldu,ball_of_wool\][\s\S]*?\n\}/.exec(stringSrc)[0];
const STRINGABLE = [];
for (const m of stringCases.matchAll(/case ([\w, ]+?)\s*:\s*(?:@string_amulet|\n)/g)) {
    for (const n of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        if (n === 'regicide_barrel_lid' || n === 'default') continue;
        const cfg = jewelObjs.get(n);
        if (!cfg) continue;                       // e.g. quest symbols defined outside skill_crafting
        const structName = cfg.params.get('crafting_jewelry_struct');
        if (!structName) continue;
        const st = jewelStructs.get(structName);
        if (!st) continue;
        const strung = st.params.get('strung');
        if (!strung) continue;
        STRINGABLE.push({
            unstrung: n, unstrungObj: obj(n),
            strung, strungObj: obj(strung),
            struct: structName,
            stringingName: st.params.get('stringing_name') ?? 'amulet',
            level: Number(st.params.get('levelrequired')),
            members: /case nostringsnake, unstrung_dragonstone_amulet/.test(stringSrc) && (n === 'nostringsnake' || n === 'unstrung_dragonstone_amulet'),
        });
    }
}
if (STRINGABLE.length < 5) die(`parsed only ${STRINGABLE.length} stringable amulets`);
const BALL_OF_WOOL = obj('ball_of_wool');

// =================================================================================================
// ENCHANT — OPHELDT: an inventory item + a magic-tab spell component
// =================================================================================================
// enchant.rs2 binds `[opheldt,magic:enchant_lvlN]`. OpHeldTHandler requires the spell component to
// carry actiontarget=heldobj (ComActionTarget.HELD) and to be VISIBLE — visibility for a tab component
// means the magic interface is in player.tabs, which it is from login. The component's script1..3
// (rune counts, staff worn, magic level) are CLIENT-side greying only; the server re-checks everything
// in ~check_spell_requirements, so a headless bot may fire the packet unconditionally and READ THE
// REFUSAL MESSAGE — it never has to model the on/off state of the spell icon.
const enchantSrc = rs('skill_magic/scripts/spells/enchant.rs2');
const enchantBinds = [...enchantSrc.matchAll(/^\[opheldt,(magic:enchant_lvl(\d))\]@magic_spell_enchant\(\^(\w+), last_slot\);/gm)];
if (enchantBinds.length !== 5) die(`expected 5 enchant spell bindings, parsed ${enchantBinds.length}`);

const magicIf = parseSections(read(path.join(SCRIPTS, 'skill_magic/interfaces/magic.if')));
const spellRows = parseDbrows(read(path.join(SCRIPTS, 'skill_magic/configs/magic_spells.dbrow')));
const ENCHANT_SPELLS = [];
for (const [, comName, lvlStr, constName] of enchantBinds) {
    const tier = Number(lvlStr);
    const sec = magicIf.get(comName.split(':')[1]);
    if (!sec) die(`magic.if has no [${comName.split(':')[1]}] section`);
    if ((sec.keys.get('actiontarget') ?? [])[0] !== 'heldobj') {
        die(`${comName} is not actiontarget=heldobj — OpHeldTHandler would reject the packet`);
    }
    let row = null;
    for (const [, r] of spellRows) {
        if (r.table === 'magic_spell_table' && field(r, 'spell') === `^${constName}`) { row = r; break; }
    }
    if (!row) die(`no magic_spell_table row for ^${constName}`);
    const runes = [];
    for (const part of (field(row, 'runesrequired') ?? '').split(',')) runes.push(part);
    const runeList = [];
    for (let i = 0; i < runes.length; i += 2) {
        if (runes[i] === 'null') continue;
        runeList.push({ rune: runes[i], obj: obj(runes[i]), count: Number(runes[i + 1]) });
    }
    if (!runeList.length) die(`${comName} parsed zero runes`);
    const conversions = fieldAll(row, 'convertobj').map(c => {
        const [from, to] = c.split(',');
        return { from, fromObj: obj(from), to, toObj: obj(to) };
    });
    if (!conversions.length) die(`${comName} has no convertobj rows`);
    const amuletReq = field(row, 'amulet_reqmessage');
    ENCHANT_SPELLS.push({
        tier,
        constant: constName,
        com: com(comName),
        comName,
        level: intField(row, 'levelrequired', 1),
        xp: intField(row, 'experience', 0),
        members: field(row, 'members') === 'true',
        runes: runeList,
        conversions,
        wrongTargetMessage: (field(row, 'additional_reqmessage') ?? '').replace(/^"|"$/g, ''),
        unstrungMessage: amuletReq ? amuletReq.slice(amuletReq.indexOf(',') + 1) : null,
        unstrungObj: amuletReq ? obj(amuletReq.slice(0, amuletReq.indexOf(','))) : null,
    });
}
ENCHANT_SPELLS.sort((a, b) => a.tier - b.tier);

// =================================================================================================
// MESSAGE STRINGS — the only success/failure signal a headless brain gets for most of this
// =================================================================================================
const f2p = read(path.join(SCRIPTS, 'general/configs/free_to_play.constant'));
const constStr = (name) => {
    const m = new RegExp(`^\\^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(f2p);
    if (!m) die(`constant ^${name} not found`);
    return m[1];
};
const dmEnum = read(path.join(SCRIPTS, 'general/configs/displaymessage.enum'));
const dmDefault = /^val=\^dm_default,(.*)$/m.exec(dmEnum);
if (!dmDefault) die('displaymessage_enum has no ^dm_default row');

/** Assert a literal `mes("...")` really is in a script before we promise a brain it can match on it. */
const mesIn = (src, text, where) => {
    if (!src.includes(`"${text}"`)) die(`${where}: expected message ${JSON.stringify(text)} is no longer present`);
    return text;
};
const leatherMesSrc = leatherSrc;
const MESSAGES = {
    woodcutting: {
        swing: mesIn(woodcutSrc, 'You swing your axe at the tree.', 'woodcut.rs2'),
        // "You get some <lowercase(oc_name($product))>." — the product name is interpolated
        getPrefix: 'You get some ',
        noAxe: mesIn(woodcutSrc, 'You do not have an axe which you have the level to use.', 'woodcut.rs2'),
        invFull: mesIn(woodcutSrc, 'Your inventory is too full to hold any more logs.', 'woodcut.rs2'),
        levelPrefix: 'You need a Woodcutting level of ',
        levelSuffix: ' to chop down this tree.',
    },
    firemaking: {
        attempt: mesIn(fmSrc, 'You attempt to light the logs.', 'firemaking.rs2'),
        success: mesIn(fmSrc, 'The fire catches and the logs begin to burn.', 'firemaking.rs2'),
        noSpace: mesIn(fmSrc, "You can't light a fire here.", 'firemaking.rs2'),
        noTinderbox: mesIn(fmSrc, 'You need a tinderbox to light a fire.', 'firemaking.rs2'),
        levelPrefix: 'You need a Firemaking level of ',
    },
    fletching: {
        shortbow: mesIn(cutLogsSrc, 'You carefully cut the wood into a shortbow.', 'cut_logs.rs2'),
        longbow: mesIn(cutLogsSrc, 'You carefully cut the wood into a longbow.', 'cut_logs.rs2'),
        // "You carefully cut the wood into <n> arrow shafts."
        shaftsPrefix: 'You carefully cut the wood into ',
        shaftsSuffix: ' arrow shafts.',
        outOfLogsPrefix: 'You have run out of ',
        bowStrung: mesIn(bowsSrc, 'You add a string to the bow.', 'bows.rs2'),
        bowLevelPrefix: 'You need level ',
        bowLevelSuffix: ' Fletching to string that bow.',
        membersRefusal: constStr('mes_members_fletching'),
    },
    leather: {
        // "You make <db name>." e.g. "You make a pair of Leather Gloves."
        makePrefix: 'You make ',
        noThread: mesIn(leatherMesSrc, 'You need some thread to make anything out of leather.', 'leather.rs2'),
        threadLast: mesIn(leatherMesSrc, 'You use up your last reel of thread', 'leather.rs2'),
        threadOne: mesIn(leatherMesSrc, 'You use up one of your reels of thread', 'leather.rs2'),
        notEnoughPrefix: "You don't have enough leather to make ",
        outOfPrefix: 'You have run out of ',
        levelPrefix: 'You need a Crafting level of ',
    },
    jewelry: {
        // "You make <~add_article(lowercase(oc_name($product)))>." — silent for perfect gold items
        makePrefix: 'You make ',
        noBars: mesIn(jewelSrc, "You don't have enough gold bars to make any more.", 'jewellery.rs2'),
        levelPrefix: 'You need at least level ',
        levelSuffix: ' Crafting to make that.',
        outOfSilver: mesIn(jewelSrc, 'You have run out of silver bars.', 'jewellery.rs2'),
        noMould: mesIn(jewelSrc, 'You require a mould to make that.', 'jewellery.rs2'),
    },
    stringing: {
        // "You put some string on your <stringing_name>."
        prefix: 'You put some string on your ',
    },
    enchant: {
        // "You successfully enchant the <lowercase(oc_name($initial_obj))>."
        prefix: 'You successfully enchant the ',
        lowLevel: mesIn(rs('skill_magic/scripts/magic.rs2'), 'Your Magic level is not high enough for this spell.', 'magic.rs2'),
        noRunesPrefix: 'You do not have enough ',
        noRunesSuffix: ' Runes to cast this spell.',
        membersSpell: mesIn(rs('skill_magic/scripts/magic.rs2'), "You need to be on a members' server to use this spell.", 'magic.rs2'),
    },
    membersFeature: constStr('mes_members_feature'),
    nothingHappens: dmDefault[1],
};

// =================================================================================================
// EMIT
// =================================================================================================
const ts = (v) => JSON.stringify(v);
const L = [];
const push = (...s) => L.push(...s);

push(`// -------------------------------------------------------------------------------------------------`);
push(`// PACKET RECIPES — the wire sequence for each skill, in terms of the primitives already in`);
push(`// leanbot.ts (opLoc / opObj / useItemOnItem / useItemOnLoc / opHeldT / ifButton / invButton /`);
push(`// submitCountDialog). See headless/data/extract-skilling.mjs for the derivation of every claim.`);
push(`// -------------------------------------------------------------------------------------------------`);
push(``);
push(`/** OPHELDU argument order. OpHeldUHandler resolves [opheldu,<obj>] on the FIRST pair before the`);
push(` *  second, so the TOOL always goes first: useItemOnItem(TOOL_obj, TOOL_slot, target_obj, target_slot).`);
push(` *  All four tools this file covers (knife, tinderbox, needle, ball_of_wool) have their own specific`);
push(` *  trigger, and each reads the target from last_useitem / last_useslot — so tool-first is correct for`);
push(` *  every one of them, and it also avoids the handler's fall-through branch, which swaps lastItem and`);
push(` *  lastUseItem UNCONDITIONALLY once the first lookup misses (OpHeldUHandler.ts:95-99).`);
push(` *  ONE EXCEPTION: achey_tree_logs has its own [opheldu,achey_tree_logs]; sending it FIRST reaches the`);
push(` *  dedicated achey firemaking script, sending the tinderbox first reaches the generic one. */`);
push(`export const OPHELDU_TOOL_FIRST = true;`);
push(``);
push(`// -------------------------------------------------------------------------------------------------`);
push(`// WHAT TO OBSERVE BETWEEN STEPS — the send is never the evidence`);
push(`// -------------------------------------------------------------------------------------------------`);
push(`// The engine silently drops any packet it does not like (Component.get miss, wrong buttonType, a`);
push(`// component whose rootLayer is not an open modal or tab, an inv slot that does not hold the obj you`);
push(`// claimed, a script that is not suspended where you think it is). Every handler in that list just`);
push(`// \`return false\`. So each step below names the SERVER-SIDE fact that proves it landed:`);
push(`//`);
push(`//   step                                  wait for`);
push(`//   ------------------------------------  --------------------------------------------------------`);
push(`//   opLoc(tree, 1)                        MESSAGES.woodcutting.swing, then a backpack +1 of the`);
push(`//                                         product obj. NOT the send.`);
push(`//   useItemOnItem(tinderbox, log)         MESSAGES.firemaking.attempt -> .success, then RE-READ`);
push(`//                                         YOUR OWN TILE (the server moved you).`);
push(`//   useItemOnItem(knife, log)             chatModalId === SKILL_MULTI_BY_NAME[iface].root`);
push(`//   ifButton(make1|make5|make10)          fletching xp / product in the backpack; chatModalId -1`);
push(`//   ifButton(makeX)                       P_COUNTDIALOG (leanbot sets countDialogTick), THEN`);
push(`//                                         submitCountDialog(n). A reply sent before it is DROPPED.`);
push(`//   useItemOnItem(needle, leather)        mainModalId === LEATHER_CRAFTING.ROOT. If it never opens,`);
push(`//                                         suspect thread before you suspect the packet.`);
push(`//   ifButton(leather make button)         IF_CLOSE (the script closes the modal itself) + backpack`);
push(`//   useItemOnLoc(furnace, gold_bar)       mainModalId === JEWELRY.ROOT, then UPDATE_INV on the row's`);
push(`//                                         .com — that inv tells you which slots are actually filled`);
push(`//   invButton(op, slotObj, slot, row.com) backpack delta. The "You make ..." message is SUPPRESSED`);
push(`//                                         for perfect-gold products.`);
push(`//   useItemOnItem(wool, unstrung)         backpack: unstrung -> strung, +${'40'} crafting xp`);
push(`//   opHeldT(target, slot, spell.com)      THE SLOT'S OBJ ID CHANGES (inv_setslot). Inventory LENGTH`);
push(`//                                         does not move — a count-based detector is blind here.`);
push(`//`);
push(`// -------------------------------------------------------------------------------------------------`);
push(`// ⛔ UNVERIFIED UNTIL LIVE — this table was generated offline; no server was contacted`);
push(`// -------------------------------------------------------------------------------------------------`);
push(`// Everything above is derived from the engine's own packed ids and content scripts, and the`);
push(`// component ids are cross-checked against the table the engine loads at boot. That makes the IDS`);
push(`// trustworthy. It does NOT make the SEQUENCES proven. Check these first, in this order:`);
push(`//`);
push(`//  1. map_members. fletchLogs and bow stringing return immediately on an F2P world, and every`);
push(`//     members:true row here is unreachable there. Engine default is members:true`);
push(`//     (WorldConfig.ts:100) but NODE_MEMBERS overrides it. Probe: knife on plain logs — if no chat`);
push(`//     modal opens and MESSAGES.fletching.membersRefusal appears, the world is F2P and fletching,`);
push(`//     dragonhide, coif and enchant tier 5 are all off the table.`);
push(`//  2. The resume-button click contract. IF_BUTTON on a skill_multi make button is the deduction`);
push(`//     this package is least able to prove offline. Confirm ONE fletch of plain logs end to end`);
push(`//     before building anything on SKILL_MULTI.`);
push(`//  3. The makeX -> P_COUNTDIALOG handshake for skill_multi (leanbot's countDialogTick has only ever`);
push(`//     been exercised by the BANK's withdraw-X). Same packet, different script — verify once.`);
push(`//  4. The jewelry INV_BUTTON on a DUMMY inv. invButton() is proven against the shop and the bank,`);
push(`//     but crafting_make_rings is a dummyinv fed by inv_transmit; confirm the UPDATE_INV arrives on`);
push(`//     the row's .com and that slot 0 (gold ring, no gem) accepts op 1.`);
push(`//  5. Magic-tab visibility for opHeldT. High-alch (com 1178) already works headless, so the tab is`);
push(`//     open — but confirm an enchant component specifically, since these carry client-side script`);
push(`//     gates that alchemy does not.`);
push(`//  6. Tree loc ids in the field. The TREES rows are complete per the dbrow, but which loc actually`);
push(`//     stands at a given coord is map data this package never read. Scan locs and intersect with`);
push(`//     TREE_BY_LOC rather than assuming a named tree is where you expect.`);
push(`//  7. leather_chaps brokenCounts. Cheap to confirm: click the "Make 10 pairs" button once and count`);
push(`//     the chaps. This package says you get exactly one.`);
push(``);

// ---- skill_multi ---------------------------------------------------------------------------------
push(`export interface SkillMultiSlot {`);
push(`    /** 'a'..'e' — the letter in the component names */`);
push(`    readonly slot: string;`);
push(`    /** 0-based product index — the position this product occupied in the calling script's argument`);
push(`     *  list, which is the ONLY thing that binds a product to a slot letter */`);
push(`    readonly index: number;`);
push(`    /** the item-model component; IF_SETOBJECT delivers the product obj id here */`);
push(`    readonly model: number;`);
push(`    /** IF_BUTTON these to make 1 / 5 / 10 */`);
push(`    readonly make1: number;`);
push(`    readonly make5: number;`);
push(`    readonly make10: number;`);
push(`    /** IF_BUTTON this, then answer P_COUNTDIALOG with submitCountDialog(n) */`);
push(`    readonly makeX: number;`);
push(`}`);
push(``);
push(`export interface SkillMultiEntry {`);
push(`    readonly iface: string;`);
push(`    /** chatModalId while this dialog is open (IF_OPENCHAT carries it) */`);
push(`    readonly root: number;`);
push(`    /** prompt text component ("What would you like to make?" or a caller-supplied header) */`);
push(`    readonly prompt: number | null;`);
push(`    readonly slots: readonly SkillMultiSlot[];`);
push(`}`);
push(``);
push(`/** The make-N chat dialogs. Fletching, dragonhide crafting, silver crafting, glassblowing, pottery`);
push(` *  and spinning all funnel through these; the CALLER decides which product sits in which slot, so a`);
push(` *  brain must pair this table with the per-skill product table below, never with the button text. */`);
push(`export const SKILL_MULTI: readonly SkillMultiEntry[] = [`);
for (const m of SKILL_MULTI) {
    push(`    { iface: ${ts(m.iface)}, root: ${m.root}, prompt: ${m.prompt}, slots: [`);
    for (const s of m.slots) {
        push(`        { slot: ${ts(s.slot)}, index: ${s.index}, model: ${s.model}, make1: ${s.make1}, make5: ${s.make5}, make10: ${s.make10}, makeX: ${s.makeX} },`);
    }
    push(`    ] },`);
}
push(`];`);
push(``);
push(`export const SKILL_MULTI_BY_NAME: Readonly<Record<string, SkillMultiEntry>> =`);
push(`    Object.fromEntries(SKILL_MULTI.map(m => [m.iface, m]));`);
push(`export const SKILL_MULTI_BY_ROOT: ReadonlyMap<number, SkillMultiEntry> =`);
push(`    new Map(SKILL_MULTI.map(m => [m.root, m]));`);
push(``);
push(`/** Every count a single skill_multi click can request, largest first. Anything else needs makeX. */`);
push(`export const SKILL_MULTI_STEPS: readonly number[] = [10, 5, 1];`);
push(``);

// ---- woodcutting ---------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// WOODCUTTING — chopTree`);
push(`// =================================================================================================`);
push(`// PACKET: opLoc(x, z, locId, ${1}) — ONE send. woodcut.rs2 re-arms itself with p_oploc(3) every cycle,`);
push(`// so the server keeps swinging until the tree depletes, the backpack fills, or the player moves.`);
push(`// NEVER send op 3 yourself: [oploc3,_tree] is the hidden continuation op.`);
push(`// OPLOC self-routes NAIVELY (see learnings: naive-router rule) — stand on/next to the tree first.`);
push(`// SUCCESS: a "You get some <log>." message AND a backpack +1 of the product obj. The tree usually`);
push(`// survives several logs; on depletion the loc CHANGES to its next stage (loc_change), which the door`);
push(`// tracker sees as LOC_ADD_CHANGE on that tile.`);
push(`export const CHOP_OP = 1;`);
push(`export const CHOP_CONTINUE_OP = 3;   // server-internal; a bot must never send it`);
push(``);
push(`/** Axes woodcutting_axe_checker() accepts, BEST FIRST — that order is the function's own test order.`);
push(` *  It looks in the RIGHT HAND or the backpack, and this content has NO woodcutting level gate on any`);
push(` *  axe (woodcut.rs2 keeps the level-gated branch commented out, with sources). */`);
push(`export const AXES: readonly { readonly name: string; readonly obj: number }[] = [`);
for (const a of axeNames) push(`    { name: ${ts(a)}, obj: ${obj(a)} },`);
push(`];`);
push(`export const AXE_OBJS: ReadonlySet<number> = new Set(AXES.map(a => a.obj));`);
push(``);
push(`export interface TreeEntry {`);
push(`    /** dbrow name, e.g. 'yew_tree_table' */`);
push(`    readonly table: string;`);
push(`    readonly level: number;`);
push(`    /** woodcutting xp per log, in tenths (stat_advance units) */`);
push(`    readonly xp: number;`);
push(`    readonly product: string;`);
push(`    readonly productObj: number;`);
push(`    /** ticks until the stump reverts; 0 = the normal-tree special case (120 + random(80)) */`);
push(`    readonly respawn: number;`);
push(`    /** every loc that resolves to this row — chop ANY of them */`);
push(`    readonly locs: readonly { readonly name: string; readonly id: number }[];`);
push(`    /** axe name -> [low, high] stat_random band; empty when the row has no axe roll */`);
push(`    readonly successChance: Readonly<Record<string, readonly [number, number]>>;`);
push(`}`);
push(``);
push(`export const TREES: readonly TreeEntry[] = [`);
for (const t of TREES) {
    const locsTs = t.locs.map(l => `{ name: ${ts(l.name)}, id: ${l.id} }`).join(', ');
    push(`    { table: ${ts(t.table)}, level: ${t.level}, xp: ${t.xp}, product: ${ts(t.product)}, productObj: ${t.productObj}, respawn: ${t.respawn}, locs: [${locsTs}], successChance: ${ts(t.successChance)} },`);
}
push(`];`);
push(``);
push(`/** tree loc id -> its TREES row. This is the lookup a chop brain actually needs: scan nearby locs,`);
push(` *  keep the ones in this map whose level you have, OPLOC1 the closest. */`);
push(`export const TREE_BY_LOC: ReadonlyMap<number, TreeEntry> = new Map(`);
push(`    TREES.flatMap(t => t.locs.map(l => [l.id, t] as [number, TreeEntry])));`);
push(``);
push(`export const TREE_BY_TABLE: Readonly<Record<string, TreeEntry>> =`);
push(`    Object.fromEntries(TREES.map(t => [t.table, t]));`);
push(``);

// ---- firemaking ----------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// FIREMAKING — burnLogs`);
push(`// =================================================================================================`);
push(`// PACKET A (inventory, preferred): useItemOnItem(TINDERBOX, tbSlot, logObj, logSlot).`);
push(`//   -> [opheldu,tinderbox] -> switch_category(category_22) -> @light_logs_inv(last_useslot).`);
push(`//   The script inv_dropslot's the log onto your tile FIRST, then rolls; on failure it re-arms with`);
push(`//   p_opobj(4), so ONE send burns the log to completion or to a refusal.`);
push(`// PACKET B (a log already on the ground): opObj(x, z, logObj, ${4}).`);
push(`//   -> [opobj4,_category_22] -> @light_logs_ground. Same loop. OPOBJ self-routes naively.`);
push(`// ⛔ ON SUCCESS THE SERVER MOVES YOU. ~push_player p_teleports one tile — west, then east, then south,`);
push(`//   then north, first walkable wins — so the fire is on your OLD tile. Re-read your tile after every`);
push(`//   "The fire catches..." or the next drop lands on the fire and refuses with "You can't light a fire`);
push(`//   here." A fire burns 100..200 ticks, then leaves ashes.`);
push(`// ⛔ BANK ZONES REFUSE. area_allow_loc_add() rejects any coord inside a bank_zones pair — burning next`);
push(`//   to a bank booth is impossible by design, not a pathing bug.`);
push(`export const BURN_GROUND_OP = 4;`);
push(`export const TINDERBOX = ${obj('tinderbox')};`);
push(`export const ASHES = ${obj('ashes')};`);
push(``);
push(`export interface LogEntry {`);
push(`    readonly name: string;`);
push(`    readonly obj: number;`);
push(`    /** firemaking level; 0 means the obj carries no levelrequire param (param default) */`);
push(`    readonly level: number;`);
push(`    /** firemaking xp in tenths; 0 means the obj carries no productexp param — IT BURNS FOR NOTHING */`);
push(`    readonly xp: number;`);
push(`    readonly members: boolean;`);
push(`    /** true when the obj has its own [opheldu,<obj>] trigger that outranks [opheldu,tinderbox] */`);
push(`    readonly hasOwnTrigger: boolean;`);
push(`}`);
push(``);
push(`/** Every obj declared category=category_22 — the triggers key on the CATEGORY, not a name list. */`);
push(`export const LOGS: readonly LogEntry[] = [`);
for (const l of LOGS) {
    push(`    { name: ${ts(l.name)}, obj: ${l.obj}, level: ${l.level}, xp: ${l.xp}, members: ${l.members}, hasOwnTrigger: ${l.hasOwnTrigger} },`);
}
push(`];`);
push(`export const LOG_BY_OBJ: ReadonlyMap<number, LogEntry> = new Map(LOGS.map(l => [l.obj, l]));`);
push(`export const LOG_OBJS: ReadonlySet<number> = new Set(LOGS.map(l => l.obj));`);
push(``);

// ---- fletching -----------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// FLETCHING — fletchLogs (+ bow stringing)`);
push(`// =================================================================================================`);
push(`// PACKET: useItemOnItem(KNIFE, knifeSlot, logObj, logSlot)`);
push(`//   -> [opheldu,knife] (in skill_cooking/.../cutting_fruit.rs2, NOT in skill_fletching) whose default`);
push(`//      arm forwards category_22 to @fletch_log. cut_logs.rs2's own [opheldu,_category_22] 'case knife'`);
push(`//      is DEAD CODE — OpHeldUHandler resolves obj-specific triggers before category triggers.`);
push(`//   -> the server if_openchat's ${'skill_multi3'} for plain logs (15 shafts / short / long) or ${'skill_multi2'}`);
push(`//      for every other log (short / long). Read chatModalId to tell which.`);
push(`//   -> ifButton(SKILL_MULTI[iface].slots[i].make1|make5|make10) to commit; or makeX then, once`);
push(`//      P_COUNTDIALOG lands, submitCountDialog(n).`);
push(`// ⛔ THESE ARE RESUME BUTTONS. IF_BUTTON on the component is the ONLY accepted answer — the plain`);
push(`//   dialog-continue path (RESUME_PAUSEBUTTON) is explicitly refused while a choice is pending.`);
push(`// ⛔ MEMBERS GATE. @fletch_log opens with \`if (map_members = ^false) { mes(^mes_members_fletching); return; }\``);
push(`//   so on an F2P world the dialog NEVER OPENS. The engine default is members:true (WorldConfig.ts:100,`);
push(`//   overridable by NODE_MEMBERS) — verify on the target server before trusting this path.`);
push(`// PRODUCTION RATE: one product every 2 ticks, driven by a server weakqueue; it stops early with`);
push(`//   "You have run out of <log>."`);
push(`export const KNIFE = ${obj('knife')};`);
push(`export const ARROW_SHAFT = ${obj('arrow_shaft')};`);
push(`export const BOW_STRING = ${obj('bow_string')};`);
push(``);
push(`export interface FletchProduct {`);
push(`    /** 'shafts' | 'shortbow' | 'longbow' */`);
push(`    readonly kind: string;`);
push(`    readonly product: string;`);
push(`    readonly productObj: number;`);
push(`    /** how many the product line yields per log (15 for shafts, 1 for bows) */`);
push(`    readonly count: number;`);
push(`    readonly level: number;`);
push(`    readonly xp: number;`);
push(`    /** the label the server if_settext's onto the button (minus its leading newlines) */`);
push(`    readonly label: string;`);
push(`}`);
push(``);
push(`export interface FletchLogEntry {`);
push(`    readonly table: string;`);
push(`    readonly log: string;`);
push(`    readonly logObj: number;`);
push(`    /** shafts per log; 0 = this log has no shaft option, so the dialog is skill_multi2 */`);
push(`    readonly shafts: number;`);
push(`    /** which SKILL_MULTI dialog the server opens for this log */`);
push(`    readonly iface: string;`);
push(`    /** POSITIONAL — products[i] sits in SKILL_MULTI_BY_NAME[iface].slots[i] */`);
push(`    readonly products: readonly FletchProduct[];`);
push(`}`);
push(``);
push(`export const FLETCH_LOGS: readonly FletchLogEntry[] = [`);
for (const f of FLETCH_LOGS) {
    push(`    { table: ${ts(f.table)}, log: ${ts(f.log)}, logObj: ${f.logObj}, shafts: ${f.shafts}, iface: ${ts(f.iface)}, products: [`);
    for (const p of f.products) {
        push(`        { kind: ${ts(p.kind)}, product: ${ts(p.product)}, productObj: ${p.productObj}, count: ${p.count}, level: ${p.level}, xp: ${p.xp}, label: ${ts(p.label)} },`);
    }
    push(`    ] },`);
}
push(`];`);
push(`export const FLETCH_LOG_BY_OBJ: ReadonlyMap<number, FletchLogEntry> =`);
push(`    new Map(FLETCH_LOGS.map(f => [f.logObj, f]));`);
push(``);
push(`// BOW STRINGING: useItemOnItem(BOW_STRING, stringSlot, unstrungObj, unstrungSlot). One bow per send,`);
push(`// no interface, no queue. Same members gate as fletch_log.`);
push(`export interface BowStringEntry {`);
push(`    readonly table: string;`);
push(`    readonly unstrung: string;`);
push(`    readonly unstrungObj: number;`);
push(`    readonly product: string;`);
push(`    readonly productObj: number;`);
push(`    readonly count: number;`);
push(`    readonly level: number;`);
push(`    readonly xp: number;`);
push(`}`);
push(`export const BOW_STRINGING: readonly BowStringEntry[] = [`);
for (const b of BOW_STRINGING) {
    push(`    { table: ${ts(b.table)}, unstrung: ${ts(b.unstrung)}, unstrungObj: ${b.unstrungObj}, product: ${ts(b.product)}, productObj: ${b.productObj}, count: ${b.count}, level: ${b.level}, xp: ${b.xp} },`);
}
push(`];`);
push(`export const BOW_STRING_BY_OBJ: ReadonlyMap<number, BowStringEntry> =`);
push(`    new Map(BOW_STRINGING.map(b => [b.unstrungObj, b]));`);
push(``);

// ---- leather -------------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// LEATHER — craftLeather`);
push(`// =================================================================================================`);
push(`// PACKET: useItemOnItem(NEEDLE, needleSlot, LEATHER, leatherSlot)`);
push(`//   -> [opheldu,needle] 'case leather' -> @craft_leather_interface -> if_openmain(leather_crafting).`);
push(`//      mainModalId becomes LEATHER_CRAFTING.ROOT. THREAD IS CHECKED BEFORE THE INTERFACE OPENS: with`);
push(`//      no thread you get an objbox and NO modal, so "the modal did not open" means "no thread" far`);
push(`//      more often than it means "the packet was dropped".`);
push(`//   -> ifButton(LEATHER_PRODUCTS[i].buttons[1|5|10]). @craft_leather starts with if_close, so a`);
push(`//      successful click closes the modal — IF_CLOSE is the acknowledgement.`);
push(`// These ARE ordinary [if_button,...] triggers (unlike skill_multiN), so no resume-button bookkeeping.`);
push(`// hard_leather and dragonhide DO NOT use this interface — see HARD_LEATHER and DHIDE below.`);
push(`// THREAD: one reel is consumed per ${THREAD_USES} products (%thread_used > ${THREAD_USES - 1}); the counter is a player var that`);
push(`// persists across sessions, so the first reel of a session may go after fewer than ${THREAD_USES}.`);
push(`// PRODUCTION RATE: one product every 2 ticks via a server weakqueue.`);
push(`export const NEEDLE = ${obj('needle')};`);
push(`export const THREAD = ${obj('thread')};`);
push(`export const LEATHER = ${obj('leather')};`);
push(`export const HARD_LEATHER_OBJ = ${obj('hard_leather')};`);
push(`/** Products made per reel of thread. */`);
push(`export const THREAD_USES = ${THREAD_USES};`);
push(``);
push(`export const LEATHER_CRAFTING = {`);
push(`    /** mainModalId while the interface is open */`);
push(`    ROOT: ${com('leather_crafting')},`);
push(`    /** the "Close window" button */`);
push(`    CLOSE: ${com(leatherClose[1])},`);
push(`} as const;`);
push(``);
push(`export interface LeatherProduct {`);
push(`    readonly table: string;`);
push(`    readonly product: string;`);
push(`    readonly productObj: number;`);
push(`    readonly level: number;`);
push(`    readonly xp: number;`);
push(`    readonly leather: string;`);
push(`    readonly leatherObj: number;`);
push(`    /** hides consumed per product (3 for a dhide body, 2 for chaps, 1 otherwise) */`);
push(`    readonly leatherCount: number;`);
push(`    readonly members: boolean;`);
push(`    /** the db name the server echoes in "You make <name>." */`);
push(`    readonly name: string;`);
push(`    /** count -> component to IF_BUTTON. ⛔ MAY BE MISSING 5 AND 10 — see brokenCounts. */`);
push(`    readonly buttons: Readonly<Record<number, number>>;`);
push(`    /** every button the content binds for this product, with the count the SCRIPT passes (not the`);
push(`     *  count its label claims), in source order: the make-1, make-5 and make-10 positions. */`);
push(`    readonly bindings: readonly { readonly com: number; readonly comName: string; readonly count: number }[];`);
push(`    /** ⛔ true when the three buttons do not deliver three distinct counts, i.e. the interface offers`);
push(`     *  Make 1/5/10 but the script ignores it. Loop make-1 instead of trusting the label. */`);
push(`    readonly brokenCounts: boolean;`);
push(`}`);
push(``);
push(`export const LEATHER_PRODUCTS: readonly LeatherProduct[] = [`);
for (const p of LEATHER_PRODUCTS) {
    const btns = Object.entries(p.buttons).map(([k, v]) => `${k}: ${v}`).join(', ');
    const binds = p.bindings.map(b => `{ com: ${b.com}, comName: ${ts(b.comName)}, count: ${b.count} }`).join(', ');
    push(`    { table: ${ts(p.table)}, product: ${ts(p.product)}, productObj: ${p.productObj}, level: ${p.level}, xp: ${p.xp}, leather: ${ts(p.leather)}, leatherObj: ${p.leatherObj}, leatherCount: ${p.leatherCount}, members: ${p.members}, name: ${ts(p.name)},`);
    push(`      buttons: { ${btns} }, bindings: [${binds}], brokenCounts: ${p.brokenCounts} },`);
}
push(`];`);
push(`export const LEATHER_PRODUCT_BY_NAME: Readonly<Record<string, LeatherProduct>> =`);
push(`    Object.fromEntries(LEATHER_PRODUCTS.map(p => [p.product, p]));`);
push(``);
if (LEATHER_PRODUCTS.some(p => p.brokenCounts)) {
    push(`// ⛔ CONTENT BUG, FAITHFULLY REPRODUCED: leather.rs2 lines 17-19 bind ALL THREE chaps buttons to`);
    push(`// @craft_leather(leather_chaps, 1) — the ones labelled "Make 5 pairs" and "Make 10 pairs" each make`);
    push(`// exactly ONE. Their ids are still emitted (in \`bindings\`, with count 1), but \`buttons\` has no 5 or`);
    push(`// 10 entry and brokenCounts is true, so a brain loops make-1 instead of believing the label. Reading`);
    push(`// the label — which is what the browser SDK's live text scan does — gets this wrong.`);
    push(`// Rows with brokenCounts: ${LEATHER_PRODUCTS.filter(p => p.brokenCounts).map(p => p.product).join(', ')}`);
    push(``);
}
push(`/** hard_leather never opens an interface: [opheldu,needle] 'case hard_leather' makes exactly ONE body`);
push(` *  per useItemOnItem, synchronously. Send it again for the next one. */`);
push(`export const HARD_LEATHER: LeatherProduct = { table: ${ts(HARD_LEATHER.table)}, product: ${ts(HARD_LEATHER.product)}, productObj: ${HARD_LEATHER.productObj}, level: ${HARD_LEATHER.level}, xp: ${HARD_LEATHER.xp}, leather: ${ts(HARD_LEATHER.leather)}, leatherObj: ${HARD_LEATHER.leatherObj}, leatherCount: ${HARD_LEATHER.leatherCount}, members: ${HARD_LEATHER.members}, name: ${ts(HARD_LEATHER.name)}, buttons: {}, bindings: [], brokenCounts: false };`);
push(``);
push(`/** Dragonhide takes the skill_multi3 route instead ([opheldu,needle] -> @craft_dhide_interface), with`);
push(` *  the three products POSITIONAL in slots a/b/c: body, vambraces, chaps. */`);
push(`export interface DhideEntry {`);
push(`    readonly table: string;`);
push(`    readonly color: string;`);
push(`    readonly leather: string;`);
push(`    readonly leatherObj: number;`);
push(`    readonly products: readonly {`);
push(`        readonly kind: string;`);
push(`        readonly product: string;`);
push(`        readonly productObj: number;`);
push(`        readonly level: number;`);
push(`        readonly xp: number;`);
push(`        readonly leatherCount: number;`);
push(`        readonly members: boolean;`);
push(`        readonly name: string;`);
push(`    }[];`);
push(`}`);
push(`export const DHIDE: readonly DhideEntry[] = [`);
for (const d of DHIDE_LEATHERS) {
    push(`    { table: ${ts(d.table)}, color: ${ts(d.color)}, leather: ${ts(d.leather)}, leatherObj: ${d.leatherObj}, products: [`);
    for (const p of d.products) {
        push(`        { kind: ${ts(p.kind)}, product: ${ts(p.product)}, productObj: ${p.productObj}, level: ${p.level}, xp: ${p.xp}, leatherCount: ${p.leatherCount}, members: ${p.members}, name: ${ts(p.name)} },`);
    }
    push(`    ] },`);
}
push(`];`);
push(`export const DHIDE_BY_OBJ: ReadonlyMap<number, DhideEntry> = new Map(DHIDE.map(d => [d.leatherObj, d]));`);
push(``);

// ---- jewelry -------------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// JEWELRY — craftJewelry (gold) and the silver branch`);
push(`// =================================================================================================`);
push(`// PACKET: useItemOnLoc(x, z, furnaceLocId, GOLD_BAR, barSlot)`);
push(`//   -> [oplocu,_smithing_furnace] -> @use_furnace -> 'case gold_bar, perfect_gold_bar'`);
push(`//      -> @craft_gold_interface -> if_openmain(crafting_jewelry). mainModalId becomes JEWELRY.ROOT.`);
push(`//   -> invButton(op, slotObjId, slot, JEWELRY_ROWS[i].com) where op is buttons[1|5|10] (ops 1/2/3).`);
push(`// ⛔ THIS IS AN INV COMPONENT, NOT A BUTTON GRID. The three product rows are type=inv components fed`);
push(`//   by inv_transmit from dummy invs, so the answer is INV_BUTTON (the shop/bank primitive), NOT`);
push(`//   IF_BUTTON. InvButtonHandler validates inv.hasAt(slot, obj), so the obj id must match what the`);
push(`//   server put in that slot — send slotObjId from this table, and only for a slot the server filled.`);
push(`// ⛔ SLOT OCCUPANCY IS DYNAMIC. Slot 0 (the plain gold item) is always stocked. Slots 1..5 are set to`);
push(`//   invis_* placeholders ONLY while you hold the matching gem, and inv_delslot'd otherwise — so read`);
push(`//   the transmitted inv (UPDATE_INV on .com) instead of assuming, and expect an empty slot to refuse.`);
push(`// ⛔ MOULD GATE. Without the row's mould the whole layer is if_sethide'd and the inv is never`);
push(`//   transmitted; the row simply does not exist for you.`);
push(`// ⛔ PERFECT BARS PRE-EMPT. crafting_gold uses perfect_gold_bar first if you hold one, silently`);
push(`//   swapping ruby ring/necklace for the perfect variant AND SUPPRESSING the "You make ..." message.`);
push(`//   A message-only success detector goes blind there; count the inventory.`);
push(`// PRODUCTION RATE: p_delay(2) per item, looping in-script until the count runs out or a bar/gem does.`);
push(`export const GOLD_BAR = ${GOLD_BAR};`);
push(`export const PERFECT_GOLD_BAR = ${PERFECT_GOLD_BAR};`);
push(`export const SILVER_BAR = ${obj('silver_bar')};`);
push(``);
push(`export const JEWELRY = {`);
push(`    /** mainModalId while the furnace jewelry interface is open */`);
push(`    ROOT: ${com('crafting_jewelry')},`);
push(`} as const;`);
push(``);
push(`/** mould obj required to unlock each row. */`);
push(`export const JEWELRY_MOULDS: Readonly<Record<string, { readonly name: string; readonly obj: number }>> = ${ts(JEWELRY_MOULDS)};`);
push(``);
push(`export interface JewelrySlot {`);
push(`    readonly slot: number;`);
push(`    /** obj the server places in that slot — send THIS as the INV_BUTTON obj */`);
push(`    readonly slotObj: string;`);
push(`    readonly slotObjId: number;`);
push(`    readonly struct: string;`);
push(`    readonly product: string;`);
push(`    readonly productObj: number;`);
push(`    /** gem consumed alongside the bar; null for the plain gold item in slot 0 */`);
push(`    readonly gem: string | null;`);
push(`    readonly gemObj: number | null;`);
push(`    readonly level: number;`);
push(`    readonly xp: number;`);
push(`}`);
push(``);
push(`export interface JewelryRow {`);
push(`    /** 'rings' | 'necklaces' | 'amulets' */`);
push(`    readonly group: string;`);
push(`    /** the type=inv component; INV_BUTTON target and UPDATE_INV key */`);
push(`    readonly com: number;`);
push(`    readonly dummyInv: string;`);
push(`    /** "you need a mould" text component — hidden once you hold the mould */`);
push(`    readonly mouldCom: number;`);
push(`    /** the layer that is if_sethide'd when the mould is missing */`);
push(`    readonly layerCom: number;`);
push(`    /** count -> INV_BUTTON op */`);
push(`    readonly buttons: Readonly<Record<number, number>>;`);
push(`    readonly slots: readonly JewelrySlot[];`);
push(`}`);
push(``);
push(`export const JEWELRY_ROWS: readonly JewelryRow[] = [`);
for (const r of JEWELRY_ROWS) {
    const btns = Object.entries(r.buttons).map(([k, v]) => `${k}: ${v}`).join(', ');
    push(`    { group: ${ts(r.group)}, com: ${r.com}, dummyInv: ${ts(r.dummyInv)}, mouldCom: ${r.mouldCom}, layerCom: ${r.layerCom}, buttons: { ${btns} }, slots: [`);
    for (const s of r.slots) {
        push(`        { slot: ${s.slot}, slotObj: ${ts(s.slotObj)}, slotObjId: ${s.slotObjId}, struct: ${ts(s.struct)}, product: ${ts(s.product)}, productObj: ${s.productObj}, gem: ${ts(s.gem)}, gemObj: ${s.gemObj}, level: ${s.level}, xp: ${s.xp} },`);
    }
    push(`    ] },`);
}
push(`];`);
push(`export const JEWELRY_ROW_BY_GROUP: Readonly<Record<string, JewelryRow>> =`);
push(`    Object.fromEntries(JEWELRY_ROWS.map(r => [r.group, r]));`);
push(`export const JEWELRY_ROW_BY_COM: ReadonlyMap<number, JewelryRow> =`);
push(`    new Map(JEWELRY_ROWS.map(r => [r.com, r]));`);
push(``);
push(`// The SILVER branch of the same furnace op takes the skill_multiN route instead: a silver bar opens`);
push(`// skill_multi2 (Zamorak emblem / Saradomin symbol) or skill_multi3 when you hold a sickle mould on a`);
push(`// members world. It needs the matching mould and 1 silver bar per product, 3 ticks each.`);
push(``);

// ---- stringing -----------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// STRINGING — stringAmulet`);
push(`// =================================================================================================`);
push(`// PACKET: useItemOnItem(BALL_OF_WOOL, woolSlot, unstrungObj, unstrungSlot)`);
push(`//   -> [opheldu,ball_of_wool] -> @string_amulet(last_useslot). ONE amulet per send, synchronous, no`);
push(`//      interface and no queue.`);
push(`// ⛔ THERE IS NO LEVEL CHECK AND NO XP TABLE: string_amulet hard-codes stat_advance(crafting, ${stringXp[1]}) for`);
push(`//   every amulet, and never reads levelrequired. The 'level' below is the level to CRAFT the unstrung`);
push(`//   piece, kept for planning; it is NOT enforced on stringing.`);
push(`export const BALL_OF_WOOL = ${BALL_OF_WOOL};`);
push(`/** Crafting xp per stringing, in tenths. Flat, regardless of the amulet. */`);
push(`export const STRING_XP = ${Number(stringXp[1])};`);
push(``);
push(`export interface StringableEntry {`);
push(`    readonly unstrung: string;`);
push(`    readonly unstrungObj: number;`);
push(`    readonly strung: string;`);
push(`    readonly strungObj: number;`);
push(`    readonly struct: string;`);
push(`    /** the noun the server echoes: "You put some string on your <stringingName>." */`);
push(`    readonly stringingName: string;`);
push(`    /** crafting level to MAKE the unstrung piece — NOT checked when stringing */`);
push(`    readonly level: number;`);
push(`    readonly members: boolean;`);
push(`}`);
push(``);
push(`export const STRINGABLE: readonly StringableEntry[] = [`);
for (const s of STRINGABLE) {
    push(`    { unstrung: ${ts(s.unstrung)}, unstrungObj: ${s.unstrungObj}, strung: ${ts(s.strung)}, strungObj: ${s.strungObj}, struct: ${ts(s.struct)}, stringingName: ${ts(s.stringingName)}, level: ${s.level}, members: ${s.members} },`);
}
push(`];`);
push(`export const STRINGABLE_BY_OBJ: ReadonlyMap<number, StringableEntry> =`);
push(`    new Map(STRINGABLE.map(s => [s.unstrungObj, s]));`);
push(``);

// ---- enchant -------------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// ENCHANT — enchantItem`);
push(`// =================================================================================================`);
push(`// PACKET: opHeldT(targetObj, targetSlot, ENCHANT_SPELLS[i].com) — the same primitive leanbot already`);
push(`//   uses for high-alch (magic:highlvl_alchemy = 1178). One cast per send; p_delay(1) after.`);
push(`// ⛔ THE SPELL COMPONENT'S GREY-OUT IS CLIENT-ONLY. magic.if gates each icon with script1..3 (rune`);
push(`//   count, staff worn, magic level) but OpHeldTHandler only checks actiontarget=heldobj and that the`);
push(`//   magic tab is open. So a headless bot may fire unconditionally and READ THE REFUSAL — it never has`);
push(`//   to model the icon state. That is a real headless advantage over the text-scanning SDK path.`);
push(`// ⛔ THE ITEM IS REPLACED IN PLACE. inv_setslot, not del+add: the enchanted item keeps its slot, so a`);
push(`//   count-based success detector sees NO inventory-length change. Watch the slot's obj id, or the`);
push(`//   magic xp, or the "You successfully enchant the ..." message.`);
push(`// FAILURE MODES, in the order the server checks them:`);
push(`//   members world -> MESSAGES.enchant.membersSpell`);
push(`//   magic level   -> MESSAGES.enchant.lowLevel`);
push(`//   runes         -> MESSAGES.enchant.noRunesPrefix + <rune name> + noRunesSuffix`);
push(`//   wrong target  -> unstrungMessage (if the target is the matching UNSTRUNG amulet), else`);
push(`//                    wrongTargetMessage`);
push(`// A staff in the right hand substitutes for its element's rune (~staff_runes), so the rune list below`);
push(`// is the WORST case.`);
push(`export interface EnchantConversion {`);
push(`    readonly from: string;`);
push(`    readonly fromObj: number;`);
push(`    readonly to: string;`);
push(`    readonly toObj: number;`);
push(`}`);
push(``);
push(`export interface EnchantSpell {`);
push(`    /** 1..5 */`);
push(`    readonly tier: number;`);
push(`    readonly constant: string;`);
push(`    /** magic-tab component; pass as opHeldT's spellCom */`);
push(`    readonly com: number;`);
push(`    readonly comName: string;`);
push(`    readonly level: number;`);
push(`    /** magic xp in tenths */`);
push(`    readonly xp: number;`);
push(`    readonly members: boolean;`);
push(`    /** worst case — an elemental staff can replace its own rune */`);
push(`    readonly runes: readonly { readonly rune: string; readonly obj: number; readonly count: number }[];`);
push(`    readonly conversions: readonly EnchantConversion[];`);
push(`    /** shown when the target is not enchantable by this tier at all */`);
push(`    readonly wrongTargetMessage: string;`);
push(`    /** shown when the target is the matching UNSTRUNG amulet (string it first) */`);
push(`    readonly unstrungMessage: string | null;`);
push(`    readonly unstrungObj: number | null;`);
push(`}`);
push(``);
push(`export const ENCHANT_SPELLS: readonly EnchantSpell[] = [`);
for (const e of ENCHANT_SPELLS) {
    push(`    { tier: ${e.tier}, constant: ${ts(e.constant)}, com: ${e.com}, comName: ${ts(e.comName)}, level: ${e.level}, xp: ${e.xp}, members: ${e.members},`);
    push(`      runes: ${ts(e.runes)},`);
    push(`      conversions: [`);
    for (const c of e.conversions) push(`        { from: ${ts(c.from)}, fromObj: ${c.fromObj}, to: ${ts(c.to)}, toObj: ${c.toObj} },`);
    push(`      ],`);
    push(`      wrongTargetMessage: ${ts(e.wrongTargetMessage)}, unstrungMessage: ${ts(e.unstrungMessage)}, unstrungObj: ${e.unstrungObj} },`);
}
push(`];`);
push(``);
push(`/** target obj id -> the spell that enchants it. The ONLY lookup an enchant brain needs. */`);
push(`export const ENCHANT_BY_TARGET: ReadonlyMap<number, { spell: EnchantSpell; result: EnchantConversion }> = new Map(`);
push(`    ENCHANT_SPELLS.flatMap(s => s.conversions.map(c =>`);
push(`        [c.fromObj, { spell: s, result: c }] as [number, { spell: EnchantSpell; result: EnchantConversion }])));`);
push(``);
push(`export const ENCHANT_BY_TIER: ReadonlyMap<number, EnchantSpell> =`);
push(`    new Map(ENCHANT_SPELLS.map(s => [s.tier, s]));`);
push(``);

// ---- messages ------------------------------------------------------------------------------------
push(`// =================================================================================================`);
push(`// MESSAGES — every string below was asserted present in its script at generation time`);
push(`// =================================================================================================`);
push(`// Interpolated fragments are emitted as prefix/suffix pairs, never as a whole sentence, because the`);
push(`// interpolated part is an obj/level/name the brain does not control.`);
push(`export const MESSAGES = ${JSON.stringify(MESSAGES, null, 4)} as const;`);
push(``);
push(`/** Regenerate-time facts a test can assert on, so a silent content change shows up as a failing test`);
push(` *  rather than as a bot clicking a component that moved. */`);
push(`export const SKILLING_PROVENANCE = {`);
push(`    componentLookups: ${comLookups},`);
push(`    objDatRecords: ${OBJ_DAT_COUNT},`);
push(`    locDatRecords: ${LOC_DAT_COUNT},`);
push(`    symAbsent: ${symMissing.length},`);
push(`    symDivergent: ${symDivergent.length},`);
push(`    trees: ${TREES.length},`);
push(`    logs: ${LOGS.length},`);
push(`    fletchLogs: ${FLETCH_LOGS.length},`);
push(`    bowStringing: ${BOW_STRINGING.length},`);
push(`    leatherProducts: ${LEATHER_PRODUCTS.length},`);
push(`    dhide: ${DHIDE_LEATHERS.length},`);
push(`    jewelryRows: ${JEWELRY_ROWS.length},`);
push(`    stringable: ${STRINGABLE.length},`);
push(`    enchantSpells: ${ENCHANT_SPELLS.length},`);
push(`    skillMulti: ${SKILL_MULTI.length},`);
push(`} as const;`);
push(``);

// ---- header LAST, so its cross-check counters cover every com()/obj()/loc() call above ------------
const H = [];
H.push(`// GENERATED by headless/data/extract-skilling.mjs — DO NOT EDIT BY HAND.`);
H.push(`// Regenerate: bun server/webclient/headless/data/extract-skilling.mjs`);
H.push(`//`);
H.push(`// The id + recipe tables for the seven skills the browser SDK has and the headless stack does not:`);
H.push(`// chopTree, burnLogs, fletchLogs, craftLeather, craftJewelry, enchantItem, stringAmulet.`);
H.push(`//`);
H.push(`// PROVENANCE (nothing below was typed in; every id was resolved from these files):`);
H.push(`//   server/content/pack/{interface,obj,loc}.pack           frozen id=name assignment; the SAME files`);
H.push(`//                                                          the RuneScript compiler resolves against`);
H.push(`//                                                          (tools/pack/Compiler.ts:173-190)`);
H.push(`//   server/engine/data/pack/server/interface.dat           the id<->debugname table the engine loads`);
H.push(`//                                                          at boot (Component.decodeExtra)`);
H.push(`//   server/engine/data/pack/server/{obj,loc}.dat           leading g2 = record count (bound check)`);
H.push(`//   interface_chat/scripts/chat.rs2                        skill_multiN button -> (product, count)`);
H.push(`//   interface_chat/interfaces/skill_multi{2,3,4,5}.if      those dialogs' component layout`);
H.push(`//   skill_woodcutting/scripts/woodcut.rs2 + configs/trees.dbrow`);
H.push(`//   skill_firemaking/scripts/firemaking.rs2 + configs/firemaking.obj`);
H.push(`//   skill_fletching/scripts/{cut_logs,bows}.rs2 + configs/{cut_logs,stringing}/*.dbrow`);
H.push(`//   skill_cooking/scripts/gnome_cooking/cutting_fruit.rs2  [opheldu,knife] — the REAL fletch route`);
H.push(`//   skill_crafting/scripts/leather/leather.rs2 + configs/leather/leather.dbrow`);
H.push(`//   skill_crafting/scripts/jewellery/{jewellery,stringing}.rs2 + configs/jewellery/*`);
H.push(`//   skill_magic/scripts/spells/enchant.rs2 + configs/magic_spells.dbrow + interfaces/magic.if`);
H.push(`//   general/configs/{free_to_play.constant,displaymessage.enum}`);
H.push(`//`);
H.push(`// CROSS-CHECK: all ${comLookups} component ids below were verified to agree between`);
H.push(`// server/content/pack/interface.pack and server/engine/data/pack/server/interface.dat — the table`);
H.push(`// the RUNNING engine loads. All ${new Set(TREES.flatMap(t => t.locs.map(l => l.id))).size} loc ids and every obj id are inside the runtime`);
H.push(`// obj.dat/loc.dat record counts (${OBJ_DAT_COUNT} objs, ${LOC_DAT_COUNT} locs).`);
H.push(`//`);
H.push(`// ⛔ data/symbols/component.sym IS DELIBERATELY NOT AUTHORITATIVE HERE and is not used to resolve`);
H.push(`// anything. It is a stale build artifact (mtime predates the packed cache) and the compiler never`);
H.push(`// reads it: tools/pack/Compiler.ts:181 loads component ids from pack/interface.pack. Of the ids`);
H.push(`// emitted below, ${symMissing.length} are ABSENT from component.sym and ${symDivergent.length} disagree with it.`);
if (symDivergent.length) {
    H.push(`// DISAGREEING with component.sym — pack+runtime value used, sym value DISCARDED:`);
    for (const d of symDivergent) H.push(`//   ${d.name}: pack+runtime=${d.pack} sym=${d.sym}`);
}
if (symMissing.length) {
    H.push(`// ABSENT from component.sym (present in the pack AND in the runtime table, so they are real —`);
    H.push(`// the sym file simply pre-dates them):`);
    for (let i = 0; i < symMissing.length; i += 4) H.push(`//   ${symMissing.slice(i, i + 4).join(', ')}`);
}
H.push(``);

fs.writeFileSync(OUT, H.concat(L).join('\n'), 'utf8');
console.log(`[skill-extract] wrote ${path.relative(ROOT, OUT)}`);
console.log(`[skill-extract] ${comLookups} component ids cross-checked pack vs runtime interface.dat, 0 disagreements`);
console.log(`[skill-extract] component.sym: ${symMissing.length} absent, ${symDivergent.length} divergent (advisory only — see the emitted header)`);
console.log(`[skill-extract] trees=${TREES.length} logs=${LOGS.length} fletchLogs=${FLETCH_LOGS.length} bowStringing=${BOW_STRINGING.length} ` +
    `leather=${LEATHER_PRODUCTS.length} dhide=${DHIDE_LEATHERS.length} jewelryRows=${JEWELRY_ROWS.length} ` +
    `stringable=${STRINGABLE.length} enchant=${ENCHANT_SPELLS.length} skillMulti=${SKILL_MULTI.length}`);
if (treeSkippedLocs.length) console.log(`[skill-extract] tree loc names absent from loc.pack (skipped): ${treeSkippedLocs.join(', ')}`);

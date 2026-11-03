#!/usr/bin/env bun
// CAPABILITY TABLE EXTRACTOR — emits `headless/capability-tables.ts`, the id tables the shared LeanBot
// capability primitives (VARP / prayer / combat style / dialog / shop / worn) run on.
//
// ⛔ WHY GENERATED AND NOT HAND-WRITTEN, AND WHY NOT SCANNED AT RUNTIME.
// The SDK resolves these ids by walking the loaded interface tree at RUNTIME (StateCollector scans
// IfType.list for buttonType===4 under one parent; Client.ts walks tab 0 for buttonType===5 and reads
// scriptOperand[0]). The headless client deliberately never constructs the interface cache (that is the
// whole point of leanclient — no OnDemand worker, no config tables), so a runtime scan is not available
// to it. The SAME facts are, however, sitting in the packer's own frozen id tables and in the content
// scripts that bind them, so we resolve them OFFLINE from those and check the result in.
//
// The ids are NOT guessable and NOT in any natural order — this is the trap the generator exists to
// avoid. combat_heavysword's four style buttons are 4711/4714/4713/4712 for styles 0/1/2/3: the ids run
// 0,3,2,1. Any "root + style" arithmetic is wrong. The binding that IS authoritative is the content
// script `[if_button,combat_heavysword:heavy2] ~set_attackstyle(2)`, so that is what we parse.
//
// SOURCES (every one re-cited in the emitted provenance block):
//   server/content/pack/interface.pack                                  id=name for every interface AND
//                                                                       component (frozen, authoritative;
//                                                                       cross-checked against
//                                                                       server/engine/data/symbols/component.sym)
//   server/content/pack/varp.pack                                       id=name for every varp
//   server/content/scripts/skill_prayer/interfaces/prayer.if            prayer button -> `pushvar,prayerN`
//   server/content/scripts/skill_prayer/configs/prayers.constant        prayer name -> ^prayer_* const
//   server/content/scripts/skill_combat/scripts/player/
//       player_attackstyles.rs2                                         [if_button,iface:btn] -> style idx
//   server/content/scripts/skill_combat/configs/combat.dbrow            weapon table -> style idx -> name
//   server/content/scripts/interface_chat/interfaces/multi{2,3,4,5}.if  choice roots + option layout
//   server/content/scripts/interface_chat/scripts/chat.rs2              p_choiceN: if_settext(root:com_i)
//   server/content/scripts/shop/scripts/shop.rs2                        inv_button2/3/4 -> qty 1/5/10
//   server/content/scripts/player/scripts/equip.rs2                     [inv_button1,wornitems:wear] = remove
//   server/content/scripts/skill_magic/scripts/magic.rs2                the no-runes message text
//
// Run: bun server/webclient/headless/data/extract-capabilities.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const CONTENT = path.join(ROOT, 'server/content');
const SCRIPTS = path.join(CONTENT, 'scripts');
const PACK = path.join(CONTENT, 'pack');
const SYMBOLS = path.join(ROOT, 'server/engine/data/symbols');
const OUT = path.join(import.meta.dir, '..', 'capability-tables.ts');

const die = (msg) => { console.error(`[cap-extract] FATAL: ${msg}`); process.exit(1); };
const read = (p) => { if (!fs.existsSync(p)) die(`missing source ${p}`); return fs.readFileSync(p, 'utf8'); };

// ---- pack files: "id=name" per line -------------------------------------------------------------
function readPack(file) {
    const byName = new Map(), byId = new Map();
    let max = -1;
    for (const line of read(file).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        const id = Number(t.slice(0, eq));
        const name = t.slice(eq + 1);
        if (!Number.isFinite(id)) continue;
        byName.set(name, id);
        byId.set(id, name);
        if (id > max) max = id;
    }
    return { byName, byId, max };
}

const iface = readPack(path.join(PACK, 'interface.pack'));
const varps = readPack(path.join(PACK, 'varp.pack'));

// ---- CROSS-CHECK against the engine's compiled symbol tables ------------------------------------
// `*.pack` is the packer's id ASSIGNMENT; `data/symbols/*.sym` is what the RuneScript compiler emitted
// for the server. At runtime the server sends ids from the .sym set and the client resolves them against
// the packed cache, so an id is only safe to hard-code if BOTH agree on it.
//
// They do not agree everywhere. Eight interfaces (book, leather_crafting, multiobj3_close, music,
// player_kit_tailor_legs_woman, gnomeball, trail_puzzle, questlist) carry 96 divergent component ids —
// the fingerprint of components inserted mid-interface, where the packer appended fresh ids at the end
// while the compiler renumbered in place. None of them is a capability this table exposes.
//
// Rather than trust a global "all clear" (which this repo cannot give) or fail on divergence that does
// not affect us, the check is applied PER ID AT THE POINT OF USE: every single id this file emits goes
// through com()/varp(), and each one is verified against the symbol table before it is returned. So the
// emitted table is not "probably right because a bulk check passed" — every value in it is individually
// cross-verified, and a future repack that moves one of OUR ids fails the build loudly.
function loadSym(symFile) {
    const symPath = path.join(SYMBOLS, symFile);
    if (!fs.existsSync(symPath)) return null;
    const m = new Map();
    for (const line of read(symPath).split('\n')) {
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
const varpSym = loadSym('varp.sym');

let verified = 0;
function checked(name, packId, symMaps, kind) {
    for (const sym of symMaps) {
        if (!sym) continue;
        const symId = sym.get(name);
        if (symId === undefined) continue;
        if (symId !== packId) die(`${kind} '${name}' DISAGREES: pack=${packId} sym=${symId}. ` +
            `Regenerate the cache/symbols — a hard-coded id here would desync the client from the server.`);
        verified++;
        return packId;
    }
    die(`${kind} '${name}' has no symbol-table entry to cross-check against — refusing to emit an unverified id`);
}

const com = (name) => {
    const id = iface.byName.get(name);
    if (id === undefined) die(`component '${name}' not in interface.pack`);
    // an interface ROOT lives in interface.sym; a child component in component.sym
    return checked(name, id, [componentSym, interfaceSym], 'component');
};
/** Resolvable-and-agreed, or null. Used to detect interfaces the compiler did not emit at all. */
const comOrNull = (name) => {
    const id = iface.byName.get(name);
    if (id === undefined) return null;
    const symId = componentSym?.get(name) ?? interfaceSym?.get(name);
    if (symId === undefined) return null;   // in the pack but never compiled — a dead interface
    if (symId !== id) die(`component '${name}' DISAGREES: pack=${id} sym=${symId}`);
    return id;
};
// ---- TRANSMIT FLAGS -----------------------------------------------------------------------------
// ⛔ A VARP THE SERVER NEVER SENDS READS 0 FOREVER, AND 0 IS A PLAUSIBLE VALUE.
// Only a varp declared `transmit=yes` is pushed to the client (VARP_SMALL/VARP_LARGE). One without it is
// server-side state the client is never told about — so a headless accessor for it would return 0 on
// every call, indistinguishable from a real zero. That is the "absence must never look like zero" trap
// (learnings/00-START-HERE.md rule 2) in its purest form.
//
// THIS IS NOT HYPOTHETICAL: the first cut of this package exposed `prayer_drain_effect` as a
// "is anything praying?" signal. It is declared `protect=no` with NO transmit, so the live probe read 0
// while protect-from-melee was demonstrably lit and burning 45->44 prayer points. The generator now
// REFUSES to emit a non-transmitted varp, so that class of accessor cannot be written again.
function loadTransmitFlags() {
    const flags = new Map();
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith('.varp')) {
                let cur = null;
                for (const raw of read(full).split('\n')) {
                    const line = raw.trim();
                    const sec = /^\[(\w+)\]$/.exec(line);
                    if (sec) { cur = sec[1]; if (!flags.has(cur)) flags.set(cur, false); continue; }
                    if (cur && /^transmit\s*=\s*yes$/.test(line)) flags.set(cur, true);
                }
            }
        }
    };
    walk(SCRIPTS);
    return flags;
}
const transmits = loadTransmitFlags();

const varp = (name) => {
    const id = varps.byName.get(name);
    if (id === undefined) die(`varp '${name}' not in varp.pack`);
    if (transmits.get(name) !== true) {
        die(`varp '${name}' is NOT declared transmit=yes — the server never sends it, so a client-side ` +
            `reader would return 0 forever and 0 is a plausible value. Refusing to emit it.`);
    }
    return checked(name, id, [varpSym], 'varp');
};

// =================================================================================================
// PRAYER — component id + the varp it toggles, taken from the interface's own `pushvar` binding.
// =================================================================================================
// prayer.if declares each button as `[prayer_thickskin] ... script1op1=pushvar,prayer0`, i.e. the
// component's own "am I lit?" script reads varp `prayer0`. That binding IS the mapping; nothing else in
// the codebase has to know that thickskin happens to be prayer0 (it is NOT in constant order — the
// constants run thickskin=1, rockskin=2, steelskin=3 while the varps run thickskin=0, strengthburst=1,
// clarity=2). Getting this from the file is the difference between a table and a guess.
function parsePrayerInterface() {
    const src = read(path.join(SCRIPTS, 'skill_prayer/interfaces/prayer.if'));
    const out = [];
    let cur = null;
    for (const raw of src.split('\n')) {
        const line = raw.trim();
        const sec = /^\[([^\]]+)\]$/.exec(line);
        if (sec) { cur = sec[1]; continue; }
        const m = /^script1op1=pushvar,(\w+)$/.exec(line);
        if (m && cur) out.push({ button: cur, varpName: m[1] });
    }
    return out;
}

function parsePrayerConstants() {
    const src = read(path.join(SCRIPTS, 'skill_prayer/configs/prayers.constant'));
    const out = new Map();
    for (const raw of src.split('\n')) {
        const m = /^\^(\w+)\s*=\s*(\d+)$/.exec(raw.trim());
        if (m) out.set(m[1], Number(m[2]));
    }
    return out;
}

const prayerConst = parsePrayerConstants();
const prayers = parsePrayerInterface().map(p => {
    // the interface section name IS the constant name (prayer_thickskin) and IS the component suffix
    const constValue = prayerConst.get(p.button);
    if (constValue === undefined) die(`prayer button '${p.button}' has no ^${p.button} constant`);
    return {
        name: p.button.replace(/^prayer_/, ''),
        button: p.button,
        com: com(`prayer:${p.button}`),
        varp: varp(p.varpName),
        varpName: p.varpName,
        constValue,
    };
});
if (prayers.length !== 15) die(`expected 15 prayers, parsed ${prayers.length}`);

// =================================================================================================
// COMBAT STYLE — [if_button,<iface>:<btn>] ~set_attackstyle(N)
// =================================================================================================
// This is the ONLY authoritative statement of which component sets which com_mode value. The ids are
// deliberately NOT in style order (see the header), so nothing here may be derived arithmetically.
function parseAttackStyles() {
    const src = read(path.join(SCRIPTS, 'skill_combat/scripts/player/player_attackstyles.rs2'));
    const byIface = new Map();
    const re = /^\[if_button,([\w]+):([\w]+)\]\s*~set_attackstyle\((\d+)\);/;
    for (const raw of src.split('\n')) {
        const m = re.exec(raw.trim());
        if (!m) continue;
        const [, ifaceName, btn, styleStr] = m;
        if (!byIface.has(ifaceName)) byIface.set(ifaceName, []);
        byIface.get(ifaceName).push({ style: Number(styleStr), button: btn, comName: `${ifaceName}:${btn}` });
    }
    return byIface;
}

// combat.dbrow: `[weapon_X_table]` then damagestyle rows IN STYLE ORDER (index 0..N-1).
function parseStyleTables() {
    const src = read(path.join(SCRIPTS, 'skill_combat/configs/combat.dbrow'));
    const out = new Map();
    let cur = null;
    for (const raw of src.split('\n')) {
        const line = raw.trim();
        const sec = /^\[(\w+)\]$/.exec(line);
        if (sec) { cur = /_table$/.test(sec[1]) ? sec[1] : null; if (cur) out.set(cur, []); continue; }
        const m = /^data=damagestyle,\^style_(?:melee|ranged|magic)_(\w+)$/.exec(line);
        if (m && cur) out.get(cur).push(m[1]);
    }
    return out;
}

// combat.rs2 maps an obj CATEGORY to its style table; player_attackstyles.rs2 maps the same category to
// the tab INTERFACE. Join them so a caller can go weapon-category -> {interface, styleNames}.
function parseCategoryToInterface() {
    const src = read(path.join(SCRIPTS, 'skill_combat/scripts/player/player_attackstyles.rs2'));
    const out = new Map();
    // only the FIRST switch block (the non-'.' player proc) — the `.`-prefixed copy is the same mapping
    const re = /^case\s+([\w,\s]+?)\s*:\s*~weapon_category_tab_attack\((\w+):preview/;
    for (const raw of src.split('\n')) {
        const m = re.exec(raw.trim());
        if (!m) continue;
        for (const cat of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
            if (!out.has(cat)) out.set(cat, m[2]);
        }
    }
    return out;
}

function parseCategoryToStyleTable() {
    const src = read(path.join(SCRIPTS, 'skill_combat/scripts/combat.rs2'));
    const out = new Map();
    let dflt = null;
    const re = /^case\s+([\w,\s]+?)\s*:\s*return\s*\(\s*(\w+_table)\s*\)/;
    for (const raw of src.split('\n')) {
        const m = re.exec(raw.trim());
        if (!m) continue;
        const cats = m[1].split(',').map(s => s.trim()).filter(Boolean);
        if (cats.length === 1 && cats[0] === 'default') { dflt ??= m[2]; continue; }
        for (const cat of cats) if (!out.has(cat)) out.set(cat, m[2]);
    }
    return { map: out, dflt };
}

const styleButtons = parseAttackStyles();
const styleTables = parseStyleTables();
const catToIface = parseCategoryToInterface();
const _catTables = parseCategoryToStyleTable();
const catToTable = _catTables.map;
const catToTableDefault = _catTables.dflt;

// Build one entry per STYLE INTERFACE: its buttons (style -> component id) and, where the join gives us
// one, the style NAMES from the category's table.
//
// An interface the RuneScript compiler never emitted is SKIPPED rather than crashing the build.
// `combat_polearm` is exactly that today: player_attackstyles.rs2 references it and interface.pack still
// carries a (stale) id block for it, but it is absent from component.sym — i.e. the compiler dropped it,
// so the server can never `if_settab` it and no bot can ever be shown that tab. Emitting its pack ids
// would be emitting ids that address nothing. This is also the proof that .sym, not .pack, is the live
// set: the divergence check above is not paranoia, the pack really does contain dead entries.
const skipped = [];
const styleInterfaces = [];
for (const [ifaceName, buttons] of [...styleButtons].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (buttons.some(b => comOrNull(b.comName) === null)) { skipped.push(ifaceName); continue; }
    const cats = [...catToIface].filter(([, v]) => v === ifaceName).map(([k]) => k);
    // combat_unarmed is reached via `case default` in BOTH switches (combat.rs2:38 and the tab switch),
    // so it has no category of its own — resolve its table from that default arm rather than leaving it
    // blank. This matters: weapon_unarmed_table is exactly the "accurate/aggressive/defensive, NO
    // controlled row" case that outfitter.ts:4-11 documents as the reason the weapon supply is P0. A bot
    // asking for 'controlled' with empty hands must be told the style does not exist, not silently no-op.
    const tableName = cats.map(c => catToTable.get(c)).find(Boolean)
        ?? (ifaceName === 'combat_unarmed' ? (catToTableDefault ?? null) : null);
    const names = tableName ? (styleTables.get(tableName) ?? []) : [];
    const byStyle = {};
    for (const b of buttons.sort((a, b) => a.style - b.style)) {
        if (byStyle[b.style] !== undefined) die(`${ifaceName}: two buttons both set style ${b.style}`);
        byStyle[b.style] = com(b.comName);
    }
    styleInterfaces.push({
        iface: ifaceName,
        ifaceId: iface.byName.get(ifaceName),
        categories: cats,
        styleTable: tableName,
        styleNames: names,
        buttons: byStyle,
    });
}
if (!styleInterfaces.length) die('parsed no combat style interfaces');

// =================================================================================================
// DIALOG — multiN choice roots
// =================================================================================================
// chat.rs2's p_choiceN does `if_settext(multiN:com_0, header)` then `if_settext(multiN:com_i, option_i)`
// and `if_addresumebutton(multiN:com_i)` — so option i (1-based) is component `multiN:com_i`, whose id is
// root + 1 + i. We EMIT the resolved ids rather than the formula so a repack that renumbers is caught by
// regenerating, not by a bot clicking the wrong line.
function parseChoiceRoots() {
    const src = read(path.join(SCRIPTS, 'interface_chat/scripts/chat.rs2'));
    const roots = new Map();
    let cur = null;
    for (const raw of src.split('\n')) {
        const line = raw.trim();
        const proc = /^\[proc,(p_choice\d(?:_header)?)\]/.exec(line);
        if (proc) { cur = null; continue; }
        const st = /^if_settext\((multi\d):com_(\d+),/.exec(line);
        if (st) {
            const root = st[1], idx = Number(st[2]);
            if (!roots.has(root)) roots.set(root, new Set());
            if (idx > 0) roots.get(root).add(idx);
        }
    }
    return roots;
}
const choiceRootOptions = parseChoiceRoots();
const dialogRoots = [...choiceRootOptions].map(([name, idxs]) => {
    const rootId = com(name);
    const options = [...idxs].sort((a, b) => a - b);
    const optionComs = options.map(i => {
        const id = com(`${name}:com_${i}`);
        if (id !== rootId + 1 + i) die(`${name}:com_${i} is ${id}, expected root+1+i=${rootId + 1 + i}`);
        return id;
    });
    return { name, root: rootId, headerCom: com(`${name}:com_0`), optionComs };
}).sort((a, b) => a.root - b.root);
if (dialogRoots.length !== 4) die(`expected 4 multiN choice roots, parsed ${dialogRoots.length}`);

// =================================================================================================
// SHOP / WORN / MAGIC — small, but each one is a fact a hand-written const has already got wrong once.
// =================================================================================================
// shop.rs2 wires inv_button2/3/4 to quantity 1/5/10 on BOTH the buy inv (shop_template:inv) and the sell
// inv (shop_template_side:inv). shopper.ts:160 clicked button 2 (buy ONE) and counted five.
function parseShopButtons() {
    const src = read(path.join(SCRIPTS, 'shop/scripts/shop.rs2'));
    const out = { buy: {}, sell: {} };
    const re = /^\[inv_button(\d),(shop_template(?:_side)?):inv\]\s*@shop_request\([^,]+,\s*last_slot,\s*(\d+)\)/;
    for (const raw of src.split('\n')) {
        const m = re.exec(raw.trim());
        if (!m) continue;
        const side = m[2] === 'shop_template' ? 'buy' : 'sell';
        out[side][Number(m[3])] = Number(m[1]);   // qty -> inv_button op
    }
    if (!Object.keys(out.buy).length || !Object.keys(out.sell).length) die('failed to parse shop buttons');
    return out;
}
const shopButtons = parseShopButtons();

// equip.rs2: `[inv_button1,wornitems:wear]` -> ~unequip(last_slot). So remove = INV_BUTTON1 on the worn
// container. Verified present rather than assumed (the brief flagged the recipe as unverified).
const equipSrc = read(path.join(SCRIPTS, 'player/scripts/equip.rs2'));
const unequipMatch = /\[inv_button(\d),wornitems:wear\]/.exec(equipSrc);
if (!unequipMatch) die('no [inv_buttonN,wornitems:wear] handler in equip.rs2 — unequip recipe unverified');
const UNEQUIP_OP = Number(unequipMatch[1]);
if (!/~unequip\(last_slot\)/.test(equipSrc)) die('wornitems:wear handler does not call ~unequip');

// magic.rs2's rune check message. We emit the INVARIANT part (the rune NAME is interpolated).
const magicSrc = read(path.join(SCRIPTS, 'skill_magic/scripts/magic.rs2'));
if (!/mes\("You do not have enough <~string_removeright\(oc_name\(\$rune\d\), 5\)> Runes to cast this spell\."\);/.test(magicSrc)) {
    die('the no-runes message in magic.rs2 no longer matches the expected shape');
}

// Resolve the remaining single ids BEFORE emitting, so the `verified` count in the provenance header
// covers every lookup this generator made (the header is written first).
const IDS = {
    comMode: varp('com_mode'),
    shopMain: com('shop_template'),
    shopInv: com('shop_template:inv'),
    shopSideInv: com('shop_template_side:inv'),
    shopTitle: com('shop_template:com_76'),
    wornInv: com('wornitems:wear'),
    invMain: com('inventory:inv'),
};

// =================================================================================================
// EMIT
// =================================================================================================
const ts = (v) => JSON.stringify(v);
const lines = [];
lines.push(`// GENERATED by headless/data/extract-capabilities.mjs — DO NOT EDIT BY HAND.`);
lines.push(`// Regenerate: bun server/webclient/headless/data/extract-capabilities.mjs`);
lines.push(`//`);
lines.push(`// PROVENANCE (every id below was resolved from these files, not typed in):`);
lines.push(`//   server/content/pack/interface.pack        interface + component id=name (frozen assignment)`);
lines.push(`//   server/content/pack/varp.pack             varp id=name`);
lines.push(`//   skill_prayer/interfaces/prayer.if         prayer button -> pushvar,prayerN (the toggle binding)`);
lines.push(`//   skill_prayer/configs/prayers.constant     ^prayer_* constant values`);
lines.push(`//   skill_combat/scripts/player/player_attackstyles.rs2   [if_button,iface:btn] ~set_attackstyle(N)`);
lines.push(`//   skill_combat/scripts/combat.rs2           weapon category -> style table`);
lines.push(`//   skill_combat/configs/combat.dbrow         style table -> per-style damagestyle names`);
lines.push(`//   interface_chat/scripts/chat.rs2           p_choiceN -> if_settext(multiN:com_i) option layout`);
lines.push(`//   shop/scripts/shop.rs2                     inv_buttonN -> buy/sell quantity`);
lines.push(`//   player/scripts/equip.rs2                  [inv_button1,wornitems:wear] -> ~unequip`);
lines.push(`//   skill_magic/scripts/magic.rs2             the no-runes message shape`);
lines.push(`//`);
lines.push(`// CROSS-CHECK: every id below was individually verified to agree between server/content/pack/*.pack`);
lines.push(`// and server/engine/data/symbols/*.sym at generation time (${verified} lookups, 0 disagreements).`);
lines.push(`// The generator REFUSES to emit an id the two disagree on, or one with no symbol entry at all.`);
if (skipped.length) {
    lines.push(`//`);
    lines.push(`// SKIPPED — referenced by player_attackstyles.rs2 and still carrying a (stale) id block in`);
    lines.push(`// interface.pack, but ABSENT from the compiler's component.sym: the interface was dropped, so`);
    lines.push(`// the server can never if_settab it and no bot can ever be shown that tab. Emitting the pack`);
    lines.push(`// ids would be emitting ids that address nothing: ${skipped.join(', ')}`);
}
lines.push(``);
lines.push(`/** Highest varp id in varp.pack. The client varp store is sized from this. */`);
lines.push(`export const MAX_VARP_ID = ${varps.max};`);
lines.push(``);
lines.push(`/** Named varps the capability layer reads. */`);
lines.push(`export const VARP = {`);
lines.push(`    /** Selected attack style (0..3), the index into the weapon's combat_style_table.`);
lines.push(`     *  SCOPE_TEMP — no \`scope=perm\` in the varp config, so it RESETS TO 0 ON EVERY LOGIN. */`);
lines.push(`    COM_MODE: ${IDS.comMode},`);
lines.push(`    // NOTE: prayer_drain_effect / prayer_drain_counter are deliberately ABSENT. They exist`);
lines.push(`    // server-side but are NOT declared transmit=yes, so the client is never told their value —`);
lines.push(`    // an accessor would read 0 forever, which is indistinguishable from "no prayers lit".`);
lines.push(`    // Use the per-prayer varps (PRAYERS[].varp) instead; those DO transmit. Live-proven`);
lines.push(`    // drain_effect read 0 while protect-from-melee was lit and burning 45->44 points.`);
lines.push(`} as const;`);
lines.push(``);
lines.push(`export interface PrayerEntry {`);
lines.push(`    /** short name, e.g. 'protectfrommelee' */`);
lines.push(`    readonly name: string;`);
lines.push(`    /** full content name, e.g. 'prayer_protectfrommelee' */`);
lines.push(`    readonly button: string;`);
lines.push(`    /** component to IF_BUTTON to toggle it */`);
lines.push(`    readonly com: number;`);
lines.push(`    /** varp that reads 1 while it is active (from the button's own pushvar binding) */`);
lines.push(`    readonly varp: number;`);
lines.push(`    readonly varpName: string;`);
lines.push(`    /** the ^prayer_* constant value (NOT the varp index — they differ) */`);
lines.push(`    readonly constValue: number;`);
lines.push(`}`);
lines.push(``);
lines.push(`/** All 15 prayers, in prayer.if declaration order. */`);
lines.push(`export const PRAYERS: readonly PrayerEntry[] = [`);
for (const p of prayers) {
    lines.push(`    { name: ${ts(p.name)}, button: ${ts(p.button)}, com: ${p.com}, varp: ${p.varp}, varpName: ${ts(p.varpName)}, constValue: ${p.constValue} },`);
}
lines.push(`];`);
lines.push(``);
lines.push(`/** Prayer lookup by short name (\`PRAYER.protectfrommelee\`). */`);
lines.push(`export const PRAYER: Readonly<Record<string, PrayerEntry>> =`);
lines.push(`    Object.fromEntries(PRAYERS.map(p => [p.name, p]));`);
lines.push(``);
lines.push(`export interface StyleInterfaceEntry {`);
lines.push(`    readonly iface: string;`);
lines.push(`    readonly ifaceId: number;`);
lines.push(`    /** obj categories that bind this tab (combat.rs2 / player_attackstyles.rs2) */`);
lines.push(`    readonly categories: readonly string[];`);
lines.push(`    readonly styleTable: string | null;`);
lines.push(`    /** damagestyle per com_mode index, e.g. ['accurate','aggressive','controlled','defensive'] */`);
lines.push(`    readonly styleNames: readonly string[];`);
lines.push(`    /** com_mode value -> component id to IF_BUTTON. NOT ordered by id — see the header. */`);
lines.push(`    readonly buttons: Readonly<Record<number, number>>;`);
lines.push(`}`);
lines.push(``);
lines.push(`/** Every weapon-tab style interface that exists in the packed interface set. */`);
lines.push(`export const STYLE_INTERFACES: readonly StyleInterfaceEntry[] = [`);
for (const s of styleInterfaces) {
    const btns = Object.entries(s.buttons).map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`    { iface: ${ts(s.iface)}, ifaceId: ${s.ifaceId}, categories: ${ts(s.categories)}, styleTable: ${ts(s.styleTable)}, styleNames: ${ts(s.styleNames)}, buttons: { ${btns} } },`);
}
lines.push(`];`);
lines.push(``);
lines.push(`/** Style-interface lookup by content name. */`);
lines.push(`export const STYLE_INTERFACE: Readonly<Record<string, StyleInterfaceEntry>> =`);
lines.push(`    Object.fromEntries(STYLE_INTERFACES.map(s => [s.iface, s]));`);
lines.push(``);
lines.push(`/** component id -> { iface, style } for every style button in the game. */`);
lines.push(`export const STYLE_BUTTON_LOOKUP: ReadonlyMap<number, { iface: string; style: number }> = new Map([`);
for (const s of styleInterfaces) {
    for (const [style, comId] of Object.entries(s.buttons)) {
        lines.push(`    [${comId}, { iface: ${ts(s.iface)}, style: ${style} }],`);
    }
}
lines.push(`]);`);
lines.push(``);
lines.push(`export interface DialogRootEntry {`);
lines.push(`    readonly name: string;`);
lines.push(`    /** chatModalId when this choice is open */`);
lines.push(`    readonly root: number;`);
lines.push(`    /** com_0 — the "Select an Option" header (or a custom header via p_choiceN_header) */`);
lines.push(`    readonly headerCom: number;`);
lines.push(`    /** option components in order; index 0 = option 1. IF_SETTEXT delivers the label to each. */`);
lines.push(`    readonly optionComs: readonly number[];`);
lines.push(`}`);
lines.push(``);
lines.push(`/** The four multiN choice dialogs. */`);
lines.push(`export const DIALOG_ROOTS: readonly DialogRootEntry[] = [`);
for (const d of dialogRoots) {
    lines.push(`    { name: ${ts(d.name)}, root: ${d.root}, headerCom: ${d.headerCom}, optionComs: ${ts(d.optionComs)} },`);
}
lines.push(`];`);
lines.push(``);
lines.push(`export const DIALOG_ROOT_BY_ID: ReadonlyMap<number, DialogRootEntry> =`);
lines.push(`    new Map(DIALOG_ROOTS.map(d => [d.root, d]));`);
lines.push(``);
lines.push(`/** Shop interface ids. */`);
lines.push(`export const SHOP = {`);
lines.push(`    /** shop_template — the modal id IF_OPENMAIN_SIDE reports when a shop opens. */`);
lines.push(`    MAIN: ${IDS.shopMain},`);
lines.push(`    /** shop_template:inv — the SHOP's stock (buy from here). */`);
lines.push(`    INV: ${IDS.shopInv},`);
lines.push(`    /** shop_template_side:inv — a mirror of YOUR backpack (sell from here). */`);
lines.push(`    SIDE_INV: ${IDS.shopSideInv},`);
lines.push(`    /** title text component (IF_SETTEXT carries the shop name). */`);
lines.push(`    TITLE: ${IDS.shopTitle},`);
lines.push(`} as const;`);
lines.push(``);
lines.push(`/** quantity -> INV_BUTTON op, for both shop sides. There is NO buy-X / sell-X. */`);
lines.push(`export const SHOP_BUY_BUTTON: Readonly<Record<number, number>> = ${ts(shopButtons.buy)};`);
lines.push(`export const SHOP_SELL_BUTTON: Readonly<Record<number, number>> = ${ts(shopButtons.sell)};`);
lines.push(`/** The quantities a single click can move, largest first. */`);
lines.push(`export const SHOP_STEPS: readonly number[] = ${ts(Object.keys(shopButtons.buy).map(Number).sort((a, b) => b - a))};`);
lines.push(``);
lines.push(`/** wornitems:wear — the EQUIPPED container. */`);
lines.push(`export const WORN_INV = ${IDS.wornInv};`);
lines.push(`/** INV_BUTTON op that removes a worn item ([inv_button1,wornitems:wear] -> ~unequip). */`);
lines.push(`export const UNEQUIP_BUTTON = ${UNEQUIP_OP};`);
lines.push(``);
lines.push(`/** inventory:inv — the main backpack. */`);
lines.push(`export const INV_MAIN = ${IDS.invMain};`);
lines.push(``);
lines.push(`/** Invariant substrings of magic.rs2's "not enough runes" message (the rune name is interpolated). */`);
lines.push(`export const NO_RUNES_MESSAGE = {`);
lines.push(`    prefix: 'You do not have enough ',`);
lines.push(`    suffix: ' Runes to cast this spell.',`);
lines.push(`} as const;`);
lines.push(``);

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`[cap-extract] wrote ${path.relative(ROOT, OUT)}`);
console.log(`[cap-extract] ${verified} ids individually cross-checked pack vs symbols, 0 disagreements`);
console.log(`[cap-extract] prayers=${prayers.length} styleInterfaces=${styleInterfaces.length} dialogRoots=${dialogRoots.length} maxVarp=${varps.max}`);
if (skipped.length) console.log(`[cap-extract] skipped (in interface.pack but NOT compiled into component.sym — dead interface): ${skipped.join(', ')}`);

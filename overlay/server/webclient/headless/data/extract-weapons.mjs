#!/usr/bin/env bun
// =====================================================================================================
// WEAPON / OUTFITTER TABLE EXTRACTOR
// =====================================================================================================
// Emits `weapons.json`: the authoritative answer to "what can a trainee actually TRAIN CONTROLLED with,
// where do I get one, what does it cost, what level do I need, and how fast does the world make more".
//
// Run:  cd server/webclient && bun headless/data/extract-weapons.mjs
//       (add --report for the human summary tables; --check to only verify the checked-in JSON matches)
//
// -----------------------------------------------------------------------------------------------------
// WHY THIS TABLE EXISTS (the P0 pilot's most expensive finding)
// -----------------------------------------------------------------------------------------------------
// `weapon_unarmed_table` (skill_combat/configs/combat.dbrow:140-147) lists ONLY accurate / aggressive /
// defensive. There is NO controlled row. A bot with empty hands therefore CANNOT select the one style
// that trains attack+strength+defence+hitpoints together (combat.rs2:151-154,167) — it silently dumps
// every point of damage into ATTACK alone. A weapon is a PRECONDITION, not an accessory.
//
// And "a weapon" is much narrower than it sounds: only FIVE of the sixteen weapon-category tables carry
// a `^style_melee_controlled` row. Axes, pickaxes, daggers, swords, 2h swords, warhammers/blunt, scythes
// and staves DO NOT. That is why the man_drop_table's `iron_dagger` (weapon_stab) is not a weapon supply
// even when it drops: `weapon_stab_table` (combat.dbrow:102-111) has aggressive twice and no controlled.
//
// -----------------------------------------------------------------------------------------------------
// SOURCES (cite these; they are the authority)
// -----------------------------------------------------------------------------------------------------
//  obj id -> name           server/content/pack/obj.pack                    ("<id>=<name>")
//  npc id -> name           server/content/pack/npc.pack
//  obj stats/category/cost  server/content/scripts/**/*.obj                 (category=, cost=, members=,
//                           param=stabattack/slashattack/crushattack/strengthbonus/attackrate/prayerbonus)
//  attackrate DEFAULT = 4   server/content/scripts/skill_combat/configs/combat.param:76-79
//                           (scimitars.obj sets NO attackrate -> 4 ticks; longswords/maces/spears/
//                            halberds/claws all set 5. A scimitar swings 25% more often.)
//  controlled rows          server/content/scripts/skill_combat/configs/combat.dbrow
//                           (damagestyle rows in order, then damagetype rows in the same order)
//  category -> table        server/content/scripts/skill_combat/scripts/combat.rs2:22-39
//                           (`combat_get_weapon_style_data`; `case default : weapon_unarmed_table`)
//  ⚠ members gate           combat.rs2:17 — on a NON-members map a members weapon returns the UNARMED
//                           table. That is the local-rehearsal trap: NODE_MEMBERS=1 is mandatory.
//  wield level requirement  server/content/scripts/levelrequire/scripts/tier*.rs2
//                           ("[opheld2,<obj>] @levelrequire_attack(<n>, last_slot);")
//  shop stock + restock     server/content/scripts/**/*.inv   "stockN=<obj>,<baseCount>[,<stockrate>]"
//                           engine layout obj/count/rate: InvType.ts:99-101
//                           restock: World.ts:1216-1223 — +1 per `stockrate` ticks per slot up to the
//                           base count, and World.scaleByPlayerCount is NEVER called here, so more bots
//                           do NOT restock a shop faster. A slot whose base count is 0 NEVER restocks.
//                           A slot bought down to 0 is NOT nulled (Inventory.ts:180 `stockObj` guard),
//                           so it does keep refilling.
//  shop keeper              server/content/scripts/**/*.npc   param=owned_shop / shop_sell_multiplier /
//                           shop_buy_multiplier / shop_delta / shop_title, category=shop_keeper
//  keeper location          server/content/maps/m<mx>_<mz>.jm2 "==== NPC ====" section:
//                           "<level> <localX> <localZ>: <npcId>" -> x=(mx<<6)+lx, z=(mz<<6)+lz
//                           A keeper with NO map spawn is quest-script-spawned and UNREACHABLE (Tamayu's
//                           spear stall); a keeper on level != 0 is inside a gated building (Scavvo).
//  nearest bank             server/content/maps/m*_*.jm2 bank locs (data/bank-locs.mjs; was the 274-only banks2.txt)
//  buy price ladder         shop.rs2:139-147 (adjusted_item_cost_buying) + :183-192 (calc_shop_value)
//                           + :131-136 (price_mod) — price RISES as the shelf drains.
//  smithing recipe          server/content/scripts/skill_smithing/configs/smithing/smithing.dbrow
//                           (levelrequired, bar, bar_amount)
//  tick rate                fly.toml:19 NODE_TICKRATE="300" -> 12,000 ticks per hour on the demo.
// =====================================================================================================

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { bankLocsFromMaps } from './bank-locs.mjs';

// Relative to this file (was hard-coded '<old checkout>/server/content', which silently read the 274 tree after the 289 cut-over).
const CONTENT = join(import.meta.dir, '../../../../server/content');
const OUT = join(import.meta.dir, 'weapons.json');
const TICK_MS = 300;                 // fly.toml:19 NODE_TICKRATE
const TICKS_PER_HOUR = 3_600_000 / TICK_MS;   // 12,000
const ATTACKRATE_DEFAULT = 4;        // combat.param:76-79

const REPORT = process.argv.includes('--report');
const CHECK = process.argv.includes('--check');

// -----------------------------------------------------------------------------------------------------
// tiny helpers
// -----------------------------------------------------------------------------------------------------
function walk(dir, ext, out = []) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, ext, out);
        else if (e.endsWith(ext)) out.push(p);
    }
    return out;
}
const src = p => relative(CONTENT, p).replace(/\\/g, '/');
function packMap(file) {
    const m = new Map();
    for (const line of readFileSync(join(CONTENT, 'pack', file), 'utf8').split(/\r?\n/)) {
        const g = /^(\d+)=(.+)$/.exec(line.trim());
        if (g) m.set(g[2], +g[1]);
    }
    return m;
}
/** Parse a `[name] key=value` config file into { name -> { lines: [], params: Map } }. */
function parseDefs(path) {
    const defs = new Map();
    let cur = null;
    let n = 0;
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
        n++;
        const line = raw.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const h = /^\[([A-Za-z0-9_]+)\]$/.exec(line);
        if (h) { cur = { name: h[1], at: n, kv: new Map(), params: new Map(), data: [] }; defs.set(h[1], cur); continue; }
        if (!cur) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq).trim(), v = line.slice(eq + 1).trim();
        if (k === 'param') { const c = v.indexOf(','); cur.params.set(v.slice(0, c), v.slice(c + 1)); }
        else if (k === 'data') cur.data.push(v);
        else cur.kv.set(k, v);
    }
    return defs;
}

// -----------------------------------------------------------------------------------------------------
// 1. which weapon CATEGORIES can select controlled, and at which style index
// -----------------------------------------------------------------------------------------------------
const dbrowPath = join(CONTENT, 'scripts/skill_combat/configs/combat.dbrow');
const styleTables = parseDefs(dbrowPath);
/** table name -> { styles: string[], types: string[], controlledIndex: number, controlledType: string|null } */
const TABLES = new Map();
for (const [name, def] of styleTables) {
    if (def.kv.get('table') !== 'combat_style_table') continue;
    const styles = [], types = [];
    for (const d of def.data) {
        const c = d.indexOf(',');
        const field = d.slice(0, c), val = d.slice(c + 1).replace(/^\^/, '');
        if (field === 'damagestyle') styles.push(val);
        else if (field === 'damagetype') types.push(val);
    }
    const controlledIndex = styles.indexOf('style_melee_controlled');
    TABLES.set(name, {
        styles, types,
        controlledIndex,
        controlledType: controlledIndex >= 0 ? (types[controlledIndex] ?? null) : null,
        at: `${src(dbrowPath)}:${def.at}`,
    });
}
if (!TABLES.has('weapon_unarmed_table')) throw new Error('combat.dbrow: weapon_unarmed_table missing');
if (TABLES.get('weapon_unarmed_table').controlledIndex !== -1) {
    throw new Error('combat.dbrow: weapon_unarmed_table now HAS a controlled row — the whole outfitter premise changed, re-read the design doc');
}

// category -> table, from combat.rs2's own switch (NOT the commented-out enum)
const combatRs2 = readFileSync(join(CONTENT, 'scripts/skill_combat/scripts/combat.rs2'), 'utf8');
const CATEGORY_TABLE = new Map();
for (const m of combatRs2.matchAll(/case\s+(weapon_[a-z0-9_]+)\s*:\s*return\((weapon_[a-z0-9_]+_table)\)/g)) {
    CATEGORY_TABLE.set(m[1], m[2]);
}
if (CATEGORY_TABLE.size < 14) throw new Error(`combat.rs2: only ${CATEGORY_TABLE.size} categories mapped — parser drifted`);
/** the categories whose table has a controlled row */
const CONTROLLED_CATEGORIES = [...CATEGORY_TABLE].filter(([, t]) => (TABLES.get(t)?.controlledIndex ?? -1) >= 0).map(([c]) => c);

// -----------------------------------------------------------------------------------------------------
// 2. wield level requirements (levelrequire tier*.rs2)
// -----------------------------------------------------------------------------------------------------
// The label family is wider than plain `levelrequire_attack`: halberds use
// `levelrequire_attack_and_strength(att, str, slot)`, the quest-locked tiers prefix the quest name, and
// battlestaves use `levelrequire_magic_and_attack(magic, attack, slot)` — ARG ORDER DIFFERS. Matching
// only the plain form silently reported "no attack requirement" for 8 halberds, which would have claimed
// a rune halberd is wieldable at attack 1. So the signatures are declared EXPLICITLY (read off
// levelrequire.rs2's own `[label,...]` lines) and any unknown attack-family label is a hard failure.
const REQ_SIGS = {
    //                            argIndex of attack, of strength (-1 = none), quest name (null = none)
    levelrequire_attack: { att: 0, str: -1, quest: null, at: 'levelrequire.rs2:6' },
    levelrequire_attack_caps: { att: 0, str: -1, quest: null, at: 'levelrequire.rs2:22' },
    levelrequire_attack_and_strength: { att: 0, str: 1, quest: null, at: 'levelrequire.rs2:186' },
    levelrequire_magic_and_attack: { att: 1, str: -1, quest: null, at: 'levelrequire.rs2:62' },
    levelrequire_heroes_quest_attack: { att: 0, str: -1, quest: 'heroes', at: 'levelrequire.rs2:106' },
    levelrequire_zanaris_quest_attack: { att: 0, str: -1, quest: 'zanaris', at: 'levelrequire.rs2:118' },
    levelrequire_regicide_quest_attack_strength: { att: 0, str: 1, quest: 'regicide', at: 'levelrequire.rs2:194' },
};
const WIELD_LEVEL = new Map();      // objName -> { attack, strength, quest: string|null, at }
for (const f of walk(join(CONTENT, 'scripts/levelrequire/scripts'), '.rs2')) {
    const text = readFileSync(f, 'utf8');
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
        n++;
        const g = /^\[opheld2,([A-Za-z0-9_]+)\]\s*@(levelrequire_[a-z_]+)\(([^)]*)\)/.exec(line.trim());
        if (!g) continue;
        const label = g[2];
        const sig = REQ_SIGS[label];
        if (!sig) {
            // Not an attack gate (levelrequire_ranged / _magic / _defence / _iban_staff) — skip quietly.
            // But never GUESS: an unparsed ATTACK-family label must be loud, not silently "level 1".
            if (/attack/.test(label)) throw new Error(`levelrequire: unhandled attack label "${label}" at ${src(f)}:${n} — add it to REQ_SIGS`);
            continue;
        }
        const args = g[3].split(',').map(s => s.trim());
        const attack = Number(args[sig.att]);
        const strength = sig.str >= 0 ? Number(args[sig.str]) : 0;
        if (!Number.isFinite(attack) || !Number.isFinite(strength)) throw new Error(`levelrequire: bad args "${g[3]}" for ${label} at ${src(f)}:${n}`);
        WIELD_LEVEL.set(g[1], { attack, strength, quest: sig.quest, at: `${src(f)}:${n}` });
    }
}

// -----------------------------------------------------------------------------------------------------
// 3. every obj def, keyed by name (last definition wins — matches the packer's later-file override)
// -----------------------------------------------------------------------------------------------------
const OBJ_ID = packMap('obj.pack');
const NPC_ID = packMap('npc.pack');
const OBJ_DEFS = new Map();
for (const f of walk(join(CONTENT, 'scripts'), '.obj')) {
    if (f.includes('_unpack')) continue;            // raw dumps, not the live config set
    for (const [name, def] of parseDefs(f)) OBJ_DEFS.set(name, { ...def, file: src(f) });
}

const num = (v, d = 0) => (v === undefined ? d : Number(v));

// -----------------------------------------------------------------------------------------------------
// 4. the controlled-capable weapon set
// -----------------------------------------------------------------------------------------------------
const weapons = [];
for (const [name, def] of OBJ_DEFS) {
    const category = def.kv.get('category');
    if (!category || !CONTROLLED_CATEGORIES.includes(category)) continue;
    const id = OBJ_ID.get(name);
    if (id === undefined) continue;                 // not packed = not in the cache = unreachable
    const table = CATEGORY_TABLE.get(category);
    const t = TABLES.get(table);
    const wield = WIELD_LEVEL.get(name) ?? null;
    weapons.push({
        id,
        defName: name,
        name: def.kv.get('name') ?? name,
        category,
        styleTable: table,
        /** com_mode index to select for controlled (player_attackstyles com_mode, 0-based row) */
        controlledStyleIndex: t.controlledIndex,
        /** which accuracy bonus the CONTROLLED row rolls off — NOT always slash! */
        controlledDamageType: t.controlledType,
        members: def.kv.get('members') === 'yes',
        cost: num(def.kv.get('cost'), 1),           // ObjType.ts:148 default 1
        /** null = NO [opheld2,...] level gate exists for this obj at all (wieldable at level 1). */
        wieldAttackLevel: wield ? wield.attack : null,
        wieldStrengthLevel: wield ? wield.strength : null,
        wieldQuest: wield ? wield.quest : null,
        wieldSource: wield ? wield.at : null,
        /** ticks between swings — combat.param attackrate default 4 (scimitars), 5 elsewhere */
        attackRate: num(def.params.get('attackrate'), ATTACKRATE_DEFAULT),
        stabAttack: num(def.params.get('stabattack')),
        slashAttack: num(def.params.get('slashattack')),
        crushAttack: num(def.params.get('crushattack')),
        strengthBonus: num(def.params.get('strengthbonus')),
        prayerBonus: num(def.params.get('prayerbonus')),
        source: `${def.file}:${def.at}`,
    });
}
weapons.sort((a, b) => a.id - b.id);

// -----------------------------------------------------------------------------------------------------
// 5. smithing recipes (only for the weapons above)
// -----------------------------------------------------------------------------------------------------
const smithPath = join(CONTENT, 'scripts/skill_smithing/configs/smithing/smithing.dbrow');
const smithDefs = parseDefs(smithPath);
const SMITH = new Map();                            // productName -> { level, bar, barAmount, at }
for (const [row, def] of smithDefs) {
    if (def.kv.get('table') !== 'smithing') continue;
    const d = new Map();
    for (const line of def.data) { const c = line.indexOf(','); d.set(line.slice(0, c), line.slice(c + 1)); }
    const product = d.get('product');
    if (!product) continue;
    SMITH.set(product, {
        row,
        level: Number(d.get('levelrequired') ?? 0),
        bar: d.get('bar') ?? null,
        barAmount: Number(d.get('bar_amount') ?? 0),
        productAmount: Number(d.get('product_amount') ?? 1),
        at: `${src(smithPath)}:${def.at}`,
    });
}

// -----------------------------------------------------------------------------------------------------
// 6. shops that stock any of them
// -----------------------------------------------------------------------------------------------------
/** invName -> { restock, allstock, scope, size, slots: [{objName,base,rate,slot}], source } */
const INVS = new Map();
for (const f of walk(join(CONTENT, 'scripts'), '.inv')) {
    if (f.includes('_unpack')) continue;
    for (const [name, def] of parseDefs(f)) {
        const slots = [];
        for (const [k, v] of def.kv) {
            const g = /^stock(\d+)$/.exec(k);
            if (!g) continue;
            const parts = v.split(',').map(s => s.trim());
            slots.push({ slot: +g[1] - 1, objName: parts[0], base: Number(parts[1] ?? 0), rate: parts[2] === undefined ? 0 : Number(parts[2]) });
        }
        slots.sort((a, b) => a.slot - b.slot);
        INVS.set(name, {
            restock: def.kv.get('restock') === 'yes',
            allstock: def.kv.get('allstock') === 'yes',
            scope: def.kv.get('scope') ?? 'temp',
            size: Number(def.kv.get('size') ?? 0),
            slots,
            source: `${src(f)}:${def.at}`,
        });
    }
}

// keeper npcs (category=shop_keeper OR any npc with param=owned_shop)
const KEEPERS = [];
for (const f of walk(join(CONTENT, 'scripts'), '.npc')) {
    if (f.includes('_unpack')) continue;
    for (const [name, def] of parseDefs(f)) {
        const shop = def.params.get('owned_shop');
        if (!shop || shop === 'null') continue;
        KEEPERS.push({
            defName: name,
            id: NPC_ID.get(name) ?? null,
            name: def.kv.get('name') ?? name,
            shopInv: shop,
            // shopkeeper.param defaults: sell 100, buy 60, delta 10
            sellMultiplier: num(def.params.get('shop_sell_multiplier'), 100),
            buyMultiplier: num(def.params.get('shop_buy_multiplier'), 60),
            delta: num(def.params.get('shop_delta'), 10),
            title: def.params.get('shop_title') ?? 'Shop.',
            wanderRange: num(def.kv.get('wanderrange'), 0),
            source: `${src(f)}:${def.at}`,
        });
    }
}

// keeper map spawns
const MAPS = join(CONTENT, 'maps');
const SPAWNS = new Map();                            // npcId -> [{level,x,z,map}]
for (const f of readdirSync(MAPS)) {
    const m = /^m(\d+)_(\d+)\.jm2$/.exec(f);
    if (!m) continue;
    const mx = +m[1], mz = +m[2];
    const txt = readFileSync(join(MAPS, f), 'utf8');
    const i = txt.indexOf('==== NPC ====');
    if (i < 0) continue;
    for (const line of txt.slice(i).split(/\r?\n/)) {
        const g = /^(\d+)\s+(\d+)\s+(\d+):\s*(\d+)/.exec(line.trim());
        if (!g) continue;
        const id = +g[4];
        if (!SPAWNS.has(id)) SPAWNS.set(id, []);
        SPAWNS.get(id).push({ level: +g[1], x: (mx << 6) + +g[2], z: (mz << 6) + +g[3], map: f });
    }
}

// banks
const BANKS = [];
for (const { x, z, locId } of bankLocsFromMaps(CONTENT)) BANKS.push({ x, z, locId });   // bank-locs.mjs (was the 274-only banks2.txt)
const nearestBank = (x, z) => {
    let best = null;
    for (const b of BANKS) {
        const d = Math.max(Math.abs(b.x - x), Math.abs(b.z - z));
        if (!best || d < best.dist) best = { ...b, dist: d };
    }
    return best;
};

// -----------------------------------------------------------------------------------------------------
// 7. the price ladder (shop.rs2 verbatim)
// -----------------------------------------------------------------------------------------------------
const scale = (a, b, c) => Math.floor((a * c) / b);            // engine `scale(n, d, v)`
/** shop.rs2:183-192 calc_shop_value */
function calcShopValue(baseCost, haggle, mult, priceMod) {
    let i5 = Math.min(1000, Math.max(-5000, priceMod * haggle));
    i5 = Math.max(100, mult - i5);
    return scale(i5, 1000, baseCost);
}
/** shop.rs2:139-147 — what the PLAYER pays with `stockNow` units left on the shelf. */
function buyPriceAt(baseCost, keeper, stockBase, stockNow) {
    const v = calcShopValue(baseCost, keeper.delta, keeper.sellMultiplier, stockNow - stockBase);
    return Math.max(1, v);
}
/** total gp to buy `n` units off a shelf that starts at `stockNow` (the loop in shop.rs2:66-96). */
function buyCost(baseCost, keeper, stockBase, stockNow, n) {
    let total = 0;
    for (let i = 0; i < n; i++) total += buyPriceAt(baseCost, keeper, stockBase, stockNow - i);
    return total;
}

// -----------------------------------------------------------------------------------------------------
// 8a. GEOGRAPHIC ACCESS — a hand-declared, cited classification. This is the one judgement call in the
//     file and it is DECLARED, not inferred, because inferring it is how you end up quoting "2,280
//     weapons/hr world-wide" for shops a bot can never physically walk to.
//       open  — walkable from the mainland with no quest, no ship, no dungeon.
//       ship  — needs the PROVEN Ardougne<->Brimhaven ship route (learnings/ship-travel) plus a land leg.
//               Real supply, but UNPROVEN reachability -> counted separately, never in the headline.
//       quest — behind a quest, a quest-point gate, or a dungeon. Counted as zero.
// -----------------------------------------------------------------------------------------------------
const SHOP_ACCESS = {
    scimitarshop: { tier: 'open', note: 'Al Kharid, level 0; toll gate only (trainbot pays it today)' },
    // Varrock south-west, level 0, on the main road. scope=shared with TWO keepers (551 + 552) sharing ONE inv.
    swordshop: { tier: 'open', note: 'Varrock, level 0, open street' },
    // Falador north-west, level 0, open street.
    maceshop: { tier: 'open', note: 'Falador, level 0, open street' },
    // ---- RANGED SUPPLY (bows + arrows). Same rules, same evidence standard as the melee shops above.
    // Lowe's Archery Emporium, Varrock south-west, level 0, open street — 60 tiles from the swordshop,
    // and on the same side of the river as the Varrock West bank.
    archeryshop: { tier: 'open', note: 'Varrock, level 0, open street (Lowe, npc 550 @3232,3423)' },
    // Hickton's, Catherby, level 0, open street, ~40 tiles from the Catherby fishing spots at (2798,3441).
    archeryshop2: { tier: 'open', note: "Catherby, level 0, open street (Hickton)" },
    // Aemad's Adventurers Store, EAST Ardougne market, level 0 — `scope=shared` with Kortan, one shelf.
    // Arrows only (bronze 500@10), no bows.
    adventurershop: { tier: 'open', note: 'Ardougne EAST market, level 0 (Aemad 590 / Kortan 591 share one shelf); arrows only' },
    // ⚠ DELIBERATELY LEFT UNCLASSIFIED (=> quest tier, counted as ZERO): King Lathas's Armoury
    // (lathastrainingstore, behind the Ardougne training-camp gate), the Tree Gnome Stronghold shop
    // (gnome_*), and the Ranging Guild shops (ranging_guild_*, 20-deep shortbow shelves at rate 50 —
    // by far the world's richest bow supply, and gated). Each is REAL supply that would change the
    // headline, so classifying one 'open' needs a proven route, not an assumption.
    // Tai Bwo Wannai, Karamja. npc 1168 = tbwt_tamayu_FINAL and it has a STATIC level-0 map spawn, and
    // [opnpc3,_shop_keeper] (shop.rs2:1) carries NO quest check — so the stall is NOT quest-gated, only
    // geographically remote (ship to Brimhaven, then ~150 tiles of jungle). Reachability UNPROVEN.
    tbwt_tamayu_final_inventory: { tier: 'ship', note: 'Tai Bwo Wannai, Karamja; ungated shop (static npc 1168 + no quest check) but needs the ship route + a jungle leg — UNPROVEN' },
    // Tyras Camp, Tirannwn — behind Underground Pass + Regicide. Nearest bank 282 tiles.
    regicide_general_shop_2: { tier: 'quest', note: 'Tyras Camp behind Underground Pass/Regicide; nearest bank 282 tiles' },
    // Zanaris — Lost City quest to enter, and dragon_longsword also needs the zanaris wield gate.
    dragonswordshop: { tier: 'quest', note: 'Zanaris; Lost City quest to enter' },
    // ---- SKILLING TOOLS (axes + tinderbox; see `toolShopSlots` below). ----
    // Bob's Brilliant Axes, Lumbridge, level 0. Bob (npc 519 @3232,3203) stands in an open-doored hut
    // 20 tiles south-east of Lumbridge castle. `[opnpc3,_shop_keeper]` (shop.rs2:1) resolves by CATEGORY
    // and bob carries `category=shop_keeper` + `param=owned_shop,axeshop` (lumbridge.npc:95-124) — the same
    // trigger smithbot's hammer leg has run against generalshop1 for weeks.
    axeshop: { tier: 'open', note: "Bob's Brilliant Axes, Lumbridge, level 0 (Bob npc 519 @3232,3203)" },
    // Lumbridge General Store, level 0. ⭐ THE ONE SHOP IN THIS TABLE THAT IS ALREADY PROVEN LIVE:
    // smithbot.ts's hammer leg buys the 1gp hammer off THIS shelf (smithbot.ts:876-921) and its comment
    // records the one trap — the keeper (npc 520 @3209,3247) stands behind a brickwall whose only
    // opening is the doorway at (3214,3245), so the approach must be `walkToExact`, never a bare MOVE.
    generalshop1: { tier: 'open', note: 'Lumbridge General Store, level 0 (Shop keeper npc 520 @3209,3247; smithbot buys its hammer here)' },
    dragonaxeshop: { tier: 'quest', note: 'Heroes Guild, level 1; Heroes Quest' },
    runiteshop: { tier: 'quest', note: "Champions' Guild upper floor (level 1); quest-point gated" },
    legendsguildshop: { tier: 'quest', note: 'Legends Guild, level 2; Legends Quest' },
};

// -----------------------------------------------------------------------------------------------------
// 8b. join it all: ONE entry per (shop inv, slot). ⛔ NOT one per keeper — `scope=shared` means the inv
//     is a single world object, so Varrock's two sword-shop keepers (551 + 552) serve the SAME shelf and
//     it restocks ONCE. Emitting a row per keeper double-counted bronze_longsword as 240/hr when the
//     world makes 120. Keepers are therefore a LIST on the slot.
// -----------------------------------------------------------------------------------------------------
const byDefName = new Map(weapons.map(w => [w.defName, w]));
const keepersByInv = new Map();
for (const k of KEEPERS) {
    if (!keepersByInv.has(k.shopInv)) keepersByInv.set(k.shopInv, []);
    keepersByInv.get(k.shopInv).push(k);
}
/**
 * ⭐ ONE ENCODING OF THE SHELF RULES, TWO ITEM SETS.
 *
 * The melee table and the RANGED SUPPLY table (bows + arrows) are built by this same function, so
 * `World.ts:1288`'s restock semantics, shop.rs2's price ladder, the shared-inv rule and the access classification are written ONCE. A second hand-rolled
 * copy for ranged is exactly the divergent-door-table shape this file's header warns about.
 *
 * @param itemsByDefName obj defName -> { id, defName, cost } — the only fields a SHELF needs.
 */
function buildShopSlots(itemsByDefName) {
const shopSlots = [];
for (const [invName, keepers] of keepersByInv) {
    const inv = INVS.get(invName);
    if (!inv) continue;
    const access = SHOP_ACCESS[invName] ?? { tier: 'quest', note: 'UNCLASSIFIED — add it to SHOP_ACCESS in extract-weapons.mjs before planning around it' };
    // Pricing params come from the keeper; when two keepers share an inv they must agree, else the price
    // depends on WHICH keeper you click — say so out loud rather than silently picking one.
    const priced = keepers.map(k => `${k.sellMultiplier}/${k.buyMultiplier}/${k.delta}`);
    const priceDisagreement = new Set(priced).size > 1 ? priced.join(' vs ') : null;
    const keeper = keepers[0];
    const withSpawn = keepers
        .map(k => ({ k, spawns: k.id === null ? [] : (SPAWNS.get(k.id) ?? []) }))
        .map(e => ({ ...e, spawn: e.spawns.find(s => s.level === 0) ?? e.spawns[0] ?? null }));
    const primary = withSpawn.find(e => e.spawn && e.spawn.level === 0) ?? withSpawn.find(e => e.spawn) ?? withSpawn[0];
    const spawn = primary?.spawn ?? null;
    const bank = spawn ? nearestBank(spawn.x, spawn.z) : null;
    for (const slot of inv.slots) {
        const w = itemsByDefName.get(slot.objName);
        if (!w) continue;
        // World.ts:1218 — restock is `count < base && tick % rate === 0`. base 0 or rate 0 => never.
        const perHour = inv.restock && slot.base > 0 && slot.rate > 0 ? TICKS_PER_HOUR / slot.rate : 0;
        const blocked = !spawn ? 'keeper has no static map spawn (quest-script-spawned)'
            : spawn.level !== 0 ? `keeper spawns on level ${spawn.level} (gated/upstairs building)`
                : slot.base === 0 ? 'stock base is 0 — the slot never holds or restocks stock (World.ts:1218)'
                    : !inv.restock ? 'inv has restock=no — the shelf never refills'
                        : access.tier !== 'open' ? `${access.tier}: ${access.note}`
                            : null;
        shopSlots.push({
            shopInv: invName,
            shopTitle: keeper.title,
            invSource: inv.source,
            invScope: inv.scope,
            accessTier: access.tier,
            accessNote: access.note,
            /** every keeper npc that opens THIS shelf (shop_keeper category + [opnpc3,_shop_keeper]) */
            keepers: withSpawn.map(e => ({
                defName: e.k.defName, npcId: e.k.id, name: e.k.name,
                wanders: e.k.wanderRange > 0,
                spawn: e.spawn ? { level: e.spawn.level, x: e.spawn.x, z: e.spawn.z, map: e.spawn.map } : null,
                source: e.k.source,
            })),
            keeperDefName: keeper.defName,
            keeperNpcId: primary?.k.id ?? null,
            keeperName: primary?.k.name ?? keeper.name,
            keeperWanders: (primary?.k.wanderRange ?? 0) > 0,
            keeperSource: primary?.k.source ?? keeper.source,
            /** null = no keeper has a static map spawn: quest-script-spawned, UNREACHABLE by a bot */
            spawn: spawn ? { level: spawn.level, x: spawn.x, z: spawn.z, map: spawn.map } : null,
            nearestBank: bank ? { x: bank.x, z: bank.z, locId: bank.locId, dist: bank.dist } : null,
            objId: w.id,
            objDefName: w.defName,
            slot: slot.slot,
            stockBase: slot.base,
            stockRate: slot.rate,
            unitsPerHour: Math.round(perHour * 100) / 100,
            refillTicks: slot.rate > 0 ? slot.base * slot.rate : 0,
            priceAtFull: buyPriceAt(w.cost, keeper, slot.base, slot.base),
            priceAtLast: slot.base > 0 ? buyPriceAt(w.cost, keeper, slot.base, 1) : 0,
            costToEmptyShelf: slot.base > 0 ? buyCost(w.cost, keeper, slot.base, slot.base, slot.base) : 0,
            sellMultiplier: keeper.sellMultiplier,
            delta: keeper.delta,
            priceDisagreement,
            /** reachable = OPEN access, a level-0 static keeper, a restocking inv and a non-zero shelf */
            reachable: blocked === null,
            unreachableWhy: blocked,
        });
    }
}
shopSlots.sort((a, b) => (a.shopInv === b.shopInv ? a.slot - b.slot : a.shopInv < b.shopInv ? -1 : 1));
return shopSlots;
}

const shopSlots = buildShopSlots(byDefName);

// -----------------------------------------------------------------------------------------------------
// 8c. RANGED SUPPLY — the bows and arrows, built off the same shelf rules
// -----------------------------------------------------------------------------------------------------
// ⛔ A SEPARATE ARRAY, DELIBERATELY, AND NOT ROWS IN `weapons`. `rankControlled()` (weapon-table.ts:385)
// ranks `allWeapons()` filtered only by `isWieldable` — it does NOT re-check for a controlled row,
// because today every row in that array HAS one. Dropping bows into it would therefore feed
// `controlledDps()` a weapon whose `controlledStyleIndex` is -1 and let a BOW win the ranking a melee
// trainee's outfitter uses. So the melee array keeps exactly the meaning its consumers already rely on,
// and the ranged supply gets its own array — same builder, same restock rules, same access tiers.
//
// ⛔ AND THE ITEMS THEMSELVES ARE **NOT** RE-EXTRACTED HERE. `data/gear.json` (extract-gear.mjs) already
// carries every bow and arrow with the `levelrequire` that `player_ranged.rs2:97-99` gates the SHOT on,
// and `ranged-kit.ts` is built on it. This block adds ONLY what gear.json has no notion of: which SHOP
// sells them, how deep the shelf is and how fast it refills. Two tables of the same items would be the
// same divergence hazard as two shop-button tables.
const RANGED_SUPPLY_CATEGORIES = ['weapon_bow', 'arrows'];
const rangedItems = [];
for (const [name, def] of OBJ_DEFS) {
    const category = def.kv.get('category');
    if (!category || !RANGED_SUPPLY_CATEGORIES.includes(category)) continue;
    const id = OBJ_ID.get(name);
    if (id === undefined) continue;
    rangedItems.push({ id, defName: name, category, cost: num(def.kv.get('cost'), 1), members: def.kv.get('members') === 'yes' });
}
const rangedShopSlots = buildShopSlots(new Map(rangedItems.map(w => [w.defName, w])));
const rangedByObj = new Map(rangedItems.map(w => [w.id, w]));
for (const s of rangedShopSlots) s.objCategory = rangedByObj.get(s.objId)?.category ?? null;

// -----------------------------------------------------------------------------------------------------
// 8d. SKILLING TOOLS — the axes and the tinderbox a woodcutting/firemaking bot must BUY
// -----------------------------------------------------------------------------------------------------
// ⛔⛔ WHY THIS BLOCK EXISTS, IN ONE SENTENCE: `skillbot.ts` refused to start on the demo realm with
// `NO TOOLS — axe=NONE tinderbox=false`, because the ONLY tool provisioning that lane had ever had was
// `battle-lanes.ts:181`'s `cheats:['give bronze_axe 1','give tinderbox 1']` — and `skillbot.ts:309-311`
// refuses `SK_CHEATS` whenever `LC_HOST` is unset, i.e. on the demo. So woodcutting/firemaking had been
// "proven end to end" on a LOCAL engine under cheats and was structurally unstartable on the realm we
// actually run (BRIEFING §170b/§171). ⭐ **PROVEN NEEDS A VENUE ATTACHED.**
//
// ⛔ AND IT IS THE **THIRD** ITEM SET THROUGH `buildShopSlots`, NOT A NEW SHELF PARSER. The restock
// semantics (World.ts:1288), the price ladder (shop.rs2:131-147), the shared-inv one-row rule and the
// access classification are written ONCE, up there; this block supplies only "which objs". A private
// copy of the shelf rules for tools is the divergent-door-table shape this file's header warns about.
//
// THE ITEM SET, and each half is derived from the SCRIPT THAT ENFORCES IT, never from a category:
//   * the CHOP tools are parsed out of `woodcutting_axe_checker` (woodcut.rs2:144-171) — the exact
//     function the server calls to decide whether a swing is legal.
//     ⛔⛔ AND `category=weapon_axe` IS **NOT** THAT SET — A TEST CAUGHT ME USING IT. Battleaxes carry
//     the same category and are NOT woodcutting axes: a category filter yields 16 objs where the
//     checker accepts 7, so the picker would have been free to buy a 650 gp steel BATTLEaxe at Bob's
//     and the bot would have stood in the wood reporting `axe=NONE` while holding it. A purchase that
//     fixes nothing is worse than a refusal — it spends gp, takes a pack slot and looks like progress.
//     ⭐ THE GENERAL RULE: **when a script decides something, parse the script, not a config field that
//     merely correlates with it.** (`skill-tool-shop.test.ts` cross-checks this against the generated
//     `AXES`, so the two derivations can never drift apart again in silence.)
//   * `tinderbox`, by name — `firemaking.rs2`'s `[opheldu,tinderbox]` is the only route to a fire. It
//     has NO category at all (`skill_firemaking/configs/firemaking.obj:1-14`) and no `cost=` line
//     either, so its base cost is ObjType.ts:148's default of 1 — which is why the general store's
//     1300/1000 sell multiplier prices it at 1 gp.
//
// ⛔ COMMENTS MUST BE STRIPPED BEFORE THE PARSE. woodcut.rs2 keeps the ORIGINAL level-gated checker
// commented out directly above the live one, IN THE SAME SHAPE, so matching the raw file yields every
// axe TWICE in an order that happens to look right. extract-skilling.mjs records the same trap.
const woodcutSrc = readFileSync(join(CONTENT, 'scripts/skill_woodcutting/scripts/woodcut.rs2'), 'utf8');
const woodcutLive = woodcutSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const CHOP_AXE_NAMES = [...woodcutLive.matchAll(/\(\$obj1\s*=\s*(\w+)\s*\|\s*inv_total\(inv,\s*\1\)\s*>\s*0\)/g)].map(m => m[1]);
// ⛔ FAIL AT EXTRACTION, NOT AT A BOT. A parse that silently yields 0 axes would emit a table with
// no chop tool at all, and `validateWeaponTable` would then throw at IMPORT in every lane that reads
// weapons.json — including the ones running right now. Break here, where only this script is affected.
if (CHOP_AXE_NAMES.length !== 7) throw new Error(`woodcutting_axe_checker parsed ${CHOP_AXE_NAMES.length} axes, expected exactly 7`);
if (new Set(CHOP_AXE_NAMES).size !== CHOP_AXE_NAMES.length) throw new Error(`woodcutting_axe_checker parse produced duplicates: ${CHOP_AXE_NAMES.join(', ')}`);
const TOOL_EXTRA_DEFNAMES = ['tinderbox'];
const toolItems = [];
for (const [name, def] of OBJ_DEFS) {
    const category = def.kv.get('category');
    const wanted = CHOP_AXE_NAMES.includes(name) || TOOL_EXTRA_DEFNAMES.includes(name);
    if (!wanted) continue;
    const id = OBJ_ID.get(name);
    if (id === undefined) continue;          // not packed = not in the cache = unreachable
    toolItems.push({
        id, defName: name, category: category ?? null,
        // ⛔ `cost` DEFAULTS TO 1, NOT 0 — ObjType.ts:148. A 0 here would price every tinderbox at 0 gp
        // and make an unaffordable trip look free.
        cost: num(def.kv.get('cost'), 1),
        members: def.kv.get('members') === 'yes',
        /** which half of the lane needs it. `chop` = an axe woodcut.rs2 accepts; `burn` = the tinderbox. */
        tool: TOOL_EXTRA_DEFNAMES.includes(name) ? 'burn' : 'chop',
    });
}
toolItems.sort((a, b) => a.id - b.id);
const toolShopSlots = buildShopSlots(new Map(toolItems.map(w => [w.defName, w])));
const toolByObj = new Map(toolItems.map(w => [w.id, w]));
for (const s of toolShopSlots) {
    s.objCategory = toolByObj.get(s.objId)?.category ?? null;
    s.tool = toolByObj.get(s.objId)?.tool ?? null;
}

for (const w of weapons) {
    const slots = shopSlots.filter(s => s.objId === w.id);
    const buyable = slots.filter(s => s.reachable);
    const ship = slots.filter(s => s.accessTier === 'ship' && s.stockBase > 0 && s.unitsPerHour > 0);
    w.shopSlots = slots.length;
    w.reachableShopSlots = buyable.length;
    w.worldUnitsPerHour = Math.round(buyable.reduce((a, s) => a + s.unitsPerHour, 0) * 100) / 100;
    w.shipUnitsPerHour = Math.round(ship.reduce((a, s) => a + s.unitsPerHour, 0) * 100) / 100;
    w.cheapestPrice = buyable.length ? Math.min(...buyable.map(s => s.priceAtFull)) : null;
    const sm = SMITH.get(w.defName);
    w.smith = sm ? { level: sm.level, bar: sm.bar, barAmount: sm.barAmount, productAmount: sm.productAmount, at: sm.at } : null;
}

for (const w of rangedItems) {
    const slots = rangedShopSlots.filter(s => s.objId === w.id);
    const buyable = slots.filter(s => s.reachable);
    w.shopSlots = slots.length;
    w.reachableShopSlots = buyable.length;
    w.worldUnitsPerHour = Math.round(buyable.reduce((a, s) => a + s.unitsPerHour, 0) * 100) / 100;
    w.cheapestPrice = buyable.length ? Math.min(...buyable.map(s => s.priceAtFull)) : null;
}
rangedItems.sort((a, b) => a.id - b.id);

// -----------------------------------------------------------------------------------------------------
// 9. the categories with NO controlled row (documented so nobody re-discovers it the hard way)
// -----------------------------------------------------------------------------------------------------
const noControlled = [...CATEGORY_TABLE]
    .filter(([, t]) => (TABLES.get(t)?.controlledIndex ?? -1) < 0)
    .map(([c, t]) => ({ category: c, styleTable: t, styles: TABLES.get(t).styles }));

const table = {
    provenance: {
        generatedBy: 'headless/data/extract-weapons.mjs',
        tickMs: TICK_MS,
        ticksPerHour: TICKS_PER_HOUR,
        attackRateDefault: ATTACKRATE_DEFAULT,
        controlledCategories: CONTROLLED_CATEGORIES,
        sources: {
            objPack: 'pack/obj.pack',
            npcPack: 'pack/npc.pack',
            styleTables: 'scripts/skill_combat/configs/combat.dbrow',
            categoryToTable: 'scripts/skill_combat/scripts/combat.rs2:22-39',
            membersGate: 'scripts/skill_combat/scripts/combat.rs2:17 (non-members map => unarmed table)',
            attackRate: 'scripts/skill_combat/configs/combat.param:76-79',
            wieldLevels: 'scripts/levelrequire/scripts/tier*.rs2',
            shopInvs: 'scripts/**/*.inv (stockN=obj,base,rate; InvType.ts:99-101)',
            restock: 'server/engine/src/engine/World.ts:1216-1223 (world-global, NOT player-scaled)',
            buyCap: 'scripts/shop/scripts/shop.rs2:168-170 (INV_BUTTON2/3/4 = 1/5/10; no buy-X)',
            priceLadder: 'scripts/shop/scripts/shop.rs2:131-147,183-192',
            keepers: 'scripts/**/*.npc param=owned_shop + shopkeeper.param defaults',
            keeperSpawns: 'maps/m*.jm2 "==== NPC ====" sections',
            banks: 'maps/m*_*.jm2 via data/bank-locs.mjs',
            smithing: 'scripts/skill_smithing/configs/smithing/smithing.dbrow',
        },
        accessTiers: Object.fromEntries(Object.entries(SHOP_ACCESS).map(([k, v]) => [k, v])),
        counts: {
            styleTables: TABLES.size,
            categoriesMapped: CATEGORY_TABLE.size,
            controlledCapableWeapons: weapons.length,
            shopSlots: shopSlots.length,
            reachableShopSlots: shopSlots.filter(s => s.reachable).length,
            openShops: new Set(shopSlots.filter(s => s.accessTier === 'open').map(s => s.shopInv)).size,
            keepers: KEEPERS.length,
            invs: INVS.size,
            banks: BANKS.length,
            rangedSupplyItems: rangedItems.length,
            rangedShopSlots: rangedShopSlots.length,
            reachableRangedShopSlots: rangedShopSlots.filter(s => s.reachable).length,
            toolSupplyItems: toolItems.length,
            toolShopSlots: toolShopSlots.length,
            reachableToolShopSlots: toolShopSlots.filter(s => s.reachable).length,
        },
        toolChopAxes: CHOP_AXE_NAMES,
        toolSupplyExtras: TOOL_EXTRA_DEFNAMES,
        toolSupplyNote:
            'Shelves only, for woodcutting/firemaking. The ITEMS live in the ' +
            'generated skilling-tables.ts (AXES from woodcut.rs2, TINDERBOX from firemaking.rs2); this ' +
            'array answers only "which shop sells one, how deep is the shelf and what does it cost".',
        rangedSupplyCategories: RANGED_SUPPLY_CATEGORIES,
        rangedSupplyNote:
            'Shelves only. The bow/arrow ITEMS (levelrequire, rangebonus, attackrate) live in gear.json ' +
            'and are read through ranged-kit.ts — this array answers only "which shop, how deep, how fast".',
    },
    styleTables: [...TABLES].map(([name, t]) => ({ name, ...t })),
    categoriesWithoutControlled: noControlled,
    weapons,
    shopSlots,
    rangedSupply: rangedItems,
    rangedShopSlots,
    toolSupply: toolItems,
    toolShopSlots,
};

// -----------------------------------------------------------------------------------------------------
// 10. write / check
// -----------------------------------------------------------------------------------------------------
const json = JSON.stringify(table, null, 2) + '\n';
if (CHECK) {
    const have = readFileSync(OUT, 'utf8');
    if (have !== json) { console.error('weapons.json is STALE — re-run without --check'); process.exit(1); }
    console.log('weapons.json matches source.');
} else {
    writeFileSync(OUT, json);
    console.log(`wrote ${OUT}: ${weapons.length} controlled-capable weapons, ${shopSlots.length} shop slots (${table.provenance.counts.reachableShopSlots} reachable)`);
}

if (REPORT) {
    console.log('\n=== CATEGORIES WITH A CONTROLLED ROW ===');
    for (const c of CONTROLLED_CATEGORIES) {
        const t = TABLES.get(CATEGORY_TABLE.get(c));
        console.log(`  ${c.padEnd(18)} -> ${CATEGORY_TABLE.get(c).padEnd(24)} controlled at style index ${t.controlledIndex}, rolls off ${t.controlledType}`);
    }
    console.log('\n=== CATEGORIES WITHOUT ONE (a bot holding these trains ONE stat) ===');
    for (const n of noControlled) console.log(`  ${n.category.padEnd(18)} ${n.styles.join(' / ')}`);

    console.log('\n=== REACHABLE SHOP SLOTS (controlled-capable weapons only) ===');
    console.log('  shop                 keeper(id)         tile         obj                    base rate  /hr   price  bank');
    for (const s of shopSlots.filter(x => x.reachable)) {
        console.log(`  ${s.shopInv.padEnd(20)} ${(s.keeperName + '(' + s.keeperNpcId + ')').padEnd(18)} ` +
            `${String(s.spawn.x + ',' + s.spawn.z).padEnd(12)} ${s.objDefName.padEnd(22)} ${String(s.stockBase).padStart(4)} ${String(s.stockRate).padStart(5)} ` +
            `${String(s.unitsPerHour).padStart(6)} ${String(s.priceAtFull).padStart(6)}  d=${s.nearestBank?.dist}`);
    }
    console.log('\n=== RULED OUT ===');
    for (const s of shopSlots.filter(x => !x.reachable)) {
        console.log(`  ${s.shopInv.padEnd(24)} ${s.objDefName.padEnd(24)} ${s.unreachableWhy}`);
    }

    console.log('\n=== WEAPON LADDER (controlled-capable) — CONTROLLED rolls off STAB, never slash ===');
    console.log('  id    obj                     att/str  rate  stab slash crush  str   cost  shop/hr  quest      smith');
    for (const w of weapons.filter(x => x.reachableShopSlots > 0 || x.smith)) {
        console.log(`  ${String(w.id).padEnd(5)} ${w.defName.padEnd(23)} ${String((w.wieldAttackLevel ?? 1) + '/' + (w.wieldStrengthLevel ?? 0)).padStart(7)}  ${String(w.attackRate).padStart(4)}  ` +
            `${String(w.stabAttack).padStart(4)} ${String(w.slashAttack).padStart(5)} ${String(w.crushAttack).padStart(5)} ${String(w.strengthBonus).padStart(4)} ` +
            `${String(w.cost).padStart(6)}  ${String(w.worldUnitsPerHour).padStart(7)}  ${String(w.wieldQuest ?? '-').padEnd(10)} ${w.smith ? `L${w.smith.level} ${w.smith.barAmount}x${w.smith.bar}` : '-'}`);
    }
}

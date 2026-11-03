#!/usr/bin/env bun
// GEAR TABLE EXTRACTOR — turns the engine's own content into a compact table a headless bot can use to
// decide "is this drop better than what I am wearing?".
//
// ⛔ WHY GENERATED AND NOT HAND-WRITTEN. Several hand-maintained gear ladders already exist. Between
// them they cover 4 slots x 7 metals and silently ignore med helms, sq shields, low-tier chainbodies and
// every non-scimitar weapon — and one of them exists ONLY because somebody discovered by hand that rune
// platebody is Dragon-Slayer-locked. That lock is IN THE CONTENT (tier40.rs2:26 -> levelrequire.rs2:132),
// so deriving the table means the next quest lock comes through for free instead of costing a live run.
// This extractor is modelled on data/extract-camps.mjs and reuses its parsers verbatim.
//
// ⛔ THE ONE THING A HAND LIST CANNOT GET RIGHT, AND WHY THIS MATTERS FOR THE TRAINER: which ATTACK stat a
// weapon is scored on depends on the STYLE the bot is using, not on the weapon alone. weapon_slash_table
// (combat.dbrow:69-77) is [slash, slash, STAB, slash] — the CONTROLLED row, the one the whole max-stats
// program depends on, scores off `stabattack`. Comparing scimitars on `slashattack` would mis-rank exactly
// the style we care about, so the emitted table carries the per-style damagetype and the runtime picks the
// param by com_mode.
//
// Sources (every one cited in the emitted provenance block):
//   server/content/pack/obj.pack                                  name -> id (authoritative, ids frozen)
//   server/content/scripts/**/*.obj                               wearpos / category / members / iop2 / stat params
//   server/content/scripts/levelrequire/scripts/tier*.rs2         per-obj [opheld2,x] wear gates
//   server/content/scripts/levelrequire/scripts/levelrequire.rs2  gate handler -> which stat / which quest
//   server/content/scripts/skill_combat/configs/combat.dbrow      category style table -> damagetype per style
//   server/content/scripts/skill_combat/scripts/combat.rs2:21-38  category -> style table
//   server/engine/src/cache/config/ObjType.ts:98-131              wearpos -> worn-inv slot index
//
// Run: bun server/webclient/headless/data/extract-gear.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const CONTENT = path.join(ROOT, 'server/content');
const SCRIPTS = path.join(CONTENT, 'scripts');
const OUT = path.join(import.meta.dir, 'gear.json');

// ---- parsers (verbatim from extract-camps.mjs) -------------------------------
function readPack(file) {
    const m = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const id = Number(line.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        m.set(id, line.slice(eq + 1).trim());
    }
    return m;
}
function walk(dir, ext, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, ext, out);
        else if (e.name.endsWith(ext)) out.push(p);
    }
    return out;
}
function readConfigs(files) {
    const defs = new Map();
    for (const file of files) {
        let cur = null;
        for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('//')) continue;
            if (line.startsWith('[') && line.endsWith(']')) {
                cur = { file, name: line.slice(1, -1), props: {}, params: {} };
                defs.set(cur.name, cur);
                continue;
            }
            if (!cur) continue;
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            const key = line.slice(0, eq);
            const val = line.slice(eq + 1);
            if (key === 'param') {
                const comma = val.indexOf(',');
                if (comma < 0) cur.params[val] = '';
                else cur.params[val.slice(0, comma)] = val.slice(comma + 1);
            } else if (cur.props[key] === undefined) {
                cur.props[key] = val;              // first wins (warhammers.obj:62-63 duplicates a line)
            }
        }
    }
    return defs;
}

// ---- 1. wearpos -> worn-inv slot index (ObjType.ts:98-131 / equip.constant:2-15) ---------------------
// The worn inv is size=14 (player.inv:7-10) and equip.rs2:344,364 moves the item to `oc_wearpos(obj)`
// DIRECTLY — the wearpos id IS the slot index, no remap.
const WEARPOS = {
    hat: 0, back: 1, front: 2, righthand: 3, torso: 4, lefthand: 5, arms: 6,
    legs: 7, head: 8, hands: 9, feet: 10, jaw: 11, ring: 12, quiver: 13,
};

// ---- 2. the 12 combat stat params + attackrate (combat.param:1-79) ----------------------------------
const STAT_PARAMS = [
    'stabattack', 'slashattack', 'crushattack', 'magicattack', 'rangeattack',
    'stabdefence', 'slashdefence', 'crushdefence', 'magicdefence', 'rangedefence',
    'strengthbonus', 'prayerbonus', 'rangebonus',
];
const ATTACK_PARAM_FOR_DAMAGETYPE = { stab_style: 'stabattack', slash_style: 'slashattack', crush_style: 'crushattack', ranged_style: 'rangeattack', magic_style: 'magicattack' };

// ---- 3. gate handlers: derive stat/quest from levelrequire.rs2 itself -------------------------------
// Gate handlers are NOT all in levelrequire.rs2 — `tutorial_island_equip` lives in
// tutorial/scripts/tutorial.rs2:267-282. Scan every file that could define one.
function readGateHandlers(files) {
    const txt = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const handlers = new Map();
    // [label,name](args)  ... body until the next [ at column 0
    const re = /^\[(?:label|proc),([A-Za-z0-9_]+)\]\(([^)]*)\)([\s\S]*?)(?=^\[|\Z)/gm;
    let m;
    while ((m = re.exec(txt)) !== null) {
        const [, name, args, body] = m;
        const stats = [...body.matchAll(/stat_base\((\w+)\)/g)].map(x => x[1]);
        const quest = /%(\w*quest\w*)\s*</.exec(body)?.[1] ?? null;
        // Two delegation forms, and BOTH matter:
        //   ~proc            -> a quest predicate (levelrequire_dragon_slayer_quest)
        //   @label($level..) -> the real level check (levelrequire_defence)
        // A quest wrapper like levelrequire_dragon_slayer_quest_defence(40, slot) has NO stat_base of its
        // own — it delegates. Missing the @-form silently dropped "defence 40" from rune platebody's gate,
        // so a level-39 bot would have believed the quest was its only obstacle.
        const procs = [...body.matchAll(/~(levelrequire_\w+)/g)].map(x => x[1]);
        const labels = [...body.matchAll(/@(levelrequire_\w+)\(/g)].map(x => x[1]);
        // how many int params precede the trailing $slot -> how many level numbers the call site passes
        const levelArgc = args.split(',').filter(a => /int \$/.test(a) && !/\$slot/.test(a)).length;
        handlers.set(name, { stats, quest, procs, labels, levelArgc, body });
    }
    // Resolve delegation: inherit the quest from a ~proc predicate AND the checked stats from an
    // @label call, so a wrapper carries BOTH its quest lock and its level requirement.
    for (const h of handlers.values()) {
        for (const p of h.procs) {
            const t = handlers.get(p);
            if (t && t.quest && !h.quest) h.quest = t.quest;
        }
        if (!h.stats.length) {
            for (const l of h.labels) {
                const t = handlers.get(l);
                if (t && t.stats.length) { h.stats = t.stats; break; }
            }
        }
    }
    return handlers;
}

// ---- 4. category -> per-style damagetype (combat.dbrow + combat.rs2:21-38) --------------------------
function readStyleTables(dbrowFile, combatRs2) {
    const rows = new Map();       // tableName -> { damagestyle: [], damagetype: [] }
    let cur = null;
    for (const raw of fs.readFileSync(dbrowFile, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;
        if (line.startsWith('[') && line.endsWith(']')) { cur = { damagestyle: [], damagetype: [] }; rows.set(line.slice(1, -1), cur); continue; }
        if (!cur) continue;
        const m = /^data=(damagestyle|damagetype),\^?(\w+)$/.exec(line);
        if (m) cur[m[1]].push(m[2]);
    }
    // category -> table, from the switch_category in combat_get_weapon_style_data
    const cat = new Map();
    const txt = fs.readFileSync(combatRs2, 'utf8');
    // Slice to the NEXT top-level declaration, not to the next `}` at column 0: the proc opens with an
    // early-return `if (...) { return(weapon_unarmed_table); }` whose brace is also at column 0, so a
    // lazy `^\}` match stopped 170 chars in and found zero cases (caught by the counts in the output).
    const hdr = txt.indexOf('[proc,combat_get_weapon_style_data]');
    if (hdr < 0) throw new Error('combat_get_weapon_style_data not found — did combat.rs2 move?');
    const nextDecl = txt.indexOf('\n[', hdr + 1);
    const block = txt.slice(hdr, nextDecl < 0 ? undefined : nextDecl);
    for (const m of block.matchAll(/case\s+(\w+)\s*:\s*return\((\w+)\)/g)) {
        if (m[1] === 'default') continue;
        cat.set(m[1], m[2]);
    }
    return { rows, cat };
}

// =====================================================================================================
const objPack = readPack(path.join(CONTENT, 'pack/obj.pack'));
const nameToId = new Map([...objPack].map(([id, n]) => [n, id]));
const objDefs = readConfigs(walk(SCRIPTS, '.obj'));
const gateHandlers = readGateHandlers([
    path.join(SCRIPTS, 'levelrequire/scripts/levelrequire.rs2'),
    path.join(SCRIPTS, 'tutorial/scripts/tutorial.rs2'),
]);
const { rows: styleRows, cat: catToTable } = readStyleTables(
    path.join(SCRIPTS, 'skill_combat/configs/combat.dbrow'),
    path.join(SCRIPTS, 'skill_combat/scripts/combat.rs2'));

// per-obj wear gates from tier*.rs2
const gates = new Map();   // objName -> {handler, levels:[...]}
let gateFiles = 0, gateLines = 0;
for (const f of walk(path.join(SCRIPTS, 'levelrequire/scripts'), '.rs2')) {
    if (!/tier\d+\.rs2$/.test(f)) continue;
    gateFiles++;
    for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = /^\[opheld2,([A-Za-z0-9_]+)\]\s*@([A-Za-z0-9_]+)\(([^)]*)\)/.exec(raw.trim());
        if (!m) continue;
        gateLines++;
        const levels = m[3].split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(Number);
        gates.set(m[1], { handler: m[2], levels });
    }
}

const out = [];
const skipped = { noId: [], noWearpos: 0 };
const unknownHandlers = new Set();
for (const [name, def] of objDefs) {
    const wp = def.props.wearpos;
    if (!wp) { skipped.noWearpos++; continue; }
    const id = nameToId.get(name);
    if (id === undefined) { skipped.noId.push(name); continue; }
    const slot = WEARPOS[wp];
    if (slot === undefined) throw new Error(`unknown wearpos "${wp}" on ${name} — extend WEARPOS from ObjType.ts:98-131`);

    const stats = {};
    for (const p of STAT_PARAMS) { const v = Number(def.params[p]); if (Number.isFinite(v) && v !== 0) stats[p] = v; }
    const attackrate = Number(def.params.attackrate);
    // ⭐ `param=levelrequire` — EMITTED SEPARATELY FROM `gate`, BECAUSE THEY ARE NOT THE SAME THING.
    // For bows the two happen to agree (shortbow 1, oak 5, ... magic 50), because each bow also has an
    // [opheld2] wear gate in tier*.rs2. ARROWS HAVE NO [opheld2] ENTRY AT ALL — they fall through to
    // equip.rs2:1's catch-all — so their `gate` is correctly null, and a reader that inferred the tier
    // from `gate` would conclude every arrow is usable with every bow.
    //
    // ⛔ IT IS NOT: player_ranged_check_ammo (player_ranged.rs2:97-99) refuses the SHOT when
    //   `oc_param($ammo, levelrequire) > oc_param($rhand, levelrequire)`
    // — "Your bow isn't powerful enough for those arrows." That is a per-swing refusal, not a wear
    // refusal: the arrows equip happily into the quiver and then the bot simply never fires. Steel
    // arrows (levelrequire 5) in a plain shortbow (levelrequire 1) is exactly that silent brick, and
    // nothing in gear.json could see it before this field existed.
    const levelrequire = Number(def.params.levelrequire);

    // wear gate
    let gate = null;
    const g = gates.get(name);
    if (g) {
        const h = gateHandlers.get(g.handler);
        gate = { handler: g.handler };
        if (!h) {
            // Don't crash the build and don't silently blacklist good gear either: record it, warn, and let
            // the runtime attempt the wear and fall back on its wearFails self-heal.
            unknownHandlers.add(g.handler);
            gate.unknownHandler = true;
            out.push(null);   // placeholder removed below; keeps the warn path obvious
            out.pop();
        }
        // pair the numeric args with the stats the handler checks, in order
        if (h) {
            // pair the numeric args with the stats the handler checks, in order
            h.stats.forEach((s, i) => { if (g.levels[i] !== undefined) gate[s] = g.levels[i]; });
            if (h.quest) gate.quest = h.quest;
            // a handler with no stat_base and no quest (tutorial_island_equip) is an unconditional block
            if (!h.stats.length && !h.quest) gate.blocked = g.handler;
        }
    }

    // weapon style: category -> table -> damagetype per style index, and the attack param each scores on
    let style = null;
    const table = def.props.category ? catToTable.get(def.props.category) : undefined;
    if (slot === WEARPOS.righthand && table && styleRows.has(table)) {
        const r = styleRows.get(table);
        style = {
            table,
            damagestyle: r.damagestyle,
            damagetype: r.damagetype,
            attackParam: r.damagetype.map(d => ATTACK_PARAM_FOR_DAMAGETYPE[d] ?? null),
        };
    }

    out.push({
        id, name, slot, wearpos: wp,
        slot2: def.props.wearpos2 !== undefined ? WEARPOS[def.props.wearpos2] : undefined,
        slot3: def.props.wearpos3 !== undefined ? WEARPOS[def.props.wearpos3] : undefined,
        members: def.props.members === 'yes' || undefined,
        // ⛔ NO iop2 => OpHeldHandler.ts:46 DROPS the wear packet with NO message at all. A bot must know
        // this up front or it retries an item that can never be worn and calls the silence a level gate.
        iop2: def.props.iop2 ?? null,
        category: def.props.category ?? null,
        cost: Number(def.props.cost) || undefined,
        attackrate: Number.isFinite(attackrate) ? attackrate : 4,   // combat.param default
        // combat.param:80-82 `[levelrequire] default=0`, so 0 and "absent" mean the same thing and are
        // both omitted — a reader treats missing as 0, which is what the engine's oc_param returns.
        levelrequire: Number.isFinite(levelrequire) && levelrequire !== 0 ? levelrequire : undefined,
        gate, style,
        stats,
    });
}
out.sort((a, b) => a.id - b.id);

const fp = p => path.relative(ROOT, p).replace(/\\/g, '/');
const payload = {
    provenance: {
        generatedBy: 'server/webclient/headless/data/extract-gear.mjs',
        generatedAt: new Date().toISOString(),
        sources: {
            objPack: fp(path.join(CONTENT, 'pack/obj.pack')),
            objConfigs: `${fp(SCRIPTS)}/**/*.obj`,
            wearGates: `${fp(path.join(SCRIPTS, 'levelrequire/scripts'))}/tier*.rs2`,
            gateHandlers: fp(path.join(SCRIPTS, 'levelrequire/scripts/levelrequire.rs2')),
            styleTables: fp(path.join(SCRIPTS, 'skill_combat/configs/combat.dbrow')),
            categoryToTable: `${fp(path.join(SCRIPTS, 'skill_combat/scripts/combat.rs2'))} (combat_get_weapon_style_data)`,
            wearposToSlot: 'server/engine/src/cache/config/ObjType.ts:98-131 (== equip.constant:2-15)',
        },
        notes: [
            'slot == wearpos id == worn-inv (com 1688) slot index; equip.rs2:344,364 moves the obj there directly.',
            'A members obj on a NON-members world has iop/category/params stripped (ObjType.ts:59-73) so OPHELD2 is dropped SILENTLY. Check members against the world.',
            'gate.blocked marks a handler that is an unconditional refusal for a bot (e.g. tutorial_island_equip).',
            'style.attackParam[i] is the attack stat scored for com_mode i. weapon_slash CONTROLLED (i=2) is STAB.',
        ],
    },
    counts: {
        wearables: out.length,
        f2p: out.filter(o => !o.members).length,
        gated: out.filter(o => o.gate).length,
        questGated: out.filter(o => o.gate?.quest).length,
        weaponsWithStyle: out.filter(o => o.style).length,
        gateFilesParsed: gateFiles,
        gateLinesParsed: gateLines,
        objBlocksScanned: objDefs.size,
    },
    wearposToSlot: WEARPOS,
    items: out,
};
fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log(`[gear] wrote ${fp(OUT)}`);
console.log(`[gear] ${JSON.stringify(payload.counts)}`);
if (unknownHandlers.size) console.log(`[gear] WARN gate handlers not found (runtime falls back to wearFails self-heal): ${[...unknownHandlers].join(', ')}`);
if (skipped.noId.length) console.log(`[gear] WARN ${skipped.noId.length} wearable defs missing from obj.pack: ${skipped.noId.slice(0, 5).join(', ')}`);

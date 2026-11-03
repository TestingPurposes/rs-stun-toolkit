#!/usr/bin/env bun
// SPELL TABLE EXTRACTOR — turns the engine's own magic content into the table a headless bot needs to
// decide "which spell can I cast right now, and what does one cast cost me?".
//
// ⛔ WHY GENERATED AND NOT HAND-WRITTEN. This repo's stated cautionary precedent is the five
// hand-maintained gear ladders (extract-gear.mjs:5-9). The magic tables are worse: a spell row carries
// SEVEN numbers (level, xp, max hit, and three rune/count pairs) and the rune cost is then REWRITTEN at
// cast time by whichever staff is worn (magic.rs2:53-88). Hand-typing that is how a lane ends up casting
// a spell it cannot pay for, being refused by the server, and earning zero magic xp inside a healthy
// `conn=` — the signature failure this codebase keeps paying for (leanbot.ts:2296 exists because of it).
//
// Sources (echoed into the emitted provenance block):
//   scripts/skill_combat/configs/magic/magic_combat_spells.dbrow  the spell rows (level/xp/maxhit/runes)
//   scripts/skill_magic/configs/magic_staff.dbrow                 staff -> rune substitution table
//   scripts/skill_combat/scripts/player/auto_cast.rs2             which spells the staff_spells tab lists
//   scripts/skill_combat/scripts/player/spells/scripts/*.rs2      per-spell extra gates (undead, charges)
//   engine/data/symbols/component.sym                             spellcom name -> component id (OPNPCT arg)
//   pack/obj.pack                                                 rune name -> obj id
//
// Run: bun server/webclient/headless/data/extract-spells.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const CONTENT = path.join(ROOT, 'server/content');
const SCRIPTS = path.join(CONTENT, 'scripts');
const OUT = path.join(import.meta.dir, 'spells.json');

function readPack(file) {
    const m = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const id = Number(line.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        m.set(line.slice(eq + 1).trim(), id);
    }
    return m;
}

/** `.dbrow` files are `[rowname]` headers followed by `key=value` / `data=field,v1,v2,...` lines. */
function readDbrow(file) {
    const rows = [];
    let cur = null;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const h = line.match(/^\[(.+)\]$/);
        if (h) { cur = { row: h[1], fields: new Map() }; rows.push(cur); continue; }
        if (!cur) continue;
        const d = line.match(/^data=(\w+),(.*)$/);
        if (d) {
            const list = cur.fields.get(d[1]) ?? [];
            list.push(d[2].split(',').map(s => s.trim()));
            cur.fields.set(d[1], list);
            continue;
        }
        const kv = line.match(/^(\w+)=(.*)$/);
        if (kv && !cur.fields.has(kv[1])) cur.fields.set(kv[1], [[kv[2].trim()]]);
    }
    return rows;
}

const one = (row, field) => row.fields.get(field)?.[0]?.[0];
const num = (row, field, dflt = 0) => {
    const v = one(row, field);
    if (v === undefined) return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
};

// ---- rune ids ------------------------------------------------------------------------------------
const objIds = readPack(path.join(CONTENT, 'pack/obj.pack'));

// ---- staff substitution --------------------------------------------------------------------------
// magic.rs2:67-87 does TWO db_findnext calls, so a staff listed in two rows (lava) waives BOTH runes.
const staffRows = readDbrow(path.join(SCRIPTS, 'skill_magic/configs/magic_staff.dbrow'));
/** staff name -> the rune names its wearer never pays for */
const staffWaives = new Map();
for (const row of staffRows) {
    const rune = one(row, 'rune');
    if (!rune) continue;
    for (const [staff] of row.fields.get('staff') ?? []) {
        if (!staffWaives.has(staff)) staffWaives.set(staff, []);
        staffWaives.get(staff).push(rune);
    }
}

// ---- component ids (the OPNPCT payload) ----------------------------------------------------------
const comIds = new Map();
for (const line of fs.readFileSync(path.join(ROOT, 'server/engine/data/symbols/component.sym'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\d+)\s+(\S+)$/);
    if (m) comIds.set(m[2], Number(m[1]));
}

// ---- which spells the autocast tab lists ---------------------------------------------------------
const autoSrc = fs.readFileSync(path.join(SCRIPTS, 'skill_combat/scripts/player/auto_cast.rs2'), 'utf8');
const autocastable = new Set([...autoSrc.matchAll(/set_autocast_spell\(\^(\w+)\)/g)].map(m => m[1]));

// ---- per-spell extra gates from the dedicated scripts ---------------------------------------------
const SPELL_SCRIPTS = path.join(SCRIPTS, 'skill_combat/scripts/player/spells/scripts');
const extraGates = new Map();
if (fs.existsSync(SPELL_SCRIPTS)) {
    for (const f of fs.readdirSync(SPELL_SCRIPTS)) {
        if (!f.endsWith('.rs2')) continue;
        const src = fs.readFileSync(path.join(SPELL_SCRIPTS, f), 'utf8');
        extraGates.set(f.replace(/\.rs2$/, ''), {
            // crumble_undead.rs2:27-30 — `if (npc_param(undead) = ^false) { mes(...); return; }`
            undeadOnly: /npc_param\(undead\)\s*=\s*\^false/.test(src),
            // ibans_blast.rs2:9-13 — a per-cast charge counter the lane cannot refill
            chargeGated: /_charges\s*<\s*1/.test(src),
        });
    }
}

// ---- the spell rows -------------------------------------------------------------------------------
const spellRows = readDbrow(path.join(SCRIPTS, 'skill_combat/configs/magic/magic_combat_spells.dbrow'));
const spells = [];
const warnings = [];
for (const row of spellRows) {
    const spellConst = one(row, 'spell');
    if (!spellConst) continue;                       // npc-only rows carry no player-castable spell id
    const name = spellConst.replace(/^\^/, '');
    const spellcom = one(row, 'spellcom');
    if (!spellcom) continue;                         // skeleton_mage / nezikchened: npc attacks, no button
    const com = comIds.get(spellcom);
    if (com === undefined) { warnings.push(`no component id for ${spellcom}`); continue; }

    // runesrequired is `rune1,count1,rune2,count2,rune3,count3` with `null` holes.
    const req = row.fields.get('runesrequired')?.[0] ?? [];
    const runes = [];
    for (let i = 0; i < req.length; i += 2) {
        const rn = req[i], rc = Number(req[i + 1]);
        if (!rn || rn === 'null' || !Number.isFinite(rc) || rc <= 0) continue;
        const id = objIds.get(rn);
        if (id === undefined) { warnings.push(`no obj id for rune ${rn} (${name})`); continue; }
        runes.push({ name: rn, id, count: rc });
    }
    const gates = extraGates.get(name) ?? {};
    const maxhitRaw = one(row, 'maxhit');
    spells.push({
        name,
        component: com,
        level: num(row, 'levelrequired', 1),
        // stat_advance arg, granted on EVERY cast including a splash (magic.rs2:108, called from
        // player_magic.rs2:157 BEFORE the hit roll at :79).
        experience: num(row, 'experience', 0),
        // null (absent) = a non-damaging spell: player_magic.rs2:217 skips the damage branch entirely.
        maxhit: maxhitRaw === undefined ? null : Number(maxhitRaw),
        members: one(row, 'members') === 'true',
        runes,
        wornRequired: one(row, 'wornrequired') ?? null,
        // pvm_debuff_allowed (player_magic.rs2:131-163) REFUSES a repeat on an already-lowered stat —
        // and refusing means no cast, no runes spent and NO XP. A lane that autocasts these earns zero.
        statChange: (row.fields.get('stat_change') ?? []).length > 0,
        freeze: num(row, 'freeze_time', 0) > 0,
        undeadOnly: gates.undeadOnly === true,
        chargeGated: gates.chargeGated === true,
        autocastable: autocastable.has(name),
    });
}

const staves = [...staffWaives.entries()].map(([name, waives]) => ({
    name, id: objIds.get(name) ?? null, waives,
})).filter(s => s.id !== null);

const runeIds = Object.fromEntries(
    [...new Set(spells.flatMap(s => s.runes.map(r => r.name)))].sort().map(n => [n, objIds.get(n)]),
);

const out = {
    provenance: {
        generatedBy: 'headless/data/extract-spells.mjs',
        spellRows: 'server/content/scripts/skill_combat/configs/magic/magic_combat_spells.dbrow',
        staffTable: 'server/content/scripts/skill_magic/configs/magic_staff.dbrow',
        substitution: 'skill_magic/scripts/magic.rs2:53-88 (staff_runes) — a waived rune count becomes null, so both the check (:34-45) and the delete (:98-106) skip it',
        flatXp: 'skill_magic/scripts/magic.rs2:108-109 give_spell_xp = stat_advance(magic, experience), called from player_magic.rs2:157 BEFORE the hit roll at :79 — SPLASHES STILL PAY',
        damageXp: 'skill_combat/scripts/combat.rs2:160-161 style_magic_normal = scale(200,100, damage*10) = 20 arg/damage, hit only',
        castDelay: 'player_magic.rs2:176 %action_delay = map_clock + 5 — 5 ticks per combat cast, every spell',
        component: 'engine/data/symbols/component.sym — the OPNPCT (181) spellCom argument',
        objIds: 'server/content/pack/obj.pack',
    },
    spells,
    staves,
    runeIds,
    warnings,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}: ${spells.length} spells, ${staves.length} rune-granting staves, ${warnings.length} warnings`);
for (const w of warnings) console.warn('  ⚠ ' + w);

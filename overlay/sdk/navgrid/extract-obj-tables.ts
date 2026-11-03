#!/usr/bin/env bun
// OBJ TABLES for transport requirements -> obj-tables.json. Read from the obj configs.
//   slash:         objs whose param slashattack_anim is not human_unarmedpunch (the default, skill_combat/configs/combat.param)
//                  = what general/scripts/slash_checker.rs2 accepts WORN in the right hand (webs: general_use/scripts/web.rs2).
//   entranaBanned: objs in any category ~has_entrana_restricted_items checks (area_port_sarim/scripts/monk_of_entrana.rs2:27-55).
// Run from the repo root (<rs-sdk checkout>): bun sdk/navgrid/extract-obj-tables.ts
import { readFileSync, readdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = 'server/content';
const idByName = new Map<string, number>();
for (const line of readFileSync(`${ROOT}/pack/obj.pack`, 'utf8').split('\n')) { const m = line.match(/^(\d+)=(\S+)/); if (m) idByName.set(m[2]!, +m[1]!); }
const walk = (d: string): string[] => readdirSync(d).flatMap(e => { const p = join(d, e); return statSync(p).isDirectory() ? (e === '_unpack' ? [] : walk(p)) : p.endsWith('.obj') ? [p] : []; });
const BANNED_CATS = new Set(['armour_hands', 'weapon_staff', 'armour_helmet', 'armour_body', 'armour_legs', 'armour_shield', 'armour_cape',
    'armour_godcape', 'weapon_slash', 'weapon_blunt', 'weapon_stab', 'weapon_crossbow', 'weapon_axe', 'weapon_pickaxe', 'weapon_javelin',
    'weapon_2h_sword', 'weapon_spear', 'weapon_spiked', 'weapon_thrown', 'weapon_scythe', 'weapon_bow', 'weapon_claws', 'weapon_polearm', 'cannon_parts']);
const slash = new Set<number>(), banned = new Set<number>();
for (const f of walk(`${ROOT}/scripts`)) {
    let cur: number | undefined;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
        const h = /^\[(\w+)\]/.exec(line);
        if (h) { cur = idByName.get(h[1]!); continue; }
        if (cur === undefined) continue;
        const c = /^category=(\w+)/.exec(line);
        if (c && BANNED_CATS.has(c[1]!)) banned.add(cur);
        const p = /^param=slashattack_anim,(\w+)/.exec(line);
        if (p && p[1] !== 'human_unarmedpunch') slash.add(cur);
    }
}
const out = { slash: [...slash].sort((a, b) => a - b), entranaBanned: [...banned].sort((a, b) => a - b) };
writeFileSync('sdk/navgrid/obj-tables.json', JSON.stringify(out));
console.log(`[obj-tables] slash ${out.slash.length}, entranaBanned ${out.entranaBanned.length} -> sdk/navgrid/obj-tables.json`);

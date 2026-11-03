// run-romance.ts — launcher for Troll Romance (q-romance.ts). Modes: --live <account> | --sim [name] | --supply.
//   --sim: Death Plateau (%death_equiproom 80, %death_map 8), Troll Stronghold (%troll_quest 50) and Eadgar's Ruse
//          (%eadgar_quest 110) complete; agility 75, magic 61, prayer 43, attack/strength/defence/hitpoints 80; SUPPLY + a
//          wielded rune scimitar + worn climbing boots; teleports to Burthorpe (2899,3564).
//   ROMANCE_START=<stage> / ROMANCE_STOP=<stage> resume / stop (q-romance.ts STAGES; the sim sets %troll_love + quest items).
import { launch } from './launch-lib.js';
import * as Q from './q-romance.js';
const from = process.env.ROMANCE_START ?? 'ug1';
const SETUP: Record<string, { v: number; extra?: Array<{ name: string; n: number }>; at: { x: number; z: number; level?: number } }> = {
    ug1: { v: 0, at: Q.REQUIREMENTS.start },
    aga: { v: 5, at: { x: 2828, z: 10066, level: 1 } },
    burthorpe: { v: 10, at: { x: 2828, z: 10102, level: 1 } },
    flower: { v: 25, extra: [{ name: 'trollromance_toboggon_waxed', n: 1 }], at: { x: 2919, z: 3572 } },
    ug2: { v: 30, extra: [{ name: 'trollromance_rare_flower', n: 1 }], at: { x: 2790, z: 3794 } },
    arrg: { v: 35, at: { x: 2828, z: 10066, level: 1 } },
    ug3: { v: 40, at: { x: 2914, z: 3611 } },
};
const st = SETUP[from];
if (!st) { console.error(`ROMANCE_START=${from}: one of ${Object.keys(SETUP).join(' ')}`); process.exit(2); }
const idx = Q.STAGES.indexOf(from as typeof Q.STAGES[number]);
const supply = idx > Q.STAGES.indexOf('burthorpe') ? Q.SUPPLY.filter(i => !['maple_logs', 'iron_bar', 'rope', 'bucket_wax', 'swamp_tar', 'cake_tin'].includes(i.name)) : Q.SUPPLY;
await launch({ ...Q, SUPPLY: supply, run: (b, o) => Q.run(b, { ...o, from, to: process.env.ROMANCE_STOP }) }, {
    prefix: 'trtr',
    varps: [['death_equiproom', 80], ['death_map', 8], ['troll_quest', 50], ['eadgar_quest', 110], ['troll_love', st.v]],
    stats: { agility: 75, magic: 61, prayer: 43, attack: 80, strength: 80, defence: 80, hitpoints: 80 },
    extra: [{ name: 'rune_scimitar', n: 1 }, ...(st.extra ?? [])],
    wield: ['rune_scimitar', 'death_climbingboots'],
    start: st.at,
});

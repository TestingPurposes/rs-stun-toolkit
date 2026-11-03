// run-eadgar.ts — launcher for Eadgar's Ruse (q-eadgar.ts). Modes: --live <account> | --sim [name] | --supply.
//   --sim: sets Druidic Ritual (%druidquest 4), Death Plateau (%death_equiproom 80 + %death_map 8, quest-sharing.md), Troll
//          Stronghold (%troll_quest 50) and Plague City (%elenaquest 30) complete; herblore 31, thieving 70, agility 75, magic 58,
//          hitpoints 80, firemaking 31 (the route trains 1->31 for Sea Slug); hands over SUPPLY, wears the climbing boots, teleports to Burthorpe outside Dunstan's house.
//   EADGAR_START=<stage> resumes at a stage (STAGES in q-eadgar.ts): the sim sets %eadgar_quest and the counters that stage
//   needs, hands over the untradeable quest items it would hold, and teleports to the stage's start; EADGAR_STOP=<stage> stops.
import { launch } from './launch-lib.js';
import * as Q from './q-eadgar.js';
const from = process.env.EADGAR_START ?? 'zoo';
// %troll_varbit bit 0 = troll_freed_eadgar; bits 2-4 entered_stronghold, accepted_challenge, told: set by any Troll Stronghold
// run (told = the arena entrance passed, quest_troll.rs2:82-88; quest_troll.varbit); %eadgar_bits bit 1 logs, bit 2 clothes (eadgar_bits.constant)
const SETUP: Record<string, { q: number; freed?: boolean; extra?: Array<{ name: string; n: number }>; varps?: Array<[string, number]>; at: { x: number; z: number; level?: number } }> = {
    zoo: { q: 0, at: Q.REQUIREMENTS.start },
    sanfew: { q: 0, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }], at: { x: 2611, z: 3290 } },
    prison: { q: 10, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }], at: { x: 2897, z: 3426, level: 1 } },
    cook1: { q: 10, freed: true, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }], at: { x: 2825, z: 10052 } },
    thistle: { q: 20, freed: true, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }], at: { x: 2844, z: 10059, level: 1 } },
    eadgar1: { q: 20, freed: true, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }, { name: 'eadgar_ground_troll_thistle', n: 1 }], at: { x: 2889, z: 3678 } },
    rack1: { q: 50, freed: true, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }, { name: 'eadgar_ground_troll_thistle', n: 1 }], at: { x: 2889, z: 10085, level: 2 } },
    eadgar2: { q: 60, freed: true, extra: [{ name: 'eadgar_ground_troll_thistle', n: 1 }], at: { x: 2828, z: 10094 } },
    robe: { q: 70, freed: true, extra: [{ name: 'eadgar_ground_troll_thistle', n: 1 }], varps: [['eadgar_grain', 10], ['eadgar_chickens', 5], ['eadgar_bits', 2]], at: { x: 2889, z: 10085, level: 2 } },
    eadgar3: { q: 70, freed: true, extra: [{ name: 'eadgar_ground_troll_thistle', n: 1 }, { name: 'eadgar_dirty_druid_robe', n: 1 }], varps: [['eadgar_grain', 10], ['eadgar_chickens', 5], ['eadgar_bits', 2]], at: { x: 2912, z: 3416 } },
    rack2: { q: 85, freed: true, at: { x: 2889, z: 10085, level: 2 } },
    eadgar4: { q: 86, freed: true, extra: [{ name: 'eadgar_drunk_parrot', n: 1 }], at: { x: 2828, z: 10094 } },
    cook2: { q: 87, freed: true, extra: [{ name: 'eadgar_fake_man', n: 1 }], at: { x: 2889, z: 10085, level: 2 } },
    finish: { q: 100, freed: true, extra: [{ name: 'eadgar_goutweed_herb', n: 1 }], at: { x: 2865, z: 10088 } },
};
const st = SETUP[from];
if (!st) { console.error(`EADGAR_START=${from}: one of ${Object.keys(SETUP).join(' ')}`); process.exit(2); }
// resumed late stages: the items already handed in (or used) are not handed over again (the pack would overflow)
const idx = Q.STAGES.indexOf(from as typeof Q.STAGES[number]);
const used = new Set([...(idx > Q.STAGES.indexOf('zoo') ? ['pineapple_chunks', 'vodka'] : []),
    ...(idx > Q.STAGES.indexOf('thistle') ? ['tinderbox'] : []),
    ...(idx > Q.STAGES.indexOf('eadgar2') ? ['raw_chicken', 'grain', 'logs'] : []),
    ...(idx > Q.STAGES.indexOf('eadgar3') ? ['ranarrvial', 'pestle_and_mortar'] : [])]);
const supply = Q.SUPPLY.filter(i => !used.has(i.name));
await launch({ ...Q, SUPPLY: supply, run: (b, o) => Q.run(b, { ...o, from, to: process.env.EADGAR_STOP }) }, {
    prefix: 'treg',
    varps: [['druidquest', 4], ['death_equiproom', 80], ['death_map', 8], ['troll_quest', 50], ['elenaquest', 30],
        ['troll_varbit', (st.freed ? 1 : 0) | 4 | 8 | 16], ['eadgar_quest', st.q], ...(st.varps ?? [])],
    stats: { herblore: 31, thieving: 70, agility: 75, magic: 58, hitpoints: 80, defence: 70, firemaking: 31, prayer: 43 },
    extra: st.extra,
    wield: ['death_climbingboots'],
    bank: Q.BANK_SUPPLY,
    start: st.at,
});

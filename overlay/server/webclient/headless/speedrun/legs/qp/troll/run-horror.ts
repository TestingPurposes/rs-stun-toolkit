// run-horror.ts — launcher for Horror from the Deep (q-horror.ts). Modes: --live <account> | --sim [name] | --supply.
//   --sim: sets the Barcrawl complete (%barcrawl 2), agility 75 / prayer 43 / magic 75 / melee 80 / hp 80 (see STATUS.md for the
//          stats A/B), hands over SUPPLY + a wielded rune scimitar, teleports outside the outpost gate.
//   HORROR_START=<stage> resumes at a stage (q-horror.ts STAGES): the sim sets the varbits that stage needs (%deephorror bits,
//   quest_horror.varbit) and teleports to its start; HORROR_SPELLS=wave|blast picks the spell tier.
import { launch } from './launch-lib.js';
import * as Q from './q-horror.js';
const from = process.env.HORROR_START ?? 'gate';
const spells = (process.env.HORROR_SPELLS ?? 'wave') as 'wave' | 'blast';
const B = (bits: number[]) => bits.reduce((a, b) => a | (1 << b), 0);
// %deephorror: horrorquest bits 0-10, bridgeleft 12, bridgeright 13, agilitykey 14, entrance 15, door items 16-21
const SETUP: Record<string, { v: number; key?: boolean; at: { x: number; z: number; level?: number } }> = {
    gate: { v: 0, at: { x: 2546, z: 3569 } },
    basaltN: { v: 0, at: { x: 2544, z: 3569 } },
    start: { v: 0, at: { x: 2508, z: 3632 } },
    basaltS: { v: 1, at: { x: 2514, z: 3621 } },
    key: { v: 1, at: { x: 2544, z: 3569 } },
    basaltN2: { v: 1 | B([14]), key: true, at: { x: 2544, z: 3569 } },
    bridge: { v: 1 | B([14]), key: true, at: { x: 2590, z: 3606 } },
    door: { v: 1 | B([12, 13, 14]), key: true, at: { x: 2509, z: 3633 } },
    light: { v: 2 | B([12, 13, 14, 15]), at: { x: 2445, z: 4598 } },
    cave: { v: 4 | B([12, 13, 14, 15, 22, 23, 24]), at: { x: 2507, z: 3639, level: 2 } },
    fight: { v: 4 | B([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]), at: { x: 2516, z: 4632 } },
};
const st = SETUP[from];
if (!st) { console.error(`HORROR_START=${from}: one of ${Object.keys(SETUP).join(' ')}`); process.exit(2); }
await launch({ ...Q, run: (b, o) => Q.run(b, { ...o, from, to: process.env.HORROR_STOP, spells, jr: (process.env.HORROR_JR ?? 'magic') as 'magic' | 'melee' }) }, {
    prefix: 'trhd',
    varps: [['barcrawl', 2], ['deephorror', st.v]],
    stats: process.env.HORROR_STATS === '99' ? { agility: 99, prayer: 99, magic: 99, attack: 99, strength: 99, defence: 99, hitpoints: 99 }
        : { agility: 75, prayer: 43, magic: 75, attack: 80, strength: 80, defence: 80, hitpoints: 80 },
    extra: [{ name: 'rune_scimitar', n: 1 }, ...(st.key ? [{ name: 'horror_key', n: 1 }] : [])],
    wield: ['rune_scimitar'],
    start: st.at,
});

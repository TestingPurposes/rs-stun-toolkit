// run-fremennik.ts — launcher for The Fremennik Trials (q-fremennik.ts). Modes: --live <account> | --sim [name] | --supply.
//   --sim: woodcutting/crafting 40, fletching 25, magic 45, attack/strength/defence/hitpoints 80; SUPPLY + a wielded rune
//          scimitar; teleports to the Camelot Teleport landing. FREM_START=<stage> / FREM_STOP=<stage> resume / stop
//          (the sim sets %viking / %viking_bits and the quest items that stage needs).
import { launch } from './launch-lib.js';
import * as Q from './q-fremennik.js';
const from = process.env.FREM_START ?? 'firecracker', route = process.env.FREM_ROUTE ?? 'm';
// %viking_bits fields (quest_viking.constant): bit 0 firecracker placed; swensen 10-11, reveller 12-13, sigli 14-15, thorvald 16-17,
// peer 18-19, olaf 20-22, sigmund 23-26. %viking = 1 + votes.
const F = (o: Record<string, number>) => (o.fc ?? 0) | ((o.swensen ?? 0) << 10) | ((o.reveller ?? 0) << 12) | ((o.sigli ?? 0) << 14)
    | ((o.thorvald ?? 0) << 16) | ((o.peer ?? 0) << 18) | ((o.olaf ?? 0) << 20) | ((o.sigmund ?? 0) << 23);
const STARTED = { fc: 1, swensen: 2, reveller: 1, sigli: 1, thorvald: 1, olaf: 1, sigmund: 1 };
const RELLEKKA = { x: 2659, z: 3664 };
const KIT1 = [{ name: 'viking_beerkeg', n: 1 }, { name: 'viking_draugen_talisman_uncharged', n: 1 }];
const SETUP: Record<string, { v: number; bits?: number; extra?: Array<{ name: string; n: number }>; at: { x: number; z: number; level?: number } }> = {
    firecracker: { v: 0, at: Q.REQUIREMENTS.start },
    starts: { v: 0, extra: [{ name: 'viking_firecracker', n: 1 }], at: RELLEKKA },
    startsM: { v: 0, extra: [{ name: 'viking_firecracker', n: 1 }], at: RELLEKKA },
    // route m runs east1 after Sigmund's chain (3 votes: Swensen, Sigmund... = %viking 3); route a before it
    east1: route === 'm' ? { v: 3, bits: F({ ...STARTED, sigmund: 15 }), extra: KIT1, at: RELLEKKA } : { v: 2, bits: F(STARTED), extra: KIT1, at: RELLEKKA },
    rock: { v: 3, bits: F({ ...STARTED, olaf: 2, sigmund: 15 }), extra: [...KIT1, { name: 'viking_unstrung_lyre', n: 1 }], at: { x: 2771, z: 3623 } },
    chain: { v: 2, bits: F({ ...STARTED, olaf: 2 }), extra: [...KIT1, { name: 'viking_unstrung_lyre', n: 1 }], at: RELLEKKA },
    seers: { v: 3, bits: F({ ...STARTED, sigli: 2, olaf: 5, sigmund: 15 }), extra: [{ name: 'viking_beerkeg', n: 1 }, { name: 'viking_draugen_talisman', n: 1 }, { name: 'viking_golden_fleece', n: 1 }, { name: 'viking_unstrung_lyre', n: 1 }], at: { x: 2686, z: 3616 } },
    votes: { v: 3, bits: F({ ...STARTED, sigli: 2, olaf: 5, sigmund: 15 }), extra: [{ name: 'viking_beerkeg', n: 1 }, { name: 'viking_draugen_talisman', n: 1 }, { name: 'viking_enchanted_strung_lyre', n: 1 }, { name: 'viking_low_alcahol_beerkeg', n: 1 }], at: { x: 2626, z: 3599 } },
    peer: { v: 7, bits: F({ fc: 1, swensen: 2, reveller: 2, sigli: 3, thorvald: 2, olaf: 7, sigmund: 15 }), at: RELLEKKA },
    brundt: { v: 8, bits: F({ fc: 1, swensen: 2, reveller: 2, sigli: 3, thorvald: 2, olaf: 7, sigmund: 15, peer: 3 }), at: RELLEKKA },
    east2: { v: 3, bits: F({ ...STARTED, olaf: 3, sigmund: 15 }), extra: [...KIT1, { name: 'viking_unstrung_lyre', n: 1 }, { name: 'vt_useless_rock', n: 1 }], at: RELLEKKA },
};
const st = SETUP[from];
if (!st) { console.error(`FREM_START=${from}: one of ${Object.keys(SETUP).join(' ')}`); process.exit(2); }
await launch({ ...Q, SUPPLY: from === 'firecracker' ? Q.SUPPLY : Q.SUPPLY.filter(i => i.name !== 'beer'), run: (b, o) => Q.run(b, { ...o, from, route, to: process.env.FREM_STOP }) }, {
    prefix: 'tf',
    varps: [['viking', st.v], ['viking_bits', st.bits ?? 0]],
    // FREM_STATS=99: the all-99 comparison (Draugen + Koschei are stat-bound)
    stats: process.env.FREM_STATS === '99' ? { woodcutting: 99, crafting: 99, fletching: 99, magic: 99, prayer: 99, attack: 99, strength: 99, defence: 99, hitpoints: 99 }
        : { woodcutting: 40, crafting: 40, fletching: 25, magic: 45, prayer: 43, attack: 80, strength: 80, defence: 80, hitpoints: 80 },
    extra: [{ name: 'rune_scimitar', n: 1 }, ...(st.extra ?? [])],
    wield: ['rune_scimitar'],
    start: st.at,
});

// run-watch-tower.ts — launcher for Watch Tower (q-watch-tower.ts).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, sets the sim stats, hands over SUPPLY (+ wields the weapon),
//                      teleports to the start. Debug: --from <segment> (cheat-set quest state), --env K=V (A/B switches).
//   --supply           prints the supply list.
import * as Q from './q-watch-tower.js';
import { launch } from './we-lib.js';

// route state at Watch Tower (audit P2): Waterfall done (att/str 83), Druidic (herblore ~28), Doric (mining ~49), Grand Tree
// (agility ~75), Hazeel/Totem (thieving ~50+), Imp (magic ~44)
const STATS = { attack: 83, strength: 83, defence: 60, hitpoints: 70, magic: 45, agility: 75, thieving: 50, herblore: 28, mining: 49 };
const B = (n: number) => 1 << n;
const V = (stage: number, bits = 0, gold = 0) => [`setvar itwatchtower ${stage}`, `setvar itwatchtower_bits ${bits}`, `setvar gutanoth_gold ${gold}`];
const HILL = { x: 2549, z: 3120 };
// bits: 1 spoken_toban, 2 helped_toban, 3-4 grew (1 spoken, 2 helped), 5 spoken_og, 6 helped_og, 10-11 market, 12-16 skavid, 17-19 kills
const GREW1 = 1 << 3, GREW2 = 2 << 3, SKAVID = 31 << 12;
await launch(Q, 'watch-tower', {
    stats: STATS,
    // Lost City complete (%zanaris 6, quest.constant:61): the dragon longsword's wield gate (levelrequire.rs2:118)
    varps: ['setvar zanaris 6'],
    wield: [Q.WEAPON],
    segs: {
        start: { tele: HILL },
        nails: { varps: V(1), tele: HILL },
        wiz2: { varps: V(1), items: [{ name: 'fingernails', n: 1 }], tele: HILL },
        og1: { varps: V(2), tele: HILL },
        grew1: { varps: V(2, B(5)), items: [{ name: 'toban_key', n: 1 }], tele: { x: 2504, z: 3100 } },
        toban: { varps: V(2, B(5) | GREW1), items: [{ name: 'toban_key', n: 1 }], tele: { x: 2501, z: 2992 } },
        og2: { varps: V(2, B(5) | GREW1 | B(1) | B(2)), items: [{ name: 'stolen_gold', n: 1 }, { name: 'relicpart3', n: 1 }, { name: 'ogretooth', n: 1 }], tele: { x: 2506, z: 3108 } },
        grew2: { varps: V(2, B(5) | B(6) | GREW1 | B(1) | B(2)), items: [{ name: 'relicpart1', n: 1 }, { name: 'relicpart3', n: 1 }, { name: 'ogretooth', n: 1 }], tele: { x: 2502, z: 3090 } },
        relic: { varps: V(2, B(5) | B(6) | GREW2 | B(1) | B(2)), items: [{ name: 'relicpart1', n: 1 }, { name: 'relicpart2', n: 1 }, { name: 'relicpart3', n: 1 }, { name: 'powering_crystal1', n: 1 }], tele: HILL },
        gate2: { varps: V(3, B(5) | B(6) | GREW2 | B(1) | B(2)), items: [{ name: 'ogrerelic', n: 1 }, { name: 'powering_crystal1', n: 1 }], tele: { x: 2509, z: 3062 } },
        cake: { varps: V(4, B(5) | B(6) | GREW2 | B(1) | B(2)), items: [{ name: 'powering_crystal1', n: 1 }], tele: { x: 2503, z: 3062 } },
        map: { varps: V(4, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10)), items: [{ name: 'powering_crystal1', n: 1 }], tele: { x: 2509, z: 3011 } },
        back: { varps: V(6, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10)), items: [{ name: 'powering_crystal1', n: 1 }, { name: 'skavidmap', n: 1 }], tele: { x: 2533, z: 3032 } },
        caves: { varps: V(6, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10)), items: [{ name: 'powering_crystal1', n: 1 }, { name: 'skavidmap', n: 1 }], tele: { x: 2553, z: 3036 } },
        enclave1: { varps: V(7, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10) | SKAVID, 2), items: [{ name: 'powering_crystal1', n: 1 }, { name: 'powering_crystal2', n: 1 }, { name: 'nightshade', n: 2 }], tele: { x: 2509, z: 3062 } },
        potion: { varps: V(8, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10) | SKAVID, 2), items: [{ name: 'powering_crystal1', n: 1 }, { name: 'powering_crystal2', n: 1 }, { name: 'nightshade', n: 1 }], tele: { x: 2540, z: 3056 } },
        shamans: { varps: V(10, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10) | SKAVID, 2), items: [{ name: 'powering_crystal1', n: 1 }, { name: 'powering_crystal2', n: 1 }, { name: 'nightshade', n: 1 }, { name: 'magic_ogre_potion', n: 1 }], tele: { x: 2509, z: 3062 } },
        finish: { varps: V(10, B(5) | B(6) | GREW2 | B(1) | B(2) | (2 << 10) | SKAVID | (6 << 17), 2), items: [{ name: 'powering_crystal1', n: 1 }, { name: 'powering_crystal2', n: 1 }, { name: 'powering_crystal3', n: 1 }, { name: 'powering_crystal4', n: 1 }], tele: { x: 2540, z: 3056 } },
    },
});

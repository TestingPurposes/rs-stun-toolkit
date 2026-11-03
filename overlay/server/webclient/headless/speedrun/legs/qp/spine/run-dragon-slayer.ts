/// <reference types="bun" />
// run-dragon-slayer.ts — launcher for q-dragon-slayer.ts (lane spine).
//   bun headless/speedrun/legs/qp/spine/run-dragon-slayer.ts --live <account>   (cheats blocked)
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/spine/run-dragon-slayer.ts --sim [name]
//   bun headless/speedrun/legs/qp/spine/run-dragon-slayer.ts --supply
// --sim: drops the tutorial kit; QP 33 from 8 completed quests that do not touch Dragon Slayer (Romeo & Juliet 5, Goblin
// Diplomacy 5, Druidic Ritual 4, Merlin's Crystal 6, Ernest 4, Vampire Slayer 3, Prince Ali 3, Black Knights' Fortress 3 —
// completion values from each quest's .constant, counted by general/scripts/quests.rs2:96-302); route stats; SUPPLY;
// worn gear; teleport to the guild door. SP_STATS=99 uses 99 melee/hp/prayer instead.
// DS_FROM=<phase> (sim only, debugging): sets the quest varps + items that phase starts from and teleports there.
import * as Q from './q-dragon-slayer.js';
import { launch, type SimSetup } from './sp-launch.js';

const QP33 = ['setvar rjquest 100', 'setvar goblinquest 6', 'setvar druidquest 4', 'setvar arthur 7', 'setvar haunted 3', 'setvar vampire 3', 'setvar princequest 110', 'setvar spy 4', 'setvar qp 33'];
/** route stats at Dragon Slayer (max-QP audit P3 order: Waterfall att/str 83, Witch's House hp, Grail def; kept lower) */
const ROUTE = { attack: 80, strength: 80, defence: 70, hitpoints: 70, prayer: 43, magic: 59 };
const MAX = { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99, magic: 99 };
const sim: SimSetup = { cheats: QP33, stats: process.env.SP_STATS === '99' ? MAX : ROUTE };

const FROM = process.env.DS_FROM as Q.Phase | undefined;
if (FROM && !Q.PHASES.includes(FROM)) { console.error(`DS_FROM must be one of ${Q.PHASES.join(' ')}`); process.exit(2); }
const RESUME: Partial<Record<Q.Phase, { cheats: string[]; extra: Array<{ name: string; n: number }>; at: { x: number; z: number; level: number } }>> = {
    oziach: { cheats: ['setvar dragonquest 1'], extra: [], at: { x: 3191, z: 3361, level: 0 } },
    oracle: { cheats: ['setvar dragonquest 2', 'setvar dragon_oracle 1', 'setvar dragon_goblin 1'], extra: [{ name: 'melzarkey', n: 1 }], at: { x: 3087, z: 3496, level: 0 } },
    mine: { cheats: ['setvar dragonquest 2', 'setvar dragon_oracle 2', 'setvar dragon_goblin 1'], extra: [{ name: 'melzarkey', n: 1 }], at: { x: 3015, z: 3500, level: 0 } },
    maze: { cheats: ['setvar dragonquest 2', 'setvar dragon_oracle 3', 'setvar dragon_goblin 1'], extra: [{ name: 'melzarkey', n: 1 }, { name: 'mappart3', n: 1 }], at: { x: 3057, z: 9842, level: 0 } },
    sarim: { cheats: ['setvar dragonquest 2', 'setvar dragon_oracle 3', 'setvar dragon_goblin 1'], extra: [{ name: 'melzarkey', n: 1 }, { name: 'mappart3', n: 1 }, { name: 'mappart1', n: 1 }], at: { x: 2942, z: 3248, level: 0 } },
    ship: { cheats: ['setvar dragonquest 3', 'setvar dragon_oracle 3', 'setvar dragon_goblin 1'], extra: [{ name: 'dragonmap', n: 1 }], at: { x: 3047, z: 3203, level: 0 } },
    ned: { cheats: ['setvar dragonquest 7', 'setvar dragonquestvar 3', 'setvar dragon_oracle 3'], extra: [{ name: 'dragonmap', n: 1 }], at: { x: 3047, z: 9640, level: 2 } },
    sail: { cheats: ['setvar dragonquest 8', 'setvar dragonquestvar 3', 'setvar dragon_ned_hired 1'], extra: [], at: { x: 3100, z: 3255, level: 0 } },
    elvarg: { cheats: ['setvar dragonquest 9'], extra: [], at: { x: 2851, z: 3235, level: 0 } },
};
const r = FROM ? RESUME[FROM] : undefined;
if (r) {
    sim.cheats = [...QP33, ...r.cheats];
    sim.extra = r.extra;
    (Q.REQUIREMENTS as any).start = r.at;
}
// A/B: SP_WEAPON=<obj debugname> replaces the rune scimitar (sim and live alike)
const W = process.env.SP_WEAPON;
if (W) {
    const i = Q.SUPPLY.findIndex(x => x.name === 'rune_scimitar'); if (i >= 0) Q.SUPPLY[i] = { name: W, n: 1 };
    const j = Q.WEAR.indexOf('rune_scimitar'); if (j >= 0) Q.WEAR[j] = W;
    // dragon weapons need Lost City to wield (levelrequire.rs2:118-119 -> %zanaris complete)
    if (/^dragon_/.test(W)) sim.cheats = [...(sim.cheats ?? []), 'setvar zanaris 6'];
}
const mod = { ...Q, run: (bot: any, o: any) => Q.run(bot, { ...o, from: FROM }) };
await launch(mod, sim, 'dragon-slayer');

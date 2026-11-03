/// <reference types="bun" />
// run-family-crest.ts — launcher for q-family-crest.ts (lane spine).
//   bun headless/speedrun/legs/qp/spine/run-family-crest.ts --live <account>   (cheats blocked)
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/spine/run-family-crest.ts --sim [name]
//   bun headless/speedrun/legs/qp/spine/run-family-crest.ts --supply
// --sim: drops the tutorial kit; Plague City + scroll (%elenaquest 30, for the Ardougne teleport); route stats; SUPPLY;
// teleport next to Dimintheis's house. SP_STATS=99 uses 99s. FC_FROM=<phase> (sim debugging) starts at that phase.
import * as Q from './q-family-crest.js';
import { launch, type SimSetup } from './sp-launch.js';

const ROUTE = { attack: 80, strength: 80, defence: 70, hitpoints: 75, prayer: 47, magic: 70, mining: 55, crafting: 45, smithing: 45 };
const MAX = { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99, magic: 99, mining: 99, crafting: 99, smithing: 99 };
const sim: SimSetup = { cheats: ['setvar elenaquest 30'], stats: process.env.SP_STATS === '99' ? MAX : ROUTE };

const FROM = process.env.FC_FROM as Q.Phase | undefined;
if (FROM && !Q.PHASES.includes(FROM)) { console.error(`FC_FROM must be one of ${Q.PHASES.join(' ')}`); process.exit(2); }
const RESUME: Partial<Record<Q.Phase, { cheats: string[]; extra: Array<{ name: string; n: number }>; at: { x: number; z: number; level: number } }>> = {
    gem: { cheats: ['setvar crestquest 4'], extra: [{ name: 'avan_crest', n: 1 }], at: { x: 2819, z: 3448, level: 0 } },
    boot: { cheats: ['setvar crestquest 6'], extra: [{ name: 'avan_crest', n: 1 }], at: { x: 3295, z: 3282, level: 0 } },
    gold: { cheats: ['setvar crestquest 7'], extra: [{ name: 'avan_crest', n: 1 }], at: { x: 2965, z: 9813, level: 0 } },
    jewellery: { cheats: ['setvar crestquest 7'], extra: [{ name: 'avan_crest', n: 1 }, { name: 'perfect_gold_ore', n: 2 }], at: { x: 2737, z: 9690, level: 0 } },
    johnathon: { cheats: ['setvar crestquest 8'], extra: [{ name: 'avan_crest', n: 1 }, { name: 'caleb_crest', n: 1 }], at: { x: 3295, z: 3282, level: 0 } },
    chronozon: { cheats: ['setvar crestquest 10'], extra: [{ name: 'avan_crest', n: 1 }, { name: 'caleb_crest', n: 1 }], at: { x: 3279, z: 3500, level: 1 } },
};
const r = FROM ? RESUME[FROM] : undefined;
if (r) { sim.cheats = [...(sim.cheats ?? []), ...r.cheats]; sim.extra = r.extra; (Q.REQUIREMENTS as any).start = r.at; }
const mod = { ...Q, run: (bot: any, o: any) => Q.run(bot, { ...o, from: FROM }) };
await launch(mod, sim, 'family-crest');

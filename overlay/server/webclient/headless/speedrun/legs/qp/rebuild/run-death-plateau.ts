// run-death-plateau.ts — launcher for Death Plateau (q-death-plateau.ts), lane rebuild.
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, gives SUPPLY, teleports next to Denulth.
//   --supply           prints the supply list.
// Sim-only probing: RB_DP_FROM=<phase> sets the quest varps of that phase (setvar), hands the quest items it needs and
// teleports there; run({ from }) skips the earlier phases. Proof runs never set it.
import * as Q from './q-death-plateau.js';
import { launch, type SimSetup } from '../f2p-a/fa-lib.js';
import { localSetup } from '../../../core.js';

declare const process: { env: Record<string, string | undefined> };
const from = Number(process.env.RB_DP_FROM ?? 0);
// %death_bits: Harold's purse in bits 9-23 (quest_death.constant), 100 gp = 51200; %death_map bits 0-3 = the map stage
const PH: Record<number, { varps: string[]; items: { name: string; n: number }[]; tele: { x: number; z: number; level: number } }> = {
    5: { varps: ['setvar death_equiproom 30', 'setvar death_map 4', 'setvar death_bits 51200'], items: [{ name: 'death_climbingboots', n: 1 }, { name: 'death_entrancecert', n: 1 }], tele: { x: 2900, z: 3566, level: 1 } },
    7: { varps: ['setvar death_equiproom 40', 'setvar death_map 5', 'setvar death_bits 51200'], items: [{ name: 'death_spikedboots', n: 1 }], tele: { x: 2906, z: 3540, level: 1 } },
    8: { varps: ['setvar death_equiproom 60', 'setvar death_map 5'], items: [{ name: 'death_spikedboots', n: 1 }, { name: 'death_combination', n: 1 }], tele: { x: 2892, z: 3562, level: 0 } },
    9: { varps: ['setvar death_equiproom 70', 'setvar death_map 5'], items: [{ name: 'death_spikedboots', n: 1 }, { name: 'death_combination', n: 1 }], tele: { x: 2892, z: 3562, level: 0 } },
};
const sim: SimSetup = {};
if (from && PH[from]) {
    const p = PH[from]!;
    sim.varps = p.varps;
    sim.preSim = async (bot) => { await localSetup(bot, { items: p.items }); };
    sim.runOpts = async (bot) => { await localSetup(bot, { tele: p.tele }); await bot.tick(2); return { from }; };
}
// no stat gate in quest_death; sim stats = a fresh account (the route reaches it with high combat, irrelevant here)
await launch(Q, 'death-plateau', sim);

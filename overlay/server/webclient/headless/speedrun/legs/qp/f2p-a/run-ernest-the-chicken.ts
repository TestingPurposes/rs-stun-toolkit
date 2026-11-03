// run-ernest-the-chicken.ts — launcher for Ernest the Chicken (q-ernest-the-chicken.ts). f2p-a agent "fe".
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, gives the supplies, teleports next to Veronica, runs.
//                      FE_GLORY=1: also gives an amulet of glory, moves the sim to Lumbridge (3222,3218) and the leg starts
//                      with the glory rub to Draynor Village (measures the approach). FE_CLOSET=first|last (A/B).
//   --supply           prints the supply list.
import * as Q from './q-ernest-the-chicken.js';
import { launch } from './fa-lib.js';
import { localSetup } from '../../../core.js';

declare const process: { env: Record<string, string | undefined> };
const glory = process.env.FE_GLORY === '1';
await launch(Q, 'ernest-the-chicken', {
    items: glory ? [{ name: 'amulet_of_glory_4', n: 1 }] : [],
    runOpts: async (bot) => {
        if (!glory) return {};
        await localSetup(bot, { tele: { x: 3222, z: 3218, level: 0 } });
        await bot.tick(2);
        return { glory: true };
    },
});

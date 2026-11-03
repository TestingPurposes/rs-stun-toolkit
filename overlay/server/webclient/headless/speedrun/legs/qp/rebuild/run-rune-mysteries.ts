// run-rune-mysteries.ts — launcher for Rune Mysteries (q-rune-mysteries.ts), lane rebuild.
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, sets the sim stats, gives SUPPLY, teleports to start.
//   --supply           prints the supply list.
import * as Q from './q-rune-mysteries.js';
import { launch } from '../f2p-a/fa-lib.js';

declare const process: { env: Record<string, string | undefined> };
// magic 25 = Varrock Teleport (the route has magic ~45 here: ROUTE-QP.md P4); RB_RM_BACK=lumb needs 31
await launch(Q, 'rune-mysteries', { stats: { magic: Number(process.env.RB_MAGIC ?? 25) }, wield: ['staff_of_air'] });

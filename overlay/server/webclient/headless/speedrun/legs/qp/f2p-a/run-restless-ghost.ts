// run-restless-ghost.ts — launcher for Cook's Assistant (q-restless-ghost.ts).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, gives the supplies, teleports to Father Aereck.
//   --supply           prints the supply list.
import * as Q from './q-restless-ghost.js';
import { launch } from './fa-lib.js';

// sim stats: magic 31 for the Lumbridge Teleport back (FA_NOTELE=1 walks instead); hitpoints 10 = a fresh account
await launch(Q, 'restless-ghost', { stats: { magic: 31 }, wield: ['staff_of_air'] });

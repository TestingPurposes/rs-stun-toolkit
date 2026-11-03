// run-gertrudes-cat.ts — launcher for Gertrude's Cat (q-gertrudes-cat.ts). Members world (the lumber-yard fence).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, sets magic 25, gives the supplies (staff of air wielded),
//                      teleports to Gertrude. FA_NOTELE=1 walks back instead of the Varrock Teleport (A/B).
//   --supply           prints the supply list.
import * as Q from './q-gertrudes-cat.js';
import { launch } from './fa-lib.js';

await launch(Q, 'gertrudes-cat', { stats: { magic: 25 }, wield: ['staff_of_air'] });

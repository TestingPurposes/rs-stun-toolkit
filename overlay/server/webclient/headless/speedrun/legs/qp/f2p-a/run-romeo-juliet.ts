// run-romeo-juliet.ts — launcher for Romeo & Juliet (q-romeo-juliet.ts). f2p-a agent 2.
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, magic 25, gives the supplies (staff of air wielded),
//                      teleports to the street east of Juliet's house. FC_TELE=juliet1,lawrence,juliet (default) | any subset | none (A/B).
//   --supply           prints the supply list.
import * as Q from './q-romeo-juliet.js';
import { launch } from './fa-lib.js';

await launch(Q, 'romeo-juliet', { stats: { magic: 25 }, wield: ['staff_of_air'] });

// run-fishing-contest.ts — launcher for Fishing Contest (q-fishing-contest.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, sets stats, hands over SUPPLY, teleports to the start
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success.
import * as Q from './q-fishing-contest.js';
import { launch } from './ka-lib.js';

await launch(Q, { stats: { fishing: 10, magic: 45, hitpoints: 20 } });

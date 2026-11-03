// run-monks-friend.ts — launcher for Monk's Friend (q-monks-friend.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, sets stats, hands over SUPPLY, teleports to the start
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success.
import * as Q from './q-monks-friend.js';
import { launch } from './ka-lib.js';

// hp 20: the cave thieves landed 3 damage on a 10-hp account (ka5); no other stat is checked anywhere in the quest
await launch(Q, { stats: { hitpoints: 20 } });

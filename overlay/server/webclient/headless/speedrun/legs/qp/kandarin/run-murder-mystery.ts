// run-murder-mystery.ts — launcher for Murder Mystery (q-murder-mystery.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, hands over SUPPLY, teleports to the start
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success. The culprit is random per account (one of six).
import * as Q from './q-murder-mystery.js';
import { launch } from './ka-lib.js';

await launch(Q, { stats: { hitpoints: 20 } });

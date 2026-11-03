// run-cooks-assistant.ts — launcher for Cook's Assistant (q-cooks-assistant.ts).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, gives the supplies, teleports to the kitchen.
//   --supply           prints the supply list.
import * as Q from './q-cooks-assistant.js';
import { launch } from './fa-lib.js';

await launch(Q, 'cooks-assistant', {});

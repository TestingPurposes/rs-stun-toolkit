// run-sheep-shearer.ts — launcher for Sheep Shearer (q-sheep-shearer.ts).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, gives the supplies, teleports to Fred.
//   --supply           prints the supply list.
import * as Q from './q-sheep-shearer.js';
import { launch } from './fa-lib.js';

await launch(Q, 'sheep-shearer', {});

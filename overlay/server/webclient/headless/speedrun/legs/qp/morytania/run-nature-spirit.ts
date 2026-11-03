/// <reference types="node" />
// run-nature-spirit.ts — launcher for q-nature-spirit.ts.
//   --live <account>   real account (bots/<account>/bot.env), every staff cheat throws. Needs Priest in Peril to stage 61
//                      (ends next to Drezel in the mausoleum), the ghostspeak amulet (The Restless Ghost) and the Wolfbane
//                      dagger kept, a silver sickle in the pack.
//   --sim [name]       LOCAL engine only: drops the tutorial kit, sets Priest in Peril to 61 (%priestperil), hands over the
//                      Wolfbane + ghostspeak amulet (untradeable: a live route keeps them from those quests), the sickle,
//                      a weapon, sets the stats and teleports next to Drezel.
//   --start-myreque    also start In Search of the Myreque at Vanstrom (Canifis) on the first trip out.
//   --supply           prints the supply list.
import { launch } from './mo-lib.js';
import { QUEST, REQUIREMENTS, SUPPLY, WEAR, run } from './q-nature-spirit.js';

await launch({
    quest: QUEST, reqs: REQUIREMENTS, supply: SUPPLY, wear: WEAR, tag: 'nature-spirit',
    simVarps: [['priestperil', 61]],
    simKeep: [{ name: 'dagger_wolfbane', n: 1 }],
    simStats: { attack: 40, strength: 40, defence: 40, hitpoints: 40, prayer: 43 },
    run: (bot, o) => run(bot, { ...o, startMyreque: process.argv.includes('--start-myreque') }),
});

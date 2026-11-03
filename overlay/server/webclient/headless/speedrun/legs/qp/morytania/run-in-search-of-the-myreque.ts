/// <reference types="node" />
// run-in-search-of-the-myreque.ts — launcher for q-in-search-of-the-myreque.ts.
//   --live <account>   real account (bots/<account>/bot.env), every staff cheat throws. Needs Nature Spirit done (or at
//                      least the druid pouch with >= 5 charges), agility 25, SUPPLY in the pack (weapons NOT worn).
//   --sim [name]       LOCAL engine only: drops the tutorial kit, sets Priest in Peril 61 + Nature Spirit complete
//                      (%priestperil, %druidspirit), hands over the druid pouch (5 charges; untradeable: a live route
//                      keeps it from Nature Spirit), SUPPLY and a weapon, sets the stats and teleports next to Vanstrom.
//   --supply           prints the supply list.
import { launch } from './mo-lib.js';
import { QUEST, REQUIREMENTS, SUPPLY, KEEP, WEAR, run } from './q-in-search-of-the-myreque.js';

await launch({
    quest: QUEST, reqs: REQUIREMENTS, supply: SUPPLY, wear: WEAR, tag: 'myreque',
    simVarps: [['priestperil', 61], ['druidspirit', 110]],
    simKeep: KEEP,
    simStats: { attack: 70, strength: 70, defence: 70, hitpoints: 70, agility: 25, prayer: 43 },
    run: (bot, o) => run(bot, o),
});

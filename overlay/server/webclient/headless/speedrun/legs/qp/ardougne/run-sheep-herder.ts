// run-sheep-herder.ts — launcher for q-sheep-herder.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: no quest/skill gates, no combat. Start next to Councillor Halgrive, East Ardougne (2616,3301), with 100 coins
//         and free right-hand + body + legs slots (prod, plague suit). The four diseased sheep are GLOBAL npcs.
//   SIM:  no prerequisite varps or stats.
import * as Q from './q-sheep-herder.js';
import { launch } from './ar-launch.js';

await launch(Q, { prefix: 'arsh', stats: {} });

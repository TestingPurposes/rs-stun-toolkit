// run-clock-tower.ts — launcher for q-clock-tower.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: no quest/skill gates, but the cellars hold aggressive poison spiders (npc 134) and giant spiders (59): a level-3
//         account DIED there (arct5). Proven at att/str/def/hp 40 + 4 lobsters. Start next to Brother Kojo (2569,3251)
//         with a bucket of water.
//   SIM:  no prerequisite varps; the stats below + 4 lobsters.
import * as Q from './q-clock-tower.js';
import { launch } from './ar-launch.js';

await launch(Q, { prefix: 'arct', stats: { attack: 40, strength: 40, defence: 40, hitpoints: 40 }, extra: [{ name: 'lobster', n: 4 }] });

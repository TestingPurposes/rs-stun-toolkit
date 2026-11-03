// run-observatory.ts — launcher for q-observatory.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: no quest/skill gates; the goblin guard (cl 42) at the keep gate aggroes and dungeon goblins roam. Proven at
//         att/str/def/hp 40 + 4 lobsters. Start in the observatory reception (2441,3190) with SUPPLY and 3 free slots.
//   SIM:  no prerequisite varps; the stats below + 4 lobsters.
import * as Q from './q-observatory.js';
import { launch } from './ar-launch.js';

await launch(Q, { prefix: 'arob', stats: { attack: 40, strength: 40, defence: 40, hitpoints: 40 }, extra: [{ name: 'lobster', n: 4 }] });

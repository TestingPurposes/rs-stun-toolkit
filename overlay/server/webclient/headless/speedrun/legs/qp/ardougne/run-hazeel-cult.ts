// run-hazeel-cult.ts — launcher for q-hazeel-cult.ts (good side; modes: --live <account> | --sim [name] | --supply).
//   LIVE: no quest/skill gates; Alomone (cl 13, 25 hp) must be killed. Proven at att/str/def/hp 40 + rune scimitar.
//         Start next to Sir Ceril, Carnillean mansion ground floor (2566,3269).
//   SIM:  no prerequisite varps; the stats below + a wielded rune scimitar.
import * as Q from './q-hazeel-cult.js';
import { launch } from './ar-launch.js';

await launch(Q, { prefix: 'arhc', stats: { attack: 40, strength: 40, defence: 40, hitpoints: 40 }, extra: [{ name: 'rune_scimitar', n: 1 }], wield: ['rune_scimitar'] });

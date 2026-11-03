// run-fight-arena.ts — launcher for q-fight-arena.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: no quest/skill gates, but three fights (Ogre, Scorpion, Bouncer). Proven at att/str/def/hp 70 + prayer 43
//         (Protect from Melee against Bouncer) + a rune scimitar + 12 sharks. Start next to Lady Servil (2567,3197).
//   SIM:  no prerequisite varps; the stats below + a wielded rune scimitar.
import * as Q from './q-fight-arena.js';
import { launch } from './ar-launch.js';

await launch(Q, {
    prefix: 'arfa',
    stats: { attack: 70, strength: 70, defence: 70, hitpoints: 70, prayer: 43 },
    extra: [{ name: 'rune_scimitar', n: 1 }], wield: ['rune_scimitar'],
});

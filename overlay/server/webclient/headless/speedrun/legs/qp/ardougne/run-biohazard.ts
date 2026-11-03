// run-biohazard.ts — launcher for q-biohazard.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: Plague City complete AND its scroll read (Ardougne Teleport), magic 51. Start outside Elena's door, East
//         Ardougne (2591,3340), with SUPPLY and at least 5 free slots for Elena's vials later.
//   SIM:  sets %elenaquest = 30 (elena_complete_read_scroll, quest_elena.constant:21) and the stats below.
import * as Q from './q-biohazard.js';
import { launch } from './ar-launch.js';

await launch(Q, {
    prefix: 'arbh',
    varps: [['elenaquest', 30]],
    stats: { magic: 51, attack: 40, strength: 40, defence: 40, hitpoints: 40 },
    extra: [{ name: 'rune_scimitar', n: 1 }], wield: ['rune_scimitar'],
});

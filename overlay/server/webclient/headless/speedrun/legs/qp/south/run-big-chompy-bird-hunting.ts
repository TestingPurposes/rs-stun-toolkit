/// <reference types="bun" />
// run-big-chompy-bird-hunting.ts — launcher for q-big-chompy-bird-hunting.ts. See run-big-chompy-bird-hunting.share.md.
//   LIVE (no cheats):  bun headless/speedrun/legs/qp/south/run-big-chompy-bird-hunting.ts --live <account>
//   SIM (local engine): LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/south/run-big-chompy-bird-hunting.ts --sim [name]
//       fresh account: drops the tutorial kit, sets the proof stats (CHOMPY_STATS="cooking=30,..." overrides), hands over
//       SUPPLY, teleports next to Rantz (Feldip Hills). No prerequisite quests.
//       CHOMPY_ARROWS=<n> (sim only) also hands over n helpered ogre arrows: tests the supplied-arrows path.
//   --supply           prints SUPPLY and exits.
import * as Q from './q-big-chompy-bird-hunting.js';
import { launch, statsFromEnv } from './launch-lib.js';

await launch('chompy', Q as any, {
    stats: statsFromEnv({ ranged: 56, cooking: 55, fletching: 30, crafting: 40, strength: 60, attack: 60, hitpoints: 70, defence: 40, prayer: 43 }, process.env.CHOMPY_STATS),
    extra: process.env.CHOMPY_ARROWS ? [{ name: 'ogre_arrow', n: +process.env.CHOMPY_ARROWS }] : [],
});

/// <reference types="bun" />
// run-temple-of-ikov.ts — launcher for q-temple-of-ikov.ts (Temple of Ikov, Armadyl ending). See run-temple-of-ikov.share.md.
//   LIVE (no cheats):  bun headless/speedrun/legs/qp/south/run-temple-of-ikov.ts --live <account>
//   SIM (local engine): LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/south/run-temple-of-ikov.ts --sim [name]
//       fresh account: drops the tutorial kit, sets the proof stats (IKOV_STATS="ranged=99,..." overrides), hands over SUPPLY,
//       teleports next to Lucien (Ardougne). No prerequisite quests. IKOV_ARROWS=<n> = ice arrows to collect before the fight.
//   --supply           prints SUPPLY and exits.
import * as Q from './q-temple-of-ikov.js';
import { launch, statsFromEnv } from './launch-lib.js';

await launch('ikov', Q as any, {
    stats: statsFromEnv({ thieving: 42, ranged: 56, prayer: 43, hitpoints: 70, defence: 40, attack: 60, strength: 60 }, process.env.IKOV_STATS),
});

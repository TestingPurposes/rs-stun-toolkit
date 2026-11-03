/// <reference types="bun" />
// run-the-digsite.ts — launcher for q-the-digsite.ts. See run-the-digsite.share.md.
//   LIVE (no cheats):  bun headless/speedrun/legs/qp/south/run-the-digsite.ts --live <account>
//   SIM (local engine): LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/south/run-the-digsite.ts --sim [name]
//       fresh account: drops the tutorial kit, sets the proof stats (DIG_STATS="..." overrides), hands over SUPPLY and
//       teleports next to the examiner (Exam Centre).
//   --supply           prints SUPPLY and exits.
import * as Q from './q-the-digsite.js';
import { launch, statsFromEnv } from './launch-lib.js';

await launch('dig', Q as any, {
    stats: statsFromEnv({ thieving: 51, agility: 60, herblore: 46, magic: 60, mining: 50, fishing: 74, attack: 83, strength: 83, defence: 60, hitpoints: 80, prayer: 43 }, process.env.DIG_STATS),
});

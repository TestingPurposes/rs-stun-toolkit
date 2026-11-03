/// <reference types="bun" />
// run-the-tourist-trap.ts — launcher for q-the-tourist-trap.ts. See run-the-tourist-trap.share.md.
//   LIVE (no cheats):  bun headless/speedrun/legs/qp/south/run-the-tourist-trap.ts --live <account>
//   SIM (local engine): LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/south/run-the-tourist-trap.ts --sim [name]
//       fresh account: drops the tutorial kit, sets the proof stats (TT_STATS="..." overrides), hands over SUPPLY and
//       teleports next to Irena (north of the Shantay Pass). TT_PICKS="agility,thieving" picks Irena's two rewards.
//   --supply           prints SUPPLY and exits.
import * as Q from './q-the-tourist-trap.js';
import { launch, statsFromEnv } from './launch-lib.js';

await launch('tt', Q as any, {
    stats: statsFromEnv({ smithing: 80, fletching: 70, thieving: 51, agility: 60, attack: 83, strength: 83, defence: 60, hitpoints: 80, prayer: 43 }, process.env.TT_STATS),
});

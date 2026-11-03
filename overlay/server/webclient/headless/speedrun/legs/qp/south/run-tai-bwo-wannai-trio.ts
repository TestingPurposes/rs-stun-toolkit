/// <reference types="bun" />
// run-tai-bwo-wannai-trio.ts — launcher for q-tai-bwo-wannai-trio.ts. See run-tai-bwo-wannai-trio.share.md.
//   LIVE (no cheats):  bun headless/speedrun/legs/qp/south/run-tai-bwo-wannai-trio.ts --live <account>
//   SIM (local engine): LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/south/run-tai-bwo-wannai-trio.ts --sim [name]
//       fresh account: drops the tutorial kit, sets Jungle Potion complete (%junglepotion = 12, general/configs/
//       quest.constant:41: ^junglepotion_complete), the proof stats (TBWT_STATS="..." overrides), hands over SUPPLY and
//       teleports to Timfraku's ladder in Tai Bwo Wannai.
//   --supply           prints SUPPLY and exits.
import * as Q from './q-tai-bwo-wannai-trio.js';
import { launch, statsFromEnv } from './launch-lib.js';

await launch('tbwt', Q as any, {
    varps: ['junglepotion 12'],
    stats: statsFromEnv({ agility: 60, cooking: 55, fishing: 74, magic: 50, hitpoints: 70, defence: 40, attack: 60, strength: 60 }, process.env.TBWT_STATS),
});

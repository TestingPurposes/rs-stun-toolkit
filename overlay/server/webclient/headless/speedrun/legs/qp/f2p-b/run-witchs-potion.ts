// run-witchs-potion.ts — launcher for Witch's Potion (q-witchs-potion.ts). Modes: --live <account> | --sim [name] | --supply
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-witchs-potion.ts --sim fb1
// See fb-launch.ts for what each mode does and run-witchs-potion.share.md for prerequisites and measured ticks.
// FB_SIM_STATS=attack:40,strength:40 (sim only) overrides the default fresh-account stats for A/B runs.
import * as Q from './q-witchs-potion.js';
import { launch, simStats } from './fb-launch.js';

await launch(Q, { stats: simStats({}) }, 'witchs-potion');

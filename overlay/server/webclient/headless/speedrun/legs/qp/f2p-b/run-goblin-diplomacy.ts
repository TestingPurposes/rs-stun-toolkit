// run-goblin-diplomacy.ts — launcher for Goblin Diplomacy (q-goblin-diplomacy.ts). Modes: --live <account> | --sim [name] | --supply
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-goblin-diplomacy.ts --sim fg1
// See fb-launch.ts for what each mode does and run-goblin-diplomacy.share.md for prerequisites and measured ticks.
// FB_SIM_STATS=magic:1 (sim only) overrides the default stats for A/B runs (magic below 37 = walk instead of Falador Teleport).
import * as Q from './q-goblin-diplomacy.js';
import { launch, simStats } from './fb-launch.js';

await launch(Q, { stats: simStats({ magic: 37 }) }, 'goblin-diplomacy');

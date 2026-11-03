// run-pirates-treasure.ts — launcher for Pirate's Treasure (q-pirates-treasure.ts). Modes: --live <account> | --sim [name] | --supply
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-pirates-treasure.ts --sim fbt1
// See fb-launch.ts for what each mode does and run-pirates-treasure.share.md for prerequisites and measured ticks.
import * as Q from './q-pirates-treasure.js';
import { launch, simStats } from './fb-launch.js';

await launch(Q, { stats: simStats({ magic: 37, attack: 30, strength: 30, hitpoints: 20 }) }, 'pirates-treasure');

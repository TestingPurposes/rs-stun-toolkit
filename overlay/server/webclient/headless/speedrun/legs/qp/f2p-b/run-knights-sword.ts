// run-knights-sword.ts — launcher for The Knight's Sword (q-knights-sword.ts). Modes: --live <account> | --sim [name] | --supply
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-knights-sword.ts --sim fbk1
// See fb-launch.ts for what each mode does and run-knights-sword.share.md for prerequisites and measured ticks.
import * as Q from './q-knights-sword.js';
import { launch, simStats } from './fb-launch.js';

await launch(Q, { stats: simStats({ mining: 41, magic: 37 }) }, 'knights-sword');

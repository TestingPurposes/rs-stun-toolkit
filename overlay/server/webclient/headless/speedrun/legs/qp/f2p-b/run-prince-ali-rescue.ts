// run-prince-ali-rescue.ts — launcher for Prince Ali Rescue (q-prince-ali-rescue.ts). Modes: --live <account> | --sim [name] | --supply
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-prince-ali-rescue.ts --sim fbp1
// See fb-launch.ts for what each mode does and run-prince-ali-rescue.share.md for prerequisites and measured ticks.
import * as Q from './q-prince-ali-rescue.js';
import { launch, simStats } from './fb-launch.js';

await launch(Q, { stats: simStats({ attack: 80, strength: 80, hitpoints: 50, defence: 50 }) }, 'prince-ali-rescue');

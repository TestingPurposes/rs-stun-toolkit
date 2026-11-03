// run-black-knights-fortress.ts — launcher for Black Knights' Fortress (q-black-knights-fortress.ts). Modes: --live <account> | --sim [name] | --supply
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-black-knights-fortress.ts --sim fg1
// See fb-launch.ts for what each mode does and run-black-knights-fortress.share.md for prerequisites and measured ticks.
// --sim sets qp 12 (Sir Amik's gate, sir_amik_varze.rs2:15) with `setvar qp 12`. FB_SIM_STATS=skill:lvl,... overrides the stats (A/B).
import * as Q from './q-black-knights-fortress.js';
import { launch, simStats } from './fb-launch.js';

// FG_BKF_TRAVEL=glory|wild (A/B) adds an amulet of glory (sim extra).
await launch(Q, { cheats: ['setvar qp 12'], extra: (process.env.FG_BKF_TRAVEL ?? 'fally') === 'fally' ? [] : [{ name: 'amulet_of_glory_1', n: 1 }], stats: simStats({ attack: 40, strength: 40, defence: 40, hitpoints: 40, magic: 37 }) }, 'black-knights-fortress');

// run-plague-city.ts — launcher for q-plague-city.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: no quest or skill requirements. Start in Edmond's house, East Ardougne (2570,3333) with the SUPPLY items.
//   SIM:  LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-plague-city.ts --sim [name]
import * as Q from './q-plague-city.js';
import { launch } from './ar-launch.js';

await launch(Q, { prefix: 'arpc', stats: {} });

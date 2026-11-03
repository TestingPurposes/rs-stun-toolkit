// run-tribal-totem.ts — launcher for q-tribal-totem.ts (modes: --live <account> | --sim [name] | --supply; see ar-launch.ts).
//   LIVE: thieving 21; magic 51 + Plague City done (Ardougne Teleport) for the fast way to Ardougne, else bring 60 coins.
//         Start next to Kangai Mau in Brimhaven (2790,3184).
//   SIM:  sets %elenaquest = 30 (Plague City + scroll read: Ardougne Teleport) and the stats below.
//         TT_SHIP=1 (A/B): magic 1 and 60 coins, so the leg takes the Brimhaven customs ship to Ardougne.
import * as Q from './q-tribal-totem.js';
import { launch } from './ar-launch.js';

const ship = (globalThis as any).process?.env?.TT_SHIP === '1';
await launch(Q, { prefix: 'artt', varps: [['elenaquest', 30]], stats: { thieving: 21, magic: ship ? 1 : 51 }, extra: ship ? [{ name: 'coins', n: 30 }] : [] });

// run-barcrawl.ts � launcher for Alfred Grimhand's Barcrawl (q-barcrawl.ts). Modes: --live <account> | --sim [name] | --supply.
//   --sim: sets Tree Gnome Village + The Grand Tree (%treequest 9, %grandtree 160: the spirit trees) and, for Ardougne
//          Teleport, Plague City (%elenaquest 30 = ^elena_complete_read_scroll, teleport.rs2:22-37) complete; magic 58;
//          hands over the kit; teleports outside (east of) the Barbarian Outpost gate.
//   Default = the fastest variant (route rb + Ardougne Teleport + glory). A/B (STATUS.md): BARCRAWL_KARAMJA=boat|glory,
//   BARCRAWL_ROUTE=ra|rb, BARCRAWL_FH=walk|ardy.
import { launch } from './launch-lib.js';
import * as Q from './q-barcrawl.js';
const karamja = (process.env.BARCRAWL_KARAMJA ?? 'glory') as 'boat' | 'glory';
const route = (process.env.BARCRAWL_ROUTE ?? 'rb') as 'ra' | 'rb';
const fh = (process.env.BARCRAWL_FH ?? (route === 'rb' ? 'ardy' : 'walk')) as 'walk' | 'ardy';
const kit = [...Q.SUPPLY_BASE, ...(karamja === 'glory' ? Q.SUPPLY_GLORY : []), ...(fh === 'ardy' ? Q.SUPPLY_ARDY : [])];
await launch({ ...Q, SUPPLY: kit, run: (b, o) => Q.run(b, { ...o, karamja, route, fh }) }, {
    prefix: 'trbc',
    varps: [['treequest', 9], ['grandtree', 160], ...(fh === 'ardy' ? [['elenaquest', 30] as [string, number]] : [])],
    stats: { magic: 58 },
});

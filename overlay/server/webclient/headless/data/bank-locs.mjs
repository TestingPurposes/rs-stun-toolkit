// bank-locs.mjs — every bank loc placement, DERIVED from the revision's own map sources.
//
// Replaces server/content/maps/banks2.txt ("<x> <z> <locId>"), a hand-made list that only ever existed in the 274
// working tree (it is not in upstream), so a fresh revision checkout had no bank list and extract-camps /
// extract-weapons / camp-reach-plan crashed. Loc ids are resolved by NAME from loc.pack: banktable, banktable2,
// bankbooth, newbiebankbooth (= the 590/591/2213/3045 set banks2.txt held). All levels, like banks2.txt.
// 289 delta vs banks2.txt: Varrock West's table (3180,3443) is now `grand_exchange_booth` (op1=Exchange only, NOT
// a bank), the L1 banktable2 at (3280,3396) is gone, and a banktable was added at (2620,3894) (Etceteria).
import fs from 'node:fs';
import path from 'node:path';

export const BANK_LOC_NAMES = ['banktable', 'banktable2', 'bankbooth', 'newbiebankbooth'];

/** @returns {{x:number,z:number,level:number,locId:number}[]} sorted by mapsquare file then line order */
export function bankLocsFromMaps(contentDir) {
    const names = new Set(BANK_LOC_NAMES);
    const ids = new Set();
    for (const l of fs.readFileSync(path.join(contentDir, 'pack', 'loc.pack'), 'utf8').split(/\r?\n/)) {
        const m = /^(\d+)=(\S+)/.exec(l);
        if (m && names.has(m[2])) ids.add(+m[1]);
    }
    const maps = path.join(contentDir, 'maps');
    const out = [];
    for (const f of fs.readdirSync(maps).filter(f => /^m\d+_\d+\.jm2$/.test(f)).sort()) {
        const [mx, mz] = f.slice(1, -4).split('_').map(Number);
        let section = '';
        for (const raw of fs.readFileSync(path.join(maps, f), 'utf8').split(/\r?\n/)) {
            if (raw.startsWith('====')) { section = raw.replace(/=/g, '').trim(); continue; }
            if (section !== 'LOC') continue;
            const m = /^(\d+)\s+(\d+)\s+(\d+):\s*(\d+)/.exec(raw);
            if (m && ids.has(+m[4])) out.push({ x: (mx << 6) + +m[2], z: (mz << 6) + +m[3], level: +m[1], locId: +m[4] });
        }
    }
    if (out.length < 50) throw new Error(`bank-locs: only ${out.length} bank locs in ${maps} (ids ${[...ids]}) - map format or loc names changed?`);
    return out;
}

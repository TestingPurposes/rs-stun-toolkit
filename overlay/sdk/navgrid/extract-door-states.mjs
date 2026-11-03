// DOOR-STATE EXTRACTOR — the closed<->open pairing every openable door carries in its config, so a
// live tracker can classify what it sees on the wire. A door loc's `category` is door_closed or
// door_opened, and `param=next_loc_stage,<other variant>` chains to its opposite state. We resolve the
// chain to loc IDS so the runtime (which sees loc IDs in LOC_ADD_CHANGE / on the map) can answer
// "is THIS id an open door or a closed one, and what's its pair".
// Output: sdk/navgrid/door-states.json  { "<locId>": { state:'closed'|'open', pair:<locId|null>, op:<1-based Open/Close slot>, name } }
// Rebuild: node sdk/navgrid/extract-door-states.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../server/content');

// id <-> debugname
const idByName = new Map(); const nameById = new Map();
for (const line of readFileSync(join(ROOT, 'pack/loc.pack'), 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)/);
    if (m) { idByName.set(m[2], Number(m[1])); nameById.set(Number(m[1]), m[2]); }
}

// debugname -> { category, nextStage, ops[] }
const defs = new Map();
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!e.endsWith('.loc')) continue;
        let cur = null;
        for (const line of readFileSync(p, 'utf8').split('\n')) {
            const b = line.match(/^\[(\S+)\]/);
            if (b) { cur = { category: null, next: null, ops: [] }; defs.set(b[1], cur); continue; }
            if (!cur) continue;
            const cm = line.match(/^category=(\S+)/); if (cm) cur.category = cm[1];
            const nm = line.match(/^param=next_loc_stage,(\S+)/); if (nm) cur.next = nm[1];
            const om = line.match(/^op(\d)=(.+)/); if (om) cur.ops[Number(om[1]) - 1] = om[2].trim();
        }
    }
})(join(ROOT, 'scripts'));

// category -> state. Any state-machine openable (door/gate/large-door/...) uses a category ending in
// _closed or _opened plus param=next_loc_stage,<variant>. Classify by the suffix, prefix-agnostic —
// covers door_closed, door_left_closed, gate_outer_closed, gate_inner_opened, etc. (Bespoke area/quest
// gates with no category + a custom handler aren't state-machine locs; they stay on the reactive path.)
const stateOf = (cat) => {
    if (!cat) return null;
    if (/_clos(e|ed)$/.test(cat)) return 'closed';
    if (/_open(ed)?$/.test(cat)) return 'open';
    return null;
};
const out = {};
for (const [name, d] of defs) {
    const state = stateOf(d.category);
    if (!state || d.next === null) continue;   // needs a next_loc_stage pair to be a trackable state door
    const id = idByName.get(name);
    if (id === undefined) continue;
    const opIdx = d.ops.findIndex(o => o && /^(open|close)$/i.test(o));
    out[id] = { state, pair: d.next !== null ? (idByName.get(d.next) ?? null) : null, op: opIdx >= 0 ? opIdx + 1 : 1, name };
}

writeFileSync(new URL('./door-states.json', import.meta.url), JSON.stringify(out, null, 0).replace(/,"/g, ',\n"'));
const ids = Object.keys(out);
console.log(`door-state ids: ${ids.length} (${ids.filter(i => out[i].state === 'closed').length} closed, ${ids.filter(i => out[i].state === 'open').length} open)`);
// spot-check the ones this session fought
for (const [id, lbl] of [[1530, 'inac castle double door'], [1536, 'wizard tower diagonal'], [1516, 'castle interior']]) {
    if (out[id]) console.log(`  ${id} (${lbl}): ${JSON.stringify(out[id])}`);
}

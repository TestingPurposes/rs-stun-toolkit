// content-names.ts — debugname <-> id from the INSTALLED revision's pack files (server/content/pack/*.pack).
//
// Rev 289 renamed ~300 loc debugnames, 26 npc names and 96 interface components, and SWAPPED npc 90/91
// (`skeleton_unagressive` <-> `skeleton_unarmed`); ids are add-only. A test that pins a debugname literal
// (`[oploc1,loc_2298]`, `npc 1070=death_saba`) breaks on every rename although nothing behavioural moved.
// Pin the ID and look the name up here instead.
import { readFileSync } from 'fs';
import { join } from 'path';

const PACK = join(import.meta.dir, '../../../content/pack');
const cache = new Map<string, { byId: Map<number, string>; byName: Map<string, number> }>();

function load(kind: string) {
    let c = cache.get(kind);
    if (c) return c;
    c = { byId: new Map(), byName: new Map() };
    for (const line of readFileSync(join(PACK, `${kind}.pack`), 'utf8').split(/\r?\n/)) {
        const m = /^(\d+)=(\S+)/.exec(line);
        if (m) { c.byId.set(+m[1]!, m[2]!); c.byName.set(m[2]!, +m[1]!); }
    }
    cache.set(kind, c);
    return c;
}

const nameOf = (kind: string, id: number): string => {
    const n = load(kind).byId.get(id);
    if (n === undefined) throw new Error(`${kind}.pack has no id ${id}`);
    return n;
};
export const locName = (id: number): string => nameOf('loc', id);
export const npcName = (id: number): string => nameOf('npc', id);
export const objName = (id: number): string => nameOf('obj', id);
export const locId = (name: string): number | undefined => load('loc').byName.get(name);
export const npcId = (name: string): number | undefined => load('npc').byName.get(name);

// rs-sdk OFFLINE SIM ONLY (rig): door/gate states the way live players leave them.
//   SIM_DOORS=default|closed|open|random:<seed>   at boot, put EVERY door/gate of sdk/navgrid/door-states.json in that state
//                                                 (random: per door, both leaves of a double door together)
//   SIM_DOORS_FLIP=<N ticks>:<fraction>           every N ticks toggle that fraction of the doors exactly like a player op:
//                                                 the change lasts 500 t and then reverts (doors.rs2 ~open_door(500))
//   SIM_DOORS_FLIP_SEED=<n>                       flip RNG seed (default: the SIM_DOORS seed, else 1). Own PRNG: the world
//                                                 RNG (SIM_SEED) is untouched.
// The geometry is the door scripts' own (scripts/doors/scripts/doors.rs2, doubledoors.rs2, door_procs.rs2), per leaf.
// A boot change replaces the static loc with a permanent dynamic one; when a script deletes such a door for N ticks it
// comes back after N ticks, the same as a static door respawns. Doors of other kinds (walk-through open_and_close doors,
// quest gates with their own scripts) are left as they are and counted in the boot line.
import { readFileSync } from 'fs';
import { resolve } from 'path';

import CategoryType from '#/cache/config/CategoryType.js';
import LocType from '#/cache/config/LocType.js';
import { ParamHelper } from '#/cache/config/ParamHelper.js';
import ParamType from '#/cache/config/ParamType.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import Loc from '#/engine/entity/Loc.js';
import { changeLocCollision } from '#/engine/GameMap.js';

const MODE = (process.env.SIM_DOORS ?? 'default').trim();
const FLIP = (process.env.SIM_DOORS_FLIP ?? '').trim();

type Move = 'open' | 'close' | 'negclose' | 'none';
type Kind = { open: boolean; move: Move; rot: number; double: boolean; right: boolean };
const K = (open: boolean, move: Move, rot: number, double = false, right = false): Kind => ({ open, move, rot, double, right });
// per leaf: what one op on it does (new coord = coord + move(angle, shape), new angle = angle + rot)
const BY_CATEGORY: Record<string, Kind> = {
    door_closed: K(false, 'open', 1), door_opened: K(true, 'close', 3),
    reverse_door_closed: K(false, 'none', 3), reverse_door_opened: K(true, 'none', 1),
    door_left_closed: K(false, 'open', 3, true), door_right_closed: K(false, 'open', 1, true, true),
    door_left_opened: K(true, 'negclose', 1, true), door_right_opened: K(true, 'close', 3, true, true),
    reverse_door_left_closed: K(false, 'none', 3, true), reverse_door_right_closed: K(false, 'none', 1, true, true),
    reverse_door_left_opened: K(true, 'none', 1, true), reverse_door_right_opened: K(true, 'none', 3, true, true),
};
const BY_NAME: Record<string, Kind> = { membergatel: BY_CATEGORY.door_left_closed!, membergater: BY_CATEGORY.door_right_closed! };

const WALL_DIAGONAL = 9;
// door_procs.rs2 ~door_open / ~door_close (angle: 0 west, 1 north, 2 east, 3 south)
function doorOpen(angle: number, shape: number): [number, number] {
    if (shape === WALL_DIAGONAL) return ([[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][])[angle]!;
    return ([[-1, 0], [0, 1], [1, 0], [0, -1]] as [number, number][])[angle]!;
}
function doorClose(angle: number, shape: number): [number, number] {
    if (shape === WALL_DIAGONAL) return ([[1, 0], [0, -1], [-1, 0], [0, 1]] as [number, number][])[angle]!;
    return ([[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][])[angle]!;
}

// general_use/scripts/gates.rs2: a gate is a MAIN leaf + (usually) an OUTER leaf within 1 tile; both move relative to
// the main leaf's coord and angle (~open_gate / ~close_gate)
function gateSetClose(angle: number, mod: number): [number, number] { const d = ([[-1, 0], [0, 1], [1, 0], [0, -1]] as [number, number][])[angle]!; return [d[0] * mod, d[1] * mod]; }
function gateSetOpen(angle: number, outer: boolean): [number, number] {
    const d = ([[0, -1], [-1, 0], [0, 1], [1, 0]] as [number, number][])[angle]!;
    if (!outer) return d;
    const o = ([[1, 0], [0, -1], [-1, 0], [0, 1]] as [number, number][])[angle]!;
    return [d[0] + o[0], d[1] + o[1]];
}
function catName(typeId: number): string { const t = LocType.get(typeId); return t && t.category >= 0 ? (CategoryType.get(t.category)?.debugname ?? '') : ''; }
const isGateMain = (id: number) => /^gate_main_(closed|open)$/.test(catName(id));
const isGateOuter = (id: number) => /^gate_outer_(closed|open)$/.test(catName(id));
const gateOpen = (id: number) => /_open$/.test(catName(id));

function kindOf(typeId: number): Kind | null {
    const t = LocType.get(typeId);
    if (!t) return null;
    if (t.debugname && BY_NAME[t.debugname]) return BY_NAME[t.debugname]!;
    if (t.category < 0) return null;
    return BY_CATEGORY[CategoryType.get(t.category)?.debugname ?? ''] ?? null;
}

let NEXT_STAGE = -1;
/** The loc one op on `loc` would put in its place (a new DESPAWN loc, not yet added), or null. */
function toggled(loc: Loc, kind: Kind): Loc | null {
    const nextId = ParamHelper.getIntParam(NEXT_STAGE, LocType.get(loc.type), -1);
    if (nextId < 0) return null;
    let d: [number, number] = [0, 0];
    if (kind.move === 'open') d = doorOpen(loc.angle, loc.shape);
    else if (kind.move === 'close') d = doorClose(loc.angle, loc.shape);
    else if (kind.move === 'negclose') { const c = doorClose(loc.angle, loc.shape); d = [-c[0], -c[1]]; }
    const shape = kind.double ? 0 : loc.shape;   // double doors: loc_add(..., wall_straight, ...)
    const nt = LocType.get(nextId);
    return new Loc(loc.level, loc.x + d[0], loc.z + d[1], nt.width, nt.length, EntityLifeCycle.DESPAWN, nextId, shape, (loc.angle + kind.rot) % 4);
}

/** Group key: both leaves of a double door share the LEFT leaf's coord (doubledoors.rs2 $opposite). */
function groupKey(loc: Loc, kind: Kind): string {
    let x = loc.x, z = loc.z;
    if (kind.double && kind.right) {
        const d = kind.open ? doorOpen(loc.angle, loc.shape) : doorClose(loc.angle, loc.shape);
        x -= d[0]; z -= d[1];
    }
    return `${loc.level},${x},${z}`;
}

function hash01(seed: number, s: string): number {   // FNV-1a + murmur fmix -> [0,1)
    let h = (2166136261 ^ seed) >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Slot = { cur: Loc; gate?: 'main' | 'outer' };
const isOpen = (s: Slot): boolean => s.gate ? gateOpen(s.cur.type) : kindOf(s.cur.type)!.open;
function newLoc(old: Loc, nextId: number, x: number, z: number, angle: number, shape: number): Loc {
    const nt = LocType.get(nextId);
    return new Loc(old.level, x, z, nt.width, nt.length, EntityLifeCycle.DESPAWN, nextId, shape, angle % 4);
}
/** What one player op on this door does: [old leaf, new leaf] for every leaf that changes (none if not possible). */
function toggleGroup(slots: Slot[]): Array<[Slot, Loc]> {
    const out: Array<[Slot, Loc]> = [];
    if (slots[0]!.gate) {
        const main = slots[0]!.cur, open = gateOpen(main.type), C = main, A = main.angle;
        for (const s of slots) {
            const nextId = ParamHelper.getIntParam(NEXT_STAGE, LocType.get(s.cur.type), -1);
            if (nextId < 0) return [];
            const d = open ? gateSetOpen(A, s.gate === 'outer') : gateSetClose(A, s.gate === 'outer' ? 2 : 1);
            out.push([s, newLoc(s.cur, nextId, C.x + d[0], C.z + d[1], A + (open ? 1 : 3), 0)]);
        }
        return out;
    }
    for (const s of slots) { const nl = toggled(s.cur, kindOf(s.cur.type)!); if (nl) out.push([s, nl]); }
    return out;
}
const groups = new Map<string, Slot[]>();
const BOOT = new Set<Loc>();
const respawn: Array<{ loc: Loc; at: number }> = [];
let flipEvery = 0, flipFrac = 0, flipRng: () => number = Math.random;
let enabled = false;

export function simDoorsInit(world: any): void {
    if (MODE === 'default' && !FLIP) return;
    const m = /^(default|closed|open|random(?::(-?\d+))?)$/.exec(MODE);
    if (!m) { console.error(`[simdoors] bad SIM_DOORS=${MODE} (default|closed|open|random:<seed>): ignored`); return; }
    const seed = Number(m[2] ?? process.env.SIM_SEED ?? 1);
    if (FLIP) {
        const f = /^(\d+):(0?\.\d+|1(?:\.0*)?|0)$/.exec(FLIP);
        if (!f) console.error(`[simdoors] bad SIM_DOORS_FLIP=${FLIP} (<ticks>:<fraction>): ignored`);
        else { flipEvery = Number(f[1]); flipFrac = Number(f[2]); flipRng = mulberry(Number(process.env.SIM_DOORS_FLIP_SEED ?? seed) ^ 0x5eed); }
    }
    const file = process.env.SIM_DOORS_FILE ?? resolve(import.meta.dir, '../../../sdk/navgrid/door-states.json');
    let ids: Set<number>;
    try { ids = new Set(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).map(Number)); } catch (e) { console.error(`[simdoors] cannot read ${file}: ${(e as Error).message}`); return; }
    NEXT_STAGE = ParamType.getId('next_loc_stage');

    const skipped = new Map<string, number>();
    const gateMains: Loc[] = [], gateOuters: Loc[] = [];
    let leaves = 0;
    for (const zone of (world.gameMap as any).zonemap.zones.values()) {
        for (const loc of [...zone.getAllLocsUnsafe()] as Loc[]) {
            if (!ids.has(loc.type) || !loc.isActive) continue;
            if (isGateOuter(loc.type)) { gateOuters.push(loc); continue; }
            if (isGateMain(loc.type)) { gateMains.push(loc); continue; }
            const kind = kindOf(loc.type);
            if (!kind || NEXT_STAGE < 0 || ParamHelper.getIntParam(NEXT_STAGE, LocType.get(loc.type), -1) < 0) {
                const n = LocType.get(loc.type)?.debugname ?? String(loc.type); skipped.set(n, (skipped.get(n) ?? 0) + 1); continue;
            }
            const k = groupKey(loc, kind);
            (groups.get(k) ?? groups.set(k, []).get(k)!).push({ cur: loc });
            leaves++;
        }
    }

    // gates: pair each main leaf with the outer leaf (same open state) within 1 tile, as the script's loc_findallzone does
    const usedOuter = new Set<Loc>();
    for (const main of gateMains) {
        const outer = gateOuters.find(o => !usedOuter.has(o) && o.level === main.level && Math.max(Math.abs(o.x - main.x), Math.abs(o.z - main.z)) <= 1 && gateOpen(o.type) === gateOpen(main.type));
        const slots: Slot[] = [{ cur: main, gate: 'main' }];
        if (outer) { usedOuter.add(outer); slots.push({ cur: outer, gate: 'outer' }); }
        groups.set(`${main.level},${main.x},${main.z}`, slots); leaves += slots.length;
    }
    for (const o of gateOuters) if (!usedOuter.has(o)) { const n = `${LocType.get(o.type)?.debugname}(outer without main)`; skipped.set(n, (skipped.get(n) ?? 0) + 1); }

    let changed = 0, nOpen = 0;
    for (const [key, slots] of groups) {
        const want = MODE === 'closed' ? false : MODE === 'open' ? true : MODE.startsWith('random') ? hash01(seed, key) < 0.5 : isOpen(slots[0]!);
        if (want) nOpen++;
        if (isOpen(slots[0]!) === want) continue;
        for (const [s, nl] of toggleGroup(slots)) {
            // the static leaf goes for good (clients get a LOC_DEL on zone entry); the new state is a permanent dynamic loc
            const old = s.cur, t = LocType.get(old.type);
            if (t.blockwalk) changeLocCollision(old.shape, old.angle, t.blockrange, t.length, t.width, t.active, old.x, old.z, old.level, false);
            world.gameMap.getZone(old.x, old.z, old.level).removeLoc(old);
            world.addLoc(nl, -1);
            BOOT.add(nl); s.cur = nl; changed++;
        }
    }

    // a script that deletes a boot door for N ticks (a player's op) gets it back after N ticks, like a static respawn
    const removeLoc = world.removeLoc.bind(world);
    world.removeLoc = (loc: Loc, duration: number): void => {
        const was = loc.isActive;
        removeLoc(loc, duration);
        if (was && BOOT.has(loc) && duration > 0) respawn.push({ loc, at: world.currentTick + duration });
    };
    enabled = true;
    const sk = [...skipped].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}x${c}`).join(' ');
    console.log(`[simdoors] SIM_DOORS=${MODE}${FLIP ? ` FLIP=${flipEvery}:${flipFrac}` : ''}: ${groups.size} doors (${leaves} leaves) from ${ids.size} ids; ${nOpen} open / ${groups.size - nOpen} closed at boot; ${changed} leaves changed; left alone: ${sk || 'none'}`);
}

export function simDoorsTick(world: any): void {
    if (!enabled) return;
    const now: number = world.currentTick;
    for (let i = respawn.length - 1; i >= 0; i--) {
        const r = respawn[i]!;
        if (r.at > now) continue;
        respawn.splice(i, 1);
        if (!r.loc.isActive) world.addLoc(r.loc, -1);
    }
    if (!flipEvery || now === 0 || now % flipEvery !== 0) return;
    let flipped = 0, opened = 0;
    for (const slots of groups.values()) {
        if (flipRng() >= flipFrac) continue;
        if (slots.some(s => !s.cur.isActive)) continue;   // already toggled by someone: leave it
        if (slots.some(s => s.cur.shape === WALL_DIAGONAL)) continue;   // the scripts p_teleport a player off a diagonal door's tile
        const wasOpen = isOpen(slots[0]!);
        const ch = toggleGroup(slots);
        if (!ch.length) continue;
        // a player's op: 500 t, then the engine (static leaf) or the respawn hook (boot leaf) puts the door back. s.cur is
        // NOT moved: the door's resting state stays what boot made it
        for (const [s, nl] of ch) { world.removeLoc(s.cur, 500); world.addLoc(nl, 500); }
        flipped++; if (!wasOpen) opened++;
    }
    console.log(`[simdoors] tick ${now}: flipped ${flipped} doors (${opened} opened, ${flipped - opened} closed) for 500 t`);
}

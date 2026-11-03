// rs-sdk OFFLINE SIM ONLY (rig): the demo's other players. The sim world holds only our own bots; the demo has
// a large player crowd standing in Ardougne and other players mining/chopping the same rocks and trees. Off unless set:
//   SIM_CROWD=<x>,<z>,<radius>,<n>[,<level>][;...]   at the first tick put n fake players on walkable tiles of the square
//                                   x±radius, z±radius (level default 0). Real Player entities (slot, player loop, zone,
//                                   rsbuf player info): every client's player-info build counts them against its 250 cap.
//                                   No socket (plain Player, not NetworkPlayer): lockstep never waits for them, they get no
//                                   packets, they are never saved (World.ts hooks skip them) and never idle-logged-out.
//   SIM_CROWD_WANDER=1              crowd players random-walk within SIM_CROWD_WANDER_R (default 3) tiles of their spawn,
//                                   each idle one starting a walk with chance SIM_CROWD_WANDER_P (default 0.05) per tick
//   SIM_CROWD_RESERVE=<n>           player slots always left free for real logins (default 200)
//   SIM_CROWD_TRADE=<every>[:<p>]   every <every> ticks (1 = 50), each non-crowd player matching SIM_CROWD_TRADE_WHO
//                                   (regex, default ^run) standing within 10 tiles of a crowd player gets, with chance p
//                                   (default 0.25), a trade request from the nearest one: the real [opplayer4,_] script,
//                                   so the target sees '<name>:tradereq:' exactly like player spam
//   SIM_COMPETE=<frac>[:<every>]    every <every> ticks (default 20), each un-depleted mineable rock / fellable tree within
//                                   SIM_COMPETE_R (default 40) tiles of a player matching SIM_COMPETE_NEAR (regex, default
//                                   ^run.*t$ = the trainee) is depleted with chance frac, by the scripts' own call:
//                                   loc_change(next_loc_stage[_mining], ~scale_by_playercount(respawn)) = World.changeLoc
//                                   (skill_mining/scripts/mining.rs2 get_ore_*, skill_woodcutting/scripts/woodcut.rs2 get_logs)
//   SIM_COMPETE_KINDS=rock,tree     which of the two to compete for (default both)
//   SIM_CROWD_NEAR=<radius>         (perf) PROXIMITY-GATED crowd: a SIM_CROWD box is spawned only while a connected player
//                                   matching SIM_CROWD_NEAR_WHO (regex, default ^run = any of our bots) is within <radius>
//                                   tiles (Chebyshev, same level) of the box centre, and removed (no save, no logout script:
//                                   World.removePlayer, the shutdown path) once nobody has been that near for
//                                   SIM_CROWD_NEAR_GRACE (default 50) ticks. A re-spawn draws fresh tiles from the crowd PRNG.
//                                   Unset = the always-on crowd, unchanged.
//   SIM_CROWD_PHANTOM=1             with SIM_CROWD_NEAR: playercount (the PLAYERCOUNT script op, ~scale_by_playercount) and
//                                   World.scaleByPlayerCount still count a despawned box's players, so every respawn timer
//                                   sees the same +crowd as with the always-on crowd. Login gating is not affected.
// Fishing spots are NPCs that move on their own ai_timer (fishing_movement.rs2: npc_tele every 280-530 t) and are never
// used up by fishing, so other fishers cannot take them away: no fishing competition.
// Own PRNG seeded from SIM_SEED (mulberry, like simdrop): the world RNG is untouched. (The crowd DOES raise playercount,
// which shortens every ~scale_by_playercount respawn exactly as the demo's real population does.)
import DbRowType from '#/cache/config/DbRowType.js';
import DbTableType from '#/cache/config/DbTableType.js';
import LocType from '#/cache/config/LocType.js';
import { ParamHelper } from '#/cache/config/ParamHelper.js';
import ParamType from '#/cache/config/ParamType.js';
import { findPath, isMapBlocked, isZoneAllocated } from '#/engine/GameMap.js';
import Loc from '#/engine/entity/Loc.js';
import { isClientConnected } from '#/engine/entity/NetworkPlayer.js';
import Player from '#/engine/entity/Player.js';
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import ServerTriggerType from '#/engine/script/ServerTriggerType.js';
import Packet from '#/io/Packet.js';
import * as rsbuf from '#/network/rsbuf/index.js';
import { PlayerInfoProt } from '#/network/rsbuf/index.js';

const CROWD = (process.env.SIM_CROWD ?? '').trim();
const WANDER = process.env.SIM_CROWD_WANDER === '1';
const WANDER_R = Number(process.env.SIM_CROWD_WANDER_R ?? 3);
const WANDER_P = Number(process.env.SIM_CROWD_WANDER_P ?? 0.05);
const RESERVE = Number(process.env.SIM_CROWD_RESERVE ?? 200);
const TRADE = (process.env.SIM_CROWD_TRADE ?? '').trim();
const TRADE_WHO = new RegExp(process.env.SIM_CROWD_TRADE_WHO ?? '^run', 'i');
const COMPETE = (process.env.SIM_COMPETE ?? '').trim();
const COMPETE_NEAR = new RegExp(process.env.SIM_COMPETE_NEAR ?? '^run.*t$', 'i');
const COMPETE_R = Number(process.env.SIM_COMPETE_R ?? 40);
const COMPETE_KINDS = new Set((process.env.SIM_COMPETE_KINDS ?? 'rock,tree').split(',').map(s => s.trim()));
const SEED = Number(process.env.SIM_SEED ?? 1);
const NEAR_R = Number(process.env.SIM_CROWD_NEAR ?? 0);   // 0/unset = always-on crowd
const NEAR = NEAR_R > 0;
const NEAR_WHO = new RegExp(process.env.SIM_CROWD_NEAR_WHO ?? '^run', 'i');
const NEAR_GRACE = Number(process.env.SIM_CROWD_NEAR_GRACE ?? 50);
const PHANTOM = NEAR && process.env.SIM_CROWD_PHANTOM === '1';

function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const crowdRng = mulberry(SEED ^ 0xc40d);
const tradeRng = mulberry(SEED ^ 0x7ade);
const competeRng = mulberry(SEED ^ 0xc0e7);

/** Marker on the Player object; World.ts hooks test it (cheap, no Set lookup in hot loops). */
export function simCrowdIs(player: Player): boolean {
    return (player as any).simCrowd === true;
}

type Member = { p: Player; hx: number; hz: number; level: number };
const members: Member[] = [];
let inited = false;
let tradeEvery = 0, tradeP = 0;
let competeFrac = 0, competeEvery = 0;

// ---- (A) crowds

// One SIM_CROWD group. live = its spawned players; expected = how many it holds when spawned (n until its first spawn,
// then what that spawn made) = its SIM_CROWD_PHANTOM contribution while despawned.
type Box = { i: number; cx: number; cz: number; r: number; n: number; level: number; base: number; live: Member[]; expected: number; spawned: boolean; lastNear: number; deferLogged: boolean };
const boxes: Box[] = [];
let serial = 0;

function parseBoxes(): void {
    const groups = CROWD.split(';').map(s => s.trim()).filter(Boolean);
    let base = 0;
    for (const g of groups) {
        const v = g.split(',').map(s => Number(s.trim()));
        if (v.length < 4 || v.length > 5 || !v.every(Number.isFinite)) { console.error(`[simcrowd] bad SIM_CROWD group '${g}' (x,z,radius,n[,level]): ignored`); continue; }
        const [cx, cz, r, n] = v as [number, number, number, number];
        boxes.push({ i: boxes.length, cx, cz, r, n, level: v[4] ?? 0, base, live: [], expected: n, spawned: false, lastNear: -1, deferLogged: false });
        base += n;
    }
}

// The always-on path calls this once per box at the first tick, in SIM_CROWD order, with the running serial: the same
// crowdRng draws, names, slots, admission steps and log line as before the NEAR split. NEAR boxes name their players
// base+1..base+n so a re-spawn reuses the same names.
function spawnBox(world: any, b: Box, nextSerial: () => number): number {
    const { cx, cz, r, n, level } = b;
    let made = 0, blocked = 0;
    for (let i = 0; i < n; i++) {
        const slot: number = world.getNextPlayerSlot();
        // keep RESERVE slots for real logins (slots 1..2046)
        let free = 0;
        for (let s = 1; s < 2047 && free <= RESERVE; s++) if (typeof world.players[s] === 'undefined') free++;
        if (slot === -1 || free <= RESERVE) { console.error(`[simcrowd] stopping at ${made}/${n} for ${cx},${cz}: only ${free} free player slots left (SIM_CROWD_RESERVE=${RESERVE})`); break; }

        // a walkable tile of the square (fallback: the centre, even if blocked)
        let x = cx, z = cz, ok = false;
        for (let k = 0; k < 30 && !ok; k++) {
            x = cx + Math.floor(crowdRng() * (2 * r + 1)) - r;
            z = cz + Math.floor(crowdRng() * (2 * r + 1)) - r;
            ok = isZoneAllocated(level, x, z) && !isMapBlocked(x, z, level);
        }
        if (!ok) { x = cx; z = cz; blocked++; }

        const sn = nextSerial();
        const name = `crowd${String(sn).padStart(4, '0')}`;
        // empty save = a fresh account (stats 1, hp 10, default body): PlayerLoading's own new-player path; client
        // null -> a plain Player (no socket). It only READS the save store (checkpoint lookup).
        const p: Player = PlayerLoading.load(name, new Packet(new Uint8Array(0)), null);
        (p as any).simCrowd = true;
        p.x = x; p.z = z; p.level = level;
        p.gender = 0;
        p.body = [0, 10, 18, 26, 33, 36, 42];
        p.colors = [sn % 12, sn % 16, (sn * 3) % 16, (sn * 5) % 6, sn % 8];

        // World.processLogins' admission, minus the socket, ip-cap, friend server and login script (the login
        // trigger is skipped: it would run tutorial logic on a fresh account and write packets nobody reads)
        world.playerLoop.add(2130706433n, p);   // 127.0.0.1, as processLogins does for a socketless player
        world.players[slot] = p;
        rsbuf.addPlayer(slot);
        p.slot = slot;
        p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.slot) >>> 0;
        p.tele = true;
        p.moveClickRequest = false;
        world.gameMap.getZone(p.x, p.z, p.level).enter(p);
        p.buildArea.rebuildNormal();
        p.lastStepX = p.x - 1;
        p.lastStepZ = p.z;
        p.masks |= PlayerInfoProt.APPEARANCE;
        p.isActive = true;

        const m: Member = { p, hx: x, hz: z, level };
        members.push(m);
        b.live.push(m);
        made++;
    }
    b.spawned = true;
    b.expected = made;
    if (!NEAR) console.log(`[simcrowd] spawned ${made} players at ${cx},${cz} r${r} L${level}${blocked ? ` (${blocked} on the blocked centre tile)` : ''}${WANDER ? `, wandering r${WANDER_R} p${WANDER_P}` : ', standing still'}`);
    return made;
}

function spawnCrowds(world: any): void {
    parseBoxes();
    for (const b of boxes) spawnBox(world, b, () => ++serial);
}

// Remove a box's players the way a shutdown does (World.removePlayer: rsbuf, zone, slot, player loop, collision; a crowd
// player is never saved, announced or given a logout script). Observers drop them from their build areas on the next info.
// No randomness: neither the world's JavaRandom/Math.random nor the crowd PRNG is touched.
function despawnBox(world: any, b: Box): number {
    const gone = new Set<Member>(b.live);
    let n = 0;
    for (const m of b.live) if (m.p.slot !== -1) { world.removePlayer(m.p); n++; }
    for (let i = members.length - 1; i >= 0; i--) if (gone.has(members[i]!)) members.splice(i, 1);
    b.live = [];
    b.spawned = false;
    return n;
}

function oursNow(world: any): Player[] {
    const ours: Player[] = [];
    for (const p of world.playerLoop.all() as Iterable<Player>) {
        if (simCrowdIs(p) || !isClientConnected(p) || !NEAR_WHO.test(p.username)) continue;
        ours.push(p);
    }
    return ours;
}

function nearTick(world: any): void {
    const now: number = world.currentTick;
    const ours = oursNow(world);
    for (const b of boxes) {
        let best: Player | null = null, bd = Infinity;
        for (const p of ours) {
            if (p.level !== b.level) continue;
            const d = Math.max(Math.abs(p.x - b.cx), Math.abs(p.z - b.cz));
            if (d < bd) { bd = d; best = p; }
        }
        const near = best !== null && bd <= NEAR_R;
        if (near) b.lastNear = now;
        const who = best ? `${best.username} at ${bd}` : 'nobody';
        if (!b.spawned) {
            if (!near) continue;
            let k = 0;
            const made = spawnBox(world, b, () => b.base + ++k);
            b.deferLogged = false;
            console.log(`[simcrowd] tick ${now}: crowd box ${b.i} spawned ${made} at ${b.cx},${b.cz} r${b.r} L${b.level} (nearest ${who})`);
        } else if (now - b.lastNear >= NEAR_GRACE) {
            // never pull a player out of an open interface (a trade screen with one of our bots): wait for it to close
            if (b.live.some(m => m.p.slot !== -1 && m.p.modalState !== 0)) {
                if (!b.deferLogged) { b.deferLogged = true; console.log(`[simcrowd] tick ${now}: crowd box ${b.i} removal deferred: a member has an interface open`); }
                continue;
            }
            const n = despawnBox(world, b);
            console.log(`[simcrowd] tick ${now}: crowd box ${b.i} removed ${n} (nearest ${who})`);
        }
    }
}

/** SIM_CROWD_PHANTOM: players of despawned boxes, counted as online by playercount / scaleByPlayerCount (0 when off). */
export function simCrowdPhantom(): number {
    if (!PHANTOM) return 0;
    let n = 0;
    for (const b of boxes) if (!b.spawned) n += b.expected;
    return n;
}

function crowdTick(world: any): void {
    const now: number = world.currentTick;
    for (const m of members) {
        const p = m.p;
        if (p.slot === -1) continue;   // removed (shutdown)
        // never time out: processLogouts compares these with currentTick (NetworkPlayer.decodeIn refreshes them for
        // real clients; a plain Player has nobody to do it). World.ts also skips crowd players in processLogouts.
        p.lastConnected = now;
        p.lastResponse = now;
        if (p.target || p.hasWaypoints()) continue;
        const dx = p.x - m.hx, dz = p.z - m.hz;
        const away = Math.max(Math.abs(dx), Math.abs(dz)) > (WANDER ? WANDER_R : 0);
        if (away && (now + p.slot) % 25 === 0) {   // walked off (a trade request): go home
            p.queueWaypoints(findPath(p.level, p.x, p.z, m.hx, m.hz));
            continue;
        }
        if (!WANDER || crowdRng() >= WANDER_P) continue;
        const tx = m.hx + Math.floor(crowdRng() * (2 * WANDER_R + 1)) - WANDER_R;
        const tz = m.hz + Math.floor(crowdRng() * (2 * WANDER_R + 1)) - WANDER_R;
        if (tx === p.x && tz === p.z) continue;
        // perf (CPU profile simCrowdTick -> findPath = 41% of the whole engine): a random wander target is
        // often a wall/building tile, and an unreachable target makes the route finder exhaust its full search grid.
        // Wander like the engine's own npc random walk (Npc.ts randomWalk -> queueWaypoint): one naive waypoint, every
        // step validated by the movement code, stops at walls. Same visible behaviour (a crowd player shuffling in r3).
        p.queueWaypoint(tx, tz);
    }

    if (tradeEvery && now > 0 && now % tradeEvery === 0) {
        let sent = 0;
        for (const target of world.playerLoop.all() as Iterable<Player>) {
            if (simCrowdIs(target) || !TRADE_WHO.test(target.username)) continue;
            let best: Player | null = null, bd = 11;
            for (const m of members) {
                const p = m.p;
                if (p.slot === -1 || p.level !== target.level || p.target) continue;
                const d = Math.max(Math.abs(p.x - target.x), Math.abs(p.z - target.z));
                if (d < bd) { bd = d; best = p; }
            }
            if (!best || tradeRng() >= tradeP) continue;
            // a player's 'Trade with' click: the engine walks the crowd player over and runs [opplayer4,_] (trade.rs2)
            // 1 = Interaction.ENGINE (const enum)
            if (best.setInteraction(1, target, ServerTriggerType.OPPLAYER4)) sent++;
        }
        if (sent) console.log(`[simcrowd] tick ${now}: ${sent} crowd trade request(s) started`);
    }
}

// ---- (B) competitors

type Res = { kind: 'rock' | 'tree'; next: number; respawn: number };
const RES = new Map<number, Res>();
const counts = { checks: 0, rocks: 0, trees: 0, seenRock: 0, seenTree: 0, deplRock: 0, deplTree: 0 };

function column(table: DbTableType, name: string): number {
    return table.columnNames.indexOf(name);
}

function initCompete(): boolean {
    const m = /^(0?\.\d+|1(?:\.0*)?|0)(?::(\d+))?$/.exec(COMPETE);
    if (!m) { console.error(`[simcrowd] bad SIM_COMPETE=${COMPETE} (<frac>[:<everyTicks>]): ignored`); return false; }
    competeFrac = Number(m[1]); competeEvery = Math.max(1, Number(m[2] ?? 20));

    if (COMPETE_KINDS.has('rock')) {
        const tid = DbTableType.getId('mining_table');
        const pid = ParamType.getId('next_loc_stage_mining');
        if (tid < 0 || pid < 0) console.error('[simcrowd] mining_table / next_loc_stage_mining not in the pack: no rock competition');
        else {
            const t = DbTableType.get(tid), cRock = column(t, 'rock'), cResp = column(t, 'rock_respawnrate');
            const dflt = ParamType.get(pid).defaultInt;   // loc_param() falls back to the param default (rocks1)
            for (const row of DbRowType.getInTable(tid)) {
                const respawn = Number(row.getValue(cResp, 0)[0] ?? 0);
                if (!(respawn > 0)) continue;   // rune essence: never depletes
                for (const id of (row.columnValues[cRock] ?? []) as number[]) {
                    const lt = LocType.get(id);
                    if (!lt) continue;
                    const next = ParamHelper.getIntParam(pid, lt, dflt);
                    if (next >= 0) RES.set(id, { kind: 'rock', next, respawn });
                }
            }
        }
    }
    if (COMPETE_KINDS.has('tree')) {
        const tid = DbTableType.getId('woodcutting_trees');
        const pid = ParamType.getId('next_loc_stage');
        if (tid < 0 || pid < 0) console.error('[simcrowd] woodcutting_trees / next_loc_stage not in the pack: no tree competition');
        else {
            const t = DbTableType.get(tid), cTree = column(t, 'tree'), cResp = column(t, 'respawnrate');
            for (const row of DbRowType.getInTable(tid)) {
                const respawn = Number(row.getValue(cResp, 0)[0] ?? 0);   // 0 = normal tree: 120 + random(80)
                for (const id of (row.columnValues[cTree] ?? []) as number[]) {
                    const lt = LocType.get(id);
                    if (!lt) continue;
                    const next = ParamHelper.getIntParam(pid, lt, -1);   // default null: no stump = cannot fall
                    if (next >= 0) RES.set(id, { kind: 'tree', next, respawn });
                }
            }
        }
    }
    const nr = [...RES.values()].filter(r => r.kind === 'rock').length;
    console.log(`[simcrowd] SIM_COMPETE=${competeFrac}:${competeEvery} near /${COMPETE_NEAR.source}/ r${COMPETE_R}: ${nr} rock types, ${RES.size - nr} tree types`);
    return RES.size > 0;
}

function competeTick(world: any): void {
    const now: number = world.currentTick;
    if (now === 0 || now % competeEvery !== 0) return;
    const zones = new Set<any>();
    for (const p of world.playerLoop.all() as Iterable<Player>) {
        if (simCrowdIs(p) || !COMPETE_NEAR.test(p.username)) continue;
        for (let zx = (p.x - COMPETE_R) >> 3; zx <= (p.x + COMPETE_R) >> 3; zx++)
            for (let zz = (p.z - COMPETE_R) >> 3; zz <= (p.z + COMPETE_R) >> 3; zz++)
                zones.add(world.gameMap.getZone(zx << 3, zz << 3, p.level));
    }
    if (!zones.size) return;
    counts.checks++;
    for (const zone of zones) {
        for (const loc of [...zone.getAllLocsUnsafe()] as Loc[]) {
            const r = RES.get(loc.type);
            if (!r) continue;   // depleted rocks/stumps are other loc types: never matched
            if (!loc.isActive || loc.isChanged()) continue;   // already depleted / felled by someone
            if (r.kind === 'rock') counts.seenRock++; else counts.seenTree++;
            if (competeRng() >= competeFrac) continue;
            // the scripts' duration: ~scale_by_playercount(base); a normal tree's base is 120 + random(80)
            const base = r.respawn > 0 ? r.respawn : 120 + Math.floor(competeRng() * 80);
            const dur = world.scaleByPlayerCount(base);
            world.changeLoc(loc, r.next, loc.shape, loc.angle, dur);   // = loc_change(next, dur)
            if (r.kind === 'rock') { counts.rocks++; counts.deplRock++; } else { counts.trees++; counts.deplTree++; }
        }
    }
}

function reportCompete(now: number): void {
    if (now === 0 || now % 500 !== 0 || !counts.checks) return;
    const c = counts;
    console.log(`[simcrowd] tick ${now}: compete ${c.checks} checks/500t: depleted ${c.deplRock} rocks (of ${c.seenRock} standing-rock looks), felled ${c.deplTree} trees (of ${c.seenTree}); total ${c.rocks} rocks, ${c.trees} trees`);
    c.checks = 0; c.seenRock = 0; c.seenTree = 0; c.deplRock = 0; c.deplTree = 0;
}

// ---- hook

let competeOn = false;
export function simCrowdTick(world: any): void {
    if (!inited) {
        inited = true;
        if (CROWD && !NEAR) spawnCrowds(world);
        if (CROWD && NEAR) {
            parseBoxes();
            console.log(`[simcrowd] SIM_CROWD_NEAR=${NEAR_R}: ${boxes.length} box(es), spawned while /${NEAR_WHO.source}/ is within ${NEAR_R} tiles, removed after ${NEAR_GRACE} t without${PHANTOM ? '; SIM_CROWD_PHANTOM: despawned players still count in playercount' : ''}${WANDER ? `; wandering r${WANDER_R} p${WANDER_P}` : ', standing still'}`);
        }
        if (TRADE && (members.length || (NEAR && boxes.length))) {
            const t = /^(\d+)(?::(0?\.\d+|1(?:\.0*)?))?$/.exec(TRADE);
            if (!t) console.error(`[simcrowd] bad SIM_CROWD_TRADE=${TRADE} (<everyTicks>[:<p>]): ignored`);
            else {
                tradeEvery = Number(t[1]) === 1 ? 50 : Number(t[1]); tradeP = Number(t[2] ?? 0.25);
                console.log(`[simcrowd] crowd trade spam: every ${tradeEvery} t, p ${tradeP}, targets /${TRADE_WHO.source}/ within 10 tiles`);
            }
        }
        if (COMPETE) competeOn = initCompete();
    }
    if (NEAR && boxes.length) nearTick(world);
    if (members.length) crowdTick(world);
    if (competeOn) { competeTick(world); reportCompete(world.currentTick); }
}

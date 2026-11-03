// Offline world simulator: a faithful port of the engine's movement + interaction
// semantics (server/engine/src/engine/entity/PathingEntity.ts, Player.ts, Npc.ts,
// MoveClickHandler.ts) over pluggable collision. Every rule cited inline.
//
// Collision backends:
//   openField()             — everything walkable (fast unit tests, no WASM)
//   rsmodCanTravel()        — real collision via sdk/pathfinding's WASM (call
//                             initPathfinding() + applyBlockedEdges first)
// Both are wrapped by SimWorld to add door edges and the StepValidator (0,0) guard.
import type { ClientAction } from './protocol.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The sim drives REAL brains, and LeanBot snapshots bank state to logs/vault/<account>.json
// on bank-open (leanbot.ts VAULT_DIR fallback). Sim balances are FICTION on fixture-named
// accounts — several of which may collide with real account names — and every suite run would
// overwrite the real vault snapshots with them. Quarantine all sim-run vault writes to a temp dir.
if (!process.env.VAULT_DIR) process.env.VAULT_DIR = mkdtempSync(join(tmpdir(), 'sim-vault-'));

export type CanTravelFn = (level: number, x: number, z: number, dx: number, dz: number) => boolean;

export function openField(): CanTravelFn { return () => true; }

export function rsmodCanTravel(): CanTravelFn {
    // deferred import so openField tests never pay the 23MB WASM load
    const rsmod = require('../../../vendor/rsmod-pathfinder');
    return (level, x, z, dx, dz) => rsmod.canTravel(level, x, z, dx, dz, 1, 0, 0 /* CollisionType.NORMAL */);
}

// deterministic RNG (Npc wander uses Math.random on the live server)
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface SimEvent { tick: number; kind: string; detail: Record<string, unknown>; }

// PathingEntity port: waypoints Int32Array-style ring, takeStep diag->E/W->N/S,
// blocked = [0,0] with the waypoint index NOT advanced (the permanent-wedge rule).
export class SimEntity {
    x: number; z: number; level = 0;
    wp: Array<{ x: number; z: number }> = [];
    wpIndex = -1;
    stepsTaken = 0;
    // per-tick observations for the info-packet encoder (processCleanup analog)
    steps: Array<[number, number]> = [];
    teleported = false;

    constructor(x: number, z: number, public world: SimWorld) { this.x = x; this.z = z; }

    resetTransient() { this.steps = []; this.teleported = false; }

    // PathingEntity.queueWaypoints:265-273 — reversed copy, cap 25, consumed downward
    queueWaypoints(path: Array<{ x: number; z: number }>) {
        this.wp = [];
        let index = -1;
        for (let input = path.length - 1, output = 0; input >= 0 && output < 25; input--, output++) {
            this.wp[output] = path[input]!;
            index++;
        }
        this.wpIndex = index;
    }
    queueWaypoint(x: number, z: number) { this.wp = [{ x, z }]; this.wpIndex = 0; }
    clearWaypoints() { this.wpIndex = -1; }
    hasWaypoints() { return this.wpIndex !== -1; }

    // PathingEntity.takeStep:629-675 (width-1 entity): diagonal -> E/W -> N/S -> [0,0]
    private takeStep(): [number, number] {
        if (this.wpIndex === -1) return [0, 0];
        const t = this.wp[this.wpIndex]!;
        if (t.x === this.x && t.z === this.z) return [0, 0]; // CoordGrid.face -1
        const dx = Math.sign(t.x - this.x), dz = Math.sign(t.z - this.z);
        const can = (ox: number, oz: number) => this.world.canStep(this.level, this.x, this.z, ox, oz);
        if (can(dx, dz)) return [dx, dz];
        if (dx !== 0 && can(dx, 0)) return [dx, 0];
        if (dz !== 0 && can(0, dz)) return [0, dz];
        return [0, 0];
    }

    // PathingEntity.validateAndAdvanceStep:202-248
    private validateAndAdvanceStep(): boolean {
        if (this.wpIndex === -1) return false;
        const [dx, dz] = this.takeStep();
        const sx = this.x, sz = this.z;
        this.x += dx; this.z += dz;
        if (this.wpIndex !== -1) {
            const c = this.wp[this.wpIndex]!;
            if (c.x === this.x && c.z === this.z) this.wpIndex--;
        }
        if (this.x !== sx || this.z !== sz) { this.stepsTaken++; this.steps.push([this.x - sx, this.z - sz]); return true; }
        return false;
    }

    // PathingEntity.processMovement:137-154 — walk 1 step; run = 2nd step only if 1st moved
    processMovement(run: boolean) {
        if (this.wpIndex === -1) return;
        const moved = this.validateAndAdvanceStep();
        if (run && moved) this.validateAndAdvanceStep();
    }

    teleport(x: number, z: number) { this.x = x; this.z = z; this.clearWaypoints(); this.teleported = true; }
}

export type NpcBehavior =
    | { mode: 'still' }
    | { mode: 'wander'; range: number }                       // Npc.wanderMode:704-723
    | { mode: 'patrol'; points: Array<{ x: number; z: number }>; delay?: number }; // Npc.patrolMode:725-765

export class SimNpc extends SimEntity {
    startX: number; startZ: number;
    stuckCounter = 0;
    nextPatrolPoint = 0;
    patrolWait = 0;
    constructor(
        public index: number,
        public typeId: number,
        x: number, z: number,
        public behavior: NpcBehavior,
        world: SimWorld
    ) { super(x, z, world); this.startX = x; this.startZ = z; }
}

type PendingOp =
    | { kind: 'npc'; index: number; op: number }
    | { kind: 'loc'; x: number; z: number; locId: number; op: number };

export interface SimDoor { x: number; z: number; locId: number; edges: Array<[number, number, number, number]>; open: boolean; }

export class SimWorld {
    tick = 0;
    player: SimEntity;
    playerRun = true; // engine default: run when energy allows; brains send ctrl=1
    npcs = new Map<number, SimNpc>();
    pendingOp: PendingOp | null = null;
    /** PathingEntity.allowRepath, as a boolean: BEFOREDEST (default, true) vs NONE (false). Only a MOVE to
     *  the player's OWN tile sets NONE (MoveClickHandler.ts:41-43); any real MOVE restores it. */
    allowRepath = true;
    events: SimEvent[] = [];
    doors: SimDoor[] = [];
    private doorEdges = new Set<string>();
    rng: () => number;

    constructor(startX: number, startZ: number, private baseCanTravel: CanTravelFn, seed = 42) {
        this.player = new SimEntity(startX, startZ, this);
        this.rng = mulberry32(seed);
    }

    // ENGINE-FAITHFUL NPC BLOCKING (opt-in): an npc's tile refuses entry (the nasty-tree class — an
    // npc parked on a corridor tile blocks it FOREVER; rsmod can't know npcs, so routes thread it and
    // the walker must slide/re-route around). Off by default: the legacy suites assume ghost npcs.
    npcsBlock = false;

    // CROWD VIEWDISTANCE COLLAPSE (opt-in). Above BuildArea.PREFERRED_PLAYERS (250) the server's
    // per-player viewDistance decrements toward a floor of 1 (build.ts), and OpNpcHandler DISCARDS a
    // pickpocket op whose npc is outside the collapsed view (`if (!rsbuf.hasNpc(...)) return false`) —
    // the pendingOp is NEVER set, so the engine never follows. An OPNPC to a target farther than this
    // (Chebyshev) is dropped at ingestion. Infinity (default) = the op is always accepted, i.e. every
    // existing scenario is unchanged; the penned-knight scenario sets it to 1 to model the carpet.
    opNpcViewLimit = Infinity;

    // StepValidator.canTravel returns false for offset (0,0) (StepValidator.ts:30);
    // door edges overlay the base collision in BOTH directions.
    canStep(level: number, x: number, z: number, dx: number, dz: number): boolean {
        if (dx === 0 && dz === 0) return false;
        if (this.doorEdges.has(`${x},${z},${dx},${dz}`)) return false;
        if (this.npcsBlock) {
            const tx = x + dx, tz = z + dz;
            for (const n of this.npcs.values()) if (n.x === tx && n.z === tz) return false;
        }
        return this.baseCanTravel(level, x, z, dx, dz);
    }

    addNpc(index: number, typeId: number, x: number, z: number, behavior: NpcBehavior = { mode: 'still' }): SimNpc {
        const npc = new SimNpc(index, typeId, x, z, behavior, this);
        this.npcs.set(index, npc);
        return npc;
    }

    // A closed door blocks the given directed edges (and their reverses).
    addDoor(x: number, z: number, locId: number, edges: Array<[number, number, number, number]>): SimDoor {
        const door: SimDoor = { x, z, locId, edges, open: false };
        this.doors.push(door);
        for (const [ex, ez, dx, dz] of edges) {
            this.doorEdges.add(`${ex},${ez},${dx},${dz}`);
            this.doorEdges.add(`${ex + dx},${ez + dz},${-dx},${-dz}`);
        }
        return door;
    }
    private openDoor(door: SimDoor) {
        door.open = true;
        for (const [ex, ez, dx, dz] of door.edges) {
            this.doorEdges.delete(`${ex},${ez},${dx},${dz}`);
            this.doorEdges.delete(`${ex + dx},${ez + dz},${-dx},${-dz}`);
        }
    }

    private emit(kind: string, detail: Record<string, unknown> = {}) { this.events.push({ tick: this.tick, kind, detail }); }

    get playerSteps(): Array<[number, number]> { return this.player.steps; }

    // ---- one server tick (World.cycle order: client input -> npcs -> player) ----
    tickOnce(clientActions: ClientAction[]): SimEvent[] {
        this.tick++;
        const before = this.events.length;
        this.player.resetTransient();
        for (const npc of this.npcs.values()) npc.resetTransient();

        // (1) processClientsIn — packet handlers mutate state before anything moves
        for (const a of clientActions) this.applyClientAction(a);

        // (2) processNpcs — ALL npcs move before the player (World.ts:665 before :687)
        for (const npc of this.npcs.values()) this.npcTurn(npc);

        // (3) processPlayers -> processInteraction (Player.ts:1251-1318)
        this.playerInteractionAndMovement();

        return this.events.slice(before);
    }

    private applyClientAction(a: ClientAction) {
        switch (a.type) {
            case 'move': {
                // MoveClickHandler:28 clearPendingAction (cancels a pending OPLOC/OPNPC —
                // THE gate bug), then queues the client's waypoints VERBATIM incl. path[0].
                if (this.pendingOp) this.emit('op-cancelled-by-move', { op: this.pendingOp });
                this.pendingOp = null;
                // ⛔ ALLOW-REPATH, PORTED (MoveClickHandler.ts:41-43). A MOVE whose single waypoint IS the
                // player's own tile — "clicking on their current tile" — queues an EMPTY path and sets
                // `AllowRepath.NONE`. That is the ONLY place the engine sets it, and once set,
                // `Player.ts:1082`'s `allowRepath === BEFOREDEST` guard fails, so `naivePathToTarget()` never
                // runs again and the engine STOPS closing on an op target. Any later MOVE with a real path
                // calls queueWaypoints and restores BEFOREDEST (PathingEntity.ts:57 is the default).
                if (a.path.length === 1 && a.path[0]!.x === this.player.x && a.path[0]!.z === this.player.z) {
                    this.player.queueWaypoints([]);
                    this.allowRepath = false;
                    this.emit('allow-repath-none', { at: { x: this.player.x, z: this.player.z } });
                    break;
                }
                this.allowRepath = true;
                this.player.queueWaypoints(a.path);
                this.emit('move-queued', { path: a.path });
                // naive-router invariant check: every hop must be a legal 1-step move
                for (let i = 1; i < a.path.length; i++) {
                    const p = a.path[i - 1]!, q = a.path[i]!;
                    if (Math.max(Math.abs(q.x - p.x), Math.abs(q.z - p.z)) > 1) {
                        this.emit('illegal-waypoint-gap', { from: p, to: q, hop: i });
                    }
                }
                break;
            }
            case 'opnpc': {
                // viewDistance-collapse discard: a non-adjacent op under a collapsed view is dropped
                // at the handler (no pendingOp, no follow). Default limit Infinity => never drops.
                if (Number.isFinite(this.opNpcViewLimit)) {
                    const n = this.npcs.get(a.index);
                    const d = n ? Math.max(Math.abs(n.x - this.player.x), Math.abs(n.z - this.player.z)) : Infinity;
                    if (d > this.opNpcViewLimit) { this.emit('opnpc-discarded', { index: a.index, dist: d }); break; }
                }
                this.pendingOp = { kind: 'npc', index: a.index, op: a.op };
                this.emit('opnpc-requested', { index: a.index, op: a.op });
                break;
            }
            case 'oploc':
                this.pendingOp = { kind: 'loc', x: a.x, z: a.z, locId: a.locId, op: a.op };
                this.emit('oploc-requested', { x: a.x, z: a.z, locId: a.locId, op: a.op });
                break;
            default:
                this.emit(`client-${a.type}`, { ...a });
        }
    }

    protected npcTurn(npc: SimNpc) {
        const b = npc.behavior;
        if (b.mode === 'wander') {
            // Npc.wanderMode:704-723 — 1/8 chance per tick to re-roll a destination
            // uniformly in the (2r+1)^2 square around SPAWN (even while moving)
            if (this.rng() < 0.125) {
                const dx = Math.round(this.rng() * (b.range * 2) - b.range);
                const dz = Math.round(this.rng() * (b.range * 2) - b.range);
                const destX = npc.startX + dx, destZ = npc.startZ + dz;
                if (destX !== npc.x || destZ !== npc.z) npc.queueWaypoint(destX, destZ);
            }
            npc.processMovement(false); // NPCs always WALK (Npc.ts:404-406)
            if (npc.stuckCounter++ > 500) { // 501-tick teleport-home (Npc.ts:731-734)
                if (npc.x !== npc.startX || npc.z !== npc.startZ) npc.teleport(npc.startX, npc.startZ);
                npc.stuckCounter = 0;
            }
        } else if (b.mode === 'patrol') {
            // Npc.patrolMode:725-765 — waypoint list, 32-tick stuck teleport
            const pt = b.points[npc.nextPatrolPoint]!;
            if (npc.x === pt.x && npc.z === pt.z) {
                if (npc.patrolWait++ >= (b.delay ?? 0)) {
                    npc.nextPatrolPoint = (npc.nextPatrolPoint + 1) % b.points.length;
                    npc.patrolWait = 0;
                }
            } else {
                if (!npc.hasWaypoints()) npc.queueWaypoint(pt.x, pt.z);
                npc.processMovement(false);
                if (npc.stuckCounter++ > 32) { npc.teleport(pt.x, pt.z); npc.stuckCounter = 0; }
            }
        }
    }

    // Player.processInteraction:1251-1318, simplified to the semantics the brains
    // exercise: pre-move op for NPC targets, engine re-path toward npc targets,
    // post-move op for LOC targets only on a zero-step tick, "I can't reach that!".
    private playerInteractionAndMovement() {
        const p = this.player;
        let interacted = false;

        // pre-movement tryInteract(false): Loc/Obj ops disallowed here (Player.ts:1273)
        if (this.pendingOp?.kind === 'npc') {
            const npc = this.npcs.get(this.pendingOp.index);
            if (!npc) { this.pendingOp = null; }
            else if (this.inOperableDistance(npc)) {
                this.emit('op-fired', { kind: 'npc', op: this.pendingOp.op, index: npc.index, typeId: npc.typeId });
                p.clearWaypoints();
                this.pendingOp = null;
                interacted = true;
            } else {
                // pathToPathingTarget/naivePathToTarget (Player.ts:1073-1106): the ENGINE
                // re-paths toward a pathing-entity target — the brains rely on this
                // (send OPNPC3 with no MOVE inside followRange). findNaivePath targets the
                // PERIMETER tile (naiveDestination), never the target's own tile, so the
                // player ends up adjacent and the op can fire.
                // ⛔ GATED ON allowRepath (Player.ts:1082). With NONE the engine does NOT close on the
                // target — the player just stands there while a brain счита the tick as `approach`.
                if (!this.allowRepath) {
                    this.emit('repath-denied', { npc: npc.index });
                } else {
                    const dest = this.naiveDestination(npc);
                    p.queueWaypoint(dest.x, dest.z);
                }
            }
        }

        const stepsBefore = p.stepsTaken;
        const idxBefore = p.wpIndex;
        p.processMovement(this.playerRun);
        const stepped = p.stepsTaken - stepsBefore;

        // post-movement tryInteract(stepsTaken === 0) (Player.ts:1294). The
        // allowOpScenery flag it passes gates LOC/OBJ ops only — a PathingEntity
        // target's op fires here regardless of how many steps we just took, which is
        // what lets the engine close on a moving npc and steal in the SAME tick.
        if (!interacted && this.pendingOp?.kind === 'npc') {
            const npc = this.npcs.get(this.pendingOp.index);
            if (npc && this.inOperableDistance(npc)) {
                this.emit('op-fired', { kind: 'npc', op: this.pendingOp.op, index: npc.index, typeId: npc.typeId });
                p.clearWaypoints();
                this.pendingOp = null;
                interacted = true;
            }
        }

        // loc ops fire only on a zero-step tick
        if (!interacted && this.pendingOp?.kind === 'loc' && stepped === 0) {
            const { x, z, locId, op } = this.pendingOp;
            if (Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= 1) {
                this.emit('op-fired', { kind: 'loc', op, x, z, locId });
                const door = this.doors.find(d => d.x === x && d.z === z && !d.open);
                if (door) { this.openDoor(door); this.emit('door-opened', { x, z, locId }); }
                p.clearWaypoints();
                this.pendingOp = null;
                interacted = true;
            }
        }

        // "I can't reach that!" (Player.ts:1296-1300)
        if (!interacted && this.pendingOp && !p.hasWaypoints() && stepped === 0) {
            this.emit('cant-reach', { op: this.pendingOp });
            this.pendingOp = null;
        }

        // Wedge = NO progress at all: no step AND no waypoint consumed. A zero-step tick
        // that consumed a waypoint is normal — it is the engine eating the self-start
        // waypoint (path[0] is the player's own tile in every MOVE packet).
        if (p.hasWaypoints() && stepped === 0 && p.wpIndex === idxBefore && this.pendingOp === null) {
            const t = p.wp[p.wpIndex]!;
            if (t.x !== p.x || t.z !== p.z) this.emit('wedged', { at: { x: p.x, z: p.z }, toward: t });
        }
    }

    // NaivePathFinder.naiveDestination: the cardinal perimeter tile of the target
    // closest to us (1x1 entities). Never the target's own tile.
    private naiveDestination(npc: SimNpc): { x: number; z: number } {
        const p = this.player;
        const cands = [{ x: npc.x - 1, z: npc.z }, { x: npc.x + 1, z: npc.z }, { x: npc.x, z: npc.z - 1 }, { x: npc.x, z: npc.z + 1 }];
        cands.sort((a, b) =>
            (Math.max(Math.abs(a.x - p.x), Math.abs(a.z - p.z))) - (Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z))));
        return cands[0]!;
    }

    private inOperableDistance(npc: SimNpc): boolean {
        // reachedEntity shape -2 RECTANGLE_EXCLUSIVE (ReachStrategy.ts:48-57): for 1x1
        // entities, CARDINALLY adjacent (never under, never diagonal), no wall between.
        const dx = npc.x - this.player.x, dz = npc.z - this.player.z;
        if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
        return this.canStep(this.player.level, this.player.x, this.player.z, dx, dz);
    }
}

// Route oracle: walk a FULL route the way the brains actually send it — in chunks
// of <=24 waypoints, resending the next chunk once the current one is consumed.
// A single MOVE packet cannot carry more than 25 waypoints (MoveClickDecoder caps
// the read at 25 and PathingEntity.waypoints is Int32Array(25), keeping only the
// LAST 25 of a longer list) — feeding a 50-tile route in one packet makes the
// player naively beeline at a far tile, which is a client bug, not a route bug.
export function simulateRoute(
    canTravel: CanTravelFn,
    route: Array<{ x: number; z: number }>,
    opts: { run?: boolean; chunk?: number; maxTicks?: number } = {}
): { arrived: boolean; wedgedAt?: { x: number; z: number }; ticks: number; end: { x: number; z: number } } {
    const chunk = opts.chunk ?? 24;
    const run = opts.run ?? true;
    const maxTicks = opts.maxTicks ?? 5000;
    const world = new SimWorld(route[0]!.x, route[0]!.z, canTravel);
    const dest = route[route.length - 1]!;
    let cursor = 1; // route[0] is our own tile
    let ticks = 0;

    while (ticks < maxTicks) {
        if (!world.player.hasWaypoints()) {
            if (cursor >= route.length) break;
            // client resend: own tile + the next chunk of the route (the sendMulti shape)
            const next = route.slice(cursor, cursor + chunk);
            world.player.queueWaypoints([{ x: world.player.x, z: world.player.z }, ...next]);
            cursor += next.length;
        }
        ticks++;
        const steps = world.player.stepsTaken;
        const idx = world.player.wpIndex;
        world.player.processMovement(run);
        if (world.player.stepsTaken === steps && world.player.wpIndex === idx) {
            return { arrived: false, wedgedAt: { x: world.player.x, z: world.player.z }, ticks, end: { x: world.player.x, z: world.player.z } };
        }
    }
    const end = { x: world.player.x, z: world.player.z };
    return { arrived: end.x === dest.x && end.z === dest.z, ticks, end };
}

// Single-packet oracle: run one candidate MOVE path through the server's exact
// stepping rules and report arrival or the wedge tile. This is what caught the
// toVias corner-cutting bug offline with zero live runs.
export function simulateWaypoints(
    canTravel: CanTravelFn,
    start: { x: number; z: number },
    path: Array<{ x: number; z: number }>,
    opts: { run?: boolean; maxTicks?: number } = {}
): { arrived: boolean; wedgedAt?: { x: number; z: number }; ticks: number; end: { x: number; z: number } } {
    const world = new SimWorld(start.x, start.z, canTravel);
    world.player.queueWaypoints(path);
    const run = opts.run ?? true;
    const maxTicks = opts.maxTicks ?? 1000;
    for (let t = 1; t <= maxTicks; t++) {
        const steps = world.player.stepsTaken;
        const idx = world.player.wpIndex;
        world.player.processMovement(run);
        if (!world.player.hasWaypoints()) return { arrived: true, ticks: t, end: { x: world.player.x, z: world.player.z } };
        // A wedge is NO progress at all: no step AND no waypoint consumed. A tick that
        // consumes a waypoint without stepping is normal — it is how the engine eats the
        // self-start waypoint (path[0] is the player's own tile in every MOVE packet).
        if (world.player.stepsTaken === steps && world.player.wpIndex === idx) {
            return { arrived: false, wedgedAt: { x: world.player.x, z: world.player.z }, ticks: t, end: { x: world.player.x, z: world.player.z } };
        }
    }
    return { arrived: false, ticks: maxTicks, end: { x: world.player.x, z: world.player.z } };
}

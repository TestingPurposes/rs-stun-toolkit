// SimHarness: wires a REAL LeanBot (unmodified, via its actual run()
// decode loop) to the SimWorld through a mock ClientStream. The login handshake
// is bypassed the sound way (leanclient recon): set stream/inIsaac/outIsaac
// directly — ISAAC seeds are plain Int32Array(4)s, and run() re-derives nothing
// from login.
//
// Per tick:  world.tickOnce(prevActions) -> encode PLAYER_INFO (+NPC_INFO,
// queued stats/invs/messages) -> push -> brain runs inside the real run() loop
// -> its flush() bytes are parsed back into structured actions for assertions.
import Isaac from '#/io/Isaac.js';
import { ServerPacketStream, ClientActionParser, dirCode, type ClientAction, type NpcTickUpdate, type NpcHitsplat } from './protocol.ts';
import { SimWorld, type SimEvent } from './world.ts';
import { STYLE_BUTTON_LOOKUP, VARP } from '../capability-tables.js';

const IN_SEED = [11, 22, 33, 44];   // server->client cipher (client inIsaac)
const OUT_SEED = [55, 66, 77, 88];  // client->server cipher (client outIsaac)

class MockStream {
    private q: number[] = [];
    private wake: (() => void) | null = null;
    private idleWaiters: Array<() => void> = [];
    private parked = false;
    private written: number[] = [];

    push(bytes: Uint8Array) {
        for (const b of bytes) this.q.push(b);
        const w = this.wake; this.wake = null; w?.();
    }
    async read(): Promise<number> {
        while (this.q.length === 0) {
            this.parked = true;
            for (const w of this.idleWaiters.splice(0)) w();
            await new Promise<void>(r => { this.wake = r; });
            this.parked = false;
        }
        return this.q.shift()!;
    }
    async readBytes(dst: Uint8Array, off: number, len: number): Promise<void> {
        for (let i = 0; i < len; i++) dst[off + i] = await this.read();
    }
    write(data: Uint8Array, len: number): void {
        for (let i = 0; i < len; i++) this.written.push(data[i]!);
    }
    // Resolves once the bot has consumed every pushed byte and is parked awaiting
    // more. A desynced ISAAC stream leaves the decoder waiting on a phantom payload
    // and this never resolves — so time it out LOUDLY rather than hanging the suite.
    waitIdle(timeoutMs = 5000): Promise<void> {
        if (this.parked && this.q.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(
                `sim: bot never finished decoding (${this.q.length} bytes unread). ` +
                `Almost always an ISAAC desync: packets must be ENCODED in the same order their bytes are PUSHED.`
            )), timeoutMs);
            this.idleWaiters.push(() => { clearTimeout(timer); resolve(); });
        });
    }
    takeWritten(): Uint8Array { const out = Uint8Array.from(this.written); this.written = []; return out; }
}

export interface TickResult {
    tick: number;
    actions: ClientAction[];   // what the brain sent THIS tick (parsed, in order)
    events: SimEvent[];        // what the world did applying LAST tick's actions
    player: { x: number; z: number };
}

// Structural interface of the bots we drive (LeanBot and subclasses).
interface DrivableBot {
    stream: unknown; inIsaac: unknown; outIsaac: unknown;
    loginUser: string; quiet: boolean;
    mapBuildBaseX: number; mapBuildBaseZ: number;
    localPlayer: { routeX: Int32Array; routeZ: Int32Array };
    tickCount: number;
    run(maxTicks: number): Promise<unknown>;
}

export class SimHarness {
    readonly world: SimWorld;
    private stream = new MockStream();
    private enc = new ServerPacketStream(IN_SEED);
    private parser = new ClientActionParser(OUT_SEED);
    private pre: Array<() => Uint8Array> = [];   // script-driven: before PLAYER_INFO
    private post: Array<() => Uint8Array> = [];  // processClientsOut: after NPC_INFO
    private pendingActions: ClientAction[] = [];
    private tracked: number[] = [];        // mirrors the client's npcIndices order
    private prevPlayer: { x: number; z: number };
    private runPromise: Promise<unknown> | null = null;
    private ticks = 0;

    constructor(private bot: DrivableBot, world: SimWorld) {
        this.world = world;
        this.prevPlayer = { x: world.player.x, z: world.player.z };
        bot.stream = this.stream;
        bot.inIsaac = new Isaac(new Int32Array(IN_SEED));
        bot.outIsaac = new Isaac(new Int32Array(OUT_SEED));
        bot.loginUser = 'simbot';
        bot.quiet = true;
    }

    // Boot the scene: REBUILD + teleport PLAYER_INFO, then start the real run()
    // loop. The first brain tick runs before npcs/stats decode (matches the live
    // packet order); its output is discarded here.
    async start(opts: { stats?: Array<{ stat: number; xp: number; level: number }>; inv?: Array<{ id: number; count: number }> } = {}): Promise<void> {
        const { x, z } = this.world.player;
        const zoneX = x >> 3, zoneZ = z >> 3;
        const batch: Uint8Array[] = [this.enc.rebuildNormal(zoneX, zoneZ)];
        const baseX = (zoneX - 6) * 8, baseZ = (zoneZ - 6) * 8;
        batch.push(this.enc.playerInfo({ kind: 'teleport', level: 0, localX: x - baseX, localZ: z - baseZ, jump: true }));
        for (const s of opts.stats ?? []) batch.push(this.enc.updateStat(s.stat, s.xp, s.level));
        if (opts.inv) batch.push(this.enc.updateInvFull(3214, opts.inv));

        this.runPromise = this.bot.run(Number.MAX_SAFE_INTEGER).catch(e => console.error('[sim] run() died:', e));
        for (const p of batch) this.stream.push(p);
        await this.stream.waitIdle();
        // discard the pre-world first flush; world starts clean at tick 1
        this.parser.parse(this.stream.takeWritten());
    }

    // Test inputs for the NEXT tick's batch. These queue BUILDERS, not bytes: the
    // outgoing ISAAC advances one value per packet, so a packet must be encoded in
    // the same order its bytes are pushed. Encoding at queue-time (before this
    // tick's PLAYER_INFO/NPC_INFO are built) desyncs the client's cipher and the
    // decode loop silently stalls forever.
    //
    // PRE vs POST matters and mirrors World.cycle: script-driven packets (messages,
    // modals) are written to the outbound buffer during processPlayers — i.e. BEFORE
    // PLAYER_INFO — so the brain (which ticks on PLAYER_INFO) sees them the SAME tick.
    // Inv/stat updates are appended in processClientsOut AFTER npc info, so the brain
    // only sees those on the FOLLOWING tick.
    queueMessage(text: string) { this.pre.push(() => this.enc.messageGame(text)); }
    queueOpenMain(com: number) { this.pre.push(() => this.enc.ifOpenMain(com)); }
    queueOpenChat(com: number) { this.pre.push(() => this.enc.ifOpenChat(com)); }
    queueSetText(com: number, text: string) { this.pre.push(() => this.enc.ifSetText(com, text)); }
    queueIfClose() { this.pre.push(() => this.enc.ifClose()); }
    queueStat(stat: number, xp: number, level: number) { this.post.push(() => this.enc.updateStat(stat, xp, level)); }
    // VARPS. Queued PRE (before PLAYER_INFO) so the brain sees the new value on the SAME tick the server
    // sent it — which is what the engine does: a varp write inside a script lands in the outbound buffer
    // during processPlayers, ahead of player info. That timing is the whole point for a set-with-verify
    // caller: it must be able to observe the confirm on the tick after its click, not two ticks after.
    queueVarp(varp: number, value: number) { this.pre.push(() => this.enc.varp(varp, value)); }
    queueVarpSmall(varp: number, value: number) { this.pre.push(() => this.enc.varpSmall(varp, value)); }
    queueVarpLarge(varp: number, value: number) { this.pre.push(() => this.enc.varpLarge(varp, value)); }
    queueVarpSync() { this.pre.push(() => this.enc.varpSync()); }
    /** UPDATE_RUNENERGY carries a 0..100 percent. */
    queueRunEnergy(percent: number) { this.pre.push(() => this.enc.updateRunEnergy(percent)); }
    /** Attach a hitsplat to `index` on the NEXT npcInfo packet (see npcInfoPacket). */
    queueNpcHit(index: number, hit: NpcHitsplat) { this.pendingHits.set(index, hit); }
    queueInv(slots: Array<{ id: number; count: number }>, com = 3214) { this.post.push(() => this.enc.updateInvFull(com, slots)); }
    /** P_COUNTDIALOG — the "how many?" prompt. Queued PRE, like every other script-driven packet: the
     *  engine writes it during processPlayers, and a RESUME_P_COUNTDIALOG sent before it is DROPPED
     *  (ResumePCountDialogHandler.ts:10-13), so the ordering is the whole point of testing it. */
    queueCountDialog() { this.pre.push(() => this.enc.pCountDialog()); }
    // GROUND ITEMS. Two DIFFERENT wire paths, and the difference is load-bearing: the killer's own drop
    // arrives as a receiver-scoped standalone OBJ_ADD behind UPDATE_ZONE_PARTIAL_FOLLOWS, while everyone
    // else gets the shared ENCLOSED reveal ~100 ticks later (pickupbot.ts:13). LeanBot decoded only the
    // ENCLOSED form, so it could not see its own kills — a defect this harness can now reproduce.
    // Builders are pushed one-per-packet: encode order MUST equal push order or the ISAAC cipher desyncs.
    queueGroundItem(x: number, z: number, obj: number, count = 1) {
        this.pre.push(() => this.enc.zonePartialFollows({ x, z }, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ));
        this.pre.push(() => this.enc.objAdd({ x, z }, obj, count, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ));
    }
    /** Drop a ground item the way EVERY OTHER player sees it: the shared ENCLOSED reveal. */
    queueGroundItemEnclosed(x: number, z: number, obj: number, count = 1) {
        this.pre.push(() => this.enc.zoneObjAddEnclosed({ x, z }, obj, count, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ));
    }
    /**
     * ⭐ THE PILE A SCAVENGER ACTUALLY LIVES ON: someone ELSE's drop going public, on the REAL
     * `OBJ_REVEAL` wire (219 + the extra `p2(receiverId)`), not the `OBJ_ADD` stand-in. This is the only
     * event a collector camped at a death cluster ever sees for a pile it did not drop, and it is a
     * DIFFERENT decode branch in pickupbot.ts (`via: 'reveal'`) from the owner-locked add.
     */
    queueGroundItemRevealed(x: number, z: number, obj: number, count = 1, receiverId = 0) {
        this.pre.push(() => this.enc.zoneObjRevealEnclosed(
            { x, z }, obj, count, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ, receiverId));
    }
    /** The zone-wide DEL: the pile is gone because somebody took it or it despawned. */
    queueGroundItemGoneEnclosed(x: number, z: number, obj: number) {
        this.pre.push(() => this.enc.zoneObjDelEnclosed({ x, z }, obj, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ));
    }
    /** Remove a ground item (taken by someone / despawned). */
    queueGroundItemGone(x: number, z: number, obj: number) {
        this.pre.push(() => this.enc.zonePartialFollows({ x, z }, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ));
        this.pre.push(() => this.enc.objDel({ x, z }, obj, this.bot.mapBuildBaseX, this.bot.mapBuildBaseZ));
    }

    async tick(): Promise<TickResult> {
        this.ticks++;
        // 1. world applies what the brain sent last tick (processClientsIn timing)
        const events = this.world.tickOnce(this.pendingActions);
        this.pendingActions = [];

        // 2. encode this tick's batch in the engine's own order (see queue* docs):
        //    script packets -> PLAYER_INFO -> NPC_INFO -> inv/stat updates.
        //    Encode in push order — the ISAAC cipher advances one value per packet.
        const batch: Uint8Array[] = [
            ...this.pre.splice(0).map(f => f()),
            ...this.playerInfoPackets(),
            this.npcInfoPacket(),
            ...this.post.splice(0).map(f => f()),
        ];

        // 3. brain runs (on PLAYER_INFO) inside the real decode loop
        for (const p of batch) this.stream.push(p);
        await this.stream.waitIdle();

        // 4. collect what it sent
        const actions = this.parser.parse(this.stream.takeWritten());
        this.pendingActions = actions;
        this.answerStyleClick(actions);
        return { tick: this.ticks, actions, events, player: { x: this.world.player.x, z: this.world.player.z } };
    }

    // ---- set_attackstyle, modelled ---------------------------------------------------------------
    // `[if_button,combat_X:btnN] ~set_attackstyle(N)` sets `%com_mode = N` and the varp is transmitted
    // back (player_attackstyles.rs2). Until now the sim parsed the click and dropped it, so com_mode
    // NEVER moved — which was invisible while the client only ever fired style clicks blindly, and
    // becomes load-bearing the moment anything reads the varp back to confirm.
    //
    // ⛔ THIS ALSO MAKES THE SIM ABLE TO REPRODUCE THE REAL FAILURE. Set `answerStyleClicks = false` and
    // the world behaves exactly like a server whose weapon tab is NOT bound: it accepts the click and
    // changes nothing. That is the outfitter.ts:4-11 defect — the one that trained bots on the
    // wrong stat for an hour — and it is now something a test can assert against.
    answerStyleClicks = true;
    private answerStyleClick(actions: ClientAction[]): void {
        if (!this.answerStyleClicks) return;
        for (const a of actions) {
            if (a.type !== 'ifbutton') continue;
            const s = STYLE_BUTTON_LOOKUP.get(a.com);
            if (s) this.queueVarp(VARP.COM_MODE, s.style);
        }
    }

    async run(n: number): Promise<TickResult[]> {
        const out: TickResult[] = [];
        for (let i = 0; i < n; i++) out.push(await this.tick());
        return out;
    }

    async stop(): Promise<void> {
        this.stream.push(this.enc.logout());
        await this.runPromise;
    }

    botTile(): { x: number; z: number } {
        return { x: this.bot.mapBuildBaseX + this.bot.localPlayer.routeX[0]!, z: this.bot.mapBuildBaseZ + this.bot.localPlayer.routeZ[0]! };
    }

    // Returns [PLAYER_INFO] — or [REBUILD_NORMAL, PLAYER_INFO] when a teleport left
    // the 7-bit scene window. NOTE: it must RETURN the rebuild rather than pushing it,
    // so the caller keeps encode order == push order (else the ISAAC stream desyncs).
    private playerInfoPackets(): Uint8Array[] {
        const p = this.world.player;
        const prev = this.prevPlayer;
        const dx = p.x - prev.x, dz = p.z - prev.z;
        this.prevPlayer = { x: p.x, z: p.z };
        const steps = this.world.playerSteps; // per-tick step deltas recorded by the world
        if (dx === 0 && dz === 0 && !this.world.player.teleported) return [this.enc.playerInfo({ kind: 'none' })];
        if (steps.length === 1) return [this.enc.playerInfo({ kind: 'walk', dir: dirCode(steps[0]![0], steps[0]![1]) })];
        if (steps.length === 2) return [this.enc.playerInfo({ kind: 'run', dir1: dirCode(steps[0]![0], steps[0]![1]), dir2: dirCode(steps[1]![0], steps[1]![1]) })];
        // teleport (or anything non-step): re-anchor with a jump teleport, rebuilding if out of scene
        const out: Uint8Array[] = [];
        let localX = p.x - this.bot.mapBuildBaseX, localZ = p.z - this.bot.mapBuildBaseZ;
        if (localX < 0 || localX > 127 || localZ < 0 || localZ > 127) {
            const zoneX = p.x >> 3, zoneZ = p.z >> 3;
            out.push(this.enc.rebuildNormal(zoneX, zoneZ));
            localX = p.x - (zoneX - 6) * 8; localZ = p.z - (zoneZ - 6) * 8;
        }
        out.push(this.enc.playerInfo({ kind: 'teleport', level: 0, localX, localZ, jump: true }));
        return out;
    }

    private pendingHits = new Map<number, NpcHitsplat>();

    private npcInfoPacket(): Uint8Array {
        const existing: NpcTickUpdate[] = [];
        const nextTracked: number[] = [];
        const adds: Array<Extract<NpcTickUpdate, { kind: 'add' }>> = [];
        const px = this.world.player.x, pz = this.world.player.z;
        const inView = (nx: number, nz: number) => nx - px >= -16 && nx - px <= 15 && nz - pz >= -16 && nz - pz <= 15;
        const hits = this.pendingHits;
        this.pendingHits = new Map();   // one npcInfo packet carries each queued hit exactly once

        for (const idx of this.tracked) {
            const npc = this.world.npcs.get(idx);
            if (!npc || !inView(npc.x, npc.z) || npc.teleported) { existing.push({ kind: 'remove' }); continue; }
            const s = npc.steps;
            const hit = hits.get(idx);
            if (s.length === 0) { existing.push({ kind: 'keep', hit }); nextTracked.push(idx); }
            else { existing.push({ kind: 'walk', dir: dirCode(s[0]![0], s[0]![1]), hit }); nextTracked.push(idx); }
        }
        for (const [idx, npc] of this.world.npcs) {
            if (nextTracked.includes(idx)) continue;
            if (!inView(npc.x, npc.z)) continue;
            adds.push({ kind: 'add', index: idx, typeId: npc.typeId, relX: npc.x - px, relZ: npc.z - pz, hit: hits.get(idx) });
            nextTracked.push(idx);
        }
        this.tracked = nextTracked;
        return this.enc.npcInfo(existing, adds);
    }
}

// A per-tile "staircase" path (diagonal then straight) — every hop Chebyshev-1,
// the shape navgrid.planRoute emits on open ground. Usable as a fake planner:
// (level, sx, sz, dx, dz) => linePath(sx, sz, dx, dz)
export function linePath(sx: number, sz: number, dx: number, dz: number): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [{ x: sx, z: sz }];
    let x = sx, z = sz;
    while (x !== dx || z !== dz) {
        x += Math.sign(dx - x); z += Math.sign(dz - z);
        out.push({ x, z });
    }
    return out;
}

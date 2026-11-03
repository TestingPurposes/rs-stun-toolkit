// Phase 1 HEADLESS 2004scape client (no browser). Bun/Node.
// Logs into the demo server, runs the ISAAC-encrypted packet decode loop,
// and every game tick prints the local player's WORLD POSITION.
//
// Run: bun server/webclient/headless/leanclient.ts <user> <pass>
//
// This reuses the webclient's pure modules via the package "#/" import alias,
// so it MUST live inside server/webclient/ for the aliases to resolve.
//
// The login handshake is copied verbatim from server/webclient/headless-login.ts.
// The player-position decode (getPlayerPos + sub-methods) and the movement
// classes (moveCode/teleport) are ported from src/client/Client.ts,
// src/dash3d/ClientPlayer.ts and src/dash3d/ClientEntity.ts. Only the parts
// that affect byte-alignment of the ISAAC stream are ported; scene/render and
// config-table (SeqType/WordPack/etc.) logic is stripped because it never
// touches the packet cursor.

import Packet from '#/io/Packet.js';
import Isaac from '#/io/Isaac.js';
import ClientStream from '#/io/ClientStream.js';
import JString from '#/datastruct/JString.js';
import { ServerProt, ServerProtSizes } from '#/io/ServerProt.js';
import { ClientProt } from '#/io/ClientProt.js';
import { decodeChatMask, type ChatMaskUpdate } from './chat-codec.js';

// LC_HOST repoints every headless client that imports this module: e.g.
// LC_HOST=localhost:8888 for a local engine. Plain ws/http for
// localhost unless LC_SECURE=1 forces TLS.
const HOST = process.env.LC_HOST || 'rs-sdk-demo.fly.dev';
const SECURE = process.env.LC_SECURE ? process.env.LC_SECURE === '1' : !/^(localhost|127\.)/.test(HOST);
const CLIENT_VERSION = 289;   // rev 289 port (was 274). Handshake layout is unchanged.
// A connect that never settles holds its caller's slot forever. Under a network partition the TCP
// handshake black-holes: no 'open', no 'error', no OS-level RST for minutes. A handful of these is
// enough to wedge a whole reconnect queue.
const CONNECT_TIMEOUT_MS = Number(process.env.LC_CONNECT_TIMEOUT_MS ?? 10_000);

// ---------------------------------------------------------------------------
// LC_SYNC_DECODE — synchronous fast-path decode. DEFAULT OFF.
// ---------------------------------------------------------------------------
// The server flushes a whole tick's packets as ONE WebSocket message, so by the time the decode loop
// starts reading, the bytes are already sitting in the reader's queue — yet every single one of them
// costs an awaited promise (ClientStream.read -> WebSocketReader.read, each an async fn). With this on,
// readByte()/readBody() take the bytes straight out of the buffer and only fall back to the awaited
// path when it runs dry.
//
// It CANNOT spin: the fast path is bounded by data already buffered, the buffer runs dry every server
// tick, and new data only ever arrives on a WebSocket event — which needs the event loop to turn. The
// disposed guard is preserved on the sync path (see readByte).
const SYNC_DECODE = process.env.LC_SYNC_DECODE === '1';
/** SIM_DET login gate (offline sim only): count of logins in this process whose login block is not on the wire yet */
export const simLoginGate = { n: 0 };
const SIM_DET_LOGIN = process.env.SIM_LOCKSTEP === '1' && process.env.SIM_DET === '1';

// ---------------------------------------------------------------------------
// LC_READ_WATCHDOG — ONE process-level read deadline instead of one timer per read.
// ---------------------------------------------------------------------------
// WebSocketReader.waitForEvent() used to create AND clear a 30s setTimeout every time a read parked on
// an empty buffer — ~2 timer heap operations per tick per bot, hundreds per second with many bots, all to
// arm a deadline that essentially never fires. Headless clients therefore build their stream with the
// per-read timer OFF and register it here; one 5s scan fails any stream that has a read pending and no
// bytes for >30s, recording the SAME dropReason and rejecting with the SAME value (the raw WebSocket).
// The only observable difference is granularity: the deadline lands at 30-35s instead of exactly 30s.
// LC_READ_WATCHDOG=0 restores the per-read timers (the browser path) — the rollback switch.
const READ_WATCHDOG = (process.env.LC_READ_WATCHDOG ?? '1') !== '0';
const READ_DEADLINE_MS = 30_000;
const WATCHDOG_SCAN_MS = 5_000;
const watchedStreams = new Set<ClientStream>();
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function watchdogScan(): void {
    const now = Date.now();
    for (const s of watchedStreams) {
        if (s.isDead) { watchedStreams.delete(s); continue; }   // a caller that never calls destroy()
        const since = s.pendingReadSince;
        if (since > 0 && now - since > READ_DEADLINE_MS) s.expirePendingRead();
    }
}

function watchStream(s: ClientStream): void {
    if (!READ_WATCHDOG) return;
    watchedStreams.add(s);
    if (!watchdogTimer) {
        watchdogTimer = setInterval(watchdogScan, WATCHDOG_SCAN_MS);
        // Never hold a short-lived CLI probe open just because the watchdog is armed.
        (watchdogTimer as unknown as { unref?: () => void }).unref?.();
    }
}

function unwatchStream(s: ClientStream | undefined | null): void {
    if (s) watchedStreams.delete(s);
}

// ---------------------------------------------------------------------------
// LC_KEEPALIVE — ONE process-level idle sweep, independent of every brain.
// ---------------------------------------------------------------------------
// The server force-logs-out any player whose socket has not DELIVERED BYTES in
// World.TIMEOUT_NO_RESPONSE = 1000 ticks (NetworkPlayer bumps `lastResponse` only when
// decodeIn() actually consumed bytes). At the demo's tick rate that is ~5 minutes.
//
// Until now the only thing keeping a headless bot alive was the brains' own
// `if (this.tickCount % 5 === 0) out.p1Enc(NO_TIMEOUT)`, which is sprinkled across a
// handful of hand-picked branches in the brains. That makes liveness a PROPERTY OF
// THE BRAIN'S CONTROL FLOW: any bot that parks in a branch without one of those calls — or
// whose brain never starts at all — is guaranteed to be kicked at exactly 1000 ticks, and
// then again every 1000 ticks after each reconnect, forever.
//
// That is precisely the signature seen in practice: kicks perfectly periodic at ~305s
// (= 1000 ticks + one 5s report bucket), caused by ONE inert account rather than contention for the
// event loop. See the header comment on sendKeepalive() for the ISAAC-safety argument.
//
// One interval for the whole process (same shape as the read watchdog above) sends
// NO_TIMEOUT for any registered client whose LAST SEND is older than the threshold, so
// liveness no longer depends on brain scheduling OR on the event loop being responsive
// enough for a particular bot's tick to come around.
//
// LC_KEEPALIVE=0 restores the old brain-only behaviour — the rollback switch.
const KEEPALIVE = (process.env.LC_KEEPALIVE ?? '1') !== '0';
// 45s idle + 10s scan => a send lands by 55s worst case, ~5.5x under the 300s server
// deadline. Deliberately far under it: the margin is what absorbs a congested event loop.
const KEEPALIVE_IDLE_MS = Number(process.env.LC_KEEPALIVE_IDLE_MS ?? 45_000);
const KEEPALIVE_SCAN_MS = Number(process.env.LC_KEEPALIVE_SCAN_MS ?? 10_000);
/** ClientProt.NO_TIMEOUT (181 @289, was 120 @274). Zero payload. NOT IDLE_TIMER — that one REQUESTS a logout. */
const NO_TIMEOUT: number = ClientProt.NO_TIMEOUT;

const liveClients = new Set<LeanClient>();
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

const keepaliveStats = { sweeps: 0, sent: 0, scanned: 0, scanNanos: 0 };

function keepaliveScan(): void {
    const t0 = Bun.nanoseconds();
    const now = Date.now();
    let sent = 0;
    for (const c of liveClients) {
        // A client nobody destroyed but that is no longer alive must not pin memory here.
        if (c.disposed || !c.alive) { liveClients.delete(c); continue; }
        if (now - c.lastSendAt >= KEEPALIVE_IDLE_MS && c.sendKeepalive()) sent++;
    }
    keepaliveStats.sweeps++;
    keepaliveStats.sent += sent;
    keepaliveStats.scanned += liveClients.size;
    keepaliveStats.scanNanos += Bun.nanoseconds() - t0;
}

function registerKeepalive(c: LeanClient): void {
    if (!KEEPALIVE) return;
    liveClients.add(c);
    if (!keepaliveTimer) {
        keepaliveTimer = setInterval(keepaliveScan, KEEPALIVE_SCAN_MS);
        // Never hold a short-lived CLI probe open just because the sweep is armed.
        (keepaliveTimer as unknown as { unref?: () => void }).unref?.();
    }
}

function unregisterKeepalive(c: LeanClient): void {
    liveClients.delete(c);
}

const RSAN = 7162900525229798032761816791230527296329313291232324290237849263501208207972894053929065636522363163621000728841182238772712427862772219676577293600221789n;
const RSAE = 58778699976184461502525193738213253649000149147835990136706041084440742975821n;

const MAX_PLAYER_COUNT = 2048;
const LOCAL_PLAYER_INDEX = 2047;

const enum PlayerUpdate {
    APPEARANCE = 0x1,
    ANIM = 0x2,
    FACEENTITY = 0x4,
    SAY = 0x8,
    HITMARK = 0x10,
    FACESQUARE = 0x20,
    CHAT = 0x40,
    BIG_UPDATE = 0x80,
    SPOTANIM = 0x100,
    EXACTMOVE = 0x200,
    HITMARK2 = 0x400
}

// ---------------------------------------------------------------------------
// Lean movement entity ­— ported moveCode/teleport/abortRoute/addHitmark from
// src/dash3d/ClientEntity.ts. The SeqType (postanim abort-anim) branch is
// dropped: our decode never assigns a non -1 primaryAnim, so it never fired.
// ---------------------------------------------------------------------------
class LeanPlayer {
    x = 0;
    z = 0;
    size = 1;
    cycle = 0;

    routeLength = 0;
    routeX = new Int32Array(10);
    routeZ = new Int32Array(10);
    routeRun: boolean[] = new Array(10).fill(false);
    preanimRouteLength = 0;
    animDelayMove = 0;

    // extended-info fields (kept so the ported extended decode assigns cleanly)
    primaryAnim = -1;
    primaryAnimFrame = 0;
    primaryAnimCycle = 0;
    primaryAnimDelay = 0;
    primaryAnimLoop = 0;
    faceEntity = -1;
    faceSquareX = 0;
    faceSquareZ = 0;
    chatMessage: string | null = null;
    chatColour = 0;
    chatEffect = 0;
    chatTimer = 100;
    health = 0;
    totalHealth = 0;
    combatCycle = -1000;
    spotanimId = -1;
    spotanimFrame = 0;
    spotanimCycle = 0;
    spotanimLastCycle = 0;
    spotanimHeight = 0;
    exactStartX = 0;
    exactStartZ = 0;
    exactEndX = 0;
    exactEndZ = 0;
    exactMoveEnd = 0;
    exactMoveStart = 0;
    exactMoveFacing = 0;
    damageValues = new Int32Array(4);
    damageTypes = new Int32Array(4);
    damageCycles = new Int32Array(4);

    name: string | null = null;
    ready = false;

    teleport(jump: boolean, x: number, z: number): void {
        if (!jump) {
            const dx: number = x - this.routeX[0];
            const dz: number = z - this.routeZ[0];

            if (dx >= -8 && dx <= 8 && dz >= -8 && dz <= 8) {
                if (this.routeLength < 9) {
                    this.routeLength++;
                }

                for (let i: number = this.routeLength; i > 0; i--) {
                    this.routeX[i] = this.routeX[i - 1];
                    this.routeZ[i] = this.routeZ[i - 1];
                    this.routeRun[i] = this.routeRun[i - 1];
                }

                this.routeX[0] = x;
                this.routeZ[0] = z;
                this.routeRun[0] = false;
                return;
            }
        }

        this.routeLength = 0;
        this.preanimRouteLength = 0;
        this.animDelayMove = 0;
        this.routeX[0] = x;
        this.routeZ[0] = z;
        this.x = this.routeX[0] * 128 + this.size * 64;
        this.z = this.routeZ[0] * 128 + this.size * 64;
    }

    moveCode(running: boolean, direction: number): void {
        let nextX: number = this.routeX[0];
        let nextZ: number = this.routeZ[0];

        if (direction === 0) {
            nextX--;
            nextZ++;
        } else if (direction === 1) {
            nextZ++;
        } else if (direction === 2) {
            nextX++;
            nextZ++;
        } else if (direction === 3) {
            nextX--;
        } else if (direction === 4) {
            nextX++;
        } else if (direction === 5) {
            nextX--;
            nextZ--;
        } else if (direction === 6) {
            nextZ--;
        } else if (direction === 7) {
            nextX++;
            nextZ--;
        }

        if (this.routeLength < 9) {
            this.routeLength++;
        }

        for (let i: number = this.routeLength; i > 0; i--) {
            this.routeX[i] = this.routeX[i - 1];
            this.routeZ[i] = this.routeZ[i - 1];
            this.routeRun[i] = this.routeRun[i - 1];
        }

        this.routeX[0] = nextX;
        this.routeZ[0] = nextZ;
        this.routeRun[0] = running;
    }

    abortRoute(): void {
        this.routeLength = 0;
        this.preanimRouteLength = 0;
    }

    addHitmark(loopCycle: number, type: number, value: number): void {
        for (let i = 0; i < 4; i++) {
            if (this.damageCycles[i] <= loopCycle) {
                this.damageValues[i] = value;
                this.damageTypes[i] = type;
                this.damageCycles[i] = loopCycle + 70;
                return;
            }
        }
    }

    // The real setAppearance parses the appearance blob (needs NpcType/JString
    // config tables). It reads a SEPARATE Packet, never the main game buffer, so
    // it has no effect on stream byte-alignment. Stub it for headless.
    setAppearance(_buf: Packet): void {
        this.ready = true;
    }

    /**
     * Restore every field to its constructor value so this object can be handed to a DIFFERENT world
     * index (see the pool below). ⛔ It must stay exhaustive: a field left behind is a stale fact
     * attributed to a brand-new player — e.g. a leftover `chatMessage` would look like a fresh trade
     * request, and a leftover `faceEntity` like a bot facing a target it has never seen.
     * Subclasses that add fields (LeanNpc) MUST override and call super.reset().
     */
    reset(): void {
        this.x = 0;
        this.z = 0;
        this.size = 1;
        this.cycle = 0;

        this.routeLength = 0;
        this.routeX.fill(0);
        this.routeZ.fill(0);
        this.routeRun.fill(false);
        this.preanimRouteLength = 0;
        this.animDelayMove = 0;

        this.primaryAnim = -1;
        this.primaryAnimFrame = 0;
        this.primaryAnimCycle = 0;
        this.primaryAnimDelay = 0;
        this.primaryAnimLoop = 0;
        this.faceEntity = -1;
        this.faceSquareX = 0;
        this.faceSquareZ = 0;
        this.chatMessage = null;
        this.chatColour = 0;
        this.chatEffect = 0;
        this.chatTimer = 100;
        this.health = 0;
        this.totalHealth = 0;
        this.combatCycle = -1000;
        this.spotanimId = -1;
        this.spotanimFrame = 0;
        this.spotanimCycle = 0;
        this.spotanimLastCycle = 0;
        this.spotanimHeight = 0;
        this.exactStartX = 0;
        this.exactStartZ = 0;
        this.exactEndX = 0;
        this.exactEndZ = 0;
        this.exactMoveEnd = 0;
        this.exactMoveStart = 0;
        this.exactMoveFacing = 0;
        this.damageValues.fill(0);
        this.damageTypes.fill(0);
        this.damageCycles.fill(0);

        this.name = null;
        this.ready = false;
    }
}

// ---------------------------------------------------------------------------
// LeanPlayer freelist (process-level).
// ---------------------------------------------------------------------------
// Every map-square crossing re-vis's the whole neighbourhood, and co-located bots churn dozens of
// player slots per tick per bot — each one a fresh LeanPlayer with six typed arrays inside it. The
// objects are structurally identical and short-lived, which is exactly what a freelist is for.
//
// SAFETY: an object is released ONLY where the decoder nulls its slot (`players[index] = null`), and
// acquire() POPS it, so it can never be live in two slots at once. reset() is exhaustive.
const PLAYER_POOL_MAX = 4096;
const playerPool: LeanPlayer[] = [];

function acquirePlayer(): LeanPlayer {
    const p = playerPool.pop();
    if (p) {
        p.reset();
        return p;
    }
    return new LeanPlayer();
}

function releasePlayer(p: LeanPlayer): void {
    if (playerPool.length < PLAYER_POOL_MAX) playerPool.push(p);
}

// ---------------------------------------------------------------------------
// LeanClient
// ---------------------------------------------------------------------------
class LeanClient {
    stream!: ClientStream;
    inIsaac!: Isaac;
    outIsaac!: Isaac;
    quiet: boolean = false;
    in: Packet = Packet.alloc(2); // 30k buffer, plenty for any packet

    loginUser = '';

    // --- lifecycle, for a supervisor that has to reconnect us -----------------
    // `alive` is the ONLY honest liveness flag; a supervisor that counts bot OBJECTS counts corpses.
    alive = false;
    disposed = false;
    /** Last login response byte: 2=ok, 5=save flushing, 7=world full, 16=login already in flight,
     *  4/6/12/13=permanent. The supervisor backs off per-byte instead of on one generic curve.
     *  NOT byte 3: 'bad credentials' is TRANSIENT under login-server contention — `LoginServer.ts:360`
     *  answers it for `!account || !passwordMatch`, and `account` is an `executeTakeFirst()` DB read that
     *  comes back empty under load exactly as it would for a nonexistent account (the same account
     *  logs in fine minutes later). Retiring on it would silently drop a working account. */
    lastLoginByte = -1;
    lastDropReason: string | null = null;

    /**
     * ⭐ THE PUBLISH ACK. Wall-clock ms at which the SERVER sent us ServerProt.LOGOUT (121 @289), or 0.
     *
     * ⛔ THIS IS NOT "the socket died" AND THE DIFFERENCE IS THE WHOLE POINT. `lastDropReason` is set by
     * a login refusal and by every decode-loop exit too; only this field means the engine ran
     * `World.removePlayer()` for us — which is the ONLY code path that calls `flushPlayer()`, the only
     * thing that fills `logoutRequests`, and therefore the only thing that makes the world post
     * `player_logout` to the login thread. `LoginServer.ts:609` (`await updateHiscores(...)`) hangs off
     * that message and NOTHING ELSE does: the `player_autosave` branch beside it persists the .sav and
     * publishes no hiscore row at all. So: LOGOUT received ⇒ the row is being written. Socket closed ⇒
     * it is not, until the engine's own idle reap gets round to it.
     * Set in the ONE place the packet is decoded (below); LeanBot overrides that decode and sets it too.
     */
    serverLogoutAt = 0;

    /** Wall-clock ms of the last byte we handed to the socket. Maintained by a wrapper installed
     *  over `stream.write` at login, so it counts EVERY outbound write — the brains' per-tick flush
     *  included — without any brain needing to know the keepalive exists. */
    lastSendAt = 0;
    keepalivesSent = 0;

    /**
     * Append a zero-payload NO_TIMEOUT to the outbound stream. Returns true if bytes went out.
     *
     * ── ISAAC SAFETY (the whole risk of this feature) ───────────────────────────────────────────
     * `p1Enc` writes `(opcode + outIsaac.nextInt) & 0xff`, so it ADVANCES THE OUTBOUND CIPHER ONCE
     * per call. The server decrypts with a mirrored ISAAC in strict byte order, so the invariant is:
     * **the order of p1Enc calls must equal the order the bytes reach the wire.** Four things
     * guarantee that here:
     *
     * 1. JS run-to-completion. This is called from a setInterval macrotask, which can never preempt
     *    synchronous code — so it cannot land between a brain's `p1Enc(op)` and that packet's
     *    payload writes unless the brain AWAITS mid-packet.
     * 2. No brain awaits mid-packet. Every p1Enc site in the brains builds its
     *    packet in one synchronous block (audited; 0 await-splits). So the buffer is only ever
     *    observed on a packet BOUNDARY.
     * 3. APPEND, never prepend or side-channel. We write into the SAME `out` buffer the brain uses,
     *    after whatever complete packets are already queued, then flush the whole thing. Cipher
     *    order and wire order therefore stay identical. Sending our byte down `stream.write`
     *    independently while `out.pos > 0` is what WOULD corrupt the stream — that is exactly the
     *    case the `pos === 0` guard below covers on the no-buffer path.
     * 4. Never encrypt against a stale cipher. `out.random === this.outIsaac` fails during the
     *    reconnect window (login installs a fresh Isaac before run() rebinds the buffer); we skip
     *    that round rather than emit a byte the server cannot decrypt.
     *
     * After we flush, `pos` is 0, so the brain's own `flush()` (`if (this.out.pos > 0)`) is a no-op
     * this tick — there is no double-send.
     */
    sendKeepalive(): boolean {
        if (this.disposed || !this.alive || !this.outIsaac || !this.stream) return false;
        // LeanBot & friends declare `out`; a bare LeanClient does not. Read it structurally so this
        // file never has to know about the subclass.
        const buf = (this as unknown as { out?: Packet }).out;
        try {
            if (buf && buf.random === this.outIsaac) {
                buf.p1Enc(NO_TIMEOUT);               // (3) append at a packet boundary
                this.stream.write(buf.data, buf.pos);
                buf.pos = 0;
            } else if (!buf || buf.pos === 0) {
                // No subclass buffer, or one bound to a different cipher AND holding nothing. With
                // nothing queued there is no ordering to violate, so a standalone byte is safe.
                const p = Packet.alloc(0);
                p.random = this.outIsaac;
                p.p1Enc(NO_TIMEOUT);
                this.stream.write(p.data, p.pos);
                p.release();
            } else {
                // Stale cipher WITH queued bytes: the queue is already unsendable. Do not make it
                // worse by advancing the cipher; the reconnect path will rebuild both.
                return false;
            }
        } catch {
            return false;   // socket died mid-write; the supervisor owns recovery
        }
        this.lastSendAt = Date.now();
        this.keepalivesSent++;
        return true;
    }

    /** Terminal. Frees the socket — nothing else does, so every failed login used to LEAK an open
     *  WebSocket at the server.
     *  ⚠️ NEVER call this on a client whose run() is still expected to keep going: ClientStream.close()
     *  sets `dummy`, after which read() RETURNS 0 instead of throwing and the decode loop would spin on
     *  microtasks forever, freezing the event loop. The readByte() guard makes it safe. */
    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.alive = false;
        unwatchStream(this.stream);
        unregisterKeepalive(this);
        try {
            this.stream?.close();
        } catch {
            /* already dead */
        }
    }

    // world/scene base offsets (REBUILD_NORMAL)
    mapBuildCentreZoneX = 0;
    mapBuildCentreZoneZ = 0;
    mapBuildBaseX = 0;
    mapBuildBaseZ = 0;

    // player tracking
    localPlayer: LeanPlayer;
    players: (LeanPlayer | null)[] = new Array(MAX_PLAYER_COUNT).fill(null);
    playerCount = 0;
    playerIds = new Int32Array(MAX_PLAYER_COUNT);
    playerAppearanceBuffer: (Packet | null)[] = new Array(MAX_PLAYER_COUNT).fill(null);
    // ---- PROCESS-LEVEL DECODE SCRATCH ----------------------------------------------------------
    // These two are live ONLY inside one synchronous decode call: getPlayerPos() (and LeanBot's
    // getNpcPos()) zero both counters at entry and have consumed both arrays before returning — there
    // is no `await` anywhere between, so no second client can be mid-decode at the same time. They are
    // therefore shared process-wide instead of costing every bot its own 12KB. The COUNTS stay
    // per-instance (they are meaningless outside the call, and per-instance is the conservative half).
    static readonly sharedEntityUpdateIds = new Int32Array(MAX_PLAYER_COUNT);
    static readonly sharedEntityRemovalIds = new Int32Array(1000);
    entityUpdateIds = LeanClient.sharedEntityUpdateIds;
    entityUpdateCount = 0;
    entityRemovalIds = LeanClient.sharedEntityRemovalIds;
    entityRemovalCount = 0;
    minusedlevel = 0;

    loopCycle = 0;
    tickCount = 0;

    // ---- OVERHEAD-TEXT HOOKS (parity package 4) -------------------------------------------------
    // The player-update masks carry text but NO sender name, and the decode lives in the PRIVATE
    // getPlayerPosDecodeExtended below — a subclass cannot override it, so the observation point has
    // to be here. These are the whole seam: undefined by default (every existing LeanClient user is
    // byte-for-byte unchanged and pays nothing), and LeanBot assigns them to feed its ChatLog. This
    // file deliberately knows NOTHING about ChatLog / chat history / sender resolution — it hands over
    // the decoded block plus the world INDEX and lets the caller decide what a name is.
    //
    // ⚠ A hook must never throw into the decode loop: by the time it fires the cursor is already
    // correct, but an escaping throw would drop the connection. Both call sites wrap it.
    protected onPlayerChat?: (index: number, chat: ChatMaskUpdate) => void;
    /** SAY (0x8) — a plain newline-terminated string (npc/script forced speech), NOT WordPack. */
    protected onPlayerSay?: (index: number, text: string) => void;

    constructor() {
        this.localPlayer = this.players[LOCAL_PLAYER_INDEX] = new LeanPlayer();
    }

    // --- login handshake (copied from headless-login.ts) --------------------
    //
    // The checksums are a CONSTANT of the server build. Fetching them once per BOT fires a burst of
    // HTTPS GETs at /crc on every mass restart, which the server can answer with ConnectionRefused and
    // turn into failed logins (response byte 8). So fetch them ONCE per process, dedupe the
    // concurrent callers (bots log in in parallel), and cache to disk so an HTTP hiccup can never
    // block a login.
    private static crcCache: number[] | null = null;
    private static crcInFlight: Promise<number[]> | null = null;
    /**
     * Hosts whose CRC memo has already been dropped once for an unexplained byte-6. ONE-SHOT PER HOST:
     * a genuine revision mismatch or RSA fault also answers 6, and re-fetching /crc on every single
     * refused login would turn a reconnect storm into an HTTP flood against a realm
     * that is already refusing us. Cleared on any successful login (see login()).
     */
    private static crcRefetchedFor = new Set<string>();
    private static readonly CRC_FILE = `${import.meta.dir}/../../../crc.bin`;

    private static parseCrc(b: Uint8Array): number[] {
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const c: number[] = [];
        for (let i = 0; i < 9; i++) c.push(dv.getInt32(i * 4, false));
        return c;
    }

    /**
     * ⛔ INVALIDATE THE MEMO — the recovery path for a CONTENT REDEPLOY.
     *
     * `crcCache` is memoized for the whole PROCESS lifetime, which is correct while the realm's cache
     * is stable and catastrophic the moment it is not. The realm redeployed, one of the nine archive
     * CRCs changed, and every long-lived process went on presenting the
     * pre-redeploy value on every reconnect. The engine answers byte 6 (World.ts:2349, the CRC-mismatch
     * branch) and closes. The reconnect loop could not recover BY CONSTRUCTION: it re-read the same
     * poisoned memo forever. It presented as a healthy-looking corpse — processes alive, status files
     * fresh, zero connections, and a drop reason that said "kick or idle-logout".
     *
     * The on-disk fallback is poisoned by the same event, so this drops that too: its old comment
     * ("The checksums haven't changed") is precisely the assumption a redeploy invalidates.
     */
    static invalidateChecksums(): void {
        LeanClient.crcCache = null;
        LeanClient.crcInFlight = null;
    }

    static async fetchChecksums(): Promise<number[]> {
        if (LeanClient.crcCache) return LeanClient.crcCache;
        if (LeanClient.crcInFlight) return LeanClient.crcInFlight;

        LeanClient.crcInFlight = (async (): Promise<number[]> => {
            try {
                // Bounded: a hung /crc during a partition would otherwise stall every login behind it.
                const res = await fetch(`${SECURE ? 'https' : 'http'}://${HOST}/crc`, {
                    signal: AbortSignal.timeout(10_000),
                });
                if (!res.ok) throw new Error(`/crc -> HTTP ${res.status}`);
                const b = new Uint8Array(await res.arrayBuffer());
                const c = LeanClient.parseCrc(b);
                try { await Bun.write(LeanClient.CRC_FILE, b); } catch { /* cache is best-effort */ }
                LeanClient.crcCache = c;
                // ONCE per process. This used to print from login(), i.e. once per bot: one identical
                // 9-number line per bot, and the same line again on every single reconnect —
                // pure noise in the one log you read to find out why bots are dropping.
                console.log('[lc] checksums:', JSON.stringify(c));
                return c;
            } catch (e) {
                const f = Bun.file(LeanClient.CRC_FILE);
                if (await f.exists()) {
                    const c = LeanClient.parseCrc(new Uint8Array(await f.arrayBuffer()));
                    console.log(`[lc] /crc unreachable (${(e as Error).message}) — using cached crc.bin`);
                    LeanClient.crcCache = c;
                    return c;
                }
                LeanClient.crcInFlight = null;   // allow a retry; we have nothing to fall back on
                throw e;
            }
        })();
        return LeanClient.crcInFlight;
    }

    uid: number = 1337;
    private simGateOpen = false;
    async login(user: string, pass: string): Promise<boolean> {
        // The three login buffers are 5,000 bytes EACH and were previously abandoned to the GC on
        // every login and every reconnect. Packet keeps a
        // freelist for exactly this; hand them back on every exit path, success or throw.
        const out = Packet.alloc(1);
        const inp = Packet.alloc(1);
        const loginout = Packet.alloc(1);
        // SIM_DET login gate (offline sim, replayable runs): every other bot in this process holds its tick ack until this
        // login block is on the wire, so the login lands on the same tick in every run (not wherever the handshake's wall time
        // happens to fall while the others keep acking). Released right after the login write (loginWith) or on any exit.
        const gate = SIM_DET_LOGIN;
        if (gate) simLoginGate.n++;
        this.simGateOpen = gate;
        try {
            return await this.loginWith(user, pass, out, inp, loginout);
        } finally {
            if (this.simGateOpen) { simLoginGate.n--; this.simGateOpen = false; }
            out.release();
            inp.release();
            loginout.release();
        }
    }

    private async loginWith(user: string, pass: string, out: Packet, inp: Packet, loginout: Packet): Promise<boolean> {
        this.loginUser = user;

        const jagChecksum = await LeanClient.fetchChecksums();

        if (!this.quiet) console.log(`[lc] opening socket ${SECURE ? 'wss' : 'ws'}://${HOST} ...`);
        unwatchStream(this.stream);   // a re-login must not leave the old stream in the watchdog set
        this.stream = new ClientStream(
            await ClientStream.openSocket(HOST, SECURE, CONNECT_TIMEOUT_MS),
            { perReadTimer: !READ_WATCHDOG },
        );
        // destroy() can land DURING the openSocket await (a supervisor's login deadline does exactly
        // that). The freshly opened socket would then be an orphan nobody ever closes — and now also a
        // strong reference held by the watchdog set forever. Close it and give up.
        if (this.disposed) {
            unwatchStream(this.stream);
            try { this.stream.close(); } catch { /* nothing to close */ }
            return false;
        }
        watchStream(this.stream);
        // Count every outbound write, whoever makes it. The brains reach the socket through
        // `this.stream.write(...)` directly (LeanBot.flush), so wrapping the INSTANCE is the only way
        // to observe sends from this file — and it keeps the keepalive honest: a bot whose brain is
        // healthy and flushing every tick never trips the idle threshold and never costs a byte.
        // Re-applied on every re-login because each login builds a brand-new ClientStream.
        const rawWrite = this.stream.write.bind(this.stream);
        this.stream.write = (src: Uint8Array, len: number): void => {
            this.lastSendAt = Date.now();
            rawWrite(src, len);
        };
        this.lastSendAt = Date.now();   // a fresh socket is not instantly "idle for 45s"
        if (!this.quiet) console.log('[lc] socket open');

        const userhash = JString.toUserhash(user);
        const loginServer = Number(userhash >> 16n) & 0x1f;

        out.pos = 0;
        out.p1(14);
        out.p1(loginServer);
        this.stream.write(out.data, 2);
        for (let i = 0; i < 8; i++) await this.stream.read();

        let response = await this.stream.read();
        if (!this.quiet) console.log('[lc] initial response byte:', response);

        if (response !== 0) {
            this.lastLoginByte = response;
            console.log('[lc] unexpected initial response:', response);
            return false;
        }

        await this.stream.readBytes(inp.data, 0, 8);
        inp.pos = 0;
        const loginSeed = inp.g8();
        const seed = new Int32Array([
            Math.floor(Math.random() * 99999999),
            Math.floor(Math.random() * 99999999),
            Number(loginSeed >> 32n),
            Number(loginSeed & 0xffffffffn)
        ]);

        out.pos = 0;
        out.p1(10);
        out.p4(seed[0]);
        out.p4(seed[1]);
        out.p4(seed[2]);
        out.p4(seed[3]);
        out.p4(this.uid); // uid (unique per bot avoids sharing the per-device login-rate bucket)
        out.pjstr(user);
        out.pjstr(pass);
        out.rsaenc(RSAN, RSAE);

        loginout.pos = 0;
        loginout.p1(16); // 16 = new login, 18 = reconnect
        loginout.p1(out.pos + 36 + 1 + 2 + 1);
        loginout.p1(255);
        loginout.p2(CLIENT_VERSION);
        loginout.p1(0); // lowmem
        for (let i = 0; i < 9; i++) loginout.p4(jagChecksum[i]);
        loginout.pdata(out.data, 0, out.pos);

        this.outIsaac = new Isaac(seed);
        const inSeed = new Int32Array(seed);
        for (let i = 0; i < 4; i++) inSeed[i] += 50;
        this.inIsaac = new Isaac(inSeed);

        this.stream.write(loginout.data, loginout.pos);
        if (this.simGateOpen) { simLoginGate.n--; this.simGateOpen = false; }   // SIM_DET login gate: the block is on the wire
        response = await this.stream.read();
        if (!this.quiet) console.log('[lc] login response byte:', response);

        this.lastLoginByte = response;
        if (response !== 2) {
            // ⛔ BYTE 6 IS RECOVERABLE, AND ONLY HERE. The engine sends 6 for a revision mismatch, a
            // CACHE-CRC mismatch and an RSA error alike (World.ts:2338/2349/2359), so we cannot tell
            // them apart on the wire — but the CRC case is the one a long-lived process causes itself
            // by memoizing, and it is the one a content redeploy triggers. Drop the
            // memo and let the NEXT attempt re-fetch /crc. Retrying inline would re-enter login()
            // recursively while the socket is already closed; the supervisor's reconnect is the right
            // place to retry, and it now has something new to retry WITH.
            if (response === 6 && !LeanClient.crcRefetchedFor.has(HOST)) {
                LeanClient.crcRefetchedFor.add(HOST);
                LeanClient.invalidateChecksums();
                console.log('[lc] login refused (byte 6) — cache CRCs may be stale after a server ' +
                    'redeploy; memo dropped, next attempt re-fetches /crc');
            }
            // Name it. This used to surface as the generic drop reason and read as an idle-logout.
            this.lastDropReason = `login refused (byte ${response})`;
            console.log('[lc] login not successful, final response =', response);
            return false;
        }
        // A success proves the current CRCs are good, so a LATER redeploy is allowed to arm the
        // one-shot recovery again. Without this, exactly one redeploy per process lifetime is
        // survivable and the second one brings the original bug back.
        LeanClient.crcRefetchedFor.delete(HOST);

        const staffmodlevel = await this.stream.read();
        const mouseTracked = await this.stream.read();
        if (!this.quiet) console.log(`[lc] LOGIN OK  staffmod=${staffmodlevel} mouseTracked=${mouseTracked}`);
        this.alive = true;
        this.lastSendAt = Date.now();
        registerKeepalive(this);
        return true;
    }

    // --- decode loop --------------------------------------------------------
    //
    // Returns a NUMBER when the byte was already buffered and a Promise otherwise, so `await
    // this.readByte()` in every subclass run() loop keeps working verbatim while the buffered case
    // stops allocating a promise per byte. (With LC_SYNC_DECODE off this is exactly the old body plus
    // one boolean test — the same ClientStream.read() promise the old `await` resolved.)
    readByte(): number | Promise<number> {
        // A destroyed stream RETURNS 0 forever rather than throwing (ClientStream.read() short-circuits
        // on `dummy`), so without this guard destroy() turns the decode loop into a hot microtask spin
        // that starves the event loop. Throw instead: run() rejects, the supervisor reconnects.
        // ⛔ THE SYNC PATH IS BELOW THIS LINE ON PURPOSE — it must never bypass the guard.
        if (this.disposed) throw new Error('client destroyed');
        if (SYNC_DECODE) {
            // `?.` because the sim harness swaps in a mock stream that has no sync primitives.
            const b = this.stream.tryRead?.() ?? -1;
            if (b >= 0) return b;
        }
        return this.stream.read();
    }

    /** Read a packet BODY into `this.in`. Same all-or-nothing contract as ClientStream.tryReadBytes:
     *  either the whole body came out of the buffer, or nothing was consumed and we await the normal
     *  path over the identical range. Used at the one body-read call site of every run() loop. */
    protected readBody(psize: number): void | Promise<void> {
        if (SYNC_DECODE && this.stream.tryReadBytes?.(this.in.data, 0, psize)) return;
        return this.stream.readBytes(this.in.data, 0, psize);
    }

    async run(maxTicks: number): Promise<void> {
        for (;;) {
            // read + ISAAC-decrypt opcode (one ISAAC value per packet)
            const rawOpcode = await this.readByte();
            const opcode = (rawOpcode - this.inIsaac.nextInt) & 0xff;

            let psize = ServerProtSizes[opcode];
            if (psize === -1) {
                psize = await this.readByte();
            } else if (psize === -2) {
                const hi = await this.readByte();
                const lo = await this.readByte();
                psize = (hi << 8) | lo;
            }

            if (psize > 0) {
                await this.readBody(psize);
            }
            this.in.pos = 0;

            if (opcode === ServerProt.LOGOUT) {
                this.serverLogoutAt = Date.now();
                this.lastDropReason = 'server LOGOUT (kick or idle-logout)';
                if (!this.quiet) console.log('[lc] server sent LOGOUT');
                return;
            }

            if (opcode === ServerProt.REBUILD_NORMAL) {
                const zoneX: number = this.in.g2();
                const zoneZ: number = this.in.g2();
                const oldBaseX = this.mapBuildBaseX;
                const oldBaseZ = this.mapBuildBaseZ;
                this.mapBuildCentreZoneX = zoneX;
                this.mapBuildCentreZoneZ = zoneZ;
                this.mapBuildBaseX = (this.mapBuildCentreZoneX - 6) * 8;
                this.mapBuildBaseZ = (this.mapBuildCentreZoneZ - 6) * 8;
                // Rebase every tracked entity's scene-local coords to the new origin
                // (the real client does this on scene rebuild; without it a 1-zone
                // shift lands in teleport()'s ±8 "walk" branch and routeX keeps
                // OLD-base coords -> absolute position off by 8 -> MOVE start tiles
                // wrong -> server ignores all movement = the travel-desync bug).
                if (oldBaseX !== 0 || oldBaseZ !== 0) {
                    const dx = oldBaseX - this.mapBuildBaseX;
                    const dz = oldBaseZ - this.mapBuildBaseZ;
                    if (dx !== 0 || dz !== 0) {
                        for (const p of this.players) {
                            if (!p) continue;
                            for (let i = 0; i < p.routeX.length; i++) {
                                p.routeX[i] += dx;
                                p.routeZ[i] += dz;
                            }
                            p.x += dx * 128;
                            p.z += dz * 128;
                        }
                    }
                }
                if (!this.quiet) console.log(`[lc] REBUILD_NORMAL centreZone=(${zoneX},${zoneZ}) base=(${this.mapBuildBaseX},${this.mapBuildBaseZ})`);
                continue;
            }

            if (opcode === ServerProt.PLAYER_INFO) {
                this.loopCycle++;
                try {
                    this.getPlayerPos(this.in, psize);
                } catch (e) {
                    console.error(`[lc] DESYNC on PLAYER_INFO (psize=${psize}):`, (e as Error).message);
                    this.dumpHex(this.in.data, psize);
                    throw e;
                }

                const pos = this.getPlayerPosition();
                this.tickCount++;
                if (!this.quiet) {
                    if (pos) {
                        console.log(`[lc] tick ${this.tickCount}: worldX=${pos.worldX} worldZ=${pos.worldZ}  (tile ${pos.tileX},${pos.tileZ} | base ${this.mapBuildBaseX},${this.mapBuildBaseZ})`);
                    } else {
                        console.log(`[lc] tick ${this.tickCount}: no local player position yet`);
                    }
                }

                if (this.tickCount >= maxTicks) {
                    if (!this.quiet) console.log(`[lc] reached ${maxTicks} ticks, stopping.`);
                    return;
                }
                continue;
            }

            // every other opcode: bytes already consumed from the stream,
            // discard to stay byte-aligned.
        }
    }

    getPlayerPosition(): { worldX: number; worldZ: number; tileX: number; tileZ: number } | null {
        if (!this.localPlayer) {
            return null;
        }
        const tileX = this.localPlayer.x >> 7;
        const tileZ = this.localPlayer.z >> 7;
        return {
            worldX: this.mapBuildBaseX + tileX,
            worldZ: this.mapBuildBaseZ + tileZ,
            tileX,
            tileZ
        };
    }

    dumpHex(data: Uint8Array, size: number): void {
        const bytes: string[] = [];
        for (let i = 0; i < size; i++) {
            bytes.push(data[i].toString(16).padStart(2, '0'));
        }
        console.error('[lc] packet hex:', bytes.join(' '));
    }

    // --- ported player-position decode (Client.ts) --------------------------
    // (protected so Phase 2's LeanBot subclass can reuse it in its own run loop)
    protected getPlayerPos(buf: Packet, size: number): void {
        this.entityRemovalCount = 0;
        this.entityUpdateCount = 0;

        this.getPlayerPosLocal(buf, size);
        this.getPlayerPosOldVis(buf, size);
        this.getPlayerPosNewVis(buf, size);
        this.getPlayerPosExtended(buf, size);

        for (let i: number = 0; i < this.entityRemovalCount; i++) {
            const index: number = this.entityRemovalIds[i];
            const player: LeanPlayer | null = this.players[index];
            if (!player) {
                continue;
            }
            if (player.cycle !== this.loopCycle) {
                this.players[index] = null;
                releasePlayer(player);   // the ONLY release site: the slot is nulled in the same breath
            }
        }

        if (buf.pos !== size) {
            throw new Error(`packet size mismatch in getplayerpos: pos:${buf.pos} psize:${size}`);
        }

        for (let index: number = 0; index < this.playerCount; index++) {
            if (!this.players[this.playerIds[index]]) {
                throw new Error(`null entry in pl list - pos:${index} size:${this.playerCount}`);
            }
        }
    }

    private getPlayerPosLocal(buf: Packet, _size: number): void {
        buf.gBitStart();

        const info: number = buf.gBit(1);
        if (info !== 0) {
            const op: number = buf.gBit(2);

            if (op === 0) {
                this.entityUpdateIds[this.entityUpdateCount++] = LOCAL_PLAYER_INDEX;
            } else if (op === 1) {
                const walkDir: number = buf.gBit(3);
                this.localPlayer?.moveCode(false, walkDir);

                const extendedInfo: number = buf.gBit(1);
                if (extendedInfo === 1) {
                    this.entityUpdateIds[this.entityUpdateCount++] = LOCAL_PLAYER_INDEX;
                }
            } else if (op === 2) {
                const walkDir: number = buf.gBit(3);
                this.localPlayer?.moveCode(true, walkDir);

                const runDir: number = buf.gBit(3);
                this.localPlayer?.moveCode(true, runDir);

                const extendedInfo: number = buf.gBit(1);
                if (extendedInfo === 1) {
                    this.entityUpdateIds[this.entityUpdateCount++] = LOCAL_PLAYER_INDEX;
                }
            } else if (op === 3) {
                this.minusedlevel = buf.gBit(2);
                const localX: number = buf.gBit(7);
                const localZ: number = buf.gBit(7);
                const jump: number = buf.gBit(1);

                this.localPlayer?.teleport(jump === 1, localX, localZ);

                const extendedInfo: number = buf.gBit(1);
                if (extendedInfo === 1) {
                    this.entityUpdateIds[this.entityUpdateCount++] = LOCAL_PLAYER_INDEX;
                }
            }
        }
    }

    private getPlayerPosOldVis(buf: Packet, _size: number): void {
        const count: number = buf.gBit(8);

        if (count < this.playerCount) {
            for (let i: number = count; i < this.playerCount; i++) {
                this.entityRemovalIds[this.entityRemovalCount++] = this.playerIds[i];
            }
        }

        if (count > this.playerCount) {
            throw new Error('eek! Too many players');
        }

        this.playerCount = 0;
        for (let i: number = 0; i < count; i++) {
            const index: number = this.playerIds[i];
            const player: LeanPlayer | null = this.players[index];

            const info: number = buf.gBit(1);
            if (info === 0) {
                this.playerIds[this.playerCount++] = index;
                if (player) {
                    player.cycle = this.loopCycle;
                }
            } else {
                const op: number = buf.gBit(2);

                if (op === 0) {
                    this.playerIds[this.playerCount++] = index;
                    if (player) {
                        player.cycle = this.loopCycle;
                    }
                    this.entityUpdateIds[this.entityUpdateCount++] = index;
                } else if (op === 1) {
                    this.playerIds[this.playerCount++] = index;
                    if (player) {
                        player.cycle = this.loopCycle;
                    }

                    const walkDir: number = buf.gBit(3);
                    player?.moveCode(false, walkDir);

                    const extendedInfo: number = buf.gBit(1);
                    if (extendedInfo === 1) {
                        this.entityUpdateIds[this.entityUpdateCount++] = index;
                    }
                } else if (op === 2) {
                    this.playerIds[this.playerCount++] = index;
                    if (player) {
                        player.cycle = this.loopCycle;
                    }

                    const walkDir: number = buf.gBit(3);
                    player?.moveCode(true, walkDir);

                    const runDir: number = buf.gBit(3);
                    player?.moveCode(true, runDir);

                    const extendedInfo: number = buf.gBit(1);
                    if (extendedInfo === 1) {
                        this.entityUpdateIds[this.entityUpdateCount++] = index;
                    }
                } else if (op === 3) {
                    this.entityRemovalIds[this.entityRemovalCount++] = index;
                }
            }
        }
    }

    private getPlayerPosNewVis(buf: Packet, size: number): void {
        while (buf.bitPos + 10 < size * 8) {
            const index = buf.gBit(11);
            if (index === 2047) {
                break;
            }

            if (!this.players[index]) {
                this.players[index] = acquirePlayer();

                const appearance: Packet | null = this.playerAppearanceBuffer[index];
                if (appearance) {
                    this.players[index]?.setAppearance(appearance);
                }
            }

            this.playerIds[this.playerCount++] = index;
            const player: LeanPlayer | null = this.players[index];
            if (player) {
                player.cycle = this.loopCycle;
            }

            let dx: number = buf.gBit(5);
            if (dx > 15) {
                dx -= 32;
            }

            let dz: number = buf.gBit(5);
            if (dz > 15) {
                dz -= 32;
            }

            const jump: number = buf.gBit(1);

            if (this.localPlayer) {
                player?.teleport(jump === 1, this.localPlayer.routeX[0] + dx, this.localPlayer.routeZ[0] + dz);
            }

            const extendedInfo: number = buf.gBit(1);
            if (extendedInfo === 1) {
                this.entityUpdateIds[this.entityUpdateCount++] = index;
            }
        }

        buf.gBitEnd();
    }

    private getPlayerPosExtended(buf: Packet, _size: number): void {
        for (let i: number = 0; i < this.entityUpdateCount; i++) {
            const index: number = this.entityUpdateIds[i];
            const player: LeanPlayer | null = this.players[index];
            if (!player) {
                continue;
            }

            let mask: number = buf.g1();
            if ((mask & PlayerUpdate.BIG_UPDATE) !== 0) {
                mask += buf.g1() << 8;
            }

            this.getPlayerPosDecodeExtended(player, index, mask, buf);
        }
    }

    private getPlayerPosDecodeExtended(player: LeanPlayer, index: number, mask: number, buf: Packet): void {
        if ((mask & PlayerUpdate.APPEARANCE) !== 0) {
            const length: number = buf.g1();

            // ⛔ THE BLOB IS NOT DEAD WEIGHT — DO NOT REPLACE THIS WITH A CURSOR SKIP.
            // setAppearance() is a stub headless, but the RETAINED bytes are load-bearing:
            // LeanBot.playerName() (leanbot.ts) decodes the base37 username out of this buffer, and
            // findPlayerIndexByName() (and so every trade) runs on that; outfitter.ts reads the worn-weapon slot out of the same bytes. Skipping the copy
            // would make every bot invisible to every other bot by name.
            //
            // What IS dead weight is the ALLOCATION: a fresh Uint8Array + Packet (+ its DataView) on
            // every appearance, and appearances re-arrive on every new-vis, i.e. constantly at a
            // map-square boundary in a crowd. Reuse the retained Packet instead. EXACT-SIZE ONLY: a
            // shorter blob written into a longer buffer would leave stale trailing bytes, and
            // wornObjInAppearance()'s truncation check (which must answer UNKNOWN, never "bare") reads
            // bytes.length to detect exactly that. A bot's blob is usually a constant length, so this
            // hits on every sighting after the first.
            let appearance: Packet | null = this.playerAppearanceBuffer[index];
            if (!appearance || appearance.data.length !== length) {
                appearance = new Packet(new Uint8Array(length));
                this.playerAppearanceBuffer[index] = appearance;
            }
            buf.gdata(length, 0, appearance.data);
            appearance.pos = 0;

            player.setAppearance(appearance);
        }

        if ((mask & PlayerUpdate.ANIM) !== 0) {
            // seqId (g2) + delay (g1); SeqType priority logic stripped (headless).
            buf.g2();
            buf.g1();
        }

        if ((mask & PlayerUpdate.FACEENTITY) !== 0) {
            player.faceEntity = buf.g2();
            if (player.faceEntity === 65535) {
                player.faceEntity = -1;
            }
        }

        if ((mask & PlayerUpdate.SAY) !== 0) {
            player.chatMessage = buf.gjstr();
            player.chatColour = 0;
            player.chatEffect = 0;
            player.chatTimer = 150;
            if (this.onPlayerSay) {
                try { this.onPlayerSay(index, player.chatMessage); } catch { /* a listener must never drop the link */ }
            }
        }

        if ((mask & PlayerUpdate.HITMARK) !== 0) {
            const damage = buf.g1();
            const damageType = buf.g1();

            player.addHitmark(this.loopCycle, damageType, damage);
            player.combatCycle = this.loopCycle + 400;
            player.health = buf.g1();
            player.totalHealth = buf.g1();
        }

        if ((mask & PlayerUpdate.FACESQUARE) !== 0) {
            player.faceSquareX = buf.g2();
            player.faceSquareZ = buf.g2();
        }

        if ((mask & PlayerUpdate.CHAT) !== 0) {
            // ⭐ WAS A CURSOR JUMP (`g2 g1 g1 len; pos = start + len`) — the ONE place headless threw
            // away every word a nearby player said. It is now a real WordPack decode, and the swap is
            // alignment-neutral BY CONSTRUCTION, not by luck: decodeChatMask reads the same 4 header
            // bytes, then hands the body to unpackFromPacket, which decodes a SUBARRAY VIEW and then
            // ASSIGNS `buf.pos = start + length`. The cursor is never advanced by reading, so no body
            // — over-long, malformed, zero-length — can move it anywhere else. That is exactly what
            // the jump did, which is why sim/chat-wire.test.ts uses the old jump verbatim as an
            // ORACLE and asserts the two land on the same byte with a sentinel behind the block.
            const chat = decodeChatMask(buf);
            player.chatMessage = chat.text;
            player.chatColour = chat.colour;
            player.chatEffect = chat.effect;
            player.chatTimer = 150;
            if (this.onPlayerChat) {
                try { this.onPlayerChat(index, chat); } catch { /* a listener must never drop the link */ }
            }
        }

        if ((mask & PlayerUpdate.SPOTANIM) !== 0) {
            player.spotanimId = buf.g2();
            const heightDelay: number = buf.g4();

            player.spotanimHeight = heightDelay >> 16;
            player.spotanimLastCycle = this.loopCycle + (heightDelay & 0xffff);
            player.spotanimFrame = 0;
            player.spotanimCycle = 0;

            if (player.spotanimLastCycle > this.loopCycle) {
                player.spotanimFrame = -1;
            }

            if (player.spotanimId === 65535) {
                player.spotanimId = -1;
            }
        }

        if ((mask & PlayerUpdate.EXACTMOVE) !== 0) {
            player.exactStartX = buf.g1();
            player.exactStartZ = buf.g1();
            player.exactEndX = buf.g1();
            player.exactEndZ = buf.g1();
            player.exactMoveEnd = buf.g2() + this.loopCycle;
            player.exactMoveStart = buf.g2() + this.loopCycle;
            player.exactMoveFacing = buf.g1();

            player.abortRoute();
        }

        if ((mask & PlayerUpdate.HITMARK2) !== 0) {
            const damage = buf.g1();
            const damageType = buf.g1();

            player.addHitmark(this.loopCycle, damageType, damage);
            player.combatCycle = this.loopCycle + 400;
            player.health = buf.g1();
            player.totalHealth = buf.g1();
        }
    }
}

// --- runnable entrypoint (only when run directly, not when imported) --------
if (import.meta.main) {
const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
    console.error('usage: bun server/webclient/headless/leanclient.ts <user> <pass>');
    process.exit(1);
}

const MAX_TICKS = Number(process.argv[4] ?? 15);

const client = new LeanClient();
try {
    const ok = await client.login(username, password);
    if (!ok) {
        console.log('[lc] login failed');
        process.exit(1);
    }
    await client.run(MAX_TICKS);
    process.exit(0);
} catch (e: any) {
    console.error('[lc] error:', e?.message ?? e);
    process.exit(1);
}
}

export { LeanClient, LeanPlayer };
export { keepaliveStats, keepaliveScan, registerKeepalive, unregisterKeepalive, liveClients, KEEPALIVE_IDLE_MS, NO_TIMEOUT };

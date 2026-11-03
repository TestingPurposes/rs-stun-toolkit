// drops.ts — DROP-PROOFING for every route-runner bot (main, partner, helpers, LeanBot drivers).
//
// The live demo closes every socket at once (ws 1012 'restarting', then refuses logins ~30 t) and single sockets die
// (1006). Without this a drop ended a ~7.5 h run. Approach (the speedrun's, our run notes superviseRun):
// the SAME bot object logs back in, so every reference the runner, the modules and the helpers hold stays valid, and code
// parked in tick()/until() just waits through the outage (tickCount only advances on server ticks).
//  - installDropGuard() patches SpeedBot.create (every SpeedBot of the process is supervised; create itself retries a login
//    refused by a restart) and wraps LeanClient.login (remembers the password; a reconnect login uses opcode 18 =
//    RECONNECT, so the engine re-attaches the socket to the player that is still in the world, answer 15).
//  - guardBot(b) (LeanBot driver sessions too): a 20 ms-poll supervisor notices a closed socket, a server LOGOUT we did not ask
//    for, or no server tick for ROUTE_STALL_TICK_S while a sibling bot ticks; it backs off (1, 2, 4, 8, 15 s live; the same
//    in ENGINE ticks in the sim via the engine's /worldfeed tick stream, because a lockstep engine with nobody connected
//    races ahead of wall time), logs in again, resets the client-side views the server re-sends (npcs, players, modals,
//    live locs, doors) and restarts the decode loop. A death while disconnected (back at the Lumbridge spawn) is reported.
//  - DROPS counts reconnects and offline engine ticks per account; the runner adds the offline ticks to its route clock,
//    gives a quest that failed after a drop extra retries, and the timeline gets one {kind:'reconnect'} row per reconnect.
import { SpeedBot, passwordOf, sleep } from '../../../core.js';

const TICK_MS = 400;
const MAX_MS = Number(process.env.ROUTE_RECONNECT_MAX_S ?? 900) * 1000;
const STALL_MS = Number(process.env.ROUTE_STALL_TICK_S ?? 60) * 1000;
const ON = process.env.ROUTE_RECONNECT !== '0';
// 20 ms: a lockstep sim runs ~80 t/s while bots act, so a 250 ms poll was ~20 engine ticks of detection lag (live: < 1 t)
const POLL_MS = Number(process.env.ROUTE_DROP_POLL_MS ?? 20);

type Rec = Record<string, unknown>;
export const DROPS = {
    reconnects: 0, gaveUp: 0, diedAway: 0,
    byAcct: new Map<string, { n: number; offline: number }>(),
    label: new Map<string, string>(),   // acct -> what the runner is doing (quest id), for the timeline
};
export function reconnectsOf(acct: string): number { return DROPS.byAcct.get(acct.toLowerCase())?.n ?? 0; }
export function offlineOf(acct: string): number { return DROPS.byAcct.get(acct.toLowerCase())?.offline ?? 0; }
let emit: (r: Rec) => void = () => {};
const guarded = new Set<any>();
const say = (s: string) => console.log(`[drop] ${s}`);

// ---- the sim engine's tick (offline sim only: never opened against a live host) ---------------------------------------
let feedTick = -1, feedAt = 0, feedState: 'off' | 'opening' | 'on' | 'no' = 'off';
function openFeed(): void {
    if (feedState !== 'off') return;
    const host = process.env.LC_HOST ?? '';
    if (process.env.SIM_LOCKSTEP !== '1' || !/^(localhost|127\.)/.test(host) || process.env.ROUTE_FEED === '0') { feedState = 'no'; return; }
    feedState = 'opening';
    try {
        const ws = new WebSocket(`ws://${host}/worldfeed`);
        ws.onopen = () => { try { ws.send(JSON.stringify({ t: 'sub', x: 0, z: 0, w: 1, h: 1 })); } catch { /* closed */ } };
        ws.onmessage = (e: MessageEvent) => { const m = /"(?:k|tick)":(\d+)/.exec(String(e.data)); if (m) { feedTick = Number(m[1]); feedAt = Date.now(); if (feedState !== 'on') { feedState = 'on'; say(`engine tick feed on (tick ${feedTick})`); } } };
        ws.onerror = () => { if (feedState === 'opening') { feedState = 'no'; say('engine has no /worldfeed (start it with WORLD_FEED=true): back-off and offline time in WALL time'); } };
        ws.onclose = () => { if (feedState === 'on') { feedState = 'off'; setTimeout(openFeed, 1000); } };
    } catch { feedState = 'no'; }
}
export function engineTick(): number | null { return feedState === 'on' && Date.now() - feedAt < 5000 ? feedTick : null; }
/** wait `ms` of live time: engine ticks in the sim (feed on), wall time otherwise */
async function backoff(ms: number, b: any): Promise<void> {
    const t0 = engineTick();
    if (t0 === null) { await sleep(ms); return; }
    const due = t0 + Math.ceil(ms / TICK_MS), w0 = Date.now();
    while (!b.disposed && (engineTick() ?? Infinity) < due && Date.now() - w0 < ms + 30_000) await sleep(5);
}

// ---- install ---------------------------------------------------------------------------------------------------------
let installed = false;
export function installDropGuard(onEvent?: (r: Rec) => void): void {
    if (onEvent) emit = onEvent;
    if (installed || !ON) return;
    installed = true;
    openFeed();
    // LeanClient.login: remember the password (k-live createLive passes it through a one-call shim); reconnect = opcode 18
    let p: any = SpeedBot.prototype;
    while (p && !Object.prototype.hasOwnProperty.call(p, 'login')) p = Object.getPrototypeOf(p);
    const origLogin = p.login;
    p.login = async function (this: any, user: string, pass: string, ...rest: unknown[]) {
        this.__pw = pass;
        if (!this.__rc) return origLogin.call(this, user, pass, ...rest);
        return rcLogin(this, origLogin, user, pass, rest);
    };
    // LeanBot.run: know when the old decode loop has ended (a second loop must never read the new stream alongside it)
    let q: any = SpeedBot.prototype;
    while (q && !Object.prototype.hasOwnProperty.call(q, 'run')) q = Object.getPrototypeOf(q);
    const origRun = q.run;
    q.run = function (this: any, ...a: unknown[]) {
        const pr = origRun.apply(this, a);
        this.__running = (this.__running ?? 0) + 1;
        const done = () => { this.__running--; };
        pr.then(done, done);
        return pr;
    };
    const S: any = SpeedBot;
    const origCreate = S.create.bind(S);
    S.create = async (user: string, opts?: any) => {
        const t0 = Date.now();
        for (let k = 0; ; k++) {
            try { const b = await origCreate(user, opts); guardBot(b, 'speedbot'); return b; }
            catch (e) {
                const msg = (e as Error)?.message ?? String(e);
                if (Date.now() - t0 > MAX_MS || !/login failed|not ready after login|socket|connect|closed/i.test(msg)) throw e;
                say(`${user}: login try ${k + 1} failed (${msg.slice(0, 100)}) - retrying`);
                emit({ kind: 'login-retry', acct: user, try: k + 1, why: msg.slice(0, 120) });
                await backoff(Math.min(15_000, 1000 * 2 ** Math.min(k, 4)), { disposed: false });
            }
        }
    };
}

/** login with opcode 18 (RECONNECT); answer 15 = re-attached to the player still in the world (one byte, then the game
 *  stream), 2 = a fresh login. LeanClient hardcodes 16 and wants 2 + staffmod + mouse: patch byte 0 of the 2nd write and
 *  map 15 -> 2 followed by two synthetic 0 bytes (same as the speedrun's core.ts login0). */
async function rcLogin(b: any, orig: any, user: string, pass: string, rest: unknown[]): Promise<boolean> {
    let cur: any = b.stream;
    Object.defineProperty(b, 'stream', {
        configurable: true, enumerable: true, get: () => cur,
        set: (st: any) => {
            cur = st;
            if (!st || st.__rcHook) return;
            st.__rcHook = true;
            let reads = 0, writes = 0, fake = 0;
            const r = st.read.bind(st), w = st.write.bind(st);
            st.read = () => {
                if (fake > 0) { fake--; return Promise.resolve(0); }
                if (++reads !== 10) return r();
                return Promise.resolve(r()).then((v: number) => { b.__rcAnswer = v; if (v === 15) { fake = 2; return 2; } return v; });
            };
            st.write = (data: Uint8Array, len?: number) => {
                if (++writes === 2 && data[0] === 16) { const c = data.slice(0, len ?? data.length); c[0] = 18; return w(c, len); }
                return w(data, len);
            };
        },
    });
    try { return await orig.call(b, user, pass, ...rest); }
    finally { Object.defineProperty(b, 'stream', { value: cur, writable: true, configurable: true, enumerable: true }); }
}

// ---- the supervisor ---------------------------------------------------------------------------------------------------
export function guardBot(b: any, kind = 'bot'): void {
    if (!ON || b.__guard) return;
    b.__guard = true; b.reconnecting = false; b.dropEpoch = b.dropEpoch ?? 0; b.__lastTickAt = Date.now();
    guarded.add(b);
    const intend = (name: string) => { const f = b[name]?.bind(b); if (f) b[name] = (...a: unknown[]) => { b.__intended = true; return f(...a); }; };
    intend('logout'); intend('requestCleanLogout');
    void supervise(b, kind);
}
async function supervise(b: any, kind: string): Promise<void> {
    let lastTick = b.tickCount;
    for (;;) {
        await sleep(POLL_MS);
        if (b.disposed || b.__intended) { guarded.delete(b); return; }
        if (b.tickCount !== lastTick) { lastTick = b.tickCount; b.__lastTickAt = Date.now(); b.__lastTickEngine = engineTick(); }
        const closed = !!b.stream?.isClosed, kicked = (b.serverLogoutAt ?? 0) > 0;
        const stall = !closed && !kicked && Date.now() - b.__lastTickAt > STALL_MS
            && [...guarded].some(o => o !== b && !o.reconnecting && !o.disposed && Date.now() - o.__lastTickAt < 5000);
        if (!closed && !kicked && !stall) continue;
        const why = closed ? String(b.stream?.dropReason ?? b.lastDropReason ?? 'socket closed') : kicked ? 'server LOGOUT (not ours)' : `no server tick for ${((Date.now() - b.__lastTickAt) / 1000).toFixed(0)} s`;
        if (stall || kicked) { try { b.stream?.socket?.close?.(); } catch { /* gone */ } }
        await reconnect(b, kind, why);
        if (b.disposed) { guarded.delete(b); return; }
        lastTick = b.tickCount; b.__lastTickAt = Date.now();
    }
}
async function reconnect(b: any, kind: string, why: string): Promise<void> {
    const user: string = b.loginUser, acct = user.toLowerCase(), pass: string = b.__pw ?? passwordOf(user);
    b.reconnecting = true;
    const w0 = Date.now(), e0 = b.__lastTickEngine ?? engineTick();   // offline from the last tick the bot saw
    const sib = [...guarded].find(o => o !== b && !o.reconnecting && !o.disposed && !o.stream?.isClosed);
    const s0 = sib?.tickCount ?? 0;
    const at = (() => { try { const t = b.tile(); return { x: t.x, z: t.z, level: b.minusedlevel }; } catch { return null; } })();
    const items = (() => { try { return b.inv().length; } catch { return 0; } })();
    const label = DROPS.label.get(acct) ?? '-';
    say(`${user} (${kind}, ${label}): connection lost at tick ${b.tickCount}${e0 !== null ? ` (engine ${e0})` : ''} at ${JSON.stringify(at)}: ${why} - reconnecting`);
    // the old decode loop must have ended before a new one starts on the new stream
    for (let k = 0; (b.__running ?? 0) > 0 && k < 200; k++) { if (k === 40) { try { b.stream?.socket?.close?.(); } catch { /* gone */ } } await sleep(50); }
    if ((b.__running ?? 0) > 0) say(`${user}: the old decode loop has not ended after 10 s (reconnecting anyway)`);
    let ok = false, tries = 0;
    for (let k = 0; !ok && !b.disposed && !b.__intended && Date.now() - w0 < MAX_MS; k++) {
        await backoff(Math.min(15_000, 1000 * 2 ** Math.min(k, 4)), b);
        tries++; b.__rc = true; b.__rcAnswer = -1;
        try { ok = await b.login(user, pass); } catch (e) { ok = false; b.lastDropReason = (e as Error)?.message ?? String(e); }
        finally { b.__rc = false; }
        if (!ok) say(`${user}: re-login try ${tries} failed (byte ${b.lastLoginByte}, ${b.lastDropReason ?? '?'})`);
    }
    if (!ok) {
        b.reconnecting = false;
        if (b.disposed || b.__intended) return;
        DROPS.gaveUp++;
        say(`${user}: GAVE UP reconnecting after ${((Date.now() - w0) / 1000).toFixed(0)} s`);
        emit({ kind: 'reconnect-failed', acct: user, botKind: kind, quest: label, why, tries });
        try { b.destroy(); } catch { /* gone */ }
        return;
    }
    // the new session's PLAYER_INFO / NPC_INFO start from an empty view; client-side state the server does not re-send
    try {
        b.npcs?.fill(null); b.npcCount = 0;
        if (b.players) { const lp = b.localPlayer; b.players.fill(null); b.players[2047] = lp; b.playerCount = 0; }
        b.playerAppearanceBuffer?.fill(null);
        b.mainModalId = -1; b.chatModalId = -1; b.sideModalId = -1;
        b.liveLocs?.clear?.(); b.enableDoorTracker?.();
        b.serverLogoutAt = 0;
    } catch (e) { say(`${user}: view reset: ${(e as Error).message}`); }
    // decode loop again (run() re-binds `out` to the new ISAAC before its first await: nothing old is flushed)
    b.run(Number.MAX_SAFE_INTEGER).catch(() => { /* the next drop: the supervisor reconnects */ });
    b.dropEpoch++; b.reconnecting = false;
    const answer = b.__rcAnswer;
    const e1 = engineTick();
    let offline: number, how: string;
    if (e0 !== null && e1 !== null && e1 >= e0) { offline = e1 - e0; how = 'engine'; }
    else if (sib && !sib.disposed && !sib.reconnecting) { offline = sib.tickCount - s0; how = 'sibling'; }
    else { offline = Math.round((Date.now() - w0) / TICK_MS); how = 'wall'; }
    const st = DROPS.byAcct.get(acct) ?? { n: 0, offline: 0 };
    st.n++; st.offline += offline; DROPS.byAcct.set(acct, st); DROPS.reconnects++;
    say(`${user}: RECONNECTED after ${offline} t (${how}; ${((Date.now() - w0) / 1000).toFixed(1)} s wall, ${tries} tries, answer ${answer}${answer === 15 ? ' = re-attached' : answer === 2 ? ' = fresh login' : ''}) reconnect #${b.dropEpoch} of ${user}`);
    // first ticks of the new session: run on again, then the landing check (died while away = back at the spawn)
    void (async () => {
        try {
            await b.sendWait(2);
            if (b.disposed) return;
            // session 11 fix 298a SR_RC_RUN_GUARD (CONFIRMED qx53m/qyy06m: the run-on button is controls:com_5, whose script
            // starts with if_close (player_controls.rs2:35), so this blind ensureRun 2 t after a reconnect CLOSED the npc dialog
            // the quest had just re-opened (q-lib talk re-opens once per reconnect) -> Narnode never took the Daconia rock, 150 t
            // idle, 'narnode-done dialog'; same in qx36m 'waydar-fly'). A re-attach keeps the run state (option_run, varp 173,
            // re-sent on reconnect): press it only when run is really off, and never over an open dialog (wait <= 30 t). =0 reverts.
            if (process.env.SR_RC_RUN_GUARD === '0') { try { b.ensureRun?.(); } catch { /* next */ } }
            else if (b.getVarp?.(173) !== 1) {
                for (let k = 0; k < 30 && !b.disposed && (b.chatModalId !== -1 || b.mainModalId !== -1); k++) await b.sendWait(1);
                if (!b.disposed && b.chatModalId === -1 && b.mainModalId === -1) { try { b.ensureRun?.(); } catch { /* next */ } }
            }
            await b.sendWait(2);
            const t = b.tile(), now = { x: t.x, z: t.z, level: b.minusedlevel };
            const spawn = now.level === 0 && Math.max(Math.abs(now.x - 3222), Math.abs(now.z - 3218)) <= 8;
            const far = !at || at.level !== 0 || Math.max(Math.abs(at.x - 3222), Math.abs(at.z - 3218)) > 16;
            const died = spawn && far;
            if (died) { DROPS.diedAway++; say(`${user}: back at the Lumbridge spawn after reconnect #${b.dropEpoch} (dropped at ${JSON.stringify(at)}, pack ${items} -> ${b.inv().length}): DIED while disconnected`); }
            emit({ kind: 'reconnect', acct: user, botKind: kind, quest: label, n: b.dropEpoch, why: why.slice(0, 120), offline, offlineHow: how, wallMs: Date.now() - w0, tries, answer, from: at, to: now, died });
        } catch { /* gone */ }
    })();
}

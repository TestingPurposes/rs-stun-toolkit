// ============================================================================
// CHAT, WIRED — the integration half of parity package 4.
//
// chat-codec.test.ts proves the CODEC in isolation. This file proves the thing
// that actually ships: leanclient's player-update decode and leanbot's run()
// loop with chat flowing through them.
//
// ── THE ONE TEST THAT MATTERS ───────────────────────────────────────────────
// leanclient.ts replaced a CURSOR JUMP with a real decode inside
// getPlayerPosDecodeExtended — the single hottest, most alignment-critical
// method in the headless stack. If the new decode lands even one byte off, the
// next mask in the same block reads garbage and every subsequent packet on the
// connection is misframed: a full DESYNC. So the OLD JUMP IS THE ORACLE.
// `legacyJump()` below is the replaced code, verbatim, and every case asserts
// that the wired decode leaves the cursor on exactly the same byte — with a
// SENTINEL mask behind the chat block whose value proves it independently.
//
// The three edge cases the codec's contract turns on are all here: a body that
// decodes past the client's 100-character cap (the decoder stops early — a
// read-driven cursor would stop short with it), a malformed trailing nibble,
// and a zero-length body.
// ============================================================================
import { describe, expect, test } from 'bun:test';

import Isaac from '#/io/Isaac.js';
import JString from '#/datastruct/JString.js';
import Packet from '#/io/Packet.js';
import { ClientProt } from '#/io/ClientProt.js';
import { ServerProt } from '#/io/ServerProt.js';

import {
    CHAT_MASK_HEADER_BYTES, MAX_MESSAGE_LENGTH, wordpackEncode, wordpackNormalize,
} from '../chat-codec.js';
import { LeanBot } from '../leanbot.js';
// `.js`, never `.ts` — a `.ts` specifier is a TS5097 under this tsconfig (that class is already
// the single biggest bucket in the project's error count; do not grow it).
import { ByteWriter, ServerPacketStream } from './protocol.js';

const IN_SEED = [11, 22, 33, 44];
const OUT_SEED = [55, 66, 77, 88];

// Player-update masks, from leanclient's PlayerUpdate enum.
const M_APPEARANCE = 0x1;
const M_SAY = 0x8;
const M_CHAT = 0x40;
const M_BIG = 0x80;
const M_SPOTANIM = 0x100;

/** The appearance blob LeanBot.playerName()/appearanceName() walk, carrying a base37 name. */
function appearanceBlob(name: string): Uint8Array {
    const w = new ByteWriter();
    w.p1(0); w.p1(0);                       // gender, headicons
    for (let i = 0; i < 12; i++) w.p1(0);   // 12 empty equipment slots
    for (let i = 0; i < 5; i++) w.p1(0);    // 5 colours
    for (let i = 0; i < 7; i++) w.p2(0);    // 7 anims
    w.p8(JString.toUserhash(name));
    return w.take();
}

/** A LeanBot with an outgoing buffer but no socket — enough to exercise the encoders. */
function encoderBot(): LeanBot {
    const bot = new LeanBot();
    bot.quiet = true;
    bot.out = Packet.alloc(1);
    bot.out.random = new Isaac(new Int32Array(OUT_SEED));
    return bot;
}

/** Decrypt and split what a bot wrote into `[opcode, ...payload]` frames. */
function readFrames(bot: LeanBot, sizes: Record<number, number>): Array<{ op: number; body: Uint8Array }> {
    const cipher = new Isaac(new Int32Array(OUT_SEED));
    const bytes = bot.out.data.subarray(0, bot.out.pos);
    const out: Array<{ op: number; body: Uint8Array }> = [];
    let p = 0;
    while (p < bytes.length) {
        const op = (bytes[p++]! - cipher.nextInt) & 0xff;
        const declared = sizes[op];
        if (declared === undefined) throw new Error(`test does not know the size of client opcode ${op}`);
        const size = declared === -1 ? bytes[p++]! : declared;
        out.push({ op, body: bytes.subarray(p, p + size) });
        p += size;
    }
    return out;
}

// ===========================================================================
describe('ALIGNMENT ORACLE: the wired CHAT decode lands where the cursor jump did', () => {
    /**
     * The exact bytes getPlayerPosDecodeExtended sees for a CHAT-only extended
     * block: the 4-byte header, the packed body, then a 4-byte sentinel standing
     * in for whatever comes next. One byte of drift and the sentinel is garbage.
     */
    function craft(colour: number, effect: number, rights: number, body: Uint8Array, sentinel: number): Packet {
        const bytes = new Uint8Array(CHAT_MASK_HEADER_BYTES + body.length + 4);
        bytes[0] = colour;
        bytes[1] = effect;
        bytes[2] = rights;
        bytes[3] = body.length;
        bytes.set(body, 4);
        new DataView(bytes.buffer).setUint32(4 + body.length, sentinel >>> 0);
        return new Packet(bytes);
    }

    /** ⭐ THE REPLACED CODE, VERBATIM (leanclient.ts, pre-package-4). The oracle. */
    function legacyJump(buf: Packet): number {
        buf.g2();               // colourEffect
        buf.g1();               // rights
        const length = buf.g1();
        const start = buf.pos;
        buf.pos = start + length;
        return buf.pos;
    }

    const CASES: Array<{ name: string; body: Uint8Array }> = [
        { name: 'ordinary message', body: wordpackEncode('meet me at the bank') },
        { name: 'zero length', body: new Uint8Array(0) },
        { name: 'single byte', body: wordpackEncode('a') },
        { name: 'max 80-char message', body: wordpackEncode('e'.repeat(MAX_MESSAGE_LENGTH)) },
        { name: 'all two-nibble chars', body: wordpackEncode(']'.repeat(MAX_MESSAGE_LENGTH)) },
        // ⭐ decodes to >100 chars: the unpacker STOPS at the cap, so a read-driven cursor stops short.
        { name: 'body past the 100-char decode cap', body: new Uint8Array(128).fill(0x11) },
        // ⭐ 0xff sets a carry nibble that never gets its partner — malformed trailing nibble.
        { name: 'malformed trailing nibble (0xff run)', body: new Uint8Array(9).fill(0xff) },
        { name: '255-byte body (max the length byte expresses)', body: new Uint8Array(255).fill(0x3c) },
    ];

    for (const { name, body } of CASES) {
        test(`wired decode == legacy jump: ${name}`, () => {
            const oracle = legacyJump(craft(2, 1, 0, body, 0xfeedface));

            const bot = new LeanBot();
            bot.quiet = true;
            const buf = craft(2, 1, 0, body, 0xfeedface);
            const player = bot.localPlayer;
            // The REAL wired method (private — this is the whole point of reaching for it).
            (bot as unknown as {
                getPlayerPosDecodeExtended(p: unknown, i: number, m: number, b: Packet): void;
            }).getPlayerPosDecodeExtended(player, 2047, M_CHAT, buf);

            expect(buf.pos).toBe(oracle);
            expect(buf.pos).toBe(CHAT_MASK_HEADER_BYTES + body.length);
            expect(buf.g4() >>> 0).toBe(0xfeedface);   // the next field still reads clean
        });
    }

    test('a decoded line is retained on the entity (it used to be discarded)', () => {
        const bot = new LeanBot();
        bot.quiet = true;
        const buf = craft(7, 2, 0, wordpackEncode('hello there'), 0);
        (bot as unknown as {
            getPlayerPosDecodeExtended(p: unknown, i: number, m: number, b: Packet): void;
        }).getPlayerPosDecodeExtended(bot.localPlayer, 2047, M_CHAT, buf);
        expect(bot.localPlayer.chatMessage).toBe(wordpackNormalize('hello there'));
        expect(bot.localPlayer.chatColour).toBe(7);
        expect(bot.localPlayer.chatEffect).toBe(2);
    });
});

// ===========================================================================
describe('PLAYER_INFO carrying chat decodes to psize exactly (no desync)', () => {
    /**
     * A whole PLAYER_INFO: local no-op, no oldVis, one newVis add whose extended
     * block is APPEARANCE + CHAT + SPOTANIM. SPOTANIM sits BEHIND the chat block
     * and its 6 bytes are read field-by-field, so a misaligned chat decode shows
     * up as a wrong spotanim id AND as getPlayerPos's own `pos !== size` throw.
     */
    function playerInfoWithChat(peerIndex: number, name: string, text: string, spotanimId: number): Uint8Array {
        const w = new ByteWriter();
        w.bitStart();
        w.pBit(1, 0);            // local player: nothing
        w.pBit(8, 0);            // oldVis count
        w.pBit(11, peerIndex);   // newVis add
        w.pBit(5, 3 & 31);       // dx
        w.pBit(5, 2 & 31);       // dz
        w.pBit(1, 1);            // jump
        w.pBit(1, 1);            // has extended info
        w.pBit(11, 2047);        // terminator (required once extended bytes follow)
        w.bitEnd();

        const mask = M_APPEARANCE | M_CHAT | M_SPOTANIM;
        w.p1((mask & 0xff) | M_BIG);
        w.p1(mask >> 8);

        const blob = appearanceBlob(name);
        w.p1(blob.length);
        for (const b of blob) w.p1(b);

        const packed = wordpackEncode(text);
        w.p1(0);                 // colour
        w.p1(0);                 // effect
        w.p1(0);                 // rights
        w.p1(packed.length);
        for (const b of packed) w.p1(b);

        w.p2(spotanimId);        // the SENTINEL
        w.p4(0x00120034);
        return w.take();
    }

    test('a peer add + APPEARANCE + CHAT + SPOTANIM consumes exactly psize', () => {
        const bot = new LeanBot();
        bot.quiet = true;
        const heard: Array<{ sender: string; text: string }> = [];
        // Observe through the PUBLIC surface the bot exposes, not the hook.
        const payload = playerInfoWithChat(300, 'BOT_USER_11', 'ready for the trade', 812);
        const buf = new Packet(new Uint8Array(payload));
        (bot as unknown as { getPlayerPos(b: Packet, s: number): void }).getPlayerPos(buf, payload.length);

        expect(buf.pos).toBe(payload.length);            // getPlayerPos throws on mismatch; belt+braces
        expect(bot.players[300]?.spotanimId).toBe(812);  // the sentinel behind the chat block
        for (const m of bot.getChat()) heard.push({ sender: m.sender, text: m.text });
        expect(heard).toEqual([{ sender: 'Bot User 11', text: wordpackNormalize('ready for the trade') }]);
    });

    test('the sender name comes from the APPEARANCE blob (LeanPlayer.name is always null headless)', () => {
        const bot = new LeanBot();
        bot.quiet = true;
        const payload = playerInfoWithChat(77, 'Knight07', 'banking now', 1);
        const buf = new Packet(new Uint8Array(payload));
        (bot as unknown as { getPlayerPos(b: Packet, s: number): void }).getPlayerPos(buf, payload.length);
        expect(bot.players[77]?.name).toBeNull();                  // the stub never fills this
        expect(bot.getChat()[0]?.sender).toBe('Knight07');         // but the blob does
        expect(bot.getChatFrom('knight').length).toBe(1);          // case-insensitive substring
    });

    test('100 chat-carrying PLAYER_INFOs in a row never drift', () => {
        const bot = new LeanBot();
        bot.quiet = true;
        for (let i = 0; i < 100; i++) {
            const payload = playerInfoWithChat(500 + i, `talker${i}`, `line number ${i}`, 100 + i);
            const buf = new Packet(new Uint8Array(payload));
            (bot as unknown as { getPlayerPos(b: Packet, s: number): void }).getPlayerPos(buf, payload.length);
            expect(buf.pos).toBe(payload.length);
        }
        expect(bot.chatHeard).toBe(100);
        expect(bot.getChat({ limit: 0 }).length).toBe(100);
    });

    test('the SAY mask (0x8, a plain gjstr) still aligns and is observable', () => {
        const bot = new LeanBot();
        bot.quiet = true;
        const said: string[] = [];
        (bot as unknown as { onPlayerSay: (i: number, t: string) => void }).onPlayerSay = (_i, t) => { said.push(t); };
        const text = 'Forced speech';
        const w = new ByteWriter();
        for (let i = 0; i < text.length; i++) w.p1(text.charCodeAt(i));
        w.p1(10);
        w.p4(0xdeadbeef);
        const buf = new Packet(w.take());
        (bot as unknown as {
            getPlayerPosDecodeExtended(p: unknown, i: number, m: number, b: Packet): void;
        }).getPlayerPosDecodeExtended(bot.localPlayer, 2047, M_SAY, buf);
        expect(said).toEqual([text]);
        expect(buf.g4() >>> 0).toBe(0xdeadbeef);
    });
});

// ===========================================================================
// A minimal server->client pipe: enough to drive the REAL run() decode loop
// without a socket. (The full SimHarness would work too, but its action parser
// throws on any opcode it does not know — including the six new ones.)
class TinyStream {
    private q: number[] = [];
    private wake: (() => void) | null = null;
    private idle: Array<() => void> = [];
    private parked = false;
    written: number[] = [];

    push(bytes: Uint8Array): void {
        for (const b of bytes) this.q.push(b);
        const w = this.wake; this.wake = null; w?.();
    }
    async read(): Promise<number> {
        while (this.q.length === 0) {
            this.parked = true;
            for (const w of this.idle.splice(0)) w();
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
    waitIdle(timeoutMs = 5000): Promise<void> {
        if (this.parked && this.q.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('decode loop never parked — ISAAC desync?')), timeoutMs);
            this.idle.push(() => { clearTimeout(t); resolve(); });
        });
    }
}

interface Booted {
    bot: LeanBot;
    stream: TinyStream;
    enc: ServerPacketStream;
    /** Push packets and wait until the decode loop has consumed every byte. */
    step(packets: Uint8Array[]): Promise<void>;
    /** Send LOGOUT and wait for run() to RETURN — the loop never parks again, so `step` cannot be used. */
    logout(): Promise<void>;
}

/** Boot a real LeanBot on a TinyStream, past REBUILD + one PLAYER_INFO teleport. */
async function bootBot(): Promise<Booted> {
    const bot = new LeanBot();
    bot.quiet = true;
    const stream = new TinyStream();
    (bot as unknown as { stream: unknown }).stream = stream;
    bot.inIsaac = new Isaac(new Int32Array(IN_SEED));
    bot.outIsaac = new Isaac(new Int32Array(OUT_SEED));
    bot.loginUser = 'wiretest';
    const enc = new ServerPacketStream(IN_SEED);
    const runPromise = bot.run(Number.MAX_SAFE_INTEGER).catch(() => { /* ends on LOGOUT */ });

    const step = async (packets: Uint8Array[]): Promise<void> => {
        for (const p of packets) stream.push(p);
        await stream.waitIdle();
    };
    const logout = async (): Promise<void> => {
        stream.push(enc.logout());
        await runPromise;
    };
    const x = 3222, z = 3218;
    const zoneX = x >> 3, zoneZ = z >> 3;
    await step([
        enc.rebuildNormal(zoneX, zoneZ),
        enc.playerInfo({ kind: 'teleport', level: 0, localX: x - (zoneX - 6) * 8, localZ: z - (zoneZ - 6) * 8, jump: true }),
    ]);
    return { bot, stream, enc, step, logout };
}

describe('run() decodes the two out-of-view chat packets', () => {
    test('MESSAGE_PUBLIC (255) — the >14-tile global broadcast', async () => {
        const { bot, enc, step } = await bootBot();
        const w = new ByteWriter();
        w.p8(JString.toUserhash('Farmer12'));
        for (const b of wordpackEncode('coins are banked')) w.p1(b);
        await step([enc.frame(ServerProt.MESSAGE_PUBLIC, w.take()), enc.playerInfo({ kind: 'none' })]);

        expect(bot.chatPublicPackets).toBe(1);
        const [msg] = bot.getChat();
        expect(msg?.sender).toBe('Farmer12');
        expect(msg?.text).toBe(wordpackNormalize('coins are banked'));
        expect(msg?.type).toBe(2);
        (bot as unknown as { destroy(): void }).destroy();
    });

    test('MESSAGE_PRIVATE (235) — base37 + messageId + staff level + wordpack', async () => {
        const { bot, enc, step } = await bootBot();
        const w = new ByteWriter();
        w.p8(JString.toUserhash('BOT_USER_11'));
        w.p4(4242);
        w.p1(0);
        for (const b of wordpackEncode('send it over')) w.p1(b);
        await step([enc.frame(ServerProt.MESSAGE_PRIVATE, w.take()), enc.playerInfo({ kind: 'none' })]);

        expect(bot.chatPrivatePackets).toBe(1);
        const [msg] = bot.getChat();
        expect(msg?.sender).toBe('Bot User 11');
        expect(msg?.text).toBe(wordpackNormalize('send it over'));
        expect(msg?.type).toBe(3);
        (bot as unknown as { destroy(): void }).destroy();
    });

    test('a staff PM is type 7, and MESSAGE_GAME lands as type 0', async () => {
        const { bot, enc, step } = await bootBot();
        const w = new ByteWriter();
        w.p8(JString.toUserhash('Modman'));
        w.p4(1);
        w.p1(2);
        for (const b of wordpackEncode('stop that')) w.p1(b);
        await step([
            enc.frame(ServerProt.MESSAGE_PRIVATE, w.take()),
            enc.messageGame('Welcome to RuneScape.'),
            enc.playerInfo({ kind: 'none' }),
        ]);
        expect(bot.getChat()[0]?.type).toBe(7);
        expect(bot.getChat({ types: [0] })[0]?.text).toBe('Welcome to RuneScape.');
        (bot as unknown as { destroy(): void }).destroy();
    });

    test('waitForChat resolves from the decode loop, and LOGOUT settles it instead of stranding it', async () => {
        const { bot, enc, step, logout } = await bootBot();
        const pending = bot.waitForChat({ from: 'Farmer', matching: /banked/i, timeout: 5000 });
        const w = new ByteWriter();
        w.p8(JString.toUserhash('Farmer12'));
        for (const b of wordpackEncode('coins are banked')) w.p1(b);
        await step([enc.frame(ServerProt.MESSAGE_PUBLIC, w.take()), enc.playerInfo({ kind: 'none' })]);
        expect((await pending)?.sender).toBe('Farmer12');

        // ⛔ THE RECONNECT LEAK. Without cancelWaiters on the LOGOUT path this promise would sit for
        // its full 60s on a session that is already gone, holding the event loop with it.
        const stranded = bot.waitForChat({ timeout: 60_000 });
        await logout();
        expect(await stranded).toBeNull();
        expect(bot.chatLog.pendingWaiters).toBe(0);
    });

    test('sendWait parks on the SERVER clock and is released by LOGOUT', async () => {
        const { bot, enc, step, logout } = await bootBot();
        let done = false;
        const waited = bot.sendWait(3).then(() => { done = true; });
        await step([enc.playerInfo({ kind: 'none' })]);
        expect(done).toBe(false);
        await step([enc.playerInfo({ kind: 'none' })]);
        await step([enc.playerInfo({ kind: 'none' })]);
        await waited;
        expect(done).toBe(true);

        let late = false;
        const never = bot.sendWait(1000).then(() => { late = true; });
        await logout();
        await never;
        expect(late).toBe(true);
    });
});

// ===========================================================================
describe('sendSay: the MESSAGE_PUBLIC encoder', () => {
    // ClientGameProt sizes for the opcodes this describe block emits.
    const SIZES: Record<number, number> = { [ClientProt.MESSAGE_PUBLIC]: -1 };

    test('frame is p1Enc(MESSAGE_PUBLIC) p1(size) p1(colour) p1(effect) wordpack(text)', () => {
        const bot = encoderBot();
        const r = bot.sendSay('meet me at the bank', { colour: 3, effect: 1 });
        expect(r.sent).toBe(true);
        const [frame] = readFrames(bot, SIZES);
        expect(frame?.op).toBe(ClientProt.MESSAGE_PUBLIC);
        const packed = wordpackEncode('meet me at the bank');
        expect(frame?.body.length).toBe(2 + packed.length);
        expect(frame?.body[0]).toBe(3);
        expect(frame?.body[1]).toBe(1);
        expect(Array.from(frame!.body.subarray(2))).toEqual(Array.from(packed));
        expect(r.normalized).toBe(wordpackNormalize('meet me at the bank'));
    });

    test('a second line in the SAME tick is refused locally (socialProtect), not silently dropped', () => {
        const bot = encoderBot();
        expect(bot.sendSay('first').sent).toBe(true);
        const second = bot.sendSay('second');
        expect(second.sent).toBe(false);
        expect(second.reason).toContain('socialProtect');
        expect(readFrames(bot, SIZES).length).toBe(1);   // only ONE packet on the wire
    });

    test('an out-of-range colour or effect throws rather than emitting a packet the engine drops', () => {
        const bot = encoderBot();
        expect(() => bot.sendSay('x', { colour: 12 })).toThrow(RangeError);
        expect(() => bot.sendSay('x', { effect: 6 })).toThrow(RangeError);   // rev 289: 0..5 valid
    });

    test('over-long text is truncated at the 80-char wire cap and flagged', () => {
        const bot = encoderBot();
        const r = bot.sendSay('a'.repeat(120));
        expect(r.truncated).toBe(true);
        expect(r.text.length).toBe(MAX_MESSAGE_LENGTH);
    });

    test('say() chunks across ticks, one social packet per tick', async () => {
        const { bot, enc, step } = await bootBot();
        const long = 'the quick brown fox jumps over the lazy dog and then keeps running ' +
            'all the way to the bank booth in ardougne before anyone notices anything at all';
        expect(long.length).toBeGreaterThan(MAX_MESSAGE_LENGTH);

        const sending = bot.say(long);
        // Each chunk needs its own tick; drive enough of them.
        for (let i = 0; i < 6; i++) await step([enc.playerInfo({ kind: 'none' })]);
        const chunks = await sending;

        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
        expect(chunks.join(' ')).toBe(long);
        expect(bot.chatSent).toBe(chunks.length);
        (bot as unknown as { destroy(): void }).destroy();
    });
});

// ===========================================================================
describe('the six new action encoders write the bytes the engine decodes', () => {
    // Sizes from the engine's ClientGameProt table.
    const SIZES: Record<number, number> = { [ClientProt.OPOBJT]: 8, [ClientProt.OPPLAYER2]: 2, [ClientProt.OPPLAYER3]: 2, [ClientProt.OPPLAYER4]: 2, [ClientProt.TUT_CLICKSIDE]: 1, [ClientProt.IDK_SAVEDESIGN]: 13, [ClientProt.IF_BUTTON]: 2 };   // rev 289: enum-keyed
    const g2 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;

    test('OPOBJT (91, size 8): g2 x, g2 z, g2 obj, g2 spellCom', () => {
        const bot = encoderBot();
        bot.opObjT(3200, 3210, 995, 1178);
        const [f] = readFrames(bot, SIZES);
        expect(f?.op).toBe(ClientProt.OPOBJT);
        expect(f?.body.length).toBe(8);
        expect([g2(f!.body, 0), g2(f!.body, 2), g2(f!.body, 4), g2(f!.body, 6)]).toEqual([3200, 3210, 995, 1178]);
    });

    // ⛔ THE OP LABELS ARE CONTENT AND THEY ARE NOT THE INTUITIVE ORDER (login.rs2:18-32):
    // op2 = "Attack" (wilderness only), op3 = "Follow", op4 = "Trade with". Live-caught: a bot
    // sending op2 to follow takes one step and stops, because op2 is a NULL op outside the wilderness.
    test('OPPLAYER2 (166) attack / OPPLAYER3 (196) follow / OPPLAYER4 (98) trade, all p2(index)', () => {
        const bot = encoderBot();
        bot.attackPlayer(42);
        bot.followPlayer(43);
        bot.opPlayer(44, 4);
        const frames = readFrames(bot, SIZES);
        expect(frames.map(f => f.op)).toEqual([ClientProt.OPPLAYER2, ClientProt.OPPLAYER3, ClientProt.OPPLAYER4]);
        expect(frames.map(f => g2(f.body, 0))).toEqual([42, 43, 44]);
    });

    test('TUT_CLICKSIDE (94, size 1) carries the tab and refuses anything outside 0..13', () => {
        const bot = encoderBot();
        expect(bot.sendSetTab(3)).toBe(true);
        expect(bot.sendSetTab(14)).toBe(false);
        expect(bot.sendSetTab(-1)).toBe(false);
        const frames = readFrames(bot, SIZES);
        expect(frames.length).toBe(1);                 // the rejects wrote NOTHING
        expect(frames[0]?.op).toBe(ClientProt.TUT_CLICKSIDE);
        expect(frames[0]?.body[0]).toBe(3);
    });

    test('IDK_SAVEDESIGN (125, size 13): gender + 7 kits + 5 colours', () => {
        const bot = encoderBot();
        expect(bot.sendIdkSaveDesign(0, [0, 10, 18, 26, 33, 36, 42], [1, 2, 3, 4, 5])).toBe(true);
        const [f] = readFrames(bot, SIZES);
        expect(f?.op).toBe(ClientProt.IDK_SAVEDESIGN);
        expect(Array.from(f!.body)).toEqual([0, 0, 10, 18, 26, 33, 36, 42, 1, 2, 3, 4, 5]);
    });

    test('a female design sends 255 for the jaw the engine has no valid kit for', () => {
        const bot = encoderBot();
        expect(bot.sendIdkSaveDesign(1, [45, -1, 56, 61, 67, 70, 79], [0, 0, 0, 0, 0])).toBe(true);
        const [f] = readFrames(bot, SIZES);
        expect(f?.body[2]).toBe(255);   // kit slot 1 (jaw) => -1 on the wire
    });

    test('an invalid design is refused BEFORE a byte is written (the engine would just go silent)', () => {
        const bot = encoderBot();
        expect(bot.sendIdkSaveDesign(2, [0, 10, 18, 26, 33, 36, 42], [0, 0, 0, 0, 0])).toBe(false);  // gender
        expect(bot.sendIdkSaveDesign(0, [9, 10, 18, 26, 33, 36, 42], [0, 0, 0, 0, 0])).toBe(false);  // kit 9 is disabled
        expect(bot.sendIdkSaveDesign(0, [0, 10, 18, 26, 33, 36, 42], [0, 0, 0, 0, 8])).toBe(false);  // colour 8 of 8
        expect(bot.sendIdkSaveDesign(0, [45, 10, 18, 26, 33, 36, 42], [0, 0, 0, 0, 0])).toBe(false); // female hair on a male
        expect(bot.out.pos).toBe(0);
    });

    test('randomizeCharacterDesign always produces a design the engine would ACCEPT', () => {
        for (let i = 0; i < 200; i++) {
            const bot = encoderBot();
            expect(bot.randomizeCharacterDesign()).toBe(true);
            const [f] = readFrames(bot, SIZES);
            expect(f?.op).toBe(ClientProt.IDK_SAVEDESIGN);
            expect(f?.body.length).toBe(13);
            const gender = f!.body[0]!;
            expect(gender === 0 || gender === 1).toBe(true);
            for (let c = 0; c < 5; c++) expect(f!.body[8 + c]!).toBeLessThan([12, 16, 16, 6, 8][c]!);
        }
    });

    test('sendClickInterfaceOption resolves the component from live dialog state', () => {
        const bot = encoderBot();
        expect(bot.sendClickInterfaceOption(0)).toBe(-1);   // nothing open -> nothing sent
        expect(bot.out.pos).toBe(0);
    });
});

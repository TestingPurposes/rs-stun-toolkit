// ============================================================================
// PLAYER CHAT CODEC (headless) — parity package 4/5, PHASE 1 (standalone).
//
// The headless stack can neither SEND nor READ player chat. The browser SDK can
// (sdk/index.ts sendSay/say/getChat/getNewChat/getChatFrom/waitForChat), and the
// browser client behind it does the real work in src/client/Client.ts. This file
// is the wire half of that gap, as a pure, unit-testable module. IT SENDS
// NOTHING and it touches no bot file — an integration agent wires it.
//
// ── WHERE THE TABLE COMES FROM ──────────────────────────────────────────────
// There is NO huffman table in this codebase. 274-era public chat is packed with
// the classic RS2 *WordPack* nibble codec, and there are TWO byte-identical
// copies of its 61-entry table in the tree:
//   * server/webclient/src/wordfilter/WordPack.ts:5   (client, `TABLE`)
//   * server/engine/src/wordenc/WordPack.ts:5         (engine, `CHAR_LOOKUP`)
// They are the same 61 characters in the same order (the two files only differ
// in how the rows are wrapped, and in the unpack char cap: client 100, engine
// 80). WORDPACK_TABLE below is that table, and `chat-codec.test.ts` asserts it
// character-for-character against the client's file at runtime rather than
// trusting this comment.
//
// ── THE CODEC, IN ONE PARAGRAPH ─────────────────────────────────────────────
// Every character becomes an index into the table. Indices 0..12 (space and the
// 12 commonest letters) cost ONE nibble. Indices 13..60 cost TWO nibbles: the
// encoder adds 195 so the value lands in 208..255, whose high nibble is >= 13 —
// which is exactly how the decoder tells a one-nibble char from the first half
// of a two-nibble one. Nibbles are packed high-then-low into bytes; a dangling
// final nibble is flushed as `carry << 4`, whose zero low nibble decodes back as
// index 0 = a SPACE. That trailing space is not a bug in this module, it is what
// the wire does — see `wordpackNormalize`.
//
// ── LOSSY BY DESIGN ─────────────────────────────────────────────────────────
// A WordPack round trip is NOT the identity. It lowercases, replaces every
// character outside the 61-entry table with a space, re-cases the result as a
// sentence (first letter, and the first letter after each '.' or '!'), may append
// one trailing space, and truncates to 80 characters. `wordpackNormalize(text)`
// computes exactly what you will get back, WITHOUT going through the packer — so
// the round-trip tests compare two independent derivations instead of asserting a
// tautology.
// ============================================================================

import Packet from '#/io/Packet.js';
import JString from '#/datastruct/JString.js';
import { ClientProt } from '#/io/ClientProt.js';
import { ServerProt } from '#/io/ServerProt.js';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/**
 * The WordPack character table, verbatim from
 * server/webclient/src/wordfilter/WordPack.ts:5 (identical to the engine's
 * server/engine/src/wordenc/WordPack.ts:5). Index 0..12 pack into one nibble,
 * 13..60 into two. Note index 0 and index 37 are BOTH ' ': the encoder's linear
 * search finds 0 first, so a space always costs one nibble.
 */
// prettier-ignore
export const WORDPACK_TABLE: readonly string[] = [
    ' ', 'e', 't', 'a', 'o', 'i', 'h', 'n', 's', 'r', 'd', 'l', 'u',
    'm', 'w', 'c', 'y', 'f', 'g', 'p', 'b', 'v', 'k', 'x', 'j', 'q', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ' ', '!', '?', '.', ',', ':', ';', '(', ')', '-', '&', '*', '\\', '\'', '@', '#', '+', '=', '£', '$', '%', '"', '[', ']'
];

/** Indices strictly below this cost one nibble; the rest cost two. */
export const WORDPACK_SINGLE_NIBBLE_LIMIT = 13;

/** Bias added to two-nibble indices so their high nibble lands >= 13. */
export const WORDPACK_TWO_NIBBLE_BIAS = 195;

/**
 * Max characters in one public chat message. Server-side truth is
 * `Environment.node.maxMessageLength` (server/engine/src/util/WorldConfig.ts:114,
 * default 80) and `WordPack.pack` hard-truncates at 80 regardless. Note the
 * engine validates the PACKED BYTE length against the same number
 * (MessagePublicHandler.ts:17) — 80 characters can never pack to more than 80
 * bytes (worst case 2 nibbles each), so an 80-char cap is always accepted.
 */
export const MAX_MESSAGE_LENGTH = 80;

/**
 * Characters the client's unpacker will emit before it stops. rev 289:
 * src/wordfilter/WordPack.ts `pos < MAX_CHARS` = 512 (was `pos < 100` @274). The 289 engine's
 * maxMessageLength default is 400 (WorldConfig.ts:114, was 80 @274), so other players' lines CAN
 * be longer than 100 chars now — a 100 cap would silently truncate them.
 * Incoming bytes are decoded the way the CLIENT decodes them, so 512.
 */
export const MAX_DECODED_CHARS = 512;

/** rev 289 WordPack.pack char clamp (`MAX_CHARS`, a safety bound, not the chat cap). */
export const WORDPACK_MAX_CHARS = 512;

/**
 * rev 289 WordPack.pack packed-byte clamp (`MAX_PACKED_BYTES`): a chat frame carries a 1-byte length,
 * so pack() drops trailing characters once the text would exceed 240 packed bytes. Mirrored in
 * wordpackEncode so a long two-nibble-heavy line can never wrap the length byte.
 */
export const WORDPACK_MAX_PACKED_BYTES = 240;

/** ClientProt.MESSAGE_PUBLIC — src/io/ClientProt.ts:93. Variable byte-size. */
export const CLIENT_MESSAGE_PUBLIC: number = ClientProt.MESSAGE_PUBLIC;   // rev 289 = 156 (was 253 @274)

/** ServerProt.MESSAGE_PUBLIC — src/io/ServerProt.ts:49. ServerProtSizes[255] = -1. */
export const SERVER_MESSAGE_PUBLIC: number = ServerProt.MESSAGE_PUBLIC;   // 255 in both 274 and 289

/** ServerProt.MESSAGE_PRIVATE — src/io/ServerProt.ts:48. ServerProtSizes[235] = -1. */
export const SERVER_MESSAGE_PRIVATE: number = ServerProt.MESSAGE_PRIVATE;   // rev 289 = 243 (was 235 @274)

/** Player-update masks that carry text. Mirrors leanclient.ts:93 PlayerUpdate. */
export const PLAYER_MASK_SAY = 0x8;
export const PLAYER_MASK_CHAT = 0x40;

/** Fixed header of the CHAT mask block: colour(1) effect(1) rights(1) length(1). */
export const CHAT_MASK_HEADER_BYTES = 4;

/** Fixed header of a MESSAGE_PUBLIC broadcast body: base37 sender (8 bytes). */
export const MESSAGE_PUBLIC_HEADER_BYTES = 8;

/** Fixed header of a MESSAGE_PRIVATE body: base37(8) + messageId(4) + staff(1). */
export const MESSAGE_PRIVATE_HEADER_BYTES = 13;

/** Valid chat colour range accepted by MessagePublicHandler.ts:17 (else DROPPED). */
export const CHAT_COLOUR_MAX = 11;

/** Valid chat effect range accepted by MessagePublicHandler.ts:17 (else DROPPED). */
export const CHAT_EFFECT_MAX = 5;   // rev 289: wave2/shake/slide added (was 2 @274)

/**
 * Chat type codes that mean "a player said this", matching sdk/types.ts:130
 * PLAYER_CHAT_TYPES so a headless ChatLog filters identically to the SDK.
 * 1 = public w/ crown, 2 = public, 3 = PM received, 6 = PM sent, 7 = PM w/ crown.
 */
export const PLAYER_CHAT_TYPES: readonly number[] = [1, 2, 3, 6, 7];

/** True if a chat type code is player chat (public or private), not system spam. */
export function isPlayerChat(type: number): boolean {
    return PLAYER_CHAT_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// table lookup
// ---------------------------------------------------------------------------

/**
 * Reverse index built once. First-match wins, exactly like the encoder's linear
 * `for (lookupIndex...) if (char === TABLE[lookupIndex]) break;` — which is why
 * ' ' resolves to 0, not to its duplicate at 37.
 */
const CHAR_TO_INDEX: ReadonlyMap<string, number> = (() => {
    const m = new Map<string, number>();
    for (let i = 0; i < WORDPACK_TABLE.length; i++) {
        const ch = WORDPACK_TABLE[i] as string;
        if (!m.has(ch)) m.set(ch, i);
    }
    return m;
})();

/**
 * Table index for one character, after lowercasing. Anything not in the table
 * maps to 0 — NOT because 0 is a sensible fallback, but because the client's
 * encoder initialises `currentChar = 0` and never finds a match, so index 0
 * (a space) is literally what the real client transmits for an unknown glyph.
 */
export function wordpackIndexOf(char: string): number {
    return CHAR_TO_INDEX.get(char.toLowerCase()) ?? 0;
}

/** Nibbles one character costs on the wire: 1 for indices 0..12, else 2. */
export function wordpackNibbleCost(char: string): number {
    return wordpackIndexOf(char) < WORDPACK_SINGLE_NIBBLE_LIMIT ? 1 : 2;
}

// ---------------------------------------------------------------------------
// ENCODE
// ---------------------------------------------------------------------------

/**
 * Pack text into WordPack bytes. Port of `WordPack.pack`
 * (src/wordfilter/WordPack.ts:53) with the same 80-char truncation and the same
 * trailing `carry << 4` flush.
 *
 * @param text     Text to pack. Lowercased; characters outside the table become spaces.
 * @param maxChars Character cap before packing (default 80, the wire limit).
 * @returns The packed bytes. Length is `ceil(totalNibbles / 2)`, always <= maxChars.
 */
export function wordpackEncode(text: string, maxChars: number = MAX_MESSAGE_LENGTH): Uint8Array {
    let input = (text.length > maxChars ? text.substring(0, maxChars) : text).toLowerCase();
    // rev 289 WordPack.truncateToByteBudget: never exceed WORDPACK_MAX_PACKED_BYTES packed bytes.
    let budget = 0;
    for (let i = 0; i < input.length; i++) {
        budget += wordpackIndexOf(input.charAt(i)) > WORDPACK_SINGLE_NIBBLE_LIMIT - 1 ? 2 : 1;
        if (budget > WORDPACK_MAX_PACKED_BYTES * 2) { input = input.substring(0, i); break; }
    }

    const out: number[] = [];
    let carry = -1;

    for (let i = 0; i < input.length; i++) {
        let index = wordpackIndexOf(input.charAt(i));
        if (index > WORDPACK_SINGLE_NIBBLE_LIMIT - 1) {
            index += WORDPACK_TWO_NIBBLE_BIAS;
        }

        if (carry === -1) {
            if (index < WORDPACK_SINGLE_NIBBLE_LIMIT) {
                carry = index;
            } else {
                out.push(index);
            }
        } else if (index < WORDPACK_SINGLE_NIBBLE_LIMIT) {
            out.push((carry << 4) + index);
            carry = -1;
        } else {
            out.push((carry << 4) + (index >> 4));
            carry = index & 0xf;
        }
    }

    if (carry !== -1) {
        out.push(carry << 4);
    }

    return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// DECODE
// ---------------------------------------------------------------------------

/**
 * Unpack WordPack bytes back to text, including the sentence-casing pass. Port
 * of `WordPack.unpack` (src/wordfilter/WordPack.ts:14).
 *
 * Pure: takes bytes, moves no cursor. Use {@link unpackFromPacket} when reading
 * out of a live `Packet` — it is the alignment-safe wrapper.
 *
 * @param bytes    The packed body.
 * @param maxChars Stop after this many characters (default 100 = the client's cap).
 */
export function wordpackDecode(bytes: Uint8Array, maxChars: number = MAX_DECODED_CHARS): string {
    const chars: string[] = [];
    let pos = 0;
    let carry = -1;

    for (let i = 0; i < bytes.length && pos < maxChars; i++) {
        const value = bytes[i] as number;

        let nibble = (value >> 4) & 0xf;
        if (carry !== -1) {
            chars[pos++] = WORDPACK_TABLE[(carry << 4) + nibble - WORDPACK_TWO_NIBBLE_BIAS] as string;
            carry = -1;
        } else if (nibble < WORDPACK_SINGLE_NIBBLE_LIMIT) {
            chars[pos++] = WORDPACK_TABLE[nibble] as string;
        } else {
            carry = nibble;
        }

        nibble = value & 0xf;
        if (carry !== -1) {
            chars[pos++] = WORDPACK_TABLE[(carry << 4) + nibble - WORDPACK_TWO_NIBBLE_BIAS] as string;
            carry = -1;
        } else if (nibble < WORDPACK_SINGLE_NIBBLE_LIMIT) {
            chars[pos++] = WORDPACK_TABLE[nibble] as string;
        } else {
            carry = nibble;
        }
    }

    return sentenceCase(chars.slice(0, pos));
}

/**
 * Sentence-case a decoded character array in place-equivalent fashion: upper the
 * first a-z, and the first a-z after every '.' or '!'. Same loop as the client's
 * unpack tail and as JString.toSentenceCase (src/datastruct/JString.ts:57),
 * except the client does NOT re-lowercase first (the decoded chars are already
 * lowercase by construction).
 */
function sentenceCase(chars: string[]): string {
    let uppercase = true;
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i] as string;
        if (uppercase && ch >= 'a' && ch <= 'z') {
            chars[i] = ch.toUpperCase();
            uppercase = false;
        }
        if (ch === '.' || ch === '!') {
            uppercase = true;
        }
    }
    return chars.join('');
}

/**
 * ⭐ THE ALIGNMENT-SAFE READ. Decode `length` bytes of WordPack starting at
 * `buf.pos` and leave the cursor at EXACTLY `start + length`, whatever the body
 * contained.
 *
 * Why this exists rather than "just call wordpackDecode(buf.gdata(...))": the
 * unpacker stops early once it has produced 100 characters, so a decode that
 * advanced the cursor itself would stop short on a long body and desync every
 * subsequent field in the packet. The real client has the same hazard and solves
 * it the same way — it ends its CHAT block with a flat `buf.pos = start + length`
 * (Client.ts:10102). This function never reads through the cursor at all: it
 * decodes a subarray view and then assigns the cursor. Malformed input cannot
 * misalign it.
 */
export function unpackFromPacket(buf: Packet, length: number, maxChars: number = MAX_DECODED_CHARS): string {
    const start = buf.pos;
    const end = start + length;
    const body = buf.data.subarray(start, end);
    let text: string;
    try {
        text = wordpackDecode(body, maxChars);
    } catch {
        text = '';
    }
    buf.pos = end;
    return text;
}

/**
 * What the wire will hand back for `text`, derived WITHOUT packing anything.
 *
 * Independent derivation of the same lossy transform: truncate -> lowercase ->
 * map unknown glyphs to ' ' -> append one ' ' if the total nibble count is odd
 * (the `carry << 4` flush) -> clamp to the decoder's character cap -> sentence
 * case. Round-trip tests compare `wordpackDecode(wordpackEncode(t))` against
 * this, so a shared bug in pack/unpack cannot hide behind a symmetric mistake.
 *
 * Also useful live: compare what you said to what came back to detect the server
 * word filter having rewritten you.
 */
export function wordpackNormalize(
    text: string,
    maxChars: number = MAX_MESSAGE_LENGTH,
    decodeCap: number = MAX_DECODED_CHARS
): string {
    let input = (text.length > maxChars ? text.substring(0, maxChars) : text).toLowerCase();
    // rev 289 WordPack.truncateToByteBudget: never exceed WORDPACK_MAX_PACKED_BYTES packed bytes.
    let budget = 0;
    for (let i = 0; i < input.length; i++) {
        budget += wordpackIndexOf(input.charAt(i)) > WORDPACK_SINGLE_NIBBLE_LIMIT - 1 ? 2 : 1;
        if (budget > WORDPACK_MAX_PACKED_BYTES * 2) { input = input.substring(0, i); break; }
    }

    const chars: string[] = [];
    let nibbles = 0;
    for (let i = 0; i < input.length; i++) {
        const index = wordpackIndexOf(input.charAt(i));
        chars.push(WORDPACK_TABLE[index] as string);
        nibbles += index < WORDPACK_SINGLE_NIBBLE_LIMIT ? 1 : 2;
    }
    if (nibbles % 2 === 1) {
        chars.push(' '); // the dangling-nibble flush decodes as index 0
    }

    return sentenceCase(chars.slice(0, decodeCap));
}

// ---------------------------------------------------------------------------
// OUTGOING: MESSAGE_PUBLIC
// ---------------------------------------------------------------------------

export interface MessagePublicOptions {
    /** 0..11. Anything else makes the engine DROP the packet (MessagePublicHandler.ts:17). */
    colour?: number;
    /** rev 289: 0..5 (0 none, 1 wave, 2 wave2, 3 shake, 4 scroll, 5 slide). Out of range = packet DROPPED. */
    effect?: number;
    /** Character cap applied before packing (default 80). */
    maxChars?: number;
}

export interface MessagePublicPayload {
    /** `colour, effect, ...packed` — the bytes the length prefix counts. */
    bytes: Uint8Array;
    /** The text actually packed (post-truncation). */
    text: string;
    /** What the world will hear back — {@link wordpackNormalize} of `text`. */
    normalized: string;
    /** True if the input was longer than the cap and got clipped. */
    truncated: boolean;
    colour: number;
    effect: number;
}

function validateColourEffect(colour: number, effect: number): void {
    if (!Number.isInteger(colour) || colour < 0 || colour > CHAT_COLOUR_MAX) {
        throw new RangeError(`chat colour must be an integer 0..${CHAT_COLOUR_MAX} (got ${colour}); the engine silently DROPS anything else`);
    }
    if (!Number.isInteger(effect) || effect < 0 || effect > CHAT_EFFECT_MAX) {
        throw new RangeError(`chat effect must be an integer 0..${CHAT_EFFECT_MAX} (got ${effect}); the engine silently DROPS anything else`);
    }
}

/**
 * Build the BODY of an outgoing MESSAGE_PUBLIC: `p1(colour) p1(effect)` followed
 * by the packed text. This is precisely what the length prefix must count, and
 * precisely what `MessagePublicDecoder.decode` reads back
 * (server/engine/src/network/game/client/codec/MessagePublicDecoder.ts:10 —
 * colour = g1, effect = g1, input = the remaining `length - 2` bytes).
 *
 * Pure. Sends nothing, allocates nothing shared.
 */
export function buildMessagePublicPayload(text: string, opts: MessagePublicOptions = {}): MessagePublicPayload {
    const colour = opts.colour ?? 0;
    const effect = opts.effect ?? 0;
    const maxChars = opts.maxChars ?? MAX_MESSAGE_LENGTH;
    validateColourEffect(colour, effect);

    const truncated = text.length > maxChars;
    const clipped = truncated ? text.substring(0, maxChars) : text;
    const packed = wordpackEncode(clipped, maxChars);

    const bytes = new Uint8Array(2 + packed.length);
    bytes[0] = colour;
    bytes[1] = effect;
    bytes.set(packed, 2);

    return { bytes, text: clipped, normalized: wordpackNormalize(clipped, maxChars), truncated, colour, effect };
}

export interface MessagePublicFrame extends MessagePublicPayload {
    /** `opcodeByte, size, colour, effect, ...packed` — the complete wire frame. */
    frame: Uint8Array;
    /** The value written in the size byte (= payload length = 2 + packed length). */
    size: number;
}

/**
 * Build a COMPLETE outgoing MESSAGE_PUBLIC frame as bytes.
 *
 * Layout, matching Client.ts:1809 and Client.ts:5261 exactly:
 *   p1Enc(ClientProt.MESSAGE_PUBLIC) | p1(size) | p1(colour) | p1(effect) | wordpack(text)
 * ServerProt-side the opcode is variable BYTE size, so `size` is one byte and
 * counts everything after it.
 *
 * @param opcodeByte The FIRST byte to emit. Defaults to the raw opcode 253, which
 *   is only correct on a connection with no outbound ISAAC. On a live socket the
 *   opcode is ISAAC-encrypted: pass `(253 + isaac.nextInt) & 0xff` — but read the
 *   warning on {@link writeMessagePublic} first, because pulling `nextInt` has a
 *   side effect on the cipher stream and MUST happen exactly once per packet.
 */
export function buildMessagePublicFrame(
    text: string,
    opts: MessagePublicOptions & { opcodeByte?: number } = {}
): MessagePublicFrame {
    const payload = buildMessagePublicPayload(text, opts);
    const size = payload.bytes.length;
    const frame = new Uint8Array(2 + size);
    frame[0] = (opts.opcodeByte ?? CLIENT_MESSAGE_PUBLIC) & 0xff;
    frame[1] = size;
    frame.set(payload.bytes, 2);
    return { ...payload, frame, size };
}

/**
 * Convenience: write one MESSAGE_PUBLIC into an outgoing `Packet` buffer. This
 * WRITES TO A BUFFER — it does not touch a socket; the bot's own `flush()` sends.
 *
 * ⚠ `p1Enc` consumes exactly one `isaac.nextInt`. Call this ONCE per message you
 * intend to send, never speculatively, or every subsequent outgoing opcode is
 * encrypted with the wrong keystream and the server drops the connection.
 *
 * ⚠ The engine accepts ONE social packet per tick: MessagePublicHandler sets
 * `player.socialProtect = true` and only `Player.ts:482` (the per-tick reset)
 * clears it. A second MESSAGE_PUBLIC in the same tick is discarded with no reply.
 * That is why the SDK's `say()` waits a tick between chunks.
 */
export function writeMessagePublic(out: Packet, text: string, opts: MessagePublicOptions = {}): MessagePublicPayload {
    const payload = buildMessagePublicPayload(text, opts);
    out.p1Enc(CLIENT_MESSAGE_PUBLIC);
    out.p1(payload.bytes.length);
    out.pdata(payload.bytes, 0, payload.bytes.length);
    return payload;
}

/**
 * Split text into <= maxLen chunks on word boundaries; words longer than maxLen
 * are hard-split so nothing is dropped. Behaviour-for-behaviour copy of the
 * SDK's private `chunkMessage` (sdk/index.ts:74) so headless `say()` chunks
 * identically to the browser SDK — including the two quirks worth knowing:
 * runs of whitespace collapse to single spaces (`split(/\s+/)`), and an
 * all-whitespace or empty input returns `[]` (nothing is sent at all).
 */
export function chunkMessage(text: string, maxLen: number = MAX_MESSAGE_LENGTH): string[] {
    const chunks: string[] = [];
    let current = '';
    for (const word of text.trim().split(/\s+/)) {
        if (word.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = '';
            }
            for (let i = 0; i < word.length; i += maxLen) {
                chunks.push(word.slice(i, i + maxLen));
            }
            continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxLen) {
            if (current) chunks.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

// ---------------------------------------------------------------------------
// INCOMING: decoders
// ---------------------------------------------------------------------------

/** Decoded player-update CHAT (0x40) block. */
export interface ChatMaskUpdate {
    colour: number;
    effect: number;
    /** Sender's chat rights: min(staffModLevel, 2). 0 = ordinary player. */
    rights: number;
    /** Packed body length in bytes — the number the cursor must advance by. */
    length: number;
    text: string;
    /** SDK chat type code: 1 when the sender has a crown, else 2. */
    type: number;
}

/**
 * SDK chat type for an overhead public message, from the sender's `rights` byte.
 * Client.ts:10090 routes rights 1/2/3 to `addChat(1, ...)` (crowned) and
 * everything else to `addChat(2, ...)`.
 */
export function publicChatType(rights: number): number {
    return rights >= 1 ? 1 : 2;
}

/**
 * SDK chat type for an incoming private message, from its staff mod level.
 * Client.ts:8662 routes 1/2/3 to `addChat(7, ...)` and 0 to `addChat(3, ...)`.
 */
export function privateChatType(staffModLevel: number): number {
    return staffModLevel >= 1 ? 7 : 3;
}

/**
 * Decode the player-update CHAT (0x40) block, cursor-exact.
 *
 * Reads `g2 colourEffect | g1 rights | g1 length | <length> packed bytes`, which
 * is byte-for-byte the engine's writer (server/engine/src/network/rsbuf/
 * messages.ts:130 — `p1(color) p1(effect) p1(ignored) p1(len) pdata(bytes)`;
 * the client folds the first two into one g2).
 *
 * ⭐ ALIGNMENT: on return `buf.pos === entryPos + 4 + length`, unconditionally —
 * IDENTICAL to the cursor-jump this replaces. See the module header of
 * chat-codec.test.ts for the crafted-packet proof.
 */
export function decodeChatMask(buf: Packet, maxChars: number = MAX_DECODED_CHARS): ChatMaskUpdate {
    const colourEffect = buf.g2();
    const rights = buf.g1();
    const length = buf.g1();
    const text = unpackFromPacket(buf, length, maxChars);
    return {
        colour: colourEffect >> 8,
        effect: colourEffect & 0xff,
        rights,
        length,
        text,
        type: publicChatType(rights)
    };
}

/**
 * Decode the player-update SAY (0x8) block: a plain newline-terminated string,
 * NOT WordPack (Client.ts:10036). Included so a wiring site has one obvious place
 * to call for either text mask. Advances the cursor past the string exactly as
 * `gjstr` does.
 */
export function decodeSayMask(buf: Packet): string {
    return buf.gjstr();
}

/** Decoded out-of-visual-range public broadcast (ServerProt 255). */
export interface MessagePublicBroadcast {
    /** Display name, base37-decoded and screen-cased. */
    sender: string;
    /** Raw base37 username hash, for ignore-list style comparisons. */
    from: bigint;
    text: string;
    /** SDK chat type code: always 2 (Client.ts:8623 uses `addChat(2, ...)`). */
    type: number;
}

/**
 * Decode ServerProt.MESSAGE_PUBLIC (255, variable byte size) — the engine's
 * global broadcast to players OUTSIDE the 14-tile overhead bubble
 * (MessagePublicHandler.ts, the `World.playerLoop.all()` fan-out).
 *
 * Body: `g8 base37 sender | wordpack(psize - 8)`.
 * Mirrors Client.ts:8606. Cursor ends at exactly `psize`.
 */
export function decodeMessagePublic(buf: Packet, psize: number, maxChars: number = MAX_DECODED_CHARS): MessagePublicBroadcast {
    const from = buf.g8();
    const text = unpackFromPacket(buf, psize - MESSAGE_PUBLIC_HEADER_BYTES, maxChars);
    return { sender: JString.toScreenName(JString.toRawUsername(from)), from, text, type: 2 };
}

/** Decoded private message (ServerProt 235). */
export interface MessagePrivateIn {
    sender: string;
    from: bigint;
    /** Server-assigned id; the client dedupes on a 100-deep ring of these. */
    messageId: number;
    staffModLevel: number;
    text: string;
    /** SDK chat type code: 3 normally, 7 from a crowned account. */
    type: number;
}

/**
 * Decode ServerProt.MESSAGE_PRIVATE (235, variable byte size).
 *
 * Body: `g8 base37 sender | g4 messageId | g1 staffModLevel | wordpack(psize - 13)`.
 * Mirrors Client.ts:8632 and the engine's MessagePrivateEncoder. Cursor ends at
 * exactly `psize`.
 */
export function decodeMessagePrivate(buf: Packet, psize: number, maxChars: number = MAX_DECODED_CHARS): MessagePrivateIn {
    const from = buf.g8();
    const messageId = buf.g4();
    const staffModLevel = buf.g1();
    const text = unpackFromPacket(buf, psize - MESSAGE_PRIVATE_HEADER_BYTES, maxChars);
    return {
        sender: JString.toScreenName(JString.toRawUsername(from)),
        from,
        messageId,
        staffModLevel,
        text,
        type: privateChatType(staffModLevel)
    };
}

// ---------------------------------------------------------------------------
// sender name for the CHAT / SAY masks
// ---------------------------------------------------------------------------

/**
 * ⭐ WITHOUT THIS, AN OVERHEAD MESSAGE HAS NO SENDER.
 *
 * `MESSAGE_PUBLIC` and `MESSAGE_PRIVATE` carry a base37 name in the packet, but
 * the player-update CHAT/SAY masks do NOT — the real client resolves the name
 * from the cached APPEARANCE blob (`player.name`), and headless stubs appearance
 * parsing out entirely (leanclient.ts:252, `setAppearance` only sets `ready`).
 * The BYTES are kept though (`playerAppearanceBuffer[index]`, leanclient.ts:945),
 * so the name is right there, unparsed.
 *
 * Layout, from `Player.generateAppearance`
 * (server/engine/src/engine/entity/Player.ts:1359):
 *     gender(1) headicons(1) 12 slots (1 byte when 0, else 2)
 *     5 colours(1 each) 7 anims(2 each) username37(8) combatLevel(1) skillLevel(2)
 * — the same walk `wornObjInAppearance` (outfitter.ts:193) already does for the
 * weapon slot, continued 19 bytes further.
 *
 * @returns The screen name, or null when the blob is truncated, absent, or a
 *   transmog (slot 0 == 65535, after which an npc id replaces the normal layout).
 *   ⛔ null means UNKNOWN. Never render it as a name.
 */
export function appearanceName(bytes: Uint8Array | null | undefined): string | null {
    if (!bytes || bytes.length < 3) return null;

    let pos = 2; // gender, headicons
    for (let part = 0; part < 12; part++) {
        if (pos >= bytes.length) return null;
        const msb = bytes[pos++] as number;
        if (msb !== 0) {
            if (pos >= bytes.length) return null;
            const v = (msb << 8) + (bytes[pos++] as number);
            if (part === 0 && v === 65535) return null; // transmog: layout diverges
        }
    }

    pos += 5 + 7 * 2; // 5 colours, 7 two-byte anims
    if (pos + 8 > bytes.length) return null;

    let hash = 0n;
    for (let i = 0; i < 8; i++) {
        hash = (hash << 8n) | BigInt(bytes[pos + i] as number);
    }

    const raw = JString.toRawUsername(hash);
    return raw === 'invalid_name' ? null : JString.toScreenName(raw);
}

// ---------------------------------------------------------------------------
// ChatLog — bounded ring + SDK-shaped read API
// ---------------------------------------------------------------------------

/**
 * One recorded chat line. Structurally identical to the SDK's `GameMessage`
 * (sdk/types.ts:118) on purpose: a headless bot's chat should be readable with
 * the same code an agent already writes against the browser SDK.
 */
export interface ChatMessage {
    /** 0 = system/game, 1 = public (crowned), 2 = public, 3 = PM in, 6 = PM out, 7 = PM (crowned). */
    type: number;
    text: string;
    /** Sender display name; '' for system messages. */
    sender: string;
    /** Game tick the line was recorded on (the bot's own tickCount). */
    tick: number;
    /** True when this bot produced the line (its own speech / sent PM). */
    fromSelf: boolean;
}

export interface ChatQuery {
    limit?: number;
    types?: readonly number[];
    includeSelf?: boolean;
}

export interface ChatWait {
    /** Case-insensitive substring match on the sender name. */
    from?: string;
    /** Pattern the text must match; a string is compiled case-insensitively. */
    matching?: RegExp | string;
    types?: readonly number[];
    includeSelf?: boolean;
    /** Ms before resolving null. Default 30000. */
    timeout?: number;
}

/** Default retention, matching the SDK's CHAT_HISTORY_LIMIT (sdk/chat-history.ts:21). */
export const CHAT_LOG_LIMIT = 500;

interface Waiter {
    accepts: (m: ChatMessage) => boolean;
    resolve: (m: ChatMessage | null) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Bounded chat ring with the SDK's read API.
 *
 * Deliberately NOT the SDK's `ChatHistory`: that class de-duplicates overlapping
 * *snapshots* pushed over a websocket, because the browser page can only show
 * the SDK the last 50 lines of a 100-deep ring. Headless decodes each packet
 * once, in order, so there is nothing to de-duplicate — the merge logic would be
 * pure risk. What is kept is the read surface (`getChat` / `getNewChat` /
 * `getChatFrom` / `waitForChat`), the 500-message retention, the type filters and
 * the monotonic `seen` cursor, so agent-facing behaviour is unchanged.
 *
 * `waitForChat` is event-driven (resolved from `record`), never polled, so it
 * cannot miss a message that arrives between polls.
 *
 * ⚠ Its timeout timer is deliberately NOT `unref`'d. That was the first version,
 * and on Bun 1.3.9 an `unref`'d `setTimeout` inside `bun test` never fires: the
 * promise never settles and the whole test runner hangs with no output. So a
 * pending waiter holds the event loop for at most its `timeout` — which is why
 * {@link cancelWaiters} exists and why a supervisor should call it on disconnect.
 */
export class ChatLog {
    private readonly messages: ChatMessage[] = [];
    private readonly limit: number;
    private totalRecorded = 0;
    private readCursor = 0;
    private readonly waiters = new Set<Waiter>();

    constructor(limit: number = CHAT_LOG_LIMIT) {
        this.limit = Math.max(1, limit);
    }

    /** Total lines ever recorded (monotonic; unaffected by trimming). Cursor for {@link since}. */
    get seen(): number {
        return this.totalRecorded;
    }

    /** Lines currently retained. */
    get size(): number {
        return this.messages.length;
    }

    /** Record one decoded line, oldest-first, and wake any matching waiter. */
    record(message: ChatMessage): void {
        this.messages.push(message);
        this.totalRecorded++;
        if (this.messages.length > this.limit) {
            this.messages.splice(0, this.messages.length - this.limit);
        }
        if (this.waiters.size > 0) {
            for (const w of [...this.waiters]) {
                if (w.accepts(message)) {
                    this.waiters.delete(w);
                    clearTimeout(w.timer);
                    w.resolve(message);
                }
            }
        }
    }

    /** All retained lines, oldest first. */
    all(): readonly ChatMessage[] {
        return this.messages;
    }

    /** Lines recorded after a cursor previously read from {@link seen}, oldest first. */
    since(cursor: number): ChatMessage[] {
        const missed = this.totalRecorded - cursor;
        if (missed <= 0) return [];
        return this.messages.slice(Math.max(0, this.messages.length - missed));
    }

    /**
     * Recent player chat, newest last. Default filters match the SDK: player chat
     * types only, own messages excluded, 20 lines. `limit: 0` returns everything.
     */
    getChat(opts: ChatQuery = {}): ChatMessage[] {
        const { limit = 20, types = PLAYER_CHAT_TYPES, includeSelf = false } = opts;
        const typeSet = new Set(types);
        const filtered = this.messages.filter(m => typeSet.has(m.type) && (includeSelf || !m.fromSelf));
        return limit > 0 ? filtered.slice(-limit) : filtered;
    }

    /**
     * Only what has arrived since the previous call (cursor-based). The cursor
     * advances past EVERYTHING recorded, system lines included, so a later call
     * cannot re-surface a line that was merely filtered out — same semantics as
     * sdk/index.ts:598.
     */
    getNewChat(opts: Omit<ChatQuery, 'limit'> = {}): ChatMessage[] {
        const { types = PLAYER_CHAT_TYPES, includeSelf = false } = opts;
        const typeSet = new Set(types);
        const prev = this.readCursor;
        this.readCursor = this.totalRecorded;
        return this.since(prev).filter(m => typeSet.has(m.type) && (includeSelf || !m.fromSelf));
    }

    /** Recent lines from a sender (case-insensitive substring), newest last. */
    getChatFrom(name: string, opts: { limit?: number } = {}): ChatMessage[] {
        const { limit = 20 } = opts;
        const needle = name.toLowerCase();
        const filtered = this.messages.filter(m => m.sender !== '' && m.sender.toLowerCase().includes(needle));
        return limit > 0 ? filtered.slice(-limit) : filtered;
    }

    /**
     * Wait for the NEXT matching line (lines already in the ring do not count).
     * Resolves null on timeout. Never polls: {@link record} resolves it directly.
     */
    waitForChat(opts: ChatWait = {}): Promise<ChatMessage | null> {
        const { from, matching, types = PLAYER_CHAT_TYPES, includeSelf = false, timeout = 30000 } = opts;
        const typeSet = new Set(types);
        const needle = from?.toLowerCase();
        const pattern = typeof matching === 'string' ? new RegExp(matching, 'i') : matching;
        const accepts = (m: ChatMessage): boolean =>
            typeSet.has(m.type) &&
            (includeSelf || !m.fromSelf) &&
            (!needle || m.sender.toLowerCase().includes(needle)) &&
            (!pattern || pattern.test(m.text));

        return new Promise<ChatMessage | null>(resolve => {
            const waiter: Waiter = {
                accepts,
                resolve,
                timer: setTimeout(() => {
                    this.waiters.delete(waiter);
                    resolve(null);
                }, timeout)
            };
            this.waiters.add(waiter);
        });
    }

    /** Drop every pending waiter (resolving null). Call on disconnect/reconnect. */
    cancelWaiters(): void {
        for (const w of [...this.waiters]) {
            this.waiters.delete(w);
            clearTimeout(w.timer);
            w.resolve(null);
        }
    }

    /** Pending {@link waitForChat} calls — a leak check for long-lived bots. */
    get pendingWaiters(): number {
        return this.waiters.size;
    }
}

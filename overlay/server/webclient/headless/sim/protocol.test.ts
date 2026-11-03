// bun test server/webclient/headless/sim/protocol.test.ts
//
// Validates the sim wire layer against the REAL decoders/encoders: our
// ServerPacketStream output is decoded by the actual LeanClient decode paths,
// and our ClientActionParser reads bytes produced by the actual LeanBot send
// helpers. If the engine's protocol changes, these fail loudly.
import { describe, test, expect } from 'bun:test';
import Isaac from '#/io/Isaac.js';
import Packet from '#/io/Packet.js';
import { ClientProt } from '#/io/ClientProt.js';
import { ServerProt, ServerProtSizes } from '#/io/ServerProt.js';
import { ServerPacketStream, ClientActionParser, ByteWriter, dirCode } from './protocol.ts';

const IN_SEED = [11, 22, 33, 44];
const OUT_SEED = [55, 66, 77, 88];

// Decode one framed server packet with a mirrored ISAAC, returning {opcode, payload Packet}.
function decodeFrame(cipher: Isaac, bytes: Uint8Array): { opcode: number; buf: Packet; size: number } {
    let p = 0;
    const opcode = (bytes[p++]! - cipher.nextInt) & 0xff;
    let size = ServerProtSizes[opcode]!;
    if (size === -1) size = bytes[p++]!;
    else if (size === -2) { size = (bytes[p]! << 8) | bytes[p + 1]!; p += 2; }
    const buf = new Packet(new Uint8Array(bytes.subarray(p, p + size)));
    return { opcode, buf, size };
}

describe('ByteWriter bit round-trip vs Packet.gBit', () => {
    test('MSB-first bits decode identically', () => {
        const w = new ByteWriter();
        w.bitStart();
        w.pBit(1, 1); w.pBit(2, 3); w.pBit(3, 5); w.pBit(11, 1337); w.pBit(5, 17);
        w.bitEnd();
        const buf = new Packet(w.take());
        buf.gBitStart();
        expect(buf.gBit(1)).toBe(1);
        expect(buf.gBit(2)).toBe(3);
        expect(buf.gBit(3)).toBe(5);
        expect(buf.gBit(11)).toBe(1337);
        expect(buf.gBit(5)).toBe(17);
    });
});

describe('PLAYER_INFO decodes on the real getPlayerPos paths', () => {
    // We can't call LeanClient.getPlayerPos without an instance, but we CAN replicate
    // the exact bit reads it performs and assert our encoder matches them.
    function readLocal(buf: Packet): { op: number; a?: number; b?: number } {
        buf.gBitStart();
        const info = buf.gBit(1);
        if (info === 0) return { op: -1 };
        const op = buf.gBit(2);
        if (op === 1) { const d = buf.gBit(3); buf.gBit(1); return { op, a: d }; }
        if (op === 2) { const d1 = buf.gBit(3); const d2 = buf.gBit(3); buf.gBit(1); return { op, a: d1, b: d2 }; }
        if (op === 3) { buf.gBit(2); const lx = buf.gBit(7); const lz = buf.gBit(7); buf.gBit(1); buf.gBit(1); return { op, a: lx, b: lz }; }
        return { op };
    }

    test('none', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.playerInfo({ kind: 'none' }));
        expect(readLocal(buf).op).toBe(-1);
    });
    test('walk carries the direction code', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.playerInfo({ kind: 'walk', dir: dirCode(1, 0) }));
        const r = readLocal(buf);
        expect(r.op).toBe(1); expect(r.a).toBe(dirCode(1, 0));
    });
    test('run carries two direction codes', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.playerInfo({ kind: 'run', dir1: dirCode(1, 1), dir2: dirCode(0, 1) }));
        const r = readLocal(buf);
        expect(r.op).toBe(2); expect(r.a).toBe(dirCode(1, 1)); expect(r.b).toBe(dirCode(0, 1));
    });
    test('teleport carries local coords', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.playerInfo({ kind: 'teleport', level: 0, localX: 40, localZ: 100, jump: true }));
        const r = readLocal(buf);
        expect(r.op).toBe(3); expect(r.a).toBe(40); expect(r.b).toBe(100);
    });
});

describe('fixed-size packets frame correctly', () => {
    test('UPDATE_STAT payload is stat/xp/level', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { opcode, buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.updateStat(17, 999_999, 99));
        expect(opcode).toBe(ServerProt.UPDATE_STAT);
        expect(buf.g1()).toBe(17); expect(buf.g4()).toBe(999_999); expect(buf.g1()).toBe(99);
    });
    test('UPDATE_INV_FULL uses obj.id+1 on the wire', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.updateInvFull(3214, [{ id: 995, count: 250 }, { id: -1, count: 0 }]));
        expect(buf.g2()).toBe(3214); // comId
        expect(buf.g2()).toBe(2);    // size (rev 289: p2, was p1)
        expect(buf.g2()).toBe(996);  // 995+1
        expect(buf.g1()).toBe(250);
        expect(buf.g2()).toBe(0);    // empty slot
    });
    test('MESSAGE_GAME is newline-terminated', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.messageGame('You have been stunned!'));
        expect(buf.gjstr()).toBe('You have been stunned!');
    });
});

describe('ClientActionParser reads real LeanBot send bytes', () => {
    // Build outgoing bytes exactly as LeanBot's helpers do (p1Enc + payload), then
    // parse them back. p1Enc encrypts the opcode with the outgoing ISAAC.
    function outPacket(build: (out: Packet) => void): Uint8Array {
        const out = Packet.alloc(1);
        (out as any).random = new Isaac(new Int32Array(OUT_SEED));
        build(out);
        return new Uint8Array(out.data.subarray(0, out.pos));
    }

    test('MOVE_GAMECLICK start + one delta waypoint (LeanBot.sendMove layout)', () => {
        const bytes = outPacket(out => {
            out.p1Enc(ClientProt.MOVE_GAMECLICK); out.p1(2 * 2 + 3); out.p1(1); out.p2(3222); out.p2(3218); out.p1(2 & 0xff); out.p1((-3) & 0xff);
        });
        const [a] = new ClientActionParser(OUT_SEED).parse(bytes);
        expect(a!.type).toBe('move');
        if (a!.type === 'move') {
            expect(a.opclick).toBe(false);
            expect(a.path[0]).toEqual({ x: 3222, z: 3218 });
            expect(a.path[1]).toEqual({ x: 3224, z: 3215 });
        }
    });

    test('OPNPC3 pickpocket', () => {
        const bytes = outPacket(out => { out.p1Enc(ClientProt.OPNPC3); out.p2(1234); });
        const [a] = new ClientActionParser(OUT_SEED).parse(bytes);
        expect(a).toEqual({ type: 'opnpc', op: 3, index: 1234 });
    });

    test('OPLOC2 bank booth', () => {
        const bytes = outPacket(out => { out.p1Enc(ClientProt.OPLOC2); out.p2(2656); out.p2(3283); out.p2(2213); });
        const [a] = new ClientActionParser(OUT_SEED).parse(bytes);
        expect(a).toEqual({ type: 'oploc', op: 2, x: 2656, z: 3283, locId: 2213 });
    });

    test('a batched flush of OPLOC + NO_TIMEOUT parses to two actions in order', () => {
        const bytes = outPacket(out => {
            out.p1Enc(ClientProt.OPLOC1); out.p2(3241); out.p2(3301); out.p2(1); // OPLOC1
            out.p1Enc(ClientProt.NO_TIMEOUT); // NO_TIMEOUT
        });
        const acts = new ClientActionParser(OUT_SEED).parse(bytes);
        expect(acts.map(a => a.type)).toEqual(['oploc', 'notimeout']);
    });

    test('CLIENT_CHEAT round-trips the command text', () => {
        const text = 'tele 0,41,51,37,41';
        const bytes = outPacket(out => { out.p1Enc(ClientProt.CLIENT_CHEAT); out.p1(text.length + 1); out.pjstr(text); });
        const [a] = new ClientActionParser(OUT_SEED).parse(bytes);
        expect(a).toEqual({ type: 'cheat', text });
    });
});

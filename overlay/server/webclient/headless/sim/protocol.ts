// Wire layer for the offline brain simulator: encodes server->client packets that
// the REAL leanclient/leanbot decoders consume, and parses the client->server bytes
// the brains emit. Formats are mirrored 1:1 from the reference decoders:
//   PLAYER_INFO  <- LeanClient.getPlayerPos* (leanclient.ts:447-660)
//   NPC_INFO     <- LeanBot.getNpcPos*       (leanbot.ts:864-992)
//   UPDATE_*/IF_*/MESSAGE_GAME <- LeanBot.run switch (leanbot.ts:308-506)
// Opcodes are ISAAC-encrypted one value per packet, payloads plaintext — exactly
// like the live server. gjstr terminates with \n (Packet.ts:181).
import Isaac from '#/io/Isaac.js';
import JString from '#/datastruct/JString.js';
import { ServerProt, ServerProtSizes } from '#/io/ServerProt.js';
import { ClientProt } from '#/io/ClientProt.js';

const BITMASK: number[] = [];
for (let i = 0; i <= 32; i++) BITMASK[i] = (1 << i) - 1;

// MSB-first bit writer, the exact inverse of Packet.gBit (Packet.ts:257-273).
export class ByteWriter {
    data = new Uint8Array(5000);
    pos = 0;
    bitPos = 0;

    p1(v: number) { this.data[this.pos++] = v; }
    p2(v: number) { this.data[this.pos++] = v >>> 8; this.data[this.pos++] = v & 0xff; }
    p4(v: number) { this.data[this.pos++] = v >>> 24; this.data[this.pos++] = v >>> 16; this.data[this.pos++] = v >>> 8; this.data[this.pos++] = v & 0xff; }
    p8(v: bigint) { for (let s = 56n; s >= 0n; s -= 8n) this.data[this.pos++] = Number((v >> s) & 0xffn); }
    pjstr(s: string) { for (let i = 0; i < s.length; i++) this.data[this.pos++] = s.charCodeAt(i); this.data[this.pos++] = 10; }

    bitStart() { this.bitPos = this.pos << 3; }
    bitEnd() { this.pos = (this.bitPos + 7) >>> 3; }
    pBit(n: number, value: number) {
        let bytePos = this.bitPos >>> 3;
        let remaining = 8 - (this.bitPos & 7);
        this.bitPos += n;
        for (; n > remaining; remaining = 8) {
            this.data[bytePos] &= ~BITMASK[remaining]!;
            this.data[bytePos++] |= (value >>> (n - remaining)) & BITMASK[remaining]!;
            n -= remaining;
        }
        if (n === remaining) {
            this.data[bytePos] &= ~BITMASK[remaining]!;
            this.data[bytePos] |= value & BITMASK[remaining]!;
        } else {
            this.data[bytePos] &= ~(BITMASK[n]! << (remaining - n));
            this.data[bytePos] |= (value & BITMASK[n]!) << (remaining - n);
        }
    }
    take(): Uint8Array { const out = this.data.slice(0, this.pos); this.pos = 0; this.bitPos = 0; this.data.fill(0); return out; }
}

// client moveCode() direction codes (leanclient.ts:135-159): index = code, value = [dx,dz]
const MOVE_DELTAS: Array<[number, number]> = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1]];
export function dirCode(dx: number, dz: number): number {
    const i = MOVE_DELTAS.findIndex(([a, b]) => a === dx && b === dz);
    if (i === -1) throw new Error(`no move code for delta (${dx},${dz})`);
    return i;
}

export type LocalPlayerUpdate =
    | { kind: 'none' }
    | { kind: 'walk'; dir: number }
    | { kind: 'run'; dir1: number; dir2: number }
    | { kind: 'teleport'; level: number; localX: number; localZ: number; jump: boolean };

/** A hitsplat to attach to an npc's extended-info block (dmg/type/current-hp/max-hp). */
export interface NpcHitsplat { damage: number; type: number; hp: number; maxHp: number }

export type NpcTickUpdate =
    | { kind: 'keep'; hit?: NpcHitsplat }
    | { kind: 'walk'; dir: number; hit?: NpcHitsplat }
    | { kind: 'remove' }
    | { kind: 'add'; index: number; typeId: number; relX: number; relZ: number; hit?: NpcHitsplat }; // rel to local player's POST-move tile

// Peer-player updates for the oldVis/newVis blocks of PLAYER_INFO (getPlayerPosOldVis /
// getPlayerPosNewVis, leanclient.ts:603-717). `appearance` on an entry queues an extended
// APPEARANCE block carrying the peer's base37 NAME — which is exactly what
// LeanBot.playerName()/findPlayerIndexByName() decode, so a named peer becomes resolvable.
export type PeerTickUpdate =
    | { kind: 'keep' }
    | { kind: 'walk'; dir: number; appearance?: string }
    | { kind: 'run'; dir1: number; dir2: number; appearance?: string }
    | { kind: 'remove' }
    | { kind: 'add'; index: number; relX: number; relZ: number; appearance: string }; // rel to the VIEWER's POST-move tile

// The appearance blob LeanBot.playerName() walks (Player.generateAppearance layout):
// gender(1) headicons(1) 12*slot(1, 0=empty) 5*colour(1) 7*anim(2) name37(8).
function appearanceBlob(name: string): Uint8Array {
    const w = new ByteWriter();
    w.p1(0); w.p1(0);
    for (let i = 0; i < 12; i++) w.p1(0);
    for (let i = 0; i < 5; i++) w.p1(0);
    for (let i = 0; i < 7; i++) w.p2(0);
    w.p8(JString.toUserhash(name));
    return w.take();
}

// Frames one server->client packet: ISAAC-encrypted opcode + size field per
// ServerProtSizes + payload (mirrors leanbot.ts:291-306).
export class ServerPacketStream {
    private cipher: Isaac;
    constructor(inSeed: number[]) { this.cipher = new Isaac(new Int32Array(inSeed)); }

    frame(opcode: number, payload: Uint8Array): Uint8Array {
        const declared = ServerProtSizes[opcode];
        const head: number[] = [(opcode + this.cipher.nextInt) & 0xff];
        if (declared === -1) {
            if (payload.length > 255) throw new Error(`payload too big for -1 size (op ${opcode})`);
            head.push(payload.length);
        } else if (declared === -2) {
            head.push(payload.length >>> 8, payload.length & 0xff);
        } else if (declared !== payload.length) {
            throw new Error(`op ${opcode}: fixed size ${declared} but payload ${payload.length}`);
        }
        const out = new Uint8Array(head.length + payload.length);
        out.set(head, 0); out.set(payload, head.length);
        return out;
    }

    playerInfo(update: LocalPlayerUpdate): Uint8Array {
        return this.playerInfoFull(update, [], []);
    }

    // Full PLAYER_INFO: local block + oldVis (tracked peers, in tracking order) + newVis (adds).
    // Extended (APPEARANCE) blocks follow the bit section in the engine's queue order: local never
    // (the bot knows its own name), then oldVis entries, then newVis adds. When any extended block
    // exists the 2047 terminator IS required — the decoder's newVis loop guard (bitPos+10 < size*8)
    // would otherwise walk into the appearance bytes; with no extended bytes the terminator must be
    // OMITTED (<=7 bits of padding never trip the guard, and a terminator desyncs gBitEnd).
    playerInfoFull(update: LocalPlayerUpdate, tracked: PeerTickUpdate[], adds: Extract<PeerTickUpdate, { kind: 'add' }>[]): Uint8Array {
        const w = new ByteWriter();
        const extended: string[] = [];   // appearance blobs to append, in queue order
        w.bitStart();
        if (update.kind === 'none') w.pBit(1, 0);
        else if (update.kind === 'walk') { w.pBit(1, 1); w.pBit(2, 1); w.pBit(3, update.dir); w.pBit(1, 0); }
        else if (update.kind === 'run') { w.pBit(1, 1); w.pBit(2, 2); w.pBit(3, update.dir1); w.pBit(3, update.dir2); w.pBit(1, 0); }
        else { w.pBit(1, 1); w.pBit(2, 3); w.pBit(2, update.level); w.pBit(7, update.localX); w.pBit(7, update.localZ); w.pBit(1, update.jump ? 1 : 0); w.pBit(1, 0); }
        w.pBit(8, tracked.length); // oldVis
        for (const t of tracked) {
            if (t.kind === 'keep') w.pBit(1, 0);
            else if (t.kind === 'walk') {
                w.pBit(1, 1); w.pBit(2, 1); w.pBit(3, t.dir);
                w.pBit(1, t.appearance ? 1 : 0);
                if (t.appearance) extended.push(t.appearance);
            } else if (t.kind === 'run') {
                w.pBit(1, 1); w.pBit(2, 2); w.pBit(3, t.dir1); w.pBit(3, t.dir2);
                w.pBit(1, t.appearance ? 1 : 0);
                if (t.appearance) extended.push(t.appearance);
            } else if (t.kind === 'remove') { w.pBit(1, 1); w.pBit(2, 3); }
            else throw new Error('add entries go in the adds list');
        }
        for (const a of adds) {
            if (a.relX < -16 || a.relX > 15 || a.relZ < -16 || a.relZ > 15) throw new Error(`peer ${a.index} out of 5-bit view range (${a.relX},${a.relZ})`);
            w.pBit(11, a.index);
            w.pBit(5, a.relX & 31); w.pBit(5, a.relZ & 31);
            w.pBit(1, 1); // jump-teleport into view (refreshes fine x/z)
            w.pBit(1, 1); // extended: the add always carries its APPEARANCE (name)
            extended.push(a.appearance);
        }
        if (extended.length) w.pBit(11, 2047);
        w.bitEnd();
        for (const name of extended) {
            const blob = appearanceBlob(name);
            w.p1(0x1);           // PlayerUpdate.APPEARANCE
            w.p1(blob.length);
            for (const b of blob) w.p1(b);
        }
        return this.frame(ServerProt.PLAYER_INFO, w.take());
    }

    // NPC_INFO. `hit` on any entry queues an extended-info block carrying a HITMARK — the only way an
    // npc's health ever reaches the client (NPC_INFO has no hp field; the hitsplat IS the broadcast).
    // The extended blocks follow the bit section in the SAME ORDER the entries set their extended flag,
    // exactly as getNpcPosExtended replays them from entityUpdateIds.
    npcInfo(existing: NpcTickUpdate[], added: Extract<NpcTickUpdate, { kind: 'add' }>[]): Uint8Array {
        const w = new ByteWriter();
        const extended: NpcHitsplat[] = [];
        w.bitStart();
        w.pBit(8, existing.length);
        for (const u of existing) {
            if (u.kind === 'keep') { w.pBit(1, u.hit ? 1 : 0); if (u.hit) { w.pBit(2, 0); extended.push(u.hit); } }
            else if (u.kind === 'walk') { w.pBit(1, 1); w.pBit(2, 1); w.pBit(3, u.dir); w.pBit(1, u.hit ? 1 : 0); if (u.hit) extended.push(u.hit); }
            else if (u.kind === 'remove') { w.pBit(1, 1); w.pBit(2, 3); }
            else throw new Error('add entries go in the added list');
        }
        for (const a of added) {
            if (a.relX < -16 || a.relX > 15 || a.relZ < -16 || a.relZ > 15) throw new Error(`npc ${a.index} out of 5-bit view range (${a.relX},${a.relZ})`);
            w.pBit(14, a.index); w.pBit(11, a.typeId);
            w.pBit(5, a.relX & 31); w.pBit(5, a.relZ & 31);
            w.pBit(1, 1);
            w.pBit(1, a.hit ? 1 : 0);
            if (a.hit) extended.push(a.hit);
        }
        // The 16383 terminator is REQUIRED once extended blocks follow (the newVis loop guard is
        // `bitPos + 21 < size*8` and would otherwise walk straight into the hitsplat bytes) and must be
        // OMITTED when they do not (<=7 bits of padding never trip the guard, and a terminator would
        // desync gBitEnd). Same rule as playerInfoFull — and the reason it is stated twice is that
        // getting it wrong produces a hang in waitIdle(), not a readable error.
        if (extended.length) w.pBit(14, 16383);
        w.bitEnd();
        // NpcUpdate.HITMARK = 0x10 (leanbot.ts's NpcUpdate enum), payload dmg/type/hp/maxhp as four g1s.
        for (const h of extended) {
            w.p1(0x10);
            w.p1(h.damage & 0xff); w.p1(h.type & 0xff); w.p1(h.hp & 0xff); w.p1(h.maxHp & 0xff);
        }
        return this.frame(ServerProt.NPC_INFO, w.take());
    }

    rebuildNormal(zoneX: number, zoneZ: number): Uint8Array {
        const w = new ByteWriter(); w.p2(zoneX); w.p2(zoneZ);
        return this.frame(ServerProt.REBUILD_NORMAL, w.take());
    }

    // ZONE UPDATE (ENCLOSED): the world tells the client a loc changed. The sim uses it for a door open
    // (LOC_DEL at the door tile -> passable) / close (LOC_ADD_CHANGE re-adds the closed variant) so a
    // bot's DoorTracker updates from the SAME decode path as live. Decoder: wx = base + zoneBase +
    // ((pos>>4)&7), wz = base + zoneBase + (pos&7) — so zoneBase points at the door's 8x8 zone and pos
    // is the 0-7 tile within it. `zoneDoorOp` computes both from a world tile + the viewer's base.
    zoneEnclosed(zoneBaseX: number, zoneBaseZ: number, ops: number[][]): Uint8Array {
        const w = new ByteWriter();
        w.p1(zoneBaseX & 0xff); w.p1(zoneBaseZ & 0xff);
        for (const op of ops) for (const b of op) w.p1(b);
        return this.frame(ServerProt.UPDATE_ZONE_PARTIAL_ENCLOSED, w.take());
    }
    // Build the (zoneBaseX, zoneBaseZ, subOp) for a door event at world (dx,dz) for a viewer at `base`.
    static zoneDoorOp(dx: number, dz: number, baseX: number, baseZ: number, sub: 'del' | { loc: number }): { zx: number; zz: number; op: number[] } {
        const lx = dx - baseX, lz = dz - baseZ;
        const zx = lx & ~7, zz = lz & ~7;
        const pos = ((lx & 7) << 4) | (lz & 7);
        const op = sub === 'del'
            ? [ServerProt.LOC_DEL, pos, 0]
            : [ServerProt.LOC_ADD_CHANGE, pos, 0, (sub.loc >> 8) & 0xff, sub.loc & 0xff];
        return { zx, zz, op };
    }
    // GROUND ITEMS. A kill's drop reaches the killer as a STANDALONE OBJ_ADD preceded by
    // UPDATE_ZONE_PARTIAL_FOLLOWS (a receiver-scoped event — pickupbot.ts:13), which is a DIFFERENT decode
    // path from the shared ENCLOSED OBJ_REVEAL the rest of the zone sees ~100 ticks later. The bot's own
    // drops only ever arrive on the FOLLOWS path, so the sim must be able to produce it: that path was
    // unhandled in LeanBot and no test could have caught it while the sim could only speak ENCLOSED.
    // Sub-payload is p1(coord) p2(obj) p2(count) (ObjAddEncoder.ts) — coord = ((lx&7)<<4)|(lz&7).
    // Split into per-packet builders on purpose: the outgoing ISAAC advances ONE value per packet, so a
    // packet must be ENCODED in the same order its bytes are PUSHED. A helper that encoded both frames at
    // queue time would desync the client's cipher and the decode loop would stall forever.
    zonePartialFollows(tile: { x: number; z: number }, baseX: number, baseZ: number): Uint8Array {
        const lx = tile.x - baseX, lz = tile.z - baseZ;
        const zw = new ByteWriter(); zw.p1((lx & ~7) & 0xff); zw.p1((lz & ~7) & 0xff);
        return this.frame(ServerProt.UPDATE_ZONE_PARTIAL_FOLLOWS, zw.take());
    }
    objAdd(tile: { x: number; z: number }, obj: number, count: number, baseX: number, baseZ: number): Uint8Array {
        const lx = tile.x - baseX, lz = tile.z - baseZ;
        const w = new ByteWriter();
        w.p1(((lx & 7) << 4) | (lz & 7)); w.p2(obj); w.p2(count);
        return this.frame(ServerProt.OBJ_ADD, w.take());
    }
    objDel(tile: { x: number; z: number }, obj: number, baseX: number, baseZ: number): Uint8Array {
        const lx = tile.x - baseX, lz = tile.z - baseZ;
        const w = new ByteWriter();
        w.p1(((lx & 7) << 4) | (lz & 7)); w.p2(obj);
        return this.frame(ServerProt.OBJ_DEL, w.take());
    }
    /** The shared ENCLOSED reveal (what every OTHER player in the zone sees once the pile goes public). */
    zoneObjAddEnclosed(objTile: { x: number; z: number }, obj: number, count: number, baseX: number, baseZ: number): Uint8Array {
        const lx = objTile.x - baseX, lz = objTile.z - baseZ;
        return this.zoneEnclosed(lx & ~7, lz & ~7, [[
            ServerProt.OBJ_ADD, ((lx & 7) << 4) | (lz & 7), (obj >> 8) & 0xff, obj & 0xff, (count >> 8) & 0xff, count & 0xff,
        ]]);
    }
    /**
     * ⭐ THE REAL REVEAL — `OBJ_REVEAL` (219), not an `OBJ_ADD` wearing its hat.
     *
     * ⛔ WHY `zoneObjAddEnclosed` ABOVE IS NOT THE SAME PACKET, AND WHY THAT MATTERED. The engine emits
     * ObjReveal, not ObjAdd, when an owner-locked pile goes public (ObjRevealEncoder.ts): the payload
     * carries an EXTRA `p2(receiverId)` after the count. A decoder that reads a reveal as an add is two
     * bytes short for the rest of the ENCLOSED buffer and desyncs every following sub-op — so a
     * scavenger's whole reason to exist (piles it did NOT drop) could not be tested at the wire level
     * while the sim could only speak the add form. Byte order is verbatim from the encoder:
     *     p1(coord) p2(obj) p2(count) p2(receiverId)
     */
    zoneObjRevealEnclosed(
        objTile: { x: number; z: number }, obj: number, count: number, baseX: number, baseZ: number, receiverId = 0,
    ): Uint8Array {
        const lx = objTile.x - baseX, lz = objTile.z - baseZ;
        return this.zoneEnclosed(lx & ~7, lz & ~7, [[
            ServerProt.OBJ_REVEAL, ((lx & 7) << 4) | (lz & 7),
            (obj >> 8) & 0xff, obj & 0xff,
            (count >> 8) & 0xff, count & 0xff,
            (receiverId >> 8) & 0xff, receiverId & 0xff,
        ]]);
    }
    /** The shared ENCLOSED delete — how the zone learns SOMEONE ELSE took the pile (or it despawned). */
    zoneObjDelEnclosed(objTile: { x: number; z: number }, obj: number, baseX: number, baseZ: number): Uint8Array {
        const lx = objTile.x - baseX, lz = objTile.z - baseZ;
        return this.zoneEnclosed(lx & ~7, lz & ~7, [[
            ServerProt.OBJ_DEL, ((lx & 7) << 4) | (lz & 7), (obj >> 8) & 0xff, obj & 0xff,
        ]]);
    }
    updateStat(stat: number, xp: number, level: number): Uint8Array {
        const w = new ByteWriter(); w.p1(stat); w.p4(xp); w.p1(level);
        return this.frame(ServerProt.UPDATE_STAT, w.take());
    }
    updateInvFull(comId: number, slots: Array<{ id: number; count: number }>): Uint8Array {
        const w = new ByteWriter(); w.p2(comId); w.p2(slots.length);   // rev 289: p2 (was p1 @274)
        for (const s of slots) {
            w.p2(s.id < 0 ? 0 : s.id + 1); // wire ids are obj.id+1, 0 = empty
            if (s.count >= 255) { w.p1(255); w.p4(s.count); } else w.p1(s.count);
        }
        return this.frame(ServerProt.UPDATE_INV_FULL, w.take());
    }
    messageGame(text: string): Uint8Array {
        const w = new ByteWriter(); w.pjstr(text);
        return this.frame(ServerProt.MESSAGE_GAME, w.take());
    }
    // IF_SETTEXT — how the engine delivers p_choice option LABELS (`if_settext(multi3:com_1, ...)`).
    // A bot that answers a choice by matching the TEXT (the robust way — component ids are not in style
    // order) cannot be tested at all without this.
    ifSetText(comId: number, text: string): Uint8Array {
        const w = new ByteWriter(); w.p2(comId); w.pjstr(text);
        return this.frame(ServerProt.IF_SETTEXT, w.take());
    }
    ifOpenChat(comId: number): Uint8Array {
        const w = new ByteWriter(); w.p2(comId);
        return this.frame(ServerProt.IF_OPENCHAT, w.take());
    }
    ifOpenMain(comId: number): Uint8Array {
        const w = new ByteWriter(); w.p2(comId);
        return this.frame(ServerProt.IF_OPENMAIN, w.take());
    }
    ifClose(): Uint8Array { return this.frame(ServerProt.IF_CLOSE, new Uint8Array(0)); }
    /**
     * IF_SETCOLOUR (160 @289, 183 @274) — `p2(component) p2(colour15)`, the QUEST JOURNAL channel.
     *
     * ⛔ THIS IS THE ONLY WAY A CLIENT CAN SEE 60 OF THE 61 QUEST PROGRESS VARIABLES (quest-state.ts's
     * headline: they do not transmit). `~send_quest_complete` ends with
     * `if_setcolour($component, ^green_rgb)` (general/scripts/quests.rs2:50), so a quest whose reward is
     * XP rather than an item is observable ONLY here. Without this builder the sim could not exercise a
     * completion check that reads `ifColour` at all.
     */
    ifSetColour(component: number, colour15: number): Uint8Array {
        const w = new ByteWriter(); w.p2(component); w.p2(colour15);
        return this.frame(ServerProt.IF_SETCOLOUR, w.take());
    }
    ifOpenMainSide(mainCom: number, sideCom: number): Uint8Array {
        const w = new ByteWriter(); w.p2(mainCom); w.p2(sideCom);
        return this.frame(ServerProt.IF_OPENMAIN_SIDE, w.take());
    }
    // P_COUNTDIALOG (35 @289, size 0) — the bank/trade amount prompt; the client replies with
    // RESUME_P_COUNTDIALOG (102 + p4) and the engine DROPS a reply sent before this packet.
    pCountDialog(): Uint8Array { return this.frame(ServerProt.P_COUNTDIALOG, new Uint8Array(0)); }
    logout(): Uint8Array { return this.frame(ServerProt.LOGOUT, new Uint8Array(0)); }

    // ---- VARPS -----------------------------------------------------------------------------------
    // Byte layout copied from the ENGINE'S OWN ENCODERS so the sim cannot drift from the wire:
    //   VarpSmallEncoder.ts  buf.p2(varp); buf.p1(value)   -> declared size 3
    //   VarpLargeEncoder.ts  buf.p2(varp); buf.p4(value)   -> declared size 6
    // `frame()` asserts the payload length against ServerProtSizes, so a layout mistake here fails at
    // encode time rather than becoming a silent desync.
    varpSmall(varp: number, value: number): Uint8Array {
        const w = new ByteWriter(); w.p2(varp); w.p1(value & 0xff);
        return this.frame(ServerProt.VARP_SMALL, w.take());
    }
    varpLarge(varp: number, value: number): Uint8Array {
        const w = new ByteWriter(); w.p2(varp); w.p4(value);
        return this.frame(ServerProt.VARP_LARGE, w.take());
    }
    /** VARP_SYNC / RESET_CLIENT_VARCACHE (190, size 0). */
    varpSync(): Uint8Array { return this.frame(ServerProt.VARP_SYNC, new Uint8Array(0)); }

    /** Pick the encoder the ENGINE would pick. Player.ts sends the small form when the value fits a
     *  signed byte and the large form otherwise — so a test that wants "the server set varp X to N"
     *  should use this rather than choosing a form by hand. */
    varp(varp: number, value: number): Uint8Array {
        return value >= -128 && value <= 127 ? this.varpSmall(varp, value) : this.varpLarge(varp, value);
    }

    // ---- RUN ENERGY ------------------------------------------------------------------------------
    // UpdateRunEnergyEncoder.ts: buf.p1((energy / 100) | 0) — the wire carries a 0..100 PERCENT.
    updateRunEnergy(percent: number): Uint8Array {
        const w = new ByteWriter(); w.p1(percent & 0xff);
        return this.frame(ServerProt.UPDATE_RUNENERGY, w.take());
    }
}

// ---- client->server side ----------------------------------------------------

export type ClientAction =
    | { type: 'move'; opcode: number; opclick: boolean; ctrl: number; path: Array<{ x: number; z: number }> }
    | { type: 'opnpc'; op: 1 | 2 | 3; index: number }
    | { type: 'oploc'; op: 1 | 2 | 3 | 4 | 5; x: number; z: number; locId: number }
    | { type: 'opheld'; op?: number; obj: number; slot: number; com: number }   // op = raw opcode: ClientProt.OPHELD1 (eat/bury/light; 76 @289, 185 @274), ClientProt.OPHELD5 (DROP; 79 @289, 42 @274)
    | { type: 'opobj'; op: 1 | 2 | 3 | 4 | 5; x: number; z: number; obj: number }   // op3 = Take a ground item
    | { type: 'wield'; obj: number; slot: number; com: number }
    | { type: 'opplayer4'; index: number }
    | { type: 'invbutton'; op: 1 | 2 | 3 | 4 | 5; obj: number; slot: number; com: number }
    | { type: 'countreply'; n: number }
    | { type: 'oplocu'; x: number; z: number; locId: number; obj: number; slot: number; com?: number }
    | { type: 'opnpcu'; index: number; obj: number; slot: number }
    | { type: 'opheldu'; obj: number; slot: number; useObj: number; useSlot: number }
    // OPHELDT — cast a magic-tab spell on an inventory item (alch, enchant). Its SIZE was already
    // declared, so the parser stayed aligned, but it fell through to `default` and a cast was invisible
    // to assertions — the same gap OPOBJ had. `spellCom` is the magic-tab component clicked.
    | { type: 'opheldt'; obj: number; slot: number; spellCom: number }
    // OPNPCT — cast a magic-tab spell on an NPC. `spellCom` is the magic-tab component clicked; the
    // engine routes it to `[apnpct,magic:<spell>]` (OpNpcTHandler.ts:51), never to `opnpct`.
    | { type: 'opnpct'; index: number; spellCom: number }
    // OPOBJT — cast a magic-tab spell on a GROUND obj (telekinetic grab, wine lane). OpObjTDecoder: g2 x, g2 z,
    // g2 obj, g2 spellCom; the engine routes it to [opobjt|apobjt,magic:<spell>] (telegrab.rs2).
    | { type: 'opobjt'; x: number; z: number; obj: number; spellCom: number }
    | { type: 'ifbutton'; com: number }
    | { type: 'resume'; com: number }
    | { type: 'closemodal' }
    | { type: 'notimeout' }
    | { type: 'cheat'; text: string };

// ClientGameProt sizes for every opcode the headless brains emit (engine ClientGameProt.ts table).
// rev 289: keyed by the ClientProt ENUM, never by raw numbers — every opcode changed 274 -> 289.
const CLIENT_SIZES: Record<number, number> = {
    [ClientProt.MOVE_GAMECLICK]: -1, [ClientProt.MOVE_OPCLICK]: -1, [ClientProt.MOVE_MINIMAPCLICK]: -1,
    [ClientProt.OPNPC1]: 2, [ClientProt.OPNPC2]: 2, [ClientProt.OPNPC3]: 2,
    [ClientProt.OPLOC1]: 6, [ClientProt.OPLOC2]: 6, [ClientProt.OPLOC3]: 6, [ClientProt.OPLOC4]: 6, [ClientProt.OPLOC5]: 6,
    [ClientProt.OPHELD1]: 6, [ClientProt.OPHELD5]: 6, [ClientProt.OPHELD2]: 6,          // OPHELD1 / OPHELD5 / OPHELD2 (wield-wear)
    [ClientProt.OPPLAYER4]: 2,
    [ClientProt.INV_BUTTON1]: 6, [ClientProt.INV_BUTTON2]: 6, [ClientProt.INV_BUTTON3]: 6, [ClientProt.INV_BUTTON4]: 6, [ClientProt.INV_BUTTON5]: 6,
    [ClientProt.RESUME_P_COUNTDIALOG]: 4,                              // the bank amount reply
    [ClientProt.IF_BUTTON]: 2, [ClientProt.RESUME_PAUSEBUTTON]: 2, [ClientProt.CLOSE_MODAL]: 0, [ClientProt.NO_TIMEOUT]: 0,
    [ClientProt.OPLOCU]: 12,                                           // use item on loc — smelt/smith/cook/altar
    [ClientProt.OPNPCU]: 8,                                            // use item on npc — quest steps
    [ClientProt.OPHELDU]: 12,                                          // use item on item — fletch/craft, p2 x6
    [ClientProt.OPHELDT]: 8, [ClientProt.OPNPCT]: 4,                            // alch / spell on npc
    [ClientProt.OPOBJT]: 8,                                            // spell on a ground obj (telegrab)
    [ClientProt.OPOBJ1]: 6, [ClientProt.OPOBJ2]: 6, [ClientProt.OPOBJ3]: 6, [ClientProt.OPOBJ4]: 6, [ClientProt.OPOBJ5]: 6, // ground items
    [ClientProt.CLIENT_CHEAT]: -1,
};
const OPLOC_OP: Record<number, 1 | 2 | 3 | 4 | 5> = { [ClientProt.OPLOC1]: 1, [ClientProt.OPLOC2]: 2, [ClientProt.OPLOC3]: 3, [ClientProt.OPLOC4]: 4, [ClientProt.OPLOC5]: 5 };
const OPOBJ_OP: Record<number, 1 | 2 | 3 | 4 | 5> = { [ClientProt.OPOBJ1]: 1, [ClientProt.OPOBJ2]: 2, [ClientProt.OPOBJ3]: 3, [ClientProt.OPOBJ4]: 4, [ClientProt.OPOBJ5]: 5 };
const INV_BUTTON_OP: Record<number, 1 | 2 | 3 | 4 | 5> = { [ClientProt.INV_BUTTON1]: 1, [ClientProt.INV_BUTTON2]: 2, [ClientProt.INV_BUTTON3]: 3, [ClientProt.INV_BUTTON4]: 4, [ClientProt.INV_BUTTON5]: 5 };

export class ClientActionParser {
    private cipher: Isaac;
    constructor(outSeed: number[]) { this.cipher = new Isaac(new Int32Array(outSeed)); }

    // Parses one flush()'s bytes (possibly several packets batched in one write).
    parse(bytes: Uint8Array): ClientAction[] {
        const out: ClientAction[] = [];
        let p = 0;
        const g1 = () => bytes[p++]!;
        const g1b = () => { const v = bytes[p++]!; return v > 127 ? v - 256 : v; };
        const g2 = () => { const v = (bytes[p]! << 8) | bytes[p + 1]!; p += 2; return v; };
        while (p < bytes.length) {
            const opcode = (g1() - this.cipher.nextInt) & 0xff;
            const declared = CLIENT_SIZES[opcode];
            if (declared === undefined) throw new Error(`unknown client opcode ${opcode} at ${p - 1} — extend CLIENT_SIZES`);
            const size = declared === -1 ? g1() : declared;
            const end = p + size;
            switch (opcode) {
                case ClientProt.MOVE_GAMECLICK: case ClientProt.MOVE_OPCLICK: {
                    const ctrl = g1();
                    const startX = g2(), startZ = g2();
                    const path = [{ x: startX, z: startZ }];
                    while (p < end) { const dx = g1b(), dz = g1b(); path.push({ x: startX + dx, z: startZ + dz }); }
                    out.push({ type: 'move', opcode, opclick: opcode === ClientProt.MOVE_OPCLICK, ctrl, path });
                    break;
                }
                case ClientProt.OPNPC1: case ClientProt.OPNPC2: case ClientProt.OPNPC3:
                    out.push({ type: 'opnpc', op: opcode === ClientProt.OPNPC1 ? 1 : opcode === ClientProt.OPNPC2 ? 2 : 3, index: g2() });
                    break;
                case ClientProt.OPLOC1: case ClientProt.OPLOC2: case ClientProt.OPLOC3: case ClientProt.OPLOC4: case ClientProt.OPLOC5:
                    out.push({ type: 'oploc', op: OPLOC_OP[opcode]!, x: g2(), z: g2(), locId: g2() });
                    break;
                case ClientProt.OPHELD1: case ClientProt.OPHELD5:
                    out.push({ type: 'opheld', op: opcode, obj: g2(), slot: g2(), com: g2() });
                    break;
                case ClientProt.OPHELD2:
                    out.push({ type: 'wield', obj: g2(), slot: g2(), com: g2() });
                    break;
                // OPOBJ1..5 — ground-item ops. Their SIZES were already declared (so the parser stayed
                // aligned) but they fell through to `default`, so a take was invisible to assertions.
                case ClientProt.OPOBJ1: case ClientProt.OPOBJ2: case ClientProt.OPOBJ3: case ClientProt.OPOBJ4: case ClientProt.OPOBJ5:
                    out.push({ type: 'opobj', op: OPOBJ_OP[opcode]!, x: g2(), z: g2(), obj: g2() });
                    break;
                case ClientProt.OPPLAYER4: out.push({ type: 'opplayer4', index: g2() }); break;
                case ClientProt.INV_BUTTON1: case ClientProt.INV_BUTTON2: case ClientProt.INV_BUTTON3: case ClientProt.INV_BUTTON4: case ClientProt.INV_BUTTON5:
                    out.push({ type: 'invbutton', op: INV_BUTTON_OP[opcode]!, obj: g2(), slot: g2(), com: g2() });
                    break;
                case ClientProt.RESUME_P_COUNTDIALOG: {
                    const n = (g2() << 16) | g2();
                    out.push({ type: 'countreply', n });
                    break;
                }
                case ClientProt.OPLOCU: { const x = g2(), z = g2(), locId = g2(), obj = g2(), slot = g2(), com = g2(); out.push({ type: 'oplocu', x, z, locId, obj, slot, com }); break; }
                case ClientProt.OPNPCU: { const index = g2(), obj = g2(), slot = g2(); g2(); out.push({ type: 'opnpcu', index, obj, slot }); break; }
                case ClientProt.OPHELDU: { const obj = g2(), slot = g2(); g2(); const useObj = g2(), useSlot = g2(); g2(); out.push({ type: 'opheldu', obj, slot, useObj, useSlot }); break; }
                case ClientProt.OPHELDT: { const obj = g2(), slot = g2(); g2(); const spellCom = g2(); out.push({ type: 'opheldt', obj, slot, spellCom }); break; }
                // OPNPCT — cast a magic-tab spell ON AN NPC (the magic lane's whole attack). Its SIZE was
                // already declared so the parser stayed aligned, but it fell through to `default` and a
                // CAST was invisible to assertions — the same gap OPOBJ and OPHELDT each had, and here it
                // would make every magicbot test vacuous: "it did not send OPNPC2" would pass whether the
                // bot cast a spell or did nothing at all.
                case ClientProt.OPNPCT: { const index = g2(), spellCom = g2(); out.push({ type: 'opnpct', index, spellCom }); break; }
                case ClientProt.OPOBJT: { const x = g2(), z = g2(), obj = g2(), spellCom = g2(); out.push({ type: 'opobjt', x, z, obj, spellCom }); break; }
                case ClientProt.IF_BUTTON: out.push({ type: 'ifbutton', com: g2() }); break;
                case ClientProt.RESUME_PAUSEBUTTON: out.push({ type: 'resume', com: g2() }); break;
                case ClientProt.CLOSE_MODAL: out.push({ type: 'closemodal' }); break;
                case ClientProt.NO_TIMEOUT: out.push({ type: 'notimeout' }); break;
                case ClientProt.CLIENT_CHEAT: {
                    let s = ''; while (p < end) { const b = g1(); if (b !== 0 && b !== 10) s += String.fromCharCode(b); }
                    out.push({ type: 'cheat', text: s });
                    break;
                }
                default: p = end;
            }
            p = end;
        }
        return out;
    }
}

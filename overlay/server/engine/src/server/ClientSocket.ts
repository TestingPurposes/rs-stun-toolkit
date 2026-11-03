import { randomUUID } from 'crypto';

import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import Isaac from '#/io/Isaac.js';
import Packet from '#/io/Packet.js';


export default abstract class ClientSocket {
    uuid = randomUUID();
    remoteAddress = 'unknown';
    totalBytesRead = 0;
    totalBytesWritten = 0;

    state = 0;
    player: NetworkPlayer | null = null;
    encryptor: Isaac | null = null;
    decryptor: Isaac | null = null;

    in = Packet.alloc(65535); // node won't let us read from the socket as a stream so we buffer it ourselves
    out = Packet.alloc(1);

    opcode = -1; // current opcode being read
    waiting = 0; // bytes to wait for (if any)

    lastRecvAt = 0;   // rs-sdk offline sim: World.simAwaitAcks waits for every client's post-tick packet
    // rs-sdk offline sim perf: set by World.simAwaitAcks (SIM_LOCKSTEP=1 only); wakes the ack check on a read (null = off)
    static simOnRecv: (() => void) | null = null;

    lastRecvPerf = 0;   // rs-sdk offline sim perf (SIM_PROF only): performance.now() of the last read
    static simProf = false;
    static simAnyRecvAt = 0;   // rs-sdk offline sim (SIM_IDLE_HOLD): Date.now() of the last read on any socket

    buffer(data: Buffer) {
        this.lastRecvAt = ClientSocket.simAnyRecvAt = Date.now();
        if (ClientSocket.simProf) this.lastRecvPerf = performance.now();
        if (ClientSocket.simOnRecv !== null) ClientSocket.simOnRecv();
        if (data.length + this.in.pos > this.in.length) {
            this.close();
            return;
        }

        this.in.pdata(data, 0, data.length);
    }

    // available bytes we can read
    get available() {
        return this.in.pos;
    }

    // remaining bytes we can buffer
    get remaining() {
        return this.in.length - this.in.pos;
    }

    read(dest: Uint8Array, offset: number, length: number) {
        if (this.available < length) {
            return false;
        }

        // copy data to dest
        dest.set(this.in.data.subarray(0, length), offset);
        this.in.pos -= length;

        // shift buffer to the next read
        this.in.data.set(this.in.data.subarray(length), 0);

        return true;
    }

    abstract send(src: Uint8Array): void;
    abstract close(): void;
    abstract terminate(): void;
}

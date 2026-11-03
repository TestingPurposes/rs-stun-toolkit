// collision-store: the generated sdk/collision-data.bin must hold EXACTLY the JSON's tables, and the loader must refuse a
// stale / corrupt / wrong-version bin (it then falls back to the JSON). See sdk/collision-store.ts.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import {
    COLLISION_BIN_PATH, COLLISION_JSON_PATH, COLLISION_BIN_VERSION, encodeCollisionBin, decodeCollisionBin,
} from '../../../../sdk/collision-store';

const haveJson = existsSync(COLLISION_JSON_PATH);
const haveBin = existsSync(COLLISION_BIN_PATH);

describe('collision-store', () => {
    test.skipIf(!haveJson || !haveBin)('the shipped bin is what the generator makes from the shipped JSON (else: bun sdk/collision-bin.ts)', () => {
        const json = readFileSync(COLLISION_JSON_PATH);
        expect(readFileSync(COLLISION_BIN_PATH).equals(encodeCollisionBin(json))).toBe(true);
    });

    test.skipIf(!haveJson || !haveBin)('decoded tables == the JSON rows, value by value, in order', () => {
        const j = JSON.parse(readFileSync(COLLISION_JSON_PATH, 'utf8')) as { tiles: number[][]; zones: number[][]; doors: number[][] };
        const t = decodeCollisionBin(readFileSync(COLLISION_BIN_PATH), readFileSync(COLLISION_JSON_PATH).length);
        const same = (rows: number[][], flat: Int32Array, w: number) => {
            if (rows.length * w !== flat.length) return `length ${rows.length * w} != ${flat.length}`;
            for (let r = 0; r < rows.length; r++) for (let k = 0; k < w; k++) if (rows[r]![k] !== flat[r * w + k]) return `row ${r} col ${k}`;
            return 'ok';
        };
        expect(same(j.zones, t.zones, 3)).toBe('ok');
        expect(same(j.doors, t.doors, 6)).toBe('ok');
        expect(same(j.tiles, t.tiles, 4)).toBe('ok');
    });

    test('refuses stale, truncated, corrupt and wrong-version bins', () => {
        const json = Buffer.from(JSON.stringify({ zones: [[0, 3200, 3200]], doors: [[0, 3201, 3202, 0, 2, 1]], tiles: [[0, 3200, 3201, -2147483648], [1, 3200, 3200, 256]] }));
        const bin = encodeCollisionBin(json);
        const ok = decodeCollisionBin(bin, json.length);
        expect([...ok.tiles]).toEqual([0, 3200, 3201, -2147483648, 1, 3200, 3200, 256]);
        expect(() => decodeCollisionBin(bin, json.length + 1)).toThrow(/STALE/);
        expect(() => decodeCollisionBin(bin.subarray(0, bin.length - 4))).toThrow(/truncated/);
        const bad = Buffer.from(bin); bad.writeInt32LE(bad.readInt32LE(bad.length - 4) ^ 1, bad.length - 4);
        expect(() => decodeCollisionBin(bad)).toThrow(/checksum/);
        const ver = Buffer.from(bin); ver.writeInt32LE(COLLISION_BIN_VERSION + 1, 4);
        expect(() => decodeCollisionBin(ver)).toThrow(/version/);
        // unaligned buffer (a pooled readFileSync slice) still decodes
        const pad = Buffer.alloc(bin.length + 1); bin.copy(pad, 1);
        expect([...decodeCollisionBin(pad.subarray(1)).doors]).toEqual([0, 3201, 3202, 0, 2, 1]);
    });
});

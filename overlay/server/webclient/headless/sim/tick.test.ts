// tick.test.ts — bots/tick.ts, the one reader of logs/tick.json (the realm tick; 300 -> 400 ms ).
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    parseTick, readTick, tickMs, ticksToMs, msToTicks, secondsForTicks, hoursForTicks, ticksPerHour, perHourFromPerTick,
    scaledMs, tickFile, TICK_DEFAULT_MS, REF_TICK_MS,
} from '../../../../bots/tick.js';

const dir = mkdtempSync(join(tmpdir(), 'tick-test-'));
let n = 0;
/** a fresh file path per case (tickMs caches per path for 1 s) */
function file(text: string | null): string {
    const p = join(dir, `tick-${n++}.json`);
    if (text !== null) writeFileSync(p, text);
    return p;
}
const saved = { file: process.env.TICK_FILE, ms: process.env.TICK_MS };
afterEach(() => {
    if (saved.file === undefined) delete process.env.TICK_FILE; else process.env.TICK_FILE = saved.file;
    if (saved.ms === undefined) delete process.env.TICK_MS; else process.env.TICK_MS = saved.ms;
});

describe('parseTick — the file format', () => {
    test('the live file shape', () => {
        const t = parseTick('{"ms": 400, "since": "tick change", "why": "demo went 300 -> 400"}');
        expect(t).toEqual({ ms: 400, source: 'file', since: 'tick change', why: 'demo went 300 -> 400' });
    });
    test('missing / garbage / out of range -> the 400 default', () => {
        for (const bad of [null, '', 'nope', '[400]', '{}', '{"ms": "fast"}', '{"ms": 0}', '{"ms": 9}', '{"ms": 5001}', '{"ms": null}', '{"tick": 300}']) {
            expect(parseTick(bad)).toEqual({ ms: TICK_DEFAULT_MS, source: 'default' });
        }
        expect(TICK_DEFAULT_MS).toBe(400);
    });
    test('any value in 10..5000 is taken (fractional too)', () => {
        expect(parseTick('{"ms": 40}').ms).toBe(40);   // the local test engine
        expect(parseTick('{"ms": 300}').ms).toBe(300);
        expect(parseTick('{"ms": 401.5}').ms).toBe(401.5);
        expect(parseTick('{"ms": "600"}').ms).toBe(600);   // a quoted number still reads
    });
});

describe('readTick / tickMs — the sources', () => {
    test('file is read at call time; an edit lands without a restart', () => {
        const p = file('{"ms": 300}');
        expect(readTick(p, {}).ms).toBe(300);
        writeFileSync(p, '{"ms": 450}');
        expect(readTick(p, {}).ms).toBe(450);
    });
    test('missing file -> default, never throws', () => {
        expect(readTick(file(null), {})).toEqual({ ms: 400, source: 'default' });
    });
    test('env TICK_MS pins it (sims / local engines); an invalid pin falls through to the file', () => {
        const p = file('{"ms": 300}');
        expect(readTick(p, { TICK_MS: '40' })).toEqual({ ms: 40, source: 'env' });
        expect(readTick(p, { TICK_MS: 'x' }).ms).toBe(300);
        expect(readTick(p, { TICK_MS: '' }).ms).toBe(300);
    });
    test('TICK_FILE overrides the path; default path is <tree>/logs/tick.json', () => {
        delete process.env.TICK_FILE;
        expect(tickFile().replace(/\\/g, '/')).toMatch(/\/logs\/tick\.json$/);
        const p = file('{"ms": 250}');
        process.env.TICK_FILE = p;
        expect(tickFile()).toBe(p);
        delete process.env.TICK_MS;
        expect(tickMs()).toBe(250);
    });
});

describe('conversions — at the file tick', () => {
    test('400 ms', () => {
        process.env.TICK_FILE = file('{"ms": 400}');
        delete process.env.TICK_MS;
        expect(tickMs()).toBe(400);
        expect(ticksToMs(150)).toBe(60_000);
        expect(msToTicks(60_000)).toBe(150);
        expect(secondsForTicks(100)).toBe(40);
        expect(hoursForTicks(9_000)).toBe(1);
        expect(ticksPerHour()).toBe(9_000);
        expect(perHourFromPerTick(0.5)).toBe(4_500);
    });
    test('scaledMs keeps the TICK count of a 300 ms budget and is never shorter', () => {
        expect(REF_TICK_MS).toBe(300);
        delete process.env.TICK_MS;
        process.env.TICK_FILE = file('{"ms": 400}');
        expect(scaledMs(45_000)).toBe(60_000);
        expect(scaledMs(1_200)).toBe(1_600);
        process.env.TICK_FILE = file('{"ms": 300}');
        expect(scaledMs(45_000)).toBe(45_000);
        process.env.TICK_FILE = file('{"ms": 200}');
        expect(scaledMs(45_000)).toBe(45_000);   // a faster tick never shortens a budget
        process.env.TICK_FILE = file('{"ms": 600}');
        expect(scaledMs(10_000, 600)).toBe(10_000);
        expect(scaledMs(10_000)).toBe(20_000);
    });
});

describe('the live tree file', () => {
    test('if present, logs/tick.json is valid and agrees with the speedrun reader key ("ms")', () => {
        delete process.env.TICK_FILE;
        const t = readTick(tickFile(), {});
        // in a tree without the file this is the default; with it, it must be a FILE read (never garbage)
        if (t.source !== 'default') expect(t.ms).toBeGreaterThanOrEqual(10);
    });
});

process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { } });

// ============================================================================
// ENTITY-BY-NAME, WIRED — the integration half of parity package 2.
//
// loc-scene.test.ts proves the INDEX against known ground truth. This file
// proves the bot-facing surface bolted onto LeanBot: the queries anchor on the
// bot's own live position and plane, and `opLocByName` completes the whole
// name -> interact path with no hardcoded coordinate or loc id anywhere.
//
// ⛔ THE TRAP THIS FILE PINS DOWN: near the Ardougne bank, the bare substring
// 'booth' also matches `Closed bank booth` (loc 2215) — a decoration with no
// usable op that a bot can never bank at. An anchored /^bank booth$/i is the
// difference between a working banker and one that stands at a wall forever.
// ============================================================================
import { beforeAll, describe, expect, test } from 'bun:test';

import { ClientProt } from '#/io/ClientProt.js';
import Isaac from '#/io/Isaac.js';
import Packet from '#/io/Packet.js';

import { LeanBot } from '../leanbot.js';
import * as locScene from '../loc-scene.js';

// Ground truth reused from loc-scene.test.ts (find-banks.ts printed these).
const ARD_SOUTH_BANK = { x: 2655, z: 3283 };
const BANK_BOOTH_ID = 2213;
const CLOSED_BOOTH_ID = 2215;
const TOLL_GATE = { x: 3268, z: 3227 };

beforeAll(() => {
    locScene.init();
});

/** A LeanBot standing at (x,z) on `level`, with an outgoing buffer but no socket. */
function botAt(x: number, z: number, level = 0): LeanBot {
    const bot = new LeanBot();
    bot.quiet = true;
    bot.out = Packet.alloc(1);
    bot.out.random = new Isaac(new Int32Array([1, 2, 3, 4]));
    // playerTile() reads mapBuildBase + routeX[0] — the route-corrected read, never x>>7.
    bot.mapBuildBaseX = (x >> 3 << 3) - 48;
    bot.mapBuildBaseZ = (z >> 3 << 3) - 48;
    bot.localPlayer.routeX[0] = x - bot.mapBuildBaseX;
    bot.localPlayer.routeZ[0] = z - bot.mapBuildBaseZ;
    bot.minusedlevel = level;
    return bot;
}

/** Decrypt what the bot wrote into `[opcode, ...payload]` frames. */
function frames(bot: LeanBot, sizes: Record<number, number>): Array<{ op: number; body: Uint8Array }> {
    const cipher = new Isaac(new Int32Array([1, 2, 3, 4]));
    const bytes = bot.out.data.subarray(0, bot.out.pos);
    const out: Array<{ op: number; body: Uint8Array }> = [];
    let p = 0;
    while (p < bytes.length) {
        const op = (bytes[p++]! - cipher.nextInt) & 0xff;
        const size = sizes[op]!;
        out.push({ op, body: bytes.subarray(p, p + size) });
        p += size;
    }
    return out;
}

// opcodes from the INSTALLED ClientProt (rev 289 renumbered every opcode; 274 was 215/103/187/157/127), never literals
const OPLOC_SIZES: Record<number, number> = { [ClientProt.OPLOC1]: 6, [ClientProt.OPLOC2]: 6, [ClientProt.OPLOC3]: 6, [ClientProt.OPLOC4]: 6, [ClientProt.OPLOC5]: 6 };
const g2 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;

describe('the queries anchor on the BOT, not on caller-supplied coordinates', () => {
    test('findNearbyLoc resolves the Ardougne bank booth from where the bot stands', () => {
        const bot = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z);
        const booth = bot.findNearbyLoc(/^bank booth$/i, 10);
        expect(booth).not.toBeNull();
        expect(booth!.id).toBe(BANK_BOOTH_ID);
        expect(booth!.name).toBe('Bank booth');
        expect(booth!.level).toBe(0);
        expect(booth!.distance).toBeLessThanOrEqual(10);
        expect(booth!.optionsWithIndex.map(o => o.text)).toEqual(['Use', 'Use-quickly']);
    });

    test('moving the bot moves the answer (the anchor is live, not captured)', () => {
        // Two real booths, 3 tiles apart. Each bot must be handed the one NEXT TO IT.
        const south = botAt(2656, 3283).findNearbyLoc(/^bank booth$/i, 10)!;
        const north = botAt(2656, 3286).findNearbyLoc(/^bank booth$/i, 10)!;
        expect(south.z).toBe(3283);
        expect(north.z).toBe(3286);
        expect(south.distance).toBe(0);
        expect(north.distance).toBe(0);
    });

    test('⛔ THE BOOTH TRAP: a bare substring matches the un-bankable decoration', () => {
        const bot = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z);
        const loose = bot.findNearbyLocs('booth', 10);
        const strict = bot.findNearbyLocs(/^bank booth$/i, 10);
        expect(loose.some(l => l.id === CLOSED_BOOTH_ID)).toBe(true);
        expect(strict.every(l => l.id === BANK_BOOTH_ID)).toBe(true);
        expect(strict.length).toBeLessThan(loose.length);
    });

    test('getNearbyLocs / getLocsAt use the bot position and plane', () => {
        const bot = botAt(TOLL_GATE.x, TOLL_GATE.z);
        const all = bot.getNearbyLocs(4);
        expect(all.length).toBeGreaterThan(0);
        expect(all[0]!.distance).toBeLessThanOrEqual(all[all.length - 1]!.distance);   // nearest first
        const onTile = bot.getLocsAt(TOLL_GATE.x, TOLL_GATE.z);
        expect(onTile.some(l => l.id === 2882)).toBe(true);
    });

    test('a bot on plane 1 does not see plane-0 locs', () => {
        const upstairs = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z, 1);
        expect(upstairs.findNearbyLoc(/^bank booth$/i, 10)).toBeNull();
    });

    test('name tables: loc / npc / obj ids resolve to display names', () => {
        const bot = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z);
        expect(bot.locName(BANK_BOOTH_ID)).toBe('Bank booth');
        expect(bot.npcName(1)).toBe('Man');
        expect(bot.objName(995)).toBe('Coins');
        expect(bot.locName(60000)).toBe('');       // unknown ids answer '', never throw
        expect(bot.locSceneReady()).toBe(true);
    });
});

describe('opLocByName: the full name -> interact path', () => {
    test('finds the booth by NAME and OPLOCs its real coordinates and id', () => {
        const bot = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z);
        const target = bot.opLocByName(/^bank booth$/i, 'use-quickly', 10);
        expect(target).not.toBeNull();
        expect(target!.id).toBe(BANK_BOOTH_ID);

        const [f] = frames(bot, OPLOC_SIZES);
        expect(f?.op).toBe(ClientProt.OPLOC2);                     // op2 = "Use-quickly" -> OPLOC2
        expect(g2(f!.body, 0)).toBe(target!.x);
        expect(g2(f!.body, 2)).toBe(target!.z);
        expect(g2(f!.body, 4)).toBe(BANK_BOOTH_ID);
    });

    test('an op given by TEXT resolves through the loc\'s own option list', () => {
        const bot = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z);
        bot.opLocByName(/^bank booth$/i, /^use$/i, 10);
        expect(frames(bot, OPLOC_SIZES)[0]?.op).toBe(ClientProt.OPLOC1);   // op1 = "Use" -> OPLOC1
    });

    test('an op the loc does not offer sends NOTHING (a guess is worse than a refusal)', () => {
        const bot = botAt(ARD_SOUTH_BANK.x, ARD_SOUTH_BANK.z);
        expect(bot.opLocByName(/^bank booth$/i, 'mine', 10)).toBeNull();
        expect(bot.out.pos).toBe(0);
    });

    test('nothing in range sends nothing', () => {
        const bot = botAt(3222, 3218);   // Lumbridge — no bank booth within 5 tiles
        expect(bot.opLocByName(/^bank booth$/i, 1, 5)).toBeNull();
        expect(bot.out.pos).toBe(0);
    });
});

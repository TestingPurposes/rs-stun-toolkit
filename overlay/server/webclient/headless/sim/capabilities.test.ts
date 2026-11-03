// bun test server/webclient/headless/sim/capabilities.test.ts
//
// The capability package's decode + primitive tests (VARP, run energy, npc hitsplat retention,
// dialog-by-text, prayer, combat-style set-with-verify, shop, unequip).
//
// TWO LAYERS, ON PURPOSE:
//   1. CRAFTED-PACKET ALIGNMENT — every new decode is fed bytes built by the sim's encoders (which are
//      themselves copied from the ENGINE'S encoders) and asserted to leave the cursor exactly at psize.
//      Byte-alignment is the one bug class in this client that is fatal and silent: the ISAAC
//      stream advances once per opcode, so a decode that reads one byte too few does not fail here — it
//      fails 400 packets later, on a different bot, as a desync nobody can trace back.
//   2. BEHAVIOUR THROUGH THE REAL DECODE LOOP — the SimHarness drives an actual LeanBot's run() over
//      those same packets, so the primitives are exercised end to end rather than unit-tested against a
//      mock. (This is the harness that caught the npc stale-tile bug.)
import { describe, test, expect } from 'bun:test';
import Isaac from '#/io/Isaac.js';
import Packet from '#/io/Packet.js';
import { ServerProt, ServerProtSizes } from '#/io/ServerProt.js';
import { ServerPacketStream } from './protocol.js';
import { SimHarness } from './harness.js';
import { SimWorld, openField } from './world.js';
import { LeanBot } from '../leanbot.js';
import {
    VARP, PRAYER, PRAYERS, STYLE_INTERFACE, STYLE_BUTTON_LOOKUP, DIALOG_ROOTS, DIALOG_ROOT_BY_ID,
    SHOP, SHOP_BUY_BUTTON, SHOP_SELL_BUTTON, WORN_INV, UNEQUIP_BUTTON, MAX_VARP_ID,
} from '../capability-tables.js';

const IN_SEED = [11, 22, 33, 44];

// Decode one framed server packet with a mirrored ISAAC (verbatim from protocol.test.ts).
function decodeFrame(cipher: Isaac, bytes: Uint8Array): { opcode: number; buf: Packet; size: number } {
    let p = 0;
    const opcode = (bytes[p++]! - cipher.nextInt) & 0xff;
    let size = ServerProtSizes[opcode]!;
    if (size === -1) size = bytes[p++]!;
    else if (size === -2) { size = (bytes[p]! << 8) | bytes[p + 1]!; p += 2; }
    const buf = new Packet(new Uint8Array(bytes.subarray(p, p + size)));
    return { opcode, buf, size };
}

// =====================================================================================================
// 1. CRAFTED-PACKET ALIGNMENT
// =====================================================================================================
describe('VARP packets frame and decode with exact alignment', () => {
    test('VARP_SMALL is p2(varp) + p1(value), declared size 3', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { opcode, buf, size } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.varpSmall(VARP.COM_MODE, 2));
        expect(opcode).toBe(ServerProt.VARP_SMALL);
        expect(size).toBe(3);
        expect(buf.g2()).toBe(VARP.COM_MODE);
        expect(buf.g1b()).toBe(2);
        expect(buf.pos).toBe(size);   // ⛔ the alignment assertion: cursor lands exactly on psize
    });

    test('VARP_SMALL value is SIGNED (g1b) — a negative varp must not read as 200+', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { buf, size } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.varpSmall(7, -3));
        expect(buf.g2()).toBe(7);
        expect(buf.g1b()).toBe(-3);
        expect(buf.pos).toBe(size);
    });

    test('VARP_LARGE is p2(varp) + p4(value), declared size 6', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { opcode, buf, size } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.varpLarge(115, 1_000_000));
        expect(opcode).toBe(ServerProt.VARP_LARGE);
        expect(size).toBe(6);
        expect(buf.g2()).toBe(115);
        expect(buf.g4()).toBe(1_000_000);
        expect(buf.pos).toBe(size);
    });

    test('VARP_SYNC is zero-length', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { opcode, size } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.varpSync());
        expect(opcode).toBe(ServerProt.VARP_SYNC);
        expect(size).toBe(0);
    });

    test('the encoder picks the same form the engine would', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const cipher = new Isaac(new Int32Array(IN_SEED));
        expect(decodeFrame(cipher, enc.varp(43, 127)).opcode).toBe(ServerProt.VARP_SMALL);
        expect(decodeFrame(cipher, enc.varp(43, 128)).opcode).toBe(ServerProt.VARP_LARGE);
        expect(decodeFrame(cipher, enc.varp(43, -128)).opcode).toBe(ServerProt.VARP_SMALL);
        expect(decodeFrame(cipher, enc.varp(43, -129)).opcode).toBe(ServerProt.VARP_LARGE);
    });
});

describe('UPDATE_RUNENERGY frames and decodes with exact alignment', () => {
    test('one unsigned byte, declared size 1, carrying a 0..100 percent', () => {
        const enc = new ServerPacketStream(IN_SEED);
        const { opcode, buf, size } = decodeFrame(new Isaac(new Int32Array(IN_SEED)), enc.updateRunEnergy(73));
        expect(opcode).toBe(ServerProt.UPDATE_RUNENERGY);
        expect(size).toBe(1);
        expect(buf.g1()).toBe(73);
        expect(buf.pos).toBe(size);
    });
});

describe('NPC_INFO with a hitsplat stays byte-aligned', () => {
    // The extended block is what makes this dangerous: the newVis bit-loop guard walks the buffer, so
    // the 16383 terminator is REQUIRED when extended bytes follow and FORBIDDEN when they do not. Both
    // arms are asserted, because getting either wrong hangs the decoder rather than erroring.
    test('an add carrying a hitsplat round-trips through the real decoder', async () => {
        const world = new SimWorld(3222, 3218, openField());
        world.addNpc(5, 1, 3224, 3218);
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueNpcHit(5, { damage: 7, type: 1, hp: 3, maxHp: 10 });
        await h.tick();
        const npc = bot.npcs[5]!;
        expect(npc).toBeTruthy();
        expect(npc.lastDamage).toBe(7);
        expect(npc.lastDamageType).toBe(1);
        expect(npc.hpCur).toBe(3);
        expect(npc.hpMax).toBe(10);
        expect(npc.hitCount).toBe(1);
        expect(npc.healthFrac()).toBeCloseTo(0.3, 5);
        await h.stop();
    });

    test('no hitsplat => no extended bytes, and health reads as UNKNOWN (-1), not full', async () => {
        const world = new SimWorld(3222, 3218, openField());
        world.addNpc(6, 1, 3224, 3218);
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        await h.tick();
        const npc = bot.npcs[6]!;
        expect(npc.lastHitCycle).toBe(-1);
        expect(npc.hpCur).toBe(-1);
        // ⛔ -1 means "never seen", NOT 0/full. A brain that read 0 as 'dead' would be reading absence.
        expect(npc.healthFrac()).toBe(-1);
        await h.stop();
    });

    test('successive hitsplats keep the latest health and count every hit', async () => {
        const world = new SimWorld(3222, 3218, openField());
        world.addNpc(7, 1, 3224, 3218);
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueNpcHit(7, { damage: 4, type: 1, hp: 6, maxHp: 10 });
        await h.tick();
        h.queueNpcHit(7, { damage: 6, type: 1, hp: 0, maxHp: 10 });
        await h.tick();
        const npc = bot.npcs[7]!;
        expect(npc.hitCount).toBe(2);
        expect(npc.hpCur).toBe(0);
        expect(npc.healthFrac()).toBe(0);
        await h.stop();
    });
});

// =====================================================================================================
// 2. VARP STORE, THROUGH THE REAL DECODE LOOP
// =====================================================================================================
describe('varp store', () => {
    test('small and large varps land in the store and stamp their change tick', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueVarpSmall(VARP.COM_MODE, 2);
        h.queueVarpLarge(200, 123_456);
        await h.tick();
        expect(bot.getVarp(VARP.COM_MODE)).toBe(2);
        expect(bot.getVarp(200)).toBe(123_456);
        expect(bot.varpChangedAt(VARP.COM_MODE)).toBeGreaterThanOrEqual(0);
        // never-sent varps read 0, which is also their server-side default
        expect(bot.getVarp(301)).toBe(0);
        expect(bot.varpChangedAt(301)).toBe(-1);
        await h.stop();
    });

    test('an out-of-range varp id is ignored, not thrown on', async () => {
        // A decode-loop throw kills the bot. The varp set can grow server-side, and a value we do not
        // even read must never be able to drop a farmer.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueVarpSmall(MAX_VARP_ID + 50, 9);
        h.queueVarpSmall(VARP.COM_MODE, 3);
        await h.tick();
        expect(bot.getVarp(VARP.COM_MODE)).toBe(3);   // the stream stayed aligned past the bad id
        await h.stop();
    });

    test('the onVarp hook fires on CHANGES only, and a throwing hook cannot kill the bot', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const seen: Array<[number, number, number]> = [];
        bot.onVarp = (id, v, prev) => { seen.push([id, v, prev]); if (id === 99) throw new Error('hook boom'); };
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueVarpSmall(VARP.COM_MODE, 1);
        await h.tick();
        h.queueVarpSmall(VARP.COM_MODE, 1);   // same value -> no change -> no hook
        await h.tick();
        h.queueVarpSmall(99, 5);              // hook throws here
        h.queueVarpSmall(VARP.COM_MODE, 2);   // ...and the very next varp still lands
        await h.tick();
        expect(seen.filter(s => s[0] === VARP.COM_MODE).length).toBe(2);
        expect(bot.getVarp(VARP.COM_MODE)).toBe(2);
        expect(bot.getVarp(99)).toBe(5);
        await h.stop();
    });

    test('VARP_SYNC is a no-op for a non-predicting client but is counted', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueVarpSmall(VARP.COM_MODE, 2);
        h.queueVarpSync();
        await h.tick();
        expect(bot.getVarp(VARP.COM_MODE)).toBe(2);   // unchanged by the sync
        expect(bot.varpSyncs).toBe(1);
        await h.stop();
    });
});

describe('run energy', () => {
    test('decodes into runEnergy, and is UNKNOWN (-1) before the first packet', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.runEnergy).toBe(-1);
        h.queueRunEnergy(87);
        await h.tick();
        expect(bot.runEnergy).toBe(87);
        h.queueRunEnergy(0);
        await h.tick();
        expect(bot.runEnergy).toBe(0);
        await h.stop();
    });
});

// =====================================================================================================
// 3. DIALOG BY TEXT
// =====================================================================================================
describe('dialog by text', () => {
    const multi2 = DIALOG_ROOT_BY_ID.get(2459)!;
    const multi3 = DIALOG_ROOT_BY_ID.get(2469)!;

    async function openChoice(bot: LeanBot, h: SimHarness, root: typeof multi2, labels: string[]) {
        h.queueOpenChat(root.root);
        h.queueSetText(root.headerCom, 'Select an Option');
        labels.forEach((t, i) => h.queueSetText(root.optionComs[i]!, t));
        await h.tick();
    }

    test('reads the option labels the engine sent', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.mode = 'combat';
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openChoice(bot, h, multi2, ["I think I'll give it a miss.", 'Yes please.']);
        expect(bot.dialogHeader()).toBe('Select an Option');
        expect(bot.dialogOptions().map(o => o.text)).toEqual(["I think I'll give it a miss.", 'Yes please.']);
        await h.stop();
    });

    test('clickDialogByText picks the matching option and returns its 1-based number', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openChoice(bot, h, multi2, ["I think I'll give it a miss.", 'Yes please.']);
        expect(bot.clickDialogByText(/^yes/i)).toBe(2);
        await h.stop();
    });

    test('a non-matching pattern sends NOTHING and reports -1', async () => {
        // The caller must be able to tell "no option matched" from "I picked something" — a primitive
        // that silently fell back to option 1 would answer the wrong question and look successful.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openChoice(bot, h, multi2, ['Nope.', 'Also nope.']);
        expect(bot.clickDialogByText(/^yes/i)).toBe(-1);
        await h.stop();
    });

    test('option index is INDEPENDENT of option count — the multi3 case that breaks a hardcoded index', async () => {
        // kebab_seller.rs2 opens multi2 normally but MULTI3 while %crestquest is set. A bot keyed to a
        // component id (or to "root+3") is answering a different question the moment an unrelated quest
        // var moves; a text match is stable across both.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openChoice(bot, h, multi3, ["I think I'll give it a miss.", 'Yes please.', 'I am looking for Avan.']);
        expect(bot.clickDialogByText(/^yes/i)).toBe(2);
        expect(bot.dialogOptions().length).toBe(3);
        await h.stop();
    });

    test('an empty dialogPolicy leaves driveDialog on option 1 — the no-regression guarantee', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.dialogPolicy.length).toBe(0);
        h.queueOpenChat(multi2.root);
        h.queueSetText(multi2.optionComs[0]!, 'Yes please.');
        h.queueSetText(multi2.optionComs[1]!, 'No thanks.');
        const r = await h.tick();
        const btn = r.actions.find(a => a.type === 'ifbutton');
        expect(btn && (btn as { com: number }).com).toBe(multi2.optionComs[0]);
        await h.stop();
    });

    test('a dialogPolicy drives a NON-default option', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.dialogPolicy = [{ match: /^no thanks/i, label: 'decline' }];
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueOpenChat(multi2.root);
        h.queueSetText(multi2.optionComs[0]!, 'Yes please.');
        h.queueSetText(multi2.optionComs[1]!, 'No thanks.');
        const r = await h.tick();
        const btn = r.actions.find(a => a.type === 'ifbutton');
        expect(btn && (btn as { com: number }).com).toBe(multi2.optionComs[1]);
        await h.stop();
    });

    test('policies are consulted IN ORDER — first match wins', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.dialogPolicy = [{ match: /please/i }, { match: /^yes/i }];
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueOpenChat(multi3.root);
        h.queueSetText(multi3.optionComs[0]!, 'Yes.');
        h.queueSetText(multi3.optionComs[1]!, 'Certainly, please.');
        h.queueSetText(multi3.optionComs[2]!, 'No.');
        const r = await h.tick();
        const btn = r.actions.find(a => a.type === 'ifbutton');
        expect(btn && (btn as { com: number }).com).toBe(multi3.optionComs[1]);
        await h.stop();
    });
});

// =====================================================================================================
// 4. PRAYER
// =====================================================================================================
describe('prayer toggle + readback', () => {
    test('the generated table binds every prayer to a distinct component and varp', () => {
        expect(PRAYERS.length).toBe(15);
        expect(new Set(PRAYERS.map(p => p.com)).size).toBe(15);
        expect(new Set(PRAYERS.map(p => p.varp)).size).toBe(15);
        // ⛔ the ordering trap the generator exists to avoid: constants and varps are in DIFFERENT orders
        expect(PRAYER.thickskin!.constValue).toBe(1);
        expect(PRAYER.thickskin!.varpName).toBe('prayer0');
        expect(PRAYER.rockskin!.constValue).toBe(2);
        expect(PRAYER.rockskin!.varpName).toBe('prayer3');   // NOT prayer1
        expect(PRAYER.protectfrommelee!.constValue).toBe(15);
        expect(PRAYER.protectfrommelee!.varpName).toBe('prayer14');
    });

    test('activate clicks the prayer component and confirms from the varp', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.isPrayerActive('protectfrommelee')).toBe(false);
        expect(bot.activatePrayer('protectfrommelee')).toBe(true);
        await h.tick();
        // the server answers by setting the bound varp
        h.queueVarpSmall(PRAYER.protectfrommelee!.varp, 1);
        await h.tick();
        expect(bot.isPrayerActive('protectfrommelee')).toBe(true);
        expect(bot.activePrayers()).toEqual(['protectfrommelee']);
        // idempotent: already lit -> no further click
        expect(bot.activatePrayer('protectfrommelee')).toBe(false);
        await h.stop();
    });

    test('deactivate is a no-op when it is already off', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.deactivatePrayer('protectfrommelee')).toBe(false);
        await h.stop();
    });

    test('a refused click retries on a bounded interval, not every tick', async () => {
        // prayer.rs2:2-8 refuses with a message and return(false) when prayer points are at 0. Retrying
        // every tick would be a packet flood against a server that has already said no.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.prayerConfirmTicks = 4;
        const h = new SimHarness(bot as never, world);
        await h.start();
        let clicks = 0;
        for (let i = 0; i < 12; i++) { if (bot.activatePrayer('thickskin')) clicks++; await h.tick(); }
        expect(clicks).toBeGreaterThan(1);
        expect(clicks).toBeLessThanOrEqual(4);   // 12 ticks / gap 4, never 12
        await h.stop();
    });

    test('prayersActive() is derived from the TRANSMITTED per-prayer varps', async () => {
        // ⛔ REGRESSION LOCK, from a live finding. The obvious signal here is `prayer_drain_effect` —
        // prayer.rs2 keeps it as the drain timer's running total. But it is declared WITHOUT
        // `transmit=yes`, so the server never sends it and any client-side read is 0 forever. The live
        // probe caught exactly that: it read 0 while protect-from-melee was lit and burning 45->44
        // prayer points, i.e. absence looking identical to zero. The generator now refuses to emit a
        // non-transmitted varp, and this asserts the replacement works off varps that do transmit.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.prayersActive()).toBe(false);
        h.queueVarpSmall(PRAYER.protectfrommelee!.varp, 1);
        await h.tick();
        expect(bot.prayersActive()).toBe(true);
        expect(bot.activePrayers()).toEqual(['protectfrommelee']);
        await h.stop();
    });

    test('the table exposes NO non-transmitted varp', () => {
        // VARP holds only com_mode now; the drain pair was removed for the reason above.
        expect(Object.keys(VARP)).toEqual(['COM_MODE']);
    });

    test('an unknown prayer name is refused loudly, not clicked blindly', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.activatePrayer('protect_from_everything')).toBe(false);
        await h.stop();
    });
});

// =====================================================================================================
// 5. COMBAT STYLE — SET WITH VERIFY
// =====================================================================================================
describe('combat style table', () => {
    test('style buttons are NOT in style order — the reason this table is generated', () => {
        const hs = STYLE_INTERFACE.combat_heavysword!;
        expect([hs.buttons[0], hs.buttons[1], hs.buttons[2], hs.buttons[3]]).toEqual([4711, 4714, 4713, 4712]);
        // any "root + style" arithmetic would produce 4711/4712/4713/4714 and select the WRONG style
    });

    test('the scimitar controlled button matches the value the bots have been using live', () => {
        // leanbot.ts has carried `Scimitar/weapon_slash CONTROLLED = 2431` as a hand-verified constant
        // since the trainer was built. The generated table must reproduce it exactly, or the generator
        // is wrong about something already proven against the live server.
        expect(STYLE_INTERFACE.combat_hacksword!.buttons[2]).toBe(2431);
        expect(STYLE_INTERFACE.combat_hacksword!.styleNames[2]).toBe('controlled');
        expect(STYLE_BUTTON_LOOKUP.get(2431)).toEqual({ iface: 'combat_hacksword', style: 2 });
    });

    test('unarmed has NO controlled style — the P0 weapon-supply premise, from the table', () => {
        // outfitter.ts:4-11: weapon_unarmed_table is accurate/aggressive/defensive only, which is why a
        // weaponless bot trains attack alone. A caller must be able to DISCOVER that, not discover it in
        // production an hour later.
        expect(STYLE_INTERFACE.combat_unarmed!.styleNames).toEqual(['accurate', 'aggressive', 'defensive']);
        expect(STYLE_INTERFACE.combat_unarmed!.styleNames).not.toContain('controlled');
    });

    test('styleIndexFor resolves names and reports -1 for styles a weapon does not have', () => {
        const bot = new LeanBot();
        expect(bot.styleIndexFor('combat_hacksword', 'controlled')).toBe(2);
        expect(bot.styleIndexFor('combat_hacksword', 'defensive')).toBe(3);
        expect(bot.styleIndexFor('combat_unarmed', 'controlled')).toBe(-1);
        expect(bot.styleIndexFor('combat_bow', 'rapid')).toBe(1);
        expect(bot.styleIndexFor('no_such_tab', 'controlled')).toBe(-1);
    });
});

describe('combat style set-with-verify', () => {
    test('clicks until com_mode confirms, then stops', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.styleConfirmTicks = 1;
        const h = new SimHarness(bot as never, world);
        await h.start();
        const com = STYLE_INTERFACE.combat_hacksword!.buttons[2]!;

        expect(bot.setCombatStyleByButton(com)).toBe(true);   // first click
        await h.tick();
        expect(bot.styleConfirmed).toBe(false);
        expect(bot.setCombatStyleByButton(com)).toBe(true);   // still unconfirmed -> retry
        await h.tick();

        h.queueVarpSmall(VARP.COM_MODE, 2);                   // server confirms
        await h.tick();
        expect(bot.combatStyle()).toBe(2);
        expect(bot.setCombatStyleByButton(com)).toBe(false);  // confirmed -> no more packets, ever
        expect(bot.styleConfirmed).toBe(true);
        expect(bot.styleFailed).toBe(false);
        await h.stop();
    });

    test('gives up after a bounded number of attempts and LATCHES styleFailed', async () => {
        // The old code could not fail: it clicked three times and declared success. A bot whose style
        // never took looked identical to one whose style took. This is that difference, made visible.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.styleConfirmTicks = 1;
        bot.styleMaxAttempts = 3;
        const h = new SimHarness(bot as never, world);
        // ⛔ MODEL THE REAL FAILURE: a server that accepts the click and changes nothing, because the
        // weapon tab is not bound (nothing of that class worn). This is outfitter.ts:4-11's defect.
        h.answerStyleClicks = false;
        await h.start();
        const com = STYLE_INTERFACE.combat_hacksword!.buttons[2]!;
        let clicks = 0;
        for (let i = 0; i < 20; i++) { if (bot.setCombatStyleByButton(com)) clicks++; await h.tick(); }
        expect(clicks).toBe(3);
        expect(bot.styleFailed).toBe(true);
        expect(bot.styleConfirmed).toBe(false);
        await h.stop();
    });

    test('setCombatStyle by NAME refuses a style the weapon does not have', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.setCombatStyle('combat_unarmed', 'controlled')).toBe(false);
        expect(bot.setCombatStyle('combat_hacksword', 'controlled')).toBe(true);
        await h.stop();
    });

    test('a NEW target resets the attempt budget', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.styleConfirmTicks = 1; bot.styleMaxAttempts = 2;
        const h = new SimHarness(bot as never, world);
        h.answerStyleClicks = false;   // unbound tab, so the first target exhausts its budget
        await h.start();
        const controlled = STYLE_INTERFACE.combat_hacksword!.buttons[2]!;
        const defensive = STYLE_INTERFACE.combat_hacksword!.buttons[3]!;
        for (let i = 0; i < 8; i++) { bot.setCombatStyleByButton(controlled); await h.tick(); }
        expect(bot.styleFailed).toBe(true);
        expect(bot.setCombatStyleByButton(defensive)).toBe(true);   // new target, fresh budget
        expect(bot.styleFailed).toBe(false);
        await h.stop();
    });

    test('com_mode is SCOPE_TEMP: rearmStyle clears the confirm so a reconnect re-asserts it', async () => {
        // com_mode has no scope=perm, so it resets to 0 on every login. A confirm carried across a
        // reconnect would mean the bot never re-selects its style for the rest of the session.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.styleConfirmTicks = 1;
        const h = new SimHarness(bot as never, world);
        await h.start();
        const com = STYLE_INTERFACE.combat_hacksword!.buttons[2]!;
        bot.setCombatStyleByButton(com);
        h.queueVarpSmall(VARP.COM_MODE, 2);
        await h.tick();
        bot.setCombatStyleByButton(com);
        expect(bot.styleConfirmed).toBe(true);
        (bot as unknown as { rearmStyle(): void }).rearmStyle();
        expect(bot.styleConfirmed).toBe(false);
        expect(bot.styleFailed).toBe(false);
        await h.stop();
    });
});

// =====================================================================================================
// 6. SHOP
// =====================================================================================================
describe('shop primitive', () => {
    const COINS = 995, ARROW = 886;

    async function openShop(bot: LeanBot, h: SimHarness, stock: Array<{ id: number; count: number }>, pack: Array<{ id: number; count: number }>) {
        h.queueOpenMain(SHOP.MAIN);
        await h.tick();
        h.queueInv(stock, SHOP.INV);
        h.queueInv(pack, SHOP.SIDE_INV);
        h.queueInv(pack, 3214);
        await h.tick();
        await h.tick();
    }

    test('the generated button table matches shop.rs2: 2/3/4 -> 1/5/10, both sides', () => {
        expect(SHOP_BUY_BUTTON[1]).toBe(2);
        expect(SHOP_BUY_BUTTON[5]).toBe(3);
        expect(SHOP_BUY_BUTTON[10]).toBe(4);
        expect(SHOP_SELL_BUTTON[1]).toBe(2);
        expect(SHOP_SELL_BUTTON[5]).toBe(3);
        expect(SHOP_SELL_BUTTON[10]).toBe(4);
    });

    test('⛔ THE 5x BUG: INV_BUTTON2 buys ONE. shopBuy(obj,1) reports 1, not 5', async () => {
        // shopper.ts:160 clicked button 2 and did `bought += 5`. The primitive returns the quantity the
        // click actually ASKS FOR, taken from the generated table, so the caller cannot invent a number.
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openShop(bot, h, [{ id: ARROW, count: 100 }], [{ id: COINS, count: 5000 }]);
        expect(bot.shopBuy(ARROW, 1)).toBe(1);
        await h.tick();
        expect(SHOP_BUY_BUTTON[1]).toBe(2);   // ...and it is button 2 that does it
        await h.stop();
    });

    test('picks the LARGEST step that overshoots neither the want nor the shelf', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.shopClickGap = 0;
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openShop(bot, h, [{ id: ARROW, count: 100 }], [{ id: COINS, count: 5000 }]);
        expect(bot.shopBuy(ARROW, 10)).toBe(10);
        expect(bot.shopBuy(ARROW, 9)).toBe(5);
        expect(bot.shopBuy(ARROW, 4)).toBe(1);
        expect(bot.shopBuy(ARROW, 0)).toBe(0);
        await h.stop();
    });

    test('never asks for more than the shelf holds', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.shopClickGap = 0;
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openShop(bot, h, [{ id: ARROW, count: 3 }], [{ id: COINS, count: 5000 }]);
        expect(bot.shopStockOf(ARROW)).toBe(3);
        expect(bot.shopBuy(ARROW, 10)).toBe(1);   // 10 and 5 both overshoot a shelf of 3
        await h.stop();
    });

    test('a sold-out line still SHOWS but is not buyable', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.shopClickGap = 0;
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openShop(bot, h, [{ id: ARROW, count: 0 }], [{ id: COINS, count: 5000 }]);
        expect(bot.shopStock().length).toBe(1);     // present
        expect(bot.shopStockOf(ARROW)).toBe(0);     // but empty
        expect(bot.shopBuy(ARROW, 1)).toBe(0);      // and refused
        await h.stop();
    });

    test('sell uses the SIDE inv slot and is capped by what we hold', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.shopClickGap = 0;
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openShop(bot, h, [{ id: ARROW, count: 10 }], [{ id: COINS, count: 100 }, { id: ARROW, count: 3 }]);
        expect(bot.shopSellSlotOf(ARROW)).toBe(1);
        expect(bot.shopSell(ARROW, 10)).toBe(1);    // we only hold 3, so 10 and 5 both overshoot
        await h.stop();
    });

    test('nothing is sent when no shop is open', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.shopIsOpen()).toBe(false);
        expect(bot.shopBuy(ARROW, 1)).toBe(0);
        expect(bot.shopSell(ARROW, 1)).toBe(0);
        await h.stop();
    });

    test('the click gap holds off a second buy against a stale inventory read', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        bot.shopClickGap = 3;
        const h = new SimHarness(bot as never, world);
        await h.start();
        await openShop(bot, h, [{ id: ARROW, count: 100 }], [{ id: COINS, count: 5000 }]);
        expect(bot.shopBuy(ARROW, 1)).toBe(1);
        expect(bot.shopBuy(ARROW, 1)).toBe(0);   // same tick -> refused
        await h.stop();
    });
});

// =====================================================================================================
// 7. UNEQUIP
// =====================================================================================================
describe('unequip', () => {
    const SCIM = 1321;

    test('the recipe is INV_BUTTON1 on the WORN container, naming the WORN slot', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueInv([{ id: -1, count: 0 }, { id: -1, count: 0 }, { id: -1, count: 0 }, { id: SCIM, count: 1 }], WORN_INV);
        await h.tick();
        await h.tick();
        expect(bot.wornSlotOf(SCIM)).toBe(3);
        expect(bot.unequipItem(SCIM)).toBe(true);
        const r = await h.tick();
        const btn = r.actions.find(a => a.type === 'invbutton') as undefined | { op: number; obj: number; slot: number; com: number };
        expect(btn).toBeTruthy();
        expect(btn!.op).toBe(UNEQUIP_BUTTON);   // 1, from [inv_button1,wornitems:wear]
        expect(btn!.com).toBe(WORN_INV);        // the WORN container, not the backpack
        expect(btn!.slot).toBe(3);              // the WORN slot
        expect(btn!.obj).toBe(SCIM);
        await h.stop();
    });

    test('unequipping something not worn sends nothing', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.unequipItem(SCIM)).toBe(false);
        await h.stop();
    });

    test('wornSlots lists everything equipped', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueInv([{ id: 1153, count: 1 }, { id: -1, count: 0 }, { id: -1, count: 0 }, { id: SCIM, count: 1 }], WORN_INV);
        await h.tick();
        await h.tick();
        expect(bot.wornSlots()).toEqual([
            { slot: 0, obj: 1153, count: 1 },
            { slot: 3, obj: SCIM, count: 1 },
        ]);
        await h.stop();
    });
});

// =====================================================================================================
// 8. RUNE EXHAUSTION
// =====================================================================================================
describe('rune exhaustion detection', () => {
    test('the exact magic.rs2 message raises the flag and names the rune', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        expect(bot.noRunesMsgs).toBe(0);
        // magic.rs2:35 — `oc_name($rune1)` is "Mind rune"/"Air rune"; string_removeright(...,5) strips
        // the trailing " rune", leaving the bare element name in the message.
        h.queueMessage('You do not have enough Mind Runes to cast this spell.');
        await h.tick();
        expect(bot.noRunesMsgs).toBe(1);
        expect(bot.noRunesFor.has('Mind')).toBe(true);
        expect(bot.lastNoRunesTick).toBeGreaterThan(0);
        await h.stop();
    });

    test('unrelated messages do NOT raise it', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueMessage('You do not have enough coins.');
        h.queueMessage('Your Magic level is not high enough for this spell.');
        h.queueMessage("I can't reach that!");
        await h.tick();
        expect(bot.noRunesMsgs).toBe(0);
        expect(bot.cantReachMsgs).toBe(1);   // the sibling counter still works
        await h.stop();
    });

    test('multiple rune types are tracked separately', async () => {
        const world = new SimWorld(3222, 3218, openField());
        const bot = new LeanBot();
        const h = new SimHarness(bot as never, world);
        await h.start();
        h.queueMessage('You do not have enough Air Runes to cast this spell.');
        h.queueMessage('You do not have enough Mind Runes to cast this spell.');
        await h.tick();
        expect(bot.noRunesMsgs).toBe(2);
        expect([...bot.noRunesFor].sort()).toEqual(['Air', 'Mind']);
        await h.stop();
    });
});

// =====================================================================================================
// 9. TABLE INTEGRITY — the generated file must stay internally consistent
// =====================================================================================================
describe('capability table integrity', () => {
    test('dialog option components really are root+1+i', () => {
        for (const d of DIALOG_ROOTS) {
            expect(d.headerCom).toBe(d.root + 1);
            d.optionComs.forEach((com, i) => expect(com).toBe(d.root + 2 + i));
        }
        expect(DIALOG_ROOTS.map(d => d.root)).toEqual([2459, 2469, 2480, 2492]);
        expect(DIALOG_ROOTS.map(d => d.optionComs.length)).toEqual([2, 3, 4, 5]);
    });

    test('every style button appears exactly once in the reverse lookup', () => {
        let total = 0;
        for (const s of Object.values(STYLE_INTERFACE)) {
            for (const [style, com] of Object.entries(s.buttons)) {
                total++;
                expect(STYLE_BUTTON_LOOKUP.get(com)).toEqual({ iface: s.iface, style: Number(style) });
            }
        }
        expect(STYLE_BUTTON_LOOKUP.size).toBe(total);
    });

    test('a weapon with N style buttons has N style names (or none at all)', () => {
        for (const s of Object.values(STYLE_INTERFACE)) {
            const n = Object.keys(s.buttons).length;
            if (s.styleNames.length) expect(s.styleNames.length).toBe(n);
        }
    });

    test('shop / worn / inv ids match the values the bots have been running on', () => {
        // These four have been hand-copied into shopper.ts, quartermaster.ts, outfitter.ts, smithbot.ts
        // and leanbot.ts and proven in production. The generated table must agree with all of them.
        expect(SHOP.MAIN).toBe(3824);
        expect(SHOP.INV).toBe(3900);
        expect(SHOP.SIDE_INV).toBe(3823);
        expect(WORN_INV).toBe(1688);
    });
});

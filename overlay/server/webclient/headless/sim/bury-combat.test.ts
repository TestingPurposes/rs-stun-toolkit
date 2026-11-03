// LOOT + BURY + ATTACK-STYLE SUITE — the offline lock for looting, burying and attack-style selection.
//
// Everything here is a decision test against the REAL LeanBot.run() decode loop. The sim does not model
// combat, so kills/xp/drops are FED IN (the README's contract: assert on decisions, feed the world's
// answers with queueInv/queueStat/queueGroundItem) — which is exactly the right fidelity for these three
// failure modes, all of which have shipped in this project before:
//
//   1. THE SLOT LEAK (the cake-husk precedent). A multi-stage consumable we only half-handled filled 28
//      slots, and a FULL backpack makes the engine throw fresh loot ON THE FLOOR. Bones are
//      the same shape: 18 buryable ids, none stackable, plus 18 unburyable LOOKALIKES (cert_* notes carry
//      the base item's NAME, and mm_* decoys show a "Bury" option that does nothing). A name-matching bot
//      leaks slots forever and looks fine.
//   2. THE STYLE-BEFORE-WIELD BUG. IfButtonHandler rejects the attack-style click unless the component is
//      visible, and the combat tab is only bound to the weapon's style interface once a weapon of that
//      class is WORN. Clicking while unarmed is silently dropped — which once made a hero train ONLY
//      attack while believing it was on controlled.
//   3. THE FOOD-GATE TRAP (KEY-FINDINGS.md:344-358). An absolute `hp <= 20` is ALWAYS TRUE for an
//      untrained 10-HP bot at full health, so the bot walks to the food stall every tick and NEVER
//      fights. It is not dying; it never starts.
//
// Plus one regression that could only be written once the sim learned to speak the ground-item protocol:
// LeanBot decoded OBJ_* only inside UPDATE_ZONE_PARTIAL_ENCLOSED, but a killer's OWN drop arrives as a
// receiver-scoped STANDALONE OBJ_ADD (pickupbot.ts:13) — so it could not see its own kills at all.
import { describe, test, expect, afterEach } from 'bun:test';
import { ClientProt } from '#/io/ClientProt.js';
import { SimWorld, openField } from './world.ts';
import { SimHarness, linePath } from './harness.ts';
import { LeanBot, BURYABLE_BONES, BONE_LOOKALIKES, TargetClaimRegistry } from '../leanbot.ts';
import type { ClientAction } from './protocol.ts';
import { VARP } from '../capability-tables.js';

const BONES = 526, BIG_BONES = 532, CERT_BIG_BONES = 533, MM_DECOY = 3187;
const COINS = 995, SCIMITAR = 1321, KEBAB = 1971;
const STYLE_CONTROLLED = 2431;          // combat_hacksword:hack2 (com_mode 2) — component.sym
const WARRIOR = 18;                     // al_kharid_warrior
const HP_STAT = 3, PRAYER_STAT = 5;
const WORN = 1688, PACK = 3214;
const SITE = { x: 3288, z: 3168 };      // the pilot camp centre

// A trainer-shaped LeanBot: combat mode, already on site, loot+bury on, controlled style on a scimitar.
class TrainerTestBot extends LeanBot {
    constructor() {
        super();
        this.mode = 'combat';
        this.arrived = true;
        this.quiet = true;
        this.combatHpTarget = 99;        // train to 99, never idle out of doCombat
        this.combatTypes = new Set([WARRIOR]);
        this.combatAnchor = SITE;
        this.lootBury = true;
        this.lootTypes = new Set([COINS]);
        this.weaponObj = SCIMITAR;
        this.styleButton = STYLE_CONTROLLED;
        this.foodObj = KEBAB;
        this.healFrac = 0.4;
    }
}

let h: SimHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

async function boot(bot: LeanBot, opts: { npcs?: boolean; pack?: Array<{ id: number; count: number }>; worn?: Array<{ id: number; count: number }> } = {}) {
    const world = new SimWorld(SITE.x, SITE.z, openField());
    if (opts.npcs !== false) world.addNpc(11, WARRIOR, SITE.x + 2, SITE.z);
    h = new SimHarness(bot, world);
    await h.start({ stats: [{ stat: HP_STAT, xp: 980, level: 10 }, { stat: PRAYER_STAT, xp: 0, level: 1 }], inv: opts.pack ?? [] });
    if (opts.worn) { h.queueInv(opts.worn, WORN); await h.tick(); }
    return h;
}
const of = <T extends ClientAction['type']>(ts: { actions: ClientAction[] }[], type: T) =>
    ts.flatMap(t => t.actions).filter(a => a.type === type) as Extract<ClientAction, { type: T }>[];

// ============================================================================
describe('build item 1 — the bury table itself (enumerated from source, not from names)', () => {
    test('every id [opheld1,_bones] handles is present, with its bone_exp', () => {
        // 17 category=bones objs (skill_prayer/configs/bones.obj + _unpack/274/all.obj) + newbiebones,
        // which has no category but its own [opheld1,newbiebones] trigger (tut_bury_bone.rs2:1).
        expect(BURYABLE_BONES.size).toBe(18);
        expect(BURYABLE_BONES.get(BONES)).toBe(45);        // the DEFAULT npc death drop
        expect(BURYABLE_BONES.get(BIG_BONES)).toBe(150);   // giants — 3.33x plain
        expect(BURYABLE_BONES.get(536)).toBe(720);         // dragon_bones
        expect(BURYABLE_BONES.get(2530)).toBe(45);         // newbiebones (own trigger)
    });
    test('the notes and the mm_* decoys are BLACKLISTED, never buryable', () => {
        // cert_* = id+1 and inherits the base NAME (ObjType.ts:308) with no iop -> OpHeldHandler drops the
        // packet. mm_* ninja/gorilla/zombie bones sit in category=6, so `_bones` never fires.
        for (const id of [CERT_BIG_BONES, 527, 3184, MM_DECOY, 3179]) {
            expect(BONE_LOOKALIKES.has(id)).toBe(true);
            expect(BURYABLE_BONES.has(id)).toBe(false);
        }
        // and no id is in both sets (a lookalike we "handled" would be a silent no-op loop)
        for (const id of BURYABLE_BONES.keys()) expect(BONE_LOOKALIKES.has(id)).toBe(false);
    });
});

describe('build item 1 — take then bury', () => {
    test("the killer's OWN drop (standalone OBJ_ADD) is decoded — the FOLLOWS-path defect", async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItem(SITE.x, SITE.z, BONES, 1);       // receiver-scoped: UPDATE_ZONE_PARTIAL_FOLLOWS + OBJ_ADD
        await h!.run(2);
        expect(bot.findGroundItem(BONES, 6)).toBeDefined();
    });

    test('the shared ENCLOSED reveal is decoded too (what other bots see)', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItemEnclosed(SITE.x + 1, SITE.z + 1, BONES, 1);
        await h!.run(2);
        expect(bot.findGroundItem(BONES, 6)).toBeDefined();
    });

    test('bones on the ground -> OPOBJ3 Take at that exact tile; in the pack -> OPHELD1 Bury', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItem(SITE.x, SITE.z + 1, BONES, 1);
        const takeTicks = await h!.run(6);
        const takes = of(takeTicks, 'opobj');
        expect(takes.length).toBeGreaterThan(0);
        expect(takes[0]!.op).toBe(3);
        expect({ x: takes[0]!.x, z: takes[0]!.z, obj: takes[0]!.obj }).toEqual({ x: SITE.x, z: SITE.z + 1, obj: BONES });

        // the server answers: pile gone, bone in the pack
        h!.queueGroundItemGone(SITE.x, SITE.z + 1, BONES);
        h!.queueInv([{ id: BONES, count: 1 }]);
        const buryTicks = await h!.run(6);
        const buries = of(buryTicks, 'opheld').filter(a => a.op === ClientProt.OPHELD1 && a.obj === BONES);
        expect(buries.length).toBeGreaterThan(0);
        expect(buries[0]!.com).toBe(PACK);
        expect(bot.bonesTaken).toBe(1);      // counted from INVENTORY GROWTH, not from the packet we sent
        expect(bot.buryAttempts).toBeGreaterThan(0);
    });

    test('coins are looted too (lootTypes), and counted apart from bones', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItem(SITE.x + 1, SITE.z, COINS, 15);
        const ticks = await h!.run(6);
        const takes = of(ticks, 'opobj').filter(a => a.obj === COINS);
        expect(takes.length).toBeGreaterThan(0);
        expect(bot.lootTaken).toBeGreaterThan(0);
        expect(bot.bonesTaken).toBe(0);
    });

    test('the BIG bone is buried FIRST (3.33x xp, and a death would lose it)', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { pack: [{ id: BONES, count: 1 }, { id: BIG_BONES, count: 1 }], worn: [{ id: SCIMITAR, count: 1 }] });
        const ticks = await h!.run(4);
        const buries = of(ticks, 'opheld').filter(a => a.op === ClientProt.OPHELD1);
        expect(buries.length).toBeGreaterThan(0);
        expect(buries[0]!.obj).toBe(BIG_BONES);
    });

    test('a NOTED bone is never buried and shows up in the leak counter (the husk shape)', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { pack: [{ id: CERT_BIG_BONES, count: 5 }, { id: MM_DECOY, count: 1 }], worn: [{ id: SCIMITAR, count: 1 }] });
        const ticks = await h!.run(8);
        expect(of(ticks, 'opheld').filter(a => a.op === ClientProt.OPHELD1).length).toBe(0);   // zero pointless buries
        expect(bot.bonesHeld()).toBe(0);
        expect(bot.boneNotesHeld()).toBe(6);                                    // 5 notes + 1 decoy, VISIBLE
        expect(of(ticks, 'opnpc').filter(a => a.op === 2).length).toBeGreaterThan(0);   // and it keeps fighting
    });

    test('NO MOVE is sent while a bury is pending (p_stopaction would cancel it)', async () => {
        // A pile 4 tiles away plus a bone in the pack: the bury must win the tick, and the MOVE the take
        // wants must not be emitted until the bury has landed. This is the whole reason bury runs first.
        const bot = new TrainerTestBot();
        await boot(bot, { pack: [{ id: BONES, count: 1 }], worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItem(SITE.x + 4, SITE.z + 4, BONES, 1);
        const ticks = await h!.run(8);
        const first = ticks.findIndex(t => t.actions.some(a => a.type === 'opheld' && a.op === ClientProt.OPHELD1));
        expect(first).toBeGreaterThanOrEqual(0);
        for (let i = first; i < Math.min(first + bot.buryCadence, ticks.length); i++) {
            expect(ticks[i]!.actions.filter(a => a.type === 'move')).toHaveLength(0);
        }
    });

    test('a full backpack stops taking (never make the engine throw loot on the floor)', async () => {
        const bot = new TrainerTestBot();
        const full = Array.from({ length: 28 }, () => ({ id: KEBAB, count: 1 }));
        await boot(bot, { pack: full, worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItem(SITE.x, SITE.z + 1, BONES, 1);
        const ticks = await h!.run(6);
        expect(bot.freePackSlots()).toBe(0);
        expect(of(ticks, 'opobj')).toHaveLength(0);
        expect(of(ticks, 'opnpc').filter(a => a.op === 2).length).toBeGreaterThan(0);   // fights instead
    });

    test('an UNREACHABLE pile is blacklisted, and the bot goes back to fighting', async () => {
        // The pile never disappears (we never answer with an inv update) — the live shape of a drop behind
        // a wall. A loot loop that never gives up is a bot earning ZERO inside a healthy conn=.
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueGroundItem(SITE.x + 5, SITE.z + 5, BONES, 1);
        const early = await h!.run(24);
        expect(of(early, 'opobj').length).toBeLessThanOrEqual(7);   // 6 tries, then it stops asking
        const late = await h!.run(12);
        expect(of(late, 'opobj')).toHaveLength(0);
        expect(of(late, 'opnpc').filter(a => a.op === 2).length).toBeGreaterThan(0);
    });

    test('buries are counted from PRAYER XP (the server ledger), not from packets sent', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { pack: [{ id: BONES, count: 1 }], worn: [{ id: SCIMITAR, count: 1 }] });
        await h!.run(3);
        expect(bot.buryAttempts).toBeGreaterThan(0);
        expect(bot.bonesBuried).toBe(0);                     // sent != succeeded
        h!.queueStat(PRAYER_STAT, 1125, 1);                  // bone_exp 45 * 25 internal
        await h!.run(2);
        expect(bot.bonesBuried).toBe(1);
    });
});

// ============================================================================
describe('build item 2 — attack style, food threshold, spare weapon', () => {
    test('WIELD comes first, THEN the style click (the silently-rejected-click bug)', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { pack: [{ id: SCIMITAR, count: 1 }] });   // in the pack, nothing worn
        const wieldTicks = await h!.run(2);
        const wields = of(wieldTicks, 'wield').filter(a => a.obj === SCIMITAR);
        expect(wields.length).toBeGreaterThan(0);
        expect(of(wieldTicks, 'ifbutton')).toHaveLength(0);        // NOT before it is worn

        h!.queueInv([{ id: SCIMITAR, count: 1 }], WORN);           // server: it is worn now
        h!.queueInv([]);                                           // and out of the pack
        const styleTicks = await h!.run(5);
        const clicks = of(styleTicks, 'ifbutton').filter(a => a.com === STYLE_CONTROLLED);
        expect(clicks.length).toBeGreaterThan(0);
        expect(clicks.length).toBeLessThanOrEqual(3);               // retried a bounded number of times
    });

    test('controlled is com_mode 2 on a scimitar = component 2431, NOT the damagestyle constant 3', () => {
        // The trap: ^style_melee_controlled = 3 is the INTERNAL damagestyle (varp 37). The client-side
        // com_mode for controlled on weapon_slash is 2 (combat.dbrow weapon_slash_table row 3), whose
        // button is hack2 = 2431 — and component.sym numbers the buttons out of style order
        // (2429/2432/2431/2430 for accurate/aggressive/controlled/defensive).
        expect(STYLE_CONTROLLED).toBe(2431);
    });

    test('style is NOT re-clicked forever once set (com_mode is sticky within a session)', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        const ticks = await h!.run(20);
        expect(of(ticks, 'ifbutton').filter(a => a.com === STYLE_CONTROLLED).length).toBeLessThanOrEqual(3);
    });

    test('a SPARE weapon is re-wielded after a death, and the style is re-armed', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        await h!.run(5);                                            // settle: worn + style set
        const before = of(await h!.run(2), 'ifbutton').length;
        expect(before).toBe(0);                                     // style already done

        // DEATH: death.rs2 drops everything, so the worn slot empties. The bot walks back with a spare.
        h!.queueMessage('Oh dear, you are dead!');
        h!.queueInv([], WORN);
        h!.queueInv([{ id: SCIMITAR, count: 1 }]);                  // the spare
        await h!.run(2);
        expect(bot.deathCount).toBe(1);
        bot.arrived = true;
        const after = await h!.run(4);
        expect(of(after, 'wield').filter(a => a.obj === SCIMITAR).length).toBeGreaterThan(0);

        h!.queueInv([{ id: SCIMITAR, count: 1 }], WORN);
        h!.queueInv([]);
        await h!.run(4);
        // ⛔ ASSERTION UPDATED, and the change is a STRENGTHENING, not a loosening.
        // This used to assert "a style button was clicked again". That click was REDUNDANT and the test
        // was pinning an implementation detail: nothing in the engine resets %com_mode on a re-wield.
        // player_combat_stat.rs2:48 only CLAMPS it (`min(%com_mode, styleCount-1)`), and com_mode is a
        // player varp that survives a death — only a LOGOUT clears it (it is SCOPE_TEMP). So the correct
        // post-death behaviour is: the bot is still on controlled, and spends no packet re-saying so.
        // What actually matters is the OUTCOME, which we can now read off the server instead of
        // inferring from click counts:
        expect(bot.combatStyle()).toBe(2);          // com_mode 2 = controlled on weapon_slash
        expect(bot.styleConfirmed).toBe(true);
        expect(bot.styleFailed).toBe(false);

        // ...and the re-arm is still real: drop com_mode the way a RELOG does (SCOPE_TEMP -> 0) and the
        // bot must notice and re-select. This is the case the old assertion was reaching for.
        // (queueVarp is a PRE packet, so the bot sees com_mode=0 on the very next tick and reacts on
        // that same tick — the window must include it.)
        h!.queueVarp(VARP.COM_MODE, 0);
        const reclicked = await h!.run(6);
        expect(of(reclicked, 'ifbutton').filter(a => a.com === STYLE_CONTROLLED).length).toBeGreaterThan(0);
    });

    test('no weapon and no spare -> weaponMissing is FLAGGED and the bot fights on with fists', async () => {
        // Absence must never look like zero: a bot silently punching for an hour is the failure we could
        // not see. It still trains (attack only, unarmed has NO controlled row in combat.dbrow), but the
        // flag is what a reporter surfaces.
        const bot = new TrainerTestBot();
        await boot(bot, {});
        const ticks = await h!.run(4);
        expect(bot.weaponMissing).toBe(true);
        expect(of(ticks, 'opnpc').filter(a => a.op === 2).length).toBeGreaterThan(0);
    });

    test('FOOD GATE: the threshold is RELATIVE, so it is never always-true for a 10-HP bot', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { pack: [{ id: KEBAB, count: 4 }], worn: [{ id: SCIMITAR, count: 1 }] });
        expect(bot.maxHp).toBe(10);   // derived from xp 980 = internal 9,800 = levelExperience[8]
        expect(bot.eatAtHp()).toBe(4);                  // max(2, floor(10*0.4)) — NOT the flat 20 that
        expect(bot.eatAtHp()).toBeLessThan(bot.maxHp);

        // at FULL health it must not eat...
        const healthy = await h!.run(4);
        expect(of(healthy, 'opheld').filter(a => a.obj === KEBAB)).toHaveLength(0);
        // ...and at/below the relative threshold it must
        h!.queueStat(HP_STAT, 980, 4);
        const hurt = await h!.run(4);
        expect(of(hurt, 'opheld').filter(a => a.op === ClientProt.OPHELD1 && a.obj === KEBAB).length).toBeGreaterThan(0);
    });

    test('maxHp is DERIVED FROM XP, not "the most hp I have seen" (the poisoned-denominator bug)', async () => {
        // A bot that reconnects HURT used to report maxHp = its current hp, so the relative gate
        // max(2, floor(maxHp*0.4)) collapsed to 2. LIVE-CAUGHT: a bot logged in at 1/25, reported
        // maxHp=1, and then walked 20 tiles at 1 HP holding 14 kebabs. The base level is exactly
        // derivable from xp (Player.ts:77-95), so it is derived.
        const bot = new TrainerTestBot();
        const world = new SimWorld(SITE.x, SITE.z, openField());
        h = new SimHarness(bot, world);
        await h.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 1 }], inv: [] });   // hp base 19, at 1 hp
        expect(bot.hp).toBe(1);
        expect(bot.maxHp).toBe(19);            // NOT 1
        expect(bot.eatAtHp()).toBe(7);         // max(2, floor(19*0.4)) — a threshold with real headroom
    });

    test('an ABSOLUTE threshold still works when healFrac is off (no behaviour change for old brains)', async () => {
        const bot = new TrainerTestBot();
        bot.healFrac = 0;
        bot.healThreshold = 4;
        await boot(bot, { pack: [{ id: KEBAB, count: 4 }], worn: [{ id: SCIMITAR, count: 1 }] });
        expect(bot.eatAtHp()).toBe(4);
    });
});

// ============================================================================
describe('the multiway experiment instrument', () => {
    test('"Someone else is fighting that." is counted as a LOCK, separately from the macro-event message', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        h!.queueMessage('Someone else is fighting that.');
        await h!.tick();
        h!.queueMessage("I'm already under attack!");
        await h!.tick();
        h!.queueMessage("It's not after you.");
        await h!.tick();
        h!.queueMessage("I can't reach that!");
        await h!.tick();
        expect(bot.combatLockMsgs).toBe(1);      // 0 of these in a multiway zone = hypothesis CONFIRMED
        expect(bot.underAttackMsgs).toBe(1);
        expect(bot.notAfterYouMsgs).toBe(1);     // OUTSIDE the map_multiway guard — does NOT falsify it
        expect(bot.cantReachMsgs).toBe(1);
    });

    test('damage dealt is derived from the engine hitpoints grant (33.25 DISPLAYED xp per damage)', async () => {
        const bot = new TrainerTestBot();
        await boot(bot, { worn: [{ id: SCIMITAR, count: 1 }] });
        await h!.run(2);
        expect(bot.damageDealt()).toBe(0);
        // 100 damage: 13.3 arg/dmg x 25 xprate / 10 (the wire sends DISPLAYED xp — UpdateStatEncoder.ts:11)
        h!.queueStat(HP_STAT, 980 + 3325, 10);
        await h!.run(2);
        expect(Math.round(bot.damageDealt())).toBe(100);
    });
});

// =====================================================================================================
// FIRING CADENCE — the attack send gate and the HONEST tick buckets
// =====================================================================================================
// §9o read `firing` 10.5% as "the bots only swing 1 tick in 7" and set the model's dutyCycle to it. But
// `firing` was the tick on which the CLIENT re-sent OPNPC2, and that send is gated to once per 8 ticks —
// so its ceiling is 12.5% BY CONSTRUCTION, and a live run read 13.0% of its combat ticks, i.e. the
// gate was SATURATED. No bot behaviour can move that number; "get firing to 30%" is arithmetically
// impossible. These tests pin the replacement:
//
//   * the client sends when the fight is NOT running, and shuts up while it is — the engine re-arms the
//     interaction itself every tick (`player_melee.rs2` ends with `p_opnpc(2)`), and a client re-send tears
//     that down (`OpNpcHandler` -> `clearPendingAction()`) AND re-runs `~player_in_combat_check`, which in a
//     SINGLE-WAY zone answers "Someone else is fighting that." and ENDS a fight the server was running;
//   * a NEW target is engaged IMMEDIATELY (the old 8-tick gate spent up to 2.4s of a ~22s kill cycle idle,
//     because the engine stops re-arming the moment an npc is no longer attackable);
//   * `swingsLanded` counts hp-xp GRANT ticks, the only swing signal a client can see, so the duty cycle
//     can be measured as swings / (ticks / attackrate) instead of read off a bucket label.
describe('the attack send gate + honest tick buckets', () => {
    const WARRIOR = 18, HP_STAT = 3;

    function mkCombatBot(): LeanBot {
        const b = new LeanBot();
        b.quiet = true;
        b.mode = 'combat';
        b.arrived = true;
        b.combatTypes = new Set([WARRIOR]);
        // combatHpTarget is protected (it is a brain knob, not a public field) — a test may still set it
        (b as unknown as { combatHpTarget: number }).combatHpTarget = 99;
        b.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        return b;
    }
    const attacks = (ts: { actions: ClientAction[] }[]) =>
        ts.flatMap(t => t.actions).filter(a => a.type === 'opnpc' && a.op === 2);

    test('THE FIRST ATTACK IS SENT (a bot that has never swung is not "already fighting")', async () => {
        // ⛔ THE REGRESSION THIS CATCHES: keying "a fight is running" on `lastHpXpGainTick` alone made a
        // freshly logged-in bot (gain tick 0, tickCount ~0) believe a fight was already under way and never
        // open one. It failed 6 unrelated combat tests at once, which is how it was found.
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        const ticks = await h!.run(6);
        expect(attacks(ticks).length).toBeGreaterThan(0);
    });

    test('while the fight is RUNNING (xp landing) the client stays QUIET', async () => {
        // Every redundant re-send re-enters player_in_combat_check, which at a single-way camp can kill the
        // fight outright. The server does not need us: player_melee.rs2 re-arms with p_opnpc(2) itself.
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(4);                                  // opens the fight
        // now feed hp xp every tick, the way a running fight does
        let xp = 3_000;
        const quiet: number[] = [];
        for (let i = 0; i < 10; i++) {
            xp += 40;
            h!.queueStat(HP_STAT, xp, 19);
            const t = await h!.tick();
            quiet.push(t.actions.filter(a => a.type === 'opnpc' && a.op === 2).length);
        }
        expect(quiet.reduce((a, b) => a + b, 0)).toBe(0);      // not one redundant OPNPC2
        expect(bot.swingsLanded).toBeGreaterThan(0);           // and the swings were COUNTED
        expect(bot.tickBudget.swinging ?? 0).toBeGreaterThan(0);
    });

    test('a NEW target is engaged immediately, not after the 8-tick gate', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(4);
        const opsBefore = bot.attackOps;
        const tickBefore = bot.tickCount;
        // the npc dies: it leaves the scene and a fresh one spawns elsewhere in view
        world.npcs.delete(11);
        world.addNpc(12, WARRIOR, 3287, 3168);
        const after = await h!.run(4);
        // ⛔ THE POINT: the re-engage happens well inside the OLD 8-tick gate. At a 22s kill cycle those
        // idle ticks were ~10% of the whole duty cycle, spent standing next to a fresh npc.
        expect(bot.attackOps).toBeGreaterThan(opsBefore);
        expect(bot.tickCount - tickBefore).toBeLessThan(8);
        expect(attacks(after).length).toBeGreaterThan(0);
    });

    test('the buckets partition the combat loop into swinging / adjWait / approach', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3294, 3168);            // 6 tiles away: an APPROACH, not a swing
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(6);
        expect((bot.tickBudget.approach ?? 0) + (bot.tickBudget.attackSent ?? 0)).toBeGreaterThan(0);
        expect(bot.tickBudget.swinging ?? 0).toBe(0);     // no xp has landed, so nothing may claim a swing
        // ⛔ AND THE OLD LABEL IS GONE, on purpose: a model that multiplies `firing` is multiplying the
        // client's re-send cadence (ceiling 12.5%), and a rename is the only way to make that impossible
        // to consume by accident.
        expect(bot.tickBudget.firing).toBeUndefined();
        expect(bot.tickBudget.engaged).toBeUndefined();
    });

    test('adjWait is charged when we stand next to the target and no xp lands', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);            // cardinally adjacent = melee reach
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(12);                                  // adjacent, and the sim never grants xp
        expect(bot.tickBudget.adjWait ?? 0).toBeGreaterThan(0);
        expect(bot.swingsLanded).toBe(0);
        // the duty cycle this measures is ZERO, which is the honest reading of a fight that never landed —
        // the old instrumentation would have called these ticks `engaged` and looked busy
        expect(bot.tickBudget.swinging ?? 0).toBe(0);
    });

    test('a target that pays NOTHING is abandoned in 10 ticks, not 20', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        world.addNpc(12, WARRIOR, 3287, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(3);
        const peek = bot as unknown as { combatTargetIdx: number; combatRepick: number };
        expect(peek.combatTargetIdx).toBeGreaterThan(0);
        const repicksBefore = peek.combatRepick;
        await h!.run(12);                                  // 12 > targetAbandonTicks (10), no xp ever lands
        // the ABANDON is what this measures, not which npc it lands on next: with two npcs in scene the
        // uid-spread pick legitimately alternates between them, so the index can come back around.
        expect(peek.combatRepick).toBeGreaterThan(repicksBefore);
        expect(bot.targetAbandonTicks).toBe(10);           // and the window really is the shorter one
    });
});

// =====================================================================================================
// FIGHT UPTIME INSTRUMENTS — count the silent gap, do not patch a guessed mechanism
// =====================================================================================================
// The dead time is SILENT: across a 1,600-tick gap the server said nothing at all (no "already under
// attack", no "can't reach"; `npc_is_attackable` almost always emits a mes(), so it is not that either).
// The only silent no-swing exits in `player_melee.rs2` are `:8` (%action_delay not yet clear — harmless)
// and `:13` (npc at 0 hp mid-death-animation). So the server will never explain it and it has to be
// counted client-side. Measured shape: adjacent for 779 of 800 ticks, in an ARMED fight ~19% of them,
// with dead stretches of 36 and 188 ticks next to a live warrior.
describe('fight-uptime instruments', () => {
    const WARRIOR = 18, HP_STAT = 3;
    function mkCombatBot(): LeanBot {
        const b = new LeanBot();
        b.quiet = true;
        b.mode = 'combat';
        b.arrived = true;
        b.combatTypes = new Set([WARRIOR]);
        (b as unknown as { combatHpTarget: number }).combatHpTarget = 99;
        b.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        return b;
    }

    test('ADJACENT ticks and ARMED ticks are counted separately — uptime is their ratio', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);          // cardinally adjacent
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(10);
        // adjacent the whole time, and NOT armed (the sim grants no xp) => uptime 0, which is the honest
        // reading of standing next to a live npc without a fight running
        expect(bot.adjacentTicks).toBeGreaterThan(0);
        expect(bot.armedTicks).toBe(0);

        // now feed xp: those ticks become ARMED
        let xp = 3_000;
        for (let i = 0; i < 6; i++) { xp += 40; h!.queueStat(HP_STAT, xp, 19); await h!.tick(); }
        expect(bot.armedTicks).toBeGreaterThan(0);
        expect(bot.armedTicks).toBeLessThanOrEqual(bot.adjacentTicks);
    });

    test('an op that produces NO xp is counted as one that never armed a fight', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(14);                                // ops go out; the sim never grants xp
        expect(bot.attackOps).toBeGreaterThan(0);
        expect(bot.attackOpsNoSwing).toBeGreaterThan(0);
        expect(bot.attackOpsNoSwing).toBeLessThanOrEqual(bot.attackOps);
    });

    test('an op followed by xp is NOT counted as a failure to arm', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(3);                                 // the first op goes out
        const before = bot.attackOpsNoSwing;
        h!.queueStat(HP_STAT, 3_100, 19);                // it armed: xp inside the window
        await h!.run(3);
        expect(bot.attackOpsNoSwing).toBe(before);
        expect(bot.swingsLanded).toBeGreaterThan(0);
    });

    test('the swing-gap histogram buckets on the weapon cadence, and flags off-cadence gaps', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        let xp = 3_000;
        const swing = async () => { xp += 40; h!.queueStat(HP_STAT, xp, 19); await h!.tick(); };
        await swing();                                    // baseline swing (no gap yet)
        await h!.run(3); await swing();                   // gap 4  = a hit at the weapon cap
        await h!.run(7); await swing();                   // gap 8  = one miss
        await h!.run(2); await swing();                   // gap 3  = OFF-CADENCE (nothing explains it)
        const g = bot.swingGaps;
        // ⛔ RAW BUCKETS, ON PURPOSE. The first version demanded EXACT multiples of 4 and put everything else
        // in `off-cadence` — which read 42% live and would have been reported as "the cadence is broken". But
        // UPDATE_STAT lands after the PLAYER_INFO the brain ticks on, so a true 4-4-4 cadence measured with
        // ±1 tick of jitter produces 3s and 5s. Storage keeps the raw gap; the READER decides what is cadence.
        const sum = (keys: string[]) => keys.reduce((a, k) => a + (g[k] ?? 0), 0);
        expect(sum(['3', '4', '5'])).toBeGreaterThanOrEqual(1);      // the weapon cadence, jitter included
        expect(sum(['7', '8', '9'])).toBeGreaterThanOrEqual(1);      // one miss, jitter included
        expect(g['off-cadence']).toBeUndefined();                    // that lying bucket is gone
        expect(Object.keys(g).length).toBeGreaterThan(1);
    });

    test('a long dead stretch lands in the LONG-TAIL bucket, not in the cadence cells', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        let xp = 3_000;
        xp += 40; h!.queueStat(HP_STAT, xp, 19); await h!.tick();
        await h!.run(67);                                 // a 68-tick dead stretch, the observed shape
        xp += 40; h!.queueStat(HP_STAT, xp, 19); await h!.tick();
        expect((bot.swingGaps['64-127'] ?? 0) + (bot.swingGaps['128+'] ?? 0)).toBeGreaterThanOrEqual(1);
        expect(bot.swingGaps['4'] ?? 0).toBe(0);
    });

    test('⛔ the RETRACTED corpse guard does not fire on a MISS STREAK next to a live npc', async () => {
        // The mechanism it was built on is retracted (`getNpcPos` rebuilds npcIndices every cycle, so a
        // corpse cannot be iterated). At hitChance 67-85% a healthy warrior standing still and being missed
        // satisfies both of the old clauses, so the window is 5 swing periods now — and this pins that a
        // stationary, live, un-hit target survives longer than a plausible miss streak.
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);            // alive, stationary, never grants xp
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(16);                                 // 4 swing periods of misses
        expect(bot.corpseDrops).toBe(0);
        expect(bot.targetStaleTicks).toBe(20);
        // ⛔ DEFAULT OFF NOW. Built on a mechanism that was retracted, kept on "it fired zero times in
        // 269,706 ticks", then fired 158 times on the next build — and a wrong drop buys another walk, which
        // is the DOMINANT cost (approach 57%). Opt-in only.
        expect(bot.corpseDropEnabled).toBe(false);
        // even switched ON it must not fire mid-APPROACH: a target you have not reached cannot be unhittable
        bot.corpseDropEnabled = true;
        await h!.run(40);
        expect(bot.corpseDropsAdjacent).toBe(bot.corpseDrops);       // every drop was made in reach
    });

    test('damageTaken accumulates only real hp DROPS (a heal is not damage)', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(2);
        h!.queueStat(HP_STAT, 3_000, 15); await h!.tick();     // 19 -> 15 = 4 damage
        h!.queueStat(HP_STAT, 3_000, 19); await h!.tick();     // healed back: NOT damage
        expect(bot.damageTaken).toBe(4);
    });
});

// =====================================================================================================
// APPROACH IS THE LEVER — the timers must never make a bot re-walk
// =====================================================================================================
// The instruments settled it: fight UPTIME once in reach is 63.3% (not the ~19% a local cell implied), and
// `approach` is **57% of ALL ticks** — bots spend more than half their lives walking to a target. That
// inverts the priority of every combat timer: abandoning a target you are still WALKING to costs another
// walk, which is the most expensive mistake available. These tests pin that no timer can do it.
describe('approach-priority: no timer may abandon a target we are still walking to', () => {
    const WARRIOR = 18, HP_STAT = 3;
    function mkCombatBot(): LeanBot {
        const b = new LeanBot();
        b.quiet = true;
        b.mode = 'combat';
        b.arrived = true;
        b.combatTypes = new Set([WARRIOR]);
        (b as unknown as { combatHpTarget: number }).combatHpTarget = 99;
        b.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        return b;
    }

    /** ⛔ A WORLD THE BOT CANNOT WALK IN: it stays permanently in `approach`. With openField it ARRIVES in ~4
     *  ticks, which is exactly what made the first version of these tests fail — the scenario was wrong, not
     *  the code. Pinning "still walking" needs a bot that never gets there. */
    const frozen = () => () => false;

    test('⭐ a FAR target is not abandoned while approaching, however long it pays nothing', async () => {
        // The walk-abandon-walk churn: commit at 8 tiles, walk without landing a hit (we have not ARRIVED),
        // and an ungated no-xp timer fires at 10 ticks — buying a second walk for nothing.
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, frozen());
        world.addNpc(11, WARRIOR, 3296, 3168);            // 8 tiles away and unreachable: pure approach
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        const peek = bot as unknown as { combatTargetIdx: number; combatRepick: number };
        await h!.run(4);
        const firstTarget = peek.combatTargetIdx;
        const repicksBefore = peek.combatRepick;
        await h!.run(30);                                  // 3x the IN-REACH window, none of it in reach
        // ⛔ RE-BASELINED after the 50x regression: the IN-REACH timer must still never fire out of reach
        // (that is the constraint that started this), but a FROZEN approach — zero tiles walked — is now
        // abandoned by the STALL GUARD, and must be: leaving it committed is what cost 1,650 ticks per
        // commitment. "Never abandon a target you have already walked to" was only ever about timer 2.
        expect(bot.targetAbandonsAdjacent).toBe(0);        // timer 2 stayed out of it
        expect(bot.stallAbandons).toBeGreaterThan(0);      // timer 1b did its job
        expect(bot.tickBudget.approach ?? 0).toBeGreaterThan(0);
        void firstTarget; void repicksBefore;
    });

    test('...but an ADJACENT target that pays nothing IS abandoned (that is what the timer is for)', async () => {
        const bot = mkCombatBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);            // in reach immediately
        world.addNpc(12, WARRIOR, 3287, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(16);                                  // in reach, never paying
        expect(bot.targetAbandonsAdjacent).toBeGreaterThan(0);
    });

    test('opsNoSwing counts ONLY ops sent in reach; ops sent while walking are approach noise', async () => {
        // Live it read 69% while `approach` was 57% of ticks — i.e. it was largely measuring the walk, and
        // its name was lying. Split at the source, where adjacency is known.
        const far = mkCombatBot();
        const world = new SimWorld(3288, 3168, frozen());
        world.addNpc(11, WARRIOR, 3300, 3168);            // 12 tiles, unreachable: every op is mid-approach
        h = new SimHarness(far, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(20);
        expect(far.attackOps).toBeGreaterThan(0);
        expect(far.opsWhileApproaching).toBeGreaterThan(0);
        expect(far.attackOpsNoSwing).toBe(0);              // NOT a failure to engage — we never arrived
        await h!.stop(); h = null;

        const near = mkCombatBot();
        const w2 = new SimWorld(3288, 3168, openField());
        w2.addNpc(11, WARRIOR, 3289, 3168);               // in reach: an op that pays nothing IS a failure
        h = new SimHarness(near, w2);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(20);
        expect(near.attackOpsNoSwing).toBeGreaterThan(0);
    });

    test('the corpse guard cannot fire mid-approach even when enabled', async () => {
        const bot = mkCombatBot();
        bot.corpseDropEnabled = true;                      // opt in explicitly (default is OFF)
        const world = new SimWorld(3288, 3168, frozen());
        world.addNpc(11, WARRIOR, 3302, 3168);            // 14 tiles, unreachable, stationary, never pays
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(30);                                  // well past the 20-tick stale window
        expect(bot.corpseDrops).toBe(0);                   // it was an APPROACH, not an unhittable target
    });

    test('a drop records the two facts that decide whether dropping was right', async () => {
        const bot = mkCombatBot();
        bot.corpseDropEnabled = true;
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);            // in reach, stationary, never pays
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(40);
        if (bot.corpseDrops > 0) {
            // every drop is classifiable after the fact — which the live 158 were NOT
            expect(bot.corpseDropsAdjacent).toBe(bot.corpseDrops);
            expect(bot.corpseDropsAfterSwing).toBe(0);     // this target never paid, so dropping was benign
        }
    });
});

// =====================================================================================================
// AllowRepath.NONE — the self-tile MOVE that silently switches off the engine's pursuit
// =====================================================================================================
// ⛔ VERIFIED AGAINST THE ENGINE, THEN REPRODUCED HERE. `MoveClickHandler.ts:41-43` is the ONLY place the
// server sets `AllowRepath.NONE`, and it does so for exactly one packet shape: a MOVE whose single waypoint
// IS the player's current tile ("clicking on their current tile"). `Player.ts:1082` then fails its
// `allowRepath === BEFOREDEST` guard forever, so `naivePathToTarget()` never runs and the engine STOPS
// closing on an op target — the bot stands still while the brain счита the tick as `approach`, inside the
// bucket that is 57% of all ticks. `doCombat`'s no-target branch sent `sendMove(anchor)` every 3 ticks, and
// a bot with nothing in view is usually STANDING ON the anchor: it armed the stall over and over.
// (The claim this replaced — "a client re-send strips the engine's permission to re-path" — was FALSE:
// allowRepath DEFAULTS to BEFOREDEST, so the ENGINE branch grants nothing and denies nothing. The rule that
// generalises: when a conditional GRANTS a capability, read the field's DEFAULT before concluding the other
// branch denies it.)
describe('the self-tile MOVE stall (AllowRepath.NONE)', () => {
    const WARRIOR = 18, HP_STAT = 3, ANCHOR = { x: 3288, z: 3168 };
    function mkBot(): LeanBot {
        const b = new LeanBot();
        b.quiet = true; b.mode = 'combat'; b.arrived = true;
        b.combatTypes = new Set([WARRIOR]);
        b.combatAnchor = ANCHOR;
        (b as unknown as { combatHpTarget: number }).combatHpTarget = 99;
        b.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        return b;
    }

    test('the SIM models the rule: a MOVE to our own tile sets NONE, a real MOVE restores it', async () => {
        const world = new SimWorld(ANCHOR.x, ANCHOR.z, openField());
        expect(world.allowRepath).toBe(true);                       // PathingEntity.ts:57 default
        world.tickOnce([{ type: 'move', path: [{ x: ANCHOR.x, z: ANCHOR.z }] }] as never);
        expect(world.allowRepath).toBe(false);                      // MoveClickHandler.ts:41-43
        expect(world.events.some(e => e.kind === 'allow-repath-none')).toBe(true);
        world.tickOnce([{ type: 'move', path: [{ x: ANCHOR.x, z: ANCHOR.z }, { x: ANCHOR.x + 1, z: ANCHOR.z }] }] as never);
        expect(world.allowRepath).toBe(true);                       // any real path restores it
    });

    test('⭐ with NONE armed the engine will NOT close on a target — this is the stall', async () => {
        const world = new SimWorld(ANCHOR.x, ANCHOR.z, openField());
        world.tickOnce([{ type: 'move', path: [{ x: ANCHOR.x, z: ANCHOR.z }] }] as never);   // arm NONE
        world.addNpc(11, WARRIOR, ANCHOR.x + 6, ANCHOR.z);                                   // 6 tiles away
        for (let i = 0; i < 10; i++) world.tickOnce([{ type: 'opnpc', index: 11, op: 2 }] as never);
        expect(world.player.x).toBe(ANCHOR.x);                     // never moved: pursuit is off
        expect(world.events.some(e => e.kind === 'repath-denied')).toBe(true);
    });

    test('⭐ THE FIX: standing ON the anchor with no target, the brain sends NO self-tile MOVE', async () => {
        const bot = mkBot();
        const world = new SimWorld(ANCHOR.x, ANCHOR.z, openField());     // no npcs: the searching branch
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        const ticks = await h!.run(12);
        const selfMoves = ticks.flatMap(t => t.actions).filter(a => a.type === 'move'
            && a.path.length === 1 && a.path[0]!.x === ANCHOR.x && a.path[0]!.z === ANCHOR.z);
        expect(selfMoves).toHaveLength(0);                          // the packet that arms the stall
        expect(bot.selfTileMovesSuppressed).toBeGreaterThan(0);      // and it was suppressed, not skipped by luck
        expect(world.allowRepath).toBe(true);                       // so pursuit is still ON
        expect(world.events.some(e => e.kind === 'allow-repath-none')).toBe(false);
    });

    test('...and a target appearing afterwards IS pursued (the end-to-end consequence)', async () => {
        const bot = mkBot();
        const world = new SimWorld(ANCHOR.x, ANCHOR.z, openField());
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(9);                                             // idle on the anchor, no targets
        world.addNpc(11, WARRIOR, ANCHOR.x + 5, ANCHOR.z);           // a respawn appears
        await h!.run(8);
        expect(world.player.x).toBeGreaterThan(ANCHOR.x);            // it actually closed the distance
        expect(bot.tickBudget.approach ?? 0).toBeGreaterThan(0);
    });

    test('the churn/stall counters are charged: tiles vs approach ticks, and commitments', async () => {
        const bot = mkBot();
        const world = new SimWorld(ANCHOR.x, ANCHOR.z, openField());
        world.addNpc(11, WARRIOR, ANCHOR.x + 8, ANCHOR.z);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(10);
        expect(bot.commitments).toBeGreaterThan(0);
        // walking, so tiles moved should track the approach ticks (a STALL would show tiles << ticks)
        expect(bot.tilesMovedDuringApproach).toBeGreaterThan(0);
        expect(bot.tickBudget.approach ?? 0).toBeGreaterThan(0);
    });
});

// =====================================================================================================
// THE TARGET PICKER — nearest live spawn not already committed to by another bot in this process
// =====================================================================================================
// The old pick was `byDist[(uid + combatRepick) % K]` over the nearest 5: it DELIBERATELY walks a bot past
// closer spawns so a group of bots does not dogpile one npc (`npc_findhero` gives each kill's drop to
// exactly one bot). That anti-contention is real and worth keeping — but it is paid for in the bucket that dominates
// (`approach` 57% of ticks, measured at 0.10-0.21 tiles/tick with 10.5 commitments per kill). Choosing by
// CLAIM is both at once: no two bots in the process commit to the same npc, AND each takes the nearest one
// nobody holds. Flag-gated so a settled before/after is attributable to exactly one change.
describe('the target picker (process-scoped claims)', () => {
    const WARRIOR = 18, HP_STAT = 3;
    function mkPicker(uid: number, claims: TargetClaimRegistry | null, on = true): LeanBot {
        const b = new LeanBot();
        b.quiet = true; b.mode = 'combat'; b.arrived = true;
        b.combatTypes = new Set([WARRIOR]);
        (b as unknown as { combatHpTarget: number }).combatHpTarget = 99;
        b.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        b.uid = uid;
        b.targetClaims = claims;
        b.pickerClaims = on;
        return b;
    }
    const committed = (b: LeanBot) => (b as unknown as { combatTargetIdx: number }).combatTargetIdx;

    test('the registry is TTL-d: an unrefreshed claim expires and the spawn is free again', () => {
        // ⛔ THE TTL IS THE ONLY THING between "one bot per npc" and "one npc parked forever by a ghost":
        // a crashed or reconnected bot stops refreshing, and its hold must lapse.
        const r = new TargetClaimRegistry(10);
        expect(r.claim(11, 700001, 100)).toBe(true);
        expect(r.ownerOf(11, 100)).toBe(700001);
        expect(r.claim(11, 700002, 105)).toBe(false);       // still held: another bot cannot take it
        expect(r.ownerOf(11, 111)).toBeUndefined();         // 11 ticks unrefreshed: the ghost lets go
        expect(r.claim(11, 700002, 111)).toBe(true);
        r.release(11, 700002);
        expect(r.ownerOf(11, 111)).toBeUndefined();
    });

    test('⭐ with a registry the bot commits to the NEAREST spawn, not the hash pick', async () => {
        const claims = new TargetClaimRegistry();
        const bot = mkPicker(700003, claims);
        const world = new SimWorld(3288, 3168, () => false);        // frozen: distances stay put
        world.addNpc(11, WARRIOR, 3289, 3168);                      // 1 tile  <- must win
        world.addNpc(12, WARRIOR, 3293, 3168);                      // 5 tiles
        world.addNpc(13, WARRIOR, 3296, 3168);                      // 8 tiles
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(4);
        expect(committed(bot)).toBe(11);
        expect(claims.ownerOf(11, bot.tickCount)).toBe(700003);     // and it holds the claim
    });

    test('⭐ a spawn another bot holds is NOT taken (anti-contention is preserved)', async () => {
        const claims = new TargetClaimRegistry();
        const bot = mkPicker(700004, claims);
        const world = new SimWorld(3288, 3168, () => false);
        world.addNpc(11, WARRIOR, 3289, 3168);                      // 1 tile, but SOMEONE ELSE holds it
        world.addNpc(12, WARRIOR, 3292, 3168);                      // 4 tiles, free
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        claims.claim(11, 999_999, 0);
        for (let i = 0; i < 5; i++) { claims.claim(11, 999_999, bot.tickCount); await h!.tick(); }
        expect(committed(bot)).toBe(12);                             // took the nearest FREE one
        expect(claims.ownerOf(12, bot.tickCount)).toBe(700004);
    });

    test('a SOLO probe (no registry) degrades to plain nearest instead of breaking', async () => {
        const bot = mkPicker(700006, null);                         // nothing injected
        const world = new SimWorld(3288, 3168, () => false);
        world.addNpc(11, WARRIOR, 3290, 3168);                      // 2 tiles
        world.addNpc(12, WARRIOR, 3296, 3168);                      // 8 tiles
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(4);
        expect(committed(bot)).toBe(11);
        expect(bot.pickerFallbacks).toBe(0);
    });

    test('every spawn claimed => it falls back to the hash pick and NEVER stands idle', async () => {
        const claims = new TargetClaimRegistry();
        const bot = mkPicker(700007, claims);
        const world = new SimWorld(3288, 3168, () => false);
        world.addNpc(11, WARRIOR, 3289, 3168);
        world.addNpc(12, WARRIOR, 3291, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        const ticks: { actions: ClientAction[] }[] = [];
        for (let i = 0; i < 6; i++) {
            claims.claim(11, 999_999, bot.tickCount);               // another bot holds BOTH, refreshed
            claims.claim(12, 999_998, bot.tickCount);
            ticks.push(await h!.tick());
        }
        expect(committed(bot)).toBeGreaterThan(0);                   // it still fights something
        expect(bot.pickerFallbacks).toBeGreaterThan(0);              // and the fallback is counted, not silent
        expect(ticks.flatMap(x => x.actions).some(a => a.type === 'opnpc' && a.op === 2)).toBe(true);
    });

    test('⭐ the DEFECT counter fires in BOTH arms — the control reports what it is losing', async () => {
        // uid is chosen so the hash pick is NOT the nearest: the old algorithm walks past a closer FREE spawn,
        // and that is counted whether the picker is enabled or not, so the improvement is never assumed.
        for (const on of [true, false]) {
            const claims = new TargetClaimRegistry();
            const bot = mkPicker(700001, claims, on);
            const world = new SimWorld(3288, 3168, () => false);
            world.addNpc(11, WARRIOR, 3289, 3168);                   // 1 tile
            world.addNpc(12, WARRIOR, 3294, 3168);                   // 6 tiles
            h = new SimHarness(bot, world);
            await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
            await h!.run(5);
            expect(bot.walkedPastCloserFree).toBeGreaterThan(0);
            expect(bot.tilesSavedByPicker).toBeGreaterThan(0);
            if (on) expect(committed(bot)).toBe(11);                 // ON: it actually took the near one
            await h!.stop(); h = null;
        }
    });

    test('a claim is RELEASED when the commitment ends, so no spawn is leaked', async () => {
        const claims = new TargetClaimRegistry();
        const bot = mkPicker(700008, claims);
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(4);
        expect(claims.ownerOf(11, bot.tickCount)).toBe(700008);
        world.npcs.delete(11);                                       // the npc dies / leaves the scene
        await h!.run(3);
        expect(claims.ownerOf(11, bot.tickCount)).toBeUndefined();    // released, not held by a ghost
    });
});

// =====================================================================================================
// TWO TIMERS, NOT ONE — the regression that cost 50x, pinned so it cannot come back
// =====================================================================================================
// Collapsing the abandon timer into a single adjacency-gated one deleted the APPROACH TIMEOUT: a bot walking
// toward a target it could not reach never gave up. Settled measurement: 251,141 approach ticks across 152
// commitments = **1,650 ticks per commitment**, `adj` 432 of ~299,000 ticks, duty 0.2% (was 10.8-11.9%),
// 116 swings (was 6,539-7,466). "Never abandon a target you have already walked to" is a statement about the
// IN-REACH timer and says NOTHING about how long an approach may last. Both must exist:
//   TIMER 1  approach timeout, UNCONDITIONAL — never arrived within N ticks => re-pick
//   TIMER 1b stall guard — committed, out of reach, ZERO tiles walked => re-pick immediately
//   TIMER 2  in-reach abandon — arrived but not paying => re-pick (unchanged)
describe('the two abandon timers (regression pin)', () => {
    const WARRIOR = 18, HP_STAT = 3;
    function mkBot(): LeanBot {
        const b = new LeanBot();
        b.quiet = true; b.mode = 'combat'; b.arrived = true;
        b.combatTypes = new Set([WARRIOR]);
        (b as unknown as { combatHpTarget: number }).combatHpTarget = 99;
        b.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        return b;
    }
    const committed = (b: LeanBot) => (b as unknown as { combatTargetIdx: number }).combatTargetIdx;

    test('⭐ TIMER 1b: committed, out of reach and NOT MOVING => abandoned in ~12 ticks, not 1,650', async () => {
        const bot = mkBot();
        const world = new SimWorld(3288, 3168, () => false);          // frozen: the live stall shape exactly
        world.addNpc(11, WARRIOR, 3296, 3168);                        // 8 tiles, unreachable
        world.addNpc(12, WARRIOR, 3294, 3170);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(4);
        expect(committed(bot)).toBeGreaterThan(0);
        await h!.run(14);
        expect(bot.stallAbandons).toBeGreaterThan(0);                 // it gave up on a doomed approach
        expect(bot.stallGuardTicks).toBe(12);
    });

    test('⭐ TIMER 1: a bot that keeps WALKING but never arrives still times out', async () => {
        // moving, so the stall guard must NOT fire — only the unconditional approach timeout may. The npc is
        // pushed away every tick, so the bot walks forever and would previously have committed for 1,650+.
        const bot = mkBot();
        // ⛔ ISOLATING TIMER 1 IS FIDDLIER THAN IT LOOKS. A FLEEING npc leaves the 15-tile view and the
        // empty-scene path drops the commitment, so no timeout ever fires (the first version of this test).
        // Here only NORTH/SOUTH steps are legal: the bot MOVES every tick (so the stall guard must not fire)
        // but can never close the east-west gap — a moving approach that never arrives.
        const world = new SimWorld(3288, 3168, openField());
        const npc = world.addNpc(11, WARRIOR, 3298, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        // it JUMPS between two in-view spots: same npc index (so one commitment), bot walks every tick (so
        // the stall guard must not fire), and it never gets to stand next to it.
        for (let i = 0; i < 70; i++) { npc.x = i % 2 === 0 ? 3298 : 3278; await h!.tick(); }
        expect(bot.approachTimeouts).toBeGreaterThan(0);
        expect(bot.stallAbandons).toBe(0);                            // it WAS moving: not the stall shape
        expect(bot.approachTimeoutTicks).toBe(50);
    });

    test('an approach that ARRIVES in a normal walk is never timed out', async () => {
        // median walked distance at these camps is 6-9 tiles => 6-18 ticks of running, well inside 50.
        const bot = mkBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3296, 3168);                        // 8 tiles and reachable
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(20);
        expect(bot.approachTimeouts).toBe(0);
        expect(bot.stallAbandons).toBe(0);
        expect(committed(bot)).toBe(11);                              // the commitment survived the walk
    });

    test('TIMER 2 still only fires IN REACH (the constraint that started this)', async () => {
        const bot = mkBot();
        const world = new SimWorld(3288, 3168, openField());
        world.addNpc(11, WARRIOR, 3289, 3168);                        // adjacent, never pays
        world.addNpc(12, WARRIOR, 3287, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(16);
        expect(bot.targetAbandonsAdjacent).toBeGreaterThan(0);
        expect(bot.approachTimeouts).toBe(0);                          // it never had to approach
    });

    test('⛔ THE REGRESSION ITSELF: ticks-per-commitment stays bounded, not 1,650', async () => {
        // the number that exposed it. With both timers a doomed approach costs tens of ticks, not thousands.
        const bot = mkBot();
        const world = new SimWorld(3288, 3168, () => false);           // permanently unreachable
        world.addNpc(11, WARRIOR, 3296, 3168);
        world.addNpc(12, WARRIOR, 3294, 3172);
        world.addNpc(13, WARRIOR, 3282, 3168);
        h = new SimHarness(bot, world);
        await h!.start({ stats: [{ stat: HP_STAT, xp: 3_000, level: 19 }] });
        await h!.run(120);
        const approachTicks = bot.tickBudget.approach ?? 0;
        expect(bot.commitments).toBeGreaterThan(2);                    // it kept re-picking instead of freezing
        expect(approachTicks / bot.commitments).toBeLessThan(60);      // live was 1,650
    });
});

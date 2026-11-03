// bun test server/webclient/headless/sim/ranged-kit.test.ts
//
// THE RANGED LANE'S ARITHMETIC AND ITS ONE SILENT BRICK.
//
// Two independent things are locked here, and both are the kind that ship green:
//
//   1. THE AMMO POWER RULE. player_ranged.rs2:97-99 refuses the SHOT (not the wear) when
//      `oc_param(ammo, levelrequire) > oc_param(rhand, levelrequire)`. Steel arrows in a plain shortbow
//      equip into the quiver perfectly happily and the bot then never fires — a p_stopaction, a chat
//      line the headless client does not read as an error, and a bot that looks armed and busy. The
//      gate is on the BOW's tier, not the player's ranged level, so a ranged-99 archer with a shortbow
//      is still blocked. Every one of those clauses is asserted, because each is individually the
//      difference between a bot that fires and an idle one.
//
//   2. THE COST MODEL'S DIRECTION. OPERATION-BRIEFING §19 says "ranged 40/damage ... so ranged is the
//      slowest leg". `arg` is xp PER DAMAGE, so 40 means ranged needs the FEWEST damage points of the
//      three, not the most. The lane's whole justification rests on that sign, so it is pinned against
//      the engine constants rather than left in a comment.
import { describe, test, expect } from 'bun:test';
import {
    ARROWS, BOWS, AMMO_GROUND_RECOVERY, CAMP_TARGETS, DISPLAYED_XP_PER_ARG, RANGED_ARG_PER_DAMAGE,
    arrowsUsableWith, bestArrowFrom, bestBowFrom, bowStyleButton, bowStyleIndex, byName, canBowFire,
    canWieldBow, displayedXpForLevel, effectiveRanged, hitChance, isPureRangedStyle, levelForDisplayedXp,
    powerTier, rangedMaxHit, rangedPlan, swingTicks,
} from '../ranged-kit.ts';

const MEMBERS = { rangedLevel: 99, members: true };
const F2P = { rangedLevel: 99, members: false };

describe('the style buttons come from the generated interface table', () => {
    // pack/interface.pack: 1772=combat_bow:bow0, 1771=combat_bow:bow1, 1770=combat_bow:bow2, and
    // player_attackstyles.rs2:19-21 maps bow0/1/2 -> set_attackstyle(0/1/2).
    test('accurate/rapid/longrange resolve to 1772/1771/1770', () => {
        expect(bowStyleButton('accurate')).toBe(1772);
        expect(bowStyleButton('rapid')).toBe(1771);
        expect(bowStyleButton('longrange')).toBe(1770);
    });

    test('the com_mode indexes match weapon_bow_table row order (combat.dbrow:113-117)', () => {
        expect(bowStyleIndex('accurate')).toBe(0);
        expect(bowStyleIndex('rapid')).toBe(1);
        expect(bowStyleIndex('longrange')).toBe(2);
    });

    test('the melee button is NOT a bow button — the two tabs are disjoint', () => {
        // combat_hacksword:hack2 = 2431 is what TrainBot holds. Clicking it on a bow tab is dropped by
        // IfButtonHandler, com_mode never moves, and styleFailed latches.
        expect([bowStyleButton('accurate'), bowStyleButton('rapid'), bowStyleButton('longrange')]).not.toContain(2431);
    });

    test('only accurate and rapid are pure ranged xp (combat.rs2:155 vs :157)', () => {
        expect(isPureRangedStyle('accurate')).toBe(true);
        expect(isPureRangedStyle('rapid')).toBe(true);
        expect(isPureRangedStyle('longrange')).toBe(false);
    });
});

describe('⛔ the ammo power rule (player_ranged.rs2:97-99)', () => {
    test('the fixture is real: shortbow and steel_arrow have DIFFERENT power tiers', () => {
        // ⛔ THE VACUOUS-FIXTURE GUARD. Every assertion below is about a tier COMPARISON, so if
        // gear.json ever lost `levelrequire` both tiers would read 0, `0 <= 0` would be true, and the
        // "cannot fire" tests would pass by accident while the real bot silently stopped shooting.
        expect(powerTier(byName('shortbow'))).toBe(1);
        expect(powerTier(byName('oak_shortbow'))).toBe(5);
        expect(powerTier(byName('steel_arrow'))).toBe(5);
        expect(powerTier(byName('rune_arrow'))).toBe(40);
        expect(powerTier(byName('bronze_arrow'))).toBe(1);
        expect(powerTier(byName('steel_arrow'))).toBeGreaterThan(powerTier(byName('shortbow')));
    });

    test('a plain shortbow CANNOT fire steel arrows', () => {
        expect(canBowFire(byName('shortbow'), byName('steel_arrow'))).toBe(false);
    });

    test('...but it can fire bronze and iron (both levelrequire 1)', () => {
        expect(canBowFire(byName('shortbow'), byName('bronze_arrow'))).toBe(true);
        expect(canBowFire(byName('shortbow'), byName('iron_arrow'))).toBe(true);
    });

    test('an oak shortbow (tier 5) unlocks steel', () => {
        expect(canBowFire(byName('oak_shortbow'), byName('steel_arrow'))).toBe(true);
        expect(canBowFire(byName('oak_shortbow'), byName('rune_arrow'))).toBe(false);
    });

    test('⭐ THE GATE IS ON THE BOW, NOT ON THE ARCHER — ranged 99 does not unlock steel for a shortbow', () => {
        // The obvious wrong model is "levelrequire is a player requirement, so a 99 can use anything".
        // bestArrowFrom is handed a ranged-99 context and must still refuse.
        const held = [byName('bronze_arrow').id, byName('steel_arrow').id];
        expect(bestArrowFrom(held, byName('shortbow'), MEMBERS)!.name).toBe('bronze_arrow');
        expect(bestArrowFrom(held, byName('oak_shortbow'), MEMBERS)!.name).toBe('steel_arrow');
    });

    test('holding ONLY unfirable ammo is answered as "none", not as the unfirable one', () => {
        expect(bestArrowFrom([byName('rune_arrow').id], byName('shortbow'), MEMBERS)).toBeUndefined();
    });

    test('a crossbow is never treated as a bow (player_ranged.rs2:88-95 wants `bolts`)', () => {
        // Both are levelrequire 1, so a tier-only rule would happily pair them. The category check is
        // what stops the lane handing arrows to a crossbow and getting "You can't use that ammo".
        expect(powerTier(byName('crossbow'))).toBe(powerTier(byName('bronze_arrow')));
        expect(canBowFire(byName('crossbow'), byName('bronze_arrow'))).toBe(false);
        expect(BOWS.some(b => b.name === 'crossbow')).toBe(false);
    });

    test('the loot filter names exactly the firable tiers, so the pack never fills with dead ammo', () => {
        expect(arrowsUsableWith(byName('shortbow'), MEMBERS).map(a => a.name)).toEqual(['bronze_arrow', 'iron_arrow']);
        expect(arrowsUsableWith(byName('oak_shortbow'), MEMBERS).map(a => a.name))
            .toEqual(['bronze_arrow', 'iron_arrow', 'steel_arrow']);
    });
});

describe('members and wield gates', () => {
    test('the f2p kit is shortbow/oak + bronze/iron/steel — nothing above is free', () => {
        // combat.rs2:16 maps a members weapon to weapon_unarmed_table on a free world, which has no
        // ranged row at all, so a members bow there does not merely under-perform: it stops being ranged.
        expect(BOWS.filter(b => !b.members).map(b => b.name).sort())
            .toEqual(['longbow', 'oak_longbow', 'oak_shortbow', 'shortbow']);
        expect(ARROWS.filter(a => !a.members).map(a => a.name)).toEqual(['bronze_arrow', 'iron_arrow', 'steel_arrow']);
    });

    test('a members bow is refused on a free world and allowed on a members one', () => {
        expect(canWieldBow(byName('magic_shortbow'), F2P)).toBe(false);
        expect(canWieldBow(byName('magic_shortbow'), MEMBERS)).toBe(true);
    });

    test('the WIELD gate is the ranged level (levelrequire.rs2:38-44)', () => {
        expect(canWieldBow(byName('oak_shortbow'), { rangedLevel: 4, members: true })).toBe(false);
        expect(canWieldBow(byName('oak_shortbow'), { rangedLevel: 5, members: true })).toBe(true);
        // a fresh ranged-1 bot can only hold the tier-1 bows, which is what the lane must ship first
        expect(BOWS.filter(b => canWieldBow(b, { rangedLevel: 1, members: true })).map(b => b.name).sort())
            .toEqual(['longbow', 'shortbow']);
    });

    test('bestBowFrom picks the highest tier actually wieldable', () => {
        const held = [byName('shortbow').id, byName('oak_shortbow').id, byName('magic_shortbow').id];
        expect(bestBowFrom(held, { rangedLevel: 1, members: true })!.name).toBe('shortbow');
        expect(bestBowFrom(held, { rangedLevel: 5, members: true })!.name).toBe('oak_shortbow');
        expect(bestBowFrom(held, { rangedLevel: 50, members: true })!.name).toBe('magic_shortbow');
        expect(bestBowFrom(held, { rangedLevel: 50, members: false })!.name).toBe('oak_shortbow');
    });
});

describe('the engine formulas', () => {
    test('the FLAT curve: level 99 = 998,458 displayed xp', () => {
        // Player.ts:82 uses 2^(L/10). If someone restored 2^(L/7) this number moves by orders of
        // magnitude and every hours-to-99 claim in the lane is wrong.
        expect(displayedXpForLevel(99)).toBe(998_458);
        expect(levelForDisplayedXp(998_458)).toBe(99);
        expect(levelForDisplayedXp(998_457)).toBe(98);
    });

    test('⭐ ONE point of damage is already level 2 — which is why the early levels are not a phase', () => {
        // 40 arg x 2.5 displayed = 100 displayed xp for a single damage point, against level 2's 80.
        expect(displayedXpForLevel(2)).toBe(80);
        expect(RANGED_ARG_PER_DAMAGE * DISPLAYED_XP_PER_ARG).toBe(100);
        expect(levelForDisplayedXp(RANGED_ARG_PER_DAMAGE * DISPLAYED_XP_PER_ARG)).toBeGreaterThanOrEqual(2);
    });

    test('⭐ THE BRIEFING §19 SIGN ERROR: 40 arg/damage is the FEWEST damage, not the most', () => {
        const damageFor = (argPerDamage: number) => (displayedXpForLevel(99) / DISPLAYED_XP_PER_ARG) / argPerDamage;
        const ranged = damageFor(40), magic = damageFor(20), meleeControlled = damageFor(13.3);
        expect(Math.round(ranged)).toBe(9_985);
        expect(Math.round(magic)).toBe(19_969);
        expect(Math.round(meleeControlled)).toBe(30_029);
        expect(ranged).toBeLessThan(magic);              // ranged is CHEAPER than magic, not dearer
        expect(ranged).toBeLessThan(meleeControlled);
    });

    test('max hit and effective level match combat.rs2:8/:12 and player_combat_stat.rs2:74', () => {
        expect(effectiveRanged(99, 'rapid')).toBe(107);        // level + 8 + 0
        expect(effectiveRanged(99, 'accurate')).toBe(110);     // combat.rs2:55 adds +3 ranged
        expect(rangedMaxHit(107, 16)).toBe(13);                // (107*(16+64)+320)/640
        expect(rangedMaxHit(107, 7)).toBe(12);
        expect(rangedMaxHit(107, 49)).toBe(19);
    });

    test('rapid takes a tick off the swing; accurate does not (player_ranged.rs2:22-24)', () => {
        expect(swingTicks(byName('shortbow'), 'rapid')).toBe(3);        // attackrate default 4, -1
        expect(swingTicks(byName('shortbow'), 'accurate')).toBe(4);
        expect(swingTicks(byName('longbow'), 'rapid')).toBe(5);         // attackrate 6, -1
    });

    test('hitChance is P(randominc(a) > randominc(d)) and is symmetric-consistent', () => {
        expect(hitChance(0, 0)).toBeCloseTo(0, 6);          // 0>0 is never true
        expect(hitChance(1, 0)).toBeCloseTo(0.5, 6);        // A in {0,1} vs D=0
        expect(hitChance(100, 0)).toBeGreaterThan(0.99);
        expect(hitChance(0, 100)).toBeLessThan(0.01);
        // P(A>D) + P(D>A) + P(A=D) = 1
        const n = 7, m = 11;
        let ties = 0;
        for (let a = 0; a <= n; a++) for (let d = 0; d <= m; d++) if (a === d) ties++;
        expect(hitChance(n, m) + hitChance(m, n) + ties / ((n + 1) * (m + 1))).toBeCloseTo(1, 9);
    });

    test('4 of every 5 spent arrows are recoverable (^dropammo_chance = 5)', () => {
        expect(AMMO_GROUND_RECOVERY).toBeCloseTo(0.8, 9);
    });
});

describe('⭐ the plan: ranged rides along with the prayer grind', () => {
    const bow = byName('shortbow'), iron = byName('iron_arrow');

    test('it refuses to model a combination the engine would refuse to fire', () => {
        expect(() => rangedPlan(CAMP_TARGETS.al_kharid_warrior!, bow, byName('steel_arrow'), 'rapid')).toThrow(/cannot fire/);
    });

    test('every real camp finishes ranged 1->99 in single-digit hours', () => {
        for (const camp of Object.values(CAMP_TARGETS)) {
            const p = rangedPlan(camp, bow, iron, 'rapid');
            expect(p.hours).toBeGreaterThan(0);
            expect(p.hours).toBeLessThan(10);
        }
    });

    test('⭐ THE LOAD-BEARING CLAIM: the loop is SPAWN-bound, so the bones (and prayer) keep coming', () => {
        for (const camp of Object.values(CAMP_TARGETS)) {
            const p = rangedPlan(camp, bow, iron, 'rapid');
            expect(p.spawnBound).toBe(true);
            expect(p.dpsBoundKills).toBeLessThanOrEqual(3);
        }
    });

    test('the damage needed is the same ~9,985 whatever the camp — only the kill COUNT changes', () => {
        const warrior = rangedPlan(CAMP_TARGETS.al_kharid_warrior!, bow, iron, 'rapid');
        const rat = rangedPlan(CAMP_TARGETS.giant_rat!, bow, iron, 'rapid');
        for (const p of [warrior, rat]) expect(p.damage).toBeGreaterThan(9_000);
        for (const p of [warrior, rat]) expect(p.damage).toBeLessThan(11_000);
        // hp 19 vs hp 7.5 — the rat camp needs far more kills for the same damage
        expect(rat.kills).toBeGreaterThan(warrior.kills * 2);
    });

    test('the arrow bill is ~2.5k gross and ~500 actually destroyed, per bot', () => {
        const p = rangedPlan(CAMP_TARGETS.goblin_redarmour!, bow, iron, 'rapid');
        expect(p.arrowsGross).toBe(p.swings);                 // 1 per swing, hit or miss
        expect(p.arrowsGross).toBeGreaterThan(2_000);
        expect(p.arrowsGross).toBeLessThan(3_200);
        expect(p.arrowsDestroyed).toBeCloseTo(p.arrowsGross * 0.2, 6);
        expect(p.arrowsDestroyed).toBeLessThan(700);
    });

    test('rapid costs slightly MORE arrows than accurate for the same wall clock, because we are spawn-bound', () => {
        const rapid = rangedPlan(CAMP_TARGETS.al_kharid_warrior!, bow, iron, 'rapid');
        const accurate = rangedPlan(CAMP_TARGETS.al_kharid_warrior!, bow, iron, 'accurate');
        // Effectively identical: the respawn cadence is the ceiling, so the extra tick per swing buys
        // nothing. Not EXACTLY identical, and the residue is honest signal rather than noise — the one
        // opening kill that really is dps-bound is 0.02% slower on accurate's 4-tick swing.
        expect(Math.abs(rapid.hours - accurate.hours) / accurate.hours).toBeLessThan(0.005);
        expect(rapid.arrowsGross).toBeGreaterThan(accurate.arrowsGross);
        expect(rapid.arrowsGross / accurate.arrowsGross).toBeLessThan(1.15);
    });

    test('a better kit spends fewer arrows for the same xp', () => {
        const cheap = rangedPlan(CAMP_TARGETS.goblin_redarmour!, bow, byName('bronze_arrow'), 'rapid');
        const good = rangedPlan(CAMP_TARGETS.goblin_redarmour!, byName('magic_shortbow'), byName('rune_arrow'), 'rapid');
        expect(good.arrowsGross).toBeLessThan(cheap.arrowsGross);
    });

    test('duty cycle scales the answer linearly (12-20% measured)', () => {
        const full = rangedPlan(CAMP_TARGETS.goblin_redarmour!, bow, iron, 'rapid', { dutyFraction: 1 });
        const fifth = rangedPlan(CAMP_TARGETS.goblin_redarmour!, bow, iron, 'rapid', { dutyFraction: 0.2 });
        expect(fifth.hours).toBeCloseTo(full.hours * 5, 3);
    });

    test('a partial climb from an already-trained level is cheaper than the whole one', () => {
        const whole = rangedPlan(CAMP_TARGETS.goblin_redarmour!, bow, iron, 'rapid');
        const tail = rangedPlan(CAMP_TARGETS.goblin_redarmour!, bow, iron, 'rapid', { fromLevel: 90 });
        expect(tail.swings).toBeLessThan(whole.swings);
        expect(tail.hours).toBeLessThan(whole.hours);
    });
});

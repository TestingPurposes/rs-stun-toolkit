// COMBAT MODEL ANCHORS — the formulas vs engine facts and live measurements.
import { describe, test, expect } from 'bun:test';
import { xpForLevel, maxHit, NPCS, standardPlans, MELEE99, evaluatePlan, deathRisk, simulateRangedPhase } from './combat.ts';

describe('combat math anchors', () => {
    test('xp curve: the FLAT engine curve (99 = 998,458 displayed, memory-verified)', () => {
        expect(xpForLevel(99)).toBeGreaterThan(990_000);
        expect(xpForLevel(99)).toBeLessThan(1_005_000);
        expect(xpForLevel(2)).toBeGreaterThan(0);
    });
    test('formula max hits reproduce the live observations (cow 1, goblin 1, giant 6)', () => {
        expect(NPCS.cow!.maxHitVsUs).toBe(1);
        expect(NPCS.goblin!.maxHitVsUs).toBe(1);
        expect(NPCS.mossgiant!.maxHitVsUs).toBe(6);
        expect(maxHit(1, 0, 1)).toBe(1);     // level-1 fists controlled hit 1 (live: fists train)
        expect(maxHit(99, 44, 1)).toBeGreaterThan(15);   // rune scim at 99
    });
    test('route ordering: giants beat all-cows for the melee block; style rotation is worst', () => {
        const plans = standardPlans();
        const byName = (s: string) => plans.find(p => p.name.includes(s))!;
        expect(byName('def 40').totalTicks).toBeLessThan(byName('all-cows').totalTicks);
        expect(byName('rotation').totalTicks).toBeGreaterThan(byName('all-cows').totalTicks * 1.5);
    });
    test('cows 1->60 lands in the live-measured ballpark (~5 min at 40ms, EV model within 3x)', () => {
        const p = evaluatePlan('probe', [{ npc: 'cow', style: 'controlled', gate: l => l.att >= 60, label: 'att 60' }]);
        const localMinutes = (p.totalTicks * 40) / 60_000;
        expect(localMinutes).toBeGreaterThan(1);
        expect(localMinutes).toBeLessThan(15);
    });
});

describe('Monte-Carlo survival (seeded death-risk — the variance the EV model cannot see)', () => {
    test('cows are far safer than giants for the same hero + food budget', () => {
        // same mid hero, same 5-shark budget, 20 kills: cows are trivially safe, giants are not. (The
        // model is honest — a SLOW low-level killer takes real chip even from cows, so risk scales with
        // how fast you kill, not just the npc's max hit.)
        const hero = { att: 30, str: 30, def: 30, hp: 30 };
        const budget = { kills: 20, food: 5, trials: 200 } as const;
        const cows = deathRisk(NPCS.cow!, 'aggressive', hero, budget);
        const giants = deathRisk(NPCS.mossgiant!, 'aggressive', hero, budget);
        expect(cows.deathProb).toBe(0);
        expect(giants.deathProb).toBeGreaterThan(cows.deathProb);
    });

    test('moss giants convert food into safety: lethal unfed, safe with plenty', () => {
        const hero = { att: 45, str: 45, def: 45, hp: 45 };
        const unfed = deathRisk(NPCS.mossgiant!, 'aggressive', hero, { kills: 25, food: 0, trials: 200 });
        const fed = deathRisk(NPCS.mossgiant!, 'aggressive', hero, { kills: 25, food: 40, trials: 200 });
        expect(unfed.deathProb).toBeGreaterThan(0.2);          // giants kill an unfed hero
        expect(fed.deathProb).toBeLessThan(unfed.deathProb);   // food strictly reduces the risk
        expect(fed.meanFoodUsed).toBeGreaterThan(0);           // and it actually ate to do so
    });

    test('deterministic: same seed -> identical death probability (reproducible)', () => {
        const hero = { att: 40, str: 40, def: 40, hp: 40 };
        const a = deathRisk(NPCS.mossgiant!, 'aggressive', hero, { kills: 20, food: 8, trials: 100, seed: 999 });
        const b = deathRisk(NPCS.mossgiant!, 'aggressive', hero, { kills: 20, food: 8, trials: 100, seed: 999 });
        expect(a.deathProb).toBe(b.deathProb);
        expect(a.p05MinHp).toBe(b.p05MinHp);
    });
});

describe('ranged leveling model', () => {
    test('ranged 1->40 on giants: kills, consumes >1 arrow/kill, sane tick magnitude', () => {
        const r = simulateRangedPhase(NPCS.mossgiant!, 1, 40);
        expect(r.kills).toBeGreaterThan(0);
        expect(r.arrows).toBeGreaterThan(r.kills);   // more than one arrow spent per kill
        expect(r.ticks).toBeGreaterThan(0);
    });
});

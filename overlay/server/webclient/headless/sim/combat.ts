// COMBAT MATH + LEVELING-ROUTE CALCULATOR — every formula ported from the engine's own scripts
// (cited inline), so "what is the fastest level-1 -> max-combat route?" is a computation, not a
// live experiment. Expected-value model (no RNG): per-swing hit chance x mean damage -> xp/tick.
//
// Engine sources:
//   xp curve            Player.ts:77-95 (delta = level + 2^(level/10)*300; units = floor(acc/4)*10;
//                       displayed = units/10 -> level 99 = 998,458 displayed, the FLAT curve)
//   max hit             combat.rs2:7-8   maxhit = (effStr*(strBonus+64) + 320) / 640
//   attack/def rolls    combat.rs2:11-12 roll = effLevel * (bonus + 64)
//   hit resolution      player_combat.rs2:58  randominc(atkRoll) > randominc(defRoll)
//   style bonuses       combat.rs2:52-61 accurate +3 att / aggressive +3 str / controlled +1+1+1
//   xp                  combat.rs2:88+   base = dmg*10 units; accurate 4x -> att; controlled
//                       1.33x -> att+str+def; HP always 1.33x. displayed = units * xprate/10 (25x).
//   swing speed         player_melee.rs2:54-56  unarmed 4t; weapon oc_param(attackrate) default 4
//                       (combat.param:76-79 — scimitars don't override -> 4 ticks)
//   npc stats           .npc configs (cow hp8, goblin hp5, mossgiant hp60 att/str/def30 rate6)
//
//   effective +8        player_combat_stat.rs2:71-74 — effective = level + 8 + styleBonus (this is
//                       why level-1 fists hit 1 and why a cow's computed max hit is exactly 1)
//
// HONESTY NOTES: npc rolls use the same +8/effective formulas with their configured stats/bonuses —
// verified against live observations (cow max 1, goblin max 1). Respawn contention, travel and
// eat-ticks are PARAMETERS, not simulation. No prayer modelling (hero trains prayerless).

// ---- xp curve (Player.ts:77-95) -------------------------------------------------------------------
const LEVEL_XP_DISPLAYED: number[] = (() => {
    const out: number[] = [0, 0];   // index = level; level 1 = 0 xp
    let acc = 0;
    for (let i = 0; i < 99; i++) {
        const level = i + 1;
        acc += Math.floor(level + Math.pow(2.0, level / 10.0) * 300.0);
        out[i + 2] = Math.floor(acc / 4);   // displayed = units/10 and units = floor(acc/4)*10
    }
    return out;
})();
export function xpForLevel(level: number): number { return LEVEL_XP_DISPLAYED[Math.min(99, Math.max(1, level))]!; }
export function levelForXp(xp: number): number {
    for (let l = 99; l >= 2; l--) if (xp >= LEVEL_XP_DISPLAYED[l]!) return l;
    return 1;
}

export const XPRATE = 25;   // WorldConfig.ts:102 (both local and demo)

// ---- core rolls -----------------------------------------------------------------------------------
export function maxHit(strLevel: number, strBonus: number, styleStrBonus: number): number {
    const eff = strLevel + 8 + styleStrBonus;                   // combat_effective_stat + 8 + style
    return Math.floor((eff * (strBonus + 64) + 320) / 640);     // combat_maxhit(combat_stat(...))
}
export function attackRoll(attLevel: number, attBonus: number, styleAttBonus: number): number {
    return (attLevel + 8 + styleAttBonus) * (attBonus + 64);
}
export function defenceRoll(defLevel: number, defBonus: number, styleDefBonus = 0): number {
    return (defLevel + 8 + styleDefBonus) * (defBonus + 64);
}
// P[randominc(A) > randominc(D)] with randominc(n) = uniform int 0..n (inclusive).
export function hitChance(atkRoll: number, defRoll: number): number {
    const A = atkRoll + 1, D = defRoll + 1;   // outcome counts
    // count pairs (a,d) with a > d: sum over d of (A-1-d) clipped
    if (atkRoll <= 0) return 0;
    let wins: number;
    if (A > D) wins = (D * (2 * A - D - 1)) / 2;
    else wins = (A * (A - 1)) / 2;
    return wins / (A * D);
}

// ---- gear / styles --------------------------------------------------------------------------------
export type Style = 'accurate' | 'aggressive' | 'defensive' | 'controlled';
export const STYLE_BONUS: Record<Style, { att: number; str: number; def: number }> = {
    accurate: { att: 3, str: 0, def: 0 }, aggressive: { att: 0, str: 3, def: 0 },
    defensive: { att: 0, str: 0, def: 3 }, controlled: { att: 1, str: 1, def: 1 },
};
// scimitar slash bonuses per tier (obj configs) + wield attack req (hero.ts SCIM_TIERS)
export const SCIMITARS = [
    { name: 'fists', attReq: 0, slash: 0, str: 0 },
    { name: 'bronze', attReq: 1, slash: 7, str: 6 },
    { name: 'iron', attReq: 1, slash: 10, str: 9 },
    { name: 'steel', attReq: 5, slash: 15, str: 14 },
    { name: 'black', attReq: 10, slash: 19, str: 14 },
    { name: 'mithril', attReq: 20, slash: 21, str: 20 },
    { name: 'adamant', attReq: 30, slash: 29, str: 28 },
    { name: 'rune', attReq: 40, slash: 45, str: 44 },
] as const;
export function bestScimitar(attLevel: number): (typeof SCIMITARS)[number] {
    let best = SCIMITARS[0];
    for (const s of SCIMITARS) if (attLevel >= s.attReq) best = s;
    return best;
}
// 4-piece armour set (full_helm+platebody+platelegs+kiteshield) CRUSH defence totals, summed from
// the .obj configs — cows/goblins/giants all attack ^crush_style. Def wield gates mirror the metal
// tiers (levelrequire tier tables); the hero's wearBestArmour climbs this exact ladder.
export const ARMOUR_SETS = [
    { name: 'none', defReq: 0, crushDef: 0 },
    { name: 'bronze', defReq: 1, crushDef: 24 },
    { name: 'iron', defReq: 1, crushDef: 36 },
    { name: 'steel', defReq: 5, crushDef: 60 },
    { name: 'mithril', defReq: 20, crushDef: 89 },
    { name: 'adamant', defReq: 30, crushDef: 129 },
    { name: 'rune', defReq: 40, crushDef: 192 },
] as const;
export function bestArmour(defLevel: number): (typeof ARMOUR_SETS)[number] {
    let best = ARMOUR_SETS[0];
    for (const a of ARMOUR_SETS) if (defLevel >= a.defReq) best = a;
    return best;
}

// ---- npc table (.npc configs; rolls derived from the same formulas) -------------------------------
export interface CombatNpc {
    name: string; hp: number; def: number; defBonus: number;
    maxHitVsUs: number;      // maxHit(npcStr, npcStrBonus, 0) — formula-derived
    attackRate: number;      // npc attackrate param (default 4)
    npcAtkRoll: number;      // attackRoll(npcAtt, npcAttBonus, 0)
    respawnTicks: number; walkTicksPerKill: number;   // overhead between kills at typical density
}
function npc(name: string, hp: number, att: number, str: number, def: number,
    attBonus: number, strBonus: number, defBonus: number, attackRate: number,
    respawnTicks: number, walkTicksPerKill: number): CombatNpc {
    return { name, hp, def, defBonus, maxHitVsUs: maxHit(str, strBonus, 0), attackRate, npcAtkRoll: attackRoll(att, attBonus, 0), respawnTicks, walkTicksPerKill };
}
export const NPCS: Record<string, CombatNpc> = {
    // cow (cows.npc): hp8, stats default 1, bonuses -15/-15/-21, rate default 4 -> max hit 1 (live ✓)
    cow: npc('cow', 8, 1, 1, 1, -15, -15, -21, 4, 90, 3),
    // goblin: hp5, stats 1, bonuses -21/-15/-15 -> max hit 1 (live ✓)
    goblin: npc('goblin', 5, 1, 1, 1, -21, -15, -15, 4, 50, 3),
    // mossgiant: hp60, att/str/def 30, bonuses 33/31/0, attackrate 6 -> max hit 6
    mossgiant: npc('mossgiant', 60, 30, 30, 30, 33, 31, 0, 6, 100, 5),
};

// ---- expected-value phase simulator ---------------------------------------------------------------
export interface Levels { att: number; str: number; def: number; hp: number }
export interface PhaseResult {
    ticks: number; kills: number; foodHp: number;   // hp of healing consumed (shark = 20/ea)
    levels: Levels; xp: { att: number; str: number; def: number; hp: number };
    diedRisk: boolean;   // true if incoming dps could outpace healing at any point
}

// Simulate fighting one npc type with a style until `until(levels)` is true. Expected-value per
// swing; levels update as xp crosses thresholds (weapon auto-upgrades at wield gates).
export function simulatePhase(
    npc: CombatNpc,
    style: Style,
    start: Levels,
    startXp: { att: number; str: number; def: number; hp: number },
    until: (l: Levels) => boolean,
    opts: { maxTicks?: number; healPerFood?: number } = {},
): PhaseResult {
    const xp = { ...startXp };
    const lv = { ...start };
    const sb = STYLE_BONUS[style];
    let ticks = 0, kills = 0, foodHp = 0, diedRisk = false;
    const maxTicks = opts.maxTicks ?? 40_000_000;
    const healPerFood = opts.healPerFood ?? 20;

    while (!until(lv) && ticks < maxTicks) {
        // one kill (expected value): swings every 4t; E[dmg/swing] = pHit * maxhit/2
        const weap = bestScimitar(lv.att);
        const mh = maxHit(lv.str, weap.str, sb.str);
        const p = hitChance(attackRoll(lv.att, weap.slash, sb.att), defenceRoll(npc.def, npc.defBonus));
        const eDmg = p * (mh / 2);   // randominc(maxhit): mean maxhit/2 (0 hits deal 0 xp too)
        if (eDmg <= 0.01) { diedRisk = true; break; }   // cannot progress
        const swings = npc.hp / eDmg;
        const killTicks = swings * 4 + npc.walkTicksPerKill;
        ticks += killTicks;
        kills++;

        // incoming: npc swings back every attackRate while we fight it (~killTicks); the hero wears
        // the best armour ladder its Defence allows (delivered by the gear chain, wearBestArmour)
        const armour = bestArmour(lv.def);
        const pNpcHit = hitChance(npc.npcAtkRoll, defenceRoll(lv.def, armour.crushDef, sb.def));
        const inc = (killTicks / npc.attackRate) * pNpcHit * (npc.maxHitVsUs / 2);
        foodHp += inc;
        // survivability: can a burst (4x maxhit) exceed our hp pool? crude but catches cow-vs-giant
        if (npc.maxHitVsUs * 4 >= lv.hp * 0.8) diedRisk = diedRisk || npc.maxHitVsUs > 1;

        // xp for npc.hp damage dealt (combat.rs2): base units = dmg*10
        const dealt = npc.hp;
        const units = dealt * 10;
        const disp = (mult: number) => Math.floor(units * mult) * XPRATE / 10;
        if (style === 'accurate') xp.att += disp(4);
        else if (style === 'aggressive') xp.str += disp(4);
        else if (style === 'defensive') xp.def += disp(4);
        else { xp.att += disp(1.33); xp.str += disp(1.33); xp.def += disp(1.33); }
        xp.hp += disp(1.33);
        lv.att = levelForXp(xp.att); lv.str = levelForXp(xp.str);
        lv.def = levelForXp(xp.def); lv.hp = Math.max(10, levelForXp(xp.hp));
    }
    return { ticks, kills, foodHp, levels: lv, xp, diedRisk };
}

// ---- Monte-Carlo survival (seeded RNG) --------------------------------------------------------------
// The EV model above gives route ORDERING; it cannot give DEATH RISK — variance is invisible to an
// expected-value calculation (its `diedRisk` is a crude burst heuristic). This runs ACTUAL RNG fights,
// seeded + reproducible, so a route yields a death PROBABILITY under a given food budget — the thing you
// actually need before sending the hero through giants or dragons. Faithful to the engine rolls:
// randominc(maxhit) damage (0..maxhit inclusive, incl. a landed-but-0 hit), per-side swing cadence.
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const randInc = (rng: () => number, n: number) => Math.floor(rng() * (n + 1));   // engine randominc: 0..n

export interface FightSession { died: boolean; kills: number; foodUsed: number; minHp: number }
// Fight one npc type for up to `kills` kills with `food` heals available, eating at `eatAt` hp. RNG per
// swing: player weapon speed 4t, npc on its attackRate; both use the gear the levels allow.
export function fightSessionMC(npc: CombatNpc, style: Style, lv: Levels,
    opts: { kills: number; food: number; healPer?: number; eatAt?: number; rng: () => number; maxTicks?: number }): FightSession {
    const sb = STYLE_BONUS[style];
    const weap = bestScimitar(lv.att);
    const mh = maxHit(lv.str, weap.str, sb.str);
    const pHit = hitChance(attackRoll(lv.att, weap.slash, sb.att), defenceRoll(npc.def, npc.defBonus));
    const pNpcHit = hitChance(npc.npcAtkRoll, defenceRoll(lv.def, bestArmour(lv.def).crushDef, sb.def));
    const maxHp = Math.max(10, lv.hp);
    const healPer = opts.healPer ?? 20, eatAt = opts.eatAt ?? Math.floor(maxHp * 0.5);
    const maxTicks = opts.maxTicks ?? 500_000;
    let hp = maxHp, food = opts.food, kills = 0, foodUsed = 0, minHp = maxHp;
    let npcHp = npc.hp, t = 0, nextP = 0, nextN = 0;
    while (kills < opts.kills && t < maxTicks) {
        if (t >= nextP) {
            if (pHit > 0 && opts.rng() < pHit) npcHp -= randInc(opts.rng, mh);
            nextP = t + 4;
            if (npcHp <= 0) { kills++; npcHp = npc.hp; t += npc.walkTicksPerKill; nextP = t; nextN = t + npc.attackRate; continue; }
        }
        if (t >= nextN) {
            if (pNpcHit > 0 && opts.rng() < pNpcHit) hp -= randInc(opts.rng, npc.maxHitVsUs);
            nextN = t + npc.attackRate;
        }
        if (hp < minHp) minHp = hp;
        if (hp <= 0) return { died: true, kills, foodUsed, minHp: hp };
        if (hp <= eatAt && food > 0) { hp = Math.min(maxHp, hp + healPer); food--; foodUsed++; }
        t++;
    }
    return { died: false, kills, foodUsed, minHp };
}

export interface DeathRisk { deathProb: number; meanKills: number; meanFoodUsed: number; p05MinHp: number; trials: number }
// Run N seeded sessions -> the death probability + food/hp distribution. Deterministic per seed.
export function deathRisk(npc: CombatNpc, style: Style, lv: Levels,
    opts: { kills: number; food: number; trials?: number; healPer?: number; eatAt?: number; seed?: number }): DeathRisk {
    const trials = opts.trials ?? 200, seed = opts.seed ?? 0x1234;
    let deaths = 0, sumKills = 0, sumFood = 0;
    const minHps: number[] = [];
    for (let i = 0; i < trials; i++) {
        const r = fightSessionMC(npc, style, lv, { ...opts, rng: mulberry32((seed + i * 0x9E3779B1) | 0) });
        if (r.died) deaths++;
        sumKills += r.kills; sumFood += r.foodUsed; minHps.push(r.minHp);
    }
    minHps.sort((a, b) => a - b);
    return {
        deathProb: deaths / trials, meanKills: sumKills / trials, meanFoodUsed: sumFood / trials,
        p05MinHp: minHps[Math.floor(trials * 0.05)] ?? 0, trials,
    };
}

// ---- route planner --------------------------------------------------------------------------------
export interface PlanStep { npc: string; style: Style; until: string; result: PhaseResult }
export interface Plan { name: string; steps: PlanStep[]; totalTicks: number; totalFoodHp: number; safe: boolean }

// Evaluate a melee plan: an ordered list of (npc, style, gate) phases from level 1.
export function evaluatePlan(name: string, phases: Array<{ npc: string; style: Style; gate: (l: Levels) => boolean; label: string }>): Plan {
    let levels: Levels = { att: 1, str: 1, def: 1, hp: 10 };
    let xp = { att: 0, str: 0, def: 0, hp: xpForLevel(10) };
    const steps: PlanStep[] = [];
    let total = 0, food = 0, safe = true;
    for (const ph of phases) {
        const r = simulatePhase(NPCS[ph.npc]!, ph.style, levels, xp, ph.gate);
        steps.push({ npc: ph.npc, style: ph.style, until: ph.label, result: r });
        levels = r.levels; xp = r.xp; total += r.ticks; food += r.foodHp;
        if (r.diedRisk) safe = false;
    }
    return { name, steps, totalTicks: total, totalFoodHp: food, safe };
}

export const MELEE99 = (l: Levels) => l.att >= 99 && l.str >= 99 && l.def >= 99;

export function standardPlans(): Plan[] {
    return [
        evaluatePlan('all-cows controlled (the proven safe route)', [
            { npc: 'cow', style: 'controlled', gate: MELEE99, label: 'melee 99' },
        ]),
        evaluatePlan('cows -> giants at def 40 (the old gate that killed the hero)', [
            { npc: 'cow', style: 'controlled', gate: l => l.def >= 40, label: 'def 40' },
            { npc: 'mossgiant', style: 'controlled', gate: MELEE99, label: 'melee 99' },
        ]),
        evaluatePlan('cows -> giants at def 60 + hp 60', [
            { npc: 'cow', style: 'controlled', gate: l => l.def >= 60 && l.hp >= 60, label: 'def+hp 60' },
            { npc: 'mossgiant', style: 'controlled', gate: MELEE99, label: 'melee 99' },
        ]),
        evaluatePlan('goblins -> cows (goblin start, cow finish)', [
            { npc: 'goblin', style: 'controlled', gate: l => l.att >= 20, label: 'att 20' },
            { npc: 'cow', style: 'controlled', gate: MELEE99, label: 'melee 99' },
        ]),
        evaluatePlan('cows accurate/aggressive/defensive rotation (sequential 99s)', [
            { npc: 'cow', style: 'accurate', gate: l => l.att >= 99, label: 'att 99' },
            { npc: 'cow', style: 'aggressive', gate: l => l.str >= 99, label: 'str 99' },
            { npc: 'cow', style: 'defensive', gate: MELEE99, label: 'def 99' },
        ]),
    ];
}

// ---- RANGED (gear-aware): bow rangeattack + arrow rangebonus from the .obj configs ---------------
// maxhit = combat_maxhit(effRanged * (rangebonus+64)); accuracy = effRanged * (rangeattack+64);
// rapid style = +0 style bonus but -1 tick swing (4t -> 3t). Ranged xp = 4x base (dmg*40 units).
export const BOWS = [
    { name: 'shortbow', req: 1, rangeattack: 8 },
    { name: 'willow_shortbow', req: 20, rangeattack: 20 },
    { name: 'maple_shortbow', req: 30, rangeattack: 29 },
    { name: 'magic_shortbow', req: 50, rangeattack: 69 },
] as const;
export const ARROWS = [
    { name: 'bronze_arrow', req: 1, rangebonus: 7 },
    { name: 'steel_arrow', req: 5, rangebonus: 16 },
    { name: 'rune_arrow', req: 40, rangebonus: 49 },
] as const;
export function simulateRangedPhase(npc: CombatNpc, startLevel: number, targetLevel: number): { ticks: number; arrows: number; kills: number } {
    let xp = xpForLevel(startLevel), lv = startLevel, ticks = 0, arrows = 0, kills = 0;
    while (lv < targetLevel && ticks < 40_000_000) {
        const bow = [...BOWS].reverse().find(b => lv >= b.req)!;
        const arrow = [...ARROWS].reverse().find(a => lv >= a.req)!;
        const mh = Math.floor(((lv + 8) * (arrow.rangebonus + 64) + 320) / 640);
        const p = hitChance((lv + 8) * (bow.rangeattack + 64), defenceRoll(npc.def, npc.defBonus));
        const eDmg = p * (mh / 2);
        if (eDmg <= 0.01) break;
        const swings = npc.hp / eDmg;
        ticks += swings * 3 + npc.walkTicksPerKill;   // rapid = 3t
        arrows += swings;                              // 1 arrow per attack (~80% recoverable, gross here)
        kills++;
        xp += Math.floor(npc.hp * 10 * 4) * XPRATE / 10;   // ranged rapid = 4x base
        lv = levelForXp(xp);
    }
    return { ticks, arrows, kills };
}

// ---- MAGIC (gear-aware): spell ladder (fixed max hits) + staff magicattack for accuracy ----------
// magic_combat_spells.dbrow (fire line); xp/cast = spell experience units + 2x dmg units on damage
// (style_magic_normal). 5t per cast. 55+ = high-alch (650 units/cast, probe-D-locked).
export const SPELLS = [
    { name: 'wind_strike', req: 1, maxhit: 2, expUnits: 55 },
    { name: 'fire_strike', req: 13, maxhit: 8, expUnits: 115 },
    { name: 'fire_bolt', req: 35, maxhit: 12, expUnits: 225 },
    { name: 'fire_blast', req: 59, maxhit: 16, expUnits: 345 },
    { name: 'fire_wave', req: 75, maxhit: 20, expUnits: 425 },
] as const;
export const STAFF_MAGICATTACK = 10;   // staff_of_fire (Zaff, 1000gp) — also infinite fire runes
export function simulateMagicPhase(npc: CombatNpc, startLevel: number): { ticksTo55: number; alchCasts: number; alchTicks: number; runesBurned: number } {
    let xp = xpForLevel(startLevel), lv = startLevel, ticks = 0, runes = 0;
    while (lv < 55 && ticks < 40_000_000) {
        const spell = [...SPELLS].reverse().find(s => lv >= s.req)!;
        // magic accuracy: effMagic(+8,+1 style) * (magicattack+64) vs npc magic defence
        const p = hitChance((lv + 8 + 1) * (STAFF_MAGICATTACK + 64), defenceRoll(npc.def, npc.defBonus));
        const eDmg = p * (spell.maxhit / 2);
        ticks += 5;
        runes++;   // 1 elemental+catalyst set per cast (fire runes free w/ staff)
        xp += (spell.expUnits + Math.floor(eDmg * 10 * 2)) * XPRATE / 10;
        lv = levelForXp(xp);
    }
    // 55 -> 99: high-alch, 650 units = 1,625 displayed/cast at 25x (probe D)
    const alchXp = 650 * XPRATE / 10;
    const alchCasts = Math.ceil((xpForLevel(99) - xpForLevel(55)) / alchXp);
    return { ticksTo55: ticks, alchCasts, alchTicks: alchCasts * 5, runesBurned: runes };
}

// Prayer stays probe-locked: 2,663 big-bone buries ≈ ~12k demo ticks incl. delivery cadence.
export const TAIL_TICKS_DEMO = { prayer: 12_000 };

if (import.meta.main) {
    const fmt = (ticks: number) => `${(ticks * 300 / 3_600_000).toFixed(2)}h demo (${(ticks * 40 / 3_600_000).toFixed(2)}h @40ms)`;
    console.log('MELEE ROUTE COMPARISON (level 1 -> melee block done; expected-value model)');
    console.log('='.repeat(84));
    const plans = standardPlans().sort((a, b) => a.totalTicks - b.totalTicks);
    for (const p of plans) {
        console.log(`\n${p.safe ? '  SAFE  ' : '⚠ RISKY '} ${p.name}`);
        for (const s of p.steps) {
            const r = s.result;
            console.log(`     ${s.npc.padEnd(10)} ${s.style.padEnd(10)} until ${s.until.padEnd(10)} ` +
                `${fmt(r.ticks).padEnd(12)} kills=${r.kills} food=${Math.ceil(r.foodHp / 20)} sharks ` +
                `-> att${r.levels.att}/str${r.levels.str}/def${r.levels.def}/hp${r.levels.hp}`);
        }
        console.log(`     MELEE TOTAL ${fmt(p.totalTicks)}`);
    }
    console.log(`\nBEST MELEE: ${plans[0]!.name}`);

    // gear-aware tails on giants (the hero's phase order: melee -> prayer -> ranged -> magic)
    const giants = NPCS.mossgiant!;
    const rng = simulateRangedPhase(giants, 1, 99);
    const mag = simulateMagicPhase(giants, 1);
    console.log(`\nTAILS (gear-aware, vs moss giants):`);
    console.log(`  RANGED 1->99 (bow ladder shortbow->magic_shortbow, arrows bronze->rune, rapid 3t):`);
    console.log(`     ${fmt(rng.ticks)}, ~${Math.ceil(rng.arrows)} arrows gross (~${Math.ceil(rng.arrows * 0.2)} net w/ 80% recovery), ${rng.kills} kills`);
    console.log(`  MAGIC 1->55 combat spells (staff of fire, fire ladder): ${fmt(mag.ticksTo55)}, ~${mag.runesBurned} catalyst runes`);
    console.log(`  MAGIC 55->99 high-alch: ${mag.alchCasts} casts, ${fmt(mag.alchTicks)}, ~${mag.alchCasts} natures`);
    console.log(`  PRAYER (probe-locked): 2,663 big-bone buries, ~${fmt(TAIL_TICKS_DEMO.prayer)}`);
    const total = plans[0]!.totalTicks + rng.ticks + mag.ticksTo55 + mag.alchTicks + TAIL_TICKS_DEMO.prayer;
    console.log(`\nFULL 1 -> COMBAT 126 (best melee + tails): ${fmt(total)}`);
}

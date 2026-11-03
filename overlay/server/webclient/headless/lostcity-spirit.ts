// THE TREE SPIRIT FIGHT, AS NUMBERS. Live: both cosmic questers (acct5 att 95 str 26 def 26 hp 79;
// acct6 att 99 str 26 def 26 hp 99) reached the spirit with 12 sharks, fought it UNARMED (Entrana bans weapons and
// armour) on the login style (accurate, com_mode 0) and lost every time: "out of food at hp 15/79". This module is the
// rev-289 melee math for that one fight, so "can this account win?" is a computation the driver and the chain make BEFORE
// the boat, not a 40-minute live experiment. Pure; seeded; no I/O.
//
// CONTENT (server/content/scripts/, rev 289):
//   spirit   quests/quest_zanaris/configs/tree_spirit.npc: attack 90, strength 95, defence 80, hitpoints 85, no bonus
//            params (attackbonus/strengthbonus/crushdefence default 0, combat.param), damagetype crush, attackrate default 4
//            (combat.param:76-79), regenrate default 100 (NpcType.ts:99; Npc.ts processRegen: +1 hp per 100 ticks),
//            npc_add(.., 1000) in quest_zanaris.rs2 -> it DESPAWNS 1000 ticks after the spawn.
//   npc      skill_combat/scripts/npc/npc_combat_melee.rs2: effective = stat + 9 ("style bonus of 1" + 8);
//            attack roll = eff*(attackbonus+64); maxhit = (eff*(strengthbonus+64)+320)/640 -> 6336 / max 10;
//            npc_combat.rs2 npc_defence_roll_specific: (def+9)*(crushdefence+64) = 5696.
//   player   skill_combat/scripts/player/player_combat_stat.rs2: effective = level + 8 + style bonus (accurate +3 att,
//            aggressive +3 str, defensive +3 def — combat_get_damagestyle_bonuses); unarmed bonuses are all 0, so
//            attack roll = (att+8+sa)*64, crush defence roll = (def+8+sd)*64, maxhit = ((str+8+ss)*64+320)/640.
//            Unarmed swings every 4 ticks (player_melee.rs2: %action_delay = map_clock + 4 when no weapon).
//   hit      player_combat.rs2 player_npc_hit_roll / npc_meleeattack: randominc(attack) > randominc(defence), then
//            randominc(maxhit) (capped at the target's hitpoints for the player's swing).
//   food     player/scripts/consumption/consume.rs2: normal food = @player_consume_item(.., eat_delay 2, skill_delay 3):
//            one bite per 3 ticks (%eat_delay = clock + 2, refused while >= clock) and %action_delay += 3 per bite (the
//            next swing slips 3 ticks); consume_normal.dbrow [heal_20] shark = +20 hp.
//   driver   quest-lostcity.ts fight(): eats when hp <= floor(max/2), flees when hp <= floor(max*0.2) with no food left.
//
// The model is deliberately a little PESSIMISTIC where the engine is ambiguous: the spirit swings first (it is aggroed by the
// chop before our routed walk lands a swing — `approachTicks`), damage taken never raises our level mid-fight (25x xp does,
// live), and our Strength/Defence never rise mid-fight either.

export const SPIRIT = { att: 90, str: 95, def: 80, hp: 85, rate: 4, regenTicks: 100, lifeTicks: 1000 } as const;
export const SHARK_HEAL = 20;
export type MeleeStyle = 'accurate' | 'aggressive' | 'defensive';
/** unarmed style buttons (capability-tables combat_unarmed): accurate 5860, aggressive 5862, defensive 5861 */
export const UNARMED_STYLE_BUTTON: Record<MeleeStyle, number> = { accurate: 5860, aggressive: 5862, defensive: 5861 };
/** BASE levels (from xp, never the drained/damaged current level) */
export interface MeleeStats { att: number; str: number; def: number; hp: number }

export const effMaxHit = (eff: number, bonus = 0) => Math.floor((eff * (bonus + 64) + 320) / 640);
/** P[randominc(a) > randominc(d)] (randominc(n) = uniform 0..n) */
export function hitChance(a: number, d: number): number {
    if (a <= 0) return 0;
    const A = a + 1, D = d + 1;
    return (A > D ? (D * (2 * A - D - 1)) / 2 : (A * (A - 1)) / 2) / (A * D);
}
export function unarmedProfile(s: MeleeStats, style: MeleeStyle): { atkRoll: number; maxHit: number; crushDefRoll: number } {
    const sa = style === 'accurate' ? 3 : 0, ss = style === 'aggressive' ? 3 : 0, sd = style === 'defensive' ? 3 : 0;
    return { atkRoll: (s.att + 8 + sa) * 64, maxHit: effMaxHit(s.str + 8 + ss), crushDefRoll: (s.def + 8 + sd) * 64 };
}
export function spiritProfile(): { atkRoll: number; maxHit: number; defRoll: number } {
    return { atkRoll: (SPIRIT.att + 9) * 64, maxHit: effMaxHit(SPIRIT.str + 9), defRoll: (SPIRIT.def + 9) * 64 };
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const ri = (rng: () => number, n: number) => Math.floor(rng() * (n + 1));

export interface SpiritFightOpts {
    sharks: number; style?: MeleeStyle;
    /** ticks the spirit swings at us before our first swing lands (chop -> aggro -> routed walk round the tree); default 8 */
    approachTicks?: number;
    /** stress knob: the spirit swings every `rate` ticks (default 4; 3 = +33% incoming) */
    spiritRate?: number;
    /** ticks of fight allowed (the npc_add duration minus the chop/approach); default 990 */
    maxTicks?: number;
}
export interface SpiritFightResult { win: boolean; ticks: number; sharksUsed: number; endHp: number; spiritHp: number }
/** One fight, engine order per tick: spirit swing, our eat (driver: hp <= max/2), flee check, our swing. */
export function spiritFight(s: MeleeStats, o: SpiritFightOpts, rng: () => number): SpiritFightResult {
    const me = unarmedProfile(s, o.style ?? 'aggressive'), sp = spiritProfile();
    const rate = o.spiritRate ?? SPIRIT.rate, maxTicks = o.maxTicks ?? 990;
    const eatAt = Math.floor(s.hp / 2), fleeAt = Math.floor(s.hp * 0.2);
    let hp = s.hp, food = o.sharks, nhp: number = SPIRIT.hp, pNext = o.approachTicks ?? 8, nNext = 0, eatNext = 0;
    for (let t = 0; t < maxTicks; t++) {
        if (t > 0 && t % SPIRIT.regenTicks === 0 && nhp < SPIRIT.hp) nhp++;
        if (t >= nNext) { nNext = t + rate; if (ri(rng, sp.atkRoll) > ri(rng, me.crushDefRoll)) hp -= ri(rng, sp.maxHit); }
        if (hp <= 0) return { win: false, ticks: t, sharksUsed: o.sharks - food, endHp: hp, spiritHp: nhp };
        if (hp <= eatAt && food > 0 && t >= eatNext) { hp = Math.min(s.hp, hp + SHARK_HEAL); food--; eatNext = t + 3; pNext = Math.max(pNext, t) + 3; }
        if (food === 0 && hp <= fleeAt) return { win: false, ticks: t, sharksUsed: o.sharks, endHp: hp, spiritHp: nhp };
        if (t >= pNext) {
            pNext = t + 4;
            if (ri(rng, me.atkRoll) > ri(rng, sp.defRoll)) nhp -= Math.min(nhp, ri(rng, me.maxHit));
            if (nhp <= 0) return { win: true, ticks: t, sharksUsed: o.sharks - food, endHp: hp, spiritHp: 0 };
        }
    }
    return { win: false, ticks: maxTicks, sharksUsed: o.sharks - food, endHp: hp, spiritHp: nhp };
}
export interface SpiritOdds { win: number; trials: number; meanSharks: number; p95Sharks: number; meanTicks: number }
/** Seeded Monte-Carlo over spiritFight: deterministic for (stats, opts, trials, seed). */
export function spiritOdds(s: MeleeStats, o: SpiritFightOpts, trials = 2000, seed = 0x5EED): SpiritOdds {
    let w = 0, ticks = 0; const used: number[] = [];
    for (let i = 0; i < trials; i++) {
        const r = spiritFight(s, o, mulberry32((seed + i * 0x9E3779B1) | 0));
        if (r.win) { w++; ticks += r.ticks; used.push(r.sharksUsed); }
    }
    used.sort((a, b) => a - b);
    return { win: w / trials, trials, meanSharks: used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0,
        p95Sharks: used.length ? used[Math.min(used.length - 1, Math.floor(used.length * 0.95))]! : 0, meanTicks: w ? ticks / w : 0 };
}

// ---- THE PLAN (decided from the numbers; sim/lostcity-spirit.test.ts pins them) ---------------------------
// 4000 seeded fights each, win% (mean sharks used / p95), "stress" = the spirit swinging every 3 ticks (+33% incoming):
//   live stats, 12 sharks, accurate (what lost)         acct5 0.3%            acct6 1.1%
//   live stats, 12 sharks, aggressive (max 3 -> 4)       12%                       25%
//   live stats, 24 sharks (a full pack), aggressive      98.4%, stress 53%         99.3%, stress 67%   <- food alone: fragile
//   str 40 def 40, 20 sharks                             99.8%, stress 85-87%      100%, stress 93%
//   str 45 def 45, 20 sharks, aggressive (max 6)         100% (9.5 / p95 14), stress 98.7%   100% (8.7 / 13), stress 99.4%
// -> TRAIN Strength 45 + Defence 45 first (combat-prep on the Lumbridge cows, unarmed, lowest-first: ~105k xp = ~1,060
//    damage at 25x, ~30-40 min), take 20 sharks, fight AGGRESSIVE (or accurate when that wins more: below str 45 the +3 str
//    does not cross a max-hit step). 16 sharks would still be >= 99.8% at 45/45; the 20 are the margin for zombies + stress.
export const LC_TRAIN = { str: 45, def: 45 } as const;
export const LC_FOOD_SHARKS = 20;
/** the pre-boat gate: below this win probability the driver will not sail (it fails 'restock' or 'train') */
export const LC_MIN_WIN = 0.97;
/** in the dungeon, before (re)spawning the spirit: below this the driver walks out instead of feeding it sharks */
export const LC_MIN_WIN_DUNGEON = 0.8;
/** a full pack of sharks for the 'train vs restock' verdict (28 - knife - zombie axe) */
export const LC_FULL_PACK_SHARKS = 26;

const cache = new Map<string, { win: number; style: MeleeStyle }>();
/** Cached best (style, P(win)) for the driver's gates (default approach, 600 seeded fights per style). Unknown stats
 *  (any level <= 0) -> undefined: the gate then falls back to the plain minFood count. */
export function spiritWinChance(s: MeleeStats, sharks: number): { win: number; style: MeleeStyle } | undefined {
    if (!(s.att > 0 && s.str > 0 && s.def > 0 && s.hp > 0)) return undefined;
    const key = `${s.att},${s.str},${s.def},${s.hp},${sharks}`;
    let v = cache.get(key);
    if (v === undefined) {
        const agg = spiritOdds(s, { sharks, style: 'aggressive' }, 600).win, acc = spiritOdds(s, { sharks, style: 'accurate' }, 600).win;
        v = agg >= acc ? { win: agg, style: 'aggressive' } : { win: acc, style: 'accurate' };
        if (cache.size > 500) cache.clear();
        cache.set(key, v);
    }
    return v;
}

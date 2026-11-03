// MAGIC 55->99 METHOD COMPARISON — which method minimizes the NATURE (and rare-rune) supply?
// Report-only analysis. Every number is derived from the engine's OWN configs,
// cited inline, run through the VALIDATED xp model in ./combat.ts (same model the hero-max-combat spec used).
//
// Engine sources (quoted):
//   magic xp grant   skill_magic/scripts/magic.rs2:108-109  give_spell_xp = stat_advance(magic, experience)
//   xp application   engine Player.ts:1830-1831  stats[stat] += xp * xpRate(25);  displayed = stats/10
//                    => displayed xp/cast (flat part) = experience_field * 25 / 10 = experience_field * 2.5
//   combat dmg xp    skill_combat/scripts/combat.rs2:160-161 (general npc, style_magic_normal):
//                    stat_advance(magic, scale(mult,1000, scale(200,100, damage*10))) = damage*20 xp-arg
//                    => displayed dmg xp = damage*20 * 2.5 = damage*50 (only on a HIT, not a splash)
//   cast speed       player_magic.rs2:176  %action_delay = map_clock + 5  => 5 ticks / combat cast
//   high alch        magic_spells.dbrow:173-179  exp 650, runes naturerune,1 + firerune,5
//                    alchemy.rs2:37  p_delay(3) (3-5 tick cadence in practice)
//   staff of fire    magic_staff.dbrow:24-31  staff_of_fire -> firerune  (zeroes the fire line; members world)
//   combat spells    magic_combat_spells.dbrow (fire line quoted below)
//   moss giant       _unpack/225/all.npc:3086  hp60 def30 (no magic-def bonus), attackrate 6
//
// The nature question: elemental combat spells (fire line) need NO nature. Their 2nd/"catalyst" rune is the
// only non-air/non-fire rune. With a staff of fire the fire line is free, so the per-cast cost is:
//   fire_strike: air2 + mind1            (NO catalyst at all — mind is the cheapest rune in the game)
//   fire_bolt:   air3 + chaos1           (chaos = free moss drop / ~4gp Aubury)
//   fire_blast:  air4 + death1           (death = rarer moss drop / buyable)
//   fire_wave:   air5 + blood1  (members, req75)
// High alch (baseline): nature1 + fire5(free) + 1 fodder item per cast.

import { xpForLevel, hitChance, attackRoll, defenceRoll, NPCS } from './combat.js';

const XPRATE = 25;
const giant = NPCS.mossgiant!;               // hp60 def30
const STAFF_MAGICATTACK = 10;                // staff_of_fire magicattack (sim STAFF_MAGICATTACK)

// fire-line combat spells straight from magic_combat_spells.dbrow (experience + maxhit + levelrequired + runes)
interface CombatSpell { name: string; req: number; exp: number; maxhit: number; air: number; catalyst: string | null; catN: number; }
const FIRE_LINE: CombatSpell[] = [
    { name: 'fire_strike', req: 13, exp: 115, maxhit: 8,  air: 2, catalyst: null,    catN: 0 }, // mind1 (see MIND note)
    { name: 'fire_bolt',   req: 35, exp: 225, maxhit: 12, air: 3, catalyst: 'chaos', catN: 1 },
    { name: 'fire_blast',  req: 59, exp: 345, maxhit: 16, air: 4, catalyst: 'death', catN: 1 },
    { name: 'fire_wave',   req: 75, exp: 425, maxhit: 20, air: 5, catalyst: 'blood', catN: 1 }, // members
];
// fire_strike also needs mind,1 (it's the "rune1"). Tracked separately.
const MIND_PER_FIRESTRIKE = 1;

// expected displayed xp for ONE cast of a combat spell vs the moss giant (base flat xp always; dmg xp * pHit)
function combatCastXp(s: CombatSpell, magicLvl: number): { flat: number; dmg: number; total: number; pHit: number } {
    const pHit = hitChance((magicLvl + 8 + 1) * (STAFF_MAGICATTACK + 64), defenceRoll(giant.def, giant.defBonus));
    const eDmg = pHit * (s.maxhit / 2);               // randominc(0..maxhit): mean maxhit/2
    const flat = s.exp * XPRATE / 10;                 // give_spell_xp, every cast
    const dmg = eDmg * 20 * XPRATE / 10;              // combat.rs2 dmg xp, only the hit fraction (already in eDmg)
    return { flat, dmg, total: flat + dmg, pHit };
}

const XP55 = xpForLevel(55), XP99 = xpForLevel(99);
const GAP = XP99 - XP55;
console.log(`xpForLevel(55) = ${XP55.toLocaleString()}   xpForLevel(99) = ${XP99.toLocaleString()}`);
console.log(`55->99 gap = ${GAP.toLocaleString()} displayed magic xp\n`);

const fmtTime = (ticks: number) => `${(ticks * 40 / 60000).toFixed(1)}min@40ms (${(ticks * 300 / 3600000).toFixed(2)}h demo)`;

// ---- A) HIGH ALCH (baseline) ----
const alchXp = 650 * XPRATE / 10;                     // 1625 displayed/cast
const alchCasts = Math.ceil(GAP / alchXp);
console.log(`A) HIGH ALCH:  ${alchXp} xp/cast  ->  ${alchCasts} casts`);
console.log(`   runes: NATURE ${alchCasts} (GATED), fire ${alchCasts * 5} (FREE staff), + ${alchCasts} fodder items`);
console.log(`   playtime @5t/cast: ${fmtTime(alchCasts * 5)}   (@3t/cast: ${fmtTime(alchCasts * 3)})\n`);

// ---- B..E) fire-line combat spells, single-spell for the whole 55->99 where legal at 55 ----
// A spell castable from 55 the whole way: fire_strike (req13), fire_bolt (req35). fire_blast needs 59, wave 75.
function singleSpellRun(s: CombatSpell) {
    // simulate cast-by-cast so magic level (=> pHit) tracks up; each cast = 5 ticks
    let xp = XP55, casts = 0, ticks = 0;
    let sumFlat = 0, sumDmg = 0;
    while (xp < XP99 && casts < 5_000_000) {
        const lvl = levelForXpLocal(xp);
        const c = combatCastXp(s, lvl);
        xp += c.total; sumFlat += c.flat; sumDmg += c.dmg; casts++; ticks += 5;
    }
    return { casts, ticks, sumFlat, sumDmg };
}
function levelForXpLocal(xp: number): number { for (let l = 99; l >= 2; l--) if (xp >= xpForLevel(l)) return l; return 1; }

for (const s of FIRE_LINE.filter(s => s.req <= 55)) {
    const r = singleSpellRun(s);
    const airTot = r.casts * s.air;
    console.log(`B) ${s.name.toUpperCase()} (req ${s.req}) whole 55->99:  ~${((r.sumFlat + r.sumDmg) / r.casts).toFixed(0)} xp/cast  ->  ${r.casts} casts`);
    console.log(`   runes/cast: air ${s.air}${s.catalyst ? ` + ${s.catalyst} ${s.catN}` : ' + mind 1'} + fire (FREE staff)`);
    console.log(`   TOTAL runes: air ${airTot}` + (s.catalyst ? ` + ${s.catalyst} ${r.casts * s.catN}` : ` + mind ${r.casts * MIND_PER_FIRESTRIKE}`) + `,  NATURE 0`);
    console.log(`   playtime @5t/cast: ${fmtTime(r.ticks)}\n`);
}

// ---- F) LADDER: climb fire_bolt(55) -> fire_blast(59) -> fire_wave(75) as magic rises ----
{
    let xp = XP55, casts = 0, ticks = 0;
    let air = 0, chaos = 0, death = 0, blood = 0;
    while (xp < XP99 && casts < 5_000_000) {
        const lvl = levelForXpLocal(xp);
        const s = [...FIRE_LINE].reverse().find(sp => lvl >= sp.req && sp.req <= 55 ? true : lvl >= sp.req)!; // best available now
        const c = combatCastXp(s, lvl);
        xp += c.total; casts++; ticks += 5;
        air += s.air;
        if (s.catalyst === 'chaos') chaos += s.catN;
        else if (s.catalyst === 'death') death += s.catN;
        else if (s.catalyst === 'blood') blood += s.catN;
    }
    console.log(`F) LADDER fire_bolt->fire_blast(59)->fire_wave(75):  ${casts} casts`);
    console.log(`   TOTAL runes: air ${air}, chaos ${chaos}, death ${death}, blood ${blood},  NATURE 0`);
    console.log(`   playtime @5t/cast: ${fmtTime(ticks)}\n`);
}

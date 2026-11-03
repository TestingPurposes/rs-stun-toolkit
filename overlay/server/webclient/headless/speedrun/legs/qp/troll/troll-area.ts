// troll-area.ts — moving around Burthorpe, Death Plateau, the Troll Stronghold and Trollheim (cheat-free). Shared by the
// troll lane's Eadgar's Ruse and Troll Romance. Every transition is a scripted loc, verified in the 289 content:
//   Death Plateau rocks 3723 (2880,3594) + troll climbing rocks 3748 (2856,3612) / (2834,3628) (quest_death.rs2:158-174,
//   quest_troll.rs2:1-15 -> upass_obstacles.rs2 rockslide_obstacle; worn climbing boots only at z 3611); the stronghold's
//   secret door troll_stronghold_entrance 3762 (2827,3647) -> prison (2823,10050) once Godric was freed or the back exit was
//   opened (quest_troll.rs2:108-114); stairs troll_stronghold_stairs 3788 / stairstop 3789 (:202-219); the prison door 3780
//   (2848,10107) opens freely once %troll_quest >= entered_prison (:222-234); the top exit 3772-3774 (2838,10089-10091) ->
//   (2840,3690) (:199-200); the stronghold door 3771 (2839,3689) -> L2 (2837,10090) (:197-199); Eadgar's cave entrance 3759
//   (2892,3672) -> his home L2 (2893,10074) only if %troll_freed_eadgar, else the empty L0 cave (:129-134); his exit 3760.
//   Games necklace (necklace_of_minigames.rs2) -> games room (2207,4940) -> stairs 4622 (2207,4935) -> L1 -> grey stairs 4627
//   (2205,4935) -> Burthorpe (2899,3564) (ladders+stairs/scripts/stairs.rs2:471-517).
import { SpeedBot, cheb, objDebugName, objId } from '../../../core.js';
import { classifyRegion } from '../../../../quest-troll.js';
import { Ctx, go, obstacle, rubTeleport, dismiss, inDialog } from './lib-troll.js';
import { wield } from '../../run-lib.js';

export type Area = 'gamesroom' | 'south' | 'plateau' | 'band' | 'xpocket' | 'prison' | 'l0east' | 'l1e' | 'l1w' | 'l2' | 'surface' | 'eadgar' | 'eadgarL0'
    | 'arena' | 'north' | 'pass' | 'icecave' | 'trollweiss' | 'other';

/** Which part of the troll area the player is in (stronghold coordinates: quest-troll.ts classifyRegion + the m44_157 map). */
export function area(bot: SpeedBot): Area {
    const t = bot.tile(), lv = bot.minusedlevel;
    if (t.x >= 2176 && t.x <= 2240 && t.z >= 4900 && t.z <= 4990) return 'gamesroom';
    if (t.z > 6400) {
        if (t.x >= 2880 && t.x <= 2905 && t.z >= 10060 && t.z <= 10100) return lv === 2 ? 'eadgar' : 'eadgarL0';
        if (lv === 0 && t.x >= 2880 && t.x <= 2935 && t.z >= 10000 && t.z <= 10045) return 'pass';
        if (lv === 0 && t.x >= 2750 && t.x <= 2815 && t.z >= 10180 && t.z <= 10240) return 'icecave';   // Trollweiss ice-troll cave
        if (t.x >= 2816 && t.x <= 2879 && t.z >= 10040 && t.z <= 10115) {
            if (lv === 2) return 'l2';
            if (lv === 1) return (t.x >= 2848 && t.x <= 2858 && t.z >= 10100) ? 'l1e' : 'l1w';
            if (lv === 0) return (t.x <= 2843 || t.z >= 10102) ? 'prison' : 'l0east';
        }
        return 'other';
    }
    if (lv !== 0) return 'other';
    const r = classifyRegion(0, t.x, t.z);
    if (r === 'arena' || r === 'north') return r;
    if (t.x >= 2750 && t.x <= 2815 && t.z >= 3761 && t.z <= 3900) return 'trollweiss';   // the mountain + the flower plateau
    if (r === 'troll') return 'surface';
    if (t.z >= 3648 && t.z <= 3760 && t.x >= 2780 && t.x <= 2940) return 'surface';   // Trollheim incl. the cave plateau
    if (r === 'plateau' || r === 'band' || r === 'xpocket') return r;
    if (t.x >= 2780 && t.x <= 3000 && t.z >= 3380 && t.z <= 3640) return 'south';   // Taverley .. Burthorpe .. Death Plateau shelf
    return 'other';
}

async function wearBoots(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (bot.isWorn(objId('death_climbingboots'))) return;
    if (bot.count('death_climbingboots') === 0) c.fail('climbing boots needed (Death Plateau rocks, quest_death.rs2:167-174)');
    await wield(bot, ['death_climbingboots']);
}

/** Protection prayer for a dangerous stretch (sim: the Death Plateau shelf walk took 26 of 80 hp from troll throwers; the
 *  stronghold's L2 hall has Troll Generals, max 38 melee). Off again after the hop. No-op below the prayer level. */
export function pray(bot: SpeedBot, name: 'protectfrommissiles' | 'protectfrommelee', on: boolean, min: number): void {
    if (on && (bot.stat('prayer').level < min || bot.stat('prayer').cur <= 0)) return;
    if (bot.isPrayerActive(name) === on) return;
    if (on) bot.activatePrayer(name); else bot.deactivatePrayer(name);
    bot.queueFlush();
}
export function prayOff(bot: SpeedBot): void { pray(bot, 'protectfrommissiles', false, 0); pray(bot, 'protectfrommelee', false, 0); }

/** Areas reached through the prison's back door (Death Plateau side), not the stronghold's top exit. */
const SOUTH = new Set<Area>(['south', 'plateau', 'band', 'xpocket', 'gamesroom']);

/** One hop from `a` towards `dest`. */
async function hop(c: Ctx, a: Area, dest: Area): Promise<void> {
    const bot = c.bot;
    const inStronghold = (d: Area) => d === 'prison' || d === 'l1e' || d === 'l1w' || d === 'l2' || d === 'l0east';
    const at = (x: Area) => () => area(bot) === x;
    switch (a) {
        case 'gamesroom':
            if (bot.minusedlevel === 0) await obstacle(c, { id: 4622, x: 2207, z: 4935 }, null, () => bot.minusedlevel === 1, 'games room stairs up');
            await obstacle(c, { id: 4627, x: 2205, z: 4935, level: 1 }, null, () => bot.tile().z < 4000, 'games room exit');
            return;
        case 'south':
            // Burthorpe -> Death Plateau rocks (worn climbing boots) -> plateau
            await wearBoots(c);
            pray(bot, 'protectfrommelee', true, 43);   // the shelf: 14 melee trolls + 6 throwers (map spawns)
            await obstacle(c, { id: 3723, x: 2880, z: 3594 }, { x: 2880, z: 3593 }, () => bot.tile().z >= 3596 && area(bot) !== 'south', 'Death Plateau rocks');
            pray(bot, 'protectfrommelee', false, 0);
            return;
        case 'plateau':
            if (dest === 'south') { await wearBoots(c); await obstacle(c, { id: 3722, x: 2880, z: 3595 }, { x: 2880, z: 3596 }, at('south'), 'Death Plateau rocks down'); pray(bot, 'protectfrommelee', true, 43); return; }   // the shelf below is thrower country: the caller turns it off
            await wearBoots(c);
            await obstacle(c, { id: 3748, x: 2856, z: 3612 }, { x: 2856, z: 3611 }, () => bot.tile().z >= 3613, 'troll rocks (2856,3612)');
            return;
        case 'band':
            if (dest === 'south' || dest === 'plateau') { await obstacle(c, { id: 3748, x: 2856, z: 3612 }, { x: 2856, z: 3613 }, () => bot.tile().z <= 3611, 'troll rocks south'); return; }
            await obstacle(c, { id: 3748, x: 2834, z: 3628 }, { x: 2834, z: 3627 }, () => bot.tile().z >= 3629, 'troll rocks (2834,3628)');
            return;
        case 'xpocket':
            if (dest === 'south' || dest === 'plateau' || dest === 'band') { await obstacle(c, { id: 3748, x: 2834, z: 3628 }, { x: 2834, z: 3629 }, () => bot.tile().z <= 3627, 'troll rocks (2834,3628) south'); return; }
            await obstacle(c, { id: 3762, x: 2827, z: 3647 }, null, () => bot.tile().z > 6400, 'secret prison door (Troll Stronghold done?)');
            return;
        case 'prison':
            if (dest === 'south' || dest === 'plateau' || dest === 'band' || dest === 'xpocket') { await obstacle(c, { id: 3761, x: 2823, z: 10048 }, null, () => bot.tile().z < 6400, 'prison exit'); return; }
            await obstacle(c, { id: 3788, x: 2852, z: 10106 }, null, at('l1e'), 'prison stairs up');
            return;
        case 'l1e':
            if (dest === 'prison' || SOUTH.has(dest)) { await obstacle(c, { id: 3789, x: 2852, z: 10107, level: 1 }, null, at('prison'), 'prison stairs down'); return; }
            await obstacle(c, { id: 3780, x: 2848, z: 10107, level: 1 }, null, at('l1w'), 'prison door (out)');
            return;
        case 'l1w':
            if (dest === 'prison' || dest === 'l1e' || SOUTH.has(dest)) { await obstacle(c, { id: 3780, x: 2848, z: 10107, level: 1 }, null, at('l1e'), 'prison door (in)'); return; }
            if (dest === 'l0east') { await obstacle(c, { id: 3789, x: 2852, z: 10061, level: 1 }, null, at('l0east'), 'stairs down (storeroom side)'); return; }
            {   // two stair pairs (m44_157): (2842,10051) by the kitchen, (2842,10108) by the prison door: take the nearer
                const z = 10108;   // the kitchen-side pair (2842,10051) did not answer an op from (2843,10053) in the sim
                await obstacle(c, { id: 3788, x: 2842, z, level: 1 }, null, at('l2'), `stairs up to L2 (${z})`);
            }
            return;
        case 'l0east':
            await obstacle(c, { id: 3788, x: 2852, z: 10061 }, null, at('l1w'), 'stairs up (storeroom side)');
            return;
        case 'l2':
            pray(bot, 'protectfrommelee', true, 43);
            try { await hopL2(c, dest); } finally { pray(bot, 'protectfrommelee', false, 0); }
            return;
        default: break;
    }
    await hop2(c, a, dest);
}
async function hopL2(c: Ctx, dest: Area): Promise<void> {
    const bot = c.bot;
    const inStronghold = (d: Area) => d === 'prison' || d === 'l1e' || d === 'l1w' || d === 'l2' || d === 'l0east';
    const at = (x: Area) => () => area(bot) === x;
    switch ('l2' as Area) {
        case 'l2':
            if (inStronghold(dest) || SOUTH.has(dest)) {
                const z = 10108;
                await obstacle(c, { id: 3789, x: 2843, z, level: 2 }, null, at('l1w'), `stairs down to L1 (${z})`); return;
            }
            await obstacle(c, { id: 3774, x: 2838, z: 10090, level: 2 }, null, () => bot.tile().z < 6400, 'stronghold top exit');
            return;
    }
}
async function hop2(c: Ctx, a: Area, dest: Area): Promise<void> {
    const bot = c.bot;
    const at = (x: Area) => () => area(bot) === x;
    switch (a) {
        case 'surface':
            if (dest === 'eadgar') {
                await go(c, { x: 2892, z: 3674 }, 'Eadgar\'s cave', { near: 1, maxTicks: 400 });
                await obstacle(c, { id: 3759, x: 2892, z: 3672 }, null, () => bot.tile().z > 6400, 'Eadgar\'s cave entrance');
                if (area(bot) === 'eadgarL0') c.fail('Eadgar is not home (%troll_freed_eadgar false): free him first');
                return;
            }
            await go(c, { x: 2840, z: 3690 }, 'stronghold door', { near: 1, maxTicks: 400 });
            await obstacle(c, { id: 3771, x: 2839, z: 3689 }, null, () => bot.tile().z > 6400, 'stronghold door');
            return;
        case 'arena':   // Dad already beaten: the north exit (quest_troll.rs2:90-106)
            await obstacle(c, { id: 3785, x: 2916, z: 3629 }, { x: 2916, z: 3628 }, at('north'), 'arena exit');
            return;
        case 'north':
            await obstacle(c, { id: 3757, x: 2903, z: 3644 }, { x: 2904, z: 3643 }, at('pass'), 'troll pass entrance');
            return;
        case 'pass':
            await obstacle(c, { id: 3758, x: 2906, z: 10036 }, { x: 2907, z: 10035 }, at('surface'), 'troll pass exit');
            return;
        case 'eadgar': case 'eadgarL0':
            await obstacle(c, { id: 3760, x: 2892, z: 10072, level: bot.minusedlevel }, null, () => bot.tile().z < 6400, 'Eadgar\'s cave exit');
            return;
        default:
            c.fail(`no route from ${a} (${JSON.stringify(bot.pos())}) to ${dest}`);
    }
}

/** Travel inside the troll area until `area(bot) === dest` (max 14 hops). */
export async function goto(c: Ctx, dest: Area): Promise<void> {
    try {
        for (let k = 0; k < 14; k++) {
            if (inDialog(c.bot)) { dismiss(c.bot); await c.bot.tick(1); }
            const a = area(c.bot);
            if (a === dest) return;
            // the Trollheim paths (mountain trolls) and the shelf: Protect from Melee for the whole hop (sim: one run fell to
            // 21 of 80 hp with prayers only on the shelf and in the L2 hall)
            if (a === 'surface' || a === 'plateau' || a === 'band' || a === 'xpocket') pray(c.bot, 'protectfrommelee', true, 43);
            await hop(c, a, dest);
        }
        if (area(c.bot) !== dest) c.fail(`goto ${dest}: still in ${area(c.bot)}`);
    } finally { prayOff(c.bot); }
}

/** Games necklace (any charge) -> Burthorpe games room -> Burthorpe surface (2899,3564). */
export async function necklaceToBurthorpe(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (!(await rubTeleport(c, /^necklace_of_minigames_[1-8]$/, /^Burthorpe Games Rooms\.$/))) c.fail(`games necklace (pack: ${bot.inv().map(s => objDebugName(s.obj)).join(',')})`);
    c.mark('necklace');
    await goto(c, 'south');
}
export { cheb };

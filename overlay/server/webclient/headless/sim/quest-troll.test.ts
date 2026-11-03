// cd server/webclient/headless/sim && bun test quest-troll.test.ts      (NEVER `bun test headless/sim`)
//
// TROLL STRONGHOLD DRIVER (quest-troll.ts). Pure tests of the step table / region model / fight policy / dialog
// policy / text oracle, content pins that break when the .rs2/.jm2/.pack drift, and three sim tests of real
// driver executors against CoopWorld (a scripted-loc transition, the General kill->loot, the Denulth start by
// option LABEL). Offline routing of every leg lives in quest-troll-geo.test.ts (needs the 25 s pathfinder init).
import { describe, test, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoopWorld, CoopHarness } from './coop.js';
import { openField } from './world.js';
import {
    TROLL_T, TROLL_IDS, TROLL_STAGE, GODRIC_CELL, classifyRegion, regionFloor, decideTroll, newKnowledge, learnFromText,
    fightPlan, trollDialogPick, TrollQuestBot, __troll, type TrollObs, type TrollKnowledge, type TrollRegion, type TrollAction,
} from '../quest-troll.js';

const CONTENT = join(import.meta.dir, '..', '..', '..', 'content');
const read = (p: string) => readFileSync(join(CONTENT, p), 'utf8');

/** Where each transition's script puts you (cited in quest-troll.ts TROLL_T). */
const LANDING: Record<string, { level: number; x: number; z: number }> = {
    DP_UP: { level: 0, x: 2880, z: 3596 }, DP_DOWN: { level: 0, x: 2880, z: 3593 },
    RS_N: { level: 0, x: 2856, z: 3613 }, RS_S: { level: 0, x: 2856, z: 3611 }, R2834_S: { level: 0, x: 2834, z: 3627 },
    CLIMB1_E: { level: 0, x: 2861, z: 3626 }, CLIMB1_W: { level: 0, x: 2858, z: 3626 },
    CLIMB2_E: { level: 0, x: 2880, z: 3622 }, CLIMB2_W: { level: 0, x: 2877, z: 3622 },
    ARENA_IN: { level: 0, x: 2897, z: 3618 }, ARENA_OUT_W: { level: 0, x: 2896, z: 3618 }, ARENA_EXIT: { level: 0, x: 2916, z: 3629 },
    PASS_IN: { level: 0, x: 2907, z: 10019 }, PASS_OUT: { level: 0, x: 2908, z: 3654 },
    SH_DOOR: { level: 2, x: 2837, z: 10090 }, L2_DOWN: { level: 1, x: 2841, z: 10108 }, L1_UP: { level: 2, x: 2845, z: 10108 },
    PRISON_DOOR: { level: 1, x: 2848, z: 10107 }, L1_DOWN: { level: 0, x: 2852, z: 10105 }, PRISON_EXIT: { level: 0, x: 2827, z: 3646 },
};
const FROM: Record<string, TrollRegion> = {
    DP_UP: 'south', DP_DOWN: 'plateau', RS_N: 'plateau', RS_S: 'band', R2834_S: 'xpocket', CLIMB1_E: 'band', CLIMB1_W: 'mid',
    CLIMB2_E: 'mid', CLIMB2_W: 'east', ARENA_IN: 'east', ARENA_OUT_W: 'arena', ARENA_EXIT: 'arena', PASS_IN: 'north', PASS_OUT: 'pass',
    SH_DOOR: 'troll', L2_DOWN: 'L2', L1_UP: 'L1w', PRISON_DOOR: 'L1w', L1_DOWN: 'L1e', PRISON_EXIT: 'prison',
};

function ob(p: { level: number; x: number; z: number }, extra: Partial<TrollObs> = {}): TrollObs {
    return { pos: p, region: classifyRegion(p.level, p.x, p.z), journal: 'IN_PROGRESS', lawTalisman: 0, bootsWorn: true, bootsHeld: 0, coins: 100, prisonKey: 0, cellKey: 0, food: 20, ...extra };
}
const kn = (lb: number, ub = lb, oracle = true): TrollKnowledge => ({ ...newKnowledge(), lb, ub, oracleDone: oracle });
const name = (a: TrollAction) => a.kind === 'transition' ? a.t.id : a.kind;
const raiseTo = (k: TrollKnowledge, v: number) => { k.lb = Math.max(k.lb, v); k.oracleDone = true; };

describe('region model', () => {
    test('every stand tile is in its from-region and every landing in a different one', () => {
        for (const [id, t] of Object.entries(TROLL_T)) {
            expect(`${id}:${classifyRegion(t.level, t.stand.x, t.stand.z)}`).toBe(`${id}:${FROM[id]}`);
            const L = LANDING[id]!;
            expect(t.landed({ level: L.level, x: L.x, z: L.z })).toBe(true);
            expect(t.landed({ level: t.level, x: t.stand.x, z: t.stand.z })).toBe(false);   // a failed climb is never "landed"
            expect(classifyRegion(L.level, L.x, L.z)).not.toBe(FROM[id]);
        }
    });
    test('NPC anchors and the ambiguous Death Plateau strip', () => {
        expect(classifyRegion(0, 2896, 3530)).toBe('south');      // Denulth
        expect(classifyRegion(0, 2919, 3576)).toBe('south');      // Dunstan
        expect(classifyRegion(0, 2821, 3557)).toBe('south');      // Tenzing
        expect(classifyRegion(0, 2860, 3600)).toBe('south');      // on the Death Plateau shelf
        expect(classifyRegion(0, 2878, 3596)).toBe('south');      // shelf, one wall west of the corridor
        expect(classifyRegion(0, 2880, 3600)).toBe('plateau');    // corridor above the 3723 rocks
        expect(classifyRegion(0, 2860, 3609)).toBe('plateau');
        expect(classifyRegion(0, 2835, 3600)).toBe('plateau');    // west diagonal path (z - x >= 761)
        expect(classifyRegion(0, 2912, 3613)).toBe('arena');      // Dad
        expect(classifyRegion(2, 2831, 10086)).toBe('L2');        // a General
        expect(classifyRegion(0, 2832, 10079)).toBe('prison');    // Twig
        expect(classifyRegion(0, 2852, 10064)).toBe('L0east');
    });
    test('region floors', () => {
        expect(regionFloor('south')).toBe(-1);
        expect(regionFloor('band')).toBe(TROLL_STAGE.STARTED);
        expect(regionFloor('troll')).toBe(TROLL_STAGE.DEFEATED_DAD);
        expect(regionFloor('prison')).toBe(TROLL_STAGE.ENTERED_PRISON);
    });
});

describe('decideTroll — the step table', () => {
    test('FORWARD CHAIN from Burthorpe to Dunstan, landing tile by landing tile', () => {
        const k = kn(TROLL_STAGE.STARTED, TROLL_STAGE.COMPLETE);   // started; later stages unknown (probe-by-trying)
        let p: { level: number; x: number; z: number } = { level: 0, x: 2896, z: 3530 };
        let extra: Partial<TrollObs> = {};
        const seq: string[] = [];
        for (let i = 0; i < 40; i++) {
            const a = decideTroll(ob(p, extra), k);
            seq.push(name(a));
            if (a.kind === 'transition') {
                p = LANDING[a.t.id]!;
                if (a.t.id === 'ARENA_EXIT' && k.lb < TROLL_STAGE.DEFEATED_DAD) { learnFromText(k, 'No human pass through arena without defeating Dad!'); p = { level: 0, x: 2916, z: 3628 }; seq[seq.length - 1] += '(refused)'; }
                if (a.t.id === 'PRISON_DOOR' && extra.prisonKey) { learnFromText(k, 'You unlock the prison door.'); extra = { ...extra, prisonKey: 0 }; }
                else if (a.t.id === 'PRISON_DOOR') { learnFromText(k, 'You need a key.'); p = { level: 1, x: 2847, z: 10107 }; seq[seq.length - 1] += '(refused)'; }
            } else if (a.kind === 'fightDad') learnFromText(k, 'Stop! You win. Not hurt Dad.');
            else if (a.kind === 'getPrisonKey') extra = { ...extra, prisonKey: 1 };
            else if (a.kind === 'getCellKey') extra = { ...extra, cellKey: 1 };
            else if (a.kind === 'freeGodric') { learnFromText(k, 'Thank you, my friend.'); extra = { ...extra, cellKey: 0 }; }
            else if (a.kind === 'dunstanComplete') { learnFromText(k, 'He is safe and sound, thanks to you my friend!'); extra = { ...extra, lawTalisman: 1 }; }
            else break;
        }
        expect(seq).toEqual([
            'DP_UP', 'RS_N', 'CLIMB1_E', 'CLIMB2_E', 'ARENA_IN', 'ARENA_EXIT(refused)', 'fightDad', 'ARENA_EXIT', 'PASS_IN', 'PASS_OUT',
            // the arena refusal proved stage < 20 and beating Dad sets EXACTLY 20 -> the General first, no door probe
            'SH_DOOR', 'getPrisonKey', 'L2_DOWN', 'PRISON_DOOR', 'L1_DOWN', 'getCellKey',
            'freeGodric', 'PRISON_EXIT', 'R2834_S', 'RS_S', 'DP_DOWN', 'dunstanComplete', 'done',
        ]);
    });
    test('unknown stage at the prison door: try it, and a "You need a key." sends the bot back up for a General', () => {
        const k = newKnowledge(); raiseTo(k, TROLL_STAGE.DEFEATED_DAD);
        const l1 = { level: 1, x: 2841, z: 10108 };
        expect(name(decideTroll(ob(l1), k))).toBe('PRISON_DOOR');
        learnFromText(k, 'You need a key.');
        expect(name(decideTroll(ob(l1), k))).toBe('L1_UP');
        expect(name(decideTroll(ob({ level: 2, x: 2845, z: 10108 }), k))).toBe('getPrisonKey');
        expect(name(decideTroll(ob({ level: 2, x: 2845, z: 10108 }, { prisonKey: 1 }), k))).toBe('L2_DOWN');
        expect(name(decideTroll(ob(l1, { prisonKey: 1 }), k))).toBe('PRISON_DOOR');
    });
    test('unknown stage in Burthorpe -> ask Denulth first; not started -> Denulth starts it', () => {
        const home = { level: 0, x: 2896, z: 3530 };
        expect(name(decideTroll(ob(home), { ...newKnowledge() }))).toBe('talkDenulth');
        expect(name(decideTroll(ob(home, { journal: 'NOT_OBSERVABLE' }), { ...newKnowledge() }))).toBe('talkDenulth');
        const k0 = newKnowledge(); k0.ub = 0;
        expect(name(decideTroll(ob(home, { journal: 'NOT_STARTED' }), k0))).toBe('talkDenulth');
        const k = newKnowledge(); learnFromText(k, 'Hello citizen, how can I help?');
        expect(decideTroll(ob(home), k)).toEqual({ kind: 'fail', why: expect.stringContaining('Death Plateau') });
    });
    test('boots: buy in Burthorpe, wear if held, refuse to strand outside', () => {
        const home = { level: 0, x: 2896, z: 3530 };
        expect(name(decideTroll(ob(home, { bootsWorn: false }), kn(10)))).toBe('buyBoots');
        expect(name(decideTroll(ob(home, { bootsWorn: false, bootsHeld: 1 }), kn(10)))).toBe('wearBoots');
        expect(name(decideTroll(ob({ level: 0, x: 2856, z: 3611 }, { bootsWorn: false, bootsHeld: 1 }), kn(10)))).toBe('wearBoots');
        expect(decideTroll(ob({ level: 0, x: 2856, z: 3611 }, { bootsWorn: false }), kn(10)).kind).toBe('fail');
        // the way BACK needs no boots until the Death Plateau rocks
        expect(name(decideTroll(ob({ level: 0, x: 2834, z: 3629 }, { bootsWorn: false }), kn(40)))).toBe('R2834_S');
        expect(name(decideTroll(ob({ level: 0, x: 2856, z: 3613 }, { bootsWorn: false }), kn(40)))).toBe('RS_S');
    });
    test('resume mid-quest from position alone', () => {
        const k = newKnowledge();   // nothing learned, journal yellow
        expect(name(decideTroll(ob({ level: 2, x: 2837, z: 10090 }), k))).toBe('L2_DOWN');          // try the door: it tells
        expect(name(decideTroll(ob({ level: 0, x: 2835, z: 10095 }), k))).toBe('getCellKey');       // in the prison
        expect(name(decideTroll(ob({ level: 0, x: 2835, z: 10095 }, { cellKey: 1 }), k))).toBe('freeGodric');
        expect(name(decideTroll(ob({ level: 0, x: 2912, z: 3613 }), k))).toBe('ARENA_EXIT');        // arena: try the exit first
        expect(name(decideTroll(ob({ level: 0, x: 2912, z: 3613 }), kn(10, 19)))).toBe('fightDad');
        expect(name(decideTroll(ob({ level: 2, x: 2837, z: 10090 }), kn(20, 29)))).toBe('getPrisonKey');
        expect(name(decideTroll(ob({ level: 2, x: 2837, z: 10090 }, { prisonKey: 1 }), kn(20, 29)))).toBe('L2_DOWN');
    });
    test('complete: claim in Burthorpe, walk home from anywhere first', () => {
        expect(name(decideTroll(ob({ level: 0, x: 2919, z: 3576 }, { journal: 'COMPLETE' }), newKnowledge()))).toBe('dunstanClaim');
        expect(name(decideTroll(ob({ level: 0, x: 2919, z: 3576 }, { journal: 'COMPLETE', lawTalisman: 1 }), newKnowledge()))).toBe('done');
        expect(name(decideTroll(ob({ level: 0, x: 2835, z: 10095 }, { journal: 'COMPLETE' }), newKnowledge()))).toBe('PRISON_EXIT');
        expect(name(decideTroll(ob({ level: 0, x: 2912, z: 3613 }, { journal: 'COMPLETE' }), newKnowledge()))).toBe('ARENA_OUT_W');
        expect(name(decideTroll(ob({ level: 0, x: 2885, z: 3620 }, { journal: 'COMPLETE' }), newKnowledge()))).toBe('CLIMB2_W');
        expect(name(decideTroll(ob({ level: 0, x: 2870, z: 3622 }, { journal: 'COMPLETE' }), newKnowledge()))).toBe('CLIMB1_W');
        // claim goal: talisman in pack = done whatever the journal says; Dunstan refusing = fail, never a loop
        expect(name(decideTroll(ob({ level: 0, x: 2919, z: 3576 }, { journal: 'NOT_OBSERVABLE', lawTalisman: 1 }), newKnowledge(), 'claim'))).toBe('done');
        const k = newKnowledge(); k.claimNotOffered = true;
        expect(decideTroll(ob({ level: 0, x: 2919, z: 3576 }, { journal: 'COMPLETE' }), k, 'claim').kind).toBe('fail');
    });
    test('the L0 east wing is reported, not guessed', () => {
        expect(decideTroll(ob({ level: 0, x: 2852, z: 10064 }), newKnowledge()).kind).toBe('fail');
    });
});

describe('learnFromText — the stage oracle', () => {
    const at = (line: string, k = newKnowledge()) => { learnFromText(k, line); return [k.lb, k.ub]; };
    test('Denulth names the stage (death_ig_commander.rs2:28-48)', () => {
        expect(at('I have freed Godric!')).toEqual([40, 40]);
        expect(at("I've found my way into the prison.")).toEqual([30, 30]);
        expect(at("I've defeated the troll champion!")).toEqual([20, 20]);
        expect(at("I've found my way into the stronghold!")).toEqual([20, 20]);
        expect(at('How are you getting on with rescuing Godric?')).toEqual([10, 10]);
        expect(at('God speed friend! I would send some of my men with you, but none of them are brave enough to follow.')).toEqual([10, 10]);
        expect(at('We are busy preparing for an attack by night. Godric knows of a secret entrance')).toEqual([50, 50]);
        expect(at('<p,sad>I\'m afraid I have bad news.|We made our attack as planned,|but we met unexpected resistance.')).toEqual([-1, 50]);
    });
    test('refusals cap, successes raise', () => {
        expect(at('You need a key.')).toEqual([-1, 29]);
        expect(at('You need a key to unlock the door.')).toEqual([-1, 50]);     // the CELL door's line is not the prison door's
        expect(at('No human pass through arena without defeating Dad!')).toEqual([-1, 19]);
        expect(at('Stop! You win. Not hurt Dad.')).toEqual([20, 50]);
        expect(at('Have you managed to rescue Godric yet?')).toEqual([10, 39]);
        const k = newKnowledge(); learnFromText(k, "You pick the guard's pocket but find nothing.", { cellKeyHeld: true });
        expect(k.lb).toBe(-1);
        learnFromText(k, "You pick the guard's pocket but find nothing.", { cellKeyHeld: false });
        expect(k.lb).toBe(40);
        const b = newKnowledge(); learnFromText(b, "You'll need some climbing boots to go that way."); expect(b.bootsRefused).toBe(true);
        const r = newKnowledge(); learnFromText(r, 'Dunstan hands you a law talisman.'); expect(r.claimed).toBe(true);
    });
});

describe('fightPlan — eat / flee / pray thresholds', () => {
    const base = { hp: 99, maxHp: 99, food: 10, prayerPts: 99, prayerLevel: 99, protectOn: true, wantProtect: true, targetVisible: true };
    test('eat at <= 50% with food; flee at <= 25% only with no food and no protection', () => {
        expect(fightPlan({ ...base, hp: 50 }).eat).toBe(false);
        expect(fightPlan({ ...base, hp: 49 }).eat).toBe(true);
        expect(fightPlan({ ...base, hp: 24, food: 0, protectOn: false }).flee).toBe(true);
        expect(fightPlan({ ...base, hp: 24, food: 0, protectOn: true }).flee).toBe(false);   // Protect from Melee = Dad/General deal 0
        expect(fightPlan({ ...base, hp: 24, food: 0, protectOn: false }).attack).toBe(false);
        expect(fightPlan({ ...base, hp: 25, food: 0, protectOn: false }).flee).toBe(false);
    });
    test('pray only when wanted, off, points left and level >= 43', () => {
        expect(fightPlan({ ...base, protectOn: false }).pray).toBe(true);
        expect(fightPlan({ ...base, protectOn: false, prayerPts: 0 }).pray).toBe(false);
        expect(fightPlan({ ...base, protectOn: false, prayerLevel: 42 }).pray).toBe(false);
        expect(fightPlan({ ...base, protectOn: false, wantProtect: false }).pray).toBe(false);
        expect(fightPlan({ ...base, protectOn: false }).attack).toBe(true);                  // praying never blocks the swing
    });
});

describe('trollDialogPick — by label, never by position', () => {
    const s = { wantBoots: false, claim: false };
    test('Denulth start chain', () => {
        expect(trollDialogPick(['How goes your fight with the trolls?', 'I thought the White Knights controlled Asgarnia?', 'See you about Denulth!'], s)!.source).toContain('How goes');
        expect(trollDialogPick(["I'm sorry to hear that.", 'Is there anything I can do to help?'], s)!.source).toContain('anything I can do');
        expect(trollDialogPick(["I'll get Godric back!", "I'm sorry, there's nothing I can do."], s)!.source).toContain('Godric back');
    });
    test('Dunstan: the talisman only when claiming, otherwise leave', () => {
        const m5 = ['Can I have another law talisman?', 'Can you put some spikes on my Climbing boots?', 'How is your son getting on?', 'Is it OK if I use your anvil?', 'Nothing, thanks.'];
        expect(trollDialogPick(m5, { ...s, claim: true })!.source).toContain('law talisman');
        expect(trollDialogPick(m5, s)!.source).toContain('Nothing, thanks');
        expect(trollDialogPick(m5.slice(1), { ...s, claim: true })!.source).toContain('Nothing, thanks');
    });
    test('Tenzing buys exactly once (the p_choice5 loops)', () => {
        const m = ['Can I buy some Climbing boots?', 'What does a Sherpa do?', 'How did you find out about the secret way?', 'Nice place you have here.', 'Nothing, thanks!'];
        expect(trollDialogPick(m, { ...s, wantBoots: true })!.source).toContain('buy some Climbing');
        expect(trollDialogPick(['OK, sounds good.', 'No, thanks.'], { ...s, wantBoots: true })!.source).toContain('sounds good');
        expect(trollDialogPick(m, s)!.source).toContain('Nothing, thanks');
        expect(trollDialogPick(['OK, sounds good.', 'No, thanks.'], s)!.source).toContain('No, thanks');
    });
    test("Dad's surrender", () => {
        expect(trollDialogPick(["I'll be going now.", "I'm not done yet! Prepare to die!"], s)!.source).toContain('going now');
    });
});

describe('content pins (a drift here must break the test, not a run)', () => {
    const qt = read('scripts/quests/quest_troll/scripts/quest_troll.rs2');
    test('quest_troll.rs2 teleports and gates', () => {
        for (const needle of [
            'p_teleport(2_44_157_21_42);', 'p_teleport(0_44_56_11_62);', 'p_teleport(0_45_156_27_35);', 'p_teleport(0_45_57_28_6);',
            'inv_total(worn, death_climbingboots) = 0 & coordz(coord) = 3611', 'mes("You need a key.");', 'inv_add(inv, law_talisman, 1);',
            'if(%troll_quest < ^troll_defeated_dad) {', 'npc_add(0_44_157_11_29, troll_godric, 100);',
        ]) expect(qt).toContain(needle);
    });
    test('dialog labels the policy matches', () => {
        const den = read('scripts/quests/quest_death/scripts/death_ig_commander.rs2');
        expect(den).toContain('"How goes your fight with the trolls?", denulth_troll');
        expect(den).toContain('~p_choice2("I\'m sorry to hear that.", 1, "Is there anything I can do to help?", 2)');
        expect(den).toContain('~p_choice2("I\'ll get Godric back!", 1, "I\'m sorry, there\'s nothing I can do.", 2)');
        const dun = read('scripts/quests/quest_death/scripts/death_smithy.rs2');
        expect(dun).toContain('if(%troll_quest = ^troll_complete & ~obj_gettotal(law_talisman) = 0) {');
        expect(dun).toContain('@multi5("Can I have another law talisman?", dunstan_lawtali');
        const ten = read('scripts/quests/quest_death/scripts/death_sherpa.rs2');
        expect(ten).toContain('~p_choice5("Can I buy some Climbing boots?", 1');
        expect(ten).toContain('~p_choice2("OK, sounds good.", 1, "No, thanks.", 2)');
        const dad = read('scripts/quests/quest_troll/scripts/troll_champion.rs2');
        expect(dad).toContain('~p_choice2("I\'ll be going now.", 1, "I\'m not done yet! Prepare to die!", 2)');
        expect(dad).toContain('if(npc_stat(hitpoints) < 20 & p_finduid(%npc_aggressive_player) = true)');
    });
    test('pack ids', () => {
        const loc = read('pack/loc.pack'), npc = read('pack/npc.pack'), obj = read('pack/obj.pack');
        for (const t of Object.values(TROLL_T)) expect(loc).toMatch(new RegExp(`^${t.loc.id}=`, 'm'));
        for (const [id, nm] of [[3771, 'troll_stronghold_door'], [3780, 'troll_stronghold_prison_door_closed'], [3767, 'troll_celldoor_godric'], [3748, 'troll_climbingrocks'], [3723, 'death_climbingrocks_bottom']] as const)
            expect(loc).toContain(`\n${id}=${nm}\n`);
        expect(GODRIC_CELL.loc.id).toBe(3767);
        for (const [id, nm] of [[TROLL_IDS.DENULTH, 'death_ig_commander'], [TROLL_IDS.DUNSTAN, 'death_smithy'], [TROLL_IDS.TENZING, 'death_sherpa'], [TROLL_IDS.DAD, 'troll_champion'], [TROLL_IDS.TWIG_ASLEEP, 'troll_prison_guard1'], [1115, 'troll_general']] as const)
            expect(npc).toContain(`\n${id}=${nm}\n`);
        for (const [id, nm] of [[TROLL_IDS.LAW_TALISMAN, 'law_talisman'], [TROLL_IDS.CLIMBING_BOOTS, 'death_climbingboots'], [TROLL_IDS.PRISON_KEY, 'troll_key_prison'], [TROLL_IDS.CELL_KEY_GODRIC, 'troll_key_godric'], [TROLL_IDS.SHARK, 'shark']] as const)
            expect(obj).toContain(`\n${id}=${nm}\n`);
    });
    test('map placements (jm2 "level lx lz: id shape angle")', () => {
        const has = (sq: string, line: string) => expect(read(`maps/${sq}.jm2`)).toContain(line);
        has('m45_56', '0 0 10: 3723 22'); has('m44_56', '0 40 28: 3748 10 2'); has('m44_56', '0 43 42: 3790 22 2');
        has('m44_56', '0 62 38: 3791 22 3'); has('m45_56', '0 17 34: 3782 0'); has('m45_56', '0 36 45: 3785 0 3');
        has('m45_56', '0 23 60: 3757 10'); has('m45_156', '0 26 52: 3758 10'); has('m44_57', '0 23 41: 3771 10');
        has('m44_157', '2 27 60: 3789 10 1'); has('m44_157', '1 32 59: 3780 0'); has('m44_157', '1 36 59: 3789 10');
        has('m44_157', '0 16 30: 3767 0'); has('m44_157', '0 7 0: 3761 10 2'); has('m44_56', '0 18 44: 3748 10 2');
        has('m44_157', '0 16 31: 1128'); has('m45_55', '0 16 8: 1060'); has('m45_55', '0 39 54: 1082'); has('m44_55', '0 4 36: 1071');
    });
});

// ---- sim: real executors against CoopWorld ------------------------------------------------------------------
let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

/** Harness-synchronised driver tick + a pump that runs `p` to completion. */
function simClock() {
    let waiters: Array<() => void> = [];
    const tick = () => new Promise<void>(r => waiters.push(r));
    async function pump<T>(harness: CoopHarness, p: Promise<T>, max = 800): Promise<{ value: T | undefined; events: string[]; raw: any[] }> {
        let done = false; let value: T | undefined; const events: string[] = []; const raw: any[] = [];
        p.then(v => { done = true; value = v; }, e => { done = true; throw e; });
        for (let i = 0; i < max && !done; i++) {
            const r = await harness.tick();
            for (const e of r.events) { events.push(e.kind); raw.push(e); }
            const ws = waiters; waiters = []; ws.forEach(f => f());
            await new Promise(res => setTimeout(res, 0));
        }
        return { value, events, raw };
    }
    return { tick, pump };
}
const straight = (_l: number, _sx: number, _sz: number, dx: number, dz: number) => [{ x: dx, z: dz }];
const STATS = [{ stat: 3, xp: 13_034_431, level: 99 }, { stat: 0, xp: 13_034_431, level: 99 }, { stat: 2, xp: 13_034_431, level: 99 }, { stat: 1, xp: 13_034_431, level: 99 }];

describe('sim: driver executors', () => {
    test('SH_DOOR: walks onto the EXACT stand tile (2840,3690), OPLOCs 3771 and lands on L2 (2837,10090)', async () => {
        const w = new CoopWorld(openField());
        w.addPortal({ x: 2839, z: 3689, locId: 3771, op: 1, dest: { level: 2, x: 2837, z: 10090 }, size: 1 });
        h = new CoopHarness(w);
        const bot = new TrollQuestBot(); (bot as any).exitOnStuck = false;
        h.add({ bot: bot as any, name: 'troll1', index: 31, x: 2846, z: 3694, stats: STATS });
        await h.start();
        const clk = simClock();
        const c = __troll.makeCtx(bot, { findLongPath: straight, timeoutMs: 120_000, tick: clk.tick, log: () => {} });
        const { value, raw } = await clk.pump(h, __troll.runTransition(c, TROLL_T.SH_DOOR!));
        expect(value).toBe('ok');
        expect((bot as any).minusedlevel).toBe(2);
        expect(bot.tile()).toEqual({ x: 2837, z: 10090 });
        const climb = raw.find(e => e.kind === 'portal-climbed');
        expect(climb.detail.at).toEqual({ x: 2840, z: 3690, level: 0 });
    }, 60_000);

    test('getPrisonKey: walks to the L2 hall, kills a Troll General and TAKES the prison key', async () => {
        const w = new CoopWorld(openField());
        w.registerKillDrop(1116, TROLL_IDS.PRISON_KEY);    // drop tables/troll_commander.rs2:4-6
        w.addNpc(41, 1116, 2822, 10073);
        h = new CoopHarness(w);
        const bot = new TrollQuestBot(); (bot as any).exitOnStuck = false;
        h.add({ bot: bot as any, name: 'troll2', index: 32, x: 2837, z: 10090, level: 2, stats: STATS, inv: [{ id: TROLL_IDS.SHARK, count: 5 }] });
        await h.start();
        const clk = simClock();
        const c = __troll.makeCtx(bot, { findLongPath: straight, timeoutMs: 120_000, tick: clk.tick, log: () => {}, prayer: false });
        const { value, events } = await clk.pump(h, __troll.doGetPrisonKey(c), 1200);
        expect(value).toBe(true);
        expect(h.invCount('troll2', TROLL_IDS.PRISON_KEY)).toBe(1);
        expect(events).toContain('npc-killed');
        expect(events).toContain('obj-taken');
        // and the step table now sends it down the stairs
        expect(decideTroll(__troll.obs(c), c.k).kind === 'transition' && (decideTroll(__troll.obs(c), c.k) as any).t.id).toBe('L2_DOWN');
    }, 90_000);

    test('Denulth: picks "Is there anything I can do to help?" (option 2) by LABEL and reads the stage from his lines', async () => {
        const VARP = 9001;
        const w = new CoopWorld(openField());
        w.registerQuest([{
            npc: TROLL_IDS.DENULTH, op: 'talk', varp: VARP, whenState: 0, toState: TROLL_STAGE.STARTED,
            // death_ig_commander.rs2:79-95 (the sim models ONE decisive choice page, last): option 2 by label
            pages: 2, choicePage: 1, choiceRoot: 2459, expectChoice: 2,
            choiceLabels: ["I'm sorry to hear that.", 'Is there anything I can do to help?'],
            pageTexts: ['We made our attack as planned, but we met unexpected resistance. We were ambushed by trolls coming from the north.'],
        }, {
            // once started, opnpc1 short-circuits to denulth_trollquest (:2-4) whose first line names the stage
            npc: TROLL_IDS.DENULTH, op: 'talk', varp: VARP, whenState: TROLL_STAGE.STARTED, toState: TROLL_STAGE.STARTED, pages: 1,
            pageTexts: ['How are you getting on with rescuing Godric?'],
        }]);
        w.addNpc(42, TROLL_IDS.DENULTH, 2896, 3528);
        h = new CoopHarness(w);
        const bot = new TrollQuestBot(); (bot as any).exitOnStuck = false;
        h.add({ bot: bot as any, name: 'troll3', index: 33, x: 2899, z: 3534, stats: STATS });
        await h.start();
        const clk = simClock();
        const c = __troll.makeCtx(bot, { findLongPath: straight, timeoutMs: 120_000, tick: clk.tick, log: () => {} });
        (bot as any).trollPick = (opts: string[]) => trollDialogPick(opts, { wantBoots: false, claim: false });
        const { value, events } = await clk.pump(h, __troll.talkTo(c, TROLL_IDS.DENULTH, { x: 2896, z: 3530 }), 600);
        expect(value).toBe(true);
        expect(events).not.toContain('quest-wrong-choice');
        expect(w.questState(VARP)).toBe(TROLL_STAGE.STARTED);
        expect(c.k.ub).toBe(TROLL_STAGE.NOT_STARTED);          // his first page proved "not started" at the time
        // the oracle talk: a resumed driver learns the exact stage from Denulth's first line
        const again = await clk.pump(h, __troll.talkTo(c, TROLL_IDS.DENULTH, { x: 2896, z: 3530 }), 600);
        expect(again.value).toBe(true);
        expect([c.k.lb, c.k.ub]).toEqual([TROLL_STAGE.STARTED, TROLL_STAGE.STARTED]);
        expect(c.k.oracleDone).toBe(true);
        // a RESTARTED driver (fresh knowledge) re-asks and gets the SAME line on the same component: still learned
        const c2 = __troll.makeCtx(bot, { findLongPath: straight, timeoutMs: 120_000, tick: clk.tick, log: () => {} });
        const third = await clk.pump(h, __troll.talkTo(c2, TROLL_IDS.DENULTH, { x: 2896, z: 3530 }), 600);
        expect(third.value).toBe(true);
        expect([c2.k.lb, c2.k.ub, c2.k.oracleDone]).toEqual([TROLL_STAGE.STARTED, TROLL_STAGE.STARTED, true]);
    }, 60_000);
});

describe("decideTroll — goal 'descend'", () => {
    test('on the plateau it climbs DOWN (DP_DOWN); in the south region it is done', () => {
        const k = kn(TROLL_STAGE.STARTED, TROLL_STAGE.COMPLETE);
        expect(name(decideTroll(ob({ level: 0, x: 2881, z: 3596 }, { bootsWorn: true } as any), k, 'descend'))).toBe('DP_DOWN');
        expect(name(decideTroll(ob({ level: 0, x: 2896, z: 3530 }), k, 'descend'))).toBe('done');
    });
    test('the same plateau tile under the normal quest goal still heads north', () => {
        const k = kn(TROLL_STAGE.STARTED, TROLL_STAGE.COMPLETE);
        expect(name(decideTroll(ob({ level: 0, x: 2881, z: 3596 }, { bootsWorn: true } as any), k, 'quest'))).not.toBe('DP_DOWN');
    });
});

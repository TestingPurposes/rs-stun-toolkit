// bun test server/webclient/headless/sim/quest-state.test.ts
//
// Tests for the generated quest / progress state table + reader (headless/quest-state.ts).
//
// WHAT THESE TESTS ARE FOR. This module's whole value is that it says "I cannot see this" instead of
// "not started". That distinction is invisible at runtime — a bot that treats NOT_OBSERVABLE as
// NOT_STARTED does not crash, it just quietly re-derives the five-day Al Kharid outage from the other
// direction (declaring a passable gate impassable, or an impassable one passable). So the tests are of
// five kinds:
//
//   1. THE REFUSAL HAS TEETH — a getVarp that returns a "quest complete" value for EVERY id must not
//      make a single non-transmitted quest look complete, started, or finished. If the generator ever
//      publishes an id it should not, this suite fails loudly.
//   2. THE INTERVAL IS SOUND — questGateSatisfied is checked against a hand-written truth table for all
//      six operators over exact / lower-bounded / upper-bounded / unknown intervals, including the case
//      that motivates the whole design (^prince_saved sits BELOW ^prince_complete, so a yellow row
//      cannot decide the toll).
//   3. THE AL KHARID CASE END TO END — from obstacles.json's own requirement, through the reader, into
//      route-feasibility's classifyLoc, with the fee actually waived.
//   4. PINNED SURPRISES — values that look like bugs and are not (a quest whose progress is a VARBIT; a
//      journal row coloured from a different variable on one branch; a complete threshold ABOVE the
//      last named milestone).
//   5. REPRODUCIBILITY — the generator is re-run and compared byte-for-byte to the checked-in file.
//
// OFFLINE. Nothing here connects to a server, starts an engine, or logs in. Every varp source is a
// synthetic function and every journal map is built by hand.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    QUESTS, QUEST_BY_KEY, QUEST_BY_VARP, QUEST_BY_COMPONENT, QUEST_TABLE_STATS,
    QUEST_POINTS_VARP, QUEST_POINTS_EQUALITY_AWARDS, QUEST_POINTS_AWARDS, TOTAL_QUEST_POINTS,
    JOURNAL_COLOUR, IF_SETCOLOUR_PROT,
    GATING_VARPS, JOURNAL_OBSERVABLE_GATING_VARPS, UNOBSERVABLE_GATING_VARPS, QUEST_GATE_OPS,
    questState, questStateFromColour, questStateFromStage, isComplete, allQuestStates,
    observableQuestStates, journalFromEvents, questGateSatisfied, questProfile,
    type QuestObservation, type QuestDef,
} from '../quest-state.js';
import { obstacleRule, classifyLoc, type BotProfile } from '../route-feasibility.js';

// ---------------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------------

/** A varp source that has never been told anything — the honest state of a client that cannot read. */
const ZERO: (id: number) => number = () => 0;

/**
 * ⛔ THE ADVERSARY. Every varp reads back a value large enough to satisfy any quest's complete
 * threshold. If the table ever publishes an id for a variable the server does not send, this source
 * turns that quest COMPLETE and the refusal tests below fail.
 */
const ALL_COMPLETE: (id: number) => number = () => 1_000_000;

const def = (key: string): QuestDef => {
    const d = QUEST_BY_KEY.get(key);
    if (!d) throw new Error(`no quest '${key}' in the table`);
    return d;
};

/** Colour every quest's journal row the same way — the shape of the login burst. */
const journalAll = (colour: number) => new Map(QUESTS.map(q => [q.component, colour]));

/** The Al Kharid toll gate, as obstacles.json knows it: one op, a quest test AND a fee it waives. */
const TOLL_GATE_LOC = 2882;
/** A PURE quest gate (no fee to fall back on) — the Priest in Peril mausoleum door, `%priestperil >= 5`. */
const PURE_QUEST_LOC = 3444;
const sceneLoc = (id: number, options: string[]) => ({
    id, name: 'Gate', x: 3268, z: 3227, level: 0, distance: 0,
    shape: 0, angle: 0, width: 1, length: 1,
    options, optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 })),
});

// =====================================================================================================
// 1. TABLE SHAPE
// =====================================================================================================
describe('the table is well-formed and self-consistent', () => {
    test('QUESTS is keyed uniquely and the maps agree with it', () => {
        expect(QUESTS.length).toBe(QUEST_TABLE_STATS.quests);
        expect(new Set(QUESTS.map(q => q.key)).size).toBe(QUESTS.length);
        expect(new Set(QUESTS.map(q => q.component)).size).toBe(QUESTS.length);
        expect(QUEST_BY_KEY.size).toBe(QUESTS.length);
        expect(QUEST_BY_COMPONENT.size).toBe(QUESTS.length);
        // display names are unique too — they come from questlist.if `text=`, one row per quest
        expect(new Set(QUESTS.map(q => q.name)).size).toBe(QUESTS.length);
    });

    test('QUEST_TABLE_STATS matches what the rows actually say', () => {
        expect(QUESTS.filter(q => q.varp !== null).length).toBe(QUEST_TABLE_STATS.withProgressVarp);
        expect(QUESTS.filter(q => q.varp === null).length).toBe(QUEST_TABLE_STATS.progressComputedByProc);
        expect(QUESTS.filter(q => q.readVarpId >= 0).length).toBe(QUEST_TABLE_STATS.varpReadable);
        expect(QUESTS.filter(q => q.varp !== null && q.readVarpId < 0).length).toBe(QUEST_TABLE_STATS.varpDark);
        expect(QUESTS.filter(q => q.journalAmbiguous).length).toBe(QUEST_TABLE_STATS.journalAmbiguousQuests);
        expect(QUESTS.reduce((a, q) => a + q.questPoints, 0)).toBe(TOTAL_QUEST_POINTS);
        expect(QUEST_TABLE_STATS.varpReadable + QUEST_TABLE_STATS.varpDark).toBe(QUEST_TABLE_STATS.withProgressVarp);
    });

    test('QUEST_BY_VARP covers exactly the quests that have a progress variable', () => {
        expect(QUEST_BY_VARP.size).toBe(QUEST_TABLE_STATS.withProgressVarp);
        for (const [varp, d] of QUEST_BY_VARP) expect(d.varp).toBe(varp);
    });

    test('milestones are ascending, deduped, and include the complete threshold where content names it', () => {
        for (const q of QUESTS) {
            const values = q.milestones.map(m => m.value);
            expect(values).toEqual([...values].sort((a, b) => a - b));
            expect(new Set(q.milestones.map(m => m.name)).size).toBe(q.milestones.length);
        }
        // spot-check: a quest whose stages are fully named lists all of them and nothing else
        expect(def('prince').milestones.map(m => `${m.name}=${m.value}`)).toEqual([
            'prince_not_started=0', 'prince_started=10', 'prince_spoken_osman=20',
            'prince_prep_finished=30', 'prince_guard_drunk=40', 'prince_tied_keli=50',
            'prince_saved=100', 'prince_complete=110',
        ]);
    });

    test('every gating varp is accounted for by exactly one observability channel', () => {
        const viaVarp = GATING_VARPS.filter(v => (QUEST_BY_VARP.get(v)?.readVarpId ?? -1) >= 0);
        expect(viaVarp.length).toBe(QUEST_TABLE_STATS.gatingVarpsViaVarp);
        expect(JOURNAL_OBSERVABLE_GATING_VARPS.length).toBe(QUEST_TABLE_STATS.gatingVarpsViaJournal);
        expect(UNOBSERVABLE_GATING_VARPS.length).toBe(QUEST_TABLE_STATS.gatingVarpsUnobservable);
        expect(viaVarp.length + JOURNAL_OBSERVABLE_GATING_VARPS.length + UNOBSERVABLE_GATING_VARPS.length)
            .toBe(GATING_VARPS.length);
        // the three sets are disjoint
        const all = [...viaVarp, ...JOURNAL_OBSERVABLE_GATING_VARPS, ...UNOBSERVABLE_GATING_VARPS];
        expect(new Set(all).size).toBe(all.length);
    });
});

// =====================================================================================================
// 2. THE REFUSAL — a non-transmitted varp's id is not in this file, and cannot be made to lie
// =====================================================================================================
describe('the generator refuses to publish a varp the server never sends', () => {
    test('readVarpId is -1 for every quest whose variable does not transmit', () => {
        for (const q of QUESTS) {
            if (q.transmitted) expect(q.readVarpId).toBeGreaterThanOrEqual(0);
            else expect(q.readVarpId).toBe(-1);
        }
    });

    test('the emitted FILE contains no id for a dark quest — not even commented out', () => {
        const src = readFileSync(join(import.meta.dir, '..', 'quest-state.ts'), 'utf8');
        // Every row literal must carry readVarpId: -1 unless transmitted: true precedes it on the line.
        // (Matched on the row shape, so the interface declaration and the doc comments are excluded.)
        const rowLines = src.split('\n').filter(l => /^\s+varp: .*readVarpId: /.test(l));
        expect(rowLines.length).toBe(QUESTS.length);
        for (const line of rowLines) {
            const transmitted = /transmitted: true/.test(line);
            const id = /readVarpId: (-?\d+)/.exec(line)![1]!;
            if (!transmitted) expect(id).toBe('-1');
        }
    });

    test('⛔ TEETH — a varp source that screams "complete" at every id changes nothing for a dark quest', () => {
        // Prince Ali Rescue is the case that matters: its gate waives the Al Kharid toll.
        expect(questState(ALL_COMPLETE, 'prince').status).toBe('NOT_OBSERVABLE');
        expect(isComplete(ALL_COMPLETE, 'prince')).toBeUndefined();

        // ...and it is not just prince. Every quest without a transmitted variable stays unobservable.
        const states = allQuestStates(ALL_COMPLETE);
        const observable = states.filter(s => s.status !== 'NOT_OBSERVABLE');
        expect(observable.map(s => s.quest).sort())
            .toEqual(QUESTS.filter(q => q.readVarpId >= 0).map(q => q.key).sort());
        expect(observable.length).toBe(QUEST_TABLE_STATS.varpReadable);
    });

    test('⛔ NOT_OBSERVABLE is never NOT_STARTED — the zero source produces no NOT_STARTED either', () => {
        for (const s of allQuestStates(ZERO)) {
            if (QUEST_BY_KEY.get(s.quest)!.readVarpId < 0) {
                expect(s.status).toBe('NOT_OBSERVABLE');
                expect(s.value).toBeNull();
                expect(s.source).toBe('none');
            }
        }
        // The one quest that DOES transmit reads a real zero and says so.
        expect(questState(ZERO, 'tbwt').status).toBe('NOT_STARTED');
        expect(questState(ZERO, 'tbwt').value).toBe(0);
        expect(questState(ZERO, 'tbwt').source).toBe('varp');
    });

    test('isComplete returns undefined, not false, when it cannot see — the `if (!isComplete)` trap', () => {
        const r = isComplete(ZERO, 'dragon');
        expect(r).toBeUndefined();
        expect(r === false).toBe(false);        // a caller writing `=== false` is safe
        expect(!r).toBe(true);                  // ...a caller writing `!r` is NOT, which is why it is documented
    });

    test('an unknown quest name THROWS rather than degrading to NOT_OBSERVABLE', () => {
        expect(() => questState(ZERO, 'prinec')).toThrow(/unknown quest/);
        expect(() => questStateFromColour('not_a_quest', JOURNAL_COLOUR.COMPLETE)).toThrow(/unknown quest/);
    });
});

// =====================================================================================================
// 3. THE VARP CHANNEL — the one quest that really is readable
// =====================================================================================================
describe('Tai Bwo Wannai Trio is the single varp-readable quest', () => {
    const tbwt = def('tbwt');

    test('it is varp 320 and completes at 6', () => {
        expect(tbwt.varp).toBe('tbwt_main');
        expect(tbwt.transmitted).toBe(true);
        expect(tbwt.readVarpId).toBe(320);
        expect(tbwt.complete).toBe(6);
        expect(tbwt.kind).toBe('varp');
        expect(tbwt.bitMask).toBe(-1);          // whole varp, no bit extraction
    });

    test('the three states come straight off a synthetic varp', () => {
        const at = (v: number) => questState(id => (id === tbwt.readVarpId ? v : 0), 'tbwt');
        expect(at(0).status).toBe('NOT_STARTED');
        expect(at(3).status).toBe('IN_PROGRESS');
        expect(at(5).status).toBe('IN_PROGRESS');
        expect(at(6).status).toBe('COMPLETE');
        expect(at(99).status).toBe('COMPLETE');  // past-complete is still complete
        // an exact read pins the interval to a point
        expect(at(3).atLeast).toBe(3);
        expect(at(3).atMost).toBe(3);
        expect(at(3).value).toBe(3);
    });

    test('the tbwt gate in obstacles.json is answerable from the varp alone', () => {
        expect(GATING_VARPS).toContain('tbwt_main');
        const done = questState(id => (id === tbwt.readVarpId ? 6 : 0), 'tbwt');
        expect(questGateSatisfied(done, '>=', 3)).toBe(true);
        expect(questGateSatisfied(done, '<', 3)).toBe(false);
    });
});

// =====================================================================================================
// 4. THE JOURNAL COLOUR CHANNEL
// =====================================================================================================
describe('the questlist colour is a real, transmitted, login-time tri-state', () => {
    test('the three wire colours are distinct and are the rgb24to15 of red/yellow/green', () => {
        expect(JOURNAL_COLOUR.NOT_STARTED).toBe(31744);      // 0xFF0000 -> (31<<10)
        expect(JOURNAL_COLOUR.IN_PROGRESS).toBe(32736);      // 0xFFFF00 -> (31<<10)+(31<<5)
        expect(JOURNAL_COLOUR.COMPLETE).toBe(992);           // 0x00FF00 -> (31<<5)
        expect(new Set(Object.values(JOURNAL_COLOUR)).size).toBe(3);
        expect(IF_SETCOLOUR_PROT).toEqual({ id: 160, size: 4 });
    });

    test('red pins the stage EXACTLY at 0; green and yellow only bound it', () => {
        const red = questStateFromColour('prince', JOURNAL_COLOUR.NOT_STARTED);
        expect(red.status).toBe('NOT_STARTED');
        expect(red.value).toBe(0);
        expect(red.atLeast).toBe(0);
        expect(red.atMost).toBe(0);

        const green = questStateFromColour('prince', JOURNAL_COLOUR.COMPLETE);
        expect(green.status).toBe('COMPLETE');
        expect(green.value).toBeNull();                       // NOT pinned — could be anything >= 110
        expect(green.atLeast).toBe(def('prince').complete);
        expect(green.atMost).toBeNull();

        const yellow = questStateFromColour('prince', JOURNAL_COLOUR.IN_PROGRESS);
        expect(yellow.status).toBe('IN_PROGRESS');
        expect(yellow.value).toBeNull();
        expect(yellow.atLeast).toBe(1);
        expect(yellow.atMost).toBe(def('prince').complete - 1);
    });

    test('a colour that is none of the three is NOT_OBSERVABLE, not a guess', () => {
        expect(questStateFromColour('prince', 0).status).toBe('NOT_OBSERVABLE');
        expect(questStateFromColour('prince', 12345).status).toBe('NOT_OBSERVABLE');
    });

    test('questState prefers the varp and falls back to the colour', () => {
        const journal = journalAll(JOURNAL_COLOUR.COMPLETE);
        // tbwt has a varp: the varp wins even though the journal says complete
        expect(questState(ZERO, 'tbwt', journal).source).toBe('varp');
        expect(questState(ZERO, 'tbwt', journal).status).toBe('NOT_STARTED');
        // prince has none: the colour answers
        expect(questState(ZERO, 'prince', journal).source).toBe('journal');
        expect(questState(ZERO, 'prince', journal).status).toBe('COMPLETE');
    });

    test('journalFromEvents builds the map the decoder would produce, last event winning', () => {
        const j = journalFromEvents([
            { component: def('prince').component, colour: JOURNAL_COLOUR.NOT_STARTED },
            { component: def('prince').component, colour: JOURNAL_COLOUR.COMPLETE },
        ]);
        expect(questState(ZERO, 'prince', j).status).toBe('COMPLETE');
    });

    test('a full red login burst makes every unambiguous quest observably NOT_STARTED', () => {
        const states = observableQuestStates(ZERO, journalAll(JOURNAL_COLOUR.NOT_STARTED));
        // every quest except the ambiguous ones (whose colour is refused)
        expect(states.length).toBe(QUESTS.length - QUEST_TABLE_STATS.journalAmbiguousQuests);
        expect(states.every(s => s.status === 'NOT_STARTED')).toBe(true);
        expect(states.every(s => s.value === 0)).toBe(true);
    });

    test('⛔ a CONDITIONAL journal row is refused outright — its colour describes another variable', () => {
        // Shield of Arrav colours its row from %phoenixgang on one branch and %blackarmgang on the
        // other; Underground Pass colours it from a literal when a start BIT is set. A green Shield of
        // Arrav can coexist with %blackarmgang = 0.
        const ambiguous = QUESTS.filter(q => q.journalAmbiguous).map(q => q.key);
        expect(ambiguous.sort()).toEqual(['blackarmgang', 'upass']);
        for (const key of ambiguous) {
            for (const colour of Object.values(JOURNAL_COLOUR)) {
                expect(questStateFromColour(key, colour).status).toBe('NOT_OBSERVABLE');
            }
            expect(questState(ZERO, key, journalAll(JOURNAL_COLOUR.COMPLETE)).status).toBe('NOT_OBSERVABLE');
        }
        // ...and both of their varps are in the unobservable-gate list for exactly that reason
        expect(UNOBSERVABLE_GATING_VARPS).toContain('blackarmgang');
        expect(UNOBSERVABLE_GATING_VARPS).toContain('upass');
    });
});

// =====================================================================================================
// 5. THE INTERVAL — questGateSatisfied never guesses
// =====================================================================================================
describe('questGateSatisfied is interval-exact', () => {
    const obs = (atLeast: number, atMost: number | null, status: QuestObservation['status'] = 'IN_PROGRESS'): QuestObservation =>
        ({ quest: 'x', name: 'X', varp: 'x', status, value: atMost !== null && atMost === atLeast ? atLeast : null, atLeast, atMost, source: 'journal' });

    test('an EXACT interval decides every operator', () => {
        const at100 = obs(100, 100);
        expect(questGateSatisfied(at100, '>=', 100)).toBe(true);
        expect(questGateSatisfied(at100, '>', 100)).toBe(false);
        expect(questGateSatisfied(at100, '<=', 100)).toBe(true);
        expect(questGateSatisfied(at100, '<', 100)).toBe(false);
        expect(questGateSatisfied(at100, '=', 100)).toBe(true);
        expect(questGateSatisfied(at100, '!', 100)).toBe(false);
        expect(questGateSatisfied(at100, '=', 50)).toBe(false);
        expect(questGateSatisfied(at100, '!', 50)).toBe(true);
    });

    test('a LOWER bound (green) answers >= and > but refuses = and <', () => {
        const green = obs(110, null, 'COMPLETE');
        expect(questGateSatisfied(green, '>=', 100)).toBe(true);
        expect(questGateSatisfied(green, '>=', 110)).toBe(true);
        expect(questGateSatisfied(green, '>', 100)).toBe(true);
        expect(questGateSatisfied(green, '<', 100)).toBe(false);
        expect(questGateSatisfied(green, '<=', 100)).toBe(false);
        expect(questGateSatisfied(green, '=', 110)).toBeUndefined();   // could be 110, could be 999
        expect(questGateSatisfied(green, '=', 100)).toBe(false);       // 100 is below the bound
        expect(questGateSatisfied(green, '!', 100)).toBe(true);
        expect(questGateSatisfied(green, '!', 110)).toBeUndefined();
    });

    test('⛔ THE CASE THAT MOTIVATES THE DESIGN — a yellow Prince Ali cannot decide the toll', () => {
        // ^prince_saved = 100 is a real reachable stage strictly BELOW ^prince_complete = 110, so
        // "in progress" spans both sides of the toll threshold.
        const prince = def('prince');
        expect(prince.milestones.find(m => m.name === 'prince_saved')!.value).toBe(100);
        expect(prince.complete).toBe(110);
        const yellow = questStateFromColour('prince', JOURNAL_COLOUR.IN_PROGRESS);
        expect(yellow.atLeast).toBe(1);
        expect(yellow.atMost).toBe(109);
        expect(questGateSatisfied(yellow, '>=', 100)).toBeUndefined();   // straddles: 1..109 vs 100
        // a threshold entirely outside the interval IS decidable
        expect(questGateSatisfied(yellow, '>=', 200)).toBe(false);
        expect(questGateSatisfied(yellow, '>=', 1)).toBe(true);
    });

    test('NOT_OBSERVABLE and an unrecognised operator both return undefined', () => {
        const none: QuestObservation = { quest: 'x', name: 'X', varp: 'x', status: 'NOT_OBSERVABLE', value: null, atLeast: 0, atMost: null, source: 'none' };
        expect(questGateSatisfied(none, '>=', 1)).toBeUndefined();
        expect(questGateSatisfied(obs(5, 5), 'switch', 1)).toBeUndefined();
        expect(questGateSatisfied(obs(5, 5), '~=', 1)).toBeUndefined();
    });

    test('the gate-operator histogram is why a lower bound is not the default', () => {
        const total = Object.values(QUEST_GATE_OPS).reduce((a, b) => a + b, 0);
        const safe = (QUEST_GATE_OPS['>='] ?? 0) + (QUEST_GATE_OPS['>'] ?? 0) + (QUEST_GATE_OPS['waive:>='] ?? 0);
        expect(total).toBe(QUEST_TABLE_STATS.gateTests);
        // a clear majority of real gate tests are NOT answerable from a lower bound
        expect(total - safe).toBeGreaterThan(safe / 2);
        expect(QUEST_GATE_OPS['=']).toBeGreaterThan(0);
        expect(QUEST_GATE_OPS['<']).toBeGreaterThan(0);
    });
});

// =====================================================================================================
// 6. THE AL KHARID PRINCE CASE, END TO END
// =====================================================================================================
describe('Al Kharid toll gate — obstacles.json -> reader -> route-feasibility', () => {
    const rule = obstacleRule(TOLL_GATE_LOC)!;
    const op1 = rule.ops.find(o => o.op === 1)!;
    const payReq = op1.reqs.find(r => r.kind === 'payment')!;
    /**
     * ⛔ THE PRINCE TEST IS ON THE **PAYMENT** ROW, NOT A QUEST ROW OF ITS OWN.
     *
     * border_gate.rs2:28 lets a friend of Al-Kharid through free and everyone else through for 10 gp —
     * BOTH branches pass, so the control-flow polarity pass in extract-obstacles.mjs calls the quest test
     * `inert` and does not emit it as a requirement. That is the correct reading: nothing about this gate
     * requires the quest, it only makes it cheaper. What survives is `payment.waivedBy`, which is exactly
     * what the fee-waiver logic consumes. A quest row here would mean the oracle had gone back to
     * reporting NEEDS_QUEST (rank 5, "never crossable") for a gate that wants 10 gp.
     */
    const waiver = payReq.waivedBy!;

    test('the gate really is the prince-quest waiver, and the tables agree on the threshold', () => {
        expect(rule.internal).toBe('border_gate_toll_left');
        expect(op1.reqs.some(r => r.kind === 'quest')).toBe(false);
        expect(waiver.varp).toBe('princequest');
        expect(waiver.op).toBe('>=');
        expect(waiver.stage).toBe('prince_saved');
        expect(waiver.stageValue).toBe(100);

        // ...and this module resolves the SAME stage name to the SAME value, independently.
        const prince = QUEST_BY_VARP.get('princequest')!;
        expect(prince.key).toBe('prince');
        expect(prince.name).toBe('Prince Ali Rescue');
        expect(prince.milestones.find(m => m.name === waiver.stage)!.value).toBe(waiver.stageValue as number);
    });

    test('⛔ the varp id is ABSENT, and that is the honest answer for todays client', () => {
        const prince = QUEST_BY_VARP.get('princequest')!;
        expect(prince.transmitted).toBe(false);
        expect(prince.readVarpId).toBe(-1);
        // Unreadable quest state + unreadable coins = UNKNOWN. Never "not started", never "passable".
        expect(classifyLoc(sceneLoc(TOLL_GATE_LOC, ['Open']), {}).cls).toBe('UNKNOWN');
    });

    test('a synthetic EXACT stage of 100 makes the reader say COMPLETE and satisfies the gate', () => {
        // 100 is ^prince_saved: the toll threshold. It is BELOW ^prince_complete (110), so the journal
        // would call this quest "in progress" — the exact value decides what the colour cannot.
        const at100 = questStateFromStage('prince', 100);
        expect(at100.value).toBe(100);
        expect(at100.source).toBe('exact');
        expect(questGateSatisfied(at100, waiver.op, waiver.stageValue!)).toBe(true);

        // ...and 110 (^prince_complete) is COMPLETE outright.
        const at110 = questStateFromStage('prince', 110);
        expect(at110.status).toBe('COMPLETE');
        expect(questGateSatisfied(at110, waiver.op, waiver.stageValue!)).toBe(true);

        // ...while 50 (^prince_tied_keli) is not enough.
        const at50 = questStateFromStage('prince', 50);
        expect(at50.status).toBe('IN_PROGRESS');
        expect(questGateSatisfied(at50, waiver.op, waiver.stageValue!)).toBe(false);
    });

    test('the profile it builds waives the fee inside route-feasibility, with ZERO coins', () => {
        const q = questProfile(ZERO, { requiredVarps: ['princequest'], knownStages: { princequest: 110 } });
        expect(q.unresolved).toEqual([]);
        expect(q.profile.quests).toEqual({ princequest: 110 });

        const profile: BotProfile = { coins: 0, inventory: [], worn: [], members: true, ...q.profile };
        const verdict = classifyLoc(sceneLoc(TOLL_GATE_LOC, ['Open']), profile);
        expect(verdict.cls).toBe('PASSABLE');
        expect(verdict.waived).toContain('prince');
    });

    test('...and a bot that has NOT done it must pay, however much it is carrying', () => {
        const q = questProfile(ZERO, { requiredVarps: ['princequest'], knownStages: { princequest: 0 } });
        expect(q.profile.quests).toEqual({});           // 0 is the default; the map is present and empty
        const broke: BotProfile = { coins: 0, inventory: [], worn: [], members: true, ...q.profile };
        const brokeV = classifyLoc(sceneLoc(TOLL_GATE_LOC, ['Open']), broke);
        expect(brokeV.cls).toBe('NEEDS_PAYMENT');
        expect(brokeV.waived).toBeUndefined();
        expect(brokeV.needs).toContainEqual({ kind: 'coins', amount: 10 });
        // With coins it is still NEEDS_PAYMENT — the gate wants the fare, it is just affordable now.
        // That difference (affordable vs not) is exactly what the five-day outage could not see.
        const funded: BotProfile = { coins: 920, inventory: [995], worn: [], members: true, ...q.profile };
        const fundedV = classifyLoc(sceneLoc(TOLL_GATE_LOC, ['Open']), funded);
        expect(fundedV.cls).toBe('NEEDS_PAYMENT');
        expect(fundedV.reason).toContain('affordable');
    });

    test('a GREEN journal row alone waives it too — the colour channel is enough for a `>=` gate', () => {
        const green = questStateFromColour('prince', JOURNAL_COLOUR.COMPLETE);
        expect(questGateSatisfied(green, waiver.op, waiver.stageValue!)).toBe(true);
        const q = questProfile(ZERO, {
            requiredVarps: ['princequest'],
            journal: new Map([[def('prince').component, JOURNAL_COLOUR.COMPLETE]]),
            allowCompleteLowerBound: true,
        });
        expect(q.profile.quests).toEqual({ princequest: 110 });
        const profile: BotProfile = { coins: 0, inventory: [], worn: [], members: true, ...q.profile };
        expect(classifyLoc(sceneLoc(TOLL_GATE_LOC, ['Open']), profile).cls).toBe('PASSABLE');
    });

    test('a PURE quest gate (no fee to fall back on) is the sharpest case of all three answers', () => {
        // Priest in Peril mausoleum door: `%priestperil >= ^priestperil_find_drezel_key` and nothing else.
        const pure = obstacleRule(PURE_QUEST_LOC)!;
        expect(pure.internal).toBe('pip_underground_door1');
        const req = pure.ops.find(o => o.op === 1)!.reqs.find(r => r.kind === 'quest')!;
        expect(req.varp).toBe('priestperil');
        expect(req.stageValue).toBe(5);
        const door = sceneLoc(PURE_QUEST_LOC, ['Open']);

        // (a) nothing known -> UNKNOWN, the "do not depart" answer
        const blind = questProfile(ZERO, { requiredVarps: ['priestperil'] });
        expect(blind.profile.quests).toBeUndefined();
        expect(classifyLoc(door, { ...blind.profile }).cls).toBe('UNKNOWN');

        // (b) journal RED -> definitely not started -> NEEDS_QUEST, a real re-target
        const red = questProfile(ZERO, {
            journal: new Map([[def('priestperil').component, JOURNAL_COLOUR.NOT_STARTED]]),
            requiredVarps: ['priestperil'],
        });
        expect(red.profile.quests).toEqual({});
        expect(classifyLoc(door, { ...red.profile }).cls).toBe('NEEDS_QUEST');

        // (c) an exact stage past the threshold -> PASSABLE
        const done = questProfile(ZERO, { requiredVarps: ['priestperil'], knownStages: { priestperil: 5 } });
        expect(classifyLoc(door, { ...done.profile }).cls).toBe('PASSABLE');
    });
});

// =====================================================================================================
// 7. THE PROFILE BUILDER — all-or-nothing, because the map is authoritative
// =====================================================================================================
describe('questProfile composes with route-feasibility without ever guessing', () => {
    test('with nothing observable it omits the whole field — which is what produces UNKNOWN', () => {
        const q = questProfile(ZERO);
        expect(q.profile.quests).toBeUndefined();
        expect('quests' in q.profile).toBe(false);
        expect(q.unresolved.length).toBeGreaterThan(0);
        expect(q.unresolved).toContain('princequest');
        // spreading it into a profile leaves `quests` absent, so a pure quest gate answers UNKNOWN
        // even for a bot whose coins, items and levels are all fully known.
        const p: BotProfile = { coins: 5000, inventory: [995], worn: [], skills: { agility: 99 }, members: true, ...q.profile };
        expect(classifyLoc(sceneLoc(PURE_QUEST_LOC, ['Open']), p).cls).toBe('UNKNOWN');
    });

    test('a partial answer is never emitted — one unresolved varp drops the whole map', () => {
        const journal = journalAll(JOURNAL_COLOUR.NOT_STARTED);
        const q = questProfile(ZERO, { journal, requiredVarps: ['princequest', 'dragon_oracle'] });
        expect(q.unresolved).toEqual(['dragon_oracle']);       // sub-state: no channel reaches it
        expect(q.profile.quests).toBeUndefined();              // ...so princequest is withheld too
    });

    test('a full red login burst over the JOURNAL-OBSERVABLE gates yields an all-zero map', () => {
        const q = questProfile(ZERO, {
            journal: journalAll(JOURNAL_COLOUR.NOT_STARTED),
            requiredVarps: JOURNAL_OBSERVABLE_GATING_VARPS,
        });
        expect(q.unresolved).toEqual([]);
        // PRESENT but empty: "every one of these quests is at 0", which is a real claim, not a shrug
        expect(q.profile.quests).toEqual({});
        expect('quests' in q.profile).toBe(true);
    });

    test('a yellow row is NOT written into the map — the value is not pinned', () => {
        const q = questProfile(ZERO, {
            journal: journalAll(JOURNAL_COLOUR.IN_PROGRESS),
            requiredVarps: ['princequest'],
        });
        expect(q.unresolved).toEqual(['princequest']);
        expect(q.profile.quests).toBeUndefined();
    });

    test('allowCompleteLowerBound is OPT-IN and only affects green rows', () => {
        const journal = journalAll(JOURNAL_COLOUR.COMPLETE);
        const off = questProfile(ZERO, { journal, requiredVarps: ['princequest'] });
        expect(off.profile.quests).toBeUndefined();
        expect(off.unresolved).toEqual(['princequest']);

        const on = questProfile(ZERO, { journal, requiredVarps: ['princequest'], allowCompleteLowerBound: true });
        expect(on.profile.quests).toEqual({ princequest: 110 });
    });

    test('knownStages wins over both channels and is reported as source `exact`', () => {
        const journal = journalAll(JOURNAL_COLOUR.NOT_STARTED);
        const s = questState(ZERO, 'prince', journal, { princequest: 100 });
        expect(s.source).toBe('exact');
        expect(s.value).toBe(100);
        expect(s.status).toBe('IN_PROGRESS');   // 100 < complete 110, but past the toll threshold
    });

    test('the default requiredVarps is every gating varp, so the default answer today is "no map"', () => {
        const q = questProfile(ZERO, { journal: journalAll(JOURNAL_COLOUR.NOT_STARTED) });
        expect(q.profile.quests).toBeUndefined();
        expect([...q.unresolved].sort()).toEqual([...UNOBSERVABLE_GATING_VARPS].sort());
    });
});

// =====================================================================================================
// 8. PINNED SURPRISES — things that look wrong and are not
// =====================================================================================================
describe('pinned surprises', () => {
    test('Horror from the Deep stores progress in a VARBIT, not a varp', () => {
        const h = def('horror');
        expect(h.varp).toBe('horrorquest');
        expect(h.kind).toBe('varbit');
        expect(h.bitShift).toBe(0);
        expect(h.bitMask).toBe(2047);                    // bits 0..10 of `deephorror`
        expect(h.note).toContain('VARBIT');
        expect(h.note).toContain('deephorror');
        // and it rides a varp that does not transmit, so it is dark like the rest
        expect(h.transmitted).toBe(false);
        expect(h.readVarpId).toBe(-1);
    });

    test('two quests compute progress in a proc and have no variable at all', () => {
        const procs = QUESTS.filter(q => q.varp === null);
        expect(procs.map(q => q.key).sort()).toEqual(['cog', 'itexam']);
        for (const q of procs) {
            expect(q.readVarpId).toBe(-1);
            expect(q.note).toContain('computed by ~');
            // their journal colour is still sound — the proc IS compared against the same threshold
            expect(questStateFromColour(q.key, JOURNAL_COLOUR.COMPLETE).status).toBe('COMPLETE');
        }
    });

    test('a switch_int(%V) contributes only ITS OWN cases — Underground Pass has no Regicide stages', () => {
        // quest_upass switches on %upass and on %regicide_quest inside the same script block. A
        // block-wide `case ^x` sweep gave Underground Pass `regicide_killed_tyras` at 12 — a milestone
        // ABOVE its own complete of 10, for a different quest entirely.
        const u = def('upass');
        expect(u.milestones.length).toBeGreaterThan(5);
        expect(u.milestones.every(m => m.name.startsWith('upass_'))).toBe(true);
        expect(u.milestones.every(m => m.value <= u.complete)).toBe(true);
    });

    test('a quest can be journal-COMPLETE at a value ABOVE its last named milestone', () => {
        // ^tbwt_received_gold_reward = 5 is the last named stage, but ^tbwt_complete = 6.
        const t = def('tbwt');
        const named = Math.max(...t.milestones.filter(m => m.name !== t.completeName).map(m => m.value));
        expect(named).toBeLessThan(t.complete);
    });

    test('quest points transmit but are mostly EQUALITY-gated, so qp=0 does not mean "nothing started"', () => {
        expect(QUEST_POINTS_VARP).toBe(101);
        // one award per quest, and the totals reconcile with the raw ^*_questpoints constants
        expect(QUEST_POINTS_AWARDS).toBe(QUESTS.length);
        expect(TOTAL_QUEST_POINTS).toBe(145);   // rev 289 added 5 quests (274: 135)
        expect(QUESTS.every(q => q.questPoints > 0)).toBe(true);
        // a clear majority fire on `=`, not `>=` — that is what makes qp non-monotone in progress
        expect(QUEST_POINTS_EQUALITY_AWARDS).toBeGreaterThan(QUEST_POINTS_AWARDS / 2);
        // the concrete counterexample: prince pays out at 110, but the toll waives at 100
        const prince = def('prince');
        expect(prince.questPoints).toBeGreaterThan(0);
        expect(prince.milestones.find(m => m.name === 'prince_saved')!.value).toBeLessThan(prince.complete);
    });

    test('the residue is named, counted and non-empty — no channel reaches these', () => {
        expect(UNOBSERVABLE_GATING_VARPS.length).toBeGreaterThan(0);
        expect(QUEST_TABLE_STATS.gateTestsUnobservable).toBeGreaterThan(0);
        expect(QUEST_TABLE_STATS.gateTestsUnobservable).toBeLessThan(QUEST_TABLE_STATS.gateTests);
        for (const v of UNOBSERVABLE_GATING_VARPS) {
            const d = QUEST_BY_VARP.get(v);
            // either it belongs to no journal row at all, or its row is ambiguous
            if (d) expect(d.journalAmbiguous).toBe(true);
        }
    });
});

// =====================================================================================================
// 9. REPRODUCIBILITY
// =====================================================================================================
describe('the generator is byte-for-byte reproducible', () => {
    test('re-running the extractor reproduces the checked-in quest-state.ts exactly', () => {
        const generator = join(import.meta.dir, '..', 'data', 'extract-quests.mjs');
        const checkedIn = readFileSync(join(import.meta.dir, '..', 'quest-state.ts'), 'utf8');
        // --stdout prints the same bytes it would have written, so this never clobbers the real file.
        const proc = Bun.spawnSync({ cmd: ['bun', generator, '--stdout'], stdout: 'pipe', stderr: 'pipe' });
        const stderr = new TextDecoder().decode(proc.stderr);
        expect(stderr).toBe('');
        expect(proc.exitCode).toBe(0);
        const regenerated = new TextDecoder().decode(proc.stdout);
        if (regenerated !== checkedIn) {
            const a = regenerated.split('\n'), b = checkedIn.split('\n');
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            throw new Error(
                `quest-state.ts is stale or the generator is non-deterministic.\n` +
                `First divergence at line ${i + 1}:\n  generated: ${a[i] ?? '<eof>'}\n  on disk:   ${b[i] ?? '<eof>'}\n` +
                `Regenerate with: bun server/webclient/headless/data/extract-quests.mjs`
            );
        }
        expect(regenerated.length).toBe(checkedIn.length);
    }, 60_000);
});

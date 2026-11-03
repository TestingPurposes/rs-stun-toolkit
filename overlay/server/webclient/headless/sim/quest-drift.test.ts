// QUEST DRIFT-CHECKER SUITE — proves the fixture-vs-RS2 checker (1) passes the real quest fixtures and
// (2) actually CATCHES a transcription error. Without the negative tests, "0 issues" could just mean the
// checker does nothing; these give it teeth.
import { describe, test, expect } from 'bun:test';
import { npcItemContract, checkFixture, type FixtureStep } from './quest-drift.ts';
import { QUESTS } from '../quest-runner.ts';

describe('quest fixture drift-checker (RS2 contract vs the runner fixture)', () => {
    test('the Rune Mysteries fixture matches its RS2 scripts — no drift', () => {
        const issues = checkFixture(QUESTS.rune_mysteries as unknown as FixtureStep[]);
        expect(issues).toEqual([]);
    });

    test('every quest fixture in the runner is backed by its scripts', () => {
        const contract = npcItemContract();
        const all = Object.entries(QUESTS).flatMap(([name, steps]) =>
            checkFixture(steps as unknown as FixtureStep[], contract).map(i => `${name}: ${i.detail}`));
        expect(all).toEqual([]);
    });

    test('IT HAS TEETH — a wrong expectItem is flagged (Duke does not give research_notes)', () => {
        const contract = npcItemContract();
        // Duke (741) inv_adds air_talisman (1438). Claim he hands research_notes (291) instead -> drift.
        const issues = checkFixture([{ npcType: 741, op: 'talk', expectItem: 291, label: 'Duke (wrong item)' }], contract);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.kind).toBe('missing-add');
        expect(issues[0]!.item).toBe(291);
    });

    test('IT HAS TEETH — a wrong consumeItem is flagged (Aubury does not take air_talisman)', () => {
        const contract = npcItemContract();
        // Aubury (553) inv_dels research_package (290). Claim he takes air_talisman (1438) -> drift.
        const issues = checkFixture([{ npcType: 553, op: 'use', consumeItem: 1438, label: 'Aubury (wrong item)' }], contract);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.kind).toBe('missing-del');
    });

    test('IT HAS TEETH — a nonexistent npc is flagged (no script handles it)', () => {
        const issues = checkFixture([{ npcType: 999_999, op: 'talk', label: 'ghost npc' }]);
        expect(issues.some(i => i.kind === 'no-npc-script')).toBe(true);
    });

    // ---- the LOC and KILL step kinds (added with Druidic Ritual) --------------------------------
    test('the Druidic Ritual fixture matches its RS2 scripts — no drift', () => {
        expect(checkFixture(QUESTS.druidic_ritual as unknown as FixtureStep[])).toEqual([]);
    });

    test('IT HAS TEETH — a loc that swaps a DIFFERENT item is flagged', () => {
        // The cauldron (loc 2142) inv_adds enchanted_beef 522 for raw_beef 2132. Claim it hands
        // air_talisman (1438) instead -> drift.
        const issues = checkFixture([{
            op: 'useloc', loc: { x: 2893, z: 9831, id: 2142 }, useItem: 2132, expectItem: 1438, label: 'cauldron (wrong item)',
        }]);
        expect(issues.some(i => i.kind === 'missing-add' && i.item === 1438)).toBe(true);
    });

    test('IT HAS TEETH — a loc with no script at all is flagged', () => {
        const issues = checkFixture([{ op: 'oploc', loc: { x: 0, z: 0, id: 999_999 }, label: 'ghost loc' }]);
        expect(issues.some(i => i.kind === 'no-loc-script')).toBe(true);
    });

    test('IT HAS TEETH — a kill step whose drop table does NOT carry the item is flagged', () => {
        // cow (81) drops raw_beef 2132, never raw_bear_meat 2136.
        const issues = checkFixture([{ op: 'kill', npcTypes: [81], expectItem: 2136, label: 'cow (wrong meat)' }]);
        expect(issues.some(i => i.kind === 'missing-drop' && i.npc === 81)).toBe(true);
    });

    test('IT HAS TEETH — a kill step on an npc with no drop table is flagged', () => {
        const issues = checkFixture([{ op: 'kill', npcTypes: [455], expectItem: 2132, label: 'kill Kaqemeex?' }]);
        expect(issues.some(i => i.kind === 'no-drop-table')).toBe(true);
    });
});

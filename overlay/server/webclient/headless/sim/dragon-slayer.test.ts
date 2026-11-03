// DRAGON SLAYER — item-contract drift test (against the REAL RS2 scripts the local server runs).
//
// DS is the high-value quest (unlocks rune platebody + the anti-dragon shield + the 4.8x dragon-bones
// prayer lane) but it is NOT a dialog quest, so it CANNOT be sim-completed or one-shot live-completed:
//   - a 32 quest-point gate just to ENTER the Champions' Guild (to start it),
//   - Melzar's maze (keys + combat), Wormbrain (a caged goblin), a 2000gp ship + repair,
//   - and the Elvarg BOSS fight.
// The sim proves the DIALOG SPINE separately (quest.test.ts, combat/maze/boat STUBBED). This file proves
// the drift-checkable ITEM contract against the shipped scripts — and it caught a real transcription
// subtlety: the DS reward is NOT a handed-over platebody, it is Oziach OPENING HIS SHOP
// (`~openshop_activenpc`) so you can BUY one. A fixture that expects a rune_platebody item from Oziach
// would make a runner wait forever for an item that never arrives.
import { describe, test, expect } from 'bun:test';
import { npcItemContract, checkFixture, type FixtureStep } from './quest-drift.ts';

const GUILDMASTER = 198, KLARENSE = 744, OZIACH = 747, NED = 918;
const COINS = 995, DRAGONMAP = 1538, RUNE_PLATEBODY = 1127;

describe('Dragon Slayer — item contract vs the real DS scripts', () => {
    const contract = npcItemContract();

    test('the drift-checkable dialog steps are backed by the scripts', () => {
        // Klarense sells the ship (`inv_del(inv, coins, 2000)` in klarense.rs2); Ned takes the ASSEMBLED
        // Crandor map to sail (`inv_del(inv, dragonmap, ...)` in ned.rs2). These are the only clean
        // npc→item ops in DS — everything else (map parts, keys, the platebody) is combat/maze/shop.
        const steps: FixtureStep[] = [
            { npcType: KLARENSE, op: 'use', consumeItem: COINS, label: 'Klarense: buy the ship (2000gp)' },
            { npcType: NED, op: 'use', consumeItem: DRAGONMAP, label: 'Ned: give the assembled map to sail' },
        ];
        expect(checkFixture(steps, contract)).toEqual([]);
    });

    test('CAUGHT A REAL SUBTLETY — the reward is a SHOP unlock, not a given platebody', () => {
        // No DS script inv_adds rune_platebody (1127). Oziach runs `~openshop_activenpc` on completion —
        // you BUY the platebody. So a fixture claiming Oziach HANDS one is drift; the checker flags it.
        const wrong: FixtureStep[] = [{ npcType: OZIACH, op: 'talk', expectItem: RUNE_PLATEBODY, label: 'Oziach reward (WRONG: buyable, not given)' }];
        const issues = checkFixture(wrong, contract);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.kind).toBe('missing-add');
        // and prove the premise: nothing anywhere hands out a rune platebody.
        expect([...contract.values()].some(c => c.adds.has(RUNE_PLATEBODY))).toBe(false);
    });

    test('every DS quest-chain NPC has a real script (no ghost npc in the chain)', () => {
        for (const id of [GUILDMASTER, KLARENSE, OZIACH, NED]) expect(contract.has(id)).toBe(true);
    });
});

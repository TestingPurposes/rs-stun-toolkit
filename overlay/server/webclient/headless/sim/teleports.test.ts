// TELEPORT EDGES — requirement predicates (pure) + the planner's choice (REAL rsmod collision, ~20s boot
// like levels.test.ts). Content refs for every number are in sdk/navgrid/teleports.ts.
import { describe, test, expect } from 'bun:test';
import {
    TELEPORTS, teleportUsable, usableTeleports, wildernessLevel, freeRunes, setTeleportsEnabled, teleportById, RUNE,
    type TeleportCaps,
} from '../../../../sdk/navgrid/teleports.ts';
import { planMultiLevel, planCost, describePlan } from '../../../../sdk/navgrid/levels.ts';

const T = (id: string) => teleportById(id)!;
const RICH: TeleportCaps = { magicLevel: 99, inv: { [RUNE.air]: 1000, [RUNE.law]: 100, [RUNE.fire]: 100, [RUNE.water]: 100, [RUNE.earth]: 100 } };
const LUMBRIDGE = { level: 0, x: 3222, z: 3218 };

describe('teleport table (content-derived)', () => {
    test('7 standard-spellbook teleports + glory x4 + dueling x2 + games necklace + enchanted lyre; no lunar/ancient/house', () => {
        expect(TELEPORTS.filter(t => t.kind === 'spell').map(t => t.id)).toEqual(['varrock', 'lumbridge', 'falador', 'camelot', 'ardougne', 'watchtower', 'trollheim']);
        expect(TELEPORTS.filter(t => t.kind === 'item')).toHaveLength(8);   // TRAVEL NETWORK + dueling-castlewars, lyre-rellekka
    });
    test('landings decode the dbrow coords (x = mx*64+lx, z = mz*64+lz)', () => {
        expect(T('varrock').landing).toEqual({ level: 0, x: 3213, z: 3424 });     // 0_50_53_13_32
        expect(T('camelot').landing).toEqual({ level: 0, x: 2757, z: 3478 });     // 0_43_54_5_22
        expect(T('watchtower').landing).toEqual({ level: 2, x: 2933, z: 4713 });  // 2_45_73_53_41
        expect(T('glory-edgeville').landing).toEqual({ level: 0, x: 3087, z: 3496 });
        expect(T('glory-edgeville').scatter).toBe(0);                             // glory uses exact coords
        expect(T('varrock').scatter).toBe(2);                                     // map_findsquare radius 2
    });
});

describe('requirement predicates', () => {
    test('magic level gate', () => {
        expect(teleportUsable(T('varrock'), { ...RICH, magicLevel: 24 }).ok).toBe(false);
        expect(teleportUsable(T('varrock'), { ...RICH, magicLevel: 25 }).ok).toBe(true);
        expect(teleportUsable(T('trollheim'), { ...RICH, magicLevel: 61, quests: { eadgars_ruse: true } }).ok).toBe(true);
    });
    test('rune gate: every rune at its count', () => {
        const inv = { [RUNE.air]: 3, [RUNE.fire]: 1, [RUNE.law]: 1 };
        expect(teleportUsable(T('varrock'), { magicLevel: 99, inv }).ok).toBe(true);
        expect(teleportUsable(T('varrock'), { magicLevel: 99, inv: { ...inv, [RUNE.law]: 0 } }).ok).toBe(false);
        expect(teleportUsable(T('varrock'), { magicLevel: 99, inv: { ...inv, [RUNE.air]: 2 } }).ok).toBe(false);
        expect(teleportUsable(T('camelot'), { magicLevel: 99, inv: new Map([[RUNE.air, 5], [RUNE.law, 1]]) }).ok).toBe(true);   // Map form too
    });
    test('a WIELDED staff substitutes its element (lava = fire + earth); held in the pack does not', () => {
        expect([...freeRunes([3053])].sort()).toEqual([RUNE.fire, RUNE.earth].sort());
        const lawOnly = { [RUNE.law]: 5 };
        expect(teleportUsable(T('trollheim'), { magicLevel: 99, inv: lawOnly, worn: [1387], quests: { eadgars_ruse: true } }).ok).toBe(true);   // staff of fire
        expect(teleportUsable(T('camelot'), { magicLevel: 99, inv: lawOnly, worn: [1381] }).ok).toBe(true);    // staff of air
        expect(teleportUsable(T('camelot'), { magicLevel: 99, inv: { ...lawOnly, 1381: 1 } }).ok).toBe(false); // staff in the pack
        expect(teleportUsable(T('varrock'), { magicLevel: 99, inv: lawOnly, worn: [1381] }).ok).toBe(false);   // still needs 1 fire
    });
    test('quest gates (caller-declared: the varps are not transmitted)', () => {
        expect(teleportUsable(T('ardougne'), RICH).ok).toBe(false);
        expect(teleportUsable(T('ardougne'), { ...RICH, quests: { plague_city: true } }).ok).toBe(true);
        expect(teleportUsable(T('watchtower'), { ...RICH, quests: { plague_city: true } }).ok).toBe(false);
    });
    test('members flag', () => {
        expect(teleportUsable(T('camelot'), { ...RICH, members: false }).ok).toBe(false);
        expect(teleportUsable(T('varrock'), { ...RICH, members: false }).ok).toBe(true);
    });
    test('wilderness: spells/ring/necklace up to 20, glory up to 30 (main + Edgeville-dungeon wilderness)', () => {
        expect(wildernessLevel({ level: 0, x: 3100, z: 3519 })).toBe(0);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3520 })).toBe(1);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3679 })).toBe(20);
        expect(wildernessLevel({ level: 0, x: 3100, z: 3680 })).toBe(21);
        expect(wildernessLevel({ level: 0, x: 3100, z: 9920 + 8 * 25 })).toBe(26);
        const glory = { magicLevel: 1, inv: { 1712: 1 } };
        const w25 = { level: 0, x: 3100, z: 3520 + 8 * 24 };   // level 25
        expect(teleportUsable(T('varrock'), RICH, w25).ok).toBe(false);
        expect(teleportUsable(T('glory-edgeville'), glory, w25).ok).toBe(true);
        expect(teleportUsable(T('glory-edgeville'), glory, { level: 0, x: 3100, z: 3520 + 8 * 30 }).ok).toBe(false);   // level 31
        expect(teleportUsable(T('dueling-arena'), { magicLevel: 1, inv: { 2552: 1 } }, w25).ok).toBe(false);
    });
    test('jewellery: any charged stage in the PACK; an uncharged glory (1704) is nothing', () => {
        expect(teleportUsable(T('glory-draynor'), { magicLevel: 1, inv: { 1706: 1 } }).ok).toBe(true);
        expect(teleportUsable(T('glory-draynor'), { magicLevel: 1, inv: { 1704: 1 } }).ok).toBe(false);
        expect(teleportUsable(T('glory-draynor'), { magicLevel: 1, worn: [1712] }).ok).toBe(false);   // worn: no rub op
        expect(teleportUsable(T('games-burthorpe'), { magicLevel: 1, inv: { 3867: 1 } }).ok).toBe(true);
    });
    test('duel arena / tutorial island / deny-list / fromUnderground:false', () => {
        expect(teleportUsable(T('varrock'), RICH, { level: 0, x: 3340, z: 3220 }).ok).toBe(false);
        expect(teleportUsable(T('varrock'), RICH, { level: 0, x: 3100, z: 3100 }).ok).toBe(false);
        expect(teleportUsable(T('varrock'), { ...RICH, deny: ['varrock'] }).ok).toBe(false);
        const mine = { level: 0, x: 3041, z: 9769 };
        expect(teleportUsable(T('varrock'), RICH, mine).ok).toBe(true);                       // no script forbids it
        expect(teleportUsable(T('varrock'), { ...RICH, fromUnderground: false }, mine).ok).toBe(false);
    });
    test('no caps -> nothing usable; kill switch (setTeleportsEnabled / NAV_TELEPORTS=0) -> nothing usable', () => {
        expect(usableTeleports(null)).toEqual([]);
        expect(usableTeleports(RICH).length).toBeGreaterThan(0);
        setTeleportsEnabled(false); expect(usableTeleports(RICH)).toEqual([]); setTeleportsEnabled(true);
        process.env.NAV_TELEPORTS = '0'; expect(usableTeleports(RICH)).toEqual([]); delete process.env.NAV_TELEPORTS;
        expect(usableTeleports(RICH).length).toBeGreaterThan(0);
    });
});

describe('planner choice (real collision)', () => {
    const CAMELOT_GOAL = { level: 0, x: 2757, z: 3490 };

    test('Lumbridge -> Camelot: Camelot teleport beats the ~470-tile walk', () => {
        const walk = planMultiLevel(LUMBRIDGE, CAMELOT_GOAL);
        const tele = planMultiLevel(LUMBRIDGE, CAMELOT_GOAL, { teleports: RICH });
        expect(walk).not.toBeNull();
        expect(tele![0]!.teleport?.id).toBe('camelot');
        expect(tele![0]!.waypoints).toEqual([{ x: LUMBRIDGE.x, z: LUMBRIDGE.z }]);   // cast where you stand
        expect(tele!.at(-1)!.waypoints.at(-1)).toMatchObject({ x: CAMELOT_GOAL.x, z: CAMELOT_GOAL.z });
        expect(planCost(tele)).toBeLessThan(planCost(walk) - 10);
        expect(describePlan(tele)).toContain('TELEPORT Camelot');
    }, 60_000);

    test('no caps = the old plan, unchanged (default OFF)', () => {
        expect(planMultiLevel(LUMBRIDGE, CAMELOT_GOAL, {})).toEqual(planMultiLevel(LUMBRIDGE, CAMELOT_GOAL));
        expect(planMultiLevel(LUMBRIDGE, CAMELOT_GOAL)!.some(l => l.teleport)).toBe(false);
    }, 60_000);

    test('not chosen without the runes / the level', () => {
        const noLaw = planMultiLevel(LUMBRIDGE, CAMELOT_GOAL, { teleports: { magicLevel: 99, inv: { [RUNE.air]: 1000 } } });
        expect(noLaw!.some(l => l.teleport)).toBe(false);
        const lvl1 = planMultiLevel(LUMBRIDGE, CAMELOT_GOAL, { teleports: { ...RICH, magicLevel: 1 } });
        expect(lvl1!.some(l => l.teleport)).toBe(false);
        const lvl44 = planMultiLevel(LUMBRIDGE, CAMELOT_GOAL, { teleports: { ...RICH, magicLevel: 44 } });
        expect(lvl44![0]!.teleport?.id).not.toBe('camelot');   // may still pick Falador (37) — never Camelot (45)
    }, 60_000);

    test('not chosen when walking is short (savings < minSaveTiles)', () => {
        const near = planMultiLevel(LUMBRIDGE, { level: 0, x: 3245, z: 3238 }, { teleports: RICH });
        expect(near!.some(l => l.teleport)).toBe(false);
    }, 60_000);

    test('underground start: teleports out (scripts allow it) unless fromUnderground:false, then it climbs', () => {
        const mine = { level: 0, x: 3041, z: 9769 }, bank = { level: 0, x: 3185, z: 3436 };
        const out = planMultiLevel(mine, bank, { teleports: RICH });
        expect(out![0]!.teleport?.id).toBe('varrock');
        const climb = planMultiLevel(mine, bank, { teleports: { ...RICH, fromUnderground: false } });
        expect(climb!.some(l => l.teleport)).toBe(false);
        expect(climb!.some(l => l.portal)).toBe(true);
    }, 60_000);

    test('deep wilderness (level 23): spells refused, the glory (<=30) is used', () => {
        const wild = { level: 0, x: 3100, z: 3700 }, edge = { level: 0, x: 3094, z: 3491 };
        expect(wildernessLevel(wild)).toBe(23);
        const spellsOnly = planMultiLevel(wild, edge, { teleports: RICH });
        expect(spellsOnly!.some(l => l.teleport)).toBe(false);
        const glory = planMultiLevel(wild, edge, { teleports: { ...RICH, inv: { ...(RICH.inv as Record<number, number>), 1710: 1 } } });
        expect(glory![0]!.teleport?.id).toBe('glory-edgeville');
        expect(glory![0]!.teleport?.items).toContain(1710);
        expect(glory![0]!.teleport?.choice).toBe('Edgeville');
    }, 60_000);

    test('a denied teleport is never planned (the follower\'s session drop-list)', () => {
        const p = planMultiLevel(LUMBRIDGE, CAMELOT_GOAL, { teleports: { ...RICH, deny: ['camelot'] } });
        expect(p![0]!.teleport?.id ?? 'walk').not.toBe('camelot');
    }, 60_000);
});

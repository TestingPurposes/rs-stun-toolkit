// =====================================================================================================
// legs/legends/common.ts — LEGENDS' QUEST shared types + the SIM-ONLY state setup
// =====================================================================================================
// The quest is split into segments at quest-stage boundaries (quest_legends.constant):
//   A  0 -> 5   start (Radimus, Legends' Guild), map the Kharazi jungle, bullroarer, Gujuo, accept the Ungadulu rescue
//   B  5 -> 12  find the cavern entrance, Ungadulu, golden bowl + holy water, book of binding, Nezikchened (fire)
//   C 12 -> 20  germinate the yommi seeds, the pool dries, lower dungeon, crystal heart, boulder, the dagger (Viyeldi)
//   D 20 -> 45  Nezikchened (water), sacred water, totem, final Nezikchened (+ the three heroes), gilded totem
//   E 45 -> end back to Radimus, the training/reward, quest complete
//
// ⛔ CHEAT RULE (the quest must also run cheatless on a live server):
//   segment code (seg-*.ts) NEVER calls bot.cheat / localSetup / setvar. Only simSetup() below does, it refuses a
//   non-local host, and legends.ts sets CHEATS.blocked on a live host so any stray cheat throws.
//   Everything a segment needs that it does not obtain in-game itself is declared in its `supply` list: on the demo a
//   helper hands it over (trade) before the segment; in the sim simSetup gives it.
//
// The quest varps (legendsquest, legends_bits) are NOT transmitted to the client: segments gate on OBSERVABLES
// (dialog text, items, position, game messages), never on the varp.

import { SpeedBot, localSetup, objId } from '../../core.js';

export interface SimState {
    /** server varps to set (sim only): e.g. { legendsquest: 5, legends_bits: 0b111, qp: 107, ... } */
    varps?: Record<string, number>;
    stats?: Record<string, number>;
    items?: Array<{ name: string; n: number }>;
    tele?: { x: number; z: number; level?: number };
    clear?: boolean;
}

export interface SegCtx {
    verbose: boolean;
    /** live: called when the segment needs a supply top-up mid-way (helper trade); sim: simSetup gives it */
    resupply?: (items: Array<{ name: string; n: number }>) => Promise<void>;
    /** HELPER MODE (route runner, cheatless; set => the old in-jungle hand-offs are OFF, `resupply` is never called). */
    helper?: LegHelper;
}

/** HELPER MODE. No kit is handed over inside the Kharazi jungle or the Shaman caves: a helper
 *  without Legends progress can never get there (jungle_tree.rs2: chopping in needs Radimus' map, Shilo's gates need Shilo
 *  Village). Instead the segments take their kits at two MAINLAND meeting points they walk through anyway (zero detour):
 *    B: north of the jungle belt (x 2816) on the way to the anvil (2790,3100), where B makes the golden bowl (B's quest kit
 *       is first needed there);
 *    C: just north of the jungle belt (x 2816) on the way to the bravery-potion herbs (C's kit + the prayer/boost kit for C
 *       and D: D never leaves the jungle/caves, it uses what C brought).
 *  The main carries in A's kit + B's fight kit + E's teleport runes from its bank before the quest (HELPER_CARRY, kits.ts).
 *  `send` starts the helper towards `at` now (non-blocking); `meet` trades `items` where the main stands (blocking). */
export interface LegHelper {
    send(at: { x: number; z: number; level?: number }, items: Array<{ name: string; n: number }>, label: string): void;
    meet(at: { x: number; z: number; level?: number }, items: Array<{ name: string; n: number }>, label: string): Promise<boolean>;
}
/** the meeting tiles (outside the route's helperUnreachable box: z > 2945) */
export const MEET = {
    // both 7 tiles north of the x=2816 jungle belt exit (2816,2940): B (helper mode) leaves the jungle there for the anvil,
    // C for the herbs. The only helper-safe spot on this edge: scorpions roam the x=2795 exit, snakes + jungle spiders the
    // anvil (they killed the level-3 helper there in sims lgd1/lge2); here only jungle foresters + Shilo's fence.
    B: { x: 2816, z: 2947, level: 0 },   // seg-b step 5 (helper mode)
    C: { x: 2816, z: 2947, level: 0 },   // seg-c step 6
} as const;

export interface Seg {
    id: 'A' | 'B' | 'C' | 'D' | 'E';
    title: string;
    /** the quest stage this segment starts at / leaves at (documentation + sim setup) */
    fromStage: number;
    toStage: number;
    /** sim-only state that stands in for "everything before this segment" (prior segments' result) */
    pre: SimState;
    /** items the trainee must hold at segment start that the segment does not get in-game (demo: helper trade) */
    supply: Array<{ name: string; n: number }>;
    run(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>>;
}

/** SIM ONLY. Puts the account into `s` (varps, stats, items, position). Refuses a non-local host. */
export async function simSetup(bot: SpeedBot, s: SimState): Promise<void> {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) throw new Error('simSetup refuses to run unless LC_HOST is localhost');
    for (const [v, val] of Object.entries(s.varps ?? {})) { await bot.cheat(`setvar ${v} ${val}`); await bot.tick(1); }
    await localSetup(bot, { stats: s.stats, items: s.items, tele: s.tele, clear: s.clear });
}

/** helper mode: the main carries this in from its bank before the quest. A's kit (sharks 5 -> 4: A ate none in the route-stats
 *  sim lgb1), B's fight kit (1 prayer potion; the 4 sharks are A's, kept), E's Camelot runes (law 1 + air 5; A/B/C keep them). */
export const HELPER_CARRY = [
    { name: 'coins', n: 60 }, { name: 'papyrus', n: 5 }, { name: 'charcoal', n: Number(process.env.LG_CHARCOAL ?? 4) }, { name: 'rune_axe', n: 1 }, { name: 'rune_scimitar', n: 1 },   // fix 264 (seg-a.ts): charcoal 2 -> 4
    { name: 'shark', n: 4 }, { name: '4doseprayerrestore', n: 1 }, { name: 'lawrune', n: 1 }, { name: 'airrune', n: 5 },
    ...((process.env.LG_CARRY_EXTRA ?? '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, n: 1 }))),
];

export function supplyText(items: Array<{ name: string; n: number }>): string {
    return items.map(i => { let id = -1; try { id = objId(i.name); } catch { /* unknown name */ } return `${i.name} (${id}) x${i.n}`; }).join(', ');
}

/** SIM ONLY: the account state that stands in for every prerequisite of Legends' Quest (quest points, the prerequisite
 *  quests' completion varps, skill levels). Filled in by segment A's builder from radimus_erkle.rs2 / legends_guard.rs2;
 *  every segment's `pre` starts from it. On the demo the trainee must REALLY have all of this. */
//   varps: qp (Legends' guard needs >= 107: legends_guard.rs2:53, ^legends_required_questpoints) + the five prerequisite quests
//   the guard checks (legends_guard.rs2:50-52; completion values from general/configs/quest.constant): Family Crest
//   (crestquest 11), Heroes' Quest (heroquest 15), Shilo Village (zombiequeen 15 — also opens the Brimhaven->Shilo cart and
//   the Shilo gates), Underground Pass (upass 10), Waterfall Quest (waterfall_quest 10).
//   stats: every skill the content checks (crafting 50 map, prayer 42 bless, agility 50 crevice/jumps, thieving 50,
//   strength 50, mining 52, smithing 50, herblore 45, woodcutting 50, magic 10+/56) — set to 99 in the sim so the
//   stat_random rolls (map/jungle/bless/crevice) almost always pass — plus 99 combat for the Nezikchened/Viyeldi fights.
export const PREREQ: SimState = {
    varps: { qp: 107, crestquest: 11, heroquest: 15, zombiequeen: 15, upass: 10, waterfall_quest: 10, junglepotion: 12 },   // junglepotion: Shilo needs it in a real game; segment C picks the bravery-potion herbs only after it
    stats: {
        attack: 99, defence: 99, strength: 99, hitpoints: 99, ranged: 99, prayer: 99, magic: 99,
        agility: 99, crafting: 99, herblore: 99, mining: 99, smithing: 99, thieving: 99, woodcutting: 99,
    },
};

/** LIVE requirements (what PREREQ stands in for in the sim). Quest completion cannot be checked from the client (quest varps
 *  are not transmitted); skill levels are checked by run-legends.ts --live before it starts. */
export const REQUIREMENTS = {
    questPoints: 107,
    quests: ["Family Crest", "Heroes' Quest", 'Shilo Village (needs Jungle Potion)', 'Underground Pass', 'Waterfall Quest'],
    skills: {
        agility: { level: 50, why: 'cave crawl, jagged/crumbled walls, the chain (B, C, D; failed rolls retry)' },
        crafting: { level: 50, why: 'mapping the Kharazi jungle (A)' },
        herblore: { level: 45, why: 'the bravery potion (C) and planting the yommi seed (D)' },
        mining: { level: 52, why: 'the mining-trial boulders in the Shaman caves (B, C)' },
        smithing: { level: 50, why: 'the golden bowl from 2 gold bars on the anvil (B)' },
        strength: { level: 50, why: 'the strength-trial gate in the Shaman caves (B, C, D)' },
        thieving: { level: 50, why: 'the lockpick gate in the Shaman caves (B, C)' },
        woodcutting: { level: 50, why: 'chopping into the Kharazi jungle and the totem (A, D)' },
        prayer: { level: 43, why: "Gujuo's blessing (42) + Protect from Melee for every fight (B, C, D)" },
        magic: { level: 56, why: 'charging a water orb (C, 56) and the Camelot teleport home (E, 45)' },
        attack: { level: 80, why: 'Nezikchened x3, Viyeldi, the three heroes (recommended, not a game check)' },
        defence: { level: 70, why: 'same fights (recommended)' },
        hitpoints: { level: 70, why: 'same fights (recommended)' },
    } as Record<string, { level: number; why: string }>,
    /** segment A starts here: outside the Legends' Guild gate */
    start: { x: 2728, z: 3346, level: 0 },
};

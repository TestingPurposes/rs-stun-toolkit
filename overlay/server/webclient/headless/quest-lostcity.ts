// LOST CITY DRIVER. "Quest not started" ->
// "dramen staff WORN, quest complete, out of Zanaris, pickaxe back in the pack". Every cosmic crafter runs this ONCE for
// itself: the branch and the staff are both untradeable (quest_zanaris.obj tradeable=no) and an untradeable dropped obj is
// never revealed to another player (engine Zone.ts:333), so no account can make staves for another.
// Modelled on quest-troll.ts: async orchestration over a LeanBot-derived bot (several accounts can share one
// pathfinder); every decision is a PURE function of observable state + what this run learned from game/dialog text
// (decideLostCity), so a relaunch resumes from wherever the account stands.
//
// ⛔ OFFLINE-DERIVED, NOT LIVE-PROVEN. Ids/tiles are cited to the content; every walking leg and stand tile is checked on
// the real 289 collision (sim/rc-cosmic-geo.test.ts); the step table / dialog policy / executors are sim-tested
// (sim/quest-lostcity.test.ts). The fights and the dialog texts need a live smoke.
//
// CONTENT (server/content/scripts/quests/quest_zanaris/ unless noted):
//   varp    %zanaris (perm): 0 not started, 1 started, 2 spoken_shamus, 3 spirit_defeated, 4 tree_chopped, 5 staff_made,
//           6 complete (quest_zanaris.constant; ^zanaris_complete = 6 per quest-state.ts).
//   start   Warrior (npc 650 warrioradventurerpg) @ (3145,3202) [m49_50 "0 9 2: 650"], area_lumbridge/scripts/
//           warrior_zanaris.rs2: multi2 "What are you camped here for?" -> multi3 "What makes you think it's out here?" ->
//           multi2 "If it's hidden how are you planning to find it?" -> p_choice2 "Looks like you don't know either." ->
//           %zanaris = started (the player line "So a leprechaun knows where Zanaris is eh?" is the tell).
//           His opener is the stage ORACLE: "Hello there traveller." = 0; "So let me get this straight..." = 1; "Have you
//           found anything yet?" = 2..5; "Hey, thanks for all the information..." = complete.
//   Shamus  [oploc1,leprechauntree] 2409 2x2 @ (3138,3212) [m49_50 "0 2 12: 2409 10"] needs ANY axe (pack or worn,
//           woodcut.rs2 ~woodcutting_axe_checker; "You do not have an axe which you have the level to use.") and spawns
//           Shamus (654) at (3139,3211), who walks 10 east and despawns after 100 ticks. opnpc1 at stage 1 -> p_choice2
//           (either option) -> @zanarisleprechaun_dramenwood_staff -> %zanaris = spoken_shamus.
//   Entrana the monk boat refuses every weapon/armour (rc-solo ENTRANA_RESTRICTED_CATEGORIES) — axes included — so the
//           driver banks EVERYTHING but the kit (knife, sharks) at Draynor first. Cave ladder entranaladdertop 2408 @
//           (2820,3374) [m44_52 "0 4 46: 2408 10 2"] works only while the cave monk (656) stands on (2822,3374):
//           area_entrana/scripts/cave_monk.rs2 p_choice2 "Well that is a risk I will have to take." -> (2822,9774), prayer
//           drained 95%. The ladder is ONE-WAY; the only exit is the magic door 2407 @ (2874,9750) -> (3250,3772), deep
//           wilderness (entrana_dungeon.rs2).
//   axe     Entranan zombies (npc 76, lvl 25, cowardly = not aggressive to combat > 50) drop a bronze axe 50/128 and an
//           iron axe 1/128 (drop tables/zombie.rs2:102-131) — the only axe source on the island.
//   tree    dramentree 1292 2x2 @ (2860,9734) [m44_152 "0 44 6: 1292 10"]: < spoken_shamus -> "ominous aura"; WC < 36 ->
//           refused; = spoken_shamus -> spawns the Tree spirit (655: lvl 101, att 90 str 95 def 80 hp 85) at (2860,9737),
//           which attacks; its death -> spirit_defeated ("With the Tree Spirit defeated you can now chop the tree.").
//           npc_add(..., 1000): it DESPAWNS 1000 ticks later, fight or not; npc_find(spawn, 6) blocks a second spawn while it
//           lives (a re-chop only re-aggroes it). Both sides approach NAIVELY (rev 289 clientRoutefinder; Npc naive chase), so
//           the spirit parks on the tree's N face (2860,9736) and a fighter on the S stand never reaches it: the fight walks
//           a ROUTE onto a cardinal tile of the spirit (fight({routed})) — the live wedge of acct5.
//           >= spirit_defeated -> "You cut a branch from the Dramen tree." (needs a free slot), any number of times.
//   numbers the fight is UNARMED (Entrana) and decided by lostcity-spirit.ts (the 289 rolls, Monte-Carlo):  str/def
//           26 + 12 sharks on the login style lost every time (P(win) ~0-1%). The driver now (a) refuses the boat below P(win)
//           0.97 (fail 'restock:'/'train:' -> lcq=restock|train -> the cosmic chain trains Str/Def 45, takes 20 sharks, retries),
//           (b) in the dungeon walks OUT by the magic door instead of (re)spawning a spirit it would lose, (c) fights on the best
//           unarmed style (aggressive at str 45: max hit 6), set-with-verify (com_mode resets to accurate on every login).
//   staff   knife (946) on the branch, Crafting >= 31 ("You carve the branch into a staff."). Knife: ground spawn
//           (3224,3202) Lumbridge [m50_50 "0 24 2: 946 1"].
//   finish  the shed door (zanaris.ts) with the staff WORN completes the quest on entry (staff_made -> complete).
//   danger  greater demons (83, cowardly lvl 92 = aggressive to combat <= 184, huntrange 3, wander 6) spawn at (2861,9747)
//           (2862,9751) — 13 tiles N of the tree's south stand. Black demons are in a separate pocket (not reachable).
//           Death costs nothing while the pack holds <= 3 items (the driver strips to the staves before the wilderness).
import { LeanBot, levelForDisplayedXp } from './leanbot.js';
import { ENTRANA_LEGS, ENTRANA_BOARD, onEntrana, inWilderness } from './entrana.js';
import { ZANARIS, DRAMEN_STAFF, DRAMEN_BRANCH, inZanaris, inShed } from './zanaris.js';
import { spiritWinChance, UNARMED_STYLE_BUTTON, LC_MIN_WIN, LC_MIN_WIN_DUNGEON, LC_FULL_PACK_SHARKS, LC_TRAIN, type MeleeStats } from './lostcity-spirit.js';

const sleepMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
type XZ = { x: number; z: number };
const cheb = (a: XZ, b: XZ) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export const LC_IDS = {
    WARRIOR: 650, SHAMUS: 654, SPIRIT: 655, ZOMBIE: 76, CAVE_MONK: 656, PORT_MONK: 657,
    KNIFE: 946, BRANCH: DRAMEN_BRANCH, STAFF: DRAMEN_STAFF, SHARK: 385, COINS: 995,
    /** woodcut.rs2 ~woodcutting_axe_checker order (rune .. bronze) */
    AXES: [1359, 1357, 1355, 1361, 1353, 1349, 1351] as readonly number[],
    PICKAXES: [1275, 1271, 1273, 1269, 1267, 1265] as readonly number[],   // best first
} as const;
export const LC_STAGE = { NOT_STARTED: 0, STARTED: 1, SPOKEN_SHAMUS: 2, SPIRIT_DEFEATED: 3, TREE_CHOPPED: 4, STAFF_MADE: 5, COMPLETE: 6 } as const;
export const LC_LOC = {
    LEP_TREE: { id: 2409, x: 3138, z: 3212 }, DRAMEN_TREE: { id: 1292, x: 2860, z: 9734 },
    ENT_LADDER: { id: 2408, x: 2820, z: 3374 }, MAGIC_DOOR: { id: 2407, x: 2874, z: 9750 },
} as const;
/** stand tiles: reachedLoc-valid and exact-walk-verified on the 289 collision (sim/rc-cosmic-geo.test.ts) */
export const LC_AT = {
    WARRIOR: { x: 3145, z: 3203 },          // beside the warrior's spawn (3145,3202)
    LEP_STAND: { x: 3140, z: 3212 },        // E face of the 2x2 leprechaun tree
    KNIFE: { x: 3224, z: 3202 },            // the knife ground spawn itself
    ENT_LADDER_STAND: { x: 2821, z: 3374 }, // E face of the cave ladder (the monk stands one further east)
    DUNGEON: { x: 2822, z: 9774 },          // cave_monk.rs2 telejump 0_44_152_6_46
    ZOMBIES: { x: 2845, z: 9761 },
    TREE_STAND: { x: 2860, z: 9733 },       // S face of the 2x2 dramen tree (furthest from the greater demons)
    MAGIC_DOOR_STAND: { x: 2873, z: 9750 }, // W of the door (entrana_dungeon.rs2 [oploc1,zanarismagicdoor])
    WILD_LANDING: { x: 3250, z: 3772 },     // 0_50_58_50_60
    DRAYNOR: { stand: { x: 3092, z: 3245 }, booth: { x: 3091, z: 3245, loc: 2213 } },   // rc-bot RUNE_LADDER air (live-proven)
    VARROCK_E: { stand: { x: 3253, z: 3420 }, booth: { x: 3253, z: 3419, loc: 2213 } }, // the solo crafters' bank
} as const;
const BANK_MAIN = 5292, BANK_INV = 5382, BANK_SIDE_INV = 2006;

// ---- region model ---------------------------------------------------------------------------------------------
export type LcRegion = 'main' | 'ship' | 'entrana' | 'dungeon' | 'wild' | 'zanaris' | 'shed' | 'unknown';
/** Pure: where the account stands (each region has exactly one way forward). */
export function lcRegion(level: number, x: number, z: number): LcRegion {
    const p = { x, z };
    if (level === 1 && Object.values(ENTRANA_LEGS).some(l => cheb(p, l.arrival) <= 6)) return 'ship';
    if (level !== 0) return 'unknown';
    if (inShed(p)) return 'shed';
    if (inZanaris(p)) return 'zanaris';
    if (x >= 2816 && x < 2880 && z >= 9728 && z < 9792) return 'dungeon';   // m44_152 (the Entrana dungeon)
    if (z >= 6400) return 'unknown';
    if (onEntrana(p)) return 'entrana';
    if (inWilderness(p)) return 'wild';
    return 'main';
}

// ---- knowledge ------------------------------------------------------------------------------------------------
/** What this run has PROVEN about %zanaris (not transmitted): an interval [lb, ub], plus refusals seen. */
export interface LcKnowledge { lb: number; ub: number; oracleDone: boolean; wcLow: boolean; craftLow: boolean; noAxe: boolean }
export function newLcKnowledge(): LcKnowledge { return { lb: -1, ub: LC_STAGE.COMPLETE, oracleDone: false, wcLow: false, craftLow: false, noAxe: false }; }
const raise = (k: LcKnowledge, v: number) => { if (v > k.lb) k.lb = v; if (k.ub < k.lb) k.ub = k.lb; };
const capTo = (k: LcKnowledge, v: number) => { if (v < k.ub) k.ub = v; if (k.lb > k.ub) k.lb = k.ub; };
const exact = (k: LcKnowledge, v: number) => { k.lb = v; k.ub = v; };

/** Every server line (dialog text / game message) this driver understands. Pure; updates `k`, returns why (or null). */
export function learnLcText(k: LcKnowledge, text: string): string | null {
    const t = text.replace(/<[^>]*>/g, '').trim();
    const S = LC_STAGE;
    // the warrior — the oracle (warrior_zanaris.rs2)
    if (/^Hello there traveller\./.test(t)) { exact(k, S.NOT_STARTED); k.oracleDone = true; return 'not started (warrior)'; }
    if (/So let me get this straight: I need to search the trees/.test(t)) { exact(k, S.STARTED); k.oracleDone = true; return 'started (warrior)'; }
    if (/^Have you found anything yet\?/.test(t)) { raise(k, S.SPOKEN_SHAMUS); capTo(k, S.STAFF_MADE); k.oracleDone = true; return 'spoken to Shamus, not complete (warrior)'; }
    if (/Hey, thanks for all the information/.test(t)) { exact(k, S.COMPLETE); k.oracleDone = true; return 'complete (warrior)'; }
    if (/So a leprechaun knows where Zanaris is eh\?/.test(t)) { raise(k, S.STARTED); return 'quest started'; }
    // Shamus (shamus.rs2)
    if (/Well you'll have to be catchin' me again when yer are/.test(t)) { exact(k, S.NOT_STARTED); return 'not started (Shamus)'; }
    if (/The monks are running a ship from Port Sarim to Entrana/.test(t)) { raise(k, S.SPOKEN_SHAMUS); return 'spoken to Shamus'; }
    if (/^How do I get to Zanaris again\?/.test(t)) { raise(k, S.SPOKEN_SHAMUS); return 'Shamus offers the reminder (>= spoken)'; }
    // the tree / the spirit / the staff (quest_zanaris.rs2, tree_spirit.rs2)
    if (/The tree seems to have a ominous aura to it/.test(t)) { capTo(k, S.STARTED); return 'tree refused: Shamus not spoken'; }
    if (/You are not a high enough Woodcutting level to chop down this tree/.test(t)) { k.wcLow = true; return 'Woodcutting < 36'; }
    if (/You do not have an axe which you have the level to use/.test(t)) { k.noAxe = true; return 'no axe'; }
    if (/With the Tree Spirit defeated you can now chop the tree/.test(t)) { raise(k, S.SPIRIT_DEFEATED); return 'tree spirit defeated'; }
    if (/You cut a branch from the Dramen tree/.test(t)) { raise(k, S.SPIRIT_DEFEATED); return 'branch cut'; }
    if (/You need at least level 31 Crafting to make this into a staff/.test(t)) { k.craftLow = true; return 'Crafting < 31'; }
    if (/You carve the branch into a staff/.test(t)) { raise(k, S.SPIRIT_DEFEATED); return 'staff carved'; }
    if (/Quest complete: Lost City|Lost City Of Zanaris Quest/i.test(t)) { exact(k, S.COMPLETE); return 'quest complete'; }
    return null;
}

/**
 * Which option to click on a choice page, by LABEL (never position). Pure. Covers the warrior's four-page start, Shamus,
 * the cave monk and the Port Sarim monk; anything else gets no rule (LeanBot's default) — see LostCityBot.
 */
export const LC_DIALOG: readonly RegExp[] = [
    /^What are you camped here for\?/,                       // warrior_zanaris.rs2 [opnpc1] multi2
    /^What makes you think it's out here\?/,                 // [label,warrior_camped_out] multi3
    /^If it's hidden how are you planning to find it\?/,     // [label,warrior_think_here] multi2
    /^Looks like you don't know either\./,                   // [label,warrior_if_hidden] p_choice2 -> started
    /^How does it fit in a shed then\?/,                     // shamus.rs2 started p_choice2 (either option -> spoken)
    /^How do I get to Zanaris again\?/,                      // shamus.rs2 default case (harmless reminder)
    /^Well that is a risk I will have to take\./,            // cave_monk.rs2 p_choice2 option 2 (option 1 declines)
    ENTRANA_BOARD,                                           // monk_of_entrana.rs2 "Yes, okay, I'm ready to go." (option 2)
];
export function lcDialogPick(options: readonly string[]): RegExp | null {
    for (const re of LC_DIALOG) if (options.some(o => re.test(o.trim()))) return re;
    return null;
}

// ---- observation + decision -----------------------------------------------------------------------------------
export interface LcObs {
    pos: { level: number; x: number; z: number }; region: LcRegion;
    journal: 'COMPLETE' | 'IN_PROGRESS' | 'NOT_STARTED' | 'NOT_OBSERVABLE';
    staffWorn: boolean; staffPack: number; branch: number; knife: number; axe: number; food: number;
    /** pack + worn items that are NOT kit (knife, sharks, branches, staves): banked before Entrana */
    nonKit: number; freeSlots: number;
    /** pickaxe in the pack or worn (restore: the solo crafter needs one) */
    pick: boolean;
    /** P(beat the Tree spirit) with the sharks held / with a full pack (lostcity-spirit.ts; base levels from xp). Only
     *  observed while the spirit is still due; undefined = unknown (the gates fall back to the minFood count). */
    spiritWin?: number; spiritWinFull?: number;
}
export type LcAction =
    | { kind: 'done' } | { kind: 'fail'; why: string }
    | { kind: 'talkWarrior' } | { kind: 'findShamus' } | { kind: 'getKnife' } | { kind: 'stash' } | { kind: 'sail' }
    | { kind: 'disembark' } | { kind: 'enterDungeon' } | { kind: 'getAxe' } | { kind: 'chop' } | { kind: 'carve' }
    | { kind: 'wield' } | { kind: 'exitDungeon' } | { kind: 'travelHome' } | { kind: 'enterZanaris' } | { kind: 'zanOut' }
    | { kind: 'shedOut' } | { kind: 'restore' } | { kind: 'retreat' };
/** minWin: the pre-boat P(win) gate; minWinDungeon: below it the dungeon walks out (magic door) instead of (re)spawning the
 *  spirit — a lost fight is NOT terminal: the lane fails 'restock'/'train' on the mainland and the chain refills + retries. */
export interface LcGoal { branches: number; minFood: number; restore: boolean; minWin: number; minWinDungeon: number }
export const LC_GOAL_DEFAULT: LcGoal = { branches: 2, minFood: 14, restore: true, minWin: LC_MIN_WIN, minWinDungeon: LC_MIN_WIN_DUNGEON };
/** The two fail reasons the cosmic chain RECOVERS from (rune-cosmic-chain.ts: train -> food -> quest again). */
export const LC_FAIL_RESTOCK = 'restock:', LC_FAIL_TRAIN = 'train:';

/**
 * THE STEP TABLE. Pure: the next thing to do from what is observable plus what this run has learned.
 * Restore bookkeeping (spare staff banked, pickaxe back) is `restored` (driver state).
 */
export function decideLostCity(o: LcObs, k: LcKnowledge, g: LcGoal = LC_GOAL_DEFAULT, restored = false): LcAction {
    const S = LC_STAGE;
    const staves = o.staffPack + (o.staffWorn ? 1 : 0);
    const complete = o.journal === 'COMPLETE' || k.lb >= S.COMPLETE;
    if (k.wcLow) return { kind: 'fail', why: 'Woodcutting < 36 (the dramen tree refuses) — train first (rune-path cosmic --from wc)' };
    if (k.craftLow) return { kind: 'fail', why: 'Crafting < 31 (the branch cannot be carved) — train first (rune-path cosmic --from craft)' };
    switch (o.region) {
        case 'shed': return { kind: 'shedOut' };
        case 'ship': return { kind: 'disembark' };
        case 'zanaris': return { kind: 'zanOut' };   // entry already happened (it completes the quest)
        case 'entrana': return staves > 0 || o.branch > 0 ? { kind: 'fail', why: 'on Entrana holding a staff/branch (the monk boat refuses a staff)' } : { kind: 'enterDungeon' };
        case 'dungeon': {
            // in the dungeon the order is: branches -> staves -> leave by the magic door (staves only)
            if (o.branch > 0) return o.knife > 0 ? { kind: 'carve' } : { kind: 'fail', why: 'branch held but no knife in the dungeon' };
            if (staves >= g.branches || (staves > 0 && o.freeSlots === 0)) return { kind: 'exitDungeon' };
            if (k.ub < S.SPOKEN_SHAMUS) return { kind: 'fail', why: 'in the dungeon but the tree refuses (Shamus not spoken) — the only way out is the magic door' };
            // the spirit is still due and this pack would lose it (a lost fight's leftovers, or a relaunch with no food):
            // walk out by the magic door — the only exit — and let the mainland gate send the account to restock
            if (k.lb < S.SPIRIT_DEFEATED && o.spiritWin !== undefined && o.spiritWin < g.minWinDungeon) return { kind: 'retreat' };
            if (o.axe === 0) return { kind: 'getAxe' };
            return { kind: 'chop' };   // spawns + fights the spirit when it is still due
        }
        case 'wild': return { kind: 'travelHome' };   // with or without staves (a death on the way costs nothing)
        case 'main': {
            if (staves > 0) {
                if (!complete) return o.staffWorn ? { kind: 'enterZanaris' } : { kind: 'wield' };
                if (!o.staffWorn) return { kind: 'wield' };
                if (g.restore && !restored && (o.staffPack > 0 || !o.pick)) return { kind: 'restore' };
                return { kind: 'done' };
            }
            if (complete && k.lb >= S.COMPLETE && !o.staffWorn) return { kind: 'fail', why: 'quest complete but no staff held (banked? lost?) — needs a re-chop on Entrana (stage >= spirit_defeated: no fight)' };
            // no staff: what does the quest need next?
            if (k.lb >= S.SPOKEN_SHAMUS) {
                // ⛔ FULL PACK, NO KNIFE -> stash FIRST (the stash keeps only the kit, so it frees the slot). Sim (rig
                // rlc1): a tutorial pack + 10 sharks = 28/28, and getKnife stood on the empty-looking spawn for good.
                if (o.knife === 0 && o.freeSlots === 0 && o.nonKit > 0) return { kind: 'stash' };
                if (o.knife === 0) return { kind: 'getKnife' };
                if (o.nonKit > 0) return { kind: 'stash' };
                if (k.lb < S.SPIRIT_DEFEATED) {
                    const pct = (p?: number) => p === undefined ? '?' : `${(p * 100).toFixed(1)}%`;
                    const short = o.food < g.minFood || (o.spiritWin !== undefined && o.spiritWin < g.minWin);
                    if (short && o.spiritWinFull !== undefined && o.spiritWinFull < g.minWin)
                        return { kind: 'fail', why: `${LC_FAIL_TRAIN} the tree spirit beats this account even with a full pack (P(win) ${pct(o.spiritWinFull)} < ${pct(g.minWin)}) — train Strength/Defence to ${LC_TRAIN.str}/${LC_TRAIN.def} (cosmic chain --from train)` };
                    if (short) return { kind: 'fail', why: `${LC_FAIL_RESTOCK} ${o.food} sharks (min ${g.minFood}), P(win) ${pct(o.spiritWin)} < ${pct(g.minWin)} for the tree spirit (cosmic chain --from food)` };
                }
                return { kind: 'sail' };
            }
            if (!k.oracleDone || k.ub < S.STARTED) return { kind: 'talkWarrior' };   // learn the stage / start it
            if (k.lb === S.STARTED && k.ub >= S.STARTED) return o.axe > 0 ? { kind: 'findShamus' } : { kind: 'fail', why: 'Shamus needs an axe (pack or worn) — rune-path cosmic --from axe' };
            return { kind: 'talkWarrior' };
        }
        default: return { kind: 'fail', why: `position (${o.pos.x},${o.pos.z},L${o.pos.level}) is outside the modelled Lost City area` };
    }
}

// ---- the bot -------------------------------------------------------------------------------------------------
/** LeanBot shell for the driver: never travels on its own, heals every tick, answers choice pages by label. */
export class LostCityBot extends LeanBot {
    lcStage = '-';
    lcq = 'idle';
    private labelWait = 0;
    constructor() {
        super();
        this.mode = 'combat'; this.arrived = true; this.quiet = true;
        this.foodObj = LC_IDS.SHARK; this.healFrac = 0.5;
    }
    protected override doCombat(): void { if (this.tryHeal()) return; this.warm(); }
    protected override driveDialog(): void {
        const opts = this.dialogOptions();
        if (opts.length && opts.some(o => o.text === '') && this.labelWait < 5) { this.labelWait++; this.warm(); return; }
        this.labelWait = 0;
        if (opts.length) { const re = lcDialogPick(opts.map(o => o.text)); this.dialogPolicy = re ? [{ match: re, label: 'lostcity' }] : []; }
        super.driveDialog();
    }
}

// ---- the driver ----------------------------------------------------------------------------------------------
export interface LcDriveOpts {
    timeoutMs: number;
    shouldStop?: () => boolean;
    log?: (s: string) => void;
    /** one game tick (default 600 ms); the sim injects a harness-synchronised tick */
    tick?: () => Promise<void>;
    goal?: Partial<LcGoal>;
    /** persisted knowledge (stage lower bound) so a relaunch resumes without re-asking */
    store?: { load: () => { lb?: number } | null; save: (k: { lb: number }) => void };
}
interface Ctx {
    bot: any; o: LcDriveOpts; k: LcKnowledge; g: LcGoal; t0: number;
    lastTexts: Map<number, string>; chatSince: number; seenChat: Set<string>; restored: boolean;
}
function log(c: Ctx, s: string): void { (c.o.log ?? ((m: string) => console.log(`[lcq] ${c.bot.loginUser ?? ''}: ${m}`)))(s); }
function stopped(c: Ctx): boolean { return !!c.o.shouldStop?.() || Date.now() - c.t0 > c.o.timeoutMs; }
function plane(bot: any): number { return typeof bot.minusedlevel === 'number' ? bot.minusedlevel : 0; }
function pos(bot: any) { const t = bot.tile(); return { level: plane(bot), x: t.x, z: t.z }; }
function dialogOpen(bot: any): boolean { return (bot.chatModalId ?? -1) !== -1; }
async function tick(c: Ctx): Promise<void> { await (c.o.tick ? c.o.tick() : sleepMs(600)); observe(c); }
function journal(bot: any): LcObs['journal'] {
    try { const s = bot.questState?.('zanaris')?.status; return s === 'COMPLETE' || s === 'IN_PROGRESS' || s === 'NOT_STARTED' ? s : 'NOT_OBSERVABLE'; } catch { return 'NOT_OBSERVABLE'; }
}
function observe(c: Ctx): void {
    const bot = c.bot; const texts: string[] = [];
    const it: Map<number, string> | undefined = bot.ifText;
    if (it) for (const [com, t] of it) if (c.lastTexts.get(com) !== t) { c.lastTexts.set(com, t); if (t) texts.push(t); }
    try {
        for (const m of (bot.getChat?.({ types: [0], limit: 40 }) ?? []) as Array<{ text: string; tick: number }>) {
            const key = `${m.tick}:${m.text}`;
            if (m.tick >= c.chatSince && !c.seenChat.has(key)) { c.seenChat.add(key); texts.push(m.text); }
        }
        if (c.seenChat.size > 400) c.seenChat = new Set([...c.seenChat].slice(-200));
    } catch { /* no chat log */ }
    const lb0 = c.k.lb;
    for (const t of texts) { const why = learnLcText(c.k, t); if (why) log(c, `learned: ${why} -> stage in [${c.k.lb}, ${c.k.ub}]`); }
    if (c.k.lb > lb0) c.o.store?.save({ lb: c.k.lb });
}
const KIT = new Set<number>([LC_IDS.KNIFE, LC_IDS.SHARK, LC_IDS.BRANCH, LC_IDS.STAFF]);
function obs(c: Ctx): LcObs {
    const bot = c.bot; const p = pos(bot);
    const count = (id: number) => bot.countOf?.(id) ?? 0;
    const worn = (id: number) => !!bot.isWorn?.(id);
    const pack: Array<{ obj: number }> = bot.backpackSlots?.() ?? [];
    const wornIds: number[] = (bot.wornSlots?.() ?? []).map((w: any) => w.obj);
    const nonKit = pack.filter(s => !KIT.has(s.obj)).length + wornIds.filter(id => !KIT.has(id)).length;
    return {
        pos: p, region: lcRegion(p.level, p.x, p.z), journal: journal(bot),
        staffWorn: worn(LC_IDS.STAFF), staffPack: count(LC_IDS.STAFF), branch: count(LC_IDS.BRANCH), knife: count(LC_IDS.KNIFE),
        axe: LC_IDS.AXES.reduce((n, a) => n + count(a) + (worn(a) ? 1 : 0), 0), food: count(LC_IDS.SHARK),
        nonKit, freeSlots: 28 - pack.length, pick: LC_IDS.PICKAXES.some(id => count(id) > 0 || worn(id)),
        ...(c.k.lb < LC_STAGE.SPIRIT_DEFEATED ? spiritObs(bot, count(LC_IDS.SHARK)) : {}),
    };
}
/** BASE melee levels from xp (the current hp level is the damaged one; a level-up mid-quest shows here at once). */
export function lcMeleeStats(bot: any): MeleeStats {
    const lv = (i: number) => { const x = bot.statXp?.[i]; return typeof x === 'number' && x >= 0 ? levelForDisplayedXp(x) : 0; };
    return { att: lv(0), def: lv(1), str: lv(2), hp: lv(3) };
}
function spiritObs(bot: any, food: number): Pick<LcObs, 'spiritWin' | 'spiritWinFull'> {
    const st = lcMeleeStats(bot);
    const now = spiritWinChance(st, food), full = spiritWinChance(st, Math.max(food, LC_FULL_PACK_SHARKS));
    return { ...(now ? { spiritWin: now.win } : {}), ...(full ? { spiritWinFull: full.win } : {}) };
}

/** Exact walk on the current plane with LeanBot.walkToExact (navgrid/raw rsmod); true once ON the tile. */
async function walkTo(c: Ctx, x: number, z: number, maxTicks = 900): Promise<boolean> {
    const bot = c.bot; let last = ''; let still = 0;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (dialogOpen(bot)) { await tick(c); continue; }
        const me = bot.tile();
        if (me.x === x && me.z === z) return true;
        const key = `${me.x},${me.z}`; still = key === last ? still + 1 : 0; last = key;
        if (still > 60) { log(c, `walk to (${x},${z}) WEDGED at (${me.x},${me.z})`); return false; }
        if (!bot.walkToExact(x, z)) { const m = bot.tile(); if (m.x === x && m.z === z) return true; }
        await tick(c);
    }
    const me = bot.tile(); return me.x === x && me.z === z;
}
function nearestNpc(bot: any, types: readonly number[]): { index: number; x: number; z: number; dist: number; type: number } | null {
    const me = bot.tile(); let best: { index: number; x: number; z: number; dist: number; type: number } | null = null;
    for (let i = 0; i < (bot.npcCount ?? 0); i++) {
        const idx = bot.npcIndices[i]; const n = bot.npcs[idx];
        if (!n || !types.includes(n.typeId)) continue;
        const w = bot.npcTileOf(n); const d = cheb(w, me);
        if (!best || d < best.dist) best = { index: idx, x: w.x, z: w.z, dist: d, type: n.typeId };
    }
    return best;
}
/** Talk to an NPC (walk-before-op) and let LostCityBot's policy drive the pages; true once a dialog was seen and closed. */
async function talkTo(c: Ctx, npc: number, maxTicks = 200): Promise<boolean> {
    const bot = c.bot;
    // blank stale oracle lines so the same line on the same component registers as NEW (quest-troll talkTo lesson)
    const it: Map<number, string> | undefined = bot.ifText;
    if (it) for (const [com, t] of it) if (t && learnLcText(newLcKnowledge(), t) !== null) { it.set(com, ''); c.lastTexts.set(com, ''); }
    let saw = false, lastOp = -100, closedFor = 0;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (dialogOpen(bot) || ((bot.mainModalId ?? -1) !== -1 && bot.mainModalId !== BANK_MAIN)) { saw = true; closedFor = 0; await tick(c); continue; }
        if (saw && ++closedFor >= 3) return true;
        if (!saw && i - lastOp >= 8) {
            const n = nearestNpc(bot, [npc]);
            if (n) { bot.sendMove(n.x, n.z, true); bot.opNpc(n.index, 1); lastOp = i; }
            else if (i - lastOp >= 30) { log(c, `npc ${npc} not in scene`); lastOp = i; }
        }
        await tick(c);
    }
    return saw;
}
/** Raw-route length from -> to on the bot's planner; -1 when the route does not END on `to` (unwalkable / walled off). */
function routeLen(bot: any, from: XZ, to: XZ): number {
    if (from.x === to.x && from.z === to.z) return 0;
    const f = bot.findLongPathFn;
    if (!f) return cheb(from, to);
    let wp: XZ[] = [];
    try { wp = f(plane(bot), from.x, from.z, to.x, to.z) ?? []; } catch { return -1; }
    const e = wp[wp.length - 1];
    if (!e || e.x !== to.x || e.z !== to.z) return -1;
    let n = 0, px = from.x, pz = from.z;
    for (const w of wp) { n += cheb({ x: px, z: pz }, w); px = w.x; pz = w.z; }
    return n;
}
const LC_TREE_FOOTPRINT: readonly XZ[] = [0, 1].flatMap(dx => [0, 1].map(dz => ({ x: LC_LOC.DRAMEN_TREE.x + dx, z: LC_LOC.DRAMEN_TREE.z + dz })));
/**
 * The tile a melee swing on `n` lands from (reachedEntity: CARDINALLY adjacent), nearest by ROUTE. Pure over the planner.
 * Needed because rev 289 runs clientRoutefinder=true: OPNPC makes the server approach NAIVELY, and a loc between (the 2x2
 * dramen tree between its S face and a spirit stuck on its N face) stops the walk SILENTLY — the 1.7 h live wedge.
 */
export function lcMeleeTile(bot: any, n: XZ, avoid: readonly XZ[] = []): XZ | null {
    const me = bot.tile();
    let best: XZ | null = null, bestScore = Infinity;
    for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
        const t = { x: n.x + dx, z: n.z + dz };
        if (avoid.some(a => a.x === t.x && a.z === t.z)) continue;
        const len = routeLen(bot, me, t);
        const score = len >= 0 ? len : 1000 + cheb(me, t);   // unplannable tiles last (the exact walk still re-plans raw)
        if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
}
/**
 * Melee loop (unarmed is fine) with shark eating until `until()`; 'gone' when no target is visible for a while.
 * The target is re-found EVERY tick (live npc index + tile, never a stale one). Approach: the old walk-before-op
 * (MOVE + OPNPC2, the server's naive approach) while it makes progress; `routed` (or 3 ticks with no step while not
 * adjacent) switches to a ROUTED walk onto a cardinal melee tile, and OPNPC2 is sent only from there.
 */
async function fight(c: Ctx, types: readonly number[], until: () => boolean, label: string, maxTicks = 1200, opt: { routed?: boolean; avoid?: readonly XZ[]; styleButton?: number } = {}): Promise<'won' | 'fled' | 'gone' | 'timeout'> {
    const bot = c.bot; let lastAtk = -100, missing = 0, lastLog = -100, still = 0, routed = !!opt.routed, lastKey = '';
    const bad: XZ[] = []; let lastT: XZ | null = null, walkStill = 0;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        if (until()) return 'won';
        // the attack style (com_mode is SCOPE_TEMP: 0 = accurate after every login); set-with-verify, rate-limited inside
        if (opt.styleButton && !dialogOpen(bot)) bot.setCombatStyleByButton?.(opt.styleButton);
        const n = nearestNpc(bot, types);
        const hp = bot.hp ?? -1, maxHp = bot.maxHp ?? -1, food = bot.countOf(LC_IDS.SHARK);
        if (maxHp > 0 && hp >= 0 && hp <= Math.floor(maxHp * 0.5) && food > 0) bot.tryHeal?.();
        if (maxHp > 0 && hp >= 0 && hp <= Math.floor(maxHp * 0.2) && food === 0) { log(c, `${label}: out of food at hp ${hp}/${maxHp}`); return 'fled'; }
        const me = bot.tile();
        const key = `${me.x},${me.z}`; still = key === lastKey ? still + 1 : 0; lastKey = key;
        if (n) {
            missing = 0;
            const adjacent = Math.abs(n.x - me.x) + Math.abs(n.z - me.z) === 1;
            if (!adjacent && !routed && still >= 3 && i - lastAtk >= 3) { routed = true; log(c, `${label}: the naive approach is blocked at (${me.x},${me.z}) — routing to a melee tile of ${n.type}@${n.x},${n.z}`); }
            if (!dialogOpen(bot)) {
                if (adjacent) { walkStill = 0; if (i - lastAtk >= 4) { bot.opNpc(n.index, 2); lastAtk = i; } }
                else if (routed) {
                    const t = lcMeleeTile(bot, n, [...(opt.avoid ?? []), ...bad]);
                    if (!t) bad.length = 0;
                    else {
                        walkStill = still === 0 || t.x !== lastT?.x || t.z !== lastT?.z ? 0 : walkStill + 1;
                        // a melee tile the walk makes no progress toward (wall / planner gap) is dropped for this fight
                        if (walkStill >= 8) { bad.push(t); walkStill = 0; log(c, `${label}: no progress toward melee tile (${t.x},${t.z}) — trying another`); }
                        else bot.walkToExact(t.x, t.z);
                        lastT = t;
                    }
                }
                else if (i - lastAtk >= 4) { if (n.dist >= 2) bot.sendMove(n.x, n.z, true); bot.opNpc(n.index, 2); lastAtk = i; }
            }
        } else if (++missing > 40) return 'gone';
        if (i - lastLog >= 25) { log(c, `${label}: hp ${hp}/${maxHp} food ${food} me ${me.x},${me.z} target ${n ? `${n.type}#${n.index}@${n.x},${n.z}` : '-'}`); lastLog = i; }
        await tick(c);
    }
    return 'timeout';
}
async function loot(c: Ctx, objs: ReadonlySet<number>, maxTicks = 60): Promise<number> {
    const bot = c.bot;
    for (let i = 0; i < maxTicks && !stopped(c); i++) {
        const g = bot.findGroundItem?.(objs as Set<number>, 14);
        if (!g) { if (i > 6) return 0; await tick(c); continue; }
        const before = bot.countOf(g.obj);
        if (i % 3 === 0) { if (cheb(g, bot.tile()) >= 1) bot.sendMove(g.x, g.z, true); bot.opObj(g.x, g.z, g.obj, 3); }
        await tick(c);
        if (bot.countOf(g.obj) > before) return g.obj;
    }
    return 0;
}
function bankSlot(bot: any, obj: number): number { const inv = bot.invs?.get(BANK_INV); if (!inv) return -1; for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === obj && inv.counts[i] > 0) return i; return -1; }
async function openBank(c: Ctx, b: { stand: XZ; booth: XZ & { loc: number } }): Promise<boolean> {
    const bot = c.bot;
    for (let a = 0; a < 5 && !stopped(c); a++) {
        if (bot.mainModalId === BANK_MAIN) { bot.leaseModal?.(40); return true; }
        if (!(await walkTo(c, b.stand.x, b.stand.z))) return false;
        bot.leaseModal?.(40);   // LeanBot's brain would otherwise dismiss the bank modal the driver opened
        bot.opLoc(b.booth.x, b.booth.z, b.booth.loc, 2);
        for (let w = 0; w < 8 && bot.mainModalId !== BANK_MAIN; w++) await tick(c);
    }
    if (bot.mainModalId === BANK_MAIN) bot.leaseModal?.(40);
    return bot.mainModalId === BANK_MAIN;
}
async function closeModal(c: Ctx): Promise<void> { const bot = c.bot; bot.releaseModal?.(); for (let i = 0; i < 4 && (bot.mainModalId ?? -1) !== -1; i++) { bot.sendCloseModalPublic?.(); await tick(c); } }

// ---- action executors ---------------------------------------------------------------------------------------
async function doTalkWarrior(c: Ctx): Promise<boolean> {
    if (!(await walkTo(c, LC_AT.WARRIOR.x, LC_AT.WARRIOR.z))) return false;
    const ok = await talkTo(c, LC_IDS.WARRIOR);
    if (ok && !c.k.oracleDone && journal(c.bot) === 'IN_PROGRESS') { raise(c.k, LC_STAGE.STARTED); c.k.oracleDone = true; log(c, 'warrior: no stage line recognised — journal yellow, assuming >= started'); }
    return ok;
}
async function doFindShamus(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    for (let a = 0; a < 4 && !stopped(c); a++) {
        if (c.k.lb >= LC_STAGE.SPOKEN_SHAMUS) return true;
        if (!nearestNpc(bot, [LC_IDS.SHAMUS])) {
            if (!(await walkTo(c, LC_AT.LEP_STAND.x, LC_AT.LEP_STAND.z))) return false;
            bot.opLoc(LC_LOC.LEP_TREE.x, LC_LOC.LEP_TREE.z, LC_LOC.LEP_TREE.id, 1);
            for (let w = 0; w < 8 && !nearestNpc(bot, [LC_IDS.SHAMUS]); w++) await tick(c);
            if (c.k.noAxe) return false;
        }
        if (nearestNpc(bot, [LC_IDS.SHAMUS])) await talkTo(c, LC_IDS.SHAMUS, 120);
    }
    return c.k.lb >= LC_STAGE.SPOKEN_SHAMUS;
}
async function doGetKnife(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (!(await walkTo(c, LC_AT.KNIFE.x, LC_AT.KNIFE.z))) return false;
    for (let w = 0; w < 300 && !stopped(c); w++) {   // the spawn may be taken: wait for its respawn
        if (bot.countOf(LC_IDS.KNIFE) > 0) return true;
        if (bot.backpackSlots().length >= 28) { log(c, 'getKnife: pack full — cannot pick up the knife (stash first)'); return false; }
        if (await loot(c, new Set([LC_IDS.KNIFE]), 10)) return true;
        await tick(c);
    }
    return bot.countOf(LC_IDS.KNIFE) > 0;
}
/** Bank everything but the kit at Draynor (worn items first: the bank modal hides the worn tab). */
async function doStash(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    for (let a = 0; a < 40 && !stopped(c); a++) {
        const worn = (bot.wornSlots?.() ?? []).map((w: any) => w.obj).filter((id: number) => !KIT.has(id));
        if (worn.length) {
            if (bot.mainModalId === BANK_MAIN) { await closeModal(c); continue; }
            if (28 - bot.backpackSlots().length < 1) {   // full pack: bank first, unequip after
                if (!(await openBank(c, LC_AT.DRAYNOR))) return false;
                const sl = bot.backpackSlots().find((s: any) => !KIT.has(s.obj));
                if (sl) { bot.invButton(4, sl.obj, sl.slot, BANK_SIDE_INV); await tick(c); await tick(c); continue; }
                return false;
            }
            log(c, `stash: unequipping ${worn[0]}`); bot.unequipItem(worn[0]); await tick(c); await tick(c); continue;
        }
        const sl = bot.backpackSlots().find((s: any) => !KIT.has(s.obj));
        if (!sl) { await closeModal(c); return true; }
        if (!(await openBank(c, LC_AT.DRAYNOR))) return false;
        log(c, `stash: banking ${sl.obj}`); bot.invButton(4, sl.obj, sl.slot, BANK_SIDE_INV); await tick(c); await tick(c);
    }
    return false;
}
async function doSail(c: Ctx): Promise<boolean> {
    const bot = c.bot; const leg = ENTRANA_LEGS.toEntrana;
    if (!(await walkTo(c, leg.dock.x, leg.dock.z))) return false;
    for (let a = 0; a < 4 && !stopped(c); a++) {
        if (lcRegion(plane(bot), bot.tile().x, bot.tile().z) !== 'main') return true;
        await talkTo(c, leg.npcs[0], 80);
        for (let w = 0; w < 20 && lcRegion(plane(bot), bot.tile().x, bot.tile().z) === 'main'; w++) await tick(c);
    }
    return lcRegion(plane(bot), bot.tile().x, bot.tile().z) !== 'main';
}
async function doDisembark(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    const leg = Object.values(ENTRANA_LEGS).find(l => cheb(bot.tile(), l.arrival) <= 6)!;
    for (let a = 0; a < 20 && !stopped(c) && plane(bot) === 1; a++) {
        const me = bot.tile();
        if (me.x !== leg.step.x || me.z !== leg.step.z) { bot.sendMove(leg.step.x, leg.step.z, true); await tick(c); await tick(c); continue; }
        bot.opLoc(leg.plank.x, leg.plank.z, leg.plank.loc, 1);
        for (let w = 0; w < 5 && plane(bot) === 1; w++) await tick(c);
    }
    return plane(bot) === 0;
}
async function doEnterDungeon(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    for (let a = 0; a < 4 && !stopped(c); a++) {
        if (lcRegion(plane(bot), bot.tile().x, bot.tile().z) === 'dungeon') return true;
        if (!(await walkTo(c, LC_AT.ENT_LADDER_STAND.x, LC_AT.ENT_LADDER_STAND.z))) return false;
        bot.opLoc(LC_LOC.ENT_LADDER.x, LC_LOC.ENT_LADDER.z, LC_LOC.ENT_LADDER.id, 1);
        for (let w = 0; w < 60 && !stopped(c); w++) { await tick(c); if (bot.tile().z > 9000) break; }   // the monk's 3 pages + choice
    }
    return lcRegion(plane(bot), bot.tile().x, bot.tile().z) === 'dungeon';
}
async function doGetAxe(c: Ctx): Promise<boolean> {
    const bot = c.bot; const axes = new Set(LC_IDS.AXES);
    const held = () => LC_IDS.AXES.some(a => bot.countOf(a) > 0);
    if (await loot(c, axes, 4)) return true;
    if (cheb(bot.tile(), LC_AT.ZOMBIES) > 8) await walkTo(c, LC_AT.ZOMBIES.x, LC_AT.ZOMBIES.z, 300);
    for (let kills = 0; kills < 15 && !stopped(c) && !held(); kills++) {
        if (28 - bot.backpackSlots().length < 1) { const s = bot.backpackSlots().find((x: any) => x.obj === LC_IDS.SHARK); if (s) { bot.dropItem(s.obj, s.slot); await tick(c); } }
        const r = await fight(c, [LC_IDS.ZOMBIE], () => held() || !!bot.findGroundItem?.(axes, 14), 'zombie', 300);
        if (r === 'fled') return false;
        if (await loot(c, axes, 30)) return true;
        if (r === 'gone') await walkTo(c, LC_AT.ZOMBIES.x, LC_AT.ZOMBIES.z, 200);
    }
    return held();
}
/** Chop the dramen tree: the first op at spoken_shamus spawns the spirit (fight it), then one branch per op. */
async function doChop(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (!(await walkTo(c, LC_AT.TREE_STAND.x, LC_AT.TREE_STAND.z))) return false;
    const before = bot.countOf(LC_IDS.BRANCH);
    if (28 - bot.backpackSlots().length < 1) { const s = bot.backpackSlots().find((x: any) => x.obj === LC_IDS.SHARK); if (s) { bot.dropItem(s.obj, s.slot); await tick(c); } }
    bot.opLoc(LC_LOC.DRAMEN_TREE.x, LC_LOC.DRAMEN_TREE.z, LC_LOC.DRAMEN_TREE.id, 1);
    for (let w = 0; w < 10 && !stopped(c); w++) {
        await tick(c);
        if (bot.countOf(LC_IDS.BRANCH) > before) { raise(c.k, LC_STAGE.SPIRIT_DEFEATED); c.o.store?.save({ lb: c.k.lb }); return true; }
        if (c.k.wcLow || c.k.noAxe) return false;
        if (nearestNpc(bot, [LC_IDS.SPIRIT])) {
            raise(c.k, LC_STAGE.SPOKEN_SHAMUS);
            const sp = nearestNpc(bot, [LC_IDS.SPIRIT])!;
            log(c, `the Tree spirit is here (#${sp.index} @ ${sp.x},${sp.z}) — fighting`);
            // ROUTED from the start: the spirit spawns N of the tree (0_44_152_44_9 = (2860,9737)) and its naive chase stops on
            // the N face (2860,9736); from the S stand the server's naive approach is walled by the tree — neither ever reaches.
            // the style the numbers favour for THIS account (lostcity-spirit.ts: aggressive once +3 str crosses a max-hit step)
            const st = lcMeleeStats(bot), odds = spiritWinChance(st, bot.countOf(LC_IDS.SHARK));
            const style = odds?.style ?? 'aggressive';
            log(c, `spirit odds: att ${st.att} str ${st.str} def ${st.def} hp ${st.hp}, ${bot.countOf(LC_IDS.SHARK)} sharks -> P(win) ${odds ? (odds.win * 100).toFixed(1) + '%' : '?'} fighting ${style}`);
            const r = await fight(c, [LC_IDS.SPIRIT], () => c.k.lb >= LC_STAGE.SPIRIT_DEFEATED, 'Tree spirit', 1500, { routed: true, avoid: LC_TREE_FOOTPRINT, styleButton: UNARMED_STYLE_BUTTON[style] });
            if (r === 'won') return true;
            // npc_add(..., tree_spirit, 1000) despawns it after 1000 ticks whatever it is doing; a re-chop (still spoken_shamus)
            // spawns a fresh one. Not a defeat: the stage is NOT raised (a missed defeat line shows as a branch on the next chop).
            log(c, r === 'gone' ? 'the spirit is gone without the defeat line (despawned?) — re-chopping' : `spirit fight ended: ${r}`);
            return false;
        }
    }
    return bot.countOf(LC_IDS.BRANCH) > before;
}
async function doCarve(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    for (let a = 0; a < 6 && !stopped(c) && bot.countOf(LC_IDS.BRANCH) > 0; a++) {
        const k = bot.slotOf(LC_IDS.KNIFE), b = bot.slotOf(LC_IDS.BRANCH); if (k < 0 || b < 0) return false;
        const before = bot.countOf(LC_IDS.STAFF);
        bot.useItemOnItem(LC_IDS.KNIFE, k, LC_IDS.BRANCH, b);
        for (let w = 0; w < 5 && bot.countOf(LC_IDS.STAFF) === before && !c.k.craftLow; w++) await tick(c);
        if (c.k.craftLow) return false;
    }
    return bot.countOf(LC_IDS.BRANCH) === 0;
}
async function doWield(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    for (let a = 0; a < 4 && !bot.isWorn(LC_IDS.STAFF); a++) { const s = bot.slotOf(LC_IDS.STAFF); if (s < 0) return false; bot.opHeld2(LC_IDS.STAFF, s); await tick(c); await tick(c); }
    return !!bot.isWorn(LC_IDS.STAFF);
}
/** Eat sharks (one per 3 ticks, the eat delay) until hp is within one shark (20) of max or the food is gone. */
async function eatUp(c: Ctx, maxTicks = 90): Promise<void> {
    const bot = c.bot;
    for (let t = 0; t < maxTicks && !stopped(c); t++) {
        const hp = bot.hp ?? -1, maxHp = bot.maxHp ?? -1, s = bot.slotOf(LC_IDS.SHARK);
        if (maxHp <= 0 || hp < 0 || s < 0 || hp > maxHp - 20) return;
        if (t % 3 === 0) bot.opHeld1(LC_IDS.SHARK, s);
        await tick(c);
    }
}
/**
 * Strip to the staves (<= 3 items: a death in the wilderness keeps them all), wield one, magic door -> (3250,3772).
 *  (acct9, hard pack pair route): it left the dungeon at hp 59/99 still holding 14 of its 20 sharks (the
 * 30-tick strip did not finish) and died in the wild at (3124,3585) on travelHome. Now: EAT UP first (the sharks are dropped
 * anyway, so turn them into hp), strip with a re-read until only staves remain (up to 90 ticks), and log what is left.
 */
async function doExitDungeon(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (!bot.isWorn(LC_IDS.STAFF) && !(await doWield(c))) return false;
    if (!(await walkTo(c, LC_AT.MAGIC_DOOR_STAND.x, LC_AT.MAGIC_DOOR_STAND.z))) return false;
    await eatUp(c);
    for (let a = 0; a < 90 && !stopped(c); a++) {
        const junk = bot.backpackSlots().filter((s: any) => s.obj !== LC_IDS.STAFF);
        if (!junk.length) break;
        if (a % 2 === 0) for (const j of junk.slice(0, 4)) bot.dropItem(j.obj, j.slot);
        await tick(c);
    }
    const left = bot.backpackSlots().filter((s: any) => s.obj !== LC_IDS.STAFF).length;
    log(c, `exitDungeon: hp ${bot.hp}/${bot.maxHp}, ${left} non-staff stack(s) left before the wilderness`);
    for (let a = 0; a < 5 && !stopped(c); a++) {
        if (lcRegion(plane(bot), bot.tile().x, bot.tile().z) !== 'dungeon') return true;
        bot.opLoc(LC_LOC.MAGIC_DOOR.x, LC_LOC.MAGIC_DOOR.z, LC_LOC.MAGIC_DOOR.id, 1);
        for (let w = 0; w < 6 && lcRegion(plane(bot), bot.tile().x, bot.tile().z) === 'dungeon'; w++) await tick(c);
    }
    return lcRegion(plane(bot), bot.tile().x, bot.tile().z) !== 'dungeon';
}
/**
 * A LOST (or unwinnable) spirit fight is not terminal: walk out by the magic door (the ladder in is one-way) with whatever
 * is left; the mainland gate then fails 'restock'/'train' and the cosmic chain refills + retries. The corridor passes the
 * greater demons (rc-cosmic-geo); a death on the way respawns in Lumbridge with the 3 most valuable items — the same
 * mainland result, sooner. Nothing is dropped: there is no staff to protect yet.
 */
async function doRetreat(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    const out = () => lcRegion(plane(bot), bot.tile().x, bot.tile().z) !== 'dungeon';
    log(c, `retreat: P(win) ${obs(c).spiritWin?.toFixed(3) ?? '?'} with ${bot.countOf(LC_IDS.SHARK)} sharks — leaving by the magic door to restock`);
    if (!(await walkTo(c, LC_AT.MAGIC_DOOR_STAND.x, LC_AT.MAGIC_DOOR_STAND.z))) return out();
    for (let a = 0; a < 5 && !stopped(c) && !out(); a++) {
        bot.opLoc(LC_LOC.MAGIC_DOOR.x, LC_LOC.MAGIC_DOOR.z, LC_LOC.MAGIC_DOOR.id, 1);
        for (let w = 0; w < 6 && !out(); w++) await tick(c);
    }
    return out();
}
async function doTravelHome(c: Ctx): Promise<boolean> {
    const bot = c.bot; const s = ZANARIS.shedStand;
    // long haul out of the wilderness: the multi-level traveller (navgrid; danger-aware), then the exact walk
    // the wild walk eats whatever food is still held ( acct9 died with 14 sharks in the pack)
    let lastEat = -9;
    for (let k = 0; k < 1500 && !stopped(c) && cheb(bot.tile(), s) > 6; k++) {
        if (k === 0 || bot.arrived) bot.startMultiTravel?.(0, s.x, s.z);   // (re)start only when the traveller is idle (rm-driver travelNear)
        const hp = bot.hp ?? -1, maxHp = bot.maxHp ?? -1, fs = bot.slotOf(LC_IDS.SHARK);
        if (maxHp > 0 && hp >= 0 && hp <= Math.floor(maxHp * 0.6) && fs >= 0 && k - lastEat >= 3) {
            bot.opHeld1(LC_IDS.SHARK, fs); lastEat = k;
            if (k % 25 === 0) log(c, `travelHome: eating at hp ${hp}/${maxHp} @ (${bot.tile().x},${bot.tile().z})`);
        }
        if (k % 50 === 0) log(c, `travelHome: hp ${hp}/${maxHp} food ${bot.countOf(LC_IDS.SHARK)} @ (${bot.tile().x},${bot.tile().z})`);
        await tick(c);
    }
    return walkTo(c, s.x, s.z);
}
async function doEnterZanaris(c: Ctx): Promise<boolean> {
    const bot = c.bot; const s = ZANARIS.shedStand, d = ZANARIS.shedDoor;
    for (let a = 0; a < 5 && !stopped(c); a++) {
        if (inZanaris(bot.tile())) break;
        if (inShed(bot.tile())) { await doShedOut(c); continue; }
        if (!bot.isWorn(LC_IDS.STAFF) && !(await doWield(c))) return false;
        if (!(await walkTo(c, s.x, s.z))) return false;
        bot.opLoc(d.x, d.z, d.loc, 1);
        for (let w = 0; w < 6 && !inZanaris(bot.tile()); w++) await tick(c);
    }
    if (!inZanaris(bot.tile())) return false;
    raise(c.k, LC_STAGE.COMPLETE); c.o.store?.save({ lb: c.k.lb });
    log(c, `ZANARIS ENTERED @ (${bot.tile().x},${bot.tile().z}) — Lost City complete`);
    for (let w = 0; w < 4; w++) await tick(c);
    if ((bot.mainModalId ?? -1) !== -1) await closeModal(c);   // the quest-complete scroll
    return true;
}
async function doZanOut(c: Ctx): Promise<boolean> {
    const bot = c.bot; const s = ZANARIS.ladderStand, l = ZANARIS.ladder;
    if ((bot.mainModalId ?? -1) !== -1) await closeModal(c);
    for (let a = 0; a < 5 && !stopped(c) && inZanaris(bot.tile()); a++) {
        if (!(await walkTo(c, s.x, s.z))) return false;
        bot.opLoc(l.x, l.z, l.loc, 1);
        for (let w = 0; w < 6 && inZanaris(bot.tile()); w++) await tick(c);
    }
    return !inZanaris(bot.tile());
}
async function doShedOut(c: Ctx): Promise<boolean> {
    const bot = c.bot; const d = ZANARIS.shedDoor;
    for (let a = 0; a < 5 && !stopped(c) && inShed(bot.tile()); a++) { bot.opLoc(d.x, d.z, d.loc, 1); for (let w = 0; w < 4 && inShed(bot.tile()); w++) await tick(c); }
    return !inShed(bot.tile());
}
/** Varrock East (the crafter's own bank, on its route): bank the spare staves, take the best pickaxe back. */
async function doRestore(c: Ctx): Promise<boolean> {
    const bot = c.bot;
    if (!(await openBank(c, LC_AT.VARROCK_E))) return false;
    for (let w = 0; w < 6 && !bot.invs?.get(BANK_INV); w++) await tick(c);
    for (let a = 0; a < 6 && bot.slotOf(LC_IDS.STAFF) >= 0; a++) { bot.invButton(4, LC_IDS.STAFF, bot.slotOf(LC_IDS.STAFF), BANK_SIDE_INV); await tick(c); await tick(c); }
    if (!LC_IDS.PICKAXES.some(id => bot.countOf(id) > 0 || bot.isWorn(id))) {
        const mining = levelForDisplayedXp(bot.statXp?.[14] ?? 0) || 1;
        const PICK_LEVEL: Record<number, number> = { 1265: 1, 1267: 1, 1269: 6, 1273: 21, 1271: 31, 1275: 41 };
        const pick = LC_IDS.PICKAXES.find(id => (PICK_LEVEL[id] ?? 99) <= mining && bankSlot(bot, id) >= 0);
        if (pick) { log(c, `restore: withdrawing pickaxe ${pick}`); bot.invButton(1, pick, bankSlot(bot, pick), BANK_INV); await tick(c); await tick(c); }
        else log(c, 'restore: no usable pickaxe in the bank (the solo crafter self-heals one at Bob)');
    }
    await closeModal(c);
    c.restored = true;
    return true;
}

function makeCtx(bot: any, o: LcDriveOpts): Ctx {
    const k = newLcKnowledge();
    const saved = o.store?.load(); if (saved && typeof saved.lb === 'number' && saved.lb >= 0) { raise(k, saved.lb); k.oracleDone = saved.lb >= LC_STAGE.STARTED; }
    return { bot, o, k, g: { ...LC_GOAL_DEFAULT, ...(o.goal ?? {}) }, t0: Date.now(), lastTexts: new Map(bot.ifText ?? []), chatSince: (bot.tickCount ?? 0) + 1, seenChat: new Set(), restored: false };
}

/** Drive Lost City to "staff worn, quest complete, out of Zanaris, pickaxe back". Resumable from any point. */
export async function driveLostCity(bot: any, o: LcDriveOpts): Promise<boolean> {
    const c = makeCtx(bot, o);
    bot.foodObj = LC_IDS.SHARK; if (!(bot.healFrac > 0)) bot.healFrac = 0.5; bot.lcFailWhy = '';
    if (!(bot instanceof LostCityBot)) bot.dialogPolicy = LC_DIALOG.map(match => ({ match }));
    bot.travelEnabled = false; bot.arrived = true;
    if (journal(bot) === 'COMPLETE') exact(c.k, LC_STAGE.COMPLETE);
    else if (journal(bot) === 'NOT_STARTED') { capTo(c.k, LC_STAGE.NOT_STARTED); c.k.oracleDone = true; }
    let failures = 0, last = '';
    while (!stopped(c)) {
        observe(c);
        if (dialogOpen(bot)) { await tick(c); continue; }
        const ob = obs(c);
        const act = decideLostCity(ob, c.k, c.g, c.restored);
        bot.lcStage = act.kind;
        if (act.kind !== last) { log(c, `-> ${act.kind} @ (${ob.pos.x},${ob.pos.z},L${ob.pos.level}) region=${ob.region} stage=[${c.k.lb},${c.k.ub}] journal=${ob.journal} staff=${ob.staffWorn ? 'worn' : ob.staffPack} branch=${ob.branch} axe=${ob.axe} food=${ob.food}`); last = act.kind; }
        let ok = true;
        switch (act.kind) {
            case 'done': log(c, `DONE — dramen staff worn, Lost City complete @ (${ob.pos.x},${ob.pos.z})`); return true;
            case 'fail': log(c, `FAIL — ${act.why}`); bot.lcFailWhy = act.why; return false;
            case 'talkWarrior': ok = await doTalkWarrior(c); break;
            case 'findShamus': ok = await doFindShamus(c); break;
            case 'getKnife': ok = await doGetKnife(c); break;
            case 'stash': ok = await doStash(c); break;
            case 'sail': ok = await doSail(c); break;
            case 'disembark': ok = await doDisembark(c); break;
            case 'enterDungeon': ok = await doEnterDungeon(c); break;
            case 'getAxe': ok = await doGetAxe(c); break;
            case 'chop': ok = await doChop(c); break;
            case 'carve': ok = await doCarve(c); break;
            case 'wield': ok = await doWield(c); break;
            case 'exitDungeon': ok = await doExitDungeon(c); break;
            case 'travelHome': ok = await doTravelHome(c); break;
            case 'enterZanaris': ok = await doEnterZanaris(c); break;
            case 'zanOut': ok = await doZanOut(c); break;
            case 'shedOut': ok = await doShedOut(c); break;
            case 'restore': ok = await doRestore(c); break;
            case 'retreat': ok = await doRetreat(c); break;
        }
        if (!ok) { failures++; log(c, `${act.kind} did not succeed (${failures})`); if (failures >= 8) { log(c, 'FAIL — too many failed actions'); return false; } await tick(c); }
        else failures = 0;
    }
    log(c, `stopped/timed out at ${bot.lcStage}`);
    return false;
}

/** @internal test hooks */
export const __lc = { makeCtx, obs, observe, walkTo, talkTo, fight, loot, doTalkWarrior, doFindShamus, doGetKnife, doStash, doGetAxe, doChop, doCarve, doWield, doExitDungeon, doRetreat, doEnterZanaris, doZanOut, doShedOut, doRestore, LC_TREE_FOOTPRINT };

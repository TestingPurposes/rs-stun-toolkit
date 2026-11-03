// =====================================================================================================
// INTERACTION ACKNOWLEDGMENT — the detector for "the client believed it acted, the server ignored it"
// =====================================================================================================
// ⛔ WHY THIS EXISTS. In ONE day this repo produced four instances of the same failure class, and not
// one of them raised an error, dropped a connection, or moved a counter a supervisor was watching:
//
//   1. MOVE_GAMECLICK sent before an interaction silently no-ops the interaction (interactions need
//      MOVE_OPCLICK). Live result: 50 swings, 0 damage, and — the part that makes it invisible — NO
//      "I can't reach that!" message. The server simply discarded the op.
//   2. A blind "click option 1" DECLINED the Al Kharid toll 2,587 times while the bot held 920 gp.
//      The dialog answered perfectly every time; the INTENT (cross the gate) never once happened.
//      Nothing errored and the connection stayed healthy the whole time.
//   3. A blind combat-style triple-click trained attack-only for an hour (outfitter.ts:4-11): the
//      IF_BUTTON was accepted, the tab was not bound, com_mode never moved.
//   4. OPLOC does NOT self-route: from 5 tiles the engine answers "I can't reach that!" every tick and
//      the player never steps. Here the server DID answer — which is a different, and much easier,
//      problem than #1. Telling those two apart is most of this file's value.
//
// THE COMMON SHAPE: a send whose EFFECT is never observed. So the assertion is not "did we send?" but
// "did the server's own state stream move in a way this interaction must move it, within N ticks?"
//
// -----------------------------------------------------------------------------------------------------
// FOUR VERDICTS, AND WHY 'refused' IS NOT 'no_ack'
// -----------------------------------------------------------------------------------------------------
//   ack      — an observable this interaction MUST move, moved. Nothing to say.
//   refused  — the server answered with a KNOWN refusal ("I can't reach that!"). The packet arrived and
//              was understood; the bot is in the wrong place / lacks a requirement. FIXABLE BY THE BRAIN.
//   no_ack   — nothing moved and nothing was said. The op was DISCARDED. Wrong opcode, wrong preceding
//              route, unbound interface. NOT fixable by retrying — and retrying is exactly what every
//              one of the cases above did, thousands of times.
//   unknown  — the observable could not be read (the container this depends on has never arrived). Said
//              LOUDLY and never silently downgraded to either success or failure.
//
// -----------------------------------------------------------------------------------------------------
// COST, BECAUSE THIS RUNS IN THE PACKET LOOP FOR EVERY BOT
// -----------------------------------------------------------------------------------------------------
//   * ONE record per KIND, preallocated at construction. There is no map, no list, no search, no
//     growth, and arming is an O(1) field write into an object that already exists. A bot's whole
//     ledger is `KIND_COUNT` small objects, allocated once, forever.
//   * The observables are INTEGER REVISION COUNTERS the decoder already walks past — `revs[Rev.Msg]++`
//     in the MESSAGE_GAME arm and so on. No scanning, no snapshotting of inventories, no closures.
//   * `arm()` takes POSITIONAL arguments on purpose: an options object would allocate once per
//     interaction, which with many bots is the allocation storm this file is supposed to avoid.
//   * `evaluate()` is one pass over KIND_COUNT slots with an `active` early-out.
//
// -----------------------------------------------------------------------------------------------------
// IT CANNOT WEDGE A BOT — BY CONSTRUCTION
// -----------------------------------------------------------------------------------------------------
// Nothing here blocks, awaits, retries, or sends a packet. `arm()` returns void and `evaluate()` returns
// void; the only outward effect is `host.ackReport(...)`, which the host uses to LOG and to set a
// string field. A brain that never reads that field behaves exactly as it did before this file existed.
// `FB_ACK_ASSERT=0` disables arming entirely (checked once at module load).
//
// REPEATS ARE THE POINT. A second send of the same kind at the same target does NOT re-baseline the
// window — it increments `repeats`. That is what turns "50 swings, 0 damage" from an invisible steady
// state into a single line that says `repeats=50`.

export const ACK_ENABLED = (process.env.FB_ACK_ASSERT ?? '1') !== '0';

const ACK_DEADLINE_SCALE = Math.max(0.25, Number(process.env.FB_ACK_SCALE ?? 1));

/** Ticks between repeated reports of the SAME kind, so a permanently broken send cannot flood a log. */
const ACK_REPORT_COOLDOWN = Number(process.env.FB_ACK_REPORT_COOLDOWN ?? 100);

// =====================================================================================================
// REVISION COUNTERS — the cheap half of the observable set
// =====================================================================================================
// The host owns ONE Int32Array and the decode arms bump it. Every entry answers "has the server said
// anything of this shape since tick T?" without keeping a single byte of history.
export const enum Rev {
    /** any MESSAGE_GAME (chat type 0) */
    Msg = 0,
    /** the MAIN BACKPACK (inv 3214) changed */
    Inv = 1,
    /** ANY container changed — bank, shop, trade side, worn */
    AnyInv = 2,
    /** any UPDATE_STAT */
    Stat = 3,
    /** any VARP_SMALL/VARP_LARGE */
    Varp = 4,
    /** any IF_OPENMAIN / IF_OPENMAIN_SIDE / IF_OPENCHAT / IF_CLOSE */
    Modal = 5,
    /** a hitsplat landed on us or on a tracked npc */
    Hit = 6,
    /** OBJ_ADD / OBJ_DEL / OBJ_COUNT / OBJ_REVEAL */
    Ground = 7,
    /** LOC_ADD_CHANGE / LOC_DEL — a door swung, a tree became a stump */
    Loc = 8,
    /** P_COUNTDIALOG (the bank's amount prompt) */
    CountDlg = 9,
    /** a message matching KNOWN_REFUSALS — the server answered, and said no */
    Refusal = 10,
    /** the WORN container (1688) changed */
    Worn = 11,
}
export const REV_COUNT = 12;

// =====================================================================================================
// OBSERVABLE CHANNELS — what "acknowledged" MEANS for one interaction
// =====================================================================================================
// A kind's mask is an OR: any one channel moving is an acknowledgment. Channels below `VALUE_CHANNELS`
// are pure revision reads; the rest are value comparisons against a baseline captured at arm().
export const enum Ack {
    MSG = 1 << 0,
    INV = 1 << 1,
    ANYINV = 1 << 2,
    STAT = 1 << 3,
    VARP = 1 << 4,
    MODAL = 1 << 5,
    HIT = 1 << 6,
    GROUND = 1 << 7,
    LOC = 1 << 8,
    COUNTDLG = 1 << 9,
    WORNREV = 1 << 10,

    /** backpack count of `wantObj` rose above the baseline */
    OBJ_UP = 1 << 11,
    /** backpack count of `wantObj` fell below the baseline */
    OBJ_DOWN = 1 << 12,
    /** xp in `wantStat` rose */
    XP_UP = 1 << 13,
    /** varp `wantVarp` now reads exactly `wantValue` — the ONLY honest style readback */
    VARP_IS = 1 << 14,
    /** the main modal is exactly `wantValue` */
    MODAL_IS = 1 << 15,
    /** both modals closed */
    MODAL_GONE = 1 << 16,
    /** worn count of `wantObj` rose */
    WORN_UP = 1 << 17,
    /** worn count of `wantObj` fell */
    WORN_DOWN = 1 << 18,
    /** our tile is not the tile we were standing on when the op was sent */
    POS = 1 << 19,
    /** the chat modal id CHANGED (a dialog page advanced, or the dialog closed) */
    DIALOG_ADV = 1 << 20,
}

/** Channels that need a value read from the host rather than a revision counter. */
const VALUE_CHANNELS = Ack.OBJ_UP | Ack.OBJ_DOWN | Ack.XP_UP | Ack.VARP_IS | Ack.MODAL_IS
    | Ack.MODAL_GONE | Ack.WORN_UP | Ack.WORN_DOWN | Ack.POS | Ack.DIALOG_ADV;

// =====================================================================================================
// THE INTERACTION KINDS
// =====================================================================================================
// Names are the SDK's action names wherever one exists, so a reader who knows sdk/actions.ts can predict
// what each one watches.
export const enum AckKind {
    Pickpocket = 0,
    Attack = 1,
    TalkNpc = 2,
    OpLoc = 3,
    OpenDoor = 4,
    ClimbPortal = 5,
    Pickup = 6,
    EatFood = 7,
    BuryBone = 8,
    Equip = 9,
    Unequip = 10,
    BankDeposit = 11,
    BankWithdraw = 12,
    OpenBank = 13,
    ShopBuy = 14,
    ShopSell = 15,
    OpenShop = 16,
    SetStyle = 17,
    SetPrayer = 18,
    DialogChoice = 19,
    PayToll = 20,
    TradeRequest = 21,
    TradeOffer = 22,
    TradeAccept = 23,
    MoveStep = 24,
    CastSpell = 25,
    UseItemOnLoc = 26,
    UseItemOnItem = 27,
    DropItem = 28,
    /** OPNPCU — use a held item ON an npc (a quest hand-in, a talisman on Sedridor). */
    UseItemOnNpc = 29,
    /** INV_BUTTON1/2/3 — the generic transmitted-container button (smith make-N, shop click, bank click,
     *  trade offer). Deliberately the LOOSEST kind in the table: it asks only "did the server react at
     *  all", because that is the only thing true of every caller. See its SPEC entry. */
    InvButton = 30,
}
export const ACK_KIND_COUNT = 31;

export const ACK_KIND_NAME: readonly string[] = [
    'PICKPOCKET', 'ATTACK', 'TALK-NPC', 'OPLOC', 'OPEN-DOOR', 'CLIMB-PORTAL', 'PICKUP', 'EAT-FOOD',
    'BURY-BONE', 'EQUIP', 'UNEQUIP', 'BANK-DEPOSIT', 'BANK-WITHDRAW', 'OPEN-BANK', 'SHOP-BUY',
    'SHOP-SELL', 'OPEN-SHOP', 'SET-STYLE', 'SET-PRAYER', 'DIALOG-CHOICE', 'PAY-TOLL', 'TRADE-REQUEST',
    'TRADE-OFFER', 'TRADE-ACCEPT', 'MOVE-STEP', 'CAST-SPELL', 'USE-ITEM-ON-LOC', 'USE-ITEM-ON-ITEM',
    'DROP-ITEM', 'USE-ITEM-ON-NPC', 'INV-BUTTON',
];

/** Per-kind observable set + how long the server gets to produce it. */
interface KindSpec { mask: number; ticks: number }

// ⛔ THE DEADLINES ARE NOT GUESSES AND THEY ARE NOT UNIFORM. Each one is "the longest a HEALTHY server
// can take to produce this observable", padded, because a deadline shorter than the real latency turns
// this detector into the thing it was built to prevent: a loud signal nobody trusts. The combat one is
// the most generous by far — damage is a fixed pie via an 8-tick npc lock, so a bot at a crowded spot
// can legitimately go many ticks without landing a hit.
const SPEC: readonly KindSpec[] = (() => {
    const s: KindSpec[] = new Array(ACK_KIND_COUNT);
    const set = (k: AckKind, mask: number, ticks: number) => { s[k] = { mask, ticks: Math.max(2, Math.round(ticks * ACK_DEADLINE_SCALE)) }; };

    // A pickpocket ALWAYS answers once it happens: "You attempt to pick...", a steal, a stun, or damage.
    // ⛔ 30 TICKS, RAISED FROM 10 AFTER A LIVE FALSE POSITIVE. OPNPC SELF-ROUTES — the engine walks you
    // to the target before the op runs — so the window has to cover the WALK, not just the steal. At 10
    // ticks a freshly-spawned farmer flagged its very first pickpocket while it was still crossing
    // Lumbridge to reach the man (local run, t13, target 8 tiles away). 30 ticks covers a ~15-tile
    // approach and still names a permanently-silent pickpocket loop within a couple of seconds.
    // + MODAL: OPNPC3 is also Trade on every shopkeeper (betty/aubury op3=Trade, port_sarim.npc,
    // varrock.npc), and a shop answers ONLY with IF_OPENMAIN_SIDE. Without MODAL each shop open logged a false
    // "ACK-NOACK-PICKPOCKET ... DISCARDED" (live acct1/02 at Betty/Aubury, sim rfp1/rfhi1 with buys landing).
    // A real pickpocket never opens a modal unless it also moves STAT. Revert: FB_ACK_OP3_MODAL=0.
    set(AckKind.Pickpocket, Ack.MSG | Ack.STAT | Ack.INV | (process.env.FB_ACK_OP3_MODAL === '0' ? 0 : Ack.MODAL), 30);
    // HIT covers the target's hitsplats, STAT covers every xp grant a swing produces (attack/strength/
    // defence/hitpoints all arrive as UPDATE_STAT, and taking damage moves hp too), MSG covers every
    // single-way-combat refusal the engine emits.
    //
    // ⛔ 50 TICKS, RAISED FROM 25 AFTER A LIVE FALSE POSITIVE. At 25 the local A/B run flagged two
    // windows inside an attack sequence that was demonstrably WORKING (hp xp 15789 -> 15984): the gaps
    // were the bot WALKING to a wandering cow, and a walking bot legitimately produces no hitsplat and
    // no xp. Combat is also a fixed pie via an 8-tick npc lock, so a contended target can be quiet for
    // a while through no fault of the client. 50 ticks is ~12 swings at melee speed — if not one of
    // them moves a hitsplat, an xp counter, or a message, the sends really are going nowhere.
    // ⛔ AND NOT `Ack.POS`, TEMPTING AS IT IS: in the failure this exists to catch, the preceding
    // MOVE_GAMECLICK DID move the player. Position would have acked the very op that was discarded.
    set(AckKind.Attack, Ack.HIT | Ack.STAT | Ack.MSG, 50);
    // OPNPC1 self-routes too, so this window must also cover the walk (see the Pickpocket note).
    set(AckKind.TalkNpc, Ack.MODAL | Ack.DIALOG_ADV | Ack.MSG, 30);
    set(AckKind.OpLoc, Ack.MSG | Ack.INV | Ack.MODAL | Ack.LOC | Ack.STAT | Ack.POS, 20);
    // A door that swings sends LOC_DEL + LOC_ADD_CHANGE for the zone. Nothing else needs to happen.
    set(AckKind.OpenDoor, Ack.LOC | Ack.MSG | Ack.POS, 15);
    // A ladder/trapdoor is a p_telejump — the ONLY proof is that we are somewhere else.
    set(AckKind.ClimbPortal, Ack.POS | Ack.MODAL | Ack.MSG, 20);
    set(AckKind.Pickup, Ack.OBJ_UP | Ack.MSG | Ack.GROUND, 20);
    set(AckKind.EatFood, Ack.OBJ_DOWN | Ack.STAT | Ack.MSG, 12);
    set(AckKind.BuryBone, Ack.OBJ_DOWN | Ack.STAT | Ack.MSG, 12);
    set(AckKind.Equip, Ack.WORN_UP | Ack.MSG, 12);
    set(AckKind.Unequip, Ack.WORN_DOWN | Ack.MSG, 12);
    set(AckKind.BankDeposit, Ack.INV | Ack.ANYINV | Ack.MSG, 12);
    set(AckKind.BankWithdraw, Ack.INV | Ack.ANYINV | Ack.MSG | Ack.COUNTDLG, 12);
    set(AckKind.OpenBank, Ack.MODAL_IS | Ack.MODAL | Ack.MSG, 20);
    set(AckKind.ShopBuy, Ack.INV | Ack.ANYINV | Ack.MSG, 12);
    set(AckKind.ShopSell, Ack.INV | Ack.ANYINV | Ack.MSG, 12);
    set(AckKind.OpenShop, Ack.MODAL_IS | Ack.MODAL | Ack.MSG, 20);
    set(AckKind.SetStyle, Ack.VARP_IS, 8);
    set(AckKind.SetPrayer, Ack.VARP_IS, 8);
    set(AckKind.DialogChoice, Ack.DIALOG_ADV | Ack.MODAL | Ack.MSG, 12);
    // ⛔ THE TOLL. Its observable is deliberately NOT "the dialog advanced" — that is exactly what
    // happened 2,587 times while nothing was achieved. Crossing means COINS LEFT THE PACK or the
    // engine p_teleported us. Nothing else counts.
    set(AckKind.PayToll, Ack.OBJ_DOWN | Ack.POS, 30);
    set(AckKind.TradeRequest, Ack.MODAL | Ack.MSG, 20);
    set(AckKind.TradeOffer, Ack.ANYINV | Ack.MSG, 12);
    set(AckKind.TradeAccept, Ack.MODAL | Ack.ANYINV | Ack.MSG, 20);
    set(AckKind.MoveStep, Ack.POS, 15);
    set(AckKind.CastSpell, Ack.HIT | Ack.STAT | Ack.MSG | Ack.INV, 20);
    set(AckKind.UseItemOnLoc, Ack.INV | Ack.MODAL | Ack.MSG | Ack.STAT, 20);
    set(AckKind.UseItemOnItem, Ack.INV | Ack.MODAL | Ack.MSG | Ack.STAT | Ack.COUNTDLG, 20);
    set(AckKind.DropItem, Ack.INV | Ack.GROUND, 12);
    // OPNPCU self-routes like every other npc op, so the window must cover the WALK (the same lesson
    // that raised Pickpocket 10 -> 30). Every use-on-npc in this repo is a quest hand-in: the answer is
    // a dialog page, an inventory change, an xp grant or a refusal message — one of those, or nothing
    // happened at all.
    set(AckKind.UseItemOnNpc, Ack.MODAL | Ack.DIALOG_ADV | Ack.INV | Ack.STAT | Ack.MSG, 30);
    // ⛔ THE LOOSEST MASK IN THE TABLE, ON PURPOSE. `invButton` is ONE primitive serving four unrelated
    // callers (smith make-N, shop buy/sell, bank deposit/withdraw, trade offer), and a mask narrower
    // than "the server reacted" would be wrong for at least one of them — which is the cry-wolf failure
    // the ACK-UNREACHED verdict exists to prevent. Narrow diagnoses stay where they belong: the callers
    // that KNOW what they clicked (shopBuy, depositItem, ...) arm their own specific kind on top, and
    // this one is the floor under the ones that do not. A click that produces no inv change, no
    // container change, no modal, no count dialog, no xp and no message inside 20 ticks was DISCARDED —
    // and that case is real: quartermaster's driveSell documents a shop that silently refuses an item
    // and a loop that then clicks it forever.
    set(AckKind.InvButton, Ack.INV | Ack.ANYINV | Ack.MODAL | Ack.COUNTDLG | Ack.STAT | Ack.MSG, 20);
    return s;
})();

/** Read-only view of a kind's spec (tests pin these; brains may want the deadline for their own waits). */
export function ackSpec(kind: AckKind): { mask: number; ticks: number } { return SPEC[kind]!; }

// =====================================================================================================
// KNOWN REFUSALS — the messages that mean "received, understood, denied"
// =====================================================================================================
// Matched as lowercase substrings against MESSAGE_GAME, in the decode arm, ONLY when a record is active
// (the host gates it) — so the cost is a handful of `indexOf` calls on the rare ticks a message arrives.
// Anything not on this list is still an ACK via Ack.MSG; it just is not classified as a refusal.
export const KNOWN_REFUSALS: readonly string[] = [
    "i can't reach that",
    "you can't reach that",
    'nothing interesting happens',  // an op with no script behind it
    "you don't have enough inventory space",
    'you do not have enough inventory space',
    'your inventory is too full',
    "you can't take that",
    'someone else is fighting that',
    "i'm already under attack",
    "it's not after you",
    'you do not have enough',      // "...Fire Runes to cast this spell." / "...coins"
    'you need a ',
    'you need to have',
    'you need at least',
    'you must have',
    'you are already',
    'you cannot',
    "you can't",
    'that is already',
    'nothing to steal',
];

/** Does `lowerText` (already lowercased by the caller) look like a server refusal? */
export function isRefusal(lowerText: string): boolean {
    for (let i = 0; i < KNOWN_REFUSALS.length; i++) if (lowerText.includes(KNOWN_REFUSALS[i]!)) return true;
    return false;
}

/**
 * ⛔ 'unreached' IS THE FIFTH VERDICT, AND IT WAS EARNED THE HARD WAY.
 *
 * The first clean live run of this layer reported `ACK-NOACK-` 33 times in 2,548 windows during a run
 * that was otherwise working. Every single one turned out to be the same thing: the bot was
 * 2-4 tiles from a WANDERING man, re-sending OPNPC3 at a tile the man had already left. The sends were
 * not discarded by a broken opcode — they never became deliverable in the first place.
 *
 * Both facts matter, and they are different facts:
 *   * it is REAL — 11 sends and 30 ticks of a bot achieving nothing is a duty-cycle hole worth counting;
 *   * it is NOT the catastrophe — and if it shares the `ACK-NOACK-` name, then the one channel built to
 *     make the catastrophe impossible to miss fires ~1.3% of the time on a healthy run, and within a
 *     week nobody reads it. A signal that cries wolf is worse than no signal.
 * So it gets its own greppable name (`ACK-UNREACHED-`), its own counter, and NO wedge.
 */
export type AckVerdict = 'ack' | 'refused' | 'no_ack' | 'unknown' | 'unreached';

/** What the host receives when a window closes badly. REUSED between reports — read it, do not keep it. */
export interface AckFailure {
    kind: AckKind;
    /** e.g. 'PICKPOCKET'. `ACK-NOACK-${name}` / `ACK-UNKNOWN-${name}` is the greppable wedge string. */
    name: string;
    verdict: AckVerdict;
    /** the tile/npc/loc/obj the interaction named, purely for the human line */
    detail: number;
    detail2: number;
    /** tick the FIRST send of this window went out */
    sentTick: number;
    /** ticks the server was given */
    ticks: number;
    /** how many identical sends went out inside this one silent window — the "50 swings" number */
    repeats: number;
    /** the refusal text, when verdict === 'refused' */
    text: string;
}

/**
 * Everything the ledger needs to read off a bot. All numeric, all O(1).
 *
 * ⛔ A READER THAT CANNOT ANSWER MUST RETURN A NEGATIVE NUMBER, never 0. `ackObjCount` returning 0 for
 * "the inventory has not arrived yet" is indistinguishable from "you hold none", and that ambiguity is
 * how an assertion layer starts lying. A negative reading at arm() time marks the record undecidable,
 * and an undecidable record expires as 'unknown' — loudly — instead of as a fabricated failure.
 */
export interface AckHost {
    readonly ackRevs: Int32Array;
    ackTick(): number;
    /** backpack count of `obj`, or < 0 when the backpack has never been transmitted */
    ackObjCount(obj: number): number;
    /** worn count of `obj`, or < 0 when the worn container has never been transmitted */
    ackWornCount(obj: number): number;
    /** xp in `stat`, or < 0 when unknown */
    ackXp(stat: number): number;
    ackVarp(id: number): number;
    ackMainModal(): number;
    ackChatModal(): number;
    /** a single integer that changes when (and only when) our tile changes */
    ackPosKey(): number;
    /** the most recent KNOWN_REFUSALS text the decoder saw */
    ackRefusalText(): string;
    /**
     * OPTIONAL. "Could this interaction possibly have been carried out by now?" — e.g. for an npc op,
     * are we adjacent to the target? Return `false` only when the precondition is definitively NOT met;
     * `undefined` (or an absent method) means "no opinion", which keeps the old behaviour exactly.
     * Consulted ONLY at the deadline, so it costs nothing in steady state.
     */
    ackDeliverable?(kind: AckKind, detail: number): boolean | undefined;
    /** called at most once per window, only for 'refused' | 'no_ack' | 'unknown' */
    ackReport(f: AckFailure): void;
}

/** One in-flight expectation. Preallocated; fields are overwritten, never reallocated. */
class AckRecord {
    active = false;
    /** the baseline read could not be taken -> expire as 'unknown', never as a failure */
    undecidable = false;
    sentTick = 0;
    deadline = 0;
    repeats = 0;
    detail = 0;
    detail2 = 0;
    wantObj = 0;
    wantStat = -1;
    wantVarp = -1;
    wantValue = 0;
    baseObj = 0;
    baseWorn = 0;
    baseXp = 0;
    basePos = 0;
    baseChatModal = 0;
    /** revision baselines, one per Rev */
    readonly baseRev = new Int32Array(REV_COUNT);
    /** tick of the last report for this kind — the flood guard */
    lastReportTick = -1_000_000;
    /** verdict of the last report; a DIFFERENT verdict always bypasses the cooldown (see report()) */
    lastReportVerdict: AckVerdict | '' = '';
    reports = 0;
}

/**
 * ONE ledger per bot. ONE record per kind: a second send of the same kind at the same target does not
 * open a second window, it increments `repeats` inside the first — which is precisely how a steady
 * state of thousands of ignored sends becomes one readable number.
 */
export class AckLedger {
    private readonly recs: AckRecord[] = [];
    /** the reused failure payload — reporting must not allocate either */
    private readonly failure: AckFailure = {
        kind: 0, name: '', verdict: 'no_ack', detail: 0, detail2: 0, sentTick: 0, ticks: 0, repeats: 0, text: '',
    };

    // ---- counters a status line can read straight off ------------------------------------------------
    armed = 0;
    acked = 0;
    refused = 0;
    noAck = 0;
    unknown = 0;
    /** windows that expired because the interaction never became deliverable (see AckVerdict) */
    unreached = 0;
    readonly unreachedByKind = new Int32Array(ACK_KIND_COUNT);
    /** per-kind no_ack totals — an Int32Array, so a status writer cannot grow it */
    readonly noAckByKind = new Int32Array(ACK_KIND_COUNT);
    readonly refusedByKind = new Int32Array(ACK_KIND_COUNT);
    // ---- per-kind verdict readback --------------------------------------------------------------
    // ⛔ THE TYPED-RESULT HALF OF THIS PACKAGE READS THE SAME LEDGER, ON PURPOSE. A verified action
    // (`attackNpc()`, `pickupItem()`, ...) does not re-derive "did that work?" from its own private
    // watchdog — it waits for THIS record to settle and reports THIS verdict. One mechanism, two
    // consumers: the assertion cannot disagree with the typed result, because they are the same read.
    /** 0 = never, 1 = ack, 2 = refused, 3 = no_ack, 4 = unknown */
    readonly lastVerdict = new Int8Array(ACK_KIND_COUNT);
    readonly lastVerdictTick = new Int32Array(ACK_KIND_COUNT);
    /** the refusal text of the last 'refused' verdict, per kind is overkill — one slot is enough */
    lastRefusalText = '';
    /** `ACK-NOACK-<KIND>` while a kind is failing; '' once every kind is quiet again. */
    wedge = '';
    /** the kind that set `wedge`, or -1 */
    wedgeKind = -1;

    constructor() {
        for (let i = 0; i < ACK_KIND_COUNT; i++) this.recs.push(new AckRecord());
    }

    /** Is a window currently open for this kind? (The host uses it to gate refusal-text capture.) */
    anyActive(): boolean {
        for (let i = 0; i < ACK_KIND_COUNT; i++) if (this.recs[i]!.active) return true;
        return false;
    }

    /** Is THIS kind's window still open? */
    isActive(kind: AckKind): boolean { return this.recs[kind]?.active === true; }

    /**
     * How the last window for `kind` closed. 'pending' while one is open, 'none' if there never was one.
     * `sinceTick` filters out a stale verdict from an earlier attempt — a verified action passes the
     * tick it sent on, so it can never read a previous call's answer as its own.
     */
    verdictOf(kind: AckKind, sinceTick = -1): AckVerdict | 'pending' | 'none' {
        if (this.isActive(kind)) return 'pending';
        const v = this.lastVerdict[kind]!;
        if (v === 0) return 'none';
        if (sinceTick >= 0 && this.lastVerdictTick[kind]! < sinceTick) return 'none';
        return v === 1 ? 'ack' : v === 2 ? 'refused' : v === 3 ? 'no_ack' : v === 4 ? 'unknown' : 'unreached';
    }

    private settle(kind: number, verdict: AckVerdict, now: number): void {
        this.lastVerdict[kind] = verdict === 'ack' ? 1 : verdict === 'refused' ? 2 : verdict === 'no_ack' ? 3
            : verdict === 'unknown' ? 4 : 5;
        this.lastVerdictTick[kind] = now;
    }

    /**
     * Declare an expectation. POSITIONAL args, no options object — this is called once per interaction
     * for every bot in the process, and an object literal here would be the allocation storm.
     *
     * `detail`/`detail2` are only ever printed (npc index, loc id, coords). `wantObj`/`wantStat`/
     * `wantVarp`/`wantValue` feed the value channels of this kind's mask; pass 0/-1 for the ones the
     * kind does not use.
     */
    arm(host: AckHost, kind: AckKind, detail = 0, detail2 = 0,
        wantObj = 0, wantStat = -1, wantVarp = -1, wantValue = 0): void {
        if (!ACK_ENABLED) return;
        const spec = SPEC[kind];
        if (spec === undefined) return;
        const r = this.recs[kind]!;
        const now = host.ackTick();

        // SAME KIND, SAME TARGET, WINDOW STILL OPEN -> this is a REPEAT, not a new expectation. Keeping
        // the original baseline and deadline is what makes the detector fire at all: a brain that
        // re-sends every 2 ticks would otherwise reset its own deadline forever and never trip.
        if (r.active && r.detail === detail && r.detail2 === detail2) { r.repeats++; return; }

        r.active = true;
        r.undecidable = false;
        r.sentTick = now;
        r.deadline = now + spec.ticks;
        r.repeats = 1;
        r.detail = detail;
        r.detail2 = detail2;
        r.wantObj = wantObj;
        r.wantStat = wantStat;
        r.wantVarp = wantVarp;
        r.wantValue = wantValue;
        for (let i = 0; i < REV_COUNT; i++) r.baseRev[i] = host.ackRevs[i]!;
        r.basePos = host.ackPosKey();
        r.baseChatModal = host.ackChatModal();
        const mask = spec.mask;
        if ((mask & (Ack.OBJ_UP | Ack.OBJ_DOWN)) !== 0) {
            r.baseObj = host.ackObjCount(wantObj);
            if (r.baseObj < 0) r.undecidable = true;
        }
        if ((mask & (Ack.WORN_UP | Ack.WORN_DOWN)) !== 0) {
            r.baseWorn = host.ackWornCount(wantObj);
            if (r.baseWorn < 0) r.undecidable = true;
        }
        if ((mask & Ack.XP_UP) !== 0) {
            r.baseXp = host.ackXp(wantStat);
            if (r.baseXp < 0) r.undecidable = true;
        }
        this.armed++;
    }

    /** Give up on a kind without a verdict (the brain abandoned the intent — e.g. the target died). */
    disarm(kind: AckKind): void {
        const r = this.recs[kind];
        if (r && r.active) { r.active = false; this.clearWedge(kind); }
    }

    /** Drop every open window (a reconnect / teleport invalidates all baselines at once). */
    reset(): void {
        for (let i = 0; i < ACK_KIND_COUNT; i++) this.recs[i]!.active = false;
        this.wedge = ''; this.wedgeKind = -1;
    }

    /**
     * ONE pass, once per server tick, at the host's single choke point. Never sends, never throws out
     * of the host's control, never blocks.
     */
    evaluate(host: AckHost): void {
        if (!ACK_ENABLED) return;
        const now = host.ackTick();
        const revs = host.ackRevs;
        for (let k = 0; k < ACK_KIND_COUNT; k++) {
            const r = this.recs[k]!;
            if (!r.active) continue;
            const mask = SPEC[k]!.mask;

            // ⛔ ORDER IS LOAD-BEARING, AND THE OBVIOUS ORDER IS WRONG. Almost every kind accepts
            // Ack.MSG ("the server said something") as an acknowledgment, so checking `satisfied` first
            // makes "I can't reach that!" ACK the very interaction it just refused — which is how the
            // OPLOC-does-not-self-route case would have been reported as a success. So: settle every
            // NON-MESSAGE channel first, then classify a refusal, and only then let a bare message
            // count as an ack. Sim-caught while writing interaction-ack.test.ts.
            if (this.satisfied(host, r, mask & ~Ack.MSG, revs)) {
                r.active = false;
                this.acked++;
                this.settle(k, 'ack', now);
                this.clearWedge(k);
                continue;
            }
            // The server ANSWERED and said no. Different problem, different fix, different verdict.
            if (revs[Rev.Refusal]! > r.baseRev[Rev.Refusal]!) {
                r.active = false;
                this.refused++;
                this.refusedByKind[k]!++;
                this.lastRefusalText = host.ackRefusalText();
                this.settle(k, 'refused', now);
                this.report(host, r, k, 'refused', this.lastRefusalText, now);
                continue;
            }
            // No refusal, so a plain message now counts: the server engaged with us somehow.
            if ((mask & Ack.MSG) !== 0 && revs[Rev.Msg]! > r.baseRev[Rev.Msg]!) {
                r.active = false;
                this.acked++;
                this.settle(k, 'ack', now);
                this.clearWedge(k);
                continue;
            }
            if (now >= r.deadline) {
                r.active = false;
                // NEVER BECAME DELIVERABLE -> its own verdict, its own name, no wedge. See AckVerdict.
                if (host.ackDeliverable?.(k, r.detail) === false) {
                    this.unreached++;
                    this.unreachedByKind[k]!++;
                    this.settle(k, 'unreached', now);
                    this.report(host, r, k, 'unreached', '', now);
                    continue;
                }
                if (r.undecidable) {
                    this.unknown++;
                    // UNKNOWN IS A WEDGE STATE TOO. The brief for this layer is explicit: if it cannot
                    // decide, it must say so LOUDLY rather than block — and "loudly" has to mean the
                    // supervisor's channel, not just a log line that scrolls away. (Without this the
                    // host's mirror of `wedge` cleared an ACK-UNKNOWN on the very next tick.)
                    this.wedge = `ACK-UNKNOWN-${ACK_KIND_NAME[k]}`;
                    this.wedgeKind = k;
                    this.settle(k, 'unknown', now);
                    this.report(host, r, k, 'unknown', '', now);
                } else {
                    this.noAck++;
                    this.noAckByKind[k]!++;
                    this.wedge = `ACK-NOACK-${ACK_KIND_NAME[k]}`;
                    this.wedgeKind = k;
                    this.settle(k, 'no_ack', now);
                    this.report(host, r, k, 'no_ack', '', now);
                }
            }
        }
    }

    /** Any channel in `mask` that moved counts. Revision channels first — they are the cheap ones. */
    private satisfied(host: AckHost, r: AckRecord, mask: number, revs: Int32Array): boolean {
        if ((mask & Ack.MSG) !== 0 && revs[Rev.Msg]! > r.baseRev[Rev.Msg]!) return true;
        if ((mask & Ack.INV) !== 0 && revs[Rev.Inv]! > r.baseRev[Rev.Inv]!) return true;
        if ((mask & Ack.ANYINV) !== 0 && revs[Rev.AnyInv]! > r.baseRev[Rev.AnyInv]!) return true;
        if ((mask & Ack.STAT) !== 0 && revs[Rev.Stat]! > r.baseRev[Rev.Stat]!) return true;
        if ((mask & Ack.VARP) !== 0 && revs[Rev.Varp]! > r.baseRev[Rev.Varp]!) return true;
        if ((mask & Ack.MODAL) !== 0 && revs[Rev.Modal]! > r.baseRev[Rev.Modal]!) return true;
        if ((mask & Ack.HIT) !== 0 && revs[Rev.Hit]! > r.baseRev[Rev.Hit]!) return true;
        if ((mask & Ack.GROUND) !== 0 && revs[Rev.Ground]! > r.baseRev[Rev.Ground]!) return true;
        if ((mask & Ack.LOC) !== 0 && revs[Rev.Loc]! > r.baseRev[Rev.Loc]!) return true;
        if ((mask & Ack.COUNTDLG) !== 0 && revs[Rev.CountDlg]! > r.baseRev[Rev.CountDlg]!) return true;
        if ((mask & Ack.WORNREV) !== 0 && revs[Rev.Worn]! > r.baseRev[Rev.Worn]!) return true;
        if ((mask & VALUE_CHANNELS) === 0) return false;

        if ((mask & Ack.POS) !== 0 && host.ackPosKey() !== r.basePos) return true;
        if ((mask & Ack.DIALOG_ADV) !== 0 && host.ackChatModal() !== r.baseChatModal) return true;
        if ((mask & Ack.MODAL_IS) !== 0 && host.ackMainModal() === r.wantValue) return true;
        if ((mask & Ack.MODAL_GONE) !== 0 && host.ackMainModal() === -1 && host.ackChatModal() === -1) return true;
        if ((mask & Ack.VARP_IS) !== 0 && host.ackVarp(r.wantVarp) === r.wantValue) return true;
        if ((mask & (Ack.OBJ_UP | Ack.OBJ_DOWN)) !== 0) {
            const n = host.ackObjCount(r.wantObj);
            if (n >= 0) {
                if ((mask & Ack.OBJ_UP) !== 0 && n > r.baseObj) return true;
                if ((mask & Ack.OBJ_DOWN) !== 0 && n < r.baseObj) return true;
            }
        }
        if ((mask & (Ack.WORN_UP | Ack.WORN_DOWN)) !== 0) {
            const n = host.ackWornCount(r.wantObj);
            if (n >= 0) {
                if ((mask & Ack.WORN_UP) !== 0 && n > r.baseWorn) return true;
                if ((mask & Ack.WORN_DOWN) !== 0 && n < r.baseWorn) return true;
            }
        }
        if ((mask & Ack.XP_UP) !== 0) {
            const x = host.ackXp(r.wantStat);
            if (x >= 0 && x > r.baseXp) return true;
        }
        return false;
    }

    /** A kind going quiet clears the wedge it set — the wedge is a LIVE state, not a tombstone. */
    private clearWedge(kind: number): void {
        if (this.wedgeKind === kind) { this.wedge = ''; this.wedgeKind = -1; }
    }

    private report(host: AckHost, r: AckRecord, kind: number, verdict: AckVerdict, text: string, now: number): void {
        r.reports++;
        // FLOOD GUARD: always report the first, then at most one per cooldown per kind. A permanently
        // broken send must be visible without burying every other line in the log.
        //
        // ⛔ A CHANGE OF VERDICT ALWAYS GETS THROUGH, AND THAT CLAUSE IS NOT COSMETIC. Without it a
        // harmless `unreached` silences a genuine `no_ack` that lands inside the same cooldown — which
        // is exactly what happened on the final live run: the counter said `noack=1` and there was no
        // line in the log to go with it. A flood guard that can hide an ESCALATION is a bug, not a
        // guard; the whole point of the layer is that the catastrophic case cannot be missed.
        if (r.reports > 1 && verdict === r.lastReportVerdict && now - r.lastReportTick < ACK_REPORT_COOLDOWN) return;
        r.lastReportTick = now;
        r.lastReportVerdict = verdict;
        const f = this.failure;
        f.kind = kind; f.name = ACK_KIND_NAME[kind] ?? String(kind);
        f.verdict = verdict; f.detail = r.detail; f.detail2 = r.detail2;
        f.sentTick = r.sentTick; f.ticks = now - r.sentTick; f.repeats = r.repeats; f.text = text;
        try { host.ackReport(f); } catch { /* the assertion layer must never break the bot */ }
    }

    /** Compact one-line summary for a status writer. '' when nothing has ever gone wrong. */
    summary(): string {
        if (this.noAck === 0 && this.refused === 0 && this.unknown === 0 && this.unreached === 0) return '';
        const parts: string[] = [];
        if (this.noAck > 0) {
            const worst: string[] = [];
            for (let i = 0; i < ACK_KIND_COUNT; i++) if (this.noAckByKind[i]! > 0) worst.push(`${ACK_KIND_NAME[i]}x${this.noAckByKind[i]}`);
            parts.push(`noack=${this.noAck}[${worst.join(' ')}]`);
        }
        if (this.refused > 0) parts.push(`refused=${this.refused}`);
        if (this.unknown > 0) parts.push(`ackUnknown=${this.unknown}`);
        // A duty-cycle number, not a fault: "windows where the bot never got close enough to act".
        if (this.unreached > 0) parts.push(`unreached=${this.unreached}`);
        return parts.join(' ');
    }
}

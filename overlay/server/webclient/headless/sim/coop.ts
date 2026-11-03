// Multi-player co-op simulator: N REAL bots (unmodified LeanBot subclasses, their actual run()
// decode loops) share ONE offline world that models the engine's TRADE and BANK semantics — the two
// systems where hand-offs between bots go wrong (offer ratchets, receive gates, withdraw
// loops). Movement reuses SimEntity (the verbatim takeStep port); trade is ported line-by-line from
// server/content/scripts/interface_trade/scripts/trade.rs2 (every rule cited); the bank mirrors the
// live contract proven in noted-bank-test.ts (modal 5292, invs 5382/2006, note-mode varp resetting
// on open, P_COUNTDIALOG/RESUME dance, cert id = unnoted+1).
//
// FIDELITY LIMITS (honest list — see trade.test.ts's header for the full comparison):
//   - no viewDistance collapse / 250-player BuildArea semantics (crowds are a live-only concern)
//   - no combat, no skilling, no loc respawn (same as the base sim)
//   - busy = "any main modal open" (the engine's .busy also covers queued scripts/delays)
//   - displaynames are toScreenName(name) — the capitalisation trap IS modelled
import { readFileSync } from 'fs';
import JString from '#/datastruct/JString.js';
import Isaac from '#/io/Isaac.js';
import { ClientProt } from '#/io/ClientProt.js';
import { SimEntity, SimWorld, openField, type SimNpc, type CanTravelFn, type SimEvent } from './world.ts';
import { DIALOG_ROOT_BY_ID, STYLE_BUTTON_LOOKUP, STYLE_INTERFACE, VARP } from '../capability-tables.ts';
import { unarmedProfile, type MeleeStyle } from '../lostcity-spirit.ts';
import { ServerPacketStream, ClientActionParser, dirCode, type ClientAction, type PeerTickUpdate, type NpcTickUpdate } from './protocol.ts';

// ---- interface/inv com ids (component.sym; mirrored from leanbot.ts constants) --------------------
const TRADEMAIN = 3323, TRADESIDE_INV = 3322, TRADEMAIN_INV = 3415, TRADEMAIN_OTHERINV = 3416;
const TRADEMAIN_ACCEPT = 3420, TRADECONFIRM = 3443, TRADECONFIRM_ACCEPT = 3546;
const BANK_MAIN = 5292, BANK_INV = 5382, BANK_SIDE_INV = 2006, INV_INTERFACE = 3214;
const WORN_INV = 1688;   // wornitems:wear
const WEARPOS = ['hat', 'back', 'front', 'rhand', 'torso', 'lhand', 'arms', 'legs', 'head', 'hands', 'feet', 'jaw', 'ring', 'quiver'];
/** Engine wearpos names only (wearpos.constant). FIDELITY FIX ( sim review): 15 test registrations used 'righthand'
 *  (+ 'body', 'shield') — names NOT in WEARPOS, so the worn item was never transmitted and the BOT could not see its own
 *  equipment (isWorn false), unlike live. Aliases normalise here; anything else unknown throws. */
const WEARPOS_ALIAS: Record<string, string> = { righthand: 'rhand', lefthand: 'lhand', shield: 'lhand', body: 'torso', helmet: 'hat' };
export function normWearpos(pos: string): string {
    const p = WEARPOS_ALIAS[pos] ?? pos;
    if (!WEARPOS.includes(p)) throw new Error(`unknown wearpos '${pos}' (one of ${WEARPOS.join(' ')})`);
    return p;
}
const BANK_NOTE_ON = 5386, BANK_NOTE_OFF = 5387;
// The engine's BuildArea player cap (build.ts: PREFERRED_PLAYERS). A viewer gathers at most this many
// players, NEAREST-first, and gathering is LEVEL-SCOPED (map.zone(zoneX, y, zoneZ) — same plane). So in a
// crowd larger than the cap a peer beyond the 250 nearest never renders (findPlayerIndexByName misses it,
// so a trade with it can't even start), and an upper floor never sees the ground-floor crowd.
const PREFERRED_PLAYERS = 250;
const COINS = 995;
// THE TANNER (Ellis, area_alkharid/scripts/tanner.rs2; ids from content/pack/interface.pack, rev 289)
const TANNER_MAIN = 679, TAN_SOFT_ALL = 8686, TAN_HARD_ALL = 8690, TAN_SOFT_ONE_TEXT = 8689, TAN_HARD_ONE_TEXT = 8693;
const COW_HIDE = 1739, SOFT_LEATHER = 1741, HARD_LEATHER = 1743;
const MAX_INT = 2147483647;

type Slot = { id: number; count: number } | null;
// A quest step's observable CONTRACT (see registerQuest). `pages` = continue-clicks before the
// effect; `choicePage`/`choiceRoot`/`expectChoice` model a p_choiceN branch mid-dialog.
export interface QuestStep {
    npc: number; op: 'talk' | 'use'; useItem?: number;
    varp: number; whenState: number; toState: number;
    requireItem?: number; delItem?: number; addItem?: number;
    pages: number; choicePage?: number; choiceRoot?: number; expectChoice?: number;
    /**
     * THE JOURNAL CHANNEL. When set, applying this step also emits the `IF_SETCOLOUR` the real
     * `~send_quest_progress_colour` / `~send_quest_complete` emit (quests.rs2:5-13, 50) on this
     * questlist component. Without it a sim can never exercise a completion check for the 60 quests
     * whose progress varp does NOT transmit — which is every quest but Tai Bwo Wannai Trio, including
     * Druidic Ritual, whose reward is XP and therefore has no item to watch.
     * `complete` is the quest's own `^<q>_complete` threshold (green at or above it).
     */
    journalComponent?: number; journalComplete?: number;
    /**
     * DIALOG-GATED SHOP. Some keepers open their shop only from a talk dialog branch, e.g. Bob's
     * Axes (bob.rs2: [opnpc1,bob] -> p_choice3 -> option 2 "Have you anything to sell?" -> ~openshop_activenpc).
     * When set, the effect of this step opens the shop of the NPC that was talked to (addShop'd) instead of
     * closing the dialog. Use varp/whenState/toState of an unused varp to make it repeatable.
     */
    openShop?: boolean;
    /** Option LABELS for the choice page (engine: if_settext(multiN:com_i) before the choice opens). Lets a bot
     *  that reads the offered options (dialogOptions()) be tested — e.g. Aubury's options reveal the quest state. */
    choiceLabels?: string[];
    /** NPC line per page index (engine: chatnpc -> if_settext on the chat component, then IF_OPENCHAT). */
    pageTexts?: string[];
    /** Effect = move the player (e.g. Aubury's essence-mine teleport, aubury.rs2 [label,aubury_ess]). */
    teleport?: { x: number; z: number; level?: number };
    /** Effect costs coins/items first (e.g. the Al Kharid toll's `inv_del(inv, coins, 10)`); short = the content's
     *  "not enough money" line, the dialog closes and NOTHING else happens (no teleport). */
    fee?: { obj: number; n: number; shortMsg?: string };
    /** Effect teleport computed from the player AT EFFECT TIME (border_gate.rs2 @pass_toll_gate: 1 tile across from
     *  the player's own x). Wins over `teleport`. */
    teleportFn?: (p: CoopPlayer) => { x: number; z: number; level?: number };
}
/** quests.rs2 colours, rgb24to15 (quest-state.ts JOURNAL_COLOUR). */
const JOURNAL_RED = 31744, JOURNAL_YELLOW = 32736, JOURNAL_GREEN = 992;
const NULL_STEP: QuestStep = { npc: -1, op: 'talk', varp: -1, whenState: -1, toState: -1, pages: 1 };

/** rev-289 combat rolls for a registered fighter npc (registerFighter `combat`): its hp, attack roll, defence roll vs our
 *  damage type, max hit, regen period. e.g. the tree spirit: lostcity-spirit.ts spiritProfile() + SPIRIT.hp. */
export interface FighterCombat { hp: number; atkRoll: number; defRoll: number; maxHit: number; regenTicks?: number }
type OutPacket =
    | { kind: 'msg'; text: string }
    | { kind: 'openmainside'; main: number; side: number }
    | { kind: 'openmain'; com: number }
    | { kind: 'openchat'; com: number }
    | { kind: 'close' }
    | { kind: 'countdialog' }
    | { kind: 'setcolour'; com: number; colour: number }
    | { kind: 'settext'; com: number; text: string }
    | { kind: 'varp'; id: number; value: number };

// tradestatus constants (^tradestatus_*): reset=0, received=1, pending_accept=2, accept=3,
// pending_confirm=4. Order inferred from trade.rs2's guards; only equality is ever tested.
const TS_RESET = 0, TS_RECEIVED = 1, TS_PENDING_ACCEPT = 2, TS_ACCEPT = 3, TS_PENDING_CONFIRM = 4;

// A climbable/telejump loc (ladder, staircase, trapdoor). OPLOC on it -> the engine self-routes the
// player adjacent, then p_telejumps to dest (possibly another plane / the z+6400 underground). This is
// the sim model the multi-level follower (LeanBot.mlDrive) is tested against.
// TWO-STAGE locs (trapdoor/manhole): set `altLocId` — op1 on `locId` while CLOSED opens it (loc_change:
// the id at the tile SWAPS), op1 on `altLocId` while OPEN telejumps; a mismatched id is IGNORED
// (server-faithful: World.getLoc misses). `size` = footprint (2x2 staircases operate from cheb<=2).
// `level` is OPTIONAL and defaults to "any plane". Declare it only when TWO portals share a tile on
// DIFFERENT planes — which is exactly the shape of a real ladder shaft: the Ardougne trade-room chain
// puts Climb-up (1750) and Climb-down (1749) both at (2649,3281), one on L1 and one on L2. Without the
// plane the lookup below would hand the L2 climber the L1 portal, see the id disagree and report
// `oploc-id-mismatch` — i.e. it would silently model a bot that can never leave the room.
export interface SimPortal {
    x: number; z: number; locId: number; op: number; dest: { level: number; x: number; z: number };
    level?: number; altLocId?: number; size?: number; open?: boolean;
    /**
     * THE LANDING MIRRORS THE CLIMBER. `dest.x`/`dest.z` are ignored and the player lands on ITS OWN
     * TILE at `dest.level` — a port of `~climb_ladder(movecoord(coord(), 0, ±1, 0))`
     * (server/content/scripts/ladders+stairs/scripts/ladders.rs2), where `coord()` is the PLAYER's
     * coord, not `loc_coord()`.
     *
     * ⛔ WITHOUT THIS THE SIM CANNOT SEE THE BUG THAT MATTERS. A fixed-dest portal teleports every
     * climber to the same tile no matter where it stood, so a brain that climbed from the wrong tile
     * would still arrive on station and the test would pass. Live, that bot lands off-station, is
     * invisible to its trade partner, cannot be reached by the descent watchdog, and earns ZERO
     * forever. Mirroring is what turns "did it climb?" into "did it climb FROM THE RIGHT TILE?".
     */
    mirror?: boolean;
}
/** A scripted loc op: content behaviour a test transcribes from an .rs2 [oploc<op>,<loc>] handler — spawn an
 *  npc, add an item, move a quest varp, telejump by the player's own side of a door (check_axis), print a message.
 *  Consulted after booths/portals/doors; `reach` = Chebyshev range from which the op fires (default 1; a 2x2 tree = 2).
 *  First user: the Zanaris shed door (only a WORN dramen staff telejumps; quest_zanaris.rs2 [oploc1,zanarisdoor]). */
export interface SimLocScript { x: number; z: number; locId: number; op: number; reach?: number; run: (p: CoopPlayer, w: CoopWorld) => void }

// A door LOC the walker must OPLOC open (closed = its tile refuses entry; the follower's stall-repair
// tryOpenDoor is the mechanism under test). DIAGONAL doors swing: opening re-blocks the LEAF tile —
// the wizard-tower corridor mechanic (live-verified tile-by-tile).
export interface SimDoorLoc { x: number; z: number; locId: number; op: number; leaf?: { x: number; z: number }; open: boolean }

/**
 * A WALL door: the door is an EDGE of its tile. The tile itself is walkable from its own
 * side; only the crossing to `beyond` (angle 0=W 1=N 2=E 3=S neighbour) is blocked. The rsmod WASM has every openable
 * door MASKED OPEN, so without this the sim lets anyone walk through a locked quest door.
 * `script: 'open_and_close'` ports [proc,open_and_close_door] (doors/scripts/open_and_close_doors.rs2) as the quest doors
 * call it with `$entering = ~check_axis(coord, loc_coord, loc_angle)`: from the door tile you are teleported to `beyond`,
 * from `beyond` onto the door tile. The door never opens for anyone else (loc_change inviswall, then it reverts).
 * `allow(p)` = the script's gate (e.g. a quest varp); a refused op prints `lockedMsg` and does nothing.
 * The engine self-routes an OPLOC (findPathToLoc) to one of the two op tiles; the op fires there.
 * First user: Nulodion's mcannondoor (loc 3 @ 3015,3453, angle 0) - quest_mcannon/scripts/locs/mcannon_doors.rs2.
 */
export interface SimWallDoor {
    x: number; z: number; angle: 0 | 1 | 2 | 3; locId: number; op: number;
    /** 'open_and_close' = the quest-door walk-through (door stays shut); 'open' = an ordinary door/gate: the op opens it (and every
     *  leaf sharing its `group`, e.g. both halves of a double gate) and the world emits 'door-opened' -> the zone LOC_DEL the
     *  bot's DoorTracker reads. It stays open for the rest of the test (the engine's 500-tick revert is not modelled). */
    script: 'open_and_close' | 'open'; allow?: (p: CoopPlayer) => boolean; lockedMsg?: string; open?: boolean; group?: string;
    /** 'open_and_close' only: the first N ops made from the
     *  `beyond` side do NOT pass — each one deletes a suit-of-armour loc and wakes it ("Suddenly the suit of armour comes to
     *  life!") and RETURNS. Decremented per op; 'suit-woke' is emitted. The npc fight itself is not modelled. */
    wakeFromBeyond?: number;
}
export function wallDoorBeyond(d: { x: number; z: number; angle: number }): { x: number; z: number } {
    const o = [[-1, 0], [0, 1], [1, 0], [0, -1]][d.angle]!;
    return { x: d.x + o[0]!, z: d.z + o[1]! };
}
/** Does the single step (x,z)->(x+dx,z+dz) cross this closed wall-door edge? Diagonals: any L-shaped cardinal leg (rsmod). */
export function wallDoorBlocksStep(d: { x: number; z: number; angle: number }, x: number, z: number, dx: number, dz: number): boolean {
    const b = wallDoorBeyond(d);
    const cross = (ax: number, az: number, bx: number, bz: number) =>
        (ax === d.x && az === d.z && bx === b.x && bz === b.z) || (bx === d.x && bz === d.z && ax === b.x && az === b.z);
    if (cross(x, z, x + dx, z + dz)) return true;
    if (dx !== 0 && dz !== 0) {
        return cross(x, z, x + dx, z) || cross(x + dx, z, x + dx, z + dz) || cross(x, z, x, z + dz) || cross(x, z + dz, x + dx, z + dz);
    }
    return false;
}
/**
 * How the ENGINE approaches a player target (Player.pathToPathingTarget, MoveStrategy.SMART: findPathToEntity every tick)
 * and decides it is in range (inOperableDistance -> reachedEntity, rsmod shape -2). Opt-in per world: without it the sim
 * keeps its historic model (naive beeline, cheb<=1 fires). `rsmodPlayerOpModel()` is the real one on the WASM collision.
 */
export interface PlayerOpModel {
    path(level: number, sx: number, sz: number, tx: number, tz: number): Array<{ x: number; z: number }>;
    reached(level: number, sx: number, sz: number, tx: number, tz: number): boolean;
    /** OPLOC on a 1x1 WALL loc (shape 0): the engine self-route (findPathToLoc) and the op range (reachedLoc). */
    wallLocPath(level: number, sx: number, sz: number, lx: number, lz: number, angle: number): Array<{ x: number; z: number }>;
    wallLocReached(level: number, sx: number, sz: number, lx: number, lz: number, angle: number): boolean;
    /** OPNPC approach under clientRoutefinder (MoveStrategy.NAIVE): Player.naivePathToTarget -> rsmod findNaivePath. */
    naivePath?(level: number, sx: number, sz: number, tx: number, tz: number): Array<{ x: number; z: number }>;
}
/**
 * The engine's player-op model on the real rsmod collision, with this world's CLOSED wall doors walled in for the call
 * (the WASM keeps doors masked open for the planners; the engine sees them shut). Needs initPathfinding() first.
 */
export function rsmodPlayerOpModel(world: { wallDoors: SimWallDoor[] }): PlayerOpModel {
    const rsmod = require('../../../vendor/rsmod-pathfinder');
    const walled = <T,>(level: number, fn: () => T): T => {
        const ds = world.wallDoors.filter(d => !d.open);
        for (const d of ds) rsmod.changeWall(d.x, d.z, level, d.angle, 0, true, false, true);
        try { return fn(); } finally { for (const d of ds) rsmod.changeWall(d.x, d.z, level, d.angle, 0, true, false, false); }
    };
    return {
        path: (level, sx, sz, tx, tz) => walled(level, () => {
            const raw: Uint32Array = rsmod.findPath(level, sx, sz, tx, tz, 1, 1, 1, 0, -2, true, 0, 25, 0);
            return Array.from(raw, (w: number) => ({ x: (w >> 14) & 0x3fff, z: w & 0x3fff }));
        }),
        reached: (level, sx, sz, tx, tz) => walled(level, () => rsmod.reached(level, sx, sz, tx, tz, 1, 1, 1, 0, -2, 0)),
        wallLocPath: (level, sx, sz, lx, lz, angle) => walled(level, () => Array.from(rsmod.findPath(level, sx, sz, lx, lz, 1, 1, 1, angle, 0, true, 0, 25, 0) as Uint32Array, (w: number) => ({ x: (w >> 14) & 0x3fff, z: w & 0x3fff }))),
        wallLocReached: (level, sx, sz, lx, lz, angle) => walled(level, () => rsmod.reached(level, sx, sz, lx, lz, 1, 1, 1, angle, 0, 0)),
        naivePath: (level, sx, sz, tx, tz) => walled(level, () => Array.from(rsmod.findNaivePath(level, sx, sz, tx, tz, 1, 1, 1, 1, 0, 0) as Uint32Array, (w: number) => ({ x: (w >> 14) & 0x3fff, z: w & 0x3fff }))),
    };
}

export class CoopPlayer extends SimEntity {
    inv: Slot[] = new Array(28).fill(null);
    tradeoffer: Slot[] = new Array(28).fill(null);
    bank = new Map<number, number>();          // obj id -> count (banks are stackall)
    stats = new Map<number, { xp: number; level: number }>();   // server-side; pushed via updateStat
    worn = new Map<string, { id: number; count: number }>();    // wearpos -> equipped item
    hp = 10; maxHp = 10; combatLevel = 3;
    /** %com_mode (SCOPE_TEMP: 0 after login); set by the style buttons (player_attackstyles.rs2 ~set_attackstyle) */
    comMode = 0;
    /** the xp skill of the style button last pressed (STYLE_INTERFACE styleNames: accurate/aggressive/defensive/controlled) */
    comSkill: 'attack' | 'strength' | 'defence' | 'shared' = 'attack';
    /** %eat_delay clock (consume.rs2): a bite is refused while it is >= the clock (CoopWorld.eatDelayModel) */
    eatClock = -100;
    deaths = 0;
    outStats: number[] = [];                   // stat ids to (re)transmit this tick
    noteMode = false;                          // %bankcert — RESET on every bank open (bank.rs2:19)
    modal = -1;                                // server-side view of the player's open main modal
    /** open CHAT modal held by a paused script (the level-up splash: if_openchat + p_pausebutton), -1 = none */
    chatModal = -1;
    /** ENGINE-queue scripts not yet run (Player.engineQueue). Level-ups land here and only run when !busy(). */
    engineQueue: Array<{ kind: 'levelup'; stat: number }> = [];
    tradePartner = -1;
    tradeStatus = TS_RESET;
    tradeCompleted = false;                    // suppresses "Other player declined trade."
    pendingPlayerOp: number | null = null;     // OPPLAYER4 target world index
    level = 0;                                 // current plane (a portal telejump sets it; PLAYER_INFO teleport carries it)
    filler = false;                            // a crowd-filler peer: counts toward the 250 gather cap but is
                                               // never rendered as a client peer (no bot interacts with it, and
                                               // a 250-add packet overflows PLAYER_INFO). Its ONLY effect is
                                               // consuming budget so a farther real receiver falls outside the cap.
    pendingPortal: { portal: SimPortal; stage: 'open' | 'climb' } | null = null;   // held OPLOC (MOVE clears — clearPendingAction)
    pendingDoor: SimDoorLoc | null = null;     // held OPLOC on a door loc (self-route then open)
    pendingWallDoor: SimWallDoor | null = null;   // held OPLOC on a scripted wall door (self-route to an op tile, then run)
    openShop = -1;                             // keeper npc index of the open shop (modal 3824)
    /** held OPNPC on a modelled npc (the tanner): the engine's Interaction, retried every tick until reached */
    pendingNpcOp: { index: number; op: number } | null = null;
    countPending: { com: number; obj: number; slot: number } | null = null;
    outPre: OutPacket[] = [];                  // script-driven packets (sent BEFORE PLAYER_INFO)
    outLater: Array<{ at: number; pkt: OutPacket & { kind: 'openmain' } }> = [];   // deferred IF_OPENMAIN (see tradeConfirmOpenDelay)
    outInvs = new Set<number>();               // com ids to (re)transmit this tick
    constructor(public index: number, public name: string, x: number, z: number, world: SimWorld) {
        super(x, z, world);
    }
    get displayname(): string { return JString.toScreenName(this.name); }
}

export class CoopWorld extends SimWorld {
    playersByIndex = new Map<number, CoopPlayer>();
    private stackables = new Set<number>([COINS]);
    private notables = new Set<number>();      // ids with a cert counterpart at id+1
    private booths: Array<{ x: number; z: number; locId: number }> = [];
    private portals: SimPortal[] = [];
    simDoors: SimDoorLoc[] = [];

    constructor(canTravel: CanTravelFn = openField(), seed = 42) { super(0, 0, canTravel, seed); }

    addPortal(portal: SimPortal): void { this.portals.push(portal); }
    addSimDoor(d: Omit<SimDoorLoc, 'open'>): SimDoorLoc { const door = { ...d, open: false }; this.simDoors.push(door); return door; }
    wallDoors: SimWallDoor[] = [];
    addWallDoor(d: SimWallDoor): SimWallDoor { this.wallDoors.push(d); return d; }
    /** null = the historic player-op model (naive beeline toward the target, cheb<=1 fires). */
    playerOpModel: PlayerOpModel | null = null;

    // Door/leaf tile blocking layered over the base collision: a CLOSED door's tile refuses entry;
    // an OPEN diagonal door's LEAF tile refuses entry (the swing re-blocks the corridor).
    override canStep(level: number, x: number, z: number, dx: number, dz: number): boolean {
        const tx = x + dx, tz = z + dz;
        for (const w of this.wallDoors) if (!w.open && wallDoorBlocksStep(w, x, z, dx, dz)) return false;   // closed wall doors block their edge
        for (const d of this.simDoors) {
            if (!d.open && d.x === tx && d.z === tz) return false;
            if (d.open && d.leaf && d.leaf.x === tx && d.leaf.z === tz) return false;
        }
        return super.canStep(level, x, z, dx, dz);
    }

    addPlayer(index: number, name: string, x: number, z: number, level = 0): CoopPlayer {
        // Unique-index guard: a duplicate world index silently overwrites an existing player, zeroing a
        // bot mid-test with no error (a real trap — cross-test index reuse cost a debugging session). Fail
        // loudly instead. Crowd fillers start at index 1000 to stay clear of hand-assigned bot indices.
        const existing = this.playersByIndex.get(index);
        if (existing) throw new Error(`CoopWorld.addPlayer: index ${index} already used by "${existing.name}" — every player/filler needs a UNIQUE world index.`);
        const p = new CoopPlayer(index, name, x, z, this);
        p.level = level;
        this.playersByIndex.set(index, p);
        return p;
    }
    // CROWD FILLER — N bare peers (no brain, no stream, never ticked) around (x,z) on `level`. They render
    // into other bots' PLAYER_INFO and count against the 250-player gather cap, so a crowd larger than the
    // cap can hide a trade partner — but cheaply: a 300-crowd test is 300 plain objects, not 300 running bot clients.
    // Packed into a tight 3x3 (players don't block players) so they all sit closer to the anchor than any
    // trade partner placed a few tiles out. Returns the indices used.
    addCrowd(count: number, x: number, z: number, level = 0, startIndex = 1000, namePrefix = 'crowd'): number[] {
        const used: number[] = [];
        for (let i = 0; i < count; i++) {
            const idx = startIndex + i;
            this.addPlayer(idx, `${namePrefix}${i}`, x + (i % 3) - 1, z + ((i / 3 | 0) % 3) - 1, level).filler = true;
            used.push(idx);
        }
        return used;
    }
    addBankBooth(x: number, z: number, locId = 2213) { this.booths.push({ x, z, locId }); }
    /**
     * THE TANNER. `[opnpc3,tanner] -> @tan_leather_choices` (tanner.rs2:41-65): if_settext the
     * x1 buttons, if_openmain(tanner) = 679. "tan ALL" = tanner:com_93 (8686, soft 1 gp) / com_98 (8690, hard 3 gp) ->
     * ~tan_leather: if_close, then min(hides, coins/cost) hides -> leather. The OP is an engine Interaction held until
     * REACHED (rsmod reachedEntity: cardinally adjacent, no wall between). rev 289 runs clientRoutefinder=true, so the player
     * moves NAIVE (Player.naivePathToTarget): it beelines at the npc and a WALL between them just stops it — no "I can't
     * reach that!" (it still has a waypoint), no modal, nothing. That silent hold is exactly the live acct5 wedge
     * (outside the tannery's north wall at (3276,3195), Ellis at (3276,3194) one tile away through the wall).
     */
    tanners = new Set<number>();
    addTanner(npcIndex: number): void { this.tanners.add(npcIndex); }
    /** BANKER NPCs (op3 'Bank' opens the bank from <= 2 tiles, like the Shilo bankers npc 499 bank.rs2 opnpc3; acct20-send.test.ts) */
    bankerNpcs = new Set<number>();
    addBankerNpc(npcIndex: number): void { this.bankerNpcs.add(npcIndex); }
    /** @tan_leather_choices: the x1 labels (the brains probe them), then if_openmain(tanner). */
    protected openTanner(p: CoopPlayer): void {
        p.outPre.push({ kind: 'settext', com: TAN_SOFT_ONE_TEXT, text: '\n\n\n\n\n\nSoft leather: 1 gp' });
        p.outPre.push({ kind: 'settext', com: TAN_HARD_ONE_TEXT, text: '\n\n\n\n\n\nHard leather: 3 gp' });
        p.modal = TANNER_MAIN;
        p.outPre.push({ kind: 'openmain', com: TANNER_MAIN });
        this.emitCoop('tanner-opened', { player: p.name, at: { x: p.x, z: p.z } });
    }
    /** @tan_soft_leather / @tan_hard_leather (inv_total(inv, cow_hide)) -> ~tan_leather (if_close FIRST, then the swap). */
    protected tanAll(p: CoopPlayer, hard: boolean): void {
        const cost = hard ? 3 : 1;
        const hides = this.invTotal(p.inv, COW_HIDE);
        if (hides < 1) { this.msg(p, "You don't have any cowhides to tan."); return; }
        const coins = this.invTotal(p.inv, COINS);
        if (coins < cost) { this.msg(p, `You haven't got enough coins to pay for ${hard ? 'hard' : 'soft'} leather.`); return; }
        const n = Math.min(Math.floor(coins / cost), hides);
        this.closeModalFor(p);
        this.invRemove(p.inv, COW_HIDE, n);
        this.invRemove(p.inv, COINS, n * cost);
        this.invAdd(p.inv, hard ? HARD_LEATHER : SOFT_LEATHER, n);
        p.outInvs.add(INV_INTERFACE);
        this.msg(p, n === 1 ? 'The tanner tans your cowhide.' : `The tanner tans ${n} cowhides for you.`);
        this.emitCoop('tanned', { player: p.name, n, hard, cost: n * cost });
    }
    registerNotable(...ids: number[]) { for (const id of ids) { this.notables.add(id); this.stackables.add(id + 1); } }
    registerStackable(...ids: number[]) { for (const id of ids) this.stackables.add(id); }
    isStackable(id: number): boolean { return this.stackables.has(id); }

    private emitCoop(kind: string, detail: Record<string, unknown> = {}) { this.events.push({ tick: this.tick, kind, detail }); }
    private msg(p: CoopPlayer, text: string) { p.outPre.push({ kind: 'msg', text }); }

    // ---- inventory model (InvOps semantics: stack per type, 1 slot per non-stackable) -------------
    invTotal(inv: Slot[], id: number): number { let n = 0; for (const s of inv) if (s?.id === id) n += s.count; return n; }
    freeSlots(inv: Slot[]): number { return inv.filter(s => s === null).length; }
    invAdd(inv: Slot[], id: number, count: number): number {   // returns how many were actually added
        if (this.isStackable(id)) {
            const s = inv.find(e => e?.id === id);
            if (s) { s.count = Math.min(MAX_INT, s.count + count); return count; }
            const free = inv.indexOf(null);
            if (free < 0) return 0;
            inv[free] = { id, count };
            return count;
        }
        let added = 0;
        for (let i = 0; i < count; i++) {
            const free = inv.indexOf(null);
            if (free < 0) break;
            inv[free] = { id, count: 1 };
            added++;
        }
        return added;
    }
    invRemove(inv: Slot[], id: number, count: number): number {   // by TYPE (inv_moveitem semantics)
        let removed = 0;
        for (let i = 0; i < inv.length && removed < count; i++) {
            const s = inv[i];
            if (!s || s.id !== id) continue;
            const take = Math.min(s.count, count - removed);
            s.count -= take; removed += take;
            if (s.count <= 0) inv[i] = null;
        }
        return removed;
    }

    // ---- one co-op server tick: client input (all players) -> npcs -> per-player op/movement ------
    /**
     * How many climbs ONE ladder may resolve per tick. `Infinity` (default) = the old behaviour.
     *
     * ⛔ THE LIVE FAILURE THIS EXISTS TO REPRODUCE. Three cohorts climbing one ladder to L2:
     *     acct17-11   9/11 climbed (2 failed)
     *     acct19-91  9/16 climbed (7 failed)
     *     acct186-39  6/14 climbed (8 failed)
     * Successes stayed ~6-9 no matter how big the cohort got, and every failure was
     * "could not climb to L2 (stuck on L0)". That is the signature of a SERIALIZED resource: the
     * venue is one ladder, the whole cohort is armed on one tick, and the queue's tail exhausts its
     * budget waiting its turn. A sim where every climb resolves instantly cannot show it.
     */
    portalOpsPerTick = Infinity;
    /**
     * Ticks a ladder is unavailable after resolving a climb. 0 (default) = no cooldown.
     *
     * ⚠️ THIS IS A CALIBRATED MODEL, NOT A PORT. Unlike everything else in this world the engine's real
     * serialization mechanism is NOT known — the live evidence is a flat ceiling of ~6-9 successful
     * ascents per attempt regardless of cohort size, which says "the ladder is serial and slow" without
     * saying why. So this knob exists to make a QUEUE, and tests set it to whatever makes the queue's
     * tail exceed the per-step tick budget. What that proves is the SCHEDULING property (a bounded release
     * keeps every bot inside its budget; an unbounded one starves the tail), which is real and is the
     * fix. It does NOT prove the engine's throughput number — do not read one out of it.
     */
    portalCooldownTicks = 0;
    /**
     * THE TRADEMAIN -> TRADECONFIRM MODAL GAP. trade.rs2:134-135 `if_openmain(tradeconfirm)` runs while trademain +
     * tradeside are open; Player.openMainModal (Player.ts:2049-2053) writes IF_CLOSE *immediately* to drop the side
     * modal, and the IF_OPENMAIN only goes out at NetworkPlayer.encodeOut (NetworkPlayer.ts:171-176). No [if_close]
     * trigger fires (openMainModal never calls closeModal) — the trade is alive — but the client reads
     * mainModalId == -1 in between. Live that gap spans a bot tick (traced in leanbot.ts's modalGoneFor note:
     * "t44: MODAL close (was 3323) / t45: MODAL open=3443"). The IF_CLOSE is always sent (engine-literal);
     * this delays the IF_OPENMAIN by N ticks so a bot that treats "no modal" as "trade over" can be caught
     * offline. 0 = same batch (the pre- behaviour, no observable gap). SIM_TRADE_CONFIRM_GAP=<n> sets
     * the default for a whole suite run (every trade test passes at 1 ).
     */
    tradeConfirmOpenDelay = Number(process.env.SIM_TRADE_CONFIRM_GAP ?? 0);
    private portalOpsThisTick = new Map<string, number>();
    private portalFreeAt = new Map<string, number>();

    coopTick(actionsByPlayer: Map<number, ClientAction[]>): SimEvent[] {
        this.tick++;
        if (this.respawnQueue.length) {
            const due = this.respawnQueue.filter(r => r.at <= this.tick);
            if (due.length) { this.respawnQueue = this.respawnQueue.filter(r => r.at > this.tick); for (const r of due) this.addNpc(r.index, r.typeId, r.x, r.z); }
        }
        this.portalOpsThisTick.clear();
        const before = this.events.length;
        if (this.otherTakes.length) this.applyOtherTakes();
        for (const p of this.playersByIndex.values()) {
            p.resetTransient();
            // deferred IF_OPENMAIN (tradeConfirmOpenDelay): emitted only if that modal is still the server's view
            if (p.outLater.length) {
                const due = p.outLater.filter(l => l.at <= this.tick);
                p.outLater = p.outLater.filter(l => l.at > this.tick);
                for (const l of due) if (p.modal === l.pkt.com) p.outPre.push(l.pkt);
            }
        }
        for (const [idx, actions] of actionsByPlayer) {
            const p = this.playersByIndex.get(idx);
            if (p) for (const a of actions) this.applyAction(p, a);
        }
        for (const npc of this.npcs.values()) npc.resetTransient();
        for (const npc of this.npcs.values()) this.npcTurn(npc);   // wander/patrol movement (renders to viewers)
        this.npcLifecycleTick();
        this.fighterNpcTick();
        this.objSpawnTick();
        this.telegrabTick();
        this.restockShops();
        this.aggroTick();
        this.playerRegenTick();
        for (const p of this.playersByIndex.values()) this.playerTurn(p);
        return this.events.slice(before);
    }

    /**
     * The engine's OpLocUHandler guards (OpLocUHandler.ts) — every failure is a SILENT UnsetMapFlag, no message:
     *   - the use-component must be VISIBLE: a main modal (trade / bank / shop) replaces the backpack (3214)
     *   - the item must be AT the named slot (useInv.hasAt(useSlot, useObj))
     * The sim used to accept any oplocu naming the right obj, so a stale slot or a hidden inventory could
     * not fail here (live, such a bot would use a loc once and then never again).
     * Returns the reason, or null when the engine would accept it.
     */
    oplocuRejected(p: CoopPlayer, a: { obj: number; slot: number; com?: number }): string | null {
        const com = a.com ?? 3214;
        if (com === 3214 && p.modal !== -1) return `component 3214 not visible (main modal ${p.modal} open)`;
        const s = p.inv[a.slot];
        if (!s || s.id !== a.obj) return `obj ${a.obj} not at slot ${a.slot} (slot holds ${s ? s.id : 'nothing'})`;
        return null;
    }
    private rejectOplocu(p: CoopPlayer, a: ClientAction & { type: 'oplocu' }): boolean {
        const why = this.oplocuRejected(p, a);
        if (!why) return false;
        this.emitCoop('oplocu-rejected', { player: p.name, loc: a.locId, obj: a.obj, slot: a.slot, why });
        return true;
    }

    protected applyAction(p: CoopPlayer, a: ClientAction): void {
        // Every OP packet handler runs player.clearPendingAction() -> closeModal(), which also ends a paused chat
        // modal (the level-up splash). Only the MOVE_OPCLICK half of a walk-then-op pair leaves it open (below).
        if (p.chatModal !== -1 && (a.type === 'oploc' || a.type === 'opnpc' || a.type === 'opobj' || a.type === 'opplayer4'
            || a.type === 'oplocu' || a.type === 'opnpcu' || a.type === 'opheld' || a.type === 'opheldu' || a.type === 'opheldt' || a.type === 'opobjt')) {
            this.closeChatModal(p, a.type);
        }
        switch (a.type) {
            case 'move': {
                // MoveClickHandler (rev 289): ONLY a non-opclick MOVE runs clearPendingAction — it CLOSES an open
                // modal (the trade-decline trap) and cancels a held OPPLAYER4/OPLOC. ⛔ REV 289 CHANGE: a MOVE_OPCLICK
                // no longer does (274 cleared on every MOVE): "A MOVE_OPCLICK is always paired with a following op
                // packet that clears+sets the interaction itself". So an opclick walk leaves a level-up/bank/trade
                // modal OPEN, and Player.updateMovement then refuses the walk while busy() with a non-empty queue.
                if (!a.opclick) {
                    if (p.modal !== -1) this.closeModalFor(p);
                    if (p.chatModal !== -1) this.closeChatModal(p, 'move');
                    p.pendingPlayerOp = null;
                    p.pendingPortal = null;   // clearPendingAction cancels a held OPLOC too (the door/portal-thrash trap)
                    p.pendingDoor = null;
                    p.pendingWallDoor = null;
                    p.pendingNpcOp = null;
                } else if (p.modal !== -1 || p.chatModal !== -1) {
                    this.emitCoop('move-opclick-modal-kept', { player: p.name, modal: p.modal, chatModal: p.chatModal });
                }
                p.queueWaypoints(a.path);
                this.emitCoop('move-queued', { player: p.name, path: a.path.length, opclick: a.opclick });
                break;
            }
            case 'opplayer4':
                p.pendingPlayerOp = a.index;
                this.emitCoop('opplayer4-requested', { player: p.name, target: a.index });
                break;
            case 'oploc': {
                const booth = this.booths.find(b => b.x === a.x && b.z === a.z && b.locId === a.locId);
                if (booth && a.op === 2) {
                    if (Math.abs(p.x - a.x) + Math.abs(p.z - a.z) === 1) this.openBank(p);
                    else this.emitCoop('cant-reach', { player: p.name, booth });
                    break;
                }
                // Tile first, then PLANE — and fall back to the tile-only match so every portal
                // registered without a `level` (the whole existing corpus, incl. fidelity.test.ts's
                // 258-portal graph dump) behaves exactly as it did.
                const atTile = this.portals.filter(pt => pt.x === a.x && pt.z === a.z);
                const portal = atTile.find(pt => pt.level === p.level)
                    ?? atTile.find(pt => pt.level === undefined)
                    ?? atTile[0];
                if (portal && a.op === portal.op) {
                    // two-stage: closed accepts only locId (opens), open accepts only altLocId (climbs);
                    // a mismatched id is IGNORED — server-faithful (World.getLoc misses on a swapped id).
                    if (portal.altLocId === undefined) {
                        if (a.locId === portal.locId) { p.pendingPortal = { portal, stage: 'climb' }; this.emitCoop('portal-pending', { player: p.name, x: a.x, z: a.z }); }
                        else this.emitCoop('oploc-id-mismatch', { player: p.name, ...a });
                    } else if (!portal.open && a.locId === portal.locId) {
                        p.pendingPortal = { portal, stage: 'open' }; this.emitCoop('portal-pending', { player: p.name, x: a.x, z: a.z, stage: 'open' });
                    } else if (portal.open && a.locId === portal.altLocId) {
                        p.pendingPortal = { portal, stage: 'climb' }; this.emitCoop('portal-pending', { player: p.name, x: a.x, z: a.z, stage: 'climb' });
                    } else this.emitCoop('oploc-id-mismatch', { player: p.name, ...a });
                    break;
                }
                const wd = this.wallDoors.find(d => !d.open && d.x === a.x && d.z === a.z && d.locId === a.locId && d.op === a.op);
                if (wd) { p.pendingWallDoor = wd; this.emitCoop('walldoor-pending', { player: p.name, x: a.x, z: a.z }); break; }
                const door = this.simDoors.find(d => d.x === a.x && d.z === a.z && d.locId === a.locId && d.op === a.op);
                if (door) {
                    if (door.open) this.emitCoop('oploc-id-mismatch', { player: p.name, ...a });   // open door: closed-id no longer exists there
                    else { p.pendingDoor = door; this.emitCoop('door-pending', { player: p.name, x: a.x, z: a.z }); }
                    break;
                }
                const scr = this.locScripts.find(s => s.x === a.x && s.z === a.z && s.locId === a.locId && s.op === a.op);
                if (scr) {
                    // out of reach = the engine's "I can't reach that!" (no self-route modelled for scripted ops)
                    if (Math.max(Math.abs(p.x - scr.x), Math.abs(p.z - scr.z)) > (scr.reach ?? 1)) { this.msg(p, "I can't reach that!"); this.emitCoop('cant-reach', { player: p.name, loc: scr.locId }); break; }
                    this.emitCoop('loc-script', { player: p.name, loc: scr.locId, x: scr.x, z: scr.z });
                    scr.run(p, this);
                    break;
                }
                this.emitCoop('oploc', { player: p.name, ...a });
                break;
            }
            case 'invbutton': this.invButton(p, a.op, a.obj, a.slot, a.com); break;
            case 'countreply': {
                // ResumePCountDialogHandler: a reply with no pending prompt is DROPPED.
                const pend = p.countPending;
                p.countPending = null;
                if (pend && a.n > 0) this.execAmount(p, pend.com, pend.obj, pend.slot, a.n);
                break;
            }
            case 'ifbutton':
                if (a.com === TRADEMAIN_ACCEPT && p.modal === TRADEMAIN) this.tradeAccept1(p);
                else if (a.com === TRADECONFIRM_ACCEPT && p.modal === TRADECONFIRM) this.tradeAccept2(p);
                else if (a.com === BANK_NOTE_ON && p.modal === BANK_MAIN) p.noteMode = true;
                else if (a.com === BANK_NOTE_OFF && p.modal === BANK_MAIN) p.noteMode = false;
                else if ((a.com === TAN_SOFT_ALL || a.com === TAN_HARD_ALL) && p.modal === TANNER_MAIN) this.tanAll(p, a.com === TAN_HARD_ALL);
                else if (this.dialogState.has(p.index)) this.questAdvance(p, a.com);   // choice page: option decoded in questAdvance via the step's root
                else if (STYLE_BUTTON_LOOKUP.has(a.com)) {
                    // [if_button,combat_X:btnN] ~set_attackstyle(N): %com_mode = N, the varp transmitted back (the SimHarness
                    // model, now in coop too). The engine binds the tab per weapon; the sim accepts any known style button.
                    p.comMode = STYLE_BUTTON_LOOKUP.get(a.com)!.style;
                    { const nm = STYLE_INTERFACE[STYLE_BUTTON_LOOKUP.get(a.com)!.iface]?.styleNames[p.comMode] ?? 'accurate';
                      p.comSkill = nm === 'aggressive' ? 'strength' : nm === 'defensive' || nm === 'longrange' ? 'defence' : nm === 'controlled' ? 'shared' : 'attack'; }
                    p.outPre.push({ kind: 'varp', id: VARP.COM_MODE, value: p.comMode });
                    this.emitCoop('style-set', { player: p.name, com: a.com, mode: p.comMode });
                }
                else this.emitCoop('ifbutton', { player: p.name, com: a.com });
                break;
            case 'resume': if (p.chatModal !== -1 && !this.dialogState.has(p.index)) this.closeChatModal(p, 'resume'); else if (this.dialogState.has(p.index)) this.questAdvance(p); else this.emitCoop('resume', { player: p.name }); break;
            case 'closemodal': if (p.chatModal !== -1 && !this.dialogState.has(p.index)) this.closeChatModal(p, 'closemodal'); else if (this.dialogState.has(p.index)) { this.dialogState.delete(p.index); p.outPre.push({ kind: 'close' }); } else if (p.modal !== -1) this.closeModalFor(p); break;
            case 'opheld':
                // OPHELD5 (opcode 42) = DROP: the item leaves the pack (dropped on the ground; modelled as
                // gone — the harness has no ground-item model). OPHELD1 (185, eat/bury/light) stays a no-op:
                // combat/xp/prayer aren't modelled here (see the header FIDELITY LIMITS). Modelling drop lets
                // clearJunk() actually make progress (e.g. a bot shedding stale bones once Prayer is 99),
                // instead of re-issuing a no-op drop every tick and wedging the brain.
                if (a.op === ClientProt.OPHELD5) {
                    const s = p.inv[a.slot];
                    if (s && s.id === a.obj) { p.inv[a.slot] = null; p.outInvs.add(INV_INTERFACE); this.emitCoop('item-dropped', { player: p.name, obj: a.obj, slot: a.slot }); }
                } else if (a.op === ClientProt.OPHELD1 && this.foods.has(a.obj)) {
                    // EAT: [opheld1,<food>] — one off the slot, heal up to max, the hp stat retransmitted
                    // (the client reads current hp from UPDATE_STAT). 3-tick eat delay is not modelled.
                    const s = p.inv[a.slot];
                    // consume.rs2 @player_consume_item(.., eat_delay 2, skill_delay 3) — OPT-IN (eatDelayModel): one bite per 3
                    // ticks, and %action_delay += 3 (the next melee swing slips 3 ticks)
                    const bitten = this.eatDelayModel && p.eatClock >= this.tick;
                    if (s && s.id === a.obj && p.hp > 0 && !bitten) {
                        if (this.eatDelayModel) { p.eatClock = this.tick + 2; const ls = this.playerLastSwing.get(p.index); if (ls !== undefined) this.playerLastSwing.set(p.index, ls + 3); }
                        if (s.count > 1) s.count--; else p.inv[a.slot] = null;
                        const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + this.foods.get(a.obj)!);
                        this.syncHp(p); p.outInvs.add(INV_INTERFACE);
                        this.emitCoop('ate', { player: p.name, obj: a.obj, from: before, to: p.hp });
                    }
                } else this.emitCoop('client-opheld', { player: p.name, obj: a.obj });
                break;
            case 'wield': this.wield(p, a.obj, a.slot); break;
            case 'opnpcu': {
                const npc = this.npcs.get(a.index);
                if (npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) <= 2) this.questInteract(p, npc.typeId, 'use', a.obj);
                else this.emitCoop('cant-reach', { player: p.name });
                break;
            }
            case 'oplocu': {
                if (this.rejectOplocu(p, a)) break;
                const t = this.transmuteLocs.find(l => l.x === a.x && l.z === a.z && l.locId === a.locId);
                if (!t) { this.emitCoop('client-oplocu', { player: p.name, ...a }); break; }
                // ⛔ CARDINAL ONLY — the whole point of modelling this loc. Manhattan distance 1 is
                // exactly rsmod reached() for a 1x1 shape-10 loc: the four diagonals (Chebyshev 1,
                // Manhattan 2) are walkable and REFUSED, and refusing them here is what makes a
                // diagonal stand tile fail the test instead of silently passing.
                if (Math.abs(p.x - t.x) + Math.abs(p.z - t.z) !== 1) {
                    this.msg(p, "I can't reach that!");
                    this.emitCoop('cant-reach', { player: p.name, loc: t.locId, at: { x: p.x, z: p.z } });
                    break;
                }
                if (t.gateVarp !== undefined && this.questState(t.gateVarp) !== t.gateState) {
                    this.msg(p, 'Nothing interesting happens.');
                    this.emitCoop('transmute-gated', { player: p.name, loc: t.locId, state: this.questState(t.gateVarp) });
                    break;
                }
                const out = t.map.get(a.obj);
                if (out === undefined || this.invTotal(p.inv, a.obj) <= 0) {
                    this.msg(p, 'Nothing interesting happens.');
                    this.emitCoop('transmute-refused', { player: p.name, obj: a.obj });
                    break;
                }
                this.invRemove(p.inv, a.obj, 1);
                this.invAdd(p.inv, out, 1);
                p.outInvs.add(INV_INTERFACE);
                this.emitCoop('transmuted', { player: p.name, from: a.obj, to: out });
                break;
            }
            case 'opobj': {
                if (a.op !== 3) { this.emitCoop('client-opobj', { player: p.name, ...a }); break; }
                const i = this.groundObjs.findIndex(g => g.x === a.x && g.z === a.z && g.obj === a.obj);
                if (i < 0) { this.emitCoop('opobj-missing', { player: p.name, ...a }); break; }
                // OPOBJ self-routes NAIVELY (leanbot's own note) — out of reach is a REFUSAL, not a walk.
                if (Math.max(Math.abs(p.x - a.x), Math.abs(p.z - a.z)) > 1) {
                    this.msg(p, "I can't reach that!");
                    this.emitCoop('cant-reach', { player: p.name, obj: a.obj });
                    break;
                }
                const g = this.groundObjs[i]!;
                this.groundObjs.splice(i, 1);
                this.invAdd(p.inv, g.obj, g.count);
                p.outInvs.add(INV_INTERFACE);
                this.objTaken(g);
                this.emitCoop('obj-taken', { player: p.name, obj: g.obj, x: g.x, z: g.z });
                break;
            }
            case 'opobjt': this.opObjT(p, a); break;
            case 'opnpc': {
                const npc = this.npcs.get(a.index);
                if (a.op === 3 && this.tanners.has(a.index)) {
                    // OpNpcHandler: clearPendingAction + setInteraction(APNPC3); resolved in playerTurn (reach / naive step)
                    if (p.modal !== -1) this.closeModalFor(p);
                    p.pendingNpcOp = npc ? { index: a.index, op: 3 } : null;
                    p.pendingPortal = null; p.pendingDoor = null; p.pendingWallDoor = null; p.pendingPlayerOp = null;
                    this.emitCoop('tanner-op', { player: p.name, npc: a.index, at: { x: p.x, z: p.z } });
                    break;
                }
                if (a.op === 3 && this.bankerNpcs.has(a.index)) {
                    if (npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) <= 2) this.openBank(p);
                    else this.emitCoop('cant-reach', { player: p.name, banker: a.index });
                    break;
                }
                if (a.op === 3 && this.shops.has(a.index)) {
                    if (npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) <= 2) {
                        p.modal = 3824; p.openShop = a.index;
                        p.outPre.push({ kind: 'openmain', com: 3824 });
                        p.outInvs.add(3900).add(3823);
                        this.emitCoop('shop-opened', { player: p.name, keeper: a.index });
                        break;
                    }
                }
                // op2 = Attack on a registered FIGHTER type (the engine fight model below): a HELD interaction, resolved in
                // playerTurn — naive approach, swings only once reachedEntity. The target retaliates (~npc_retaliate).
                if (a.op === 2 && npc && this.fighters.has(npc.typeId)) {
                    if (p.modal !== -1) this.closeModalFor(p);
                    p.pendingNpcOp = { index: a.index, op: 2 };
                    p.pendingPortal = null; p.pendingDoor = null; p.pendingWallDoor = null; p.pendingPlayerOp = null;
                    const st = this.fightOf(a.index); if (st.target < 0) st.target = p.index;
                    this.emitCoop('attack-op', { player: p.name, npc: a.index, at: { x: p.x, z: p.z }, npcAt: { x: npc.x, z: npc.z } });
                    break;
                }
                // op2 = Attack on a registered kill-drop type: one accepted swing = one kill + its
                // GUARANTEED ground drop (the ai_queue3 `obj_add(npc_coord, ...)` shape). Damage is not
                // modelled; range and "the pile must be TAKEN" are, which is what a brain gets wrong.
                if (a.op === 2 && npc && this.killDrops.has(npc.typeId)) {
                    if (Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) > 1) { this.emitCoop('attack-out-of-range', { player: p.name, npc: a.index }); break; }
                    const drop = this.killDrops.get(npc.typeId)!;
                    this.npcs.delete(a.index);
                    if (this.npcRespawn) this.respawnQueue.push({ index: a.index, typeId: npc.typeId, x: npc.x, z: npc.z, at: this.tick + (this.npcRespawn.get(npc.typeId) ?? 100) });
                    if (drop > 0) this.addGroundObj(npc.x, npc.z, drop, 1);
                    this.emitCoop('npc-killed', { player: p.name, npc: a.index, type: npc.typeId, drop, x: npc.x, z: npc.z });
                    this.killHooks.get(npc.typeId)?.(p, this);
                    break;
                }
                // op1 = Talk-to: a quest step interaction
                if (a.op === 1 && npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) <= 2 && this.questSteps.some(s => s.npc === npc.typeId)) {
                    this.questInteract(p, npc.typeId, 'talk', undefined, a.index);
                    break;
                }
                this.emitCoop('client-opnpc', { player: p.name, ...a });
                break;
            }
            default: this.emitCoop(`client-${a.type}`, { player: p.name });
        }
    }

    private invButton(p: CoopPlayer, op: number, obj: number, slot: number, com: number): void {
        if (com === WORN_INV && op === 1) {
            // UNEQUIP: equip.rs2 [inv_button1,wornitems:wear] -> ~unequip(last_slot): refused with a message when the
            // pack has no room, else inv_moveitem(worn, inv). The worn slot IS the wearpos index (WEARPOS order).
            const wp = WEARPOS[slot], w = wp ? p.worn.get(wp) : undefined;
            if (!wp || !w || w.id !== obj) return;
            const free = p.inv.findIndex(x => !x);
            if (free < 0) { this.msg(p, "You don't have enough free space to do that."); return; }
            p.worn.delete(wp); p.inv[free] = { id: w.id, count: w.count };
            p.outInvs.add(INV_INTERFACE).add(WORN_INV);
            this.emitCoop('unequipped', { player: p.name, obj, wearpos: wp });
            return;
        }
        if (op === 5) {   // Withdraw-X/Deposit-X/Offer-X: the engine suspends in p_countdialog
            p.countPending = { com, obj, slot };
            p.outPre.push({ kind: 'countdialog' });
            return;
        }
        // ⛔ A SHOP BUTTON IS NOT A BANK BUTTON, AND THE LADDERS ARE OFFSET BY ONE.
        // shop/scripts/shop.rs2:168-170 binds  [inv_button2,shop_template:inv] @shop_request(...,1),
        // inv_button3 -> 5, inv_button4 -> 10, with inv_button1 being the VALUE/examine click that
        // moves nothing (shop.rs2:52). That is the same table LeanBot ships as SHOP_BUY_BUTTON /
        // SHOP_SELL_BUTTON ({1:2, 5:3, 10:4}), and capabilities.test.ts already pins it ("⛔ THE 5x
        // BUG: INV_BUTTON2 buys ONE"). The BANK's ladder starts one button earlier (1/5/10/ALL from
        // op1), and this method used to route shop clicks through it and then re-derive an op from the
        // amount — a double translation that turned INV_BUTTON2 into "buy 10". Live-relevant: a smith
        // clicking "buy 1 hammer" cleared Lumbridge's whole shelf of 5 and starved the second smith.
        if (com === 3900 || com === 3823) { this.shopAction(p, op === 2 ? 1 : op === 3 ? 5 : op === 4 ? 10 : 0, obj, com); return; }
        const amount = op === 1 ? 1 : op === 2 ? 5 : op === 3 ? 10 : op === 4 ? MAX_INT : 0;
        this.execAmount(p, com, obj, slot, amount);
    }

    private execAmount(p: CoopPlayer, com: number, obj: number, slot: number, amount: number): void {
        if (com === TRADESIDE_INV && p.modal === TRADEMAIN) this.moveToTrade(p, obj, slot, amount);
        else if (com === TRADEMAIN_INV && p.modal === TRADEMAIN) this.removeFromTrade(p, obj, amount);
        else if (com === BANK_SIDE_INV && p.modal === BANK_MAIN) this.bankDeposit(p, obj, amount);
        else if (com === BANK_INV && p.modal === BANK_MAIN) this.bankWithdraw(p, obj, amount);
        // Buy-X / Sell-X (the op5 count-dialog reply) asks for a LITERAL quantity — pass it straight
        // through. Button-driven shop clicks never reach here any more; see invButton.
        else if (com === 3900 || com === 3823) this.shopAction(p, amount === MAX_INT ? 10 : amount, obj, com);
        else this.emitCoop('invbutton-ignored', { player: p.name, com, obj });
    }

    // ---- player op + movement (Player.processInteraction shape for a PLAYER target) ---------------
    private playerTurn(p: CoopPlayer): void {
        this.runEngineQueue(p);
        // Held OPLOC on a portal: the engine self-routes the player to the loc, then runs the script.
        // Within the footprint's operable range -> execute the stage NOW (open the lid / telejump);
        // else naive-step toward it (OPLOC self-routing; a MOVE from the client cancels it).
        if (p.pendingPortal) {
            const { portal: pt, stage } = p.pendingPortal;
            if (Math.max(Math.abs(pt.x - p.x), Math.abs(pt.z - p.z)) <= (pt.size ?? 1)) {
                p.pendingPortal = null;
                if (stage === 'open') {
                    pt.open = true;   // loc_change: the id at the tile swaps to altLocId
                    this.emitCoop('portal-opened', { player: p.name, x: pt.x, z: pt.z });
                    return;
                }
                // LADDER THROUGHPUT. Busy -> the op is DROPPED (pendingPortal was already cleared above,
                // the server-faithful thing: an op it cannot service produces no message and no effect).
                // The brain then re-fires on its own climbGap cadence, which is exactly what a bot
                // queueing behind 19 others experiences.
                const lk = `${pt.x},${pt.z},${pt.level ?? 'any'}`;
                const used = this.portalOpsThisTick.get(lk) ?? 0;
                if (used >= this.portalOpsPerTick || this.tick < (this.portalFreeAt.get(lk) ?? 0)) {
                    this.emitCoop('portal-contended', { player: p.name, x: pt.x, z: pt.z });
                    return;   // no message, no effect — the bot finds out by nothing happening
                }
                this.portalOpsThisTick.set(lk, used + 1);
                if (this.portalCooldownTicks > 0) this.portalFreeAt.set(lk, this.tick + this.portalCooldownTicks);
                const from = { x: p.x, z: p.z, level: p.level };
                // `mirror` = the real ladder rule: you land on the tile you climbed FROM, one plane away.
                const to = pt.mirror
                    ? { level: pt.dest.level, x: p.x, z: p.z }
                    : { level: pt.dest.level, x: pt.dest.x, z: pt.dest.z };
                p.teleport(to.x, to.z);
                p.level = to.level;
                this.emitCoop('portal-climbed', { player: p.name, from: { x: pt.x, z: pt.z }, at: from, to });
                return;   // the telejump consumes the turn
            }
            p.queueWaypoint(pt.x, pt.z);
        }
        // Held OPLOC on a scripted WALL door: on one of its two op tiles (the door tile / `beyond`) -> run the script
        // (open_and_close_door: teleport through; the door stays shut); else self-route to the nearer op tile.
        if (p.pendingWallDoor) {
            const d = p.pendingWallDoor, b = wallDoorBeyond(d);
            const m = this.playerOpModel;
            const onDoor = p.x === d.x && p.z === d.z, onBeyond = p.x === b.x && p.z === b.z;
            // in op range: the engine's reachedLoc (wall shape 0) when modelled, else the two op tiles
            const inRange = m ? m.wallLocReached(p.level, p.x, p.z, d.x, d.z, d.angle) : (onDoor || onBeyond);
            if (inRange) {
                p.pendingWallDoor = null;
                if (d.allow && !d.allow(p)) { this.msg(p, d.lockedMsg ?? 'The door is locked.'); this.emitCoop('walldoor-locked', { player: p.name, x: d.x, z: d.z }); return; }
                if (d.script === 'open') {
                    for (const o of this.wallDoors) if (o === d || (d.group && o.group === d.group)) { o.open = true; this.emitCoop('door-opened', { player: p.name, x: o.x, z: o.z }); }
                    return;
                }
                // ~check_axis(coord, loc_coord, loc_angle): on the loc's own row/column (outside) -> entering -> `beyond`
                const outside = (d.angle === 0 || d.angle === 2) ? p.x === d.x : p.z === d.z;
                if (!outside && (d.wakeFromBeyond ?? 0) > 0) {
                    d.wakeFromBeyond!--;
                    this.msg(p, 'Suddenly the suit of armour comes to life!');
                    this.emitCoop('suit-woke', { player: p.name, x: d.x, z: d.z, left: d.wakeFromBeyond });
                    return;
                }
                const to = outside ? b : { x: d.x, z: d.z };
                const from = { x: p.x, z: p.z };
                p.teleport(to.x, to.z);
                this.emitCoop('walldoor-through', { player: p.name, x: d.x, z: d.z, from, to });
                return;
            }
            if (m) {   // findPathToLoc; a client MOVE_OPCLICK route already queued is kept (it is the client's own self-route)
                if (!p.hasWaypoints()) { const path = m.wallLocPath(p.level, p.x, p.z, d.x, d.z, d.angle); if (path.length) p.queueWaypoints(path); else { p.pendingWallDoor = null; this.msg(p, "I can't reach that!"); this.emitCoop('cant-reach', { player: p.name, loc: d.locId }); } }
            } else {
                const dDoor = Math.max(Math.abs(d.x - p.x), Math.abs(d.z - p.z)), dBeyond = Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z));
                const goal = dDoor <= dBeyond ? { x: d.x, z: d.z } : b;
                p.queueWaypoint(goal.x, goal.z);
            }
        }
        // Held OPLOC on a door: self-route adjacent, then open (diagonal doors re-block their leaf via
        // canStep — the corridor mechanic the follower must route around).
        if (p.pendingDoor) {
            const d = p.pendingDoor;
            if (Math.max(Math.abs(d.x - p.x), Math.abs(d.z - p.z)) <= 1) {
                p.pendingDoor = null;
                d.open = true;
                this.emitCoop('door-opened', { player: p.name, x: d.x, z: d.z });
                return;
            }
            p.queueWaypoint(d.x, d.z);
        }
        if (p.pendingNpcOp) {
            const op = p.pendingNpcOp, npc = this.npcs.get(op.index);
            const m = this.playerOpModel;
            if (!npc) p.pendingNpcOp = null;
            else {
                const dx = npc.x - p.x, dz = npc.z - p.z;
                // reachedEntity (rsmod shape -2): the model's real-collision test, else cardinal adjacency + the step between is open
                const reached = m ? m.reached(p.level, p.x, p.z, npc.x, npc.z)
                    : (Math.abs(dx) + Math.abs(dz) === 1 && this.canStep(p.level, p.x, p.z, dx, dz));
                if (reached) {
                    p.clearWaypoints();
                    if (op.op === 2) this.playerSwing(p, npc);   // the held attack keeps swinging (pendingNpcOp stays)
                    else { p.pendingNpcOp = null; this.openTanner(p); }
                } else if (m?.naivePath) {
                    // Player.naivePathToTarget (clientRoutefinder => MoveStrategy.NAIVE): no waypoint, or the last one more than
                    // a tile from the target -> rsmod findNaivePath. NO pathfinding: a wall stops the walk and the interaction
                    // stays held SILENTLY (never "I can't reach that!" while a waypoint is queued).
                    const last = p.hasWaypoints() ? p.wp[0]! : null;
                    if (!last || Math.abs(npc.x - last.x) > 1 || Math.abs(npc.z - last.z) > 1) {
                        const path = m.naivePath(p.level, p.x, p.z, npc.x, npc.z);
                        if (path.length) p.queueWaypoints(path);
                    }
                } else if (!p.hasWaypoints()) {
                    // open-field model of the same naive approach: one waypoint beside the npc along the dominant axis
                    p.queueWaypoint(npc.x - Math.sign(dx) * (Math.abs(dx) >= Math.abs(dz) ? 1 : 0), npc.z - Math.sign(dz) * (Math.abs(dx) >= Math.abs(dz) ? 0 : 1));
                }
            }
        }
        if (p.pendingPlayerOp !== null) {
            const target = this.playersByIndex.get(p.pendingPlayerOp);
            const m = this.playerOpModel;
            if (!target) p.pendingPlayerOp = null;
            else if (m) {
                // the ENGINE model: reachedEntity (rsmod shape -2: next to, not under, no wall between) -> fire; else
                // re-path SMART every tick toward the target (findPathToEntity), so a moving target drags you along
                if (target.level === p.level && m.reached(p.level, p.x, p.z, target.x, target.z)) {
                    p.pendingPlayerOp = null;
                    p.clearWaypoints();
                    this.opPlayer4(p, target);
                } else {
                    const path = target.level === p.level ? m.path(p.level, p.x, p.z, target.x, target.z) : [];
                    if (path.length) p.queueWaypoints(path);
                    else { p.pendingPlayerOp = null; this.msg(p, "I can't reach that!"); this.emitCoop('cant-reach', { player: p.name, target: target.name }); }
                }
            }
            else if (Math.max(Math.abs(target.x - p.x), Math.abs(target.z - p.z)) <= 1) {
                // in range (players don't block players; same-tile and adjacent both fire live)
                p.pendingPlayerOp = null;
                p.clearWaypoints();
                this.opPlayer4(p, target);
            } else {
                // OPPLAYER4 self-routes naively toward the target (the receiver-walks-off trap)
                p.queueWaypoint(target.x, target.z);
            }
        }
        // Player.updateMovement: "players cannot walk if they have a modal open *and* something in their queue"
        // (moveClickRequest && busy() && (queue || engineQueue)). The waypoints are kept; the walk resumes once
        // the modal is dismissed and the queued script has run.
        if (this.busy(p) && p.engineQueue.length > 0 && p.hasWaypoints()) {
            this.emitCoop('move-refused-busy', { player: p.name, modal: p.modal, chatModal: p.chatModal, queued: p.engineQueue.length });
            return;
        }
        p.processMovement(this.playerRun);
    }

    // ---- level-up splash (levelup.rs2) + the engine queue ---------------------------------------------
    /**
     * OPT-IN (default off, so every fixture written before it keeps its meaning): model the level-up splash.
     * Engine: Player.statAdvance -> enqueueScript([advancestat,<stat>], ENGINE); the script runs only when
     * canAccess() (!busy), then `if_openchat(levelup_<stat>)` + `p_pausebutton`. Resume/close (or any OP packet,
     * or a NON-opclick MOVE) ends it, and the next queued level-up runs. Two level-ups in one go (combat:
     * attack + hitpoints) therefore leave one QUEUED behind an open splash, which is exactly when
     * Player.updateMovement refuses a walk on rev 289 (a MOVE_OPCLICK no longer closes the splash).
     */
    levelUpModals = false;
    private static LEVELUP_IF: Map<number, number> | null = null;
    /** stat index -> levelup_<stat> chat interface id, read from levelup.dbrow + interface.pack (content truth). */
    static levelUpInterface(stat: number): number {
        if (!CoopWorld.LEVELUP_IF) {
            const STATS = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching',
                'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'stat18', 'stat19', 'runecraft'];   // PlayerStat order
            const content = `${import.meta.dir}/../../../content`;
            const ifIds = new Map<string, number>();
            for (const l of readFileSync(`${content}/pack/interface.pack`, 'utf8').split(/\r?\n/)) { const m = /^(\d+)=([^:\s]+)$/.exec(l); if (m) ifIds.set(m[2]!, +m[1]!); }
            const map = new Map<number, number>();
            let stat: string | null = null;
            for (const l of readFileSync(`${content}/scripts/levelup/configs/levelup.dbrow`, 'utf8').split(/\r?\n/)) {
                const s = /^data=stat,(\w+)/.exec(l); if (s) stat = s[1]!;
                const i = /^data=interface,(\w+)/.exec(l);
                if (i && stat !== null && STATS.includes(stat) && ifIds.has(i[1]!)) map.set(STATS.indexOf(stat), ifIds.get(i[1]!)!);
            }
            CoopWorld.LEVELUP_IF = map;
        }
        return CoopWorld.LEVELUP_IF.get(stat) ?? -1;
    }
    /** Player.busy(): delayed || a main or chat modal is open. */
    busy(p: CoopPlayer): boolean { return p.modal !== -1 || p.chatModal !== -1 || this.dialogState.has(p.index); }
    /** statAdvance raised a base level: queue the [advancestat] script (no-op unless levelUpModals). */
    enqueueLevelUp(p: CoopPlayer, stat: number): void {
        if (!this.levelUpModals) return;
        p.engineQueue.push({ kind: 'levelup', stat });
        this.emitCoop('levelup-queued', { player: p.name, stat, queued: p.engineQueue.length });
    }
    private runEngineQueue(p: CoopPlayer): void {
        if (!p.engineQueue.length || this.busy(p)) return;
        const job = p.engineQueue.shift()!;
        const com = CoopWorld.levelUpInterface(job.stat);
        if (com === -1) { this.emitCoop('levelup-no-interface', { player: p.name, stat: job.stat }); return; }
        p.chatModal = com;
        p.outPre.push({ kind: 'openchat', com });
        this.emitCoop('levelup-open', { player: p.name, stat: job.stat, com });
    }
    private closeChatModal(p: CoopPlayer, by: string): void {
        const com = p.chatModal;
        p.chatModal = -1;
        p.outPre.push({ kind: 'close' });
        this.emitCoop('chatmodal-closed', { player: p.name, com, by });
    }

    // ---- [opplayer4,_] trade.rs2:26-73, ported line-by-line ---------------------------------------
    private opPlayer4(p: CoopPlayer, target: CoopPlayer): void {
        if (target.modal !== -1) {   // ".busy = true"
            this.msg(p, `${target.displayname} is busy at the moment.`);
            return;
        }
        this.msg(p, 'Sending trade offer...');
        p.tradePartner = target.index;                                        // %tradepartner = .uid
        if (target.tradePartner === p.index && p.tradeStatus === TS_RECEIVED) {   // trade.rs2:49
            this.openTrade(p, target);
        } else {
            target.tradeStatus = TS_RECEIVED;                                 // .%tradestatus = received
            this.msg(target, `${p.displayname}:tradereq:`);                   // .mes("<displayname>:tradereq:")
            this.emitCoop('tradereq-sent', { from: p.name, to: target.name });
        }
    }

    private openTrade(a: CoopPlayer, b: CoopPlayer): void {
        for (const p of [a, b]) {
            p.modal = TRADEMAIN;
            p.tradeStatus = TS_RESET;
            p.tradeCompleted = false;
            p.outPre.push({ kind: 'openmainside', main: TRADEMAIN, side: TRADESIDE_INV });
            p.outInvs.add(TRADEMAIN_INV).add(TRADEMAIN_OTHERINV).add(TRADESIDE_INV);
        }
        this.emitCoop('trade-opened', { a: a.name, b: b.name });
    }

    private partnerOf(p: CoopPlayer): CoopPlayer | null {
        const t = this.playersByIndex.get(p.tradePartner);
        return t && t.tradePartner === p.index ? t : null;
    }
    private markOfferChanged(p: CoopPlayer, partner: CoopPlayer | null): void {
        // any offer change RESETS both accepts (trade.rs2:313,352) + retransmits
        p.tradeStatus = TS_RESET;
        p.outInvs.add(TRADEMAIN_INV).add(TRADESIDE_INV).add(INV_INTERFACE);
        if (partner) { partner.tradeStatus = TS_RESET; partner.outInvs.add(TRADEMAIN_OTHERINV); }
    }

    // [label,movetotrade] trade.rs2:329-358 — moves by TYPE total, capped at $amount
    private moveToTrade(p: CoopPlayer, obj: number, slot: number, amount: number): void {
        const s = p.inv[slot];
        if (!s || s.id !== obj || amount <= 0) return;
        const total = Math.min(amount, this.invTotal(p.inv, obj));
        const moved = this.invRemove(p.inv, obj, total);
        this.invAdd(p.tradeoffer, obj, moved);
        this.markOfferChanged(p, this.partnerOf(p));
        this.emitCoop('offer-added', { player: p.name, obj, moved });
    }
    private removeFromTrade(p: CoopPlayer, obj: number, amount: number): void {
        const total = Math.min(amount, this.invTotal(p.tradeoffer, obj));
        const moved = this.invRemove(p.tradeoffer, obj, total);
        this.invAdd(p.inv, obj, moved);
        this.markOfferChanged(p, this.partnerOf(p));
    }

    // [proc,enough_trade_space] trade.rs2:161-190: does GIVER's offer fit RECEIVER's inv?
    // Stackables merge into an existing stack for free (with 32-bit overflow guard); everything
    // else costs a slot.
    private enoughTradeSpace(giver: CoopPlayer, receiver: CoopPlayer): boolean {
        let space = this.freeSlots(receiver.inv);
        for (const s of giver.tradeoffer) {
            if (!s) continue;
            if (this.isStackable(s.id)) {
                const held = this.invTotal(receiver.inv, s.id);
                if (held > 0) { if (MAX_INT - held - s.count < 0) return false; }
                else if (--space < 0) return false;
            } else if (--space < 0) return false;   // non-stackables occupy one slot per item-slot
        }
        return true;
    }

    // [if_button,trademain:accept] trade.rs2:75-159
    private tradeAccept1(p: CoopPlayer): void {
        p.tradeStatus = TS_PENDING_ACCEPT;
        const other = this.partnerOf(p);
        if (!other) return;
        if (other.tradeStatus !== TS_PENDING_ACCEPT) { this.emitCoop('accept1-waiting', { player: p.name }); return; }
        if (!this.enoughTradeSpace(p, other)) {   // my offer -> their inv
            this.msg(p, "Other player doesn't have enough inventory space for this trade.");
            this.msg(other, "You don't have enough inventory space for this trade");
            this.closeTradeBoth(p, other);
            this.emitCoop('trade-space-fail', { giver: p.name, receiver: other.name });
            return;
        }
        if (!this.enoughTradeSpace(other, p)) {   // their offer -> my inv
            this.msg(p, "You don't have enough inventory space for this trade.");
            this.msg(other, "Other player doesn't have enough inventory space for this trade");
            this.closeTradeBoth(p, other);
            this.emitCoop('trade-space-fail', { giver: other.name, receiver: p.name });
            return;
        }
        for (const q of [p, other]) {
            q.modal = TRADECONFIRM;
            q.tradeStatus = TS_ACCEPT;
            // Player.openMainModal: IF_CLOSE now (drops tradeside), IF_OPENMAIN at encodeOut — see tradeConfirmOpenDelay
            q.outPre.push({ kind: 'close' });
            if (this.tradeConfirmOpenDelay > 0) q.outLater.push({ at: this.tick + this.tradeConfirmOpenDelay, pkt: { kind: 'openmain', com: TRADECONFIRM } });
            else q.outPre.push({ kind: 'openmain', com: TRADECONFIRM });
        }
        this.emitCoop('trade-confirm-opened', { a: p.name, b: other.name });
    }

    // [if_button,tradeconfirm:accept] trade.rs2:257-277
    private tradeAccept2(p: CoopPlayer): void {
        p.tradeStatus = TS_PENDING_CONFIRM;
        const other = this.partnerOf(p);
        if (!other) return;
        if (other.tradeStatus !== TS_PENDING_CONFIRM) { this.emitCoop('accept2-waiting', { player: p.name }); return; }
        this.msg(p, 'Accepted trade.');
        this.msg(other, 'Accepted trade.');
        // both_moveinv(tradeoffer, inv) — capacity was pre-checked at accept1
        for (const [giver, receiver] of [[p, other], [other, p]] as const) {
            for (let i = 0; i < giver.tradeoffer.length; i++) {
                const s = giver.tradeoffer[i];
                if (!s) continue;
                this.invAdd(receiver.inv, s.id, s.count);
                giver.tradeoffer[i] = null;
            }
        }
        for (const q of [p, other]) {
            q.tradePartner = -1;
            q.tradeCompleted = true;
            q.modal = -1;
            q.outPre.push({ kind: 'close' });
            q.outInvs.add(INV_INTERFACE);
        }
        this.emitCoop('trade-completed', { a: p.name, b: other.name });
    }

    // [if_close,trademain]/[if_close,tradeconfirm] trade.rs2:240-291 — offers RETURN, the partner is
    // closed too and told "Other player declined trade." (unless the trade completed).
    private closeTradeBoth(p: CoopPlayer, other: CoopPlayer | null): void {
        for (const q of [p, other]) {
            if (!q) continue;
            for (let i = 0; i < q.tradeoffer.length; i++) {
                const s = q.tradeoffer[i];
                if (!s) continue;
                this.invAdd(q.inv, s.id, s.count);
                q.tradeoffer[i] = null;
            }
            q.tradePartner = -1;
            q.tradeStatus = TS_RESET;
            q.modal = -1;
            q.outPre.push({ kind: 'close' });
            q.outInvs.add(INV_INTERFACE);
        }
    }
    private closeModalFor(p: CoopPlayer): void {
        if (p.modal === TRADEMAIN || p.modal === TRADECONFIRM) {
            const other = this.partnerOf(p);
            const completed = p.tradeCompleted;
            this.closeTradeBoth(p, other);
            if (other && !completed) this.msg(other, 'Other player declined trade.');
            this.emitCoop('trade-closed', { player: p.name, declined: !completed });
        } else if (p.modal === BANK_MAIN) {
            p.modal = -1;
            p.outPre.push({ kind: 'close' });
        } else {
            p.modal = -1;
            p.openShop = -1;
            p.outPre.push({ kind: 'close' });
        }
    }

    // ---- bank (bank.rs2 contract, proven live in noted-bank-test.ts) ------------------------------
    private openBank(p: CoopPlayer): void {
        p.modal = BANK_MAIN;
        p.noteMode = false;   // openbank RESETS %bankcert on EVERY open (bank.rs2:19)
        p.outPre.push({ kind: 'openmain', com: BANK_MAIN });
        p.outInvs.add(BANK_INV).add(BANK_SIDE_INV).add(INV_INTERFACE);
        this.emitCoop('bank-opened', { player: p.name });
    }
    private bankDeposit(p: CoopPlayer, obj: number, amount: number): void {
        const total = Math.min(amount, this.invTotal(p.inv, obj));
        if (total <= 0) return;
        // a deposited CERT re-banks as the UNNOTED item (inv_moveitem_cert)
        const bankId = this.notables.has(obj - 1) ? obj - 1 : obj;
        // WHOLESALE REFUSAL (bank.rs2:88-90): "sub(^max_32bit_int, $amount) < inv_total(bank, ...)" ->
        // refuse the ENTIRE deposit, nothing moves, nothing destroyed. Previously this clamped at
        // MAX_INT and silently discarded the overflow — LIVE-VERIFIED ( overshoot-probe.ts)
        // the real engine does not clamp: it refuses outright and the item never leaves the backpack.
        const existing = p.bank.get(bankId) ?? 0;
        if (MAX_INT - total < existing) {
            this.emitCoop('bank-deposit-refused', { player: p.name, obj, amount: total, bankTotal: existing });
            return;
        }
        const moved = this.invRemove(p.inv, obj, total);
        p.bank.set(bankId, existing + moved);
        p.outInvs.add(BANK_INV).add(BANK_SIDE_INV).add(INV_INTERFACE);
        this.emitCoop('bank-deposit', { player: p.name, obj, moved, as: bankId });
    }
    private bankWithdraw(p: CoopPlayer, obj: number, amount: number): void {
        const held = p.bank.get(obj) ?? 0;
        if (held <= 0) return;
        let n = Math.min(amount, held);   // "Withdraw N > held = all"
        const outId = p.noteMode && this.notables.has(obj) ? obj + 1 : obj;   // cert = unnoted+1
        if (!this.isStackable(outId)) n = Math.min(n, this.freeSlots(p.inv));
        else if (this.invTotal(p.inv, outId) === 0 && this.freeSlots(p.inv) < 1) n = 0;
        if (n <= 0) return;
        const added = this.invAdd(p.inv, outId, n);
        p.bank.set(obj, held - added);
        if ((p.bank.get(obj) ?? 0) <= 0) p.bank.delete(obj);
        p.outInvs.add(BANK_INV).add(BANK_SIDE_INV).add(INV_INTERFACE);
        this.emitCoop('bank-withdraw', { player: p.name, obj, out: outId, n: added, noted: outId !== obj });
    }

    bankSlots(p: CoopPlayer): Array<{ id: number; count: number }> {
        return [...p.bank].map(([id, count]) => ({ id, count }));
    }

    // ---- DISCONNECT INJECTION (the liveness family: ghost partners, dead receivers) ---------------
    // Removes the player from the world mid-anything. Viewers see a 'remove' next tick; a trade
    // partner is closed out with the offers-returned + declined semantics (live: logout closes the
    // partner's window). The survivor brains' ghost-handling is exactly what tests assert on.
    removePlayer(index: number): void {
        const p = this.playersByIndex.get(index);
        if (!p) return;
        if (p.modal === TRADEMAIN || p.modal === TRADECONFIRM) this.closeModalFor(p);
        // a pending request the victim sent stays dangling on the target — matches live
        this.playersByIndex.delete(index);
        this.emitCoop('player-removed', { player: p.name });
    }

    // ---- DEATH + KEEP-3 (death.rs2 semantics; the pickaxe-brick class) ----------------------------
    // Keeps the 3 highest-VALUE item-slots (by obj cost, stackables valued cost*count), drops the
    // rest (modelled as gone), teleports to Lumbridge respawn, restores hp.
    objCosts = new Map<number, number>();
    registerCost(id: number, cost: number) { this.objCosts.set(id, cost); }
    /** Edible objs -> hp healed (OPHELD1 eats one; e.g. registerFood(385, 20) for a shark). */
    foods = new Map<number, number>();
    registerFood(id: number, heal: number): void { this.foods.set(id, heal); }
    /** opt-in: model consume.rs2's eat delay (1 bite / 3 ticks, +3 ticks on the next melee swing) */
    eatDelayModel = false;
    /** Mirror p.hp into the hitpoints stat the client reads (UPDATE_STAT current level) and retransmit it. */
    syncHp(p: CoopPlayer): void { const s = p.stats.get(3); if (s) { s.level = p.hp; p.outStats.push(3); } }
    /** 'content': death.rs2 ~player_death_lose_items exactly — three times ~move_priciest_item_on_hero_to_death:
     *  the obj with the highest oc_cost PER UNIT (stack size ignored), backpack scanned before worn, strict '>' (ties keep the first
     *  found, i.e. a pack item beats a worn one of the same cost), ONE unit moved to deathkeep; everything else (pack AND worn) is
     *  dropped; deathkeep comes back to the pack. 'legacy' = the older stack-value / pack-only model (older tests unchanged). */
    deathKeepModel: 'legacy' | 'content' = 'legacy';
    killPlayer(p: CoopPlayer): void {
        if (this.deathKeepModel === 'content') {
            const keep: Array<{ id: number; count: number }> = [];
            for (let k = 0; k < 3; k++) {
                let best: { where: 'inv' | 'worn'; key: number | string; id: number } | null = null, price = 0;
                p.inv.forEach((s, i) => { if (s && s.count > 0) { const c = this.objCosts.get(s.id) ?? 1; if (c > price) { price = c; best = { where: 'inv', key: i, id: s.id }; } } });
                for (const [wp, w] of p.worn) if (w.count > 0) { const c = this.objCosts.get(w.id) ?? 1; if (c > price) { price = c; best = { where: 'worn', key: wp, id: w.id }; } }
                if (!best) break;
                const b = best as { where: 'inv' | 'worn'; key: number | string; id: number };
                if (b.where === 'inv') { const s = p.inv[b.key as number]!; s.count--; if (s.count <= 0) p.inv[b.key as number] = null; }
                else { const w = p.worn.get(b.key as string)!; w.count--; if (w.count <= 0) p.worn.delete(b.key as string); }
                const kk = keep.find(x => x.id === b.id); if (kk) kk.count++; else keep.push({ id: b.id, count: 1 });
            }
            for (let i = 0; i < p.inv.length; i++) p.inv[i] = null;
            p.worn.clear();
            for (const k of keep) this.invAdd(p.inv, k.id, k.count);
            p.hp = p.maxHp; this.syncHp(p); p.deaths++;
            p.teleport(3222, 3218);
            p.outInvs.add(INV_INTERFACE).add(WORN_INV);
            this.emitCoop('player-died', { player: p.name, kept: keep });
            return;
        }
        const valued = p.inv.map((s, i) => ({ s, i, v: s ? (this.objCosts.get(s.id) ?? 0) * (this.isStackable(s.id) ? s.count : 1) : -1 }))
            .filter(e => e.s).sort((a, b) => b.v - a.v);
        const keep = new Set(valued.slice(0, 3).map(e => e.i));
        for (let i = 0; i < p.inv.length; i++) if (!keep.has(i)) p.inv[i] = null;
        p.hp = p.maxHp;
        this.syncHp(p);
        p.deaths++;
        p.teleport(3222, 3218);   // Lumbridge respawn
        p.outInvs.add(INV_INTERFACE);
        this.emitCoop('player-died', { player: p.name, kept: [...keep].map(i => p.inv[i]?.id) });
    }

    // ---- PLAYER HP REGEN + COMBAT XP (opt-in, essence-wave training; off = every older test byte-identical) ----
    // Player.ts processRegen: +1 current hp every 100 ticks while below base (no rapid heal modelled). combatXp: a landed hit of
    // `dmg` grants 4*dmg xp to the style's skill (controlled: 4/3 each) + 4/3*dmg hitpoints xp (combat.rs2 ~give_combat_experience),
    // in the sim's DISPLAYED xp unit; levels follow the engine curve; a hitpoints level-up raises max + current hp by 1; the combat
    // level is recomputed (Player.ts:1351) so the aggro oracle (vislevel*2) sees the trained bot.
    playerRegenTicks = 0;
    combatXp = false;
    private static xpCurve: number[] | null = null;
    static levelForXp(xp: number): number {
        if (!CoopWorld.xpCurve) { const out = [0, 0]; let acc = 0; for (let i = 0; i < 99; i++) { acc += Math.floor(i + 1 + Math.pow(2, (i + 1) / 10) * 300); out[i + 2] = Math.floor(acc / 4); } CoopWorld.xpCurve = out; }
        let l = 1; while (l < 99 && xp >= CoopWorld.xpCurve[l + 1]!) l++; return l;
    }
    protected playerRegenTick(): void {
        if (this.playerRegenTicks <= 0 || this.tick % this.playerRegenTicks !== 0) return;
        for (const p of this.playersByIndex.values()) if (p.hp > 0 && p.hp < p.maxHp) { p.hp++; this.syncHp(p); }
    }
    grantCombatXp(p: CoopPlayer, dmg: number): void {
        if (!this.combatXp || dmg <= 0) return;
        const add = (stat: number, xp: number) => {
            let s = p.stats.get(stat); if (!s) { s = { xp: stat === 3 ? 1154 : 0, level: stat === 3 ? p.hp : 1 }; p.stats.set(stat, s); }
            const base = stat === 3 ? Math.max(10, CoopWorld.levelForXp(s.xp)) : s.level;
            s.xp += xp;
            const nb = stat === 3 ? Math.max(10, CoopWorld.levelForXp(s.xp)) : CoopWorld.levelForXp(s.xp);
            if (stat === 3) { if (nb > base) { p.maxHp += nb - base; p.hp += nb - base; } s.level = p.hp; }
            else s.level = Math.max(s.level, nb);
            p.outStats.push(stat);
        };
        const k = p.comSkill;
        if (k === 'shared') { add(0, dmg * 4 / 3); add(1, dmg * 4 / 3); add(2, dmg * 4 / 3); }
        else add(k === 'attack' ? 0 : k === 'strength' ? 2 : 1, dmg * 4);
        add(3, dmg * 4 / 3);
        const lv = (i: number, d: number) => i === 3 ? p.maxHp : p.stats.get(i)?.level ?? d;
        p.combatLevel = Math.floor(0.325 * (lv(0, 1) + lv(2, 1)) + 0.25 * (lv(1, 1) + lv(3, 10) + Math.floor(lv(5, 1) / 2)));
    }

    // ---- AGGRO (Npc.ts:998: aggro when playerCombat <= vislevel*2, within the wander box) ---------
    // Registered aggro npcs swing at an in-range eligible player every attackRate ticks with the
    // formula max hit (combat.ts). This is the "is this station safe for a combat-X bot" oracle.
    private aggros: Array<{ x: number; z: number; range: number; vislevel: number; maxHit: number; atkRoll: number; rate: number; lastSwing: number }> = [];
    addAggroNpc(cfg: { x: number; z: number; range: number; vislevel: number; maxHit: number; atkRoll: number; rate?: number }) {
        this.aggros.push({ ...cfg, rate: cfg.rate ?? 4, lastSwing: -100 });
    }
    protected aggroTick(): void {
        for (const a of this.aggros) {
            if (this.tick - a.lastSwing < a.rate) continue;
            for (const p of this.playersByIndex.values()) {
                if (p.combatLevel > a.vislevel * 2) continue;
                if (Math.max(Math.abs(p.x - a.x), Math.abs(p.z - a.z)) > a.range) continue;
                a.lastSwing = this.tick;
                // defence roll vs the npc: defence level + WORN armour crush-defence
                const def = p.stats.get(1)?.level ?? 1;
                const pHit = Math.min(1, a.atkRoll / Math.max(1, a.atkRoll + (def + 8) * (64 + this.wornCrushDef(p))));   // coarse
                const dmg = Math.random() < pHit ? Math.floor(Math.random() * (a.maxHit + 1)) : 0;
                p.hp -= dmg;
                if (dmg > 0) { this.emitCoop('npc-hit-player', { player: p.name, dmg, hp: p.hp }); this.syncHp(p); }
                if (p.hp <= 0) this.killPlayer(p);
                break;
            }
        }
    }

    // ---- WORN EQUIPMENT (OPHELD2 wield/wear — the [opheld2,obj] wear scripts) ---------------------
    // Register equippables with their wearpos + optional stat gate + optional hard REFUSAL (quest
    // gates like rune platebody's Dragon Slayer — the class that looped a bot's wearBestArmour
    // until the 4-try blacklist landed). A wield swaps backpack<->worn; the client detects success
    // as "gone from backpack", so the 3214 retransmit is the whole contract.
    equippables = new Map<number, { wearpos: string; req?: { stat: number; level: number }; refuse?: string; crushDef?: number }>();
    registerEquippable(id: number, cfg: { wearpos: string; req?: { stat: number; level: number }; refuse?: string; crushDef?: number }): void {
        this.equippables.set(id, { ...cfg, wearpos: normWearpos(cfg.wearpos) });
    }
    protected wield(p: CoopPlayer, obj: number, slot: number): void {
        const eq = this.equippables.get(obj);
        const s = p.inv[slot];
        if (!eq || !s || s.id !== obj) return;
        if (eq.refuse) { this.msg(p, eq.refuse); this.emitCoop('wield-refused', { player: p.name, obj, why: 'quest' }); return; }
        if (eq.req && (p.stats.get(eq.req.stat)?.level ?? 1) < eq.req.level) {
            this.msg(p, `You are not a high enough level to use this item.`);
            this.emitCoop('wield-refused', { player: p.name, obj, why: 'level' });
            return;
        }
        const prev = p.worn.get(eq.wearpos) ?? null;
        p.inv[slot] = prev;                       // previous occupant swaps into the vacated slot
        p.worn.set(eq.wearpos, { id: obj, count: s.count });
        p.outInvs.add(INV_INTERFACE).add(WORN_INV);
        this.emitCoop('wielded', { player: p.name, obj, wearpos: eq.wearpos, unequipped: prev?.id ?? null });
    }
    wornCrushDef(p: CoopPlayer): number {
        let t = 0;
        for (const w of p.worn.values()) t += this.equippables.get(w.id)?.crushDef ?? 0;
        return t;
    }

    // ---- QUEST + DIALOG FIXTURE ------------------------------------------------------
    // A quest is CONTENT, not a mechanic: each is a bespoke varp state-machine advanced by dialog +
    // item steps whose branching lives in RS2 scripts. We do NOT re-implement the RS2 interpreter —
    // instead a quest is registered as a declarative FIXTURE (the observable CONTRACT of each step:
    // "interact with NPC N at varp state S carrying item I -> advance to S' + add/del items"). The
    // sim drives the dialog protocol (IF_OPENCHAT pages + resume/ifbutton) and applies the effect so
    // the QuestRunnerBot can be exercised end-to-end offline.
    // ⛔ HONESTY: the fixture is a hand-transcription of the script — it can DRIFT. The sim proves the
    // RUNNER executes the fixture correctly; it does NOT prove the quest completes live. Every quest
    // still needs one live smoke. Boss fights / instanced legs are not modelled here.
    private questVar = new Map<number, number>();   // varpId -> state (shared across players; one quester per world)
    private questSteps: QuestStep[] = [];
    private dialogState = new Map<number, { step: QuestStep; page: number; npcIndex?: number }>();   // player index -> open dialog
    registerQuest(steps: QuestStep[]): void { this.questSteps.push(...steps); }
    questState(varpId: number): number { return this.questVar.get(varpId) ?? 0; }

    // ---- TRANSMUTE LOC — `[oplocu,<loc>]`, the Cauldron of Thunder shape ---------------------------
    // A loc that CONSUMES one inventory item and hands back another (quest_druid.rs2:14-38). Three
    // things are modelled and each is a real failure this sim exists to catch:
    //   1. ⛔ CARDINAL ADJACENCY. rsmod's reached() accepts ONLY the four cardinal faces of a 1x1 loc;
    //      all four DIAGONALS are walkable and all four answer false (measured offline for loc 2142).
    //      A diagonal stand tile therefore stalls FOREVER with no server message — so this refuses a
    //      diagonal exactly the way the engine does, and a brain that parks on one fails the test.
    //   2. THE QUEST GATE. `if(%druidquest ! ^druid_spoken_sanfew) { ~displaymessage; return; }` — the
    //      dip does NOTHING until the right stage, which is why the Sanfew talk must precede it.
    //   3. THE ITEM MAP. An unlisted item falls through to the default message and is NOT consumed.
    private transmuteLocs: Array<{ x: number; z: number; locId: number; gateVarp?: number; gateState?: number; map: Map<number, number> }> = [];
    registerTransmuteLoc(spec: { x: number; z: number; locId: number; gateVarp?: number; gateState?: number; map: Record<number, number> }): void {
        this.transmuteLocs.push({ ...spec, map: new Map(Object.entries(spec.map).map(([k, v]) => [Number(k), v])) });
    }

    // ---- KILL -> GUARANTEED GROUND DROP ------------------------------------------------------------
    // OPNPC2 on a registered type removes the npc and drops `obj` on its tile; OPOBJ3 takes it. This is
    // the `ai_queue3` shape of the four Druidic Ritual meats — `obj_add(npc_coord, <meat>, 1, ...)` is
    // UNCONDITIONAL in cow.rs2/chicken.rs2/giant_rat.rs2/bear.rs2, so there is no drop rate to model.
    // Damage/hp/prayer are NOT modelled (see the harness FIDELITY LIMITS): one accepted OPNPC2 = one
    // kill. What IS modelled is the part a brain gets wrong — range, and that the pile must be TAKEN.
    private killDrops = new Map<number, number>();                 // npc typeId -> dropped obj
    groundObjs: Array<{ x: number; z: number; obj: number; count: number }> = [];
    /** `obj` <= 0 = a kill with NO ground drop (e.g. the Tree spirit: death_drop null). `onKill` = the npc's death script
     *  side effects (a quest varp + message, tree_spirit.rs2 [ai_queue3]). */
    registerKillDrop(npcTypeId: number, obj: number, onKill?: (p: CoopPlayer, w: CoopWorld) => void): void { this.killDrops.set(npcTypeId, obj); if (onKill) this.killHooks.set(npcTypeId, onKill); }
    private killHooks = new Map<number, (p: CoopPlayer, w: CoopWorld) => void>();

    // ---- ENGINE FIGHT MODEL ------------------------
    // The kill-drop model above kills on ONE swing from any tile within Chebyshev 1 — diagonals and walls included — so a
    // brain that never REACHES its target cannot fail it. Live (rev 289, clientRoutefinder=true) an OPNPC2 is a HELD engine
    // interaction: the player approaches NAIVELY (Player.naivePathToTarget -> findNaivePath: a loc in between just stops the
    // walk, SILENTLY — no "I can't reach that!" while a waypoint is queued) and swings only when reachedEntity (cardinally
    // adjacent, no wall between). A registered fighter type uses exactly that: the op is held (pendingNpcOp op 2) and resolved
    // every tick; one swing per `rate` ticks once reached; dead after `swings` swings (hit rolls are not modelled — the swing
    // count stands in for its hitpoints). The npc FIGHTS BACK: once engaged (attacked, or `engageNpc` = a script's
    // ~npc_retaliate) it naive-chases its target (Npc.pathToTarget -> naivePathToTarget; the SAME loc stops it) and hits for
    // up to `maxHit` every `rate` ticks while reached. `addTimedNpc` = npc_add(coord, type, duration): EntityLifeCycle.DESPAWN
    // after `ticks`, unconditionally — mid-fight included (Npc.ts lifecycleTick). The live wedge this reproduces: acct5 on
    // the dramen tree's S face, the spirit stuck on its N face, 1.7 h of "hp 79/79" and a fresh spirit every 1000 ticks.
    //
    // COMBAT ROLLS (opt-in per fighter type, — the tree spirit lost live on the numbers, not on reach): with `combat`
    // the swing count is replaced by the rev-289 rolls (lostcity-spirit.ts): our swing hits when randominc(atk) >
    // randominc(npc def roll) for randominc(our max) capped at its hp — atk/max/crush-def from the player's att/str/def stat
    // levels, UNARMED, and its com_mode (the style buttons above); its swing hits when randominc(npc atk) > randominc(our crush
    // def roll) for randominc(npc max). The npc regenerates 1 hp per `regenTicks` (Npc.ts processRegen, regenrate 100).
    private fighters = new Map<number, { swings: number; maxHit: number; rate: number; combat?: FighterCombat }>();
    /** a fighter drops a target further than this many tiles away (0 = chase for ever: the older tests) */
    fighterLeash = 0;
    registerFighter(typeId: number, cfg: { swings: number; maxHit?: number; rate?: number; combat?: FighterCombat }): void {
        this.fighters.set(typeId, { swings: cfg.swings, maxHit: cfg.combat?.maxHit ?? cfg.maxHit ?? 0, rate: cfg.rate ?? 4, ...(cfg.combat ? { combat: cfg.combat } : {}) });
    }
    /** the player's unarmed melee profile from its stat levels + com_mode (0 accurate, 1 aggressive, 2 defensive) */
    meleeProfileOf(p: CoopPlayer) {
        const lv = (i: number) => p.stats.get(i)?.level ?? 1;
        const style: MeleeStyle = p.comMode === 1 ? 'aggressive' : p.comMode === 2 ? 'defensive' : 'accurate';
        return unarmedProfile({ att: lv(0), def: lv(1), str: lv(2), hp: p.maxHp }, style);
    }
    /** a fighter npc's hitpoints left (combat model) */
    npcHpLeft(npcIndex: number): number | undefined { return this.npcFight.get(npcIndex)?.hp; }
    private npcFight = new Map<number, { taken: number; target: number; lastSwing: number; hp?: number; regenAt?: number }>();   // npc index -> fight state
    private playerLastSwing = new Map<number, number>();                                           // player index -> tick
    private fightOf(npcIndex: number) {
        let st = this.npcFight.get(npcIndex);
        if (!st) { st = { taken: 0, target: -1, lastSwing: -100 }; this.npcFight.set(npcIndex, st); }
        return st;
    }
    /** a script's ~npc_retaliate / npc hunt: the npc targets player `p` (it chases and hits while reached) */
    engageNpc(npcIndex: number, p: CoopPlayer): void { if (this.npcs.has(npcIndex)) this.fightOf(npcIndex).target = p.index; }
    /** swings the npc has taken so far (tests) */
    swingsTaken(npcIndex: number): number { return this.npcFight.get(npcIndex)?.taken ?? 0; }
    private npcExpiry = new Map<number, number>();   // npc index -> despawn tick
    /** npc_add(coord, type, duration): the npc despawns `ticks` later whatever it is doing. */
    addTimedNpc(index: number, typeId: number, x: number, z: number, ticks: number): SimNpc {
        const n = this.addNpc(index, typeId, x, z);
        this.npcExpiry.set(index, this.tick + ticks);
        this.npcFight.delete(index);
        return n;
    }
    protected npcLifecycleTick(): void {
        if (!this.npcExpiry.size) return;
        for (const [idx, at] of [...this.npcExpiry]) {
            if (at > this.tick) continue;
            this.npcExpiry.delete(idx);
            const n = this.npcs.get(idx);
            if (!n) continue;
            this.npcs.delete(idx); this.npcFight.delete(idx);
            this.emitCoop('npc-despawned', { npc: idx, type: n.typeId, x: n.x, z: n.z });
        }
    }
    /** reachedEntity for two size-1 entities: the op model's real-collision test, else cardinal adjacency + the step open */
    private entityReached(level: number, sx: number, sz: number, tx: number, tz: number): boolean {
        const m = this.playerOpModel;
        if (m) return m.reached(level, sx, sz, tx, tz);
        const dx = tx - sx, dz = tz - sz;
        return Math.abs(dx) + Math.abs(dz) === 1 && this.canStep(level, sx, sz, dx, dz);
    }
    /** engaged fighter npcs: naive chase (blocked silently by locs), hit while reached */
    protected fighterNpcTick(): void {
        for (const [idx, st] of [...this.npcFight]) {
            const npc = this.npcs.get(idx);
            if (!npc) { this.npcFight.delete(idx); continue; }
            const cfg = this.fighters.get(npc.typeId);
            const p = st.target >= 0 ? this.playersByIndex.get(st.target) : undefined;
            if (cfg?.combat && st.hp !== undefined && st.hp < cfg.combat.hp && this.tick >= (st.regenAt ?? 0)) { st.hp++; st.regenAt = this.tick + (cfg.combat.regenTicks ?? 100); }
            { const hm = (st as any).home; if (this.fighterLeash > 0 && st.target < 0 && hm && (npc.x !== hm.x || npc.z !== hm.z)) { npc.queueWaypoint(hm.x, hm.z); npc.processMovement(false); continue; } }
            if (!cfg || !p || p.level !== npc.level) continue;
            // the engine's npc gives up a target that left its range (Npc.ts: maxrange from where it was engaged) and walks back, instead of chasing it
            // across the map (opt-in with fighterLeash > 0; trained bots walked back to the mine with the whole cow pen in tow)
            if (this.fighterLeash > 0) {
                const home = ((st as any).home ??= { x: npc.x, z: npc.z });
                if (Math.max(Math.abs(p.x - home.x), Math.abs(p.z - home.z)) > this.fighterLeash) { st.target = -1; npc.clearWaypoints(); npc.queueWaypoint(home.x, home.z); npc.processMovement(false); continue; }
            }
            if (this.entityReached(npc.level, npc.x, npc.z, p.x, p.z)) {
                npc.clearWaypoints();
                if (cfg.maxHit > 0 && this.tick - st.lastSwing >= cfg.rate) {
                    st.lastSwing = this.tick;
                    const roll = (n: number) => Math.floor(this.rng() * (n + 1));
                    const landed = !cfg.combat || roll(cfg.combat.atkRoll) > roll(this.meleeProfileOf(p).crushDefRoll);
                    const dmg = landed ? Math.floor(this.rng() * (cfg.maxHit + 1)) : 0;
                    p.hp -= dmg;
                    this.emitCoop('npc-hit-player', { player: p.name, npc: idx, dmg, hp: p.hp });
                    if (dmg > 0) this.syncHp(p);
                    if (p.hp <= 0) { this.killPlayer(p); st.target = -1; }
                }
                continue;
            }
            const m = this.playerOpModel;
            if (m?.naivePath) { const path = m.naivePath(npc.level, npc.x, npc.z, p.x, p.z); if (path.length) npc.queueWaypoints(path); }
            else {   // open-field naive approach: the cardinal perimeter tile on the dominant axis (takeStep honours canStep)
                const dx = p.x - npc.x, dz = p.z - npc.z, xa = Math.abs(dx) >= Math.abs(dz);
                npc.queueWaypoint(p.x - (xa ? Math.sign(dx) : 0), p.z - (xa ? 0 : Math.sign(dz)));
            }
            npc.processMovement(false);
        }
    }
    /** one player swing on a reached fighter (every `rate` ticks); the last one kills (death script + drop as kill-drop) */
    private playerSwing(p: CoopPlayer, npc: SimNpc): void {
        const cfg = this.fighters.get(npc.typeId)!;
        if (this.tick - (this.playerLastSwing.get(p.index) ?? -100) < cfg.rate) return;
        this.playerLastSwing.set(p.index, this.tick);
        const st = this.fightOf(npc.index);
        if (st.target < 0) st.target = p.index;
        st.taken++;
        if (cfg.combat) {
            if (st.hp === undefined) { st.hp = cfg.combat.hp; st.regenAt = this.tick + (cfg.combat.regenTicks ?? 100); }
            const me = this.meleeProfileOf(p), roll = (n: number) => Math.floor(this.rng() * (n + 1));
            const dmg = roll(me.atkRoll) > roll(cfg.combat.defRoll) ? Math.min(st.hp, roll(me.maxHit)) : 0;
            st.hp -= dmg;
            this.grantCombatXp(p, dmg);
            this.emitCoop('player-swing', { player: p.name, npc: npc.index, taken: st.taken, dmg, hpLeft: st.hp, style: p.comMode, at: { x: p.x, z: p.z } });
            if (st.hp > 0) return;
        } else {
            this.emitCoop('player-swing', { player: p.name, npc: npc.index, taken: st.taken, of: cfg.swings, at: { x: p.x, z: p.z } });
            if (st.taken < cfg.swings) return;
        }
        p.pendingNpcOp = null;
        this.npcs.delete(npc.index); this.npcFight.delete(npc.index); this.npcExpiry.delete(npc.index);
        // a fighter respawns like a kill-drop npc when respawn is enabled
        if (this.npcRespawn) this.respawnQueue.push({ index: npc.index, typeId: npc.typeId, x: npc.x, z: npc.z, at: this.tick + (this.npcRespawn.get(npc.typeId) ?? 100) });
        const drop = this.killDrops.get(npc.typeId) ?? 0;
        if (drop > 0) this.addGroundObj(npc.x, npc.z, drop, 1);
        this.emitCoop('npc-killed', { player: p.name, npc: npc.index, type: npc.typeId, drop, x: npc.x, z: npc.z });
        this.killHooks.get(npc.typeId)?.(p, this);
    }
    // ---- SCRIPTED LOC OPS (SimLocScript) + small content helpers for them ---------------------------------------
    private locScripts: SimLocScript[] = [];
    registerLocScript(s: SimLocScript): void { this.locScripts.push(s); }

    /**
     * THE AL KHARID TOLL GATE — a transcription of
     * content/scripts/areas/area_alkharid/scripts/border_gate.rs2:
     *   - both halves (2882 @3268,3227 / 2883 @3268,3228, angle 0 = wall on the WEST edge) are SHUT for movement, in both
     *     directions, forever (the navgrid masks them open — toll.test.ts defect 1 — so a planner happily routes through),
     *     and so is the rest of the fence on that line, z 3204..3239 (north of it the road is open);
     *   - [oploc1,border_gate_toll_left|right] -> talk_to_border_guard: chatplayer, chatnpc, then p_choice3 (modal 2469)
     *     "No thank you, I'll walk around."=1 / "Who does my money go to?"=2 / "Yes, ok."=3. Only 3 pays: short of 10 gp
     *     = "Oh dear, I don't actually seem to have enough money." and nothing happens; else `inv_del(inv, coins, 10)` and
     *     @pass_toll_gate teleports the player 1 tile across from ITS OWN x (west -> x 3268, east -> x 3267, same z).
     *   - the same-side guard must be within 1 tile of the player (npc_find(coord, borderguardN, 1, 0)); modelled as the
     *     op firing only from Chebyshev <= 1 of the gate half (the stand tiles both qualify; anything farther is
     *     "I can't reach that!").
     * The princequest free pass is not modelled. `fee` defaults to the content's 10.
     */
    addTollGate(fee = 10): void {
        const TOLL_LABELS = ["No thank you, I'll walk around.", 'Who does my money go to?', 'Yes, ok.'];
        // THE FENCE (m51_50.jm2: railing 997 along the x=3267/3268 line z ~3204..3238, timberwall 1602 at z 3239) — without
        // it the sim lets a bot that was just teleported west step diagonally back east beside the gate (trace-caught).
        for (let z = 3204; z <= 3239; z++) if (z !== 3227 && z !== 3228) this.addWallDoor({ x: 3268, z, angle: 0, locId: -997, op: -1, script: 'open' });
        for (const [z, loc] of [[3227, 2882], [3228, 2883]] as const) {
            // the edge only: a locId no OPLOC can name, so the op falls through to the loc script below
            this.addWallDoor({ x: 3268, z, angle: 0, locId: -loc, op: -1, script: 'open' });
            this.registerLocScript({
                x: 3268, z, locId: loc, op: 1, reach: 1, run: (p) => {
                    const step: QuestStep = {
                        npc: -1, op: 'talk', varp: -1, whenState: 0, toState: 0,
                        pages: 3, choicePage: 2, choiceRoot: 2469, expectChoice: 3, choiceLabels: TOLL_LABELS,
                        pageTexts: ['Can I come through this gate?', 'You must pay a toll of 10 gold coins to pass.'],
                        fee: { obj: COINS, n: fee, shortMsg: "Oh dear, I don't actually seem to have enough money." },
                        teleportFn: (pp) => ({ x: pp.x < 3268 ? 3268 : 3267, z: pp.z, level: 0 }),
                    };
                    this.dialogState.set(p.index, { step, page: 0 });
                    p.outPre.push({ kind: 'settext', com: 4885, text: step.pageTexts![0]! });
                    p.outPre.push({ kind: 'openchat', com: 2461 });
                    this.emitCoop('toll-dialog-open', { player: p.name, x: p.x, z: p.z, side: p.x < 3268 ? 'west' : 'east' });
                },
            });
        }
    }
    /** set a quest varp (the fixture's shared varp map) */
    setQuestState(varpId: number, v: number): void { this.questVar.set(varpId, v); }
    /** a game message to one player (mes) */
    message(p: CoopPlayer, text: string): void { this.msg(p, text); }
    /** add to a player's pack (+ the inv retransmit) */
    give(p: CoopPlayer, obj: number, n = 1): void { this.invAdd(p.inv, obj, n); p.outInvs.add(INV_INTERFACE); }
    /**
     * NPC RESPAWN. The engine re-adds a killed npc after its `respawnrate` ticks (NpcType.ts:106,
     * default 100; e.g. [giant] respawnrate=60 in _unpack/225/all.npc). The sim used to DELETE a killed npc forever, so no
     * kill-and-bank loop longer than the npcs on the map could be simulated (it stopped after one trip). OPT-IN per world (`enableNpcRespawn`) so older tests that count kills on a fixed population keep meaning.
     */
    npcRespawn: Map<number, number> | null = null;            // typeId -> respawnrate ticks (missing = 100)
    private respawnQueue: Array<{ index: number; typeId: number; x: number; z: number; at: number }> = [];
    enableNpcRespawn(rates: Record<number, number> = {}): void { this.npcRespawn = new Map(Object.entries(rates).map(([k, v]) => [Number(k), v])); }
    addGroundObj(x: number, z: number, obj: number, count = 1): void { this.groundObjs.push({ x, z, obj, count }); }

    // ---- STATIC OBJ SPAWNS --------------------------------------------------
    // A map OBJ placement (jm2 OBJ section, EntityLifeCycle.RESPAWN) is taken by obj_takeitem -> World.removeObj(obj,
    // respawnrate) and re-added after scaleByPlayerCount(respawnrate) = ((4000 - min(players, 2000)) * rate / 4000) | 0
    // ticks (World.ts:2061). `respawnTicks` is that already-scaled number. Every viewer within 20 tiles learns of a present
    // spawn obj (once per presence) through the OBJ_ADD path the bot decodes (CoopHarness.tick: seenSpawnObjs), and of a
    // take through the existing obj-taken OBJ_DEL - so a camper that was away banking still sees the respawn on return.
    objSpawns: Array<{ x: number; z: number; obj: number; respawnTicks: number }> = [];
    private objRespawnQ: Array<{ x: number; z: number; obj: number; at: number }> = [];
    addObjSpawn(x: number, z: number, obj: number, respawnTicks: number): void {
        this.objSpawns.push({ x, z, obj, respawnTicks });
        this.addGroundObj(x, z, obj, 1);
    }
    isSpawnObj(g: { x: number; z: number; obj: number }): boolean { return this.objSpawns.some(s => s.x === g.x && s.z === g.z && s.obj === g.obj); }
    private objTaken(g: { x: number; z: number; obj: number }): void {
        const sp = this.objSpawns.find(s => s.x === g.x && s.z === g.z && s.obj === g.obj);
        if (sp) this.objRespawnQ.push({ x: sp.x, z: sp.z, obj: sp.obj, at: this.tick + sp.respawnTicks });
    }
    private objSpawnTick(): void {
        if (!this.objRespawnQ.length) return;
        const due = this.objRespawnQ.filter(r => r.at <= this.tick);
        if (!due.length) return;
        this.objRespawnQ = this.objRespawnQ.filter(r => r.at > this.tick);
        for (const r of due) { this.addGroundObj(r.x, r.z, r.obj, 1); this.emitCoop('obj-respawned', { obj: r.obj, x: r.x, z: r.z }); }
    }
    /** Test hook: SOMEONE ELSE (an unmodelled player) takes a ground obj - it vanishes for every viewer, and a spawn obj
     *  starts its respawn timer. Returns false if it was not there. */
    takeByOther(x: number, z: number, obj: number): boolean {
        if (!this.groundObjs.some(g => g.x === x && g.z === z && g.obj === obj)) return false;
        this.otherTakes.push({ x, z, obj });   // applied INSIDE the next coopTick, so its OBJ_DEL reaches the viewers
        return true;
    }
    private otherTakes: Array<{ x: number; z: number; obj: number }> = [];
    private applyOtherTakes(): void {
        for (const t of this.otherTakes.splice(0)) {
            const i = this.groundObjs.findIndex(g => g.x === t.x && g.z === t.z && g.obj === t.obj);
            if (i < 0) continue;
            const g = this.groundObjs[i]!; this.groundObjs.splice(i, 1); this.objTaken(g);
            this.emitCoop('obj-taken', { player: '(other)', obj: t.obj, x: t.x, z: t.z });
        }
    }

    // ---- TELEKINETIC GRAB: OPOBJT (; rev 289 OpObjTHandler.ts + skill_magic/scripts/spells/telegrab.rs2) ----------
    // OpObjTHandler: a DELAYED player's packet is dropped (UnsetMapFlag, no message); the spell com must accept an OBJ target
    //   (only telekinetic_grab, 1168, is modelled - anything else is dropped the same way); the obj must exist at x,z (else
    //   dropped). Then an ENGINE interaction APOBJT: it fires at once when Chebyshev distance <= apRange 10 AND
    //   isApproached = hasLineOfSight (PathingEntity.inApproachDistance) - `losFn`, null = open field. Out of range or out of
    //   sight with no route queued (the bot sends no MOVE with it) -> "I can't reach that!" (Player.processInteraction).
    // telegrab.rs2: ~check_spell_requirements (magic >= 33 "Your Magic level is not high enough for this spell."; 1 air +
    //   1 law, "You do not have enough <Air|Law> Runes to cast this spell." - a worn air staff covers the air), the pack
    //   space check ("You don't have enough inventory space to hold that item."), then the runes go, p_delay(2) (delayedUntil
    //   = tick + 3), +43 magic xp, the obj is TAKEN if still there (obj_takeitem: a spawn obj starts its respawn) else
    //   "Too late - it's gone!", p_delay(1). NO wine/monk check - that lives in [opobj3,wine_of_zamorak] only.
    static readonly TELEGRAB_COM = 1168;
    static readonly AIR_STAVES = new Set([1381, 1397, 1405]);   // staff of air, air battlestaff, mystic air staff
    losFn: ((level: number, sx: number, sz: number, dx: number, dz: number) => boolean) | null = null;
    private telegrabs: Array<{ p: CoopPlayer; x: number; z: number; obj: number; at: number }> = [];
    private delayedUntil = new Map<number, number>();
    telegrabCasts = 0;
    private opObjT(p: CoopPlayer, a: { x: number; z: number; obj: number; spellCom: number }): void {
        if ((this.delayedUntil.get(p.index) ?? -1) > this.tick) { this.emitCoop('opobjt-dropped', { player: p.name, why: 'delayed' }); return; }
        if (a.spellCom !== CoopWorld.TELEGRAB_COM) { this.emitCoop('opobjt-dropped', { player: p.name, why: `com ${a.spellCom}` }); return; }
        if (!this.groundObjs.some(g => g.x === a.x && g.z === a.z && g.obj === a.obj)) { this.emitCoop('opobjt-dropped', { player: p.name, why: 'no obj' }); return; }
        if (p.modal !== -1) this.closeModalFor(p);   // clearPendingAction
        const d = Math.max(Math.abs(p.x - a.x), Math.abs(p.z - a.z));
        if (d > 10 || !(this.losFn ? this.losFn(p.level, p.x, p.z, a.x, a.z) : true)) {
            this.msg(p, "I can't reach that!");
            this.emitCoop('cant-reach', { player: p.name, obj: a.obj, telegrab: true, dist: d });
            return;
        }
        if ((p.stats.get(6)?.level ?? 1) < 33) { this.msg(p, 'Your Magic level is not high enough for this spell.'); return; }
        const staff = p.worn.get('rhand')?.id ?? p.worn.get('weapon')?.id ?? -1;
        if (!CoopWorld.AIR_STAVES.has(staff) && this.invTotal(p.inv, 556) < 1) { this.msg(p, 'You do not have enough Air Runes to cast this spell.'); this.emitCoop('telegrab-norunes', { player: p.name, rune: 556 }); return; }
        if (this.invTotal(p.inv, 563) < 1) { this.msg(p, 'You do not have enough Law Runes to cast this spell.'); this.emitCoop('telegrab-norunes', { player: p.name, rune: 563 }); return; }
        const space = this.isStackable(a.obj) ? (this.invTotal(p.inv, a.obj) > 0 || p.inv.some(s => !s)) : p.inv.some(s => !s);
        if (!space) { this.msg(p, "You don't have enough inventory space to hold that item."); return; }
        if (!CoopWorld.AIR_STAVES.has(staff)) this.invRemove(p.inv, 556, 1);
        this.invRemove(p.inv, 563, 1);
        p.outInvs.add(INV_INTERFACE);
        this.delayedUntil.set(p.index, this.tick + 5);   // p_delay(2) then p_delay(1)
        this.telegrabs.push({ p, x: a.x, z: a.z, obj: a.obj, at: this.tick + 3 });
        this.telegrabCasts++;
        this.emitCoop('telegrab-cast', { player: p.name, obj: a.obj, x: a.x, z: a.z, from: { x: p.x, z: p.z }, dist: d });
    }
    private telegrabTick(): void {
        if (!this.telegrabs.length) return;
        const due = this.telegrabs.filter(t => t.at <= this.tick);
        if (!due.length) return;
        this.telegrabs = this.telegrabs.filter(t => t.at > this.tick);
        for (const t of due) {
            const st = t.p.stats.get(6); if (st) { st.xp += 43; t.p.outStats.push(6); }
            const i = this.groundObjs.findIndex(g => g.x === t.x && g.z === t.z && g.obj === t.obj);
            if (i < 0) { this.msg(t.p, "Too late - it's gone!"); this.emitCoop('telegrab-late', { player: t.p.name, obj: t.obj }); continue; }
            const g = this.groundObjs[i]!; this.groundObjs.splice(i, 1);
            this.invAdd(t.p.inv, g.obj, g.count); t.p.outInvs.add(INV_INTERFACE);
            this.objTaken(g);
            this.emitCoop('obj-taken', { player: t.p.name, obj: g.obj, x: g.x, z: g.z, telegrab: true });
        }
    }
    // Test hook: simulate a COMBAT/INSTANCED leg completing (Melzar's maze, Elvarg, the boat) — the
    // sim can't drive those, so a test advances the varp / grants the item as if the bot had done it.
    setQuestVar(varpId: number, state: number): void { this.questVar.set(varpId, state); }

    // A talk/use interaction: if a step matches (npc + op + varp state + required item held), open the
    // step's dialog; else emit a generic no-op so the runner can still advance past chatter.
    private questInteract(p: CoopPlayer, npcTypeId: number, op: 'talk' | 'use', useObj?: number, npcIndex?: number): void {
        const step = this.questSteps.find(s =>
            s.npc === npcTypeId && s.op === op &&
            (s.useItem === undefined || s.useItem === useObj) &&
            this.questState(s.varp) === s.whenState &&
            (s.requireItem === undefined || this.invTotal(p.inv, s.requireItem) > 0));
        if (!step) { p.outPre.push({ kind: 'openchat', com: 2461 }); this.dialogState.set(p.index, { step: NULL_STEP, page: 0 }); this.emitCoop('quest-no-step', { player: p.name, npc: npcTypeId, op, state: 'na' }); return; }
        this.dialogState.set(p.index, { step, page: 0, npcIndex });
        // page 0 is a continue page (a choice step opens the choice root on its choice page)
        if (step.choicePage === 0) this.pushChoiceLabels(p, step);
        if (step.pageTexts?.[0]) p.outPre.push({ kind: 'settext', com: 4885, text: step.pageTexts[0] });
        p.outPre.push({ kind: 'openchat', com: step.choicePage === 0 && step.choiceRoot ? step.choiceRoot : 2461 });
        this.emitCoop('quest-dialog-open', { player: p.name, npc: npcTypeId, state: step.whenState });
    }

    private pushChoiceLabels(p: CoopPlayer, step: QuestStep): void {
        const root = step.choiceRoot !== undefined ? DIALOG_ROOT_BY_ID.get(step.choiceRoot) : undefined;
        if (!root || !step.choiceLabels) return;
        step.choiceLabels.forEach((t, i) => { const com = root.optionComs[i]; if (com !== undefined) p.outPre.push({ kind: 'settext', com, text: t }); });
    }

    // Advance the open dialog. `choice` is the option index the client sent on a choice page (via
    // ifButton). When the last page is consumed the step EFFECT fires: varp advances + items swap.
    private questAdvance(p: CoopPlayer, choiceCom?: number): void {
        const d = this.dialogState.get(p.index);
        if (!d) return;
        if (d.step === NULL_STEP) { p.outPre.push({ kind: 'close' }); this.dialogState.delete(p.index); return; }
        const step = d.step;
        // decode the picked option (1-based) from the raw component: opt = com - root - 1
        const choice = choiceCom !== undefined && step.choiceRoot !== undefined ? choiceCom - step.choiceRoot - 1 : undefined;
        d.page++;
        if (d.page < step.pages) {
            const isChoice = d.page === step.choicePage && step.choiceRoot;
            if (isChoice) this.pushChoiceLabels(p, step);
            else if (step.pageTexts?.[d.page]) p.outPre.push({ kind: 'settext', com: 4885, text: step.pageTexts[d.page]! });
            p.outPre.push(isChoice ? { kind: 'openchat', com: step.choiceRoot! } : { kind: 'openchat', com: 2461 });
            return;
        }
        // final page consumed -> apply the effect (only if a required choice was taken, when present)
        if (step.choicePage !== undefined && step.expectChoice !== undefined && choice !== step.expectChoice) {
            // wrong branch: close without effect (the runner must retry with the right option)
            p.outPre.push({ kind: 'close' }); this.dialogState.delete(p.index);
            this.emitCoop('quest-wrong-choice', { player: p.name, got: choice, want: step.expectChoice });
            return;
        }
        if (step.openShop && d.npcIndex !== undefined && this.shops.has(d.npcIndex)) {
            this.dialogState.delete(p.index);
            p.modal = 3824; p.openShop = d.npcIndex;
            p.outPre.push({ kind: 'openmain', com: 3824 });
            p.outInvs.add(3900).add(3823);
            this.emitCoop('shop-opened', { player: p.name, keeper: d.npcIndex, via: 'dialog' });
            return;
        }
        if (step.fee) {
            if (this.invTotal(p.inv, step.fee.obj) < step.fee.n) {
                this.dialogState.delete(p.index); p.outPre.push({ kind: 'close' });
                if (step.fee.shortMsg) this.msg(p, step.fee.shortMsg);
                this.emitCoop('dialog-fee-short', { player: p.name, obj: step.fee.obj, n: step.fee.n });
                return;
            }
            this.invRemove(p.inv, step.fee.obj, step.fee.n); p.outInvs.add(INV_INTERFACE);
            this.emitCoop('dialog-fee-paid', { player: p.name, obj: step.fee.obj, n: step.fee.n });
        }
        const tp = step.teleportFn ? step.teleportFn(p) : step.teleport;
        if (tp) {
            this.dialogState.delete(p.index); p.outPre.push({ kind: 'close' });
            p.teleport(tp.x, tp.z); p.level = tp.level ?? 0;
            this.emitCoop('dialog-teleport', { player: p.name, to: tp });
            return;
        }
        if (step.delItem) this.invRemove(p.inv, step.delItem, 1);
        if (step.addItem) this.invAdd(p.inv, step.addItem, 1);
        this.questVar.set(step.varp, step.toState);
        if (step.journalComponent !== undefined) {
            const done = step.journalComplete ?? Infinity;
            p.outPre.push({
                kind: 'setcolour', com: step.journalComponent,
                colour: step.toState <= 0 ? JOURNAL_RED : step.toState >= done ? JOURNAL_GREEN : JOURNAL_YELLOW,
            });
        }
        if (step.delItem || step.addItem) p.outInvs.add(INV_INTERFACE);
        p.outPre.push({ kind: 'close' });
        this.dialogState.delete(p.index);
        this.emitCoop('quest-step-done', { player: p.name, varp: step.varp, toState: step.toState, gained: step.addItem ?? null });
    }

    // ---- SHOPS (shop.rs2 + .inv configs: allstock, overstock-pays-0) ------------------------------
    // Minimal model for self-heal/quartermaster logic: op3 on the keeper npc opens modal 3824; buy =
    // invbutton on 3900, sell = invbutton on 3823. allstock=false shops REFUSE items not in their
    // stock base (the Lumbridge trap that blocked the pickless-miner self-heal).
    shops = new Map<number, { stock: Map<number, number>; allstock: boolean; keeperNpcIndex: number; restock?: { id: number; per: number; max: number; last: number } }>();
    addShop(keeperNpcIndex: number, stock: Array<{ id: number; count: number }>, allstock = false, restock?: { id: number; per: number; max: number }) {
        this.shops.set(keeperNpcIndex, { stock: new Map(stock.map(s => [s.id, s.count])), allstock, keeperNpcIndex, restock: restock ? { ...restock, last: 0 } : undefined });
    }
    // Shop restock: +1 of the restock id every `per` ticks up to `max` (models Lowe/Aubury).
    protected restockShops(): void {
        for (const shop of this.shops.values()) {
            const r = shop.restock; if (!r) continue;
            if (this.tick - r.last >= r.per) { r.last = this.tick; const cur = shop.stock.get(r.id) ?? 0; if (cur < r.max) shop.stock.set(r.id, cur + 1); }
        }
    }
    protected shopFor(p: CoopPlayer): { stock: Map<number, number>; allstock: boolean } | null {
        return p.modal === 3824 && p.openShop ? this.shops.get(p.openShop) ?? null : null;
    }
    /** `n` is a QUANTITY, already resolved by the caller from the shop button table (see invButton).
     *  n<=0 is the VALUE/examine click, which moves nothing — but on the SELL side it is NOT inert:
     *  `[inv_button1,shop_template_side:inv]` (shop.rs2:42-48) calls ~can_sell_obj FIRST and answers a
     *  refused item with "You can't sell this item to this shop." before it would ever quote a price.
     *  So the refusal is emitted for the examine click too; only the transfer is skipped. */
    protected shopAction(p: CoopPlayer, n: number, obj: number, com: number): void {
        const shop = this.shopFor(p);
        if (!shop) return;
        if (com === 3823 && !shop.allstock && !shop.stock.has(obj)) {
            this.msg(p, "You can't sell this item to this shop.");
            this.emitCoop('shop-refused', { player: p.name, obj });
            return;
        }
        if (n <= 0) return;
        if (com === 3900) {   // buy
            const have = shop.stock.get(obj) ?? 0;
            const price = this.objCosts.get(obj) ?? 1;
            const coins = this.invTotal(p.inv, COINS);
            const canBuy = Math.min(n, have, Math.floor(coins / Math.max(1, price)));
            if (canBuy <= 0) { this.msg(p, "You don't have enough coins."); return; }
            // shop.rs2 [label,buy_item]: `inv_itemspace2` is checked BEFORE each coin is taken — a buy that does not fit
            // stops with "You don't have enough inventory space." and moves nothing more (no coins lost). A stackable fits
            // if already held or one slot is free; a non-stackable needs a slot per item. (The engine's exact-gp edge,
            // where spending the whole coin stack frees its slot, is not modelled.)
            const fits = this.isStackable(obj)
                ? (this.invTotal(p.inv, obj) > 0 || this.freeSlots(p.inv) > 0 ? canBuy : 0)
                : Math.min(canBuy, this.freeSlots(p.inv));
            if (fits <= 0) { this.msg(p, "You don't have enough inventory space."); this.emitCoop('shop-buy-nospace', { player: p.name, obj }); return; }
            this.invRemove(p.inv, COINS, fits * price);
            const added = this.invAdd(p.inv, obj, fits);
            shop.stock.set(obj, have - added);
            if (fits < canBuy) this.msg(p, "You don't have enough inventory space.");
            p.outInvs.add(INV_INTERFACE).add(3823).add(3900);
            this.emitCoop('shop-buy', { player: p.name, obj, n: added, price });
        } else if (com === 3823) {   // sell (sellability already checked above)
            const have = this.invTotal(p.inv, obj);
            const stocked = shop.stock.get(obj) ?? 0;
            const base = this.objCosts.get(obj) ?? 0;
            const price = stocked > 10 ? 0 : Math.floor(base * 0.4);   // overstock pays ZERO (learnings)
            const nSell = Math.min(n, have);
            if (nSell <= 0) return;
            this.invRemove(p.inv, obj, nSell);
            shop.stock.set(obj, stocked + nSell);
            if (price > 0) this.invAdd(p.inv, COINS, nSell * price);
            p.outInvs.add(INV_INTERFACE).add(3823).add(3900);
            this.emitCoop('shop-sell', { player: p.name, obj, n: nSell, price });
        }
    }
}

// ===================================================================================================
// CoopHarness: SimHarness generalised to N real bots sharing one CoopWorld, ticked in lockstep.
// Each bot gets its own MockStream + ISAAC pair + parser; peers are rendered into its PLAYER_INFO
// with APPEARANCE names so findPlayerIndexByName()/playerWorldTile() work exactly like live.
// ===================================================================================================
interface DrivableBot {
    stream: unknown; inIsaac: unknown; outIsaac: unknown;
    loginUser: string; quiet: boolean;
    mapBuildBaseX: number; mapBuildBaseZ: number;
    localPlayer: { routeX: Int32Array; routeZ: Int32Array };
    tickCount: number;
    run(maxTicks: number): Promise<unknown>;
}

class MockStream {
    private q: number[] = [];
    private wake: (() => void) | null = null;
    private idleWaiters: Array<() => void> = [];
    private parked = false;
    private written: number[] = [];
    push(bytes: Uint8Array) { for (const b of bytes) this.q.push(b); const w = this.wake; this.wake = null; w?.(); }
    async read(): Promise<number> {
        while (this.q.length === 0) {
            this.parked = true;
            for (const w of this.idleWaiters.splice(0)) w();
            await new Promise<void>(r => { this.wake = r; });
            this.parked = false;
        }
        return this.q.shift()!;
    }
    async readBytes(dst: Uint8Array, off: number, len: number): Promise<void> { for (let i = 0; i < len; i++) dst[off + i] = await this.read(); }
    write(data: Uint8Array, len: number): void { for (let i = 0; i < len; i++) this.written.push(data[i]!); }
    waitIdle(timeoutMs = 5000): Promise<void> {
        if (this.parked && this.q.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`coop: bot never finished decoding (${this.q.length} bytes unread) — ISAAC desync?`)), timeoutMs);
            this.idleWaiters.push(() => { clearTimeout(timer); resolve(); });
        });
    }
    takeWritten(): Uint8Array { const out = Uint8Array.from(this.written); this.written = []; return out; }
}

export interface CoopBotSpec {
    bot: DrivableBot;
    /** Equipment worn at login (wearpos -> obj), e.g. [{ wearpos: 'righthand', id: 1271 }] ( the live replay
     *  account WORE its pickaxe; a pack-only setup could not reproduce what the live miner did). */
    worn?: Array<{ wearpos: string; id: number; count?: number }>;
    name: string;
    index: number;          // world player index (0..2046, unique)
    x: number; z: number;
    /**
     * The plane the bot LOGS IN on. Default 0.
     *
     * ⛔ NOT COSMETIC. A player logs back in WHERE IT LOGGED OUT, so "the bot process died while this
     * bot was upstairs" is a real and recurring start state — and it is the one the brains' self-rescue
     * exists for. Without this the sim could only ever boot bots on the ground floor, i.e. it could
     * never exercise the branch whose absence strands a bot upstairs for good.
     */
    level?: number;
    stats?: Array<{ stat: number; xp: number; level: number }>;
    inv?: Array<{ id: number; count: number }>;   // starting backpack (world + client kept in sync)
    bank?: Array<{ id: number; count: number }>;  // starting bank stock
    /** NETWORK LATENCY in ticks (default 0): every server->client batch reaches this bot N ticks late, so the brain decides
     *  on N-tick-old state — the live network shape. ( an instant bank hid a withdraw-X double-withdraw that wedged
     *  a live smelter; races between "reply sent" and "pack updated" only exist with a delay.) */
    latency?: number;
}

export interface CoopTickResult {
    tick: number;
    events: SimEvent[];
    actions: Map<string, ClientAction[]>;   // by bot name
}

export class CoopHarness {
    readonly world: CoopWorld;
    private entries: Array<{
        spec: CoopBotSpec;
        player: CoopPlayer;
        stream: MockStream;
        enc: ServerPacketStream;
        parser: ClientActionParser;
        tracked: number[];
        prev: { x: number; z: number };
        pending: ClientAction[];
        runPromise: Promise<unknown> | null;
        delayQ?: Array<{ due: number; pkts: Uint8Array[] }>;
        seenSpawnObjs?: Set<string>;
        /** the build area's centre zone at the last REBUILD_NORMAL sent (BuildArea.ts originX/Z) — see playerInfoPackets */
        centre?: { x: number; z: number };
    }> = [];
    private ticks = 0;

    constructor(world: CoopWorld) { this.world = world; }

    add(spec: CoopBotSpec): void {
        const player = this.world.addPlayer(spec.index, spec.name, spec.x, spec.z, spec.level ?? 0);
        const inSeed = [11, 22, 33, 44 + spec.index], outSeed = [55, 66, 77, 88 + spec.index];
        const stream = new MockStream();
        spec.bot.stream = stream;
        spec.bot.inIsaac = new Isaac(new Int32Array(inSeed));
        spec.bot.outIsaac = new Isaac(new Int32Array(outSeed));
        spec.bot.loginUser = spec.name;
        spec.bot.quiet = true;
        for (const s of spec.inv ?? []) this.world.invAdd(player.inv, s.id, s.count);
        for (const w of spec.worn ?? []) {
            const wp = normWearpos(w.wearpos);   // a typo would silently never transmit -> throws
            player.worn.set(wp, { id: w.id, count: w.count ?? 1 }); player.outInvs.add(WORN_INV);
        }
        for (const s of spec.bank ?? []) player.bank.set(s.id, s.count);
        for (const s of spec.stats ?? []) player.stats.set(s.stat, { xp: s.xp, level: s.level });
        // combat level (Player.ts:1351) from whatever stats were given (defaults 1/hp 10)
        const lv = (i: number, d: number) => player.stats.get(i)?.level ?? d;
        player.maxHp = lv(3, 10); player.hp = player.maxHp;
        player.combatLevel = Math.floor(0.325 * (lv(0, 1) + lv(2, 1)) + 0.25 * (lv(1, 1) + lv(3, 10) + Math.floor(lv(5, 1) / 2)));
        this.entries.push({
            spec, player, stream,
            enc: new ServerPacketStream(inSeed),
            parser: new ClientActionParser(outSeed),
            tracked: [], prev: { x: spec.x, z: spec.z }, pending: [], runPromise: null,
        });
    }

    async start(): Promise<void> {
        for (const e of this.entries) {
            const { x, z } = e.player;
            const zoneX = x >> 3, zoneZ = z >> 3;
            const baseX = (zoneX - 6) * 8, baseZ = (zoneZ - 6) * 8;
            e.centre = { x: zoneX, z: zoneZ };
            const batch: Uint8Array[] = [
                e.enc.rebuildNormal(zoneX, zoneZ),
                // `level` from the player, not a literal 0: `minusedlevel` is only ever assigned by an
                // op-3 (teleport) PLAYER_INFO, so this packet is the ONLY thing that tells a booting
                // brain which floor it woke up on.
                e.enc.playerInfo({ kind: 'teleport', level: e.player.level, localX: x - baseX, localZ: z - baseZ, jump: true }),
            ];
            for (const s of e.spec.stats ?? []) batch.push(e.enc.updateStat(s.stat, s.xp, s.level));
            batch.push(e.enc.updateInvFull(INV_INTERFACE, this.slotsFor(e.player, INV_INTERFACE)));
            e.runPromise = e.spec.bot.run(Number.MAX_SAFE_INTEGER).catch(err => console.error(`[coop] ${e.spec.name} run() died:`, err));
            for (const p of batch) e.stream.push(p);
            await e.stream.waitIdle();
            e.parser.parse(e.stream.takeWritten());   // discard the pre-world first flush
        }
    }

    // Resolve a viewer-dependent inv com into concrete slots.
    private slotsFor(p: CoopPlayer, com: number): Array<{ id: number; count: number }> {
        const flat = (inv: Slot[]) => inv.map(s => (s ? { id: s.id, count: s.count } : { id: -1, count: 0 }));
        if (com === INV_INTERFACE || com === BANK_SIDE_INV || com === TRADESIDE_INV) return flat(p.inv);
        if (com === TRADEMAIN_INV) return flat(p.tradeoffer);
        if (com === TRADEMAIN_OTHERINV) {
            const other = this.world.playersByIndex.get(p.tradePartner);
            return other ? flat(other.tradeoffer) : [];
        }
        if (com === BANK_INV) return this.world.bankSlots(p);
        if (com === 3900) {   // shop stock
            const shop = p.openShop >= 0 ? this.world.shops.get(p.openShop) : null;
            return shop ? [...shop.stock].map(([id, count]) => ({ id, count })) : [];
        }
        if (com === 3823) return flat(p.inv);   // shop side inv = backpack mirror
        if (com === WORN_INV) {                 // wornitems:wear — the equipment inv LeanBot.isWorn reads (engine wearpos order)
            const out = Array.from({ length: 14 }, () => ({ id: -1, count: 0 }));
            for (const [pos, it] of p.worn) { const i = WEARPOS.indexOf(pos); if (i >= 0) out[i] = { id: it.id, count: it.count }; }
            return out;
        }
        return [];
    }

    async tick(): Promise<CoopTickResult> {
        this.ticks++;
        // 1. world applies what every bot sent last tick
        const actions = new Map<number, ClientAction[]>();
        for (const e of this.entries) { actions.set(e.spec.index, e.pending); e.pending = []; }
        const events = this.world.coopTick(actions);

        // 2. encode each bot's view of the tick (encode order == push order per stream)
        for (const e of this.entries) {
            const p = e.player;
            const batch: Uint8Array[] = [];
            for (const o of p.outPre.splice(0)) {
                if (o.kind === 'msg') batch.push(e.enc.messageGame(o.text));
                else if (o.kind === 'openmainside') batch.push(e.enc.ifOpenMainSide(o.main, o.side));
                else if (o.kind === 'openmain') batch.push(e.enc.ifOpenMain(o.com));
                else if (o.kind === 'close') batch.push(e.enc.ifClose());
                else if (o.kind === 'openchat') batch.push(e.enc.ifOpenChat(o.com));
                else if (o.kind === 'countdialog') batch.push(e.enc.pCountDialog());
                else if (o.kind === 'setcolour') batch.push(e.enc.ifSetColour(o.com, o.colour));
                else if (o.kind === 'settext') batch.push(e.enc.ifSetText(o.com, o.text));
                else if (o.kind === 'varp') batch.push(e.enc.varp(o.id, o.value));
            }
            // A door/portal that opened this tick -> emit the real zone LOC_DEL (before PLAYER_INFO, so
            // the bot's DoorTracker is updated before its brain runs). This exercises the FULL live path
            // offline: world opens door -> zone packet -> LeanBot zone decode -> tracker flips.
            for (const ev of events) {
                if (ev.kind !== 'door-opened' && ev.kind !== 'portal-opened') continue;
                const ex = ev.detail.x as number, ez = ev.detail.z as number;
                if (Math.abs(ex - p.x) > 20 || Math.abs(ez - p.z) > 20) continue;   // in the bot's scene
                const { zx, zz, op } = ServerPacketStream.zoneDoorOp(ex, ez, e.spec.bot.mapBuildBaseX, e.spec.bot.mapBuildBaseZ, 'del');
                batch.push(e.enc.zoneEnclosed(zx, zz, [op]));
            }
            // GROUND ITEMS. A kill's own drop reaches the killer on the RECEIVER-SCOPED path —
            // UPDATE_ZONE_PARTIAL_FOLLOWS then a standalone OBJ_ADD (protocol.ts:233-247) — which is a
            // different decode branch from the shared ENCLOSED reveal. Emitting the real pair is what
            // makes `findGroundItem`/`tryTakeLoot` exercisable offline at all.
            for (const ev of events) {
                if (ev.kind !== 'npc-killed' && ev.kind !== 'obj-taken') continue;
                const ex = ev.detail.x as number, ez = ev.detail.z as number;
                if (Math.abs(ex - p.x) > 20 || Math.abs(ez - p.z) > 20) continue;
                const tile = { x: ex, z: ez };
                const bx = e.spec.bot.mapBuildBaseX, bz = e.spec.bot.mapBuildBaseZ;
                batch.push(e.enc.zonePartialFollows(tile, bx, bz));
                batch.push(ev.kind === 'npc-killed'
                    ? e.enc.objAdd(tile, ev.detail.drop as number, 1, bx, bz)
                    : e.enc.objDel(tile, ev.detail.obj as number, bx, bz));
            }
            // STATIC SPAWN OBJS (addObjSpawn): reveal a present spawn obj ONCE per presence to every viewer within 20 tiles
            // (the zone full-follows a client gets on entering / the OBJ_ADD on a respawn); a take or leaving range forgets it.
            if (this.world.objSpawns.length) {
                const seen = (e.seenSpawnObjs ??= new Set<string>());
                for (const ev of events) if (ev.kind === 'obj-taken') seen.delete(`${ev.detail.x},${ev.detail.z},${ev.detail.obj}`);
                for (const g of this.world.groundObjs) {
                    if (!this.world.isSpawnObj(g)) continue;
                    const k = `${g.x},${g.z},${g.obj}`;
                    if (Math.abs(g.x - p.x) > 20 || Math.abs(g.z - p.z) > 20 || p.level !== 0) { seen.delete(k); continue; }
                    if (seen.has(k)) continue;
                    seen.add(k);
                    const bx = e.spec.bot.mapBuildBaseX, bz = e.spec.bot.mapBuildBaseZ;
                    batch.push(e.enc.zonePartialFollows(g, bx, bz));
                    batch.push(e.enc.objAdd(g, g.obj, g.count, bx, bz));
                }
            }
            batch.push(...this.playerInfoPackets(e));
            batch.push(this.npcInfoPacket(e));
            for (const com of p.outInvs) batch.push(e.enc.updateInvFull(com, this.slotsFor(p, com)));
            p.outInvs.clear();
            for (const stat of p.outStats.splice(0)) {
                const s = p.stats.get(stat);
                if (s) batch.push(e.enc.updateStat(stat, Math.floor(s.xp), s.level));   // wire xp = DISPLAYED xp: UpdateStatEncoder p4(exp / 10) of the engine's tenths (and the same unit start() sends)
            }
            const lat = Math.max(0, e.spec.latency ?? 0);
            if (lat === 0) { for (const pkt of batch) e.stream.push(pkt); }
            else {
                (e.delayQ ??= []).push({ due: this.ticks + lat, pkts: batch });
                while (e.delayQ.length && e.delayQ[0]!.due <= this.ticks) for (const pkt of e.delayQ.shift()!.pkts) e.stream.push(pkt);
            }
        }

        // 3. every brain runs; collect what each sent
        const byName = new Map<string, ClientAction[]>();
        for (const e of this.entries) {
            await e.stream.waitIdle();
            const acts = e.parser.parse(e.stream.takeWritten());
            e.pending = acts;
            byName.set(e.spec.name, acts);
            this.observe(e.spec.name, acts);
        }
        return { tick: this.ticks, events, actions: byName };
    }

    // ---- LIVELOCK / CADENCE INSTRUMENTATION (standing watchdogs; the re-plan storm class) ---------
    // Violations accumulate per run; tests assert `h.violations` is empty (or filter by type).
    violations: Array<{ tick: number; bot: string; type: string; detail: string }> = [];
    private obsState = new Map<string, { lastBytesTick: number; moveHistory: Array<{ tick: number; dest: string }> }>();
    private violationCfg = { silentTicks: 200, moveSpamWindow: 20, moveSpamCount: 8 };
    private observe(name: string, acts: ClientAction[]): void {
        let st = this.obsState.get(name);
        if (!st) { st = { lastBytesTick: 0, moveHistory: [] }; this.obsState.set(name, st); }
        if (acts.length > 0) st.lastBytesTick = this.ticks;
        // SILENT BOT: the live server force-logs-out after 1000 quiet ticks — every waiting path must
        // warm(). 200 sim ticks of zero output = a brain path that forgot.
        if (this.ticks - st.lastBytesTick >= this.violationCfg.silentTicks) {
            this.violations.push({ tick: this.ticks, bot: name, type: 'silent-bot', detail: `${this.ticks - st.lastBytesTick} ticks without any client packet (idle-kick risk)` });
            st.lastBytesTick = this.ticks;   // rearm, don't spam
        }
        for (const a of acts) {
            if (a.type !== 'move') continue;
            const dest = a.path[a.path.length - 1]!;
            st.moveHistory.push({ tick: this.ticks, dest: `${dest.x},${dest.z}` });
        }
        st.moveHistory = st.moveHistory.filter(m => this.ticks - m.tick <= this.violationCfg.moveSpamWindow);
        const byDest = new Map<string, number>();
        for (const m of st.moveHistory) byDest.set(m.dest, (byDest.get(m.dest) ?? 0) + 1);
        for (const [dest, n] of byDest) {
            if (n >= this.violationCfg.moveSpamCount) {
                this.violations.push({ tick: this.ticks, bot: name, type: 'move-spam', detail: `${n} MOVEs to (${dest}) in ${this.violationCfg.moveSpamWindow} ticks` });
                st.moveHistory = st.moveHistory.filter(m => m.dest !== dest);
            }
        }
    }
    // Wrap a bot's injected planner with a call counter; assert against re-plan storms.
    plannerCalls = new Map<string, number>();
    instrumentPlanner(name: string, bot: { findLongPathFn: ((...a: never[]) => unknown) | null }): void {
        const inner = bot.findLongPathFn;
        if (!inner) return;
        this.plannerCalls.set(name, 0);
        bot.findLongPathFn = ((...args: never[]) => {
            this.plannerCalls.set(name, (this.plannerCalls.get(name) ?? 0) + 1);
            return (inner as (...a: never[]) => unknown)(...args);
        }) as never;
    }

    async run(n: number): Promise<CoopTickResult[]> {
        const out: CoopTickResult[] = [];
        for (let i = 0; i < n; i++) out.push(await this.tick());
        return out;
    }

    async stop(): Promise<void> {
        for (const e of this.entries) {
            for (const q of (e.delayQ ?? []).splice(0)) for (const pkt of q.pkts) e.stream.push(pkt);   // latency: deliver what is in flight first
            e.stream.push(e.enc.logout()); await e.runPromise;
        }
    }

    playerOf(name: string): CoopPlayer { return this.entries.find(e => e.spec.name === name)!.player; }
    invCount(name: string, id: number): number { const p = this.playerOf(name); return this.world.invTotal(p.inv, id); }
    // Force-inject a client action for the next tick (tests use it to script behaviours a healthy
    // brain would never emit — e.g. a MOVE mid-trade to exercise the decline rule).
    inject(name: string, action: ClientAction): void { this.entries.find(e => e.spec.name === name)!.pending.push(action); }

    private npcTracked = new Map<string, number[]>();
    private npcInfoPacket(e: { player: CoopPlayer; enc: ServerPacketStream; spec: CoopBotSpec }): Uint8Array {
        const p = e.player;
        const tracked = this.npcTracked.get(e.spec.name) ?? [];
        const inView = (nx: number, nz: number) => nx - p.x >= -16 && nx - p.x <= 15 && nz - p.z >= -16 && nz - p.z <= 15;
        const existing: NpcTickUpdate[] = [];
        const nextTracked: number[] = [];
        const adds: Array<Extract<NpcTickUpdate, { kind: 'add' }>> = [];
        for (const idx of tracked) {
            const npc = this.world.npcs.get(idx);
            if (!npc || !inView(npc.x, npc.z) || npc.teleported) { existing.push({ kind: 'remove' }); continue; }
            const s = npc.steps;
            if (s.length === 0) existing.push({ kind: 'keep' });
            else existing.push({ kind: 'walk', dir: dirCode(s[0]![0], s[0]![1]) });
            nextTracked.push(idx);
        }
        for (const [idx, npc] of this.world.npcs) {
            if (nextTracked.includes(idx) || !inView(npc.x, npc.z)) continue;
            adds.push({ kind: 'add', index: idx, typeId: npc.typeId, relX: npc.x - p.x, relZ: npc.z - p.z });
            nextTracked.push(idx);
        }
        this.npcTracked.set(e.spec.name, nextTracked);
        return e.enc.npcInfo(existing, adds);
    }

    // Local movement + peer rendering for one viewer.
    private playerInfoPackets(e: { player: CoopPlayer; prev: { x: number; z: number }; tracked: number[]; enc: ServerPacketStream; spec: CoopBotSpec; centre?: { x: number; z: number } }): Uint8Array[] {
        const p = e.player;
        const steps = p.steps;
        const moved = p.x !== e.prev.x || p.z !== e.prev.z;
        e.prev = { x: p.x, z: p.z };
        let local: Parameters<ServerPacketStream['playerInfoFull']>[0];
        const out: Uint8Array[] = [];
        if (!moved && !p.teleported) local = { kind: 'none' };
        else if (steps.length === 1) local = { kind: 'walk', dir: dirCode(steps[0]![0], steps[0]![1]) };
        else if (steps.length === 2) local = { kind: 'run', dir1: dirCode(steps[0]![0], steps[0]![1]), dir2: dirCode(steps[1]![0], steps[1]![1]) };
        else {
            let localX = p.x - e.spec.bot.mapBuildBaseX, localZ = p.z - e.spec.bot.mapBuildBaseZ;
            if (localX < 0 || localX > 127 || localZ < 0 || localZ > 127) {
                const zoneX = p.x >> 3, zoneZ = p.z >> 3;
                out.push(e.enc.rebuildNormal(zoneX, zoneZ));
                e.centre = { x: zoneX, z: zoneZ };
                localX = p.x - (zoneX - 6) * 8; localZ = p.z - (zoneZ - 6) * 8;
            }
            local = { kind: 'teleport', level: p.level, localX, localZ, jump: true };
        }
        // WALKING OUT OF THE BUILD AREA: the engine re-centres the scene
        // whenever the player stands outside zones centre-4 .. centre+4 (BuildArea.rebuildNormal, checked every cycle), and the
        // client rebases its entities (leanclient REBUILD_NORMAL). The sim only re-centred on a teleport, so a long WALK (Musa
        // Point landing -> the volcano monkeys, ~80 tiles) kept the old base and every OBJ_ADD/zone packet decoded 256 tiles off.
        // Same box as the engine; the walk/run step itself stays a walk (the client shifted its route on the rebuild).
        if ((local.kind === 'walk' || local.kind === 'run') && e.centre) {
            const c = e.centre;
            if (p.x < (c.x - 4) << 3 || p.z < (c.z - 4) << 3 || p.x > ((c.x + 5) << 3) - 1 || p.z > ((c.z + 5) << 3) - 1) {
                const zoneX = p.x >> 3, zoneZ = p.z >> 3;
                out.push(e.enc.rebuildNormal(zoneX, zoneZ));
                e.centre = { x: zoneX, z: zoneZ };
            }
        }

        // Peer gather, engine-faithful: SAME LEVEL + in the scene box, then the NEAREST 250 (the BuildArea
        // cap). In a crowd bigger than the cap, a peer beyond the 250 nearest is NOT rendered -> the viewer
        // can't resolve it by name -> a trade with it can't start. Level scoping means an upper floor never
        // gathers the ground-floor crowd. (With <=250 same-level peers the slice is a no-op — existing
        // 2-bot tests are unchanged.)
        const inView = (q: CoopPlayer) => q.level === p.level
            && q.x - p.x >= -16 && q.x - p.x <= 15 && q.z - p.z >= -16 && q.z - p.z <= 15;
        const cheb = (q: CoopPlayer) => Math.max(Math.abs(q.x - p.x), Math.abs(q.z - p.z));
        const candidates = [...this.world.playersByIndex].filter(([idx, q]) => idx !== e.spec.index && inView(q));
        candidates.sort((a, b) => cheb(a[1]) - cheb(b[1]));
        const visibleIdx = new Set(candidates.slice(0, PREFERRED_PLAYERS).map(([idx]) => idx));
        const trackedUpdates: PeerTickUpdate[] = [];
        const nextTracked: number[] = [];
        for (const idx of e.tracked) {
            const q = this.world.playersByIndex.get(idx);
            if (!q || !visibleIdx.has(idx) || q.teleported) { trackedUpdates.push({ kind: 'remove' }); continue; }
            const s = q.steps;
            if (s.length === 0) trackedUpdates.push({ kind: 'keep' });
            else if (s.length === 1) trackedUpdates.push({ kind: 'walk', dir: dirCode(s[0]![0], s[0]![1]) });
            else trackedUpdates.push({ kind: 'run', dir1: dirCode(s[0]![0], s[0]![1]), dir2: dirCode(s[1]![0], s[1]![1]) });
            nextTracked.push(idx);
        }
        const adds: Array<Extract<PeerTickUpdate, { kind: 'add' }>> = [];
        for (const [idx, q] of candidates) {
            // fillers are counted in visibleIdx (the cap) above but never rendered — see CoopPlayer.filler.
            if (q.filler || !visibleIdx.has(idx) || nextTracked.includes(idx)) continue;
            adds.push({ kind: 'add', index: idx, relX: q.x - p.x, relZ: q.z - p.z, appearance: q.name });
            nextTracked.push(idx);
        }
        e.tracked = nextTracked;
        out.push(e.enc.playerInfoFull(local, trackedUpdates, adds));
        return out;
    }
}

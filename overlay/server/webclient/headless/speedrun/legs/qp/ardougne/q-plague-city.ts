// q-plague-city.ts — Plague City (quest_elena), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/): quests/quest_elena/scripts/*.rs2, areas/area_ardougne_west/scripts/{clerk,
// doors,manhole,mourner}.rs2. Stage varp %elenaquest (quest_elena.constant:1-21), NOT transmitted: every step gates on
// an observable (item, position, dialog text, qp).
//
// Flow (each line = one stage, file:line):
//   Edmond "What's happened to her?" / "Can I help find her?"            -> started        edmond.rs2:8,66,79
//   Alrena with dwellberries -> gasmask (worn from here on)               -> gasmask        alrena.rs2:16-25
//   picture: ground spawn elena_picture (2576,3334) in Edmond's house      (map m40_52 OBJ; Jethick needs it, jethick.rs2:18)
//   Edmond again                                                          -> mud patch      edmond.rs2:22
//   4x bucket_water on the mud patch (2566,3331..3333)                    -> mud patch 1..4 mud_patch.rs2:28-46
//   spade on the mud patch: telejump into the sewer (2562,9737)           -> opened_tunnel  mud_patch.rs2:23-26
//   rope on the sewer pipe (2530,9701)                                    -> tied_rope      sewerpipe.rs2:19-26
//   Edmond (sewer, 2535,9719)                                             -> opened_pipe    edmond.rs2:27-32
//   search the pipe WITH the gas mask worn: telejump to W Ardougne (2529,3304)            sewerpipe.rs2:1-9,32-48
//   Jethick (2540,3305) "I'm looking for a woman from East Ardougne." + picture -> shown_picture + turnip book  jethick.rs2:13-29
//   Rehnisons' door (2531,3328) with the book (Ted inside)                -> returned_book  doors.rs2:95-117
//   Ted / Martha                                                          -> spoken_martha_ted rehnisons.rs2:14-21
//   Milli (upstairs, stairs 2527,3332)                                    -> spoke_to_milli rehnisons.rs2:38-44
//   plague house door (2533,3272) "I fear not a mere plague."             -> spoke_to_plague_house doors.rs2:14-21,81-90
//   Clerk (2528,3317) "I need permission..." / "This is urgent though!"   -> spoke_to_clerk clerk.rs2:27-55
//   Bravek's door (2530,3314); Bravek "This is really important though!" / "Do you know what is in the cure?" -> spoke_to_bravek
//   hangover cure (snape grass on chocolaty milk, cakes.rs2:20-23,138-143) to Bravek, "They won't listen to me!" -> warrant
//                                                                         -> spoke_cured_bravek bravek.rs2:55-95
//   plague house door with the warrant (mourner within 14)                doors.rs2:23-51
//   barrel (2534,3268) -> key; stairs down (2536,3268); gate (2539,9672) with the key; Elena (2541,9672) -> freed_elena
//   back: gate, stairs up, door, manhole (2529,3303) -> sewer, mud pile (2561,9738) -> garden, Edmond -> complete
//                                                                         quest_elena.rs2:5-15 (mining 24,250 tenths)
//   read the magic scroll (Ardougne Teleport unlocked)                    -> elena_complete_read_scroll elena_teleport_scroll.rs2
// ORDER TRAP: once Biohazard has started, the mud patch refuses the dig (mud_patch.rs2:15): do this quest first.
import { SpeedBot, objId } from '../../../core.js';
import { qp, inDialog, dismiss, locAt, useOnLocGo, opLocGo, nav, trace, npc } from '../../q-lib.js';
import { cheb } from '../../../core.js';
import { isResuming, journalStage, failHook } from '../journal.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, allText, opLocUntil, useOnLocUntil, pickup, wear, combine, textWatch, deathWatch, walkLive, StepError } from './ar-lib.js';

export const QUEST = { name: 'Plague City', dir: 'quest_elena', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // no skill checks in quest_elena (grep stat( / stat_base(: none)
    start: { x: 2569, z: 3333, level: 0 },              // outside Edmond's house door (2570,3333), East Ardougne
    end: { x: 2568, z: 3333, level: 0 },
};
/** chocolaty_milk = bucket_milk + chocolate_dust pre-mixed (cakes.rs2:16,131-136; one less step in the quest).
 *  spade: carried (the house ground spawn at 2574,3331 is shared with other players). */
export const SUPPLY: Item[] = [
    { name: 'dwellberries', n: 1 }, { name: 'rope', n: 1 }, { name: 'spade', n: 1 }, { name: 'bucket_water', n: 4 },
    { name: 'chocolaty_milk', n: 1 }, { name: 'snape_grass', n: 1 },
];

const EDMOND = 714, ALRENA = 710, JETHICK = 725, TED = 721, MARTHA = 722, MILLI = 724, CLERK = 713, BRAVEK = 711, ELENA_P = 715;
const EDMOND_AT = { x: 2568, z: 3334 }, ALRENA_AT = { x: 2573, z: 3333 }, PICTURE_AT = { x: 2576, z: 3334 };
const SEWER_EDMOND_AT = { x: 2535, z: 9719 }, JETHICK_AT = { x: 2540, z: 3305 };
const MUD = { id: 2531, x: 2566, z: 3331 }, PIPE = { id: 2541, x: 2530, z: 9701 };
const REHN_DOOR = { id: 2537, x: 2531, z: 3328 }, REHN_UP = { id: 2539, x: 2527, z: 3332 }, REHN_DOWN = { id: 2540, x: 2527, z: 3332, level: 1 };
const PLAGUE_DOOR = { id: 2535, x: 2533, z: 3272 }, BRAVEK_DOOR = { id: 2528, x: 2530, z: 3314 };
const BARREL = { id: 2530, x: 2534, z: 3268 }, PH_DOWN = { id: 2522, x: 2536, z: 3268 }, PH_UP = { id: 2523, x: 2536, z: 9671 };
const ELENA_GATE = { id: 2526, x: 2539, z: 9672 }, MANHOLE_CLOSED = { id: 2543, x: 2529, z: 3303 }, MANHOLE_OPEN = 2544;
const MUD_PILE = { id: 2533, x: 2561, z: 9738 }, MANHOLE_STAND = { x: 2530, z: 3303 };
const CLERK_AT = { x: 2528, z: 3317 }, CLERK_STAND = { x: 2529, z: 3317 }, BRAVEK_AT = { x: 2536, z: 3314 }, ELENA_AT = { x: 2541, z: 9672 };

const inSewer = (b: SpeedBot) => b.tile().z > 9000;
const inWest = (b: SpeedBot) => { const t = b.tile(); return !inSewer(b) && t.x <= 2557 && t.z <= 3340 && t.z >= 3260; };
/** W Ardougne plague house interior (door on the S edge of 2533,3272: inside = z <= 3271). */
const inPlagueHouse = (b: SpeedBot) => { const t = b.tile(); return !inSewer(b) && t.x >= 2530 && t.x <= 2540 && t.z >= 3265 && t.z <= 3271; };
/** Rehnisons' house: door on the N edge of (2531,3328) -> inside = z >= 3329. */
const inRehnisons = (b: SpeedBot) => { const t = b.tile(); return t.x >= 2525 && t.x <= 2536 && t.z >= 3329 && t.z <= 3336; };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }> {
    await nav();
    const c = ctx(bot, o.log ?? true);
    trace(bot, c.t0);
    const qp0 = qp(bot);
    bot.holdDialogs = true;
    const dw = deathWatch(c);
    try {
        await body(c, qp0, dw.dead);
        return { ok: true, ticks: bot.tickCount - c.t0, msg: `quest points ${qp0} -> ${qp(bot)}`, marks: c.marks };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - c.t0, msg: (e as Error).message, marks: c.marks };
    } finally { dw.stop(); bot.holdDialogs = false; }
}

/** session 10 resume: the quest JOURNAL (quest_elena/scripts/elena_journal.rs2) -> %elenaquest stage, first match wins (latest
 *  stage first). 20/21 and 24/25 read the same; the blocks below handle both. */
const PL_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 99], [/talk to\s+Edmond\s+again/i, 28], [/Plague House\s+and find\s+Elena/i, 27],
    [/bring\s+Bravek\s+the\s+Hangover/i, 26], [/clearance from either the\s+Head Mourner/i, 24], [/access to the\s+Plague House/i, 23],
    [/Milli\s+may have seen/i, 22], [/he thinks\s+Elena\s+was staying/i, 20], [/old family friend named\s+Jethick/i, 10],
    [/rope to the sewer grill/i, 9], [/find a way out of the sewers/i, 8], [/dig a tunnel/i, 7], [/to soften the ground/i, 3],
    [/about getting into\s+West/i, 2], [/Dwellberries/i, 1],
];
/** the sewer under Edmond's garden (pipe 2530,9701; Edmond 2535,9719; mud pile 2561,9738) */
const inElenaSewer = (b: SpeedBot) => { const t = b.tile(); return t.z > 9000 && t.x >= 2500 && t.x <= 2575 && t.z >= 9690 && t.z <= 9760; };
/** the plague house basement (stairs 2536,9671; Elena's gate 2539,9672) */
const inPHBasement = (b: SpeedBot) => { const t = b.tile(); return t.z > 9000 && t.x >= 2528 && t.x <= 2550 && t.z >= 9660 && t.z < 9690; };

async function body(c: Ctx, qp0: number, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(`plague:${label}`); };
    // never assume an empty pack: drop nothing we need; the launcher has dropped the tutorial kit
    // route runner: a retry after only the last step failed (Elena freed: warrant + key held, back in
    // East Ardougne) resumes at Edmond. The inputs are spent, so the full start failed 'missing dwellberries'.
    if (bot.count('warrant') && bot.count('elenakey') && !inSewer(bot) && bot.tile().x > 2557 && bot.tile().z > 3300) return finishEdmond(c, need);
    // session 10: on a retry, resume at the stage the journal shows (PL_RESUME=0 = always from the top)
    let st = 0;
    if (isResuming(bot) && process.env.PL_RESUME !== '0') {
        dismiss(bot);
        st = await journalStage(bot, 'elena', PL_STAGES, 0, s => console.log(`[plague] ${s}`));
        console.log(`[plague] resume at stage ${st} @${JSON.stringify(bot.pos())}`);
        if (st >= 99) { await readScroll(c); return; }
    }
    const R = st > 0;   // a journal resume (a fresh start runs exactly as before)
    if (!R) for (const it of SUPPLY) if (bot.count(it.name) < it.n && !(it.name === 'chocolaty_milk' && bot.count('hangover_cure'))) fail(c, `missing ${it.name} ${bot.count(it.name)}/${it.n}`);
    const maskOn = async () => { if (bot.count('gasmask') && !bot.isWorn(objId('gasmask'))) { dismiss(bot); await wear(bot, ['gasmask']); } };
    /** resume only: from East Ardougne into the sewer (the dug mud patch telejumps us down at any stage >= 7) */
    const toSewer = async () => {
        if (inSewer(bot)) return;
        await bot.walkTo(MUD.x + 1, MUD.z, { near: 1, closeDoors: true, maxTicks: 200, log: false });
        need(await useOnLocUntil(c, 'spade', MUD, () => inSewer(bot), { label: 'dig-resume' }), 'dig-resume');
        dismiss(bot);
    };
    /** resume only: into West Ardougne through the pipe (gas mask worn) */
    const toWest = async () => {
        if (inWest(bot) || inPHBasement(bot)) return;
        if (!inElenaSewer(bot)) await toSewer();
        await maskOn();
        need(await opLocUntil(c, PIPE, 1, () => inWest(bot), { label: 'pipe-resume', maxTicks: 6 }), 'pipe-resume');
    };
    if (R) {
        await maskOn();
        if (st <= 26 && !bot.count('hangover_cure') && bot.count('snape_grass') && bot.count('chocolaty_milk')) { await combine(bot, 'snape_grass', 'chocolaty_milk', () => bot.count('hangover_cure') > 0); dismiss(bot); }
        if (st >= 3 && st <= 10 && !bot.count('elena_picture') && !inSewer(bot) && !inWest(bot)) need(await pickup(c, 'elena_picture', PICTURE_AT), 'picture');
        if (st >= 8 && st <= 9) await toSewer();
        if (st >= 10 && st <= 27) await toWest();
    }

    if (st <= 0) {
    // 1. Edmond: start. Observable: Alrena's gas mask (next step) only works at stage started.
    const started = textWatch(bot, /The only place I know is McGrubor's Wood/i);
    need(await talkTo(c, EDMOND, EDMOND_AT, [/^What's happened to her\?$/, /^Can I help find her\?$/], () => started() && !inDialog(bot), { label: 'edmond-start' }), 'edmond-start');
    }
    if (st <= 1) {
    // 2. Alrena: gas mask (2 p_delay(2) inside; the stage is set before the last 3 pages, so we leave them open)
    need(await talkTo(c, ALRENA, ALRENA_AT, [/.*/], () => bot.count('gasmask') > 0, { label: 'alrena-gasmask' }), 'alrena-gasmask');
    dismiss(bot);
    await wear(bot, ['gasmask']);
    }
    if (st <= 2) {
    // 3. picture (ground spawn next to Alrena), hangover cure while we are at it
    if (!bot.count('elena_picture')) need(await pickup(c, 'elena_picture', PICTURE_AT), 'picture');
    if (!bot.count('hangover_cure')) { await combine(bot, 'snape_grass', 'chocolaty_milk', () => bot.count('hangover_cure') > 0); dismiss(bot); }
    // 4. Edmond: the mud patch plan (stage set after his first page)
    const dig = textWatch(bot, /pour on some buckets of water/i);
    need(await talkTo(c, EDMOND, EDMOND_AT, [/.*/], () => dig(), { label: 'edmond-mud' }), 'edmond-mud');
    dismiss(bot);
    }
    if (st <= 6) {
    // 5. four buckets, then the spade
    // (resume: the stage inside 3..6 is not in the journal; pour until the soil reports soft enough)
    const soft = textWatch(bot, /soil is now soft enough|soft enough already/i);
    for (let k = 0; k < 8 && bot.count('bucket_water') > 0 && !inSewer(bot) && !soft(); k++) {
        const n0 = bot.count('bucket_water');
        const l = locAt(MUD.id, MUD.x, MUD.z);
        dismiss(bot);
        const tiles = useOnLocGo(bot, 'bucket_water', l);
        await bot.until(() => bot.count('bucket_water') < n0 || inDialog(bot), Math.ceil(tiles / 2) + 6);
        if (bot.count('bucket_water') === n0 && inDialog(bot)) { await finishDialog(bot); }
        // route runner: with the house doors in a non-default state the bare use-on-loc route never reaches the
        // garden (sims qrd2m/qrd4m: 'buckets not poured'); core walkTo opens/closes doors on the way (probe-mud: 9 t)
        else if (bot.count('bucket_water') === n0) await bot.walkTo(MUD.x + 1, MUD.z, { near: 1, closeDoors: true, maxTicks: 80, log: false });
    }
    if (bot.count('bucket_water') > 0 && !soft()) fail(c, 'buckets not poured (stage not mud patch?)');
    if (R) dismiss(bot);
    mark(c, 'poured'); failHook('plague:poured');
    }
    if (st <= 7) {
    if (R && !inSewer(bot)) await bot.walkTo(MUD.x + 1, MUD.z, { near: 1, closeDoors: true, maxTicks: 200, log: false });
    need(await useOnLocUntil(c, 'spade', MUD, () => inSewer(bot), { label: 'dig' }), 'dig');
    dismiss(bot);
    }
    if (st <= 8) {
    // 6. sewer: rope on the pipe, Edmond pulls, through the pipe (gas mask worn)
    need(await useOnLocUntil(c, 'rope', PIPE, () => bot.count('rope') === 0, { label: 'rope' }), 'rope');
    dismiss(bot);
    }
    if (st <= 9) {
    const pulled = textWatch(bot, /That's done the job/i);
    need(await talkTo(c, EDMOND, SEWER_EDMOND_AT, [/.*/], () => pulled(), { label: 'edmond-pull' }), 'edmond-pull');
    dismiss(bot);
    if (!bot.isWorn(objId('gasmask'))) await wear(bot, ['gasmask']);
    need(await opLocUntil(c, PIPE, 1, () => inWest(bot), { label: 'pipe', maxTicks: 6 }), 'pipe');
    }
    if (st <= 10) {
    // 7. Jethick: picture -> book
    need(await talkTo(c, JETHICK, JETHICK_AT, [/^I'm looking for a woman from East Ardougne\.$/], () => bot.count('turnip_book') > 0, { label: 'jethick' }), 'jethick');
    dismiss(bot);
    }
    if (st <= 21) {
    // 8. Rehnisons: door with the book (Ted lets us in), Ted, Milli upstairs (stage 21: the door opens without the book)
    need(await opLocUntil(c, REHN_DOOR, 1, () => bot.count('turnip_book') === 0 && inRehnisons(bot), { label: 'rehnison-door', answers: [/.*/] }), 'rehnison-door');
    dismiss(bot);
    const martha = textWatch(bot, /Milli is upstairs/i);
    need(await talkTo(c, [TED, MARTHA], null, [/.*/], () => martha(), { label: 'ted' }), 'ted');
    dismiss(bot);
    }
    if (st <= 22) {
    if (R && bot.minusedlevel === 0 && !inRehnisons(bot)) need(await opLocUntil(c, REHN_DOOR, 1, () => inRehnisons(bot), { label: 'rehnison-door-resume', answers: [/.*/] }), 'rehnison-door-resume');
    if (bot.minusedlevel !== 1) need(await opLocUntil(c, REHN_UP, 1, () => bot.minusedlevel === 1, { label: 'rehnison-up' }), 'rehnison-up');
    const milli = textWatch(bot, /mossy windowless building/i);
    need(await talkTo(c, MILLI, null, [/.*/], () => milli(), { label: 'milli' }), 'milli');
    dismiss(bot);
    }
    if (bot.minusedlevel === 1 && inRehnisons(bot)) need(await opLocUntil(c, REHN_DOWN, 1, () => bot.minusedlevel === 0, { label: 'rehnison-down' }), 'rehnison-down');
    if (st <= 23) {
    // 9. plague house door: the mourner's clearance talk
    const clearance = textWatch(bot, /apply to the head mourner|Bravek the city warder/i);
    need(await opLocUntil(c, PLAGUE_DOOR, 1, () => clearance(), { label: 'plague-door-1', answers: [/^I fear not a mere plague\.$/] }), 'plague-door-1');
    dismiss(bot);
    }
    const inBravek = () => { const t = bot.tile(); return t.x >= 2530 && t.x <= 2540 && t.z >= 3310 && t.z <= 3318; };
    if (st <= 24) {
    // 10. clerk -> Bravek
    // the clerk only lets us through if BRAVEK is within 7 tiles of the PLAYER when her "Mr Bravek..." page is continued
    // (clerk.rs2:51-55, .npc_find(coord, bravek, 7, 0)); he wanders his office (x 2531-2541, wanderrange 5) behind the
    // wall. So: stand at the east end of the civic office (2529,3317), talk until that page shows, HOLD it until he is
    // within 7 of us, then continue (no retry needed; the wait overlaps the dialog)
    // (resume at 24/25 read the same: at 25 the clerk says "Bravek will see you now" at once, clerk.rs2:5)
    const clerkOk = textWatch(bot, R ? /I suppose they can come in then|will see you now/i : /I suppose they can come in then/i);
    for (let k = 0; k < 4 && !clerkOk(); k++) {
        dismiss(bot);
        if (cheb(bot.tile(), CLERK_STAND) > 0) await walkLive(bot, { x: CLERK_STAND.x, z: CLERK_STAND.z }, { near: 0, maxTicks: 120 });
        const callPage = () => inDialog(bot) && /really needs to/i.test(allText(bot));
        await talkTo(c, CLERK, CLERK_AT, [/^I need permission to enter a plague house\.$/, /^This is urgent though!$/], () => callPage() || clerkOk(), { label: 'clerk-call' });
        if (!clerkOk()) await bot.until(() => { const b = npc(bot, BRAVEK); return !!b && cheb(bot.tile(), b) <= 7; }, 150);
        await finishDialog(bot, [/.*/], 10, () => clerkOk() && !inDialog(bot));
    }
    need(clerkOk(), 'clerk');
    dismiss(bot);
    need(await opLocUntil(c, BRAVEK_DOOR, 1, inBravek, { label: 'bravek-door', stand: { x: 2529, z: 3314 } }), 'bravek-door');
    need(await talkTo(c, BRAVEK, BRAVEK_AT, [/^This is really important though!$/, /^Do you know what is in the cure\?$/], () => bot.count('scruffy_note') > 0, { label: 'bravek-note' }), 'bravek-note');
    dismiss(bot);
    }
    if (st <= 26) {
    if (R && !inBravek()) need(await opLocUntil(c, BRAVEK_DOOR, 1, inBravek, { label: 'bravek-door-resume', stand: { x: 2529, z: 3314 } }), 'bravek-door-resume');
    need(await talkTo(c, BRAVEK, BRAVEK_AT, [/^They won't listen to me!$/], () => bot.count('warrant') > 0, { label: 'bravek-warrant' }), 'bravek-warrant');
    dismiss(bot);
    }
    // out through his door (scripted: from the door tile 2530 it puts us on 2529; the planners think it is open)
    if (st <= 26 || inBravek()) need(await opLocUntil(c, BRAVEK_DOOR, 1, () => !inBravek(), { label: 'bravek-out', stand: { x: 2530, z: 3314 } }), 'bravek-out');
    if (st <= 27) {
    // 11. plague house with the warrant, key, basement, Elena
    if (!inPHBasement(bot)) {
    need(await opLocUntil(c, PLAGUE_DOOR, 1, () => inPlagueHouse(bot), { label: 'plague-door-2', answers: [/.*/] }), 'plague-door-2');
    dismiss(bot);
    need(await opLocUntil(c, BARREL, 1, () => bot.count('elenakey') > 0, { label: 'barrel' }), 'barrel');
    dismiss(bot);
    need(await opLocUntil(c, PH_DOWN, 1, () => inSewer(bot), { label: 'ph-down' }), 'ph-down');
    }
    need(await opLocUntil(c, ELENA_GATE, 1, () => bot.tile().x >= 2540, { label: 'elena-gate', answers: [/.*/] }), 'elena-gate');
    dismiss(bot);
    const freed = textWatch(bot, /Go and see my father/i);
    need(await talkTo(c, ELENA_P, ELENA_AT, [/.*/], () => freed(), { label: 'elena' }), 'elena');
    dismiss(bot);
    }
    // 12. back to Edmond: gate, stairs, door, manhole -> sewer -> mud pile -> garden
    // (resume at 28: only the legs that remain from where we stand; from East Ardougne straight to Edmond)
    if (R && !inPHBasement(bot) && !inPlagueHouse(bot) && !inWest(bot) && !inSewer(bot)) return finishEdmond(c, need);
    if (!R || inPHBasement(bot)) {
    need(await opLocUntil(c, ELENA_GATE, 1, () => bot.tile().x <= 2539, { label: 'elena-gate-out' }), 'elena-gate-out');
    need(await opLocUntil(c, PH_UP, 1, () => !inSewer(bot), { label: 'ph-up' }), 'ph-up');
    }
    if (!R || inPlagueHouse(bot)) {
    need(await opLocUntil(c, PLAGUE_DOOR, 1, () => !inPlagueHouse(bot), { label: 'plague-door-out' }), 'plague-door-out');
    dismiss(bot);
    }
    // the manhole: open (op1 on closed) then climb down (op1 on open)
    for (let k = 0; k < 4 && !inSewer(bot); k++) {
        const live = bot.liveLocs.get(`0,${MANHOLE_CLOSED.x},${MANHOLE_CLOSED.z}`);
        const id = live === MANHOLE_OPEN ? MANHOLE_OPEN : MANHOLE_CLOSED.id;
        const l = { ...locAt(MANHOLE_CLOSED.id, MANHOLE_CLOSED.x, MANHOLE_CLOSED.z), id };
        // the open manhole has its cover loc on the tile SOUTH of it (manhole.rs2:12, sewerpipe.rs2:47): op it from the east
        const tiles = cheb(bot.tile(), MANHOLE_STAND) > 2
            ? (await walkLive(bot, { x: MANHOLE_STAND.x, z: MANHOLE_STAND.z }, { near: 1, maxTicks: 60 }), opLocGo(bot, l, 1, MANHOLE_STAND))
            : opLocGo(bot, l, 1, MANHOLE_STAND);
        await bot.until(() => inSewer(bot) || bot.liveLocs.get(`0,${MANHOLE_CLOSED.x},${MANHOLE_CLOSED.z}`) === MANHOLE_OPEN && id !== MANHOLE_OPEN, Math.ceil(tiles / 2) + 6);
    }
    need(inSewer(bot), 'manhole');
    mark(c, 'manhole'); failHook('plague:manhole');
    need(await opLocUntil(c, MUD_PILE, 1, () => !inSewer(bot), { label: 'mud-pile' }), 'mud-pile');
    await finishEdmond(c, need);
}
/** the last step (Edmond's reward + the teleport scroll); also the re-entry point of a retry after it failed */
async function finishEdmond(c: Ctx, need: (ok: boolean, label: string) => void): Promise<void> {
    const bot = c.bot;
    // completion observable: the reward mining xp (quest_elena.rs2:12)
    const min0 = bot.stat('mining').xp;
    // route runner: Edmond's open door leaf (1531 @ 2571,3333) left talkTo stuck on the leaf tile (partner sim
    // qrh7p 'edmond-complete'): walk in with door handling first, and retry once
    await bot.walkTo(EDMOND_AT.x, EDMOND_AT.z, { near: 1, closeDoors: true, maxTicks: 80, log: false });
    if (!(await talkTo(c, EDMOND, EDMOND_AT, [/.*/], () => bot.stat('mining').xp > min0, { label: 'edmond-complete' }))) {
        await bot.walkTo(EDMOND_AT.x, EDMOND_AT.z, { near: 0, closeDoors: true, maxTicks: 80, log: false });
        need(await talkTo(c, EDMOND, EDMOND_AT, [/.*/], () => bot.stat('mining').xp > min0, { label: 'edmond-complete2' }), 'edmond-complete');
    }
    await bot.until(() => bot.count('ardougnescroll') > 0, 4);
    dismiss(bot);
    await readScroll(c);
}
async function readScroll(c: Ctx): Promise<void> {
    const bot = c.bot;
    // 13. read the scroll: Ardougne Teleport (needed by Biohazard's fast route)
    if (bot.count('ardougnescroll')) {
        // the objbox must be continued before the varp is set and the scroll deleted (elena_teleport_scroll.rs2:10-13)
        for (let k = 0; k < 3 && bot.count('ardougnescroll'); k++) {
            dismiss(bot);
            bot.opHeld1(objId('ardougnescroll'), bot.slot('ardougnescroll')); bot.queueFlush();
            await bot.until(() => inDialog(bot) || bot.count('ardougnescroll') === 0, 3);
            await finishDialog(bot, [/.*/], 8, () => bot.count('ardougnescroll') === 0);
        }
        dismiss(bot);
        if (!bot.count('ardougnescroll')) mark(c, 'scroll-read');
    }
}
export { StepError };

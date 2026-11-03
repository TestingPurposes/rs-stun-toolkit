// q-barcrawl.ts — Alfred Grimhand's Barcrawl (miniquest, 0 QP; opens the Barbarian Outpost gate for Horror from the Deep).
// CHEAT-FREE. Content (rev 289, server/content/scripts/):
//   card     outpost gate barbariangatel/r 2115/2116 @ (2545,3570)/(2545,3569) (area_barbarian_outpost/scripts/outpost_gate.rs2:1-6):
//            while %barcrawl != complete and a guard (barbguard1 384, spawns (2544,3567)/(2544,3571)) is within 5, op1 jumps
//            into @outpost_guard_talk (barbarian_outpost_guard.rs2:4-9). Start (:11-33): chatnpc | p_choice2 "I want to come
//            through this gate." | chatplayer | chatnpc | p_choice2 "Looks can be deceiving, I am in fact a barbarian." |
//            chatplayer | chatnpc | chatnpc -> %barcrawl = started + inv_add(barcrawl_card) | mesbox | chatnpc | chatnpc.
//   bars     using the card on a bartender (opnpcu, `last_useitem = barcrawl_card`) jumps straight into the bar's
//            barcrawl label (no menu). Each label: a few chat pages, if_close, inv_del(coins), p_delays, setbit, mes:
//              Blue Moon 733 (3226,3399) 50 gp  area_varrock/scripts/bartender.rs2:110-139  (3 pages, sign after 6 t)
//              Jolly Boar 731 (3277,3488) 10 gp bartender.rs2:34-62 (2 pages, sign after 4 t, then a chatplayer page)
//              Rising Sun 736 (2957,3370) 70 gp area_falador/scripts/barmaid.rs2:7-46 (p_choice2 opt 2 + 3 pages; 8 t)
//              Rusty Anchor 734 (3045,3257) 8 gp area_port_sarim/scripts/bartender.rs2:25-62 (4 pages; setbit at if_close)
//              Zambo 568 (2925,3143) 7 gp area_karamja/scripts/zambo.rs2:16-37 (2 pages; "Zambo signs" then p_delay 2, setbit)
//              Dead Man's Chest 735 (2797,3155) 15 gp area_brimhaven/scripts/bartender.rs2:34-61 (2 pages; setbit at once)
//              Flying Horse 738 (2575,3320) 8 gp area_ardougne_east/scripts/bartender.rs2:28-51 (2 pages; 7 t; -25% hp)
//              Foresters Arms 737 (2690,3493) 18 gp area_seers/scripts/bartender.rs2:9-70 (2 pages; 5 t)
//              Dragon Inn 739 (2556,3078) 12 gp area_yanille/scripts/bartender.rs2:41-64 (2 pages; 5 t)
//              Blurberry 848 L1 (2480,3490) 10 gp area_gnome/scripts/blurberry.rs2:26-69 (2 pages; 4 t) — Grand Tree level 1
//            The 10 bits are %barcrawl bits 3..12 (quest_barcrawl.constant; ~visited_all_bars quest_barcrawl.rs2:13-16).
//   hand-in  op the gate again -> @outpost_guard_progress (guard.rs2:35-63): chatnpc | chatplayer | %barcrawl = complete,
//            card deleted | mesbox "You give the card to the barbarian" | chatnpc. (0 QP: proof = the card is taken + mesbox.)
// Travel (all measured/derived below; see STATUS.md for the A/B):
//   Falador / Varrock / Camelot teleports (teleport.rs2); Port Sarim sailors 376-378 (sailors.rs2:10-31, 30 gp, lands L1
//   (2956,3143), plank 2082) or an amulet of glory "Karamja." (amulet_of_glory.rs2:31 -> (2918,3176));
//   spirit trees (area_gnome/scripts/spirit_tree.rs2): young trees loc_1317 @ Varrock (3177,3506) and Khazard (2555,3260)
//   go ONLY to the village tree (needs %treequest complete, :49-62); the village tree stronghold_ent 1294 @ (2543,3168)
//   offers Khazard / Varrock forest / stronghold (:25-47); the stronghold tree ent 1293 @ (2460,3445) needs %grandtree
//   complete (:1-23). Destinations (spirit_tree.constant): khazard (2555,3259), varrock (3179,3507), village (2542,3169),
//   stronghold (2461,3444). The Varrock and Khazard trees have no oploc of their own (one-way).
import { SpeedBot, objId, cheb } from '../../../core.js';
import { npc, walkOp, inDialog, sendToks, tele, locAt, opLocGo, opNpcGo, dismiss, R, M2, M3, type FTok, type Tile } from '../../q-lib.js';
import { Ctx, QuestFail, go, walk, converse, useOnNpcGo, rubTeleport, sawMsg, dead, openDoorNear, nav, type Item } from './lib-troll.js';

export const QUEST = { name: "Alfred Grimhand's Barcrawl", dir: 'quest_barcrawl', qp: 0 };
export const REQUIREMENTS = {
    // the spirit trees (spirit_tree.rs2:2, :26, :50); Plague City for Ardougne Teleport (teleport.rs2:22-37) in the default
    // (fastest) route 'rb'; without Plague City run route 'ra' (o.route = 'ra', o.fh ignored): +35-50 t, see STATUS.md
    quests: ['Tree Gnome Village', 'The Grand Tree', 'Plague City'] as string[],
    qp: 0,
    skills: { magic: [58, 'Ardougne Teleport needs 51 (magic_spells.dbrow levelrequired) AFTER the Jolly Boar drink drains magic by 5+5% (area_varrock/scripts/bartender.rs2:54): 58 - 7 = 51. Route ra (no Ardougne Teleport) needs 53 (Camelot 45)'] } as Record<string, [number, string]>,
    start: { x: 2546, z: 3569, level: 0 },   // outside (east of) the Barbarian Outpost gate
    end: { x: 2546, z: 3569, level: 0 },
};
/** drinks 208 gp + boat 30 gp (+ margin); teleport runes: Falador (1 water, 3 air, 1 law), Varrock (1 fire, 3 air, 1 law),
 *  Camelot (5 air, 1 law). */
export const SUPPLY_BASE: Item[] = [
    { name: 'coins', n: 300 }, { name: 'lawrune', n: 3 }, { name: 'airrune', n: 11 }, { name: 'waterrune', n: 1 }, { name: 'firerune', n: 1 },
];
/** variant kits (STATUS.md A/B): a glory (any charge) instead of the Port Sarim boat; Ardougne Teleport runes for route rb */
export const SUPPLY_GLORY: Item[] = [{ name: 'amulet_of_glory_4', n: 1 }];
export const SUPPLY_ARDY: Item[] = [{ name: 'lawrune', n: 2 }, { name: 'waterrune', n: 2 }];
/** the fastest variant's kit (route rb + Ardougne Teleport + glory): 300 coins, 5 law, 11 air, 3 water, 1 fire, glory */
export const SUPPLY: Item[] = [
    { name: 'coins', n: 300 }, { name: 'lawrune', n: 5 }, { name: 'airrune', n: 11 }, { name: 'waterrune', n: 3 }, { name: 'firerune', n: 1 },
    { name: 'amulet_of_glory_4', n: 1 },
];

type Bar = { key: string; npc: number; at: Tile; level: number; plan: FTok[]; price: number; sign: RegExp; after: number; stand?: Tile; talk?: FTok[] };
export const BARS: Record<string, Bar> = {
    bluemoon: { key: 'bluemoon', npc: 733, at: { x: 3226, z: 3399 }, level: 0, plan: [R, R, R], price: 50, sign: /The bartender signs your card/, after: 0 },
    jollyboar: { key: 'jollyboar', npc: 731, at: { x: 3277, z: 3488 }, level: 0, plan: [R, R], price: 10, sign: /The bartender signs your card/, after: 0 },
    risingsun: { key: 'risingsun', npc: 736, at: { x: 2957, z: 3370 }, level: 0, plan: [M2[1]!, R, R, R], price: 70, sign: /The barmaid signs your card/, after: 0 },
    rustyanchor: { key: 'rustyanchor', npc: 734, at: { x: 3045, z: 3257 }, level: 0, plan: [R, R, R, R], price: 8, sign: /The bartender signs your card/, after: 0 },
    zambo: { key: 'zambo', npc: 568, at: { x: 2925, z: 3143 }, level: 0, plan: [R, R], price: 7, sign: /Zambo signs your card/, after: 3 },
    deadman: { key: 'deadman', npc: 735, at: { x: 2797, z: 3155 }, level: 0, plan: [R, R], price: 15, sign: /2 bartenders signing 2 barcrawl cards/, after: 0 },
    flyinghorse: { key: 'flyinghorse', npc: 738, at: { x: 2575, z: 3320 }, level: 0, plan: [R, R], price: 8, sign: /^signing your barcrawl card$/, after: 0, stand: { x: 2574, z: 3320 },
        // the card-use op never opened a dialog here (sim: 5 tries from (2575,3320), npc at (2575,3321)); Talk-to works:
        // chatnpc | chatplayer | chatnpc | p_choice3 opt 3 "I'm doing Alfred Grimhand's Barcrawl." | chatplayer | chatnpc (bartender.rs2:1-35)
        talk: [R, R, R, M3[2]!, R, R] },   // inside the door loc_1533 (2576,3320 W edge)
    foresters: { key: 'foresters', npc: 737, at: { x: 2690, z: 3493 }, level: 0, plan: [R, R], price: 18, sign: /scrawls his signature on your card/, after: 0 },
    dragoninn: { key: 'dragoninn', npc: 739, at: { x: 2556, z: 3078 }, level: 0, plan: [R, R], price: 12, sign: /^You can just about make out the bartender signing/, after: 0 },
    blurberry: { key: 'blurberry', npc: 848, at: { x: 2480, z: 3490 }, level: 1, plan: [R, R], price: 10, sign: /Blurberry signs your card/, after: 0 },
};
const CARD = 'barcrawl_card';
const GATE = { id: 2116, x: 2545, z: 3569 }, GATE_STAND = { x: 2546, z: 3569 };

export interface BarOpts { log?: boolean; karamja?: 'boat' | 'glory'; route?: 'ra' | 'rb'; fh?: 'walk' | 'ardy' }

export async function run(bot: SpeedBot, o: BarOpts = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    const c = new Ctx(bot, 'barcrawl', o);
    await nav();
    bot.holdDialogs = true;
    const karamja = o.karamja ?? (bot.count('amulet_of_glory_4') + bot.count('amulet_of_glory_3') + bot.count('amulet_of_glory_2') + bot.count('amulet_of_glory_1') > 0 ? 'glory' : 'boat');
    const route = o.route ?? 'rb', fh = o.fh ?? (route === 'rb' ? 'ardy' : 'walk');
    const watch = setInterval(() => { if (dead(bot)) bot.disposed || console.log('[barcrawl] DIED'); }, 1000);
    try {
        await body(c, karamja, route, fh);
        return { ok: true, ticks: c.t, msg: `barcrawl complete (card handed in), karamja=${karamja} route=${route} fh=${fh}; marks ${JSON.stringify(c.marks)}` };
    } catch (e) {
        if (!(e instanceof QuestFail)) throw e;
        return { ok: false, ticks: c.t, msg: e.message };
    } finally { clearInterval(watch); }
}

/** Op the outpost gate from the east and answer the guard. `done` decides when we stop. */
async function gateTalk(c: Ctx, done: () => boolean, plan: FTok[], answers: RegExp[], label: string): Promise<void> {
    const bot = c.bot, gate = locAt(GATE.id, GATE.x, GATE.z, 0);
    for (let k = 0; k < 3 && !done(); k++) {
        if (!(await walk(bot, GATE_STAND, () => { opLocGo(bot, gate, 1); }, () => inDialog(bot) || done(), { near: 0, maxTicks: k === 0 ? 900 : 30 }))) continue;
        if (done()) break;
        sendToks(bot, plan);
        await converse(bot, done, answers, 30);
    }
    if (!done()) c.fail(`${label}: gate dialog`);
    c.mark(label);
}

/** Use the card on a bartender (walk next to him first: the walker opens closed doors on its route, useOnNpcGo does not),
 *  send the page plan, wait for the "signs your card" message. */
/** session 8 (allchaos qt52m: 'dragoninn: not signed', and every retry restarted at the Rising Sun, signed already: its barmaid
 *  only offers the drinks menu then -> 'risingsun: not signed' x2): the bars each account had signed in this process survive a
 *  retry. BC_SIGNED_MEMO=0 reverts. */
const SIGNED = new Map<string, Set<string>>();
export async function drink(c: Ctx, b: Bar): Promise<void> {
    const bot = c.bot;
    const memo = SIGNED.get(bot.loginUser) ?? new Set<string>(); SIGNED.set(bot.loginUser, memo);
    if (process.env.BC_SIGNED_MEMO !== '0' && memo.has(b.key)) { c.log(`${b.key}: signed in an earlier attempt, skipped`); return; }
    if (bot.count('coins') < b.price) c.fail(`${b.key}: ${bot.count('coins')} coins < ${b.price}`);
    if (bot.count(CARD) === 0) c.fail(`${b.key}: no barcrawl card`);
    if (inDialog(bot) || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }   // the last bar's closing chatplayer page
    const since = bot.tickCount, coins0 = bot.count('coins');
    // session 9 (allchaos qu04m: a server drop during the Rising Sun cocktail: 70 coins paid, the 'signs your card' message never
    // reached us, the server finished the script (every retry then got the plain drinks menu = bit set): 'not signed' x3,
    // STOPPED): the bartender's price paid with the card held counts as signed, and so does a talk that offers only the bar's
    // normal menu (the barcrawl dialogue is offered only while the bar is unsigned). BC_PAID_SIGNED=0 reverts.
    const PAID = process.env.BC_PAID_SIGNED !== '0';
    let menuOnly = false;
    const paid = () => PAID && coins0 - bot.count('coins') >= b.price && bot.count(CARD) > 0;
    let paidAt = -1;
    const signed = () => {
        if (sawMsg(bot, b.sign, since) || menuOnly) return true;
        if (PAID && bot.chatModalId !== -1 && bot.count(CARD) > 0 && bot.count('coins') === coins0) {
            const opts = bot.dialogOptions().map(o => o.text);
            if (opts.length >= 2 && !opts.some(t => /Barcrawl/i.test(t)) && opts.some(t => /ale|beer|stout|bomb|drink|rum|cocktail|those/i.test(t))) {
                menuOnly = true; c.log(`${b.key}: only the normal menu [${opts.join(' | ').slice(0, 100)}] with the card held: signed already`);
                return true;
            }
        }
        if (!paid()) return false;
        if (paidAt < 0) paidAt = bot.tickCount;
        if (bot.tickCount - paidAt < 14) return false;
        menuOnly = true; c.log(`${b.key}: paid ${coins0 - bot.count('coins')} coins 14 t ago, no sign message (a drop?): counted as signed`);
        return true;
    };
    let sent = false;
    for (let k = 0; k < 10 && !signed(); k++) {
        let n = npc(bot, b.npc);
        const near = () => { const m = npc(bot, b.npc); return !!m && m.d <= 1 && bot.minusedlevel === b.level; };
        if (b.stand && k === 0 && cheb(bot.tile(), b.stand) > 0) {   // a door between the street and the bartender: stand inside first
            await walk(bot, b.stand, null, () => cheb(bot.tile(), b.stand!) === 0 || signed(), { near: 0, maxTicks: 900, level: b.level });
            n = npc(bot, b.npc);
        }
        if (!near()) {
            const dest = n && n.d <= 20 && bot.minusedlevel === b.level ? { x: n.x, z: n.z } : b.at;
            // NOT `|| inDialog()`: a stray chat page (objbox1 seen after the Ardougne teleport on chaos seed 6102) ended the walk at once
            const w = await walk(bot, dest, null, () => near() || signed(), { near: 1, maxTicks: 900, level: b.level });
            n = npc(bot, b.npc);
            // session 6 (allchaos qt13m: walkOp from inside the Blue Moon (3227,3402) to the Jolly Boar 'no route' at once, the
            // inn's door shut by the chaos doors): one door-aware core walkTo before giving up. BC_WALK_FALLBACK=0 reverts.
            if (!n && process.env.BC_WALK_FALLBACK !== '0') {
                const r2 = await bot.walkTo(dest.x, dest.z, { near: 2, closeDoors: true, maxTicks: 600, log: false, level: b.level });
                console.log(`[barcrawl] ${b.key}: walk fallback (core walkTo closeDoors) ok=${r2.ok} at ${JSON.stringify(bot.tile())}`);
                if (!near()) await walk(bot, dest, null, () => near() || signed(), { near: 1, maxTicks: 600, level: b.level });
                n = npc(bot, b.npc);
            }
            if (!n) c.fail(`${b.key}: bartender not visible after the walk (walk ${w}, near ${near()}, dialog ${inDialog(bot)} ${bot.chatModalId}/${bot.mainModalId}, signed ${signed()}, dest ${JSON.stringify(dest)})`);
        }
        if (!n) c.fail(`${b.key}: bartender not visible`);
        // attempts 0-2: use the card (no menu); later: Talk-to and pick "I'm doing Alfred Grimhand's Barcrawl." (every bar offers it)
        const viaTalk = k >= 3 || !!b.talk;
        if (inDialog(bot) && !sent) { dismiss(bot); await bot.tick(1); }   // a stray page, not this bartender's
        // route runner: from k >= 4 a bare OPNPC1 (the engine paths to a side it can reach): our own route to the
        // adjacent tile ends across the Flying Horse counter when the barman stands behind it (sims qrc1m/qrh3m: 6 x no dialog)
        if (!inDialog(bot)) { if (k >= 4) { bot.opNpc(n!.idx, 1); bot.queueFlush(); } else if (viaTalk) opNpcGo(bot, n!, 1); else useOnNpcGo(bot, n!, CARD); }
        if (!(await bot.until(() => inDialog(bot) || signed(), 4))) {
            c.log(`${b.key}: no dialog (try ${k}, npc ${n!.x},${n!.z} d${n!.d}, me ${JSON.stringify(bot.tile())})`);
            if (k >= 1 && openDoorNear(bot, 2)) await bot.tick(2);   // a closed door between us (Flying Horse loc_1533 @ 2576,3320)
            // route runner: the bartender wanders behind the counter; from a tile next to the counter but off the
            // stand tile no op reaches him (sim qrc1m: 6 x no dialog at 2575,3320, barman 2575,3321): go back to the stand
            if (b.stand && cheb(bot.tile(), b.stand) > 0) await walk(bot, b.stand, null, () => cheb(bot.tile(), b.stand!) === 0, { near: 0, maxTicks: 20, level: b.level });
            continue;
        }
        if (!sent && inDialog(bot) && (!viaTalk || b.talk)) { sendToks(bot, viaTalk ? b.talk! : b.plan); sent = true; }
        await converse(bot, () => signed() || bot.count('coins') < coins0, [/Barcrawl/i], 12);
        await bot.until(signed, 14);
    }
    if (!signed()) c.fail(`${b.key}: not signed (coins ${coins0} -> ${bot.count('coins')})`);
    if (menuOnly && inDialog(bot)) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
    memo.add(b.key);
    if (b.after) await bot.tick(b.after);
    c.mark(b.key);
}

async function teleport(c: Ctx, spell: string): Promise<void> {
    dismiss(c.bot);
    if (!(await tele(c.bot, spell)).ok) c.fail(`${spell} failed`);
    c.mark(spell);
}

/** Spirit tree hop: op1 the tree, answer its menu (a young tree has a Yes/No menu only), land within 4 of `dest`. */
async function spiritTree(c: Ctx, tree: { id: number; x: number; z: number }, plan: FTok[], answers: RegExp[], dest: Tile, label: string): Promise<void> {
    const bot = c.bot, loc = locAt(tree.id, tree.x, tree.z, 0);
    const there = () => cheb(bot.tile(), dest) <= 4 && bot.minusedlevel === 0;
    for (let k = 0; k < 3 && !there(); k++) {
        if (!(await walk(bot, { x: tree.x, z: tree.z }, () => { opLocGo(bot, loc, 1); }, () => inDialog(bot) || there(), { near: 3, maxTicks: 600 }))) continue;
        if (there()) break;
        if (k === 0) sendToks(bot, plan);
        await converse(bot, there, answers, 25);
    }
    if (!there()) c.fail(`${label}: spirit tree`);
    dismiss(bot);
    c.mark(label);
}
const YOUNG_PLAN: FTok[] = [R, R, M2[0]!, R, R];                       // mesbox | mesbox | p_choice2 Yes please | chatplayer | mesbox
const treePlan = (opt: number): FTok[] => [R, R, M2[1]!, R, R, R, M3[opt]!, R];   // mesbox x2 | Where can I go? | chatplayer | mesbox x2 | p_choice3 | mesbox
const VILLAGE = { x: 2542, z: 3169 }, STRONGHOLD = { x: 2461, z: 3444 }, KHAZARD = { x: 2555, z: 3259 };

/** Grand Tree level 1 (Blurberry's bar) from the stronghold: trunk door 1967 @ (2464,3492), ladder 1747 @ (2466,3495). */
async function grandTreeL1(c: Ctx, up: boolean): Promise<void> {
    const bot = c.bot;
    if (up) {
        const inTrunk = () => { const t = bot.tile(); return t.x >= 2463 && t.x <= 2468 && t.z >= 3493 && t.z <= 3498; };
        await go(c, { x: 2465, z: 3491 }, 'trunk-door', { near: 0 });
        for (let k = 0; k < 3 && !inTrunk(); k++) { opLocGo(bot, locAt(1967, 2464, 3492), 1, { x: 2465, z: 3491 }); await bot.until(inTrunk, 8); }
        if (!inTrunk()) c.fail('grand tree door');
        for (let k = 0; k < 4 && bot.minusedlevel !== 1; k++) { opLocGo(bot, locAt(1747, 2466, 3495, 0), 1); await bot.until(() => bot.minusedlevel === 1, 10); dismiss(bot); }
        if (bot.minusedlevel !== 1) c.fail('grand tree ladder up');
    } else {
        for (let k = 0; k < 4 && bot.minusedlevel !== 0; k++) {
            opLocGo(bot, locAt(1748, 2466, 3495, 1), 3);   // laddermiddle op3 = climb-down (q-monkeymadness trunkTo)
            await converse(bot, () => bot.minusedlevel === 0, [/Climb down/i], 10);
        }
        if (bot.minusedlevel !== 0) c.fail('grand tree ladder down');
        const inTrunk = () => { const t = bot.tile(); return t.x >= 2463 && t.x <= 2468 && t.z >= 3493 && t.z <= 3498; };
        for (let k = 0; k < 4 && inTrunk(); k++) { opLocGo(bot, locAt(1967, 2464, 3492), 1, { x: 2465, z: 3493 }); await bot.until(() => !inTrunk(), 8); }
        if (inTrunk()) c.fail('grand tree door (out)');
    }
    c.mark(up ? 'tree-L1' : 'tree-L0');
}

async function body(c: Ctx, karamja: 'boat' | 'glory', route: 'ra' | 'rb', fh: 'walk' | 'ardy'): Promise<void> {
    const bot = c.bot;
    // 1. the card (gate from the east; the guard talks through it)
    if (bot.count(CARD) === 0) {
        await gateTalk(c, () => bot.count(CARD) > 0, [R, M2[0]!, R, R, M2[1]!, R, R, R],
            [/^I want to come through this gate\.$/, /^Looks can be deceiving, I am in fact a barbarian\.$/], 'card');
    }
    // 2. Falador: Rising Sun, then walk to Port Sarim's Rusty Anchor
    await teleport(c, 'falador_teleport');
    await drink(c, BARS.risingsun!);
    await drink(c, BARS.rustyanchor!);
    // 3. Karamja: Zambo, then Brimhaven's Dead Man's Chest
    if (karamja === 'glory') {
        dismiss(bot);
        if (!(await rubTeleport(c, /^amulet_of_glory_[1-4]$/, /^Karamja\.$/))) c.fail('glory -> Karamja');
        c.mark('glory');
    } else {
        await go(c, { x: 3029, z: 3217 }, 'port sarim dock', { near: 3 });
        const sailors = [376, 377, 378];
        const onShip = () => bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2956, z: 3143 }) <= 4;
        for (let k = 0; k < 3 && !onShip() && bot.minusedlevel === 0; k++) {
            const n = npc(bot, sailors); if (!n) c.fail('no sailor');
            opNpcGo(bot, n!, 1);
            await bot.until(() => inDialog(bot), 10);
            sendToks(bot, [R, R, M2[0]!, R]);   // chatnpc | chatnpc | p_choice2 "Yes please." | chatplayer
            await converse(bot, onShip, [/^Yes please\.$/], 30);
        }
        if (!onShip()) c.fail('boat to Karamja');
        dismiss(bot);
        for (let k = 0; k < 4 && bot.minusedlevel !== 0; k++) { bot.opLoc(2956, 3144, 2082, 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 0, 6); }
        if (bot.minusedlevel !== 0) c.fail('Karamja gangplank');
        c.mark('karamja');
    }
    await drink(c, BARS.zambo!);
    await drink(c, BARS.deadman!);
    if (route === 'rb') {   // Seers now: the walk to the outpost starts from the Flying Horse instead (278 vs 360 tiles)
        await teleport(c, 'camelot_teleport');
        await drink(c, BARS.foresters!);
    }
    // 4. Varrock: Blue Moon, Jolly Boar, then the Varrock young spirit tree -> village tree
    await teleport(c, 'varrock_teleport');
    await drink(c, BARS.bluemoon!);
    await drink(c, BARS.jollyboar!);
    await spiritTree(c, { id: 1317, x: 3177, z: 3506 }, YOUNG_PLAN, [/^Yes please\.$/], VILLAGE, 'young-varrock');
    // 5. village tree -> stronghold tree -> Grand Tree L1 (Blurberry) -> back to the stronghold tree
    await spiritTree(c, { id: 1294, x: 2543, z: 3168 }, treePlan(2), [/^Where can I go\?$/, /^Gnome stronghold\.$/], STRONGHOLD, 'village->stronghold');
    await grandTreeL1(c, true);
    await drink(c, BARS.blurberry!);
    await grandTreeL1(c, false);
    if (route === 'ra') {
        // 6a. stronghold tree -> Khazard -> Flying Horse -> Dragon Inn (Yanille) on foot; Camelot -> Foresters -> outpost
        await spiritTree(c, { id: 1293, x: 2460, z: 3445 }, treePlan(2), [/^Where can I go\?$/, /^Battlefield of Khazard\.$/], KHAZARD, 'stronghold->khazard');
        await drink(c, BARS.flyinghorse!);
        await drink(c, BARS.dragoninn!);
        await teleport(c, 'camelot_teleport');
        await drink(c, BARS.foresters!);
    } else {
        // 6b. stronghold tree -> village tree; railing; Elkoy (inside, elkoy.rs2:165-186) jumps you to the maze entrance
        //     (^elkoy_entrance_coord 2504,3192); Dragon Inn; Ardougne teleport (or walk) to the Flying Horse
        await spiritTree(c, { id: 1293, x: 2460, z: 3445 }, treePlan(0), [/^Where can I go\?$/, /^Tree Gnome Village\.$/], VILLAGE, 'stronghold->village');
        await elkoyOut(c);
        await drink(c, BARS.dragoninn!);
        if (fh === 'ardy') await teleport(c, 'ardougne_teleport');
        await drink(c, BARS.flyinghorse!);
    }
    // 7. walk to the outpost gate and hand the card in (card deleted = done: barbarian_outpost_guard.rs2:50-57)
    await gateTalk(c, () => bot.count(CARD) === 0, [R, R, R, R], [], 'hand-in');
}

/** Village tree -> loose railing (2186 @ 2515,3161, north side; gnomevillage_fence.rs2 moves you to 2515,3160) -> Elkoy (474
 *  @ 2514,3159) "Yes please." -> telejump to (2504,3192). */
async function elkoyOut(c: Ctx): Promise<void> {
    const bot = c.bot, RAIL_N = { x: 2515, z: 3161 }, RAIL_S = { x: 2515, z: 3160 }, OUT = { x: 2504, z: 3192 };
    const south = () => bot.tile().z <= 3160 && bot.tile().x <= 2520;
    for (let k = 0; k < 3 && !south(); k++) {
        await walk(bot, RAIL_N, () => { opLocGo(bot, locAt(2186, 2515, 3161), 1, RAIL_N); }, south, { near: 0, maxTicks: 120 });
        await bot.until(south, 6);
    }
    if (!south()) c.fail('loose railing');
    const out = () => cheb(bot.tile(), OUT) <= 2;
    for (let k = 0; k < 3 && !out(); k++) {
        const n = npc(bot, 474); if (!n) c.fail('Elkoy not visible');
        opNpcGo(bot, n!, 1);
        if (!(await bot.until(() => inDialog(bot) || out(), 8))) continue;
        sendToks(bot, [R, R, M2[0]!, R, R]);   // chatplayer | chatnpc | p_choice2 Yes please. | chatplayer | chatnpc -> telejump
        await converse(bot, out, [/^Yes please\.$/], 15);
    }
    if (!out()) c.fail('Elkoy jump');
    dismiss(bot);
    c.mark('elkoy');
}
